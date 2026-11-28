import { DIM } from '../../player/model.js';
import { createDuelPoses } from '../duelist/poses.js';
import * as ML from './posesMelee.js';
import * as BO from './posesBoost.js';
import * as AR from './posesArsenal.js';
import * as TR from './posesTerrain.js';

// The False Saint's stance, footwork and reaction clips (the MELEE AGENT's file from wave 1, the lead's
// call with the owner's v04 pack; core's stand-in in wave 0; the body contract: gear.js header). A calm man
// in a wide, low guard, both open hands raised (GUARD); his ward is the forearms. The boost agent reads the
// guard, it does not edit this file.
//
// THE OWNER'S v04 PACK, PAGE A (docs/art/character-packs-v04/the-false-saint/turnaround-defaults.png), key
// by key (the pack is visual only: no timing, tell or gameplay comes from it):
//   A07 IDLE      IDLE: upright, the feet a shoulder apart, the open hands hanging by the thighs. He stands
//                 into it from the kneel (the intro) before he drops into the guard.
//   A08 GUARD     GUARD (the same as ref-02 row 3 and A15 - A18: one stance in every shell state): wide (the
//                 feet ~0.65 m apart), the knees bent and out, the torso upright and a little turned, both
//                 open hands raised at chest / chin height, the lead (left) one forward.
//   A09-10 RUN    the run's arms (createDuelPoses `run`): the right hand open and pumping before the chest
//                 instead of a blade trailing low; the legs, the lean and the left arm are the hero's gait.
//                 (From phase 2 the jet dash replaces the run at range: the boost agent's footwork.)
//   A13 RECOIL    RECOIL: thrown back, the head and chest back, the arms flung out low, the weight on the
//                 rear foot (the hit reactions' first key: stagger, recoil, reeling, the break's first beat).
//   A14 RECOVERY  RECOVERY: crouched wide and low, the open hands low before the knees, the head up on the
//                 hero (the reactions' second key, then the guard).
//
// Pose channels (duelist/poses.js header): body space +x his LEFT, +y up, +z forward; hands are offsets
// from each shoulder; feet model space; `sw` [az, el] turns the right fist (it hangs on the sword joint).
//
// THE POSES ROUTER: the four moves agents each own a pose file, merged here:
//   posesMelee.js    names start with `ml`   (the melee agent)
//   posesBoost.js    names start with `bo`   (the boost agent)
//   posesArsenal.js  names start with `ar`   (the arsenal agent)
//   posesTerrain.js  names start with `tr`   (the terrain agent)
//   this file        no prefix               (the body agent)
// Each exports FRAGS (pose fragments), CLIPS (reaction clips: { dur, hold?, keys }), REACT (their root
// motion) and OPEN (the ones that leave him open). A name defined twice is reported (console.error) and
// the earlier one kept; saint.mjs DATA fails on it. A pose file never imports this one.
//
// THE BODY'S FRAGMENTS (FRAGS; the moves files and core's transitions read them):
//   STAND     his guard (A08), every whole pose's base
//   IDLE      A07's idle stand · RECOIL_BIG A13's recoil · RECOVERY A14's recovery crouch
//   KNEEL     on one knee, the hands together before his chest (the wait; the posture break)
//   KNEEL_ARM on one knee, the right arm half raised (the death)
//   LOOK_ARM  the head bowed to his raised right forearm (the P1 -> P2 change)
//   OPEN      the arms thrown wide, the chest out (the P2 -> P3 and P3 -> P4 changes' bursts)
//   GATHER    folded over, the forearms crossed before the chest (a change's gathering)

const ANK = DIM.ankle;
const FIST_UP = Object.freeze([0, 1.45]);

/** His guard (ref-02 row 3; the v04 pack's A08 and A15 - A18; every phase): a wide, low, bent-knee stance,
 *  both hands raised and OPEN at chest / chin height, the lead (left) hand a little forward. */
export const GUARD = Object.freeze({
  bX: 0, bY: -0.19, bZ: 0.0, pitch: 0.05, yaw: -0.28, roll: 0,
  hip: -0.04, hipZ: 0, hipX: 0, spX: 0.02, spY: 0.06, spZ: 0,
  hdX: 0.02, hdY: 0.22, hdZ: 0, two: 0, flat: 1, rFy: -0.6, lFy: 0.3,
  rH: [0.06, -0.07, 0.26], rP: [-0.9, -0.45, -0.2], lH: [-0.02, -0.02, 0.38], lP: [0.9, -0.45, -0.1], sw: FIST_UP,
  swF: [0, 0, 1], rK: [-0.62, 0, 0.78], lK: [0.56, 0, 0.83],
  rF: [-0.33, ANK, -0.2], lF: [0.3, ANK, 0.2],
});

// (A09 - A10: at a run the right hand is open and pumps before the chest, no blade trailing low)
const K = createDuelPoses(GUARD, { breath: { k: 0.5, period: 4.6 }, run: { hand: [0.06, -0.2, 0.1], pole: [-0.8, -0.5, -0.3], blade: [0, 0.3] } });
export const { duelStance, compileClip, completeBeat, evalClip, duelClip } = K;

/** The pose table HeroAnimator takes for him. */
export const FS_POSES = Object.freeze({ loco: K.duelLoco, duel: K.POSES.duel });

// ---------------------------------------------------------------- the body's fragments
/** A whole pose: the stance's every field, then `p`; the head turned back onto the opponent unless the
 *  pose turns it itself. */
function W(p) {
  const out = { ...GUARD, ...p };
  if (p.hdY === undefined) out.hdY = GUARD.hdY - ((p.yaw ?? GUARD.yaw) - GUARD.yaw) * 0.82 - (p.spY ?? 0) * 0.82;
  return out;
}
const STAND = W({});
/** A07: the idle stand (the intro's middle: he stands from the kneel into it, then drops into the guard). */
const IDLE = W({
  bX: 0, bY: -0.02, bZ: 0, pitch: 0.0, yaw: -0.06, hip: 0, spX: 0, spY: 0, hdX: 0.04, hdY: 0.05,
  rH: [-0.03, -0.44, 0.05], rP: [-0.9, -0.5, -0.3], lH: [0.03, -0.44, 0.06], lP: [0.9, -0.5, -0.3], sw: [0.1, -1.3],
  rF: [-0.13, ANK, -0.02], lF: [0.13, ANK, 0.03], rK: [-0.1, 0, 1], lK: [0.1, 0, 1], rFy: -0.15, lFy: 0.12, flat: 1,
});
/** A13: thrown back by a blow. */
// (v04, A13: the arms FLUNG out low and wide, clear of the body from above, the head snapped back: the read
// of a blow that landed, at 34 px)
const RECOIL_BIG = W({
  bY: -0.1, bZ: -0.12, pitch: -0.38, yaw: -0.36, spX: -0.14, hdX: -0.46, hdY: 0.1,
  rH: [-0.42, -0.2, -0.06], rP: [-0.8, 0.4, -0.5], lH: [0.44, -0.24, 0.0], lP: [0.8, 0.4, -0.5], sw: [-0.6, -0.4],
  rF: [-0.22, ANK, -0.42], lF: [0.26, ANK, 0.16], rK: [-0.5, 0, 0.85], lK: [0.4, 0, 0.9],
});
/** A14: the recovery: crouched wide and low, the open hands low before the knees, the head up on the hero. */
const RECOVERY = W({
  bY: -0.38, bZ: 0.02, pitch: 0.2, yaw: -0.2, hdX: -0.14, spX: 0.04,
  rH: [0.06, -0.32, 0.26], rP: [-0.85, -0.5, -0.1], lH: [-0.04, -0.3, 0.32], lP: [0.85, -0.5, -0.1], sw: [0, 0.6],
  rF: [-0.36, ANK, -0.24], lF: [0.34, ANK, 0.22], rK: [-0.75, 0, 0.66], lK: [0.72, 0, 0.7],
});
const KNEEL = W({
  bX: 0, bY: -0.52, pitch: 0.12, yaw: 0, hip: 0, spX: 0.06, spY: 0, hdX: 0.34, hdY: 0, hdZ: 0,
  rF: [-0.12, ANK, 0.32], lF: [0.17, ANK, -0.42], rK: [0, 0, 1], lK: [0.1, -0.85, 0.5], flat: 0.7, rFy: -0.1, lFy: 0.1,
  rH: [0.14, -0.02, 0.26], rP: [-0.8, -0.4, -0.2], lH: [-0.14, -0.02, 0.26], lP: [0.8, -0.4, -0.2], sw: [0.6, 0.4],
});
const KNEEL_ARM = W({ ...KNEEL, hdX: 0.1, rH: [-0.06, 0.16, 0.3], rP: [-0.9, 0.2, -0.2], lH: [0.02, -0.55, 0.22], lP: [0.7, -0.3, 0.2], sw: [0.2, 0.6] });
const LOOK_ARM = W({ pitch: 0.06, yaw: -0.2, hdX: 0.36, hdY: -0.3, rH: [0.12, 0.02, 0.32], rP: [-0.8, -0.5, -0.3], lH: [-0.02, -0.06, 0.28], lP: [0.9, -0.4, 0], sw: [0.9, 0.3] });
const OPEN = W({ bY: -0.06, pitch: -0.16, yaw: 0, hdX: -0.26, spX: -0.12, rH: [-0.42, 0.06, 0.12], rP: [-0.9, 0.2, -0.3], lH: [0.42, 0.06, 0.12], lP: [0.9, 0.2, -0.3], rF: [-0.28, ANK, 0], lF: [0.28, ANK, 0], sw: [-1.2, 0.2] });
const GATHER = W({ bY: -0.36, pitch: 0.2, yaw: 0, hdX: 0.28, spX: 0.1, rH: [0.2, -0.04, 0.24], rP: [-0.8, -0.5, -0.3], lH: [-0.2, -0.02, 0.26], lP: [0.8, -0.5, -0.3], rF: [-0.3, ANK, 0.02], lF: [0.3, ANK, -0.02], rK: [-0.6, 0, 0.8], lK: [0.6, 0, 0.8], sw: [1.0, 0.2] });

const BODY_FRAGS = { STAND, IDLE, RECOIL_BIG, RECOVERY, KNEEL, KNEEL_ARM, LOOK_ARM, OPEN, GATHER };

// ---------------------------------------------------------------- the body's clips
// (keys: [t s, pose]; e: ease of the segment ending at the key: 's' smooth, 'o' ease-out, 'i' in, 'l', 'h')
/** A ward: the forearm raised across the side the blade comes from. `side` 1 = his left, -1 his right. */
function ward(side, high = false) {
  const arm = side > 0
    ? { lH: [-0.02, high ? 0.3 : 0.08, 0.3], lP: [0.9, 0.3, 0.1] }
    : { rH: [0.02, high ? 0.3 : 0.08, 0.3], rP: [-0.9, 0.3, 0.1], sw: [0.2, 0.6] };
  return W({ yaw: GUARD.yaw + side * 0.1, bY: -0.06, hdX: high ? -0.1 : 0.02, ...arm });
}
const WARD_L = ward(1), WARD_R = ward(-1), WARD_HIGH = W({ ...ward(1, true), rH: [0.02, 0.3, 0.3], rP: [-0.9, 0.3, 0.1] });
const met = (Wd, dur = 0.32) => ({ dur, hold: true, keys: [[0, Wd], [0.07, { ...Wd, e: 'o', bZ: -0.06, spX: -0.05 }], [0.2, { ...Wd, bZ: -0.02 }]] });
const RECOIL = W({ pitch: -0.18, bZ: -0.08, yaw: -0.45, hdX: -0.16, rH: [-0.2, 0.08, 0.12], rP: [-0.8, 0.4, -0.4], lH: [0.22, -0.18, 0.1], rF: [-0.18, ANK, -0.36], lF: [0.16, ANK, 0.08], sw: [0, 0.3] });

const BODY_CLIPS = {
  ward: met(WARD_L),
  wardR: met(WARD_R),
  wardHigh: met(WARD_HIGH, 0.36),
  clash: met(WARD_L, 0.26),
  deflect: { dur: 0.26, keys: [[0, WARD_L], [0.08, W({ e: 'o', yaw: GUARD.yaw - 0.25, lH: [-0.3, -0.06, 0.34], lP: [0.9, -0.2, -0.2] })], [0.2, WARD_L]] },
  wardHold: { dur: 1, hold: true, keys: [[0, WARD_L]] },
  flinch: { dur: 0.26, keys: [[0.07, { e: 'o', spX: -0.08, hdX: -0.14, bZ: -0.05, yaw: GUARD.yaw - 0.15 }]] },
  backstep: { dur: 0.36, keys: [[0.1, W({ bY: -0.06, pitch: -0.06, rF: [-0.16, 0.06, -0.14], lF: [0.14, 0.04, 0.02], flat: 0.6 })], [0.34, W({ flat: 1 })]] },
  sidestep: { dur: 0.34, keys: [[0.12, W({ bY: -0.06, roll: 0.08, rF: [-0.18, 0.06, -0.08], lF: [0.14, 0.08, 0.08], flat: 0.6 })], [0.3, W({ flat: 1 })]] },
  // (A13 recoil -> A14 recovery -> the guard)
  stagger: { dur: 0.8, keys: [[0.12, { ...RECOIL, e: 'o' }], [0.45, { ...RECOVERY, bY: -0.3, pitch: 0.12 }], [0.75, STAND]] },
  recoil: { dur: 1.0, keys: [[0.1, { ...RECOIL_BIG, e: 'o' }], [0.32, { ...RECOIL_BIG, pitch: -0.26, hdX: -0.3 }], [0.62, RECOVERY], [0.95, STAND]] },
  reeling: {
    dur: 1.45,
    keys: [[0.12, { ...RECOIL_BIG, e: 'o', pitch: -0.4, bY: -0.14 }], [0.5, { ...RECOIL_BIG, pitch: -0.3 }], [0.95, RECOVERY], [1.35, STAND]],
  },
  trampled: {
    dur: 1.5,
    keys: [[0.1, W({ e: 'o', pitch: 0.42, bY: -0.34, bZ: 0.1, hdX: 0.45, rF: [-0.08, ANK, -0.48], lF: [0.22, ANK, 0.7] })], [0.75, W({ pitch: 0.35, bY: -0.3, rF: [-0.08, ANK, -0.48], lF: [0.22, ANK, 0.7] })], [1.0, { ...RECOIL, e: 'o' }]],
  },
  lock: {
    dur: 3, hold: true,
    keys: [[0.1, W({ e: 'o', bY: -0.08, bZ: 0.06, pitch: 0.08, lH: [-0.06, 0.12, 0.42], lP: [0.8, -0.6, 0.0], rH: [0.06, 0.1, 0.4], rP: [-0.8, -0.6, 0], rF: [-0.18, ANK, -0.3], lF: [0.14, ANK, 0.3] })], [3, W({ bY: -0.1, bZ: 0.08, pitch: 0.1, lH: [-0.06, 0.12, 0.44], rH: [0.06, 0.1, 0.42], rF: [-0.18, ANK, -0.32], lF: [0.14, ANK, 0.32] })]],
  },
  broken: { dur: 4.5, hold: true, keys: [[0.14, { ...RECOIL, e: 'o' }], [0.45, { ...KNEEL, e: 'o' }], [4.0, { ...KNEEL, hdX: 0.3 }], [4.5, { ...KNEEL, bY: -0.42, hdX: 0.0 }]] },
  executed: { dur: 1.2, hold: true, keys: [[0.0, KNEEL], [0.2, { ...KNEEL, e: 'o', pitch: -0.3, hdX: -0.36, bY: -0.45 }], [0.75, { ...KNEEL, pitch: 0.3, hdX: 0.5, bY: -0.55 }], [1.2, { ...KNEEL, pitch: 0.26, hdX: 0.5, bY: -0.54 }]] },
  // the death: he drops to one knee, an arm half-raised (the sensors going out are the body's / fx's)
  death: { dur: 3.0, hold: true, keys: [[0.25, { ...RECOIL, e: 'o' }], [0.8, { ...KNEEL_ARM, e: 'o' }], [3.0, { ...KNEEL_ARM, hdX: 0.3, rH: [-0.04, 0.08, 0.3] }]] },
  /** He waits: kneeling at the edge of the pour, his back to the arrival, the hands together. */
  meditate: { dur: 1, hold: true, keys: [[0, KNEEL]] },
  /** The intro: he stands from the kneel and turns his calm face to the hero. */
  // (he stands from the kneel into A07's idle stand, turns his calm face to the hero, then drops into A08)
  intro: { dur: 2.4, keys: [[0, KNEEL], [0.6, { ...KNEEL, hdX: 0.1 }], [1.35, { ...IDLE, e: 'o', yaw: -0.4, hdY: 0.36 }], [1.8, { ...IDLE, yaw: -0.2, hdY: 0.2 }], [2.4, STAND]] },
};

/** Suggested keys for core's three transitions (moves.js TRANSITION_MOVES): u 0..2, the impact at 1.0
 *  (the shell's phase and his dress change there). */
export const TRANSITION_KEYS = Object.freeze({
  // 2: he stops, looks at his torn forearm, strips the sleeve's skin; one eye lights
  skinBreaks: [[0.2, STAND], [0.5, LOOK_ARM], [0.85, { ...LOOK_ARM, rH: [0.1, 0.06, 0.34] }], [1.0, { ...LOOK_ARM, e: 'o', lH: [-0.2, -0.1, 0.2] }], [1.5, STAND], [2.0, STAND]],
  // 3: the jacket burns off his right side, the petals open, he lifts on the jets
  weaponsFree: [[0.2, STAND], [0.6, GATHER], [0.9, GATHER], [1.0, { ...OPEN, e: 'o' }], [1.6, OPEN], [2.0, STAND]],
  // 4: a core vent burns off what is left of the shell
  trueFrame: [[0.2, STAND], [0.5, GATHER], [0.92, { ...GATHER, bY: -0.42 }], [1.0, { ...OPEN, e: 'o' }], [1.6, OPEN], [2.0, STAND]],
});

// ---------------------------------------------------------------- the router
function mergeNamed(label, parts) {
  const out = {};
  for (const [who, map] of parts) {
    for (const [k, v] of Object.entries(map ?? {})) {
      if (Object.hasOwn(out, k)) {
        console.error(`[saint] ${label} "${k}" of ${who} is defined twice: the first kept`);
        continue;
      }
      out[k] = v;
    }
  }
  return out;
}
const FILES = [['poses.js', BODY_FRAGS, BODY_CLIPS], ['posesMelee.js', ML.FRAGS, ML.CLIPS], ['posesBoost.js', BO.FRAGS, BO.CLIPS], ['posesArsenal.js', AR.FRAGS, AR.CLIPS], ['posesTerrain.js', TR.FRAGS, TR.CLIPS]];
/** Every pose fragment by name (the body's unprefixed, then ml / bo / ar / tr). */
export const FRAGS = Object.freeze(mergeNamed('pose', FILES.map(([w, f]) => [w, f])));
/** Every reaction clip (uncompiled: moves.js compiles them). */
export const CLIPS = Object.freeze(mergeNamed('clip', FILES.map(([w, , c]) => [w, c])));
/** Extra reactions' root motion, and which leave him open (the kit's REACT / OPEN). */
export const REACT = Object.freeze({ ...TR.REACT, ...AR.REACT, ...BO.REACT, ...ML.REACT });
export const OPEN_CLIPS = Object.freeze([...new Set([...ML.OPEN, ...BO.OPEN, ...AR.OPEN, ...TR.OPEN])]);
/** Names each pose file defines (saint.mjs DATA checks the prefixes and that none is defined twice). */
export const POSE_FILES = Object.freeze({
  body: [...Object.keys(BODY_FRAGS), ...Object.keys(BODY_CLIPS)],
  ml: [...Object.keys(ML.FRAGS), ...Object.keys(ML.CLIPS)],
  bo: [...Object.keys(BO.FRAGS), ...Object.keys(BO.CLIPS)],
  ar: [...Object.keys(AR.FRAGS), ...Object.keys(AR.CLIPS)],
  tr: [...Object.keys(TR.FRAGS), ...Object.keys(TR.CLIPS)],
});
/** The body's base clips (saint.mjs plays each). */
export const BODY_CLIP_NAMES = Object.freeze(Object.keys(BODY_CLIPS));
