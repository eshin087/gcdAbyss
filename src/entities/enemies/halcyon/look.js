import { lookOf } from '../duelist/lookSwitch.js';
import { setFill } from '../ashDisciple/bodyArt.js';

// Halcyon's look options (duelist/lookSwitch.js PENDING; never in PICKED: the owner picks from the
// sheets, docs/looks/halcyon/; ADR-161). Every option is drawn in the hero's INK-LINE art, dense and
// bright (the owner, of the bosses they kept: "make it look detailed like the main character").
//   ?halLook=a   the owner's answer (2026-11-22, "Recognizable") and their pick from the sheets (2026-11-23;
//                lookSwitch PICKED): a deep blue
//                armoured suit, a long red cape, a gold belt and gold trim at the wrists and the boots,
//                red boots, dark slick hair, eyes two red points, thin pale neon seams on the plates; a
//                plain gold clasp at each shoulder where the cape pins. Nothing on the chest.
//            b   the idol: a navy suit, gold shoulder pieces of his own shape, white gloves, a cape with
//                a bright lining, blond slick hair.
//            c   tomorrow's tyrant: black and chrome, a crimson cape, white hair.
//   ?halRef=a   THE ANCHOR (ADR-289; docs/art/character-packs-v04/halcyon, 00 and 01: the owner's selected
//                identity, 2026-11-28; PENDING, waiting for the owner; over any ?halLook=, as ADR-277's
//                ?lordRef=a): his body REBUILT after the sheets (refGear.js: a V-tapered man in sculpted navy
//                plates edged in gold, a square jaw, blond hair swept back, bare hands, gold-capped boots, a
//                crimson mantle and a cape to his heels), coloured as the outfit 'd' below; his eyes dim
//                until they kindle. More objects than the shipped rig, only under the switch.
//   ?glare=a|b|c   his eyes' heat (fx.js; the owner picked a, 2026-11-23): a crimson with a white-hot steel core, b crimson alone, c the
//                  engine's orange fire with a steel core.
//   ?halCape=0|1|2|3   how his cape and colours read at game size (the look pass of 2026-11-23: at
//                  ~40 px tall the cape hung hidden behind him from the front, its red printed pink under
//                  the moonlit rim, the suit purple, the gold cream). Graded steps of one idea:
//                  0  as he first shipped;
//                  1  the colours: a clean bright red cape inside and out, no cool rim on it, a brighter
//                     blue suit, a clear gold (HAL_BRIGHT);
//                  2  + the cape's shape: wider at the shoulders, its sheets spread to both sides so it
//                     frames him from the front, longer, flaring out (CAPE_SHAPE[2], gear.js);
//                  3  + it never hangs still: a gentle billow while he hovers, a longer trail in a pass
//                     (the streamers' `breeze`, player/anim.js; CAPE_SHAPE[3]).
//                  The default is the step recommended to the owner (HAL_CAPE_STEP), and the owner
//                  picked it: 3 (2026-11-23; lookSwitch PICKED).
//   The owner, after picking step 3 (2026-11-23): "make his cape smaller, make him look more ascii like to
//   look like the main character ascii look more ascii made up". Tian Lei's answer to the same words
//   (ADR-155) is the model; three switches, the owner picked the recommended a / a / b (2026-11-23;
//   lookSwitch PICKED; ADR-166):
//   ?halLetters=0|a   a: his letters follow his size on screen by the hero's rule (his kit's `letters`,
//                  ARCHITECTURE "The bosses' letters"; read live); 0 the bosses' fixed fine cell.
//   ?halPrint=0|a|b   0: the step-3 print (a lit figure, a strong edge); a: the hero's quieter print
//                  (Tian Lei's ASC_QUIET numbers: a darker field of letters, a softer edge); b: between.
//   ?halCapeSize=0|a|b|c   the cape's length and spread: 0 as picked, a ~80 %, b ~65 %, c ~50 % (to the
//                  back of his knees); its colours and its billow kept.
// (?city=a|b|c is the set's: world/halcyonPlaza.js.)
// Read when his rig is built (a reload), but halLetters (live).
export const HAL_CAPE_STEP = '3';
export const HAL_LOOKS = Object.freeze({ halLook: 'a', glare: 'a', halCape: HAL_CAPE_STEP, halLetters: 'a', halPrint: 'a', halCapeSize: 'b' });
export const halLook = (name) => lookOf(name, HAL_LOOKS[name] ?? 'a');

/** His letters follow his size as the hero's do (`?halLetters=a`; live: his kit's `letters` getter). */
export function halLettersOn() {
  return halLook('halLetters') === 'a';
}

/** The print (`?halPrint=0|a|b`): his fills times `fill` (per part), the rim on his suit times `rim`
 *  (in place of HAL_LIFT.rim); 0 = none (the step-3 print). Tian Lei's quieter print (ASC_QUIET: cloth
 *  x 0.85, skin x 0.62, rim x 1.5) is a; b is halfway. The gold and the cape's red keep their fill. */
export const HAL_PRINT = {
  a: { fill: { pants: 0.85, armor: 0.85, piping: 0.8, collar: 0.85, welt: 0.85, skin: 0.62, shirt: 1.0, lining: 0.9, coat: 0.9, hem: 0.85 }, rim: 1.5 },
  b: { fill: { pants: 0.92, armor: 0.92, piping: 0.9, collar: 0.92, welt: 0.92, skin: 0.8, shirt: 1.0, lining: 0.95, coat: 0.95, hem: 0.92 }, rim: 2.2 },
};
export function halPrintNow() {
  const o = halLook('halPrint');
  return o === 'a' || o === 'b' ? o : '0';
}

/** The cape's size (`?halCapeSize=`): its sheets' length and width times this. */
export const HAL_CAPE_SIZE = Object.freeze({ 0: 1, a: 0.8, b: 0.65, c: 0.5 });
export function halCapeSizeNow() {
  return HAL_CAPE_SIZE[halLook('halCapeSize')] ?? HAL_CAPE_SIZE[HAL_LOOKS.halCapeSize];
}

/** The cape step his rig is built with: 0..3 (an unknown value draws the default). */
export function halCapeNow() {
  const n = Number(halLook('halCape'));
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : Number(HAL_CAPE_STEP);
}

/** The reference pack's look is on (`?halRef=a`, ADR-289; read when his rig is built). */
export const halRefOn = () => lookOf('halRef', '0') !== '0';

/** The outfit his rig is built in: 'a' | 'b' | 'c', or 'd' (the anchor: `?halRef=a`); an unknown value draws a. */
export function halLookNow() {
  if (halRefOn()) return 'd';
  const o = halLook('halLook');
  return o === 'b' || o === 'c' ? o : 'a';
}

/** Per outfit, the ink-line fill of each of his material instances (linear; gear.js says which is which). */
export const HAL_TINT = {
  a: {
    pants: [0.07, 0.12, 0.42], armor: [0.14, 0.24, 0.72], piping: [0.55, 0.85, 1.05], trim: [0.85, 0.6, 0.14],
    collar: [0.55, 0.06, 0.05], coat: [0.62, 0.05, 0.04], lining: [0.24, 0.02, 0.02], hem: [0.5, 0.035, 0.03],
    shirt: [0.05, 0.04, 0.035], welt: [0.06, 0.1, 0.32], skin: [0.86, 0.6, 0.45],
  },
  b: {
    pants: [0.03, 0.045, 0.16], armor: [0.06, 0.09, 0.26], piping: [0.85, 0.75, 0.45], trim: [0.92, 0.66, 0.16],
    collar: [0.5, 0.06, 0.05], coat: [0.58, 0.045, 0.04], lining: [0.88, 0.7, 0.32], hem: [0.82, 0.62, 0.22],
    shirt: [0.88, 0.68, 0.3], welt: [0.85, 0.85, 0.82], skin: [0.86, 0.6, 0.45],
  },
  c: {
    pants: [0.03, 0.03, 0.035], armor: [0.5, 0.52, 0.56], piping: [1.0, 0.2, 0.15], trim: [0.68, 0.7, 0.74],
    collar: [0.04, 0.04, 0.045], coat: [0.42, 0.015, 0.03], lining: [0.12, 0.01, 0.015], hem: [0.32, 0.01, 0.02],
    shirt: [0.85, 0.85, 0.88], welt: [0.05, 0.05, 0.06], skin: [0.84, 0.6, 0.46],
  },
  // the anchor (gear.js: the hair in `hairTip`, the seams and the strap in the gold, the hands bare)
  d: {
    pants: [0.035, 0.05, 0.2], armor: [0.06, 0.09, 0.34], piping: [0.85, 0.6, 0.14], trim: [0.85, 0.6, 0.14],
    collar: [0.04, 0.055, 0.22], coat: [0.62, 0.05, 0.04], lining: [0.24, 0.02, 0.02], hem: [0.5, 0.035, 0.03],
    shirt: [0.05, 0.04, 0.035], welt: [0.06, 0.1, 0.32], skin: [0.86, 0.6, 0.45], hairTip: [0.95, 0.72, 0.32],
  },
};
/**
 * ?halCape=1 and up: the colours that read at game size, per outfit (replacing HAL_TINT's entries). a:
 * the cape a clean red inside and out (from the front it is its inside that shows: the `lining` part
 * prints dim, so it is lit past 1), red boots, a brighter blue suit, a gold that prints gold, not cream
 * (`hair`: gear.js goldOf). b: navy and gold, the cape's bright
 * gold lining showing. c: black and chrome, a crimson cape.
 */
export const HAL_BRIGHT = {
  a: {
    pants: [0.07, 0.18, 0.72], armor: [0.1, 0.3, 1.1], piping: [0.5, 0.9, 1.15], hair: [0.95, 0.55, 0.04],
    collar: [0.95, 0.06, 0.04], coat: [1.15, 0.07, 0.04], lining: [2.4, 0.15, 0.08], hem: [1.6, 0.1, 0.06],
    welt: [0.06, 0.12, 0.45],
  },
  b: {
    pants: [0.02, 0.04, 0.24], armor: [0.04, 0.08, 0.38], piping: [1.1, 0.75, 0.2], hair: [1.0, 0.6, 0.05],
    collar: [0.04, 0.06, 0.3], coat: [0.9, 0.06, 0.05], lining: [2.2, 1.35, 0.25], hem: [1.7, 1.1, 0.2],
    welt: [1.0, 1.0, 0.96],
  },
  c: {
    pants: [0.025, 0.025, 0.03], armor: [0.8, 0.84, 0.92], piping: [1.2, 0.12, 0.1], trim: [0.95, 0.98, 1.05],
    collar: [0.03, 0.03, 0.035], coat: [0.85, 0.02, 0.1], lining: [2.0, 0.04, 0.22], hem: [1.3, 0.03, 0.14],
  },
  // the anchor: a navy that stays navy at game size (a's blue printed bright blue), a deep red cape, a
  // clear gold, a pale blond
  d: {
    pants: [0.045, 0.075, 0.36], armor: [0.07, 0.13, 0.6], hair: [0.95, 0.58, 0.05], hairTip: [1.05, 0.78, 0.34],
    collar: [0.05, 0.08, 0.34], coat: [3.3, 0.2, 0.12], lining: [3.3, 0.2, 0.12], hem: [1.4, 0.08, 0.05],
  },
};
/** The anchor's own print (`?halRef=a`): the fill each part keeps (linear, before the key light) and its ink
 *  lines' colour, so he reads solid as on the sheets: a navy suit, navy-blue plates, gold, a crimson cape,
 *  the blond, the skin. */
export const HAL_OWN = {
  pants: { fill: [0.07, 0.1, 0.34], ink: [0.3, 0.38, 0.8] },
  armor: { fill: [0.11, 0.15, 0.48], ink: [0.55, 0.65, 1.1] },
  collar: { fill: [0.07, 0.1, 0.34], ink: [0.3, 0.38, 0.8] },
  hair: { fill: [0.75, 0.48, 0.08], ink: [1.1, 0.75, 0.2] },
  hairTip: { fill: [1.0, 0.72, 0.3], ink: [1.2, 0.9, 0.45] },
  coat: { fill: [1.0, 0.07, 0.06], ink: [1.0, 0.14, 0.1] },
  lining: { fill: [0.95, 0.06, 0.05], ink: [1.0, 0.14, 0.1] },
  skin: { fill: [0.4, 0.21, 0.15], ink: [0.6, 0.34, 0.24] },
};
/** ?halCape=1 and up: the cape's own rim (the cool moonlit edge turned the red pink) and the lift. */
const BRIGHT_RIM = { coat: 0.1, lining: 0.1, hem: 0.1, collar: 0.3, trim: 0.3 };

/** The eyes' light by --glare (the `flask` part: its fill, ink lines, emissive). */
const EYES = { fill: [1.0, 0.08, 0.05], ink: [1.6, 0.2, 0.12], em: [1.4, 0.1, 0.06] };

/** The lift that keeps him readable on the dark street (as Tian Lei's ASC_LIFT): fill multipliers and the rim. */
export const HAL_LIFT = { fill: { pants: 1.5, armor: 1.3, coat: 1.25, collar: 1.3 }, rimOn: ['pants', 'armor', 'coat', 'lining', 'collar', 'trim', 'skin', 'shirt'], rim: 3.0 };

/** His colours (the class's _tint), once after his rig is built. */
export function tintHalcyon(M) {
  if (!M) return;
  const o = halLookNow(), bright = halCapeNow() >= 1;
  const T = bright ? { ...HAL_TINT[o], ...HAL_BRIGHT[o] } : HAL_TINT[o] ?? HAL_TINT.a;
  for (const k in T) M[k]?.uniforms?.uArtFill?.value.setRGB(T[k][0], T[k][1], T[k][2]);
  if (!bright) for (const k in HAL_LIFT.fill) M[k]?.uniforms?.uArtFill?.value.multiplyScalar(HAL_LIFT.fill[k]);
  const P = HAL_PRINT[halPrintNow()];
  for (const k of HAL_LIFT.rimOn) {
    const u = M[k]?.uniforms?.uArtRim;
    if (u) u.value *= bright && k in BRIGHT_RIM ? BRIGHT_RIM[k] : P ? P.rim : HAL_LIFT.rim;
  }
  // ?halPrint=a|b: the hero's quieter print (ADR-166)
  if (P) for (const k in P.fill) M[k]?.uniforms?.uArtFill?.value.multiplyScalar(P.fill[k]);
  // (d, the anchor: the cape's own ink red, so its lines print red, not pale)
  if (o === 'd') {
    // the sheets print him solid in his own colours: every part keeps its own fill (uArtOwn: none of the
    // bosses' shared tone, pale hem or dark falloff), at HAL_OWN's brightness
    for (const k in HAL_OWN) {
      const u = M[k]?.uniforms;
      if (!u) continue;
      if (u.uArtOwn) u.uArtOwn.value = 1;
      u.uArtFill?.value.setRGB(...HAL_OWN[k].fill);
      if (HAL_OWN[k].ink) u.uInk?.value.setRGB(...HAL_OWN[k].ink);
    }
  }
  // the neon seams light themselves a little (their ink lines glow), the eyes burn
  const pu = M.piping?.uniforms;
  if (pu?.uInkGlow) pu.uInkGlow.value = 0.5;
  const fu = M.flask?.uniforms;
  if (fu) {
    if (fu.uGlowMask) fu.uGlowMask.value = 1;
    fu.uInk?.value.setRGB(...EYES.ink);
    fu.uEmissive?.value.setRGB(...EYES.em);
    fu.uArtFill?.value.setRGB(...EYES.fill);
  }
}

/** The dressing record on his rig (gear.js registers the pieces that change by phase). */
export function dressOf(root) {
  return (root.userData.dress ??= { kind: 'hal', phase: 0, at: [], look: halLookNow() });
}
/** Show mesh `m` from phase `from` to phase `to`. */
export function at(D, m, from, to = 9) {
  D.at.push({ m, from, to });
  m.visible = from <= 1 && to >= 1;
}

const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

/**
 * Once a frame (kit.dress): the cape torn to tatters from phase 3 (a few `visible` flags when the phase
 * changes); the eyes' light (never out while he lives; brighter through a windup of his eyes, d.eyesK).
 */
export function dressHalcyon(d) {
  const D = d?.rig?.root?.userData?.dress;
  if (!D || D.kind !== 'hal') return;
  const n = Math.min(3, Math.max(1, (d.dressPhase ?? d.phase) | 0));
  if (n !== D.phase) {
    D.phase = n;
    for (const e of D.at) e.m.visible = n >= e.from && n <= e.to;
  }
  const fu = d.rig.materials.flask?.uniforms;
  if (fu) {
    const dead = d.mode === 'dead' || (d.mode === 'dying' && d.brain.modeT > 1.6);
    // (the anchor, ?halRef=a: his eyes a dim red at rest, as on its face sheet; they kindle the same)
    const e = Math.min(1, fin(d.eyesK));
    const k = dead ? 0 : (D.look === 'd' ? 0.22 + 1.38 * e : 0.7 + 0.9 * e) + 0.08 * Math.sin(fin(d.time) * 9);
    if (fu.uGlow) fu.uGlow.value = k;
    if (fu.uInkGlow) fu.uInkGlow.value = k;
  }
}

/** For tools: re-colour a rig (the look sheets). */
export function setHalFill(M, part, rgb) {
  setFill(M[part], ...rgb);
}
