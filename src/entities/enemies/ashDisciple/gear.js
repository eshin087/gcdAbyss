import { ellipsoidGeometry, limbGeometry } from '../../../render/glyphGeometry.js';
import { registerItem } from '../../player/gear/index.js';
import {
  shellGeometry, skirtSheet, tatterStrip, bandGeometry, boxGeometry, mergeGeometries, sub, foldLines, ribbonCrease, lerp, limb,
  gripFist, looseHand, sheetOffset, ring, orient,
} from '../../player/heroGeo.js';

// The Ash Disciple's outfit (docs/specs/ash-disciple.md §3): gear items on the hero's skeleton, so
// he is built by the same buildHero(U, loadout) and driven by the same animator. A small straw douli
// hat (LOOK.hat), an ash-grey long robe with a crossed collar and a charcoal sash, a bracer on the
// sword arm and a slim bell sleeve on the free arm, loose trousers with cloth-wrapped shins, and a
// long slender jian (LOOK.jian: a tapered blade with bevelled edges and a ridge, a disc guard and
// pommel, a banded grip, a red tassel). The colours are his own material instances (disciple.js
// tintDisciple): `coat` = the robe's grey, `leather` = straw, `shirt` = the charcoal sash, shoes and
// grip bands, `hem` = the off-white collar and wraps, `facing` = the red tassel, `armor` / `bevel` =
// the jian's pale steel and its edges, `trim` = old bronze fittings.
//
// Heights in comments are metres in the idle stance; head-space numbers are before BODY.headScale.

// ---------------------------------------------------------------- his look (owner pick, 2026-11-12)
/** Picked from three rendered options ("C"): a smaller, steeper douli (brim radius `r`, crown height
 *  `h`, head space: drawn ×1.3 by the head and hero scales; it was r 0.4, "way too big") and a long
 *  slender jian with bright honed edges, a small disc guard and a very long tassel (sword space, the
 *  blade along +Z: the grip from −gripBack to the guard, the steel from `base` to `tip`: 1.2 m; it
 *  was 0.77 m and read as a flute). The guard stance that goes with it is poses.js GUARD. */
const LOOK = {
  hat: { r: 0.235, h: 0.12 },
  jian: { gripBack: 0.12, guard: 0.07, base: 0.085, tip: 1.28, width: 0.036, tipW: 0.6, guardStyle: 'disc', pommel: 'disc', edge: true, tassel: [0.1, 0.36] },
};

// ---------------------------------------------------------------- head: the douli hat
/** The hat's shell, brim to peak (head space): a shallow cone, steeper toward the crown. */
const BRIM_Y = 0.196;
const HAT_RINGS = (({ r, h }) => [
  { y: BRIM_Y, rx: r, rz: r },
  { y: BRIM_Y + 0.008, rx: r * 0.92, rz: r * 0.92 },
  { y: BRIM_Y + 0.3 * h, rx: r * 0.66, rz: r * 0.66 },
  { y: BRIM_Y + 0.55 * h, rx: r * 0.42, rz: r * 0.42 },
  { y: BRIM_Y + 0.82 * h, rx: r * 0.19, rz: r * 0.19 },
  { y: BRIM_Y + h, rx: 0.014, rz: 0.014 },
])(LOOK.hat);

function buildHat({ head, M, mesh }) {
  const rings = HAT_RINGS.map((r) => ({ ...r, gap: 0, cz: -0.01 }));
  // woven straw: rings of fold lines round the cone (the field climbs with height)
  const g = foldLines(shellGeometry(rings, { sub: 2, cols: 32 }), (x, y) => 0.5 + 0.55 * Math.sin((y - 0.19) * 170));
  mesh(head, g, M.leather);
  mesh(head, g, M.lining); // the shadowed underside
  // the binding round the brim's edge, and the crown cap that holds it on the head
  const R = LOOK.hat.r;
  mesh(head, sub(bandGeometry(R + 0.002, R + 0.002, 0.012, 40), 1), M.shirt, 0, BRIM_Y, -0.01);
  mesh(head, sub(bandGeometry(0.1, 0.11, 0.05, 20), 1), M.shirt, 0, 0.19, -0.01);
  // his hair, tied in a short tail at the nape under the hat
  mesh(head, sub(ellipsoidGeometry(0.03, 0.05, 0.03, { widthSegs: 8, heightSegs: 6 }).translate(0, 0.1, -0.1), 1), M.hair);
}

// ---------------------------------------------------------------- chest: the robe and its sash
function buildRobe({ spine, chest, M, BODY, REST, mesh }) {
  const ySp = (h) => h - REST.spine, yCh = (h) => h - REST.chest;
  const SHELL = BODY.shell, top = SHELL[SHELL.length - 1];
  const rings = [...SHELL, { y: top.y + 0.02, rx: 0.06, rz: 0.058 }].map((r) => ({ ...r, rx: r.rx + 0.006, rz: r.rz + 0.006, gap: 0, y: ySp(r.y) }));
  // the crossed collar: his left lapel over the right, its edge from the left of the neck down to
  // the right side under the arm (a drawn fold line over the front)
  const g = foldLines(shellGeometry(rings, { sub: 3, cols: 28 }), (x, y, z) => (z > 0 ? 0.5 + 10 * (x - 0.03 + (ySp(1.5) - y) * 0.6) : 0));
  mesh(spine, g, M.coat);
  // the off-white under-collar showing at the neck, and the collar band round it
  mesh(chest, mergeGeometries([
    sub(bandGeometry(0.1, 0.092, 0.05, 20).translate(0, yCh(1.5), 0.006), 0),
    sub(bandGeometry(0.114, 0.104, 0.03, 20).translate(0, yCh(1.47), 0.008), 1),
  ]), M.hem);
  // the wide charcoal sash at the waist, knotted at his left front, two tails hanging
  const W = SHELL[1];
  mesh(spine, bandGeometry(W.rx + 0.02, W.rz + 0.02, 0.1, 32), M.shirt, 0, ySp(1.19), W.cz ?? 0);
  mesh(spine, boxGeometry(0.07, 0.06, 0.03, 0.07, ySp(1.19), W.rz + 0.03, 0, 0, 0.3), M.shirt);
  mesh(spine, foldLines(tatterStrip(0.34, 0.06, { tip: false, curl: 0.1, seed: 301 }), ribbonCrease(0.06, 0.7)), M.shirt, 0.08, ySp(1.16), W.rz + 0.034);
  mesh(spine, foldLines(tatterStrip(0.28, 0.05, { tip: false, curl: 0.14, seed: 307 }), ribbonCrease(0.05, 1.9)), M.shirt, 0.045, ySp(1.16), W.rz + 0.03);
}

// ---------------------------------------------------------------- arms: a bracer, a wide sleeve, bare hands
function buildSleeves({ arms, sword, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.skin);
  }
  for (const side of [-1, 1]) {
    const R = side < 0;
    const { upper, fore } = arms[R ? 'R' : 'L'];
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.006, r1: ua1 + 0.008, bulge: 0.01 }), 1),
      sub(ellipsoidGeometry(ua1 + 0.012, ua1 + 0.01, ua1 + 0.014, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.upperArm, -0.004), 1),
    ]), M.coat);
    if (R) {
      // the sword arm: the sleeve tucked into a charcoal bracer bound in cloth strips
      mesh(fore, sub(limb({ length: 0.09, r0: ua1 + 0.008, r1: fa0 + 0.01 }), 1), M.coat);
      const wraps = [];
      const n = 5, y0 = -0.08, y1 = -DIM.foreArm + 0.065;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), y = lerp(y0, y1, t), r = lerp(fa0, fa1 - 0.002, t) + 0.006;
        wraps.push(sub(limb({ length: (y0 - y1) / (n - 1) + 0.012, r0: r, r1: r - 0.004, radial: 10, rings: 2, capSegs: 1 }).translate(0, y + 0.006, 0), i & 1));
      }
      mesh(fore, mergeGeometries(wraps), M.shirt);
      mesh(fore, mergeGeometries([
        limb({ length: 0.05, r0: fa1 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.07, 0),
        ellipsoidGeometry(0.034 * HK, 0.04 * HK, 0.042 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004),
      ]), M.skin);
    } else {
      // the free arm: a wide sleeve flaring from the elbow to past the wrist (the sword-finger hand
      // shows out of it)
      // (an open bell: lofted rings down the forearm, like the hat; limb() always caps its ends. Kept
      // slim and stopping short of the wrist: wider, seen end-on, it read as a ball in his hand)
      const sl = shellGeometry([
        { y: -DIM.foreArm + 0.06, rx: fa0 + 0.034, rz: fa0 + 0.03, gap: 0 },
        { y: -0.16, rx: fa0 + 0.026, rz: fa0 + 0.023, gap: 0 },
        { y: -0.1, rx: fa0 + 0.016, rz: fa0 + 0.015, gap: 0 },
        { y: -0.04, rx: fa0 + 0.01, rz: fa0 + 0.01, gap: 0 },
      ], { sub: 2, cols: 14 });
      const sg = foldLines(sl, (x, y, z) => 0.5 + 0.6 * Math.sin(Math.atan2(x, z) * 4 + y * 6));
      mesh(fore, sg, M.coat);
      mesh(fore, sg, M.lining);
      const H = looseHand(DIM.foreArm - 0.03, side, HK);
      mesh(fore, mergeGeometries([
        limb({ length: 0.07, r0: fa1 - 0.006, r1: fa1 - 0.004, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.085, 0),
        H.palm, H.fingers, H.tips, H.thumb,
      ]), M.skin);
    }
  }
}

// ---------------------------------------------------------------- legs: trousers, wrapped shins, cloth shoes
function buildLegs({ pelvis, legs, M, DIM, BODY, mesh }) {
  {
    const [hx, hy, hz] = BODY.hips.r;
    mesh(pelvis, orient.up(ellipsoidGeometry(hx + 0.01, hz + 0.01, hy + 0.01)), M.pants, ...BODY.hips.c);
  }
  const [th0, th1] = BODY.thigh, [sh0, sh1] = BODY.shin;
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    // loose trousers: a little fuller than the leg
    mesh(thigh, limb({ length: DIM.thigh, r0: th0 + 0.014, r1: th1 + 0.016, bulge: 0.016 }), M.pants);
    mesh(shin, sub(limb({ length: 0.12, r0: th1 + 0.014, r1: sh0 + 0.012 }), 1), M.pants);
    // off-white cloth wraps from below the knee to the ankle
    const wraps = [];
    const n = 6, y0 = -0.11, y1 = -DIM.shin + 0.05;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(y0, y1, t), r = lerp(sh0, sh1, t) + 0.004;
      wraps.push(sub(limb({ length: (y0 - y1) / (n - 1) + 0.014, r0: r + 0.003, r1: r, radial: 10, rings: 2, capSegs: 1 }).translate(0, y + 0.007, 0), i & 1));
    }
    mesh(shin, mergeGeometries(wraps), M.hem);
    const F = BODY.foot;
    mesh(foot, ellipsoidGeometry(F.r[0] * 0.92, F.r[1] * 0.85, F.r[2] * 0.95, { widthSegs: 10, heightSegs: 6 }).translate(F.c[0], F.c[1] - 0.004, F.c[2]), M.shirt);
  }
}

// ---------------------------------------------------------------- waist: the robe's skirt
/** The robe below the sash, on the coat springs (anim.js _coat): two front panels that overlap (the
 *  wrap), slits at the sides, two back panels, to mid-calf. Same fields as the Wanderer's
 *  COAT_PANELS (gear/wanderer.js). */
export const ROBE_PANELS = [
  { az: 0.42, w: [0.17, 0.22, 0.28], len: [0.34, 0.36], strips: [], fork: [], out: 0.006, flare: 0.08, skew: 0.6 },
  { az: -0.42, w: [0.17, 0.22, 0.28], len: [0.34, 0.36], strips: [], fork: [], out: 0, flare: 0.08, skew: -0.6 },
  { az: 1.45, w: [0.12, 0.16, 0.2], len: [0.32, 0.32], strips: [0.05], fork: [0], out: 0.002, flare: 0.25 },
  { az: -1.45, w: [0.12, 0.16, 0.2], len: [0.32, 0.32], strips: [0.05], fork: [0], out: 0.002, flare: 0.25 },
  { az: 2.45, w: [0.16, 0.24, 0.31], len: [0.35, 0.37], strips: [0.07, 0.04], fork: [0, 1], out: 0.006, flare: 0.16, skew: -0.4 },
  { az: -2.45, w: [0.16, 0.24, 0.31], len: [0.35, 0.37], strips: [0.04, 0.07], fork: [1, 0], out: 0.006, flare: 0.16, skew: 0.4 },
];

function buildRobeSkirt({ pelvis, M, DIM, mesh, joint }) {
  const coat = [];
  ROBE_PANELS.forEach((P, i) => {
    const sa = Math.sin(P.az), ca = Math.cos(P.az);
    const R0 = 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + P.out * 0.5;
    const anchor = joint(pelvis, sa * R0, DIM.coatY + 0.02, ca * R0);
    anchor.rotation.y = P.az;
    const s0 = joint(anchor);
    const sk = P.skew ?? 0, w0 = P.w[0];
    const nF = Math.max(1, Math.round(P.w[2] / 0.09)) + 0.5, fph = i * 2.3 + 0.4;
    const L0 = P.len[0], L1 = P.len[1];
    const wAt = (d) => (d < L0 ? lerp(P.w[0], P.w[1], d / L0) : lerp(P.w[1], P.w[2], Math.min(1, (d - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const d = d0 - gy, w = wAt(d);
      const s = (u - sheetOffset(w, w0, sk)) / w + 0.5;
      const ph = Math.PI * 2 * nF * (s + 0.04 * Math.sin(d * 8 + i * 1.3)) + fph + Math.PI;
      return 0.5 + 0.6 * Math.sin(ph) - 0.9 * Math.max(0, 1 - d / 0.12);
    };
    const g0 = foldLines(skirtSheet(L0, P.w[0], P.w[1], R0, 0.25, 0, 51 + i, [0.003, 0.012, nF, fph], 0, 1, sk, w0), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = R0 + 0.25 * L0;
    const g1 = foldLines(skirtSheet(L1, P.w[1], P.w[2], R1, 0.25, 0.008, 71 + i, [0.012, 0.024, nF, fph], 0, 1, sk, w0), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const strips = [];
    const n = P.strips.length, R2 = R1 + 0.25 * L1, wr = P.w[2] / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.5) / n - 0.5) * P.w[2] + sheetOffset(P.w[2], w0, sk);
      const a = u / R2;
      const sj = joint(s1, Math.sin(a) * R2, -L1, (Math.cos(a) - 1) * R2);
      sj.rotation.y = a;
      const sw = Math.max(0.05, wr);
      mesh(sj, tatterStrip(P.strips[k], sw, { fork: !!P.fork[k], curl: 0.2, seed: 2000 + i * 31 + k * 7 }), M.coat);
      strips.push({ joint: sj, len: P.strips[k], rest: a, phase: (i * 1.9 + k * 2.1) % (Math.PI * 2) });
    }
    coat.push({ anchor, segs: [s0, s1], def: P, strips, len: [L0, L1 + (n ? Math.max(...P.strips) * 0.8 : 0)], r0: R0 });
  });
  return { coat };
}

// ---------------------------------------------------------------- weapon: the jian
/** The jian (sword space: origin = the grip centre, blade along +Z): the picked look's. */
export const JIAN = Object.freeze({ ...LOOK.jian });

/** A tapered steel slab along +Z from z0 over `len`: width w0 → w1, thickness th. */
function slab(w0, w1, th, z0, len) {
  const g = boxGeometry(w0, th, len, 0, 0, z0 + len / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getZ(i) - z0) / len;
    p.setX(i, p.getX(i) * (1 + (w1 / w0 - 1) * t));
  }
  g.computeVertexNormals();
  return g;
}

function buildJian({ sword, M, mesh, joint }) {
  const D = JIAN;
  const L = D.tip - D.base, w = D.width, body = L * 0.92;
  // the blade: a long straight double edge narrowing to a short, sharp point; a ridge down each flat
  {
    const g = slab(w, w * D.tipW, 0.011, D.base, body);
    const tip = slab(w * D.tipW, 0.002, 0.01, D.base + body, L - body);
    mesh(sword, mergeGeometries([sub(g, 0), sub(tip, 1)]), M.armor);
    const lines = [boxGeometry(0.006, 0.015, body * 0.96, 0, 0, D.base + body * 0.48)];
    if (D.edge) {
      // bright honed edges down both sides (the slender look)
      for (const s of [-1, 1]) {
        const e = slab(0.005, 0.004, 0.012, D.base + 0.02, body - 0.02);
        const p = e.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const t = (p.getZ(i) - D.base) / body;
          p.setX(i, p.getX(i) + s * (w / 2) * (1 + (D.tipW - 1) * t));
        }
        lines.push(e);
      }
    }
    mesh(sword, mergeGeometries(lines), M.bevel);
    // the broad look: a bronze-inlaid forte, engraved (alternating ink sub-ids)
    if (D.forte) mesh(sword, mergeGeometries([0, 1, 2].map((k) => sub(boxGeometry(w * 1.04, 0.013, 0.05, 0, 0, D.base + 0.03 + k * 0.055), k & 1))), M.trim);
  }
  // the grip: long enough for a second hand, wrapped in charcoal cord (bands of alternating sub-ids)
  {
    const len = D.gripBack + D.guard - 0.015;
    const bands = [];
    for (let k = 0; k < 7; k++) bands.push(sub(limbGeometry({ length: len / 7 + 0.002, r0: 0.0155, r1: 0.016, radial: 6, rings: 1 }).translate(0, 0, -D.gripBack + (k * len) / 7), k & 1));
    mesh(sword, mergeGeometries(bands), M.shirt);
  }
  // the guard and the pommel in old bronze
  {
    const gz = D.guard, parts = [];
    if (D.guardStyle === 'wing') {
      // a central block and two wings swept toward the blade, like a bat's spread wings
      parts.push(ellipsoidGeometry(0.03, 0.02, 0.022, { widthSegs: 10, heightSegs: 6 }).translate(0, 0, gz));
      for (const s of [-1, 1]) {
        parts.push(boxGeometry(0.075, 0.018, 0.022, s * 0.05, 0, gz + 0.012, 0, -s * 0.38, 0));
        parts.push(boxGeometry(0.03, 0.02, 0.02, s * 0.088, 0, gz + 0.036, 0, -s * 0.9, 0));
      }
    } else if (D.guardStyle === 'cross') {
      // a heavy flat bar, its tips turned up toward the blade
      parts.push(boxGeometry(0.16, 0.026, 0.024, 0, 0, gz));
      for (const s of [-1, 1]) parts.push(boxGeometry(0.026, 0.028, 0.05, s * 0.085, 0, gz + 0.02));
    } else {
      // a small round disc guard
      parts.push(ellipsoidGeometry(0.045, 0.022, 0.012, { widthSegs: 14, heightSegs: 4 }).translate(0, 0, gz));
    }
    parts.push(ring(0.018, 0.018, 0.007, 8).rotateX(Math.PI / 2).translate(0, 0, gz - 0.014));
    if (D.pommel === 'ring') parts.push(ring(0.03, 0.03, 0.008, 12).rotateY(Math.PI / 2).translate(0, 0, -D.gripBack - 0.032));
    else parts.push(ellipsoidGeometry(0.026, 0.026, 0.016, { widthSegs: 10, heightSegs: 6 }).translate(0, 0, -D.gripBack - 0.014));
    mesh(sword, mergeGeometries(parts), M.trim);
  }
  // the red tassel off the pommel: a cord and a fringe on a spring (anim.js _streamers)
  const [cord, fringe] = D.tassel;
  const base = joint(sword, 0, 0, -D.gripBack - (D.pommel === 'ring' ? 0.06 : 0.03));
  const s0 = joint(base);
  mesh(s0, sub(limb({ length: cord, r0: 0.004, r1: 0.004, radial: 4, rings: 1, capSegs: 1 }), 1), M.facing);
  const s1 = joint(s0, 0, -cord, 0);
  mesh(s1, foldLines(tatterStrip(fringe, 0.045, { fork: true, curl: 0.1, seed: 404 }), ribbonCrease(0.045, 0.3)), M.facing);
  // the sword turns every way: a wide swing limit lets the tassel find the ground's down from any grip
  return { streamers: [{ segs: [s0, s1], len: [cord, fringe], out: 0.05, lag: 0.9, max: 2.6 }] };
}

/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const ASH_ITEMS = [
  { id: 'ash.hat', slot: 'head', name: 'Ash-Grey Douli', hidesHair: true, build: buildHat },
  { id: 'ash.robe', slot: 'chest', name: 'Sect Robe', build: buildRobe },
  { id: 'ash.sleeves', slot: 'arms', name: 'Bracer and Sleeve', build: buildSleeves },
  { id: 'ash.legs', slot: 'legs', name: 'Wrapped Trousers', build: buildLegs },
  { id: 'ash.skirt', slot: 'waist', name: 'Robe Skirt', build: buildRobeSkirt },
  { id: 'ash.jian', slot: 'weapon', name: 'Ashen Jian', dims: JIAN, build: buildJian },
];
for (const item of ASH_ITEMS) registerItem(item);

/** What the Ash Disciple wears. */
export const ASH_LOADOUT = Object.freeze({
  head: 'ash.hat',
  chest: 'ash.robe',
  shoulders: null,
  arms: 'ash.sleeves',
  legs: 'ash.legs',
  waist: 'ash.skirt',
  back: null,
  weapon: 'ash.jian',
});
