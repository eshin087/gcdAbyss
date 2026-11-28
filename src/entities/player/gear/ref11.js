import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import {
  shellGeometry, gridGeometry, bandGeometry, boxGeometry, kiteGeometry, mergeGeometries, sub, foldLines, lerp, limb, gripFist, arcPlate, orient,
  tatterStrip, ribbonCrease, sheetOffset,
} from '../heroGeo.js';
import { hangSheet, panelSkirt } from './sheet.js';
import { buildFreeHand } from './hands.js';
import { shapedHand } from './handShape.js';

// OUTFIT OPTION "Costume 11" (gear/looks.js `ref11`, ADR-291; the owner's "COSTUME REFERENCE / 11", 2026-11-28:
// "Make the character where this design from the reference art. Make it have the same look and vibe to test out
// separately"). The sheet: a deep hood over a face lost in shadow, a heavy cowl of cloth draped round the neck and
// over both shoulders, pinned by a square silver clasp at the left collarbone; a black wrap tunic, a dark strap
// across the chest from the right shoulder to the left hip, a silver plate belt with a green stone; loose black
// sleeves into articulated silver gauntlets; a long, full cloak to the ankles, black at the shoulders and turning
// to torn lavender rags at the hem, a thin line of pale glyphs down the middle of the back; layered skirts of the
// same torn cloth between its edges; dark trousers into silver plated boots. Over the Wanderer's sword (unchanged).
// Colours: REF11_TINT. Silver plate is `spike`, its lines and the clasp `bevel`, the strap `welt`, the green
// stone `facing`. The owner's third pass (2026-11-28, the sheet "LAYERED WANDERER / ALTERNATIVE 13": "more like
// this"): silver only on the gauntlets (and the boots, the belt and the clasp, as the sheet draws them); no strap,
// no line down the back; the skirts the tunic's own black cloth, so they do not read as a second cloak; the mantle
// over the shoulders in three torn tiers; the long cloak one wide drape whose black passes through a dusk step
// (`collar`) into the lavender rags; gold hair at the sides of the shadowed face; the free hand a
// closed gauntlet fist. The sword draws in armor / trim / leather / blade / bladeTip / gem: none is tinted.
//   head   ref11.hood    the deep hood (hidesHair, shadowsFace)
//   chest  ref11.tunic   the wrap tunic and its crossing edge, the belt and its stone
//   arms   ref11.arms    loose sleeves, the silver gauntlets (both hands in silver)
//   legs   ref11.legs    trousers, the silver boots
//   waist  ref11.skirt   short fitted skirts in the trousers' charcoal
//   back   ref11.cloak   the tiered mantle, the clasp, REF11_SHEETS (the long cloak)
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

// ---------------------------------------------------------------- chest: the wrap tunic and the belt
/** The wrap's crossing edge on the chest (world idle heights; its centre's angle round the body, rad: 0 = his
 *  front, + = his left): from his right hip up over his left breast to the left shoulder, a raised fold of the
 *  tunic's own black (the owner, 2026-11-28: "no silver slash on the front": it was a strap drawn in bright lines). */
export const REF11_WRAP = { lo: 1.15, hi: 1.46, cLo: -0.5, cHi: 0.62, half: 0.022, off: 0.014 };

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
  // the wrap's crossing edge: a narrow raised fold running round the body as it rises
  {
    const W = REF11_WRAP;
    const g = sub(gridGeometry(3, 14, (s, t, o) => {
      const h = lerp(W.lo, W.hi, t), R = at(h), a = lerp(W.cLo, W.cHi, t) + (s - 0.5) * 2 * W.half / Math.max(0.1, R[0]);
      o[0] = Math.sin(a) * (R[0] + W.off);
      o[1] = ySp(h);
      o[2] = Math.cos(a) * (R[1] + W.off) + R[2];
      o[3] = s * 0.1;
      o[4] = ySp(h);
    }), 1);
    mesh(spine, g, M.shirt);
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
/** The free hand as an open gauntlet, in fore space (the arm down -Y, the wrist at y = -len, the back of the left
 *  hand +X, the thumb +Z), shifted into the wrist joint's space when the rig has one (`wp`): the reshaped hand's
 *  palm, its four jointed fingers a little curled and its thumb (handShape.js), drawn larger than the default hand
 *  so the plated fingers read from the game camera. (The owner, 2026-11-28: the fist before "doesn't look like a
 *  fist", then the fist made of finger rolls "looks very stubby from the player's perspective ... make it show more
 *  like a hand": an open hand, the owner's pick of three.) */
export const REF11_HAND = { k: 1.22, curl: 0.32 };
function gauntletHand(len, wp) {
  const H = shapedHand(len, 1, REF11_HAND.k, REF11_HAND.curl);
  const g = mergeGeometries([H.palm, H.fingers, H.tips, H.thumb]);
  if (wp) g.translate(-wp.x, -wp.y, -wp.z);
  return g;
}

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
  const out = buildFreeHand(ctx, steel);
  const open = out.offHand?.open;
  if (open) {
    open.geometry.dispose();
    open.geometry = gauntletHand(DIM.foreArm - 0.03, arms.L.wrist?.position);
  }
  return out;
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
/** The tunic's skirts on the pelvis (panelSkirt): short and fitted, to above the knee, in the trousers' charcoal
 *  (`mat` 'pants'), plain hems, slow to swing and barely fluttering (`lagK`, `flutK`: anim.js _coat), so only the
 *  cloak flows (the owner, 2026-11-28: "when i'm running left the bottom layer looks like another layer of the
 *  cloak": they were long, black and swung like it). */
export const REF11_PANELS = [
  { az: 0.4, w: [0.15, 0.18, 0.21], len: [0.25, 0.17], strips: [], fork: [], out: 0.004, flare: 0.06, cone: 0.12, skew: 0.8, slant: 0.04, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
  { az: -0.4, w: [0.15, 0.18, 0.21], len: [0.25, 0.18], strips: [], fork: [], out: 0.008, flare: 0.06, cone: 0.12, skew: -0.8, slant: 0.04, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
  { az: 1.35, w: [0.15, 0.18, 0.21], len: [0.24, 0.15], strips: [], fork: [], out: 0, flare: 0.08, cone: 0.12, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
  { az: -1.35, w: [0.15, 0.18, 0.21], len: [0.24, 0.15], strips: [], fork: [], out: 0, flare: 0.08, cone: 0.12, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
  { az: 2.6, w: [0.16, 0.19, 0.22], len: [0.22, 0.12], strips: [], fork: [], out: 0.004, flare: 0.08, cone: 0.12, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
  { az: -2.6, w: [0.16, 0.19, 0.22], len: [0.22, 0.12], strips: [], fork: [], out: 0.004, flare: 0.08, cone: 0.12, jag: 0.006, mat: 'pants', lagK: 0.45, flutK: 0.25 },
];

function buildSkirt(ctx) {
  return panelSkirt(ctx, REF11_PANELS, { seed: 11 });
}

// ---------------------------------------------------------------- back: the tiered mantle, the clasp, the long cloak
/** The cloak's sheets (hangSheet, on the chest): one down the middle of his back and one each side, all three on
 *  ONE cone (the same centre in front of the root, the same curve and flare: the side sheets' roots stand round
 *  that circle at ±`REF11_CLOAK.side` rad, a centimetre outside it so where they overlap the middle one they lie
 *  over it), so the cloak reads as one drape (the owner, 2026-11-28: parts "protruding" from the middle of the back
 *  like feathers: each sheet fanned out its own pleats on its own curve), wrapping round to his sides so it shows
 *  from the side and the front. The same flare (`out`) for all three; soft pleats (`pleat`, `foldK`). Black, then
 *  a dusk step from `fadeFrom` of the lower sheet (`collar`, the coat's own ink part: no line where it turns) into the lavender from `hemFrom` along
 *  a gently torn line (`tear`), a few short torn points. `inMax`: the roots held a little out, the lower halves
 *  free to wrap in so a roll lifts them off the grass (`floor`). */
export const REF11_CLOAK = { y: 0.2, z: -0.155, R: 0.32, side: 0.68 };
const cloakSheet = (phi, w, strips, fork, seed) => {
  const C = REF11_CLOAK, R = phi ? C.R + 0.01 : C.R, cz = C.z + C.R;
  return {
    at: [Math.sin(phi) * R, C.y, cz - Math.cos(phi) * R], ry: Math.PI - phi, w, len: [0.48, 0.43], out: 0.08, wrap: R, lag: 0.42, max: 1.35,
    inMax: phi ? [-0.06, 0.12] : [-0.04, 0.3], floor: true, fadeFrom: [0.14], hemFrom: 0.62, tear: 0.016, pleat: 0.45, foldK: 0.5,
    strips, fork, seed,
  };
};
export const REF11_SHEETS = [
  cloakSheet(0, [0.3, 0.4, 0.5], [0.08, 0.06, 0.09, 0.07], [0, 1, 0, 0], 7),
  cloakSheet(REF11_CLOAK.side, [0.2, 0.27, 0.34], [0.07, 0.06], [0, 1], 13),
  cloakSheet(-REF11_CLOAK.side, [0.2, 0.27, 0.34], [0.06, 0.07], [1, 0], 19),
];
/** The mantle over the shoulders: three short capes one over another (the sheet's layered hood and shoulders), each
 *  a shell open at the throat with a scalloped lower edge (soft rounded lobes, `lobes` round it: points read as
 *  feathers), the lowest the widest and longest, down over the upper arms (world idle heights; rx / rz the half
 *  widths, cz the centre's shift, gap the opening at the throat). Each tier starts outside the one under it where
 *  they overlap, so every edge shows. `tear`: how deep its scallops go. */
export const REF11_MANTLE = [
  { tear: 0.024, ph: 0, lobes: 7, rings: [[1.27, 0.302, 0.214, -0.03, 0.12], [1.35, 0.292, 0.206, -0.026, 0.09], [1.42, 0.262, 0.19, -0.02, 0.07]] },
  { tear: 0.02, ph: 1, lobes: 6, rings: [[1.34, 0.314, 0.224, -0.026, 0.1], [1.41, 0.288, 0.207, -0.022, 0.08], [1.47, 0.222, 0.166, -0.012, 0.056]] },
  { tear: 0.018, ph: 2, lobes: 5, rings: [[1.41, 0.3, 0.215, -0.02, 0.085], [1.46, 0.262, 0.19, -0.012, 0.064], [1.495, 0.19, 0.146, -0.004, 0.046], [1.522, 0.12, 0.1, 0, 0.034]] },
];

function buildCloak(ctx) {
  const { chest, M, REST, mesh, joint } = ctx;
  const yCh = (h) => h - REST.chest;
  {
    const COLS = 27;
    for (const T of REF11_MANTLE) {
      const rings = T.rings.map(([y, rx, rz, cz, gap]) => ({ y: yCh(y), rx, rz, cz, gap }));
      const g = foldLines(sub(shellGeometry(rings, { sub: 2, cols: COLS }), T.ph & 1), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 30 + y * 14 + T.ph * 1.7));
      // its scalloped lower edge: rounded lobes round it, each tier's set turned a little from the one under it
      const p = g.attributes.position;
      for (let i = 0; i <= COLS; i++) {
        const c = Math.cos((i / COLS) * Math.PI * 2 * T.lobes + T.ph * 1.9);
        p.setY(i, p.getY(i) - T.tear * (0.5 + 0.5 * c) * (0.75 + 0.25 * Math.abs(c)));
      }
      g.computeVertexNormals();
      mesh(chest, g, M.coat);
      mesh(chest, g, M.lining);
    }
    const roll = [
      { y: yCh(1.45), rx: 0.17, rz: 0.15, cz: 0.0, gap: 0.05 },
      { y: yCh(1.49), rx: 0.15, rz: 0.13, cz: 0.004, gap: 0.042 },
      { y: yCh(1.525), rx: 0.11, rz: 0.1, cz: 0.006, gap: 0.034 },
    ];
    mesh(chest, foldLines(sub(shellGeometry(roll, { sub: 1, cols: 24 }), 1), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 22 - y * 30)), M.coat);
    // the clasp at the left collarbone, on the top tier: a square silver plate set on its point, a smaller one in
    // it, a mark
    const cl = joint(chest, 0.112, yCh(1.43), 0.15);
    cl.rotation.y = 0.55;
    cl.rotation.x = -0.25;
    mesh(cl, kiteGeometry(0.03, 0.03, 0.008), M.spike);
    mesh(cl, kiteGeometry(0.019, 0.019, 0.006).translate(0, 0, 0.006), M.bevel);
    mesh(cl, mergeGeometries([boxGeometry(0.004, 0.016, 0.003, -0.003, 0, 0.011), boxGeometry(0.01, 0.003, 0.003, 0.001, 0.004, 0.011)]), M.welt);
  }
  const streamers = REF11_SHEETS.map((d) => {
    const S = hangSheet(ctx, chest, d, { face: M.coat, back: M.lining, hem: M.hem, fade: [M.collar] });
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
  return { streamers };
}

export const REF11_ITEMS = [
  // (the sheet's gold locks at the sides of the shadowed face: the cap, the fringe and the left lock under the hood)
  { id: 'ref11.hood', slot: 'head', name: 'Deep Hood', hair: ['cap', 'fringe', 'left'], shadowsFace: true, build: buildHood },
  { id: 'ref11.tunic', slot: 'chest', name: 'Wrap Tunic and Plate Belt', build: buildTunic },
  { id: 'ref11.arms', slot: 'arms', name: 'Loose Sleeves and Silver Gauntlets', build: buildArms },
  { id: 'ref11.legs', slot: 'legs', name: 'Silver Plated Boots', build: buildLegs },
  { id: 'ref11.skirt', slot: 'waist', name: 'Short Fitted Skirts', build: buildSkirt },
  { id: 'ref11.cloak', slot: 'back', name: 'Tiered Mantle and Long Torn Cloak', build: buildCloak },
];

export const REF11_LOADOUT = Object.freeze({
  head: 'ref11.hood', chest: 'ref11.tunic', shoulders: null, arms: 'ref11.arms',
  legs: 'ref11.legs', waist: 'ref11.skirt', back: 'ref11.cloak', weapon: 'wanderer.sword',
});

/** Its colours (model.js tintHero, this rig only): the cloak and the hood today's black cloth (`coat` untinted);
 *  a near-black tunic, its skirts and trousers; the cloak's dusk step and its lavender rags (the owner: not
 *  near white at the bottom, a subtle change); bright silver plate (`spike`: gauntlets, boots, belt, clasp) and its
 *  lines (`bevel`); the clasp's mark near black (`welt`); the belt's green stone self-lit (`facing`). */
/** Its slash line's colours (slashFx.js, HERO_LOOKS.ref11.slash): the flash, the line, what it cools to, the heavy
 *  line's side rows; lavender to violet, under today's white-hot. */
export const REF11_SLASH = Object.freeze({
  light: { hot: [1.7, 1.25, 2.6], core: [0.9, 0.55, 1.6], end: [0.22, 0.06, 0.5] },
  heavy: { hot: [1.6, 1.0, 2.6], core: [0.85, 0.4, 1.7], end: [0.3, 0.05, 0.6], edge: [0.6, 0.2, 1.3] },
});

export const REF11_TINT = {
  shirt: { fill: [0.075, 0.07, 0.1] },
  pants: { fill: [0.12, 0.115, 0.13] },
  // the cloak's dusk step: `collar`, the coat's own ink part, so the art pass draws no line where the black turns
  // to it (a step in another part drew a line across the cloak: another layer's edge)
  collar: { fill: [0.165, 0.135, 0.23] },
  welt: { fill: [0.07, 0.07, 0.08] },
  hem: { fill: [0.27, 0.22, 0.38], ink: [0.5, 0.42, 0.68] },
  spike: { fill: [0.5, 0.52, 0.58], sub: 0.55, spec: [1.3, 22] },
  bevel: { fill: [0.72, 0.74, 0.82] },
  facing: { fill: [0.12, 0.6, 0.22], ink: [0.4, 1.35, 0.5], inkGlow: 0.5, glowK: 0.7 },
};
