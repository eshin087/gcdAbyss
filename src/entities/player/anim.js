import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, easeOutCubic, easeInOutSine, wrapAngle, TAU } from '../../core/math.js';
import { DIM, HAIR_CLUSTERS, HERO_SCALE } from './model.js';

// Procedural animation for the Wanderer, keyed to the owner's concept sheets ("Movement" / "Combat
// key poses"). Every frame a target POSE (a flat Float32Array) is built for the current clip as a
// function of state time, cross-faded from a snapshot of the previous pose, then applied: FK for
// body/pelvis/spine/head, analytic two-bone IK for arms and legs (the off hand can join the grip:
// `twoHand`), the sword oriented directly in body space, a spring-chain coat (6 panels whose torn
// tails lag, flare and get kicked out by the knees) and spring hair clusters that trail motion.
//
// Pose spaces:
//   body space  — origin at the waist pivot, axes of the `body` joint (rolls and falls with it).
//   hand targets (rH/lH) are OFFSETS from each shoulder, in body axes (|offset| <= reach 0.55).
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
  twoHand: 45, // 0..1: the off hand joins the grip (slam)
  hdZ: 46, // head tilt (roll)
  pelvX: 47, // pelvis tuck / tilt (pitch)
  rFy: 48, lFy: 49, // foot yaw (toe-out) relative to the root
  rFf: 50, lFf: 51, // per-foot flat factor (× footFlat): heel peel / toe-off / swing
};
const N = 52;
const ENTRY_EASE = 0.85; // an easeOut cross-fade (attack entries) arrives at this fraction of its time
const TURN_LAG_MAX = 1.4; // rad: how far the drawn heading may trail the gameplay yaw in a fast turn
const TURN_K = 650; // stiffness (1/s²) of the critically damped spring the drawn heading follows
const ANGLES = [P.pitch, P.yaw, P.roll];
const ANK = DIM.ankle;
const LEG_IDX = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rK, P.rK + 1, P.rK + 2, P.lK, P.lK + 1, P.lK + 2, P.footFlat, P.rFy, P.lFy, P.rFf, P.lFf];
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const IDLE_LOOP = 2.4; // s (concept sheet: idle 2.4 s loop)

// ---------------------------------------------------------------- pose helpers
const v3 = (p, i, x, y, z) => {
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
};
/** Move p[i..i+2] toward (x,y,z) by t. */
const to3 = (p, i, x, y, z, t) => {
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
function dirLerp(out, i, ax, ay, az, bx, by, bz, t, mem = null) {
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
function kf(t, k) {
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
// space), def (attack data), chargeK (0..1), releaseK (charge of the thrust in flight), recoil.

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

/** Idle / ready stance (2.4 s loop), the owner's reference portrait: contrapposto — the weight on
 *  the straight LEFT leg planted under the body, the right leg relaxed, stepped out to the side and
 *  a little forward with the knee bent; the hips tilt up on the left, the shoulders counter-tilt.
 *  The sword hangs one-handed and LOW in the right hand at the right thigh, the blade pointing
 *  down-left across the front of the legs (down-right on screen) with the point just off the grass
 *  outside the left boot; the free hand hangs relaxed beside the left thigh; the head tips down and
 *  turns a little toward the blade. Breathing + a slow weight sway; no steps.
 *  The blade runs square across his front (out past the left boot, not toward the camera), so in
 *  the portrait's view it reads long and at the portrait's ~45-50° instead of foreshortened and
 *  steep; the grip sits forward of the hip so the steel clears the left knee. */
const IDLE_SW = [0.675, -0.737, 0.035]; // blade direction (body axes): ~47° below level, square to his left
function guard(p, A) {
  const ph = A.time * (TAU / IDLE_LOOP);
  const br = Math.sin(ph), sw = Math.sin(ph * 0.5 + 1.1); // breath, and a slower weight sway
  p[P.bodyX] = 0.045 + 0.01 * sw; // over the left (weight) foot
  p[P.bodyY] = -0.008 + 0.004 * br; // the weight leg nearly straight
  p[P.bodyZ] = -0.012; // over the weight foot, set a little back
  p[P.pitch] = 0;
  p[P.yaw] = 0;
  p[P.roll] = 0;
  p[P.pelvX] = 0;
  p[P.pelvY] = 0.12; // the right hip comes forward with the relaxed leg
  p[P.pelvZ] = 0.16 + 0.025 * sw; // the left hip rides up over the straight leg
  p[P.spX] = 0.06 + 0.01 * br;
  p[P.spY] = -0.04; // shoulders square to the view, the chest turned back a little from the hips
  p[P.spZ] = -0.17 - 0.03 * sw; // counter-tilt: the right shoulder rides higher
  p[P.hdX] = 0.2 - 0.04 * br;
  p[P.hdY] = 0.22;
  p[P.hdZ] = 0.07 + 0.015 * sw;
  v3(p, P.rH, -0.1, -0.505 + 0.006 * br, 0.15); // grip low and out at the right thigh, ahead of the hip
  v3(p, P.rP, -0.9, -0.1, -0.5); // the elbow out
  v3(p, P.lH, 0.11, -0.49, 0.03); // free hand hangs loose beside the left thigh
  v3(p, P.lP, 0.7, -0.1, -1);
  v3(p, P.swD, IDLE_SW[0] + 0.02 * br, IDLE_SW[1], IDLE_SW[2] + 0.02 * sw);
  v3(p, P.swF, 0.15, 0.15, 0.97); // the flat faces the viewer (front-left, the portrait's camera)
  v3(p, P.rF, -0.27, ANK, 0.2); // relaxed leg: out to the side and forward
  v3(p, P.lF, 0.12, ANK, -0.06); // weight leg: under the body, a little back
  v3(p, P.rK, -0.55, 0.1, 1);
  v3(p, P.lK, 0.25, 0, 1);
  p[P.footFlat] = 0.95;
  p[P.rFy] = -0.4; // toes turned out
  p[P.lFy] = 0.22;
  p[P.rFf] = 1;
  p[P.lFf] = 1;
  p[P.flask] = 0;
  p[P.twoHand] = 0;
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
function turnTwist(p, A) {
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
function loco(p, A) {
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
  const amp = 0.05 * cs * mz, ws = A.swordW, bw = A.backW;
  to3(p, P.rH, lerp(lerp(-0.02, -0.06, s), -0.02, bw), lerp(lerp(-0.49, -0.38, s) + 0.012 * st, -0.38, bw), lerp(lerp(-0.12 + amp, -0.3, s), 0.3, bw), ws);
  to3(p, P.rP, lerp(-0.6, -0.8, bw), lerp(lerp(-0.3, 0.2, s), -0.3, bw), lerp(-1, -0.5, bw), ws);
  dirLerp(SW_T, 0, lerp(-0.2, -0.14, s), lerp(-0.6, -0.22, s) - 0.03 * st * (1 - s), lerp(-0.77, -0.96, s), -0.15, -0.22, 1, bw);
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

/** Horizontal sweep with the blade at azimuth th (0 = ahead, + = the hero's left), pitch elev
 *  (§4.6): the hips and chest wind with it (twist −35° coiled, +55° at the strike), the eyes stay
 *  on the target; the sword hand travels round the body, low at the right hip in the coil, across
 *  the chest at the strike, up at the left shoulder on the rising finish. */
function slashH(p, A, th, elev, lunge) {
  stance(p, A, lunge);
  const s = Math.sin(th), c = Math.cos(th);
  const tw = clamp(th, -2.4, 2.3);
  p[P.pelvY] = tw * (tw < 0 ? 0.18 : 0.19);
  p[P.spY] = tw * (tw < 0 ? 0.26 : 0.36);
  p[P.spX] = 0.27 - 0.14 * Math.max(0, elev); // ≈15° lean through the coil and the strike
  p[P.spZ] = -0.06 * s;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.75; // eyes stay on the target
  p[P.hdX] = 0.02 - 0.2 * Math.max(0, elev);
  v3(p, P.rH, s * 0.42, -0.34 + elev * 0.55 + 0.14 * Math.max(0, s), c * 0.42 + 0.14);
  v3(p, P.rP, -0.3, -1, -0.45);
  v3(p, P.swD, s * Math.cos(elev), Math.sin(elev), c * Math.cos(elev));
  v3(p, P.swF, -s * Math.sin(elev), Math.cos(elev), -c * Math.sin(elev)); // the flat (and its glow) faces the sky
  // free arm: across the chest in the coil, pulled back to the hip, flung out behind at the strike
  const k = clamp((s + 1) * 0.5, 0, 1);
  v3(p, P.lH, lerp(-0.12, 0.2, k), lerp(-0.2, -0.32, k), lerp(0.22, -0.22, k));
  v3(p, P.lP, 0.9, -0.2, -0.5);
}

/** Two-handed overhead slam (§4.8): blade elevation ang (π/2 = straight up, 0 = ahead, > π/2 =
 *  back over the head). The hands rise past the head to straight overhead while the wrists keep
 *  coiling, so at the apex the blade HANGS down the back with the torso arched and the head up;
 *  then everything folds hard over the impact, the blade into the ground ahead. */
const SLAM_E = [-0.9, 1.7]; // hand-circle limits (rad): knee height in front … straight overhead
function slamPose(p, A, ang, lunge) {
  stance(p, A, lunge);
  const e = clamp(ang, SLAM_E[0], SLAM_E[1]);
  const q = clamp((SLAM_E[1] - e) / (SLAM_E[1] - SLAM_E[0]), 0, 1); // 0 raised → 1 struck
  const sE = Math.sin(e), cE = Math.cos(e);
  v3(p, P.rH, lerp(0.13, 0.17, q), 0.5 * sE, 0.5 * cE + 0.02);
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

/** Charge stance (also the thrust's start, §4.7): a deep wide crouch (feet ~0.95 m apart, hips at
 *  0.70 m, lean 30°, twisted −30° with the head up on the target), the sword held TWO-HANDED at
 *  the right hip, blade back-down-right with its point just off the grass ~1 m behind; sinks a
 *  little lower as it charges. k = charge 0..1, sink 0..1 = how far into the crouch. */
function chargeStance(p, A, k, sink) {
  stance(p, A, 0);
  p[P.bodyY] = lerp(-0.12, -0.19 - 0.04 * k, sink);
  p[P.pelvY] = -0.12 - 0.18 * sink;
  p[P.spY] = -0.34 * sink;
  p[P.spX] = 0.16 + (0.38 + 0.05 * k) * sink;
  p[P.spZ] = 0;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.85; // eyes stay on the target
  p[P.hdX] = 0.02 - 0.3 * sink;
  to3(p, P.rH, -0.02, -0.42, -0.28, 0.35 + 0.65 * sink);
  v3(p, P.rP, -0.5, -0.4, -0.6);
  dirTo(p, P.swD, -0.3, -0.55 - 0.08 * k, -0.78, 0.35 + 0.65 * sink);
  v3(p, P.swF, 0.4, 0.3, -0.3);
  p[P.twoHand] = smoothstep(0.1, 0.7, sink);
  v3(p, P.lP, 0.8, -0.4, -0.3);
  v3(p, P.rF, -0.17, ANK, -0.5);
  v3(p, P.lF, 0.17, ANK, 0.45);
  v3(p, P.rK, -0.5, 0, 1);
  v3(p, P.lK, 0.45, 0, 1);
}

/** The lunging thrust (charge release, §4.7 04–05): a launch at ~60° lean with the rear leg
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

// ---------------------------------------------------------------- light 1: the windup loop
// From the low ready guard (blade down-left across the legs) the cross-fade into light 1's coil
// swept the steel ~220° round the FRONT at knee height in 5 frames: a flick that read as a second,
// backward swing before the real one. Light 1 now cocks OVER THE RIGHT SHOULDER: the hand lifts
// the blade up in front of the right chest, the point swings up and back over the shoulder and
// drops into the coil at the right hip — a vertical loop that reads as the windup, in a different
// plane from the strike. Hand + point follow one Catmull-Rom path (shoulder-relative, body axes)
// from wherever the blade was to the coil, arriving at rest by LOOP.T; from then on the coil code
// runs untouched, so the blade is bit-identical from well before the first active frame (the frame
// before it is the hit sweep's start). Entries already behind-right (out of a run) take the direct
// way (L → 0: the via points collapse onto the straight path).
const LOOP = {
  T: 0.1, // s: arrival at the coil (light windup 0.14: two 30 fps frames of margin before it)
  k: [0, 0.38, 0.68, 1], // spline knots
  h1: [-0.05, -0.3, 0.17], d1: [-0.33, 0.82, 0.47], // hand up before the right ribs, point up (right, front)
  h2: [-0.15, -0.2, -0.08], d2: [-0.66, 0.4, -0.64], // hand at the shoulder, point up-back over it
  len: 1.17, // steel length used to place the point
};
const LP_H = [0, 0, 0, 0].map(() => new Float32Array(3)); // hand keys
const LP_T = [0, 0, 0, 0].map(() => new Float32Array(3)); // point keys
const LP_OUT = new Float32Array(6);
const LP_N = 24;
const LP_S = new Float32Array(LP_N + 1); // cumulative point-path length at u = i / LP_N
// the twist into the coil waits for the blade to go up (the arm lifts, then the body winds as the
// steel drops behind the shoulder): the loop times these channels itself, like the hand / blade
const LOOP_TWIST = [P.pelvY, P.spY, P.hdY, P.spZ, P.pelvZ];
const LOOP_CH = [P.rH, P.rH + 1, P.rH + 2, P.swD, P.swD + 1, P.swD + 2, ...LOOP_TWIST];
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
/** Hand + blade along the key splines (LP_H / LP_T, knots ks) → p's rH / swD. `prof` = how far
 *  along: with `arc` the fraction of the REAL point's path length (hand + steel along the hand →
 *  spline direction: the spline's own point cuts in near the hand, where the blade then swung half
 *  a loop in one frame), else the spline parameter itself (the knots time the segments). */
function bladePath(p, ks, prof, Ln, arc) {
  let u = prof;
  if (arc) {
    let px = LP_T[0][0], py = LP_T[0][1], pz = LP_T[0][2];
    LP_S[0] = 0;
    for (let i = 1; i <= LP_N; i++) {
      crPath(LP_H, ks, i / LP_N, LP_OUT, 0);
      crPath(LP_T, ks, i / LP_N, LP_OUT, 3);
      const dx = LP_OUT[3] - LP_OUT[0], dy = LP_OUT[4] - LP_OUT[1], dz = LP_OUT[5] - LP_OUT[2];
      const k = Ln / (Math.hypot(dx, dy, dz) || 1);
      const qx = LP_OUT[0] + dx * k, qy = LP_OUT[1] + dy * k, qz = LP_OUT[2] + dz * k;
      LP_S[i] = LP_S[i - 1] + Math.hypot(qx - px, qy - py, qz - pz);
      px = qx;
      py = qy;
      pz = qz;
    }
    const want = prof * LP_S[LP_N];
    let i = 1;
    while (i < LP_N && LP_S[i] < want) i++;
    const seg = LP_S[i] - LP_S[i - 1];
    u = (i - 1 + (seg > 1e-6 ? clamp((want - LP_S[i - 1]) / seg, 0, 1) : 1)) / LP_N;
  }
  crPath(LP_H, ks, u, LP_OUT, 0);
  crPath(LP_T, ks, u, LP_OUT, 3);
  v3(p, P.rH, LP_OUT[0], LP_OUT[1], LP_OUT[2]);
  setLen(p, P.swD, LP_OUT[3] - LP_OUT[0], LP_OUT[4] - LP_OUT[1], LP_OUT[5] - LP_OUT[2], 1);
}
/** Light 1's windup loop (see LOOP): rewrites the target's hand / blade / twist channels for
 *  t < LOOP.T and hands them to update() (A.pathCh) so the clip's cross-fade leaves them alone. */
function loopWindup(p, A, t) {
  if (!(t < LOOP.T)) return;
  const F = A.from;
  const az = Math.atan2(F[P.swD], F[P.swD + 2]);
  // the loop where the straight way from the entry blade to the coil would cross the legs (entries
  // in front or to the left); entries behind-right (a run's trailing blade) go straight there
  const L = smoothstep(-0.8, -0.35, az) * (1 - smoothstep(1.95, 2.35, az));
  const Ln = LOOP.len;
  pathEnds(F, p, Ln);
  for (let k = 1; k <= 2; k++) {
    const f = LOOP.k[k], h = k === 1 ? LOOP.h1 : LOOP.h2, d = k === 1 ? LOOP.d1 : LOOP.d2;
    for (let c = 0; c < 3; c++) {
      const hs = lerp(LP_H[0][c], LP_H[3][c], f), ts = lerp(LP_T[0][c], LP_T[3][c], f);
      LP_H[k][c] = lerp(hs, h[c], L);
      LP_T[k][c] = lerp(ts, h[c] + d[c] * Ln, L);
    }
  }
  // an eased, even pace along the real point's path: out of the guard, over the shoulder, settling
  // into the coil
  bladePath(p, LOOP.k, Math.pow(smoothstep(0, 1, t / LOOP.T), 0.8), Ln, true);
  const wT = smoothstep(0.25, 1, t / LOOP.T);
  for (const c of LOOP_TWIST) p[c] = F[c] + (p[c] - F[c]) * wT;
  A.pathCh = LOOP_CH;
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
  h1: [-0.19, -0.36, 0.02], d1: [-0.52, -0.42, -0.74], // gather: hands at the right hip, point down-back-right (clear of the right shin)
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
  const F = A.from, S = SLAM_WU, Ln = LOOP.len;
  pathEnds(F, p, Ln);
  for (let c = 0; c < 3; c++) {
    LP_H[1][c] = S.h1[c];
    LP_T[1][c] = S.h1[c] + S.d1[c] * Ln;
    LP_H[2][c] = S.h2[c];
    LP_T[2][c] = S.h2[c] + S.d2[c] * Ln;
  }
  const u = t / S.T;
  bladePath(p, S.k, u, Ln, false);
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
// The light sweeps' finish: after the frames the hit test still reads (the one after the active
// window), the follow-through snaps up into the rising finish within `rise` s and holds it until
// `home` of the recovery, then goes home quicker (pose-to-pose timing instead of one long ease).
const FINISH = { after: 0.035, rise: 0.04, home: 0.55 };
/** Light 1's body around the blade (none of it moves the blade): the free hand reaches for the
 *  target as the steel drops into the coil (the line of the attack), swings back hard against the
 *  sweep (counter-rotation) and stays out behind for balance through the finish; the rear heel
 *  peels as the hips drive round (the toe pivots). */
function lightOneBody(p, A, t, W, Ac) {
  const reach = smoothstep(0.03, W - 0.02, t) * (1 - smoothstep(W, W + Ac * 0.85, t));
  const fling = smoothstep(W + Ac * 0.25, W + Ac + 0.03, t);
  to3(p, P.lH, 0.05, -0.15, 0.42, reach);
  to3(p, P.lP, 0.75, -0.35, -0.3, reach);
  to3(p, P.lH, 0.3, -0.3, -0.22, fling);
  to3(p, P.lP, 0.9, -0.2, 0.25, fling);
  p[P.rFf] = lerp(p[P.rFf], 0.3, smoothstep(W - 0.02, W + Ac * 0.6, t));
}
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

/** Light sweeps, the slam and the thrust. Windup coils (the cross-fade carries the body into the
 *  coil; the slam raises the blade up past the head through its windup), the active frames sweep
 *  the arc a0 → a1, recovery follows through (the light sweeps RISE to elev2) then eases back to
 *  the idle stance. A light attack whose button is still held freezes at the coil (A.t is held at
 *  the windup end). */
function attackPose(p, A) {
  const d = A.def;
  if (!d) {
    guard(p, A);
    return;
  }
  const k = d.anim, t = A.t;
  const W = d.windup, Ac = d.active, R = d.recovery;
  if (k.kind === 'thrust') {
    thrustPose(p, A, t, W, Ac);
  } else {
    const dir = Math.sign(k.a1 - k.a0) || 1;
    const slam = k.kind === 'slam';
    const coil = k.a0 - dir * (slam ? 0.12 : 0.15);
    let ang, lunge, u, el;
    const e0 = k.elev0 ?? k.elev ?? -0.1, e1 = k.elev ?? -0.1;
    if (t < W) {
      const v = t / W;
      if (slam && k.raise != null) {
        // ready (blade low ahead) → up past the head → hanging down the back at the apex
        ang = v < 0.5 ? lerp(k.ready ?? -0.86, k.raise, easeInOutSine(v / 0.5)) : lerp(k.raise, coil, easeOutCubic((v - 0.5) / 0.5));
      } else {
        ang = lerp(k.a0, coil, easeOutCubic(v));
      }
      lunge = 0;
      u = 0;
      el = e0;
    } else if (t < W + Ac) {
      const v = (t - W) / Ac;
      // the slam builds and crashes down; light sweeps ease through (the blade crosses the front at
      // mid-active, when the step-in assist has closed the reach band — COMBAT.md "reach band")
      const e = slam ? v * v * (3 - v * 2) * (0.6 + 0.4 * v) + 0.4 * v * v * (1 - v) : v * v * (3 - 2 * v);
      ang = lerp(coil, k.a1, clamp(e, 0, 1));
      lunge = e;
      u = e;
      el = lerp(e0, e1, u);
    } else {
      let f = easeOutCubic(clamp((t - W - Ac) / (R * 0.45), 0, 1));
      // the sweeps snap up into their rising finish and HOLD it (a 4-frame pose hold, then a
      // quicker way home): the first recovery frames still follow the old ease, because the frame
      // just after the active window is still hit-tested (the sweep runs from the last active one)
      if (!slam) f += (1 - f) * smoothstep(W + Ac + FINISH.after, W + Ac + FINISH.after + FINISH.rise, t);
      ang = lerp(k.a1, k.a2, f);
      lunge = 1;
      u = 1;
      el = lerp(e1, k.elev2 ?? e1, f);
    }
    if (slam) slamPose(p, A, ang, lunge);
    else slashH(p, A, ang, el, lunge);
    if (d.combo === 1 && !slam && t < W) loopWindup(p, A, t);
    else if (slam && t < W) slamWindup(p, A, t);
    if (d.combo === 1 && !slam) lightOneBody(p, A, t, W, Ac);
    if (slam && t > W + Ac + FINISH.after) {
      // the blow's weight settles: the body sinks a little further over the planted blade and the
      // head bows, then the old follow-through hold and rise take over (after the hit-tested frames)
      const s = smoothstep(W + Ac + FINISH.after, W + Ac + 0.09, t) * (1 - smoothstep(W + Ac + 0.16, W + Ac + 0.3, t));
      p[P.bodyY] -= 0.05 * s;
      p[P.spX] += 0.06 * s;
      p[P.hdX] += 0.18 * s;
    }
  }
  // footwork: the lunge is a real step (feet never skate with the root)
  if (k.kind === 'thrust') dashFeet(p, A, W);
  else if (k.kind === 'slam') lungeFeet(p, A, W - 0.16, W + Ac * 0.5, 0.25, true);
  else lungeFeet(p, A, 0.03, W + Ac * 0.45, 0.22, true);
  const rec = (t - W - Ac) / R;
  const home = k.kind === 'h' ? FINISH.home : 0.45; // the sweeps hold their finish a beat longer
  if (rec > home) {
    // back toward the ready stance: the rear foot stays planted, the front foot draws back home in
    // a recovery step (the foot planner settles the rest), and the sword hand comes round in FRONT
    // of the chest (a straight blend of the shoulder offsets ran it through the torso)
    for (let j = 0; j < FOOT_CH.length; j++) FOOT_KEEP[j] = p[FOOT_CH[j]];
    guard(SCRATCH, A);
    const b = smoothstep(home, 1, rec);
    blend(p, p, SCRATCH, b);
    for (let j = 0; j < FOOT_CH.length; j++) p[FOOT_CH[j]] = FOOT_KEEP[j];
    p[P.rH + 2] += 0.24 * Math.sin(Math.PI * b);
    const u = smoothstep(0.42, 0.9, rec); // home a beat before the blade crosses back in front of the legs
    p[P.lF] = lerp(p[P.lF], SCRATCH[P.lF], u);
    p[P.lF + 2] = lerp(p[P.lF + 2], SCRATCH[P.lF + 2], u);
    p[P.lF + 1] = lerp(p[P.lF + 1], ANK, u) + 0.07 * Math.sin(Math.PI * u);
    p[P.lFy] = lerp(p[P.lFy], SCRATCH[P.lFy], u);
  }
}
const FOOT_CH = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rFy, P.lFy];
const FOOT_KEEP = new Float32Array(FOOT_CH.length);

/** Attack footwork. The rear (right) foot stays on its spot while the root lunges, dragged along
 *  only once the leg is stretched `drag` m past its stance spot; the front (left) foot steps from
 *  its spot onto the stance's front spot between t0 and t1 (a lunge step: lift, reach, plant) and
 *  then stays planted while the body carries on over it. Uses the clip's entry feet and the root
 *  travel (A.entry, A.trav), so the cross-fade into the swing starts from where the feet really are. */
function lungeFeet(p, A, t0, t1, drag, plant) {
  const t = A.t, E = A.entry, tr = A.trav;
  // rear foot: planted, dragged once stretched; settles sideways onto the stance line
  const sx = p[P.rF], sz = p[P.rF + 2];
  let hz = E[2] - tr.z;
  if (hz < sz - drag) hz = sz - drag;
  const side = smoothstep(t0, t1 + 0.15, t);
  p[P.rF] = lerp(E[0] - tr.x, sx, side);
  p[P.rF + 1] = lerp(Math.max(ANK, E[1]), ANK, smoothstep(0, 0.05, t));
  p[P.rF + 2] = lerp(hz, Math.max(hz, sz - drag), side);
  p[P.rFy] = lerp(E[6], p[P.rFy], side);
  // front foot: held → the step → planted on its spot while the root carries on
  const m0 = A.mark(0, t0), m1 = A.mark(1, t1);
  const lx = E[3] - (t < t0 ? tr.x : m0.x), lz = E[5] - (t < t0 ? tr.z : m0.z);
  const tx = p[P.lF], tz = p[P.lF + 2];
  const u = clamp((t - t0) / Math.max(0.02, t1 - t0), 0, 1);
  const e = u * u * (3 - 2 * u);
  let fx = lerp(lx, tx, e), fz = lerp(lz, tz, e);
  if (plant && t > t1) {
    // planted: the root's further travel moves the body over the foot
    fx -= tr.x - m1.x;
    fz -= tr.z - m1.z;
  }
  p[P.lF] = fx;
  p[P.lF + 1] = Math.max(ANK, lerp(E[4], p[P.lF + 1], e)) + 0.11 * Math.sin(Math.PI * u);
  p[P.lF + 2] = fz;
  p[P.lFy] = lerp(E[7], p[P.lFy], e);
}
/** The thrust's dash (2.2-3.6 m of root travel in ~0.25 s) as TWO bounding steps instead of a
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

/** Charge: sink into the low coiled stance, blade drawn back and level; deepens with the charge,
 *  trembles when full. The legs can still walk (slowly). */
function chargePose(p, A) {
  const k = clamp(A.chargeK, 0, 1);
  chargeStance(p, A, k, smoothstep(0, 0.25, A.t));
  // the spring winds tighter as the charge builds: lower, more twisted away, leaning in, the eyes
  // held on the target (chargeStance itself is also the thrust's base pose: left untouched). The
  // coat and hair lift in the charge's updraft (A.updraft, the cloth / hair sims).
  const s = smoothstep(0, 0.25, A.t) * k;
  p[P.bodyY] -= 0.045 * s;
  p[P.spX] += 0.07 * s;
  p[P.spY] -= 0.12 * s;
  p[P.pelvY] -= 0.05 * s;
  p[P.hdY] += 0.14 * s;
  p[P.hdX] -= 0.06 * s;
  if (k >= 0.999) {
    const q = Math.sin(A.time * 47) * 0.012;
    p[P.bodyX] += q;
    p[P.swD + 1] += q * 2;
  }
  walkLegs(p, A);
}

/** Block: blade held across the body (hilt right, tip rising to the upper left), free hand bracing
 *  the flat, knees bent. A blocked blow (A.recoil) drives the guard back into the chest. */
function blockPose(p, A) {
  guard(p, A);
  p[P.bodyY] = -0.085;
  p[P.bodyX] = 0;
  p[P.pelvY] = -0.18;
  p[P.pelvZ] = 0;
  p[P.spX] = 0.15;
  p[P.spY] = 0.12;
  p[P.spZ] = 0;
  p[P.hdX] = 0;
  p[P.hdY] = 0.04;
  v3(p, P.rH, 0.17, -0.2, 0.3);
  v3(p, P.rP, -0.4, -0.7, -0.5);
  v3(p, P.swD, 0.88, 0.42, 0.14);
  v3(p, P.swF, -0.1, 1, 0.5);
  v3(p, P.lH, 0.05, -0.1, 0.3);
  v3(p, P.lP, 0.7, -0.5, -0.4);
  // a tap of the guard (a parry attempt) keeps the feet where they are; held, the stance settles
  // into the block's after ~0.2 s (each tap used to cost two settle steps in and two out again)
  const E = A.entry, fw = smoothstep(0.16, 0.4, A.t);
  v3(p, P.rF, lerp(E[0], -0.19, fw), ANK, lerp(E[2], -0.18, fw));
  v3(p, P.lF, lerp(E[3], 0.15, fw), ANK, lerp(E[5], 0.2, fw));
  p[P.rFy] = lerp(E[6], p[P.rFy], fw);
  p[P.lFy] = lerp(E[7], p[P.lFy], fw);
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

/** Parry: from the guard, a sharp outward flick of the blade (to the right and up), the body
 *  turning with it, then settling back. */
function parryPose(p, A) {
  blockPose(p, A);
  const t = A.t;
  const f = t < 0.06 ? easeOutCubic(t / 0.06) : 1 - smoothstep(0.06, 0.3, t);
  dirTo(p, P.swD, -0.55, 0.8, 0.5, f);
  to3(p, P.swF, 0, 0.3, 1, f);
  to3(p, P.rH, -0.05, -0.08, 0.4, f);
  to3(p, P.lH, 0.22, -0.32, 0.02, f);
  p[P.spY] -= 0.4 * f;
  p[P.pelvY] -= 0.15 * f;
  p[P.spX] -= 0.05 * f;
  p[P.hdY] += 0.3 * f;
}

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
  y: [0, -0.24, 0.05, -0.27, 0.09, -0.16, 0.2, -0.36, 0.32, -0.5, 0.42, -0.47, 0.54, -0.44, 0.6, -0.2],
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
  p[P.spX] = lerp(p[P.spX], -0.08, drink);
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

const POSES = {
  loco,
  attack: attackPose,
  charge: chargePose,
  block: blockPose,
  parry: parryPose,
  ghostep: ghostepPose,
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
// blade vs the legs (outside attacks): thigh / shin clearance radii (limb + knee guard + margin) and
// how far from the grip the steel starts to count
const BLADE_CLEAR = [0.1, 0.085, 0.15];
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
const LEG_R = 0.08; // thigh / knee radius used to push the panels out
// torn strips (one spring each, so every tip sways on its own and lags its panel ~0.1 s)
const STRIP_K = 75, STRIP_C = 7.5, STRIP_LAG = 0.08, STRIP_FLARE = 0.42;
const STRIP_A = [-1.5, 0.8], STRIP_B = 0.8, STRIP_FLOOR = 0.03;
// sleeve streamers: two-segment springs that stream back almost horizontally when running
const STREAM_K = [55, 40], STREAM_C = [6, 4.5], STREAM_LAG = [0.3, 0.4], STREAM_OUT = 0.36;
const STREAM_A = 2.6, STREAM_B = 1.3;
const TWO_HAND_GRIP = 0.11; // m down the grip from the sword hand to the off hand (two-handed)
const PAULDRON_FOLLOW = 0.35; // how much of the sword arm's swing the shoulder armour follows
// the thrust charge's updraft (× A.updraft 0..1): extra outward flare of the coat panels and the
// torn strips (rad), and an upward pull on the hair tips (m of tip displacement)
const UPDRAFT_COAT = 0.3, UPDRAFT_STRIP = 0.35, UPDRAFT_HAIR = 0.12;
// hair cluster springs (rotation vector, head space); HAIR_DRAG = rad of blow-back per m/s of the
// tips' own horizontal speed (head axes)
const HAIR_K = 170, HAIR_C = 13, HAIR_MAX = 0.4, HAIR_DRAG = 0.06;
// idle breeze on the coat: extra outward flare per panel (back-left blows out the most)
const BREEZE = [0.02, 0.03, 0.05, 0.04, 0.1, 0.05, 0.0];
// standing still, the skirt FLARES like the reference portrait's (a wide A of torn tails either
// side of the legs, the sword side widest): extra outward swing per panel, faded out by speed
// (front-left, front-right, left, right, back-left, back-right, flap)
const IDLE_FLARE = [0.14, 0.24, 0.55, 0.75, 0.38, 0.52, 0];

export class HeroAnimator {
  /** player must expose: yaw, state, stateT, animT, atk ({def}), groundVel {x, z}, chargeK,
   *  releaseK, recoil. */
  constructor(rig, player) {
    this.rig = rig;
    this.player = player;
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
    this.updraft = 0; // the charge's updraft on the coat and hair (0..1, eased)
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
    this.dashStep = 0; // the thrust dash's touchdowns already stepped (bits: rear, front)
    this.entry = new Float32Array([-0.25, ANK, 0.15, 0.13, ANK, -0.03, -0.4, 0.22]);
    this.leanF = 0; // acceleration lean (rad), a critically damped spring on the smoothed acceleration
    this.leanFV = 0;
    this.leanS = 0;
    this.leanSV = 0;
    this.stepCool = 0;
    this.coatState = rig.coat.map(() => [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }]);
    this.stripState = rig.coat.map((C) => C.strips.map(() => ({ x: 0, vx: 0, z: 0, vz: 0 })));
    this.streamState = (rig.streamers ?? []).map(() => ({
      segs: [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }], prev: new THREE.Vector3(), vel: new THREE.Vector3(),
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
    // sphere proxies (joint-local centre + radius) kept above the ground by apply()
    this.proxies = [
      { joint: rig.head, x: 0, y: 0.13, z: 0, r: 0.14 },
      { joint: rig.chest, x: 0, y: 0.09, z: 0, r: 0.15 },
      { joint: rig.spine, x: 0, y: 0.06, z: 0, r: 0.12 },
      { joint: rig.pelvis, x: 0, y: -0.02, z: 0, r: 0.14 },
    ];
    this.reset();
  }

  /** Start a clip, cross-fading from the current pose over `blend` seconds. */
  play(key, blend = 0.12, easeOut = false) {
    if (!POSES[key]) key = 'loco';
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
    for (const st of this.stripState) {
      for (const c of st) c.x = c.vx = c.z = c.vz = 0;
    }
    for (const st of this.streamState) {
      for (const c of st.segs) c.x = c.vx = c.z = c.vz = 0;
      st.vel.set(0, 0, 0);
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
    // the charge's updraft (0..1): lifts the coat tails and the hair as the thrust charges
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
    // drawn ground speed (the drawn hero is HERO_SCALE tall)
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
    this.phase += (sp / HERO_SCALE) * dt / this.gait.len;
    if (this.phase > 1e4) this.phase -= 1e4;

    {
      const tx = (fin(pl.position?.x) - this.clipX) / HERO_SCALE, tz = (fin(pl.position?.z) - this.clipZ) / HERO_SCALE;
      this.trav.x = tx * c - tz * s;
      this.trav.z = tx * s + tz * c;
    }
    this.pathCh = null;
    POSES[this.key](this.target, this);
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
   * (drawn position, HERO_SCALE) while the root moves and turns under it, so nothing skates on run
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
    const c = Math.cos(yaw), s = Math.sin(yaw), HS = HERO_SCALE;
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
    F.wx = px + HERO_SCALE * (x * c + z * s);
    F.wz = pz + HERO_SCALE * (-x * s + z * c);
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
      _G.copy(r.sword.position).addScaledVector(_bz, -TWO_HAND_GRIP); // body space
      r.body.localToWorld(_G);
      r.chest.worldToLocal(_G);
      _T.copy(_TL).lerp(_G, two);
    }
    this._arm(r.arms.L, _T, p, P.lP, false);
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

  /** Hand target in chest space (into _T): the pose's shoulder offset (body axes). */
  _handTarget(arm, p, hi) {
    _T.set(p[hi], p[hi + 1], p[hi + 2]).applyQuaternion(_qBC).add(arm.upper.position);
    return _T;
  }

  _arm(arm, T, p, pi, holdsSword) {
    _S.copy(arm.upper.position);
    if (T !== _T) _T.copy(T);
    // hands never reach into the ground
    this.rig.chest.localToWorld(_w.copy(_T));
    if (_w.y < HAND_FLOOR) {
      _w.y = HAND_FLOOR;
      this.rig.chest.worldToLocal(_T.copy(_w));
    }
    _pole.set(p[pi], p[pi + 1], p[pi + 2]).applyQuaternion(_qBC);
    const beta = solveTwoBone(_S, _T, _pole, DIM.upperArm, DIM.foreArm, 1, arm.upper.quaternion, _end);
    arm.fore.rotation.set(-beta, 0, 0);
    if (holdsSword) {
      // grip = the reached wrist point, re-expressed in body space
      this.rig.chest.localToWorld(_w.copy(_end));
      this.rig.body.worldToLocal(_w);
      this.rig.sword.position.copy(_w);
    }
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

  /** Coat skirt: each panel segment springs toward gravity-hang + hip flare − its anchor's
   *  velocity (so it lags turns, runs and rolls). The knees and thighs push the panels out, and
   *  the hem never sinks into the ground. Angles: x = swing (− outward), z = sideways. Then the
   *  torn strips of each panel follow on their own springs (_strips). */
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
          const halfW = (D.w[0] + D.w[1]) * 0.25;
          for (const K of lp) {
            const dx = K.x - ap.x, dy = ap.y - K.y, dz = K.z - ap.z;
            if (dy < 0.05) continue;
            if (Math.abs(dx * tx + dz * tz) > halfW + LEG_R) continue;
            const need = -Math.atan2(dx * nx + dz * nz + LEG_R, dy);
            if (need < lim) lim = need;
          }
          absA = Math.min(absA, lim);
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
      for (let s = 0; s < 2; s++) {
        const c = st.segs[s], j = S.segs[s];
        const lag = STREAM_LAG[s] * (1 + 0.08 * sp);
        const wob = (0.08 + 0.12 * Math.min(1, sp / 4)) * Math.sin(ph + s * 1.4);
        _v.set(ox * STREAM_OUT - vel.x * lag - oz * wob, -1 - vel.y * lag * 0.5 + Math.abs(wob) * 0.5, oz * STREAM_OUT - vel.z * lag + ox * wob);
        _v.normalize().applyQuaternion(_qInv2.copy(_q0).invert());
        const tA = clamp(Math.atan2(-_v.z, -_v.y), -STREAM_A, STREAM_A);
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
        c.x = clamp(c.x, -STREAM_A, STREAM_A);
        c.z = clamp(c.z, -STREAM_B, STREAM_B);
        j.rotation.set(c.x, 0, c.z);
        _q0.multiply(_qs.setFromEuler(_eul.set(c.x, 0, c.z, 'YXZ')));
      }
    }
    this.streamInit = true;
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
