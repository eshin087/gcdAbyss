import * as THREE from 'three';
import { TELL, RESULT } from '../../../combat/rules.js';
import { turnToward, wrapAngle } from '../../../core/math.js';
import { TUNING_ARSENAL } from './tuningArsenal.js';

// FsArsenal: the False Saint's guns, lasers, cannons, missiles and artillery (the ARSENAL AGENT's file;
// its moves: moves/arsenal.js; its numbers: tuningArsenal.js, TUNING.arsenal; its poses: posesArsenal.js;
// its drawings: fx.js / fxArsenal.js, the flights' pool `fx.fly`).
//
// THE HANDLER HOOKS (the routing contract, saint.js header; every one optional, called through `?.`; the
// full list, with arguments, for every handler of this boss):
//   beat (a beat routed here: one of its fields is in its file's FIELDS):
//     beatMotion(b, u, s, dt)   every frame of the beat's windup and action (u its windup share, may pass 1;
//                               s the brain's sense of the hero: { p, dx, dz, dist, ang })
//     onImpact(b, s, a)         its impact (a the act); replaces nothing: the engine's world blow and
//                               floor mark still run unless the beat is selfHit / cast
//     onRelease(b, s, a)        a `release` beat lets go
//     onCast(b, s, a)           a `cast` beat casts
//     onSustain(b, s, a, k)     a `sustain` beat's tick (k 0..1 through its life)
//     hitPlayer(o) → o          before the blow reaches the hero (change it; return the hit)
//     onHit(o, r)               after it did (r the player's RESULT)
//     onParried(info, b) → true the hero parried it: true = handled here (the engine's recoil skipped)
//     reach(b) → m | Infinity | undefined   how far it reaches (undefined: the engine's)
//   move (a move one of whose beats is routed here):
//     weigh(name, def, w, dist) → w   his AI weighs it (0: not now)
//     onActStart(A) → false     it is about to start: false refuses it
//   every handler, every frame / event:
//     frame(dt)                 after the brain (FalseSaint.brainFrame)
//     afterPose(dt, a)          after the pose (his points are fresh: d.handPoint, d.partPoint)
//     footwork(dt, s) → true    before the engine's footwork; true = it moved him this frame
//     takeHit(o) → o | false | undefined   a cut of the hero's, before the engine's: false = it does
//                               nothing (an armoured walk turns it aside); an object = the cut changed
//     stop()                    a reaction, a break, his death: let go of what it holds
//     reset()                   the fight's reset
//
// WHAT IT DOES (the moves: moves/arsenal.js; every number: tuningArsenal.js):
//   THE BEAMS (one lit at a time, `this.B`; the beats are `selfHit` + `sustain`: the brain cues, holds,
//     feints and ledgers them as any blow, this deals the hit and bites the world; a beat the fairness guard
//     turned into a feint is never lit):
//     vigil        the eye laser: the sight line across the hero's spot (fixed at `fix`), the foot drawn
//                  along it from the cue, crossing his spot at the impact
//     bell         Passing Bell: up on the thrusters (the beat's `lift`), the flight line shown (fx.passLine),
//                  the pass along it (he leaves so the laser's foot, ahead of him, crosses the hero's spot
//                  at the impact), the eye laser cutting the floor beneath him the whole way
//     palm         Absolution: the palm's iris charging, the beam lit at the impact on the fixed bearing,
//                  swept toward the hero's side while he walks sideways
//     twin         Revelation's first beat: both palms, lit at the cue either side of the hero's bearing,
//                  converging to cross on it at the impact
//     core         Revelation's second: the core cannon, lit at its impact, swept `arc` degrees
//     Each: ONE hit on the hero (red; a roll through it spends it), its cover (the first piece flagged cover
//     on its line stops it and takes `beams.cover` a tick until it melts), what stands on it struck every
//     `beams.every` s at its real height (a fresh swing id: a held beam keeps biting), a trench of world.impact
//     stations ('beam' marks), world.groundBlow 'beam' scars along it, fx.scar / fx.cannonEnd's glow.
//   THE BOLTS (Triptych): each leaves the gun after its beat's glint so it arrives AT the impact (fx.fly
//     'bolt', expect false: the beat is the ledger's); a hero there takes it (blue); a PERFECT parry sends it
//     home (a second flight into his chest: d.hurt, `dragon:returned`); a miss flies on and bites the set.
//   THE MISSILES (Choir): fx.fly 'missile', each with its own ledger handle from the launch (moved later by
//     brain.fairDelay, or not fired), its red flash on its mark flashLead before it lands (when the hero is
//     near it), cut out of the air by the hero's swing (rec.cancel(): the handle goes too), a crater.
//   THE BARRAGE (Kyrie): rows fired `rowGap` s apart from the first salvo (frame), one shared ledger handle
//     per row, the lanes laid round the hero (the rule in tuningArsenal.js), then the great shell.
//   THE LANCE (Verdict): the reticle on the hero through the windup, locked at the cast; the pillar
//     `fall` s later (its handle, its flash), the ring shock after it (normal: cued as it nears the hero,
//     its handle retimed until then), the molten crater (foundry.molten.add) once the ring has run.
// THE SURFACE (others may read):
//   stats   { beams, beamHits, bolts, boltHits, returned, missiles, missileHits, cut, dropped, rows, shells,
//             shellHits, greats, lances, lanceHits, rings, ringHits, pools, struck, marks, covered, delays }
//   B       the beam lit now ({ on, kind, ... }) · L the lance ({ on, phase, x, z, at }) · K the barrage
//   live()  how many of its flights are in the air
// THE BODY'S VALUES (set every frame, 0..1; the body draws them: look.js FS_WEAPON_KEYS): d.fsPalmK (the
//   palm's iris), d.fsGunK (the forearm gun), d.fsPetalK (the shoulder cells), d.fsTubeK (the mortar
//   tubes), d.fsCoreK (raised, never lowered here: the boost handler's Last Rite drives it too), d.eyesK
//   (the sensors' light: kept low, at most `beams.eyes`: cyan is cosmetic, the tell is the red flare);
//   d.fsHandR 'reach' while a palm aims or fires, 'guard' after; d.fsJets.back / calfR / calfL lit through
//   the pass (the boost handler's jets object: it decays and draws them).
// No Math.random: every choice is a fixed rule (the side a beam sweeps to: the hero's side of its line);
// nothing allocated per frame (the records are fixed; fx.fly's options object is reused).

const DEG = Math.PI / 180;
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph | 0)) - 1] : v);
const LANDED = new Set([RESULT.HIT, RESULT.BLOCKED, RESULT.PARRIED, RESULT.CLASHED]);
const WANT = Object.freeze(['fsPalmK', 'fsGunK', 'fsPetalK', 'fsTubeK', 'fsCoreK', 'eyesK']);
const OWN = Object.freeze(['fsPalmK', 'fsGunK', 'fsPetalK', 'fsTubeK', 'eyesK']); // (the values it alone drives)

/** The 2D distance from (px, pz) to the segment a → b. */
function segD(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const u = L2 > 1e-9 ? clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1) : 0;
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
}
/** The 3D distance from p to the segment a → b. */
function segD3(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
  const u = L2 > 1e-9 ? clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2, 0, 1) : 0;
  return Math.hypot(px - ax - dx * u, py - ay - dy * u, pz - az - dz * u);
}

/** The time (s from its start) a decelerating shock front (DuelFx.shock's law: r0 → r1 over T, drag
 *  2.4 / T) reaches `rho` m; Infinity past r1. */
function frontTime(rho, r0, r1, T) {
  if (rho <= r0) return 0;
  if (rho > r1) return Infinity;
  const D = 2.4 / T, full = (1 - Math.exp(-D * T)) / D, want = ((rho - r0) / Math.max(1e-3, r1 - r0)) * full;
  const q = 1 - D * want;
  return q > 1e-6 ? -Math.log(q) / D : T;
}
/** The front's radius `t` s after its start (the same law). */
function frontAt(t, r0, r1, T) {
  const D = 2.4 / T, full = (1 - Math.exp(-D * T)) / D;
  return r0 + (r1 - r0) * Math.min(1, (1 - Math.exp(-D * Math.max(0, t))) / D / full);
}

export class FsArsenal {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this.T = d.T?.arsenal ?? TUNING_ARSENAL;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._e = new THREE.Vector3();
    // the world's blow records (reused)
    this._wo = { kind: 'cut', by: 'boss', dx: 0, dz: 0, y: 0.3, ya: undefined, yb: undefined, src: -1, scar: true, spare: undefined };
    this._to = { kind: 'blast', by: 'boss', dx: 0, dz: 0, y: 0.2, src: -1, scar: true, mark: 'beam', hot: true, len: NaN };
    this._bo = { kind: 'blast', by: 'boss', dx: NaN, dz: NaN, y: 0.5, src: -1, scar: true, marked: true, falloff: 0.25 };
    this._gb = { kind: 'beam', power: 1, dx: 0, dz: 1, len: 1, w: 0.5, by: 'boss', hot: true };
    this._gm = { kind: 'blast', power: 1, r: 1.5, dx: 0, dz: 1, by: 'boss', hot: true };
    this._hit = { damage: 0, knockback: 0, knockdown: false, kind: 'beam', tell: TELL.RED, attack: '', from: { x: 0, z: 0 }, projectile: true, parryable: false, blockable: false, flare: false, parryPosture: 0, beat: null, extra: null };
    this._fl = { source: 'dragon', attack: '', tell: TELL.RED, x: 0, y: 0.4, z: 0, hazard: true, flare: false };
    this._fo = {}; // fx.fly's options (reused: fly copies what it needs)
    this._stations = new Set();
    this.B = { on: false, kind: '', b: null, a: null, t: 0, hit: false, next: 0, mark: 0, ox: 0, oy: 0, oz: 0, ex: 0, ey: 0, ez: 0, dx: 0, dz: 1, len: 0, w: 1, yaw: 0, sign: 1, swept: 0, cover: null, src: -1, fsrc: -1, fx: 0, fz: 0, px: 0, pz: 0, ax: 0, az: 0, bx: 0, bz: 0, ux: 0, uz: 1, ox2: 0, oz2: 0, ex2: 0, ez2: 0, dx2: 0, dz2: 1, hx: 0, hz: 0 };
    this.L = { on: false, phase: 'off', x: 0, z: 0, at: 0, cue: null, cued: false, ring: null, rcue: null, rcued: false, rt0: 0, rhit: false, ru: 0, act: null, pool: 0, landed: false, ringOn: false, k: 0 };
    this.K = { on: false, act: null, row: 0, next: 0, x0: 0, z0: 0, ux: 0, uz: 1, along0: 0 };
    this.M = Array.from({ length: 14 }, () => ({ rec: null, id: 0, near: false }));
    this.S = Array.from({ length: 24 }, () => ({ rec: null, id: 0, row: -1, near: false, great: false }));
    this.Bo = Array.from({ length: 6 }, () => ({ rec: null, id: 0, b: null, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, cover: null, back: false, leg: 0 }));
    this.want = Object.fromEntries(WANT.map((k) => [k, 0]));
    this.k = Object.fromEntries(WANT.map((k) => [k, 0]));
    this._drove = Object.fromEntries(OWN.map((k) => [k, false]));
    this._hand = false;
    this._boltLand = (r) => this._onBolt(r);
    this._boltHome = (r) => this._onBoltHome(r);
    this._boltOn = (r) => this._onBoltCarry(r);
    this._mCue = (r) => this._onMissileCue(r);
    this._mLand = (r) => this._onMissile(r);
    this._sCue = (r) => this._onShellCue(r);
    this._sLand = (r) => this._onShell(r);
    this.reset();
  }

  get F() {
    return this.game.world?.forest?.foundry ?? null;
  }

  reset() {
    this.stats = {
      beams: 0, beamHits: 0, bolts: 0, boltHits: 0, returned: 0, missiles: 0, missileHits: 0, cut: 0, dropped: 0, rows: 0, shells: 0, shellHits: 0, greats: 0,
      lances: 0, lanceHits: 0, rings: 0, ringHits: 0, pools: 0, struck: 0, marks: 0, covered: 0, delays: 0,
    };
    this.B.on = false;
    this.L.on = false;
    this.L.phase = 'off';
    this.K.on = false;
    for (const s of this.M) s.rec = null;
    for (const s of this.S) s.rec = null;
    for (const s of this.Bo) s.rec = null;
    this._stations.clear();
    for (const k of WANT) this.want[k] = this.k[k] = 0;
    const d = this.d;
    for (const k of OWN) {
      d[k] = 0;
      if (this._drove) this._drove[k] = false;
    }
    if (this._hand) d.fsHandR = 'guard';
    this._hand = false;
    try {
      d.fx?.cancelFlights?.();
    } catch (err) {
      console.error('[saint] arsenal reset', err);
    }
  }

  /** A reaction, a break, his death: the beam goes out, a reticle not yet locked goes, the barrage's rows
   *  not yet fired are dropped. What already flies keeps flying (it is cued), unless he is dying. */
  stop() {
    this._beamOff(false);
    if (this.L.on && this.L.phase === 'track') this._lanceOff();
    this.K.on = false;
    const d = this.d;
    if (!(d.hp > 0) || d.mode === 'dying' || d.mode === 'dead') this._cancelAll();
  }

  /** How many of its flights are in the air. */
  live() {
    let n = 0;
    for (const s of this.M) if (this._alive(s)) n++;
    for (const s of this.S) if (this._alive(s)) n++;
    for (const s of this.Bo) if (this._alive(s)) n++;
    return n;
  }
  _alive(s) {
    return !!s.rec && s.rec.alive && s.rec.id === s.id;
  }

  _cancelAll() {
    for (const s of this.M) if (this._alive(s)) s.rec.cancel();
    for (const s of this.S) if (this._alive(s)) s.rec.cancel();
    for (const s of this.Bo) if (this._alive(s)) s.rec.cancel();
    this._lanceOff();
    this.K.on = false;
  }

  // ================================================================ the move hooks
  /** Every beat of his arsenal reaches wherever the hero is (a shot: its own reach). */
  reach() {
    return Infinity;
  }

  weigh(name, def, w) {
    // (one salvo at a time: no swarm or barrage while his last one is in the air; one lance)
    if ((name === 'choir' || name === 'kyrie') && (this.live() > 0 || this.K.on)) return 0;
    if (name === 'verdict' && this.L.on) return 0;
    return w;
  }

  onActStart() {
    return !this.B.on;
  }

  // ---------------------------------------------------------------- every frame of a routed beat
  beatMotion(b, u, s, dt) {
    const D = b.def, d = this.d, a = d.brain?.act;
    if (!a) return;
    if (D.fsLaser?.kind === 'vigil') this._vigilMotion(b, u, s, a);
    else if (D.fsLaser?.kind === 'bell') this._bellMotion(b, u, s, a, dt);
    else if (D.fsCannon) this._cannonMotion(b, u, s, a, dt);
    else if (D.fsBolt) this._boltMotion(b, u, s, a);
    else if (D.fsMissile) this._want('fsPetalK', 0.2 + 0.8 * clamp01(u / Math.max(0.1, D.cock ?? 0.75)));
    else if (D.fsMortar) this._want('fsTubeK', clamp01(u * 1.6));
    else if (D.fsLance) this._lanceTrack(b, u, s);
  }

  onImpact(b, s, a) {
    const D = b.def;
    if (b.feint) return;
    if (D.fsCannon && (D.fsCannon.kind === 'palm' || D.fsCannon.kind === 'core')) this._cannonLight(b, s, a);
    else if (D.fsCannon?.kind === 'twin' && !(this.B.on && this.B.b === b)) this._twinLight(b, s, a);
    else if (D.fsLaser?.kind === 'vigil' && !(this.B.on && this.B.b === b)) this._vigilLight(b, a);
    else if (D.fsBolt && !b._fsShot) this._boltFire(b, s, a, 0.05);
  }

  onCast(b, s, a) {
    const D = b.def;
    if (D.fsMissile) this._choir(b, s, a);
    else if (D.fsMortar?.first) this._kyrieStart(b, s, a);
    else if (D.fsMortar?.great) this._greatShell(b, s, a);
    else if (D.fsLance) this._lanceLock(b, s, a);
  }

  // ---------------------------------------------------------------- every frame
  frame(dt) {
    const d = this.d;
    try {
      if (d.mode === 'dying' || d.mode === 'dead') {
        if (this.B.on || this.L.on || this.K.on || this.live() > 0) this._cancelAll();
        this._beamOff(false);
      }
      this._kyrieRows();
      this._lanceFrame(dt);
      this._cutMissiles();
      if (this.B.on && (d.brain?.act !== this.B.a || d.mode !== 'act')) this._beamOff(true);
      this._body(dt);
    } catch (err) {
      console.error('[saint] arsenal frame', err);
    }
  }

  /** After the pose (his points are fresh): the beams (their hits, the world, the drawing), the sights. */
  afterPose(dt) {
    const d = this.d, a = d.brain?.act;
    try {
      if (d.mode === 'act' && a) this._sights(a);
      if (this.B.on) this._beam(dt);
      if (this.L.on) this._lanceDraw();
    } catch (err) {
      console.error('[saint] arsenal afterPose', err);
      this.B.on = false;
    }
  }

  // ---------------------------------------------------------------- the body's values
  _want(key, v) {
    if (v > this.want[key]) this.want[key] = v;
  }

  _body(dt) {
    const d = this.d;
    for (const k of WANT) {
      const w = this.want[k];
      this.k[k] = w > this.k[k] ? Math.min(w, this.k[k] + dt * 6) : Math.max(w, this.k[k] - dt * 2.5);
      this.want[k] = 0;
    }
    // (written only while it drives them, and once more as each comes back to 0: a value set by someone
    // else (the Lab, the body's checks) is left alone while the arsenal is idle)
    for (const k of OWN) {
      const v = k === 'eyesK' ? Math.min(this.T.beams.eyes, this.k[k]) : this.k[k];
      if (v > 0 || this._drove[k]) d[k] = v;
      this._drove[k] = v > 0;
    }
    // (raised only: the boost handler's Last Rite drives the core too, and it decays it)
    if (this.k.fsCoreK > fin(d.fsCoreK)) d.fsCoreK = this.k.fsCoreK;
    // the hand: open and reaching while a palm aims or fires, back to the guard after
    const a = d.brain?.act;
    let b = null;
    if (a && d.mode === 'act') {
      for (const x of a.beats) {
        if (a.t < x.end + 1e-6) {
          b = x;
          break;
        }
      }
    }
    const palm = !!b && (b.def.fsCannon?.kind === 'palm' || b.def.fsCannon?.kind === 'twin' || (!!b.def.fsLance && a.t >= b.start + b.W * 0.5));
    if (palm) {
      d.fsHandR = 'reach';
      this._hand = true;
    } else if (this._hand) {
      d.fsHandR = 'guard';
      this._hand = false;
    }
    // the pass's thrusters (the boost handler's jets: it decays and draws them)
    const J = d.fsJets;
    if (J && b?.def.fsLaser?.kind === 'bell' && d.position.y > 0.3) {
      J.back = Math.max(J.back, 1);
      J.calfR = Math.max(J.calfR, 0.8);
      J.calfL = Math.max(J.calfL, 0.8);
    }
  }

  // ================================================================ THE HERO
  /** One of his shots at the hero: the reused record; returns the player's RESULT. */
  _hitHero(attack, tell, damage, knockback, knockdown, fx, fz, o = null) {
    const h = this._hit;
    h.attack = attack;
    h.tell = tell;
    h.damage = damage;
    h.knockback = knockback;
    h.knockdown = !!knockdown;
    h.from.x = fx;
    h.from.z = fz;
    h.kind = o?.kind ?? 'beam';
    h.parryable = !!o?.parryable;
    h.blockable = !!o?.blockable;
    h.parryPosture = fin(o?.posture, 0);
    h.beat = o?.beat ?? null;
    h.flare = false;
    return this.d.hitPlayer(h);
  }

  /** The hero's position and radius, or null (gone, dead). */
  _hero() {
    const p = this.game.player;
    return p?.position && p.alive !== false && Number.isFinite(p.position.x + p.position.z) ? p : null;
  }

  /** A red flash where something of his lands away from him (the ledger, the HUD, the bots read it). */
  _flash(attack, tell, x, y, z, hazard = true) {
    const f = this._fl, d = this.d;
    f.attack = attack;
    f.tell = tell;
    f.x = x;
    f.y = y;
    f.z = z;
    f.hazard = hazard;
    d.emit('combat:flash', f);
    d.fx?.hazardFlash?.(tell, x, y, z, 1);
  }

  // ================================================================ THE WORLD
  /** What stands on the segment a → b (r wide) is struck (`kind`, at the heights ya → yb). */
  _sweep(ax, az, bx, bz, r, power, kind, ya, yb, src, spare = undefined) {
    const D = this.game.world?.destructibles;
    if (!D?.sweep || !(power > 0)) return 0;
    const o = this._wo, l = Math.hypot(bx - ax, bz - az) || 1;
    o.kind = kind;
    o.dx = (bx - ax) / l;
    o.dz = (bz - az) / l;
    o.y = (ya + yb) / 2;
    o.ya = ya;
    o.yb = yb;
    o.src = src >= 0 ? src : D.swing?.() ?? -1;
    o.spare = spare;
    const n = D.sweep(ax, az, bx, bz, r, power, o) | 0;
    o.spare = undefined;
    o.ya = o.yb = undefined;
    this.stats.struck += n;
    return n;
  }

  /** A blast at (x, z): the pieces within r take `power` (a falloff to the rim), the floor's blast mark,
   *  the crater's drawing is the effect's (the flights burst by themselves). */
  _blast(x, z, r, power, hot = true, fire = 0) {
    const w = this.game.world;
    const o = this._bo;
    o.src = w?.destructibles?.swing?.() ?? -1;
    o.fire = fire;
    this.stats.struck += w?.impact?.(x, z, r, power, o) | 0;
    const g = this._gm;
    g.kind = 'blast';
    g.power = power;
    g.r = r;
    g.dx = Math.sin(this.d.yaw);
    g.dz = Math.cos(this.d.yaw);
    g.hot = hot;
    g.len = NaN;
    w?.groundBlow?.(x, z, g);
    this.stats.marks++;
  }

  /** A hot beam scar on the plates a → b, `w` wide (world.groundBlow 'beam': the floor keeps it). */
  _scar(ax, az, bx, bz, w, power) {
    const L = Math.hypot(bx - ax, bz - az);
    if (!(L > 0.3)) return;
    const g = this._gb;
    g.kind = 'beam';
    g.power = power;
    g.dx = (bx - ax) / L;
    g.dz = (bz - az) / L;
    g.len = L;
    g.w = w;
    g.hot = true;
    this.game.world?.groundBlow?.(ax, az, g);
    this.stats.marks++;
  }

  /** The beam's trench under the line from (x, z) along (dx, dz), `len` m: world.impact stations on a grid
   *  (each spot once per beam), set alight. */
  _trench(x, z, dx, dz, len, r, power, step, ignite) {
    const w = this.game.world;
    if (!w?.impact) return;
    const t = this._to;
    t.dx = dx;
    t.dz = dz;
    t.src = w.destructibles?.swing?.() ?? -1;
    for (let s = 1.0, n = 0; s <= len && n < 24; s += step) {
      const sx = x + dx * s, sz = z + dz * s;
      const key = Math.round(sx / step) * 4096 + Math.round(sz / step);
      if (this._stations.has(key)) continue;
      this._stations.add(key);
      n++;
      this.stats.struck += w.impact(sx, sz, r, power, t) | 0;
      if (ignite > 0) w.ignite?.(sx, sz, r + 0.2, ignite);
    }
  }

  // ================================================================ THE BEAMS
  _beamOff(scar) {
    const B = this.B, d = this.d;
    if (!B.on) return;
    B.on = false;
    if (!scar) return;
    try {
      if (B.kind === 'vigil' || B.kind === 'bell') {
        // (cut short: the scar to where the foot got)
        const k = B.kind === 'vigil' ? this.T.vigil : this.T.passingBell;
        if (B.kind === 'bell') this._scar(B.ax, B.az, B.fx, B.fz, k.scarW, k.markPower);
        else this._scar(B.ax, B.az, B.fx, B.fz, k.scarW, k.markPower);
        d.fx.scar?.(B.ax, B.az, B.fx, B.fz, k.scarW, 1);
      } else {
        d.fx.cannonEnd?.(B.ox, B.oz, B.ex, B.ez, B.w);
        if (B.kind === 'twin') d.fx.cannonEnd?.(B.ox2, B.oz2, B.ex2, B.ez2, B.w);
      }
    } catch (err) {
      console.error('[saint] arsenal beam end', err);
    }
  }

  /** A beam record for beat b of act a. */
  _beamOn(kind, b, a) {
    const B = this.B, W = this.game.world?.destructibles;
    if (B.on) this._beamOff(true);
    B.on = true;
    B.kind = kind;
    B.b = b;
    B.a = a;
    B.t = 0;
    B.hit = false;
    B.next = 0;
    B.mark = 0;
    B.swept = 0;
    B.cover = null;
    B.src = W?.swing?.() ?? -1;
    B.fsrc = W?.swing?.() ?? -1;
    this._stations.clear();
    this.stats.beams++;
    return B;
  }

  /** The hero against a strip from (ox, oz) along (dx, dz), `len` long and `w` wide (his radius added). */
  _inStrip(p, ox, oz, dx, dz, len, w) {
    const pr = fin(p.radius, 0.45), qx = p.position.x - ox, qz = p.position.z - oz;
    const along = qx * dx + qz * dz, across = -qx * dz + qz * dx;
    return along >= -pr - 0.2 && along <= len + pr && Math.abs(across) <= w / 2 + pr;
  }

  /** The beam's one hit on a hero in it (from the cue's moment on): red, a roll spends it. */
  _beamHit(B, attack, damage, knockback, fromX, fromZ) {
    if (B.hit) return;
    B.hit = true;
    const r = this._hitHero(attack, TELL.RED, damage, knockback, true, fromX, fromZ, { beat: B.b });
    if (r === RESULT.IGNORED) B.hit = false;
    else if (r === RESULT.HIT) this.stats.beamHits++;
  }

  // ---------------------------------------------------------------- the sights through the windups
  _sights(a) {
    const d = this.d, fx = d.fx;
    for (const b of a.beats) {
      if (b.feint || a.t >= b.impact || a.t < b.start) continue;
      const D = b.def, F = b._fs;
      // (k 0..1 to the fire: the cue, when the laser lights and the line it showed is drawn)
      const u = clamp01((a.t - b.start) / Math.max(0.05, b.flash - b.start));
      if (D.fsLaser?.kind === 'vigil' && F && !(this.B.on && this.B.b === b)) fx.sightLine?.(F.ax, F.az, F.bx, F.bz, u, true);
      else if (D.fsLaser?.kind === 'bell' && F) fx.passLine?.(F.ax, F.az, F.bx, F.bz, F.fixed ? 0.5 + 0.5 * u : 0.25 + 0.3 * u);
      else if (D.fsCannon) {
        if (D.fsCannon.kind === 'palm') fx.cannonCharge?.('palmR', u);
        else if (D.fsCannon.kind === 'twin') {
          fx.cannonCharge?.('palmR', u);
          fx.cannonCharge?.('palmL', u);
          fx.cannonCharge?.('core', u * 0.6);
          d.game.world?.forest?.ambience?.dim?.(u * this.T.revelation.dim);
        } else fx.cannonCharge?.('core', 0.5 + 0.5 * u);
      }
      break;
    }
  }

  _beam(dt) {
    const B = this.B, d = this.d, a = B.a;
    if (!a || d.brain.act !== a || d.mode !== 'act') {
      this._beamOff(true);
      return;
    }
    B.t += dt;
    switch (B.kind) {
      case 'vigil':
        this._vigilLit(B, a);
        break;
      case 'bell':
        this._bellLit(B, a);
        break;
      case 'twin':
        this._twinLit(B, a, dt);
        break;
      default:
        this._cannonLit(B, a, dt);
    }
  }

  // ---------------------------------------------------------------- VIGIL
  /** The line the cut will draw: across the hero's spot (led), square to his line of sight. */
  _vigilMotion(b, u, s, a) {
    const V = this.T.vigil, d = this.d;
    const F = (b._fs ??= { ax: 0, az: 0, bx: 0, bz: 0, cx: 0, cz: 0, ux: 1, uz: 0, fixed: false, init: false });
    if (s && (!F.fixed || !F.init)) {
      F.init = true;
      let cx = s.p.x + fin(s.vx) * V.lead, cz = s.p.z + fin(s.vz) * V.lead;
      const dx = cx - d.position.x, dz = cz - d.position.z, l = Math.hypot(dx, dz) || 1;
      if (l < 1.5) {
        cx = d.position.x + (dx / l) * 1.5;
        cz = d.position.z + (dz / l) * 1.5;
      }
      F.cx = cx;
      F.cz = cz;
      F.ux = dz / l;
      F.uz = -dx / l;
      F.ax = cx - F.ux * V.half;
      F.az = cz - F.uz * V.half;
      F.bx = cx + F.ux * V.half;
      F.bz = cz + F.uz * V.half;
      if (u >= V.fix) F.fixed = true;
    }
    if (F.fixed) d.yaw = turnToward(d.yaw, Math.atan2(F.cx - d.position.x, F.cz - d.position.z), 10 * Math.max(1e-3, this.game.dt ?? 0.016));
    this._want('eyesK', 0.2 + 0.25 * clamp01(u));
    // lit at the cue (the brain's flare at his eye): the foot at the line's start, on its way
    if (b.flashed && !b.feint && u < 1 && !(this.B.on && this.B.b === b)) this._vigilLight(b, a);
  }

  _vigilLight(b, a) {
    const F = b._fs;
    if (!F) return;
    const B = this._beamOn('vigil', b, a);
    B.ax = F.ax;
    B.az = F.az;
    B.bx = F.bx;
    B.bz = F.bz;
    B.ux = F.ux;
    B.uz = F.uz;
    B.fx = B.px = F.ax;
    B.fz = B.pz = F.az;
  }

  _vigilLit(B, a) {
    const V = this.T.vigil, d = this.d, b = B.b, total = V.half * 2;
    // the foot crosses the line's middle at the impact
    const run = clamp(V.half + V.speed * (a.t - b.impact), 0, total + 0.4);
    B.px = B.fx;
    B.pz = B.fz;
    B.fx = B.ax + B.ux * Math.min(run, total);
    B.fz = B.az + B.uz * Math.min(run, total);
    const E = d.eyePoint(this._e);
    this._want('eyesK', this.T.beams.eyes);
    // the hero: the foot passing him, from the cue's moment
    const p = this._hero();
    if (p && !B.hit && a.t >= b.impact - this.T.beams.hitFrom && segD(p.position.x, p.position.z, B.px, B.pz, B.fx, B.fz) <= V.hitR + fin(p.radius, 0.45)) {
      this._beamHit(B, a.name, V.damage, V.knockback, d.position.x, d.position.z);
    }
    // the world: the foot's path cut at its height (plates and all), the beam from his eye every tick
    if (Math.hypot(B.fx - B.px, B.fz - B.pz) > 0.02) this._sweep(B.px, B.pz, B.fx, B.fz, V.hitR, V.power, 'cut', V.y, V.y, B.fsrc);
    if (B.t >= B.next) {
      B.next += this.T.beams.every;
      this._sweep(E.x, E.z, B.fx, B.fz, 0.25, V.airPower, 'cut', E.y, V.y, -1);
    }
    d.fx.laser?.(E.x, E.y, E.z, B.fx, 0.2, B.fz, 1);
    if (run >= total + 0.3) {
      // the line drawn: its scar on the plates
      this._scar(B.ax, B.az, B.bx, B.bz, V.scarW, V.markPower);
      d.fx.scar?.(B.ax, B.az, B.bx, B.bz, V.scarW, 1);
      B.on = false;
    }
  }

  // ---------------------------------------------------------------- PASSING BELL
  _bellMotion(b, u, s, a, dt) {
    const P = this.T.passingBell, d = this.d, p = d.position;
    const F = (b._fs ??= { ax: 0, az: 0, bx: 0, bz: 0, hx: 0, hz: 0, ux: 0, uz: 1, len: 0, dh: 0, v: P.speed, go: -1, fixed: false, init: false, done: false });
    if (!F.fixed && s) {
      F.init = true;
      const hx = s.p.x + fin(s.vx) * 0.2, hz = s.p.z + fin(s.vz) * 0.2;
      const dx = hx - p.x, dz = hz - p.z, dh = Math.hypot(dx, dz);
      const ux = dh > 1e-3 ? dx / dh : Math.sin(d.yaw), uz = dh > 1e-3 ? dz / dh : Math.cos(d.yaw);
      // where the line leaves his circle beyond the hero (at most `beyond` m past him)
      const R = Math.max(2, fin(d.bound, 13.8) - 0.4), ad = p.x * ux + p.z * uz, c = p.x * p.x + p.z * p.z - R * R;
      const tx = -ad + Math.sqrt(Math.max(0, ad * ad - c));
      const len = Math.max(dh + 2, Math.min(dh + P.beyond, tx));
      F.ax = p.x;
      F.az = p.z;
      F.hx = hx;
      F.hz = hz;
      F.ux = ux;
      F.uz = uz;
      F.dh = dh;
      F.len = len;
      F.bx = p.x + ux * len;
      F.bz = p.z + uz * len;
      if (u >= P.fix) {
        F.fixed = true;
        // he leaves so the foot (ahead of him) reaches the hero's spot at the impact
        const left = Math.max(0.12, b.impact - a.t), need = Math.max(0, dh - P.foot);
        F.v = Math.max(P.speed, need / left);
        F.go = b.impact - need / F.v;
      }
    }
    if (F.fixed) d.yaw = Math.atan2(F.ux, F.uz);
    this._want('eyesK', 0.15 + 0.2 * clamp01(u));
    if (!F.fixed || b.feint || F.done) return;
    if (a.t >= F.go) {
      if (!(this.B.on && this.B.b === b)) {
        const B = this._beamOn('bell', b, a);
        B.ax = F.ax + F.ux * Math.min(P.foot, F.len);
        B.az = F.az + F.uz * Math.min(P.foot, F.len);
        B.fx = B.px = B.ax;
        B.fz = B.pz = B.az;
        B.ux = F.ux;
        B.uz = F.uz;
        B.bx = F.bx;
        B.bz = F.bz;
        d.fx.afterimage?.(d, -F.ux, -F.uz, 0.45);
        d.fx.jetBurst?.(p.x, p.z, F.ux, F.uz, 1);
        d.emit('dragon:dash', { x: p.x, z: p.z });
      }
      const run = Math.min(F.len, (a.t - F.go) * F.v);
      p.x = F.ax + F.ux * run;
      p.z = F.az + F.uz * run;
      if (((a.t * 60) | 0) % 4 === 0 && run < F.len) d.fx.afterimage?.(d, -F.ux * 1.2, -F.uz * 1.2, 0.35);
      if (run >= F.len - 1e-3) {
        F.done = true;
        d.fx.dashTrail?.(F.ax, F.az, p.x, p.z, 1);
      }
    }
    void dt;
  }

  _bellLit(B, a) {
    const P = this.T.passingBell, d = this.d, b = B.b, F = b._fs;
    const E = d.eyePoint(this._e);
    // the foot: `foot` m ahead of him on the line, never past its end
    const p = d.position;
    const al = (p.x - F.ax) * F.ux + (p.z - F.az) * F.uz;
    const fAl = Math.min(F.len, al + P.foot);
    B.px = B.fx;
    B.pz = B.fz;
    B.fx = F.ax + F.ux * fAl;
    B.fz = F.az + F.uz * fAl;
    this._want('eyesK', this.T.beams.eyes);
    const h = this._hero();
    if (h && !B.hit && a.t >= b.impact - this.T.beams.hitFrom && segD(h.position.x, h.position.z, B.px, B.pz, B.fx, B.fz) <= P.hitR + fin(h.radius, 0.45)) {
      this._beamHit(B, a.name, P.damage, P.knockback, B.px - F.ux, B.pz - F.uz);
    }
    if (Math.hypot(B.fx - B.px, B.fz - B.pz) > 0.02) this._sweep(B.px, B.pz, B.fx, B.fz, P.hitR, P.power, 'cut', P.y, P.y, B.fsrc);
    if (B.t >= B.next) {
      B.next += this.T.beams.every;
      this._sweep(E.x, E.z, B.fx, B.fz, 0.25, P.airPower, 'cut', E.y, P.y, -1);
    }
    d.fx.laser?.(E.x, E.y, E.z, B.fx, 0.2, B.fz, 1);
    if (F.done && fAl >= F.len - 1e-3) {
      this._scar(B.ax, B.az, B.fx, B.fz, P.scarW, P.markPower);
      d.fx.scar?.(B.ax, B.az, B.fx, B.fz, P.scarW, 1.2);
      B.on = false;
    }
  }

  // ---------------------------------------------------------------- THE CANNONS (absolution, the core)
  _cannonMotion(b, u, s, a) {
    const D = b.def, d = this.d, kind = D.fsCannon.kind;
    const C = kind === 'palm' ? this.T.absolution : this.T.revelation;
    const fix = kind === 'core' ? C.core.cock : C.fix;
    const F = (b._fs ??= { yaw: d.yaw, fixed: false, hx: 0, hz: 0, hd: 0 });
    if (u < 1) {
      if (!F.fixed && s) {
        F.yaw = Math.atan2(s.p.x + fin(s.vx) * 0.15 - d.position.x, s.p.z + fin(s.vz) * 0.15 - d.position.z);
        F.hx = s.p.x;
        F.hz = s.p.z;
        F.hd = s.dist;
        if (u >= fix) F.fixed = true;
      }
      if (F.fixed) d.yaw = turnToward(d.yaw, F.yaw, 12 * Math.max(1e-3, this.game.dt ?? 0.016));
      if (kind === 'palm') this._want('fsPalmK', 0.3 + 0.7 * clamp01(u));
      else if (kind === 'twin') {
        this._want('fsPalmK', 0.3 + 0.7 * clamp01(u));
        this._want('fsCoreK', 0.3 * clamp01(u));
      } else this._want('fsCoreK', 0.4 + 0.6 * clamp01(u));
      // (the twin beams light at the cue: the brain's flare)
      if (kind === 'twin' && b.flashed && !b.feint && !(this.B.on && this.B.b === b)) this._twinLight(b, s, a);
      return;
    }
    // lit: the palm's / the core's sweep (his facing, the beam with it) and the palm's walk
    const B = this.B;
    if (!B.on || B.b !== b || kind === 'twin') {
      if (kind === 'twin') {
        this._want('fsPalmK', 1);
        this._want('fsCoreK', 0.5);
      }
      return;
    }
    const dt = Math.max(0, this.game.dt ?? 0.016);
    const arc = (kind === 'palm' ? C.arc : C.core.arc) * DEG, lit = kind === 'palm' ? C.lit : C.core.lit;
    const st = Math.min((arc / Math.max(0.1, lit)) * dt, Math.max(0, arc - Math.abs(B.swept)));
    B.swept += st * B.sign;
    B.yaw = wrapAngle(B.yaw + st * B.sign);
    d.yaw = B.yaw;
    if (kind === 'palm' && C.walk > 0) {
      // (he walks the way his beam turns: his side, square to it)
      const sx = Math.cos(B.yaw) * B.sign, sz = -Math.sin(B.yaw) * B.sign;
      const x0 = d.position.x, z0 = d.position.z;
      d.moveBy(-sx * C.walk * dt, -sz * C.walk * dt);
      d.groundVelSet?.((d.position.x - x0) / Math.max(dt, 1e-4), (d.position.z - z0) / Math.max(dt, 1e-4));
      this._want('fsPalmK', 1);
    } else this._want('fsCoreK', 1);
  }

  _cannonLight(b, s, a) {
    const d = this.d, kind = b.def.fsCannon.kind, F = b._fs;
    const B = this._beamOn(kind, b, a);
    B.yaw = F?.fixed ? F.yaw : d.yaw;
    d.yaw = B.yaw;
    // the sweep goes toward the side the hero is on of the line (on it: the way he moves; else his left)
    let side = 0;
    if (s) {
      const off = wrapAngle(s.ang - B.yaw);
      side = Math.abs(off) > 0.02 ? Math.sign(off) : 0;
      if (!side) {
        const lat = fin(s.vx) * Math.cos(B.yaw) - fin(s.vz) * Math.sin(B.yaw);
        side = Math.abs(lat) > 0.3 ? -Math.sign(lat) : 1;
      }
    }
    B.sign = side || 1;
    const C = kind === 'palm' ? this.T.absolution : this.T.revelation.core;
    B.w = C.w;
    B.len = C.len;
    this._origin(B, kind);
    d.fx.gunFlash?.(B.ox, B.oy, B.oz, B.dx, B.dz);
    this.game.shake?.(kind === 'core' ? 0.5 : 0.25);
    if (kind === 'core') this.game.world?.forest?.ambience?.flare?.(1);
  }

  /** The beam's mouth (the right palm a hand's breadth out along his facing; the chest core) and way. */
  _origin(B, kind) {
    const d = this.d;
    const P = kind === 'core' ? d.partPoint('core', this._v) : d.handPoint('R', this._v);
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const along = (P.x - d.position.x) * fx + (P.z - d.position.z) * fz, push = Math.max(0, 0.35 - along);
    B.ox = P.x + fx * push;
    B.oz = P.z + fz * push;
    B.oy = clamp(fin(P.y, 1.3), 0.6, 2.2);
    B.dx = fx;
    B.dz = fz;
    if (!Number.isFinite(B.ox + B.oz)) {
      B.ox = d.position.x + fx * 0.6;
      B.oz = d.position.z + fz * 0.6;
    }
  }

  /** Where a beam from (ox, oz) along (dx, dz) stops: its length, or the first cover on it. */
  _coverLen(B, ox, oz, dx, dz, len, w, y) {
    const D = this.game.world?.destructibles;
    const c = D?.coverAt?.(ox + dx * 0.6, oz + dz * 0.6, ox + dx * len, oz + dz * len, w * 0.3, y) ?? null;
    B.cover = c;
    if (!c) return len;
    return 0.6 + (len - 0.6) * fin(D.coverT, 1);
  }

  _cannonLit(B, a, dt) {
    const d = this.d, b = B.b, kind = B.kind;
    const C = kind === 'palm' ? this.T.absolution : this.T.revelation.core, Q = this.T.beams, G = kind === 'palm' ? this.T.absolution : this.T.revelation;
    this._origin(B, kind);
    const len = this._coverLen(B, B.ox, B.oz, B.dx, B.dz, C.len, C.w, B.oy);
    B.ex = B.ox + B.dx * len;
    B.ez = B.oz + B.dz * len;
    B.ey = Math.max(0.3, B.oy - len * 0.05);
    // the hero in it (once)
    const p = this._hero();
    if (p && !B.hit && a.t >= b.impact - Q.hitFrom && this._inStrip(p, B.ox, B.oz, B.dx, B.dz, len, C.w)) {
      this._beamHit(B, a.name, C.damage, C.knockback, B.ox, B.oz);
    }
    // the world: what stands in it, its cover, the trench, a scar every markEvery s
    if (B.t >= B.next) {
      B.next += Q.every;
      this._sweep(B.ox + B.dx * 0.4, B.oz + B.dz * 0.4, B.ex, B.ez, C.w * 0.5 + 0.2, C.sweep, 'blast', B.oy, B.ey, -1, B.cover ?? undefined);
      const D = this.game.world?.destructibles;
      if (B.cover && B.cover.state === 0 && D?.strike) {
        const o = this._wo;
        o.kind = 'blast';
        o.y = Math.min(B.cover.y0 + B.cover.h * 0.7, Math.max(B.ey, B.cover.y0 + 0.3));
        o.src = D.swing?.() ?? -1;
        o.dx = B.dx;
        o.dz = B.dz;
        this.stats.struck += D.strike(B.ex, B.ez, 0.35, Q.cover, o) | 0;
        this.stats.covered++;
      }
      this._trench(B.ox, B.oz, B.dx, B.dz, len, G.trenchR, G.trench, G.step, G.ignite);
    }
    if (B.t >= B.mark) {
      B.mark += G.markEvery;
      this._scar(B.ox + B.dx * 0.8, B.oz + B.dz * 0.8, B.ex, B.ez, C.w, G.markPower);
    }
    const k = Math.min(1, B.t / 0.08) * (a.t > b.end - 0.1 ? clamp01((b.end - a.t) / 0.1) : 1);
    d.fx.cannonBeam?.(B.ox, B.oy, B.oz, B.ex, B.ey, B.ez, C.w, Math.max(0.05, k));
    if (a.t >= b.end - 1e-3) this._beamOff(true);
  }

  // ---------------------------------------------------------------- REVELATION's twin beams
  _twinLight(b, s, a) {
    const F = b._fs, d = this.d;
    if (!F) return;
    const B = this._beamOn('twin', b, a);
    B.yaw = F.fixed ? F.yaw : d.yaw;
    B.hx = F.hx;
    B.hz = F.hz;
    B.w = this.T.revelation.twin.w;
    d.fx.gunFlash?.(d.position.x + Math.sin(B.yaw) * 0.6, 1.3, d.position.z + Math.cos(B.yaw) * 0.6, Math.sin(B.yaw), Math.cos(B.yaw));
    this.game.shake?.(0.3);
    void s;
  }

  _twinLit(B, a) {
    const d = this.d, b = B.b, TW = this.T.revelation.twin, G = this.T.revelation, Q = this.T.beams;
    const lead = Math.max(0.05, b.impact - b.flash);
    // the half-angle either side of the bearing: closing to nothing at the impact, then held crossed
    const off = TW.ang * clamp01((b.impact - a.t) / lead);
    const hx = B.hx, hz = B.hz, p = this._hero();
    let hitNow = false;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'R' : 'L', sg = i === 0 ? -1 : 1;
      const P = d.handPoint(side, this._v);
      const ox = P.x, oy = clamp(fin(P.y, 1.3), 0.6, 2.2), oz = P.z;
      // aimed at the bearing's point turned by `off` (each from its own side)
      const ang = Math.atan2(hx - ox, hz - oz) + sg * off;
      const dx = Math.sin(ang), dz = Math.cos(ang);
      const len = this._coverLen(B, ox, oz, dx, dz, TW.len, TW.w, oy);
      const ex = ox + dx * len, ez = oz + dz * len, ey = Math.max(0.3, oy - len * 0.05);
      if (i === 0) {
        B.ox = ox; B.oy = oy; B.oz = oz; B.ex = ex; B.ey = ey; B.ez = ez; B.dx = dx; B.dz = dz;
      } else {
        B.ox2 = ox; B.oz2 = oz; B.ex2 = ex; B.ez2 = ez; B.dx2 = dx; B.dz2 = dz;
      }
      if (p && !B.hit && a.t >= b.impact - Q.hitFrom && this._inStrip(p, ox, oz, dx, dz, len, TW.w)) hitNow = true;
      if (B.t >= B.next) {
        this._sweep(ox + dx * 0.4, oz + dz * 0.4, ex, ez, TW.w * 0.5 + 0.15, TW.sweep, 'blast', oy, ey, -1, B.cover ?? undefined);
        this._trench(ox, oz, dx, dz, len, G.trenchR * 0.6, G.trench * 0.7, G.step, G.ignite * 0.6);
      }
      const k = Math.min(1, B.t / 0.08) * (a.t > b.end - 0.1 ? clamp01((b.end - a.t) / 0.1) : 1);
      d.fx.cannonBeam?.(ox, oy, oz, ex, ey, ez, TW.w, Math.max(0.05, k));
    }
    if (B.t >= B.next) B.next += Q.every;
    if (hitNow) this._beamHit(B, a.name, TW.damage, TW.knockback, d.position.x, d.position.z);
    if (a.t >= b.end - 1e-3) {
      this._scar(B.ox, B.oz, B.ex, B.ez, TW.w, G.markPower * 0.7);
      this._scar(B.ox2, B.oz2, B.ex2, B.ez2, TW.w, G.markPower * 0.7);
      this._beamOff(true);
    }
  }

  // ================================================================ THE BOLTS (Triptych)
  _boltMotion(b, u, s, a) {
    this._want('fsGunK', 1);
    if (b.feint || b._fsShot || !b.flashed || !s) return;
    const TR = this.T.triptych;
    const T = clamp(s.dist / TR.speed, TR.minT, TR.maxT);
    // (+ a frame: the flight is stepped later this frame, its landing comes on the impact's own frame)
    if (b.impact - a.t <= T) this._boltFire(b, s, a, b.impact - a.t + fin(this.game.dt, 0));
  }

  /** The gun fires: the bolt arrives where the hero will be AT the impact (`left` s from now). */
  _boltFire(b, s, a, left) {
    const d = this.d, TR = this.T.triptych;
    b._fsShot = true;
    const slot = this.Bo.find((x) => !this._alive(x));
    if (!slot) return;
    const P = d.handPoint('R', this._v);
    const ox = P.x, oy = clamp(fin(P.y, 1.3), 0.7, 2.2), oz = P.z;
    const T = Math.max(0.05, left);
    let tx = ox + Math.sin(d.yaw) * 8, tz = oz + Math.cos(d.yaw) * 8;
    if (s) {
      const k = Math.min(T, TR.lead);
      tx = s.p.x + fin(s.vx) * k;
      tz = s.p.z + fin(s.vz) * k;
    }
    const dx = tx - ox, dz = tz - oz, l = Math.hypot(dx, dz) || 1;
    // (the first cover on its way takes it: the bolt ends there)
    const D = this.game.world?.destructibles;
    const c = D?.coverAt?.(ox + (dx / l) * 0.4, oz + (dz / l) * 0.4, tx, tz, 0.2, oy) ?? null;
    slot.cover = c;
    if (c) {
      const t = fin(D.coverT, 1);
      tx = ox + (dx / l) * 0.4 + (tx - ox - (dx / l) * 0.4) * t;
      tz = oz + (dz / l) * 0.4 + (tz - oz - (dz / l) * 0.4) * t;
    }
    slot.b = b;
    slot.ox = ox;
    slot.oy = oy;
    slot.oz = oz;
    slot.dx = dx / l;
    slot.dz = dz / l;
    slot.back = false;
    slot.leg = 0;
    d.fx.gunFlash?.(ox, oy, oz, dx / l, dz / l);
    const o = this._fly('bolt', ox, oy, oz, tx, tz, T, a.name, TELL.BLUE, false, this._boltLand, slot);
    o.ty = 1.1;
    o.power = 1;
    const rec = d.fx.fly?.(o) ?? null;
    if (!rec) return;
    slot.rec = rec;
    slot.id = rec.id;
    this.stats.bolts++;
  }

  /** The fly() options (the reused object; fly reads it at once). */
  _fly(kind, x, y, z, tx, tz, T, attack, tell, expect, onLand, data) {
    const o = this._fo;
    for (const k in o) delete o[k];
    o.kind = kind;
    o.x = x;
    o.y = y;
    o.z = z;
    o.tx = tx;
    o.tz = tz;
    o.T = T;
    o.attack = attack;
    o.tell = tell;
    o.expect = expect;
    o.onLand = onLand;
    o.data = data;
    return o;
  }

  /** A bolt arrives: on the cover it met, on the hero, or past him (it flies on and bites the set). */
  _onBolt(rec) {
    const slot = rec.data, d = this.d, TR = this.T.triptych;
    if (!slot) return;
    slot.rec = null;
    const D = this.game.world?.destructibles;
    // its path bites what stands on it at its height
    this._sweep(slot.ox, slot.oz, rec.x, rec.z, 0.25, TR.power, 'blast', slot.oy, rec.y, -1);
    if (slot.cover) {
      const o = this._wo;
      o.kind = 'blast';
      o.y = rec.y;
      o.src = D?.swing?.() ?? -1;
      o.dx = slot.dx;
      o.dz = slot.dz;
      this.stats.struck += D?.strike?.(rec.x, rec.z, 0.4, TR.power, o) | 0;
      return;
    }
    const p = this._hero();
    let r = RESULT.IGNORED;
    if (p && d.mode !== 'dying' && d.mode !== 'dead' && Math.hypot(p.position.x - rec.tx, p.position.z - rec.tz) <= TR.hitR + fin(p.radius, 0.45)) {
      r = this._hitHero(rec.attack || 'triptych', TELL.BLUE, TR.damage, TR.knockback, false, slot.ox, slot.oz, { kind: 'bolt', parryable: true, blockable: true, posture: TR.posture, beat: slot.b });
      if (r === RESULT.HIT) this.stats.boltHits++;
      if (r === RESULT.PARRIED && p.deflect?.perfect) {
        this._sendHome(rec, slot);
        return;
      }
    }
    if (!LANDED.has(r)) {
      // past him: on along its way `carry` m, then it bites what it meets there
      const ex = rec.x + slot.dx * TR.carry, ez = rec.z + slot.dz * TR.carry;
      const nx = this.Bo.find((x) => x !== slot && !this._alive(x));
      if (!nx) return;
      nx.b = null;
      nx.ox = rec.x;
      nx.oy = rec.y;
      nx.oz = rec.z;
      nx.dx = slot.dx;
      nx.dz = slot.dz;
      nx.cover = null;
      nx.back = false;
      nx.leg = 1;
      const o = this._fly('bolt', rec.x, rec.y, rec.z, ex, ez, Math.max(0.05, TR.carry / TR.speed), rec.attack, TELL.BLUE, false, this._boltOn, nx);
      // (dipping: it meets the plates where it comes down, or what stands before that)
      o.ty = 0.15;
      o.burst = true;
      const r2 = d.fx.fly?.(o) ?? null;
      if (r2) {
        nx.rec = r2;
        nx.id = r2.id;
      }
    }
  }

  /** A missed bolt's second leg lands: the set there takes it. */
  _onBoltCarry(rec) {
    const slot = rec.data, TR = this.T.triptych;
    if (!slot) return;
    slot.rec = null;
    this._sweep(slot.ox, slot.oz, rec.x, rec.z, 0.25, TR.power, 'blast', slot.oy, rec.y, -1);
    const D = this.game.world?.destructibles, o = this._wo;
    o.kind = 'blast';
    o.y = rec.y;
    o.src = D?.swing?.() ?? -1;
    o.dx = slot.dx;
    o.dz = slot.dz;
    o.y = Math.min(o.y, 0.25);
    this.stats.struck += D?.strike?.(rec.x, rec.z, 0.5, TR.power, o) | 0;
    this._gm.kind = 'blast';
    this._gm.power = 0.5;
    this._gm.r = 0.5;
    this._gm.dx = slot.dx;
    this._gm.dz = slot.dz;
    this._gm.hot = true;
    this.game.world?.groundBlow?.(rec.x, rec.z, this._gm);
    this.stats.marks++;
  }

  /** A perfect parry: the bolt flies home into his chest. */
  _sendHome(rec, slot) {
    const d = this.d, B = this.T.triptych.back, p = this.game.player;
    const c = d.partPoint('chest', this._w);
    const hx = p?.position?.x ?? rec.x, hz = p?.position?.z ?? rec.z;
    slot.back = true;
    slot.leg = 2;
    slot.ox = hx;
    slot.oy = 1.2;
    slot.oz = hz;
    const L = Math.hypot(c.x - hx, c.z - hz);
    const o = this._fly('bolt', hx, 1.2, hz, c.x, c.z, Math.max(0.06, L / B.speed), 'triptych', TELL.BLUE, false, this._boltHome, slot);
    o.ty = clamp(fin(c.y, 1.4), 0.8, 2.2);
    o.back = true;
    o.power = 1.4;
    const r2 = d.fx.fly?.(o) ?? null;
    if (r2) {
      slot.rec = r2;
      slot.id = r2.id;
    }
  }

  _onBoltHome(rec) {
    const slot = rec.data, d = this.d, B = this.T.triptych.back;
    if (slot) slot.rec = null;
    if (d.mode === 'dying' || d.mode === 'dead') return;
    this.stats.returned++;
    d.emit('dragon:returned', { attack: 'triptych', damage: B.damage });
    d.hurt?.(B.damage, B.posture, 'returned');
  }

  // ================================================================ THE MISSILES (Choir)
  _choir(b, s, a) {
    const d = this.d, CH = this.T.choir, br = d.brain;
    const n = Math.max(0, Math.round(pp(CH.n, d.phase))), nt = Math.min(n, CH.track.n), nr = n - nt;
    if (!n) return;
    const hx = s ? s.p.x : d.position.x + Math.sin(d.yaw) * 6, hz = s ? s.p.z : d.position.z + Math.cos(d.yaw) * 6;
    const spin = (this.stats.missiles * 0.7) % (Math.PI * 2);
    let fired = 0;
    for (let i = 0; i < n; i++) {
      const slot = this.M.find((x) => !this._alive(x));
      if (!slot) break;
      const sh = d.partPoint(i % 2 ? 'shoulderL' : 'shoulderR', this._v);
      const tr = i >= nr;
      let T, tx, tz;
      if (!tr) {
        const ang = spin + i * 2.39996, rr = CH.ring[0] + (CH.ring[1] - CH.ring[0]) * Math.sqrt((i + 0.5) / Math.max(1, nr));
        tx = hx + Math.cos(ang) * rr;
        tz = hz + Math.sin(ang) * rr;
        T = CH.T0 + i * CH.spread;
      } else {
        tx = hx;
        tz = hz;
        T = CH.T0 + Math.max(0, nr - 1) * CH.spread + CH.track.after + (i - nr) * CH.track.gap;
      }
      // the fairness guard: never inside a blow's window that needs the other answer
      const wait = br?.fairDelay?.(T, TELL.RED, undefined, 'choir') ?? 0;
      if (wait < 0) {
        this.stats.dropped++;
        continue;
      }
      if (wait > 0) {
        T += wait;
        this.stats.delays++;
        br.stats.delays++;
      }
      const o = this._fly('missile', sh.x, sh.y + 0.15, sh.z, tx, tz, T, 'choir', TELL.RED, true, this._mLand, slot);
      o.apex = CH.apex[0] + (CH.apex[1] - CH.apex[0]) * ((i * 0.618) % 1);
      o.r = CH.r;
      // (a tracker's mark walks after him until `track.stop` s before it lands: then it holds, and reads)
      o.track = tr ? clamp01((T - CH.track.stop) / T) : 0;
      o.trackSpeed = CH.track.speed;
      o.cueLead = pp(d.T.flashLead, d.phase);
      o.onCue = this._mCue;
      const rec = d.fx.fly?.(o) ?? null;
      if (!rec) break;
      slot.rec = rec;
      slot.id = rec.id;
      fired++;
    }
    this.stats.missiles += fired;
    const c = d.partPoint('back', this._w);
    d.fx.missileLaunch?.(c.x, c.y, c.z, fired);
    this.game.shake?.(0.15);
  }

  /** A missile's cue: its red flash on its mark, if the hero stands near enough for it to matter. */
  _onMissileCue(rec) {
    const p = this._hero();
    if (!p || Math.hypot(p.position.x - rec.tx, p.position.z - rec.tz) > rec.r + fin(p.radius, 0.45) + 1.2) return;
    this._flash('choir', TELL.RED, rec.tx, 0.4, rec.tz);
  }

  _onMissile(rec) {
    const slot = rec.data, CH = this.T.choir, d = this.d;
    if (slot) slot.rec = null;
    const p = this._hero();
    if (p && d.mode !== 'dying' && d.mode !== 'dead' && Math.hypot(p.position.x - rec.tx, p.position.z - rec.tz) <= rec.r + fin(p.radius, 0.45)) {
      const r = this._hitHero('choir', TELL.RED, CH.damage, CH.knockback, false, rec.tx, rec.tz, { kind: 'blast' });
      if (r === RESULT.HIT) this.stats.missileHits++;
    }
    this._blast(rec.tx, rec.tz, CH.craterR, CH.power, true, 0.4);
  }

  /** The hero's swing cuts a missile out of the air (within `cutR` of his blade, below 3.5 m). */
  _cutMissiles() {
    const pl = this.game.player;
    if (!pl?.isSwinging?.() || !pl.sweep?.valid) return;
    const sw = pl.sweep, A = sw.a, Bv = sw.b, PA = sw.pa, PB = sw.pb;
    if (!A || !Bv) return;
    const R = this.T.choir.cutR;
    for (const s of this.M) {
      if (!this._alive(s)) continue;
      const m = s.rec;
      if (m.y > 3.5 || Math.hypot(m.x - pl.position.x, m.z - pl.position.z) > 3) continue;
      const hit = segD3(m.x, m.y, m.z, A.x, A.y, A.z, Bv.x, Bv.y, Bv.z) <= R
        || (PA && PB && segD3(m.x, m.y, m.z, PA.x, PA.y, PA.z, PB.x, PB.y, PB.z) <= R)
        || (PA && PB && segD3(m.x, m.y, m.z, (A.x + PA.x) / 2, (A.y + PA.y) / 2, (A.z + PA.z) / 2, (Bv.x + PB.x) / 2, (Bv.y + PB.y) / 2, (Bv.z + PB.z) / 2) <= R);
      if (!hit) continue;
      const x = m.x, y = m.y, z = m.z;
      m.cancel();
      s.rec = null;
      this.stats.cut++;
      this.d.fx.missileCut?.(x, y, z, Bv.x - A.x, Bv.z - A.z);
    }
  }

  // ================================================================ THE BARRAGE (Kyrie)
  _kyrieStart(b, s, a) {
    const d = this.d, K = this.K;
    K.on = true;
    K.act = a;
    K.row = 0;
    K.next = d.time;
    // (the creep's axis: from him to the hero as the first salvo leaves; its rows walk along it in steps)
    const p = s?.p;
    let ux = p ? p.x - d.position.x : Math.sin(d.yaw), uz = p ? p.z - d.position.z : Math.cos(d.yaw);
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    K.ux = ux;
    K.uz = uz;
    K.x0 = d.position.x;
    K.z0 = d.position.z;
    K.along0 = p ? (p.x - d.position.x) * ux + (p.z - d.position.z) * uz : 6;
    this._kyrieRows();
  }

  /** Fire every row that is due (a row `rowGap` s after the last, from the first salvo). */
  _kyrieRows() {
    const K = this.K, d = this.d, KY = this.T.kyrie;
    if (!K.on) return;
    if (d.brain?.act !== K.act || d.mode !== 'act') {
      K.on = false;
      return;
    }
    while (K.on && K.row < KY.rows && d.time >= K.next - 1e-6) {
      this._row(K.row);
      K.row++;
      K.next += KY.rowGap;
    }
    if (K.row >= KY.rows) K.on = false;
  }

  /** One row of the barrage: across the creep's axis at its step, lanes laid round the hero. */
  _row(i) {
    const d = this.d, K = this.K, KY = this.T.kyrie, br = d.brain, p = this._hero();
    const along = K.along0 + KY.along[Math.min(i, KY.along.length - 1)] * KY.step;
    const cx = K.x0 + K.ux * along, cz = K.z0 + K.uz * along;
    // across: q = the axis turned; the hero's offset across it
    const qx = K.uz, qz = -K.ux;
    const hq = p ? (p.position.x - cx) * qx + (p.position.z - cz) * qz : 0;
    const sp = 2 * KY.r + KY.lane;
    // (even rows put a shell on the hero's line across, odd rows a lane: the lanes of one row off the last)
    const o = hq + (i % 2 ? sp / 2 : 0);
    let T = KY.T;
    const wait = br?.fairDelay?.(T, TELL.RED, undefined, 'kyrie') ?? 0;
    if (wait < 0) {
      this.stats.dropped++;
      return;
    }
    if (wait > 0) {
      T += wait;
      this.stats.delays++;
      br.stats.delays++;
    }
    const cue = br?.expect?.(T, TELL.RED, 'kyrie') ?? false;
    const M = d.partPoint('mortar', this._v);
    let near = null, nd = Infinity;
    const hx = p ? p.position.x : cx, hz = p ? p.position.z : cz;
    const n0 = KY.per;
    for (let k = 0; k < n0; k++) {
      const slot = this.S.find((x) => !this._alive(x));
      if (!slot) break;
      const off = o + (k - (n0 - 1) / 2) * sp;
      const tx = cx + qx * off, tz = cz + qz * off;
      const f = this._fly('shell', M.x, M.y, M.z, tx, tz, T + k * 0.03, 'kyrie', TELL.RED, cue || false, this._sLand, slot);
      f.r = KY.r;
      f.power = 1.1;
      f.cueLead = pp(d.T.flashLead, d.phase);
      f.onCue = this._sCue;
      const rec = d.fx.fly?.(f) ?? null;
      if (!rec) break;
      slot.rec = rec;
      slot.id = rec.id;
      slot.row = i;
      slot.great = false;
      slot.near = false;
      const dd = Math.hypot(tx - hx, tz - hz);
      if (dd < nd) {
        nd = dd;
        near = slot;
      }
      this.stats.shells++;
    }
    if (near) near.near = true;
    this.stats.rows++;
    d.fx.mortarFlash?.(M.x, M.y, M.z, n0);
    this._want('fsTubeK', 1);
    this.game.shake?.(0.12);
    // (the measure the suite reads: where the hero stood as the row was marked, and its lanes)
    this.lastRow = { i, cx, cz, qx, qz, o, sp, r: KY.r, hx, hz, T };
  }

  /** The great shell, on the hero's spot (its mark follows him a little). */
  _greatShell(b, s, a) {
    const d = this.d, KY = this.T.kyrie, G = KY.great, br = d.brain;
    const slot = this.S.find((x) => !this._alive(x));
    if (!slot) return;
    const hx = s ? s.p.x : d.position.x, hz = s ? s.p.z : d.position.z;
    let T = G.T;
    const wait = br?.fairDelay?.(T, TELL.RED, undefined, 'kyrie') ?? 0;
    if (wait < 0) {
      this.stats.dropped++;
      return;
    }
    T += Math.max(0, wait);
    const M = d.partPoint('mortar', this._v);
    const f = this._fly('shell', M.x, M.y, M.z, hx, hz, T, 'kyrie', TELL.RED, true, this._sLand, slot);
    f.r = G.r;
    f.power = 2.6;
    f.track = 0.35;
    f.trackSpeed = 3.5;
    f.cueLead = pp(d.T.flashLead, d.phase);
    f.onCue = this._sCue;
    const rec = d.fx.fly?.(f) ?? null;
    if (!rec) return;
    slot.rec = rec;
    slot.id = rec.id;
    slot.great = true;
    slot.near = true;
    slot.row = -1;
    this.stats.greats++;
    d.fx.mortarFlash?.(M.x, M.y, M.z, 1);
    this._want('fsTubeK', 1);
    this.game.shake?.(0.2);
  }

  /** A row's cue (its shell nearest the hero as it was marked, if the hero stands in danger now). */
  _onShellCue(rec) {
    const slot = rec.data, p = this._hero();
    if (!slot || !p) return;
    if (slot.great) {
      this._flash('kyrie', TELL.RED, rec.tx, 0.5, rec.tz);
      return;
    }
    // (any shell of the row the hero stands in: flashed once a row)
    if (Math.hypot(p.position.x - rec.tx, p.position.z - rec.tz) > rec.r + fin(p.radius, 0.45) + 0.6) return;
    if (this._rowCued === slot.row + 1000 * this.stats.rows) return;
    this._rowCued = slot.row + 1000 * this.stats.rows;
    this._flash('kyrie', TELL.RED, rec.tx, 0.5, rec.tz);
  }

  _onShell(rec) {
    const slot = rec.data, d = this.d, KY = this.T.kyrie, G = slot?.great ? KY.great : KY;
    if (slot) slot.rec = null;
    const p = this._hero();
    if (p && d.mode !== 'dying' && d.mode !== 'dead' && Math.hypot(p.position.x - rec.tx, p.position.z - rec.tz) <= rec.r + fin(p.radius, 0.45)) {
      const r = this._hitHero('kyrie', TELL.RED, G.damage, G.knockback, !!slot?.great, rec.tx, rec.tz, { kind: 'blast' });
      if (r === RESULT.HIT) this.stats.shellHits++;
    }
    this._blast(rec.tx, rec.tz, G.worldR, G.power, true, slot?.great ? 0.8 : 0.3);
    if (slot?.great) this.game.shake?.(0.5);
  }

  // ================================================================ THE LANCE (Verdict)
  _lanceTrack(b, u, s) {
    const L = this.L, d = this.d;
    if (!L.on || L.act !== d.brain.act) {
      L.on = true;
      L.phase = 'track';
      L.act = d.brain.act;
      L.x = s ? s.p.x : d.position.x;
      L.z = s ? s.p.z : d.position.z;
      L.k = 0;
    }
    if (L.phase !== 'track') return;
    L.k = clamp01(u);
    // (the reticle walks after him: a little behind, never on his heels)
    if (s) {
      const dt = Math.max(1e-3, this.game.dt ?? 0.016), m = 1 - Math.exp(-dt * 9);
      L.x += (s.p.x - L.x) * m;
      L.z += (s.p.z - L.z) * m;
    }
  }

  /** The lock: where he stands now; the pillar falls `fall` s later (the guard may hold it a little). */
  _lanceLock(b, s, a) {
    const L = this.L, d = this.d, VD = this.T.verdict, br = d.brain;
    if (s) {
      L.x = s.p.x;
      L.z = s.p.z;
    }
    let fall = VD.fall;
    const wait = br?.fairDelay?.(fall, TELL.RED, undefined, 'verdict') ?? 0;
    if (wait < 0) {
      this.stats.dropped++;
      this._lanceOff();
      return;
    }
    if (wait > 0) {
      fall += wait;
      this.stats.delays++;
      br.stats.delays++;
    }
    L.on = true;
    L.phase = 'fall';
    L.act = a;
    L.at = d.time + fall;
    L.cue = br?.expect?.(fall, TELL.RED, 'verdict') ?? null;
    L.cued = false;
    L.landed = false;
    // the ring after it: told to the ledger now, retimed as the hero moves, cued as it nears him
    L.rt0 = L.at + VD.ring.delay;
    L.rcue = br?.expect?.(fall + VD.ring.delay + 0.2, TELL.NORMAL, 'verdict') ?? null;
    L.rcued = false;
    L.rhit = false;
    L.ringOn = false;
    L.pool = 0;
    this.stats.lances++;
  }

  _lanceOff() {
    const L = this.L;
    L.cue?.cancel?.();
    L.rcue?.cancel?.();
    L.cue = L.rcue = null;
    L.on = false;
    L.phase = 'off';
  }

  _lanceFrame() {
    const L = this.L, d = this.d, VD = this.T.verdict, R = VD.ring;
    if (!L.on) return;
    if (L.phase === 'track') {
      // (a reticle with no act behind it: he was stopped before the lock)
      if (d.brain.act !== L.act || d.mode !== 'act') this._lanceOff();
      return;
    }
    const now = d.time, p = this._hero(), lead = pp(d.T.flashLead, d.phase);
    if (L.phase === 'fall') {
      if (!L.cued && now >= L.at - lead - 1e-6) {
        L.cued = true;
        this._flash('verdict', TELL.RED, L.x, 0.5, L.z);
      }
      if (now >= L.at - 1e-6) {
        L.phase = 'ring';
        // the pillar: the hero under it, the floor smashed, the light
        if (p && Math.hypot(p.position.x - L.x, p.position.z - L.z) <= VD.r + fin(p.radius, 0.45)) {
          const r = this._hitHero('verdict', TELL.RED, VD.damage, VD.knockback, true, L.x, L.z, { kind: 'blast' });
          if (r === RESULT.HIT) this.stats.lanceHits++;
        }
        this._blast(L.x, L.z, VD.worldR, VD.power, true, 1.0);
        this.game.world?.forest?.ambience?.flare?.(1);
        this.game.shake?.(0.55);
      }
      return;
    }
    // the ring: its front out from the pillar (the effect's law), one hit as it passes the hero
    const T = 0.32 + 0.045 * R.r, r0 = Math.min(0.9, R.r * 0.18), t = now - L.rt0;
    if (t >= 0 && !L.ringOn) {
      L.ringOn = true;
      d.fx.ringShock?.(L.x, L.z, R.r, 1.2);
      this.stats.rings++;
      // the ring's world: what stands on the floor round the pillar is shaken (a light blow)
      this._blast(L.x, L.z, R.r * 0.7, R.power, false, 0);
    }
    if (p && !L.rhit) {
      const pr = fin(p.radius, 0.45), rho = Math.hypot(p.position.x - L.x, p.position.z - L.z);
      const ta = frontTime(Math.max(0, rho - pr), r0, R.r, T);
      if (!Number.isFinite(ta)) {
        L.rhit = true;
        L.rcue?.cancel?.();
      } else {
        const arrive = L.rt0 + ta;
        if (!L.rcued) {
          L.rcue?.retime?.(Math.max(0, arrive - now));
          if (arrive - now <= lead + 1e-6) {
            L.rcued = true;
            const ux = rho > 1e-3 ? (p.position.x - L.x) / rho : 1, uz = rho > 1e-3 ? (p.position.z - L.z) / rho : 0;
            this._flash('verdict', TELL.NORMAL, L.x + ux * Math.max(0, rho - pr), 0.4, L.z + uz * Math.max(0, rho - pr), false);
          }
        }
        if (t >= 0) {
          const front = frontAt(t, r0, R.r, T);
          if (front >= rho - pr && front - R.w <= rho + pr) {
            L.rhit = true;
            const r = this._hitHero('verdict', TELL.NORMAL, R.damage, R.knockback, false, L.x, L.z, { kind: 'shock', parryable: true, blockable: true, posture: 8 });
            if (r === RESULT.HIT) this.stats.ringHits++;
          }
        }
      }
    }
    // the molten crater, once the ring has run out
    if (t >= T + 0.1 && !L.pool) {
      L.pool = 1;
      if (this.F?.molten?.add?.(L.x, L.z, { r: VD.pool.r, life: VD.pool.life, why: 'verdict' })) this.stats.pools++;
    }
    if (t >= T + 0.2) {
      L.rcue?.cancel?.();
      L.on = false;
      L.phase = 'off';
      L.ringOn = false;
    }
  }

  _lanceDraw() {
    const L = this.L, d = this.d, fx = d.fx;
    if (L.phase === 'track') fx.reticle?.(L.x, L.z, L.k, false);
    else if (L.phase === 'fall') {
      fx.reticle?.(L.x, L.z, 1, true);
      const life = 1.1, t0 = L.at - 0.12;
      if (d.time >= t0) fx.skyLance?.(L.x, L.z, this.T.verdict.r, clamp01((d.time - t0) / life));
    } else if (L.phase === 'ring') {
      const t0 = L.at - 0.12, k = (d.time - t0) / 1.1;
      if (k < 1) fx.skyLance?.(L.x, L.z, this.T.verdict.r, clamp01(k));
    }
  }
}
