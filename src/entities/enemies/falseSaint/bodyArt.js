import * as THREE from 'three';
import { mergeGeometries } from '../../player/heroGeo.js';

// The False Saint's print helpers (the BODY AGENT's file): how ONE rig carries two layers, the disguise
// (skin, hair, the jacket, the trousers) over the frame (titanium and smoked ceramic plates, woven
// microfilament), and how the disguise breaks away piece by piece (the reference's four milestones; BRIEF
// "The body"; ADR-286). Build-time only except `FS_ART` (data). Deterministic: no Math.random anywhere
// (three's uuids aside: the gear builds on a quiet stream, gear.js `quiet`).
//
//   shatter(g, keyOf)          a geometry's triangles split by `keyOf(cx, cy, cz)` of each triangle's
//                              centroid → Map key → geometry (indexed, compacted; null keys dropped)
//   walls(g, keyOf, depth)     the laminate's edge: along every edge between two shards a strip `depth`
//                              deep under the surface, facing the neighbour (hidden while the neighbour is
//                              there, a pale rim once it has gone) → Map key → geometry
//   cells(g, n, from)          n shard seeds spread over a geometry's surface (farthest-point, starting at
//                              the triangle nearest `from`)
//   nearestCell(seeds, amp)    keyOf for shatter: the nearest seed by a jagged distance (a fixed noise)
//   facet(g)                   flat facets (the frame's faceted plates): non-indexed, face normals
//   inset(g, d)                every vertex moved d along its normal (negative: inward)
//   FS_ART                     his materials' use, colours and the part inks look.js writes

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _r = new THREE.Vector3();

/** A fixed jagged noise in [-1, 1] (smooth over a few cm; no random). */
export function jag(x, y, z) {
  return (
    0.55 * Math.sin(x * 47.3 + Math.sin(y * 31.1 + z * 13.7) * 1.9) * Math.sin(z * 39.7 + y * 21.3 + 1.3) +
    0.45 * Math.sin(y * 83.1 + x * 29.9 + Math.sin(z * 61.7) * 1.4)
  );
}

/** Triangle t's vertex indices (indexed or not) into out[0..2]. */
function tri(g, t, out) {
  const ix = g.index;
  if (ix) {
    out[0] = ix.getX(t * 3);
    out[1] = ix.getX(t * 3 + 1);
    out[2] = ix.getX(t * 3 + 2);
  } else {
    out[0] = t * 3;
    out[1] = t * 3 + 1;
    out[2] = t * 3 + 2;
  }
  return out;
}
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** The centroid of triangle t into v. */
function centroid(g, t, v, I = [0, 0, 0]) {
  const P = g.attributes.position;
  tri(g, t, I);
  v.set(0, 0, 0);
  for (let k = 0; k < 3; k++) v.x += P.getX(I[k]), v.y += P.getY(I[k]), v.z += P.getZ(I[k]);
  return v.multiplyScalar(1 / 3);
}

/** The triangles' keys (keyOf on each centroid). */
function keysOf(g, keyOf) {
  const n = triCount(g), K = new Array(n), I = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    centroid(g, t, _p, I);
    K[t] = keyOf(_p.x, _p.y, _p.z, t);
  }
  return K;
}

/** A geometry of the listed triangles of g (indexed, its vertices compacted; every attribute kept). */
function pick(g, tris) {
  const names = Object.keys(g.attributes);
  const map = new Map();
  const idx = [];
  const I = [0, 0, 0];
  for (const t of tris) {
    tri(g, t, I);
    for (let k = 0; k < 3; k++) {
      let j = map.get(I[k]);
      if (j === undefined) map.set(I[k], (j = map.size));
      idx.push(j);
    }
  }
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const A = g.attributes[nm], s = A.itemSize, src = A.array, dst = new Float32Array(map.size * s);
    for (const [from, to] of map) for (let c = 0; c < s; c++) dst[to * s + c] = src[from * s + c];
    out.setAttribute(nm, new THREE.BufferAttribute(dst, s));
  }
  out.setIndex(map.size > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Split g's triangles by keyOf(cx, cy, cz, t) → Map key → geometry. A null / undefined key drops it. */
export function shatter(g, keyOf) {
  const K = keysOf(g, keyOf);
  const by = new Map();
  K.forEach((k, t) => {
    if (k === null || k === undefined) return;
    let L = by.get(k);
    if (!L) by.set(k, (L = []));
    L.push(t);
  });
  const out = new Map();
  for (const [k, L] of by) out.set(k, pick(g, L));
  return out;
}

const pkey = (P, i) => `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`;

/**
 * The laminate's edge: for every edge two triangles of different shards share (welded by position), a
 * strip from the surface `depth` in along the vertex normals, on each side, facing the other shard. While
 * the neighbour is there the strip is under its surface (unseen); once it is gone it is the pale rim.
 * Returns Map key → geometry (position, normal, aGUV, aPart 1). Open borders (a cuff, a hem) get none.
 */
export function walls(g, keyOf, depth = 0.012, keys = null) {
  const K = keys ?? keysOf(g, keyOf);
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.aGUV;
  const n = K.length, I = [0, 0, 0];
  const edges = new Map();
  for (let t = 0; t < n; t++) {
    if (K[t] === null || K[t] === undefined) continue;
    tri(g, t, I);
    for (let e = 0; e < 3; e++) {
      const a = I[e], b = I[(e + 1) % 3];
      const ka = pkey(P, a), kb = pkey(P, b);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let L = edges.get(id);
      if (!L) edges.set(id, (L = []));
      L.push({ t, a, b });
    }
  }
  const acc = new Map(); // key → { pos: [], nor: [], uv: [] }
  const ctA = new THREE.Vector3(), ctB = new THREE.Vector3();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), A2 = new THREE.Vector3(), B2 = new THREE.Vector3();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), fn = new THREE.Vector3(), dir = new THREE.Vector3();
  for (const L of edges.values()) {
    if (L.length !== 2 || K[L[0].t] === K[L[1].t]) continue;
    for (let s = 0; s < 2; s++) {
      const me = L[s], other = L[1 - s];
      const k = K[me.t];
      centroid(g, me.t, ctA);
      centroid(g, other.t, ctB);
      A.fromBufferAttribute(P, me.a);
      B.fromBufferAttribute(P, me.b);
      nA.fromBufferAttribute(N, me.a).normalize();
      nB.fromBufferAttribute(N, me.b).normalize();
      A2.copy(A).addScaledVector(nA, -depth);
      B2.copy(B).addScaledVector(nB, -depth);
      // the strip faces the neighbour
      dir.subVectors(ctB, ctA);
      _q.subVectors(B, A);
      _r.subVectors(A2, A);
      fn.crossVectors(_q, _r).normalize();
      let flip = fn.dot(dir) < 0;
      if (flip) fn.negate();
      let R = acc.get(k);
      if (!R) acc.set(k, (R = { pos: [], nor: [], uv: [] }));
      const ua = UV ? UV.getX(me.a) : 0, ub = UV ? UV.getX(me.b) : 0, va = UV ? UV.getY(me.a) : 0, vb = UV ? UV.getY(me.b) : 0;
      const quad = flip ? [[A, ua, va], [B2, ub, vb - depth], [B, ub, vb], [A, ua, va], [A2, ua, va - depth], [B2, ub, vb - depth]] : [[A, ua, va], [B, ub, vb], [B2, ub, vb - depth], [A, ua, va], [B2, ub, vb - depth], [A2, ua, va - depth]];
      for (const [v, u, w] of quad) {
        R.pos.push(v.x, v.y, v.z);
        R.nor.push(fn.x, fn.y, fn.z);
        R.uv.push(u, w);
      }
    }
  }
  const out = new Map();
  for (const [k, R] of acc) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(R.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(R.nor, 3));
    geo.setAttribute('aGUV', new THREE.Float32BufferAttribute(R.uv, 2));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(R.pos.length / 3).fill(1), 1));
    geo.computeBoundingSphere();
    out.set(k, geo);
  }
  return out;
}

/** n seeds spread over g's surface: farthest-point sampling over its triangle centroids, starting at
 *  the one nearest `from` ([x, y, z]). Returns [[x, y, z], ...] (the first is the nearest to `from`). */
export function cells(g, n, from = [0, 0, 0]) {
  const m = triCount(g), C = new Float32Array(m * 3), I = [0, 0, 0];
  let best = 0, bd = Infinity;
  for (let t = 0; t < m; t++) {
    centroid(g, t, _p, I);
    C[t * 3] = _p.x;
    C[t * 3 + 1] = _p.y;
    C[t * 3 + 2] = _p.z;
    const dd = (_p.x - from[0]) ** 2 + (_p.y - from[1]) ** 2 + (_p.z - from[2]) ** 2;
    if (dd < bd) (bd = dd), (best = t);
  }
  const seeds = [[C[best * 3], C[best * 3 + 1], C[best * 3 + 2]]];
  const dmin = new Float32Array(m).fill(Infinity);
  for (let s = 1; s < n; s++) {
    const [sx, sy, sz] = seeds[s - 1];
    let far = -1, fd = -1;
    for (let t = 0; t < m; t++) {
      const dd = (C[t * 3] - sx) ** 2 + (C[t * 3 + 1] - sy) ** 2 + (C[t * 3 + 2] - sz) ** 2;
      if (dd < dmin[t]) dmin[t] = dd;
      if (dmin[t] > fd) (fd = dmin[t]), (far = t);
    }
    if (far < 0 || fd < 1e-8) break;
    seeds.push([C[far * 3], C[far * 3 + 1], C[far * 3 + 2]]);
  }
  return seeds;
}

/** keyOf for shatter: the index of the nearest seed by a jagged distance (× 1 ± amp of a fixed noise). */
export function nearestCell(seeds, amp = 0.35, freq = 1) {
  return (x, y, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      // (each seed its own noise, so the edge between any two cells wanders: a torn line, not a straight one)
      const k = 1 + amp * jag(x * freq + i * 1.73, y * freq - i * 2.31, z * freq + i * 0.97);
      const dd = Math.hypot(x - s[0], y - s[1], z - s[2]) * k;
      if (dd < bd) (bd = dd), (best = i);
    }
    return best;
  };
}

/** Flat facets: the geometry non-indexed with face normals (the frame's faceted titanium). */
export function facet(g) {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  if (!out.attributes.aPart) out.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count), 1));
  return out;
}

/** Every vertex moved `d` along its normal (negative: in). Returns g. */
export function inset(g, d) {
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) + N.getX(i) * d, P.getY(i) + N.getY(i) * d, P.getZ(i) + N.getZ(i) * d);
  P.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** mergeGeometries that tolerates an empty list (null) and geometries without aGUV / aPart. */
export function merge(list) {
  const L = list.filter(Boolean);
  if (!L.length) return null;
  for (const g of L) {
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.aGUV) g.setAttribute('aGUV', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.aPart) g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n), 1));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aGUV', 'aPart'].includes(k)) g.deleteAttribute(k);
  }
  return mergeGeometries(L);
}

// ---------------------------------------------------------------- his materials and colours
/**
 * Which of the hero's material instances (his own: model.js createHeroMaterials) carries what on him, its
 * fill (linear; under the boss print a cloth / plate fill gives its hue and, by its brightness, how lit
 * the letters are: ADR-194), and the per-material extras tintSaint writes.
 *   skin     olive synthetic skin: the face, the hands (part 1, keeps its own fill)
 *   eye      his brown eyes (phase 1) and the frame's black sensor slot (part 2, its own dark fill)
 *   shirt    the pale stone-grey shirt at his neck (3)
 *   lining   the woven microfilament between the plates (4; FrontSide on him)
 *   collarIn the jacket skirt's inner face (4, BackSide: panelSkirt's lining)
 *   pants    the black trousers, and the woven calf under them (5: no pale hem below the knee)
 *   coat / collar   the charcoal jacket (6)
 *   facing   the porcelain-polymer laminate: every torn edge's rim, the last skin flakes (7)
 *   piping   the pale seam over both shoulders and down the sleeves (9)
 *   hair / hairTip  short black hair (11)
 *   armor    matte titanium: the frame's plates, the metal hands, the calf thrusters (12: no hem)
 *   spike    smoked ceramic: the cranium, the abdominal plates, the shoulder petals (13)
 *   bevel    the bright titanium of the nested gimbal joints (14)
 *   welt     the black boots (15: no hem)
 *   trim     the weapons' metal: nozzles, the gun, the mortar tubes, the missile cells (16)
 *   gem      the ivory core slit and the palm's iris (18: glows with d.fsCoreK / d.fsPalmK)
 *   flask    the three pale-cyan sensors (19: glows)
 */
export const FS_ART = Object.freeze({
  fill: Object.freeze({
    // (v04, anchor.png: the skin OLIVE (less red, more yellow-green than the stand-in's tan), the jacket charcoal
    // and matte, the titanium brighter and cooler than the cloth it comes out of, the laminate's rims pale)
    skin: [0.66, 0.55, 0.34], eye: [0.05, 0.035, 0.028], shirt: [0.5, 0.49, 0.45], lining: [0.05, 0.052, 0.06], collarIn: [0.05, 0.05, 0.055],
    pants: [0.03, 0.031, 0.034], coat: [0.065, 0.066, 0.07], collar: [0.065, 0.066, 0.07], facing: [0.88, 0.82, 0.72], piping: [0.66, 0.64, 0.6],
    hair: [0.012, 0.012, 0.015], hairTip: [0.04, 0.04, 0.048], armor: [0.8, 0.86, 0.96], spike: [0.44, 0.46, 0.53], bevel: [0.92, 0.96, 1.02],
    welt: [0.03, 0.03, 0.034], trim: [0.42, 0.43, 0.46], gem: [0.95, 0.9, 0.76], flask: [0.45, 0.95, 1.1],
  }),
  /** the screen-left rim of light (× the material's own) */
  rim: Object.freeze({ coat: 0.55, collar: 0.55, pants: 0.45, welt: 0.6, hair: 0.4, hairTip: 0.5, armor: 1.25, spike: 0.9 }),
  /** a plate's spec [k, pow] (the white glints on titanium) */
  spec: Object.freeze({ armor: [2.0, 30], spike: [1.1, 26], bevel: [1.6, 24], trim: [1.3, 22], welt: [0.5, 24] }),
  /** glowing parts: [ink rgb, emissive rgb] */
  glow: Object.freeze({ flask: [[0.46, 0.86, 1.0], [0.15, 0.48, 0.62]], gem: [[1.2, 1.1, 0.9], [1.4, 1.25, 0.95]] }),
  /** the part tables his rig shares with every boss rig on the page (written every frame by look.js; the
   *  plates' 12 - 16 are read from the player's own tables under the boss print, so they are not here):
   *  { ink, rim, fill: [fill gain, style, far line, far fill] } (model.js heroPartValues) */
  ink: Object.freeze({
    // the cloth (the trousers 5, the jacket 6): dimmer letters than the hero's lit cloth, so the frame's
    // titanium (12 - 16: the player's tables, full gain) reads brighter than the jacket it comes out of
    5: { ink: [1, 1, 1, 0.34], rim: [0.56, 0.58, 0.7, 0.7], fill: [0.52, 8, 0, 0.5] },
    6: { ink: [1, 1, 1, 0.38], rim: [0.56, 0.58, 0.7, 0.7], fill: [0.52, 8, 0, 0.54] },
    2: { ink: [0.2, 0.2, 0.22, 0.7], rim: [0.3, 0.3, 0.34, 0.8], fill: [1, 0, 0, 1] },
    7: { ink: [1.0, 0.94, 0.84, 1.0], rim: [1.0, 0.95, 0.86, 1.0], fill: [1.5, 0, 0.8, 1.25] },
    9: { ink: [0.95, 0.93, 0.88, 0.9], rim: [0.95, 0.93, 0.88, 0.9], fill: [1.2, 0, 0.6, 1.0] },
    11: { ink: [0.3, 0.3, 0.33, 0.7], rim: [0.46, 0.47, 0.52, 0.8], fill: [1.0, 8, 0.3, 0.8] },
    18: { ink: [1.2, 1.1, 0.9, 1.3], rim: [1.2, 1.1, 0.9, 1.3], fill: [1, 2, 1, 1.3] },
    19: { ink: [0.55, 0.95, 1.1, 1.0], rim: [0.55, 0.95, 1.1, 1.0], fill: [1, 2, 1, 1.1] },
  }),
});
