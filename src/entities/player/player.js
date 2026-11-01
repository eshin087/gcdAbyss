import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { clamp, damp, dampAngle, turnToward, wrapAngle, smoothstep } from '../../core/math.js';
import { markCaster } from '../../render/pipeline.js';
import { buildKnight } from './model.js';
import { KnightAnimator } from './anim.js';
import { LIGHT, HEAVY, SwordSweep } from './combat.js';
import { PlayerFx } from './fx.js';

// The knight. Owns input → state machine → movement/collision → animation → sword hits → FX.
// Contract: docs/ARCHITECTURE.md (Player).

export const TUNE = {
  runSpeed: 4.6,
  sprintSpeed: 7.2,
  healSpeed: 1.4,
  accel: 14, // damp lambda toward a faster target velocity
  decel: 18, // ... toward a slower one
  turnRate: 16,
  maxHp: 100,
  maxStamina: 100,
  maxFlasks: 3,
  regen: 42, // stamina / s
  regenDelay: 0.55,
  exhaustDelay: 0.9, // regen delay after stamina hit 0
  sprintDrain: 18,
  sprintResume: 25, // after exhausting stamina, sprint unlocks again at this much
  roll: { dur: 0.6, dist: 4.2, iframes: [0.05, 0.38], cost: 22, attackAfter: 0.42, rollAfter: 0.5, moveAfter: 0.52, landAt: 0.48 },
  backstep: { dur: 0.4, dist: 1.6, iframes: [0.03, 0.22], cost: 16, attackAfter: 0.28, rollAfter: 0.32, moveAfter: 0.34, landAt: 0.3 },
  heal: { dur: 0.95, at: 0.55, amount: 55 },
  staggerDur: 0.4,
  knockdownDur: 1.3,
  getUpIframes: 0.5, // last part of the knockdown
  minStaggerDamage: 5, // no-knockback hits below this only flash
  chipGuard: 0.6, // s: after a no-knockback hit, further ones (breath ticks every 0.15 s) don't re-stagger
  defaultPush: 0.35, // m of slide on a stagger without knockback
  knockbackDecay: 6, // slide velocity decay; slide distance = knockback meters
  burnDps: 4,
  burnTick: 0.5,
  buffer: 0.3, // input buffer for roll / attacks / heal
  lockRange: 40,
  lockBreak: 50,
  pusher: 0.8,
  pusherRoll: 1.3,
  pusherDown: 1.0,
  windupSteer: 9, // rad/s of steering allowed during attack windups
  rollCancel: 0.35, // fraction of attack recovery after which a roll / heal may cancel it
  moveCancel: 0.6, // fraction of attack recovery after which movement input ends it
};

const CONTROL = new Set(['explore', 'bossIntro', 'boss']);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class Player {
  constructor(game) {
    this.game = game;
    this.rig = buildKnight(game.U);
    this.object3d = this.rig.root;
    this.position = this.object3d.position;
    this.radius = 0.45;
    this.yaw = Math.PI;

    this.maxHp = TUNE.maxHp;
    this.hp = this.maxHp;
    this.maxStamina = TUNE.maxStamina;
    this.stamina = this.maxStamina;
    this.maxFlasks = TUNE.maxFlasks;
    this.flasks = this.maxFlasks;
    this.state = 'idle';
    this.stateT = 0;
    this.lockOn = false;

    this.time = 0;
    this.control = false;
    this.intent = { x: 0, z: 0, len: 0, sprint: false };
    this.buf = { action: null, t: 0 };
    this.vel = { x: 0, z: 0 }; // own movement
    this.want = { x: 0, z: 0 }; // desired movement this frame
    this.kb = { x: 0, z: 0 }; // knockback slide
    this.groundVel = { x: 0, z: 0 }; // actual displacement / dt (drives the gait)
    this.atk = null; // { def, hit, prevT, slammed }
    this.rollBack = false;
    this.rollDir = { x: 0, z: -1 };
    this.healApplied = false;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.burnT = 0;
    this.burnAcc = 0;
    this.burnGlow = 0;
    this.burnLight = null;
    this.healLight = null;
    this.flash = 0;
    this.diedEmitted = false;
    this.onceMask = 0;
    this.enterN = 0; // bumps on every state entry (dodge events are per roll / get-up)
    this.dodgeN = -1;
    this.dodgeKind = '';
    this.chipGuard = 0;
    this._v = new THREE.Vector3();
    this._lock = new THREE.Vector3();
    this._hit = { sphere: null, x: 0, y: 0, z: 0 };

    this.anim = new KnightAnimator(this.rig, this);
    this.anim.onFootstep = (side) => this._footstep(side);
    this.fx = new PlayerFx(game, this.rig);
    this.sweep = new SwordSweep(this.rig.sword);

    markCaster(this.object3d);
    game.scene.add(this.object3d);
    const s = CONFIG.world.playerSpawn;
    this.respawn(s.x, s.z);
  }

  // ------------------------------------------------------------------ contract
  get alive() {
    return this.state !== 'dead' && this.hp > 0;
  }

  isInvulnerable() {
    if (!this.alive) return true;
    if (this.state === 'roll') {
      const R = this.rollBack ? TUNE.backstep : TUNE.roll;
      return this.stateT >= R.iframes[0] && this.stateT <= R.iframes[1];
    }
    if (this.state === 'knockdown') return this.stateT >= TUNE.knockdownDur - TUNE.getUpIframes;
    return false;
  }

  takeHit(hit = {}) {
    hit = hit || {};
    if (!this.alive) return 'ignored';
    const g = this.game;
    if (g.state === 'victory' || g.state === 'title') return 'ignored';
    const kind = typeof hit.kind === 'string' ? hit.kind : 'hit';
    if (this.isInvulnerable()) {
      // one event per kind per roll / get-up: a breath stream ticks many times through one roll
      if (this.dodgeN !== this.enterN || this.dodgeKind !== kind) {
        this.dodgeN = this.enterN;
        this.dodgeKind = kind;
        this._emit('player:dodge', { kind });
      }
      return 'dodged';
    }
    const dmg = Math.max(0, fin(hit.damage, 0));
    const kb = clamp(fin(hit.knockback, 0), 0, 14);
    const burn = clamp(fin(hit.burn, 0), 0, 15);
    const knockdown = !!hit.knockdown;
    // contact damage streams (breath) stagger on first contact only, so a roll can get out
    const chip = kb <= 0 && !knockdown;
    const guarded = chip && this.chipGuard > 0;
    if (chip) this.chipGuard = TUNE.chipGuard;

    // push direction: away from the source (fallback: backwards)
    const p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw);
    const fx = fin(hit.from?.x, NaN), fz = fin(hit.from?.z, NaN);
    const hasFrom = Number.isFinite(fx) && Number.isFinite(fz);
    if (hasFrom) {
      const dx = p.x - fx, dz = p.z - fz;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        nx = dx / l;
        nz = dz / l;
      }
    }

    this.hp = Math.max(0, this.hp - dmg);
    if (burn > 0) this.burnT = Math.max(this.burnT, burn);
    this.flash = 1;
    const big = knockdown || dmg >= 25;
    this.getChestPos(this._v);
    this.fx.hurt(this._v.x, this._v.y, this._v.z, nx, nz, big);
    this._emit('player:hurt', { damage: dmg, kind, hp: this.hp });

    if (this.hp <= 0) {
      this._setKb(nx, nz, kb);
      this._die();
      g.shake?.(0.5);
      g.hitstop?.(0.12);
      return 'hit';
    }
    g.shake?.(guarded ? 0.06 : clamp(0.25 + dmg * 0.006, 0.25, 0.5));
    if (big) g.hitstop?.(0.08);

    if (knockdown) {
      if (this.state !== 'knockdown') {
        this.atk = null;
        this.buf.action = null;
        if (hasFrom) this.yaw = Math.atan2(-nx, -nz); // face the attacker, fall away from it
        this._setKb(nx, nz, Math.max(kb, 1.2));
        this._enter('knockdown', 'knockdown', 0.06);
      }
    } else if (kb > 0 || (dmg >= TUNE.minStaggerDamage && !guarded)) {
      if (this.state !== 'knockdown') {
        this.atk = null;
        this.buf.action = null; // inputs mashed before the hit don't fire after the flinch
        this._setKb(nx, nz, Math.max(kb, TUNE.defaultPush));
        this._enter('stagger', 'stagger', 0.05);
      }
    }
    return 'hit';
  }

  getChestPos(out) {
    out = out || new THREE.Vector3();
    this.rig.chest.getWorldPosition(out);
    out.y += 0.12;
    if (!Number.isFinite(out.x + out.y + out.z)) out.set(this.position.x, 1.3, this.position.z);
    return out;
  }

  respawn(x, z) {
    const s = CONFIG.world.playerSpawn;
    this.position.set(fin(x, s.x), 0, fin(z, s.z));
    this.yaw = Math.PI;
    this.object3d.rotation.y = this.yaw;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.flasks = this.maxFlasks;
    this.state = 'idle';
    this.stateT = 0;
    this.onceMask = 0;
    this.vel.x = this.vel.z = 0;
    this.want.x = this.want.z = 0;
    this.kb.x = this.kb.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.rollBack = false;
    this.healApplied = false;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.buf.action = null;
    this.flash = 0;
    this.burnGlow = 0;
    this.chipGuard = 0;
    this.dodgeN = -1;
    this.diedEmitted = false;
    this._clearBurn();
    if (this.healLight) {
      this.healLight.kill();
      this.healLight = null;
    }
    this._setLock(false);
    this.anim.reset();
    this.fx.reset();
    this.sweep.valid = false;
    this._updateMaterials(0);
    this.game.world?.setPusher?.(0, this.position.x, 0, this.position.z, TUNE.pusher);
  }

  restAtBonfire() {
    if (!this.alive) return;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.flasks = this.maxFlasks;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.buf.action = null;
    this._clearBurn();
    this._setLock(false);
  }

  update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const g = this.game;
    this.time += dt;
    const control = this.alive && CONTROL.has(g.state);
    // skip input on the first controllable frame (the click that dismissed a menu)
    this._readInput(control && this.control);
    this.control = control;
    if (this.buf.action && this.time - this.buf.t > TUNE.buffer) this.buf.action = null;
    if (this.chipGuard > 0) this.chipGuard -= dt;
    this._updateLock();

    this.stateT += dt;
    this._tick(dt);
    this._integrate(dt);
    this._updateStamina(dt);
    this._updateBurn(dt);

    this.yaw = wrapAngle(fin(this.yaw, Math.PI));
    this.object3d.rotation.y = this.yaw;
    this.anim.update(dt);
    this._combat();
    this._updateFx(dt);
    this._updateMaterials(dt);

    const st = this.state;
    const r = st === 'roll' ? TUNE.pusherRoll : st === 'knockdown' || st === 'dead' ? TUNE.pusherDown : TUNE.pusher;
    g.world?.setPusher?.(0, this.position.x, 0, this.position.z, r);
  }

  // ------------------------------------------------------------------ input + lock-on
  _readInput(control) {
    const I = this.intent, inp = this.game.input;
    if (!control || !inp) {
      I.x = I.z = I.len = 0;
      I.sprint = false;
      return;
    }
    const m = inp.moveAxis();
    I.x = fin(m.x);
    I.z = -fin(m.y); // W = north = −Z
    I.len = Math.hypot(I.x, I.z);
    I.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    if (inp.pressed('Space')) this._buffer('roll');
    if (inp.mousePressed(0)) this._buffer('light');
    if (inp.mousePressed(2)) this._buffer('heavy');
    if (inp.pressed('KeyF')) this._buffer('heal');
    if (inp.pressed('Tab') || inp.mousePressed(1)) this._toggleLock();
  }

  _buffer(action) {
    this.buf.action = action;
    this.buf.t = this.time;
  }

  _dragonTargetable(d) {
    return !!d && typeof d.isTargetable === 'function' && typeof d.lockPoint === 'function' && !!d.isTargetable();
  }

  _toggleLock() {
    if (this.lockOn) {
      this._setLock(false);
      return;
    }
    const d = this.game.dragon;
    if (!this._dragonTargetable(d)) return;
    d.lockPoint(this._lock);
    const dist = Math.hypot(this._lock.x - this.position.x, this._lock.z - this.position.z);
    if (dist <= TUNE.lockRange) this._setLock(true);
  }

  _updateLock() {
    if (!this.lockOn) return;
    const d = this.game.dragon;
    if (!this._dragonTargetable(d)) {
      this._setLock(false);
      return;
    }
    d.lockPoint(this._lock);
    const dist = Math.hypot(this._lock.x - this.position.x, this._lock.z - this.position.z);
    if (!(dist <= TUNE.lockBreak)) this._setLock(false);
  }

  _setLock(on) {
    on = !!on;
    if (this.lockOn === on) return;
    this.lockOn = on;
    this._emit('player:lockOn', { on });
  }

  /** Yaw toward the lock target, else the mouse; `fallback` when neither applies. */
  _aimYaw(fallback) {
    if (!this.control) return fallback;
    const p = this.position;
    if (this.lockOn) {
      const d = this.game.dragon;
      if (d && typeof d.lockPoint === 'function') {
        d.lockPoint(this._lock);
        const dx = this._lock.x - p.x, dz = this._lock.z - p.z;
        if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 1e-4) return Math.atan2(dx, dz);
      }
    }
    const mg = this.game.mouseGround;
    if (mg) {
      const dx = mg.x - p.x, dz = mg.z - p.z;
      if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 0.09) return Math.atan2(dx, dz);
    }
    return fallback;
  }

  // ------------------------------------------------------------------ state machine
  _enter(state, animKey, blend, easeOut = false) {
    this.state = state;
    this.stateT = 0;
    this.onceMask = 0;
    this.enterN++;
    this.anim.play(animKey, blend, easeOut);
  }

  _toLoco(blend = 0.16) {
    this.atk = null;
    this._enter('idle', 'loco', blend);
  }

  _once(bit) {
    if (this.onceMask & bit) return false;
    this.onceMask |= bit;
    return true;
  }

  _tick(dt) {
    switch (this.state) {
      case 'idle':
      case 'run':
      case 'sprint':
        this._tickLoco(dt);
        break;
      case 'roll':
        this._tickRoll();
        break;
      case 'attack':
      case 'heavy':
        this._tickAttack(dt);
        break;
      case 'heal':
        this._tickHeal(dt);
        break;
      case 'stagger':
        this.want.x = this.want.z = 0;
        if (this.stateT >= TUNE.staggerDur) this._toLoco(0.14);
        break;
      case 'knockdown':
        this.want.x = this.want.z = 0;
        this._tickKnockdown();
        break;
      case 'dead':
        this.want.x = this.want.z = 0;
        this._tickDead();
        break;
      default:
        this._toLoco();
    }
  }

  /** Start whatever is buffered, if allowed. Returns true if a new action began. */
  _tryAction(allowRoll = true, allowAttack = true, allowHeal = true) {
    const a = this.buf.action;
    if (!a) return false;
    if (a === 'roll' && allowRoll) {
      this.buf.action = null;
      return this._startRoll();
    }
    if (a === 'light' && allowAttack) {
      this.buf.action = null;
      return this._startAttack(LIGHT[0]);
    }
    if (a === 'heavy' && allowAttack) {
      this.buf.action = null;
      return this._startAttack(HEAVY);
    }
    if (a === 'heal' && allowHeal) {
      this.buf.action = null;
      return this._startHeal();
    }
    return false;
  }

  _spend(cost) {
    if (this.stamina <= 0) {
      this._emit('player:noStamina');
      return false;
    }
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = this.stamina <= 0 ? TUNE.exhaustDelay : TUNE.regenDelay;
    return true;
  }

  _tickLoco(dt) {
    if (this._tryAction()) return;
    const I = this.intent;
    const moving = I.len > 0.1;
    if (this.exhausted && (this.stamina >= TUNE.sprintResume || !I.sprint)) this.exhausted = false;
    const sprint = moving && I.sprint && this.stamina > 0 && !this.exhausted;
    this.state = moving ? (sprint ? 'sprint' : 'run') : 'idle';
    const sp = sprint ? TUNE.sprintSpeed : TUNE.runSpeed;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = moving ? Math.atan2(I.x, I.z) : this.yaw;
    const target = sprint ? moveYaw : this._aimYaw(moveYaw);
    this.yaw = dampAngle(this.yaw, target, sprint ? 10 : TUNE.turnRate, dt);
  }

  _startRoll() {
    const I = this.intent;
    const back = I.len <= 0.1;
    const R = back ? TUNE.backstep : TUNE.roll;
    if (!this._spend(R.cost)) return false;
    if (back) {
      this.rollDir.x = -Math.sin(this.yaw);
      this.rollDir.z = -Math.cos(this.yaw);
    } else {
      this.rollDir.x = I.x / I.len;
      this.rollDir.z = I.z / I.len;
      this.yaw = Math.atan2(I.x, I.z); // roll toward the input
    }
    this.rollBack = back;
    this.atk = null;
    this._enter('roll', back ? 'backstep' : 'roll', 0.05);
    this._emit('player:roll', { backstep: back });
    this.fx.dust(this.position.x, this.position.z, back ? 5 : 9, back ? 0.7 : 1);
    return true;
  }

  _tickRoll() {
    const R = this.rollBack ? TUNE.backstep : TUNE.roll;
    const t = this.stateT;
    const u = clamp(t / R.dur, 0, 1);
    // fast out of the gate, settling at the end; integrates to exactly R.dist
    const v = (R.dist / R.dur) * (0.6 + 0.8 * (1 - u));
    this.want.x = this.rollDir.x * v;
    this.want.z = this.rollDir.z * v;
    if (t >= R.landAt && this._once(1) && !this.rollBack) this.fx.dust(this.position.x, this.position.z, 7, 0.8);
    if (t >= R.attackAfter && this._tryAction(t >= R.rollAfter, true, false)) return;
    if (t >= R.moveAfter && this.intent.len > 0.1) {
      this._toLoco(0.12);
      return;
    }
    if (t >= R.dur) this._toLoco(0.12);
  }

  _startAttack(def) {
    if (!def || !this._spend(def.cost)) return false;
    this.atk = { def, hit: false, prevT: 0, slammed: false };
    this.yaw = this._aimYaw(this.yaw); // commit the swing direction
    const heavy = def.kind === 'heavy';
    // the cross-fade IS the windup: the body eases into the coil pose
    this._enter(heavy ? 'heavy' : 'attack', 'attack', def.windup * (heavy ? 0.8 : 0.85), true);
    this._emit('player:attack', { kind: def.kind, combo: def.combo });
    return true;
  }

  _tickAttack(dt) {
    const a = this.atk;
    if (!a) {
      this._toLoco();
      return;
    }
    const d = a.def, t = this.stateT;
    const W = d.windup, A = d.active, R = d.recovery;
    if (t < W) this.yaw = turnToward(this.yaw, this._aimYaw(this.yaw), TUNE.windupSteer * dt);
    // lunge forward through the strike
    const l0 = W - 0.08, l1 = W + A;
    const lv = t >= l0 && t <= l1 ? d.lunge / (l1 - l0) : 0;
    this.want.x = Math.sin(this.yaw) * lv;
    this.want.z = Math.cos(this.yaw) * lv;

    if (t >= W + A) {
      const r = (t - W - A) / R;
      const b = this.buf.action;
      if (b === 'light') {
        this.buf.action = null;
        const next = d.kind === 'light' ? LIGHT[d.combo % LIGHT.length] : LIGHT[0];
        if (this._startAttack(next)) return;
      } else if (b === 'heavy') {
        this.buf.action = null;
        if (this._startAttack(HEAVY)) return;
      } else if (b === 'roll' && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startRoll()) return;
      } else if (b === 'heal' && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startHeal()) return;
      }
      if (r >= TUNE.moveCancel && this.intent.len > 0.1) {
        this._toLoco(0.14);
        return;
      }
    }
    if (t >= W + A + R) this._toLoco(0.16);
  }

  _startHeal() {
    if (this.flasks <= 0) {
      this._emit('player:noFlask');
      return false;
    }
    this.flasks--;
    this.healApplied = false;
    this.atk = null;
    this._enter('heal', 'heal', 0.12);
    return true;
  }

  _tickHeal(dt) {
    const I = this.intent, t = this.stateT, H = TUNE.heal;
    this.want.x = I.x * TUNE.healSpeed;
    this.want.z = I.z * TUNE.healSpeed;
    this.yaw = dampAngle(this.yaw, this._aimYaw(I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw), 6, dt);
    if (!this.healApplied && t >= H.at) {
      this.healApplied = true;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + H.amount);
      this._emit('player:heal', { amount: this.hp - before, flasks: this.flasks });
      const p = this.position;
      this.fx.healBurst(p.x, p.z);
      if (this.healLight) this.healLight.kill();
      this.healLight = this.game.lights?.add({ x: p.x, y: 1.3, z: p.z, color: [0.6, 1.0, 0.35], intensity: 2.2, radius: 4.5, life: 0.9, fade: 0.6, fadeIn: 0.05 }) ?? null;
    }
    if (t >= H.dur) this._toLoco(0.15);
  }

  _tickKnockdown() {
    const t = this.stateT, p = this.position;
    if (t >= 0.3 && this._once(1)) {
      // the body lands ~half a meter behind the feet
      this.fx.dust(p.x - Math.sin(this.yaw) * 0.6, p.z - Math.cos(this.yaw) * 0.6, 12, 1.2);
      this.game.shake?.(0.15);
    }
    if (t >= TUNE.knockdownDur) this._toLoco(0.12);
  }

  _tickDead() {
    const t = this.stateT, p = this.position;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (t >= 0.5 && this._once(1)) this.fx.dust(p.x, p.z, 5, 0.6);
    if (t >= 1.38 && this._once(2)) {
      this.fx.dust(p.x + fx * 0.6, p.z + fz * 0.6, 14, 1.3);
      this.game.shake?.(0.12);
    }
  }

  _die() {
    if (this.state === 'dead') return;
    this.hp = 0;
    this.atk = null;
    this.buf.action = null;
    this.burnT = 0;
    this.burnAcc = 0;
    this._setLock(false);
    this._enter('dead', 'dead', 0.1);
    this.want.x = this.want.z = 0;
    if (!this.diedEmitted) {
      this.diedEmitted = true;
      this._emit('player:died');
    }
  }

  _setKb(nx, nz, dist) {
    const v = Math.max(0, dist) * TUNE.knockbackDecay; // exp decay → total slide = dist
    this.kb.x = nx * v;
    this.kb.z = nz * v;
  }

  // ------------------------------------------------------------------ movement
  _integrate(dt) {
    if (dt <= 0) return;
    const v = this.vel, w = this.want;
    let lambda;
    switch (this.state) {
      case 'roll':
        v.x = w.x;
        v.z = w.z;
        lambda = 0;
        break;
      case 'attack':
      case 'heavy':
        lambda = 30;
        break;
      case 'stagger':
      case 'knockdown':
      case 'dead':
        lambda = 10;
        break;
      case 'heal':
        lambda = 12;
        break;
      default:
        lambda = w.x * w.x + w.z * w.z > v.x * v.x + v.z * v.z ? TUNE.accel : TUNE.decel;
    }
    if (lambda) {
      v.x = damp(v.x, w.x, lambda, dt);
      v.z = damp(v.z, w.z, lambda, dt);
    }
    const kd = Math.exp(-TUNE.knockbackDecay * dt);
    this.kb.x *= kd;
    this.kb.z *= kd;

    const p = this.position;
    const ox = p.x, oz = p.z;
    p.x += (v.x + this.kb.x) * dt;
    p.z += (v.z + this.kb.z) * dt;
    this._collide();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      p.x = fin(ox, CONFIG.world.playerSpawn.x);
      p.z = fin(oz, CONFIG.world.playerSpawn.z);
      v.x = v.z = this.kb.x = this.kb.z = 0;
    }
    p.y = 0;
    this.groundVel.x = damp(this.groundVel.x, (p.x - ox) / dt, 20, dt);
    this.groundVel.z = damp(this.groundVel.z, (p.z - oz) / dt, 20, dt);
    if (!Number.isFinite(this.groundVel.x + this.groundVel.z)) this.groundVel.x = this.groundVel.z = 0;
  }

  _collide() {
    const p = this.position, r = this.radius;
    const circles = this.game.dragon?.bodyCircles;
    if (Array.isArray(circles)) {
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i];
        if (!c || !(c.r > 0)) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const min = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (!(d2 < min * min)) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          p.x = c.x + (dx / d) * min;
          p.z = c.z + (dz / d) * min;
        } else {
          p.x = c.x - Math.sin(this.yaw) * min;
          p.z = c.z - Math.cos(this.yaw) * min;
        }
      }
    }
    this.game.world?.resolve?.(p, r, CONFIG.world.playerBound);
  }

  _updateStamina(dt) {
    if (this.state === 'sprint') {
      this.stamina -= TUNE.sprintDrain * dt;
      this.staminaDelay = TUNE.regenDelay;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.staminaDelay = TUNE.exhaustDelay;
      }
    } else if (this.staminaDelay > 0) {
      this.staminaDelay -= dt;
    } else if (this.state !== 'dead') {
      this.stamina = Math.min(this.maxStamina, this.stamina + TUNE.regen * dt);
    }
    this.stamina = clamp(fin(this.stamina, 0), 0, this.maxStamina);
  }

  // ------------------------------------------------------------------ burn status
  _updateBurn(dt) {
    // takeHit ignores damage on the title / after victory; burn must not finish the knight off there
    const st = this.game.state;
    if (this.burnT > 0 && (st === 'victory' || st === 'title')) this._clearBurn();
    if (this.burnT > 0 && this.alive) {
      this.burnAcc += TUNE.burnDps * Math.min(dt, this.burnT);
      this.burnT -= dt;
      const tick = TUNE.burnDps * TUNE.burnTick;
      while (this.burnAcc >= tick && this.alive) {
        this.burnAcc -= tick;
        this.hp = Math.max(0, this.hp - tick);
        this._emit('player:hurt', { damage: tick, kind: 'burn', hp: this.hp });
        if (this.hp <= 0) this._die();
      }
      if (this.burnT <= 0) {
        this.burnT = 0;
        this.burnAcc = 0;
      }
    }
    const k = this.burnT > 0 ? clamp(this.burnT / 1.5, 0.35, 1) : 0;
    this.fx.flames(dt, k);
    const p = this.position;
    if (k > 0) {
      if (!this.burnLight || this.burnLight.dead) {
        this.burnLight = this.game.lights?.add({ x: p.x, y: 1, z: p.z, color: [1, 0.45, 0.12], intensity: 1.4, radius: 3.5, flicker: 0.5, fade: 0.3, fadeIn: 0.1 }) ?? null;
      }
      this.burnLight?.set(p.x, 1.0, p.z);
    } else if (this.burnLight) {
      this.burnLight.kill();
      this.burnLight = null;
    }
  }

  _clearBurn() {
    this.burnT = 0;
    this.burnAcc = 0;
    if (this.burnLight) {
      this.burnLight.kill();
      this.burnLight = null;
    }
  }

  // ------------------------------------------------------------------ sword hits
  _combat() {
    const sw = this.sweep;
    if (!sw.sample()) return;
    const a = this.atk;
    if (a && (this.state === 'attack' || this.state === 'heavy')) {
      const d = a.def, t = this.stateT;
      const W = d.windup, end = W + d.active;
      const prevT = a.prevT;
      a.prevT = t;
      // any overlap of this frame with the active window counts (robust to long frames)
      if (t >= W && prevT <= end + 0.04) {
        this.fx.trail(sw.pa, sw.pb, sw.a, sw.b, d.kind === 'heavy');
        if (!a.hit && prevT <= end) this._tryHit(a);
      }
      if (d.kind === 'heavy' && !a.slammed && t >= end) {
        a.slammed = true;
        if (sw.b.y < 0.6) {
          this.fx.slam(sw.b.x, sw.b.z);
          this.game.world?.gust?.(sw.b.x, sw.b.z, 0.7, 5);
          if (!a.hit) this.game.shake?.(0.14);
        }
      }
    }
    sw.commit();
  }

  _tryHit(a) {
    const dr = this.game.dragon;
    if (!dr || typeof dr.takeHit !== 'function') return;
    if (dr.state === 'dead' || dr.state === 'dying') return;
    const spheres = dr.hurtSpheres;
    if (!Array.isArray(spheres) || !spheres.length) return;
    const h = this._hit;
    if (!this.sweep.test(spheres, h)) return;
    a.hit = true; // one hit per swing

    const d = a.def, heavy = d.kind === 'heavy';
    const part = typeof h.sphere.part === 'string' ? h.sphere.part : 'body';
    const crit = part === 'head' && dr.state === 'staggered';
    const damage = crit ? d.damage * 1.5 : d.damage; // raw: the dragon applies part multipliers
    const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const point = { x: h.x, y: h.y, z: h.z };
    let dealt = damage;
    try {
      const r = dr.takeHit({ damage, part, point, dir, poise: d.poise, heavy });
      if (Number.isFinite(r)) dealt = r;
    } catch (err) {
      console.error('[player] dragon.takeHit failed', err);
    }
    this._emit('player:hitDragon', { damage: dealt, part, point, heavy, crit });
    this.game.hitstop?.(d.hitstop);
    this.game.shake?.(d.shake);
    this.fx.sparks(h.x, h.y, h.z, dir.x, dir.z, heavy || crit);
  }

  // ------------------------------------------------------------------ fx / visuals
  _footstep(side) {
    const leg = side < 0 ? this.rig.legs.R : this.rig.legs.L;
    leg.foot.getWorldPosition(this._v);
    const sprint = this.state === 'sprint';
    this._emit('player:footstep', { x: this._v.x, z: this._v.z, sprint });
    if (sprint) this.fx.dust(this._v.x, this._v.z, 2, 0.4);
  }

  _updateFx(dt) {
    const p = this.position;
    if (this.state === 'heal') {
      const t = this.stateT;
      this.fx.healTick(dt, p.x, p.z, smoothstep(0.3, 0.55, t) * (1 - smoothstep(0.8, 0.95, t)));
    }
    if (this.healLight) {
      if (this.healLight.dead) this.healLight = null;
      else this.healLight.set(p.x, 1.3, p.z);
    }
  }

  _updateMaterials(dt) {
    const M = this.rig.materials;
    this.flash = Math.max(0, this.flash - dt * 6);
    const burnTarget = this.burnT > 0 ? 0.28 + 0.1 * Math.sin(this.time * 17) : 0;
    this.burnGlow = damp(this.burnGlow, burnTarget, 8, dt);
    for (const m of this.rig.mats) {
      m.uniforms.uFlash.value = this.flash * 0.85;
      if (m !== M.blade && m !== M.flask) m.uniforms.uGlow.value = this.burnGlow;
    }
    // blade brightens through the strike and charges (cold glow) during the heavy windup
    let ink = 0.3, charge = 0;
    const a = this.atk;
    if (a && (this.state === 'attack' || this.state === 'heavy')) {
      const d = a.def, t = this.stateT;
      if (d.kind === 'heavy') charge = smoothstep(0.05, d.windup, t) * (1 - smoothstep(d.windup + d.active, d.windup + d.active + 0.2, t));
      if (t >= d.windup - 0.05 && t <= d.windup + d.active + 0.1) ink = 1.1;
    }
    const bu = M.blade.uniforms;
    const glow = ink + charge * 1.2;
    bu.uInkGlow.value = dt > 0 ? damp(bu.uInkGlow.value, glow, 18, dt) : glow;
    bu.uGlow.value = charge * 0.7;
  }

  _emit(name, data) {
    this.game.events?.emit(name, data);
  }
}
