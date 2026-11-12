import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import {
  shellGeometry, skirtSheet, tatterStrip, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, ribbonCrease, lerp, limb,
  gripFist, looseHand, sheetOffset, clumpGeometry, orientTo,
} from '../heroGeo.js';

// The Shrouded set (owner reference 2026-11-11: a hooded swordsman in a huge tattered cloak, seen
// from behind, the sword low in his right hand, the cloak thrown wide to his left; ADR-043). The
// default outfit since then (gear/index.js DEFAULT_LOADOUT), worn over the Wanderer's boots, coat
// tails and sword:
//   head   shroud.hood    a hood worn pushed back, a rounded crown, the face in its shadow; gold
//                         strands out of it: a spiky fringe, cheek locks, a strand a side onto the
//                         collarbone (HOOD_HAIR; `hair`: the pieces of the body's hair kept)
//   chest  shroud.tunic   a closed wrap tunic, a neck scarf, one belt
//   arms   shroud.arms    cloth sleeves, bound forearms, bare hands
//   back   shroud.cloak   a mantle over the shoulders and SHROUD_SHEETS: ragged sheets on the
//                         streamer springs (anim.js), round his back and over his LEFT side and arm
//                         (trimmed in ADR-065: his back and legs show between them).
//                         The sword arm stays clear of the cloth, so the arm and the blade read.
// Built in code from the heroGeo.js sheets (no sculpted parts): `npm run hero-parts` is not needed.
//
// Heights in comments are metres in the idle stance.

/**
 * The cloak's sheets. Each hangs from `on` ('chest', or an upper arm 'armL' / 'armR') at `at`
 * (that joint's space), its outer face looking along `ry` (rad about Y: 0 = his front, + = his
 * left, π = straight back). `w` = width at the root / the seam / the torn hem, `len` = the two
 * spring segments, `out` = how far it stands out at rest (tan of the angle; anim.js _streamers),
 * `strips` = the lengths (m) of the torn points along its hem (`fork`: 1 = a forked point),
 * `wrap` = the radius it curves round the body at the root, `lag` = how much it trails the motion
 * (1 = a light ribbon that streams out level at a run; SHROUD_LAG by default).
 */
const SHROUD_LAG = 0.5;
/** How far a cloak sheet may swing from hanging (rad): just short of level. */
const SHROUD_MAX = 1.45;
export const SHROUD_SHEETS = [
  // (Session 21, ADR-065, owner: "reduce the back cloak from covering too much"; picked "A trimmed" of
  // three rendered previews (trimmed, back only, short): the same seven sheets, ~30 % narrower and
  // 15 % shorter (the torn points too), standing off his back less. Before: widths [0.26, 0.4, 0.56]
  // down the middle, out 0.42-0.5; the cloak fanned 1.44 m across at rest and hid his back and legs.)
  // down his back (Session 16, owner: from the side he was "way too skinny" with little depth: the
  // three back sheets hang from further back, off the mantle's back, and stand off his back; their
  // outward pull points straight back, so he is no wider from behind)
  { on: 'chest', at: [0, 0.2, -0.16], ry: Math.PI, w: [0.177, 0.272, 0.381], len: [0.425, 0.425], out: 0.3, wrap: 0.24, strips: [0.187, 0.102, 0.255, 0.136, 0.204], fork: [0, 1, 0, 0, 1], seed: 3 },
  { on: 'chest', at: [0.11, 0.205, -0.14], ry: Math.PI - 0.62, w: [0.15, 0.258, 0.367], len: [0.425, 0.408], out: 0.36, wrap: 0.22, strips: [0.153, 0.255, 0.102, 0.221], fork: [1, 0, 0, 1], seed: 17 },
  { on: 'chest', at: [-0.11, 0.205, -0.14], ry: Math.PI + 0.62, w: [0.15, 0.245, 0.34], len: [0.408, 0.391], out: 0.3, wrap: 0.22, strips: [0.221, 0.119, 0.187, 0.085], fork: [0, 1, 0, 0], seed: 29 },
  // thrown back behind the sword shoulder: short, so the right arm and the blade stay clear
  { on: 'chest', at: [-0.205, 0.2, -0.055], ry: Math.PI + 1.15, w: [0.109, 0.177, 0.231], len: [0.34, 0.289], out: 0.3, wrap: 0.2, strips: [0.17, 0.085, 0.136], fork: [0, 0, 1], seed: 41 },
  // his left side: the wing
  { on: 'chest', at: [0.2, 0.2, -0.04], ry: 1.9, w: [0.136, 0.245, 0.354], len: [0.408, 0.391], out: 0.4, wrap: 0.2, strips: [0.119, 0.238, 0.153, 0.272], fork: [0, 0, 1, 0], seed: 53 },
  // draped over the left arm: it follows the arm, so a raised or reaching arm lifts the wing
  { on: 'armL', at: [0.05, -0.02, 0.0], ry: 1.35, w: [0.163, 0.258, 0.34], len: [0.357, 0.357], out: 0.24, wrap: 0.16, strips: [0.255, 0.136, 0.204, 0.102], fork: [0, 1, 0, 0], seed: 67 },
  // a short torn shoulder cape on the sword arm
  { on: 'armR', at: [-0.05, -0.01, -0.02], ry: -1.9, w: [0.136, 0.177, 0.204], len: [0.17, 0.136], out: 0.24, wrap: 0.13, strips: [0.085, 0.136, 0.068], fork: [0, 0, 0], lag: 0.25, seed: 79 },
];

// ---------------------------------------------------------------- head: the hood
/** Hood rings in head space (y above the neck-base joint, before BODY.headScale): half-width rx,
 *  half-depth rz, centre offset cz, and the face opening's half-chord `gap`. From the drape on the
 *  shoulders up round the head to a rounded crown with a soft, short peak at the back.
 *  (Session 14, owner: "his hood is too pointy at the top", and the deep hood over a pale face read
 *  "like death". The hood now sits pushed back: the rim runs over the crown of the head behind the
 *  hairline, the opening is wide, and the gold fringe and side locks fall out in front of it.) */
const HOOD_RINGS = [
  { y: -0.03, rx: 0.172, rz: 0.13, cz: -0.02, gap: 0.07 },
  { y: 0.03, rx: 0.136, rz: 0.12, cz: -0.016, gap: 0.068 },
  { y: 0.085, rx: 0.13, rz: 0.13, cz: -0.012, gap: 0.098 },
  { y: 0.145, rx: 0.136, rz: 0.142, cz: -0.012, gap: 0.112 },
  { y: 0.205, rx: 0.132, rz: 0.142, cz: -0.016, gap: 0.104 },
  { y: 0.255, rx: 0.114, rz: 0.13, cz: -0.024, gap: 0.072 },
  { y: 0.292, rx: 0.084, rz: 0.104, cz: -0.036, gap: 0.03 },
  { y: 0.314, rx: 0.046, rz: 0.066, cz: -0.05, gap: 0.006 },
  { y: 0.322, rx: 0.012, rz: 0.022, cz: -0.062, gap: 0.003 },
];

function buildHood({ head, M, mesh }) {
  // the cloth: the outside in the coat's black, the inside in the lining (a dark cavity round the
  // face); folds drawn down it from the point (foldLines)
  const g = foldLines(shellGeometry(HOOD_RINGS, { sub: 2, cols: 26 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 62 + y * 9) - 1.4 * Math.max(0, (y - 0.22) / 0.1));
  mesh(head, g, M.coat);
  mesh(head, g, M.lining);
  // the rim round the face opening: a paler torn edge, so the opening reads from the front
  const rim = [];
  for (const s of [-1, 1]) {
    rim.push(...[0, 1, 2, 3, 4].map((k) => {
      const A = HOOD_RINGS[k + 1], B = HOOD_RINGS[k + 2];
      const pt = (R) => {
        const a = Math.asin(Math.min(0.95, R.gap / R.rx));
        return [s * Math.sin(a) * (R.rx + 0.003), R.y, Math.cos(a) * (R.rz + 0.003) + R.cz];
      };
      const p = pt(A), q = pt(B);
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const b = boxGeometry(0.014, len + 0.006, 0.006, 0, 0, 0);
      // lay the strip along p → q
      const ax = Math.atan2(q[2] - p[2], q[1] - p[1]), az = -Math.asin((q[0] - p[0]) / len);
      b.rotateX(ax);
      b.rotateZ(az);
      b.translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
      return b;
    }));
  }
  mesh(head, mergeGeometries(rim), M.hem);
  buildHoodHair(head, M, mesh, HOOD_HAIR);
}

/** Gold strands out of the hood (head space): each lock is [x, y, z of its root, direction x, y, z,
 *  length, half-width, curl]; `sides` are mirrored to both sides. Neighbours alternate the ink
 *  sub-id so a line separates them (strands, not one gold mass). Session 16, the owner's pick of
 *  three previews ("A"): a spiky fringe over the brow, chin-length locks at the cheeks, a short
 *  strand a side onto the collarbone; the face is in the hood's shadow (`shadowsFace`). Until then a
 *  pale face under one gold fringe read as a gold face. */
const HOOD_HAIR = {
  fringe: [[-0.05, 0.225, 0.075, -0.25, -1, 0.55, 0.085, 0.013, 0.25], [-0.018, 0.23, 0.085, -0.08, -1, 0.6, 0.095, 0.014, 0.25], [0.018, 0.23, 0.085, 0.1, -1, 0.6, 0.09, 0.014, 0.25], [0.052, 0.225, 0.075, 0.3, -1, 0.5, 0.08, 0.013, 0.25]],
  sides: [[0.072, 0.2, 0.06, 0.12, -1, 0.15, 0.13, 0.015, 0.2], [0.08, 0.17, 0.035, 0.2, -1, 0.1, 0.12, 0.013, 0.2], [0.088, 0.07, 0.04, 0.35, -1, 0.35, 0.13, 0.014, 0.15]],
};
function buildHoodHair(head, M, mesh, H) {
  const mass = [], tips = [];
  let k = 0;
  const lock = ([x, y, z, dx, dy, dz, L, w, curl], s) => {
    // the root third in the darker gold, the rest in the bright tips: each strand reads root → tip
    for (const [t0, t1, out] of [[0, 0.4, mass], [0.4, 1, tips]]) {
      out.push(sub(orientTo(clumpGeometry(L, w, w * 0.5, { t0, t1, curl, taper: 0.7, cols: 6, rows: 2 }), [s * x, y, z], [s * dx, dy, dz], [s * 0.3, 0.2, 1]), k & 1));
    }
    k++;
  };
  for (const l of H.fringe) lock(l, 1);
  for (const s of [-1, 1]) for (const l of H.sides) lock(l, s);
  mesh(head, mergeGeometries(mass), M.hair);
  mesh(head, mergeGeometries(tips), M.hairTip);
}

// ---------------------------------------------------------------- chest: the wrap tunic
function buildTunic({ spine, chest, M, BODY, REST, mesh }) {
  const ySp = (h) => h - REST.spine, yCh = (h) => h - REST.chest;
  const SHELL = BODY.shell, top = SHELL[SHELL.length - 1];
  const rings = [...SHELL, { y: top.y + 0.02, rx: 0.058, rz: 0.056 }].map((r) => ({ ...r, gap: 0, y: ySp(r.y) }));
  // one closed shell; the wrap's edge is drawn as a fold line from the left collar bone to the
  // right hip (foldLines: the 0.5 contour of a field over the front)
  const g = foldLines(shellGeometry(rings, { sub: 3, cols: 28 }), (x, y, z) => (z > 0 ? 0.5 + 9 * (x - 0.05 + (y - ySp(1.3)) * 0.42) : 0));
  mesh(spine, g, M.shirt);
  const at = (h) => {
    let k = 0;
    while (k < SHELL.length - 2 && SHELL[k + 1].y < h) k++;
    const A = SHELL[k], B = SHELL[k + 1], u = Math.min(1, Math.max(0, (h - A.y) / (B.y - A.y)));
    return [lerp(A.rx, B.rx, u), lerp(A.rz, B.rz, u), lerp(A.cz ?? 0, B.cz ?? 0, u)];
  };
  // the belt at the natural waist and its buckle
  const W = at(1.2);
  mesh(spine, bandGeometry(W[0] + 0.012, W[1] + 0.012, 0.05, 32), M.leather, 0, ySp(1.2), W[2]);
  mesh(spine, boxGeometry(0.046, 0.04, 0.014, 0.012, ySp(1.2), W[1] + W[2] + 0.016), M.trim);
  // a torn sash hanging from the belt over the left hip
  mesh(spine, foldLines(tatterStrip(0.3, 0.09, { fork: true, curl: 0.12, seed: 211 }), ribbonCrease(0.09, 1.3)), M.hem, 0.075, ySp(1.185), W[1] + W[2] + 0.012);
  // the scarf: two rolls of pale cloth round the neck, under the hood (on the chest joint)
  mesh(chest, mergeGeometries([
    sub(bandGeometry(0.098, 0.09, 0.05, 20).translate(0, yCh(1.5), 0.004), 0),
    sub(bandGeometry(0.112, 0.1, 0.046, 20).translate(0, yCh(1.47), 0.006), 1),
  ]), M.hem);
}

// ---------------------------------------------------------------- arms: sleeves, bound forearms, bare hands
/** Cloth sleeves with a rounded shoulder and a soft elbow, forearms bound in leather strips, bare
 *  hands: the sword hand closed round the grip (on the `sword` joint), the free hand loosely
 *  closed. The forearm stops short of the grip so the WRIST reads between the binding and the fist. */
function buildArms({ arms, sword, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  let open = null, grip = null;
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.skin);
  }
  for (const side of [-1, 1]) {
    const R = side < 0;
    const { upper, fore } = arms[R ? 'R' : 'L'];
    // upper arm: sleeve (sub-id 1: outlined against the torso), deltoid, and a ball over the elbow
    // so the bend is a joint, not two tubes meeting
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0, r1: ua1 + 0.002, bulge: 0.008 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.02, 0), 1),
      sub(ellipsoidGeometry(ua1 + 0.006, ua1 + 0.004, ua1 + 0.008, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.upperArm, -0.004), 1),
    ]), M.coat);
    // forearm: the sleeve's end, then leather bindings stepping down to the wrist (alternating
    // sub-ids: a line between each wrap)
    const wraps = [];
    const n = 5, y0 = -0.07, y1 = -DIM.foreArm + 0.062;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(y0, y1, t), r = lerp(fa0, fa1 - 0.003, t) + 0.004 * Math.sin(Math.PI * Math.min(1, t * 1.6));
      wraps.push(sub(limb({ length: (y0 - y1) / (n - 1) + 0.012, r0: r, r1: r - 0.004, radial: 10, rings: 2, capSegs: 1 }).translate(0, y + 0.006, 0), i & 1));
    }
    mesh(fore, sub(limb({ length: 0.085, r0: ua1 + 0.002, r1: fa0 + 0.004 }), 1), M.coat);
    mesh(fore, mergeGeometries(wraps), M.leather);
    if (R) {
      // the sword hand's wrist and the back of the hand, meeting the fist on the grip
      mesh(fore, mergeGeometries([
        limb({ length: 0.05, r0: fa1 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.07, 0),
        ellipsoidGeometry(0.034 * HK, 0.04 * HK, 0.042 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004),
      ]), M.skin);
    } else {
      const H = looseHand(DIM.foreArm - 0.03, side, HK);
      mesh(fore, limb({ length: 0.05, r0: fa1 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.075, 0), M.skin);
      // the free hand open (hanging, reaching, bracing), and the same hand closed round the grip
      // below the sword hand (on the sword joint, so it closes round the grip in every pose): the
      // animator shows one or the other as the hand joins the grip (rig.offHand, anim.js twoHand)
      open = mesh(fore, mergeGeometries([H.palm, H.fingers, H.tips, H.thumb]), M.skin);
      const F = gripFist(HK);
      grip = mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]).translate(0, 0, -DIM.offGrip), M.skin);
      grip.visible = false;
    }
  }
  return { offHand: { open, grip }, keep: [open, grip] };
}

// ---------------------------------------------------------------- back: the tattered cloak
/** The mantle (a short cape over both shoulders, on the chest joint) and SHROUD_SHEETS. Returns
 *  `streamers`: the two-segment springs the animator drives (anim.js _streamers reads each one's
 *  segs, len and out). */
function buildCloak({ chest, arms, M, REST, mesh, joint }) {
  const yCh = (h) => h - REST.chest;
  // the mantle: from the scarf out over the shoulders to a ragged edge at the top of the arms; open
  // a hand's width at the throat. Sub-id 1: outlined where the sheets leave it
  {
    // (Session 16: deeper front to back, the extra mostly behind, so the shoulders have some body in
    // profile; the same width across)
    const rings = [
      { y: yCh(1.375), rx: 0.268, rz: 0.2, cz: -0.026, gap: 0.05 },
      { y: yCh(1.42), rx: 0.252, rz: 0.186, cz: -0.02, gap: 0.045 },
      { y: yCh(1.468), rx: 0.2, rz: 0.148, cz: -0.01, gap: 0.036 },
      { y: yCh(1.505), rx: 0.118, rz: 0.102, cz: 0.002, gap: 0.03 },
    ];
    const g = sub(shellGeometry(rings, { sub: 2, cols: 30 }), 1);
    // a torn lower edge: every other column of the bottom row drops or lifts a little
    const p = g.attributes.position;
    for (let i = 0; i <= 30; i++) p.setY(i, p.getY(i) + (i % 3 === 0 ? -0.03 : i % 3 === 1 ? 0.012 : -0.008));
    g.computeVertexNormals();
    mesh(chest, g, M.coat);
    mesh(chest, g, M.lining);
    mesh(chest, boxGeometry(0.03, 0.03, 0.012, 0, yCh(1.485), 0.128, 0, 0, 0.78), M.trim); // the clasp
  }
  const streamers = [];
  SHROUD_SHEETS.forEach((d, i) => {
    const parent = d.on === 'armL' ? arms.L.upper : d.on === 'armR' ? arms.R.upper : chest;
    const base = joint(parent, ...d.at);
    base.rotation.y = d.ry; // local +Z = the sheet's outer face, +X = across it
    const [w0, w1, w2] = d.w, [L0, L1] = d.len;
    const nF = Math.max(1, Math.round(w2 / 0.11)) + 0.5, ph = i * 1.9 + 0.4;
    // drawn folds fanning down the sheet (as on the coat tails)
    const wAt = (dd) => (dd < L0 ? lerp(w0, w1, dd / L0) : lerp(w1, w2, Math.min(1, (dd - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const dd = d0 - gy, w = wAt(dd);
      const f = Math.PI * 2 * nF * (u / w + 0.5 + 0.05 * Math.sin(dd * 8 + i * 1.7)) + ph + Math.PI;
      return 0.5 + 0.62 * (Math.sin(f) + 0.3 * Math.sin(f * 2.3 + 1.7)) - 0.9 * Math.max(0, 1 - dd / 0.14);
    };
    const s0 = joint(base);
    const g0 = foldLines(skirtSheet(L0, w0, w1, d.wrap, 0.25, 0, d.seed, [0.004, 0.018, nF, ph]), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = d.wrap + 0.25 * L0;
    const fold = [0.018, 0.04, nF, ph];
    // the lower sheet: black to a third of the way down, then the pale torn zone to a jagged hem
    const g1 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.05, d.seed + 7, fold, 0, 0.36), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.05, d.seed + 7, fold, 0.36, 1), pleat(L0));
    mesh(s1, g2, M.hem);
    mesh(s1, g2, M.lining);
    // torn points along the hem (rigid on the lower segment)
    const n = d.strips.length, R2 = R1 + 0.25 * L1, wr = w2 / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.5) / n - 0.5) * w2 + sheetOffset(w2, w0, 0), a = u / R2;
      const sw = Math.max(0.06, wr * 1.2);
      const m = mesh(s1, foldLines(tatterStrip(d.strips[k], sw, { fork: !!d.fork[k], curl: 0.2, seed: 500 + d.seed * 13 + k * 7 }), ribbonCrease(sw, i * 2.7 + k * 1.3)), M.hem, Math.sin(a) * R2, -L1 + 0.012, (Math.cos(a) - 1) * R2);
      m.rotation.y = a;
    }
    // `w` (widths) and `arm` (1 / 2: hung on the right / left upper arm, which then does not push it)
    // feed the animator's cloth-vs-steel bound
    streamers.push({ segs: [s0, s1], len: d.len, out: d.out, lag: d.lag ?? SHROUD_LAG, max: SHROUD_MAX, w: d.w, arm: d.on === 'armR' ? 1 : d.on === 'armL' ? 2 : 0 });
  });
  return { streamers };
}

/** The set. `hair` on a head item: the pieces of the hair model.js builds under it ('cap' and
 *  HAIR_CLUSTERS names; `hidesHair: true` = none); `shadowsFace`: the face and neck go dark (the
 *  hood's shadow) and the eyes are left out. The hood keeps only the scalp cap and builds its own
 *  strands (HOOD_HAIR); the body's clusters poked through the cloth or massed over the face. */
export const SHROUD_ITEMS = [
  { id: 'shroud.hood', slot: 'head', name: 'Tattered Hood', hair: ['cap'], shadowsFace: true, build: buildHood },
  { id: 'shroud.tunic', slot: 'chest', name: 'Wrap Tunic', build: buildTunic },
  { id: 'shroud.arms', slot: 'arms', name: 'Bound Sleeves', build: buildArms },
  { id: 'shroud.cloak', slot: 'back', name: 'Tattered Shroud', build: buildCloak },
];
