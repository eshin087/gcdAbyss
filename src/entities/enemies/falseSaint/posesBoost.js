import { DIM } from '../../player/model.js';
import { P, to3 } from '../../player/anim.js';

// The False Saint's boost pose fragments and reaction clips (the BOOST AGENT's file). Merged by poses.js
// (the router: its header has the rule). EVERY NAME HERE STARTS WITH `bo` (fragments and clips
// alike), so it never meets a name of the body's poses.js (unprefixed) or another moves file's (ml / bo /
// ar / tr). Do not import poses.js from here (a cycle).
// Exports: FRAGS { boName: pose } · CLIPS { boName: { dur, hold?, keys: [[t, pose], ...] } } ·
//          REACT { boName: { travel, side? } } · OPEN [boName, ...] (clips that leave him open)
// (Body space: +x his LEFT, +y up, +z forward; hands offsets from each shoulder (|offset| <= 0.55),
// feet model space [x, y, z].)
//
// THE FRAGMENTS ARE PARTIAL: only the channels a pose changes from his guard (the owner's second sheet,
// row 3: wide, low, both open hands raised). moves/boost.js lays each over the body's STAND (his guard)
// with W(), which also turns the head back onto the hero. So every move starts from the guard and goes
// back to it. The rules they keep (docs/ANIMATION.md; the TASK): the body LEADS WITH THE JET (the hips and
// the shoulder behind the booster that fires), the limbs are STRAIGHT at the contact, the tell poses are
// HELD (the booster punch's coil, the dive's hang, the last grab's whine), and the flight is RIGID: legs
// together and straight, the arms set, nothing flaps (thrust is stiff).

const ANK = DIM.ankle;
const FIST = Object.freeze([0, 0.15]); // the right fist closed, knuckles along the arm (the booster punch only)
const PALM = Object.freeze([0, 1.45]); // the right hand open, fingers up (every other blow: palms, heels)

// ---------------------------------------------------------------- the booster punch (Votive Fist)
/** The coil: the weight back over the rear (right) leg, the torso turned away, the right fist drawn back
 *  past the ribs with the elbow cocked BEHIND him (the elbow's booster aims back: its jet is the tell), the
 *  open left hand out in front, the lead foot forward. Held while the jet builds. */
const boVoCoil = {
  bY: -0.24, bZ: -0.06, pitch: 0.12, yaw: -0.78, hip: -0.14, spY: -0.06,
  rH: [0.0, -0.04, -0.14], rP: [-0.55, 0.35, -0.85], lH: [-0.04, 0.0, 0.44], lP: [0.9, -0.3, -0.1], sw: [0.4, 0.5],
  rF: [-0.28, ANK, -0.34], lF: [0.24, ANK, 0.3], rK: [-0.55, 0, 0.8], lK: [0.4, 0, 0.9], rFy: -0.7, lFy: 0.25,
};
/** The punch: a long low lunge behind the fist, the right arm STRAIGHT, the hips driven through, the rear
 *  leg straight, the left hand pulled back to the chest. */
const boVoFist = {
  bY: -0.32, bZ: 0.24, pitch: 0.2, yaw: 0.28, hip: 0.2, spY: 0.1,
  rH: [0.1, 0.02, 0.54], rP: [-0.8, -0.3, -0.4], lH: [-0.1, -0.12, 0.12], lP: [0.9, -0.4, -0.3], sw: FIST,
  rF: [-0.24, ANK, -0.55], lF: [0.22, ANK, 0.64], rK: [-0.2, -0.3, 0.9], lK: [0.3, 0, 1], rFy: -0.2, lFy: 0.15, flat: 0.9,
};
/** Out of the punch (a miss carries him on): further over the front foot, the fist still out. */
const boVoOver = {
  ...boVoFist, bY: -0.36, bZ: 0.3, pitch: 0.3, rH: [0.1, -0.04, 0.5], lH: [-0.14, -0.16, 0.06],
};

// ---------------------------------------------------------------- the rapid flurry (Rosary)
/** A piston's coil: square to the hero, the plated right arm drawn back to the ribs (the elbow back, its
 *  jet stutters), the left hand up at the chin. */
const boRoCoil = {
  bY: -0.17, yaw: -0.46, hip: -0.08,
  rH: [0.06, -0.14, 0.04], rP: [-0.8, -0.2, -0.6], lH: [-0.06, 0.06, 0.26], lP: [0.9, -0.3, 0], sw: PALM,
};
/** The piston out: the right arm straight, the heel of the palm leading, at three heights (the rhythm
 *  reads in the hand: high, middle, low). */
const piston = (h) => ({
  bY: -0.18 - (h < 0 ? 0.05 : 0), bZ: 0.06, yaw: -0.12, hip: 0.06, spY: 0.04,
  rH: [0.1, h, 0.53], rP: [-0.8, -0.4, -0.3], lH: [-0.06, 0.04, 0.22], lP: [0.9, -0.3, 0], sw: PALM,
});
const boRoHigh = piston(0.12), boRoMid = piston(-0.04), boRoLow = piston(-0.2);
/** The last of it (blue): wound right back, then both the hips and the arm driven through. */
const boRoWind = { ...boRoCoil, yaw: -0.82, bY: -0.24, hip: -0.16, rH: [0.02, -0.1, -0.08], rP: [-0.6, 0.3, -0.8], lH: [-0.04, 0.02, 0.4] };
const boRoLast = { ...piston(0.0), bY: -0.3, bZ: 0.2, yaw: 0.3, hip: 0.2, rF: [-0.24, ANK, -0.5], lF: [0.22, ANK, 0.56], rK: [-0.2, -0.3, 0.9], lK: [0.3, 0, 1] };

// ---------------------------------------------------------------- the dive (Descent)
/** Lift-off: upright and rigid on the back thrusters, the legs together and straight, the toes down, the
 *  arms held straight down and a little back, the head bowed onto the hero below. */
const boLift = {
  bY: -0.02, bZ: 0, pitch: 0.04, yaw: 0, hip: 0, spX: 0, spY: 0, hdX: 0.32,
  rH: [-0.06, -0.5, -0.1], rP: [-0.9, 0, 0.2], lH: [0.06, -0.5, -0.1], lP: [0.9, 0, 0.2], sw: [0, -1.2],
  rF: [-0.09, ANK, -0.02], lF: [0.09, ANK, 0.02], rK: [-0.1, 0, 1], lK: [0.1, 0, 1], rFy: -0.1, lFy: 0.1, flat: 0.3,
};
/** The hang (held: the mark below reads): pitched over the hero, the right knee drawn up, the left leg
 *  straight under him, the arms set back along his sides. */
const boHang = {
  ...boLift, pitch: 0.38, hdX: 0.5, bY: -0.08,
  rF: [-0.1, 0.5, 0.22], rK: [0, 0.6, 1], lF: [0.1, ANK, -0.12], lK: [0.1, -0.1, 1],
  rH: [-0.1, -0.42, -0.26], lH: [0.1, -0.42, -0.26],
};
/** The dive: knee first, the body pitched down behind it, the other leg trailing, the arms swept back. */
const boDive = {
  ...boHang, pitch: 0.62, hdX: 0.3, bY: -0.16,
  rF: [-0.1, 0.32, -0.3], rK: [0, -0.3, 1], lF: [0.12, 0.3, -0.62], lK: [0.1, -0.5, 0.6],
  rH: [-0.12, -0.3, -0.34], lH: [0.12, -0.3, -0.34], flat: 0,
};
/** The landing: down on the right knee in the crater, the right fist on the plates, the left hand up. */
const boLand = {
  bY: -0.55, pitch: 0.3, yaw: -0.1, hdX: 0.1, spX: 0.08,
  rF: [-0.14, ANK, -0.4], lF: [0.18, ANK, 0.34], rK: [0, -0.85, 0.5], lK: [0.1, 0, 1], flat: 0.7, rFy: -0.2, lFy: 0.2,
  rH: [0.06, -0.58, 0.3], rP: [-0.8, -0.4, 0], lH: [-0.06, 0.0, 0.3], lP: [0.9, -0.3, 0], sw: FIST,
};

// ---------------------------------------------------------------- the jet strings (Censer Wheel, Thurible)
/** The elbow's coil: wound the other way (the left shoulder forward), the right forearm folded across the
 *  chest, the jet at the elbow about to spin him. */
const boElCoil = {
  bY: -0.22, yaw: 0.55, hip: 0.14, spY: 0.06,
  rH: [0.22, -0.02, 0.1], rP: [-0.4, 0.1, -1], lH: [-0.04, 0.02, 0.36], lP: [0.9, -0.3, 0], sw: PALM,
  rFy: -0.3, lFy: 0.5,
};
/** The back elbow (the spin's contact): turned past side-on, his back three-quarters to the hero, the right
 *  elbow driven BACK into him point first, the hand at his chest; the left hand up. */
const boElHit = {
  bY: -0.2, yaw: -2.3, hip: -0.24, spY: -0.08, roll: 0.04,
  rH: [0.16, 0.04, 0.12], rP: [-0.3, 0.12, -1], lH: [-0.02, 0.04, 0.3], lP: [0.9, -0.3, 0], sw: PALM,
  rF: [-0.2, ANK, 0.02], lF: [0.24, ANK, -0.12], rFy: -1.9, lFy: -1.5,
};
/** The rising kick's chamber: sunk low on the jets, the right knee drawn up to the chest. */
const boKiCoil = {
  bY: -0.36, pitch: 0.14, yaw: -0.2,
  rF: [-0.12, 0.42, 0.14], rK: [0, 0.4, 1], lF: [0.16, ANK, -0.04], lK: [0.4, 0, 0.9], lFy: 0.2,
  rH: [0.02, -0.3, 0.02], lH: [-0.02, -0.28, 0.06], rP: [-0.9, 0, 0.2], lP: [0.9, 0, 0.2], sw: PALM,
};
/** The rising kick: off the floor on the calf jets, leaning back, the right leg STRAIGHT up in front of
 *  him (a heel at the jaw), the left leg straight under him, the arms set down by the hips. */
const boKiHit = {
  bY: -0.06, pitch: -0.3, yaw: -0.1, spX: -0.08, hdX: 0.2,
  rF: [-0.08, 1.55, 0.62], rK: [0, 0.5, 1], lF: [0.12, 0.2, -0.16], lK: [0.1, 0, 1], flat: 0.2,
  rH: [-0.08, -0.38, -0.08], lH: [0.08, -0.38, -0.08], rP: [-0.9, 0, 0.2], lP: [0.9, 0, 0.2], sw: PALM,
};

// ---------------------------------------------------------------- the overclock (Vespers)
/** The set: low and coiled at the launch point, the fist at the hip, the open left hand out at the hero,
 *  the body pitched along the line it is about to run. */
const boVeSet = {
  bY: -0.4, pitch: 0.36, yaw: -0.5, hip: -0.1, hdX: -0.12,
  rH: [0.04, -0.22, -0.06], rP: [-0.6, 0.2, -0.8], lH: [-0.04, -0.04, 0.42], lP: [0.9, -0.3, 0], sw: FIST,
  rF: [-0.3, ANK, -0.42], lF: [0.24, ANK, 0.32], rK: [-0.4, 0, 0.9], lK: [0.4, 0, 0.9], rFy: -0.6,
};
/** The pass: flat out along the line, the body pitched almost level, the fist STRAIGHT ahead, the other
 *  arm along his side, the legs together and trailing (rigid: the thrust carries him). */
const boVePass = {
  bY: -0.06, pitch: 0.95, yaw: 0, hip: 0, hdX: -0.62,
  rH: [0.06, 0.34, 0.42], rP: [-0.8, 0.2, -0.3], lH: [-0.02, -0.42, -0.2], lP: [0.8, -0.5, -0.3], sw: FIST,
  rF: [-0.08, 0.5, -0.62], lF: [0.08, 0.45, -0.68], rK: [-0.1, -0.6, 0.3], lK: [0.1, -0.6, 0.3], rFy: 0, lFy: 0, flat: 0,
};
/** The last pass, from above: head down, both fists driven down ahead, the knees drawn. */
const boVeDive = {
  bY: -0.3, pitch: 0.7, yaw: 0, hdX: 0.1,
  rH: [0.12, -0.24, 0.46], lH: [-0.12, -0.24, 0.46], rP: [-0.7, -0.2, -0.3], lP: [0.7, -0.2, -0.3], sw: FIST,
  rF: [-0.1, 0.45, 0.06], lF: [0.1, 0.4, -0.04], rK: [-0.1, 0.6, 1], lK: [0.1, 0.6, 1], flat: 0,
};

// ---------------------------------------------------------------- the last grab (Last Rite)
/** The whine (held): he stands up out of his guard, the chest opened on the core, the arms spread low and
 *  wide, the head lifted: the stillness is the tell. */
const boRiWhine = {
  bY: -0.08, pitch: -0.16, yaw: 0, hip: 0, spX: -0.12, spY: 0, hdX: -0.18,
  rH: [-0.4, -0.06, 0.16], rP: [-0.9, 0.2, -0.3], lH: [0.4, -0.06, 0.16], lP: [0.9, 0.2, -0.3], sw: PALM,
  rF: [-0.28, ANK, -0.02], lF: [0.28, ANK, 0.02], rK: [-0.5, 0, 0.8], lK: [0.5, 0, 0.8], rFy: -0.3, lFy: 0.3,
};
/** The embrace: a lunge, the arms closing round where the hero stands. */
const boRiHug = {
  bY: -0.26, bZ: 0.24, pitch: 0.24, yaw: 0, hdX: 0.05,
  rH: [0.24, -0.02, 0.44], rP: [-0.5, 0.3, 0.5], lH: [-0.24, -0.02, 0.44], lP: [0.5, 0.3, 0.5], sw: PALM,
  rF: [-0.22, ANK, -0.5], lF: [0.2, ANK, 0.6], rK: [-0.2, -0.3, 0.9], lK: [0.3, 0, 1], rFy: -0.2, lFy: 0.15,
};

// ---------------------------------------------------------------- the brake (the owner's v04 pack: A12 deep stop, B4 brake)
/** The deep planted stop at the end of every dash: sunk very low, the lead (left) leg far out in front and
 *  bent, its sole flat on the plates, the rear leg stretched straight back, the torso pitched over the lead
 *  knee, the left hand down to the floor by the lead foot, the right arm back for balance, the head up on
 *  the hero. */
const boBrake = {
  bY: -0.56, bZ: 0.1, pitch: 0.46, yaw: -0.42, hip: -0.1, spY: -0.04, hdX: -0.34,
  lF: [0.26, ANK, 0.66], lK: [0.4, 0, 0.9], rF: [-0.3, ANK, -0.78], rK: [-0.3, -0.4, 0.8], lFy: 0.2, rFy: -0.8, flat: 1,
  lH: [0.12, -0.58, 0.28], lP: [0.9, -0.2, 0.2], rH: [-0.2, -0.22, -0.26], rP: [-0.8, 0.2, -0.4], sw: PALM,
};

// ---------------------------------------------------------------- the footwork's layers (saint.js reads them)
/** The brake as a footwork layer (pilot.fsBrakeK): the deep stop's channels, absolute. */
export const BO_BRAKE_LAYER = boBrake;
/** The jet step's lean (the loco pose layered by d.pilot.fsDashK): pitched into the dash, the arms swept
 *  back, the legs together behind him (body / foot deltas, not a whole pose). */
export const BO_DASH_LAYER = Object.freeze({ pitch: 0.42, bodyY: -0.18, spX: 0.1, hdX: -0.3, rH: [-0.12, -0.3, -0.3], lH: [0.12, -0.3, -0.3], rP: [-0.6, 0.2, -0.8], lP: [0.6, 0.2, -0.8] });
/** The hover (d.pilot.fsHoverK, phase 3 on): the legs together and straight under him, the toes down. */
export const BO_HOVER_LAYER = Object.freeze({ rF: [-0.1, 0.06, -0.02], lF: [0.1, 0.04, 0.04], rK: [-0.1, 0, 1], lK: [0.1, 0, 1], flat: 0.25 });

/** His footwork pose (the kit's `loco`, after the body's): the jet step's lean by pilot.fsDashK, the
 *  hover's set legs by pilot.fsHoverK (saint.js wraps FS_POSES.loco with this). */
export function boostLoco(p, pl) {
  const h = Math.min(1, Math.max(0, Number(pl?.fsHoverK) || 0));
  if (h > 0.01) {
    const H = BO_HOVER_LAYER;
    to3(p, P.rF, H.rF[0], H.rF[1] + ANK, H.rF[2], h);
    to3(p, P.lF, H.lF[0], H.lF[1] + ANK, H.lF[2], h);
    to3(p, P.rK, H.rK[0], H.rK[1], H.rK[2], h);
    to3(p, P.lK, H.lK[0], H.lK[1], H.lK[2], h);
    p[P.footFlat] += (H.flat - p[P.footFlat]) * h;
  }
  const k = Math.min(1, Math.max(0, Number(pl?.fsDashK) || 0));
  if (k > 0.01) {
    const L = BO_DASH_LAYER;
    p[P.pitch] += L.pitch * k;
    p[P.bodyY] += L.bodyY * k;
    p[P.spX] += L.spX * k;
    p[P.hdX] += L.hdX * k;
    to3(p, P.rH, L.rH[0], L.rH[1], L.rH[2], k);
    to3(p, P.lH, L.lH[0], L.lH[1], L.lH[2], k);
    to3(p, P.rP, L.rP[0], L.rP[1], L.rP[2], k);
    to3(p, P.lP, L.lP[0], L.lP[1], L.lP[2], k);
    // (the legs together behind him: the thrust carries him, nothing runs)
    to3(p, P.rF, -0.1, ANK + 0.12, -0.3, k);
    to3(p, P.lF, 0.1, ANK + 0.08, -0.22, k);
  }
  const b = Math.min(1, Math.max(0, Number(pl?.fsBrakeK) || 0));
  if (b > 0.01) {
    const L = BO_BRAKE_LAYER;
    for (const [i, v] of [[P.bodyY, L.bY], [P.bodyZ, L.bZ], [P.pitch, L.pitch], [P.yaw, L.yaw], [P.pelvY, L.hip], [P.spY, L.spY], [P.hdX, L.hdX], [P.footFlat, L.flat], [P.lFy, L.lFy], [P.rFy, L.rFy]]) p[i] += (v - p[i]) * b;
    for (const [i, v] of [[P.lF, L.lF], [P.rF, L.rF], [P.lK, L.lK], [P.rK, L.rK], [P.lH, L.lH], [P.rH, L.rH], [P.lP, L.lP], [P.rP, L.rP]]) to3(p, i, v[0], v[1], v[2], b);
  }
}

export const FRAGS = Object.freeze({
  boVoCoil, boVoFist, boVoOver,
  boRoCoil, boRoHigh, boRoMid, boRoLow, boRoWind, boRoLast,
  boLift, boHang, boDive, boLand,
  boElCoil, boElHit, boKiCoil, boKiHit,
  boVeSet, boVePass, boVeDive,
  boRiWhine, boRiHug, boBrake,
});
export const CLIPS = Object.freeze({});
export const REACT = Object.freeze({});
export const OPEN = Object.freeze([]);
