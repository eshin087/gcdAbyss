// The bullet-hell patterns (docs/COMBAT.md "Bullets", ADR-039, ADR-050): four spells built on bullets.js.
//
//   emberStorm  Ember torrent: the head sweeps a breathed stream of embers across the hero (P2+: red
//               orbs coughed at the sweep's extremes, P3: a closing pirouette, one spiral arm)
//   fanVolley   Cinder burst: the head snaps onto the hero and coughs shotgun cones (P2+: a red orb
//               wave to finish, P3: double taps; P3 may run straight into a torrent)
//   wispSwarm   blue homing wisps roared out of the maw, one after another (they outlive the roar)
//   fireWheel   Scouring breath: a sustained breath strikes the ground before the snout and runs out
//               as tongues of fire; the wyrm sweeps them round by turning, pausing once and reversing
//
// Every bullet is BREATHED (ADR-050): spit() spawns it at rig.pt.mouth along the head's actual aim
// (pt.headFwd), from the action's hit() hook, which runs after the rig: the bullet leaves the jaws
// where they are drawn this frame. The pose aims the head first (aimHead: reach out of the neck
// base, look down the line, headExact) and the emission follows where it really points. A bullet
// leaves at mouth height and descends to hit height over a drop scaled to the hero's distance, so a
// close hero is not flown over. Every emission has a visible cause: the jaw open, the throat lit
// (d.throat), a muzzle puff, a head kick per cough.
//
// Same contract as fireAttacks.js: defs with { name, cooldown, phases, beats, weight, start, enter,
// update, hit, end }; numbers in tuningBullets.js. Each pattern declares ONE headline beat (announced
// by the brain like every attack: combat:tell at the windup, combat:flash flashLead s before the first
// impact, re-timed every frame; when the lead bullet is still on its way as the action ends, the
// field keeps the flash for it: bullets.holdFlash); every later impact is announced by the bullets'
// own cue (bullets.js). Bullets that will reach the hero in less than flashLead from the mouth are
// cued here BEFORE they exist, from the emission schedule, so hugging the wyrm is not a blind spot
// (nor a free pass).
//
// Imported only by attacks.js (circular: uses its hoisted helpers at call time, like fireAttacks.js).

import { TUNING, SCALE } from './tuning.js';
import { TELL } from '../../combat/rules.js';
import { clamp, angleDiff, smoothstep, wrapAngle } from '../../core/math.js';
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
const LOOK_RATE = 24; // the head's look target smoothing while breathing (1 / s)

function wPhase(spec, d) {
  const ph = Math.max(1, d.phase | 0);
  const w = spec.weight;
  if (Array.isArray(w)) return Number(w[Math.min(w.length - 1, ph - 1)]) || 0;
  return ph >= (spec.phase ?? 1) ? Number(w) || 0 : 0;
}

/** The head's actual aim (world yaw of rig.pt.headFwd). */
export function headYaw(d) {
  const f = d.rig.pt.headFwd;
  return Math.atan2(f.x, f.z);
}

/** Horizontal distance and bearing from the mouth to the hero (out.D, out.th). */
function mouthGeo(d, out) {
  const m = d.rig.pt.mouth, p = d.sense.pos;
  const dx = p.x - m.x, dz = p.z - m.z;
  out.D = Math.hypot(dx, dz);
  out.th = Math.atan2(dx, dz);
  return out;
}
const _geo = { D: 0, th: 0 };

/**
 * One bullet breathed out of the jaws (ADR-050): at rig.pt.mouth, flying along the head's aim + dyaw.
 * It reaches hit height after a drop scaled to the mouth-to-hero distance (a close hero is not flown
 * over). Returns the record or null.
 */
export function spit(d, kind, attack, dyaw, speed, grp = -1, life = 0) {
  const m = d.rig.pt.mouth;
  const b = d.bullets.spawn(kind, attack, m.x, m.y, m.z, headYaw(d) + dyaw, speed, grp, life);
  if (b) {
    const p = d.sense.pos, D = Math.hypot(p.x - m.x, p.z - m.z);
    b.drop = clamp((BK.dropK * (Number.isFinite(D) ? D : 10)) / Math.max(1, speed), BK.dropMin, BK.dropMax);
  }
  return b;
}

/**
 * Breathing pose of the head: it reaches `reach` (model units) out of the neck base along world yaw
 * `yaw`, dipped `dy`, and looks down that line at hit height `dist` m from the mouth (or at `look`).
 * headExact: the emission follows the head, so the head must not lag behind its aim.
 */
function aimHead(d, yaw, reach, dy, dist, look = null) {
  const pose = d.pose, pt = d.rig.pt;
  const sa = Math.sin(yaw), ca = Math.cos(yaw);
  pose.head = pose.headTarget.set(pt.neckBase.x + sa * reach * S, pt.neckBase.y + dy * S, pt.neckBase.z + ca * reach * S);
  pose.headRate = 7;
  if (look) pose.look.set(look.x, BK.height, look.z);
  else {
    const L = clamp(Number.isFinite(dist) ? dist : 10, 3, 30);
    pose.look.set(pt.mouth.x + sa * L, BK.height, pt.mouth.z + ca * L);
  }
  pose.lookRate = LOOK_RATE;
  pose.lookDown = 1.0;
  pose.headExact = true;
}

/**
 * The head's reach (model units) for a hero `D` m from the neck base: `base`, drawn in over a close
 * hero so the jaws stay ~2 m short of him and point down at him (not over his head).
 */
function reachFor(d, base) {
  const nb = d.rig.pt.neckBase, p = d.sense.pos;
  const Dn = Math.hypot(p.x - nb.x, p.z - nb.z);
  return Number.isFinite(Dn) ? clamp((Dn - 2.2) / S, 0.6, base) : base;
}

/** Feet planted wide for a sustained breath, the body a little lowered. */
function plantPose(d, k) {
  const pose = d.pose;
  pose.stanceF = 0.3;
  pose.stanceH = 0.25;
  pose.restep = 1;
  pose.lower = 0.3 * k;
  pose.pitch = 0.04;
  pose.elbowsOut = 0.4;
  pose.spread[0] = pose.spread[1] = 1;
  pose.spreadRate = 3;
  pose.mantle = 1;
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
    d.bullets.headlined(kind, Math.max(0, b.at + b.impactIn - a.T));
  }
}

/**
 * A pattern that ends without its flash. Its lead bullet still on its way (a far hero: the wisps
 * outlive the roar): the field flashes flashLead s before THAT lands (bullets.holdFlash). No lead
 * left (`kind` omitted, or it died): flash now, so tell / flash stay paired.
 */
function flush(d, a, interrupted, kind) {
  const b = a.beats?.[0];
  if (interrupted || !b || !b.told || b.flashed) return;
  if (kind !== undefined && d.bullets.holdFlash(a, b, kind)) return;
  b.flashed = true;
  d.flashTell(a, b);
}

/** Crouched over its own fire, wings raised and trembling, the chest swelling (the wisps' windup). */
function settlePose(d, k) {
  const pose = d.pose;
  pose.lower = 0.35 * (1 - k);
  pose.spread[0] = pose.spread[1] = k < 0.3 ? 0.55 : REST_SPREAD;
  pose.spreadRate = 3;
  pose.jaw = 0.3;
  pose.restep = 1;
  d.throat = Math.max(0, 1 - k * 3);
}

/** Embers gathering in the jaws while the throat charges (k 0..1). */
function charge(d, dt, k) {
  const pt = d.rig.pt;
  d.fx.mouthEmbers?.(dt, pt.mouth, 8 + 30 * k, pt.headFwd);
}

// ------------------------------------------------------------------ ember torrent
/** Yaw offset of lane j of n: a forked tongue, laneGap apart, centred on the head's aim. */
const laneOff = (n, j) => (j - (n - 1) / 2) * ES.laneGap;

/** The torrent's target aim `te` s from now (sweep or pirouette; coughs aside). */
function torrentAim(a, te) {
  if (a.spinning) return a.spinYaw + a.dir * a.spinRate * te;
  return a.cy + a.dir * a.arc * Math.sin(a.ph + TAU * a.hz * te);
}

/**
 * Cue the stream for a hero the bullets reach in less than flashLead from the mouth (see the header):
 * the next breaths' predicted aim (the head trails its target by ~1 / LOOK_RATE s) against his bearing.
 * A coming orb cough is cued the same way.
 */
function streamCue(d, a) {
  const FL = TUNING.flashLead;
  const G = mouthGeo(d, _geo);
  if (!Number.isFinite(G.D + G.th)) return;
  const m = d.rig.pt.mouth;
  const R = BK.ember.r + playerR(d.game);
  const fl = Math.max(0, G.D - R) / ES.speed;
  if (fl < FL) {
    const half = Math.asin(Math.min(1, R / Math.max(G.D, 0.5)));
    for (let k = 0; k < 8; k++) {
      const te = Math.max(0, a.next + k * ES.every - a.t);
      const tt = te + fl;
      if (tt > FL) break;
      if (tt < BK.cueMin || a.cough > te) continue;
      const y = torrentAim(a, te - 1 / LOOK_RATE);
      let hit = false;
      for (let j = 0; j < a.lanes && !hit; j++) hit = Math.abs(angleDiff(y + laneOff(a.lanes, j), G.th)) <= half;
      if (hit) {
        d.bullets.cue(BULLET.EMBER, 'emberStorm', TELL.NORMAL, tt, m.x, m.y, m.z);
        break;
      }
    }
  }
  if (a.cough > 0 && !a.coughFired) {
    const Ro = BK.orb.r + playerR(d.game);
    const tt = Math.max(0, a.cough - ES.cough * 0.5) + Math.max(0, G.D - Ro) / ES.orbSpeed;
    if (tt <= FL + 0.04 && tt >= BK.cueMin + 0.03) d.bullets.cue(BULLET.ORB, 'emberStorm', TELL.RED, tt, m.x, m.y, m.z);
  }
}

const emberStorm = {
  name: 'emberStorm',
  cooldown: ES.cooldown,
  phases: (d) => [['windup', wind(d, ES.windup)], ['cast', perPhase(ES.cast, d.phase)], ['recovery', wind(d, ES.recovery)]],
  beats: (d, a) => [beat('emberStorm', 0, a.list[0][1] + 0.5, ES, 'bullet')],
  weight: (d, s) => (s.dist <= ES.maxDist ? wPhase(ES, d) : 0),
  start(d, a) {
    a.grp = d.bullets.group(ES.maxHits);
    a.dir = Math.random() < 0.5 ? 1 : -1;
    a.lanes = Math.max(1, perPhase(ES.lanes, d.phase) | 0);
    a.arc = perPhase(ES.arc, d.phase);
    a.hz = perPhase(ES.sweepHz, d.phase);
    a.orbs = perPhase(ES.orbs, d.phase) | 0;
    a.pir = perPhase(ES.pirouette, d.phase) || 0;
    // the lane nearest the middle points straight at the hero on the first breath (the lead ember)
    a.j0 = (a.lanes - 1) >> 1;
    a.ph = Math.asin(clamp(-laneOff(a.lanes, a.j0) / (a.dir * a.arc), -1, 1));
    a.cy = d.sense.yawTo;
    a.next = 0;
    a.first = true;
    a.covered = false;
    a.cough = 0;
    a.coughFired = true;
    a.lastCos = Math.cos(a.ph);
    a.spinning = false;
    a.spinYaw = 0;
    a.spinRate = a.pir > 0 ? TAU / a.pir : 0;
    a.kick = 0;
    a.breathing = false;
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'emberStorm', x: d.position.x, z: d.position.z });
      d.emit('dragon:breathStart');
      a.breathing = true;
      a.next = 0;
    } else if (phase === 'recovery' && a.breathing) {
      a.breathing = false;
      d.emit('dragon:breathEnd');
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, k = a.k, b0 = a.beats?.[0];
    const G = mouthGeo(d, _geo);
    a.kick = Math.max(0, a.kick - dt * 6);
    if (a.phase === 'windup') {
      // plants its feet and lowers the head onto the hero, the throat filling with fire
      a.cy = s.yawTo;
      d.turnToward(s.yawTo, d.turnRate, dt);
      plantPose(d, k);
      aimHead(d, a.cy + a.dir * a.arc * Math.sin(a.ph), reachFor(d, ES.reach) - 0.9 * (1 - k), ES.dy + 0.4 * (1 - k), G.D);
      pose.jaw = 0.25 + 0.55 * k;
      pose.swell = k;
      d.throat = k;
      charge(d, dt, k);
      if (b0 && !b0.flashed && Number.isFinite(G.D)) {
        b0.impactIn = Math.max(0.05, a.list[0][1] + Math.max(0, G.D - BK.ember.r - playerR(d.game)) / ES.speed);
      }
    } else if (a.phase === 'cast') {
      const Tc = a.list[1][1];
      plantPose(d, 1);
      pose.swell = 1;
      pose.jaw = a.cough > 0 ? 1 : 0.9;
      pose.jawRate = 16;
      d.throat = 1;
      if (!a.spinning && a.pir > 0 && a.t >= Tc - a.pir) {
        a.spinning = true;
        a.spinYaw = headYaw(d);
        a.cough = 0;
      }
      let aim;
      if (a.spinning) {
        // P3's closing pirouette: the whole body turns once, breathing: one spiral arm
        a.spinYaw += a.dir * a.spinRate * dt;
        d.yaw = wrapAngle(d.yaw + a.dir * a.spinRate * dt);
        pose.bodyRate = 14;
        aim = a.spinYaw;
      } else {
        // the neck sweeps the stream; the body only turns to re-centre on the hero
        a.cy += clamp(angleDiff(a.cy, s.yawTo), -ES.recentre * dt, ES.recentre * dt);
        d.turnToward(a.cy, d.turnRate * 0.7, dt);
        if (a.cough > 0) {
          a.cough -= dt;
          aim = G.th; // the head snaps round onto him for the cough
        } else {
          a.ph += TAU * a.hz * dt;
          const c = Math.cos(a.ph);
          // an extreme of the sweep: P2+ coughs a tight fan of red orbs at him (not into the pirouette)
          if (a.orbs > 0 && c * a.lastCos < 0 && a.t > 0.3 && a.t < Tc - a.pir - 0.45) {
            a.cough = ES.cough;
            a.coughFired = false;
          }
          a.lastCos = c;
          aim = a.cy + a.dir * a.arc * Math.sin(a.ph);
        }
      }
      aimHead(d, aim, a.spinning ? ES.reach : reachFor(d, ES.reach), ES.dy, G.D, a.cough > 0 ? s.pos : null);
      pose.headOffset.y += a.kick * 0.25 * S;
    } else {
      plantPose(d, 1 - k);
      settlePose(d, k);
    }
    headline(d, a, BULLET.EMBER);
  },
  // (after the rig: the bullets leave the jaws where they are drawn this frame)
  hit(d, a) {
    if (a.phase !== 'cast') return;
    const pt = d.rig.pt, m = pt.mouth, f = pt.headFwd;
    if (a.cough > 0) {
      if (!a.coughFired && a.cough <= ES.cough * 0.5) {
        a.coughFired = true;
        for (let j = 0; j < a.orbs; j++) spit(d, BULLET.ORB, 'emberStorm', (j - (a.orbs - 1) / 2) * ES.orbSpread, ES.orbSpeed, a.grp, 5);
        BFX.muzzle(d.fx, m.x, m.y, m.z, f.x, f.z, 14, false);
        a.kick = 1;
        d.game.shake?.(0.2);
      }
      a.next = Math.max(a.next, a.t); // the stream picks up again after the cough
    } else {
      let n = 0;
      while (a.t >= a.next && n++ < 4) {
        for (let j = 0; j < a.lanes; j++) {
          const b = spit(d, BULLET.EMBER, 'emberStorm', laneOff(a.lanes, j), ES.speed, a.grp, ES.life);
          if (a.first && j === a.j0 && b) d.bullets.setLead(b);
        }
        a.first = false;
        a.next += ES.every;
      }
      if (a.t >= a.next) a.next = a.t + ES.every; // (a long frame: no catch-up burst)
      if (n > 0) BFX.muzzle(d.fx, m.x, m.y, m.z, f.x, f.z, 2, false);
    }
    streamCue(d, a);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    if (a.breathing) {
      a.breathing = false;
      d.emit('dragon:breathEnd');
    }
    flush(d, a, interrupted, BULLET.EMBER);
  },
};

// ------------------------------------------------------------------ cinder burst
/** Even coughs and the orb wave put a bullet exactly on the hero; odd coughs put him in a gap. */
const fanOnHero = (i, orbWave) => orbWave || !(i & 1);

/**
 * Shift (in bullet spacings) of cough i off the symmetric cone q = j - (n - 1) / 2, which has a
 * bullet on the centre line only for an odd count: an even count is shifted half a spacing to get
 * one (and an odd count to open the gap).
 */
function fanOffset(i, n, orbWave) {
  return !!(n & 1) === fanOnHero(i, orbWave) ? 0 : 0.5;
}

/** The cough schedule: { t (cast s), i, orb, off, tap, done } (P3: odd coughs get a double tap). */
function burstSchedule(d, a) {
  const S0 = (a.sched = []);
  const tap = perPhase(FV.doubleTap, d.phase) > 0;
  for (let i = 0; i < a.n; i++) {
    const off = fanOffset(i, a.cnt, false);
    S0.push({ t: i * FV.gap, i, orb: false, off, tap: false, done: false });
    if (tap && i & 1) S0.push({ t: i * FV.gap + FV.tapGap, i, orb: false, off: (off + 0.5) % 1, tap: true, done: false });
  }
  if (a.orb > 0) S0.push({ t: a.n * FV.gap, i: a.n, orb: true, off: fanOffset(a.n, a.orb, true), tap: false, done: false });
}

function cough(d, a, e) {
  const B = d.bullets, pt = d.rig.pt, m = pt.mouth, f = pt.headFwd;
  const n = e.orb ? a.orb : a.cnt;
  const half = e.orb ? FV.orbSpread : FV.spread;
  const speed = e.orb ? FV.orbSpeed : FV.speed;
  const spacing = n > 1 ? (2 * half) / (n - 1) : 0;
  for (let j = 0; j < n; j++) {
    const q = j - (n - 1) / 2 + e.off;
    const b = spit(d, e.orb ? BULLET.ORB : BULLET.EMBER, 'fanVolley', q * spacing, speed, a.grp, e.orb ? 5 : FV.life);
    if (e.i === 0 && !e.tap && Math.abs(q) < 1e-6 && b) B.setLead(b);
  }
  BFX.muzzle(d.fx, m.x, m.y, m.z, f.x, f.z, e.orb ? 16 : 10, false);
  a.last = a.t;
  a.kick = 1;
  d.game.shake?.(e.orb ? 0.3 : 0.14);
}

/** The next cough's cue for a hero it reaches in less than flashLead from the mouth (see the header). */
function burstCue(d, a) {
  const FL = TUNING.flashLead;
  let e = null;
  for (const x of a.sched) {
    if (!x.done) {
      e = x;
      break;
    }
  }
  if (!e || e.i === 0) return; // (the first cough is the headline beat's)
  const G = mouthGeo(d, _geo);
  if (!Number.isFinite(G.D + G.th)) return;
  const R = (e.orb ? BK.orb.r : BK.ember.r) + playerR(d.game);
  const speed = e.orb ? FV.orbSpeed : FV.speed;
  const fl = Math.max(0, G.D - R) / speed;
  if (fl >= FL) return;
  const tt = Math.max(0, e.t - a.t) + fl;
  if (tt > FL + (e.orb ? 0.04 : 0) || tt < BK.cueMin + (e.orb ? 0.03 : 0)) return;
  const n = e.orb ? a.orb : a.cnt;
  const spacing = n > 1 ? (2 * (e.orb ? FV.orbSpread : FV.spread)) / (n - 1) : 0;
  const q = e.off === 0 ? 0 : 0.5; // spacings from the hero to the nearest bullet (the head is on him)
  if (G.D * Math.sin(Math.min(1.5, q * spacing)) > R) return;
  const m = d.rig.pt.mouth;
  d.bullets.cue(e.orb ? BULLET.ORB : BULLET.EMBER, 'fanVolley', e.orb ? TELL.RED : TELL.NORMAL, tt, m.x, m.y, m.z);
}

const fanVolley = {
  name: 'fanVolley',
  cooldown: FV.cooldown,
  phases: (d) => {
    const n = (perPhase(FV.volleys, d.phase) | 0) + (perPhase(FV.orbWave, d.phase) > 0 ? 1 : 0);
    return [['windup', wind(d, FV.windup)], ['cast', n * FV.gap + 0.25], ['recovery', wind(d, FV.recovery)]];
  },
  beats: (d, a) => [beat('fanVolley', 0, a.list[0][1] + 0.4, FV, 'bullet')],
  weight: (d, s) => (s.dist >= FV.minDist && s.dist <= FV.maxDist ? wPhase(FV, d) : 0),
  start(d, a) {
    a.grp = d.bullets.group(FV.maxHits);
    a.n = perPhase(FV.volleys, d.phase) | 0;
    a.cnt = perPhase(FV.count, d.phase) | 0;
    a.orb = perPhase(FV.orbWave, d.phase) | 0;
    burstSchedule(d, a);
    a.last = -9;
    a.kick = 0;
    a.covered = false;
  },
  enter(d, a, phase) {
    if (phase === 'cast') d.emit('dragon:spell', { name: 'fanVolley', x: d.position.x, z: d.position.z });
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, k = a.k, b0 = a.beats?.[0];
    const G = mouthGeo(d, _geo);
    if (a.phase !== 'recovery') d.turnToward(s.yawTo, d.turnRate, dt);
    a.kick = Math.max(0, a.kick - dt * 7);
    plantPose(d, 0.5);
    pose.rear = 0.12;
    if (a.phase === 'windup') {
      // the neck coils back, the throat glows: the head snaps out onto the hero
      aimHead(d, s.yawTo, Math.min(reachFor(d, 2.6), 1.4 + 0.5 * k), 0.1, G.D, s.pos);
      pose.jaw = 0.2 + 0.3 * k;
      pose.swell = 0.7 * k;
      d.throat = 0.7 * k;
      charge(d, dt, k);
      if (b0 && !b0.flashed && Number.isFinite(G.D)) {
        b0.impactIn = Math.max(0.05, a.list[0][1] + Math.max(0, G.D - BK.ember.r - playerR(d.game)) / FV.speed);
      }
    } else if (a.phase === 'cast') {
      // between coughs the neck coils back and the jaw closes; each cough snaps the head out at him,
      // the jaw wide, the head kicking up
      let nextT = Infinity;
      for (const x of a.sched) {
        if (!x.done) {
          nextT = x.t;
          break;
        }
      }
      const since = a.t - a.last, until = nextT - a.t;
      const coil = since < 0.12 ? 0 : clamp(1 - until / 0.32, 0, 1);
      aimHead(d, s.yawTo, Math.max(0.6, reachFor(d, 2.6) - 0.8 * coil), -0.1 + 0.25 * coil, G.D, s.pos);
      pose.headOffset.y += a.kick * FV.recoil;
      pose.jaw = since < 0.14 ? 1 : 0.3 + 0.35 * coil;
      pose.jawRate = 22;
      d.throat = 0.6 + 0.4 * coil;
    } else {
      pose.rear = 0.12 * (1 - k);
      pose.spread[0] = pose.spread[1] = k < 0.3 ? 0.55 : REST_SPREAD;
      pose.spreadRate = 3;
      pose.restep = 1;
      d.throat = Math.max(0, 0.7 - k * 2);
    }
    headline(d, a, BULLET.EMBER);
  },
  hit(d, a) {
    if (a.phase !== 'cast') return;
    for (const e of a.sched) {
      if (e.done) continue;
      if (a.t < e.t) break;
      e.done = true;
      cough(d, a, e);
    }
    burstCue(d, a);
  },
  end(d, a, interrupted) {
    d.throat = 0;
    flush(d, a, interrupted, BULLET.EMBER);
    // P3: the burst may run straight into an Ember torrent, no idle between (the brain's queue)
    const br = d.brain;
    if (!interrupted && br?.aiEnabled && d.state === 'combat' && !br.queued && d.sense.dist <= ES.maxDist &&
      (br.cooldowns?.emberStorm ?? 0) <= 0 && Math.random() < perPhase(FV.chain, d.phase)) {
      br.queued = emberStorm;
    }
  },
};

// ------------------------------------------------------------------ wisp swarm
const wispSwarm = {
  name: 'wispSwarm',
  cooldown: WS.cooldown,
  phases: (d) => [['windup', wind(d, WS.windup)], ['cast', WS.cast], ['recovery', wind(d, WS.recovery)]],
  beats: (d, a) => [beat('wispSwarm', 0, a.list[0][1] + WS.first + 1, WS, 'bullet')],
  weight: (d, s) => (s.dist <= WS.maxDist && d.bullets.count(BULLET.WISP) <= WS.maxAlive ? wPhase(WS, d) : 0),
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
      // alternating sides, ever wider: roared out of the jaws, they hang in an arc round the head
      const yaw = d.yaw + (i & 1 ? -1 : 1) * (0.7 + 0.24 * (i >> 1));
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
    flush(d, a, interrupted, BULLET.WISP);
  },
};

// ------------------------------------------------------------------ scouring breath
/** n tongue offsets evenly over [-spread, spread] round the head's aim. */
function tongueOffs(n, spread) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(n > 1 ? -spread + (2 * spread * i) / (n - 1) : 0);
  return out;
}

/** Body turn rate (rad/s, signed) u s into the cast of `dur` s: ramp, sweep, pause + reversal, fade. */
function scourRate(a, u, dur) {
  const rv = FW.reverseAt * dur;
  let om;
  if (u < rv) om = a.dir * FW.speed * smoothstep(0, FW.ramp, u);
  else if (u < rv + FW.pause) om = 0; // the head stops: the reversal's telegraph
  else om = -a.dir * FW.speed * smoothstep(rv + FW.pause, rv + FW.pause + FW.ramp, u);
  return om * (1 - smoothstep(dur - 0.4, dur, u));
}

const fireWheel = {
  name: 'fireWheel',
  cooldown: FW.cooldown,
  phases: (d) => [['windup', wind(d, FW.windup)], ['cast', perPhase(FW.dur, d.phase)], ['recovery', wind(d, FW.recovery)]],
  beats: (d, a) => [beat('fireWheel', 0, a.list[0][1] + 1, FW, 'mouth')],
  weight: (d, s) => (s.dist <= FW.maxDist ? wPhase(FW, d) : 0),
  start(d, a) {
    const pt = d.rig.pt;
    a.n = Math.max(1, perPhase(FW.tongues, d.phase) | 0);
    a.spread = perPhase(FW.spread, d.phase);
    a.dir = Math.random() < 0.5 ? 1 : -1;
    // the wedge catches beside the hero (its leading tongue FW.lead short of him) and sweeps onto him
    a.yaw0 = d.sense.yawTo - a.dir * (a.spread + FW.lead);
    a.om = 0;
    a.u = 0;
    a.swept = 0;
    a.breathing = false;
    d.bullets.startWheel({
      attack: 'fireWheel', x: pt.mouth.x, z: pt.mouth.z, n: a.n, offs: tongueOffs(a.n, a.spread), ang: headYaw(d), dir: a.dir,
      warn: a.list[0][1], dur: a.list[1][1], speed: FW.speed, r0: FW.r0, r1: FW.r1, width: FW.width,
      damage: FW.damage, burn: FW.burn, knockback: FW.knockback, max: FW.maxHits, headline: true,
    });
  },
  enter(d, a, phase) {
    if (phase === 'cast') {
      d.emit('dragon:spell', { name: 'fireWheel', x: d.position.x, z: d.position.z });
      d.emit('dragon:breathStart');
      a.breathing = true;
      d.game.shake?.(0.3);
    } else if (phase === 'recovery' && a.breathing) {
      a.breathing = false;
      d.emit('dragon:breathEnd');
    }
  },
  update(d, a, dt) {
    const pose = d.pose, k = a.k, b0 = a.beats?.[0], w = d.bullets.wheel;
    const G = mouthGeo(d, _geo);
    if (b0 && !b0.flashed) {
      if (a.phase === 'windup') {
        // the leading tongue's angle to run onto the hero, at the ramped speed
        const lead = a.yaw0 + a.dir * a.spread;
        if (Number.isFinite(G.D) && G.D > 0.5) {
          const gap = a.dir * angleDiff(lead, G.th);
          const half = Math.asin(Math.min(1, (FW.width / 2 + playerR(d.game) / 2) / G.D));
          b0.impactIn = Math.max(0.05, a.list[0][1] + 0.5 * FW.ramp + Math.max(0.1, gap - half) / FW.speed);
        }
      } else if (w.on && Number.isFinite(w.tt) && w.tt >= 0) b0.impactIn = Math.max(0.05, a.T - b0.at + w.tt);
    } else if (w.headline) {
      w.headline = false; // from here on the wheel cues its own tongues
      w.cueT = d.bullets.time;
    }
    if (a.phase === 'windup') {
      // turns to aim beside the hero, crouches, the head reaches low: the throat charges
      d.turnToward(a.yaw0, d.turnRate, dt);
      plantPose(d, k);
      aimHead(d, a.yaw0, FW.reach - 0.6 * (1 - k), FW.dy + 0.3 * (1 - k), FW.strike);
      pose.jaw = 0.3 + 0.5 * k;
      pose.swell = k;
      d.throat = k;
      charge(d, dt, k);
    } else if (a.phase === 'cast') {
      // the breath strikes the ground; the body turns it round (the head held straight on)
      a.u += dt;
      a.om = scourRate(a, a.u, a.list[1][1]);
      a.swept += Math.abs(a.om) * dt;
      d.yaw = wrapAngle(d.yaw + a.om * dt);
      pose.bodyRate = 12;
      plantPose(d, 1);
      aimHead(d, d.yaw, FW.reach, FW.dy, FW.strike);
      pose.jaw = 0.95;
      pose.swell = 1;
      d.throat = 1;
    } else {
      a.om = 0;
      plantPose(d, 1 - k);
      settlePose(d, k);
    }
  },
  // (after the rig: the tongues ride the head as drawn; their root is the mouth's ground projection)
  hit(d, a, dt) {
    const pt = d.rig.pt, m = pt.mouth, f = pt.headFwd;
    d.bullets.aimWheel(m.x, m.z, headYaw(d), a.phase === 'cast' ? a.om : 0, d.position.x, d.position.z);
    if (a.phase === 'cast') {
      const fl = Math.hypot(f.x, f.z) || 1;
      BFX.breathBeam(d.fx, m, m.x + (f.x / fl) * FW.strike, m.z + (f.z / fl) * FW.strike, dt);
    }
  },
  end(d, a, interrupted) {
    d.throat = 0;
    d.bullets.stopWheel();
    if (a.breathing) {
      a.breathing = false;
      d.emit('dragon:breathEnd');
    }
    flush(d, a, interrupted);
  },
};

export const BULLET_HELL = { emberStorm, fanVolley, wispSwarm, fireWheel };
