import * as THREE from 'three';
import { Duelist, HERO_SCALE } from '../duelist/duelist.js';
import { GUARD_KINDS } from '../duelist/guard.js';
import { DIM } from '../../player/model.js';
import { DuelBrain } from '../duelist/brain.js';
import { TELL } from '../../../combat/rules.js';
import { FS_LOADOUT, FS_FIST } from './gear.js';
import { FS_POSES } from './poses.js';
import { boostLoco } from './posesBoost.js';
import { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, REACT, OPEN, realise, HANDLERS, COUNTERS, STREAKS } from './moves.js';
import { TUNING, perPhase } from './tuning.js';
import { LINKS } from './links.js';
import { tintSaint, dressSaint, fsLettersOn, eyePoint, handPoint, partPoint } from './look.js';
import { FsFx } from './fx.js';
import { FsShell } from './shell.js';
import * as FX_DEBUG from './fxDebug.js';

// Anselm, the False Saint: the boss of the Last Foundry (`?level=foundry`). A calm man in a charcoal jacket
// whose skin is a shell over a machine's frame; on the shared duelist engine (duelist/duelist.js; the mind:
// duelist/brain.js). One bar, four phases (74 %: THE SKIN BREAKS; 46 %: WEAPONS FREE; 20 %: TRUE FRAME).
// Bare-handed: his "blade" (the engine's hilt -> tip) is the striking limb of the moment (Tian Lei's and
// Bai Wuji's way).
//
// ======================================================================= THE ROUTING CONTRACT
// This file is core's and stays as it is after wave 0: the later agents work through the objects below.
//   d.shell    (shell.js FsShell)  THE SHELL, look only: takeHit chips it where a sword cut lands
//              (shell.chip(o.point, k), then fx.shellFlake); a transition's impact sets its phase; molten
//              steel and a tank's blast strip it (onMolten / onBlast); reset() restores it.
//   d.fx       (fx.js FsFx)       every drawing (its header lists the surface; every method exists).
//   d.parts    THE MOVE HANDLERS, one per move file that exports `create(d)` (moves.js HANDLERS: d.parts.melee
//              = FsMelee (moves/melee.js), .boost = FsBoost (moves/boost.js), .arsenal = FsArsenal
//              (arsenal.js), .terrain = FsTerrain (terrain.js)). A beat is ROUTED to the handler whose file
//              lists one of the beat's own fields in its `FIELDS` (a beat with `fsLaser` goes to arsenal).
//              A move is routed to every handler one of its beats is routed to. The hooks (all optional,
//              called through `?.`; arsenal.js has the full list with arguments):
//                beat:  beatMotion(b, u, s, dt) · onImpact(b, s, a) · onRelease · onCast · onSustain(b, s, a, k)
//                       hitPlayer(o) → o (before the blow reaches the hero) · onHit(o, r) (after)
//                       onParried(info, b) → true = handled · reach(b) → m | Infinity | undefined
//                move:  weigh(name, def, w, dist) → w · onActStart(A) → false refuses
//                every handler, every frame / event: frame(dt) (brainFrame) · afterPose(dt, a) · stop()
//                       (a reaction, a break, his death) · reset() (the fight's reset) ·
//                       footwork(dt, s) → true: it moved him this frame (FsBrain._foot asks every handler,
//                       in file order, BEFORE the engine's footwork; never while a phase change waits, a
//                       counter is pending, the hero drinks, or his AI is off: the jet step) ·
//                       takeHit(o) → o | false | undefined: a cut of the hero's, asked FIRST in takeHit
//                       (false: the cut does nothing, e.g. the armoured walk turns a light cut aside; an
//                       object: the cut as changed; undefined: as it was)
//              A routed beat's onImpact adds to the engine's world blow and floor mark (they still run as
//              for any beat unless it is selfHit / cast).
//   core's own fields (handled here; moves.js header): fsMoment (a transition's impact).
//   FsBrain's own: a flurry move marked `fsNoCount` plays as authored (startStreak), not cut to the count;
//          a share of the picks made with the hero past the jet step's range wait for the step first
//          (_stepFirst: TUNING.boost.step.pick), and as many links / flow moves are let go for it (_startNext).
//   Through a phase's change (until its push ring is out) nothing lands on him (takeHit: _inChange; the
//          multi-form duelists' rule); a cut rings off him (a spark, no damage, no posture).
//   The jets' layers on his footwork pose (SAINT_POSES: posesBoost.js boostLoco reads d.pilot.fsDashK /
//          fsHoverK); the boost handler sets d.fsJets { elbowR, elbowL, back, calfR, calfL, palmR, core },
//          d.fsThrustK, d.fsCoreK every frame for the body to draw (boost.js header).
//   Poses: poses.js merges posesMelee.js (`ml` names), posesBoost.js (`bo`), posesArsenal.js (`ar`),
//          posesTerrain.js (`tr`).
//   Tuning: tuning.js merges tuningMelee / tuningBoost / tuningArsenal / tuningTerrain as TUNING.melee /
//          .boost / .arsenal / .terrain (each agent's own file).
//   The set: game.world.forest.foundry (world/lastFoundry.js): ladles, ladleNear, drop, molten.add / pools / at.
//   Damage that is no blade's: hurt(damage, posture, why) · onMolten(damage, posture, x, z) (a pool he
//          stands in: posture + strip) · onBlast(damage, posture, x, z) (a tank the hero burst beside him).
//   Debug (the Lab, the film rig): d.debug.fx(name, opts) → fxDebug.js run(d, name, opts) · fxNames · setPhase(n) ·
//          shell(k) (k: every part to at least k; none: the shell's state) · pool(x, z, r) (a molten pool
//          at x, z: the set's molten.add) · tidy().
// ======================================================================================================

/** His pose table: the body's (poses.js FS_POSES), the footwork's jet layers on top (posesBoost.js
 *  boostLoco: the jet step's lean, d.pilot.fsDashK; the rigid hover's legs, d.pilot.fsHoverK). */
const SAINT_POSES = Object.freeze({
  ...FS_POSES,
  loco: (p, A) => {
    FS_POSES.loco(p, A);
    boostLoco(p, A?.player);
  },
});

/** His feet (the tuning pass, from the V04 audit; ADR-288): a foot a key lifts while it is planted (or still being
 *  stepped by the foot planner) eases off its spot over `ease` s instead of snapping (anim.js liftEase /
 *  liftFromStep: the engine's MOTION_FIX, Wen Yao's precedent, ADR-249). Live: saint.mjs tuneFeet measures it
 *  (off / on). 0.2 s, not the engine's MOTION_FIX.liftEase 0.12: measured (the largest foot jump in a frame;
 *  the planted foot's peak slide), off / 0.12 / 0.2 / 0.3 s: benediction 0.79 / 0.32 / 0.24 / 0.36 m, 8.1 /
 *  18.9 / 11.6 / 7.5 m/s; genuflect 0.62 / 0.35 / 0.20 / 0.20 m; lauds 0.71 / 0.27 / 0.27 / 0.27 m, 7.1 / 16.1
 *  / 10.4 / 8.2 m/s (the 0.12 ease's slide was its own last jump, still near the floor). No move's timing
 *  changes (the animator's, not realise's). */
export const FS_FEET = { ease: 0.2 };

/** Everything the shared duelist needs to be him (duelist.js: kit). */
export const SAINT_KIT = Object.freeze({
  id: 'saint',
  TUNING, MOVES, MOVE_NAMES, CLIP, realise,
  maxPhase: TUNING.maxPhase,
  transitions: TRANSITIONS,
  counterMove: (phase) => COUNTERS[Math.min(COUNTERS.length, Math.max(1, phase | 0)) - 1],
  streakMove: (phase) => STREAKS[Math.min(STREAKS.length, Math.max(1, phase | 0)) - 1],
  loadout: FS_LOADOUT,
  poses: SAINT_POSES,
  blade: FS_FIST,
  scale: TUNING.scale,
  REACT, OPEN,
  animOpts: Object.freeze({ liftEase: () => FS_FEET.ease, liftFromStep: true }),
  dress: (d, dt) => dressSaint(d, dt),
  get letters() {
    return fsLettersOn();
  },
});

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const beatNow = (a) => (a ? a.beats.find((b) => a.t < b.end + 1e-6) ?? null : null);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** His mind: the duelist's; a routed beat's own reach; the handlers' footwork first. */
export class FsBrain extends DuelBrain {
  _reach(b) {
    const D = b.def;
    if (D.fsMoment) return Infinity;
    const H = this.d._handlerOf?.(D);
    const r = H?.reach?.(b);
    if (r !== undefined && r !== null && !Number.isNaN(r)) return r;
    return super._reach(b);
  }

  /** The reach watch (pressure.pursue) never breaks off a beat whose handler says it reaches wherever the
   *  hero is (reach(b) = Infinity: the dive, the passes, Last Rite), not even past his bound. */
  _outOfReach(a, b, t, s) {
    const H = this.d._handlerOf?.(b.def);
    if (H?.reach?.(b) === Infinity) return false;
    return super._outOfReach(a, b, t, s);
  }

  startReact(kind) {
    const ok = super.startReact(kind);
    if (ok) this.d._stopParts?.();
    return ok;
  }

  /** His flurry: a move marked `fsNoCount` (Rosary) plays as authored (its drawn blows, the last blue), not
   *  cut to the streak's count (realise's `count` keeps the first beat and cycles the rest: its last blow
   *  would never come). Any other flurry as the engine's. */
  startStreak(count = null) {
    const name = this._streakMove();
    if (this.K.MOVES?.[name]?.fsNoCount) return this.startAct(name, this.d.phase);
    return super.startStreak(count);
  }

  /** The jet step IN PLACE OF A PICK (the tuning pass): when a pick is due (the breather is out) and the hero
   *  stands past the step's range, a share `pick` [P1..P4] of those picks first close on the jet (FsBoost's
   *  footwork takes the breather that is left: the step runs, then the pick is made from where he lands,
   *  close). One roll per pick (`pickEvery` s at least between two). Without it the step only ever came in
   *  a breather, and in phase 4 his ranged moves took every pick at range: no step at all (saint.mjs boostStep). */
  _stepFirst(s, dt) {
    const d = this.d, S = d.T.boost?.step, B = d.parts?.boost;
    if (!S?.on || !B || B.step || d.phase < S.from || !(this.gapT <= dt) || !(B.stepCool <= 0)) return;
    if (!(s.dist > perPhase(S.at, d.phase)) || this.clock < fin(this._stepRollT, -1)) return;
    this._stepRollT = this.clock + fin(S.pickEvery, 0.6);
    if (Math.random() < perPhase(S.pick ?? 0, d.phase)) this.gapT = dt * 2;
  }

  /** ... and in place of a link or the flow's next move (the tuning pass): with the hero past the step's
   *  range and the step ready, the same share `pick` of them is let go (the move ends on its own, its
   *  breather follows and the step takes it), unless the next move closes the distance itself (a gap
   *  closer: the punch, the dive, the passes). In phase 4 he flowed from move to move and was hardly ever
   *  in his footwork: 1 step in 16 s against a hero who kept 10 m off (saint.mjs boostStep). */
  _startNext(a, N, s, cut) {
    const d = this.d, S = d.T.boost?.step, B = d.parts?.boost;
    if (s && S?.on && B && !B.step && d.phase >= S.from && B.stepCool <= 0 && s.dist > perPhase(S.at, d.phase) && !(N?.to && this.M[N.to]?.gapCloser)) {
      if (Math.random() < perPhase(S.pick ?? 0, d.phase)) return false;
    }
    return super._startNext(a, N, s, cut);
  }

  /** Footwork: every handler's footwork(dt, s) first (the jet step), then the engine's. */
  _foot(dt) {
    const d = this.d;
    if (this.aiEnabled && !(this.pendingPhase > d.phase) && !this.counter?.pending && d.game.player?.state !== 'heal') {
      const s = this._sense();
      if (s) {
        this._stepFirst(s, dt);
        for (const { h } of d._partList ?? []) {
          let moved = false;
          try {
            moved = h.footwork?.(dt, s) === true;
          } catch (err) {
            console.error('[saint] handler footwork', err);
          }
          if (moved) return;
        }
      }
    }
    super._foot(dt);
  }
}

export class FalseSaint extends Duelist {
  constructor(game) {
    super(game, SAINT_KIT);
  }

  // ---------------------------------------------------------------- the engine's hooks
  _makeFx() {
    return new FsFx(this);
  }
  _makeBrain() {
    return new FsBrain(this);
  }
  _tint(M) {
    tintSaint(M);
  }

  /** Before his rig is batched: his shell, the move handlers, the Lab's API. */
  _setup() {
    this.shell = new FsShell(this);
    this.parts = {};
    this._partList = [];
    for (const H of HANDLERS) {
      try {
        const h = H.create(this);
        if (h) {
          this.parts[H.name] = h;
          this._partList.push({ h, fields: H.fields });
        }
      } catch (err) {
        console.error(`[saint] the ${H.name} handler failed to build`, err);
      }
    }
    this.dressPhase = 1;
    this._part = 'fistR';
    this._partPrev = '';
    this._ptsOk = false;
    this._cut = { x: 0, z: 0 };
    const dbg = this.debug, d = this;
    const fight = () => {
      if (d.mode === 'sleep' || d.mode === 'intro') d.brain.startFight();
    };
    dbg.fx = (name, opts) => {
      try {
        return FX_DEBUG.run?.(d, name, opts) ?? false;
      } catch (err) {
        console.error('[saint] fxDebug', err);
        return false;
      }
    };
    /** The effect drivers debug.fx knows (the Lab's buttons). */
    dbg.fxNames = FX_DEBUG.NAMES ?? [];
    /** Into phase n through its real transition(s), one after another (each needs the one before over). */
    dbg.setPhase = (n) => {
      fight();
      const want = Math.max(1, Math.min(TUNING.maxPhase, Math.round(fin(Number(n), 1))));
      if (want <= d.phase) return d.phase === want;
      return d.brain.forcePhase(d.phase + 1);
    };
    dbg.shell = (k) => (Number.isFinite(Number(k)) && k !== null && k !== undefined ? d.shell.force(Number(k)) : d.shell.state());
    dbg.pool = (x, z, r = 2) => {
      const p = d.game.player?.position;
      return d.game.world?.forest?.foundry?.molten?.add?.(fin(x, p?.x ?? 0), fin(z, p?.z ?? 0), { r: fin(r, 2), why: 'debug' }) ?? null;
    };
    dbg.tidy = () => {
      d._stopParts();
      if (d.mode === 'foot' || d.mode === 'sleep') d.position.set(0, 0, 0);
    };
  }

  reset() {
    if (this.shell) {
      this.shell.reset();
      for (const { h } of this._partList) {
        try {
          h.reset?.();
        } catch (err) {
          console.error('[saint] handler reset', err);
        }
      }
      this.dressPhase = 1;
      this._ptsOk = false;
      this._partPrev = '';
      // (the set's hazards: the ladles full and hung again, the pools gone; its light back to phase 1)
      try {
        this.game.world?.forest?.foundry?.reset?.();
      } catch (err) {
        console.error('[saint] foundry reset', err);
      }
    }
    super.reset();
  }

  get LINKS() {
    return LINKS;
  }

  // ---------------------------------------------------------------- the routing
  /** The handler a beat def is routed to (its first field a handler's FIELDS lists), or null. */
  _handlerOf(D) {
    if (!D || !this._partList?.length) return null;
    const M = (this._fieldOf ??= new Map());
    if (M.has(D)) return M.get(D);
    let out = null;
    for (const { h, fields } of this._partList) {
      if (fields.some((f) => D[f] !== undefined)) {
        out = h;
        break;
      }
    }
    M.set(D, out);
    return out;
  }
  /** The handlers a move is routed to (any of its beats'). */
  _handlersOfMove(def) {
    const out = [];
    for (const b of def?.beats ?? []) {
      const alts = Array.isArray(b.pick) ? b.pick : [b];
      for (const x of alts) {
        const h = this._handlerOf(x);
        if (h && !out.includes(h)) out.push(h);
      }
    }
    return out;
  }
  _each(fn) {
    for (const { h } of this._partList ?? []) {
      try {
        fn(h);
      } catch (err) {
        console.error('[saint] handler', err);
      }
    }
  }
  /** Every handler stops what it holds (a reaction, a break, the death). */
  _stopParts() {
    this._each((h) => h.stop?.());
  }

  /** His AI weighs a move: the handlers its beats are routed to have their say. */
  weigh(name, def, w, dist) {
    for (const h of this._handlersOfMove(def)) {
      if (!(w > 0)) return 0;
      w = fin(h.weigh?.(name, def, w, dist), w);
    }
    return w;
  }

  onActStart(A) {
    for (const h of this._handlersOfMove(A.def)) if (h.onActStart?.(A) === false) return false;
    return true;
  }

  // ---------------------------------------------------------------- every beat's own motion
  beatMotion(b, u, s, dt) {
    const D = b.def;
    if (D.fsMoment && this.mode === 'act') this.fx.transition?.(D.fsMoment, Math.min(1, Math.max(0, fin(u))));
    this._handlerOf(D)?.beatMotion?.(b, u, s, dt);
  }

  onImpact(b, s, a) {
    const D = b.def;
    if (a?.def?.transition && D.fsMoment) {
      this._moment(D.fsMoment);
      return;
    }
    this._handlerOf(D)?.onImpact?.(b, s, a);
  }

  /** A transition's impact: the shell's phase, his dress, the light, a push ring that throws the nearest
   *  pieces down (the push on the hero is the beat's own ring). */
  _moment(n) {
    const W = this.game.world, T = this.T.transition;
    this.dressPhase = n;
    this.shell.setPhase(n);
    // (the change burns shell off: a little more than the floor, inside the new limit)
    this.shell.strip(0.05);
    const F = W?.forest;
    F?.setPhase?.(n);
    F?.ambience?.flare?.(1);
    const o = (this._wbo ??= { kind: 'blast', by: 'boss', dx: NaN, dz: NaN, y: 1, src: -1, scar: true });
    o.src = W?.destructibles?.swing?.() ?? -1;
    // (the terrain handler owns the change's world blow by phase: P2 a small shock, P3 the lift's ring, P4 the
    // core vent's nova; without it, the core's full ring at every change)
    if (!this.parts?.terrain?.onMoment?.(n)) W?.impact?.(this.position.x, this.position.z, T.ringRadius + 1, T.power, o);
    this.fx.transitionBurst?.(n, this.position.x, this.position.z, T.ringRadius);
    this.fx.shellStrip?.(this.position.x, 1.3, this.position.z, 1);
    this.game.shake?.(0.5);
  }

  onRelease(b, s, a) {
    this._handlerOf(b.def)?.onRelease?.(b, s, a);
  }
  onCast(b, s, a) {
    this._handlerOf(b.def)?.onCast?.(b, s, a);
  }
  onSustain(b, s, a, k) {
    this._handlerOf(b.def)?.onSustain?.(b, s, a, k);
  }

  /** Every frame after the brain: the handlers. */
  brainFrame(dt) {
    this._each((h) => h.frame?.(dt));
  }

  /** After the pose: his sensors, the trail off the striking limb through a blow, the stars of a break. */
  afterPose(dt, a) {
    const fx = this.fx;
    if (this.mode !== 'dead' && this.dressPhase >= 2) fx.sensor?.(this.mode === 'dying' ? 0 : 1);
    if (a && this._tipOk && !this.shuddering && !a.def.transition) {
      for (const b of a.beats) {
        if (b.feint || a.t < b.impact - 0.32 * b.W - 0.02 || a.t > b.impact + 1.6 * b.A + 0.05) continue;
        const D = b.def, heavy = D.tell === TELL.RED || D.tell === TELL.BLACK || !!D.knockdown;
        fx.limbTrail?.(this._tipPrev.x, this._tipPrev.y, this._tipPrev.z, this._tip.x, this._tip.y, this._tip.z, Math.min(3, this.phase), heavy);
        break;
      }
    }
    if (this.mode === 'broken') fx.stunStars(this._hs[0]);
    this._each((h) => h.afterPose?.(dt, a));
  }

  // ---------------------------------------------------------------- the hero's blade on him
  /** A cut of the hero's: the handlers first (false: it does nothing), the engine's, then the shell. */
  takeHit(o = {}) {
    // (through a phase's change, until its push ring goes out, nothing lands on him: the multi-form
    // duelists' rule (Tian Lei, the Starless Lord, Xin Yi: `_changing`); the hero's blade rings off him)
    if (this._inChange()) {
      if (Number(o?.damage) > 0 && !o.exact) this._turned(o);
      return 0;
    }
    for (const { h } of this._partList ?? []) {
      let r;
      try {
        r = h.takeHit?.(o);
      } catch (err) {
        console.error('[saint] handler takeHit', err);
      }
      if (r === false) return 0;
      if (r && typeof r === 'object') o = r;
    }
    const dmg = super.takeHit(o);
    if (dmg > 0) this._chip(o);
    return dmg;
  }

  /** In a phase's change, before its ring has gone out (its impact's active frames): he cannot be hurt. */
  _inChange() {
    const a = this.brain?.act;
    if (this.mode !== 'act' || !a?.def?.transition) return false;
    const b = a.beats[0];
    return !b || a.t < b.impact + b.A;
  }

  /** A cut turned aside by the change: a spark where it met him, a jolt, no damage, no posture. */
  _turned(o) {
    const pt = o?.point;
    const x = Number.isFinite(pt?.x) ? pt.x : this.position.x, y = Number.isFinite(pt?.y) ? pt.y : 1.2, z = Number.isFinite(pt?.z) ? pt.z : this.position.z;
    try {
      this.fx.guard?.(x, y, z, { heavy: !!o.heavy, deflect: false });
    } catch (err) {
      console.error('[saint] turned', err);
    }
    this.hitstop(0.05, 0.05);
    this.jolt = Math.max(this.jolt, 0.2);
  }

  /** A cut landed: the shell chips where it landed (a sword's cut; a heavy one more). */
  _chip(o) {
    const S = this.T.fsShell, sh = this.shell;
    if (!sh || this.mode === 'dead') return;
    const k = fin(S.perCut, 0.1) * (o?.heavy ? fin(S.heavyK, 1.5) : 1);
    const pt = o?.point && Number.isFinite(o.point.x + o.point.y + o.point.z) ? o.point : null;
    const took = sh.chip(pt, k);
    if (took > 0) {
      const c = this._cut;
      c.x = fin(o?.dir?.x, 0);
      c.z = fin(o?.dir?.z, 0);
      this.fx.shellFlake?.(sh.last, c, took);
    }
  }

  /** Damage that is no blade's (a returned bolt, a tank's blast, molten steel): `posture` added. */
  hurt(damage, posture = 0, why = '') {
    if (this.mode === 'dying' || this.mode === 'dead' || !(damage > 0)) return 0;
    if (this.mode === 'sleep') this.startIntro();
    const dmg = Math.max(1, Math.round(damage));
    this._applyDamage(dmg);
    this.flash = 1;
    this.jolt = Math.max(this.jolt, 1);
    this.emit('dragon:hurt', { damage: dmg, part: 'body', hp: this.hp, crit: true, why });
    if (this.hp <= 0) {
      this._onHpZero();
      return dmg;
    }
    if (posture > 0) this.addPosture(posture);
    return dmg;
  }

  /** Molten steel where he stands (terrain.js: a pool of the set's): damage, posture, his shell stripped. */
  onMolten(damage, posture, x, z) {
    const dealt = this.hurt(damage, posture, 'molten');
    if (dealt > 0 && this.mode !== 'dying' && this.mode !== 'dead') {
      _a.set(fin(x, this.position.x), 0.3, fin(z, this.position.z));
      const took = this.shell.strip(fin(this.T.terrain?.molten?.strip, 0.05), _a);
      if (took > 0) this.fx.shellStrip?.(_a.x, 0.4, _a.z, took);
      // (staggered once per `molten.staggerEvery` s (2.5): a pool's every burn re-staggering him kept him
      // reeling in it 8 s (measured, saint.mjs boostPace); between, his footwork takes him out of it)
      const every = fin(this.T.terrain?.molten?.staggerEvery, 2.5);
      if (!this.broken && this.mode !== 'act' && !(this.time - fin(this._moltenT, -99) < every)) {
        this._moltenT = this.time;
        this.brain.startReact('stagger');
      }
    }
    return dealt;
  }

  /** A blast the hero caused beside him (a gas tank of the set's): Halcyon's precedent. */
  onBlast(damage, posture, x, z) {
    const dealt = this.hurt(damage, posture, 'blast');
    if (dealt > 0 && this.mode !== 'dying' && this.mode !== 'dead') {
      _a.set(fin(x, this.position.x), 1.0, fin(z, this.position.z));
      this.shell.strip(0.04, _a);
      if (!this.broken && this.mode !== 'act') this.brain.startReact('stagger');
    }
    return dealt;
  }

  // ---------------------------------------------------------------- his blows
  /** A blow at the hero: the handler's, then the engine's, then the handler's answer. */
  hitPlayer(o) {
    const D = o?.beat?.def, H = this._handlerOf(D);
    if (H?.hitPlayer) o = H.hitPlayer(o) ?? o;
    const r = super.hitPlayer(o);
    H?.onHit?.(o, r);
    return r;
  }

  /** A parried blow: a routed beat's handler first (true: handled), else the engine's. */
  onParried(info = {}) {
    const b = this.brain.act?.striking ?? null;
    const H = this._handlerOf(b?.def);
    if (H?.onParried?.(info, b) === true) return;
    super.onParried(info);
  }

  // ---------------------------------------------------------------- the body's points (the body contract)
  eyePoint(out) {
    return eyePoint(this, out);
  }
  handPoint(side, out) {
    return handPoint(this, side, out);
  }
  partPoint(name, out) {
    return partPoint(this, name, out);
  }

  // ---------------------------------------------------------------- his limbs (bare hands)
  _strikePart() {
    const br = this.brain;
    if (this.mode === 'act') {
      const b = beatNow(br.act);
      if (b && !br.act.def.transition) return b.def.part === 'eyes' ? 'fistR' : b.def.part ?? 'fistR';
    } else if (this.mode === 'react' && GUARD_KINDS.has(br.react?.kind)) return br.react.kind === 'wardR' ? 'fistR' : 'fistL';
    return 'fistR';
  }

  _limbSeg(part, a, b) {
    const r = this.rig, A = r.arms, L = r.legs;
    const at = (j, v) => v.setFromMatrixPosition(j.matrixWorld);
    switch (part) {
      case 'fistL':
        at(A.L.fore, a);
        b.set(0, -DIM.foreArm - 0.06, 0).applyMatrix4(A.L.fore.matrixWorld);
        break;
      case 'elbowR':
      case 'elbowL': {
        const S = A[part === 'elbowR' ? 'R' : 'L'];
        at(S.upper, a);
        at(S.fore, b);
        break;
      }
      case 'footR':
      case 'footL': {
        const S = L[part === 'footR' ? 'R' : 'L'];
        at(S.shin, a);
        at(S.foot, b);
        break;
      }
      case 'kneeR':
      case 'kneeL': {
        const S = L[part === 'kneeR' ? 'R' : 'L'];
        at(S.thigh, a);
        at(S.shin, b);
        break;
      }
      case 'feet':
        a.set(this.position.x, this.position.y + 0.25, this.position.z);
        b.set(this.position.x, this.position.y + 0.6, this.position.z);
        break;
      default: {
        at(A.R.fore, a);
        at(r.sword, b);
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz) || 1;
        b.x += (dx / l) * 0.05;
        b.y += (dy / l) * 0.05;
        b.z += (dz / l) * 0.05;
      }
    }
    return b;
  }

  /** Where a beat's cue pops: the striking limb's end; 'eyes' his eye; 'palms' between his hands; any
   *  name partPoint knows (a booster, the core ...) there. */
  tellPoint(part, out) {
    if (part === 'eyes') return this.eyePoint(out);
    if (!this._ptsOk) return super.tellPoint(part === 'feet' ? 'feet' : 'tip', out);
    if (part === 'palms') {
      this._limbSeg('fistR', _a, out);
      this._limbSeg('fistL', _a, _b);
      return out.set((out.x + _b.x) * 0.5, (out.y + _b.y) * 0.5, (out.z + _b.z) * 0.5);
    }
    if (part === 'feet') return out.set(this.position.x, this.position.y + 0.6, this.position.z);
    if (part === 'core' || part === 'mortar' || part === 'back' || part === 'shoulderR' || part === 'shoulderL') return this.partPoint(part, out);
    this._limbSeg(part ?? 'fistR', _a, out);
    if (!Number.isFinite(out.x + out.y + out.z)) out.set(this.position.x, 1.3, this.position.z);
    return out;
  }

  _drawnPoints() {
    this._tipPrev.copy(this._tip);
    this._hiltPrev.copy(this._hilt);
    const part = this._strikePart();
    this._part = part;
    this._limbSeg(part, this._hilt, this._tip);
    const ok = Number.isFinite(this._tip.x + this._tip.y + this._tip.z) && Number.isFinite(this._hilt.x + this._hilt.y + this._hilt.z);
    if (!ok || !this._tipOk || part !== this._partPrev) {
      this._tipPrev.copy(this._tip);
      this._hiltPrev.copy(this._hilt);
    }
    this._partPrev = part;
    this._tipOk = ok;
    this._ptsOk = ok;
  }

  _poseAt(t) {
    super._poseAt(t);
    this._limbSeg(this._part ?? 'fistR', this._hilt, this._tip);
  }

  /** The kill: every handler stops. */
  _die() {
    this._stopParts?.();
    super._die();
  }
}

export { HERO_SCALE };
