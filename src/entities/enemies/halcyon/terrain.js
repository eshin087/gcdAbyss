import * as THREE from 'three';
import { clamp, turnToward } from '../../../core/math.js';
import { TELL, RESULT } from '../../../combat/rules.js';
import { halRefMoveOn } from './motion.js';

// What Halcyon does with his city (ADR-160): pieces of the set lifted, carried, thrown and torn down
// (world/destructibles.js take / carry / throwTo / topple; ascendant/terrain.js is the reference).
//   Curbside (halCurb)       he lands by the nearest car (no car: a road barrier, a lamp post, a slab of the
//                            road), lifts it one-handed and throws it (blue, cued on the car flashLead before
//                            it lands). Parried: the hero cuts it in two, the halves pass either side and
//                            burst behind him (the hero's: by 'player'). Rolled: it lands, wrecks what it
//                            lands on and goes up (set.boom).
//   Through the Tower        (halTower) out of frame behind a standing tower top; its windows flare on his
//                            line (the tell); he bursts through the top at the hero (red) and the top
//                            topples across the plaza along his line (destructibles.topple: the engine's
//                            red tell for a falling piece). He lands in a skid.
//   The Falling Sky (halSky) a tower top torn free (take), carried over the plaza; a dark disc with a red
//                            rim marks the ground (black); dropped (throwTo) to land at the impact.
//   Monument (halArm)        the raised arm torn off his own statue (no arm: a lamp post, lighter), swung
//                            twice, thrown.
// `owns()`: a beat of these is moving him (flight.js keeps its hover off).

const HELD = 3, FLYING = 4, INTACT = 0;
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const ease = (u) => u * u * (3 - 2 * u);
const _v = new THREE.Vector3();

export class Terrain {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this.held = null; // the piece in his hands
    this.heldKind = '';
    this.fly = Array.from({ length: 4 }, () => ({ live: false }));
    this.tower = { piece: null, x: 0, y: 0, z: 0, moving: false };
    this.sky = { piece: null, moving: false, lastAt: -Infinity, tx: 0, tz: 0 };
    this.stats = { lifted: 0, thrown: 0, split: 0, towers: 0, skies: 0, arms: 0, lamps: 0 };
    this._throw = { time: 0.6, power: 1.6, radius: 2.4, by: 'boss', onLand: null, ground: true }; // every piece he throws lands on the floor, not at its own base height (the owner's call, 2026-11-25)
    this._o = { kind: 'blunt', by: 'boss', dx: NaN, dz: NaN, y: 1.2, src: -1, scar: true };
    this._from = { x: 0, z: 0 };
    this._flash = { source: 'dragon', attack: '', tell: TELL.BLUE, x: 0, y: 0, z: 0, flare: false };
    this._near = [];
  }

  get W() {
    return this.game.world?.destructibles ?? null;
  }
  get T() {
    return this.d.T;
  }

  reset() {
    this.held = null;
    this.heldKind = '';
    for (const f of this.fly) {
      f.live = false;
      f.h?.cancel?.();
      f.h = null;
    }
    this.tower.piece = null;
    this.tower.moving = false;
    this.sky.piece = null;
    this.sky.moving = false;
    this.sky.lastAt = -Infinity;
  }

  /** A beat of his terrain moves is moving him. */
  owns() {
    return this.tower.moving || this.sky.moving;
  }

  /** Something he threw is still in the air. */
  get busy() {
    return this.fly.some((f) => f.live);
  }

  // ---------------------------------------------------------------- what the level offers
  /** The tower tops still standing. */
  tops() {
    const L = this.W?.list ?? [];
    return L.filter((b) => b.kind === 'towerTop' && b.state === INTACT);
  }

  /** The piece Curbside would lift from (x, z): a car, a barrier, a lamp post, a slab of the road. */
  curbPiece(x, z) {
    const W = this.W, C = this.T.curb;
    if (!W?.nearest) return null;
    return W.nearest(x, z, { maxDist: C.find * 1.8, lift: 1, kind: 'car' }) ?? W.nearest(x, z, { maxDist: C.find * 1.8, lift: 1, kind: 'barrier' }) ?? W.nearest(x, z, { maxDist: C.find * 1.8, lift: 1, kind: 'lamp' }) ?? (W.floorNear?.(x, z, 6, this._near, { max: 1, whole: true }) ? this._near[0] : null);
  }

  /** The piece Monument swings: his statue's arm, else a lamp post. */
  armPiece(x, z) {
    const W = this.W;
    if (!W?.list) return null;
    const arm = W.list.find((b) => b.kind === 'statueArm' && b.state === INTACT);
    return arm ?? W.nearest?.(x, z, { maxDist: 16, lift: 1, kind: 'lamp' }) ?? null;
  }

  /** His AI weighs a move of these (0: not now). */
  weigh(def, w) {
    const d = this.d;
    if (def.once === 'tower') {
      if (!this.tops().length) return 0;
      if (def.beats.some((b) => b.halSky) && (this.game.time ?? 0) - this.sky.lastAt < this.T.sky.every) return 0;
    }
    if (def.beats.some((b) => b.halCurb) && !this.curbPiece(d.position.x, d.position.z)) return 0;
    if (def.beats.some((b) => b.halArm) && !this.armPiece(d.position.x, d.position.z)) return 0;
    return w;
  }

  /** A move of these starts: its piece is chosen now (false: none, it does not start). */
  begin(A) {
    const d = this.d, def = A.def, p = this.game.player?.position;
    this.drop();
    A._hal = { piece: null };
    if (def.beats.some((b) => b.halCurb)) {
      const pc = this.curbPiece(d.position.x, d.position.z);
      if (!pc) return false;
      A._hal.piece = pc;
      this.W?.reserve?.(pc, 4);
    } else if (def.beats.some((b) => b.halTower || b.halSky)) {
      const L = this.tops();
      if (!L.length) return false;
      // the top nearest the hero (Through the Tower comes at him through it; the sky falls on him)
      const hx = p?.x ?? 0, hz = p?.z ?? 0;
      L.sort((a, b) => Math.hypot(a.x - hx, a.z - hz) - Math.hypot(b.x - hx, b.z - hz));
      A._hal.piece = L[0];
    } else if (def.beats.some((b) => b.halArm)) {
      const pc = this.armPiece(d.position.x, d.position.z);
      if (!pc) return false;
      A._hal.piece = pc;
      this.W?.reserve?.(pc, 4);
    }
    return true;
  }

  // ---------------------------------------------------------------- every frame of a beat
  motion(b, u, s, dt) {
    const d = this.d, D = b.def, A = d.brain.act, H = A?._hal;
    if (!H) return;
    if (D.halCurb === 'lift') this._curbLift(b, u, s, dt, H);
    else if (D.halCurb === 'throw' || D.halArm === 'throw') {
      if (s && u < 1) d.yaw = turnToward(d.yaw, s.ang, 10 * dt);
    } else if (D.halTower) this._tower(b, u, s, dt, H);
    else if (D.halSky) this._sky(b, u, s, dt, H);
    else if (D.halArm === 'tear') this._tear(b, u, s, dt, H);
    else if (D.halArm === 'swing' && s && u < 0.8) d.yaw = turnToward(d.yaw, s.ang, 8 * dt);
  }

  /** Down by the piece, lifted overhead one-handed. */
  _curbLift(b, u, s, dt, H) {
    const d = this.d, W = this.W, pc = H.piece;
    if (!pc) return;
    if (!b._from) b._from = { x: d.position.x, z: d.position.z };
    if (u < 0.45 && pc.state === INTACT) {
      // beside it, on the hero's side
      const hx = s?.p.x ?? d.position.x, hz = s?.p.z ?? d.position.z;
      const ax = hx - pc.x, az = hz - pc.z, al = Math.hypot(ax, az) || 1, off = (pc.r ?? 1) + 0.6;
      const tx = pc.x + (ax / al) * off, tz = pc.z + (az / al) * off;
      const k = ease(clamp(u / 0.42, 0, 1));
      d.position.x = b._from.x + (tx - b._from.x) * k;
      d.position.z = b._from.z + (tz - b._from.z) * k;
      d.yaw = Math.atan2(pc.x - d.position.x, pc.z - d.position.z);
      return;
    }
    if (pc.state === INTACT && W?.take?.(pc)) {
      this.held = pc;
      this.heldKind = 'curb';
      this.stats.lifted++;
      d.fx.dust?.(pc.x, pc.z, 1.0);
      this.game.shake?.(0.15);
    }
    if (s) d.yaw = turnToward(d.yaw, s.ang, 8 * dt);
  }

  /** Behind a tower top, its windows flaring on his line; then through it at the hero. */
  _tower(b, u, s, dt, H) {
    const d = this.d, D = b.def, pc = H.piece, a = d.brain.act;
    if (!pc) return;
    const p = s?.p ?? d.position;
    const dx = pc.x - p.x, dz = pc.z - p.z, l = Math.hypot(dx, dz) || 1;
    const bx = pc.x + (dx / l) * (pc.r + 1.5), bz = pc.z + (dz / l) * (pc.r + 1.5), by = pc.y0 + 3.2;
    if (D.halTower === 'out') {
      this.tower.moving = true;
      if (!b._from) {
        b._from = { x: d.position.x, z: d.position.z, y: d.position.y };
        d.fx.afterimage?.(d, 0, 0, 0.4);
        d.fx.sonic?.(d.position.x, d.position.y + 0.8, d.position.z, -dx / l, -dz / l);
      }
      const k = ease(clamp(u / 0.95, 0, 1));
      d.position.x = b._from.x + (bx - b._from.x) * k;
      d.position.z = b._from.z + (bz - b._from.z) * k;
      d.position.y = b._from.y + (by - b._from.y) * k;
      d.yaw = Math.atan2(-dx, -dz);
      return;
    }
    // the burst: held behind it while the windows flare on his line, then through it at the hero
    this.tower.moving = true;
    const t = a?.t ?? 0, go = b.impact - 0.36;
    if (t < go) {
      if (s && !b._fixed) {
        b._tx = s.p.x;
        b._tz = s.p.z;
      }
      if (t >= b.flash - 0.12 && !b._fixed) b._fixed = true;
      d.position.set(bx, by, bz);
      d.yaw = Math.atan2(p.x - bx, p.z - bz);
      const k = clamp((t - b.start) / Math.max(0.1, go - b.start), 0, 1);
      d.fx.towerFlare?.(pc.x - (dx / l) * pc.r * 0.95, pc.y0 + 0.4, pc.z - (dz / l) * pc.r * 0.95, -dz / l, dx / l, Math.min(4, pc.r * 1.1), 6.2, k);
      b._from = { x: bx, y: by, z: bz };
      return;
    }
    if (!b._burst) {
      b._burst = true;
      const tx = b._tx ?? p.x, tz = b._tz ?? p.z;
      b._tx = tx;
      b._tz = tz;
      const ux = tx - bx, uz = tz - bz, ul = Math.hypot(ux, uz) || 1;
      b._dx = ux / ul;
      b._dz = uz / ul;
      if (pc.state === INTACT) {
        this.W?.topple?.(pc, b._dx, b._dz, 'boss');
        this.stats.towers++;
      }
      d.fx.crashBurst?.(bx - b._dx * 1.5, by, bz - b._dz * 1.5, b._dx, b._dz, 1.2);
      d.fx.sonic?.(bx, by, bz, b._dx, b._dz);
      this.game.shake?.(0.5);
      d.emit?.('dragon:tower', { x: pc.x, z: pc.z });
    }
    if (u < 1) {
      const k = clamp((t - go) / Math.max(0.05, b.impact - go), 0, 1);
      d.position.x = b._from.x + (b._tx - b._from.x) * k;
      d.position.z = b._from.z + (b._tz - b._from.z) * k;
      d.position.y = b._from.y + (0.6 - b._from.y) * k * k;
      d.yaw = Math.atan2(b._dx, b._dz);
      if (((t * 60) | 0) % 2 === 0) d.fx.afterimage?.(d, -b._dx * 2, -b._dz * 2, 0.3);
      return;
    }
    // the skid where he lands
    const k = clamp(u - 1, 0, 1);
    d.position.y = 0.5;
    d.moveBy(b._dx * this.T.tower.skid * 6 * dt * (1 - k), b._dz * this.T.tower.skid * 6 * dt * (1 - k));
    if (k >= 0.95) this.tower.moving = false;
  }

  /** The falling sky: to the top, torn free, carried over the hero; dropped to land at the impact. */
  _sky(b, u, s, dt, H) {
    const d = this.d, D = b.def, pc = H.piece, a = d.brain.act, S = this.T.sky, W = this.W;
    if (!pc) return;
    this.sky.moving = true;
    if (D.halSky === 'lift') {
      if (!b._from) b._from = { x: d.position.x, z: d.position.z, y: d.position.y };
      const k = ease(clamp(u / 0.6, 0, 1));
      d.position.x = b._from.x + (pc.x - b._from.x) * k;
      d.position.z = b._from.z + (pc.z - b._from.z) * k;
      d.position.y = b._from.y + (pc.y0 - 0.3 - b._from.y) * k;
      if (u >= 0.6 && pc.state === INTACT && this.held !== pc && W?.take?.(pc)) {
        this.held = pc;
        this.heldKind = 'sky';
        this.stats.skies++;
        this.sky.lastAt = this.game.time ?? 0;
        this.game.shake?.(0.4);
        d.fx.crashBurst?.(pc.x, pc.y0, pc.z, 0, 1, 1.2);
      }
      if (u >= 0.6) {
        const k2 = ease(clamp((u - 0.6) / 0.4, 0, 1));
        d.position.y = pc.y0 - 0.3 + (S.carry + pc.y0 - (pc.y0 - 0.3)) * k2 * 0.2;
      }
      return;
    }
    // the drop's windup: carried over the hero (the mark follows him until the line is fixed), up high
    const t = a?.t ?? 0;
    if (!b._from) b._from = { x: d.position.x, z: d.position.z, y: d.position.y };
    if (s && t < b.flash - 0.2) {
      b._tx = s.p.x;
      b._tz = s.p.z;
    }
    const tx = b._tx ?? d.position.x, tz = b._tz ?? d.position.z;
    if (u < 1) {
      const k = ease(clamp(u / 0.55, 0, 1));
      d.position.x = b._from.x + (tx - b._from.x) * k;
      d.position.z = b._from.z + (tz - b._from.z) * k;
      d.position.y = b._from.y + (11 - b._from.y) * k;
      d.fx.skyMark?.(tx, tz, S.r, clamp(u, 0, 1));
      // let it go so it lands at the impact
      const left = b.impact - t;
      if (this.held === pc && pc.state === HELD && left <= 0.32) {
        this._throw.time = Math.max(0.12, left);
        this._throw.power = S.power;
        this._throw.radius = S.crater;
        this._throw.by = 'boss';
        this._throw.onLand = null;
        W?.throwTo?.(pc, tx, tz, this._throw);
        this.held = null;
      }
      return;
    }
    // he lands on the heap
    const k = clamp((u - 1) * 3, 0, 1);
    d.position.y = Math.max(0, d.position.y + (0 - d.position.y) * k);
    if (u >= 1.9) this.sky.moving = false;
  }

  /** Monument's tear: down by the statue, the arm torn off (a lamp post wrenched out). */
  _tear(b, u, s, dt, H) {
    const d = this.d, pc = H.piece, W = this.W;
    if (!pc) return;
    if (!b._from) b._from = { x: d.position.x, z: d.position.z };
    if (u < 0.55 && pc.state === INTACT) {
      const tx = pc.x + 1.0, tz = pc.z + 1.0;
      const k = ease(clamp(u / 0.5, 0, 1));
      d.position.x = b._from.x + (tx - b._from.x) * k;
      d.position.z = b._from.z + (tz - b._from.z) * k;
      d.yaw = Math.atan2(pc.x - d.position.x, pc.z - d.position.z);
      return;
    }
    if (pc.state === INTACT && W?.take?.(pc)) {
      this.held = pc;
      this.heldKind = 'arm';
      this.stats[pc.kind === 'statueArm' ? 'arms' : 'lamps']++;
      this.game.shake?.(0.3);
      d.emit?.('dragon:statue', { part: 'arm' });
    }
    // back at the hero with it (the swings are his reach: they come from beside him)
    if (s && u >= 0.55) {
      if (!b._back) b._back = { x: d.position.x, z: d.position.z };
      const a = Math.atan2(b._back.x - s.p.x, b._back.z - s.p.z), r = 3.2;
      const k = ease(clamp((u - 0.55) / 0.45, 0, 1));
      d.position.x = b._back.x + (s.p.x + Math.sin(a) * r - b._back.x) * k;
      d.position.z = b._back.z + (s.p.z + Math.cos(a) * r - b._back.z) * k;
    }
    if (s) d.yaw = turnToward(d.yaw, s.ang, 8 * dt);
  }

  // ---------------------------------------------------------------- the impacts
  onImpact(b, s, a) {
    const d = this.d, D = b.def, W = this.game.world;
    if (D.halSky === 'drop') {
      const S = this.T.sky, o = this._o;
      o.kind = 'blast';
      o.by = 'boss';
      o.dx = o.dz = NaN;
      o.src = W?.destructibles?.swing?.() ?? -1;
      W?.impact?.(d.position.x, d.position.z, S.crater, S.power, o);
      d.fx.crater?.(d.position.x, d.position.z, S.crater, 2);
      this.game.shake?.(0.8);
      this.drop();
    } else if (D.halArm === 'swing') {
      const M = this.T.monument, o = this._o;
      o.kind = 'blunt';
      o.by = 'boss';
      o.dx = o.dz = NaN;
      o.y = 1.2;
      o.src = this.W?.swing?.() ?? -1;
      this.W?.strike?.(d.position.x, d.position.z, M.r, M.power * (this.held?.kind === 'lamp' ? 0.6 : 1), o);
      this.game.shake?.(0.3);
    }
    void s;
    void a;
  }

  /** A cast beat's impact: the throw. */
  onCast(b, s, a) {
    const D = b.def;
    if (D.halCurb === 'throw' || D.halArm === 'throw') this._throwHeld(b, a);
    void s;
  }

  _throwHeld(b, a) {
    const d = this.d, W = this.W, pc = this.held, C = this.T.curb;
    if (!pc || pc.state !== HELD || !W?.throwTo) return;
    const H = this.game.player?.position, s = d.brain._sense?.();
    let tx = H?.x ?? d.position.x, tz = H?.z ?? d.position.z;
    if (s) {
      tx += fin(s.vx) * C.lead;
      tz += fin(s.vz) * C.lead;
    }
    const sx = fin(pc.px, pc.x), sz = fin(pc.pz, pc.z);
    const dist = Math.hypot(tx - sx, tz - sz);
    let fl = clamp(dist / C.speed, C.time[0], C.time[1]);
    fl = Math.max(fl, C.minFlight);
    let quiet = false;
    const dl = d.brain?.fairDelay?.(fl, b.def.tell, C.maxDelay, a?.name) ?? 0;
    if (dl > 0) {
      fl += dl;
      d.brain.stats.delays++;
    } else if (dl < 0) quiet = true;
    const kind = this.heldKind;
    const R = this.fly.find((f) => !f.live);
    if (!R) return;
    const tw = this._throw;
    tw.time = fl;
    tw.power = kind === 'curb' ? C.power : 1.2;
    tw.radius = kind === 'curb' ? C.radius : 1.6;
    tw.by = 'boss';
    tw.onLand = (this._onLand ??= (piece, x, z) => this._landed(piece, x, z));
    if (!W.throwTo(pc, tx, tz, tw)) return;
    this.held = null;
    const l = dist || 1;
    Object.assign(R, {
      live: true, piece: pc, t: 0, T: fl, flashed: false, quiet, tell: b.def.tell, damage: b.def.damage, kb: b.def.knockback ?? 3,
      attack: a?.name ?? 'curbside', dx: (tx - sx) / l, dz: (tz - sz) / l, car: pc.kind === 'car', kind,
    });
    R.h?.cancel?.();
    R.h = quiet ? null : d.brain?.expect?.(fl, b.def.tell, R.attack) ?? null;
    this.stats.thrown++;
    this.game.shake?.(0.15);
  }

  /** A thrown piece came down (the world's onLand): its blow at the hero; a car goes up. */
  _landed(pc, x, z) {
    const R = this.fly.find((f) => f.live && f.piece === pc);
    if (!R) return;
    R.live = false;
    R.h?.cancel?.();
    R.h = null;
    const d = this.d, p = this.game.player, set = this.game.world?.forest;
    let parried = false;
    if (p?.position && p.alive !== false && R.flashed && !R.quiet && Math.hypot(p.position.x - x, p.position.z - z) <= this.T.curb.hit + (p.radius ?? 0.45)) {
      this._from.x = x - R.dx * 1.4;
      this._from.z = z - R.dz * 1.4;
      const r = d.hitPlayer({ damage: R.damage, knockback: R.kb, knockdown: false, kind: 'stone', tell: R.tell, attack: R.attack, from: this._from, projectile: true, parryPosture: this.T.curb.parryPosture });
      parried = r === RESULT.PARRIED;
    }
    if (parried) {
      // the hero cuts it in two: the halves pass either side and burst behind him (his: by 'player')
      this.stats.split++;
      d.emit?.('dragon:split', { attack: R.attack, x, z });
      if (R.car) for (const sg of [-1, 1]) set?.boom?.(x - R.dz * sg * 2.2 + R.dx * this.T.curb.halves, z + R.dx * sg * 2.2 + R.dz * this.T.curb.halves, 'player');
      d.fx._ink?.(x - R.dz * 0.8, 1.0, z + R.dx * 0.8, x + R.dz * 0.8, 1.0, z - R.dx * 0.8, 0.2, 1.0, 0);
    } else if (R.car) set?.boom?.(x, z, 'boss');
  }

  /** Every frame after the brain: what he holds follows his hands; what he threw is cued as it comes. */
  frame(dt) {
    const d = this.d, W = this.W;
    const pc = this.held;
    if (pc) {
      const act = d.mode === 'act' && d.brain.act;
      if (!act || pc.state !== HELD) this.drop();
      else {
        // (ADR-289, `?halRefMove=a`: the car rides on his right palm, the statue's arm leaves from his
        // right hand in the throw; otherwise between his hands, as before)
        const ref = halRefMoveOn() && (this.heldKind === 'curb' || (this.heldKind === 'arm' && act.beats.some((b) => b.def.halArm === 'throw' && act.t >= b.start)));
        const h = d.tellPoint(ref ? 'fistR' : 'palms', _v);
        if (ref && this.heldKind === 'curb') W?.carry?.(pc, h.x, h.y + 0.32, h.z, 0, d.yaw);
        else if (this.heldKind === 'sky') W?.carry?.(pc, d.position.x, d.position.y + 2.0, d.position.z, 0, d.yaw);
        else if (this.heldKind === 'arm') W?.carry?.(pc, h.x, Math.max(0.3, h.y - 0.3), h.z, Math.PI / 2, d.yaw + (d.brain.clipT % 1) * 0.0);
        else W?.carry?.(pc, h.x, h.y + 0.25, h.z, 0, d.yaw);
      }
    }
    if (d.mode !== 'act') {
      this.tower.moving = false;
      this.sky.moving = false;
    }
    const lead = this.T.flashLead;
    for (const R of this.fly) {
      if (!R.live) continue;
      R.t += dt;
      const p = R.piece;
      if (!p || p.state !== FLYING) {
        if (p?.state !== FLYING) R.live = R.live && p?.state === FLYING;
        continue;
      }
      if (!R.flashed && !R.quiet && R.T - R.t <= lead) {
        R.flashed = true;
        const f = this._flash;
        f.attack = R.attack;
        f.tell = R.tell;
        f.x = fin(p.px, p.x);
        f.y = Math.max(0.6, fin(p.py, 1));
        f.z = fin(p.pz, p.z);
        this.game.events?.emit?.('combat:flash', f);
        d.fx.tellFlash?.(R.tell, f.x, f.y, f.z, 1, false);
      }
    }
  }

  /** What he holds falls where it is (a stagger, a break, a reset, a new move). */
  drop() {
    const pc = this.held;
    this.held = null;
    if (pc && pc.state === HELD) this.W?.drop?.(pc);
  }
}
