import * as THREE from 'three';
import { limbGeometry, ellipsoidGeometry, hornGeometry, planarGUV } from '../../render/glyphGeometry.js';
import { HERO_PARTS } from './heroParts.js';

// Geometry builders for the hero. The body (model.js) and every gear item (gear/*.js) are made of
// these, so a new piece of armour is built from the same sheets, shells, limbs, plates and straps
// as today's outfit. Build-time only: they allocate, and nothing here runs per frame except
// sheetOffset (the animator calls it; it allocates nothing). Every geometry carries the hero's
// attributes: position, normal, aGUV, and aPart (the ink-line sub-id) where a builder sets one;
// the rig's mesh helper adds a zero aPart to the rest.

// Builder geometries run along native +Z with the aGUV seam on native −Y. Re-orient them so the
// seam ends up on the back/underside where the high camera rarely looks.
export const orient = {
  down(g) {
    g.rotateX(Math.PI / 2); // +Z → −Y, seam → −Z (build limbs with flip: aGUV +y then runs UP)
    return g;
  },
  up(g) {
    g.rotateX(-Math.PI / 2); // +Z → +Y (aGUV +y runs up)
    g.rotateY(Math.PI); // seam → −Z
    return g;
  },
};

/** Deterministic pseudo-random (the model must look the same every load). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A parametric sheet: fn(s, t, out) fills out = [x, y, z, guvX, guvY] for s, t in 0..1 over a
 * (cols × rows) grid. The front face is the side Ps × Pt points to (flip reverses it). `skip(i, j,
 * pos, a, b, c, d)` may drop a quad.
 */
export function gridGeometry(cols, rows, fn, flip = false, skip = null) {
  const nv = (cols + 1) * (rows + 1);
  const pos = new Float32Array(nv * 3), guv = new Float32Array(nv * 2);
  const o = [0, 0, 0, 0, 0];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      fn(i / cols, j / rows, o);
      const k = j * (cols + 1) + i;
      pos[k * 3] = o[0];
      pos[k * 3 + 1] = o[1];
      pos[k * 3 + 2] = o[2];
      guv[k * 2] = o[3];
      guv[k * 2 + 1] = o[4];
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      if (skip && skip(i, j, pos, a, b, c, d)) continue;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aGUV', new THREE.BufferAttribute(guv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Lofted body shell around +Y through elliptical rings {y, rx, rz, cz, gap}: `gap` = half the
 * chord left open at the front (the open coat), 0 = closed except a hairline at the front.
 * `span` limits it to the front ±span rad instead (the shirt). aGUV: x = angle × 0.15 (columns line
 * up down the body, like the panel), y = height, so glyphs stand upright.
 */
export function shellGeometry(rings, { sub = 2, cols = 24, span = 0 } = {}) {
  const rows = (rings.length - 1) * sub;
  return gridGeometry(cols, rows, (s, t, o) => {
    const f = t * (rings.length - 1);
    const k = Math.min(rings.length - 2, Math.floor(f));
    const u = f - k;
    const A = rings[k], B = rings[k + 1];
    const y = lerp(A.y, B.y, u), rx = lerp(A.rx, B.rx, u), rz = lerp(A.rz, B.rz, u);
    const cz = lerp(A.cz ?? 0, B.cz ?? 0, u), gap = lerp(A.gap ?? 0, B.gap ?? 0, u);
    let a;
    if (span > 0) {
      a = (s - 0.5) * 2 * span;
    } else {
      const a0 = Math.asin(Math.min(0.95, Math.max(0.004, gap) / rx));
      a = a0 + s * (Math.PI * 2 - 2 * a0);
    }
    o[0] = Math.sin(a) * rx;
    o[1] = y;
    o[2] = Math.cos(a) * rz + cz;
    o[3] = (a - Math.PI) * 0.15;
    o[4] = y;
  });
}

/** Where a coat sheet of width w is centred (along its tangent) when the width it gains below its
 *  panel's top width w0 goes to one side only (skew ±1; 0 = symmetric). Exported for the animator
 *  and the tests through COAT_PANELS' `skew` (they import it from model.js, which re-exports it). */
export function sheetOffset(w, w0, skew = 0) {
  return skew ? (skew * (w - w0)) / 2 : 0;
}

/** A coat-skirt sheet hanging −Y from its joint: width wTop → wBot over `len`, curved around the
 *  hips with a radius that grows down the panel (R0 + flare × depth) so neighbours form a cone.
 *  Local +Z = outward; the front face points out (the lining is the back face). */
export function skirtSheet(len, wTop, wBot, R0, flare = 0.3, jag = 0, seed = 1, fold = [0, 0, 0], t0 = 0, t1 = 1, skew = 0, w0 = wTop, slant = 0) {
  const r = rng(seed);
  const cols = 16, rows = Math.max(3, Math.round(8 * (t1 - t0)));
  const jitter = Array.from({ length: cols + 1 }, () => (r() - 0.5) * jag);
  // `fold` [amplitude at the top, at the bottom (m), waves across, phase]: the reference's coat
  // drapes in soft vertical folds that deepen toward the hem (a flat sheet read as a plank).
  // t0 … t1: build only that stretch of the sheet (the dark coat above, the lavender torn zone below)
  // skew: the width the sheet gains below its panel's top width w0 goes to its +X (> 0) or −X (< 0)
  // side, so the other edge hangs straight (|skew| 1: a front panel's opening) or drifts out a little
  // (|skew| > 1: a tail's vent edge, the vent opens downward) while this one flares out (sheetOffset)
  const ph = fold[3] ?? r() * Math.PI * 2;
  return gridGeometry(cols, rows, (s, tt, o) => {
    const t = lerp(t0, t1, tt);
    const w = lerp(wTop, wBot, t);
    const u = (s - 0.5) * w + sheetOffset(w, w0, skew);
    const R = R0 + flare * t * len;
    const a = u / R;
    // slant: the sheet runs this much longer at its outer edge (the side its skew flares to), so the
    // hem slopes down from the vent / front edge to the outer point
    const y = -t * (len + 0.02 + slant * (skew < 0 ? 1 - s : s)) + (tt === 1 && t1 === 1 ? jitter[Math.round(s * cols)] : 0);
    const f = lerp(fold[0], fold[1], t) * Math.sin(s * Math.PI * 2 * fold[2] + ph) * Math.sin(Math.PI * Math.min(1, s * 6) * 0.5) * Math.sin(Math.PI * Math.min(1, (1 - s) * 6) * 0.5);
    o[0] = Math.sin(a) * (R + f);
    o[1] = y;
    o[2] = (Math.cos(a) - 1) * R + Math.cos(a) * f;
    o[3] = u;
    o[4] = y;
  }, true);
}

/**
 * One torn strip hanging −Y from its joint: width w at the tear, tapering to a sharp claw point
 * that curls outward (+Z); `fork` splits the last half into two points; jagged notched edges.
 * `tip: false` = a plain rectangular strip (the root segment of a streamer). aGUV: x across, y up.
 */
export function tatterStrip(L, w, { fork = false, tip = true, curl = 0.25, seed = 1 } = {}) {
  const r = rng(seed);
  const rows = 8, cols = 4;
  const notch = Array.from({ length: rows + 1 }, () => (r() < 0.45 ? (0.4 + 0.6 * r()) * 0.016 : 0));
  const notchR = Array.from({ length: rows + 1 }, () => (r() < 0.45 ? (0.4 + 0.6 * r()) * 0.016 : 0));
  const skew = (r() - 0.5) * 0.06;
  const cl = curl * (0.7 + 0.6 * r());
  const tear = Array.from({ length: cols + 1 }, () => (r() - 0.5) * 0.025);
  return gridGeometry(cols, rows, (s, t, o) => {
    let e = 1;
    if (tip) e = fork ? 1 - 0.5 * Math.abs(4 * (s < 0.5 ? s : s - 0.5) - 1) : 1 - 0.55 * Math.abs(2 * s - 1);
    const tt = t * e;
    const width = w * (1 - 0.3 * tt);
    let x = (s - 0.5) * width + skew * tt * tt;
    const j = Math.round(t * rows), i = Math.round(s * cols);
    if (i === 0) x += notch[j];
    if (i === cols) x -= notchR[j];
    let y = -tt * L;
    const isTip = tip && (fork ? i === 1 || i === 3 : i === 2);
    if (j === rows && !isTip) y += tear[i];
    o[0] = x;
    o[1] = y;
    o[2] = cl * tt * tt * L;
    o[3] = x;
    o[4] = y;
  }, true);
}

/** A cylindrical plate arc around the local −Y axis (an arm / shin lame): angle centred on `ac`
 *  (rad from +Z toward +X; the outer side of a right arm is −π/2) spanning ±half, from y0 down to
 *  y1, radius r0 → r1. Outward-facing; aGUV y up. */
export function arcPlate(y0, y1, r0, r1, ac, half, cols = 6) {
  return gridGeometry(cols, 2, (s, t, o) => {
    const a = ac + (s - 0.5) * 2 * half;
    const r = lerp(r0, r1, t);
    const y = lerp(y0, y1, t);
    o[0] = Math.sin(a) * r;
    o[1] = y;
    o[2] = Math.cos(a) * r;
    o[3] = a * r;
    o[4] = y;
  }, true);
}

/** A straight flat strap (box) from point a to point b (parent space), `w` wide across `side`
 *  (any vector roughly across the strap), `th` thick. aGUV: x across, y along (up toward a). */
export function strapGeometry(a, b, w, th, side) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(w, len, th, 1, Math.max(1, Math.round(len / 0.05)), 1);
  planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const ay = A.clone().sub(B).normalize();
  const ax = new THREE.Vector3(...side);
  ax.addScaledVector(ay, -ax.dot(ay)).normalize();
  const az = new THREE.Vector3().crossVectors(ax, ay);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(A.clone().add(B).multiplyScalar(0.5)));
  return g;
}

/** A small box (buckle, ferrule, heel) with planar aGUV. */
export function boxGeometry(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  return place(g, x, y, z, rx, ry, rz);
}

/** A faceted rhombus / kite (octahedron) with half-extents (x, y, z); `zNeg` stretches the −Z
 *  half (the kite pommel), `yPos` the +Y half (the knee guard's top point). Flat facets. */
export function kiteGeometry(x, y, z, { zNeg = 1, yPos = 1, guv = 'xy' } = {}) {
  const g = new THREE.OctahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vz = p.getZ(i), vy = p.getY(i);
    p.setXYZ(i, p.getX(i) * x, vy * y * (vy > 0 ? yPos : 1), vz * z * (vz < 0 ? zNeg : 1));
  }
  g.computeVertexNormals();
  return guv === 'xz'
    ? planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1))
    : planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
}

/** Piping down one edge of a skirtSheet (side +1: its +X edge, −1: its −X edge), from its top to t1
 *  of its length: a 7 mm ribbon 2 mm proud of the sheet, on the sheet's own curve (its folds are 0
 *  at the edges). The open coat's front edges and the back vent's edges (the reference draws bright
 *  lines down the inner edges of the tails). */
export function sheetEdge(len, wTop, wBot, R0, side, t1 = 1, flare = 0.25, skew = 0, w0 = wTop) {
  return gridGeometry(1, Math.max(2, Math.round(6 * t1)), (s, tt, o) => {
    const t = tt * t1;
    const w = lerp(wTop, wBot, t);
    const u = side * (w * 0.5 - 0.0035) + (s - 0.5) * 0.007 + sheetOffset(w, w0, skew);
    const R = R0 + flare * t * len;
    const a = u / R;
    const y = -t * (len + 0.02);
    o[0] = Math.sin(a) * (R + 0.002);
    o[1] = y;
    o[2] = (Math.cos(a) - 1) * R + Math.cos(a) * 0.002;
    o[3] = u;
    o[4] = y;
  }, true);
}

/** A four-point star in the XZ plane (points at ±rx on X and ±rz on Z, concave waists `waist` from
 *  the centre between them), `th` thick along Y, its faces rising `peak` to the centre so it catches
 *  light: the sword's gem and its setting (the blade's flats face ±Y). */
export function starGeometry(rx, rz, waist, th, peak = 0) {
  const tips = [[rx, 0], [0, rz], [-rx, 0], [0, -rz]];
  const rim = [];
  for (let k = 0; k < 4; k++) {
    const A = tips[k], B = tips[(k + 1) % 4];
    rim.push(A);
    const ang = Math.atan2(A[1] + B[1], A[0] + B[0]);
    rim.push([Math.cos(ang) * waist, Math.sin(ang) * waist]);
  }
  const pos = [], n = rim.length, h = th / 2;
  for (let i = 0; i < n; i++) {
    const p = rim[i], q = rim[(i + 1) % n];
    pos.push(0, h + peak, 0, q[0], h, q[1], p[0], h, p[1]); // the +Y face (fan from the raised centre)
    pos.push(0, -h - peak, 0, p[0], -h, p[1], q[0], -h, q[1]); // the −Y face
    pos.push(p[0], h, p[1], q[0], h, q[1], q[0], -h, q[1]); // the side wall
    pos.push(p[0], h, p[1], q[0], -h, q[1], p[0], -h, p[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
}

/** Concatenate indexed/non-indexed geometries that carry position, normal and aGUV (and aPart, the
 *  ink-line sub-id: 0 where a geometry has none). */
export function mergeGeometries(list) {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), guv = new Float32Array(nv * 2), part = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.aGUV, k = g.attributes.aPart;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      guv[(vo + i) * 2] = u.getX(i);
      guv[(vo + i) * 2 + 1] = u.getY(i);
      part[vo + i] = k ? k.getX(i) : 0;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aGUV', new THREE.BufferAttribute(guv, 2));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Ink-line sub-id (0 / 1) of a geometry: the art pass draws a line between neighbouring pieces of
 * one material whose sub-ids differ (coat panels, torn strips, hair locks, armour lames), on top of
 * the per-material part ids (HERO_ART in materials.js). Returns g.
 */
export function sub(g, k) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(k ? 1 : 0), 1));
  return g;
}

/**
 * A sculpted part from heroParts.js (modelled in Blender by scripts/blender/hero_parts.py, ADR-037)
 * as a geometry with the hero's attributes (position, normal, aGUV, aPart). The key names the part
 * only: the caller picks the joint it hangs on and its material.
 */
export function partGeometry(key) {
  const P = HERO_PARTS[key];
  if (!P) throw new Error(`hero part "${key}" is not in heroParts.js (run scripts/blender/build-hero-parts.mjs)`);
  const bytes = (s) => {
    const b = atob(s), a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  };
  const scaled = (a, k) => {
    const f = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) f[i] = a[i] * k;
    return f;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(scaled(new Int16Array(bytes(P.p).buffer), 1 / 8192), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(scaled(new Int8Array(bytes(P.nrm).buffer), 1 / 127), 3));
  g.setAttribute('aGUV', new THREE.BufferAttribute(scaled(new Int16Array(bytes(P.uv).buffer), 1 / 8192), 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(scaled(bytes(P.k), 1 / 200), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes(P.i).buffer), 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Drawn fold lines. The hero's ink pass draws a line wherever a mesh's sub-id (aPart, rounded per
 * pixel) changes, so a smooth 0..1 field over ONE sheet prints its 0.5-contour as a hand-drawn
 * crease, and the material's `sub` shade (HERO_INK) darkens the side above 0.5: lit ridge → ink
 * line → shadowed valley. fn(x, y, z, guvX, guvY) → the field; capped at 0.9 so a plain sub(g, 1)
 * piece (exactly 1) stays an unshaded "line only" piece. Returns g.
 */
export function foldLines(g, fn) {
  const p = g.attributes.position, uv = g.attributes.aGUV, n = p.count;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = fn(p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i));
    a[i] = Number.isFinite(f) ? Math.min(0.9, Math.max(0, f)) : 0;
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
  return g;
}
/** foldLines field for a torn strip / ribbon `w` wide (x across, y down its length): one crease
 *  wandering down it. */
export const ribbonCrease = (w, ph) => (x, y) => 0.5 + 0.7 * Math.sin((x / w) * 5.5 + y * 7 + ph);

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** A tapered spike from `base` along `dir`, its tip curling toward `bend`. Parent space. aGUV +y
 *  runs toward the tip, so the 'A' / '^' glyphs point along it. `flat` < 1 flattens it into a
 *  blade (thin across the bend plane). */
export function spike(len, r, base, dir, bend, curl = 0.22, radial = 5, flat = 1) {
  const g = hornGeometry(len, r, { radial, curve: curl });
  if (flat !== 1) g.scale(flat, 1, 1);
  orientTo(g, base, dir, bend);
  if (flat !== 1) g.computeVertexNormals();
  return g;
}

/** Re-orient a geometry built along local +Z (its curl toward local +Y, its width along local X)
 *  so +Z runs along `dir` from `base` and +Y leans toward `bend`. Parent space. */
export function orientTo(g, base, dir, bend) {
  _bz.set(dir[0], dir[1], dir[2]).normalize();
  _by.set(bend[0], bend[1], bend[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-6) _by.set(0, -1, 0).addScaledVector(_bz, _bz.y);
  if (_by.lengthSq() < 1e-6) _by.set(1, 0, 0).addScaledVector(_bz, _bz.x);
  _by.normalize();
  _bx.crossVectors(_by, _bz);
  _m.makeBasis(_bx, _by, _bz).setPosition(base[0], base[1], base[2]);
  return g.applyMatrix4(_m);
}

/**
 * A flattened tapered clump / blade along local +Z (length L): half-width `w` along X, half-
 * thickness `th` along Y, tapering to a point (`taper` < 1 keeps it full longer), the tip curling
 * toward +Y by `curl` × L. Only the stretch t0 … t1 of its length is built, so one clump can be
 * split between two materials (dark roots, sheened tips). aGUV: x around, y toward the tip (the
 * 'A' / '^' carets point along it). Use orientTo() to place it.
 */
export function clumpGeometry(L, w, th, { t0 = 0, t1 = 1, curl = 0.2, taper = 1, cols = 6, rows = 3 } = {}) {
  return gridGeometry(cols, rows, (s, tt, o) => {
    const t = lerp(t0, t1, tt);
    const k = Math.pow(Math.max(0, 1 - t), taper);
    const a = s * Math.PI * 2;
    o[0] = Math.cos(a) * w * k;
    o[1] = Math.sin(a) * th * k + curl * L * t * t;
    o[2] = t * L;
    o[3] = (a - Math.PI) * Math.max(w, 0.02);
    o[4] = t * L;
  });
}

/** A straight-sided elliptical band around local Y (a belt): radii rx / rz, height h, centred on
 *  y = 0. Outward-facing; aGUV x around, y up. */
export function bandGeometry(rx, rz, h, segs = 24) {
  return gridGeometry(segs, 1, (s, t, o) => {
    const a = s * Math.PI * 2;
    o[0] = Math.sin(a) * rx;
    o[1] = (t - 0.5) * h;
    o[2] = Math.cos(a) * rz;
    o[3] = (a - Math.PI) * (rx + rz) * 0.5;
    o[4] = o[1];
  });
}

/** A geometry rotated (X, then Y, then Z) and moved in place. */
export function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** A flat ellipsoid disc around local +Y (a ferrule, a D-ring): radii rx / rz, half-height h. */
export const ring = (rx, rz, h, segs = 16) => orient.up(ellipsoidGeometry(rx, rz, h, { widthSegs: segs, heightSegs: 4 }));

/** A limb hanging −Y from its joint (limbGeometry options: length, r0 at the joint, r1 at the far
 *  end, bulge, radial, rings, capSegs), its aGUV +y running UP so the glyphs stand upright. */
export const limb = (o) => orient.down(limbGeometry({ flip: true, ...o }));

/** A flattened wedge (pauldron / elbow / knee points): base 2w wide, from `base` along `dir`,
 *  curving toward `bend`. Parent space. */
export const wedge = (L, w, base, dir, bend, curl = 0.17) => orientTo(clumpGeometry(L, w, 0.006, { curl, taper: 1, cols: 8, rows: 3 }), base, dir, bend);
