import * as THREE from 'three';
import { ellipsoidGeometry, limbGeometry, planarGUV } from '../../../render/glyphGeometry.js';
import { DIM as HERO_DIM } from '../heroDims.js';
import {
  gridGeometry, shellGeometry, skirtSheet, tatterStrip, arcPlate, strapGeometry, boxGeometry, kiteGeometry, sheetEdge, starGeometry,
  mergeGeometries, sub, partGeometry, foldLines, ribbonCrease, spike, bandGeometry, place, sheetOffset, lerp, orient, ring, limb, wedge,
} from '../heroGeo.js';

// The Wanderer's outfit, "Shadow Swordsman": the default gear set (gear/index.js DEFAULT_LOADOUT),
// one item per slot, the look described at the top of model.js. Each item's build(ctx) hangs its
// meshes on the skeleton joints it is handed (gear/README.md: the item contract); the sculpted
// parts (collar, lapels, pauldron, cape sheets, blade) come from heroParts.js through
// partGeometry(key). The `head` slot is empty: hair, face and neck are the body (model.js).
//
// Heights in comments are metres in the idle stance; a `y…(h)` helper turns one into the local y
// of the joint the mesh hangs on (ctx.REST).

/** Coat skirt (hero.md §2.4; the lean reference match, ADR-034): six panels hanging from 1.135 m
 *  under the belts (az: 0 = front, + = the hero's left). Each panel = an upper and a lower solid
 *  segment (`len`, widths `w` at the top, the join and the tear line), then torn `strips` (lengths,
 *  m) on their own springs. `out` nudges a panel outward so overlapping neighbours never z-fight;
 *  `flare` is its resting outward pull (anim.js COAT_FLARE: 0.1 ≈ 6°); `edge` (±1) runs grey-violet
 *  piping down its +X / −X edge (the open front edges, the back vent's edges). */
// The reference sheet's coat is NOT a closed skirt: from behind, two TAILS split by a centre vent
// from just under the belts, each flaring out (an A-line of its own) to a ragged hem that runs down
// from the vent to its longest point at the outer edge, at mid-calf; narrow side panels; in front two
// panels hang beside the legs from the open coat front, flaring the same way. A panel's vent / front
// edge hangs straight or drifts out (`skew` ≥ 1: the width it gains goes to its outer side), so the
// legs show in the vent and the open front in every view; the hem slopes down to the outer point
// (`slant`, m); the lower part lightens into the dusty lavender torn zone and ends in claw points,
// longest outside.
export const COAT_PANELS = [
  { az: 0.95, w: [0.134, 0.223, 0.34], len: [0.33, 0.33], strips: [0.08, 0.16], fork: [0, 0], out: 0.004, flare: 0.28, edge: -1, skew: 1, slant: 0.07 }, // front-left
  { az: -0.95, w: [0.134, 0.223, 0.34], len: [0.33, 0.33], strips: [0.16, 0.08], fork: [0, 0], out: 0.004, flare: 0.28, edge: 1, skew: -1, slant: 0.07 }, // front-right
  { az: 1.7, w: [0.146, 0.223, 0.34], len: [0.35, 0.35], strips: [0.14], fork: [1], out: 0, flare: 0.55 }, // left
  { az: -1.7, w: [0.146, 0.223, 0.34], len: [0.35, 0.35], strips: [0.14], fork: [1], out: 0, flare: 0.55 }, // right
  { az: 2.5, w: [0.157, 0.286, 0.46], len: [0.36, 0.36], strips: [0.18, 0.13, 0.08], fork: [0, 1, 0], out: 0.008, flare: 0.5, edge: 1, skew: -1.35, slant: 0.08 }, // back-left tail
  { az: -2.5, w: [0.157, 0.286, 0.46], len: [0.36, 0.36], strips: [0.08, 0.13, 0.18], fork: [0, 1, 0], out: 0.008, flare: 0.5, edge: -1, skew: 1.35, slant: 0.08 }, // back-right tail
];

/** The torn half-cape: wide ragged sheets on the streamer springs (anim.js), fanned behind his
 *  right shoulder and back; sculpted by scripts/blender/hero_parts.py (`cape.<i>.a/b/c`). `at` =
 *  the sheet's root on the chest joint, `ry` = the way its outer face looks (π = straight back),
 *  `w` = its width at the root / the torn end, `len` = the two spring segments, `out` = how far it
 *  flies out from the chest at rest (tan of the angle), `cup` = the billow baked into it. */
export const CAPE_SHEETS = [
  { at: [-0.225, 0.17, -0.062], ry: Math.PI + 0.3, w: [0.18, 0.4], len: [0.44, 0.5], out: 0.9, cup: 0.05, seed: 11 },
  { at: [-0.135, 0.18, -0.102], ry: Math.PI + 0.15, w: [0.2, 0.42], len: [0.48, 0.52], out: 0.68, cup: 0.06, seed: 23 },
  { at: [-0.03, 0.185, -0.119], ry: Math.PI, w: [0.2, 0.36], len: [0.46, 0.46], out: 0.46, cup: 0.06, seed: 37 },
  { at: [0.06, 0.185, -0.113], ry: Math.PI - 0.2, w: [0.16, 0.24], len: [0.36, 0.34], out: 0.34, cup: 0.05, seed: 41 },
];

// ---------------------------------------------------------------- chest: the open greatcoat
/** The coat's torso: one V-shell open at the front, the shirt and its buttons, the two belts and
 *  the baldric with their hardware, lapels, piping, the shaped upper back and its emblem (on the
 *  spine joint), and the stand collar (on the chest joint). */
function buildCoat({ spine, chest, M, BODY, REST, mesh }) {
  const ySp = (h) => h - REST.spine; // world idle height → spine-joint local y
  const yCh = (h) => h - REST.chest;
  // open coat (BODY.shell): hips 0.27 → waist 0.23 (1.21 m) → chest 0.32 → under the arms 0.34, the
  // front open from the collar (0.03 m) to the belt (0.14 m)
  const SHELL = BODY.shell;
  const shellAt = (h) => {
    let k = 0;
    while (k < SHELL.length - 2 && SHELL[k + 1].y < h) k++;
    const A = SHELL[k], B = SHELL[k + 1], u = Math.min(1, Math.max(0, (h - A.y) / (B.y - A.y)));
    return { rx: lerp(A.rx, B.rx, u), rz: lerp(A.rz, B.rz, u), cz: lerp(A.cz ?? 0, B.cz ?? 0, u), gap: lerp(A.gap, B.gap, u) };
  };
  /** z of the coat shell's front (s = 1) / back (s = −1) surface at height h, x across. */
  const shellZ = (h, x, s = 1) => {
    const R = shellAt(h);
    return s * Math.sqrt(Math.max(0, 1 - (x / R.rx) ** 2)) * R.rz + R.cz;
  };
  mesh(spine, shellGeometry(SHELL.map((r) => ({ ...r, y: ySp(r.y) })), { sub: 3, cols: 28 }), M.coat);
  // the black shirt in the open front (just inside the coat shell), buttons down the centre
  const SHIRT = [1.17, 1.3, 1.43, 1.5].map((h) => {
    const R = shellAt(h);
    return { h, rx: R.rx * 0.93, rz: R.rz - 0.008, cz: R.cz };
  });
  mesh(spine, shellGeometry(SHIRT.map((r) => ({ y: ySp(r.h), rx: r.rx, rz: r.rz, cz: r.cz })), { span: 1.0, cols: 8, sub: 2 }), M.shirt);
  // the main belt W1 (1.21 m) and W2 (1.15 m) radii: 0.012 m off the coat
  const W1 = [shellAt(1.21).rx + 0.012, shellAt(1.21).rz + 0.012], W2 = [shellAt(1.15).rx + 0.016, shellAt(1.15).rz + 0.015];
  // C1, the baldric: one strap round the torso in a tilted plane, from over the RIGHT shoulder (under
  // the pauldron) across the chest and across the back down to the LEFT hip (the reference's diagonal
  // strap from both sides). Height along it h = BALD.h + BALD.slope × x (x = the hero's left); each
  // point sits BALD.proud off the shell (bisection: the shell's radius changes with the height)
  const BALD = { h: 1.335, slope: -1.0, w: 0.032, proud: 0.007 };
  const baldAt = (a) => {
    const sa = Math.sin(a);
    let lo = 1.1, hi = 1.505;
    for (let it = 0; it < 24; it++) {
      const m = (lo + hi) * 0.5;
      if (m - (BALD.h + BALD.slope * sa * shellAt(m).rx) > 0) hi = m;
      else lo = m;
    }
    return (lo + hi) * 0.5;
  };
  {
    const bt = [];
    for (let i = 0; i < 3; i++) {
      const h = 1.27 + i * 0.065;
      // on the shirt's front (its rings are linear between SHIRT heights)
      let k = 0;
      while (k < SHIRT.length - 2 && SHIRT[k + 1].h < h) k++;
      const A = SHIRT[k], B = SHIRT[k + 1], u = Math.min(1, Math.max(0, (h - A.h) / (B.h - A.h)));
      bt.push(ellipsoidGeometry(0.006, 0.006, 0.004, { widthSegs: 5, heightSegs: 3 }).translate(0, ySp(h), lerp(A.rz + A.cz, B.rz + B.cz, u) + 0.006));
    }
    // belt hardware: W1 buckle (2 cm left of centre), W2 buckle (front-right), rivets; the baldric's
    // buckle on the chest and its ring between the shoulder blades
    bt.push(boxGeometry(0.044, 0.036, 0.014, 0.02, ySp(1.21), W1[1] + 0.004));
    bt.push(boxGeometry(0.04, 0.032, 0.014, -0.036, ySp(1.152), W2[1] + 0.003, 0, 0, 0.14));
    for (const [x, h] of [[0.075, 1.21], [-0.068, 1.21], [0.1, 1.21], [-0.096, 1.21]]) {
      bt.push(ellipsoidGeometry(0.007, 0.007, 0.006, { widthSegs: 5, heightSegs: 3 }).translate(x, ySp(h), Math.sqrt(Math.max(0, 1 - (x / W1[0]) ** 2)) * W1[1] + 0.003));
    }
    for (const a of [-0.3, Math.PI + 0.42]) {
      const h = baldAt(a), R = shellAt(h), x = Math.sin(a) * (R.rx + BALD.proud + 0.004), z = Math.cos(a) * (R.rz + BALD.proud + 0.004) + R.cz;
      bt.push(boxGeometry(0.03, 0.03, 0.01, x, ySp(h), z, 0, a, Math.cos(a) > 0 ? -0.78 : 0.78));
    }
    mesh(spine, mergeGeometries(bt), M.trim);
  }
  // W1 main belt at the natural waist, W2 sloping 1.17 (left) → 1.13 (right): flat leather bands
  // standing 0.012 m off the coat — the bright bands that cinch the narrow waist
  mesh(spine, bandGeometry(W1[0], W1[1], 0.044, 32), M.leather, 0, ySp(1.21), 0.0);
  mesh(spine, bandGeometry(W2[0], W2[1], 0.036, 32), M.leather, 0, ySp(1.15), 0.0).rotation.z = 0.14;
  mesh(spine, gridGeometry(48, 1, (s, t, o) => {
    const a = s * Math.PI * 2;
    const h = baldAt(a) + (t - 0.5) * BALD.w;
    const R = shellAt(h);
    o[0] = Math.sin(a) * (R.rx + BALD.proud);
    o[1] = ySp(h);
    o[2] = Math.cos(a) * (R.rz + BALD.proud) + R.cz;
    o[3] = (a - Math.PI) * 0.12;
    o[4] = o[1];
  }, true), M.leather);
  // lapels: narrow facings folded out from the collar to ~1.37 m, grey-violet piping along their
  // outer edges and down both front edges of the open coat to the belts
  {
    const lp = [partGeometry('lapel')], pp = [partGeometry('lapel.edge')];
    for (const s of [1, -1]) {
      // piping down the coat's front edge, from under the lapel to the belts
      pp.push(gridGeometry(1, 6, (u, t, o) => {
        const h = lerp(1.24, 1.13, t);
        const R = shellAt(h);
        const x = s * (R.gap + 0.004 + u * 0.007);
        o[0] = x;
        o[1] = ySp(h);
        o[2] = Math.sqrt(Math.max(0, 1 - (x / R.rx) ** 2)) * R.rz + R.cz + 0.004;
        o[3] = x;
        o[4] = o[1];
      }, s < 0));
    }
    // the shaped upper back (the reference's back view): a yoke, the coat's back in a second piece
    // standing 3 mm off it, whose lower edge dips in two arcs from the armpits to a point between the
    // shoulder blades; piping along those arcs, a centre seam down to the belt, and the emblem, a
    // four-point star, where the arcs meet. Restrained: a few seams, no stitching noise
    const YK = { x: 0.15, low: 1.36, high: 1.452, top: 1.474 };
    const yokeLow = (x) => YK.low + (YK.high - YK.low) * Math.pow(Math.min(1, Math.abs(x) / YK.x), 0.8);
    const backPt = (x, h, off, o) => {
      const R = shellAt(h);
      const xx = Math.max(-R.rx * 0.985, Math.min(R.rx * 0.985, x));
      o[0] = xx;
      o[1] = ySp(h);
      o[2] = -Math.sqrt(Math.max(0, 1 - (xx / R.rx) ** 2)) * R.rz + R.cz - off;
      o[3] = xx;
      o[4] = o[1];
    };
    const yoke = sub(gridGeometry(16, 3, (s, t, o) => {
      const x = (s - 0.5) * 2 * YK.x;
      backPt(x, lerp(yokeLow(x), YK.top, t), 0.003, o);
    }, true), 1);
    mesh(spine, yoke, M.coat);
    // the yoke's two arcs and the centre seam (piping, 6 mm)
    pp.push(gridGeometry(24, 1, (s, t, o) => {
      const x = (s - 0.5) * 2 * YK.x;
      backPt(x, yokeLow(x) + (t - 0.5) * 0.006, 0.0045, o);
    }, true));
    pp.push(gridGeometry(1, 4, (s, t, o) => backPt((s - 0.5) * 0.006, lerp(YK.low - 0.03, 1.236, t), 0.004, o), false));
    // the emblem: a concave four-point star (long points up / down, short ones to the sides)
    {
      const hS = YK.low + 0.006, zS = shellZ(hS, 0, -1) - 0.0055;
      const tips = [[0, 0.046], [0.03, 0], [0, -0.052], [-0.03, 0]];
      const pos = [];
      for (let k = 0; k < 4; k++) {
        const A = tips[k], B = tips[(k + 1) % 4];
        const mx = (A[0] + B[0]) * 0.17, my = (A[1] + B[1]) * 0.17; // the concave waist between points
        pos.push(0, 0, 0, mx, my, 0, A[0], A[1], 0);
        pos.push(0, 0, 0, B[0], B[1], 0, mx, my, 0);
      }
      const star = new THREE.BufferGeometry();
      star.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      star.rotateY(Math.PI).translate(0, ySp(hS), zS); // faces −Z (his back)
      star.computeVertexNormals();
      planarGUV(star, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      lp.push(star);
    }
    mesh(spine, mergeGeometries(lp), M.facing);
    mesh(spine, mergeGeometries(pp), M.piping);
  }

  // tall stand collar: black outside, blue-violet inside, a turned-over rim (its own piece, so it
  // is outlined); the shirt's mandarin collar
  {
    const cg = partGeometry('collar');
    mesh(chest, cg, M.collar);
    mesh(chest, cg, M.collarIn);
    mesh(chest, partGeometry('collar.rim'), M.piping);
    mesh(chest, bandGeometry(0.052, 0.05, 0.03, 16), M.shirt, 0, yCh(1.515), 0.008);
  }
}

// ---------------------------------------------------------------- shoulders: pauldron (RIGHT only)
function buildPauldron({ pauldron, arms, M, BODY, mesh }) {
  {
    // the reference's pauldron: a STACK of pointed lames over the right shoulder and down the upper
    // arm, each standing off the one below with a dark gap and a bright bevel along its cut lower
    // edge, short flat blades rising from the cap. The cap and the lame under it are sculpted in
    // Blender (scripts/blender/hero_parts.py, PAUL); the lower two ride on the arm itself (below)
    mesh(pauldron, partGeometry('pauldron.plate'), M.armor);
    mesh(pauldron, partGeometry('pauldron.bevel'), M.bevel);
    mesh(pauldron, partGeometry('pauldron.spike'), M.spike);
  }
  const upper = arms.R.upper, [ua0] = BODY.upperArm;
  // P3 / P4: the pauldron's lower lames riding on the arm itself, stepping in down the arm
  // (0.03 → 0.018 m off the sleeve), a silver bevel along each lower edge and a down-back point
  // drawn out of each one's back corner (the reference's stack of blade-edged plates)
  const o = ua0 - 0.062; // P3 stands ua0 + 0.038 off the arm's axis
  mesh(upper, mergeGeometries([
    sub(arcPlate(-0.045, -0.125, 0.1 + o, 0.096 + o, -Math.PI / 2, 2.1), 0),
    sub(arcPlate(-0.11, -0.185, 0.094 + o, 0.088 + o, -Math.PI / 2, 2.0), 1),
  ]), M.armor);
  mesh(upper, mergeGeometries([
    arcPlate(-0.113, -0.126, 0.0975 + o, 0.0975 + o, -Math.PI / 2, 2.1),
    arcPlate(-0.173, -0.186, 0.0895 + o, 0.0895 + o, -Math.PI / 2, 2.0),
  ]), M.bevel);
  mesh(upper, mergeGeometries([
    wedge(0.09, 0.022, [-0.095 - o, -0.11, -0.03], [-0.6, -0.6, -0.5], [0, -1, 0], 0.15),
    wedge(0.075, 0.018, [-0.088 - o, -0.17, -0.03], [-0.6, -0.65, -0.45], [0, -1, 0], 0.15),
  ]), M.spike);
}

// ---------------------------------------------------------------- arms (asymmetric)
/** Coat sleeves with deltoid caps on both arms; a plate vambrace and gauntlet on the right (the
 *  sword arm), a leather bracer and a fingerless glove on the left. */
function buildArms({ arms, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  for (const side of [-1, 1]) {
    const R = side < 0;
    const out = side; // the outer side of this arm is x = side (right arm: −X)
    const { upper, fore } = arms[R ? 'R' : 'L'];
    // sleeves: sub-id 1 against the torso shell's 0, so the arm is outlined where it meets the body
    // (lean reference match: slim coat sleeves with a small rounded deltoid cap)
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0, r1: ua1, bulge: 0.004 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(out * 0.008, -0.02, 0), 1),
    ]), M.coat);
    mesh(fore, sub(limb({ length: 0.09, r0: ua1, r1: ua1 - 0.003 }), 1), M.coat);
    if (R) {
      // A1 strap just below the pauldron
      // plate vambrace: 3 overlapping lames with silver bevels, an elbow point and a wrist barb
      const v = fa0 - 0.06; // the lames' radii follow the forearm (BODY.foreArm)
      mesh(fore, mergeGeometries([
        limb({ length: 0.085, r0: 0.06 + v, r1: 0.056 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.035, 0),
        sub(limb({ length: 0.08, r0: 0.057 + v, r1: 0.053 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.105, 0), 1),
        limb({ length: 0.075, r0: 0.054 + v, r1: 0.05 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.17, 0),
        // the articulated gauntlet over the grip
        sub(ellipsoidGeometry(0.044 * HK, 0.042 * HK, 0.058 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm - 0.008, 0.006), 1),
      ]), M.armor);
      mesh(fore, mergeGeometries([
        bandGeometry(0.0605 + v, 0.0605 + v, 0.01, 14).translate(0, -0.113, 0),
        bandGeometry(0.0575 + v, 0.0575 + v, 0.01, 14).translate(0, -0.178, 0),
      ]), M.bevel);
      mesh(fore, mergeGeometries([
        bandGeometry(0.054 + v, 0.054 + v, 0.016, 14).translate(0, -0.247, 0), // the gauntlet cuff ring
        ellipsoidGeometry(0.031, 0.012, 0.04, { widthSegs: 8, heightSegs: 3 }).translate(0, -DIM.foreArm + 0.02, 0.036),
      ]), M.trim);
      mesh(fore, mergeGeometries([
        wedge(0.07, 0.022, [out * (0.045 + v), -0.04, -0.025], [out * 0.35, 1, -0.55], [0, 0, -1], 0.12), // elbow point
        wedge(0.05, 0.015, [out * (0.05 + v), -0.21, 0], [out, 0.25, 0], [0, 1, 0], 0.1), // wrist barb
      ]), M.spike);
    } else {
      // left: plain coat shoulder, A2 strap above the elbow, a leather bracer with two silver
      // bands, a silver cuff ring, a fingerless glove with skin fingertips
      mesh(fore, limb({ length: 0.18, r0: fa0, r1: fa1, radial: 10, rings: 3 }), M.pants, 0, -0.05, 0);
      mesh(fore, bandGeometry(fa1 + 0.002, fa1 + 0.002, 0.025, 14).translate(0, -0.236, 0), M.trim);
      mesh(fore, wedge(0.05, 0.018, [out * (fa0 - 0.015), -0.05, -0.02], [out * 0.3, 1, -0.5], [0, 0, -1], 0.12), M.spike);
      mesh(fore, ellipsoidGeometry(0.042 * HK, 0.04 * HK, 0.055 * HK, { widthSegs: 10, heightSegs: 6 }), M.pants, 0, -DIM.foreArm - 0.006, 0.004);
      mesh(fore, ellipsoidGeometry(0.031 * HK, 0.014 * HK, 0.021 * HK, { widthSegs: 8, heightSegs: 4 }), M.skin, 0, -DIM.foreArm - 0.046 * HK, 0.023 * HK);
    }
  }
}

// ---------------------------------------------------------------- legs
/** Black pants (hips and thighs) with the hip strap, the drop strap and the sword hanger, the
 *  knee-guard straps, and the knee-high armoured boots: greaves, knee guards, feet. */
function buildLegs({ pelvis, legs, M, DIM, BODY, REST, mesh }) {
  const yPe = (h) => h - REST.pelvis; // world idle height → pelvis-joint local y
  // ---------------------------------------------------------------- hips, hip strap, drop strap
  {
    const [hx, hy, hz] = BODY.hips.r;
    mesh(pelvis, orient.up(ellipsoidGeometry(hx, hz, hy)), M.pants, ...BODY.hips.c);
  }
  {
    // H1: diagonal hip strap (0.03 m), left hip (1.13 m) down across the front to the right thigh
    const h1 = mesh(pelvis, bandGeometry(BODY.hips.r[0] * 1.14, BODY.hips.r[2] * 1.18, 0.03, 28), M.leather, 0.01, yPe(1.04), 0.004);
    h1.rotation.z = 0.55;
    // D1: centre drop strap from the second belt to 0.93 m, a D-ring and a pointed metal tip
    mesh(pelvis, strapGeometry([0, yPe(1.13), 0.11], [0, yPe(0.93), 0.104], 0.026, 0.008, [1, 0, 0]), M.leather);
    mesh(pelvis, mergeGeometries([
      boxGeometry(0.03, 0.024, 0.012, 0, yPe(1.07), 0.117),
      kiteGeometry(0.015, 0.022, 0.007, { yPos: 0.4 }).translate(0, yPe(0.915), 0.106),
      boxGeometry(0.044, 0.036, 0.014, -0.086, yPe(1.0), 0.094, 0, -0.5, -0.5), // H1 buckle, right thigh
    ]), M.trim);
  }

  // ---------------------------------------------------------------- thighs, boots
  const [th0, th1, thB] = BODY.thigh, [sh0, sh1, shB] = BODY.shin;
  /** limb radius t (0 → 1) along a bulging taper */
  const rAt = (r0, r1, bulge, t) => lerp(r0, r1, t) + bulge * Math.sin(Math.PI * t);
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = legs[side < 0 ? 'R' : 'L'];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0, r1: th1, bulge: thB }), M.pants);
    // knee-guard straps
    const ks = (y) => rAt(th0, th1, thB, (-y) / DIM.thigh) + 0.004;
    mesh(thigh, mergeGeometries([
      bandGeometry(ks(-DIM.thigh + 0.085), ks(-DIM.thigh + 0.085), 0.015, 12).translate(0, -DIM.thigh + 0.085, 0),
      bandGeometry(ks(-DIM.thigh + 0.035), ks(-DIM.thigh + 0.035), 0.015, 12).translate(0, -DIM.thigh + 0.035, 0),
    ]), M.leather);
    if (side < 0) {
      // D2: the sword hanger down the right thigh to 0.85 m, with a ring
      mesh(thigh, strapGeometry([-(th0 - 0.006), 0.04, 0.04], [-(th0 - 0.002), -0.06, 0.03], 0.022, 0.008, [0, 0, 1]), M.leather);
      mesh(thigh, ring(0.016, 0.016, 0.005, 8).rotateX(Math.PI / 2).translate(-(th0 - 0.002), -0.065, 0.025), M.trim);
    }
    // knee-high armoured boot: the shell, a cuff lame under the knee and one at the ankle, and the
    // reference's KITE GREAVE down the shin: a faceted diamond plate pointed at the knee and the
    // ankle with a raised centre ridge, silver bevels on its edges and the ridge (stacked ring lames
    // read as a stack of tyres); from behind, two lames step down the calf (the reference's back view
    // shows banded calves). The boot follows the lean leg (BODY.shin)
    mesh(shin, limb({ length: DIM.shin - 0.02, r0: sh0, r1: sh1, bulge: shB }), M.armor, 0, -0.02, 0);
    const b = sh0 - 0.058; // how far the boot's plates stand in / out with the shin's radius
    mesh(shin, mergeGeometries([
      sub(arcPlate(-0.045, -0.09, 0.067 + b, 0.065 + b, 0, 1.4, 6), 1),
      sub(arcPlate(-0.33, -0.375, 0.054 + b * 0.9, 0.052 + b * 0.9, 0, 1.5, 6), 1),
      sub(arcPlate(-0.13, -0.19, sh0 + 0.016, sh0 + 0.012, Math.PI, 1.35, 8), 1),
      arcPlate(-0.2, -0.26, sh0 + 0.011, sh1 + 0.012, Math.PI, 1.3, 8),
    ]), M.armor);
    mesh(shin, mergeGeometries([
      arcPlate(-0.183, -0.192, sh0 + 0.0165, sh0 + 0.0165, Math.PI, 1.35, 8),
      arcPlate(-0.252, -0.261, sh1 + 0.0125, sh1 + 0.0125, Math.PI, 1.3, 8),
    ]), M.bevel);
    {
      const T = [0, -0.06, 0.069 + b], Rt = [0.058 + b, -0.16, 0.058 + b], B = [0, -0.355, 0.051 + b * 0.9], Lf = [-0.058 - b, -0.16, 0.058 + b], C = [0, -0.16, 0.08 + b * 1.3];
      const kg = new THREE.BufferGeometry();
      kg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...T, ...C, ...Rt, ...T, ...Lf, ...C, ...C, ...Lf, ...B, ...C, ...B, ...Rt]), 3));
      kg.computeVertexNormals();
      planarGUV(kg, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      mesh(shin, kg, M.armor);
      mesh(shin, mergeGeometries([
        arcPlate(-0.083, -0.092, 0.0675 + b, 0.0675 + b, 0, 1.4, 6),
        arcPlate(-0.366, -0.375, 0.0535 + b * 0.9, 0.0535 + b * 0.9, 0, 1.5, 6),
      ]), M.bevel);
    }
    // kite knee guard (poleyn): 0.1 W × 0.14 H standing 0.02 m off the knee, a ridge down the
    // middle, silver bevels on all four edges, wings wrapping the sides; its point leans 15° out
    // and a short spike carries it to 0.60 m
    {
      const lean = -side * 0.26;
      const T = [0, 0.085, 0.082 + b], Rt = [0.05, 0.004, 0.072 + b], B = [0, -0.05, 0.08 + b], Lf = [-0.05, 0.004, 0.072 + b], C = [0, 0.012, 0.094 + b];
      const kp = new THREE.BufferGeometry();
      kp.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...T, ...C, ...Rt, ...T, ...Lf, ...C, ...C, ...Lf, ...B, ...C, ...B, ...Rt]), 3));
      kp.computeVertexNormals();
      planarGUV(kp, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      const wings = [];
      for (const s of [-1, 1]) wings.push(place(kiteGeometry(0.012, 0.03, 0.03), s * (0.05 + b), -0.006, 0.03 + b * 0.5, 0, s * 0.6, 0));
      mesh(shin, mergeGeometries([kp, ...wings]).rotateZ(lean), M.armor);
      mesh(shin, wedge(0.038, 0.013, [0, 0.075, 0.083 + b], [0, 1, 0.12], [0, 0, 1], 0.05).rotateZ(lean), M.spike);
    }
    // boot foot, 2 instep lames, a rounded slightly pointed toe, heel, the silver sole welt (the sole
    // rests on the ground at −0.07)
    const F = BODY.foot;
    mesh(foot, mergeGeometries([
      ellipsoidGeometry(...F.r, { widthSegs: 10, heightSegs: 6 }).translate(...F.c),
      sub(place(ellipsoidGeometry(0.046, 0.024, 0.041, { widthSegs: 8, heightSegs: 4 }), 0, F.c[1] + F.r[1] - 0.015, 0.064, -0.35), 1),
      place(ellipsoidGeometry(0.042, 0.021, 0.037, { widthSegs: 8, heightSegs: 4 }), 0, F.c[1] + F.r[1] - 0.03, 0.11, -0.25),
      sub(boxGeometry(0.062, 0.032, 0.052, 0, -0.053, -0.062), 1),
    ]), M.armor);
    mesh(foot, ellipsoidGeometry(F.r[0] + 0.006, 0.007, F.r[2] + 0.007, { widthSegs: 14, heightSegs: 3 }), M.welt, 0, -0.062, F.c[2]);
  }
}

// ---------------------------------------------------------------- waist: the coat skirt
/** The coat skirt, COAT_PANELS hung on the pelvis. Returns `coat`: the panels the animator springs
 *  (anim.js _coat reads each one's anchor, segs, def, strips, len and r0). */
function buildSkirt({ pelvis, M, DIM, mesh, joint }) {
  // 6 tapering panels × (upper + lower solid segment, each a lagging spring) → torn strips, each on
  // its own spring (anim.js); indigo lining on the inside; grey-violet piping down the open front
  // edges and the back vent's edges (COAT_PANELS `edge`). The panel tops tuck under the belt stack,
  // just inside the coat shell (no hard rim at the waist).
  const coat = [];
  COAT_PANELS.forEach((P, i) => {
    const sa = Math.sin(P.az), ca = Math.cos(P.az);
    const R0 = 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + P.out * 0.5;
    const anchor = joint(pelvis, sa * R0, DIM.coatY, ca * R0);
    anchor.rotation.y = P.az; // local +Z = outward, +X = tangent
    const s0 = joint(anchor);
    const sk = P.skew ?? 0, w0 = P.w[0];
    // pleats: nF soft folds fanning out from the belt (the sheet's own waves) and the same folds
    // DRAWN (foldLines: an ink line down each fold's flank, its valley in shadow), opening ~15 cm
    // under the belt and wandering a little on the way down, like the reference's dashed fold lines
    const nF = Math.max(1, Math.round(P.w[2] / 0.1)) + 0.5, fph = i * 2.1 + 0.7;
    const L0 = P.len[0], L1 = P.len[1];
    const wAt = (d) => (d < L0 ? lerp(P.w[0], P.w[1], d / L0) : lerp(P.w[1], P.w[2], Math.min(1, (d - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const d = d0 - gy, w = wAt(d);
      const s = (u - sheetOffset(w, w0, sk)) / w + 0.5;
      const ph = Math.PI * 2 * nF * (s + 0.05 * Math.sin(d * 9 + i * 1.9)) + fph + Math.PI;
      return 0.5 + 0.62 * (Math.sin(ph) + 0.3 * Math.sin(ph * 2.3 + 1.7)) - 0.9 * Math.max(0, 1 - d / 0.16);
    };
    const g0 = foldLines(skirtSheet(P.len[0], P.w[0], P.w[1], R0, 0.25, 0, 11 + i, [0.003, 0.014, nF, fph], 0, 1, sk, w0), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -P.len[0], 0);
    const R1 = R0 + 0.25 * P.len[0];
    const fold = [0.014, 0.03, nF, fph];
    const sl = P.slant ?? 0;
    const g1 = foldLines(skirtSheet(P.len[1], P.w[1], P.w[2], R1, 0.25, 0.022, 31 + i, fold, 0, 0.45, sk, w0, sl), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = foldLines(skirtSheet(P.len[1], P.w[1], P.w[2], R1, 0.25, 0.022, 31 + i, fold, 0.45, 1, sk, w0, sl), pleat(L0));
    mesh(s1, g2, M.hem);
    mesh(s1, g2, M.lining);
    if (P.edge) {
      mesh(s0, sheetEdge(P.len[0], P.w[0], P.w[1], R0, P.edge, 1, 0.25, sk, w0), M.piping);
      mesh(s1, sheetEdge(P.len[1], P.w[1], P.w[2], R1, P.edge, 0.5, 0.25, sk, w0), M.piping);
    }
    const strips = [];
    const n = P.strips.length;
    const R2 = R1 + 0.25 * P.len[1];
    const wr = P.w[2] / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const sk01 = (k + 0.5) / n;
      const u = (sk01 - 0.5) * P.w[2] + sheetOffset(P.w[2], w0, sk);
      const a = u / R2;
      const sj = joint(s1, Math.sin(a) * R2, -P.len[1] - sl * (sk < 0 ? 1 - sk01 : sk01), (Math.cos(a) - 1) * R2);
      sj.rotation.y = a;
      const sw = Math.max(0.05, wr * 1.25);
      mesh(sj, foldLines(tatterStrip(P.strips[k], sw, { fork: !!P.fork[k], curl: 0.25, seed: 1000 + i * 31 + k * 7 }), ribbonCrease(sw, i * 3.1 + k * 1.7)), M.hem);
      strips.push({ joint: sj, len: P.strips[k], rest: a, phase: (i * 1.7 + k * 2.3) % (Math.PI * 2) });
    }
    coat.push({ anchor, segs: [s0, s1], def: P, strips, len: [P.len[0], P.len[1] + sl + (n ? Math.max(...P.strips) * 0.8 : 0)], r0: R0 });
  });
  return { coat };
}

// ---------------------------------------------------------------- back: the torn half-cape
/** The cape, CAPE_SHEETS hung on the chest. Returns `streamers`: the two-segment springs the
 *  animator drives (anim.js _streamers reads each one's segs, len and out). */
function buildCape({ chest, M, mesh, joint }) {
  // the torn half-cape (the single-figure reference; ADR-036): long ragged ribbons from under the
  // pauldron, behind the sword arm, on the streamer springs (anim.js; `out` = each ribbon's own
  // outward flare). They overlap into one cloth at the shoulder blade and part toward their points,
  // the outer ones flaring furthest out to his right; coat-black at the root, lavender at the ends.
  const streamers = [];
  {
    CAPE_SHEETS.forEach((d, i) => {
      const base = joint(chest, ...d.at);
      base.rotation.y = d.ry; // local +Z = the sheet's outer face, +X = across it
      const s0 = joint(base);
      const g0 = partGeometry(`cape.${i}.a`);
      mesh(s0, g0, M.coat);
      mesh(s0, g0, M.lining);
      const s1 = joint(s0, 0, -d.len[0], 0);
      const g1 = partGeometry(`cape.${i}.b`);
      mesh(s1, g1, M.coat);
      mesh(s1, g1, M.lining);
      mesh(s1, partGeometry(`cape.${i}.c`), M.hem);
      streamers.push({ segs: [s0, s1], len: d.len, out: d.out });
    });
  }
  return { streamers };
}

// ---------------------------------------------------------------- weapon: the longsword
/** The sword's own numbers (sword space: origin = grip centre, blade along +Z), copied from DIM.
 *  The geometry below is built from these; the animator, the hit segment and the FX still read
 *  DIM (heroDims.js), so a different weapon needs them to read the equipped item's `dims` first
 *  (gear/README.md: next steps). */
const SWORD_DIMS = {
  gripBack: HERO_DIM.gripBack, guard: HERO_DIM.guard, gem: HERO_DIM.gem, forte: HERO_DIM.forte,
  steelTip: HERO_DIM.steelTip, drawnTip: HERO_DIM.drawnTip, bladeBase: HERO_DIM.bladeBase, bladeTip: HERO_DIM.bladeTip,
};

/** The longsword on the sword joint. Returns `gem`: the marker joint for the gem's glow sprite and
 *  glints (player.js). */
function buildSword({ sword, M, mesh, joint }) {
  const D = SWORD_DIMS;
  // origin at the grip centre, blade along +Z (width on X, flat faces ±Y). The reference's sword
  // (the owner's single-figure image): a broad blade at the guard tapering in one long straight line
  // to a sharp point; dark faceted steel between cyan edges with a bright centre ridge; a dark
  // gunmetal base with a hooked barb on each edge; a few lightning notches up the lower half; a guard
  // whose quillons sweep UP toward the blade into hooked points round a violet four-point star gem.
  {
    // the blade is sculpted (heroParts.js): a dark gunmetal forte, the barbed cyan-edged steel, the
    // arrowhead point; its two halves either side of the ridge carry ink sub-ids 0 / 1
    mesh(sword, partGeometry('blade.forte'), M.armor);
    mesh(sword, partGeometry('blade.core'), M.blade);
    mesh(sword, partGeometry('blade.edge'), M.bladeTip);
  }
  mesh(sword, limbGeometry({ length: 0.16, r0: 0.016, r1: 0.017, radial: 6, rings: 3 }), M.leather, 0, 0, -D.gripBack); // grip
  {
    // gunmetal: the guard block, its quillons swept up toward the blade into hooked points (a
    // crescent round the gem), a claw back toward the grip off each quillon root, a spur toward the
    // pommel, the kite pommel
    const gg = [
      ellipsoidGeometry(0.034, 0.02, 0.022, { widthSegs: 10, heightSegs: 6 }).translate(0, 0, D.guard + 0.004),
      kiteGeometry(0.022, 0.014, 0.05, { zNeg: 1.5 }).translate(0, 0, -0.135),
      spike(0.04, 0.012, [0, 0, D.guard - 0.008], [0, 0, -1], [1, 0, 0], 0, 4, 0.6),
    ];
    for (const s of [-1, 1]) {
      gg.push(spike(0.12, 0.018, [s * 0.026, 0, D.guard], [s, 0, 0.32], [0, 0, 1], 0.55, 5, 0.6));
      gg.push(spike(0.032, 0.007, [s * 0.11, 0, D.guard + 0.048], [-s * 0.4, 0, 0.9], [0, 0, 1], 0.1, 4));
      gg.push(spike(0.04, 0.01, [s * 0.04, 0, D.guard - 0.006], [s * 0.7, 0, -0.7], [0, 0, -1], 0.2, 4, 0.6));
    }
    mesh(sword, mergeGeometries(gg), M.armor);
    // silver: ferrules, the pommel collar, the four-point star setting behind the gem
    const sv = [
      ring(0.02, 0.02, 0.008, 8).rotateX(Math.PI / 2).translate(0, 0, D.guard - 0.014),
      ring(0.02, 0.02, 0.008, 8).rotateX(Math.PI / 2).translate(0, 0, -D.gripBack),
      ring(0.019, 0.019, 0.007, 8).rotateX(Math.PI / 2).translate(0, 0, -0.095),
      starGeometry(0.038, 0.054, 0.013, 0.027).translate(0, 0, D.gem),
    ];
    mesh(sword, mergeGeometries(sv), M.trim);
  }
  // the gem: a violet four-point star proud of both flats (its points along the blade and across
  // the quillons), on its silver setting; a marker joint for its glow sprite and glints
  mesh(sword, starGeometry(0.023, 0.033, 0.008, 0.031, 0.005), M.gem, 0, 0, D.gem);
  const gem = joint(sword, 0, 0, D.gem);
  return { gem };
}

/** The set, one item per slot (no `head` item: he wears no helmet). gear/index.js registers these
 *  and names them in DEFAULT_LOADOUT. */
export const WANDERER_ITEMS = [
  { id: 'wanderer.coat', slot: 'chest', name: "Wanderer's Greatcoat", build: buildCoat },
  { id: 'wanderer.pauldron', slot: 'shoulders', name: 'Spiked Pauldron', build: buildPauldron },
  { id: 'wanderer.arms', slot: 'arms', name: 'Vambrace and Bracer', build: buildArms },
  { id: 'wanderer.legs', slot: 'legs', name: 'Armoured Boots', build: buildLegs },
  { id: 'wanderer.skirt', slot: 'waist', name: 'Torn Coat Tails', build: buildSkirt },
  { id: 'wanderer.cape', slot: 'back', name: 'Torn Half-Cape', build: buildCape },
  { id: 'wanderer.sword', slot: 'weapon', name: 'Moonlit Longsword', dims: SWORD_DIMS, build: buildSword },
];
