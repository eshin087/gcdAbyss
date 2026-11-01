import { TUNING } from './tuning.js';
import { ATTACKS } from './attacks.js';
import { resetPose } from './rig/anim.js';
import { clamp, damp } from '../../core/math.js';

// Boss brain: owns the action runner (attacks + scripted sequences) and the combat decision loop.
// Acts only while game.state === 'boss'; otherwise idles / faces the player / taunts their corpse.

const rand = (a, b) => a + Math.random() * (b - a);
const ATTACK_NAMES = new Set(Object.keys(ATTACKS));

function roarFx(d, strength) {
  const g = d.game, pt = d.rig.pt;
  d.emit('dragon:roar', { strength });
  g.shake?.(0.5 * strength);
  g.world?.gust?.(d.position.x, d.position.z, 1.6 * strength, 22);
  d.fx.roarWave(pt.mouth.x, pt.mouth.y, pt.mouth.z, strength);
}

/** Roar pose: head thrown up, jaw wide, shuddering wings. */
function roarPose(d, a, spread) {
  const pose = d.pose;
  pose.head = d.rootToWorld(pose.headTarget, 0, 5.9, 3.4);
  pose.headRate = 5;
  pose.jaw = 1;
  pose.jawRate = 14;
  pose.pitch = -0.12;
  pose.lower = -0.15;
  pose.spread[0] = pose.spread[1] = spread;
  pose.spreadRate = 5;
  pose.flap = spread > 0.5 ? 0.12 : 0;
  pose.flapHz = 3;
  const j = Math.sin(d.time * 41) * 0.09 + Math.sin(d.time * 23) * 0.06;
  pose.headOffset.x += j;
  pose.headOffset.y += Math.sin(d.time * 37) * 0.06;
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
      if (!interrupted && d.state === 'waking') {
        d.state = 'combat';
        // open the fight by advancing: ranged attacks unlock after a few seconds
        Object.assign(d.brain.cooldowns, TUNING.openingCooldowns);
        d.emit('dragon:introDone');
      }
    },
  },

  stagger: {
    name: 'stagger',
    phases: () => [['stagger', TUNING.poise.staggerTime]],
    start(d) {
      d.state = 'staggered';
      d.poise = 0;
      d.throat = 0;
      d.emit('dragon:stagger');
      d.game.shake?.(0.25);
    },
    update(d, a) {
      const pose = d.pose;
      const rec = a.k > 0.82;
      pose.stagger = rec ? 0 : 1;
      pose.lower = rec ? 0.25 : 0.65;
      pose.pitch = rec ? 0.05 : 0.15;
      pose.bodyRate = 4;
      pose.jaw = rec ? 0.1 : 0.35;
      pose.eyes = 0.45;
      pose.spread[0] = pose.spread[1] = rec ? 0 : 0.22;
      pose.spreadRate = 2;
      pose.tailWave = 0.02;
      d.rootToWorld(pose.look, Math.sin(d.time * 1.3) * 1.5, 0, 9);
    },
    end(d) {
      if (d.state === 'staggered') d.state = 'combat';
      d.poise = 0;
    },
  },

  phase2: {
    name: 'phase2',
    phases: (d) => [['windup', TUNING.attacks.phase2.windup], ['roar', TUNING.attacks.phase2.roar], ['recovery', TUNING.attacks.phase2.recovery]],
    start(d) {
      d.phase = 2;
      d.poise = 0;
    },
    enter(d, a, phase) {
      if (phase !== 'roar') return;
      const P = TUNING.attacks.phase2, g = d.game;
      d.emit('dragon:phase2');
      roarFx(d, 1.3);
      d.glowTarget = 0.5;
      const c = d.rig.pt.chest, p = g.player?.position;
      if (p && Math.hypot(p.x - c.x, p.z - c.z) <= P.radius + (g.player.radius ?? 0.45)) {
        d.strike(a, { damage: P.damage, knockback: P.knockback, kind: 'roar', from: c });
      }
    },
    update(d, a, dt) {
      const pose = d.pose, s = d.sense;
      if (a.phase === 'windup') {
        d.turnToward(s.yawTo, d.turnRate, dt);
        pose.head = d.rootToWorld(pose.headTarget, 0, 6.2, 2.2);
        pose.headRate = 5;
        pose.spread[0] = pose.spread[1] = 1;
        pose.spreadRate = 3;
        pose.jaw = 0.3;
        pose.pitch = -0.12;
        pose.lower = -0.15;
        d.throat = a.k;
      } else if (a.phase === 'roar') {
        roarPose(d, a, 1);
        d.throat = 1;
      } else {
        pose.spreadRate = 3;
        pose.jaw = 0.1;
        d.throat = 0;
      }
    },
    end(d) {
      d.throat = 0;
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
      if (a.phase === 'windup') {
        pose.head = d.rootToWorld(pose.headTarget, 0, 6.0, 2.6);
        pose.headRate = 4;
        pose.jaw = 0.25;
      } else if (a.phase === 'roar') roarPose(d, a, 0.6);
      else pose.jaw = 0.1;
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
      d.game.hitstop?.(0.12, 0.05);
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
      d.rootToWorld(pose.look, -3, 0, 6);
      if (a.phase === 'collapse') {
        if (!a.thud && a.t > 1.1) {
          a.thud = true;
          g.shake?.(0.4);
          const c = d.rig.pt.chest;
          g.world?.gust?.(c.x, c.z, 1.2, 14);
          d.fx.dustRing(c.x, c.z, 2.5, 44, 1.0);
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

const NO_STAGGER = new Set(['intro', 'phase2', 'death', 'stagger', 'taunt']);

export class Brain {
  constructor(d) {
    this.d = d;
    this.action = null;
    this._cands = [];
    this.reset();
  }

  reset() {
    if (this.action) this.stopAction(true);
    this.cooldowns = {};
    this.history = [];
    this.idleTimer = 1.0;
    this.pendingPhase2 = false;
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
    const a = { def, name: def.name, list, i: 0, t: 0, k: 0, hitDone: false, phase: list[0][0], dur: Math.max(0.01, list[0][1]) };
    this.action = a;
    def.start?.(d, a);
    def.enter?.(d, a, a.phase);
    if (ATTACK_NAMES.has(def.name)) d.emit('dragon:windup', { name: def.name });
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
    while (a.t >= a.dur) {
      a.t -= a.dur;
      a.i++;
      if (a.i >= a.list.length) {
        this.stopAction(false);
        return;
      }
      a.phase = a.list[a.i][0];
      a.dur = Math.max(0.01, a.list[a.i][1]);
      if (a.i === 1 && ATTACK_NAMES.has(a.name)) d.emit('dragon:attack', { name: a.name });
      a.def.enter?.(d, a, a.phase);
      if (this.action !== a) return;
    }
    a.k = clamp(a.t / a.dur, 0, 1);
    a.def.update?.(d, a, dt);
  }

  postRig(dt) {
    const a = this.action;
    if (a?.def.hit) a.def.hit(this.d, a, dt);
  }

  canStagger() {
    const a = this.action;
    if (!a) return this.d.state === 'combat';
    if (NO_STAGGER.has(a.name)) return false;
    if (a.name === 'leap' && a.phase !== 'recovery') return false;
    return this.d.state === 'combat';
  }

  stagger() {
    this.startAction(SEQ.stagger);
  }

  die() {
    if (this.action) this.stopAction(true);
    this.startAction(SEQ.death);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const d = this.d, pose = d.pose;
    resetPose(pose);
    pose.vel.set(0, 0, 0);
    pose.speed = 0;
    pose.look.copy(d.sense.chest);
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    // phase 2 interrupts whatever the boss is doing once it is back on the ground. Checked before
    // the decision loop so a fresh attack is not announced ('dragon:windup') and cancelled the same frame.
    if (this.pendingPhase2 && (d.state === 'combat' || d.state === 'staggered')) {
      this.pendingPhase2 = false;
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
        if (!this.action && d.state === 'combat') this._combat(dt);
    }

    // hit flinch: head knocked along the blow direction
    if (d.flinch > 0.001 && d.state !== 'sleeping' && d.state !== 'dying' && d.state !== 'dead') {
      const f = Math.min(1, d.flinch);
      pose.headOffset.x += d.flinchDir.x * f * 0.8;
      pose.headOffset.z += d.flinchDir.z * f * 0.8;
      pose.headOffset.y += f * 0.45;
      if (d.flinchHead) pose.jaw = Math.max(pose.jaw, f * 0.5);
    }
  }

  _sleeping(dt) {
    const d = this.d, pose = d.pose, pt = d.rig.pt, g = d.game;
    pose.sleep = 1;
    pose.eyes = 0;
    pose.tailWave = 0.02;
    pose.look.copy(pt.snout).addScaledVector(pt.headFwd, 3);
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
      if (!this.tauntDone && this.tauntTimer > 1.0) {
        this.tauntDone = true;
        this.startAction(SEQ.taunt);
      }
      this._idleLife(dt);
      return;
    }
    this.tauntDone = false;
    this.tauntTimer = 0;
    if (g.state !== 'boss') {
      // waiting (intro camera, pause, ...): just watch the player
      d.turnToward(s.yawTo, d.turnRate * 0.5, dt);
      this._idleLife(dt);
      return;
    }

    this.idleTimer -= dt;
    // approach when far, turn in place otherwise
    const far = s.dist > 8.5;
    const ws = TUNING.walkSpeed[d.phase === 2 ? 1 : 0];
    const want = far && s.absAng < 1.2 ? ws * (s.dist > 14 ? 1 : 0.75) : 0;
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
