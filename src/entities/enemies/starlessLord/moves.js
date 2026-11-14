import { TELL } from '../../../combat/rules.js';
import { DIM } from '../../player/model.js';
import { makeRealise } from '../duelist/realise.js';
import { FORM_POSES } from './poses.js';
import { TUNING } from './tuning.js';

// The Starless Lord's moves and reaction clips, as data (COMBAT.md → "The Starless Lord"). The format
// is the duelist's (ashDisciple/moves.js header; duelist/realise.js: `pick` alternatives, `fixed`
// windups). His own beat fields:
//   bolt: true            Void lightning: a long line zone from his casting hand (lord.js draws it)
//   pull: true            the Void pull: the hit drags the hero toward him instead of away
//   blink: { behind }     he vanishes as the windup starts and is behind the hero (lord.js beatMotion)
//   release: { style }    'push' (a wall of force) / 'crescent' (red sword-light) thrown at the impact
//   cast: { kind, ... }   'glaive' (the thrown blade), 'debris' (hurled stones), 'storm' (called lightning)
//   left: true            the off-hand blade strikes (form 2: its sweep trail, its glint)
// A move's `weight` is per FORM [1, 2, 3, 4] (0 = not in that form's moveset): each form has its own
// strings; a few spells are shared. Rules (checked by tests/integration/lord.mjs): a tell on every real
// hit, a move's first real windup >= TUNING.minFirstWindup in every form it is used in, impacts
// >= TUNING.minHitGap apart, feints never flash.

const N = TELL.NORMAL, B = TELL.BLUE, R = TELL.RED;
const TAU = Math.PI * 2;
const PIV = DIM.pivot;

// ---------------------------------------------------------------- pose fragments
// (body-space hand offsets / blade [az, el]; feet model space [x, z] or [x, y, z]; see duelist/poses.js)
const SET = { rF: [-0.12, 0.36], lF: [0.2, -0.3] };
const STEP_IN = { rF: [-0.12, 0.64], lF: [0.22, -0.4], rK: [-0.25, 0, 1], lK: [0.6, -0.2, 0.8], lFy: 0.95 };
const STEP_L = { lF: [0.14, 0.6], rF: [-0.2, -0.36], lK: [0.25, 0, 1], rK: [-0.6, -0.2, 0.8], rFy: -0.95, lFy: 0.25 }; // the left foot steps in
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
/** A world-relative blade direction [az, el] in body space at that body yaw. */
const w2b = (w, y) => [w[0] - y, w[1]];

/** Thrust keys: the blade drawn back along the body at the cock, driven home on a long lunge. */
const thrustKeys = (two = 0, cock = 0.74) => {
  const T = two ? { two: 1 } : {};
  return [
    [cock * 0.5, { ...COIL, ...T, bY: -0.18, rH: [-0.04, -0.18, 0.12] }],
    [cock, { ...COIL, ...T, rH: [-0.08, -0.24, -0.02], bY: -0.24 }],
    [1.0, { ...LUNGE, ...T, e: 'i' }],
    [1.6, { ...LUNGE, ...T, e: 'o', bZ: 0.26, rH: [0.05, -0.03, 0.58] }],
    [2.0, { ...LUNGE, ...T, bZ: 0.2 }],
  ];
};

/**
 * A cut with the MAIN blade, as the blade's path (duelist/poses.js `arm`: the hand follows it).
 * World-relative blade directions [az, el] (az 0 = at the opponent, + = his left): `from` where it is
 * cocked, `through` at the impact, `to` the follow-through; `yaw` = the body's turn at the three
 * points. `two`: both hands on the hilt.
 */
function slash({ from, through, to, yaw: [y0, y1, y2], cock = 0.7, sink = 0, two = 0, extra = {} }) {
  const dir = Math.sign(to[0] - from[0]) || 0;
  const gy = (y0 + 0.5) / 2;
  const T = two ? { two: 1 } : {};
  const free = (v) => (two ? {} : { lH: v });
  return [
    [cock * 0.45, { ...T, arm: 0.7, ext: 0.6, lead: 0.05 * dir, yaw: gy, sw: w2b([from[0] * 0.55, from[1] * 0.55 + 0.08], gy), bY: -0.2 - sink * 0.5, bZ: -0.03, ...free([0.12, 0.02, 0.36]), ...SET }],
    [cock, { ...T, arm: 1, ext: 0.5, lead: 0.22 * dir, yaw: y0, sw: w2b(from, y0), bY: -0.24 - sink, bZ: -0.06, pitch: 0.08, hip: 0.1 * dir, ...free([0.16, -0.02, 0.38]), ...SET, ...extra.cocked }],
    [1.0, { ...T, e: 'i', arm: 1, ext: 1, lead: 0, yaw: y1, sw: w2b(through, y1), bY: -0.28 - sink, bZ: 0.1, pitch: 0.1, hip: -0.06 * dir, ...free([0.3, 0.06, -0.24]), ...STEP_IN, ...extra.strike }],
    [1.6, { ...T, e: 'o', arm: 1, ext: 0.88, lead: -0.32 * dir, yaw: y2, sw: w2b(to, y2), bY: -0.24 - sink, bZ: 0.08, pitch: 0.04, hip: -0.12 * dir, ...free([0.32, 0.1, -0.3]), ...STEP_IN, ...extra.follow }],
    [2.0, { ...T, arm: 1, ext: 0.84, lead: -0.26 * dir, yaw: y2, sw: w2b([to[0] * 0.94, to[1] * 0.9], y2), bY: -0.22 - sink, bZ: 0.06, ...free([0.3, 0.08, -0.26]), ...STEP_IN }],
  ];
}

/** The same with the OFF-HAND blade (form 2): `lsw` and the left arm driven by it. */
function slashL({ from, through, to, yaw: [y0, y1, y2], cock = 0.7, sink = 0 }) {
  const dir = Math.sign(to[0] - from[0]) || 0;
  const gy = (y0 + 0.22) / 2;
  return [
    [cock * 0.45, { larm: 0.7, lext: 0.6, llead: 0.05 * dir, yaw: gy, lsw: w2b([from[0] * 0.55, from[1] * 0.55 + 0.08], gy), bY: -0.2 - sink * 0.5, bZ: -0.03 }],
    [cock, { larm: 1, lext: 0.5, llead: 0.22 * dir, yaw: y0, lsw: w2b(from, y0), bY: -0.24 - sink, bZ: -0.06, pitch: 0.08, hip: 0.1 * dir }],
    [1.0, { e: 'i', larm: 1, lext: 1, llead: 0, yaw: y1, lsw: w2b(through, y1), bY: -0.28 - sink, bZ: 0.1, pitch: 0.1, hip: -0.06 * dir, ...STEP_L }],
    [1.6, { e: 'o', larm: 1, lext: 0.88, llead: -0.32 * dir, yaw: y2, lsw: w2b(to, y2), bY: -0.24 - sink, bZ: 0.08, pitch: 0.04, hip: -0.12 * dir, ...STEP_L }],
    [2.0, { larm: 1, lext: 0.84, llead: -0.26 * dir, yaw: y2, lsw: w2b([to[0] * 0.94, to[1] * 0.9], y2), bY: -0.22 - sink, bZ: 0.06, ...STEP_L }],
  ];
}

/** The blade paths strings are made of (world-relative, see slash). */
const PATHS = {
  rise: { from: [-2.0, -0.62], through: [0.0, 0.05], to: [1.55, 0.95], yaw: [0.1, 0.5, 0.85], ang: 0.95 }, // low right → high left
  back: { from: [1.55, 0.8], through: [0.0, -0.02], to: [-1.75, -0.5], yaw: [0.95, 0.55, 0.12], ang: 0.95 }, // high left → low right
  flat: { from: [-1.95, 0.1], through: [0.0, 0.04], to: [1.75, 0.06], yaw: [0.05, 0.5, 0.95], ang: 1.0 }, // level, right → left
  flatBack: { from: [1.85, 0.14], through: [0.0, 0.04], to: [-1.8, 0.02], yaw: [1.0, 0.55, 0.1], ang: 1.0 }, // level, left → right
  diag: { from: [-1.2, 1.1], through: [0.0, 0.15], to: [1.4, -0.75], yaw: [0.25, 0.55, 0.9], ang: 0.85 }, // high right → low left
};
/** The off-hand blade's paths: the mirror images (it starts on his left). */
const mirror = (P) => ({ from: [-P.from[0], P.from[1]], through: [-P.through[0], P.through[1]], to: [-P.to[0], P.to[1]], yaw: P.yaw.map((y) => 0.3 - y), ang: P.ang });
const PATHS_L = Object.fromEntries(Object.entries(PATHS).map(([k, P]) => [k, mirror(P)]));

/** The overhead: raised two-handed, then a stepping chop. */
const overKeys = (cock = 0.7) => [
  [cock * 0.5, { ...RAISED, sw: [-0.2, 1.7], bY: -0.1, ...SET }],
  [cock, { ...RAISED, sw: [-0.2, 2.35], rF: [-0.12, 0.42], lF: [0.2, -0.28] }],
  [1.0, { ...CHOP, e: 'i' }],
  [1.6, { ...CHOP, e: 'o', bY: -0.34, pitch: 0.38, sw: [-0.12, -0.78] }],
  [2.0, { ...CHOP, bY: -0.32 }],
];

/** A spin: wound up, then a full turn with the blade(s) out level (a ring). `twin`: both blades out;
 *  `two`: the staff held level across him (both its blades sweep). */
const spinKeys = (cock = 0.66, { low = false, twin = false, two = 0 } = {}) => {
  const Bd = low ? { ...CROUCH } : { bY: -0.22 };
  const T = two ? { two: 1 } : {};
  const out = { ...T, arm: 1, ext: 1, lead: 0, sw: low ? [-1.45, -0.44] : [-1.45, -0.04], ...(twin ? { larm: 1, lext: 1, llead: 0, lsw: low ? [1.45, -0.44] : [1.45, -0.04] } : two ? {} : { lH: [0.3, low ? -0.12 : 0.04, 0.08], lP: [0.9, 0.1, -0.2] }) };
  return [
    [cock, { ...Bd, ...T, arm: 1, ext: 0.55, lead: -0.2, yaw: 1.2, sw: low ? [-2.1, -0.5] : [-2.15, -0.12], ...(twin ? { larm: 1, lext: 0.55, lsw: low ? [0.9, -0.5] : [0.85, -0.12] } : {}), hdY: -1.0, ...(low ? {} : SET) }],
    [1.0, { ...Bd, ...out, e: 'i', yaw: 0.9, hdY: -0.6, ...(low ? {} : STEP_IN) }],
    [2.0, { ...Bd, ...out, e: 'l', yaw: 0.9 - TAU, hdY: -0.6, ...(low ? {} : STEP_IN) }],
    [2.001, { e: 'h', yaw: 0.9 }],
  ];
};

/** A foot's model-space target for a body pitched th rad forward round the waist (a flip: the legs
 *  go round with the body), the leg tucked to length L. */
const flipFoot = (th, x, L = 0.5) => [x, PIV - 0.12 - L * Math.cos(th), -L * Math.sin(th)];
/** The somersault: a crouch, a forward flip in the air (the beat's `lift` carries him up), and a
 *  two-handed chop as he lands. */
function flipKeys({ cock = 0.36 } = {}) {
  const air = (u, th, sw, e = 'l') => [u, { e, two: 1, pitch: th, bY: -0.08, rH: [0.1, 0.2, 0.16], sw, rF: flipFoot(th, -0.1), lF: flipFoot(th, 0.12), rK: [-0.2, 0.4, 1], lK: [0.2, 0.4, 1], flat: 0 }];
  const u = (k) => cock + (1 - cock) * k;
  return [
    [cock * 0.6, { two: 1, bY: -0.42, pitch: 0.2, yaw: 0.1, rH: [0.08, -0.2, 0.3], sw: [0.0, 0.4], rF: [-0.12, 0.25], lF: [0.15, -0.25], rK: [-0.2, 0.2, 1], lK: [0.3, 0.2, 1] }],
    air(cock, 0.3, [0.0, 1.3], 'o'),
    air(u(0.3), TAU * 0.3, [0.0, 2.2]),
    air(u(0.6), TAU * 0.62, [0.0, 2.5]),
    air(u(0.86), TAU * 0.9, [0.0, 2.3]),
    [1.0, { ...CHOP, e: 'l', pitch: TAU + 0.32 }],
    [1.001, { e: 'h', pitch: 0.32 }],
    [1.6, { ...CHOP, e: 'o', bY: -0.34, pitch: 0.38, sw: [-0.12, -0.78] }],
    [2.0, { ...CHOP, bY: -0.32 }],
  ];
}
const FLIP_LIFT = (cock = 0.36, apex = 1.5) => [[cock, 0], [cock + (1 - cock) * 0.5, apex], [1.0, 0]];

/** The perilous thrust (red; a mikiri answers it): a deep coil, held a beat, then a long lunge. */
const PERIL_COIL = { ...COIL, bY: -0.34, bZ: -0.14, yaw: 0.95, rH: [-0.12, -0.32, -0.08], sw: [-1.0, -0.08], lH: [0.28, 0.06, 0.1], lP: [0.9, 0.2, -0.2], hdY: -0.8, rF: [-0.12, 0.34], lF: [0.2, -0.38] };
const PERIL_LUNGE = { ...LUNGE, bZ: 0.3, bY: -0.34, rF: [-0.08, 1.05], lF: [0.22, -0.68], lH: [0.2, 0.08, -0.44] };
const perilKeys = (two = 0) => {
  const T = two ? { two: 1 } : {};
  return [[0.4, { ...PERIL_COIL, ...T }], [0.84, { ...PERIL_COIL, ...T, bY: -0.36, rH: [-0.14, -0.33, -0.1] }], [1.0, { ...PERIL_LUNGE, ...T, e: 'i' }], [1.6, { ...PERIL_LUNGE, ...T, e: 'o', bZ: 0.34 }], [2.0, { ...PERIL_LUNGE, ...T }]];
};

// ---------------------------------------------------------------- the casting hand
/** The Void push: the free hand drawn back to the hip, then the palm thrown forward. */
const pushKeys = () => [
  [0.55, { two: 0, yaw: 0.7, bY: -0.22, bZ: -0.06, lH: [0.16, -0.3, 0.02], lP: [0.9, -0.3, -0.5], rH: [-0.1, -0.24, 0.12], sw: [-1.3, 0.2], hdY: -0.6, ...SET }],
  [1.0, { e: 'i', two: 0, yaw: 0.05, bY: -0.26, bZ: 0.12, pitch: 0.12, lH: [0.0, -0.02, 0.54], lP: [0.7, -0.5, 0.2], rH: [-0.16, -0.28, -0.05], sw: [-1.9, -0.1], hdY: -0.05, ...STEP_L }],
  [2.0, { two: 0, yaw: 0.05, bY: -0.24, bZ: 0.1, lH: [0.0, 0.0, 0.52], rH: [-0.16, -0.28, -0.05], sw: [-1.9, -0.1], ...STEP_L }],
];
/** Void lightning: the hand raised by the shoulder, crackling, then levelled at the hero. */
const boltKeys = (cock = 0.7) => [
  [cock, { two: 0, yaw: 0.55, bY: -0.16, pitch: -0.04, lH: [0.22, 0.14, 0.16], lP: [0.9, 0.1, -0.4], rH: [-0.08, -0.26, 0.16], sw: [-1.2, -0.3], hdY: -0.5 }],
  [1.0, { e: 'i', two: 0, yaw: 0.12, bY: -0.2, bZ: 0.06, pitch: 0.06, lH: [0.02, 0.03, 0.54], lP: [0.7, -0.4, 0.1], rH: [-0.12, -0.28, 0.05], sw: [-1.5, -0.3], hdY: -0.1 }],
  [2.0, { two: 0, yaw: 0.12, bY: -0.2, bZ: 0.06, lH: [0.02, 0.03, 0.54], rH: [-0.12, -0.28, 0.05], sw: [-1.5, -0.3] }],
];
/** The Void pull: the hand reaches out, closes, and is wrenched back to his chest. */
const pullKeys = () => [
  [0.6, { two: 0, yaw: 0.15, bY: -0.2, bZ: 0.08, lH: [0.02, 0.02, 0.54], lP: [0.7, -0.4, 0.1], rH: [-0.1, -0.2, 0.2], sw: [-1.1, 0.5], hdY: -0.1 }],
  [0.9, { two: 0, yaw: 0.15, bY: -0.22, bZ: 0.1, lH: [0.02, 0.0, 0.55], rH: [-0.1, -0.2, 0.2], sw: [-1.1, 0.5] }],
  [1.0, { e: 'i', two: 0, yaw: 0.6, bY: -0.2, bZ: -0.1, pitch: -0.1, lH: [0.12, -0.12, 0.12], lP: [0.9, -0.2, -0.5], rH: [-0.04, 0.0, 0.3], sw: [-0.5, 1.3], hdY: -0.5, ...STEP_BACK }],
  [2.0, { two: 0, yaw: 0.6, bY: -0.2, bZ: -0.1, lH: [0.12, -0.12, 0.12], rH: [-0.04, 0.0, 0.3], sw: [-0.5, 1.3], ...STEP_BACK }],
];
/** Hurled stones: the hand sweeps up from the floor (they rise with it), then is flung forward. */
const hurlKeys = () => [
  [0.3, { two: 0, yaw: 0.4, bY: -0.34, pitch: 0.14, lH: [0.2, -0.46, 0.2], lP: [0.9, -0.4, 0], rH: [-0.1, -0.24, 0.16], sw: [-1.2, 0.1], hdX: 0.2 }],
  [0.85, { two: 0, yaw: 0.5, bY: -0.12, pitch: -0.1, lH: [0.2, 0.42, 0.14], lP: [0.9, 0.3, -0.3], rH: [-0.1, -0.24, 0.16], sw: [-1.2, 0.1], hdX: -0.12 }],
  [1.0, { e: 'i', two: 0, yaw: 0.05, bY: -0.24, bZ: 0.1, pitch: 0.12, lH: [0.0, 0.0, 0.54], lP: [0.7, -0.5, 0.2], rH: [-0.14, -0.26, 0.0], sw: [-1.7, -0.1], ...STEP_L }],
  [2.0, { two: 0, yaw: 0.05, bY: -0.22, bZ: 0.08, lH: [0.0, 0.0, 0.52], rH: [-0.14, -0.26, 0.0], sw: [-1.7, -0.1], ...STEP_L }],
];
/** Called lightning: the blade and the free hand both thrown up to the sky. */
const stormKeys = () => [
  [0.5, { two: 0, yaw: 0.2, bY: -0.3, pitch: 0.12, lH: [0.14, -0.3, 0.2], rH: [-0.1, -0.3, 0.2], sw: [-0.6, -0.4], hdX: 0.2 }],
  [1.0, { e: 'i', two: 0, yaw: 0.1, bY: -0.04, pitch: -0.16, lH: [0.2, 0.5, 0.02], lP: [0.9, 0.5, -0.2], rH: [-0.16, 0.46, 0.06], rP: [-0.9, 0.4, -0.2], sw: [-0.1, 1.5], hdX: -0.3, spX: -0.1 }],
  [2.0, { two: 0, yaw: 0.1, bY: -0.04, pitch: -0.16, lH: [0.2, 0.5, 0.02], rH: [-0.16, 0.46, 0.06], sw: [-0.1, 1.5], hdX: -0.3 }],
];
/** The thrown blade: wound far back across the body, then flung flat. */
const throwKeys = () => [
  [0.7, { two: 0, arm: 1, ext: 0.5, lead: 0.2, yaw: 1.15, bY: -0.24, bZ: -0.08, sw: w2b([2.4, 0.1], 1.15), hdY: -1.0, ...SET }],
  [1.0, { e: 'i', two: 0, arm: 1, ext: 1, lead: 0, yaw: 0.0, bY: -0.26, bZ: 0.14, pitch: 0.12, sw: w2b([0.0, 0.0], 0.0), hdY: 0, ...STEP_IN }],
  [2.0, { two: 0, arm: 0.6, ext: 0.8, yaw: -0.2, bY: -0.22, bZ: 0.1, sw: w2b([-0.9, -0.2], -0.2), ...STEP_IN }],
];

// ---------------------------------------------------------------- beat builders
/** The reach of each form's blade: sector / ring radius, a thrust's line. */
const REACH = [0, 2.3, 2.3, 2.95, 2.6];

/** One beat of a string. `kind`: a PATHS name, 'over', 'thrust', 'flip'; `o`: { form, left, ...overrides }. */
function cut(kind, tell, windup, damage, o = {}) {
  const { form = 1, left = false, ...extra } = o;
  const two = form >= 3 ? 1 : 0, r = REACH[form];
  const kb = tell === N ? 0.7 : 1.5;
  if (kind === 'thrust') {
    return { tell, windup, active: 0.1, damage, knockback: kb, zone: { kind: 'line', r: r - 0.25, w: 0.7 }, dash: { from: 0.7, to: 1.0, stop: 1.0, max: 2.4 }, keys: thrustKeys(two, extra.cock ?? 0.74), ...extra };
  }
  if (kind === 'over') {
    return { tell, windup, active: 0.1, damage, knockback: 1.6, zone: { kind: 'sector', r: r + 0.05, ang: 0.5 }, keys: overKeys(extra.cock ?? 0.7), ...extra };
  }
  if (kind === 'flip') {
    const cock = extra.cock ?? 0.36;
    return { tell, windup, active: 0.1, damage, knockback: 1.8, zone: { kind: 'sector', r: r + 0.1, ang: 0.6 }, close: 2.6, lift: FLIP_LIFT(cock, 1.5), track: 0.5, keys: flipKeys({ cock }), ...extra, cock };
  }
  const P = (left ? PATHS_L : PATHS)[kind];
  const keys = left ? slashL({ ...P, cock: extra.cock ?? 0.7 }) : slash({ ...P, cock: extra.cock ?? 0.7, two });
  return { tell, windup, active: 0.08, damage, knockback: kb, zone: { kind: 'sector', r, ang: P.ang }, keys, ...(left ? { left: true, part: 'off' } : {}), ...extra };
}

/** A spinning cut (a ring round him). */
const spin = (tell, windup, damage, o = {}) => {
  const { form = 1, low = false, cock = 0.64, ...extra } = o;
  const r = REACH[form] + (low ? 0.6 : 0);
  return {
    tell, windup, active: low ? 0.22 : 0.18, damage, knockback: low ? 2.6 : 0.9, zone: { kind: 'ring', r }, track: 0.65,
    ...(low ? { knockdown: true, ring: r, part: 'feet', close: 1.2 } : {}),
    keys: spinKeys(cock, { low, twin: form === 2, two: form >= 3 ? 1 : 0 }), ...extra,
  };
};

/** Void lightning as a beat: a long line from his hand. Parry it (a perfect parry sends it back). */
const bolt = (windup, damage = 22, o = {}) => ({
  tell: B, windup, active: 0.08, damage, knockback: 1.4, zone: { kind: 'line', r: TUNING.bolt.range, w: TUNING.bolt.width }, bolt: true, part: 'hand',
  track: 0.92, close: 0, keys: boltKeys(o.cock ?? 0.7), ...o,
});
/** The Void push as a beat: a wall of force thrown along the ground. */
const push = (windup, o = {}) => ({ tell: N, windup, active: 0.1, damage: 15, knockback: 6.5, release: { style: 'push' }, part: 'hand', close: 0, track: 0.85, keys: pushKeys(), ...o });
/** The Void pull as a beat: red; the hero is dragged to him. */
const pull = (windup, o = {}) => ({
  tell: R, windup, active: 0.1, damage: 5, knockback: TUNING.pull.drag, zone: { kind: 'line', r: TUNING.pull.range, w: 2.4 }, pull: true, part: 'hand',
  track: 0.9, close: 0, keys: pullKeys(), ...o,
});

/** The ignition of a blade form (a transition): he rises, the blades light, a red shock ring. */
const ignite = (form) => ({
  label: `Ignition (form ${form})`, phase: form, weight: 0, transition: true, cooldown: 0, band: [0, 99], recovery: 0.6,
  beats: [{
    tell: R, windup: 2.1, fixed: true, active: 0.15, damage: TUNING.ignite.damage, knockback: TUNING.ignite.knockback,
    zone: { kind: 'ring', r: TUNING.ignite.ringRadius }, ring: TUNING.ignite.ringRadius, part: 'feet', track: 0, close: 0,
    keys: [
      // on one knee, run through; the hilt(s) held low
      [0.0, { two: 0, bY: -0.52, pitch: 0.24, yaw: 0.1, spX: 0.12, hdX: 0.5, rH: [-0.12, -0.42, 0.26], sw: [-0.5, -1.0], lH: [0.08, -0.44, 0.16], rF: [-0.12, 0.3], lF: [0.15, -0.42], rK: [0, 0, 1], lK: [0.1, -0.8, 0.6] }],
      [0.4, { two: 0, bY: -0.5, pitch: 0.2, yaw: 0.1, hdX: 0.4, rH: [-0.12, -0.4, 0.26], sw: [-0.5, -1.0], lH: [0.08, -0.42, 0.16], rF: [-0.12, 0.3], lF: [0.15, -0.42], rK: [0, 0, 1], lK: [0.1, -0.8, 0.6] }],
      // he stands, the arms cross low before him
      [0.8, { two: 0, bY: -0.1, pitch: 0.1, yaw: 0.05, hdX: 0.25, rH: [0.1, -0.3, 0.3], sw: [0.6, -0.6], lH: [-0.08, -0.3, 0.3], lsw: [-0.6, -0.6], rF: [-0.16, 0.05], lF: [0.16, -0.05] }],
      // and are thrown wide as the blades ignite
      [1.0, { e: 'i', two: 0, bY: -0.04, pitch: -0.18, yaw: 0.05, hdX: -0.25, spX: -0.1, rH: [-0.36, -0.12, 0.1], rP: [-0.9, 0.2, -0.3], sw: [-1.5, 0.35], lH: [0.36, -0.12, 0.1], lP: [0.9, 0.2, -0.3], lsw: [1.5, 0.35], rF: [-0.24, 0.05], lF: [0.24, -0.05] }],
      [2.0, { two: 0, bY: -0.04, pitch: -0.18, yaw: 0.05, hdX: -0.25, rH: [-0.36, -0.12, 0.1], sw: [-1.5, 0.35], lH: [0.36, -0.12, 0.1], lsw: [1.5, 0.35], rF: [-0.24, 0.05], lF: [0.24, -0.05] }],
    ],
  }],
});

// ---------------------------------------------------------------- the moves
// Weights are [form 1, form 2, form 3, form 4]. Authored at form 1's pace (a string's hits 0.34 s
// apart); TUNING.windupScale tightens the later forms to ~0.28 s.
const W = (f, w) => [1, 2, 3, 4].map((k) => (k === f ? w : 0));

export const MOVES = {
  // ============================================================== form 1: one blade, the free hand casts
  /** Crimson Litany: six cuts from every side; the fourth is a held overhead or a thrust, the last
   *  a somersault chop or a flat cut into a heavy thrust. */
  litany: {
    label: 'Crimson Litany', phase: 1, weight: W(1, 2.6), cooldown: 6, band: [0, 3.8], recovery: 0.65,
    beats: [
      cut('rise', N, 0.48, 13),
      cut('back', N, 0.34, 12),
      cut('flat', N, 0.34, 12),
      { pick: [cut('over', B, 0.42, 20, { hold: [0.1, 0.3], cock: 0.72, lock: true }), cut('thrust', B, 0.4, 19)] },
      cut('diag', N, 0.36, 12),
      { pick: [cut('flip', B, 0.6, 24, { lock: true }), cut('flatBack', N, 0.34, 12)] },
      cut('thrust', B, 0.4, 19, { chance: 0.5 }),
    ],
  },
  /** Void Cadence: cuts with the Void between them: two cuts, the push, two more, a heavy thrust. */
  cadence: {
    label: 'Void Cadence', phase: 1, weight: W(1, 2.4), cooldown: 7, band: [0, 4.2], recovery: 0.65,
    beats: [
      cut('flat', N, 0.5, 13),
      cut('back', N, 0.34, 12),
      push(0.55, { fixed: true }),
      cut('rise', N, 0.46, 12),
      cut('diag', N, 0.34, 12),
      { pick: [cut('thrust', B, 0.4, 20), bolt(0.62, 20, { fixed: true })] },
    ],
  },
  /** Starless Lunge: a coiled thrust that covers ground. */
  lunge: {
    label: 'Starless Lunge', phase: 1, weight: [2.0, 0, 0, 1.4], cooldown: 2.5, band: [2.6, 7], recovery: 0.5, gapCloser: true,
    beats: [{ ...cut('thrust', N, 0.5, 17, { cock: 0.72 }), dash: { from: 0.7, to: 1.0, stop: 1.0, max: 5.0 }, close: 0 }],
  },
  /** Falling Star: a somersault over the gap and a two-handed chop where he lands. */
  skyfall: {
    label: 'Falling Star', phase: 1, weight: [2.0, 1.6, 0, 2.0], cooldown: 4, band: [2.2, 7.5], recovery: 0.55, gapCloser: true,
    beats: [{ ...cut('flip', B, 0.72, 26, { lock: true, cock: 0.34 }), dash: { from: 0.34, to: 0.98, stop: 1.3, max: 5.5 }, close: 0 }],
  },
  /** Reaping Arc: dropping low, the blade swept round at the ankles. Red: roll through it. */
  reap: {
    label: 'Reaping Arc', phase: 1, weight: [1.5, 0, 0, 0], cooldown: 6, band: [0, 3.4], recovery: 0.6,
    beats: [spin(R, 0.62, 22, { low: true, form: 1, cock: 0.62 })],
  },
  /** Void Lightning: levelled from the free hand. Parry it; a perfect parry sends it back. */
  voidBolt: {
    label: 'Void Lightning', phase: 1, weight: [1.8, 1.4, 1.4, 0], cooldown: 5, band: [4.5, 16], recovery: 0.5, gapCloser: true,
    beats: [bolt(0.78, 24), { ...bolt(0.5, 22), chance: 0.5 }],
  },
  /** Void Push: a wall of force along the floor. Cut it with a parry, or roll through. */
  voidPush: {
    label: 'Void Push', phase: 1, weight: [1.6, 1.2, 1.6, 1.2], cooldown: 5, band: [2.5, 11], recovery: 0.5,
    beats: [push(0.62)],
  },
  /** Grasp and Sever: the Void drags you to him (red: roll), and a two-handed chop is waiting. */
  grasp: {
    label: 'Grasp and Sever', phase: 1, weight: [1.4, 1.0, 1.2, 1.6], cooldown: 8, band: [4.5, 10.5], recovery: 0.6, gapCloser: true,
    beats: [pull(0.8, { fixed: true }), cut('over', B, 0.62, 24, { lock: true, fixed: true, cock: 0.7 })],
  },
  /** His counter out of a guard (form 1): a diagonal cut, then a thrust. */
  riposte: {
    label: 'Riposte', phase: 1, weight: 0, counter: true, cooldown: 0, band: [0, 5], recovery: 0.55,
    beats: [cut('diag', N, 0.46, 15, { track: 0.7 }), cut('thrust', B, 0.36, 21)],
  },

  // ============================================================== form 2: twin blades
  /** Twin Tempest: the blades alternate, seven cuts in a breath; the fifth is both at once. */
  tempest: {
    label: 'Twin Tempest', phase: 2, weight: W(2, 2.8), cooldown: 6, band: [0, 3.8], recovery: 0.65,
    beats: [
      cut('rise', N, 0.48, 11, { form: 2 }),
      cut('rise', N, 0.34, 11, { form: 2, left: true }),
      cut('flat', N, 0.34, 11, { form: 2 }),
      cut('flat', N, 0.34, 11, { form: 2, left: true }),
      { pick: [cut('over', B, 0.42, 20, { form: 2, hold: [0.1, 0.28], cock: 0.72, lock: true }), cut('thrust', B, 0.4, 18, { form: 2 })] },
      cut('diag', N, 0.36, 11, { form: 2, left: true }),
      cut('back', N, 0.34, 11, { form: 2 }),
    ],
  },
  /** Bladed Gale: two whirling rings, two rising cuts, and the somersault. */
  gale: {
    label: 'Bladed Gale', phase: 2, weight: W(2, 2.4), cooldown: 7, band: [0, 3.8], recovery: 0.65,
    beats: [
      spin(N, 0.5, 13, { form: 2 }),
      spin(N, 0.36, 13, { form: 2, cock: 0.6 }),
      cut('rise', N, 0.36, 11, { form: 2 }),
      cut('back', N, 0.34, 11, { form: 2, left: true }),
      { pick: [cut('flip', B, 0.6, 24, { form: 2, lock: true }), spin(R, 0.62, 22, { form: 2, low: true, cock: 0.62 })] },
    ],
  },
  /** Scissor: both blades thrust home on a dash. */
  scissor: {
    label: 'Scissor', phase: 2, weight: W(2, 2.0), cooldown: 3, band: [2.6, 7], recovery: 0.5, gapCloser: true,
    beats: [{
      tell: B, windup: 0.52, active: 0.1, damage: 22, knockback: 1.6, zone: { kind: 'line', r: 2.1, w: 0.9 }, dash: { from: 0.7, to: 1.0, stop: 1.0, max: 5.0 }, close: 0, lock: true,
      keys: [
        [0.72, { yaw: 0.2, bY: -0.3, bZ: -0.1, arm: 1, ext: 0.3, sw: [-1.2, 0.0], larm: 1, lext: 0.3, lsw: [1.2, 0.0], hdY: -0.2, ...SET }],
        [1.0, { e: 'i', yaw: 0.05, bY: -0.32, bZ: 0.24, pitch: 0.14, arm: 1, ext: 1, sw: [0.12, 0.02], larm: 1, lext: 1, lsw: [-0.12, 0.02], hdY: 0, ...LUNGE_FEET }],
        [2.0, { yaw: 0.05, bY: -0.3, bZ: 0.2, arm: 1, ext: 0.95, sw: [-0.5, 0.05], larm: 1, lext: 0.95, lsw: [0.5, 0.05], ...LUNGE_FEET }],
      ],
    }],
  },
  /** Returning Blade: one blade thrown spinning; it comes back the way it went. Parry it twice. */
  glaive: {
    label: 'Returning Blade', phase: 2, weight: [0, 1.8, 1.6, 0], cooldown: 9, band: [4, 13], recovery: 1.15,
    beats: [{ tell: N, windup: 0.6, active: 0.1, damage: 16, knockback: 1.2, cast: { kind: 'glaive', selfCue: true }, close: 0, track: 0.9, keys: throwKeys() }],
    recoveryKeys: [[0.5, { two: 0, yaw: 0.3, bY: -0.2, rH: [-0.1, 0.1, 0.4], rP: [-0.8, 0.2, -0.2], sw: [-0.3, 0.6] }]],
  },
  /** Low double sweep (form 2's red). */
  reap2: {
    label: 'Reaping Arcs', phase: 2, weight: W(2, 1.4), cooldown: 6, band: [0, 3.4], recovery: 0.6,
    beats: [spin(N, 0.5, 13, { form: 2 }), spin(R, 0.6, 22, { form: 2, low: true, cock: 0.62 })],
  },
  riposte2: {
    label: 'Riposte (twin)', phase: 2, weight: 0, counter: true, cooldown: 0, band: [0, 5], recovery: 0.55,
    beats: [cut('diag', N, 0.46, 13, { form: 2, track: 0.7 }), cut('flat', N, 0.34, 13, { form: 2, left: true }), cut('thrust', B, 0.36, 20, { form: 2 })],
  },

  // ============================================================== form 3: the staff
  /** Cyclone: the long blades sweep wide; two level cuts, two full turns, a held overhead, a low red ring. */
  cyclone: {
    label: 'Cyclone', phase: 3, weight: W(3, 2.8), cooldown: 6, band: [0, 4.4], recovery: 0.7,
    beats: [
      cut('flat', N, 0.5, 13, { form: 3 }),
      cut('flatBack', N, 0.34, 13, { form: 3 }),
      spin(N, 0.38, 14, { form: 3, cock: 0.6 }),
      spin(N, 0.36, 14, { form: 3, cock: 0.6 }),
      { pick: [cut('over', B, 0.44, 22, { form: 3, hold: [0.1, 0.3], cock: 0.72, lock: true }), cut('thrust', B, 0.4, 20, { form: 3 })] },
      { pick: [spin(R, 0.62, 24, { form: 3, low: true, cock: 0.62 }), cut('flip', B, 0.6, 26, { form: 3, lock: true })] },
    ],
  },
  /** Turning Mill: he walks forward inside the turning staff: four rings, then a thrust. */
  mill: {
    label: 'Turning Mill', phase: 3, weight: W(3, 2.4), cooldown: 7, band: [1.5, 6.5], recovery: 0.7, gapCloser: true,
    beats: [
      spin(N, 0.52, 12, { form: 3, travel: [[0.2, 0], [1.0, 1.2], [2.0, 1.9]], close: 0 }),
      spin(N, 0.34, 12, { form: 3, cock: 0.55, travel: [[0, 0], [1.0, 0.9], [2.0, 1.5]], close: 0 }),
      spin(N, 0.34, 12, { form: 3, cock: 0.55, travel: [[0, 0], [1.0, 0.9], [2.0, 1.5]], close: 0 }),
      spin(N, 0.34, 12, { form: 3, cock: 0.55, travel: [[0, 0], [1.0, 0.9], [2.0, 1.5]], close: 0 }),
      cut('thrust', B, 0.42, 21, { form: 3 }),
    ],
  },
  /** Starfall: a great leap; the red ring follows the hero, locks, and he comes down on it. */
  starfall: {
    label: 'Starfall', phase: 3, weight: [0, 0, 2.0, 1.8], cooldown: 9, band: [4.2, 14], recovery: 0.75, gapCloser: true,
    beats: [{
      tell: R, windup: 1.15, active: 0.12, damage: 30, knockback: 4, knockdown: true, zone: { kind: 'ring', r: 2.8 }, ring: 2.8, part: 'feet',
      leap: { from: 0.36, lock: 0.66, apex: 3.8 }, track: 0.36, close: 0,
      keys: [
        [0.26, { two: 1, bY: -0.44, pitch: 0.18, yaw: 0.1, rH: [0.1, -0.22, 0.32], sw: [0.0, 0.35], rF: [-0.12, 0.25], lF: [0.15, -0.25], rK: [-0.2, 0.2, 1], lK: [0.3, 0.2, 1], hdY: -0.1 }],
        [0.36, { two: 1, bY: -0.1, pitch: -0.1, yaw: 0.1, rH: [0.1, 0.1, 0.22], sw: [0.0, 1.2], rF: [-0.1, 0.12], lF: [0.15, -0.12] }],
        [0.75, { ...RAISED, yaw: 0.1, bY: 0.05, sw: [0.0, 2.45], rF: [-0.1, 0.25], lF: [0.15, -0.05], rK: [-0.2, 0.3, 1], lK: [0.3, 0.3, 1] }],
        [0.9, { ...RAISED, yaw: 0.1, bY: 0.0, sw: [0.0, 2.6], rF: [-0.1, 0.2], lF: [0.15, -0.15] }],
        [1.0, { ...CHOP, e: 'i', bY: -0.36, pitch: 0.38, rF: [-0.12, 0.45], lF: [0.2, -0.42] }],
        [2.0, { ...CHOP, bY: -0.36, pitch: 0.38, rF: [-0.12, 0.45], lF: [0.2, -0.42] }],
      ],
    }],
    recoveryKeys: [[0.5, { ...CHOP, bY: -0.3, sw: [-0.2, -0.6] }]],
  },
  /** Torn Stone: he tears the floor up with the Void and hurls it: three stones, then a great one (red). */
  debris: {
    label: 'Torn Stone', phase: 3, weight: [0, 0, 1.8, 1.4], cooldown: 10, band: [5, 15], recovery: 0.6,
    beats: [{ tell: N, windup: 0.95, fixed: true, active: 0.1, damage: 14, knockback: 1.5, cast: { kind: 'debris', count: 3, big: 1, selfCue: true }, part: 'hand', close: 0, track: 0.9, keys: hurlKeys() }],
  },
  /** Drawn Under: the pull, then the staff's low ring where you land. */
  undertow: {
    label: 'Drawn Under', phase: 3, weight: W(3, 1.4), cooldown: 8, band: [4.5, 10.5], recovery: 0.6, gapCloser: true,
    beats: [pull(0.8, { fixed: true }), spin(N, 0.62, 16, { form: 3, fixed: true }), cut('over', B, 0.42, 22, { form: 3, lock: true })],
  },
  riposte3: {
    label: 'Riposte (staff)', phase: 3, weight: 0, counter: true, cooldown: 0, band: [0, 5], recovery: 0.6,
    beats: [cut('flatBack', N, 0.46, 15, { form: 3, track: 0.7 }), spin(N, 0.36, 14, { form: 3, cock: 0.6 })],
  },

  // ============================================================== form 4: the cross-hilted blade, the Void's aura
  /** Judgment: six heavy two-handed blows; a held overhead in the middle, a perilous thrust to end. */
  judgment: {
    label: 'Judgment', phase: 4, weight: W(4, 2.8), cooldown: 6, band: [0, 4.0], recovery: 0.7,
    beats: [
      cut('diag', N, 0.5, 14, { form: 4 }),
      cut('back', N, 0.34, 13, { form: 4 }),
      cut('flat', N, 0.34, 13, { form: 4 }),
      cut('over', B, 0.44, 22, { form: 4, hold: [0.1, 0.32], cock: 0.72, lock: true }),
      { pick: [cut('flatBack', N, 0.36, 13, { form: 4 }), cut('rise', N, 0.36, 13, { form: 4 })] },
      { pick: [
        { tell: R, windup: 0.62, active: 0.12, damage: 28, knockback: 2.5, zone: { kind: 'line', r: 2.4, w: 0.7 }, mikiri: true, dash: { from: 0.84, to: 1.0, stop: 0.8, max: 2.8 }, close: 0, track: 0.7, keys: perilKeys(1) },
        cut('flip', B, 0.6, 26, { form: 4, lock: true }),
      ] },
    ],
  },
  /** Eclipse: steel and the Void in one breath: two cuts, a full turn, a bolt from the free hand,
   *  a rising cut, and the somersault (or a thrust). */
  eclipse: {
    label: 'Eclipse', phase: 4, weight: W(4, 2.4), cooldown: 7, band: [0, 4.0], recovery: 0.7,
    beats: [
      cut('flat', N, 0.5, 13, { form: 4 }),
      cut('back', N, 0.34, 13, { form: 4 }),
      spin(N, 0.36, 14, { form: 4, cock: 0.6 }),
      bolt(0.5, 20, { fixed: true, cock: 0.6 }),
      cut('rise', N, 0.42, 13, { form: 4 }),
      { pick: [cut('flip', B, 0.6, 26, { form: 4, lock: true }), cut('thrust', B, 0.4, 22, { form: 4 })] },
    ],
  },
  /** Void Rend: he is gone, and behind you: three cuts, each from a new side. */
  rend: {
    label: 'Void Rend', phase: 4, weight: W(4, 2.4), cooldown: 8, band: [0, 12], recovery: 0.65, gapCloser: true,
    beats: [
      cut('flat', N, 0.62, 14, { form: 4, blink: { behind: 2.0 }, fixed: true, close: 1.2 }),
      cut('flatBack', N, 0.5, 14, { form: 4, blink: { behind: 2.0 }, fixed: true, close: 1.2 }),
      cut('over', B, 0.56, 24, { form: 4, blink: { behind: 2.1 }, fixed: true, close: 1.2, lock: true }),
    ],
  },
  /** Chained Lightning: four bolts in rhythm. Deflect them all. */
  chain: {
    label: 'Chained Lightning', phase: 4, weight: W(4, 2.0), cooldown: 9, band: [4, 16], recovery: 0.6,
    beats: [bolt(0.8, 20), bolt(0.46, 20, { cock: 0.5 }), bolt(0.46, 20, { cock: 0.5 }), bolt(0.46, 24, { cock: 0.5 })],
  },
  /** Red Tide: three cuts that each throw a crescent of red light. */
  tide: {
    label: 'Red Tide', phase: 4, weight: W(4, 1.8), cooldown: 8, band: [6, 16], recovery: 0.55,
    beats: [
      { ...cut('flat', N, 0.5, 14, { form: 4 }), zone: undefined, release: { style: 'crescent', count: 1 }, close: 0 },
      { ...cut('flatBack', N, 0.44, 14, { form: 4 }), zone: undefined, release: { style: 'crescent', count: 3, spread: 0.34 }, close: 0 },
      { ...cut('diag', N, 0.44, 14, { form: 4 }), zone: undefined, release: { style: 'crescent', count: 1 }, close: 0 },
    ],
  },
  /** The Starless Sky: he calls the lightning down: marked ground, then the strikes (red). */
  storm: {
    label: 'The Starless Sky', phase: 4, weight: W(4, 1.6), cooldown: 14, band: [0, 16], recovery: 0.45,
    beats: [{ tell: R, windup: 0.95, fixed: true, active: 0.1, damage: 26, knockback: 3, cast: { kind: 'storm', count: 6, selfCue: true }, part: 'feet', close: 0, track: 0.3, keys: stormKeys() }],
  },
  riposte4: {
    label: 'Riposte (cross)', phase: 4, weight: 0, counter: true, cooldown: 0, band: [0, 5], recovery: 0.55,
    beats: [cut('diag', N, 0.5, 16, { form: 4, track: 0.7 }), cut('thrust', B, 0.36, 22, { form: 4 })],
  },

  // ============================================================== the forms' ignitions (transitions)
  ignite2: ignite(2),
  ignite3: ignite(3),
  ignite4: ignite(4),
};
export const MOVE_NAMES = Object.keys(MOVES);
/** The transition that begins each later form, and each form's counter out of his guard. */
export const TRANSITIONS = Object.freeze({ 2: 'ignite2', 3: 'ignite3', 4: 'ignite4' });
export const COUNTERS = Object.freeze(['riposte', 'riposte2', 'riposte3', 'riposte4']);

// ---------------------------------------------------------------- reaction clips (no hits)
const KNEEL = { bY: -0.52, pitch: 0.22, spX: 0.1, hdX: 0.5, rF: [-0.12, 0.32], lF: [0.17, -0.42], rK: [0, 0, 1], lK: [0.1, -0.85, 0.5], flat: 0.7 };
/** Seated on the throne: the root is raised to the seat (lord.js), the hands on the arm rests. */
const THRONE = {
  two: 0, bY: -0.42, bZ: -0.04, pitch: -0.08, yaw: 0, hip: 0, hipX: 0, spX: 0.0, spY: 0, hdX: 0.12, hdY: 0,
  rF: [-0.17, 0.05, 0.52], lF: [0.17, 0.05, 0.52], rK: [-0.15, 0.2, 1], lK: [0.15, 0.2, 1], rFy: 0, lFy: 0, flat: 1,
  rH: [-0.14, -0.4, 0.2], rP: [-0.8, -0.3, -0.5], sw: [-0.3, -1.25], swF: [1, 0, 0], lH: [0.14, -0.4, 0.2], lP: [0.8, -0.3, -0.5],
};

export const CLIPS = {
  /** A strike caught on his guard: the blade snaps across to meet it. */
  clash: { dur: 0.26, keys: [[0.06, { e: 'o', bZ: -0.06, yaw: 0.5, rH: [0.12, -0.02, 0.36], sw: [0.42, 0.55], swF: [0, 1, -0.4], hdY: -0.4 }]] },
  flinch: { dur: 0.26, keys: [[0.07, { e: 'o', spX: -0.06, hdX: -0.12, bZ: -0.05, yaw: 0.46 }]] },
  backstep: { dur: 0.42, keys: [[0.12, { bY: -0.18, pitch: -0.08, ...STEP_BACK }], [0.32, { bY: -0.14, rF: [-0.1, 0.26], lF: [0.17, -0.3] }]] },
  sidestep: { dur: 0.36, keys: [[0.12, { bY: -0.2, roll: 0.08, rF: [-0.2, 0.25], lF: [0.25, -0.2] }]] },
  stagger: {
    dur: 0.8,
    keys: [
      [0.12, { e: 'o', pitch: -0.2, bZ: -0.1, bY: -0.14, rH: [-0.3, -0.2, 0.1], sw: [-1.7, 0.2], swF: [0, 1, 0], lH: [0.3, 0.0, 0.1], hdX: -0.2, ...STEP_BACK }],
      [0.5, { pitch: -0.08, bY: -0.16, rH: [-0.25, -0.2, 0.2], sw: [-1.3, 0.1], lH: [0.25, 0.0, 0.2] }],
    ],
  },
  /** His last hit parried (or a bolt thrown back): the blade knocked up and back, a step back. */
  recoil: {
    dur: 1.0,
    keys: [
      [0.1, { e: 'o', pitch: -0.24, bZ: -0.1, rH: [-0.1, 0.2, 0.15], rP: [-0.8, 0.4, -0.4], sw: [-0.5, 1.4], swF: [1, 0, 0], lH: [0.3, 0.05, 0.05], hdX: -0.2, ...STEP_BACK }],
      [0.6, { pitch: -0.12, rH: [-0.1, 0.05, 0.25], sw: [-0.6, 0.8], lH: [0.25, 0.1, 0.1] }],
    ],
  },
  reeling: {
    dur: 1.45,
    keys: [
      [0.12, { e: 'o', two: 0, pitch: -0.32, bZ: -0.14, bY: -0.12, yaw: -0.2, rH: [-0.34, 0.05, 0.05], rP: [-0.9, 0.3, -0.3], sw: [-2.3, 0.45], swF: [0, 1, 0], lH: [0.32, 0.1, 0.0], lP: [0.9, 0.3, 0.0], hdX: -0.3, rF: [-0.12, 0.05], lF: [0.2, -0.5] }],
      [0.6, { two: 0, pitch: -0.2, bY: -0.2, yaw: 0.0, rH: [-0.3, -0.05, 0.12], sw: [-2.0, 0.2], lH: [0.3, 0.0, 0.1], hdX: -0.1, rF: [-0.14, -0.15], lF: [0.18, -0.45] }],
      [1.1, { pitch: -0.05, bY: -0.18, rH: [-0.1, -0.1, 0.3], sw: [-0.9, 0.2], lH: [0.1, -0.05, 0.3] }],
    ],
  },
  trampled: {
    dur: 1.5,
    keys: [
      [0.1, { e: 'o', pitch: 0.42, bY: -0.34, bZ: 0.1, rH: [0.02, -0.38, 0.45], rP: [-0.6, -0.6, 0.2], sw: [-0.25, -1.15], swF: [1, 0, 0], lH: [0.2, -0.2, 0.2], hdX: 0.45, rF: [-0.08, 0.7], lF: [0.22, -0.48] }],
      [0.75, { pitch: 0.35, bY: -0.3, rH: [0.0, -0.36, 0.42], sw: [-0.3, -1.1], hdX: 0.4 }],
      [1.0, { e: 'o', pitch: -0.2, bY: -0.16, bZ: -0.1, rH: [-0.25, 0.0, 0.15], sw: [-1.9, 0.3], swF: [0, 1, 0], lH: [0.3, 0.05, 0.05], hdX: -0.1, ...STEP_BACK }],
    ],
  },
  lock: {
    dur: 3, hold: true,
    keys: [
      [0.08, { e: 'o', two: 0.8, bY: -0.22, bZ: 0.06, pitch: 0.1, yaw: 0.3, rH: [0.1, -0.02, 0.42], rP: [-0.7, -0.2, -0.3], sw: [0.55, 0.7], swF: [0, 1, -0.4], hdX: 0.1, hdY: -0.3, rF: [-0.1, 0.4], lF: [0.2, -0.42] }],
      [3, { two: 0.8, bY: -0.24, bZ: 0.08, pitch: 0.12, yaw: 0.3, rH: [0.1, -0.02, 0.43], sw: [0.5, 0.72], swF: [0, 1, -0.4], rF: [-0.1, 0.42], lF: [0.2, -0.44] }],
    ],
  },
  /** Broken: on one knee, the blade's point on the floor, the head bowed: the deathblow's opening. */
  broken: {
    dur: 4.5, hold: true,
    keys: [
      [0.25, { e: 'o', two: 0, ...KNEEL, rH: [-0.15, -0.4, 0.3], rP: [-0.7, -0.4, -0.3], sw: [-0.6, -1.0], swF: [1, 0, 0], lH: [0.05, -0.45, 0.15], lP: [0.6, -0.3, 0.3], lsw: [0.6, -1.0] }],
      [4.2, { two: 0, ...KNEEL, hdX: 0.4, rH: [-0.15, -0.38, 0.3], sw: [-0.6, -0.95], lH: [0.05, -0.43, 0.15], lsw: [0.6, -0.95] }],
      [4.5, { two: 0, ...KNEEL, bY: -0.4, hdX: 0.2, rH: [-0.1, -0.3, 0.32], sw: [-0.5, -0.6], lH: [0.05, -0.3, 0.2], lsw: [0.5, -0.6] }],
    ],
  },
  /** The deathblow lands: run through, he lurches, and is thrown back onto one knee. */
  executed: {
    dur: 1.2, hold: true,
    keys: [
      [0.0, { two: 0, ...KNEEL, rH: [-0.15, -0.4, 0.3], sw: [-0.6, -1.0], lH: [0.05, -0.45, 0.15], lsw: [0.6, -1.0] }],
      [0.2, { e: 'o', two: 0, ...KNEEL, pitch: -0.3, hdX: -0.35, bY: -0.45, rH: [-0.3, -0.2, 0.05], sw: [-1.4, -0.4], lH: [0.3, -0.1, 0.1], lsw: [1.4, -0.4] }],
      [0.75, { two: 0, ...KNEEL, pitch: 0.3, hdX: 0.5, bY: -0.54, rH: [-0.15, -0.42, 0.28], sw: [-0.6, -1.05], lH: [0.0, -0.4, 0.25], lsw: [0.6, -1.05] }],
      [1.2, { two: 0, ...KNEEL, pitch: 0.24, hdX: 0.5, bY: -0.52, rH: [-0.12, -0.42, 0.26], sw: [-0.5, -1.0], lH: [0.08, -0.44, 0.16], lsw: [0.6, -1.0] }],
    ],
  },
  /** Defeated: he sinks to his knees; the blade goes dark; he falls forward. */
  death: {
    dur: 2.6, hold: true,
    keys: [
      [0.4, { e: 'o', two: 0, ...KNEEL, pitch: 0.1, rH: [-0.2, -0.36, 0.2], sw: [-0.8, -0.9], lH: [0.2, -0.36, 0.2] }],
      [1.3, { two: 0, bY: -0.62, pitch: 0.16, hdX: 0.5, rH: [-0.22, -0.44, 0.16], sw: [-1.0, -1.1], lH: [0.22, -0.44, 0.16], rF: [-0.13, -0.3], lF: [0.13, -0.3], rK: [-0.05, -0.6, 0.8], lK: [0.05, -0.6, 0.8], flat: 0.2 }],
      [2.6, { two: 0, bY: -0.8, pitch: 1.2, hdX: 0.3, rH: [-0.3, -0.2, 0.3], sw: [-1.2, -0.3], lH: [0.3, -0.2, 0.3], rF: [-0.13, -0.5], lF: [0.13, -0.5], rK: [-0.05, -0.6, 0.8], lK: [0.05, -0.6, 0.8], flat: 0.1 }],
    ],
  },
  /** On the throne (asleep: the fight has not begun). */
  meditate: { dur: 1, hold: true, keys: [[0, { ...THRONE }]] },
  /** The intro: he lifts his head, rises from the throne, the blade ignites in his hand, and he
   *  leaps down to the seal (lord.js moves the root: TUNING.intro). */
  intro: {
    dur: 3.1,
    keys: [
      [0, { ...THRONE }],
      [0.5, { ...THRONE, hdX: -0.04 }],
      // standing before the throne, the hilt raised
      [1.2, { two: 0, bY: -0.06, bZ: 0.0, pitch: 0.0, yaw: 0.0, hdX: 0.0, rH: [-0.1, -0.1, 0.3], sw: [-0.2, 1.3], swF: [1, 0, 0], lH: [0.14, -0.4, 0.05], rF: [-0.14, 0.02, 0.1], lF: [0.14, 0.02, 0.1], rK: [-0.1, 0, 1], lK: [0.1, 0, 1] }],
      // the crouch before the leap
      [1.5, { two: 0, bY: -0.36, pitch: 0.2, yaw: 0.0, rH: [-0.1, -0.3, 0.2], sw: [-1.0, -0.2], lH: [0.2, -0.3, 0.1], rF: [-0.14, 0.02, 0.2], lF: [0.14, 0.02, -0.05], rK: [-0.2, 0.2, 1], lK: [0.2, 0.2, 1] }],
      // in the air, the blade swept back
      [2.0, { two: 0, bY: -0.1, pitch: 0.1, yaw: 0.2, rH: [-0.3, 0.0, -0.1], sw: [-2.2, 0.3], lH: [0.3, 0.1, 0.2], rF: [-0.12, 0.3, 0.3], lF: [0.14, 0.2, -0.3], rK: [-0.2, 0.3, 1], lK: [0.2, 0.1, 1], flat: 0 }],
      // the landing: low, one hand to the floor
      [2.5, { e: 'i', two: 0, bY: -0.5, pitch: 0.3, yaw: 0.3, hdX: 0.3, rH: [-0.3, -0.1, -0.05], sw: [-2.0, 0.15], lH: [0.12, -0.5, 0.3], rF: [-0.16, 0.46], lF: [0.2, -0.36], rK: [-0.3, 0.2, 0.8], lK: [0.4, -0.3, 0.8], flat: 0.8 }],
      [2.8, { two: 0, bY: -0.44, pitch: 0.22, yaw: 0.36, hdX: 0.0, rH: [-0.2, -0.14, 0.1], sw: [-1.4, 0.3], lH: [0.12, -0.36, 0.3], rF: [-0.14, 0.42], lF: [0.2, -0.34] }],
    ],
  },
};

/** Compiled reaction clips, one set per form (each round its form's guard). */
export const CLIPS_BY_FORM = FORM_POSES.map((K) => {
  const out = Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, K.compileClip(c.keys.map(([t, pose]) => ({ t, ...pose })), c.dur, { hold: !!c.hold })]));
  for (const [k, c] of Object.entries(out)) c.name = k;
  return out;
});
/** (form 1's set: the kit's default) */
export const CLIP = CLIPS_BY_FORM[0];

// ---------------------------------------------------------------- realising a move
const REALISERS = FORM_POSES.map((K) => makeRealise({ TUNING, MOVES, compileClip: (keys, dur) => K.compileClip(keys, dur) }));
/**
 * A move as it will play this time (duelist/realise.js), compiled round the stance of the form it is
 * used in; a form's ignition is compiled round the NEW form's stance, so it ends in that guard.
 */
export function realise(name, phase = 1, rnd = Math.random) {
  const def = MOVES[name];
  if (!def) return null;
  const form = def.transition ? def.phase : phase;
  return REALISERS[Math.min(REALISERS.length, Math.max(1, form)) - 1](name, phase, rnd);
}
