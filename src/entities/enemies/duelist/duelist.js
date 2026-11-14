import * as THREE from 'three';
import { CONFIG } from '../../../core/config.js';
import { clamp, wrapAngle } from '../../../core/math.js';
import { markCaster } from '../../../render/pipeline.js';
import { batchRigid } from '../../../render/rigidBatch.js';
import { TELL, RESULT, POSTURE, tellDefaults } from '../../../combat/rules.js';
import { buildHero, setHeroGlyphScale, installLean, LEAN, HERO_SCALE } from '../../player/model.js';
import { HeroAnimator } from '../../player/anim.js';
import { perPhase } from './realise.js';
import { DuelBrain } from './brain.js';
import { DuelFx } from './fx.js';
import { closestOnSegments } from '../../../combat/clashFx.js';

// A duelist: a human boss on the hero's skeleton and animator (the Ash Disciple; the Starless Lord).
// It fills a level's boss slot (game.dragon === game.boss) and offers the Dragon contract's surface
// (ARCHITECTURE.md → Dragon; the player, HUD, flow, camera, audio and Lab read it) without the plunge:
// a perfect dodge against him is the Ghostep behind him, and a broken duelist is executed through
// onExecute. Everything one boss is comes from its KIT (a plain object, see below) and a few methods
// its subclass overrides; the mind and timeline: brain.js; moves as data: the boss's moves.js through
// realise.js; poses: poses.js; the shared glyph FX: fx.js.
//
// kit = {
//   id                   the object's name
//   TUNING               the boss's numbers (the Ash Disciple's tuning.js is the reference shape)
//   MOVES, MOVE_NAMES    his moves as data;  CLIP  compiled reaction clips (clash, flinch, backstep,
//                        sidestep, stagger, recoil, reeling, trampled, lock, broken, executed, death,
//                        meditate, intro)
//   realise(name, phase, rnd)   realise.js makeRealise
//   transitions          { phase: move name }: the scripted move that begins each later phase
//   loadout              his gear (player/gear slots → item ids)
//   poses                the pose table HeroAnimator takes ({ loco, duel })
//   blade                { guard, tip }: the blade's ends along the weapon joint's +Z (m)
//   REACT, OPEN          extra reaction clips' root motion / which of them leave him open (optional)
// }
// Subclass hooks: _tint(M) (his colours), _setup() (extra meshes, before batching), _bladeMaterials(dt),
// brainFrame(dt), afterPose(dt, act), onRelease(beat, sense, act), onCast(beat, sense, act),
// beatMotion(beat, u, sense, dt), onTransitionEnd(act), _onHpZero().

const TARGETABLE = new Set(['waking', 'combat', 'staggered', 'airborne']);
// a parried blow's contact (parryContact): the pose is stepped back over `max` s of clip time in
// `steps`; the contact is the last pose BEFORE the blade crosses the hero's centre line in which it is
// still `clear` m off it (where his guard is). A blade that never clears (a thrust down the line) is
// shown `thrust` s back and set `aside` m off the hero.
const CONTACT = { max: 0.06, steps: 8, clear: 0.34, thrust: 0.022, aside: 0.4 };
const CONTACT_D = new Float32Array(CONTACT.steps + 1);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
/** A move's first real hit's tell (a `pick` beat: its first alternative). */
const firstTell = (def) => def.beats.map((b) => (Array.isArray(b.pick) ? b.pick[0] : b)).find((b) => !b.feint)?.tell ?? TELL.NORMAL;

export class Duelist {
  constructor(game, kit) {
    this.game = game;
    this.kit = kit;
    /** his numbers (kit.TUNING) */
    this.T = kit.TUNING;
    const TUNING = this.T;
    this.name = TUNING.name;
    this.kind = 'duelist';
    this.rig = buildHero(game.U, kit.loadout);
    this._tint(this.rig.materials);
    this.object3d = this.rig.root;
    this.object3d.name = kit.id ?? 'duelist';
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
    this._cp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    // his blade as the hero's parry meets it (hitPlayer → hit.blade): a hilt, b tip, v the tip's travel
    this._blade = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0 };
    this.jolt = 0; // the hit jolt 0..1 (TUNING.hitStun; the pilot's `recoil`, poses.js jolt)
    this._tipOk = false;
    this._lastParry = -9;
    this._lastHurtPt = new THREE.Vector3();

    // the animator's view of him (anim.js HeroAnimator reads these)
    this.pilot = {
      position: this.position, yaw: 0, state: 'duel', stateT: 0, animT: 0, atk: { def: null },
      groundVel: { x: 0, z: 0 }, kb: { x: 0, z: 0 }, chargeK: 0, releaseK: 0, recoil: 0, lockOn: false, guardHold: 0,
    };
    this.anim = new HeroAnimator(this.rig, this.pilot, kit.poses);
    this.lean = installLean(this.object3d);
    this.fx = this._makeFx();
    this.brain = this._makeBrain();

    // the Lab's generic enemy API (ARCHITECTURE.md → Dragon → debug)
    const d = this;
    this.debug = {
      abilities: () => kit.MOVE_NAMES.filter((n) => !kit.MOVES[n].transition && !kit.MOVES[n].hidden).map((n) => ({ name: n, label: kit.MOVES[n].label, tell: firstTell(kit.MOVES[n]), phase: kit.MOVES[n].phase })),
      trigger: (name) => this.brain.trigger(name),
      setAI: (on) => {
        this.brain.aiEnabled = !!on;
      },
      get aiEnabled() {
        return d.brain.aiEnabled;
      },
      wake: () => this.startIntro(),
      startFight: () => this.brain.startFight(),
      phase2: () => this.brain.forcePhase(2),
      phase3: () => this.brain.forcePhase(3),
      phase4: () => this.brain.forcePhase(4),
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

    this._setup();
    markCaster(this.object3d);
    // one draw call per material (render/rigidBatch.js), as the hero and the wyrm
    this.batch = batchRigid(game.U, this.object3d);
    game.scene.add(this.object3d);
    this.reset();
  }

  // ---------------------------------------------------------------- hooks (a subclass overrides)
  /** His colours: the hero's material set, recoloured on HIS instances. */
  _tint() {}
  /** Extra meshes and state, before the rig is batched and before the first reset(). */
  _setup() {}
  _makeFx() {
    return new DuelFx(this);
  }
  _makeBrain() {
    return new DuelBrain(this);
  }
  /** His bar is empty: by default he dies. */
  _onHpZero() {
    this._die();
  }
  /** His blade's materials this frame (glow through a strike, a kindled edge ...). */
  _bladeMaterials() {}
  /** After the pose (brain.afterPose): the blade's sweep trail through a strike, the stars of a break. */
  afterPose(dt, a) {
    if (a && this._tipOk) {
      for (const b of a.beats) {
        if (b.feint || a.t < b.impact - 0.32 * b.W - 0.02 || a.t > b.end + 0.6 * b.A + 0.05) continue;
        this.fx.sweep(this._hiltPrev, this._tipPrev, this._hilt, this._tip, false);
        break;
      }
    }
    if (this.mode === 'broken') this.fx.stunStars(this._hs[0]);
  }

  // ---------------------------------------------------------------- contract
  get phaseAt() {
    return this.T.phaseAt;
  }
  get nextPhaseHp() {
    const f = this.T.phaseAt[this.phase];
    return Number.isFinite(f) ? this.maxHp * f : 0;
  }
  get bound() {
    return Math.min(CONFIG.world.dragonBound ?? this.T.bound, this.T.bound);
  }
  /** His guard is up (brain.guardUp): footwork, a ward, an early windup, a late recovery. */
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
   * counter becomes likelier); a heavy strike with this.T.guard.crushPoise posture crushes the guard
   * (it lands, and he staggers). Returns the damage dealt (0 = guarded or ignored).
   */
  takeHit(o = {}) {
    if (this.mode === 'dying' || this.mode === 'dead') return 0;
    o = o || {};
    const raw = Number(o.damage);
    if (!(raw > 0)) return 0;
    if (this.mode === 'sleep') this.startIntro();
    const G = this.T.guard;
    const heavy = !!o.heavy;
    let crushed = false;
    if (!o.exact && this.guarding && !this.broken && this._fromFront()) {
      if (heavy && fin(o.poise) >= G.crushPoise) crushed = true;
      else {
        this._guardClash(heavy, o.point);
        return 0;
      }
    }
    const P = this.T.parts;
    const part = P[o.part] !== undefined ? o.part : 'body';
    const broken = this.broken;
    const dmg = o.exact ? Math.max(1, Math.round(raw)) : Math.max(1, Math.round(raw * P[part] * (broken ? this.T.posture.breakCritMult : 1)));
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
    const HS = this.T.hitStun, hs = heavy || crushed ? HS.heavy : HS.light;
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
      this._onHpZero();
      return dmg;
    }
    if (!broken) {
      if (o.posture !== undefined) this.addPosture(Number(o.posture));
      else {
        let gain = heavy ? this.T.posture.hit.heavy : this.T.posture.hit.light;
        const poise = Number(o.poise);
        if (Number.isFinite(poise) && poise > 0) gain *= clamp(poise / (heavy ? 40 : 12), 0.6, 1.5);
        if (crushed) gain += this.T.posture.guard.heavy;
        this.addPosture(gain);
      }
    }
    if (this.mode === 'broken' || this.broken) return dmg;
    if (crushed) {
      this.emit('dragon:stagger');
      this.fx.guard(this._hilt.x, this._hilt.y, this._hilt.z, { heavy: true, deflect: true });
      this.brain.startReact('stagger');
    } else this.brain.onStruck(heavy);
    return dmg;
  }

  /** The execution (player.js, a broken duelist within execRange): final damage, the break spent. */
  onExecute(o = {}) {
    if (!this.broken || this.mode === 'dying' || this.mode === 'dead') return 0;
    const dmg = Math.max(1, Math.round(fin(o.damage, this.T.execution.damage)));
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
    // (no burst of his own: the hero's parry draws the one clash, on the crossing of the two blades)
    this.flash = Math.max(this.flash, 0.5);
    this.jolt = Math.max(this.jolt, tell === TELL.BLUE ? 0.75 : 0.55); // the turned blow jars him
    this.addPosture(POSTURE.parry[tell] ?? POSTURE.parry.normal);
    if (this.mode !== 'act' || !a) return; // the parry broke his posture (broken) or the move is gone
    if (a) a.parried = (a.parried ?? 0) + 1;
    // the blade lock: a PERFECT parry of a blow marked `lock` crosses the blades
    if (b?.def?.lock && this.game.player?.deflect?.perfect && this.brain.startLock()) return;
    // the full deflect: every real hit of a long string parried → he reels (a cinematic moment)
    const F = this.T.fullDeflect;
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
    const L = this.T.lock;
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
        damage: L.shove.damage * (this.T.damageScale ?? 1), from: { x: this.position.x, z: this.position.z }, knockback: L.shove.knockback,
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
    this.addPosture(this.T.mikiri.posture);
    this.emit('dragon:stagger');
    this._cinematic('mikiri');
    if (!this.broken) this.brain.startReact('trampled');
  }

  /**
   * The hero is parrying the blow that is landing (player.js _parry, for a hit marked `steel`).
   * At the impact his blade is already THROUGH the hero (a strike's `through` pose): the steel must
   * be shown where it met the guard. Steps the pose back along the strike (at most CONTACT.max s of
   * clip time) until the blade is clear of the hero's centre line by CONTACT.clear m, leaves him
   * posed there (brain.setBack: the freeze-frame holds it; a blow that is only deflected then
   * rebounds off the guard) and returns the blade: { ax … bz: hilt → tip, vx vy vz: the way the tip
   * was travelling } in drawn space. `chest`: the hero's chest (drawn). null without a blade.
   */
  parryContact(chest, last = true) {
    if (!this._tipOk || !chest) return null;
    const B = this._blade, h = this._hilt, t = this._tip;
    // the way the tip is going (this frame's travel, before any stepping back)
    B.vx = t.x - this._tipPrev.x;
    B.vy = t.y - this._tipPrev.y;
    B.vz = t.z - this._tipPrev.z;
    const b = this.brain;
    if (this.mode === 'act' && b.act) {
      // (at the impact's frame a cut is often already PAST him: ~0.4 m a frame. Find where it
      // crossed, then the last clear pose before that)
      const C = this._cp, c0 = C[0].set(chest.x, chest.y - 0.45, chest.z), c1 = C[1].set(chest.x, chest.y + 0.4, chest.z);
      const t1 = b.clipT, N = CONTACT.steps, ds = CONTACT_D;
      let kmin = 0;
      for (let k = 0; k <= N; k++) {
        if (k) this._poseAt(t1 - (k / N) * CONTACT.max);
        ds[k] = closestOnSegments(h, t, c0, c1, C[2], C[3]);
        if (ds[k] < ds[kmin]) kmin = k;
      }
      let k = kmin;
      while (k < N && ds[k] < CONTACT.clear) k++;
      let off = (k / N) * CONTACT.max;
      if (ds[k] < CONTACT.clear) {
        // a thrust down his centre line: the guard sets it aside. He is turned so its line passes
        // beside the hero, on the side it already leans to
        off = CONTACT.thrust;
        const dx = chest.x - this.position.x, dz = chest.z - this.position.z, dist = Math.hypot(dx, dz);
        this._poseAt(t1 - off);
        const cross = (t.x - h.x) * dz - (t.z - h.z) * dx;
        this.yaw = wrapAngle(this.yaw + Math.asin(clamp(CONTACT.aside / Math.max(dist, 0.9), 0, 0.5)) * (cross >= 0 ? 1 : -1));
      }
      this._poseAt(t1 - off);
      b.setBack(off, !last);
      this._tipPrev.copy(t); // (no sweep stroke for the step back)
      this._hiltPrev.copy(h);
    }
    B.ax = h.x;
    B.ay = h.y;
    B.az = h.z;
    B.bx = t.x;
    B.by = t.y;
    B.bz = t.z;
    return Number.isFinite(B.ax + B.ay + B.az + B.bx + B.by + B.bz) ? B : null;
  }

  /** His blade as it is drawn right now ({ a: hilt, b: tip }, live vectors): the blade lock's
   *  crossing is found on it (player.js _lockCross). null without one. */
  bladeSegment() {
    if (!this._tipOk) return null;
    const S = this._seg ?? (this._seg = { a: this._hilt, b: this._tip });
    return S;
  }

  /** Pose him at clip time t, now (no time passes): the blade's drawn points follow. */
  _poseAt(t) {
    const pl = this.pilot;
    pl.stateT = pl.animT = Math.max(0, t);
    pl.yaw = this.yaw;
    this.object3d.rotation.y = this.yaw;
    this.lean.on = false;
    this.anim.update(0);
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    const s = this.rig.sword, K = this.kit.blade;
    this._hilt.set(0, 0, K.guard).applyMatrix4(s.matrixWorld);
    this._tip.set(0, 0, K.tip).applyMatrix4(s.matrixWorld);
  }

  /** Where the blades meet: the point of his blade (from mid-blade to the tip) nearest the hero's
   *  chest (the Lab's overlay, a thrown thing's parry). */
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

  /** A cinematic moment on the clash between him and the hero (flow.cinematic, this.T.cinematic,
   *  any field overridden by `o`). */
  _cinematic(kind, o = null) {
    const p = this.game.player?.position, C = o ? { ...this.T.cinematic, ...o } : this.T.cinematic;
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
    this.maxPosture = perPhase(this.T.posture.max, 1);
    this.posture = 0;
    this.postureTimer = 0;
    this.broken = false;
    this.flash = 0;
    this.dissolve = 0;
    this.warn = 0;
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
    this.fx.update(dt, this);
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
    if (this.postureTimer > this.T.posture.regenDelay) {
      this.posture = Math.max(0, this.posture - this.T.posture.regenRate * dt);
      this.emitPosture();
    }
  }

  _break() {
    if (this.broken || this.mode === 'dying' || this.mode === 'dead' || this.mode === 'sleep' || this.mode === 'intro') return;
    if (this.brain.act?.def?.transition) {
      this.brain.pendingBreak = true; // a transition finishes first
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

  /** Phase n begins (its transition's start): its posture meter, emptied. */
  enterPhase(n) {
    this.phase = clamp(Math.round(fin(n, 2)), 1, Math.max(1, this.kit.maxPhase ?? this.T.phaseAt.length));
    this.maxPosture = perPhase(this.T.posture.max, this.phase);
    this.posture = 0;
    this.postureTimer = 0;
    this.emitPosture(true);
  }

  _applyDamage(dmg) {
    let hp = this.hp - dmg;
    const gate = this.nextPhaseHp;
    if (gate > 0 && this.brain.aiEnabled && this.hp >= gate) hp = Math.max(gate, hp);
    this.hp = Math.max(0, hp);
    if (gate > 0 && this.hp <= gate) this.brain.pendingPhase = this.phase + 1;
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
  /** The hero is in his front arc (this.T.guard.arc). */
  _fromFront() {
    const p = this.game.player?.position;
    if (!p) return true;
    const a = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    return Math.abs(wrapAngle(a - this.yaw)) <= this.T.guard.arc;
  }

  /**
   * His guard turns the hero's strike. What he does with it is the brain's (onGuarded): he holds it
   * on the side it came from (a ward), beats it away (a deflect: the hero's blade is thrown back, his
   * counter follows), or, mid-windup, turns it in passing. He is posed at once (the hero's blade is on
   * him this frame, and the freeze holds it), and the clash is drawn on the crossing of the blades.
   */
  _guardClash(heavy, point) {
    const G = this.T.guard, p = this.game.player;
    this.addPosture(heavy ? this.T.posture.guard.heavy : this.T.posture.guard.light);
    const what = this.broken ? 'armor' : this.brain.onGuarded(heavy, this._wardFor(p));
    const deflect = what === 'deflect';
    if (what !== 'armor' && this.mode === 'react') this._animate(1 / 120);
    // the crossing of his blade and the hero's
    const h = this._hilt, t = this._tip, C = this._cp, sw = p?.sweep;
    let x = (h.x + t.x) * 0.5, y = (h.y + t.y) * 0.5, z = (h.z + t.z) * 0.5;
    let e1 = null, e2 = null, spray = null;
    if (this._tipOk && sw?.valid) {
      const gap = closestOnSegments(h, t, sw.a, sw.b, C[0], C[1]);
      // (near his own steel: the hero's blade is often already past him in the frame it lands)
      const w = gap < 0.6 ? 0.25 : 0;
      x = C[0].x + (C[1].x - C[0].x) * w;
      y = C[0].y + (C[1].y - C[0].y) * w;
      z = C[0].z + (C[1].z - C[0].z) * w;
      e1 = C[2].set(t.x - h.x, t.y - h.y, t.z - h.z);
      e2 = C[3].set(sw.b.x - sw.a.x, sw.b.y - sw.a.y, sw.b.z - sw.a.z);
      // the hero's blade was travelling this way: the sparks are thrown on along it
      spray = C[0].set(sw.b.x - sw.pb.x, sw.b.y - sw.pb.y + 0.02, sw.b.z - sw.pb.z);
      if (spray.lengthSq() < 1e-6) spray = null;
    }
    if (!Number.isFinite(x + y + z) && point) {
      x = point.x;
      y = point.y;
      z = point.z;
    }
    this.fx.guard(x, y, z, { heavy, deflect, e1, e2, spray });
    this.emit('dragon:guard', { heavy, deflect });
    // steel on steel: a freeze, a kick, his blade jolted
    this.hitstop(deflect ? G.deflectStop ?? 0.1 : heavy ? G.clashStop * 1.6 : G.clashStop, 0.03);
    this.game.shake?.(deflect ? 0.34 : heavy ? 0.3 : 0.18);
    this.game.punch?.(deflect ? 2.4 : heavy ? 1.4 : 0.7);
    this.jolt = Math.max(this.jolt, what === 'armor' ? (heavy ? 0.5 : 0.3) : heavy ? 0.4 : 0.2);
    try {
      p?.onGuarded?.({ deflect, heavy, attacker: this });
    } catch (err) {
      console.error('[duelist] player.onGuarded failed', err);
    }
  }

  /** Which ward meets the hero's strike: 'wardHigh' for a blow from above (the finisher, a blade well
   *  over his chest), else the side of him the hero's blade is on ('ward' his left, 'wardR'). */
  _wardFor(p) {
    const sw = p?.sweep, c = this._hs[1];
    if (!sw?.valid || !Number.isFinite(c.x + c.y + c.z)) return 'ward';
    const mx = sw.a.x + (sw.b.x - sw.a.x) * 0.6, my = sw.a.y + (sw.b.y - sw.a.y) * 0.6, mz = sw.a.z + (sw.b.z - sw.a.z) * 0.6;
    if (p.atk?.def?.kind === 'slam' || my - c.y > 0.5) return 'wardHigh';
    // (+x of his body is his left: left = (cos yaw, −sin yaw))
    return (mx - c.x) * Math.cos(this.yaw) - (mz - c.z) * Math.sin(this.yaw) >= 0 ? 'ward' : 'wardR';
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
        damage: o.damage * (this.T.damageScale ?? 1),
        from: o.from ?? { x: this.position.x, z: this.position.z },
        knockback: o.knockback ?? 0,
        knockdown: !!o.knockdown,
        kind: o.kind ?? 'slash',
        tell,
        parryable: o.parryable ?? def.parryable,
        blockable: o.blockable ?? def.blockable,
        attack: o.attack ?? 'strike',
        attacker: this,
        light: !!o.crescent || !!o.light,
        mikiri: !!o.mikiri, // a perilous thrust: a roll INTO it is the mikiri (player.js)
        // a blade's blow: where the steel is (the hero's deflect meets it there), and whether the
        // exchange goes on after it (a string's non-final hit: a short freeze)
        steel: !!o.beat && !o.crescent && !o.projectile,
        last: o.beat ? !!o.beat.last : true,
        ...(o.extra ?? null),
      });
    } catch (err) {
      console.error('[disciple] player.takeHit failed', err);
      return RESULT.IGNORED;
    }
    if (r === RESULT.PARRIED) {
      if (o.crescent || o.projectile) {
        // a thrown thing (sword qi, a bolt, a hurled stone): the parry spends it and nicks his posture
        this.addPosture(o.parryPosture ?? 8);
        this.emit('dragon:parried', { attack: o.attack ?? 'ashCrescent', tell, hit: 0, last: false, bullet: true });
      } else this.onParried({ attack: o.attack, tell });
    }
    return r ?? RESULT.IGNORED;
  }

  // ---------------------------------------------------------------- frame
  _animate(dt) {
    const pl = this.pilot, b = this.brain;
    this.jolt = Math.max(0, this.jolt - dt * this.T.hitStun.joltDecay);
    pl.recoil = this.jolt;
    pl.yaw = this.yaw;
    // (a parried blow is shown held back on its strike, where the blades met: brain.back)
    pl.stateT = pl.animT = Math.max(0, b.clipT - b.back.off);
    pl.atk.def = b.clip;
    // the guard raised over his footwork (poses.js duelLoco blends the wardHold clip in)
    pl.ward = b.wardK;
    pl.wardClip = b.C.wardHold ?? null;
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

  /** Drawn points for FX: the blade's hilt and tip (leaned, HERO_SCALE). */
  _drawnPoints() {
    const s = this.rig.sword;
    this._tipPrev.copy(this._tip);
    this._hiltPrev.copy(this._hilt);
    const ok = this._tipOk;
    const B = this.kit.blade;
    this._hilt.set(0, 0, B.guard).applyMatrix4(s.matrixWorld);
    this._tip.set(0, 0, B.tip).applyMatrix4(s.matrixWorld);
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
    for (const m of mats) {
      const u = m.uniforms;
      if (!u) continue;
      u.uFlash.value = this.flash * 0.8;
      u.uDissolve.value = this.dissolve;
      u.uWarn.value.set(1.0, 0.12, 0.05, w);
    }
    this._bladeMaterials(dt, M);
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
    this.game.world?.resolve?.(this.position, this.T.radius, B + this.T.radius);
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

export { HERO_SCALE, perPhase };
