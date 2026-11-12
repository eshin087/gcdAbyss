import * as THREE from 'three';
import { CONFIG } from '../../../core/config.js';
import { clamp, damp, smoothstep, wrapAngle } from '../../../core/math.js';
import { markCaster } from '../../../render/pipeline.js';
import { batchRigid } from '../../../render/rigidBatch.js';
import { TELL, RESULT, POSTURE, tellDefaults } from '../../../combat/rules.js';
import { buildHero, setHeroGlyphScale, installLean, LEAN, HERO_SCALE } from '../../player/model.js';
import { HeroAnimator } from '../../player/anim.js';
import { ASH_LOADOUT, JIAN } from './gear.js';
import { DUEL_POSES } from './poses.js';
import { MOVES, MOVE_NAMES } from './moves.js';
import { TUNING, perPhase } from './tuning.js';
import { DuelBrain } from './brain.js';
import { DiscipleFx } from './fx.js';

// The Ash Disciple (docs/specs/ash-disciple.md): a grey-robed jian swordsman who fills the boss slot
// of the Ashfall level (game.dragon === game.boss). He offers the Dragon contract's surface
// (ARCHITECTURE.md → Dragon; the player, HUD, flow, camera, audio and Lab read it) without the plunge:
// a perfect dodge against him is the Ghostep behind him, and a broken disciple is executed through
// onExecute. His AI, moves and reactions: brain.js; the moves as data: moves.js; the numbers:
// tuning.js. Built on the hero's skeleton and animator with his own gear (gear.js) and his own clips
// (poses.js): nothing he does mirrors the hero.

const TARGETABLE = new Set(['waking', 'combat', 'staggered', 'airborne']);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** His colours: the hero's material set, recoloured on HIS instances (gear.js says which is which). */
function tintDisciple(M) {
  const fill = (m, r, g, b) => m?.uniforms?.uArtFill?.value.setRGB(r, g, b);
  fill(M.coat, 0.36, 0.35, 0.33); // ash-grey robe: clearly lighter than the hero's black
  fill(M.lining, 0.12, 0.12, 0.125);
  fill(M.hem, 0.55, 0.53, 0.5); // the off-white collar and shin wraps
  fill(M.shirt, 0.05, 0.05, 0.055); // charcoal sash, bracer, shoes, the hat's binding
  fill(M.pants, 0.15, 0.15, 0.155);
  fill(M.leather, 0.44, 0.36, 0.2); // straw
  fill(M.trim, 0.32, 0.22, 0.11); // old bronze
  fill(M.facing, 0.55, 0.06, 0.05); // the red tassel
  fill(M.armor, 0.5, 0.52, 0.56); // the jian's pale steel (his gear wears no armour)
  fill(M.bevel, 0.7, 0.72, 0.76); // its ridge
  fill(M.hair, 0.05, 0.05, 0.06);
  if (M.armor?.uniforms) {
    M.armor.uniforms.uInk.value.setRGB(0.75, 0.78, 0.84);
    M.armor.uniforms.uEmissive.value.setRGB(1.6, 0.5, 0.1); // phase 2: the kindled blade (uGlow)
  }
  if (M.bevel?.uniforms) M.bevel.uniforms.uEmissive.value.setRGB(2.0, 0.75, 0.2);
  if (M.facing?.uniforms) M.facing.uniforms.uInk.value.setRGB(0.8, 0.12, 0.08);
}

export class AshDisciple {
  constructor(game) {
    this.game = game;
    this.name = TUNING.name;
    this.kind = 'duelist';
    this.rig = buildHero(game.U, ASH_LOADOUT);
    tintDisciple(this.rig.materials);
    this.object3d = this.rig.root;
    this.object3d.name = 'ashDisciple';
    this.position = this.object3d.position;
    this.yaw = 0;
    this.radius = TUNING.radius;
    this.maxHp = TUNING.hp;
    this.hp = this.maxHp;
    this.phase = 1;
    this.posture = 0;
    this.maxPosture = perPhase(TUNING.posture.max, 1);
    this.postureTimer = 0;
    this.broken = false;
    this.state = 'sleeping';
    /** internal: sleep | intro | foot | act | react | broken | dying | dead (brain.js) */
    this.mode = 'sleep';
    this.time = 0;
    this.flash = 0;
    this.dissolve = 0;
    this.warn = 0; // red windup glow 0..1.6
    this.kindle = 0; // phase 2's ember blade 0..1
    this.execRange = TUNING.execRange;
    // the Ghostep (player.js) puts the hero this far behind him: within sword reach of his back
    this.ghostepBehind = TUNING.ghostepBehind;
    this.hurtSpheres = [];
    this.bodyCircles = [];
    this._hs = [
      { x: 0, y: 0, z: 0, r: 0.2, part: 'head', mult: TUNING.parts.head },
      { x: 0, y: 0, z: 0, r: 0.3, part: 'body', mult: TUNING.parts.body },
      { x: 0, y: 0, z: 0, r: 0.3, part: 'body', mult: TUNING.parts.body },
      { x: 0, y: 0, z: 0, r: 0.2, part: 'leg', mult: TUNING.parts.leg },
      { x: 0, y: 0, z: 0, r: 0.2, part: 'leg', mult: TUNING.parts.leg },
    ];
    this._bc = { x: 0, z: 0, r: TUNING.radius };
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._tipPrev = new THREE.Vector3();
    this._hilt = new THREE.Vector3();
    this._hiltPrev = new THREE.Vector3();
    this._clash = new THREE.Vector3();
    this.jolt = 0; // the hit jolt 0..1 (TUNING.hitStun; the pilot's `recoil`, poses.js jolt)
    this._tipOk = false;
    this._lastParry = -9;
    this._lastHurtPt = new THREE.Vector3();

    // the animator's view of him (anim.js HeroAnimator reads these)
    this.pilot = {
      position: this.position, yaw: 0, state: 'duel', stateT: 0, animT: 0, atk: { def: null },
      groundVel: { x: 0, z: 0 }, kb: { x: 0, z: 0 }, chargeK: 0, releaseK: 0, recoil: 0, lockOn: false, guardHold: 0,
    };
    this.anim = new HeroAnimator(this.rig, this.pilot, DUEL_POSES);
    this.lean = installLean(this.object3d);
    this.fx = new DiscipleFx(this);
    this.brain = new DuelBrain(this);

    // the Lab's generic enemy API (ARCHITECTURE.md → Dragon → debug)
    const d = this;
    this.debug = {
      abilities: () => MOVE_NAMES.filter((n) => !MOVES[n].transition).map((n) => ({ name: n, label: MOVES[n].label, tell: MOVES[n].beats.find((b) => !b.feint)?.tell ?? TELL.NORMAL, phase: MOVES[n].phase })),
      trigger: (name) => this.brain.trigger(name),
      setAI: (on) => {
        this.brain.aiEnabled = !!on;
      },
      get aiEnabled() {
        return d.brain.aiEnabled;
      },
      wake: () => this.startIntro(),
      startFight: () => this.brain.startFight(),
      phase2: () => this.brain.forcePhase2(),
      phase3: () => false,
      stagger: () => this.brain.startReact('stagger'),
      postureBreak: () => this._break(),
      kill: () => this._kill(),
      reset: () => this.reset(),
      setHp: (f) => {
        this.hp = clamp(fin(Number(f), 1), 0, 1) * this.maxHp;
        if (this.hp <= 0) this._kill();
      },
      hitboxes: () => this._hitboxes(),
      currentAction: () => this.brain.act?.name ?? this.brain.react?.clip?.name ?? this.mode,
    };

    markCaster(this.object3d);
    // one draw call per material (render/rigidBatch.js), as the hero and the wyrm
    this.batch = batchRigid(game.U, this.object3d);
    game.scene.add(this.object3d);
    this.reset();
  }

  // ---------------------------------------------------------------- contract
  get phaseAt() {
    return TUNING.phaseAt;
  }
  get nextPhaseHp() {
    const f = TUNING.phaseAt[this.phase];
    return Number.isFinite(f) ? this.maxHp * f : 0;
  }
  get bound() {
    return Math.min(CONFIG.world.dragonBound ?? TUNING.bound, TUNING.bound);
  }
  /** His guard is up: footwork after the raise delay, or a clash still turning a blow. */
  get guarding() {
    return this.brain.guardUp();
  }

  isTargetable() {
    return TARGETABLE.has(this.state);
  }

  lockPoint(out) {
    const c = this._hs[1];
    if (Number.isFinite(c.x + c.y + c.z) && (c.x || c.z)) return out.set(c.x, c.y, c.z);
    return out.set(this.position.x, 1.3, this.position.z);
  }

  startIntro() {
    this.brain.startIntro();
  }

  /**
   * A hit from the player ({ damage, part, point, dir, poise, heavy, crit, exact, posture }). Strikes
   * into his front while his guard is up are deflected: no damage, guard posture, a clash (and a
   * counter becomes likelier); a heavy strike with TUNING.guard.crushPoise posture crushes the guard
   * (it lands, and he staggers). Returns the damage dealt (0 = guarded or ignored).
   */
  takeHit(o = {}) {
    if (this.mode === 'dying' || this.mode === 'dead') return 0;
    o = o || {};
    const raw = Number(o.damage);
    if (!(raw > 0)) return 0;
    if (this.mode === 'sleep') this.startIntro();
    const G = TUNING.guard;
    const heavy = !!o.heavy;
    // a technique's piercing strike (the Ash Riposte's counter) goes through his guard and staggers
    // him, his guard up or not
    const pierce = !!o.pierce;
    let crushed = false;
    if (!o.exact && this.guarding && !this.broken && this._fromFront()) {
      if (pierce || (heavy && fin(o.poise) >= G.crushPoise)) crushed = true;
      else {
        this._guardClash(heavy, o.point);
        return 0;
      }
    }
    const P = TUNING.parts;
    const part = P[o.part] !== undefined ? o.part : 'body';
    const broken = this.broken;
    const dmg = o.exact ? Math.max(1, Math.round(raw)) : Math.max(1, Math.round(raw * P[part] * (broken ? TUNING.posture.breakCritMult : 1)));
    const crit = !!o.crit || broken;
    this._applyDamage(dmg);
    this.flash = Math.max(this.flash, heavy || crit ? 1 : 0.8);
    let dx = fin(o.dir?.x, NaN), dz = fin(o.dir?.z, NaN);
    if (!Number.isFinite(dx + dz) || dx * dx + dz * dz < 1e-6) {
      const p = this.game.player?.position;
      dx = p ? this.position.x - p.x : 0;
      dz = p ? this.position.z - p.z : 1;
    }
    const l = Math.hypot(dx, dz) || 1;
    // hit stun: a freeze-frame, his chest and head snapped back (poses.js jolt), a shove along the
    // blow; it never cancels a windup (only footwork and his recovery: brain.onStruck)
    const HS = TUNING.hitStun, hs = heavy || crushed ? HS.heavy : HS.light;
    this.hitstop(crit ? Math.max(hs.stop, HS.critStop) : hs.stop, 0.03);
    this.jolt = Math.max(this.jolt, hs.jolt);
    if (this.mode !== 'broken' && this.position.y < 0.2) this.moveBy((dx / l) * hs.push, (dz / l) * hs.push);
    const pt = o.point;
    if (pt && Number.isFinite(pt.x + pt.y + pt.z)) {
      this.fx.hitSpark(pt.x, pt.y, pt.z, dx / l, dz / l, heavy || crit);
      this._lastHurtPt.set(pt.x, pt.y, pt.z);
    }
    this.emit('dragon:hurt', { damage: dmg, part, hp: this.hp, crit });
    if (this.hp <= 0) {
      this._die();
      return dmg;
    }
    if (!broken) {
      if (o.posture !== undefined) this.addPosture(Number(o.posture));
      else {
        let gain = heavy ? TUNING.posture.hit.heavy : TUNING.posture.hit.light;
        const poise = Number(o.poise);
        if (Number.isFinite(poise) && poise > 0) gain *= clamp(poise / (heavy ? 40 : 12), 0.6, 1.5);
        if (crushed) gain += TUNING.posture.guard.heavy;
        this.addPosture(gain);
      }
    }
    if (this.mode === 'broken' || this.broken) return dmg;
    if (crushed || pierce) {
      this.emit('dragon:stagger');
      this.fx.clash(this._hilt.x, this._hilt.y, this._hilt.z, true);
      this.brain.startReact('stagger');
    } else this.brain.onStruck(heavy);
    return dmg;
  }

  /** The execution (player.js, a broken duelist within execRange): final damage, the break spent. */
  onExecute(o = {}) {
    if (!this.broken || this.mode === 'dying' || this.mode === 'dead') return 0;
    const dmg = Math.max(1, Math.round(fin(o.damage, TUNING.execution.damage)));
    this._applyDamage(dmg);
    this.flash = 1;
    this.emit('dragon:hurt', { damage: dmg, part: 'body', hp: this.hp, crit: true });
    this.emit('dragon:plunged', { execution: true });
    this.broken = false;
    this.posture = 0;
    this.emitPosture(true);
    this._cinematic('execution');
    if (this.hp <= 0) {
      this._die();
      return dmg;
    }
    this.brain.startReact('executed');
    return dmg;
  }

  /**
   * After player.takeHit returned 'parried' (hitPlayer calls it). The deflect chain: a string's hit
   * that is not its last is only deflected (posture, the move goes on); the last hit, or a single
   * strike, recoils him: the punish window.
   */
  onParried(info = {}) {
    if (this.mode === 'dying' || this.mode === 'dead') return;
    if (this.time - this._lastParry < 0.1) return;
    this._lastParry = this.time;
    const a = this.brain.act;
    const attack = info?.attack ?? a?.name ?? null;
    const tell = info?.tell === TELL.BLUE ? TELL.BLUE : TELL.NORMAL;
    const b = a?.striking ?? null;
    const hit = Number.isFinite(b?.hit) ? b.hit : 0;
    const string = !!a && a.hits > 1;
    const last = !a || !b || !!b.last;
    this.emit('dragon:parried', { attack: attack ?? 'strike', tell, hit, last });
    if (string && a) {
      a.chain = (a.chain ?? 0) + 1;
      if (a.chain >= 2) this.emit('combat:deflectChain', { count: a.chain });
    }
    const cp = this._clashPoint();
    this.fx.parrySpark(cp.x, cp.y, cp.z, tell);
    this.flash = Math.max(this.flash, 0.5);
    this.addPosture(POSTURE.parry[tell] ?? POSTURE.parry.normal);
    if (this.mode !== 'act' || !a) return; // the parry broke his posture (broken) or the move is gone
    if (a) a.parried = (a.parried ?? 0) + 1;
    // the blade lock: a PERFECT parry of a blow marked `lock` crosses the blades
    if (b?.def?.lock && this.game.player?.deflect?.perfect && this.brain.startLock()) return;
    // the full deflect: every real hit of a long string parried → he reels (a cinematic moment)
    const F = TUNING.fullDeflect;
    if (last && a.hits >= F.minHits && a.parried >= a.hits) {
      this.emit('dragon:deflected', { count: a.hits });
      this.addPosture(F.posture);
      this._cinematic('fullDeflect');
      if (this.mode === 'act') this.brain.startReact('reeling');
      return;
    }
    if (last) this.brain.startReact('recoil');
  }

  /** The blade lock is decided (player.js _endLock). Won by the hero: he reels, a cinematic moment;
   *  lost: he shoves the hero back and comes straight in with the Riposte. */
  onLockEnd(won) {
    if (this.mode === 'dying' || this.mode === 'dead' || this.brain.react?.kind !== 'lock') return;
    const L = TUNING.lock;
    if (won) {
      this.addPosture(L.posture);
      this.hitstop(0.08, 0.05);
      this._cinematic('bladeLock');
      if (!this.broken) this.brain.startReact('reeling');
      return;
    }
    const p = this.game.player;
    try {
      p?.takeHit?.({
        damage: L.shove.damage * (TUNING.damageScale ?? 1), from: { x: this.position.x, z: this.position.z }, knockback: L.shove.knockback,
        kind: 'shove', tell: TELL.RED, parryable: false, blockable: false, attack: 'bladeLock', attacker: this, perfect: false,
      });
    } catch (err) {
      console.error('[disciple] the shove failed', err);
    }
    this.game.shake?.(0.25);
    this.brain.startReact('clash');
    this.brain.counter.pending = true;
  }

  /** A mikiri (player.js _mikiri): the hero stepped on his perilous thrust. Pinned, he stumbles. */
  onMikiri() {
    if (this.mode !== 'act') return;
    this.warn = 0;
    this.addPosture(TUNING.mikiri.posture);
    this.emit('dragon:stagger');
    this._cinematic('mikiri');
    if (!this.broken) this.brain.startReact('trampled');
  }

  /** Where the blades meet: the point of his blade (from mid-blade to the tip) nearest the hero's
   *  chest, so his parry burst lands on the hero's own (player fx.parry) as one clash. */
  _clashPoint() {
    const h = this._hilt, t = this._tip, out = this._clash;
    const p = this.game.player;
    if (typeof p?.getChestPos !== 'function') return out.copy(t);
    p.getChestPos(this._v2, true);
    const bx = t.x - h.x, by = t.y - h.y, bz = t.z - h.z, l2 = bx * bx + by * by + bz * bz;
    const u = l2 > 1e-6 ? ((this._v2.x - h.x) * bx + (this._v2.y - h.y) * by + (this._v2.z - h.z) * bz) / l2 : 1;
    const k = Math.min(1, Math.max(0.45, Number.isFinite(u) ? u : 1));
    out.set(h.x + bx * k, h.y + by * k, h.z + bz * k);
    if (!Number.isFinite(out.x + out.y + out.z)) out.copy(t);
    return out;
  }

  /** A cinematic moment on the clash between him and the hero (flow.cinematic, TUNING.cinematic,
   *  any field overridden by `o`). */
  _cinematic(kind, o = null) {
    const p = this.game.player?.position, C = o ? { ...TUNING.cinematic, ...o } : TUNING.cinematic;
    if (!p) return;
    this.game.flow?.cinematic?.({ x: (p.x + this.position.x) / 2, z: (p.z + this.position.z) / 2, zoom: C.zoom, weight: C.weight, slowmo: C.slowmo, dur: C.dur, kind });
  }

  reset() {
    const S = CONFIG.world.dragonSleep ?? { x: 0, z: 0, yaw: 0 };
    this.position.set(fin(S.x), 0, fin(S.z));
    this.yaw = fin(S.yaw);
    this.object3d.rotation.y = this.yaw;
    this.hp = this.maxHp;
    this.phase = 1;
    this.maxPosture = perPhase(TUNING.posture.max, 1);
    this.posture = 0;
    this.postureTimer = 0;
    this.broken = false;
    this.flash = 0;
    this.dissolve = 0;
    this.warn = 0;
    this.kindle = 0;
    this.object3d.visible = true;
    this.fx.reset();
    this.brain.reset();
    this.anim.reset();
    this.hurtSpheres.length = 0;
    this.bodyCircles.length = 0;
    this.emitPosture(true);
    this._animate(0);
  }

  update(dt) {
    if (!(dt > 0)) return; // paused / a full freeze: keep the pose and the hitboxes
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this._updatePosture(dt);
    this.brain.update(dt);
    this._animate(dt);
    this.brain.afterPose(dt);
    this.fx.updateCrescents(dt, this);
    this._materials(dt);
  }

  // ---------------------------------------------------------------- posture
  addPosture(amount) {
    if (this.broken || !(amount > 0) || this.mode === 'dying' || this.mode === 'dead') return;
    this.posture = Math.min(this.maxPosture, this.posture + amount);
    this.postureTimer = 0;
    this.emitPosture();
    if (this.posture >= this.maxPosture) this._break();
  }

  emitPosture(force = false) {
    const p = this.posture;
    if (!force && Math.abs(p - (this._postureSent ?? -9)) < 1 && !(p === 0 && this._postureSent !== 0)) return;
    this._postureSent = p;
    this.emit('dragon:posture', { posture: p, max: this.maxPosture });
  }

  _updatePosture(dt) {
    this.postureTimer += dt;
    if (this.broken || this.posture <= 0) return;
    if (this.postureTimer > TUNING.posture.regenDelay) {
      this.posture = Math.max(0, this.posture - TUNING.posture.regenRate * dt);
      this.emitPosture();
    }
  }

  _break() {
    if (this.broken || this.mode === 'dying' || this.mode === 'dead' || this.mode === 'sleep' || this.mode === 'intro') return;
    if (this.brain.act?.def?.transition) {
      this.brain.pendingBreak = true; // the kindling finishes first
      return;
    }
    this.posture = this.maxPosture;
    this.emitPosture(true);
    this.broken = true;
    this.warn = 0;
    this.emit('dragon:postureBreak');
    this.emit('dragon:stagger');
    const c = this._hs[1];
    this.fx.breakBurst(c.x, c.y + 0.2, c.z);
    this.hitstop(0.1, 0.05);
    this.game.shake?.(0.3);
    this.brain.startBroken();
  }

  /** The break is over (brain.js): the meter starts again. */
  endBreak() {
    this.broken = false;
    this.posture = 0;
    this.postureTimer = 0;
    this.emitPosture(true);
  }

  /** Phase n begins (the kindling's start): its posture meter, emptied. */
  enterPhase(n) {
    this.phase = clamp(Math.round(fin(n, 2)), 1, 2);
    this.maxPosture = perPhase(TUNING.posture.max, this.phase);
    this.posture = 0;
    this.postureTimer = 0;
    this.emitPosture(true);
  }

  _applyDamage(dmg) {
    let hp = this.hp - dmg;
    const gate = this.phase < 2 ? this.nextPhaseHp : 0;
    if (gate > 0 && this.brain.aiEnabled && this.hp >= gate) hp = Math.max(gate, hp);
    this.hp = Math.max(0, hp);
    if (gate > 0 && this.hp <= gate) this.brain.pendingPhase = 2;
  }

  _kill() {
    if (this.mode === 'dying' || this.mode === 'dead') return;
    this.hp = 0;
    this._die();
  }

  _die() {
    if (this.mode === 'dying' || this.mode === 'dead') return;
    this.hp = 0;
    this.broken = false;
    this.warn = 0;
    this.emit('dragon:death');
    this.brain.startDeath();
  }

  /** The death clip and the ash are done (brain.js): gone. */
  finishDeath() {
    this.state = 'dead';
    this.mode = 'dead';
    this.dissolve = 1;
    this.object3d.visible = false;
    this.hurtSpheres.length = 0;
    this.bodyCircles.length = 0;
    this.game.world?.clearPushers?.(1, 3);
    this.emit('dragon:dead');
  }

  // ---------------------------------------------------------------- the guard
  /** The hero is in his front arc (TUNING.guard.arc). */
  _fromFront() {
    const p = this.game.player?.position;
    if (!p) return true;
    const a = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    return Math.abs(wrapAngle(a - this.yaw)) <= TUNING.guard.arc;
  }

  _guardClash(heavy, point) {
    const G = TUNING.guard;
    this.addPosture(heavy ? TUNING.posture.guard.heavy : TUNING.posture.guard.light);
    const h = this._hilt, t = this._tip;
    const x = (h.x + t.x) * 0.5, y = (h.y + t.y) * 0.5, z = (h.z + t.z) * 0.5;
    if (Number.isFinite(x + y + z)) this.fx.clash(x, y, z, heavy);
    else if (point) this.fx.clash(point.x, point.y, point.z, heavy);
    this.emit('dragon:guard', { heavy });
    // steel on steel: a freeze, a kick, his blade jolted
    this.hitstop(heavy ? G.clashStop * 1.6 : G.clashStop, 0.03);
    this.game.shake?.(heavy ? 0.3 : 0.18);
    this.jolt = Math.max(this.jolt, heavy ? 0.5 : 0.3);
    if (!this.broken) this.brain.onGuarded();
  }

  // ---------------------------------------------------------------- dealing hits
  /**
   * A blow at the hero with its tell data. Returns the player's RESULT; a parry calls onParried (an
   * Ash Crescent's parry only spends the crescent and nicks his posture).
   */
  hitPlayer(o) {
    const p = this.game.player;
    if (!p?.takeHit || p.alive === false) return RESULT.IGNORED;
    if (this.mode === 'dying' || this.mode === 'dead') return RESULT.IGNORED;
    const tell = o.tell ?? TELL.NORMAL;
    const def = tellDefaults(tell);
    let r;
    try {
      r = p.takeHit({
        damage: o.damage * (TUNING.damageScale ?? 1),
        from: o.from ?? { x: this.position.x, z: this.position.z },
        knockback: o.knockback ?? 0,
        knockdown: !!o.knockdown,
        kind: o.kind ?? 'slash',
        tell,
        parryable: o.parryable ?? def.parryable,
        blockable: o.blockable ?? def.blockable,
        attack: o.attack ?? 'strike',
        attacker: this,
        light: !!o.crescent,
        mikiri: !!o.mikiri, // a perilous thrust: a roll INTO it is the mikiri (player.js)
      });
    } catch (err) {
      console.error('[disciple] player.takeHit failed', err);
      return RESULT.IGNORED;
    }
    if (r === RESULT.PARRIED) {
      if (o.crescent) {
        this.addPosture(8);
        this.emit('dragon:parried', { attack: o.attack ?? 'ashCrescent', tell, hit: 0, last: false, bullet: true });
      } else this.onParried({ attack: o.attack, tell });
    }
    return r ?? RESULT.IGNORED;
  }

  // ---------------------------------------------------------------- frame
  _animate(dt) {
    const pl = this.pilot, b = this.brain;
    this.jolt = Math.max(0, this.jolt - dt * TUNING.hitStun.joltDecay);
    pl.recoil = this.jolt;
    pl.yaw = this.yaw;
    pl.stateT = b.clipT;
    pl.animT = b.clipT;
    pl.atk.def = b.clip;
    this.yaw = wrapAngle(fin(this.yaw));
    this.object3d.rotation.y = this.yaw;
    this._updateLean();
    // the animator poses the plain upright body (as the hero's): gameplay points come from it
    this.lean.on = false;
    this.anim.update(dt);
    this._gameplayPoints();
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    this._drawnPoints();
  }

  _updateLean() {
    const L = this.lean, cam = this.game.camera;
    L.k = 0;
    if (!cam?.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const h = Math.hypot(fx, fz);
    if (!(h > 1e-3) || !Number.isFinite(fy)) return;
    const a = Math.min(LEAN.max, Math.max(0, LEAN.frac * Math.atan2(-fy, h)));
    L.k = Math.tan(a);
    L.dx = fx / h;
    L.dz = fz / h;
  }

  /** Hurt spheres and the body circle from the upright body (the animator just posed it). */
  _gameplayPoints() {
    const r = this.rig, H = this._hs, v = this._v;
    const set = (s, j, dy = 0) => {
      j.getWorldPosition(v);
      s.x = v.x;
      s.y = v.y + dy;
      s.z = v.z;
    };
    set(H[0], r.head, 0.14);
    set(H[1], r.chest, 0.05);
    set(H[2], r.pelvis, 0);
    set(H[3], r.legs.R.shin, -0.12);
    set(H[4], r.legs.L.shin, -0.12);
    this.hurtSpheres.length = 0;
    this.bodyCircles.length = 0;
    if (this.mode === 'dead') return;
    for (const s of H) if (Number.isFinite(s.x + s.y + s.z)) this.hurtSpheres.push(s);
    if (this.mode !== 'dying') {
      this._bc.x = this.position.x;
      this._bc.z = this.position.z;
      if (this.position.y < 0.6) this.bodyCircles.push(this._bc);
    }
  }

  /** Drawn points for FX: the jian's hilt and tip (leaned, HERO_SCALE). */
  _drawnPoints() {
    const s = this.rig.sword;
    this._tipPrev.copy(this._tip);
    this._hiltPrev.copy(this._hilt);
    const ok = this._tipOk;
    this._hilt.set(0, 0, JIAN.guard).applyMatrix4(s.matrixWorld);
    this._tip.set(0, 0, JIAN.tip).applyMatrix4(s.matrixWorld);
    this._tipOk = Number.isFinite(this._tip.x + this._tip.y + this._tip.z) && Number.isFinite(this._hilt.x + this._hilt.y + this._hilt.z);
    if (!ok) {
      this._tipPrev.copy(this._tip);
      this._hiltPrev.copy(this._hilt);
    }
  }

  /** Where a beat's glint pops: the blade's tip (or at his feet for a ring). */
  tellPoint(part, out) {
    if (part === 'feet') return out.set(this.position.x, 0.6, this.position.z);
    if (this._tipOk) return out.copy(this._tip);
    return out.set(this.position.x, 1.3, this.position.z);
  }

  _materials(dt) {
    const M = this.rig.materials, mats = this.rig.mats;
    const cam = this.game.camera?.position;
    if (cam) {
      const p = this.position;
      const dd = Math.hypot(cam.x - p.x, cam.y - p.y - 1.1, cam.z - p.z);
      if (Number.isFinite(dd)) setHeroGlyphScale(mats, dd);
    }
    const w = clamp(this.warn, 0, 2);
    const k2 = this.kindle;
    for (const m of mats) {
      const u = m.uniforms;
      if (!u) continue;
      u.uFlash.value = this.flash * 0.8;
      u.uDissolve.value = this.dissolve;
      u.uWarn.value.set(1.0, 0.12, 0.05, w);
    }
    // the jian (his `armor` + `bevel` instances): pale steel that brightens through a strike; kindled
    // in phase 2, its ink burns ember and it glows
    const fu = M.armor?.uniforms, tu = M.bevel?.uniforms;
    if (fu) {
      const act = this.brain.act, striking = !!act && act.striking && act.t >= act.striking.impact - 0.06 && act.t <= act.striking.end + 0.1;
      const glow = 1.3 * k2 + (striking ? 0.35 : 0);
      fu.uGlow.value = dt > 0 ? damp(fu.uGlow.value, glow, 14, dt) : glow;
      fu.uInkGlow.value = 0.15 + (striking ? 0.45 : 0) + 0.8 * k2;
      fu.uInk.value.setRGB(0.75 + 0.7 * k2, 0.78 - 0.15 * k2, 0.84 - 0.6 * k2);
      if (fu.uGlowMask) fu.uGlowMask.value = 1;
      if (tu) {
        tu.uGlow.value = fu.uGlow.value;
        tu.uInkGlow.value = fu.uInkGlow.value + 0.25;
        if (tu.uGlowMask) tu.uGlowMask.value = 1;
      }
    }
  }

  // ---------------------------------------------------------------- helpers
  /** His ground velocity this frame (the animator's gait reads it). */
  groundVelSet(vx, vz) {
    this.pilot.groundVel.x = fin(vx);
    this.pilot.groundVel.z = fin(vz);
  }

  emit(name, data) {
    this.game.events?.emit(name, data);
  }

  /** game.hitstop that never crushes a longer, gentler slow-mo already running (the Ghostep's). */
  hitstop(sec, scale = 0.04) {
    const g = this.game;
    if ((g.hitstopTimer ?? 0) > sec && (g.hitstopScale ?? 1) > scale) return;
    g.hitstop?.(sec, scale);
  }

  /** Move by (dx, dz), resolved against the world (stones, pillars) and his bound. */
  moveBy(dx, dz) {
    if (!Number.isFinite(dx + dz)) return;
    this.position.x += dx;
    this.position.z += dz;
    const B = this.bound;
    this.game.world?.resolve?.(this.position, TUNING.radius, B + TUNING.radius);
    const d = Math.hypot(this.position.x, this.position.z);
    if (d > B) this.position.multiplyScalar(B / d);
  }

  _hitboxes() {
    const out = this.hurtSpheres.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r, kind: 'hurt' }));
    const z = this.brain.zoneDebug();
    if (z) out.push({ ...z, kind: 'attack' });
    return out;
  }
}

export { HERO_SCALE };
