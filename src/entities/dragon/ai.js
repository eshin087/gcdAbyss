import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { ATTACKS, PHASE2_ROAR, roarFx, roarPose } from './attacks.js';
import { resetPose } from './rig/anim.js';
import { POSTURE } from '../../combat/rules.js';
import { clamp, damp, angleDiff } from '../../core/math.js';

// Boss brain: owns the action runner (attacks + scripted sequences, tell beats) and the combat
// decision loop. Acts only while game.state === 'boss' and the AI is enabled; otherwise idles /
// faces the player / taunts their corpse. Lab triggers (debug.trigger) bypass the decision loop.

const S = SCALE;
const rand = (a, b) => a + Math.random() * (b - a);
const ATTACK_NAMES = new Set(Object.keys(ATTACKS));
const NO_BEATS = [];

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
        pose.spread[0] = pose.spread[1] = 0.25 * a.k;
      } else if (a.phase === 'roar') {
        d.turnToward(s.yawTo, 0.8, dt);
        roarPose(d, a, 1);
      } else {
        pose.spreadRate = 3;
        pose.jaw = 0.1;
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
      const pose = d.pose;
      const rec = a.k > 0.78;
      pose.stagger = rec ? 0 : 1;
      pose.lower = rec ? 0.25 : 0.65;
      pose.pitch = rec ? 0.05 : 0.15;
      pose.bodyRate = 4;
      pose.jaw = rec ? 0.1 : 0.35;
      pose.eyes = 0.45;
      pose.spread[0] = pose.spread[1] = rec ? 0 : 0.22;
      pose.spreadRate = 2;
      pose.tailWave = 0.02;
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
      pose.stagger = rec ? 0.3 : 1;
      pose.lower = rec ? 0.35 : 0.75;
      pose.pitch = rec ? 0.08 : 0.28;
      pose.bodyRate = rec ? 3 : 5;
      if (!rec) {
        // head down on the ground just in front of the chest, within sword reach
        pose.head = d.rootPt(pose.headTarget, 0, 0.75, 6.0);
        pose.headRate = a.t < 0.4 ? 5 : 2.5;
        pose.headOffset.y += Math.sin(d.time * 2.1) * 0.05 * S;
      } else pose.headRate = 3;
      d.rootPt(pose.look, Math.sin(d.time * 0.9) * 1.2, 0, 9);
      pose.lookRate = 2;
      pose.jaw = rec ? 0.15 : 0.45;
      pose.eyes = rec ? 0.7 : 0.3;
      pose.spread[0] = pose.spread[1] = rec ? 0 : 0.18;
      pose.spreadRate = 2;
      pose.tailWave = 0.02;
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
    start(d) {
      d.throat = 0;
    },
    update(d, a, dt) {
      const pose = d.pose, f = d.fwd;
      const e = 1 - a.k * a.k; // snap back, ease out
      pose.headRate = a.k < 0.35 ? 16 : 5;
      pose.headOffset.x -= f.x * 1.7 * S * e;
      pose.headOffset.z -= f.z * 1.7 * S * e;
      pose.headOffset.y += 0.9 * S * e;
      pose.jaw = 0.55 * e + 0.1;
      pose.jawRate = 20;
      pose.pitch = -0.14 * e;
      pose.lower = -0.1 * e;
      pose.bodyRate = 8;
      pose.eyes = 0.8;
      pose.spread[0] = pose.spread[1] = 0.2 * e;
      if (a.k > 0.6) d.turnToward(d.sense.yawTo, d.turnRate * 0.4, dt);
    },
  },

  phase2: PHASE2_ROAR,

  taunt: {
    name: 'taunt',
    phases: () => [['windup', 0.6], ['roar', 1.3], ['recovery', 0.6]],
    enter(d, a, phase) {
      if (phase === 'roar') roarFx(d, 0.7);
    },
    update(d, a, dt) {
      const pose = d.pose;
      d.turnToward(d.sense.yawTo, d.turnRate * 0.5, dt);
      if (a.phase === 'windup') {
        pose.head = d.rootPt(pose.headTarget, 0, 6.0, 2.6);
        pose.headRate = 4;
        pose.jaw = 0.25;
      } else if (a.phase === 'roar') roarPose(d, a, 0.6);
      else pose.jaw = 0.1;
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
      a.noShadow = false;
      d.emit('dragon:death');
      d.hitstop(0.12, 0.05);
    },
    update(d, a, dt) {
      const pose = d.pose, g = d.game;
      pose.dead = 1;
      pose.stateRate = 1.6;
      pose.eyes = a.phase === 'collapse' ? Math.max(0, 1 - a.k * 1.6) : 0;
      pose.jaw = 0.45;
      pose.spread[0] = pose.spread[1] = 0.5;
      pose.spreadRate = 2;
      pose.tailWave = 0;
      d.rootPt(pose.look, -3, 0, 6);
      if (a.phase === 'collapse') {
        if (!a.thud && a.t > 1.1) {
          a.thud = true;
          g.shake?.(0.4);
          const c = d.rig.pt.chest;
          g.world?.gust?.(c.x, c.z, 1.2, 14 * S);
          d.fx.dustRing(c.x, c.z, 2.5 * S, 44, 1.0);
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

// actions a posture break / ordinary stagger may NOT interrupt
const NO_BREAK = new Set(['intro', 'phase2', 'death', 'stagger', 'postureBreak', 'taunt']);

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
    this.pendingPhase2 = false;
    this.pendingBreak = false;
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
      const gap = TUNING.idleGap[this.d.phase === 2 ? 1 : 0];
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

  /** Red AoE attacks: ground ring of red glyphs over the danger area until impact. */
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

  /** Parried melee swing: cancel it with a recoil. */
  recoil() {
    this.startAction(SEQ.recoil);
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
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    // a full posture meter breaks as soon as allowed (e.g. right after landing a leap)
    if (this.pendingBreak && !d.broken && this.canStagger()) this.startAction(SEQ.postureBreak);
    // phase 2 interrupts whatever the boss is doing once it is back on the ground (never a break).
    // Checked before the decision loop so a fresh attack is not announced and cancelled the same frame.
    // With the Lab AI off it waits (the damaging roar would be an attack of its own; debug.phase2 forces it).
    if (this.pendingPhase2 && this.aiEnabled && !d.broken && (d.state === 'combat' || d.state === 'staggered')) {
      this.pendingPhase2 = false;
      this.queued = null;
      this.startAction(SEQ.phase2);
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
    const ws = TUNING.walkSpeed[d.phase === 2 ? 1 : 0];
    const want = far && s.absAng < 1.2 ? ws * (s.dist > 14 * S ? 1 : 0.75) : 0;
    this.walkSpeed = damp(this.walkSpeed, want, 3, dt);
    d.turnToward(s.yawTo, d.turnRate, dt);
    if (this.walkSpeed > 0.05) d.moveForward(this.walkSpeed, dt);
    else pose.speed = Math.max(pose.speed, 1);
    pose.tailWave = 0.08 + this.walkSpeed * 0.02;
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

  _choose(s) {
    const d = this.d, c = this._cands;
    c.length = 0;
    let total = 0;
    for (const name in ATTACKS) {
      const def = ATTACKS[name];
      if ((this.cooldowns[name] ?? 0) > 0) continue;
      let w = def.weight(d, s);
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
