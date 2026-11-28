import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import { buildFreeHand } from '../../player/gear/hands.js';
import {
  shellGeometry, skirtSheet, tatterStrip, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, ribbonCrease, lerp, limb,
  gripFist, arcPlate, strapGeometry, orient,
} from '../../player/heroGeo.js';
import { dressOf, at } from './look.js';

// HALCYON AFTER THE REFERENCE PACK (ADR-289, `?halRef=a`): his body rebuilt after the anchor
// (docs/art/character-packs-v04/halcyon/00-original-anchor.png and the turnaround 01): an adult man of a
// realistic build in a navy armoured suit: a V from broad shoulders to a narrow waist; sculpted plates
// over the chest, the abdomen, the shoulders, the forearms, the thighs, the knees and the shins, each edged
// in a thin line of gold; a high collar; the gold belt and its square buckle; gold cuffs; navy boots with
// gold toe caps and heels; bare hands; blond hair swept back with volume, a square jaw; and the cape: a
// heavy crimson mantle over both shoulders, pinned by square gold clasps at the collarbones, falling in
// a few deep folds to his heels. Each builder takes the gear.js item's context (model.js buildHero: the
// skeleton's joints, his materials `M`, `mesh`, `joint`) and returns what the item returns. Gold is
// `M.hair` (the part whose ink lines print gold: gear.js goldOf), the blond `M.hairTip`, the suit
// `M.pants`, the plates `M.armor`, the boots `M.collar`, the cape `M.coat` / `M.lining`.
// More objects than the shipped outfit: only under the switch (the default rig, and with it every seeded
// fight, is untouched).

/** The head drawn smaller than the rig's (its meshes only). */
const HEAD_K = 0.86;
/** Slimmer limbs than the rig's athletic build (the sheets' long, lean man): radius multipliers. */
const SLIM = { arm: 0.8, leg: 0.84 };

const ySp = (h) => h - 1.035; // world idle height → spine space
const yPv = (h) => h - 0.955; // → pelvis space
const yCh = (h) => h - 1.225; // → chest space

/** The suit's torso (world heights): broad at the chest, a narrow waist, the hips. */
const TORSO = [
  { y: 1.08, rx: 0.142, rz: 0.104 },
  { y: 1.16, rx: 0.124, rz: 0.094 },
  { y: 1.24, rx: 0.134, rz: 0.1, cz: 0.006 },
  { y: 1.31, rx: 0.165, rz: 0.112, cz: 0.012 },
  { y: 1.38, rx: 0.19, rz: 0.122, cz: 0.016 },
  { y: 1.44, rx: 0.198, rz: 0.116, cz: 0.01 },
  { y: 1.48, rx: 0.166, rz: 0.1, cz: 0.003 },
  { y: 1.51, rx: 0.088, rz: 0.072 },
  { y: 1.53, rx: 0.058, rz: 0.055 },
];
const torsoAt = (y) => {
  for (let i = 0; i < TORSO.length - 1; i++) {
    const A = TORSO[i], B = TORSO[i + 1];
    if (y >= A.y && y <= B.y) {
      const u = (y - A.y) / (B.y - A.y);
      return { rx: lerp(A.rx, B.rx, u), rz: lerp(A.rz, B.rz, u), cz: lerp(A.cz ?? 0, B.cz ?? 0, u) };
    }
  }
  return TORSO[y < TORSO[0].y ? 0 : TORSO.length - 1];
};
/** A point on the torso's front surface at height y, angle a (0 = front, + = his left), `out` m proud. */
const onTorso = (y, a, out = 0) => {
  const r = torsoAt(y);
  return [Math.sin(a) * (r.rx + out), ySp(y), Math.cos(a) * (r.rz + out) + (r.cz ?? 0)];
};
/** A gold edge: thin straps through the points (spine space), merged. */
const edge = (pts, w = 0.009, th = 0.006, side = [0, 0, 1]) => {
  const g = [];
  for (let i = 0; i < pts.length - 1; i++) g.push(strapGeometry(pts[i], pts[i + 1], w, th, side));
  return mergeGeometries(g);
};

// ================================================================= the head: a square jaw, the swept blond hair
function buildHead(ctx) {
  const { head, M, mesh, joint } = ctx;
  // a smaller head (the sheets: about 8 heads tall, the shared rig 7.3): the skull, the jaw, the neck the
  // rig drew move under a joint scaled HEAD_K (drawn only: the beams' eye point is the head joint's own)
  const hs = joint(head);
  hs.scale.setScalar(HEAD_K);
  for (const c of head.children.filter((c) => c.isMesh)) hs.add(c);
  const hair = M.hairTip;
  // a square jaw over the rig's narrow one
  const jaw = ellipsoidGeometry(0.056, 0.038, 0.058, { widthSegs: 12, heightSegs: 6 });
  const jp = jaw.attributes.position;
  for (let i = 0; i < jp.count; i++) {
    const y = jp.getY(i), z = jp.getZ(i);
    if (y < 0) jp.setY(i, y * 0.7);
    if (z > 0) jp.setX(i, jp.getX(i) * (1 - 0.15 * (z / 0.058)));
  }
  jaw.computeVertexNormals();
  mesh(hs, jaw, M.skin, 0, 0.08, 0.026);
  // the hair: a cap over the crown and the back of the skull only (the face stays clear below the
  // brow), its front lifted a little and swept straight back, short at the nape
  const SC = [0, 0.15, -0.004], SR = [0.088, 0.1, 0.108];
  const cap = ellipsoidGeometry(SR[0], SR[1], SR[2], { widthSegs: 20, heightSegs: 12 });
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const zf = z / SR[2]; // 1 the brow, -1 the nape
    const cut = 0.03 * zf - 0.025 - 0.035 * Math.max(0, -zf); // the hairline: high at the brow, low at the nape
    const side = Math.abs(x) / SR[0];
    const cutS = cut + 0.018 * side * Math.max(0, zf + 0.3); // the temples clear, over the ears
    if (y < cutS) {
      y = cutS;
      x *= 0.97;
      z *= 0.97;
    }
    // the volume swept back: lifted at the front of the crown
    if (y > 0) y += 0.04 * Math.max(0, zf + 0.1) * (y / SR[1]);
    if (zf > 0.5 && y > -0.02) z += 0.012 * (zf - 0.5);
    cp.setXYZ(i, x, y, z);
  }
  cap.computeVertexNormals();
  // the strands combed straight back: lines from the brow over the crown
  mesh(hs, foldLines(cap.translate(...SC), (x, y, z) => 0.5 + 0.65 * Math.sin(x * 95 + z * 8)), hair);
  // the eyes: a red glint that kindles to the beams' fire (the `flask` part glows; look.js)
  const eyes = mergeGeometries([0.03, -0.03].map((ex) => ellipsoidGeometry(0.008, 0.004, 0.004, { widthSegs: 8, heightSegs: 4 }).translate(ex, 0.128, 0.1)));
  const e = mesh(hs, eyes, M.flask);
  return { keep: [e] };
}

// ================================================================= the torso: the suit, the plates, the gold edges, the collar
function buildChest(ctx) {
  const { spine, chest, M, mesh } = ctx;
  const gold = M.hair;
  mesh(spine, shellGeometry(TORSO.map((r) => ({ ...r, rx: r.rx + 0.004, rz: r.rz + 0.004, y: ySp(r.y) })), { sub: 3, cols: 30 }), M.pants);
  // the pectoral plates: two sculpted shells over the chest, a valley between
  const pecs = [];
  for (const s of [-1, 1]) {
    const g = ellipsoidGeometry(0.11, 0.065, 0.007, { widthSegs: 12, heightSegs: 8 });
    const gp = g.attributes.position;
    for (let k = 0; k < gp.count; k++) if (gp.getY(k) < -0.02) gp.setY(k, -0.02 + (gp.getY(k) + 0.02) * 0.35); // squared lower edge
    g.computeVertexNormals();
    g.rotateY(s * 0.38);
    g.rotateZ(s * 0.1);
    const p = onTorso(1.385, s * 0.4, -0.004);
    pecs.push(sub(g.translate(p[0], p[1], p[2]), s > 0 ? 1 : 0));
  }
  mesh(spine, mergeGeometries(pecs), M.armor);
  // the abdomen: six plates in two columns, the serratus plates at the sides
  const abs = [];
  for (let r = 0; r < 3; r++) for (const s of [-1, 1]) {
    const y = 1.285 - r * 0.052, p = onTorso(y, s * 0.19, 0.004);
    abs.push(sub(boxGeometry(0.05, 0.04, 0.014, p[0], p[1], p[2] - 0.006, -0.05, s * 0.18, 0), (r + (s > 0 ? 1 : 0)) & 1));
  }
  for (const s of [-1, 1]) for (let r = 0; r < 3; r++) {
    const y = 1.33 - r * 0.045, p = onTorso(y, s * 0.95, 0.002);
    abs.push(sub(boxGeometry(0.03, 0.03, 0.016, p[0], p[1], p[2], 0, s * 0.95, s * 0.35), r & 1));
  }
  mesh(spine, mergeGeometries(abs), M.armor);
  // the gold edges: under each pectoral, down the sternum, round the abdomen's plates, the flanks, and the
  // strap from the right shoulder's clasp across the chest to the left ribs
  const lines = [];
  for (const s of [-1, 1]) {
    const arc = [];
    for (let k = 0; k <= 6; k++) arc.push(onTorso(1.33 + 0.012 * Math.sin((k / 6) * Math.PI), s * lerp(0.06, 0.95, k / 6), 0.02));
    lines.push(edge(arc));
    const flank = [];
    for (let k = 0; k <= 5; k++) flank.push(onTorso(lerp(1.42, 1.12, k / 5), s * lerp(1.05, 0.62, k / 5), 0.008));
    lines.push(edge(flank));
    const absSide = [];
    for (let k = 0; k <= 4; k++) absSide.push(onTorso(lerp(1.31, 1.13, k / 4), s * 0.36, 0.014));
    lines.push(edge(absSide, 0.007));
  }
  mesh(spine, mergeGeometries(lines), M.armor);
  lines.length = 0;
  const strap = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    strap.push(onTorso(lerp(1.47, 1.19, t), lerp(-0.72, 0.95, t), 0.03 + 0.02 * Math.sin(Math.PI * t)));
  }
  lines.push(edge(strap, 0.02, 0.008));
  mesh(spine, mergeGeometries(lines), gold);
  // the high collar: a navy stand collar edged in gold
  mesh(chest, sub(bandGeometry(0.07, 0.064, 0.07, 22).translate(0, yCh(1.545), 0.0), 1), M.armor);
  mesh(chest, bandGeometry(0.073, 0.067, 0.012, 22).translate(0, yCh(1.578), 0.0), gold);
  // the clasps where the cape pins: square gold plates set as diamonds at the collarbones
  const clasps = [];
  for (const s of [-1, 1]) {
    clasps.push(sub(boxGeometry(0.06, 0.06, 0.016, s * 0.13, yCh(1.475), 0.1, -0.25, s * 0.35, Math.PI / 4), s > 0 ? 1 : 0));
    clasps.push(sub(boxGeometry(0.034, 0.034, 0.02, s * 0.13, yCh(1.475), 0.108, -0.25, s * 0.35, Math.PI / 4), 1));
  }
  mesh(chest, mergeGeometries(clasps), gold);
  return { keep: [] };
}

// ================================================================= the arms: pauldrons, plates, gauntlets, cuffs, bare hands
function buildArms(ctx) {
  const { arms, sword, M, DIM, BODY, mesh } = ctx;
  const gold = M.hair;
  const [ua0, ua1] = BODY.upperArm.map((r) => r * SLIM.arm), [fa0, fa1] = BODY.foreArm.map((r) => r * SLIM.arm), HK = BODY.hand * 0.9;
  const DL = BODY.deltoid.map((r) => r * 0.85);
  for (const side of [-1, 1]) {
    const { upper, fore } = arms[side < 0 ? 'R' : 'L'];
    // the sleeve and a smaller, muscular shoulder (the anchor's shoulders are a man's, not two balls)
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.002, r1: ua1, bulge: 0.018 }), 1),
      sub(ellipsoidGeometry(DL[0], DL[1], DL[2], { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.03, 0), 1),
    ]), M.pants);
    // the pauldron: a plate capping the shoulder, in two lames, each edged in gold
    const lames = [], lameEdge = [];
    for (let k = 0; k < 2; k++) {
      const y0 = 0.025 - k * 0.05, y1 = y0 - 0.06, r = DL[0] + 0.012 - k * 0.006;
      lames.push(sub(arcPlate(y0, y1, r - 0.025, r, side * Math.PI / 2, 1.25, 10), k));
      lameEdge.push(bandGeometry(r + 0.002, r * 0.95, 0.008, 18).translate(0, y1 + 0.004, 0));
    }
    mesh(upper, mergeGeometries(lames), M.armor);
    mesh(upper, mergeGeometries(lameEdge), gold);
    // the bicep plate
    mesh(upper, sub(arcPlate(-0.09, -0.22, ua0 + 0.012, ua1 + 0.012, 0, 0.9, 8), 0), M.armor);
    // the forearm: the gauntlet plate, its gold edges, the gold cuff at the wrist
    mesh(fore, mergeGeometries([
      sub(limb({ length: 0.09, r0: ua1 + 0.004, r1: ua1 }), 1),
      sub(limb({ length: 0.2, r0: fa0 + 0.006, r1: fa1 + 0.002, radial: 10, rings: 3, bulge: 0.008 }).translate(0, -0.05, 0), 1),
    ]), M.pants);
    mesh(fore, sub(limb({ length: 0.15, r0: fa0 + 0.01, r1: fa1 + 0.008, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.07, 0), 0), M.armor);
    const y1 = -DIM.foreArm + 0.04;
    mesh(fore, mergeGeometries([
      bandGeometry(fa0 + 0.013, fa0 + 0.013, 0.008, 14).translate(0, -0.075, 0),
      bandGeometry(fa1 + 0.012, fa1 + 0.012, 0.03, 14).translate(0, y1 + 0.03, 0),
      boxGeometry(0.006, 0.13, 0.006, 0, -0.15, fa0 + 0.014),
    ]), gold);
  }
  // bare hands: the right fist on the sword joint, the left free
  const F = gripFist(HK);
  mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.skin);
  mesh(arms.R.fore, ellipsoidGeometry(0.036 * HK, 0.04 * HK, 0.04 * HK, { widthSegs: 10, heightSegs: 6 }), M.skin, 0, -DIM.foreArm + 0.02, 0.004);
  const free = buildFreeHand(ctx, M.skin);
  return { offHand: free.offHand, keep: [...free.keep] };
}

// ================================================================= the legs: thigh plates, knee plates, greaves, gold-capped boots
function buildLegs(ctx) {
  const { pelvis, legs, M, DIM, BODY, mesh } = ctx;
  const gold = M.hair;
  const [hx, hy, hz] = BODY.hips.r;
  mesh(pelvis, orient.up(ellipsoidGeometry(hx * 0.9, hz * 0.92, hy + 0.01)), M.pants, ...BODY.hips.c);
  const [th0, th1] = BODY.thigh.map((r) => r * SLIM.leg), [sh0, sh1] = BODY.shin.map((r) => r * SLIM.leg), Fo = BODY.foot;
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0 + 0.004, r1: th1 + 0.004, bulge: 0.016 }), M.pants);
    // the thigh plates: the front and the outside, each edged in gold
    const plates = [
      sub(arcPlate(-0.06, -0.36, th0 + 0.016, th1 + 0.014, 0, 0.75, 8), 0),
      sub(arcPlate(-0.08, -0.32, th0 + 0.014, th1 + 0.012, side * 1.35, 0.5, 6), 1),
    ];
    mesh(thigh, mergeGeometries(plates), M.armor);
    const tl = [];
    for (const a of [-0.75, 0.75, side * 1.35 + 0.5 * side]) {
      tl.push(strapGeometry([Math.sin(a) * (th0 + 0.02), -0.07, Math.cos(a) * (th0 + 0.02)], [Math.sin(a) * (th1 + 0.018), -0.35, Math.cos(a) * (th1 + 0.018)], 0.008, 0.005, [Math.cos(a), 0, -Math.sin(a)]));
    }
    mesh(thigh, mergeGeometries(tl), M.armor);
    // the knee plate: a kite over the joint
    mesh(shin, sub(arcPlate(0.04, -0.05, th1 + 0.006, th1 + 0.01, 0, 0.7, 6), 1), M.armor);
    // the boot to below the knee: the greave plate in front, gold edges, the gold top band
    const bootTop = -0.1;
    const shaft = DIM.shin + bootTop - 0.01;
    const t = lerp(sh0, sh1, Math.min(1, -bootTop / DIM.shin));
    mesh(shin, limb({ length: -bootTop + 0.02, r0: th1 + 0.004, r1: sh0 + 0.004, bulge: 0.01 }), M.pants);
    mesh(shin, sub(limb({ length: shaft, r0: t + 0.008, r1: sh1 + 0.01, radial: 12, rings: 3, capSegs: 1 }).translate(0, bootTop, 0), 0), M.collar);
    mesh(shin, sub(arcPlate(bootTop - 0.02, bootTop - shaft + 0.04, t + 0.02, sh1 + 0.018, 0, 0.8, 8), 1), M.armor);
    const gl = [bandGeometry(t + 0.022, t + 0.022, 0.01, 16).translate(0, bootTop - 0.005, 0)];
    for (const a of [-0.8, 0.8]) gl.push(strapGeometry([Math.sin(a) * (t + 0.032), bootTop - 0.02, Math.cos(a) * (t + 0.032)], [Math.sin(a) * (sh1 + 0.026), bootTop - shaft + 0.05, Math.cos(a) * (sh1 + 0.026)], 0.008, 0.005, [Math.cos(a), 0, -Math.sin(a)]));
    gl.push(strapGeometry([Math.sin(-0.8) * (t + 0.032), bootTop - shaft * 0.45, Math.cos(-0.8) * (t + 0.032)], [Math.sin(0.8) * (t + 0.032), bootTop - shaft * 0.45 - 0.05, Math.cos(0.8) * (t + 0.032)], 0.008, 0.005, [0, 1, 0]));
    mesh(shin, mergeGeometries(gl), gold);
    // the foot: navy, a gold toe cap and a gold heel
    mesh(foot, ellipsoidGeometry(Fo.r[0], Fo.r[1] * 0.95, Fo.r[2], { widthSegs: 10, heightSegs: 6 }).translate(Fo.c[0], Fo.c[1] - 0.002, Fo.c[2] + 0.004), M.collar);
    mesh(foot, mergeGeometries([
      ellipsoidGeometry(Fo.r[0] * 0.8, Fo.r[1] * 0.6, Fo.r[2] * 0.26, { widthSegs: 10, heightSegs: 6 }).translate(Fo.c[0], Fo.c[1] - 0.012, Fo.c[2] + Fo.r[2] * 0.8),
      boxGeometry(Fo.r[0] * 1.3, 0.03, 0.03, Fo.c[0], Fo.c[1] - 0.025, Fo.c[2] - Fo.r[2] * 0.86),
    ]), gold);
  }
  return {};
}

// ================================================================= the waist: the gold belt, the square buckle
function buildWaist(ctx) {
  const { pelvis, M, mesh } = ctx;
  const W = TORSO[0];
  mesh(pelvis, sub(bandGeometry(W.rx + 0.024, W.rz + 0.024, 0.075, 28).translate(0, yPv(1.08), 0.002), 0), M.hair);
  mesh(pelvis, mergeGeometries([
    sub(boxGeometry(0.075, 0.065, 0.016, 0, yPv(1.08), W.rz + 0.034), 1),
    sub(boxGeometry(0.04, 0.034, 0.02, 0, yPv(1.08), W.rz + 0.04, 0, 0, Math.PI / 4), 0),
  ]), M.hair);
  return {};
}

// ================================================================= the cape: a mantle over the shoulders, a heavy fall to the heels
/** Its sheets on the chest joint: the back three wide and overlapping, the outer two from the clasps over
 *  the shoulders' fronts; long (to the heels: ~1.3 m), hanging close (little flare), few deep folds. */
export const REF_CAPE = {
  lag: 0.8, max: 1.2, breeze: [0.1, 1.4],
  sheets: [
    { at: [0, 0.22, -0.15], ry: Math.PI, w: [0.3, 0.5, 0.74], len: [0.62, 0.72], out: 0.1, wrap: 0.36, seed: 5 },
    { at: [0.15, 0.225, -0.13], ry: Math.PI - 0.42, w: [0.24, 0.44, 0.62], len: [0.62, 0.7], out: 0.12, wrap: 0.32, seed: 19 },
    { at: [-0.15, 0.225, -0.13], ry: Math.PI + 0.42, w: [0.24, 0.44, 0.62], len: [0.62, 0.7], out: 0.12, wrap: 0.32, seed: 31 },
    { at: [0.24, 0.24, -0.01], ry: Math.PI - 1.3, w: [0.16, 0.36, 0.62], len: [0.6, 0.68], out: 0.24, wrap: 0.26, seed: 43 },
    { at: [-0.24, 0.24, -0.01], ry: Math.PI + 1.3, w: [0.16, 0.36, 0.62], len: [0.6, 0.68], out: 0.24, wrap: 0.26, seed: 59 },
  ],
};
const TORN = new Set([0, 3, 4]);

function buildCape(ctx) {
  const { chest, M, mesh, joint, root } = ctx;
  const D = dressOf(root);
  const streamers = [], keep = [];
  // the mantle: heavy cloth over the shoulders and the upper back, from clasp to clasp (it rides the chest)
  const mantle = [
    { y: yCh(1.56), rx: 0.11, rz: 0.09 },
    { y: yCh(1.52), rx: 0.2, rz: 0.13 },
    { y: yCh(1.47), rx: 0.27, rz: 0.15, cz: -0.01 },
    { y: yCh(1.4), rx: 0.29, rz: 0.16, cz: -0.02 },
  ];
  const mg = sub(shellGeometry(mantle, { sub: 3, cols: 26, arc: [0.75, Math.PI * 2 - 0.75] }), 0);
  mesh(chest, mg, M.coat);
  mesh(chest, mg, M.lining);
  REF_CAPE.sheets.forEach((d, i) => {
    const base = joint(chest, ...d.at);
    base.rotation.y = d.ry;
    const [w0, w1, w2] = d.w, [L0, L1] = d.len;
    // few, deep folds: the heavy cloth of the sheets (one wave per ~0.24 m)
    const nF = Math.max(1, Math.round(w2 / 0.24)) + 0.5, ph = i * 1.9 + 0.4;
    const s0 = joint(base);
    const g0 = sub(skirtSheet(L0, w0, w1, d.wrap, 0.12, 0, d.seed, [0.015, 0.045, nF, ph]), 0);
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = d.wrap + 0.12 * L0, fold = [0.045, 0.08, nF, ph];
    const g1 = sub(skirtSheet(L1, w1, w2, R1, 0.12, 0.02, d.seed + 7, fold, 0, 0.7), 0);
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = sub(skirtSheet(L1, w1, w2, R1, 0.12, 0.03, d.seed + 7, fold, 0.7, 1), 0);
    const h0 = mesh(s1, g2, M.coat), h1 = mesh(s1, g2, M.lining);
    if (TORN.has(i)) {
      // phase 3: the lower edge torn away, three tatters in its place
      for (const m of [h0, h1]) {
        at(D, m, 1, 2);
        keep.push(m);
      }
      for (let k = 0; k < 3; k++) {
        const x = (k - 1) * w1 * 0.3;
        const t = mesh(s1, foldLines(tatterStrip(L1 * (0.4 + 0.12 * k), w1 * 0.24, { fork: true, curl: 0.15, seed: d.seed + k }), ribbonCrease(w1 * 0.24, k)).translate(x, -L1 * 0.6, R1 * 0.02), M.coat);
        at(D, t, 3, 3);
        keep.push(t);
      }
    }
    const S = { segs: [s0, s1], len: d.len, out: d.out, lag: REF_CAPE.lag, max: REF_CAPE.max, w: d.w, arm: 0, breeze: REF_CAPE.breeze };
    streamers.push(S);
  });
  return { streamers, keep };
}

/** The reference body's builders, by gear.js item. */
export const REF_BUILD = Object.freeze({ head: buildHead, chest: buildChest, arms: buildArms, legs: buildLegs, waist: buildWaist, back: buildCape });
