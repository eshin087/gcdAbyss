import { TELL } from '../../../combat/rules.js';
import { compileClip, GUARD } from './poses.js';
import { TUNING } from './tuning.js';
import { makeRealise } from '../duelist/realise.js';
import { GUARD_CLIPS } from '../duelist/guard.js';

// The Ash Disciple's moves and reaction clips, as data (docs/specs/ash-disciple.md §3; COMBAT.md →
// "The Ash Disciple"). Nothing mirrors the hero's moveset.
//
// A MOVE: { label, phase (first phase it is used in), weight [P1, P2] (0 = never picked by the AI),
//   cooldown, band [min, max] (m to the hero for the AI to pick it), counter (only as a counter from
//   his guard), recovery, recoveryKeys [[r 0..1, pose]], beats: [...] }
// A BEAT (one hit, or a feint): {
//   tell N|B|R (none on a feint), feint (no tell, no glint, no hit), windup, hold [min, max] (a random
//   extra pause at `cock` (0..1 of the windup, default 0.8) that baits an early parry), active,
//   chance (< 1: rolled when the move starts), damage, knockback, knockdown,
//   zone { kind: 'sector' (r, ang) | 'line' (r, w) | 'ring' (r) } (tested through the active frames:
//   one hit per beat), ring (red ground warning radius), part ('tip' | 'feet': where the glint pops),
//   track (windup fraction he keeps turning toward the hero until; default 0.75),
//   close (m: how far he may step in toward the hero during the windup so the zone reaches him at the
//   impact; default TUNING.close: the move's first hit / later hits; 0 = none: dashes, leaps, the qi),
//   travel [[u, metres], ...] (forward root motion), dash { from, to, stop, max } (toward the hero's
//   spot as the dash starts), lift [[u, metres], ...] (root height: the leap),
//   release { count [P1, P2], spread, speed } (Ash Crescent: sword qi thrown at u = 1),
//   keys [[u, pose], ...] (u 0..1 = the windup, 1 = the impact, 1..2 = the active frames; a pose is a
//   poses.js clip key without its `t`) }
// Rules (COMBAT.md, checked by tests/integration/duel.mjs): a tell on every real hit, a move's first
// real windup >= TUNING.minFirstWindup in every phase, impacts >= TUNING.minHitGap apart, feints
// never flash.

const N = TELL.NORMAL, B = TELL.BLUE, R = TELL.RED;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- pose fragments
// (body-space hand offsets / blade [az, el]; feet model space [x, z]; see poses.js)
// The stance is the classic jian guard (poses.js GUARD: yaw 0.62, the blade at az -0.52: straight at
// the opponent). Body-space azimuth = world azimuth (0 = at the opponent) − the body's yaw.
const SET = { rF: [-0.12, 0.36], lF: [0.2, -0.3] }; // the guard's feet
const STEP_IN = { rF: [-0.12, 0.64], lF: [0.22, -0.4], rK: [-0.25, 0, 1], lK: [0.6, -0.2, 0.8], lFy: 0.95 }; // the front foot steps in
const LUNGE_FEET = { rF: [-0.08, 0.9], lF: [0.22, -0.62], rK: [-0.1, 0, 1], lK: [0.35, -0.3, 0.9], rFy: -0.05, lFy: 0.95 };
const COIL = { bY: -0.22, bZ: -0.08, yaw: 0.85, hip: 0.14, spY: 0, spX: 0.06, rH: [-0.08, -0.22, 0.0], rP: [-0.6, -0.6, -0.5], sw: [-0.9, 0.04], swF: [1, 0.1, 0], lH: [0.02, 0.0, 0.42], lP: [0.6, -0.3, 0.5], hdY: -0.75, ...SET };
const LUNGE = {
  bY: -0.3, bZ: 0.22, pitch: 0.1, yaw: 0.3, hip: -0.06, spX: 0.18, spY: -0.04, hdY: -0.26, hdX: 0.02,
  rH: [0.04, -0.04, 0.56], rP: [-0.7, -0.3, -0.2], sw: [-0.3, 0.02], swF: [1, 0.1, 0], lH: [0.14, 0.08, -0.4], lP: [0.7, 0.2, -0.6],
  ...LUNGE_FEET,
};
const RAISED = { two: 1, rH: [0.12, 0.28, 0.1], rP: [-0.8, 0.4, -0.3], sw: [-0.2, 2.3], swF: [1, 0, 0], pitch: -0.14, bY: -0.04, spX: -0.06, hdX: -0.06, yaw: 0.2 };
const CHOP = { two: 1, rH: [0.1, -0.3, 0.46], rP: [-0.8, -0.3, 0], sw: [-0.12, -0.62], swF: [1, 0, 0], pitch: 0.32, bY: -0.3, spX: 0.22, hdX: 0.28, yaw: 0.12, rF: [-0.1, 0.76], lF: [0.22, -0.5] };
const STEP_BACK = { rF: [-0.12, 0.18], lF: [0.2, -0.38] };
const CROUCH = { bY: -0.52, pitch: 0.16, rF: [-0.46, 0.22], lF: [0.2, -0.1], rK: [-0.6, 0.3, 0.7], lK: [0.4, 0.2, 0.9], rFy: -0.7, flat: 0.8 };
const W2B = (wAz, yaw) => wAz - yaw; // a world-relative blade azimuth → body space at that yaw

/** Thrust beat keys: the blade drawn back along the body at the cock, driven home at the impact
 *  on a long lunge, held through the active frames, then a beat of follow-through. */
const thrustKeys = (k = 1, cock = 0.74) => [
  [cock * 0.5, { ...COIL, bY: -0.18 * k, rH: [-0.04, -0.18, 0.12] }],
  [cock, { ...COIL, rH: [-0.08 * k, -0.24, -0.02], bY: -0.24 * k }],
  [1.0, { ...LUNGE, e: 'i' }],
  [1.6, { ...LUNGE, e: 'o', bZ: 0.26, rH: [0.05, -0.03, 0.58] }],
  [2.0, { ...LUNGE, bZ: 0.2 }],
];

/**
 * A cut, as the blade's path (poses.js `arm`: the hand follows the steel). World-relative blade
 * directions [az, el] (az 0 = at the opponent, + = his left): `from` where it is cocked (at `cock` of
 * the windup: the bait hold sits there), `through` at the impact (it meets the opponent), `to` the
 * follow-through it whips on to. `yaw` = the body's turn at the three points (the hips lead the cut).
 * The strike itself (cock → impact) is the fast part: an ease-in snap through ~30 % of the windup.
 */
function slashKeys({ from, through, to, yaw: [y0, y1, y2], cock = 0.7, sink = 0, extra = {} }) {
  const dir = Math.sign(to[0] - from[0]) || 0; // the swing's turn: + toward his left
  const sw = (w, y) => [W2B(w[0], y), w[1]];
  const gy = (y0 + 0.62) / 2;
  return [
    // gathering: the blade begins its draw toward the cock, the weight settles back
    [cock * 0.45, { arm: 0.7, ext: 0.6, lead: 0.05 * dir, yaw: gy, sw: sw([from[0] * 0.55, from[1] * 0.55 + 0.08], gy), bY: -0.2 - sink * 0.5, bZ: -0.03, lH: [0.12, 0.02, 0.36], ...SET }],
    // cocked: wound up on the back foot, the free hand reaching forward for balance
    [cock, { arm: 1, ext: 0.5, lead: 0.22 * dir, yaw: y0, sw: sw(from, y0), bY: -0.24 - sink, bZ: -0.06, pitch: 0.08, hip: 0.1 * dir, lH: [0.16, -0.02, 0.38], lP: [0.7, -0.3, 0.3], ...SET, ...extra.cocked }],
    // the strike: the fist arrives first, the steel snaps through the opponent on a step in
    [1.0, { e: 'i', arm: 1, ext: 1, lead: 0, yaw: y1, sw: sw(through, y1), bY: -0.28 - sink, bZ: 0.1, pitch: 0.1, hip: -0.06 * dir, lH: [0.3, 0.06, -0.24], lP: [0.9, 0.1, -0.3], ...STEP_IN, ...extra.strike }],
    // follow-through: the blade whips past the fist and on round
    [1.6, { e: 'o', arm: 1, ext: 0.88, lead: -0.32 * dir, yaw: y2, sw: sw(to, y2), bY: -0.24 - sink, bZ: 0.08, pitch: 0.04, hip: -0.12 * dir, lH: [0.32, 0.1, -0.3], ...STEP_IN, ...extra.follow }],
    [2.0, { arm: 1, ext: 0.84, lead: -0.26 * dir, yaw: y2, sw: sw([to[0] * 0.94, to[1] * 0.9], y2), bY: -0.22 - sink, bZ: 0.06, lH: [0.3, 0.08, -0.26], ...STEP_IN }],
  ];
}

/** The cuts long strings are made of (world-relative blade paths, see slashKeys). */
const CUTS = {
  rise: { from: [-2.0, -0.62], through: [0.0, 0.05], to: [1.55, 0.95], yaw: [0.1, 0.5, 0.85], zone: { kind: 'sector', r: 2.15, ang: 0.95 } }, // low right → high left
  back: { from: [1.55, 0.8], through: [0.0, -0.02], to: [-1.75, -0.5], yaw: [0.95, 0.55, 0.12], zone: { kind: 'sector', r: 2.15, ang: 0.95 } }, // high left → low right
  flat: { from: [-1.95, 0.1], through: [0.0, 0.04], to: [1.75, 0.06], yaw: [0.05, 0.5, 0.95], zone: { kind: 'sector', r: 2.2, ang: 1.0 } }, // level, right → left
  flatBack: { from: [1.85, 0.14], through: [0.0, 0.04], to: [-1.8, 0.02], yaw: [1.0, 0.55, 0.1], zone: { kind: 'sector', r: 2.2, ang: 1.0 } }, // level, left → right
  diag: { from: [-1.2, 1.1], through: [0.0, 0.15], to: [1.4, -0.75], yaw: [0.25, 0.55, 0.9], zone: { kind: 'sector', r: 2.15, ang: 0.85 } }, // high right → low left
};
/** The overhead: raised two-handed, then a stepping chop (keyed hands: both on the grip). */
const overKeys = (cock = 0.7) => [
  [cock * 0.5, { ...RAISED, sw: [-0.2, 1.7], bY: -0.1, ...SET }],
  [cock, { ...RAISED, sw: [-0.2, 2.35], rF: [-0.12, 0.42], lF: [0.2, -0.28] }],
  [1.0, { ...CHOP, e: 'i' }],
  [1.6, { ...CHOP, e: 'o', bY: -0.34, pitch: 0.38, sw: [-0.12, -0.78] }],
  [2.0, { ...CHOP, bY: -0.32 }],
];

/** One beat of a long string: `kind` a CUTS entry, 'over' or 'thrust'; `extra` overrides any field. */
function cut(kind, tell, windup, damage, extra = {}) {
  if (kind === 'thrust') {
    return {
      tell, windup, active: 0.1, damage, knockback: tell === N ? 0.7 : 1.5, zone: { kind: 'line', r: 2.0, w: 0.7 },
      dash: { from: 0.7, to: 1.0, stop: 1.0, max: 2.2 }, keys: thrustKeys(1, extra.cock ?? 0.74), ...extra,
    };
  }
  if (kind === 'over') {
    return {
      tell, windup, active: 0.1, damage, knockback: 1.6, zone: { kind: 'sector', r: 2.3, ang: 0.5 },
      keys: overKeys(extra.cock ?? 0.7), ...extra,
    };
  }
  const K = CUTS[kind];
  return {
    tell, windup, active: 0.08, damage, knockback: tell === N ? 0.7 : 1.5, zone: K.zone,
    keys: slashKeys({ ...K, cock: extra.cock ?? 0.7 }), ...extra,
  };
}

/** A spin cut: wound up, then a full turn with the blade out level at his sword side (a ring). */
const spinKeys = (cock = 0.66, low = false) => {
  const B = low ? { ...CROUCH } : { bY: -0.22 };
  const out = { arm: 1, ext: 1, lead: 0, sw: low ? [-1.45, -0.44] : [-1.45, -0.04], lH: [0.3, low ? -0.12 : 0.04, 0.08], lP: [0.9, 0.1, -0.2] };
  return [
    [cock, { ...B, arm: 1, ext: 0.55, lead: -0.2, yaw: 1.2, sw: low ? [-2.1, -0.5] : [-2.15, -0.12], lH: [0.2, 0.02, 0.26], hdY: -1.0, ...(low ? {} : SET) }],
    [1.0, { ...B, ...out, e: 'i', yaw: 0.9, hdY: -0.6, ...(low ? {} : STEP_IN) }],
    [2.0, { ...B, ...out, e: 'l', yaw: 0.9 - TAU, hdY: -0.6, ...(low ? {} : STEP_IN) }],
    [2.001, { e: 'h', yaw: 0.9 }],
  ];
};

/** The perilous thrust (red, a mikiri can answer it): a deep coil, the blade drawn back low along his
 *  side, held a beat, then a long lunge. */
const PERIL_COIL = { ...COIL, bY: -0.34, bZ: -0.14, yaw: 0.95, rH: [-0.12, -0.32, -0.08], sw: [-1.0, -0.08], lH: [0.28, 0.06, 0.1], lP: [0.9, 0.2, -0.2], hdY: -0.8, rF: [-0.12, 0.34], lF: [0.2, -0.38] };
const PERIL_LUNGE = { ...LUNGE, bZ: 0.3, bY: -0.34, rF: [-0.08, 1.05], lF: [0.22, -0.68], lH: [0.2, 0.08, -0.44] };
const perilKeys = () => [[0.4, { ...PERIL_COIL }], [0.84, { ...PERIL_COIL, bY: -0.36, rH: [-0.14, -0.33, -0.1] }], [1.0, { ...PERIL_LUNGE, e: 'i' }], [1.6, { ...PERIL_LUNGE, e: 'o', bZ: 0.34 }], [2.0, { ...PERIL_LUNGE }]];

// ---------------------------------------------------------------- the moves
// PBZ-fast (owner, 2026-11-12: "very fast, PBZ-boss level"): a move's first hit winds up ~0.46–0.6 s
// (red ~0.65), the hits of a string ~0.34 s apart; every strike is a ~0.1 s snap out of its cock.
// The flash (TUNING.flashLead 0.3 s) is the timing cue. Each beat steps in on its own during its
// windup (brain.js close-in, `close` m at most: the first hit 2.4, later ones 1.2), so a cut is never
// thrown at air; `travel` / `dash` add their own root motion on top.
export const MOVES = {
  /** Plum Blossom Thrust: a coiled, lunging thrust from mid range. */
  plumThrust: {
    label: 'Plum Thrust', phase: 1, weight: [2.0, 1.6], cooldown: 2.5, band: [2.6, 6.8], recovery: 0.5,
    beats: [{
      tell: N, windup: 0.5, active: 0.1, damage: 18, knockback: 0.9, zone: { kind: 'line', r: 1.9, w: 0.7 },
      dash: { from: 0.7, to: 1.0, stop: 1.0, max: 4.8 }, close: 0, keys: thrustKeys(1, 0.72),
    }],
    recoveryKeys: [[0.45, { ...LUNGE, bY: -0.22, rH: [0.04, -0.1, 0.45], lH: [0.1, 0.12, -0.25] }]],
  },

  /** Falling Ash: the jian raised two-handed over the head, then a stepping overhead chop. */
  fallingAsh: {
    label: 'Falling Ash', phase: 1, weight: [1.6, 1.4], cooldown: 3, band: [0, 3.8], recovery: 0.55,
    beats: [{
      tell: B, windup: 0.6, active: 0.1, damage: 26, knockback: 1.6, zone: { kind: 'sector', r: 2.3, ang: 0.5 }, lock: true,
      keys: overKeys(0.72),
    }],
    recoveryKeys: [[0.5, { ...CHOP, two: 0.4, bY: -0.24, sw: [-0.3, -0.5], rH: [0.0, -0.32, 0.4] }]],
  },

  /** Falling Star: a leaping one-handed cut from high on his right, straight down through you. */
  fallingStar: {
    label: 'Falling Star', phase: 1, weight: [2.2, 1.8], cooldown: 3, band: [0, 4.2], recovery: 0.5,
    beats: [{
      tell: B, windup: 0.5, active: 0.1, damage: 24, knockback: 1.6, zone: { kind: 'sector', r: 2.3, ang: 0.6 }, lock: true,
      close: 2.8, lift: [[0.45, 0], [0.78, 0.32], [1.0, 0]],
      keys: slashKeys({ from: [-0.7, 1.45], through: [0.0, -0.1], to: [0.5, -1.0], yaw: [0.2, 0.45, 0.6], cock: 0.72, sink: 0.04 }),
    }],
    recoveryKeys: [[0.45, { arm: 1, ext: 0.8, sw: [-0.3, -0.7], bY: -0.26, ...STEP_IN }]],
  },

  /** Piercing Ash: a PERILOUS thrust (red). Dodge into it (mikiri) to step on the blade, or roll aside. */
  piercingAsh: {
    label: 'Piercing Ash', phase: 1, weight: [1.6, 1.8], cooldown: 5, band: [3.0, 9], recovery: 0.6,
    beats: [{
      tell: R, windup: 0.68, active: 0.12, damage: 30, knockback: 2.5, zone: { kind: 'line', r: 2.1, w: 0.7 }, mikiri: true,
      dash: { from: 0.84, to: 1.0, stop: 0.8, max: 6.5 }, close: 0, track: 0.82, keys: perilKeys(),
    }],
    recoveryKeys: [[0.45, { ...PERIL_LUNGE, bY: -0.26, rH: [0.04, -0.1, 0.45] }]],
  },

  /** Rain of Ashes: a seven-hit string that changes rhythm (a held overhead), ending on a heavy
   *  thrust. Parry all seven and he reels. The overhead can be locked. */
  ashRain: {
    label: 'Rain of Ashes', phase: 1, weight: [2.4, 2.2], cooldown: 7, band: [0, 3.6], recovery: 0.7,
    beats: [
      cut('rise', N, 0.46, 14),
      cut('back', N, 0.34, 13),
      cut('flat', N, 0.34, 13),
      cut('over', B, 0.4, 20, { hold: [0.1, 0.3], cock: 0.72, lock: true }),
      cut('diag', N, 0.36, 12),
      cut('flatBack', N, 0.34, 12),
      cut('thrust', B, 0.4, 20),
    ],
  },

  /** Swallow Flicks: a rising flick, a backhand flick, then a heavy thrust. */
  swallow: {
    label: 'Swallow Flicks', phase: 1, weight: [2.6, 2.2], cooldown: 3.5, band: [0, 3.8], recovery: 0.6,
    beats: [
      cut('rise', N, 0.46, 14),
      cut('back', N, 0.34, 14),
      cut('thrust', B, 0.4, 20),
    ],
  },

  /** Crane Spins: two spinning cuts, then a leaping two-handed chop. */
  crane: {
    label: 'Crane Spins', phase: 1, weight: [2.0, 2.0], cooldown: 5, band: [0, 3.6], recovery: 0.65,
    beats: [
      { tell: N, windup: 0.5, active: 0.18, damage: 15, knockback: 0.9, zone: { kind: 'ring', r: 2.2 }, track: 0.7, keys: spinKeys(0.66) },
      { tell: N, windup: 0.36, active: 0.18, damage: 15, knockback: 0.9, zone: { kind: 'ring', r: 2.2 }, track: 0.6, keys: spinKeys(0.6) },
      {
        tell: B, windup: 0.46, active: 0.1, damage: 24, knockback: 1.6, zone: { kind: 'sector', r: 2.4, ang: 0.55 }, lock: true,
        dash: { from: 0.45, to: 1.0, stop: 1.2, max: 3.0 }, close: 0, lift: [[0.42, 0], [0.75, 0.9], [1.0, 0]],
        keys: [
          [0.42, { two: 1, yaw: 0.2, bY: -0.34, rH: [0.1, -0.2, 0.3], sw: [0.0, 0.3], hdY: -0.1, rF: [-0.1, 0.28], lF: [0.16, -0.22] }],
          [0.75, { ...RAISED, yaw: 0.15, bY: 0.04, rF: [-0.1, 0.3], lF: [0.15, -0.1], rK: [-0.2, 0.2, 1], lK: [0.3, 0.2, 1] }],
          [1.0, { ...CHOP, e: 'i' }],
          [1.6, { ...CHOP, e: 'o', bY: -0.34, pitch: 0.38 }],
          [2.0, { ...CHOP }],
        ],
      },
    ],
    recoveryKeys: [[0.5, { ...CHOP, two: 0.3, bY: -0.24, sw: [-0.3, -0.45] }]],
  },

  /** Hesitating Blade: a feint (it never glints), a thrust held back a moment, maybe a flick after. */
  hesitate: {
    label: 'Hesitating Blade', phase: 1, weight: [1.8, 2.0], cooldown: 5, band: [0, 4.6], recovery: 0.6,
    beats: [
      {
        feint: true, windup: 0.4, active: 0.1, close: 1.0,
        keys: [
          [0.6, { ...COIL }],
          [1.0, { ...COIL, e: 'i', rH: [0.02, -0.12, 0.32], sw: [-0.5, 0.04], bZ: 0.04, bY: -0.2 }],
          [2.0, { ...COIL, bZ: -0.08, bY: -0.22 }],
        ],
      },
      {
        tell: B, windup: 0.42, hold: [0.2, 0.6], cock: 0.75, active: 0.1, damage: 22, knockback: 1.5,
        zone: { kind: 'line', r: 2.0, w: 0.7 }, dash: { from: 0.78, to: 1.0, stop: 1.0, max: 2.8 }, close: 0, track: 0.75,
        keys: [
          [0.4, { ...COIL, rH: [-0.09, -0.27, -0.02], bY: -0.24, yaw: 0.9 }],
          [0.75, { ...COIL, rH: [-0.1, -0.27, -0.03], bY: -0.25, yaw: 0.92 }],
          [1.0, { ...LUNGE, e: 'i' }],
          [1.6, { ...LUNGE, e: 'o', bZ: 0.26 }],
          [2.0, { ...LUNGE }],
        ],
      },
      { ...cut('rise', N, 0.34, 14), chance: 0.5 },
    ],
  },

  /** Lotus Sweep: dropping low, he spins the jian round at the ankles. Red: roll through it. */
  lotus: {
    label: 'Lotus Sweep', phase: 1, weight: [1.6, 1.6], cooldown: 6, band: [0, 3.4], recovery: 0.6,
    beats: [{
      tell: R, windup: 0.62, active: 0.22, damage: 22, knockback: 2.5, knockdown: true, zone: { kind: 'ring', r: 3.0 }, ring: 3.0, part: 'feet',
      track: 0.6, close: 1.2, keys: spinKeys(0.62, true),
    }],
    recoveryKeys: [[0.4, { ...CROUCH, bY: -0.36, yaw: 0.7, arm: 1, ext: 0.8, sw: [-0.9, -0.3] }]],
  },

  /** Wind Step: from far off he glides in low and cuts across. */
  windStep: {
    label: 'Wind Step', phase: 1, weight: [2.6, 2.6], cooldown: 3, band: [4.6, 13], recovery: 0.5,
    beats: [{
      tell: N, windup: 0.56, active: 0.1, damage: 18, knockback: 1.0, zone: { kind: 'sector', r: 2.2, ang: 1.0 },
      dash: { from: 0.3, to: 0.95, stop: 1.2, max: 10.5 }, close: 0, track: 0.5,
      keys: slashKeys({ from: [-2.2, -0.3], through: [0.0, 0.02], to: [1.6, 0.1], yaw: [0.4, 0.4, 0.9], cock: 0.8, sink: 0.08, extra: { cocked: { pitch: 0.2, bY: -0.32 } } }),
    }],
  },

  /** Ash Crescent: a cut that throws sword qi along the ground (P2: a fan of three). */
  ashCrescent: {
    label: 'Ash Crescent', phase: 1, weight: [1.0, 1.6], cooldown: 5, band: [6, 16], recovery: 0.5,
    beats: [{
      tell: N, windup: 0.5, active: 0.1, damage: 14, knockback: 0.8, release: { count: [1, 3], spread: 0.36 }, close: 0,
      keys: slashKeys({ from: [-1.2, 1.2], through: [0.0, -0.3], to: [1.0, -0.8], yaw: [0.3, 0.5, 0.8], cock: 0.7 }),
    }],
  },

  /** Riposte: his counter out of a guard: a diagonal cut, then a thrust. Only from the guard. */
  riposte: {
    label: 'Riposte', phase: 1, weight: [0, 0], counter: true, cooldown: 0, band: [0, 5], recovery: 0.55,
    beats: [
      cut('diag', N, 0.46, 16, { track: 0.7 }),
      cut('thrust', B, 0.36, 22),
    ],
  },

  // ---------------------------------------------------------------- phase 2
  /** Thousand Needles: a flurry of five thrusts, the last one heavy. */
  needles: {
    label: 'Thousand Needles', phase: 2, weight: [0, 2.6], cooldown: 6, band: [0, 3.8], recovery: 0.7,
    beats: [0.5, 0.34, 0.34, 0.34, 0.38].map((w, i, all) => {
      const last = i === all.length - 1, side = i % 2 ? 1 : -1;
      return {
        tell: last ? B : N, windup: w, active: 0.08, damage: last ? 18 : 10, knockback: last ? 1.5 : 0.4,
        zone: { kind: 'line', r: 1.95, w: 0.7 }, track: 0.7,
        ...(last ? { dash: { from: 0.65, to: 1.0, stop: 1.0, max: 2.2 }, close: 0 } : {}),
        keys: [
          [0.6, { ...COIL, rH: [-0.05, -0.22 + 0.05 * side, 0.08], sw: [-0.85, 0.04 + 0.08 * side], bY: -0.22 }],
          [1.0, { ...LUNGE, e: 'i', sw: [-0.3 + 0.08 * side, 0.02 + 0.08 * side], ...(last ? {} : { rF: [-0.08, 0.66], lF: [0.22, -0.46], bZ: 0.14 }) }],
          [1.6, { ...LUNGE, e: 'o', ...(last ? { bZ: 0.26 } : { rF: [-0.08, 0.66], lF: [0.22, -0.46], bZ: 0.12 }) }],
          [2.0, { ...LUNGE, ...(last ? {} : { rF: [-0.08, 0.66], lF: [0.22, -0.46], bZ: 0.1 }) }],
        ],
      };
    }),
  },

  /** Hundred Petals: ten hits, every direction, a held overhead in the middle, ending on a PERILOUS
   *  thrust: parry nine, then dodge into the last. */
  petals: {
    label: 'Hundred Petals', phase: 2, weight: [0, 2.6], cooldown: 9, band: [0, 3.6], recovery: 0.8,
    beats: [
      cut('rise', N, 0.5, 11),
      cut('back', N, 0.34, 11),
      cut('flat', N, 0.34, 11),
      cut('flatBack', N, 0.34, 11),
      cut('over', B, 0.4, 18, { hold: [0.1, 0.3], cock: 0.72, lock: true }),
      cut('diag', N, 0.36, 10),
      cut('rise', N, 0.34, 10),
      cut('back', N, 0.34, 10),
      cut('thrust', B, 0.36, 16),
      { tell: R, windup: 0.62, active: 0.12, damage: 26, knockback: 2.5, zone: { kind: 'line', r: 2.1, w: 0.7 }, mikiri: true, dash: { from: 0.84, to: 1.0, stop: 0.8, max: 2.6 }, close: 0, track: 0.7, keys: perilKeys() },
    ],
  },

  /** Ember Whirl: two spinning cuts walking forward, then a low burning spin (red). */
  emberWhirl: {
    label: 'Ember Whirl', phase: 2, weight: [0, 2.2], cooldown: 7, band: [0, 3.8], recovery: 0.65,
    beats: [
      { tell: N, windup: 0.5, active: 0.18, damage: 14, knockback: 0.9, zone: { kind: 'ring', r: 2.2 }, track: 0.65, keys: spinKeys(0.66) },
      { tell: N, windup: 0.36, active: 0.18, damage: 14, knockback: 0.9, zone: { kind: 'ring', r: 2.2 }, track: 0.65, keys: spinKeys(0.6) },
      {
        tell: R, windup: 0.6, active: 0.22, damage: 26, knockback: 3, knockdown: true, zone: { kind: 'ring', r: 3.4 }, ring: 3.4, part: 'feet',
        track: 0.5, close: 1.0, keys: spinKeys(0.62, true),
      },
    ],
    recoveryKeys: [[0.4, { ...CROUCH, bY: -0.36, yaw: 0.7, arm: 1, ext: 0.8, sw: [-0.9, -0.3] }]],
  },

  /** Heaven-Splitting Fall: a great leap; the red ring follows the hero, locks, and he comes down
   *  on it two-handed. Red: get out of the ring or roll as he lands. */
  heavenFall: {
    label: 'Heaven-Splitting Fall', phase: 2, weight: [0, 1.8], cooldown: 9, band: [4.2, 14], recovery: 0.75,
    beats: [{
      tell: R, windup: 1.15, active: 0.12, damage: 30, knockback: 4, knockdown: true, zone: { kind: 'ring', r: 2.6 }, ring: 2.6, part: 'feet',
      leap: { from: 0.36, lock: 0.66, apex: 3.6 }, track: 0.36, close: 0,
      keys: [
        [0.26, { two: 1, bY: -0.44, pitch: 0.18, yaw: 0.1, rH: [0.1, -0.22, 0.32], sw: [0.0, 0.35], rF: [-0.12, 0.25], lF: [0.15, -0.25], rK: [-0.2, 0.2, 1], lK: [0.3, 0.2, 1], hdY: -0.1 }],
        [0.36, { two: 1, bY: -0.1, pitch: -0.1, yaw: 0.1, rH: [0.1, 0.1, 0.22], sw: [0.0, 1.2], rF: [-0.1, 0.12], lF: [0.15, -0.12] }],
        [0.75, { ...RAISED, yaw: 0.1, bY: 0.05, sw: [0.0, 2.45], rF: [-0.1, 0.25], lF: [0.15, -0.05], rK: [-0.2, 0.3, 1], lK: [0.3, 0.3, 1] }],
        [0.9, { ...RAISED, yaw: 0.1, bY: 0.0, sw: [0.0, 2.6], rF: [-0.1, 0.2], lF: [0.15, -0.15] }],
        [1.0, { ...CHOP, e: 'i', bY: -0.36, pitch: 0.38, rF: [-0.12, 0.45], lF: [0.2, -0.42] }],
        [2.0, { ...CHOP, bY: -0.36, pitch: 0.38, rF: [-0.12, 0.45], lF: [0.2, -0.42] }],
      ],
    }],
    recoveryKeys: [[0.5, { ...CHOP, two: 0.4, bY: -0.3, sw: [-0.2, -0.6] }]],
  },

  /** The kindling: the phase-2 transition. He kneels, the blade kindles, a red shock ring. */
  kindle: {
    label: 'Kindling (phase 2)', phase: 2, weight: [0, 0], transition: true, cooldown: 0, band: [0, 99], recovery: 0.7,
    beats: [{
      tell: R, windup: 1.75, active: 0.15, damage: TUNING.transition.damage, knockback: TUNING.transition.knockback,
      zone: { kind: 'ring', r: TUNING.transition.ringRadius }, ring: TUNING.transition.ringRadius, part: 'feet', track: 0, close: 0,
      keys: [
        [0.4, { bY: -0.55, pitch: 0.1, yaw: 0.1, spX: 0.12, hdX: 0.35, rH: [0.05, -0.15, 0.3], sw: [0.0, 1.45], swF: [1, 0, 0], lH: [-0.08, -0.12, 0.3], rF: [-0.12, 0.3], lF: [0.15, -0.42], rK: [0, 0, 1], lK: [0.1, -0.8, 0.6] }],
        [0.85, { bY: -0.55, pitch: 0.06, yaw: 0.1, spX: 0.08, hdX: 0.1, rH: [0.05, -0.05, 0.3], sw: [0.0, 1.5], lH: [-0.1, -0.02, 0.28], rF: [-0.12, 0.3], lF: [0.15, -0.42], rK: [0, 0, 1], lK: [0.1, -0.8, 0.6] }],
        [1.0, { e: 'i', bY: -0.2, pitch: -0.1, yaw: 0.2, rH: [-0.28, -0.05, 0.25], sw: [-1.3, 0.2], swF: [0, 1, 0], lH: [0.3, 0.1, 0.1], rF: [-0.25, 0.3], lF: [0.25, -0.3] }],
        [2.0, { bY: -0.2, pitch: -0.1, yaw: 0.2, rH: [-0.3, -0.05, 0.25], sw: [-1.4, 0.2], lH: [0.3, 0.1, 0.1], rF: [-0.25, 0.3], lF: [0.25, -0.3] }],
      ],
    }],
  },
};
export const MOVE_NAMES = Object.keys(MOVES);

// ---------------------------------------------------------------- reaction clips (no hits)
const KNEEL = { bY: -0.52, pitch: 0.22, spX: 0.1, hdX: 0.5, rF: [-0.12, 0.32], lF: [0.17, -0.42], rK: [0, 0, 1], lK: [0.1, -0.85, 0.5], flat: 0.7 };
const SEIZA = {
  bY: -0.6, bZ: -0.06, pitch: 0.04, yaw: 0, hip: 0, spX: 0.08, spY: 0, hdX: 0.32, hdY: 0,
  rF: [-0.13, -0.36], lF: [0.13, -0.36], rK: [-0.05, -0.6, 0.8], lK: [0.05, -0.6, 0.8], rFy: 0, lFy: 0, flat: 0.2,
  rH: [0.08, -0.46, 0.26], rP: [-0.5, -0.2, -0.8], sw: [1.45, -0.06], swF: [0, 1, 0], lH: [-0.06, -0.46, 0.24], lP: [0.5, -0.2, -0.8],
};

export const CLIPS = {
  /** His guard: the wards that meet a strike, the deflect, the raised guard (duelist/guard.js). */
  ...GUARD_CLIPS,
  /** A light strike that lands outside his attacks. */
  flinch: { dur: 0.26, keys: [[0.07, { e: 'o', spX: -0.06, hdX: -0.12, bZ: -0.05, yaw: 0.46 }]] },
  /** Backstep out of reach. */
  backstep: { dur: 0.42, keys: [[0.12, { bY: -0.18, pitch: -0.08, ...STEP_BACK }], [0.32, { bY: -0.14, rF: [-0.1, 0.26], lF: [0.17, -0.3] }]] },
  /** Sidestep (out of a charged thrust's line). */
  sidestep: { dur: 0.36, keys: [[0.12, { bY: -0.2, roll: 0.08, rF: [-0.2, 0.25], lF: [0.25, -0.2] }]] },
  /** His guard crushed (a full-charge thrust) or a heavy blow: a stumble back. */
  stagger: {
    dur: 0.8,
    keys: [
      [0.12, { e: 'o', pitch: -0.2, bZ: -0.1, bY: -0.14, rH: [-0.3, -0.2, 0.1], sw: [-1.7, 0.2], swF: [0, 1, 0], lH: [0.3, 0.0, 0.1], hdX: -0.2, ...STEP_BACK }],
      [0.5, { pitch: -0.08, bY: -0.16, rH: [-0.25, -0.2, 0.2], sw: [-1.3, 0.1], lH: [0.25, 0.0, 0.2] }],
    ],
  },
  /** His last hit parried: the jian knocked up and back, a step back. The punish window. */
  recoil: {
    dur: 1.0,
    keys: [
      [0.1, { e: 'o', pitch: -0.24, bZ: -0.1, rH: [-0.1, 0.2, 0.15], rP: [-0.8, 0.4, -0.4], sw: [-0.5, 1.4], swF: [1, 0, 0], lH: [0.3, 0.05, 0.05], hdX: -0.2, ...STEP_BACK }],
      [0.6, { pitch: -0.12, rH: [-0.1, 0.05, 0.25], sw: [-0.6, 0.8], lH: [0.25, 0.1, 0.1] }],
    ],
  },
  /** Thrown off balance (a full deflect, a lost blade lock): the jian flung wide, arms out, two
   *  stumbling steps back before he finds his guard. The big opening. */
  reeling: {
    dur: 1.45,
    keys: [
      [0.12, { e: 'o', pitch: -0.32, bZ: -0.14, bY: -0.12, yaw: -0.2, rH: [-0.34, 0.05, 0.05], rP: [-0.9, 0.3, -0.3], sw: [-2.3, 0.45], swF: [0, 1, 0], lH: [0.32, 0.1, 0.0], lP: [0.9, 0.3, 0.0], hdX: -0.3, rF: [-0.12, 0.05], lF: [0.2, -0.5] }],
      [0.6, { pitch: -0.2, bY: -0.2, yaw: 0.0, rH: [-0.3, -0.05, 0.12], sw: [-2.0, 0.2], lH: [0.3, 0.0, 0.1], hdX: -0.1, rF: [-0.14, -0.15], lF: [0.18, -0.45] }],
      [1.1, { pitch: -0.05, bY: -0.18, rH: [-0.1, -0.1, 0.3], sw: [-0.9, 0.2], lH: [0.1, -0.05, 0.3] }],
    ],
  },
  /** Pinned by a mikiri: the hero's boot on his blade, he is dragged forward and down, then
   *  wrenches the jian free and stumbles back. */
  trampled: {
    dur: 1.5,
    keys: [
      [0.1, { e: 'o', pitch: 0.42, bY: -0.34, bZ: 0.1, rH: [0.02, -0.38, 0.45], rP: [-0.6, -0.6, 0.2], sw: [-0.25, -1.15], swF: [1, 0, 0], lH: [0.2, -0.2, 0.2], hdX: 0.45, rF: [-0.08, 0.7], lF: [0.22, -0.48] }],
      [0.75, { pitch: 0.35, bY: -0.3, rH: [0.0, -0.36, 0.42], sw: [-0.3, -1.1], hdX: 0.4 }],
      [1.0, { e: 'o', pitch: -0.2, bY: -0.16, bZ: -0.1, rH: [-0.25, 0.0, 0.15], sw: [-1.9, 0.3], swF: [0, 1, 0], lH: [0.3, 0.05, 0.05], hdX: -0.1, ...STEP_BACK }],
    ],
  },
  /** Blades locked: his jian pressed against the hero's, both hands on it, leaning in. Held until
   *  the push is decided (brain.js startLock / disciple.js onLockEnd). */
  lock: {
    dur: 3, hold: true,
    keys: [
      [0.1, { e: 'o', two: 0.8, bY: -0.22, bZ: 0.08, pitch: 0.12, yaw: 0.3, rH: [0.08, 0.0, 0.44], rP: [-0.7, -0.2, -0.3], sw: [0.5, 0.95], swF: [0, 0.3, -1], hdX: 0.1, hdY: -0.3, rF: [-0.1, 0.4], lF: [0.2, -0.42] }],
      [3, { two: 0.8, bY: -0.24, bZ: 0.1, pitch: 0.14, yaw: 0.3, rH: [0.08, 0.0, 0.45], sw: [0.46, 0.97], swF: [0, 0.3, -1], rF: [-0.1, 0.42], lF: [0.2, -0.44] }],
    ],
  },
  /** Posture broken: down on one knee, the jian's point on the stones, head bowed. */
  broken: {
    dur: 3.2, hold: true,
    keys: [
      [0.25, { e: 'o', ...KNEEL, rH: [-0.15, -0.4, 0.3], rP: [-0.7, -0.4, -0.3], sw: [-0.6, -1.0], swF: [1, 0, 0], lH: [0.05, -0.45, 0.15], lP: [0.6, -0.3, 0.3] }],
      [2.9, { ...KNEEL, hdX: 0.4, rH: [-0.15, -0.38, 0.3], sw: [-0.6, -0.95], lH: [0.05, -0.43, 0.15] }],
      [3.2, { ...KNEEL, bY: -0.4, hdX: 0.2, rH: [-0.1, -0.3, 0.32], sw: [-0.5, -0.6], lH: [0.05, -0.3, 0.2] }],
    ],
  },
  /** Executed: run through, he lurches, then rises and gives ground (the break is spent). */
  executed: {
    dur: 1.3,
    keys: [
      [0.0, { ...KNEEL, rH: [-0.15, -0.4, 0.3], sw: [-0.6, -1.0], lH: [0.05, -0.45, 0.15] }],
      [0.2, { e: 'o', ...KNEEL, pitch: -0.25, hdX: -0.3, bY: -0.45, rH: [-0.2, -0.3, 0.1], sw: [-1.2, -0.6], lH: [0.0, -0.1, 0.25] }],
      [0.7, { ...KNEEL, pitch: 0.3, hdX: 0.5, bY: -0.54, rH: [-0.15, -0.42, 0.28], sw: [-0.6, -1.05], lH: [0.0, -0.4, 0.25] }],
      [1.05, { ...KNEEL, bY: -0.3, hdX: 0.15, rH: [-0.1, -0.3, 0.3], sw: [-0.5, -0.6], lH: [0.05, -0.2, 0.2], ...STEP_BACK }],
    ],
  },
  /** Defeated: he sinks to his knees and plants the jian before him, head bowed. */
  death: {
    dur: 2.4, hold: true,
    keys: [
      [0.4, { e: 'o', ...KNEEL, pitch: 0.1, rH: [0.0, -0.3, 0.3], sw: [-0.3, -0.9], lH: [0.0, -0.3, 0.2] }],
      [1.2, { ...SEIZA, rH: [0.06, -0.18, 0.36], sw: [0.0, -1.5], swF: [1, 0, 0], two: 1, hdX: 0.55, pitch: 0.12 }],
      [2.4, { ...SEIZA, rH: [0.06, -0.18, 0.36], sw: [0.0, -1.5], swF: [1, 0, 0], two: 1, hdX: 0.7, pitch: 0.18 }],
    ],
  },
  /** Kneeling in meditation, the jian across his knees (asleep: the fight has not begun). */
  meditate: { dur: 1, hold: true, keys: [[0, { ...SEIZA }]] },
  /** The intro: he rises, flicks the jian, salutes fist-in-palm, and takes his guard. */
  intro: {
    dur: 2.8,
    keys: [
      [0, { ...SEIZA }],
      [0.25, { ...SEIZA, hdX: 0.05 }],
      [0.85, { bY: -0.12, yaw: 0.1, hdX: 0.05, rH: [0.0, -0.4, 0.15], sw: [-0.5, -0.9], swF: [1, 0, 0], lH: [0.08, -0.46, 0.05], rF: [-0.12, 0.12], lF: [0.14, -0.12] }],
      [1.15, { yaw: 0.4, rH: [0.15, 0.05, 0.35], sw: [1.1, 0.65], swF: [0, 1, 0], lH: [0.1, 0.25, -0.1] }],
      [1.45, { e: 'i', yaw: 0.2, rH: [-0.25, -0.15, 0.3], sw: [-1.6, 0.2], lH: [0.1, 0.27, -0.12] }],
      [1.75, { yaw: 0.0, bY: -0.04, pitch: 0.0, hdX: 0.0, rH: [0.06, -0.22, 0.24], rP: [-0.5, -0.6, -0.4], sw: [-0.2, -1.2], swF: [1, 0, 0], lH: [-0.1, -0.2, 0.26], lP: [0.6, -0.4, 0.3], rF: [-0.12, 0.05], lF: [0.12, -0.05] }],
      [2.3, { yaw: 0.0, bY: -0.05, pitch: 0.14, hdX: 0.2, rH: [0.06, -0.22, 0.24], sw: [-0.2, -1.2], swF: [1, 0, 0], lH: [-0.1, -0.2, 0.26], rF: [-0.12, 0.05], lF: [0.12, -0.05] }],
    ],
  },
};

/** Compiled reaction clips (build time). */
export const CLIP = Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, compileClip(c.keys.map(([t, pose]) => ({ t, ...pose })), c.dur, { hold: !!c.hold })]));
for (const [k, c] of Object.entries(CLIP)) c.name = k;

// ---------------------------------------------------------------- realising a move
/**
 * A move as it will play this time (duelist/realise.js): phase scaling, rolled chances, the bait
 * holds, absolute times per beat ({ start, impact, end, flash, tellAt }) and the compiled clip. `rnd`
 * = a 0..1 source (the game's Math.random, so the seeded sims replay).
 */
export const realise = makeRealise({ TUNING, MOVES, compileClip: (keys, dur) => compileClip(keys, dur) });

/** The guard pose (for tools). */
export { GUARD };
