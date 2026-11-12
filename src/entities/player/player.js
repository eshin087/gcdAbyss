import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { clamp, damp, dampAngle, turnToward, wrapAngle, smoothstep } from '../../core/math.js';
import { markCaster } from '../../render/pipeline.js';
import { batchRigid } from '../../render/rigidBatch.js';
import { TELL, RESULT, DEFENSE, tellDefaults, facingDelta } from '../../combat/rules.js';
import { buildHero, setHeroGlyphScale, installLean, LEAN, HERO_SCALE, BLADE_BASE } from './model.js';
import { HeroAnimator, ROLL_SLIDE } from './anim.js';
import { LIGHT, SPRINT_ATK, ROLL_ATK, THRUST, CHARGE, REACH, thrustStats, bandHit, SwordSweep } from './combat.js';
import { PlayerFx } from './fx.js';
import { QI, SLOT_COUNT, SLOT_KEYS, qiForParry } from './techniques/index.js';
import { TechniqueBook } from './techniques/book.js';
import { TECH_POSES } from './techniques/poses.js';

// The Wanderer. Owns input → state machine → movement/collision → animation → sword hits → FX.
// Contract: docs/ARCHITECTURE.md (Player). Combat rules: docs/COMBAT.md + src/combat/rules.js.
// No stamina (v0.2): pacing comes from attack recovery, roll recovery and the enemy's patterns.
// Moveset (combat.js, ADR-041): LMB chain falling cut → rising backhand → whirl → stab → two-handed
// slam (finisher, ground shards); LMB out of a sprint = the sprint slash, out of a forward roll = the
// roll cut; hold LMB = crouched charge, release = lunging thrust. Swings hit giant targets through
// a vertical reach band and step in toward a hurt surface ahead (REACH).
// Techniques (ADR-054, techniques/): Q / R fire slot 1 / 2, paid from the Qi meter (`qi`) that
// parries, perfect dodges and landed strikes fill; the Ash Riposte is a counter stance (state
// 'technique') whose turned blow is answered with a piercing thrust (state 'heavy', atk.tech).

export const TUNE = {
  runSpeed: 4.6,
  sprintSpeed: 7.2, // unlimited
  healSpeed: 1.4,
  accel: 14, // damp lambda toward a faster target velocity
  decel: 18, // ... toward a slower one
  turnRate: 16,
  maxHp: 160,
  maxFlasks: 5,
  roll: { dur: 0.6, dist: 4.2, iframes: [0.04, 0.4], attackAfter: 0.42, rollAfter: 0.5, moveAfter: 0.52, landAt: 0.48 },
  backstep: { dur: 0.4, dist: 1.6, iframes: [0.03, 0.22], attackAfter: 0.28, rollAfter: 0.32, moveAfter: 0.34, landAt: 0.3 },
  heal: { dur: 0.85, at: 0.5, amount: 70 },
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
  // --- v0.2 defence (the windows themselves live in combat/rules.js DEFENSE)
  blockTurn: 12, // rad/s-ish damp toward the aim while blocking
  blockStun: 0.25, // s guard-stagger after blocking a blue tell
  chipPush: 0.15, // fraction of block pushback applied per stream tick (fire breath)
  blockEventGap: 0.4, // s: blocked stream ticks are reported at most this often (summed damage)
  parryDur: 0.3, // s of the deflect flick
  parryCancel: 0.12, // s into the parry after which an attack / roll may cancel it (riposte)
  // the deflect chain (parries in rhythm against a multi-hit string): parries at most this far
  // apart count up (sparks, the clang's pitch, the snap side); each one slides the hero back a little
  deflectChainGap: 1.1,
  deflectPush: 0.16, // m
  guardLinger: [0.32, 0.6], // s after a parry: the guard stays up between taps, then eases down
  guardBreakDur: 0.45, // s stumble before the knockdown
  ghostepDur: 0.32, // s of the Ghostep reappear pose
  ghostepCancel: 0.08, // s into the Ghostep after which attack / roll / block may cancel it
  ghostepIframes: 0.3,
  ghostepMaxRange: 12, // attacker farther than this: slow-mo + crit without the teleport
  ghostepAssist: 1.2, // s of aim assist toward the attacker after a Ghostep (no lock-on)
  ghostepFade: 3.2, // 1/s fade of the reappear dissolve / cold tint
  plungeFade: 7, // 1/s: the plunge's reappear above the head resolves faster (it hangs only briefly)
  rollCoatKick: 0.7, // the coat tails fly out as the dodge starts
  gemGlintEvery: 1.8, // s between idle glints of the violet gem (± 40 %)
};

const CONTROL = new Set(['explore', 'bossIntro', 'boss']);
const LOCO = new Set(['idle', 'run', 'sprint']);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
// plunge phases (DEFENSE.plunge; the animator reads player.plungeAnim)
export const PL = Object.freeze({ VANISH: 0, HANG: 1, DIVE: 2, RIDE: 3, FLIP: 4, LAND: 5 });
// the landing search turns the spring-off direction by these (rad) when the body is in the way
const LAND_TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4, Math.PI];
const PLUNGE_BEHIND_TURN = 1.0; // rad off the nose: a hero who came from behind lands front-side
const PLUNGE_RIDE_MAX = 40; // m/s: the rider eases through a jump of the head (never teleports)
const PLUNGE_HANG_TRACK = 7; // m/s: the hang point drifts after a moving head at most this fast
// cross-fade (s) into each plunge phase's pose: the impact lands almost at once
const PL_BLEND = [0.02, 0.03, 0.05, 0.025, 0.06, 0.05];

export class Player {
  constructor(game) {
    this.game = game;
    this.name = 'Wanderer';
    this.rig = buildHero(game.U);
    this.object3d = this.rig.root;
    this.position = this.object3d.position;
    this.radius = 0.45;
    this.yaw = Math.PI;

    this.maxHp = TUNE.maxHp;
    this.hp = this.maxHp;
    this.maxFlasks = TUNE.maxFlasks;
    this.flasks = this.maxFlasks;
    this.state = 'idle';
    this.stateT = 0;
    this.lockOn = false;
    this.critTimer = 0;

    this.time = 0;
    this.control = false;
    this.intent = { x: 0, z: 0, len: 0, sprint: false };
    this.buf = { action: null, t: 0 };
    this.lmb = { held: false, t: 0 }; // hold time of the current LMB press (game time)
    this.rmb = { held: false, upT: -Infinity, parryT: -Infinity, edge: false, chain: false };
    this.vel = { x: 0, z: 0 }; // own movement
    this.want = { x: 0, z: 0 }; // desired movement this frame
    this.kb = { x: 0, z: 0 }; // knockback slide
    this.groundVel = { x: 0, z: 0 }; // actual displacement / dt (drives the gait)
    this.atk = null; // { def, t, hit, prevT, pending, damage, poise, charge, gust, lunge, travel, impact }
    this.gemT = 0.6; // s to the next idle gem glint
    this.chargeK = 0; // 0..1 while charging (anim + glow)
    this.chargeFull = false;
    this.releaseK = 0; // charge of the thrust in flight (blade glow, thrust pose)
    this.recoil = 0; // block impact 0..1 (anim)
    this.blockStunT = 0;
    this.blockEvt = { t: -Infinity, attack: null, stream: false, acc: 0 };
    this.iframeT = 0; // Ghostep i-frames
    this.slowmoPending = 0; // Ghostep slow-mo waiting for a harsher freeze to end (s)
    this.assist = { target: null, t: 0 };
    this.ghostFx = 0; // 1 → 0 after a Ghostep: dissolve-in + cold tint
    this.rollBack = false;
    this.rollDir = { x: 0, z: -1 };
    this.healApplied = false;
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
    this.dodgeKey = '';
    this.chipGuard = 0;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._lock = new THREE.Vector3();
    this._hit = { sphere: null, x: 0, y: 0, z: 0 };
    this._tip = new THREE.Vector3();
    this._tipPrev = new THREE.Vector3();
    this._gem = new THREE.Vector3();
    this._gemPrev = new THREE.Vector3();
    this.gemVel = { x: 0, y: 0, z: 0 }; // the hilt's own velocity: glints ride with the gem
    this.glyphScale = 1; // hero glyph-cell scale from the view distance (model.js setHeroGlyphScale)
    this.viewDist = 36; // camera → hero distance (m), sampled each frame
    this.bladeFar = 1; // 0 close-up … 1 game camera: how much the blade self-lights
    this._ghostSegs = new Float32Array(16 * 6);
    // the plunge (state 'plunge', DEFENSE.plunge): the attacker, the phase clock, the head point
    // this frame, the spring-off direction (dx, dz: from the head toward the landing side), the
    // ride offset, the flip's start and landing. position.y carries the visual lift while it runs.
    this.pl = {
      att: null, exec: false, phase: PL.VANISH, t: 0, hit: false, dealt: 0, ox: 0, oz: 0, dx: 0, dz: 1,
      pt: new THREE.Vector3(), off: new THREE.Vector3(), from: new THREE.Vector3(), land: new THREE.Vector3(),
      hitPt: { x: 0, y: 0, z: 0 }, flipDur: 0.5, fxT: 0, streak: false,
    };
    this.plungeAnim = { phase: PL.VANISH, u: 0, t: 0, exec: false, h: 0 }; // read by anim.js
    this.deflect = { n: 0, t: -Infinity, side: 1 }; // the parry chain (TUNE.deflectChainGap)
    this.guardHold = 0; // 0..1: the guard lingers between parries (anim.js)
    // techniques (techniques/): the book (learned + slots, saved), the Qi meter, the running one
    this.techniques = new TechniqueBook(game);
    this.qiMax = QI.max;
    this.qi = 0;
    this.tech = null; // { def, slot } while the stance (state 'technique') runs

    // Lab hooks (ARCHITECTURE.md: debug = { god, infiniteFlasks, heal(), teleport(x, z) })
    this.debug = {
      god: false,
      infiniteFlasks: false,
      infiniteQi: false, // techniques cost nothing
      heal: () => this._debugHeal(),
      teleport: (x, z) => this._teleport(x, z),
      kill: () => this._debugKill(), // used by flow.debug.toState('dead') when present
      // Lab / captures: start the plunge on the dragon now (any range; also in the air)
      plunge: (execution = false) => this._debugPlunge(execution),
      qiFull: () => this.gainQi(this.qiMax),
    };

    this.anim = new HeroAnimator(this.rig, this, TECH_POSES);
    this.anim.onFootstep = (side, dust) => this._footstep(side, dust);
    this.fx = new PlayerFx(game, this.rig);
    // camera lean (model.js LEAN): visual only; hits and the dragon's aim use unleaned positions
    this.lean = installLean(this.object3d);
    this.sweep = new SwordSweep(this.rig.sword, (v) => this.unlean(v));

    markCaster(this.object3d);
    // one draw call per material instead of one per mesh (render/rigidBatch.js)
    this.batch = batchRigid(game.U, this.object3d);
    game.scene.add(this.object3d);
    const s = CONFIG.world.playerSpawn;
    this.respawn(s.x, s.z);
  }

  // ------------------------------------------------------------------ contract
  get alive() {
    return this.state !== 'dead' && this.hp > 0;
  }

  /** RMB held and able to block (a blue-tell guard-stagger keeps the guard up). */
  get blocking() {
    return this.state === 'block' || (this.state === 'parry' && this.rmb.held);
  }

  /** Clip time for the animator: attacks run on their own clock (a held light pauses at the coil). */
  get animT() {
    return this.atk && (this.state === 'attack' || this.state === 'heavy') ? this.atk.t : this.stateT;
  }

  /** True while the blade is cutting (a light / heavy swing's active frames): bullets.js cuts bullets on it. */
  isSwinging() {
    const a = this.atk;
    if (!a || a.pending || !a.def || (this.state !== 'attack' && this.state !== 'heavy')) return false;
    return a.t >= a.def.windup && a.t <= a.def.windup + a.def.active + 0.04;
  }

  isInvulnerable() {
    if (!this.alive) return true;
    if (this.state === 'plunge') return true; // the whole plunge (takeHit ignores hits in it)
    if (this.iframeT > 0) return true; // Ghostep / the plunge's landing
    if (this.state === 'roll') {
      const R = this.rollBack ? TUNE.backstep : TUNE.roll;
      return this.stateT >= R.iframes[0] && this.stateT <= R.iframes[1];
    }
    if (this.state === 'knockdown') return this.stateT >= TUNE.knockdownDur - TUNE.getUpIframes;
    return false;
  }

  /**
   * Resolve an incoming hit (docs/COMBAT.md), in order: ignored → perfect dodge (the plunge, or
   * the Ghostep) → i-frames → parry → block / guard break → hit. Returns a RESULT value.
   * `hit.plunge === false` (hazards) keeps a perfect dodge from turning into the plunge.
   */
  takeHit(hit = {}) {
    hit = hit && typeof hit === 'object' ? hit : {};
    if (!this.alive) return RESULT.IGNORED;
    const g = this.game;
    if (g.state === 'victory' || g.state === 'title') return RESULT.IGNORED;
    if (this.state === 'plunge') return RESULT.IGNORED; // in the air / on the head: out of reach
    const kind = typeof hit.kind === 'string' ? hit.kind : 'hit';
    const tell = hit.tell === TELL.BLUE || hit.tell === TELL.RED ? hit.tell : TELL.NORMAL;
    const def = tellDefaults(tell);
    const parryable = typeof hit.parryable === 'boolean' ? hit.parryable : def.parryable;
    const blockable = typeof hit.blockable === 'boolean' ? hit.blockable : def.blockable;
    const attack = hit.attack ?? null;
    const attacker = hit.attacker && typeof hit.attacker === 'object' ? hit.attacker : null;

    // (b) perfect dodge: the roll started within the window before this impact → the plunge (or the
    // Ghostep). A stream (breath) ticks every 0.15 s, so it only counts when dodging INTO it, not
    // rolling out of it.
    const streamTick = !(fin(hit.knockback, 0) > 0) && !hit.knockdown;
    if (hit.perfect !== false && this.state === 'roll' && this.stateT <= DEFENSE.perfectDodgeWindow && !(streamTick && this.chipGuard > 0)) {
      this._perfectDodge(attacker, attack, tell, hit.plunge !== false);
      return RESULT.PERFECT;
    }
    // (c) i-frames: one event per roll / get-up per attack (a breath stream ticks many times)
    if (this.isInvulnerable()) {
      const key = `${kind}|${typeof attack === 'string' ? attack : ''}`;
      if (this.dodgeN !== this.enterN || this.dodgeKey !== key) {
        this.dodgeN = this.enterN;
        this.dodgeKey = key;
        this._emit('player:dodge', { kind });
      }
      return RESULT.DODGED;
    }

    const dmg = Math.max(0, fin(hit.damage, 0));
    const kb = clamp(fin(hit.knockback, 0), 0, 14);
    const burn = clamp(fin(hit.burn, 0), 0, 15);
    const knockdown = !!hit.knockdown;
    const chip = kb <= 0 && !knockdown; // contact damage streams (breath)

    // push direction: away from the source (fallback: backwards)
    const p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw);
    const fx = fin(hit.from?.x, NaN), fz = fin(hit.from?.z, NaN);
    const hasFrom = Number.isFinite(fx) && Number.isFinite(fz);
    const ap = attacker?.position;
    const hasAtk = !!ap && Number.isFinite(ap.x) && Number.isFinite(ap.z);
    const sx = hasFrom ? fx : hasAtk ? ap.x : NaN, sz = hasFrom ? fz : hasAtk ? ap.z : NaN;
    const hasSrc = Number.isFinite(sx) && Number.isFinite(sz);
    if (hasSrc) {
      const dx = p.x - sx, dz = p.z - sz;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        nx = dx / l;
        nz = dz / l;
      }
    }

    // (d0) a technique's counter stance (the Ash Riposte): a parryable blow from its front cone is
    // turned aside (the attacker is parried) and answered at once; red blows fall through to (g)
    if (this.state === 'technique' && this.tech && parryable) {
      const r = this._techIncoming(tell, attack, attacker, !!hit.light, hasFrom, fx, fz, hasAtk ? ap : null, sx, sz);
      if (r) return r;
    }
    // (d) parry: RMB pressed shortly before impact, attacker in the front arc
    if (
      parryable &&
      this._canGuard() &&
      this.time - this.rmb.parryT <= DEFENSE.parryWindow &&
      this._inArc(DEFENSE.parryArc, hasFrom, fx, fz, hasAtk ? ap : null)
    ) {
      this._parry(tell, attack, hasSrc ? sx : NaN, hasSrc ? sz : NaN, !!hit.light);
      return RESULT.PARRIED;
    }
    // (e) block / (f) guard break
    if (this.blocking && this._inArc(DEFENSE.blockArc, hasFrom, fx, fz, hasAtk ? ap : null)) {
      if (blockable) {
        this._block(dmg, tell, attack, chip, nx, nz);
        return RESULT.BLOCKED;
      }
      this._guardBreak(dmg, kind, burn, kb, attack, nx, nz, hasSrc);
      return RESULT.HIT;
    }

    // (g) plain hit
    const guarded = chip && this.chipGuard > 0;
    if (chip) this.chipGuard = TUNE.chipGuard;
    this._damage(dmg);
    if (burn > 0) this.burnT = Math.max(this.burnT, burn);
    this.flash = 1;
    const big = knockdown || dmg >= 25;
    this.getChestPos(this._v, true);
    this.fx.hurt(this._v.x, this._v.y, this._v.z, nx, nz, big);
    this._emit('player:hurt', { damage: dmg, kind, hp: this.hp });

    if (this.hp <= 0) {
      this._setKb(nx, nz, kb);
      this._die();
      g.shake?.(0.5);
      this._hitstop(0.12);
      return RESULT.HIT;
    }
    g.shake?.(guarded ? 0.06 : clamp(0.25 + dmg * 0.006, 0.25, 0.5));
    if (big) this._hitstop(0.08);

    if (knockdown) {
      if (this.state !== 'knockdown') {
        this._interrupt();
        if (hasSrc) this.yaw = Math.atan2(-nx, -nz); // face the attacker, fall away from it
        this._setKb(nx, nz, Math.max(kb, 1.2));
        this._enter('knockdown', 'knockdown', 0.06);
      }
    } else if (kb > 0 || (dmg >= TUNE.minStaggerDamage && !guarded)) {
      if (this.state !== 'knockdown' && this.state !== 'guardBreak') {
        this._interrupt();
        this._setKb(nx, nz, Math.max(kb, TUNE.defaultPush));
        this._enter('stagger', 'stagger', 0.05);
      }
    }
    return RESULT.HIT;
  }

  /** Chest point, world space. Unleaned (where the body really is) unless `visual` (FX anchors). */
  getChestPos(out, visual = false) {
    out = out || new THREE.Vector3();
    this.rig.chest.getWorldPosition(out);
    if (!visual) this.unlean(out);
    out.y += 0.1;
    if (!Number.isFinite(out.x + out.y + out.z)) out.set(this.position.x, 1.3, this.position.z);
    return out;
  }

  /** Lean away from the camera: LEAN.frac × its pitch below the horizon (model.js LEAN). */
  _updateLean() {
    const L = this.lean, cam = this.game.camera;
    if (!L) return;
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

  /** World point on the drawn body (leaned, HERO_SCALE) → the same point on the upright 1.85 m
   *  gameplay body. */
  unlean(v) {
    const L = this.lean, p = this.position;
    const k = L?.k || 0;
    let x = v.x - p.x, y = v.y - p.y, z = v.z - p.z;
    x -= k * L.dx * y;
    z -= k * L.dz * y;
    v.set(p.x + x / HERO_SCALE, p.y + y / HERO_SCALE, p.z + z / HERO_SCALE);
    return v;
  }

  /** Point on the upright gameplay body → where it is drawn (leaned, HERO_SCALE): the name tag. */
  leanPoint(v) {
    const L = this.lean, p = this.position;
    const k = L?.k || 0;
    const x = (v.x - p.x) * HERO_SCALE, y = (v.y - p.y) * HERO_SCALE, z = (v.z - p.z) * HERO_SCALE;
    v.set(p.x + x + k * (L?.dx || 0) * y, p.y + y, p.z + z + k * (L?.dz || 0) * y);
    return v;
  }

  respawn(x, z) {
    const s = CONFIG.world.playerSpawn;
    this.position.set(fin(x, s.x), 0, fin(z, s.z));
    this.yaw = Math.PI;
    this.object3d.rotation.y = this.yaw;
    this.hp = this.maxHp;
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
    this.buf.action = null;
    this.lmb.held = false;
    this.lmb.t = 0;
    this.rmb.held = false;
    this.rmb.edge = false;
    this.rmb.upT = -Infinity;
    this.rmb.parryT = -Infinity;
    this.rmb.chain = false; // a deflect's instant re-arm doesn't survive a respawn / reset
    this.chargeK = 0;
    this.chargeFull = false;
    this.releaseK = 0;
    this.recoil = 0;
    this.blockStunT = 0;
    this.blockEvt.t = -Infinity;
    this.blockEvt.attack = null;
    this.blockEvt.stream = false;
    this.blockEvt.acc = 0;
    this.critTimer = 0;
    this.iframeT = 0;
    this.slowmoPending = 0;
    this.assist.target = null;
    this.assist.t = 0;
    this.ghostFx = 0;
    this.pl.att = null;
    this.pl.phase = PL.VANISH;
    this.deflect.n = 0;
    this.deflect.t = -Infinity;
    this.guardHold = 0;
    this.qi = 0; // the Qi meter starts empty on every (re)spawn: death and retries empty it
    this.tech = null;
    this.flash = 0;
    this.burnGlow = 0;
    this.chipGuard = 0;
    this.dodgeN = -1;
    this.diedEmitted = false;
    this._clearBurn();
    if (this.healLight) {
      this.healLight.kill?.();
      this.healLight = null;
    }
    this._setLock(false);
    this.anim.reset();
    this.fx.reset();
    this.sweep.valid = false;
    this._updateMaterials(0);
    this.game.world?.setPusher?.(0, this.position.x, 0, this.position.z, TUNE.pusher);
  }

  /** The equipped gear: slot → item id or null (gear/index.js SLOTS). */
  get loadout() {
    return this.rig.loadout;
  }

  /** Put item `id` (or null: take it off) in `slot`. See setLoadout. */
  equip(slot, id) {
    return this.setLoadout({ ...this.rig.loadout, [slot]: id ?? null });
  }

  /**
   * Wear `loadout` (slot → gear item id or null; gear/README.md): the outfit and the weapon are
   * rebuilt from their items and swapped in under the same root, so `object3d` / `position` stay
   * the objects everything else holds. The animator is rebuilt with the new cloth (its pose restarts
   * from the ready stance: equip out of combat). Throws on an unknown item id or an item in the
   * wrong slot, before anything is changed. Build-time cost (allocates): never call it per frame.
   */
  setLoadout(loadout) {
    const rig = buildHero(this.game.U, loadout);
    const root = this.object3d, old = this.rig;
    this.batch?.dispose(); // the old rig's rigid batches (their bone slots are reused below)
    for (const c of [...root.children]) root.remove(c);
    for (const c of [...rig.root.children]) root.add(c);
    rig.root = root;
    old.body?.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose();
    });
    for (const m of old.mats) m.dispose();
    this.rig = rig;
    const onFootstep = this.anim.onFootstep;
    this.anim = new HeroAnimator(rig, this, TECH_POSES);
    this.anim.onFootstep = onFootstep;
    this.fx.rig = rig;
    this.sweep.sword = rig.sword;
    this.sweep.valid = false;
    markCaster(root);
    this.batch = batchRigid(this.game.U, root);
    this._updateMaterials(0);
    root.updateMatrixWorld(true);
    return rig.loadout;
  }

  restAtBonfire() {
    if (!this.alive) return;
    this.hp = this.maxHp;
    this.flasks = this.maxFlasks;
    this.buf.action = null;
    this.critTimer = 0;
    this._clearBurn();
    this._setLock(false);
  }

  update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const g = this.game;
    this.time += dt;
    const control = this.alive && CONTROL.has(g.state);
    // skip input on the first controllable frame (the click that dismissed a menu)
    this._readInput(control && this.control, dt);
    this.control = control;
    if (this.buf.action && this.time - this.buf.t > TUNE.buffer) this.buf.action = null;
    if (this.chipGuard > 0) this.chipGuard -= dt;
    if (this.critTimer > 0) this.critTimer = Math.max(0, this.critTimer - dt);
    if (this.iframeT > 0) this.iframeT = Math.max(0, this.iframeT - dt);
    if (this.assist.t > 0) this.assist.t -= dt;
    if (this.slowmoPending > 0 && !(fin(g.hitstopTimer) > 0)) this._slowmo(this.slowmoPending);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    // between parries in rhythm the guard stays up (anim.js holds the block's arms and blade)
    const GL = TUNE.guardLinger, since = this.time - this.deflect.t;
    this.guardHold = this.alive ? 1 - smoothstep(GL[0], GL[1], since) : 0;
    this._updateLock();

    this.stateT += dt;
    if (this.hp <= 0 && this.state !== 'dead') this._die(); // hp zeroed from outside: never stuck half-dead
    // RMB press: raise the guard from anything that can guard (cancels windups, recoveries, a charge
    // or a held light). Pressed mid-swing / mid-roll, the request waits while RMB stays held, so the
    // guard comes up the moment it can instead of only at the end of the recovery.
    const Rb = this.rmb;
    if (Rb.edge && this.state !== 'block' && this.state !== 'parry' && this._canGuard()) {
      // the guard spends the held LMB press, otherwise _tickBlock would re-enter the charge at once
      if (this.state === 'charge' || this.atk?.pending) this.lmb.held = false;
      this._startBlock();
    }
    if (!Rb.held || this.state === 'block' || this.state === 'parry') Rb.edge = false;
    this._tick(dt);
    this._integrate(dt);
    this._updateBurn(dt);

    this.yaw = wrapAngle(fin(this.yaw, Math.PI));
    this.object3d.rotation.y = this.yaw;
    this._updateLean();
    // the animator poses the plain upright body; the drawn one (lean, HERO_SCALE) is applied after
    this.lean.on = false;
    this.anim.update(dt);
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    this._combat();
    this._updateFx(dt);
    this._updateMaterials(dt);

    const st = this.state;
    const r = st === 'roll' ? TUNE.pusherRoll : st === 'knockdown' || st === 'dead' || st === 'guardBreak' ? TUNE.pusherDown : TUNE.pusher;
    // (in the air the pusher's height lifts it off the grass: world.setPusher ignores y > 1.5)
    g.world?.setPusher?.(0, this.position.x, st === 'plunge' ? fin(this.position.y) : 0, this.position.z, r);
    if (st === 'plunge') this._plungeCamera();
  }

  /** Ask the camera to keep the hero and the head on screen through the plunge (core/cameraRig). */
  _plungeCamera() {
    const rig = this.game.cameraRig, pl = this.pl, p = this.position;
    if (typeof rig?.keep !== 'function') return;
    rig.keep(p.x, p.y + 1.1, p.z, 1.7, true);
    rig.keep(pl.pt.x, pl.pt.y - 0.9, pl.pt.z, 2.2, true);
    if (pl.phase === PL.FLIP) rig.keep(pl.land.x, 0.9, pl.land.z, 1.4, true);
  }

  // ------------------------------------------------------------------ input + lock-on
  _readInput(control, dt) {
    const I = this.intent, inp = this.game.input, L = this.lmb, Rb = this.rmb;
    if (!control || !inp) {
      I.x = I.z = I.len = 0;
      I.sprint = false;
      L.held = false;
      Rb.held = false;
      Rb.edge = false;
      return;
    }
    const m = inp.moveAxis();
    I.x = fin(m?.x);
    I.z = -fin(m?.y); // W = north = −Z
    I.len = Math.hypot(I.x, I.z);
    I.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    if (inp.pressed('Space')) this._buffer('roll');
    if (inp.pressed('KeyF')) this._buffer('heal');
    for (let i = 0; i < SLOT_COUNT; i++) if (inp.pressed(SLOT_KEYS[i])) this._buffer(`tech${i}`);
    if (inp.pressed('Tab') || inp.mousePressed(1)) this._toggleLock();

    // LMB: a press starts a light attack at once; holding past CHARGE.hold turns it into a charge
    if (inp.mousePressed(0)) {
      L.held = true;
      L.t = 0;
      this._buffer('light');
    } else if (L.held) {
      L.t += dt;
    }
    if (L.held && (!inp.mouseDown(0) || L.t >= CHARGE.maxHold)) L.held = false; // released (or auto-release)

    // RMB: hold = block; a press counts as a parry attempt only after a full re-arm (anti-mash). A
    // successful deflect re-arms at once (Rb.chain): the next press counts as soon as RMB was released,
    // so a string can be deflected hit after hit even with the guard held between blows; whiffed
    // presses keep the re-arm, so mashing still fails.
    if (inp.mousePressed(2)) {
      if (Rb.chain || this.time - Rb.upT >= DEFENSE.parryRearm) Rb.parryT = this.time;
      Rb.chain = false;
      Rb.held = true;
      Rb.edge = true;
    }
    if (Rb.held && !inp.mouseDown(2)) {
      Rb.held = false;
      Rb.upT = this.time;
    } else if (!Rb.held && inp.mouseDown(2)) {
      Rb.held = true; // held through a pause / menu / respawn: guard again, but no parry attempt
    }
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

  /** Yaw toward the lock target, else the Ghostep target for a moment, else the mouse. */
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
    if (this.assist.t > 0) {
      const tg = this.assist.target;
      const tp = typeof tg?.lockPoint === 'function' ? tg.lockPoint(this._lock) : tg?.position;
      if (tp) {
        const dx = tp.x - p.x, dz = tp.z - p.z;
        if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 1e-4 && dx * dx + dz * dz < 144) return Math.atan2(dx, dz);
      }
    }
    const mg = this.game.mouseGround;
    if (mg) {
      const dx = mg.x - p.x, dz = mg.z - p.z;
      if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 0.09) return Math.atan2(dx, dz);
    }
    return fallback;
  }

  /** Can a guard (block / parry) be raised right now? Not mid-swing, mid-roll, drinking or down. */
  _canGuard() {
    switch (this.state) {
      case 'idle':
      case 'run':
      case 'sprint':
      case 'block':
      case 'parry':
      case 'charge':
      case 'ghostep':
        return true;
      case 'attack':
      case 'heavy': {
        const a = this.atk;
        if (!a || a.pending) return true;
        return a.t < a.def.windup || a.t >= a.def.windup + a.def.active;
      }
      default:
        return false;
    }
  }

  /** Is the blow's source (attacker body or impact origin) inside the front cone `arc`? */
  _inArc(arc, hasFrom, fx, fz, ap) {
    const p = this.position, half = arc * 0.5;
    let any = false;
    if (ap) {
      any = true;
      if (Math.hypot(ap.x - p.x, ap.z - p.z) < 0.3) return true;
      if (facingDelta(this.yaw, p.x, p.z, ap.x, ap.z) <= half) return true;
    }
    if (hasFrom) {
      any = true;
      if (Math.hypot(fx - p.x, fz - p.z) < 0.3) return true;
      if (facingDelta(this.yaw, p.x, p.z, fx, fz) <= half) return true;
    }
    return !any; // no direction known: give the defender the benefit of the doubt
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
    this.tech = null;
    this._enter('idle', 'loco', blend);
  }

  /** Drop the current action (hit reactions). */
  _interrupt() {
    this.atk = null;
    this.tech = null; // a blow that lands breaks a technique's stance (the Qi stays spent)
    this.buf.action = null; // inputs mashed before the hit don't fire after the flinch
    this.chargeK = 0;
    this.blockStunT = 0;
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
      case 'block':
        this._tickBlock(dt);
        break;
      case 'parry':
        this._tickParry();
        break;
      case 'charge':
        this._tickCharge(dt);
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
      case 'ghostep':
        this._tickGhostep();
        break;
      case 'technique':
        this._tickTechnique(dt);
        break;
      case 'plunge':
        this._tickPlunge(dt);
        break;
      case 'stagger':
        this.want.x = this.want.z = 0;
        if (this.stateT >= TUNE.staggerDur) this._toLoco(0.14);
        break;
      case 'guardBreak':
        this.want.x = this.want.z = 0;
        if (this.stateT >= TUNE.guardBreakDur) this._enter('knockdown', 'knockdown', 0.1);
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

  /** Start whatever is buffered (or a held charge), if allowed. Returns true if a new action began.
   *  An attack press near a posture-broken wyrm's head is the plunge execution instead. */
  _tryAction(allowRoll = true, allowAttack = true, allowHeal = true) {
    if (allowAttack && this.lmb.held && this.lmb.t >= CHARGE.hold) return this._startCharge();
    const a = this.buf.action;
    if (!a) return false;
    if (a === 'roll' && allowRoll) {
      this.buf.action = null;
      return this._startRoll();
    }
    if (a === 'light' && allowAttack) {
      this.buf.action = null;
      if (this._tryExecution()) return true;
      // out of a sprint: the bounding slash; out of a forward roll: the low rising cut
      if (this.state === 'sprint' && Math.hypot(fin(this.groundVel.x), fin(this.groundVel.z)) > TUNE.runSpeed * 1.05) return this._startAttack(SPRINT_ATK);
      if (this.state === 'roll' && !this.rollBack) return this._startAttack(ROLL_ATK);
      return this._startAttack(LIGHT[0]);
    }
    if (a === 'heal' && allowHeal) {
      this.buf.action = null;
      return this._startHeal();
    }
    if (allowAttack && this._techSlot(a) >= 0) {
      this.buf.action = null;
      return this._startTechnique(this._techSlot(a));
    }
    return false;
  }

  /** Buffered action 'tech0' / 'tech1' → its slot index, else -1. */
  _techSlot(a) {
    if (typeof a !== 'string' || !a.startsWith('tech')) return -1;
    const i = Number(a.slice(4));
    return Number.isInteger(i) && i >= 0 && i < SLOT_COUNT ? i : -1;
  }

  _tickLoco(dt) {
    if (this._tryAction()) return;
    if (this.rmb.held) {
      this._startBlock();
      return;
    }
    const I = this.intent;
    const moving = I.len > 0.1;
    const sprint = moving && I.sprint;
    this.state = moving ? (sprint ? 'sprint' : 'run') : 'idle';
    const sp = sprint ? TUNE.sprintSpeed : TUNE.runSpeed;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = moving ? Math.atan2(I.x, I.z) : this.yaw;
    const target = sprint ? moveYaw : this._aimYaw(moveYaw);
    this.yaw = dampAngle(this.yaw, target, sprint ? 10 : TUNE.turnRate, dt);
  }

  // --- block / parry -------------------------------------------------
  _startBlock(blend = 0.08) {
    this.atk = null;
    this.chargeK = 0;
    if (this.buf.action === 'light') this.buf.action = null;
    this._enter('block', 'block', blend);
    return true;
  }

  _tickBlock(dt) {
    if (this.blockStunT > 0) {
      // guard-stagger after a heavy (blue) blow: rooted, the guard stays up
      this.blockStunT -= dt;
      this.want.x = this.want.z = 0;
      return;
    }
    if (!this.rmb.held) {
      this._toLoco(0.12);
      return;
    }
    if (this._tryAction(true, true, true)) return; // attack / roll / drink out of the guard
    const I = this.intent;
    const sp = TUNE.runSpeed * DEFENSE.blockMoveSpeed;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw;
    this.yaw = dampAngle(this.yaw, this._aimYaw(moveYaw), TUNE.blockTurn, dt);
  }

  _tickParry() {
    this.want.x = this.want.z = 0;
    const t = this.stateT;
    if (t >= TUNE.parryCancel && this._tryAction(true, true, false)) return; // riposte
    if (t >= TUNE.parryDur) {
      if (this.rmb.held) this._startBlock(0.12);
      else this._toLoco(0.14);
    }
  }

  /**
   * A parry (deflect). Parries in rhythm (≤ TUNE.deflectChainGap apart: a multi-hit string, Sekiro
   * style) count up the chain: the blade snaps to alternate sides, the clash sparks grow, the clang
   * rises in pitch (player:parry `chain`). No lockout: the next tap can parry the next hit at once
   * (the state allows a guard), and the guard lingers between taps (guardHold).
   */
  _parry(tell, attack, sx, sz, light = false) {
    const g = this.game, p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw); // the pushback: away from the blow
    if (Number.isFinite(sx) && Number.isFinite(sz)) {
      const dx = sx - p.x, dz = sz - p.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-2) {
        this.yaw = Math.atan2(dx, dz);
        nx = -dx / l;
        nz = -dz / l;
      }
    }
    const D = this.deflect;
    this.rmb.chain = true; // the next RMB press may parry again without the anti-mash re-arm
    D.n = this.time - D.t <= TUNE.deflectChainGap ? Math.min(99, D.n + 1) : 1;
    D.t = this.time;
    D.side = D.n & 1 ? 1 : -1;
    this.atk = null;
    this.chargeK = 0;
    this.blockStunT = 0;
    // light: a deflected bullet (hit.light). The same clash, without the weight of a claw behind it
    this._setKb(nx, nz, TUNE.deflectPush * (tell === TELL.BLUE ? 1.6 : 1) * (light ? 0.25 : 1));
    this._enter('parry', 'parry', 0.03);
    this._bladePoint(0.62, this._v);
    this.fx.parry(this._v.x, this._v.y, this._v.z, tell === TELL.BLUE, D.n, -nx, -nz);
    this._hitstop(light ? 0.03 : 0.08);
    g.shake?.(light ? 0.1 : Math.min(0.32, 0.2 + 0.03 * (D.n - 1)));
    this.gainQi(qiForParry(tell, D.n, light));
    this._emit('player:parry', { tell, attack, chain: D.n, light });
  }

  _block(dmg, tell, attack, chip, nx, nz) {
    const g = this.game;
    const red = DEFENSE.blockReduction[tell] ?? DEFENSE.blockReduction.normal;
    const taken = dmg * (1 - clamp(fin(red, 0.8), 0, 1));
    this._damage(taken);
    const push = (DEFENSE.blockPushback[tell] ?? DEFENSE.blockPushback.normal) * (chip ? TUNE.chipPush : 1);
    this._setKb(nx, nz, Math.max(fin(this.kb.x * nx + this.kb.z * nz) / TUNE.knockbackDecay, push));
    const heavy = tell === TELL.BLUE && !chip;
    this._bladePoint(0.45, this._v);
    if (chip) this.chipGuard = TUNE.chipGuard; // standing in a stream: rolling out of it is no perfect dodge
    if (chip) {
      this.recoil = Math.max(this.recoil, 0.35);
      this.fx.blockChip(this._v.x, this._v.y, this._v.z);
    } else {
      this.recoil = heavy ? 1 : 0.7;
      if (heavy) this.blockStunT = TUNE.blockStun;
      this.fx.block(this._v.x, this._v.y, this._v.z, nx, nz, heavy);
      g.shake?.(heavy ? 0.28 : 0.14);
      this._hitstop(heavy ? 0.07 : 0.04);
    }
    // report: every real blow; ticks of one stream are summed and reported at most every
    // blockEventGap (a leftover from an earlier stream is not added to a different blow)
    const E = this.blockEvt;
    const sameStream = chip && E.stream && E.attack === attack;
    if (sameStream && this.time - E.t < TUNE.blockEventGap) {
      E.acc += taken;
    } else {
      this._emit('player:block', { damage: taken + (sameStream ? E.acc : 0), tell });
      E.t = this.time;
      E.attack = attack;
      E.stream = chip;
      E.acc = 0;
    }
    if (this.hp <= 0) this._die();
  }

  _guardBreak(dmg, kind, burn, kb, attack, nx, nz, hasSrc) {
    const g = this.game;
    this._damage(dmg);
    if (burn > 0) this.burnT = Math.max(this.burnT, burn);
    this.flash = 1;
    this._bladePoint(0.4, this._v);
    this.fx.guardBreak(this._v.x, this._v.y, this._v.z, nx, nz);
    this._emit('player:hurt', { damage: dmg, kind, hp: this.hp });
    this._emit('player:guardBreak', { attack });
    g.shake?.(0.45);
    this._hitstop(0.1);
    this._interrupt();
    this._setKb(nx, nz, Math.max(kb, 1.6));
    if (this.hp <= 0) {
      this._die();
      return;
    }
    if (hasSrc) this.yaw = Math.atan2(-nx, -nz);
    this._enter('guardBreak', 'guardBreak', 0.04);
    this.anim.kickCoat(0.8);
  }

  // --- perfect dodge: the plunge / the Ghostep ------------------------------
  /**
   * Perfect dodge reward. An attacker that offers the plunge (plungePoint / onPlunge: the wyrm):
   * the plunge onto its head when in range and the hit allows it, otherwise slow-mo + crits where
   * the hero dodged (no teleport). Any other attacker: the v0.2 Ghostep (a blink behind it).
   */
  _perfectDodge(attacker, attack, tell, allowPlunge = true) {
    this.gainQi(QI.perfectDodge);
    if (this._plungeable(attacker)) {
      if (allowPlunge && this._startPlunge(attacker, false, attack, tell)) return;
      this._ghostep(attacker, attack, tell, false);
      return;
    }
    this._ghostep(attacker, attack, tell, true);
  }

  /** Ghostep: slow time, open the crit window; with `teleport`, blink behind the attacker (within
   *  TUNE.ghostepMaxRange). */
  _ghostep(attacker, attack, tell, teleport = true) {
    const g = this.game, p = this.position;
    const ox = p.x, oz = p.z;
    const nSegs = this._sampleGhost();
    const ap = attacker?.position;
    const hasAtk = !!ap && Number.isFinite(ap.x) && Number.isFinite(ap.z);
    let moved = false;
    if (teleport && hasAtk && Math.hypot(ap.x - ox, ap.z - oz) <= TUNE.ghostepMaxRange) {
      // behind = attacker.position − attacker forward × distance (forward from its yaw, else away from us)
      let fwd = fin(attacker.yaw, NaN);
      if (!Number.isFinite(fwd)) fwd = Math.atan2(ox - ap.x, oz - ap.z);
      // an attacker may ask for its own distance (`ghostepBehind`: a human duelist wants the hero
      // within sword reach of his back; the default suits a giant)
      const D = fin(attacker.ghostepBehind, DEFENSE.ghostep.distanceBehind);
      p.x = ap.x - Math.sin(fwd) * D;
      p.z = ap.z - Math.cos(fwd) * D;
      this._collide();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
        p.x = ox;
        p.z = oz;
      } else moved = true;
    }
    if (hasAtk) {
      const dx = ap.x - p.x, dz = ap.z - p.z;
      if (dx * dx + dz * dz > 1e-4) this.yaw = Math.atan2(dx, dz);
    }
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.chargeK = 0;
    this.buf.action = null;
    this.iframeT = TUNE.ghostepIframes;
    this.critTimer = DEFENSE.ghostep.critWindow;
    this.assist.target = hasAtk ? attacker : null;
    this.assist.t = hasAtk ? TUNE.ghostepAssist : 0;
    this.ghostFx = 1;
    this.object3d.rotation.y = this.yaw;
    this._enter('ghostep', 'ghostep', 0.03);
    if (moved) {
      this.anim.teleported();
      this.sweep.valid = false;
    }
    this.anim.kickCoat(1);
    this.fx.ghostep(this._ghostSegs, nSegs, ox, oz, p.x, p.z);
    this._slowmo(DEFENSE.ghostep.slowmoTime);
    g.shake?.(0.15);
    g.world?.setPusher?.(0, p.x, 0, p.z, TUNE.pusher);
    this._emit('player:perfectDodge', { attack, tell });
    this._emit('player:ghostep', { x: p.x, z: p.z });
  }

  /** Bone segments (world) of the current pose for the Ghostep afterimage. */
  _sampleGhost() {
    const out = this._ghostSegs;
    let n = 0;
    for (const chain of this.rig.ghostChains) {
      for (let i = 0; i + 1 < chain.length && n < 16; i++) {
        chain[i].getWorldPosition(this._v);
        chain[i + 1].getWorldPosition(this._v2);
        const k = n * 6;
        out[k] = this._v.x;
        out[k + 1] = this._v.y;
        out[k + 2] = this._v.z;
        out[k + 3] = this._v2.x;
        out[k + 4] = this._v2.y;
        out[k + 5] = this._v2.z;
        n++;
      }
    }
    // the blade
    if (n < 16 && this.sweep.valid) {
      const k = n * 6, a = this.sweep.a, b = this.sweep.b;
      out[k] = a.x;
      out[k + 1] = a.y;
      out[k + 2] = a.z;
      out[k + 3] = b.x;
      out[k + 4] = b.y;
      out[k + 5] = b.z;
      n++;
    }
    return n;
  }

  _tickGhostep() {
    this.want.x = this.want.z = 0;
    const t = this.stateT;
    if (t >= TUNE.ghostepCancel) {
      if (this._tryAction(true, true, false)) return;
      if (this.rmb.held) {
        this._startBlock();
        return;
      }
    }
    if (t >= TUNE.ghostepDur) this._toLoco(0.14);
  }

  // --- techniques (ADR-054; data: techniques/, numbers: COMBAT.md "Techniques") ----------
  /**
   * Add `n` Qi (clamped to qiMax). Parries, perfect dodges and landed strikes call it; the Lab's
   * "Qi full" too. Emits 'player:qiFull' once as the meter fills while a technique is equipped.
   */
  gainQi(n) {
    n = fin(n, 0);
    if (!(n > 0) || !this.alive) return this.qi;
    const before = this.qi;
    this.qi = Math.min(this.qiMax, before + n);
    if (before < this.qiMax && this.qi >= this.qiMax && this.techniques.equippedAny) this._emit('player:qiFull', { qi: this.qi });
    return this.qi;
  }

  /** Can slot `i` fire now: a technique in it and the Qi to pay for it? (HUD, touch.) */
  techReady(i) {
    const T = this.techniques.inSlot(i);
    return !!T && (this.qi >= T.cost || !!this.debug.infiniteQi);
  }

  /** Start the technique in slot `i` (Q / R). False: an empty slot, or too little Qi
   *  ('player:techniqueDenied'). The Qi is spent as it starts. */
  _startTechnique(i) {
    const T = this.techniques.inSlot(i);
    if (!T || T.kind !== 'counter') return false; // ('counter' is the only kind so far)
    if (!(this.qi >= T.cost) && !this.debug.infiniteQi) {
      this._emit('player:techniqueDenied', { slot: i, id: T.id, qi: this.qi, cost: T.cost });
      return false;
    }
    if (!this.debug.infiniteQi) this.qi = Math.max(0, this.qi - T.cost);
    this.atk = null;
    this.chargeK = 0;
    this.blockStunT = 0;
    this.tech = { def: T, slot: i };
    this.yaw = this._aimYaw(this.yaw);
    this._enter('technique', 'technique', 0.07);
    this.anim.kickCoat(0.35, this.anim.noise);
    this._bladePoint(0.8, this._v);
    this.fx.techRaise?.(this._v.x, this._v.y, this._v.z, this.position.x, this.position.z);
    this._emit('player:technique', { id: T.id, slot: i, phase: 'stance' });
    return true;
  }

  /** The counter stance (state 'technique'): rooted, turning to the aim; a roll may cancel it after
   *  `stance.rollAfter`; at `stance.dur` with nothing turned it ends in the lunge. */
  _tickTechnique(dt) {
    const tc = this.tech, T = tc?.def;
    if (!T) {
      this._toLoco(0.12);
      return;
    }
    const S = T.stance, t = this.stateT;
    this.want.x = this.want.z = 0;
    this.yaw = dampAngle(this.yaw, this._aimYaw(this.yaw), S.turn, dt);
    if (t >= S.rollAfter && this.buf.action === 'roll') {
      this.buf.action = null;
      this.tech = null;
      this._startRoll();
      return;
    }
    if (t >= S.dur) this._techStrike(T.lunge, null);
  }

  /**
   * A parryable blow reaches the stance (takeHit). Inside its cone once raised it is turned aside
   * (RESULT.PARRIED: the attacker runs its parry reaction). From an attacker whose nearest hurt
   * surface is within `stance.counterRange` it is answered by the counter; a thrown blow (`light`:
   * bullets, sword qi) or one from afar is only turned and the stance holds. Null: not turned.
   */
  _techIncoming(tell, attack, attacker, light, hasFrom, fx, fz, ap, sx, sz) {
    const T = this.tech.def, S = T.stance, p = this.position;
    if (this.stateT < S.open || !this._inArc(S.arc, hasFrom, fx, fz, ap)) return null;
    let dx = Math.sin(this.yaw), dz = Math.cos(this.yaw); // toward the blow
    if (Number.isFinite(sx) && Number.isFinite(sz)) {
      const l = Math.hypot(sx - p.x, sz - p.z);
      if (l > 1e-2) {
        dx = (sx - p.x) / l;
        dz = (sz - p.z) / l;
      }
    }
    const blue = tell === TELL.BLUE;
    const gap = this._nearestHurt(attacker, this._v2);
    this._bladePoint(0.62, this._v);
    if (light || !(gap <= S.counterRange)) {
      this.fx.parry(this._v.x, this._v.y, this._v.z, blue, 1, dx, dz);
      this.recoil = Math.max(this.recoil, 0.6);
      this._hitstop(0.03);
      this._emit('player:parry', { tell, attack, chain: 1, light: true, technique: T.id });
      return RESULT.PARRIED;
    }
    this.fx.parry(this._v.x, this._v.y, this._v.z, blue, 3, dx, dz);
    this.fx.techTurn?.(this._v.x, this._v.y, this._v.z, dx, dz);
    this.game.shake?.(0.3);
    this._emit('player:parry', { tell, attack, chain: 1, light: false, technique: T.id });
    this._techStrike(T.counter, this._v2, gap);
    this._hitstop(0.1);
    return RESULT.PARRIED;
  }

  /**
   * The technique's strike: `C` = def.counter (toward `target`, `gap` m to its surface: it lunges to
   * stop `C.stopShort` short, within C.travel; i-frames C.iframes) or def.lunge (along the aim).
   * Runs as a thrust (state 'heavy'); atk.tech carries its posture / pierce / assist into _applyHit.
   */
  _techStrike(C, target, gap = 0) {
    const tc = this.tech, T = tc?.def;
    if (!T || !C) {
      this._toLoco(0.12);
      return;
    }
    const counter = C === T.counter, p = this.position;
    if (target) {
      const dx = target.x - p.x, dz = target.z - p.z;
      if (dx * dx + dz * dz > 1e-4) this.yaw = Math.atan2(dx, dz);
    } else this.yaw = this._aimYaw(this.yaw);
    this.object3d.rotation.y = this.yaw;
    const travel = Array.isArray(C.travel) ? clamp(fin(gap) - fin(C.stopShort, 1.4), C.travel[0], C.travel[1]) : fin(C.travel, 0);
    this.atk = {
      def: C, t: 0, hit: false, prevT: 0, gust: false, impact: false, flared: false, pending: false,
      lunge: 0, travel, damage: fin(C.damage, 70), poise: fin(C.poise, 30), charge: 1,
      tech: { id: T.id, counter, posture: C.posture, pierce: !!C.pierce, assist: !!C.assist },
    };
    this.tech = null;
    this.releaseK = 1;
    this.chargeK = 0;
    if (C.iframes > 0) this.iframeT = Math.max(this.iframeT, C.iframes);
    this._enter('heavy', 'attack', Math.max(0.03, C.windup * 0.9), true);
    this._swingStarted(C, 1);
    this._emit('player:technique', { id: T.id, slot: tc.slot, phase: counter ? 'counter' : 'lunge' });
  }

  /** Ground distance (m) from the hero to `att`'s nearest hurt surface; its centre into `out`.
   *  Falls back to its position; Infinity without either. */
  _nearestHurt(att, out) {
    const p = this.position;
    let best = Infinity;
    const hs = att?.hurtSpheres;
    if (Array.isArray(hs)) {
      for (const h of hs) {
        if (!h || !(h.r > 0) || !Number.isFinite(h.x + h.y + h.z)) continue;
        const g = Math.hypot(h.x - p.x, h.z - p.z) - h.r;
        if (g < best) {
          best = g;
          out.set(h.x, h.y, h.z);
        }
      }
    }
    const ap = att?.position;
    if (best === Infinity && ap && Number.isFinite(ap.x + ap.z)) {
      best = Math.hypot(ap.x - p.x, ap.z - p.z);
      out.set(ap.x, 1.2, ap.z);
    }
    return Math.max(0, best);
  }

  // --- the plunge (contract 2; numbers: DEFENSE.plunge) ----------------------
  // VANISH (afterimage at the dodge spot, hidden) → HANG (reappears above the head, coiled, in the
  // slow-mo) → DIVE (accelerating, blade trail) → impact: attacker.onPlunge once, hitstop, burst →
  // RIDE (keeps its offset to the head top while the head is slammed down) → FLIP (backflip arc to a
  // landing in front of the head, toward where he came from) → LAND (crouch, crit window, then free).
  // position.y is the visual lift; x / z stay the ground point under the hero. Hits are ignored and
  // body circles don't push him until LAND.

  /** Does `att` offer the plunge (plungePoint + onPlunge) and stand alive? */
  _plungeable(att) {
    return !!att && typeof att.plungePoint === 'function' && typeof att.onPlunge === 'function' &&
      att.state !== 'dying' && att.state !== 'dead' && att.state !== 'sleeping';
  }

  /** att.plungePoint into `out` (finite), else null. Never throws. */
  _plungePoint(att, out) {
    if (!att || typeof att.plungePoint !== 'function') return null;
    try {
      const r = att.plungePoint(out);
      if (r && Number.isFinite(out.x + out.y + out.z)) return out;
    } catch (err) {
      console.error('[player] plungePoint failed', err);
    }
    return null;
  }

  /** Posture-broken wyrm, attack pressed within DEFENSE.plunge.execRange of its head: execution.
   *  A broken duelist (the Ash Disciple: `onExecute`, no plunge) within its `execRange`: the lunging
   *  execution thrust (_startExecuteThrust). */
  _tryExecution() {
    const d = this.game.dragon;
    if (!d?.broken) return false;
    if (!this._plungeable(d)) return this._startExecuteThrust(d);
    if (!this._startPlunge(d, true)) return false;
    this.lmb.held = false; // the press is spent: no charge waiting after the landing
    return true;
  }

  /**
   * The execution against a duelist: a full thrust that lunges to him and, on its first active frame,
   * runs him through: `d.onExecute({ damage })` instead of the sweep test (DEFENSE.plunge.execDamage;
   * the EXECUTION call-out through player:plungeHit {execution}). False when he is out of range.
   */
  _startExecuteThrust(d) {
    if (typeof d?.onExecute !== 'function' || d.state === 'dying' || d.state === 'dead') return false;
    const p = this.position, dp = d.position;
    if (!dp) return false;
    const dist = Math.hypot(dp.x - p.x, dp.z - p.z);
    if (!(dist <= fin(d.execRange, 3.2))) return false;
    this._releaseThrust(CHARGE.full);
    this.yaw = Math.atan2(dp.x - p.x, dp.z - p.z);
    this.object3d.rotation.y = this.yaw;
    this.atk.exec = d;
    this.atk.travel = clamp(dist - 1.0, 0, 3);
    this.lmb.held = false;
    this._emit('player:plunge', { execution: true });
    return true;
  }

  /** The execution thrust reaches him (see _startExecuteThrust). */
  _executeHit(a) {
    const d = a.exec;
    a.hit = true;
    let dealt = 0;
    try {
      dealt = fin(d.onExecute({ damage: DEFENSE.plunge.execDamage }), 0);
    } catch (err) {
      console.error('[player] onExecute failed', err);
    }
    const pt = d.lockPoint?.(this._v) ?? this._v.set(d.position.x, 1.2, d.position.z);
    const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    if (dealt > 0) this._emit('player:hitDragon', { damage: dealt, part: 'body', point: { x: pt.x, y: pt.y, z: pt.z }, heavy: true, crit: true, kind: 'execute' });
    this._emit('player:plungeHit', { damage: dealt, execution: true });
    this._hitstop(0.16);
    this.game.shake?.(0.5);
    this.fx.sparks(pt.x, pt.y, pt.z, dir.x, dir.z, true, true);
  }

  /**
   * Start the plunge on `att` (false: out of range / no head point). `exec` = the posture-break
   * execution (starts at the hang, no slow-mo, no perfect-dodge events).
   */
  _startPlunge(att, exec, attack = null, tell = TELL.NORMAL, anyRange = false) {
    const g = this.game, p = this.position, P = DEFENSE.plunge, pl = this.pl;
    if (!this._plungePoint(att, pl.pt)) return false;
    const ox = p.x, oz = p.z;
    if (!anyRange && !(Math.hypot(pl.pt.x - ox, pl.pt.z - oz) <= (exec ? P.execRange : P.range))) return false;
    const nSegs = this._sampleGhost(); // the afterimage left at the dodge spot
    pl.att = att;
    pl.exec = !!exec;
    pl.ox = ox;
    pl.oz = oz;
    pl.hit = false;
    pl.dealt = 0;
    pl.fxT = 0;
    this._plungeDir(att, pl);
    pl.phase = exec ? PL.HANG : PL.VANISH;
    pl.t = 0;
    this._plungeHang(pl, 0, p);
    this.yaw = Math.atan2(-pl.dx, -pl.dz); // facing the head, his back to the landing side
    this.object3d.rotation.y = this.yaw;
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.chargeK = 0;
    this.blockStunT = 0;
    this.buf.action = null;
    this.critTimer = 0; // reopened on landing
    this.iframeT = 0;
    this.assist.target = null;
    this.assist.t = 0;
    this.ghostFx = 1;
    this._enter('plunge', 'plunge', 0.02);
    this.anim.teleported();
    this.sweep.valid = false;
    this.anim.kickCoat(1, this.anim.noise);
    this.fx.plungeBlink(this._ghostSegs, nSegs, ox, oz, p.x, p.y, p.z);
    g.world?.setPusher?.(0, p.x, p.y, p.z, TUNE.pusher);
    if (!exec) {
      this._slowmo(DEFENSE.ghostep.slowmoTime);
      g.shake?.(0.15);
      this._emit('player:perfectDodge', { attack, tell });
      this._emit('player:ghostep', { x: p.x, z: p.z });
    }
    this._plungeAnimSync();
    return true;
  }

  /**
   * The spring-off direction (unit, ground plane): from the head toward where the hero came from.
   * One who came from behind the head (over the body) springs off in front of it on his side.
   */
  _plungeDir(att, pl) {
    const pt = pl.pt, ay = fin(att?.yaw, NaN);
    const fx = Number.isFinite(ay) ? Math.sin(ay) : 0, fz = Number.isFinite(ay) ? Math.cos(ay) : 1;
    let vx = pl.ox - pt.x, vz = pl.oz - pt.z;
    const l = Math.hypot(vx, vz);
    if (l > 0.3) {
      vx /= l;
      vz /= l;
    } else {
      vx = fx; // right under the head: off along its nose
      vz = fz;
    }
    if (vx * fx + vz * fz < -0.3) {
      const side = fx * vz - fz * vx > 0 ? -1 : 1; // which side of the nose he came from
      const a = Math.atan2(fx, fz) + side * PLUNGE_BEHIND_TURN;
      vx = Math.sin(a);
      vz = Math.cos(a);
    }
    pl.dx = vx;
    pl.dz = vz;
  }

  /** The hang point above the head at hang progress u (a short rise that settles: the apex). */
  _plungeHang(pl, u, out) {
    const P = DEFENSE.plunge, rise = 0.32 * (1 - (1 - u) * (1 - u));
    return out.set(pl.pt.x + pl.dx * P.appearBack, pl.pt.y + P.appearUp + rise, pl.pt.z + pl.dz * P.appearBack);
  }

  /** Where he lands on the head: just on his side of the head top. */
  _plungeSeat(pl, out) {
    const P = DEFENSE.plunge;
    return out.set(pl.pt.x + pl.dx * P.rideBack, pl.pt.y - 0.05, pl.pt.z + pl.dz * P.rideBack);
  }

  /** Next plunge phase; the animator re-enters the clip with a short cross-fade (anim.js). */
  _plungePhase(n) {
    this.pl.phase = n;
    this.pl.t = 0;
    this._plungeAnimSync();
    this.anim.play('plunge', PL_BLEND[n] ?? 0.05);
  }

  _tickPlunge(dt) {
    const P = DEFENSE.plunge, pl = this.pl, p = this.position;
    this.want.x = this.want.z = 0;
    pl.t += dt;
    // the head this frame (the wyrm's pose of the last frame); gone (killed and removed, a reset
    // that drops the API): spring off from where he is
    const head = this._plungePoint(pl.att, pl.pt);
    if (!head && pl.phase < PL.FLIP) {
      if (pl.phase === PL.DIVE) this._plungeImpact(); // he still lands his blow
      this._plungeFlip();
    }
    switch (pl.phase) {
      case PL.VANISH:
      case PL.HANG: {
        // the apex holds still: it drifts after a moving head at PLUNGE_HANG_TRACK m/s at most (a
        // spinning tail sweep swung the head, and him with it, round in a wide arc)
        const hang = pl.phase === PL.HANG;
        this._plungeHang(pl, hang ? clamp(pl.t / P.hang, 0, 1) : 0, this._v);
        const d = this._v.distanceTo(p), max = PLUNGE_HANG_TRACK * dt;
        if (d > max && d > 1e-6) p.lerp(this._v, max / d);
        else p.copy(this._v);
        if (!hang && pl.t >= P.vanish) {
          this._plungePhase(PL.HANG);
          this.ghostFx = 1; // resolves out of the cold dissolve over the hang
        } else if (hang && pl.t >= P.hang) {
          pl.from.copy(p); // the dive starts where he hangs and pursues the head
          this._plungePhase(PL.DIVE);
          this.anim.kickCoat(0.6, this.anim.noise);
          this._emit('player:plunge', { execution: pl.exec });
        }
        break;
      }
      case PL.DIVE: {
        const u = clamp(pl.t / P.dive, 0, 1);
        this._plungeSeat(pl, this._v2);
        p.lerpVectors(pl.from, this._v2, u * u); // accelerating onto the head
        if (u >= 1) this._plungeImpact();
        break;
      }
      case PL.RIDE: {
        // riding the head down: keep the offset to its top (eased through a jump of the head)
        this._v.copy(pl.pt).add(pl.off);
        const d = this._v.distanceTo(p), max = PLUNGE_RIDE_MAX * dt;
        if (d > max && d > 1e-6) p.lerp(this._v, max / d);
        else p.copy(this._v);
        if (pl.t >= P.ride) this._plungeFlip();
        break;
      }
      case PL.FLIP: {
        const u = clamp(pl.t / pl.flipDur, 0, 1), f = pl.from, L = pl.land;
        p.x = f.x + (L.x - f.x) * u;
        p.z = f.z + (L.z - f.z) * u;
        p.y = Math.max(0, f.y * (1 - u) + P.flipUp * 4 * u * (1 - u));
        if (u >= 1) this._plungeLand();
        break;
      }
      case PL.LAND:
      default:
        // the landing crouch: free to act after landCancel (attack, roll, guard), then loco
        if (pl.t >= P.landCancel) {
          if (this._tryAction(true, true, false)) return;
          if (this.rmb.held) {
            this._startBlock(0.12);
            return;
          }
          if (pl.t >= P.land * 0.6 && this.intent.len > 0.1) {
            this._toLoco(0.16);
            return;
          }
        }
        if (pl.t >= P.land) this._toLoco(0.16);
    }
    if (!Number.isFinite(p.x + p.y + p.z)) {
      p.set(fin(pl.ox, CONFIG.world.playerSpawn.x), 0, fin(pl.oz, CONFIG.world.playerSpawn.z));
      this._plungeLand();
    }
    this._plungeAnimSync();
  }

  /** The blade meets the head: onPlunge once, the hitstop, the burst, then ride it. */
  _plungeImpact() {
    const P = DEFENSE.plunge, pl = this.pl, g = this.game, p = this.position;
    if (pl.hit) return;
    pl.hit = true;
    this._plungeSeat(pl, p);
    pl.off.subVectors(p, pl.pt);
    const exec = pl.exec;
    const damage = exec ? P.execDamage : P.damage;
    const hp = pl.hitPt;
    hp.x = pl.pt.x;
    hp.y = pl.pt.y - 0.25;
    hp.z = pl.pt.z;
    let dealt = damage;
    if (this._plungeable(pl.att)) {
      try {
        const r = pl.att.onPlunge({ damage, posture: P.posture, point: hp, execution: exec });
        if (Number.isFinite(r)) dealt = r;
      } catch (err) {
        console.error('[player] onPlunge failed', err);
      }
    } else dealt = 0;
    pl.dealt = dealt;
    this._plungePhase(PL.RIDE);
    this._hitstop(P.impactStop, 0.03);
    g.shake?.(exec ? P.execShake : P.impactShake);
    g.world?.gust?.(hp.x, hp.z, 1.4, 8);
    this.anim.kickCoat(0.9, this.anim.noise);
    this.fx.plungeImpact(hp.x, hp.y, hp.z, pl.dx, pl.dz, exec);
    if (dealt > 0) this._emit('player:hitDragon', { damage: dealt, part: 'head', point: { x: hp.x, y: hp.y, z: hp.z }, heavy: true, crit: exec, kind: 'plunge' });
    this._emit('player:plungeHit', { damage: dealt, execution: exec });
  }

  /** Rip the blade out and spring off: a backflip arc to a clear landing in front of the head. */
  _plungeFlip() {
    const P = DEFENSE.plunge, pl = this.pl, p = this.position;
    if (!Number.isFinite(p.y) || p.y < 0) p.y = 0;
    pl.from.copy(p);
    this._plungeLanding(pl, pl.land);
    pl.flipDur = clamp(P.flip[0] + 0.035 * Math.max(0, p.y - 2), P.flip[0], P.flip[1]);
    // facing the head (his takeoff point) from the landing: the flip carries him backward
    const fx = p.x - pl.land.x, fz = p.z - pl.land.z;
    if (fx * fx + fz * fz > 0.04) this.yaw = Math.atan2(fx, fz);
    this._plungePhase(PL.FLIP);
    this.anim.kickCoat(0.8, this.anim.noise);
    if (pl.hit) this.fx.plungeRip(pl.hitPt.x, pl.hitPt.y, pl.hitPt.z, pl.dx, pl.dz);
  }

  /** A clear landing in front of the head along the spring-off direction (turned off the body if
   *  it is in the way), clamped to the arena and resolved against the stones. */
  _plungeLanding(pl, out) {
    const P = DEFENSE.plunge, g = this.game, pt = pl.pt;
    const circles = pl.att?.bodyCircles ?? g.dragon?.bodyCircles;
    const B = CONFIG.world.playerBound;
    const base = Math.atan2(pl.dx, pl.dz);
    for (const da of LAND_TURNS) {
      const a = base + da, sx = Math.sin(a), sz = Math.cos(a);
      for (let r = P.landMin; r <= P.landMax + 1e-6; r += 0.75) {
        const x = pt.x + sx * r, z = pt.z + sz * r;
        if (Math.hypot(x, z) > B - 1) break; // farther only leaves the arena
        if (this._inBody(circles, x, z, this.radius + P.landClear)) continue;
        out.set(x, 0, z);
        g.world?.resolve?.(out, this.radius, B);
        if (!Number.isFinite(out.x + out.z)) continue;
        if (Math.hypot(out.x - x, out.z - z) > 1.5 || this._inBody(circles, out.x, out.z, this.radius + 0.2)) continue;
        pl.dx = sx;
        pl.dz = sz;
        return out;
      }
    }
    // cornered: come down where he is (resolve pushes him clear of stones and the arena edge)
    out.set(fin(pl.from.x, pl.ox), 0, fin(pl.from.z, pl.oz));
    g.world?.resolve?.(out, this.radius, B);
    if (!Number.isFinite(out.x + out.z)) out.set(pl.ox, 0, pl.oz);
    return out;
  }

  _inBody(circles, x, z, r) {
    if (!Array.isArray(circles)) return false;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (!c || !(c.r > 0) || !Number.isFinite(c.x + c.z)) continue;
      const m = c.r + r;
      if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < m * m) return true;
    }
    return false;
  }

  /** Touchdown: the crouch, a short slide, the crit window, a moment of i-frames. */
  _plungeLand() {
    const P = DEFENSE.plunge, pl = this.pl, g = this.game, p = this.position;
    p.set(fin(pl.land.x, p.x), 0, fin(pl.land.z, p.z));
    this._collide();
    if (!Number.isFinite(p.x + p.z)) p.set(pl.ox, 0, pl.oz);
    p.y = 0;
    const tx = pl.pt.x - p.x, tz = pl.pt.z - p.z;
    if (Number.isFinite(tx + tz) && tx * tx + tz * tz > 0.04) this.yaw = Math.atan2(tx, tz);
    this.critTimer = DEFENSE.ghostep.critWindow;
    this.iframeT = P.landIframes;
    const tgt = this._plungeable(pl.att) ? pl.att : null;
    this.assist.target = tgt;
    this.assist.t = tgt ? TUNE.ghostepAssist : 0;
    this.vel.x = this.vel.z = 0; // the flip's momentum goes into the crouch and a short slide
    this._setKb(pl.dx, pl.dz, 0.55);
    this._plungePhase(PL.LAND);
    this.fx.plungeLand(p.x, p.z, pl.dx, pl.dz);
    g.shake?.(0.22);
    g.world?.gust?.(p.x, p.z, 0.8, 4);
    this._emit('player:footstep', { x: p.x, z: p.z, sprint: true });
    this.anim.kickCoat(0.7, this.anim.noise);
  }

  /** What the animator reads (anim.js plunge block). */
  _plungeAnimSync() {
    const pl = this.pl, A = this.plungeAnim, P = DEFENSE.plunge;
    A.phase = pl.phase;
    A.t = pl.t;
    A.exec = pl.exec;
    A.h = this.position.y;
    const dur = pl.phase === PL.VANISH ? P.vanish : pl.phase === PL.HANG ? P.hang : pl.phase === PL.DIVE ? P.dive
      : pl.phase === PL.RIDE ? P.ride : pl.phase === PL.FLIP ? pl.flipDur : P.land;
    A.u = clamp(pl.t / Math.max(1e-3, dur), 0, 1);
  }

  /** Lab / captures: plunge onto the dragon now, from anywhere (even onto a flying wyrm). */
  _debugPlunge(execution = false) {
    const d = this.game.dragon;
    if (!this.alive || !this._plungeable(d) || this.state === 'plunge') return false;
    return this._startPlunge(d, !!execution, 'debug', TELL.RED, true);
  }

  // --- roll --------------------------------------------------------------
  _startRoll() {
    const I = this.intent;
    const back = I.len <= 0.1;
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
    this.chargeK = 0;
    this._enter('roll', back ? 'backstep' : 'roll', 0.05);
    if (!back) this.anim.kickCoat(TUNE.rollCoatKick);
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
    if (t >= R.moveAfter && (this.intent.len > 0.1 || this.rmb.held)) {
      if (this.rmb.held) this._startBlock(0.1);
      else this._toLoco(0.12);
      return;
    }
    if (t >= R.dur) this._toLoco(0.12);
  }

  // --- attacks -----------------------------------------------------------
  _startAttack(def) {
    if (!def) return false;
    const light = def.kind === 'light';
    this.atk = {
      def, t: 0, hit: false, prevT: 0, gust: false, impact: false, flared: false, lunge: null, travel: fin(def.travel, 0),
      pending: light && this.lmb.held, // still held: may become a charge (the swing waits at the coil)
      damage: fin(def.damage, 30), poise: fin(def.poise, 12), charge: 0,
    };
    this.chargeK = 0;
    if (!def.keepYaw) this.yaw = this._aimYaw(this.yaw); // commit the swing direction
    // the cross-fade IS the windup: the body eases into the coil pose
    this._enter('attack', 'attack', def.windup * 0.85, true);
    if (!this.atk.pending) this._swingStarted(def, 0);
    return true;
  }

  /** A swing really starts (a held light only once it is released): announce it, glint the gem. */
  _swingStarted(def, charge) {
    this._emit('player:attack', { kind: def.kind, combo: def.combo, charge });
    if (def.kind !== 'light') this.anim.kickCoat(def.kind === 'thrust' ? 0.5 + 0.5 * charge : 0.45);
    this.rig.gem.getWorldPosition(this._gem);
    const gv = this.gemVel;
    this.fx.gemGlint(this._gem.x, this._gem.y, this._gem.z, def.kind === 'light' ? 0.6 : 1, gv.x, gv.z, gv.y);
  }

  _startCharge() {
    this.atk = null;
    if (this.buf.action === 'light') this.buf.action = null;
    this.chargeK = thrustStats(this.lmb.t).k;
    this.chargeFull = false;
    this._enter('charge', 'charge', 0.16);
    this._emit('player:charge', { t: Math.max(0.25, CHARGE.full - this.lmb.t) });
    return true;
  }

  _tickCharge(dt) {
    const L = this.lmb;
    if (!this.control) {
      this._toLoco(0.14); // pause / cutscene mid-charge: drop it rather than fire it
      return;
    }
    const st = thrustStats(L.t);
    this.chargeK = st.k;
    if (st.k >= 1 && !this.chargeFull) {
      this.chargeFull = true;
      this._bladePoint(0.95, this._v);
      this.fx.chargeReady(this._v.x, this._v.y, this._v.z, this.position.x, this.position.z);
    }
    if (!L.held) {
      this._releaseThrust(L.t);
      return;
    }
    if (this.buf.action === 'roll') {
      this.buf.action = null;
      this._startRoll();
      return;
    }
    const ts = this._techSlot(this.buf.action);
    if (ts >= 0) {
      // a technique cancels the charge (the held press is spent)
      this.buf.action = null;
      if (this._startTechnique(ts)) {
        L.held = false;
        return;
      }
    }
    const I = this.intent;
    const sp = TUNE.runSpeed * CHARGE.move;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw;
    this.yaw = dampAngle(this.yaw, this._aimYaw(moveYaw), TUNE.turnRate, dt);
  }

  /** Release the charge: a lunging thrust whose travel, damage and posture grow with the charge. */
  _releaseThrust(holdT) {
    const st = thrustStats(holdT);
    this.atk = {
      def: THRUST, t: 0, hit: false, prevT: 0, gust: false, impact: false, flared: false, pending: false,
      lunge: 0, travel: st.travel, damage: st.damage, poise: st.poise, charge: st.k,
    };
    this.releaseK = st.k;
    this.chargeK = 0;
    this.yaw = this._aimYaw(this.yaw);
    this._enter('heavy', 'attack', THRUST.windup * 0.9, true);
    this._swingStarted(THRUST, st.k);
  }

  /**
   * Step-in assist (REACH.assist): the lunge that carries a swing of `def.reach` into the nearest
   * hurt surface ahead — within `range` m and `arc` rad of the facing, at heights the reach band can
   * touch — never shorter than def.lunge nor longer than def.lunge + max.
   */
  _lungeFor(def) {
    const base = Math.max(0, fin(def.lunge, 0));
    const dr = this.game.dragon, A = REACH.assist;
    if (!this._dragonTargetable(dr) || !Array.isArray(dr.hurtSpheres)) return base;
    const p = this.position, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const top = 1.3 + REACH.up; // a swing at hero height plus the band
    let gap = Infinity;
    for (const h of dr.hurtSpheres) {
      if (!h || !(h.r > 0) || !Number.isFinite(h.x + h.y + h.z)) continue;
      const dy = h.y > top ? h.y - top : 0;
      if (dy >= h.r) continue;
      const rr = Math.sqrt(h.r * h.r - dy * dy); // horizontal radius at the band's top
      const dx = h.x - p.x, dz = h.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (!(dist > 1e-3)) continue;
      const off = Math.acos(clamp((dx * fx + dz * fz) / dist, -1, 1)) - Math.asin(clamp(rr / dist, 0, 1));
      if (off > A.arc) continue;
      gap = Math.min(gap, dist - rr);
    }
    if (!(gap < A.range)) return base;
    return clamp(gap - fin(def.reach, 2) + 0.4, base, base + A.max);
  }

  _tickAttack(dt) {
    const a = this.atk;
    if (!a) {
      this._toLoco();
      return;
    }
    const d = a.def;
    const W = d.windup, A = d.active, R = d.recovery;
    if (a.pending) {
      if (!this.lmb.held) {
        a.pending = false; // tap: the swing goes ahead
        this._swingStarted(d, 0);
      } else if (this.lmb.t >= CHARGE.hold) {
        this._startCharge();
        return;
      }
    }
    a.t = a.pending ? Math.min(W, a.t + dt) : a.t + dt; // a held light waits at the coil
    const t = a.t;
    if (t < W && !d.keepYaw) this.yaw = turnToward(this.yaw, this._aimYaw(this.yaw), TUNE.windupSteer * dt);
    // lunge forward through the strike (stretched by the step-in assist); the thrust's root travel
    // is front-loaded through its active frames
    let lv = 0;
    if (d.kind === 'thrust') {
      if (t >= W && t <= W + A) lv = (a.travel / A) * (1.5 - (t - W) / A);
    } else if (a.travel > 0) {
      // a travelling light (the sprint slash): the run's momentum carries on through the windup and
      // the cut, dying out (integrates to a.travel)
      const T = W + A;
      if (!a.pending && t <= T) lv = (a.travel / T) * (1.4 - (0.8 * t) / T);
    } else {
      const l0 = W - 0.08, l1 = W + A;
      if (!a.pending && t >= l0 && t <= l1) {
        if (a.lunge === null) a.lunge = this._lungeFor(d);
        lv = a.lunge / (l1 - l0);
      }
    }
    this.want.x = Math.sin(this.yaw) * lv;
    this.want.z = Math.cos(this.yaw) * lv;

    if (t >= W + A) {
      const r = (t - W - A) / R;
      const b = this.buf.action;
      if (b === 'light') {
        this.buf.action = null;
        if (this._tryExecution()) return;
        const next = d.kind === 'light' ? LIGHT[d.combo % LIGHT.length] : LIGHT[0];
        if (this._startAttack(next)) return;
      } else if (b === 'roll' && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startRoll()) return;
      } else if (b === 'heal' && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startHeal()) return;
      } else if (this._techSlot(b) >= 0 && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startTechnique(this._techSlot(b))) return;
      }
      if (this.lmb.held && this.lmb.t >= CHARGE.hold) {
        this._startCharge();
        return;
      }
      if (r >= TUNE.moveCancel && (this.intent.len > 0.1 || this.rmb.held)) {
        if (this.rmb.held) this._startBlock(0.12);
        else this._toLoco(0.14);
        return;
      }
    }
    if (t >= W + A + R) {
      if (this.rmb.held) this._startBlock(0.14);
      else this._toLoco(0.16);
    }
  }

  // --- flask -------------------------------------------------------------
  _startHeal() {
    if (this.flasks <= 0 && !this.debug.infiniteFlasks) {
      this._emit('player:noFlask');
      return false;
    }
    if (!this.debug.infiniteFlasks) this.flasks--;
    this.healApplied = false;
    this.atk = null;
    this.chargeK = 0;
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
      this.healLight?.kill?.();
      this.healLight = this.game.lights?.add?.({ x: p.x, y: 1.3, z: p.z, color: [0.6, 1.0, 0.35], intensity: 2.2, radius: 4.5, life: 0.9, fade: 0.6, fadeIn: 0.05 }) ?? null;
    }
    if (t >= H.dur) this._toLoco(0.15);
  }

  // --- down / dead -------------------------------------------------------
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
    this.tech = null;
    this.buf.action = null;
    this.burnT = 0;
    this.burnAcc = 0;
    this.chargeK = 0;
    this.critTimer = 0;
    this.iframeT = 0;
    this.slowmoPending = 0;
    this.blockStunT = 0;
    this._setLock(false);
    this._enter('dead', 'dead', 0.1);
    this.want.x = this.want.z = 0;
    if (!this.diedEmitted) {
      this.diedEmitted = true;
      this._emit('player:died');
    }
  }

  /** Lose HP unless the Lab's god mode is on (the hit still reacts and reports). */
  _damage(amount) {
    if (this.debug.god) return;
    this.hp = Math.max(0, this.hp - Math.max(0, fin(amount)));
  }

  _setKb(nx, nz, dist) {
    const v = Math.max(0, fin(dist)) * TUNE.knockbackDecay; // exp decay → total slide = dist
    this.kb.x = fin(nx) * v;
    this.kb.z = fin(nz) * v;
  }

  /** Short freeze-frame, skipped while a longer slow-mo (Ghostep) runs so it can't turn into a freeze. */
  _hitstop(sec, scale = 0.04) {
    const g = this.game;
    if (fin(g.hitstopTimer) > sec && fin(g.hitstopScale, 1) > scale) return;
    g.hitstop?.(sec, scale);
  }

  /**
   * Ghostep slow-mo. game.hitstop keeps the harsher scale for the longer timer, so starting it during
   * a freeze already running (the leap slam freezes on landing, then strikes) would turn the whole
   * slow-mo into a freeze: wait for that freeze to end instead (update() fires the pending one).
   */
  _slowmo(sec) {
    const g = this.game;
    if (fin(g.hitstopTimer) > 0 && fin(g.hitstopScale, 1) < DEFENSE.ghostep.slowmoScale) {
      this.slowmoPending = sec;
      return;
    }
    this.slowmoPending = 0;
    g.hitstop?.(sec, DEFENSE.ghostep.slowmoScale);
  }

  // ------------------------------------------------------------------ movement
  _integrate(dt) {
    if (dt <= 0) return;
    const v = this.vel, w = this.want;
    if (this.state === 'plunge' && this.pl.phase < PL.LAND) {
      // in the air / on the head: _tickPlunge placed him (no body push-out, no ground clamp)
      v.x = v.z = this.kb.x = this.kb.z = 0;
      this.groundVel.x = this.groundVel.z = 0;
      return;
    }
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
      case 'guardBreak':
      case 'parry':
      case 'ghostep':
      case 'plunge':
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
        if (!c || !(c.r > 0) || !Number.isFinite(c.x + c.z)) continue;
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

  // ------------------------------------------------------------------ burn status
  _updateBurn(dt) {
    // takeHit ignores damage on the title / after victory; burn must not finish the hero off there
    const st = this.game.state;
    if (this.burnT > 0 && (st === 'victory' || st === 'title')) this._clearBurn();
    if (this.burnT > 0 && this.alive) {
      this.burnAcc += TUNE.burnDps * Math.min(dt, this.burnT);
      this.burnT -= dt;
      const tick = TUNE.burnDps * TUNE.burnTick;
      while (this.burnAcc >= tick && this.alive) {
        this.burnAcc -= tick;
        this._damage(tick);
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
        this.burnLight = this.game.lights?.add?.({ x: p.x, y: 1, z: p.z, color: [1, 0.45, 0.12], intensity: 1.4, radius: 3.5, flicker: 0.5, fade: 0.3, fadeIn: 0.1 }) ?? null;
      }
      this.burnLight?.set?.(p.x, 1.0, p.z);
    } else if (this.burnLight) {
      this.burnLight.kill?.();
      this.burnLight = null;
    }
  }

  _clearBurn() {
    this.burnT = 0;
    this.burnAcc = 0;
    if (this.burnLight) {
      this.burnLight.kill?.();
      this.burnLight = null;
    }
  }

  // ------------------------------------------------------------------ sword hits
  /** Point `f` (0 hilt … 1 tip) along the blade, world space (falls back to the chest). */
  _bladePoint(f, out) {
    if (this.sweep.valid) return this.sweep.point(f, out);
    return this.getChestPos(out, true);
  }

  _combat() {
    const sw = this.sweep;
    if (!sw.sample()) return;
    const a = this.atk;
    if (a && !a.pending && (this.state === 'attack' || this.state === 'heavy')) {
      const d = a.def, t = a.t;
      const W = d.windup, end = W + d.active;
      const prevT = a.prevT;
      a.prevT = t;
      const crit = this.critTimer > 0;
      // any overlap of this frame with the active window counts (robust to long frames)
      if (t >= W && prevT <= end + 0.04) {
        this.fx.trail(sw.pa, sw.pb, sw.a, sw.b, d.kind, crit);
        if (!a.hit && prevT <= end) this._tryHit(a);
        // the sweep's snap flares the coat tails (cosmetic: the animator's own noise, not the RNG)
        if (d.kind === 'light' && !a.flared) {
          a.flared = true;
          this.anim.kickCoat(0.32, this.anim.noise);
        }
      }
      if (d.kind === 'thrust') {
        if (!a.gust && t >= W) {
          a.gust = true; // the lunge throws a gust through the grass and a ring of dust
          const p = this.position;
          this.game.world?.gust?.(p.x + Math.sin(this.yaw) * 1.5, p.z + Math.cos(this.yaw) * 1.5, 0.4 + 0.6 * a.charge, 4 + 2 * a.charge);
          this.fx.release(p.x, p.z, a.charge);
          sw.point(1, this._tipPrev);
        }
        // the long cyan streak behind the driving point
        if (t >= W && prevT <= end + 0.02) {
          sw.point(1, this._tip);
          this.fx.thrustStreak(this._tipPrev, this._tip, a.charge, crit);
          this._tipPrev.copy(this._tip);
        }
      } else if (d.kind === 'slam' && !a.impact && t >= end - 0.02) {
        a.impact = true;
        this._slamImpact(a);
      }
    } else if (this.state === 'plunge') this._plungeTrail(sw);
    sw.commit();
  }

  /** The dive's blade trail: the swept band between frames + a long streak behind the point (the
   *  impact frame draws the last stretch into the head). */
  _plungeTrail(sw) {
    const pl = this.pl, ph = pl.phase;
    sw.point(1, this._tip);
    if (ph === PL.DIVE || (ph === PL.RIDE && pl.streak)) {
      this.fx.trail(sw.pa, sw.pb, sw.a, sw.b, 'slam', pl.exec);
      this.fx.thrustStreak(this._tipPrev, this._tip, 1, pl.exec);
      pl.streak = ph === PL.DIVE;
    } else pl.streak = false;
    this._tipPrev.copy(this._tip);
  }

  /** The slam meets the ground: crystal shards burst at the blade's point (and hit, if the blade
   *  itself missed: d.shards = { radius, height }), a gust, a heavy shake. */
  _slamImpact(a) {
    const d = a.def, g = this.game;
    this.sweep.point(1, this._tip);
    const x = this._tip.x, z = this._tip.z;
    if (!Number.isFinite(x + z)) return;
    this.fx.slamShards(x, z, this.critTimer > 0);
    this.anim.kickCoat(0.6, this.anim.noise); // the impact's blast throws the coat tails out
    g.world?.gust?.(x, z, 1.1, 4.5);
    g.shake?.(d.shake * 0.6);
    this._emit('player:slam', { x, z });
    const S = d.shards;
    if (a.hit || !S) return;
    const dr = g.dragon;
    if (!dr || typeof dr.takeHit !== 'function' || dr.state === 'dead' || dr.state === 'dying') return;
    const spheres = dr.hurtSpheres;
    if (!Array.isArray(spheres) || !spheres.length) return;
    if (bandHit(spheres, x, 0, z, x, 0, z, fin(S.radius, 1.5), fin(S.height, 3), 0, this._hit) > 0) this._applyHit(a, this._hit);
  }

  _tryHit(a) {
    if (a.exec) {
      this._executeHit(a);
      return;
    }
    const dr = this.game.dragon;
    if (!dr || typeof dr.takeHit !== 'function') return;
    if (dr.state === 'dead' || dr.state === 'dying') return;
    const spheres = dr.hurtSpheres;
    if (!Array.isArray(spheres) || !spheres.length) return;
    const h = this._hit;
    if (this.sweep.test(spheres, h, fin(a.def.up, REACH.up))) {
      this._applyHit(a, h);
      return;
    }
    // a technique's counter that the sweep missed still lands on a hurt surface in reach along the
    // facing, from mid-active (the turned blow already chose the target)
    const d = a.def;
    if (a.tech?.assist && a.t >= d.windup + d.active * 0.5) {
      const p = this.position, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), L = fin(d.reach, 2.3) + 0.4;
      if (bandHit(spheres, p.x, 1.0, p.z, p.x + fx * L, 1.25, p.z + fz * L, 0.45, REACH.up, REACH.down, h) > 0) this._applyHit(a, h);
    }
  }

  /** Deal one swing's damage at contact h {sphere, x, y, z}. */
  _applyHit(a, h) {
    const dr = this.game.dragon;
    a.hit = true; // one hit per swing

    const d = a.def, heavy = !!d.heavy;
    const part = typeof h.sphere.part === 'string' ? h.sphere.part : 'body';
    const crit = this.critTimer > 0;
    const damage = a.damage * (crit ? DEFENSE.ghostep.critMult : 1); // raw: the dragon applies part multipliers
    const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const point = { x: h.x, y: h.y, z: h.z };
    const o = { damage, part, point, dir, poise: a.poise, heavy, crit };
    const T = a.tech; // a technique's strike: its own posture, and `pierce` goes through a guard
    if (T) {
      if (Number.isFinite(T.posture)) o.posture = T.posture;
      if (T.pierce) o.pierce = true;
      o.technique = T.id;
    }
    let dealt = damage;
    try {
      const r = dr.takeHit(o);
      if (Number.isFinite(r)) dealt = r;
    } catch (err) {
      console.error('[player] dragon.takeHit failed', err);
    }
    if (!T && dealt > 0) this.gainQi(heavy ? QI.hit.heavy : QI.hit.light);
    if (T?.counter && dealt > 0) this.fx.techCounterHit?.(h.x, h.y, h.z, dir.x, dir.z);
    this._emit('player:hitDragon', { damage: dealt, part, point, heavy, crit, kind: d.kind, technique: T ? T.id : null });
    this._hitstop(d.hitstop * (crit ? 1.4 : 1));
    this.game.shake?.(d.shake * (crit ? 1.3 : 1));
    this.fx.sparks(h.x, h.y, h.z, dir.x, dir.z, heavy, crit);
  }

  // ------------------------------------------------------------------ fx / visuals
  /** A foot touches down (the gait's planner, the thrust dash's steps): `dust` (0..1, optional)
   *  kicks up a puff of its own size (the dash's bounding steps). */
  _footstep(side, dust = 0) {
    const leg = side < 0 ? this.rig.legs.R : this.rig.legs.L;
    leg.foot.getWorldPosition(this._v);
    const sprint = this.state === 'sprint';
    this._emit('player:footstep', { x: this._v.x, z: this._v.z, sprint });
    if (dust > 0) this.fx.dust(this._v.x, this._v.z, Math.round(3 + 5 * dust), 0.5 + 0.6 * dust);
    else if (sprint) this.fx.dust(this._v.x, this._v.z, 2, 0.4);
  }

  _updateFx(dt) {
    const p = this.position;
    if (this.state === 'heal') {
      const t = this.stateT;
      this.fx.healTick(dt, p.x, p.z, smoothstep(0.27, 0.5, t) * (1 - smoothstep(0.7, 0.84, t)));
    }
    if (this.healLight) {
      if (this.healLight.dead) this.healLight = null;
      else this.healLight.set?.(p.x, 1.3, p.z);
    }
    const sw = this.sweep;
    const armed = !!this.rig.loadout?.weapon; // no weapon equipped: no blade halo, no gem glow
    // the roll's sliding kneel (the root still carries 4-6 m/s through it): dust and torn grass
    // off the shin and the planted foot, cold sparks off the point dragging behind
    if (this.state === 'roll' && !this.rollBack && dt > 0) {
      const t = this.stateT, S = ROLL_SLIDE;
      const k = smoothstep(S[0] - 0.02, S[0] + 0.03, t) * (1 - smoothstep(S[1] - 0.05, S[1], t));
      const gx = this.groundVel.x, gz = this.groundVel.z, sp = Math.hypot(gx, gz);
      if (k > 0.01 && sp > 0.3) {
        const dx = gx / sp, dz = gz / sp;
        this.rig.legs.R.shin.getWorldPosition(this._v);
        this.fx.skid(dt, 0, this._v.x, this._v.z, dx, dz, sp, k);
        this.rig.legs.L.foot.getWorldPosition(this._v);
        this.fx.skid(dt, 1, this._v.x, this._v.z, dx, dz, sp, 0.55 * k);
        if (sw.valid) {
          sw.point(1, this._v);
          if (this._v.y < 0.14) this.fx.scrape(dt, this._v.x, this._v.y, this._v.z, dx, dz, sp * k);
        }
      }
    }
    // the plunge: cold motes gathering on him through the hang, embers spurting from the wound while
    // he rides the head
    const hidden = this.state === 'plunge' && this.pl.phase === PL.VANISH;
    if (this.state === 'plunge' && dt > 0) {
      const pl = this.pl;
      if (pl.phase === PL.HANG) {
        this.getChestPos(this._v, true);
        this.fx.plungeHang(dt, this._v.x, this._v.y, this._v.z);
      } else if (pl.phase === PL.RIDE && pl.hit) {
        this.fx.plungeRide(dt, pl.hitPt.x, pl.pt.y - 0.1, pl.hitPt.z, pl.dx, pl.dz, 1 - smoothstep(0.5, 1, this.plungeAnim.u));
      }
    }
    if (sw.valid) {
      if (this.state === 'charge') this.fx.chargeTick(dt, sw.a, sw.b, this.chargeK);
      else if (this.state === 'technique') this.fx.techStance?.(dt, sw.a, sw.b, p.x, p.z, this.stateT);
      else if (this.critTimer > 0 && this.alive) this.fx.critTick(dt, sw.a, sw.b);
      // the blade's dot halo: dim at idle, brighter while it glows (strikes, charge, crit)
      if (this.alive && this.object3d.visible !== false && !hidden && armed) {
        const bu = this.rig.materials.blade.uniforms;
        this.fx.bladeHalo(dt, clamp((bu.uInkGlow.value - 0.16) * 0.8, 0.25, 2), this.bladeFar);
      }
    }
    // the violet gem: an always-on glow point, idle glints, a fast flicker while charging. Every
    // gem particle moves with the hilt's own velocity (not the root's), so nothing is left behind
    // by a swing or the lunge.
    this.rig.gem.getWorldPosition(this._gem);
    const gv = this.gemVel, gp = this._gemPrev;
    if (dt > 0 && Number.isFinite(gp.x)) {
      gv.x = clamp((this._gem.x - gp.x) / dt, -30, 30);
      gv.y = clamp((this._gem.y - gp.y) / dt, -30, 30);
      gv.z = clamp((this._gem.z - gp.z) / dt, -30, 30);
    }
    gp.copy(this._gem);
    if (this.state !== 'dead' && this.object3d.visible !== false && !hidden && armed) {
      const charging = this.state === 'charge';
      this.fx.gemTick(dt, this._gem.x, this._gem.y, this._gem.z, charging ? 0.5 + this.chargeK : 0.35, gv.x, gv.z, gv.y);
      this.gemT -= dt;
      if (this.gemT <= 0) {
        this.gemT = charging ? 0.22 : TUNE.gemGlintEvery * (0.6 + 0.8 * Math.random());
        // only while the hilt is steady: a glint left behind by a fast swing floats off the gem
        if (charging || LOCO.has(this.state)) this.fx.gemGlint(this._gem.x, this._gem.y, this._gem.z, charging ? 0.5 + 0.5 * this.chargeK : 0.45, gv.x, gv.z, gv.y);
      }
    }
  }

  _updateMaterials(dt) {
    const M = this.rig.materials;
    // glyph cells follow the view distance: in-game size at the 36 m camera, a ~30-row field in
    // the Lab / showroom close-ups (hero.md §7)
    const cam = this.game.camera?.position;
    if (cam) {
      const p = this.position;
      const d = Math.hypot(cam.x - p.x, cam.y - p.y - 1.1, cam.z - p.z);
      if (Number.isFinite(d)) {
        this.viewDist = d;
        this.glyphScale = setHeroGlyphScale(this.rig.mats, d);
      }
    }
    const far = smoothstep(10, 28, this.viewDist); // 0 in close-ups … 1 at the game camera
    this.flash = Math.max(0, this.flash - dt * 6);
    const plunging = this.state === 'plunge';
    this.ghostFx = Math.max(0, this.ghostFx - dt * (plunging ? TUNE.plungeFade : TUNE.ghostepFade));
    const burnTarget = this.burnT > 0 ? 0.28 + 0.1 * Math.sin(this.time * 17) : 0;
    this.burnGlow = damp(this.burnGlow, burnTarget, 8, dt);
    // Ghostep / plunge reappear: cells resolve out of a cold dissolve, ink tinted blue-white (the
    // plunge's vanish: gone entirely until he reappears above the head)
    const gk = this.ghostFx;
    const dissolve = plunging && this.pl.phase === PL.VANISH ? 1 : smoothstep(0.55, 1, gk) * 0.85;
    // through the hang and the dive he keeps a cold cast: it parts him from the wyrm's grey scales
    const tk = plunging && (this.pl.phase === PL.HANG || this.pl.phase === PL.DIVE) ? Math.max(gk, 0.4) : gk;
    const tr = 1 + tk * 0.8, tg = 1 + tk * 1.4, tb = 1 + tk * 2.6;
    for (const m of this.rig.mats) {
      const u = m.uniforms;
      u.uFlash.value = this.flash * 0.85;
      u.uDissolve.value = dissolve;
      u.uTint.value.setRGB(tr, tg, tb);
      if (m !== M.blade && m !== M.bladeTip && m !== M.flask && m !== M.gem) u.uGlow.value = this.burnGlow;
    }
    // blade: dark faceted flats with the icy edge / ridge seams always lit (a slow shimmer),
    // flaring through every strike, rising with the charge (the thrust stays hot through its
    // follow-through) and pulsing in the crit window. At the game camera the 0.09 m blade is ~4 px
    // wide and its seams are sub-pixel, so the flats self-light more with distance: the sword stays
    // the brightest thing on the hero there, while close-ups keep dark steel with glowing edges.
    // (lean reference match: 2.3 → 1.25 × far: the self-lit blade bloomed into a halo that hid his body)
    let ink = 0.6 + 1.0 * far + 0.08 * Math.sin(this.time * 2.6), glow = 1.45 + 0.15 * Math.sin(this.time * 3.7);
    const a = this.atk, st = this.state;
    if (st === 'charge') {
      const k = this.chargeK;
      ink = 1.0 + 1.6 * k + (this.chargeFull ? 0.3 * Math.sin(this.time * 18) : 0);
      glow = 1.0 + 0.8 * k;
    } else if (st === 'technique') {
      // the counter stance: the blade held hot and quivering, waiting
      ink = 1.9 + 0.3 * Math.sin(this.time * 16);
      glow = 1.4;
    } else if (a && (st === 'attack' || st === 'heavy') && !a.pending) {
      const d = a.def, t = a.t;
      if (t >= d.windup - 0.06 && t <= d.windup + d.active + 0.12) {
        ink = d.heavy ? 2.2 : 1.6;
        glow = d.heavy ? 1.5 : 1.25;
      }
      if (d.kind === 'thrust') {
        const fade = 1 - smoothstep(d.windup + d.active, d.windup + d.active + 0.3, t);
        ink = Math.max(ink, (1.2 + 1.4 * this.releaseK) * fade);
        glow = Math.max(glow, (1.0 + 0.6 * this.releaseK) * fade);
      }
    } else if (plunging) {
      // the plunge: the blade blazes from the hang through the ride, cooling through the flip
      const ph = this.pl.phase;
      if (ph >= PL.HANG && ph <= PL.RIDE) {
        ink = ph === PL.HANG ? 1.8 + 0.3 * Math.sin(this.time * 30) : 2.6;
        glow = ph === PL.HANG ? 1.4 : 1.7;
      } else if (ph === PL.FLIP) {
        ink = Math.max(ink, 1.6);
        glow = Math.max(glow, 1.25);
      }
    }
    if (this.critTimer > 0) {
      ink = Math.max(ink, 1.3 + 0.4 * Math.sin(this.time * 14));
      glow = Math.max(glow, 1.2);
    }
    if (!this.alive) {
      ink *= 0.5;
      glow *= 0.4;
    }
    const bu = M.blade.uniforms, tu = M.bladeTip.uniforms;
    bu.uInkGlow.value = dt > 0 ? damp(bu.uInkGlow.value, ink, 18, dt) : ink;
    bu.uGlow.value = dt > 0 ? damp(bu.uGlow.value, glow, 14, dt) : glow;
    tu.uInkGlow.value = bu.uInkGlow.value + 0.3; // the point stays the brightest steel
    tu.uGlow.value = bu.uGlow.value;
    // far away the chevrons grow to fill their cells, so the ~4 px blade reads as a solid cyan line
    bu.uGlyphZoom.value = tu.uGlyphZoom.value = 0.72 - 0.26 * far;
    // … and the dark steel between them lights up too (gaps are base × light)
    bu.uBase.value.setRGB(BLADE_BASE[0] + 0.2 * far, BLADE_BASE[1] + 0.36 * far, BLADE_BASE[2] + 0.5 * far);
    this.bladeFar = far;
    // the violet gem breathes; burns brighter while charging and through heavy swings
    const heavyNow = st === 'charge' || (plunging && this.pl.phase <= PL.RIDE) || (!!a && !!a.def?.heavy && (st === 'attack' || st === 'heavy'));
    const gemTarget = (heavyNow ? 1.6 : 0.8) + 0.25 * Math.sin(this.time * 2.1) + (st === 'charge' ? 0.8 * this.chargeK : 0);
    const gu = M.gem.uniforms;
    gu.uGlow.value = dt > 0 ? damp(gu.uGlow.value, gemTarget, 10, dt) : gemTarget;
    gu.uInkGlow.value = 0.45 + 0.4 * gu.uGlow.value; // saturated violet, not blown out to white
  }

  // ------------------------------------------------------------------ debug (Lab)
  _debugHeal() {
    if (!this.alive) return false;
    this.hp = this.maxHp;
    this._clearBurn();
    return true;
  }

  _teleport(x, z) {
    x = Number(x);
    z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const p = this.position;
    if (this.state === 'plunge') this._toLoco(0.1); // a Lab teleport ends a plunge on the ground
    p.set(x, 0, z);
    this._collide();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) p.set(x, 0, z);
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.sweep.valid = false;
    this.anim.teleported();
    this.game.world?.setPusher?.(0, p.x, 0, p.z, TUNE.pusher);
    return true;
  }

  _debugKill() {
    if (!this.alive) return false;
    this.hp = 0;
    this._die();
    return true;
  }

  _emit(name, data) {
    this.game.events?.emit(name, data);
  }
}
