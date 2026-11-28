import { TELL } from '../../combat/rules.js';
import { clamp, lerp, smoothstep } from '../../core/math.js';
import { lookOf } from '../enemies/duelist/lookSwitch.js';
import { SCALE } from './tuning.js';
import { WYRM_PAW } from './tuningMotion.js';

// The paw blows' tells (tuningMotion.js WYRM_PAW; `?pawBlue=a|b|c`, `?pawRed=a|b`, '0' as they shipped; the
// owner's picks, the defaults (2026-11-28): the scythe and the leap). The owner (2026-11-27): "the blue and red warning paw attacks from the
// dragon need to be completely different as well as it gets confusing since it kinda uses the same animation".
// attacks.js asks these first: OVERHEAD (only a BLUE one: a white overhead keeps today's) and the stomp's
// windup (every stomp is red). Each returns true when it drew the frame (false: the shipped performance runs).
// Pose fields are reset every frame (ai.js), so these set them like the kinds do.

const S = SCALE;

export const PAW_BLUE_OPTS = Object.freeze(['0', 'a', 'b', 'c']);
export const PAW_RED_OPTS = Object.freeze(['0', 'a', 'b']); // (a the leap, b the quake)
const pick = (name, opts) => {
  const v = lookOf(name, '0');
  return opts.includes(v) ? v : '0';
};
/** The blue overhead's option for this hit (read once when it starts), '0' for a white one. */
export const pawBlueOf = (spec) => (spec?.tell === TELL.BLUE ? pick('pawBlue', PAW_BLUE_OPTS) : '0');
/** The stomp's option (read once when it starts). */
export const pawRedOf = () => pick('pawRed', PAW_RED_OPTS);

// ---------------------------------------------------------------- blue: the overhead's options
/** Windup (k 0..1 of its own windup, 1 through a hold). `h.look` set at the hit's init. */
export function blueWindup(d, h, k, dt) {
  const L = h.look;
  if (!L || L === '0') return false;
  const pose = d.pose, side = h.w.side, ov = pose.pawOv[h.wi];
  ov.w = 1;
  pose.pawOvRate = 7;
  pose.restep = 1;
  pose.stanceF = 0.15;
  if (L === 'a') {
    // the scythe: out wide and back at shoulder height, the chest twisted away, the near wing folded
    const B = WYRM_PAW.scythe, e = smoothstep(0, 0.75, k);
    // (its own turn speed: a string's fast turn, the storm flurry's x2.2, swung the 15 m tail 3 m in a frame)
    d.turnToward(d.sense.yawTo + side * B.turn, d.turnRate * Math.min(h.spec.turn ?? 0.8, 0.9), dt);
    d.rootPt(ov.pos, side * lerp(1.4, B.wind[0], e), lerp(0.6, B.wind[1], e) + 0.2 * Math.sin(k * Math.PI), lerp(2.3, B.wind[2], e));
    pose.twist = side * B.twist * e;
    pose.roll = -side * B.roll * e;
    pose.lower = B.lower * e;
    pose.spread[h.wi] = lerp(0.5, B.spreadNear, e);
    pose.spread[1 - h.wi] = B.spreadFar;
    pose.spreadRate = 5;
    pose.jaw = 0.3;
    return true;
  }
  if (L === 'b') {
    // the jab: crouched, the paw tucked back under the chest, wings tight, the head down on him, a tremble
    const B = WYRM_PAW.jab, e = smoothstep(0, 0.7, k);
    d.turnToward(d.sense.yawTo, d.turnRate * (h.spec.turn ?? 0.8), dt);
    d.rootPt(ov.pos, side * lerp(1.4, B.wind[0], e), lerp(0.6, B.wind[1], e), lerp(2.3, B.wind[2], e));
    const tr = smoothstep(B.tremble[0], 1, k) * B.tremble[1] * S;
    if (tr > 0) ov.pos.y += Math.sin(d.time * B.tremble[2]) * tr;
    pose.lower = B.lower * e;
    pose.pitch = B.pitch * e;
    pose.headOffset.y += B.head * S * e;
    pose.spread[0] = pose.spread[1] = lerp(0.5, B.spread, e);
    pose.spreadRate = 6;
    pose.jaw = 0.12;
    pose.elbowsOut = Math.max(pose.elbowsOut, 0.6 * e);
    return true;
  }
  // c, the uppercut: the claws dragged low and back along the ground, the body leaning over them
  const B = WYRM_PAW.upper, e = smoothstep(0, 0.7, k);
  d.turnToward(d.sense.yawTo, d.turnRate * (h.spec.turn ?? 0.8), dt);
  d.rootPt(ov.pos, side * lerp(1.4, B.wind[0], e), lerp(0.6, B.wind[1], e), lerp(2.3, B.wind[2], e));
  pose.roll = side * B.roll * e;
  pose.lower = B.lower * e;
  pose.twist = side * B.twist * e;
  pose.spread[h.wi] = B.spreadNear;
  pose.spread[1 - h.wi] = 0.55;
  pose.spreadRate = 5;
  pose.jaw = 0.35;
  if (!h.grit && k > B.grit) {
    h.grit = true;
    d.fx.dustRing?.(ov.pos.x, ov.pos.z, 0.5 * S, 14, 0.7); // (grit off the dragged claws)
  }
  return true;
}

/** After the shipped aim (h.slam, h.p1, h.p0 set): each option's own arc. */
export function blueAim(d, h) {
  const L = h.look;
  if (!L || L === '0') return;
  const side = h.w.side;
  // the smash point back in the root frame (x, z)
  const dx = h.slam.x - d.position.x, dz = h.slam.z - d.position.z, c = Math.cos(d.yaw), sn = Math.sin(d.yaw);
  const lx = (dx * c - dz * sn) / S, lz = (dx * sn + dz * c) / S;
  if (L === 'a') {
    const B = WYRM_PAW.scythe;
    d.rootPt(h.p1, side * B.mid[0], B.mid[1], lz + 0.6);
  } else if (L === 'b') {
    const B = WYRM_PAW.jab;
    d.rootPt(h.p1, lerp(side * B.wind[0], lx, 0.5), B.mid, lerp(B.wind[2], lz, 0.5));
    h.slam.y = 0.45 * S;
  } else {
    const B = WYRM_PAW.upper;
    d.rootPt(h.p1, lerp(side * B.wind[0], lx, 0.65), B.low, lz - 0.7);
    d.rootPt(h.slam, lx, B.top, lz + 0.2);
  }
}

/** The strike (k 0..1 of the active). */
export function blueActive(d, h, k, dt) {
  const L = h.look;
  if (!L || L === '0') return false;
  const pose = d.pose, side = h.w.side, ov = pose.pawOv[h.wi];
  const B = L === 'a' ? WYRM_PAW.scythe : L === 'b' ? WYRM_PAW.jab : WYRM_PAW.upper;
  const u = Math.pow(clamp(k, 0, 1), B.ease), iu = 1 - u;
  ov.w = 1;
  ov.pos.set(
    iu * iu * h.p0.x + 2 * iu * u * h.p1.x + u * u * h.slam.x,
    iu * iu * h.p0.y + 2 * iu * u * h.p1.y + u * u * h.slam.y,
    iu * iu * h.p0.z + 2 * iu * u * h.p1.z + u * u * h.slam.z,
  );
  pose.pawOvRate = 45;
  pose.bodyRate = 10;
  if (L === 'a') {
    pose.twist = lerp(side * B.twist, -side * B.follow, u);
    pose.roll = lerp(-side * B.roll, side * 0.08, u);
    pose.pitch = lerp(0, 0.22, u);
    pose.lower = lerp(B.lower, 0.28, u);
    pose.spread[h.wi] = B.spreadNear;
    pose.jaw = 0.75;
  } else if (L === 'b') {
    pose.lower = lerp(B.lower, 0.2, u);
    pose.pitch = lerp(B.pitch, 0.26, u);
    pose.headOffset.y += B.head * S * (1 - u);
    pose.spread[0] = pose.spread[1] = B.spread;
    pose.jaw = 0.85;
    if (h.lungeV > 0 || B.lunge > 0) d.moveForward(h.lungeV + (B.lunge * S) / 0.24, dt);
    return true;
  } else {
    pose.roll = lerp(side * B.roll, -side * 0.06, u);
    pose.lower = lerp(B.lower, -0.12, u);
    pose.pitch = lerp(0.05, -0.16, u);
    pose.twist = lerp(side * B.twist, -side * 0.15, u);
    pose.spread[h.wi] = lerp(B.spreadNear, 0.7, u);
    pose.jaw = 0.8;
  }
  if (h.lungeV > 0) d.moveForward(h.lungeV, dt);
  return true;
}

/** The end of the strike: the uppercut ends in the air (no plant, no gash in the ground). */
export function blueEnd(d, h) {
  if (h.look !== 'c') return false;
  d.game.shake?.(0.14);
  h.plant = null;
  return true;
}

// ---------------------------------------------------------------- red: the stomp's options
/** The stomp's windup (k 0..1). `look` read when it started. */
export function redWindup(d, look, k, dt) {
  if (!look || look === '0') return false;
  const pose = d.pose, s = d.sense;
  d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
  const coil = smoothstep(0.62, 1, k);
  if (look === 'a') {
    // the leap: a crouch, then the whole body jumps up with a wing beat and hangs, both paws raised
    const B = WYRM_PAW.leap, c = smoothstep(0, B.crouchEnd, k), up = smoothstep(B.crouchEnd, 1, k);
    const air = up > 0;
    pose.lower = B.lower * c * (1 - up);
    pose.pitch = lerp(B.pitch * c, B.airPitch, up);
    pose.alt = B.alt * Math.sin(up * Math.PI * 0.5); // (up fast, slowing to a hang at the top)
    pose.altRate = 9;
    pose.airborne = air ? 1 : 0;
    pose.bodyRate = air ? 7 : 5;
    pose.spread[0] = pose.spread[1] = air ? B.spread : lerp(0.5, 0.25, c);
    pose.spreadRate = air ? 10 : 5;
    pose.flap = air && up < 0.7 ? B.flap : 0;
    pose.flapHz = B.flapHz;
    pose.head = d.rootPt(pose.headTarget, B.head[0], lerp(4.0, B.head[1], up), B.head[2]);
    pose.headRate = 5;
    pose.jaw = lerp(0.2, 0.85, up);
    for (let i = 0; i < 2; i++) {
      const ov = pose.pawOv[i];
      ov.w = up;
      d.rootPt(ov.pos, (i === 0 ? 1 : -1) * B.paws[0], B.paws[1] + B.alt * Math.sin(up * Math.PI * 0.5) / S, B.paws[2]);
    }
    pose.pawOvRate = 8;
    pose.stanceH = 0.25;
    pose.restep = air ? 0 : 1;
    pose.swell = k;
    pose.tailWave = 0;
    pose.tailLift = up;
    return true;
  }
  // b, the quake: sunk low, wings flat, paws pressed wide on the ground, head down, a building shudder;
  // then the heave up before the slam
  const B = WYRM_PAW.quake, e = smoothstep(0, 0.4, k), hv = smoothstep(B.heave, 1, k);
  const shake = Math.sin(d.time * B.shake[1]) * B.shake[0] * smoothstep(0.2, B.heave, k) * (1 - hv);
  pose.lower = lerp(B.lower * e, B.heaveLower, hv);
  pose.pitch = lerp(B.pitch * e, B.heavePitch, hv);
  pose.rear = hv;
  pose.roll = shake;
  pose.bodyRate = hv > 0 ? 14 : 6;
  pose.spread[0] = pose.spread[1] = lerp(lerp(0.5, B.spread, e), B.heaveSpread, hv);
  pose.spreadRate = hv > 0 ? 16 : 5;
  if (hv < 0.02) {
    pose.head = d.rootPt(pose.headTarget, B.head[0], B.head[1], B.head[2]);
    pose.headRate = 4;
  } else {
    pose.head = d.rootPt(pose.headTarget, 0, lerp(B.head[1], 6.2, hv), lerp(B.head[2], 3.0, hv));
    pose.headRate = 9;
  }
  pose.jaw = lerp(0.15, 0.9, hv);
  for (let i = 0; i < 2; i++) {
    const ov = pose.pawOv[i];
    ov.w = e;
    const sx = (i === 0 ? 1 : -1);
    d.rootPt(ov.pos, sx * lerp(B.paws[0], B.heavePaws[0], hv), lerp(0, B.heavePaws[1], hv), lerp(B.paws[1], B.heavePaws[2], hv));
  }
  pose.pawOvRate = hv > 0 ? 14 : 6;
  pose.elbowsOut = Math.max(pose.elbowsOut, 0.8 * e * (1 - hv));
  pose.stanceH = 0.25;
  pose.restep = 1;
  pose.swell = k;
  pose.tailWave = 0;
  pose.tailLift = hv;
  return true;
}
