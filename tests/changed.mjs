// `npm test -- --changed`: which of run.mjs's tasks cover the files a branch changed (ADR-276).
//
// A local pre-check, not the gate: CI runs every task on every PR, and a PR merges only when that is
// green. So these rules aim at the suites a change is most likely to break, and anything they do not
// know (a file under src/ that no rule names, a shared module) runs everything.
//
// RULES: [pattern, tasks]. The FIRST rule whose pattern matches a file decides it, so the specific
// rules sit above the broad ones. tasks: names as in `--only` (a name picks the task of that name and
// every `<name> ...` part: 'lord' is lord, lord pace, lord fxlooks a ...), [] for none, or ALL.
// A new boss or level gets a rule here; tests/changedcheck.mjs fails until it has one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ALL = 'all';

// where a boss lives: its folder, its level file, its set in src/world, and its suite
export const BOSSES = [
  { enemy: 'ashDisciple', level: 'ashfall', sets: ['courtyard'], suite: 'duel' },
  { enemy: 'starlessLord', level: 'starless', sets: ['throneHall', 'starfallProps'], suite: 'lord' },
  { enemy: 'ascendant', level: 'skybreak', sets: ['skybreakRing'], suite: 'asc' },
  { enemy: 'thousandFox', level: 'foxfire', sets: ['foxTerrace'], suite: 'fox' },
  { enemy: 'sheathed', level: 'grove', sets: ['windlessGrove'], suite: 'sheath' },
  { enemy: 'wokenOne', level: 'scripthall', sets: ['scriptHall'], suite: 'woke' },
  { enemy: 'halcyon', level: 'halcyon', sets: ['halcyonPlaza'], suite: 'city' },
  { enemy: 'untouched', level: 'veil', sets: ['veiledCrossing'], suite: 'veil' },
  { enemy: 'falseSaint', level: 'foundry', sets: ['lastFoundry', 'foundryProps'], suite: 'saint' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dir = (p) => new RegExp(`^${esc(p)}/`);
const file = (p) => new RegExp(`^${esc(p)}$`);

// the world's shared pieces: what every level stands on
const WORLD = ['world', 'integ', 'life', 'groundfx', 'dpfloor', 'dragonProps', 'dggrass'];
const PRINT = ['dpfloor', 'dragonProps', 'dggrass', 'groundfx', 'world'];

export const RULES = [
  // docs and repo housekeeping: CI passes a docs-only PR at once; the WHAT'S NEW check reads CHANGELOG.md
  [file('CHANGELOG.md'), ['changelogcheck']],
  [/^(docs|\.claude|\.github|scripts)\//, []],
  [/\.md$/, []],
  [/^(LICENSE|vercel\.json|\.gitignore|\.gitattributes)$/, []],

  // the tests themselves: a suite's own file runs that suite, a helper the suites that import it
  // (suiteRule, before these rules); a test file no suite reads falls through to ALL
  [dir('tests/integration/life'), ['life']],
  [file('tests/cost-baseline.json'), ['cost']],
  [file('tests/glyphcheck.mjs'), ['glyphcheck']],
  [file('tests/changelogcheck.mjs'), ['changelogcheck']],
  [/^tests\/(changed|changedcheck)\.mjs$/, ['changedcheck']],

  // one boss: his folder, his level, his set
  ...BOSSES.flatMap((b) => [
    [dir(`src/entities/enemies/${b.enemy}`), [b.suite]],
    [file(`src/levels/${b.level}.js`), [b.suite, 'world']],
    ...b.sets.map((s) => [file(`src/world/${s}.js`), [b.suite, 'world']]),
  ]),
  // the wyrm and Cinderwood
  [dir('src/entities/dragon'), ['integ']],
  [file('src/levels/cinderwood.js'), ['integ', 'world']],
  [/^src\/world\/(forest|forestTuning|undergrowth)\.js$/, ['integ', 'world']],

  // the living world (ADR-163) and what it drives
  [dir('src/world/life'), ['life']],
  [/^src\/world\/hang(Tuning)?\.js$/, ['life']],
  [/^src\/audio\/(air|airTuning|lifeSfx|lifeSfxTuning)\.js$/, ['life']],
  [/^src\/game\/arrival(Tuning)?\.js$/, ['life']],

  // the dragon print (ADR-198): the ground, floors, grass, props and trees
  [/^src\/render\/(dragonPrint|dragonPrintFx|dragonFloor|dragonLeaf|dragonProps|dragonStep)\.js$/, PRINT],
  [/^src\/world\/(dragonGrass|dragonTufts)\.js$/, PRINT],
  [/^src\/world\/groundFx(Tuning)?\.js$/, ['groundfx', 'world']],
  [dir('src/world'), WORLD],

  // smaller areas with suites of their own
  [file('src/render/autoQuality.js'), ['autoq']],
  [/^src\/game\/(records|rank|rankTuning|grade|stats|recorder|eligibility)\.js$/, ['records']],
  [/^src\/combat\/deathblow(Fx|Matrix)\.js$/, ['dbfx', 'dbmatrix', 'dbsfx', 'duel']],
  [file('src/audio/deathblowSfx.js'), ['dbsfx']],
  [file('src/ui/changelog.js'), ['changelogcheck']],
  [file('src/ui/changelogPanel.js'), ['changelogcheck']],
  [dir('src/dev'), ['integ']],

  // everything else under src/ (core, combat, the hero, the duelist engine, render, ui, audio, game,
  // main.js, the level registry), the shared test helpers, the runner, the packages: run all
  [/.*/, ALL],
];

/**
 * A changed file in tests/integration: the tasks that run it, or for a helper (bench, marks,
 * swordAudit ...) the tasks whose suite imports it. shim.mjs is imported by nearly every suite, so it
 * picks nearly all. null: not a suite file, or one no suite reads (then the rules decide: ALL).
 */
export function suiteRule(path, tasks, root = '.') {
  const m = /^tests\/integration\/([^/]+\.mjs)$/.exec(path);
  if (!m) return null;
  const own = tasks.filter((t) => t.file === `tests/integration/${m[1]}`).map((t) => t.name);
  if (own.length) return own;
  const users = tasks.filter((t) => {
    if (!t.file.startsWith('tests/integration/')) return false;
    try { return readFileSync(join(root, t.file), 'utf8').includes(`./${m[1]}`); } catch { return false; }
  }).map((t) => t.name);
  return users.length ? users : null;
}

/**
 * The tasks to run for these changed files.
 * @param {string[]} files  repo-relative paths, forward slashes
 * @param {{name: string, file: string}[]} tasks  run.mjs's tasks (name, the script it runs)
 * @param {string} root  the repo (a changed test helper is looked up in the suites that import it)
 * @returns {{all: boolean, names: Set<string>, why: Map<string, string[]>}}  names: the task names
 *   picked (in --only's sense); why: each picked name -> the files that picked it ('*' for all)
 */
export function pickTasks(files, tasks, root = '.') {
  const names = new Set();
  const why = new Map();
  let all = false;
  const add = (n, f) => { names.add(n); if (!why.has(n)) why.set(n, []); why.get(n).push(f); };
  for (const f of files) {
    const own = suiteRule(f, tasks, root);
    const rule = own ?? RULES.find(([re]) => re.test(f))[1];
    if (rule === ALL) { all = true; add('*', f); continue; }
    for (const n of rule) add(n, f);
    // whatever touches the game's code may change what a level costs (the cost budget, ADR-206), and
    // every source file is read by the glyph check; both take a second or so
    if (f.startsWith('src/')) { add('cost', f); add('glyphcheck', f); }
  }
  if (files.length) add('changelogcheck', '(always)');
  return { all, names, why };
}

/** The files this branch changed since it left `base` (committed, staged, unstaged and new). */
export function changedFiles(root, base) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let ref = base;
  if (!ref) {
    for (const r of ['origin/main', 'main']) {
      try { git('rev-parse', '--verify', '--quiet', r); ref = r; break; } catch { /* try the next */ }
    }
  }
  if (!ref) throw new Error('no origin/main or main to compare with (pass --base <ref>)');
  const mergeBase = git('merge-base', 'HEAD', ref);
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const files = new Set([
    ...lines(git('diff', '--name-only', mergeBase)),
    ...lines(git('ls-files', '--others', '--exclude-standard')),
  ]);
  return { ref, mergeBase, files: [...files].sort() };
}
