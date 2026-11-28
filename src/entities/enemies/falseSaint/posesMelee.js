import { DIM } from '../../player/model.js';

// The False Saint's melee pose fragments and reaction clips (the MELEE AGENT's file). Merged by poses.js
// (the router: its header has the rule). EVERY NAME HERE STARTS WITH `ml` (fragments and clips
// alike), so it never meets a name of the body's poses.js (unprefixed) or another moves file's (ml / bo /
// ar / tr). Do not import poses.js from here (a cycle): these are PARTIAL channel objects, laid over the
// body's STAND by moves/melee.js (`S(frag)`: the stance's every field, then the fragment's, the head
// turned back onto the opponent).
// Exports: FRAGS { mlName: pose } · CLIPS { mlName: { dur, hold?, keys: [[t, pose], ...] } } ·
//          REACT { mlName: { travel, side? } } · OPEN [mlName, ...] (clips that leave him open)
// (Body space as ascendant/moves.js: +x his LEFT, +y up, +z forward; hands offsets from each shoulder
// (|offset| <= 0.55), feet model space [x, y, z]; `sw` [az, el] turns the right hand (it hangs on the
// sword joint: el 1.3 - 1.45 the fingers up, the palm flat at the opponent; el ~0.2 the fingers forward,
// a hand that takes hold).)
//
// THE HOUSE STANCE AND THE HOUSE RHYTHM (the owner's second reference sheet, ref-02):
//   his guard is the body's (poses.js GUARD: the wide, low, open-handed stance of row 3, every phase);
//   row 2 is BENEDICTION's palm and his signature rhythm, five panels, five fragments:
//     01 READY GUARD          the body's STAND
//     02 DELAYED PIVOT        mlPivot   the weight turns away onto the rear leg, the lead hand drops, the
//                                       right palm drawn back low by the hip: a held, readable coil
//     03 ADVANCING PALM       mlLunge   a long low lunge, the rear leg straight, the striking arm fully
//                                       out, the palm flat and the fingers up
//     04 HEEL PLANT & CATCH   mlCatch   the front heel planted, the hands back up into the guard, the
//                                       stance still long
//     05 RESET                the body's STAND
//   An upright spine everywhere (pitch <= 0.16 but for the gavel, which must reach the floor), open hands
//   (palms, hand-heels, fingertips, elbows: no fist), straight limbs at the contact, no flourish; he does
//   not bounce or heave: between the keys he is still.
const ANK = DIM.ankle;

// ---------------------------------------------------------------- the open palms (Benediction, Litany)
/** The lead (left) palm drawn back a hand's breadth, the weight settling on the rear leg. */
const mlPalmLCoil = { yaw: -0.42, bY: -0.17, bZ: -0.03, lH: [0.0, -0.04, 0.22], lP: [0.9, -0.4, -0.1], rH: [0.06, -0.1, 0.24] };
/** The lead palm snapped straight out on the centre line, the lead foot stepping in. */
const mlPalmL = {
  yaw: -0.55, bY: -0.19, bZ: 0.12, spY: -0.04, lH: [-0.1, 0.0, 0.55], lP: [0.8, -0.2, -0.4], rH: [0.08, -0.12, 0.2],
  lF: [0.22, ANK, 0.42], lFy: 0.2,
};
/** The right palm drawn back to the ribs, the hips loaded away. */
const mlPalmRCoil = { yaw: -0.55, bY: -0.17, hip: -0.1, rH: [0.0, -0.16, 0.1], rP: [-0.85, -0.5, -0.4], lH: [-0.02, -0.04, 0.36], sw: [0, 1.3] };
/** The right palm driven straight through, the rear foot turning over. */
const mlPalmR = {
  yaw: 0.18, bY: -0.2, bZ: 0.14, hip: 0.14, spY: 0.06, rH: [0.14, -0.02, 0.55], rP: [-0.8, -0.3, -0.4], lH: [-0.02, -0.1, 0.16], sw: [0, 1.32],
  rF: [-0.2, ANK, -0.1], rFy: 0.05, lF: [0.24, ANK, 0.3],
};

// ---------------------------------------------------------------- row 2: the delayed pivot, the lunge, the catch
const mlPivot = {
  yaw: -0.86, bY: -0.25, bZ: -0.06, pitch: 0.04, hip: -0.18, spY: -0.06, spX: 0.03,
  rH: [-0.02, -0.26, 0.04], rP: [-0.8, -0.5, -0.5], sw: [0.2, 1.1], lH: [0.08, -0.36, 0.22], lP: [0.85, -0.5, 0.1],
  rF: [-0.27, ANK, -0.22], lF: [0.24, ANK, 0.2], rK: [-0.6, 0, 0.8], lK: [0.5, 0, 0.85], flat: 1,
};
const mlLunge = {
  yaw: 0.32, bY: -0.34, bZ: 0.2, pitch: 0.12, hip: 0.2, spY: 0.08,
  rH: [0.1, 0.03, 0.55], rP: [-0.85, -0.25, -0.4], sw: [0, 1.35], lH: [-0.08, -0.16, 0.08], lP: [0.9, -0.5, -0.3],
  lF: [0.26, ANK, 0.72], lFy: 0.1, rF: [-0.26, ANK, -0.62], rFy: -0.2, rK: [-0.15, -0.4, 0.9], lK: [0.4, 0, 0.9], flat: 0.9,
};
const mlCatch = {
  yaw: -0.36, bY: -0.27, bZ: 0.06, pitch: 0.06, hip: 0.02,
  rH: [0.04, -0.1, 0.3], rP: [-0.9, -0.4, -0.2], sw: [0, 1.4], lH: [-0.02, -0.06, 0.4], lP: [0.9, -0.4, -0.1],
  lF: [0.26, ANK, 0.62], lFy: 0.15, rF: [-0.26, ANK, -0.6], rFy: -0.35, rK: [-0.4, -0.1, 0.9], lK: [0.45, 0, 0.9], flat: 1,
};

// ---------------------------------------------------------------- the owner's v04 pack, page B (PACK-V04.md)
// B1 PALM (an advancing RIGHT open palm, one forward step): Benediction's second beat (and the Long Walk's
// straight is the same palm out of the walk). B1.1 anticipation = mlB1Coil (the weight back on the rear leg,
// the right palm drawn to the ribs, the lead hand low before him), B1.2 contact = mlLunge (above: the long
// low step, the rear leg straight, the arm fully out, the palm flat), B1.3 follow-through = the strike's
// follow (the hand eased a little back), B1.4 return = the guard.
const mlB1Coil = {
  yaw: -0.62, bY: -0.19, bZ: -0.06, pitch: 0.04, hip: -0.12, spY: -0.04, rH: [0.0, -0.14, 0.06], rP: [-0.85, -0.5, -0.4], sw: [0, 1.3], lH: [-0.02, -0.1, 0.34], lP: [0.9, -0.4, -0.1],
  rF: [-0.32, ANK, -0.24], lF: [0.3, ANK, 0.2], rK: [-0.6, 0, 0.8], lK: [0.5, 0, 0.85],
};
// B2 PIVOT (A11 the delayed turn; a DELAYED 90-degree turn, then an abrupt LEFT palm): Benediction's last
// beat, the held blue read. B2.1 anticipation = mlB2Turn (sunk, the body turned away a quarter turn on the
// planted feet, the left palm drawn back low by the hip, the right hand across before the chest: HELD through
// the bait delay), B2.2 contact = mlB2Palm (the left arm straight out at the hero, the left foot stepped long,
// the right leg straight behind), B2.3 follow-through = mlB2Follow, B2.4 return = mlCatch (the heel planted,
// the hands caught back up: the recovery's key) and the guard.
const mlB2Turn = {
  yaw: 0.9, bY: -0.3, bZ: -0.04, pitch: 0.06, hip: 0.2, spY: 0.08, spX: 0.03,
  lH: [0.06, -0.26, 0.02], lP: [0.85, -0.5, -0.5], rH: [0.12, -0.06, 0.3], rP: [-0.9, -0.4, -0.2], sw: [0.3, 1.2],
  rF: [-0.3, ANK, -0.18], lF: [0.3, ANK, 0.16], rFy: 0.35, lFy: 0.95, rK: [-0.6, 0, 0.8], lK: [0.55, 0, 0.8], flat: 1,
};
const mlB2Palm = {
  yaw: -0.72, bY: -0.34, bZ: 0.22, pitch: 0.12, hip: -0.2, spY: -0.08,
  lH: [-0.1, 0.03, 0.55], lP: [0.85, -0.25, -0.4], rH: [0.08, -0.16, 0.1], rP: [-0.85, -0.5, -0.4], sw: [0, 1.2],
  lF: [0.3, ANK, 0.76], lFy: 0.15, rF: [-0.28, ANK, -0.6], rFy: -0.3, rK: [-0.15, -0.4, 0.9], lK: [0.45, 0, 0.9], flat: 0.9,
};
const mlB2Follow = { ...mlB2Palm, bZ: 0.18, lH: [-0.06, 0.0, 0.47], rH: [0.06, -0.12, 0.16] };

// ---------------------------------------------------------------- Genuflect: the low sweep, the rising knee
const mlSweepCoil = {
  yaw: -0.05, bY: -0.42, pitch: 0.12, hdX: 0.1, rH: [0.06, -0.2, 0.24], lH: [0.02, -0.18, 0.32],
  rF: [-0.28, ANK, -0.2], lF: [0.52, ANK + 0.05, 0.1], lFy: 0.6, rK: [-0.7, 0, 0.7], lK: [0.85, 0.25, 0.45], flat: 0.85,
};
const mlSweep = {
  yaw: -0.72, bY: -0.46, pitch: 0.14, hdX: 0.1, rH: [0.06, -0.22, 0.22], lH: [0.06, -0.2, 0.3],
  rF: [-0.28, ANK, -0.2], lF: [-0.06, ANK + 0.06, 0.64], lFy: -0.4, rK: [-0.7, 0, 0.7], lK: [0.3, 0.3, 0.9], flat: 0.85,
};
/** Both open hands reaching for the head (the blue hold): the knee is coming. */
const mlKneeCoil = {
  yaw: -0.2, bY: -0.18, bZ: 0.04, pitch: 0.04, rH: [0.12, 0.1, 0.42], rP: [-0.7, -0.2, -0.3], lH: [-0.12, 0.1, 0.44], lP: [0.7, -0.2, -0.3], sw: [0.3, 0.6],
  rF: [-0.22, ANK, -0.3], lF: [0.2, ANK, 0.22], rK: [-0.4, 0, 0.9],
};
const mlKnee = {
  yaw: -0.08, bY: -0.05, bZ: 0.12, pitch: -0.04, rH: [0.12, -0.08, 0.42], lH: [-0.12, -0.08, 0.44], sw: [0.3, 0.2],
  rF: [-0.08, 0.5, 0.24], rK: [0, 0.7, 1], lF: [0.18, ANK, 0.1], lFy: 0.1, flat: 0.9,
};

// ---------------------------------------------------------------- the elbow (Rebuke, Anathema, Requiem)
// B3 SLIP (a lateral evasive step, a precise reset): Rebuke. B3.1 anticipation = the guard; B3.2 the slip =
// mlSlip (stepped off the line to his left, low, the lead hand out low, the right elbow folded and chambered;
// the beat's `fsSlip` carries the root sideways), contact = mlElbow (the short elbow), B3.3 follow-through =
// its follow, B3.4 return = the guard.
/** The slip: off the line to his left, low, the right elbow folded and chambered. */
const mlSlip = {
  yaw: -0.62, bY: -0.32, bX: 0.08, roll: 0.09, pitch: 0.08, hip: -0.12, rH: [0.06, 0.04, 0.1], rP: [-0.6, 0.1, 0.8], sw: [1.2, 0.3], lH: [-0.02, -0.16, 0.4], lP: [0.8, -0.6, -0.1],
  rF: [-0.3, ANK, -0.2], lF: [0.38, ANK, 0.12], rK: [-0.7, 0, 0.7], lK: [0.7, 0, 0.7],
};
const mlElbow = {
  yaw: 0.74, bY: -0.25, bZ: 0.14, hip: 0.2, rH: [0.3, 0.1, 0.1], rP: [-0.4, 0.15, 1], sw: [1.3, 0.2], lH: [0.02, -0.06, 0.2],
  rF: [-0.2, ANK, -0.1], rFy: 0.1, lF: [0.25, ANK, 0.36],
};

// ---------------------------------------------------------------- The Long Walk
/** The walk: upright, unhurried, the open hands low before him, the head level on the hero. Two
 *  steps (A: the left foot ahead, B: the right), keyed in turn under the root's close-in. */
const WALK = { yaw: -0.08, bY: -0.03, bZ: 0, pitch: 0.02, hip: 0, spX: 0, spY: 0, roll: 0, rH: [0.02, -0.34, 0.14], rP: [-0.9, -0.6, -0.1], lH: [-0.02, -0.32, 0.18], lP: [0.9, -0.6, -0.1], sw: [0.1, 0.6], rK: [-0.15, 0, 1], lK: [0.15, 0, 1], flat: 1 };
const mlWalkA = { ...WALK, lF: [0.13, ANK, 0.24], rF: [-0.13, ANK, -0.2], lFy: 0.08, rFy: -0.1 };
const mlWalkB = { ...WALK, yaw: 0.0, lF: [0.13, ANK, -0.2], rF: [-0.13, ANK, 0.24], lFy: 0.1, rFy: -0.08 };
/** The walk's last step plants wide, the right hand drawn to the ribs: the straight. */
const mlWalkCoil = {
  yaw: -0.5, bY: -0.16, hip: -0.12, rH: [0.0, -0.18, 0.06], rP: [-0.85, -0.5, -0.4], sw: [0, 1.2], lH: [-0.04, -0.04, 0.34],
  lF: [0.22, ANK, 0.3], rF: [-0.24, ANK, -0.22], rK: [-0.5, 0, 0.85], lK: [0.45, 0, 0.9],
};
const mlWalkHit = {
  yaw: 0.26, bY: -0.2, bZ: 0.16, hip: 0.18, spY: 0.04, rH: [0.1, 0.02, 0.55], rP: [-0.85, -0.25, -0.4], sw: [0, 1.3], lH: [-0.04, -0.1, 0.14],
  lF: [0.24, ANK, 0.46], rF: [-0.2, ANK, -0.18], rFy: 0.1,
};

// ---------------------------------------------------------------- Laying On of Hands
/** The red hold: sunk and coiled away, the right hand open and low, reaching. */
const mlReachCoil = {
  yaw: -0.72, bY: -0.32, bZ: -0.04, pitch: 0.1, hip: -0.14, rH: [-0.06, -0.12, 0.12], rP: [-0.85, -0.3, -0.4], sw: [0, 0.4], lH: [0.04, -0.06, 0.36],
  rF: [-0.3, ANK, -0.28], lF: [0.26, ANK, 0.22], rK: [-0.6, 0, 0.8], lK: [0.5, 0, 0.85],
};
/** The hand at the throat: the arm straight out, the fingers forward. */
const mlReach = {
  yaw: 0.2, bY: -0.2, bZ: 0.18, pitch: 0.06, hip: 0.14, rH: [0.1, 0.14, 0.55], rP: [-0.8, -0.2, -0.4], sw: [0, 0.2], lH: [-0.04, -0.1, 0.16],
  lF: [0.26, ANK, 0.52], rF: [-0.26, ANK, -0.3],
};
/** The lift: upright, the arm raised, the hero held up at arm's length (one hand). */
const mlLift = {
  yaw: 0.05, bY: -0.12, bZ: 0.04, pitch: -0.04, hip: 0.04, hdX: -0.12, rH: [0.08, 0.36, 0.42], rP: [-0.8, 0.2, -0.4], sw: [0, 0.5], lH: [-0.02, -0.14, 0.2],
  lF: [0.26, ANK, 0.36], rF: [-0.26, ANK, -0.3], rK: [-0.5, 0, 0.85], lK: [0.45, 0, 0.9],
};
/** The throw: the arm driven forward and down, the weight onto the front foot. */
const mlThrow = {
  yaw: 0.36, bY: -0.28, bZ: 0.18, pitch: 0.14, hip: 0.2, hdX: 0.06, rH: [0.12, -0.06, 0.55], rP: [-0.8, -0.2, -0.4], sw: [0, 0.0], lH: [-0.04, -0.12, 0.14],
  lF: [0.26, ANK, 0.56], rF: [-0.26, ANK, -0.34],
};

// ---------------------------------------------------------------- Interdict: the gavel
/** The right arm raised straight over his head, tall on the legs, the lead hand out at the hero. */
const mlGavelUp = {
  yaw: -0.2, bY: -0.06, pitch: -0.06, spX: -0.04, rH: [0.06, 0.5, 0.1], rP: [-0.7, 0.5, -0.4], sw: [0, 1.5], lH: [-0.04, 0.0, 0.42], lP: [0.8, -0.3, -0.2],
  rF: [-0.27, ANK, -0.2], lF: [0.24, ANK, 0.24],
};
/** The hand-heel brought down onto the plates before him: sunk wide, the arm straight. */
const mlGavel = {
  yaw: 0.1, bY: -0.52, bZ: 0.1, pitch: 0.34, spX: 0.12, hdX: 0.22, rH: [0.08, -0.32, 0.5], rP: [-0.7, -0.2, -0.3], sw: [0, -0.5], lH: [-0.08, -0.2, 0.2],
  rF: [-0.32, ANK, -0.26], lF: [0.3, ANK, 0.34], rK: [-0.8, 0, 0.6], lK: [0.7, 0, 0.7], flat: 0.9,
};

// ---------------------------------------------------------------- Cast Out: the double palm
/** Both palms drawn back to the ribs, sunk square (the blue hold). */
const mlDoubleCoil = {
  yaw: -0.12, bY: -0.32, bZ: -0.05, pitch: 0.05, rH: [0.06, -0.2, 0.06], lH: [-0.06, -0.2, 0.06], rP: [-0.8, -0.7, -0.4], lP: [0.8, -0.7, -0.4], sw: [0, 1.2],
  rF: [-0.28, ANK, -0.22], lF: [0.26, ANK, 0.2], rK: [-0.6, 0, 0.8], lK: [0.55, 0, 0.8],
};
const mlDouble = {
  yaw: 0.0, bY: -0.32, bZ: 0.22, pitch: 0.1, rH: [0.14, -0.02, 0.54], lH: [-0.14, -0.02, 0.54], rP: [-0.8, -0.4, -0.2], lP: [0.8, -0.4, -0.2], sw: [0, 1.35],
  lF: [0.26, ANK, 0.64], rF: [-0.26, ANK, -0.56], rK: [-0.2, -0.3, 0.9], lK: [0.4, 0, 0.9],
};

// ---------------------------------------------------------------- Lauds: the low kick, the overhand
const mlLowKickCoil = {
  yaw: -0.42, bY: -0.16, hip: -0.1, rF: [-0.18, ANK + 0.12, -0.1], rK: [-0.3, 0.3, 1], lF: [0.22, ANK, 0.22], lFy: 0.4,
};
const mlLowKick = {
  yaw: 0.5, bY: -0.15, roll: -0.08, hip: 0.18, rF: [0.06, 0.3, 0.64], rK: [-0.4, 0.4, 0.8], lF: [0.22, ANK, 0.18], lFy: 0.9,
  rH: [0.06, -0.08, 0.26], lH: [0.0, -0.02, 0.36],
};
/** The right hand raised behind the ear, the elbow high (the blue hold): the overhand is coming. */
const mlOverCoil = {
  yaw: -0.62, bY: -0.13, pitch: -0.02, hip: -0.12, rH: [-0.06, 0.32, 0.0], rP: [-0.8, 0.4, -0.5], sw: [0, 1.4], lH: [-0.02, 0.02, 0.44], lP: [0.8, -0.3, -0.2],
};
const mlOver = {
  yaw: 0.3, bY: -0.27, bZ: 0.16, pitch: 0.15, hip: 0.16, rH: [0.12, 0.06, 0.52], rP: [-0.8, -0.1, -0.4], sw: [0, 0.9], lH: [-0.02, -0.14, 0.16],
  lF: [0.24, ANK, 0.42], rF: [-0.22, ANK, -0.2], rFy: 0.05,
};

// ---------------------------------------------------------------- Penance: the rising hand-heel
const mlUpCoil = {
  yaw: -0.42, bY: -0.36, pitch: 0.12, hip: -0.1, rH: [0.02, -0.34, 0.16], rP: [-0.8, -0.6, 0.0], sw: [0, 1.0], lH: [-0.02, -0.02, 0.34],
  rF: [-0.3, ANK, -0.24], lF: [0.26, ANK, 0.22], rK: [-0.7, 0, 0.7], lK: [0.6, 0, 0.8],
};
// (v04: the hand-heel driven up and OUT in front of the chin, not up the chest: a gap between the arm and the
// body seen from above; it was 0.16 m from his chest's axis at the contact)
const mlUp = {
  yaw: 0.22, bY: -0.08, pitch: -0.08, spX: -0.06, hip: 0.14, rH: [0.08, 0.2, 0.54], rP: [-0.8, -0.6, 0.3], sw: [0, 1.5], lH: [-0.04, -0.06, 0.2],
  rF: [-0.2, ANK, -0.14], rFy: 0.1, lF: [0.24, ANK, 0.3],
};

export const FRAGS = Object.freeze({
  mlPalmLCoil, mlPalmL, mlPalmRCoil, mlPalmR, mlPivot, mlLunge, mlCatch, mlB1Coil, mlB2Turn, mlB2Palm, mlB2Follow,
  mlSweepCoil, mlSweep, mlKneeCoil, mlKnee, mlSlip, mlElbow,
  mlWalkA, mlWalkB, mlWalkCoil, mlWalkHit,
  mlReachCoil, mlReach, mlLift, mlThrow,
  mlGavelUp, mlGavel, mlDoubleCoil, mlDouble, mlLowKickCoil, mlLowKick, mlOverCoil, mlOver, mlUpCoil, mlUp,
});
export const CLIPS = Object.freeze({});
export const REACT = Object.freeze({});
export const OPEN = Object.freeze([]);
