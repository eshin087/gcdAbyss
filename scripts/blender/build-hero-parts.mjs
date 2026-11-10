// node scripts/blender/build-hero-parts.mjs
//
// Rebuilds src/entities/player/heroParts.js: the hero's sculpted rigid parts (hair, collar, lapels,
// sword blade, ...) are modelled by scripts/blender/hero_parts.py in a headless Blender and written
// out as packed vertex data that model.js hangs on the rig's joints (ADR-037). The body dimensions
// the parts are fitted to come from model.js itself, so there is one source of truth.
//
// Needs Blender 4.2+ on PATH, or its executable in the BLENDER environment variable.
import { spawnSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const { DIM, BODY, HAIR_CLUSTERS, REST, CAPE_SHEETS } = await import('../../src/entities/player/model.js');

const candidates = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);
const blender = candidates.find((c) => c === 'blender' || existsSync(c));

const dims = path.join(os.tmpdir(), `abyss-hero-dims-${process.pid}.json`);
await fs.writeFile(dims, JSON.stringify({ DIM, BODY, HAIR_CLUSTERS, REST, CAPE_SHEETS }));
const out = path.join(root, 'src', 'entities', 'player', 'heroParts.js');
const r = spawnSync(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', path.join(here, 'hero_parts.py'), '--', dims, out, ...process.argv.slice(2)], { stdio: 'inherit' });
await fs.rm(dims, { force: true });
if (r.error) throw r.error;
process.exit(r.status ?? 1);
