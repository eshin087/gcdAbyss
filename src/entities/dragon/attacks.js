import * as THREE from 'three';
import { TUNING } from './tuning.js';
import { clamp, smoothstep, easeInOutSine, easeOutCubic, easeInCubic, turnToward, angleDiff } from '../../core/math.js';

// Attack definitions. Each is driven by the action runner in ai.js:
//   phases(d)          -> [[name, seconds], ...]   ('windup' / 'active' / 'recovery' are announced)
//   weight(d, s)       -> selection weight given the sensed player (0 = unusable)
//   start(d, a)        -> once, before the first phase
//   enter(d, a, phase) -> on every phase change
//   update(d, a, dt)   -> every frame BEFORE the rig (pose targets, root motion)
//   hit(d, a, dt)      -> every frame AFTER the rig (hitboxes from fresh joint positions)
//   end(d, a, interrupted)
// `d` is the Dragon, `a` the running action ({phase, t, dur, k, ...scratch}).

const T = TUNING.attacks;
const DEG = Math.PI / 180;
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V();

/** Sphere (x,y,z,r) vs the player's vertical cylinder (radius = player.radius, height 1.8). */
export function sphereHitsPlayer(player, x, y, z, r) {
  const p = player?.position;
  if (!p) return false;
  const pr = player.radius ?? 0.45;
  const dh = Math.max(0, Math.hypot(x - p.x, z - p.z) - pr);
  const cy = Math.min(Math.max(y, p.y), p.y + 1.8);
  const dy = y - cy;
  return dh * dh + dy * dy <= r * r;
}

/** Swept sphere test from the previous frame's position (stored on the action under `key`). */
export function sweepHit(d, a, key, pos, r) {
  const prevMap = (a.prev ||= {});
  let prev = prevMap[key];
  if (!prev) prev = prevMap[key] = V().copy(pos);
  const player = d.game.player;
  const dist = prev.distanceTo(pos);
  const steps = Math.min(8, Math.max(1, Math.ceil(dist / (r * 0.5))));
  let hit = false;
  for (let i = 1; i <= steps && !hit; i++) {
    _c.lerpVectors(prev, pos, i / steps);
    hit = sphereHitsPlayer(player, _c.x, _c.y, _c.z, r);
  }
  prev.copy(pos);
  return hit;
}

const recov = (d, base) => base * d.recScale;
const wingIndex = (side) => (side > 0 ? 0 : 1);

/** Bezier in the root frame -> world. */
function rootBezier(d, out, p0, p1, p2, t) {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const z = u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2];
  return d.rootToWorld(out, x, y, z);
}

// ------------------------------------------------------------------ bite
const bite = {
  name: 'bite',
  cooldown: T.bite.cooldown,
  phases: (d) => [['windup', T.bite.windup], ['active', T.bite.active], ['recovery', recov(d, T.bite.recovery)]],
  weight: (d, s) => (s.dist >= 3 && s.dist <= 9.2 && s.absAng <= 0.65 ? T.bite.weight + (s.dist < 7 ? 1 : 0) : 0),
  start(d, a) {
    a.target = V();
    a.goal = V();
    a.snapped = false;
  },
  enter(d, a, phase) {
    if (phase === 'active') {
      const s = d.sense, nb = d.rig.pt.neckBase;
      a.target.copy(s.chest).addScaledVector(s.vel, 0.12);
      // the neck only reaches ~50 deg off the snout line: a player at the flank is missed
      const hx = a.target.x - nb.x, hz = a.target.z - nb.z, hd = Math.hypot(hx, hz);
      const rel = angleDiff(d.yaw, Math.atan2(hx, hz));
      const cr = clamp(rel, -0.9, 0.9);
      if (cr !== rel) {
        a.target.x = nb.x + Math.sin(d.yaw + cr) * hd;
        a.target.z = nb.z + Math.cos(d.yaw + cr) * hd;
      }
      _a.subVectors(a.target, nb);
      const len = _a.length() || 1;
      const reach = Math.min(len, 5.4);
      _a.multiplyScalar(1 / len);
      a.target.copy(nb).addScaledVector(_a, reach);
      a.goal.copy(a.target).addScaledVector(_a, -1.0);
      a.goal.y = Math.max(0.75, a.goal.y);
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate * 1.3, dt);
      pose.head = d.rootToWorld(pose.headTarget, 0, 5.3, 2.9);
      pose.headRate = 7;
      pose.jaw = 0.3;
      pose.lower = 0.15;
      pose.pitch = -0.06;
    } else if (a.phase === 'active') {
      pose.head = pose.headTarget.copy(a.goal);
      pose.look.copy(a.target);
      pose.headRate = 22;
      pose.jaw = a.k < 0.62 ? 1 : 0;
      pose.jawRate = 30;
      pose.pitch = 0.14;
      pose.lower = 0.3;
      d.moveForward(3.0, dt);
      if (a.k >= 0.62 && !a.snapped) {
        a.snapped = true;
        d.emit('dragon:bite');
      }
    } else {
      if (a.k < 0.5) {
        pose.head = pose.headTarget.copy(a.goal);
        pose.head.y += 0.4;
        pose.headRate = 5;
      } else pose.headRate = 3;
      pose.look.copy(a.target);
      pose.jaw = 0.1;
      pose.pitch = 0.1 * (1 - a.k);
      pose.lower = 0.2 * (1 - a.k);
    }
  },
  hit(d, a) {
    if (a.phase !== 'active' || a.hitDone) return;
    const pt = d.rig.pt;
    if (sweepHit(d, a, 'snout', pt.snout, 1.05) || sweepHit(d, a, 'head', pt.head, 0.75)) {
      d.strike(a, { damage: T.bite.damage, knockback: T.bite.knockback, kind: 'bite', from: pt.head });
    }
  },
};

// ------------------------------------------------------------------ wing claw swipe
const SWIPE_P0 = [3.4, 3.9, 0.6];
const SWIPE_P1 = [4.8, 1.4, 4.4];
const SWIPE_P2 = [0.8, 0.6, 5.8];
const swipe = {
  name: 'swipe',
  cooldown: T.swipe.cooldown,
  phases: (d) => [['windup', T.swipe.windup], ['active', T.swipe.active], ['recovery', recov(d, T.swipe.recovery)]],
  weight: (d, s) => {
    if (s.dist <= 7.5 && s.absAng >= 0.45 && s.absAng <= 2.0) return T.swipe.weight;
    if (s.dist <= 5 && s.absAng >= 0.3 && s.absAng <= 2.2) return T.swipe.weight * 0.6;
    return 0;
  },
  start(d, a) {
    a.side = d.sense.ang >= 0 ? 1 : -1; // + = player on the model-left (+X) side
    a.wi = wingIndex(a.side);
    a.p0 = [a.side * SWIPE_P0[0], SWIPE_P0[1], SWIPE_P0[2]];
    a.p1 = [a.side * SWIPE_P1[0], SWIPE_P1[1], SWIPE_P1[2]];
    a.p2 = [a.side * SWIPE_P2[0], SWIPE_P2[1], SWIPE_P2[2]];
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, ov = pose.wingOv[a.wi];
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo - a.side * 0.5, d.turnRate * 0.5, dt);
      ov.w = 1;
      d.rootToWorld(ov.pos, a.p0[0], a.p0[1] + Math.sin(a.k * Math.PI) * 0.3, a.p0[2]);
      pose.wingOvRate = 7;
      pose.spread[a.wi] = 0.45;
      pose.roll = a.side * 0.1;
      pose.twist = a.side * 0.15;
      pose.jaw = 0.25;
    } else if (a.phase === 'active') {
      ov.w = 1;
      rootBezier(d, ov.pos, a.p0, a.p1, a.p2, easeInOutSine(a.k));
      pose.wingOvRate = 30;
      pose.spread[a.wi] = 0.3;
      pose.twist = a.side * 0.35;
      pose.roll = -a.side * 0.08;
      pose.bodyRate = 9;
      d.yaw += (a.side * 0.6 * dt) / Math.max(0.05, a.dur);
      pose.jaw = 0.5;
    } else {
      ov.w = a.k < 0.3 ? 1 : 0;
      d.rootToWorld(ov.pos, a.p2[0], a.p2[1], a.p2[2]);
      pose.wingOvRate = 5;
      pose.twist = a.side * 0.2 * (1 - a.k);
    }
  },
  hit(d, a) {
    if (a.phase !== 'active' || a.hitDone) return;
    const w = d.rig.pt.wings[a.wi];
    if (
      sweepHit(d, a, 'wrist', w.wrist, 1.2) ||
      sweepHit(d, a, 'mid0', w.mids[0], 0.9) ||
      sweepHit(d, a, 'tip0', w.tips[0], 0.8) ||
      sweepHit(d, a, 'mid1', w.mids[1], 0.8) ||
      sweepHit(d, a, 'elbow', w.elbow, 0.8)
    ) {
      d.strike(a, { damage: T.swipe.damage, knockback: T.swipe.knockback, kind: 'swipe', from: w.shoulder });
    }
  },
};

// ------------------------------------------------------------------ tail sweep
const TAIL_KEYS = [];
/** Cached sweep keys per tail joint (no per-frame string building). */
const tailKeys = (n) => {
  while (TAIL_KEYS.length <= n) TAIL_KEYS.push(`t${TAIL_KEYS.length}`);
  return TAIL_KEYS;
};
const tail = {
  name: 'tail',
  cooldown: T.tail.cooldown,
  phases: (d) => [['windup', T.tail.windup], ['active', T.tail.active], ['recovery', recov(d, T.tail.recovery)]],
  weight: (d, s) => {
    if (s.dist <= 10 && s.absAng >= 1.75) return T.tail.weight;
    if (s.dist <= 6.5 && s.absAng >= 1.2) return T.tail.weight * 0.5;
    return 0;
  },
  start(d, a) {
    a.dir = d.sense.ang >= 0 ? -1 : 1; // rotate away so the tail swings INTO the player
    a.yaw0 = d.yaw;
    a.yawW = a.yaw0 - a.dir * 0.35;
  },
  update(d, a, dt) {
    const pose = d.pose;
    if (a.phase === 'windup') {
      d.yaw = turnToward(d.yaw, a.yawW, 2.2 * dt);
      pose.lower = 0.25;
      pose.pitch = 0.08;
      pose.tailCurl = a.dir * 0.06;
      d.rootToWorld(pose.look, a.dir * 7, 1, 3);
      pose.speed = 3;
    } else if (a.phase === 'active') {
      const e = easeInOutSine(a.k);
      d.yaw = a.yawW + a.dir * (T.tail.spin + 0.35) * e;
      pose.tailCurl = -a.dir * 0.05;
      pose.tailStiff = 2.6;
      pose.lower = 0.3;
      pose.bodyRate = 8;
      pose.speed = 6;
      pose.tailWave = 0;
      d.rootToWorld(pose.look, a.dir * 7, 1, 3);
    } else {
      pose.lower = 0.25 * (1 - a.k);
      pose.speed = 2;
    }
  },
  hit(d, a) {
    const chain = d.rig.tail, radii = d.model.tailRadii, keys = tailKeys(chain.n);
    // angle of the visible tail (mid segment) around the root, tracked every frame
    const mid = chain.p[Math.min(9, chain.n)];
    const ang = Math.atan2(mid.x - d.position.x, mid.z - d.position.z);
    const prevAng = a.tailAng ?? ang;
    a.tailAng = ang;
    if (a.hitDone) return;
    if (a.phase !== 'active' && !(a.phase === 'recovery' && a.k < 0.15)) return;
    // swept arc: the tail crossed the player's bearing this frame within its reach
    const p = d.game.player?.position;
    if (p) {
      const pd = Math.hypot(p.x - d.position.x, p.z - d.position.z);
      const delta = angleDiff(prevAng, ang);
      const rel = angleDiff(prevAng, Math.atan2(p.x - d.position.x, p.z - d.position.z));
      const tol = 0.9 / Math.max(1, pd);
      const crossed = Math.abs(delta) > 1e-4 && rel * delta >= -tol * Math.abs(delta) && Math.abs(rel) <= Math.abs(delta) + tol;
      if (crossed && pd >= 2.0 && pd <= 9.6) {
        d.strike(a, { damage: T.tail.damage, knockback: T.tail.knockback, kind: 'tail', from: d.position });
        return;
      }
    }
    for (let i = 4; i <= chain.n; i++) {
      const r = (radii[Math.min(i, radii.length - 1)] ?? 0.2) + 0.4;
      if (sweepHit(d, a, keys[i], chain.p[i], r)) {
        d.strike(a, { damage: T.tail.damage, knockback: T.tail.knockback, kind: 'tail', from: d.position });
        return;
      }
    }
  },
};

// ------------------------------------------------------------------ stomp (rear up + slam)
const STOMP_Z = 2.9; // slam centre ahead of the root (between the planted wing knuckles)
const stomp = {
  name: 'stomp',
  cooldown: T.stomp.cooldown,
  phases: (d) => [['windup', T.stomp.windup], ['active', T.stomp.active], ['recovery', recov(d, T.stomp.recovery)]],
  // only when the player stands inside the slam zone (under the chest / beside the forelimbs);
  // players behind the hips get the tail sweep instead
  weight: (d, s) => {
    const fz = Math.cos(s.ang) * s.dist - STOMP_Z, fx = Math.sin(s.ang) * s.dist;
    const r = Math.hypot(fx, fz);
    return r <= T.stomp.radius - 0.3 ? T.stomp.weight * (r <= 3 ? 1.5 : 1) : 0;
  },
  enter(d, a, phase) {
    if (phase !== 'recovery') return;
    const c = d.rootToWorld(_a, 0, 0, STOMP_Z);
    const g = d.game;
    g.shake?.(0.45);
    g.world?.gust?.(c.x, c.z, 1.4, 13);
    d.fx.dustRing(c.x, c.z, 1.5, 40, 1.1);
    for (const l of d.rig.gait.limbs) if (!l.hind) d.emit('dragon:step', { x: l.pos.x, z: l.pos.z, heavy: true });
    const p = g.player?.position;
    if (p && Math.hypot(p.x - c.x, p.z - c.z) <= T.stomp.radius + (g.player.radius ?? 0.45)) {
      d.strike(a, { damage: T.stomp.damage, knockback: T.stomp.knockback, kind: 'stomp', from: c });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
      pose.pitch = -0.62;
      pose.bodyRate = 3.5;
      pose.lower = -0.2;
      pose.spread[0] = pose.spread[1] = 0.4;
      pose.spreadRate = 5;
      pose.head = d.rootToWorld(pose.headTarget, 0, 6.0, 3.5);
      pose.headRate = 4;
      pose.jaw = 0.45;
    } else if (a.phase === 'active') {
      pose.pitch = 0.16;
      pose.bodyRate = 22;
      pose.lower = 0.15;
      pose.spreadRate = 18;
      pose.headRate = 10;
      pose.jaw = 0.8;
    } else {
      pose.pitch = 0.08 * (1 - a.k);
      pose.bodyRate = 3;
      pose.lower = 0.15 * (1 - a.k);
      pose.jaw = 0.1;
    }
  },
};

// ------------------------------------------------------------------ fire breath
const breath = {
  name: 'breath',
  cooldown: T.breath.cooldown,
  phases: (d) => [
    ['windup', T.breath.windup],
    ['active', d.phase === 2 ? T.breath.activeP2 : T.breath.active],
    ['recovery', recov(d, T.breath.recovery)],
  ],
  weight: (d, s) => (s.dist >= 6 && s.dist <= 16 && s.absAng <= 1.0 ? T.breath.weight * (d.phase === 2 ? 1.2 : 1) : 0),
  start(d, a) {
    a.side = Math.random() < 0.5 ? -1 : 1;
    a.aim = d.sense.yawTo;
    a.aim0 = a.aim;
    a.tick = 0;
    a.on = false;
  },
  enter(d, a, phase) {
    if (phase === 'active') {
      a.on = true;
      d.emit('dragon:breathStart');
      d.fx.breathBegin();
      // start within the snout's reach; P1 then tracks the player, P2 sweeps across them
      const center = d.yaw + clamp(angleDiff(d.yaw, d.sense.yawTo), -0.6, 0.6);
      a.aim0 = center - (d.phase === 2 ? (a.side * T.breath.sweepP2) / 2 : 0);
      a.aim = a.aim0;
      a.tick = 0;
    } else if (phase === 'recovery') this.end(d, a);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate * 0.9, dt);
      pose.head = d.rootToWorld(pose.headTarget, 0, 5.6, 2.6);
      pose.headRate = 4;
      pose.jaw = 0.25;
      pose.look.copy(s.chest);
      pose.look.y += 3;
      pose.pitch = -0.08;
      pose.lower = -0.1;
      d.throat = a.k;
      d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd);
    } else if (a.phase === 'active') {
      if (d.phase === 2) a.aim = a.aim0 + a.side * T.breath.sweepP2 * a.k;
      else a.aim = turnToward(a.aim, s.yawTo, 32 * DEG * dt);
      d.turnToward(a.aim, 1.2, dt);
      const sa = Math.sin(a.aim), ca = Math.cos(a.aim);
      pose.head = pose.headTarget.set(pt.neckBase.x + sa * 2.7, pt.neckBase.y + 0.7, pt.neckBase.z + ca * 2.7);
      pose.headRate = 5;
      pose.look.set(pt.mouth.x + sa * 8, 0, pt.mouth.z + ca * 8);
      pose.lookRate = 12;
      pose.jaw = 0.95;
      pose.pitch = 0.06;
      pose.lower = 0.1;
      d.throat = 1;
      d.fx.breathEmit(dt, pt.mouth, a.aim, 0.17);
    } else {
      pose.jaw = 0.2;
      d.throat = 0;
      if (a.k < 0.6) d.fx.mouthEmbers(dt, pt.mouth, 18, pt.headFwd);
    }
  },
  hit(d, a, dt) {
    if (a.phase !== 'active') return;
    a.tick -= dt;
    if (a.tick > 0) return;
    a.tick += T.breath.tick;
    const p = d.game.player?.position, m = d.rig.pt.mouth;
    if (!p) return;
    const dx = p.x - m.x, dz = p.z - m.z;
    const dist = Math.hypot(dx, dz);
    const inCone = dist < 1.6 || (dist <= T.breath.range && Math.abs(angleDiff(a.aim, Math.atan2(dx, dz))) <= T.breath.halfAngle);
    if (inCone) d.hitPlayer({ damage: T.breath.tickDamage, from: { x: m.x, z: m.z }, knockback: 0, kind: 'fire', burn: T.breath.burn });
  },
  end(d, a) {
    if (a.on) {
      a.on = false;
      d.fx.breathEnd();
      d.emit('dragon:breathEnd');
    }
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ fireball volley
const fireball = {
  name: 'fireball',
  cooldown: T.fireball.cooldown,
  phases: (d) => [
    ['windup', T.fireball.windup],
    ['active', d.phase === 2 ? T.fireball.activeP2 : T.fireball.active],
    ['recovery', recov(d, T.fireball.recovery)],
  ],
  weight: (d, s) => {
    if (s.dist >= 13) return T.fireball.weight * (d.phase === 2 ? 1.2 : 1);
    if (s.dist >= 10 && s.absAng <= 0.8) return T.fireball.weight * 0.5;
    return 0;
  },
  start(d, a) {
    a.shots = 0;
    a.count = d.phase === 2 ? 3 : 1;
    a.recoil = 0;
    a.volley = { hitDone: false }; // the shells outlive the action: they share this hit lock
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt;
    a.recoil = Math.max(0, a.recoil - dt * 4);
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate, dt);
      pose.head = d.rootToWorld(pose.headTarget, 0, 5.8, 3.0);
      pose.headRate = 4;
      pose.jaw = 0.3;
      pose.look.copy(s.chest);
      pose.look.y += 4;
      d.throat = a.k * 0.8;
      d.fx.mouthEmbers(dt, pt.mouth, 22, pt.headFwd);
    } else if (a.phase === 'active') {
      d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
      while (a.shots < a.count && a.t >= a.shots * 0.3) this.launch(d, a, a.shots++);
      pose.head = d.rootToWorld(pose.headTarget, 0, 5.2, 4.2);
      pose.headRate = 6;
      pose.look.copy(s.chest);
      pose.look.y += 2.5;
      pose.jaw = a.recoil > 0.3 ? 1 : 0.4;
      pose.jawRate = 25;
      d.throat = 0.8;
    } else {
      pose.jaw = 0.1;
      d.throat = 0;
    }
    if (a.recoil > 0) {
      const f = d.fwd;
      pose.headOffset.x -= f.x * a.recoil * 0.9;
      pose.headOffset.z -= f.z * a.recoil * 0.9;
      pose.headOffset.y += a.recoil * 0.5;
    }
  },
  launch(d, a, i) {
    const s = d.sense, from = d.rig.pt.mouth;
    const flight = Math.min(1.3, Math.max(0.7, s.dist / 18));
    const t = _b.copy(s.pos).addScaledVector(s.vel, flight * 0.8);
    if (i > 0) {
      // P2 volley: flank shots bracket the player's dodge directions
      const dx = t.x - d.position.x, dz = t.z - d.position.z;
      const l = Math.hypot(dx, dz) || 1;
      const side = i === 1 ? 1 : -1;
      t.x += (-dz / l) * 4.8 * side;
      t.z += (dx / l) * 4.8 * side;
    }
    const r = Math.hypot(t.x, t.z), max = 30;
    if (r > max) t.multiplyScalar(max / r);
    t.y = 0;
    d.fx.launchFireball(from, t, a.volley);
    a.recoil = 1;
  },
  end(d) {
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ charge
const charge = {
  name: 'charge',
  cooldown: T.charge.cooldown,
  phases: (d) => [['windup', T.charge.windup], ['active', T.charge.active], ['recovery', recov(d, T.charge.recovery)]],
  weight: (d, s) => {
    if (s.dist >= 12) return T.charge.weight;
    if (s.dist >= 9 && d.phase === 2 && s.absAng <= 0.5) return T.charge.weight * 0.6;
    return 0;
  },
  start(d, a) {
    a.v = 0;
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate * 1.6, dt);
      pose.lower = 0.55;
      pose.pitch = 0.18;
      pose.head = d.rootToWorld(pose.headTarget, 0, 2.4, 5.6);
      pose.headRate = 6;
      pose.jaw = 0.45;
      pose.tailWave = 0.15;
    } else if (a.phase === 'active') {
      const dur = T.charge.active;
      const vmax = T.charge.distance / (dur * 0.8);
      const k = a.k;
      a.v = vmax * Math.min(1, k / 0.2) * (k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1);
      if (k < 0.4) d.turnToward(s.yawTo, 0.6, dt);
      const want = a.v * dt;
      const moved = d.moveForward(a.v, dt);
      if (k > 0.2 && want > 0.05 && moved < want * 0.4) a.t = a.dur; // slammed into a stone / the edge
      pose.lower = 0.4;
      pose.pitch = 0.15;
      pose.head = d.rootToWorld(pose.headTarget, 0, 2.2, 6.0);
      pose.headRate = 10;
      pose.jaw = 0.6;
      pose.spread[0] = pose.spread[1] = 0.22;
      pose.tailWave = 0.02;
    } else {
      a.v *= Math.exp(-5 * dt);
      if (a.v > 0.2) d.moveForward(a.v, dt);
      pose.lower = 0.3 * (1 - a.k);
      pose.pitch = 0.1 * (1 - a.k);
      pose.jaw = 0.15;
    }
  },
  hit(d, a) {
    if (a.phase !== 'active' || a.hitDone) return;
    const pt = d.rig.pt;
    if (sweepHit(d, a, 'snout', pt.snout, 1.15) || sweepHit(d, a, 'chest', pt.chest, 1.7)) {
      d.strike(a, { damage: T.charge.damage, knockback: T.charge.knockback, knockdown: true, kind: 'charge', from: d.position });
    }
  },
};

// ------------------------------------------------------------------ leap slam (phase 2)
const leap = {
  name: 'leap',
  cooldown: T.leap.cooldown,
  phases: (d) => [['windup', T.leap.windup], ['air', T.leap.air], ['recovery', recov(d, T.leap.recovery)]],
  weight: (d, s) => (d.phase === 2 ? T.leap.weight * (s.dist >= 7 ? 1 : 0.35) : 0),
  start(d, a) {
    a.target = V();
    a.p0 = V();
    a.landed = false;
  },
  enter(d, a, phase) {
    const g = d.game;
    if (phase === 'air') {
      d.state = 'airborne';
      d.emit('dragon:takeoff');
      g.world?.gust?.(d.position.x, d.position.z, 2.0, 14);
      d.fx.dustRing(d.position.x, d.position.z, 3, 40, 1.2);
      g.shake?.(0.2);
      a.p0.copy(d.position);
      a.target.copy(d.sense.pos);
      a.target.y = 0;
    } else if (phase === 'recovery') this.land(d, a);
  },
  land(d, a, deal = true) {
    if (a.landed) return;
    a.landed = true;
    const g = d.game;
    d.state = 'combat';
    d.position.x = a.target.x;
    d.position.z = a.target.z;
    d.emit('dragon:land', { x: a.target.x, z: a.target.z });
    g.world?.gust?.(a.target.x, a.target.z, 2.0, 22);
    g.shake?.(0.7);
    g.hitstop?.(0.08);
    d.fx.dustRing(a.target.x, a.target.z, 2.2, 56, 1.6);
    const p = g.player?.position;
    if (deal && p && Math.hypot(p.x - a.target.x, p.z - a.target.z) <= T.leap.radius + (g.player.radius ?? 0.45)) {
      d.strike(a, { damage: T.leap.damage, knockback: T.leap.knockback, knockdown: true, kind: 'slam', from: a.target });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, g = d.game;
    const H = T.leap.height;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate, dt);
      pose.lower = 0.75;
      pose.bodyRate = 6;
      pose.pitch = 0.05;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 5;
      pose.head = d.rootToWorld(pose.headTarget, 0, 3.2, 4.5);
    } else if (a.phase === 'air') {
      const t = a.t;
      let h;
      if (t < 0.6) h = H * easeOutCubic(t / 0.6);
      else if (t < 1.4) h = H + Math.sin((t - 0.6) * 4) * 0.3;
      else h = H * (1 - easeInCubic(clamp((t - 1.4) / 0.4, 0, 1)));
      if (t < 1.3) {
        _a.copy(s.pos).addScaledVector(s.vel, 0.35);
        a.target.x += (_a.x - a.target.x) * (1 - Math.exp(-5 * dt));
        a.target.z += (_a.z - a.target.z) * (1 - Math.exp(-5 * dt));
        const R = TUNING.radius, B = g.CONFIG?.world?.dragonBound ?? 26;
        g.world?.resolve?.(a.target, R, B + R);
        a.target.y = 0;
      }
      // keep the moon shadow of the body over the target while high up
      const moon = g.U?.uMoonDir?.value;
      const my = Math.max(0.2, moon?.y ?? 1);
      const ox = moon ? (-moon.x / my) * h : 0, oz = moon ? (-moon.z / my) * h : 0;
      const w = smoothstep(0, 0.6, t);
      d.position.x = a.p0.x + (a.target.x - ox - a.p0.x) * w;
      d.position.z = a.p0.z + (a.target.z - oz - a.p0.z) * w;
      d.turnToward(s.yawTo, 3, dt);
      pose.alt = h;
      pose.airborne = 1;
      const diving = t >= 1.4;
      pose.spread[0] = pose.spread[1] = diving ? 0.6 : 1;
      pose.spreadRate = 6;
      pose.flap = diving ? 0.05 : t < 0.6 ? 0.75 : 0.5;
      pose.flapHz = t < 0.6 ? 2.4 : 1.8;
      pose.pitch = diving ? 0.25 : -0.1;
      pose.bodyRate = 4;
      pose.look.copy(a.target);
      pose.tailWave = 0.04;
      if (t > 1.0) d.fx.warnRing(dt, a.target.x, a.target.z, T.leap.radius, clamp((t - 1.0) / 0.8, 0.2, 1));
    } else {
      pose.lower = 0.6 * (1 - a.k);
      pose.spreadRate = 3;
      pose.pitch = 0.1 * (1 - a.k);
      pose.jaw = a.k < 0.4 ? 0.6 : 0.1;
    }
  },
  end(d, a, interrupted) {
    if (d.state === 'airborne') {
      // killed mid-air: drop to the target (no damage); a reset() just discards the flight
      if (interrupted && a.phase === 'air' && !d.resetting) this.land(d, a, false);
      if (d.state === 'airborne') d.state = 'combat';
    }
  },
};

export const ATTACKS = { bite, swipe, tail, stomp, breath, fireball, charge, leap };
