import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import {
  shellGeometry, skirtSheet, tatterStrip, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, ribbonCrease, lerp, limb,
  gripFist, looseHand, sheetOffset, rng, gridGeometry, partGeometry,
} from '../../player/heroGeo.js';
import { refBuild } from './refLook.js';

// Shen Hui rebuilt from the identity anchor (docs/art/character-packs-v04/shen-hui/identity-anchor.png,
// A01's turnaround; ADR-289, `?ashRef=a|b|c`). Not a trim on the shipped robe: every piece he wears is
// drawn again after the sheet, on the same skeleton and the same materials:
//   - a loose ash-grey robe with a crossed collar (the left lapel over the right, a dark facing on its
//     edge), bloused over a thick sash of brown cord wound three times, knotted at his left, tails hanging;
//   - the robe's skirt in two layers, open at the front over a long brick-red inner robe (front and back),
//     its over-layer torn off at mid-thigh, the lower layer run out into deep ragged points;
//   - asymmetric sleeves: wide and loose from the shoulder; on the sword arm torn off below the elbow,
//     the forearm bare under a bracer of old bronze; on the free arm a wide bell to the wrist, torn;
//   - loose dark trousers, white cloth wound crosswise from the knee to the ankle, dark cloth shoes;
//   - the small steep douli (the owner's size) with a frayed straw brim; black hair under it, a long tail
//     down his back on a spring, two locks beside the face.
// The three options are steps of one build (refLook.js REF_BUILD): b the fullest and longest, c the leanest.
// The jian, the colours of each cloth, the phase dressing (look.js) are his own.

// ---------------------------------------------------------------- tearing
const TAU = Math.PI * 2;
/** The depth (0..~1.6) of a torn edge at column i: alternate notches and points, a few long tears. */
function tearDepths(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = r();
    if (i % 2 === 0) return 0.12 * x;
    return x > 0.82 ? 1.5 : 0.45 + 0.55 * x;
  });
}
/** Drop one vertex row of a grid (gridGeometry layout: (cols + 1) per row) by depth × tear: its torn
 *  edge. `row` 0 = the first row, else the last. Moves the glyph v with it (glyphs stay upright). */
function tearRow(g, cols, rows, depth, seed, row = 'last') {
  const p = g.attributes.position, uv = g.attributes.aGUV;
  const j = row === 'last' ? rows : 0, D = tearDepths(cols, seed);
  for (let i = 0; i <= cols; i++) {
    const k = j * (cols + 1) + i, d = depth * D[i];
    p.setY(k, p.getY(k) - d);
    uv?.setY(k, uv.getY(k) - d);
  }
  // (a seam's two copies, i = 0 and cols on a closed ring, move alike)
  if (row !== 'last') {
    const k0 = j * (cols + 1), k1 = k0 + cols;
    p.setY(k1, p.getY(k0));
  }
  g.computeVertexNormals();
  return g;
}

/** An open shell (rings ascending in y) torn along its LOWEST ring. */
function tornShell(rings, { cols = 20, sub: s = 2, depth = 0.04, seed = 1 } = {}) {
  const g = shellGeometry(rings, { sub: s, cols });
  return tearRow(g, cols, (rings.length - 1) * s, depth, seed, 'first');
}

/** A skirt sheet (heroGeo.skirtSheet's arguments) whose hem is torn `depth` deep. */
function tornSheet(depth, seed, ...a) {
  const g = skirtSheet(...a);
  const rows = Math.max(3, Math.round(8 * ((a[9] ?? 1) - (a[8] ?? 0))));
  return tearRow(g, 16, rows, depth, seed, 'last');
}

/** z on a body shell's surface (rings {y, rx, rz, cz}) at height y and x (its front). */
function shellFront(rings, y, x) {
  let k = 0;
  while (k < rings.length - 2 && rings[k + 1].y < y) k++;
  const A = rings[k], B = rings[k + 1], u = Math.max(0, Math.min(1, (y - A.y) / (B.y - A.y)));
  const rx = lerp(A.rx, B.rx, u), rz = lerp(A.rz, B.rz, u), cz = lerp(A.cz ?? 0, B.cz ?? 0, u);
  const q = Math.min(0.98, Math.abs(x) / rx);
  return rz * Math.sqrt(1 - q * q) + cz;
}

/** A strip laid on a shell's front along a line from (x0, y0) to (x1, y1), w wide, `lift` off it. */
function frontStrip(rings, x0, y0, x1, y1, w, lift = 0.004, n = 10) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  return gridGeometry(2, n, (s, t, o) => {
    const x = lerp(x0, x1, t) + nx * (s - 0.5) * w, y = lerp(y0, y1, t) + ny * (s - 0.5) * w;
    o[0] = x;
    o[1] = y;
    o[2] = shellFront(rings, y, x) + lift;
    o[3] = x;
    o[4] = y;
  });
}

// ---------------------------------------------------------------- head: the hat, the hair
/** The hat (the owner's size: gear.js LOOK.hat) with a frayed brim, his hair under it: a tail down his
 *  back on a spring and two locks by his face. `rings` the hat's own shell (gear.js HAT_RINGS). */
export function refHat({ head, M, mesh, joint }, { rings, R, brimY }) {
  const B = refBuild();
  const g = foldLines(shellGeometry(rings, { sub: 2, cols: 32 }), (x, y) => 0.5 + 0.55 * Math.sin((y - 0.19) * 170));
  mesh(head, g, M.leather);
  mesh(head, g, M.lining);
  // the worn brim: loose straw hanging off its edge, torn
  const fr = tornShell([
    { y: brimY - 0.022, rx: R * 1.035, rz: R * 1.035, cz: -0.01 },
    { y: brimY + 0.001, rx: R * 0.995, rz: R * 0.995, cz: -0.01 },
  ], { cols: 36, sub: 1, depth: B.hatFray, seed: 611 });
  foldLines(fr, (x, y, z) => 0.5 + 0.6 * Math.sin(Math.atan2(x, z) * 36));
  mesh(head, fr, M.leather);
  mesh(head, fr, M.lining);
  // the cord round the crown that holds it on
  mesh(head, sub(bandGeometry(0.1, 0.11, 0.05, 20), 1), M.shirt, 0, 0.19, -0.01);
  // his hair: the skull's cap (dark under the brim) and the tail's knot at the nape
  // (black hair in the charcoal `shirt`: the `hair` part's ink lines are gold on every rig)
  mesh(head, partGeometry('hair.cap'), M.shirt);
  mesh(head, sub(ellipsoidGeometry(0.03, 0.035, 0.03, { widthSegs: 8, heightSegs: 6 }).translate(0, 0.115, -0.11), 1), M.shirt);
  // two locks fallen beside his face, to the jaw
  const locks = mergeGeometries([-1, 1].map((s, k) => sub(tatterStrip(B.locks, 0.035, { curl: 0.12, seed: 851 + k }).translate(s * 0.085, 0.13, 0.05), k)));
  mesh(head, locks, M.shirt);
  // the tail down his back (on a spring: it streams when he moves)
  const base = joint(head, 0, 0.11, -0.115);
  base.rotation.y = Math.PI;
  const s0 = joint(base);
  const [L0, L1] = B.tail;
  mesh(s0, foldLines(tatterStrip(L0, 0.075, { tip: false, curl: 0.04, seed: 861 }), ribbonCrease(0.075, 0.4)), M.shirt);
  const s1 = joint(s0, 0, -L0, 0);
  mesh(s1, foldLines(tatterStrip(L1, 0.07, { fork: true, curl: 0.1, seed: 867 }), ribbonCrease(0.07, 1.2)), M.shirt);
  return { streamers: [{ segs: [s0, s1], len: [L0, L1], out: 0.05, lag: 0.85, max: 1.5 }] };
}

// ---------------------------------------------------------------- chest: the robe, the sash
export function refRobe({ spine, chest, M, BODY, REST, mesh }) {
  const B = refBuild();
  const ySp = (h) => h - REST.spine, yCh = (h) => h - REST.chest;
  const SHELL = BODY.shell, top = SHELL[SHELL.length - 1];
  // loose: the robe stands off the body, most at the chest and where it blouses over the sash
  const loose = (r, k) => {
    const lo = k <= 1 ? B.blouse : B.loose;
    return { ...r, rx: r.rx + lo, rz: r.rz + lo * 0.8, gap: 0, y: ySp(r.y) };
  };
  const rings = [...SHELL, { y: top.y + 0.02, rx: 0.062, rz: 0.06 }].map(loose);
  // the cloth's own soft folds down the body, deeper below the chest
  const g = foldLines(shellGeometry(rings, { sub: 3, cols: 32 }), (x, y, z) => 0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 9 + y * 4) * Math.max(0, Math.min(1, (ySp(1.4) - y) * 5)));
  mesh(spine, g, M.coat);
  // the crossed collar: the left lapel's edge from the left of his neck down to his right side under
  // the arm, a dark facing along it, the right lapel's edge showing under it
  const Rw = rings.map((r) => ({ ...r }));
  const lapel = frontStrip(Rw, 0.05, ySp(1.5), -0.14, ySp(1.17), 0.034, 0.006, 12);
  mesh(spine, sub(lapel, 0), M.lining);
  // the collar round the back of the neck (dark), the off-white under-robe's edge inside it
  mesh(chest, mergeGeometries([
    sub(bandGeometry(0.1, 0.092, 0.05, 20).translate(0, yCh(1.5), 0.006), 0),
  ]), M.hem);
  mesh(chest, sub(bandGeometry(0.118, 0.108, 0.034, 20).translate(0, yCh(1.475), 0.008), 1), M.lining);
  // the sash: brown cord wound three times, each turn a little off the last, knotted at his left front
  const W = SHELL[1], cz = W.cz ?? 0;
  const turns = [];
  for (let k = 0; k < 3; k++) {
    const t = bandGeometry(W.rx + B.blouse + 0.016 + 0.004 * (k % 2), W.rz + B.blouse * 0.8 + 0.014 + 0.004 * (k % 2), 0.042, 32);
    t.rotateZ((k - 1) * 0.05).rotateX((k - 1) * 0.04);
    turns.push(sub(t.translate(0, ySp(1.15 + 0.038 * k), cz), k & 1));
  }
  mesh(spine, mergeGeometries(turns), M.piping);
  const zF = W.rz + B.blouse * 0.8 + 0.03;
  mesh(spine, mergeGeometries([
    ellipsoidGeometry(0.04, 0.032, 0.026, { widthSegs: 10, heightSegs: 6 }).translate(0.09, ySp(1.19), zF - 0.01),
    sub(foldLines(tatterStrip(B.sashTail[0], 0.045, { curl: 0.1, seed: 311 }), ribbonCrease(0.045, 0.7)).translate(0.1, ySp(1.17), zF), 1),
    foldLines(tatterStrip(B.sashTail[1], 0.04, { curl: 0.14, seed: 317 }), ribbonCrease(0.04, 1.9)).translate(0.07, ySp(1.17), zF - 0.004),
  ]), M.piping);
}

// ---------------------------------------------------------------- arms: wide torn sleeves, the bracer
export function refSleeves({ arms, sword, M, DIM, BODY, mesh }) {
  const B = refBuild();
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.skin);
  }
  const both = (joint, g) => {
    mesh(joint, g, M.coat);
    mesh(joint, g, M.lining);
  };
  for (const side of [-1, 1]) {
    const R = side < 0;
    const { upper, fore } = arms[R ? 'R' : 'L'];
    // the upper sleeve: loose from the shoulder, widening to the elbow; it hangs a little below the arm
    const U = DIM.upperArm, w = B.sleeve;
    const up = shellGeometry([
      { y: -U - 0.02, rx: ua1 + w[1], rz: ua1 + w[1] * 1.1, cz: -0.006 },
      { y: -U * 0.55, rx: ua0 + (w[0] + w[1]) * 0.5, rz: ua0 + (w[0] + w[1]) * 0.55, cz: -0.004 },
      { y: -0.02, rx: ua0 + w[0], rz: ua0 + w[0], cz: 0 },
      { y: 0.04, rx: ua0 * 0.8, rz: ua0 * 0.8, cz: 0 },
    ], { sub: 2, cols: 18 });
    both(upper, foldLines(up, (x, y, z) => 0.5 + 0.6 * Math.sin(Math.atan2(x, z) * 4 + y * 5 + side)));
    // the arm inside it, at the elbow (seen in the open end)
    mesh(upper, sub(limb({ length: U, r0: ua0 - 0.004, r1: ua1 - 0.002 }), 1), M.lining);
    if (R) {
      // the sword arm: the sleeve torn off a hand below the elbow; the forearm bare, the bracer of old
      // bronze from mid-forearm to the wrist
      const cuff = tornShell([
        { y: -B.swordCuff, rx: fa0 + w[1] * 0.95, rz: fa0 + w[1] * 1.05, cz: -0.004 },
        { y: 0.03, rx: ua1 + w[1] * 0.95, rz: ua1 + w[1] * 1.05, cz: -0.006 },
      ], { cols: 18, sub: 2, depth: B.sleeveTear, seed: 701 });
      both(fore, foldLines(cuff, (x, y, z) => 0.5 + 0.6 * Math.sin(Math.atan2(x, z) * 4 + 1)));
      const y0 = -0.1, y1 = -DIM.foreArm + 0.065;
      mesh(fore, mergeGeometries([
        limb({ length: -y0 + 0.01, r0: fa0 - 0.004, r1: lerp(fa0, fa1, 0.4) - 0.004, radial: 10, rings: 2, capSegs: 1 }),
        limb({ length: 0.05, r0: fa1 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.07, 0),
        ellipsoidGeometry(0.034 * HK, 0.04 * HK, 0.042 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004),
      ]), M.skin);
      const shell = [sub(limb({ length: y0 - y1 + 0.02, r0: lerp(fa0, fa1, 0.35) + 0.01, r1: fa1 + 0.008, radial: 12, rings: 3, capSegs: 1 }).translate(0, y0 + 0.005, 0), 0)];
      for (let i = 0; i < 4; i++) {
        const t = i / 3, y = lerp(y0, y1 + 0.004, t), r = lerp(lerp(fa0, fa1, 0.35), fa1, t) + 0.015;
        shell.push(sub(limb({ length: 0.012, r0: r, r1: r, radial: 12, rings: 1, capSegs: 1 }).translate(0, y + 0.006, 0), 1));
      }
      mesh(fore, mergeGeometries(shell), M.trim);
    } else {
      // the free arm: the wide sleeve on down to the wrist as a bell, torn at its edge (the hand shows
      // out of it)
      const Lf = B.freeLen, wf = B.freeBell;
      const bell = tornShell([
        { y: -Lf, rx: fa1 + wf, rz: fa1 + wf * 1.1, cz: -0.012 },
        { y: -Lf * 0.5, rx: fa0 + (w[1] + wf) * 0.5, rz: fa0 + (w[1] + wf) * 0.55, cz: -0.008 },
        { y: 0.03, rx: ua1 + w[1] * 0.95, rz: ua1 + w[1] * 1.05, cz: -0.006 },
      ], { cols: 20, sub: 2, depth: B.sleeveTear, seed: 709 });
      both(fore, foldLines(bell, (x, y, z) => 0.5 + 0.6 * Math.sin(Math.atan2(x, z) * 4 + y * 6)));
      const H = looseHand(DIM.foreArm - 0.03, side, HK);
      mesh(fore, mergeGeometries([
        limb({ length: DIM.foreArm - 0.02, r0: fa0 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }),
        H.palm, H.fingers, H.tips, H.thumb,
      ]), M.skin);
    }
  }
}

// ---------------------------------------------------------------- legs: loose trousers, crossed wraps
export function refLegs({ pelvis, legs, M, DIM, BODY, mesh }) {
  const B = refBuild();
  {
    const [hx, hy, hz] = BODY.hips.r;
    const g = ellipsoidGeometry(hx + 0.016, hy + 0.012, hz + 0.016);
    mesh(pelvis, g, M.pants, ...BODY.hips.c);
  }
  const [th0, th1] = BODY.thigh, [sh0, sh1] = BODY.shin;
  const wrapTop = -B.wrapTop;
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    const crease = (x, y, z) => 0.5 + 0.55 * Math.sin(Math.atan2(x, z) * 3 + y * 9 + side);
    // loose trousers, fuller at the knee, gathered into the wraps
    mesh(thigh, foldLines(limb({ length: DIM.thigh, r0: th0 + B.trouser, r1: th1 + B.trouser * 1.2, bulge: B.trouser }), crease), M.pants);
    mesh(shin, foldLines(limb({ length: -wrapTop + 0.03, r0: th1 + B.trouser * 1.2, r1: sh0 + 0.016, bulge: B.trouser * 0.8 }), crease), M.pants);
    // the off-white cloth wound crosswise from below the knee to the ankle (two diagonals crossing)
    const L = DIM.shin + wrapTop - 0.035;
    const wrap = limb({ length: L, r0: lerp(sh0, sh1, 0.25) + 0.012, r1: sh1 + 0.006, radial: 14, rings: 10, capSegs: 1 }).translate(0, wrapTop, 0);
    mesh(shin, foldLines(wrap, (x, y, z) => {
      const a = Math.atan2(x, z) * 2, v = y * 52;
      return 0.5 + 0.55 * Math.sin(a + v) * Math.sin(a - v);
    }), M.hem);
    const F = BODY.foot;
    mesh(foot, ellipsoidGeometry(F.r[0] * 0.92, F.r[1] * 0.85, F.r[2] * 0.95, { widthSegs: 10, heightSegs: 6 }).translate(F.c[0], F.c[1] - 0.004, F.c[2]), M.shirt);
  }
}

// ---------------------------------------------------------------- waist: the two-layer skirt, the red robe
/** The skirt's panels (anim.js reads the first six in the order the hero's coat uses: front-left,
 *  front-right, left, right, back-left, back-right; the red inner robe comes after). The front panels
 *  part at the middle so the red shows down his front. Lengths and flare from the build. */
function panels(B) {
  const L = B.len, f = B.full;
  return [
    { az: 0.72, w: [0.13 * f, 0.19 * f, 0.26 * f], len: L, strips: [], fork: [], out: 0.012, flare: 0.1 * f, skew: 1 },
    { az: -0.72, w: [0.13 * f, 0.19 * f, 0.26 * f], len: L, strips: [], fork: [], out: 0.006, flare: 0.1 * f, skew: -1 },
    { az: 1.55, w: [0.13 * f, 0.18 * f, 0.24 * f], len: [L[0] * 0.97, L[1] * 0.97], strips: [], fork: [], out: 0.004, flare: 0.26 * f },
    { az: -1.55, w: [0.13 * f, 0.18 * f, 0.24 * f], len: [L[0] * 0.97, L[1] * 0.97], strips: [], fork: [], out: 0.004, flare: 0.26 * f },
    { az: 2.5, w: [0.17 * f, 0.25 * f, 0.33 * f], len: [L[0] * 1.02, L[1] * 1.03], strips: [], fork: [], out: 0.008, flare: 0.17 * f, skew: -0.4 },
    { az: -2.5, w: [0.17 * f, 0.25 * f, 0.33 * f], len: [L[0] * 1.02, L[1] * 1.03], strips: [], fork: [], out: 0.008, flare: 0.17 * f, skew: 0.4 },
    { az: 0.02, w: [0.11, 0.13, 0.15], len: [L[0], L[1] * 1.04], strips: [], fork: [], out: 0.004, flare: 0.06, mat: 'facing', inner: true },
    { az: Math.PI, w: [0.07, 0.09, 0.11], len: [L[0], L[1]], strips: [], fork: [], out: 0, flare: 0.1, mat: 'facing', inner: true },
  ];
}

export function refSkirt({ pelvis, M, DIM, mesh, joint }) {
  const B = refBuild();
  const coat = [];
  panels(B).forEach((P, i) => {
    const MAT = P.mat ? M[P.mat] : M.coat;
    const sa = Math.sin(P.az), ca = Math.cos(P.az);
    const R0 = 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + P.out * 0.5;
    const anchor = joint(pelvis, sa * R0, DIM.coatY + 0.02, ca * R0);
    anchor.rotation.y = P.az;
    const s0 = joint(anchor);
    const sk = P.skew ?? 0, w0 = P.w[0];
    const nF = 1.5, fph = i * 2.3 + 0.4; // (few, soft folds: the anchor's cloth hangs plain; a fold every 8 cm drew a grass skirt)
    const [L0, L1] = P.len;
    const wAt = (d) => (d < L0 ? lerp(P.w[0], P.w[1], d / L0) : lerp(P.w[1], P.w[2], Math.min(1, (d - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const d = d0 - gy, w = wAt(d);
      const s = (u - sheetOffset(w, w0, sk)) / w + 0.5;
      return 0.5 + 0.6 * Math.sin(Math.PI * 2 * nF * (s + 0.08 * Math.sin(d * 6 + i * 1.3)) + fph + Math.PI) - 0.9 * Math.max(0, 1 - d / 0.1);
    };
    const tear = P.inner ? B.tear * 0.3 : B.tear;
    const g0 = foldLines(skirtSheet(L0, P.w[0], P.w[1], R0, 0.25, 0, 51 + i, [0.004, 0.014, nF, fph], 0, 1, sk, w0), pleat(0));
    mesh(s0, g0, MAT);
    if (!P.inner) mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = R0 + 0.25 * L0;
    const g1 = foldLines(tornSheet(tear, 3500 + i * 31, L1, P.w[1], P.w[2], R1, 0.25, 0, 71 + i, [0.014, 0.03, nF, fph], 0, 1, sk, w0), pleat(L0));
    mesh(s1, g1, MAT);
    if (!P.inner) mesh(s1, g1, M.lining);
    if (!P.inner && B.over) {
      // the over-layer, torn off at mid-thigh: the lower part of the upper sheet again, a hair proud of it
      const ov = tornSheet(B.over, 3100 + i * 31, L0, P.w[0] * 1.02, P.w[1] * 1.06, R0 + 0.012, 0.25, 0, 61 + i, [0.006, 0.016, nF, fph], 0.6, 1, sk, w0 * 1.02).translate(0, 0, 0.012);
      mesh(s0, foldLines(ov, pleat(0)), M.coat);
    }
    coat.push({ anchor, segs: [s0, s1], def: P, strips: [], len: [L0, L1 + tear * 0.8], r0: R0, inner: !!P.inner });
  });
  return { coat };
}
