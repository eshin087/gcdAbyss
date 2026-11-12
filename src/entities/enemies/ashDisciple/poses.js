import { P, v3, to3, dirLerp, loco, turnTwist } from '../../player/anim.js';
import { DIM } from '../../player/model.js';
import { clamp, lerp, smoothstep, TAU } from '../../../core/math.js';

// The Ash Disciple's own animation on the hero's skeleton and animator (anim.js HeroAnimator with a
// per-instance pose table: { loco: duelLoco, duel: duelClip }). Nothing here mirrors the hero: his
// stance is a jian guard, and every move or reaction is a KEYFRAME CLIP compiled from data (moves.js).
//
// Pose channels are anim.js's (P): body space = the waist pivot's axes, +x his LEFT, +y up, +z
// forward; hand targets are offsets from each shoulder (|offset| <= 0.55); feet are model space
// (ground-relative). Blade direction is keyed as [az, el]: azimuth round the body (0 = ahead,
// + = his left) and elevation (rad), so a swing is authored as an arc, never a lerp through the body.
//
// A clip key: { t (s from the clip start), e?: ease of the segment ending here
//   ('s' smooth, the default; 'l' linear; 'i' ease-in (a strike accelerating); 'o' ease-out; 'h' hold),
//   bX bY bZ pitch yaw roll hip hipZ hipX spX spY spZ hdX hdY hdZ two flat rFy lFy   (scalars)
//   rH rP lH lP swF rK lK   ([x, y, z])      rF lF   ([x, z] on the ground, or [x, y, z])
//   sw   ([az, el] of the blade)
//   arm ext lead   (not pose channels: the blade-driven arm, below) }
// The blade-driven arm: with `arm` 1 the sword hand is not keyed but follows the blade, as the hero's
// swings do (anim.js slashH): the fist on a circle round the shoulder at the blade's azimuth (+ `lead`
// rad: the fist runs ahead of the blade into a strike and the blade whips past it after), out to
// `ext` (0 folded … 1 at full reach), higher as the blade rises; the chest and hips turn with the
// blade. `arm` 0..1 blends from the keyed hand, so a clip eases in from the guard. A cut is then
// authored as the blade's path alone, and the arm can never fight the steel.
// A field missing from a key is interpolated between the keys that have it; before its first key it
// comes from the stance (the clip starts from his guard) and, unless the clip says `hold: true`, it
// returns to the stance at the clip's end.

const ANK = DIM.ankle;
const SCALAR = {
  bX: P.bodyX, bY: P.bodyY, bZ: P.bodyZ, pitch: P.pitch, yaw: P.yaw, roll: P.roll,
  hip: P.pelvY, hipZ: P.pelvZ, hipX: P.pelvX, spX: P.spX, spY: P.spY, spZ: P.spZ,
  hdX: P.hdX, hdY: P.hdY, hdZ: P.hdZ, two: P.twoHand, flat: P.footFlat, rFy: P.rFy, lFy: P.lFy,
};
const VEC = { rH: P.rH, rP: P.rP, lH: P.lH, lP: P.lP, swF: P.swF, rK: P.rK, lK: P.lK, rF: P.rF, lF: P.lF };
/** The blade-driven arm's channels (not pose channels: evalClip applies them; their guard values). */
const ARM = { arm: 0, ext: 0.75, lead: 0 };
const FEET = new Set(['rF', 'lF']);

/** His guard (no breathing): the static pose clips start from and return to. Exported for the data.
 *  The owner's pick of three (2026-11-12, "A"): the classic jian guard. Side-on and sunk, the right
 *  foot forward; the jian held out at chest height pointing straight at the opponent; the free hand's
 *  sword-finger raised in an arc over the head. */
const GUARD_BASE = Object.freeze({
  bX: 0.02, bY: -0.16, bZ: 0.02, pitch: 0.02, yaw: 0.62, roll: 0,
  hip: 0.08, hipZ: 0.03, hipX: 0.02, spX: 0.06, spY: -0.18, spZ: -0.02,
  hdX: 0.04, hdY: -0.5, hdZ: 0.02, two: 0, flat: 0.95, rFy: -0.25, lFy: 0.9,
  rH: [0.02, -0.12, 0.44], rP: [-0.7, -0.6, -0.2], lH: [-0.08, 0.5, -0.04], lP: [0.8, 0.4, -0.3],
  swF: [0, 1, 0], rK: [-0.3, 0, 1], lK: [0.6, 0, 0.8],
  rF: [-0.12, ANK, 0.36], lF: [0.2, ANK, -0.3],
  sw: [-0.52, 0.14],
});
export const GUARD = GUARD_BASE;

const _az = [0, 0];
/** [az, el] of a direction (body axes). */
export function azEl(x, y, z, out = _az) {
  out[0] = Math.atan2(x, z);
  out[1] = Math.atan2(y, Math.hypot(x, z));
  return out;
}
function setSw(p, az, el) {
  const c = Math.cos(el);
  v3(p, P.swD, c * Math.sin(az), Math.sin(el), c * Math.cos(az));
}

/** Write the guard into p (with a slow breath when `A` has a time). */
export function duelStance(p, A) {
  const G = GUARD;
  const ph = (A?.time ?? 0) * (TAU / 2.8);
  const br = Math.sin(ph), sw = Math.sin(ph * 0.5 + 0.7);
  for (const k in SCALAR) p[SCALAR[k]] = G[k];
  for (const k in VEC) v3(p, VEC[k], G[k][0], G[k][1], G[k][2]);
  p[P.bodyY] += 0.006 * br;
  p[P.spX] += 0.012 * br;
  p[P.bodyX] += 0.006 * sw;
  p[P.lH + 1] += 0.008 * br;
  setSw(p, G.sw[0] + 0.012 * sw, G.sw[1] + 0.01 * br);
  p[P.rFf] = 1;
  p[P.lFf] = 1;
  p[P.flask] = 0;
}

const SCR = new Float32Array(64);
const LEGS = [P.rF, P.rF + 1, P.rF + 2, P.lF, P.lF + 1, P.lF + 2, P.rK, P.rK + 1, P.rK + 2, P.lK, P.lK + 1, P.lK + 2, P.footFlat, P.rFy, P.lFy, P.rFf, P.lFf,
  P.bodyX, P.bodyY, P.bodyZ, P.pitch, P.roll, P.pelvX, P.pelvY, P.pelvZ, P.spX, P.spZ];

/**
 * Locomotion: his guard on the hero's gait. Walking and circling he keeps the guard up; at a run
 * the jian trails low behind him and the free arm swings. The legs, hips and the body's bob and lean
 * come from the hero's gait (anim.js loco), so the foot planner keeps his feet planted.
 */
export function duelLoco(p, A) {
  duelStance(p, A);
  const w = A.moveW;
  if (w < 0.002 && A.swordW < 0.002) {
    turnTwist(p, A);
    jolt(p, A);
    return;
  }
  // the hero's gait into scratch, without its turn twist (applied once, below, to the whole pose)
  const lag = A.turnLag;
  A.turnLag = 0;
  loco(SCR, A);
  A.turnLag = lag;
  // circling he keeps his body turned (the stance's yaw); running he squares up to the run
  const runK = smoothstep(2.4, 4.2, A.speedS);
  for (const i of LEGS) p[i] += (SCR[i] - p[i]) * w;
  // (walking he keeps most of his side-on guard; running he squares up to the run)
  p[P.yaw] = lerp(GUARD.yaw, lerp(0.45, 0.06, runK), w);
  p[P.spY] = lerp(GUARD.spY, 0, runK);
  p[P.hdY] = lerp(GUARD.hdY + 0.06, -0.04, runK);
  // the sword arm: guard while walking → trailing low behind at a run
  const k = runK * w;
  to3(p, P.rH, -0.13, -0.42, -0.1, k);
  to3(p, P.rP, -0.8, -0.3, -0.5, k);
  {
    const a0 = Math.atan2(p[P.swD], p[P.swD + 2]), e0 = Math.asin(clamp(p[P.swD + 1], -1, 1));
    setSw(p, lerp(a0, -2.55, k), lerp(e0, -0.42, k));
  }
  to3(p, P.swF, 0.2, 1, 0, k);
  // the free arm: the sword-finger comes down to swing with the stride at a run
  to3(p, P.lH, SCR[P.lH], SCR[P.lH + 1], SCR[P.lH + 2], k);
  to3(p, P.lP, SCR[P.lP], SCR[P.lP + 1], SCR[P.lP + 2], k);
  turnTwist(p, A);
  jolt(p, A);
}

/**
 * The hit jolt (A.recoil 0..1: the pilot's `recoil`, set by disciple.js when a blow lands on him and
 * decaying over ~0.2 s): the chest and head snap back from the blow, the sword hand is knocked back,
 * the body sags a little. Additive on any pose, so a strike landed mid-move shows without cancelling it.
 */
function jolt(p, A) {
  const k = clamp(A?.recoil ?? 0, 0, 1);
  if (!(k > 0.001)) return;
  p[P.spX] -= 0.24 * k;
  p[P.hdX] -= 0.28 * k;
  p[P.pitch] -= 0.1 * k;
  p[P.bodyZ] -= 0.07 * k;
  p[P.bodyY] -= 0.04 * k;
  p[P.spZ] += 0.08 * k;
  p[P.rH + 2] -= 0.1 * k;
  p[P.rH + 1] += 0.05 * k;
}

// ---------------------------------------------------------------- clips
const EASE = {
  s: (u) => u * u * (3 - 2 * u),
  l: (u) => u,
  i: (u) => u * u,
  o: (u) => 1 - (1 - u) * (1 - u),
  h: () => 0,
};

const STANCE = new Float32Array(64);
duelStance(STANCE, null);

/** A field's value in the guard (the implicit first / last key). */
function guardValue(k) {
  if (k === 'sw') return [GUARD.sw[0], GUARD.sw[1]];
  if (k in ARM) return ARM[k];
  const v = GUARD[k];
  return Array.isArray(v) ? v.slice() : v;
}

function normValue(k, v) {
  if (FEET.has(k) && Array.isArray(v) && v.length === 2) return [v[0], ANK, v[1]];
  return Array.isArray(v) ? v.slice() : v;
}

/**
 * Compile keys into tracks. `keys`: [{ t, e?, ...fields }] (any order; t in seconds), `dur` the clip's
 * length, `hold` (default false): the fields keep their last keyed value to the end instead of
 * returning to the guard by `dur`. Build time only (allocates).
 */
export function compileClip(keys, dur, { hold = false } = {}) {
  const list = keys.filter((k) => k && Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  const fields = new Set();
  for (const k of list) for (const f of Object.keys(k)) if (f !== 't' && f !== 'e' && (f in SCALAR || f in VEC || f in ARM || f === 'sw')) fields.add(f);
  const tracks = [];
  for (const f of fields) {
    const T = [], V = [], E = [];
    const first = list.find((k) => f in k);
    if (first.t > 1e-4) {
      T.push(0);
      V.push(guardValue(f));
      E.push('s');
    }
    for (const k of list) {
      if (!(f in k)) continue;
      T.push(k.t);
      V.push(normValue(f, k[f]));
      E.push(k.e ?? 's');
    }
    if (!hold && T[T.length - 1] < dur - 1e-4) {
      T.push(dur);
      V.push(guardValue(f));
      E.push('s');
    }
    tracks.push({ f, T, V, E, vec: f in VEC, sw: f === 'sw', arm: f in ARM, ch: f in VEC ? VEC[f] : SCALAR[f] });
  }
  return { tracks, dur };
}

const AX = { arm: 0, ext: 0.75, lead: 0 };
/** Evaluate a compiled clip at time t into p (over the guard). */
export function evalClip(p, clip, t, A) {
  duelStance(p, A);
  AX.arm = ARM.arm;
  AX.ext = ARM.ext;
  AX.lead = ARM.lead;
  if (!clip?.tracks) {
    jolt(p, A);
    return;
  }
  for (const tr of clip.tracks) {
    const T = tr.T, n = T.length;
    let i = 1;
    while (i < n && t > T[i]) i++;
    let a, b, u;
    if (i >= n) {
      a = b = tr.V[n - 1];
      u = 0;
    } else if (t <= T[0]) {
      a = b = tr.V[0];
      u = 0;
    } else {
      a = tr.V[i - 1];
      b = tr.V[i];
      u = EASE[tr.E[i]]?.(clamp((t - T[i - 1]) / Math.max(1e-6, T[i] - T[i - 1]), 0, 1)) ?? 0;
    }
    if (tr.sw) setSw(p, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
    else if (tr.vec) v3(p, tr.ch, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    else if (tr.arm) AX[tr.f] = a + (b - a) * u;
    else p[tr.ch] = a + (b - a) * u;
  }
  bladeArm(p, AX.arm, AX.ext, AX.lead);
  jolt(p, A);
}

const ARM_R = [0.2, 0.46]; // the fist's radius round the shoulder: folded … full reach
/** The sword hand (and elbow, chest, hips) from the blade (see the header): blended in by `w`. */
function bladeArm(p, w, ext, lead) {
  if (!(w > 0.001)) return;
  w = Math.min(1, w);
  const dx = p[P.swD], dy = p[P.swD + 1], dz = p[P.swD + 2];
  const az = Math.atan2(dx, dz), el = Math.asin(clamp(dy, -1, 1));
  const e = clamp(ext, 0, 1);
  const ha = az + lead, hs = Math.sin(ha), hc = Math.cos(ha);
  const r = lerp(ARM_R[0], ARM_R[1], e);
  // folded, the fist sits nearer shoulder height whatever the blade's pitch (a cocked arm)
  const hy = lerp(-0.18 + el * 0.3, -0.32 + el * 0.55, e) + 0.12 * Math.max(0, hs) * e;
  to3(p, P.rH, hs * r, hy, hc * r + 0.12 * e, w);
  to3(p, P.rP, lerp(-0.85, -0.35, e), lerp(-0.4, -0.95, e), lerp(-0.3, -0.4, e), w);
  // the chest and hips turn with the blade, the eyes stay on the opponent
  const tw = clamp(az, -2.3, 2.2);
  p[P.pelvY] += tw * 0.12 * w;
  p[P.spY] += tw * 0.2 * w;
  p[P.hdY] -= tw * 0.24 * w;
  // a blade low across the body leans the chest over it; raised, the chest opens
  p[P.spX] += (0.08 - 0.08 * Math.max(0, el)) * w * e;
}

/** The clip the animator plays under the key 'duel': the pilot's atk.def is a compiled clip. */
export function duelClip(p, A) {
  evalClip(p, A.def, A.t, A);
}

/** The pose table HeroAnimator takes for him. */
export const DUEL_POSES = Object.freeze({ loco: duelLoco, duel: duelClip });

export { dirLerp };
