import { DIM } from '../../player/model.js';
import { createDuelPoses } from '../duelist/poses.js';

// The Starless Lord's four guard stances, one per blade form, and the pose functions built round
// each (duelist/poses.js: the clip format, the blade-driven arms, the gait). A clip compiled in one
// form remembers its stance, so the animator can blend a transition from the old form's guard into
// the new one's.

const ANK = DIM.ankle;

const BASE = {
  bX: 0.02, bY: -0.14, bZ: 0.02, pitch: 0.02, yaw: 0.5, roll: 0,
  hip: 0.07, hipZ: 0.03, hipX: 0.02, spX: 0.05, spY: -0.14, spZ: -0.02,
  hdX: 0.03, hdY: -0.4, hdZ: 0.02, two: 0, flat: 0.95, rFy: -0.25, lFy: 0.9,
  rH: [0.0, -0.16, 0.4], rP: [-0.7, -0.6, -0.2], lH: [0.06, -0.2, 0.36], lP: [0.7, -0.5, -0.2],
  swF: [0, 1, 0], rK: [-0.3, 0, 1], lK: [0.6, 0, 0.8],
  rF: [-0.12, ANK, 0.34], lF: [0.2, ANK, -0.3],
  sw: [-0.42, 0.55],
};

/** The guards (body space: +x his left, +z forward; `sw` / `lsw` = a blade's [az, el]). */
export const GUARDS = Object.freeze([
  // 1 — one blade: side-on, the blade raised forward at an angle, the free hand out low before him,
  // open (the hand that casts)
  Object.freeze({ ...BASE }),
  // 2 — twin blades: squarer to the opponent, both hands forward, the blades a V in front of him
  Object.freeze({
    ...BASE, yaw: 0.22, bY: -0.17, spY: -0.06, hdY: -0.18, hip: 0.03,
    rH: [-0.07, -0.2, 0.36], rP: [-0.8, -0.5, -0.2], sw: [-0.72, 0.42],
    lH: [0.07, -0.2, 0.36], lP: [0.8, -0.5, -0.2], lsw: [0.72, 0.42],
    rF: [-0.17, ANK, 0.22], lF: [0.2, ANK, -0.2],
  }),
  // 3 — the staff: both hands on the long hilt, held across the body, one blade high before his
  // right shoulder, the other low behind his left hip
  Object.freeze({
    ...BASE, yaw: 0.36, bY: -0.16, two: 1,
    rH: [0.06, -0.24, 0.36], rP: [-0.7, -0.6, -0.3], sw: [-0.78, 0.72],
    rF: [-0.14, ANK, 0.3], lF: [0.2, ANK, -0.26],
  }),
  // 4 — the cross-hilted blade: a high two-handed guard, the blade upright by his right shoulder
  Object.freeze({
    ...BASE, yaw: 0.56, bY: -0.19, two: 1, spY: -0.18, hdY: -0.46,
    rH: [-0.04, -0.04, 0.26], rP: [-0.85, -0.3, -0.2], sw: [-0.3, 1.22],
    rF: [-0.12, ANK, 0.38], lF: [0.2, ANK, -0.32],
  }),
]);

/** One pose set per form (index 0 = form 1). */
export const FORM_POSES = GUARDS.map((G, i) =>
  createDuelPoses(G, i === 2 ? { run: { hand: [-0.05, -0.34, 0.1], pole: [-0.8, -0.4, -0.3], blade: [-1.3, 0.2], flat: [0, 1, 0] } } : {}));

/** The pose set of a form (1-based, clamped). */
export const formPoses = (form) => FORM_POSES[Math.min(FORM_POSES.length, Math.max(1, form | 0)) - 1];
