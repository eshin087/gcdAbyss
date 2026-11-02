import fs from 'fs';
import path from 'path';

// Static check: every string literal passed as glyph/glyphs/gi()/gis() in module files is in the world
// glyph atlas (render/glyphs.js). Exits non-zero on a bad glyph so `npm test` fails.
// HTML-only glyphs (HUD text) are exempt: src/ui is not scanned, and the HUD label glyphs in
// combat/rules.js TELL_STYLE are skipped — but world-side code must never feed them to the atlas.
const root = process.argv[2];
const SRC = " .,'`:;-~_=+*^<>/\\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?\"1234567890ACDEFGHJKLPRSTUZ·•°×";
const OK = new Set([...SRC]);
const dirs = ['src/entities', 'src/game', 'src/audio', 'src/dev', 'src/combat'];
// blocks of HTML-only glyphs: [file, first line regex, last line regex]
const HTML_ONLY = [['src/combat/rules.js', /^export const TELL_STYLE\b/, /^\}\);/]];
// world-side code: reading a TELL_STYLE glyph here would put an HTML-only glyph into the atlas
const WORLD_SIDE = ['src/entities', 'src/world', 'src/render'];
const files = [];
const walk = (d, list) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, list);
    else if (p.endsWith('.js')) list.push(p);
  }
};
for (const d of dirs) walk(path.join(root, d), files);
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const litRe = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
let bad = 0, checked = 0, exempt = 0;
// Surface-glyph `levels` tables (createSurfaceGlyphMaterial): arrays of glyph-variant strings,
// often spread over several lines. Checked where written: a `levels: [` key, or a constant whose
// name ends in LEVELS / GLYPHS / RAMP(S) assigned an array. `levels: SOME_CONST` is checked at the
// constant; gi() also throws at runtime when the integration sims build the models.
const LEVELS_KEY = /\blevels\s*:\s*\[/;
const LEVELS_CONST = /^(?:export\s+)?const\s+[A-Z0-9_]*(?:LEVELS|GLYPHS|RAMPS?)\s*=\s*\[/;
// From the `[` that `re` ends on, collect the bracketed array text (comments dropped, brackets
// inside strings ignored) across lines; returns its string literals as [literal, line index].
function arrayLiterals(lines, i, re) {
  const m = re.exec(lines[i]);
  let text = '', depth = 0, quote = null;
  const starts = []; // text offset where each source line begins
  const done = () => [...text.matchAll(litRe)].map((x) => [x[0], i + starts.filter((s) => s <= x.index).length - 1]);
  for (let l = i, col = m.index + m[0].length - 1; l < lines.length; l++, col = 0) {
    const ln = lines[l];
    starts.push(text.length);
    for (let c = col; c < ln.length; c++) {
      const ch = ln[c];
      if (quote) {
        text += ch;
        if (ch === '\\') text += ln[++c] ?? '';
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '/' && ln[c + 1] === '/') break; // line comment
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) return done();
      text += ch;
    }
    text += '\n';
  }
  return done();
}
const checkLit = (lit, f, i, ln) => {
  let s;
  try {
    s = Function('return ' + lit)();
  } catch {
    return;
  }
  checked++;
  for (const ch of s) {
    if (!OK.has(ch)) {
      bad++;
      console.log(`BAD glyph ${JSON.stringify(ch)} in ${rel(f)}:${i + 1}: ${ln.trim()}`);
    }
  }
};
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const block = HTML_ONLY.find((b) => b[0] === rel(f));
  let inBlock = false;
  lines.forEach((ln, i) => {
    if (block && !inBlock && block[1].test(ln)) inBlock = true;
    if (inBlock) {
      if (/\bglyphs?\s*:/.test(ln)) exempt++;
      if (block[2].test(ln)) inBlock = false;
      return;
    }
    for (const re of [LEVELS_KEY, LEVELS_CONST]) {
      if (re.test(ln)) for (const [lit, at] of arrayLiterals(lines, i, re)) checkLit(lit, f, at, lines[at]);
    }
    const m = ln.match(/\bglyphs?\s*:\s*(.*)$/) || ln.match(/\bgis?\((.*)$/) || ln.match(/^const ([A-Z_]+)\s*=\s*(['"`].*)$/);
    if (!m) return;
    const expr = m[m.length - 1];
    const cut = expr.split(/,\s*[a-zA-Z]+\s*:/)[0];
    for (const lit of cut.match(litRe) || []) checkLit(lit, f, i, ln);
  });
}
// HTML-only glyphs must stay out of world rendering
const world = [];
for (const d of WORLD_SIDE) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d), world);
for (const f of world) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
    if (/(TELL_STYLE|tellStyle)\b/.test(ln) && /\.glyph\b/.test(ln)) {
      bad++;
      console.log(`BAD world use of an HTML-only TELL_STYLE glyph in ${rel(f)}:${i + 1}: ${ln.trim()}`);
    }
  });
}
console.log(`checked ${checked} glyph-ish literals in ${files.length} files (${exempt} HTML-only exempt), ${world.length} world-side files for TELL_STYLE glyphs, bad=${bad}`);
process.exit(bad ? 1 : 0);
