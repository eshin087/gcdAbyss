import * as THREE from 'three';
import { CONFIG } from '../../../core/config.js';
import { clamp, wrapAngle } from '../../../core/math.js';
import { markCaster } from '../../../render/pipeline.js';
import { batchRigid } from '../../../render/rigidBatch.js';
import { TELL, TELL_STYLE, RESULT, POSTURE, DEFENSE, tellDefaults, dodgeOnly } from '../../../combat/rules.js';
import { blackBody } from '../../../combat/blackout.js';
import { buildHero, setHeroGlyphScale, installLean, LEAN, HERO_SCALE, DIM } from '../../player/model.js';
import { REACH } from '../../player/combat.js';
import { HeroAnimator } from '../../player/anim.js';
import { perPhase } from './realise.js';
import { DuelBrain } from './brain.js';
import { DuelFx } from './fx.js';
import { closestOnSegments } from '../../../combat/clashFx.js';
import { counterChainOn } from '../../../combat/flashChain.js';
import { impactK } from '../../../combat/impact.js';
import { calmBossFlash } from '../../../combat/impactCalm.js';
import { HitReact } from './react.js';
import { CONTACT as STRIKE, ContactBody, contactOn, contactReach, contactStep, findContact } from '../../../combat/contact.js';
import { clashNext, clashMult, clashRegenK } from '../../../combat/clashDance.js';

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
//   scale                his drawn size (model metres → world; default HERO_SCALE). Visual only
//   REACT, OPEN          extra reaction clips' root motion / which of them leave him open (optional)
// }
// Subclass hooks: _tint(M) (his colours), _setup() (extra meshes, before batching), _bladeMaterials(dt),
// brainFrame(dt), afterPose(dt, act), onImpact(beat, sense, act), onRelease(beat, sense, act),
// onCast(beat, sense, act), beatMotion(beat, u, sense, dt), onTransitionEnd(act), _onHpZero(), and for
// moves that depend on the level (ADR-111): weigh(name, def, w, dist) → the weight his AI gives the
// move right now (0 = not now), onActStart(act, opts) → false when the move cannot start (no piece).

const TARGETABLE = new Set(['waking', 'combat', 'staggered', 'airborne']);
// a parried blow's contact (parryContact): the pose is stepped back over `max` s of clip time in
// `steps`; the contact is the last pose BEFORE the blade crosses the hero's centre line in which it is
// still `clear` m off it (where his guard is). A blade that never clears (a thrust down the line) is
// shown `thrust` s back and set `aside` m off the hero.
const CONTACT = { max: 0.06, steps: 8, clear: 0.34, thrust: 0.022, aside: 0.4 };
const CONTACT_D = new Float32Array(CONTACT.steps + 1);
// the trade clash on his side (a kit's TUNING.trade overrides): guard posture × `posture`, he gives `push` m
const TRADE = { posture: 1.5, push: 0.5 };
// the glow on his body (uWarn, additive): a red cue's spike, a black blow's charge
const WARN_RED = TELL_STYLE.red.warn.color, WARN_BLACK = TELL_STYLE.black.warn.color;
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const KEEP_OPEN = new Set(['reeling', 'recoil', 'stagger']); // (the deathblow's read keeps him in these: takeHit)
/** A move's first real hit's tell (a `pick` beat: its first alternative). */
const firstTell = (def) => def.beats.map((b) => (Array.isArray(b.pick) ? b.pick[0] : b)).find((b) => !b.feint)?.tell ?? TELL.NORMAL;

const _spot = { x: 0, z: 0 }; // (standable's probe)

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
    this.warn = 0; // the glow on his body 0..1.6: a red cue's spike, a black blow's charge (ADR-118)
    this.warnTell = TELL.RED; // which of the two it is (its colour: TELL_STYLE[tell].warn / WARN_RGB)
    this.execRange = TUNING.execRange;
    // the Ghostep (player.js) puts the hero this far behind him: within sword reach of his back
    this.ghostepBehind = TUNING.ghostepBehind;
    // his streak (DEFENSE.foeStreak): strikes of the hero's his guard turned in a row; a strike that
    // lands on him ends it; from its `min` a guard may answer with his flurry (brain.startStreak)
    this.streak = 0;
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
    // the shudder (TUNING.hitStun[*].shudder): through the freeze of a landed cut his drawn figure
    // flickers ± amp m along the cut (x, z), fading over t0 s of real time; drawn only (lean.ox / oz).
    // shudderK 0 turns it off (the Lab)
    this._shud = { t: 0, t0: 1, amp: 0, x: 0, z: 0, s: 1, fresh: false };
    this.shudderK = 1;
    this._tipOk = false;
    this._lastParry = -9;
    // the clash dance's run (combat/clashDance.js; ADR-247): { act, n, t (the hero's clock), hurt (his hurtN) }
    this._clash = null;
    this._lastHurtPt = new THREE.Vector3();

    // the animator's view of him (anim.js HeroAnimator reads these)
    this.pilot = {
      position: this.position, yaw: 0, state: 'duel', stateT: 0, animT: 0, atk: { def: null },
      groundVel: { x: 0, z: 0 }, kb: { x: 0, z: 0 }, chargeK: 0, releaseK: 0, recoil: 0, lockOn: false, guardHold: 0,
    };
    // (kit.animOpts: a boss's own animator options, e.g. its feet's release ease; ADR-223. None: as before)
    this.anim = new HeroAnimator(this.rig, this.pilot, kit.poses, kit.animOpts);
    // his drawn size (kit.scale; HERO_SCALE by default): visual only, as the hero's
    this.drawScale = kit.scale > 0 ? kit.scale : HERO_SCALE;
    this.pilot.drawScale = this.drawScale;
    this.lean = installLean(this.object3d, this.drawScale);
    // the body answers where it was hit (the impact pass's `react`: react.js): a drawn layer over the
    // pose, as the shudder; gameplay points never see it
    this.hitReact = new HitReact(this);
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
      // his streak set by hand, and his flurry of `n` blows now (DEFENSE.foeStreak)
      streak: (n) => this._streakSet(n),
      flurry: (n = 4) => this.brain.startStreak(n),
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
    if (a && this._tipOk && !this.shuddering) {
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
  /** His drawn figure shudders this frame (a landed cut's freeze): its blade's travel between frames
   *  is the flicker, not a swing, so the sweep trails pause (afterPose). */
  get shuddering() {
    return this._shud?.t > 0;
  }
  /** His guard is up (brain.guardUp): footwork, a ward, an early windup, a late recovery. */
  get guarding() {
    return this.brain.guardUp();
  }

  isTargetable() {
    return TARGETABLE.has(this.state);
  }

  /** A move's name for the player (the death screen, the telemetry); null for an id he does not know. */
  attackLabel(id) {
    const l = this.kit?.MOVES?.[id]?.label;
    return typeof l === 'string' && l ? l.replace(/\s*\(.*\)\s*$/, '') : null;
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
   * A hit from the player ({ damage, part, point, dir, poise, heavy, crit, exact, posture, flash }:
   * `exact` = final damage past his guard, `flash` = the most the hurt flash may be). Strikes
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
    // a counter stance (a beat marked `stance`, brain.catching): a sword cut that reaches him in it is
    // CAUGHT, whatever side it came from
    if (!o.exact && !this.broken) {
      const cb = this.brain.catching?.();
      if (cb) {
        this._catch(cb, heavy, o.point);
        return 0;
      }
    }
    let crushed = false;
    if (!o.exact && this.guarding && !this.broken && this._fromFront()) {
      if (heavy && fin(o.poise) >= G.crushPoise) crushed = true;
      else {
        this._guardClash(heavy, o.point);
        return 0;
      }
    }
    // the trade clash: the hero's cut connects in the last moment before his own blow would land
    if (o.swing && !o.exact && !this.broken && this._tradeNow()) return 0;
    const P = this.T.parts;
    const part = P[o.part] !== undefined ? o.part : 'body';
    const broken = this.broken;
    const dmg = o.exact ? Math.max(1, Math.round(raw)) : Math.max(1, Math.round(raw * P[part] * (broken ? this.T.posture.breakCritMult : 1)));
    const crit = !!o.crit || broken;
    this._applyDamage(dmg);
    this.flash = Math.max(this.flash, calmBossFlash(Math.min(heavy || crit ? 1 : 0.8, fin(o.flash, 1))));
    let dx = fin(o.dir?.x, NaN), dz = fin(o.dir?.z, NaN);
    if (!Number.isFinite(dx + dz) || dx * dx + dz * dz < 1e-6) {
      const p = this.game.player?.position;
      dx = p ? this.position.x - p.x : 0;
      dz = p ? this.position.z - p.z : 1;
    }
    const l = Math.hypot(dx, dz) || 1;
    // his spray flies along the cut (o.cut: the blade's ground-plane travel at the contact), the
    // shove along the blow (o.dir)
    let sx = fin(o.cut?.x, NaN), sz = fin(o.cut?.z, NaN);
    if (!Number.isFinite(sx + sz) || sx * sx + sz * sz < 1e-6) {
      sx = dx / l;
      sz = dz / l;
    } else {
      const sl = Math.hypot(sx, sz);
      sx /= sl;
      sz /= sl;
    }
    // hit stun: a freeze-frame, his chest and head snapped back (poses.js jolt), a shove along the
    // blow; it never cancels a windup (only footwork and his recovery: brain.onStruck)
    // (`reel`: a blow of the hero's flurry: 1 a flash cut, thrown as by a heavy blow; 2 its last,
    // which staggers him)
    const reel = fin(o.reel, 0);
    this._streakSet(0); // struck: his streak of guards is over
    const HS = this.T.hitStun, hs = heavy || crushed || reel > 0 ? HS.heavy : HS.light;
    const stopUsed = crit ? Math.max(hs.stop, HS.critStop) : hs.stop;
    this.hitstop(stopUsed, 0.03);
    this.jolt = Math.max(this.jolt, hs.jolt * (reel > 0 ? 1.25 : 1));
    // (the shudder is a sword cut's: o.swing; not his own returned bolt)
    const sa = o.swing ? fin(hs.shudder, 0) * fin(this.shudderK, 1) : 0, S = this._shud;
    if (sa > 0 && stopUsed > 0) {
      S.t0 = S.t = stopUsed;
      S.amp = sa;
      S.x = sx;
      S.z = sz;
      S.s = 1;
      S.fresh = true; // the contact frame draws it at full strength: the countdown starts next frame
    }
    const px0 = this.position.x, pz0 = this.position.z;
    // (a flurry's blows do not shove him: its cuts cross where he STANDS, and a shove from a new
    // side every quarter second read as him jumping about. He jolts, and reels where he is)
    if (this.mode !== 'broken' && this.position.y < 0.2 && !(reel > 0)) this.moveBy((dx / l) * hs.push, (dz / l) * hs.push);
    const pt = o.point;
    let hurt = null;
    if (pt && Number.isFinite(pt.x + pt.y + pt.z)) {
      // (his spray starts on him where he is drawn after the shove: the cut moved with him)
      const hx = pt.x + fin(this.position.x - px0, 0), hz = pt.z + fin(this.position.z - pz0, 0);
      this.fx.hitSpark(hx, pt.y, hz, sx, sz, heavy || crit);
      hurt = this._lastHurtPt.set(hx, pt.y, hz);
    }
    // the body answers where it was hit (react.js; a sword's cut only, never his own returned bolt).
    // Drawn only, from the hit's own tick: impactK('react') 0 leaves him as he always moved
    if (o.swing || reel > 0) {
      const kR = impactK('react', 'duelist');
      if (kR > 0) {
        const mx = fin(this.position.x - px0, 0), mz = fin(this.position.z - pz0, 0);
        const R = this._reactHit ?? (this._reactHit = { k: 0, part: 'body', point: null, cut: { x: 0, z: 0 }, dir: { x: 0, z: 0 }, thrust: NaN, heavy: false, crit: false, reel: 0, skid: 0, moved: { x: 0, z: 0 } });
        R.k = kR;
        R.part = part;
        R.point = hurt;
        R.cut.x = sx;
        R.cut.z = sz;
        R.dir.x = dx / l;
        R.dir.z = dz / l;
        // (a thrust: the hero's attack that landed it, a `point` or the execution's thrust)
        const pd = o.swing ? this.game.player?.atk?.def : null;
        R.thrust = pd ? (pd.contact === 'point' || pd.contact === 'execute' || pd.kind === 'thrust' ? 1 : 0) : NaN;
        R.heavy = heavy || crushed;
        R.crit = crit;
        R.reel = reel;
        R.skid = Math.hypot(mx, mz);
        R.moved.x = mx;
        R.moved.z = mz;
        R.limb = typeof o.limb === 'string' ? o.limb : null; // (CONTACT: the capsule the hero's steel met)
        this.hitReact.hit(R);
      }
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
    } else if (reel >= 2) {
      // the last blow of a flurry: he is thrown out of whatever he was doing, and stumbles AWAY from
      // where the hero ends it (o.away: behind him after an art, so he pitches forward; a stagger's
      // own step back would carry him into the hero)
      if (this.brain.startReact('stagger')) {
        const R = this.brain.react, aw = o.away;
        if (R && aw && Number.isFinite(aw.x + aw.z)) {
          const front = (aw.x - this.position.x) * Math.sin(this.yaw) + (aw.z - this.position.z) * Math.cos(this.yaw);
          R.travel = (front >= 0 ? -1 : 0.7) * Math.abs(R.travel);
        }
        this.emit('dragon:stagger');
      }
    } else if (reel > 0) {
      // a flurry's cut: every one flinches him where he stands, whatever he was doing (the string
      // he was dodged out of is over: he does not hang in its pose while he is cut). The deathblow's
      // read (ADR-264): `keepOpen` leaves him in the open reaction the parry threw him into while most
      // of it is still to run (the blow jolts him there); `shove` m drives him back with the flinch
      const RK = this.brain.react;
      if (!(o.keepOpen && this.mode === 'react' && RK && KEEP_OPEN.has(RK.kind) && RK.t < RK.clip.dur * 0.75)) {
        if (this.brain.startReact('flinch') && this.brain.react) this.brain.react.travel = -Math.max(0, fin(o.shove, 0));
      }
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
    // the execution's thrust folds him round the point (react.js): run in along the hero's facing
    const kR = impactK('react', 'duelist'), p = this.game.player;
    if (kR > 0 && p?.position) {
      const ex = this.position.x - p.position.x, ez = this.position.z - p.position.z, el = Math.hypot(ex, ez);
      if (el > 1e-4) this.hitReact.hit({ k: kR, part: 'body', point: null, cut: { x: ex / el, z: ez / el }, dir: { x: ex / el, z: ez / el }, thrust: 1, heavy: true, crit: true, reel: 0, skid: 0 });
    }
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
    // a parry MOMENT (a blue flare blow, ADR-118) ends his string wherever in it the blow came: he
    // recoils as from a parried last blow, and the hero's counter comes (player.js _tickRiposte)
    const moment = !!b?.def?.flare && tell === TELL.BLUE;
    const last = !a || !b || !!b.last || moment;
    this.emit('dragon:parried', { attack: attack ?? 'strike', tell, hit, last, flare: moment });
    if (string && a) {
      a.chain = (a.chain ?? 0) + 1;
      if (a.chain >= 2) this.emit('combat:deflectChain', { count: a.chain });
    }
    // (no burst of his own: the hero's parry draws the one clash, on the crossing of the two blades)
    this.flash = Math.max(this.flash, 0.5);
    this.jolt = Math.max(this.jolt, tell === TELL.BLUE ? 0.75 : 0.55); // the turned blow jars him
    this.addPosture((POSTURE.parry[tell] ?? POSTURE.parry.normal) * (this.game.player?.deflect?.perfect ? POSTURE.perfect : 1) * this._clashMult());
    if (this.mode !== 'act' || !a) return; // the parry broke his posture (broken) or the move is gone
    if (a) a.parried = (a.parried ?? 0) + 1;
    // the blade lock: a PERFECT parry of a blow marked `lock` crosses the blades, unless the deathblow combo that
    // parry armed takes it (a blue blow, player.deathblowClaims; he recoils below and the combo follows; ADR-280)
    const P = this.game.player;
    if (b?.def?.lock && P?.deflect?.perfect && !P.deathblowClaims?.(this) && this.brain.startLock()) return;
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

  /**
   * The hero's cut connects (takeHit) while his own blow is on its way: a blade's beat (not red, not
   * a feint, a cast or a thrown thing) at most DEFENSE.trade.window s from its impact, the hero in
   * his front. The two cuts meet: the beat is spent (it never lands), his timeline skips to its
   * impact, the hero draws the clash (player.onTrade) and he answers as to any trade (onClashed).
   * True if it was a trade.
   */
  _tradeNow() {
    const br = this.brain, a = br.act, p = this.game.player;
    if (this.mode !== 'act' || !a || a.def.transition || typeof p?.onTrade !== 'function' || !p.canTrade?.() || !this._fromFront()) return false;
    const b = a.beats.find((x) => !x.done && !x.feint && a.t < x.impact);
    // (a beat that is not a blow of his body (a beam's head: `selfHit`, a stream held lit: `sustain`) is no trade)
    if (!b || !b.def.zone || b.def.release || b.def.cast || b.def.selfHit || b.def.sustain || dodgeOnly(b.def.tell)) return false;
    if (b.impact - a.t > DEFENSE.trade.window) return false;
    br.skipTo(b.impact);
    b.done = true;
    b.traded = true;
    a.striking = b;
    let r = null;
    try {
      r = p.onTrade(this, { tell: b.def.tell, attack: a.name, last: !!b.last });
    } catch (err) {
      console.error('[duelist] player.onTrade failed', err);
    }
    if (!r) return false;
    this.onClashed({ tell: b.def.tell, beat: b, heavy: r.heavy, crush: r.crush });
    return true;
  }

  /**
   * A trade clash (the hero's cut met his blow; hitPlayer on RESULT.CLASHED, or _tradeNow). Guard
   * posture × TUNING.trade.posture, he is jarred and gives ground. A string goes on (the blade
   * rebounds, as from a deflect); its last blow, or a single strike, ends in the short 'clash'
   * reaction: no punish window (only a parry earns that). A cleave that crushes (`crush`) beats his
   * blow aside and staggers him.
   */
  onClashed(info = {}) {
    if (this.mode === 'dying' || this.mode === 'dead') return;
    if (this.time - this._lastParry < 0.1) return;
    this._lastParry = this.time;
    const p = this.game.player, a = this.brain.act, b = info.beat ?? a?.striking ?? null;
    const heavy = info.heavy ?? !!p?.atk?.def?.heavy;
    const crush = info.crush ?? (heavy && fin(p?.atk?.poise) >= this.T.guard.crushPoise);
    const TR = this.T.trade ?? TRADE;
    this.flash = Math.max(this.flash, 0.5);
    this.jolt = Math.max(this.jolt, heavy ? 0.9 : 0.7);
    this.addPosture((heavy ? this.T.posture.guard.heavy : this.T.posture.guard.light) * TR.posture);
    if (this.mode !== 'act' || !a) return; // (the trade broke his posture, or the move is gone)
    if (crush) {
      this.emit('dragon:stagger');
      this.brain.startReact('stagger');
      return;
    }
    const pp = p?.position;
    if (pp) {
      const dx = this.position.x - pp.x, dz = this.position.z - pp.z, l = Math.hypot(dx, dz) || 1;
      if (b && !b.last && a.hits > 1) this.moveBy((dx / l) * TR.push * 0.6, (dz / l) * TR.push * 0.6);
    }
    if (!b || b.last || a.hits <= 1) {
      if (this.brain.startReact('clash') && this.brain.react) this.brain.react.travel = -TR.push;
    }
  }

  /**
   * The flash counter (player.js _trade, DEFENSE.counter): the hero's cut met his blow in the instant
   * it became a cut. His blow is beaten aside and the cut goes through him: `damage` (final, past
   * any guard) and `posture` at once, he reels (a cinematic moment) and his string is over.
   * o: { point, dir }. Returns the damage dealt.
   */
  onCounter(o = {}) {
    if (this.mode === 'dying' || this.mode === 'dead') return 0;
    this._lastParry = this.time; // (hitPlayer's onClashed for this same blow: already answered)
    const K = DEFENSE.counter;
    this.jolt = Math.max(this.jolt, 1);
    // the flash chain (?counter=chain, combat/flashChain.js): the link is one more than the link of the
    // strike-back he is throwing (brain.act.flashLink), else the first. One Breath's draw counter
    // (o.damage set) is never a link
    const CH = DEFENSE.counterChain, chain = counterChainOn() && o.damage == null;
    const link = chain ? Math.min(CH.links, (this.brain.act?.flashLink ?? 0) + 1) : 0, i = link - 1;
    o.link = link;
    o.links = chain ? CH.links : 0;
    // (o.damage / o.posture: a counter of its own, the hero's One Breath: ADR-146)
    const dmg = chain ? CH.damage[i] : fin(o.damage, K.damage), post = chain ? CH.posture[i] : fin(o.posture, K.posture);
    const dealt = this.takeHit({ damage: dmg, part: 'body', point: o.point, dir: o.dir, heavy: true, crit: true, exact: true, posture: post, flash: 1, reel: 1 });
    if (this.mode === 'dying' || this.mode === 'dead' || this.broken) return fin(dealt);
    this.emit('dragon:stagger');
    if (chain && link < CH.links) {
      // not the last link: thrown back a step, and he strikes back at once (brain._foot: the counter
      // move, tagged with this link so a flash counter of it is the next)
      if (this.brain.startReact(CH.react) && this.brain.react) this.brain.react.travel = -CH.push;
      this.brain.counter.pending = true;
      this.brain.counter.link = link;
      return fin(dealt);
    }
    this._cinematic('counter');
    this.brain.startReact('reeling');
    return fin(dealt);
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
    this.brain.counter.link = 0;
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
   * `blade` ({ a, b }: the hero's own blade, in a trade clash): the pose is the clear one in which
   * the two blades are nearest.
   */
  parryContact(chest, last = true, blade = null) {
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
      if (blade && ds[k] >= CONTACT.clear) {
        // a trade clash: the hero's own blade is in the air. Of the clear poses before the crossing,
        // the one in which the two blades are nearest
        let best = Infinity;
        for (let j = k; j <= N; j++) {
          this._poseAt(t1 - (j / N) * CONTACT.max);
          const g = closestOnSegments(h, t, blade.a, blade.b, C[2], C[3]);
          if (g < best - 0.01) {
            best = g;
            k = j;
          }
        }
      }
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

  /**
   * CONTACT (combat/contact.js, ADR-259; ?contact=a): his blow lands ON what it struck. `meet(a, b, r, out)`
   * is the struck thing's signed gap (m, − inside) to a striker a → b of radius r, its meeting point into
   * out: the hero's drawn body (a hit), or his blade and body (a block). The strike is searched along its
   * own clip from the frame the blow was decided (back where it had gone through, on where it fell short),
   * he is posed at the meeting (the edge biting CONTACT.bite in, a fist or foot on the surface) and held
   * there through the freeze (brain.pinAt; `heavy`: a beat longer), then the blow carries on. The clip, the
   * blow's clock and every rule are untouched. `biteAt`: the bite's depth instead (m; a guard: on the steel).
   * Returns the meeting point (world, drawn) or null (off, not
   * in a strike, no striker, or one that never reaches within CONTACT.near).
   */
  strikeContact(meet, heavy = false, biteAt = null) {
    if (!contactOn() || typeof meet !== 'function' || this.mode !== 'act' || !this.brain.act || !this._tipOk) return null;
    const b = this.brain, B = b.back;
    if (B.off > 0 || B.t > 0) return null; // (a parried blow already held at its contact)
    const limb = typeof this._part === 'string' && this._part !== 'sword';
    const r = limb ? (/foot|feet|knee|leg|shin/i.test(this._part) ? STRIKE.foot : STRIKE.fist) : STRIKE.edge;
    const bite = Number.isFinite(biteAt) ? biteAt : limb ? STRIKE.fistBite : STRIKE.bite;
    const P = this._meetAt ?? (this._meetAt = new THREE.Vector3());
    const h = this._hilt, tp = this._tip, t1 = b.clipT;
    // (his drawn reach, `b`: _poseAt poses the plain body; the striker is where it is drawn, shifted with it)
    const rx = fin(this._reach?.x, 0), rz = fin(this._reach?.z, 0);
    const at = (t) => {
      this._poseAt(t);
      if (rx !== 0 || rz !== 0) {
        h.x += rx;
        h.z += rz;
        tp.x += rx;
        tp.z += rz;
      }
      return limb ? meet(tp, tp, r, P) : meet(h, tp, r, P);
    };
    let tc = NaN;
    try {
      tc = findContact(at, t1, bite, STRIKE, 0);
    } catch (err) {
      console.error('[duelist] strikeContact failed', err);
    }
    if (!Number.isFinite(tc)) {
      this._poseAt(t1);
      this._tipPrev.copy(tp);
      this._hiltPrev.copy(h);
      return null;
    }
    at(tc);
    b.pinAt(tc, heavy ? STRIKE.holdHeavy : STRIKE.hold, STRIKE.follow);
    this._tipPrev.copy(tp); // (no sweep stroke for the step)
    this._hiltPrev.copy(h);
    return Number.isFinite(P.x + P.y + P.z) ? P : null;
  }

  /**
   * CONTACT's reach (combat/contact.js, `?contact=b`): as a blow of his comes (STRIKE.reach.lead s before its
   * impact) with the hero in its zone, the gap its striker would leave on the hero's drawn body at the impact
   * is read (posed there once a frame) and his drawn body eases toward the hero to close it (STRIKE.reach.max
   * m at most), arriving with the impact; held through the blow's pin, then eased back. The shift is drawn
   * only (react.js setReach: the feet stay planted, the legs are solved again); his gameplay points, the
   * zone and every rule never see it. Called at the top of _animate (it poses him: the animator then poses
   * the frame).
   */
  _reachStep(dt) {
    const R = (this._reach ??= { x: 0, z: 0, tx: 0, tz: 0, keep: 0, left: 0 }), K = STRIKE.reach;
    const b = this.brain, A = b.act, p = this.game.player;
    let found = false;
    if (contactReach() && this.mode === 'act' && A && this._tipOk && p?.rig && !(b.back.off > 0) && !(b.back.t > 0)) {
      let beat = null;
      for (const x of A.beats) {
        if (x.done || x.feint || !x.def?.zone || x.def.cast || x.def.projectile) continue;
        if (x.impact >= A.t - 1e-6 && x.impact - A.t <= K.lead) {
          beat = x;
          break;
        }
      }
      const s = beat ? b._sense() : null;
      if (beat && s && b._inZone(beat.def.zone, s, !!beat.def.air)) {
        const B = (this._heroBody ??= new ContactBody(THREE));
        if (B.fromRig(p.rig, p.drawScale || 1)) {
          const limb = typeof this._part === 'string' && this._part !== 'sword';
          const r = limb ? (/foot|feet|knee|leg|shin/i.test(this._part) ? STRIKE.foot : STRIKE.fist) : STRIKE.edge;
          const bite = limb ? STRIKE.fistBite : STRIKE.bite;
          // (the probe poses him at the impact: his drawn points are kept as they were, so the trails and
          // the next frame's strokes never see it)
          const sv = (this._reachSave ??= [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
          sv[0].copy(this._hilt);
          sv[1].copy(this._tip);
          sv[2].copy(this._hiltPrev);
          sv[3].copy(this._tipPrev);
          this._poseAt(b.clipT + (beat.impact - A.t));
          const h = this._hilt, t = this._tip, Q = (this._reachQ ??= new THREE.Vector3()), M = (this._reachM ??= new THREE.Vector3());
          const g = limb ? B.gap(t, t, r, Q) : B.gap(h, t, r, Q);
          // (the striker's point nearest the body: the gap is closed along the line from it to the body)
          if (limb) M.copy(t);
          else closestOnSegments(h, t, Q, Q, M, this._cp[3]);
          const gx = Q.x - M.x, gz = Q.z - M.z, gl = Math.hypot(Q.x - M.x, Q.y - M.y, Q.z - M.z);
          this._hilt.copy(sv[0]);
          this._tip.copy(sv[1]);
          this._hiltPrev.copy(sv[2]);
          this._tipPrev.copy(sv[3]);
          const need = g - bite;
          const most = K.max + (contactStep() ? STRIKE.step : 0);
          if (need > K.min && g < most + STRIKE.near && gl > 1e-3) {
            // (the horizontal part of the line that closes it, `need` of its length; at most `most` m)
            const k = need / gl, hl = Math.hypot(gx, gz) * k, c = hl > most ? most / hl : 1;
            R.tx = gx * k * c;
            R.tz = gz * k * c;
          } else R.tx = R.tz = 0;
          R.left = Math.max(beat.impact - A.t, 0);
          R.keep = K.after;
          found = true;
        }
      }
    }
    if (!found) {
      // past the impact: held while the blow is pinned on him and a moment after, then let go
      if (R.keep > 0 && (b.pin.pin || (R.keep -= dt) > 0) && this.mode === 'act') R.left = 0;
      else {
        R.keep = 0;
        R.tx = R.tz = 0;
      }
    }
    // (toward the target in the time left before the impact; back over K.back)
    const back = R.tx === 0 && R.tz === 0;
    const u = back ? Math.min(1, dt / K.back) : R.left > dt ? dt / R.left : 1;
    R.x += (R.tx - R.x) * u;
    R.z += (R.tz - R.z) * u;
    if (Math.abs(R.x) + Math.abs(R.z) < 1e-4 && back) R.x = R.z = 0;
    // (up to K.max with his feet planted; past it, `c`, his whole drawn body steps: R.sx / sz, the lean's offset)
    const rl = Math.hypot(R.x, R.z), pk = rl > K.max ? K.max / rl : 1;
    R.sx = R.x * (1 - pk);
    R.sz = R.z * (1 - pk);
    const px = R.x * pk, pz = R.z * pk;
    const S = this.drawScale || 1, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.hitReact.setReach((px * cy - pz * sy) / S, 0, (px * sy + pz * cy) / S);
  }

  /** CONTACT (combat/contact.js): his guard nudged onto the hero's blade where it was stopped (pilot.guardNudge,
   *  the animator's grip; eased off in _animate), and posed now. */
  _wardOnto(p) {
    const sw = p?.sweep, h = this._hilt, t = this._tip, C = this._cp;
    if (!sw?.valid || !this._tipOk) return;
    const N = (this.pilot.guardNudge ??= { x: 0, y: 0, z: 0, k: 0 }), K = STRIKE.guard;
    // (the hero's DRAWN steel: the sweep's first 0.93 m; his blade's nearest point to it)
    const k = (DIM.drawnTip - DIM.bladeBase) / (DIM.bladeTip + REACH.tipExt - DIM.bladeBase);
    const e = this._cpE ?? (this._cpE = new THREE.Vector3());
    e.lerpVectors(sw.a, sw.b, k);
    closestOnSegments(h, t, sw.a, e, C[0], C[1]);
    const gx = C[1].x - C[0].x, gy = C[1].y - C[0].y, gz = C[1].z - C[0].z, gl = Math.hypot(gx, gy, gz);
    if (!(gl > 0.04)) return;
    const f = Math.min(1, K.nudge / gl), S = this.drawScale || 1, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    N.x = ((gx * c - gz * sn) / S) * f;
    N.y = (gy / S) * f;
    N.z = ((gx * sn + gz * c) / S) * f;
    N.k = 1;
    this._poseAt(this.brain.clipT - this.brain.back.off);
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
    this.hitReact.restore(); // (the plain body: the blades' meeting is found on it; _animate re-applies)
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
    this._clash = null;
    this.broken = false;
    this._streakSet(0);
    this.flash = 0;
    this.dissolve = 0;
    this.warn = 0;
    this._shud.t = 0;
    this.lean.ox = this.lean.oz = 0;
    this.hitReact.reset();
    this.object3d.visible = true;
    this.fx.reset();
    // (the animator first: its reset goes back to the walking clip, and the brain's then starts the
    // clip he waits in: kneeling, enthroned. The other way round he stood in his guard until woken)
    this.anim.reset();
    this.brain.reset();
    this.hurtSpheres.length = 0;
    this.bodyCircles.length = 0;
    this.emitPosture(true);
    // (one short step, not zero: the waiting clip's cross-fade from the reset pose completes now)
    this._animate(0.02);
  }

  update(dt) {
    if (!(dt > 0)) return; // paused / a full freeze: keep the pose and the hitboxes
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this._updatePosture(dt);
    this.brain.update(dt);
    this._shudder();
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

  /**
   * The clash dance (combat/clashDance.js; ADR-247): the run this parry would make now (0: the dance is
   * off). The hero reads it as he parries (player.js _parry: player:parry's `clash`, the ring), before
   * onParried counts it.
   */
  clashPeek() {
    const p = this.game.player;
    return clashNext(this._clash, this.brain.act, fin(p?.time), p?.hurtN ?? 0);
  }

  /** A parry of his body or blade: count it in the run, the posture multiplier it earns (1: off). */
  _clashMult() {
    const n = this.clashPeek();
    if (n <= 0) return 1;
    const p = this.game.player;
    this._clash = { act: this.brain.act, n, t: fin(p?.time), hurt: p?.hurtN ?? 0 };
    return clashMult(n);
  }

  _updatePosture(dt) {
    this.postureTimer += dt;
    if (this.broken || this.posture <= 0) return;
    if (this.postureTimer > this.T.posture.regenDelay) {
      this.posture = Math.max(0, this.posture - this.T.posture.regenRate * clashRegenK(clamp(this.hp / Math.max(1, this.maxHp), 0, 1)) * dt);
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
    if (!this.broken) this._streakSet(this.streak + 1); // a strike turned: his streak counts one more
    const what = this.broken ? 'armor' : this.brain.onGuarded(heavy, this._wardFor(p));
    const deflect = what === 'deflect';
    if (what !== 'armor' && this.mode === 'react') this._animate(1 / 120);
    // (CONTACT, ?contact=a: the hero's swing is shown where his steel meets this guard, and the guard is
    // nudged onto it, before the crossing is read)
    if (what !== 'armor' && p?._cutContact?.(this, 0, 0, 0, heavy, true)) this._wardOnto(p);
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

  /**
   * The hero's cut is CAUGHT in his counter stance (a beat marked `stance`; brain.js): no damage, no
   * posture, the hero's blade thrown back (the bounce, as a deflect's), and the move jumps to its
   * punish (brain.onCaught). Drawn as a deflect on the crossing, called "CAUGHT" (dragon:guard).
   */
  _catch(b, heavy, point) {
    const G = this.T.guard, p = this.game.player;
    this.brain.onCaught(b);
    const h = this._hilt, t = this._tip;
    let x = (h.x + t.x) * 0.5, y = (h.y + t.y) * 0.5, z = (h.z + t.z) * 0.5;
    if ((!Number.isFinite(x + y + z) || !this._tipOk) && point) {
      x = point.x;
      y = point.y;
      z = point.z;
    }
    if (Number.isFinite(x + y + z)) this.fx.guard(x, y, z, { heavy, deflect: true });
    this.emit('dragon:guard', { heavy, deflect: true, caught: true });
    this.hitstop(G.deflectStop ?? 0.1, 0.03);
    this.game.shake?.(0.34);
    this.game.punch?.(2.4);
    this.jolt = Math.max(this.jolt, 0.2);
    try {
      p?.onGuarded?.({ deflect: true, heavy, attacker: this, caught: true });
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
        melee: !!o.beat && !o.crescent && !o.projectile, // (what the hero's riposte may answer)
        // a blow that reaches the hero from afar (a cast, a released blast, a bolt of lightning, a beam, a stream held lit): never answered
        // by the deathblow (ADR-294: projectiles are not part of the one blue rule)
        ranged: !!o.projectile || !!o.crescent || o.kind === 'lightning' || o.kind === 'beam' || !!(o.beat?.def && (o.beat.def.cast || o.beat.def.release || o.beat.def.selfHit || o.beat.def.sustain || o.beat.def.bolt)),
        around: !!o.beat?.def?.flit, // a blow of his flurry: a guard meets it from any side
        // (a parry moment ends the string: the hero's parry holds it as a last blow)
        last: o.beat ? !!o.beat.last || (!!o.beat.def?.flare && tell === TELL.BLUE) : true,
        flare: !!o.beat?.def?.flare || !!o.flare,
        // (a beat's own block: `blockPush` m of slide, `guardCost` points of the meter; absent: the
        // engine's DEFENSE.blockPushback / GUARD.cost, as before)
        ...(Number.isFinite(o.beat?.def?.blockPush) ? { blockPush: o.beat.def.blockPush } : null),
        ...(Number.isFinite(o.beat?.def?.guardCost) ? { guardCost: o.beat.def.guardCost } : null),
        ...(o.extra ?? null),
      });
    } catch (err) {
      console.error('[disciple] player.takeHit failed', err);
      return RESULT.IGNORED;
    }
    if (r === RESULT.CLASHED) this.onClashed({ tell, beat: o.beat ?? null });
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
    this.hitReact.restore(); // (last frame's drawn reaction off the joints: the animator poses the body)
    if (this._reach || contactReach()) this._reachStep(dt); // (CONTACT `b`: his body eased into a blow that would fall short)
    this.jolt = Math.max(0, this.jolt - dt * this.T.hitStun.joltDecay);
    if (pl.guardNudge?.k > 0) pl.guardNudge.k = Math.max(0, pl.guardNudge.k - dt / STRIKE.guard.nudgeBack); // (CONTACT: _wardOnto)
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
    // (CONTACT `c`: the reach's step, drawn only, on top of the shudder's offset)
    if (this._reach && (this._reach.sx || this._reach.sz)) {
      this.lean.ox += fin(this._reach.sx, 0);
      this.lean.oz += fin(this._reach.sz, 0);
    }
    // the animator poses the plain upright body (as the hero's): gameplay points come from it
    this.lean.on = false;
    // the sword motion pass (ADR-226; kit.motion: the boss's numbers while its switch is on, else null):
    // the forearm turned toward the steel, the arms opening at the end of a blow
    if (this.kit.motion) {
      const M = this.kit.motion();
      this.anim.gripMax = M?.gripMax ?? 0;
      this.anim.armSoft = M?.armSoft ?? undefined;
    }
    this.anim.update(dt);
    this._gameplayPoints();
    // CONTACT (brain.pinAt): his blow drawn where it met the hero, a moment behind (or ahead of) its clip;
    // his gameplay points above stay on the clip's own time
    if (b.pin.pin && b.pin.show !== 0) {
      pl.stateT = pl.animT = Math.max(0, b.clipT - b.back.off - b.pin.show);
      this.anim.update(0);
    }
    // the body answering a hit (react.js): over the upright pose, after every gameplay point
    this.hitReact.apply(dt);
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    this._drawnPoints();
  }

  /** The shudder this frame (real time: it runs through the freeze): the drawn offset flips side every
   *  frame and fades out; 0 when it has run out. Gameplay points never see it (lean.on is off then). */
  _shudder() {
    const S = this._shud, L = this.lean;
    if (S.t > 0) {
      if (S.fresh) S.fresh = false;
      else S.t -= fin(this.game.realDt, 1 / 60);
      S.s = -S.s;
      const k = S.t > 0 ? S.t / S.t0 : 0, a = S.amp * S.s * k;
      L.ox = fin(S.x * a, 0);
      L.oz = fin(S.z * a, 0);
    } else L.ox = L.oz = 0;
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

  /** Upright gameplay point → where it is drawn (the lean, drawScale, the lean's drawn-only offset):
   *  Player.leanPoint's twin. The hero's cut is drawn where his drawn blade meets this drawn body. */
  drawnPoint(v) {
    const L = this.lean, p = this.position, k = L?.k || 0, S = this.drawScale;
    const x = (v.x - p.x) * S, y = (v.y - p.y) * S, z = (v.z - p.z) * S;
    return v.set(p.x + x + k * (L?.dx || 0) * y + (L?.ox || 0), p.y + y, p.z + z + k * (L?.dz || 0) * y + (L?.oz || 0));
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
    // (the blackout, ?black=: a black blow no longer darkens his body; combat/blackout.js)
    const w = clamp(this.warn, 0, 2) * (this.warnTell === TELL.BLACK ? blackBody() : 1);
    for (const m of mats) {
      const u = m.uniforms;
      if (!u) continue;
      u.uFlash.value = this.flash * 0.8;
      u.uDissolve.value = this.dissolve;
      const wc = this.warnTell === TELL.BLACK ? WARN_BLACK : WARN_RED;
      u.uWarn.value.set(wc[0], wc[1], wc[2], w);
    }
    this._bladeMaterials(dt, M);
    // (the body's dressing by phase / form, ?ashLook= / ?lordLook= b or c: a few flags, cheap)
    this.kit.dress?.(this, dt);
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

  // ---------------------------------------------------------------- his streak and his flurry
  _streakSet(n) {
    n = clamp(Math.round(fin(n, 0)), 0, 99);
    if (n === this.streak) return n;
    this.streak = n;
    this.emit('dragon:streak', { count: n, ready: n >= DEFENSE.foeStreak.min });
    return n;
  }

  /**
   * A blow of his flurry was answered (brain._act; `a.streak` = { need, got, failed }): a parry or
   * a block takes one off his streak and counts toward the total (a perfect parry counts two); a
   * blow that lands, or one dodged, fails it. All of them answered: his posture breaks.
   * A blow that reached nobody (`r` null): `near` = the hero stood within its reach + 1.2 m (it fell
   * short of a hero who held his ground: it counts as answered); else he left: the flurry fails.
   */
  onStreakBlow(a, b, r, near = false) {
    const S = a.streak;
    if (!S) return;
    if (r === RESULT.PARRIED || r === RESULT.BLOCKED || (r === null && near)) {
      S.got += r === RESULT.PARRIED && this.game.player?.deflect?.perfect ? 2 : 1;
      this._streakSet(this.streak - 1);
      if (!S.failed && S.got >= S.need) {
        this._streakSet(0);
        this.emit('dragon:flurryEnd', { count: S.need, answered: true });
        S.failed = true; // (once)
        this._break();
      }
      return;
    }
    if (!S.failed) this.emit('dragon:flurryEnd', { count: S.need, answered: false });
    S.failed = true;
  }

  /** Whether he may stand at (x, z): inside his bound and clear of the world's colliders (a boss
   *  whose floor is not just that circle adds to it). */
  standable(x, z) {
    if (!Number.isFinite(x + z) || Math.hypot(x, z) > this.bound) return false;
    _spot.x = x;
    _spot.z = z;
    this.game.world?.resolve?.(_spot, this.T.radius, Infinity);
    return Math.hypot(_spot.x - x, _spot.z - z) < 0.2;
  }

  /**
   * A flurry's later blow: he is gone from where he stood and at another side of the hero, `K.r` m
   * off, facing him (`s`: the brain's sense of the hero; `i`: the blow's index, which side he
   * turns to).
   */
  flit(s, K, i = 0) {
    const p = s.p, x0 = this.position.x, z0 = this.position.z;
    if (!p || !Number.isFinite(p.x + p.z)) return;
    const a0 = Math.atan2(x0 - p.x, z0 - p.z);
    const turn = (i % 2 ? -1 : 1) * (1.6 + 1.0 * Math.random());
    const r = fin(K?.r, 2.3);
    // the side he turns to, or the nearest one he may stand on: a hero at the edge of his floor or
    // beside a stone has sides he cannot take, and a blow from a spot he was pushed off whiffs
    let a = a0 + turn;
    for (const da of [turn, -turn, turn * 0.5, -turn * 0.5, Math.PI, 0]) {
      if (!this.standable(p.x + Math.sin(a0 + da) * r, p.z + Math.cos(a0 + da) * r)) continue;
      a = a0 + da;
      break;
    }
    this.position.x = p.x + Math.sin(a) * r;
    this.position.z = p.z + Math.cos(a) * r;
    this.position.y = 0;
    this.moveBy(0, 0);
    this.yaw = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    this.object3d.rotation.y = this.yaw;
    this.anim.teleported?.();
    this.fx.flit(x0, z0, this.position.x, this.position.z);
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
