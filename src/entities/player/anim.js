import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, easeOutCubic, wrapAngle, TAU } from '../../core/math.js';
import { DIM, BODY, HAIR_CLUSTERS, HERO_SCALE, sheetOffset } from './model.js';
import { SWINGS, FH } from './swings.js';
import { atEase, fencerGuard } from './stances.js';
import { idlesOld, idlesRef, idlesMode, easeArms, guardArms, newRests, tickRests, pickEase, actStart, lowRest, toLowRest, trailing, easeRests, fightRests, stowHidden, EASE_HABITS, EASE_TRICKS, FIGHT_ACTS, FIGHT_ACTS_REF, EASE_REF_EXTRA, IDLES, COMBO_FLICK } from './idles.js';
import { refStand, refReady, refGuard, guardMode, REF_GUARD, HOLDS, holdMode, holdHabits } from './refStance.js';
import { offHandLook } from './offHand.js';
import { CLOTH, clothMode } from './clothCalm.js';
import { BEARING, FLICK, bearingOn, flickOn } from './bearing.js';
import { feelLook, warpPhase } from './feel.js';

// Procedural animation for the Wanderer, keyed to the owner's concept sheets ("Movement" / "Combat
// key poses"). Every frame a target POSE (a flat Float32Array) is built for the current clip as a
// function of state time, cross-faded from a snapshot of the previous pose, then applied: FK for
// body/pelvis/spine/head, analytic two-bone IK for arms and legs (the off hand can join the grip:
// `twoHand`), the sword oriented directly in body space, a spring-chain coat (6 panels whose torn
// tails lag, flare and get kicked out by the knees) and spring hair clusters that trail motion.
//
// Pose spaces:
//   body space  — origin at the waist pivot, axes of the `body` joint (rolls and falls with it).
//   hand targets (rH/lH) are OFFSETS from each shoulder, in body axes (|offset| <= reach 0.55); the
//   sword hand's from its round-2 shoulder spot (rig.arms.R.anchor, model.js DIM.gripShoulder).
//   foot targets (rF/lF) are MODEL space (ground-relative); poses that need feet to follow the
//   body (roll tuck, lying down) map body-space points through their own body transform.

export const P = {
  bodyX: 0, bodyY: 1, bodyZ: 2, pitch: 3, yaw: 4, roll: 5,
  pelvY: 6, pelvZ: 7, spX: 8, spY: 9, spZ: 10, hdX: 11, hdY: 12,
  rH: 13, rP: 16, lH: 19, lP: 22, // hand offsets + elbow pole directions (body axes)
  swD: 25, swF: 28, // blade direction + flat normal (body axes)
  rF: 31, lF: 34, // foot targets (model space)
  rK: 37, lK: 40, // knee pole directions (body axes)
  footFlat: 43, flask: 44,
  twoHand: 45, // 0..1: the off hand joins the grip (the slam, the charge and the cleave, the guard)
  hdZ: 46, // head tilt (roll)
  pelvX: 47, // pelvis tuck / tilt (pitch)
  rFy: 48, lFy: 49, // foot yaw (toe-out) relative to the root
  rFf: 50, lFf: 51, // per-foot flat factor (× footFlat): heel peel / toe-off / swing
  // with twoHand: how far UP the sword from the grip the off hand sits (m; 0 = on the grip under the
  // sword hand): a palm braced on the flat of the blade
  offAt: 52,
  // the free hand: its fingers' direction and the way its palm faces (body axes; each vector's
  // LENGTH is its weight: 0 = the hand rigid on the forearm, today's look), its shape (0 open, 1
  // sword fingers) and how far it rests on the sword wrist (0..1). Read only for an animator built
  // with opts.freeHand (the hero); every other animator ignores whatever they hold
  lD: 53, lN: 56, hs: 59, lk: 60,
  // … and how much it hangs at its rest on its own pendulum (0..1: HeroAnimator._sideHand; the free hand's
  // look, offHand.js, worn by a one-handed swing). 0 in every pose but those (update() clears it before each)
  sd: 61,
};
/** The pose's channel count (a duelist's scratch poses are sized from it). */
export const N = 62;
const ENTRY_EASE = 0.85; // an easeOut cross-fade (attack entries) arrives at this fraction of its time
const TURN_LAG_MAX = 1.4; // rad: how far the drawn heading may trail the gameplay yaw in a fast turn
const TURN_K = 650; // stiffness (1/s²) of the critically damped spring the drawn heading follows
const ANGLES = [P.pitch, P.yaw, P.roll];
const ANK = DIM.ankle;
const LEG_IDX = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rK, P.rK + 1, P.rK + 2, P.lK, P.lK + 1, P.lK + 2, P.footFlat, P.rFy, P.lFy, P.rFf, P.lFf];
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const IDLE_LOOP = 2.4; // s (concept sheet: idle 2.4 s loop)
const FIGHT_STATES = new Set(['bossIntro', 'boss']); // flow states in which the hero stands in his fight stance (stand())
const FIGHT_EASE = [6, 2.6]; // 1/s: he takes the guard in ~0.35 s and lets it down over ~0.9 s (one rate both ways dropped the point 18 cm a frame as a fight ended)

// ---------------------------------------------------------------- pose helpers
export const v3 = (p, i, x, y, z) => {
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
};
/** Move p[i..i+2] toward (x,y,z) by t. */
export const to3 = (p, i, x, y, z, t) => {
  if (t <= 0) return;
  p[i] += (x - p[i]) * t;
  p[i + 1] += (y - p[i + 1]) * t;
  p[i + 2] += (z - p[i + 2]) * t;
};
/** The free hand opens and braces on the grass by k: the fingers ahead, the palm down. */
const palmBraced = (p, k) => {
  if (!(k > 0)) return;
  p[P.hs] += (0 - p[P.hs]) * Math.min(1, k);
  to3(p, P.lD, LD_BRACE[0], LD_BRACE[1], LD_BRACE[2], Math.min(1, k));
  to3(p, P.lN, 0, -1, 0, Math.min(1, k));
};
/** The free hand loses its shape and its wrist by k (hit, fall, heal): open, rigid on the forearm. */
const freeLimp = (p, k) => {
  if (!(k > 0)) return;
  const s = 1 - Math.min(1, k);
  p[P.hs] += (0 - p[P.hs]) * Math.min(1, k);
  for (let i = 0; i < 3; i++) {
    p[P.lD + i] *= s;
    p[P.lN + i] *= s;
  }
};
const setLen = (p, i, x, y, z, len) => {
  const l = Math.hypot(x, y, z) || 1;
  v3(p, i, (x / l) * len, (y / l) * len, (z / l) * len);
};
function blend(out, a, b, t, mem = null) {
  const ax = a[P.swD], ay = a[P.swD + 1], az = a[P.swD + 2];
  const bx = b[P.swD], by = b[P.swD + 1], bz = b[P.swD + 2];
  for (let i = 0; i < N; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  dirLerp(out, P.swD, ax, ay, az, bx, by, bz, t, mem);
}

// ---------------------------------------------------------------- blade direction blending
// Blade directions are blended by azimuth (round the body's vertical axis, + = the hero's left)
// and elevation, not component-wise: a component lerp between a blade low ahead and one trailing
// low behind passes through "straight down", which buried the point; the tip floor then swung it
// round under the body in 2-3 frames (a whip through the legs on every run start / stop, roll and
// recovery). Now a low blade sweeps round the side at its own height, and never through the
// back-left (from the right hand that path runs between the legs): it goes round the outside.
const DIR_AVOID = 2.35; // azimuth a blade below shoulder height never sweeps through (back-left)
const DIR_HIGH = 0.45; // elevation (rad) above which the blade clears the shoulder there
const DIR_LOCAL = 0.8; // rad of azimuth below which a move is local (never sent the long way round)
// a move this close to half a turn has no natural way round; below DIR_FLIP_HIGH (rad of elevation,
// about the head) it goes round the FRONT, never behind the shoulders (ADR-034: the lean idle hangs
// the blade at his right front, ~180° from the light combo's finish over his left shoulder; the way
// behind ran the steel through the sword arm's shoulder for a frame)
const DIR_FLIP = 2.75, DIR_FLIP_HIGH = 0.9;
const _ae = [0, 0, 0];
function azEl(x, y, z, o) {
  const h = Math.hypot(x, z);
  o[0] = Math.atan2(x, z);
  o[1] = Math.atan2(y, h);
  o[2] = h / (Math.hypot(x, y, z) || 1); // how horizontal (0 = vertical: no heading)
}
/** mem (optional, a cross-fade's): { d, ok } — the sweep keeps the way round it took last frame
 *  (the nearest 2π branch to it): the target moves during a fade, and re-deciding the way every
 *  frame flipped the blade to the other side of the body mid-fade. */
export function dirLerp(out, i, ax, ay, az, bx, by, bz, t, mem = null) {
  if (!(t > 0)) {
    v3(out, i, ax, ay, az);
    return;
  }
  if (t >= 1) {
    v3(out, i, bx, by, bz);
    return;
  }
  azEl(ax, ay, az, _ae);
  let a0 = _ae[0];
  const e0 = _ae[1], h0 = _ae[2];
  azEl(bx, by, bz, _ae);
  let a1 = _ae[0];
  const e1 = _ae[1], h1 = _ae[2];
  // a (nearly) vertical end has little heading, and it flips 180° as the blade passes vertical (the
  // slam's raise): lean on the other end's heading as an end nears vertical, so the path stays
  // continuous; the end correction below keeps both ends exact
  const k0 = smoothstep(0.03, 0.3, h0), k1 = smoothstep(0.03, 0.3, h1);
  a1 = a0 + wrapAngle(a1 - a0) * k1;
  a0 = a1 + wrapAngle(a0 - a1) * k0;
  let d = wrapAngle(a1 - a0);
  if (Math.min(e0, e1) < DIR_HIGH && Math.abs(d) > DIR_LOCAL) {
    // a path that crosses the back-left below shoulder height (behind / through the body from the
    // right hand) goes round the other way; one still high there passes over the shoulder. A short
    // move of a blade already AT the back-left (light 1's rising finish → light 2's coil) stays
    // local: flipping it sent the blade 350° round the body in two frames
    const f = wrapAngle(DIR_AVOID - a0);
    if (((d > 0 && f > 0 && f < d) || (d < 0 && f < 0 && f > d)) && e0 + ((e1 - e0) * f) / d < DIR_HIGH) d -= Math.sign(d) * TAU;
  }
  if (Math.abs(d) > DIR_FLIP) {
    const fb = wrapAngle(Math.PI - a0); // from a0 to straight behind
    if (((d > 0 && fb > 0 && fb < d) || (d < 0 && fb < 0 && fb > d)) && e0 + ((e1 - e0) * fb) / d < DIR_FLIP_HIGH) d -= Math.sign(d) * TAU;
  }
  if (mem) {
    if (mem.ok) d += TAU * Math.round((mem.d - d) / TAU);
    mem.d = d;
    mem.ok = true;
  }
  const a = a0 + d * t, e = e0 + (e1 - e0) * t;
  const c = Math.cos(e);
  let x = c * Math.sin(a), y = Math.sin(e), z = c * Math.cos(a);
  if (k0 < 1 || k1 < 1) {
    // the borrowed headings moved the path's ends: fade in the difference to the true ends
    const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
    const c0 = Math.cos(e0), c1 = Math.cos(e1), s = 1 - t;
    x += s * (ax / la - c0 * Math.sin(a0)) + t * (bx / lb - c1 * Math.sin(a0 + d));
    y += s * (ay / la - Math.sin(e0)) + t * (by / lb - Math.sin(e1));
    z += s * (az / la - c0 * Math.cos(a0)) + t * (bz / lb - c1 * Math.cos(a0 + d));
    const l = Math.hypot(x, y, z);
    if (l > 1e-6) {
      x /= l;
      y /= l;
      z /= l;
    }
  }
  v3(out, i, x, y, z);
}
/** Turn the blade direction p[i..i+2] toward (x, y, z) by t, round the outside (see dirLerp). */
function dirTo(p, i, x, y, z, t) {
  if (!(t > 0)) return;
  dirLerp(p, i, p[i], p[i + 1], p[i + 2], x, y, z, Math.min(1, t));
}
/** Piecewise curve through flat [t0, v0, t1, v1, ...] keys, smoothstepped between neighbours. */
export function kf(t, k) {
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (t <= k[i]) {
      const u = (t - k[i - 2]) / Math.max(1e-6, k[i] - k[i - 2]);
      return k[i - 1] + (k[i + 1] - k[i - 1]) * u * u * (3 - 2 * u);
    }
  }
  return k[k.length - 1];
}
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const _bv = new THREE.Vector3();
/** Blend foot target p[i] toward a BODY-space point mapped through this pose's body transform. */
function bodyPointTo(p, i, x, y, z, t) {
  if (t <= 0) return;
  _eul.set(p[P.pitch], p[P.yaw], p[P.roll], 'YXZ');
  _bv.set(x, y, z).applyEuler(_eul);
  to3(p, i, _bv.x + p[P.bodyX], _bv.y + DIM.pivot + p[P.bodyY], _bv.z + p[P.bodyZ], t);
}

const SCRATCH = new Float32Array(N);
const SCR_LEGS = new Float32Array(N);
const FEET_WANT = new Float32Array(8); // foot planner: [x, y, z, yaw] the clip wants, right then left
const SW_T = new Float32Array(3); // loco: the moving blade's target direction

// ---------------------------------------------------------------- poses
// A = the animator: time, t (clip time), moveW, sprintW, speed, phase, mx/mz (move dir in model
// space), def (attack data), chargeK (0..1), releaseK (charge of the cleave in flight), recoil.

/** Piecewise-linear curve through flat [t0, v0, t1, v1, ...] keys (no stall at the keys). */
function lin(t, k) {
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (t <= k[i]) return k[i - 1] + ((k[i + 1] - k[i - 1]) * (t - k[i - 2])) / Math.max(1e-6, k[i] - k[i - 2]);
  }
  return k[k.length - 1];
}

/** Vector keys: k = [t0, x, y, z, t1, x, y, z, ...], smoothstepped between neighbours → p[i..i+2]. */
function kv3(p, i, t, k) {
  const n = k.length / 4;
  if (t <= k[0]) {
    v3(p, i, k[1], k[2], k[3]);
    return;
  }
  for (let j = 1; j < n; j++) {
    const b = j * 4;
    if (t <= k[b]) {
      const a = b - 4;
      let u = (t - k[a]) / Math.max(1e-6, k[b] - k[a]);
      u = u * u * (3 - 2 * u);
      v3(p, i, k[a + 1] + (k[b + 1] - k[a + 1]) * u, k[a + 2] + (k[b + 2] - k[a + 2]) * u, k[a + 3] + (k[b + 3] - k[a + 3]) * u);
      return;
    }
  }
  const e = (n - 1) * 4;
  v3(p, i, k[e + 1], k[e + 2], k[e + 3]);
}

/** Idle / ready stance (2.4 s loop), the owner's single-figure reference (ADR-036), seen from the
 *  front: the chest square to the viewer, the weight on the LEFT leg under the hips, the armoured
 *  right leg thrust out straight to his right and forward, toes out. The sword arm hangs nearly
 *  straight beside the right hip, a little away from the body; the sword is held in a LOW READY at
 *  his right side: from the gauntlet forward, down and a little outward, clear of the coat skirt and
 *  outside the forward leg, the point a hand above the grass, the pommel standing up-back behind the
 *  fist. The free hand rests low by the left hip in sword fingers (jian jue), pointing ahead and
 *  down; the head is bowed a little, looking ahead.
 *  Breathing + a slow weight sway; no steps.
 *  (ADR-036 laid the blade in a low diagonal ACROSS his front: it ran between the thighs and the
 *  front coat panels, so the cloth had nowhere to hang but through the steel (owner: "the fabric in
 *  the front keeps clipping through the sword"). ADR-034 hung it straight down his right side: a
 *  stiff A-pose carrying a pole. From the 58° game camera this blade lies forward-right of his body,
 *  so its whole length shows from behind.) */
// blade direction (body axes): ~52° below level, out to his right and a touch forward, the point
// just off the grass (the owner's reference image: the sword low at his side). The EDGE is down (the
// flat faces forward): the way a hanging hand carries a sword, and the guard shows as a cross from
// the front like the reference's.
// (Session 11, ADR-040: the blade used to point nearly straight ahead, 22° off his front, from a
// straight hanging arm. Facing away from the 58° game camera, the usual fight view, his body and
// cape hid all of it, and the wrist was cocked ~50° to hold it there. Now the elbow is bent back beside
// the ribs, the forearm runs into the blade's line, and the steel stands out to his side, past
// his silhouette and the cape, from every camera.)
const IDLE_SW = [-0.6, -0.79, 0.12];
// [azimuth, elevation] in degrees (body axes: az 0 ahead, + his left; el + up) → a unit vector: the
// free hand's fingers (swings.js `ld`, the poses). Its own degree constant: REST_LD is built at
// module load, before SW_DEG below exists
const AZEL = Math.PI / 180;
const unitAzEl = (az, el) => {
  const a = az * AZEL, e = el * AZEL, c = Math.cos(e);
  return [c * Math.sin(a), Math.sin(e), c * Math.cos(a)];
};
const REST_LD = unitAzEl(14, -50); // the rest's sword fingers: ahead and down, a "seated" jian rest
const REST_LN = [-0.35, -0.6, -0.72]; // … their palm down and back
const LD_BRACE = unitAzEl(0, -10); // a palm braced on the grass: the fingers ahead
const LD_WARD = unitAzEl(-4, -12); // the backstep's warding low point
const LD_FOE = unitAzEl(0, 0); // straight at the foe
// the sword arm on the move in a fight (loco): the grip before the right ribs, the elbow back
// beside them (pointed out to the side it flared 0.52, as the run's once did), the blade ahead and
// level, a little out to the sword side: the fencer's guard, carried
const FIGHT_RUN = { h: [-0.09, -0.26, 0.33], p: [-0.22, -0.7, -0.68], d: unitAzEl(-11, 3) };
export function guard(p, A) {
  const ph = A.time * (TAU / IDLE_LOOP);
  const br = Math.sin(ph), sw = Math.sin(ph * 0.5 + 1.1); // breath, and a slower weight sway
  p[P.bodyX] = 0.025 + 0.008 * sw; // the hips over the left (weight) leg
  p[P.bodyY] = -0.035 + 0.004 * br; // sunk a little into the stance
  p[P.bodyZ] = 0.0;
  p[P.pitch] = 0;
  p[P.yaw] = 0;
  p[P.roll] = 0;
  p[P.pelvX] = 0;
  p[P.pelvY] = 0.14; // the hips turn with the forward right foot ...
  p[P.pelvZ] = 0.04 + 0.015 * sw; // ... and the weight leg's (left) hip rides a little higher
  p[P.spX] = 0.04 + 0.01 * br;
  p[P.spY] = -0.12; // ... the chest stays square to the front
  p[P.spZ] = -0.03 - 0.015 * sw;
  p[P.hdX] = 0.14 - 0.03 * br; // bowed a little
  p[P.hdY] = 0.1; // ... looking ahead
  p[P.hdZ] = 0.06 + 0.012 * sw;
  v3(p, P.rH, -0.19, -0.435 + 0.006 * br, 0.06); // the grip out beside the right hip, clear of the coat
  v3(p, P.rP, 0.5, -0.3, -1); // the upper arm hangs by the ribs, the elbow a little back: the forearm runs out and down, ~25° off the blade's line
  v3(p, P.lH, 0.07 + 0.006 * sw, -0.5 + 0.012 * br, 0.06 + 0.01 * br); // sword fingers low by the left hip; it breathes (the hand used to hang still)
  // (the hero's free elbow hangs by the ribs: 0.6 out it stood off them like a wing. A duelist's
  // footwork reads this pose too and keeps its own)
  if (A.freeHand) v3(p, P.lP, 0.36, -0.2, -0.9);
  else v3(p, P.lP, 0.6, -0.1, -0.8);
  v3(p, P.swD, IDLE_SW[0] + 0.01 * br, IDLE_SW[1] + 0.008 * br, IDLE_SW[2] + 0.015 * sw);
  v3(p, P.swF, 0.15, 0.05, 1); // edge down, the flat faces forward: broad to a camera in front or behind
  // (the right foot stood 0.33 m out and the leg dead straight: a straddle; now a shoulder-width
  // stance with the knee soft)
  v3(p, P.rF, -0.25, ANK, 0.17); // the right leg out to his right and forward, the knee soft
  v3(p, P.lF, 0.14, ANK, -0.09); // the weight leg under the hips, a little back
  v3(p, P.rK, -0.45, 0.1, 1);
  v3(p, P.lK, 0.3, 0.05, 1);
  p[P.footFlat] = 0.95;
  p[P.rFy] = -0.5; // toes turned out
  p[P.lFy] = 0.4;
  p[P.rFf] = 1;
  p[P.lFf] = 1;
  p[P.flask] = 0;
  p[P.twoHand] = 0;
  p[P.offAt] = 0;
  // the free hand (read by the hero's animator only): sword fingers pointing ahead and down, the
  // palm down and back; the fingers breathe with the chest
  const RD = REST_LD;
  v3(p, P.lD, RD[0], RD[1] + 0.05 * br, RD[2]);
  v3(p, P.lN, REST_LN[0], REST_LN[1], REST_LN[2]);
  p[P.hs] = 1;
  p[P.lk] = 0;
}

const SCR_FIGHT = new Float32Array(N);
/** Where the hero STANDS (ADR-114, stances.js): at ease, or in the fencer's guard once a fight is
 *  on, blended by A.fightW (HeroAnimator.update). The hero's animator only (A.freeHand): a
 *  duelist's footwork reads guard(), and guard() stays the base every other clip is written over.
 *  loco() blends the gait in over this, and an attack's recovery comes home to it. */
export function stand(p, A) {
  guard(p, A);
  if (!A.freeHand) return;
  const f = clamp(fin(A.fightW), 0, 1);
  if (idlesRef()) {
    // (ADR-207, refStance.js: the reference's stand at ease, its two-handed hold in the fight)
    if (f >= 0.999) refReady(p, P, A);
    else {
      refStand(p, P, A);
      if (f > 0.001) {
        for (let i = 0; i < N; i++) SCR_FIGHT[i] = p[i];
        refReady(SCR_FIGHT, P, A);
        blend(p, p, SCR_FIGHT, f * f * (3 - 2 * f));
        // the free hand is drawn up before him first and takes the grip late in the change (with the
        // stance's own blend its straight way from the thigh to the grip ran through the coat at the hip)
        p[P.twoHand] = smoothstep(0.35, 0.95, f) * (HOLDS[holdMode()]?.two ?? 1);
      }
    }
    // on the move the free hand lets go of the grip: it swings with the stride (loco, runArms.js)
    const mv = smoothstep(0.02, 0.3, A.moveW);
    if (mv > 0) {
      p[P.twoHand] *= 1 - mv;
      to3(p, P.lD, REST_LD[0], REST_LD[1], REST_LD[2], mv);
      to3(p, P.lN, REST_LN[0], REST_LN[1], REST_LN[2], mv);
    }
    return;
  }
  // (ADR-186, idles.js: the arms in one of several rests over each stance; `?idles=old` the belt)
  const rests = !idlesOld();
  if (f >= 0.999) {
    fencerGuard(p, P, A);
    if (rests) guardArms(p, P, A);
  } else {
    atEase(p, P, A);
    if (rests) easeArms(p, P, A);
    if (f > 0.001) {
      for (let i = 0; i < N; i++) SCR_FIGHT[i] = p[i];
      fencerGuard(SCR_FIGHT, P, A);
      if (rests) guardArms(SCR_FIGHT, P, A);
      blend(p, p, SCR_FIGHT, f * f * (3 - 2 * f));
    }
  }
  // setting off, the free hand lets go of the belt's shape for the rest it swings in (guard()'s:
  // the fingers ahead and down). Kept, the hand turned in on the hip put its fingertips 6.7 cm
  // into it as the arm swung past.
  const mv = smoothstep(0.02, 0.3, A.moveW);
  if (mv > 0) {
    to3(p, P.lD, REST_LD[0], REST_LD[1], REST_LD[2], mv);
    to3(p, P.lN, REST_LN[0], REST_LN[1], REST_LN[2], mv);
  }
}

/** The hero's blade (and, `arm`, the sword hand and its elbow) leaves where it was as this clip
 *  began over `dur` s, not inside the cross-fade's few frames. (ADR-114: a roll and a backstep are
 *  written over guard()'s low blade and hand; entered from the fencer's guard, the cross-fade swung
 *  the steel 100° in three frames, up to 1.7 m a frame at the point, and dipped the hand 25 cm.
 *  Coming back to the guard out of a roll it rose 74 cm a frame: LOCO_SETTLE.) */
const SWORD_ENTRY = 0.16, LOCO_SETTLE = 0.24; // s
function swordFromEntry(p, A, dur, arm = true) {
  if (!A.freeHand || !A.from) return;
  const e = 1 - smoothstep(0, dur, A.t);
  if (e <= 0.001) return;
  const F = A.from;
  dirLerp(p, P.swD, p[P.swD], p[P.swD + 1], p[P.swD + 2], F[P.swD], F[P.swD + 1], F[P.swD + 2], e);
  to3(p, P.swF, F[P.swF], F[P.swF + 1], F[P.swF + 2], e);
  if (!arm) return;
  to3(p, P.rH, F[P.rH], F[P.rH + 1], F[P.rH + 2], e);
  to3(p, P.rP, F[P.rP], F[P.rP + 1], F[P.rP + 2], e);
}

/** One foot of the gait (model space). u = this foot's cycle phase: stance [0, β) sweeps the foot
 *  back under the hips at exactly the ground speed (the cycle length is matched to the speed, so
 *  a planted foot never skates), swing [β, 1) lifts it — the heel kicking up behind first — and
 *  reaches it forward to the next contact. Writes the foot-flat factor for this foot into FLAT. */
const FLAT = [0.9, 0.9];
function footCycle(p, i, side, u, A, w, fi) {
  u -= Math.floor(u);
  const G = A.gait, beta = G.beta, exc = G.exc, off = G.off;
  let along, up = 0, flat;
  if (u < beta) {
    const v = u / beta;
    along = exc * (1 - 2 * v);
    // heel-strike → flat → heel peels off the ground toward toe-off
    up = G.peel * smoothstep(0.62, 1, v);
    flat = 1 - 0.7 * smoothstep(0.55, 1, v);
  } else {
    const t = (u - beta) / (1 - beta);
    // Hermite swing whose end speeds match the stance's (the foot keeps pushing back after toe-off,
    // swings through, and paws back onto the ground at ground speed): no stop-start at contact
    const m = (-2 * (1 - beta)) / beta, t2 = t * t, t3 = t2 * t;
    along = exc * (-4 * t3 + 6 * t2 - 1 + m * (2 * t3 - 3 * t2 + t));
    // the heel kicks up behind early in the swing, then the foot reaches forward low
    up = G.peel * (1 - smoothstep(0, 0.25, t)) + G.lift * Math.sin(Math.PI * Math.pow(t, 0.8)) + G.kick * Math.sin(Math.PI * Math.min(1, t * 1.7)) * (1 - t);
    flat = 0.3 + 0.6 * smoothstep(0.6, 0.95, t);
  }
  FLAT[fi] = flat;
  to3(p, i, side + A.mx * (along + off) * 0.85, ANK + up, A.mz * (along + off), w);
}

/** A fast turn (the gameplay yaw snaps to the aim) reads as a body turn: the head and eyes lead,
 *  the chest follows, the hips trail behind (A.turnLag = how far the visual heading lags the
 *  root, ≤ 0 when turning left) while the planted feet catch up with steps. */
export function turnTwist(p, A) {
  const L = A.turnLag;
  if (Math.abs(L) < 1e-4) return;
  // standing, the whole figure follows the visual heading (the gameplay yaw flips 180° in ~0.15 s,
  // which read as a snap); moving, only part of it (the stride runs along the real velocity)
  const a = L * lerp(1, 0.35, clamp(A.moveW * 1.5, 0, 1));
  p[P.yaw] += a; // the body trails …
  p[P.pelvY] += L * 0.12; // … the hips a little more
  p[P.spY] -= L * 0.36; // the chest ahead of them
  p[P.hdY] -= L * 0.32; // the head leads onto the new heading
  p[P.spZ] += L * 0.06;
  // the stance the foot planner steps toward turns with the body, so the feet follow the turn
  // (they used to step to the new heading at once, ahead of the hips)
  const c = Math.cos(a), s = Math.sin(a);
  for (let k = 0; k < 2; k++) {
    const i = k ? P.lF : P.rF, x = p[i], z = p[i + 2];
    p[i] = x * c + z * s;
    p[i + 2] = z * c - x * s;
  }
  p[P.rFy] += a;
  p[P.lFy] += a;
}

/** Gait parameters from the ground speed (m/s): stance fraction, half stance length (model m),
 *  stance-centre offset, swing lift / heel kick, and the cycle length that makes the stance foot
 *  travel back at exactly the drawn ground speed. Walk ≈ 0.8 s cycles with double support; run
 *  0.56 s with a flight phase; sprint long leaping strides. */
function gaitParams(G, sp, sprintW) {
  const runK = smoothstep(1.7, 4.2, sp), walkK = clamp(sp / 1.6, 0, 1);
  G.beta = lerp(0.62, 0.38, runK) - 0.07 * sprintW;
  G.exc = lerp(0.11 + 0.17 * walkK, 0.37, runK) + 0.05 * sprintW;
  G.off = -0.05 * runK - 0.03 * sprintW; // the run lands under the hips and pushes off behind them
  G.lift = lerp(0.05 + 0.04 * walkK, 0.13, runK) + 0.06 * sprintW;
  G.kick = 0.16 * runK + 0.12 * sprintW; // heel recovery toward the seat
  G.peel = lerp(0.02, 0.06, runK);
  G.len = (2 * G.exc) / G.beta;
}

/** Idle ↔ walk ↔ run ↔ sprint, blended by moveW / sprintW; strafing and backpedalling turn the
 *  stride with the move direction while the chest stays on the aim. A grounded run: the body sinks
 *  and leans into the speed and harder into acceleration (sits back when braking), compresses on
 *  each contact, the hips swing with the stride and the shoulders counter-rotate, the head stays
 *  level. The sword arm carries the blade ahead, low at the right hip, rocking with the forearm
 *  (runSword.js, ADR-204; `old` trailed it back beside the right leg (run) → nearly level
 *  behind (sprint)); the free fist swings / pumps against the legs. Planted feet are held in the
 *  world by the foot planner (HeroAnimator._feet). */
// (imported here, beside its one caller: the hero's free arm on the run, ADR-187)
import { runArm } from './runArms.js';
// … and his sword arm on the run (ADR-204)
import { runSword } from './runSword.js';
// … and his posture on the run (ADR-229)
import { applyRunStyle, runStyle, runStyleArm } from './runStyle.js';
const RSW = { h: [0, 0, 0], p: [0, 0, 0], d: [0, 0, -1], f: [0, 1, 0], open: 0 };
export function loco(p, A) {
  // (A.reachT: how much the sword arm reaches its full length in this clip's own pose, read by the
  // solver through _swordOpen; only the clip's pose itself sets it, never a scratch pose)
  if (p === A.target) A.reachT = 0;
  stand(p, A);
  const w = A.moveW;
  // (the sword lag outlasts moveW: dropping it at once snapped the last few % of the blade's
  // swing back to the ready stance in one frame)
  if (w < 0.002 && A.swordW < 0.002) {
    turnTwist(p, A);
    return;
  }
  const s = A.sprintW, mx = A.mx, mz = A.mz;
  // the posture (lean, sink, bob and swing amplitudes) follows a smoothed speed: the gameplay
  // speed has a kink on every start and stop, which jerked the torso back in one frame
  const sp = A.speedS;
  const G = A.gait;
  const ph = A.phase;
  const runK = smoothstep(1.7, 4.2, sp);
  const side = lerp(0.11, 0.075, runK);
  footCycle(p, P.lF, side, ph, A, w, 1);
  footCycle(p, P.rF, -side, ph + 0.5, A, w, 0);
  p[P.footFlat] = lerp(p[P.footFlat], 0.9, w);
  p[P.rFy] = lerp(p[P.rFy], 0, w);
  p[P.lFy] = lerp(p[P.lFy], 0, w);
  p[P.rFf] = lerp(p[P.rFf], FLAT[0], w);
  p[P.lFf] = lerp(p[P.lFf], FLAT[1], w);

  // stride drivers: cs = +1 when the left foot lands in front; sL = +1 at the left mid-stance,
  // −1 at the right; st = +1 at every mid-stance
  const cs = Math.cos(TAU * ph);
  const sL = Math.cos(TAU * (ph - G.beta * 0.5));
  const st = Math.cos(TAU * 2 * (ph - G.beta * 0.5));
  const fwd = mz > 0 ? mz : 0;
  const accF = A.leanF, accS = A.leanS;
  const lean = (lerp(0.05, 0.2, runK) + 0.26 * s) * clamp(sp / 4, 0, 1);
  const bob = lerp(0.012, -0.032, runK) - 0.014 * s; // + = high at mid-stance (walk vault), − = run compression
  p[P.bodyY] = lerp(p[P.bodyY], -0.02 - 0.045 * runK - 0.05 * s + bob * st - 0.04 * Math.abs(accF), w);
  p[P.bodyX] = lerp(p[P.bodyX], 0.022 * sL * (1 - runK), w); // walking: the hips ride over the stance foot
  p[P.bodyZ] = lerp(p[P.bodyZ], 0.05 * s * fwd + 0.1 * accF, w);
  p[P.roll] = lerp(p[P.roll], -A.bank, w);
  const hipSw = lerp(0.12, 0.2, runK);
  // backpedalling swings the hips the other way; the sign eases over as the move direction swings
  // past sideways (a hard flip at mz = −0.2 popped the hips and chest in one frame)
  const back = clamp((mz + 0.2) / 0.25, -1, 1);
  p[P.pelvY] = lerp(p[P.pelvY], -hipSw * cs * back + A.strafeYaw, w);
  p[P.pelvZ] = lerp(p[P.pelvZ], 0.05 * sL * (1 - 0.5 * runK), w); // the swing side's hip drops
  p[P.pelvX] = lerp(p[P.pelvX], 0.05 * runK, w);
  p[P.spX] = lerp(p[P.spX], 0.04 + lean * lerp(-0.3, Math.max(0.4, mz), smoothstep(-0.45, 0.05, mz)) + accF, w);
  p[P.spZ] = lerp(p[P.spZ], -lean * mx * 0.4 - accS, w);
  // knees point along the hips
  const ky = p[P.pelvY];
  to3(p, P.rK, Math.sin(ky) - 0.12, 0, Math.cos(ky), w);
  to3(p, P.lK, Math.sin(ky) + 0.12, 0, Math.cos(ky), w);
  // shoulders counter-rotate the hips (the chest stays on the aim)
  p[P.spY] = lerp(p[P.spY], -p[P.pelvY] * 1.25 + 0.04, w);
  p[P.hdX] = lerp(p[P.hdX], 0.06 - (p[P.spX] + p[P.pelvX]) * 0.8 - 0.02 * st * runK, w);
  p[P.hdY] = lerp(p[P.hdY], -0.3 * (p[P.pelvY] + p[P.spY]), w);
  p[P.hdZ] = lerp(p[P.hdZ], 0.4 * A.bank, w);
  // (ADR-229: the hero's run style, `?runStyle=`, over this posture: running forward only)
  if (A.freeHand === true) applyRunStyle(p, P, runStyle(), w * smoothstep(0.2, 0.7, mz), runK, s, bob * st);

  // sword arm trailing: low behind the hip, blade back-down beside the right leg (run) → swept
  // back, blade nearly level (sprint); it bobs and swings a little with the stride. The sword
  // follows the body with its own lag (A.swordW): setting off, the blade swings back round the
  // right side over ~0.3 s instead of whipping; stopping, it swings forward to the ready stance.
  // Backpedalling (and sliding out of a backstep) he keeps his guard up instead: the blade held
  // forward and low in front of him (A.backW, eased, so turning from a backpedal into a run swings
  // it round the right side over ~0.3 s): trailed "behind" it swung into the direction of travel,
  // and the low ready guard lies across the legs, which swing through it when walking backward.
  // (round 3: the hand trails OUT beside the coat, not under it, and the blade angles out past the
  // tails: the grip used to ride inside the skirt and the steel came out through the cloth)
  // (ADR-044: the hand hung 0.5 m below the shoulder, the end of the arm's reach, so the stride's
  // swing was lost in a straight arm; it rides a little higher now and swings 9 cm with the stride,
  // against the free arm)
  // the hero's arms swing with the stride whichever way he moves: their swing followed mz alone, so
  // strafing with the aim held elsewhere (mz ~ 0: most of a fight on the mouse, or locked on) both
  // arms hung still in one crook while the legs ran. Its SIGN is the fore-aft direction he last
  // moved in, latched through sideways and eased over ~0.1 s (A.armSign, update(): a sign taken
  // from mz itself went through zero in a pure strafe, and flipped the hand 20 cm in one frame as
  // the direction swung past sideways); its size never drops under 0.65. A duelist's footwork
  // reads this pose too and keeps the old swing
  const hero = A.freeHand === true;
  const armF = hero ? fin(A.armSign, 1) * Math.max(Math.abs(mz), 0.65) : mz;
  const amp = 0.09 * cs * armF, ws = A.swordW, bw = A.backW;
  // In a fight (A.fightW, the hero) he keeps his guard up on the move, the blade ahead of him and
  // level, riding the stride; only a sprint trails it. (ADR-114: trailed, every start and stop
  // swung the steel 140° between the fencer's guard and his back, 16-18 cm a frame at the point.)
  const fw = hero ? clamp(fin(A.fightW), 0, 1) * (1 - s) : 0, FR = FIGHT_RUN;
  // (backing away the grip was one constant: the sword elbow stood at 123° for the whole backpedal
  // beside a free arm that pumps; it rides the stride now)
  // the carry at ease (run → sprint): runSword.js's (ADR-204, `?runSword=`), or the one before ('old'); its
  // arm angles are against the torso's line, so it takes the lean set above
  const rs = hero && runSword(RSW, ph, armF, s, p[P.spX] + p[P.pelvX]), RH = RSW.h, RP = RSW.p, RD = RSW.d;
  // (ADR-229: a straight trailing arm asks the solver for its full reach, as far as the carry shows)
  if (rs && p === A.target) A.reachT = clamp(fin(RSW.open), 0, 1) * ws * (1 - bw) * (1 - fw);
  const h0 = rs ? RH[0] : lerp(-0.13, -0.15, s), h1 = rs ? RH[1] : lerp(-0.44, -0.37, s) + 0.02 * st, h2 = rs ? RH[2] : lerp(-0.08 + amp, -0.28 + amp * 0.6, s);
  to3(p, P.rH, lerp(lerp(h0, -0.02, bw), FR.h[0], fw), lerp(lerp(h1, -0.38 + 0.025 * st, bw), FR.h[1] + 0.022 * st, fw),
    lerp(lerp(h2, 0.3 + amp * 0.6, bw), FR.h[2] + amp * 0.5, fw), ws);
  // (Session 30: both elbows pointed 0.5-0.7 out to the side through the run, arms akimbo from the
  // front: they point back beside the ribs now)
  const p0 = rs ? RP[0] : lerp(-0.4, -0.5, s), p1 = rs ? RP[1] : lerp(-0.3, 0.2, s), p2 = rs ? RP[2] : -0.95;
  to3(p, P.rP, lerp(lerp(p0, -0.85, bw), FR.p[0], fw), lerp(lerp(p1, -0.3, bw), FR.p[1], fw), lerp(lerp(p2, -0.5, bw), FR.p[2], fw), ws);
  if (rs) dirLerp(SW_T, 0, RD[0], RD[1], RD[2], -0.15, -0.22, 1, bw);
  else dirLerp(SW_T, 0, lerp(-0.42, -0.36, s), lerp(-0.56, -0.2, s) - 0.03 * st * (1 - s), lerp(-0.71, -0.91, s), -0.15, -0.22, 1, bw);
  if (fw > 0.001) dirLerp(SW_T, 0, SW_T[0], SW_T[1], SW_T[2], FR.d[0], FR.d[1] + 0.035 * st, FR.d[2], fw);
  dirTo(p, P.swD, SW_T[0], SW_T[1], SW_T[2], ws);
  to3(p, P.swF, lerp(lerp(rs ? RSW.f[0] : -0.3, 0, bw), 0.25, fw), rs ? lerp(lerp(RSW.f[1], 1, bw), 1, fw) : 1, lerp(lerp(rs ? RSW.f[2] : 0, 0.2, bw), 0, fw), ws);
  // free arm swings opposite the legs: ahead of the belt (run) → a pumping fist chin ↔ hip (sprint)
  const k = 0.5 - 0.5 * cs * armF; // 1 = fist forward
  // (ADR-187: the hero's free arm is runArms.js's, one of three carries, `?runArm=`; 'old' is this)
  const ran = hero && runArm(p, P, A, ph, armF, s, runK, w, mz, runStyleArm());
  // (the run's back swing reaches further down and back, so the elbow opens behind him and folds as
  // the hand comes forward: it was one rigid 87° crook swinging from the shoulder)
  if (ran) {
    // (runArms.js wrote the hand, the elbow, the fingers and the palm)
  } else if (hero) {
    to3(p, P.lH, lerp(0.0, -0.06, s) * k + 0.07 * (1 - k), lerp(lerp(-0.485, -0.3, k), lerp(-0.4, -0.04, k), s), lerp(lerp(-0.17, 0.24, k), lerp(-0.18, 0.32, k), s), w);
    to3(p, P.lP, lerp(0.36, 0.42, s), -0.5, -0.8, w);
  } else {
    // (a duelist's run: as it was. Tucked in like the hero's, the Ash Disciple's sleeve ran 2-8 cm
    // into his ribs and his hand crossed behind his back)
    to3(p, P.lH, lerp(-0.02, -0.08, s) * k + 0.06 * (1 - k), lerp(lerp(-0.44, -0.3, k), lerp(-0.38, -0.04, k), s), lerp(lerp(-0.1, 0.24, k), lerp(-0.14, 0.32, k), s), w);
    to3(p, P.lP, 0.6, -0.6, -0.6, w);
  }
  // the free hand relaxes on the move: an open hand that half follows the forearm's own line (|lD|
  // is its weight). (Session 30: the run kept the sword fingers, two long fingers dangling off a
  // pumping arm; the shape is for the guard and the cuts)
  if (!ran) {
    const k = 1 - 0.55 * w;
    for (let i = 0; i < 3; i++) p[P.lD + i] *= k;
    p[P.hs] = lerp(p[P.hs], 0, clamp(w * 2, 0, 1));
  }
  turnTwist(p, A);
}
/** Blend only the legs toward the walking gait (block / charge can move). */
function walkLegs(p, A) {
  const w = A.moveW;
  if (w < 0.01) return;
  loco(SCR_LEGS, A);
  for (const i of LEG_IDX) p[i] += (SCR_LEGS[i] - p[i]) * w;
}

/** Wide fighting stance (left foot forward, feet ~0.82 m apart along the line, §4.6 02), knees
 *  bent. lunge 0..1 sinks into the strike. */
function stance(p, A, lunge) {
  guard(p, A);
  v3(p, P.rF, -0.16, ANK, -0.4);
  v3(p, P.lF, 0.14, ANK, 0.38 + 0.12 * lunge);
  v3(p, P.rK, -0.35, 0, 1);
  v3(p, P.lK, 0.3, 0, 1);
  p[P.bodyX] = 0;
  p[P.bodyY] = -0.12 - 0.05 * lunge;
  p[P.bodyZ] = 0.06 * lunge;
  p[P.pelvZ] = 0;
  p[P.spZ] = 0;
  p[P.hdX] = 0.02;
  p[P.hdZ] = 0;
  p[P.footFlat] = 0.9;
}

/** The thrust's start (§4.7; until ADR-072 also the charge's stance, which is chargePose now): a
 *  deep wide crouch (feet ~0.95 m apart, hips at 0.70 m, lean 30°, twisted −30° with the head up on
 *  the target), the sword held TWO-HANDED at the right hip, blade back-down-right with its point
 *  just off the grass ~1 m behind. k = charge 0..1, sink 0..1 = how far into the crouch. */
function chargeStance(p, A, k, sink) {
  stance(p, A, 0);
  p[P.bodyY] = lerp(-0.12, -0.19 - 0.04 * k, sink);
  p[P.pelvY] = -0.12 - 0.18 * sink;
  p[P.spY] = -0.34 * sink;
  p[P.spX] = 0.16 + (0.38 + 0.05 * k) * sink;
  p[P.spZ] = 0;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.85; // eyes stay on the target
  p[P.hdX] = 0.02 - 0.3 * sink;
  // (Session 14, owner: "when he's charging the sword, the sword and arm are clipping through the
  // cape": the hands were 0.28 m behind the hip and the blade ran back-down through the cloak. Now
  // the hands are before the right hip and the blade lies out to his right, low, past the cloak's
  // edge, where the camera behind him sees it charge; the cloak's sheets drape over the steel and
  // the arms instead of passing through them, anim.js _streamers)
  to3(p, P.rH, -0.06, -0.38, 0.13, 0.35 + 0.65 * sink);
  v3(p, P.rP, -0.9, -0.45, 0.05);
  dirTo(p, P.swD, -0.82, -0.45 - 0.08 * k, -0.36, 0.35 + 0.65 * sink);
  v3(p, P.swF, 0.4, 0.3, -0.3);
  p[P.twoHand] = smoothstep(0.1, 0.7, sink);
  v3(p, P.lP, 0.8, -0.4, -0.3);
  p[P.hs] = 0; // an open hand to the grip
  v3(p, P.rF, -0.17, ANK, -0.5);
  v3(p, P.lF, 0.17, ANK, 0.45);
  v3(p, P.rK, -0.5, 0, 1);
  v3(p, P.lK, 0.45, 0, 1);
}

/** The lunging thrust (the execution against a duelist; the charge's release until ADR-072; §4.7
 *  04–05): a launch at ~60° lean with the rear leg
 *  straight, settling into a deep lunge (front thigh horizontal, hips at 0.62 m, lean 40°) with
 *  BOTH arms driven straight out along the line, the blade level. The root itself travels forward
 *  (player.js). */
function thrustPose(p, A, t, W, Ac) {
  const k = clamp(A.releaseK, 0, 1);
  chargeStance(p, A, k, 1);
  // the windup whips the blade round from the hip onto the line, so the lunge drives it straight
  const wu = easeOutCubic(clamp(t / W, 0, 1));
  dirTo(p, P.swD, 0.0, -0.06, 1, wu);
  to3(p, P.rH, 0.1, -0.22, 0.3, wu);
  if (t < W) return;
  const v = clamp((t - W) / Ac, 0, 1);
  const e = easeOutCubic(v);
  const launch = Math.sin(Math.PI * clamp(v * 1.4, 0, 1)); // the 60° launch, settling to 40°
  p[P.bodyY] = lerp(p[P.bodyY], -0.27, e);
  p[P.bodyZ] = lerp(0, 0.16, e);
  p[P.pelvY] = lerp(p[P.pelvY], 0, e);
  p[P.spY] = lerp(p[P.spY], 0, e);
  p[P.spX] = lerp(p[P.spX], 0.66, e) + 0.3 * launch;
  p[P.hdY] = lerp(p[P.hdY], 0, e);
  p[P.hdX] = lerp(p[P.hdX], -0.5 - 0.2 * launch, e);
  to3(p, P.rH, 0.13, 0.02, 0.5, e);
  v3(p, P.rP, -0.6, -0.5, -0.4);
  dirTo(p, P.swD, 0.0, -0.02, 1, e);
  to3(p, P.swF, 0, 1, 0, e);
  p[P.twoHand] = 1;
  to3(p, P.lF, 0.15, ANK + 0.12 * launch, 0.7, e);
  to3(p, P.rF, -0.17, ANK, -0.62, e);
  to3(p, P.lK, 0.25, 0, 1, e);
  to3(p, P.rK, -0.2, -0.3, 1, e);
}

// ---------------------------------------------------------------- swing clips (swings.js)
// The hero's swings as keyframed clips: the sword hand and the blade follow splines through the
// clip's keys (so the point travels one smooth arc), the body's channels with them. A clip starts
// from the pose he was in (key 0 = the animator's `from`) and drives its channels itself (A.pathCh),
// so one cut runs into the next without the cross-fade flattening the arc.
const SW_SCAL = {
  bx: P.bodyX, by: P.bodyY, bz: P.bodyZ, hip: P.pelvY, hipX: P.pelvX, hipZ: P.pelvZ,
  sx: P.spX, sy: P.spY, sz: P.spZ, hx: P.hdX, hy: P.hdY, hz: P.hdZ, two: P.twoHand, offAt: P.offAt,
  hs: P.hs, lk: P.lk,
};
const SW_VEC = { h: P.rH, l: P.lH, rp: P.rP, lp: P.lP, f: P.swF, pn: P.lN };
const SW_DEG = Math.PI / 180;
const SW_ENTRY = 1.3; // the entry's tangent (× the straight rate): he leaves the last pose at speed
const SW_COIL = 0.35; // the blade's rate into the coil (× the straight rate) as it gets there
// (0.21, and the slam's and the cleave's 0.385: with 0.3 / 0.55 and a smoothstep both arms whipped
// home at 6-7 m/s and stopped dead on one frame, a freeze - snap - freeze after every swing)
const SW_HOME = 0.21; // the fraction of a recovery after which he starts back to the ready stance (a clip's `home`)
const SW_CLEAR = 0.24; // m: the sword hand's way to a coil stays this far from the spine (it bulges forward)
const SW_FLAT = [1.2, 3.2]; // rad per phase of blade turn: below, the keyed flat; above, the swing's plane
const SW_LEAD = [0.033, 0.017]; // s: how far ahead of the hand the hips / the chest run (a clip's `lead`)
const SW_LEAD_IN0 = [0.35, 0.6]; // the lead ramps in from this fraction of the windup (an entry from the far side: [1])
const SW_LEAD_FAR = 0.5; // rad: an entry whose hips stand this far from the coil's counts as far
const SW_LEAD_FADE = 18; // 1/s: a held light's hips settle back out of their lead (and run ahead again on release)
const SW_HIPS = new Set([P.bodyX, P.bodyY, P.bodyZ, P.pelvY, P.pelvX, P.pelvZ]);
const SW_CHEST = new Set([P.spX, P.spY, P.spZ]);
const SW_CACHE = new Map();
const SW_V = new Float32Array(6);
const SW_UP = [0, 1, 0];
const SW_PICK = new Uint8Array(8); // _pickVariant: the looks it may choose from

/** Compile a swings.js clip into tracks (slot 0 of each = the entry pose, filled at play time). */
function swingClip(name) {
  let C = SW_CACHE.get(name);
  if (C !== undefined) return C;
  const def = SWINGS[name];
  C = null;
  if (def && Array.isArray(def.keys)) {
    // (a key's free-hand preset, swings.js FH `fh: 'aim'`, lies under the key's own fields)
    const keys = def.keys.filter((k) => k && Number.isFinite(k.u) && k.u > 0).map((k) => (k.fh && FH[k.fh] ? { ...FH[k.fh], ...k } : k)).sort((a, b) => a.u - b.u);
    const track = (ch, n, get) => {
      const ks = keys.filter((k) => get(k) != null);
      if (!ks.length) return null;
      const U = new Float32Array(ks.length + 1), V = new Float32Array((ks.length + 1) * n);
      ks.forEach((k, i) => {
        U[i + 1] = k.u;
        const v = get(k);
        for (let c = 0; c < n; c++) V[(i + 1) * n + c] = n === 1 ? v : v[c];
      });
      return { ch, n, U, V, len: ks.length + 1 };
    };
    const tracks = [], ch = [];
    for (const f in SW_SCAL) {
      const T = track(SW_SCAL[f], 1, (k) => k[f]);
      if (T) {
        tracks.push(T);
        ch.push(T.ch);
      }
    }
    for (const f in SW_VEC) {
      const T = track(SW_VEC[f], 3, (k) => k[f]);
      if (T) {
        tracks.push(T);
        ch.push(T.ch, T.ch + 1, T.ch + 2);
      }
    }
    // the free hand's fingers: [az, el] in degrees (body axes, like the blade's `a`) × `lw` (its weight)
    {
      const T = track(P.lD, 3, (k) => (Array.isArray(k.ld) ? unitAzEl(k.ld[0], k.ld[1]).map((v) => v * (k.lw ?? 1)) : null));
      if (T) {
        tracks.push(T);
        ch.push(T.ch, T.ch + 1, T.ch + 2);
      }
    }
    // the blade: [az, el] in degrees (or a vector `d`) → unit vectors
    const dir = track(P.swD, 3, (k) => {
      if (Array.isArray(k.a)) {
        const az = k.a[0] * SW_DEG, el = k.a[1] * SW_DEG, c = Math.cos(el);
        return [c * Math.sin(az), Math.sin(el), c * Math.cos(az)];
      }
      if (Array.isArray(k.d)) {
        const l = Math.hypot(k.d[0], k.d[1], k.d[2]) || 1;
        return [k.d[0] / l, k.d[1] / l, k.d[2] / l];
      }
      return null;
    });
    if (dir) ch.push(P.swD, P.swD + 1, P.swD + 2, P.swF, P.swF + 1, P.swF + 2);
    const has = (f) => keys.some((k) => k[f] != null);
    if (has('h') && !has('rp')) ch.push(P.rP, P.rP + 1, P.rP + 2);
    if (has('l') && !has('lp')) ch.push(P.lP, P.lP + 1, P.lP + 2);
    if (!has('hy')) ch.push(P.hdY);
    if (!has('hx')) ch.push(P.hdX);
    C = {
      tracks, dir, hand: tracks.find((T) => T.ch === P.rH) ?? null, ch: [...new Set(ch)],
      autoR: has('h') && !has('rp'), autoL: has('l') && !has('lp'), autoHy: !has('hy'), autoHx: !has('hx'), keyedF: has('f'),
      two: keys.some((k) => k.two > 0), // (a two-handed clip keeps its free hand: offHand.js)
      flat: Array.isArray(def.flat) ? def.flat : SW_UP,
      rF: def.rF ?? null, lF: def.lF ?? null, step: def.step ?? null, drag: def.drag ?? 0.22, home: def.home ?? SW_HOME,
      lead: Array.isArray(def.lead) ? def.lead : SW_LEAD, fy: Array.isArray(def.fy) ? def.fy : null,
      fold: Number.isFinite(def.fold) ? def.fold : 1, // × the bite's chest fold and head nod (attackPose)
      hipCoil: keys.find((k) => k.hip != null && k.u >= 0.9 && k.u <= 1.0)?.hip ?? null, // the hips' turn at the coil
    };
    // (with lungeFeet the feet are its own too: it starts them from where they stood, A.entry, and
    // the cross-fade slid them while the root still drifted, out of a roll)
    C.chFeet = [...new Set([...C.ch, ...FOOT_CH])];
    for (const T of tracks) {
      T.grp = SW_HIPS.has(T.ch) ? 1 : SW_CHEST.has(T.ch) ? 2 : 0; // run ahead of the hand: 1 the hips, 2 the chest
      if (T.ch === P.bodyX) T.Vk = T.V.slice(); // the keyed values, mirrored per swing (swingPose)
    }
  }
  SW_CACHE.set(name, C);
  return C;
}

/** A track at phase u → o[off..] (Catmull-Rom through the keys; the entry leaves at speed). */
function swingTrack(T, u, o, off) {
  const { U, V, n, len } = T;
  if (u >= U[len - 1]) {
    for (let c = 0; c < n; c++) o[off + c] = V[(len - 1) * n + c];
    return;
  }
  let j = 0;
  while (j < len - 2 && u > U[j + 1]) j++;
  const t0 = U[j], t1 = U[j + 1], h = Math.max(1e-6, t1 - t0);
  const s = clamp((u - t0) / h, 0, 1), s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 0; c < n; c++) {
    const a = V[j * n + c], b = V[(j + 1) * n + c];
    const m0 = j === 0 ? (SW_ENTRY * (b - a)) / h : (b - V[(j - 1) * n + c]) / (t1 - U[j - 1]);
    const m1 = j === len - 2 ? 0 : (V[(j + 2) * n + c] - a) / (U[j + 2] - t0);
    o[off + c] = h00 * a + h10 * h * m0 + h01 * b + h11 * h * m1;
  }
}

/** The blade's direction at phase u → o[off..] (unit). From the entry pose to the first key (the
 *  coil) it turns round the hand, leaving at speed and still moving as it arrives; from there on a
 *  spline. It takes the short way round unless that way points the blade at his own spine on the
 *  way (the heading from the hand, half way through the windup, to the body's axis): then it goes
 *  round the other side, away from him.
 *  (dirLerp's rules are the carry's, for a hand hanging at the right hip: out of a recovery they
 *  sent a blade at his left front the long way round to a coil behind the left shoulder, through his
 *  right side and his back. Always turning round his front instead ran the blade through his hips
 *  when the hand was behind them, out of a roll.) */
function swingDir(C, F, u, o, off) {
  const T = C.dir, U = T.U, V = T.V;
  if (u < U[1]) {
    // (it leaves the last pose at speed and is still moving as it reaches the coil: a dead stop
    // there read as a hitch between two hits of a chain)
    const x = clamp(u / Math.max(1e-6, U[1]), 0, 1), e = SW_COIL * x + (1 - SW_COIL) * (1 - (1 - x) * (1 - x));
    const fx = F[P.swD], fy = F[P.swD + 1], fz = F[P.swD + 2], fl = Math.hypot(fx, fy, fz) || 1;
    const e0 = Math.asin(clamp(fy / fl, -1, 1)), e1 = Math.asin(clamp(V[4], -1, 1));
    if (Math.max(Math.abs(e0), Math.abs(e1)) > 1.3) {
      // (a blade standing nearly straight up or down has no heading: dirLerp borrows the other end's)
      dirLerp(o, off, fx, fy, fz, V[3], V[4], V[5], e);
    } else {
      const a0 = Math.atan2(fx, fz);
      let d = wrapAngle(Math.atan2(V[3], V[5]) - a0);
      const H = C.hand;
      if (H) {
        // the hand half way from the entry to the coil, from the spine (body axes: the sword
        // shoulder is DIM.gripShoulder to the right of it)
        const hx = 0.5 * (F[P.rH] + H.V[3]) - DIM.gripShoulder[0], hz = 0.5 * (F[P.rH + 2] + H.V[5]);
        if (Math.hypot(hx, hz) > 0.04) {
          const f = wrapAngle(Math.atan2(-hx, -hz) - a0);
          if (d > 0 ? f > 0 && f < d : f < 0 && f > d) d -= Math.sign(d) * TAU;
        }
      }
      const a = a0 + d * e, el = e0 + (e1 - e0) * e, c = Math.cos(el);
      v3(o, off, c * Math.sin(a), Math.sin(el), c * Math.cos(a));
    }
  } else {
    // (the entry slot only shapes the first key's tangent here: the blade settled into that key)
    V[0] = V[3];
    V[1] = V[4];
    V[2] = V[5];
    swingTrack(T, u, o, off);
  }
  const l = Math.hypot(o[off], o[off + 1], o[off + 2]);
  if (l > 1e-6) {
    o[off] /= l;
    o[off + 1] /= l;
    o[off + 2] /= l;
  } else v3(o, off, 0, 0, 1);
}

/** Elbow directions from where the hands are: down and out by the ribs, out to the side as a hand
 *  rises past the shoulder, under the arm as it crosses the body, back as it is drawn back. */
function swingPoles(p, right, left) {
  for (let k = 0; k < 2; k++) {
    if (k ? !left : !right) continue;
    const hi = k ? P.lH : P.rH, pi = k ? P.lP : P.rP, sg = k ? 1 : -1;
    const hx = p[hi] * -sg, hy = p[hi + 1], hz = p[hi + 2]; // hx: + = across the body
    const up = smoothstep(-0.12, 0.2, hy), across = smoothstep(0.08, 0.36, hx), back = 1 - smoothstep(-0.1, 0.12, hz);
    v3(p, pi, sg * lerp(lerp(0.72, 0.95, up), 0.3, across), lerp(lerp(-0.68, -0.05, up), -0.95, across * (1 - 0.6 * up)), lerp(-0.2, -0.65, back));
  }
}

/** A clip phase u (0..1 windup, 1..2 active, 2..3 recovery) as attack time (s). */
const phaseTime = (u, W, Ac, R) => (u < 1 ? u * W : u < 2 ? W + (u - 1) * Ac : W + Ac + (u - 2) * R);
/** Attack time t as a clip phase: 0 → 1 → 2 → 3 at 0, W, W + Ac, W + Ac + R exactly, with the rate
 *  eased through the two joins (a monotone cubic: the windup, the cut and the recovery each run at
 *  their own rate, and a straight map kinked the motion as the cut ended: half speed in one frame). */
function swingPhase(t, W, Ac, R) {
  if (t <= 0) return 0;
  const s0 = 1 / W, s1 = 1 / Ac, s2 = 1 / R;
  const m1 = (2 * s0 * s1) / (s0 + s1), m2 = (2 * s1 * s2) / (s1 + s2);
  let x, h, u0, a, b;
  if (t < W) {
    x = t / W;
    h = W;
    u0 = 0;
    a = s0;
    b = m1;
  } else if (t < W + Ac) {
    x = (t - W) / Ac;
    h = Ac;
    u0 = 1;
    a = m1;
    b = m2;
  } else {
    x = Math.min(1, (t - W - Ac) / R);
    h = R;
    u0 = 2;
    a = m2;
    b = s2;
  }
  const x2 = x * x, x3 = x2 * x;
  return u0 + (-2 * x3 + 3 * x2) + (x3 - 2 * x2 + x) * h * a + (x3 - x2) * h * b;
}

/** A swings.js clip at attack time t (windup W, active Ac, recovery R). */
function swingPose(p, A, k, t, W, Ac, R) {
  const C = swingClip(k.clip);
  const act = clamp((t - W) / Ac, 0, 1), lunge = t < W ? 0 : act * act * (3 - 2 * act);
  stance(p, A, lunge);
  if (!C) return;
  // (the swings' feel, feel.js `?feel=`: the same keys on another clock inside the same phases, the body's
  // sink and turn scaled, its lead stretched; production's without one)
  const Fl = feelLook();
  const u = warpPhase(swingPhase(t, W, Ac, R), Fl);
  const F = A.from;
  // the body runs AHEAD of the hand: the hips by lead[0] s, the chest by lead[1] (the kinetic chain:
  // hips, then chest, then arm, then blade). It ramps in through the windup (later when the entry's
  // hips stand on the far side: they would whip round). A held light's hips settle back (A.leadK)
  const L = C.lead, far = C.hipCoil != null && Math.abs(wrapAngle(F[P.pelvY]) - C.hipCoil) > SW_LEAD_FAR;
  const ramp = smoothstep(SW_LEAD_IN0[far ? 1 : 0] * W, W, t) * clamp(fin(A.leadK, 1), 0, 1) * (Fl ? Fl.lead : 1);
  const uH = ramp > 0 ? warpPhase(swingPhase(t + L[0] * ramp, W, Ac, R), Fl) : u, uC = ramp > 0 && L[1] > 0 ? warpPhase(swingPhase(t + L[1] * ramp, W, Ac, R), Fl) : u;
  const gIn = Fl ? smoothstep(0, 0.5, u) : 0; // (the feel's gains ease in over the windup's first half)
  // `bx` is toward the foot that steps (+): mirrored when the right foot steps (the entry slot keeps its own)
  const side = k.feet === 'dash' || A.stepL !== false ? 1 : -1;
  for (const T of C.tracks) {
    for (let c = 0; c < T.n; c++) T.V[c] = F[T.ch + c];
    if (T.Vk) for (let i = 1; i < T.len; i++) T.V[i] = side * T.Vk[i];
    swingTrack(T, T.grp === 1 ? uH : T.grp === 2 ? uC : u, p, T.ch);
    if (gIn > 0) {
      const G = Fl.gain, g = T.ch === P.bodyY ? G.by : T.ch === P.pelvY ? G.hip : T.ch === P.spY ? G.sy : T.ch === P.spX ? G.sx : 1;
      if (g !== 1) p[T.ch] *= 1 + (g - 1) * gIn;
    }
  }
  const H = C.hand;
  if (H && u < H.U[1]) {
    // the sword hand's way to the coil comes round in FRONT of his chest: a straight line from one
    // hip to the far shoulder (a new chain out of the last cut's finish) runs through the torso.
    // How near the line passes the spine (body axes, in plan) is how far it bulges forward
    const ax = F[P.rH] - DIM.gripShoulder[0], az = F[P.rH + 2], bx = H.V[3] - DIM.gripShoulder[0], bz = H.V[5];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const k = l2 > 1e-6 ? clamp(-(ax * dx + az * dz) / l2, 0, 1) : 0;
    const near = Math.hypot(ax + dx * k, az + dz * k);
    if (near < SW_CLEAR && k > 0.05 && k < 0.95) p[P.rH + 2] += (SW_CLEAR - near) * 1.6 * Math.sin(Math.PI * clamp(u / H.U[1], 0, 1));
  }
  if (C.dir) {
    swingDir(C, F, u, p, P.swD);
    // the flat: its keyed (or resting) normal while the blade is slow; the plane of the swing as it
    // turns (the edge leads the cut), on the side of the clip's `flat`
    swingDir(C, F, u + 0.04, SW_V, 0);
    const dx = p[P.swD], dy = p[P.swD + 1], dz = p[P.swD + 2];
    const nx = dy * SW_V[2] - dz * SW_V[1], ny = dz * SW_V[0] - dx * SW_V[2], nz = dx * SW_V[1] - dy * SW_V[0];
    const nl = Math.hypot(nx, ny, nz), w = smoothstep(SW_FLAT[0], SW_FLAT[1], nl / 0.04);
    const fr = C.flat;
    if (!C.keyedF) v3(p, P.swF, fr[0], fr[1], fr[2]);
    if (w > 0 && nl > 1e-6) {
      const sg = nx * fr[0] + ny * fr[1] + nz * fr[2] < 0 ? -1 / nl : 1 / nl;
      to3(p, P.swF, nx * sg, ny * sg, nz * sg, w);
    }
  }
  swingPoles(p, C.autoR, C.autoL);
  if (C.autoHy) p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.8; // the eyes stay on the target
  if (C.autoHx) p[P.hdX] = 0.02 - 0.55 * Math.max(0, p[P.spX] - 0.08);
  if (C.rF) {
    p[P.rF] = C.rF[0];
    p[P.rF + 2] = C.rF[1];
  }
  if (C.lF) {
    p[P.lF] = C.lF[0];
    p[P.lF + 2] = C.lF[1] + 0.12 * lunge;
  }
  if (C.fy) {
    // the stance's foot yaws [front, rear] (a left-front stance; lungeFeet mirrors them)
    p[P.lFy] = C.fy[0];
    p[P.rFy] = C.fy[1];
  }
  A.pathCh = C.ch;
}

/** The attack clip: a swings.js clip (the light chain and its finisher, the sprint and roll cuts,
 *  the charged cleave) or the execution's thrust, then the footwork and the way home. A light attack
 *  whose button is still held freezes at the coil (A.t is held at the windup end). */
function attackPose(p, A) {
  const d = A.def;
  if (!d) {
    guard(p, A);
    return;
  }
  const k = A.atkDef === d && A.atkAnim ? A.atkAnim : d.anim, t = A.t;
  const W = d.windup, Ac = d.active, R = d.recovery;
  if (k.kind === 'thrust') thrustPose(p, A, t, W, Ac);
  else swingPose(p, A, k, t, W, Ac, R);
  // footwork: the lunge is a real step (feet never skate with the root)
  if (k.kind === 'thrust') dashFeet(p, A, W);
  else if (k.feet === 'dash') dashFeet(p, A, k.dashW ? W : 0.04);
  else {
    const C = swingClip(k.clip), st = C?.step;
    // (a whirl that hops round its turn takes its own last step: no follow step)
    const follow = !(k.spin && (k.spinFeet ?? 'carry') === 'hop');
    lungeFeet(p, A, st ? phaseTime(st[0], W, Ac, R) : 0.03, st ? phaseTime(st[1], W, Ac, R) : W + Ac * 0.45, C?.drag ?? 0.22, true, follow);
    if (C) A.pathCh = C.chFeet;
  }
  if (k.spin) spinTurn(p, A, k.spin, t, W, Ac, k.spinFeet ?? 'carry');
  if (k.turn) {
    // a partial pivot carried through the follow-through (the feet turn with it), turning back late
    // in the recovery. It starts at mid-strike: turning the body while the blade is hit-tested moved
    // where the blade crossed his front, and the cut fell short at the edge of its reach
    pivotYaw(p, k.turn * (smoothstep(W + Ac * 0.5, W + Ac + R * 0.3, t) - smoothstep(W + Ac + R * 0.55, W + Ac + R, t)));
  }
  if (k.hop) {
    // a skip: off the ground through the windup's end and the strike's start, landing in the cut
    const h = k.hop * Math.sin(Math.PI * clamp((t - W * 0.35) / (W * 0.65 + Ac * 0.55), 0, 1));
    p[P.bodyY] += h;
    // (`tuck`: how far the feet lift, × the hop. Under 1 the legs hang; over 1 the knees draw up
    // under him, the rear foot more than the front: a leap, not a hover)
    const tuck = k.tuck ?? 0.7;
    p[P.rF + 1] += h * tuck;
    p[P.lF + 1] += h * tuck * (tuck > 1 ? 0.8 : 1);
    p[P.footFlat] = lerp(p[P.footFlat], 0.4, clamp(h / k.hop, 0, 1));
  }
  const rec = (t - W - Ac) / R;
  // the fraction of the recovery after which he starts home. A clip's last keys are still moving
  // then, so the follow-through runs into the way home without a stop (it was held to 0.5 of the
  // recovery, past the last key: the blade stood still for two frames and then snapped home in 0.12 s,
  // as fast as the cut)
  const home = k.kind === 'clip' ? swingClip(k.clip)?.home ?? SW_HOME : 0.315;
  if (rec > home) {
    // back toward the ready stance: the rear foot stays planted, the foot that stepped draws back
    // home in a recovery step (the foot planner settles the rest), and the sword hand comes round in
    // FRONT of the chest (a straight blend of the shoulder offsets ran it through the torso)
    for (let j = 0; j < FOOT_CH.length; j++) FOOT_KEEP[j] = p[FOOT_CH[j]];
    stand(SCRATCH, A);
    // (smootherstep: no speed and no acceleration left as the hands arrive)
    const hx = clamp((rec - home) / Math.max(1e-6, 1 - home), 0, 1), b = hx * hx * hx * (hx * (6 * hx - 15) + 10);
    // a finish over his LEFT shoulder (light 1) comes home round the FRONT: the ready blade now
    // lies out to his right, and the short way there from the left-back runs behind his head and
    // through the sword arm's shoulder
    HOME_WAY.ok = p[P.swD] > 0;
    HOME_WAY.d = -3;
    blend(p, p, SCRATCH, b, HOME_WAY);
    for (let j = 0; j < FOOT_CH.length; j++) p[FOOT_CH[j]] = FOOT_KEEP[j];
    p[P.rH + 2] += 0.24 * Math.sin(Math.PI * b);
    const u = smoothstep(0.42, 0.9, rec); // home a beat before the blade crosses back in front of the legs
    // (the foot that STEPPED: it was always the left, so after a right-foot step the rear left foot
    // stepped 13 cm forward while the right stayed out. A dash and the thrust land the left in front)
    const sL = k.feet === 'dash' || k.kind === 'thrust' || A.stepL !== false, fI = sL ? P.lF : P.rF, fY = sL ? P.lFy : P.rFy;
    // (it gets there while still lifted: landing, it no longer slides the last few centimetres)
    const uh = Math.min(1, u / 0.9);
    p[fI] = lerp(p[fI], SCRATCH[fI], uh);
    p[fI + 2] = lerp(p[fI + 2], SCRATCH[fI + 2], uh);
    p[fI + 1] = lerp(p[fI + 1], ANK, u) + 0.07 * Math.sin(Math.PI * u);
    p[fY] = lerp(p[fY], SCRATCH[fY], uh);
  }
  // inertia: the root's push-off leaves the chest behind the hips; its brake pitches it on over the
  // planted foot (A.leanF: the smoothed root acceleration, the loco's lean spring, set in update()
  // before the pose). Not on a dash: the cleave and the sprint slash key their own lean into it
  if (k.feet !== 'dash' && k.kind !== 'thrust') p[P.spX] -= ATK_INERTIA * fin(A.leanF, 0);
  // the BITE (atk.hitAt, set by player.js _applyHit on a landed, unguarded blow): the edge catches in
  // what it cut. The hips drop, the chest folds into the blow, the head nods, the grip pulls in along
  // the blade, and the blade holds where it bit. It is full through the hit-pause (the frozen clock
  // keeps t − hitAt ≈ 0) and lets go over BITE.dur of the attack's clock after it: the blade drags
  // behind its arc, then whips through to catch up. It is never pulled back past the frame that hit.
  const at = A.player?.atk;
  if (k.kind === 'clip' && at && at.def === d && fin(at.hitAt, -1) >= 0) {
    const s = t - at.hitAt, b = clamp(fin(d.bite, 1), 0, 2) * (1 - smoothstep(0, BITE.dur, s)), H = A.bite;
    if (H.rec !== at || H.at !== at.hitAt) {
      // (keyed on the record AND the time: two swings can hit at the very same clock time, and the
      // second one must not reuse the first one's blade)
      H.rec = at;
      H.at = at.hitAt;
      for (let c = 0; c < 3; c++) H.dir[c] = fin(A.cur[P.swD + c], c === 2 ? 1 : 0); // the blade the contact frame drew
    }
    if (b > 1e-3) {
      const w = Math.min(1, BITE.drag * b);
      for (let c = 0; c < 3; c++) p[P.swD + c] += (H.dir[c] - p[P.swD + c]) * w;
      for (let c = 0; c < 3; c++) p[P.rH + c] -= H.dir[c] * BITE.grip * b;
      // (the clip's `fold`: a blade held upright before the face takes no fold and no nod)
      const fold = clamp(fin(swingClip(k.clip)?.fold, 1), 0, 1);
      p[P.bodyY] -= BITE.sink * b;
      p[P.spX] += BITE.lean * b * fold;
      p[P.hdX] += BITE.nod * b * fold;
    }
  }
  // the free hand's look (offHand.js, `?offhand=`): a one-handed swing hangs it at its rest the whole attack,
  // its way home included (HeroAnimator._sideHand; it lingers there a moment after: _sideLinger)
  if (k.kind === 'clip' && A.freeHand) {
    const L = offHandLook();
    if (L && !swingClip(k.clip)?.two) sideHand(p, 0, p, L);
  }
}

// THE SIDE HAND (offHand.js: the free hand's look in a one-handed swing). The pose only says WHETHER it hangs
// (p[sd], going home with the rest of him) and the hand's shape; where it is comes from
// HeroAnimator._sideHand: a rest the body carries with a damped pendulum on it, so it lags the body's turn
// and drop a little and swings back past its rest before it settles. (First written for the instant cuts,
// ADR-233: rigid in the chest's frame it read stiff; left to hang free from the shoulder, the chest's snaps
// folded the elbow and whipped the hand about.)
const SIDE_CH = [P.lk, P.twoHand, P.offAt];
/** p[i..i+2] = v × k turned by the chest's yaw (cos c, sin s), `b` of the way to D's. */
function sidePut(p, i, v, k, c, s, b, D) {
  p[i] = lerp(k * (v[0] * c + v[2] * s), D[i], b);
  p[i + 1] = lerp(k * v[1], D[i + 1], b);
  p[i + 2] = lerp(k * (-v[0] * s + v[2] * c), D[i + 2], b);
}
/** The free hand's channels at its look L's rest (sd 1): its elbow, fingers, palm and shape where the look
 *  gives them (the quiet look keeps the clip's); `b` (0..1) of the way to pose D's own (D may be p). */
function sideHand(p, b, D, L) {
  if (!(b > 0)) b = 0;
  const yaw = p[P.pelvY] + p[P.spY], c = Math.cos(yaw), s = Math.sin(yaw);
  if (L.pole) sidePut(p, P.lP, L.pole, 1, c, s, b, D);
  if (L.ld) sidePut(p, P.lD, L.ld, L.lw, c, s, b, D);
  if (L.ln) sidePut(p, P.lN, L.ln, L.lw, c, s, b, D);
  if (L.hs != null) p[P.hs] = lerp(L.hs, D[P.hs], b);
  if (!(L.keep > 0)) for (let j = 0; j < SIDE_CH.length; j++) p[SIDE_CH[j]] = b * D[SIDE_CH[j]];
  p[P.sd] = 1 - b;
}
// the bite: its length (s of the attack's clock after the hit-pause), how much of the way back to
// the blade that bit it holds (× bite), the grip's pull (m), the hips' drop (m), the chest's fold
// and the head's nod (rad). × the def's `bite` (combat.js; default 1)
const BITE = { dur: 0.08, drag: 0.6, grip: 0.03, sink: 0.045, lean: 0.1, nod: 0.08 };
const ATK_INERTIA = 0.35; // × A.leanF (rad): the chest's pitch from the root's step in an attack
/** Turn the whole pose `yaw` rad about the root (+ = to his left). The feet are planted: they pivot
 *  on their balls where they stand, the heels up as the turn grows. (Their spots used to turn round
 *  the root with the body, and a planted foot slid 0.15-0.26 m.) */
function pivotYaw(p, yaw) {
  if (Math.abs(yaw) < 1e-5) return;
  p[P.yaw] += yaw;
  p[P.rFy] += yaw;
  p[P.lFy] += yaw;
  const b = Math.min(1, Math.abs(yaw) / 0.3);
  p[P.rFf] = Math.min(p[P.rFf], 1 - 0.4 * b);
  p[P.lFf] = Math.min(p[P.lFf], 1 - 0.4 * b);
}
/** The whirl (combo hit 3, `anim.spin` ±1: − = he turns to his right): the whole body turns once
 *  about its axis from just before the active frames to their end. The turn ends on exactly one
 *  revolution, written as 0, so nothing unwinds afterwards; its momentum carries him a little past
 *  it and he settles back (SPIN_OV). The hips run ahead of the turn and the chest trails it
 *  (SPIN_LEAD). The feet (`anim.spinFeet`, combat.js):
 *    'carry' — carried round with the body in two quick pivot steps (their stance spots turn with
 *              it, each lifted in turn: a planted foot skated 1.2-1.4 m round the root);
 *    'hop'   — off the grass through the fast part of the turn: both feet leave their spots (from
 *              lungeFeet: A.spots) by SPIN_HOP.up, are carried round in the air and land on the
 *              stance spots by SPIN_HOP.down, planted from there; the rest of the turn is taken on
 *              the balls of the feet. */
function spinTurn(p, A, dir, t, W, Ac, mode = 'carry') {
  const t0 = W - 0.1, t1 = W + Ac, hop = mode === 'hop';
  if (t <= t0) return;
  const H = SPIN_HOP, S = A.spots, tr = A.trav;
  const stepL = A.stepL !== false;
  if (t >= t1) {
    if (hop) {
      // landed: the feet stay on the stance spots they landed on (lungeFeet's holding foot would
      // sit 0.6 m behind them after the whirl's step); the way home moves the one that stepped
      const mL = A.mark(3, t0 + H.down[1] * (t1 - t0));
      for (let k = 0; k < 2; k++) {
        const i = k ? P.lF : P.rF, front = k ? stepL : !stepL;
        p[i] = (front ? S[2] : S[0]) - (tr.x - mL.x);
        p[i + 1] = ANK;
        p[i + 2] = (front ? S[3] : S[1]) - (tr.z - mL.z);
      }
    }
    // the turn's momentum carries him on past the full turn and he settles back (a critically damped
    // spring let go at the turn's last speed: it stopped dead from ~20 rad/s in one frame). The feet
    // pivot on their balls
    const s = t - t1;
    if (s < SPIN_OV.len) {
      const v0 = (TAU * 0.8) / (t1 - t0); // e'(1) = 0.8
      const y = dir * v0 * s * Math.exp(-s / SPIN_OV.tau) * (1 - smoothstep(SPIN_OV.len * 0.6, SPIN_OV.len, s));
      p[P.yaw] += y;
      p[P.rFy] += y;
      p[P.lFy] += y;
      p[P.hdY] = clamp(p[P.hdY] - y, -NECK_TURN, NECK_TURN); // the eyes stay on the target
    }
    return;
  }
  const u = (t - t0) / (t1 - t0);
  // eased in, still fast at the end: the blade crosses the front at speed
  const e = u * u * (2.2 - 1.2 * u);
  const yaw = dir * TAU * e;
  p[P.yaw] += yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const w = Math.sin(Math.PI * u);
  if (!hop) {
    for (let k = 0; k < 2; k++) {
      const i = k ? P.lF : P.rF, x = p[i], z = p[i + 2];
      p[i] = x * c + z * s;
      p[i + 2] = z * c - x * s;
      // the right foot steps round first, then the left
      p[i + 1] += 0.07 * Math.max(0, Math.sin(Math.PI * clamp(k ? u * 2 - 1 : u * 2, 0, 1)));
    }
  } else {
    // each foot leaves the grass from where it really stands (lungeFeet's foot: planted, or mid-step)
    // and is carried round WITH the body: its angle about the root grows with the turn while it moves
    // across the body, round its own side, from the spot it left (A.hop: caught as it lifts, in the
    // turned body's frame) to its stance spot (A.spots), drawn in at the top of the flight; landing,
    // it runs on round with the turn onto its spot, planted from there. Blended in angle and radius
    // about the root: a straight-line blend from the grass to the turned spot cut through the middle
    // (a foot jumped 26 cm in a frame, the legs scissored and turned 40-48° a frame)
    const up = smoothstep(H.up[0], H.up[1], u), dn = smoothstep(H.down[0], H.down[1], u);
    const fl = Math.sin(Math.PI * clamp((u - H.up[0]) / (H.down[1] - H.up[0]), 0, 1));
    const g = smoothstep(H.up[0], H.down[0], u); // across the body: the spot it left → its stance spot
    const yawF = yaw + dn * (dir * TAU - yaw); // how far round the feet are carried (on to the full turn as they land)
    const mL = A.mark(3, t0 + H.down[1] * (t1 - t0)), Hf = A.hop;
    if (!Hf.set && u >= H.up[0]) {
      Hf.set = true;
      Hf.yaw = yaw;
      for (let k = 0; k < 2; k++) {
        const i = k ? P.lF : P.rF;
        Hf.a[k] = Math.atan2(fin(p[i], 0), fin(p[i + 2], 0));
        Hf.r[k] = Math.hypot(fin(p[i], 0), fin(p[i + 2], 0));
      }
    }
    for (let k = 0; Hf.set && k < 2; k++) {
      const i = k ? P.lF : P.rF, front = k ? stepL : !stepL;
      const sx = front ? S[2] : S[0], sz = front ? S[3] : S[1];
      if (u >= H.down[1]) {
        // landed: planted on its stance spot
        p[i] = sx - (tr.x - mL.x);
        p[i + 1] = ANK;
        p[i + 2] = sz - (tr.z - mL.z);
        continue;
      }
      const bx = p[i], bz = p[i + 2], by = p[i + 1], aB = Math.atan2(bx, bz);
      // in the air: the angle (the spot it left in the body's frame, on round its own side to the
      // stance spot's, + the turn) and the radius (tucked in at the top)
      const aS = Math.atan2(sx, sz), a0 = Hf.a[k] - Hf.yaw, across = wrapAngle(aS - a0);
      const rAir = lerp(Hf.r[k], Math.hypot(sx, sz), g) * (1 - (1 - H.tuck) * fl);
      // (from the grass: the angle still to go is unwrapped through the turn, not wrapped)
      const ang = aB + up * (yawF - Hf.yaw + g * across + wrapAngle(Hf.a[k] - aB)), rad = lerp(Math.hypot(bx, bz), rAir, up);
      p[i] = rad * Math.sin(ang);
      p[i + 2] = rad * Math.cos(ang);
      p[i + 1] = Math.max(ANK, lerp(by, ANK, up)) + H.lift * fl;
    }
    p[P.bodyY] += H.rise * fl;
  }
  p[P.rFy] += yaw;
  p[P.lFy] += yaw;
  p[P.rFf] = p[P.lFf] = 0.5; // on the balls of the feet through the turn
  // the hips run ahead of the turn and the chest trails it (the turn is driven from the hips)
  p[P.pelvY] += dir * SPIN_LEAD[0] * w;
  p[P.spY] -= dir * SPIN_LEAD[1] * w;
  // he drops into the turn and leans to the inside of it (he stood bolt upright through it, turning
  // like a figure on a turntable), and his head SPOTS: it stays on the target while the body turns
  // away, comes round ahead of the body and finds the target again before the shoulders do
  p[P.bodyY] -= 0.07 * w;
  p[P.spZ] -= dir * 0.13 * w;
  p[P.spX] += 0.06 * w;
  p[P.hdY] = clamp(p[P.hdY] - dir * SPIN_SPOT * Math.sin(TAU * e) - dir * 0.1 * w, -NECK_TURN, NECK_TURN);
}
const NECK_TURN = 1.0; // rad: the most the head turns on the chest in a whirl (it reached 76°)
const SPIN_SPOT = 0.6; // rad: how far the head turns back toward the target (and then ahead of the body) in a whirl
const SPIN_OV = { tau: 0.033, len: 0.2 }; // the whirl's overshoot: its spring's time constant (peak ~14° at 2 frames), how long it runs (s)
const SPIN_LEAD = [0.22, 0.12]; // rad (× sin over the turn): the hips run ahead of the whirl, the chest trails it
// the whirl's hop ('hop' feet): the feet leave the grass over u ∈ up, land over u ∈ down (u: the
// turn's own phase; landing late, the turn left to take on the balls of the feet is ~16°), lifted
// `lift` m at the top, drawn in to `tuck` × their stance's spread there, the hips risen `rise` m
const SPIN_HOP = { up: [0.08, 0.32], down: [0.7, 0.95], lift: 0.09, tuck: 0.65, rise: 0.05 };

const FOOT_CH = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rFy, P.lFy];
const FOOT_KEEP = new Float32Array(FOOT_CH.length);
const HOME_WAY = { d: -3, ok: false }; // dirLerp memory: the recovery's way home (− = clockwise from above, through the front)

/** Attack footwork: he WALKS through a chain. The foot that is behind as the swing starts steps
 *  through onto the stance's front spot between t0 and t1 (lift, reach, plant) and then stays planted
 *  while the body carries on over it; the other foot stays on its spot while the root lunges, its
 *  heel peeling as the hips drive, dragged along only once the leg is stretched `drag` m past the
 *  stance's rear spot. So the lead foot changes with every hit (left, right, left …) instead of the
 *  same left-foot lunge each time. Uses the clip's entry feet and the root travel (A.entry, A.trav),
 *  so the swing starts from where the feet really are. `p` holds the stance (left foot forward) the
 *  clip wants: its spots are mirrored when the right foot is the one that steps.
 *  The holding foot stays where it stood (it used to settle sideways onto the stance line: 8-12 cm
 *  of skate every light): once stretched past `drag` its TOE drags after the body (A.footDrag), and
 *  just after the front foot has taken the weight it takes ONE lifted follow step (跟步) up onto the
 *  stance line (A.follow; not with `follow` false: a whirl that hops round its turn). While a held
 *  light waits at the coil the stepping foot rests on the grass (A.coilHold: an empty stance, 虚步).
 *  (Session 25, owner: "his legs and feet do the same thing every hit".) */
function lungeFeet(p, A, t0, t1, drag, plant, follow = true) {
  const t = A.t, E = A.entry, tr = A.trav;
  // the stepping foot: the one further back along his facing (the left from the ready stance; play())
  const stepL = A.stepL !== false;
  const sI = stepL ? P.lF : P.rF, hI = stepL ? P.rF : P.lF; // stepping / holding foot
  const sY = stepL ? P.lFy : P.rFy, hY = stepL ? P.rFy : P.lFy, hF = stepL ? P.rFf : P.lFf;
  const sE = stepL ? 3 : 0, hE = stepL ? 0 : 3, sYE = stepL ? 7 : 6, hYE = stepL ? 6 : 7;
  // the stance's spots: front for the stepping foot, rear for the holding one (each on its own side)
  const frontX = Math.abs(p[P.lF]), frontZ = p[P.lF + 2], rearX = Math.abs(p[P.rF]), rearZ = p[P.rF + 2];
  const frontYaw = stepL ? p[P.lFy] : -p[P.lFy], rearYaw = stepL ? p[P.rFy] : -p[P.rFy];
  const sg = stepL ? 1 : -1; // the stepping foot's side (+x = his left)
  // the holding foot's stance spot (where a follow step takes it), the stretch at which it drags, and
  // where it really stands: planted (model space, carried back by the root's travel)
  const sx = -sg * rearX, sz = rearZ, lim = sz - drag, hx0 = E[hE] - tr.x, hzW = E[hE + 2] - tr.z;
  // stepping foot: held → the step → planted on its spot while the root carries on
  const m0 = A.mark(0, t0), m1 = A.mark(1, t1);
  const lx = E[sE] - (t < t0 ? tr.x : m0.x), lz = E[sE + 2] - (t < t0 ? tr.z : m0.z);
  // (never across the holding foot, which no longer settles onto the stance line)
  let tx = sg * frontX, tz = frontZ;
  if (sg * (tx - hx0) < FOOT_GAP) tx = hx0 + sg * FOOT_GAP;
  // (the spot it planted on: the stance's front spot creeps on with the cut, + 0.12 × lunge, and slid
  // the planted foot ~7 cm on after it landed)
  const Pl = A.plantAt;
  if (plant && t > t1 && Pl.ok) {
    tx = Pl.x;
    tz = Pl.z;
  } else {
    Pl.x = tx;
    Pl.z = tz;
    Pl.ok = true;
  }
  const u = clamp((t - t0) / Math.max(0.02, t1 - t0), 0, 1);
  const e = u * u * (3 - 2 * u);
  let fx = lerp(lx, tx, e), fz = lerp(lz, tz, e);
  if (plant && t > t1) {
    // planted: the root's further travel moves the body over the foot
    fx -= tr.x - m1.x;
    fz -= tr.z - m1.z;
  }
  // (a foot that passes the other swings round it, not through its ankle)
  const pass = Math.sin(Math.PI * u) * clamp(Math.abs(tz - lz) / 0.5, 0, 1);
  const ch = clamp(fin(A.coilHold, 0), 0, 1); // a held light at the coil: the foot rests mid-step
  p[sI] = fx + sg * 0.04 * pass;
  p[sI + 1] = Math.max(ANK, lerp(E[sE + 1], ANK, e)) + (0.07 + 0.06 * clamp(Math.abs(tz - lz) / 0.6, 0, 1)) * Math.sin(Math.PI * u) * (1 - ch) + COIL_HOLD.toeY * ch;
  p[sI + 2] = fz;
  p[sY] = lerp(E[sYE], frontYaw, e);
  p[stepL ? P.lFf : P.rFf] = lerp(lerp(1, 0.45, Math.sin(Math.PI * u)), COIL_HOLD.flat, ch); // toe-off, the sole level again to land
  // holding foot: planted where it stood (moved only by what it was dragged, A.holdOff); its heel
  // peels as the body passes over it and the hips turn (the toe pivots), settling after
  const Ho = A.holdOff;
  let hx = hx0 + Ho.x, hz = hzW + Ho.z, hy = lerp(Math.max(ANK, E[hE + 1]), ANK, smoothstep(0, 0.05, t));
  let hf = lerp(1, 0.3, smoothstep(t0 + 0.3 * (t1 - t0), t1, t) * (1 - smoothstep(t1 + 0.12, t1 + 0.3, t)));
  let dragging = false;
  if (hz < lim) {
    // stretched `drag` past the stance's rear spot: dragged after the body
    Ho.z += lim - hz;
    hz = lim;
    dragging = true;
  }
  const Fo = A.follow, dragged = Math.hypot(Ho.x, Ho.z) > FOLLOW.min;
  if (Fo.on < 0 && (t >= t1 + FOLLOW.at || (t >= t1 && dragged))) {
    // decided once: a foot dragged after the body as the front one takes the weight follows it, as
    // soon as the front foot is down if it is being dragged already (its toe skated on 10-20 cm until
    // the step began, as the root's push carried the body away from it)
    Fo.on = follow && plant && dragged ? 1 : 0;
    Fo.x = hx;
    Fo.z = hz;
    Fo.t0 = t;
    Fo.t1 = t + FOLLOW.dur;
  }
  const fT0 = Fo.on === 1 ? Fo.t0 : t1 + FOLLOW.at, fT1 = fT0 + FOLLOW.dur, mF = A.mark(2, fT1);
  if (Fo.on === 1) {
    // ONE lifted step up onto the stance line (never closer than FOLLOW.gap behind the front foot,
    // never back)
    const zT = Math.max(Fo.z, Math.min(sz - FOLLOW.back * drag, fz - FOLLOW.gap));
    const v = clamp((t - fT0) / FOLLOW.dur, 0, 1), e2 = v * v * (3 - 2 * v);
    hx = lerp(Fo.x, sx, e2);
    hz = lerp(Fo.z, zT, e2);
    if (t > fT1) {
      // planted from its landing
      hx -= tr.x - mF.x;
      hz -= tr.z - mF.z;
    }
    hy = ANK + FOLLOW.lift * Math.sin(Math.PI * v);
    hf = lerp(0.6, 1, e2);
  }
  {
    // … and within the leg's reach of its hip (the hips this clip keys, turned with the pelvis): where
    // they stand too high or too far over the front foot for it (a rising cut stands up onto a straight
    // front leg), the IK lifted the planted foot 5-10 cm off the grass and slid it along. Its toe drags
    // up after the hips instead, and stays where it was dragged to
    const a = fin(p[P.yaw], 0) + fin(p[P.pelvY], 0), hs = -sg * DIM.hip[0];
    const ax = fin(p[P.bodyX], 0) + hs * Math.cos(a), az = fin(p[P.bodyZ], 0) - hs * Math.sin(a);
    const dy = DIM.pivot + DIM.pelvis[1] + DIM.hip[1] + fin(p[P.bodyY], 0) - hy;
    const reach = HOLD_REACH * (DIM.thigh + DIM.shin), room = Math.sqrt(Math.max(0, reach * reach - dy * dy));
    const dx = hx - ax, dz = hz - az, dh = Math.hypot(dx, dz);
    if (dh > room + 1e-4 && dh > 1e-6) {
      const k = room / dh, nx = ax + dx * k, nz = az + dz * k;
      if (Fo.on !== 1) {
        Ho.x += nx - hx;
        Ho.z += nz - hz;
      }
      hx = nx;
      hz = nz;
      dragging = true;
    }
  }
  // stretched: the TOE drags after the body. Onto the toe at once; the heel settles back down over a
  // few frames after (it slapped down from the toe in one frame as a drag ended)
  A.toeK = dragging && Fo.on !== 1 ? 1 : damp(fin(A.toeK, 0), 0, FOLLOW.heel, fin(A.frameDt, 0));
  if (A.toeK > 1e-3) hf = lerp(hf, Math.min(hf, FOLLOW.toe), A.toeK);
  A.footDrag = dragging && Fo.on !== 1 ? (stepL ? 1 : 2) : 0; // (bit 1: the right toe drags, 2: the left)
  p[hI] = hx;
  p[hI + 1] = hy;
  p[hI + 2] = hz;
  p[hF] = hf;
  // (its yaw turns with the heel up, on the ball, not flat)
  p[hY] = lerp(E[hYE], rearYaw, smoothstep(t0 + 0.3 * (t1 - t0), t1 + 0.15, t));
  const S = A.spots;
  S[0] = sx;
  S[1] = sz;
  S[2] = tx;
  S[3] = tz;
}
const FOOT_GAP = 0.18; // m: the stepping foot lands at least this far to its own side of the holding one
const HOLD_REACH = 0.97; // × the leg's length: the farthest the holding foot stays from its hip (else it drags)
// the follow step: from `at` s after the plant (from the plant itself when the foot is being dragged
// already), `dur` s long, onto the stance line `back` × drag behind its spot (and ≥ `gap` m behind
// the front foot), lifted `lift` m; only when the foot is dragged more than `min` m; a dragging
// foot's sole is down to `toe`, its heel settling back at `heel` (1/s) once it stops
const FOLLOW = { at: 0.02, dur: 0.09, back: 0.4, gap: 0.45, lift: 0.045, min: 0.03, toe: 0.35, heel: 30 };
// a held light at the coil: how fast the stepping foot settles (1/s), where its ankle rests (m above
// its standing height) and its sole (footFlat). Set down level, the sole on the grass: the rig pitches
// a foot only between level and square to the shin, which stands upright mid-step, so the "toe down,
// heel up" sole (0.35, the ankle 3 cm up) came out level and hovered 4 cm above the grass
const COIL_HOLD = { rate: 25, toeY: -0.005, flat: 1 };
/** A dash (the cleave's, the execution thrust's: 2.2-3.6 m of root travel in ~0.25 s) as TWO bounding steps instead of a
 *  front foot skidding the whole way: the rear (right) foot pushes off and swings through to land
 *  under the body mid-dash; the front (left) foot leaves the grass just before it lands (a short
 *  flight) and reaches into the lunge, landing as the dash dies out. Each foot is held on its world
 *  spot from touchdown; the rear one, left behind by the rest of the dash, stretches out and drags
 *  its toe once the leg is straight. Landing times follow the charge (the dash is longer, so the
 *  rear foot lands later to leave ~1 m of travel after it). Touchdowns are footsteps (+ dust). */
const DASH = {
  rLand: [0.175, 0.215], // s: rear foot touchdown (no charge → full charge)
  lLift: 0.06, // s before that the front foot leaves the grass
  lLand: 0.275, // s: front foot touchdown (the dash is ~93 % done)
  rSpot: [-0.16, 0.2], lSpot: [0.15, 0.58], // touchdown spots (model x, z)
  rReach: -0.5, // model z: the stretched rear leg drags its toe from here on
};
function dashFeet(p, A, W) {
  const t = A.t, E = A.entry, tr = A.trav;
  // (this attack's own charge: the stale releaseK, set only by a heavy, gave the sprint slash the last
  // cleave's timing)
  const k = clamp(fin(A.player?.atk?.charge, 0), 0, 1);
  const tR1 = lerp(DASH.rLand[0], DASH.rLand[1], k), tL0 = tR1 - DASH.lLift, tL1 = DASH.lLand;
  const m0 = A.mark(0, W), m1 = A.mark(1, tL0), m2 = A.mark(2, tR1), m3 = A.mark(3, tL1);
  // rear (right) foot
  let x, y, z, fl;
  if (t < W) {
    x = E[0] - tr.x;
    y = Math.max(ANK, E[1]);
    z = E[2] - tr.z;
    fl = 1;
  } else if (t < tR1) {
    const u = (t - W) / (tR1 - W), e = u * u * (3 - 2 * u);
    x = lerp(E[0] - m0.x, DASH.rSpot[0], e);
    z = lerp(E[2] - m0.z, DASH.rSpot[1], e);
    y = ANK + 0.22 * Math.sin(Math.PI * Math.pow(u, 0.75)); // the knee drives up and through
    fl = lerp(0.2, 0.85, smoothstep(0.55, 1, u)); // toe pushes off, the sole comes level to land
  } else {
    x = DASH.rSpot[0] - (tr.x - m2.x);
    z = DASH.rSpot[1] - (tr.z - m2.z);
    y = ANK;
    fl = 1;
    if (z < DASH.rReach) {
      // stretched: the toe drags behind the lunge (the ankle rises as the straight leg tilts)
      y += 0.35 * (DASH.rReach - z);
      z = DASH.rReach - 0.4 * (DASH.rReach - z);
      fl = 0.25;
    }
  }
  p[P.rF] = x;
  p[P.rF + 1] = y;
  p[P.rF + 2] = z;
  p[P.rFf] = fl;
  p[P.rFy] = lerp(E[6], 0, smoothstep(W, W + 0.06, t));
  // front (left) foot
  if (t < tL0) {
    x = E[3] - tr.x;
    y = Math.max(ANK, E[4]);
    z = E[5] - tr.z;
    fl = 1 - 0.6 * smoothstep(tL0 - 0.05, tL0, t); // heel peels as the push-off comes
  } else if (t < tL1) {
    const u = (t - tL0) / (tL1 - tL0), e = u * u * (3 - 2 * u);
    x = lerp(E[3] - m1.x, DASH.lSpot[0], e);
    z = lerp(E[5] - m1.z, DASH.lSpot[1], e);
    y = ANK + 0.16 * Math.sin(Math.PI * u);
    fl = lerp(0.4, 0.9, smoothstep(0.5, 1, u));
  } else {
    x = DASH.lSpot[0] - (tr.x - m3.x);
    z = DASH.lSpot[1] - (tr.z - m3.z);
    y = ANK;
    fl = 1;
  }
  p[P.lF] = x;
  p[P.lF + 1] = y;
  p[P.lF + 2] = z;
  p[P.lFf] = fl;
  p[P.lFy] = lerp(E[7], 0, smoothstep(tL0, tL0 + 0.06, t));
  // touchdowns: footsteps with a puff of dust (the planner's footstep hook)
  const st = A.dashStep;
  if (t >= tR1 && !(st & 1)) {
    A.dashStep = st | 1;
    if (A.onFootstep) A.onFootstep(-1, 0.6);
  }
  if (t >= tL1 && !(A.dashStep & 2)) {
    A.dashStep |= 2;
    if (A.onFootstep) A.onFootstep(1, 0.9);
  }
}

/** Charge (the cleave's windup): a deep, wide stance coiled away from the target, both hands on the
 *  grip beside the right ear and the blade standing nearly upright beside his head, where it glows
 *  clear of his body from every side; the spring winds tighter as the charge builds (lower, more
 *  twisted away, the point tipping back a little), and trembles when full. The legs can still walk
 *  (slowly). The coat and hair lift in the charge's updraft (A.updraft, the cloth / hair sims).
 *  (Session 25, owner: "when he charges the sword the arm bend is all messed up": both hands were
 *  drawn down to the right hip with the blade out to his side, the sword elbow jutting out level and
 *  the free arm folded across the belly. Hands at ear height bend both elbows the way a raised
 *  two-handed guard does. Then: "it looks like the sword is piercing through him": the first version
 *  leaned the blade 34-44° back over the shoulder, and from the camera behind and above him a blade
 *  leaning toward the camera is drawn DOWN across his back. Nearly upright, it stands above his
 *  shoulder on screen whichever way he faces.) */
// (Session 30, owner: "when charging, the sword is piercing the characters face": the blade stood
// 0.10 m from the head's axis, 3-7 cm INSIDE the hood, because it leaned back toward a head that
// leans forward. It leans out to his right now and the hands sit lower and further forward: the
// steel passes ≥ 0.26 m from the head's axis, a hand's width clear of the hood.)
const CHARGE_SW = [-82, 80, 74]; // the blade: azimuth, elevation at no charge … full (degrees)
function chargePose(p, A) {
  const k = clamp(A.chargeK, 0, 1), s = smoothstep(0, 0.25, A.t), w = s * k;
  stance(p, A, 0);
  v3(p, P.rF, -0.18, ANK, -0.47);
  v3(p, P.lF, 0.17, ANK, 0.44);
  v3(p, P.rK, -0.5, 0, 1);
  v3(p, P.lK, 0.45, 0, 1);
  p[P.bodyY] = lerp(-0.12, -0.2, s) - 0.05 * w;
  p[P.bodyZ] = -0.03 * s; // the weight back over the rear leg
  p[P.pelvY] = -0.28 * s - 0.08 * w;
  p[P.spY] = -0.4 * s - 0.14 * w;
  p[P.spX] = lerp(0.1, 0.2, s) + 0.05 * w; // (0.26 + 0.07: the bow carried his head forward into the steel)
  p[P.spZ] = 0;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.85; // eyes stay on the target
  p[P.hdX] = -0.1 * s;
  // (the hands and the blade are there at once: the clip's cross-fade carries them up from the
  // light swing's coil, where the blade already stands behind the right shoulder; easing them in
  // from the ready stance as well swung the steel up through the sword arm)
  // The grip is held OUT from him, a forearm's length before the right shoulder, the sword elbow
  // lifted out to the side: both forearms come in across the upright grip, so the wrists sit square
  // to the steel. (Session 26, owner: "while charging the right hand makes an unnatural angle": the
  // hands were 0.11 m before the shoulder. The sword elbow was folded to 18°, the forearm stood up
  // under the hilt in one line with the blade, and the off hand was inside his chest.)
  v3(p, P.rH, -0.1, -0.11 + 0.02 * k, 0.31);
  // (the elbow lifts out once the blade is up: lifted at once, the upper arm stood in the way of the
  // steel coming up from a light swing's coil)
  const lift = smoothstep(0.12, 0.36, A.t);
  v3(p, P.rP, lerp(-0.85, -0.92, lift), lerp(-0.5, -0.06, lift), lerp(-0.15, -0.3, lift));
  const az = CHARGE_SW[0] * SW_DEG, el = lerp(CHARGE_SW[1], CHARGE_SW[2], k) * SW_DEG;
  v3(p, P.swD, Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  v3(p, P.swF, 0.8, 0.3, -0.5);
  p[P.twoHand] = smoothstep(0.1, 0.7, s);
  v3(p, P.lP, 0.8, -0.45, 0.35);
  p[P.hs] = 0; // an open hand to the grip
  if (k >= 0.999) {
    const q = Math.sin(A.time * 47) * 0.012;
    p[P.bodyX] += q;
    p[P.swD] += q * 2;
  }
  walkLegs(p, A);
}

/** Block, the cross ward: sunk low and side-on (the left foot well forward, the hips and chest
 *  turned away behind the steel), both hands on the grip before the chest and the blade slanting up
 *  across the whole body to past the left shoulder (~38° up), its point above his head, the flat to
 *  the enemy. A blocked blow (A.recoil) drives the guard back into the chest.
 *  (Session 25, owner: "make his guard stance have a deeper angle", then "blade and stance", three
 *  rendered guards, and on the preview "raise its hand up more": the first cross ward held the grip
 *  low outside the right hip. Session 14's guard stood nearly upright with the blade ~50° up: from
 *  the game camera behind him only its point showed over his head. The flatter slant shows as a bar
 *  across his back from behind and across his front from ahead.
 *  Before Session 14: one hand at the right ribs, the blade 25° up across the belly.) */
const BLOCK_FEET = [-0.22, -0.33, 0.14, 0.34]; // the stance it settles into: right x, z; left x, z
function blockPose(p, A) {
  guard(p, A);
  // (ADR-207: the hero's guard after the owner's reference footage, refStance.js; `?guard=ward` the cross
  // ward below. A duelist's animator keeps the ward)
  const ref = A.freeHand === true && guardMode() === 'ref';
  if (ref) refGuard(p, P, A);
  else {
    p[P.bodyY] = -0.17;
    p[P.bodyX] = 0;
    p[P.bodyZ] = -0.02;
    p[P.pelvY] = -0.36;
    p[P.pelvZ] = 0;
    p[P.spX] = 0.2;
    p[P.spY] = -0.12;
    p[P.spZ] = 0;
    p[P.hdX] = -0.03;
    p[P.hdY] = 0.42; // the eyes stay on the enemy over the left shoulder
    v3(p, P.rH, -0.02, -0.13, 0.31);
    v3(p, P.rP, -0.75, -0.65, -0.2);
    v3(p, P.swD, 0.72, 0.62, 0.31);
    v3(p, P.swF, -0.35, -0.1, 1);
    v3(p, P.lH, -0.24, -0.2, 0.3);
    v3(p, P.lP, 0.5, -0.85, 0.0);
    p[P.twoHand] = 1;
    p[P.hs] = 0; // the fist on the grip (ADR-073's cross ward), open on the way there
  }
  // the guard breathes, and rides the stride when he walks in it: every channel above the hips was
  // a constant, so standing or walking the whole figure above the feet moved as one rigid piece
  // (0.0 cm of anything, measured). The elbows stay within 2°: still a firm guard
  {
    const br = Math.sin(A.time * (TAU / IDLE_LOOP)), mw = A.moveW;
    const cs = Math.cos(TAU * A.phase), st = Math.cos(TAU * 2 * (A.phase - A.gait.beta * 0.5));
    p[P.bodyY] += 0.006 * br - 0.02 * st * mw;
    p[P.spX] += 0.012 * br;
    p[P.pelvY] -= 0.07 * cs * mw;
    p[P.spY] += 0.05 * cs * mw;
    p[P.rH + 1] += 0.008 * br + 0.012 * st * mw;
    p[P.rH + 2] += 0.004 * br;
  }
  // a tap of the guard (a parry attempt) keeps the feet where they are; held, the stance settles
  // into the block's after ~0.2 s (each tap used to cost two settle steps in and two out again)
  const E = A.entry, fw = smoothstep(0.16, 0.4, A.t), BF = ref ? REF_GUARD.feet : BLOCK_FEET;
  v3(p, P.rF, lerp(E[0], BF[0], fw), ANK, lerp(E[2], BF[1], fw));
  v3(p, P.lF, lerp(E[3], BF[2], fw), ANK, lerp(E[5], BF[3], fw));
  p[P.rFy] = lerp(E[6], ref ? -0.7 : -0.75, fw);
  p[P.lFy] = lerp(E[7], ref ? 0.15 : 0.1, fw);
  p[P.footFlat] = 0.92;
  const r = A.recoil;
  if (r > 0.001) {
    p[P.spX] -= 0.28 * r;
    p[P.hdX] -= 0.15 * r;
    p[P.bodyZ] -= 0.06 * r;
    p[P.bodyY] -= 0.03 * r;
    p[P.rH + 1] += 0.06 * r;
    p[P.rH + 2] -= 0.14 * r;
    p[P.lH + 1] += 0.06 * r;
    p[P.lH + 2] -= 0.14 * r;
  }
  walkLegs(p, A);
}

/** CONTACT (combat/contact.js, ADR-259; ?contact=a): a guard nudged onto the blow it meets (`G`: the hero's
 *  guardNudge on a block, a duelist pilot's on his ward: { x, y, z } body axes (x his left, z ahead), model
 *  m, and k 0..1 easing off): the grip goes there, both hands if both are on it. On the pose as drawn. */
function gripNudge(p, G) {
  const gk = G ? smoothstep(0, 1, fin(G.k)) : 0;
  if (!(gk > 0.001)) return;
  const two = p[P.twoHand] > 0.5;
  for (let c = 0; c < 3; c++) {
    const d = fin(c === 0 ? G.x : c === 1 ? G.y : G.z) * gk;
    p[P.rH + c] += d;
    if (two) p[P.lH + c] += d;
  }
}

// (the parry clip: deflectPose in the PLUNGE + DEFLECT block below)

/** Ghostep: reappear crouched low behind the attacker, off hand braced on the ground, blade swept
 *  back ready for the counter; rise into a forward guard. */
function ghostepPose(p, A) {
  const t = A.t;
  stance(p, A, 0);
  const low = 1 - smoothstep(0.06, 0.32, t);
  p[P.bodyY] = lerp(-0.1, -0.36, low);
  p[P.bodyZ] = 0.04 * low;
  p[P.spX] = lerp(0.16, 0.5, low);
  p[P.spY] = lerp(0.05, -0.25, low);
  p[P.pelvY] = lerp(-0.12, -0.2, low);
  p[P.hdX] = lerp(-0.02, -0.4, low);
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.75;
  setLen(p, P.rH, -0.55, -0.3, -0.3, 0.5);
  v3(p, P.rP, -0.3, -1, -0.4);
  v3(p, P.swD, -0.7, -0.25, -0.65);
  v3(p, P.swF, 0, 1, 0);
  v3(p, P.lH, lerp(0.02, 0.05, low), lerp(-0.42, -0.65, low), lerp(0.2, 0.32, low));
  v3(p, P.lP, 0.7, -0.3, -0.5);
  palmBraced(p, low);
  v3(p, P.rF, -0.2, ANK, -0.34);
  v3(p, P.lF, 0.18, ANK, 0.26);
  const rise = smoothstep(0.14, 0.32, t);
  dirTo(p, P.swD, -0.25, -0.2, 1, rise * 0.6);
  to3(p, P.rH, 0.02, -0.4, 0.2, rise * 0.6);
}

/** Guard break: the guard is blown open — blade knocked up and back, arms flung wide, torso arched,
 *  stumbling steps back (the knockdown follows). */
function guardBreakPose(p, A) {
  const t = A.t;
  guard(p, A);
  const k = t < 0.07 ? easeOutCubic(t / 0.07) : 1 - 0.4 * smoothstep(0.2, 0.45, t);
  p[P.spX] = lerp(p[P.spX], -0.5, k);
  p[P.pitch] = -0.14 * k;
  p[P.hdX] = lerp(p[P.hdX], -0.45, k);
  p[P.bodyY] -= 0.05 * k;
  p[P.bodyZ] -= 0.1 * k;
  to3(p, P.rH, -0.3, 0.1, 0.05, k);
  dirTo(p, P.swD, -0.3, 0.85, -0.35, k);
  to3(p, P.swF, 1, 0, 0, k);
  to3(p, P.lH, 0.35, -0.1, 0.05, k);
  freeLimp(p, k);
  const st = smoothstep(0.1, 0.3, t);
  v3(p, P.lF, 0.14, ANK + 0.1 * Math.sin(Math.PI * st), 0.14 - 0.4 * st);
  p[P.rF + 2] -= 0.1 * st;
}

// Dodge keys (§4.5, the sheet's 0.55 s frames mapped onto the 0.6 s roll): 01 crouch 0.0,
// 02 launch 0.09, 03 tuck 0.2, 04 roll 0.32, 05 kneel 0.44, 06 recover 0.6. Hands / sword in body
// axes; feet in model space (the tuck uses body points instead).
// The kneel is a SLIDE: the root still carries 4-6 m/s out of the roll (gameplay), so the kneel
// travels ~1 m. It is posed as an intended sliding kneel (0.42-0.54): the right shin flat on the
// grass, the left foot planted ahead with the free hand braced on that knee, the torso upright
// against the momentum, the blade trailing back-down on the right with its point dragging in the
// grass; player.js kicks dust off the knee and the foot and sparks off the dragging point. The
// recover (06) rises into the sheet's low guard: the blade still trailing back-down (the run's
// own carry, so rolling out into a run doesn't swing it) and the free fist up.
const ROLL = {
  y: [0, -0.24, 0.05, -0.27, 0.09, -0.16, 0.2, -0.36, 0.32, -0.5, 0.42, -0.43, 0.54, -0.41, 0.6, -0.2],
  sp: [0, 0.55, 0.09, 0.42, 0.2, 0.95, 0.33, 0.95, 0.42, 0.2, 0.54, 0.14, 0.6, 0.34],
  hd: [0, 0.05, 0.09, -0.1, 0.2, 0.75, 0.33, 0.75, 0.42, 0.08, 0.54, 0.1, 0.6, -0.12],
  rH: [0, -0.04, -0.42, -0.1, 0.09, -0.1, -0.36, -0.14, 0.2, -0.08, -0.38, 0.06, 0.33, -0.08, -0.38, 0.06, 0.42, -0.13, -0.42, -0.04, 0.54, -0.13, -0.43, -0.06, 0.6, -0.04, -0.45, -0.12],
  lH: [0, 0.0, -0.42, 0.35, 0.09, 0.0, -0.3, 0.45, 0.2, 0.06, -0.3, 0.2, 0.33, 0.06, -0.3, 0.2, 0.42, 0.0, -0.48, 0.34, 0.54, 0.0, -0.48, 0.36, 0.6, -0.05, -0.14, 0.36],
  // the blade in BODY axes, so it turns over with him: trailing back-down at the hip → swung out
  // to his right side as he launches → held out there, flat (an axle the ball rolls round: the
  // point circles beside him instead of flipping through the ground) → trailing back-down for the
  // slide, the point dragging in the grass → the low guard's carry (round the outside, never
  // through the legs)
  sw: [0, -0.2, -0.4, -0.89, 0.09, -0.72, -0.28, -0.63, 0.2, -0.86, -0.14, -0.49, 0.32, -0.86, -0.14, -0.49, 0.42, -0.42, -0.48, -0.77, 0.54, -0.36, -0.52, -0.77, 0.6, -0.2, -0.55, -0.8],
  // body pitch (rad, piecewise linear so the turn never stalls): crouch, the 65° launch, the
  // 110° ball, 220° over the shoulder (blade flat along the ground behind), upright at the kneel
  pitch: [0, 0, 0.09, 0.45, 0.2, 1.9, 0.32, 3.85, 0.44, TAU, 0.6, TAU],
  rF: [0, -0.14, ANK + 0.03, -0.32, 0.09, -0.12, 0.3, -0.62, 0.36, -0.13, ANK + 0.05, -0.36, 0.44, -0.14, ANK + 0.01, -0.44, 0.54, -0.14, ANK, -0.46, 0.6, -0.16, ANK, -0.38],
  lF: [0, 0.12, ANK, 0.3, 0.36, 0.13, ANK + 0.05, 0.32, 0.44, 0.15, ANK, 0.38, 0.6, 0.14, ANK, 0.32],
  rK: [0, -0.3, 0, 1, 0.36, -0.2, 0.3, 1, 0.44, -0.1, -0.5, 1, 0.54, -0.1, -0.5, 1, 0.6, -0.35, 0, 1],
};
/** The slide window of the forward roll (s): player.js kicks skid dust / point sparks in it. */
export const ROLL_SLIDE = [0.42, 0.58];
/** Direction keys k = [t0, x, y, z, ...] → p[i..i+2], each span eased and blended by dirLerp. */
function kdir(p, i, t, k) {
  const n = k.length / 4;
  if (t <= k[0]) {
    v3(p, i, k[1], k[2], k[3]);
    return;
  }
  for (let j = 1; j < n; j++) {
    const b = j * 4;
    if (t <= k[b]) {
      const a = b - 4;
      let u = (t - k[a]) / Math.max(1e-6, k[b] - k[a]);
      u = u * u * (3 - 2 * u);
      dirLerp(p, i, k[a + 1], k[a + 2], k[a + 3], k[b + 1], k[b + 2], k[b + 3], u);
      return;
    }
  }
  const e = (n - 1) * 4;
  v3(p, i, k[e + 1], k[e + 2], k[e + 3]);
}

/** Dodge (0.6 s): crouch and push off (the feet stay planted on the grass as the body springs
 *  away) → a launch with the body ~65° → a balled tuck → over the right shoulder → a kneel on the
 *  right knee, skidding, blade forward-down with the point on the grass ahead → up into a low
 *  guard with the free fist raised. The blade is held in BODY axes and carried out at his right
 *  side through the turn, so it circles with him instead of flipping through the ground (the coat
 *  is flung over the back by the turn; player.js also kicks it out). */
function rollPose(p, A) {
  const t = A.t;
  guard(p, A);
  p[P.pitch] = lin(t, ROLL.pitch);
  p[P.bodyX] = 0;
  p[P.bodyZ] = 0;
  p[P.bodyY] = kf(t, ROLL.y); // the ground clamp in apply() lifts the ball as it turns
  p[P.pelvX] = 0;
  p[P.pelvY] = 0;
  p[P.pelvZ] = 0;
  p[P.spY] = 0;
  p[P.spZ] = 0;
  p[P.spX] = kf(t, ROLL.sp);
  p[P.hdX] = kf(t, ROLL.hd);
  p[P.hdY] = 0;
  p[P.hdZ] = 0;
  kv3(p, P.rH, t, ROLL.rH);
  kv3(p, P.lH, t, ROLL.lH);
  kdir(p, P.swD, t, ROLL.sw);
  v3(p, P.swF, 0.2, 1, 0.2); // the flat faces his back / the sky through the turn
  v3(p, P.rP, -0.7, -0.5, -0.5);
  v3(p, P.lP, 0.6, -0.6, -0.5);
  kv3(p, P.rF, t, ROLL.rF);
  kv3(p, P.lF, t, ROLL.lF);
  kv3(p, P.rK, t, ROLL.rK);
  v3(p, P.lK, 0.25, 0, 1);
  p[P.rFy] = p[P.lFy] = 0;
  p[P.rFf] = p[P.lFf] = 1;
  // push-off: for the first frames the feet stay on their entry spots while the root springs away,
  // then trail from where they left the grass into the tuck
  const push = 1 - smoothstep(0.04, 0.15, t);
  if (push > 0) {
    const E = A.entry, m0 = A.mark(0, 0.04);
    const tx = t < 0.04 ? A.trav.x : m0.x, tz = t < 0.04 ? A.trav.z : m0.z;
    const up = 0.1 * smoothstep(0.04, 0.1, t);
    to3(p, P.rF, E[0] - tx, ANK + up, E[2] - tz, push);
    to3(p, P.lF, E[3] - tx, ANK + up, E[5] - tz, push);
  }
  // knees to the chest through the tuck and the roll
  const tuck = smoothstep(0.06, 0.15, t) * (1 - smoothstep(0.34, 0.42, t));
  bodyPointTo(p, P.rF, -0.12, -0.42, 0.2, tuck);
  bodyPointTo(p, P.lF, 0.12, -0.4, 0.22, Math.max(tuck, 0.8 * smoothstep(0.04, 0.1, t) * (1 - smoothstep(0.34, 0.42, t))));
  to3(p, P.rK, -0.2, 0.5, 1, tuck);
  to3(p, P.lK, 0.2, 0.5, 1, tuck);
  p[P.footFlat] = lerp(0.9, 0, tuck);
  swordFromEntry(p, A, SWORD_ENTRY);
}
/** Backstep (0.4 s): a short crouched hop backward. The feet push off the grass (held on their
 *  spots for the first frames while the root moves), fly with the knees up, and land a little
 *  ahead of the body, braking (held on their landing spots while the body settles back over
 *  them); the blade comes up forward, the free hand guards. */
function backstepPose(p, A) {
  const t = A.t;
  guard(p, A);
  const crouch = smoothstep(0, 0.05, t) * (1 - smoothstep(0.32, 0.4, t));
  // the guard rises over the hop (it snapped up in the crouch's 3 frames: a whip of the point) and
  // is still up as he slides out of it: the loco's backpedal guard takes it over, and the ready
  // stance returns as he comes to rest (dropping it in the landing swung it twice)
  const raise = smoothstep(0, 0.16, t);
  const air = smoothstep(0.03, 0.08, t) * (1 - smoothstep(0.26, 0.31, t));
  const hop = Math.sin(Math.PI * clamp((t - 0.04) / 0.27, 0, 1));
  p[P.bodyX] = lerp(p[P.bodyX], 0, crouch);
  p[P.bodyY] = lerp(p[P.bodyY], -0.07, crouch) + 0.07 * hop - 0.04 * smoothstep(0.27, 0.33, t) * (1 - smoothstep(0.33, 0.4, t));
  p[P.pelvZ] = lerp(p[P.pelvZ], 0, crouch);
  p[P.spZ] = lerp(p[P.spZ], 0, crouch);
  p[P.spX] = lerp(p[P.spX], 0.12, crouch) - 0.18 * hop;
  p[P.hdX] = lerp(p[P.hdX], 0.04, crouch) + 0.1 * hop;
  p[P.hdZ] = lerp(p[P.hdZ], 0, crouch);
  // feet: held on their entry spots while he pushes off → carried through the air (knees up) →
  // set down on landing spots a little ahead of the hips, held while the body settles back
  const tr = A.trav, E = A.entry;
  const m0 = A.mark(1, 0.045); // travel at the push-off
  const carry = smoothstep(0.05, 0.27, t);
  const land = smoothstep(0.28, 0.31, t);
  const m1 = A.mark(0, 0.3); // travel at touchdown
  for (let k = 0; k < 2; k++) {
    const i = k ? P.lF : P.rF, o = k * 3;
    const hx = E[o] - (t < 0.045 ? tr.x : m0.x), hz = E[o + 2] - (t < 0.045 ? tr.z : m0.z);
    // landing spots (model): set down behind the hips in the travel direction, so the body sliding
    // back over them leaves them near the ready stance (landing the left foot ahead left it 0.36 m
    // out in front, through the blade's line across the legs)
    const lx = k ? 0.14 : -0.18, lz = k ? -0.04 : -0.16;
    v3(p, i, lerp(hx, lx, carry), ANK + air * (0.1 + (k ? 0.14 : 0.1) * hop), lerp(hz, lz, carry));
    if (land > 0) {
      p[i] -= (tr.x - m1.x) * land;
      p[i + 2] -= (tr.z - m1.z) * land;
    }
  }
  to3(p, P.rK, -0.3, 0.2, 1, air);
  to3(p, P.lK, 0.3, 0.2, 1, air);
  p[P.rFy] = lerp(E[6], -0.2, carry);
  p[P.lFy] = lerp(E[7], 0.1, carry);
  dirTo(p, P.swD, -0.15, -0.22, 1, raise);
  to3(p, P.rH, 0.02, -0.4, 0.22, raise);
  to3(p, P.lH, -0.04, -0.3, 0.3, raise);
  // the free hand wards with a low point
  to3(p, P.lD, LD_WARD[0], LD_WARD[1], LD_WARD[2], raise);
  to3(p, P.lN, 0, -1, 0, raise);
  swordFromEntry(p, A, SWORD_ENTRY);
}

/** The Long Second (ADR-158): he leans back in place under the blow, the guard kept, the feet planted;
 *  the lean comes in over 0.08 s, holds and gives back by 0.42 s. */
function leanPose(p, A) {
  const t = A.t;
  guard(p, A);
  const k = smoothstep(0, 0.08, t) * (1 - smoothstep(0.3, 0.42, t));
  p[P.spX] -= 0.55 * k;
  p[P.hdX] -= 0.22 * k;
  p[P.bodyY] -= 0.08 * k;
  p[P.bodyZ] -= 0.1 * k;
  swordFromEntry(p, A, SWORD_ENTRY);
}

/** Drink: legs keep walking (slowly), the free hand raises the flask, head tips back. */
function healPose(p, A) {
  loco(p, A);
  const t = A.t;
  const raise = smoothstep(0.02, 0.27, t) * (1 - smoothstep(0.66, 0.84, t));
  const drink = smoothstep(0.27, 0.38, t) * (1 - smoothstep(0.56, 0.68, t));
  to3(p, P.lH, -0.15, 0.08, 0.28, raise);
  to3(p, P.lH, -0.18, 0.15, 0.19, drink);
  to3(p, P.lP, 0.7, -0.5, -0.3, raise);
  // the swig: the elbow lifts out to the side and the head and shoulders tip back, so the drink
  // reads from behind (the game camera) as well, not only the flask's glow at the mouth
  to3(p, P.lP, 0.95, 0.35, -0.15, drink);
  p[P.hdX] = lerp(p[P.hdX], -0.5, drink);
  p[P.spX] = lerp(p[P.spX], -0.02, drink);
  p[P.hdY] = lerp(p[P.hdY], 0, raise);
  // the flask hangs on the forearm: the hand opens round it and the wrist goes rigid while he drinks
  freeLimp(p, raise);
  // the sword arm keeps what the legs are doing (the low ready guard standing, trailing walking):
  // swinging it forward-down for the drink only added two blade swings to a sip
  p[P.flask] = smoothstep(0.0, 0.1, t) * (1 - smoothstep(0.74, 0.85, t));
}

/** A reaction entered mid-turn (struck in the whirl) finishes the turn over a third of a second
 *  instead of snapping square in the cross-fade's few frames (ADR-083). */
function carryYaw(p, A) {
  if (A.yaw0) p[P.yaw] += A.yaw0 * (1 - smoothstep(0, 0.3, A.t));
}

/** Flinch: the body gives the way the blow drives it (player.hitPush, a unit vector in his own
 *  axes: z − = driven back, z + = driven forward by a blow from behind, x + = toward his left),
 *  the arms thrown out, a foot catching him on that side, then he recovers (ADR-083: every blow
 *  snapped him BACK, also one that landed between his shoulder blades). */
function staggerPose(p, A) {
  const t = A.t;
  guard(p, A);
  carryYaw(p, A);
  const k = t < 0.08 ? easeOutCubic(t / 0.08) : 1 - smoothstep(0.08, 0.4, t);
  const hp = A.player?.hitPush;
  const pz = clamp(fin(hp?.z, -1), -1, 1), px = clamp(fin(hp?.x, 0), -1, 1);
  const kb = k * Math.max(-pz, 0.4 * Math.abs(px), 0), kf2 = k * Math.max(pz, 0), ks = k * px;
  p[P.spX] = lerp(lerp(p[P.spX], -0.4, kb), 0.5, kf2); // arched back, or folded forward over the blow
  p[P.pitch] = -0.1 * kb + 0.12 * kf2;
  p[P.hdX] = lerp(lerp(p[P.hdX], -0.4, kb), 0.45, kf2);
  p[P.spZ] += FLINCH_LEAN * 0.22 * ks; // … and bent over to the side it drives him
  p[P.hdZ] += FLINCH_LEAN * 0.16 * ks;
  p[P.bodyY] -= 0.07 * k;
  p[P.bodyZ] += -0.08 * kb + 0.1 * kf2;
  p[P.bodyX] += 0.07 * ks;
  to3(p, P.rH, -0.25, -0.3, 0.3 + 0.1 * Math.max(pz, 0), k);
  to3(p, P.lH, 0.3, -0.25, 0.25 + 0.1 * Math.max(pz, 0), k);
  freeLimp(p, k);
  // the blow jolts the blade up and out from wherever the guard holds it (~40°): a fixed target
  // out to the right swung it ~110° across the legs and back with the low ready guard
  dirTo(p, P.swD, p[P.swD] - 0.45, p[P.swD + 1] + 0.5, p[P.swD + 2] + 0.25, k);
  // a foot catches him: the left one back, the right one forward, or the one on that side out
  p[P.lF + 2] -= 0.2 * kb;
  p[P.rF + 2] += 0.24 * kf2;
  if (ks > 0) p[P.lF] += 0.18 * ks;
  else p[P.rF] += 0.18 * ks;
}
const FLINCH_LEAN = -1; // the sign of a spine / head roll that leans toward his left (+X)

// The knockdown falls AWAY from the blow (ADR-083). From the front or a side (KD): onto his back,
// fall (0–0.3), lie (–0.8), sit up, crouch, stand (–1.3). From behind (KDP, player.kdProne): onto
// his front, the hands thrown out to break it, lie, push up, a foot under him, stand.
const KD = {
  pitch: [0, 0, 0.3, -1.45, 0.8, -1.45, 1.0, -0.55, 1.14, 0.18, 1.3, 0],
  y: [0, -0.035, 0.3, -0.85, 0.8, -0.85, 1.0, -0.6, 1.14, -0.34, 1.3, -0.035],
  z: [0, 0, 0.3, -0.5, 0.8, -0.5, 1.0, -0.34, 1.14, -0.12, 1.3, 0],
  // the chest is thrown back, then he curls (the back rounded, the chin tucked) before he lands
  sp: [0, 0.1, 0.1, -0.3, 0.22, 0.3, 0.34, 0.05, 0.8, 0.05, 1.0, 0.55, 1.14, 0.45, 1.3, 0.1],
  hd: [0, -0.05, 0.1, -0.4, 0.22, 0.5, 0.38, 0.2, 0.8, 0.15, 1.0, 0.3, 1.3, -0.05],
  lie: [0.12, 0, 0.28, 1, 0.84, 1, 0.98, 0],
  legOut: [0.16, 0, 0.4, 1, 0.84, 1, 0.98, 0], // the left leg slides out long
  legUp: [0.08, 0, 0.3, 1, 0.84, 1, 0.98, 0], // the right foot stays planted: its knee up
  sit: [0.84, 0, 0.98, 1, 1.14, 1, 1.3, 0],
  arms: [0.05, 0, 0.25, 1, 0.8, 1, 0.95, 0],
  fling: [0.02, 0, 0.12, 1, 0.3, 0], // the hands left behind as the chest goes
  push: [0.8, 0, 0.92, 1, 1.08, 1, 1.22, 0],
  blade: [0.05, 0, 0.22, 1, 1.12, 1, 1.3, 0], // held out at his right side until he is on his feet
};
const KDP = {
  pitch: [0, 0, 0.3, 1.5, 0.8, 1.5, 1.0, 0.85, 1.14, 0.3, 1.3, 0],
  y: [0, -0.035, 0.3, -0.88, 0.8, -0.88, 1.0, -0.56, 1.14, -0.3, 1.3, -0.035],
  z: [0, 0, 0.3, 0.42, 0.8, 0.42, 1.0, 0.24, 1.14, 0.08, 1.3, 0],
  // the blow arches him, he folds as he goes down, and arches again pushing himself up
  sp: [0, 0.1, 0.08, -0.35, 0.2, 0.2, 0.32, -0.05, 0.8, -0.05, 0.96, -0.4, 1.14, 0.3, 1.3, 0.1],
  hd: [0, -0.05, 0.08, -0.45, 0.2, 0.2, 0.36, 0, 0.8, 0, 0.96, -0.45, 1.14, 0.1, 1.3, -0.05],
};
function knockdownAt(p, A, t, prone) {
  guard(p, A);
  carryYaw(p, A);
  freeLimp(p, 1); // falling and lying: the free hand open and rigid (no fingertips into the grass)
  const K = prone ? KDP : KD;
  p[P.bodyX] = 0;
  p[P.pelvX] = 0;
  p[P.pelvY] = 0;
  p[P.pelvZ] = 0;
  p[P.spY] = 0;
  p[P.spZ] = 0;
  p[P.hdZ] = 0;
  p[P.pitch] = kf(t, K.pitch);
  p[P.bodyY] = kf(t, K.y) + 0.05 * Math.sin(Math.PI * clamp((t - 0.3) / 0.12, 0, 1)); // bounce
  p[P.bodyZ] = kf(t, K.z);
  p[P.spX] = kf(t, K.sp);
  p[P.hdX] = kf(t, K.hd);
  const lie = kf(t, KD.lie), sit = kf(t, KD.sit), arms = kf(t, KD.arms), push = kf(t, KD.push);
  const fling = kf(t, KD.fling), bl = kf(t, KD.blade);
  p[P.hdY] = lerp(p[P.hdY], prone ? 0.65 : 0.45, lie); // the head rolled to one side
  if (prone) {
    to3(p, P.rF, -0.16, ANK, -0.22, sit); // the get-up: the left foot comes under him first
    to3(p, P.lF, 0.15, ANK, 0.22, sit);
    bodyPointTo(p, P.rF, -0.12, -1.0, -0.06, lie); // the legs laid out behind, the left knee fallen out to the side
    bodyPointTo(p, P.lF, 0.3, -0.76, -0.04, lie);
    to3(p, P.lK, 1, 0, 0.25, lie);
    p[P.footFlat] = lerp(0.9, 0.1, lie);
    to3(p, P.rH, -0.42, 0.3, 0.1, arms); // lying: the arms up beside his head
    to3(p, P.lH, 0.26, 0.24, 0.14, arms);
    to3(p, P.rP, -1, -0.3, 0.1, arms); // the elbows out flat on the grass, not up in the air
    to3(p, P.lP, 1, -0.3, 0.1, arms);
    to3(p, P.rH, -0.26, 0.1, 0.45, fling); // the hands thrown out ahead to break the fall
    to3(p, P.lH, 0.26, 0.12, 0.45, fling);
    dirTo(p, P.swD, -0.55, 0.8, -0.05, bl); // the sword flat on the grass beside his head
    to3(p, P.swF, 0, 0, 1, bl);
    to3(p, P.rH, -0.26, -0.02, 0.3, push); // palms under the shoulders: he pushes himself up
    to3(p, P.lH, 0.26, -0.02, 0.3, push);
    return;
  }
  to3(p, P.rF, -0.16, ANK, 0.08, sit);
  to3(p, P.lF, 0.15, ANK, 0.18, sit);
  // the feet stay where they stood as the hips drop, so the knees buckle (he fell like a board, both
  // legs straight); lying, the right knee stays up, its foot flat on the grass, the left leg out long
  const out = kf(t, KD.legOut), up = kf(t, KD.legUp);
  bodyPointTo(p, P.lF, 0.14, -0.98, 0.05, out);
  to3(p, P.rF, -0.2, ANK, 0.1, up);
  p[P.footFlat] = 0.9;
  p[P.rFf] = 1;
  p[P.lFf] = lerp(1, 0.1, out);
  to3(p, P.rH, -0.5, 0.02, -0.02, arms); // flung out on the grass: the sword arm wide …
  to3(p, P.rP, -1, -0.4, 0, arms);
  to3(p, P.lH, 0.12, -0.2, 0.17, arms); // … the free hand fallen across his belly
  to3(p, P.lP, 1, -0.3, -0.3, arms);
  to3(p, P.rH, -0.3, 0.0, 0.42, fling); // left behind out ahead as the chest goes back
  to3(p, P.lH, 0.3, 0.05, 0.42, fling);
  // the sword stays out at his right side (clear of the legs that fold up under him) until he
  // stands, then comes back to the ready stance
  dirTo(p, P.swD, -0.78, 0.55, -0.3, bl);
  to3(p, P.swF, 0, 1, 0, bl);
  to3(p, P.rH, -0.1, -0.48, -0.12, push); // hands push off the ground
  to3(p, P.lH, 0.1, -0.48, -0.12, push);
}
function knockdownPose(p, A) {
  knockdownAt(p, A, A.t, !!A.player?.kdProne);
}

/** Killed on the ground (in the knockdown, player.downFrom s into it): he never gets up. The fall
 *  carries on to the grass, one last arch runs through him and he goes limp where he lies
 *  (ADR-083: the death clip stood a lying man on his feet in a tenth of a second, to kneel and
 *  fall a second time). */
function deathDownPose(p, A) {
  const pl = A.player, t = A.t, prone = !!pl?.kdProne;
  knockdownAt(p, A, Math.min(fin(pl?.downFrom, 0.5) + t, 0.62), prone);
  const jolt = Math.sin(Math.PI * clamp(t / 0.5, 0, 1)), limp = smoothstep(0.3, 1.0, t);
  p[P.spX] += (prone ? 0.2 : -0.24) * jolt; // the chest lifts off the grass once
  p[P.hdX] -= 0.25 * jolt;
  p[P.hdY] = lerp(p[P.hdY], 0.8, limp); // the head rolls over
  if (prone) {
    to3(p, P.lH, 0.3, 0.05, 0.14, limp); // the free arm slides down beside him
    to3(p, P.lP, 1, -0.3, 0.1, limp);
  } else {
    bodyPointTo(p, P.rF, -0.24, -0.96, 0.05, limp); // the raised knee gives: the leg slides out
    p[P.rFf] = lerp(1, 0.1, limp);
    to3(p, P.lH, 0.36, -0.1, 0.0, limp); // the free arm falls to his side
  }
}

// death: drop to one knee leaning on the sword (0–0.55), sway, collapse face down (0.95–1.4)
const DEATH = {
  y: [0, -0.035, 0.55, -0.44, 0.95, -0.46, 1.4, -0.88],
  pitch: [0, 0, 0.55, 0.12, 0.95, 0.2, 1.4, 1.5],
  roll: [0.95, 0, 1.4, 0.28],
  z: [0.95, 0, 1.4, 0.32],
  sp: [0, 0.1, 0.55, 0.5, 0.95, 0.56, 1.25, 0.3, 1.4, 0.05],
  hd: [0, -0.05, 0.55, 0.55, 1.4, 0.15],
  kneel: [0, 0, 0.5, 1],
  flat: [0.9, 0, 1.22, 1],
  limp: [0.95, 0, 1.3, 1],
};
function deathPose(p, A) {
  const t = A.t;
  guard(p, A);
  carryYaw(p, A);
  freeLimp(p, 1); // the free hand open and rigid through the fall
  p[P.bodyX] = 0;
  p[P.pelvY] = 0;
  p[P.spY] = 0.05;
  p[P.spZ] = 0;
  const sway = t > 0.55 && t < 0.95 ? Math.sin((t - 0.55) * 9) * 0.03 : 0;
  p[P.bodyY] = kf(t, DEATH.y);
  p[P.pitch] = kf(t, DEATH.pitch) + sway;
  p[P.roll] = kf(t, DEATH.roll);
  p[P.bodyZ] = kf(t, DEATH.z);
  p[P.spX] = kf(t, DEATH.sp);
  p[P.hdX] = kf(t, DEATH.hd);
  const kneel = kf(t, DEATH.kneel);
  to3(p, P.rF, -0.15, ANK, -0.42, kneel); // right knee on the ground
  to3(p, P.lF, 0.15, ANK, 0.3, kneel);
  to3(p, P.rK, -0.15, -0.3, 1, kneel);
  to3(p, P.rH, 0.0, -0.36, 0.34, kneel); // leaning on the sword, tip planted ahead
  dirTo(p, P.swD, -0.05, -0.75, 0.66, kneel);
  to3(p, P.swF, 1, 0, 0, kneel);
  to3(p, P.lH, -0.06, -0.45, 0.24, kneel);
  const flat = kf(t, DEATH.flat);
  bodyPointTo(p, P.rF, -0.12, -1.0, -0.06, flat);
  bodyPointTo(p, P.lF, 0.3, -0.76, -0.04, flat); // the left knee falls out to the side (both legs lay straight as a plank)
  to3(p, P.lK, 1, 0, 0.25, flat);
  p[P.footFlat] = lerp(0.9, 0.1, flat);
  // face down: body +Z points into the ground, +Y toward the head
  const limp = kf(t, DEATH.limp);
  p[P.hdY] = lerp(p[P.hdY], 0.7, limp); // his face to one side, not in the dirt
  to3(p, P.rH, -0.45, 0.05, 0.1, limp);
  dirTo(p, P.swD, -0.55, 0.8, -0.05, limp); // sword dropped flat beside the head
  to3(p, P.swF, 0, 0, 1, limp);
  to3(p, P.lH, 0.32, -0.05, 0.12, limp);
  // both elbows fall out flat on the grass (the poles pointed behind him, which is UP once he lies
  // on his front: the left elbow stood in the air like a wing and its sleeve's sheet with it)
  to3(p, P.rP, -1, -0.3, 0.1, limp);
  to3(p, P.lP, 1, -0.3, 0.1, limp);
}

// ================================================================ PLUNGE + DEFLECT (plunge agent)
// One block for the perfect-dodge plunge (player.js state 'plunge', DEFENSE.plunge) and the
// deflect chain. The plunge clip follows the player's phase (player.plungeAnim: phase, u = 0..1
// through it); player._plungePhase re-enters the clip with a short cross-fade at each change, so
// each phase's pose only has to read well by itself. The root is the hero's ground point carried
// up into the air (position.y): feet targets stay root-relative, the ground clamps are world-space.
//   HANG  coiled at the apex above the head: knees tucked, both fists high on the hilt in a reverse
//         grip, the blade hanging point-down in front of him, winding tighter
//   DIVE  driving down onto it: the fists punch down to the sternum, the blade straight down
//         below his tucked feet (the point leads)
//   RIDE  crouched on the skull, right knee down, both fists on the buried hilt, leaning over it;
//         a twist of the blade, then he pulls and coils to spring off
//   FLIP  the blade ripped out, a full backflip (knees to the chest, the blade along his right
//         side so it turns with him), opening feet-first for the landing
//   LAND  a deep three-point crouch (free hand on the grass, the blade trailing low on his
//         right, eyes up on the wyrm), rising into the fighting stance
// The deflect (parry clip) snaps the blade into the blow on alternating sides (player.deflect.side)
// with a small rock back and is back in the guard by ~0.17 s; between parries in rhythm the
// walking clips keep the guard up (player.guardHold).
const PLN = { VANISH: 0, HANG: 1, DIVE: 2, RIDE: 3, FLIP: 4, LAND: 5 }; // = player.js PL
const PL_FLIP_PITCH = [0, 0, 0.1, 0.22, 0.2, -0.35, 0.52, -3.2, 0.8, -5.75, 0.94, -6.283185307179586, 1, -6.283185307179586];
const SCR_GUARD = new Float32Array(N);
const GUARD_CH = [P.rH, P.rH + 1, P.rH + 2, P.rP, P.rP + 1, P.rP + 2, P.lH, P.lH + 1, P.lH + 2, P.lP, P.lP + 1, P.lP + 2, P.swF, P.swF + 1, P.swF + 2, P.spX, P.spY, P.spZ, P.hdX, P.hdY, P.pelvY, P.twoHand, P.offAt,
  P.lD, P.lD + 1, P.lD + 2, P.lN, P.lN + 1, P.lN + 2, P.hs, P.lk];

/** The shared airborne base: every channel the plunge poses read, upright, arms down; the free
 *  hand open (the hang, the dive and the ride hold the hilt in both fists: off it, an open hand
 *  reaching for it, never the sword fingers). */
function plBase(p, A) {
  guard(p, A);
  p[P.hs] = 0;
  p[P.bodyX] = 0;
  p[P.bodyZ] = 0;
  p[P.yaw] = 0;
  p[P.roll] = 0;
  p[P.pelvX] = 0;
  p[P.pelvY] = 0;
  p[P.pelvZ] = 0;
  p[P.spY] = 0;
  p[P.spZ] = 0;
  p[P.hdY] = 0;
  p[P.hdZ] = 0;
  p[P.rFy] = p[P.lFy] = 0;
  p[P.rFf] = p[P.lFf] = 1;
  p[P.flask] = 0;
}

/** Knees tucked up under him (k 0..1), feet root-relative. */
function plTuck(p, k) {
  to3(p, P.rF, -0.13, 0.46, 0.06, k);
  to3(p, P.lF, 0.14, 0.56, 0.2, k);
  to3(p, P.rK, -0.25, 0.35, 1, k);
  to3(p, P.lK, 0.25, 0.4, 1, k);
  p[P.footFlat] = lerp(p[P.footFlat], 0.15, k);
}

function plHang(p, A, u) {
  plBase(p, A);
  const w = smoothstep(0, 1, u), br = Math.sin(A.time * 9) * 0.01;
  p[P.bodyY] = -0.1 - 0.06 * w;
  p[P.pitch] = 0.16 + 0.12 * w; // leaning out over the head below
  p[P.spX] = -0.12 - 0.08 * w + br; // the chest opens under the raised fists
  p[P.hdX] = 0.5; // eyes down on the head
  // both fists high over his head on the hilt (reverse grip): the blade hangs point-down in
  // front of him, clear of the face; they lift a little higher as the coil tightens
  v3(p, P.rH, 0.13, 0.4 + 0.07 * w, 0.24);
  v3(p, P.rP, -0.9, 0.25, -0.3);
  v3(p, P.lP, 0.9, 0.25, -0.3);
  v3(p, P.swD, 0.02, -1, 0.22 - 0.06 * w);
  v3(p, P.swF, 1, 0, 0);
  p[P.twoHand] = 1;
  v3(p, P.rF, -0.12, ANK, 0.05);
  v3(p, P.lF, 0.12, ANK, 0.05);
  plTuck(p, 0.75 + 0.25 * w);
}

function plDive(p, A, u) {
  plBase(p, A);
  const e = easeOutCubic(clamp(u * 2.2, 0, 1)); // the fists drive down in the first half
  p[P.bodyY] = -0.12;
  p[P.pitch] = 0.28 - 0.12 * e; // upright as he drops onto it
  p[P.spX] = lerp(-0.2, 0.22, e);
  p[P.hdX] = 0.55;
  v3(p, P.rH, 0.12, lerp(0.47, -0.16, e), lerp(0.24, 0.34, e));
  v3(p, P.rP, -0.85, -0.2, -0.45);
  v3(p, P.lP, 0.85, -0.2, -0.45);
  v3(p, P.swD, 0.02, -1, lerp(0.16, 0.04, e));
  v3(p, P.swF, 1, 0, 0);
  p[P.twoHand] = 1;
  v3(p, P.rF, -0.12, ANK, 0.05);
  v3(p, P.lF, 0.12, ANK, 0.05);
  plTuck(p, 1);
  // the legs open a touch for the landing at the end
  to3(p, P.rF, -0.16, 0.3, -0.2, smoothstep(0.6, 1, u));
}

function plRide(p, A, u, h) {
  plBase(p, A);
  // the head's thrash shakes him (cosmetic, his own clock); a twist of the buried blade mid-ride
  const sh = Math.sin(A.time * 31) * 0.02 + Math.sin(A.time * 17.3) * 0.015;
  const land = 1 - smoothstep(0, 0.12, u); // the impact's compression
  const coil = smoothstep(0.66, 1, u); // pulling the blade, coiling to spring
  const twist = Math.sin(Math.PI * smoothstep(0.25, 0.6, u));
  p[P.bodyY] = -0.5 - 0.06 * land + 0.1 * coil + sh;
  p[P.bodyZ] = 0.04;
  p[P.pitch] = 0.26 + 0.08 * land - 0.1 * coil;
  p[P.spX] = 0.4 + 0.12 * land - 0.2 * coil;
  p[P.spY] = 0.18 * twist;
  p[P.pelvY] = -0.1 * twist;
  p[P.hdX] = 0.3 - 0.45 * coil; // eyes on the blade, then up at the landing ahead of his back
  p[P.hdY] = -0.15 * twist;
  // both fists on the buried hilt, the blade straight down into the skull
  v3(p, P.rH, 0.12, -0.36 + 0.16 * coil, 0.36);
  v3(p, P.rP, -0.85, -0.2, -0.45);
  v3(p, P.lP, 0.85, -0.2, -0.45);
  v3(p, P.swD, 0.02 + 0.08 * twist, -1, 0.06);
  v3(p, P.swF, 1, 0, 0.3 * twist);
  p[P.twoHand] = 1;
  // right knee down on the skull, the left foot planted forward
  v3(p, P.rF, -0.14, ANK + 0.02, -0.4);
  v3(p, P.lF, 0.17, ANK, 0.26);
  v3(p, P.rK, -0.15, -0.35, 1);
  v3(p, P.lK, 0.25, 0.15, 1);
  p[P.footFlat] = 0.7;
  p[P.rFf] = 0.4;
}

function plFlip(p, A, u) {
  plBase(p, A);
  p[P.pitch] = lin(u, PL_FLIP_PITCH); // a full turn backward (wraps to upright for the landing)
  const rip = smoothstep(0, 0.14, u); // the blade comes out of the head
  const tuck = smoothstep(0.12, 0.3, u) * (1 - smoothstep(0.72, 0.9, u));
  const open = smoothstep(0.78, 1, u); // feet-first for the landing
  p[P.bodyY] = -0.2 + 0.1 * rip - 0.12 * tuck;
  p[P.spX] = lerp(0.2, -0.15, rip) + 0.45 * tuck;
  p[P.hdX] = lerp(-0.1, 0.35, tuck) - 0.2 * open;
  // the sword hand sweeps the ripped blade to his right side, point down along the body: an axle
  // the flip turns round (it never swings through the legs)
  v3(p, P.rH, lerp(0.12, -0.16, rip), lerp(-0.2, -0.36, rip), lerp(0.34, 0.06, rip));
  v3(p, P.rP, -0.9, -0.1, -0.4);
  v3(p, P.swD, lerp(0.02, -0.34, rip), -0.82, lerp(0.06, -0.48, rip));
  v3(p, P.swF, 1, 0, 0);
  p[P.twoHand] = 1 - rip;
  v3(p, P.lH, lerp(0.05, 0.3, open), lerp(-0.25, -0.12, open), lerp(0.3, 0.12, open));
  v3(p, P.lP, 0.8, -0.3, -0.4);
  palmBraced(p, 1); // an open hand off the grip, reaching for the landing
  // the push off the head, the tuck (knees to the chest), then the legs reach for the ground
  v3(p, P.rF, -0.14, ANK + 0.25 * (1 - rip), -0.15);
  v3(p, P.lF, 0.14, ANK + 0.25 * (1 - rip), 0.12);
  bodyPointTo(p, P.rF, -0.12, -0.3, 0.28, tuck);
  bodyPointTo(p, P.lF, 0.12, -0.26, 0.3, tuck);
  to3(p, P.rK, -0.2, 0.6, 1, tuck);
  to3(p, P.lK, 0.2, 0.6, 1, tuck);
  to3(p, P.rF, -0.2, ANK + 0.12, -0.12, open);
  to3(p, P.lF, 0.18, ANK + 0.12, 0.22, open);
  p[P.footFlat] = lerp(0.6, 0.2, tuck);
}

function plLand(p, A, u) {
  stance(p, A, 0);
  const k = 1 - smoothstep(0.3, 1, u); // the crouch rises into the stance
  const hit = 1 - smoothstep(0, 0.08, u); // the touchdown's compression
  p[P.bodyY] = lerp(p[P.bodyY], -0.5 - 0.06 * hit, k);
  p[P.bodyZ] = 0.05 * k;
  p[P.spX] = lerp(p[P.spX], 0.55, k);
  p[P.spY] = lerp(p[P.spY], -0.12, k);
  p[P.hdX] = lerp(p[P.hdX], -0.35, k); // head up: eyes on the wyrm
  // free hand down on the grass ahead-left, the blade trailing low behind on his right
  to3(p, P.lH, 0.12, -0.55, 0.36, k);
  to3(p, P.lP, 0.7, -0.2, -0.6, k);
  palmBraced(p, k);
  to3(p, P.rH, -0.36, -0.28, -0.12, k);
  dirTo(p, P.swD, -0.55, -0.42, -0.72, k);
  to3(p, P.swF, 0, 1, 0, k);
  to3(p, P.rF, -0.26, ANK, -0.34, k);
  to3(p, P.lF, 0.22, ANK, 0.36, k);
  to3(p, P.rK, -0.6, 0, 1, k);
  to3(p, P.lK, 0.4, 0.1, 1, k);
}

function plungePose(p, A) {
  const S = A.player?.plungeAnim;
  const ph = S ? S.phase : PLN.LAND, u = S ? clamp(fin(S.u), 0, 1) : 1;
  if (ph <= PLN.HANG) plHang(p, A, ph === PLN.HANG ? u : 0);
  else if (ph === PLN.DIVE) plDive(p, A, u);
  else if (ph === PLN.RIDE) plRide(p, A, u, fin(S?.h));
  else if (ph === PLN.FLIP) plFlip(p, A, u);
  else plLand(p, A, u);
}

/** Deflect: the blade is ON the blow as the clip starts (the parry's own frame, which a freeze
 *  holds: player.js _parry poses it at once), then comes back to the guard by ~0.2 s so the next blow
 *  of the string can be met. The side is the one the blow's steel is on (player.deflect.side; they
 *  alternate when the attacker gives no blade), `high` raises it into an overhead ward for a blow
 *  from above, and the grip is moved by the deflect's nudge (nx, ny, nz: body axes) so the two blades
 *  touch. The chest rocks back with the pushback. Later deflects of a chain snap harder.
 *  (Until 2026-11-14 the blade snapped out over the clip's first 0.045 s: frozen at 2 % speed by the
 *  parry's own hit-stop, the freeze-frame showed the guard it started from and no contact.) */
// the cross ward's body (blockPose's `?guard=ward`): a deflect's snap is posed from it (below)
const WARD_BODY = [P.bodyX, 0, P.bodyY, -0.17, P.bodyZ, -0.02, P.pelvX, 0, P.pelvY, -0.36, P.pelvZ, 0, P.spX, 0.2, P.spY, -0.12, P.spZ, 0, P.hdX, -0.03, P.hdY, 0.42];
function deflectPose(p, A) {
  blockPose(p, A);
  const t = A.t, D = A.player?.deflect;
  const n = fin(D?.n, 1), side = D?.side < 0 ? -1 : 1;
  const f = 1 - smoothstep(0.07, 0.2, t);
  if (A.freeHand === true && guardMode() === 'ref' && f > 0) {
    // (ADR-207: the snap onto the blow is the cross ward's, body and all, and eases back into the reference's
    // guard with it: its blade and hand below are aimed from that body, and posed from the braced guard's
    // turned chest they missed the blow's steel: half the parried blows ended with the blades 0.2 m apart)
    for (let i = 0; i < WARD_BODY.length; i += 2) p[WARD_BODY[i]] += (WARD_BODY[i + 1] - p[WARD_BODY[i]]) * f;
  }
  const s = clamp(0.85 + 0.06 * (n - 1), 0.85, 1.15);
  if (side > 0) {
    // the blow from the front-right: the edge flicks out to the right and up (the classic parry)
    dirTo(p, P.swD, -0.55, 0.8, 0.5, f);
    to3(p, P.rH, -0.05, -0.08, 0.4, f);
    p[P.spY] -= 0.4 * f * s;
    p[P.pelvY] -= 0.15 * f * s;
    p[P.hdY] += 0.3 * f;
  } else {
    // the next one from the front-left: the blade swings up across to the left, the wrist rolled
    dirTo(p, P.swD, 0.62, 0.72, 0.36, f);
    to3(p, P.rH, 0.24, -0.04, 0.42, f);
    p[P.spY] += 0.3 * f * s;
    p[P.pelvY] += 0.1 * f * s;
    p[P.hdY] -= 0.2 * f;
  }
  // a blow from above: the grip up before the brow, the blade level across over the head
  const hi = fin(D?.high);
  const h = clamp(hi, 0, 1) * f;
  if (h > 0.001) {
    dirTo(p, P.swD, 0.9, 0.3, 0.3, h);
    to3(p, P.rH, -0.14, 0.2, 0.34, h);
    p[P.spX] -= 0.1 * h;
    p[P.hdX] -= 0.12 * h;
    p[P.bodyY] -= 0.04 * h;
  }
  // a low cut (at the waist or under): the hanging parry, the grip kept up and the point dropped
  // down and out on the blow's side, the knees giving
  const lo = clamp(-hi, 0, 1) * f;
  if (lo > 0.001) {
    dirTo(p, P.swD, side > 0 ? -0.5 : 0.55, -0.78, 0.38, lo);
    to3(p, P.rH, side > 0 ? -0.12 : 0.2, -0.06, 0.4, lo);
    p[P.bodyY] -= 0.06 * lo;
    p[P.spX] += 0.1 * lo;
  }
  // the nudge onto the blow's steel (the hand stays inside the arm's reach)
  const nx = fin(D?.nx) * f, ny = fin(D?.ny) * f, nz = fin(D?.nz) * f;
  if (nx || ny || nz) {
    let x = p[P.rH] + nx, y = p[P.rH + 1] + ny, z = p[P.rH + 2] + nz;
    const l = Math.hypot(x, y, z);
    if (l > 0.55) {
      x *= 0.55 / l;
      y *= 0.55 / l;
      z *= 0.55 / l;
    }
    v3(p, P.rH, x, y, z);
  }
  to3(p, P.swF, 0, 0.3, 1, f);
  to3(p, P.lH, side > 0 ? 0.22 : 0.3, -0.32, side > 0 ? 0.02 : -0.05, f * (1 - h));
  to3(p, P.lD, LD_FOE[0], LD_FOE[1], LD_FOE[2], f * (1 - h)); // the fingers at the foe
  p[P.spX] -= 0.05 * f;
  // the rock back: the chest gives with the blow, the weight onto the back foot
  const push = 1 - smoothstep(0.02, 0.22, t);
  p[P.spX] -= 0.12 * push * s;
  p[P.bodyZ] -= 0.05 * push;
  p[P.hdX] -= 0.08 * push;
}

/** Blades locked (player.js startBladeLock): both hands on the grip, driven forward at chest height,
 *  the blade standing up and across to his left so it crosses the other's between them; he leans his
 *  weight into it, the arms shake with the strain, and every press of the push (A.recoil) shoves the
 *  grip and the chest in. The grip follows the crossing (the deflect's nudge: _lockCross). */
function lockPose(p, A) {
  const r = A.recoil;
  A.recoil = 0; // (blockPose reads a recoil as a blow driving the guard IN: here it is his shove out)
  blockPose(p, A);
  A.recoil = r;
  const D = A.player?.deflect;
  const sh = Math.sin(A.time * 47) * 0.006 + Math.sin(A.time * 31 + 1.3) * 0.004; // the strain
  dirTo(p, P.swD, 0.42, 0.84, 0.3, 1);
  v3(p, P.swF, -0.3, 0, 1);
  let x = 0.03 + fin(D?.nx) + sh, y = -0.03 + fin(D?.ny) + sh * 0.6, z = 0.44 + fin(D?.nz) + 0.04 * r;
  const l = Math.hypot(x, y, z);
  if (l > 0.55) {
    x *= 0.55 / l;
    y *= 0.55 / l;
    z *= 0.55 / l;
  }
  v3(p, P.rH, x, y, z);
  p[P.bodyZ] = 0.07 + 0.05 * r;
  p[P.bodyY] = -0.2;
  p[P.spX] = 0.26 + 0.05 * r;
  p[P.spY] = -0.06;
  p[P.pelvY] = -0.2;
  p[P.hdX] = -0.12;
  p[P.hdY] = 0.2;
}

/** Bounced: his strike thrown back off a guard that deflected it (player.js onGuarded): the sword
 *  arm flung up and back past the right shoulder, the chest rocked back, the free hand out for
 *  balance, a half step back; home by ~0.4 s (a guard or a dodge cuts it short at once). */
function bouncePose(p, A) {
  const t = A.t;
  guard(p, A);
  const k = t < 0.05 ? easeOutCubic(t / 0.05) : 1 - smoothstep(0.14, 0.42, t);
  p[P.spX] = lerp(p[P.spX], -0.32, k);
  p[P.spY] -= 0.35 * k;
  p[P.pelvY] -= 0.12 * k;
  p[P.hdX] = lerp(p[P.hdX], -0.2, k);
  p[P.bodyZ] -= 0.1 * k;
  p[P.bodyY] -= 0.05 * k;
  to3(p, P.rH, -0.3, 0.2, 0.05, k);
  to3(p, P.rP, -0.9, -0.2, -0.3, k);
  dirTo(p, P.swD, -0.45, 0.8, -0.4, k);
  to3(p, P.lH, 0.28, -0.15, 0.3, k);
  freeLimp(p, k);
  p[P.lF + 2] -= 0.16 * k;
}

/** Walking clips after a parry in rhythm: the upper body holds the block's guard (guardHold
 *  0..1, eased off ~0.6 s after the last parry) while the legs walk, so the blade stays up
 *  between taps instead of dropping to the low ready guard and back for every blow. */
function locoGuard(p, A) {
  loco(p, A);
  swordFromEntry(p, A, LOCO_SETTLE, false); // the blade settles into the stance (a roll's end, a guard let down)
  idleLife(p, A);
  const g = clamp(fin(A.player?.guardHold), 0, 1);
  if (g < 0.001) return;
  if (p === A.target) A.reachT = fin(A.reachT) * (1 - g);
  blockPose(SCR_GUARD, A);
  const ax = p[P.swD], ay = p[P.swD + 1], az = p[P.swD + 2];
  for (const i of GUARD_CH) p[i] += (SCR_GUARD[i] - p[i]) * g;
  dirLerp(p, P.swD, ax, ay, az, SCR_GUARD[P.swD], SCR_GUARD[P.swD + 1], SCR_GUARD[P.swD + 2], g);
}
// ============================================================ end PLUNGE + DEFLECT (plunge agent)

// ================================================================ FLURRY (player/flurry.js, ADR-091)
// The flurry's clip follows player.flurryAnim { pose, clip, u, air, k }; the flurry re-enters it at
// every blink with no cross-fade (he is THERE, already in the pose), and it runs on real time.
//   'cut'     one of the hero's own swings (swings.js `clip`) at phase u: 1..2 its cut, past 2 the
//             finish held. A flash cut, an art's strike
//   'coil'    the iai's draw: the charge's deep crouch, the blade at the right hip, wound tighter
//             as k goes 0..1
//   'raise'   the split's: both fists on the grip, the blade cocked back over the right shoulder
//   'crouch'  the vault's: low before the foe, the blade back by the right knee
//   'flip'    the vault's somersault (u 0..1), forward over the foe (flurry.js turns him round)
// `air`: off the ground. A pass lays him out along his heading with the legs trailing; a coil and
// the split's fall draw the knees up.
const FL_W = 0.1, FL_AC = 0.1, FL_R = 0.3; // the clock (s) a clip's phases are mapped onto
const FL_K = { kind: 'clip', clip: 'drawCut' };

/** Laid out in the air along his heading (k 0..1): the body pitched `lean` rad into it, the rear
 *  leg trailing straight, the front knee drawn up. */
function flAir(p, k, lean) {
  p[P.pitch] += lean * k;
  to3(p, P.rF, -0.13, 0.28, -0.56, k);
  to3(p, P.lF, 0.14, 0.44, -0.06, k);
  to3(p, P.rK, -0.2, -0.3, 1, k);
  to3(p, P.lK, 0.2, 0.4, 1, k);
  p[P.footFlat] = lerp(p[P.footFlat], 0.15, k);
}

function flurryPose(p, A) {
  const S = A.player?.flurryAnim;
  const pose = S?.pose ?? 'cut', u = fin(S?.u, 1), air = !!S?.air, k = clamp(fin(S?.k), 0, 1);
  if (pose === 'flip') {
    // the plunge's backflip, turned the other way: over the foe head first, the blade along his side
    const f = 0.14 + 0.86 * clamp(u, 0, 1);
    plFlip(p, A, f);
    p[P.pitch] = -lin(f, PL_FLIP_PITCH);
    return;
  }
  if (pose === 'coil') {
    chargeStance(p, A, 1, 1);
    p[P.bodyY] -= 0.04 * k;
    p[P.spY] -= 0.12 * k;
    p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.85;
    if (air) {
      plTuck(p, 0.85);
      p[P.pitch] += 0.14;
    }
    return;
  }
  const hold = pose === 'raise' || pose === 'crouch';
  FL_K.clip = pose === 'raise' ? 'slam' : pose === 'crouch' ? 'risingSlash' : S?.clip ?? 'drawCut';
  swingPose(p, A, FL_K, phaseTime(hold ? 1 : clamp(u, 0, 3), FL_W, FL_AC, FL_R), FL_W, FL_AC, FL_R);
  if (pose === 'crouch') {
    // lower still, wound round to his right: the whole body is the spring
    p[P.bodyY] -= 0.1 + 0.04 * k;
    p[P.spX] += 0.1;
    p[P.spY] -= 0.08 * k;
  } else if (pose === 'raise') {
    // arched back under the raised blade, rising a little as it winds
    p[P.spX] -= 0.1 + 0.06 * k;
    p[P.hdX] = 0.35; // eyes down on it
  }
  if (!air) return;
  const a = clamp(u - 1, 0, 1);
  if (pose === 'raise') {
    plTuck(p, 0.85);
    p[P.pitch] -= 0.1;
  } else if (FL_K.clip === 'slam') {
    // the split's fall: knees up, pitching into the blow, the legs opening for the ground
    plTuck(p, 1 - smoothstep(0.62, 1, a));
    p[P.pitch] += lerp(-0.1, 0.42, smoothstep(0, 0.7, a));
  } else flAir(p, 1, 0.5);
}
// ================================================================ end FLURRY

// ---------------------------------------------------------------- idle life
// (Session 14, owner: "add some idle animations of the character doing random stuff while not
// moving ... instead of him just being static all the time".) Standing still in the open (the loco
// clip in the idle state, not locked on, no guard held) for IDLE_LIFE.after s, he does something
// every few seconds, picked at random with the animator's own noise (never the game's RNG): looks
// around, stretches, inspects the blade, twirls it, rests it on his shoulder, or plants it and leans
// on the pommel. Each is a layer over the ready stance with its own envelope; any move, attack or
// guard cuts it, fading out in IDLE_LIFE.cancel s. Visual only: no hit test runs outside attacks.
const IDLE_LIFE = { after: 2.5, gap: [2.0, 4.5], fadeIn: 0.45, fadeOut: 0.55, cancel: 0.16 };
const LEFT_FROM_RIGHT = -(DIM.shoulder[0] + DIM.gripShoulder[0]); // a sword-hand offset → the same point as a free-hand offset (x)
const _fw = new THREE.Vector3(), _fa = new THREE.Vector3(), _fb = new THREE.Vector3();
/** Turn the flat normal p[swF] about the blade p[swD] to angle `a` from its upward-facing side. */
function flatTurn(p, a, w) {
  _fw.set(p[P.swD], p[P.swD + 1], p[P.swD + 2]).normalize();
  _fa.set(0, 1, 0).addScaledVector(_fw, -_fw.y);
  if (_fa.lengthSq() < 1e-6) _fa.set(0, 0, 1).addScaledVector(_fw, -_fw.z);
  _fa.normalize();
  _fb.crossVectors(_fw, _fa);
  to3(p, P.swF, _fa.x * Math.cos(a) + _fb.x * Math.sin(a), _fa.y * Math.cos(a) + _fb.y * Math.sin(a), _fa.z * Math.cos(a) + _fb.z * Math.sin(a), w);
}
/** Scans the field: the head turns right, holds, sweeps left, holds, comes back; the chest and
 *  the weight follow a little. */
function fidgetLook(p, A, u, e) {
  const yaw = kf(u, [0.08, 0, 0.26, -0.8, 0.44, -0.8, 0.62, 0.62, 0.8, 0.62, 0.95, 0]);
  p[P.hdY] += yaw * e;
  p[P.spY] += 0.22 * yaw * e;
  p[P.hdX] += kf(u, [0.08, 0, 0.26, -0.1, 0.62, -0.05, 0.95, 0]) * e;
  p[P.bodyX] += kf(u, [0, 0, 0.26, -0.02, 0.62, 0.025, 1, 0]) * e;
}
/** Rolls the free shoulder (the hand circles up and back), arches the back, then tilts the head to
 *  one side and the other (a neck crack). */
function fidgetStretch(p, A, u, e) {
  const roll = smoothstep(0.04, 0.12, u) * (1 - smoothstep(0.46, 0.54, u));
  const a = TAU * 1.5 * clamp((u - 0.08) / 0.42, 0, 1);
  to3(p, P.lH, 0.08 + 0.03 * Math.sin(a), -0.42 + 0.06 * (1 - Math.cos(a)), 0.02 - 0.05 * Math.sin(a), roll * e);
  p[P.hs] += (0 - p[P.hs]) * roll * e; // the hand loosens as the shoulder rolls
  p[P.spZ] -= 0.05 * Math.sin(a) * roll * e;
  const arch = kf(u, [0.12, 0, 0.32, 1, 0.48, 1, 0.6, 0]);
  p[P.spX] -= 0.13 * arch * e;
  p[P.hdX] -= 0.24 * arch * e;
  p[P.bodyY] += 0.012 * arch * e;
  p[P.hdZ] += kf(u, [0.56, 0, 0.66, 0.4, 0.72, 0.4, 0.82, -0.36, 0.88, -0.36, 0.97, 0]) * e;
}
/** Raises the blade before him, the point up to the front-left, looks along the edge, turns the
 *  flat in the light, and runs the free hand along it from the guard toward the point. */
function fidgetInspect(p, A, u, e) {
  to3(p, P.rH, -0.01, -0.21, 0.3, e);
  to3(p, P.rP, -0.65, -0.7, -0.25, e);
  dirTo(p, P.swD, 0.42, 0.45, 0.79, e);
  flatTurn(p, 0.25 + 1.1 * Math.sin(TAU * smoothstep(0.22, 0.78, u)), e);
  p[P.hdY] += 0.38 * e;
  p[P.hdX] += 0.14 * e;
  p[P.spY] += 0.1 * e;
  // the wipe: the free hand from the guard to two thirds of the way up, a finger's width off the flat
  const wipe = smoothstep(0.3, 0.38, u) * (1 - smoothstep(0.66, 0.74, u));
  const d = lerp(0.14, 0.7, smoothstep(0.36, 0.68, u));
  const lx = p[P.swD], ly = p[P.swD + 1], lz = p[P.swD + 2];
  const ll = Math.hypot(lx, ly, lz) || 1;
  to3(p, P.lH, p[P.rH] + (lx / ll) * d + LEFT_FROM_RIGHT, p[P.rH + 1] + (ly / ll) * d + 0.035, p[P.rH + 2] + (lz / ll) * d, wipe * e);
  to3(p, P.lP, 0.6, -0.7, -0.3, wipe * e);
  // the sword fingers trace the flat: along the blade, the palm on the steel
  p[P.hs] = 1;
  to3(p, P.lD, p[P.swD], p[P.swD + 1], p[P.swD + 2], wipe * e);
  to3(p, P.lN, -p[P.swF], -p[P.swF + 1], -p[P.swF + 2], wipe * e);
}
/** A wrist twirl at his side: the hand comes forward a little and the blade turns one full circle
 *  in the plane beside him (the point forward, up, back, down) and settles into the low hold. */
const TWIRL_X = -0.55;
function fidgetTwirl(p, A, u, e) {
  to3(p, P.rH, -0.21, -0.37, 0.15, e);
  const s = smoothstep(0.16, 0.84, u);
  if (s <= 0 || s >= 1) return;
  const c = Math.sqrt(1 - TWIRL_X * TWIRL_X);
  const a = Math.atan2(IDLE_SW[2], -IDLE_SW[1]) + TAU * s;
  dirTo(p, P.swD, TWIRL_X, -Math.cos(a) * c, Math.sin(a) * c, e);
  to3(p, P.swF, -1, 0, 0, e);
  p[P.hdY] -= 0.2 * e; // he watches it
}
/** Lays the blade on his right shoulder, the flat on it and the point up behind him; a light bounce
 *  of the steel on the shoulder half way through. */
function fidgetShoulder(p, A, u, e) {
  const b = 0.03 * Math.sin(Math.PI * smoothstep(0.45, 0.6, u));
  to3(p, P.rH, 0.0, 0.0 + b, 0.19, e);
  to3(p, P.rP, -0.45, -0.9, 0.2, e);
  dirTo(p, P.swD, -0.1, 0.56, -0.82, e);
  to3(p, P.swF, -1, 0.2, 0, e);
  p[P.hdZ] -= 0.08 * e;
  p[P.hdY] += 0.1 * e;
  p[P.spZ] += 0.04 * e;
}
/** Plants the point in the grass before his right foot and rests both hands on the pommel, leaning
 *  on it a little, head bowed; a slow breath. */
function fidgetLean(p, A, u, e) {
  const br = Math.sin(TAU * u * 1.5) * 0.015;
  to3(p, P.rH, 0.08, -0.27, 0.34, e);
  to3(p, P.rP, -0.75, -0.5, -0.35, e);
  dirTo(p, P.swD, -0.06, -0.99, 0.12, e);
  to3(p, P.swF, 0, 0.1, 1, e);
  to3(p, P.lH, 0.08 + LEFT_FROM_RIGHT + 0.02, -0.18, 0.33, e);
  to3(p, P.lP, 0.75, -0.5, -0.35, e);
  freeLimp(p, e); // the free hand open on the pommel
  p[P.spX] += (0.12 + br) * e;
  p[P.hdX] += 0.12 * e;
  p[P.bodyY] -= 0.02 * e;
  p[P.bodyZ] += 0.02 * e;
}
const FIDGETS = [
  { name: 'look', dur: 3.4, fn: fidgetLook },
  { name: 'stretch', dur: 3.0, fn: fidgetStretch },
  { name: 'inspect', dur: 3.8, fn: fidgetInspect },
  { name: 'twirl', dur: 1.7, fn: fidgetTwirl },
  { name: 'shoulder', dur: 3.6, fn: fidgetShoulder },
  { name: 'lean', dur: 4.2, fn: fidgetLean },
];
// The idle actions of ADR-186 (idles.js): at ease its habits (both arms) with two of the ones above
// (they already moved both arms: the look, the blade inspected), and a trick
// every few; in the fight only the small habits that keep the guard. idles.js's functions take P.
const withP = (D) => ({ ...D, fn: (p, A, u, e) => D.fn(p, P, A, u, e) });
// (the lean on the pommel stays with the old ones: cut by a light or a roll it whipped the point 0.9-1.4 m a frame)
const EASE_LIST = [...EASE_HABITS.map(withP), FIDGETS[0], { ...FIDGETS[2], blade: true }, ...EASE_TRICKS.map(withP)];
const CUT_SLOW = new Set(['block', 'parry', 'heal', 'charge']); // (_idleLife: clips whose entry may take longer out of a trick)
const FIGHT_LIST = FIGHT_ACTS.map(withP);
// `?idles=ref` (the default, ADR-207): the same at ease with the put-away and the draw; in the fight the
// habits that keep both hands on the grip
const EASE_LIST_REF = [...EASE_LIST, ...EASE_REF_EXTRA.map(withP)];
const FIGHT_LIST_REF = FIGHT_ACTS_REF.map(withP);
// (pool 3: the chiburi after the chain, bearing.js FLICK: in either stance, never picked as an idle action)
const FLICK_LIST = [withP(COMBO_FLICK)];
/** The list an idle action's index refers to (A.fidget.pool: 0 the old ones, 1 at ease, 2 the fight, 3 the
 *  flick after the chain; of the mode drawn now: _idleLife cuts an action when the mode changes under it). */
const actList = (pool) => (pool === 1 ? (idlesRef() ? EASE_LIST_REF : EASE_LIST) : pool === 2 ? (idlesRef() ? FIGHT_LIST_REF : FIGHT_LIST) : pool === 3 ? FLICK_LIST : FIDGETS);
/** The current idle action's layer (A.fidget, timed in HeroAnimator._idleLife). */
function idleLife(p, A) {
  const F = A.fidget;
  if (!F || F.k < 0 || !(F.w > 0.001)) return;
  const D = actList(F.pool)[F.k];
  if (D) D.fn(p, A, clamp(F.t / D.dur, 0, 1), F.w);
}

const POSES = {
  loco: locoGuard,
  attack: attackPose,
  charge: chargePose,
  block: blockPose,
  parry: deflectPose,
  bounce: bouncePose,
  lock: lockPose,
  ghostep: ghostepPose,
  plunge: plungePose,
  flurry: flurryPose,
  guardBreak: guardBreakPose,
  roll: rollPose,
  backstep: backstepPose,
  lean: leanPose,
  heal: healPose,
  stagger: staggerPose,
  knockdown: knockdownPose,
  dead: deathPose,
  deadDown: deathDownPose,
};
// clips that lay him on the ground (the cloth obeys gravity there instead of wrapping the body)
const LYING_KEYS = new Set(['knockdown', 'dead', 'deadDown']);
// a posed clip's feet under root motion (HeroAnimator._feetClip): `at` m off its wanted spot a planted
// foot steps, `drag` m it is pulled along; a step lasts dur[0] + dur[1] × the distance (dur[2] at
// most) and rises lift[0] + lift[1] × its size; `cool` s between two steps; a foot wanted `air` m
// above the ankle's height, or a body carried faster than `free` m/s, is left to the clip
const CLIP_STEP = { at: 0.14, drag: 0.5, dur: [0.07, 0.14, 0.15], lift: [0.03, 0.09], cool: 0.02, air: 0.035, free: 9 };
// clips whose feet the foot planner holds on the ground (and whose touchdowns are footsteps)
const WALK_KEYS = new Set(['loco', 'heal', 'block', 'charge', 'parry']);


// ---------------------------------------------------------------- IK
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Analytic two-bone IK in the parent space of the first joint; the chain rests along −Y.
 * Writes the first joint's quaternion (relative to its parent) and the reached end point, and
 * returns the hinge angle for the second joint. bend = +1: the second bone folds toward the first
 * joint's +Z (elbows, hinge rotation.x = −β); −1: toward −Z (knees, rotation.x = +β).
 */
export function solveTwoBone(S, T, pole, a, b, bend, outQ, outEnd) {
  _d.subVectors(T, S);
  let len = _d.length();
  if (!(len > 1e-6) || !Number.isFinite(len)) {
    _d.set(0, -1, 0);
    len = a + b;
  } else {
    _d.divideScalar(len);
  }
  const d = clamp(len, Math.abs(a - b) + 1e-4, (a + b) * 0.9995);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (!(_p.lengthSq() > 1e-8)) {
    _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _p.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _e.copy(S).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA); // elbow / knee
  outEnd.copy(S).addScaledVector(_d, d);
  _y.subVectors(S, _e).normalize(); // up the first bone
  _z.subVectors(outEnd, _e);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-10) _z.copy(_p).negate();
  _z.normalize().multiplyScalar(bend);
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  outQ.setFromRotationMatrix(_m);
  const cosG = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  return Math.PI - Math.acos(cosG);
}

// ---------------------------------------------------------------- animator
const _qRoot = new THREE.Quaternion(), _qBody = new THREE.Quaternion(), _qChest = new THREE.Quaternion();
const _qPelvis = new THREE.Quaternion(), _qBC = new THREE.Quaternion(), _qBP = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _pole = new THREE.Vector3(), _end = new THREE.Vector3();
const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _g = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _qInv = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _q0 = new THREE.Quaternion();
const _qs = new THREE.Quaternion(), _pa = new THREE.Vector3(), _e0 = new THREE.Vector3(), _e1 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _G = new THREE.Vector3(), _TL = new THREE.Vector3(), _qId = new THREE.Quaternion();
const _qInv2 = new THREE.Quaternion(), _qB = new THREE.Quaternion();

const TIP_FLOOR = 0.012; // the steel point rests ON the ground (its outer corners included), never in it
// blade vs the legs (outside attacks): thigh / shin clearance radii (limb + knee guard + margin,
// model.js BODY: they grew with the round-3 legs) and how far from the grip the steel starts to count
const BLADE_CLEAR = [BODY.thigh[0] + 0.025, BODY.shin[0] + 0.028, 0.15];
const _mB = new THREE.Matrix4();
const LEG_PTS = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()); // R hip, knee, ankle; L hip, knee, ankle
const _cD = new THREE.Vector3();
const _cE = new THREE.Vector3(), _cP = new THREE.Vector3(), _cQ = new THREE.Vector3();
const HAND_FLOOR = 0.1; // grip / off-hand centre height floor
const FOOT_FLOOR = 0.06; // ankle height floor
const KNEE_FLOOR = 0.07, ELBOW_FLOOR = 0.055; // a knee's / an elbow's centre never sinks under this (ADR-083)
const _hU = new THREE.Vector3(), _hW = new THREE.Vector3(), _hC = new THREE.Vector3(), _hA = new THREE.Vector3(), _hK = new THREE.Vector3();

// coat skirt springs: [upper, lower] segment stiffness / damping / how much velocity swings them
const COAT_K = [120, 85];
const COAT_C = [13, 9.5];
const COAT_LAG = [0.065, 0.095]; // × (1 + COAT_LAG_V·|v|): ~40° behind vertical at a run, ~60° sprinting
const COAT_LAG_V = 0.18;
const COAT_FLARE = 0.3; // resting outward flare from the hips (≈16°: the A-line)
const COAT_FLOOR = 0.04; // panel ends stay this far above the ground
const COAT_JUMP = 0.2; // rad per frame: the most a lying-down floor fix may swing a panel at once
const COAT_A = [[-1.5, 0.3], [-1.0, 0.6]]; // outward (−) / inward (+) swing limits per segment
const COAT_B = [0.7, 0.55]; // sideways swing limit per segment
const LEG_R = BODY.thigh[0] + 0.004; // thigh / knee radius used to push the panels out
// the blade vs the coat (round 3): the cloth never passes through the steel (it used to come out
// through the tails behind a run). Every frame the grip and points along the drawn blade (BLADE_PTS,
// pelvis space) are tested against each panel segment's sheet: with the sword hand outside the cloth
// the panel hangs INSIDE the hand and the blade (they cap how far it flares; the legs still win), with
// the hand under the cloth (or the steel running in under it, inside the panel's pivot) it drapes OVER
// the blade (they push it out). The side is latched while any steel is over the panel; lying down or
// tumbling, the floor contact rules instead. COAT_BLADE_R / COAT_HAND_R = the blade's half-width /
// the gauntlet, + the cloth's margin.
const COAT_BLADE_R = 0.07, COAT_HAND_R = 0.06;
const COAT_STEEL_JUMP = 0.12; // rad per 60 fps frame: the most the steel moves a coat segment at once
const BLADE_PTS = Array.from({ length: 14 }, () => new THREE.Vector3()); // [0] = the grip, [1..12] the blade, [13] the free hand at its rest (offHand.js) when it is
const NB_STEEL = 13; // the grip and the blade's points
const _mC = new THREE.Matrix4();
// the steel in a panel's anchor frame (QA) and in its lower segment's parent frame (QB): x along the
// hips, y up, z out, from the segment's pivot; SEG = segLocal's output
const QA = new Float32Array(42), QB = new Float32Array(42), SEG = new Float32Array(3);
/** Point k of Q (a coat segment's parent frame, its pivot at the origin) in the frame of that
 *  segment swung (a, b) (rotation order YXZ: Rx(a)·Rz(b)): SEG = [x along it, y down it (≤ 0),
 *  height above the sheet's curve round the hips (radius R)]. Returns whether the point lies over
 *  the sheet (its length L, half-width hw0 → hw1 down it; + 3 cm). */
function segLocal(Q, k, a, b, L, hw0, hw1, R) {
  const qx = Q[k * 3], qy = Q[k * 3 + 1], qz = Q[k * 3 + 2];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const y1 = qy * ca + qz * sa, z1 = -qy * sa + qz * ca;
  const x2 = qx * cb + y1 * sb, y2 = -qx * sb + y1 * cb;
  const t = -y2 / L, Rt = R + 0.25 * clamp(t, 0, 1) * L;
  SEG[0] = x2;
  SEG[1] = y2;
  SEG[2] = z1 + Rt - Math.sqrt(Math.max(0, Rt * Rt - x2 * x2));
  return t > 0.03 / L && t <= 1 && Math.abs(x2) <= lerp(hw0, hw1, clamp(t, 0, 1)) + 0.03;
}
/** Half-width a coat panel's sheet covers at width index i (model.js COAT_PANELS w[i]): a skewed
 *  panel (its width gained on one side only) counts as covering |x| ≤ w/2 + its offset. */
function coatHW(D, i) {
  return D.w[i] / 2 + Math.abs(sheetOffset(D.w[i], D.w[0], D.skew ?? 0));
}
// torn strips (one spring each, so every tip sways on its own and lags its panel ~0.1 s)
const STRIP_K = 75, STRIP_C = 7.5, STRIP_LAG = 0.08, STRIP_FLARE = 0.42;
const STRIP_A = [-1.5, 0.8], STRIP_B = 0.8, STRIP_FLOOR = 0.03;
// sleeve streamers: two-segment springs that stream back almost horizontally when running
const STREAM_K = [55, 40], STREAM_C = [6, 4.5], STREAM_LAG = [0.3, 0.4], STREAM_OUT = 0.36;
const STREAM_A = 2.6, STREAM_B = 1.3;
// a streamer with `floor` (a head ribbon, a long scarf) keeps its segments' ends this high (m, world)
// while he rolls or falls: the forward roll puts his crown at the grass
const STREAM_FLOOR = 0.02;
// … and the grass pushes a lagging end back out at most this fast (rad/s; ~0.1 rad a frame at 60 fps,
// the springs' own largest steps: a full snap to the target popped the Warden ribbon 0.44 rad mid-roll)
const STREAM_PUSH = 6;
// soft reach: where the arm's reach starts to give / the most it opens, as fractions of its length
// (0.955: the elbow keeps ~35° at a full stretch)
const ARM_SOFT = [0.78, 0.955];
// … the hero's (Session 30, owner: "something about the arms still feel unnatural and stiff"): his
// clips ask for the hand at 0.94-1.01 of the arm's length at a cut's contact and a thrust's end, and
// through ARM_SOFT that came out as an elbow of 124-130° in EVERY swing: the arms never opened, a cut
// and a thrust were made with the same crooked arm. With these a hand at a full stretch opens the
// elbow to ~150° (it still never locks: 163° is the most it reaches), and a hanging arm hangs
const HERO_SOFT = [0.93, 0.99];
// joint limits (ADR-078): the least angle an elbow / a knee closes to, as the nearest a hand / a foot
// may come to its shoulder / hip (the law of cosines on the two bones)
const ARM_FOLD = 40 * (Math.PI / 180), LEG_FOLD = 32 * (Math.PI / 180);
const ARM_NEAR = Math.sqrt(DIM.upperArm ** 2 + DIM.foreArm ** 2 - 2 * DIM.upperArm * DIM.foreArm * Math.cos(ARM_FOLD));
const LEG_NEAR = Math.sqrt(DIM.thigh ** 2 + DIM.shin ** 2 - 2 * DIM.thigh * DIM.shin * Math.cos(LEG_FOLD));
const TORSO_R = [0.15, 0.115]; // m: the ribs' half-width and half-depth round the chest's axis (a hand stays outside)
const WRIST_BACK = 128 * (Math.PI / 180); // the most the blade folds back from the forearm's line (0 = in line with it, a point)
const WRIST_COS = Math.cos(WRIST_BACK), WRIST_SIN = Math.sin(WRIST_BACK);
const WRIST_CLEAR_COS = Math.cos(70 * (Math.PI / 180)); // … and, there, the least angle round the forearm between the steel and the upper arm
const ELBOW_RATE = 14; // rad/s: the most an elbow swings round its shoulder → hand line (~13° a frame)
const _eA = new THREE.Vector3(), _eW = new THREE.Vector3(), _eP = new THREE.Vector3(), _eC = new THREE.Vector3();
const TWO_HAND_GRIP = DIM.offGrip; // m down the grip from the sword hand to the off hand (two-handed)
// THE GRIP (a sword-wielding boss's animator only: `gripMax`, ADR-226): the most the blade turns off the
// sword forearm's line before the forearm itself is turned toward the steel round the elbow (the hand
// moves, the blade's direction does not; the elbow stays where the arm put it, folded no tighter than
// GRIP_FOLD). The hero's own swings are keyed with the wrist inside 60 degrees (ADR-207); a boss keyed
// by the blade alone bent it to WRIST_BACK, the fist turned off the wrist.
const GRIP_FOLD = 38 * (Math.PI / 180);
const _gE = new THREE.Vector3(), _gF = new THREE.Vector3(), _gD = new THREE.Vector3(), _gW = new THREE.Vector3(), _gT = new THREE.Vector3(), _gU = new THREE.Vector3();
// THE FREE HAND (the hero only: opts.freeHand). Its wrist's range (rad: radial / ulnar deviation,
// pronation / supination from the IK's neutral, flexion / extension), its spring (ω, ζ for the
// deviation and the flex; wT, zT the heavier twist), the most each turns in a frame (rad), and the
// twist beyond which a target is taken as a flip through the far side (last frame's twist is kept)
const D2R = Math.PI / 180;
export const WRIST_L = {
  rad: -20 * D2R, uln: 30 * D2R, pro: -85 * D2R, sup: 85 * D2R, flex: -70 * D2R, ext: 60 * D2R,
  w: 42, z: 0.55, wT: 30, zT: 0.8, cap: 0.35, flipGuard: 150 * D2R,
};
const WRIST_HZ = 120; // the wrist spring's sub-steps per second (at least: ≤ 4 a frame, dt ≤ 1/30)
// the fingers on the sword wrist (lk): how far up the sword forearm from its end the wrist is (m),
// where the free palm rests on it (m toward the free shoulder, m up), how much the fingers turn to
// lie along it, and the sword hand's speed (m/s) over which they let go as it whips away
const LK_WRIST = 0.07, LK_OFF = [0.045, 0.025], LK_ALONG = 0.5, LK_LETGO = [4, 8];
// the free fist shows on the grip within [0] of its place (m) and goes back past [1] (it used to be
// drawn 9-21 cm off the wrist while the hand was still on its way); fully two-handed (twoHand ≥
// 0.95) a fist already shown stays until [2]: a free arm that cannot quite reach the hilt (the
// plunge's raised fists stop 4-6 cm short) keeps its fist instead of flickering to an open hand
export const OFF_SNAP = [0.035, 0.05, 0.08];
// the side hand's pendulum (_sideHand): its sub-steps per second (at least), and the frame length past which
// it is set on its rest; the furthest it may hang from the shoulder (model m: the soft reach draws 0.58 as an
// elbow of ~155°), eased in from SIDE_FOLD (a hand held folded at the chest is not thrown out in a frame);
// its lag on the way in (no limit: it falls from wherever it was). The nearest: the look's `near`
const SIDE_HZ = 240, SIDE_SNAP = 0.1, SIDE_REACH = 0.58, SIDE_FOLD = 0.25, SIDE_FREE = 1.5;
// … and how long a look's `tuck` (offHand.js) takes to draw it in for a turning swing and let it out again (s)
const SIDE_TUCK = 0.12;
const _shR = new THREE.Vector3(), _shO = new THREE.Vector3(), _shQ = new THREE.Vector3(), _shG = new THREE.Vector3(), _shA = new THREE.Vector3(), _shB = new THREE.Vector3(), _shC = new THREE.Vector3();
// × the arm's length: the free elbow on the grip keeps ≥ 23° of bend (the cleave locked it at 176°)
const LOCK_REACH = 0.98;
const _hG = new THREE.Vector3(), _hd = new THREE.Vector3(), _hn = new THREE.Vector3(), _hy = new THREE.Vector3(), _hp = new THREE.Vector3();
const _hz = new THREE.Vector3(), _hq1 = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hqs = new THREE.Quaternion();
// the cloak in the charge's updraft: extra outward flare (tan) at full charge of a sheet on his
// right, the sword side, where the drawn-back blade and arms are; [1] of it for one on his left.
// Off (Session 14 follow-up, owner: "the back cape is too floaty now and makes the character look
// wider from the back view"): the blade's own collision keeps the cloth off the steel
const UPDRAFT_STREAM = [0, 0];
// Streamer sheets vs the steel (Session 14, owner: "when he's charging the sword, the sword and arm
// are clipping through the cape"; measured: the blade inside a cloak sheet in 94 of 150 charge
// frames). Spheres along the blade (body-model metres); the arms take none (COL_FORE / COL_UPPER
// are empty): a cloak drapes over its wearer's arms, and holding every sheet out round them made
// him wider from behind and the cloak float (owner, the same session). The charge pose keeps the
// arm out of the cloak instead. Each sheet segment remembers, for every sphere that comes within its width
// and length, which side of it the sphere arrived on, and keeps it there by its radius: one that
// came in from the body side (the arms, a sword drawn back from inside the cloak) holds the cloth
// OUT, so it drapes over them; one that came from outside (a blade swung round behind him) holds it
// IN. Where the two disagree the cloth goes out. A sheet hung on an arm ignores that arm.
// [sword-joint z or limb y, radius]
const COL_BLADE = [[0.3, 0.05], [0.52, 0.05], [0.74, 0.05], [0.95, 0.045]];
const COL_FORE = [];
const COL_UPPER = [];
const COL_N = COL_BLADE.length + 2 * (COL_FORE.length + COL_UPPER.length);
const COL_P = Array.from({ length: COL_N }, () => new THREE.Vector3());
const COL_R = new Float32Array(COL_N);
const COL_ARM = new Uint8Array(COL_N); // 0 the blade, 1 the right arm, 2 the left arm
const COL_BND = new Float32Array(2); // _sheetBound's result: the least / most outward swing allowed
const _so = new THREE.Vector3(), _cq = new THREE.Vector3(), _qS = new THREE.Quaternion();
const _sf = new THREE.Vector3(), _cf = new THREE.Vector3(); // a `floor` streamer's segment root (world, drawn lengths)
// (the cloak's calm, clothCalm.js: his root, its speed, the chest's and an arm's turn, the sheet's turn on each)
const _cR = new THREE.Vector3(), _cV = new THREE.Vector3(), _cC = new THREE.Quaternion(), _cA = new THREE.Quaternion();
const _cS = new THREE.Quaternion(), _cT = new THREE.Quaternion();
const PAULDRON_FOLLOW = 0.35; // how much of the sword arm's swing the shoulder armour follows
// the charge's updraft (× A.updraft 0..1): extra outward flare of the coat panels and the
// torn strips (rad), and an upward pull on the hair tips (m of tip displacement)
const UPDRAFT_COAT = 0.3, UPDRAFT_STRIP = 0.35, UPDRAFT_HAIR = 0.12;
// hair blow-back: rad per m/s of the tips' own along-ground speed (head axes): ~20° at the sprint
const HAIR_DRAG = 0.06;
/** the living world's wind on the locks: m/s of air → tip displacement (as HAIR_DRAG does his own speed) */
const HAIR_WIND = 0.06;
const _hw = new THREE.Vector3(), _hwRec = { x: 0, z: 0, k: 0, alarm: 0 };

// hair cluster springs (rotation vector, head space)
const HAIR_K = 170, HAIR_C = 13, HAIR_MAX = 0.4;
// idle breeze on the coat: extra outward flare per panel (model.js COAT_PANELS order: front-left,
// front-right, left, right, back-left tail, back-right tail; the tails stir the most)
const BREEZE = [0.02, 0.025, 0.035, 0.035, 0.06, 0.05];
// standing still, the panels hang with a little extra outward flare at their points (the reference
// sheet: two tails split by a vent behind, each flaring to its outer point, narrow side panels, the
// front panels beside the legs; ADR-034 retired round 3's wide skirt): extra outward swing per
// panel, faded out by speed
const IDLE_FLARE = [0.01, 0.02, 0.07, 0.1, 0.09, 0.12];

export class HeroAnimator {
  /** player must expose: yaw, state, stateT, animT, atk ({def, pending, relT, hitAt}), groundVel {x, z}, chargeK,
   *  releaseK, recoil (+ position, kb, lockOn, guardHold, updraft). `poses` (optional): extra clips for this
   *  instance, key → fn(pose, animator), merged over the hero's (a key it shares replaces the hero's
   *  clip for this instance only: the Ash Disciple brings his own 'loco' and 'duel').
   *  opts.freeHand (the hero only): the free hand's wrist (rig.arms.L.wrist) turned from the pose's
   *  lD / lN, the sword fingers (lk: resting on the sword wrist; hs: their shape), the fist on the grip
   *  shown only once the hand is there (OFF_SNAP), and the free elbow's lock reach (LOCK_REACH). Off,
   *  the free-hand channels are ignored (they may carry guard()'s rest for the hero) and the hand
   *  stays rigid on the forearm (every duelist). */
  constructor(rig, player, poses = null, opts = {}) {
    // (before reset(): it poses the rig once)
    this.freeHand = !!(opts?.freeHand && rig.arms?.L?.wrist);
    /** [where the arm's reach starts to give, the most it opens] as fractions of its length, or null
     *  for ARM_SOFT (an elbow of ~130° at a full stretch; the hero's arms take HERO_SOFT). A boss whose
     *  blows are his fists sets it (ADR-162). */
    this.armSoft = Array.isArray(opts?.armSoft) ? opts.armSoft : null;
    /** ... and the legs' (null: a leg reaches straight, as always; ADR-162). */
    this.legSoft = Array.isArray(opts?.legSoft) ? opts.legSoft : null;
    /** () => s: a planted foot the clip lifts is eased from where it stood to the clip's key over this
     *  long, not handed to the key at once (a boss's clip foot left behind by its root motion jumped up to
     *  0.46 m in a frame; ADR-223). Bosses only (a function: their motion switch, read live); 0 = as before. */
    this.liftEase = typeof opts?.liftEase === 'function' ? opts.liftEase : null;
    /** With liftEase: a foot the clip lifts while the foot planner is still STEPPING it (mode 1: a root
     *  that closes in left it behind) eases from where it is drawn too, not only a planted one (Wen Yao's
     *  Hand to Hand jab: it jumped 0.43 m in a frame; ADR-249). Off: as before (a stepping foot is the
     *  clip's at once). */
    this.liftFromStep = !!opts?.liftFromStep;
    /** [from, to, add, lift0, lift1] or null: a boss whose kicks land with the leg straight (Xin Yi,
     *  ADR-221; _leg). A lifted foot asked for past `from` of the leg's length is carried out, by up to
     *  `add` of it at `to`, so the leg reaches its full length at a kick's extension. */
    this.kickStretch = null;
    this.wristL = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0, ok: false, clamped: false };
    this.handFX = { fingers: false, fist: false };
    this.lkState = { prev: new THREE.Vector3(), ok: false, k: 1 };
    this.lkEff = 0;
    // the side hand (offHand.js, _sideHand): the pendulum (x, v), its rest's offset (r), where a way began
    // (c), last frame's hand (last), the way's ease (e), the way (mode: 1 to the side, -1 home, 0 off), p[sd]
    // last frame (pw); after a one-handed swing how long it still lingers (lg), how much it still holds
    // (hold), whether what plays now needs the hand back quickly (quick); the look it hangs in (L)
    this.sideH = { x: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), last: new THREE.Vector3(), e: 0, mode: 0, pw: 0, ok: false, lg: 0, hold: 0, quick: false, L: null };
    this.gripGap = 1;
    this.rig = rig;
    this.player = player;
    this.poses = poses ? { ...POSES, ...poses } : POSES;
    this.cur = new Float32Array(N);
    this.from = new Float32Array(N);
    this.target = new Float32Array(N);
    this.key = 'loco';
    this.blendT = 1;
    this.blendDur = 1;
    this.easeOut = false;
    this.time = 0;
    this.t = 0;
    this.moveW = 0;
    this.sprintW = 0;
    this.swordW = 0;
    this.fightW = 0; // 0 at ease … 1 the fight stance (stand(), stances.js)
    this.speed = 0;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.armDir = 1; // the arms' swing: the fore-aft sign he last moved in, and its eased value (loco armF)
    this.armSign = 1;
    this.mh = 0; // move direction angle (model space): mx = sin, mz = cos
    this.def = null;
    this.chargeK = 0;
    this.releaseK = 0;
    this.recoil = 0;
    this.pathCh = null; // channels this frame's target drives itself, past the cross-fade (windup paths)
    // the elbows' last directions off their shoulder → hand lines (chest space; _elbow), this frame's dt
    this.elbowR = { v: new THREE.Vector3(), ok: false };
    this.elbowL = { v: new THREE.Vector3(), ok: false };
    this.frameDt = 0;
    this.updraft = 0; // the charge's updraft on the coat and hair (0..1, eased)
    // idle life: the action playing (k = FIDGETS index, -1 none), its time, weight, whether it was
    // cut, calm time since the last one ended, the wait before the next, and how many have played
    this.fidget = { k: -1, t: 0, w: 0, cut: false, still: 0, wait: IDLE_LIFE.after, last: -1, count: 0, name: '' };
    // the put-away (idles.js STOW, ADR-207): 0 the sword whole … 1 gone (_idleLife; _stowSword shows it)
    this.stow = 0;
    this._stowK = 0;
    this._stowScale = null;
    // the attack's look (combat.js `variants`): which def it was picked for, the anim block, its index
    this.atkDef = null;
    this.atkAnim = null;
    this.atkVar = 0;
    this.varLast = {}; // def name → the variant it played last
    this.lastLine = null; // the line the last swing cut along (swings.js `line`)
    this.forceVariant = null;
    // the animator's own noise (0..1) for cosmetic kicks that must not draw on the game's RNG stream
    // (the integration sims seed Math.random; the wyrm's AI rolls on it)
    this._ns = 0x2545f491;
    this.noise = () => {
      this._ns = (Math.imul(this._ns, 1664525) + 1013904223) >>> 0;
      return this._ns / 4294967296;
    };
    this.onFootstep = null;
    // gait drivers (update): cycle parameters, model-space acceleration, banking, strafe hip turn
    this.gait = { beta: 0.62, exc: 0.11, off: 0, lift: 0.05, kick: 0, peel: 0.02, len: 0.35 };
    this.speedS = 0; // the speed through a critically damped spring (posture terms; no kinks)
    this.speedSV = 0;
    this.backW = 0; // 0..1 eased: moving backward relative to the facing (the blade guards forward)
    this.wantOK = false; // FEET_WANT holds this frame's wanted feet (the planner ran)
    this.fadeMem = { d: 0, ok: false }; // the cross-fade's blade sweep (see dirLerp)
    this.accF = 0;
    this.accS = 0;
    this.bank = 0;
    this.turnV = 0;
    this.strafeYaw = 0;
    this.turnLag = 0; // visual: the hips trail a fast turn of the root
    this.visYaw = 0;
    this.visYawV = 0;
    this.cycOn = false;
    this._pv = { x: 0, z: 0, h: 0, init: false };
    // foot planner (see _feet): per foot { init, lock, wx, wz, wyaw, mode, s, dur, lx, ly, lz, lyaw, cx, cz, cyaw, prevU }
    this.feet = [0, 1].map(() => ({ init: false, lock: false, hold: false, wx: 0, wz: 0, wyaw: 0, mode: 0, s: 1, dur: 0.2, lift: 0, lx: 0, ly: ANK, lz: 0, lyaw: 0, cx: 0, cz: 0, cyaw: 0, prevU: 0, ox: 0, oy: ANK, oz: 0, oyaw: 0 }));
    // root travel since the current clip started (model space, drawn scale) and per-clip marks of
    // it (poses that hold feet on their spots while the root moves: push-offs, landings)
    this.clipX = 0;
    this.clipZ = 0;
    this.trav = { x: 0, z: 0 };
    this.marks = [0, 1, 2, 3].map(() => ({ set: false, x: 0, z: 0 }));
    this.dashStep = 0; // a dash's touchdowns already stepped (bits: rear, front)
    this.stepL = true; // the foot that steps in an attack (play(): the one further back)
    this.leadK = 1; // swingPose: the hips' lead (0 while a held light waits at the coil)
    this.bite = { rec: null, at: -1, dir: new Float32Array(3) }; // attackPose: the hit the bite is for, the blade it bit with
    this.coilHold = 0; // lungeFeet: 1 while a held light waits at the coil (the stepping foot rests)
    // lungeFeet: the holding foot's follow step (on: −1 undecided, 0 none, 1 stepping; from x, z;
    // its window t0..t1 of the attack's clock)
    this.follow = { on: -1, x: 0, z: 0, t0: 0, t1: 0 };
    this.spots = new Float32Array(4); // lungeFeet → spinTurn: the rear spot x, z; the front spot x, z (model)
    // spinTurn ('hop'): caught as the feet lift (set): the turn then (yaw) and each foot's angle and
    // radius about the root (a, r: right, left; model)
    this.hop = { set: false, yaw: 0, a: new Float32Array(2), r: new Float32Array(2) };
    this.plantAt = { x: 0, z: 0, ok: false }; // lungeFeet: the front spot the stepping foot planted on
    this.holdOff = { x: 0, z: 0 }; // lungeFeet: how far the holding foot has been dragged (model)
    this.footDrag = 0; // lungeFeet (tests read it): bit 1 = the right toe drags, 2 = the left
    this.toeK = 0; // lungeFeet: the holding foot's sole on its toe (1 while it drags, settling back after)
    this.entry = new Float32Array([-0.25, ANK, 0.15, 0.13, ANK, -0.03, -0.4, 0.22]);
    this.leanF = 0; // acceleration lean (rad), a critically damped spring on the smoothed acceleration
    this.leanFV = 0;
    this.leanS = 0;
    this.leanSV = 0;
    this.stepCool = 0;
    this.coatState = rig.coat.map(() => [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }]);
    this.coatSide = new Uint8Array(rig.coat.length).fill(1); // per panel: the steel 1 outside it, 2 under it
    this.stripState = rig.coat.map((C) => C.strips.map(() => ({ x: 0, vx: 0, z: 0, vz: 0 })));
    this.streamState = (rig.streamers ?? []).map((S) => ({
      segs: [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }], prev: new THREE.Vector3(), vel: new THREE.Vector3(),
      side: new Int8Array(2 * COL_N), // per segment and collision sphere: 1 came from inside, −1 from outside, 0 away
      rest: S.segs[0].parent.quaternion.clone(), // its hanging joint's turn as built (clothCalm.js: on an arm)
    }));
    this.clothRoot = new THREE.Vector3(); // his root last frame and its speed (clothCalm.js `rel`)
    this.clothVel = new THREE.Vector3();
    this.streamInit = false;
    this.coatPrev = rig.coat.map(() => new THREE.Vector3());
    this.coatVel = rig.coat.map(() => new THREE.Vector3());
    this.coatInit = false;
    this.hairState = HAIR_CLUSTERS.map(() => ({
      r: new THREE.Vector3(), v: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
    }));
    this.hairInit = false;
    this.legPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    // sphere proxies (joint-local centre + radius) kept above the ground by apply(); the torso ones
    // follow the lean chest / hip depth (model.js BODY, ADR-034)
    this.proxies = [
      { joint: rig.head, x: 0, y: 0.13, z: 0, r: 0.13 },
      { joint: rig.chest, x: 0, y: 0.09, z: 0, r: 0.13 },
      { joint: rig.spine, x: 0, y: 0.06, z: 0, r: 0.11 },
      { joint: rig.pelvis, x: 0, y: -0.02, z: 0, r: 0.13 },
    ];
    this.reset();
  }

  /** The figure's drawn size (model metres → world): its owner's `drawScale` (the player's
   *  PLAYER_SCALE), else HERO_SCALE (the Ash Disciple). */
  get drawScale() {
    const s = this.player?.drawScale;
    return s > 0 ? s : HERO_SCALE;
  }

  /** Start a clip, cross-fading from the current pose over `blend` seconds (0: no fade at all, the
   *  clip's pose is the next frame's: an impact's contact pose, which a freeze-frame holds). */
  play(key, blend = 0.12, easeOut = false) {
    if (!this.poses[key]) key = 'loco';
    const pp = this.player.position;
    this.clipX = fin(pp?.x);
    this.clipZ = fin(pp?.z);
    this.trav.x = this.trav.z = 0;
    for (const M of this.marks) M.set = false;
    this.dashStep = 0;
    // where the feet are as the clip starts (model space): push-offs keep them on these spots
    const E = this.entry, c0 = this.cur;
    E[0] = c0[P.rF];
    E[1] = c0[P.rF + 1];
    E[2] = c0[P.rF + 2];
    E[3] = c0[P.lF];
    E[4] = c0[P.lF + 1];
    E[5] = c0[P.lF + 2];
    E[6] = c0[P.rFy];
    E[7] = c0[P.lFy];
    // the foot that steps in an attack: the one further back along his facing (lungeFeet; a clip's
    // `bx` is toward it; the way home draws it back)
    this.stepL = E[5] <= E[2];
    this.leadK = 1;
    this.coilHold = 0;
    this.follow.on = -1;
    this.footDrag = 0;
    this.plantAt.ok = false;
    this.holdOff.x = this.holdOff.z = 0;
    this.hop.set = false;
    this.toeK = 0;
    this.reachFrom = this._swordOpen(); // (the sword arm's reach fades with the pose: _swordOpen)
    this.from.set(this.cur);
    for (const i of ANGLES) this.from[i] = wrapAngle(this.from[i]); // a finished roll is 2π ≡ 0
    // how far round the body stood as this clip began (a whirl cut short): the reactions unwind it
    this.yaw0 = Math.abs(this.from[P.yaw]) > 0.2 ? this.from[P.yaw] : 0;
    if (this.wantOK && WALK_KEYS.has(this.key) && WALK_KEYS.has(key)) {
      // the foot planner keeps running across this switch and re-applies its corrections (planted
      // spots, swing offsets) to whatever the clip wants: fade from what the old clip WANTED, not
      // from its corrected output, or a swinging foot gets its offset twice (a one-frame jump)
      const W = FEET_WANT, F = this.from;
      F[P.rF] = W[0];
      F[P.rF + 1] = W[1];
      F[P.rF + 2] = W[2];
      F[P.rFy] = W[3];
      F[P.lF] = W[4];
      F[P.lF + 1] = W[5];
      F[P.lF + 2] = W[6];
      F[P.lFy] = W[7];
    }
    this.key = key;
    if (key === 'attack') this._pickVariant();
    this.fadeMem.ok = false; // the new fade picks its own way round
    this.blendT = 0;
    this.blendDur = blend > 0 ? Math.max(1e-3, blend) : 0;
    this.easeOut = easeOut;
  }

  reset() {
    this.time = 0;
    this.t = 0;
    this.moveW = 0;
    this.sprintW = 0;
    this.swordW = 0;
    this.fightW = 0; // 0 at ease … 1 the fight stance (stand(), stances.js)
    this.speed = 0;
    this.speedS = this.speedSV = 0;
    this.backW = 0;
    this.wantOK = false;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.armDir = 1; // the arms' swing: the fore-aft sign he last moved in, and its eased value (loco armF)
    this.armSign = 1;
    this.mh = 0;
    this.def = null;
    this.chargeK = 0;
    this.releaseK = 0;
    this.recoil = 0;
    this.key = 'loco';
    this.yaw0 = 0;
    this.accF = this.accS = this.bank = this.turnV = this.strafeYaw = this.turnLag = this.visYawV = 0;
    this.leanF = this.leanFV = this.leanS = this.leanSV = 0;
    this.updraft = 0;
    this.stepL = true;
    this.leadK = 1;
    this.bite.rec = null;
    this.coilHold = 0;
    this.follow.on = -1;
    this.footDrag = 0;
    this.plantAt.ok = false;
    this.holdOff.x = this.holdOff.z = 0;
    this.hop.set = false;
    this.toeK = 0;
    Object.assign(this.fidget, { k: -1, t: 0, w: 0, cut: false, still: 0, wait: IDLE_LIFE.after, name: '' });
    this.stow = 0;
    this.visYaw = fin(this.player.yaw);
    this.cycOn = false;
    this._pv.init = false;
    for (const F of this.feet) F.init = false;
    gaitParams(this.gait, 0, 0);
    guard(this.cur, this); // (with the hero's free hand: an animator without opts.freeHand ignores it)
    this.wristL.ok = false;
    this.lkState.ok = false;
    this.sideH.ok = false;
    this.sideH.lg = this.sideH.hold = 0;
    this.handFX.fingers = this.handFX.fist = false;
    this.from.set(this.cur);
    this.target.set(this.cur);
    this.blendT = this.blendDur = 1;
    for (const st of this.coatState) {
      for (const c of st) c.x = c.vx = c.z = c.vz = 0;
    }
    this.coatSide.fill(1);
    for (const st of this.stripState) {
      for (const c of st) c.x = c.vx = c.z = c.vz = 0;
    }
    for (const st of this.streamState) {
      for (const c of st.segs) c.x = c.vx = c.z = c.vz = 0;
      st.vel.set(0, 0, 0);
      st.side.fill(0);
    }
    this.streamInit = false;
    for (const v of this.coatVel) v.set(0, 0, 0);
    for (const h of this.hairState) {
      h.r.set(0, 0, 0);
      h.v.set(0, 0, 0);
      h.vel.set(0, 0, 0);
    }
    this.coatInit = false;
    this.hairInit = false;
    this.frameDt = 0;
    this.elbowR.ok = this.elbowL.ok = false;
    this.apply(this.cur);
    this._coat(0);
    this._hair(0);
    this._streamers(0);
    this.rig.root.updateMatrixWorld(true);
  }

  /** The body jumped (Ghostep / teleport): forget the last positions so cloth and hair don't
   *  read the jump as a huge velocity. */
  teleported() {
    this.coatInit = false;
    this.hairInit = false;
    this.streamInit = false;
    this._pv.init = false;
    this.visYaw = fin(this.player.yaw);
    this.visYawV = this.turnLag = 0;
    for (const F of this.feet) F.init = false;
    for (const v of this.coatVel) v.set(0, 0, 0);
    for (const h of this.hairState) h.vel.set(0, 0, 0);
    for (const st of this.streamState) st.vel.set(0, 0, 0);
    this.wristL.ok = false;
    this.lkState.ok = false;
    this.sideH.v.set(0, 0, 0); // (it hangs on from where it was in his frame: the root's jump is not its)
  }

  /** Throw the coat panels outward (Ghostep reappear, guard break, the slam's impact). `rnd` (0..1
   *  noise) defaults to Math.random; new kicks pass this.noise so they leave the game's RNG alone. */
  kickCoat(power = 1, rnd = Math.random) {
    const k = clamp(fin(power), 0, 3);
    for (let i = 0; i < this.coatState.length; i++) {
      const st = this.coatState[i];
      st[0].vx -= k * (3 + 1.5 * rnd());
      st[1].vx -= k * (4 + 2 * rnd());
      st[1].vz += k * (rnd() - 0.5) * 3;
      for (const c of this.stripState[i]) {
        c.vx -= k * (3 + 3 * rnd());
        c.vz += k * (rnd() - 0.5) * 4;
      }
    }
    for (const st of this.streamState) {
      st.segs[0].vx += k * (rnd() - 0.5) * 6;
      st.segs[1].vx += k * (rnd() - 0.5) * 8;
    }
  }

  update(dt) {
    const pl = this.player;
    this.frameDt = dt;
    this.time += dt;
    this.t = fin(pl.animT, fin(pl.stateT));
    this.def = pl.atk ? pl.atk.def : null;
    this.chargeK = fin(pl.chargeK);
    this.releaseK = fin(pl.releaseK);
    {
      // a held light waiting at its coil (player.js _tickAttack): the hips settle out of their lead,
      // the stepping foot rests its toe (once a frame, here: the pose stays a pure function of the
      // animator's state)
      const at = pl.atk, held = this.key === 'attack' && !!at?.pending && this.t >= fin(at.def?.windup, Infinity) - 1e-4;
      this.leadK = damp(fin(this.leadK, 1), held ? 0 : 1, SW_LEAD_FADE, dt);
      this.coilHold = damp(fin(this.coilHold, 0), held ? 1 : 0, COIL_HOLD.rate, dt);
    }
    // a blocked blow drives the guard in over 2-3 frames (an impact, not a one-frame pop)
    const rc = clamp(fin(pl.recoil), 0, 1);
    this.recoil = rc > this.recoil ? Math.min(rc, this.recoil + dt * 24) : rc;

    // gait drivers from the hero's actual ground velocity, expressed in model space
    const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw);
    const vx = fin(pl.groundVel.x), vz = fin(pl.groundVel.z);
    const lx = vx * c - vz * s, lz = vx * s + vz * c;
    const sp = Math.hypot(lx, lz);
    if (sp > 0.2) {
      // the move direction turns as an ANGLE (a damped vector re-normalised every frame never
      // reversed: running straight back or out of a backstep kept the forward stride); from rest it
      // snaps to the new direction, while running it swings round over ~0.1 s
      const rate = 14 + 40 * (1 - this.moveW);
      this.mh = wrapAngle(this.mh + wrapAngle(Math.atan2(lx, lz) - this.mh) * (1 - Math.exp(-rate * dt)));
      if (!Number.isFinite(this.mh)) this.mh = 0;
      this.mx = Math.sin(this.mh);
      this.mz = Math.cos(this.mh);
    }
    this.speed = sp;
    {
      // second order: continuous velocity AND acceleration through the gameplay's start / stop kinks
      const W = 15;
      this.speedSV += (W * W * (sp - this.speedS) - 2 * W * this.speedSV) * dt;
      this.speedS = Math.max(0, this.speedS + this.speedSV * dt);
      if (!Number.isFinite(this.speedS + this.speedSV)) {
        this.speedS = sp;
        this.speedSV = 0;
      }
    }
    this.moveW = damp(this.moveW, clamp(sp / 3, 0, 1), 10, dt);
    // the arms' swing keeps the fore-aft sign he last moved in through a sideways move (loco armF)
    if (sp > 0.2 && Math.abs(this.mz) > 0.15) this.armDir = this.mz > 0 ? 1 : -1;
    this.armSign = damp(fin(this.armSign, 1), fin(this.armDir, 1), 12, dt);
    if (sp > 0.2) this.backW = damp(this.backW, 1 - smoothstep(-0.75, -0.15, this.mz), 6, dt);
    this.sprintW = damp(this.sprintW, pl.state === 'sprint' ? 1 : 0, 6, dt);
    this.swordW = damp(this.swordW, this.moveW, 7, dt);
    // the charge's updraft (0..1): lifts the coat tails and the hair as the cleave charges
    // (a pilot may raise a wind of its own under its cloth: `updraft` 0..1, a duelist's casts)
    this.updraft = damp(this.updraft, this.key === 'charge' ? clamp(fin(pl.chargeK), 0, 1) : clamp(fin(pl.updraft), 0, 1), 5, dt);
    // acceleration (model space) for the lean into starts / the sit-back on stops, and the turn rate
    // of the velocity heading for banking into curves
    const P0 = this._pv;
    if (P0.init && dt > 1e-4) {
      const ax = (vx - P0.x) / dt, az = (vz - P0.z) / dt;
      this.accS = damp(this.accS, clamp(ax * c - az * s, -60, 60), 9, dt);
      this.accF = damp(this.accF, clamp(ax * s + az * c, -60, 60), 9, dt);
      const h = Math.atan2(vx, vz);
      const om = sp > 1 && Math.hypot(P0.x, P0.z) > 1 ? clamp(wrapAngle(h - P0.h) / dt, -10, 10) : 0;
      this.turnV = damp(this.turnV, om, 8, dt);
      P0.h = h;
    } else {
      P0.h = Math.atan2(vx, vz);
    }
    P0.x = vx;
    P0.z = vz;
    P0.init = dt > 1e-4;
    this.bank = clamp(this.turnV * sp * 0.014, -0.26, 0.26);
    {
      const W2 = 110, Z2 = 2 * Math.sqrt(W2); // ω ≈ 10.5 /s, critically damped
      const tf = clamp(this.accF * 0.03, -0.24, 0.3), ts = clamp(this.accS * 0.02, -0.15, 0.15);
      this.leanFV += (W2 * (tf - this.leanF) - Z2 * this.leanFV) * dt;
      this.leanF += this.leanFV * dt;
      this.leanSV += (W2 * (ts - this.leanS) - Z2 * this.leanSV) * dt;
      this.leanS += this.leanSV * dt;
      if (!Number.isFinite(this.leanF + this.leanFV + this.leanS + this.leanSV)) this.leanF = this.leanFV = this.leanS = this.leanSV = 0;
    }
    const strafe = sp > 0.6 ? 0.5 * this.mx * clamp((this.mz + 0.2) / 0.25, -1, 1) * (1 - 0.5 * Math.abs(this.mz)) : 0;
    this.strafeYaw = damp(this.strafeYaw, strafe, 8, dt);
    // the visual heading trails the (snappy) gameplay yaw: hips lag, the head leads (walking clips).
    // A standing 180° flip peaks at ~63° of lag and is half way round in 0.1 s (it trailed by up to
    // 76° and took ~0.27 s to settle: it read a touch slow behind the instant aim)
    const dy = wrapAngle(fin(pl.yaw) - this.visYaw);
    this.visYawV += (dy * TURN_K - this.visYawV * 2 * Math.sqrt(TURN_K)) * dt;
    this.visYaw = wrapAngle(this.visYaw + clamp(this.visYawV, -30, 30) * dt);
    if (Math.abs(wrapAngle(fin(pl.yaw) - this.visYaw)) > TURN_LAG_MAX) this.visYaw = wrapAngle(fin(pl.yaw) - Math.sign(dy) * TURN_LAG_MAX);
    this.turnLag = clamp(wrapAngle(this.visYaw - fin(pl.yaw)), -TURN_LAG_MAX, TURN_LAG_MAX);
    // the gait cycle: its length is matched to the speed, so a stance foot moves back at exactly the
    // drawn ground speed (the drawn figure is drawScale tall: the player's PLAYER_SCALE)
    gaitParams(this.gait, sp, this.sprintW);
    if (this.cycOn ? sp < 0.22 : sp > 0.4) {
      this.cycOn = !this.cycOn;
      if (this.cycOn) {
        // setting off: the rear foot (along the move direction) takes the first step
        const c0 = this.cur;
        const aR = c0[P.rF] * this.mx + c0[P.rF + 2] * this.mz, aL = c0[P.lF] * this.mx + c0[P.lF + 2] * this.mz;
        this.phase = aL < aR ? this.gait.beta : this.gait.beta + 0.5;
      }
    }
    const HS = this.drawScale;
    this.phase += (sp / HS) * dt / this.gait.len;
    if (this.phase > 1e4) this.phase -= 1e4;

    {
      const tx = (fin(pl.position?.x) - this.clipX) / HS, tz = (fin(pl.position?.z) - this.clipZ) / HS;
      this.trav.x = tx * c - tz * s;
      this.trav.z = tx * s + tz * c;
    }
    this.pathCh = null;
    {
      // which stance he stands in (stances.js): the fencer's guard while locked on or while a boss
      // fight is on (also without a lock: aiming with the mouse he never stands at ease beside a
      // boss), else at ease. The Lab can hold either (player.debug.fightStance: true / false)
      const force = pl.debug?.fightStance;
      const fight = typeof force === 'boolean' ? force : !!pl.lockOn || FIGHT_STATES.has(pl.game?.state);
      this.fightW = damp(fin(this.fightW), fight ? 1 : 0, FIGHT_EASE[fight ? 0 : 1], dt);
    }
    this._idleLife(dt, sp);
    this.target[P.sd] = 0; // (only a one-handed swing's pose hangs the free hand: attackPose, offHand.js)
    this.poses[this.key](this.target, this);
    if (this.freeHand) this._bearing(dt);
    if (this.blendT < this.blendDur) {
      this.blendT += dt;
      const u = clamp(this.blendT / this.blendDur, 0, 1);
      // attack entries (easeOut) get there early and hold the coil, but start from rest: an
      // ease-out cubic jumped the blade a third of the way (~80° round the body) in its first frame
      blend(this.cur, this.from, this.target, this.easeOut ? smoothstep(0, ENTRY_EASE, u) : u * u * (3 - 2 * u), this.fadeMem);
      if (this.pathCh) {
        // a windup path (light 1's loop, the slam's raise) already starts from the entry pose: the
        // channels it drives are final
        for (const c of this.pathCh) this.cur[c] = this.target[c];
      }
    } else {
      this.cur.set(this.target);
    }
    this._feet(dt);
    if (this.freeHand) this._sideLinger(dt);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(this.cur[i])) {
        guard(this.cur, this); // never let a bad frame poison the rig
        this.wristL.ok = false;
        this.from.set(this.cur);
        this.blendT = this.blendDur;
        for (const F of this.feet) F.init = false;
        break;
      }
    }
    gripNudge(this.cur, this.player?.guardNudge); // (CONTACT: a guard nudged onto the blow it meets)
    this.apply(this.cur);
    this._coat(dt);
    this._hair(dt);
    this._streamers(dt);
    this.rig.root.updateMatrixWorld(true);
  }

  /** The look of the attack starting now: its `anim` or one of its `variants` (combat.js), at
   *  random with the animator's own noise: never the same one twice in a row for one hit, and never
   *  a cut along the line the swing before it ran (swings.js `line`: the chain's next hit is in
   *  another plane, whatever was picked). `forceVariant` (an index, 0 = `anim`) pins it (tests, the Lab). */
  _pickVariant() {
    const def = this.player.atk?.def ?? null;
    this.atkDef = def;
    const list = def?.variants;
    const lineOf = (an) => (an?.kind === 'clip' ? SWINGS[an.clip]?.line ?? null : null);
    const prev = def && def.combo > 1 ? this.lastLine : null; // (a chain's first hit follows nothing)
    let k = 0;
    if (def && Array.isArray(list) && list.length) {
      const n = list.length + 1;
      if (Number.isInteger(this.forceVariant)) k = clamp(this.forceVariant, 0, n - 1);
      else {
        // the looks left after the two rules (the line first; if that leaves none, only the repeat)
        const P0 = SW_PICK;
        let m = 0;
        for (let pass = 0; pass < 2 && !m; pass++) {
          for (let i = 0; i < n; i++) {
            if (i === this.varLast[def.name]) continue;
            if (!pass && prev && lineOf(i ? list[i - 1] : def.anim) === prev) continue;
            P0[m++] = i;
          }
        }
        k = m ? P0[Math.min(m - 1, Math.floor(this.noise() * m))] : 0;
      }
      this.varLast[def.name] = k;
    }
    this.atkVar = k;
    this.atkAnim = def ? (k ? list[k - 1] : def.anim) : null;
    this.lastLine = lineOf(this.atkAnim);
  }

  /** Idle life (IDLE_LIFE): time the current action, start the next after a calm spell, cut it
   *  when he moves, attacks or guards. */
  _idleLife(dt, sp) {
    const F = this.fidget, pl = this.player;
    // the spell playing (idles.js SPELLS; swordMystic.js draws it from this): its name, 0..1, weight
    const SP = (this.spell ??= { kind: '', u: 0, w: 0 });
    SP.w = 0;
    // the put-away (idles.js STOW): how far the sword is gone, written below only while it plays and nothing
    // else does; every other frame the sword is whole (the swept blade is the hit test)
    this.stow = 0;
    const still = this.key === 'loco' && pl.state === 'idle' && sp < 0.1 && this.moveW < 0.05 && !(fin(pl.guardHold) > 0.001);
    const old = idlesOld();
    if (this.idlesWas !== idlesMode()) {
      // (the idles switched under an action: its index means another list now)
      if (this.idlesWas !== undefined && F.k >= 0) {
        F.k = -1;
        F.w = 0;
        F.name = '';
      }
      F.last = -1;
      F.queued = '';
      this.idlesWas = idlesMode();
    }
    // which actions may play now (F.pool): the old ones at ease; ADR-186's at ease, or in the fight
    // (also locked on: the small habits of the guard), never while the stance is changing
    const pool = old ? (still && !pl.lockOn && !(this.fightW > 0.05) ? 0 : -1) : still && this.fightW > 0.95 ? (holdHabits() || !idlesRef() ? 2 : -1) : still && !pl.lockOn && this.fightW < 0.05 ? 1 : -1;
    const calm = pool >= 0;
    // the chiburi after the chain (bearing.js FLICK): armed by the chain's last hit, it starts once he stands
    // still after it (within FLICK.within s), in either stance, not while the stance changes; anything else
    // he does first disarms it
    const steady = still && (this.fightW > 0.95 || this.fightW < 0.05);
    // (the chain's fifth when it is a light finisher, the game's combo A: combos.js; not the slam, a leap whose
    // landing the flick's raise would follow, nor a heavy branch)
    const d5 = pl.atk?.def;
    if ((pl.state === 'attack' || pl.state === 'heavy') && d5?.combo === 5 && d5.kind === 'light') {
      this.flickArm = flickOn();
      this.flickT = 0;
    } else if (this.flickArm) {
      this.flickT = fin(this.flickT) + dt;
      if (pl.state !== 'idle' || this.flickT > FLICK.within + 1) this.flickArm = false;
    }
    if (!old) {
      if (!this.rests) this.rests = newRests();
      // a rest changes only standing still with no action running (idles.js)
      tickRests(this, dt, pool, F.k < 0);
    }
    if (this.key !== 'loco' && F.k >= 0) {
      // another clip took over (its cross-fade starts from this pose). Out of one of ADR-186's actions
      // that swings the blade (at ease: never in a fight), a block, a drink or a charge brings the blade
      // home over IDLES.cutFade s at least: from a blade behind his back their own fade whipped the point
      // up to 1.4 m a frame
      if ((F.pool === 1 || F.pool === 3) && actList(F.pool)[F.k]?.blade && CUT_SLOW.has(this.key) && this.blendT < this.blendDur) this.blendDur = Math.max(this.blendDur, IDLES.cutFade);
      F.k = -1;
      F.w = 0;
    } else if (!old && this.key !== this.idleKey && this.idleKey === 'loco' && CUT_SLOW.has(this.key) && this.fightW < 0.05 && trailing(this) && this.blendT < this.blendDur) {
      // … and out of the trailing rest (its blade 170° round from a block's: in the block's 0.08 s the
      // point swept 1 m a frame). At ease only: in a fight he never trails the blade
      this.blendDur = Math.max(this.blendDur, IDLES.cutFade);
    } else if (this.key !== this.idleKey && this.idleKey === 'loco' && CUT_SLOW.has(this.key) && this.fightW < 0.05 && this.swordW > 0.3 && this.moveW > 0.3 && (this.from[P.swD + 2] < -0.35 || this.from[P.swD + 1] < -0.15) && this.blendT < this.blendDur) {
      // … and out of the run with the blade trailing behind him or hanging low (runSword.js's carries, ADR-229,
      // and `old`): in the block's 0.08 s the blade turned 75° in a frame, the point 1.2 m a frame² (pointing
      // down and ahead, `g2`: 47 cm). Only out of the run (the sword's carry showing) and at ease, as the
      // trailing rest's: the stand holds the blade low too (its block entries are the idle actions', HEROIDLES),
      // and in a fight he runs in his guard (a longer block entry there sent the seeded wyrm fight another way)
      this.blendDur = Math.max(this.blendDur, IDLES.cutFade);
    }
    this.idleKey = this.key;
    if (F.k >= 0) {
      const D = actList(F.pool)[F.k];
      F.t += dt;
      const env = smoothstep(0, IDLE_LIFE.fadeIn, F.t) * (1 - smoothstep(D.dur - IDLE_LIFE.fadeOut, D.dur, F.t));
      if (F.pool === 3 ? !steady : !calm || pool !== F.pool) F.cut = true;
      // (one that swings the blade lets go a little slower: cut in 0.16 s, a trick's blade swept 0.5 m a frame)
      F.w = F.cut ? Math.max(0, Math.min(env, F.w - dt / (D.blade ? IDLES.cancelBlade : IDLE_LIFE.cancel))) : env;
      if (D.spell) {
        SP.kind = D.name;
        SP.u = clamp(F.t / D.dur, 0, 1);
        SP.w = F.w;
      }
      // (cut, it is whole at once: he moves, guards or strikes with the sword in his hand)
      if (D.stow && !F.cut && this.key === 'loco') this.stow = stowHidden(clamp(F.t / D.dur, 0, 1));
      if (F.t >= D.dur || (F.cut && F.w <= 0)) {
        F.k = -1;
        F.w = 0;
        F.name = '';
        F.still = 0;
        const gap = F.pool === 1 ? IDLES.gapEase : F.pool === 2 || F.pool === 3 ? IDLES.gapFight : IDLE_LIFE.gap;
        F.wait = lerp(gap[0], gap[1], F.pool ? this.idleNoise() : this.noise());
      }
      return;
    }
    if (this.flickArm && steady && !old) {
      if (this.flickT <= FLICK.within) {
        this.flickArm = false;
        Object.assign(F, { k: 0, pool: 3, t: 0, w: 0, cut: false, name: COMBO_FLICK.name, queued: '' });
        F.count++;
        actStart();
        return;
      }
      this.flickArm = false;
    }
    if (!calm) {
      F.still = 0;
      F.wait = Math.max(F.wait, old ? IDLE_LIFE.after : this.fightW > 0.5 ? IDLES.afterFight : IDLES.afterEase);
      return;
    }
    if (pool !== F.lastPool) {
      // (into the other stance: its own first wait, and no "last action" from the other list)
      F.lastPool = pool;
      F.last = -1;
      F.still = 0;
      F.wait = pool === 0 ? IDLE_LIFE.after : pool === 2 ? IDLES.afterFight : IDLES.afterEase;
    }
    F.still += dt;
    if (F.still < F.wait) return;
    const list = actList(pool);
    let k;
    if (pool === 1 && F.queued) {
      // (the Lab's pick of one that swings the blade: it waits for the low rest it starts from)
      k = list.findIndex((D) => D.name === F.queued);
      if (k >= 0 && list[k].blade && !lowRest(this)) return;
      F.queued = '';
      if (k < 0) return;
    } else if (pool === 1) {
      F.sinceTrick ??= 0;
      F.trickDue ??= IDLES.trickEvery[0];
      k = pickEase(F, list, this);
      if (k < 0) {
        // (a trick due in a high rest: the rest goes low first, then it plays)
        F.wait = F.still + IDLES.restMove + 0.25;
        return;
      }
    } else {
      const nz = pool ? this.idleNoise : this.noise;
      k = Math.min(list.length - 1, Math.floor(nz() * list.length));
      if (k === F.last) k = (k + 1 + Math.floor(nz() * (list.length - 1))) % list.length;
    }
    F.k = F.last = k;
    F.pool = pool;
    F.t = 0;
    F.w = 0;
    F.cut = false;
    F.count++;
    F.name = list[k].name;
    actStart();
  }

  /** THE BEARING (bearing.js, ADR-292): the chest carried up and the chin lifted, standing and between the hits
   *  of a chain (from the end of a swing's active frames). On the target pose; its weight eased in and out. */
  _bearing(dt) {
    const pl = this.player, t = this.target;
    let w = 0, ch = 0, hd = 0;
    if (bearingOn()) {
      if (this.key === 'loco') {
        const f = clamp(fin(this.fightW), 0, 1), still = 1 - clamp(fin(this.moveW), 0, 1);
        // (an idle action poses the chest and the head itself: the bearing gives way to it, the flick included)
        const F = this.fidget, act = F && F.k >= 0 ? clamp(fin(F.w), 0, 1) : 0;
        w = still * (1 - act);
        ch = lerp(BEARING.chest.ease, BEARING.chest.fight, f);
        hd = lerp(BEARING.head.ease, BEARING.head.fight, f);
      } else if (this.key === 'attack' && pl?.atk?.def) {
        const d = pl.atk.def, a = fin(d.windup) + fin(d.active);
        w = smoothstep(a, a + BEARING.ease[0], fin(pl.atk.t));
        ch = BEARING.chest.swing;
        hd = BEARING.head.swing;
      }
    }
    // (the weight follows: in over BEARING.ease[0] s, out over [1]; the amounts with it)
    const B = (this.bear ??= { w: 0, ch: 0, hd: 0 });
    const k = 1 - Math.exp(-dt / Math.max(1e-3, w > B.w ? BEARING.ease[0] / 3 : BEARING.ease[1] / 3));
    B.w += (w - B.w) * k;
    if (w > 0) {
      B.ch += (ch - B.ch) * k;
      B.hd += (hd - B.hd) * k;
    }
    if (!Number.isFinite(B.w + B.ch + B.hd)) B.w = B.ch = B.hd = 0;
    if (B.w < 1e-4) return;
    t[P.spX] -= B.ch * B.w;
    t[P.hdX] -= B.hd * B.w;
  }

  /** ADR-186's idles draw on a stream of their own: on the animator's (`noise`, which also picks an attack's
   *  look, and an attack's swept blade is its hit test) an idle action in a fight shifted the looks of the
   *  blows after it and with them a seeded duel's outcome. `?idles=old` keeps drawing on `noise`, as before. */
  idleNoise = () => {
    this._ins = (Math.imul(this._ins ?? 0x2545f491, 1664525) + 1013904223) >>> 0;
    return this._ins / 4294967296;
  };

  /** Lab / tests (ADR-186): play the idle action `name` now (from the list of the stance he stands in:
   *  at ease or the fight; ignored with `?idles=old` for a new one's name, and while he is not standing
   *  still). Returns whether it started. */
  playIdle(name) {
    const F = this.fidget, pool = idlesOld() ? 0 : this.fightW > 0.5 ? 2 : 1;
    const list = actList(pool), k = list.findIndex((D) => D.name === name);
    if (k < 0 || this.key !== 'loco') return false;
    if (pool === 1 && list[k].blade && !lowRest(this)) {
      // (from the carry or the trail: to a low rest first, then it plays)
      toLowRest(this);
      Object.assign(F, { k: -1, w: 0, queued: name, still: 0, wait: IDLES.restMove + 0.25, lastPool: pool });
      return true;
    }
    Object.assign(F, { k, last: k, pool, lastPool: pool, t: 0, w: 0, cut: false, name, queued: '' });
    F.count++;
    actStart();
    return true;
  }
  /** Lab / tests (ADR-186): move to the rest `name` (idles.js EASE_RESTS / FIGHT_RESTS, by the stance
   *  he stands in) now, over the rest's change (`atOnce`: no change), and stay in it `hold` s (then the
   *  rests change as before). Returns whether it is one. */
  setRest(name, atOnce = false, hold = IDLES.restHold[1]) {
    if (!this.rests) this.rests = newRests();
    const fight = this.fightW > 0.5, S = fight ? this.rests.fight : this.rests.ease;
    const k = (fight ? fightRests() : easeRests()).findIndex((R) => R.name === name);
    if (k < 0) return false;
    if (atOnce) Object.assign(S, { a: k, b: k, u: 1 });
    else Object.assign(S, { b: k, u: S.a === k ? 1 : 0 });
    S.mem.ok = false;
    S.hold = hold;
    return true;
  }
  /** Lab / tests: the names of the idle actions and rests of a stance (fight: the guard's). */
  idleNames(fight = false) {
    const list = idlesOld() ? FIDGETS : actList(fight ? 2 : 1);
    return { acts: list.map((D) => D.name), tricks: list.filter((D) => D.trick).map((D) => D.name), rests: idlesOld() ? [] : (fight ? fightRests() : easeRests()).map((R) => R.name) };
  }

  /** The root travel recorded the first frame this clip reached time t0 (slot 0/1); before that,
   *  the current travel (so "travel since the mark" is 0 until then). */
  mark(slot, t0) {
    const M = this.marks[slot];
    if (!M.set) {
      M.x = this.trav.x;
      M.z = this.trav.z;
      if (this.t >= t0) M.set = true;
    }
    return M;
  }

  /**
   * Foot planner (walking clips: loco, block, charge, heal). A planted foot stays put in the WORLD
   * (drawn position, drawScale) while the root moves and turns under it, so nothing skates on run
   * starts and stops, speed changes, curves or turns in place. The gait cycle lifts a foot off at
   * the end of its stance (its swing then blends from where it really was onto the cycle's path)
   * and plants it at touchdown. Standing, a foot whose spot has drifted from the stance pose (a turn
   * in place, a shove, the end of a run or an attack) re-plants with a short step, one foot at a
   * time. Other clips (attacks, roll, falls) pose the feet themselves; the planner re-plants from
   * wherever they are when a walking clip resumes. Writes the foot targets of `cur`.
   */
  _feet(dt) {
    const pl = this.player, cur = this.cur;
    this.wantOK = false;
    if (!WALK_KEYS.has(this.key) || !pl.position) {
      // a clip that asks for it (a duelist's move: `steps`) keeps its feet on the ground too
      if (pl.position && pl.atk?.def?.steps) this._feetClip(dt);
      else for (const F of this.feet) F.init = false;
      return;
    }
    this.wantOK = true;
    const yaw = fin(pl.yaw), px = fin(pl.position.x), pz = fin(pl.position.z);
    const c = Math.cos(yaw), s = Math.sin(yaw), HS = this.drawScale;
    const G = this.gait, cyc = this.cycOn;
    if (this.stepCool > 0) this.stepCool -= dt;
    // knocked back (a blocked blow, a shove): the feet skid with the body instead of stepping
    const kb = pl.kb ? Math.hypot(fin(pl.kb.x), fin(pl.kb.z)) : 0;
    const skid = kb > 0.8;
    // where the clip wants each foot (read before either is overwritten)
    const W = FEET_WANT;
    for (let fi = 0; fi < 2; fi++) {
      const i = fi ? P.lF : P.rF, iy = fi ? P.lFy : P.rFy, o = fi * 4;
      W[o] = cur[i];
      W[o + 1] = cur[i + 1];
      W[o + 2] = cur[i + 2];
      W[o + 3] = cur[iy];
    }
    const Tcyc = (G.len * HS) / Math.max(0.3, this.speed); // s per cycle
    for (let fi = 0; fi < 2; fi++) {
      const F = this.feet[fi], O = this.feet[1 - fi];
      const i = fi ? P.lF : P.rF, iy = fi ? P.lFy : P.rFy, o = fi * 4;
      const dx = W[o], dy = W[o + 1], dz = W[o + 2], dyaw = W[o + 3];
      let u = fi ? this.phase : this.phase + 0.5;
      u -= Math.floor(u);
      const inStance = u < G.beta;
      if (!F.init) {
        F.init = true;
        F.prevU = u;
        F.hold = false;
        if (dy < ANK + 0.04) this._plant(F, dx, dz, dyaw, px, pz, c, s, yaw);
        else this._lift(F, 1, dx, dy, dz, dyaw, 0.18);
      }
      if (skid && F.lock) this._plant(F, dx, dz, dyaw, px, pz, c, s, yaw); // slides with the root
      // the planted spot in model space
      let mx = 0, mz = 0;
      if (F.lock) {
        const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
        mx = wx * c - wz * s;
        mz = wx * s + wz * c;
      }
      if (inStance) F.hold = false;
      if (cyc) {
        if (F.lock) {
          if (!inStance && F.prevU < G.beta) {
            // lift-off: the swing starts from the real spot and blends onto the cycle's path
            F.lock = false;
            F.mode = 0;
            F.cx = mx - dx;
            F.cz = mz - dz;
            F.cyaw = wrapAngle(F.wyaw - yaw - dyaw);
          } else if (!inStance && !F.hold) {
            // planted through its swing (the cycle just started): step to the cycle's path in the
            // time left in the swing
            this._lift(F, 1, mx, ANK, mz, wrapAngle(F.wyaw - yaw), clamp((1 - u) * Tcyc, 0.12, 0.3));
            F.hold = true;
          } else if (Math.hypot(mx - dx, mz - dz) > 0.45) {
            this._lift(F, 1, mx, ANK, mz, wrapAngle(F.wyaw - yaw), 0.15); // left behind by a turn: step
            F.hold = true;
          }
        } else if (F.mode === 0 && inStance && F.prevU >= G.beta) {
          this._plant(F, dx, dz, dyaw, px, pz, c, s, yaw); // touchdown
          if (this.speed > 0.8 && this.onFootstep) this.onFootstep(fi ? 1 : -1);
        }
      } else {
        if (!F.lock && F.mode === 0) this._lift(F, 1, F.ox, F.oy, F.oz, F.oyaw, 0.2); // stopping: the swing lands on the stance spot
        if (F.lock && O.lock && this.stepCool <= 0 && !skid) {
          const drift = Math.hypot(mx - dx, mz - dz) + 0.22 * Math.abs(wrapAngle(F.wyaw - yaw - dyaw));
          const oo = (1 - fi) * 4;
          const owx = (O.wx - px) / HS, owz = (O.wz - pz) / HS;
          const od = Math.hypot(owx * c - owz * s - W[oo], owx * s + owz * c - W[oo + 2]) + 0.22 * Math.abs(wrapAngle(O.wyaw - yaw - W[oo + 3]));
          if (drift > 0.1 && drift >= od) this._lift(F, 1, mx, ANK, mz, wrapAngle(F.wyaw - yaw), lerp(0.24, 0.17, clamp((drift - 0.1) / 0.3, 0, 1)));
        }
      }
      F.prevU = u;
      // write the foot
      if (F.lock) {
        const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
        cur[i] = wx * c - wz * s;
        cur[i + 1] = cyc && inStance ? Math.min(dy, ANK + G.peel) : ANK;
        cur[i + 2] = wx * s + wz * c;
        cur[iy] = wrapAngle(F.wyaw - yaw);
      } else if (F.mode === 0) {
        const sw = clamp((u - G.beta) / Math.max(0.05, 1 - G.beta), 0, 1);
        const k = 1 - smoothstep(0, 0.65, sw);
        cur[i] = dx + F.cx * k;
        cur[i + 2] = dz + F.cz * k;
        cur[iy] = dyaw + F.cyaw * k;
      } else {
        // a step: lift, carry, set down on the spot the clip wants (the stance or the cycle's)
        F.s = Math.min(1, F.s + dt / F.dur);
        const e = smoothstep(0, 1, F.s);
        cur[i] = lerp(F.lx, dx, e);
        cur[i + 1] = lerp(F.ly, Math.max(ANK, Math.min(dy, ANK + 0.02)), e) + Math.sin(Math.PI * F.s) * (0.05 + 0.25 * F.lift);
        cur[i + 2] = lerp(F.lz, dz, e);
        cur[iy] = F.lyaw + wrapAngle(dyaw - F.lyaw) * e;
        if (F.s >= 1) {
          this._plant(F, cur[i], cur[i + 2], cur[iy], px, pz, c, s, yaw);
          this.stepCool = 0.06;
        }
      }
      F.ox = cur[i];
      F.oy = cur[i + 1];
      F.oz = cur[i + 2];
      F.oyaw = cur[iy];
    }
  }

  /**
   * The feet of a clip that poses them itself but is carried by root motion (a duelist's move,
   * `def.steps`: he closes in through a windup, a string walks him forward). The clip's foot targets
   * are where each foot WANTS to be under the body; a foot on the ground stays on its spot in the
   * world and, left behind by more than CLIP_STEP.at, takes a quick step there, one foot at a time
   * (a foot left further than `drag` is pulled along: the leg has an end). A foot the clip lifts (a
   * kick, a leap, a hop), a body off the ground or carried faster than `free` m/s (a dash) is the
   * clip's alone, and is planted again where it comes down. Shares the walking planner's state, so
   * a move starts from the feet he stood on and the walk resumes from where the move left them.
   */
  _feetClip(dt) {
    const pl = this.player, cur = this.cur, S = CLIP_STEP;
    const yaw = fin(pl.yaw), px = fin(pl.position.x), pz = fin(pl.position.z);
    const c = Math.cos(yaw), s = Math.sin(yaw), HS = this.drawScale;
    const sp = pl.groundVel ? Math.hypot(fin(pl.groundVel.x), fin(pl.groundVel.z)) : 0;
    const off = fin(pl.position.y) > 0.03 || sp > S.free;
    if (this.stepCool > 0) this.stepCool -= dt;
    const W = FEET_WANT;
    for (let fi = 0; fi < 2; fi++) {
      const i = fi ? P.lF : P.rF, iy = fi ? P.lFy : P.rFy, o = fi * 4;
      W[o] = cur[i];
      W[o + 1] = cur[i + 1];
      W[o + 2] = cur[i + 2];
      W[o + 3] = cur[iy];
    }
    // how far each planted foot is from where the clip wants it (model space)
    const drift = (F, o) => {
      if (!F.lock) return 0;
      const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
      return Math.hypot(wx * c - wz * s - W[o], wx * s + wz * c - W[o + 2]) + 0.22 * Math.abs(wrapAngle(F.wyaw - yaw - W[o + 3]));
    };
    for (let fi = 0; fi < 2; fi++) {
      const F = this.feet[fi], O = this.feet[1 - fi];
      const i = fi ? P.lF : P.rF, iy = fi ? P.lFy : P.rFy, o = fi * 4;
      const dx = W[o], dy = W[o + 1], dz = W[o + 2], dyaw = W[o + 3];
      const air = off || dy > ANK + S.air;
      if (!F.init) {
        F.init = true;
        F.hold = false;
        F.lock = false;
        F.mode = 2;
      }
      const ease = this.liftEase ? fin(this.liftEase()) : 0;
      if (air) {
        // the clip's own: a kick, a leap, a dash (a boss's: eased off the spot it stood on, ADR-223)
        if (F.lock && ease > 0 && !off) {
          const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
          F.rx = wx * c - wz * s;
          F.rz = wx * s + wz * c;
          F.ryaw = wrapAngle(F.wyaw - yaw);
          F.ry = ANK;
          F.mode = 3;
          F.s = 0;
          F.dur = ease;
        } else if (this.liftFromStep && F.mode === 1 && ease > 0 && !off) {
          // (mid-step: from where it was drawn last frame, its height too; model space, as the step's)
          F.rx = fin(F.ox, dx);
          F.rz = fin(F.oz, dz);
          F.ryaw = fin(F.oyaw, dyaw);
          F.ry = Math.max(ANK, fin(F.oy, ANK));
          F.mode = 3;
          F.s = 0;
          F.dur = ease;
        } else if (F.mode !== 3 || off) F.mode = 2;
        F.lock = false;
      } else if (!F.lock && F.mode === 3) {
        // it comes down while still easing: planted where it is drawn
        const e = smoothstep(0, 1, Math.min(1, F.s + dt / F.dur));
        this._plant(F, lerp(F.rx, dx, e), lerp(F.rz, dz, e), F.ryaw + wrapAngle(dyaw - F.ryaw) * e, px, pz, c, s, yaw);
      } else if (!F.lock && F.mode !== 1) {
        this._plant(F, dx, dz, dyaw, px, pz, c, s, yaw); // it comes down: planted where it is
      } else if (F.lock) {
        let d = drift(F, o);
        if (d > S.drag) {
          // the leg has an end: the spot is pulled along behind the body
          const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
          const mx = wx * c - wz * s, mz = wx * s + wz * c, k = 1 - S.drag / d;
          this._plant(F, mx + (dx - mx) * k, mz + (dz - mz) * k, wrapAngle(F.wyaw - yaw) + wrapAngle(dyaw - wrapAngle(F.wyaw - yaw)) * k, px, pz, c, s, yaw);
          d = S.drag;
        }
        if (d > S.at && O.lock && this.stepCool <= 0 && d >= drift(O, (1 - fi) * 4)) {
          const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
          this._lift(F, 1, wx * c - wz * s, ANK, wx * s + wz * c, wrapAngle(F.wyaw - yaw), clamp(S.dur[0] + S.dur[1] * d, S.dur[0], S.dur[2]));
          F.lift = clamp(d / S.drag, 0.2, 1);
        }
      }
      // write the foot
      if (F.lock) {
        const wx = (F.wx - px) / HS, wz = (F.wz - pz) / HS;
        cur[i] = wx * c - wz * s;
        cur[i + 1] = ANK;
        cur[i + 2] = wx * s + wz * c;
        cur[iy] = wrapAngle(F.wyaw - yaw);
      } else if (F.mode === 3) {
        // released by the clip: from the spot it stood on to the clip's key (the key moves on meanwhile)
        F.s = Math.min(1, F.s + dt / F.dur);
        const e = smoothstep(0, 1, F.s);
        cur[i] = lerp(F.rx, dx, e);
        cur[i + 1] = lerp(fin(F.ry, ANK), dy, e);
        cur[i + 2] = lerp(F.rz, dz, e);
        cur[iy] = F.ryaw + wrapAngle(dyaw - F.ryaw) * e;
        if (F.s >= 1) F.mode = 2;
      } else if (F.mode === 1) {
        F.s = Math.min(1, F.s + dt / F.dur);
        const e = smoothstep(0, 1, F.s);
        cur[i] = lerp(F.lx, dx, e);
        cur[i + 1] = lerp(F.ly, Math.max(ANK, dy), e) + Math.sin(Math.PI * F.s) * (S.lift[0] + S.lift[1] * F.lift);
        cur[i + 2] = lerp(F.lz, dz, e);
        cur[iy] = F.lyaw + wrapAngle(dyaw - F.lyaw) * e;
        if (F.s >= 1) {
          this._plant(F, cur[i], cur[i + 2], cur[iy], px, pz, c, s, yaw);
          this.stepCool = S.cool;
        }
      }
      F.prevU = 0;
      F.ox = cur[i];
      F.oy = cur[i + 1];
      F.oz = cur[i + 2];
      F.oyaw = cur[iy];
    }
  }

  /** Plant foot F at model-space (x, z) with model yaw `fy`: store its drawn world spot. */
  _plant(F, x, z, fy, px, pz, c, s, yaw) {
    F.lock = true;
    const HS = this.drawScale;
    F.wx = px + HS * (x * c + z * s);
    F.wz = pz + HS * (-x * s + z * c);
    F.wyaw = yaw + fin(fy);
    F.s = 1;
  }

  /** Start a step (mode 1) for foot F from model-space (x, y, z) / yaw over `dur` seconds. */
  _lift(F, mode, x, y, z, fy, dur) {
    F.lock = false;
    F.mode = mode;
    F.s = 0;
    F.dur = Math.max(0.08, dur);
    F.lx = x;
    F.ly = y;
    F.lz = z;
    F.lyaw = fin(fy);
    F.lift = 0;
  }

  apply(p) {
    const r = this.rig;
    r.body.position.set(p[P.bodyX], DIM.pivot + p[P.bodyY], p[P.bodyZ]);
    r.body.rotation.set(p[P.pitch], p[P.yaw], p[P.roll]);
    r.pelvis.rotation.set(p[P.pelvX], p[P.pelvY], p[P.pelvZ]);
    r.spine.rotation.set(p[P.spX], p[P.spY], p[P.spZ]);
    r.head.rotation.set(p[P.hdX], p[P.hdY], p[P.hdZ]);
    r.root.updateMatrixWorld(true);
    // ground clamp: lift the whole body if a head/torso proxy sphere dips below the ground
    // (keeps the roll's tucked ball, falls and the corpse on top of the grass)
    let low = Infinity;
    for (const pr of this.proxies) {
      _w.set(pr.x, pr.y, pr.z);
      pr.joint.localToWorld(_w);
      if (_w.y - pr.r < low) low = _w.y - pr.r;
    }
    if (low < 0 && Number.isFinite(low)) {
      r.body.position.y -= low;
      r.root.updateMatrixWorld(true);
    }
    r.root.getWorldQuaternion(_qRoot);
    r.body.getWorldQuaternion(_qBody);
    r.chest.getWorldQuaternion(_qChest);
    r.pelvis.getWorldQuaternion(_qPelvis);
    _qBC.copy(_qChest).invert().multiply(_qBody); // body axes → chest local
    _qBP.copy(_qPelvis).invert().multiply(_qBody); // body axes → pelvis local

    this._arm(r.arms.R, this._handTarget(r.arms.R, p, P.rH), p, P.rP, true);
    if (this.gripMax > 0) this._gripAlign(r.arms.R, p);
    // off hand: its own target, or (twoHand) down the grip below the sword hand
    this._handTarget(r.arms.L, p, P.lH);
    if (this.freeHand) this._sideHand(r, p); // (offHand.js: a one-handed swing's free hand on its pendulum)
    let lk = 0;
    if (this.freeHand) {
      // the sword fingers on the sword wrist (lk): the right wrist (chest local) from the solved sword
      // arm, the palm resting on its near side; as the sword hand whips away they let go
      const R = r.arms.R, S = this.lkState;
      _hG.set(0, -(DIM.foreArm - LK_WRIST), 0).applyQuaternion(R.fore.quaternion);
      _hG.y -= DIM.upperArm;
      _hG.applyQuaternion(R.upper.quaternion).add(R.upper.position);
      _hp.subVectors(r.arms.L.upper.position, _hG);
      const pl = _hp.length();
      if (pl > 1e-4) _hG.addScaledVector(_hp, LK_OFF[0] / pl);
      _hG.y += LK_OFF[1];
      const dt = this.frameDt;
      if (!S.ok) S.k = 1;
      else if (dt > 0.003) S.k = 1 - smoothstep(LK_LETGO[0], LK_LETGO[1], _hG.distanceTo(S.prev) / dt);
      if (!Number.isFinite(S.k)) S.k = 1;
      S.prev.copy(_hG);
      S.ok = Number.isFinite(_hG.x + _hG.y + _hG.z);
      lk = clamp(fin(p[P.lk]), 0, 1) * S.k;
      if (lk > 0.001 && S.ok) _T.lerp(_hG, lk);
      else lk = 0;
    }
    this.lkEff = lk;
    const two = clamp(p[P.twoHand], 0, 1);
    if (two > 0.001) {
      _TL.copy(_T);
      _bz.set(p[P.swD], p[P.swD + 1], p[P.swD + 2]);
      if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
      _bz.normalize();
      _G.copy(r.sword.position).addScaledVector(_bz, fin(p[P.offAt]) - TWO_HAND_GRIP); // body space
      r.body.localToWorld(_G);
      r.chest.worldToLocal(_G);
      _T.copy(_TL).lerp(_G, two);
    }
    this._arm(r.arms.L, _T, p, P.lP, false, two);
    // (before _wristLimit, which reuses _G) how far the free hand is from its place on the grip
    // (chest local, model metres: the measure of the tests' offGap)
    this.gripGap = two > 0.001 ? _end.distanceTo(_G) : 1;
    if (this.freeHand) this._wristL(r, p, two, lk);
    // the pauldron rides on the shoulder, following part of the sword arm's swing
    r.pauldron.quaternion.slerpQuaternions(_qId, r.arms.R.upper.quaternion, PAULDRON_FOLLOW);
    this._leg(r.legs.R, p, P.rF, P.rK, P.rFy, P.rFf);
    this._leg(r.legs.L, p, P.lF, P.lK, P.lFy, P.lFf);

    // sword: blade along +Z = swD, flat normal (+Y) = swF, both in body axes
    _bz.set(p[P.swD], p[P.swD + 1], p[P.swD + 2]);
    if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
    _bz.normalize();
    // outside the attacks (whose swept blade is the hit test), the steel never passes through his
    // own legs: the ready stance carries it across the front of the left leg with ~10 cm to spare,
    // so a hip twist in a turn, a foot landing forward or a fall swings it clear instead. The
    // ground wins last (raising the point can swing it back toward a shin: two rounds).
    if (this.key !== 'attack') {
      this._bladeClear(r, true);
      this._tipFloor(r);
      this._bladeClear(r, false);
    }
    this._wristLimit(r);
    this._tipFloor(r);
    _by.set(p[P.swF], p[P.swF + 1], p[P.swF + 2]);
    _by.addScaledVector(_bz, -_by.dot(_bz));
    if (_by.lengthSq() < 1e-6) {
      _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
      if (_by.lengthSq() < 1e-6) _by.set(1, 0, 0).addScaledVector(_bz, -_bz.x);
    }
    _by.normalize();
    _bx.crossVectors(_by, _bz);
    _m4.makeBasis(_bx, _by, _bz);
    r.sword.quaternion.setFromRotationMatrix(_m4);

    if (r.offHand?.open && r.offHand.grip) {
      if (this.freeHand) {
        // the free hand closes round the grip once it is there (within OFF_SNAP of its place, with
        // hysteresis, wider while fully two-handed), never while it is still on its way; off the grip
        // it shows the sword fingers or the open hand by the pose's shape (hs, with hysteresis)
        const H = this.handFX, fg = r.offHand.fingers ?? null, hs = fin(p[P.hs]);
        const snap = !H.fist ? OFF_SNAP[0] : two >= 0.95 ? OFF_SNAP[2] : OFF_SNAP[1];
        H.fist = two > 0.6 && this.gripGap < snap && !(p[P.offAt] > 0.04); // (a palm braced on the blade stays open)
        H.fingers = hs > 0.6 || (H.fingers && hs > 0.4);
        r.offHand.grip.visible = H.fist;
        r.offHand.open.visible = !H.fist && !(H.fingers && fg);
        if (fg) fg.visible = !H.fist && H.fingers;
      } else {
        // the free hand closes round the grip as it gets there
        const on = two > 0.6 && !(p[P.offAt] > 0.04); // (a palm braced on the blade stays open)
        r.offHand.open.visible = !on;
        r.offHand.grip.visible = on;
      }
    }
    const f = clamp(p[P.flask], 0, 1);
    r.flask.visible = f > 0.03;
    r.flask.scale.setScalar(Math.max(0.01, f));
    if (this.freeHand) this._stowSword(this.stow);
  }

  /** The put-away (idles.js STOW, ADR-207; the hero only): the weapon's own meshes (rig.slots.weapon: the
   *  blade, the hilt; never the fists on the grip, which are the arms') draw into the hilt as k goes 0 → 1, the
   *  steel first, and hide at 1; at 0 they are exactly as built. Nothing is added to the rig (a new object
   *  draws a uuid off the seeded Math.random). The hit test is the swept joint, never these meshes. */
  _stowSword(k) {
    const W = this.rig.slots?.weapon;
    k = clamp(fin(k), 0, 1);
    if (!W || !W.length || (k <= 0.001 && this._stowK <= 0.001)) return;
    // (the scales as built, kept the first time it is used)
    if (!this._stowScale) {
      this._stowScale = W.map((o) => o.scale.clone());
      this._stowVis = W.map((o) => o.visible);
    }
    const zk = Math.max(1e-3, 1 - k), xk = Math.max(1e-3, 1 - smoothstep(0.55, 1, k));
    for (let i = 0; i < W.length; i++) {
      const o = W[i], s0 = this._stowScale[i];
      if (!o || !s0) continue;
      if (k <= 0.001) {
        o.scale.copy(s0);
        o.visible = this._stowVis[i];
      } else {
        o.scale.set(s0.x * xk, s0.y * xk, s0.z * zk);
        o.visible = this._stowVis[i] && k < 0.995;
      }
    }
    this._stowK = k <= 0.001 ? 0 : k;
  }

  /** The sword wrist's limit (ADR-078): the blade (_bz, body space) never folds back along the
   *  forearm further than WRIST_BACK from the forearm's own line. A pose or a cross-fade that asks
   *  for more (the charge coming up from a low coil: the blade pointed straight back over the elbow
   *  for three frames, 170°) gets the blade at the limit, on the same side. */
  _wristLimit(r) {
    const A = r.arms.R;
    // the forearm's line, elbow → wrist, in body space (the arm hangs along -Y; chest → body)
    _v.set(0, -1, 0).applyQuaternion(_q1.copy(A.upper.quaternion).multiply(A.fore.quaternion)).applyQuaternion(_q2.copy(_qBC).invert());
    const c = clamp(_v.dot(_bz), -1, 1);
    if (c >= WRIST_COS) return;
    // the part of the blade's direction square to the forearm
    _w.copy(_bz).addScaledVector(_v, -c);
    if (_w.lengthSq() < 1e-6) _w.set(0, 1, 0).addScaledVector(_v, -_v.y);
    if (_w.lengthSq() < 1e-6) return;
    _w.normalize();
    // … and at the limit it stays clear of his own upper arm: folded back that far the steel lies
    // near the elbow, so round the forearm's line it keeps WRIST_CLEAR from the side the upper arm
    // is on (it turns away on the side it is already on)
    _G.set(0, 1, 0).applyQuaternion(A.upper.quaternion).applyQuaternion(_q2); // elbow → shoulder, body space
    _G.addScaledVector(_v, -_G.dot(_v));
    if (_G.lengthSq() > 1e-6) {
      _G.normalize();
      const cu = clamp(_w.dot(_G), -1, 1);
      if (cu > WRIST_CLEAR_COS) {
        _TL.crossVectors(_v, _G); // square to both: the way round the forearm
        const side = _w.dot(_TL) < 0 ? -1 : 1;
        _w.copy(_G).multiplyScalar(WRIST_CLEAR_COS).addScaledVector(_TL, side * Math.sqrt(1 - WRIST_CLEAR_COS * WRIST_CLEAR_COS)).normalize();
      }
    }
    _bz.copy(_v).multiplyScalar(WRIST_COS).addScaledVector(_w, WRIST_SIN).normalize();
  }

  /** After a one-handed swing (offHand.js) the free hand stays at its rest its look's `linger` s more while he
   *  stands or moves (loco: a press then starts a new chain with no way in, no drop), then lets go of it
   *  over `ease` s (p[sd] and its shape eased back to the pose's own); anything else takes it at once
   *  (`easeBack`: a heavy's grip, a guard, a roll, a hit taken). On this.cur, after the cross-fade. */
  _sideLinger(dt) {
    const S = this.sideH, c = this.cur;
    if (this.key === 'attack' && this.target[P.sd] > 0.5) {
      S.lg = S.L?.linger ?? 0.35;
      S.hold = 1;
      S.quick = false;
      return;
    }
    if (this.key !== 'loco') {
      S.lg = S.hold = 0;
      S.quick = true;
      return;
    }
    S.quick = false;
    if (!S.L) return;
    if (S.lg > 0) S.lg = Math.max(0, S.lg - Math.max(0, fin(dt)));
    else if (S.hold > 0) S.hold = Math.max(0, S.hold - Math.max(0, fin(dt)) / S.L.ease);
    if (!(S.hold > 0)) return;
    const x = S.hold, w = x * x * x * (x * (6 * x - 15) + 10);
    sideHand(c, 1 - w, c, S.L);
  }

  /** The side hand (the hero only; attackPose sideHand sets p[sd]; SIDE below is the look, offHand.js): the free wrist's target (_T,
   *  chest local) hangs at his side. Its rest (the anchor) is SIDE.hang under the left shoulder,
   *  turned with the chest, drawn SIDE.hip of the way to SIDE.thigh beside the left hip (turned with
   *  the pelvis): the body carries it, so a cut's snap of the chest does not leave it behind. On that a
   *  pendulum hangs: a spring (SIDE.w / SIDE.z) that follows the anchor; SIDE.k of how far it lags is
   *  the hand's sway (at most SIDE.sway), so it trails the body's turn and drop a little and swings
   *  back past its rest before it settles.
   *  It goes to the side as p[sd] rises, by the first cut: it is let go where it was as a free
   *  pendulum that falls onto its rest, the body taking it up over SIDE.easeIn s, never faster than
   *  SIDE.vIn against the rest (the arm drops, it does not snap); home to the pose's own hand as p[sd] falls,
   *  over SIDE.ease s; each way from wherever the hand was as it began (the pose's own hand crossed to
   *  the swing's in a few frames, and went home in the swing's last tenth of a second). Kept clear of
   *  the left thigh, within the arm's reach of the shoulder and above the ground. World axes from the root (a root that turns or travels drags nothing; his drawn body
   *  does), in sub-steps whatever the frame's length, nothing in a frozen frame (hit-stop, a posed
   *  contact). Off (p[sd] 0 and home) it changes nothing. Allocates nothing, never throws. */
  _sideHand(r, p) {
    // (a second hand on the grip wins: as a two-handed blow takes it, the side lets go)
    const S = this.sideH, want = clamp(fin(p[P.sd]), 0, 1) * (1 - clamp(fin(p[P.twoHand]), 0, 1)), dt = Math.max(0, fin(this.frameDt));
    // (the look it hangs in: the one picked now while it goes to the side, the one it went in on its way home)
    const Lnow = offHandLook();
    if (want > 1e-4 && Lnow && (S.mode <= 0 || !S.L)) S.L = Lnow;
    const SIDE = S.L;
    if (!SIDE) {
      S.mode = 0;
      return;
    }
    const fresh = !S.ok || !Number.isFinite(S.e + S.x.x + S.x.y + S.x.z + S.v.x + S.v.y + S.v.z + S.c.x + S.c.y + S.c.z + S.last.x + S.last.y + S.last.z);
    if (fresh) {
      S.ok = true;
      S.mode = 0;
      S.pw = 0;
    }
    const pw = S.pw, ch = r.chest;
    S.pw = want;
    _shO.setFromMatrixPosition(r.root.matrixWorld);
    _shQ.copy(_T);
    ch.localToWorld(_shQ).sub(_shO); // the pose's own wrist
    if (fresh) S.last.copy(_shQ);
    if (S.mode === 0 && !(want > 1e-4)) {
      S.last.copy(_shQ); // (where a way to the side starts: last frame's hand, not this frame's pose)
      return;
    }
    const e = ch.matrixWorld.elements, sc = Math.hypot(e[0], e[1], e[2]) || 1;
    // the anchor: under the shoulder (the chest's yaw), drawn toward beside the hip (the pelvis's)
    {
      const yc = Math.atan2(e[8], e[10]), H = SIDE.hang, c = Math.cos(yc), s = Math.sin(yc);
      // (a look held away from the body, `tuck`: drawn in toward it through a turning swing, arms in through the
      // turns: held out, a whirl swept it 18 - 26 cm a frame. Eased in and out over SIDE_TUCK s)
      const tw = SIDE.tuck ? (this.key === 'attack' && this.atkAnim?.spin ? 1 : 0) : 0;
      S.tk = fin(S.tk) + clamp(tw - fin(S.tk), -dt / SIDE_TUCK, dt / SIDE_TUCK);
      const T = SIDE.tuck, tk = S.tk * S.tk * (3 - 2 * S.tk);
      const hx = tk > 0 ? lerp(H[0], T[0], tk) : H[0], hy = tk > 0 ? lerp(H[1], T[1], tk) : H[1], hz = tk > 0 ? lerp(H[2], T[2], tk) : H[2];
      _shA.setFromMatrixPosition(r.arms.L.upper.matrixWorld).sub(_shO);
      _shA.x += sc * (hx * c + hz * s);
      _shA.y += sc * hy;
      _shA.z += sc * (-hx * s + hz * c);
      const Lg = r.legs?.L, k = SIDE.hip;
      if (Lg && k > 0) {
        const pe = r.pelvis.matrixWorld.elements, yp = Math.atan2(pe[8], pe[10]), T = SIDE.thigh, cp = Math.cos(yp), sp = Math.sin(yp);
        _shB.setFromMatrixPosition(Lg.thigh.matrixWorld).sub(_shO);
        _shB.x += sc * (T[0] * cp + T[2] * sp);
        _shB.y += sc * T[1];
        _shB.z += sc * (-T[0] * sp + T[2] * cp);
        _shA.lerp(_shB, k);
      }
    }
    // which way: to the side while p[sd] stands or rises, home once it falls. A new way starts from
    // where the hand was last frame, left there in his frame (a clip's first pose may already have
    // moved it: out of a roll the cut's first frame put it 26 cm away; held in the chest's frame, the
    // windup's turn of the chest flung it 30 cm in a frame)
    const way = want > pw + 1e-6 || want >= 0.999 ? 1 : want < pw - 1e-6 || !(want > 1e-4) ? -1 : S.mode || 1;
    if (way !== S.mode) {
      if (way > 0) {
        // (the pendulum starts still where the hand is, and the hand is all pendulum: the arm drops
        // onto its rest as a pendulum falls, and only as it gets there does the body take it up)
        S.x.copy(S.last);
        S.v.subVectors(_shA, S.last).multiplyScalar(SIDE.drop); // (let go already falling toward its rest)
      }
      S.c.copy(S.last);
      if (way > 0) S.r.subVectors(S.last, _shA);
      S.mode = way;
      S.e = 0;
    }
    S.e = Math.min(1, S.e + dt / (S.mode > 0 ? SIDE.easeIn : S.quick ? SIDE.easeBack : SIDE.ease));
    // (to the side: how far the body has taken the hand up from the free pendulum, an ease out: it lets
    // go of where it was at once (a smoothstep kept it planted on the waist through hit 1's windup);
    // home: how far it is back on the pose's hand, smootherstep)
    const x = S.e, ew = S.mode > 0 ? 1 - (1 - x) * (1 - x) : x * x * x * (x * (6 * x - 15) + 10), kIn = S.mode > 0 ? ew : 1;
    // the pendulum on the anchor
    if (dt > SIDE_SNAP) {
      S.x.copy(_shA); // (a frame that long is no motion to follow: a hidden tab)
      S.v.set(0, 0, 0);
    } else if (dt > 0) {
      const n = Math.min(8, Math.ceil(dt * SIDE_HZ)), h = dt / n, W = SIDE.w, K = W * W, D = 2 * SIDE.z * W;
      for (let i = 0; i < n; i++) {
        S.v.x += (K * (_shA.x - S.x.x) - D * S.v.x) * h;
        S.v.y += (K * (_shA.y - S.x.y) - D * S.v.y) * h;
        S.v.z += (K * (_shA.z - S.x.z) - D * S.v.z) * h;
        S.x.addScaledVector(S.v, h);
      }
      // (it lags at most what shows as the most sway: a body that snaps further drags it along)
      _shC.subVectors(S.x, _shA);
      const lag = _shC.length(), most = lerp(SIDE_FREE, SIDE.sway / SIDE.k, kIn) * sc;
      if (lag > most) {
        S.x.copy(_shA).addScaledVector(_shC, most / lag);
        _shC.multiplyScalar(1 / lag);
        const vn = S.v.dot(_shC);
        if (vn > 0) S.v.addScaledVector(_shC, -vn);
      }
    }
    // where it goes: the side (its rest, the sway, the trail of his travel), or home
    if (S.mode > 0) {
      _shG.subVectors(S.x, _shA).multiplyScalar(lerp(1, SIDE.k, kIn)).add(_shA);
      const gv = this.player?.groundVel;
      if (gv) {
        let tx = -SIDE.trail * kIn * fin(gv.x), tz = -SIDE.trail * kIn * fin(gv.z);
        const tl = Math.hypot(tx, tz), cap = SIDE.trailMax * sc;
        if (tl > cap) {
          tx *= cap / tl;
          tz *= cap / tl;
        }
        _shG.x += tx;
        _shG.z += tz;
      }
      _shR.copy(_shA);
      // (the quiet look: the clip's own gestures, `keep` of the way out from the rest)
      if (SIDE.keep > 0) _shG.lerp(_shQ, SIDE.keep * kIn);
    } else if (ew < 1) _shG.lerpVectors(S.c, _shQ, ew); // home: from where the way began, by the ease
    else _shG.copy(_shQ);
    if (S.mode < 0 && ew >= 1 && !(want > 1e-4)) {
      S.mode = 0; // home: the pose's own hand, untouched
      return;
    }
    // within the arm's reach of the shoulder, and hanging open (eased in from no nearer than it folds)
    _shA.setFromMatrixPosition(r.arms.L.upper.matrixWorld).sub(_shO);
    _shC.subVectors(_shG, _shA);
    {
      const d = _shC.length(), lo = (S.mode > 0 ? lerp(SIDE_FOLD, SIDE.near, ew) : SIDE_FOLD) * sc, hi = SIDE_REACH * sc;
      if (d > 1e-5 && (d > hi || d < lo)) _shG.copy(_shA).addScaledVector(_shC, (d > hi ? hi : lo) / d);
    }
    if (S.mode > 0) {
      // … at most SIDE.vIn against the body carrying it (its rest; the pendulum let go 60 cm from
      // there, out of a sprint, and the arm opening onto it stepped 13 cm a frame)
      _shC.subVectors(_shG, _shR).sub(S.r);
      const st = _shC.length(), most = SIDE.vIn * sc * dt;
      if (st > most) _shG.addScaledVector(_shC, most / st - 1);
      S.r.subVectors(_shG, _shR);
    }
    // clear of the left thigh (its line from the hip to the knee, as the legs stood last frame), the
    // way it already is from it (pushed out to his left instead, a thigh lifted out to the side in a
    // low stance sent it 15 cm across in a frame)
    const Lg = r.legs?.L;
    if (Lg && SIDE.thighR > 0) {
      _shA.setFromMatrixPosition(Lg.thigh.matrixWorld).sub(_shO);
      _shB.setFromMatrixPosition(Lg.shin.matrixWorld).sub(_shO).sub(_shA);
      _shC.subVectors(_shG, _shA);
      const l2 = _shB.lengthSq(), k = l2 > 1e-8 ? clamp(_shC.dot(_shB) / l2, 0, 1) : 0;
      _shC.addScaledVector(_shB, -k); // the line → the wrist
      const R = SIDE.thighR * sc, d = _shC.length();
      if (d < R) {
        if (d > 1e-5) _shG.addScaledVector(_shC, (R - d) / d);
        else _shG.x += R * e[0] / sc, _shG.z += R * e[2] / sc; // (on the line: out to his left)
      }
    }
    // … and above the ground
    _shG.y = Math.max(_shG.y, HAND_FLOOR + 0.02 - _shO.y);
    S.last.copy(_shG);
    _T.copy(_shG).add(_shO);
    ch.worldToLocal(_T);
  }

  /** The free hand's wrist (rig.arms.L.wrist; the hero only, opts.freeHand): the fingers toward
   *  p[lD], the palm toward p[lN] (body axes; each vector's length is its weight: 0 = the forearm's
   *  own line / its own roll), inside the wrist's range (WRIST_L), through a spring, so the fingers
   *  snap into the point and the wrist sets last. On the sword wrist (lk) the fingers turn to lie
   *  along the sword forearm, the palm down on it; on the grip (two) the hand belongs to the sword
   *  joint and the wrist goes rigid. The twist about the forearm (pronation / supination) turns here
   *  too: every forearm mesh is round. Writes this.wristL; allocates nothing, never throws. */
  _wristL(r, p, two, lk) {
    const W = r.arms.L.wrist;
    if (!W) return;
    const S = this.wristL, Lm = WRIST_L;
    let dx = fin(p[P.lD]), dy = fin(p[P.lD + 1]), dz = fin(p[P.lD + 2]);
    let nx = fin(p[P.lN]), ny = fin(p[P.lN + 1]), nz = fin(p[P.lN + 2]);
    const off = 1 - smoothstep(0.6, 0.95, two); // on the grip the fist is the sword joint's
    // body axes → the free forearm's local axes
    _hq1.copy(r.arms.L.upper.quaternion).multiply(r.arms.L.fore.quaternion);
    _hq2.copy(_hq1).invert().multiply(_qBC);
    if (lk > 0.001) {
      // on the sword wrist the fingers lie (part way: LK_ALONG) along the sword forearm (elbow →
      // wrist, chest → body axes), the palm down on it
      _hqs.copy(r.arms.R.upper.quaternion).multiply(r.arms.R.fore.quaternion);
      _hy.set(0, -1, 0).applyQuaternion(_hqs);
      _hqs.copy(_qBC).invert();
      _hy.applyQuaternion(_hqs);
      const dl = Math.max(0.6, Math.hypot(dx, dy, dz)), kd = LK_ALONG * lk;
      dx += (_hy.x * dl - dx) * kd;
      dy += (_hy.y * dl - dy) * kd;
      dz += (_hy.z * dl - dz) * kd;
      const nl = Math.max(0.6, Math.hypot(nx, ny, nz));
      nx += (0 - nx) * lk;
      ny += (-nl - ny) * lk;
      nz += (0 - nz) * lk;
    }
    const wD = smoothstep(0, 0.6, Math.hypot(dx, dy, dz)) * off, wN = smoothstep(0, 0.6, Math.hypot(nx, ny, nz)) * off;
    let clamped = false;
    if (wD > 1e-3 || wN > 1e-3) {
      // the fingers (the hand's −Y) in fore local, blended in from the forearm's own line by wD
      _hd.set(dx, dy, dz).applyQuaternion(_hq2);
      if (_hd.lengthSq() < 1e-8) _hd.set(0, -1, 0);
      _hd.normalize().multiplyScalar(wD);
      _hd.y -= 1 - wD;
      if (_hd.lengthSq() < 1e-8) _hd.set(0, -1, 0);
      _hd.normalize();
      // the palm (the hand's −X): the swing's own (no twist), blended toward the wanted one by wN
      _hqs.setFromUnitVectors(_hy.set(0, -1, 0), _hd);
      _hz.set(-1, 0, 0).applyQuaternion(_hqs); // square to the fingers
      _hp.copy(_hz);
      _hn.set(nx, ny, nz).applyQuaternion(_hq2);
      _hn.addScaledVector(_hd, -_hn.dot(_hd));
      if (_hn.lengthSq() > 1e-6) _hp.lerp(_hn.normalize(), wN);
      _hp.addScaledVector(_hd, -_hp.dot(_hd));
      if (_hp.lengthSq() < 1e-8) _hp.copy(_hz);
      _hp.normalize();
      // the hand's basis: X = −palm, Y = −fingers, Z = X × Y → Euler YXZ (the joint's order):
      // deviation about X, twist about Y, flex about Z
      const Xx = -_hp.x, Xy = -_hp.y, Xz = -_hp.z, Yx = -_hd.x, Yy = -_hd.y, Yz = -_hd.z;
      const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx;
      const rDev = Math.asin(clamp(-Zy, -1, 1)), rTw = Math.atan2(Zx, Zz), rFlex = Math.atan2(Xy, Yy);
      S.tx = clamp(rDev, Lm.rad, Lm.uln);
      S.tz = clamp(rFlex, Lm.flex, Lm.ext);
      // a palm asked for nearly opposite the neutral would flip the clamped twist from one end of
      // its range to the other: past flipGuard the last target stands
      const flip = Math.abs(rTw) > Lm.flipGuard;
      if (!flip) S.ty = clamp(rTw, Lm.pro, Lm.sup);
      clamped = flip || S.tx !== rDev || S.ty !== rTw || S.tz !== rFlex;
    } else {
      S.tx = S.ty = S.tz = 0;
    }
    S.clamped = clamped;
    if (!Number.isFinite(S.tx + S.ty + S.tz)) S.tx = S.ty = S.tz = 0;
    // the spring (the scaled frame time: it freezes in a hit-stop), sub-stepped at ≤ 1/120 s like
    // the cloth and the hair: one semi-implicit step a frame is stable only while ω·dt < 1.18
    // (ζ 0.55; the twist's < 0.96), so below ~35 fps the wrist flipped ~30° every frame at rest,
    // held only by the step cap. The cap (the most it turns in a frame) and the range bound the
    // frame's total
    const dt = Math.min(this.frameDt, 1 / 30);
    if (!S.ok) {
      S.x = S.tx;
      S.y = S.ty;
      S.z = S.tz;
      S.vx = S.vy = S.vz = 0;
      S.ok = true;
    } else if (dt > 0) {
      const w = Lm.w, z = Lm.z, wT = Lm.wT, zT = Lm.zT, cap = Lm.cap;
      const n = Math.min(4, Math.max(1, Math.ceil(dt * WRIST_HZ - 1e-6))), h = dt / n;
      const x0 = S.x, y0 = S.y, z0 = S.z;
      for (let i = 0; i < n; i++) {
        S.vx += (w * w * (S.tx - S.x) - 2 * z * w * S.vx) * h;
        S.vy += (wT * wT * (S.ty - S.y) - 2 * zT * wT * S.vy) * h;
        S.vz += (w * w * (S.tz - S.z) - 2 * z * w * S.vz) * h;
        S.x += S.vx * h;
        S.y += S.vy * h;
        S.z += S.vz * h;
      }
      S.x = clamp(x0 + clamp(S.x - x0, -cap, cap), Lm.rad - 0.05, Lm.uln + 0.05);
      S.y = clamp(y0 + clamp(S.y - y0, -cap, cap), Lm.pro - 0.05, Lm.sup + 0.05);
      S.z = clamp(z0 + clamp(S.z - z0, -cap, cap), Lm.flex - 0.05, Lm.ext + 0.05);
    }
    if (!Number.isFinite(S.x + S.y + S.z + S.vx + S.vy + S.vz)) {
      S.x = S.y = S.z = S.vx = S.vy = S.vz = 0;
      S.ok = false;
    }
    W.rotation.set(S.x, S.y, S.z);
  }

  /** Keep the blade tip out of the ground: raise _bz's world pitch just enough. */
  _tipFloor(r) {
    r.body.localToWorld(_w.copy(r.sword.position));
    _v.copy(_bz).applyQuaternion(_qBody);
    const need = (TIP_FLOOR - _w.y) / DIM.steelTip;
    if (_v.y < need && need < 0.95) {
      const h = Math.sqrt(1 - need * need);
      let hl = Math.hypot(_v.x, _v.z);
      if (hl < 1e-4) {
        _v.set(0, 0, 1).applyQuaternion(_qRoot);
        hl = Math.hypot(_v.x, _v.z) || 1;
      }
      _v.set((_v.x * h) / hl, need, (_v.z * h) / hl);
      _bz.copy(_v).applyQuaternion(_q1.copy(_qBody).invert()).normalize();
    }
  }

  /** Swing the blade direction _bz (body space, from the grip r.sword.position) out of both legs'
   *  thigh and shin capsules: the closest blade point moves straight away from the limb by the
   *  overlap (continuous in the overlap, so it eases in and out without a pop). */
  _bladeClear(r, fresh) {
    const L = LEG_PTS;
    if (fresh) {
      // hip, knee, ankle of each leg in body space (after this frame's leg IK)
      _mB.copy(r.body.matrixWorld).invert();
      for (let li = 0; li < 2; li++) {
        const leg = li ? r.legs.L : r.legs.R, o = li * 3;
        leg.thigh.getWorldPosition(L[o]).applyMatrix4(_mB);
        leg.shin.getWorldPosition(L[o + 1]).applyMatrix4(_mB);
        leg.foot.getWorldPosition(L[o + 2]).applyMatrix4(_mB);
      }
    }
    const G = r.sword.position;
    for (let pass = 0; pass < 2; pass++) {
      for (let o = 0; o < 6; o += 3) {
        this._clearSeg(G, L[o], L[o + 1], BLADE_CLEAR[0]);
        this._clearSeg(G, L[o + 1], L[o + 2], BLADE_CLEAR[1]);
      }
    }
  }

  /** One limb segment a→b of clearance radius R against the blade from the grip G along _bz. The
   *  blade point is carried OUTWARD (away from the body's axis: in front of the legs when it lies
   *  across them, behind when it trails) until it clears: one consistent side, so a leg swinging
   *  through the blade's line pushes it along instead of flipping it front / back frame to frame. */
  _clearSeg(G, a, b, R) {
    const L = DIM.steelTip;
    _cD.copy(_bz).multiplyScalar(L); // blade segment G → G + _cD
    _cE.subVectors(b, a); // limb segment
    _cP.subVectors(G, a);
    const A = _cD.dot(_cD), E = _cE.dot(_cE), F = _cE.dot(_cP), C = _cD.dot(_cP), B = _cD.dot(_cE);
    if (!(A > 1e-8) || !(E > 1e-8)) return;
    const den = A * E - B * B;
    let s = den > 1e-9 ? clamp((B * F - C * E) / den, 0, 1) : 0;
    let t = (B * s + F) / E;
    if (t < 0) {
      t = 0;
      s = clamp(-C / A, 0, 1);
    } else if (t > 1) {
      t = 1;
      s = clamp((B - C) / A, 0, 1);
    }
    if (s * L < BLADE_CLEAR[2]) return; // at the hand: the arm's business, not the blade's
    _cP.copy(G).addScaledVector(_cD, s); // blade point
    _cQ.copy(a).addScaledVector(_cE, t); // limb point
    const dx = _cP.x - _cQ.x, dy = _cP.y - _cQ.y, dz = _cP.z - _cQ.z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd >= R * R || !Number.isFinite(dd)) return;
    // outward = horizontal, from the body's vertical axis through the blade point
    let nx = _cP.x, nz = _cP.z;
    const nl = Math.hypot(nx, nz);
    if (nl > 1e-3) {
      nx /= nl;
      nz /= nl;
    } else {
      nx = 0;
      nz = 1;
    }
    // the push k along n that puts the point on the capsule's surface: |D + n k| = R
    const nd = nx * dx + nz * dz;
    const k = -nd + Math.sqrt(Math.max(0, nd * nd - dd + R * R));
    if (!(k > 0)) return;
    _cP.x += nx * k;
    _cP.z += nz * k;
    // keep the grip: the new direction through the moved point
    _cP.sub(G);
    const l = _cP.length();
    if (l > 1e-4) _bz.copy(_cP).multiplyScalar(1 / l);
  }

  /** Hand target in chest space (into _T): the pose's shoulder offset (body axes). The sword hand's
   *  offsets start from `arm.anchor` (model.js DIM.gripShoulder: the round-2 shoulder), so the
   *  broader round-3 shoulders leave every grip the arm reaches, and the blade's hit segment, as it was. */
  _handTarget(arm, p, hi) {
    _T.set(p[hi], p[hi + 1], p[hi + 2]).applyQuaternion(_qBC).add(arm.anchor ?? arm.upper.position);
    return _T;
  }

  /** How far the sword arm reaches its full length (0 = the soft reach, ADR-044; 1 = straight as asked):
   *  the loco clip's own value (A.reachT: the run's straight trailing arm, ADR-229) cross-faded like a
   *  pose channel from where the last clip left it. */
  _swordOpen() {
    const tgt = this.key === 'loco' ? clamp(fin(this.reachT), 0, 1) : 0;
    if (!(this.blendT < this.blendDur)) return tgt;
    const u = clamp(this.blendT / this.blendDur, 0, 1);
    return lerp(clamp(fin(this.reachFrom), 0, 1), tgt, this.easeOut ? smoothstep(0, ENTRY_EASE, u) : u * u * (3 - 2 * u));
  }

  _arm(arm, T, p, pi, holdsSword, lock = 0) {
    _S.copy(arm.upper.position);
    if (T !== _T) _T.copy(T);
    // soft reach (ADR-044): a target near or past the arm's length is reached with the elbow still
    // bent. The last fifth of the reach is compressed, so the arm never locks into a straight
    // stick, however far out a pose asks for the hand; `lock` 0..1 (the off hand on the grip)
    // gives the full reach back, so two hands still meet (the hero's free arm only up to LOCK_REACH:
    // its elbow on the grip keeps a bend instead of locking straight)
    {
      // (the hero's arms open further, HERO_SOFT; his sword arm in a two-handed grip keeps the old
      // reach: the free hand has to follow the grip, and it cannot follow a fully stretched sword arm)
      const hs = this.freeHand ? (holdsSword ? 1 - clamp(fin(p[P.twoHand], 0), 0, 1) : 1) : 0;
      // (a boss whose blows are his arms may open them as the hero does: `armSoft`, ADR-162)
      const AS = this.armSoft ?? ARM_SOFT;
      const s0 = lerp(AS[0], HERO_SOFT[0], hs), s1 = lerp(AS[1], HERO_SOFT[1], hs);
      const L = DIM.upperArm + DIM.foreArm, d0 = s0 * L;
      _v.subVectors(_T, _S);
      const d = _v.length();
      const capR = this.freeHand && arm === this.rig.arms.L ? LOCK_REACH : 1;
      // (the hero's sword arm may be asked for its full reach: a straight trailing arm on the run, ADR-229)
      const full = holdsSword && this.freeHand ? Math.max(lock, this._swordOpen()) : lock;
      if (d > d0 && (full < 1 || capR < 1)) {
        const span = (s1 - s0) * L;
        const d2 = d0 + span * (1 - Math.exp(-(d - d0) / span));
        const dl = capR < 1 ? Math.min(d, capR * L) : d;
        _T.copy(_S).addScaledVector(_v, lerp(d2, dl, full) / d);
      }
    }
    // … and it never folds flatter than ARM_FOLD at the elbow: a hand asked for nearer its shoulder
    // than that is held out along the same line (the off hand on the grip keeps the grip)
    {
      _v.subVectors(_T, _S);
      const d = _v.length();
      if (d < ARM_NEAR && lock < 1) {
        if (d > 1e-4) _T.copy(_S).addScaledVector(_v, lerp(ARM_NEAR, d, lock) / d);
        else _T.set(_S.x, _S.y, _S.z + ARM_NEAR);
      }
    }
    // … and a hand never passes through the chest: inside the ribs' outline (an ellipse round the
    // chest's axis, from the shoulders down) it is moved out to the surface, the way it was heading
    if (lock < 1 && _T.y < _S.y + 0.02 && _T.y > _S.y - 0.5) {
      const e = (_T.x / TORSO_R[0]) ** 2 + (_T.z / TORSO_R[1]) ** 2;
      if (e < 1) {
        const k = e > 1e-4 ? lerp(1 / Math.sqrt(e), 1, lock) : 1;
        _T.x *= k;
        _T.z = e > 1e-4 ? _T.z * k : TORSO_R[1];
      }
    }
    // hands never reach into the ground
    this.rig.chest.localToWorld(_w.copy(_T));
    if (_w.y < HAND_FLOOR) {
      _w.y = HAND_FLOOR;
      this.rig.chest.worldToLocal(_T.copy(_w));
    }
    _pole.set(p[pi], p[pi + 1], p[pi + 2]).applyQuaternion(_qBC);
    this._elbow(arm, _S, _T, _pole);
    let beta = solveTwoBone(_S, _T, _pole, DIM.upperArm, DIM.foreArm, 1, arm.upper.quaternion, _end);
    // … and an elbow never sinks into the ground (lying on his back the poles point into it)
    _hK.set(0, -DIM.upperArm, 0).applyQuaternion(arm.upper.quaternion).add(_S);
    if (this._hingeFloor(this.rig.chest, _S, _end, _hK, ELBOW_FLOOR, _pole, arm === this.rig.arms.L ? 1 : -1)) {
      beta = solveTwoBone(_S, _T, _pole, DIM.upperArm, DIM.foreArm, 1, arm.upper.quaternion, _end);
    }
    arm.fore.rotation.set(-beta, 0, 0);
    if (holdsSword) {
      // grip = the reached wrist point, re-expressed in body space
      this.rig.chest.localToWorld(_w.copy(_end));
      this.rig.body.worldToLocal(_w);
      this.rig.sword.position.copy(_w);
    }
  }

  /** The sword forearm turned toward the blade (see GRIP_FOLD; `this.gripMax` rad, set by a duelist):
   *  after the sword arm's solve, a forearm more than gripMax off the blade's line swings round the
   *  elbow until it is gripMax off, and the hand (the grip, the sword's origin) goes with it. Chest
   *  local throughout; allocates nothing; a non-finite step leaves the arm as it was. */
  _gripAlign(arm, p) {
    const S = arm.upper.position, a = DIM.upperArm, b = DIM.foreArm, max = this.gripMax;
    _gE.set(0, -a, 0).applyQuaternion(arm.upper.quaternion).add(S); // the elbow
    _gF.subVectors(_end, _gE);
    if (!(_gF.lengthSq() > 1e-8)) return;
    _gF.normalize();
    _gD.set(p[P.swD], p[P.swD + 1], p[P.swD + 2]).applyQuaternion(_qBC);
    if (!(_gD.lengthSq() > 1e-8)) return;
    _gD.normalize();
    const c = clamp(_gF.dot(_gD), -1, 1);
    if (c >= Math.cos(max)) return;
    _gW.copy(_gF).addScaledVector(_gD, -c);
    if (!(_gW.lengthSq() > 1e-8)) {
      // (the forearm straight against the blade: turn it away from the upper arm's side)
      _gW.subVectors(_gE, S).addScaledVector(_gD, -_gD.dot(_gU.subVectors(_gE, S)));
      if (!(_gW.lengthSq() > 1e-8)) return;
    }
    _gW.normalize();
    _gF.copy(_gD).multiplyScalar(Math.cos(max)).addScaledVector(_gW, Math.sin(max)); // the forearm wanted
    // … folded no tighter than GRIP_FOLD at the elbow: between the forearm and the elbow → shoulder line
    _gU.subVectors(S, _gE).normalize();
    const cf = _gF.dot(_gU);
    if (cf > Math.cos(GRIP_FOLD)) {
      _gW.copy(_gF).addScaledVector(_gU, -cf);
      if (!(_gW.lengthSq() > 1e-8)) return;
      _gW.normalize();
      _gF.copy(_gU).multiplyScalar(Math.cos(GRIP_FOLD)).addScaledVector(_gW, Math.sin(GRIP_FOLD));
    }
    _gT.copy(_gE).addScaledVector(_gF, b);
    if (!Number.isFinite(_gT.x + _gT.y + _gT.z)) return;
    // the same elbow: the pole is the elbow's own side of the new shoulder → hand line
    _pole.subVectors(_gE, S);
    const beta = solveTwoBone(S, _gT, _pole, a, b, 1, arm.upper.quaternion, _end);
    arm.fore.rotation.set(-beta, 0, 0);
    this.rig.chest.localToWorld(_w.copy(_end));
    this.rig.body.worldToLocal(_w);
    this.rig.sword.position.copy(_w);
  }

  /** Limit how fast an elbow swings round its shoulder → hand line (ELBOW_RATE): `pole` (chest
   *  space) is turned back toward where the elbow was last frame when the pose asks for more. The
   *  hand still reaches its target; only the elbow's side changes over a few frames instead of one.
   *  (The poles come from the pose: a hand passing close to the shoulder, or a pole switching as a
   *  clip starts, flipped the elbow 50-135° in a single frame: "arms snapping between positions".) */
  _elbow(arm, S, T, pole) {
    const st = arm === this.rig.arms.R ? this.elbowR : this.elbowL, dt = this.frameDt;
    _eA.subVectors(T, S);
    const al = _eA.length();
    if (!(al > 1e-5)) return;
    _eA.multiplyScalar(1 / al);
    _eW.copy(pole).addScaledVector(_eA, -pole.dot(_eA)); // where the pose wants the elbow, off the line
    const wl = _eW.length();
    if (!(wl > 1e-5) || !Number.isFinite(wl)) return;
    _eW.multiplyScalar(1 / wl);
    if (st.ok && dt > 0) {
      _eP.copy(st.v).addScaledVector(_eA, -st.v.dot(_eA)); // where it was, off this frame's line
      const pl = _eP.length();
      if (pl > 1e-3) {
        _eP.multiplyScalar(1 / pl);
        const ang = Math.acos(clamp(_eP.dot(_eW), -1, 1)), max = ELBOW_RATE * dt;
        if (ang > max) {
          // turn from where it was toward where it is wanted, round the line, by `max`
          _eC.crossVectors(_eA, _eP);
          const sg = _eC.dot(_eW) < 0 ? -1 : 1;
          _eW.copy(_eP).multiplyScalar(Math.cos(max)).addScaledVector(_eC, sg * Math.sin(max));
          pole.copy(_eW);
        }
      }
    }
    st.v.copy(_eW);
    st.ok = true;
  }

  /** A knee / an elbow never sinks into the ground (ADR-083: the death's collapse pushed both knees
   *  15 cm under the grass). `mid` is the joint as solved and S → end its limb's line, all in
   *  `parent`'s space: when the joint is under `floor` (world height) it is swung round that line up
   *  to the floor, the short way (near a tie: toward the limb's own outside, `outX` = which way that
   *  is along the parent's X). Writes the new pole direction to `out`; false = nothing to do. */
  _hingeFloor(parent, S, end, mid, floor, out, outX) {
    const e = parent.matrixWorld.elements;
    const gx = e[1], gy = e[5], gz = e[9]; // world height = g · (a point in parent space) + e[13]
    if (!(gx * mid.x + gy * mid.y + gz * mid.z + e[13] < floor)) return false;
    _hA.subVectors(end, S);
    const al = _hA.length();
    if (al < 1e-4) return false;
    _hA.divideScalar(al);
    _hU.subVectors(mid, S);
    _hC.copy(S).addScaledVector(_hA, _hU.dot(_hA));
    _hU.subVectors(mid, _hC);
    const R = _hU.length();
    if (R < 1e-3) return false;
    _hU.divideScalar(R);
    _hW.crossVectors(_hA, _hU);
    // height round the line: hc + a·cos φ + b·sin φ (φ = 0: where the joint is now)
    const a = R * (gx * _hU.x + gy * _hU.y + gz * _hU.z), b = R * (gx * _hW.x + gy * _hW.y + gz * _hW.z);
    const need = floor - (gx * _hC.x + gy * _hC.y + gz * _hC.z + e[13]);
    const A = Math.hypot(a, b);
    if (A < 1e-5) return false;
    const top = Math.atan2(b, a);
    let phi = top; // the whole circle is under the floor: as high as the joint goes
    if (A > Math.abs(need)) {
      const half = Math.acos(need / A);
      const p1 = wrapAngle(top - half), p2 = wrapAngle(top + half);
      const c1 = Math.abs(p1) - 0.3 * outX * (_hU.x * Math.cos(p1) + _hW.x * Math.sin(p1));
      const c2 = Math.abs(p2) - 0.3 * outX * (_hU.x * Math.cos(p2) + _hW.x * Math.sin(p2));
      phi = c1 <= c2 ? p1 : p2;
    }
    out.copy(_hU).multiplyScalar(Math.cos(phi)).addScaledVector(_hW, Math.sin(phi));
    return true;
  }

  _leg(leg, p, fi, ki, yi, ffi) {
    const r = this.rig;
    _S.copy(leg.thigh.position);
    _T.set(p[fi], Math.max(FOOT_FLOOR, p[fi + 1]), p[fi + 2]); // model y == height above ground
    r.root.localToWorld(_T);
    r.pelvis.worldToLocal(_T);
    // a knee never closes past LEG_FOLD (the roll's tuck asked for a heel against the hip, 10°)
    _v.subVectors(_T, _S);
    let dl = _v.length();
    if (dl < LEG_NEAR && dl > 1e-4) _T.copy(_S).addScaledVector(_v, LEG_NEAR / dl);
    // (`kickStretch`, a boss whose kicks land straight: a foot off the ground (from lift0 to lift1 m)
    // asked for far from the hip is carried further out along the same line, smoothly with the
    // distance, so at a kick's extension the leg is a straight line, not a triangle at the knee; a
    // planted foot, a chamber and a tuck are never touched)
    const KS = this.kickStretch;
    if (KS && dl > 1e-4) {
      const L = DIM.thigh + DIM.shin, w = smoothstep(KS[3], KS[4], p[fi + 1]);
      if (w > 0 && dl > KS[0] * L) {
        const k = smoothstep(KS[0] * L, KS[1] * L, dl) * w * KS[2] * L;
        _T.copy(_S).addScaledVector(_v, (dl + k) / dl);
        _v.subVectors(_T, _S);
        dl = _v.length();
      }
    }
    // (`legSoft`, a boss who kicks: the last of the leg's reach is compressed as the arm's is, so a kick
    // at full stretch keeps a little bend: at a straight leg the knee's side is undefined and it flipped
    // from frame to frame, ADR-162)
    const LS = this.legSoft;
    if (LS) {
      const L = DIM.thigh + DIM.shin, d0 = LS[0] * L;
      if (dl > d0) {
        const span = (LS[1] - LS[0]) * L;
        _T.copy(_S).addScaledVector(_v, (d0 + span * (1 - Math.exp(-(dl - d0) / span))) / dl);
      }
    }
    _pole.set(p[ki], p[ki + 1], p[ki + 2]).applyQuaternion(_qBP);
    let beta = solveTwoBone(_S, _T, _pole, DIM.thigh, DIM.shin, -1, leg.thigh.quaternion, _end);
    // … and a knee never sinks into the ground
    _hK.set(0, -DIM.thigh, 0).applyQuaternion(leg.thigh.quaternion).add(_S);
    if (this._hingeFloor(r.pelvis, _S, _end, _hK, KNEE_FLOOR, _pole, leg === r.legs.L ? 1 : -1)) {
      beta = solveTwoBone(_S, _T, _pole, DIM.thigh, DIM.shin, -1, leg.thigh.quaternion, _end);
    }
    leg.shin.rotation.set(beta, 0, 0);
    // ankle: keep the sole level with the ground by footFlat (0 = rigid with the shin)
    _q1.copy(_qPelvis).multiply(leg.thigh.quaternion).multiply(leg.shin.quaternion);
    _q2.copy(_q1).invert().multiply(_qRoot);
    // toe-out / a planted foot's own heading, bounded relative to the BODY's heading (which trails a
    // fast turn of the root): bounding it against the root spun planted feet with the root
    const by = p[P.yaw], fy = by + clamp(wrapAngle(p[yi] - by), -1.2, 1.2);
    if (fy) _q2.multiply(_qs.setFromAxisAngle(_UP, fy));
    leg.foot.quaternion.identity().slerp(_q2, clamp(p[P.footFlat] * p[ffi], 0, 1));
  }

  /** Hem height (world) of a coat panel for segment angles (a0,b0) and (a1,b1). Uses _qA (anchor
   *  world quaternion) and _pa (anchor world position). */
  _hemY(len, a0, b0, a1, b1) {
    _q0.copy(_qA).multiply(_qs.setFromEuler(_eul.set(a0, 0, b0, 'YXZ')));
    _e0.set(0, -len[0], 0).applyQuaternion(_q0).add(_pa);
    _q0.multiply(_qs.setFromEuler(_eul.set(a1, 0, b1, 'YXZ')));
    _e1.set(0, -len[1], 0).applyQuaternion(_q0).add(_e0);
    return Math.min(_e0.y, _e1.y);
  }

  /** QB = the steel (QA, a panel's anchor frame) in its lower segment's parent frame: the upper
   *  segment swung (a0, b0), the pivot at its end (0, −len0, 0). */
  _lowerFrame(nb, a0, b0, len0) {
    const ca = Math.cos(a0), sa = Math.sin(a0), cb = Math.cos(b0), sb = Math.sin(b0);
    for (let k = 0; k < nb; k++) {
      const qx = QA[k * 3], qy = QA[k * 3 + 1], qz = QA[k * 3 + 2];
      const y1 = qy * ca + qz * sa;
      QB[k * 3] = qx * cb + y1 * sb;
      QB[k * 3 + 1] = -qx * sb + y1 * cb + len0;
      QB[k * 3 + 2] = -qy * sa + qz * ca;
    }
  }

  /** The grip and the drawn blade (DIM.forte → DIM.drawnTip) as BLADE_PTS in pelvis space (this
   *  frame's pose; [0] = the grip); returns how many (0 on a bad frame). */
  _bladePts() {
    const r = this.rig;
    r.sword.updateWorldMatrix(true, false);
    _mC.copy(r.pelvis.matrixWorld).invert().multiply(r.sword.matrixWorld);
    const n = NB_STEEL, z0 = DIM.forte, z1 = DIM.drawnTip ?? DIM.steelTip;
    BLADE_PTS[0].set(0, 0, 0).applyMatrix4(_mC);
    for (let k = 1; k < n; k++) BLADE_PTS[k].set(0, 0, z0 + ((z1 - z0) * (k - 1)) / (n - 2)).applyMatrix4(_mC);
    const e = BLADE_PTS[n - 1];
    if (!Number.isFinite(e.x + e.y + e.z + BLADE_PTS[0].x)) return 0;
    // the free hand, while a look holds it at its rest (offHand.js: p[sd]): the cloth keeps to one side of it
    // too, as of the sword hand (behind his back it slipped in and out through the back panels: a flicker of
    // the bare hand, the owner's "spark of yellow")
    if (this.freeHand && this.cur[P.sd] > 0.05) {
      const L = r.arms.L;
      L.fore.updateWorldMatrix(true, false);
      _mC.copy(r.pelvis.matrixWorld).invert().multiply(L.fore.matrixWorld);
      const h = BLADE_PTS[n].set(0, -DIM.foreArm, 0).applyMatrix4(_mC);
      if (Number.isFinite(h.x + h.y + h.z)) return n + 1;
    }
    return n;
  }

  /** Coat skirt: each panel segment springs toward gravity-hang + hip flare − its anchor's
   *  velocity (so it lags turns, runs and rolls). The knees and thighs push the panels out, the
   *  blade caps how far they flare (they hang inside it), and the hem never sinks into the
   *  ground. Angles: x = swing (− outward), z = sideways. Then the torn strips of each panel follow
   *  on their own springs (_strips). */
  _coat(dt) {
    const r = this.rig;
    const steps = dt > 0 ? Math.min(8, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
    const dtk = dt > 0 ? dt * 60 : 100; // frames this step (rate limits); a reset snaps
    r.pelvis.getWorldQuaternion(_qPelvis);
    _qInv.copy(_qPelvis).invert();
    _g.set(0, -1, 0).applyQuaternion(_qInv); // gravity in pelvis space
    // thigh middles + knees in pelvis space
    const lp = this.legPts;
    for (let li = 0; li < 2; li++) {
      const leg = li ? r.legs.L : r.legs.R;
      leg.thigh.getWorldPosition(_S);
      leg.shin.getWorldPosition(_T); // knee (after this frame's IK)
      r.pelvis.worldToLocal(lp[li * 2].copy(_S).add(_T).multiplyScalar(0.5));
      r.pelvis.worldToLocal(lp[li * 2 + 1].copy(_T));
    }
    const still = 1 - clamp(this.speed / 2.5, 0, 1); // the idle breeze fades out once moving
    // (not while he lies down or tumbles: there the hem's floor contact rules the cloth)
    const nb = Math.abs(wrapAngle(this.cur[P.pitch])) < 1.0 ? this._bladePts() : 0;

    for (let i = 0; i < r.coat.length; i++) {
      const C = r.coat[i], D = C.def, st = this.coatState[i], LEN = C.len;
      _pa.setFromMatrixPosition(C.anchor.matrixWorld); // anchors are rigid on the pelvis: current since apply()
      if (this.coatInit && dt > 1e-4) {
        _v.subVectors(_pa, this.coatPrev[i]).divideScalar(dt);
        if (_v.lengthSq() > 625) _v.setLength(25);
        this.coatVel[i].lerp(_v, 1 - Math.exp(-14 * dt));
      }
      this.coatPrev[i].copy(_pa);
      _v.copy(this.coatVel[i]).applyQuaternion(_qInv); // anchor velocity, pelvis space
      const vs = Math.hypot(_v.x, _v.y, _v.z);
      const nx = Math.sin(D.az), nz = Math.cos(D.az); // outward
      const tx = Math.cos(D.az), tz = -Math.sin(D.az); // tangent (anchor +X)
      const flut = Math.min(1, Math.hypot(_v.x, _v.z) / 5);
      // (a panel may carry its own idle breeze / flare, `breeze` / `idleFlare`; else the table's)
      const breeze = (D.breeze ?? BREEZE[i] ?? 0.03) + 0.1 * Math.sin(this.time * 2.618 + i * 1.3) * (0.5 + 0.5 * Math.sin(this.time * 0.9 + i));
      const ap = C.anchor.position;
      // the steel in this panel's anchor frame, and which side of the panel it is on (latched while
      // any of it is over the panel, so the cloth never jumps through it): the sword hand under the
      // cloth (inside a segment's current sheet) → the panel drapes OVER the blade (it swings out
      // clear of it); otherwise it hangs INSIDE the hand and the blade (they cap its flare)
      const steel = nb > 0 && !D.flap && C.r0 > 0;
      const L1 = D.len[1] + 0.08, R1 = C.r0 + 0.25 * D.len[0]; // the lower segment (+ the strip roots)
      if (steel) {
        for (let k = 0; k < nb; k++) {
          const B = BLADE_PTS[k], dx = B.x - ap.x, dz = B.z - ap.z;
          QA[k * 3] = dx * tx + dz * tz;
          QA[k * 3 + 1] = B.y - ap.y;
          QA[k * 3 + 2] = dx * nx + dz * nz;
        }
        // gh = the grip's height over the sheet; near = any steel over it; dive = steel under the
        // sheet that the cloth cannot hang inside of (it runs in under the cloth, inside the pivot)
        let gh = Infinity, near = false, dive = false;
        this._lowerFrame(nb, st[0].x, st[0].z, D.len[0]);
        for (let s = 0; s < 2; s++) {
          const Q = s ? QB : QA, L = s ? L1 : D.len[0], R = s ? R1 : C.r0;
          for (let k = 0; k < nb; k++) {
            if (!segLocal(Q, k, st[s].x, st[s].z, L, coatHW(D, s), coatHW(D, s + 1), R)) continue;
            near = true;
            if (k === 0) {
              if (SEG[2] < gh) gh = SEG[2];
            } else if (SEG[2] < -0.02 && Q[k * 3 + 2] - COAT_BLADE_R <= 0.005) dive = true;
          }
        }
        const side = this.coatSide;
        if (gh < -0.01 || dive) side[i] = 2;
        else if (gh > 0.05 || !near) side[i] = 1;
      }
      const over = steel && this.coatSide[i] === 2;
      const J = COAT_STEEL_JUMP * dtk; // the most the steel moves a segment in one frame
      let parentA = 0, parentB = 0;
      for (let s = 0; s < 2; s++) {
        const c = st[s];
        const lag = COAT_LAG[s] * (1 + COAT_LAG_V * vs);
        const fl = (D.flap ? 0.05 : D.flare ?? COAT_FLARE) + (breeze + (D.idleFlare ?? IDLE_FLARE[i] ?? 0) * (s ? 0.7 : 1)) * still + Math.sin(this.time * 9 + i * 1.7 + s * 1.3) * 0.07 * flut + UPDRAFT_COAT * this.updraft * (s ? 1.3 : 1);
        let hx = _g.x + nx * fl - _v.x * lag;
        let hy = _g.y - _v.y * lag * 0.5;
        let hz = _g.z + nz * fl - _v.z * lag;
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl;
        hy /= hl;
        hz /= hl;
        let absA = Math.atan2(-(hx * nx + hz * nz), -hy);
        const absB = Math.asin(clamp(hx * tx + hz * tz, -1, 1));
        // the legs push the upper segment out (front panels kick out with the knees)
        let lim = COAT_A[0][1];
        if (s === 0) {
          const halfW = (coatHW(D, 0) + coatHW(D, 1)) * 0.5;
          for (const K of lp) {
            const dx = K.x - ap.x, dy = ap.y - K.y, dz = K.z - ap.z;
            if (dy < 0.05) continue;
            if (Math.abs(dx * tx + dz * tz) > halfW + LEG_R) continue;
            const need = -Math.atan2(dx * nx + dz * nz + LEG_R, dy);
            if (need < lim) lim = need;
          }
          absA = Math.min(absA, lim);
        }
        // the steel, from this segment's parent frame (the anchor's, or the swung upper segment's for
        // the lower one): inside it, the grip and every blade point over the sheet cap the swing out
        // (bl, the legs win a conflict); over it, they push it out (bo). The swing that puts a point
        // at height h over the sheet: a = asin(h / ρ) − φ (ρ, φ = the point's distance and angle
        // out from straight down); absolute = + parentA
        let bl = -Infinity, bo = Infinity;
        if (steel) {
          if (s === 1) this._lowerFrame(nb, st[0].x, st[0].z, D.len[0]);
          const Q = s ? QB : QA, L = s ? L1 : D.len[0], R = s ? R1 : C.r0;
          for (let k = 0; k < nb; k++) {
            if (!segLocal(Q, k, c.x, c.z, L, coatHW(D, s), coatHW(D, s + 1), R)) continue;
            const d = -Q[k * 3 + 1], qz = Q[k * 3 + 2];
            if (d < 0.03) continue;
            const rho = Math.hypot(d, qz), phi = Math.atan2(qz, d);
            const curv = SEG[2] - (d * Math.sin(c.x) + qz * Math.cos(c.x)); // the sheet's curve here
            const m = k === 0 || k === NB_STEEL ? COAT_HAND_R : COAT_BLADE_R; // (the hands, the blade)
            if (over) {
              const need = Math.asin(clamp((-m - curv) / rho, -1, 1)) - phi + parentA;
              if (need < bo) bo = need;
            } else if (qz - m > 0.005) {
              // (steel inside the pivot's line: no clear way round it)
              const need = Math.asin(clamp((m - curv) / rho, -1, 1)) - phi + parentA;
              if (need > bl) bl = need;
            }
          }
          if (bo < absA) absA = bo;
          if (s === 0 && bl > lim) bl = lim; // the legs win
          if (bl > absA) absA = bl;
        }
        const [aMin, aMax] = COAT_A[s];
        const tA = clamp(absA - parentA, aMin, aMax);
        const tB = clamp(absB - parentB, -COAT_B[s], COAT_B[s]);
        for (let k = 0; k < steps; k++) {
          c.vx += (COAT_K[s] * (tA - c.x) - COAT_C[s] * c.vx) * h;
          c.vz += (COAT_K[s] * (tB - c.z) - COAT_C[s] * c.vz) * h;
          c.x += c.vx * h;
          c.z += c.vz * h;
        }
        if (!Number.isFinite(c.x + c.z + c.vx + c.vz)) {
          c.x = tA;
          c.z = tB;
          c.vx = c.vz = 0;
        }
        c.x = clamp(c.x, aMin, aMax);
        c.z = clamp(c.z, -COAT_B[s], COAT_B[s]);
        if (s === 0 && c.x > lim) {
          c.x = Math.max(aMin, lim);
          if (c.vx > 0) c.vx = 0;
        }
        // the steel is rigid: a segment the spring would carry through it is held at it, eased in
        // at J per frame (a blade sweeping into the cloth pushes it aside over 2-3 frames, no pop)
        if (bo < Infinity && c.x > bo - parentA) {
          c.x = Math.max(aMin, c.x - Math.min(J, c.x - (bo - parentA)));
          if (c.vx > 0) c.vx = 0;
        } else if (bl > -Infinity && c.x < bl - parentA) {
          c.x = Math.min(aMax, c.x + Math.min(J, bl - parentA - c.x));
          if (c.vx < 0) c.vx = 0;
        }
        parentA += c.x;
        parentB += c.z;
      }

      // ground: if the hem would sink, bend the lower segment up first; if that is not enough,
      // search both swings (upper may fold past its normal limit, e.g. lying on the back) for the
      // nearest pair that keeps the hem above (or the highest available) and kill the velocity
      _qA.copy(_qPelvis).multiply(C.anchor.quaternion);
      const s0 = st[0], s1 = st[1];
      if (this._hemY(LEN, s0.x, s0.z, s1.x, s1.z) < COAT_FLOOR) {
        const [b0, b1] = COAT_A[1];
        let best1 = s1.x, bestD = Infinity;
        for (let k = 0; k <= 16; k++) {
          const a1 = b0 + ((b1 - b0) * k) / 16;
          if (this._hemY(LEN, s0.x, s0.z, a1, s1.z) >= COAT_FLOOR && Math.abs(a1 - s1.x) < bestD) {
            bestD = Math.abs(a1 - s1.x);
            best1 = a1;
          }
        }
        if (bestD < Infinity) {
          // refine to the exact floor contact between that sample and the current swing, so the
          // hem rests ON the ground continuously (sample-snapping flicked panels between limits)
          let lo = best1, hi = s1.x;
          for (let it = 0; it < 7; it++) {
            const mid = (lo + hi) * 0.5;
            if (this._hemY(LEN, s0.x, s0.z, mid, s1.z) >= COAT_FLOOR) lo = mid;
            else hi = mid;
          }
          // a small fix lands at once (the hem rests on the grass); a flip to the other side of
          // its range swings over in a few frames instead of one
          s1.x += clamp(lo - s1.x, -COAT_JUMP * dtk * 2, COAT_JUMP * dtk * 2);
        } else {
          // lying down: the sideways swing can point a side panel into the ground, so also try
          // the panel straightened sideways (z = 0)
          const aMin = COAT_A[0][0], aMax = COAT_A[0][1] + 1.3;
          let pa = s0.x, pb = s1.x, pz = 1, hiA = s0.x, hiB = s1.x, hiZ = 1, hiY = -Infinity;
          bestD = Infinity;
          for (let zk = 1; zk >= 0; zk--) {
            for (let k = 0; k <= 12; k++) {
              const a0 = aMin + ((aMax - aMin) * k) / 12;
              for (let m = 0; m <= 4; m++) {
                const a1 = b0 + ((b1 - b0) * m) / 4;
                const y = this._hemY(LEN, a0, s0.z * zk, a1, s1.z * zk);
                const dd = Math.abs(a0 - s0.x) + 0.5 * Math.abs(a1 - s1.x) + (1 - zk) * 0.6;
                if (y >= COAT_FLOOR && dd < bestD) {
                  bestD = dd;
                  pa = a0;
                  pb = a1;
                  pz = zk;
                }
                if (y > hiY) {
                  hiY = y;
                  hiA = a0;
                  hiB = a1;
                  hiZ = zk;
                }
              }
            }
          }
          const ok = bestD < Infinity;
          // the panel swings over to the clearing configuration quickly but never in one frame
          // (a lying body used to flip whole panels between their limits frame to frame)
          const J = COAT_JUMP * dtk;
          s0.x += clamp((ok ? pa : hiA) - s0.x, -J, J);
          s1.x += clamp((ok ? pb : hiB) - s1.x, -J, J);
          if ((ok ? pz : hiZ) === 0) {
            s0.z += clamp(-s0.z, -J, J);
            s1.z += clamp(-s1.z, -J, J);
            s0.vz = s1.vz = 0;
          }
          s0.vx = 0;
        }
        s1.vx = 0;
      }
      C.segs[0].rotation.set(s0.x, 0, s0.z);
      C.segs[1].rotation.set(s1.x, 0, s1.z);
      if (C.strips.length) {
        // the lower segment's world frame: origin _e0, rotation _q0
        _q0.copy(_qA).multiply(_qs.setFromEuler(_eul.set(s0.x, 0, s0.z, 'YXZ')));
        _e0.copy(C.segs[1].position).applyQuaternion(_q0).add(_pa);
        _q0.multiply(_qs.setFromEuler(_eul.set(s1.x, 0, s1.z, 'YXZ')));
        this._strips(C, this.stripState[i], this.coatVel[i], steps, h, still);
      }
    }
    this.coatInit = true;
  }

  /** Torn strips of one panel. _q0 / _e0 = the lower segment's world rotation / origin. Each strip
   *  springs toward gravity + an outward claw flare − the panel's velocity (it streams back),
   *  plus its own flutter (faster and wider with speed), and never dips into the ground. */
  _strips(C, st, vel, steps, h, still) {
    const sp = Math.hypot(vel.x, vel.z);
    const flut = Math.min(1.4, sp / 5);
    const lag = STRIP_LAG * (1 + 0.2 * sp);
    _qInv2.copy(_q0).invert();
    for (let k = 0; k < C.strips.length; k++) {
      const S = C.strips[k], c = st[k];
      const ca = Math.cos(S.rest), sa = Math.sin(S.rest);
      _w.set(sa, 0, ca).applyQuaternion(_q0); // this strip's outward, world
      const ph = this.time * (2.6 + 4.6 * Math.min(1, flut)) + S.phase;
      const up = this.updraft;
      const fl = STRIP_FLARE + (0.08 + 0.25 * flut + 0.18 * up) * Math.sin(ph) + 0.12 * still * Math.sin(this.time * 2.618 + S.phase) + UPDRAFT_STRIP * up;
      _v.set(_w.x * fl - vel.x * lag, -1 - vel.y * lag * 0.5, _w.z * fl - vel.z * lag).normalize().applyQuaternion(_qInv2);
      const lx = _v.x * ca - _v.z * sa, lz = _v.x * sa + _v.z * ca; // into the strip's rest frame
      const tA = clamp(Math.atan2(-lz, -_v.y), STRIP_A[0], STRIP_A[1]);
      const tB = clamp(Math.asin(clamp(lx, -1, 1)) + 0.25 * flut * Math.sin(ph * 1.3 + 1.1), -STRIP_B, STRIP_B);
      for (let n = 0; n < steps; n++) {
        c.vx += (STRIP_K * (tA - c.x) - STRIP_C * c.vx) * h;
        c.vz += (STRIP_K * (tB - c.z) - STRIP_C * c.vz) * h;
        c.x += c.vx * h;
        c.z += c.vz * h;
      }
      if (!Number.isFinite(c.x + c.z + c.vx + c.vz) || h === 0) {
        c.x = tA;
        c.z = tB;
        c.vx = c.vz = 0;
      }
      c.x = clamp(c.x, STRIP_A[0], STRIP_A[1]);
      c.z = clamp(c.z, -STRIP_B, STRIP_B);
      // ground: swing the strip until its tip clears the grass
      const rootY = _S.copy(S.joint.position).applyQuaternion(_q0).add(_e0).y;
      if (this._stripTipY(S, c.x, c.z, rootY) < STRIP_FLOOR) {
        // the nearest swing (either way, up to straight up off a coat lying on the grass) whose
        // tip clears; failing that, the highest, also trying the strip straightened sideways
        let best = c.x, bestZ = c.z, hiY = -Infinity;
        for (let zz = 0; zz < 2 && hiY < STRIP_FLOOR; zz++) {
          const bz = zz ? 0 : c.z;
          for (let m = 1; m <= 16; m++) {
            for (let g = -1; g <= 1; g += 2) {
              const a = clamp(c.x + g * m * 0.2, -Math.PI, Math.PI);
              const y = this._stripTipY(S, a, bz, rootY);
              if (y > hiY) {
                hiY = y;
                best = a;
                bestZ = bz;
              }
            }
            if (hiY >= STRIP_FLOOR) break;
          }
        }
        c.x = best;
        c.z = bestZ;
        c.vx = 0;
      }
      S.joint.rotation.set(c.x, S.rest, c.z);
    }
  }

  /** World height of a strip tip for swing angles (a, b), given its root height. Uses _q0. */
  _stripTipY(S, a, b, rootY) {
    _qs.copy(_q0).multiply(_qB.setFromEuler(_eul.set(a, S.rest, b, 'YXZ')));
    return rootY + _T.set(0, -S.len, 0).applyQuaternion(_qs).y;
  }

  /** Sleeve streamers: two-segment springs hung on the arms. They hang down and out ~20° at rest,
   *  stream back almost horizontally when running and whip around in dodges. */
  _streamers(dt) {
    const r = this.rig;
    if (!r.streamers) return;
    const steps = dt > 0 ? Math.min(6, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
    r.chest.getWorldPosition(_G);
    this._colliders(r);
    // his right (world, horizontal): the sword side the charge's updraft lifts the cloak from
    r.root.getWorldQuaternion(_q2);
    _d.set(-1, 0, 0).applyQuaternion(_q2);
    // how far the torso is from upright (0 standing … 1 at 70° or more)
    const tumble = smoothstep(0.75, 0.3, _e.set(0, 1, 0).applyQuaternion(r.chest.getWorldQuaternion(_q1)).y);
    const lying = tumble >= 1 && LYING_KEYS.has(this.key);
    // the calm (clothCalm.js): his body's own travel, the part of a sheet's speed it keeps whole
    const calm = clothMode() === 'calm';
    r.root.getWorldPosition(_cR);
    if (this.streamInit && dt > 1e-4) {
      _cV.subVectors(_cR, this.clothRoot).divideScalar(dt);
      if (_cV.lengthSq() > 900) _cV.setLength(30);
      this.clothVel.copy(_cV);
    } else this.clothVel.set(0, 0, 0);
    this.clothRoot.copy(_cR);
    if (calm) r.chest.getWorldQuaternion(_cC);
    for (let i = 0; i < r.streamers.length; i++) {
      const S = r.streamers[i], st = this.streamState[i];
      const j0 = S.segs[0];
      const calmS = calm && !!S.calm;
      if (S.arm && st.rest) {
        // a sheet on an arm: carried by the chest as the arm lifts off hanging (the build's turn on the arm,
        // laid on the chest as the upper arm is laid in the bind pose: hanging straight under the shoulder)
        const base = j0.parent, arm = base.parent;
        let k = 0;
        if (calmS && arm) {
          arm.getWorldQuaternion(_cA);
          const c = _cD.set(0, -1, 0).applyQuaternion(_cA).dot(_cE.set(0, -1, 0).applyQuaternion(_cC));
          k = CLOTH.hold * smoothstep(CLOTH.lift[0], CLOTH.lift[1], Math.acos(clamp(c, -1, 1)));
        }
        if (k > 1e-4) {
          _cS.copy(_cA).multiply(st.rest);
          _cT.copy(_cC).multiply(st.rest);
          _cS.slerp(_cT, k);
          base.quaternion.copy(_cA.invert()).multiply(_cS);
        } else base.quaternion.copy(st.rest);
      }
      j0.parent.getWorldQuaternion(_q0); // also refreshes the arm's matrixWorld
      _w.copy(j0.position).applyMatrix4(j0.parent.matrixWorld);
      if (this.streamInit && dt > 1e-4) {
        _v.subVectors(_w, st.prev).divideScalar(dt);
        if (_v.lengthSq() > 900) _v.setLength(30);
        if (calmS && !(tumble > 0)) {
          // the whip of the arms and the chest's turn kept under its bound; his travel whole (not tumbling: a
          // roll's or a fall's turn of the body is the cloth's to follow, a ribbon's floor bound counts on it)
          _v.sub(this.clothVel);
          const rm = CLOTH.rel[S.arm ? 1 : 0];
          if (_v.lengthSq() > rm * rm) _v.setLength(rm);
          _v.add(this.clothVel);
        }
        st.vel.lerp(_v, 1 - Math.exp(-12 * dt));
      }
      st.prev.copy(_w);
      const vel = st.vel;
      const sp = Math.hypot(vel.x, vel.z);
      // outward from the chest, horizontal
      let ox = _w.x - _G.x, oz = _w.z - _G.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      const ph = this.time * (3 + 5 * Math.min(1, sp / 5)) + i * 2.1;
      // a ribbon's own outward flare (model.js: the cape), lifted by a charge most on the sword side
      const right = Math.max(0, ox * _d.x + oz * _d.z);
      // … and its own billow (`breeze`: [extra out, rate]; a streamer without it is untouched): a slow
      // swell of the flare while the wearer is near still, gone at a run (Halcyon's cape hovering)
      const bz = S.breeze;
      const bw = bz ? 1 - Math.min(1, sp / 4) : 0;
      const so = (S.out ?? STREAM_OUT) + this.updraft * UPDRAFT_STREAM[0] * lerp(UPDRAFT_STREAM[1], 1, right) + (bz ? bz[0] * bw * (0.5 + 0.5 * Math.sin(this.time * bz[1] + i * 1.3)) : 0);
      // a sheet's own weight: `lag` < 1 trails less (the heavy cloak hangs ~40° back at a run, where
      // a light ribbon streams out level)
      const lg = S.lag ?? 1;
      // … and its own swing limit: `max` rad from hanging (a ribbon may whip up past level, 2.6;
      // the cloak stops near level, so a whirl or a lunge never stands a sheet up over his head)
      const mA = calmS && S.arm ? Math.min(S.max ?? STREAM_A, CLOTH.armMax) : S.max ?? STREAM_A;
      _so.copy(_w); // this segment's root (world)
      // `floor`: rolling or falling (not lying: _layFlat), the segments' ends stay over the grass. In
      // drawn metres (the root's world scale: the hero is drawn larger than his model)
      const fl = !!S.floor && tumble > 0 && !lying;
      const ws = fl ? _cf.setFromMatrixColumn(j0.parent.matrixWorld, 1).length() : 1;
      if (fl) _sf.copy(_w);
      for (let s = 0; s < 2; s++) {
        const c = st.segs[s], j = S.segs[s];
        const lag = STREAM_LAG[s] * lg * (1 + 0.08 * sp);
        const wob = (0.08 + 0.12 * Math.min(1, sp / 4) + 0.1 * bw) * Math.sin(ph + s * 1.4);
        _v.set(ox * so - vel.x * lag - oz * wob, -1 - vel.y * lag * 0.5 + Math.abs(wob) * 0.5, oz * so - vel.z * lag + ox * wob);
        _v.normalize().applyQuaternion(_qInv2.copy(_q0).invert());
        if (tumble > 0) {
          // tumbling (a roll, a fall, lying down): the cloth stays wrapped along the body instead of
          // reaching for the world's down, which stood every sheet out like a spine
          _v.x *= 1 - tumble;
          _v.y += (-1 - _v.y) * tumble;
          _v.z += (0.25 * so - _v.z) * tumble;
          _v.normalize();
        }
        // the steel and the arms hold the sheet out (or in): the swing allowed, in [−mA, mA]
        this._sheetBound(S, st, s, c.x, mA);
        // how far a segment may swing IN toward its wearer (rad, + = in; the streamer's `inMax` [root,
        // tip]: a head ribbon, a scarf off the back, a sleeve wing off the arm; a negative value keeps
        // it at least that far OUT). Default its max. Not lying (ADR-083: there gravity rules it)
        // (no `inMax`: the bound as it was, exactly; COL_BND is float32, so min(…, mA) would move it)
        const im = lying ? undefined : S.inMax?.[s];
        const hi = im === undefined ? COL_BND[1] : Math.min(COL_BND[1], im), lo = im === undefined ? COL_BND[0] : Math.min(COL_BND[0], hi);
        let tA = Math.min(Math.max(clamp(Math.atan2(-_v.z, -_v.y), -mA, mA), lo), hi);
        // lying on the ground (knocked down, dead) a sheet obeys gravity (ADR-083): "wrapped along
        // the body" stood a sleeve's sheet up in the air with an upper arm that pointed up
        if (lying) tA = this._layFlat(tA, S.len[s], mA);
        else if (fl) tA = this._offFloor(tA, S.len[s] * ws, lo, hi);
        const tB = clamp(Math.asin(clamp(_v.x, -1, 1)), -STREAM_B, STREAM_B);
        const K = STREAM_K[s], Cd = STREAM_C[s];
        for (let n = 0; n < steps; n++) {
          c.vx += (K * (tA - c.x) - Cd * c.vx) * h;
          c.vz += (K * (tB - c.z) - Cd * c.vz) * h;
          c.x += c.vx * h;
          c.z += c.vz * h;
        }
        if (!Number.isFinite(c.x + c.z + c.vx + c.vz) || h === 0) {
          c.x = tA;
          c.z = tB;
          c.vx = c.vz = 0;
        }
        c.x = clamp(c.x, -mA, mA);
        // (a calm sheet, clothCalm.js `push`: eased onto a bound that jumps, the steel crossing it, at most that
        // fast; set onto it at once, the drape snapped 0.7 rad in a frame as a backhand's blade went by)
        const pm = calmS ? CLOTH.push * dt : Infinity;
        if (c.x > hi) {
          c.x = Math.max(hi, c.x - pm);
          if (c.vx > 0) c.vx = 0;
        } else if (c.x < lo) {
          c.x = Math.min(lo, c.x + pm);
          if (c.vx < 0) c.vx = 0;
        }
        // the grass pushes a lagging end back out (the target clears it): toward the least swing that
        // clears it, at most STREAM_PUSH rad/s, so the cloth is eased off the grass, never popped
        if (fl) {
          const L = S.len[s] * ws, y = this._floorY(c.x, L);
          if (y < STREAM_FLOOR && this._floorY(tA, L) > y) {
            let a = c.x, b = tA;
            for (let k = 0; k < 8; k++) {
              const mid = 0.5 * (a + b);
              if (this._floorY(mid, L) >= STREAM_FLOOR) b = mid;
              else a = mid;
            }
            const push = clamp(b - c.x, -STREAM_PUSH * dt, STREAM_PUSH * dt);
            c.x += push;
            if (c.vx * push < 0) c.vx = 0; // no swing left driving it back into the grass
          }
        }
        c.z = clamp(c.z, -STREAM_B, STREAM_B);
        j.rotation.set(c.x, 0, c.z);
        _q0.multiply(_qs.setFromEuler(_eul.set(c.x, 0, c.z, 'YXZ')));
        _so.add(_cq.set(0, -S.len[s], 0).applyQuaternion(_q0)); // the next segment's root
        if (fl) _sf.add(_cf.set(0, -S.len[s] * ws, 0).applyQuaternion(_q0));
      }
    }
    this.streamInit = true;
  }

  /** World height of the end of a `floor` streamer's segment `L` (drawn m) long swung `x`: its frame
   *  before its own turn is _q0, its root _sf. */
  _floorY(x, L) {
    const yy = _cf.set(0, 1, 0).applyQuaternion(_q0).y, zy = _cf.set(0, 0, 1).applyQuaternion(_q0).y;
    return _sf.y - L * (Math.cos(x) * yy + Math.sin(x) * zy);
  }

  /** A `floor` streamer's swing target off the grass: `a` if its end clears STREAM_FLOOR, else the
   *  swing nearest `a` within [lo, hi] that clears it, failing that the one that puts the end highest. */
  _offFloor(a, L, lo, hi) {
    if (this._floorY(a, L) >= STREAM_FLOOR) return a;
    let best = a, bd = Infinity, top = a, ty = -Infinity;
    for (let i = 0; i <= 32; i++) {
      const x = lo + ((hi - lo) * i) / 32, y = this._floorY(x, L);
      if (y >= STREAM_FLOOR && Math.abs(x - a) < bd) {
        bd = Math.abs(x - a);
        best = x;
      }
      if (y > ty) {
        ty = y;
        top = x;
      }
    }
    return bd < Infinity ? best : top;
  }

  /** Lying on the ground a sheet obeys gravity: the swing nearest `a` (within ±mA) whose far end is
   *  no higher than its root (+ 3 cm) and not under the grass; failing both, the one nearest to
   *  that. The segment's frame before its own turn is _q0, its root _so (world). */
  _layFlat(a, L, mA) {
    const yy = _cq.set(0, 1, 0).applyQuaternion(_q0).y, zy = _cq.set(0, 0, 1).applyQuaternion(_q0).y;
    const top = _so.y + 0.03;
    const off = (x) => {
      const t = _so.y - L * (Math.cos(x) * yy + Math.sin(x) * zy);
      return Math.max(t - top, 0.02 - t, 0);
    };
    if (off(a) === 0) return a;
    let best = a, bd = Infinity, least = a, le = Infinity;
    for (let i = 0; i <= 32; i++) {
      const x = -mA + (2 * mA * i) / 32, e = off(x);
      if (e === 0 && Math.abs(x - a) < bd) {
        bd = Math.abs(x - a);
        best = x;
      }
      if (e < le) {
        le = e;
        least = x;
      }
    }
    return bd < Infinity ? best : least;
  }

  /** The collision spheres along the blade and both arms (COL_*), world space, this frame's pose. */
  _colliders(r) {
    r.arms.R.upper.updateMatrixWorld(true);
    r.arms.L.upper.updateMatrixWorld(true);
    r.sword.updateMatrixWorld();
    let n = 0;
    for (const [z, rad] of COL_BLADE) {
      COL_P[n].set(0, 0, z).applyMatrix4(r.sword.matrixWorld);
      COL_R[n] = rad;
      COL_ARM[n++] = 0;
    }
    for (let a = 1; a <= 2; a++) {
      const arm = a === 1 ? r.arms.R : r.arms.L;
      for (const [y, rad] of COL_FORE) {
        COL_P[n].set(0, y, 0).applyMatrix4(arm.fore.matrixWorld);
        COL_R[n] = rad;
        COL_ARM[n++] = a;
      }
      for (const [y, rad] of COL_UPPER) {
        COL_P[n].set(0, y, 0).applyMatrix4(arm.upper.matrixWorld);
        COL_R[n] = rad;
        COL_ARM[n++] = a;
      }
    }
  }

  /** The swing range (rad about the segment's X; − = out) streamer S's segment s may take, whose
   *  root is _so and whose frame (before its own turn) is _q0, into COL_BND [least, most]: every
   *  collision sphere within the sheet's width and length stays on the side it came in from, by its
   *  radius (st.side remembers it; the inside wins a conflict). `cx` = the segment's swing now. */
  _sheetBound(S, st, s, cx, mA) {
    _qS.copy(_q0).invert();
    const L = S.len[s];
    const w = S.w;
    const hw = w ? 0.25 * (w[Math.min(s, w.length - 1)] + w[Math.min(s + 1, w.length - 1)]) : 0.15;
    const own = S.arm ?? 0;
    let lo = -mA, hi = mA;
    for (let k = 0; k < COL_N; k++) {
      const si = s * COL_N + k;
      if (own && COL_ARM[k] === own) continue;
      _cq.copy(COL_P[k]).sub(_so).applyQuaternion(_qS);
      const R = COL_R[k], d = Math.hypot(_cq.y, _cq.z);
      if (_cq.y > -0.02 || d > L + R || Math.abs(_cq.x) > hw + R) {
        st.side[si] = 0; // away from this sheet
        continue;
      }
      const aq = Math.atan2(-_cq.z, -_cq.y);
      if (st.side[si] === 0) st.side[si] = aq >= cx ? 1 : -1;
      const m = Math.min(1.2, (R + 0.015) / Math.max(0.08, d));
      if (st.side[si] > 0) hi = Math.min(hi, aq - m);
      else lo = Math.max(lo, aq + m);
    }
    hi = Math.max(-mA, hi);
    COL_BND[0] = Math.min(lo, hi);
    COL_BND[1] = hi;
  }

  /** Hair: each cluster rotates (small rotation vector) so its tips trail the motion of the tips
   *  themselves (head turns included) and sag with tilts; stiff springs, like spiky anime hair. */
  _hair(dt) {
    const r = this.rig;
    const steps = dt > 0 ? Math.min(6, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
    const still = 1 - clamp(this.speed / 2.5, 0, 1);
    r.head.getWorldQuaternion(_q1);
    _qInv.copy(_q1).invert();
    _g.set(0, -1, 0).applyQuaternion(_qInv); // gravity in head space
    // the living world's wind at the hero (world/life/wind.js), in head space: it blows the locks as his
    // own motion does. With the piece off (or no living world) it is zero: today's hair exactly
    _hw.set(0, 0, 0);
    const life = this.player?.game?.world?.life;
    const pp = this.player?.position;
    if (pp && life?.on?.('wind')) {
      const a = life.wind?.at?.(pp.x, pp.z, _hwRec);
      if (a && Number.isFinite(a.x + a.z)) _hw.set(a.x * HAIR_WIND, 0, a.z * HAIR_WIND).applyQuaternion(_qInv);
    }
    for (let i = 0; i < HAIR_CLUSTERS.length; i++) {
      const C = HAIR_CLUSTERS[i], S = this.hairState[i], j = r.hair[C.name];
      if (!j) continue;
      _w.set(C.pivot[0] + C.tip[0] * 0.12, C.pivot[1] + C.tip[1] * 0.12, C.pivot[2] + C.tip[2] * 0.12);
      _w.applyMatrix4(r.head.matrixWorld);
      if (this.hairInit && dt > 1e-4) {
        _v.subVectors(_w, S.prev).divideScalar(dt);
        if (_v.lengthSq() > 900) _v.setLength(30);
        S.vel.lerp(_v, 1 - Math.exp(-16 * dt));
      }
      S.prev.copy(_w);
      _v.copy(S.vel).applyQuaternion(_qInv);
      _d.set(C.tip[0], C.tip[1], C.tip[2]).normalize();
      // desired tip displacement: against the motion + sag relative to upright. The along-ground
      // drag blows the locks back ~20° at the sprint (the sheet's), ~13° at the run
      const wx = -_v.x * HAIR_DRAG + _g.x * 0.25 + _hw.x;
      const wy = -_v.y * 0.03 + (_g.y + 1) * 0.25 + UPDRAFT_HAIR * this.updraft + _hw.y;
      const wz = -_v.z * HAIR_DRAG + _g.z * 0.25 + _hw.z;
      // rotation vector moving the tip by w: d × w
      _axis.set(_d.y * wz - _d.z * wy, _d.z * wx - _d.x * wz, _d.x * wy - _d.y * wx);
      // a breeze through the locks (stronger standing still): two slow sways per cluster
      const bz = 0.012 + 0.03 * still;
      _axis.x += (Math.sin(this.time * 1.3 + i * 2.1) + 0.5 * Math.sin(this.time * 3.1 + i * 1.3)) * bz;
      _axis.z += Math.sin(this.time * 1.7 + i * 0.9) * bz * 0.6;
      const al = _axis.length();
      if (al > HAIR_MAX) _axis.multiplyScalar(HAIR_MAX / al);
      for (let k = 0; k < steps; k++) {
        S.v.x += (HAIR_K * (_axis.x - S.r.x) - HAIR_C * S.v.x) * h;
        S.v.y += (HAIR_K * (_axis.y - S.r.y) - HAIR_C * S.v.y) * h;
        S.v.z += (HAIR_K * (_axis.z - S.r.z) - HAIR_C * S.v.z) * h;
        S.r.addScaledVector(S.v, h);
      }
      if (!Number.isFinite(S.r.x + S.r.y + S.r.z + S.v.x + S.v.y + S.v.z)) {
        S.r.set(0, 0, 0);
        S.v.set(0, 0, 0);
      }
      const ang = S.r.length();
      if (ang > 1e-5) j.quaternion.setFromAxisAngle(_bv.copy(S.r).divideScalar(ang), Math.min(ang, HAIR_MAX * 1.2));
      else j.quaternion.identity();
    }
    this.hairInit = true;
  }
}
