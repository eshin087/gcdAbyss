import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { markCaster, LAYER_CASTER } from '../../render/pipeline.js';
import { damp, lerp, turnToward, yawTo, angleDiff, wrapAngle } from '../../core/math.js';
import { TUNING } from './tuning.js';
import { buildWyvern } from './model.js';
import { Rig, createPose, resetPose } from './rig/anim.js';
import { Brain, SEQ } from './ai.js';
import { DragonFx } from './fx.js';

// VAELGRIM, THE CINDER WYRM — the boss. Public contract: see docs/ARCHITECTURE.md (Dragon).
// Wiring: Brain (ai.js) writes pose targets + root motion, Rig (rig/anim.js) solves the body,
// attacks/sequences test hitboxes after the rig, DragonFx owns particles/lights/projectiles.

const TARGETABLE = new Set(['waking', 'combat', 'staggered', 'airborne']);
const PARTS = TUNING.partMult;

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
    this.state = 'sleeping';
    this.time = 0;
    this.resetting = false;

    this.hurtSpheres = [];
    this.bodyCircles = [];
    // fixed pools; the public arrays are refilled from these every frame (stable identities)
    this._hurtPool = [];
    const addHurt = (part, r) => this._hurtPool.push({ x: 0, y: 0, z: 0, r, part, mult: PARTS[part] ?? 1 });
    addHurt('head', 0.85);
    addHurt('neck', 0.62);
    addHurt('neck', 0.56);
    addHurt('neck', 0.5);
    addHurt('body', 1.35);
    addHurt('body', 1.45);
    addHurt('body', 1.35);
    addHurt('tail', 0.62);
    addHurt('tail', 0.5);
    addHurt('tail', 0.38);
    addHurt('tail', 0.28);
    for (let k = 0; k < 2; k++) {
      addHurt('wing', 0.45);
      addHurt('wing', 0.45);
      addHurt('wing', 0.55);
    }
    for (let k = 0; k < 2; k++) {
      addHurt('leg', 0.6);
      addHurt('leg', 0.42);
    }
    this._circlePool = [
      { x: 0, z: 0, r: 1.5 },
      { x: 0, z: 0, r: 1.4 },
      { x: 0, z: 0, r: 1.0 },
    ];

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

    this.pose = createPose();
    this.rig = new Rig(this.model, this);
    this.fx = new DragonFx(this);
    this.brain = new Brain(this);

    markCaster(this.object3d);
    game.scene.add(this.object3d);
    this.reset();
  }

  // ---------------------------------------------------------------- public API
  get turnRate() {
    return TUNING.turnSpeed[this.phase === 2 ? 1 : 0];
  }
  get recScale() {
    return this.phase === 2 ? TUNING.recoveryScaleP2 : 1;
  }

  isTargetable() {
    return TARGETABLE.has(this.state);
  }

  lockPoint(out) {
    const c = this.rig.pt.chest;
    if (Number.isFinite(c.x + c.y + c.z) && (c.x || c.y || c.z)) return out.copy(c);
    return out.set(this.position.x, 2.4, this.position.z);
  }

  startIntro() {
    if (this.state !== 'sleeping') return;
    this.brain.wakeFallback = -1;
    this.brain.startAction(SEQ.intro);
  }

  takeHit(o = {}) {
    if (this.state === 'dying' || this.state === 'dead') return 0;
    const raw = Number(o.damage);
    if (!(raw > 0)) return 0;
    const part = PARTS[o.part] !== undefined ? o.part : 'body';
    const dmg = Math.max(1, Math.round(raw * PARTS[part]));
    this.hp = Math.max(0, this.hp - dmg);
    this.flash = Math.max(this.flash, o.heavy ? 1 : 0.8);

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
    if (pt && Number.isFinite(pt.x + pt.y + pt.z)) this.fx.hitSpark(pt.x, pt.y, pt.z, this.flinchDir.x, this.flinchDir.z, !!o.heavy);

    this.emit('dragon:hurt', { damage: dmg, part, hp: this.hp });

    if (this.state === 'sleeping') {
      // flow should call startIntro(); wake on our own shortly if it doesn't
      if (this.brain.wakeFallback <= 0) this.brain.wakeFallback = 0.6;
    }
    if (this.hp <= 0) {
      this.brain.die();
      return dmg;
    }
    // poise -> stagger (heavy and head hits break it faster)
    const poiseDmg = (Number.isFinite(o.poise) && o.poise > 0 ? o.poise : dmg * 0.6) * (o.heavy ? 1.5 : 1) * (part === 'head' ? 1.4 : 1);
    if (this.state === 'combat') {
      this.poise += poiseDmg;
      this.poiseTimer = 0;
      const max = TUNING.poise.max[this.phase === 2 ? 1 : 0];
      if (this.poise >= max && this.brain.canStagger()) this.brain.stagger();
    }
    if (this.phase === 1 && this.hp <= this.maxHp * TUNING.phase2At) this.brain.pendingPhase2 = true;
    return dmg;
  }

  reset() {
    this.resetting = true; // interrupted actions skip their gameplay side effects (landing slam...)
    try {
      this.brain.reset();
    } finally {
      this.resetting = false;
    }
    this.fx.reset();
    this.state = 'sleeping';
    this.hp = this.maxHp;
    this.phase = 1;
    this.poise = 0;
    this.poiseTimer = 0;
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
  }

  update(dt) {
    if (!(dt > 0)) return; // paused / hit-stop at zero: keep the last pose and hitboxes
    this._step(Math.min(dt, 0.05));
  }

  // ---------------------------------------------------------------- helpers for brain/attacks
  emit(name, data) {
    this.game.events?.emit(name, data);
  }

  rootToWorld(out, x, y, z) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.position.x + x * c + z * s, y, this.position.z - x * s + z * c);
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
    const R = TUNING.radius, B = CONFIG.world.dragonBound;
    if (this.state === 'airborne') {
      const d = Math.hypot(this.position.x, this.position.z);
      if (d > B) this.position.multiplyScalar(B / d);
    } else this.game.world?.resolve?.(this.position, R, B + R);
    this.position.y = 0;
  }

  /** Deal damage to the player. Returns the player's verdict ('hit' | 'dodged' | 'ignored'). */
  hitPlayer(o) {
    const p = this.game.player;
    if (!p?.takeHit || p.alive === false) return 'ignored';
    // a fallen wyrm deals no more damage: shells still in flight during the death sequence only explode
    if (this.state === 'dying' || this.state === 'dead') return 'ignored';
    const from = o.from ? { x: o.from.x, z: o.from.z } : { x: this.position.x, z: this.position.z };
    try {
      return p.takeHit({
        damage: o.damage,
        from,
        knockback: o.knockback ?? 0,
        knockdown: !!o.knockdown,
        kind: o.kind ?? 'hit',
        burn: o.burn ?? 0,
      });
    } catch (err) {
      console.error('[dragon] player.takeHit failed', err);
      return 'ignored';
    }
  }

  /** One hit per attack activation: a hit or a dodge consumes it. */
  strike(a, o) {
    if (a.hitDone) return 'ignored';
    const r = this.hitPlayer(o);
    if (r === 'hit' || r === 'dodged') a.hitDone = true;
    return r;
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
        vx: Math.cos(a) * 2.2, vy: 0.5 + Math.random(), vz: Math.sin(a) * 2.2,
        life: 0.5 + Math.random() * 0.3, size: 0.35, sizeEnd: 0.8, glyph: ",.`",
        color: [0.18, 0.17, 0.15], alpha: 0.6, alphaEnd: 0, drag: 3,
      });
    }
  }

  onFlap(strength) {
    this.emit('dragon:wingFlap', { strength });
    this.game.world?.gust?.(this.position.x, this.position.z, Math.min(2, 0.6 + strength * 1.6), 14);
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
      const r = this.hitPlayer({ damage: T.damage, from: { x, z }, knockback: 2.5, kind: 'fireball', burn: T.burn });
      if (r === 'hit' && volley) volley.hitDone = true;
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
      const k = 1 - Math.exp(-10 * dt);
      s.vel.x += (vx - s.vel.x) * k;
      s.vel.z += (vz - s.vel.z) * k;
      s.vel.y = 0;
      if (s.vel.lengthSq() > 144) s.vel.setLength(12); // teleports (respawn) shouldn't fling predictions
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
    this.poiseTimer += dt;
    if (this.poiseTimer > TUNING.poise.regenDelay) this.poise = Math.max(0, this.poise - TUNING.poise.regen * dt);

    if (this.state === 'dead') {
      this.fx.update(dt);
      return;
    }

    this._sensePlayer(dt);
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
    set(0, t.copy(pt.head).addScaledVector(pt.headFwd, 0.55));
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
      W.setPusher(1 + k, toe.x, toe.y, toe.z, 1.1);
      const w = pt.wings[k].wrist;
      W.setPusher(3 + k, w.x, w.y - 0.3, w.z, 1.0);
    }
    const bodyY = s.alt > 1 ? 5 : 0.4;
    const br = lerp(1.4, 2.3, lying);
    W.setPusher(5, pt.chest.x, bodyY, pt.chest.z, br);
    W.setPusher(6, pt.hips.x, bodyY, pt.hips.z, br);
    W.setPusher(7, tl[4].x, tl[4].y - 0.4, tl[4].z, 0.9);
    W.setPusher(8, tl[8].x, tl[8].y - 0.4, tl[8].z, 0.75);
    const last = tl[Math.min(12, tl.length - 1)];
    W.setPusher(9, last.x, last.y - 0.4, last.z, 0.6);
  }

  _applyMaterials(dt) {
    const m = this.model.mats;
    this.glow = damp(this.glow, this.glowTarget, 1.2, dt);
    this.throatGlow = damp(this.throatGlow, this.throat, 4, dt);
    const body = this.glow * (0.85 + 0.15 * Math.sin(this.time * 2.3));
    const flash = this.flash * 0.55;
    const eyes = this.rig.s.eyes;
    m.scales.uniforms.uGlow.value = body;
    m.belly.uniforms.uGlow.value = body * 0.8;
    m.membrane.uniforms.uGlow.value = body;
    m.neck.uniforms.uGlow.value = Math.max(body, this.throatGlow * 1.1);
    m.eye.uniforms.uGlow.value = eyes;
    m.eye.uniforms.uInkGlow.value = eyes * 2.5;
    for (const k in m) {
      const u = m[k].uniforms;
      u.uFlash.value = flash;
      u.uDissolve.value = this.dissolve;
    }
  }
}
