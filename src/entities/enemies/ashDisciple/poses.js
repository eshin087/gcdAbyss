import { DIM } from '../../player/model.js';
import { createDuelPoses, azEl, dirLerp } from '../duelist/poses.js';

// The Ash Disciple's guard stance and the pose functions built round it (duelist/poses.js: the clip
// format, the blade-driven arm, the gait). Nothing here mirrors the hero: his stance is a jian guard,
// and every move or reaction is a keyframe clip compiled from data (moves.js).

const ANK = DIM.ankle;

/** His guard (no breathing): the static pose clips start from and return to. Exported for the data.
 *  The owner's pick of three (2026-11-12, "A"): the classic jian guard. Side-on and sunk, the right
 *  foot forward; the jian held out at chest height pointing straight at the opponent; the free hand's
 *  sword-finger raised in an arc over the head. */
const GUARD_BASE = Object.freeze({
  bX: 0.02, bY: -0.16, bZ: 0.02, pitch: 0.02, yaw: 0.62, roll: 0,
  hip: 0.08, hipZ: 0.03, hipX: 0.02, spX: 0.06, spY: -0.18, spZ: -0.02,
  hdX: 0.04, hdY: -0.5, hdZ: 0.02, two: 0, flat: 0.95, rFy: -0.25, lFy: 0.9,
  rH: [0.02, -0.12, 0.44], rP: [-0.7, -0.6, -0.2], lH: [-0.08, 0.5, -0.04], lP: [0.8, 0.4, -0.3],
  swF: [0, 1, 0], rK: [-0.3, 0, 1], lK: [0.6, 0, 0.8],
  rF: [-0.12, ANK, 0.36], lF: [0.2, ANK, -0.3],
  sw: [-0.52, 0.14],
});
export const GUARD = GUARD_BASE;

const K = createDuelPoses(GUARD);
export const { duelStance, duelLoco, compileClip, evalClip, duelClip } = K;
/** The pose table HeroAnimator takes for him. */
export const DUEL_POSES = K.POSES;

export { azEl, dirLerp };
