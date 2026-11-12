import { P, v3, guard, turnTwist } from '../anim.js';
import { DIM } from '../model.js';
import { lerp, smoothstep, TAU } from '../../../core/math.js';

// Technique clips for the hero's animator (HeroAnimator's per-instance pose table: player.js passes
// TECH_POSES). Pose channels are anim.js's P: body space (+x his LEFT, +y up, +z forward), hand
// targets as offsets from each shoulder, feet in model space. The counter and the lunge themselves
// play the ordinary thrust (the attack clip with `anim.kind: 'thrust'`).

const ANK = DIM.ankle;

/**
 * The Ash Riposte's stance: Shen Hui's own jian guard, learned. The body turned to lead with the
 * sword side and sunk low, the blade held out at chest height pointing at the opponent (edge up),
 * the free hand in a sword-finger beside the sword wrist; the right foot forward. (The numbers are
 * the Ash Disciple's GUARD, enemies/ashDisciple/poses.js, on the hero's longer blade.)
 */
export const RIPOSTE_STANCE = Object.freeze({
  bodyX: 0.02, bodyY: -0.13, bodyZ: 0.02, yaw: 0.38,
  pelvX: 0.02, pelvY: -0.02, pelvZ: 0.03, spX: 0.09, spY: -0.12, spZ: -0.02,
  hdX: 0.06, hdY: -0.28, hdZ: 0.02,
  rH: [0.06, -0.13, 0.42], rP: [-0.7, -0.55, -0.35], lH: [-0.04, -0.1, 0.38], lP: [0.8, -0.4, -0.3],
  swF: [1, 0.15, 0], rK: [-0.25, 0, 1], lK: [0.55, 0, 0.8],
  rF: [-0.1, 0.3], lF: [0.17, -0.24], rFy: -0.2, lFy: 0.75,
  sw: [-0.36, 0.1], // the blade: [azimuth, elevation] (rad; az + = his left)
});

/** 'technique': the stance (player.state 'technique'). A turned bullet snaps it back (A.recoil). */
function techniquePose(p, A) {
  guard(p, A); // every channel from the ready stance, then the riposte guard over it
  const S = RIPOSTE_STANCE;
  const br = Math.sin((A.time ?? 0) * (TAU / 2.2)); // a held breath, quicker than the idle's
  p[P.bodyX] = S.bodyX;
  p[P.bodyY] = S.bodyY + 0.005 * br;
  p[P.bodyZ] = S.bodyZ;
  p[P.pitch] = 0;
  p[P.yaw] = S.yaw;
  p[P.roll] = 0;
  p[P.pelvX] = S.pelvX;
  p[P.pelvY] = S.pelvY;
  p[P.pelvZ] = S.pelvZ;
  p[P.spX] = S.spX + 0.01 * br;
  p[P.spY] = S.spY;
  p[P.spZ] = S.spZ;
  p[P.hdX] = S.hdX;
  p[P.hdY] = S.hdY;
  p[P.hdZ] = S.hdZ;
  v3(p, P.rH, S.rH[0], S.rH[1], S.rH[2]);
  v3(p, P.rP, S.rP[0], S.rP[1], S.rP[2]);
  v3(p, P.lH, S.lH[0], S.lH[1] + 0.006 * br, S.lH[2]);
  v3(p, P.lP, S.lP[0], S.lP[1], S.lP[2]);
  const c = Math.cos(S.sw[1]);
  v3(p, P.swD, c * Math.sin(S.sw[0]), Math.sin(S.sw[1]), c * Math.cos(S.sw[0]));
  v3(p, P.swF, S.swF[0], S.swF[1], S.swF[2]);
  v3(p, P.rK, S.rK[0], S.rK[1], S.rK[2]);
  v3(p, P.lK, S.lK[0], S.lK[1], S.lK[2]);
  p[P.twoHand] = 0;
  p[P.footFlat] = 0.95;
  p[P.rFf] = 1;
  p[P.lFf] = 1;
  // the feet step from where they stood into the guard over the raise
  const E = A.entry, fw = smoothstep(0.02, 0.16, A.t);
  v3(p, P.rF, lerp(E[0], S.rF[0], fw), ANK, lerp(E[2], S.rF[1], fw));
  v3(p, P.lF, lerp(E[3], S.lF[0], fw), ANK, lerp(E[5], S.lF[1], fw));
  p[P.rFy] = lerp(E[6], S.rFy, fw);
  p[P.lFy] = lerp(E[7], S.lFy, fw);
  // a bullet or a far blow turned aside: the guard gives a little and comes back (player.recoil)
  const r = A.recoil;
  if (r > 0.001) {
    p[P.spX] -= 0.2 * r;
    p[P.hdX] -= 0.1 * r;
    p[P.bodyZ] -= 0.05 * r;
    p[P.rH + 2] -= 0.1 * r;
    p[P.lH + 2] -= 0.08 * r;
  }
  turnTwist(p, A);
}

/** Extra clips for the hero's animator (merged over its own table). */
export const TECH_POSES = Object.freeze({ technique: techniquePose });
