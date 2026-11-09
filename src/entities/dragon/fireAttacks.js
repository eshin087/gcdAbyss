import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { clamp, lerp, smoothstep, easeOutCubic, easeInCubic, easeInOutSine, angleDiff } from '../../core/math.js';
import { beat, roarFx, roarPose } from './attacks.js';

// Fire / flight attacks and spells (contract 3; numbers in tuningFire.js = TUNING.attacks.*). Same
// shape as attacks.js (phases / beats / zone / weight / start / enter / update / hit / end, driven by
// the runner in ai.js); spread into ATTACKS there.
//   flight (short: it takes off, attacks from the air and lands inside one action):
//     skyStrafe    'Burning pass'  low pass over the hero breathing fire down; a burning strip hazard
//     diveBomb     'Sky dive'      climbs ~14 m, hovers + tracks (red ring), dives: the crash is the hit
//     hoverBarrage 'Hover barrage' hovers ~8 m, spits 3-5 shells, each landing in a red ring
//   spells:
//     meteorRain   a background rain of meteors (the wyrm keeps fighting while it falls)
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

/** Touch-down: back on the ground ('combat'), dust and a gust, 'dragon:land'. */
function touchDown(d, heavy = false) {
  if (d.state === 'airborne') d.state = 'combat';
  d.position.y = 0;
  const g = d.game, x = d.position.x, z = d.position.z;
  d.emit('dragon:land', { x, z });
  g.world?.gust?.(x, z, heavy ? 2 : 1.5, (heavy ? 22 : 16) * S);
  g.shake?.(heavy ? 0.7 : 0.35);
  d.fx.dustRing(x, z, (heavy ? 2.2 : 1.8) * S, heavy ? 56 : 40, heavy ? 1.6 : 1.1);
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

/** On the beat's timing flash, a red flare where the hazard will meet the hero too (x, z). */
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
    const D = Math.min(clamp(dist + 14, SK.reach[0], SK.reach[1]), maxRun(d.position.x, d.position.z, dx, dz, d.bound));
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
    inBound(d.position, d.bound);
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
        const e = easeOutCubic(u);
        this.place(d, a, lerp(a.sLand, a.D, e));
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
    g.world?.resolve?.(a.target, R, d.bound + R);
    inBound(a.target, d.bound);
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
    inBound(out, d.bound);
    // pinned against the bound on its side: hover on the other side instead
    if (Math.abs(out.x - a.target.x) < DB.hoverBack * 0.5) out.set(a.target.x - a.side * DB.hoverBack, 0, a.target.z - 1);
    return inBound(out, d.bound);
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
    touchDown(d, true);
    d.hitstop(0.09);
    d.fx.crashWave(a.target.x, a.target.z, DB.radius);
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
      pose.hover = smoothstep(0.3, 1, k);
      pose.glide = 0.45 * k; // (the beat's span a little lower: the raised sails reached the camera)
      pose.pitch = -0.25 - 0.15 * k;
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
    inBound(out, d.bound);
    // pinned against the bound on its side: hover on the other side instead
    if (Math.abs(out.x - s.pos.x) < HB.standoff * 0.5) out.set(s.pos.x - a.side * HB.standoff, 0, s.pos.z + 1.5);
    return inBound(out, d.bound);
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
    inBound(_a, 27);
    g.world?.resolve?.(_a, 0.5, 30);
    const b = a.beats[i];
    const ref = d.hazards.circle({
      kind: 'shell', attack: 'hoverBarrage', announce: false, x: _a.x, z: _a.z, r: HB.radius, delay: HB.aim + 0.75,
      damage: HB.damage, burn: HB.burn, knockback: HB.knockback, group: a.group, active: 0.1,
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
    inBound(d.position, d.bound);
    while (a.aimed < a.n && a.t >= a.aimed * HB.interval) this.aim(d, a, a.aimed++);
    while (a.shot < a.n && a.shot < a.aimed && a.t >= a.shot * HB.interval + HB.aim) this.launch(d, a, a.shot++);
    fly(pose, HB.alt + 0.4 * Math.sin(a.t * 3.3), 0.85, 2.0);
    pose.hover = 1;
    pose.pitch = -0.33;
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

// ------------------------------------------------------------------ meteor rain
const MR = T.meteorRain;
const meteorRain = {
  name: 'meteorRain',
  cooldown: MR.cooldown,
  phases: (d) => [['windup', wind(d, MR.windup)], ['cast', MR.cast], ['recovery', wind(d, MR.recovery)]],
  // no beat of its own: the cast deals nothing; every meteor rings red and announces itself
  weight: (d, s) => (d.hazards?.count('rain') || d.hazards?.count('meteor') ? 0 : wPhase(MR, d)),
  enter(d, a, phase) {
    if (phase !== 'cast') return;
    roarFx(d, 0.9);
    d.fx.castBolt(d.rig.pt.mouth);
    d.emit('dragon:spell', { name: 'meteorRain', x: d.position.x, z: d.position.z });
    const c = MR.count[clamp((d.phase | 0) - 1, 0, MR.count.length - 1)];
    const n = c[0] + Math.floor(Math.random() * (c[1] - c[0] + 1));
    d.hazards.rain({
      attack: 'meteorRain', count: n, first: MR.first, span: MR.span, warn: MR.warn, warnLed: MR.warnLed, ledEvery: MR.ledEvery,
      lo: MR.spread[0], hi: MR.spread[1], r: MR.radius, fall: MR.fall,
      damage: MR.damage, burn: MR.burn, knockback: MR.knockback, group: d.hazards.group(MR.maxHits),
    });
  },
  update(d, a, dt) {
    const pose = d.pose, pt = d.rig.pt;
    if (a.phase === 'windup') {
      // rises tall, the throat charging, the head drawn back to the sky, the wings opening
      d.turnToward(d.sense.yawTo, d.turnRate * 0.6, dt);
      pose.head = d.rootPt(pose.headTarget, 0, 6.0, 2.0);
      pose.headRate = 4;
      d.rootPt(pose.look, 0, 14, 8);
      pose.jaw = 0.3 + 0.3 * a.k;
      pose.pitch = -0.1;
      pose.lower = -0.1;
      pose.swell = a.k;
      pose.spread[0] = pose.spread[1] = a.k > 0.4 ? 1 : REST_SPREAD;
      pose.spreadRate = 3;
      d.throat = a.k;
      d.fx.mouthEmbers(dt, pt.mouth, 26, pt.headFwd);
    } else if (a.phase === 'cast') {
      // the roar to the sky (the shell flies up with it)
      roarPose(d, a, 1);
      d.rootPt(pose.look, 0, 20, 6);
      d.throat = 1;
    } else {
      pose.jaw = 0.25;
      pose.spreadRate = 3;
      d.throat = 0;
    }
  },
  end(d) {
    d.throat = 0;
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
    return [['windup', wind(d, ER.windup)], ['slam', ER.slam], ['channel', chase ? ER.chase.time : 0.01], ['recovery', wind(d, ER.recovery)]];
  },
  // one red beat: the pillar that erupts under the hero (the chase: its first pillar)
  beats: (d, a) => [beat('eruptions', 0, a.list[0][1] + ER.slam + (a.chase ? ER.chase.warn : lineEta(d)), ER, 'forefeet')],
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
    const common = { attack: 'eruptions', r: ER.radius, active: ER.active, damage: ER.damage, burn: ER.burn, knockback: ER.knockback };
    const b = a.beats[0];
    if (a.chase) {
      a.line = d.hazards.chase({ ...common, every: ER.chase.every, until: ER.chase.time, warn: ER.chase.warn, lead: ER.chase.lead, group: d.hazards.group(ER.chase.maxHits), linkFirst: true });
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + ER.chase.warn + 1 / 60);
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
    a.line = d.hazards.line({ ...common, kind: 'line', announce: false, ax, az, dx, dz, n, step: ERL.step, delay: ERL.first, stagger: ERL.delay });
    retime(d, a, b, a.line);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k;
    const b = a.cur;
    if (a.phase === 'windup') {
      // rears up on the hind legs, forefeet raised, throat and chest glowing: the slam is coming
      if (b && !b.flashed) b.impactIn = Math.max(0.05, a.list[0][1] + ER.slam + (a.chase ? ER.chase.warn : lineEta(d)) - b.at);
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
    if (!a.chase) retime(d, a, b, a.line);
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
const flameRing = {
  name: 'flameRing',
  cooldown: FR.cooldown,
  // the recovery lasts until the ring has run out (its flash may come late for a far hero)
  phases: (d) => [['windup', wind(d, FR.windup)], ['cast', FR.cast], ['recovery', Math.max(wind(d, FR.recovery), ringTravel() + 0.15)]],
  beats: (d, a) => {
    const b = beat('flameRing', 0, a.list[0][1] + FR.cast + 0.5, FR, 'chest');
    retime(d, a, b, a.ring);
    return [b];
  },
  weight: (d, s) => (s.dist <= FR.maxDist ? wPhase(FR, d) : 0),
  start(d, a) {
    // round the middle of the body (it doesn't turn while it casts)
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.flared = false;
    a.ring = d.hazards.ring({
      kind: 'ring', attack: 'flameRing', announce: false, x: a.cx, z: a.cz, r0: FR.r0, r1: FR.r1, speed: FR.speed, w: FR.width,
      delay: a.list[0][1] + FR.cast, damage: FR.damage, burn: FR.burn, knockback: FR.knockback,
    });
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
    retime(d, a, a.cur, a.ring);
    flareOnFlash(d, a, a.cur, s.pos.x, s.pos.z, 2.4);
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
const flameWall = {
  name: 'flameWall',
  cooldown: FW.cooldown,
  phases: (d) => [['windup', wind(d, FW.windup)], ['cast', FW.cast], ['recovery', Math.max(wind(d, FW.recovery), FW.sweep / FW.speed + 0.15)]],
  beats: (d, a) => {
    const b = beat('flameWall', 0, a.list[0][1] + FW.cast + 0.6, FW, 'mouth');
    retime(d, a, b, a.wall);
    return [b];
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
    const off = FW.start + 2.5 * S;
    a.wall = d.hazards.wall({
      kind: 'wall', attack: 'flameWall', announce: false, x: d.position.x + dx * off, z: d.position.z + dz * off, dx, dz,
      len: FW.length, w: FW.width, speed: FW.speed, dist: FW.sweep, delay: a.list[0][1] + FW.cast,
      damage: FW.damage, burn: FW.burn, knockback: FW.knockback,
    });
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'flameWall', x: d.position.x, z: d.position.z });
      d.emit('dragon:breathStart');
      d.fx.breathBegin();
      a.breath = true;
    } else if (phase === 'recovery') this.stopBreath(d, a);
  },
  stopBreath(d, a) {
    if (!a.breath) return;
    a.breath = false;
    d.fx.breathEnd();
    d.emit('dragon:breathEnd');
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k;
    retime(d, a, a.cur, a.wall);
    flareOnFlash(d, a, a.cur, s.pos.x, s.pos.z, 2.4);
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
    } else {
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
      // the blast radius in red, its inner ring closing in on the wyrm: a countdown to the blast
      d.fx.hzRing(d.fx.holdLife(a, dt), a.cx, a.cz, NV.radius, k, k > 1 - TUNING.flashLead / Math.max(0.5, a.dur));
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
export const FIRE = { skyStrafe, diveBomb, hoverBarrage, meteorRain, eruptions, flameRing, flameWall, nova };
