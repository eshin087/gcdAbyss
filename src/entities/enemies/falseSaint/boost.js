import { TELL, RESULT } from '../../../combat/rules.js';
import { TUNING_BOOST } from './tuningBoost.js';
import { turnToward as turnTo } from '../../../core/math.js';

// FsBoost: what rides the False Saint's jets (the BOOST AGENT's handler; its moves: moves/boost.js; its
// numbers: tuningBoost.js, TUNING.boost; its poses: posesBoost.js). The routing contract's hooks (saint.js
// header; arsenal.js lists them with their arguments). What it does:
//   THE JET STEP (Censer Step, footwork): from phase 2 a far hero is closed on a jet, not a run: a short
//     light-up, a straight dash that stops `step.stop` m short of the hero (never through him), an
//     afterimage where he left; from phase 3 two legs (a zig-zag) and a low rigid hover between moves.
//   THE BOOSTERS' LIGHT (d.fsJets, the body draws them; fx.jet draws the flame every frame it is lit).
//   THE BOOSTER PUNCH's dash line (struck at fist height), its carry on a miss, its overshoot when parried.
//   THE ROSARY's chips beside the hero; DESCENT's flight and crater; VESPERS' sets and passes; LAST RITE.
//
// THE SURFACE (others may read):
//   stats      { steps, zigs, stepAborts, dashes, carries, craters, overshoots, chips, dives, passes, sets, rites, riteHits, riteOpen, swept }
//   step       the jet step under way ({ t, pre, legs, leg, ... }) or null
//   riteUsed   Last Rite has been thrown this fight
// THE BODY'S VALUES (set every frame on the actor; the body agent draws them, 0..1 each):
//   d.fsJets    { elbowR, elbowL, back, calfR, calfL, palmR, core }   how lit each booster is
//   d.fsThrustK the back / calf thrusters holding him up (the hover, a flight, a dash)
//   d.fsCoreK   the chest core's whine (Last Rite)
//   d.pilot.fsDashK / fsHoverK   the footwork's pose layers (posesBoost.js BO_DASH_LAYER / BO_HOVER_LAYER)
// Never Math.random (no draw at all: every choice here is a fixed rule), no allocation per frame.

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (u) => u * u * (3 - 2 * u);
const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph | 0)) - 1] : v);
const JETS = Object.freeze(['elbowR', 'elbowL', 'back', 'calfR', 'calfL', 'palmR', 'core']);
const LANDED = new Set([RESULT.HIT, RESULT.BLOCKED, RESULT.PARRIED, RESULT.CLASHED]);

export class FsBoost {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this.T = d.T?.boost ?? TUNING_BOOST;
    this.jets = Object.fromEntries(JETS.map((k) => [k, 0]));
    this._want = Object.fromEntries(JETS.map((k) => [k, 0]));
    this._o = { kind: 'blunt', by: 'boss', dx: 0, dz: 0, y: 1.2, src: -1, scar: true };
    this._gm = { kind: 'blast', power: 1, r: 1.5, dx: 0, dz: 1, by: 'boss', hot: true };
    this._legs = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
    this.stepCool = 0;
    d.fsJets = this.jets;
    d.fsThrustK = 0;
    d.fsCoreK = 0;
    this.reset();
  }

  reset() {
    this.stats = { steps: 0, zigs: 0, stepAborts: 0, dashes: 0, carries: 0, craters: 0, overshoots: 0, chips: 0, dives: 0, passes: 0, sets: 0, rites: 0, riteHits: 0, riteOpen: 0, swept: 0, plants: 0, outOfPool: 0, lines: 0 };
    for (const k of JETS) this.jets[k] = this._want[k] = 0;
    this.step = null;
    this.stepCool = 0;
    this._runT = 0;
    this.carry = null;
    this._overNext = null;
    this.riteUsed = false;
    this.d.fsThrustK = 0;
    this.d.fsCoreK = 0;
    if (this.d.pilot) this.d.pilot.fsDashK = this.d.pilot.fsHoverK = 0;
  }

  /** A reaction, a break, his death: let go of the dash, the carry, the step (a parry's overshoot stays:
   *  it starts with the recoil it is part of). */
  stop() {
    this.step = null;
    this.carry = null;
    this.d.fsCoreK = 0;
    // (Last Rite cut off before its lunge, by a break or a blast: it has not been spent)
    const R = this._riteAct;
    if (R && !R.beats[0]?.struck) this.riteUsed = false;
    this._riteAct = null;
  }

  // ================================================================ the move hooks
  /** Last Rite: only in phase 4, under `rite.below` of his bar, once; then it comes first. */
  weigh(name, def, w) {
    if (name !== 'lastRite') return w;
    const d = this.d, R = this.T.rite;
    if (this.riteUsed || d.phase < 4 || !(d.hp / Math.max(1, d.maxHp) < R.below)) return 0;
    return w * R.boost;
  }

  onActStart(A) {
    if (A.name === 'lastRite') {
      if (this.riteUsed) return false;
      this.riteUsed = true;
      this._riteAct = A;
      this.stats.rites++;
    }
    this.step = null;
    return true;
  }

  /** Every frame of a routed beat (after the engine's own motion: a dash has moved him already). */
  beatMotion(b, u, s, dt) {
    const D = b.def;
    // (v04, the pack's hand details: the CLENCH only behind the booster punch (the votive blink, the overclock's
    // passes behind the fist), from its coil to the follow-through's end; a piston's heel of the palm and the
    // embrace's palms REACH from the strike; the dive's hand opens on the plates; else the guard's half-curl)
    const hd = this.d, hp = D.part, hc = fin(D.cock, 0.8), hs = u >= (hc + 1) * 0.5 && u < 2;
    const fist = (D.fsDash && !D.fsDash.rite && u >= hc * 0.5 && u < 2) || (D.fsBlitz?.pass !== undefined && !D.fsBlitz.last && u >= 0.6 && u < 2);
    hd.fsHandR = fist ? 'clench' : (D.fsDive || D.fsBlitz?.last) && u >= 0.93 ? 'open' : hs && (hp === 'fistR' || hp === 'palms') ? 'reach' : 'guard';
    hd.fsHandL = hs && hp === 'palms' ? 'reach' : 'guard';
    this._handLive = this._handOwn = true;
    hd.fsHandBy = this;
    const J = D.fsJet;
    if (J && !J.pulse && u >= fin(J.from, 0) && u < 1) {
      const c = fin(D.cock, 0.8), k = 0.35 + 0.65 * clamp((u - J.from) / Math.max(0.05, c - J.from), 0, 1);
      this._light(J.part, k);
    }
    if (D.fsDash) this._dashMotion(b, u, s);
    if (D.fsDive) this._dive(b, u, s);
    if (D.fsBlitz) this._blitz(b, u, s, dt);
  }

  onImpact(b, s) {
    const D = b.def, d = this.d;
    if (D.fsJet?.pulse) this.jets[D.fsJet.part] = 1;
    if (D.fsDash && b._fsDash) {
      const F = b._fsDash;
      if (!D.fsDash.rite) d.fx.dashTrail?.(F.x0, F.z0, d.position.x, d.position.z, 1);
      // (the blink ends with the lead sole planted: its scuff and dust)
      if (d.position.y < 0.3) this._plant(d.position.x, d.position.z, F.dx, F.dz, 0.8);
    }
    if (D.fsJet?.part === 'elbowR' && D.fsJet.pulse) this._chipBeside(s);
    if (D.fsJet?.part === 'calfR') {
      this.jets.calfR = 1;
      this.jets.calfL = 1;
    }
    if (D.fsDive) this._diveLand(b);
    // (v04: the dive's knee and the overclock's last pass come down on a planted foot: its scuff)
    if (D.fsDive || (D.fsBlitz?.last && D.fsBlitz.pass !== undefined)) d.fx.footPlant?.(d.position.x, d.position.z, Math.sin(d.yaw), Math.cos(d.yaw), 0.4, 1);
    if (D.fsBlitz?.last && D.fsBlitz.pass !== undefined) this._crater(d.position.x, d.position.z, this.T.vespers.lastR, this.T.vespers.lastPower, 1.3);
  }

  hitPlayer(o) {
    const D = o?.beat?.def;
    // Last Rite never takes the hero's last HP
    if (D?.fsDash?.rite) {
      const p = this.game.player, k = this.d.T.damageScale ?? 1;
      if (p && Number.isFinite(p.hp)) o.damage = Math.max(0, Math.min(fin(o.damage), (p.hp - 1) / k));
    }
    return o;
  }

  onHit(o, r) {
    const b = o?.beat;
    if (!b) return;
    b._fsR = r;
    if (b.def.fsDash?.rite) {
      if (r === RESULT.HIT) this._riteBlast();
      // (rolled through: open at once, so the hero's answer to the red finds him broken)
      else if (r === RESULT.DODGED || r === RESULT.PERFECT) this._riteOpen(b);
    }
  }

  /** Last Rite missed: he stands wide open (his posture gives: the deathblow's chance). */
  _riteOpen(b) {
    const d = this.d;
    if (b._fsDone) return;
    b._fsDone = true;
    this.stats.riteOpen++;
    d.fsCoreK = 0;
    d.addPosture(d.maxPosture * 2);
  }

  /** The booster punch parried: a big posture hit, and he skids on past the hero's side (with the recoil). */
  onParried(info, b) {
    const D = b?.def, d = this.d;
    if (!D?.fsDash || D.fsDash.rite) return false;
    d.addPosture(this.T.votive.parryPosture);
    const F = b._fsDash;
    const dx = F ? F.dx : Math.sin(d.yaw), dz = F ? F.dz : Math.cos(d.yaw);
    const p = this.game.player?.position;
    // (off his line, away from the hero: past his side, not through him)
    const side = p ? Math.sign((p.x - d.position.x) * dz - (p.z - d.position.z) * dx) || 1 : 1;
    const a = Math.atan2(dx, dz) + side * 0.55;
    this._overNext = { dx: Math.sin(a), dz: Math.cos(a), left: this.T.votive.overshoot, v: 14, t: d.time };
    this.stats.overshoots++;
    return false;
  }

  /** A beat that reaches wherever the hero is: the dive and the passes (their own motion finds him); Last
   *  Rite is committed (he does not break it off: a hero who left is the open he pays for). */
  reach(b) {
    const D = b.def;
    if (D.fsDive || D.fsBlitz || D.fsDash?.rite) return Infinity;
    return undefined;
  }

  // ================================================================ every frame
  frame(dt) {
    const d = this.d, a = d.brain?.act;
    if (this.stepCool > 0) this.stepCool -= dt;
    if (this.step && d.mode !== 'foot') this.step = null;
    // (how long the engine's footwork has had him running at the hero: it found no move for this range)
    const gv = d.pilot?.groundVel, run = d.mode === 'foot' && !this.step && gv && Math.hypot(gv.x, gv.z) >= fin(d.T.move?.run, 7) * 0.9;
    this._runT = run ? fin(this._runT) + dt : 0;
    if (this._overNext) {
      this.carry = { ...this._overNext, crater: false, src: -1 };
      this._overNext = null;
    }
    if (this.carry) this._carry(dt);
    if (d.mode === 'act' && a) this._watch(a);
    // (Last Rite gone before its lunge without a reaction: not spent either)
    if (this._riteAct && a !== this._riteAct) {
      if (!this._riteAct.beats[0]?.struck) this.riteUsed = false;
      this._riteAct = null;
    }
    this._hover(dt, a);
    // the boosters' light: what a beat holds lit this frame, else it dies out (a pulse flickers)
    for (const k of JETS) {
      const w = this._want[k];
      this.jets[k] = w > 0 ? Math.max(w, this.jets[k] - dt * 3) : Math.max(0, this.jets[k] - dt * 5.5);
      this._want[k] = 0;
    }
    if (d.mode !== 'act' || !a || a.name !== 'lastRite') d.fsCoreK = Math.max(0, d.fsCoreK - dt * 3);
    // (v04: no beat of his has driven the hands for a follow-through's length: back to the guard's half-curl)
    // (held through the follow-through's own clock past the beat's end: realise.js FOLLOW_MAX 0.24 s)
    this._handOff = this._handLive ? 0 : fin(this._handOff) + dt;
    if (this._handOwn && this._handOff > 0.24) {
      this._handOwn = false;
      // (only the shapes this handler set: another's beat may have taken the hands since)
      if (d.fsHandBy === this) d.fsHandR = d.fsHandL = d.fsHandBy = undefined;
    }
    this._handLive = false;
    const pl = d.pilot;
    if (pl) {
      const brake = this.step && this.step.brake >= 0 ? 1 : 0, dash = this.step && this.step.t >= this.step.pre && !brake ? 1 : 0;
      pl.fsDashK = dash ? 1 : Math.max(0, fin(pl.fsDashK) - dt * 7);
      pl.fsBrakeK = brake ? Math.min(1, fin(pl.fsBrakeK) + dt * 14) : Math.max(0, fin(pl.fsBrakeK) - dt * 4);
    }
  }

  /** After the pose (his points are fresh): the lit boosters' flames. */
  afterPose() {
    const fx = this.d.fx;
    for (const k of JETS) if (this.jets[k] > 0.02) fx.jet?.(k, this.jets[k]);
  }

  _light(part, k) {
    if (part in this._want) this._want[part] = Math.max(this._want[part], clamp(k, 0, 1));
  }

  // ================================================================ THE JET STEP (Censer Step)
  /** The footwork hook: true when the jet step moved (or held) him this frame. */
  footwork(dt, s) {
    const d = this.d, S = this.T.step, ph = d.phase;
    if (this.step) return this._stepTick(dt, s);
    if (s && this._outOfPool(dt, s)) return true;
    // (only where he would otherwise walk or run to the hero: in a breather, or once the engine found no
    // move for this range and set him running; never in place of a move his AI picks)
    if (!S?.on || ph < S.from || !s || !(s.dist > pp(S.at, ph)) || this.stepCool > 0 || !(d.brain.gapT > 0 || this._runT > 0.2)) return false;
    // the legs: straight to `stop` m short of the hero (at most `max` m); from phase `zig` the first leg
    // `zigAng` rad off the line (to the side with room), the second onto the stop point
    const ux = s.dx / s.dist, uz = s.dz / s.dist;
    const len = Math.min(S.max, s.dist - S.stop);
    if (!(len > 1.2)) return false;
    const x0 = d.position.x, z0 = d.position.z, B = d.bound - 0.4;
    let n = 1;
    const E = this._legs[1];
    E.x = x0 + ux * len;
    E.z = z0 + uz * len;
    if (ph >= S.zig && len > 3) {
      const t = Math.tan(S.zigAng) * len * S.zigShare;
      // (the side away from the floor's edge; on the left of the line when both are open)
      for (const side of [1, -1]) {
        const mx = x0 + ux * len * S.zigShare - uz * t * side, mz = z0 + uz * len * S.zigShare + ux * t * side;
        // (the tuning pass: from outside his circle (a fetch, a pass that ended past it) a side point nearer the
        // middle than he is will do: standable() refuses all past the circle, and the jet in went straight)
        const inward = Math.hypot(x0, z0) > B + 1 && Math.hypot(mx, mz) < Math.hypot(x0, z0) - 1;
        if (inward || (Math.hypot(mx, mz) < B && (d.standable?.(mx, mz) ?? true))) {
          this._legs[0].x = mx;
          this._legs[0].z = mz;
          n = 2;
          break;
        }
      }
    }
    const legs = n === 2 ? this._legs : [E];
    this.step = { t: 0, pre: pp(S.pre, ph), legs, leg: 0, speed: pp(S.speed, ph), x: x0, z: z0, gone: false, stuck: 0, max: 0, brake: -1 };
    this.step.max = this.step.pre + (len * (n === 2 ? 1.35 : 1)) / this.step.speed + 0.6;
    this.stats.steps++;
    if (n === 2) this.stats.zigs++;
    return this._stepTick(dt, s);
  }

  /** Standing in molten steel: out of it, to `poolOut` m past its rim (away from its middle, toward the
   *  hero when he stands at the middle): a jet step from phase `from`, a run before. True: it moved him. */
  _outOfPool(dt, s) {
    const d = this.d, S = this.T.step, p = d.position;
    const pool = this.game.world?.forest?.foundry?.molten?.at?.(p.x, p.z);
    if (!pool) return false;
    let ax = p.x - pool.x, az = p.z - pool.z, l = Math.hypot(ax, az);
    if (l < 0.2) {
      ax = s.dx;
      az = s.dz;
      l = s.dist || 1;
    }
    ax /= l;
    az /= l;
    const R = fin(pool.r, 2) + S.poolOut, B = d.bound - 0.3;
    let tx = pool.x + ax * R, tz = pool.z + az * R;
    for (const da of [0, 0.7, -0.7, 1.5, -1.5, Math.PI]) {
      const c = Math.cos(da), sn = Math.sin(da), x = pool.x + (ax * c + az * sn) * R, z = pool.z + (az * c - ax * sn) * R;
      if (Math.hypot(x, z) < B && (d.standable?.(x, z) ?? true) && Math.hypot(x - s.p.x, z - s.p.z) > 1.2) {
        tx = x;
        tz = z;
        break;
      }
    }
    if (d.phase >= S.from && S.on) {
      const E = this._legs[1];
      E.x = tx;
      E.z = tz;
      this.step = { t: 0, pre: 0, legs: [E], leg: 0, speed: pp(S.speed, d.phase), x: p.x, z: p.z, gone: false, stuck: 0, max: 1.2, brake: -1, pool: true };
      this.stats.outOfPool++;
      return this._stepTick(dt, s);
    }
    const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz) || 1, v = fin(d.T.move?.run, 7);
    const x0 = p.x, z0 = p.z;
    d.moveBy((dx / dl) * v * dt, (dz / dl) * v * dt);
    d.groundVelSet((p.x - x0) / Math.max(dt, 1e-4), (p.z - z0) / Math.max(dt, 1e-4));
    d.yaw = s.ang;
    return true;
  }

  _stepTick(dt, s) {
    const d = this.d, S = this.T.step, J = this.step;
    J.t += dt;
    d.groundVelSet(0, 0);
    // THE BRAKE (the owner's v04 pack, A12 deep stop / B4 brake): down into a deep planted stop, the lead
    // sole on the plates, a hand down, held `brake` s (pilot.fsBrakeK: posesBoost.js BO_BRAKE_LAYER)
    if (J.brake >= 0) {
      J.brake += dt;
      if (s) d.yaw = turnTo(d.yaw, s.ang, 10 * dt);
      return J.brake >= pp(S.brake, d.phase) ? this._stepEnd(false) : true;
    }
    // never through the hero: he brakes where he is if the hero came to him, or if the step ran long
    if (!s || (!J.pool && s.dist <= S.stop) || J.t > J.max) {
      if (!J.gone || !s) return this._stepEnd(true);
      if (J.t > J.max) this.stats.stepAborts++;
      return this._brakeNow();
    }
    if (J.t < J.pre) {
      // the boosters light, he sinks into it (the read: a dash is coming)
      d.yaw = s.ang;
      this._light('back', 0.6 + 0.4 * (J.t / J.pre));
      this._light('elbowR', 0.5);
      this._light('elbowL', 0.5);
      return true;
    }
    const L = J.legs[J.leg];
    let dx = L.x - d.position.x, dz = L.z - d.position.z, l = Math.hypot(dx, dz);
    if (!J.gone) {
      J.gone = true;
      const ux = l > 1e-3 ? dx / l : Math.sin(d.yaw), uz = l > 1e-3 ? dz / l : Math.cos(d.yaw);
      d.fx.afterimage?.(d, -ux * 1.5, -uz * 1.5, 0.4);
      d.fx.jetBurst?.(d.position.x, d.position.z, ux, uz, 0.8);
      this.game.world?.scorch?.burnCircle?.(d.position.x, d.position.z, S.scorch);
      d.emit('dragon:dash', { x: d.position.x, z: d.position.z });
    }
    this._light('back', 1);
    this._light('calfR', 0.7);
    this._light('calfL', 0.7);
    const last = J.leg === J.legs.length - 1;
    // the last leg stops short of where the hero is NOW (he may have moved)
    if (last && !J.pool) {
      const want = Math.hypot(s.p.x - d.position.x, s.p.z - d.position.z) - S.stop;
      if (want < l) {
        L.x = d.position.x + (dx / (l || 1)) * Math.max(0, want);
        L.z = d.position.z + (dz / (l || 1)) * Math.max(0, want);
        dx = L.x - d.position.x;
        dz = L.z - d.position.z;
        l = Math.hypot(dx, dz);
      }
    }
    // full speed through a first leg; the last one DECELERATES to zero at its end (v = sqrt(2 a l): the
    // speed a constant braking `decel` m/s^2 allows from here, capped at the dash's speed)
    const v = last ? Math.min(J.speed, Math.sqrt(2 * fin(S.decel, 60) * l) + 0.6) : J.speed;
    const step = Math.min(l, v * dt);
    const x0 = d.position.x, z0 = d.position.z;
    if (l > 1e-3) {
      d.moveBy((dx / l) * step, (dz / l) * step);
      d.yaw = Math.atan2(dx, dz);
    }
    const moved = Math.hypot(d.position.x - x0, d.position.z - z0);
    J.stuck = moved < step * 0.3 ? J.stuck + 1 : 0;
    if (J.stuck >= 3) {
      this.stats.stepAborts++;
      return this._brakeNow();
    }
    if (l - step < 0.05) {
      if (!last) {
        J.leg++;
        d.fx.afterimage?.(d, 0, 0, 0.35);
        d.fx.jetBurst?.(d.position.x, d.position.z, -(dz / (l || 1)), dx / (l || 1), 0.6);
      } else return this._brakeNow();
    }
    return true;
  }

  /** The dash's end: the deep planted stop (A12 / B4), its scuff and dust (C2). */
  _brakeNow() {
    const d = this.d, J = this.step;
    J.brake = 0;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    this._plant(d.position.x, d.position.z, fx, fz, 1);
    d.fx.dashTrail?.(J.x, J.z, d.position.x, d.position.z, 0.7);
    J.gone = false; // (its trail is drawn)
    return true;
  }

  /** A sole planted hard at (x, z) moving along (dx, dz): the scuff it leaves on the plates (a short furrow
   *  up to the foot: world.groundBlow, it damages nothing) and the dust (the owner's v04 pack, C2). */
  _plant(x, z, dx, dz, k = 1) {
    const d = this.d, w = this.game.world, B = this.T.brake;
    const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, len = B.scuff * k;
    const g = this._gm;
    g.kind = 'dash';
    g.power = B.power * k;
    g.r = NaN;
    g.len = len;
    g.dx = ux;
    g.dz = uz;
    g.hot = false;
    w?.groundBlow?.(x - ux * len, z - uz * len, g);
    g.len = NaN;
    g.hot = true;
    // (v04: the pack's C2 foot plant: the scuff line, grit and dust kicked ahead of the sole, sparks off a metal shin)
    d.fx.footPlant?.(x + ux * 0.3, z + uz * 0.3, ux, uz, len, B.dust * k);
    this.stats.plants++;
  }

  _stepEnd(abort) {
    const d = this.d, J = this.step, S = this.T.step;
    if (J?.gone) d.fx.dashTrail?.(J.x, J.z, d.position.x, d.position.z, 0.7);
    this.step = null;
    this.stepCool = pp(S.every, d.phase);
    if (abort) this.stats.stepAborts++;
    const s = d.brain._sense?.();
    if (s) d.yaw = s.ang;
    return true;
  }

  /** From phase 3, between moves, he hangs a hand's breadth off the floor on his thrusters (stiff: no bob). */
  _hover(dt, a) {
    const d = this.d, S = this.T.step, br = d.brain, p = d.position;
    const want = d.mode === 'foot' && !(this.step?.brake >= 0) ? pp(S.hover, d.phase) : 0;
    const pl = d.pilot;
    let k = 0;
    if (d.mode === 'foot' && want > 0) {
      if (br.falling && p.y <= want + 0.05) br.falling = false;
      if (!br.falling) {
        p.y += (want - p.y) * (1 - Math.exp(-dt * S.hoverEase));
        k = 1;
      }
    } else if (d.mode === 'act' && a && !this._flying(a) && p.y > 0 && p.y < 0.6 && !br.falling) {
      // (a move on the floor: down onto his feet at once)
      p.y = Math.max(0, p.y - dt * 4);
    }
    if (pl) pl.fsHoverK = k ? Math.min(1, fin(pl.fsHoverK) + dt * 5) : Math.max(0, fin(pl.fsHoverK) - dt * 6);
    const J = this.jets;
    d.fsThrustK = Math.max(pl?.fsHoverK ?? 0, this.step ? 1 : 0, p.y > 0.4 ? 1 : 0, J.back || 0, J.calfR || 0, J.calfL || 0);
    // the body reads one value per side for the elbow boosters (look.js FS_WEAPON_KEYS) and the core
    d.fsJetR = J.elbowR || 0;
    d.fsJetL = J.elbowL || 0;
    d.fsCoreK = Math.max(d.fsCoreK || 0, J.core || 0);
  }

  /** A beat of this move holds him in the air (a lift, the dive, a pass). */
  _flying(a) {
    const b = a.beats.find((x) => a.t < x.end + 1e-6);
    return !!b && (!!b.def.lift || !!b.def.fsDive || !!b.def.fsBlitz || !!b.def.leap);
  }

  // ================================================================ THE BOOSTER PUNCH
  /** The dash under way (the engine's `dash` moves him): its start, every piece on its line at fist height. */
  _dashMotion(b, u, s) {
    const d = this.d, D = b.def;
    if (D.fsDash.rite) {
      const k = clamp(u / Math.max(0.05, fin(D.cock, 0.84)), 0, 1);
      d.fsCoreK = u < 1 ? 0.3 + 0.7 * k : Math.max(0, 1 - (u - 1) * 2);
      if (u < 1) d.fx.coreVent?.(d.fsCoreK);
    }
    if (!b._dash || u >= 1.2) return;
    const V = this.T.votive, W = this.game.world?.destructibles;
    if (!b._fsDash) {
      b._fsDash = { x0: d.position.x, z0: d.position.z, px: d.position.x, pz: d.position.z, dx: b._dash.dx, dz: b._dash.dz, src: W?.swing?.() ?? -1 };
      this.stats.dashes++;
      d.fx.afterimage?.(d, -b._dash.dx * 1.5, -b._dash.dz * 1.5, 0.45);
      d.fx.jetBurst?.(d.position.x, d.position.z, b._dash.dx, b._dash.dz, 1);
      if (!D.fsDash.rite) this.game.shake?.(0.12);
    }
    this._light(D.fsDash.rite ? 'back' : 'elbowR', 1);
    const F = b._fsDash;
    const x = d.position.x, z = d.position.z;
    if (W?.sweep && Math.hypot(x - F.px, z - F.pz) > 0.05) {
      const o = this._o;
      o.kind = 'blunt';
      o.dx = F.dx;
      o.dz = F.dz;
      o.y = D.fsDash.rite ? 1.0 : V.y;
      o.src = F.src;
      // (the fist is ahead of him: the line runs to the fist's reach)
      W.sweep(F.px, F.pz, x + F.dx * 0.9, z + F.dz * 0.9, V.w * 0.5, V.power, o);
      this.stats.swept++;
    }
    F.px = x;
    F.pz = z;
  }

  /** After a routed beat is over: the booster punch's miss carries on; Last Rite dodged leaves him open. */
  _watch(a) {
    const d = this.d;
    for (const b of a.beats) {
      const D = b.def;
      if (!D.fsDash || b.feint || b._fsDone || a.t < b.end) continue;
      if (D.fsDash.rite) {
        // (it reached nobody: wide open)
        if (b._fsR !== RESULT.HIT) this._riteOpen(b);
        b._fsDone = true;
        continue;
      }
      b._fsDone = true;
      const missed = !LANDED.has(b._fsR);
      if (D.fsDash.carry && missed && b.last && b._fsDash) {
        const V = this.T.votive, W = this.game.world?.destructibles;
        this.carry = { dx: b._fsDash.dx, dz: b._fsDash.dz, left: V.carry, v: V.carrySpeed, crater: true, src: W?.swing?.() ?? -1, t: d.time };
        this.stats.carries++;
      }
    }
  }

  /** The carry (a missed booster punch going on into the scenery) or a parry's overshoot (past the hero). */
  _carry(dt) {
    const d = this.d, C = this.carry, V = this.T.votive;
    if (d.mode === 'dying' || d.mode === 'dead' || d.mode === 'broken' || (C.crater && d.mode !== 'act')) {
      this.carry = null;
      return;
    }
    // (it decelerates to zero over what is left: v = sqrt(2 a left), the brake's constant deceleration)
    const v = Math.min(C.v, Math.sqrt(2 * fin(this.T.step.decel, 60) * C.left) + 0.4);
    const step = Math.min(C.left, v * dt);
    const x0 = d.position.x, z0 = d.position.z;
    d.moveBy(C.dx * step, C.dz * step);
    C.left -= step;
    this._light('elbowR', 0.7);
    if (C.crater) {
      const W = this.game.world?.destructibles;
      if (W?.sweep) {
        const o = this._o;
        o.kind = 'blunt';
        o.dx = C.dx;
        o.dz = C.dz;
        o.y = V.y;
        o.src = C.src;
        W.sweep(x0, z0, d.position.x + C.dx * 0.9, d.position.z + C.dz * 0.9, V.w * 0.5, V.power, o);
      }
    }
    const moved = Math.hypot(d.position.x - x0, d.position.z - z0);
    if (C.left <= 0.02 || moved < step * 0.25) {
      this._plant(d.position.x, d.position.z, C.dx, C.dz, C.crater ? 1 : 0.7);
      if (C.crater) {
        const ex = d.position.x + C.dx * 0.9, ez = d.position.z + C.dz * 0.9;
        this._crater(ex, ez, V.crater, V.craterPower, 1.0);
        // the punch's wave goes on where his body stops (his floor's edge, a wall): `wave` m more along the
        // line at fist height (what stands past the floor's edge is reached too)
        const W = this.game.world?.destructibles;
        if (W?.sweep && V.wave > 0) {
          const o = this._o;
          o.kind = 'blunt';
          o.dx = C.dx;
          o.dz = C.dz;
          o.y = V.y;
          o.src = W.swing?.() ?? -1;
          W.sweep(ex, ez, ex + C.dx * V.wave, ez + C.dz * V.wave, V.w * 0.6, V.power * V.waveK, o);
          d.fx.dashTrail?.(ex, ez, ex + C.dx * V.wave, ez + C.dz * V.wave, 0.6);
        }
      }
      this.carry = null;
    }
  }

  /** A crater at (x, z): the world's blow (the plates there thrown), the floor's mark, the drawing. */
  _crater(x, z, r, power, k = 1) {
    const d = this.d, w = this.game.world;
    const o = this._o;
    o.kind = 'blunt';
    o.dx = o.dz = NaN;
    o.y = 0.4;
    o.src = w?.destructibles?.swing?.() ?? -1;
    w?.impact?.(x, z, r, power, o);
    const g = this._gm;
    g.kind = 'blast';
    g.power = power;
    g.r = r;
    g.dx = Math.sin(d.yaw);
    g.dz = Math.cos(d.yaw);
    w?.groundBlow?.(x, z, g);
    d.fx.crater?.(x, z, r, k);
    this.game.shake?.(0.22 + 0.15 * k);
    this.stats.craters++;
  }

  // ================================================================ THE ROSARY
  /** A piston's blow chips what stands beside the hero (left and right of the line, at chest height). */
  _chipBeside(s) {
    const d = this.d, W = this.game.world?.destructibles, RS = this.T.rosary;
    if (!W?.strike || !s) return;
    const ux = s.dx / (s.dist || 1), uz = s.dz / (s.dist || 1), o = this._o;
    o.kind = 'cut';
    o.dx = ux;
    o.dz = uz;
    o.y = 1.25;
    for (const side of [1, -1]) {
      o.src = W.swing?.() ?? -1;
      W.strike(s.p.x - uz * RS.side * side, s.p.z + ux * RS.side * side, 0.7, RS.chip, o);
    }
    this.stats.chips++;
    void d;
  }

  // ================================================================ DESCENT
  _dive(b, u, s) {
    const d = this.d, P = this.T.descent, p = d.position;
    if (!b._fsD) {
      b._fsD = { x0: p.x, z0: p.z, tx: p.x, tz: p.z, hx: p.x, hz: p.z, up: false, down: false, landed: false };
      if (s) {
        b._fsD.tx = s.p.x;
        b._fsD.tz = s.p.z;
      }
    }
    const D = b._fsD, B = d.bound;
    // the mark follows the hero (where he is going, a little) until `lock`
    if (s && u < P.lock) {
      let tx = s.p.x + s.vx * 0.25, tz = s.p.z + s.vz * 0.25;
      const r = Math.hypot(tx, tz);
      if (r > B) {
        tx *= B / r;
        tz *= B / r;
      }
      D.tx = tx;
      D.tz = tz;
    }
    if (u < P.rise) {
      // straight up
      const k = ease(clamp(u / P.rise, 0, 1));
      if (!D.up && u > 0.06) {
        D.up = true;
        d.fx.jetBurst?.(D.x0, D.z0, 0, 0, 1);
        d.fx.afterimage?.(d, 0, 0, 0.4);
        d.emit('dragon:takeoff');
        this.stats.dives++;
      }
      p.x = D.x0;
      p.z = D.z0;
      p.y = P.h * k;
      this._light('back', 1);
      this._light('calfR', 1);
      this._light('calfL', 1);
    } else if (u < P.fall) {
      // the hang: drifting over a point `short` m short of the mark (the dive comes down steep)
      const gx = D.tx - D.x0, gz = D.tz - D.z0, gl = Math.hypot(gx, gz);
      const f = gl > P.short ? (gl - P.short) / gl : 0;
      const k = ease(clamp((u - P.rise) / Math.max(0.05, P.fall - P.rise), 0, 1));
      D.hx = D.x0 + gx * f * k;
      D.hz = D.z0 + gz * f * k;
      p.x = D.hx;
      p.z = D.hz;
      p.y = P.h;
      this._light('back', 0.75);
    } else if (u < 1) {
      if (!D.down) {
        D.down = true;
        d.fx.jetBurst?.(p.x, p.z, D.tx - p.x, D.tz - p.z, 1);
        d.fx.afterimage?.(d, 0, 0.5, 0.3);
      }
      const k = clamp((u - P.fall) / Math.max(0.05, 1 - P.fall), 0, 1);
      p.x = D.hx + (D.tx - D.hx) * k;
      p.z = D.hz + (D.tz - D.hz) * k;
      p.y = P.h * (1 - k * k);
      this._light('back', 1);
    } else if (!D.landed) {
      D.landed = true;
      p.x = D.tx;
      p.z = D.tz;
      p.y = 0;
      d.moveBy(0, 0);
    } else p.y = 0;
    if (u < 1 && (Math.abs(D.tx - p.x) > 0.05 || Math.abs(D.tz - p.z) > 0.05)) d.yaw = Math.atan2(D.tx - p.x, D.tz - p.z);
    else if (s && u < P.lock) d.yaw = s.ang;
    d.state = p.y > 0.4 ? 'airborne' : 'combat';
    // the mark on the floor where he will land (the arsenal's ring: one look for "it comes down here")
    if (u >= P.rise * 0.5 && u < 1) d.fx.missileMark?.(D.tx, D.tz, P.r, clamp((u - P.rise * 0.5) / (1 - P.rise * 0.5), 0, 1));
  }

  _diveLand() {
    const d = this.d, P = this.T.descent;
    this._crater(d.position.x, d.position.z, P.r + 0.8, P.power, 1.6);
    d.fx.shock?.(d.position.x, d.position.z, P.r + 1.2);
    d.emit('dragon:land', { x: d.position.x, z: d.position.z });
  }

  // ================================================================ VESPERS
  _blitz(b, u, s, dt) {
    const F = b.def.fsBlitz;
    if (F.set !== undefined) this._set(b, u, s, F);
    else this._pass(b, u, s, F, dt);
  }

  /** A pass's set: he jets to its launch point (round the hero from where he stood as the move began). */
  _set(b, u, s, F) {
    const d = this.d, VS = this.T.vespers, a = d.brain.act, p = d.position;
    if (!a) return;
    const A = (a._fsV ??= { base: s ? Math.atan2(p.x - s.p.x, p.z - s.p.z) : d.yaw + Math.PI, lx: p.x, lz: p.z, ly: 0 });
    if (!b._fsS) {
      const hx = s ? s.p.x : p.x + Math.sin(d.yaw) * 4, hz = s ? s.p.z : p.z + Math.cos(d.yaw) * 4;
      const R = F.last ? VS.lastLaunch : VS.launch, B = d.bound - 0.3;
      let th = A.base + (F.last ? 0 : VS.turns[F.set % VS.turns.length]);
      let lx = hx + Math.sin(th) * R, lz = hz + Math.cos(th) * R;
      // (a launch point off his floor: turned round the hero toward the middle, then pulled in)
      for (const dth of [0, 0.5, -0.5, 1.0, -1.0, Math.PI]) {
        const x = hx + Math.sin(th + dth) * R, z = hz + Math.cos(th + dth) * R;
        if (Math.hypot(x, z) <= B && (d.standable?.(x, z) ?? true)) {
          lx = x;
          lz = z;
          th += dth;
          break;
        }
      }
      const l = Math.hypot(lx, lz);
      if (l > B) {
        lx *= B / l;
        lz *= B / l;
      }
      b._fsS = { x0: p.x, z0: p.z, y0: p.y, lx, lz, ly: F.last ? VS.high : 0.15, gone: false };
      A.lx = lx;
      A.lz = lz;
      A.ly = b._fsS.ly;
      this.stats.sets++;
    }
    const S = b._fsS;
    const k = ease(clamp(u / 0.7, 0, 1));
    if (!S.gone && u > 0.02) {
      S.gone = true;
      const dx = S.lx - S.x0, dz = S.lz - S.z0, l = Math.hypot(dx, dz) || 1;
      d.fx.afterimage?.(d, -dx / l, -dz / l, 0.4);
      d.fx.jetBurst?.(S.x0, S.z0, dx / l, dz / l, 0.7);
    }
    p.x = S.x0 + (S.lx - S.x0) * k;
    p.z = S.z0 + (S.lz - S.z0) * k;
    p.y = S.y0 + (S.ly - S.y0) * k;
    this._light('back', 1);
    if (s) d.yaw = Math.atan2(s.p.x - p.x, s.p.z - p.z);
    d.state = p.y > 0.4 ? 'airborne' : 'combat';
    // the line it will run, shown as soon as he is there
    if (u >= 0.5 && s) this._sight(S.lx, S.lz, s.p.x, s.p.z, F.last, 0.25 * clamp((u - 0.5) / 0.5, 0, 1));
  }

  /** The sight of a pass's line: from the launch point through the hero, on `over` m (on the floor). */
  _sight(ax, az, hx, hz, last, k) {
    const VS = this.T.vespers, dx = hx - ax, dz = hz - az, l = Math.hypot(dx, dz) || 1;
    const over = last ? 0 : VS.over;
    // (its own drawing, fx.passLine (C: every frame it shows; heat on the floor, NEVER cyan or blue: blue
    // means parry, cyan is his sensors' only; the v04 pack's rule): the fx agent's to add to FsFx)
    this.stats.lines++;
    this.d.fx.passLine?.(ax, az, hx + (dx / l) * over, hz + (dz / l) * over, k);
  }

  /** The pass: held at the launch point (the line tracks the hero until `track`), then through his spot at
   *  the impact at `speed`, on `over` m past it (the last: down onto it from above). */
  _pass(b, u, s, F, dt) {
    const d = this.d, VS = this.T.vespers, a = d.brain.act, p = d.position;
    if (!a) return;
    const G = (b._fsP ??= { fixed: false, init: false, x: p.x, z: p.z, y: p.y, tx: p.x + Math.sin(d.yaw) * 4, tz: p.z + Math.cos(d.yaw) * 4, dx: 0, dz: 1, len: 0, leave: Infinity, T: 0.1, px: p.x, pz: p.z, src: -1, done: false });
    const t = a.t;
    if (!G.fixed) {
      // (the line tracks the hero until `track` of the windup; then it is the one shown, and kept)
      if (s && (u < VS.track || !G.init)) {
        G.init = true;
        const lead = Math.min(0.3, Math.max(0, b.impact - t));
        G.tx = s.p.x + s.vx * lead;
        G.tz = s.p.z + s.vz * lead;
        const r = Math.hypot(G.tx, G.tz), B = d.bound;
        if (r > B) {
          G.tx *= B / r;
          G.tz *= B / r;
        }
      }
      G.x = p.x;
      G.z = p.z;
      G.y = p.y;
      const gx = G.tx - G.x, gz = G.tz - G.z, l = Math.hypot(gx, gz);
      d.yaw = Math.atan2(gx, gz);
      this._light('back', 0.8);
      this._light('elbowR', 0.6);
      this._sight(G.x, G.z, G.tx, G.tz, F.last, u < VS.track ? 0.3 + 0.4 * u : 1);
      if (F.last) d.fx.missileMark?.(G.tx, G.tz, VS.lastR, clamp(u, 0, 1));
      // (he leaves `dist / speed` s before the impact; the last, from above, `lastDive` s before it)
      if (b.impact - t <= (F.last ? VS.lastDive : l / VS.speed) + 0.02 || u >= 1) {
        G.fixed = true;
        G.len = Math.max(0.5, l);
        G.dx = gx / (l || 1);
        G.dz = gz / (l || 1);
        G.leave = t;
        G.T = Math.max(0.03, b.impact - t);
        G.px = G.x;
        G.pz = G.z;
        G.src = this.game.world?.destructibles?.swing?.() ?? -1;
        this.stats.passes++;
        d.fx.afterimage?.(d, -G.dx, -G.dz, 0.5);
        d.fx.jetBurst?.(G.x, G.z, G.dx, G.dz, 1);
        d.emit('dragon:dash', { x: G.x, z: G.z });
      }
      return;
    }
    // through the hero's spot at the impact, on past it at the pass's speed
    const vel = G.len / G.T, along = Math.max(0, (t - G.leave) * vel);
    let run = Math.min(G.len, along), bk = 0;
    // (past the hero's spot he brakes: `over` m more, decelerating to zero, then the planted stop)
    if (!F.last && along > G.len) {
      bk = Math.min(1, (t - G.leave - G.T) / Math.max(0.05, (2 * VS.over) / vel));
      run = G.len + VS.over * (1 - (1 - bk) * (1 - bk));
    }
    p.x = G.x + G.dx * run;
    p.z = G.z + G.dz * run;
    p.y = F.last ? G.y * Math.max(0, 1 - run / G.len) : 0.15 * (1 - bk);
    d.yaw = Math.atan2(G.dx, G.dz);
    d.state = p.y > 0.4 ? 'airborne' : 'combat';
    this._light('back', 1);
    this._light('calfR', 1);
    this._light('calfL', 1);
    // what stands on his line is thrown aside (his body through it, at chest height)
    const W = this.game.world?.destructibles;
    if (W?.sweep && Math.hypot(p.x - G.px, p.z - G.pz) > 0.05 && p.y < 2.2) {
      const o = this._o;
      o.kind = 'blunt';
      o.dx = G.dx;
      o.dz = G.dz;
      o.y = F.last ? Math.max(0.4, p.y + 0.6) : VS.y;
      o.src = G.src;
      W.sweep(G.px, G.pz, p.x, p.z, VS.w * 0.5, F.last ? VS.lastPower : VS.power, o);
      this.stats.swept++;
    }
    if (((t * 60) | 0) % 3 === 0 && p.y < 3) d.fx.afterimage?.(d, -G.dx * 1.2, -G.dz * 1.2, 0.35);
    G.px = p.x;
    G.pz = p.z;
    if (!G.done && (F.last ? run >= G.len - 1e-3 : bk >= 1)) {
      G.done = true;
      d.fx.dashTrail?.(G.x, G.z, p.x, p.z, 1);
      if (F.last) {
        p.y = 0;
        d.moveBy(0, 0);
      } else this._plant(p.x, p.z, G.dx, G.dz, 0.8);
    }
    void dt;
  }

  // ================================================================ LAST RITE
  _riteBlast() {
    const d = this.d, R = this.T.rite;
    this.stats.riteHits++;
    this._crater(d.position.x, d.position.z, R.blastR, R.power, 1.8);
    d.fx.blast?.(d.position.x, d.position.z, R.blastR, R.power);
    d.fx.shock?.(d.position.x, d.position.z, R.blastR + 1);
    this.game.shake?.(0.6);
    d.fsCoreK = 1;
  }
}

void TELL;
