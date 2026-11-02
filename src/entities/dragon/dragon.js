import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { markCaster, LAYER_CASTER } from '../../render/pipeline.js';
import { damp, lerp, clamp, turnToward, yawTo, angleDiff, wrapAngle } from '../../core/math.js';
import { TELL, TELL_STYLE, RESULT, POSTURE, tellDefaults } from '../../combat/rules.js';
import { TUNING, SCALE } from './tuning.js';
import { buildWyvern } from './model.js';
import { Rig, createPose, resetPose } from './rig/anim.js';
import { Brain, SEQ } from './ai.js';
import { ATTACKS, MELEE } from './attacks.js';
import { DragonFx } from './fx.js';

// VAELGRIM, THE CINDER WYRM — the boss. Public contract: see docs/ARCHITECTURE.md (Dragon).
// Wiring: Brain (ai.js) writes pose targets + root motion and runs the attack tell beats, Rig
// (rig/anim.js) solves the body, attacks test hitboxes after the rig, DragonFx owns particles /
// lights / projectiles. Combat rules (tells, parry, posture) come from src/combat/rules.js.
// Tells are shown on the wyrm itself: red (dodge-only) hits glow red through the windup (uWarn on
// every material, see _updateWarn), parryable hits glint white on the timing cue (fx.tellFlash).

const S = SCALE;
const TARGETABLE = new Set(['waking', 'combat', 'staggered', 'airborne']);
const POSTURE_STATES = new Set(['combat', 'staggered', 'airborne']);
const PARTS = TUNING.partMult;
// hurt volumes in v0.1 metres (x SCALE): order matches _refreshHurt
const HURT = [
  ['head', 0.85], ['neck', 0.62], ['neck', 0.56], ['neck', 0.5],
  ['body', 1.35], ['body', 1.45], ['body', 1.35],
  ['tail', 0.62], ['tail', 0.5], ['tail', 0.38], ['tail', 0.28],
  ['wing', 0.45], ['wing', 0.45], ['wing', 0.55], ['wing', 0.45], ['wing', 0.45], ['wing', 0.55],
  ['leg', 0.6], ['leg', 0.42], ['leg', 0.6], ['leg', 0.42],
];
const MAX_ATK_BOXES = 32;
// red windup glow (TELL_STYLE.red.warn): rgb + strength ramp / spike / decay
const WARN = TELL_STYLE.red.warn ?? { color: [1.0, 0.12, 0.05], from: 0.15, to: 0.6, spike: 1.6, decay: 0.25 };
const WARN_RGB = WARN.color;

export class Dragon {
  constructor(game) {
    this.game = game;
    this.name = 'VAELGRIM, THE CINDER WYRM';
    this.model = buildWyvern(game.U);
    this.object3d = this.model.root;
    this.position = this.object3d.position;
    this.yaw = 0;
    this.maxHp = TUNING.maxHp;
    this.hp = this.maxHp;
    this.phase = 1;
    this.maxPosture = TUNING.posture.max[0];
    this.posture = 0;
    this.broken = false;
    this.state = 'sleeping';
    this.time = 0;
    this.resetting = false;

    this.hurtSpheres = [];
    this.bodyCircles = [];
    // fixed pools; the public arrays are refilled from these every frame (stable identities)
    this._hurtPool = HURT.map(([part, r]) => ({ x: 0, y: 0, z: 0, r: r * S, part, mult: PARTS[part] ?? 1 }));
    this._circlePool = [
      { x: 0, z: 0, r: 1.5 * S },
      { x: 0, z: 0, r: 1.4 * S },
      { x: 0, z: 0, r: 1.0 * S },
    ];
    // debug hitboxes: attack spheres tested this frame (+ a stable output array for the Lab)
    this._atkBoxes = Array.from({ length: MAX_ATK_BOXES }, () => ({ x: 0, y: 0, z: 0, r: 0, kind: 'attack' }));
    this._atkN = 0;
    this._hbHurt = this._hurtPool.map(() => ({ x: 0, y: 0, z: 0, r: 0, kind: 'hurt', part: '' }));
    this._hbOut = [];

    this.sense = {
      pos: new THREE.Vector3(),
      chest: new THREE.Vector3(0, 1.2, 0),
      vel: new THREE.Vector3(),
      last: new THREE.Vector3(),
      hasLast: false,
      dist: 99,
      ang: 0,
      absAng: 0,
      yawTo: 0,
    };
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.flinchDir = { x: 0, z: 0 };
    this._tmp = new THREE.Vector3();
    this._part = new THREE.Vector3();
    this._hitPt = new THREE.Vector3();
    this._lastParry = -1;
    this._postureSent = -1;
    this.postureTimer = 0;
    this.warn = 0; // current red tell glow strength (uWarn.a)
    this._warnAt = -1; // this.time of the last red timing flash (-1 = no spike)
    this._warnAction = null; // the action that flashed it (a replaced action drops the spike)

    this.pose = createPose();
    this.rig = new Rig(this.model, this);
    this.fx = new DragonFx(this);
    this.brain = new Brain(this);
    this.debug = createDebug(this);

    markCaster(this.object3d);
    game.scene.add(this.object3d);
    this.reset();
  }

  // ---------------------------------------------------------------- public API
  get turnRate() {
    return TUNING.turnSpeed[this.phase === 2 ? 1 : 0];
  }
  /** Radius (m, around the arena centre) the root stays inside: see TUNING.bound. */
  get bound() {
    const B = Number(this.game.CONFIG?.world?.dragonBound ?? CONFIG.world.dragonBound);
    return Math.min(Number.isFinite(B) ? B : 26, TUNING.bound ?? Infinity);
  }
  /** Phase-2 speed-up of windups + recoveries (TUNING.phase2TimeScale). */
  get tScale() {
    return this.phase === 2 ? TUNING.phase2TimeScale : 1;
  }

  isTargetable() {
    return TARGETABLE.has(this.state);
  }

  lockPoint(out) {
    const c = this.rig.pt.chest;
    if (Number.isFinite(c.x + c.y + c.z) && (c.x || c.y || c.z)) return out.copy(c);
    return out.set(this.position.x, 2.4 * S, this.position.z);
  }

  startIntro() {
    if (this.state !== 'sleeping') return;
    this.brain.wakeFallback = -1;
    this.brain.startAction(SEQ.intro);
  }

  takeHit(o = {}) {
    if (this.state === 'dying' || this.state === 'dead') return 0;
    o = o || {};
    const raw = Number(o.damage);
    if (!(raw > 0)) return 0;
    const part = PARTS[o.part] !== undefined ? o.part : 'body';
    const broken = this.broken;
    // the player already multiplied a Ghostep crit; a broken posture opens every hit to crits
    const dmg = Math.max(1, Math.round(raw * PARTS[part] * (broken ? POSTURE.breakCritMult : 1)));
    const crit = !!o.crit || broken;
    // phase 2 always plays: in a running fight, phase-1 damage stops at the threshold until the
    // transition starts (crits on a broken wyrm could otherwise skip the whole second phase, or kill
    // it during the transition windup). The Lab's AI-off mode keeps plain damage (debug.phase2 / kill exist).
    let hp = this.hp - dmg;
    const gate = this.maxHp * TUNING.phase2At;
    if (this.phase === 1 && this.brain.aiEnabled && this.hp >= gate) hp = Math.max(gate, hp);
    this.hp = Math.max(0, hp);
    this.flash = Math.max(this.flash, o.heavy || crit ? 1 : 0.8);

    // flinch along the blow (fallback: away from the player)
    let dx = Number(o.dir?.x), dz = Number(o.dir?.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || dx * dx + dz * dz < 1e-6) {
      const p = this.game.player?.position;
      dx = p ? this.position.x - p.x : 0;
      dz = p ? this.position.z - p.z : 1;
    }
    const l = Math.hypot(dx, dz) || 1;
    this.flinchDir.x = dx / l;
    this.flinchDir.z = dz / l;
    this.flinch = Math.min(1.2, this.flinch + (part === 'head' ? 0.9 : 0.3) * (o.heavy ? 1.3 : 1));
    this.flinchHead = part === 'head';
    const pt = o.point;
    if (pt && Number.isFinite(pt.x + pt.y + pt.z)) this.fx.hitSpark(pt.x, pt.y, pt.z, this.flinchDir.x, this.flinchDir.z, !!o.heavy || crit);

    this.emit('dragon:hurt', { damage: dmg, part, hp: this.hp, crit });

    if (this.state === 'sleeping') {
      // flow should call startIntro(); wake on our own shortly if it doesn't
      if (this.brain.wakeFallback <= 0) this.brain.wakeFallback = 0.6;
    }
    if (this.hp <= 0) {
      this.brain.die();
      return dmg;
    }
    // posture: light / heavy weapon hits (the old `poise` value scales it around its v0.1 norm)
    if (!broken && POSTURE_STATES.has(this.state)) {
      const heavy = !!o.heavy;
      let gain = heavy ? POSTURE.hit.heavy : POSTURE.hit.light;
      const poise = Number(o.poise);
      if (Number.isFinite(poise) && poise > 0) gain *= clamp(poise / (heavy ? 40 : 12), 0.6, 1.5);
      if (part === 'head') gain *= TUNING.posture.headMult;
      this.addPosture(gain);
    }
    if (this.phase === 1 && this.hp <= this.maxHp * TUNING.phase2At) this.brain.pendingPhase2 = true;
    return dmg;
  }

  /** Called after player.takeHit returned 'parried' (by hitPlayer; a second call the same instant is ignored). */
  onParried(info = {}) {
    if (this.state === 'dying' || this.state === 'dead' || this.state === 'sleeping') return;
    if (this.time - this._lastParry < 0.1) return;
    this._lastParry = this.time;
    const attack = info?.attack ?? this.brain.action?.cur?.attack ?? this.brain.action?.name ?? null;
    const tell = info?.tell === TELL.BLUE ? TELL.BLUE : TELL.NORMAL;
    this.emit('dragon:parried', { attack, tell });
    const h = this._hitPt;
    this.fx.parrySpark(h.x, h.y, h.z, tell);
    this.flash = Math.max(this.flash, 0.6);
    // a parried melee swing is cancelled: head snaps back (projectiles just fizzle)
    const a = this.brain.action;
    if (a && MELEE.has(a.name) && (attack == null || attack === a.name) && this.state === 'combat') this.brain.recoil();
    this.addPosture(POSTURE.parry[tell] ?? POSTURE.parry.normal);
  }

  reset() {
    this.resetting = true; // interrupted actions skip their gameplay side effects (landing slam...)
    try {
      this.brain.reset();
    } finally {
      this.resetting = false;
    }
    this.fx.reset();
    this._clearWarn();
    this.state = 'sleeping';
    this.hp = this.maxHp;
    this.phase = 1;
    this.maxPosture = TUNING.posture.max[0];
    this.posture = 0;
    this.broken = false;
    this.postureTimer = 0;
    this._lastParry = -1;
    this._atkN = 0;
    this.flash = 0;
    this.glow = 0;
    this.glowTarget = 0;
    this.throat = 0;
    this.throatGlow = 0;
    this.dissolve = 0;
    this.flinch = 0;
    this.flinchHead = false;
    const s = CONFIG.world.dragonSleep;
    this.position.set(s.x, 0, s.z);
    this.yaw = s.yaw ?? 0;
    this.object3d.visible = true;
    this.setShadowCasting(true);
    this.sense.hasLast = false;
    this.game.world?.clearPushers?.(1, 10);
    resetPose(this.pose);
    this.pose.sleep = 1;
    this.pose.eyes = 0;
    this.rig.snap();
    this._step(1 / 60);
    this.emitPosture(true);
  }

  update(dt) {
    if (!(dt > 0)) return; // paused / hit-stop at zero: keep the last pose and hitboxes
    this._step(Math.min(dt, 0.05));
  }

  // ---------------------------------------------------------------- posture
  addPosture(amount) {
    if (this.broken || !(amount > 0)) return;
    this.posture = Math.min(this.maxPosture, this.posture + amount);
    this.postureTimer = 0;
    this.emitPosture();
    if (this.posture >= this.maxPosture) this.brain.requestBreak();
  }

  /** 'dragon:posture' when the meter moved by >= 1 (or on resets with force). */
  emitPosture(force = false) {
    const p = this.posture;
    if (!force && Math.abs(p - this._postureSent) < 1 && !(p === 0 && this._postureSent !== 0)) return;
    this._postureSent = p;
    this.emit('dragon:posture', { posture: p, max: this.maxPosture });
  }

  _updatePosture(dt) {
    this.postureTimer += dt;
    if (this.broken || this.brain.pendingBreak || this.posture <= 0) return;
    if (this.postureTimer > POSTURE.regenDelay) {
      this.posture = Math.max(0, this.posture - POSTURE.regenRate * dt);
      this.emitPosture();
    }
  }

  /** Phase 2 begins (the transition roar's start): bigger posture meter, emptied (incl. a waiting break). */
  enterPhase2() {
    this.phase = 2;
    this.brain.pendingPhase2 = false;
    this.brain.pendingBreak = false;
    this.maxPosture = TUNING.posture.max[1];
    this.posture = 0;
    this.postureTimer = 0;
    this.emitPosture(true);
  }

  // ---------------------------------------------------------------- helpers for brain/attacks
  emit(name, data) {
    this.game.events?.emit(name, data);
  }

  /**
   * Freeze-frame that never crushes a longer, gentler slow-mo already running (the Ghostep's):
   * game.hitstop keeps the harsher scale for the longer timer, so a posture break right after a
   * Ghostep would otherwise freeze the rest of the slow-mo.
   */
  hitstop(sec, scale = 0.04) {
    const g = this.game;
    if ((g.hitstopTimer ?? 0) > sec && (g.hitstopScale ?? 1) > scale) return;
    g.hitstop?.(sec, scale);
  }

  rootToWorld(out, x, y, z) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.position.x + x * c + z * s, y, this.position.z - x * s + z * c);
  }

  /** Root-frame point in MODEL units (the v0.1 layout) -> world, scaled by SCALE. */
  rootPt(out, x, y, z) {
    return this.rootToWorld(out, x * S, y * S, z * S);
  }

  turnToward(target, rate, dt) {
    if (!Number.isFinite(target)) return;
    const before = this.yaw;
    this.yaw = turnToward(this.yaw, target, rate * dt);
    if (Math.abs(angleDiff(before, this.yaw)) > 1e-4) this.pose.speed = Math.max(this.pose.speed, 1.2);
  }

  /** Move along the facing; collides with stones + arena bound. Returns the distance moved. */
  moveForward(speed, dt) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const x0 = this.position.x, z0 = this.position.z;
    this.position.x += fx * speed * dt;
    this.position.z += fz * speed * dt;
    this._collide();
    const moved = Math.hypot(this.position.x - x0, this.position.z - z0);
    if (dt > 0) this.pose.vel.set((this.position.x - x0) / dt, 0, (this.position.z - z0) / dt);
    this.pose.speed = Math.max(this.pose.speed, speed);
    return moved;
  }

  _collide() {
    const R = TUNING.radius, B = this.bound;
    if (this.state === 'airborne') {
      const d = Math.hypot(this.position.x, this.position.z);
      if (d > B) this.position.multiplyScalar(B / d);
    } else this.game.world?.resolve?.(this.position, R, B + R);
    this.position.y = 0;
  }

  /**
   * Deal damage to the player with the hit's tell data (from `o`, else the action's current beat,
   * else the attack's tuning). Returns the player's RESULT. A parry triggers onParried().
   */
  hitPlayer(o, a = null) {
    const p = this.game.player;
    if (!p?.takeHit || p.alive === false) return RESULT.IGNORED;
    // a fallen wyrm deals no more damage: shells still in flight during the death sequence only explode
    if (this.state === 'dying' || this.state === 'dead') return RESULT.IGNORED;
    const cur = a?.cur;
    const attack = o.attack ?? cur?.attack ?? a?.name ?? 'hit';
    const tell = o.tell ?? cur?.tell ?? TUNING.attacks[attack]?.tell ?? TELL.NORMAL;
    const def = tellDefaults(tell);
    const spec = TUNING.attacks[attack];
    const parryable = o.parryable ?? cur?.parryable ?? spec?.parryable ?? def.parryable;
    const blockable = o.blockable ?? cur?.blockable ?? spec?.blockable ?? def.blockable;
    const from = o.from ? { x: o.from.x, z: o.from.z } : { x: this.position.x, z: this.position.z };
    const pt = o.point ?? o.from;
    if (pt && Number.isFinite(pt.x + (pt.y ?? 0) + pt.z)) this._hitPt.set(pt.x, pt.y ?? 1, pt.z);
    else this._hitPt.set(this.position.x, 1.5 * S, this.position.z);
    let r;
    try {
      r = p.takeHit({
        damage: o.damage,
        from,
        knockback: o.knockback ?? 0,
        knockdown: !!o.knockdown,
        kind: o.kind ?? 'hit',
        burn: o.burn ?? 0,
        tell,
        parryable,
        blockable,
        attack,
        attacker: this,
      });
    } catch (err) {
      console.error('[dragon] player.takeHit failed', err);
      return RESULT.IGNORED;
    }
    if (r === RESULT.PARRIED) this.onParried({ attack, tell });
    return r ?? RESULT.IGNORED;
  }

  /** One result per hit: any answer (hit, block, parry, dodge, Ghostep) consumes the activation. */
  strike(a, o) {
    if (a.hitDone) return RESULT.IGNORED;
    const r = this.hitPlayer(o, a);
    if (r && r !== RESULT.IGNORED) a.hitDone = true;
    return r;
  }

  /** World position of a named striking part (for tells / flashes). */
  partPos(part, a, b, out) {
    const pt = this.rig.pt;
    switch (part) {
      case 'snout':
        return out.copy(pt.snout);
      case 'head':
        return out.copy(pt.head);
      case 'mouth':
        return out.copy(pt.mouth);
      case 'claw':
        return out.copy(pt.wings[b?.wi ?? 0]?.wrist ?? pt.chest);
      case 'wrists':
        return out.lerpVectors(pt.wings[0].wrist, pt.wings[1].wrist, 0.5);
      case 'tailTip': {
        const t = this.rig.tail;
        return out.copy(t.p[t.n]);
      }
      case 'shell':
        if (a?.volley && this.fx.shellPos(a.volley, out)) return out;
        return out.copy(pt.mouth);
      default:
        return out.copy(pt.chest);
    }
  }

  /** Windup start of one hit: 'combat:tell' (HUD mark, audio, timing trainer). */
  announceTell(a, b) {
    const p = this.partPos(b.part, a, b, this._part);
    this.emit('combat:tell', { source: 'dragon', attack: b.attack, tell: b.tell, impactIn: b.impactIn, x: p.x, z: p.z });
  }

  /**
   * The timing cue, flashLead s before impact: 'combat:flash' + the in-world flash at the striking
   * part (white glint for parryable tells, red burst for red) and, for red, the body's warning spike.
   */
  flashTell(a, b) {
    const p = this.partPos(b.part, a, b, this._part);
    this.emit('combat:flash', { source: 'dragon', attack: b.attack, tell: b.tell, x: p.x, y: p.y, z: p.z });
    if (b.tell === TELL.RED) {
      this._warnAt = this.time;
      this._warnAction = a;
    }
    if (b.part === 'wrists') {
      const w = this.rig.pt.wings;
      this.fx.tellFlash(b.tell, w[0].wrist.x, w[0].wrist.y, w[0].wrist.z);
      this.fx.tellFlash(b.tell, w[1].wrist.x, w[1].wrist.y, w[1].wrist.z);
    } else this.fx.tellFlash(b.tell, p.x, p.y, p.z);
    const z = a.def?.zone;
    if (typeof z === 'function') {
      const r = z(this, a, this._tmp);
      if (r > 0) this.fx.ringPulse(this._tmp.x, this._tmp.z, r, b.tell);
    }
  }

  /** Debug: an attack sphere tested this frame (Lab hitbox overlay). */
  markHitbox(x, y, z, r) {
    if (this._atkN >= MAX_ATK_BOXES || !Number.isFinite(x + y + z + r)) return;
    const b = this._atkBoxes[this._atkN++];
    b.x = x;
    b.y = y;
    b.z = z;
    b.r = r;
  }

  onStep(limb) {
    if (this.state === 'dead') return;
    this.emit('dragon:step', { x: limb.pos.x, z: limb.pos.z, heavy: !!limb.hind });
    const charging = this.brain.action?.name === 'charge' && this.brain.action.phase === 'active';
    if (charging && limb.hind) this.game.shake?.(0.07);
    const n = limb.hind ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx._spawn(this.fx.alpha, {
        x: limb.pos.x, y: 0.2, z: limb.pos.z,
        vx: Math.cos(a) * 2.2 * S, vy: 0.5 + Math.random(), vz: Math.sin(a) * 2.2 * S,
        life: 0.5 + Math.random() * 0.3, size: 0.35 * S, sizeEnd: 0.8 * S, glyph: ",.`",
        color: [0.18, 0.17, 0.15], alpha: 0.6, alphaEnd: 0, drag: 3,
      });
    }
  }

  onFlap(strength) {
    this.emit('dragon:wingFlap', { strength });
    this.game.world?.gust?.(this.position.x, this.position.z, Math.min(2, 0.6 + strength * 1.6), 14 * S);
  }

  /** `volley` ({hitDone}) caps a phase-2 volley at one hit; each shell must still be dodged. */
  onExplosion(x, z, radius, volley = null) {
    const g = this.game;
    this.emit('dragon:explosion', { x, z, radius });
    const p = g.player?.position;
    const dist = p ? Math.hypot(p.x - x, p.z - z) : 99;
    g.shake?.(dist < 15 ? 0.3 : 0.12);
    g.world?.gust?.(x, z, 1.0, 8);
    if (p && !volley?.hitDone && dist <= radius + (g.player.radius ?? 0.45)) {
      const T = TUNING.attacks.fireball;
      const r = this.hitPlayer({ damage: T.damage, from: { x, z }, knockback: 2.5, kind: 'fireball', burn: T.burn, attack: 'fireball', point: { x, y: 0.6, z } });
      if (r === RESULT.HIT && volley) volley.hitDone = true;
    }
  }

  setShadowCasting(on) {
    this.object3d.traverse((o) => {
      if (on) o.layers.enable(LAYER_CASTER);
      else o.layers.disable(LAYER_CASTER);
    });
  }

  finishDeath() {
    this.state = 'dead';
    this.dissolve = 1;
    this.broken = false;
    this._clearWarn();
    this.object3d.visible = false;
    this.hurtSpheres.length = 0;
    this.bodyCircles.length = 0;
    this.game.world?.clearPushers?.(1, 10);
    this.emit('dragon:dead');
  }

  // ---------------------------------------------------------------- frame
  _sensePlayer(dt) {
    const s = this.sense, p = this.game.player;
    if (!p?.position) return;
    const pos = p.position;
    if (!Number.isFinite(pos.x + pos.z)) return;
    if (s.hasLast && dt > 0) {
      const vx = (pos.x - s.last.x) / dt, vz = (pos.z - s.last.z) / dt;
      if (vx * vx + vz * vz > 400) {
        // a teleport (Ghostep, respawn, Lab): don't fling the aim / timing predictions
        s.vel.set(0, 0, 0);
      } else {
        const k = 1 - Math.exp(-10 * dt);
        s.vel.x += (vx - s.vel.x) * k;
        s.vel.z += (vz - s.vel.z) * k;
        s.vel.y = 0;
        if (s.vel.lengthSq() > 144) s.vel.setLength(12);
      }
    }
    s.last.copy(pos);
    s.hasLast = true;
    s.pos.copy(pos);
    if (typeof p.getChestPos === 'function') p.getChestPos(s.chest);
    else s.chest.set(pos.x, pos.y + 1.2, pos.z);
    if (!Number.isFinite(s.chest.x + s.chest.y + s.chest.z)) s.chest.set(pos.x, 1.2, pos.z);
    const dx = pos.x - this.position.x, dz = pos.z - this.position.z;
    s.dist = Math.hypot(dx, dz);
    s.yawTo = yawTo(this.position.x, this.position.z, pos.x, pos.z);
    s.ang = angleDiff(this.yaw, s.yawTo);
    s.absAng = Math.abs(s.ang);
  }

  _step(dt) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * TUNING.flashDecay);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this._updatePosture(dt);

    if (this.state === 'dead') {
      this.fx.update(dt);
      return;
    }

    this._sensePlayer(dt);
    this._atkN = 0; // attack spheres are re-marked by this frame's phase changes + hit tests
    this.brain.update(dt);

    // root sanity
    if (!Number.isFinite(this.position.x + this.position.z)) {
      const s = CONFIG.world.dragonSleep;
      this.position.set(s.x, 0, s.z);
    }
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    this.yaw = wrapAngle(this.yaw);
    this.position.y = 0;
    this.object3d.rotation.set(0, this.yaw, 0);
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    this.rig.update(dt, this.pose);
    this.brain.postRig(dt);
    if (this.state === 'dead') return; // the death sequence may have just finished

    this._refreshHurt();
    this._refreshPushers();
    this.fx.update(dt);
    if (this.state !== 'dying') {
      this.fx.eyeGlints(dt, this.rig.pt.eyes, this.rig.s.eyes);
      if (this.phase === 2) this.fx.bodyEmbers(dt, this.hurtSpheres, 22, false);
    }
    this._applyMaterials(dt);
  }

  _refreshHurt() {
    const pt = this.rig.pt, nk = this.rig.neck.p, tl = this.rig.tail.p, P = this._hurtPool;
    const set = (i, v) => {
      const h = P[i];
      h.x = v.x;
      h.y = v.y;
      h.z = v.z;
    };
    const t = this._tmp;
    set(0, t.copy(pt.head).addScaledVector(pt.headFwd, 0.55 * S));
    set(1, nk[2]);
    set(2, nk[4]);
    set(3, nk[Math.min(6, nk.length - 1)]);
    set(4, pt.chest);
    set(5, t.lerpVectors(pt.chest, pt.hips, 0.5));
    set(6, pt.hips);
    set(7, tl[3]);
    set(8, tl[6]);
    set(9, tl[9]);
    set(10, tl[Math.min(12, tl.length - 1)]);
    for (let k = 0; k < 2; k++) {
      const w = pt.wings[k];
      set(11 + k * 3, w.elbow);
      set(12 + k * 3, w.wrist);
      set(13 + k * 3, w.mids[1]);
    }
    for (let k = 0; k < 2; k++) {
      const l = pt.legs[k];
      set(17 + k * 2, t.lerpVectors(l.hip, l.knee, 0.5));
      set(18 + k * 2, l.ankle);
    }

    const H = this.hurtSpheres;
    H.length = 0;
    if (this.state !== 'dying' && this.state !== 'dead') for (const h of P) H.push(h);

    const C = this.bodyCircles, cp = this._circlePool;
    C.length = 0;
    if (this.state !== 'airborne' && this.state !== 'dead' && this.rig.s.alt < 1.2) {
      cp[0].x = pt.chest.x;
      cp[0].z = pt.chest.z;
      cp[1].x = pt.hips.x;
      cp[1].z = pt.hips.z;
      cp[2].x = pt.neckBase.x;
      cp[2].z = pt.neckBase.z;
      C.push(cp[0], cp[1], cp[2]);
    }
  }

  _refreshPushers() {
    const W = this.game.world;
    if (!W?.setPusher) return;
    const pt = this.rig.pt, tl = this.rig.tail.p, s = this.rig.s;
    const lying = Math.max(s.sleep, s.dead);
    for (let k = 0; k < 2; k++) {
      const toe = pt.legs[k].toe;
      W.setPusher(1 + k, toe.x, toe.y, toe.z, 1.1 * S);
      const w = pt.wings[k].wrist;
      W.setPusher(3 + k, w.x, w.y - 0.3 * S, w.z, 1.0 * S);
    }
    const bodyY = s.alt > 1 ? 5 : 0.4;
    const br = lerp(1.4, 2.3, lying) * S;
    W.setPusher(5, pt.chest.x, bodyY, pt.chest.z, br);
    W.setPusher(6, pt.hips.x, bodyY, pt.hips.z, br);
    W.setPusher(7, tl[4].x, tl[4].y - 0.4 * S, tl[4].z, 0.9 * S);
    W.setPusher(8, tl[8].x, tl[8].y - 0.4 * S, tl[8].z, 0.75 * S);
    const last = tl[Math.min(12, tl.length - 1)];
    W.setPusher(9, last.x, last.y - 0.4 * S, last.z, 0.6 * S);
  }

  /**
   * Crack glow per material (model.glow: [phase-1 ember baseline, x glow, x throat charge]): the
   * lava parts smoulder from the start, phase 2 (glow 0.5) and death (0.85) brighten everything,
   * the throat / maw flare while the breath or roar charges. Then hit flash, dissolve, red tell.
   */
  _applyMaterials(dt) {
    const m = this.model.mats, G = this.model.glow ?? {};
    this.glow = damp(this.glow, this.glowTarget, 1.2, dt);
    this.throatGlow = damp(this.throatGlow, this.throat, 4, dt);
    const t = this.time;
    const ember = 0.82 + 0.18 * Math.sin(t * 1.7) * Math.sin(t * 0.63 + 1.1); // slow smoulder
    const body = this.glow * (0.85 + 0.15 * Math.sin(t * 2.3));
    const throat = this.throatGlow;
    const flash = this.flash * 0.55;
    const eyes = this.rig.s.eyes;
    const warn = this._updateWarn();
    for (const k in m) {
      const u = m[k].uniforms;
      const g = G[k];
      if (g) {
        const v = g[0] * ember + g[1] * body + g[2] * throat;
        u.uGlow.value = Number.isFinite(v) ? v : 0;
      }
      u.uFlash.value = flash;
      u.uDissolve.value = this.dissolve;
      const w = u.uWarn?.value;
      if (w?.isVector4) w.set(WARN_RGB[0], WARN_RGB[1], WARN_RGB[2], warn);
    }
    if (m.eye) {
      m.eye.uniforms.uGlow.value = eyes;
      m.eye.uniforms.uInkGlow.value = eyes * 2.5;
    }
  }

  /**
   * Red (dodge-only) tell glow, uWarn.a on every material. From a red hit's windup start
   * ('combat:tell') to its timing cue ('combat:flash', flashLead s before impact) it ramps
   * WARN.from -> WARN.to; the cue spikes it to WARN.spike, then it decays to 0 over WARN.decay s.
   * The ramp is read from the running action's beats every frame, so a replaced action (stagger,
   * posture break, parry recoil, death, Lab interrupt) drops it at once; the spike belongs to the
   * action that flashed it and goes with it. Game time: slow-mo stretches it with the attack.
   */
  _updateWarn() {
    const a = this.brain.action;
    let w = 0;
    if (a && this.state !== 'dying' && this.state !== 'dead') {
      const B = a.beats, lead = TUNING.flashLead;
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (!b.told) break; // beats are in time order
        if (b.flashed || b.tell !== TELL.RED) continue;
        const k = clamp((a.T - b.at) / Math.max(0.05, b.impactIn - lead), 0, 1);
        const v = WARN.from + (WARN.to - WARN.from) * k;
        if (v > w) w = v;
      }
    }
    if (this._warnAt >= 0) {
      const age = this.time - this._warnAt;
      if ((a && a !== this._warnAction) || !(age >= 0) || age >= WARN.decay) {
        this._warnAt = -1;
        this._warnAction = null;
      } else {
        const f = 1 - age / WARN.decay;
        const v = WARN.spike * f * f;
        if (v > w) w = v;
      }
    }
    this.warn = Number.isFinite(w) ? w : 0;
    return this.warn;
  }

  /** Drop the red tell glow now (reset, death) and write it to the materials. */
  _clearWarn() {
    this.warn = 0;
    this._warnAt = -1;
    this._warnAction = null;
    const m = this.model?.mats;
    if (!m) return;
    for (const k in m) {
      const w = m[k].uniforms?.uWarn?.value;
      if (w?.isVector4) w.w = 0;
    }
  }
}

/** Lab / dev API (generic shape every enemy implements — see ARCHITECTURE.md). */
function createDebug(d) {
  const alive = () => d.state !== 'dying' && d.state !== 'dead';
  const dbg = {
    abilities() {
      const out = [];
      for (const name in ATTACKS) {
        const t = TUNING.attacks[name] ?? {};
        out.push({ name, label: t.label ?? name, tell: t.tell ?? TELL.NORMAL, phase: t.phase ?? 1 });
      }
      return out;
    },
    /** Force an ability now (wakes / starts the fight first; quick turn toward the player). */
    trigger(name) {
      const def = ATTACKS[name];
      if (!def || !alive()) return false;
      if (d.state === 'sleeping' || d.state === 'waking') dbg.startFight();
      if (d.state === 'airborne') return false; // mid-leap: let it land first
      d.brain.force(def);
      return true;
    },
    setAI(enabled) {
      d.brain.aiEnabled = !!enabled;
      if (!enabled) d.brain.queued = null;
      return d.brain.aiEnabled;
    },
    get aiEnabled() {
      return d.brain.aiEnabled;
    },
    wake() {
      if (d.state !== 'sleeping') return false;
      d.startIntro();
      return true;
    },
    /** Skip the intro: stand up facing the player, combat state, 'dragon:introDone'. */
    startFight() {
      if (!alive()) return false;
      if (d.state !== 'sleeping' && d.state !== 'waking') return true;
      const b = d.brain;
      b.wakeFallback = -1;
      if (b.action) b.stopAction(true);
      d.yaw = d.sense.hasLast ? d.sense.yawTo : d.yaw;
      d.rig.s.sleep = 0;
      d.rig.s.eyes = 1;
      d.rig.snap();
      b.beginCombat();
      return true;
    },
    phase2() {
      if (!alive()) return false;
      if (d.state === 'sleeping' || d.state === 'waking') dbg.startFight();
      if (d.state === 'airborne') return false;
      d.brain.queued = null;
      d.brain.startAction(SEQ.phase2);
      return true;
    },
    stagger() {
      if (!alive() || d.state === 'sleeping' || d.state === 'waking' || d.state === 'airborne') return false;
      d.brain.queued = null;
      d.brain.stagger();
      return true;
    },
    postureBreak() {
      if (!alive()) return false;
      if (d.state === 'sleeping' || d.state === 'waking') dbg.startFight();
      if (d.state === 'airborne') return false;
      d.brain.queued = null;
      d.posture = d.maxPosture;
      d.brain.startAction(SEQ.postureBreak);
      return true;
    },
    kill() {
      if (!alive()) return false;
      d.hp = 0;
      d.brain.die();
      return true;
    },
    reset() {
      d.reset();
      return true;
    },
    setHp(fraction) {
      if (!alive()) return false;
      const f = clamp(Number(fraction), 0, 1);
      if (!Number.isFinite(f)) return false;
      d.hp = Math.round(d.maxHp * f);
      if (d.hp <= 0) return dbg.kill();
      // (asleep: the roar plays once the fight runs — brain.update only starts it in combat)
      if (d.phase === 1 && d.hp <= d.maxHp * TUNING.phase2At) d.brain.pendingPhase2 = true;
      return true;
    },
    /** Hurt spheres + attack spheres tested this frame. Reuses its objects: copy if you keep them. */
    hitboxes() {
      const out = d._hbOut;
      out.length = 0;
      const H = d.hurtSpheres;
      for (let i = 0; i < H.length && i < d._hbHurt.length; i++) {
        const s = H[i], b = d._hbHurt[i];
        b.x = s.x;
        b.y = s.y;
        b.z = s.z;
        b.r = s.r;
        b.part = s.part;
        out.push(b);
      }
      for (let i = 0; i < d._atkN; i++) out.push(d._atkBoxes[i]);
      return out;
    },
  };
  return dbg;
}
