import { TUNING_BOOST } from '../tuningBoost.js';
import { FsBoost } from '../boost.js';

// The False Saint's boosters (the BOOST AGENT's file; moves.js is the router: its header has the format,
// moves/melee.js the exports). The booster punch (Votive Fist), the plated arm's rapid flurry (Rosary),
// the jet strings (Censer Wheel, Thurible), the dive knee (Descent), the overclock passes (Vespers), the
// last grab (Last Rite), and his jet step (Censer Step: the handler's footwork hook, TUNING.boost.step).
// The behaviour is the handler's (../boost.js FsBoost); the numbers ../tuningBoost.js (TUNING.boost); the
// poses ../posesBoost.js (`bo` fragments laid over his guard here).
//
// THE BEAT FIELDS this file's handler owns (FIELDS; saint.js routes every beat carrying one to it; grepped
// against every boss's move data: none in use):
//   fsJet:   { part, from }   a booster lit through the windup from `from` (its jet in the fire field is the
//                             tell: fx.jet(part, k)); part 'elbowR' | 'elbowL' | 'back' | 'calfR' | 'calfL' |
//                             'palmR' | 'core'; `pulse: true` lights it at the impact instead (the flurry's
//                             stutter)
//   fsDash:  { carry }        the booster punch's blink-dash (the engine's `dash` moves him): every piece on
//                             its line is struck at fist height; `carry` true: a miss carries him on into
//                             the scenery (the move's last blow only). { rite: true }: the last grab
//   fsDive:  true             Descent: up on the back thrusters, the hang over the marked floor, the dive
//   fsBlitz: { set: i } | { pass: i } (+ last)   an overclock pass's set (a feint: he jets to its launch
//                             point, the line shows) and the pass through the hero (Vespers)
// MOVE FIELDS: fsFlurry [phases] (Rosary: his flurry from phase 2; moves.js), fsNoCount (saint.js FsBrain:
// the flurry is played as authored, its last blow blue, not cut to the streak's count).
// The engine's own beat fields (dash, lift, air, dive, ring, flare, groundMark ...) work as on every duelist.
export const FIELDS = Object.freeze(['fsJet', 'fsDash', 'fsDive', 'fsBlitz']);

const TB = TUNING_BOOST;
const TAU = Math.PI * 2;
const clampHead = (v) => Math.max(-1.1, Math.min(1.1, v));

export function moves(X) {
  const { FRAGS: FR, TELL } = X;
  const { N, B, R } = TELL;
  const STAND = FR.STAND;
  /** A whole pose: his guard (STAND), then the fragment; the head turned back onto the hero (as far as a
   *  neck goes) unless the fragment turns it itself. */
  const W = (p, extra = null) => {
    const q = extra ? { ...p, ...extra } : p;
    const out = { ...STAND, ...q };
    if (q.hdY === undefined) out.hdY = clampHead(STAND.hdY - ((q.yaw ?? STAND.yaw) - STAND.yaw) * 0.82 - (q.spY ?? 0) * 0.82);
    return out;
  };
  /** Between two whole poses at k (numbers and arrays; the rest from b). */
  const mid = (a, b, k) => {
    const o = {};
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[f] ?? b[f], y = b[f] ?? a[f];
      if (Array.isArray(x)) o[f] = x.map((v, i) => v + ((y[i] ?? v) - v) * k);
      else if (typeof x === 'number' && typeof y === 'number') o[f] = x + (y - x) * k;
      else o[f] = y;
    }
    return o;
  };
  const back = (frag) => [[0.6, W(frag)], [1.0, STAND]]; // a move's recovery: back into the guard
  // the end of a booster move that crossed the floor: the deep planted stop (the v04 pack, A12 / B4), then the guard
  const BRAKE = W(FR.boBrake);
  const braked = [[0.28, BRAKE], [0.62, BRAKE], [1.0, STAND]];

  // ---------------------------------------------------------------- the booster punch
  const V = TB.votive;
  const VO_COIL = W(FR.boVoCoil), VO_FIST = W(FR.boVoFist), VO_OVER = W(FR.boVoOver);
  /** The booster punch (blue, a parry moment): the coil and the elbow's jet held, the blink behind the fist. */
  const votive = (o = {}) => ({
    tell: B, windup: V.windup, cock: V.cock, active: 0.1, damage: V.damage, knockback: V.knockback, blockPush: V.blockPush, flare: true,
    zone: { kind: 'line', r: 2.3, w: V.w }, part: 'fistR', close: 0, track: 0.9,
    dash: { from: V.dashFrom, to: 1.0, max: V.reach, stop: V.stop },
    fsJet: { part: 'elbowR', from: V.jetFrom }, fsDash: { carry: false },
    keys: [
      [V.cock * 0.5, mid(STAND, VO_COIL, 0.6)],
      [V.cock, VO_COIL],
      [V.dashFrom, { ...VO_COIL, yaw: VO_COIL.yaw - 0.06, bY: VO_COIL.bY - 0.03 }],
      [1.0, { ...VO_FIST, e: 'i' }],
      [1.6, { ...VO_OVER, e: 'o' }],
      [2.0, VO_OVER],
    ],
    ...o,
  });

  // ---------------------------------------------------------------- the rapid flurry
  const RS = TB.rosary;
  const RO_COIL = W(FR.boRoCoil), RO_HIT = [W(FR.boRoHigh), W(FR.boRoMid), W(FR.boRoLow)];
  const RO_WIND = W(FR.boRoWind), RO_LAST = W(FR.boRoLast);
  const piston = (i, windup) => {
    const hit = RO_HIT[i % 3];
    return {
      tell: N, windup, fixed: true, cock: 0.55, active: RS.active, damage: RS.damage, knockback: RS.knockback, guardCost: RS.guardCost,
      zone: { kind: 'sector', r: RS.reach, ang: 0.6 }, part: 'fistR', close: RS.close, track: 0.7,
      fsJet: { part: 'elbowR', pulse: true },
      keys: [[0.55, RO_COIL], [1.0, { ...hit, e: 'i' }], [1.6, { ...mid(hit, RO_COIL, 0.3), e: 'o' }], [2.0, mid(hit, RO_COIL, 0.45)]],
    };
  };
  const rosaryBeats = [{ ...piston(0, RS.first), keys: [[0.3, mid(STAND, RO_COIL, 0.5)], [0.55, RO_COIL], [1.0, { ...RO_HIT[0], e: 'i' }], [1.6, { ...mid(RO_HIT[0], RO_COIL, 0.3), e: 'o' }], [2.0, mid(RO_HIT[0], RO_COIL, 0.45)]] }];
  for (let i = 1; i <= RS.middle; i++) {
    const b = piston(i, RS.beat[(i - 1) % RS.beat.length]);
    if (RS.chance.includes(i)) b.chance = RS.p;
    rosaryBeats.push(b);
  }
  rosaryBeats.push({
    tell: B, windup: RS.last, fixed: true, cock: 0.62, active: 0.1, damage: RS.lastDamage, knockback: RS.lastKnockback, flare: true, blockPush: 3.6, guardCost: RS.lastGuardCost,
    zone: { kind: 'line', r: 2.2, w: 0.9 }, part: 'fistR', close: 1.6, track: 0.75,
    fsJet: { part: 'elbowR', from: 0.15 },
    keys: [[0.62, RO_WIND], [1.0, { ...RO_LAST, e: 'i' }], [1.6, { ...RO_LAST, e: 'o' }], [2.0, RO_LAST]],
  });

  // ---------------------------------------------------------------- the dive
  const DS = TB.descent;
  const LIFT = W(FR.boLift), HANG = W(FR.boHang), DIVE = W(FR.boDive), LAND = W(FR.boLand);
  const CROUCH = W({ ...FR.boLift, bY: -0.36, pitch: 0.18, rK: [-0.4, 0, 0.9], lK: [0.4, 0, 0.9], flat: 1 });

  // ---------------------------------------------------------------- the jet strings
  const ST = TB.strings;
  const EL_COIL = W(FR.boElCoil), EL_HIT = W(FR.boElHit);
  const KI_COIL = W(FR.boKiCoil), KI_HIT = W(FR.boKiHit);
  /** The jet-spun back elbow (normal): wound, the elbow's jet spins him, the elbow driven back into the hero,
   *  the spin carried on round to his guard (a whole turn: the last key steps back by TAU, unseen). */
  const elbowBack = (windup) => ({
    tell: N, windup, cock: 0.66, active: 0.1, damage: ST.elbowDamage, knockback: ST.elbowKnockback,
    zone: { kind: 'sector', r: ST.elbowReach, ang: 0.9 }, part: 'elbowR', close: 1.4, track: 0.8,
    fsJet: { part: 'elbowR', from: 0.4 },
    keys: [
      [0.66, EL_COIL],
      [0.86, { ...mid(EL_COIL, EL_HIT, 0.45), yaw: -0.9, e: 'i' }],
      [1.0, { ...EL_HIT, e: 'l' }],
      [1.55, { ...EL_HIT, yaw: -3.9, hdY: 1.1, e: 'o' }],
      [2.0, { ...STAND, yaw: STAND.yaw - TAU }],
      [2.001, { ...STAND, e: 'h' }],
    ],
  });
  /** The rising jet kick (blue): chambered low, up off the floor on the calf jets, the leg straight up. */
  const riseKick = (windup, lift) => ({
    tell: B, windup, cock: 0.62, active: 0.1, damage: ST.kickDamage, knockback: ST.kickKnockback, flare: true,
    zone: { kind: 'sector', r: ST.kickReach, ang: 0.62 }, part: 'footR', close: 1.2, track: 0.75, air: true, lift,
    fsJet: { part: 'calfR', from: 0.55 },
    keys: [[0.62, KI_COIL], [0.84, { ...mid(KI_COIL, KI_HIT, 0.5), e: 'i' }], [1.0, { ...KI_HIT, e: 'l' }], [1.6, { ...KI_HIT, e: 'o' }], [2.0, mid(KI_HIT, STAND, 0.4)]],
  });

  // ---------------------------------------------------------------- the overclock
  const VS = TB.vespers;
  const VE_SET = W(FR.boVeSet), VE_PASS = W(FR.boVePass), VE_DIVE = W(FR.boVeDive);
  const vespers = [];
  for (let i = 0; i <= VS.passes; i++) {
    const last = i === VS.passes;
    vespers.push({
      feint: true, windup: last ? VS.lastSet : VS.set, fixed: true, cock: 0.6, active: 0.05, close: 0, track: 0,
      fsBlitz: { set: i, last },
      keys: last ? [[0.6, HANG], [2.0, HANG]] : [[0.6, VE_SET], [2.0, VE_SET]],
    });
    vespers.push(last
      ? {
        tell: R, windup: VS.lastWindup, fixed: true, cock: 0.7, active: 0.12, damage: VS.lastDamage, knockback: VS.lastKnockback, knockdown: true,
        zone: { kind: 'ring', r: VS.lastR }, ring: VS.lastR, part: 'kneeR', close: 0, track: 0, air: true, dive: true,
        groundMark: { kind: 'blast', r: 2.2, power: 2.6 }, fsBlitz: { pass: i, last },
        keys: [[0.7, HANG], [0.85, { ...VE_DIVE, e: 'i' }], [1.0, { ...LAND, e: 'i' }], [2.0, LAND]],
      }
      : {
        tell: B, windup: VS.windup, fixed: true, cock: 0.7, active: VS.active, damage: VS.damage, knockback: VS.knockback,
        zone: { kind: 'ring', r: VS.r }, part: 'fistR', close: 0, track: 0, air: true, groundMark: false,
        fsBlitz: { pass: i, last },
        keys: [[0.7, VE_SET], [0.82, { ...VE_PASS, e: 'o' }], [1.3, VE_PASS], [2.0, { ...BRAKE, e: 'o' }]],
      });
  }

  // ---------------------------------------------------------------- the last grab
  const RT = TB.rite;
  const RI_WHINE = W(FR.boRiWhine), RI_HUG = W(FR.boRiHug);

  return {
    /** Votive Fist, THE BOOSTER PUNCH (P2+): the elbow's jet lights (the tell, held), then up to 10 m in a
     *  blink behind the fist; a miss carries on into what stands behind the hero; parried, he skids past
     *  the hero, open, a big posture hit. */
    votiveFist: {
      label: 'Votive Fist', phase: 2, weight: V.weight, cooldown: V.cooldown, band: V.band, recovery: V.recovery, cat: 'closer', gapCloser: true,
      beats: [votive({ fsDash: { carry: true } })],
      recoveryKeys: braked,
    },
    /** Rosary (his flurry from P2, out of a streak of guards): the plated arm's pistons in a stutter of
     *  threes (short, short, long), 7 - 10 blows, the last a blue parry moment. */
    rosary: {
      label: 'Rosary', phase: 2, weight: [0, 0, 0, 0], counter: true, streak: true, fsFlurry: [2, 3, 4], fsNoCount: true, cooldown: 0, band: [0, 6], recovery: RS.recovery,
      beats: rosaryBeats,
      recoveryKeys: back(FR.boRoLast),
    },
    /** Descent (P3+, red): up on the back thrusters, the hang over the marked floor, the dive knee: a
     *  crater, the plates thrown, a shock. */
    descent: {
      label: 'Descent', phase: 3, weight: DS.weight, cooldown: DS.cooldown, band: DS.band, recovery: DS.recovery, cat: 'closer', gapCloser: true,
      beats: [{
        tell: R, windup: DS.windup, fixed: true, cock: DS.cock, active: 0.12, damage: DS.damage, knockback: DS.knockback, knockdown: true,
        zone: { kind: 'ring', r: DS.r }, ring: DS.r, part: 'kneeR', close: 0, track: 0, air: true, dive: true,
        groundMark: { kind: 'blast', r: 2.4, power: 3.0 }, fsDive: true, fsJet: { part: 'back', from: 0.04 },
        keys: [[0.1, CROUCH], [DS.rise, LIFT], [DS.rise + 0.14, HANG], [DS.fall, HANG], [0.93, { ...DIVE, e: 'i' }], [1.0, { ...LAND, e: 'i' }], [2.0, LAND]],
      }],
      recoveryKeys: [[0.55, LAND], [1.0, STAND]],
    },
    /** Censer Wheel (P3+): the booster punch, a jet-spun back elbow, a rising jet kick (blue, n, blue). */
    censerWheel: {
      label: 'Censer Wheel', phase: 3, weight: ST.wheel.weight, cooldown: ST.wheel.cooldown, band: ST.wheel.band, recovery: ST.wheel.recovery, cat: 'string', gapCloser: true,
      beats: [
        votive({ flare: false, keys: votive().keys.slice(0, 4).concat([[1.6, { ...VO_FIST, e: 'o' }], [2.0, mid(VO_FIST, EL_COIL, 0.4)]]) }),
        elbowBack(ST.elbow),
        riseKick(ST.kick, [[0.55, 0], [1.0, ST.kickLift], [1.6, ST.kickLift + 0.08], [2.0, 0]]),
      ],
      recoveryKeys: back(FR.boKiHit),
    },
    /** Thurible (P3+, close): the jet-spun back elbow, the rising jet kick, and the booster punch out of
     *  the air (n, blue, blue). */
    thurible: {
      label: 'Thurible', phase: 3, weight: ST.thurible.weight, cooldown: ST.thurible.cooldown, band: ST.thurible.band, recovery: ST.thurible.recovery, cat: 'string',
      beats: [
        elbowBack(ST.elbowFirst),
        { ...riseKick(ST.kick, [[0.55, 0], [1.0, ST.kickLift], [2.0, ST.kickLift + 0.1]]), flare: false },
        votive({
          windup: ST.airPunch, lift: [[0, ST.kickLift + 0.1], [V.dashFrom, ST.kickLift + 0.1], [1.0, 0.15], [1.6, 0]], air: true,
          dash: { from: V.dashFrom, to: 1.0, max: ST.airReach, stop: V.stop }, fsDash: { carry: true },
          keys: [[0.4, mid(KI_HIT, VO_COIL, 0.6)], [V.cock, VO_COIL], [V.dashFrom, VO_COIL], [1.0, { ...VO_FIST, e: 'i' }], [1.6, { ...VO_OVER, e: 'o' }], [2.0, VO_OVER]],
        }),
      ],
      recoveryKeys: braked,
    },
    /** Vespers, OVERCLOCK (P4): four jet-streak passes through the hero from four sides (blue), each
     *  announced (he jets to its launch point and the line shows), afterimages on each line, the last from
     *  above (red). */
    vespers: {
      label: 'Vespers', phase: 4, weight: VS.weight, cooldown: VS.cooldown, band: VS.band, recovery: VS.recovery, cat: 'closer', gapCloser: true,
      beats: vespers,
      recoveryKeys: [[0.5, LAND], [1.0, STAND]],
    },
    /** Last Rite (P4, once, under 8 %): he stops, the core whines, he lunges to embrace (red). Dodged: he
     *  stands wide open (his posture breaks). Caught: a heavy blast, never the hero's last HP. */
    lastRite: {
      label: 'Last Rite', phase: 4, weight: RT.weight, cooldown: 99, band: [0, 9], recovery: 0.7, cat: 'single',
      beats: [{
        tell: R, windup: RT.windup, fixed: true, cock: RT.cock, active: 0.12, damage: RT.damage, knockback: RT.knockback, knockdown: true,
        zone: { kind: 'sector', r: 1.8, ang: 0.8 }, part: 'palms', close: 0, track: 0.88,
        dash: { from: RT.dashFrom, to: 1.0, max: RT.reach, stop: RT.stop },
        fsDash: { rite: true }, fsJet: { part: 'core', from: 0.05 },
        keys: [[0.25, RI_WHINE], [RT.cock, { ...RI_WHINE, spX: -0.18, hdX: -0.24 }], [1.0, { ...RI_HUG, e: 'i' }], [2.0, RI_HUG]],
      }],
      recoveryKeys: back(FR.boRiHug),
    },
  };
}

// ---------------------------------------------------------------- his combo links (links.js format)
// (the jet strings out of each other and into the punch; the melee agent links his ground strings to
// these ids)
const L = (to, when, chance) => ({ to, when, chance });
export const LINKS = {
  votiveFist: [L('thurible', 'near', [0, 0, 0.3, 0.3])],
  censerWheel: [L('votiveFist', 'far', [0, 0, 0.35, 0.4])],
  thurible: [L('descent', 'far', [0, 0, 0.25, 0.3])],
  descent: [L('thurible', 'near', [0, 0, 0.3, 0.35])],
};

export const create = (d) => new FsBoost(d);
