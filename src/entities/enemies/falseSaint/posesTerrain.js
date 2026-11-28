import { DIM } from '../../player/model.js';

// The False Saint's terrain pose fragments and reaction clips (the TERRAIN AGENT's file). Merged by poses.js
// (the router: its header has the rule). EVERY NAME HERE STARTS WITH `tr` (fragments and clips
// alike), so it never meets a name of the body's poses.js (unprefixed) or another moves file's (ml / bo /
// ar / tr). Do not import poses.js from here (a cycle): these are PARTIAL channel objects laid over the
// body's STAND (his guard, ref-02 row 3) by moves/terrain.js (`P(frag)`: the stance's every field, then the
// fragment's, the head turned back onto the hero unless the fragment turns it). Every move of the file
// leaves the guard and comes back to it (its recovery's last key is the guard).
// Exports: FRAGS { trName: pose } · CLIPS { trName: { dur, hold?, keys: [[t, pose], ...] } } ·
//          REACT { trName: { travel, side? } } · OPEN [trName, ...] (clips that leave him open)
// (Body space as ascendant/moves.js: +x his LEFT, +y up, +z forward; hands offsets from each shoulder
// (|offset| <= 0.55), feet model space [x, y, z]; `sw` [az, el] turns the right hand: el ~1.4 the fingers up,
// the palm flat; el ~0.2 the fingers forward, a hand that takes hold.)
//
// THE FETCH (Relic, Offertory): trCrouch (the jets' load: sunk over the front knee, the arms drawn back) →
// trJet (the hop: pitched forward hard behind the calf and back jets, the feet trailing, the arms swept back)
// → the planted stop (posesBoost.js boBrake: the v04 pack's A12 deep stop) → trGrip (wide and low over the
// piece, bent at the hips, both open hands down on it).
// THE THROW (Relic): trHoist (the piece overhead, the arms up, wide) → trWind (drawn back behind the head,
// the chest open: the held blue read) → trHurl (pitched forward, the arms driven down at the hero, the rear
// foot pushing off).
// THE KICK (Offertory): trKickCoil (the right knee chambered high and turned in, the calf jet lit) → trKick
// (the leg driven straight out low through the tank, the body leaning back off it).
// THE GUN (Crucible, Dies Irae): trAim (the right forearm raised straight at its mark, the head down the
// arm) → trShot (the arm kicked up by the shot).
// THE SIGN (Prostration): trSign (his eye cuts the column's foot: the chin down to it, the right hand raised
// open beside his face, two fingers up: a blessing).
const ANK = DIM.ankle;

export const FRAGS = Object.freeze({
  trCrouch: Object.freeze({
    bY: -0.36, bZ: 0.04, pitch: 0.24, yaw: -0.06, spX: 0.06, hdX: -0.14,
    rH: [-0.1, -0.3, -0.12], rP: [-0.8, -0.5, -0.3], lH: [0.1, -0.3, -0.1], lP: [0.8, -0.5, -0.3], sw: [0, 0.6],
    rF: [-0.26, ANK, -0.3], lF: [0.24, ANK, 0.18], rK: [-0.7, 0, 0.7], lK: [0.7, 0, 0.7], flat: 1,
  }),
  trJet: Object.freeze({
    bY: -0.1, bZ: 0.08, pitch: 0.44, yaw: 0, spX: 0.1, hdX: -0.32,
    rH: [-0.12, -0.36, -0.22], rP: [-0.8, -0.3, -0.5], lH: [0.12, -0.36, -0.22], lP: [0.8, -0.3, -0.5], sw: [0, 0.4],
    rF: [-0.14, 0.26, -0.44], lF: [0.14, 0.12, -0.12], rK: [-0.3, 0, 1], lK: [0.3, 0, 1], flat: 0.4,
  }),
  trGrip: Object.freeze({
    bY: -0.42, bZ: 0.06, pitch: 0.38, yaw: 0, hdX: -0.22, spX: 0.04,
    rH: [0.1, -0.38, 0.36], rP: [-0.8, -0.4, 0.1], lH: [-0.1, -0.38, 0.36], lP: [0.8, -0.4, 0.1], sw: [0, 0.2],
    rF: [-0.34, ANK, -0.12], lF: [0.34, ANK, 0.18], rK: [-0.75, 0, 0.66], lK: [0.75, 0, 0.66], flat: 1,
  }),
  trHoist: Object.freeze({
    bY: -0.16, pitch: -0.08, yaw: -0.1, hdX: -0.14,
    rH: [0.12, 0.46, 0.12], rP: [-0.8, 0.2, -0.4], lH: [-0.12, 0.46, 0.12], lP: [0.8, 0.2, -0.4], sw: [0, 1.3],
    rF: [-0.3, ANK, -0.3], lF: [0.28, ANK, 0.22], rK: [-0.55, 0, 0.83], lK: [0.5, 0, 0.86], flat: 1,
  }),
  trWind: Object.freeze({
    bY: -0.2, bZ: -0.04, pitch: -0.2, yaw: -0.2, spX: -0.1, hdX: 0.02,
    rH: [0.1, 0.42, -0.22], rP: [-0.8, 0.3, -0.5], lH: [-0.1, 0.42, -0.22], lP: [0.8, 0.3, -0.5], sw: [0, 1.2],
    rF: [-0.3, ANK, -0.44], lF: [0.3, ANK, 0.36], rK: [-0.5, 0, 0.86], lK: [0.5, 0, 0.86], flat: 1,
  }),
  trHurl: Object.freeze({
    bY: -0.3, bZ: 0.16, pitch: 0.34, yaw: 0.06, spX: 0.1, hdX: -0.24,
    rH: [0.1, -0.05, 0.5], rP: [-0.8, -0.4, -0.2], lH: [-0.1, -0.05, 0.5], lP: [0.8, -0.4, -0.2], sw: [0, 0.6],
    rF: [-0.28, ANK, -0.62], lF: [0.3, ANK, 0.52], rFy: -0.2, rK: [-0.2, -0.3, 0.9], lK: [0.45, 0, 0.9], flat: 0.85,
  }),
  trKickCoil: Object.freeze({
    bY: -0.12, pitch: -0.06, yaw: -0.5, hip: -0.2, spX: -0.04,
    rH: [0.08, -0.04, 0.28], rP: [-0.9, -0.4, -0.2], lH: [-0.04, 0.0, 0.36], lP: [0.9, -0.4, -0.1], sw: [0, 1.3],
    rF: [-0.12, 0.5, 0.14], rK: [-0.4, 0.7, 0.8], lF: [0.16, ANK, 0.04], lFy: 0.6, lK: [0.4, 0, 0.9], flat: 1,
  }),
  trKick: Object.freeze({
    bY: -0.1, pitch: -0.22, yaw: -0.2, hip: 0.1, spX: -0.12, hdX: 0.08,
    rH: [0.12, -0.02, 0.2], rP: [-0.9, -0.3, -0.3], lH: [-0.12, 0.04, 0.3], lP: [0.9, -0.3, -0.2], sw: [0, 1.3],
    rF: [-0.1, 0.32, 0.78], rK: [-0.2, 0.2, 1], lF: [0.16, ANK, -0.1], lFy: 0.4, lK: [0.4, 0, 0.9], flat: 1,
  }),
  trAim: Object.freeze({
    bY: -0.16, pitch: -0.04, yaw: 0.08, spY: 0.04, hdX: -0.18, hdY: 0.02,
    rH: [0.06, 0.3, 0.46], rP: [-0.9, -0.2, -0.2], sw: [0, 0.6], lH: [-0.04, -0.06, 0.32], lP: [0.9, -0.45, -0.1],
    rF: [-0.32, ANK, -0.24], lF: [0.3, ANK, 0.22],
  }),
  trShot: Object.freeze({
    bY: -0.15, pitch: -0.08, yaw: 0.06, spY: 0.04, spX: -0.04, hdX: -0.24, hdY: 0.02,
    rH: [0.06, 0.4, 0.38], rP: [-0.9, -0.1, -0.3], sw: [0, 0.7], lH: [-0.04, -0.06, 0.32], lP: [0.9, -0.45, -0.1],
    rF: [-0.32, ANK, -0.26], lF: [0.3, ANK, 0.22],
  }),
  trSign: Object.freeze({
    bY: -0.12, pitch: 0.02, yaw: -0.1, hdX: 0.2, hdY: 0.0,
    rH: [0.02, 0.26, 0.18], rP: [-0.9, 0.1, -0.3], sw: [0, 1.45], lH: [-0.06, -0.2, 0.22], lP: [0.9, -0.5, -0.1],
    rF: [-0.3, ANK, -0.22], lF: [0.28, ANK, 0.2],
  }),
});
export const CLIPS = Object.freeze({});
export const REACT = Object.freeze({});
export const OPEN = Object.freeze([]);
