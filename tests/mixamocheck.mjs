// Static check: the Mixamo hero trial's data (?hero=mixamo|mixrig; ADR-294) agrees with its files.
//  - every clip the data plays is in scripts/mixamo/clips.json AND in each body's GLB
//  - every swing's frames run start <= contact < end, inside its clip
//  - each GLB stays small (it is fetched only with ?hero=, but it ships in dist/assets)
// Usage: node tests/mixamocheck.mjs <repo root>
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const D = await import(pathToFileURL(join(root, 'src/entities/player/mixamo/mixClips.js')).href);
const clips = JSON.parse(readFileSync(join(root, 'scripts/mixamo/clips.json'), 'utf8'));
const errors = [];

const used = new Set(['idle', ...Object.keys(D.MIX_SWING), ...D.MIX_LIGHT, ...D.MIX_BY_NAME.map((r) => r[1]), ...Object.keys(D.MIX_LOOP_SPEED)]);
for (const m of Object.values(D.MIX_MOVES)) used.add(m.clip);
for (const k of used) if (!Object.hasOwn(clips, k)) errors.push(`clip "${k}" is played but not in scripts/mixamo/clips.json`);
for (const k of [...D.MIX_LIGHT, ...D.MIX_BY_NAME.map((r) => r[1])]) if (!D.MIX_SWING[k]) errors.push(`swing clip "${k}" has no MIX_SWING frames`);

/** A GLB's JSON chunk. */
function glbJson(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

for (const [id, body] of Object.entries(D.MIX_BODIES)) {
  const f = join(root, body.file);
  if (!existsSync(f)) {
    errors.push(`${id}: ${body.file} is missing`);
    continue;
  }
  const mb = statSync(f).size / 1048576;
  if (mb > 4) errors.push(`${id}: ${body.file} is ${mb.toFixed(1)} MB (> 4 MB)`);
  const j = glbJson(f);
  const anims = new Map((j.animations ?? []).map((a) => [a.name, a]));
  for (const k of used) if (!anims.has(k)) errors.push(`${id}: the GLB has no clip "${k}"`);
  if (!(j.skins ?? []).length) errors.push(`${id}: the GLB has no skin`);
  // a clip's length in frames, from its time accessor's max
  for (const [k, sw] of Object.entries(D.MIX_SWING)) {
    if (!(sw.start <= sw.contact && sw.contact < sw.end)) errors.push(`MIX_SWING.${k}: frames must run start <= contact < end`);
    const a = anims.get(k);
    if (!a) continue;
    const t = Math.max(...a.samplers.map((s) => j.accessors[s.input].max?.[0] ?? 0));
    const frames = Math.round(t * D.MIX_FPS);
    if (sw.end > frames) errors.push(`${id}: MIX_SWING.${k}.end ${sw.end} is past the clip's ${frames} frames`);
  }
}

if (errors.length) {
  console.error(`mixamocheck: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`mixamocheck: ok (${used.size} clips, ${Object.keys(D.MIX_BODIES).length} bodies)`);
