import { lookOf } from '../enemies/duelist/lookSwitch.js';
import { fixOn } from './motionFix.js';
import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { clamp, lerp, smoothstep, easeOutCubic, easeInCubic, easeInOutSine, angleDiff } from '../../core/math.js';
import { beat, roarFx, roarPose, GROUND_BLOW, NOVA_BLOW } from './attacks.js';
import { FLIGHT, TRAILS } from './tuningFire.js';
import { CRACK_ON, WALL_SOURCE } from './fireTrails.js';
import { APOC_LOOK, skyBolt, skyPillar, skyThroat } from './skyFx.js';

// The meteors' roar with the head held naturally (ADR-258; `?wyrmHead=a`, the default; '0' as before: the
// neck swung back past upright, the head behind the neck's base, the snout 15° past vertical toward the tail
// and the head rolled over on its snout). Root frame, model units: the reared head's spot and its look point.
// the least height a diving head is carried at (m; the motion audit)
const DIVE_HEAD_Y = 2.2;
const HEAD_UP = Object.freeze({ y: 7.6, z: 2.3, lookY: 40, lookZ: 3.5 });
const headUp = () => (lookOf('wyrmHead', '0') === '0' ? null : HEAD_UP);

// Fire / flight attacks and spells (contract 3; numbers in tuningFire.js = TUNING.attacks.*). Same
// shape as attacks.js (phases / beats / zone / weight / start / enter / update / hit / end, driven by
// the runner in ai.js); spread into ATTACKS there.
//   flight (short: it takes off, attacks from the air and lands inside one action):
//     skyStrafe    'Burning pass'  low pass over the hero breathing fire down; a burning strip hazard
//     diveBomb     'Sky dive'      climbs ~14 m, hovers + tracks (red ring), dives: the crash is the hit
//     hoverBarrage 'Hover barrage' hovers ~8 m, spits 3-5 shells, each landing in a red ring
//   spells:
//     meteorRain   Armageddon: a salvo into the sky, then waves of meteors over the whole clearing
//                  and one great meteor (a background hazard: the wyrm keeps fighting), ADR-053
//     eruptions    lava pillars in a line toward the hero; phase 3 may chase him instead
//     flameRing    a ring of fire expanding from the wyrm
//     flameWall    a wall of fire sweeping across the arena
//     nova         'Inferno nova': a 2.5 s charge, then an arena-sized blast (the phase-3 opener)
// Every hit is red (dodge-only): one tell beat per blow (combat:tell at its windup, combat:flash
// flashLead s before impact, the wyrm's red glow in between). Where a hazard deals the blow
// (strip, ring, wall, pillar line, barrage shells) the attack's beat covers it (announce: false) and
// is re-timed every frame from the hazard's geometry (hazards.timeTo); the background rain / chase
// circles announce themselves. Flying, d.state === 'airborne' (no body circles, staggers wait) and
// the hurt spheres ride the drawn body high above sword reach; flights stay <= 16 m up, in the bound.

const T = TUNING.attacks;
const S = SCALE;
const REST_SPREAD = TUNING.rest.spread;
const V = () => new THREE.Vector3();
const _a = V(), _b = V();

const wind = (d, base) => base * (d.tScale ?? 1);
const playerR = (g) => g.player?.radius ?? 0.45;
/** AI weight of `spec` in the wyrm's current phase (per-phase array, or a number from `spec.phase` on). */
function wPhase(spec, d) {
  const ph = Math.max(1, d.phase | 0);
  const w = spec.weight;
  if (Array.isArray(w)) return Number(w[Math.min(w.length - 1, ph - 1)]) || 0;
  return ph >= (spec.phase ?? 1) ? Number(w) || 0 : 0;
}
/** Distance from (x, z) along the unit ray (dx, dz) to the circle of radius B round the arena centre. */
function maxRun(x, z, dx, dz, B) {
  const pd = x * dx + z * dz;
  const c = x * x + z * z - B * B;
  const disc = pd * pd - c;
  return disc > 0 ? Math.max(0, -pd + Math.sqrt(disc)) : 0;
}
function inBound(v, B) {
  const r = Math.hypot(v.x, v.z);
  if (r > B) {
    v.x *= B / r;
    v.z *= B / r;
  }
  return v;
}
/** `v` kept where the wyrm's root may be: its bound in v's direction (dragon.boundAt: the clearing, plus what the wall's fallen trees opened), less `inset` m. */
function inReach(d, v, inset = 0) {
  return inBound(v, d.boundAt(v.x, v.z) - inset);
}
/** maxRun on the wyrm's ground: the circle while the wall stands; once ground is open, the ray is walked out to where the root may no longer be. */
function runIn(d, x, z, dx, dz) {
  if (!d.game.world?.edge?.open) return maxRun(x, z, dx, dz, d.bound);
  let t = 0;
  for (; t < 80; t += 1) {
    const px = x + dx * (t + 1), pz = z + dz * (t + 1);
    if (Math.hypot(px, pz) > d.boundAt(px, pz)) break;
  }
  return t;
}

// ------------------------------------------------------------------ shared flight helpers
/** Lift-off: airborne state (no body circles, staggers wait), dust and a gust, 'dragon:takeoff'. */
function takeOff(d) {
  d.state = 'airborne';
  d.emit('dragon:takeoff');
  const g = d.game, x = d.position.x, z = d.position.z;
  g.world?.gust?.(x, z, 2.0, 14 * S);
  d.fx.dustRing(x, z, 2.6 * S, 44, 1.3);
  g.shake?.(0.2);
}

/** Touch-down: back on the ground ('combat'), dust, a gust, a ground shock (`shock`: not for a crash, it has its crashWave), 'dragon:land'. */
function touchDown(d, heavy = false, shock = true) {
  if (d.state === 'airborne') d.state = 'combat';
  d.position.y = 0;
  const g = d.game, x = d.position.x, z = d.position.z;
  d.emit('dragon:land', { x, z });
  g.world?.gust?.(x, z, heavy ? 2 : 1.5, (heavy ? 22 : 16) * S);
  g.shake?.(heavy ? 0.7 : 0.35);
  d.fx.dustRing(x, z, (heavy ? 2.2 : 1.8) * S, heavy ? 56 : 40, heavy ? 1.6 : 1.1);
  if (shock) d.fx.groundShock?.(x, z, heavy ? 7 : 5.5, heavy ? 1 : 0.7); // (a great weight meets the ground; a crash has its crashWave)
}

/** Every downbeat low over the ground blasts dust out from under the flier. */
function beatDust(d, a) {
  const s = d.rig.s;
  const c = Math.cos(s.flapPhase);
  const prev = a.flapCos ?? c;
  a.flapCos = c;
  if (prev > 0 && c <= 0 && s.flapAmp > 0.3) {
    const k = clamp(1 - s.alt / (13 * 1.15), 0, 1) * s.flapAmp;
    if (k > 0.08) d.fx.wingDust(d.position.x, d.position.z, k);
  }
}

/** Interrupted in the air (death, a plunge, a reset): back to 'combat'; the next action / idle drops it. */
function flightEnd(d, a, interrupted) {
  if (d.state !== 'airborne') return;
  d.state = 'combat';
  if (interrupted && !d.resetting && d.hp <= 0) d.fx.dustRing(d.position.x, d.position.z, 1.8 * S, 36, 1.0);
}

/** Airborne pose basics: legs off the ground, the altitude, the wing beat. */
function fly(pose, alt, flap, hz) {
  pose.airborne = 1;
  pose.alt = alt;
  pose.flap = flap;
  pose.flapHz = hz;
  pose.spread[0] = pose.spread[1] = 1;
  pose.spreadRate = 6;
  pose.bodyRate = 4;
}

/** Re-time beat `b` (until it has flashed) to hazard `ref` reaching the hero. */
function retime(d, a, b, ref) {
  if (!b || b.flashed || !ref) return;
  const s = d.sense;
  const tau = d.hazards.timeTo(ref, s.pos.x, s.pos.z, s.vel.x, s.vel.z, playerR(d.game));
  if (Number.isFinite(tau)) b.impactIn = Math.max(0.05, a.T - b.at + tau);
}

/** On the beat's timing flash, a heat flare where the hazard will meet the hero too (x, z). */
function flareOnFlash(d, a, b, x, z, r = 2.2) {
  if (!b || !b.flashed || a.flared) return;
  a.flared = true;
  d.fx.hazardFlash(x, z, r);
}

// ------------------------------------------------------------------ sky strafe ('Burning pass')
// The line runs from the wyrm over the (led) hero and on to a landing spot past him. The fire front
// (the strip hazard) starts `strip.start` m out and runs to 3 m short of the landing at the pass
// speed; the root follows the front `frontLead` m behind it, the mouth streaming fire onto it.
const SK = T.skyStrafe;
const skyStrafe = {
  name: 'skyStrafe',
  cooldown: SK.cooldown,
  phases: (d) => [['windup', wind(d, SK.windup)], ['takeoff', SK.takeoff], ['pass', SK.pass], ['recovery', wind(d, SK.land)]],
  beats: (d, a) => {
    const b = beat('skyStrafe', 0, a.list[0][1] + SK.takeoff + 0.6, SK, 'mouth');
    retime(d, a, b, a.strip);
    return [b];
  },
  weight: (d, s) => (s.dist >= SK.minDist && s.dist <= SK.maxDist ? wPhase(SK, d) : 0),
  start(d, a) {
    const s = d.sense;
    const tx = s.pos.x + s.vel.x * 0.4, tz = s.pos.z + s.vel.z * 0.4;
    let dx = tx - d.position.x, dz = tz - d.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) {
      dx = d.fwd.x;
      dz = d.fwd.z;
    } else {
      dx /= dist;
      dz /= dist;
    }
    a.dx = dx;
    a.dz = dz;
    a.yaw = Math.atan2(dx, dz);
    a.p0 = V().copy(d.position);
    const D = Math.min(clamp(dist + 14, SK.reach[0], SK.reach[1]), runIn(d, d.position.x, d.position.z, dx, dz));
    a.D = Math.max(14, D);
    const s0 = SK.strip.start, s1 = Math.max(s0 + 4, a.D - 3);
    a.vf = (s1 - s0) / Math.max(0.5, SK.pass * 0.92); // the front covers the strip within the pass
    a.sEnd = 2; // root distance along the line at the end of the takeoff
    a.strip = d.hazards.strip({
      kind: 'strip', attack: 'skyStrafe', announce: false,
      ax: a.p0.x + dx * s0, az: a.p0.z + dz * s0, bx: a.p0.x + dx * s1, bz: a.p0.z + dz * s1,
      w: SK.strip.width, delay: a.list[0][1] + SK.takeoff, speed: a.vf, linger: SK.strip.linger,
      tick: SK.strip.tick, tickDamage: SK.strip.tickDamage, tickBurn: SK.strip.tickBurn,
      damage: SK.damage, burn: SK.burn, knockback: SK.knockback,
      plunge: true, // perfect-dodge the stream from the flying wyrm: the hero lands on its head, it crashes
    });
    a.flapCos = 1;
    a.breathing = false;
    a.flared = false;
  },
  enter(d, a, phase) {
    if (phase === 'takeoff') takeOff(d);
    else if (phase === 'pass') {
      a.breathing = true;
      d.emit('dragon:breathStart');
      d.fx.skyBegin();
      d.emit('dragon:spell', { name: 'skyStrafe', x: d.position.x, z: d.position.z });
    } else if (phase === 'recovery') {
      this.stopBreath(d, a);
      a.sLand = this.along(d, a);
      a.altLand = d.rig.s.alt;
      a.landed = false;
    }
  },
  stopBreath(d, a) {
    if (!a.breathing) return;
    a.breathing = false;
    d.fx.skyEnd();
    d.emit('dragon:breathEnd');
  },
  along(d, a) {
    return (d.position.x - a.p0.x) * a.dx + (d.position.z - a.p0.z) * a.dz;
  },
  place(d, a, s) {
    d.position.x = a.p0.x + a.dx * s;
    d.position.z = a.p0.z + a.dz * s;
    inReach(d, d.position);
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k, f = d.fwd;
    const h = d.hazards.get(a.strip);
    retime(d, a, a.cur, a.strip);
    if (h) {
      const sp = clamp((d.sense.pos.x - h.ax) * h.dx + (d.sense.pos.z - h.az) * h.dz, 0, h.len);
      flareOnFlash(d, a, a.cur, h.ax + h.dx * sp, h.az + h.dz * sp, 2.4);
    }
    if (a.phase === 'windup') {
      // crouched, the throat charging, the wings opening for the first downstroke; it looks down the line
      d.turnToward(a.yaw, d.turnRate * 1.6, dt);
      pose.lower = 0.35 + 0.35 * k;
      pose.pitch = 0.08;
      pose.strideH = 0.45 * k;
      pose.strideF = -0.3 * k;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = k > 0.4 ? 1 : REST_SPREAD;
      pose.spreadRate = 4;
      pose.head = d.rootPt(pose.headTarget, 0, 4.4, 3.6);
      pose.headRate = 5;
      pose.jaw = 0.3 + 0.2 * k;
      d.throat = k;
      d.fx.mouthEmbers(dt, pt.mouth, 20 + 30 * k, pt.headFwd);
      return;
    }
    beatDust(d, a);
    d.yaw = a.yaw;
    pose.vel.set(0, 0, 0);
    if (a.phase === 'takeoff') {
      // the launch: heavy downbeats, climbing steeply to the pass height, drifting a little forward
      const e = easeOutCubic(k);
      this.place(d, a, a.sEnd * k * k);
      fly(pose, SK.alt * e, 0.9, 2.3);
      pose.pitch = -0.22 * (1 - k) - 0.05;
      pose.lower = 0.5 * (1 - e);
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.2 * S);
      pose.head.y += 0.4 * S;
      pose.headRate = 6;
      d.rootPt(pose.look, 0, 0, 14);
      pose.jaw = 0.5;
      d.throat = 1;
      pose.tailWave = 0.05;
    } else if (a.phase === 'pass') {
      // the pass: gliding low and fast along the line, nose down, breathing fire onto the front
      const fr = h ? clamp((h.t - h.impact) * h.speed, 0, h.len) : 0;
      const running = h && fr < h.len - 1e-3;
      const front = SK.strip.start + fr;
      this.place(d, a, Math.max(a.sEnd, front - SK.frontLead));
      if (h && running) {
        const fx = h.ax + h.dx * fr, fz = h.az + h.dz * fr;
        if (a.breathing) d.fx.skyStream(dt, pt.mouth, fx, fz);
        pose.look.set(fx, 0, fz);
      } else {
        this.stopBreath(d, a);
        d.rootPt(pose.look, 0, 0, 16);
      }
      fly(pose, SK.alt + 0.35 * Math.sin(a.t * 3.4), 0.42, 1.6);
      pose.glide = 0.8;
      pose.pitch = 0.17;
      pose.headExact = true;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.5 * S);
      pose.head.y -= 0.8 * S;
      pose.headRate = 8;
      pose.lookDown = 1.25;
      pose.lookRate = 14;
      pose.jaw = a.breathing ? 0.95 : 0.4;
      d.throat = a.breathing ? 1 : 0.3;
      pose.tailWave = 0.03;
    } else {
      // the landing on the far side: a braking glide down, legs reaching, the wings snapping open
      const u = clamp(k / 0.55, 0, 1);
      if (!a.landed) {
        if (fixOn() && Number.isFinite(a.vf)) {
          // (the motion audit) the glide starts at the pass's own speed and brakes to a stop (a Hermite):
          // easeOutCubic started it at 3x its average, a 1 m jump in the body the frame the pass ended
          const T = 0.55 * Math.max(0.05, a.dur), L = a.D - a.sLand, v0 = clamp(a.vf, 0, (3 * Math.max(0, L)) / T);
          this.place(d, a, a.sLand + v0 * T * (u - 2 * u * u + u * u * u) + L * (3 * u * u - 2 * u * u * u));
        } else {
          const e = easeOutCubic(u);
          this.place(d, a, lerp(a.sLand, a.D, e));
        }
        fly(pose, a.altLand * (1 - smoothstep(0, 1, u)), 0.65, 2.7);
        pose.glide = 0.35 * (1 - u);
        pose.airReach = smoothstep(0.2, 0.8, u);
        pose.pitch = -0.14;
        d.rootPt(pose.look, 0, 0, 12);
        if (u >= 1) {
          a.landed = true;
          touchDown(d, false);
        }
      } else {
        const v = (k - 0.55) / 0.45;
        pose.lower = 0.55 * (1 - v);
        pose.pitch = 0.12 * (1 - v);
        pose.spread[0] = pose.spread[1] = v < 0.3 ? 1 : REST_SPREAD;
        pose.spreadRate = v < 0.3 ? 14 : 3;
        pose.restep = 1;
        pose.bodyRate = 6;
      }
      pose.jaw = 0.2;
      d.throat = 0;
    }
  },
  end(d, a, interrupted) {
    this.stopBreath(d, a);
    if (interrupted) d.hazards.cutStrip(a.strip);
    d.throat = 0;
    flightEnd(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ dive bomb ('Sky dive')
const DB = T.diveBomb;
const diveBomb = {
  name: 'diveBomb',
  cooldown: DB.cooldown,
  phases: (d) => [['windup', wind(d, DB.windup)], ['climb', DB.climb], ['hover', DB.hover], ['dive', DB.dive], ['recovery', wind(d, DB.recovery)]],
  // the tell comes as it hovers: the red glow ramps and the ring tracks the hero through the hover,
  // locks as it tips into the dive; the crash landing is the blow (a perfect dodge may plunge)
  beats: (d, a) => [beat('diveBomb', a.list[0][1] + DB.climb, DB.hover + DB.dive, DB, 'chest')],
  zone(d, a, out) {
    out.copy(a.target);
    out.y = 0;
    return DB.radius;
  },
  weight: (d, s) => (s.dist >= DB.minDist ? wPhase(DB, d) : 0),
  start(d, a) {
    a.target = V().copy(d.sense.pos);
    a.target.y = 0;
    a.p0 = V().copy(d.position);
    a.side = d.position.x >= d.sense.pos.x ? 1 : -1; // it hovers on the side it came from
    a.hov = V().copy(d.position);
    a.dv0 = V();
    a.flapCos = 1;
    a.crashed = false;
    a.locked = false;
    this.track(d, a, 1, 0);
  },
  /** The target follows the (led) hero with a lag, kept clear of stones and inside the bound. */
  track(d, a, dt, lead) {
    const s = d.sense, g = d.game;
    _a.copy(s.pos).addScaledVector(s.vel, lead);
    const k = 1 - Math.exp(-DB.track * dt);
    a.target.x += (_a.x - a.target.x) * k;
    a.target.z += (_a.z - a.target.z) * k;
    const R = TUNING.radius;
    g.world?.resolve?.(a.target, R, d.boundAt(a.target.x, a.target.z) + R);
    inReach(d, a.target);
    a.target.y = 0;
  },
  /**
   * Hover point: `hoverBack` m beside the target, on the side it came from. The game camera looks north
   * from ~58° up, so altitude lifts a flier up-screen (~0.53 m per m up against ~0.85 per m north):
   * hovering ~14 m up over a point north of the hero put it off the top of the screen, and over a point
   * on the camera side its raised wings filled the screen and hid the ring. Beside him it hangs up and
   * to one side of the hero on screen, with the ring in view, and dives diagonally onto him.
   */
  hoverPoint(d, a, out) {
    out.set(a.target.x + a.side * DB.hoverBack, 0, a.target.z - 1);
    inReach(d, out);
    // pinned against the bound on its side: hover on the other side instead
    if (Math.abs(out.x - a.target.x) < DB.hoverBack * 0.5) out.set(a.target.x - a.side * DB.hoverBack, 0, a.target.z - 1);
    return inReach(d, out);
  },
  enter(d, a, phase) {
    if (phase === 'climb') takeOff(d);
    else if (phase === 'dive') {
      a.locked = true;
      a.dv0.copy(d.position);
      a.alt0 = Math.max(2, d.rig.s.alt);
      d.emit('dragon:spell', { name: 'diveBomb', x: a.target.x, z: a.target.z });
    } else if (phase === 'recovery') this.crash(d, a);
  },
  crash(d, a, deal = true) {
    if (a.crashed) return;
    a.crashed = true;
    d.position.x = a.target.x;
    d.position.z = a.target.z;
    touchDown(d, true, false);
    d.hitstop(0.09);
    d.fx.crashWave(a.target.x, a.target.z, DB.radius);
    d.game.world?.impact?.(a.target.x, a.target.z, DB.radius, TUNING.world.dive, GROUND_BLOW);
    d.emit('dragon:hazard', { kind: 'crash', stage: 'hit', x: a.target.x, z: a.target.z, radius: DB.radius });
    if (!deal) return;
    d.markHitbox?.(a.target.x, 0, a.target.z, DB.radius);
    const p = d.game.player?.position;
    if (p && Math.hypot(p.x - a.target.x, p.z - a.target.z) <= DB.radius + playerR(d.game)) {
      d.strike(a, { damage: DB.damage, knockback: DB.knockback, knockdown: true, burn: DB.burn, kind: 'dive', from: a.target, point: a.target });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k;
    if (!a.locked) this.track(d, a, dt, DB.lead);
    pose.look.copy(a.target);
    if (a.phase === 'windup') {
      // deep crouch, legs bunched, the wings opening: it is about to leap into the sky
      d.turnToward(d.sense.yawTo, d.turnRate, dt);
      pose.lower = 0.75 * smoothstep(0, 0.7, k);
      pose.bodyRate = 6;
      pose.pitch = 0.05;
      pose.strideH = 0.55;
      pose.strideF = -0.45;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 3.4, 4.2);
      pose.jaw = 0.4;
      d.throat = 0.3 * k;
      return;
    }
    if (a.phase === 'recovery') {
      // the crash landing: the body slams low on braced legs, the wings snap open, then it rises
      const e = 1 - smoothstep(0, 1, k);
      pose.lower = 0.85 * e;
      pose.pitch = 0.28 * e;
      pose.bodyRate = k < 0.15 ? 16 : 4;
      pose.elbowsOut = 0.5 * e;
      pose.spread[0] = pose.spread[1] = k < 0.3 ? 1 : REST_SPREAD;
      pose.spreadRate = k < 0.3 ? 16 : 3;
      pose.jaw = k < 0.4 ? 0.7 : 0.15;
      pose.restep = 1;
      d.throat = 0;
      return;
    }
    beatDust(d, a);
    d.turnToward(Math.atan2(a.target.x - d.position.x, a.target.z - d.position.z), 3.2, dt);
    pose.vel.set(0, 0, 0);
    if (a.phase === 'climb') {
      // heavy downbeats up to the dive height, sliding over to the hover point
      const e = easeOutCubic(k);
      this.hoverPoint(d, a, a.hov);
      d.position.x = lerp(a.p0.x, a.hov.x, easeInOutSine(k));
      d.position.z = lerp(a.p0.z, a.hov.z, easeInOutSine(k));
      fly(pose, DB.alt * e, 0.95, 2.2);
      pose.hover = smoothstep(0, 0.6, k); // (early: the hanging tail curls up as it climbs)
      pose.glide = 0.45 * k; // (the beat's span a little lower: the raised sails reached the camera)
      pose.pitch = -0.2 - 0.2 * k;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(d.fwd, 2.0 * S);
      pose.head.y += 0.6 * S;
      pose.jaw = 0.4;
    } else if (a.phase === 'hover') {
      // hanging in the sky on big strokes, glaring down at the ring that follows the hero
      this.hoverPoint(d, a, _b);
      const kk = 1 - Math.exp(-3 * dt);
      d.position.x += (_b.x - d.position.x) * kk;
      d.position.z += (_b.z - d.position.z) * kk;
      fly(pose, DB.alt + 0.5 * Math.sin(a.t * 3.1), 0.95, 2.0);
      pose.hover = 1;
      pose.glide = 0.45;
      pose.pitch = -0.42;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(d.fwd, 2.3 * S);
      pose.head.y -= 0.3 * S;
      pose.lookDown = 1.2;
      pose.jaw = 0.5 + 0.3 * k;
      d.throat = 0.6 * k;
    } else {
      // the dive: wings swept back, nose down, accelerating onto the ring; the legs reach for it. The
      // body's altitude follows exactly (altRate) and meets the ground a moment before the impact
      const kk = Math.min(1, k / 0.9);
      const e = easeInCubic(kk) * 0.65 + kk * 0.35;
      d.position.x = lerp(a.dv0.x, a.target.x, e);
      d.position.z = lerp(a.dv0.z, a.target.z, e);
      fly(pose, a.alt0 * (1 - e), 0, 2);
      pose.altRate = 60;
      pose.spread[0] = pose.spread[1] = 0.55;
      pose.spreadRate = 10;
      pose.dive = 1;
      pose.pitch = 0.75 * smoothstep(0, 0.35, k) - 0.35 * smoothstep(0.7, 1, k);
      pose.bodyRate = 10;
      pose.airReach = smoothstep(0.35, 0.9, k);
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(d.fwd, 2.4 * S);
      pose.head.y -= 1.0 * S;
      pose.headRate = 10;
      pose.lookDown = 1.2;
      if (fixOn()) {
        pose.head.y = Math.max(pose.head.y, DIVE_HEAD_Y); // (the motion audit: as the flying combos' dive)
        pose.lookDown = 0.75;
      }
      pose.jaw = 1;
      d.throat = 0.8;
    }
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flightEnd(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ hover barrage
const HB = T.hoverBarrage;
const NO_HIT_VOLLEY = () => ({ hitDone: true }); // the shells are visual: the ring hazards deal the blows
const hoverBarrage = {
  name: 'hoverBarrage',
  cooldown: HB.cooldown,
  phases: (d) => {
    const n = HB.shots[0] + Math.floor(Math.random() * (HB.shots[1] - HB.shots[0] + 1));
    return [['windup', wind(d, HB.windup)], ['rise', HB.rise], ['barrage', HB.aim + n * HB.interval + 0.25], ['recovery', wind(d, HB.land)]];
  },
  // one red beat per shell: its ring and tell `aim` s before the spit, the flash re-timed at launch
  beats: (d, a) => {
    const out = [];
    const t0 = a.list[0][1] + a.list[1][1];
    for (let i = 0; i < a.n; i++) out.push(beat('hoverBarrage', t0 + i * HB.interval, HB.aim + 0.75, HB, 'shell', { shot: i }));
    return out;
  },
  weight: (d, s) => (s.dist >= HB.minDist ? wPhase(HB, d) : 0),
  start(d, a) {
    a.n = Math.max(1, Math.round((a.list[2][1] - HB.aim - 0.25) / HB.interval));
    a.volley = NO_HIT_VOLLEY();
    a.group = d.hazards.group(HB.maxHits);
    a.rings = [];
    a.aimed = 0;
    a.shot = 0;
    a.recoil = 0;
    a.flapCos = 1;
    a.hov = V().copy(d.position);
    a.p0 = V().copy(d.position);
    a.side = d.position.x >= d.sense.pos.x ? 1 : -1;
  },
  /**
   * Hover spot: `standoff` m beside the hero (east or west, the side it came from) and a little toward
   * the camera, so the hovering wyrm and its shells' arcs stay on screen (see diveBomb.hoverPoint).
   */
  hoverPoint(d, a, out) {
    const s = d.sense;
    out.set(s.pos.x + a.side * HB.standoff, 0, s.pos.z + 1.5);
    inReach(d, out);
    // pinned against the bound on its side: hover on the other side instead
    if (Math.abs(out.x - s.pos.x) < HB.standoff * 0.5) out.set(s.pos.x - a.side * HB.standoff, 0, s.pos.z + 1.5);
    return inReach(d, out);
  },
  enter(d, a, phase) {
    if (phase === 'rise') {
      takeOff(d);
      d.emit('dragon:spell', { name: 'hoverBarrage', x: d.position.x, z: d.position.z });
    } else if (phase === 'recovery') {
      a.altLand = d.rig.s.alt;
      a.landed = false;
    }
  },
  /** Ring shot i on the led hero (bracketing his dodge for the later shots). */
  aim(d, a, i) {
    const s = d.sense, g = d.game;
    _a.copy(s.pos).addScaledVector(s.vel, HB.lead);
    if (i > 0 && i % 2 === 1) {
      const dx = _a.x - d.position.x, dz = _a.z - d.position.z, l = Math.hypot(dx, dz) || 1;
      const side = i % 4 === 1 ? 1 : -1;
      _a.x += (-dz / l) * 2.6 * side;
      _a.z += (dx / l) * 2.6 * side;
    }
    inBound(_a, d.arenaAt(_a.x, _a.z, 27));
    g.world?.resolve?.(_a, 0.5, d.arenaAt(_a.x, _a.z, 30));
    const b = a.beats[i];
    const ref = d.hazards.circle({
      kind: 'shell', attack: 'hoverBarrage', announce: false, x: _a.x, z: _a.z, r: HB.radius, delay: HB.aim + 0.75,
      damage: HB.damage, burn: HB.burn, knockback: HB.knockback, group: a.group, active: 0.1,
      plunge: true, // a perfectly dodged shell: the hero plunges onto the hovering wyrm (it crashes)
    });
    a.rings[i] = ref;
    if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + HB.aim + 0.75);
  },
  /** Spit shell i at its ring: the flight re-times the ring and the beat's flash. */
  launch(d, a, i) {
    const h = d.hazards.get(a.rings[i]);
    if (!h) return;
    const from = d.rig.pt.mouth;
    _b.set(h.x, 0, h.z);
    let flight = d.fx.launchFireball(from, _b, a.volley);
    if (!(flight > 0)) {
      // no free shell slot: the ring draws its own shell
      flight = Math.min(1.3, Math.max(0.7, Math.hypot(h.x - from.x, h.z - from.z) / 18));
      h.shell = true;
      h.fall = flight;
      h.ox = from.x;
      h.oy = from.y;
      h.oz = from.z;
    }
    h.impact = h.t + flight;
    h.end = h.impact + h.active + 0.3;
    const b = a.beats[i];
    if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + flight);
    a.recoil = 1;
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, s = d.sense, k = a.k;
    a.recoil = Math.max(0, a.recoil - dt * 4);
    pose.look.copy(s.chest);
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate, dt);
      pose.lower = 0.6 * smoothstep(0, 0.7, k);
      pose.bodyRate = 6;
      pose.strideH = 0.5;
      pose.strideF = -0.4;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 3.6, 4.0);
      pose.jaw = 0.35;
      d.throat = 0.4 * k;
      return;
    }
    if (a.phase === 'recovery') {
      const u = clamp(k / 0.55, 0, 1);
      if (!a.landed) {
        fly(pose, a.altLand * (1 - smoothstep(0, 1, u)), 0.65, 2.7);
        pose.hover = 1 - u;
        pose.airReach = smoothstep(0.15, 0.8, u);
        pose.pitch = -0.2 * (1 - u);
        beatDust(d, a);
        if (u >= 1) {
          a.landed = true;
          touchDown(d, false);
        }
      } else {
        const v = (k - 0.55) / 0.45;
        pose.lower = 0.5 * (1 - v);
        pose.spread[0] = pose.spread[1] = v < 0.3 ? 1 : REST_SPREAD;
        pose.spreadRate = v < 0.3 ? 14 : 3;
        pose.restep = 1;
      }
      pose.jaw = 0.2;
      d.throat = 0;
      return;
    }
    beatDust(d, a);
    d.turnToward(s.yawTo, 2.6, dt);
    pose.vel.set(0, 0, 0);
    this.hoverPoint(d, a, a.hov);
    if (a.phase === 'rise') {
      d.position.x = lerp(a.p0.x, a.hov.x, easeInOutSine(k));
      d.position.z = lerp(a.p0.z, a.hov.z, easeInOutSine(k));
      fly(pose, HB.alt * easeOutCubic(k), 0.9, 2.2);
      pose.hover = smoothstep(0.2, 1, k);
      pose.pitch = -0.3;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(d.fwd, 2.1 * S);
      pose.head.y += 0.4 * S;
      pose.jaw = 0.4;
      d.throat = 0.5;
      return;
    }
    // the barrage: hovering on steady strokes, head down at the hero, spitting shell after shell
    const kk = 1 - Math.exp(-2 * dt);
    d.position.x += (a.hov.x - d.position.x) * kk;
    d.position.z += (a.hov.z - d.position.z) * kk;
    inReach(d, d.position);
    while (a.aimed < a.n && a.t >= a.aimed * HB.interval) this.aim(d, a, a.aimed++);
    while (a.shot < a.n && a.shot < a.aimed && a.t >= a.shot * HB.interval + HB.aim) this.launch(d, a, a.shot++);
    fly(pose, HB.alt + 0.4 * Math.sin(a.t * 3.3), 0.85, 2.0);
    pose.hover = 1;
    pose.pitch = -0.26;
    pose.headExact = true; // each shell leaves the mouth
    pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(d.fwd, 2.2 * S);
    pose.head.y -= 0.5 * S;
    pose.headRate = 7;
    pose.lookDown = 1.2;
    pose.jaw = a.recoil > 0.3 ? 1 : 0.45;
    pose.jawRate = 25;
    d.throat = 0.8;
    if (a.recoil > 0) {
      pose.headOffset.x -= d.fwd.x * a.recoil * 0.8 * S;
      pose.headOffset.z -= d.fwd.z * a.recoil * 0.8 * S;
      pose.headOffset.y += a.recoil * 0.6 * S;
    }
    d.fx.mouthEmbers(dt, pt.mouth, 18, pt.headFwd);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flightEnd(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ flying combos (second pass)
// One take-off, several cued parts strung together in the air, a crash landing at the end (the last
// blow and the opening after it). The list of phases is built from TUNING.attacks[key].parts:
//   pass     [takeoff | swoop] pass       a low strafe along a line over the led hero breathing a
//                                         burning strip (plunge: true), as the Burning pass
//   barrage  [rise | wheel] barrage       hovering beside the hero, one shell a beat (plunge: true)
//   dive     [rise | wheel] hover dive    wheels round to hover beside him, tracks him, dives: the
//                                         crash (enter 'recovery') is the blow
// A 'wheel' is a banking turn: a curve that leaves along the way it was flying (no snap), rolls the
// body into the turn and climbs; a 'swoop' drops and turns onto the next pass's line. Each phase
// entry carries its part's index as a third element ([name, s, part]): the runner reads only the
// first two. Beats: one per blow, at the start of the move that leads into it (the first part's at
// the windup), re-timed from the strip / the shells as the strafe and the barrage do.
const FL = FLIGHT, FP = FL.pass, FB = FL.barrage, FD = FL.dive;
const perPh = (v, d) => (Array.isArray(v) ? v[clamp((d.phase | 0) - 1, 0, v.length - 1)] : v);
const _c = V(), _e = V();
/** Quadratic Bezier on the ground plane (x, z) into `out`, and its tangent into `tan`. */
function bez2(out, tan, p0, p1, p2, t) {
  const u = 1 - t;
  out.x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
  out.z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;
  tan.x = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  tan.z = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
  return out;
}

function makeFlightCombo(key) {
  const C = T[key];
  const parts = C.parts;
  const shots = (d) => Math.max(1, perPh(FB.shots, d) | 0);
  const every = (d) => perPh(FB.interval, d);
  return {
    name: key,
    cooldown: C.cooldown,
    flight: true,
    phases(d) {
      const list = [['windup', wind(d, C.windup)]];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p === 'pass') {
          list.push(i === 0 ? ['takeoff', FL.takeoff, i] : ['swoop', FL.swoop, i]);
          list.push(['pass', FP.time, i]);
        } else if (p === 'barrage') {
          list.push(i === 0 ? ['rise', FL.rise, i] : ['wheel', FL.wheel, i]);
          list.push(['barrage', FB.aim + shots(d) * every(d) + 0.25, i]);
        } else {
          list.push(i === 0 ? ['rise', FL.rise, i] : ['wheel', FL.wheel, i]);
          list.push(['hover', perPh(FD.hover, d), i]);
          list.push(['dive', FD.dive, i]);
        }
      }
      list.push(['recovery', wind(d, C.recovery)]);
      return list;
    },
    beats(d, a) {
      const out = [];
      let t = 0;
      const L = a.list;
      for (let i = 0; i < L.length; i++) {
        const name = L[i][0], dur = L[i][1], seg = a.segs[L[i][2]];
        if (seg) {
          if (name === 'takeoff' || name === 'swoop') {
            // (the first part's tell is the windup: the crouch, the throat charging)
            const at = L[i][2] === 0 ? 0 : t;
            const b = beat(key, at, t - at + dur + 0.6, C, 'mouth', { seg: L[i][2] });
            seg.beats.push(b);
            out.push(b);
          } else if (name === 'barrage') {
            for (let j = 0; j < a.n; j++) {
              const b = beat(key, t + j * a.every, FB.aim + 0.75, C, 'shell', { seg: L[i][2], shot: j });
              seg.beats.push(b);
              out.push(b);
            }
          } else if ((name === 'rise' || name === 'wheel') && seg.kind === 'dive') {
            const at = L[i][2] === 0 ? 0 : t;
            const b = beat(key, at, t - at + dur + L[i + 1][1] + L[i + 2][1], C, 'chest', { seg: L[i][2] });
            seg.beats.push(b);
            out.push(b);
          }
        }
        t += dur;
      }
      return out;
    },
    weight: (d, s) => (s.dist >= (C.minDist ?? 0) && s.dist <= (C.maxDist ?? 99) ? wPhase(C, d) : 0),
    start(d, a) {
      a.segs = parts.map((kind) => ({ kind, beats: [], strip: null, rings: [], aimed: 0, shot: 0 }));
      a.n = shots(d);
      a.every = every(d);
      a.volley = NO_HIT_VOLLEY();
      a.group = d.hazards.group(FB.maxHits);
      a.target = V().copy(d.sense.pos);
      a.target.y = 0;
      a.from = V().copy(d.position);
      a.p0 = V().copy(d.position);
      a.goal = V();
      a.ctrl = V();
      a.dv0 = V();
      a.dx = d.fwd.x;
      a.dz = d.fwd.z;
      a.yaw = d.yaw;
      a.D = 20;
      a.sEnd = 2;
      a.alt0 = 0;
      a.side = d.position.x >= d.sense.pos.x ? 1 : -1;
      a.roll = 0;
      a.lastYaw = d.yaw;
      a.recoil = 0;
      a.flapCos = 1;
      a.breathing = false;
      a.locked = false;
      a.crashed = false;
      a.landed = false;
      a.seg = null;
      a.strip = null;
      a.flared = false;
    },
    /** The current part's record (the phase entry's third element). */
    segOf(a) {
      return a.segs[a.list[a.i]?.[2]] ?? null;
    },
    /** A pass's line from where the wyrm is now over the led hero; its strip starts burning `delay` s from now. */
    planPass(d, a, seg, delay) {
      const s = d.sense;
      const tx = s.pos.x + s.vel.x * 0.4, tz = s.pos.z + s.vel.z * 0.4;
      let dx = tx - d.position.x, dz = tz - d.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-3) {
        dx = d.fwd.x;
        dz = d.fwd.z;
      } else {
        dx /= dist;
        dz /= dist;
      }
      a.dx = dx;
      a.dz = dz;
      a.yaw = Math.atan2(dx, dz);
      a.p0.copy(d.position);
      a.p0.y = 0;
      a.D = Math.max(14, Math.min(clamp(dist + 14, FP.reach[0], FP.reach[1]), runIn(d, d.position.x, d.position.z, dx, dz)));
      const s0 = FP.start, s1 = Math.max(s0 + 4, a.D - 3);
      a.vf = (s1 - s0) / Math.max(0.5, FP.time * 0.92);
      a.sEnd = 2;
      a.flared = false;
      seg.strip = a.strip = d.hazards.strip({
        kind: 'strip', attack: key, announce: false,
        ax: a.p0.x + dx * s0, az: a.p0.z + dz * s0, bx: a.p0.x + dx * s1, bz: a.p0.z + dz * s1,
        w: FP.width, delay, speed: a.vf, linger: perPh(FP.linger, d),
        tick: FP.tick, tickDamage: FP.tickDamage, tickBurn: FP.tickBurn,
        damage: FP.damage, burn: FP.burn, knockback: FP.knockback, plunge: true,
      });
    },
    place(d, a, s) {
      d.position.x = a.p0.x + a.dx * s;
      d.position.z = a.p0.z + a.dz * s;
      inReach(d, d.position);
    },
    stopBreath(d, a) {
      if (!a.breathing) return;
      a.breathing = false;
      d.fx.skyEnd();
      d.emit('dragon:breathEnd');
    },
    /** Where the next hover is (into `out`): beside the dive target, or beside the hero for a barrage. */
    hoverGoal(d, a, out, kind) {
      const s = d.sense;
      if (kind === 'dive') {
        out.set(a.target.x + a.side * FD.hoverBack, 0, a.target.z - 1);
        inReach(d, out);
        if (Math.abs(out.x - a.target.x) < FD.hoverBack * 0.5) out.set(a.target.x - a.side * FD.hoverBack, 0, a.target.z - 1);
      } else {
        out.set(s.pos.x + a.side * FB.standoff, 0, s.pos.z + 1.5);
        inReach(d, out);
        if (Math.abs(out.x - s.pos.x) < FB.standoff * 0.5) out.set(s.pos.x - a.side * FB.standoff, 0, s.pos.z + 1.5);
      }
      return inReach(d, out);
    },
    /** The dive target follows the (led) hero with a lag until the dive, clear of stones, in the bound. */
    track(d, a, dt) {
      const s = d.sense;
      _a.copy(s.pos).addScaledVector(s.vel, FD.lead);
      const k = 1 - Math.exp(-FD.track * dt);
      a.target.x += (_a.x - a.target.x) * k;
      a.target.z += (_a.z - a.target.z) * k;
      const R = TUNING.radius;
      d.game.world?.resolve?.(a.target, R, d.boundAt(a.target.x, a.target.z) + R);
      inReach(d, a.target);
      a.target.y = 0;
    },
    enter(d, a, phase) {
      const seg = this.segOf(a);
      a.seg = seg;
      const alt = Number.isFinite(d.rig.s.alt) ? d.rig.s.alt : 0;
      if (phase === 'takeoff') {
        takeOff(d);
        this.planPass(d, a, seg, FL.takeoff);
      } else if (phase === 'swoop') {
        this.stopBreath(d, a);
        a.from.copy(d.position);
        a.alt0 = alt;
        this.planPass(d, a, seg, FL.swoop);
      } else if (phase === 'pass') {
        a.breathing = true;
        d.emit('dragon:breathStart');
        d.fx.skyBegin();
        d.emit('dragon:spell', { name: key, part: 'pass', x: d.position.x, z: d.position.z });
      } else if (phase === 'rise' || phase === 'wheel') {
        this.stopBreath(d, a);
        if (phase === 'rise') takeOff(d);
        a.from.copy(d.position);
        a.alt0 = phase === 'rise' ? 0 : alt;
        a.yaw0 = d.yaw;
        a.side = d.position.x >= d.sense.pos.x ? 1 : -1;
        if (seg?.kind === 'dive') {
          a.target.copy(d.sense.pos);
          a.target.y = 0;
          a.locked = false;
        }
        // the curve leaves along the way it flies (a wheel) and reaches out at most 14 m
        _b.set(d.fwd.x, 0, d.fwd.z);
        this.hoverGoal(d, a, a.goal, seg?.kind);
        const L = clamp(0.6 * Math.hypot(a.goal.x - a.from.x, a.goal.z - a.from.z), 5, 14);
        a.ctrl.copy(a.from).addScaledVector(_b, phase === 'wheel' ? L : 0.5);
        inReach(d, a.ctrl, 1);
      } else if (phase === 'barrage') {
        seg.aimed = seg.shot = 0;
        d.emit('dragon:spell', { name: key, part: 'barrage', x: d.position.x, z: d.position.z });
      } else if (phase === 'dive') {
        a.locked = true;
        a.dv0.copy(d.position);
        a.alt0 = Math.max(2, alt);
        d.emit('dragon:spell', { name: key, part: 'dive', x: a.target.x, z: a.target.z });
      } else if (phase === 'recovery') {
        this.crash(d, a);
      }
    },
    crash(d, a) {
      if (a.crashed) return;
      a.crashed = true;
      // (it lands on its ground: the target was kept clear of stones against the bound + its radius, and a
      // landing up to that far out stood it off its ground through the recovery; ADR-223's seeds found it)
      inReach(d, a.target);
      d.position.x = a.target.x;
      d.position.z = a.target.z;
      touchDown(d, true, false);
      d.hitstop(0.09);
      d.fx.crashWave(a.target.x, a.target.z, FD.radius);
      d.game.world?.impact?.(a.target.x, a.target.z, FD.radius, TUNING.world.dive, GROUND_BLOW);
      d.emit('dragon:hazard', { kind: 'crash', stage: 'hit', x: a.target.x, z: a.target.z, radius: FD.radius });
      d.markHitbox?.(a.target.x, 0, a.target.z, FD.radius);
      const p = d.game.player?.position;
      if (p && Math.hypot(p.x - a.target.x, p.z - a.target.z) <= FD.radius + playerR(d.game)) {
        d.strike(a, { damage: FD.damage, knockback: FD.knockback, knockdown: true, burn: FD.burn, kind: 'dive', from: a.target, point: a.target });
      }
    },
    /** Shell i of the current barrage: its ring on the led hero (bracketing his dodge for the odd ones). */
    aim(d, a, seg, i) {
      const s = d.sense, g = d.game;
      _a.copy(s.pos).addScaledVector(s.vel, FB.lead);
      if (i > 0 && i % 2 === 1) {
        const dx = _a.x - d.position.x, dz = _a.z - d.position.z, l = Math.hypot(dx, dz) || 1;
        const side = i % 4 === 1 ? 1 : -1;
        _a.x += (-dz / l) * 2.6 * side;
        _a.z += (dx / l) * 2.6 * side;
      }
      inBound(_a, d.arenaAt(_a.x, _a.z, 27));
      g.world?.resolve?.(_a, 0.5, d.arenaAt(_a.x, _a.z, 30));
      const b = seg.beats[i];
      seg.rings[i] = d.hazards.circle({
        kind: 'shell', attack: key, announce: false, x: _a.x, z: _a.z, r: FB.radius, delay: FB.aim + 0.75,
        damage: FB.damage, burn: FB.burn, knockback: FB.knockback, group: a.group, active: 0.1, plunge: true,
      });
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + FB.aim + 0.75);
    },
    launch(d, a, seg, i) {
      const h = d.hazards.get(seg.rings[i]);
      if (!h) return;
      const from = d.rig.pt.mouth;
      _b.set(h.x, 0, h.z);
      let flight = d.fx.launchFireball(from, _b, a.volley);
      if (!(flight > 0)) {
        flight = Math.min(1.3, Math.max(0.7, Math.hypot(h.x - from.x, h.z - from.z) / 18));
        h.shell = true;
        h.fall = flight;
        h.ox = from.x;
        h.oy = from.y;
        h.oz = from.z;
      }
      h.impact = h.t + flight;
      h.end = h.impact + h.active + 0.3;
      const b = seg.beats[i];
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + flight);
      a.recoil = 1;
    },
    /** The body banks into a turn: roll eases toward the yaw rate (rad / s) x 0.2. */
    bank(d, a, dt, gain = 0.2) {
      const rate = angleDiff(a.lastYaw, d.yaw) / Math.max(1e-3, dt);
      a.lastYaw = d.yaw;
      const want = clamp(-rate * gain, -0.5, 0.5);
      a.roll += (want - a.roll) * (1 - Math.exp(-6 * dt));
      if (!Number.isFinite(a.roll)) a.roll = 0;
      d.pose.roll = a.roll;
    },
    update(d, a, dt) {
      const pose = d.pose, pt = d.rig.pt, s = d.sense, k = a.k, seg = a.seg ?? this.segOf(a);
      a.recoil = Math.max(0, a.recoil - dt * 4);
      if (!a.locked) this.track(d, a, dt);
      // the strafe's beat follows its strip until it flashes
      if (seg && a.strip && (a.phase === 'takeoff' || a.phase === 'swoop' || a.phase === 'pass')) {
        const b = seg.beats[0];
        retime(d, a, b, a.strip);
        const h = d.hazards.get(a.strip);
        if (h) {
          const sp = clamp((s.pos.x - h.ax) * h.dx + (s.pos.z - h.az) * h.dz, 0, h.len);
          flareOnFlash(d, a, b, h.ax + h.dx * sp, h.az + h.dz * sp, 2.4);
        }
      }
      if (a.phase === 'windup') {
        // crouched low on bunched legs, the wings opening for the first downstroke, the throat charging
        d.turnToward(s.yawTo, d.turnRate * 1.4, dt);
        pose.lower = 0.35 + 0.4 * smoothstep(0, 0.8, k);
        pose.bodyRate = 6;
        pose.pitch = 0.07;
        pose.strideH = 0.5 * k;
        pose.strideF = -0.4 * k;
        pose.restep = 1;
        pose.spread[0] = pose.spread[1] = k > 0.35 ? 1 : REST_SPREAD;
        pose.spreadRate = 4.5;
        pose.head = d.rootPt(pose.headTarget, 0, 4.0, 3.8);
        pose.headRate = 5;
        pose.jaw = 0.3 + 0.25 * k;
        d.throat = k;
        d.fx.mouthEmbers(dt, pt.mouth, 20 + 30 * k, pt.headFwd);
        return;
      }
      if (a.phase === 'recovery') {
        // the crash landing: slammed low on braced legs, the wings snapped open, then it rises
        const e = 1 - smoothstep(0, 1, k);
        pose.lower = 0.85 * e;
        pose.pitch = 0.28 * e;
        pose.bodyRate = k < 0.15 ? 16 : 4;
        pose.elbowsOut = 0.5 * e;
        pose.spread[0] = pose.spread[1] = k < 0.3 ? 1 : REST_SPREAD;
        pose.spreadRate = k < 0.3 ? 16 : 3;
        pose.jaw = k < 0.4 ? 0.7 : 0.15;
        pose.restep = 1;
        d.throat = 0;
        return;
      }
      beatDust(d, a);
      pose.vel.set(0, 0, 0);
      const f = d.fwd;
      if (a.phase === 'takeoff') {
        // the launch: heavy downbeats, climbing steeply to the pass height along its line
        d.yaw = a.yaw;
        const e = easeOutCubic(k);
        this.place(d, a, a.sEnd * k * k);
        fly(pose, FP.alt * e, 0.9, 2.3);
        pose.pitch = -0.22 * (1 - k) - 0.05;
        pose.lower = 0.5 * (1 - e);
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.2 * S);
        pose.head.y += 0.4 * S;
        pose.headRate = 6;
        d.rootPt(pose.look, 0, 0, 14);
        pose.jaw = 0.5;
        d.throat = 1;
        pose.tailWave = 0.05;
        a.lastYaw = d.yaw;
      } else if (a.phase === 'swoop') {
        // it tips over and drops onto the new line, wings half folded, turning as it falls
        const e = easeInOutSine(k);
        _c.set(a.p0.x + a.dx * a.sEnd, 0, a.p0.z + a.dz * a.sEnd);
        d.position.x = lerp(a.from.x, _c.x, e);
        d.position.z = lerp(a.from.z, _c.z, e);
        inReach(d, d.position);
        d.turnToward(a.yaw, 7, dt);
        this.bank(d, a, dt, 0.25);
        fly(pose, lerp(a.alt0, FP.alt, e) + 0.6 * Math.sin(Math.PI * k), 0.55, 2.0);
        pose.spread[0] = pose.spread[1] = lerp(1, 0.7, Math.sin(Math.PI * k));
        pose.glide = 0.6;
        pose.pitch = 0.05 + 0.2 * Math.sin(Math.PI * k);
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.4 * S);
        pose.head.y -= 0.4 * S;
        pose.headRate = 7;
        d.rootPt(pose.look, 0, 0, 14);
        pose.jaw = 0.4 + 0.4 * k;
        d.throat = 0.6 + 0.4 * k;
        d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd);
      } else if (a.phase === 'pass') {
        // gliding low and fast along the line, nose down, breathing fire onto the front
        d.yaw = a.yaw;
        a.roll *= Math.exp(-5 * dt);
        pose.roll = a.roll;
        a.lastYaw = d.yaw;
        const h = d.hazards.get(a.strip);
        const fr = h ? clamp((h.t - h.impact) * h.speed, 0, h.len) : 0;
        const running = h && fr < h.len - 1e-3;
        this.place(d, a, Math.max(a.sEnd, FP.start + fr - FP.frontLead));
        if (h && running) {
          const fx = h.ax + h.dx * fr, fz = h.az + h.dz * fr;
          if (a.breathing) d.fx.skyStream(dt, pt.mouth, fx, fz);
          pose.look.set(fx, 0, fz);
        } else {
          this.stopBreath(d, a);
          d.rootPt(pose.look, 0, 0, 16);
        }
        fly(pose, FP.alt + 0.35 * Math.sin(a.t * 3.4), 0.42, 1.6);
        pose.glide = 0.8;
        pose.pitch = 0.17;
        pose.headExact = true;
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.5 * S);
        pose.head.y -= 0.8 * S;
        pose.headRate = 8;
        pose.lookDown = 1.25;
        pose.lookRate = 14;
        pose.jaw = a.breathing ? 0.95 : 0.4;
        d.throat = a.breathing ? 1 : 0.3;
        pose.tailWave = 0.03;
      } else if (a.phase === 'rise' || a.phase === 'wheel') {
        // a banking turn (or the climb off the ground) round to the next hover, beating hard
        const kind = seg?.kind;
        this.hoverGoal(d, a, a.goal, kind);
        const e = easeInOutSine(k);
        bez2(_c, _e, a.from, a.ctrl, a.goal, e);
        d.position.x = _c.x;
        d.position.z = _c.z;
        inReach(d, d.position);
        const altGoal = kind === 'dive' ? FD.alt : FB.alt;
        const alt = a.phase === 'rise' ? altGoal * easeOutCubic(k) : lerp(a.alt0, altGoal, smoothstep(0, 1, k)) + 1.4 * Math.sin(Math.PI * k);
        fly(pose, Math.min(15.5, alt), 0.95, 2.2);
        // flying along the curve, turning to face the hero as it arrives
        const look = kind === 'dive' ? Math.atan2(a.target.x - d.position.x, a.target.z - d.position.z) : s.yawTo;
        const along = Math.hypot(_e.x, _e.z) > 0.5 ? Math.atan2(_e.x, _e.z) : look;
        const want = a.phase === 'wheel' && k < 0.7 ? along : look;
        d.turnToward(want, a.phase === 'wheel' ? 4.5 : 3.2, dt);
        this.bank(d, a, dt, 0.22);
        pose.hover = smoothstep(0.4, 1, k);
        pose.glide = 0.45 * (1 - k) + 0.2;
        pose.pitch = -0.15 - 0.2 * k;
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.1 * S);
        pose.head.y += 0.4 * S;
        pose.headRate = 6;
        pose.jaw = 0.4;
        d.throat = 0.5;
        if (fixOn()) {
          // (the motion audit) a banking turn: the head keeps up with the turn and looks along the flight
          // until it comes round (it trailed 3.9 m behind its goal, looking back down at the hero, and its
          // snout curled into its own chest)
          pose.headRate = 12;
          if (a.phase === 'wheel' && k < 0.7) d.rootPt(pose.look, 0, 0, 14);
        }
      } else if (a.phase === 'barrage') {
        // hanging beside him on steady strokes, head down, spitting shell after shell
        d.turnToward(s.yawTo, 2.6, dt);
        this.bank(d, a, dt, 0.15);
        this.hoverGoal(d, a, a.goal, 'barrage');
        const kk = 1 - Math.exp(-2 * dt);
        d.position.x += (a.goal.x - d.position.x) * kk;
        d.position.z += (a.goal.z - d.position.z) * kk;
        inReach(d, d.position);
        while (seg.aimed < a.n && a.t >= seg.aimed * a.every) this.aim(d, a, seg, seg.aimed++);
        while (seg.shot < a.n && seg.shot < seg.aimed && a.t >= seg.shot * a.every + FB.aim) this.launch(d, a, seg, seg.shot++);
        fly(pose, FB.alt + 0.4 * Math.sin(a.t * 3.3), 0.85, 2.0);
        pose.hover = 1;
        pose.pitch = -0.26;
        pose.headExact = true;
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.2 * S);
        pose.head.y -= 0.5 * S;
        pose.headRate = 7;
        pose.look.copy(s.chest);
        pose.lookDown = 1.2;
        pose.jaw = a.recoil > 0.3 ? 1 : 0.45;
        pose.jawRate = 25;
        d.throat = 0.8;
        if (a.recoil > 0) {
          pose.headOffset.x -= f.x * a.recoil * 0.8 * S;
          pose.headOffset.z -= f.z * a.recoil * 0.8 * S;
          pose.headOffset.y += a.recoil * 0.6 * S;
        }
        d.fx.mouthEmbers(dt, pt.mouth, 18, pt.headFwd);
      } else if (a.phase === 'hover') {
        // hanging high beside him on big strokes, glaring down at where it will land
        pose.look.copy(a.target);
        d.turnToward(Math.atan2(a.target.x - d.position.x, a.target.z - d.position.z), 3.2, dt);
        this.bank(d, a, dt, 0.15);
        this.hoverGoal(d, a, a.goal, 'dive');
        const kk = 1 - Math.exp(-3 * dt);
        d.position.x += (a.goal.x - d.position.x) * kk;
        d.position.z += (a.goal.z - d.position.z) * kk;
        inReach(d, d.position);
        fly(pose, FD.alt + 0.5 * Math.sin(a.t * 3.1), 0.95, 2.0);
        pose.hover = 1;
        pose.glide = 0.45;
        pose.pitch = -0.42;
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.3 * S);
        pose.head.y -= 0.3 * S;
        pose.lookDown = 1.2;
        pose.jaw = 0.5 + 0.3 * k;
        d.throat = 0.6 * k;
      } else if (a.phase === 'dive') {
        // wings swept back, nose down, accelerating onto the spot; the legs reach for it
        pose.look.copy(a.target);
        d.turnToward(Math.atan2(a.target.x - d.position.x, a.target.z - d.position.z), 3.2, dt);
        a.roll *= Math.exp(-8 * dt);
        pose.roll = a.roll;
        const kk = Math.min(1, k / 0.9);
        const e = easeInCubic(kk) * 0.65 + kk * 0.35;
        d.position.x = lerp(a.dv0.x, a.target.x, e);
        d.position.z = lerp(a.dv0.z, a.target.z, e);
        fly(pose, a.alt0 * (1 - e), 0, 2);
        pose.altRate = 60;
        pose.spread[0] = pose.spread[1] = 0.55;
        pose.spreadRate = 10;
        pose.dive = 1;
        pose.pitch = 0.75 * smoothstep(0, 0.35, k) - 0.35 * smoothstep(0.7, 1, k);
        pose.bodyRate = 10;
        pose.airReach = smoothstep(0.35, 0.9, k);
        pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 2.4 * S);
        pose.head.y -= 1.0 * S;
        pose.headRate = 10;
        pose.lookDown = 1.2;
        if (fixOn()) {
          // (the motion audit) it dives at its mark with the head carried clear of the ground and the snout
          // not tipped straight down at it (it went 0.45 m into the ground at the dive's end)
          pose.head.y = Math.max(pose.head.y, DIVE_HEAD_Y);
          pose.lookDown = 0.75;
        }
        pose.jaw = 1;
        d.throat = 0.8;
      }
    },
    end(d, a, interrupted) {
      this.stopBreath(d, a);
      if (interrupted) {
        // knocked out of the air (a plunge, a death): what it had not yet breathed or spat is gone;
        // the shells already in the air and the strip already burning finish what was cued
        for (const seg of a.segs ?? []) {
          if (seg.strip) {
            const h = d.hazards.get(seg.strip);
            if (h && h.t < h.impact) d.hazards.cancel(seg.strip);
            else d.hazards.cutStrip(seg.strip);
          }
          for (let i = seg.shot; i < seg.rings.length; i++) d.hazards.cancel(seg.rings[i]);
        }
      }
      d.throat = 0;
      d.pose.roll = 0;
      flightEnd(d, a, interrupted);
    },
  };
}
const skyHunt = makeFlightCombo('skyHunt');
const skyFurnace = makeFlightCombo('skyFurnace');
const skyCataclysm = makeFlightCombo('skyCataclysm');

// ------------------------------------------------------------------ armageddon (key meteorRain)
// ADR-053; the performance and the sky reworked in the second pass, in three looks the owner picked
// from (?apoc=a|b|c, skyFx.APOC_LOOK; MR.looks; the owner kept a, 2026-11-16):
//   a  the salvo: a beat of menace (low, still, glaring), then the weight goes back onto the haunches,
//      the wings unfurl, the neck arcs back and up, the chest and throat fill with fire; it tears a
//      dozen columns of fire up into the sky, each one kicking through the whole body; the burning
//      deck flares up over the clearing; it drops onto its forefeet with a slam and fights on
//   b  the pillar: the same rear-up, then one sustained column roared straight up for the whole cast
//      (pulsing `missiles` times), the burning ceiling spreading out from the top of it
//   c  the flight: it takes off, hangs over the clearing and tears the salvo up from the air in a
//      wider fan, the deck right over it, then drops back down with its weight
// The barrage emitter (hazards.barrage) is armed at the cast and the meteors come down in waves
// while the wyrm fights on. Windup + cast is the punish window (a: on the ground; c: in the air, out
// of reach). No beat of its own: the salvo deals nothing, every meteor heats its ground and
// announces itself; the transition roar's clear ends the barrage. dragon:hazard 'launch' per bolt
// (b: per pulse).
const MR = T.meteorRain;
const APOC = MR.looks?.[APOC_LOOK] ?? MR.looks?.a ?? {};
const AIR_APOC = APOC_LOOK === 'c';

function fireBolt(d, a) {
  const m = d.rig.pt.mouth;
  const cone = APOC.cone ?? MR.missileCone;
  const ang = Math.random() * Math.PI * 2, tilt = Math.random() * cone, sp = MR.missileSpeed;
  // (leaning a little toward the camera (+z): the game camera looks north and down, so a column
  // climbing straight up leaves the top of the frame at once; this one stays in view longer)
  skyBolt(d.fx, m.x, m.y, m.z, Math.sin(tilt) * Math.cos(ang) * sp, Math.cos(tilt) * sp, Math.sin(tilt) * Math.sin(ang) * sp + MR.missileLean * sp, AIR_APOC ? 0.9 : 1);
  a.fired++;
  a.kick = 1;
  d.game.shake?.(0.07);
  d.emit('dragon:hazard', { kind: 'meteor', stage: 'launch', x: m.x, z: m.z, radius: 0 });
}

const meteorRain = {
  name: 'meteorRain',
  cooldown: MR.cooldown,
  phases: (d) => {
    if (AIR_APOC) {
      return [['windup', wind(d, APOC.windup ?? 0.9)], ['rise', APOC.rise ?? 0.9], ['cast', MR.cast], ['descend', APOC.descend ?? 0.75], ['recovery', wind(d, APOC.recovery ?? 0.55)]];
    }
    return [['windup', wind(d, MR.windup)], ['cast', MR.cast], ['recovery', wind(d, MR.recovery)]];
  },
  // not while a barrage or its meteors are still coming down
  weight: (d, s) => (d.hazards?.count('barrage') || d.hazards?.count('meteor') ? 0 : wPhase(MR, d)),
  start(d, a) {
    a.n = Math.max(1, perPh(MR.missiles, d) | 0);
    a.every = Math.min(MR.missileEvery, (MR.cast - 0.15) / a.n); // (all of them inside the salvo)
    if (APOC_LOOK === 'b') a.every = (MR.cast - 0.1) / a.n; // (the pillar's pulses spread over the roar)
    a.fired = 0;
    a.kick = 0;
    a.slammed = false;
    a.landed = false;
    a.p0 = V().copy(d.position);
    a.flapCos = 1;
  },
  enter(d, a, phase) {
    if (phase === 'rise') {
      takeOff(d);
      return;
    }
    if (phase === 'descend') {
      a.alt0 = Math.max(0.5, d.rig.s.alt);
      return;
    }
    if (phase !== 'cast') return;
    roarFx(d, 0.6);
    d.emit('dragon:spell', { name: 'meteorRain', x: d.position.x, z: d.position.z });
    d.hazards.barrage({
      attack: 'meteorRain', waves: perPh(MR.waves, d), perWave: perPh(MR.perWave, d), waveGap: MR.waveGap, stagger: MR.stagger,
      first: MR.cast + MR.hush + MR.warn, glowAt: MR.cast, warn: MR.warn, warnLed: MR.warnLed, ledEvery: MR.ledEvery,
      ledGap: MR.ledGap, lead: MR.lead, r: MR.radius, fall: MR.fall, fallY: MR.fallHeight, size: MR.size,
      damage: MR.damage, burn: MR.burn, knockback: MR.knockback, group: d.hazards.group(MR.maxHits),
      crater: perPh(MR.craterBurn, d), tickDamage: MR.tickDamage, tickBurn: MR.tickBurn,
      safeR: MR.safeR, cover: MR.safeCover, finale: MR.finale,
      deckAt: APOC.deckAt ?? MR.cast, deckGrow: APOC.deckGrow ?? 0.8, cx: d.position.x, cz: d.position.z,
    });
  },
  /** The rear-up on the ground (looks a, b): menace, the weight back, the wings, the neck, the fire. */
  rearUp(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k;
    const men = APOC.menace ?? 0.22;
    const up = smoothstep(men, 0.88, k);
    d.turnToward(d.sense.yawTo, d.turnRate * (k < men ? 0.8 : 0.3), dt);
    // the beat of menace: low and still on its forelegs, head down and out, glaring at him
    // then the weight shifts back onto the haunches and it rears, the neck arcing back and up
    pose.rear = 0.97 * up;
    pose.pitch = 0.1 * (1 - up) - 0.22 * up;
    pose.lower = 0.32 * (1 - up) - 0.18 * up;
    pose.bodyRate = 3 + 2 * up;
    pose.stanceH = 0.25;
    pose.restep = 1;
    const H = headUp();
    if (H) {
      // (ADR-258) the neck rises up and FORWARD over the forelegs, the head ahead of the neck's base,
      // the roar aimed at the sky in front of it (~70° up): the head never tips back past upright
      pose.head = d.rootPt(pose.headTarget, 0, 3.0 + (H.y - 3.0) * up, 4.6 - (4.6 - H.z) * up);
    } else {
      const arc = Math.sin(Math.PI * up); // the neck swings back past upright as it rises
      pose.head = d.rootPt(pose.headTarget, 0, 3.0 + 4.9 * up + 0.6 * arc, 4.6 - 3.7 * up - 0.9 * arc);
    }
    pose.headRate = k < men ? 7 : 3.5;
    if (k < men) pose.look.copy(d.sense.chest);
    else if (H) d.rootPt(pose.look, 0, H.lookY, 5 + (H.lookZ - 5) * up);
    else d.rootPt(pose.look, 0, 40, 5 - 4 * up);
    pose.lookRate = 5;
    // the wings unfurl from the mantle to their full span and tremble
    const wing = smoothstep(men + 0.05, 0.75, k);
    pose.spread[0] = pose.spread[1] = REST_SPREAD + (1 - REST_SPREAD) * wing;
    pose.spreadRate = 3.5;
    pose.flap = 0.13 * wing;
    pose.flapHz = 5;
    pose.swell = k;
    pose.jaw = k < men ? 0.25 : 0.3 + 0.55 * up;
    pose.jawRate = 12;
    d.throat = k;
    d.bodyWarn = smoothstep(0, men + 0.15, k); // the red tell on the body (TELL_STYLE.red.warn)
    skyThroat(d.fx, dt, pt.chest, pt.mouth, k);
    d.fx.mouthEmbers(dt, pt.mouth, 10 + 50 * up, pt.headFwd, 7 * up);
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k;
    a.kick = Math.max(0, a.kick - dt * 8);
    // the camera makes room above the jaws for the fire going up (cameraRig keep-in-view)
    if ((a.phase === 'windup' && k > 0.5) || a.phase === 'cast' || (a.phase === 'recovery' && k < 0.5) || a.phase === 'rise') {
      const m = pt.mouth;
      d.game.cameraRig?.keep?.(m.x, m.y + MR.skyRoom, m.z, 2);
    }
    if (AIR_APOC) return this.updateAir(d, a, dt);
    if (a.phase === 'windup') {
      this.rearUp(d, a, dt);
    } else if (a.phase === 'cast') {
      // reared up, the wings full, the throat white-hot; each bolt kicks through the whole body:
      // the head snaps down, the chest drops, the haunches give, the wings flick
      const kk = APOC_LOOK === 'b' ? 0.45 * a.kick : a.kick;
      pose.rear = 0.97 - 0.14 * kk;
      pose.pitch = -0.22 + 0.08 * kk;
      pose.lower = -0.18 + 0.16 * kk;
      pose.bodyRate = 16;
      pose.stanceH = 0.25;
      pose.restep = 1;
      const H = headUp();
      if (H) {
        pose.head = d.rootPt(pose.headTarget, 0, H.y - 0.6 * kk, H.z + 0.5 * kk);
        d.rootPt(pose.look, 0, H.lookY, H.lookZ);
      } else {
        pose.head = d.rootPt(pose.headTarget, 0, 7.9 - 0.6 * kk, 0.9 + 0.5 * kk);
        d.rootPt(pose.look, 0, 40, 1);
      }
      pose.headRate = 9;
      pose.lookRate = 8;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 14;
      pose.flap = 0.1 + 0.25 * kk;
      pose.flapHz = 5;
      pose.swell = 1;
      pose.jaw = APOC_LOOK === 'b' ? 1 : a.kick > 0.3 ? 1 : 0.8;
      pose.jawRate = 22;
      pose.headOffset.y -= kk * 0.5 * S;
      if (APOC_LOOK === 'b') {
        // the roar: the whole body shudders with it
        const j = (Math.sin(d.time * 41) * 0.07 + Math.sin(d.time * 23) * 0.05) * S;
        pose.headOffset.x += j;
        d.game.shake?.(0.35 * dt);
      }
      d.throat = 1;
      d.bodyWarn = 1;
      skyThroat(d.fx, dt, pt.chest, pt.mouth, 1);
      d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd, 7);
    } else {
      // it drops back onto its forefeet with all its weight, then fights on (the barrage is a
      // background hazard)
      const dr = APOC.drop ?? 0.38;
      const u = clamp(k / dr, 0, 1);
      pose.rear = 0.97 * (1 - u * u);
      pose.restep = 1;
      if (u >= 1 && !a.slammed) {
        a.slammed = true;
        const g = d.game;
        g.shake?.(0.5);
        for (const arm of pt.arms) {
          d.fx.dustRing(arm.toe.x, arm.toe.z, 0.9 * S, 18, 0.9);
          d.emit('dragon:step', { x: arm.toe.x, z: arm.toe.z, heavy: true });
        }
        g.world?.gust?.(d.position.x, d.position.z, 1.4, 14 * S);
      }
      const v = a.slammed ? clamp((k - dr) / (1 - dr), 0, 1) : 0;
      pose.lower = a.slammed ? 0.45 * (1 - smoothstep(0, 1, v)) : -0.1;
      pose.pitch = a.slammed ? 0.18 * (1 - v) : -0.1 * (1 - u);
      pose.bodyRate = a.slammed && v < 0.2 ? 18 : 6;
      pose.elbowsOut = a.slammed ? 0.4 * (1 - v) : 0;
      pose.spread[0] = pose.spread[1] = v < 0.35 ? 1 : REST_SPREAD;
      pose.spreadRate = 3;
      pose.jaw = 0.3;
      d.throat = Math.max(0, 1 - 2 * k);
    }
  },
  /** Look c: the flight. Crouch, rise, hang over the clearing tearing the salvo up, come down heavy. */
  updateAir(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k, f = d.fwd;
    const ALT = Math.min(15, APOC.alt ?? 10);
    if (a.phase === 'windup') {
      d.turnToward(d.sense.yawTo, d.turnRate, dt);
      pose.lower = 0.7 * smoothstep(0, 0.7, k);
      pose.bodyRate = 6;
      pose.strideH = 0.55;
      pose.strideF = -0.45;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = REST_SPREAD + (1 - REST_SPREAD) * smoothstep(0.2, 0.8, k);
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 3.4 + 1.5 * k, 4.0 - 1.0 * k);
      pose.jaw = 0.4;
      d.throat = k;
      d.bodyWarn = k;
      skyThroat(d.fx, dt, pt.chest, pt.mouth, k);
      return;
    }
    if (a.phase === 'recovery') {
      const e = 1 - smoothstep(0, 1, k);
      pose.lower = 0.8 * e;
      pose.pitch = 0.25 * e;
      pose.bodyRate = k < 0.2 ? 16 : 4;
      pose.elbowsOut = 0.5 * e;
      pose.spread[0] = pose.spread[1] = k < 0.4 ? 1 : REST_SPREAD;
      pose.spreadRate = k < 0.4 ? 14 : 3;
      pose.restep = 1;
      pose.jaw = 0.3;
      d.throat = 0;
      return;
    }
    beatDust(d, a);
    pose.vel.set(0, 0, 0);
    d.turnToward(d.sense.yawTo, 1.5, dt);
    if (a.phase === 'rise') {
      // heavy downbeats straight up, drifting a little toward the middle of the clearing
      const e = easeOutCubic(k);
      d.position.x = lerp(a.p0.x, a.p0.x * 0.75, e);
      d.position.z = lerp(a.p0.z, a.p0.z * 0.75, e);
      fly(pose, ALT * e, 1, 2.3);
      pose.hover = smoothstep(0.2, 1, k);
      pose.pitch = -0.25 - 0.2 * k;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, 1.8 * S);
      pose.head.y += 1.0 * S;
      pose.jaw = 0.5;
      d.throat = 1;
      d.bodyWarn = 1;
      skyThroat(d.fx, dt, pt.chest, pt.mouth, 1);
    } else if (a.phase === 'cast') {
      // hanging on huge strokes, chest thrown out, the head back to the sky; every bolt kicks it down
      fly(pose, ALT + 0.5 * Math.sin(a.t * 3) - 0.6 * a.kick, 0.95, 2.1);
      pose.hover = 1;
      pose.pitch = -0.55 + 0.12 * a.kick;
      pose.bodyRate = 12;
      pose.head = pose.headTarget.copy(pt.neckBase).addScaledVector(f, (0.8 + 0.6 * a.kick) * S);
      pose.head.y += (2.4 - 0.7 * a.kick) * S;
      pose.headRate = 9;
      d.rootPt(pose.look, 0, 40, 2);
      pose.jaw = a.kick > 0.3 ? 1 : 0.8;
      pose.jawRate = 22;
      d.throat = 1;
      d.bodyWarn = 1;
      skyThroat(d.fx, dt, pt.chest, pt.mouth, 1);
      d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd, 7);
    } else if (a.phase === 'descend') {
      // it folds and drops, beating late to brake, the legs reaching for the ground
      const u = smoothstep(0, 1, k);
      fly(pose, a.alt0 * (1 - u * u * 0.4 - u * 0.6), 0.75, 2.6);
      pose.altRate = 30;
      pose.hover = 1 - k;
      pose.airReach = smoothstep(0.2, 0.8, k);
      pose.pitch = -0.2 * (1 - k);
      d.throat = 0.5 * (1 - k);
      if (k > 0.97 && !a.landed) {
        a.landed = true;
        touchDown(d, true);
      }
    }
  },
  // (after the rig: the bolts leave the jaws where they are drawn)
  hit(d, a, dt) {
    if (a.phase !== 'cast') return;
    if (APOC_LOOK === 'b') skyPillar(d.fx, dt, d.rig.pt.mouth, 1);
    while (a.fired < a.n && a.t >= a.fired * a.every) {
      if (APOC_LOOK === 'b') {
        // a pulse of the roar (counted as a bolt: dragon:hazard launch)
        const m = d.rig.pt.mouth;
        a.fired++;
        a.kick = 1;
        d.game.shake?.(0.05);
        d.emit('dragon:hazard', { kind: 'meteor', stage: 'launch', x: m.x, z: m.z, radius: 0 });
      } else fireBolt(d, a);
    }
  },
  end(d, a, interrupted) {
    d.throat = 0;
    d.bodyWarn = 0;
    if (AIR_APOC) {
      if (!interrupted && !a.landed) touchDown(d, true);
      flightEnd(d, a, interrupted);
    }
  },
};

// ------------------------------------------------------------------ fire eruptions
const ER = T.eruptions;
const ERL = ER.line;
const STOMP_Z = 2.9, STOMP_X = 1.2; // the forefeet slam spots (root frame, model units; as the stomp)
const eruptions = {
  name: 'eruptions',
  cooldown: ER.cooldown,
  phases: (d) => {
    const chase = (d.phase | 0) >= 3 && Math.random() < ER.chase.chance;
    // (the chase holds the forefeet down while its crack runs out to the hero, then chases him)
    return [['windup', wind(d, ER.windup)], ['slam', ER.slam], ['channel', chase ? ER.chase.time + crackRun(d) : 0.01], ['recovery', wind(d, ER.recovery)]];
  },
  // one red beat: the pillar that erupts under the hero (the chase: its first pillar, where the crack catches him)
  beats: (d, a) => [beat('eruptions', 0, a.list[0][1] + ER.slam + (a.chase ? ER.chase.warn + crackRun(d) : lineEta(d)), ER, 'forefeet')],
  weight: (d, s) => (s.dist >= ER.minDist && s.dist <= ER.maxDist && s.absAng <= 1.3 ? wPhase(ER, d) : 0),
  start(d, a) {
    a.chase = a.list[2][1] > 0.1;
    a.flared = false;
    a.line = null;
  },
  enter(d, a, phase) {
    if (phase === 'slam') {
      const A2 = d.rig.pt.arms;
      a.paw0 = [V().copy(A2[0].toe), V().copy(A2[1].toe)];
      a.pitch0 = d.rig.s.pitch;
      a.rear0 = d.rig.s.rear;
      return;
    }
    if (phase !== 'channel') return;
    // the forefeet hit the ground: the eruptions start
    const g = d.game;
    const c = d.rootPt(_a, 0, 0, STOMP_Z);
    g.shake?.(0.4);
    g.world?.gust?.(c.x, c.z, 1.3, 12 * S);
    d.fx.dustRing(c.x, c.z, 1.4 * S, 36, 1.0);
    for (let k = 0; k < 2; k++) {
      const f = d.rootPt(_b, (k === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
      d.fx.dustRing(f.x, f.z, 0.5 * S, 14, 0.8);
      d.emit('dragon:step', { x: f.x, z: f.z, heavy: true });
    }
    d.emit('dragon:spell', { name: 'eruptions', x: c.x, z: c.z });
    // (2nd pass) from phase 2 every pillar leaves a burning pool (ER.pool s; blockable ticks, none while rolling)
    const common = { attack: 'eruptions', r: ER.radius, active: ER.active, damage: ER.damage, burn: ER.burn, knockback: ER.knockback, pool: perPh(ER.pool, d), poolR: ER.radius * ER.poolR, tickDamage: ER.poolTick, tickBurn: ER.poolBurn };
    const b = a.beats[0];
    // (ADR-197) the fire runs out of the slam: a glowing crack from between the forefeet (fireTrails.js)
    const crack = CRACK_ON ? { crack: true, cx: c.x, cz: c.z } : null;
    if (a.chase) {
      a.line = d.hazards.chase({ ...common, ...crack, every: ER.chase.every, until: ER.chase.time, warn: ER.chase.warn, lead: ER.chase.lead, group: d.hazards.group(ER.chase.maxHits), linkFirst: true });
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + ER.chase.warn + 1 / 60);
      if (crack) retime(d, a, b, a.line);
      return;
    }
    // the line: from the slam toward the (led) hero, one pillar every `step` m past him
    const s = d.sense;
    const tx = s.pos.x + s.vel.x * 0.25, tz = s.pos.z + s.vel.z * 0.25;
    let dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) {
      dx = d.fwd.x;
      dz = d.fwd.z;
    } else {
      dx /= dist;
      dz /= dist;
    }
    const ax = c.x + dx * ERL.start, az = c.z + dz * ERL.start;
    let n = clamp(Math.ceil((dist + ERL.beyond - ERL.start) / ERL.step) + 1, 3, ERL.max);
    while (n > 3 && Math.hypot(ax + dx * (n - 1) * ERL.step, az + dz * (n - 1) * ERL.step) > 28) n--;
    a.line = d.hazards.line({ ...common, ...crack, kind: 'line', announce: false, ax, az, dx, dz, n, step: ERL.step, delay: ERL.first, stagger: ERL.delay });
    retime(d, a, b, a.line);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k;
    const b = a.cur;
    if (a.phase === 'windup') {
      // rears up on the hind legs, forefeet raised, throat and chest glowing: the slam is coming
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.list[0][1] + ER.slam + (a.chase ? ER.chase.warn + crackRun(d) : lineEta(d)) - b.at);
      d.turnToward(s.yawTo, d.turnRate * 0.8, dt);
      const coil = smoothstep(0.55, 1, k);
      pose.pitch = -0.5 - 0.1 * coil;
      pose.rear = 1;
      pose.bodyRate = 3.5 + 2.5 * coil;
      pose.lower = -0.15 - 0.08 * coil;
      pose.spread[0] = pose.spread[1] = 0.7 + 0.2 * coil;
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 5.8 + 0.3 * coil, 3.3);
      pose.headRate = 4;
      pose.jaw = 0.45 + 0.3 * coil;
      pose.stanceH = 0.25;
      pose.restep = 1;
      pose.swell = k;
      pose.tailLift = 0;
      d.throat = k;
      return;
    }
    if (a.phase === 'slam') {
      // both forefeet slam down onto their spots, accelerating
      const e = k * k;
      pose.pitch = lerp(a.pitch0 ?? -0.5, 0.18, e);
      pose.rear = (a.rear0 ?? 1) * (1 - e);
      pose.lower = lerp(-0.15, 0.2, e);
      pose.bodyRate = 60;
      for (let i = 0; i < 2; i++) {
        const ov = pose.pawOv[i];
        ov.w = 1;
        const spot = d.rootPt(_b, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
        if (a.paw0) ov.pos.lerpVectors(a.paw0[i], spot, e);
        else ov.pos.copy(spot);
      }
      pose.pawOvRate = 90;
      pose.jaw = 0.85;
      pose.tailLift = 0;
      d.throat = 1;
      return;
    }
    // channel (the chase) and recovery: the forefeet pressed into the ground, the head low over the
    // line, the throat and chest glowing while the pillars burst; then it settles
    if (!a.chase || CRACK_ON) retime(d, a, b, a.line);
    const h = d.hazards.get(a.line);
    if (h && b) {
      if (h.shape === 4) {
        const sp = (s.pos.x - h.ax) * h.dx + (s.pos.z - h.az) * h.dz;
        const kk = clamp(Math.round(sp / h.step), 0, h.n - 1);
        flareOnFlash(d, a, b, h.ax + h.dx * kk * h.step, h.az + h.dz * kk * h.step, h.r);
      } else flareOnFlash(d, a, b, s.pos.x, s.pos.z, ER.radius);
    }
    const hold = a.phase === 'channel' || k < 0.45;
    if (hold) {
      for (let i = 0; i < 2; i++) {
        const ov = pose.pawOv[i];
        d.rootPt(ov.pos, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
        ov.w = 1;
      }
      pose.pawOvRate = 40;
      a.planted = false;
    } else if (!a.planted) {
      a.planted = true;
      for (let i = 0; i < 2; i++) {
        d.rootPt(pose.pawOv[i].pos, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
        pose.pawOv[i].w = 1;
        pose.pawPlant[i] = true;
      }
    }
    pose.pitch = hold ? 0.2 : 0.2 * (1 - k);
    pose.lower = hold ? 0.3 : 0.3 * (1 - k);
    pose.bodyRate = 5;
    pose.head = d.rootPt(pose.headTarget, 0, 2.6, 5.2);
    pose.headRate = 5;
    if (h && h.shape === 4) pose.look.set(h.ax + h.dx * h.step * h.n, 0, h.az + h.dz * h.step * h.n);
    else if (h && h.crack) pose.look.set(h.hx, 0, h.hz); // (it watches its crack run)
    else pose.look.copy(s.pos);
    pose.lookDown = 0.9;
    pose.jaw = hold ? 0.8 : 0.2;
    pose.tailLift = hold ? 0 : 1;
    pose.restep = hold ? 0 : 1;
    pose.spread[0] = pose.spread[1] = hold ? 0.7 : REST_SPREAD;
    d.throat = hold ? 1 : 0;
    if (hold) d.fx.mouthEmbers(dt, pt.mouth, 24, pt.headFwd);
  },
  end(d) {
    d.throat = 0;
  },
};
/** The chase's crack: s from the slam until it reaches the hero, from his distance now (0 without the crack). */
function crackRun(d) {
  if (!CRACK_ON) return 0;
  const C = TRAILS.crack;
  return Math.min(C.maxRun, Math.max(0, (d.sense?.dist ?? 0) - STOMP_Z * S - C.arrive) / C.speed);
}

/** Before the slam: when the line's pillar under the hero would erupt (s after the slam), from his distance now. */
function lineEta(d) {
  const s = d.sense;
  const along = s.dist - STOMP_Z * S - ERL.start; // (the slam spot is ~STOMP_Z ahead of the root)
  const k = clamp(Math.round(along / ERL.step), 0, ERL.max - 1);
  return ERL.first + k * ERL.delay;
}

// ------------------------------------------------------------------ flame ring
const FR = T.flameRing;
const ringTravel = () => (FR.r1 - FR.r0) / FR.speed;
const ringCount = (d) => Math.max(1, perPh(FR.rings ?? 1, d) | 0);
const flameRing = {
  name: 'flameRing',
  cooldown: FR.cooldown,
  // the recovery lasts until the last ring has run out (its flash may come late for a far hero).
  // (2nd pass) rings: 1 / 2 / 3 per phase, one behind the other `ringGap` s apart, a red beat each
  phases: (d) => [['windup', wind(d, FR.windup)], ['cast', FR.cast], ['recovery', Math.max(wind(d, FR.recovery), ringTravel() + (ringCount(d) - 1) * FR.ringGap + 0.15)]],
  beats: (d, a) => {
    const out = [];
    const t0 = a.list[0][1] + FR.cast;
    for (let i = 0; i < a.rings.length; i++) {
      // the next ring's tell as the one before it bursts out
      const at = i === 0 ? 0 : t0 + (i - 1) * FR.ringGap;
      const b = beat('flameRing', at, t0 + i * FR.ringGap + 0.5 - at, FR, 'chest', { ring: i });
      retime(d, a, b, a.rings[i]);
      out.push(b);
    }
    return out;
  },
  weight: (d, s) => (s.dist <= FR.maxDist ? wPhase(FR, d) : 0),
  start(d, a) {
    // round the middle of the body (it doesn't turn while it casts)
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.flared = false;
    a.rings = [];
    const n = ringCount(d);
    for (let i = 0; i < n; i++) {
      a.rings.push(d.hazards.ring({
        kind: 'ring', attack: 'flameRing', announce: false, x: a.cx, z: a.cz, r0: FR.r0, r1: FR.r1, speed: FR.speed, w: FR.width,
        delay: a.list[0][1] + FR.cast + i * FR.ringGap, damage: FR.damage, burn: FR.burn, knockback: FR.knockback,
      }));
    }
    a.ring = a.rings[0];
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'flameRing', x: a.cx, z: a.cz });
      roarFx(d, 0.6);
      d.game.world?.gust?.(a.cx, a.cz, 2, 20 * S);
      for (const arm of d.rig.pt.arms) d.emit('dragon:step', { x: arm.toe.x, z: arm.toe.z, heavy: true });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k;
    for (let i = 0; i < a.beats.length; i++) {
      const b = a.beats[i];
      retime(d, a, b, a.rings[b.ring ?? 0]);
      if (b.flashed && !b.flaredFx) {
        b.flaredFx = true;
        d.fx.hazardFlash(s.pos.x, s.pos.z, 2.4);
      }
    }
    if (a.phase === 'windup') {
      // crouched over its own fire, wings raised and trembling, the chest swelling white-orange;
      // flames swirl in round it
      pose.lower = 0.25 + 0.2 * k;
      pose.pitch = 0.06;
      pose.stanceF = 0.25;
      pose.stanceH = 0.2;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 3;
      pose.flap = 0.12;
      pose.flapHz = 5;
      pose.swell = k;
      pose.head = d.rootPt(pose.headTarget, 0, 4.0, 3.2);
      pose.headRate = 4;
      pose.jaw = 0.3 + 0.4 * k;
      d.throat = k;
      d.fx.gatherFire(dt, a.cx, a.cz, FR.r0 + 1.5, k);
    } else if (a.phase === 'cast') {
      // the wings beat down hard and the head throws back: the ring bursts out from under it
      roarPose(d, a, 0.55);
      pose.spreadRate = 20;
      pose.rear = 0.3 * (1 - k);
      pose.lower = 0.35;
      pose.bodyRate = 14;
      d.throat = 1;
    } else {
      pose.lower = 0.35 * (1 - k);
      pose.spread[0] = pose.spread[1] = k < 0.3 ? 0.55 : REST_SPREAD;
      pose.spreadRate = 3;
      pose.jaw = 0.3;
      pose.restep = 1;
      d.throat = Math.max(0, 1 - k * 3);
    }
  },
  end(d) {
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ flame wall
const FW = T.flameWall;
const wallCount = (d) => Math.max(1, perPh(FW.walls ?? 1, d) | 0);
const flameWall = {
  name: 'flameWall',
  cooldown: FW.cooldown,
  // (2nd pass) walls: 1 / 1 / 2 per phase: in phase 3 a second wall `wallGap` s later comes in from
  // the hero's side, square to the first (a red beat each; roll through each one)
  phases: (d) => [['windup', wind(d, FW.windup)], ['cast', FW.cast], ['recovery', Math.max(wind(d, FW.recovery), FW.sweep / FW.speed + (wallCount(d) - 1) * FW.wallGap + 0.15)]],
  beats: (d, a) => {
    const out = [];
    const t0 = a.list[0][1] + FW.cast;
    for (let i = 0; i < a.walls.length; i++) {
      const at = i === 0 ? 0 : t0 + (i - 1) * FW.wallGap;
      const b = beat('flameWall', at, t0 + i * FW.wallGap + 0.6 - at, FW, 'mouth', { wall: i });
      retime(d, a, b, a.walls[i]);
      out.push(b);
    }
    return out;
  },
  weight: (d, s) => wPhase(FW, d),
  start(d, a) {
    // across the wyrm's front, square to the hero, sweeping toward (and past) him
    const s = d.sense;
    let dx = s.pos.x - d.position.x, dz = s.pos.z - d.position.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
      dx = d.fwd.x;
      dz = d.fwd.z;
    } else {
      dx /= l;
      dz /= l;
    }
    a.dx = dx;
    a.dz = dz;
    a.yaw = Math.atan2(dx, dz);
    a.flared = false;
    a.aim2 = null;
    const off = FW.start + 2.5 * S;
    const common = { kind: 'wall', attack: 'flameWall', announce: false, len: FW.length, w: FW.width, speed: FW.speed, dist: FW.sweep, damage: FW.damage, burn: FW.burn, knockback: FW.knockback };
    a.walls = [d.hazards.wall({ ...common, x: d.position.x + dx * off, z: d.position.z + dz * off, dx, dz, delay: a.list[0][1] + FW.cast })];
    if (wallCount(d) > 1) {
      // the second: from beside the hero, square to the first, sweeping across him
      let qx = -dz, qz = dx;
      if (qx * s.pos.x + qz * s.pos.z > 0) {
        qx = -qx;
        qz = -qz;
      }
      // it starts on the middle's side of him and sweeps through him and on out
      const cx = s.pos.x + qx * 12, cz = s.pos.z + qz * 12, t0 = a.list[0][1] + FW.cast;
      a.walls.push(d.hazards.wall({ ...common, x: cx, z: cz, dx: -qx, dz: -qz, delay: t0 + FW.wallGap, lay: wallLay(d, a, cx, cz, -qx, -qz, off, t0) }));
    }
    a.wall = a.walls[0];
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'flameWall', x: d.position.x, z: d.position.z });
      d.emit('dragon:breathStart');
      d.fx.breathBegin();
      a.breath = true;
    } else if (phase === 'recovery' && !(a.aim2 != null)) this.stopBreath(d, a);
  },
  stopBreath(d, a) {
    if (!a.breath) return;
    a.breath = false;
    d.fx.breathEnd();
    d.emit('dragon:breathEnd');
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k;
    for (let i = 0; i < a.beats.length; i++) {
      const b = a.beats[i];
      retime(d, a, b, a.walls[b.wall ?? 0]);
      if (b.flashed && !b.flaredFx) {
        b.flaredFx = true;
        d.fx.hazardFlash(s.pos.x, s.pos.z, 2.4);
      }
    }
    if (a.phase === 'windup') {
      // rears back, wings raised high and forward, the throat charging: a breath is coming
      d.turnToward(a.yaw, d.turnRate, dt);
      pose.pitch = -0.18 * k;
      pose.lower = -0.1;
      pose.spread[0] = pose.spread[1] = 1;
      pose.mantle = 1;
      pose.spreadRate = 3;
      pose.swell = k;
      pose.head = d.rootPt(pose.headTarget, 0, 5.9, 2.4);
      pose.headRate = 4;
      pose.jaw = 0.3;
      d.rootPt(pose.look, 0, 4, 10);
      d.throat = k;
      d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd);
    } else if (a.phase === 'cast') {
      // it sweeps a sheet of fire across the ground in front: the wall springs up from it
      const sweep = (k - 0.5) * 1.2;
      const aim = a.yaw + sweep;
      pose.headExact = true;
      pose.head = pose.headTarget.set(pt.neckBase.x + Math.sin(aim) * 2.6 * S, pt.neckBase.y - 0.4 * S, pt.neckBase.z + Math.cos(aim) * 2.6 * S);
      pose.headRate = 9;
      pose.look.set(pt.mouth.x + Math.sin(aim) * 8 * S, 0, pt.mouth.z + Math.cos(aim) * 8 * S);
      pose.lookDown = 1.0;
      pose.lookRate = 14;
      pose.jaw = 0.95;
      pose.pitch = 0.2;
      pose.lower = 0.15;
      pose.bodyRate = 8;
      pose.spread[0] = pose.spread[1] = 1;
      pose.mantle = 1;
      d.throat = 1;
      d.fx.breathEmit(dt, pt.mouth, aim, 0.3);
    } else if (a.aim2 != null && a.breath && a.t < TRAILS.wall.breath) {
      // (?wallSource=b) the head swings round to the second wall's line and breathes it: the fire
      // strikes the ground and runs on to the line (the runner, hazards._lay)
      const u = clamp(a.t / 0.2, 0, 1);
      const aim = a.yaw + 0.6 + angleDiff(a.yaw + 0.6, a.aim2) * u;
      pose.headExact = true;
      pose.head = pose.headTarget.set(pt.neckBase.x + Math.sin(aim) * 2.6 * S, pt.neckBase.y - 0.4 * S, pt.neckBase.z + Math.cos(aim) * 2.6 * S);
      pose.headRate = 9;
      pose.look.set(pt.mouth.x + Math.sin(aim) * 8 * S, 0, pt.mouth.z + Math.cos(aim) * 8 * S);
      pose.lookDown = 1.0;
      pose.lookRate = 14;
      pose.jaw = 0.95;
      pose.pitch = 0.2;
      pose.lower = 0.15;
      pose.spread[0] = pose.spread[1] = 1;
      pose.mantle = 1;
      d.throat = 1;
      d.fx.breathEmit(dt, pt.mouth, aim, 0.3);
    } else {
      if (a.breath && a.phase === 'recovery') this.stopBreath(d, a);
      pose.pitch = 0.2 * (1 - k);
      pose.lower = 0.15 * (1 - k);
      pose.spread[0] = pose.spread[1] = k < 0.3 ? 1 : REST_SPREAD;
      pose.spreadRate = 2.5;
      pose.jaw = 0.25;
      d.throat = 0;
    }
  },
  end(d, a) {
    this.stopBreath(d, a);
    d.throat = 0;
  },
};

/**
 * (ADR-197) The second wall's line is laid from the wyrm's fire, not lit out of nothing
 * (?wallSource, fireTrails.js): a (default) a fire front runs out along it both ways from where the
 * first wall crosses it, as the first wall springs up; b the head swings round and breathes toward
 * that point and a runner carries the fire over the ground to it. The line (cx, cz) sweeping along
 * (wdx, wdz); the first wall lit `off` m out along (a.dx, a.dz), `t0` s from now. Null: off.
 */
function wallLay(d, a, cx, cz, wdx, wdz, off, t0) {
  if (WALL_SOURCE === 'off') return null;
  const TW = TRAILS.wall;
  const qx = -a.dz, qz = a.dx; // along the first wall
  const w1x = d.position.x + a.dx * off, w1z = d.position.z + a.dz * off;
  const lq = (cx - w1x) * qx + (cz - w1z) * qz;
  const px = w1x + qx * lq, pz = w1z + qz * lq; // where the first wall crosses the second's line
  const lx = -wdz, lz = wdx; // along the second wall
  const sAlong = (px - cx) * lx + (pz - cz) * lz;
  if (WALL_SOURCE !== 'b') return { s: sAlong, at: t0, speed: TW.laySpeed };
  let ux = px - d.position.x, uz = pz - d.position.z;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  a.aim2 = Math.atan2(ux, uz);
  const rx = d.position.x + ux * Math.min(off, ul * 0.8), rz = d.position.z + uz * Math.min(off, ul * 0.8);
  const at = t0 + TW.strikeDelay;
  const run = Math.hypot(px - rx, pz - rz) / TW.runSpeed;
  return { s: sAlong, at: at + run, speed: TW.laySpeed, run: { x: rx, z: rz, at, speed: TW.runSpeed } };
}

// ------------------------------------------------------------------ inferno nova
const NV = T.nova;
const nova = {
  name: 'nova',
  cooldown: NV.cooldown,
  // the charge keeps its 2.5 s in every phase (it is the tell)
  phases: (d) => [['windup', NV.windup], ['blast', NV.blast], ['recovery', wind(d, NV.recovery)]],
  beats: (d, a) => [beat('nova', 0, a.list[0][1], NV, 'chest')],
  zone(d, a, out) {
    out.set(a.cx, 0, a.cz);
    return NV.radius;
  },
  weight: (d) => wPhase(NV, d),
  start(d, a) {
    const c = d.rig.pt.chest;
    a.cx = Number.isFinite(c.x) ? c.x : d.position.x;
    a.cz = Number.isFinite(c.z) ? c.z : d.position.z;
    a.glow0 = d.glowTarget ?? 0;
    a.light = d.fx._light({ x: a.cx, y: 4, z: a.cz, color: [1, 0.72, 0.45], intensity: 0.5, radius: 6, fadeIn: 0.3, fade: 0.3, flicker: 0.15 });
    d.emit('dragon:spell', { name: 'nova', x: a.cx, z: a.cz });
  },
  enter(d, a, phase) {
    if (phase !== 'blast') return;
    const g = d.game, c = d.rig.pt.chest;
    d.fx.novaBlast(a.cx, Math.max(2, c.y), a.cz, NV.radius);
    {
      // the blast on the world: everything near its heart goes, the rim is only chipped
      const NW = TUNING.world.nova;
      g.world?.impact?.(a.cx, a.cz, NV.radius * NW[2], NW[0], NOVA_BLOW);
      g.world?.destructibles?.strike(a.cx, a.cz, NV.radius, NW[1], GROUND_BLOW);
    }
    d.emit('dragon:hazard', { kind: 'nova', stage: 'hit', x: a.cx, z: a.cz, radius: NV.radius });
    roarFx(d, 1.3);
    g.shake?.(0.9);
    d.hitstop(0.12, 0.05);
    a.light?.kill();
    a.light = null;
    d.markHitbox?.(a.cx, 0, a.cz, NV.radius);
    const p = g.player?.position;
    if (p && Math.hypot(p.x - a.cx, p.z - a.cz) <= NV.radius + playerR(g)) {
      d.strike(a, { damage: NV.damage, knockback: NV.knockback, knockdown: true, burn: NV.burn, kind: 'nova', from: { x: a.cx, z: a.cz }, point: p });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt, k = a.k;
    if (a.phase === 'windup') {
      // rises on its haunches, wings spread wide and trembling, the head thrown back, the whole
      // body heating white; embers and rings of glyphs are sucked into it
      d.turnToward(d.sense.yawTo, d.turnRate * 0.4, dt);
      pose.rear = 0.3 * smoothstep(0, 0.4, k);
      pose.lower = -0.15;
      pose.pitch = -0.16;
      pose.bodyRate = 3;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 3;
      pose.flap = 0.06 + 0.1 * k;
      pose.flapHz = 6;
      pose.swell = 1;
      pose.head = d.rootPt(pose.headTarget, 0, 6.3, 1.9);
      pose.headRate = 3;
      d.rootPt(pose.look, 0, 16, 7);
      pose.jaw = 0.3 + 0.7 * k * k;
      const j = (Math.sin(d.time * 37) * 0.05 + Math.sin(d.time * 23) * 0.04) * S * k;
      pose.headOffset.x += j;
      d.throat = 1;
      d.glowTarget = a.glow0 + 1.3 * k;
      d.flash = Math.max(d.flash ?? 0, 0.15 + 0.7 * k * k); // white-hot (the hit-flash white)
      const c = pt.chest;
      d.fx.novaCharge(dt, c.x, c.y, c.z, k);
      // the blast radius: the whole clearing round it heats up toward the blast (ADR-052)
      d.fx.heatDisc(d.fx.holdLife(a, dt), a, dt, a.cx, a.cz, NV.radius, k, k > 1 - TUNING.flashLead / Math.max(0.5, a.dur), 41.7);
      if (a.light) {
        a.light.set(c.x, c.y, c.z);
        a.light.intensity = 1 + 7 * k * k;
        a.light.radius = 6 + 12 * k;
      }
      d.game.shake?.(0.5 * dt * k);
    } else if (a.phase === 'blast') {
      roarPose(d, a, 1);
      pose.spreadRate = 18;
      d.throat = 1;
      d.flash = 1;
    } else {
      // spent: low and heaving, the wings sagging, the glow draining away
      pose.lower = 0.35 * (1 - k);
      pose.pitch = 0.1 * (1 - k);
      pose.spread[0] = pose.spread[1] = 0.35 + 0.15 * k;
      pose.droop = 0.3 * (1 - k);
      pose.spreadRate = 2;
      pose.jaw = 0.5 * (1 - k) + 0.2;
      pose.restep = 1;
      d.throat = 0;
      d.glowTarget = a.glow0 + 1.3 * (1 - k);
      d.fx.bodyEmbers(dt, d.hurtSpheres, 40 * (1 - k), false);
    }
  },
  end(d, a) {
    d.glowTarget = a.glow0 ?? d.glowTarget;
    a.light?.kill();
    a.light = null;
    d.throat = 0;
  },
};

/** Fire / flight attacks (spread into ATTACKS; order = Lab list order after the melee set). */
export const FIRE = { skyStrafe, diveBomb, hoverBarrage, skyHunt, skyFurnace, skyCataclysm, meteorRain, eruptions, flameRing, flameWall, nova };
