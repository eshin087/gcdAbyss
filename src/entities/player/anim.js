import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, easeOutCubic, easeInOutSine, wrapAngle, TAU } from '../../core/math.js';
import { DIM } from './model.js';

// Procedural animation for the knight. Every frame a target POSE (a flat Float32Array) is built
// for the current clip as a function of state time, cross-faded from a snapshot of the previous
// pose, then applied: FK for body/pelvis/spine/head, analytic two-bone IK for arms and legs,
// the sword oriented directly in body space, and a spring-chain cape.
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
};
const N = 45;
const ANGLES = [P.pitch, P.yaw, P.roll];
const ANK = DIM.ankle;

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
function blend(out, a, b, t) {
  for (let i = 0; i < N; i++) out[i] = a[i] + (b[i] - a[i]) * t;
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

// ---------------------------------------------------------------- poses
// A = the animator: time, t (state time), moveW, sprintW, speed, phase, mx/mz (move dir in model
// space), def (attack data).

/** Idle guard: shield side forward, sword low and pointing ahead, breathing + weight shift. */
function guard(p, A) {
  const br = Math.sin(A.time * 1.9), sw = Math.sin(A.time * 0.63);
  p[P.bodyX] = 0.014 * sw;
  p[P.bodyY] = -0.035 + 0.006 * br;
  p[P.bodyZ] = 0;
  p[P.pitch] = 0;
  p[P.yaw] = 0;
  p[P.roll] = 0;
  p[P.pelvY] = -0.16;
  p[P.pelvZ] = 0.035 * sw;
  p[P.spX] = 0.1 + 0.012 * br;
  p[P.spY] = 0.07;
  p[P.spZ] = -0.025 * sw;
  p[P.hdX] = -0.05;
  p[P.hdY] = 0.08;
  v3(p, P.rH, 0.05, -0.45 + 0.01 * br, 0.25);
  v3(p, P.rP, -0.6, -0.3, -1);
  v3(p, P.lH, -0.04, -0.4, 0.27);
  v3(p, P.lP, 0.7, -0.2, -0.8);
  v3(p, P.swD, -0.14, -0.42, 1);
  v3(p, P.swF, 1, 0.1, 0.1);
  v3(p, P.rF, -0.16, ANK, -0.12);
  v3(p, P.lF, 0.13, ANK, 0.15);
  v3(p, P.rK, -0.2, 0, 1);
  v3(p, P.lK, 0.2, 0, 1);
  p[P.footFlat] = 0.92;
  p[P.flask] = 0;
}

/** One foot of the gait. u = cycle phase: stance [0, .5) sweeps back, swing [.5, 1) lifts forward. */
function footCycle(p, i, side, u, ax, az, exc, lift, w) {
  u -= Math.floor(u);
  let along, up = 0;
  if (u < 0.5) {
    along = exc * (1 - 4 * u);
  } else {
    const t = (u - 0.5) * 2;
    along = exc * (-1 + 2 * t * t * (3 - 2 * t));
    up = Math.sin(Math.PI * t) * lift;
  }
  to3(p, i, side + ax * along, ANK + up, az * along, w);
}

/** Idle ↔ run ↔ sprint, blended by moveW / sprintW. Works for strafing and backpedalling. */
function loco(p, A) {
  guard(p, A);
  const w = A.moveW;
  if (w < 0.002) return;
  const s = A.sprintW, sp = A.speed, mx = A.mx, mz = A.mz;
  const ph = A.phase;
  const exc = Math.min(0.42, 0.075 * sp + 0.04);
  const lift = lerp(0.13, 0.22, s) * Math.min(1, sp / 3 + 0.3);
  footCycle(p, P.lF, 0.12, ph, mx * 0.75, mz, exc, lift, w);
  footCycle(p, P.rF, -0.12, ph + 0.5, mx * 0.75, mz, exc, lift, w);
  p[P.footFlat] = lerp(p[P.footFlat], 0.55, w);
  to3(p, P.rK, -0.1, 0, 1, w);
  to3(p, P.lK, 0.1, 0, 1, w);

  const cs = Math.cos(ph * TAU); // +1 when the left foot is planted forward
  const bob = Math.cos(ph * TAU * 2);
  p[P.bodyY] = lerp(p[P.bodyY], -0.05 - 0.035 * s + 0.022 * bob, w);
  p[P.bodyX] = lerp(p[P.bodyX], 0, w);
  p[P.pelvY] = lerp(p[P.pelvY], -0.12 * cs * mz, w);
  p[P.pelvZ] = lerp(p[P.pelvZ], 0, w);
  const lean = lerp(0.12, 0.34, s) * Math.min(1, sp / 4);
  p[P.spX] = lerp(p[P.spX], 0.05 + lean * (mz > 0 ? mz : mz * 0.4), w);
  p[P.spZ] = lerp(p[P.spZ], -lean * mx * 0.6, w);
  p[P.spY] = lerp(p[P.spY], 0.08 * cs * mz, w);
  p[P.hdX] = lerp(p[P.hdX], -0.04 - p[P.spX] * 0.5, w);
  p[P.hdY] = lerp(p[P.hdY], 0, w);

  // counter arm swing; the sword trails low behind, the shield arm swings opposite
  const amp = 0.16 * (1 + 0.4 * s) * cs * mz;
  to3(p, P.rH, 0.02, -0.44 + 0.05 * Math.max(0, cs * mz), 0.08 + amp, w);
  to3(p, P.lH, -0.02, -0.41, 0.12 - amp, w);
  to3(p, P.swD, -0.4, -0.45, -0.8 - 0.25 * s, w);
  to3(p, P.swF, 1, 0, 0, w);
}

/** Feet apart (left forward), slight crouch. lunge 0..1 sinks into the strike. */
function stance(p, A, lunge) {
  guard(p, A);
  v3(p, P.rF, -0.17, ANK, -0.2);
  v3(p, P.lF, 0.14, ANK, 0.24 + 0.08 * lunge);
  p[P.bodyX] = 0;
  p[P.bodyY] = -0.08 - 0.04 * lunge;
  p[P.bodyZ] = 0.05 * lunge;
  p[P.pelvZ] = 0;
  p[P.footFlat] = 0.9;
}

/** Horizontal slash with the blade at azimuth th (0 = ahead, + = knight's left). */
function slashH(p, A, th, elev, lunge) {
  stance(p, A, lunge);
  const s = Math.sin(th), c = Math.cos(th);
  const tw = clamp(th, -2, 2);
  p[P.pelvY] = -0.1 + tw * 0.15;
  p[P.spY] = tw * 0.3;
  p[P.spX] = 0.16;
  p[P.spZ] = -0.05 * s;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.75; // eyes stay on the target
  p[P.hdX] = -0.02;
  setLen(p, P.rH, s * 0.92, -0.42, c * 0.92 + 0.18, 0.5);
  v3(p, P.rP, -0.3, -1, -0.45);
  v3(p, P.swD, s, elev, c);
  v3(p, P.swF, 0, 1, 0);
  v3(p, P.lH, 0.1 - 0.12 * s, -0.38, 0.1 - 0.12 * c);
  v3(p, P.lP, 0.9, -0.2, -0.5);
}

/** Vertical slash with the blade at elevation ph (π/2 = straight up, 0 = ahead, − = down). */
function slashV(p, A, ph, lunge, heavy, a0, a1) {
  stance(p, A, lunge);
  const s = Math.sin(ph), c = Math.cos(ph);
  const q = clamp((a0 - ph) / (a0 - a1 || 1), -0.25, 1.1); // 0 raised → 1 struck
  const qc = clamp(q, 0, 1);
  p[P.spX] = lerp(-0.2 - 0.22 * heavy, 0.36 + 0.16 * heavy, q);
  p[P.spY] = -0.14;
  p[P.pelvY] = -0.12;
  p[P.hdX] = lerp(-0.15, 0.22, qc);
  p[P.hdY] = 0.14;
  p[P.bodyY] += lerp(0.03 * heavy, -0.05 - 0.12 * heavy, qc);
  p[P.bodyZ] += 0.1 * heavy * qc;
  setLen(p, P.rH, -0.07, s * 0.95 + 0.05, c + 0.25, 0.52);
  v3(p, P.rP, -1, 0.15, 0.1);
  v3(p, P.swD, -0.05, s, c);
  v3(p, P.swF, 1, 0, 0);
  // off-hand reaches toward the target while winding, swings back on the strike
  v3(p, P.lH, lerp(-0.08, 0.26, qc), lerp(-0.12, -0.38, qc), lerp(0.42, -0.14, qc));
  v3(p, P.lP, 0.8, -0.3, -0.4);
}

const SCRATCH = new Float32Array(N);

/** Light combo + heavy. Windup coils (the cross-fade carries the body into the coil), the active
 *  frames sweep the arc a0 → a1, recovery follows through then eases back to guard. */
function attackPose(p, A) {
  const d = A.def;
  if (!d) {
    guard(p, A);
    return;
  }
  const k = d.anim, t = A.t;
  const W = d.windup, Ac = d.active, R = d.recovery;
  const dir = Math.sign(k.a1 - k.a0) || 1;
  const coil = k.a0 - dir * (k.heavy ? 0.22 : 0.15);
  let ang, lunge;
  if (t < W) {
    ang = lerp(k.a0, coil, easeOutCubic(t / W));
    lunge = 0;
  } else if (t < W + Ac) {
    const u = (t - W) / Ac;
    const e = u * u * (3 - 2 * u);
    ang = lerp(coil, k.a1, e);
    lunge = e;
  } else {
    ang = lerp(k.a1, k.a2, easeOutCubic(clamp((t - W - Ac) / (R * 0.45), 0, 1)));
    lunge = 1;
  }
  if (k.kind === 'h') slashH(p, A, ang, k.elev ?? -0.1, lunge);
  else slashV(p, A, ang, lunge, k.heavy ? 1 : 0, k.a0, k.a1);
  const rec = (t - W - Ac) / R;
  if (rec > 0.45) {
    guard(SCRATCH, A);
    blend(p, p, SCRATCH, smoothstep(0.45, 1, rec));
  }
}

/** Forward roll: tuck, one full somersault about the lateral axis, stand. */
function rollPose(p, A) {
  const t = A.t;
  guard(p, A);
  const tuck = smoothstep(0, 0.1, t) * (1 - smoothstep(0.44, 0.6, t));
  const spin = easeInOutSine(clamp((t - 0.03) / 0.47, 0, 1));
  p[P.pitch] = spin * TAU;
  p[P.bodyX] = 0;
  p[P.bodyY] = -0.035 - 0.55 * tuck; // the ground clamp in apply() lifts the ball as it turns
  p[P.pelvY] = lerp(p[P.pelvY], 0, tuck);
  p[P.spY] = lerp(p[P.spY], 0, tuck);
  p[P.spZ] = 0;
  p[P.spX] = lerp(p[P.spX], 0.95, tuck);
  p[P.hdX] = lerp(p[P.hdX], 0.75, tuck);
  to3(p, P.rH, 0.06, -0.3, 0.3, tuck);
  to3(p, P.lH, -0.08, -0.3, 0.3, tuck);
  to3(p, P.swD, -0.85, -0.12, -0.5, tuck); // blade held out to the side, clear of the body
  to3(p, P.swF, 0, 1, 0, tuck);
  bodyPointTo(p, P.rF, -0.12, -0.42, 0.2, tuck); // knees to chest
  bodyPointTo(p, P.lF, 0.12, -0.4, 0.22, tuck);
  to3(p, P.rK, -0.2, 0.5, 1, tuck);
  to3(p, P.lK, 0.2, 0.5, 1, tuck);
  p[P.footFlat] = lerp(p[P.footFlat], 0, tuck);
}

/** Backstep: short hop backward, guard up. */
function backstepPose(p, A) {
  const t = A.t;
  guard(p, A);
  const hop = Math.sin(Math.PI * clamp((t - 0.02) / 0.3, 0, 1));
  const k = smoothstep(0, 0.06, t) * (1 - smoothstep(0.3, 0.4, t));
  p[P.bodyY] += 0.06 * hop - 0.06 * k;
  p[P.spX] = lerp(p[P.spX], -0.12, k);
  p[P.hdX] = lerp(p[P.hdX], 0.06, k);
  p[P.rF + 1] += 0.1 * hop;
  p[P.lF + 1] += 0.12 * hop;
  p[P.rF + 2] += 0.12 * k; // feet trail forward as the body hops back
  p[P.lF + 2] += 0.18 * k;
  to3(p, P.swD, -0.1, -0.1, 1, k);
  to3(p, P.lH, -0.06, -0.3, 0.36, k);
}

/** Drink: legs keep walking (slowly), left hand raises the flask to the visor, head tips back. */
function healPose(p, A) {
  loco(p, A);
  const t = A.t;
  const raise = smoothstep(0.02, 0.3, t) * (1 - smoothstep(0.72, 0.95, t));
  const drink = smoothstep(0.3, 0.42, t) * (1 - smoothstep(0.62, 0.74, t));
  to3(p, P.lH, -0.16, 0.1, 0.3, raise);
  to3(p, P.lH, -0.19, 0.17, 0.2, drink);
  to3(p, P.lP, 0.7, -0.5, -0.3, raise);
  p[P.hdX] = lerp(p[P.hdX], -0.38, drink);
  p[P.spX] = lerp(p[P.spX], 0.0, drink);
  p[P.hdY] = lerp(p[P.hdY], 0, raise);
  // sword arm rests low at the side
  to3(p, P.rH, 0.03, -0.46, 0.14, raise);
  to3(p, P.swD, -0.3, -0.6, 0.6, raise);
  p[P.flask] = smoothstep(0.0, 0.12, t) * (1 - smoothstep(0.82, 0.95, t));
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
  to3(p, P.swD, -0.7, -0.25, 0.6, k);
  p[P.lF + 2] -= 0.2 * k;
}

// knockdown: fall back (0–0.3), lie (–0.8), sit up, crouch, stand (–1.3)
const KD = {
  pitch: [0, 0, 0.3, -1.45, 0.8, -1.45, 1.0, -0.55, 1.14, 0.18, 1.3, 0],
  y: [0, -0.035, 0.3, -0.87, 0.8, -0.87, 1.0, -0.6, 1.14, -0.34, 1.3, -0.035],
  z: [0, 0, 0.3, -0.5, 0.8, -0.5, 1.0, -0.34, 1.14, -0.12, 1.3, 0],
  sp: [0, 0.1, 0.18, -0.3, 0.32, 0.05, 0.8, 0.05, 1.0, 0.55, 1.14, 0.45, 1.3, 0.1],
  hd: [0, -0.05, 0.2, -0.5, 0.36, 0.25, 0.8, 0.15, 1.0, 0.3, 1.3, -0.05],
  lie: [0.12, 0, 0.28, 1, 0.84, 1, 0.98, 0],
  sit: [0.84, 0, 0.98, 1, 1.14, 1, 1.3, 0],
  arms: [0.05, 0, 0.25, 1, 0.8, 1, 0.95, 0],
  push: [0.8, 0, 0.92, 1, 1.08, 1, 1.22, 0],
};
function knockdownPose(p, A) {
  const t = A.t;
  guard(p, A);
  p[P.bodyX] = 0;
  p[P.pelvY] = 0;
  p[P.spY] = 0;
  p[P.spZ] = 0;
  p[P.pitch] = kf(t, KD.pitch);
  p[P.bodyY] = kf(t, KD.y) + 0.05 * Math.sin(Math.PI * clamp((t - 0.3) / 0.12, 0, 1)); // bounce
  p[P.bodyZ] = kf(t, KD.z);
  p[P.spX] = kf(t, KD.sp);
  p[P.hdX] = kf(t, KD.hd);
  const sit = kf(t, KD.sit);
  to3(p, P.rF, -0.16, ANK, 0.08, sit);
  to3(p, P.lF, 0.15, ANK, 0.18, sit);
  const lie = kf(t, KD.lie);
  bodyPointTo(p, P.rF, -0.13, -1.0, 0.04, lie); // legs laid out along the body
  bodyPointTo(p, P.lF, 0.13, -1.0, 0.08, lie);
  p[P.footFlat] = lerp(0.9, 0.1, lie);
  const arms = kf(t, KD.arms), push = kf(t, KD.push);
  to3(p, P.rH, -0.36, -0.15, -0.02, arms);
  to3(p, P.lH, 0.38, -0.15, 0.02, arms);
  to3(p, P.swD, -1, 0.05, 0.25, arms);
  to3(p, P.swF, 0, 1, 0, arms);
  to3(p, P.rH, -0.1, -0.48, -0.12, push); // hands push off the ground
  to3(p, P.lH, 0.1, -0.48, -0.12, push);
}

// death: drop to one knee leaning on the sword (0–0.55), sway, collapse face down (0.95–1.4)
const DEATH = {
  y: [0, -0.035, 0.55, -0.44, 0.95, -0.46, 1.4, -0.9],
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
  to3(p, P.swD, -0.05, -0.62, 0.78, kneel);
  to3(p, P.swF, 1, 0, 0, kneel);
  to3(p, P.lH, -0.06, -0.45, 0.24, kneel);
  const flat = kf(t, DEATH.flat);
  bodyPointTo(p, P.rF, -0.13, -1.0, -0.06, flat);
  bodyPointTo(p, P.lF, 0.13, -1.0, -0.04, flat);
  p[P.footFlat] = lerp(0.9, 0.1, flat);
  // face down: body +Z points into the ground, +Y toward the head
  const limp = kf(t, DEATH.limp);
  to3(p, P.rH, -0.45, 0.05, 0.1, limp);
  to3(p, P.swD, -0.55, 0.8, -0.05, limp); // sword dropped flat beside the head
  to3(p, P.swF, 0, 0, 1, limp);
  to3(p, P.lH, 0.32, -0.05, 0.12, limp);
}

const POSES = {
  loco,
  attack: attackPose,
  roll: rollPose,
  backstep: backstepPose,
  heal: healPose,
  stagger: staggerPose,
  knockdown: knockdownPose,
  dead: deathPose,
};

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

// cape spring chain: stiffness, damping, how strongly each segment flares with speed
const CAPE_K = [140, 110, 90];
const CAPE_C = [14, 11, 9];
const CAPE_FLARE = [0.75, 1.0, 1.15];
const CAPE_SWAY = [0.8, 1.0, 1.2];
const CAPE_FLOOR = 0.04; // cape segment ends stay this far above the ground
const TIP_FLOOR = -0.03; // the sword tip may graze into the grass, no deeper
const HAND_FLOOR = 0.1; // grip / off-hand centre height floor
const FOOT_FLOOR = 0.06; // ankle height floor
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _sp = new THREE.Vector3();
const _ceul = new THREE.Euler(0, 0, 0, 'YXZ');

/** World height of a cape segment's end for local angles (ax, az); r* = world-Y row of parent. */
function capeEndY(sy, len, r0, r1, r2, ax, az) {
  const cz = Math.cos(az);
  return sy + len * (r0 * Math.sin(az) - r1 * cz * Math.cos(ax) - r2 * cz * Math.sin(ax));
}

export class KnightAnimator {
  /** player must expose: yaw, state, stateT, atk ({def}), groundVel {x, z}. */
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
    this.speed = 0;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.def = null;
    this.onFootstep = null;
    this.capeAng = [{ x: 0.15, vx: 0, z: 0, vz: 0 }, { x: 0.05, vx: 0, z: 0, vz: 0 }, { x: 0.05, vx: 0, z: 0, vz: 0 }];
    this.capeVel = new THREE.Vector3();
    this.capePrev = new THREE.Vector3();
    this.capeInit = false;
    // sphere proxies (joint-local centre + radius) kept above the ground by apply()
    this.proxies = [
      { joint: rig.head, x: 0, y: 0.13, z: 0, r: 0.15 },
      { joint: rig.chest, x: 0, y: 0.1, z: 0.01, r: 0.16 },
      { joint: rig.spine, x: 0, y: 0.07, z: 0, r: 0.13 },
      { joint: rig.pelvis, x: 0, y: -0.05, z: 0, r: 0.16 },
    ];
    this.reset();
  }

  /** Start a clip, cross-fading from the current pose over `blend` seconds. */
  play(key, blend = 0.12, easeOut = false) {
    if (!POSES[key]) key = 'loco';
    this.from.set(this.cur);
    for (const i of ANGLES) this.from[i] = wrapAngle(this.from[i]); // a finished roll is 2π ≡ 0
    this.key = key;
    this.blendT = 0;
    this.blendDur = Math.max(1e-3, blend);
    this.easeOut = easeOut;
  }

  reset() {
    this.time = 0;
    this.t = 0;
    this.moveW = 0;
    this.sprintW = 0;
    this.speed = 0;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.def = null;
    this.key = 'loco';
    guard(this.cur, this);
    this.from.set(this.cur);
    this.target.set(this.cur);
    this.blendT = this.blendDur = 1;
    for (const c of this.capeAng) {
      c.vx = c.vz = c.z = 0;
    }
    this.capeAng[0].x = 0.15;
    this.capeAng[1].x = this.capeAng[2].x = 0.05;
    this.capeVel.set(0, 0, 0);
    this.capeInit = false;
    this.apply(this.cur);
    this._cape(0);
    this.rig.root.updateMatrixWorld(true);
  }

  update(dt) {
    const pl = this.player;
    this.time += dt;
    this.t = pl.stateT;
    this.def = pl.atk ? pl.atk.def : null;

    // gait drivers from the knight's actual ground velocity, expressed in model space
    const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw);
    const vx = pl.groundVel.x, vz = pl.groundVel.z;
    const lx = vx * c - vz * s, lz = vx * s + vz * c;
    const sp = Math.hypot(lx, lz);
    if (sp > 0.2) {
      this.mx = damp(this.mx, lx / sp, 14, dt);
      this.mz = damp(this.mz, lz / sp, 14, dt);
      const l = Math.hypot(this.mx, this.mz) || 1;
      this.mx /= l;
      this.mz /= l;
    }
    this.speed = sp;
    this.moveW = damp(this.moveW, clamp(sp / 3, 0, 1), 10, dt);
    this.sprintW = damp(this.sprintW, pl.state === 'sprint' ? 1 : 0, 6, dt);
    const prev = this.phase;
    this.phase += (sp * dt) / (1.2 + 0.15 * sp);
    if ((this.key === 'loco' || this.key === 'heal') && sp > 0.8 && this.onFootstep) {
      if (Math.floor(prev) !== Math.floor(this.phase)) this.onFootstep(1); // left foot lands
      if (Math.floor(prev + 0.5) !== Math.floor(this.phase + 0.5)) this.onFootstep(-1);
    }
    if (this.phase > 1e4) this.phase -= 1e4;

    POSES[this.key](this.target, this);
    if (this.blendT < this.blendDur) {
      this.blendT += dt;
      const u = clamp(this.blendT / this.blendDur, 0, 1);
      blend(this.cur, this.from, this.target, this.easeOut ? easeOutCubic(u) : u * u * (3 - 2 * u));
    } else {
      this.cur.set(this.target);
    }
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(this.cur[i])) {
        guard(this.cur, this); // never let a bad frame poison the rig
        this.from.set(this.cur);
        this.blendT = this.blendDur;
        break;
      }
    }
    this.apply(this.cur);
    this._cape(dt);
    this.rig.root.updateMatrixWorld(true);
  }

  apply(p) {
    const r = this.rig;
    r.body.position.set(p[P.bodyX], DIM.pivot + p[P.bodyY], p[P.bodyZ]);
    r.body.rotation.set(p[P.pitch], p[P.yaw], p[P.roll]);
    r.pelvis.rotation.set(0, p[P.pelvY], p[P.pelvZ]);
    r.spine.rotation.set(p[P.spX], p[P.spY], p[P.spZ]);
    r.head.rotation.set(p[P.hdX], p[P.hdY], 0);
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

    this._arm(r.arms.R, p, P.rH, P.rP, true);
    this._arm(r.arms.L, p, P.lH, P.lP, false);
    this._leg(r.legs.R, p, P.rF, P.rK);
    this._leg(r.legs.L, p, P.lF, P.lK);

    // sword: blade along +Z = swD, flat normal (+Y) = swF, both in body axes
    _bz.set(p[P.swD], p[P.swD + 1], p[P.swD + 2]);
    if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
    _bz.normalize();
    // keep the blade tip out of the ground: raise its world pitch just enough
    r.body.localToWorld(_w.copy(r.sword.position));
    _v.copy(_bz).applyQuaternion(_qBody);
    const need = (TIP_FLOOR - _w.y) / DIM.bladeTip;
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

  _arm(arm, p, hi, pi, holdsSword) {
    _S.copy(arm.upper.position);
    _T.set(p[hi], p[hi + 1], p[hi + 2]).applyQuaternion(_qBC).add(_S);
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

  _leg(leg, p, fi, ki) {
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
    leg.foot.quaternion.identity().slerp(_q2, clamp(p[P.footFlat], 0, 1));
  }

  /** Cape: each segment springs toward gravity-hang + flare from the chest's velocity, so it
   *  lags behind turns, runs and rolls. Angles are relative to the parent segment. */
  _cape(dt) {
    const r = this.rig;
    r.chest.getWorldPosition(_w);
    if (this.capeInit && dt > 1e-4) {
      _v.subVectors(_w, this.capePrev).divideScalar(dt);
      if (_v.lengthSq() > 625) _v.setLength(25);
      this.capeVel.lerp(_v, 1 - Math.exp(-14 * dt));
    }
    this.capePrev.copy(_w);
    this.capeInit = true;

    r.chest.getWorldQuaternion(_q1);
    _q1.invert();
    _g.set(0, -1, 0).applyQuaternion(_q1); // gravity in chest space
    _v.copy(this.capeVel).applyQuaternion(_q1); // chest velocity in chest space
    const gx = Math.atan2(-_g.z, Math.max(0.05, -_g.y));
    const gz = Math.asin(clamp(_g.x, -1, 1));
    const flare = clamp(_v.z * 0.14, -0.3, 1.3);
    const side = clamp(-_v.x * 0.1, -0.6, 0.6);
    const sp = Math.min(1, Math.hypot(_v.x, _v.z) / 6);

    const steps = dt > 0 ? Math.min(8, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
    let parentX = 0, parentZ = 0;
    // walk the chain in world space for the ground constraint
    r.chest.getWorldQuaternion(_qa);
    r.chest.localToWorld(_sp.set(DIM.capeAnchor[0], DIM.capeAnchor[1], DIM.capeAnchor[2]));
    for (let i = 0; i < 3; i++) {
      const c = this.capeAng[i];
      const absX = gx + 0.1 + flare * CAPE_FLARE[i] + Math.sin(this.time * 9 + i * 1.3) * 0.06 * sp;
      const absZ = gz + side * CAPE_SWAY[i] + Math.sin(this.time * 7 + i) * 0.03 * sp;
      const minX = i === 0 ? 0.06 : -0.45, maxX = i === 0 ? 1.8 : 1.1;
      const tx = clamp(absX - parentX, minX, maxX);
      const tz = clamp(absZ - parentZ, -0.8, 0.8);
      for (let s = 0; s < steps; s++) {
        c.vx += (CAPE_K[i] * (tx - c.x) - CAPE_C[i] * c.vx) * h;
        c.vz += (CAPE_K[i] * (tz - c.z) - CAPE_C[i] * c.vz) * h;
        c.x += c.vx * h;
        c.z += c.vz * h;
      }
      if (!Number.isFinite(c.x + c.z + c.vx + c.vz)) {
        c.x = tx;
        c.z = tz;
        c.vx = c.vz = 0;
      }
      c.x = clamp(c.x, minX, maxX);
      c.z = clamp(c.z, -0.8, 0.8);

      // ground: if this segment would end below the grass, pick the nearest swing angle that
      // keeps it above (or the highest one available) and kill the velocity into the ground
      const len = DIM.capeSeg[i];
      _m4.makeRotationFromQuaternion(_qa);
      const e = _m4.elements;
      if (capeEndY(_sp.y, len, e[1], e[5], e[9], c.x, c.z) < CAPE_FLOOR) {
        let best = c.x, bestD = Infinity, hiX = c.x, hiY = -Infinity;
        for (let k = 0; k <= 12; k++) {
          const ax = minX + ((maxX - minX) * k) / 12;
          const y = capeEndY(_sp.y, len, e[1], e[5], e[9], ax, c.z);
          if (y >= CAPE_FLOOR && Math.abs(ax - c.x) < bestD) {
            bestD = Math.abs(ax - c.x);
            best = ax;
          }
          if (y > hiY) {
            hiY = y;
            hiX = ax;
          }
        }
        c.x = bestD < Infinity ? best : hiX;
        c.vx = 0;
      }

      r.cape[i].rotation.set(c.x, 0, c.z);
      parentX += c.x;
      parentZ += c.z;
      _qa.multiply(_qb.setFromEuler(_ceul.set(c.x, 0, c.z, 'YXZ')));
      _sp.add(_w.set(0, -len, 0).applyQuaternion(_qa));
    }
  }
}
