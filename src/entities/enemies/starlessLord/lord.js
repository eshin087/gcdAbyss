import * as THREE from 'three';
import { CONFIG } from '../../../core/config.js';
import { clamp, damp, lerp, wrapAngle } from '../../../core/math.js';
import { TELL, RESULT } from '../../../combat/rules.js';
import { DIM } from '../../player/model.js';
import { Duelist } from '../duelist/duelist.js';
import { DuelBrain } from '../duelist/brain.js';
import { perPhase } from '../duelist/realise.js';
import { LORD_LOADOUT, SABER, buildOffSaber } from './gear.js';
import { formPoses } from './poses.js';
import { MOVES, MOVE_NAMES, CLIP, CLIPS_BY_FORM, TRANSITIONS, COUNTERS, realise } from './moves.js';
import { TUNING } from './tuning.js';
import { LordFx } from './fx.js';

// The Starless Lord (COMBAT.md → "The Starless Lord"): a dark lord from the stars, enthroned in the
// Obsidian Throne Hall, who fills the boss slot of the Starless level. A duelist (duelist/duelist.js:
// the body, the contract, the guard, posture, the duel's moments; duelist/brain.js: the mind) with
// his own kit: moves (moves.js), numbers (tuning.js), gear (gear.js), four stances (poses.js), FX
// (fx.js). What only he does is here:
//   - four blade FORMS (d.phase 1..4), each with its own health bar: one blade, twin blades, the
//     staff, the cross-hilted blade. A bar emptied or his posture broken leaves him on one knee; the
//     hero's execution is the DEATHBLOW: the form ends, he rises and ignites the next (the fourth
//     kills him). `lives` = { total, left } for the HUD's pips.
//   - the blades of red light: which meshes each form ignites, the off-hand blade's joint, the glow,
//     the red light on the main blade
//   - the Void: lightning (a parry deflects it, a perfect parry sends it back), the push, the pull,
//     the thrown blade, torn stone, called lightning, the blink
//   - the throne: he sits until the hero comes through the door, rises, and leaps down to the seal.

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const POSES = Object.freeze({
  loco: (p, A) => formPoses(A.player?.form ?? 1).duelLoco(p, A),
  duel: (p, A) => formPoses(A.player?.form ?? 1).duelClip(p, A),
});

/** Everything the shared duelist needs to be him (duelist.js: kit). */
export const LORD_KIT = Object.freeze({
  id: 'starlessLord',
  TUNING, MOVES, MOVE_NAMES, CLIP, realise,
  transitions: TRANSITIONS,
  counterMove: (form) => COUNTERS[clamp(form, 1, COUNTERS.length) - 1],
  maxPhase: TUNING.forms,
  loadout: LORD_LOADOUT,
  poses: POSES,
  blade: Object.freeze({ guard: SABER.guard, tip: SABER.tip }),
});

/** His mind: the duelist's, with each form's own reaction clips. */
class LordBrain extends DuelBrain {
  get C() {
    return CLIPS_BY_FORM[clamp(this.d.phase | 0, 1, CLIPS_BY_FORM.length) - 1];
  }
  set C(v) {} // (the base constructor assigns the kit's set: his is per form)

  /** Into the duel. If the intro was skipped or cut short (the Lab, a flow jump), he is put where
   *  its leap would have landed him: off the dais, on the hall's floor. */
  _toCombat() {
    const d = this.d;
    if (d.mode === 'sleep' || (d.mode === 'intro' && !d._introLanded)) {
      const L = TUNING.intro.land;
      d.position.set(L.x, 0, L.z);
    }
    super._toCombat();
  }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _m4 = new THREE.Matrix4();

export class StarlessLord extends Duelist {
  constructor(game) {
    super(game, LORD_KIT);
  }

  // ---------------------------------------------------------------- build
  /** His colours: the hero's material set, recoloured on HIS instances (gear.js says which is which). */
  _tint(M) {
    const fill = (m, r, g, b) => m?.uniforms?.uArtFill?.value.setRGB(r, g, b);
    fill(M.coat, 0.06, 0.055, 0.065); // black cloth
    fill(M.collar, 0.07, 0.06, 0.07);
    fill(M.lining, 0.4, 0.035, 0.03); // crimson inside the coat tails and the cape
    fill(M.collarIn, 0.42, 0.04, 0.035);
    fill(M.facing, 0.34, 0.03, 0.03);
    fill(M.piping, 0.4, 0.06, 0.05);
    fill(M.hem, 0.2, 0.05, 0.06); // the torn edges: dark blood-red
    fill(M.shirt, 0.03, 0.03, 0.036); // gauntlets, the helm's shadowed face
    fill(M.pants, 0.045, 0.045, 0.055);
    fill(M.leather, 0.07, 0.06, 0.065);
    fill(M.armor, 0.1, 0.1, 0.125); // black plate
    fill(M.spike, 0.13, 0.12, 0.15);
    fill(M.bevel, 0.26, 0.2, 0.22);
    fill(M.trim, 0.2, 0.19, 0.22); // dark gunmetal: the hilt, buckles
    fill(M.welt, 0.2, 0.08, 0.08);
    fill(M.flask, 1.0, 0.07, 0.04); // the blades and the visor: red light
    // the `flask` part's ink lines are amber for every rig (a shared per-part tint): in this level
    // (one level per page load) they burn red, so the blades' core is red-white, not gold
    const U = this.game.U;
    U.uHeroPartInk?.value?.[19]?.set(1.7, 0.34, 0.24, 1.6);
    U.uHeroPartRim?.value?.[19]?.set(1.7, 0.34, 0.24, 1.6);
    const fu = M.flask?.uniforms;
    if (fu) {
      fu.uInk?.value.setRGB(1.5, 0.16, 0.1);
      fu.uEmissive?.value.setRGB(2.6, 0.22, 0.12);
      if (fu.uGlowMask) fu.uGlowMask.value = 1;
    }
    if (M.lining?.uniforms?.uInk) M.lining.uniforms.uInk.value.setRGB(0.7, 0.1, 0.08);
  }

  _makeFx() {
    return new LordFx(this);
  }
  _makeBrain() {
    return new LordBrain(this);
  }

  /** The blades' meshes, the off-hand blade's joint and his state (before batching and reset()). */
  _setup() {
    const r = this.rig, find = (n) => r.root.getObjectByName(n) ?? null;
    this.blades = { A: find('lordBladeA'), B: find('lordBladeB'), hiltB: find('lordHiltB'), Q: find('lordQuillons'), L: null, off: null };
    const off = buildOffSaber(r.materials);
    r.body.add(off.root);
    this.blades.off = off.root;
    this.blades.L = off.blade;
    off.root.visible = false;
    this.lit = 0; // how far the blades are lit 0..1 (they extend from the hilt)
    this.litWant = 0;
    this.glaiveOut = false; // the main blade is in the air (Returning Blade)
    this._changing = false; // between a deathblow and the next form's ignition: nothing lands on him
    this._storm = { left: 0, t: 0 };
    this._offDir = new THREE.Vector3(0.5, 0.4, 0.75).normalize();
    this._offTip = new THREE.Vector3();
    this._offHilt = new THREE.Vector3();
    this._offTipPrev = new THREE.Vector3();
    this._offHiltPrev = new THREE.Vector3();
    this._backTip = new THREE.Vector3();
    this._backHilt = new THREE.Vector3();
    this._backTipPrev = new THREE.Vector3();
    this._backHiltPrev = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._ptsOk = false;
    this._introLanded = false;
    const d = this;
    this.debug.phase4 = () => this.brain.forcePhase(4);
    /** Lab: straight to form n (1..4), blades lit, bar full. */
    this.debug.setForm = (n) => {
      n = clamp(Math.round(fin(Number(n), 1)), 1, TUNING.forms);
      if (d.mode === 'dying' || d.mode === 'dead') return false;
      d.brain.startFight();
      d.enterPhase(n);
      d.litWant = 1;
      d._changing = false;
      d.brain._toFoot(0.3);
      d.emit(`dragon:phase${n}`);
      return true;
    };
    Object.defineProperty(this.debug, 'form', { get: () => d.phase });
  }

  // ---------------------------------------------------------------- contract
  /** The forms still to beat, this one included (the HUD's pips). */
  get lives() {
    return { total: TUNING.forms, left: this.mode === 'dead' ? 0 : TUNING.forms - this.phase + 1 };
  }

  reset() {
    if (this.blades) {
      this.lit = 0;
      this.litWant = 0;
      this.glaiveOut = false;
      this._changing = false;
      this._storm.left = 0;
      this._introLanded = false;
      this._ptsOk = false;
    }
    super.reset();
    // enthroned: the root sits at the seat (the pose's hips are lowered to it)
    this.position.y = TUNING.intro.seatY;
    if (this.blades) {
      this._showForm();
      this._animate(0);
    }
  }

  takeHit(o = {}) {
    if (this._changing) return 0;
    return super.takeHit(o);
  }

  /** The Sekiro rule: his posture is hard to move while the bar is full, and gives way as it empties. */
  addPosture(amount) {
    if (!(amount > 0)) return;
    const G = TUNING.posture.gainByHp, miss = 1 - clamp(this.hp / this.maxHp, 0, 1);
    super.addPosture(amount * lerp(G[0], G[1], miss));
  }

  _updatePosture(dt) {
    this.postureTimer += dt;
    if (this.broken || this.posture <= 0) return;
    const P = TUNING.posture;
    if (this.postureTimer > P.regenDelay) {
      const k = lerp(P.regenByHp[1], P.regenByHp[0], clamp(this.hp / this.maxHp, 0, 1));
      this.posture = Math.max(0, this.posture - P.regenRate * k * dt);
      this.emitPosture();
    }
  }

  /** The bar is empty: he does not die, he breaks (the deathblow's opening). */
  _onHpZero() {
    this.hp = 0;
    if (!this.broken) this._break();
  }

  /** A break nobody answered: he rises with a little of the bar back and half the meter. */
  endBreak() {
    const S = TUNING.posture.spared;
    this.broken = false;
    this.posture = this.maxPosture * S.posture;
    this.postureTimer = 0;
    if (this.hp <= 0) this.hp = this.maxHp * S.hp;
    this.emitPosture(true);
  }

  /** The deathblow (player.js: an attack near a broken duelist): this form ends. He is thrown back
   *  onto one knee, then rises into the next form's ignition; the last form's deathblow kills him. */
  onExecute(o = {}) {
    if (!this.broken || this.mode === 'dying' || this.mode === 'dead') return 0;
    const dmg = Math.max(1, Math.round(fin(o.damage, TUNING.execution.damage)));
    this.hp = 0;
    this.flash = 1;
    this.emit('dragon:hurt', { damage: dmg, part: 'body', hp: 0, crit: true });
    this.emit('dragon:plunged', { execution: true, deathblow: true, form: this.phase });
    this.broken = false;
    this.posture = 0;
    this.emitPosture(true);
    this._cinematic('execution');
    const c = this._hs[1], p = this.game.player?.position;
    const dx = p ? this.position.x - p.x : 0, dz = p ? this.position.z - p.z : 1, l = Math.hypot(dx, dz) || 1;
    this.fx.deathblowBurst(c.x, c.y, c.z, dx / l, dz / l);
    if (this.phase >= TUNING.forms) {
      this._die();
      return dmg;
    }
    this._changing = true;
    this.litWant = 0; // the blades gutter out
    this.brain.startReact('executed');
    this.brain.pendingPhase = this.phase + 1;
    return dmg;
  }

  /** Form n begins (its ignition's start): a full bar, its posture meter, its stance and its blades
   *  (dark until the ignition lands). */
  enterPhase(n) {
    super.enterPhase(n);
    this.hp = this.maxHp;
    this.lit = 0;
    this.litWant = 0;
    this.glaiveOut = false;
    this._showForm();
  }

  _die() {
    this._changing = false;
    this.litWant = 0;
    this._storm.left = 0;
    super._die();
  }

  /** Where a beat's glint pops: the casting hand, the off-hand blade, his feet, or the main blade. */
  tellPoint(part, out) {
    if (part === 'hand' && this._ptsOk) return out.copy(this._hand);
    if (part === 'off' && this._ptsOk && this.phase === 2) return out.copy(this._offTip);
    return super.tellPoint(part, out);
  }

  // ---------------------------------------------------------------- the hall's floor
  /** Keep a point on the hall's floor (TUNING.hall). */
  clampTarget(p) {
    const H = TUNING.hall;
    p.x = clamp(p.x, -H.x, H.x);
    p.z = clamp(p.z, H.zN, H.zS);
    return p;
  }

  moveBy(dx, dz) {
    super.moveBy(dx, dz);
    this.clampTarget(this.position);
  }

  // ---------------------------------------------------------------- the blades
  /** Show what the current form ignites (lit 0..1 scales each blade out of its emitter). */
  _showForm() {
    const B = this.blades, f = this.phase, S = SABER;
    if (!B?.A) return;
    const k = Math.max(0.001, this.lit);
    const on = k > 0.02 && !this.glaiveOut;
    B.A.visible = on;
    B.A.scale.z = ((f === 4 ? S.tip4 : S.tip) - S.guard) * k;
    B.hiltB.visible = f === 3;
    B.B.visible = f === 3 && on;
    B.B.scale.z = (S.tipB - S.hiltB) * k;
    B.Q.visible = f === 4 && k > 0.5;
    B.off.visible = f === 2;
    B.L.visible = f === 2 && k > 0.02;
    B.L.scale.z = (S.tip - S.guard) * k;
    // the off hand: closed on the off-hand blade's hilt in form 2 (that joint carries its own fist)
    const H = this.rig.offHand;
    if (H?.open && f === 2) {
      H.open.visible = false;
      if (H.grip) H.grip.visible = false;
    }
  }

  /** The off-hand blade's joint: at the left wrist, along the direction the pose left on the animator. */
  _poseOff(dt) {
    const off = this.blades?.off;
    if (!off || this.phase !== 2) return;
    const r = this.rig, fore = r.arms.L.fore;
    fore.updateWorldMatrix(true, false);
    _v.set(0, -DIM.foreArm, 0).applyMatrix4(fore.matrixWorld);
    r.body.worldToLocal(_v);
    off.position.copy(_v);
    const o = this.anim.off ?? { az: 0.72, el: 0.42 };
    const c = Math.cos(o.el);
    _w.set(c * Math.sin(o.az), Math.sin(o.el), c * Math.cos(o.az));
    // (the pose's direction is not a blended channel: ease it so a change of clip does not snap it)
    const k = dt > 0 ? 1 - Math.exp(-dt * 28) : 1;
    this._offDir.lerp(_w, k).normalize();
    _bz.copy(this._offDir);
    _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
    if (_by.lengthSq() < 1e-6) _by.set(1, 0, 0);
    _by.normalize();
    _bx.crossVectors(_by, _bz);
    off.quaternion.setFromRotationMatrix(_m4.makeBasis(_bx, _by, _bz));
  }

  _gameplayPoints() {
    this._poseOff(this._dt ?? 0);
    super._gameplayPoints();
  }

  _animate(dt) {
    this.pilot.form = this.phase;
    this._dt = dt;
    super._animate(dt);
  }

  /** Drawn points for FX: every lit blade's ends and the casting hand (leaned, HERO_SCALE). */
  _drawnPoints() {
    const s = this.rig.sword, S = SABER, f = this.phase;
    this._tipPrev.copy(this._tip);
    this._hiltPrev.copy(this._hilt);
    this._offTipPrev.copy(this._offTip);
    this._offHiltPrev.copy(this._offHilt);
    this._backTipPrev.copy(this._backTip);
    this._backHiltPrev.copy(this._backHilt);
    const ok = this._tipOk;
    this._hilt.set(0, 0, S.guard).applyMatrix4(s.matrixWorld);
    this._tip.set(0, 0, f === 4 ? S.tip4 : S.tip).applyMatrix4(s.matrixWorld);
    this._backHilt.set(0, 0, -S.hiltB).applyMatrix4(s.matrixWorld);
    this._backTip.set(0, 0, -S.tipB).applyMatrix4(s.matrixWorld);
    const off = this.blades.off;
    this._offHilt.set(0, 0, S.guard).applyMatrix4(off.matrixWorld);
    this._offTip.set(0, 0, S.tip).applyMatrix4(off.matrixWorld);
    this._hand.set(0, -DIM.foreArm - 0.06, 0).applyMatrix4(this.rig.arms.L.fore.matrixWorld);
    this._tipOk = Number.isFinite(this._tip.x + this._tip.y + this._tip.z) && Number.isFinite(this._hilt.x + this._hilt.y + this._hilt.z);
    const all = this._tipOk && Number.isFinite(this._offTip.x + this._offHilt.y + this._backTip.z + this._hand.x + this._hand.y + this._hand.z);
    if (!ok || !this._ptsOk) {
      this._tipPrev.copy(this._tip);
      this._hiltPrev.copy(this._hilt);
      this._offTipPrev.copy(this._offTip);
      this._offHiltPrev.copy(this._offHilt);
      this._backTipPrev.copy(this._backTip);
      this._backHiltPrev.copy(this._backHilt);
    }
    this._ptsOk = all;
  }

  /** The blades' material (his `flask` instance): it burns brighter through a strike and in form 4. */
  _bladeMaterials(dt, M) {
    const u = M.flask?.uniforms;
    if (!u) return;
    const act = this.brain.act, striking = !!act && act.striking && act.t >= act.striking.impact - 0.06 && act.t <= act.striking.end + 0.1;
    const hot = this.phase >= 4 ? 1.5 : 1;
    const glow = (1.2 + (striking ? 0.8 : 0)) * hot * this.lit;
    u.uGlow.value = dt > 0 ? damp(u.uGlow.value, glow, 14, dt) : glow;
    u.uInkGlow.value = 1.0 + (striking ? 0.6 : 0) + 0.4 * (hot - 1);
  }

  // ---------------------------------------------------------------- frame hooks (duelist/brain.js)
  /** Each frame after the brain: the blades' ignition, the intro's leap, the storm's marks. */
  brainFrame(dt) {
    // the blades extend / retract
    if (this.lit !== this.litWant) {
      this.lit = this.litWant > this.lit ? Math.min(this.litWant, this.lit + dt * 5) : Math.max(this.litWant, this.lit - dt * 4);
    }
    // out of the intro and the ignitions his blades are always lit (a skipped intro included)
    const act = this.brain.act, m = this.mode;
    if (this.litWant < 1 && !this._changing && (m === 'foot' || m === 'react' || m === 'broken' || (m === 'act' && act && !act.def.transition))) this.litWant = 1;
    this._showForm();
    if (this.mode === 'intro') this._intro(dt);
    // The Starless Sky: one mark every `gap` s, led onto where the hero is going
    const St = this._storm;
    if (St.left > 0 && this.mode !== 'dying' && this.mode !== 'dead') {
      St.t -= dt;
      if (St.t <= 0) {
        St.t = TUNING.storm.gap;
        St.left--;
        const pl = this.game.player, p = pl?.position;
        if (p) {
          const lead = TUNING.storm.lead, j = St.left % 3 === 2 ? 2.6 : 0.5;
          let x = p.x + fin(pl.vel?.x) * lead + this.fx.rand(-j, j), z = p.z + fin(pl.vel?.z) * lead + this.fx.rand(-j, j);
          const H = TUNING.hall;
          x = clamp(x, -H.x - 0.6, H.x + 0.6);
          z = clamp(z, H.zN - 0.4, H.zS + 0.6);
          this.fx.callStrike(x, z, TUNING.storm.radius, TUNING.storm.warn, { damage: St.damage, knockback: St.kb, attack: 'storm' });
        }
      }
    }
  }

  /** The intro's root motion: off the throne onto the dais, the blade lit, the leap down to the seal. */
  _intro() {
    const I = TUNING.intro, t = this.brain.modeT;
    const S = CONFIG.world.dragonSleep ?? { x: 0, z: 0 };
    const sx = fin(S.x), sz = fin(S.z);
    const standZ = sz + I.stand, standY = I.daisY;
    if (t < 0.5) this.position.set(sx, I.seatY, sz);
    else if (t < 1.2) {
      const k = (t - 0.5) / 0.7, e = k * k * (3 - 2 * k);
      this.position.set(sx, lerp(I.seatY, standY, e), lerp(sz, standZ, e));
    } else if (t < I.leapFrom) this.position.set(sx, standY, standZ);
    else {
      const k = clamp((t - I.leapFrom) / Math.max(0.1, I.leapTo - I.leapFrom), 0, 1), e = k * k * (3 - 2 * k);
      this.position.set(lerp(sx, I.land.x, e), k >= 1 ? 0 : lerp(standY, 0, k) + I.apex * 4 * k * (1 - k), lerp(standZ, I.land.z, e));
      this.state = k < 1 ? 'airborne' : 'waking';
      if (k >= 1 && !this._introLanded) {
        this._introLanded = true;
        this.emit('dragon:land', { x: this.position.x, z: this.position.z });
        this.fx.dust(this.position.x, this.position.z, 2);
        this.game.shake?.(0.35);
        this.game.world?.forest?.ambience?.flare?.(1);
      }
    }
    if (t >= 1.15 && this.litWant < 1) {
      this.litWant = 1;
      this.fx.igniteBurst(this._hilt, this._tip, 1);
      this.emit('dragon:roar', { strength: 0.5 });
    }
  }

  /** After the pose: every lit blade's glow and sweep, the red light, form 4's aura, the Void in his
   *  hand through a cast, the stars of a break. */
  afterPose(dt, a) {
    const f = this.phase, fx = this.fx, lit = this.lit;
    if (!this._ptsOk) return;
    const hot = f >= 4 ? 1.35 : 1;
    const main = lit > 0.02 && !this.glaiveOut;
    if (main) {
      fx.bladeGlow(this._hilt, this._tip, lit, hot);
      if (f === 3) fx.bladeGlow(this._backHilt, this._backTip, lit, hot);
      fx.bladeEmbers(this._hilt, this._tip, dt, f >= 4 ? 2.4 : 0.7);
    }
    if (f === 2 && lit > 0.02) fx.bladeGlow(this._offHilt, this._offTip, lit, hot);
    fx.bladeLight(this._hilt, this._tip, this.mode === 'dying' ? 0 : main ? lit : f === 2 ? lit * 0.6 : 0, hot);
    if (f >= 4 && this.mode !== 'dying' && this.mode !== 'sleep' && lit > 0.5) {
      const c = this._hs[1];
      fx.aura(c.x, c.y, c.z, dt, 1);
    }
    if (a) {
      // the sweep trail of whichever blade is cutting, from the snap out of the cock on
      for (const b of a.beats) {
        if (b.feint || a.t < b.impact - 0.32 * b.W - 0.02 || a.t > b.end + 0.6 * b.A + 0.05) continue;
        const D = b.def;
        if (D.cast || D.release?.style === 'push' || D.bolt || D.pull) break;
        if (D.left) fx.sweep(this._offHiltPrev, this._offTipPrev, this._offHilt, this._offTip, 'red');
        else if (main) {
          fx.sweep(this._hiltPrev, this._tipPrev, this._hilt, this._tip, 'red');
          if (f === 3) fx.sweep(this._backHiltPrev, this._backTipPrev, this._backHilt, this._backTip, 'red');
          if (f === 2 && D.zone?.kind === 'ring') fx.sweep(this._offHiltPrev, this._offTipPrev, this._offHilt, this._offTip, 'red');
        }
        break;
      }
      // the Void gathering in his hand through a cast's windup
      const cur = a.beats.find((b) => a.t < b.impact);
      if (cur && !cur.feint) {
        const D = cur.def, k = clamp((a.t - cur.start) / Math.max(0.05, cur.impact - cur.start), 0, 1), h = this._hand;
        if (D.bolt) fx.crackle(h.x, h.y, h.z, k, dt);
        else if (D.pull) {
          fx.crackle(h.x, h.y, h.z, k, dt, [2.8, 0.2, 0.3]);
          const p = this.game.player;
          if (p?.getChestPos && k > 0.25) {
            p.getChestPos(_v, true);
            fx.pullStream(h.x, h.y, h.z, _v.x, _v.y, _v.z, k, dt);
          }
        } else if (D.release?.style === 'push' || D.cast?.kind === 'debris' || D.cast?.kind === 'storm') fx.crackle(h.x, h.y, h.z, k * 0.7, dt, [2.4, 1.6, 2.0]);
      }
    }
    if (this.mode === 'broken') fx.stunStars(this._hs[0]);
  }

  /** A beat's impact, its first frame. */
  onImpact(b, s, a) {
    const D = b.def;
    if (a?.def?.transition) {
      // the ignition: the new form's blades light, the shock ring goes out, the seal flares
      this.litWant = 1;
      this._changing = false;
      this.fx.igniteNova(this.position.x, this.position.z, TUNING.ignite.ringRadius);
      this.fx.igniteBurst(this._hilt, this._tip, 1.5);
      this.game.shake?.(0.4);
      this.game.world?.forest?.ambience?.flare?.(1);
      return;
    }
    if (D.bolt) {
      // the bolt: from his hand to the hero (in its line) or out along his facing
      const h = this._hand, p = this.game.player;
      const inLine = !!s && this.brain._inZone(D.zone, s);
      if (inLine && p?.getChestPos) {
        p.getChestPos(_v, true);
        this.fx.lightning(h.x, h.y, h.z, _v.x, _v.y, _v.z, 1.1, true);
      } else {
        const r = TUNING.bolt.range * 0.8;
        this.fx.lightning(h.x, h.y, h.z, this.position.x + Math.sin(this.yaw) * r, 0.4, this.position.z + Math.cos(this.yaw) * r, 1.1, true);
      }
      this.emit('dragon:explosion', { x: h.x, z: h.z, radius: 2 });
    }
  }

  /** A blow at the hero. The pull drags him toward the lord; a bolt met by a perfect parry comes back. */
  hitPlayer(o) {
    const D = o.beat?.def, p = this.game.player;
    if (D?.pull && p?.position) {
      // (the hero's push is "away from the source": put the source on his far side)
      const px = p.position.x, pz = p.position.z;
      o = { ...o, from: { x: px + (px - this.position.x), z: pz + (pz - this.position.z) }, kind: 'pull' };
    } else if (D?.bolt) o = { ...o, kind: 'lightning' };
    const r = super.hitPlayer(o);
    if (D?.bolt && r === RESULT.PARRIED && p?.deflect?.perfect && this.mode !== 'dying' && this.mode !== 'dead') {
      // thrown back: it strikes him
      const B = TUNING.bolt, c = this._hs[1];
      if (p.getChestPos) {
        p.getChestPos(_v, true);
        this.fx.lightning(_v.x, _v.y, _v.z, c.x, c.y, c.z, 1.2, true, true);
      }
      this.emit('dragon:returned', { kind: 1, damage: B.returnDamage, x: c.x, y: c.y, z: c.z });
      super.takeHit({ damage: B.returnDamage, exact: true, heavy: true, posture: B.returnPosture, part: 'body', point: { x: c.x, y: c.y, z: c.z } });
    }
    return r;
  }

  /** The push's wall of force / the crescents of red light, thrown at a release beat's impact. */
  onRelease(b, s, act) {
    const R = b.def.release, base = s ? s.ang : this.yaw;
    if (R.style === 'push') {
      const P = TUNING.push;
      const sx = this.position.x + Math.sin(base) * 1.1, sz = this.position.z + Math.cos(base) * 1.1;
      this.fx.throwCrescent(sx, sz, Math.sin(base), Math.cos(base), { tell: b.def.tell, damage: b.def.damage, knockback: b.def.knockback, attack: act?.name ?? 'voidPush', style: 'push', speed: P.speed, radius: P.radius, half: P.half, life: P.life });
      this.game.shake?.(0.15);
      this.game.world?.gust?.(sx, sz, 1.4, 6);
      return;
    }
    const n = perPhase(R.count ?? 1, this.phase), C = TUNING.crescent;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * (R.spread ?? 0.34);
      this.fx.throwCrescent(this.position.x + Math.sin(a), this.position.z + Math.cos(a), Math.sin(a), Math.cos(a), { tell: b.def.tell, damage: b.def.damage, knockback: b.def.knockback, attack: act?.name ?? 'tide', style: 'crescent', speed: C.speed, radius: C.radius, life: C.life });
    }
  }

  /** A cast beat's impact: the thrown blade, torn stone, called lightning. */
  onCast(b, s, act) {
    const D = b.def, C = D.cast, name = act?.name ?? C.kind;
    const ang = s ? s.ang : this.yaw, dx = Math.sin(ang), dz = Math.cos(ang);
    if (C.kind === 'glaive') {
      const G = TUNING.glaive;
      const shot = this.fx.throwShot({ kind: 'glaive', x: this._hilt.x, y: 1.05, z: this._hilt.z, dx, dz, speed: G.speed, back: G.back, range: G.range, radius: G.radius, life: G.life, tell: D.tell, damage: D.damage, knockback: D.knockback, attack: name });
      if (shot) this.glaiveOut = true;
    } else if (C.kind === 'debris') {
      const T = TUNING.debris, n = C.count ?? 3;
      for (let i = 0; i < n + (C.big ? 1 : 0); i++) {
        const big = i >= n;
        const a = ang + (i - (n - 1) / 2) * 0.9 + Math.PI * 0.5 * (i & 1 ? 1 : -1) * 0.4;
        const x = this.position.x + Math.sin(a) * (big ? 2.2 : 1.7), z = this.position.z + Math.cos(a) * (big ? 2.2 : 1.7);
        this.fx.tearUp(x, z);
        this.fx.throwShot({
          kind: 'stone', x, y: 0.2, z, dx, dz, speed: T.speed * (big ? 0.85 : 1), radius: big ? 1.25 : T.radius, life: T.life, delay: 0.4 + i * T.gap + (big ? 0.25 : 0), rise: T.rise + (big ? 0.5 : 0) + 0.2 * (i & 1),
          tell: big ? TELL.RED : D.tell, damage: big ? D.damage * 1.9 : D.damage, knockback: big ? 4 : D.knockback, attack: name, big,
        });
      }
      this.game.shake?.(0.2);
    } else if (C.kind === 'storm') {
      this._storm.left = C.count ?? 6;
      this._storm.t = 0;
      this._storm.damage = D.damage;
      this._storm.kb = D.knockback;
      this.fx.lightning(this._tip.x, this._tip.y, this._tip.z, this._tip.x + this.fx.rand(-2, 2), 24, this._tip.z + this.fx.rand(-2, 2), 1.6, true);
    }
  }

  /** The thrown blade is back in his hand (fx.js). */
  onGlaiveBack() {
    if (!this.glaiveOut) return;
    this.glaiveOut = false;
    this.fx.igniteBurst(this._hilt, this._tip, 0.6);
  }

  /** A beat's own root motion: the blink (he is gone, and behind the hero). */
  beatMotion(b, u, s) {
    const K = b.def.blink;
    if (!K || b._blinked || u < 0.1 || !s) return;
    b._blinked = true;
    const pl = this.game.player, yaw = fin(pl?.yaw, wrapAngle(s.ang + Math.PI));
    const x0 = this.position.x, z0 = this.position.z;
    let tx = s.p.x - Math.sin(yaw) * K.behind, tz = s.p.z - Math.cos(yaw) * K.behind;
    const H = TUNING.hall;
    if (Math.abs(tx) > H.x || tz < H.zN || tz > H.zS) {
      // no room behind him: to his side instead
      tx = s.p.x + Math.cos(yaw) * K.behind;
      tz = s.p.z - Math.sin(yaw) * K.behind;
    }
    this.position.x = tx;
    this.position.z = tz;
    this.moveBy(0, 0);
    this.yaw = Math.atan2(s.p.x - this.position.x, s.p.z - this.position.z);
    this.anim.teleported?.();
    this.fx.blinkTrail(x0, z0, this.position.x, this.position.z);
  }
}
