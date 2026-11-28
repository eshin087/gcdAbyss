import { TUNING } from './tuning.js';
import { BROOD } from './tuningBrood.js';
import { roarFx, roarPose, perPhase } from './attacks.js';

// The roar-cast moves that call up the brood (ADR-197): drakelings, wisps. Same contract as
// fireAttacks.js (phases / beats / weight / start / enter / update / hit / end); numbers in
// tuningBrood.js. Spread into ATTACKS (attacks.js).
//
// Both open with the incantation (incantation.js): the wyrm rears and charges while the circle is
// written, then ROARS (roarFx / roarPose) and the circle flashes as the spell releases. The moves
// themselves strike nothing (no beats): the brood they call up strikes, each blow with its own tell
// (brood.js). Neither is picked while a brood lives; their cooldowns make them events.
//   drakelings  a seal on the ground round its feet; 3 - 5 drakelings burst out of it on the hero's
//               side (phase 2+)
//   wisps       a seal hanging before its jaws; burning wisps swell on its spine and wings through
//               the roar and tear off one by one (late phase 1: below `lateP1` of its life; then on)

const M = BROOD.moves, MD = M.drakelings, MW = M.wisps;
const wind = (d, base) => base * (d.tScale ?? 1);
const _p = { x: 0, y: 0, z: 0 };
const _pts = new Float32Array(32 * 3);
const _ord = new Int32Array(32);
const live = (d) => (d.brood?.count?.() ?? 0) > 0;

/** The charge before a roar-cast spell: it rises tall on straight forelegs, chest swelling, wings
 *  spread and trembling, the head lifting, the throat's lava filling (the phase roar's windup). */
function chargePose(d, a, k, dt) {
  const pose = d.pose, s = d.sense;
  d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
  pose.head = d.rootPt(pose.headTarget, 0, 5.4 + 0.8 * k, 2.6);
  pose.headRate = 4;
  pose.spread[0] = pose.spread[1] = 0.7 + 0.3 * k;
  pose.spreadRate = 3;
  pose.flap = 0.1 * k;
  pose.flapHz = 6;
  pose.jaw = 0.15 + 0.35 * k;
  pose.pitch = -0.08;
  pose.lower = -0.1 * k;
  pose.swell = k;
  d.throat = k;
}

function recoverPose(d, k) {
  const pose = d.pose;
  pose.spread[0] = pose.spread[1] = k < 0.4 ? 0.7 : TUNING.rest.spread;
  pose.spreadRate = 3;
  pose.jaw = 0.2 * (1 - k);
  pose.restep = 1;
  d.throat = Math.max(0, 1 - k * 3);
}

// ------------------------------------------------------------------ fire drakelings
const drakelings = {
  name: 'drakelings',
  label: MD.label,
  tell: MD.tell,
  phase: MD.phase,
  category: MD.category,
  cooldown: MD.cooldown,
  phases: (d) => [['windup', wind(d, MD.windup)], ['cast', MD.cast], ['recovery', wind(d, MD.recovery)]],
  beats: () => [],
  weight: (d) => (live(d) ? 0 : perPhase(MD.weight, d.phase)),
  start(d, a) {
    a.n = Math.max(1, perPhase(BROOD.drakeling.count, d.phase) | 0);
    a.spawned = 0;
    a.cid = d.incantation?.cast?.({ r: MD.r, dur: a.list[0][1] + MD.cast + 0.9, kind: 'ground', under: true }) ?? 0;
    d.emit('dragon:spell', { name: 'drakelings', x: d.position.x, z: d.position.z });
  },
  enter(d, a, phase) {
    if (phase !== 'cast') return;
    roarFx(d, 0.9);
    d.incantation?.flare?.(a.cid, 1);
    // the sigils nearest the hero are where they burst out
    const p = d.game.player?.position, I = d.incantation, ns = BROOD.incant.sigils;
    let m = 0;
    for (let i = 0; i < ns && i < 32; i++) {
      if (!I?.point?.(a.cid, i, ns, _p)) break;
      _pts[i * 3] = _p.x;
      _pts[i * 3 + 1] = _p.y;
      _pts[i * 3 + 2] = _p.z;
      _ord[m++] = i;
    }
    if (p && m > 1) {
      // (a small sort by distance to the hero: no allocation)
      for (let i = 1; i < m; i++) {
        const v = _ord[i], dv = Math.hypot(_pts[v * 3] - p.x, _pts[v * 3 + 2] - p.z);
        let j = i - 1;
        while (j >= 0 && Math.hypot(_pts[_ord[j] * 3] - p.x, _pts[_ord[j] * 3 + 2] - p.z) > dv) {
          _ord[j + 1] = _ord[j];
          j--;
        }
        _ord[j + 1] = v;
      }
    }
    a.m = m;
  },
  update(d, a, dt) {
    if (a.phase === 'windup') {
      chargePose(d, a, a.k, dt);
      d.incantation?.flare?.(a.cid, Math.min(0.95, a.k));
      d.fx.mouthEmbers?.(dt, d.rig.pt.mouth, 30 * a.k, d.rig.pt.headFwd);
    } else if (a.phase === 'cast') {
      roarPose(d, a, 1);
      d.throat = 1;
      // they burst out one after another (0.09 s apart), from the sigils on his side of the circle
      while (a.spawned < a.n && a.t >= a.spawned * 0.09) {
        const i = a.m > 0 ? _ord[(a.spawned * 2) % a.m] : 0; // (every other sigil: they spread out)
        const ok = a.m > 0;
        const x = ok ? _pts[i * 3] : d.position.x + Math.sin(d.yaw) * MD.r;
        const z = ok ? _pts[i * 3 + 2] : d.position.z + Math.cos(d.yaw) * MD.r;
        const p = d.game.player?.position;
        const slot = p ? Math.atan2(z - p.z, x - p.x) : 0;
        d.brood?.spawn?.('drakeling', { x, y: 0.8, z, slot, life: BROOD.drakeling.life + a.spawned * BROOD.drakeling.lifeStep });
        a.spawned++;
      }
    } else {
      recoverPose(d, a.k);
    }
  },
  end(d, a) {
    d.throat = 0;
    d.incantation?.end?.(a.cid);
    if (d.brood && a.spawned > 0) d.brood.nextLunge = d.brood.time + BROOD.drakeling.firstLunge;
  },
};

// ------------------------------------------------------------------ kamikaze wisps
// the body points they ride (brood._bodyPt): the wing wrists and tips first, the spine between
const WISP_SRC = [1, 2, 5, 6, 3, 0, 4, 7];
const wisps = {
  name: 'wisps',
  label: MW.label,
  tell: MW.tell,
  phase: MW.phase,
  category: MW.category,
  cooldown: MW.cooldown,
  phases: (d) => [['windup', wind(d, MW.windup)], ['cast', MW.cast], ['recovery', wind(d, MW.recovery)]],
  beats: () => [],
  weight: (d, s) => {
    if (live(d) || !(s?.dist >= MW.minDist)) return 0;
    if ((d.phase ?? 1) <= 1) return d.hp <= d.maxHp * MW.lateP1[0] ? MW.lateP1[1] : 0;
    return perPhase(MW.weight, d.phase);
  },
  start(d, a) {
    // (on the ground under it, like every cast: the seal that hung before its jaws followed the head
    // about beside it like a thing of its own; the owner, 2026-11-28)
    a.cid = d.incantation?.cast?.({ r: MW.r, dur: a.list[0][1] + MW.cast + 0.4, kind: 'ground', under: true }) ?? 0;
    const n = Math.max(1, perPhase(BROOD.wisp.count, d.phase) | 0), W = a.list[0][1];
    // they swell on the body through the charge and tear off one by one from the roar on
    for (let i = 0; i < n; i++) {
      const delay = Math.max(0, W - BROOD.wisp.gather + i * BROOD.wisp.gap - (i < 2 ? 0.25 * (2 - i) : 0));
      d.brood?.spawn?.('wisp', { src: WISP_SRC[i % WISP_SRC.length], delay });
    }
    d.emit('dragon:spell', { name: 'wisps', x: d.position.x, z: d.position.z });
  },
  enter(d, a, phase) {
    if (phase !== 'cast') return;
    roarFx(d, 0.75);
    d.incantation?.flare?.(a.cid, 1);
  },
  update(d, a, dt) {
    if (a.phase === 'windup') {
      chargePose(d, a, a.k, dt);
      d.incantation?.flare?.(a.cid, Math.min(0.95, a.k));
      // its body smoulders where the wisps will tear off
      d.fx.bodyEmbers?.(dt, d.hurtSpheres, 60 * a.k, false);
    } else if (a.phase === 'cast') {
      roarPose(d, a, 0.85);
      d.throat = 1;
    } else recoverPose(d, a.k);
  },
  end(d, a) {
    d.throat = 0;
    d.incantation?.end?.(a.cid);
  },
};

export const BROOD_MOVES = { drakelings, wisps };
