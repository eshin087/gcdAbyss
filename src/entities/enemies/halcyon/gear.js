import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import { registerItem } from '../../player/gear/index.js';
import { buildFreeHand } from '../../player/gear/hands.js';
import {
  shellGeometry, skirtSheet, tatterStrip, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, ribbonCrease, lerp, limb,
  gripFist, orient, orientTo, clumpGeometry, partGeometry,
} from '../../player/heroGeo.js';
import { halLookNow, halCapeNow, halCapeSizeNow, halRefOn, dressOf, at } from './look.js';
import { REF_BUILD } from './refGear.js';

// Halcyon's gear: the hero's skeleton (buildHero), no weapon (bare-handed: the right fist on the sword
// joint), drawn in the hero's ink-line art. Three outfits (`?halLook=a|b|c`, look.js; read when his rig
// is built); `?halRef=a` builds every slot from refGear.js instead (ADR-289). No letter, shield or symbol anywhere on him (ADR-160, the line on the homage): what reads is
// the colour and the shape: the suit, the cape, the belt, the eyes.
//
// His material instances (look.js tintHalcyon writes the colours): `pants` = the suit (torso, arms,
// legs), `armor` = the plates over it (the chest, the forearms, the shins; b's shoulder pieces), `piping`
// = the neon seams along the plates, `trim` = the gold (the belt, the cuffs, the boot tops, the clasps;
// `hair` from ?halCape=1 on, goldOf),
// `collar` = the boots, `coat` / `lining` / `hem` = the cape outside / inside / its lower edge, `shirt` =
// his slick hair, `welt` = the gloves (b white), `skin` = the face, `flask` = his eyes' light.
// The cape: five long sheets on the streamer springs (the Starless Lord's cape is the model), the
// biggest shape on him in flight; from phase 3 three of its sheets lose their lower edge and tatters
// hang there instead (look.js dressHalcyon, `at`).

/** The gold (the belt, the clasps, the cuffs, the boot tops): from ?halCape=1 on, a and b draw it in
 *  the `hair` part, whose ink lines are gold (the `trim` part's are white: at game size its few cells
 *  printed cream); c's chrome stays `trim`. */
const goldOf = (M) => (halCapeNow() >= 1 && halLookNow() !== 'c' ? M.hair : M.trim);
/** ... and from ?halCape=1 on it is drawn bigger: at ~40 px tall a 5 cm belt was under one letter. */
const goldK = () => (halCapeNow() >= 1 ? 1 : 0);

const ySp = (h) => h - 1.035; // world idle height → spine space
const yPv = (h) => h - 0.955; // → pelvis space
const yCh = (h) => h - 1.225; // → chest space

/** The torso shell's rings (the body's; world heights), grown by `d`. */
const SHELL = [
  { y: 1.09, rx: 0.15, rz: 0.112 },
  { y: 1.21, rx: 0.134, rz: 0.1 },
  { y: 1.3, rx: 0.158, rz: 0.11, cz: 0.008 },
  { y: 1.37, rx: 0.188, rz: 0.124, cz: 0.014 },
  { y: 1.43, rx: 0.2, rz: 0.12, cz: 0.01 },
  { y: 1.475, rx: 0.172, rz: 0.104, cz: 0.003 },
  { y: 1.505, rx: 0.092, rz: 0.074 },
  { y: 1.525, rx: 0.056, rz: 0.054 },
];
const grown = (d, f = null) => SHELL.map((r) => ({ ...r, rx: r.rx + d, rz: r.rz + d, gap: 0, ...(f ? f(r) : null), y: ySp(r.y) }));

// ================================================================= the head: slick hair, the eyes' light
const SC = [0, 0.154, -0.007], SR = [0.105, 0.118, 0.112];
const scalp = (az, el, k = 0.95) => [SC[0] + Math.sin(az) * Math.cos(el) * SR[0] * k, SC[1] + Math.sin(el) * SR[1] * k, SC[2] + Math.cos(az) * Math.cos(el) * SR[2] * k];
const nrm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const BACK = [0, 0, -1];

function buildHead(ctx) {
  const { head, M, mesh } = ctx;
  const look = halLookNow();
  // the scalp, and the hair combed straight back over it: flat locks from the brow to the crown (a
  // little quiff at the front for b, swept higher for c)
  mesh(head, partGeometry('hair.cap'), M.shirt);
  const locks = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const az = (i / (n - 1) - 0.5) * 1.9, el = 0.55 + 0.25 * Math.cos(az);
    const a = scalp(az, el, 0.98);
    const dir = nrm([Math.sin(az) * 0.25, look === 'b' ? 0.35 : 0.2, -1]);
    const L = 0.16 + 0.05 * Math.cos(az) + (look === 'c' ? 0.03 : 0);
    const g = clumpGeometry(L, 0.05, 0.016, { curl: 0.06, taper: 0.9, cols: 6, rows: 2 });
    locks.push(sub(orientTo(g, a, dir, nrm([0, -0.6, -1])), i & 1));
  }
  // the sides combed back flat over the ears
  for (const s of [-1, 1]) {
    const g = clumpGeometry(0.15, 0.05, 0.014, { curl: 0.04, taper: 0.8, cols: 6, rows: 2 });
    locks.push(sub(orientTo(g, scalp(s * 1.25, 0.25, 0.98), nrm([s * 0.1, 0.05, -1]), BACK), 1));
  }
  if (look === 'b') {
    // the idol's quiff: a lifted wave at the front
    const g = clumpGeometry(0.1, 0.09, 0.02, { curl: 0.3, taper: 1.1, cols: 6, rows: 2 });
    locks.push(sub(orientTo(g, scalp(0.15, 0.75, 1.0), nrm([0, 0.8, -0.4]), BACK), 0));
  }
  mesh(head, mergeGeometries(locks), M.shirt);
  // the eyes: two points of red light over his own (the `flask` part glows; look.js dressHalcyon)
  const eyes = mergeGeometries([0.032, -0.032].map((ex) => ellipsoidGeometry(0.017, 0.009, 0.006, { widthSegs: 8, heightSegs: 4 }).translate(ex, 0.128, 0.1)));
  const e = mesh(head, eyes, M.flask);
  return { keep: [e] };
}

// ================================================================= the torso: the suit, the plate, the seams, the clasps
function buildChest(ctx) {
  const { spine, chest, M, mesh } = ctx;
  const look = halLookNow();
  // the suit over the whole torso
  mesh(spine, shellGeometry(grown(0.004), { sub: 3, cols: 28 }), M.pants);
  // the plate: a sculpted breastplate (the chest and the ribs), the shoulder line cut in; plain: no sign on it
  const plate = grown(0.022, (r) => (r.y >= 1.42 && r.y < 1.5 ? { rx: r.rx - 0.035 } : null)).filter((r) => r.y >= ySp(1.24) && r.y <= ySp(1.48));
  mesh(spine, foldLines(shellGeometry(plate, { sub: 3, cols: 28 }), (x, y, z) => (z > 0 ? 0.5 + 7 * Math.abs(x) - 0.75 + 4 * Math.abs(y - ySp(1.36)) : 0.5)), M.armor);
  // the abdomen's plates: three bands
  for (let k = 0; k < 3; k++) {
    const W = SHELL[1], y = 1.12 + k * 0.045;
    mesh(spine, sub(bandGeometry(W.rx + 0.016 - k * 0.002, W.rz + 0.016, 0.03, 24).translate(0, ySp(y), 0.004), k & 1), M.armor);
  }
  // the neon seams: down the plate's edges and under the pectorals (thin bright strips)
  const seams = [];
  for (const s of [-1, 1]) {
    seams.push(boxGeometry(0.007, 0.2, 0.006, s * 0.13, ySp(1.34), 0.138, 0.15, 0, s * 0.12));
    seams.push(boxGeometry(0.11, 0.006, 0.006, s * 0.07, ySp(1.285), 0.128, 0, s * 0.25, 0));
    seams.push(boxGeometry(0.006, 0.16, 0.006, s * 0.19, ySp(1.3), 0.03, 0, 0, 0));
  }
  mesh(spine, mergeGeometries(seams.map((g, i) => sub(g, i & 1))), M.piping);
  // the collar: a high armoured neck ring
  mesh(chest, sub(bandGeometry(0.068, 0.062, 0.05, 20).translate(0, yCh(1.53), -0.004), 1), M.armor);
  // the clasps where the cape pins: a plain gold disc at each shoulder's front (b: the idol's shoulder pieces)
  const clasps = [];
  const cr = 0.032 + 0.012 * goldK();
  for (const s of [-1, 1]) clasps.push(sub(ellipsoidGeometry(cr, cr, 0.012, { widthSegs: 10, heightSegs: 5 }).rotateX(Math.PI / 2).translate(s * 0.14, yCh(1.47), 0.1), s > 0 ? 1 : 0));
  mesh(chest, mergeGeometries(clasps), goldOf(M));
  if (look === 'b') {
    // gold shoulder pieces of his own shape: a swept plate over each shoulder, three stepped edges
    for (const s of [-1, 1]) {
      const parts = [];
      for (let k = 0; k < 3; k++) parts.push(sub(boxGeometry(0.13 - k * 0.02, 0.016, 0.16 - k * 0.025, s * (0.17 + k * 0.016), yCh(1.5) - k * 0.03, -0.005, 0, 0, s * (-0.35 - k * 0.12)), k & 1));
      mesh(chest, mergeGeometries(parts), goldOf(M));
    }
  }
  return { keep: [] };
}

// ================================================================= the arms: sleeves, forearm plates, cuffs, gloves
function buildArms(ctx) {
  const { arms, sword, M, DIM, BODY, mesh } = ctx;
  const look = halLookNow();
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  const glove = look === 'b' ? M.welt : M.pants;
  for (const side of [-1, 1]) {
    const { upper, fore } = arms[side < 0 ? 'R' : 'L'];
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.004, r1: ua1 + 0.004, bulge: 0.016 }), 1),
      sub(ellipsoidGeometry(BODY.deltoid[0] + 0.008, BODY.deltoid[1] + 0.004, BODY.deltoid[2] + 0.008, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.01, -0.02, 0), 1),
    ]), M.pants);
    // a plate over the shoulder (the suit's armour)
    mesh(upper, sub(ellipsoidGeometry(BODY.deltoid[0] + 0.02, BODY.deltoid[1] + 0.006, BODY.deltoid[2] + 0.02, { widthSegs: 12, heightSegs: 6 }).translate(side * 0.014, -0.012, 0), 0), M.armor);
    mesh(fore, mergeGeometries([
      sub(limb({ length: 0.09, r0: ua1 + 0.004, r1: ua1 }), 1),
      sub(limb({ length: 0.2, r0: fa0 + 0.006, r1: fa1 + 0.002, radial: 10, rings: 3, bulge: 0.006 }).translate(0, -0.05, 0), 1),
    ]), M.pants);
    // the forearm plate and its seam
    mesh(fore, sub(limb({ length: 0.14, r0: fa0 + 0.016, r1: fa1 + 0.012, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.08, 0), 0), M.armor);
    mesh(fore, boxGeometry(0.006, 0.13, 0.006, 0, -0.15, fa0 + 0.02), M.piping);
    // the gold cuff at the wrist
    const y1 = -DIM.foreArm + 0.04;
    const cl = 0.045 + 0.03 * goldK();
    mesh(fore, limb({ length: cl, r0: fa1 + 0.018, r1: fa1 + 0.014, radial: 12, rings: 1, capSegs: 1 }).translate(0, y1 + cl, 0), goldOf(M));
  }
  // the right fist on the sword joint, the left hand free
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), glove);
    mesh(arms.R.fore, ellipsoidGeometry(0.036 * HK, 0.04 * HK, 0.04 * HK, { widthSegs: 10, heightSegs: 6 }), glove, 0, -DIM.foreArm + 0.02, 0.004);
  }
  const free = buildFreeHand(ctx, glove);
  return { offHand: free.offHand, keep: [...free.keep] };
}

// ================================================================= the legs: the suit, shin plates, the boots
function buildLegs(ctx) {
  const { pelvis, legs, M, DIM, BODY, mesh } = ctx;
  const [hx, hy, hz] = BODY.hips.r;
  mesh(pelvis, orient.up(ellipsoidGeometry(hx + 0.006, hz + 0.006, hy + 0.012)), M.pants, ...BODY.hips.c);
  const [th0, th1] = BODY.thigh, [sh0, sh1] = BODY.shin, F = BODY.foot;
  const bootTop = -0.13;
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0 + 0.008, r1: th1 + 0.006, bulge: 0.014 }), M.pants);
    mesh(thigh, boxGeometry(0.006, 0.2, 0.006, side * (th0 * 0.7), -0.2, th0 * 0.72), M.piping);
    mesh(shin, limb({ length: -bootTop + 0.02, r0: th1 + 0.006, r1: sh0 + 0.004, bulge: 0.008 }), M.pants);
    // the boot to below the knee, its gold top, the foot
    const shaft = DIM.shin + bootTop - 0.01;
    const t = lerp(sh0, sh1, Math.min(1, -bootTop / DIM.shin));
    mesh(shin, mergeGeometries([
      sub(limb({ length: shaft, r0: t + 0.016, r1: sh1 + 0.014, radial: 12, rings: 3, capSegs: 1 }).translate(0, bootTop, 0), 0),
      sub(limb({ length: 0.1, r0: t + 0.026, r1: t + 0.02, radial: 12, rings: 1, capSegs: 1 }).translate(0, bootTop - 0.02, 0.006), 1),
    ]), M.collar);
    const bl = 0.022 + 0.02 * goldK();
    mesh(shin, limb({ length: bl, r0: t + 0.03, r1: t + 0.028, radial: 12, rings: 1, capSegs: 1 }).translate(0, bootTop + 0.012 + bl - 0.022, 0), goldOf(M));
    mesh(foot, ellipsoidGeometry(F.r[0] * 1.0, F.r[1] * 0.95, F.r[2] * 1.02, { widthSegs: 10, heightSegs: 6 }).translate(F.c[0], F.c[1] - 0.002, F.c[2] + 0.006), M.collar);
  }
  return {};
}

// ================================================================= the waist: the gold belt
function buildWaist(ctx) {
  const { pelvis, M, mesh } = ctx;
  const W = SHELL[0];
  const k = goldK(), bh = 0.05 + 0.035 * k;
  mesh(pelvis, sub(bandGeometry(W.rx + 0.022 + 0.006 * k, W.rz + 0.022 + 0.006 * k, bh, 28).translate(0, yPv(1.075), 0.002), 0), goldOf(M));
  // the buckle: a plain oval, nothing on it
  mesh(pelvis, sub(ellipsoidGeometry(0.04 + 0.015 * k, 0.03 + 0.015 * k, 0.012, { widthSegs: 10, heightSegs: 5 }).rotateX(Math.PI / 2).translate(0, yPv(1.075), W.rz + 0.03 + 0.006 * k), 1), goldOf(M));
  return {};
}

// ================================================================= the back: the cape
/** The cape's five sheets on the chest joint (the Starless Lord's model, longer: the biggest shape on him). */
export const HAL_CAPE = [
  { at: [0, 0.2, -0.155], ry: Math.PI, w: [0.2, 0.36, 0.56], len: [0.62, 0.72], out: 0.22, wrap: 0.3, seed: 5 },
  { at: [0.12, 0.205, -0.14], ry: Math.PI - 0.48, w: [0.18, 0.33, 0.5], len: [0.62, 0.7], out: 0.26, wrap: 0.28, seed: 19 },
  { at: [-0.12, 0.205, -0.14], ry: Math.PI + 0.48, w: [0.18, 0.33, 0.5], len: [0.62, 0.7], out: 0.26, wrap: 0.28, seed: 31 },
  { at: [0.2, 0.2, -0.085], ry: Math.PI - 1.05, w: [0.14, 0.27, 0.42], len: [0.58, 0.64], out: 0.32, wrap: 0.24, seed: 43 },
  { at: [-0.2, 0.2, -0.085], ry: Math.PI + 1.05, w: [0.14, 0.27, 0.42], len: [0.58, 0.64], out: 0.32, wrap: 0.24, seed: 59 },
];
const CAPE_LAG = 0.7, CAPE_MAX = 1.55;
/**
 * ?halCape=2 and 3 (look.js): the cape that frames him. From the front (the boss faces the camera most
 * of the fight) the sheets above hung hidden behind his body, the outer two edge-on; here the three back
 * sheets are wider and the outer two hang off the shoulders' tops, turned only a little, so its red
 * shows past his arms on both sides; longer, and flaring out more (`out`). Step 3 adds the billow
 * (`breeze`: [extra out, its rate] while he hovers, player/anim.js) and a longer trail in a pass (`lag`,
 * `max`). The same five sheets and joints: one more object on his rig would shift every seeded fight.
 */
const CAPE_SHAPE = {
  2: {
    lag: 0.7, max: 1.55, breeze: null,
    sheets: [
      { at: [0, 0.205, -0.15], ry: Math.PI, w: [0.24, 0.48, 0.8], len: [0.64, 0.78], out: 0.2, wrap: 0.32, seed: 5 },
      { at: [0.15, 0.21, -0.13], ry: Math.PI - 0.32, w: [0.2, 0.44, 0.76], len: [0.64, 0.76], out: 0.24, wrap: 0.3, seed: 19 },
      { at: [-0.15, 0.21, -0.13], ry: Math.PI + 0.32, w: [0.2, 0.44, 0.76], len: [0.64, 0.76], out: 0.24, wrap: 0.3, seed: 31 },
      { at: [0.24, 0.215, -0.07], ry: Math.PI - 0.7, w: [0.16, 0.38, 0.66], len: [0.6, 0.72], out: 0.28, wrap: 0.26, seed: 43 },
      { at: [-0.24, 0.215, -0.07], ry: Math.PI + 0.7, w: [0.16, 0.38, 0.66], len: [0.6, 0.72], out: 0.28, wrap: 0.26, seed: 59 },
    ],
  },
};
CAPE_SHAPE[3] = {
  lag: 0.95, max: 1.7, breeze: [0.16, 1.6],
  sheets: CAPE_SHAPE[2].sheets.map((d) => ({ ...d, len: [d.len[0] + 0.04, d.len[1] + 0.08] })),
};
/** The cape his rig is built with (look.js halCapeNow, halCapeSizeNow): { sheets, lag, max, breeze }.
 *  `k` (?halCapeSize=, ADR-166) scales every sheet's length and width (the root's by its square root,
 *  so it still pins across the shoulders); the flare's angle and the billow are kept, so the sheets'
 *  spread from the front shrinks with their length. */
export function capeShape(step = halCapeNow(), k = halCapeSizeNow()) {
  const C = CAPE_SHAPE[step] ?? { sheets: HAL_CAPE, lag: CAPE_LAG, max: CAPE_MAX, breeze: null };
  if (!(k > 0) || k === 1) return C;
  const r = Math.sqrt(k);
  return { ...C, sheets: C.sheets.map((d) => ({ ...d, w: [d.w[0] * r, d.w[1] * k, d.w[2] * k], len: [d.len[0] * k, d.len[1] * k], wrap: d.wrap * r })) };
}
/** The sheets whose lower edge is torn away in phase 3 (tatters hang in its place). */
const TORN = new Set([0, 3, 4]);

function buildCape(ctx) {
  const { chest, M, mesh, joint, root } = ctx;
  const D = dressOf(root);
  const streamers = [], keep = [];
  const C = capeShape();
  C.sheets.forEach((d, i) => {
    const base = joint(chest, ...d.at);
    base.rotation.y = d.ry;
    const [w0, w1, w2] = d.w, [L0, L1] = d.len;
    const nF = Math.max(1, Math.round(w2 / 0.12)) + 0.5, ph = i * 1.9 + 0.4;
    const wAt = (dd) => (dd < L0 ? lerp(w0, w1, dd / L0) : lerp(w1, w2, Math.min(1, (dd - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const dd = d0 - gy, w = wAt(dd);
      const f = Math.PI * 2 * nF * (u / w + 0.5 + 0.05 * Math.sin(dd * 7 + i * 1.7)) + ph + Math.PI;
      return 0.5 + 0.62 * (Math.sin(f) + 0.3 * Math.sin(f * 2.3 + 1.7)) - 0.9 * Math.max(0, 1 - dd / 0.16);
    };
    const s0 = joint(base);
    const g0 = foldLines(skirtSheet(L0, w0, w1, d.wrap, 0.25, 0, d.seed, [0.005, 0.02, nF, ph]), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = d.wrap + 0.25 * L0, fold = [0.02, 0.045, nF, ph];
    const g1 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.02, d.seed + 7, fold, 0, 0.62), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.03, d.seed + 7, fold, 0.62, 1), pleat(L0));
    const h0 = mesh(s1, g2, M.hem), h1 = mesh(s1, g2, M.lining);
    if (TORN.has(i)) {
      // phase 3: the lower edge gone, three tatters in its place
      for (const m of [h0, h1]) {
        at(D, m, 1, 2);
        keep.push(m);
      }
      for (let k = 0; k < 3; k++) {
        const x = (k - 1) * w1 * 0.3;
        const t = mesh(s1, foldLines(tatterStrip(L1 * (0.38 + 0.12 * k), w1 * 0.22, { fork: true, curl: 0.2, seed: d.seed + k }), ribbonCrease(w1 * 0.22, k)).translate(x, -L1 * 0.58, R1 * 0.02), M.hem);
        at(D, t, 3, 3);
        keep.push(t);
      }
    }
    const S = { segs: [s0, s1], len: d.len, out: d.out, lag: C.lag, max: C.max, w: d.w, arm: 0 };
    if (C.breeze) S.breeze = C.breeze;
    streamers.push(S);
  });
  return { streamers, keep };
}

/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const HAL_ITEMS = [
  { id: 'hal.head', slot: 'head', name: 'Slick Hair', hidesHair: true, build: (c) => (halRefOn() ? REF_BUILD.head(c) : buildHead(c)) },
  { id: 'hal.suit', slot: 'chest', name: 'Saviour Plate', build: (c) => (halRefOn() ? REF_BUILD.chest(c) : buildChest(c)) },
  { id: 'hal.arms', slot: 'arms', name: 'Saviour Gauntlets', build: (c) => (halRefOn() ? REF_BUILD.arms(c) : buildArms(c)) },
  { id: 'hal.legs', slot: 'legs', name: 'Saviour Boots', build: (c) => (halRefOn() ? REF_BUILD.legs(c) : buildLegs(c)) },
  { id: 'hal.belt', slot: 'waist', name: 'Gold Belt', build: (c) => (halRefOn() ? REF_BUILD.waist(c) : buildWaist(c)) },
  { id: 'hal.cape', slot: 'back', name: 'Long Red Cape', build: (c) => (halRefOn() ? REF_BUILD.back(c) : buildCape(c)) },
];
for (const item of HAL_ITEMS) registerItem(item);

/** What he wears (no `weapon`: bare-handed; the right fist hangs on the sword joint). */
export const HAL_LOADOUT = Object.freeze({
  head: 'hal.head', chest: 'hal.suit', shoulders: null, arms: 'hal.arms', legs: 'hal.legs', waist: 'hal.belt', back: 'hal.cape', weapon: null,
});

/** His "blade": the right fist along the sword joint's +Z (Tian Lei's measure). */
export const HAL_FIST = Object.freeze({ guard: -0.06, tip: 0.075 });
