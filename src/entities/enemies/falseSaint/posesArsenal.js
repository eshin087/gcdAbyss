import { DIM } from '../../player/model.js';

// The False Saint's arsenal pose fragments and reaction clips (the ARSENAL AGENT's file). Merged by poses.js
// (the router: its header has the rule). EVERY NAME HERE STARTS WITH `ar` (fragments and clips
// alike), so it never meets a name of the body's poses.js (unprefixed) or another moves file's (ml / bo /
// ar / tr). Do not import poses.js from here (a cycle).
// Exports: FRAGS { arName: pose } · CLIPS { arName: { dur, hold?, keys: [[t, pose], ...] } } ·
//          REACT { arName: { travel, side? } } · OPEN [arName, ...] (clips that leave him open)
// (Body space: +x his LEFT, +y up, +z forward; hands offsets from each shoulder (|offset| <= 0.55: 0.54 is
// the arm straight), feet model space [x, y, z]; `sw` [az, el] the right hand's turn.)
//
// THE FRAGMENTS ARE PARTIAL: only the channels a pose changes from his guard (ref-02 row 3: wide, low, both
// open hands raised). moves/arsenal.js lays each over the body's STAND with W() (which turns the head back
// onto the hero unless the fragment turns it), so every shot starts from the guard and goes back to it.
// The rules they keep (the TASK; docs/ANIMATION.md): the AIM is a locked straight arm (or the head, for
// the eye) held through the tell; the body is BRACED against the recoil (the feet wider and planted, the
// rear leg straight, the weight forward into the shot); no wobble: the held poses do not move, a recoil is
// one short kick of the hand and the shoulders, then the brace again.

const ANK = DIM.ankle;
const PALM = Object.freeze([0, 1.45]); // the hand open, fingers up (the palm's iris faces the hero)
const GUN = Object.freeze([0, 0.55]); // the hand half-closed, the forearm's gun along it

// ---------------------------------------------------------------- VIGIL (the eye)
/** The eye's aim: square to the hero, the head dropped onto the floor line in front of him, the hands up
 *  in the guard, the feet set wide (the laser is his eye: the body is the tripod). */
const arEye = {
  bY: -0.24, yaw: -0.12, pitch: 0.06, hip: -0.02, spX: 0.04, hdX: 0.3,
  rH: [0.06, -0.04, 0.24], lH: [-0.02, 0.0, 0.34],
  rF: [-0.37, ANK, -0.22], lF: [0.34, ANK, 0.22], rK: [-0.66, 0, 0.76], lK: [0.6, 0, 0.8],
};
/** The cut: the head lower still along the line, the shoulders set (the sweep is the head's). */
const arEyeCut = { ...arEye, hdX: 0.4, spX: 0.06, bY: -0.27 };

// ---------------------------------------------------------------- ABSOLUTION (the palm cannon)
/** The draw: the right palm drawn back to the hip, open and forward (its iris charging), the left hand
 *  out before him, the weight back. */
const arPalmDraw = {
  bY: -0.26, bZ: -0.04, pitch: 0.06, yaw: -0.5, hip: -0.1, spY: -0.04,
  rH: [0.04, -0.2, -0.04], rP: [-0.7, -0.4, -0.6], lH: [-0.04, 0.0, 0.42], lP: [0.9, -0.4, -0.1], sw: PALM,
  rF: [-0.32, ANK, -0.3], lF: [0.3, ANK, 0.3], rK: [-0.6, 0, 0.8], lK: [0.5, 0, 0.86],
};
/** The aim (held through the beam): the right arm LOCKED straight at the hero, the palm open forward, the
 *  left hand clamped on the right forearm (the brace), the rear leg straight, the weight forward. */
const arPalmAim = {
  bY: -0.27, bZ: 0.08, pitch: 0.1, yaw: 0.08, hip: 0.06, spY: 0.02,
  rH: [0.12, 0.06, 0.54], rP: [-0.9, -0.3, -0.2], lH: [-0.32, 0.0, 0.36], lP: [0.6, -0.6, 0.1], sw: PALM,
  rF: [-0.3, ANK, -0.52], lF: [0.3, ANK, 0.42], rK: [-0.3, -0.2, 0.95], lK: [0.5, 0, 0.86], rFy: -0.3, lFy: 0.2,
};

// ---------------------------------------------------------------- TRIPTYCH (the forearm gun)
/** The gun out: the right forearm raised straight at the hero (the gun along it, the hand half-closed),
 *  the left hand up at the chin, side-on, braced. */
const arGun = {
  bY: -0.22, yaw: -0.62, hip: -0.12, spY: -0.06, pitch: 0.04,
  rH: [0.14, 0.1, 0.54], rP: [-0.9, -0.1, -0.3], lH: [-0.08, 0.06, 0.24], lP: [0.9, -0.3, 0], sw: GUN,
  rF: [-0.3, ANK, -0.36], lF: [0.3, ANK, 0.3], rK: [-0.5, 0, 0.86], lK: [0.5, 0, 0.86], rFy: -0.8, lFy: 0.1,
};
/** A bolt's recoil: the forearm kicked up and back a hand's breadth, the shoulders with it (one frame of
 *  it at the shot; the brace takes it back). */
const arGunKick = { ...arGun, rH: [0.12, 0.16, 0.46], spX: -0.05, bZ: -0.03 };

// ---------------------------------------------------------------- CHOIR (the missile swarm)
/** The petals open: the chest up and the shoulders drawn back (the cells on them face the sky), the open
 *  hands down and a little out, the head up, the feet wide. */
const arChoir = {
  bY: -0.2, pitch: -0.16, yaw: -0.04, spX: -0.12, hdX: -0.24,
  rH: [-0.12, -0.38, 0.0], rP: [-0.9, 0, 0.3], lH: [0.12, -0.38, 0.0], lP: [0.9, 0, 0.3], sw: PALM,
  rF: [-0.36, ANK, -0.12], lF: [0.36, ANK, 0.14], rK: [-0.6, 0, 0.8], lK: [0.6, 0, 0.8],
};
/** The launch: braced against the salvo, the chest thrown up harder for a moment. */
const arChoirFire = { ...arChoir, pitch: -0.24, spX: -0.16, bY: -0.24, hdX: -0.18 };

// ---------------------------------------------------------------- PASSING BELL (the strafing pass)
/** The hang before the pass: up on the back thrusters, rigid, pitched toward his line, the legs together
 *  and straight under and behind him, the arms set back along his sides, the head down on the floor. */
const arBellHang = {
  bY: -0.02, pitch: 0.34, yaw: 0, hip: 0, spX: 0, spY: 0, hdX: 0.5,
  rH: [-0.08, -0.46, -0.22], rP: [-0.9, 0, 0.2], lH: [0.08, -0.46, -0.22], lP: [0.9, 0, 0.2], sw: PALM,
  rF: [-0.09, 0.16, -0.32], lF: [0.09, 0.16, -0.3], rK: [-0.1, -0.4, 1], lK: [0.1, -0.4, 1], rFy: -0.05, lFy: 0.05, flat: 0.2,
};
/** The pass: laid out flat along his line, the legs trailing straight, the head down on the cut. */
const arBellPass = {
  ...arBellHang, pitch: 0.62, hdX: 0.55, bY: -0.06,
  rF: [-0.09, 0.42, -0.62], lF: [0.09, 0.44, -0.6], rK: [-0.1, -0.8, 0.4], lK: [0.1, -0.8, 0.4],
  rH: [-0.08, -0.4, -0.32], lH: [0.08, -0.4, -0.32],
};
/** The landing at the line's end: down on the planted feet, a hand down. */
const arBellLand = {
  bY: -0.44, pitch: 0.24, yaw: -0.06, hdX: 0.06,
  rF: [-0.34, ANK, -0.4], lF: [0.3, ANK, 0.36], rK: [-0.6, 0, 0.8], lK: [0.5, 0, 0.86],
  rH: [0.06, -0.5, 0.3], lH: [-0.04, -0.02, 0.32],
};

// ---------------------------------------------------------------- KYRIE (the mortar)
/** The tubes on his back raised: down in a deep brace, the torso pitched forward so the tubes point at the
 *  sky over his shoulders, the hands open before his knees, the head up on the hero. */
const arMortar = {
  bY: -0.42, bZ: 0.02, pitch: 0.34, yaw: -0.08, spX: 0.06, hdX: -0.26,
  rH: [0.04, -0.4, 0.3], rP: [-0.8, -0.5, 0], lH: [-0.04, -0.4, 0.32], lP: [0.8, -0.5, 0], sw: PALM,
  rF: [-0.4, ANK, -0.24], lF: [0.38, ANK, 0.24], rK: [-0.78, 0, 0.62], lK: [0.74, 0, 0.66],
};
/** A salvo: the whole body driven down an inch by the tubes' kick. */
const arMortarFire = { ...arMortar, bY: -0.47, pitch: 0.38 };

// ---------------------------------------------------------------- VERDICT (the sky lance)
/** The call: the right arm raised STRAIGHT to the sky, the palm open, the left hand at his chest, the head
 *  back, looking up (the reticle walks after the hero below). */
const arLanceUp = {
  bY: -0.16, pitch: -0.08, yaw: -0.14, spX: -0.06, hdX: -0.42,
  rH: [0.04, 0.54, 0.06], rP: [-0.9, 0.1, -0.2], lH: [-0.12, -0.08, 0.2], lP: [0.9, -0.4, 0], sw: PALM,
  rF: [-0.3, ANK, -0.16], lF: [0.3, ANK, 0.18],
};
/** The lock: the arm brought down onto the hero, straight, the palm on him. */
const arLanceDown = {
  bY: -0.24, pitch: 0.08, yaw: 0.0, spX: 0.02, hdX: 0.1,
  rH: [0.12, 0.02, 0.54], rP: [-0.9, -0.3, -0.2], lH: [-0.1, -0.06, 0.22], lP: [0.9, -0.4, 0], sw: PALM,
  rF: [-0.32, ANK, -0.4], lF: [0.3, ANK, 0.34], rK: [-0.4, -0.1, 0.9], lK: [0.5, 0, 0.86],
};

// ---------------------------------------------------------------- REVELATION (the full burst)
/** The gather: both palms drawn back to the hips (their irises charging), the chest open, the core lit,
 *  the feet planted wide. */
const arBurstDraw = {
  bY: -0.3, pitch: -0.04, yaw: -0.04, spX: -0.06, hdX: 0.04,
  rH: [0.06, -0.2, -0.06], rP: [-0.7, -0.4, -0.6], lH: [-0.06, -0.2, -0.06], lP: [0.7, -0.4, -0.6], sw: PALM,
  rF: [-0.38, ANK, -0.3], lF: [0.36, ANK, 0.3], rK: [-0.7, 0, 0.7], lK: [0.66, 0, 0.74],
};
/** The twin beams: both arms locked straight forward, the palms open on the hero, braced low. */
const arBurstTwin = {
  ...arBurstDraw, bY: -0.32, bZ: 0.06, pitch: 0.08, spX: 0.02,
  rH: [0.16, 0.04, 0.52], rP: [-0.9, -0.3, -0.2], lH: [-0.16, 0.04, 0.52], lP: [0.9, -0.3, -0.2],
};
/** The core cannon: the arms flung wide and back, the chest thrown forward at the hero (the core slit is
 *  the gun), the rear leg straight against it. */
const arBurstCore = {
  ...arBurstDraw, bY: -0.3, bZ: 0.04, pitch: -0.1, spX: -0.14, hdX: 0.14,
  rH: [-0.4, -0.06, -0.12], rP: [-0.9, 0.2, -0.3], lH: [0.4, -0.06, -0.12], lP: [0.9, 0.2, -0.3],
  rF: [-0.36, ANK, -0.5], lF: [0.34, ANK, 0.38], rK: [-0.3, -0.2, 0.95], lK: [0.6, 0, 0.8],
};

export const FRAGS = Object.freeze({
  arEye, arEyeCut, arPalmDraw, arPalmAim, arGun, arGunKick, arChoir, arChoirFire, arBellHang, arBellPass, arBellLand,
  arMortar, arMortarFire, arLanceUp, arLanceDown, arBurstDraw, arBurstTwin, arBurstCore,
});
export const CLIPS = Object.freeze({});
export const REACT = Object.freeze({});
export const OPEN = Object.freeze([]);
