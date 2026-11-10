// The bullet-hell patterns (docs/COMBAT.md "Bullets", ADR-039): four spells built on bullets.js.
//
//   emberStorm  spiral arms of embers wind out round the body (P2: red orb rings, P3: counter arms)
//   fanVolley   wing beats fling fans of embers at the hero (P2+: a red orb wave to finish)
//   wispSwarm   blue homing wisps roared out of the maw, one after another (they outlive the roar)
//   fireWheel   red lines burn out from under it, ignite into walls of fire and turn (reversing once)
//
// Same contract as fireAttacks.js: defs with { name, cooldown, phases, beats, weight, start, enter,
// update, end }; numbers in tuningBullets.js. Each pattern declares ONE headline beat (announced by
// the brain like every attack: combat:tell at the windup, combat:flash flashLead s before the first
// impact, re-timed every frame); every later impact is announced by the bullets' own cue
// (bullets.js). Bullets spawned closer than flashLead of flight are cued here BEFORE they exist,
// from the emission schedule, so hugging the wyrm is not a blind spot (nor a free pass).
//
// Imported only by attacks.js (circular: uses its hoisted helpers at call time, like fireAttacks.js).

import { TUNING, SCALE } from './tuning.js';
import { TELL } from '../../combat/rules.js';
import { clamp, angleDiff } from '../../core/math.js';
import { beat, roarFx, roarPose, perPhase } from './attacks.js';
import { BULLET } from './bullets.js';
import * as BFX from './bulletFx.js';

const T = TUNING.attacks;
const BK = TUNING.bullets;
const S = SCALE;
const TAU = Math.PI * 2;
const REST_SPREAD = TUNING.rest.spread;
const ES = T.emberStorm, FV = T.fanVolley, WS = T.wispSwarm, FW = T.fireWheel;
const wind = (d, base) => base * (d.tScale ?? 1);
const playerR = (g) => g.player?.radius ?? 0.45;

function wPhase(spec, d) {
  const ph = Math.max(1, d.phase | 0);
  const w = spec.weight;
  if (Array.isArray(w)) return Number(w[Math.min(w.length - 1, ph - 1)]) || 0;
  return ph >= (spec.phase ?? 1) ? Number(w) || 0 : 0;
}

/** The headline beat: follow the lead bullet while it is on its way; register its impact once flashed. */
function headline(d, a, kind) {
  const b = a.beats?.[0];
  if (!b) return;
  if (!b.flashed) {
    const tt = d.bullets.leadTti();
    if (Number.isFinite(tt)) b.impactIn = Math.max(0.05, a.T - b.at + tt);
  } else if (!a.covered) {
    a.covered = true;
    d.bullets.cover(kind, Math.max(0, b.at + b.impactIn - a.T));
  }
}

/** A pattern that ends without its flash (the lead bullet died): keep tell / flash paired. */
function flush(d, a, interrupted) {
  const b = a.beats?.[0];
  if (interrupted || !b || !b.told || b.flashed) return;
  b.flashed = true;
  d.flashTell(a, b);
}

/** Crouched over its own fire, wings raised and trembling, the chest swelling (flameRing's windup). */
function gatherPose(d, a, dt, k, r) {
  const pose = d.pose;
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
  d.fx.gatherFire(dt, a.cx, a.cz, r, k);
}

function settlePose(d, k) {
  const pose = d.pose;
  pose.lower = 0.35 * (1 - k);
  pose.spread[0] = pose.spread[1] = k < 0.3 ? 0.55 : REST_SPREAD;
  pose.spreadRate = 3;
  pose.jaw = 0.3;
  pose.restep = 1;
  d.throat = Math.max(0, 1 - k * 3);
}

function castFx(d, a, name, strength) {
  d.emit('dragon:spell', { name, x: a.cx, z: a.cz });
  roarFx(d, strength);
  d.game.world?.gust?.(a.cx, a.cz, 2, 20 * S);
  for (const arm of d.rig.pt.arms) d.emit('dragon:step', { x: arm.toe.x, z: arm.toe.z, heavy: true });
}

// ------------------------------------------------------------------ ember storm
function stormArms(d, a, n, phi, speed, lead) {
  const B = d.bullets;
  for (let j = 0; j < n; j++) {
    const ang = phi + (j * TAU) / n;
    const sx = Math.sin(ang), sz = Math.cos(ang);
    const b = B.spawn(BULLET.EMBER, 'emberStorm', a.cx + sx * ES.r0, ES.y0, a.cz + sz * ES.r0, ang, speed, a.grp, ES.life);
    if (lead && j === 0 && b) B.setLead(b);
  }
}

/** Cue the arms that will sweep over a hero too close for the bullets' own cue (see the header). */
function stormCue(d, a, n, phi, omega, speed, D, th, R) {
  const FL = TUNING.flashLead;
  const fl = Math.max(0, D - ES.r0 - R) / speed;
  if (n <= 0 || fl >= FL) return;
  const half = Math.asin(Math.min(1, R / Math.max(D, 0.5)));
  for (let k = 0; k < 6; k++) {
    const te = Math.max(0, a.next + k * ES.every - a.t);
    const tt = te + fl;
    if (tt > FL) return;
    if (tt < BK.cueMin) continue;
    const base = phi + omega * te;
    for (let j = 0; j < n; j++) {
      const ang = base + (j * TAU) / n;
      if (Math.abs(angleDiff(ang, th)) > half) continue;
      d.bullets.cue(BULLET.EMBER, 'emberStorm', TELL.NORMAL, tt, a.cx + Math.sin(ang) * ES.r0, 1.6, a.cz + Math.cos(ang) * ES.r0);
      return;
    }
  }
}

const emberStorm = {
  name: 'emberStorm',
  cooldown: ES.cooldown,
  phases: (d) => [['windup', wind(d, ES.windup)], ['cast', perPhase(ES.cast, d.phase)], ['recovery', wind(d, ES.recovery)]],
  beats: (d, a) => [beat('emberStorm', 0, a.list[0][1] + 0.5, ES, 'bullet')],
  weight: (d, s) => (s.dist <= ES.maxDist ? wPhase(ES, d) : 0),
  start(d, a) {
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.grp = d.bullets.group(ES.maxHits);
    a.dir = Math.random() < 0.5 ? 1 : -1;
    a.n = perPhase(ES.arms, d.phase) | 0;
    a.nc = perPhase(ES.counter, d.phase) | 0;
    a.orbs = perPhase(ES.orbRing, d.phase) | 0;
    a.phi = a.phiC = 0;
    a.next = 0;
    a.nextOrb = ES.orbEvery * 0.6;
    a.first = true;
    a.covered = false;
  },
  enter(d, a, phase) {
    if (phase !== 'cast') return;
    castFx(d, a, 'emberStorm', 0.7);
    const s = d.sense;
    a.phi = Math.atan2(s.pos.x - a.cx, s.pos.z - a.cz); // the first ember of arm 0 flies straight at him
    a.phiC = a.phi + Math.PI / Math.max(1, a.nc);
    a.next = 0;
    a.first = true;
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, k = a.k, b0 = a.beats?.[0];
    const dx = s.pos.x - a.cx, dz = s.pos.z - a.cz;
    const D = Math.hypot(dx, dz), th = Math.atan2(dx, dz);
    const R = BK.ember.r + playerR(d.game);
    if (a.phase === 'windup') {
      gatherPose(d, a, dt, k, ES.r0 + 1.5);
      if (b0 && !b0.flashed && Number.isFinite(D)) b0.impactIn = Math.max(0.05, a.list[0][1] + Math.max(0, D - ES.r0 - R) / ES.speed);
    } else if (a.phase === 'cast') {
      roarPose(d, a, 0.55);
      pose.spreadRate = 12;
      pose.rear = 0.2;
      pose.lower = 0.3;
      d.throat = 1;
      const om = a.dir * ES.omega, omC = -0.8 * om;
      while (a.t >= a.next) {
        stormArms(d, a, a.n, a.phi, ES.speed, a.first);
        if (a.nc > 0) stormArms(d, a, a.nc, a.phiC, ES.speed * 0.85, false);
        a.first = false;
        a.next += ES.every;
      }
      if (a.orbs > 0 && a.t >= a.nextOrb && Number.isFinite(th)) {
        a.nextOrb += ES.orbEvery;
        for (let j = 0; j < a.orbs; j++) {
          const ang = th + (j * TAU) / a.orbs; // one orb aimed at the hero
          d.bullets.spawn(BULLET.ORB, 'emberStorm', a.cx + Math.sin(ang) * ES.r0, ES.y0, a.cz + Math.cos(ang) * ES.r0, ang, ES.orbSpeed, a.grp, 5);
        }
        d.fx.shockRing(a.cx, a.cz, ES.r0 + 3);
        d.game.shake?.(0.25);
      }
      a.phi += om * dt;
      a.phiC += omC * dt;
      if (Number.isFinite(D + th)) {
        stormCue(d, a, a.n, a.phi, om, ES.speed, D, th, R);
        stormCue(d, a, a.nc, a.phiC, omC, ES.speed * 0.85, D, th, R);
      }
    } else settlePose(d, k);
    headline(d, a, BULLET.EMBER);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flush(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ cinder fan
function fanGeo(d, out) {
  const s = d.sense, px = d.position.x, pz = d.position.z;
  const dx = s.pos.x - px, dz = s.pos.z - pz;
  out.D = Math.hypot(dx, dz);
  out.th = Math.atan2(dx, dz);
  out.r0 = clamp(out.D - 2.2, 2.0, FV.r0); // never spawned on top of him
  return out;
}
const _geo = { D: 0, th: 0, r0: 0 };

/** Offset (in bullet spacings) of the bullet nearest the fan's centre line for volley i. */
function fanOffset(i, n, orbWave) {
  const centred = n & 1 ? 0 : 0.5; // a bullet exactly on the hero
  return orbWave || !(i & 1) ? centred : centred + 0.5; // odd volleys sit in the gaps
}

function fan(d, a, i, orbWave) {
  const B = d.bullets, G = fanGeo(d, _geo);
  if (!Number.isFinite(G.D + G.th)) return;
  const n = orbWave ? a.orb : a.cnt;
  const half = orbWave ? FV.orbSpread : FV.spread;
  const speed = orbWave ? FV.orbSpeed : FV.speed;
  const kind = orbWave ? BULLET.ORB : BULLET.EMBER;
  const spacing = n > 1 ? (2 * half) / (n - 1) : 0;
  const off = fanOffset(i, n, orbWave);
  const px = d.position.x, pz = d.position.z;
  for (let j = 0; j < n; j++) {
    const q = j - (n - 1) / 2 + off - (n & 1 ? 0 : 0.5);
    const ang = G.th + q * spacing;
    const b = B.spawn(kind, 'fanVolley', px + Math.sin(ang) * G.r0, FV.y0, pz + Math.cos(ang) * G.r0, ang, speed, a.grp, orbWave ? 5 : FV.life);
    if (i === 0 && Math.abs(q) < 1e-6 && b) B.setLead(b);
  }
  const sx = Math.sin(G.th), sz = Math.cos(G.th);
  BFX.muzzle(d.fx, px + sx * G.r0, FV.y0, pz + sz * G.r0, sx, sz, orbWave ? 16 : 10, false);
  d.onFlap?.(orbWave ? 1 : 0.7);
  d.game.shake?.(orbWave ? 0.3 : 0.14);
}

/** The next volley's cue for a hero it reaches in less than flashLead (see the header). */
function fanCue(d, a) {
  const total = a.n + (a.orb > 0 ? 1 : 0);
  if (a.v <= 0 || a.v >= total) return;
  const FL = TUNING.flashLead;
  const orbWave = a.v >= a.n;
  const G = fanGeo(d, _geo);
  if (!Number.isFinite(G.D + G.th)) return;
  const R = (orbWave ? BK.orb.r : BK.ember.r) + playerR(d.game);
  const speed = orbWave ? FV.orbSpeed : FV.speed;
  const fl = Math.max(0, G.D - G.r0 - R) / speed;
  if (fl >= FL) return;
  const tt = Math.max(0, a.v * FV.gap - a.t) + fl;
  if (tt > FL + (orbWave ? 0.04 : 0) || tt < BK.cueMin) return;
  const n = orbWave ? a.orb : a.cnt;
  const spacing = n > 1 ? (2 * (orbWave ? FV.orbSpread : FV.spread)) / (n - 1) : 0;
  const q = fanOffset(a.v, n, orbWave) - (n & 1 ? 0 : 0.5); // 0 or 0.5 spacings off the hero
  if (G.D * Math.sin(Math.min(1.5, Math.abs(q) * spacing)) > R) return;
  const px = d.position.x, pz = d.position.z;
  d.bullets.cue(orbWave ? BULLET.ORB : BULLET.EMBER, 'fanVolley', orbWave ? TELL.RED : TELL.NORMAL, tt, px + Math.sin(G.th) * G.r0, 1.6, pz + Math.cos(G.th) * G.r0);
}

const fanVolley = {
  name: 'fanVolley',
  cooldown: FV.cooldown,
  phases: (d) => {
    const n = (perPhase(FV.volleys, d.phase) | 0) + (perPhase(FV.orbWave, d.phase) > 0 ? 1 : 0);
    return [['windup', wind(d, FV.windup)], ['cast', n * FV.gap + 0.2], ['recovery', wind(d, FV.recovery)]];
  },
  beats: (d, a) => [beat('fanVolley', 0, a.list[0][1] + 0.4, FV, 'bullet')],
  weight: (d, s) => (s.dist >= FV.minDist && s.dist <= FV.maxDist ? wPhase(FV, d) : 0),
  start(d, a) {
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.grp = d.bullets.group(FV.maxHits);
    a.n = perPhase(FV.volleys, d.phase) | 0;
    a.cnt = perPhase(FV.count, d.phase) | 0;
    a.orb = perPhase(FV.orbWave, d.phase) | 0;
    a.v = 0;
    a.covered = false;
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'fanVolley', x: a.cx, z: a.cz });
      roarFx(d, 0.4);
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, k = a.k, b0 = a.beats?.[0];
    if (a.phase !== 'recovery') d.turnToward(s.yawTo, d.turnRate, dt);
    pose.look.copy(s.pos);
    if (a.phase === 'windup') {
      // rears a little, the wings spread wide and high, embers gathering along them
      pose.rear = 0.22 * k;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 4;
      pose.swell = 0.6 * k;
      pose.jaw = 0.25 + 0.3 * k;
      pose.restep = 1;
      d.throat = 0.6 * k;
      const G = fanGeo(d, _geo);
      if (b0 && !b0.flashed && Number.isFinite(G.D)) {
        b0.impactIn = Math.max(0.05, a.list[0][1] + Math.max(0, G.D - G.r0 - BK.ember.r - playerR(d.game)) / FV.speed);
      }
    } else if (a.phase === 'cast') {
      const total = a.n + (a.orb > 0 ? 1 : 0);
      if (a.v < total && a.t >= a.v * FV.gap) {
        fan(d, a, a.v, a.v >= a.n);
        a.v++;
      }
      fanCue(d, a);
      // the wings slam down on every volley and rise for the next
      const u = (a.t / FV.gap) % 1;
      const down = u < 0.28 && a.t < total * FV.gap;
      pose.spread[0] = pose.spread[1] = down ? 0.25 : 1;
      pose.spreadRate = down ? 24 : 7;
      pose.rear = 0.22;
      pose.lower = down ? 0.2 : 0;
      pose.bodyRate = 12;
      pose.jaw = 0.5;
      d.throat = 0.7;
    } else {
      pose.rear = 0.22 * (1 - k);
      pose.spread[0] = pose.spread[1] = k < 0.3 ? 0.55 : REST_SPREAD;
      pose.spreadRate = 3;
      pose.restep = 1;
      d.throat = Math.max(0, 0.7 - k * 2);
    }
    headline(d, a, BULLET.EMBER);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flush(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ wisp swarm
const wispSwarm = {
  name: 'wispSwarm',
  cooldown: WS.cooldown,
  phases: (d) => [['windup', wind(d, WS.windup)], ['cast', WS.cast], ['recovery', wind(d, WS.recovery)]],
  beats: (d, a) => [beat('wispSwarm', 0, a.list[0][1] + WS.first + 1, WS, 'bullet')],
  weight: (d, s) => (s.dist <= WS.maxDist && d.bullets.count(BULLET.WISP) === 0 ? wPhase(WS, d) : 0),
  start(d, a) {
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.grp = d.bullets.group(WS.maxHits);
    a.acc = 0;
    a.covered = false;
  },
  enter(d, a, phase) {
    if (phase !== 'cast') return;
    d.emit('dragon:spell', { name: 'wispSwarm', x: a.cx, z: a.cz });
    roarFx(d, 0.5);
    const B = d.bullets, m = d.rig.pt.mouth, spec = BK.wisp;
    const n = perPhase(WS.count, d.phase) | 0;
    for (let i = 0; i < n; i++) {
      // alternating sides, ever wider: they hang in an arc round the head
      const yaw = d.yaw + (i & 1 ? -1 : 1) * (0.9 + 0.3 * (i >> 1));
      const b = B.spawn(BULLET.WISP, 'wispSwarm', m.x, m.y, m.z, yaw, WS.out, a.grp, 0);
      if (!b) break;
      b.turn = spec.turn;
      b.homeAt = WS.first + i * WS.stagger;
      b.yH = 2.1;
      b.drop = 0.6;
      b.arm = b.homeAt + 0.15;
      b.life = b.homeAt + spec.life;
      if (i === 0) {
        b.cruise = WS.leadSpeed;
        b.turn = spec.turn * 2;
        B.setLead(b);
      }
    }
    BFX.muzzle(d.fx, m.x, m.y, m.z, Math.sin(d.yaw), Math.cos(d.yaw), 18, true);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt, k = a.k, b0 = a.beats?.[0];
    pose.look.copy(s.pos);
    if (a.phase === 'windup') {
      // the head draws back and up, the jaws fill with a cold blue light
      d.turnToward(s.yawTo, d.turnRate, dt);
      pose.head = d.rootPt(pose.headTarget, 0, 4.6 + 0.6 * k, 2.6);
      pose.headRate = 5;
      pose.jaw = 0.2 + 0.6 * k;
      pose.swell = k;
      pose.spread[0] = pose.spread[1] = 0.7;
      pose.spreadRate = 3;
      pose.restep = 1;
      d.throat = 0.5 * k;
      a.acc += dt * (6 + 20 * k);
      while (a.acc >= 1) {
        a.acc -= 1;
        BFX.muzzle(d.fx, pt.mouth.x, pt.mouth.y, pt.mouth.z, -pt.headFwd.x, -pt.headFwd.z, 1, true);
      }
      if (b0 && !b0.flashed && Number.isFinite(s.dist)) b0.impactIn = Math.max(0.05, a.list[0][1] + WS.first + s.dist / WS.leadSpeed);
    } else if (a.phase === 'cast') {
      roarPose(d, a, 0.5);
      d.throat = 0.6;
    } else {
      pose.spread[0] = pose.spread[1] = REST_SPREAD;
      pose.spreadRate = 3;
      pose.jaw = 0.3 * (1 - k);
      d.throat = 0;
    }
    headline(d, a, BULLET.WISP);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flush(d, a, interrupted);
  },
};

// ------------------------------------------------------------------ fire wheel
const fireWheel = {
  name: 'fireWheel',
  cooldown: FW.cooldown,
  phases: (d) => [['windup', wind(d, FW.windup)], ['cast', perPhase(FW.dur, d.phase)], ['recovery', wind(d, FW.recovery)]],
  beats: (d, a) => [beat('fireWheel', 0, a.list[0][1] + 1, FW, 'chest')],
  weight: (d, s) => (s.dist <= FW.maxDist ? wPhase(FW, d) : 0),
  start(d, a) {
    const s = d.sense;
    a.cx = d.position.x;
    a.cz = d.position.z;
    a.n = Math.max(2, perPhase(FW.spokes, d.phase) | 0);
    a.dir = Math.random() < 0.5 ? 1 : -1;
    const th = Math.atan2(s.pos.x - a.cx, s.pos.z - a.cz);
    d.bullets.startWheel({
      attack: 'fireWheel', x: a.cx, z: a.cz, n: a.n, ang: (Number.isFinite(th) ? th : d.yaw) + Math.PI / a.n, dir: a.dir,
      warn: a.list[0][1], dur: a.list[1][1], speed: FW.speed, r0: FW.r0, r1: FW.r1, width: FW.width,
      damage: FW.damage, burn: FW.burn, knockback: FW.knockback, max: FW.maxHits, headline: true,
    });
  },
  enter(d, a, phase) {
    if (phase === 'cast') castFx(d, a, 'fireWheel', 0.9);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, k = a.k, b0 = a.beats?.[0], w = d.bullets.wheel;
    if (b0 && !b0.flashed) {
      if (a.phase === 'windup') {
        // the spoke that will come round to him first: its angle to run, at the ramped speed
        const dx = s.pos.x - a.cx, dz = s.pos.z - a.cz;
        const r = Math.hypot(dx, dz), seg = TAU / a.n;
        if (Number.isFinite(r) && r > 0.5) {
          let gap = (a.dir * angleDiff(w.ang, Math.atan2(dx, dz))) % seg;
          if (gap < 0) gap += seg;
          const half = Math.asin(Math.min(1, (FW.width / 2 + playerR(d.game) / 2) / r));
          b0.impactIn = Math.max(0.05, a.list[0][1] + 0.25 + Math.max(0.1, gap - half) / FW.speed);
        }
      } else if (w.on && Number.isFinite(w.tt) && w.tt >= 0) b0.impactIn = Math.max(0.05, a.T - b0.at + w.tt);
    } else if (w.headline) {
      w.headline = false; // from here on the wheel cues its own spokes
      w.cueT = d.bullets.time;
    }
    if (a.phase === 'windup') gatherPose(d, a, dt, k, FW.r0 + 1.5);
    else if (a.phase === 'cast') {
      roarPose(d, a, 0.55);
      pose.spreadRate = 14;
      pose.lower = 0.3;
      pose.rear = 0.15;
      d.throat = 1;
    } else settlePose(d, k);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    d.bullets.stopWheel();
    flush(d, a, interrupted);
  },
};

export const BULLET_HELL = { emberStorm, fanVolley, wispSwarm, fireWheel };
