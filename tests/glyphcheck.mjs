import fs from 'fs';
import path from 'path';

// Static check: every string literal passed as glyph/glyphs/gi()/gis() in module files is in the atlas.
const root = process.argv[2];
const SRC = " .,'`:;-~_=+*^<>/\\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?\"1234567890ACDEFGHJKLPRSTUZ·•°×";
const OK = new Set([...SRC]);
const dirs = ['src/entities', 'src/game', 'src/audio'];
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
for (const d of dirs) walk(path.join(root, d));
const litRe = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
let bad = 0, checked = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    const m = ln.match(/\bglyphs?\s*:\s*(.*)$/) || ln.match(/\bgis?\((.*)$/) || ln.match(/^const ([A-Z_]+)\s*=\s*(['"`].*)$/);
    if (!m) return;
    const expr = m[m.length - 1];
    const cut = expr.split(/,\s*[a-zA-Z]+\s*:/)[0];
    for (const lit of cut.match(litRe) || []) {
      let s;
      try {
        s = Function('return ' + lit)();
      } catch {
        continue;
      }
      checked++;
      for (const ch of s) {
        if (!OK.has(ch)) {
          bad++;
          console.log(`BAD glyph ${JSON.stringify(ch)} in ${path.relative(root, f)}:${i + 1}: ${ln.trim()}`);
        }
      }
    }
  });
}
console.log(`checked ${checked} glyph-ish literals in ${files.length} files, bad=${bad}`);
