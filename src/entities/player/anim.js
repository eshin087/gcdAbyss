import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, easeOutCubic, easeInOutSine, wrapAngle, TAU } from '../../core/math.js';
import { DIM, HAIR_CLUSTERS } from './model.js';

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
};
const N = 46;
const ANGLES = [P.pitch, P.yaw, P.roll];
const ANK = DIM.ankle;
const LEG_IDX = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rK, P.rK + 1, P.rK + 2, P.lK, P.lK + 1, P.lK + 2, P.footFlat];
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

const SCRATCH = new Float32Array(N);
const SCR_LEGS = new Float32Array(N);

// ---------------------------------------------------------------- poses
// A = the animator: time, t (clip time), moveW, sprintW, speed, phase, mx/mz (move dir in model
// space), def (attack data), chargeK (0..1), releaseK (charge of the thrust in flight), recoil.

/** Idle (2.4 s loop): weight on the back leg, hips turned a little off the line, the sword low in
 *  the right hand with its point down and forward, grazing the grass ahead; breathing + sway. */
function guard(p, A) {
  const ph = A.time * (TAU / IDLE_LOOP);
  const br = Math.sin(ph), sw = Math.sin(ph + 1.1);
  p[P.bodyX] = 0.014 * sw;
  p[P.bodyY] = -0.04 + 0.007 * br;
  p[P.bodyZ] = 0;
  p[P.pitch] = 0;
  p[P.yaw] = 0;
  p[P.roll] = 0;
  p[P.pelvY] = -0.26;
  p[P.pelvZ] = 0.035 * sw;
  p[P.spX] = 0.07 + 0.012 * br;
  p[P.spY] = 0.18;
  p[P.spZ] = -0.02 * sw;
  p[P.hdX] = -0.03 + 0.008 * br;
  p[P.hdY] = 0.08;
  v3(p, P.rH, 0.02, -0.43 + 0.008 * br, 0.2);
  v3(p, P.rP, -0.7, -0.3, -1);
  v3(p, P.lH, 0.03, -0.5, -0.03);
  v3(p, P.lP, 0.6, -0.2, -1);
  v3(p, P.swD, 0.16 + 0.015 * sw, -0.6, 0.78);
  v3(p, P.swF, 0.1, 0.78, 0.6);
  v3(p, P.rF, -0.16, ANK, -0.15);
  v3(p, P.lF, 0.13, ANK, 0.16);
  v3(p, P.rK, -0.25, 0, 1);
  v3(p, P.lK, 0.2, 0, 1);
  p[P.footFlat] = 0.92;
  p[P.flask] = 0;
  p[P.twoHand] = 0;
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

/** Idle ↔ walk/run ↔ sprint, blended by moveW / sprintW; works for strafing and backpedalling.
 *  Run: the blade trails low behind. Sprint: a hard forward lean, the sword arm swept back with the
 *  blade nearly level behind, the free fist pumping (the coat streams back on its own). */
function loco(p, A) {
  guard(p, A);
  const w = A.moveW;
  if (w < 0.002) return;
  const s = A.sprintW, sp = A.speed, mx = A.mx, mz = A.mz;
  const ph = A.phase;
  const exc = Math.min(0.48, 0.078 * sp + 0.04);
  const lift = lerp(0.14, 0.26, s) * Math.min(1, sp / 3 + 0.3);
  footCycle(p, P.lF, 0.11, ph, mx * 0.75, mz, exc, lift, w);
  footCycle(p, P.rF, -0.11, ph + 0.5, mx * 0.75, mz, exc, lift, w);
  p[P.footFlat] = lerp(p[P.footFlat], 0.55, w);
  to3(p, P.rK, -0.1, 0, 1, w);
  to3(p, P.lK, 0.1, 0, 1, w);

  const cs = Math.cos(ph * TAU); // +1 when the left foot is planted forward
  const bob = Math.cos(ph * TAU * 2);
  const fwd = mz > 0 ? mz : 0;
  p[P.bodyY] = lerp(p[P.bodyY], -0.05 - 0.06 * s + 0.022 * bob, w);
  p[P.bodyX] = lerp(p[P.bodyX], 0, w);
  p[P.bodyZ] = lerp(p[P.bodyZ], 0.06 * s * fwd, w);
  p[P.pelvY] = lerp(p[P.pelvY], -0.12 * cs * mz - 0.08, w);
  p[P.pelvZ] = lerp(p[P.pelvZ], 0, w);
  const lean = lerp(0.14, 0.55, s) * Math.min(1, sp / 4);
  p[P.spX] = lerp(p[P.spX], 0.05 + lean * (mz > 0 ? mz : mz * 0.4), w);
  p[P.spZ] = lerp(p[P.spZ], -lean * mx * 0.6, w);
  p[P.spY] = lerp(p[P.spY], 0.1 * cs * mz + 0.06, w);
  p[P.hdX] = lerp(p[P.hdX], -0.04 - p[P.spX] * 0.6, w);
  p[P.hdY] = lerp(p[P.hdY], 0, w);

  // sword arm: low at the hip with the blade trailing behind (run) → swept back, blade level (sprint)
  const amp = 0.2 * (1 + 0.5 * s) * cs * mz;
  to3(p, P.rH, lerp(0.0, -0.05, s), lerp(-0.42, -0.3, s) + 0.04 * Math.max(0, cs * mz), lerp(0.04 + amp * 0.4, -0.36, s), w);
  to3(p, P.rP, -0.6, lerp(-0.3, 0.2, s), -1, w);
  to3(p, P.swD, lerp(-0.3, -0.14, s), lerp(-0.45, -0.12, s), lerp(-0.84, -0.98, s), w);
  to3(p, P.swF, 0.2, 1, 0, w);
  // free arm pumps opposite the legs (a forward fist when sprinting)
  to3(p, P.lH, -0.03 - 0.06 * s, -0.38 + 0.08 * Math.max(0, -cs * mz) + 0.12 * s, 0.1 - amp + 0.1 * s, w);
  to3(p, P.lP, 0.6, -0.6, -0.6, w);
}

/** Blend only the legs toward the walking gait (block / charge can move). */
function walkLegs(p, A) {
  const w = A.moveW;
  if (w < 0.01) return;
  loco(SCR_LEGS, A);
  for (const i of LEG_IDX) p[i] += (SCR_LEGS[i] - p[i]) * w;
}

/** Wide fighting stance (left foot forward), knees bent. lunge 0..1 sinks into the strike. */
function stance(p, A, lunge) {
  guard(p, A);
  v3(p, P.rF, -0.18, ANK, -0.24);
  v3(p, P.lF, 0.15, ANK, 0.28 + 0.1 * lunge);
  v3(p, P.rK, -0.35, 0, 1);
  v3(p, P.lK, 0.3, 0, 1);
  p[P.bodyX] = 0;
  p[P.bodyY] = -0.1 - 0.06 * lunge;
  p[P.bodyZ] = 0.06 * lunge;
  p[P.pelvZ] = 0;
  p[P.footFlat] = 0.9;
}

/** Horizontal sweep with the blade at azimuth th (0 = ahead, + = the hero's left), pitch elev. */
function slashH(p, A, th, elev, lunge) {
  stance(p, A, lunge);
  const s = Math.sin(th), c = Math.cos(th);
  const tw = clamp(th, -2.3, 2);
  p[P.pelvY] = -0.1 + tw * 0.16;
  p[P.spY] = tw * 0.32;
  p[P.spX] = 0.18;
  p[P.spZ] = -0.06 * s;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.75; // eyes stay on the target
  p[P.hdX] = -0.02;
  setLen(p, P.rH, s * 0.92, -0.36 + elev * 0.45, c * 0.92 + 0.2, 0.52);
  v3(p, P.rP, -0.3, -1, -0.45);
  v3(p, P.swD, s, elev, c);
  v3(p, P.swF, 0, 1, 0); // flat to the sky: the blade's width (and its glow) faces the camera
  // free arm thrown out opposite the blade for balance
  v3(p, P.lH, 0.14 - 0.22 * s, -0.34, -0.02 - 0.2 * c);
  v3(p, P.lP, 0.9, -0.2, -0.5);
}

/** Two-handed overhead slam: blade elevation ang from the overhead coil (a0) down into the ground
 *  (a1). The torso arches back on the raise and folds hard over the impact; both hands on the grip. */
function slamPose(p, A, ang, lunge, a0, a1) {
  stance(p, A, lunge);
  const q = clamp((a0 - ang) / (a0 - a1 || 1), -0.2, 1.1); // 0 raised → 1 struck
  const qc = clamp(q, 0, 1);
  const e = clamp(ang, -0.62, 1.95); // the hands stop circling where the arms can't follow
  const s = Math.sin(e), c = Math.cos(e);
  v3(p, P.rH, 0.17, 0.46 * s, 0.46 * c + 0.02);
  v3(p, P.rP, -0.9, 0.1, -0.4);
  v3(p, P.lP, 0.9, 0.1, -0.4);
  v3(p, P.swD, 0.02, Math.sin(ang), Math.cos(ang));
  v3(p, P.swF, 1, 0, 0);
  p[P.twoHand] = 1;
  p[P.spX] = lerp(-0.3, 0.55, q);
  p[P.spY] = -0.08;
  p[P.spZ] = 0;
  p[P.pelvY] = -0.1;
  p[P.hdX] = lerp(-0.22, 0.28, qc);
  p[P.hdY] = 0.06;
  p[P.bodyY] = lerp(0.0, -0.24, qc) - 0.04 * lunge;
  p[P.bodyZ] = lerp(-0.04, 0.1, qc);
  v3(p, P.rF, -0.19, ANK, -0.34);
  v3(p, P.lF, 0.18, ANK, 0.32 + 0.12 * lunge);
  v3(p, P.rK, -0.45, 0, 1);
  v3(p, P.lK, 0.4, 0, 1);
}

/** Charge stance (also the thrust's start): low, wide and coiled, hips and chest turned so the
 *  sword side is back; the blade drawn back beside the chest, level along the attack line, the
 *  free hand reaching forward to aim. k = charge 0..1, sink 0..1 = how far into the crouch. */
function chargeStance(p, A, k, sink) {
  stance(p, A, 0);
  p[P.bodyY] = -0.1 - (0.12 + 0.05 * k) * sink;
  p[P.pelvY] = -0.12 - 0.45 * sink;
  p[P.spY] = -0.22 * sink;
  p[P.spX] = 0.16 + (0.14 + 0.06 * k) * sink;
  p[P.spZ] = 0;
  p[P.hdY] = -(p[P.pelvY] + p[P.spY]) * 0.75; // eyes stay on the target
  p[P.hdX] = -0.06 - 0.05 * sink;
  to3(p, P.rH, -0.12, -0.2, -0.42, 0.35 + 0.65 * sink);
  v3(p, P.rP, -0.4, -0.6, -0.6);
  to3(p, P.swD, 0.05, -0.1, 1, 0.35 + 0.65 * sink);
  v3(p, P.swF, 0, 1, 0);
  to3(p, P.lH, -0.08, -0.14, 0.44, sink);
  v3(p, P.lP, 0.8, -0.4, -0.3);
  v3(p, P.rF, -0.22, ANK, -0.42);
  v3(p, P.lF, 0.18, ANK, 0.4);
  v3(p, P.rK, -0.45, 0, 1);
  v3(p, P.lK, 0.35, 0, 1);
}

/** The lunging thrust (charge release): from the coiled stance the sword hand drives straight down
 *  the line to full extension, the front knee bends deep, the back leg straightens, the hips square
 *  up and the free arm swings back. The root itself travels forward (player.js). */
function thrustPose(p, A, t, W, Ac) {
  const k = clamp(A.releaseK, 0, 1);
  chargeStance(p, A, k, 1);
  if (t < W) return;
  const v = clamp((t - W) / Ac, 0, 1);
  const e = easeOutCubic(v);
  p[P.bodyY] = lerp(p[P.bodyY], -0.22, e);
  p[P.bodyZ] = lerp(0, 0.12, e);
  p[P.pelvY] = lerp(p[P.pelvY], -0.12, e);
  p[P.spY] = lerp(p[P.spY], 0.02, e);
  p[P.spX] = lerp(p[P.spX], 0.4, e);
  p[P.hdY] = lerp(p[P.hdY], 0.08, e);
  to3(p, P.rH, 0.06, -0.12, 0.52, e);
  v3(p, P.rP, -0.6, -0.5, -0.4);
  to3(p, P.swD, 0.02, -0.04, 1, e);
  to3(p, P.lH, 0.14, -0.3, -0.28, e);
  to3(p, P.lF, 0.18, ANK, 0.62, e);
  to3(p, P.rF, -0.2, ANK, -0.6, e);
}

/** Light sweeps, the slam and the thrust. Windup coils (the cross-fade carries the body into the
 *  coil), the active frames sweep the arc a0 → a1, recovery follows through then eases back to the
 *  idle stance. A light attack whose button is still held freezes at the coil (A.t is held at the
 *  windup end). */
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
    let ang, lunge, u;
    if (t < W) {
      ang = lerp(k.a0, coil, easeOutCubic(t / W));
      lunge = 0;
      u = 0;
    } else if (t < W + Ac) {
      const v = (t - W) / Ac;
      const e = slam ? v * v * (3 - v * 2) * (0.6 + 0.4 * v) + 0.4 * v * v * (1 - v) : v * v * (3 - 2 * v);
      ang = lerp(coil, k.a1, clamp(e, 0, 1));
      lunge = e;
      u = e;
    } else {
      ang = lerp(k.a1, k.a2, easeOutCubic(clamp((t - W - Ac) / (R * 0.45), 0, 1)));
      lunge = 1;
      u = 1;
    }
    if (slam) slamPose(p, A, ang, lunge, k.a0, k.a1);
    else slashH(p, A, ang, lerp(k.elev0 ?? k.elev ?? -0.1, k.elev ?? -0.1, u), lunge);
  }
  const rec = (t - W - Ac) / R;
  if (rec > 0.45) {
    guard(SCRATCH, A);
    blend(p, p, SCRATCH, smoothstep(0.45, 1, rec));
  }
}

/** Charge: sink into the low coiled stance, blade drawn back and level; deepens with the charge,
 *  trembles when full. The legs can still walk (slowly). */
function chargePose(p, A) {
  const k = clamp(A.chargeK, 0, 1);
  chargeStance(p, A, k, smoothstep(0, 0.25, A.t));
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
  v3(p, P.rF, -0.19, ANK, -0.18);
  v3(p, P.lF, 0.15, ANK, 0.2);
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
  to3(p, P.swD, -0.55, 0.8, 0.5, f);
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
  to3(p, P.swD, -0.25, -0.2, 1, rise * 0.6);
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
  to3(p, P.swD, -0.3, 0.85, -0.35, k);
  to3(p, P.swF, 1, 0, 0, k);
  to3(p, P.lH, 0.35, -0.1, 0.05, k);
  const st = smoothstep(0.1, 0.3, t);
  v3(p, P.lF, 0.14, ANK + 0.1 * Math.sin(Math.PI * st), 0.14 - 0.4 * st);
  p[P.rF + 2] -= 0.1 * st;
}

/** Dodge (0.6 s): a low crouched dive into one tucked forward roll, the sword held out to the side
 *  and trailing, then up into a crouch with the blade ready (the coat is kicked out by player.js). */
function rollPose(p, A) {
  const t = A.t;
  guard(p, A);
  const tuck = smoothstep(0, 0.1, t) * (1 - smoothstep(0.44, 0.6, t));
  const spin = easeInOutSine(clamp((t - 0.04) / 0.46, 0, 1));
  const crouch = smoothstep(0.42, 0.52, t) * (1 - smoothstep(0.52, 0.6, t));
  p[P.pitch] = spin * TAU;
  p[P.bodyX] = 0;
  p[P.bodyY] = -0.04 - 0.6 * tuck - 0.16 * crouch; // the ground clamp in apply() lifts the ball as it turns
  p[P.pelvY] = lerp(p[P.pelvY], 0, tuck);
  p[P.spY] = lerp(p[P.spY], 0, tuck);
  p[P.spZ] = 0;
  p[P.spX] = lerp(p[P.spX], 0.95, tuck) + 0.3 * crouch;
  p[P.hdX] = lerp(p[P.hdX], 0.75, tuck);
  to3(p, P.rH, -0.12, -0.3, 0.22, tuck);
  to3(p, P.lH, -0.08, -0.3, 0.3, tuck);
  to3(p, P.swD, -0.75, -0.2, -0.62, tuck); // blade out to the side and back, clear of the body
  to3(p, P.swF, 0, 1, 0, tuck);
  bodyPointTo(p, P.rF, -0.12, -0.42, 0.2, tuck); // knees to chest
  bodyPointTo(p, P.lF, 0.12, -0.4, 0.22, tuck);
  to3(p, P.rK, -0.2, 0.5, 1, tuck);
  to3(p, P.lK, 0.2, 0.5, 1, tuck);
  p[P.footFlat] = lerp(p[P.footFlat], 0, tuck);
  if (crouch > 0) {
    to3(p, P.rF, -0.2, ANK, -0.3, crouch);
    to3(p, P.lF, 0.16, ANK, 0.3, crouch);
    to3(p, P.swD, -0.3, -0.4, 0.86, crouch * 0.7);
  }
}

/** Backstep: short hop backward, blade forward. */
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
  to3(p, P.swD, -0.1, -0.15, 1, k);
  to3(p, P.lH, -0.06, -0.3, 0.3, k);
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
  p[P.hdX] = lerp(p[P.hdX], -0.38, drink);
  p[P.spX] = lerp(p[P.spX], 0.0, drink);
  p[P.hdY] = lerp(p[P.hdY], 0, raise);
  // sword arm rests low at the side
  to3(p, P.rH, 0.03, -0.46, 0.14, raise);
  to3(p, P.swD, 0.1, -0.6, 0.75, raise);
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
  to3(p, P.swD, -0.7, -0.25, 0.6, k);
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
  bodyPointTo(p, P.rF, -0.12, -1.0, 0.04, lie); // legs laid out along the body
  bodyPointTo(p, P.lF, 0.12, -1.0, 0.08, lie);
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
  to3(p, P.swD, -0.05, -0.75, 0.66, kneel);
  to3(p, P.swF, 1, 0, 0, kneel);
  to3(p, P.lH, -0.06, -0.45, 0.24, kneel);
  const flat = kf(t, DEATH.flat);
  bodyPointTo(p, P.rF, -0.12, -1.0, -0.06, flat);
  bodyPointTo(p, P.lF, 0.12, -1.0, -0.04, flat);
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
const WALK_KEYS = new Set(['loco', 'heal', 'block', 'charge']); // clips whose feet emit footsteps


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
const _G = new THREE.Vector3(), _TL = new THREE.Vector3(), _qId = new THREE.Quaternion();

const TIP_FLOOR = -0.03; // the sword tip may graze into the grass, no deeper
const HAND_FLOOR = 0.1; // grip / off-hand centre height floor
const FOOT_FLOOR = 0.06; // ankle height floor

// coat skirt springs: [upper, lower] segment stiffness / damping / how much velocity swings them
const COAT_K = [120, 85];
const COAT_C = [13, 9.5];
const COAT_LAG = [0.09, 0.13]; // long torn tails: they stream behind runs, sprints and rolls
const COAT_FLARE = 0.16; // resting outward flare from the hips
const COAT_FLOOR = 0.04; // panel ends stay this far above the ground
const COAT_A = [[-1.5, 0.3], [-1.0, 0.6]]; // outward (−) / inward (+) swing limits per segment
const COAT_B = [0.7, 0.55]; // sideways swing limit per segment
const LEG_R = 0.08; // thigh / knee radius used to push the panels out
const TWO_HAND_GRIP = 0.11; // m down the grip from the sword hand to the off hand (two-handed)
const PAULDRON_FOLLOW = 0.35; // how much of the sword arm's swing the shoulder armour follows
// hair cluster springs (rotation vector, head space)
const HAIR_K = 170, HAIR_C = 13, HAIR_MAX = 0.4;

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
    this.speed = 0;
    this.phase = 0;
    this.mx = 0;
    this.mz = 1;
    this.def = null;
    this.chargeK = 0;
    this.releaseK = 0;
    this.recoil = 0;
    this.onFootstep = null;
    this.coatState = rig.coat.map(() => [{ x: 0, vx: 0, z: 0, vz: 0 }, { x: 0, vx: 0, z: 0, vz: 0 }]);
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
    this.chargeK = 0;
    this.releaseK = 0;
    this.recoil = 0;
    this.key = 'loco';
    guard(this.cur, this);
    this.from.set(this.cur);
    this.target.set(this.cur);
    this.blendT = this.blendDur = 1;
    for (const st of this.coatState) {
      for (const c of st) c.x = c.vx = c.z = c.vz = 0;
    }
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
    this.rig.root.updateMatrixWorld(true);
  }

  /** The body jumped (Ghostep / teleport): forget the last positions so cloth and hair don't
   *  read the jump as a huge velocity. */
  teleported() {
    this.coatInit = false;
    this.hairInit = false;
    for (const v of this.coatVel) v.set(0, 0, 0);
    for (const h of this.hairState) h.vel.set(0, 0, 0);
  }

  /** Throw the coat panels outward (Ghostep reappear, guard break). */
  kickCoat(power = 1) {
    const k = clamp(fin(power), 0, 3);
    for (let i = 0; i < this.coatState.length; i++) {
      const st = this.coatState[i];
      st[0].vx -= k * (3 + 1.5 * Math.random());
      st[1].vx -= k * (4 + 2 * Math.random());
      st[1].vz += k * (Math.random() - 0.5) * 3;
    }
  }

  update(dt) {
    const pl = this.player;
    this.time += dt;
    this.t = fin(pl.animT, fin(pl.stateT));
    this.def = pl.atk ? pl.atk.def : null;
    this.chargeK = fin(pl.chargeK);
    this.releaseK = fin(pl.releaseK);
    this.recoil = fin(pl.recoil);

    // gait drivers from the hero's actual ground velocity, expressed in model space
    const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw);
    const vx = fin(pl.groundVel.x), vz = fin(pl.groundVel.z);
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
    if (WALK_KEYS.has(this.key) && sp > 0.8 && this.onFootstep) {
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
    this._coat(dt);
    this._hair(dt);
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
   *  the hem never sinks into the ground. Angles: x = swing (− outward), z = sideways. */
  _coat(dt) {
    const r = this.rig;
    const steps = dt > 0 ? Math.min(8, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
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

    for (let i = 0; i < r.coat.length; i++) {
      const C = r.coat[i], D = C.def, st = this.coatState[i];
      _pa.setFromMatrixPosition(C.anchor.matrixWorld); // anchors are rigid on the pelvis: current since apply()
      if (this.coatInit && dt > 1e-4) {
        _v.subVectors(_pa, this.coatPrev[i]).divideScalar(dt);
        if (_v.lengthSq() > 625) _v.setLength(25);
        this.coatVel[i].lerp(_v, 1 - Math.exp(-14 * dt));
      }
      this.coatPrev[i].copy(_pa);
      _v.copy(this.coatVel[i]).applyQuaternion(_qInv); // anchor velocity, pelvis space
      const nx = Math.sin(D.az), nz = Math.cos(D.az); // outward
      const tx = Math.cos(D.az), tz = -Math.sin(D.az); // tangent (anchor +X)
      const flut = Math.min(1, Math.hypot(_v.x, _v.z) / 5);
      const ap = C.anchor.position;
      let parentA = 0, parentB = 0;
      for (let s = 0; s < 2; s++) {
        const c = st[s];
        const lag = COAT_LAG[s];
        const fl = COAT_FLARE + Math.sin(this.time * 9 + i * 1.7 + s * 1.3) * 0.07 * flut;
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
          const halfW = (D.w0 + D.w1) * 0.25;
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
      if (this._hemY(D.len, s0.x, s0.z, s1.x, s1.z) < COAT_FLOOR) {
        const [b0, b1] = COAT_A[1];
        let best1 = s1.x, bestD = Infinity;
        for (let k = 0; k <= 8; k++) {
          const a1 = b0 + ((b1 - b0) * k) / 8;
          if (this._hemY(D.len, s0.x, s0.z, a1, s1.z) >= COAT_FLOOR && Math.abs(a1 - s1.x) < bestD) {
            bestD = Math.abs(a1 - s1.x);
            best1 = a1;
          }
        }
        if (bestD < Infinity) {
          s1.x = best1;
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
                const y = this._hemY(D.len, a0, s0.z * zk, a1, s1.z * zk);
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
          s0.x = ok ? pa : hiA;
          s1.x = ok ? pb : hiB;
          if ((ok ? pz : hiZ) === 0) {
            s0.z = s1.z = 0;
            s0.vz = s1.vz = 0;
          }
          s0.vx = 0;
        }
        s1.vx = 0;
      }
      C.segs[0].rotation.set(s0.x, 0, s0.z);
      C.segs[1].rotation.set(s1.x, 0, s1.z);
    }
    this.coatInit = true;
  }

  /** Hair: each cluster rotates (small rotation vector) so its tips trail the motion of the tips
   *  themselves (head turns included) and sag with tilts; stiff springs, like spiky anime hair. */
  _hair(dt) {
    const r = this.rig;
    const steps = dt > 0 ? Math.min(6, Math.ceil(dt / (1 / 120))) : 0;
    const h = steps ? dt / steps : 0;
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
      // desired tip displacement: against the motion + sag relative to upright
      const wx = -_v.x * 0.03 + _g.x * 0.25;
      const wy = -_v.y * 0.03 + (_g.y + 1) * 0.25;
      const wz = -_v.z * 0.03 + _g.z * 0.25;
      // rotation vector moving the tip by w: d × w
      _axis.set(_d.y * wz - _d.z * wy, _d.z * wx - _d.x * wz, _d.x * wy - _d.y * wx);
      _axis.x += Math.sin(this.time * 1.7 + i * 2.1) * 0.015;
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
