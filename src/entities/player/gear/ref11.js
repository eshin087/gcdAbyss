import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import {
  shellGeometry, gridGeometry, bandGeometry, boxGeometry, kiteGeometry, mergeGeometries, sub, foldLines, lerp, limb, gripFist, arcPlate, orient,
  tatterStrip, ribbonCrease, sheetOffset, sheetEdge,
} from '../heroGeo.js';
import { hangSheet, panelSkirt } from './sheet.js';
import { buildFreeHand } from './hands.js';

// OUTFIT OPTION "Costume 11" (gear/looks.js `ref11`, ADR-291; the owner's "COSTUME REFERENCE / 11", 2026-11-28:
// "Make the character where this design from the reference art. Make it have the same look and vibe to test out
// separately"). The sheet: a deep hood over a face lost in shadow, a heavy cowl of cloth draped round the neck and
// over both shoulders, pinned by a square silver clasp at the left collarbone; a black wrap tunic, a dark strap
// across the chest from the right shoulder to the left hip, a silver plate belt with a green stone; loose black
// sleeves into articulated silver gauntlets; a long, full cloak to the ankles, black at the shoulders and turning
// to torn lavender rags at the hem, a thin line of pale glyphs down the middle of the back; layered skirts of the
// same torn cloth between its edges; dark trousers into silver plated boots. Over the Wanderer's sword (unchanged).
// Colours: REF11_TINT. Silver plate is `spike`, its lines and the clasp `bevel`, the strap `welt`, the green
// stone `facing`. The owner's second pass (2026-11-28, after an ASCII armour reel: layers, not "one big clump of
// black") added a quilted vest (`collar`) with silver rivets, lames on the upper arms, the front skirts as a violet
// tabard (`piping`), silver edging down the cloak's sides and a dusk step (`collarIn`) before the rags. The sword
// draws in armor / trim / leather / blade / bladeTip / gem: none is tinted (an outfit never recolours the sword);
// its light on the cut is dimmed instead (HERO_LOOKS.ref11.bladeLit) and its slash drawn in lavender (REF11_SLASH).
// The lavender of the torn cloth is the hero's own `hem` ink, dimmer.
//   head   ref11.hood    the deep hood (hidesHair, shadowsFace)
//   chest  ref11.tunic   the wrap tunic, the cross strap, the belt and its stone
//   arms   ref11.arms    loose sleeves, the silver gauntlets (both hands in silver)
//   legs   ref11.legs    trousers, the silver boots
//   waist  ref11.skirt   the layered skirts, torn lavender at their hems
//   back   ref11.cloak   the cowl, the clasp, REF11_SHEETS (the long cloak) and the glyph line
// Heights in comments are metres in the idle stance. Built from heroGeo.js sheets and shells, nothing sculpted.

// ---------------------------------------------------------------- head: the deep hood
/** Hood rings in head space (y above the neck-base joint, before BODY.headScale; the crown is at ~0.22): a broad
 *  cowl at the shoulders, up round the head, a full rounded crown with a soft point falling back (no tall peak),
 *  the opening deep and narrow so the brow overhangs the face. */
export const REF11_HOOD = [
  { y: -0.07, rx: 0.225, rz: 0.18, cz: -0.03, gap: 0.075 },
  { y: 0.0, rx: 0.178, rz: 0.158, cz: -0.016, gap: 0.066 },
  { y: 0.07, rx: 0.162, rz: 0.16, cz: -0.002, gap: 0.08 },
  { y: 0.135, rx: 0.16, rz: 0.168, cz: 0.008, gap: 0.084 },
  { y: 0.19, rx: 0.152, rz: 0.166, cz: 0.004, gap: 0.072 },
  { y: 0.235, rx: 0.132, rz: 0.15, cz: -0.012, gap: 0.046 },
  { y: 0.268, rx: 0.1, rz: 0.12, cz: -0.034, gap: 0.016 },
  { y: 0.288, rx: 0.058, rz: 0.08, cz: -0.06, gap: 0.004 },
  { y: 0.298, rx: 0.016, rz: 0.03, cz: -0.086, gap: 0.001 },
];

function buildHood({ head, M, mesh }) {
  // heavy folds falling from the crown, more of them low on the cowl (the cloth gathers on the shoulders)
  const g = foldLines(shellGeometry(REF11_HOOD, { sub: 2, cols: 24 }), (x, y, z, u) => 0.5 + 0.55 * Math.sin(u * 38 + y * 9 + 0.6 * Math.sin(u * 11)) - 0.8 * Math.max(0, (y - 0.27) / 0.06));
  mesh(head, g, M.coat);
  mesh(head, g, M.lining);
}

// ---------------------------------------------------------------- chest: the wrap tunic, the strap, the belt
/** The strap across the chest (world idle heights; its centre's angle round the body, rad: 0 = his front,
 *  + = his left): from over the right shoulder (behind, round the top) down to the left hip. */
export const REF11_STRAP = { lo: 1.14, hi: 1.47, cLo: 0.85, cHi: -0.55, half: 0.05, off: 0.034 };
/** The quilted vest over the tunic (world idle heights): from `lo` to `hi`, `off` off the body, open ±`open` rad
 *  at his front. */
export const REF11_VEST = { lo: 1.21, hi: 1.43, off: 0.02, open: 0.42 };

function buildTunic({ spine, M, BODY, REST, mesh }) {
  const ySp = (h) => h - REST.spine;
  const SHELL = BODY.shell, top = SHELL[SHELL.length - 1];
  const at = (h) => {
    let k = 0;
    while (k < SHELL.length - 2 && SHELL[k + 1].y < h) k++;
    const A = SHELL[k], B = SHELL[k + 1], u = Math.min(1, Math.max(0, (h - A.y) / (B.y - A.y)));
    return [lerp(A.rx, B.rx, u), lerp(A.rz, B.rz, u), lerp(A.cz ?? 0, B.cz ?? 0, u)];
  };
  // the wrap tunic: one shell a little off the body, its folds running on the diagonal of the wrap (from his
  // left shoulder down to his right hip in front), straight down at the back
  const rings = [...SHELL, { y: top.y + 0.02, rx: 0.06, rz: 0.058 }].map((r) => ({ ...r, rx: r.rx + 0.008, rz: r.rz + 0.008, gap: 0, y: ySp(r.y) }));
  const wrap = (x, y, z) => (z > 0 ? 0.5 + 0.6 * Math.sin(40 * (x * 0.8 - (y - ySp(1.3)) * 0.6)) : 0.5 + 0.5 * Math.sin(34 * x));
  mesh(spine, foldLines(shellGeometry(rings, { sub: 3, cols: 28 }), wrap), M.shirt);
  // the quilted vest over it (the owner, 2026-11-28: "more details and layers on his outfit ... instead of just one
  // big clump of black"): plum-brown cloth from the ribs to the shoulders, open down the front so the tunic and
  // its wrap show, quilted in rows; a line of silver rivets down each front edge
  {
    const V = REF11_VEST;
    const vr = SHELL.filter((r) => r.y >= V.lo - 0.001 && r.y <= V.hi + 0.001).map((r) => ({ ...r, rx: r.rx + V.off, rz: r.rz + V.off, gap: 0, y: ySp(r.y) }));
    const quilt = (x, y, z, u, v) => 0.5 + 0.6 * Math.sin(v * 95) + 0.25 * Math.sin(u * 60);
    mesh(spine, foldLines(shellGeometry(vr, { sub: 2, cols: 22, arc: [V.open, Math.PI * 2 - V.open] }), quilt), M.collar);
    const rv = [];
    for (let h = V.lo + 0.03; h <= V.hi - 0.04; h += 0.038) {
      const R = at(h);
      for (const sd of [-1, 1]) {
        const a = sd * (V.open + 0.035);
        rv.push(boxGeometry(0.012, 0.012, 0.008, Math.sin(a) * (R[0] + V.off + 0.004), ySp(h), Math.cos(a) * (R[1] + V.off + 0.004) + R[2], 0, a, Math.PI / 4));
      }
    }
    mesh(spine, mergeGeometries(rv), M.bevel);
  }
  // the strap: a band whose middle turns round the body as it rises, from his left hip to over his right shoulder
  {
    const W = REF11_STRAP;
    const g = sub(gridGeometry(3, 14, (s, t, o) => {
      const h = lerp(W.lo, W.hi, t), R = at(h), a = lerp(W.cLo, W.cHi, t) + (s - 0.5) * 2 * W.half / Math.max(0.1, R[0]);
      o[0] = Math.sin(a) * (R[0] + W.off);
      o[1] = ySp(h);
      o[2] = Math.cos(a) * (R[1] + W.off) + R[2];
      o[3] = s * 0.1;
      o[4] = ySp(h);
    }), 1);
    mesh(spine, g, M.welt);
  }
  // the silver plate belt, its buckle and the green stone in it
  const B = at(1.16), front = B[1] + B[2] + 0.02;
  mesh(spine, sub(bandGeometry(B[0] + 0.02, B[1] + 0.02, 0.036, 32), 1), M.spike, 0, ySp(1.16), B[2]);
  mesh(spine, mergeGeometries([
    bandGeometry(B[0] + 0.022, B[1] + 0.022, 0.005, 32).translate(0, 0.018, 0),
    bandGeometry(B[0] + 0.022, B[1] + 0.022, 0.005, 32).translate(0, -0.018, 0),
  ]), M.bevel, 0, ySp(1.16), B[2]);
  mesh(spine, boxGeometry(0.1, 0.048, 0.016, 0, ySp(1.16), front + 0.004), M.spike);
  mesh(spine, kiteGeometry(0.03, 0.014, 0.008).rotateZ(Math.PI / 2).translate(0, ySp(1.16), front + 0.016), M.facing);
}

// ---------------------------------------------------------------- arms: loose sleeves, silver gauntlets
/** The lames on each upper arm (y from the shoulder joint, m: top, bottom), the lower one tucked under the upper. */
export const REF11_LAMES = [[-0.1, -0.16], [-0.145, -0.2]];
function buildArms(ctx) {
  const { arms, sword, M, DIM, BODY, mesh } = ctx;
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  const steel = M.spike;
  {
    // the sword hand: an armoured fist round the grip
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), steel);
  }
  const cuffY = -(DIM.foreArm - 0.17); // where the gauntlet's bracer begins on the forearm
  for (const side of [-1, 1]) {
    const { upper, fore } = arms[side < 0 ? 'R' : 'L'];
    // the loose sleeve: fuller than the arm, gathered at the elbow, a wide cuff over the bracer's top
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.014, r1: ua1 + 0.016, bulge: 0.012 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid.map((v) => v + 0.012), { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.02, 0), 1),
      sub(ellipsoidGeometry(ua1 + 0.02, ua1 + 0.014, ua1 + 0.022, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.upperArm, -0.004), 1),
    ]), M.coat);
    mesh(fore, sub(limb({ length: -cuffY + 0.03, r0: fa0 + 0.018, r1: lerp(fa0, fa1, 0.5) + 0.026, radial: 12, rings: 4 }), 1), M.coat);
    // two silver lames over the outside of the upper arm, just under the cowl's edge, each with a bright rim
    const ac = side * Math.PI * 0.5, rU = (y) => lerp(ua0, ua1, -y / DIM.upperArm) + 0.03;
    mesh(upper, mergeGeometries(REF11_LAMES.map(([y0, y1]) => arcPlate(y0, y1, rU(y0) + 0.004, rU(y1), ac, 1.25, 7))), steel);
    mesh(upper, mergeGeometries(REF11_LAMES.map(([, y1]) => arcPlate(y1 + 0.008, y1, rU(y1) + 0.004, rU(y1) + 0.004, ac, 1.25, 7))), M.bevel);
    // the bracer: plated silver from the sleeve's cuff to the wrist, three lames' edges round it
    const rB = (y) => lerp(fa0, fa1, -y / DIM.foreArm) + 0.012;
    mesh(fore, limb({ length: DIM.foreArm + cuffY - 0.04, r0: rB(cuffY) + 0.004, r1: fa1 + 0.01, radial: 12, rings: 3 }), steel, 0, cuffY, 0);
    mesh(fore, mergeGeometries([0, 0.045, 0.09].map((d) => bandGeometry(rB(cuffY - d) + 0.006, rB(cuffY - d) + 0.006, 0.006, 14).translate(0, cuffY - 0.012 - d, 0))), M.bevel);
  }
  // the sword hand's plated wrist and the back of the hand, meeting the fist on the grip
  mesh(arms.R.fore, mergeGeometries([
    limb({ length: 0.05, r0: fa1 + 0.004, r1: fa1 + 0.006, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.07, 0),
    ellipsoidGeometry(0.036 * HK, 0.042 * HK, 0.044 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004),
  ]), steel);
  return buildFreeHand(ctx, steel);
}

// ---------------------------------------------------------------- legs: trousers, silver boots
function buildLegs({ pelvis, legs, M, DIM, BODY, mesh }) {
  {
    const [hx, hy, hz] = BODY.hips.r;
    mesh(pelvis, orient.up(ellipsoidGeometry(hx, hz, hy)), M.pants, ...BODY.hips.c);
  }
  const [th0, th1, thB] = BODY.thigh, [sh0, sh1, shB] = BODY.shin, F = BODY.foot;
  const rS = (y) => lerp(sh0, sh1, -y / DIM.shin) + shB * Math.sin(Math.PI * Math.min(1, -y / DIM.shin));
  const top = -0.1; // the greave's top, a hand under the knee (≈ 0.5 m)
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0 + 0.006, r1: th1 + 0.008, bulge: thB + 0.006 }), M.pants);
    mesh(shin, limb({ length: DIM.shin - 0.02, r0: sh0 + 0.004, r1: sh1 + 0.004, bulge: shB }), M.pants, 0, -0.01, 0);
    // the greave: silver plate from under the knee to the ankle, a pointed plate rising over the shin's front
    // (as on the sheet's boots), two lames' edges near the ankle
    mesh(shin, sub(limb({ length: DIM.shin + top - 0.01, r0: rS(top) + 0.016, r1: sh1 + 0.014, radial: 14, rings: 4 }), 1), M.spike, 0, top, 0);
    mesh(shin, kiteGeometry(0.05, 0.075, 0.012, { zNeg: 0.4 }).translate(0, top + 0.01, rS(top) + 0.012), M.spike);
    mesh(shin, mergeGeometries([
      bandGeometry(rS(top) + 0.021, rS(top) + 0.021, 0.008, 16).translate(0, top - 0.004, 0),
      arcPlate(-DIM.shin + 0.13, -DIM.shin + 0.122, sh1 + 0.02, sh1 + 0.02, 0, 1.6, 8),
      arcPlate(-DIM.shin + 0.085, -DIM.shin + 0.077, sh1 + 0.02, sh1 + 0.02, 0, 1.6, 8),
    ]), M.bevel);
    // the sabaton: the foot in plate, an instep plate, the toe cap and the heel; the sole's welt
    mesh(foot, mergeGeometries([
      ellipsoidGeometry(F.r[0] + 0.006, F.r[1] + 0.004, F.r[2] + 0.006, { widthSegs: 10, heightSegs: 6 }).translate(...F.c),
      sub(ellipsoidGeometry(0.048, 0.024, 0.044, { widthSegs: 8, heightSegs: 4 }).translate(0, F.c[1] + F.r[1] - 0.012, 0.064), 1),
      sub(boxGeometry(0.066, 0.036, 0.054, 0, -0.052, -0.062), 1),
    ]), M.spike);
    mesh(foot, ellipsoidGeometry(F.r[0] + 0.01, 0.008, F.r[2] + 0.011, { widthSegs: 14, heightSegs: 3 }), M.welt, 0, -0.062, F.c[2]);
  }
}

// ---------------------------------------------------------------- waist: the layered skirts
/** The tunic's skirts on the pelvis (panelSkirt): layered panels to the shin, black at the belt, a dusk violet
 *  from `fadeFrom` of their lower sheet and the torn lavender from `hemFrom` (both changes along torn lines),
 *  ragged strips at the hem (`stripHem`: in the hem's lavender). The front pair overlap (the wrap) as a violet
 *  tabard (`mat`); the sides and the back sit under the cloak, the back pair short enough to end above its hem
 *  (level with it, their rags drew a second torn row under the cloak's from behind). */
export const REF11_PANELS = [
  { az: 0.42, w: [0.15, 0.2, 0.26], len: [0.27, 0.3], strips: [0.12, 0.15], fork: [0, 1], out: 0.006, flare: 0.18, skew: 0.8, slant: 0.05, fadeFrom: 0.12, hemFrom: 0.55, jag: 0.02, stripHem: true, mat: 'piping' },
  { az: -0.42, w: [0.15, 0.2, 0.26], len: [0.27, 0.32], strips: [0.15, 0.11], fork: [0, 1], out: 0.01, flare: 0.18, skew: -0.8, slant: 0.05, fadeFrom: 0.12, hemFrom: 0.55, jag: 0.02, stripHem: true, mat: 'piping' },
  { az: 1.35, w: [0.15, 0.2, 0.27], len: [0.28, 0.3], strips: [0.1, 0.14], fork: [1, 0], out: 0, flare: 0.4, fadeFrom: 0.1, hemFrom: 0.52, jag: 0.02, stripHem: true },
  { az: -1.35, w: [0.15, 0.2, 0.27], len: [0.28, 0.3], strips: [0.13, 0.09], fork: [0, 1], out: 0, flare: 0.4, fadeFrom: 0.1, hemFrom: 0.52, jag: 0.02, stripHem: true },
  { az: 2.6, w: [0.16, 0.22, 0.28], len: [0.26, 0.2], strips: [0.07, 0.09], fork: [0, 1], out: 0.006, flare: 0.3, fadeFrom: 0.1, hemFrom: 0.52, jag: 0.02, stripHem: true },
  { az: -2.6, w: [0.16, 0.22, 0.28], len: [0.26, 0.2], strips: [0.07, 0.09], fork: [1, 0], out: 0.006, flare: 0.3, fadeFrom: 0.1, hemFrom: 0.52, jag: 0.02, stripHem: true },
];

function buildSkirt(ctx) {
  return panelSkirt(ctx, REF11_PANELS, { seed: 11, fade: ctx.M.collarIn });
}

// ---------------------------------------------------------------- back: the cowl, the clasp, the long cloak
/** The cloak's sheets (hangSheet, on the chest): one down the middle of his back and one each side, close to the
 *  body (the owner, 2026-11-28: the first cut stood out from his back under the cowl like a second layer, "too
 *  plumpy", its side tips apart): their roots under the cowl's edge, the side sheets overlapping the middle one's
 *  edges so the hem runs on as one, all three the same length; to mid-calf with their torn points (no sheet over
 *  the flanks under the arms: there the thighs and the free hand went into it; the skirts cover his sides). Black,
 *  a dusk violet from `fadeFrom` of the lower sheet, the lavender rags from `hemFrom`, along torn lines. `inMax`:
 *  the roots held a little out, the lower halves free to wrap in so a roll lifts them off the grass (`floor`).
 *  `strips`: the torn points' lengths (m); `trim`: the side sheet's outer edge piped in silver (-1 / +1: its
 *  local -X / +X edge). */
export const REF11_SHEETS = [
  { at: [0, 0.2, -0.155], ry: Math.PI, w: [0.28, 0.33, 0.4], len: [0.48, 0.43], out: 0.07, wrap: 0.3, lag: 0.42, max: 1.35, inMax: [-0.04, 0.3], floor: true, fadeFrom: 0.04, hemFrom: 0.5, strips: [0.13, 0.08, 0.15, 0.1, 0.14], fork: [0, 1, 0, 0, 1], seed: 7 },
  { at: [0.145, 0.19, -0.105], ry: Math.PI - 0.62, w: [0.14, 0.2, 0.25], len: [0.48, 0.43], out: 0.12, wrap: 0.24, lag: 0.42, max: 1.35, inMax: [-0.06, 0.12], floor: true, fadeFrom: 0.04, hemFrom: 0.5, strips: [0.12, 0.09, 0.13], fork: [0, 1, 0], seed: 13, trim: -1 },
  { at: [-0.145, 0.19, -0.105], ry: Math.PI + 0.62, w: [0.14, 0.2, 0.25], len: [0.48, 0.43], out: 0.12, wrap: 0.24, lag: 0.42, max: 1.35, inMax: [-0.06, 0.12], floor: true, fadeFrom: 0.04, hemFrom: 0.5, strips: [0.13, 0.08, 0.12], fork: [1, 0, 0], seed: 19, trim: 1 },
];
/** The pale glyph line down the middle of the back sheet: marks (m along the sheet from its root, height) in a
 *  column, a hair to either side now and then, like a line of small letters. Seeded, the same every build. */
function glyphColumn(L, seed, from = 0.06) {
  const out = [];
  let s = seed >>> 0, y = from;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  while (y < L - 0.02) {
    const h = 0.012 + 0.022 * r(), w = 0.006 + 0.006 * r(), x = (r() - 0.5) * 0.008;
    out.push(boxGeometry(w, h, 0.003, x, -(y + h / 2), 0));
    if (r() < 0.3) out.push(boxGeometry(0.012, 0.004, 0.003, x + (r() < 0.5 ? -0.006 : 0.006), -(y + h * r()), 0.001));
    y += h + 0.008 + 0.012 * r();
  }
  return mergeGeometries(out);
}

function buildCloak(ctx) {
  const { chest, M, REST, mesh, joint } = ctx;
  const yCh = (h) => h - REST.chest;
  // the cowl: heavy cloth from the hood's foot out over both shoulders and down onto the upper arms, open at the
  // throat, its folds running down and round; a second roll of it gathered round the neck
  {
    const rings = [
      { y: yCh(1.31), rx: 0.288, rz: 0.2, cz: -0.026, gap: 0.11 },
      { y: yCh(1.36), rx: 0.282, rz: 0.196, cz: -0.024, gap: 0.088 },
      { y: yCh(1.41), rx: 0.264, rz: 0.188, cz: -0.02, gap: 0.07 },
      { y: yCh(1.455), rx: 0.226, rz: 0.164, cz: -0.012, gap: 0.054 },
      { y: yCh(1.49), rx: 0.17, rz: 0.13, cz: -0.004, gap: 0.042 },
      { y: yCh(1.515), rx: 0.12, rz: 0.1, cz: 0.0, gap: 0.034 },
    ];
    const g = foldLines(sub(shellGeometry(rings, { sub: 2, cols: 27 }), 1), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 30 + y * 14));
    // a torn lower edge
    const p = g.attributes.position;
    for (let i = 0; i <= 27; i++) p.setY(i, p.getY(i) + (i % 3 === 0 ? -0.03 : i % 3 === 1 ? 0.01 : -0.012));
    g.computeVertexNormals();
    mesh(chest, g, M.coat);
    mesh(chest, g, M.lining);
    const roll = [
      { y: yCh(1.45), rx: 0.17, rz: 0.15, cz: 0.0, gap: 0.05 },
      { y: yCh(1.49), rx: 0.15, rz: 0.13, cz: 0.004, gap: 0.042 },
      { y: yCh(1.525), rx: 0.11, rz: 0.1, cz: 0.006, gap: 0.034 },
    ];
    mesh(chest, foldLines(sub(shellGeometry(roll, { sub: 1, cols: 24 }), 1), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 22 - y * 30)), M.coat);
    // the clasp at the left collarbone: a square silver plate set on its point, a smaller one in it, a mark
    const cl = joint(chest, 0.105, yCh(1.43), 0.14);
    cl.rotation.y = 0.55;
    cl.rotation.x = -0.25;
    mesh(cl, kiteGeometry(0.03, 0.03, 0.008), M.spike);
    mesh(cl, kiteGeometry(0.019, 0.019, 0.006).translate(0, 0, 0.006), M.bevel);
    mesh(cl, mergeGeometries([boxGeometry(0.004, 0.016, 0.003, -0.003, 0, 0.011), boxGeometry(0.01, 0.003, 0.003, 0.001, 0.004, 0.011)]), M.welt);
  }
  const streamers = REF11_SHEETS.map((d) => {
    const S = hangSheet(ctx, chest, d, { face: M.coat, back: M.lining, hem: M.hem, fade: M.collarIn });
    if (d.trim) {
      // the outer edge piped in silver down its whole length (the reference's bright-edged layers)
      mesh(S.segs[0], sheetEdge(d.len[0], d.w[0], d.w[1], d.wrap, d.trim), M.bevel);
      mesh(S.segs[1], sheetEdge(d.len[1], d.w[1], d.w[2], d.wrap + 0.25 * d.len[0], d.trim), M.bevel);
    }
    // the torn points along its hem, rigid on the lower sheet, in the lavender
    const [w0, , w2] = d.w, [L0, L1] = d.len, n = d.strips.length;
    const R1 = d.wrap + 0.25 * L0, R2 = R1 + 0.25 * L1, wr = w2 / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.5) / n - 0.5) * w2 + sheetOffset(w2, w0, 0), a = u / R2;
      const sw = Math.max(0.06, wr * 1.25);
      const m = mesh(S.segs[1], foldLines(tatterStrip(d.strips[k], sw, { fork: !!d.fork[k], curl: 0.18, seed: 700 + d.seed * 13 + k * 7 }), ribbonCrease(sw, d.seed * 0.9 + k * 1.3)), M.hem, Math.sin(a) * R2, -L1 + 0.012, (Math.cos(a) - 1) * R2);
      m.rotation.y = a;
    }
    return S;
  });
  // the glyph line down the middle of the back sheet (on its outer face, +Z), from the shoulder blades to the hem
  {
    const S = streamers[0], [L0, L1] = S.len;
    mesh(S.segs[0], glyphColumn(L0, 1101, 0.12).translate(0, 0, 0.007), M.bevel);
    mesh(S.segs[1], glyphColumn(L1 - 0.04, 1187, 0.0).translate(0, 0, 0.011), M.bevel);
  }
  return { streamers };
}

export const REF11_ITEMS = [
  { id: 'ref11.hood', slot: 'head', name: 'Deep Hood', hidesHair: true, shadowsFace: true, build: buildHood },
  { id: 'ref11.tunic', slot: 'chest', name: 'Wrap Tunic, Strap and Plate Belt', build: buildTunic },
  { id: 'ref11.arms', slot: 'arms', name: 'Loose Sleeves and Silver Gauntlets', build: buildArms },
  { id: 'ref11.legs', slot: 'legs', name: 'Silver Plated Boots', build: buildLegs },
  { id: 'ref11.skirt', slot: 'waist', name: 'Torn Layered Skirts', build: buildSkirt },
  { id: 'ref11.cloak', slot: 'back', name: 'Long Torn Cloak', build: buildCloak },
];

export const REF11_LOADOUT = Object.freeze({
  head: 'ref11.hood', chest: 'ref11.tunic', shoulders: null, arms: 'ref11.arms',
  legs: 'ref11.legs', waist: 'ref11.skirt', back: 'ref11.cloak', weapon: 'wanderer.sword',
});

/** Its colours (model.js tintHero, this rig only): the cloak and the hood today's black cloth (`coat` untinted);
 *  a near-black tunic and trousers; the torn cloth's lavender dimmer than today's hem, a dusk step before it; bright
 *  silver plate (`spike`: gauntlets, boots, belt, clasp) and its lines (`bevel`: the lames, the glyph line); the
 *  strap and the clasp's mark near black (`welt`); the belt's green stone self-lit (`facing`). */
/** Its slash line's colours (slashFx.js, HERO_LOOKS.ref11.slash): the flash, the line, what it cools to, the heavy
 *  line's side rows; lavender to violet, under today's white-hot. */
export const REF11_SLASH = Object.freeze({
  light: { hot: [1.7, 1.25, 2.6], core: [0.9, 0.55, 1.6], end: [0.22, 0.06, 0.5] },
  heavy: { hot: [1.6, 1.0, 2.6], core: [0.85, 0.4, 1.7], end: [0.3, 0.05, 0.6], edge: [0.6, 0.2, 1.3] },
});

export const REF11_TINT = {
  shirt: { fill: [0.075, 0.07, 0.1] },
  pants: { fill: [0.055, 0.055, 0.07] },
  // (the owner, 2026-11-28: the rags were "too white at the bottom" and wanted a subtler change: a dusk violet
  // step (collarIn) between the black and a dimmer lavender (hem), each change along a torn line)
  collarIn: { fill: [0.11, 0.09, 0.16] },
  hem: { fill: [0.24, 0.2, 0.33], ink: [0.46, 0.38, 0.64] },
  // the layers over the black: the quilted vest (collar) and the violet tabard (piping)
  collar: { fill: [0.34, 0.25, 0.27] },
  piping: { fill: [0.3, 0.2, 0.46] },
  spike: { fill: [0.5, 0.52, 0.58], sub: 0.55, spec: [1.3, 22] },
  bevel: { fill: [0.72, 0.74, 0.82] },
  welt: { fill: [0.07, 0.07, 0.08] },
  facing: { fill: [0.12, 0.6, 0.22], ink: [0.4, 1.35, 0.5], inkGlow: 0.5, glowK: 0.7 },
};
