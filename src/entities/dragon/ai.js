import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { ATTACKS, PHASE2_ROAR, PHASE3_ROAR, roarFx, roarPose, perPhase } from './attacks.js';
import { resetPose } from './rig/anim.js';
import { POSTURE } from '../../combat/rules.js';
import { clamp, damp, angleDiff, lerp, smoothstep } from '../../core/math.js';

// Boss brain: owns the action runner (attacks + scripted sequences, tell beats) and the combat
// decision loop. Acts only while game.state === 'boss' and the AI is enabled; otherwise idles /
// faces the player / taunts their corpse. Lab triggers (debug.trigger) bypass the decision loop.

const S = SCALE;
const REST = TUNING.rest; // resting body language (wings HALF, jaw open)
const rand = (a, b) => a + Math.random() * (b - a);
const ATTACK_NAMES = new Set(Object.keys(ATTACKS));
const NO_BEATS = [];
const PL = TUNING.plunged;

// ------------------------------------------------------------------ death performance
// A timed collapse (s since the killing blow) instead of one smoothed blend, so the parts land one
// after another: a throe (reared, head flung back, jaw wide, wings flared), the front buckles, the
// body falls ACCELERATING onto its right side (pose.dead = u², the roll and the drop ride on it),
// the chest hits the ground (thud, rebound), the wings crumple (the upper one draped half-open,
// the lower one folded under), the head slaps down last, one last heave of the chest. The feet stay
// where they stand (the rig locks them while dying), so no leg swings through the body.
const DEATH = {
  collapse: 2.5, // the 'collapse' phase (then 'dissolve')
  fall0: 0.3, // the legs give way
  fall1: 1.1, // the chest hits the ground (the thud)
  head0: 0.34, // the head starts to fall from the throe
  head1: 1.22, // the head hits the ground
  breath: [1.75, 2.9], // the last heave of the chest
};
function deathPose(d, a, T) {
  const pose = d.pose;
  const u = clamp((T - DEATH.fall0) / (DEATH.fall1 - DEATH.fall0), 0, 1);
  pose.dead = u * u;
  pose.stateRate = 40; // s.dead follows the curve (the fall accelerates into its impact)
  const throe = smoothstep(0, 0.12, T) * (1 - smoothstep(0.26, 0.52, T));
  const front = smoothstep(0.22, 0.68, T) * (1 - smoothstep(0.95, 1.55, T));
  const tb = T - DEATH.fall1;
  const bounce = tb > 0 && tb < 0.3 ? Math.sin((Math.PI * tb) / 0.3) : 0;
  pose.lower = -0.2 * throe + 0.38 * front - 0.14 * bounce;
  pose.pitch = -0.12 * throe + 0.3 * front + 0.04 * u;
  pose.roll = 0.06 * bounce - 0.3 * u; // (the rig rolls a dead body 0.75 rad: it settles leaning 0.45 onto its right side)
  pose.bodyRate = 16;
  pose.elbowsOut = Math.max(front, u);
  pose.restep = 0;
  pose.swell = T > DEATH.breath[0] && T < DEATH.breath[1] ? 0.85 * Math.sin((Math.PI * (T - DEATH.breath[0])) / (DEATH.breath[1] - DEATH.breath[0])) : 0;
  // head: flung up and back in the throe, then it falls (accelerating) to the ground ahead and to the
  // right of the chest, a small bounce on landing; the neck follows it down
  if (!a.head0Set) {
    a.head0Set = true;
    d.rootPt(a.head0, 0, 6.1, 2.1);
    d.rootPt(a.head1, -2.4, 0.72, 4.3);
  }
  const v = clamp((T - DEATH.head0) / (DEATH.head1 - DEATH.head0), 0, 1);
  const th = T - DEATH.head1;
  const hb = th > 0 && th < 0.24 ? Math.sin((Math.PI * th) / 0.24) : 0;
  pose.head = pose.headTarget.lerpVectors(a.head0, a.head1, Math.pow(v, 1.3));
  pose.head.y += 0.32 * S * hb;
  pose.headRate = T < DEATH.head0 ? 6.5 : 24;
  pose.lookDown = 1.0;
  d.rootPt(pose.look, -5.5, 0, 9.5); // (far ahead: a target the falling head passes over flipped its aim)
  pose.jaw = T < 0.5 ? 1 : lerp(0.8, 0.42, smoothstep(0.5, 1.8, T));
  pose.jawRate = 14;
  pose.eyes = T < 0.35 ? 1 : Math.max(0, 1 - (T - 0.35) / 1.3);
  // wings: a flare in the throe, then they crumple onto the ground (pose.drape, world space): the
  // lower (right) one splayed out flat beside the body, the upper one half-draped over the flank
  if (T < 0.24) {
    pose.spread[0] = pose.spread[1] = 0.8;
    pose.spreadRate = 9;
  } else {
    pose.spread[0] = 0.35;
    pose.spread[1] = 0.25;
    pose.spreadRate = 2.6;
    pose.drape[0] = 0.72;
    pose.drape[1] = 1;
  }
  pose.tailWave = 0;
}

// ------------------------------------------------------------------ scripted sequences
export const SEQ = {
  intro: {
    name: 'intro',
    phases: () => [['wake', 1.0], ['rise', 1.3], ['roar', 1.3], ['settle', 0.4]],
    start(d, a) {
      d.state = 'waking';
      a.snorted = false;
      d.emit('dragon:wake');
    },
    enter(d, a, phase) {
      if (phase === 'roar') roarFx(d, 1);
    },
    update(d, a, dt) {
      const pose = d.pose, s = d.sense;
      pose.eyes = 1;
      if (a.phase === 'wake') {
        pose.sleep = 0.7;
        pose.stateRate = 1.5;
        if (!a.snorted && a.t > 0.25) {
          a.snorted = true;
          d.fx.snort(d.rig.pt.nostrils, d.rig.pt.headFwd, 1.4);
        }
      } else if (a.phase === 'rise') {
        pose.sleep = 0;
        pose.stateRate = 2.4;
        d.turnToward(s.yawTo, 1.3, dt);
        pose.speed = 1.5;
        pose.spread[0] = pose.spread[1] = 0.5 * a.k; // wings rise to the mantled HALF pose
        pose.spreadRate = 2.5;
        pose.jaw = 0.35;
      } else if (a.phase === 'roar') {
        d.turnToward(s.yawTo, 0.8, dt);
        roarPose(d, a, 1);
      } else {
        pose.spread[0] = pose.spread[1] = 0.5;
        pose.spreadRate = 3;
        pose.jaw = 0.35;
      }
    },
    end(d, a, interrupted) {
      if (!interrupted && d.state === 'waking') d.brain.beginCombat();
    },
  },

  /** Ordinary short stagger (Lab button, charging head-first into a stone). */
  stagger: {
    name: 'stagger',
    phases: () => [['stagger', TUNING.stagger.time]],
    start(d) {
      d.state = 'staggered';
      d.throat = 0;
      d.emit('dragon:stagger');
      d.game.shake?.(0.25);
    },
    update(d, a) {
      // the front collapses onto buckling forelegs (chest down, hips up, hind legs braced wide), neck
      // limp and low, wings drooping half-open to the ground
      const pose = d.pose;
      const rec = a.k > 0.78;
      pose.stagger = rec ? 0 : 1;
      pose.lower = rec ? 0.2 : 0.35;
      pose.pitch = rec ? 0.05 : 0.24;
      pose.bodyRate = 4;
      pose.elbowsOut = rec ? 0.2 : 0.85;
      pose.stanceH = 0.2;
      pose.restep = 1;
      pose.jaw = rec ? 0.1 : 0.35;
      pose.eyes = 0.45;
      pose.spread[0] = pose.spread[1] = rec ? 0.3 : 0.35;
      pose.spreadRate = 2;
      pose.droop = rec ? 0 : 0.75;
      pose.tailWave = 0.02;
      pose.lookDown = 0.8;
      d.rootPt(pose.look, Math.sin(d.time * 1.3) * 1.5, 0, 9);
    },
    end(d) {
      if (d.state === 'staggered' && !d.broken) d.state = 'combat';
    },
  },

  /** Posture break: head slumps to the ground in front, open to crits for POSTURE.breakTime. */
  postureBreak: {
    name: 'postureBreak',
    phases: () => [['break', POSTURE.breakTime]],
    start(d) {
      d.state = 'staggered';
      d.broken = true;
      d.throat = 0;
      d.posture = d.maxPosture;
      d.brain.pendingBreak = false;
      d.emitPosture(true);
      d.emit('dragon:postureBreak');
      d.game.shake?.(0.35);
      d.hitstop(0.1, 0.05);
      const h = d.rig.pt.head;
      d.fx.breakBurst(h.x, h.y, h.z);
    },
    update(d, a, dt) {
      const pose = d.pose;
      const rec = a.k > 0.86; // last ~0.45 s: pull the head back up
      // the meter drains over the break: a visible timer for the punish window
      d.posture = d.maxPosture * (1 - a.k);
      d.emitPosture();
      // the front collapses: chest dropped onto buckled forelegs (elbows out) while the hips stay up
      // on braced hind legs; the neck goes limp, the head on the ground in front within sword reach;
      // the wings droop half-open with their tips on the ground; the tail lies limp
      pose.stagger = rec ? 0.3 : 1;
      pose.lower = rec ? 0.25 : 0.42;
      pose.pitch = rec ? 0.08 : 0.32;
      pose.bodyRate = rec ? 3 : 5;
      pose.elbowsOut = rec ? 0.3 : 1;
      pose.stanceH = 0.25;
      pose.restep = 1;
      if (!rec) {
        pose.head = d.rootPt(pose.headTarget, 0, 0.75, 4.8);
        pose.headRate = a.t < 0.4 ? 5 : 2.5;
        pose.headOffset.y += Math.sin(d.time * 2.1) * 0.05 * S;
      } else pose.headRate = 3;
      d.rootPt(pose.look, Math.sin(d.time * 0.9) * 1.2, 0, 9);
      pose.lookRate = 2;
      pose.lookDown = 1.0; // head slumped to the ground
      pose.jaw = rec ? 0.15 : 0.45;
      pose.eyes = rec ? 0.7 : 0.3;
      pose.spread[0] = pose.spread[1] = rec ? 0.3 : 0.35;
      pose.spreadRate = 2;
      pose.droop = rec ? 0 : 1;
      pose.tailWave = 0;
      if (!rec) d.fx.stunStars(dt, d.rig.pt.head);
    },
    end(d) {
      d.broken = false;
      d.posture = 0;
      d.postureTimer = 0;
      d.emitPosture(true);
      if (d.state === 'staggered') d.state = 'combat';
    },
  },

  /** Parried: the attack is cancelled, the head snaps back (punish window). */
  recoil: {
    name: 'recoil',
    phases: () => [['recoil', TUNING.recoilTime]],
    start(d, a) {
      d.throat = 0;
      // where the parry caught the head, and where the blow throws it (up and back over the withers)
      a.h0 = new THREE.Vector3().copy(d.rig.pt.head);
      a.h1 = new THREE.Vector3();
      // a foot caught mid-step by the parry plants where it is: its home (led far ahead by the lunge)
      // swings back with the recoil's slide, and the swing used to land there, metres back, in one frame
      const G = d.rig.gait;
      for (let i = 0; i < 4; i++) if (G.limbs[i].stepping) G.plantAt(i, G.limbs[i].pos);
    },
    update(d, a, dt) {
      // head and shoulders snap back, the forefeet hop back once (the body slides back a little)
      const pose = d.pose, f = d.fwd;
      const e = 1 - a.k * a.k; // snap back, ease out
      // the head is thrown back along a smooth arc (out of the caught position, up and back in
      // ~0.2 s, a dazed shake), then released to the stance. It used to chase an offset from the
      // rest shape while that shape blended in: the neck chain flipped between solutions, the head
      // jumping 2.7 m and the neck tip turning 137° in one frame
      if (a.k < 0.72) {
        d.rootPt(a.h1, 0, 5.4, 1.9);
        const u = 1 - Math.pow(1 - Math.min(1, a.k / 0.36), 3); // ease-out
        pose.head = pose.headTarget.lerpVectors(a.h0, a.h1, u);
        const daze = a.k > 0.3 ? Math.sin((a.k - 0.3) * 30) * (1 - (a.k - 0.3) / 0.42) * 0.22 * S : 0;
        pose.head.x += d.fwd.z * daze;
        pose.head.z -= d.fwd.x * daze;
        pose.headRate = 20;
      } else pose.headRate = 4;
      pose.jaw = 0.55 * e + 0.1;
      pose.jawRate = 20;
      pose.pitch = -0.14 * e;
      pose.lower = -0.1 * e;
      pose.bodyRate = 8;
      pose.rear = a.k < 0.45 ? 0.55 * Math.sin((Math.PI * a.k) / 0.45) : 0;
      if (a.k < 0.35) d.moveForward(-1.4 * S * (1 - a.k / 0.35), dt);
      pose.eyes = 0.8;
      pose.spread[0] = pose.spread[1] = REST.spread + 0.15 * e;
      if (a.k > 0.6) d.turnToward(d.sense.yawTo, d.turnRate * 0.4, dt);
    },
  },

  phase2: PHASE2_ROAR,
  phase3: PHASE3_ROAR,

  /**
   * Plunged (contract 2): the hero's head-stab slams the head down to the ground, it thrashes, then it
   * rises. Airborne it first falls (`fall`) and crash-lands (dust ring, shake), then the same. An
   * execution on a broken wyrm (`heavy`) is heavier and longer. The head stays on its joints (the
   * hero rides Dragon.plungePoint) the whole time. Options come from Brain.plunged().
   */
  plunged: {
    name: 'plunged',
    phases: (d) => {
      const o = d.brain.plungeOpts ?? {};
      const X = o.heavy ? PL.exec : PL;
      const list = [];
      // the fall takes longer from higher up (~0.6 s from 8 m)
      if (o.air) list.push(['fall', PL.fall * clamp(Math.sqrt(Math.max(0.5, o.alt ?? 0) / 8), 0.6, 1.3)]);
      list.push(['slam', X.slam], ['thrash', X.thrash], ['rise', X.rise]);
      return list;
    },
    start(d, a) {
      const o = d.brain.plungeOpts ?? {};
      a.air = !!o.air;
      a.alt0 = Math.max(0, o.alt ?? 0);
      a.heavy = !!o.heavy;
      a.slammed = false;
      a.crashed = false;
      a.side = Math.random() < 0.5 ? -1 : 1; // which way the thrash starts
      d.throat = 0;
      if (!a.air) d.state = 'staggered';
      // a foot caught mid-step plants where it is (as the recoil does)
      const G = d.rig.gait;
      for (let i = 0; i < 4; i++) if (G.limbs[i].stepping) G.plantAt(i, G.limbs[i].pos);
    },
    enter(d, a, phase) {
      if (phase !== 'slam' || !a.air || a.crashed) return;
      // the crash landing: the whole body hits the ground
      a.crashed = true;
      const g = d.game, p = d.position;
      d.state = 'staggered';
      d.emit('dragon:land', { x: p.x, z: p.z });
      g.shake?.(PL.crashShake);
      g.world?.gust?.(p.x, p.z, 2.0, 20 * S);
      d.fx.dustRing(p.x, p.z, 2.4 * S, 60, 1.6);
      d.hitstop(0.07);
    },
    update(d, a, dt) {
      const pose = d.pose, t = d.time;
      pose.eyes = 0.65;
      pose.lookDown = 1.2;
      pose.tailLift = 0;
      if (a.phase === 'fall') {
        // knocked out of the air: the wings flail lopsided, the nose pitches down, the legs reach
        const u = a.k;
        pose.alt = a.alt0 * (1 - u * u);
        pose.airborne = u < 0.7 ? 1 : 0.3;
        pose.airReach = u > 0.45 ? 1 : 0;
        pose.spread[0] = 0.9;
        pose.spread[1] = 0.55;
        pose.spreadRate = 7;
        pose.flap = 0.45;
        pose.flapHz = 3.4;
        pose.pitch = 0.28 + 0.08 * Math.sin(t * 9);
        pose.roll = 0.16 * Math.sin(t * 6.5);
        pose.bodyRate = 7;
        pose.head = d.rootPt(pose.headTarget, 0, 2.4, 4.4);
        pose.headRate = 9;
        pose.jaw = 0.85;
        pose.tailWave = 0.25;
        return;
      }
      const heavy = a.heavy;
      if (a.phase === 'slam') {
        // the head is driven into the ground in front, the forelegs buckle, the wings fling up
        pose.head = d.rootPt(pose.headTarget, 0.25 * a.side, heavy ? 0.5 : 0.6, heavy ? 4.3 : 4.5);
        pose.headRate = heavy ? 18 : 15;
        pose.lower = heavy ? 0.55 : 0.45;
        pose.pitch = heavy ? 0.4 : 0.34;
        pose.bodyRate = 12;
        pose.elbowsOut = 0.9;
        pose.jaw = 0.85;
        pose.jawRate = 20;
        pose.spread[0] = pose.spread[1] = 0.85;
        pose.spreadRate = 10;
        pose.tailWave = 0.2;
        pose.stanceH = 0.3;
        if (!a.slammed && a.k > 0.5) {
          a.slammed = true;
          const h = d.rig.pt.head;
          d.fx.dustRing(h.x, h.z, 1.2 * S, 26, 1.0);
          d.emit('dragon:step', { x: h.x, z: h.z, heavy: true });
          d.game.shake?.(heavy ? 0.45 : 0.3);
        }
      } else if (a.phase === 'thrash') {
        // pinned and furious: the head thrashes side to side on the ground, the jaw snaps, the wings
        // beat erratically, the body rocks; an execution weakens as it goes
        const w = heavy ? 1 - a.k * 0.85 : 1 - a.k * 0.5;
        const sw = Math.sin(a.t * 14.5) * a.side;
        pose.head = d.rootPt(pose.headTarget, sw * 1.35 * w, 0.62 + Math.abs(Math.sin(a.t * 9.2)) * 0.55 * w, 4.4);
        pose.headRate = 11;
        pose.jaw = 0.35 + 0.5 * Math.abs(Math.sin(a.t * 12.5)) * w;
        pose.jawRate = 26;
        pose.lower = heavy ? 0.5 : 0.42;
        pose.pitch = heavy ? 0.36 : 0.32;
        pose.roll = 0.09 * sw * w;
        pose.bodyRate = 8;
        pose.elbowsOut = 0.8;
        pose.spread[0] = pose.spread[1] = 0.7;
        pose.spreadRate = 6;
        pose.flap = 0.32 * w;
        pose.flapHz = 3.6;
        pose.tailWave = 0.32 * w;
        pose.stanceH = 0.3;
        d.fx.stunStars(dt, d.rig.pt.head);
      } else {
        // it tears the head free and rises, shaking it
        const e = smoothstep(0, 1, a.k);
        pose.head = d.rootPt(pose.headTarget, Math.sin(a.t * 11) * 0.4 * (1 - e), lerp(0.7, 4.6, e), lerp(4.4, 3.3, e));
        pose.headRate = 6;
        pose.lookDown = lerp(1.2, 0.6, e);
        pose.jaw = 0.3;
        pose.lower = 0.42 * (1 - e);
        pose.pitch = 0.32 * (1 - e);
        pose.bodyRate = 5;
        pose.elbowsOut = 0.8 * (1 - e);
        pose.spread[0] = pose.spread[1] = lerp(0.7, REST.spread, e);
        pose.spreadRate = 4;
        pose.restep = 1;
        pose.tailLift = e > 0.6 ? 1 : 0;
      }
    },
    end(d) {
      if (d.state === 'airborne' || (d.state === 'staggered' && !d.broken)) d.state = 'combat';
    },
  },

  taunt: {
    name: 'taunt',
    phases: () => [['windup', 0.6], ['roar', 1.3], ['recovery', 0.6]],
    enter(d, a, phase) {
      if (phase === 'roar') roarFx(d, 0.7);
    },
    update(d, a, dt) {
      const pose = d.pose;
      d.turnToward(d.sense.yawTo, d.turnRate * 0.5, dt);
      pose.spread[0] = pose.spread[1] = 0.5;
      if (a.phase === 'windup') {
        pose.head = d.rootPt(pose.headTarget, 0, 6.0, 2.6);
        pose.headRate = 4;
        pose.jaw = 0.25;
      } else if (a.phase === 'roar') roarPose(d, a, 0.6);
      else pose.jaw = 0.35;
    },
  },

  /** Lab trigger prelude: turn quickly toward the player (or away, for the tail) then attack. */
  face: {
    name: 'face',
    phases: () => [['turn', TUNING.forceTurn.maxTime]],
    update(d, a, dt) {
      const want = d.sense.yawTo + (a.away ? Math.PI : 0);
      d.turnToward(want, TUNING.forceTurn.rate, dt);
      d.pose.speed = Math.max(d.pose.speed, 3);
      // turning away = the tail sweep's prelude: its tail is already the measured v0.4 solve
      if (a.away) d.pose.tailLegacy = true;
      if (Math.abs(angleDiff(d.yaw, want)) < 0.12) a.finish = true;
    },
  },

  death: {
    name: 'death',
    phases: () => [['collapse', 2.5], ['dissolve', 2.5]],
    start(d, a) {
      d.state = 'dying';
      d.throat = 0;
      d.glowTarget = 0.85;
      a.thud = false;
      a.headThud = false;
      a.noShadow = false;
      a.head0 = new THREE.Vector3();
      a.head1 = new THREE.Vector3();
      d.emit('dragon:death');
      d.hitstop(0.12, 0.05);
    },
    update(d, a, dt) {
      const pose = d.pose, g = d.game;
      deathPose(d, a, a.phase === 'collapse' ? a.t : DEATH.collapse + a.t);
      if (a.phase === 'collapse') {
        // the chest hits the ground (the end of the fall: DEATH.fall1)
        if (!a.thud && a.t > DEATH.fall1) {
          a.thud = true;
          g.shake?.(0.4);
          const c = d.rig.pt.chest;
          g.world?.gust?.(c.x, c.z, 1.2, 14 * S);
          d.fx.dustRing(c.x, c.z, 2.5 * S, 44, 1.0);
        }
        // a beat later the head slaps down, last
        if (!a.headThud && a.t > DEATH.head1) {
          a.headThud = true;
          g.shake?.(0.15);
          const h = d.rig.pt.head;
          d.fx.dustRing(h.x, h.z, 1.1 * S, 18, 0.6);
        }
        d.fx.bodyEmbers(dt, d._hurtPool, 30 + a.k * 60, false);
      } else {
        d.dissolve = a.k;
        d.fx.bodyEmbers(dt, d._hurtPool, 220 * (1 - a.k * 0.6), true);
        if (!a.noShadow && a.k > 0.4) {
          a.noShadow = true;
          d.setShadowCasting(false);
        }
      }
    },
    end(d, a, interrupted) {
      if (!interrupted) d.finishDeath();
    },
  },
};

// actions a posture break / ordinary stagger may NOT interrupt (a break waits for the plunge reaction)
const NO_BREAK = new Set(['intro', 'phase2', 'phase3', 'death', 'stagger', 'postureBreak', 'taunt', 'plunged']);
/** Actions a plunge (contract 2) may NOT cancel: the damage still lands, the reaction doesn't play. */
export const NO_PLUNGE = new Set(['intro', 'phase2', 'phase3', 'death']);
// a pending phase transition waits for these to end
const NO_TRANSITION = new Set(['intro', 'phase2', 'phase3', 'death', 'plunged']);

/**
 * Selection weight of any ATTACKS entry, generic (the dragon-fire attacks register with the same
 * fields): `phase` = first phase (on the def or TUNING.attacks[name]), `weight` = a number, a
 * per-phase array [P1, P2, P3] or a function of (d, sense) returning either, `air` = usable while
 * airborne (ground attacks never are). 0 = not now.
 */
export function attackWeight(def, name, d, s) {
  const spec = TUNING.attacks[name];
  if ((d.phase ?? 1) < (def.phase ?? spec?.phase ?? 1)) return 0;
  if (d.state === 'airborne' && !def.air) return 0;
  let w = def.weight ?? spec?.weight;
  if (typeof w === 'function') w = w(d, s);
  w = perPhase(w, d.phase);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

export class Brain {
  constructor(d) {
    this.d = d;
    this.action = null;
    this.aiEnabled = true; // Lab: off = stays in combat, tracks the player, never attacks by itself
    this._cands = [];
    this._zone = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.queued = null;
    if (this.action) this.stopAction(true);
    this.cooldowns = {};
    this.history = [];
    this.idleTimer = 1.0;
    this.pendingPhase = 0; // the phase to transition into once allowed (0 = none)
    this.pendingBreak = false;
    this.plungeOpts = null;
    this.sleepPuff = rand(1.5, 3);
    this.snortTimer = rand(3, 6);
    this.jawTwitch = 0;
    this.tauntTimer = 0;
    this.tauntDone = false;
    this.wakeFallback = -1;
    this.walkSpeed = 0;
  }

  // ---------------------------------------------------------------- action runner
  startAction(def) {
    if (this.action) this.stopAction(true);
    const d = this.d;
    const list = def.phases(d);
    const a = {
      def, name: def.name, list, i: 0, t: 0, T: 0, k: 0, hitDone: false, prev: null,
      phase: list[0][0], dur: Math.max(0.01, list[0][1]), beats: NO_BEATS, cur: null, finish: false,
    };
    this.action = a;
    def.start?.(d, a);
    if (this.action !== a) return a;
    a.beats = def.beats?.(d, a) ?? NO_BEATS;
    def.enter?.(d, a, a.phase);
    if (this.action !== a) return a;
    if (ATTACK_NAMES.has(def.name)) d.emit('dragon:windup', { name: def.name });
    this._beats(a);
    return a;
  }

  stopAction(interrupted) {
    const a = this.action;
    if (!a) return;
    this.action = null;
    try {
      a.def.end?.(this.d, a, interrupted);
    } catch (err) {
      console.error('[dragon] action end failed', err);
    }
    if (interrupted && a.name === 'face') this.queued = null;
    if (ATTACK_NAMES.has(a.name)) {
      this.cooldowns[a.name] = a.def.cooldown ?? 0;
      this.history.unshift(a.name);
      if (this.history.length > 3) this.history.length = 3;
    }
    if (!interrupted) {
      const gap = perPhase(TUNING.idleGap, this.d.phase);
      this.idleTimer = rand(gap[0], gap[1]);
    }
  }

  _tick(dt) {
    const a = this.action, d = this.d;
    a.t += dt;
    a.T += dt;
    if (a.finish) {
      this.stopAction(false);
      return;
    }
    while (a.t >= a.dur) {
      a.t -= a.dur;
      a.i++;
      if (a.i >= a.list.length) {
        this.stopAction(false);
        return;
      }
      a.phase = a.list[a.i][0];
      a.dur = Math.max(0.01, a.list[a.i][1]);
      if (ATTACK_NAMES.has(a.name) && (a.i === 1 || a.phase.startsWith('active'))) d.emit('dragon:attack', { name: a.name });
      a.def.enter?.(d, a, a.phase);
      if (this.action !== a) return;
    }
    a.k = clamp(a.t / a.dur, 0, 1);
    this._beats(a);
    this._warnZone(a, dt);
    a.def.update?.(d, a, dt);
  }

  /**
   * Tell beats: at each hit's windup start announce it (combat:tell) and arm `a.cur` (fresh hit
   * lock + sweep history for that hit); flashLead s before its impact fire the timing flash.
   */
  _beats(a) {
    const B = a.beats;
    if (!B.length) return;
    const d = this.d, lead = TUNING.flashLead, now = a.T + 1e-6;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.told) {
        if (now < b.at) break; // beats are in time order
        b.told = true;
        a.cur = b;
        a.hitDone = false;
        a.prev = null;
        d.announceTell(a, b);
      }
      if (!b.flashed && now >= b.at + b.impactIn - lead) {
        b.flashed = true;
        d.flashTell(a, b);
      }
    }
  }

  /** Red AoE attacks: the ground heats up over the danger area until impact (ADR-048). */
  _warnZone(a, dt) {
    const b = a.cur, def = a.def;
    if (!b || b.tell !== 'red' || typeof def.zone !== 'function') return;
    const left = b.at + b.impactIn - a.T;
    if (left < 0) return;
    const d = this.d;
    const r = def.zone(d, a, this._zone);
    if (!(r > 0)) return;
    const k = clamp(1 - left / Math.max(0.05, b.impactIn), 0, 1);
    d.fx.warnRing(dt, this._zone.x, this._zone.z, r, 0.3 + 0.7 * k, b.flashed);
  }

  postRig(dt) {
    const a = this.action;
    if (a?.def.hit) a.def.hit(this.d, a, dt);
  }

  /** A posture break / ordinary stagger may start now (not mid-air, not during scripted beats). */
  canStagger() {
    const d = this.d, a = this.action;
    if (d.state !== 'combat' && !(d.state === 'staggered' && !d.broken)) return false;
    if (!a) return true;
    if (NO_BREAK.has(a.name)) return a.name === 'stagger' && !d.broken; // a break upgrades a stagger
    if (a.name === 'leap' && a.phase !== 'recovery') return false;
    if (a.def?.noBreak?.(a)) return false; // a string hit that can't be cut (the pounce's hop)
    return true;
  }

  stagger() {
    this.startAction(SEQ.stagger);
  }

  /** Posture full: break now if possible, otherwise as soon as the wyrm is back on its feet. */
  requestBreak() {
    if (this.canStagger()) this.startAction(SEQ.postureBreak);
    else this.pendingBreak = true;
  }

  /** Parried melee swing (a single attack or a string's last hit): cancel it with a recoil. */
  recoil() {
    this.startAction(SEQ.recoil);
  }

  /**
   * A plunge landed (Dragon.onPlunge, contract 2; the caller already checked NO_PLUNGE): cancel the
   * running action and play the plunged reaction. `opts` = { air, alt, heavy }. An airborne wyrm
   * falls from where it was hit: a flight's end() sees `d.crashing` and must not land it elsewhere.
   */
  plunged(opts) {
    const d = this.d;
    this.queued = null;
    this.plungeOpts = opts;
    const px = d.position.x, pz = d.position.z, yaw = d.yaw;
    if (this.action) {
      d.crashing = !!opts.air;
      try {
        this.stopAction(true);
      } finally {
        d.crashing = false;
      }
    }
    if (opts.air) {
      d.position.x = px;
      d.position.z = pz;
      d.yaw = yaw;
      d.state = 'airborne';
    } else if (d.state === 'airborne') d.state = 'combat';
    return this.startAction(SEQ.plunged);
  }

  beginCombat() {
    const d = this.d;
    d.state = 'combat';
    // open the fight by advancing: ranged attacks unlock after a few seconds
    Object.assign(this.cooldowns, TUNING.openingCooldowns);
    this.idleTimer = Math.max(this.idleTimer, 0.6);
    d.emit('dragon:introDone');
  }

  die() {
    this.queued = null;
    if (this.action) this.stopAction(true);
    this.startAction(SEQ.death);
  }

  /** Lab: force an ability now (ignores cooldowns / selection / AI switch). */
  force(def) {
    const d = this.d;
    this.queued = null;
    if (this.action) this.stopAction(true);
    if (d.state !== 'combat') d.state = 'combat'; // a stagger / break just ended above
    const want = d.sense.yawTo + (def.faceAway ? Math.PI : 0);
    if (Math.abs(angleDiff(d.yaw, want)) < 0.3) {
      this.startAction(def);
      return;
    }
    const f = this.startAction(SEQ.face);
    f.away = !!def.faceAway;
    this.queued = def;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const d = this.d, pose = d.pose;
    resetPose(pose);
    pose.vel.set(0, 0, 0);
    pose.speed = 0;
    pose.look.copy(d.sense.chest);
    // resting baseline while awake (actions override): jaw open so the lit maw and the fangs show,
    // wings mantled HALF like the painting's tall sails (both phases: at 0.3 the sails were edge-on
    // from the game camera and read as two white lances); phase 2 opens the jaw wider
    if (d.state !== 'sleeping' && d.state !== 'dead') {
      pose.jaw = perPhase(REST.jaw, d.phase);
      pose.spread[0] = pose.spread[1] = REST.spread;
    }
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    // a full posture meter breaks as soon as allowed (e.g. right after landing a leap)
    if (this.pendingBreak && !d.broken && this.canStagger()) this.startAction(SEQ.postureBreak);
    // a phase transition interrupts whatever the boss is doing once it is back on the ground (never a
    // break, a plunge reaction or another transition). Checked before the decision loop so a fresh
    // attack is not announced and cancelled the same frame. With the Lab AI off it waits (the
    // damaging roar would be an attack of its own; debug.phase2 / phase3 force it).
    const next = d.phase + 1;
    if (
      this.pendingPhase >= next && next <= 3 && this.aiEnabled && !d.broken &&
      (d.state === 'combat' || d.state === 'staggered') && !NO_TRANSITION.has(this.action?.name)
    ) {
      this.pendingPhase = 0;
      this.queued = null;
      this.startAction(next >= 3 ? SEQ.phase3 : SEQ.phase2);
    }

    switch (d.state) {
      case 'sleeping':
        this._sleeping(dt);
        break;
      case 'dead':
        pose.dead = 1;
        pose.eyes = 0;
        break;
      default:
        if (this.action) this._tick(dt);
        if (!this.action && this.queued && d.state === 'combat') {
          const q = this.queued;
          this.queued = null;
          this.startAction(q);
        }
        if (!this.action && d.state === 'combat') this._combat(dt);
    }
    // a deflected (parried, not last) string hit: the struck part is knocked back (visual only)
    d.applyDeflectKnock?.(dt);

    // hit flinch: head knocked along the blow direction
    if (d.flinch > 0.001 && d.state !== 'sleeping' && d.state !== 'dying' && d.state !== 'dead') {
      const f = Math.min(1, d.flinch);
      pose.headOffset.x += d.flinchDir.x * f * 0.8 * S;
      pose.headOffset.z += d.flinchDir.z * f * 0.8 * S;
      pose.headOffset.y += f * 0.45 * S;
      if (d.flinchHead) pose.jaw = Math.max(pose.jaw, f * 0.5);
    }
  }

  _sleeping(dt) {
    const d = this.d, pose = d.pose, pt = d.rig.pt, g = d.game;
    pose.sleep = 1;
    pose.eyes = 0;
    pose.tailWave = 0.02;
    pose.look.copy(pt.snout).addScaledVector(pt.headFwd, 3 * S);
    this.sleepPuff -= dt;
    if (this.sleepPuff <= 0) {
      this.sleepPuff = rand(3.5, 5.5);
      d.fx.snort(pt.nostrils, pt.headFwd, 0.6);
    }
    if (this.wakeFallback > 0) {
      this.wakeFallback -= dt;
      if (this.wakeFallback <= 0) d.startIntro(); // flow didn't react to the hit: wake anyway
    }
    if (g.state === 'boss') d.startIntro();
  }

  _combat(dt) {
    const d = this.d, g = d.game, s = d.sense, pose = d.pose;
    pose.idle = 1; // no attack running: the rig's idle life (breathing wings, weight shifts) may play
    const playerDown = g.player?.alive === false || g.state === 'dead';
    if (playerDown) {
      // stop, turn to the fallen player, roar once
      this.walkSpeed = 0;
      d.turnToward(s.yawTo, d.turnRate * 0.5, dt);
      this.tauntTimer += dt;
      if (!this.tauntDone && this.tauntTimer > 1.0 && this.aiEnabled) {
        this.tauntDone = true;
        this.startAction(SEQ.taunt);
      }
      this._idleLife(dt);
      return;
    }
    this.tauntDone = false;
    this.tauntTimer = 0;
    if (g.state !== 'boss' || !this.aiEnabled) {
      // waiting (intro camera, pause, Lab AI off...): just watch the player
      this.walkSpeed = damp(this.walkSpeed, 0, 4, dt);
      if (this.walkSpeed > 0.05) d.moveForward(this.walkSpeed, dt);
      d.turnToward(s.yawTo, d.turnRate * (this.aiEnabled ? 0.5 : 0.8), dt);
      pose.speed = Math.max(pose.speed, 1);
      this._idleLife(dt);
      return;
    }

    this.idleTimer -= dt;
    // approach when far, turn in place otherwise
    const far = s.dist > 8.5 * S;
    const ws = perPhase(TUNING.walkSpeed, d.phase);
    const want = far && s.absAng < 1.2 ? ws * (s.dist > 14 * S ? 1 : 0.75) : 0;
    this.walkSpeed = damp(this.walkSpeed, want, 3, dt);
    d.turnToward(s.yawTo, d.turnRate, dt);
    if (this.walkSpeed > 0.05) d.moveForward(this.walkSpeed, dt);
    else pose.speed = Math.max(pose.speed, 1);
    pose.tailWave = 0.08 + this.walkSpeed * 0.02;
    pose.lower = d.phase >= 2 ? 0.03 : 0.15; // combat idle a little lower than standing tall; phases 2-3 stand tall
    if (this.walkSpeed > 0.5) pose.spread[0] = pose.spread[1] = Math.min(pose.spread[0], REST.walkSpread); // tucked while walking
    this._idleLife(dt);

    if (this.idleTimer <= 0) {
      const def = this._choose(s);
      if (def) {
        this.walkSpeed = 0;
        this.startAction(def);
      } else this.idleTimer = 0.15;
    }
  }

  /** Snorts / jaw twitches between attacks. */
  _idleLife(dt) {
    const d = this.d, pose = d.pose;
    this.snortTimer -= dt;
    if (this.snortTimer <= 0) {
      this.snortTimer = rand(3.5, 7);
      d.fx.snort(d.rig.pt.nostrils, d.rig.pt.headFwd, 0.8);
      this.jawTwitch = 0.35;
    }
    if (this.jawTwitch > 0) {
      this.jawTwitch -= dt;
      pose.jaw = Math.max(pose.jaw, 0.25);
    }
  }

  /**
   * Weighted pick over every ATTACKS entry (attackWeight: phase, weight, air; cooldowns; the last two
   * picks are damped). Melee stays allowed while hazards burn: the fight layers.
   */
  _choose(s) {
    const d = this.d, c = this._cands;
    c.length = 0;
    let total = 0;
    for (const name in ATTACKS) {
      const def = ATTACKS[name];
      if (!def || (this.cooldowns[name] ?? 0) > 0) continue;
      let w;
      try {
        w = attackWeight(def, name, d, s);
      } catch (err) {
        console.error('[dragon] weight failed', name, err);
        w = 0;
      }
      if (!(w > 0)) continue;
      if (this.history[0] === name) w *= 0.3;
      else if (this.history[1] === name) w *= 0.65;
      c.push(def, w);
      total += w;
    }
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < c.length; i += 2) {
      r -= c[i + 1];
      if (r <= 0) return c[i];
    }
    return c[c.length - 2];
  }
}
