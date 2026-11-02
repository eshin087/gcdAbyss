import * as THREE from 'three';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry, planarGUV, cylindricalGUV } from '../../render/glyphGeometry.js';

// The Wanderer, "Shadow Swordsman" (owner concept sheet): an anime black-coat swordsman (~1.75 m)
// with messy violet-sheened hair, a high collar, a long black coat whose tails are torn into
// jagged purple-edged strips, a spiked dark-metal pauldron on the sword shoulder, armoured
// forearms / gauntlets / knee guards, belts and thigh straps, and one huge longsword: dark steel,
// a spiked crossguard with a glowing violet gem, icy cyan glowing edges.
//
// A joint hierarchy with surface-glyph meshes hung on it. Faces +Z, Y up, the character's RIGHT
// is −X. Hands and feet are placed by IK (anim.js); the joints here only define bone lengths and
// rest offsets.
//
//   root (yaw) → body (waist pivot: rolls / falls) → pelvis → spine → chest → head → hair clusters
//                                                        │                 ├ arms (upper → fore)
//                                                        │                 └ pauldron (follows the right arm)
//                                                        ├ legs (thigh → shin → foot)
//                                                        └ coat panels (anchor → upper → torn strips)
//   body → sword (posed directly in body space; origin = grip, blade along +Z)
//
// Readability (STYLE.md v0.3): light-grey glyphs on near-black gaps + the moonlit outline carry the
// figure; the cyan blade and the violet gem are the only saturated lights.

export const DIM = {
  pivot: 1.04, // body pivot height when standing
  pelvis: [0, -0.1, 0],
  hip: [0.09, -0.05, 0],
  spine: [0, 0.08, 0],
  chest: [0, 0.19, 0],
  shoulder: [0.19, 0.22, 0],
  neck: [0, 0.3, 0],
  upperArm: 0.28,
  foreArm: 0.27, // elbow → grip centre
  thigh: 0.43,
  shin: 0.42,
  ankle: 0.07, // ankle height with the foot flat on the ground
  coatY: 0.06, // belt / coat-skirt anchor height above the pelvis joint
  coatR: 0.155, // skirt anchor radius around the waist
  // the sword (sword space: origin = grip centre, blade along +Z)
  gripBack: 0.13, // grip runs from −gripBack …
  guard: 0.1, // … to the crossguard
  gem: 0.12, // the violet gem in the guard housing
  bladeBase: 0.16, // hit segment along +Z (hilt side) …
  bladeTip: 1.5, // … to the point (the visible blade is 1.34 m)
};

/** Long coat tails: 6 panels (az: 0 = front, + = the hero's left), open at the front so the legs
 *  show. The upper segment is solid coat; the lower one is torn into `strips` jagged tails of
 *  varying length (`cut`: per-strip length factors) with deep-purple edges. Back panels are the
 *  longest (ankle), front ones stop below the knee. */
export const COAT_PANELS = [
  { az: 0.8, w0: 0.15, w1: 0.2, len: [0.27, 0.3], cut: [1, 0.72] }, // front-left
  { az: -0.8, w0: 0.15, w1: 0.2, len: [0.27, 0.3], cut: [0.7, 1] }, // front-right
  { az: 1.63, w0: 0.2, w1: 0.27, len: [0.3, 0.38], cut: [0.8, 1, 0.66] }, // left
  { az: -1.63, w0: 0.2, w1: 0.27, len: [0.3, 0.38], cut: [0.66, 1, 0.82] }, // right
  { az: 2.56, w0: 0.21, w1: 0.3, len: [0.31, 0.44], cut: [1, 0.74, 0.92] }, // back-left
  { az: -2.56, w0: 0.21, w1: 0.3, len: [0.31, 0.44], cut: [0.9, 0.7, 1] }, // back-right
];

/** Hair clusters: each is one merged mesh on a spring joint (pivot in head space). `tip` is the
 *  mean spike direction, used by the animator to turn wind / inertia into a lagging sway. */
export const HAIR_CLUSTERS = [
  { name: 'fringe', pivot: [0, 0.2, 0.07], tip: [0, -0.75, 0.66] },
  { name: 'left', pivot: [0.085, 0.18, -0.01], tip: [0.72, -0.45, -0.52] },
  { name: 'right', pivot: [-0.085, 0.18, -0.01], tip: [-0.72, -0.45, -0.52] },
  { name: 'crown', pivot: [0, 0.22, -0.05], tip: [0, 0.18, -0.98] },
];

// Builder geometries run along native +Z with the aGUV seam on native −Y. Re-orient them so the
// seam ends up on the back/underside where the high camera rarely looks.
const orient = {
  down(g) {
    g.rotateX(Math.PI / 2); // +Z → −Y, seam → −Z
    return g;
  },
  up(g) {
    g.rotateX(-Math.PI / 2); // +Z → +Y (aGUV +y runs up: coat folds read as vertical strokes)
    g.rotateY(Math.PI); // seam → −Z
    return g;
  },
};

/** Deterministic pseudo-random (the model must look the same every load). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One coat panel segment hanging down −Y from its joint, curved around the waist (radius R,
 *  local +Z = outward). Slightly overlong so bent segments don't open gaps. aGUV +y runs up the
 *  coat so the cloth reads as vertical fold strokes. */
function coatPanel(len, w0, w1, R, thick = 0.022) {
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 3, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = 0.5 - pos.getY(i); // 0 top → 1 bottom
    const w = w0 + (w1 - w0) * t;
    const a = (pos.getX(i) * w) / R;
    const r = R + pos.getZ(i) * thick;
    pos.setXYZ(i, Math.sin(a) * r, -t * (len + 0.03), Math.cos(a) * r - R);
  }
  g.computeVertexNormals();
  return planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
}

/** The torn lower coat: `cut.length` strips side by side across width w0 → w1, each tapering to
 *  a ragged point at cut[i] × len, with a little twist so the tails don't read as one sheet. */
function tatteredPanel(len, w0, w1, R, cut, seed) {
  const r = rng(seed);
  const n = cut.length;
  const parts = [];
  for (let s = 0; s < n; s++) {
    const L = len * cut[s];
    const tip = 0.3 + 0.2 * r(); // fraction of the strip that tapers to the point
    const skew = (r() - 0.5) * 0.5; // the point leans sideways a little
    const g = new THREE.BoxGeometry(1, 1, 1, 2, 5, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = 0.5 - pos.getY(i); // 0 top → 1 bottom
      const w = (w0 + (w1 - w0) * t * cut[s]) / n;
      const taper = t < 1 - tip ? 1 : Math.max(0.04, (1 - t) / tip);
      const u = pos.getX(i) * taper + skew * (1 - taper); // −0.5 … 0.5 across this strip
      const cx = ((s + 0.5) / n - 0.5) * (w0 + (w1 - w0) * t * cut[s]); // strip centre across the panel
      const a = (cx + u * w * 0.94) / R;
      const rr = R + pos.getZ(i) * 0.02 + t * 0.012 * (s % 2 ? 1 : -1);
      pos.setXYZ(i, Math.sin(a) * rr, -t * (L + 0.02), Math.cos(a) * rr - R);
    }
    g.computeVertexNormals();
    parts.push(planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
  }
  return mergeGeometries(parts);
}

/** Open tube along +Y from radius r0 (y = 0) to r1 (y = len), with an optional gap of `open`
 *  radians centred on +Z (the coat collar is open at the throat). aGUV: x around, y up. */
function collarGeometry(len, r0, r1, open = 0, radial = 14) {
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 2, true, open / 2, Math.PI * 2 - open);
  g.translate(0, len / 2, 0);
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    arr[i * 2] = Math.atan2(x, z) * Math.max(0.05, Math.hypot(x, z));
    arr[i * 2 + 1] = y;
  }
  g.setAttribute('aGUV', new THREE.BufferAttribute(arr, 2));
  return g;
}

/**
 * The blade: a flattened diamond prism along +Z (width on X, flat faces ±Y) that holds its width
 * and tapers to a point over the last `tipFrac`. aGUV x is normalised to the local width so each
 * half of the blade is exactly one glyph column (two cold strokes = the two glowing edges), with
 * cell seams on the edges and the centre ridge.
 */
function bladeGeometry(len, hw0, hw1, tipFrac, th, cellW) {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 16);
  const pos = g.attributes.position;
  const guv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i), t = pos.getZ(i) + 0.5;
    const body = 1 - tipFrac;
    const hw = t < body ? hw0 + (hw1 - hw0) * (t / body) : hw1 * Math.max(0, 1 - (t - body) / tipFrac);
    const thick = th * (1 - Math.abs(u) * 1.7) * Math.sqrt(Math.max(0.05, hw / hw0));
    pos.setXYZ(i, u * 2 * hw, v * 2 * Math.max(0.002, thick), t * len);
    guv[i * 2] = u * 2 * cellW;
    guv[i * 2 + 1] = t * len;
  }
  g.computeVertexNormals();
  g.setAttribute('aGUV', new THREE.BufferAttribute(guv, 2));
  return g;
}

/** Concatenate indexed/non-indexed geometries that carry position, normal and aGUV. */
function mergeGeometries(list) {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), guv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.aGUV;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      guv[(vo + i) * 2] = u.getX(i);
      guv[(vo + i) * 2 + 1] = u.getY(i);
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
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** A tapered spike from `base` along `dir`, its tip curling toward `bend`. Parent space. */
function spike(len, r, base, dir, bend, curl = 0.22, radial = 5) {
  const g = hornGeometry(len, r, { radial, curve: curl });
  _bz.set(dir[0], dir[1], dir[2]).normalize();
  _by.set(bend[0], bend[1], bend[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-6) _by.set(0, -1, 0).addScaledVector(_bz, _bz.y);
  if (_by.lengthSq() < 1e-6) _by.set(1, 0, 0).addScaledVector(_bz, _bz.x);
  _by.normalize();
  _bx.crossVectors(_by, _bz);
  _m.makeBasis(_bx, _by, _bz).setPosition(base[0], base[1], base[2]);
  g.applyMatrix4(_m);
  return g;
}

/** A geometry moved / rotated (Euler XYZ) / scaled in place. */
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Messy spiky hair: a scalp cap + four spring clusters of tapered spikes (fringe over the eyes,
 *  both sides, a crown / back star that carries the top-down silhouette). Lengths and directions
 *  jitter so it reads as bed-head, not a helmet. Returns per-cluster geometries offset to pivots. */
function hairGeometries() {
  const r = rng(77);
  const j = (a) => (r() - 0.5) * 2 * a;
  const down = [0, -1, 0];
  const S = { fringe: [], left: [], right: [], crown: [] };
  // fringe: uneven strands falling over the forehead and eyes
  for (let i = 0; i < 7; i++) {
    const u = (i / 6) * 2 - 1; // −1 … 1 across the brow
    const x = u * 0.08;
    const len = 0.11 + 0.05 * (1 - Math.abs(u)) + j(0.025);
    S.fringe.push(spike(len, 0.03, [x, 0.215, 0.075 + 0.02 * (1 - Math.abs(u))], [u * 0.45 + j(0.15), -0.85, 0.55 + j(0.1)], [0, 0, 1], 0.14));
  }
  // sides: sweep back and out over the ears, a couple of stray flicks
  for (const side of [1, -1]) {
    const L = side > 0 ? S.left : S.right;
    for (let i = 0; i < 6; i++) {
      const y = 0.07 + i * 0.032;
      const z = 0.045 - i * 0.028;
      L.push(spike(0.11 + 0.014 * i + j(0.02), 0.034, [side * 0.1, y, z], [side * (0.75 + j(0.15)), -0.4 + i * 0.1 + j(0.12), -0.55], down, 0.2));
    }
    L.push(spike(0.13, 0.026, [side * 0.09, 0.2, -0.02], [side * 0.9, 0.35, -0.2], [0, 1, 0], 0.3));
  }
  // crown + back: a star of long spikes radiating back / out (reads as spiky hair from above)
  const crown = [
    // [azimuth from +Z (rad, + = left), elevation, length, along-dir up bias]
    [Math.PI, 0.95, 0.19, 0.05], [Math.PI - 0.55, 0.85, 0.18, 0.0], [Math.PI + 0.55, 0.85, 0.17, 0.0],
    [Math.PI - 1.05, 0.55, 0.16, -0.1], [Math.PI + 1.05, 0.55, 0.17, -0.1],
    [Math.PI, 0.35, 0.2, -0.3], [Math.PI - 0.45, 0.25, 0.17, -0.35], [Math.PI + 0.45, 0.25, 0.18, -0.35],
    [Math.PI - 0.8, 0.05, 0.15, -0.45], [Math.PI + 0.8, 0.05, 0.15, -0.45],
    [0.35, 1.25, 0.13, -0.05], [-0.35, 1.25, 0.14, -0.05], [Math.PI, 1.35, 0.14, 0.1],
    [0.9, 1.0, 0.12, -0.1], [-0.9, 1.0, 0.12, -0.1], [Math.PI - 0.25, 1.1, 0.15, 0.05],
  ];
  for (const [az0, el, len, up] of crown) {
    const az = az0 + j(0.12);
    const cx = Math.sin(az) * Math.cos(el), cz = Math.cos(az) * Math.cos(el), cy = Math.sin(el);
    const base = [cx * 0.1, 0.125 + cy * 0.115, cz * 0.105 - 0.01];
    // outward from the scalp, swept back and a little down; top spikes stand up more
    const dir = [cx * 0.9 + j(0.15), cy * 0.3 + up + j(0.12), cz * 0.8 - 0.6];
    S.crown.push(spike(len + j(0.025), 0.042, base, dir, down, 0.25));
  }
  const out = {};
  for (const c of HAIR_CLUSTERS) {
    const g = mergeGeometries(S[c.name]);
    g.translate(-c.pivot[0], -c.pivot[1], -c.pivot[2]);
    out[c.name] = g;
  }
  return out;
}

// Glyph cells are sized so a glyph stays readable at the default camera (smaller cells blur into a
// solid texture). Readability in the wyrm's shadow: the glyph is picked by light, so a steep
// `lumScale` and a bottom glyph that is a stroke (':' / "'"), not a lone dot, keep the figure a
// field of light-grey symbols even in the dark; `inkGlow` self-lights them, `outline` is the moonlit
// silhouette line. The coat stays the dimmest cloth; silver trim, the cyan blade and the violet gem
// are the bright accents.
export function createHeroMaterials(U) {
  return {
    // messy black hair, violet sheen: spikes point along aGUV +y
    hair: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: "'^AA", cell: [0.12, 0.14], glyphZoom: 0.62, base: [0.01, 0.006, 0.018],
      ink: [0.34, 0.3, 0.5], inkAlt: [0.62, 0.38, 1.05], altChance: 0.38, lumScale: 5,
      gain: 2.6, rim: 1.2, outline: 1.7, inkGlow: 0.5, seed: 4.2,
    }),
    // pale face / neck
    skin: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: '.:oO', cell: [0.1, 0.1], glyphZoom: 0.62, base: [0.06, 0.045, 0.04],
      ink: [0.9, 0.76, 0.7], gain: 1.8, rim: 0.4, outline: 0.9, inkGlow: 0.4, lumScale: 4, seed: 9.1,
    }),
    // long black coat: vertical fold strokes in cold light grey, a few violet cells
    coat: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: ':|IA', cell: [0.16, 0.2], glyphZoom: 0.62, base: [0.008, 0.008, 0.013],
      ink: [0.46, 0.47, 0.56], inkAlt: [0.56, 0.44, 0.8], altChance: 0.22, lumScale: 5,
      gain: 2.4, rim: 1.3, outline: 1.9, inkGlow: 0.42, side: THREE.DoubleSide, seed: 17.5,
    }),
    // torn coat tails: deep purple toward the ragged ends
    hem: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: ":/AA", cell: [0.15, 0.19], glyphZoom: 0.62, base: [0.014, 0.008, 0.024],
      ink: [0.46, 0.32, 0.74], inkAlt: [0.66, 0.42, 1.05], altChance: 0.35, lumScale: 5,
      gain: 2.4, rim: 1.3, outline: 1.9, inkGlow: 0.5, side: THREE.DoubleSide, seed: 31.3,
    }),
    // silver trim: belt, pauldron edges, buckles — the brightest cloth accent
    trim: createSurfaceGlyphMaterial(U, {
      ascii: 'plates', glyphs: '-=##', cell: [0.12, 0.1], glyphZoom: 0.62, base: [0.025, 0.027, 0.032],
      ink: [0.82, 0.88, 1.0], gain: 2.6, rim: 0.7, outline: 1.2, inkGlow: 0.6, lumScale: 5, seed: 2.7,
    }),
    // dark metal: pauldron plates and spikes, bracers, gauntlets, knee guards, boots, the crossguard
    armor: createSurfaceGlyphMaterial(U, {
      ascii: 'plates', glyphs: '-=#M', cell: [0.13, 0.12], glyphZoom: 0.62, base: [0.012, 0.013, 0.02],
      ink: [0.5, 0.55, 0.68], inkAlt: [0.72, 0.76, 0.92], altChance: 0.25, lumScale: 5,
      gain: 2.6, rim: 1.0, outline: 1.6, inkGlow: 0.45, seed: 21.4,
    }),
    pants: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: ':|I|', cell: [0.15, 0.2], glyphZoom: 0.62, base: [0.006, 0.006, 0.009],
      ink: [0.32, 0.32, 0.4], inkAlt: [0.4, 0.38, 0.52], altChance: 0.15, lumScale: 5,
      gain: 2.4, rim: 1.0, outline: 1.6, inkGlow: 0.38, seed: 13.3,
    }),
    // leather: straps, thigh belts, the sword grip
    leather: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: ':=##', cell: [0.1, 0.1], glyphZoom: 0.62, base: [0.012, 0.009, 0.008],
      ink: [0.42, 0.36, 0.32], gain: 2.2, rim: 0.7, outline: 1.2, inkGlow: 0.32, lumScale: 4, seed: 6.6,
    }),
    // dark blade, two cold glyph columns (= the two glowing edges) + cyan edge seams; uInkGlow /
    // uGlow are driven by player.js (idle shimmer, strike flare, charge, crit)
    blade: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: ':|II', cell: [0.06, 0.11], rowShift: 0, base: [0.025, 0.035, 0.055],
      ink: [0.42, 0.85, 1.3], inkAlt: [0.75, 1.15, 1.7], altChance: 0.3, lumScale: 3,
      gain: 2.6, rim: 0.8, outline: 1.4, inkGlow: 0.9, emissive: [0.3, 1.25, 2.6], glowMask: 1, seed: 1.9,
    }),
    // the violet gem in the crossguard: self-lit glyphs + glowing seams
    gem: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: '+*@@', cell: [0.03, 0.03], base: [0.3, 0.08, 0.5],
      ink: [1.3, 0.55, 2.4], gain: 1.6, rim: 0.6, outline: 1.2, inkGlow: 1.8, lumScale: 4,
      emissive: [1.6, 0.45, 3.0], glowMask: 1, seed: 5.5,
    }),
    // flask (only while drinking)
    flask: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: '.:o0', cell: [0.035, 0.04], base: [0.12, 0.08, 0.02],
      ink: [1.1, 0.85, 0.3], gain: 1.4, rim: 0.3, outline: 0.4, inkGlow: 1.4, glowMask: 0, seed: 3.1,
    }),
  };
}

export function buildHero(U) {
  const M = createHeroMaterials(U);

  const joint = (parent, x = 0, y = 0, z = 0) => {
    const j = new THREE.Object3D();
    j.position.set(x, y, z);
    j.rotation.order = 'YXZ';
    parent.add(j);
    return j;
  };
  const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const ring = (rx, rz, h, segs = 16) => orient.up(ellipsoidGeometry(rx, rz, h, { widthSegs: segs, heightSegs: 4 }));

  const root = new THREE.Group();
  root.name = 'player';
  const body = joint(root, 0, DIM.pivot, 0);
  const pelvis = joint(body, ...DIM.pelvis);

  // hips (pants), the silver waist belt the coat hangs from, a slanted leather hip belt + buckle
  mesh(pelvis, orient.up(ellipsoidGeometry(0.14, 0.1, 0.11)), M.pants, 0, -0.01, 0);
  mesh(pelvis, ring(0.162, 0.132, 0.032), M.trim, 0, DIM.coatY, 0);
  const hipBelt = mesh(pelvis, ring(0.168, 0.136, 0.022), M.leather, 0, DIM.coatY - 0.075, 0.004);
  hipBelt.rotation.z = 0.16;
  mesh(pelvis, ellipsoidGeometry(0.032, 0.026, 0.014, { widthSegs: 8, heightSegs: 4 }), M.trim, 0.03, DIM.coatY - 0.07, 0.132);

  // slim coat torso: narrow waist, chest, a diagonal strap, high flared collar open at the throat
  const spine = joint(pelvis, ...DIM.spine);
  mesh(spine, orient.up(ellipsoidGeometry(0.13, 0.11, 0.13)), M.coat, 0, 0.06, 0);
  const chest = joint(spine, ...DIM.chest);
  mesh(chest, orient.up(ellipsoidGeometry(0.168, 0.12, 0.17)), M.coat, 0, 0.09, 0);
  const strap = mesh(chest, ring(0.176, 0.13, 0.018), M.leather, 0, 0.08, 0);
  strap.rotation.z = -0.62; // left shoulder → right hip
  mesh(chest, collarGeometry(0.17, 0.078, 0.122, 0.95), M.coat, 0, 0.19, -0.01).rotation.x = -0.12;
  // shoulders: a plain plate on the left; the spiked pauldron rides on the right (sword) shoulder
  mesh(chest, ellipsoidGeometry(0.075, 0.058, 0.085, { widthSegs: 10, heightSegs: 6 }), M.coat, -0.175, 0.2, 0);
  mesh(chest, ellipsoidGeometry(0.082, 0.05, 0.09, { widthSegs: 10, heightSegs: 6 }), M.armor, 0.18, 0.215, 0);

  const pauldron = joint(chest, -DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
  {
    // three overlapping dark plates stepping down the arm (outward = −X), silver rims, spikes
    const plates = [
      [0.105, 0.06, 0.115, -0.025, 0.045, 0, -0.15],
      [0.1, 0.05, 0.108, -0.06, -0.012, 0, -0.55],
      [0.088, 0.044, 0.096, -0.083, -0.068, 0, -0.95],
    ];
    const pg = [], tg = [];
    for (const [rx, ry, rz, x, y, z, roll] of plates) {
      pg.push(place(ellipsoidGeometry(rx, ry, rz, { widthSegs: 12, heightSegs: 6 }), x, y, z, 0, 0, roll));
      tg.push(place(ellipsoidGeometry(rx * 1.04, ry * 0.32, rz * 1.04, { widthSegs: 14, heightSegs: 4 }), x - Math.sin(-roll) * ry * 0.55, y - Math.cos(roll) * ry * 0.55, z, 0, 0, roll));
    }
    const sp = [
      // [length, radius, base, dir]
      [0.2, 0.034, [-0.04, 0.09, -0.01], [-0.45, 1, -0.25]],
      [0.15, 0.03, [-0.09, 0.05, -0.05], [-1, 0.55, -0.5]],
      [0.13, 0.028, [-0.1, 0.04, 0.05], [-1, 0.5, 0.45]],
      [0.1, 0.024, [-0.13, -0.03, 0.0], [-1, 0.05, -0.1]],
    ];
    for (const [len, r, base, dir] of sp) pg.push(spike(len, r, base, dir, [0, 1, 0], 0.18, 6));
    mesh(pauldron, mergeGeometries(pg), M.armor);
    mesh(pauldron, mergeGeometries(tg), M.trim);
  }

  // head: pale face + neck, scalp cap, four spring hair clusters
  const head = joint(chest, ...DIM.neck);
  mesh(head, orient.up(limbGeometry({ length: 0.1, r0: 0.04, r1: 0.038, radial: 8, rings: 2, capSegs: 1 })), M.skin, 0, -0.06, 0);
  mesh(head, orient.up(ellipsoidGeometry(0.098, 0.125, 0.105)), M.skin, 0, 0.12, 0.012);
  mesh(head, ellipsoidGeometry(0.06, 0.05, 0.06, { widthSegs: 8, heightSegs: 6 }), M.skin, 0, 0.045, 0.035); // jaw
  mesh(head, orient.up(ellipsoidGeometry(0.116, 0.118, 0.124)), M.hair, 0, 0.145, -0.014);
  const hairGeo = hairGeometries();
  const hair = {};
  for (const c of HAIR_CLUSTERS) {
    const j = joint(head, ...c.pivot);
    mesh(j, hairGeo[c.name], M.hair);
    hair[c.name] = j;
  }

  // arms: coat sleeves, armoured forearms (bracers) and gauntlets
  const arms = {};
  for (const side of [-1, 1]) {
    const upper = joint(chest, side * DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
    mesh(upper, orient.down(limbGeometry({ length: DIM.upperArm, r0: 0.058, r1: 0.05 })), M.coat);
    const fore = joint(upper, 0, -DIM.upperArm, 0);
    mesh(fore, orient.down(limbGeometry({ length: 0.1, r0: 0.05, r1: 0.048 })), M.coat);
    mesh(fore, orient.down(limbGeometry({ length: 0.19, r0: 0.056, r1: 0.05, bulge: 0.006 })), M.armor, 0, -0.06, 0);
    mesh(fore, ring(0.06, 0.06, 0.014, 12), M.trim, 0, -0.07, 0);
    mesh(fore, orient.down(ellipsoidGeometry(0.044, 0.038, 0.062, { widthSegs: 10, heightSegs: 6 })), M.armor, 0, -DIM.foreArm - 0.012, 0.004);
    arms[side < 0 ? 'R' : 'L'] = { upper, fore };
  }
  // flask, shown only while healing
  const flask = mesh(arms.L.fore, orient.up(ellipsoidGeometry(0.036, 0.036, 0.055, { widthSegs: 10, heightSegs: 6 })), M.flask, 0, -DIM.foreArm - 0.03, 0.06);
  flask.visible = false;

  // long legs: black pants with two leather thigh straps, knee-high armoured boots, knee guards
  const legs = {};
  for (const side of [-1, 1]) {
    const thigh = joint(pelvis, side * DIM.hip[0], DIM.hip[1], DIM.hip[2]);
    mesh(thigh, orient.down(limbGeometry({ length: DIM.thigh, r0: 0.074, r1: 0.056, bulge: 0.008 })), M.pants);
    mesh(thigh, ring(0.074, 0.074, 0.016, 12), M.leather, 0, -0.13, 0);
    mesh(thigh, ring(0.068, 0.068, 0.016, 12), M.leather, 0, -0.26, 0);
    const shin = joint(thigh, 0, -DIM.thigh, 0);
    mesh(shin, orient.down(limbGeometry({ length: 0.4, r0: 0.062, r1: 0.048 })), M.armor);
    mesh(shin, ring(0.07, 0.07, 0.02, 12), M.trim, 0, -0.06, 0);
    // knee guard: a rounded cap with a short forward point
    mesh(shin, ellipsoidGeometry(0.055, 0.07, 0.04, { widthSegs: 10, heightSegs: 6 }), M.armor, 0, -0.01, 0.045);
    mesh(shin, spike(0.07, 0.03, [0, 0.0, 0.07], [0, 0.65, 1], [0, 1, 0], 0.1, 6), M.armor);
    const foot = joint(shin, 0, -DIM.shin, 0);
    mesh(foot, ellipsoidGeometry(0.05, 0.048, 0.12, { widthSegs: 10, heightSegs: 6 }), M.armor, 0, -0.024, 0.048);
    legs[side < 0 ? 'R' : 'L'] = { thigh, shin, foot };
  }

  // coat tails: 6 panels × (solid upper + torn lower strips), each a lagging spring (anim.js)
  const coat = [];
  COAT_PANELS.forEach((P, i) => {
    const anchor = joint(pelvis, Math.sin(P.az) * DIM.coatR, DIM.coatY, Math.cos(P.az) * DIM.coatR);
    anchor.rotation.y = P.az; // local +Z = outward, +X = tangent
    const s0 = joint(anchor);
    const wm = (P.w0 + P.w1) * 0.5;
    mesh(s0, coatPanel(P.len[0], P.w0, wm, DIM.coatR), M.coat);
    const s1 = joint(s0, 0, -P.len[0], 0);
    mesh(s1, tatteredPanel(P.len[1], wm, P.w1, DIM.coatR * 1.25, P.cut, 101 + i * 17), M.hem);
    coat.push({ anchor, segs: [s0, s1], def: P });
  });

  // the longsword: origin at the grip, blade along +Z (width on X, flat faces ±Y)
  const sword = joint(body);
  mesh(sword, bladeGeometry(DIM.bladeTip - 0.15, 0.072, 0.06, 0.14, 0.013, 0.06), M.blade, 0, 0, 0.15);
  mesh(sword, limbGeometry({ length: DIM.gripBack + DIM.guard - 0.01, r0: 0.02, r1: 0.021, radial: 6, rings: 3 }), M.leather, 0, 0, -DIM.gripBack); // grip
  {
    // dark ornate crossguard: a bar, a housing for the gem, spikes curving up the blade and back
    const gg = [ellipsoidGeometry(0.17, 0.026, 0.03, { widthSegs: 14, heightSegs: 6 })];
    gg[0].translate(0, 0, DIM.guard);
    gg.push(place(ellipsoidGeometry(0.05, 0.036, 0.07, { widthSegs: 10, heightSegs: 6 }), 0, 0, DIM.gem));
    for (const s of [-1, 1]) {
      gg.push(spike(0.14, 0.024, [s * 0.14, 0, DIM.guard], [s * 0.45, 0, 1], [s, 0, 0], -0.25, 6));
      gg.push(spike(0.08, 0.02, [s * 0.15, 0, DIM.guard - 0.01], [s * 0.6, 0, -1], [s, 0, 0], 0.2, 6));
      gg.push(spike(0.07, 0.018, [s * 0.05, 0, DIM.gem + 0.05], [s * 0.25, 0, 1], [0, 1, 0], 0, 5));
    }
    // pommel with a short spike
    gg.push(place(ellipsoidGeometry(0.032, 0.032, 0.036, { widthSegs: 8, heightSegs: 6 }), 0, 0, -DIM.gripBack - 0.02));
    gg.push(spike(0.06, 0.02, [0, 0, -DIM.gripBack - 0.04], [0, 0, -1], [0, 1, 0], 0, 5));
    mesh(sword, mergeGeometries(gg), M.armor);
  }
  // the gem proud of both flat faces, and a marker joint for its glint FX
  mesh(sword, ellipsoidGeometry(0.028, 0.044, 0.04, { widthSegs: 10, heightSegs: 8 }), M.gem, 0, 0, DIM.gem);
  const gem = joint(sword, 0, 0, DIM.gem);

  const mats = Object.values(M);
  return {
    root, body, pelvis, spine, chest, head, hair, arms, legs, coat, sword, gem, pauldron, flask,
    materials: M,
    mats,
    // joints sampled for body-attached FX (burn flames, Ghostep afterimage)
    fxPoints: [chest, chest, pelvis, head, arms.R.upper, arms.L.upper, legs.R.thigh, legs.L.thigh, legs.R.shin, legs.L.shin],
    // afterimage outline: joint chains whose segments are traced with glyphs
    ghostChains: [
      [head, chest, spine, pelvis],
      [arms.R.upper, arms.R.fore],
      [arms.L.upper, arms.L.fore],
      [legs.R.thigh, legs.R.shin, legs.R.foot],
      [legs.L.thigh, legs.L.shin, legs.L.foot],
    ],
  };
}
