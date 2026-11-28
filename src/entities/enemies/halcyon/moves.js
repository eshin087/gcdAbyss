import { TELL } from '../../../combat/rules.js';
import { compileClip, completeBeat, GUARD, FOLDED } from './poses.js';
import { TUNING } from './tuning.js';
import { makeRealise } from '../duelist/realise.js';
import { X as ASC, CLIPS as ASC_CLIPS } from '../ascendant/moves.js';
import { halKeys, halRefMoveOn, HOVER_REACT, flyReactKeys } from './motion.js';
import { buildPace, paceCue, paceOn } from './pace.js';
import { SNAP_KEYS } from '../ascendant/motion.js';

// Halcyon's moves and reaction clips, as data (ADR-160; COMBAT.md → "Halcyon"). Every name is his own
// (the line on the homage). He fights BARE-HANDED: his blows are Tian Lei's exported strike builders
// (ascendant/moves.js X: punch, kick, strikeKeys), as the Thousand-Body Fox's are; `part` names the
// striking limb (halcyon.js: the engine's "blade" is that limb; 'eyes' for his eyes' beats). The MOVE /
// BEAT format is the Ash Disciple's (ashDisciple/moves.js header) with the engine's optional fields
// (duelist/brain.js header: air, sustain, selfHit, stance, zone.fwd). His own beat fields (halcyon.js
// routes them; grepped against every boss's move data, none in use: the Lord's `catch` lesson):
//   halPass: { n }        Fly-By's pass: he comes through the hero at chest height, 40 m/s (flight.js).
//                         On the feint before it (halPass: 'back') he backs off 14 - 18 m first.
//   halGlare: '<kind>'    his eyes (glare.js): 'stare' | 'sweep' | 'high' | 'wild' | 'burn'
//   halCurb: 'lift' | 'throw'   Curbside (terrain.js): the nearest car taken and lifted / thrown
//   halTower: 'out' | 'burst'   Through the Tower (terrain.js): behind a standing tower top / through it
//   halGrab: true         See the World (flight.js): caught, carried up, thrown down through the street
//   halClap: true         Applause: the clap's ring of force on the world
//   halDive: true         Meteor: the crater where he lands; he is stuck in it (the move's `grounded`)
//   halSky: 'lift' | 'drop'     The Falling Sky (terrain.js): a tower top torn free, carried, dropped
//   halArm: 'tear' | 'swing' | 'throw'   Monument (terrain.js): his statue's arm (a lamp post without it)
//   halBlink: { at, r }   a vanish to a side of the hero at u 0.12 of the windup (Blink of an Eye)
//   halCrash: true        a parry (a flying blow) or a perfect dodge (a red flying blow) THROWS HIM OFF HIS
//                         LINE into the first cover on it (flight.js crash; ADR-160: the reward loop)
//   halMoment: '<name>'   a scripted moment's beat (the transitions: halcyon.js)
// On a MOVE: `grounded` (his recovery is spent on the floor, not at hover), `once` (Through the Tower,
// The Falling Sky: they need a standing tower top: halcyon.js weigh), `cat` (director.js), `hidden`.

const N = TELL.NORMAL, B = TELL.BLUE, R = TELL.RED, K = TELL.BLACK;
const { punch, kick, strikeKeys, F, feet: FT } = ASC;
const G = TUNING.glare;
const SN = TUNING.snap;

// ---------------------------------------------------------------- pose fragments
/** Flying: the body pitched forward along the line, one fist ahead, the other arm along his side, the legs trailing. */
const FLY = F({ yaw: 0, bY: -0.05, pitch: 0.95, hdX: -0.65, rH: [0.1, 0.42, 0.42], rP: [-0.8, 0.2, -0.3], lH: [-0.02, -0.4, -0.2], lP: [0.8, -0.5, -0.3], rF: [-0.12, 0.55, -0.6], lF: [0.12, 0.45, -0.7], rK: [-0.1, -0.6, 0.3], lK: [0.1, -0.6, 0.3], flat: 0 });
/** Gathered to launch: crouched in the air, the fist drawn back, the eyes on the hero. */
const LAUNCH = F({ yaw: -0.3, bY: -0.25, pitch: 0.3, hdX: -0.2, rH: [0.12, 0.0, -0.1], rP: [-0.8, -0.4, -0.5], lH: [0.0, 0.1, 0.4], lP: [0.8, -0.6, -0.1], rF: [-0.12, 0.3, 0.1], lF: [0.12, 0.2, -0.05], rK: [-0.1, 0.4, 1], lK: [0.1, 0.2, 1], flat: 0.2 });
/** His eyes: chin down on the hero, the arms folded (the contempt of it), weight back. */
const STARE = F({ ...FOLDED, yaw: -0.08, bY: -0.04, pitch: -0.06, hdX: 0.22, hdY: 0.08, rF: [-0.1, 0.3, 0.1], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const STARE_ON = F({ ...FOLDED, yaw: -0.05, bY: -0.06, pitch: 0.02, hdX: 0.3, hdY: 0.05, rF: [-0.1, 0.3, 0.1], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** The sweep: the head turning with the beam (the beam is his eyes: the body follows a little). */
const GLARE_L = F({ yaw: 0.5, bY: -0.04, hdX: 0.18, hdY: 0.4, rH: [-0.12, -0.36, 0.06], lH: [0.12, -0.36, 0.06], rF: [-0.1, 0.25, 0.1], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const GLARE_R = F({ yaw: -0.5, bY: -0.04, hdX: 0.18, hdY: -0.4, rH: [-0.12, -0.36, 0.06], lH: [0.12, -0.36, 0.06], rF: [-0.1, 0.25, 0.1], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** Both hands overhead (a car lifted, a tower top carried). */
const OVERHEAD = F({ yaw: 0, bY: -0.1, pitch: -0.05, hdX: -0.15, rH: [0.12, 0.58, 0.06], rP: [-0.7, 0.4, -0.4], lH: [-0.12, 0.58, 0.06], lP: [0.7, 0.4, -0.4], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** One hand overhead (the car one-handed), the other on his hip. */
const ONE_HAND = F({ yaw: -0.2, bY: -0.06, pitch: -0.04, hdX: -0.05, rH: [0.04, 0.6, 0.02], rP: [-0.7, 0.4, -0.4], lH: [0.2, -0.24, 0.0], lP: [0.9, -0.2, -0.6], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const THROW = F({ yaw: 0.45, bY: -0.12, pitch: 0.16, hdX: 0.05, rH: [0.06, 0.2, 0.55], rP: [-0.8, -0.2, -0.3], lH: [0.2, -0.24, 0.0], lP: [0.9, -0.2, -0.6], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** The clap: the arms flung wide, then the palms together before him. */
const CLAP_OPEN = F({ yaw: 0, bY: -0.08, pitch: -0.1, hdX: -0.1, rH: [-0.5, 0.12, 0.1], rP: [-0.9, 0.2, -0.2], lH: [0.5, 0.12, 0.1], lP: [0.9, 0.2, -0.2], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const CLAP_SHUT = F({ yaw: 0, bY: -0.12, pitch: 0.12, hdX: 0.05, rH: [0.1, 0.12, 0.5], rP: [-0.8, -0.4, -0.2], lH: [-0.1, 0.12, 0.5], lP: [0.8, -0.4, -0.2], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** The open hand reached out slowly (See the World). */
const REACH_OPEN = F({ yaw: -0.35, bY: -0.1, pitch: 0.06, hdX: 0.05, rH: [0.12, -0.3, 0.1], lH: [0.0, 0.12, 0.36], lP: [0.6, -0.9, 0.1], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const REACH_GRAB = F({ yaw: 0.0, bY: -0.12, pitch: 0.16, hdX: 0.08, rH: [0.12, -0.3, 0.1], lH: [-0.04, 0.08, 0.6], lP: [0.6, -0.9, 0.1], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** The great two-handed sweep (Monument): wound round to one side, swung through. */
const SWING_A = F({ yaw: -1.1, bY: -0.2, pitch: 0.05, hip: -0.3, rH: [-0.3, 0.2, 0.2], lH: [-0.42, 0.2, 0.24], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
const SWING_B = F({ yaw: 1.1, bY: -0.22, pitch: 0.08, hip: 0.3, rH: [0.42, 0.16, 0.3], lH: [0.3, 0.16, 0.26], rF: [-0.12, 0.25, 0.08], lF: [0.12, 0.0, -0.04], flat: 0.2 });
/** The dive: drawn up into a ball over the hero, then both fists driven down. */
const DIVE_TOP = F({ yaw: 0, bY: -0.3, pitch: 0.4, hdX: 0.3, rH: [0.14, 0.5, 0.1], lH: [-0.14, 0.5, 0.1], rF: [-0.12, 0.45, 0.1], lF: [0.12, 0.4, 0.0], rK: [-0.1, 0.6, 1], lK: [0.1, 0.6, 1], flat: 0 });
const DIVE_HIT = F({ yaw: 0, bY: -0.45, pitch: 0.5, hdX: 0.35, rH: [0.12, -0.3, 0.42], lH: [-0.12, -0.3, 0.42], ...FT.LOW });
/** On one knee, a hand to his mouth (the smile drops). */
const KNEEL = F({ bY: -0.52, pitch: 0.24, spX: 0.1, hdX: 0.4, yaw: 0, rF: [-0.12, 0.32], lF: [0.17, -0.42], rK: [0, 0, 1], lK: [0.1, -0.85, 0.5], flat: 0.7, rH: [0.06, 0.1, 0.18], lH: [0.06, -0.4, 0.2] });
/** The scream: up from the knee, the arms flung down and back, the head thrown back. */
const SCREAM = F({ bY: -0.06, pitch: -0.28, spX: -0.16, hdX: -0.55, yaw: 0, rH: [-0.36, -0.2, -0.18], lH: [0.36, -0.2, -0.18], rP: [-0.9, 0.2, -0.3], lP: [0.9, 0.2, -0.3], rF: [-0.14, 0.3, 0.1], lF: [0.14, 0.1, -0.06], flat: 0.2 });

/** A held pose's keys over a beat (u 0..2): from `a` at the cock to `b` at the impact, held. */
const holdKeys = (a, b, cock = 0.7) => [[cock * 0.5, a], [cock, a], [1.0, { ...b, e: 'i' }], [2.0, b]];

// ---------------------------------------------------------------- beat builders
/** One of his eyes' beats (glare.js): a selfHit beat sustained for its lit window. */
function glareBeat(kind, tell, o = {}) {
  const C = G[kind];
  const lit = C.lit ?? 0.9;
  return {
    tell, windup: o.windup ?? C.windup, fixed: true, active: G.active, damage: C.first?.damage ?? C.damage ?? 0, knockback: C.first?.knockback ?? C.knockback ?? 3,
    knockdown: tell === R, zone: { kind: 'line', r: C.len, w: C.w ?? C.r * 2 }, part: 'eyes', close: 0, track: 0, cock: 0.85,
    selfHit: true, air: true, sustain: { dur: Math.max(0.05, lit - G.active), tick: G.tick }, halGlare: kind,
    keys: o.keys ?? (kind === 'sweep' ? holdKeys(GLARE_L, GLARE_R, 0.6) : holdKeys(STARE, STARE_ON, 0.7)), ...o.extra,
  };
}

/** Fly-By's back-off (a feint: no blow): up and away to the far end of his line. */
const passBack = (windup = 0.55) => ({ feint: true, windup, active: 0.05, close: 0, track: 1, halPass: 'back', keys: holdKeys(LAUNCH, LAUNCH, 0.6) });
/** Fly-By's pass: through the hero at chest height, 40 m/s (flight.js moves him: no close, no dash). */
const pass = (tell, windup, damage, o = {}) => ({
  tell, windup, active: 0.12, damage, knockback: 3, zone: { kind: 'ring', r: 1.5 }, ring: tell === R ? 1.5 : undefined, part: 'fistR', air: true, close: 0, track: 0.8, cock: 0.75,
  halPass: 'go', halCrash: true, keys: [[0.35, LAUNCH], [0.75, LAUNCH], [1.0, { ...FLY, e: 'i' }], [2.0, FLY]], ...o,
});

/** A transition (the engine's beat: on one knee, then a ring of force, red), its own keys. */
const transitionBeat = (moment) => ({
  tell: R, windup: 2.2, fixed: true, active: 0.22, damage: TUNING.transition.damage, knockback: TUNING.transition.knockback, knockdown: true,
  zone: { kind: 'ring', r: TUNING.transition.ringRadius }, ring: TUNING.transition.ringRadius, part: 'feet', track: 0, close: 0, cock: 0.9, air: true, halMoment: moment,
  keys: [[0.12, KNEEL], [0.5, KNEEL], [0.62, F({ ...KNEEL, lH: [0.04, 0.12, 0.2], hdX: 0.2 })], [0.85, SCREAM], [1.0, { ...SCREAM, e: 'o' }], [2.0, SCREAM]],
});

// ---------------------------------------------------------------- the moves
export const MOVES = {
  // ================================================================ phase 1: THE IDOL (he smiles)
  /** Meet and Greet: a floating jab, a slap, a straight right (the flare: a parry moment). */
  meetAndGreet: {
    label: 'Meet and Greet', phase: 1, weight: [2.4, 1.6, 1.6], cooldown: 3, band: [0, 3.6], recovery: 0.55, cat: 'string',
    beats: [punch('jab', N, 0.53, 13), punch('backfist', N, 0.36, 13), punch('cross', B, 0.42, 20, { flare: true })],
  },
  /** Backhand: one blow with a bait hold that sends the hero flying through whatever stands behind him. */
  backhand: {
    label: 'Backhand', phase: 1, weight: [1.6, 1.1, 0.8], cooldown: 4, band: [0, 3.2], recovery: 0.6, cat: 'single',
    beats: [{ ...punch('backfist', B, 0.62, 22, { cock: 0.7 }), hold: [0.08, 0.3], knockback: 5 }],
  },
  /** Smile for the Cameras: arms spread, chin up. Cut into it and he catches the blade in two fingers and
   *  punishes; wait, and he stands open (the engine's counter stance). */
  smile: {
    label: 'Smile for the Cameras', phase: 1, weight: [0.8, 0.5, 0], cooldown: 11, band: [0, 3.2], recovery: 0.6, cat: 'single',
    beats: [
      { tell: N, windup: 0.45, fixed: true, hold: [0.25, 0.45], active: 0.05, damage: 0, feint: true, stance: { from: 0.3, open: 0.8 }, part: 'palms', close: 0, track: 0.9, keys: [[0.4, CLAP_OPEN], [0.8, F({ ...CLAP_OPEN, hdX: -0.25 })], [2.0, CLAP_OPEN]] },
      punch('cross', N, 0.5, 14, { track: 0.7 }),
      { ...punch('palm', B, 0.4, 22), knockback: 4 },
    ],
  },
  /** The Stare: two crimson points kindle, his head comes down: a beam from his eyes (blue first contact). */
  stare: {
    label: 'The Stare', phase: 1, weight: [1.5, 1.0, 0.45], cooldown: 7, band: [2.5, 14], recovery: 0.6, cat: 'ranged',
    beats: [glareBeat('stare', B)],
  },
  /** Red Glare: lit at the cue, swept level at the waist across the plaza (red: roll, cover, or be close). */
  redGlare: {
    label: 'Red Glare', phase: 1, weight: [1.2, 1.1, 0.5], cooldown: 8, band: [2.4, 16], recovery: 0.65, cat: 'ranged',
    beats: [glareBeat('sweep', R)],
  },
  /** Fly-By: he backs off down the street and comes through at chest height (a parry: the crash). */
  flyBy: {
    label: 'Fly-By', phase: 1, weight: [1.6, 0, 0], cooldown: 6, band: [0, 12], recovery: 0.8, cat: 'closer', gapCloser: true,
    beats: [passBack(), pass(B, 0.7, 22, { flare: true })],
  },
  /** Curbside: he lands by the nearest car, lifts it one-handed and throws it (a parry cuts it in two). */
  curbside: {
    label: 'Curbside', phase: 1, weight: [1.2, 1.0, 0.8], cooldown: 9, band: [3, 16], recovery: 0.7, cat: 'ranged',
    beats: [
      { feint: true, windup: TUNING.curb.lift, active: 0.05, close: 0, track: 1, halCurb: 'lift', keys: [[0.35, OVERHEAD], [0.8, ONE_HAND], [2.0, ONE_HAND]] },
      { tell: B, windup: 0.55, active: 0.1, damage: 22, knockback: 3, cast: { kind: 'car', selfCue: true }, part: 'fistR', close: 0, track: 0.9, cock: 0.7, halCurb: 'throw', keys: holdKeys(ONE_HAND, THROW, 0.7) },
    ],
  },
  /** Flick (ADR-225, a snap: `?halMotion=a`): the back of his hand, out of nothing: a white blow from
   *  his guard with a short windup (TUNING.snap). */
  flick: {
    label: 'Flick', phase: 1, weight: [1.3, 1.0, 0.9], cooldown: SN.cooldown, band: [0, SN.band], recovery: SN.recovery, cat: 'single', snap: true,
    beats: [{ ...punch('backfist', N, SN.windup, SN.damage, { cock: 0.5 }), fixed: true, snap: true, close: SN.close, track: 0.8, keys: SNAP_KEYS.flick }],
  },
  /** Tap (a snap): the lead hand straight out of his guard. */
  tap: {
    label: 'Tap', phase: 1, weight: [1.0, 1.2, 1.2], cooldown: SN.cooldown, band: [0, SN.band], recovery: SN.recovery, cat: 'single', snap: true,
    beats: [{ ...punch('jab', N, SN.windup, SN.damage, { cock: 0.5 }), fixed: true, snap: true, close: SN.close, track: 0.8, keys: SNAP_KEYS.jab }],
  },
  /** His counter out of his guard: a palm. */
  riposte: {
    label: 'Saviour\'s Answer', phase: 1, weight: [0, 0, 0], counter: true, cooldown: 0, band: [0, 5], recovery: 0.55,
    beats: [punch('palm', B, 0.53, 18)],
  },
  /** His answer to a streak of guards: blows from every side, faster than the eye. */
  streakFlurry: {
    label: 'Faster Than Sound', phase: 1, weight: [0, 0, 0], counter: true, streak: true, cooldown: 0, band: [0, 6], recovery: 0.75,
    beats: [
      punch('cross', N, 0.62, 14, { track: 0.7 }),
      { ...kick('round', N, 0.48, 14), flit: { r: 2.4 } },
      { ...punch('hook', N, 0.48, 14), flit: { r: 2.4 } },
      { ...punch('uppercut', N, 0.48, 14), flit: { r: 2.4 } },
    ],
  },

  // ================================================================ phase 2: THE SMILE DROPS
  /** Fly-By, twice. */
  flyBy2: {
    label: 'Fly-By', phase: 2, weight: [0, 1.6, 0], cooldown: 7, band: [0, 12], recovery: 0.75, cat: 'closer', gapCloser: true,
    beats: [passBack(), pass(B, 0.7, 22, { flare: true }), passBack(0.5), pass(B, 0.62, 22, { flare: true })],
  },
  /** Through the Tower: he streaks behind a tower; its windows flare on his line; he bursts through its
   *  top at you (red) and the top comes down across the plaza. A perfect dodge: he overshoots (the crash). */
  throughTower: {
    label: 'Through the Tower', phase: 2, weight: [0, 1.2, 0.9], cooldown: 14, band: [0, 30], recovery: 1.1, cat: 'closer', once: 'tower', gapCloser: true,
    beats: [
      { feint: true, windup: 0.5, active: 0.05, close: 0, track: 1, halTower: 'out', keys: holdKeys(LAUNCH, FLY, 0.4) },
      { tell: R, windup: TUNING.tower.flare + 0.35, fixed: true, active: 0.12, damage: 26, knockback: 5, knockdown: true, zone: { kind: 'ring', r: 1.8 }, ring: 1.8, part: 'fistR', air: true, close: 0, track: 0, cock: 0.8, halTower: 'burst', halCrash: true, keys: [[0.4, FLY], [0.8, FLY], [1.0, { ...FLY, e: 'i' }], [2.0, F({ ...LAUNCH, pitch: 0.2 })]] },
    ],
  },
  /** Blink of an Eye: he is gone and at another side of you, three times, then the red. */
  blink: {
    label: 'Blink of an Eye', phase: 2, weight: [0, 1.6, 1.8], cooldown: 7, band: [0, 8], recovery: 0.6, cat: 'string',
    beats: [
      { ...punch('jab', N, 0.62, 12), halBlink: { at: 1.4, r: 1.9, slow: true }, close: 1.0, track: 0.8 },
      { ...punch('hook', N, 0.42, 12), halBlink: { at: -1.4, r: 1.9 }, close: 1.0, track: 0.8 },
      { ...punch('cross', B, 0.44, 20, { flare: true }), halBlink: { at: Math.PI, r: 1.9 }, close: 1.0, track: 0.8, halCrash: true },
      { ...kick('side', R, 0.56, 24), knockdown: true, close: 0.8, track: 0.6 },
    ],
  },
  /** Applause: one clap. A ring of force runs out across the plaza (blue: parry or roll). */
  applause: {
    label: 'Applause', phase: 2, weight: [0, 1.0, 0.9], cooldown: 10, band: [0, 6.5], recovery: 0.6, cat: 'area',
    beats: [{ tell: B, windup: 0.7, active: 0.12, damage: 18, knockback: 6, zone: { kind: 'ring', r: TUNING.clap.r }, part: 'palms', close: 0, track: 0.6, cock: 0.7, halClap: true, keys: holdKeys(CLAP_OPEN, CLAP_SHUT, 0.75) }],
  },
  /** See the World: an open hand, slow. Caught, you are carried up over the city and thrown down through
   *  it. A perfect dodge: he closes on air (the crash). */
  seeTheWorld: {
    label: 'See the World', phase: 2, weight: [0, 0.9, 0.8], cooldown: 15, band: [0, 4], recovery: 0.7, cat: 'single',
    beats: [{ tell: R, windup: 1.1, active: 0.1, damage: 6, knockback: 0, zone: { kind: 'sector', r: 1.8, ang: 0.6 }, part: 'fistL', close: 2.4, track: 0.85, cock: 0.8, halGrab: true, halCrash: true, keys: holdKeys(REACH_OPEN, REACH_GRAB, 0.8) }],
  },
  /** Scorched Avenue: he rises over the street; the line through you is marked in red on the road; the
   *  beam's foot runs down it (red: leave the line). */
  scorchedAvenue: {
    label: 'Scorched Avenue', phase: 2, weight: [0, 1.0, 0.8], cooldown: 11, band: [3, 18], recovery: 0.8, cat: 'ranged',
    beats: [{ ...glareBeat('high', R, { extra: { lift: [[0, 0.5], [0.45, G.high.rise], [2.0, G.high.rise]] } }), zone: { kind: 'line', r: G.high.len, w: G.high.r * 2 } }],
  },
  /** Meteor: a dive from nine metres; a crater; he is stuck in it a moment. */
  meteor: {
    // (phase 1 with no weight there: the AI takes it from phase 2; the Lab and Training may call it at once)
    label: 'Meteor', phase: 1, weight: [0, 1.0, 0.9], cooldown: 10, band: [3, 12], recovery: 1.0, cat: 'closer', grounded: true, gapCloser: true,
    beats: [{ tell: R, windup: 1.05, active: 0.12, damage: 26, knockback: 4, knockdown: true, zone: { kind: 'ring', r: 4 }, ring: 4, part: 'palms', close: 0, track: 0.9, cock: 0.8, air: true, halDive: true, leap: { from: 0.12, lock: 0.78, apex: TUNING.meteor.from }, keys: [[0.4, DIVE_TOP], [0.85, DIVE_TOP], [1.0, { ...DIVE_HIT, e: 'i' }], [2.0, DIVE_HIT]] }],
  },
  /** The Smile Drops (the phase-2 transition): on one knee, a hand to his lip, the screens to static,
   *  then a scream and his eyes fire wild over your head; the ring (red). */
  smileDrops: {
    label: 'The Smile Drops (phase 2)', phase: 2, weight: [0, 0, 0], transition: true, cooldown: 0, band: [0, 99], recovery: 0.6,
    beats: [transitionBeat('smileDrops')],
  },

  // ================================================================ phase 3: NO ONE IS WATCHING
  /** Fly-By, three times, the last red. */
  flyBy3: {
    label: 'Fly-By', phase: 3, weight: [0, 0, 1.4], cooldown: 8, band: [0, 12], recovery: 0.7, cat: 'closer', gapCloser: true,
    beats: [passBack(), pass(B, 0.66, 22, { flare: true }), passBack(0.45), pass(B, 0.6, 22, { flare: true }), passBack(0.45), pass(R, 0.62, 26, { knockdown: true })],
  },
  /** The Falling Sky: he tears a tower's top free, carries it over the plaza and drops it on you (black). */
  fallingSky: {
    label: 'The Falling Sky', phase: 3, weight: [0, 0, 1.0], cooldown: 20, band: [0, 30], recovery: 1.2, cat: 'area', once: 'tower', grounded: true,
    beats: [
      { feint: true, windup: 0.6, active: 0.05, close: 0, track: 1, halSky: 'lift', keys: holdKeys(OVERHEAD, OVERHEAD, 0.5) },
      { tell: K, windup: TUNING.sky.mark, fixed: true, active: 0.14, damage: TUNING.sky.damage, knockback: TUNING.sky.knockback, knockdown: true, zone: { kind: 'ring', r: TUNING.sky.r }, ring: TUNING.sky.r, part: 'palms', air: true, close: 0, track: 0, cock: 0.85, halSky: 'drop', keys: holdKeys(OVERHEAD, F({ ...OVERHEAD, pitch: 0.4, rH: [0.12, 0.2, 0.5], lH: [-0.12, 0.2, 0.5] }), 0.8) },
    ],
  },
  /** Monument: he tears the raised arm off his own statue and swings it twice through everything in 5 m,
   *  then throws it (no arm left: a lamp post, lighter). */
  monument: {
    label: 'Monument', phase: 3, weight: [0, 0, 1.0], cooldown: 14, band: [0, 14], recovery: 0.7, cat: 'area',
    beats: [
      { feint: true, windup: 0.7, active: 0.05, close: 0, track: 1, halArm: 'tear', keys: holdKeys(OVERHEAD, SWING_A, 0.6) },
      { tell: B, windup: 0.62, active: 0.14, damage: 22, knockback: 5, zone: { kind: 'ring', r: TUNING.monument.r }, part: 'palms', close: 2.2, track: 0.8, cock: 0.75, halArm: 'swing', keys: holdKeys(SWING_A, SWING_B, 0.75) },
      { tell: R, windup: 0.6, active: 0.14, damage: 26, knockback: 6, knockdown: true, zone: { kind: 'ring', r: TUNING.monument.r }, ring: TUNING.monument.r, part: 'palms', close: 1.2, track: 0.8, cock: 0.75, halArm: 'swing', keys: holdKeys(SWING_B, SWING_A, 0.75) },
      { tell: B, windup: 0.55, active: 0.1, damage: 22, knockback: 3, cast: { kind: 'arm', selfCue: true }, part: 'fistR', close: 0, track: 0.9, cock: 0.7, halArm: 'throw', keys: holdKeys(ONE_HAND, THROW, 0.7) },
    ],
  },
  /** Crossed Glare: two sweeps from opposite sides, 0.9 s apart (red, red: two rolls). */
  crossedGlare: {
    label: 'Crossed Glare', phase: 3, weight: [0, 0, 0.8], cooldown: 11, band: [2.4, 16], recovery: 0.7, cat: 'ranged',
    beats: [glareBeat('sweep', R), glareBeat('sweep', R, { windup: 0.9, keys: holdKeys(GLARE_R, GLARE_L, 0.6), extra: { sweepSide: -1 } })],
  },
  /** No One Is Watching (the phase-3 transition): he burns out every screen still standing, the neon dies;
   *  the ring (red). */
  noOneWatching: {
    label: 'No One Is Watching (phase 3)', phase: 3, weight: [0, 0, 0], transition: true, cooldown: 0, band: [0, 99], recovery: 0.6,
    beats: [transitionBeat('noOneWatching')],
  },
};
export const MOVE_NAMES = Object.keys(MOVES);
/** The scripted move that begins each later phase. */
export const TRANSITIONS = Object.freeze({ 2: 'smileDrops', 3: 'noOneWatching' });
/** What starts the moment a transition ends (halcyon.js onTransitionEnd): Through the Tower, The Falling Sky. */
export const AFTER = Object.freeze({ smileDrops: 'throughTower', noOneWatching: 'fallingSky' });

// ---------------------------------------------------------------- reaction clips
// Tian Lei's bare-handed reactions round his guard; his own wait (hovering, arms folded), intro (down out
// of the dark, one finger: come on), the crash (buried in the wreck), the death (he tries to rise twice).
const HOVER_FOLD = F({ ...FOLDED, bY: -0.02, pitch: -0.04, hdX: -0.1, yaw: 0, rF: [-0.1, 0.34, 0.12], lF: [0.12, -0.02, -0.06], rK: [-0.1, 0.4, 1], lK: [0.1, 0, 1], flat: 0.2 });
const DOWN = F({ bY: -0.75, pitch: 1.1, hdX: 0.3, rH: [-0.3, -0.1, 0.3], lH: [0.3, -0.2, 0.25], rF: [-0.13, -0.6], lF: [0.13, -0.55], rK: [-0.05, -0.6, 0.8], lK: [0.05, -0.6, 0.8], flat: 0.1 });
export const CLIPS = {
  ...ASC_CLIPS,
  meditate: { dur: 1, hold: true, keys: [[0, HOVER_FOLD]] },
  intro: {
    dur: 2.4,
    keys: [
      [0, HOVER_FOLD],
      [1.4, HOVER_FOLD],
      [1.8, F({ ...HOVER_FOLD, lH: [0.0, 0.2, 0.5], lP: [0.6, -0.9, 0.1], hdX: -0.18 })],
      [2.1, F({ ...HOVER_FOLD, lH: [0.0, 0.26, 0.46], lP: [0.6, -0.9, 0.1], hdX: -0.18 })],
      [2.4, HOVER_FOLD],
    ],
  },
  /** Thrown off his line into the wreck: down, buried, then up (held by flight.js for the stun). */
  crashed: {
    dur: 1.6, hold: true,
    keys: [[0, FLY], [0.25, { ...DOWN, e: 'o' }], [1.2, DOWN], [1.6, KNEEL]],
  },
  /** His own beam back in his eyes: thrown back, the hands to his face. */
  blinded: {
    dur: 1.6,
    keys: [[0.12, { ...SCREAM, rH: [0.06, 0.32, 0.22], lH: [-0.06, 0.32, 0.22], e: 'o' }], [1.0, F({ ...KNEEL, rH: [0.06, 0.3, 0.2], lH: [-0.06, 0.3, 0.2] })], [1.6, KNEEL]],
  },
  death: {
    dur: 3.4, hold: true,
    keys: [
      [0.3, { ...KNEEL, e: 'o' }],
      [0.9, F({ ...KNEEL, bY: -0.3, hdX: 0.1 })],
      [1.3, KNEEL],
      [1.9, F({ ...KNEEL, bY: -0.32, hdX: 0.05 })],
      [2.3, F({ ...KNEEL, hdX: 0.55 })],
      [3.4, F({ ...KNEEL, bY: -0.58, pitch: 0.4, hdX: 0.7, rH: [0.06, -0.52, 0.3], lH: [0.0, -0.5, 0.24] })],
    ],
  },
};
/** Extra reactions' root motion and which leave him open (duelist.js kit.REACT / OPEN). */
export const REACT = Object.freeze({ crashed: { travel: 0 }, blinded: { travel: -0.8 } });
export const OPEN = Object.freeze(['crashed', 'blinded']);

/** Compiled reaction clips (build time). */
const compileReact = (c, keys = c.keys) => compileClip(keys.map(([t, pose]) => ({ t, ...pose })), c.dur, { hold: !!c.hold });
const CLIP_BASE = Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, compileReact(c)]));
for (const [k, c] of Object.entries(CLIP_BASE)) c.name = k;
/** (ADR-289, `?halRefMove=a`: motion.js) the reactions he takes in the air, flown: the same times. */
const CLIP_FLOWN = Object.fromEntries(HOVER_REACT.filter((k) => CLIPS[k]).map((k) => [k, compileReact(CLIPS[k], flyReactKeys(CLIPS[k].keys))]));
for (const [k, c] of Object.entries(CLIP_FLOWN)) c.name = k;
/** The kit's clips: a flown reaction behind the live switch (read as a reaction starts). */
export const CLIP = {};
for (const k of Object.keys(CLIP_BASE)) {
  Object.defineProperty(CLIP, k, { enumerable: true, get: () => (CLIP_FLOWN[k] && halRefMoveOn() ? CLIP_FLOWN[k] : CLIP_BASE[k]) });
}
/** (tests) Both sets: { base, flown }. */
export const HAL_REF_CLIPS = Object.freeze({ base: CLIP_BASE, flown: CLIP_FLOWN });

// ---------------------------------------------------------------- realising a move
// (ADR-225: `?halMotion=a` plays his reworked motion through `keysOf`: motion.js; ADR-254: `?halMotion=b`
// the flier's limbs on top, limbs.js; `?halPace=a` the readable pace, pace.js: a held cock, a later cue)
const PACE = buildPace(MOVES, TUNING);
let PH = 1;
// (ADR-289, `?halRefMove=a`: motion.js) Meteor: from the impact a three-point landing (the right knee
// down, the right hand on the ground, the left arm out, the head up at the hero), held into the recovery,
// then up. The impact key (u 1, e: 'i') and every time are the move's own; the recovery's first key is at
// 0.75, where the realiser puts the follow-through's end without one, so its clock (b.F) is unchanged.
const LAND3 = F({ bY: -0.5, pitch: 0.42, spX: 0.12, hdX: -0.12, yaw: 0, rH: [-0.08, -0.66, 0.34], rP: [-0.4, -0.9, 0.2], lH: [0.3, -0.24, 0.1], lP: [0.9, 0.0, -0.3], rF: [-0.13, -0.36], lF: [0.16, 0.36], rK: [-0.05, -0.8, 0.6], lK: [0.1, 0, 1], flat: 0.6 });
const LAND_UP = F({ ...LAND3, bY: -0.3, pitch: 0.2, hdX: -0.05, rH: [-0.1, -0.4, 0.2], lH: [0.2, -0.32, 0.1] });
const REF_KEYS = new Map([[MOVES.meteor.beats[0], [[0.4, DIVE_TOP], [0.85, DIVE_TOP], [1.0, { ...DIVE_HIT, e: 'i' }], [1.6, LAND3], [2.0, LAND3]]]]);
const REF_RECOVERY = new Map([[MOVES.meteor, [[0.75, LAND3], [0.95, LAND_UP]]]]);
const keysOf = (b) => {
  const k = halKeys(b) ?? (halRefMoveOn() ? REF_KEYS.get(b) ?? null : null);
  const h = paceOn() ? PACE[Math.min(3, Math.max(1, PH)) - 1].get(b) ?? 0 : 0;
  return h > 0 ? { keys: k, hold: h } : k;
};
const recoveryKeysOf = (m) => (halRefMoveOn() ? REF_RECOVERY.get(m) ?? null : null);
const base = makeRealise({ TUNING, MOVES, compileClip: (keys, dur) => compileClip(keys, dur), completeBeat, keysOf, recoveryKeysOf });
export function realise(name, phase = 1, rnd = Math.random, opts = null) {
  PH = phase;
  const A = base(name, phase, rnd, opts);
  return A && paceOn() ? paceCue(A, TUNING) : A;
}

/** The guard pose (for tools). */
export { GUARD };
