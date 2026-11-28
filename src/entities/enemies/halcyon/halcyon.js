import * as THREE from 'three';
import { Duelist, HERO_SCALE } from '../duelist/duelist.js';
import { GUARD_KINDS } from '../duelist/guard.js';
import { DIM } from '../../player/model.js';
import { DuelBrain } from '../duelist/brain.js';
import { TELL, RESULT, POSTURE } from '../../../combat/rules.js';
import { wrapAngle } from '../../../core/math.js';
import { HAL_LOADOUT, HAL_FIST } from './gear.js';
import { HAL_POSES } from './poses.js';
import { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, AFTER, REACT, OPEN, realise } from './moves.js';
import { halMotionOn, halLimbsOn } from './motion.js';
import { TUNING } from './tuning.js';
import { LINKS } from './links.js';
import { tintHalcyon, dressHalcyon, halLettersOn } from './look.js';
import { HalFx } from './fx.js';
import { Glare } from './glare.js';
import { Flight } from './flight.js';
import { Terrain } from './terrain.js';

// Halcyon, the Last Saviour: the boss of Halcyon Plaza (`?level=city`; ADR-160). An evil flying strongman
// from a future that has not happened yet, in a caped armoured suit, on the shared duelist engine
// (duelist/duelist.js: the body, the contract, the guard, posture, the duel's moments; brain.js: the
// mind and timeline). One health bar, three phases (66 %: THE SMILE DROPS, the screens turn his crimson;
// 33 %: NO ONE IS WATCHING, the city goes dark). There is no special rule: it is a straight duel, and its
// reward loop is that the hero's answers put him through his own city. What only he does:
//   - FLIGHT (flight.js): he hovers within sword reach between moves and leaves reach only inside a move
//     that brings him back; the pass; THE CRASH (a parried flying blow, a perfectly dodged red one: into
//     the first cover on his deflected line, buried there); the carry (See the World).
//   - HIS EYES (glare.js): The Stare (blue; a perfect parry sends it back into his eyes), Red Glare (red,
//     lit at the cue), Scorched Avenue, the moments' beams.
//   - THE CITY (terrain.js): a car thrown, a tower top burst through or carried and dropped, his own
//     statue's arm torn off and swung; the cars explode (world/halcyonPlaza.js).
//   - THE MOMENTS (here): the entrance, the statue's head (glare.js), the smile drops, no one is watching,
//     the kill.
// He is bare-handed: his "blade" (the engine's hilt → tip) is the striking limb of the moment, as Tian
// Lei's and the Fox's are; 'eyes' is a part of his for the beams' cues.

/** Everything the shared duelist needs to be him (duelist.js: kit). */
export const HALCYON_KIT = Object.freeze({
  id: 'halcyon',
  TUNING, MOVES, MOVE_NAMES, CLIP, realise,
  transitions: TRANSITIONS,
  counterMove: () => 'riposte',
  streakMove: () => 'streakFlurry',
  loadout: HAL_LOADOUT,
  poses: HAL_POSES,
  blade: HAL_FIST,
  scale: TUNING.scale,
  REACT, OPEN,
  dress: (d, dt) => dressHalcyon(d, dt),
  // his ink-line letters follow his size on screen as the hero's do (ARCHITECTURE "The bosses'
  // letters"; `?halLetters=0` the fixed cell; read live, ADR-166)
  get letters() {
    return halLettersOn();
  },
});

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const beatNow = (a) => (a ? a.beats.find((b) => a.t < b.end + 1e-6) ?? null : null);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** His mind: the duelist's, with flight in it (a hover is no fall; a flying blow reaches the hero). */
export class HalcyonBrain extends DuelBrain {
  /** A beat that flies to the hero (a pass, the tower, a blink, the eyes) reaches wherever he is. */
  _reach(b) {
    const D = b.def;
    if (D.halPass || D.halTower || D.halBlink || D.halGlare || D.halSky || D.halCurb || D.halArm) return Infinity;
    return super._reach(b);
  }

  /** Into footwork, or a reaction that leaves him standing: he hovers (no fall). */
  _toFoot(gap = null) {
    super._toFoot(gap);
    this.falling = false;
  }

  startReact(kind) {
    const ok = super.startReact(kind);
    if (ok && !this.open.has(kind)) this.falling = false;
    if (ok) this.d.terrain?.drop?.();
    return ok;
  }
}

export class Halcyon extends Duelist {
  constructor(game) {
    super(game, HALCYON_KIT);
  }

  // ---------------------------------------------------------------- the engine's hooks
  _makeFx() {
    return new HalFx(this);
  }
  _makeBrain() {
    return new HalcyonBrain(this);
  }
  _tint(M) {
    tintHalcyon(M);
  }

  /** Before his rig is batched: his systems (no meshes) and the Lab's API. */
  _setup() {
    this.glare = new Glare(this);
    this.flight = new Flight(this);
    this.terrain = new Terrain(this);
    this.eyesK = 0;
    this.dressPhase = 1;
    this._part = 'fistR';
    this._partPrev = '';
    this._ptsOk = false;
    const dbg = this.debug, d = this;
    const fight = () => {
      if (d.mode === 'sleep' || d.mode === 'intro') d.brain.startFight();
    };
    dbg.pass = () => {
      fight();
      return d.brain.trigger(d.phase >= 3 ? 'flyBy3' : d.phase >= 2 ? 'flyBy2' : 'flyBy');
    };
    dbg.tower = () => {
      fight();
      return d.brain.startAct('throughTower');
    };
    dbg.fallingSky = () => {
      fight();
      return d.brain.startAct('fallingSky');
    };
    dbg.statue = () => {
      fight();
      return d.brain.startAct('monument');
    };
    dbg.carry = () => {
      fight();
      return d.brain.startAct('seeTheWorld');
    };
    dbg.explode = (n = 1) => {
      const W = d.game.world?.destructibles, p = d.game.player?.position;
      if (!W?.list || !p) return 0;
      const cars = W.list.filter((b) => b.kind === 'car' && b.state === 0).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      let k = 0;
      for (const c of cars.slice(0, Math.max(1, n | 0))) {
        W.strike(c.x, c.z, 0.4, 50, { kind: 'blunt', by: 'player', y: 0.8, src: W.swing() });
        k++;
      }
      return k;
    };
    dbg.cityPhase = (n) => d.game.world?.forest?.setPhase?.(n) ?? 0;
    dbg.crash = () => d.flight.crash(Math.sin(d.yaw), Math.cos(d.yaw), 'debug');
    // (Training, between situations: nothing held, no carry; back over the middle of the plaza, clear
    // of the cars and the screens, so a beam's situation is not stopped by cover the last one left him by)
    dbg.tidy = () => {
      d.flight.stop();
      d.terrain.drop();
      if (d.mode === 'foot' || d.mode === 'sleep') d.position.set(0, d.position.y, 0);
    };
  }

  reset() {
    if (this.glare) {
      this.glare.reset();
      this.flight.reset();
      this.terrain.reset();
      this.eyesK = 0;
      this.dressPhase = 1;
      this._ptsOk = false;
      this._partPrev = '';
    }
    super.reset();
    this.position.y = 6; // asleep he hovers high over the plaza, arms folded
    this.game.world?.forest?.setPhase?.(1);
  }

  get LINKS() {
    return LINKS;
  }

  /** Move by (dx, dz) against the world and his bound, his height kept (he flies). */
  moveBy(dx, dz) {
    const y = this.position.y;
    super.moveBy(dx, dz);
    this.position.y = y;
  }

  /** Damage that is no blade's (a returned beam, a crash, a blast of the hero's): `posture` added. */
  hurt(damage, posture = 0, why = '') {
    if (this.mode === 'dying' || this.mode === 'dead' || !(damage > 0)) return 0;
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

  /** A car's blast the hero caused, beside him (world/halcyonPlaza.js). */
  onBlast(damage, posture, x, z) {
    if (this.mode === 'sleep') this.startIntro();
    const dealt = this.hurt(damage, posture, 'blast');
    if (dealt > 0 && this.mode !== 'dying' && this.mode !== 'dead' && !this.broken && this.mode !== 'act') this.brain.startReact('stagger');
    void x;
    void z;
    return dealt;
  }

  /** His AI weighs a move: the tower moves need a standing top, the grab a hero on his feet, the eyes no
   *  beam lit, Curbside and Monument a piece in reach. */
  weigh(name, def, w) {
    // (the snap blows come with his reworked motion: ADR-225, `?halMotion=a`)
    if (def.snap && !halMotionOn()) return 0;
    if (def.once || def.beats.some((b) => b.halCurb || b.halArm)) w = this.terrain.weigh(def, w);
    if (!(w > 0)) return 0;
    const pl = this.game.player;
    if (def.beats.some((b) => b.halGrab) && (pl?.state === 'knockdown' || pl?.state === 'heal')) return 0;
    if (def.beats.some((b) => b.halGlare) && this.glare.busy) return 0;
    if (this.terrain.busy && def.beats.some((b) => b.halCurb || b.halArm)) return 0;
    return w;
  }

  /** A move starts: its piece of the city chosen, a beam move not over a lit one, a transition's light. */
  onActStart(A) {
    const def = A.def;
    if (def.beats.some((b) => b.halGlare) && !this.glare.begin(A)) return false;
    if (def.once || def.beats.some((b) => b.halCurb || b.halArm || b.halSky || b.halTower)) {
      if (this.terrain.begin(A) === false) return false;
    }
    if (def.transition) {
      this.terrain.drop();
      this.flight.stop();
      const n = def.phase ?? 2;
      // the smile drops: every screen cuts to static, then stands crimson
      if (n === 2) this.game.world?.forest?.setPhase?.(2);
      A._moment = { n, burned: 0, wild: false };
    }
    return true;
  }

  /** A transition is over: Through the Tower at once (phase 2), The Falling Sky (phase 3). */
  onTransitionEnd(a) {
    const next = AFTER[a?.name];
    if (!next) return;
    const def = MOVES[next];
    if (this.weigh(next, def, 1) > 0) this.brain.startAct(next);
  }

  /** The terrain moves move him themselves (flight.js reads it). */
  terrainOwns() {
    return this.terrain.owns();
  }

  // ---------------------------------------------------------------- every beat's own motion
  beatMotion(b, u, s, dt) {
    const D = b.def;
    if (D.halPass === 'back') this.flight.back(b, u, s, dt);
    else if (D.halPass === 'go') this.flight.go(b, u, s, dt);
    if (D.halBlink && !b._blinked && u >= (D.halBlink.slow ? 0.45 : 0.12) && s) {
      b._blinked = true;
      const pl = this.game.player, K = D.halBlink;
      const yaw = fin(pl?.yaw, wrapAngle(s.ang + Math.PI)) + K.at, r = fin(K.r, 2.2);
      let tx = s.p.x + Math.sin(yaw) * r, tz = s.p.z + Math.cos(yaw) * r;
      if (!this.standable(tx, tz)) {
        tx = s.p.x - Math.sin(yaw) * r;
        tz = s.p.z - Math.cos(yaw) * r;
      }
      this.blinkTo(tx, tz, s.p);
    }
    if (D.halGlare) this.glare.motion(b, u, s, dt);
    if (D.halCurb || D.halTower || D.halSky || D.halArm) this.terrain.motion(b, u, s, dt);
    if (D.halMoment) this._moment(b, u, s, dt);
  }

  /** He is gone from where he stands and at (tx, tz), facing `face`. */
  blinkTo(tx, tz, face) {
    const x0 = this.position.x, z0 = this.position.z;
    this.fx.afterimage?.(this, 0, 0, 0.45);
    this.position.x = tx;
    this.position.z = tz;
    this.moveBy(0, 0);
    if (face && Number.isFinite(face.x + face.z)) this.yaw = Math.atan2(face.x - this.position.x, face.z - this.position.z);
    this.object3d.rotation.y = this.yaw;
    this.anim.teleported?.();
    this.fx.vanish?.(this, x0, z0, this.position.x, this.position.z, 1);
  }

  /** The transitions' scripted moments (through the windup of their ring). */
  _moment(b, u, s, dt) {
    const M = this.brain.act?._moment;
    if (!M) return;
    const set = this.game.world?.forest;
    if (M.n === 2) {
      // up from the knee, he screams; his eyes fire wild: one full turn over the hero's head
      if (u >= 0.62 && !M.wild) {
        M.wild = true;
        this.glare.wild();
        this.game.shake?.(0.4);
        this.emit('dragon:roar', { strength: 1 });
      }
      if (u >= 0.5) this.eyesK = 1;
    } else {
      // he burns out every screen still standing, one short beam each; the neon dies
      const screens = set?.screens ?? [];
      const W = this.game.world?.destructibles;
      const at = [0.3, 0.42, 0.54, 0.66];
      if (M.burned < at.length && u >= at[M.burned] && !this.glare.busy) {
        const e = screens.find((sc) => {
          const pc = W?.list?.find?.((x) => x.def === sc.def);
          return pc && pc.state === 0 && !sc._burnt;
        });
        if (e) {
          e._burnt = true;
          this.glare.burn(e.x, e.y0 + e.h * 0.6, e.z);
          this.yaw = Math.atan2(e.x - this.position.x, e.z - this.position.z);
        }
        M.burned++;
      }
      if (u >= 0.8 && !M.dark) {
        M.dark = true;
        set?.setPhase?.(3);
      }
      this.eyesK = Math.max(this.eyesK, 0.8);
    }
    void s;
    void dt;
  }

  onImpact(b, s, a) {
    const D = b.def, W = this.game.world;
    if (a?.def?.transition) {
      const n = a.def.phase ?? 2;
      this.dressPhase = n; // (phase 3: the cape in tatters from here)
      if (n === 3) W?.forest?.setPhase?.(3);
      for (const sc of W?.forest?.screens ?? []) sc._burnt = false;
      this.fx.crater?.(this.position.x, this.position.z, 3.4, 1.4);
      this.fx.shock?.(this.position.x, this.position.z, this.T.transition.ringRadius, this.fx._opt(1.2, 0.1, 'void', 0, true));
      this.game.shake?.(0.5);
      return;
    }
    if (D.halGlare) this.glare.onImpact(b, s, a);
    if (D.halSky || D.halArm) this.terrain.onImpact(b, s, a);
    const o = (this._wbo ??= { kind: 'blunt', by: 'boss', dx: NaN, dz: NaN, y: 1, src: -1, scar: true });
    o.src = W?.destructibles?.swing?.() ?? -1;
    if (D.halClap) {
      // the clap's ring of force: glass goes, cars are shoved, across the plaza
      const C = this.T.clap;
      o.kind = 'blunt';
      o.y = 1.2;
      W?.destructibles?.strike?.(this.position.x, this.position.z, C.r + 2, C.power, o);
      // (ADR-254, `?halShock=a|b`: the redrawn front, fxShock.js; '0' the engine's dust front)
      if (!this.fx.shockwave?.(this.position.x, this.position.z, C.r, this.position.y + 1.2)) {
        this.fx.shock?.(this.position.x, this.position.z, C.r, this.fx._opt(1.1, 0, 'dust', 0, true));
        this.fx.sonic?.(this.position.x, 1.3, this.position.z, Math.sin(this.yaw), Math.cos(this.yaw));
      }
      this.game.shake?.(0.45);
      this.emit('dragon:clap', { x: this.position.x, z: this.position.z, r: C.r });
    } else if (D.halDive) {
      const M = this.T.meteor;
      o.kind = 'blast';
      W?.impact?.(this.position.x, this.position.z, M.crater, M.power, o);
      this.fx.crater?.(this.position.x, this.position.z, M.crater, 1.8);
      this.fx.shockwave?.(this.position.x, this.position.z, M.crater * 1.8, 0.5, true);
      this.game.shake?.(0.6);
    }
  }

  onCast(b, s, a) {
    this.terrain.onCast(b, s, a);
  }

  onSustain() {}

  /** Every frame after the brain: his eyes, his city, then his flight (the hover last). */
  brainFrame(dt) {
    // (ADR-225, `?halMotion=a`: his arms open at the end of a blow, his kicks keep a little bend; live)
    // (ADR-254, `?halMotion=b`: opened further, and a kick's foot carried out to a straight leg)
    if (this.anim) {
      const on = halMotionOn(), B = halLimbsOn() ? this.T.motion.b : null;
      this.anim.armSoft = B?.armSoft ?? (on ? this.T.motion.armSoft : null);
      this.anim.legSoft = B?.legSoft ?? (on ? this.T.motion.legSoft : null);
      // (only through a kick: a flier's trailing legs are off the floor too, and it would lock them straight)
      const b = B && this.mode === 'act' ? beatNow(this.brain.act) : null;
      this.anim.kickStretch = b?.def?.mo?.fam === 'kick' ? B.kickStretch : null;
    }
    this.glare.frame(dt);
    this.terrain.frame(dt);
    this.flight.frame(dt);
    this.pilot.armsK = (this.pilot.armsK ?? 1) + ((this.phase <= 1 ? 1 : 0) - (this.pilot.armsK ?? 1)) * Math.min(1, dt * 3);
  }

  /** After the pose: his eyes' light, the trail off the striking limb through a blow, the stars of a break. */
  afterPose(dt, a) {
    const fx = this.fx;
    if (this.mode !== 'dead' && this.eyesK > 0.02) {
      const e = this.glare.eyePoint(_a);
      fx.eyes?.(e.x, e.y, e.z, this.eyesK, Math.cos(this.yaw), -Math.sin(this.yaw));
    }
    if (a && this._tipOk && !this.shuddering && !a.def.transition) {
      for (const b of a.beats) {
        if (b.feint || b.def.halGlare || a.t < b.impact - 0.32 * b.W - 0.02 || a.t > b.impact + 1.6 * b.A + 0.05) continue;
        const D = b.def, heavy = D.tell === TELL.RED || D.tell === TELL.BLACK || !!D.knockdown;
        fx.limbTrail?.(this._tipPrev.x, this._tipPrev.y, this._tipPrev.z, this._tip.x, this._tip.y, this._tip.z, 1, heavy);
        break;
      }
    }
    if (this.mode === 'broken') fx.stunStars(this._hs[0]);
  }

  // ---------------------------------------------------------------- the answers
  /** A blow at the hero: the grab's carry, a perfect dodge of a red flying blow (the crash). */
  hitPlayer(o) {
    const D = o?.beat?.def, pl = this.game.player;
    // (See the World is never started on a hero who is down or drinking)
    if (D?.halGrab && (pl?.state === 'knockdown' || pl?.state === 'heal')) return RESULT.IGNORED;
    if (D?.halGrab) o = { ...o, knockdown: true };
    if (D?.halPass || D?.halTower) o = { ...o, extra: { ...(o.extra ?? null), around: true } };
    const r = super.hitPlayer(o);
    if (D?.halGrab && r === RESULT.HIT) this.flight.grab();
    if (D?.halCrash && r === RESULT.PERFECT && dodgeAnswer(D.tell) && this.mode === 'act') {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      this.flight.crash(fx, fz, 'dodge');
    }
    return r;
  }

  /** A parried flying blow (Fly-By's pass, Blink of an Eye's flying cross): THE CRASH, not a recoil. A BLUE one the
   *  hero's deathblow answers (ADR-294: every blue blow of a body takes the combo) is beaten out of the air instead:
   *  his pass stops where he is and he recoils as from any parried last blow (an open reaction: he drops, airFall),
   *  in front of the hero, and the combo follows. The crash stays for a perfect dodge of a red flying blow. */
  onParried(info = {}) {
    const a = this.brain.act, b = a?.striking ?? null;
    if (!b?.def?.halCrash || this.mode !== 'act' || info?.tell === TELL.RED) return super.onParried(info);
    const db = this.game.player?.db;
    if (info?.tell === TELL.BLUE && db?.phase === 'watch' && db.blue === true && db.att === this) {
      this.flight.pass.on = false;
      return super.onParried(info);
    }
    if (this.time - this._lastParry < 0.1) return;
    this._lastParry = this.time;
    const tell = info?.tell === TELL.BLUE ? TELL.BLUE : TELL.NORMAL;
    this.emit('dragon:parried', { attack: info?.attack ?? a.name, tell, hit: fin(b.hit, 0), last: true, flare: true });
    this.flash = Math.max(this.flash, 0.6);
    this.jolt = Math.max(this.jolt, 0.8);
    this.addPosture((POSTURE.parry[tell] ?? POSTURE.parry.normal) * (this.game.player?.deflect?.perfect ? POSTURE.perfect : 1) * this._clashMult());
    if (this.mode !== 'act') return;
    // the way he was going (a pass: his line; otherwise his facing)
    const G = b._go;
    const dx = G?.fixed ? G.dx : Math.sin(this.yaw), dz = G?.fixed ? G.dz : Math.cos(this.yaw);
    this.flight.crash(dx, dz, 'parry');
  }

  // ---------------------------------------------------------------- his limbs (bare hands; Tian Lei's way)
  _strikePart() {
    const br = this.brain;
    if (this.mode === 'act') {
      const b = beatNow(br.act);
      if (b && !br.act.def.transition) return b.def.part === 'eyes' ? 'fistR' : b.def.part ?? 'fistR';
    } else if (this.mode === 'react' && GUARD_KINDS.has(br.react?.kind)) return br.react.kind === 'wardR' ? 'fistR' : 'fistL';
    else if (this.mode === 'foot' && br.wardK > 0.5) return 'fistL';
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

  /** Where a beat's cue pops: the striking limb's end; 'eyes': his eyes; 'palms': between his hands. */
  tellPoint(part, out) {
    if (part === 'eyes') return this.glare.eyePoint(out);
    if (!this._ptsOk) return super.tellPoint(part === 'feet' ? 'feet' : 'tip', out);
    if (part === 'palms') {
      this._limbSeg('fistR', _a, out);
      this._limbSeg('fistL', _a, _b);
      return out.set((out.x + _b.x) * 0.5, (out.y + _b.y) * 0.5, (out.z + _b.z) * 0.5);
    }
    if (part === 'feet') return out.set(this.position.x, this.position.y + 0.6, this.position.z);
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

  /** The kill: his eyes gutter out into smoke as he kneels (the death clip tries to rise twice). */
  _die() {
    this.terrain?.drop();
    this.flight?.stop();
    super._die();
  }
}

/** A tell answered by a dodge (red / black). */
const dodgeAnswer = (tell) => tell === TELL.RED || tell === TELL.BLACK;

export { HERO_SCALE };
