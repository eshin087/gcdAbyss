import * as THREE from 'three';
import { RESULT, TELL as RULE_TELL } from '../../../../combat/rules.js';
import { clamp, turnToward } from '../../../../core/math.js';
import { TUNE as HERO_TUNE } from '../../../player/player.js';
import { DUEL_WORLD } from '../../duelist/worldTuning.js';
import { TUNING_MELEE } from '../tuningMelee.js';

// The False Saint's ground game (the MELEE AGENT's file; moves.js is the router: its header has the format
// and the rules). Open hands, a sweep and a knee, the grab, the long walk, his counters, his phase-1 flurry,
// and the plated arm's strings of phases 2 - 4. The boosters (the booster punch, the plated arm's rapid
// flurry, the jet dash, the dive, the overclock, the last grab) are moves/boost.js's.
// Exports:
//   moves(X)        → { name: move }   (X: the builders, moves.js; no import of moves.js: a cycle)
//   LINKS           {} (his combo links for EVERY move of the table live in ../links.js, the melee agent's)
//   FIELDS          the beat fields this file's HANDLER owns (below)
//   create(d)       → the handler (FsMelee)
// Every new beat or move field is prefixed `fs`. Poses: ../posesMelee.js (`ml` fragments: row 2 of the
// owner's second sheet is Benediction's last palm, panel by panel); numbers: ../tuningMelee.js.
//
// THE HOUSE RHYTHM: every blue or red blow of his HOLDS its coil through the middle of the windup (the
// pose formed by u 0.36, held to the cock: the silhouette is read before the flare, ADR-225's held tells
// in his own shapes); the strike out of it is the fast part. A normal blow is a short draw and a snap.
// He is the fastest hand in the game because he LINKS (../links.js) and recovers short (TUNING
// recoveryScale), never because a windup is short: every unfixed windup here is >= 0.5 s at phase 1
// (>= 0.42 at phase 4).
//
// THE BEAT FIELDS: `fsBlow: 'light' | 'heavy' | 'grab' | 'lift'` routes a beat to this handler (every beat
// of this file has one; the only field in FIELDS). The handler also reads, on its own beats:
//   fsCrash: power   a landed blow throws the hero THROUGH what stands behind him (player.js crash:
//                    `wjCrash` / `wjCrashDamage` in the hit's extra)
//   fsLay: 1         Laying On of Hands' reach: caught (a hit), the hero is held (player.hold) and the
//                    hidden move `layHandsLift` lifts him and throws him at the nearest standing piece
//   fsLift: 1        the lift's feint beat: its impact is the throw (the handler's, never the last HP)
//   fsWalk: 1        The Long Walk: light cuts land through the walk and do not stop him (takeHit), a
//                    heavy cut staggers him; the straight carries on into the scenery unless parried
//   fsQuake: 'gavel' the impact's crater (world.impact, fx.crater) before him
//   fsShove: 1       the double palm's shove through cover: a sweep of the line ahead at the palms' height
//   fsSlip: m        Rebuke's slip (the pack's B3): the root carried m to his left through the draw
// Every beat here is `noWorld` (the engine's world blow is at y 1): the handler's own blow (_world) strikes
// the world at the striking limb's REAL height, with the beat's zone, at TUNING.melee.world power.

/** The beat fields this handler owns (moves.js routes a beat with one of them here). */
export const FIELDS = Object.freeze(['fsBlow']);

const TM = TUNING_MELEE;
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

export function moves(X) {
  const { TELL, FRAGS } = X;
  const { N, B, R } = TELL;
  const FOL = TM.follow, BN = TM.benediction, GN = TM.genuflect, LH = TM.layHands, LW = TM.longWalk, RB = TM.rebuke, PE = TM.penance;
  const AN = TM.anathema, RQ = TM.requiem, LT = TM.litany, IN = TM.interdict, CO = TM.castOut, LD = TM.lauds;
  const STAND = FRAGS.STAND ?? {};
  const fr = (n) => FRAGS[n] ?? {};
  /** A whole pose: the stance's every field, then `p`; the head turned back onto the opponent. */
  const S = (p) => {
    const o = { ...STAND, ...p };
    if (p.hdY === undefined) o.hdY = fin(STAND.hdY) - (fin(o.yaw) - fin(STAND.yaw)) * 0.82 - (fin(o.spY) - fin(STAND.spY)) * 0.82;
    return o;
  };
  const lerpV = (a, b, k) => (Array.isArray(a) && Array.isArray(b) ? a.map((v, i) => v + ((b[i] ?? v) - v) * k) : a);
  /** Between two whole poses at k (a foot that moves more than 0.12 m is lifted 0.08 m: a step). */
  const mid = (a, b, k = 0.25) => {
    const o = {};
    for (const f of Object.keys(b)) {
      const x = a[f] ?? b[f], y = b[f];
      if ((f === 'rF' || f === 'lF') && Array.isArray(x) && Array.isArray(y) && x.length === 3 && y.length === 3) {
        const dd = Math.hypot(y[0] - x[0], y[2] - x[2]);
        o[f] = [x[0] + (y[0] - x[0]) * 0.5, (x[1] + y[1]) * 0.5 + (dd > 0.12 ? 0.08 : 0), x[2] + (y[2] - x[2]) * 0.5];
      } else if (Array.isArray(y)) o[f] = lerpV(x, y, k);
      else if (typeof y === 'number' && typeof x === 'number') o[f] = x + (y - x) * k;
      else o[f] = y;
    }
    return o;
  };
  /** The follow-through: the striking hands drawn a little back toward his guard, the rest held. */
  const after = (h, k = 0.28) => ({ ...h, rH: lerpV(h.rH, STAND.rH, k), lH: lerpV(h.lH, STAND.lH, k) });
  /**
   * A blow's keys (u: 0..1 the windup, 1 the impact, 2 the follow-through's end): the coil at the cock
   * (a normal blow: drawn from the guard; `held`: formed by u 0.36 and HELD to the cock, his blue / red
   * read), half way a quarter into the strike (it eases in: a blow that accelerates), the strike, the
   * follow-through.
   */
  const keysOf = ({ coil, hit, fo = null, pre = null, cock = 0.72, held = false }) => {
    const c = S(coil), h = S(hit), f = fo ? S(fo) : after(h);
    const k = [];
    if (held) k.push([0.36, c]);
    else if (pre) k.push([cock * 0.45, S(pre)]);
    k.push([cock, c]);
    k.push([cock + (1 - cock) * 0.5, { ...mid(c, h), e: 'i' }]);
    k.push([1.0, { ...h, e: 'l' }]);
    k.push([1.6, { ...f, e: 'o' }]);
    k.push([2.0, f]);
    return k;
  };
  /** One blow of his (the fields every beat here carries). */
  const blow = (o) => ({ active: 0.09, noWorld: true, fsBlow: o.tell === N ? 'light' : 'heavy', track: 0.75, ...o });
  /** A string's later beat: it steps in up to follow.close m through its windup (the slide of the last). */
  const follows = (beat, extra = {}) => ({ ...beat, close: FOL.close, ...extra });
  const PALM = { kind: 'sector', r: 1.9, ang: 0.55 };
  const LINE = (r, w) => ({ kind: 'line', r, w });
  const lunge = (m, cock = 0.8) => [[cock, 0], [1.0, m], [2.0, m]];

  // ---- the blows several moves share
  const palmL = (tell, windup, damage, knockback, o = {}) => blow({ tell, windup, damage, knockback, zone: PALM, part: 'fistL', cock: 0.74, keys: keysOf({ coil: fr('mlPalmLCoil'), hit: fr('mlPalmL'), cock: 0.74 }), ...o });
  const palmR = (tell, windup, damage, knockback, o = {}) => blow({ tell, windup, damage, knockback, zone: PALM, part: 'fistR', cock: 0.72, keys: keysOf({ coil: fr('mlPalmRCoil'), hit: fr('mlPalmR'), cock: 0.72 }), ...o });
  const elbowR = (tell, windup, damage, knockback, o = {}) => blow({ tell, windup, damage, knockback, zone: { kind: 'sector', r: 1.6, ang: 0.8, fwd: 0.3 }, part: 'elbowR', cock: 0.7, keys: keysOf({ coil: fr('mlSlip'), hit: fr('mlElbow'), cock: 0.7, held: tell !== N }), ...o });
  const gavel = (windup, damage, knockback, o = {}) => blow({
    tell: R, windup, damage, knockback, zone: { kind: 'ring', r: IN.ring, fwd: IN.fwd }, ring: IN.ring, part: 'fistR', cock: 0.8, track: 0.8,
    fsQuake: 'gavel', groundMark: { kind: 'slam', fwd: IN.fwd }, keys: keysOf({ coil: fr('mlGavelUp'), hit: fr('mlGavel'), cock: 0.8, held: true }), ...o,
  });
  const doublePalm = (windup, damage, knockback, o = {}) => blow({
    tell: B, flare: true, windup, damage, knockback, blockPush: CO.blockPush, guardCost: CO.guardCost, zone: LINE(2.4, 1.1), part: 'palms', cock: 0.8, close: 3.4,
    travel: lunge(CO.lunge), fsShove: 1, fsCrash: CO.crash, keys: keysOf({ coil: fr('mlDoubleCoil'), hit: fr('mlDouble'), cock: 0.8, held: true }), ...o,
  });

  // ---- Litany: alternating palms, the later ones from another side of the hero (the engine's flit)
  const litany = [];
  for (let i = 0; i < LT.blows; i++) {
    const o = i > 0 ? { flit: { r: 2.4 } } : {};
    litany.push(i % 2 === 0 ? palmL(N, LT.windup[i === 0 ? 0 : 1], LT.damage, LT.knockback, o) : palmR(N, LT.windup[1], LT.damage, LT.knockback, o));
  }

  // ---- The Long Walk: four unhurried steps (the root walks under them: the beat's close-in), the last
  // planted wide as the right hand is drawn, then the straight
  const wc = LW.cock;
  const walkKeys = [
    [0.1, S(fr('mlWalkA'))], [0.28, S(fr('mlWalkB'))], [0.46, S(fr('mlWalkA'))], [0.64, S(fr('mlWalkB'))], [0.76, S(fr('mlWalkA'))],
    [wc, S(fr('mlWalkCoil'))], [wc + (1 - wc) * 0.5, { ...mid(S(fr('mlWalkCoil')), S(fr('mlWalkHit'))), e: 'i' }],
    [1.0, { ...S(fr('mlWalkHit')), e: 'l' }], [1.6, { ...after(S(fr('mlWalkHit'))), e: 'o' }], [2.0, after(S(fr('mlWalkHit')))],
  ];

  return {
    // ================================================================ phase 1 on: THE SAINT'S HANDS
    /** Benediction: the lead palm; the advancing right palm with a step (the pack's B1); then the delayed
     *  quarter turn, HELD (a bait delay: his rhythm, ref-02 row 2, the pack's A11 / B2.1) and the abrupt left
     *  palm on a long lunge that throws the hero through what stands behind him (B2.2 - B2.3) (n, n, blue);
     *  the heel planted and the hands caught back into the guard in the recovery (B2.4 / ref-02 04). */
    benediction: {
      label: 'Benediction', phase: 1, weight: [2.2, 1.8, 1.2, 1.0], cooldown: 3.5, band: [0, 5], recovery: 0.8, cat: 'string',
      recoveryKeys: [[0.3, { ...S(fr('mlCatch')), e: 'o' }], [0.85, S({})]],
      beats: [
        palmL(N, BN.windup[0], BN.damage[0], BN.knockback[0]),
        // (the pack's B1: the advancing right palm, one step)
        follows(blow({
          tell: N, windup: BN.windup[1], damage: BN.damage[1], knockback: BN.knockback[1], zone: LINE(2.1, 0.9), part: 'fistR', cock: 0.74, travel: lunge(BN.step, 0.74),
          keys: keysOf({ coil: fr('mlB1Coil'), hit: fr('mlLunge'), fo: { ...fr('mlLunge'), rH: [0.08, 0.0, 0.5] }, cock: 0.74 }),
        })),
        // (the pack's B2 / A11, ref-02 row 2: the delayed quarter turn HELD, then the abrupt left palm)
        follows(blow({
          tell: B, flare: true, windup: BN.windup[2], hold: BN.hold, damage: BN.damage[2], knockback: BN.knockback[2], blockPush: BN.blockPush,
          zone: LINE(2.3, 0.9), part: 'fistL', cock: 0.8, travel: lunge(BN.lunge), fsCrash: BN.crash,
          keys: keysOf({ coil: fr('mlB2Turn'), hit: fr('mlB2Palm'), fo: fr('mlB2Follow'), cock: 0.8, held: true }),
        })),
      ],
    },
    /** Genuflect: a low sweep at the ankles (it scuffs the plates), then both open hands on the head and
     *  a rising knee (n, blue). */
    genuflect: {
      label: 'Genuflect', phase: 1, weight: [1.6, 1.4, 1.0, 0.9], cooldown: 4.5, band: [0, 4.5], recovery: 0.75, cat: 'string',
      beats: [
        blow({
          tell: N, windup: GN.windup[0], damage: GN.damage[0], knockback: GN.knockback[0], zone: { kind: 'sector', r: 2.2, ang: 1.0 }, part: 'footL', cock: 0.7, track: 0.7,
          groundMark: { kind: 'dash', arc: 1.1, fwd: 0.6 }, keys: keysOf({ coil: fr('mlSweepCoil'), hit: fr('mlSweep'), cock: 0.7 }),
        }),
        follows(blow({
          tell: B, flare: true, windup: GN.windup[1], damage: GN.damage[1], knockback: GN.knockback[1], zone: { kind: 'sector', r: 1.4, ang: 0.8, fwd: 0.4 }, part: 'kneeR', cock: 0.8,
          keys: keysOf({ coil: fr('mlKneeCoil'), hit: fr('mlKnee'), cock: 0.8, held: true }),
        })),
      ],
    },
    /** Laying On of Hands: the red grab. One open hand reaches for the throat (red: roll); caught, he
     *  lifts the hero (layHandsLift) and throws him through the nearest standing piece. Never the last HP.
     *  Missed, he stands open, the arm still out (the whole recovery). */
    layHands: {
      label: 'Laying On of Hands', phase: 1, weight: [1.0, 0.8, 0.6, 0.5], cooldown: 9, band: [0, 3.4], recovery: 1.0, recoverOpen: 1, cat: 'single',
      recoveryKeys: [[0.35, { ...S({ ...fr('mlReach'), rH: [0.1, 0.06, 0.5], bY: -0.22 }), e: 'o' }], [0.95, S({})]],
      beats: [blow({
        tell: R, windup: LH.windup, active: 0.12, damage: LH.catch, knockback: 0, zone: LINE(LH.reach, 0.9), part: 'fistR', close: LH.close, track: 0.85, cock: 0.8,
        fsBlow: 'grab', fsLay: 1, keys: keysOf({ coil: fr('mlReachCoil'), hit: fr('mlReach'), fo: { ...fr('mlReach'), rH: [0.1, 0.12, 0.52] }, cock: 0.8, held: true }),
      })],
    },
    /** (Laying On of Hands, caught: never picked; FsMelee starts it on the catch) the lift, one hand, the
     *  hero held up at arm's length, then the throw (the feint's impact: FsMelee._throw). */
    layHandsLift: {
      label: 'Laying On of Hands (the lift)', phase: 1, weight: [0, 0, 0, 0], hidden: true, cooldown: 0, band: [0, 99], recovery: 0.6,
      beats: [{
        feint: true, windup: LH.liftWindup, fixed: true, active: 0.1, cock: 0.9, close: 0, track: 0, fsBlow: 'lift', fsLift: 1,
        keys: [[0.0, S(fr('mlReach'))], [0.55, S(fr('mlLift'))], [0.9, S(fr('mlLift'))], [1.0, { ...S(fr('mlThrow')), e: 'i' }], [2.0, S(fr('mlThrow'))]],
      }],
    },
    /** The Long Walk: he walks at the hero, unhurried; light cuts land and do not stop him (a heavy cut
     *  does); then ONE straight palm (normal, held long) that carries on into the scenery behind the hero. */
    longWalk: {
      label: 'The Long Walk', phase: 1, weight: [1.0, 0.8, 0.7, 0.6], cooldown: 7, band: [3.4, 9.5], recovery: 0.8, cat: 'closer', gapCloser: true,
      beats: [blow({
        tell: N, windup: LW.windup, fixed: true, cock: wc, active: 0.1, damage: LW.damage, knockback: LW.knockback, blockPush: LW.blockPush,
        zone: LINE(2.1, 0.9), part: 'fistR', close: LW.close, track: 0.95, fsBlow: 'heavy', fsWalk: 1, fsCrash: LW.crash, keys: walkKeys,
      })],
    },
    /** Rebuke (his counter out of his guard, phase 1): a slip off the line and a short elbow (blue). */
    rebuke: {
      label: 'Rebuke', phase: 1, weight: [0, 0, 0, 0], counter: true, fsCounter: [1], cooldown: 0, band: [0, 5], recovery: 0.55,
      beats: [elbowR(B, RB.windup, RB.damage, RB.knockback, { flare: true, fsSlip: RB.slip })],
    },
    /** Litany (his phase-1 flurry, out of a streak of guards): quick alternating palms (normal). */
    litany: {
      label: 'Litany', phase: 1, weight: [0, 0, 0, 0], counter: true, streak: true, fsFlurry: [1, 2, 3, 4], cooldown: 0, band: [0, 6], recovery: 0.75,
      beats: litany,
    },

    // ================================================================ phase 2 on: THE PLATED ARM
    /** Interdict: the lead palm to stop the hero, then the plated arm comes down like a gavel onto the
     *  plates before him (n, red): a crater, a slam mark. */
    interdict: {
      label: 'Interdict', phase: 2, weight: [0, 1.5, 1.1, 1.0], cooldown: 6, band: [0, 5], recovery: 0.9, cat: 'string',
      beats: [
        palmL(N, IN.windup[0], IN.damage[0], IN.knockback[0]),
        follows(gavel(IN.windup[1], IN.damage[1], IN.knockback[1]), { close: 3.0 }),
      ],
    },
    /** Cast Out: both palms drawn to the ribs (held), then thrust together through whatever stands between
     *  them and the hero, who goes 8 m through the scenery (blue). */
    castOut: {
      label: 'Cast Out', phase: 2, weight: [0, 0.8, 0.7, 0.55], cooldown: 7, band: [0, 5.2], recovery: 0.8, cat: 'single',
      beats: [doublePalm(CO.windup, CO.damage, CO.knockback)],
    },
    /** Penance (his counter, phase 2): sunk, the plated hand-heel driven up under the chin (blue). */
    penance: {
      label: 'Penance', phase: 2, weight: [0, 0, 0, 0], counter: true, fsCounter: [2], cooldown: 0, band: [0, 5], recovery: 0.55,
      beats: [blow({
        tell: B, flare: true, windup: PE.windup, damage: PE.damage, knockback: PE.knockback, zone: { kind: 'sector', r: 1.7, ang: 0.6 }, part: 'fistR', cock: 0.78,
        keys: keysOf({ coil: fr('mlUpCoil'), hit: fr('mlUp'), cock: 0.78, held: true }),
      })],
    },

    // ================================================================ phase 3 on
    /** Lauds: a low kick at the knee (it scuffs the plates), then the overhand hand-heel down on the
     *  collarbone (n, blue). */
    lauds: {
      label: 'Lauds', phase: 3, weight: [0, 0, 1.3, 1.1], cooldown: 5.5, band: [0, 4.6], recovery: 0.75, cat: 'string',
      beats: [
        blow({
          tell: N, windup: LD.windup[0], damage: LD.damage[0], knockback: LD.knockback[0], zone: { kind: 'sector', r: 2.0, ang: 0.7, fwd: 0.2 }, part: 'footR', cock: 0.7,
          groundMark: { kind: 'dash', arc: 0.8, fwd: 0.6 }, keys: keysOf({ coil: fr('mlLowKickCoil'), hit: fr('mlLowKick'), cock: 0.7 }),
        }),
        follows(blow({
          tell: B, flare: true, windup: LD.windup[1], damage: LD.damage[1], knockback: LD.knockback[1], zone: { kind: 'sector', r: 1.9, ang: 0.6 }, part: 'fistR', cock: 0.8,
          keys: keysOf({ coil: fr('mlOverCoil'), hit: fr('mlOver'), cock: 0.8, held: true }),
        })),
      ],
    },
    /** Anathema (his counter, phase 3): the short elbow, then the double palm through the scenery (n, blue). */
    anathema: {
      label: 'Anathema', phase: 3, weight: [0, 0, 0, 0], counter: true, fsCounter: [3], cooldown: 0, band: [0, 5], recovery: 0.6,
      beats: [elbowR(N, AN.windup[0], AN.damage[0], AN.knockback[0]), follows(doublePalm(AN.windup[1], AN.damage[1], AN.knockback[1], { fsCrash: AN.crash }))],
    },

    // ================================================================ phase 4
    /** Requiem (his counter, phase 4): the short elbow, then the gavel (n, red). */
    requiem: {
      label: 'Requiem', phase: 4, weight: [0, 0, 0, 0], counter: true, fsCounter: [4], cooldown: 0, band: [0, 5], recovery: 0.7,
      beats: [elbowR(N, RQ.windup[0], RQ.damage[0], RQ.knockback[0]), follows(gavel(RQ.windup[1], RQ.damage[1], RQ.knockback[1]), { close: 3.0 })],
    },
  };
}

/** His combo links: ../links.js (the whole table's, by id). */
export const LINKS = {};

// ================================================================== THE HANDLER
const DOWN = new Set(['knockdown', 'dead']);

/**
 * FsMelee: the melee beats' own behaviour (the routing contract, saint.js header; every hook optional).
 * THE SURFACE others may read:
 *   stats { blows, landed, blocked, world, struck, caught, throws, thrownThrough, shrugs, walkStops,
 *           carries, carried, quakes, shoves }
 *   grip   null, or the hero held { t, a, tyaw, thrown } (Laying On of Hands, from the catch to the throw)
 *   lastThrow { x, z, kb, target: piece | null, result }   (the last throw: tests, the Lab)
 */
export class FsMelee {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this.T = d.T?.melee ?? TM;
    this._o = { kind: 'blunt', by: 'boss', dx: NaN, dz: NaN, y: 1, src: -1, scar: false, falloff: 0 };
    this._v = new THREE.Vector3();
    this._near = [];
    this.grip = null;
    this.carry = null;
    this.flung = null;
    this.reset();
  }

  reset() {
    this._release();
    this.carry = null;
    this.flung = null;
    this.lastThrow = null;
    this.stats = { blows: 0, landed: 0, blocked: 0, world: 0, struck: 0, caught: 0, throws: 0, thrownThrough: 0, shrugs: 0, walkStops: 0, carries: 0, carried: 0, quakes: 0, shoves: 0 };
  }

  /** A reaction, a break, his death: whatever he holds is let go. */
  stop() {
    this._release();
    this.carry = null;
  }

  /** The hero let go (back on the floor). */
  _release() {
    const p = this.game?.player?.position;
    if (this.grip && p && p.y > 0) p.y = 0;
    this.grip = null;
  }

  // ---------------------------------------------------------------- every frame
  frame(dt) {
    try {
      this._frame(fin(dt));
    } catch (err) {
      console.error('[saint] melee frame', err);
    }
  }
  _frame(dt) {
    const d = this.d, a = d.brain?.act;
    // the Long Walk's straight that met nobody: it carries on into whatever stands on its line
    const C = this.carry;
    if (C) {
      if (d.mode === 'dying' || d.mode === 'dead' || d.mode === 'react' || d.mode === 'broken') this.carry = null;
      else if (a !== C.a || C.b.done) {
        this.carry = null;
        this._carryOn(C);
      }
    }
    if (this.grip) this._gripFrame(dt);
    if (this.flung) this._flungFrame(dt);
    // (v04: no beat of his has driven the hands for a follow-through's length: back to the guard's half-curl)
    // (held through the follow-through's own clock past the beat's end: realise.js FOLLOW_MAX 0.24 s)
    this._handOff = this._handLive ? 0 : fin(this._handOff) + dt;
    if (this._handOwn && this._handOff > 0.24) {
      this._handOwn = false;
      // (only the shapes this handler set: another's beat may have taken the hands since)
      if (d.fsHandBy === this) d.fsHandR = d.fsHandL = d.fsHandBy = undefined;
    }
    this._handLive = false;
  }

  // ---------------------------------------------------------------- Laying On of Hands
  /** Caught (the reach landed): the hero held, the lift started. False when he cannot be held. */
  _catch() {
    const d = this.d, p = this.game.player, LH = this.T.layHands;
    if (!p?.position || !p.alive || DOWN.has(p.state) || this.grip) return false;
    const ok = p.hold?.(Math.min(fin(HERO_TUNE.holdMax, 1.2), LH.hold)) ?? false;
    if (!ok) return false;
    this.stats.caught++;
    const q = this._aim(p.position.x, p.position.z);
    this.grip = { t: 0, a: null, tyaw: q ? Math.atan2(q.x - d.position.x, q.z - d.position.z) : NaN, thrown: false };
    if (!d.brain?.startAct?.('layHandsLift')) {
      this._release();
      return false;
    }
    this.grip.a = d.brain.act;
    d.game.shake?.(0.25);
    return true;
  }

  /** The standing piece to throw the hero at: the nearest within `seek` m of him that is not back through
   *  the saint (whole pieces and raised ones left out: the crash only meets what stands on the floor); one
   *  the throw breaks counts `tough` m nearer than one it cannot. */
  _aim(px, pz) {
    const W = this.game.world?.destructibles, LH = this.T.layHands, d = this.d;
    const n = W?.around?.(px, pz, LH.seek, this._near, 64) ?? 0;
    const ox = px - d.position.x, oz = pz - d.position.z, ol = Math.hypot(ox, oz) || 1;
    let best = null, bs = Infinity;
    for (let i = 0; i < n; i++) {
      const q = this._near[i];
      if (!q || !(q.hpMax < Infinity) || fin(q.y0) > 1.4) continue;
      const dx = q.x - px, dz = q.z - pz, dist = Math.hypot(dx, dz);
      if (dist < 0.8) continue;
      const cos = (dx * ox + dz * oz) / (dist * ol);
      if (cos < -0.2) continue;
      // (a piece the throw will break goes first: the hero goes THROUGH it; one it cannot, he is slammed against)
      const sc = dist - cos * 1.5 + (fin(q.hp, q.hpMax) > LH.crash * fin(q.M?.take?.blunt, 1) ? LH.tough : 0);
      if (sc < bs) {
        bs = sc;
        best = q;
      }
    }
    this._near.length = 0;
    return best;
  }

  /** The hero held up at arm's length before him through the lift; the throw at its impact. */
  _gripFrame(dt) {
    const G = this.grip, d = this.d, p = this.game.player, pos = p?.position, a = d.brain?.act;
    if (!pos || !p.alive || d.mode !== 'act' || !a || (G.a && a !== G.a)) {
      this._release();
      return;
    }
    const b = a.beats[0];
    if (!b?.def?.fsLift) {
      this._release();
      return;
    }
    G.t += dt;
    if (G.thrown) return;
    // (track 0 on the lift: the brain leaves his yaw to this) he turns the hero toward the throw
    if (Number.isFinite(G.tyaw)) d.yaw = turnToward(d.yaw, G.tyaw, 4.5 * dt);
    const u = clamp((a.t - b.start) / Math.max(0.05, b.impact - b.start), 0, 1);
    const k = u < 0.55 ? (u / 0.55) * (u / 0.55) * (3 - 2 * (u / 0.55)) : 1;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), r = 0.95;
    pos.x = d.position.x + fx * r;
    pos.z = d.position.z + fz * r;
    pos.y = this.T.layHands.lift * k;
    p.yaw = Math.atan2(-fx, -fz);
    if (p.kb) p.kb.x = p.kb.z = 0;
    if (a.t >= b.impact) this._throw(b);
  }

  /** The throw: at the nearest standing piece (its distance + `over`), knocked down, through the world. */
  _throw(b) {
    const G = this.grip, d = this.d, p = this.game.player, pos = p.position, LH = this.T.layHands;
    G.thrown = true;
    pos.y = 0;
    const q = this._aim(pos.x, pos.z);
    let dx = Math.sin(d.yaw), dz = Math.cos(d.yaw), dist = LH.kbMin;
    if (q) {
      dx = q.x - pos.x;
      dz = q.z - pos.z;
      dist = Math.hypot(dx, dz);
      const l = dist || 1;
      dx /= l;
      dz /= l;
    }
    const kb = clamp(dist + LH.over, LH.kbMin, LH.kbMax);
    const scale = fin(d.T?.damageScale, 1) || 1;
    // (never the last HP: the throw leaves at least 1, the crash's own damage never takes the last either)
    const dmg = Math.max(0, Math.min(LH.throwDamage, (fin(p.hp, 1) - 1.5) / scale));
    this.stats.throws++;
    const r = d.hitPlayer({
      damage: dmg, knockback: kb, knockdown: true, kind: 'crush', tell: RULE_TELL.RED, attack: 'layHands', from: { x: pos.x - dx * 2, z: pos.z - dz * 2 },
      parryable: false, blockable: false, beat: b, extra: { wjCrash: LH.crash, wjCrashDamage: this.T.crash.damage, perfect: false },
    });
    this.lastThrow = { x: pos.x, z: pos.z, kb, target: q, result: r, slammed: false };
    if (r === RESULT.HIT && q) this.flung = { q, t: 0, T: this.lastThrow };
    // the get-up comes so the hero's whole loss of control is at most `cap` s
    if (p.state === 'knockdown') {
      const dur = fin(HERO_TUNE.knockdownDur, 1.3), left = Math.max(0.5, LH.cap - G.t);
      p.stateT = Math.max(fin(p.stateT), dur - left);
    }
    this.game.shake?.(0.45);
    this.grip = null;
  }

  /** The thrown hero reaches the piece he was thrown at (or his slide dies against it): it takes the slam
   *  (`slam` power at his height, BLUNT), whatever the crash's own step met on the way (a conveyor's wide
   *  bed in front of the frame on it). */
  _flungFrame(dt) {
    const F = this.flung, p = this.game.player, pos = p?.position, LH = this.T.layHands;
    F.t += dt;
    if (!pos || !p.alive || F.t > 1.4) {
      this.flung = null;
      return;
    }
    const q = F.q, gap = Math.hypot(q.x - pos.x, q.z - pos.z) - fin(q.r, 0.5) - fin(p.radius, 0.45);
    const sp = Math.hypot(fin(p.kb?.x), fin(p.kb?.z));
    if (gap > 0.35 && sp > 1.5) return;
    this.flung = null;
    if (gap > 2.2) return; // (his slide died short of it: nothing met)
    const W = this.game.world, DS = W?.destructibles;
    const o = this._o;
    o.kind = 'blunt';
    const l = Math.hypot(q.x - pos.x, q.z - pos.z) || 1;
    o.dx = (q.x - pos.x) / l;
    o.dz = (q.z - pos.z) / l;
    o.y = 0.9;
    o.falloff = 0;
    o.scar = true;
    o.src = DS?.swing?.() ?? -1;
    const n = DS?.strike?.(q.x, q.z, Math.max(0.5, fin(q.r, 0.5)), LH.slam, o) ?? 0;
    W?.impact?.(pos.x + o.dx * 0.4, pos.z + o.dz * 0.4, 1.0, LH.slam * 0.5, o);
    this.game.shake?.(0.4);
    F.T.slammed = n > 0;
    if (n > 0) this.stats.thrownThrough++;
  }

  // ---------------------------------------------------------------- his blows on the world
  /** The blow's own world blow at the striking limb's real height (every beat here is `noWorld`). */
  _world(b) {
    const d = this.d, W = this.game.world, DS = W?.destructibles, D = b.def, z = D.zone;
    if (!DS?.strike || !z || (d.position.y > 0.6 && !D.air)) return;
    d.tellPoint?.(D.part, this._v);
    const y = clamp(fin(this._v.y, 1), 0.15, 2.4);
    const WT = d.T?.world ?? DUEL_WORLD;
    const red = D.tell === RULE_TELL.RED || D.tell === RULE_TELL.BLACK;
    const power = (fin(D.damage, 12) / fin(WT.per, DUEL_WORLD.per)) * (red ? fin(WT.red, DUEL_WORLD.red) : 1) * fin(this.T.world?.k, 1);
    if (!(power > 0)) return;
    const heavy = z.kind === 'ring' || !!D.ring || !!D.knockdown || D.fsBlow === 'heavy' || red;
    const o = this._o;
    o.kind = heavy ? 'blunt' : 'cut';
    o.y = y;
    o.falloff = 0;
    o.scar = heavy;
    o.src = DS.swing?.() ?? -1;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), zf = z.fwd || 0, zs = z.side || 0;
    const x = d.position.x + fx * zf + fz * zs, zz = d.position.z + fz * zf - fx * zs;
    let n = 0;
    if (z.kind === 'ring') {
      o.dx = o.dz = NaN;
      n = W.impact?.(x, zz, z.r, power, o) ?? 0;
    } else if (z.kind === 'line') {
      o.dx = fx;
      o.dz = fz;
      n = DS.sweep(x + fx * 0.4, zz + fz * 0.4, x + fx * z.r, zz + fz * z.r, z.w / 2, power, o);
    } else {
      o.dx = fx;
      o.dz = fz;
      n = DS.strike(x + fx * z.r * 0.6, zz + fz * z.r * 0.6, z.r * 0.55, power, o);
    }
    this.stats.world++;
    this.stats.struck += fin(n);
  }

  /** The Long Walk's straight, not parried: a sweep on along its line, deep, at the palm's height. */
  _carryOn(C) {
    const W = this.game.world?.destructibles, LW = this.T.longWalk;
    this.stats.carries++;
    if (!W?.sweep) return;
    const fx = Math.sin(C.yaw), fz = Math.cos(C.yaw);
    const o = this._o;
    o.kind = 'blunt';
    o.dx = fx;
    o.dz = fz;
    o.y = C.y;
    o.falloff = 0;
    o.scar = true;
    o.src = W.swing?.() ?? -1;
    const ax = C.x + fx * 1.2, az = C.z + fz * 1.2;
    const n = W.sweep(ax, az, ax + fx * LW.carry, az + fz * LW.carry, LW.carryW, LW.power, o);
    this.stats.carried += fin(n);
    this.d.fx?.sparks?.(ax, C.y, az, fx, fz, 8, 1);
  }

  /** The gavel's crater before him. */
  _quake(b) {
    const d = this.d, W = this.game.world, IN = this.T.interdict;
    const fwd = fin(b.def.zone?.fwd, IN.fwd);
    const x = d.position.x + Math.sin(d.yaw) * fwd, z = d.position.z + Math.cos(d.yaw) * fwd;
    const o = this._o;
    o.kind = 'blast';
    o.dx = o.dz = NaN;
    o.y = 0.3;
    o.falloff = 0.45;
    o.scar = true;
    o.src = W?.destructibles?.swing?.() ?? -1;
    W?.impact?.(x, z, IN.crater.r, IN.crater.power, o);
    d.fx?.crater?.(x, z, IN.crater.r * 0.7, 1);
    d.game.shake?.(0.5);
    this.stats.quakes++;
  }

  /** The double palm's shove: what stands on the line ahead (cover between him and the hero) is broken. */
  _shove(b) {
    const d = this.d, W = this.game.world?.destructibles, SH = this.T.castOut.shove;
    if (!W?.sweep) return;
    d.tellPoint?.(b.def.part, this._v);
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), o = this._o;
    o.kind = 'blunt';
    o.dx = fx;
    o.dz = fz;
    o.y = clamp(fin(this._v.y, 1.1), 0.4, 2);
    o.falloff = 0;
    o.scar = false;
    o.src = W.swing?.() ?? -1;
    const ax = d.position.x + fx * 0.5, az = d.position.z + fz * 0.5;
    W.sweep(ax, az, ax + fx * SH.len, az + fz * SH.len, SH.w, SH.power, o);
    this.stats.shoves++;
  }

  // ---------------------------------------------------------------- the beat hooks
  /** Rebuke's slip (the pack's B3): the root carried `fsSlip` m to his left through the windup's draw. */
  beatMotion(b, u, s, dt) {
    const D = b?.def;
    // (v04, the pack's hand details: the striking palm REACHES (drawn open, flat) from the strike's middle to
    // the follow-through's end, both hands reach for the head through the knee's held coil and stay with
    // the lift's hold; every other frame of his blows the hands are in the guard's half-curl)
    const hd = this.d, hp = D?.part, hs = u >= (fin(D?.cock, 0.8) + 1) * 0.5 && u < 2, hk = hp === 'kneeR' && u >= 0.36 && u < 1.6;
    hd.fsHandR = D?.fsLift || hk || (hs && (hp === 'fistR' || hp === 'palms')) ? 'reach' : 'guard';
    hd.fsHandL = hk || (hs && (hp === 'fistL' || hp === 'palms')) ? 'reach' : 'guard';
    this._handLive = this._handOwn = true;
    hd.fsHandBy = this;
    if (!(D?.fsSlip > 0) || b.feint) return;
    const k = clamp((u - 0.08) / 0.55, 0, 1), want = D.fsSlip * k * k * (3 - 2 * k), step = want - fin(b._slip);
    // (v04, the pack's B3 / C2: the slip lands on the outside sole: its scuff and dust)
    if (k >= 1 && !b._fsPlant) {
      b._fsPlant = true;
      hd.fx?.footPlant?.(hd.position.x, hd.position.z, Math.cos(hd.yaw), -Math.sin(hd.yaw), 0.45, 0.8);
    }
    if (!(Math.abs(step) > 1e-5)) return;
    b._slip = want;
    const d = this.d;
    d.moveBy?.(Math.cos(d.yaw) * step, -Math.sin(d.yaw) * step);
    void s, dt;
  }

  onImpact(b, s, a) {
    try {
      this._onImpact(b, a);
    } catch (err) {
      console.error('[saint] melee onImpact', err);
    }
    void s;
  }
  _onImpact(b, a) {
    const D = b.def, d = this.d;
    if (D.fsLift) return;
    this.stats.blows++;
    this._world(b);
    if (D.fsQuake) this._quake(b);
    if (D.fsShove) this._shove(b);
    if (D.fsWalk) {
      d.tellPoint?.(D.part, this._v);
      this.carry = { b, a, yaw: d.yaw, x: d.position.x, z: d.position.z, y: clamp(fin(this._v.y, 1.2), 0.4, 2) };
    }
    // (v04, the pack's B1.2 / B2.4 / C2: a blow that steps in (a lunge's travel, the walk's last step) lands with
    // the front heel planted: its scuff)
    if (D.travel || D.fsWalk) d.fx?.footPlant?.(d.position.x + Math.sin(d.yaw) * 0.45, d.position.z + Math.cos(d.yaw) * 0.45, Math.sin(d.yaw), Math.cos(d.yaw), 0.35, 0.7);
  }

  /** Before his blow reaches the hero: the grab's catch is no throw; a crash blow goes through the world. */
  hitPlayer(o) {
    const D = o?.beat?.def;
    if (!D || D.fsLift) return o;
    const p = this.game.player;
    if (D.fsLay) {
      const scale = fin(this.d.T?.damageScale, 1) || 1;
      const dmg = Math.max(0, Math.min(fin(o.damage), (fin(p?.hp, 1) - 1.5) / scale));
      return { ...o, damage: dmg, knockback: 0, knockdown: false, extra: { ...(o.extra ?? null), wjCrash: 0 } };
    }
    if (D.fsCrash > 0) return { ...o, extra: { wjCrash: D.fsCrash, wjCrashDamage: this.T.crash.damage, ...(o.extra ?? null) } };
    return o;
  }

  /** After it: the catch, the walk's straight carried on, sparks off the plated arm. */
  onHit(o, r) {
    try {
      this._onHit(o, r);
    } catch (err) {
      console.error('[saint] melee onHit', err);
    }
  }
  _onHit(o, r) {
    const D = o?.beat?.def;
    if (!D || D.fsLift) return;
    if (r === RESULT.HIT) this.stats.landed++;
    else if (r === RESULT.BLOCKED) this.stats.blocked++;
    if (D.fsLay) {
      if (r === RESULT.HIT) this._catch();
      return;
    }
    if (D.fsWalk && this.carry && this.carry.b === o.beat) {
      const C = this.carry;
      this.carry = null;
      if (r !== RESULT.PARRIED && r !== RESULT.CLASHED) this._carryOn(C);
    }
    const d = this.d, p = this.game.player?.position;
    // (v04, the pack's C1: a palm that met the hero or his guard: a small white glint at the hand, contact sparks,
    // fading chips; physical, never cyan)
    const pp = D.part;
    if (p && (r === RESULT.HIT || r === RESULT.BLOCKED) && (pp === 'fistR' || pp === 'fistL' || pp === 'palms') && !D.fsLay) {
      d.handPoint?.(pp === 'fistL' ? 'L' : 'R', this._v);
      const hx = fin(this._v.x, d.position.x), hz = fin(this._v.z, d.position.z), nx = p.x - d.position.x, nz = p.z - d.position.z;
      d.fx?.palmHit?.(hx, clamp(fin(this._v.y, 1.2), 0.3, 2.2), hz, nx, nz, D.fsBlow === 'heavy' ? 1.2 : 0.8);
    }
    // (the plated arm, phase 2 on: steel sparks where a heavy blow met the hero or his guard)
    if (p && d.dressPhase >= 2 && D.fsBlow === 'heavy' && (r === RESULT.HIT || r === RESULT.BLOCKED)) {
      const nx = p.x - d.position.x, nz = p.z - d.position.z, l = Math.hypot(nx, nz) || 1;
      d.fx?.sparks?.(p.x - (nx / l) * 0.3, 1.2, p.z - (nz / l) * 0.3, nx / l, nz / l, r === RESULT.BLOCKED ? 10 : 6, 1);
    }
  }

  /** The Long Walk: a light cut lands and he walks on through it; a heavy one stops him (a stagger). */
  takeHit(o) {
    const d = this.d, a = d.brain?.act;
    if (d.mode !== 'act' || !a || d.broken || !(Number(o?.damage) > 0)) return undefined;
    const b = a.beats.find((x) => a.t < x.end + 1e-6);
    if (!b || b.feint || !b.def?.fsWalk || a.t >= b.impact - 0.02 || fin(o.reel, 0) > 0) return undefined;
    if (o.heavy) {
      this.stats.walkStops++;
      if (d.brain.startReact?.('stagger')) d.emit?.('dragon:stagger');
      return undefined;
    }
    this.stats.shrugs++;
    const P = d.T?.parts ?? {}, part = P[o.part] !== undefined ? o.part : 'body';
    return { ...o, exact: true, damage: Math.max(1, Math.round(Number(o.damage) * fin(P[part], 1))) };
  }

  /** The grab wants a hero on his feet (and a held guard draws it); a held guard draws the shove and the gavel. */
  weigh(name, def, w, dist) {
    void def, dist;
    const p = this.game.player;
    if (name === 'layHands') {
      if (!p?.position || DOWN.has(p.state) || p.position.y > 0.3 || this.grip) return 0;
      if (p.blocking) return w * 1.8;
    }
    if ((name === 'castOut' || name === 'interdict') && p?.blocking) return w * 1.6;
    return w;
  }
}

export const create = (d) => new FsMelee(d);
