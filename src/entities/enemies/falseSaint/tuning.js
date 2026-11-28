import { PLAYER_SCALE } from '../../player/model.js';
import { DUEL_WORLD } from '../duelist/worldTuning.js';
import { BEAM_TUNING } from '../ascendant/tuningBeam.js';
import { TUNING_MELEE } from './tuningMelee.js';
import { TUNING_BOOST } from './tuningBoost.js';
import { TUNING_ARSENAL } from './tuningArsenal.js';
import { TUNING_TERRAIN } from './tuningTerrain.js';

// Anselm, the False Saint's numbers (the Last Foundry, `?level=foundry`). Started from Bai Wuji's (the
// newest duelist on Tian Lei's strike builders: one bar, bare hands) with four phases. CORE'S file: the
// shared numbers (the bar, the gates, the tells' minimums, posture, the pressure, the phase scales, the
// shell's limits, the jet's switch). The moves agents add their own numbers in tuningMelee.js /
// tuningBoost.js / tuningArsenal.js / tuningTerrain.js (merged below: `TUNING.melee` / `.boost` /
// `.arsenal` / `.terrain`), never here; the tuning agent may change anything.
// Every field new to the engine is prefixed `fs`. Per-phase values are [P1, P2, P3, P4]. Times in
// seconds, distances in metres.

export const TUNING = {
  name: 'ANSELM, THE FALSE SAINT',
  // the bar (core's stand-in; the tuning agent's): one bar, four phases
  hp: 18000,
  // one bar, four phases: 74 % THE SKIN BREAKS, 46 % WEAPONS FREE, 20 % TRUE FRAME
  phaseAt: [1, 0.74, 0.46, 0.2],
  maxPhase: 4,
  radius: 0.45,
  scale: PLAYER_SCALE * 1.1,
  bound: 13.8,

  // ---- tells (COMBAT.md, the rule; the lead's correction with the owner's v04 pack): the cue 0.35 s before
  // the impact; the first windup of a melee move / string >= 0.7 s in phase 1 (later phases through
  // windupScale: 0.7 x windupScale[f]); a string's hits >= 0.45 s apart in every phase (saint.mjs DATA)
  flashLead: 0.35,
  minFirstWindup: 0.7,
  minHitGap: 0.45,
  // faster each phase; realise scales every unfixed windup, the minimums still hold (saint.mjs DATA)
  // (the tuning pass tried [1, 0.92, 0.86, 0.8] / [0.8, 0.66, 0.58, 0.48]: phase 4 +5 - 9 cues a minute, but the
  // striking bot (85 % of the cues answered, swinging at him) then lost all three seeds (it won 2 of 3 as here):
  // kept as they were)
  windupScale: [1, 0.94, 0.88, 0.84],
  recoveryScale: [0.8, 0.72, 0.66, 0.6],
  close: { first: 3.2, next: 1.6, speed: 15 },
  reach: { fist: 1.7, kick: 2.1, line: 2.2, lineW: 0.8 },

  // ---- posture
  posture: {
    max: [1000, 1150, 1300, 1450],
    hit: { light: 5, heavy: 16 },
    guard: { light: 8, heavy: 20 },
    regenDelay: 2.4,
    regenRate: 20,
    breakTime: 3.4,
    breakCritMult: 1.5,
  },
  guard: {
    arc: 1.31, raiseDelay: 0.16, windupOpen: 0.55, counterChance: [0, 0.35, 0.7, 1], countWindow: 2.5,
    crushPoise: 48, clashStop: 0.07, deflectStop: 0.1, recoverOpen: 0.55, evade: 0.4, wardLinger: 0.6,
  },
  trade: { posture: 1.5, push: 0.5 },
  camera: { within: 6.5, fade: 4, zoom: -6 },
  flinch: { breakOff: 2, window: 1.6, hitStun: 0.22 },
  hitStun: { light: { stop: 0.065, jolt: 0.65, push: 0.14, shudder: 0.045 }, heavy: { stop: 0.1, jolt: 1, push: 0.32, shudder: 0.07 }, critStop: 0.12, joltDecay: 5 },
  parts: { head: 1.3, body: 1, leg: 0.9 },
  execRange: 3.2,
  ghostepBehind: 1.5,
  execution: { damage: 260 },

  // ---- footwork: he walks; from phase 2 his jet step (fsJet, the boost agent's) closes a gap
  move: {
    walk: 2.8, run: 7, sprint: 9.5,
    turn: [9, 10, 11, 12], trackTurn: [14, 16, 17, 18],
    band: [1.6, 3.0],
    sprintAt: 5, near: 1.1, backChance: 0.2, backstep: { dist: 2.2, time: 0.3 }, strafeSwitch: [0.7, 1.6],
  },
  idleGap: [[0.12, 0.34], [0.08, 0.24], [0.05, 0.16], [0.03, 0.1]],
  openingGap: [[0.14, 0.4], [0.1, 0.3], [0.08, 0.24], [0.06, 0.2]],
  chain: [0.65, 0.72, 0.8, 0.85],
  pressure: {
    chainDepth: [3, 4, 5, 6],
    chainRest: [[0.3, 0.55], [0.2, 0.4], [0.14, 0.3], [0.1, 0.22]],
    linkCut: 0.5, chainCut: 0.5,
    near: 3.3, far: 6, front: 0.9, behind: 2.2, away: 1.2,
    maxRun: [2, 3, 3, 3], overRun: 0.1, sameCat: 0.7,
    floorAfter: [16, 12, 10, 8], floorBoost: 1.8, floorForce: 2,
    seek: { max: 2.5, every: 9 },
    farDist: 6, closerBoost: 1.8,
    maxLive: [1, 2, 2, 3],
    bias: { string: [1.8, 1.6, 1.5, 1.4] },
    density: [1.4, 1.6, 1.8, 2.0],
    mixed: 0.1,
    holdGap: 5,
    guard: { sep: 0.3, margin: 0.06, maxHold: 0.5, maxDelay: 0.9, horizon: 1.4, pad: 0.12 },
    pursue: { margin: 0.5, after: 0.06, gap: 0.06, closeK: [1.0, 1.4, 1.6, 1.6], dashK: [1.0, 1.4, 1.5, 1.6], away: 1.2, leapLead: 0.35, blinkLead: 0.4, blinkKeep: 0.6, miss: 0, lead: 0.6, habit: 0.6, habitMax: 3, habitDecay: 0.1 },
    // what tests/integration/saint.mjs tunePace asserts (the tuning pass, 2026-11-28; a god-mode guarding bot that
    // roams 2.5 / 5 / 9 m, seeds 4242 / 7 / 99 x 60 s a phase): each phase at least rampMean x the one before in
    // the seeds' mean (phase 3 only as busy as phase 2: its beams, swarm and pass join the strings), at least
    // minRate cues a minute per seed, no gap between two cues over maxGap s, the jet step at least `steps` x as
    // frequent as the phase before (P3, P4). Measured: 47.7 / 53.8 / 53.7 / 55.4 - 63.4 cues a minute (seeds
    // 43.7 - 53.6, 50.3 - 56.7, 48.5 - 59.4, 53.0 - 66.1: phase 4 moved 8 a minute between two builds whose only
    // difference was Dies Irae's plates: the seeded fights part, so the floors are loose), gaps <= 6.4 / 4.5 / 4.9 /
    // 5.9 s, steps 0 / 1.7 / 3.7 / 3.0 - 4.3 a minute
    meter: { rampMean: [1, 1.04, 0.97, 0.98], minRate: [40, 46, 44, 48], maxGap: [7.0, 5.2, 5.5, 6.5], steps: 0.75 },
  },
  punish: { weight: 4 },
  fullDeflect: { minHits: 5, posture: 70 },
  lock: { start: 0.5, push: 0.085, decay: [0.32, 0.36, 0.38, 0.4], dur: 2.6, hold: 0.6, posture: 110, shove: { damage: 12, knockback: 2.6 }, camera: { zoom: -7, weight: 0.55 } },
  mikiri: { posture: 130 },
  cinematic: { zoom: -10, weight: 0.6, slowmo: 0.28, dur: 0.9 },
  // the hardest hitter in the game (Bai Wuji 1.54): the tuning agent's
  damageScale: 1.6,
  airFall: { g: 26 },

  // ---- THE TRANSITIONS (core's: moves.js TRANSITION_MOVES): his change, then a push from where he
  // stands (no damage, blockable) that throws the nearest pieces down. windup: s of the change
  transition: { windup: 1.7, ringRadius: 6, damage: 0, knockback: 7, blockPush: 4, power: 2.2 },

  // ---- THE SHELL (shell.js FsShell): how far his skin may be gone, by phase. `limit`: the whole body's
  // exposure a cut may chip up to in that phase; `floor` (shell.js FLOORS) is where the phase starts it.
  // `perCut`: the exposure one landed sword cut takes off the part it lands on (heavy: x heavyK); the
  // part beside it takes `spill` of that. `height`: his drawn height, m (the parts' anchors are shares of it).
  fsShell: { limit: [0.08, 0.3, 0.68, 0.97], perCut: 0.12, heavyK: 1.6, spill: 0.35, height: 2.05 },

  // ---- THE JET STEP (Censer Step; FsBoost.footwork): its switch and numbers are TUNING.boost.step
  // (tuningBoost.js; `on`), the brake at its end TUNING.boost.brake.

  // ---- the beam's drawing borrows Tian Lei's (fxBeam.js reads d.T.beam.look)
  beam: { ...BEAM_TUNING },
  // ---- the moves agents' numbers
  melee: TUNING_MELEE,
  boost: TUNING_BOOST,
  arsenal: TUNING_ARSENAL,
  terrain: TUNING_TERRAIN,
  // ---- what his blows do to the world (POWER: 1 fells a tree)
  world: { ...DUEL_WORLD },

  wakeRadius: 9,
};

/** Value for the phase (1-based) from a per-phase array, or the value itself. */
export function perPhase(v, phase) {
  return Array.isArray(v) ? v[Math.min(v.length, Math.max(1, phase)) - 1] : v;
}
