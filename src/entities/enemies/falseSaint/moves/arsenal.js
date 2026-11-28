import { FsArsenal } from '../arsenal.js';
import { TUNING_ARSENAL } from '../tuningArsenal.js';

// The False Saint's arsenal as move data (the ARSENAL AGENT's file; moves.js is the router: its header has
// the format, moves/melee.js the exports). The handler is ../arsenal.js (FsArsenal: its header has the hooks
// with their arguments and what each move does). Numbers: ../tuningArsenal.js (TUNING.arsenal). Poses:
// ../posesArsenal.js (`ar` fragments laid over his guard here).
//   Vigil (the eye's cutting laser), Absolution (the palm cannon), Triptych (the forearm gun's bolts),
//   Choir (the missile swarm), Passing Bell (the strafing pass and its laser), Kyrie (the creeping
//   barrage), Verdict (the sky lance), Revelation (the full burst).
//
// THE BEAT FIELDS this file's handler owns (FIELDS; saint.js routes every beat carrying one to it; grepped
// against every boss's move data: none in use):
//   fsLaser:   { kind: 'vigil' | 'bell' }        the eye laser (a sight line, then the cut); `selfHit`, `sustain`
//   fsCannon:  { kind: 'palm' | 'twin' | 'core' } a held beam (the palm, both palms, the chest core); `selfHit`, `sustain`
//   fsBolt:    { i }                            a bolt of the forearm gun (it arrives AT the beat's impact); `selfHit`
//   fsMissile: true                             the swarm's launch (a `cast` with `selfCue`: each missile its own cue)
//   fsMortar:  { first: true } | { great: true } the barrage's first salvo (the rows follow) / the great shell (`cast`)
//   fsLance:   true                             the reticle's lock (a `cast`; the pillar falls `verdict.fall` s later)
// A beam or a laser is a `selfHit` beat: the brain cues it (its glint / flare flashLead before the impact),
// holds it for the fairness guard and ledgers its lit window as one interval; the handler deals its one hit
// and bites the world. Its `zone` is the data rule's and never tested (a hand's breadth: the brain's reach
// for it is the handler's, Infinity). What lands away from him (missiles, shells, the pillar) is a `cast`
// with `selfCue`: the handler gives each its own ledger handle and its red flash on its mark.
export const FIELDS = Object.freeze(['fsLaser', 'fsCannon', 'fsBolt', 'fsMissile', 'fsMortar', 'fsLance']);
export const create = (d) => new FsArsenal(d);

const TA = TUNING_ARSENAL;
const clampHead = (v) => Math.max(-1.1, Math.min(1.1, v));
/** The zone a selfHit shot carries for the data rules (never tested: the handler deals the hit). */
const AIM = Object.freeze({ kind: 'sector', r: 0.3, ang: 0.2 });

export function moves(X) {
  const { FRAGS: FR, TELL } = X;
  const { B, R } = TELL;
  const STAND = FR.STAND;
  /** A whole pose: his guard, then the fragment; the head turned back onto the hero unless it turns it. */
  const W = (p) => {
    const out = { ...STAND, ...p };
    if (p.hdY === undefined) out.hdY = clampHead(STAND.hdY - ((p.yaw ?? STAND.yaw) - STAND.yaw) * 0.82 - (p.spY ?? 0) * 0.82);
    return out;
  };
  const back = (frag) => [[0.55, W(frag)], [1.0, STAND]];
  /** Held keys over a beat (u 0..2): toward `a` by the cock, held, `b` at the impact, held through the lit
   *  window (a beam's pose does not move: the brace). */
  const held = (a, b, cock) => [[cock * 0.55, a], [cock, a], [1.0, { ...b, e: 'i' }], [2.0, b]];

  // ---------------------------------------------------------------- the eye laser
  const V = TA.vigil;
  const EYE = W(FR.arEye), EYE_CUT = W(FR.arEyeCut);
  // ---------------------------------------------------------------- the palm cannon
  const AB = TA.absolution;
  const PALM_DRAW = W(FR.arPalmDraw), PALM_AIM = W(FR.arPalmAim);
  // ---------------------------------------------------------------- the gun
  const TR = TA.triptych;
  const GUN = W(FR.arGun), KICK = W(FR.arGunKick);
  const bolt = (i, windup) => ({
    tell: B, windup, cock: TR.cock, active: 0.06, damage: TR.damage, knockback: TR.knockback,
    zone: AIM, part: 'fistR', close: 0, track: 0.95, selfHit: true, fsBolt: { i },
    keys: i === 0
      ? [[0.4, W({ ...FR.arGun, rH: [0.1, -0.08, 0.3] })], [TR.cock, GUN], [1.0, { ...GUN, e: 'i' }], [1.25, { ...KICK, e: 'o' }], [2.0, GUN]]
      : [[0.3, GUN], [TR.cock, GUN], [1.0, { ...GUN, e: 'i' }], [1.25, { ...KICK, e: 'o' }], [2.0, GUN]],
  });
  // ---------------------------------------------------------------- the swarm
  const CH = TA.choir;
  const CHOIR = W(FR.arChoir), CHOIR_FIRE = W(FR.arChoirFire);
  // ---------------------------------------------------------------- the pass
  const PB = TA.passingBell;
  const HANG = W(FR.arBellHang), PASS = W(FR.arBellPass), LAND = W(FR.arBellLand);
  // ---------------------------------------------------------------- the barrage
  const KY = TA.kyrie;
  const MORTAR = W(FR.arMortar), MORTAR_FIRE = W(FR.arMortarFire);
  const greatWindup = (KY.rows - 1) * KY.rowGap + KY.great.windup;
  // ---------------------------------------------------------------- the lance
  const VD = TA.verdict;
  const UP = W(FR.arLanceUp), DOWN = W(FR.arLanceDown);
  // ---------------------------------------------------------------- the full burst
  const RV = TA.revelation;
  const DRAW = W(FR.arBurstDraw), TWIN = W(FR.arBurstTwin), CORE = W(FR.arBurstCore);

  return {
    /** Vigil (P2+, red): the eye's cutting laser. The sight line across the hero's spot, held; the laser's
     *  foot drawn along it at the cue, crossing his spot at the impact: a roll through it. */
    vigil: {
      label: 'Vigil', phase: 2, weight: V.weight, cooldown: V.cooldown, band: V.band, recovery: V.recovery, cat: 'ranged',
      beats: [{
        tell: R, windup: V.windup, cock: V.cock, active: 0.05, damage: V.damage, knockback: V.knockback, knockdown: true,
        zone: AIM, part: 'eyes', close: 0, track: V.fix, selfHit: true, sustain: { dur: V.half / V.speed + 0.05, tick: 0.1 },
        fsLaser: { kind: 'vigil' }, keys: held(EYE, EYE_CUT, V.cock),
      }],
      recoveryKeys: back(FR.arEyeCut),
    },
    /** Absolution (P2+, red, held): the palm cannon. The iris charges (the light dims), the beam lit at
     *  the impact on the hero's bearing, swept toward his side as he walks sideways. */
    absolution: {
      label: 'Absolution', phase: 2, weight: AB.weight, cooldown: AB.cooldown, band: AB.band, recovery: AB.recovery, cat: 'ranged',
      beats: [{
        tell: R, windup: AB.windup, cock: AB.cock, active: 0.1, damage: AB.damage, knockback: AB.knockback, knockdown: true,
        zone: AIM, part: 'fistR', close: 0, track: AB.fix, selfHit: true, sustain: { dur: AB.lit - 0.1, tick: 0.1 },
        fsCannon: { kind: 'palm' }, keys: [[0.3, PALM_DRAW], [AB.cock, PALM_DRAW], [1.0, { ...PALM_AIM, e: 'i' }], [2.0, PALM_AIM]],
      }],
      recoveryKeys: back(FR.arPalmAim),
    },
    /** Triptych (P3+, blue x3): the forearm opens into a gun, three bolts, each arriving at its impact. A
     *  perfect parry sends one home into his chest. */
    triptych: {
      label: 'Triptych', phase: 3, weight: TR.weight, cooldown: TR.cooldown, band: TR.band, recovery: TR.recovery, cat: 'ranged',
      beats: [bolt(0, TR.first), bolt(1, TR.gap), bolt(2, TR.gap)],
      recoveryKeys: back(FR.arGun),
    },
    /** Choir (P3+, red marks): the shoulder petals open, the micro-missiles leave and come down on rings
     *  marked on the floor round the hero, the last ones on him, tracking. */
    choir: {
      label: 'Choir', phase: 3, weight: CH.weight, cooldown: CH.cooldown, band: CH.band, recovery: CH.recovery, cat: 'hazard',
      beats: [{
        tell: R, windup: CH.windup, fixed: true, cock: CH.cock, active: 0.1, damage: CH.damage, knockback: CH.knockback,
        cast: { kind: 'fsChoir', selfCue: true }, part: 'shoulderR', close: 0, track: 0.8, fsMissile: true,
        keys: [[0.4, CHOIR], [CH.cock, CHOIR], [1.0, { ...CHOIR_FIRE, e: 'o' }], [2.0, CHOIR]],
      }],
      recoveryKeys: back(FR.arChoir),
    },
    /** Passing Bell (P3+, red line): up on the thrusters, the line shown, the strafing pass across the floor
     *  with the eye laser cutting beneath him. */
    passingBell: {
      label: 'Passing Bell', phase: 3, weight: PB.weight, cooldown: PB.cooldown, band: PB.band, recovery: PB.recovery, cat: 'ranged',
      beats: [{
        tell: R, windup: PB.windup, fixed: true, cock: PB.cock, active: 0.05, damage: PB.damage, knockback: PB.knockback, knockdown: true,
        zone: AIM, part: 'eyes', close: 0, track: PB.fix, selfHit: true, air: true, sustain: { dur: PB.lit, tick: 0.1 },
        lift: [[0, 0], [PB.rise, PB.h], [1.0, PB.h], [1.72, PB.h], [2.0, 0]],
        fsLaser: { kind: 'bell' },
        keys: [[0.2, W({ ...FR.arBellHang, pitch: 0.12, hdX: 0.2 })], [PB.rise, HANG], [PB.cock, HANG], [1.0, { ...PASS, e: 'i' }], [1.72, PASS], [2.0, { ...LAND, e: 'o' }]],
      }],
      recoveryKeys: [[0.5, LAND], [1.0, STAND]],
    },
    /** Kyrie (P4): the mortar tubes fire a creeping barrage, rows of marked shells walking over the hero with
     *  safe lanes between them, then one great shell on his spot. */
    kyrie: {
      label: 'Kyrie', phase: 4, weight: KY.weight, cooldown: KY.cooldown, band: KY.band, recovery: KY.recovery, cat: 'hazard',
      beats: [
        {
          tell: R, windup: KY.windup, fixed: true, cock: KY.cock, active: 0.1, damage: KY.damage, knockback: KY.knockback,
          cast: { kind: 'fsKyrie', selfCue: true }, part: 'mortar', close: 0, track: 0.9, fsMortar: { first: true },
          keys: [[0.4, MORTAR], [KY.cock, MORTAR], [1.0, { ...MORTAR_FIRE, e: 'o' }], [1.6, MORTAR], [2.0, MORTAR]],
        },
        {
          tell: R, windup: greatWindup, fixed: true, cock: 0.9, active: 0.1, damage: KY.great.damage, knockback: KY.great.knockback, knockdown: true,
          cast: { kind: 'fsKyrie', selfCue: true }, part: 'mortar', close: 0, track: 0.95, fsMortar: { great: true },
          keys: [[0.3, MORTAR], [0.9, MORTAR], [1.0, { ...MORTAR_FIRE, e: 'o', bY: -0.5 }], [2.0, MORTAR]],
        },
      ],
      recoveryKeys: back(FR.arMortar),
    },
    /** Verdict (P4): his hand raised, a reticle walks after the hero and locks; the pillar of light comes
     *  down there (red), then a ring shock runs out along the floor (normal). A molten crater. */
    verdict: {
      label: 'Verdict', phase: 4, weight: VD.weight, cooldown: VD.cooldown, band: VD.band, recovery: VD.recovery, cat: 'hazard',
      beats: [{
        tell: R, windup: VD.windup, fixed: true, cock: VD.cock, active: 0.1, damage: VD.damage, knockback: VD.knockback, knockdown: true,
        cast: { kind: 'fsVerdict', selfCue: true }, part: 'fistR', close: 0, track: 0.9, fsLance: true,
        keys: [[0.25, UP], [VD.cock, UP], [1.0, { ...DOWN, e: 'o' }], [2.0, DOWN]],
      }],
      recoveryKeys: [[0.7, DOWN], [1.0, STAND]],
    },
    /** Revelation (P4, red, held): FULL BURST. Twin palm beams converging onto the hero, then the core
     *  cannon's giant beam swept about 60 degrees. */
    revelation: {
      label: 'Revelation', phase: 4, weight: RV.weight, cooldown: RV.cooldown, band: RV.band, recovery: RV.recovery, cat: 'ranged',
      beats: [
        {
          tell: R, windup: RV.windup, cock: RV.cock, active: 0.1, damage: RV.twin.damage, knockback: RV.twin.knockback, knockdown: true,
          zone: AIM, part: 'palms', close: 0, track: RV.fix, selfHit: true, sustain: { dur: RV.twin.lit - 0.1, tick: 0.1 },
          fsCannon: { kind: 'twin' }, keys: [[0.3, DRAW], [RV.cock, DRAW], [1.0, { ...TWIN, e: 'i' }], [2.0, TWIN]],
        },
        {
          tell: R, windup: RV.core.windup, cock: RV.core.cock, active: 0.1, damage: RV.core.damage, knockback: RV.core.knockback, knockdown: true,
          zone: AIM, part: 'core', close: 0, track: RV.core.cock, selfHit: true, sustain: { dur: RV.core.lit - 0.1, tick: 0.1 },
          fsCannon: { kind: 'core' }, keys: [[0.5, W({ ...FR.arBurstDraw, spX: -0.12 })], [RV.core.cock, W({ ...FR.arBurstCore, pitch: -0.04 })], [1.0, { ...CORE, e: 'i' }], [2.0, CORE]],
        },
      ],
      recoveryKeys: back(FR.arBurstCore),
    },
  };
}
// (his links out of these moves are links.js's LINK_TABLE, by id: none here)
export const LINKS = {};
