// The hero's idles (ADR-186; the owner, 2026-11-24: "several idle positions instead of having the same
// holding his left hand on his hip all the time. i want him to move both his arms around naturally and
// doing cool sword tricks during idle"; asked, they picked: mostly natural habits that move BOTH arms,
// a flashy trick every few cycles; both stances, the fight one tighter with the hand off the belt).
//
// Three layers over the two stances (stances.js; anim.js stand()):
//
//   RESTS    where his arms are when he does nothing. At ease he moves between a few (EASE_RESTS: the
//            free arm hanging loose, the sword fingers low by the hip, a hand holding the cloak at the
//            chest, the hand on the belt as before; the sword arm always the at-ease stance's), one every
//            IDLES.restHold s, a slow change of IDLES.restMove s. In the fight the fencer's guard
//            keeps its legs, its body and its blade, and the free hand comes OFF the belt to one of
//            FIGHT_RESTS (the sword fingers pointing at the foe, up beside the face, a guard hand
//            before the chest, floating low by the hip), changed more often and faster.
//   HABITS   the idle actions (anim.js FIDGETS's machinery, HeroAnimator._idleLife): small things
//            with both arms (re-grip, roll the shoulders, flex the free hand, brush the coat, ...).
//   TRICKS   every IDLES.trickEvery actions at ease: a wrist spin, a figure-eight, the salute (the
//            blade upright before his face, palm over fist), a flick of the blade clean (chiburi); and
//            three SPELLS drawn in the sword's green flame (the rite, the sigil, the breath).
//            Never in a fight: there only HABITS that stay in the guard (FIGHT_ACTS).
//
// `?idles=old` keeps the idles before this pass (the belt, anim.js FIDGETS): setIdles() / the Lab.
//
// The default since ADR-207 is `ref` (refStance.js: the stand and the two-handed hold after the owner's
// reference footage): ONE rest at ease (the reference's stand) and one in the fight (the hold), the same
// habits, tricks and spells starting from and coming back to that stand (the forearm-led ones start from
// its arm: STAND_ARM), the put-away and the draw (`stow`: the sword fades out in its green flame at his
// left hip and is drawn back out of it), and in the fight the habits that keep both hands on the grip.
// `?idles=new` is ADR-186's as it was (the rests, the guard hands).
//
// Pose space as stances.js: body axes (x his left, y up, z ahead); hand targets are offsets from each
// shoulder. Every function here writes a pose (anim.js P) and never allocates or throws. Its randomness
// is the idles' own stream on the animator (A.idleNoise), never Math.random, never the animator's `noise` (which picks
// an attack's look: an idle action drawing on it shifted the blows after it).
import { TAU, clamp, lerp, smoothstep } from '../../core/math.js';
// (function declarations: safe through the anim.js <-> idles.js import cycle, read at call time only)
import { dirLerp, kf } from './anim.js';
import { onTheBelt, standLife } from './stances.js';
import { DIM } from './heroDims.js';
import { REF_STAND, REF_READY, FLAT_ROLL } from './refStance.js';
import { FLICK } from './bearing.js';

const DEG = Math.PI / 180;
// a sword-hand offset → the same point as a free-hand offset (x): the two shoulders' spacing (anim.js's own)
const LEFT_FROM_RIGHT = -(DIM.shoulder[0] + DIM.gripShoulder[0]);

// ---------------------------------------------------------------- the switch
const IDS = ['ref', 'new', 'old'];
export const IDLES_IDS = Object.freeze(IDS.slice());
export const IDLES_NAMES = Object.freeze({ ref: 'the stand and the two-handed hold of the reference (ADR-207)', new: 'rests, habits and tricks (ADR-186)', old: 'the hand on the belt (before)' });
const q = (name) => {
  try {
    return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(name) : null;
  } catch {
    return null;
  }
};
const pickId = (v) => (IDS.includes(String(v)) ? String(v) : 'ref');
const PICK = { mode: pickId(q('idles')) };
/** The idles drawn now: 'ref' (the default: refStance.js), 'new' (ADR-186's rests) or 'old' (the belt and the idle actions before). */
export const idlesMode = () => PICK.mode;
export const idlesOld = () => PICK.mode === 'old';
export const idlesRef = () => PICK.mode === 'ref';
/** Lab / tests: switch live. Returns the id now set. */
export function setIdles(id) {
  PICK.mode = pickId(id);
  syncStandArm();
  return PICK.mode;
}

// ---------------------------------------------------------------- tuning (content is data)
export const IDLES = {
  // at ease: how long he stays in a rest (s, a range drawn with the noise) and how long the change takes
  restHold: [7, 12],
  restMove: 1.3,
  // in the fight: the guard hand changes more often, and quicker
  guardHold: [4, 7],
  guardMove: 0.75,
  // a trick every this many actions at ease (a range: 3 or 4)
  trickEvery: [3, 4],
  // the gaps between actions (s): at ease (IDLE_LIFE's own is 2.0-4.5), and in the fight
  gapEase: [1.4, 3.2],
  gapFight: [1.6, 3.6],
  // standing still this long (s) before the first action: at ease, in the fight
  afterEase: 2.0,
  afterFight: 1.2,
  // a cut (he moves) takes an action that swings the blade off in this long (s; the others: IDLE_LIFE.cancel)
  cancelBlade: 0.26,
  // a block, a drink or a charge out of such an action brings the blade home over at least this (s; anim.js)
  cutFade: 0.24,
};

// ---------------------------------------------------------------- small helpers (no allocation)
function set3(p, i, x, y, z) {
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
}
function to3(p, i, x, y, z, t) {
  if (!(t > 0)) return;
  p[i] += (x - p[i]) * t;
  p[i + 1] += (y - p[i + 1]) * t;
  p[i + 2] += (z - p[i + 2]) * t;
}
// the way round an action's blade takes from the rest (dirLerp's memory): kept through the action, so a
// target that circles past the far side of the rest's blade (a spin) never flips the sweep the other way
const ACT = { d: 0, ok: false };
/** anim.js, as an idle action starts: its blade sweeps afresh. */
export function actStart() {
  ACT.ok = false;
}
/** Turn the blade toward the unit vector at azimuth az (0 ahead, + his left) and elevation el (degrees) by t. */
function aimTo(p, i, az, el, t) {
  if (!(t > 0)) return;
  const a = az * DEG, e = el * DEG, c = Math.cos(e);
  dirLerp(p, i, p[i], p[i + 1], p[i + 2], c * Math.sin(a), Math.sin(e), c * Math.cos(a), Math.min(1, t), ACT);
}
/** p[i..i+2] = the unit vector at az / el (degrees), times `len`. */
function dir(p, i, az, el, len = 1) {
  const a = az * DEG, e = el * DEG, c = Math.cos(e);
  p[i] = c * Math.sin(a) * len;
  p[i + 1] = Math.sin(e) * len;
  p[i + 2] = c * Math.cos(a) * len;
}
/** A free-hand offset (x, y, z, as the chest stands at ease) turned by the chest's yaw (the hand
 *  belongs to the body, which turns with it), toward by t. */
function freeTo(p, i, x, y, z, yaw, t) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  to3(p, i, x * c + z * s, y, -x * s + z * c, t);
}
/** The flat's normal p[swF] about the blade p[swD], at angle a from its upward-facing side, toward by w. */
function flatAt(p, P, a, w) {
  if (!(w > 0)) return;
  let bx = p[P.swD], by = p[P.swD + 1], bz = p[P.swD + 2];
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl;
  by /= bl;
  bz /= bl;
  // up, square to the blade (or ahead, for an upright blade)
  let ux = -by * bx, uy = 1 - by * by, uz = -by * bz;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-3) {
    ux = -bz * bx;
    uy = -bz * by;
    uz = 1 - bz * bz;
    ul = Math.hypot(ux, uy, uz) || 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  // the side: blade × up
  const sx = by * uz - bz * uy, sy = bz * ux - bx * uz, sz = bx * uy - by * ux;
  const c = Math.cos(a), s = Math.sin(a);
  to3(p, P.swF, ux * c + sx * s, uy * c + sy * s, uz * c + sz * s, Math.min(1, w));
}
const sn = (t, per, ph = 0) => Math.sin((t * TAU) / per + ph);
/** A 0..1 bump between a and d, up over a..b, held, down over c..d. */
const bump = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u));

// ---------------------------------------------------------------- the free hand's shapes
/** The free hand hanging loose: fingers down, the palm toward the thigh (body axes, length = weight). */
function looseHand(p, P, yaw, t) {
  freeTo(p, P.lD, 0.06, -0.97, 0.2, yaw, t * 0.85);
  freeTo(p, P.lN, -0.92, -0.05, 0.25, yaw, t * 0.85);
  p[P.hs] += (0 - p[P.hs]) * t;
}

// ---------------------------------------------------------------- RESTS
// Each writes the arms (both of them) over the stance's pose. `m` = the stance's oscillators
// (standLife), A = the animator (its time). They are layered, never summed: a change between two is a
// blend of the two finished poses (restBlend).

/** Loose: the sword arm as the stance has it, the free arm hanging beside the thigh, the hand open and
 *  heavy, swinging a little with the weight. */
function restLoose(p, P, A, m) {
  const yaw = p[P.pelvY] + p[P.spY], t = A.time;
  p[P.bodyX] += 0.014; // the weight a little more on the left leg than with the hand on the belt
  freeTo(p, P.lH, 0.035 + 0.004 * m.sw, -0.5 + 0.01 * m.brL, 0.035 + 0.016 * sn(t, 3.3, 0.5), yaw, 1);
  set3(p, P.lP, 0.35, -0.2, -0.9);
  looseHand(p, P, yaw, 1);
  p[P.lk] = 0;
  p[P.twoHand] = 0;
  p[P.offAt] = 0;
}

/** Sword fingers: the free hand low by the left hip in the sword fingers, pointing ahead and down (the
 *  jian's rest, the ready stance's own before ADR-114: guard()), the weight on the right leg, the eyes a
 *  little down and to his left. */
function restFingers(p, P, A, m) {
  const yaw = p[P.pelvY] + p[P.spY], t = A.time;
  freeTo(p, P.lH, 0.06 + 0.005 * m.sw, -0.49 + 0.01 * m.brL, 0.07 + 0.01 * sn(t, 4.1, 0.7), yaw, 1);
  set3(p, P.lP, 0.36, -0.2, -0.9);
  p[P.hs] = 1;
  freeTo(p, P.lD, 0.2, -0.77, 0.6, yaw, 0.85);
  freeTo(p, P.lN, -0.35, -0.6, -0.72, yaw, 0.85);
  p[P.lk] = 0;
  p[P.twoHand] = 0;
  p[P.offAt] = 0;
  p[P.bodyX] -= 0.008;
  p[P.hdX] += 0.06;
  p[P.hdY] += 0.08;
}

/** The cloak: the free hand up at the cloak's edge before his left breast, as a man holds his coat
 *  closed in the wind; the elbow down at his side. The weight even, the head a little tilted. */
function restCloak(p, P, A, m) {
  const yaw = p[P.pelvY] + p[P.spY];
  // (on the coat: 0.17 ahead of the shoulder the smaller hand (ADR-187) floated in front of it, seen from his side)
  freeTo(p, P.lH, -0.06 + 0.004 * m.sw, -0.22 + 0.008 * m.brL, 0.115, yaw, 1);
  set3(p, P.lP, 0.35, -0.9, -0.2);
  p[P.hs] = 0;
  // the fingers up and in along the cloak's edge, the palm on it
  freeTo(p, P.lD, -0.35, 0.85, 0.2, yaw, 0.85);
  freeTo(p, P.lN, -0.15, 0.05, -0.98, yaw, 0.85);
  p[P.lk] = 0;
  p[P.twoHand] = 0;
  p[P.offAt] = 0;
  p[P.bodyX] += 0.01;
  p[P.hdZ] += 0.05;
}

/** The belt: the free hand on the belt as before this pass (stances.js), one rest among the others. */
function restBelt(p, P, A, m) {
  onTheBelt(p, P, m, p[P.pelvY] + p[P.spY]);
}

/** name, the pose, how often it is picked (relative); `low`: an action that swings the blade (`blade`
 *  below) may start from it. Every rest keeps the sword arm the owner picked for the at-ease stance
 *  (ADR-114: the blade on the forearm's line, out at his front-right where the game camera sees it); only
 *  the free arm, the weight and the head change. (The owner turned down rests that moved the sword: both
 *  hands on the hilt before him hid the blade from the game camera and turned the wrist; the blade
 *  trailing behind him bent the wrist 50-60°; carried on the shoulder, the elbow at the fold limit.) */
export const EASE_RESTS = [
  { name: 'loose', fn: restLoose, w: 3, low: true },
  { name: 'fingers', fn: restFingers, w: 2.5, low: true },
  { name: 'cloak', fn: restCloak, w: 2, low: true },
  { name: 'belt', fn: restBelt, w: 1.5, low: true },
];

// the fight: the sword arm and the blade stay the guard's (stances.js fencerGuard); the free hand only
/** The sword fingers out toward the foe at the height of his chest, the elbow soft. */
function guardPoint(p, P, A, m) {
  set3(p, P.lH, -0.02 + 0.006 * m.sw, -0.16 + 0.01 * m.brL, 0.38 + 0.01 * m.tipB);
  set3(p, P.lP, 0.55, -0.8, -0.2);
  p[P.hs] = 1;
  dir(p, P.lD, -6, 4, 0.9);
  set3(p, P.lN, -0.35, -0.85, 0);
}
/** The sword fingers up beside his face, pointing on past the blade at the foe. (Raised over his head,
 *  the free arm whipped down 0.4 m a frame into a block or a charge.) */
function guardEye(p, P, A, m) {
  set3(p, P.lH, 0.02 + 0.005 * m.sw, 0.0 + 0.008 * m.brL, 0.25 + 0.008 * m.tipA);
  set3(p, P.lP, 0.9, -0.45, -0.2);
  p[P.hs] = 1;
  dir(p, P.lD, -8, 14, 0.9);
  set3(p, P.lN, -0.3, -0.9, 0.1);
}
/** An open guard hand before the chest, fingers up, the palm turned in. */
function guardHand(p, P, A, m) {
  set3(p, P.lH, -0.1 + 0.006 * m.sw, -0.22 + 0.01 * m.brL, 0.28 + 0.008 * m.tipB);
  set3(p, P.lP, 0.75, -0.6, -0.3);
  p[P.hs] = 0;
  dir(p, P.lD, -10, 62, 0.85);
  set3(p, P.lN, -0.75, 0.1, 0.55);
}
/** The hand floating low by the left hip, ahead of it, the sword fingers down toward the foe's feet. */
function guardLow(p, P, A, m) {
  const t = A.time;
  set3(p, P.lH, 0.04 + 0.006 * m.sw, -0.42 + 0.01 * m.brL, 0.14 + 0.012 * sn(t, 2.9));
  set3(p, P.lP, 0.6, -0.3, -0.75);
  p[P.hs] = 1;
  dir(p, P.lD, 2, -38, 0.85);
  set3(p, P.lN, -0.55, -0.6, -0.3);
}
export const FIGHT_RESTS = [
  { name: 'point', fn: guardPoint, w: 3 },
  { name: 'eye', fn: guardEye, w: 1.5 },
  { name: 'hand', fn: guardHand, w: 2 },
  { name: 'low', fn: guardLow, w: 2 },
];

// `?idles=ref` (the default, ADR-207): one rest each, the pose refStance.js already wrote (anim.js stand())
const restNone = () => {};
export const EASE_RESTS_REF = [{ name: 'stand', fn: restNone, w: 1, low: true }];
export const FIGHT_RESTS_REF = [{ name: 'hold', fn: restNone, w: 1 }];
/** The rests of the mode drawn now (at ease / in the fight). */
export const easeRests = () => (PICK.mode === 'ref' ? EASE_RESTS_REF : EASE_RESTS);
export const fightRests = () => (PICK.mode === 'ref' ? FIGHT_RESTS_REF : FIGHT_RESTS);

// ---------------------------------------------------------------- the rest state
/** A rest state on the animator (A.rests): at ease and in the fight, each { a, b, u, hold } (from rest
 *  a toward b, u 0..1 of the change; hold: s left in it). */
export function newRests() {
  return { ease: { a: 0, b: 0, u: 1, hold: IDLES.restHold[0], mem: { d: 0, ok: false } }, fight: { a: 0, b: 0, u: 1, hold: IDLES.guardHold[0], mem: { d: 0, ok: false } } };
}
function pickRest(list, not, noise) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) if (i !== not) sum += list[i].w;
  let r = noise() * sum;
  for (let i = 0; i < list.length; i++) {
    if (i === not) continue;
    r -= list[i].w;
    if (r <= 0) return i;
  }
  return not === 0 ? 1 : 0;
}
/** Advance a rest state. `still`: standing still in this stance (the hold runs down); `free`: and no
 *  action playing (a change starts only then); a change under way always finishes (slow and small). */
function tickRest(S, list, dt, still, free, hold, move, noise) {
  if (list.length < 2) {
    // (one rest: nothing to change to; an index left from another mode's list goes home)
    S.a = S.b = 0;
    S.u = 1;
    return;
  }
  if (S.a >= list.length || S.b >= list.length) {
    S.a = S.b = 0;
    S.u = 1;
  }
  if (S.u < 1) {
    S.u = Math.min(1, S.u + dt / move);
    if (S.u >= 1) S.a = S.b;
    return;
  }
  if (!still) return;
  S.hold -= dt;
  if (S.hold > 0 || !free) return;
  S.b = pickRest(list, S.a, noise);
  S.u = 0;
  S.mem.ok = false;
  S.hold = lerp(hold[0], hold[1], noise());
}
/** HeroAnimator._idleLife: both rest states, every frame. pool: 1 standing still at ease, 2 in the guard
 *  (anim.js); free: no idle action playing. */
export function tickRests(A, dt, pool, free) {
  const R = A.rests;
  if (!R) return;
  const n = A.idleNoise;
  tickRest(R.ease, easeRests(), dt, pool === 1, free, IDLES.restHold, IDLES.restMove, n);
  tickRest(R.fight, fightRests(), dt, pool === 2, free, IDLES.guardHold, IDLES.guardMove, n);
}
/** The rest's name now (the one he is moving to during a change). */
export function restName(A, fight) {
  const S = fight ? A.rests?.fight : A.rests?.ease;
  if (!S) return '';
  const L = fight ? fightRests() : easeRests();
  return L[S.u < 1 ? S.b : S.a]?.name ?? L[0].name;
}

// ---------------------------------------------------------------- writing a rest
const SCR = new Float32Array(64);
const SW = { d: 0, ok: false }; // (dirLerp's memory is a fade's: a rest change keeps the way it took)
function restBlend(p, P, A, S, list) {
  const m = standLife(A.time, A.fightW > 0.5 ? 1 : 0);
  const a = list[S.a] ?? list[0], b = list[S.b] ?? list[0];
  if (S.u >= 1 || S.a === S.b) {
    a.fn(p, P, A, m);
    return;
  }
  const n = p.length;
  for (let i = 0; i < n; i++) SCR[i] = p[i];
  a.fn(p, P, A, m);
  b.fn(SCR, P, A, m);
  // (smootherstep: no speed at either end of the change)
  const x = S.u, k = x * x * x * (x * (6 * x - 15) + 10);
  const ax = p[P.swD], ay = p[P.swD + 1], az = p[P.swD + 2];
  for (let i = 0; i < n; i++) p[i] += (SCR[i] - p[i]) * k;
  dirLerp(p, P.swD, ax, ay, az, SCR[P.swD], SCR[P.swD + 1], SCR[P.swD + 2], k, S.mem);
}
/** stand(): the at-ease rest's arms over atEase (stances.js). */
export function easeArms(p, P, A) {
  if (A.rests) restBlend(p, P, A, A.rests.ease, EASE_RESTS);
}
/** stand(): the fight's free hand over fencerGuard (stances.js): off the belt. */
export function guardArms(p, P, A) {
  if (!A.rests) return;
  restBlend(p, P, A, A.rests.fight, FIGHT_RESTS);
  p[P.lk] = 0;
  p[P.twoHand] = 0;
  p[P.offAt] = 0;
}

// ---------------------------------------------------------------- the sword arm led by the forearm
// The sword fist is built on the SWORD's frame (gear/wanderer.js: the fingers wrap the grip in every pose)
// while the back of the hand and the cuff are the forearm's: the further the blade leaves the forearm's
// line, the more the fist turns off the wrist. The owner's stances keep it within ~7° (ADR-114); spun and
// raised at 80-130° off it, "something about ... the right hand looks weird in terms of angle". So the moves
// that swing or raise the blade lead with the FOREARM: the elbow is placed, the forearm aims where the blade
// goes, and the hand is a forearm's length on along that aim; the blade leans only a little off it.
const FORE = DIM.foreArm;
const _ax = [0, 0, 0];
function unitAzEl(az, el, o) {
  const a = az * DEG, e = el * DEG, c = Math.cos(e);
  o[0] = c * Math.sin(a);
  o[1] = Math.sin(e);
  o[2] = c * Math.cos(a);
  return o;
}
/** The at-ease sword arm as an elbow and a forearm's aim: where a led move starts (EASE_ELBOW, EASE_AIM),
 *  and where the blade points then (EASE_BLADE). The arm of the mode drawn now (syncStandArm): ADR-186's
 *  (stances.js atEase: the blade on the forearm's line) or the reference's stand (refStance.js REF_STAND:
 *  the wrist cocked, the blade forward). FIGHT_AIM / FIGHT_FLAT: the fight's blade [az, el] and its flat's
 *  angle from the blade's up side (idles.js flatAt), which the fight's habits move about. */
const EASE_ELBOW = [0, 0, 0], EASE_AIM = [0, 0], EASE_BLADE = [0, 0], FIGHT_AIM = [0, 0], FIGHT_FLAT = [0];
const ARM_NEW = { el: [-0.044, -0.257, -0.047], aim: [-56, -55], blade: [-56, -55], fight: [-9, 13], flat: 0.25 };
/** The two-bone arm's elbow for a hand target h and pole p (offsets from the shoulder, body axes): where the
 *  animator's own solve puts it (anim.js _arm, inside the arm's reach). */
function elbowOf(h, pole, out) {
  const U = DIM.upperArm, F = DIM.foreArm;
  let d = Math.hypot(h[0], h[1], h[2]) || 1e-6;
  const hx = h[0] / d, hy = h[1] / d, hz = h[2] / d;
  d = Math.min(d, (U + F) * 0.999);
  const a = (U * U - F * F + d * d) / (2 * d), r = Math.sqrt(Math.max(0, U * U - a * a));
  const k = pole[0] * hx + pole[1] * hy + pole[2] * hz;
  let px = pole[0] - hx * k, py = pole[1] - hy * k, pz = pole[2] - hz * k;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  out[0] = hx * a + px * r;
  out[1] = hy * a + py * r;
  out[2] = hz * a + pz * r;
  return out;
}
const ARM_REF = { el: [0, 0, 0], aim: [0, 0], blade: [0, 0], fight: [0, 0], flat: 0 };
/** ARM_REF from refStance.js's poses as they are now (the Lab / a tuning pass may change them live). */
function refArm() {
  const S = REF_STAND, el = elbowOf(S.rH, S.leadP ?? S.rP, ARM_REF.el);
  const fx = S.rH[0] - el[0], fy = S.rH[1] - el[1], fz = S.rH[2] - el[2];
  // (the hand a forearm's length from the elbow along the aim: armAlong puts it there)
  ARM_REF.aim[0] = Math.atan2(fx, fz) / DEG;
  ARM_REF.aim[1] = Math.atan2(fy, Math.hypot(fx, fz)) / DEG;
  ARM_REF.blade[0] = S.sw[0];
  ARM_REF.blade[1] = S.sw[1];
  ARM_REF.fight[0] = REF_READY.sw[0];
  ARM_REF.fight[1] = REF_READY.sw[1];
  ARM_REF.flat = (90 - FLAT_ROLL) * DEG;
  return ARM_REF;
}
// the sword elbow's pole the moves that swing the blade take over their envelope (`?idles=ref`: refStance.js
// REF_STAND.leadP; the stand's own elbow stands out off the ribs, and fading into a raise from that side the
// sword wrist turned past 60°, ADR-207). Off with ADR-186's (the stand's own is theirs)
const LEAD = { on: false, p: [0, 0, 0] };
function leadArm(p, P, e) {
  if (LEAD.on && e > 0) to3(p, P.rP, LEAD.p[0], LEAD.p[1], LEAD.p[2], Math.min(1, e));
}
/** idles.js / anim.js: the standing arm of the mode drawn now (called by setIdles and at load). */
export function syncStandArm() {
  const lp = PICK.mode === 'ref' ? REF_STAND.leadP : null;
  LEAD.on = !!lp;
  if (lp) for (let i = 0; i < 3; i++) LEAD.p[i] = lp[i];
  const S = PICK.mode === 'ref' ? refArm() : ARM_NEW;
  for (let i = 0; i < 3; i++) EASE_ELBOW[i] = S.el[i];
  for (let i = 0; i < 2; i++) {
    EASE_AIM[i] = S.aim[i];
    EASE_BLADE[i] = S.blade[i];
    FIGHT_AIM[i] = S.fight[i];
  }
  FIGHT_FLAT[0] = S.flat;
}
syncStandArm();
/** Tests: the standing arm now (copies). */
export const standArm = () => ({ elbow: EASE_ELBOW.slice(), aim: EASE_AIM.slice(), blade: EASE_BLADE.slice(), fight: FIGHT_AIM.slice() });
/** Toward by t: the elbow at (ex, ey, ez) (an offset from the sword shoulder, body axes), the forearm aimed
 *  at az / el (degrees), the hand a forearm's length on along it, the elbow bending toward where it is. */
function armAlong(p, P, ex, ey, ez, az, el, t) {
  if (!(t > 0)) return;
  unitAzEl(az, el, _ax);
  const hx = ex + _ax[0] * FORE, hy = ey + _ax[1] * FORE, hz = ez + _ax[2] * FORE;
  to3(p, P.rH, hx, hy, hz, t);
  // the pole: the elbow's side of the shoulder → hand line
  const hl2 = hx * hx + hy * hy + hz * hz || 1, k = (ex * hx + ey * hy + ez * hz) / hl2;
  let px = ex - hx * k, py = ey - hy * k, pz = ez - hz * k;
  const pl = Math.hypot(px, py, pz);
  if (pl > 1e-4) {
    px /= pl;
    py /= pl;
    pz /= pl;
  } else {
    px = 0.3;
    py = -0.9;
    pz = -0.3;
  }
  to3(p, P.rP, px, py, pz, t);
}
/** The elbow and the aim along a path of keys u → [ex, ey, ez, az, el] (kf per channel), written by t. */
const _key = new Float32Array(16);
function armPath(p, P, u, keys, t) {
  const n = Math.min(8, keys.length);
  const ch = (j) => {
    for (let i = 0; i < n; i++) {
      _key[2 * i] = keys[i][0];
      _key[2 * i + 1] = keys[i][1 + j];
    }
    return kf(u, n === 8 ? _key : _key.subarray(0, 2 * n));
  };
  armAlong(p, P, ch(0), ch(1), ch(2), ch(3), ch(4), t);
}
// The raised blade (the salute, the rite, the breath): the fist comes up before his chest, near his middle,
// the forearm rising toward it at ~30° and the wrist cocked the rest of the way (40-50°, as a hand holds a
// sword upright). Stood upright beside his head, the forearm showed from the game camera as a ragged column
// of the vambrace's letters ("the right hand from normal camera angle ... looks very jagged"); here his head
// and shoulder cover it, as they did before the forearm led (ADR-186).
const RAISE = {
  salute: { el: [-0.022, -0.255, 0.03], aim: [-4, 32], blade: [-8, 76] },
  rite: { el: [-0.03, -0.255, 0.03], aim: [-8, 32], blade: [-16, 70] },
  breath: { el: [-0.02, -0.25, 0.04], aim: [-4, 34], blade: [-8, 80] },
};
/** armAlong from the at-ease arm toward a RAISE pose by `up`, written by t. */
function armRaise(p, P, R, up, t) {
  armAlong(p, P, lerp(EASE_ELBOW[0], R.el[0], up), lerp(EASE_ELBOW[1], R.el[1], up), lerp(EASE_ELBOW[2], R.el[2], up), lerp(EASE_AIM[0], R.aim[0], up), lerp(EASE_AIM[1], R.aim[1], up), t);
}

// ---------------------------------------------------------------- HABITS at ease (both arms)
// fn(p, P, A, u, e): u = the action's own 0..1, e = its weight (the envelope). Written over the rest.

/** Re-grip: where the blade hangs, the sword hand eases and closes again round the grip, the blade
 *  turning a quarter in it and dipping a little through the fingers; the free hand shakes itself loose at
 *  his side; he glances down at the hilt. (Brought before him with both hands on it, the blade was hidden
 *  from the game camera and the sword wrist turned.) */
function actRegrip(p, P, A, u, e) {
  const yaw = p[P.pelvY] + p[P.spY];
  const ease = kf(u, [0.15, 0, 0.3, 1, 0.45, 1, 0.6, 0]); // the grip loosens …
  const turn = kf(u, [0.25, 0, 0.42, 1, 0.62, 1, 0.75, 0]); // … the blade turns in it …
  p[P.rH + 1] -= 0.025 * ease * e; // … and drops a little through the fingers
  p[P.swD + 1] -= 0.06 * ease * e;
  flatAt(p, P, 0.9 * turn, e);
  // the free hand shakes out: open, a flick of the fingers, open
  const sh = bump(u, 0.2, 0.3, 0.7, 0.8) * e;
  freeTo(p, P.lH, 0.05, -0.47, 0.07, yaw, sh);
  p[P.hs] += (kf(u, [0.3, 0, 0.4, 1, 0.48, 0, 0.56, 1, 0.64, 0]) - p[P.hs]) * sh;
  p[P.lk] *= 1 - sh;
  p[P.hdX] += 0.14 * ease * e;
  p[P.hdY] -= 0.18 * ease * e;
}

/** The shoulders: both roll back in turn (the hands circle with them), then the head leans to one
 *  side and the other. */
function actShoulders(p, P, A, u, e) {
  const yaw = p[P.pelvY] + p[P.spY];
  const rl = bump(u, 0.04, 0.14, 0.5, 0.6) * e;
  const aL = TAU * clamp((u - 0.08) / 0.4, 0, 1), aR = TAU * clamp((u - 0.16) / 0.4, 0, 1);
  freeTo(p, P.lH, 0.06 + 0.025 * Math.sin(aL), -0.44 + 0.06 * (1 - Math.cos(aL)), 0.02 - 0.05 * Math.sin(aL), yaw, rl);
  p[P.hs] += (0 - p[P.hs]) * rl;
  p[P.lk] *= 1 - rl;
  p[P.rH + 1] += 0.05 * (1 - Math.cos(aR)) * rl;
  p[P.rH + 2] -= 0.04 * Math.sin(aR) * rl;
  p[P.spZ] += 0.04 * (Math.sin(aL) - Math.sin(aR)) * rl;
  p[P.spX] -= 0.05 * Math.sin(Math.PI * clamp((u - 0.08) / 0.48, 0, 1)) * e;
  p[P.hdZ] += kf(u, [0.58, 0, 0.67, 0.36, 0.73, 0.36, 0.83, -0.32, 0.89, -0.32, 0.97, 0]) * e;
}

/** Flex: the free hand comes up before his chest, opens, closes into the sword fingers and opens again,
 *  the wrist turning; the sword arm lets the point drift out to his right. He watches the hand. */
function actFlex(p, P, A, u, e) {
  const yaw = p[P.pelvY] + p[P.spY];
  const up = bump(u, 0.05, 0.22, 0.74, 0.92) * e;
  freeTo(p, P.lH, -0.06, -0.24, 0.26, yaw, up);
  to3(p, P.lP, 0.7, -0.7, -0.2, up);
  p[P.lk] *= 1 - up;
  const shut = kf(u, [0.25, 0, 0.33, 1, 0.43, 1, 0.5, 0, 0.58, 0, 0.64, 1, 0.74, 1, 0.8, 0]);
  p[P.hs] += (shut - p[P.hs]) * up;
  const tw = kf(u, [0.22, 0, 0.4, 1, 0.6, -0.6, 0.78, 0]);
  freeTo(p, P.lD, -0.25, 0.75, 0.6, yaw, up);
  freeTo(p, P.lN, -0.9 * Math.cos(tw), 0.3 * Math.sin(tw), 0.6 * Math.sin(tw) - 0.25, yaw, up);
  p[P.hdY] += 0.3 * up;
  p[P.hdX] += 0.22 * up;
}

/** Brush the coat: the free hand sweeps twice down the front of the coat by the left thigh (dust off),
 *  head down; the sword arm keeps the rest's blade. */
function actBrush(p, P, A, u, e) {
  const yaw = p[P.pelvY] + p[P.spY];
  const on = bump(u, 0.06, 0.2, 0.8, 0.94) * e;
  // two strokes: down fast, up slow
  const s = kf(u, [0.2, 0, 0.32, 1, 0.42, 0.15, 0.54, 1, 0.66, 0.2, 0.8, 0.2]);
  freeTo(p, P.lH, -0.05, lerp(-0.3, -0.46, s), 0.13, yaw, on);
  to3(p, P.lP, 0.6, -0.4, -0.7, on);
  p[P.lk] *= 1 - on;
  p[P.hs] += (0 - p[P.hs]) * on;
  freeTo(p, P.lD, -0.1, -0.85, 0.5, yaw, on);
  freeTo(p, P.lN, 0.1, -0.3, -0.95, yaw, on);
  p[P.hdX] += 0.32 * on;
  p[P.hdY] += 0.18 * on;
  p[P.spX] += 0.07 * on;
}

/** `blade`: it swings the blade from the rest's (it starts only from a `low` rest). */
export const EASE_HABITS = [
  { name: 'regrip', dur: 2.6, fn: actRegrip, blade: true },
  { name: 'shoulders', dur: 3.2, fn: actShoulders },
  { name: 'flex', dur: 2.8, fn: actFlex },
  { name: 'brush', dur: 2.6, fn: actBrush },
];

// ---------------------------------------------------------------- TRICKS at ease
/** The wrist spin: the forearm points out and down at his right, and the point swirls twice round it in a
 *  quick cone (the blade never more than ~45° off the forearm's line), fast in the middle, and settles. */
function trickSpin(p, P, A, u, e) {
  leadArm(p, P, e);
  const s = smoothstep(0.14, 0.86, u), ph = 2 * TAU * s;
  const w = e * bump(s, 0, 0.08, 0.92, 1); // (into the cone and out of it without a corner)
  const lead = bump(u, 0.04, 0.16, 0.86, 0.97) * e;
  armPath(p, P, smoothstep(0.04, 0.16, u), [[0, ...EASE_ELBOW, ...EASE_AIM], [1, -0.07, -0.26, 0.07, -32, -30]], lead);
  aimTo(p, P.swD, lerp(EASE_BLADE[0], -32, smoothstep(0.04, 0.16, u)) + 28 * Math.sin(ph) * w, lerp(EASE_BLADE[1], -30, smoothstep(0.04, 0.16, u)) + 24 * Math.cos(ph) * w, lead);
  flatAt(p, P, 1.57 + ph, w);
  const lf = bump(u, 0.05, 0.2, 0.8, 0.95) * e;
  const yaw = p[P.pelvY] + p[P.spY];
  freeTo(p, P.lH, 0.08, -0.45, 0.05, yaw, lf * 0.6); // the free arm a little out: balance
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  p[P.hdY] -= 0.22 * e;
  p[P.hdX] += 0.14 * e;
}

/** The figure-eight: the forearm out before him to his right, and the point draws an 8 lying on its side
 *  round its line twice (±26° across, ±19° up and down), the wrist rolling the flat through each loop. */
function trickEight(p, P, A, u, e) {
  leadArm(p, P, e);
  const s = smoothstep(0.14, 0.86, u), ph = TAU * 2 * s;
  const w = e * bump(s, 0, 0.08, 0.92, 1);
  const g = smoothstep(0.04, 0.16, u), lead = bump(u, 0.04, 0.16, 0.86, 0.97) * e;
  armPath(p, P, g, [[0, ...EASE_ELBOW, ...EASE_AIM], [1, -0.05, -0.21, 0.18, -30, 2]], lead);
  aimTo(p, P.swD, lerp(EASE_BLADE[0], -30, g) + 26 * Math.sin(ph) * w, lerp(EASE_BLADE[1], 4, g) + 19 * Math.sin(2 * ph) * w, lead);
  flatAt(p, P, 1.57 + 1.3 * Math.cos(ph), w);
  const yaw = p[P.pelvY] + p[P.spY];
  const lf = bump(u, 0.05, 0.2, 0.8, 0.95) * e;
  freeTo(p, P.lH, 0.1, -0.42, -0.02, yaw, lf * 0.7); // the free hand back out of the blade's way
  p[P.hs] += (1 - p[P.hs]) * lf;
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  p[P.hdX] += 0.08 * e;
  p[P.spY] += 0.06 * Math.sin(ph) * w;
}

/** The salute: the forearm rises with the blade until both stand upright before his right shoulder (the
 *  blade a little past plumb), the free palm laid over the sword fist, a short bow of the head; then the blade
 *  opens down and out to his right in one quick arc, the forearm leading it, and he lets it back to rest. */
function trickSalute(p, P, A, u, e) {
  leadArm(p, P, e);
  const up = smoothstep(0.06, 0.3, u), open = smoothstep(0.62, 0.74, u), home = smoothstep(0.76, 0.95, u);
  const k = up * (1 - open);
  // the forearm: down at rest → upright before the shoulder → down and out at his right with the arc
  const tt = e * (1 - home);
  // (the elbow forward of his ribs: folded under the hand at the shoulder it closed to 50°)
  const R = RAISE.salute;
  const ex = lerp(lerp(EASE_ELBOW[0], R.el[0], up), -0.07, open), ey = lerp(lerp(EASE_ELBOW[1], R.el[1], up), -0.25, open), ez = lerp(lerp(EASE_ELBOW[2], R.el[2], up), 0.06, open);
  const aaz = lerp(lerp(EASE_AIM[0], R.aim[0], up), -68, open), ael = lerp(lerp(EASE_AIM[1], R.aim[1], up), -42, open);
  armAlong(p, P, ex, ey, ez, aaz, ael, tt);
  // the blade: upright over the raised fist (the wrist cocked), with the forearm on the arc out
  // (from the stand's blade: on ADR-186's it lies on the forearm's line, on the reference's the wrist is cocked)
  const bo = 1 - up;
  aimTo(p, P.swD, lerp(aaz + (EASE_BLADE[0] - EASE_AIM[0]) * bo, R.blade[0], k), lerp(ael + (EASE_BLADE[1] - EASE_AIM[1]) * bo, R.blade[1], k), tt);
  flatAt(p, P, lerp(1.57, 0.3, open), tt);
  // the free palm over the fist (anim.js lays the open hand on the sword wrist: lk)
  const on = bump(u, 0.18, 0.3, 0.58, 0.66) * e;
  const yaw = p[P.pelvY] + p[P.spY];
  freeTo(p, P.lH, -0.36, 0.0, 0.27, yaw, on);
  p[P.lk] = Math.max(p[P.lk] * (1 - e), on);
  p[P.hs] += (0 - p[P.hs]) * on;
  p[P.twoHand] *= 1 - e;
  // the bow, a beat after the hands meet, and the eyes up again for the arc
  const bow = bump(u, 0.36, 0.44, 0.52, 0.6);
  p[P.hdX] += (0.24 * bow - 0.05 * k) * e;
  p[P.spX] += 0.06 * bow * e;
  p[P.hdY] -= 0.25 * open * (1 - home) * e;
}

/** The flick (chiburi): the blade comes up before him, snaps down and out to his right to throw the
 *  blood off it, holds, then the free hand comes to the hilt and he sets it back to rest. */
function trickFlick(p, P, A, u, e) {
  leadArm(p, P, e);
  const up = smoothstep(0.08, 0.34, u), snap = smoothstep(0.38, 0.45, u), back = smoothstep(0.62, 0.86, u);
  const hx = lerp(lerp(-0.12, -0.05, up), -0.3, snap), hy = lerp(lerp(-0.42, -0.12, up), -0.4, snap), hz = lerp(lerp(0.1, 0.3, up), 0.18, snap);
  to3(p, P.rH, hx, hy, hz, e);
  to3(p, P.rP, lerp(0.1, 0.45, snap), -0.75, lerp(-0.5, -0.7, snap), e);
  const az = lerp(lerp(-40, -8, up), -75, snap), el = lerp(lerp(-40, 48, up), -42, snap);
  aimTo(p, P.swD, az, el, e * (1 - back));
  flatAt(p, P, lerp(0.3, 1.5, snap), e * (1 - back));
  // the free hand to the hilt after the snap, and away
  const on = bump(u, 0.5, 0.6, 0.78, 0.9) * e;
  p[P.twoHand] = Math.max(p[P.twoHand] * (1 - e), on);
  p[P.offAt] = 0;
  p[P.lk] *= 1 - e;
  p[P.hdY] -= 0.2 * snap * (1 - back) * e;
  p[P.spY] -= 0.12 * snap * (1 - back) * e;
  p[P.bodyY] -= 0.025 * snap * (1 - back) * e;
}

// ---------------------------------------------------------------- SPELLS at ease (ADR-186, the owner: "casting
// some kind of cool subtle spell with his swords, to make the player curious about the true power of the
// sword"). The motion here; what they draw is the sword's own green flame (swordMystic.js), which reads
// `anim.spell` = { kind, u, w } (anim.js _idleLife): the action's name, its 0..1 and its weight. With
// `?mystic=0` they are the motion alone.

/** The rite: the forearm raises the blade upright beside his right shoulder, the free hand's sword fingers
 *  laid on the flat at the guard and drawn slowly up it toward the point; the flame swells behind them, and at
 *  the point a few marks lift off like embers. His eyes follow the fingers. */
function spellRite(p, P, A, u, e) {
  leadArm(p, P, e);
  const up = smoothstep(0.04, 0.22, u), dn = smoothstep(0.82, 0.97, u), w = e * (1 - dn);
  armRaise(p, P, RAISE.rite, up, w);
  aimTo(p, P.swD, lerp(EASE_BLADE[0], RAISE.rite.blade[0], up), lerp(EASE_BLADE[1], RAISE.rite.blade[1], up), w);
  flatAt(p, P, 1.57, w * up);
  // the sword fingers from the guard (0.14 m up the blade) to two thirds of it, then off
  const on = bump(u, 0.24, 0.34, 0.72, 0.8) * e;
  const d = lerp(0.14, 0.62, smoothstep(0.34, 0.72, u));
  const bl = Math.hypot(p[P.swD], p[P.swD + 1], p[P.swD + 2]) || 1;
  const bx = p[P.swD] / bl, by = p[P.swD + 1] / bl, bz = p[P.swD + 2] / bl;
  to3(p, P.lH, p[P.rH] + bx * d + LEFT_FROM_RIGHT + 0.03, p[P.rH + 1] + by * d, p[P.rH + 2] + bz * d + 0.05, on);
  to3(p, P.lP, 0.7, -0.7, -0.2, on);
  p[P.hs] += (1 - p[P.hs]) * on;
  to3(p, P.lD, bx, by, bz, on);
  to3(p, P.lN, -p[P.swF], -p[P.swF + 1], -p[P.swF + 2], on);
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  // the eyes on the fingers as they climb
  p[P.hdY] -= 0.3 * w;
  p[P.hdX] -= lerp(0.0, 0.2, smoothstep(0.34, 0.72, u)) * w;
  p[P.spX] -= 0.03 * w;
}

/** The sigil: the point lowered to the grass ahead of his right foot, the head bowed; the wrist turns
 *  the point in a small slow circle, and round him a ring of faint marks writes itself on the ground,
 *  holds, and lifts away. */
function spellSigil(p, P, A, u, e) {
  leadArm(p, P, e);
  const dn = bump(u, 0.04, 0.2, 0.8, 0.96);
  const w = e * dn;
  const c = smoothstep(0.22, 0.62, u) * TAU;
  to3(p, P.rH, -0.16, -0.44, 0.12, w);
  to3(p, P.rP, 0.45, -0.3, -0.85, w);
  aimTo(p, P.swD, -38 + 9 * Math.sin(c), -64 + 4 * Math.cos(c), w);
  flatAt(p, P, 1.2, w);
  // the free hand opens, palm down, a little out from his side, as if pressing on the air
  const yaw = p[P.pelvY] + p[P.spY];
  const on = bump(u, 0.12, 0.26, 0.7, 0.84) * e;
  freeTo(p, P.lH, 0.12, -0.44, 0.12, yaw, on);
  p[P.hs] += (0 - p[P.hs]) * on;
  freeTo(p, P.lD, 0.3, -0.25, 0.9, yaw, on);
  freeTo(p, P.lN, 0, -1, 0, yaw, on);
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  p[P.hdX] += 0.22 * w;
  p[P.spX] += 0.05 * w;
  p[P.bodyY] -= 0.02 * w;
}

/** The breath: the forearm raises the blade upright before his right shoulder, the head bowed over it, the
 *  free hand open beside it; he breathes in slow and deep, the flame swells, a thread of marks circles him at
 *  the height of his chest and comes back into the steel, and he lets the blade down. */
function spellBreath(p, P, A, u, e) {
  leadArm(p, P, e);
  const up = smoothstep(0.04, 0.2, u), dn = smoothstep(0.84, 0.97, u), w = e * (1 - dn);
  armRaise(p, P, RAISE.breath, up, w);
  aimTo(p, P.swD, lerp(EASE_BLADE[0], RAISE.breath.blade[0], up), lerp(EASE_BLADE[1], RAISE.breath.blade[1], up), w);
  flatAt(p, P, 1.57, w * up);
  const yaw = p[P.pelvY] + p[P.spY];
  const on = bump(u, 0.16, 0.28, 0.74, 0.84) * e;
  freeTo(p, P.lH, -0.2, -0.12, 0.25, yaw, on);
  to3(p, P.lP, 0.6, -0.8, -0.2, on);
  p[P.hs] += (0 - p[P.hs]) * on;
  freeTo(p, P.lD, -0.1, 0.95, 0.2, yaw, on);
  freeTo(p, P.lN, -0.95, 0, 0.25, yaw, on);
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  // the deep breath: the chest fills and empties twice, the head bowed
  const br = Math.sin(TAU * 2 * smoothstep(0.22, 0.78, u)) * bump(u, 0.2, 0.3, 0.7, 0.8);
  p[P.spX] -= 0.05 * br * e;
  p[P.bodyY] += 0.01 * br * e;
  p[P.hdX] += 0.2 * w;
}

/** The chiburi after the chain (bearing.js FLICK, ADR-292): the flick's motion on a quicker clock (the snap
 *  FLICK.snap of the way in), the eyes kept on the foe instead of turned down to the blade, the chin up through
 *  the hold. Played in either stance, only as the chain ends (anim.js _idleLife). */
function comboFlick(p, P, A, u, e) {
  const s = FLICK.snap, v = u < s ? (u / s) * 0.45 : 0.45 + ((u - s) / (1 - s)) * 0.55;
  trickFlick(p, P, A, v, e);
  const snap = smoothstep(0.38, 0.45, v), back = smoothstep(0.62, 0.86, v), hold = snap * (1 - back) * e;
  p[P.hdY] += 0.16 * hold;
  p[P.hdX] -= 0.06 * hold;
  p[P.spX] -= 0.03 * hold;
}
export const COMBO_FLICK = Object.freeze({ name: 'comboFlick', dur: FLICK.dur, fn: comboFlick, trick: true, blade: true });

export const EASE_TRICKS = [
  { name: 'spin', dur: 2.4, fn: trickSpin, trick: true, blade: true },
  { name: 'eight', dur: 3.0, fn: trickEight, trick: true, blade: true },
  { name: 'salute', dur: 3.4, fn: trickSalute, trick: true, blade: true },
  { name: 'flick', dur: 2.8, fn: trickFlick, trick: true, blade: true },
  { name: 'rite', dur: 4.4, fn: spellRite, trick: true, blade: true, spell: true },
  { name: 'sigil', dur: 4.2, fn: spellSigil, trick: true, blade: true, spell: true },
  { name: 'breath', dur: 4.6, fn: spellBreath, trick: true, blade: true, spell: true },
];

// ---------------------------------------------------------------- HABITS in the fight (small, in the guard)
/** Grip: the blade turns a little in the hand and back, the point dipping; the free hand closes and opens. */
function fightGrip(p, P, A, u, e) {
  const k = kf(u, [0.15, 0, 0.35, 1, 0.55, -0.6, 0.75, 0]);
  flatAt(p, P, FIGHT_FLAT[0] + 0.5 * k, e);
  aimTo(p, P.swD, FIGHT_AIM[0] - 4 * k, FIGHT_AIM[1] - 5 * Math.abs(k), 0.8 * e);
  p[P.rH + 1] -= 0.015 * Math.abs(k) * e;
  const sh = kf(u, [0.2, 1, 0.32, 0, 0.5, 0, 0.62, 1]);
  p[P.hs] += (sh - p[P.hs]) * e;
}
/** A guard shift: the weight forward and back, the point drawing one slow wider circle, the free hand
 *  riding with the weight. */
function fightShift(p, P, A, u, e) {
  const a = TAU * smoothstep(0.1, 0.9, u), k = Math.sin(Math.PI * smoothstep(0.05, 0.95, u));
  p[P.bodyZ] += 0.03 * Math.sin(a) * e;
  p[P.bodyY] -= 0.015 * k * e;
  p[P.rH] += 0.02 * Math.cos(a) * k * e;
  p[P.rH + 1] += 0.02 * Math.sin(a) * k * e;
  aimTo(p, P.swD, FIGHT_AIM[0] + 7 * Math.cos(a), FIGHT_AIM[1] + 6 * Math.sin(a), k * e);
  p[P.lH + 2] += 0.04 * Math.sin(a) * e;
  p[P.lH + 1] += 0.02 * Math.cos(a) * e;
}
/** Loosen: a roll of the neck to one side and the other, the free shoulder rolling once, the point dips
 *  and comes back up. */
function fightLoosen(p, P, A, u, e) {
  p[P.hdZ] += kf(u, [0.1, 0, 0.25, 0.24, 0.4, 0.24, 0.55, -0.22, 0.7, -0.22, 0.85, 0]) * e;
  const a = TAU * clamp((u - 0.15) / 0.55, 0, 1);
  p[P.lH + 1] += 0.04 * (1 - Math.cos(a)) * e;
  p[P.lH + 2] -= 0.03 * Math.sin(a) * e;
  p[P.spZ] -= 0.03 * Math.sin(a) * e;
  aimTo(p, P.swD, FIGHT_AIM[0], FIGHT_AIM[1] - 9 * Math.sin(Math.PI * clamp((u - 0.2) / 0.5, 0, 1)), 0.8 * e);
}
/** Beckon: the free hand turns palm up toward the foe and the fingers curl twice: come on. */
function fightBeckon(p, P, A, u, e) {
  const on = bump(u, 0.08, 0.25, 0.75, 0.92) * e;
  to3(p, P.lH, -0.03, -0.2, 0.36, on);
  to3(p, P.lP, 0.6, -0.8, -0.2, on);
  p[P.hs] += (0 - p[P.hs]) * on;
  const c = kf(u, [0.28, 0, 0.36, 1, 0.44, 0, 0.52, 1, 0.6, 0]);
  dir(p, P.lD, -5, lerp(5, 70, c), 0.9 * on + (1 - on) * Math.hypot(p[P.lD], p[P.lD + 1], p[P.lD + 2]));
  to3(p, P.lN, 0.1, 0.95, 0.2, on);
  p[P.hdX] -= 0.06 * on;
}
/** The point flicks: two quick small circles of the point from the wrist, the free hand still. */
function fightFlick(p, P, A, u, e) {
  const s = smoothstep(0.15, 0.85, u), a = 2 * TAU * s, k = Math.sin(Math.PI * s);
  aimTo(p, P.swD, FIGHT_AIM[0] + 9 * Math.cos(a) * k, FIGHT_AIM[1] + 9 * Math.sin(a) * k, e);
  flatAt(p, P, FIGHT_FLAT[0] + 0.4 * Math.sin(a) * k, e);
}
export const FIGHT_ACTS = [
  { name: 'grip', dur: 1.8, fn: fightGrip },
  { name: 'shift', dur: 2.4, fn: fightShift },
  { name: 'loosen', dur: 2.4, fn: fightLoosen },
  { name: 'beckon', dur: 2.2, fn: fightBeckon },
  { name: 'pointFlick', dur: 1.5, fn: fightFlick },
];
/** `?idles=ref`: both hands are on the grip in the fight, so only the habits that keep them there (the grip
 *  squeezed, the weight shifted, the shoulders loosened: written about the hold's blade, FIGHT_AIM). */
export const FIGHT_ACTS_REF = FIGHT_ACTS.filter((D) => D.name === 'grip' || D.name === 'shift' || D.name === 'loosen');

// ---------------------------------------------------------------- THE PUT-AWAY AND THE DRAW (`?idles=ref`)
// From the reference (the owner: the hero has no scabbard, "the sword fades out in its own green flame at
// his left hip and is drawn back out of the flame"): a quick dip of the body, the sword hand sweeps across to
// the left hip and the sword is gone (~0.35 s); he stands empty-handed, both arms hanging (~1.5 s); the same
// dip, the hand comes away from the left hip with the sword, the blade swings up and over forward and
// settles into the stand (~0.35 s). The motion is here; the sword's fade is anim.js's (HeroAnimator.stow,
// published by _idleLife from STOW.hidden: the weapon's own meshes shrink into the hilt and hide), its flame
// swordMystic.js's. The sword is whole again the very frame anything else starts (anim.js _idleLife).
export const STOW = {
  dur: 3.6,
  // u (0..1 of dur) where the sword is gone: fading out over hide[0..1], back over show[0..1]
  hide: [0.2, 0.25],
  show: [0.68, 0.72],
  // the sword arm as [u, elbow x, y, z, forearm az, el] keys (the stand's at both ends; STAND marks them)
  hip: [0.27, -0.25, 0.08, 64, -32], // the hand at the left hip, the forearm across his front
  up: [-0.06, -0.21, 0.1, -8, 38], // the draw's top: the forearm up before the right breast
  // the blade [az, el] at the hip (forward, left and down, as it goes in and comes out) and at the draw's top
  bladeHip: [36, -40],
  bladeUp: [-10, 62],
};
/** 0..1: how far the sword is gone at u of the stow (anim.js reads it through the action's name). */
export const stowHidden = (u) => smoothstep(STOW.hide[0], STOW.hide[1], u) * (1 - smoothstep(STOW.show[0], STOW.show[1], u));
// the keys (u, then elbow x y z, az el): rebuilt from the standing arm as it is now (no allocation per frame)
const STOW_U = [0.0, 0.13, 0.23, 0.27, 0.37, 0.6, 0.67, 0.71, 0.79, 0.87];
const STOW_K = new Float32Array(STOW_U.length * 5);
const _kn = new Float32Array(2 * STOW_U.length);
function stowKeys() {
  const S = STOW;
  // 0 stand, 1 stand, 2 hip, 3 hip, 4 hanging (the stand), 5 hanging, 6 hip, 7 hip, 8 up, 9 stand
  const at = [0, 0, 1, 1, 0, 0, 1, 1, 2, 0];
  for (let i = 0; i < STOW_U.length; i++) {
    const o = i * 5;
    if (at[i] === 0) {
      STOW_K[o] = EASE_ELBOW[0];
      STOW_K[o + 1] = EASE_ELBOW[1];
      STOW_K[o + 2] = EASE_ELBOW[2];
      STOW_K[o + 3] = EASE_AIM[0];
      STOW_K[o + 4] = EASE_AIM[1];
    } else {
      const K = at[i] === 1 ? S.hip : S.up;
      for (let j = 0; j < 5; j++) STOW_K[o + j] = K[j];
    }
  }
}
const stowCh = (u, j) => {
  for (let i = 0; i < STOW_U.length; i++) {
    _kn[2 * i] = STOW_U[i];
    _kn[2 * i + 1] = STOW_K[i * 5 + j];
  }
  return kf(u, _kn);
};
// the blade's keys (az, el): the stand's, at the hip (in and out), the draw's top, the stand's. While the sword
// is gone it lies along the forearm (actStow); cut there, it is the stand's at once
const BLADE_U = [0.13, 0.23, 0.27, 0.37, 0.6, 0.67, 0.71, 0.79, 0.87];
const BLADE_AT = [0, 1, 1, 0, 0, 1, 1, 2, 0];
const _kb = new Float32Array(2 * BLADE_U.length);
function bladeCh(u, j) {
  const S = STOW;
  for (let i = 0; i < BLADE_U.length; i++) {
    _kb[2 * i] = BLADE_U[i];
    _kb[2 * i + 1] = BLADE_AT[i] === 0 ? EASE_BLADE[j] : BLADE_AT[i] === 2 ? S.bladeUp[j] : S.bladeHip[j];
  }
  return kf(u, _kb);
}
const BLADE_V = [0, 0];
/** The stow: put away, empty-handed, drawn (see STOW). */
function actStow(p, P, A, u, e) {
  leadArm(p, P, e);
  if (!(e > 0)) return;
  stowKeys();
  const ex = stowCh(u, 0), ey = stowCh(u, 1), ez = stowCh(u, 2), az = stowCh(u, 3), el = stowCh(u, 4);
  armAlong(p, P, ex, ey, ez, az, el, e);
  // the blade: keyed, and along the forearm while the sword is gone (the empty fist hangs on the wrist's line)
  // (the animator's: 0 the frame the moment is cut, though its weight still fades)
  const h = Number.isFinite(A.stow) ? A.stow : 0;
  BLADE_V[0] = lerp(bladeCh(u, 0), az, h);
  BLADE_V[1] = lerp(bladeCh(u, 1), el, h);
  aimTo(p, P.swD, BLADE_V[0], BLADE_V[1], e);
  // the dip: forward and round to his left as the hand goes to the hip, both ways
  const dip = bump(u, 0.12, 0.21, 0.25, 0.34) + bump(u, 0.58, 0.66, 0.71, 0.8);
  p[P.spX] += 0.13 * dip * e;
  p[P.spY] += 0.22 * dip * e;
  p[P.pelvY] += 0.07 * dip * e;
  p[P.bodyY] -= 0.03 * dip * e;
  p[P.hdX] += 0.16 * dip * e;
  p[P.hdY] += 0.12 * dip * e;
  // empty-handed he looks ahead, a breath deeper
  p[P.spX] -= 0.02 * h * e;
  p[P.lk] *= 1 - e;
  p[P.twoHand] *= 1 - e;
  p[P.offAt] *= 1 - e;
}
/** `?idles=ref`'s own moments at ease (with ADR-186's habits, tricks and spells). */
export const EASE_REF_EXTRA = [{ name: 'stow', dur: STOW.dur, fn: actStow, trick: true, blade: true, stow: true }];

/** Is the at-ease rest he stands in now (and not changing) one an action that swings the blade may start from? */
export function lowRest(A) {
  if (PICK.mode === 'ref') return true; // (one rest: the stand, a low one)
  const S = A.rests?.ease;
  return !!S && S.u >= 1 && !!EASE_RESTS[S.a]?.low;
}
/** Is he in (or moving to or from) the trailing rest, its blade low behind him? (anim.js: a block's entry) */
export function trailing(A) {
  if (PICK.mode === 'ref') return false;
  const S = A.rests?.ease;
  return !!S && (EASE_RESTS[S.a]?.name === 'trail' || (S.u < 1 && EASE_RESTS[S.b]?.name === 'trail'));
}
/** Move the at-ease rest to the loose one (a low rest) now: an action that swings the blade waits for it. */
export function toLowRest(A) {
  if (PICK.mode === 'ref') return;
  const S = A.rests?.ease;
  if (!S || (S.u >= 1 && EASE_RESTS[S.a]?.low) || (S.u < 1 && EASE_RESTS[S.b]?.low)) return;
  if (S.u < 1) S.a = S.b; // (a change under way: from where it is going)
  S.b = 0;
  S.u = 0;
  S.mem.ok = false;
  S.hold = lerp(IDLES.restHold[0], IDLES.restHold[1], A.idleNoise());
}
/** The next action at ease: a trick when one is due (F.trickDue), else a habit other than the last; one
 *  that swings the blade only from a low rest. A trick due in a high rest: -1, and the rest goes low
 *  first (the trick follows). List = anim.js EASE_LIST (with three of the older idle actions). */
export function pickEase(F, list, A) {
  const noise = A.idleNoise, low = lowRest(A);
  const wantTrick = F.sinceTrick >= F.trickDue;
  if (wantTrick && !low) {
    toLowRest(A);
    return -1;
  }
  let n = 0;
  const ok = (i) => !!list[i].trick === wantTrick && i !== F.last && (low || !list[i].blade);
  for (let i = 0; i < list.length; i++) if (ok(i)) n++;
  let r = Math.floor(noise() * n);
  for (let i = 0; i < list.length; i++) {
    if (!ok(i)) continue;
    if (r-- === 0) {
      if (wantTrick) {
        F.sinceTrick = 0;
        F.trickDue = Math.round(lerp(IDLES.trickEvery[0], IDLES.trickEvery[1], noise()));
      } else F.sinceTrick++;
      return i;
    }
  }
  return -1;
}
