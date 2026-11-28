import { lookOf } from '../duelist/lookSwitch.js';
import { setFill } from '../ashDisciple/bodyArt.js';

// Xin Yi's look options (duelist/lookSwitch.js; never in PICKED: the owner picks from the sheets, PENDING):
//   ?oneLook=a|b|c   a the Long Coat (the fight is built with it): black, closed and still in phase 1,
//                    open from phase 2 (the tails fly); b the Cassock: buttoned to the neck, narrow,
//                    floor-length, a line of bright cells down the chest; c the Grey Coat: the same cut
//                    in dark blue-grey with a white-jade rim (for the phone).
// His body is the hero's skeleton in the hero's INK-LINE art (gear.js builds it), drawn by what rings it:
// a black coat on a dark level reads by its edge, so the fills are near black and the ink lines and the
// silhouette are lit pale jade; the face and the hands are pale; the glasses are a dark band with one
// bright cell (ADR-150's lesson: at ~40 px the silhouette and the colour carry a homage, small detail
// does not: the long coat with its split tails and the high collar).
//
// tintOne(M): his fills on HIS material instances, once after the rig is built (the class's _tint).
// dressOne(d, dt): once a frame (kit.dress). By phase (d.dressPhase ?? d.phase):
//   1  the coat closed and still (its front panels overlap; little flare, no stir), no guns (the left
//      hand behind his back is in the poses: poses.js BEHIND)
//   2  the coat thrown open (the front panels turn apart, the V of the coat's torso shows the shirt), the
//      tails flare and stir (they fly behind him with his motion: the animator's coat springs lag by his
//      speed), a handgun in each hand (hidden through the first part of his reload: they were thrown away)
//   3  no guns, the coat open, its edge of light brighter
// A phase change flips a few `visible` flags, turns two coat anchors and writes a few uniforms; any
// other frame reads three numbers. No allocation after the first call.
//
// The silhouette's ink (U.uHeroPartInk / Rim / Fill) is shared by every boss rig on the page (the
// player's rig reads its own, uSelfPart*). He is the only boss rig in his hall, so his parts' ink is
// written there (the Starless Lord's precedent: lord.js writes part 19 for his level), again on every
// phase change, so a rig built later from HERO_INK cannot leave him in the hero's lavender.

// (oneLetters and onePrint are redraws: their call-site default is '0', as he shipped, so `?looks=old` shows
// it; the owner's pick, a, comes from lookSwitch.js PICKED, 2026-11-23, ADR-170)
export const ONE_LOOKS = Object.freeze({ oneLook: 'a', oneLetters: '0', onePrint: '0', oneBody: '0', oneMoves: '0', oneGunFx: '0', oneBoltFx: '0' });
export const oneLook = (name = 'oneLook') => lookOf(name, ONE_LOOKS[name] ?? 'a');
/** The outfit chosen ('a' | 'b' | 'c'; anything else draws a), read when his rig is built. */
export function oneLookNow() {
  const o = oneLook();
  return o === 'b' || o === 'c' ? o : 'a';
}
/** His letters follow his size on screen as the hero's do (`?oneLetters=a`, the default, ADR-170; read live):
 *  his kit's `letters` (ARCHITECTURE "The bosses' letters": main.js -> pipeline.bossLetters), Tian
 *  Lei's rule (ADR-155). '0' the bosses' fixed fine cell he shipped with (from 1080p up about twice the
 *  hero's letters across him). */
export function oneLettersOn() {
  return oneLook('oneLetters') !== '0';
}
/** His print (`?onePrint=a|b|0`, ADR-170; read when his rig is built, the ink also on every phase change):
 *  a the hero's quiet print (QUIET below: an edge that fades with distance as the hero's does, no seams
 *  at the game camera, the face at the hero's levels, plain bright cells that do not glow), simpler
 *  small shapes (gear.js) and a coat that stirs from phase 1 (COAT_DRESS); b a, and one letter cell
 *  bolder than the hero's rule on a small screen (his kit's `letterBias`: a phone, where the rule rests
 *  on the fixed cell and a changes his print but not his letter count); '0' the lifted print, the
 *  shapes and the still phase-1 coat he shipped with. */
export function onePrintNow() {
  const o = oneLook('onePrint');
  return o === '0' || o === 'b' ? o : 'a';
}
/** His figure (`?oneBody=0|a|b|c`, the rebuild of 2026-11-26; read when his rig is built, the ink also on
 *  every phase change). '0' the figure he shipped with (a jade outline round a near-black fill, a coat
 *  flaring from the chest). The redraws print him the hero's way (BODY_INK: a lit body of letters, the
 *  cloth's dim dotted rim, no bright outline) on a man's build (gear.js CUT: broader square shoulders, a
 *  belted waist, the skirt hanging near straight, fuller hair, a lower collar):
 *    a  the Long Coat, closed in phase 1 (today's homage, redrawn)
 *    b  the Open Coat: open in every phase, the legs walking in the split, the sleeves edged apart
 *    c  the Duster: b cut to mid-shin, the boots below it, the hero's pale ragged hem along its edge */
export function oneBodyNow() {
  const o = oneLook('oneBody');
  return o === 'a' || o === 'b' || o === 'c' ? o : '0';
}

/** His moves (`?oneMoves=0|a|b`, the rebuild of 2026-11-26; read live, as each move is realised: moves.js
 *  realise). '0' the moves he shipped with; a the rebuild (moves.js MOVES_A): the guns aimed down the arm
 *  from a side-on stance, every blue / red / black blow's windup a pose he HOLDS before the strike
 *  (heldTell), and two fast strings of short, fair windups (Snapping Hands, Quick Foot: never picked on '0');
 *  b (ADR-253) a with the limbs on the line (limbs.js: straight blows down his centre, kicks held long through
 *  the contact, the sweep crossing the hero, short blows' zones fitted to their reach) and the guns aimed
 *  down the line of fire with a recoil (gunAim.js). */
export function oneMovesNow() {
  const o = oneLook('oneMoves');
  return o === 'a' || o === 'b' ? o : '0';
}

/** Xin Yi after the reference pack (docs/art/character-packs-v04/xin-yi, ADR-285): two switches, each '0'
 *  (as shipped) until the owner picks (lookSwitch.js PENDING; the Lab's LOOKS rows):
 *    ?oneRef=a      his look (read when his rig is built: gear.js, and the ink on every phase change): the tall
 *                   split collar with its pale inner band, the coat open in every phase down to the floor with a
 *                   wider hem, the offset jade-grey seam down his left front, jade cuffs, the glasses' jade
 *                   temples, a grey streak swept back in his hair, squarer guns (the muzzles where they were)
 *    ?oneRefMove=a  his motion (read live, as each move is realised and each frame's guard is posed:
 *                   refMoves.js, poses.js): the poses only, never a time, a zone, a root curve or an effect
 */
export const oneRefNow = () => lookOf('oneRef', '0') !== '0';
export const oneRefMoveNow = () => lookOf('oneRefMove', '0') !== '0';

/** His letter cell's bias (kit.letterBias: steps along the hero's cells; pipeline.js
 *  _updateBossLetters applies it only where the hero's rule rests on its floor cell: a small screen). */
export function oneLetterBias() {
  return onePrintNow() === 'b' ? 1 : 0;
}

/** The dressing record on his rig (gear.js registers the switched pieces in it). */
export function dressOf(root, look = 'a') {
  return (root.userData.dress ??= { kind: 'one', look, print: onePrintNow(), body: oneBodyNow(), ref: oneRefNow(), phase: 0, at: [], guns: [], fronts: [], panels: [], inked: false, reload: false });
}
/** Show mesh `m` from phase `from` to phase `to` (hidden until then; phase 1 is the build's state). */
export function at(D, m, from, to = 9) {
  D.at.push({ m, from, to });
  m.visible = from <= 1 && to >= 1;
}

// ---------------------------------------------------------------- colours (linear)
/** The fill of each of his material instances, per outfit (gear.js says which material is which:
 *  `coat` / `collar` the coat, `lining` / `collarIn` its inside, `shirt` the shirt in the open V,
 *  `pants` the trousers, `armor` the boots and the guns, `skin` the face and the hands, `eye` the
 *  glasses' lenses, `hair` / `hairTip` the short dark hair, `flask` the bright cells: the glint on the
 *  glasses, the guns' muzzles, the Cassock's buttons). */
export const ONE_TINT = {
  // the Long Coat: black with a cold green cast (dim letters, the edge carries him), a dark jade inside
  a: {
    coat: [0.11, 0.14, 0.13], collar: [0.11, 0.14, 0.13], lining: [0.04, 0.12, 0.09], collarIn: [0.05, 0.15, 0.11],
    shirt: [0.06, 0.07, 0.07], pants: [0.09, 0.1, 0.1], armor: [0.1, 0.11, 0.11],
    skin: [1.0, 0.96, 0.9], eye: [0.01, 0.012, 0.014], hair: [0.07, 0.075, 0.08], hairTip: [0.08, 0.085, 0.09],
    flask: [0.7, 1.0, 0.86],
  },
  // the Cassock: the same black, a little warmer, the buttons bright
  b: {
    coat: [0.12, 0.13, 0.12], collar: [0.12, 0.13, 0.12], lining: [0.04, 0.11, 0.085], collarIn: [0.05, 0.13, 0.1],
    shirt: [0.05, 0.06, 0.06], pants: [0.06, 0.07, 0.07], armor: [0.08, 0.09, 0.09],
    skin: [1.0, 0.96, 0.9], eye: [0.01, 0.012, 0.014], hair: [0.05, 0.055, 0.06], hairTip: [0.06, 0.065, 0.07],
    flask: [0.7, 1.0, 0.86],
  },
  // the Grey Coat: dark blue-grey, a lighter body for a small screen
  c: {
    coat: [0.24, 0.28, 0.34], collar: [0.24, 0.28, 0.34], lining: [0.05, 0.11, 0.09], collarIn: [0.07, 0.15, 0.12],
    shirt: [0.05, 0.06, 0.065], pants: [0.09, 0.1, 0.12], armor: [0.09, 0.1, 0.11],
    skin: [1.0, 0.96, 0.9], eye: [0.01, 0.012, 0.014], hair: [0.05, 0.055, 0.06], hairTip: [0.06, 0.065, 0.07],
    flask: [0.8, 1.0, 0.92],
  },
};

/** The edge of light on the screen's left (the art source's per-instance rim, × its HERO_INK rim). */
const RIM = { coat: 0.5, collar: 0.5, pants: 0.5, armor: 0.6, hair: 0.6, hairTip: 0.6, lining: 0.5, shirt: 0.4 };

// ---------------------------------------------------------------- the ink (shared per part: see above)
// Per part id: the inner ink line [r, g, b, gain], the silhouette's ink [r, g, b, gain], and the pass's
// [fill gain, stroke style, far line, far fill] (model.js heroPartValues). An ink gain over 1.5 keeps the
// silhouette at full light at the game camera (pipeline.js: `step(pInk.a, 1.5)`): the coat's edge is the
// one thing that must read there; its inner seams fade (far line low). That is the lifted print he
// shipped with (`?onePrint=0`); the quiet one (a, b) is quietTable below.
const JADE = [0.62, 1.0, 0.84], WHITE_JADE = [0.86, 1.0, 0.94];
const line = (c, s, a) => [c[0] * s, c[1] * s, c[2] * s, a];
function inkTable(look, phase, print = onePrintNow(), body = oneBodyNow()) {
  if (body !== '0') return bodyTable(look, phase, body);
  if (print !== '0') return quietTable(look, phase);
  const rim = look === 'c' ? WHITE_JADE : JADE;
  const k = phase >= 3 ? 1.35 : 1; // phase 3: the coat's edge brighter
  return {
    // 6 the coat and its collar: jade seams up close, a jade silhouette that holds at any distance
    6: { ink: line(rim, 0.36, 1.6), rim: line(rim, 0.95 * k, 1.0), fill: [1, 0, 0.12, 1.0] },
    // 4 the coat's inside (lining, the collar's inner face): a darker jade
    4: { ink: line(rim, 0.3, 1.6), rim: line(rim, 0.8 * k, 1.0), fill: [1, 0, 0.12, 0.9] },
    // 5 the trousers, 12 the boots and the guns: the same edge, quieter
    5: { ink: line(rim, 0.3, 1.6), rim: line(rim, 0.7 * k, 1.0), fill: [1, 0, 0.1, 0.6] },
    12: { ink: line(rim, 0.34, 1.6), rim: line(rim, 0.8 * k, 1.0), fill: [1, 0, 0.2, 0.8] },
    // 3 the shirt in the open V
    3: { ink: line(rim, 0.3, 1.0), rim: line(rim, 0.6 * k, 1.0), fill: [1, 0, 0.1, 0.5] },
    // 11 the short dark hair: a jade edge round the head
    11: { ink: line(rim, 0.34, 1.6), rim: line(rim, 0.85 * k, 1.0), fill: [1.0, 8, 0.15, 0.8] },
    // 1 the pale face and hands: a pale line, the letters lit to the edge (`open`)
    1: { ink: [0.75, 0.85, 0.8, 0.8], rim: [0.85, 0.95, 0.9, 0.9], fill: [2.2, 4, 0, 0.75] },
    // 2 the glasses: a dark band, its outline dim
    2: { ink: [0.2, 0.3, 0.26, 0.8], rim: [0.25, 0.35, 0.3, 0.8], fill: [1, 0, 0, 1] },
    // 19 the bright cells (the glint, the muzzles, the buttons): unbroken, glowing
    19: { ink: [0.9, 1.3, 1.1, 1.8], rim: [0.9, 1.3, 1.1, 1.8], fill: [1, 2, 1, 1.4] },
  };
}

/** The quiet print (`?onePrint=a|b`): the hero's rules for his own cloth (model.js HERO_INK), in his
 *  jade. Every ink gain at or under 1.5, so the silhouette fades with distance as the hero's does (to
 *  uHeroLod.w of its light at the game camera); the jade edge at `rim` of the lifted one's; far line 0
 *  (no seams at the game camera: a field of letters there; the ink lines come back up close); the face
 *  and hands at the hero's skin numbers (HERO_SKIN = HERO_INK.skin's), their fill held down by
 *  `skinFill` (tintOne); the bright cells (the glint, the muzzles, the Cassock's buttons) plain letters
 *  under the bloom threshold. Phase 3's edge `p3` times the quiet one (the lifted print's ratio). */
export const QUIET = Object.freeze({ rim: 0.55, ink: 1.0, p3: 1.35, skinFill: 0.62 });
export const HERO_SKIN = Object.freeze({ gain: 2.2, far: 0.6, line: 0.75, rim: 0.85 });
function quietTable(look, phase) {
  const rim = look === 'c' ? WHITE_JADE : JADE;
  const e = QUIET.rim * (phase >= 3 ? QUIET.p3 : 1), a = QUIET.ink;
  return {
    6: { ink: line(rim, 0.42, a), rim: line(rim, 0.95 * e, 1.0), fill: [1, 0, 0, 1.0] },
    4: { ink: line(rim, 0.36, a), rim: line(rim, 0.8 * e, 1.0), fill: [1, 0, 0, 0.9] },
    5: { ink: line(rim, 0.36, a), rim: line(rim, 0.7 * e, 1.0), fill: [1, 0, 0, 0.6] },
    12: { ink: line(rim, 0.4, a), rim: line(rim, 0.8 * e, 1.0), fill: [1, 0, 0, 0.8] },
    3: { ink: line(rim, 0.3, a), rim: line(rim, 0.6 * e, 1.0), fill: [1, 0, 0, 0.5] },
    11: { ink: line(rim, 0.4, a), rim: line(rim, 0.85 * e, 1.0), fill: [1.0, 8, 0, 0.8] },
    1: { ink: [0.75, 0.85, 0.8, HERO_SKIN.line], rim: [0.85, 0.95, 0.9, HERO_SKIN.rim], fill: [HERO_SKIN.gain, 4, 0, HERO_SKIN.far] },
    2: { ink: [0.2, 0.3, 0.26, 0.8], rim: [0.25, 0.35, 0.3, 0.8], fill: [1, 0, 0, 1] },
    19: { ink: [0.75, 1.0, 0.88, 1.0], rim: [0.75, 1.0, 0.88, 1.0], fill: [1, 2, 0, 1.0] },
  };
}
/** The redraws' print (`?oneBody=a|b|c`): HERO_INK's cloth rules (model.js) in his jade-grey: the fill a lit
 *  body of letters (the bosses' print lifts it, ADR-194), the silhouette the cloth's dim DOTTED rim (style
 *  8), no ink gain over 1.5 (so nothing outlines him at the game camera: the jade outline round a dark
 *  fill was what read as a hollow bottle), the inner lines faint; the hem (part 8, the Duster's) the
 *  hero's pale dotted band. The far fills sit at about 0.6 of the hero's: the bosses' print lifts his
 *  near-grey fill to ~3x the hero's own coat (ADR-194), and at the game camera he printed as bright
 *  scattered letters round a dark middle; at these he is one dim body of letters as the hero is. Phase 3
 *  lifts the rim by BODY_INK.p3. */
export const BODY_INK = Object.freeze({ rim: [0.4, 0.6, 0.52, 0.8], line: [0.9, 1.0, 0.95], p3: 1.25 });
function bodyTable(look, phase) {
  const k = phase >= 3 ? BODY_INK.p3 : 1;
  const R = BODY_INK.rim, L = BODY_INK.line;
  const rim = [R[0] * k, R[1] * k, R[2] * k, R[3]];
  const ln = (a) => [L[0], L[1], L[2], a];
  return {
    6: { ink: ln(0.5), rim, fill: [1, 8, 0, 0.5] },
    4: { ink: ln(0.6), rim, fill: [1, 8, 0, 0.4] },
    5: { ink: ln(0.3), rim, fill: [1, 8, 0, 0.5] }, // (his coat and its inside too: one cloth, no hem; faint inner lines: no seams)
    12: { ink: ln(0.6), rim, fill: [1, 8, 0.2, 0.5] },
    3: { ink: ln(0.45), rim, fill: [1, 8, 0, 0.28] },
    8: { ink: [0.75, 0.95, 0.86, 0.75], rim: [0.68, 0.95, 0.84, 0.95], fill: [1, 9, 0, 1.1] },
    11: { ink: [0.62, 0.72, 0.68, 0.8], rim: [0.66, 0.78, 0.72, 0.9], fill: [1.2, 8, 0, 1.0] },
    1: { ink: [0.75, 0.85, 0.8, HERO_SKIN.line], rim: [0.85, 0.95, 0.9, HERO_SKIN.rim], fill: [HERO_SKIN.gain, 4, 0, HERO_SKIN.far] },
    2: { ink: [0.2, 0.3, 0.26, 0.8], rim: [0.25, 0.35, 0.3, 0.8], fill: [1, 0, 0, 1] },
    19: { ink: [0.75, 1.0, 0.88, 1.0], rim: [0.75, 1.0, 0.88, 1.0], fill: [1, 2, 0, 1.0] },
  };
}

/** The reference's jade (ADR-285): parts 7 and 9, the seam's bright line (no ink gain over 1.5: printed as his cloth is). */
export const REF_JADE = Object.freeze({ ink: [0.42, 1.3, 0.78, 1.4], rim: [0.5, 1.35, 0.85, 1.3], fill: [1.2, 8, 0, 0.9] });

/** The table his parts are written with (tests, the Lab). */
export const oneInkTable = (look, phase, print, body) => inkTable(look, phase, print, body);

/** Write his parts' ink into the shared per-part tables (the boss rigs' only: the player reads his own). */
function writeInk(U, look, phase, print, body = '0', ref = false) {
  const I = U?.uHeroPartInk?.value, R = U?.uHeroPartRim?.value, F = U?.uHeroPartFill?.value;
  if (!I || !R || !F) return false;
  const T = inkTable(look, phase, print, body);
  // (ADR-285, `?oneRef`: the jade-grey pieces: the seam, the cuffs, the collar's inner band (7, `facing`)
  // and the front panel's seam (9, `piping`): a jade line round a dim jade-grey fill, printed as his cloth)
  if (ref) T[7] = T[9] = REF_JADE;
  for (const p in T) {
    const t = T[p];
    I[p]?.set(t.ink[0], t.ink[1], t.ink[2], t.ink[3]);
    R[p]?.set(t.rim[0], t.rim[1], t.rim[2], t.rim[3]);
    F[p]?.set(t.fill[0], t.fill[1], t.fill[2], t.fill[3]);
  }
  return true;
}

/** His colours (the class's _tint): the outfit's fills and edge light on HIS material instances. */
export function tintOne(M) {
  if (!M) return;
  const T = ONE_TINT[oneLookNow()] ?? ONE_TINT.a;
  for (const k in T) setFill(M[k], T[k][0], T[k][1], T[k][2]);
  for (const k in RIM) {
    const u = M[k]?.uniforms?.uArtRim;
    if (u) u.value *= RIM[k];
  }
  // the redraws' hem (the Duster's pale ragged edge: part 8) in his jade-grey
  // (one coat: its inside the same cloth, and the coat and its inside printed as part 5, which the bosses'
  // print never breaks into the hero's pale hem: his coat is not the hero's cloak; BODY_INK's 5 = 6)
  if (oneBodyNow() !== '0') {
    setFill(M.hem, 0.3, 0.36, 0.33);
    const c = M.coat?.uniforms?.uArtFill?.value;
    if (c) setFill(M.lining, c.r, c.g, c.b);
    for (const k of ['coat', 'lining']) if (M[k]?.uniforms?.uArtPart) M[k].uniforms.uArtPart.value = 10;
  }
  // (ADR-285, `?oneRef`: the jade-grey seam, cuffs and inner band; the grey streak in his hair)
  if (oneRefNow()) {
    setFill(M.facing, 0.2, 0.52, 0.34);
    setFill(M.piping, 0.2, 0.52, 0.34);
    setFill(M.hairTip, 0.3, 0.32, 0.33);
  }
  const quiet = onePrintNow() !== '0';
  // (the quiet print: the face and hands held down as Tian Lei's were, ADR-155: lit, they printed as a
  // shaded 3D face; they stay the palest thing on him)
  if (quiet) M.skin?.uniforms?.uArtFill?.value.multiplyScalar(QUIET.skinFill);
  // the bright cells glow in jade-white (the flask part's own ink is amber for every rig); in the quiet
  // print they are plain bright letters (no glow, nothing over the bloom threshold)
  const fu = M.flask?.uniforms;
  if (fu) {
    if (fu.uGlowMask) fu.uGlowMask.value = quiet ? 0 : 1;
    fu.uInk?.value.setRGB(0.8, 1.2, 1.0);
    fu.uEmissive?.value.setRGB(0.7, 1.3, 1.0);
    if (fu.uGlow) fu.uGlow.value = quiet ? 0 : 0.6;
    if (quiet && fu.uArtGlowK) fu.uArtGlowK.value = 0;
  }
}

/** By phase: the coat's stir (anim.js reads a panel's `flare`, `breeze`, `idleFlare` every frame) and
 *  whether the front stands open. Per outfit: the Cassock never opens and barely stirs. `front` scales
 *  the front panels' stir (the closed front stays closed). That is the coat he shipped with (still in
 *  phase 1: `?onePrint=0`); COAT_QUIET (a, b) stirs in every phase. */
const COAT_DRESS = {
  a: [null, { open: false, flare: 0.06, breeze: 0.0, idle: 0.0, tail: 0.1 }, { open: true, flare: 0.1, breeze: 0.04, idle: 0.04, tail: 0.22 }, { open: true, flare: 0.12, breeze: 0.06, idle: 0.06, tail: 0.27 }],
  b: [null, { open: false, flare: 0.04, breeze: 0.0, idle: 0.0, tail: 0.06 }, { open: false, flare: 0.06, breeze: 0.02, idle: 0.02, tail: 0.12 }, { open: false, flare: 0.08, breeze: 0.03, idle: 0.03, tail: 0.16 }],
};
COAT_DRESS.c = COAT_DRESS.a;
/** ... the quiet print's: the tails and the side panels stir and flare from phase 1 (a still coat was
 *  half of why he looked stiff); the closed front barely (`front`), so it never parts before phase 2. */
const COAT_QUIET = {
  a: [null, { open: false, flare: 0.07, breeze: 0.03, idle: 0.03, tail: 0.16, front: 0.35 }, ...COAT_DRESS.a.slice(2)],
  b: [null, { open: false, flare: 0.05, breeze: 0.015, idle: 0.015, tail: 0.09, front: 0.35 }, ...COAT_DRESS.b.slice(2)],
};
COAT_QUIET.c = COAT_QUIET.a;

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
/** How long into his reload the guns are gone (s: thrown away, the next pair not yet drawn). */
const RELOAD_EMPTY = 0.32;

/** The blows thrown with the right hand closed (A1.1 - A1.4, the Falling Fist); the rest open (ADR-285). */
const FIST_BLOWS = new Set(['cross', 'backfist', 'hook', 'jab', 'uppercut', 'hammer']);
/** His right hand now: 'fist' through a fist blow, 'palm' through a palm blow (and the Source's palms), else
 *  'open' (the guard's offer, kicks, reactions): through the beat in progress, from its windup on. */
function handNow(A) {
  const B = A?.beats;
  if (!B?.length) return 'open';
  const t = fin(A.t, 0);
  let b = B[B.length - 1];
  for (const x of B) if (t <= x.end) { b = x; break; }
  if (t > b.end + 0.25) return 'open'; // (into the recovery: the hand opens again)
  const f = b.def ?? {};
  if (FIST_BLOWS.has(f.blow) || f.fist || f.iron || f.stance || String(f.part ?? '').startsWith('elbowR')) return 'fist';
  if (f.blow === 'palm' || f.blow === 'double' || f.part === 'palms') return 'palm';
  return 'open';
}

/** A coat anchor turned to `az` round the pelvis (sheet.js panelSkirt's placement, the same numbers). */
function turnFront(F, az) {
  const { C, R } = F;
  const sa = Math.sin(az), ca = Math.cos(az);
  const r0 = 1 / Math.hypot(sa / R.coatR, ca / (R.coatR * 0.69)) + (C.def.out ?? 0) * 0.5;
  C.anchor.position.set(sa * r0, R.coatY, ca * r0);
  C.anchor.rotation.y = az;
  C.def.az = az;
  C.r0 = r0;
}

/** The quiet print's coat: how far a panel may swing in all (its two segments together, rad, from
 *  hanging straight down along the hips; anim.js _coat's own limits allow 2.5 out and 0.9 in). He flips
 *  and cartwheels: upside down the springs threw a panel over 120 degrees out, back across his chest and
 *  arms, and a strong inward swing put the hem through his legs. Out to `out` the tails lag and fly; past
 *  it they would stand out straight. (The springs move the cloth smoothly, so a hard stop at the limit
 *  does not pop.) */
export const COAT_SWING = Object.freeze({ out: 0.87, in: 0.35 }); // (50 deg out: at 75 the flips read as a crown of planks)
/** ... the one coat's (`?oneBody=`): it swings out 30 degrees at most, so through his flips and kicks its
 *  overlapping panels stay one coat instead of fanning into boards. */
export const COAT_SWING_ONE = Object.freeze({ out: 0.52, in: 0.3 });

/** After the animator (dress runs after _animate in the same frame): hold each panel inside COAT_SWING,
 *  the spring's state too (so it does not wind up against the limit). */
function clampCoat(d, S = COAT_SWING) {
  const st = d.anim?.coatState, coat = d.rig?.coat;
  if (!st || !coat) return;
  for (let i = 0; i < coat.length; i++) {
    const s = st[i], C = coat[i];
    if (!s || !C?.segs) continue;
    const a = s[0], b = s[1], tot = a.x + b.x;
    const want = tot < -S.out ? -S.out : tot > S.in ? S.in : tot;
    if (want === tot || !Number.isFinite(tot) || Math.abs(tot) < 1e-6) continue;
    // both segments scaled alike (the panel keeps its curve), their swing toward the limit stopped
    const k = want / tot;
    a.x *= k;
    b.x *= k;
    if (tot < 0) {
      if (a.vx < 0) a.vx = 0;
      if (b.vx < 0) b.vx = 0;
    } else {
      if (a.vx > 0) a.vx = 0;
      if (b.vx > 0) b.vx = 0;
    }
    C.segs[0].rotation.x = a.x;
    C.segs[1].rotation.x = b.x;
    C.segs[0].updateMatrixWorld(true);
  }
}

/**
 * Once a frame (the actor's): show the dressing of his phase. A phase change flips the pieces'
 * `visible` flags, opens or closes the coat's front and sets its stir, and writes his ink; otherwise
 * only the reload's empty hands are read.
 */
export function dressOne(d, dt) {
  const D = d?.rig?.root?.userData?.dress;
  if (!D || D.kind !== 'one') return;
  const n = Math.min(3, Math.max(1, fin(d.dressPhase ?? d.phase, 1) | 0));
  if (!D.inked || n !== D.phase) D.inked = writeInk(d.game?.U, D.look, n, D.print, D.body, !!D.ref);
  if (n !== D.phase) {
    D.phase = n;
    for (const e of D.at) e.m.visible = n >= e.from && n <= e.to;
    const TAB = D.print === '0' && D.body === '0' ? COAT_DRESS : COAT_QUIET;
    const S0 = (TAB[D.look] ?? TAB.a)[n];
    // (the Open Coat and the Duster stand open from phase 1: the legs walk in the split)
    const S = (D.body === 'b' || D.body === 'c' || (D.ref && D.body !== '0')) && !S0.open ? { ...S0, open: true, front: 0.8 } : S0;
    const fk = S.front ?? 1;
    for (const F of D.fronts) turnFront(F, S.open ? F.open : F.closed);
    for (const P of D.panels) {
      P.def.flare = P.tail ? S.tail : P.front ? S.flare * 0.6 : S.flare;
      P.def.breeze = S.breeze * (P.tail ? 1.6 : P.front ? fk : 1);
      P.def.idleFlare = S.idle * (P.tail ? 1.4 : P.front ? 0.3 * fk : 1);
    }
    D.reload = !D.reload; // (re-read the guns below)
  }
  if (D.print !== '0' || D.body !== '0') clampCoat(d, D.body !== '0' ? COAT_SWING_ONE : COAT_SWING);
  // (ADR-285: the reference's right hand: open, a fist only through a fist blow and with the guns)
  if (D.rOpen) {
    const h = n === 2 ? 'fist' : handNow(d.brain?.act);
    if (h !== D.rHand) {
      D.rHand = h;
      D.rOpen.visible = h === 'open';
      if (D.rPalm) D.rPalm.visible = h === 'palm';
      for (const m of D.rFist) m.visible = h === 'fist';
    }
  }
  // the guns: phase 2 only; gone from the start of his reload until he draws the next pair
  const empty = !!d.iron?.reloading && fin(d.brain?.act?.t, 1) < RELOAD_EMPTY;
  if (empty !== D.reload) {
    D.reload = empty;
    for (const g of D.guns) g.visible = n === 2 && !empty;
  }
}
