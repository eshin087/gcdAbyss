import { TELL, RESULT } from '../../../combat/rules.js';
import { turnToward } from '../../../core/math.js';
import { K_FIRE, K_STEEL, GROUND_Y, GROUND_GAIN } from '../duelist/fx.js';
import { TUNING_TERRAIN } from './tuningTerrain.js';

// FsTerrain: the False Saint's use of the foundry (the TERRAIN AGENT's file; its moves: moves/terrain.js;
// its numbers: tuningTerrain.js, TUNING.terrain; its poses: posesTerrain.js). A HANDLER on the routing
// contract (saint.js header; arsenal.js lists the hooks with their arguments): every beat carrying fsRelic /
// fsLadle / fsPillar / fsPress is routed here. Bai Wuji's untouched/terrain.js is its precedent (the pieces
// found by kind, a move refused without one, a thrown piece's cue on the piece and its landing asked of the
// fairness guard).
//
// WHAT IT DOES
//   THE MOLTEN POOLS (every frame, whoever laid them: a spilled ladle, his Crucible): a NEW pool is cued RED
//     where it lies, `molten.arm` s ahead (combat:tell with impactIn, combat:flash with `hazard`, the brain's
//     ledger), and burns nothing before then; an armed pool burns the hero standing in it every `tick` s
//     (d.hitPlayer, red, unblockable, unparryable, no perfect dodge: a roll's i-frames pass through it),
//     throwing him out past its rim (one burn per entry: never a trap), never while he is down or held, and
//     not for `grace` s after; and HIM (d.onMolten, at most once per `tick`): the level's trick.
//   THE FETCH (Relic, Offertory): the piece chosen at the move's start (by kind, the nearest he can reach:
//     `fetch.find` m, standing at most `fetch.out` m past his circle, inside the floor); the jet hop to it
//     (his position carried along the hop, the boosters lit through d.parts.boost, an afterimage, the
//     planted stop's scuff), the piece torn up (destructibles.take, chip: the hero's blade can cut it out of
//     his hands) and held (overhead for a throw; where it stands for a kick). Out past his circle, he walks
//     back in after the move (footwork) at `fetch.home` m/s.
//   THE THROWN PIECES (a fixed pool of 3): thrown with destructibles.throwTo at where the hero will be; the
//     flight told to the ledger (brain.expect, retimed in flight), its landing asked of the fairness guard
//     (brain.fairDelay: a later landing, or uncued and harmless); its flare ON the piece flashLead s before
//     it lands (combat:flash: blue for a relic, red with `hazard` for a tank). A relic strikes the hero within
//     `relic.hit` m of where it lands (parried: it breaks on his blade, posture to him); a tank BURSTS where it
//     lands (the set's foundry.boom: the world's blast, its own hit on the hero), a dud when uncued.
//   CRUCIBLE: the ladle chosen at the start (foundry.ladleNear the hero, full, whole), the gun on its chain
//     (d.fsGunK, a red sight line), the pools' places fixed at `crucible.fix` of the windup and marked (the
//     fx's red ring closing in, fx.missileMark), the shot (fx.fly bolt), foundry.drop(L, 'boss') and the
//     splash pool where the hero stood; the pools then cue themselves (above).
//   PROSTRATION: a standing column near the hero; his eye's sight line and laser on its foot; at the cut the
//     runway section on it and the column topple at the hero (destructibles.topple: the WORLD marks the strip,
//     cues it red, asks the fairness guard (worldClash) and strikes whoever is under it).
//   DIES IRAE: the press's head standing; the gun into its ram, the slam (it bites the press), then the
//     shock's FRONT (one record): it runs out from the press at `diesIrae.speed` m/s; every piece and plate
//     it passes is struck once; it reaches the hero once (cued on the front: the ledger at the slam, the
//     flash flashLead s before; held by the fairness guard up to maxDelay, or quiet).
//   THE TRANSITIONS' WORLD (onMoment, from saint.js _moment: it REPLACES core's push ring): 2 a small shock, the
//     plates under him cracked; 3 the lift's blast ring (floor plates torn up and thrown out); 4 the nova
//     (plates thrown, every standing piece within reach struck, the furnace's flare). He cannot be hurt
//     through the change until its ring is out: saint.js _inChange (the boost agent's).
// At most TUNING.terrain.pace.max of these moves start inside pace.window s (`paced` false: the Lab and the
// tests trigger them back to back), none while something of his is held or in the air. stop() (a reaction,
// a break, his death) lets go of what he holds (it falls where it is, harmless); his death also quiets what
// flies and the front. reset() forgets everything (the world's reset puts the pieces back).
//
// THE SURFACE others may read: `stats` { pools, cued, heroBurns, bossBurns, started, refused, fetched, taken,
// thrown, landed, hits, parried, bursts, duds, quiet, delays, letGo, shots, spills, splashes, felled,
// slams, fronts, frontStruck, frontHits, changes, platesThrown, changeStruck }; `busy`; `front` (Dies Irae's
// record: { live, x, z, R, ... }); `lastPlan` (the last move's chosen piece / ladle / column: the tests).
// No per-frame allocation (fixed records, reused); look jitter from the effects' stream (fx.lrand); no
// Math.random here (every choice is a fixed rule).

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (u) => u * u * (3 - 2 * u);
const TAU = Math.PI * 2;
const INTACT = 0, HELD = 3, FLYING = 4;
const GROUND = Object.freeze({ ground: true });
const CHIP = Object.freeze({ chip: true });
const NFLY = 3;
const DOWN = new Set(['knockdown', 'dead']);
const GRIT = [0.5, 0.47, 0.43], GRIT_END = [0.14, 0.13, 0.12];

export class FsTerrain {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this.T = d.T?.terrain ?? TUNING_TERRAIN;
    /** false: the pace limit is off (the Lab, the tests) */
    this.paced = true;
    // the pools' cue and burn records
    this._tell = { source: 'dragon', attack: 'molten', tell: TELL.RED, impactIn: 0, x: 0, z: 0, hazard: true };
    this._flash = { source: 'dragon', attack: 'molten', tell: TELL.RED, x: 0, y: 0.3, z: 0, hazard: true, flare: false };
    this._hit = {
      damage: 0, tell: TELL.RED, kind: 'burn', attack: 'molten', parryable: false, blockable: false, knockback: 0, knockdown: false, from: { x: 0, z: 0 }, light: true,
      extra: Object.freeze({ perfect: false, plunge: false }),
    };
    // a thrown piece's records
    this.fly = Array.from({ length: NFLY }, () => ({ live: false, piece: null, kind: 'relic', attack: '', tell: TELL.BLUE, flashed: false, quiet: false, damage: 0, kb: 0, hit: 1.7, parryPosture: 0, dx: 0, dz: 1, tx: 0, tz: 0, h: null }));
    this._onLand = (b, x, z) => this._landed(b, x, z);
    this._throw = { time: 0.6, power: 1.4, radius: 2, by: 'boss', ground: true, onLand: null };
    this._flareRec = { source: 'dragon', attack: '', tell: TELL.BLUE, x: 0, y: 0, z: 0, flare: true, hazard: false };
    this._heroHit = { damage: 0, knockback: 0, knockdown: false, kind: 'stone', tell: TELL.BLUE, attack: '', from: { x: 0, z: 0 }, projectile: true, parryPosture: 0, flare: true, parryable: undefined, blockable: undefined, extra: null };
    // what he holds (one piece at a time)
    this.held = { piece: null, act: null, mode: '', t: 0, x0: 0, z0: 0, y0: 0, hx: NaN, hy: NaN, hz: NaN };
    // Dies Irae's front
    this.front = { live: false, t: 0, wait: 0, x: 0, z: 0, R: 0, Rp: 0, hit: false, flashed: false, quiet: false, h: null, src: -1, told: false };
    this._frontTell = { source: 'dragon', attack: 'diesIrae', tell: TELL.RED, impactIn: 0, x: 0, z: 0, hazard: true };
    this._frontFlash = { source: 'dragon', attack: 'diesIrae', tell: TELL.RED, x: 0, y: 0.4, z: 0, hazard: true, flare: false };
    // the world's blow records
    this._o = { kind: 'blunt', by: 'boss', dx: NaN, dz: NaN, y: 1, src: -1, scar: true, falloff: 0 };
    this._gm = { kind: 'slam', power: 1, r: 1.5, dx: 0, dz: 0, by: 'boss', hot: false };
    this._from = { x: 0, z: 0 };
    this._hv = { x: 0, z: 0 };
    this._spot = { x: 0, z: 0 };
    this._probe = { x: 0, z: 0 };
    this._v = { x: 0, y: 0, z: 0 };
    this._near = [];
    this._slabs = [];
    this._plan = { kind: '', piece: null, spot: null, L: null, col: null, head: null, base: null, sx: NaN, sz: NaN, mx: NaN, mz: NaN, fixed: false, splash: false, h: null, bolt: null, hop: false, arrived: false, took: false };
    this.starts = new Float64Array(4).fill(-1e9);
    this._si = 0;
    this.reset();
  }

  get W() {
    return this.game.world?.destructibles ?? null;
  }
  /** The set's hazard surface, or null (another set: the lab stage). */
  get foundry() {
    return this.game.world?.forest?.foundry ?? null;
  }
  get lead() {
    const v = this.d.T?.flashLead;
    return Array.isArray(v) ? fin(v[Math.max(0, (this.d.phase | 0) - 1)], 0.35) : fin(v, 0.35);
  }

  // ------------------------------------------------------------------ the fight's reset, a stop
  reset() {
    this.stats = {
      pools: 0, cued: 0, heroBurns: 0, bossBurns: 0,
      started: 0, refused: 0, fetched: 0, taken: 0, thrown: 0, landed: 0, hits: 0, parried: 0, bursts: 0, duds: 0, quiet: 0, delays: 0, letGo: 0,
      shots: 0, spills: 0, splashes: 0, felled: 0, slams: 0, fronts: 0, frontStruck: 0, frontHits: 0, changes: 0, platesThrown: 0, changeStruck: 0,
    };
    this._seen = -1; // the highest pool id seen
    this._heroT = 0; // s to the hero's next burn
    this._bossT = 0; // s to his next burn
    this._graceT = 0; // s the hero is spared after being down / held
    this.held.piece = null;
    this.held.act = null;
    for (const R of this.fly) this._endFly(R);
    this._endFront();
    this.starts.fill(-1e9);
    this._chDone = null;
    this._boltP = null;
    this._myAct = null;
    this.lastPlan = null;
    this._gunK = 0;
  }

  /** A reaction, a break, his death: what he holds falls where it is (harmless); dead, what flies goes quiet. */
  stop() {
    this._letGo();
    const P = this._planOf(this.d.brain?.act);
    if (P?.h) {
      P.h.cancel?.();
      P.h = null;
    }
    if (this._dying()) {
      for (const R of this.fly) {
        if (!R.live) continue;
        R.quiet = true;
        R.h?.cancel?.();
        R.h = null;
      }
      const F = this.front;
      if (F.live) {
        F.quiet = true;
        F.h?.cancel?.();
        F.h = null;
      }
    }
  }

  _dying() {
    const m = this.d.mode;
    return m === 'dying' || m === 'dead' || !(this.d.hp > 0);
  }

  _letGo() {
    const H = this.held;
    if (!H.piece) return;
    if (H.piece.state === HELD) this.W?.drop?.(H.piece, GROUND);
    this.stats.letGo++;
    H.piece = null;
    H.act = null;
  }

  _endFly(R) {
    R.live = false;
    R.piece = null;
    R.h?.cancel?.();
    R.h = null;
  }

  _endFront() {
    const F = this.front;
    F.live = false;
    F.h?.cancel?.();
    F.h = null;
  }

  /** Something of his is held, in the air, or running across the floor. */
  get busy() {
    return !!this.held.piece || this.fly.some((f) => f.live) || this.front.live || this._boltLive();
  }

  /** A shot of his (Crucible's, Dies Irae's) still on its way to the chain / the ram. */
  _boltLive() {
    const P = this._boltP;
    if (!P) return false;
    if (P.bolt && P.bolt.alive && P.bolt.id === P.boltId) return true;
    // (its flight gone without landing: cancelled with his death, a reset)
    if (P.bolt) {
      P.bolt = null;
      this._boltP = null;
    }
    return !!P.bolt;
  }

  _paceOk() {
    if (!this.paced) return true;
    const P = this.T.pace, now = fin(this.game.time);
    let n = 0;
    for (const t of this.starts) if (now - t < P.window) n++;
    return n < P.max;
  }

  _hero() {
    const d = this.d, me = d.position, p = this.game.player?.position, v = this._hv;
    v.x = Number.isFinite(p?.x) ? p.x : me.x + Math.sin(d.yaw) * 4;
    v.z = Number.isFinite(p?.z) ? p.z : me.z + Math.cos(d.yaw) * 4;
    return v;
  }

  /** The hero is down (a knockdown), held, or gone: nothing of his lands on him now. */
  _heroDown() {
    const p = this.game.player;
    return !p?.position || p.alive === false || DOWN.has(p.state) || !!this.d.parts?.melee?.grip;
  }

  // ------------------------------------------------------------------ the pieces, by kind
  /** The plan of the act (its own record on the act), or null. */
  _planOf(A) {
    return A?._fsTr ?? null;
  }

  /** The move's piece / ladle / column for a def now (into `P`: the shared scratch plan unless given); false
   *  when there is none. */
  _find(name, P = this._plan) {
    const F = this.foundry, H = this._hero(), d = this.d, T = this.T;
    P.kind = name;
    P.piece = P.L = P.col = P.head = P.base = P.spot = null;
    if (name === 'crucible') {
      const L = F?.ladleNear?.(H.x, H.z, T.crucible.reach);
      if (!L || !L.full || (L.piece && L.piece.state !== INTACT)) return false;
      P.L = L;
      return true;
    }
    const W = this.W;
    if (!W?.list) return false;
    if (name === 'relic' || name === 'offertory') {
      const kinds = name === 'offertory' ? TANK : T.relic.kinds, kick = name === 'offertory';
      let best = null, bd = Infinity, bx = 0, bz = 0;
      const me = d.position;
      for (const b of W.list) {
        if (b.state !== INTACT || b.absent || b.lift !== 1 || !(b.hpMax < Infinity) || !kinds.includes(b.kind)) continue;
        if (Math.hypot(b.x - me.x, b.z - me.z) > T.fetch.find + 2 || Math.hypot(b.x - H.x, b.z - H.z) < T.fetch.minHero) continue;
        if (kick && !this._tankIdle(b)) continue;
        const s = this._spotFor(b, H, kick);
        if (!s) continue;
        const e = Math.hypot(s.x - me.x, s.z - me.z);
        if (e > T.fetch.find || e >= bd) continue;
        bd = e;
        best = b;
        bx = s.x;
        bz = s.z;
      }
      if (!best) return false;
      P.piece = best;
      P.sx = bx;
      P.sz = bz;
      return true;
    }
    if (name === 'prostration') {
      const K = T.prostration;
      let best = null, bd = Infinity;
      for (const b of W.list) {
        if (b.kind !== 'column' || b.state !== INTACT || b.absent) continue;
        if (b.top && b.top.state !== INTACT) continue; // (its runway already coming down)
        const e = Math.hypot(b.x - H.x, b.z - H.z);
        if (e < K.min || e > Math.min(K.reach, fin(b.h, 9) - 0.3) || e >= bd) continue;
        bd = e;
        best = b;
      }
      if (!best) return false;
      P.col = best;
      return true;
    }
    if (name === 'diesIrae') {
      for (const b of W.list) {
        if (b.kind === 'pressHead' && b.state === INTACT && !b.absent) {
          P.head = b;
          P.base = b.base ?? null;
          return true;
        }
      }
      return false;
    }
    return false;
  }

  /** A tank whose fuse is not burning (the set's fuses). */
  _tankIdle(b) {
    const fs = this.foundry?.tanks;
    if (!fs) return true;
    for (const f of fs) if (f.def === b.def) return f.state === 'idle';
    return true;
  }

  /** Where he stands to take `pc` (a throw: on its side toward the hero; a kick: behind it from the hero, so
   *  it lies between them), turned round it to the nearest open side; inside the floor, at most fetch.out m
   *  past his circle, clear of the world's colliders. A reused record, or null. */
  _spotFor(pc, H, kick) {
    const d = this.d, T = this.T.fetch, rr = fin(pc.r, 0.6) + T.gap, lim = fin(d.bound, 13.8) + T.out;
    let ax = H.x - pc.x, az = H.z - pc.z;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    if (kick) {
      ax = -ax;
      az = -az;
    }
    for (const da of SPOT_TURNS) {
      const c = Math.cos(da), s = Math.sin(da), ux = ax * c + az * s, uz = az * c - ax * s;
      const x = pc.x + ux * rr, z = pc.z + uz * rr;
      if (Math.hypot(x, z) > lim || Math.abs(x) > T.square || Math.abs(z) > T.square) continue;
      if (Math.hypot(x - H.x, z - H.z) < 1.6 || !this._clear(x, z)) continue;
      this._spot.x = x;
      this._spot.z = z;
      return this._spot;
    }
    return null;
  }

  /** Nothing of the world's colliders where he would stand (the world resolves him less than 0.25 m off). */
  _clear(x, z) {
    const W = this.game.world, q = this._probe;
    q.x = x;
    q.z = z;
    W?.resolve?.(q, fin(this.d.T?.radius, 0.45), Infinity);
    return Math.hypot(q.x - x, q.z - z) < 0.25;
  }

  // ------------------------------------------------------------------ the AI's choice, the start
  /** His AI weighs a move of this file's: 0 while its piece is missing, something of his is held or in the
   *  air, or the pace limit is reached. */
  weigh(name, def, w, dist) {
    void def, dist;
    if (!(w > 0) || this.busy || !this._paceOk() || this._heroDown()) return 0;
    if (!this._find(name)) return 0;
    // (Crucible with him standing under its pour too: half as keen; the trick the hero may play on him)
    if (name === 'crucible') {
      const L = this._plan.L, me = this.d.position;
      if (Math.hypot(me.x - L.x, me.z - L.z) < 3.2) return w * this.T.crucible.selfK;
    }
    return w;
  }

  /** A move of this file's starts: its piece is chosen now (false: none, or the guard would not clear it). */
  onActStart(A) {
    const name = A?.name, d = this.d;
    if (!FILE_MOVES.has(name)) return true;
    const no = () => {
      this.stats.refused++;
      return false;
    };
    if (this.busy || !this._paceOk()) return no();
    const P = (A._fsTr = { kind: '', piece: null, spot: null, L: null, col: null, head: null, base: null, sx: NaN, sz: NaN, mx: NaN, mz: NaN, fixed: false, splash: false, h: null, bolt: null, hop: false, arrived: false, took: false, x0: d.position.x, z0: d.position.z, cut: false, aft: false });
    if (!this._find(name, P)) return no();
    const B = d.brain, H = this._hero();
    const b = A.beats.find((x) => !x.feint);
    const toImpact = b ? Math.max(0.05, fin(b.impact)) : 1;
    if (name === 'crucible') {
      // (the pools burn `arm` s after the shot's bolt reaches the chain)
      const M = this.T.molten, L = P.L, g = this._gunAt();
      const at = toImpact + Math.hypot(L.x - g.x, L.h + 1.5 - g.y, L.z - g.z) / this.T.crucible.bolt + M.arm;
      if ((B?.fairDelay?.(at, TELL.RED, 0, name) ?? 0) !== 0) return no();
      P.h = B?.expect?.(at, TELL.RED, name) ?? null;
    } else if (name === 'prostration') {
      const at = toImpact + fin(P.col.fallT, 1.3);
      if ((B?.fairDelay?.(at, TELL.RED, 0, name) ?? 0) !== 0) return no();
      P.h = B?.expect?.(at, TELL.RED, name) ?? null;
    } else if (name === 'diesIrae') {
      const K = this.T.diesIrae, hd = P.head, e = Math.hypot(H.x - hd.x, H.z - hd.z);
      const at = toImpact + 0.1 + Math.max(0, e - K.r0) / K.speed;
      if ((B?.fairDelay?.(at, TELL.RED, this.T.maxDelay, name) ?? 0) < 0) return no();
    }
    if (P.piece) this.W?.reserve?.(P.piece, 6);
    if (P.col) this.W?.reserve?.(P.col, 6);
    this.starts[this._si++ % this.starts.length] = fin(this.game.time);
    this.stats.started++;
    this._myAct = A;
    this.lastPlan = P;
    return true;
  }

  /** What he throws or calls down reaches the hero wherever he is. */
  reach(b) {
    void b;
    return Infinity;
  }

  // ------------------------------------------------------------------ his motion through a beat
  beatMotion(b, u, s, dt) {
    try {
      this._beatMotion(b, fin(u), s, fin(dt));
    } catch (err) {
      console.error('[saint] terrain beatMotion', err);
    }
  }

  _beatMotion(b, u, s, dt) {
    const d = this.d, D = b.def, A = d.brain?.act, P = this._planOf(A);
    if (!P) return;
    if (D.fsRelic === 'fetch') this._fetchMotion(P, A, u, dt);
    else if (D.fsRelic === 'throw' || D.fsRelic === 'kick') {
      if (s) d.yaw = turnToward(d.yaw, Math.atan2(s.p.x - d.position.x, s.p.z - d.position.z), 9 * dt);
      if (D.fsRelic === 'kick') this._light('calfR', 0.35 + 0.65 * clamp(u / 0.85, 0, 1));
    } else if (D.fsLadle && P.L) this._aimLadle(P, u, dt);
    else if (D.fsPillar && P.col) this._aimPillar(P, u, dt);
    else if (D.fsPress && P.head) this._aimPress(P, u, dt);
  }

  /** The jet hop to where he takes the piece, the planted stop, the piece torn up. */
  _fetchMotion(P, A, u, dt) {
    const d = this.d, T = this.T.fetch, pc = P.piece, me = d.position;
    if (!pc) return;
    const [h0, h1] = T.hop;
    if (u < h0) {
      d.yaw = turnToward(d.yaw, Math.atan2(P.sx - me.x, P.sz - me.z), 12 * dt);
      const k = u / h0;
      this._light('back', 0.3 + 0.5 * k);
      this._light('calfR', 0.3 + 0.5 * k);
      this._light('calfL', 0.3 + 0.5 * k);
      return;
    }
    if (!P.hop) {
      P.hop = true;
      P.x0 = me.x;
      P.z0 = me.z;
      const dx = P.sx - me.x, dz = P.sz - me.z, l = Math.hypot(dx, dz) || 1;
      d.fx?.jetBurst?.(me.x, me.z, -dx / l, -dz / l, 1);
      d.fx?.afterimage?.(d, dx / l, dz / l, 0.55);
      this.stats.fetched++;
    }
    if (u <= h1 + 1e-6) {
      const k = ease(clamp((u - h0) / (h1 - h0), 0, 1));
      me.x = P.x0 + (P.sx - P.x0) * k;
      me.z = P.z0 + (P.sz - P.z0) * k;
      d.yaw = turnToward(d.yaw, Math.atan2(P.sx - P.x0, P.sz - P.z0), 14 * dt);
      this._light('back', 1);
      this._light('calfR', 1);
      this._light('calfL', 1);
      return;
    }
    if (!P.arrived) {
      P.arrived = true;
      me.x = P.sx;
      me.z = P.sz;
      const dx = P.sx - P.x0, dz = P.sz - P.z0, l = Math.hypot(dx, dz) || 1;
      d.fx?.dashTrail?.(P.x0, P.z0, P.sx, P.sz, 0.8);
      d.fx?.footPlant?.(P.sx, P.sz, dx / l, dz / l, 0.7, 1);
    }
    d.yaw = turnToward(d.yaw, Math.atan2(pc.x - me.x, pc.z - me.z), 10 * dt);
    if (!P.took && u >= T.take) {
      P.took = true;
      this._take(pc, A, A.name === 'offertory' ? 'kick' : 'hoist');
    }
  }

  /** Tear a piece up into his hands (it rises from where it stood). */
  _take(pc, A, mode) {
    const W = this.W, H = this.held, d = this.d;
    if (!pc || pc.state !== INTACT || pc.absent || H.piece || !W?.take?.(pc, CHIP)) return false;
    H.piece = pc;
    H.act = A;
    H.mode = mode;
    H.t = 0;
    H.x0 = pc.x;
    H.z0 = pc.z;
    H.y0 = fin(pc.y0);
    H.hx = NaN;
    this.stats.taken++;
    d.fx?.dust?.(pc.x, pc.z, 0.8);
    this._grit(pc.x, 0.3, pc.z, 8, 2.4);
    this.game.shake?.(0.12);
    if (mode === 'hoist') d.fsHandR = d.fsHandL = 'reach';
    return true;
  }

  /** CRUCIBLE through its windup: the gun on the chain, the sight line, the pools' places fixed and marked. */
  _aimLadle(P, u, dt) {
    const d = this.d, L = P.L, K = this.T.crucible, me = d.position;
    d.yaw = turnToward(d.yaw, Math.atan2(L.x - me.x, L.z - me.z), 9 * dt);
    this._gun(clamp(u / 0.25, 0, 1));
    const g = this._gunAt(), cy = L.h + 1.5;
    // the sight line on the chain: thin red heat, blinking in the last fifth
    const blink = u > 0.8 ? (Math.sin(fin(this.game.time) * 50) > 0 ? 1 : 0.25) : 1;
    if (u > 0.1) d.fx?._ink?.(g.x, g.y, g.z, L.x, cy, L.z, 0, 0.24 * blink, 0, 0.34 * blink, 0, K_FIRE);
    if (!P.fixed && u >= K.fix) {
      P.fixed = true;
      const H = this._hero(), e = Math.hypot(H.x - L.x, H.z - L.z);
      P.splash = e > K.under;
      if (P.splash) {
        const k = Math.min(e, K.splash.max) / (e || 1);
        P.mx = L.x + (H.x - L.x) * k;
        P.mz = L.z + (H.z - L.z) * k;
      }
    }
    if (P.fixed) {
      const k = clamp((u - K.fix) / Math.max(0.05, 1 - K.fix), 0, 1);
      d.fx?.missileMark?.(L.x, L.z, this._spillR(), k);
      if (P.splash) d.fx?.missileMark?.(P.mx, P.mz, K.splash.r, k);
    }
  }

  _spillR() {
    return fin(this.game.world?.forest?.FOUNDRY_TUNING?.molten?.spill?.r, 2.6);
  }

  /** PROSTRATION through its windup: the red sight line from his eye to the column's foot, the laser last. */
  _aimPillar(P, u, dt) {
    const d = this.d, c = P.col, me = d.position, K = this.T.prostration;
    d.yaw = turnToward(d.yaw, Math.atan2(c.x - me.x, c.z - me.z), 9 * dt);
    d.fx?.sightLine?.(me.x, me.z, c.x, c.z, clamp(u, 0, 1), true);
    if (u >= 1 - K.laser) {
      const e = d.eyePoint?.(this._v3()) ?? null;
      if (e) d.fx?.laser?.(e.x, e.y, e.z, c.x, K.footY, c.z, clamp((u - (1 - K.laser)) / K.laser, 0, 1));
    }
  }

  /** DIES IRAE through its windup: the gun on the press's ram, the sight line. */
  _aimPress(P, u, dt) {
    const d = this.d, hd = P.head, me = d.position, K = this.T.diesIrae;
    d.yaw = turnToward(d.yaw, Math.atan2(hd.x - me.x, hd.z - me.z), 9 * dt);
    this._gun(clamp(u / 0.25, 0, 1));
    const g = this._gunAt();
    const blink = u > 0.8 ? (Math.sin(fin(this.game.time) * 50) > 0 ? 1 : 0.25) : 1;
    if (u > 0.1) d.fx?._ink?.(g.x, g.y, g.z, hd.x, K.aimY, hd.z, 0, 0.24 * blink, 0, 0.34 * blink, 0, K_FIRE);
  }

  /** His forearm gun out (the body draws d.fsGunK). */
  _gun(k) {
    this._gunK = Math.max(fin(this._gunK), clamp(k, 0, 1));
    this.d.fsGunK = this._gunK;
  }

  /** The gun's muzzle (the body's gunR point; his right hand before it is built). */
  _gunAt() {
    const d = this.d, v = this._v3();
    const P = d.partPoint?.('gunR', v);
    if (P && Number.isFinite(P.x + P.y + P.z)) return P;
    v.x = d.position.x + Math.sin(d.yaw) * 0.5;
    v.y = 1.4;
    v.z = d.position.z + Math.cos(d.yaw) * 0.5;
    return v;
  }

  _v3() {
    return (this._vec ??= new (this.d.position.constructor)());
  }

  /** A booster lit (the boost handler draws the body's jets and their flames). */
  _light(part, k) {
    const B = this.d.parts?.boost;
    if (B?._light) B._light(part, k);
    else this.d.fx?.jet?.(part, k);
  }

  // ------------------------------------------------------------------ the casts
  onCast(b, s, a) {
    try {
      this._onCast(b, s, a ?? this.d.brain?.act);
    } catch (err) {
      console.error('[saint] terrain onCast', err);
    }
  }

  _onCast(b, s, A) {
    const D = b.def, P = this._planOf(A);
    if (!P) return;
    if (D.fsRelic === 'throw' || D.fsRelic === 'kick') this._throwHeld(D, A);
    else if (D.fsLadle) this._shootLadle(P);
    else if (D.fsPillar) this._fell(P, s);
    else if (D.fsPress) this._shootPress(P);
  }

  // ------------------------------------------------------------------ the thrown pieces
  /** The held piece goes at the hero (a relic thrown, a tank kicked). */
  _throwHeld(D, A) {
    const H = this.held, pc = H.piece;
    if (!pc || H.act !== A) return null;
    H.piece = null;
    H.act = null;
    if (pc.state !== HELD) return null;
    const kick = D.fsRelic === 'kick';
    const W = this.W, d = this.d, K = kick ? this.T.offertory : this.T.relic;
    const R = this.fly.find((f) => !f.live);
    if (!R || !W?.throwTo) {
      W?.drop?.(pc, GROUND);
      return null;
    }
    const Hh = this._hero(), sn = d.brain?._sense?.();
    let tx = Hh.x, tz = Hh.z;
    if (sn && Number.isFinite(sn.vx + sn.vz)) {
      tx += sn.vx * K.lead;
      tz += sn.vz * K.lead;
    }
    // (a piece held under its own height would land on its first frame: lift it clear first)
    if (!(fin(pc.py) >= 0.3)) W.carry?.(pc, fin(pc.px, pc.x), 0.3, fin(pc.pz, pc.z), 0, 0);
    const sx = fin(pc.px, pc.x), sz = fin(pc.pz, pc.z);
    const dist = Math.hypot(tx - sx, tz - sz), l = dist || 1;
    let fl = Math.max(clamp(dist / K.speed, K.time[0], K.time[1]), K.minFlight);
    const tell = kick ? TELL.RED : TELL.BLUE, attack = A?.name ?? (kick ? 'offertory' : 'relic');
    let quiet = false;
    const dl = d.brain?.fairDelay?.(fl, tell, this.T.maxDelay, attack) ?? 0;
    if (dl > 0) {
      fl += dl;
      this.stats.delays++;
      if (d.brain.stats) d.brain.stats.delays++;
    } else if (dl < 0) quiet = true;
    const tw = this._throw;
    tw.time = fl;
    tw.power = kick ? 0.6 : this.T.relic.power;
    tw.radius = kick ? 1.2 : this.T.relic.radius;
    tw.by = 'boss';
    tw.onLand = this._onLand;
    if (!W.throwTo(pc, tx, tz, tw)) {
      W.drop?.(pc, GROUND);
      return null;
    }
    R.live = true;
    R.piece = pc;
    R.kind = kick ? 'tank' : 'relic';
    R.attack = attack;
    R.tell = tell;
    R.flashed = false;
    R.quiet = quiet;
    R.damage = kick ? 0 : fin(this.T.relic.damage[pc.kind], D.damage);
    R.kb = fin(D.knockback, 5);
    R.hit = kick ? 0 : this.T.relic.hit;
    R.parryPosture = kick ? 0 : this.T.relic.parryPosture;
    R.dx = (tx - sx) / l;
    R.dz = (tz - sz) / l;
    R.tx = tx;
    R.tz = tz;
    R.h?.cancel?.();
    R.h = quiet ? null : d.brain?.expect?.(fl, tell, attack) ?? null;
    if (quiet) this.stats.quiet++;
    this.stats.thrown++;
    this._grit(sx, Math.max(0.4, fin(pc.py) + fin(pc.y0)), sz, 8, 3, R.dx, R.dz);
    if (kick) d.fx?.jetBurst?.(sx, sz, R.dx, R.dz, 0.7);
    this.game.shake?.(0.14);
    d.fsHandR = d.fsHandL = 'guard';
    return R;
  }

  /** A thrown piece came down (the world's onLand). */
  _landed(pc, x, z) {
    const R = this.fly.find((f) => f.live && f.piece === pc);
    if (!R) return;
    const d = this.d, p = this.game.player, pr = fin(p?.radius, 0.45);
    const quiet = R.quiet || !R.flashed;
    this._endFly(R);
    this.stats.landed++;
    const e = p?.position ? Math.hypot(p.position.x - x, p.position.z - z) : Infinity;
    if (R.kind === 'tank') {
      // it bursts where it lands (the set's own blast: the world, the fire, the hero inside it); uncued, a dud
      if (!quiet && !this._heroDown()) {
        this.stats.bursts++;
        this.game.world?.forest?.boom?.(x, z, 'boss');
        this._mark(x, z, 'blast', 1.4, R.dx, R.dz, true);
      } else {
        this.stats.duds++;
        this._blow(x, z, 1.4, this.T.offertory.dud, 'blast', NaN, NaN, 0.6);
        d.fx?.sparks?.(x, 0.6, z, R.dx, R.dz, 12, 1);
        this._mark(x, z, 'slam', 0.8, R.dx, R.dz, false);
      }
      return;
    }
    this._mark(x, z, 'slam', this.T.relic.mark, R.dx, R.dz, false);
    if (e < 6) d.fx?.weight?.('huge', R.dx, R.dz);
    if (quiet || this._heroDown() || this.game.state !== 'boss' || e > R.hit + pr) return;
    const h = this._heroHit, f = h.from;
    f.x = x - R.dx * 1.4;
    f.z = z - R.dz * 1.4;
    h.damage = R.damage;
    h.knockback = R.kb;
    h.tell = R.tell;
    h.attack = R.attack;
    h.parryPosture = R.parryPosture;
    h.kind = 'stone';
    h.flare = true;
    this.stats.hits++;
    const r = d.hitPlayer(h);
    if (r === RESULT.PARRIED) this._shatter(R, x, z);
  }

  /** Parried: the piece breaks on the hero's blade, in front of him (the shards burst there). */
  _shatter(R, x, z) {
    const p = this.game.player?.position, d = this.d;
    this.stats.parried++;
    const hx = fin(p?.x, x) - R.dx * 0.9, hz = fin(p?.z, z) - R.dz * 0.9;
    this._blow(hx, hz, 1.5, 1.2, 'blast', R.dx, R.dz, 0.9, 'player');
    d.fx?.sparks?.(hx, 1.1, hz, -R.dx, -R.dz, 18, 1.4);
    this._grit(hx, 1.0, hz, 12, 4.5, -R.dx, -R.dz);
  }

  // ------------------------------------------------------------------ Crucible's shot
  _shootLadle(P) {
    const d = this.d, L = P.L, K = this.T.crucible;
    this.stats.shots++;
    const g = this._gunAt(), cy = L.h + 1.5;
    const dx = L.x - g.x, dz = L.z - g.z, l = Math.hypot(dx, dz) || 1;
    d.fx?.gunFlash?.(g.x, g.y, g.z, dx / l, dz / l);
    const T = Math.max(0.05, Math.hypot(dx, cy - g.y, dz) / K.bolt);
    const fl = d.fx?.fly?.({ kind: 'bolt', x: g.x, y: g.y, z: g.z, tx: L.x, ty: cy, tz: L.z, T, tell: TELL.RED, attack: 'crucible', expect: false, power: 0.8, onLand: () => this._spill(P) });
    if (fl) this._armBolt(P, fl);
    else this._spill(P);
  }

  _armBolt(P, fl) {
    P.bolt = fl;
    P.boltId = fl.id;
    this._boltP = P;
  }

  _boltDone(P) {
    P.bolt = null;
    if (this._boltP === P) this._boltP = null;
  }

  /** The chain cut: the ladle falls and spills (the set's pool under it), the splash where the hero stood. */
  _spill(P) {
    this._boltDone(P);
    if (P.h) {
      P.h.cancel?.();
      P.h = null;
    }
    const F = this.foundry, L = P.L, d = this.d, K = this.T.crucible;
    if (!F || !L || this._dying()) return;
    if (!F.drop?.(L, 'boss')) return;
    this.stats.spills++;
    if (P.splash && Number.isFinite(P.mx + P.mz)) {
      F.molten?.add?.(P.mx, P.mz, { r: K.splash.r, life: K.splash.life, why: 'boss' });
      this.stats.splashes++;
      // (the steel thrown out of the burst crucible: heat flung from the ladle down onto the splash)
      const fx = d.fx;
      if (fx?._blob) {
        for (let i = 0; i < 18; i++) {
          const k = (i + 0.5) / 18, sp = 0.6 + 0.5 * k;
          const vx = ((P.mx - L.x) / 0.55) * sp + fx.lrand(-0.6, 0.6), vz = ((P.mz - L.z) / 0.55) * sp + fx.lrand(-0.6, 0.6);
          fx._blob(L.x + fx.lrand(-0.3, 0.3), L.h - 0.2, L.z + fx.lrand(-0.3, 0.3), vx, fx.lrand(0.5, 2.5), vz, fx.lrand(0.45, 0.65), 0.34, 0.24, 0.9, 0.5, K_FIRE, 0.4, -11);
        }
      }
    }
  }

  // ------------------------------------------------------------------ Prostration's cut
  _fell(P, s) {
    const d = this.d, W = this.W, c = P.col, K = this.T.prostration;
    if (!c || c.state !== INTACT || !W?.topple) return;
    const H = this._hero();
    let dx = H.x - c.x, dz = H.z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const top = c.top;
    if (top && top.state === INTACT) W.topple(top, dx, dz, 'boss');
    if (!W.topple(c, dx, dz, 'boss')) return;
    this.stats.felled++;
    P.cut = true;
    // the ledger: the strip lands when its fall ends (the world's own cue goes out as it starts)
    P.h?.retime?.(Math.max(0.05, fin(c.T, 1.3) - fin(c.t)));
    const e = d.eyePoint?.(this._v3()) ?? null;
    if (e) d.fx?.laser?.(e.x, e.y, e.z, c.x, K.footY, c.z, 1);
    d.fx?.sparks?.(c.x - dx * 0.4, K.footY, c.z - dz * 0.4, -dx, -dz, 22, 1.4);
    d.fx?.boltHit?.(c.x, K.footY, c.z, 1.2);
    this._mark(c.x, c.z, 'blast', 1.0, dx, dz, true);
    void s;
  }

  // ------------------------------------------------------------------ Dies Irae
  _shootPress(P) {
    const d = this.d, hd = P.head, K = this.T.diesIrae;
    this.stats.shots++;
    const g = this._gunAt();
    const dx = hd.x - g.x, dz = hd.z - g.z, l = Math.hypot(dx, dz) || 1;
    d.fx?.gunFlash?.(g.x, g.y, g.z, dx / l, dz / l);
    const T = Math.max(0.05, Math.hypot(dx, K.aimY - g.y, dz) / K.bolt);
    const fl = d.fx?.fly?.({ kind: 'bolt', x: g.x, y: g.y, z: g.z, tx: hd.x, ty: K.aimY, tz: hd.z, T, tell: TELL.RED, attack: 'diesIrae', expect: false, power: 1, onLand: () => this._slam(P) });
    if (fl) this._armBolt(P, fl);
    else this._slam(P);
  }

  /** The press slams: it bites its own ram, the floor jumps, and the front leaves. */
  _slam(P) {
    this._boltDone(P);
    const d = this.d, K = this.T.diesIrae, hd = P.head, W = this.game.world;
    if (!hd || this._dying()) return;
    const x = hd.x, z = hd.z;
    this.stats.slams++;
    this._blow(x, z, 1.6, K.slam, 'blunt', NaN, NaN, K.aimY);
    d.fx?.shock?.(x, z, 5, d.fx?._opt?.(1.3, 0.2, 'dust', 0, true));
    d.fx?.sparks?.(x, 1.6, z, 0, 0, 30, 1.6);
    W?.forest?.ambience?.flare?.(0.6);
    this._mark(x, z, 'blast', 2.2, NaN, NaN, false);
    this.game.shake?.(0.65);
    // the front
    const F = this.front, B = d.brain, H = this._hero();
    this._endFront();
    F.live = true;
    F.t = 0;
    F.wait = 0;
    F.x = x;
    F.z = z;
    F.R = F.Rp = K.r0;
    F.hit = false;
    F.flashed = false;
    F.quiet = false;
    F.told = false;
    F.src = this.W?.swing?.() ?? -1;
    const tIn = Math.max(0.05, (Math.hypot(H.x - x, H.z - z) - K.r0) / K.speed);
    const dl = B?.fairDelay?.(tIn, TELL.RED, this.T.maxDelay, 'diesIrae') ?? 0;
    if (dl > 0) {
      F.wait = dl;
      this.stats.delays++;
      if (B.stats) B.stats.delays++;
    } else if (dl < 0 || this._heroDown()) F.quiet = true;
    if (F.quiet) this.stats.quiet++;
    else {
      F.h = B?.expect?.(tIn + F.wait, TELL.RED, 'diesIrae') ?? null;
      const t = this._frontTell;
      t.impactIn = tIn + F.wait;
      t.x = H.x;
      t.z = H.z;
      d.emit('combat:tell', t);
      F.told = true;
    }
    this.stats.fronts++;
  }

  /** The front runs out: what it passes is struck once; it reaches the hero once (cued on it). */
  _frontFrame(dt) {
    const F = this.front;
    if (!F.live) return;
    const d = this.d, K = this.T.diesIrae, W = this.W;
    F.t += dt;
    if (F.wait > 0) {
      F.wait = Math.max(0, F.wait - dt);
      return;
    }
    F.Rp = F.R;
    F.R += K.speed * dt;
    const R0 = F.Rp, R1 = F.R;
    // the pieces and plates it passes this frame
    if (W?.list) {
      const o = this._o;
      o.kind = 'blast';
      o.by = 'boss';
      o.src = F.src;
      o.scar = false;
      o.falloff = 0.3;
      for (const b of W.list) {
        // (a ground shock: the ladles hang over it on their chains, their cranes stand)
        if (b.state !== INTACT || b.absent || !(b.hpMax < Infinity) || SPARED.has(b.kind)) continue;
        const e = Math.hypot(b.x - F.x, b.z - F.z);
        if (e < R0 || e >= R1) continue;
        const k = 1 - (1 - K.farK) * clamp(e / K.r1, 0, 1);
        o.dx = (b.x - F.x) / (e || 1);
        o.dz = (b.z - F.z) / (e || 1);
        o.y = b.floor ? 0.2 : 0.8;
        W.strike(b.x, b.z, b.floor ? 0.35 : Math.max(0.4, fin(b.r, 0.5)), K.power * k * (b.floor ? K.plate : 1), o);
        this.stats.frontStruck++;
      }
    }
    // the hero: the time to the front's reach, the flash, the blow
    const p = this.game.player, pp = p?.position, pr = fin(p?.radius, 0.45);
    if (pp) {
      const e = Math.hypot(pp.x - F.x, pp.z - F.z), left = (e - pr * 0.5 - R1) / K.speed;
      if (F.h) F.h.retime?.(Math.max(0, left));
      if (!F.flashed && !F.quiet && left <= this.lead && left > -0.05) {
        F.flashed = true;
        if (this._heroDown()) F.quiet = true;
        else {
          const f = this._frontFlash, k = (R1 + pr * 0.5) / (e || 1);
          f.x = F.x + (pp.x - F.x) * Math.min(1, k);
          f.z = F.z + (pp.z - F.z) * Math.min(1, k);
          d.emit('combat:flash', f);
          d.fx?.hazardFlash?.(TELL.RED, f.x, 0.4, f.z, 1);
        }
      }
      if (!F.hit && R1 + pr * 0.5 >= e && R1 - K.band <= e) {
        F.hit = true;
        F.h?.cancel?.();
        F.h = null;
        if (F.flashed && !F.quiet && !this._heroDown() && this.game.state === 'boss') {
          this._from.x = F.x;
          this._from.z = F.z;
          this.stats.frontHits++;
          d.hitPlayer({ damage: K.damage, knockback: K.knockback, knockdown: false, kind: 'crush', tell: TELL.RED, attack: 'diesIrae', from: this._from, parryable: false, blockable: false, extra: NO_PLUNGE });
        }
      }
    }
    this._frontDraw(F, K);
    if (F.R >= K.r1) this._endFront();
  }

  /** The front drawn: a ragged red-hot ripple along its arc over the floor (heat in the fire field, one frame
   *  each), grit thrown up behind it. */
  _frontDraw(F, K) {
    const fx = this.d.fx;
    if (!fx?._blob || !fx._frame) return;
    const life = fx._frame();
    if (!(life > 0)) return;
    const R = F.R, half = 15.6, step = K.gridStep;
    const n = Math.min(420, Math.max(12, Math.ceil((TAU * R) / step)));
    // (floor heat prints GROUND_GAIN hotter: the field's soft depth test fades what hugs the floor)
    const heat = (F.quiet ? 0.22 : 0.62) * GROUND_GAIN;
    let drawn = 0;
    for (let i = 0; i < n && drawn < 220; i++) {
      const a = (i / n) * TAU, ca = Math.cos(a), sa = Math.sin(a), x = F.x + ca * R, z = F.z + sa * R;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const st = 0.65 + 0.35 * Math.sin(a * 7 + F.t * 9);
      // the crest (red-hot, a frame) and the wake behind it (it cools over a few tenths of a second)
      fx._blob(x, GROUND_Y, z, 0, 0, 0, life, 0.7, 0.7, heat * st, heat * st, K_FIRE);
      if ((i & 1) === 0) fx._blob(x - ca * 0.5, GROUND_Y, z - sa * 0.5, 0, 0, 0, 0.28, 0.6, 0.5, 0.45 * heat * st, 0, K_FIRE);
      drawn++;
      if ((i & 7) === 0 && fx.lr() < 0.5) this._grit(x, 0.15, z, 1, 2.2, Math.cos(a), Math.sin(a));
    }
    if (drawn > 0 && fx.lr() < 0.3) fx._blob(F.x + Math.cos(F.t * 3) * R, GROUND_Y + 0.3, F.z + Math.sin(F.t * 3) * R, 0, 0.6, 0, 0.3, 0.6, 1.0, 0.3, 0, K_STEEL);
  }

  // ------------------------------------------------------------------ every frame
  frame(dt) {
    try {
      this._frame(fin(dt));
    } catch (err) {
      console.error('[saint] terrain frame', err);
    }
  }

  _frame(dt) {
    if (!(dt >= 0)) dt = 0;
    const d = this.d, act = d.mode === 'act' ? d.brain?.act : null;
    this._molten(dt);
    this._heldFrame(dt, act);
    this._flyFrame();
    this._frontFrame(dt);
    this._change(act);
    // his act over: the hands back to his guard, the gun closed
    if (this._myAct && act !== this._myAct) {
      const P = this._planOf(this._myAct);
      if (P?.h && !P.bolt && !P.cut) {
        P.h.cancel?.();
        P.h = null;
      }
      this._myAct = null;
      if (d.fsHandR === 'reach' || d.fsHandR === 'guard') d.fsHandR = undefined;
      if (d.fsHandL === 'reach' || d.fsHandL === 'guard') d.fsHandL = undefined;
    }
    if (this._gunK > 0 && !(act && FILE_MOVES.has(act.name) && (act.name === 'crucible' || act.name === 'diesIrae'))) {
      this._gunK = Math.max(0, this._gunK - dt * 3);
      d.fsGunK = this._gunK;
    }
    // out past his circle after a fetch: through his recovery he walks back in (footwork does it after)
    if (act && act === this._myAct && act.t > act.recoveryStart - 1e-6) this._home(dt, null);
  }

  /** The held piece: in his hands (a hoist) or where it stands (a kick); let go if his move is cut short. */
  _heldFrame(dt, act) {
    const H = this.held, pc = H.piece, W = this.W, d = this.d;
    if (!pc) return;
    if (pc.state !== HELD) {
      // (cut out of his hands by the hero's blade: it broke)
      H.piece = null;
      H.act = null;
      return;
    }
    if (H.act !== act) {
      this._letGo();
      return;
    }
    H.t += dt;
    if (H.mode === 'kick') {
      // (it stands where it stood, rocking as he braces his foot on it)
      W?.carry?.(pc, H.x0, 0.02 + 0.03 * Math.sin(H.t * 16), H.z0, 0.04 * Math.sin(H.t * 11), d.yaw);
      return;
    }
    // a hoist: from where it lay up into his hands (their point, fresh after the last pose)
    const k = ease(clamp(H.t / 0.3, 0, 1));
    const hx = Number.isFinite(H.hx) ? H.hx : d.position.x, hy = Number.isFinite(H.hy) ? H.hy : 1.6, hz = Number.isFinite(H.hz) ? H.hz : d.position.z;
    const y = Math.max(0.15, hy - fin(pc.h, 0.6) * 0.5 - fin(pc.y0)) * k;
    W?.carry?.(pc, H.x0 + (hx - H.x0) * k, y, H.z0 + (hz - H.z0) * k, 0.25 * k, d.yaw + Math.PI / 2);
  }

  afterPose(dt, a) {
    void dt, a;
    const H = this.held, d = this.d;
    if (!H.piece || H.mode !== 'hoist') return;
    const v = this._v3();
    const r = d.handPoint?.('R', v);
    if (!r || !Number.isFinite(r.x + r.y + r.z)) return;
    const rx = r.x, ry = r.y, rz = r.z;
    const q = d.handPoint?.('L', v);
    if (q && Number.isFinite(q.x + q.y + q.z)) {
      H.hx = (rx + q.x) * 0.5;
      H.hy = (ry + q.y) * 0.5;
      H.hz = (rz + q.z) * 0.5;
    } else {
      H.hx = rx;
      H.hy = ry;
      H.hz = rz;
    }
  }

  /** What flies: retimed, its flare on it flashLead s before it lands. */
  _flyFrame() {
    // (what flies moves on after this, in the world's update: a frame early, so the flare comes flashLead
    // s before it lands, as a blade's glint before its impact)
    const d = this.d, lead = this.lead + fin(this.game.dt, 1 / 60);
    for (const R of this.fly) {
      if (!R.live) continue;
      const pc = R.piece;
      if (!pc || pc.state !== FLYING) {
        this._endFly(R);
        continue;
      }
      const left = fin(pc.T) - fin(pc.t);
      R.h?.retime?.(Math.max(0, left));
      if (R.flashed || left > lead) continue;
      R.flashed = true;
      if (!R.quiet && this._heroDown()) {
        R.quiet = true;
        R.h?.cancel?.();
        R.h = null;
      }
      if (R.quiet) continue;
      const y = Math.max(0.4, fin(pc.py) + fin(pc.y0) + 0.3), f = this._flareRec;
      f.attack = R.attack;
      f.tell = R.tell;
      f.x = fin(pc.px, pc.x);
      f.y = y;
      f.z = fin(pc.pz, pc.z);
      f.hazard = R.kind === 'tank';
      f.flare = R.tell === TELL.BLUE;
      d.emit('combat:flash', f);
      d.fx?.tellFlash?.(R.tell, f.x, y, f.z, 1, f.flare);
    }
  }

  // ------------------------------------------------------------------ his way home (out past his circle)
  /** The footwork hook: out past his circle (a fetch), he walks back in; true = it moved him. */
  footwork(dt, s) {
    return this._home(fin(dt), s);
  }

  _home(dt, s) {
    const d = this.d, me = d.position, B = fin(d.bound, 13.8), r = Math.hypot(me.x, me.z);
    if (!(r > B + 0.02) || !(dt > 0)) return false;
    const step = Math.min(r - B, this.T.fetch.home * dt), ux = me.x / r, uz = me.z / r;
    me.x -= ux * step;
    me.z -= uz * step;
    this.game.world?.resolve?.(me, fin(d.T?.radius, 0.45), Infinity);
    if (s) {
      d.groundVelSet?.((-ux * step) / dt, (-uz * step) / dt);
      d.yaw = turnToward(d.yaw, s.ang, 8 * dt);
    }
    return true;
  }

  // ------------------------------------------------------------------ the transitions' world
  /**
   * saint.js `_moment(n)`'s world blow, phase by phase (true: done here; core's one 7 m ring at 2.2 is then
   * not struck). NEEDS the lead's one-line edit in saint.js _moment: `if (!this.parts?.terrain?.onMoment?.(n))`
   * before its `W?.impact(...)`. Without it, `_change` (frame) adds this file's effects on top of core's ring.
   */
  onMoment(n) {
    try {
      const a = this.d.brain?.act ?? null;
      if (a?.def?.transition) this._chDone = a;
      return this._changeWorld(n | 0, true);
    } catch (err) {
      console.error('[saint] terrain onMoment', err);
      return false;
    }
  }

  /** A transition's impact seen from frame (its beat struck; core's ring went out): this file's effects on top. */
  _change(act) {
    const a = act ?? null;
    if (!a?.def?.transition || a === this._chDone) return;
    const b = a.beats[0];
    if (!b?.struck) return;
    this._chDone = a;
    this._changeWorld(a.def.phase | 0, false);
  }

  /** The change into phase n strikes the world round him (`own`: the push ring is this file's too). */
  _changeWorld(n, own) {
    const C = this.T.change[n];
    if (!C) return false;
    const d = this.d, x = d.position.x, z = d.position.z, fx = d.fx;
    this.stats.changes++;
    if (own && C.ring) this._blow(x, z, C.ring.r, C.ring.power, 'blast', NaN, NaN, 1);
    if (n === 2) {
      fx?.shock?.(x, z, C.shock, fx._opt?.(0.6, 0.05, 'dust', 0, false));
      this._blow(x, z, C.crackR, C.crack, 'blast', NaN, NaN, 0.2);
      return true;
    }
    // 3 / 4: floor plates torn up round him and thrown out
    this._throwPlates(x, z, C);
    fx?.shock?.(x, z, C.shock, fx._opt?.(n === 4 ? 1.4 : 1.0, n === 4 ? 0.5 : 0.25, n === 4 ? 'fire' : 'dust', 0, true));
    if (n === 3) {
      fx?.jetBurst?.(x, z, 0, 0, 1.2);
      return true;
    }
    // 4: the nova strikes every standing piece within reach; the furnace roars
    const W = this.W;
    const m = W?.around?.(x, z, C.reach, this._near, 64) ?? 0;
    const o = this._o;
    o.kind = 'blast';
    o.by = 'boss';
    o.scar = true;
    o.falloff = 0.2;
    o.src = W?.swing?.() ?? -1;
    for (let i = 0; i < m; i++) {
      const q = this._near[i];
      // (the ladles and the cranes that hold them are spared: his Crucible's, and the hero's trick)
      if (!q || q.state !== INTACT || !(q.hpMax < Infinity) || SPARED.has(q.kind)) continue;
      const e = Math.hypot(q.x - x, q.z - z), k = 1 - (1 - C.farK) * clamp(e / C.reach, 0, 1);
      o.dx = (q.x - x) / (e || 1);
      o.dz = (q.z - z) / (e || 1);
      o.y = Math.min(2, fin(q.y0) + 0.8);
      W.strike(q.x, q.z, Math.max(0.5, fin(q.r, 0.5)), C.power * k, o);
      this.stats.changeStruck++;
    }
    this._near.length = 0;
    this.game.world?.forest?.ambience?.flare?.(C.flare);
    return true;
  }

  /** `C.plates` floor plates between C.rIn and C.rOut m of (x, z), spread round him, torn up and thrown out. */
  _throwPlates(x, z, C) {
    const W = this.W;
    if (!W?.floorNear || !W.take || !W.throwTo) return;
    const out = this._slabs;
    // (outward from rIn: the nearest whole plates; core's push ring may have broken the inner ones, then the
    // plates thrown are the ring's rim, out to rOut + C.rim)
    const n = W.floorNear(x, z, C.rOut + fin(C.rim, 0), out, { max: 120 }) ?? 0;
    // one plate per sector of the ring (the first in it that lies between rIn and rOut): spread, not a clump
    let thrown = 0;
    const sectors = C.plates, used = this._used ?? (this._used = new Uint8Array(32));
    used.fill(0);
    for (let i = 0; i < n && thrown < sectors; i++) {
      const b = out[i];
      if (!b || b.state !== INTACT) continue;
      const e = Math.hypot(b.x - x, b.z - z);
      if (e < C.rIn) continue;
      const a = Math.atan2(b.z - z, b.x - x), si = Math.floor(((a + Math.PI) / TAU) * sectors) % sectors;
      if (used[si]) continue;
      const ux = (b.x - x) / (e || 1), uz = (b.z - z) / (e || 1);
      // (how far and how long by a hash of its place: no draw on any stream)
      const h = hash2(b.x, b.z);
      const far = C.throw[0] + (C.throw[1] - C.throw[0]) * h, T = C.flight[0] + (C.flight[1] - C.flight[0]) * (1 - h);
      // (never onto a full ladle: a plate's landing would bring it down)
      if (this._nearLadle(b.x + ux * far * 0.5, b.z + uz * far * 0.5, 3) || this._nearLadle(b.x + ux * far, b.z + uz * far, 3)) {
        continue;
      }
      if (!W.take(b)) continue;
      used[si] = 1;
      W.carry(b, b.x, 0.15, b.z, 0.5, Math.atan2(ux, uz));
      const tw = this._throw;
      tw.time = T;
      tw.power = 0.45;
      tw.radius = 1.0;
      tw.by = 'boss';
      tw.onLand = null;
      W.throwTo(b, b.x + ux * far, b.z + uz * far, tw);
      thrown++;
    }
    this.stats.platesThrown += thrown;
    out.length = 0;
  }

  /** A full ladle within r m of (x, z). */
  _nearLadle(x, z, r) {
    const Ls = this.foundry?.ladles;
    if (!Ls) return false;
    for (const L of Ls) if (L.full && Math.hypot(L.x - x, L.z - z) < r) return true;
    return false;
  }

  // ------------------------------------------------------------------ THE MOLTEN POOLS
  _molten(dt) {
    const F = this.foundry, M = this.T.molten;
    this._heroT = Math.max(0, this._heroT - dt);
    this._bossT = Math.max(0, this._bossT - dt);
    const d = this.d, p = this.game.player;
    // (a hero down or held is spared, and for `grace` s after he is up)
    if (this._heroDown()) this._graceT = M.grace;
    else this._graceT = Math.max(0, this._graceT - dt);
    const pools = F?.molten?.pools;
    if (!pools || !M) return;
    for (const P of pools) {
      if (!P?.alive) continue;
      if (P.id > this._seen) {
        this._seen = P.id;
        this.stats.pools++;
        this._cue(P, Math.max(0, M.arm - fin(P.t)));
      }
      if (fin(P.t) < M.arm) continue;
      // the hero in it
      if (p?.position && p.alive !== false && this._heroT <= 0 && this._graceT <= 0) {
        const e = Math.hypot(p.position.x - P.x, p.position.z - P.z);
        if (e < P.r + M.pad + fin(p.radius, 0.45) * 0.5) {
          this._heroT = M.tick;
          const h = this._hit;
          h.damage = M.hero;
          // (out past its rim: one burn per entry, never a trap)
          h.knockback = Math.max(M.knockback, P.r + M.pad + M.rim - e);
          h.from.x = P.x;
          h.from.z = P.z;
          if (e < 0.05) {
            h.from.x = P.x - Math.sin(p.yaw ?? 0) * 0.1;
            h.from.z = P.z - Math.cos(p.yaw ?? 0) * 0.1;
          }
          if (d.mode !== 'dying' && d.mode !== 'dead' && d.hitPlayer(h) === RESULT.HIT) this.stats.heroBurns++;
        }
      }
      // him in it
      if (this._bossT <= 0 && d.mode !== 'dying' && d.mode !== 'dead' && Math.hypot(d.position.x - P.x, d.position.z - P.z) < P.r + M.pad) {
        this._bossT = M.tick;
        if (d.onMolten?.(M.boss, M.posture, P.x, P.z) > 0) this.stats.bossBurns++;
      }
    }
  }

  /** A pool's red cue where it lies, `inS` s before it burns (the ledger, the HUD, the sound, the bots). */
  _cue(P, inS) {
    const d = this.d;
    if (d.mode === 'sleep' || d.mode === 'dying' || d.mode === 'dead') return;
    this.stats.cued++;
    if (inS > 0) {
      const t = this._tell;
      t.impactIn = inS;
      t.x = P.x;
      t.z = P.z;
      d.emit('combat:tell', t);
      d.brain?.expect?.(inS, TELL.RED, 'molten');
    }
    const f = this._flash;
    f.x = P.x;
    f.z = P.z;
    d.emit('combat:flash', f);
    d.fx?.hazardFlash?.(TELL.RED, P.x, 0.3, P.z, 1);
  }

  // ------------------------------------------------------------------ helpers
  /** A blow of the world's at (x, z): `power` over `r`, its kind, its way (NaN: radial), its height. */
  _blow(x, z, r, power, kind, dx, dz, y, by = 'boss') {
    const W = this.game.world, o = this._o;
    o.kind = kind;
    o.by = by;
    o.dx = dx;
    o.dz = dz;
    o.y = y;
    o.scar = true;
    o.falloff = 0.3;
    o.src = W?.destructibles?.swing?.() ?? -1;
    return W?.impact?.(x, z, r, power, o) ?? 0;
  }

  /** A floor mark (world.groundBlow: the floor keeps it till the reset). */
  _mark(x, z, kind, power, dx, dz, hot) {
    const m = this._gm;
    m.kind = kind;
    m.power = power;
    m.r = Math.max(1, power);
    m.dx = Number.isFinite(dx) ? dx : 0;
    m.dz = Number.isFinite(dz) ? dz : 0;
    m.hot = !!hot;
    this.game.world?.groundBlow?.(x, z, m);
  }

  /** A little burst of grit (glyph particles of a letter cell), from the effects' stream. */
  _grit(x, y, z, n, speed, dx = 0, dz = 0) {
    const fx = this.d.fx;
    if (!fx?._rec || !fx._spawn || !Number.isFinite(x + y + z)) return;
    for (let i = 0; i < n; i++) {
      const a = fx.lrand(0, TAU), sp = fx.lrand(0.4, 1) * speed;
      const o = fx._rec(x + fx.lrand(-0.3, 0.3), y + fx.lrand(-0.1, 0.2), z + fx.lrand(-0.3, 0.3), fx.lrand(0.35, 0.7), fx.lrand(0.16, 0.24), 0.06, ".,:'`", GRIT, GRIT_END);
      o.vx = Math.cos(a) * sp * 0.6 + dx * speed * 0.6;
      o.vy = fx.lrand(0.6, 2.4);
      o.vz = Math.sin(a) * sp * 0.6 + dz * speed * 0.6;
      o.drag = 1.6;
      o.gravity = -9;
      o.alpha = 0.9;
      fx._spawn(fx.alpha, o);
    }
  }

  // ------------------------------------------------------------------ the rest of the contract
  hitPlayer(o) {
    return o;
  }
  onHit(o, r) {
    void o, r;
  }
  onParried(info, b) {
    void info, b;
    return false;
  }
  onImpact(b, s, a) {
    void b, s, a;
  }
}

const TANK = Object.freeze(['tank']);
const FILE_MOVES = new Set(['offertory', 'crucible', 'relic', 'prostration', 'diesIrae']);
const SPOT_TURNS = Object.freeze([0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, Math.PI]);
const NO_PLUNGE = Object.freeze({ plunge: false });
// (the tuning pass: the tanks too: the phase-4 change's nova and every Dies Irae front burst the corner tanks, so
// Offertory was never picked in phase 4; his barrage, his beams and the hero's blade still burst them)
const SPARED = new Set(['ladle', 'jib', 'jibPost', 'tank']);
/** 0..1 from a place (a fixed hash: no draw on any stream). */
function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
