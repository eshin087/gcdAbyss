import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, easeOutCubic, easeInOutSine, wrapAngle, TAU } from '../../core/math.js';
import { DIM, BODY, HAIR_CLUSTERS, HERO_SCALE, sheetOffset } from './model.js';
import { SWINGS } from './swings.js';

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
};
const N = 53;
const ENTRY_EASE = 0.85; // an easeOut cross-fade (attack entries) arrives at this fraction of its time
const TURN_LAG_MAX = 1.4; // rad: how far the drawn heading may trail the gameplay yaw in a fast turn
const TURN_K = 650; // stiffness (1/s²) of the critically damped spring the drawn heading follows
const ANGLES = [P.pitch, P.yaw, P.roll];
const ANK = DIM.ankle;
const LEG_IDX = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rK, P.rK + 1, P.rK + 2, P.lK, P.lK + 1, P.lK + 2, P.footFlat, P.rFy, P.lFy, P.rFf, P.lFf];
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const IDLE_LOOP = 2.4; // s (concept sheet: idle 2.4 s loop)

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
 *  fist. The free hand hangs relaxed at the left hip; the head is bowed a little, looking ahead.
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
  v3(p, P.lH, 0.07, -0.51, 0.03); // the free arm hangs relaxed beside the left hip
  v3(p, P.lP, 0.6, -0.1, -0.8);
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
 *  level. The sword arm trails the blade back and down beside the right leg (run) → nearly level
 *  behind (sprint); the free fist swings / pumps against the legs. Planted feet are held in the
 *  world by the foot planner (HeroAnimator._feet). */
export function loco(p, A) {
  guard(p, A);
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
  const amp = 0.09 * cs * mz, ws = A.swordW, bw = A.backW;
  to3(p, P.rH, lerp(lerp(-0.13, -0.15, s), -0.02, bw), lerp(lerp(-0.44, -0.37, s) + 0.02 * st, -0.38, bw), lerp(lerp(-0.08 + amp, -0.28 + amp * 0.6, s), 0.3, bw), ws);
  to3(p, P.rP, lerp(-0.75, -0.85, bw), lerp(lerp(-0.3, 0.2, s), -0.3, bw), lerp(-0.85, -0.5, bw), ws);
  dirLerp(SW_T, 0, lerp(-0.42, -0.36, s), lerp(-0.56, -0.2, s) - 0.03 * st * (1 - s), lerp(-0.71, -0.91, s), -0.15, -0.22, 1, bw);
  dirTo(p, P.swD, SW_T[0], SW_T[1], SW_T[2], ws);
  to3(p, P.swF, lerp(-0.3, 0, bw), 1, lerp(0, 0.2, bw), ws);
  // free arm swings opposite the legs: ahead of the belt (run) → a pumping fist chin ↔ hip (sprint)
  const k = 0.5 - 0.5 * cs * mz; // 1 = fist forward
  to3(p, P.lH, lerp(-0.02, -0.08, s) * k + 0.06 * (1 - k), lerp(lerp(-0.44, -0.3, k), lerp(-0.38, -0.04, k), s), lerp(lerp(-0.1, 0.24, k), lerp(-0.14, 0.32, k), s), w);
  to3(p, P.lP, 0.6, -0.6, -0.6, w);
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

/** Two-handed overhead slam (§4.8): blade elevation ang (π/2 = straight up, 0 = ahead, > π/2 =
 *  back over the head). The hands rise past the head to straight overhead while the wrists keep
 *  coiling, so at the apex the blade HANGS down the back with the torso arched and the head up;
 *  then everything folds hard over the impact, the blade into the ground ahead. */
const SLAM_E = [-0.9, 1.7]; // hand-circle limits (rad): knee height in front … straight overhead
// (ADR-044: at the apex the hands stopped straight overhead while the blade hung down the back,
// 147° between the forearm and the steel: no wrist bends that far. The hands now carry on past the
// top to BEHIND the head, on a tighter circle (the elbows fold up and forward), and on the way down
// they run SLAM_LEAD ahead of the blade: the arms pull first, the steel whips over after them.)
const SLAM_BACK = 2.45, SLAM_BACK_R = 0.3, SLAM_LEAD = 0.35;
function slamPose(p, A, ang, lunge) {
  stance(p, A, lunge);
  const e = clamp(ang, SLAM_E[0], SLAM_E[1]);
  const q = clamp((SLAM_E[1] - e) / (SLAM_E[1] - SLAM_E[0]), 0, 1); // 0 raised → 1 struck
  // the hands' own angle on their circle, and its radius
  const eh = clamp(ang - SLAM_LEAD * smoothstep(SLAM_E[0], SLAM_E[1], ang), SLAM_E[0], SLAM_BACK);
  const rh = lerp(0.5, SLAM_BACK_R, smoothstep(Math.PI / 2, SLAM_BACK, eh));
  const sE = Math.sin(eh), cE = Math.cos(eh);
  v3(p, P.rH, lerp(0.13, 0.17, q), rh * sE, rh * cE + 0.02);
  v3(p, P.rP, -0.9, 0.1, -0.4);
  v3(p, P.lP, 0.9, 0.1, -0.4);
  v3(p, P.swD, 0.02, Math.sin(ang), Math.cos(ang));
  v3(p, P.swF, 1, 0, 0);
  p[P.twoHand] = 1;
  const back = smoothstep(1.7, 3.7, ang); // how far the blade hangs behind: the back arches
  p[P.spX] = lerp(-0.05 - 0.22 * back, 0.78, q);
  p[P.spY] = -0.06;
  p[P.spZ] = 0;
  p[P.pelvY] = -0.08;
  p[P.hdX] = lerp(0.05 - 0.4 * back, 0.32, q);
  p[P.hdY] = 0.05;
  // knees stay bent (~150°) at the apex so the feet hold the 0.85 m stance the sheet shows
  p[P.bodyY] = lerp(-0.08, -0.22, q) - 0.04 * lunge;
  p[P.bodyZ] = lerp(-0.04, 0.1, q);
  v3(p, P.rF, -0.2, ANK, -0.42);
  v3(p, P.lF, 0.18, ANK, 0.42 + 0.12 * lunge);
  v3(p, P.rK, -0.45, 0, 1);
  v3(p, P.lK, 0.4, 0, 1);
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

// ---------------------------------------------------------------- windup paths
// Hand + point splines (shoulder-relative, body axes) from the entry pose to a clip's own pose,
// through two via keys: the slam's windup (below). The light swings have their own keys (swings.js).
const PATH_LEN = 1.17; // steel length used to place the point
const LP_H = [0, 0, 0, 0].map(() => new Float32Array(3)); // hand keys
const LP_T = [0, 0, 0, 0].map(() => new Float32Array(3)); // point keys
const LP_OUT = new Float32Array(6);
/** Catmull-Rom (non-uniform keys `ks`, zero end tangents) through key arrays K at u ∈ [0, 1] → o[off..]. */
function crPath(K, ks, u, o, off) {
  let j = 0;
  while (j < 2 && u > ks[j + 1]) j++;
  const t0 = ks[j], t1 = ks[j + 1], h = Math.max(1e-6, t1 - t0);
  const s = clamp((u - t0) / h, 0, 1), s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 0; c < 3; c++) {
    const m0 = j === 0 ? 0 : (K[j + 1][c] - K[j - 1][c]) / (ks[j + 1] - ks[j - 1]);
    const m1 = j === 2 ? 0 : (K[j + 2][c] - K[j][c]) / (ks[j + 2] - ks[j]);
    o[off + c] = h00 * K[j][c] + h10 * h * m0 + h01 * K[j + 1][c] + h11 * h * m1;
  }
}
/** Path keys 0 (the entry pose F) and 3 (the clip's own pose p) of the hand / point splines. */
function pathEnds(F, p, Ln) {
  const dl0 = Math.hypot(F[P.swD], F[P.swD + 1], F[P.swD + 2]) || 1;
  const dl3 = Math.hypot(p[P.swD], p[P.swD + 1], p[P.swD + 2]) || 1;
  for (let c = 0; c < 3; c++) {
    LP_H[0][c] = F[P.rH + c];
    LP_T[0][c] = F[P.rH + c] + (F[P.swD + c] / dl0) * Ln;
    LP_H[3][c] = p[P.rH + c];
    LP_T[3][c] = p[P.rH + c] + (p[P.swD + c] / dl3) * Ln;
  }
}
/** Hand + blade along the key splines (LP_H / LP_T, knots ks) at spline parameter u (the knots
 *  time the segments) → p's rH / swD. */
function bladePath(p, ks, u) {
  crPath(LP_H, ks, u, LP_OUT, 0);
  crPath(LP_T, ks, u, LP_OUT, 3);
  v3(p, P.rH, LP_OUT[0], LP_OUT[1], LP_OUT[2]);
  setLen(p, P.swD, LP_OUT[3] - LP_OUT[0], LP_OUT[4] - LP_OUT[1], LP_OUT[5] - LP_OUT[2], 1);
}
// ---------------------------------------------------------------- the slam's windup
// The combo finisher's windup was the clip's long cross-fade (0.34 s) from light 2's finish onto
// a raise straight up the middle: from behind (the game camera) the blade vanished behind the
// head for most of it, then popped out hanging down the back. It now has its own anticipation:
// GATHER (the body dips and coils right, both hands draw the blade down-back past the right hip:
// a spring loading), RAISE (the body rises onto it, the blade sweeps up the RIGHT side past the
// head, where the camera sees it), then over the top into the apex (the blade hanging down the
// back, torso arched). Arrives on the slam's own pose by SLAM_WU.T, so the apex and everything
// after it are untouched (blade bit-identical); the step in still comes from lungeFeet.
const SLAM_WU = {
  T: 0.36, // s (windup 0.4): from here the slam pose runs as before
  k: [0, 0.32, 0.7, 1], // knots: gather 0.115 s, raise 0.25 s, apex
  h1: [-0.13, -0.34, 0.08], d1: [-0.52, -0.42, -0.74], // gather: hands at the right hip, point down-back-right (clear of the right shin)
  h2: [-0.1, 0.12, 0.1], d2: [-0.38, 0.92, -0.08], // raise: hands by the right temple, blade up the right side
  // body keys at the gather / raise: [bodyY, spX, spY, pelvY, hdX, hdY, spZ]
  b1: [-0.2, 0.32, -0.34, -0.2, 0.12, 0.38, 0.06],
  b2: [-0.05, -0.08, -0.12, -0.1, -0.22, 0.14, 0.04],
};
const SLAM_BODY = [P.bodyY, P.spX, P.spY, P.pelvY, P.hdX, P.hdY, P.spZ];
const SLAM_CH = [P.rH, P.rH + 1, P.rH + 2, P.swD, P.swD + 1, P.swD + 2, P.twoHand, ...SLAM_BODY];
const SB_K = [0, 0, 0, 0].map(() => new Float32Array(1));
function slamWindup(p, A, t) {
  if (!(t < SLAM_WU.T)) return;
  const F = A.from, S = SLAM_WU, Ln = PATH_LEN;
  pathEnds(F, p, Ln);
  for (let c = 0; c < 3; c++) {
    LP_H[1][c] = S.h1[c];
    LP_T[1][c] = S.h1[c] + S.d1[c] * Ln;
    LP_H[2][c] = S.h2[c];
    LP_T[2][c] = S.h2[c] + S.d2[c] * Ln;
  }
  const u = t / S.T;
  bladePath(p, S.k, u);
  // the body follows the same knots (a scalar Catmull-Rom per channel)
  for (let j = 0; j < SLAM_BODY.length; j++) {
    const c = SLAM_BODY[j];
    SB_K[0][0] = F[c];
    SB_K[1][0] = S.b1[j];
    SB_K[2][0] = S.b2[j];
    SB_K[3][0] = p[c];
    crScalar(SB_K, S.k, u, p, c);
  }
  // the off hand joins the grip as the blade is drawn back
  p[P.twoHand] = lerp(F[P.twoHand], 1, smoothstep(0, 0.28, u));
  A.pathCh = SLAM_CH;
}
// s after the slam's active window before its settle starts: the frame just after the window is
// still hit-tested (the sweep runs from the last active one)
const SLAM_AFTER = 0.035;
/** crPath for one channel: keys K[i][0] → o[off]. */
function crScalar(K, ks, u, o, off) {
  let j = 0;
  while (j < 2 && u > ks[j + 1]) j++;
  const t0 = ks[j], t1 = ks[j + 1], h = Math.max(1e-6, t1 - t0);
  const s = clamp((u - t0) / h, 0, 1), s2 = s * s, s3 = s2 * s;
  const m0 = j === 0 ? 0 : (K[j + 1][0] - K[j - 1][0]) / (ks[j + 1] - ks[j - 1]);
  const m1 = j === 2 ? 0 : (K[j + 2][0] - K[j][0]) / (ks[j + 2] - ks[j]);
  o[off] = (2 * s3 - 3 * s2 + 1) * K[j][0] + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * K[j + 1][0] + (s3 - s2) * h * m1;
}

// ---------------------------------------------------------------- swing clips (swings.js)
// The hero's swings as keyframed clips: the sword hand and the blade follow splines through the
// clip's keys (so the point travels one smooth arc), the body's channels with them. A clip starts
// from the pose he was in (key 0 = the animator's `from`) and drives its channels itself (A.pathCh),
// so one cut runs into the next without the cross-fade flattening the arc.
const SW_SCAL = {
  bx: P.bodyX, by: P.bodyY, bz: P.bodyZ, hip: P.pelvY, hipX: P.pelvX, hipZ: P.pelvZ,
  sx: P.spX, sy: P.spY, sz: P.spZ, hx: P.hdX, hy: P.hdY, hz: P.hdZ, two: P.twoHand, offAt: P.offAt,
};
const SW_VEC = { h: P.rH, l: P.lH, rp: P.rP, lp: P.lP, f: P.swF };
const SW_DEG = Math.PI / 180;
const SW_ENTRY = 1.3; // the entry's tangent (× the straight rate): he leaves the last pose at speed
const SW_COIL = 0.35; // the blade's rate into the coil (× the straight rate) as it gets there
const SW_CLEAR = 0.24; // m: the sword hand's way to a coil stays this far from the spine (it bulges forward)
const SW_FLAT = [1.2, 3.2]; // rad per phase of blade turn: below, the keyed flat; above, the swing's plane
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
    const keys = def.keys.filter((k) => k && Number.isFinite(k.u) && k.u > 0).sort((a, b) => a.u - b.u);
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
      flat: Array.isArray(def.flat) ? def.flat : SW_UP,
      rF: def.rF ?? null, lF: def.lF ?? null, step: def.step ?? null, drag: def.drag ?? 0.22, home: def.home ?? 0.5,
    };
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
  const u = swingPhase(t, W, Ac, R);
  const F = A.from;
  for (const T of C.tracks) {
    for (let c = 0; c < T.n; c++) T.V[c] = F[T.ch + c];
    swingTrack(T, u, p, T.ch);
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
  A.pathCh = C.ch;
}

/** Lean the slam's plane `phi` rad toward his right, about the line ahead of him through the base
 *  of his neck: the blade, its flat and the grip turn with it and the chest bends to that side, so
 *  the blow comes down from over the right shoulder to the ground ahead and a little left. (Session
 *  25, owner: the cuts were "so perfectly top to bottom": in its upright plane the slam was drawn as
 *  one straight bar up the screen by the camera behind him.) */
function slamTilt(p, phi) {
  if (Math.abs(phi) < 1e-4) return;
  const c = Math.cos(phi), s = Math.sin(phi);
  for (const i of SLAM_TILT_CH) {
    const x = p[i], y = p[i + 1];
    p[i] = x * c - y * s;
    p[i + 1] = x * s + y * c;
  }
  // the grip is an offset from the sword shoulder, DIM.gripShoulder to the right of that line
  const gx = p[P.rH] - DIM.gripShoulder[0], gy = p[P.rH + 1];
  p[P.rH] = gx * c - gy * s + DIM.gripShoulder[0];
  p[P.rH + 1] = gx * s + gy * c;
  p[P.spZ] += 0.5 * phi;
  p[P.hdZ] -= 0.3 * phi;
}
const SLAM_TILT_CH = [P.swD, P.swF];

/** The slam (combat.js kind 'slam'): the windup raises the blade up past the head to hang down
 *  his back (its own path: slamWindup), the active frames crash it over the top into the ground
 *  ahead (a0 → a1), then the blow's weight settles before the follow-through. */
function slamSwing(p, A, k, t, W, Ac, R) {
  const dir = Math.sign(k.a1 - k.a0) || 1;
  const coil = k.a0 - dir * 0.12;
  let ang, lunge;
  if (t < W) {
    const v = t / W;
    // ready (blade low ahead) → up past the head → hanging down the back at the apex
    if (k.raise != null) ang = v < 0.5 ? lerp(k.ready ?? -0.86, k.raise, easeInOutSine(v / 0.5)) : lerp(k.raise, coil, easeOutCubic((v - 0.5) / 0.5));
    else ang = lerp(k.a0, coil, easeOutCubic(v));
    lunge = 0;
  } else if (t < W + Ac) {
    const v = (t - W) / Ac;
    // it builds and crashes down
    const e = v * v * (3 - v * 2) * (0.6 + 0.4 * v) + 0.4 * v * v * (1 - v);
    ang = lerp(coil, k.a1, clamp(e, 0, 1));
    lunge = e;
  } else {
    ang = lerp(k.a1, k.a2, easeOutCubic(clamp((t - W - Ac) / (R * 0.45), 0, 1)));
    lunge = 1;
  }
  slamPose(p, A, ang, lunge);
  if (t < W) slamWindup(p, A, t);
  // (the lean comes in as the blade rises: the gather at the hip is as it was)
  if (k.tilt) slamTilt(p, k.tilt * smoothstep(W * 0.45, W * 0.9, t));
  if (t > W + Ac + SLAM_AFTER) {
    // the blow's weight settles: the body sinks a little further over the planted blade and the
    // head bows, then the follow-through hold and rise take over (after the hit-tested frames)
    const s = smoothstep(W + Ac + SLAM_AFTER, W + Ac + 0.09, t) * (1 - smoothstep(W + Ac + 0.16, W + Ac + 0.3, t));
    p[P.bodyY] -= 0.05 * s;
    p[P.spX] += 0.06 * s;
    p[P.hdX] += 0.18 * s;
  }
}

/** The attack clip: a swings.js clip (the light chain, the sprint and roll cuts, the charged
 *  cleave), the slam, or the execution's thrust, then the footwork and the way home. A light attack
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
  else if (k.kind === 'clip') swingPose(p, A, k, t, W, Ac, R);
  else slamSwing(p, A, k, t, W, Ac, R);
  // footwork: the lunge is a real step (feet never skate with the root)
  if (k.kind === 'thrust') dashFeet(p, A, W);
  else if (k.feet === 'dash') dashFeet(p, A, k.dashW ? W : 0.04);
  else if (k.kind === 'slam') lungeFeet(p, A, W - 0.16, W + Ac * 0.5, 0.25, true);
  else {
    const C = swingClip(k.clip), st = C?.step;
    lungeFeet(p, A, st ? phaseTime(st[0], W, Ac, R) : 0.03, st ? phaseTime(st[1], W, Ac, R) : W + Ac * 0.45, C?.drag ?? 0.22, true);
  }
  if (k.spin) spinTurn(p, k.spin, t, W, Ac);
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
    p[P.rF + 1] += h * 0.7;
    p[P.lF + 1] += h * 0.7;
    p[P.footFlat] = lerp(p[P.footFlat], 0.4, clamp(h / k.hop, 0, 1));
  }
  const rec = (t - W - Ac) / R;
  const home = k.kind === 'clip' ? swingClip(k.clip)?.home ?? 0.5 : 0.45; // the fraction of the recovery the finish is held for
  if (rec > home) {
    // back toward the ready stance: the rear foot stays planted, the front foot draws back home in
    // a recovery step (the foot planner settles the rest), and the sword hand comes round in FRONT
    // of the chest (a straight blend of the shoulder offsets ran it through the torso)
    for (let j = 0; j < FOOT_CH.length; j++) FOOT_KEEP[j] = p[FOOT_CH[j]];
    guard(SCRATCH, A);
    const b = smoothstep(home, 1, rec);
    // a finish over his LEFT shoulder (light 1) comes home round the FRONT: the ready blade now
    // lies out to his right, and the short way there from the left-back runs behind his head and
    // through the sword arm's shoulder
    HOME_WAY.ok = p[P.swD] > 0;
    HOME_WAY.d = -3;
    blend(p, p, SCRATCH, b, HOME_WAY);
    for (let j = 0; j < FOOT_CH.length; j++) p[FOOT_CH[j]] = FOOT_KEEP[j];
    p[P.rH + 2] += 0.24 * Math.sin(Math.PI * b);
    const u = smoothstep(0.42, 0.9, rec); // home a beat before the blade crosses back in front of the legs
    p[P.lF] = lerp(p[P.lF], SCRATCH[P.lF], u);
    p[P.lF + 2] = lerp(p[P.lF + 2], SCRATCH[P.lF + 2], u);
    p[P.lF + 1] = lerp(p[P.lF + 1], ANK, u) + 0.07 * Math.sin(Math.PI * u);
    p[P.lFy] = lerp(p[P.lFy], SCRATCH[P.lFy], u);
  }
}
/** Turn the whole pose `yaw` rad about the root (+ = to his left), the foot spots with it. */
function pivotYaw(p, yaw) {
  if (Math.abs(yaw) < 1e-5) return;
  p[P.yaw] += yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let k = 0; k < 2; k++) {
    const i = k ? P.lF : P.rF, x = p[i], z = p[i + 2];
    p[i] = x * c + z * s;
    p[i + 2] = z * c - x * s;
  }
  p[P.rFy] += yaw;
  p[P.lFy] += yaw;
}
/** The whirl (combo hit 3, `anim.spin` ±1: − = he turns to his right): the whole body turns once
 *  about its axis from just before the active frames to their end, the feet carried round with it
 *  in two quick pivot steps (their stance spots turn with the body, each lifted in turn). The turn
 *  ends on exactly one revolution, written as 0, so nothing unwinds afterwards. */
function spinTurn(p, dir, t, W, Ac) {
  const t0 = W - 0.1, t1 = W + Ac;
  if (t <= t0 || t >= t1) return;
  const u = (t - t0) / (t1 - t0);
  // eased in, still fast at the end: the blade crosses the front at speed
  const e = u * u * (2.2 - 1.2 * u);
  const yaw = dir * TAU * e;
  p[P.yaw] += yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let k = 0; k < 2; k++) {
    const i = k ? P.lF : P.rF, x = p[i], z = p[i + 2];
    p[i] = x * c + z * s;
    p[i + 2] = z * c - x * s;
    // the right foot steps round first, then the left
    p[i + 1] += 0.07 * Math.max(0, Math.sin(Math.PI * clamp(k ? u * 2 - 1 : u * 2, 0, 1)));
  }
  p[P.rFy] += yaw;
  p[P.lFy] += yaw;
  p[P.rFf] = p[P.lFf] = 0.5; // on the balls of the feet through the turn
  p[P.bodyY] -= 0.03 * Math.sin(Math.PI * u);
}

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
 *  (Session 25, owner: "his legs and feet do the same thing every hit".) */
function lungeFeet(p, A, t0, t1, drag, plant) {
  const t = A.t, E = A.entry, tr = A.trav;
  // the stepping foot: the one further back along his facing (the left from the ready stance)
  const stepL = E[5] <= E[2];
  const sI = stepL ? P.lF : P.rF, hI = stepL ? P.rF : P.lF; // stepping / holding foot
  const sY = stepL ? P.lFy : P.rFy, hY = stepL ? P.rFy : P.lFy, hF = stepL ? P.rFf : P.lFf;
  const sE = stepL ? 3 : 0, hE = stepL ? 0 : 3, sYE = stepL ? 7 : 6, hYE = stepL ? 6 : 7;
  // the stance's spots: front for the stepping foot, rear for the holding one (each on its own side)
  const frontX = Math.abs(p[P.lF]), frontZ = p[P.lF + 2], rearX = Math.abs(p[P.rF]), rearZ = p[P.rF + 2];
  const frontYaw = stepL ? p[P.lFy] : -p[P.lFy], rearYaw = stepL ? p[P.rFy] : -p[P.rFy];
  const sg = stepL ? 1 : -1; // the stepping foot's side (+x = his left)
  // holding foot: planted, dragged once stretched; settles sideways onto the stance line
  const sx = -sg * rearX, sz = rearZ;
  let hz = E[hE + 2] - tr.z;
  if (hz < sz - drag) hz = sz - drag;
  const side = smoothstep(t0, t1 + 0.15, t);
  p[hI] = lerp(E[hE] - tr.x, sx, side);
  p[hI + 1] = lerp(Math.max(ANK, E[hE + 1]), ANK, smoothstep(0, 0.05, t));
  p[hI + 2] = lerp(hz, Math.max(hz, sz - drag), side);
  p[hY] = lerp(E[hYE], rearYaw, side);
  // its heel peels as the body passes over it and the hips turn (the toe pivots), settling after
  p[hF] = lerp(1, 0.3, smoothstep(t0 + 0.3 * (t1 - t0), t1, t) * (1 - smoothstep(t1 + 0.12, t1 + 0.3, t)));
  // stepping foot: held → the step → planted on its spot while the root carries on
  const m0 = A.mark(0, t0), m1 = A.mark(1, t1);
  const lx = E[sE] - (t < t0 ? tr.x : m0.x), lz = E[sE + 2] - (t < t0 ? tr.z : m0.z);
  const tx = sg * frontX, tz = frontZ;
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
  p[sI] = fx + sg * 0.04 * pass;
  p[sI + 1] = Math.max(ANK, lerp(E[sE + 1], ANK, e)) + (0.07 + 0.06 * clamp(Math.abs(tz - lz) / 0.6, 0, 1)) * Math.sin(Math.PI * u);
  p[sI + 2] = fz;
  p[sY] = lerp(E[sYE], frontYaw, e);
  p[stepL ? P.lFf : P.rFf] = lerp(1, 0.45, Math.sin(Math.PI * u)); // toe-off, the sole level again to land
}
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
  const k = clamp(A.releaseK, 0, 1);
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
const CHARGE_SW = [-140, 80, 74]; // the blade: azimuth, elevation at no charge … full (degrees)
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
  p[P.spX] = lerp(0.1, 0.26, s) + 0.07 * w;
  p[P.spZ] = 0;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.85; // eyes stay on the target
  p[P.hdX] = -0.1 * s;
  // (the hands and the blade are there at once: the clip's cross-fade carries them up from the
  // light swing's coil, where the blade already stands behind the right shoulder; easing them in
  // from the ready stance as well swung the steel up through the sword arm)
  v3(p, P.rH, -0.04, 0.06 + 0.02 * k, 0.11);
  v3(p, P.rP, -0.85, -0.5, -0.15);
  const az = CHARGE_SW[0] * SW_DEG, el = lerp(CHARGE_SW[1], CHARGE_SW[2], k) * SW_DEG;
  v3(p, P.swD, Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  v3(p, P.swF, 0.8, 0.3, -0.5);
  p[P.twoHand] = smoothstep(0.1, 0.7, s);
  v3(p, P.lP, 0.55, -0.8, 0.15);
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
  // a tap of the guard (a parry attempt) keeps the feet where they are; held, the stance settles
  // into the block's after ~0.2 s (each tap used to cost two settle steps in and two out again)
  const E = A.entry, fw = smoothstep(0.16, 0.4, A.t), BF = BLOCK_FEET;
  v3(p, P.rF, lerp(E[0], BF[0], fw), ANK, lerp(E[2], BF[1], fw));
  v3(p, P.lF, lerp(E[3], BF[2], fw), ANK, lerp(E[5], BF[3], fw));
  p[P.rFy] = lerp(E[6], -0.75, fw);
  p[P.lFy] = lerp(E[7], 0.1, fw);
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
  // the sword arm keeps what the legs are doing (the low ready guard standing, trailing walking):
  // swinging it forward-down for the drink only added two blade swings to a sip
  p[P.flask] = smoothstep(0.0, 0.1, t) * (1 - smoothstep(0.74, 0.85, t));
}

/** Flinch: snap back, arms thrown out, recover. */
function staggerPose(p, A) {
  const t = A.t;
  guard(p, A);
  const k = t < 0.08 ? easeOutCubic(t / 0.08) : 1 - smoothstep(0.08, 0.4, t);
  p[P.spX] = lerp(p[P.spX], -0.4, k);
  p[P.pitch] = -0.1 * k;
  p[P.hdX] = lerp(p[P.hdX], -0.4, k);
  p[P.bodyY] -= 0.07 * k;
  p[P.bodyZ] -= 0.08 * k;
  to3(p, P.rH, -0.25, -0.3, 0.3, k);
  to3(p, P.lH, 0.3, -0.25, 0.25, k);
  // the blow jolts the blade up and out from wherever the guard holds it (~40°): a fixed target
  // out to the right swung it ~110° across the legs and back with the low ready guard
  dirTo(p, P.swD, p[P.swD] - 0.45, p[P.swD + 1] + 0.5, p[P.swD + 2] + 0.25, k);
  p[P.lF + 2] -= 0.2 * k;
}

// knockdown: fall back (0–0.3), lie (–0.8), sit up, crouch, stand (–1.3)
const KD = {
  pitch: [0, 0, 0.3, -1.45, 0.8, -1.45, 1.0, -0.55, 1.14, 0.18, 1.3, 0],
  y: [0, -0.035, 0.3, -0.85, 0.8, -0.85, 1.0, -0.6, 1.14, -0.34, 1.3, -0.035],
  z: [0, 0, 0.3, -0.5, 0.8, -0.5, 1.0, -0.34, 1.14, -0.12, 1.3, 0],
  sp: [0, 0.1, 0.18, -0.3, 0.32, 0.05, 0.8, 0.05, 1.0, 0.55, 1.14, 0.45, 1.3, 0.1],
  hd: [0, -0.05, 0.2, -0.5, 0.36, 0.25, 0.8, 0.15, 1.0, 0.3, 1.3, -0.05],
  lie: [0.12, 0, 0.28, 1, 0.84, 1, 0.98, 0],
  sit: [0.84, 0, 0.98, 1, 1.14, 1, 1.3, 0],
  arms: [0.05, 0, 0.25, 1, 0.8, 1, 0.95, 0],
  push: [0.8, 0, 0.92, 1, 1.08, 1, 1.22, 0],
  blade: [0.05, 0, 0.22, 1, 1.12, 1, 1.3, 0], // held out at his right side until he is on his feet
};
function knockdownPose(p, A) {
  const t = A.t;
  guard(p, A);
  p[P.bodyX] = 0;
  p[P.pelvX] = 0;
  p[P.pelvY] = 0;
  p[P.pelvZ] = 0;
  p[P.spY] = 0;
  p[P.spZ] = 0;
  p[P.hdZ] = 0;
  p[P.pitch] = kf(t, KD.pitch);
  p[P.bodyY] = kf(t, KD.y) + 0.05 * Math.sin(Math.PI * clamp((t - 0.3) / 0.12, 0, 1)); // bounce
  p[P.bodyZ] = kf(t, KD.z);
  p[P.spX] = kf(t, KD.sp);
  p[P.hdX] = kf(t, KD.hd);
  const sit = kf(t, KD.sit);
  to3(p, P.rF, -0.16, ANK, 0.08, sit);
  to3(p, P.lF, 0.15, ANK, 0.18, sit);
  const lie = kf(t, KD.lie);
  bodyPointTo(p, P.rF, -0.12, -1.0, 0.04, lie); // legs laid out along the body
  bodyPointTo(p, P.lF, 0.12, -1.0, 0.08, lie);
  p[P.footFlat] = lerp(0.9, 0.1, lie);
  const arms = kf(t, KD.arms), push = kf(t, KD.push);
  to3(p, P.rH, -0.36, -0.15, -0.02, arms);
  to3(p, P.lH, 0.38, -0.15, 0.02, arms);
  // the sword stays out at his right side (clear of the legs that fold up under him) until he
  // stands, then comes back to the ready stance
  const bl = kf(t, KD.blade);
  dirTo(p, P.swD, -0.92, 0.0, -0.38, bl);
  to3(p, P.swF, 0, 1, 0, bl);
  to3(p, P.rH, -0.1, -0.48, -0.12, push); // hands push off the ground
  to3(p, P.lH, 0.1, -0.48, -0.12, push);
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
  bodyPointTo(p, P.lF, 0.12, -1.0, -0.04, flat);
  p[P.footFlat] = lerp(0.9, 0.1, flat);
  // face down: body +Z points into the ground, +Y toward the head
  const limp = kf(t, DEATH.limp);
  to3(p, P.rH, -0.45, 0.05, 0.1, limp);
  dirTo(p, P.swD, -0.55, 0.8, -0.05, limp); // sword dropped flat beside the head
  to3(p, P.swF, 0, 0, 1, limp);
  to3(p, P.lH, 0.32, -0.05, 0.12, limp);
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
const GUARD_CH = [P.rH, P.rH + 1, P.rH + 2, P.rP, P.rP + 1, P.rP + 2, P.lH, P.lH + 1, P.lH + 2, P.lP, P.lP + 1, P.lP + 2, P.swF, P.swF + 1, P.swF + 2, P.spX, P.spY, P.spZ, P.hdX, P.hdY, P.pelvY, P.twoHand, P.offAt];

/** The shared airborne base: every channel the plunge poses read, upright, arms down. */
function plBase(p, A) {
  guard(p, A);
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

/** Deflect: from the guard the blade snaps out into the blow (alternate sides through a chain:
 *  player.deflect.side), the chest rocks back with the pushback, and the guard is back by ~0.17 s
 *  so the next blow of the string can be met at once. Later deflects of a chain snap harder. */
function deflectPose(p, A) {
  blockPose(p, A);
  const t = A.t, D = A.player?.deflect;
  const n = fin(D?.n, 1), side = D?.side < 0 ? -1 : 1;
  const f = t < 0.045 ? easeOutCubic(t / 0.045) : 1 - smoothstep(0.06, 0.17, t);
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
  to3(p, P.swF, 0, 0.3, 1, f);
  to3(p, P.lH, side > 0 ? 0.22 : 0.3, -0.32, side > 0 ? 0.02 : -0.05, f);
  p[P.spX] -= 0.05 * f;
  // the rock back: the chest gives with the blow, the weight onto the back foot
  const push = t < 0.03 ? t / 0.03 : 1 - smoothstep(0.03, 0.22, t);
  p[P.spX] -= 0.12 * push * s;
  p[P.bodyZ] -= 0.05 * push;
  p[P.hdX] -= 0.08 * push;
}

/** Walking clips after a parry in rhythm: the upper body holds the block's guard (guardHold
 *  0..1, eased off ~0.6 s after the last parry) while the legs walk, so the blade stays up
 *  between taps instead of dropping to the low ready guard and back for every blow. */
function locoGuard(p, A) {
  loco(p, A);
  idleLife(p, A);
  const g = clamp(fin(A.player?.guardHold), 0, 1);
  if (g < 0.001) return;
  blockPose(SCR_GUARD, A);
  const ax = p[P.swD], ay = p[P.swD + 1], az = p[P.swD + 2];
  for (const i of GUARD_CH) p[i] += (SCR_GUARD[i] - p[i]) * g;
  dirLerp(p, P.swD, ax, ay, az, SCR_GUARD[P.swD], SCR_GUARD[P.swD + 1], SCR_GUARD[P.swD + 2], g);
}
// ============================================================ end PLUNGE + DEFLECT (plunge agent)

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
/** The current idle action's layer (A.fidget, timed in HeroAnimator._idleLife). */
function idleLife(p, A) {
  const F = A.fidget;
  if (!F || F.k < 0 || !(F.w > 0.001)) return;
  const D = FIDGETS[F.k];
  D.fn(p, A, clamp(F.t / D.dur, 0, 1), F.w);
}

const POSES = {
  loco: locoGuard,
  attack: attackPose,
  charge: chargePose,
  block: blockPose,
  parry: deflectPose,
  ghostep: ghostepPose,
  plunge: plungePose,
  guardBreak: guardBreakPose,
  roll: rollPose,
  backstep: backstepPose,
  heal: healPose,
  stagger: staggerPose,
  knockdown: knockdownPose,
  dead: deathPose,
};
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
const BLADE_PTS = Array.from({ length: 13 }, () => new THREE.Vector3()); // [0] = the grip
const _mC = new THREE.Matrix4();
// the steel in a panel's anchor frame (QA) and in its lower segment's parent frame (QB): x along the
// hips, y up, z out, from the segment's pivot; SEG = segLocal's output
const QA = new Float32Array(39), QB = new Float32Array(39), SEG = new Float32Array(3);
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
// soft reach: where the arm's reach starts to give / the most it opens, as fractions of its length
// (0.955: the elbow keeps ~35° at a full stretch)
const ARM_SOFT = [0.78, 0.955];
const ELBOW_RATE = 14; // rad/s: the most an elbow swings round its shoulder → hand line (~13° a frame)
const _eA = new THREE.Vector3(), _eW = new THREE.Vector3(), _eP = new THREE.Vector3(), _eC = new THREE.Vector3();
const TWO_HAND_GRIP = DIM.offGrip; // m down the grip from the sword hand to the off hand (two-handed)
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
const PAULDRON_FOLLOW = 0.35; // how much of the sword arm's swing the shoulder armour follows
// the charge's updraft (× A.updraft 0..1): extra outward flare of the coat panels and the
// torn strips (rad), and an upward pull on the hair tips (m of tip displacement)
const UPDRAFT_COAT = 0.3, UPDRAFT_STRIP = 0.35, UPDRAFT_HAIR = 0.12;
// hair blow-back: rad per m/s of the tips' own along-ground speed (head axes): ~20° at the sprint
const HAIR_DRAG = 0.06;

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
  /** player must expose: yaw, state, stateT, animT, atk ({def}), groundVel {x, z}, chargeK,
   *  releaseK, recoil (+ position, kb, lockOn, guardHold). `poses` (optional): extra clips for this
   *  instance, key → fn(pose, animator), merged over the hero's (a key it shares replaces the hero's
   *  clip for this instance only: the Ash Disciple brings his own 'loco' and 'duel'). */
  constructor(rig, player, poses = null) {
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
    this.speed = 0;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
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
    this.entry = new Float32Array([-0.25, ANK, 0.15, 0.13, ANK, -0.03, -0.4, 0.22]);
    this.leanF = 0; // acceleration lean (rad), a critically damped spring on the smoothed acceleration
    this.leanFV = 0;
    this.leanS = 0;
    this.leanSV = 0;
    this.stepCool = 0;
    this.coatState = rig.coat.map(() => [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }]);
    this.coatSide = new Uint8Array(rig.coat.length).fill(1); // per panel: the steel 1 outside it, 2 under it
    this.stripState = rig.coat.map((C) => C.strips.map(() => ({ x: 0, vx: 0, z: 0, vz: 0 })));
    this.streamState = (rig.streamers ?? []).map(() => ({
      segs: [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }], prev: new THREE.Vector3(), vel: new THREE.Vector3(),
      side: new Int8Array(2 * COL_N), // per segment and collision sphere: 1 came from inside, −1 from outside, 0 away
    }));
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

  /** Start a clip, cross-fading from the current pose over `blend` seconds. */
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
    this.from.set(this.cur);
    for (const i of ANGLES) this.from[i] = wrapAngle(this.from[i]); // a finished roll is 2π ≡ 0
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
    this.blendDur = Math.max(1e-3, blend);
    this.easeOut = easeOut;
  }

  reset() {
    this.time = 0;
    this.t = 0;
    this.moveW = 0;
    this.sprintW = 0;
    this.swordW = 0;
    this.speed = 0;
    this.speedS = this.speedSV = 0;
    this.backW = 0;
    this.wantOK = false;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.mh = 0;
    this.def = null;
    this.chargeK = 0;
    this.releaseK = 0;
    this.recoil = 0;
    this.key = 'loco';
    this.accF = this.accS = this.bank = this.turnV = this.strafeYaw = this.turnLag = this.visYawV = 0;
    this.leanF = this.leanFV = this.leanS = this.leanSV = 0;
    this.updraft = 0;
    Object.assign(this.fidget, { k: -1, t: 0, w: 0, cut: false, still: 0, wait: IDLE_LIFE.after, name: '' });
    this.visYaw = fin(this.player.yaw);
    this.cycOn = false;
    this._pv.init = false;
    for (const F of this.feet) F.init = false;
    gaitParams(this.gait, 0, 0);
    guard(this.cur, this);
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
    if (sp > 0.2) this.backW = damp(this.backW, 1 - smoothstep(-0.75, -0.15, this.mz), 6, dt);
    this.sprintW = damp(this.sprintW, pl.state === 'sprint' ? 1 : 0, 6, dt);
    this.swordW = damp(this.swordW, this.moveW, 7, dt);
    // the charge's updraft (0..1): lifts the coat tails and the hair as the cleave charges
    this.updraft = damp(this.updraft, this.key === 'charge' ? clamp(fin(pl.chargeK), 0, 1) : 0, 5, dt);
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
    this._idleLife(dt, sp);
    this.poses[this.key](this.target, this);
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
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(this.cur[i])) {
        guard(this.cur, this); // never let a bad frame poison the rig
        this.from.set(this.cur);
        this.blendT = this.blendDur;
        for (const F of this.feet) F.init = false;
        break;
      }
    }
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
    const calm = this.key === 'loco' && pl.state === 'idle' && sp < 0.1 && this.moveW < 0.05 && !pl.lockOn && !(fin(pl.guardHold) > 0.001);
    if (this.key !== 'loco' && F.k >= 0) {
      // another clip took over (its cross-fade starts from this pose)
      F.k = -1;
      F.w = 0;
    }
    if (F.k >= 0) {
      const D = FIDGETS[F.k];
      F.t += dt;
      const env = smoothstep(0, IDLE_LIFE.fadeIn, F.t) * (1 - smoothstep(D.dur - IDLE_LIFE.fadeOut, D.dur, F.t));
      if (!calm) F.cut = true;
      F.w = F.cut ? Math.max(0, Math.min(env, F.w - dt / IDLE_LIFE.cancel)) : env;
      if (F.t >= D.dur || (F.cut && F.w <= 0)) {
        F.k = -1;
        F.w = 0;
        F.name = '';
        F.still = 0;
        F.wait = lerp(IDLE_LIFE.gap[0], IDLE_LIFE.gap[1], this.noise());
      }
      return;
    }
    if (!calm) {
      F.still = 0;
      F.wait = Math.max(F.wait, IDLE_LIFE.after);
      return;
    }
    F.still += dt;
    if (F.still < F.wait) return;
    let k = Math.min(FIDGETS.length - 1, Math.floor(this.noise() * FIDGETS.length));
    if (k === F.last) k = (k + 1 + Math.floor(this.noise() * (FIDGETS.length - 1))) % FIDGETS.length;
    F.k = F.last = k;
    F.t = 0;
    F.w = 0;
    F.cut = false;
    F.count++;
    F.name = FIDGETS[k].name;
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
      for (const F of this.feet) F.init = false;
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
    // off hand: its own target, or (twoHand) down the grip below the sword hand
    this._handTarget(r.arms.L, p, P.lH);
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
      // the free hand closes round the grip as it gets there
      const on = two > 0.6 && !(p[P.offAt] > 0.04); // (a palm braced on the blade stays open)
      r.offHand.open.visible = !on;
      r.offHand.grip.visible = on;
    }
    const f = clamp(p[P.flask], 0, 1);
    r.flask.visible = f > 0.03;
    r.flask.scale.setScalar(Math.max(0.01, f));
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

  _arm(arm, T, p, pi, holdsSword, lock = 0) {
    _S.copy(arm.upper.position);
    if (T !== _T) _T.copy(T);
    // soft reach (ADR-044): a target near or past the arm's length is reached with the elbow still
    // bent. The last fifth of the reach is compressed, so the arm never locks into a straight
    // stick, however far out a pose asks for the hand; `lock` 0..1 (the off hand on the grip)
    // gives the full reach back, so two hands still meet
    {
      const L = DIM.upperArm + DIM.foreArm, d0 = ARM_SOFT[0] * L;
      _v.subVectors(_T, _S);
      const d = _v.length();
      if (d > d0 && lock < 1) {
        const span = (ARM_SOFT[1] - ARM_SOFT[0]) * L;
        const d2 = d0 + span * (1 - Math.exp(-(d - d0) / span));
        _T.copy(_S).addScaledVector(_v, lerp(d2, d, lock) / d);
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
    const beta = solveTwoBone(_S, _T, _pole, DIM.upperArm, DIM.foreArm, 1, arm.upper.quaternion, _end);
    arm.fore.rotation.set(-beta, 0, 0);
    if (holdsSword) {
      // grip = the reached wrist point, re-expressed in body space
      this.rig.chest.localToWorld(_w.copy(_end));
      this.rig.body.worldToLocal(_w);
      this.rig.sword.position.copy(_w);
    }
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

  _leg(leg, p, fi, ki, yi, ffi) {
    const r = this.rig;
    _S.copy(leg.thigh.position);
    _T.set(p[fi], Math.max(FOOT_FLOOR, p[fi + 1]), p[fi + 2]); // model y == height above ground
    r.root.localToWorld(_T);
    r.pelvis.worldToLocal(_T);
    _pole.set(p[ki], p[ki + 1], p[ki + 2]).applyQuaternion(_qBP);
    const beta = solveTwoBone(_S, _T, _pole, DIM.thigh, DIM.shin, -1, leg.thigh.quaternion, _end);
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
    const n = BLADE_PTS.length, z0 = DIM.forte, z1 = DIM.drawnTip ?? DIM.steelTip;
    BLADE_PTS[0].set(0, 0, 0).applyMatrix4(_mC);
    for (let k = 1; k < n; k++) BLADE_PTS[k].set(0, 0, z0 + ((z1 - z0) * (k - 1)) / (n - 2)).applyMatrix4(_mC);
    const e = BLADE_PTS[n - 1];
    return Number.isFinite(e.x + e.y + e.z + BLADE_PTS[0].x) ? n : 0;
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
      const breeze = (BREEZE[i] ?? 0.03) + 0.1 * Math.sin(this.time * 2.618 + i * 1.3) * (0.5 + 0.5 * Math.sin(this.time * 0.9 + i));
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
        const fl = (D.flap ? 0.05 : D.flare ?? COAT_FLARE) + (breeze + (IDLE_FLARE[i] ?? 0) * (s ? 0.7 : 1)) * still + Math.sin(this.time * 9 + i * 1.7 + s * 1.3) * 0.07 * flut + UPDRAFT_COAT * this.updraft * (s ? 1.3 : 1);
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
            const m = k ? COAT_BLADE_R : COAT_HAND_R;
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
    for (let i = 0; i < r.streamers.length; i++) {
      const S = r.streamers[i], st = this.streamState[i];
      const j0 = S.segs[0];
      j0.parent.getWorldQuaternion(_q0); // also refreshes the arm's matrixWorld
      _w.copy(j0.position).applyMatrix4(j0.parent.matrixWorld);
      if (this.streamInit && dt > 1e-4) {
        _v.subVectors(_w, st.prev).divideScalar(dt);
        if (_v.lengthSq() > 900) _v.setLength(30);
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
      const so = (S.out ?? STREAM_OUT) + this.updraft * UPDRAFT_STREAM[0] * lerp(UPDRAFT_STREAM[1], 1, right);
      // a sheet's own weight: `lag` < 1 trails less (the heavy cloak hangs ~40° back at a run, where
      // a light ribbon streams out level)
      const lg = S.lag ?? 1;
      // … and its own swing limit: `max` rad from hanging (a ribbon may whip up past level, 2.6;
      // the cloak stops near level, so a whirl or a lunge never stands a sheet up over his head)
      const mA = S.max ?? STREAM_A;
      _so.copy(_w); // this segment's root (world)
      for (let s = 0; s < 2; s++) {
        const c = st.segs[s], j = S.segs[s];
        const lag = STREAM_LAG[s] * lg * (1 + 0.08 * sp);
        const wob = (0.08 + 0.12 * Math.min(1, sp / 4)) * Math.sin(ph + s * 1.4);
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
        const lo = COL_BND[0], hi = COL_BND[1];
        const tA = Math.min(Math.max(clamp(Math.atan2(-_v.z, -_v.y), -mA, mA), lo), hi);
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
        if (c.x > hi) {
          c.x = hi;
          if (c.vx > 0) c.vx = 0;
        } else if (c.x < lo) {
          c.x = lo;
          if (c.vx < 0) c.vx = 0;
        }
        c.z = clamp(c.z, -STREAM_B, STREAM_B);
        j.rotation.set(c.x, 0, c.z);
        _q0.multiply(_qs.setFromEuler(_eul.set(c.x, 0, c.z, 'YXZ')));
        _so.add(_cq.set(0, -S.len[s], 0).applyQuaternion(_q0)); // the next segment's root
      }
    }
    this.streamInit = true;
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
      const wx = -_v.x * HAIR_DRAG + _g.x * 0.25;
      const wy = -_v.y * 0.03 + (_g.y + 1) * 0.25 + UPDRAFT_HAIR * this.updraft;
      const wz = -_v.z * HAIR_DRAG + _g.z * 0.25;
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
