import { lookOf } from '../duelist/lookSwitch.js';
import { MOTION as ASC_MOTION } from '../ascendant/moves.js';
import { ANK } from '../ascendant/motion.js';
import { TUNING } from './tuning.js';
import { legsFor, limbKeys, flyKeys } from './limbs.js';

// Halcyon's reworked motion (ADR-225), `?halMotion=a`, played through his realiser's `keysOf`
// (moves.js). His blows are Tian Lei's builders' (ascendant/moves.js), keyed for a fighter standing on
// the floor; he never stands. What the audit measured on them (city.mjs AUDIT): his feet sat exactly at
// his root's height in every blow, a planted fighting stance 0.5 m up (he stood on air); every punch
// landed at 1.9 - 2.0 m, over the hero's head, with the elbow at ~130°. Under the switch:
//   1. Tian Lei's held windups for the blue and red blows (ascendant/motion.js).
//   2. THE FLIER'S LEGS on every builder blow: his hover's legs through the coil (the right knee drawn
//      up, the left hanging, the toes pointed), both trailing back through the strike as he drives in;
//      a kick keeps its striking leg and the other hangs.
//   3. THE BLOW AIMED DOWN at the hero: the striking hand lower, the body pitched over it, and his root
//      dips from the hover to `motion.dip` m through the strike (flight.js _want), so the fist meets
//      the hero's chest and head, not the air over him.
//   4. His arms open at the end of a blow (anim.js armSoft, Tian Lei's ADR-162 kit; halcyon.js).

const M = TUNING.motion;
/** His hover's legs (poses.js hoverLoco): the coil's, so a blow starts from the legs he flies on. */
const LEGS_COIL = { rF: [-0.1, ANK + 0.32, 0.1], lF: [0.12, ANK, -0.06], rK: [-0.1, 0.4, 1], lK: [0.1, 0, 1], flat: 0.2, rFy: -0.12, lFy: 0.1 };
/** Both legs trailing back as he drives in, the toes pointed. */
const LEGS_HIT = { rF: [-0.1, ANK + 0.24, -0.3], lF: [0.1, ANK + 0.06, -0.36], rK: [-0.1, -0.2, 1], lK: [0.1, -0.1, 1], flat: 0.1, rFy: -0.1, lFy: 0.1 };
/** A kick's other leg, hanging. */
const HANG_R = { rF: [-0.1, ANK + 0.04, -0.12], rK: [-0.1, 0, 1], rFy: -0.1 };
const HANG_L = { lF: [0.1, ANK + 0.04, -0.12], lK: [0.1, 0, 1], lFy: 0.1 };
const LEG_FIELDS = ['rF', 'lF', 'rK', 'lK', 'flat', 'rFy', 'lFy'];

const cache = new WeakMap();

/** The striking hand(s) of a beat: 'rH', 'lH' or both. */
function hands(beat) {
  const p = beat.part ?? 'fistR';
  if (p === 'palms') return ['rH', 'lH'];
  return p === 'fistL' || p === 'elbowL' ? ['lH'] : ['rH'];
}

/** One key's pose as he flies it (see the header). `strike`: the key is at or past the cock. */
function fly(pose, beat, strike) {
  const o = { ...pose };
  const fam = beat.mo?.fam, kick = fam === 'kick';
  if (kick) {
    // (the striking leg is the kick's: the other hangs)
    // (moves.js kick: `part` is already the mirrored limb for a left kick)
    Object.assign(o, (beat.part ?? 'footR').endsWith('R') ? HANG_L : HANG_R);
  } else {
    const L = strike ? LEGS_HIT : LEGS_COIL;
    for (const f of LEG_FIELDS) o[f] = Array.isArray(L[f]) ? L[f].slice() : L[f];
  }
  if (strike && !kick) {
    for (const h of hands(beat)) if (Array.isArray(o[h])) o[h] = [o[h][0], o[h][1] + M.aim.hand, o[h][2]];
    o.pitch = (o.pitch ?? 0) + M.aim.pitch;
  }
  return o;
}

const cacheB = new WeakMap(), cacheR = new WeakMap();
/** His keys for a beat under the switch (null: the beat's own). `b` (ADR-254, limbs.js): `a`'s, then the
 *  flier's long legs in place of the folded ones, the straight blows on the line, the kicks long; his
 *  flying beats (the pass, the tower) their level flier's line. */
export function halKeys(beat) {
  const m = lookOf('halMotion', '0');
  if (m === '0' || !beat) return null;
  if (m === 'b' && !beat.mo) return flyKeys(beat);
  if (!beat.mo) return null;
  // (ADR-289, `?halRefMove=a`: the sheets' legs, `refLegs`, in place of `b`'s long ones; `b`'s arms kept)
  const ref = m === 'b' && halRefMoveOn();
  const C = ref ? cacheR : m === 'b' ? cacheB : cache;
  if (C.has(beat)) return C.get(beat);
  const base = ASC_MOTION.keysFor(beat) ?? beat.keys ?? [];
  const cock = beat.cock ?? 0.7;
  let keys = base.map(([u, pose]) => [u, fly(pose, beat, u >= cock - 1e-6)]);
  if (m === 'b') {
    const kick = beat.mo.fam === 'kick';
    if (ref) keys = keys.map(([u, p]) => [u, refLegs(p, beat, u >= cock - 1e-6)]);
    else if (!kick) keys = keys.map(([u, p]) => [u, legsFor(p, u >= cock - 1e-6)]);
    else {
      // (a kick: the other leg hangs long, not folded under him as if he stood on air)
      const other = (beat.part ?? 'footR').endsWith('R') ? 'L' : 'R';
      keys = keys.map(([u, p]) => [u, legsFor(p, u >= cock - 1e-6, other)]);
    }
    keys = limbKeys(beat, keys);
    if (ref) keys = keys.map(([u, p]) => [u, refArms(p, beat, u)]);
  }
  C.set(beat, keys);
  return keys;
}

/** True when the switch is on (flight.js: the dip; halcyon.js: the open arms). */
export const halMotionOn = () => lookOf('halMotion', '0') !== '0';
/** True under `b` (ADR-254: the flier's limbs, the level pass; read live). */
export const halLimbsOn = () => lookOf('halMotion', '0') === 'b';

// ---------------------------------------------------------------- the reference pack's poses (ADR-289)
// `?halRefMove=a` (lookSwitch PENDING: the owner picks it from the films; '0' as today), live: his pose
// keys after the character pack (docs/art/character-packs-v04/halcyon/: 01 B, 03, 06, 07). Poses only:
// no key time, ease, zone, reach, root height, cue or travel changes (city.mjs HALREF checks it).
//   1. THE FLOWN REACTIONS: Tian Lei's reaction clips (ward ... lock) kept his planted stance: at the
//      hover (0.5 m) he stood on air. Every key of the ten he takes at the hover gets the flier's legs of
//      `?halMotion=b` (limbs.js legsFor: long, the knees soft, trailing with the body's lean). The ones the
//      engine plays on the floor keep theirs: the open reactions (stagger, recoil, reeling, trampled,
//      executed: struck out of the air he drops, flight.js) and the kneeling ones (broken, death, crashed,
//      blinded). The pack draws stagger / recoil / reeling / trampled in the air (07 rows 10 - 13); his
//      height is gameplay (the hover rule), so they stay grounded.
//   2. THE BRAKE AND THE BANK (poses.js hoverLoco, pilot.halAcc from halcyon.js brainFrame): slowing, he
//      leans back; in a turn he banks into it (01 B10, B11).
//   3. METEOR'S LANDING: a three-point landing in the crater, held into the recovery (03 row 6, 06 row 5).
//   4. WHAT HE HOLDS (terrain.js): the car on his right palm (03 row 4), the statue's arm thrown from his
//      right hand (03 row 7).
export const halRefMoveOn = () => lookOf('halRefMove', '0') !== '0';

/** The reactions he takes in the air (the hover): their keys flown. */
export const HOVER_REACT = Object.freeze(['ward', 'wardR', 'wardHigh', 'clash', 'deflect', 'wardHold', 'flinch', 'backstep', 'sidestep', 'lock']);

/** A reaction clip's keys flown: the sheets' hovering legs on every key (build time; 07: the right knee
 *  drawn up, the left hanging, the toes pointed). */
export function flyReactKeys(keys) {
  return keys.map(([t, pose]) => {
    const o = { ...pose };
    for (const f of LEG_FIELDS) o[f] = Array.isArray(LEGS_COIL[f]) ? LEGS_COIL[f].slice() : LEGS_COIL[f];
    return [t, o];
  });
}

/** THE SHEETS' LEGS (02, 03, 07; `?halRefMove=a` over `?halMotion=b`): through a blow's windup the right
 *  knee drawn up high and the left leg hanging, the toes pointed (crouched in the air); from the strike
 *  both legs bent and trailing behind him (LEGS_HIT); a kick keeps its striking leg (the builder's,
 *  carried out straight by limbs.js) and draws the other knee up under him (REF_KICK_OTHER). */
const REF_COIL = { rF: [-0.1, ANK + 0.4, 0.14], lF: [0.12, ANK + 0.08, -0.04], rK: [-0.1, 0.4, 1], lK: [0.1, 0.1, 1], flat: 0.2, rFy: -0.12, lFy: 0.1 };
const REF_KICK_OTHER = { R: { rF: [-0.1, ANK + 0.38, 0.1], rK: [-0.1, 0.4, 1], rFy: -0.1 }, L: { lF: [0.1, ANK + 0.38, 0.1], lK: [0.1, 0.4, 1], lFy: 0.1 } };
function refLegs(p, beat, strike) {
  const o = { ...p };
  if (beat.mo?.fam === 'kick') {
    const other = (beat.part ?? 'footR').endsWith('R') ? 'L' : 'R';
    for (const [f, v] of Object.entries(REF_KICK_OTHER[other])) o[f] = Array.isArray(v) ? v.slice() : v;
    return o;
  }
  const L = strike ? LEGS_HIT : REF_COIL;
  for (const f of LEG_FIELDS) o[f] = Array.isArray(L[f]) ? L[f].slice() : L[f];
  return o;
}

/** THE SHEETS' GUARD (02: every strike row): the hand that does not strike held up at the chin, a
 *  boxer's guard, the knuckles forward; the striking hand there too before its windup and once it has
 *  come back (`u` past REF_GUARD.back); a punch leans the body into it. Hand offsets from the shoulder,
 *  body axes (limbs.js aimHand). Poses only: no key time moves. */
const REF_GUARD = { rH: [0.11, 0.04, 0.24], lH: [-0.11, 0.04, 0.24], rP: [-0.9, -0.3, -0.5], lP: [0.9, -0.3, -0.5], back: 1.6, lean: 0.18 };
function refArms(p, beat, u) {
  const o = { ...p };
  const kick = beat.mo?.fam === 'kick';
  const strike = kick ? [] : hands(beat);
  for (const h of ['rH', 'lH']) {
    if (strike.includes(h) && u > 0.05 && u < REF_GUARD.back) continue;
    o[h] = REF_GUARD[h].slice();
    const pk = h === 'rH' ? 'rP' : 'lP';
    o[pk] = REF_GUARD[pk].slice();
  }
  if (!kick) o.pitch = (o.pitch ?? 0) + REF_GUARD.lean;
  return o;
}
