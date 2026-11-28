import { DIM } from '../../player/model.js';
import { P, to3 } from '../../player/anim.js';
import { createDuelPoses } from '../duelist/poses.js';
import { GUARDS } from '../ascendant/poses.js';
import { lookOf } from '../duelist/lookSwitch.js';
import { TUNING } from './tuning.js';

// Halcyon's stance and the pose functions built round it (duelist/poses.js: the clip format). He fights
// bare-handed (Tian Lei's way: the hands keyed, the engine's blade channel only turns the right fist)
// and he never stands: between his moves he HOVERS (flight.js holds his root at TUNING.fly.hover). His
// footwork pose is not a gait: the legs hang, one knee drawn up, the toes pointed down; he leans into
// the way he glides and the cape streams; in phase 1 the arms are folded (contempt), from phase 2 the
// fists are down and open (pilot.armsK, flight.js).

const ANK = DIM.ankle;

/** His guard: upright, chin up, the fists low (the clips start from and return to it). */
export const GUARD = Object.freeze({
  ...GUARDS[2],
  bY: -0.02, pitch: -0.04, yaw: -0.12, hdX: -0.06, hdY: 0.1,
  rH: [-0.04, -0.42, 0.12], rP: [-0.9, -0.3, -0.3], lH: [0.04, -0.4, 0.14], lP: [0.9, -0.3, -0.3],
  rF: [-0.12, ANK, -0.04], lF: [0.13, ANK, 0.06],
});

const K = createDuelPoses(GUARD, { breath: { k: 0.8, period: 3.6 } });
export const { duelStance, compileClip, completeBeat, evalClip, duelClip } = K;

/** The arms folded across the chest (phase 1's footwork, the wait). */
export const FOLDED = Object.freeze({ rH: [0.2, -0.12, 0.17], rP: [-0.9, -0.3, -0.4], lH: [-0.2, -0.08, 0.19], lP: [0.9, -0.3, -0.4] });

/**
 * The hover (his footwork): the duelist's footwork pose for the body, then the legs hung under him (one
 * knee drawn up), a lean into the glide (A.player.groundVel in his own axes) and the arms folded by
 * A.player.armsK (1 phase 1, 0 later).
 */
export function hoverLoco(p, A) {
  K.duelLoco(p, A);
  const pl = A.player ?? {};
  const t = A.time ?? 0;
  // the legs: the right knee drawn up, the left hanging straight, the toes pointed
  // (ADR-254, `?halMotion=b`: both hang long under him, the knees soft, the feet a little back; after
  // the lean below, so they trail with it: hoverLegs)
  to3(p, P.rF, -0.1, ANK + 0.34, 0.12, 1);
  to3(p, P.lF, 0.12, ANK - 0.02 + 0.02 * Math.sin(t * 1.3), -0.06, 1);
  to3(p, P.rK, -0.1, 0.4, 1, 1);
  to3(p, P.lK, 0.1, 0, 1, 1);
  p[P.footFlat] = 0.2;
  p[P.rFy] = -0.12;
  p[P.lFy] = 0.1;
  // the lean into the glide: forward / back and to the side, from his velocity in his own axes
  const v = pl.groundVel ?? { x: 0, z: 0 }, yaw = pl.yaw ?? 0;
  const fwd = v.x * Math.sin(yaw) + v.z * Math.cos(yaw), side = v.x * Math.cos(yaw) - v.z * Math.sin(yaw);
  const k = Math.min(1, Math.hypot(fwd, side) / 10);
  p[P.pitch] += Math.max(-0.25, Math.min(0.45, fwd * 0.045)) * (0.4 + 0.6 * k);
  p[P.roll] += Math.max(-0.3, Math.min(0.3, -side * 0.03));
  p[P.bodyY] = -0.02;
  // (ADR-289, `?halRefMove=a`) the brake and the bank: his acceleration in his own axes (pilot.halAcc,
  // halcyon.js; zero with the switch off): slowing, he leans back (the long legs of `?halMotion=b` swing
  // forward with the lean, hoverLegs); in a turn he banks into it
  const ac = pl.halAcc;
  if (ac && (ac.f || ac.s)) {
    p[P.pitch] += Math.max(-0.32, Math.min(0.2, ac.f * 0.022));
    p[P.roll] += Math.max(-0.26, Math.min(0.26, -ac.s * 0.02));
  }
  // the arms folded (phase 1), or down and open
  const f = Math.max(0, Math.min(1, pl.armsK ?? 1));
  if (f > 0) {
    to3(p, P.rH, ...FOLDED.rH, f);
    to3(p, P.rP, ...FOLDED.rP, f);
    to3(p, P.lH, ...FOLDED.lH, f);
    to3(p, P.lP, ...FOLDED.lP, f);
  }
  // a fast glide: the arms swept back along the body (the flier's line)
  const g = Math.max(0, Math.min(1, (Math.abs(fwd) - 6) / 6)) * (1 - f * 0.5);
  if (g > 0) {
    to3(p, P.rH, -0.1, -0.36, -0.3, g);
    to3(p, P.lH, 0.1, -0.36, -0.3, g);
    p[P.pitch] += 0.25 * g;
  }
  // (ADR-289, `?halRefMove=a`: the sheets' hover (01 B7, B8), the right knee drawn up, the left hanging, as above)
  if (lookOf('halMotion', '0') === 'b' && lookOf('halRefMove', '0') === '0') hoverLegs(p, t);
}

const LEG = DIM.thigh + DIM.shin;
/** (ADR-254, `?halMotion=b`) His legs hung long under the hover: each foot `k` x the leg from its hip,
 *  `trail` rad back from straight down plus the body's lean, the knees soft and pointing forward, the
 *  toes pointed; the left a little longer and further back (no twinning), a slow sway. No allocation. */
function hoverLegs(p, t) {
  const H = TUNING.motion.b.hover, pitch = p[P.pitch], yaw = p[P.yaw];
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // the hip joints: body axes (±hip x, below the pivot) turned by the pitch, then the yaw
  const hy = DIM.pelvis[1] + DIM.hip[1];
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1, x0 = side * DIM.hip[0];
    const y1 = hy * cp, z1 = hy * sp;
    const hx = x0 * cy + z1 * sy + p[P.bodyX], hY = DIM.pivot + p[P.bodyY] + y1, hz = -x0 * sy + z1 * cy + p[P.bodyZ];
    // (a foot is held over his root's floor, anim.js FOOT_FLOOR: a low hip takes its leg further back)
    const d = H.k[i] * LEG, low = Math.acos(Math.min(1, Math.max(-1, (hY - ANK - 0.04) / d)));
    const tr = Math.max(H.trail[i] + pitch, low) + 0.03 * Math.sin(t * 1.1 + i * 1.7);
    const fx = side * 0.03, fz = -Math.sin(tr) * d;
    to3(p, i ? P.lF : P.rF, hx + fx * cy + fz * sy, Math.max(ANK + 0.02, hY - Math.cos(tr) * d), hz - fx * sy + fz * cy, 1);
    to3(p, i ? P.lK : P.rK, side * 0.1, -0.35, 1, 1);
  }
  p[P.footFlat] = 0.05;
  p[P.rFy] = -0.08;
  p[P.lFy] = 0.08;
}

/** The pose table HeroAnimator takes for him. */
export const HAL_POSES = Object.freeze({ loco: hoverLoco, duel: K.POSES.duel });
