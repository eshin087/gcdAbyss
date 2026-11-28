import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import { registerItem } from '../../player/gear/index.js';
import { buildFreeHand } from '../../player/gear/hands.js';
import { shapedHand } from '../../player/gear/handShape.js';
import { panelSkirt } from '../../player/gear/sheet.js';
import {
  gridGeometry, shellGeometry, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, lerp, limb, gripFist, orient,
  orientTo, clumpGeometry, partGeometry,
} from '../../player/heroGeo.js';
import { oneLookNow, onePrintNow, oneBodyNow, oneRefNow, dressOf, at } from './look.js';

// Xin Yi's gear: the hero's skeleton (built by the same buildHero(U, loadout), driven by the same
// animator) in the hero's ink-line art, bare-handed as Tian Lei (no weapon: the right fist hangs on the
// sword joint; ONE_FIST). The homage is carried by the silhouette at ~40 px: a long black coat to the
// ankles whose tails split behind and fly, a high stand collar, short dark hair, small dark glasses, a
// pale face and pale hands; two small handguns in phase 2. One `one.*` item per slot:
//   one.head   short dark hair swept back (the body's hair left out), the glasses: a dark band (two
//              small lenses and a bridge) with one bright cell (a glint on his left lens)
//   one.chest  the coat's torso and its high collar (a, c: closed in phase 1, open in a V from phase 2,
//              the shirt in the V; b: buttoned to the neck, a line of bright buttons down the chest, a
//              lower band collar)
//   one.arms   the coat's sleeves to the wrist, pale hands (the right fist on the sword joint)
//   one.legs   dark trousers, black boots
//   one.coat   the coat's skirt: six panels from under the belt line to the ankles (sheet.js panelSkirt,
//              the animator's coat springs): two front panels (closed: they overlap; open: look.js turns
//              their anchors apart), two sides, two tails split by a vent behind. Waist slot
//   one.guns   a small dark handgun in each hand, one bright cell at the muzzle; phase 2 only (look.js);
//              in the weapon slot (it is what he holds, and it hangs on the sword joint)
// The options (`?oneLook=a|b|c`, look.js oneLookNow; read when his rig is built): a the Long Coat,
// b the Cassock (narrow, closed, floor-length, it barely stirs), c the Grey Coat (a's cut; look.js colours).
// After the reference pack (`?oneRef=a`, ADR-285, look.js oneRefNow; read when his rig is built), on the
// figure of `?oneBody=`: the collar tall and split in front over a pale inner band, the coat's torso open in
// every phase, the offset jade-grey seam down his left front (the torso's V edge and the front panel's
// inner edge), jade cuffs, the glasses' jade temples, a grey streak swept back over his right temple, the
// skirt to the floor with a wider hem, squarer guns (their muzzle cells where they were: the shots leave
// from them). The jade-grey pieces are the `facing` / `piping` materials (parts 7 / 9, look.js inks them).
// The quiet print (`?onePrint=a|b`, ADR-170, look.js onePrintNow; '0' the shapes he shipped with) draws the small
// parts as the letters can hold them: the glasses one dark band across the eyes (no arms, no bridge;
// the glint one small plain cell), the high collar one shape (its inside the coat's own cloth: no lining
// edge), the open V a flat fill of shirt (no lapel facings).
//
// His materials are his own instances (look.js tintOne writes the colours): `coat` / `collar` the coat,
// `lining` its inside (and the skirt's back faces), `collarIn` the collar's inner face, `shirt` the shirt
// in the open V, `pants` the trousers, `armor` the boots and the guns' bodies, `skin` the face and hands,
// `eye` the glasses' lenses, `hair` the hair, `flask` the bright cells (the glint, the muzzles, the
// Cassock's buttons). Every piece that changes with his phase is kept out of the static merge and
// registered with the phases it shows in (look.js `at`, `D.guns`, `D.fronts`, `D.panels`).

const ySp = (h) => h - 1.035; // world idle height → spine space (REST.spine)
const yCh = (h) => h - 1.225; // → chest space (REST.chest)

// ================================================================= the head
// Head space (before BODY.headScale): the scalp is the ellipsoid BODY.head (c [0, 0.154, -0.007],
// r [0.105, 0.118, 0.112]); the face looks down +Z; his left is +X.
const SC = [0, 0.154, -0.007], SR = [0.105, 0.118, 0.112];
const scalp = (az, el, k = 0.93) => [SC[0] + Math.sin(az) * Math.cos(el) * SR[0] * k, SC[1] + Math.sin(el) * SR[1] * k, SC[2] + Math.cos(az) * Math.cos(el) * SR[2] * k];
const nrm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Short dark hair, close to the head: the scalp cap, and a shell over the back and the sides of the
 *  skull down to the nape (the body's hair is left out: `hidesHair`), its front sunk inside the face. */
function hairGeometry(DIM) {
  const [sx, sy, sz] = DIM.skull;
  if (oneBodyNow() !== '0') {
    // the redraws: a fuller head of short hair swept back (the head was three letters from above): the
    // crown raised and pushed back, the sides and the nape fuller, the hairline over the brow
    const crown = ellipsoidGeometry(0.1, 0.085, 0.112, { widthSegs: 16, heightSegs: 10 }).translate(sx, sy + 0.05, sz - 0.012);
    const back = ellipsoidGeometry(0.098, 0.104, 0.1, { widthSegs: 16, heightSegs: 10 }).translate(sx, sy + 0.006, sz - 0.03);
    if (!oneRefNow()) return { cap: sub(crown, 0), back: sub(back, 1) };
    // (ADR-285: a grey streak swept back from over his right temple: a band lying ON the crown, from the
    // hairline over the top toward the back, a little to his right (-X))
    const band = (flip) => gridGeometry(3, 10, (u, t, o) => {
      const be = lerp(0.36, 0.62, u), ph = lerp(0.3, 2.1, t), k = 1.025;
      o[0] = sx - Math.sin(be) * 0.1 * k;
      o[1] = sy + 0.05 + Math.sin(ph) * Math.cos(be) * 0.085 * k;
      o[2] = sz - 0.012 + Math.cos(ph) * Math.cos(be) * 0.112 * k;
      o[3] = o[0];
      o[4] = o[1];
    }, flip);
    const streak = mergeGeometries([band(false), band(true)]);
    return { cap: sub(crown, 0), back: sub(back, 1), streak: sub(streak, 0), locks: refLocks(sx, sy, sz) };
  }
  const back = ellipsoidGeometry(0.086, 0.098, 0.088, { widthSegs: 16, heightSegs: 10 }).translate(sx, sy + 0.012, sz - 0.026);
  return { cap: partGeometry('hair.cap'), back: sub(back, 1) };
}

/** The reference's hair (ADR-285, head space): not a cap but swept-back, uneven locks: spikes off the crown
 *  raked back, longer ones over the back of the skull to the collar, a few over the ears, two loose ones
 *  falling over his brow (T1, the anchor's face). Each a tapered clump (heroGeo clumpGeometry) rooted just
 *  inside the scalp, curling away from it. */
function refLocks(sx, sy, sz) {
  const C1 = [sx, sy + 0.05, sz - 0.012], R1 = [0.1, 0.085, 0.112];
  const C2 = [sx, sy + 0.006, sz - 0.03], R2 = [0.098, 0.104, 0.1];
  const on = (C, R, az, el, k = 0.9) => [C[0] + Math.sin(az) * Math.cos(el) * R[0] * k, C[1] + Math.sin(el) * R[1] * k, C[2] + Math.cos(az) * Math.cos(el) * R[2] * k];
  const out = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  // [which shell, az, el, dir, length, width, curl]
  const L = [
    // the crown: swept back along the skull, the tips lifting a little off it
    [1, 0.25, 1.0, [0.08, -0.12, -1], 0.13, 0.026, 0.1],
    [1, -0.2, 1.05, [-0.1, -0.08, -1], 0.14, 0.028, 0.12],
    [1, 0.62, 0.8, [0.4, -0.2, -1], 0.12, 0.024, 0.1],
    [1, -0.66, 0.78, [-0.45, -0.22, -1], 0.12, 0.024, 0.1],
    [1, 0.0, 0.72, [0.0, 0.1, -1], 0.11, 0.03, 0.14],
    // the back: down over the skull to the collar, the ends flicking out a little
    [2, Math.PI, 0.3, [0, -0.95, -0.28], 0.12, 0.032, 0.1],
    [2, Math.PI - 0.55, 0.25, [0.25, -0.95, -0.25], 0.11, 0.028, 0.12],
    [2, Math.PI + 0.55, 0.25, [-0.25, -0.95, -0.25], 0.11, 0.028, 0.12],
    [2, Math.PI - 1.0, 0.05, [0.35, -0.95, -0.1], 0.09, 0.024, 0.14],
    [2, Math.PI + 1.0, 0.05, [-0.35, -0.95, -0.1], 0.09, 0.024, 0.14],
    // over the ears
    [2, 1.45, 0.15, [0.2, -0.95, -0.2], 0.075, 0.02, 0.12],
    [2, -1.45, 0.15, [-0.2, -0.95, -0.2], 0.075, 0.02, 0.12],
    // two loose locks over his brow (his left, and one at the parting)
    [1, 0.42, 0.45, [0.3, -0.8, 0.5], 0.085, 0.018, 0.2],
    [1, 0.1, 0.55, [0.05, -0.65, 0.75], 0.07, 0.016, 0.25],
  ];
  const g = [];
  for (const [w, az, el, dir, len, wd, curl] of L) {
    const base = w === 1 ? on(C1, R1, az, el) : on(C2, R2, az, el);
    g.push(orientTo(clumpGeometry(len, wd, wd * 0.5, { curl, taper: 1.2, cols: 6, rows: 3 }), base, dir, out(az, el)));
  }
  return sub(mergeGeometries(g), 0);
}

/** The glasses (head space): two small dark lenses and a bridge across the eyes, thin arms back to the
 *  ears; the glint: one bright cell on the left lens. The face itself is the body's (model.js). */
function glassesGeometry(DIM) {
  const [sx, sy, sz] = DIM.skull;
  const y = sy - 0.011, z = sz + 0.096;
  const parts = [];
  for (const s of [-1, 1]) {
    // a small oval lens, a little wider than the eye, tilted to follow the face
    const lens = ellipsoidGeometry(0.025, 0.015, 0.006, { widthSegs: 10, heightSegs: 5 });
    lens.rotateY(s * 0.32).translate(sx + s * 0.035, y, z - 0.005);
    parts.push(sub(lens, s > 0 ? 1 : 0));
    // the arm from the lens's outer edge back along the side of the head
    parts.push(boxGeometry(0.006, 0.006, 0.09, sx + s * 0.068, y + 0.004, z - 0.06, 0, s * 0.12, 0));
  }
  parts.push(boxGeometry(0.022, 0.006, 0.006, sx, y + 0.004, z + 0.002));
  const glint = ellipsoidGeometry(0.011, 0.008, 0.004, { widthSegs: 6, heightSegs: 4 }).rotateY(0.32).translate(sx + 0.04, y + 0.004, z + 0.002);
  return { band: mergeGeometries(parts), glint };
}

/** The quiet print's glasses (head space): one dark band across the eyes, following the face's curve
 *  (the face is the body's ellipsoid, r [0.078, 0.09, 0.1] round DIM.skull), a little off it; the glint:
 *  one small cell on his left. No arms, no bridge: at the letters' size they were a scatter of lines. */
function bandGlassesGeometry(DIM) {
  const [sx, sy, sz] = DIM.skull;
  const y = sy - 0.011, A = 0.72, hh = 0.0135;
  const band = gridGeometry(10, 2, (s, t, o) => {
    const a = lerp(-A, A, s), h = lerp(-hh, hh, t);
    // the face's ellipse at this height, 7 mm out; the ends wrap back a little more (the temples)
    const k = Math.sqrt(Math.max(0, 1 - (h + y - sy) ** 2 / 0.0081));
    o[0] = sx + Math.sin(a) * (0.078 * k + 0.007);
    o[1] = y + h * (1 - 0.25 * Math.abs(s - 0.5));
    o[2] = sz + Math.cos(a) * (0.1 * k + 0.007);
    o[3] = a * 0.1;
    o[4] = o[1];
  });
  const ga = 0.36; // (the glint: on his left, high on the band)
  const glint = ellipsoidGeometry(0.009, 0.006, 0.003, { widthSegs: 6, heightSegs: 4 })
    .rotateY(ga).translate(sx + Math.sin(ga) * 0.087, y + 0.004, sz + Math.cos(ga) * 0.109);
  return { band: sub(band, 0), glint };
}

function buildHead(ctx) {
  const { head, M, DIM, mesh } = ctx;
  const H = hairGeometry(DIM);
  mesh(head, H.cap, M.hair);
  mesh(head, H.back, M.hair);
  if (H.streak) mesh(head, H.streak, M.hairTip);
  if (H.locks) mesh(head, H.locks, M.hair);
  const G = onePrintNow() === '0' ? glassesGeometry(DIM) : bandGlassesGeometry(DIM);
  mesh(head, G.band, M.eye);
  mesh(head, G.glint, M.flask);
  if (oneRefNow()) {
    // (ADR-285: the glasses' jade temples: a short bright bar back from each end of the band)
    const [sx, sy, sz] = DIM.skull;
    const tp = [];
    for (const s of [-1, 1]) tp.push(boxGeometry(0.005, 0.007, 0.03, sx + s * 0.071, sy - 0.008, sz + 0.046, 0, s * 0.5, 0));
    mesh(head, mergeGeometries(tp), M.flask);
  }
  return {};
}

// ================================================================= the torso and the collar
/** The torso shell (BODY.shell's heights; world), grown by `d`; `gap` = the open V's half-chord. */
const SHELL = [
  { y: 1.09, rx: 0.15, rz: 0.112 },
  { y: 1.21, rx: 0.136, rz: 0.102 },
  { y: 1.3, rx: 0.16, rz: 0.112, cz: 0.008 },
  { y: 1.37, rx: 0.186, rz: 0.123, cz: 0.014 },
  { y: 1.43, rx: 0.198, rz: 0.12, cz: 0.01 },
  { y: 1.475, rx: 0.172, rz: 0.104, cz: 0.003 },
  { y: 1.505, rx: 0.094, rz: 0.076 },
];
/** The redraws' build (`?oneBody=a|b|c`; look.js): a man's torso under the coat: the shoulders broader and
 *  squarer, the chest deeper, the waist drawn in at the belt (each ring's rx / rz grown by these, m). */
const SHELL_MAN = [
  { rx: -0.012, rz: -0.004 },
  { rx: -0.004, rz: 0.0 },
  { rx: 0.008, rz: 0.006 },
  { rx: 0.022, rz: 0.01 },
  { rx: 0.034, rz: 0.012 },
  { rx: 0.042, rz: 0.012 },
  { rx: 0.02, rz: 0.004 },
];
/** `?oneRef=a` (ADR-285): the pack's tall, slim build (shoulders 0.26 of his height, A2's proportion
 *  chart): the shipped torso drawn in a little at the chest and the waist, the shoulders unpadded. */
const SHELL_REF = [
  { rx: -0.016, rz: -0.008 },
  { rx: -0.012, rz: -0.006 },
  { rx: -0.01, rz: -0.004 },
  { rx: -0.006, rz: -0.002 },
  { rx: -0.008, rz: 0.0 },
  { rx: -0.006, rz: 0.0 },
  { rx: -0.004, rz: 0.0 },
];
/** The reference's figure is on (the look switch, on `?oneBody`'s redraws). */
const refFig = () => oneRefNow() && oneBodyNow() !== '0';
const shellOf = () => (oneBodyNow() === '0' ? SHELL : SHELL.map((r, i) => {
  const A = refFig() ? SHELL_REF[i] : SHELL_MAN[i];
  return { ...r, rx: r.rx + A.rx, rz: r.rz + A.rz };
}));
/** The open coat's V: wide at the collar, closing at the belt line (half-chord, m). */
const V_GAP = [0.0, 0.006, 0.026, 0.05, 0.06, 0.05, 0.03];
/** ... the reference's: open from the collar all the way down (one coat, never buttoned): the shirt in a
 *  narrow strip at the chest, the edges parting toward the waist, where the skirt's fronts take over. */
const V_GAP_REF = [0.07, 0.062, 0.052, 0.046, 0.044, 0.04, 0.03];
const vGap = () => (refFig() ? V_GAP_REF : V_GAP);
const rings = (d, gap = null) => shellOf().map((r, i) => ({ ...r, rx: r.rx + d, rz: r.rz + d, gap: gap ? gap[i] : 0, y: ySp(r.y) }));
/** A crease down each side and across the back (the coat's seams). */
const coatSeams = (x, y, z) => 0.5 + 0.7 * Math.sin(Math.atan2(x, z) * 2 + 0.6);

/**
 * The high collar (chest space): a band standing round the neck from the collar line up beside the
 * jaw, flaring out a little at the top, open in front (`open`: its half-angle, rad). `top` its height
 * (world). Outer face `M.collar`, inner face `M.collarIn` (BackSide: the camera looks down into it).
 */
function collarGeometry(top, open, flare = 0.018, fall = 0.075, flip = false) {
  const y0 = 1.485, cols = 22, rows = 3;
  return gridGeometry(cols, rows, (s, t, o) => {
    const a = open + s * (Math.PI * 2 - 2 * open);
    const h = lerp(y0, top, t);
    const rx = lerp(0.098, 0.084 + flare, t) + 0.004 * Math.sin(t * Math.PI);
    const rz = lerp(0.082, 0.078 + flare * 0.8, t);
    // its top edge falls toward the front opening (a coat collar stands tallest behind the head and
    // beside the jaw, and opens in front of the chin)
    const dip = t * fall * Math.pow(0.5 + 0.5 * Math.cos(a), 1.6);
    o[0] = Math.sin(a) * rx;
    o[1] = yCh(h - dip);
    o[2] = Math.cos(a) * rz - 0.014;
    o[3] = (a - Math.PI) * 0.09;
    o[4] = o[1];
  }, flip);
}
/** The collar's two faces: today's (outer `M.collar`, inner `M.collarIn` on the same sheet) or, in the
 *  quiet print, one shape: both faces the coat's own cloth (the inner one a reversed copy). */
function collarFaces(ctx, args) {
  const { chest, M, mesh } = ctx;
  const cg = collarGeometry(...args);
  if (onePrintNow() === '0') {
    mesh(chest, sub(cg, 1), M.collar);
    mesh(chest, cg, M.collarIn);
    return;
  }
  mesh(chest, sub(cg, 0), M.collar);
  mesh(chest, sub(collarGeometry(args[0], args[1], args[2], args[3], true), 0), M.collar);
}

/** The redraws' belt (spine space): a band round the coat at the waist, just over the skirt's anchor. */
function beltGeometry() {
  const S = shellOf()[0], y = 1.12;
  return gridGeometry(28, 1, (u, t, o) => {
    const a = u * Math.PI * 2;
    o[0] = Math.sin(a) * (S.rx + 0.02);
    o[1] = ySp(y + (t - 0.5) * 0.045);
    o[2] = Math.cos(a) * (S.rz + 0.02);
    o[3] = a * 0.1;
    o[4] = o[1];
  });
}

/** The reference's trousers' belt (spine space): a narrow dark band at the hips, seen in the coat's opening. */
function trouserBelt() {
  const S = shellOf()[0], y = 1.075;
  return gridGeometry(20, 1, (u, t, o) => {
    const a = (u - 0.5) * Math.PI * 1.1;
    o[0] = Math.sin(a) * (S.rx - 0.004);
    o[1] = ySp(y + (t - 0.5) * 0.03);
    o[2] = Math.cos(a) * (S.rz + 0.004);
    o[3] = a * 0.1;
    o[4] = o[1];
  });
}

/** The offset seam (ADR-285, spine space): a narrow strip down his LEFT side of the open V, `off` m outside
 *  its edge, on the coat's surface, from the collar line to the belt. */
function seamGeometry(off = 0.008, w = 0.022) {
  const R = shellOf(), n = R.length;
  return sub(gridGeometry(1, 8, (u, t, o) => {
    const f0 = t * (n - 2), k = Math.min(n - 3, Math.floor(f0)), f = f0 - k;
    const A = R[k], B = R[k + 1];
    const y = lerp(A.y, B.y, f), rx = lerp(A.rx, B.rx, f) + 0.016, rz = lerp(A.rz, B.rz, f) + 0.016, cz = lerp(A.cz ?? 0, B.cz ?? 0, f);
    const V = vGap(), g = lerp(V[k], V[k + 1], f) + off + u * w;
    const a = Math.asin(Math.min(0.95, g / rx));
    o[0] = Math.sin(a) * rx;
    o[1] = ySp(y);
    o[2] = Math.cos(a) * rz + cz + 0.002;
    o[3] = o[0];
    o[4] = o[1];
  }), 1);
}

/** a / c: the coat's torso (closed in phase 1, open from phase 2: two shells, one shown), the shirt in
 *  the V, the high collar. */
function chestCoat(ctx) {
  const { spine, chest, M, mesh } = ctx;
  const D = dressOf(ctx.root, oneLookNow());
  const closed = mesh(spine, foldLines(shellGeometry(rings(0.012), { sub: 3, cols: 28 }), coatSeams), M.coat);
  const open = mesh(spine, foldLines(shellGeometry(rings(0.012, vGap()), { sub: 3, cols: 28 }), coatSeams), M.coat);
  // (ADR-285, `?oneRef`: one OPEN coat in every phase, the shirt showing in its V)
  const ref = oneRefNow() && oneBodyNow() !== '0';
  at(D, closed, ref ? 9 : 1, ref ? 9 : 1);
  at(D, open, ref ? 1 : 2, 3);
  // the shirt in the V (always built: hidden behind the closed coat in phase 1)
  mesh(spine, shellGeometry(rings(0.002), { span: 0.5, cols: 8, sub: 2 }), M.shirt);
  // the redraws: a belt at the waist (the coat drawn in: the waist reads), the collar lower and open
  // wider (the head and the neck stand clear of it from above)
  if (oneBodyNow() !== '0') {
    // (the reference's coat has no belt: one garment from the collar to the floor; the trousers' belt shows
    // in the opening instead)
    if (ref) mesh(spine, trouserBelt(), M.armor);
    else mesh(spine, beltGeometry(), M.armor);
    if (ref) {
      // the tall split collar: up beside the jaw, open in front of the chin over the pale inner band
      collarFaces(ctx, [1.615, 0.48, 0.024, 0.055]);
      const band = collarGeometry(1.585, 0.3, 0.004, 0.03).scale(0.93, 1, 0.93);
      mesh(chest, sub(band, 0), M.facing);
      mesh(chest, sub(collarGeometry(1.585, 0.3, 0.004, 0.03, true).scale(0.93, 1, 0.93), 0), M.facing);
      // the offset seam: down his left side of the V, a little off its edge, from the collar to the belt
      mesh(spine, seamGeometry(), M.facing);
      return { keep: [closed, open] };
    }
    collarFaces(ctx, [1.585, 0.78, 0.012, 0.045]);
    return { keep: [closed, open] };
  }
  // the quiet print: the V a flat fill of shirt, no facings; the collar one shape
  if (onePrintNow() !== '0') {
    collarFaces(ctx, [1.625, 0.62, 0.016, 0.055]);
    return { keep: [closed, open] };
  }
  // the lapels' edge: a narrow facing down each side of the V (the lining turned out), phases 2 - 3
  const lap = [];
  for (const s of [-1, 1]) {
    lap.push(sub(gridGeometry(1, 6, (u, t, o) => {
      const k = Math.min(SHELL.length - 2, Math.floor(t * (SHELL.length - 1)));
      const f = t * (SHELL.length - 1) - k;
      const A = SHELL[k], B = SHELL[k + 1];
      const y = lerp(A.y, B.y, f), rx = lerp(A.rx, B.rx, f) + 0.014, rz = lerp(A.rz, B.rz, f) + 0.014, cz = lerp(A.cz ?? 0, B.cz ?? 0, f);
      const g = lerp(V_GAP[k], V_GAP[k + 1], f) + 0.004 + u * 0.016;
      const a = Math.asin(Math.min(0.95, g / rx));
      o[0] = s * Math.sin(a) * rx;
      o[1] = ySp(y);
      o[2] = Math.cos(a) * rz + cz + 0.002;
      o[3] = o[0];
      o[4] = o[1];
    }, s < 0), s > 0 ? 1 : 0));
  }
  const lapel = mesh(spine, mergeGeometries(lap), M.lining);
  at(D, lapel, 2, 3);
  // the high collar: outer and inner faces
  collarFaces(ctx, [1.625, 0.62, 0.016, 0.055]);
  return { keep: [closed, open, lapel] };
}

/** b: the Cassock's torso, buttoned to the neck: a closed shell, a lower band collar, a line of bright
 *  buttons down the centre from the collar to the belt line. */
function chestCassock(ctx) {
  const { spine, chest, M, mesh } = ctx;
  mesh(spine, foldLines(shellGeometry(rings(0.008), { sub: 3, cols: 28 }), coatSeams), M.coat);
  collarFaces(ctx, [1.6, 0.14, 0.004, 0.03]);
  // the buttons: on the shell's front, 1.49 m down to 1.12 m
  const bt = [];
  for (let i = 0; i < 8; i++) {
    const h = lerp(1.49, 1.12, i / 7);
    const k = Math.max(0, SHELL.findIndex((q) => q.y > h) - 1);
    const A = SHELL[k], B = SHELL[k + 1] ?? A, f = Math.min(1, Math.max(0, (h - A.y) / ((B.y - A.y) || 1)));
    const z = lerp(A.rz, B.rz, f) + lerp(A.cz ?? 0, B.cz ?? 0, f) + 0.012;
    bt.push(ellipsoidGeometry(0.012, 0.012, 0.007, { widthSegs: 6, heightSegs: 4 }).translate(0, ySp(h), z));
  }
  mesh(spine, mergeGeometries(bt), M.flask);
  return { keep: [] };
}

// ================================================================= the arms
/** The coat's sleeves to the wrist (a cuff turned back at the end), pale hands: the right fist on the
 *  sword joint, the free hand (hands.js). */
function buildArms(ctx) {
  const { arms, sword, M, DIM, BODY, mesh } = ctx;
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  const pad = oneBodyNow() === '0' ? 0 : 0.01; // (the redraws: a coat's squared shoulder over the arm)
  const slim = refFig(); // (ADR-285: the reference's long slim sleeves, the shoulder unpadded, a flared cuff)
  for (const side of [-1, 1]) {
    const { upper, fore } = arms[side < 0 ? 'R' : 'L'];
    if (slim) {
      const y1 = -DIM.foreArm + 0.06;
      mesh(upper, mergeGeometries([
        sub(limb({ length: DIM.upperArm, r0: ua0 + 0.002, r1: ua1 + 0.004, bulge: 0.004 }), 1),
        sub(ellipsoidGeometry(BODY.deltoid[0] + 0.003, BODY.deltoid[1] + 0.002, BODY.deltoid[2] + 0.003, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.004, -0.014, 0), 0),
      ]), M.coat);
      mesh(fore, mergeGeometries([
        sub(limb({ length: 0.09, r0: ua1 + 0.004, r1: ua1 + 0.002 }), 1),
        sub(limb({ length: -y1 - 0.03, r0: fa0 + 0.006, r1: fa1 + 0.016, radial: 12, rings: 3, bulge: 0.002 }).translate(0, -0.05, 0), 0),
        sub(limb({ length: 0.04, r0: fa1 + 0.02, r1: fa1 + 0.026, radial: 12, rings: 1, capSegs: 1 }).translate(0, y1 + 0.03, 0), 1),
      ]), M.coat);
      mesh(fore, sub(limb({ length: 0.018, r0: fa1 + 0.029, r1: fa1 + 0.029, radial: 12, rings: 1, capSegs: 1 }).translate(0, y1 + 0.006, 0), 0), M.facing);
      continue;
    }
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.006, r1: ua1 + 0.008, bulge: 0.008 }), 1),
      sub(ellipsoidGeometry(BODY.deltoid[0] + 0.01 + pad, BODY.deltoid[1] + 0.004 + pad * 0.5, BODY.deltoid[2] + 0.01 + pad, { widthSegs: 12, heightSegs: 8 }).translate(side * (0.008 + pad), -0.018 + pad * 0.6, 0), 0),
    ]), M.coat);
    // the forearm's sleeve, a little loose, ending in a cuff just above the wrist
    const y1 = -DIM.foreArm + 0.06;
    mesh(fore, mergeGeometries([
      sub(limb({ length: 0.09, r0: ua1 + 0.008, r1: ua1 + 0.004 }), 1),
      sub(limb({ length: -y1 - 0.03, r0: fa0 + 0.01, r1: fa1 + 0.014, radial: 12, rings: 3, bulge: 0.004 }).translate(0, -0.05, 0), 0),
      sub(limb({ length: 0.035, r0: fa1 + 0.018, r1: fa1 + 0.017, radial: 12, rings: 1, capSegs: 1 }).translate(0, y1 + 0.03, 0), 1),
    ]), M.coat);
    // (ADR-285: a jade band round the cuff)
    if (oneRefNow()) mesh(fore, sub(limb({ length: 0.016, r0: fa1 + 0.021, r1: fa1 + 0.021, radial: 12, rings: 1, capSegs: 1 }).translate(0, y1 + 0.012, 0), 0), M.facing);
  }
  // the right fist on the sword joint; the wrist under it
  const F = gripFist(HK);
  const fist = mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.skin);
  mesh(arms.R.fore, ellipsoidGeometry(0.032 * HK, 0.04 * HK, 0.036 * HK, { widthSegs: 10, heightSegs: 6 }), M.skin, 0, -DIM.foreArm + 0.025, 0.004);
  const free = buildFreeHand(ctx, M.skin);
  if (!refFig()) return { offHand: free.offHand, keep: free.keep };
  // (ADR-285: the reference's open right hand (T1.9's offer, A1.5's palm, the Source's open hands): a second
  // hand on the right forearm, shown instead of the fist except through a fist blow and while he holds the
  // guns (look.js dressOne: D.rOpen / D.rFist). The fist stays on the sword joint: his blade is unchanged.)
  const D = dressOf(ctx.root, oneLookNow());
  const H = shapedHand(DIM.foreArm - 0.03, -1, HK, 0.12);
  const open = mesh(arms.R.fore, mergeGeometries([H.palm, H.fingers, H.tips, H.thumb]), M.skin);
  open.visible = false;
  // ... and the palm turned out (A1.5's push, the Source's palms): the same hand bent back at the wrist
  const wy = -(DIM.foreArm - 0.03);
  const P = shapedHand(DIM.foreArm - 0.03, -1, HK, 0.05);
  const palm = mesh(arms.R.fore, mergeGeometries([P.palm, P.fingers, P.tips, P.thumb]).translate(0, -wy, 0).rotateZ(-1.3).translate(0, wy, 0), M.skin);
  palm.visible = false;
  D.rOpen = open;
  D.rPalm = palm;
  D.rFist = [fist];
  // ... and the left the same (the free hand is a closed fist, ?handLook's default: the sheets open it in
  // phase 3, gear 2's guard and the both-palm blows; look.js dressOne swaps it in after the animator)
  const len = DIM.foreArm - 0.03, wj = arms.L.wrist ?? arms.L.fore, wp = arms.L.wrist?.position;
  const toWrist = (g) => (wp ? g.translate(-wp.x, -wp.y, -wp.z) : g);
  const HL = shapedHand(len, 1, HK, 0.12);
  const lOpen = mesh(wj, toWrist(mergeGeometries([HL.palm, HL.fingers, HL.tips, HL.thumb])), M.skin);
  lOpen.visible = false;
  const PL = shapedHand(len, 1, HK, 0.05);
  const lPalm = mesh(wj, toWrist(mergeGeometries([PL.palm, PL.fingers, PL.tips, PL.thumb]).translate(0, len, 0).rotateZ(1.3).translate(0, -len, 0)), M.skin);
  lPalm.visible = false;
  D.lOpen = lOpen;
  D.lPalm = lPalm;
  return { offHand: free.offHand, keep: [...free.keep, fist, open, palm, lOpen, lPalm] };
}

// ================================================================= the legs
/** Straight dark trousers, black boots (the coat hides most of them). */
function buildLegs(ctx) {
  const { pelvis, legs, M, DIM, BODY, mesh } = ctx;
  const [hx, hy, hz] = BODY.hips.r;
  mesh(pelvis, orient.up(ellipsoidGeometry(hx + 0.008, hz + 0.008, hy + 0.01)), M.pants, ...BODY.hips.c);
  const [th0, th1] = BODY.thigh, [sh0, sh1] = BODY.shin, Ft = BODY.foot;
  const bootTop = -0.24;
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0 + 0.01, r1: th1 + 0.012, bulge: 0.01 }), M.pants);
    mesh(shin, limb({ length: -bootTop + 0.03, r0: th1 + 0.012, r1: sh0 + 0.006, bulge: 0.006 }), M.pants);
    const t = lerp(sh0, sh1, Math.min(1, -bootTop / DIM.shin));
    mesh(shin, sub(limb({ length: DIM.shin + bootTop, r0: t + 0.01, r1: sh1 + 0.008, radial: 12, rings: 3, capSegs: 1 }).translate(0, bootTop, 0), 1), M.armor);
    mesh(foot, ellipsoidGeometry(Ft.r[0] * 0.98, Ft.r[1] * 0.92, Ft.r[2] * 0.98, { widthSegs: 10, heightSegs: 6 }).translate(Ft.c[0], Ft.c[1] - 0.003, Ft.c[2]), M.armor);
  }
  return {};
}

// ================================================================= the coat's skirt
// Panels (sheet.js panelSkirt; anim.js _coat springs them): az 0 = his front, + his left. Long: from
// the anchor at 1.135 m to about 0.14 m. `closed` / `open` = a front panel's az with the coat closed /
// thrown open (look.js turns its anchor); `tail` = a tail behind (it flares and stirs the most).
// The front panels' inner edges hang straight (skew: the width they gain goes outward), so the coat
// opens in a straight line; the tails' vent edges drift out (|skew| > 1), so the split widens to the hem.
const COAT_A = [
  { az: 0.4, open: 0.78, w: [0.17, 0.21, 0.27], len: [0.47, 0.48], skew: 1, slant: 0.03, out: 0.006, front: true },
  { az: -0.4, open: -0.78, w: [0.17, 0.21, 0.27], len: [0.47, 0.48], skew: -1, slant: 0.03, out: 0.0, front: true },
  { az: 1.62, w: [0.15, 0.2, 0.27], len: [0.47, 0.48], out: 0.003 },
  { az: -1.62, w: [0.15, 0.2, 0.27], len: [0.47, 0.48], out: 0.003 },
  { az: 2.5, w: [0.17, 0.25, 0.36], len: [0.47, 0.5], skew: -1.3, slant: 0.05, out: 0.008, tail: true },
  { az: -2.5, w: [0.17, 0.25, 0.36], len: [0.47, 0.5], skew: 1.3, slant: 0.05, out: 0.008, tail: true },
];
/** b: the Cassock's skirt: narrower, to the floor, closed in front (the front panels overlap). */
const COAT_B = [
  { az: 0.3, open: 0.3, w: [0.16, 0.18, 0.21], len: [0.49, 0.51], skew: 1, out: 0.006, front: true },
  { az: -0.3, open: -0.3, w: [0.16, 0.18, 0.21], len: [0.49, 0.51], skew: -1, out: 0.0, front: true },
  { az: 1.6, w: [0.15, 0.17, 0.2], len: [0.49, 0.51], out: 0.003 },
  { az: -1.6, w: [0.15, 0.17, 0.2], len: [0.49, 0.51], out: 0.003 },
  { az: 2.55, w: [0.17, 0.2, 0.24], len: [0.49, 0.51], skew: -1.1, out: 0.008, tail: true },
  { az: -2.55, w: [0.17, 0.2, 0.24], len: [0.49, 0.51], skew: 1.1, out: 0.008, tail: true },
];

/** The redraws' skirts (`?oneBody=`): ONE coat (the owner, 2026-11-26: "the trenchcoat should not have
 *  different layers and should be one big coat put together", and not the hero's cloak): five panels that
 *  overlap all round (no gaps, no back vent: one back panel), the side panels a few mm outside their
 *  neighbours (no flicker where they overlap), a clean straight hem (`jag` 0) and no pale hem (look.js
 *  keeps the bosses' print's hem off his coat). It hangs near straight from the belted waist (cone 0.1:
 *  the hem about the shoulders' width). a and b to the ankle; c, the Duster, to mid-shin. b and c stand
 *  open in every phase (look.js): the legs walk in the opening. */
const COAT_MAN = {
  a: [
    { az: 0.36, open: 0.86, w: [0.12, 0.15, 0.18], len: [0.47, 0.48], skew: 1, out: 0.0, front: true, cone: 0.1, jag: 0 },
    { az: -0.36, open: -0.86, w: [0.12, 0.15, 0.18], len: [0.47, 0.48], skew: -1, out: 0.0, front: true, cone: 0.1, jag: 0 },
    { az: 1.62, w: [0.14, 0.19, 0.24], len: [0.47, 0.48], out: 0.012, cone: 0.1, jag: 0 },
    { az: -1.62, w: [0.14, 0.19, 0.24], len: [0.47, 0.48], out: 0.012, cone: 0.1, jag: 0 },
    { az: Math.PI, w: [0.3, 0.4, 0.5], len: [0.47, 0.49], out: 0.0, tail: true, cone: 0.11, jag: 0 },
  ],
};
COAT_MAN.b = COAT_MAN.a;
/** `?oneRef=a` (ADR-285): the reference's coat: b's five panels to the floor, the hem wider (the coat falls
 *  in an A from the belt), the offset seam down the inner edge of his left front panel (`edge`: piping). */
const COAT_REF = [
  // the fronts: thrown open (look.js turns them to `open` in every phase), their inner edges drifting out
  // toward the hem (|skew| > 1) so the legs show the whole way down (A2's notes: "panels part to show legs,
  // no skirt blob"); his left one carries the seam down its inner edge
  { az: 0.4, open: 0.98, w: [0.12, 0.16, 0.22], len: [0.47, 0.51], skew: 1.5, out: 0.0, front: true, cone: 0.2, jag: 0, edge: 1 },
  { az: -0.4, open: -0.98, w: [0.12, 0.16, 0.22], len: [0.47, 0.51], skew: -1.5, out: 0.0, front: true, cone: 0.2, jag: 0 },
  { az: 1.7, w: [0.16, 0.22, 0.3], len: [0.47, 0.51], out: 0.012, cone: 0.2, jag: 0 },
  { az: -1.7, w: [0.16, 0.22, 0.3], len: [0.47, 0.51], out: 0.012, cone: 0.2, jag: 0 },
  { az: Math.PI, w: [0.3, 0.44, 0.6], len: [0.47, 0.52], out: 0.0, tail: true, cone: 0.2, jag: 0 },
];
COAT_MAN.c = COAT_MAN.a.map((p) => ({ ...p, len: [0.42, p.tail ? 0.29 : 0.28] }));

function buildCoat(ctx) {
  const look = oneLookNow(), body = oneBodyNow();
  const D = dressOf(ctx.root, look);
  // (fresh defs per rig: look.js writes their flare and stir, and turns the front panels)
  const defs = (body !== '0' ? (oneRefNow() && body !== 'c' ? COAT_REF : COAT_MAN[body]) : look === 'b' ? COAT_B : COAT_A).map((p) => ({ ...p, strips: [], fork: [], flare: 0.06, breeze: 0, idleFlare: 0 }));
  const { coat } = panelSkirt(ctx, defs, { seed: 900 });
  // a coat of heavy cloth: one or two soft folds down each panel instead of the skirt's pleats
  // (panelSkirt's fold field, redrawn: x across the panel = aGUV x, m)
  coat.forEach((C, i) => {
    const w = C.def.w[2], ph = i * 1.7 + 0.6;
    const seen = new Set();
    for (const s of C.segs) for (const m of s.children) {
      if (!m.isMesh || seen.has(m.geometry)) continue;
      seen.add(m.geometry);
      foldLines(m.geometry, (x, y, z, u, gy) => 0.5 + 0.6 * Math.sin((u / w) * Math.PI * 2.4 + ph + gy * 1.5));
    }
  });
  coat.forEach((C) => {
    D.panels.push({ def: C.def, tail: !!C.def.tail, front: !!C.def.front });
    if (C.def.front) D.fronts.push({ C, closed: C.def.az, open: C.def.open, R: ctx.DIM });
  });
  return { coat };
}

// ================================================================= the guns
/** A small handgun: the slide and barrel along +X (the muzzle at +X), the grip down −Z from its back
 *  end, a trigger guard; the muzzle's bright cell apart. Built in the RIGHT fist's frame (the sword
 *  joint: the grip along Z through the fist, the knuckles to +X), so it sits over the index finger and
 *  points the way the knuckles do. */
function gunGeometry(HK) {
  const zTop = 0.034 * HK + 0.03; // over the index finger's roll
  // (ADR-285, `?oneRef`: the reference's compact squared pistol: a deeper slide, the grip near upright, a
  // squared trigger guard; the muzzle cell where it was: the shots leave from its centre, gunAim.js)
  const body = oneRefNow() ? mergeGeometries([
    sub(boxGeometry(0.15, 0.03, 0.04, 0.035, 0, zTop + 0.002), 1),
    boxGeometry(0.032, 0.026, 0.1, -0.014, 0, zTop - 0.05, 0, -0.08, 0),
    boxGeometry(0.044, 0.01, 0.01, 0.03, 0, zTop - 0.032),
    boxGeometry(0.01, 0.01, 0.026, 0.05, 0, zTop - 0.02),
  ]) : mergeGeometries([
    sub(boxGeometry(0.15, 0.026, 0.032, 0.035, 0, zTop), 1), // the slide
    boxGeometry(0.028, 0.024, 0.1, -0.012, 0, zTop - 0.05, 0, -0.18, 0), // the grip, raked back (inside the fist)
    boxGeometry(0.04, 0.008, 0.008, 0.03, 0, zTop - 0.03), // the trigger guard's lower bar
  ]);
  const muzzle = ellipsoidGeometry(0.012, 0.012, 0.012, { widthSegs: 6, heightSegs: 4 }).translate(0.115, 0, zTop + 0.002);
  return { body, muzzle };
}

/** One gun in each hand: the right on the sword joint (the fist), the left on the free wrist (turned so
 *  its muzzle runs down the hand, the way the fingers point: the arm aims it). */
function buildGuns(ctx) {
  const { sword, arms, M, BODY, mesh } = ctx;
  const D = dressOf(ctx.root, oneLookNow());
  const HK = BODY.hand;
  const G = gunGeometry(HK);
  const out = [];
  out.push(mesh(sword, G.body, M.armor), mesh(sword, G.muzzle, M.flask));
  // the left: wrist space (the hand hangs −Y, its front +Z, the palm toward the body −X): the gun's +X
  // (the barrel) down the hand, its grip (−Z in the fist's frame) back through the palm
  const wj = arms.L.wrist ?? arms.L.fore;
  const lb = G.body.clone(), lm = G.muzzle.clone();
  // (the fist frame's +X → −Y down the hand, Z stays: the slide on the index's side, +Z; then the grip
  // into the curled fingers)
  for (const g of [lb, lm]) g.rotateZ(-Math.PI / 2).translate(-0.01, -0.082, -0.018);
  out.push(mesh(wj, lb, M.armor), mesh(wj, lm, M.flask));
  for (const m of out) {
    m.visible = false;
    D.guns.push(m);
  }
  return { keep: out };
}

// ================================================================= the items
const CHEST = { a: chestCoat, b: chestCassock, c: chestCoat };

/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const ONE_ITEMS = [
  { id: 'one.head', slot: 'head', name: 'Short Hair and Dark Glasses', hidesHair: true, build: buildHead },
  { id: 'one.chest', slot: 'chest', name: 'High Collar', build: (ctx) => CHEST[oneLookNow()](ctx) },
  { id: 'one.arms', slot: 'arms', name: 'Coat Sleeves', build: buildArms },
  { id: 'one.legs', slot: 'legs', name: 'Dark Trousers', build: buildLegs },
  { id: 'one.coat', slot: 'waist', name: 'Long Coat', build: buildCoat },
  { id: 'one.guns', slot: 'weapon', name: 'Two Handguns', build: buildGuns },
];
for (const item of ONE_ITEMS) registerItem(item);

/** What he wears. The guns sit in the weapon slot (the right one hangs on the sword joint); he fights
 *  bare-handed all the same: the fist is the blade (ONE_FIST), the guns are shown in phase 2 only. */
export const ONE_LOADOUT = Object.freeze({
  head: 'one.head',
  chest: 'one.chest',
  shoulders: null,
  arms: 'one.arms',
  legs: 'one.legs',
  waist: 'one.coat',
  back: null,
  weapon: 'one.guns',
});

/** His "blade": the right fist, as a short segment along the sword joint's +Z (duelist.js kit.blade):
 *  from the little finger's side of the fist (guard) to past the index knuckle (tip), metres. Measured
 *  on gripFist(BODY.hand 1.12) as Tian Lei's (ascendant/gear.js FIST): the same fist, bare. */
export const ONE_FIST = Object.freeze({ guard: -0.06, tip: 0.075 });
