import { TELL } from '../../../combat/rules.js';
import { makeRealise } from '../duelist/realise.js';
import { X as ASC } from '../ascendant/moves.js';
import { compileClip, completeBeat, GUARD, FRAGS, CLIPS as POSE_CLIPS, REACT as POSE_REACT, OPEN_CLIPS as POSE_OPEN, TRANSITION_KEYS as TK } from './poses.js';
import { TUNING, perPhase } from './tuning.js';
import * as MELEE from './moves/melee.js';
import * as BOOST from './moves/boost.js';
import * as ARSENAL from './moves/arsenal.js';
import * as TERRAIN from './moves/terrain.js';

// The False Saint's moves: THE ROUTER (core's; nobody owns it after wave 0: do not edit it to add a move).
// It merges the four move files, each owned by one agent:
//   moves/melee.js     the ground game: open hands, sweeps, knees, the grab, the long walk, the counter,
//                      the phase-1 flurry                                       (the melee agent)
//   moves/boost.js     the boosters: the booster punch, the plated arm's flurry, the jet strings, the dive,
//                      the overclock passes, the last grab, the jet step         (the boost agent)
//   moves/arsenal.js   lasers, the cannons, bolts, missiles, the barrage, the lance  (the arsenal agent)
//   moves/terrain.js   the ladles' pour, thrown relics                          (the terrain agent)
// and holds the three TRANSITIONS (core's: the change into phases 2, 3 and 4).
//
// A move file exports (moves/melee.js header): `moves(X)` → { name: move }, optional `LINKS`, `FIELDS`
// (the `fs` beat fields its handler owns) and `create(d)` (its handler: arsenal.js shows the hooks).
// The format is the duelist's (ashDisciple/moves.js header; duelist/realise.js; duelist/brain.js for the
// engine's optional fields). X, the builders every file gets: Tian Lei's (ascendant/moves.js X: punch,
// kick, elbow, shoulder, strikeKeys, F, feet ...) plus his own: `FRAGS` (every pose fragment of the pose
// router, poses.js), `holdKeys(a, b, cock)`, `TUNING` (his), `perPhase`, `W(f, w)` (a weight in phase f
// only) and `from(f, w)` (a weight from phase f on), all four-phase.
//
// HIS RULES ON THE DATA (tests/integration/saint.mjs DATA checks them):
//   - every new beat or move field is prefixed `fs` (the engine's own names: the suite's ENGINE list);
//   - every real blow has a tell and a windup inside TUNING.minFirstWindup (0.7 x windupScale, COMBAT.md) / minHitGap;
//   - weights are four-phase arrays [P1, P2, P3, P4].
// MOVE FIELDS THE ROUTER READS (so no agent edits this file to give him a flurry or a counter):
//   fsFlurry: [phases]   this move is his flurry (the kit's streakMove) in those phases (a later file's
//                        claim on a phase wins: boost's Rosary over melee's Litany from phase 2)
//   fsCounter: [phases]  this move is his counter out of his guard in those phases (the same rule)
// CORE'S BEAT FIELDS (saint.js handles them):
//   fsMoment: 2 | 3 | 4  a transition's impact: the shell's phase, his dress, a push ring, the light's flare

const N = TELL.NORMAL, B = TELL.BLUE, R = TELL.RED;

/** A held pose's keys over a beat (u 0..2): from `a` at the cock to `b` at the impact, held. */
export const holdKeys = (a, b, cock = 0.7) => [[cock * 0.5, a], [cock, a], [1.0, { ...b, e: 'i' }], [2.0, b]];
const PH = [1, 2, 3, 4];
/** A weight in phase f only / from phase f on (four phases). */
const W = (f, w) => PH.map((k) => (k === f ? w : 0));
const from = (f, w) => PH.map((k) => (k >= f ? w : 0));

/** The builders every move file is given. */
export const X = Object.freeze({ ...ASC, W, from, FRAGS, holdKeys, TUNING, perPhase, TELL: Object.freeze({ N, B, R, K: TELL.BLACK }) });

const FILES = [['melee', MELEE], ['boost', BOOST], ['arsenal', ARSENAL], ['terrain', TERRAIN]];

// ---------------------------------------------------------------- the transitions (core's)
const TR = TUNING.transition;
/** A phase's change: one beat, a push from where he stands at its impact (no damage, blockable). */
const change = (n, label, keys) => ({
  label, phase: n, weight: [0, 0, 0, 0], transition: true, cooldown: 0, band: [0, 99], recovery: 0.6,
  beats: [{
    tell: N, windup: TR.windup, fixed: true, active: 0.2, damage: TR.damage, knockback: TR.knockback, blockPush: TR.blockPush,
    zone: { kind: 'ring', r: TR.ringRadius }, part: 'feet', track: 0, close: 0, cock: 0.85, air: true, fsMoment: n, keys,
  }],
});
const TRANSITION_MOVES = {
  /** THE SKIN BREAKS (phase 2): he stops, looks at his torn forearm, strips the sleeve's skin; one eye lights. */
  skinBreaks: change(2, 'The Skin Breaks (phase 2)', TK.skinBreaks),
  /** WEAPONS FREE (phase 3): the jacket burns off his right side, the petals open, he lifts on the jets. */
  weaponsFree: change(3, 'Weapons Free (phase 3)', TK.weaponsFree),
  /** TRUE FRAME (phase 4): a core vent burns off what is left of the shell; three sensors; the alarm. */
  trueFrame: change(4, 'True Frame (phase 4)', TK.trueFrame),
};

// ---------------------------------------------------------------- the merge
function merge() {
  const out = {}, links = {}, owners = {};
  for (const [who, M] of FILES) {
    let mv = {};
    try {
      mv = M.moves?.(X) ?? {};
    } catch (err) {
      console.error(`[saint] moves/${who}.js moves() failed`, err);
    }
    for (const [k, v] of Object.entries(mv)) {
      if (Object.hasOwn(out, k)) {
        console.error(`[saint] move "${k}" of moves/${who}.js is defined twice: the first kept`);
        continue;
      }
      out[k] = v;
      owners[k] = who;
    }
    for (const [k, v] of Object.entries(M.LINKS ?? {})) links[k] = [...(links[k] ?? []), ...v];
  }
  for (const [k, v] of Object.entries(TRANSITION_MOVES)) {
    out[k] = v;
    owners[k] = 'core';
  }
  return { out, links, owners };
}
const M0 = merge();
export const MOVES = M0.out;
export const MOVE_NAMES = Object.keys(MOVES);
/** Which file each move came from ('melee' | 'boost' | 'arsenal' | 'terrain' | 'core'). */
export const MOVE_OWNERS = Object.freeze(M0.owners);
/** The merged links of the four files (links.js adds core's). */
export const FILE_LINKS = M0.links;
/** The handlers: { name, fields, create } of every move file that has one (saint.js builds them). */
export const HANDLERS = Object.freeze(FILES.filter(([, M]) => typeof M.create === 'function').map(([name, M]) => Object.freeze({ name, fields: Object.freeze([...(M.FIELDS ?? [])]), create: M.create })));
/** The scripted move that begins each later phase. */
export const TRANSITIONS = Object.freeze({ 2: 'skinBreaks', 3: 'weaponsFree', 4: 'trueFrame' });

/** Per phase (index phase - 1): the move a field `key` claims (the last file's claim wins), else `dflt`. */
function byPhase(key, dflt) {
  const out = PH.map(() => dflt);
  for (const name of MOVE_NAMES) {
    const ph = MOVES[name][key];
    if (Array.isArray(ph)) for (const f of ph) if (f >= 1 && f <= 4) out[f - 1] = name;
  }
  return Object.freeze(out);
}
/** His flurry per phase (the kit's streakMove) and his counter out of his guard per phase (counterMove). */
export const STREAKS = byPhase('fsFlurry', 'litany');
export const COUNTERS = byPhase('fsCounter', 'rebuke');
export const STREAK = STREAKS[0];
export const COUNTER = COUNTERS[0];

// ---------------------------------------------------------------- reaction clips (the pose router's)
export const CLIP = Object.fromEntries(Object.entries(POSE_CLIPS).map(([k, c]) => [k, compileClip(c.keys.map(([t, pose]) => ({ t, ...pose })), c.dur, { hold: !!c.hold })]));
for (const [k, c] of Object.entries(CLIP)) c.name = k;
export const REACT = POSE_REACT;
export const OPEN = POSE_OPEN;

// ---------------------------------------------------------------- realising a move
export const realise = makeRealise({ TUNING, MOVES, compileClip: (keys, dur) => compileClip(keys, dur), completeBeat });

/** The guard pose (for tools). */
export { GUARD };
