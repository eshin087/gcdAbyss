import * as THREE from 'three';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry, planarGUV, cylindricalGUV } from '../../render/glyphGeometry.js';

// The Wanderer: an anime black-coat swordsman (~1.75 m, head ≈ 1:6.5, long legs, narrow waist).
// A joint hierarchy with surface-glyph meshes hung on it. Faces +Z, Y up, the character's RIGHT
// is −X. Hands and feet are placed by IK (anim.js); the joints here only define bone lengths and
// rest offsets. Every part renders through the screen character grid (`ascii` material sets).
//
//   root (yaw) → body (waist pivot: rolls / falls) → pelvis → spine → chest → head → hair clusters
//                                                        │                 └ arms (upper → fore)
//                                                        ├ legs (thigh → shin → foot)
//                                                        └ coat panels (anchor → seg0 → seg1)
//   body → sword (posed directly in body space; origin = grip, blade along +Z)
//
// Silhouette from the steep top-down camera (~60 px tall): the spiky hair star and the flaring
// split coat hem are the identity; the pale face and the cold blade are the only light values.

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
  bladeBase: 0.12, // hit segment along the sword's +Z (hilt side)
  bladeTip: 1.06,
};

/** Knee-length coat hem split into 6 panels (az: 0 = front, + = the hero's left). Open at the
 *  front so the legs show when running; the back pair overlaps into a vent. */
export const COAT_PANELS = [
  { az: 0.74, w0: 0.15, w1: 0.21, len: [0.22, 0.23] }, // front-left
  { az: -0.74, w0: 0.15, w1: 0.21, len: [0.22, 0.23] }, // front-right
  { az: 1.62, w0: 0.2, w1: 0.28, len: [0.23, 0.25] }, // left
  { az: -1.62, w0: 0.2, w1: 0.28, len: [0.23, 0.25] }, // right
  { az: 2.58, w0: 0.21, w1: 0.3, len: [0.24, 0.27] }, // back-left
  { az: -2.58, w0: 0.21, w1: 0.3, len: [0.24, 0.27] }, // back-right
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

/** Open tube along +Z from radius r0 (z = 0) to r1 (z = len): collars, cuffs. */
function tube(len, r0, r1, radial = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 2, true);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2); // +Y → +Z
  return cylindricalGUV(g);
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

/** A tapered hair spike from `base` along `dir`, its tip curling toward `bend`. Head space. */
function spike(len, r, base, dir, bend, curl = 0.22) {
  const g = hornGeometry(len, r, { radial: 5, curve: curl });
  _bz.set(dir[0], dir[1], dir[2]).normalize();
  _by.set(bend[0], bend[1], bend[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-6) _by.set(0, -1, 0).addScaledVector(_bz, _bz.y);
  _by.normalize();
  _bx.crossVectors(_by, _bz);
  _m.makeBasis(_bx, _by, _bz).setPosition(base[0], base[1], base[2]);
  g.applyMatrix4(_m);
  return g;
}

/** Spiky dark hair: a scalp cap + four spring clusters of tapered spikes (fringe over the eyes,
 *  both sides, a crown / back star that carries the top-down silhouette). Returns per-cluster
 *  geometries already offset to their pivots. */
function hairGeometries() {
  const down = [0, -1, 0];
  const S = { fringe: [], left: [], right: [], crown: [] };
  // fringe: strands falling over the forehead and eyes, fanned slightly
  for (let i = 0; i < 6; i++) {
    const u = (i / 5) * 2 - 1; // −1 … 1 across the brow
    const x = u * 0.075;
    S.fringe.push(spike(0.12 + 0.03 * (1 - Math.abs(u)), 0.03, [x, 0.215, 0.075 + 0.02 * (1 - Math.abs(u))], [u * 0.35, -0.85, 0.55], [0, 0, 1], 0.12));
  }
  // sides: sweep back and out over the ears
  for (const side of [1, -1]) {
    const L = side > 0 ? S.left : S.right;
    for (let i = 0; i < 5; i++) {
      const y = 0.08 + i * 0.035;
      const z = 0.04 - i * 0.03;
      L.push(spike(0.11 + 0.012 * i, 0.033, [side * 0.1, y, z], [side * 0.75, -0.35 + i * 0.1, -0.55], down, 0.18));
    }
  }
  // crown + back: a star of long spikes radiating back / out (reads as spiky hair from above)
  const crown = [
    // [azimuth from +Z (rad, + = left), elevation, length, along-dir up bias]
    [Math.PI, 0.95, 0.17, 0.35], [Math.PI - 0.55, 0.85, 0.16, 0.3], [Math.PI + 0.55, 0.85, 0.16, 0.3],
    [Math.PI - 1.05, 0.55, 0.15, 0.1], [Math.PI + 1.05, 0.55, 0.15, 0.1],
    [Math.PI, 0.35, 0.18, -0.1], [Math.PI - 0.45, 0.25, 0.16, -0.2], [Math.PI + 0.45, 0.25, 0.16, -0.2],
    [Math.PI - 0.8, 0.05, 0.14, -0.35], [Math.PI + 0.8, 0.05, 0.14, -0.35],
    [0.35, 1.25, 0.12, 0.3], [-0.35, 1.25, 0.12, 0.3], [Math.PI, 1.35, 0.13, 0.4],
  ];
  for (const [az, el, len, up] of crown) {
    const cx = Math.sin(az) * Math.cos(el), cz = Math.cos(az) * Math.cos(el), cy = Math.sin(el);
    const base = [cx * 0.1, 0.125 + cy * 0.115, cz * 0.105 - 0.01];
    // outward from the scalp, swept back and a little down; top spikes stand up more
    const dir = [cx * 0.8, cy * 0.4 + up, cz * 0.8 - 0.55];
    S.crown.push(spike(len, 0.04, base, dir, down, 0.25));
  }
  const out = {};
  for (const c of HAIR_CLUSTERS) {
    const g = mergeGeometries(S[c.name]);
    g.translate(-c.pivot[0], -c.pivot[1], -c.pivot[2]);
    out[c.name] = g;
  }
  return out;
}

// v0.3: crisp surface glyphs. Cells are sized so a glyph stays >= ~6 screen px at the default camera
// (smaller cells blur into a solid texture); `outline` is the moonlit silhouette line that keeps the
// black coat readable on the dark meadow, silver trim and the blade are the bright accents.
export function createHeroMaterials(U) {
  return {
    // dark spiky hair: spikes point along aGUV +y, cool blue-steel highlight cells
    hair: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: ".'^A", cell: [0.075, 0.09], base: [0.006, 0.007, 0.012],
      ink: [0.1, 0.12, 0.18], inkAlt: [0.28, 0.34, 0.52], altChance: 0.3,
      gain: 2.8, rim: 1.1, outline: 1.55, seed: 4.2,
    }),
    // pale face / neck
    skin: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: '.:oO', cell: [0.055, 0.06], base: [0.05, 0.035, 0.03],
      ink: [0.82, 0.66, 0.58], gain: 1.8, rim: 0.3, outline: 0.8, seed: 9.1,
    }),
    // long black leather coat: vertical fold strokes, a few cooler cells
    coat: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: '.:|I', cell: [0.085, 0.12], base: [0.006, 0.006, 0.009],
      ink: [0.18, 0.18, 0.22], inkAlt: [0.32, 0.35, 0.48], altChance: 0.22,
      gain: 3.2, rim: 1.3, outline: 1.7, side: THREE.DoubleSide, seed: 17.5,
    }),
    // silver trim: belt, closure line, crossguard, pommel — the brightest cloth accent
    trim: createSurfaceGlyphMaterial(U, {
      ascii: 'plates', glyphs: '.-=#', cell: [0.06, 0.06], base: [0.02, 0.022, 0.026],
      ink: [0.75, 0.8, 0.9], gain: 2.6, rim: 0.6, outline: 1.05, seed: 2.7,
    }),
    pants: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: '.:|I', cell: [0.075, 0.11], base: [0.005, 0.005, 0.007],
      ink: [0.08, 0.08, 0.1], inkAlt: [0.12, 0.13, 0.17], altChance: 0.15,
      gain: 2.8, rim: 0.9, outline: 1.45, seed: 13.3,
    }),
    boots: createSurfaceGlyphMaterial(U, {
      ascii: 'plates', glyphs: '.-=#', cell: [0.06, 0.07], base: [0.008, 0.007, 0.008],
      ink: [0.14, 0.13, 0.14], gain: 2.6, rim: 0.8, outline: 1.3, seed: 21.4,
    }),
    // fingerless gloves / sword grip
    glove: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth', glyphs: '.:oO', cell: [0.045, 0.05], base: [0.008, 0.007, 0.008],
      ink: [0.12, 0.11, 0.12], gain: 2.2, rim: 0.6, outline: 1.2, seed: 6.6,
    }),
    // dark blade with a cool glowing edge; uInkGlow / uGlow carry strike, charge and crit glow
    blade: createSurfaceGlyphMaterial(U, {
      ascii: 'strands', glyphs: '.-|I', cell: [0.045, 0.1], base: [0.03, 0.035, 0.05],
      ink: [0.55, 0.66, 0.9], inkAlt: [0.85, 1.0, 1.35], altChance: 0.25,
      gain: 2.8, rim: 0.9, outline: 1.3, inkGlow: 0.45, emissive: [0.5, 0.85, 1.8], glowMask: 1, seed: 1.9,
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

  const root = new THREE.Group();
  root.name = 'player';
  const body = joint(root, 0, DIM.pivot, 0);
  const pelvis = joint(body, ...DIM.pelvis);

  // hips (pants) + silver belt where the coat skirt hangs from
  mesh(pelvis, orient.up(ellipsoidGeometry(0.14, 0.1, 0.11)), M.pants, 0, -0.01, 0);
  mesh(pelvis, orient.up(ellipsoidGeometry(0.158, 0.13, 0.03, { widthSegs: 16, heightSegs: 4 })), M.trim, 0, DIM.coatY, 0);

  // slim coat torso: narrow waist, chest, high flared collar, closure line
  const spine = joint(pelvis, ...DIM.spine);
  mesh(spine, orient.up(ellipsoidGeometry(0.13, 0.11, 0.13)), M.coat, 0, 0.06, 0);
  const chest = joint(spine, ...DIM.chest);
  mesh(chest, orient.up(ellipsoidGeometry(0.165, 0.118, 0.17)), M.coat, 0, 0.09, 0);
  mesh(chest, orient.up(ellipsoidGeometry(0.012, 0.01, 0.13, { widthSegs: 6, heightSegs: 4 })), M.trim, 0, 0.07, 0.112);
  mesh(chest, orient.up(tube(0.14, 0.072, 0.098)), M.coat, 0, 0.215, -0.008); // high collar, open at the top
  // shoulders
  for (const side of [-1, 1]) {
    mesh(chest, ellipsoidGeometry(0.075, 0.058, 0.085, { widthSegs: 10, heightSegs: 6 }), M.coat, side * 0.175, 0.2, 0);
  }

  // head: pale face + neck, scalp cap, four spring hair clusters
  const head = joint(chest, ...DIM.neck);
  mesh(head, orient.up(limbGeometry({ length: 0.1, r0: 0.04, r1: 0.038, radial: 8, rings: 2, capSegs: 1 })), M.skin, 0, -0.06, 0);
  mesh(head, orient.up(ellipsoidGeometry(0.098, 0.125, 0.105)), M.skin, 0, 0.12, 0.012);
  mesh(head, ellipsoidGeometry(0.06, 0.05, 0.06, { widthSegs: 8, heightSegs: 6 }), M.skin, 0, 0.045, 0.035); // jaw
  mesh(head, orient.up(ellipsoidGeometry(0.114, 0.116, 0.122)), M.hair, 0, 0.145, -0.014);
  const hairGeo = hairGeometries();
  const hair = {};
  for (const c of HAIR_CLUSTERS) {
    const j = joint(head, ...c.pivot);
    mesh(j, hairGeo[c.name], M.hair);
    hair[c.name] = j;
  }

  // arms: coat sleeves, fingerless gloves
  const arms = {};
  for (const side of [-1, 1]) {
    const upper = joint(chest, side * DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
    mesh(upper, orient.down(limbGeometry({ length: DIM.upperArm, r0: 0.058, r1: 0.048 })), M.coat);
    const fore = joint(upper, 0, -DIM.upperArm, 0);
    mesh(fore, orient.down(limbGeometry({ length: 0.22, r0: 0.05, r1: 0.044 })), M.coat);
    mesh(fore, orient.down(ellipsoidGeometry(0.04, 0.034, 0.058, { widthSegs: 10, heightSegs: 6 })), M.glove, 0, -DIM.foreArm - 0.012, 0.004);
    arms[side < 0 ? 'R' : 'L'] = { upper, fore };
  }
  // flask, shown only while healing
  const flask = mesh(arms.L.fore, orient.up(ellipsoidGeometry(0.036, 0.036, 0.055, { widthSegs: 10, heightSegs: 6 })), M.flask, 0, -DIM.foreArm - 0.03, 0.06);
  flask.visible = false;

  // long legs: black pants, knee-high dark boots
  const legs = {};
  for (const side of [-1, 1]) {
    const thigh = joint(pelvis, side * DIM.hip[0], DIM.hip[1], DIM.hip[2]);
    mesh(thigh, orient.down(limbGeometry({ length: DIM.thigh, r0: 0.074, r1: 0.054, bulge: 0.008 })), M.pants);
    const shin = joint(thigh, 0, -DIM.thigh, 0);
    mesh(shin, orient.down(limbGeometry({ length: 0.4, r0: 0.056, r1: 0.044 })), M.boots);
    const foot = joint(shin, 0, -DIM.shin, 0);
    mesh(foot, ellipsoidGeometry(0.046, 0.045, 0.115, { widthSegs: 10, heightSegs: 6 }), M.boots, 0, -0.024, 0.045);
    legs[side < 0 ? 'R' : 'L'] = { thigh, shin, foot };
  }

  // coat skirt: 6 panels × 2 segments, each a lagging spring (anim.js)
  const coat = [];
  for (const P of COAT_PANELS) {
    const anchor = joint(pelvis, Math.sin(P.az) * DIM.coatR, DIM.coatY, Math.cos(P.az) * DIM.coatR);
    anchor.rotation.y = P.az; // local +Z = outward, +X = tangent
    const s0 = joint(anchor);
    mesh(s0, coatPanel(P.len[0], P.w0, (P.w0 + P.w1) * 0.5, DIM.coatR), M.coat);
    const s1 = joint(s0, 0, -P.len[0], 0);
    mesh(s1, coatPanel(P.len[1], (P.w0 + P.w1) * 0.5, P.w1, DIM.coatR * 1.25), M.coat);
    coat.push({ anchor, segs: [s0, s1], def: P });
  }

  // one longsword: origin at the grip, blade along +Z (wide along X, flat faces ±Y)
  const sword = joint(body);
  mesh(sword, limbGeometry({ length: 0.95, r0: 0.033, r1: 0.01, sx: 1, sy: 0.25, radial: 8, rings: 8, capSegs: 2 }), M.blade, 0, 0, 0.1);
  mesh(sword, ellipsoidGeometry(0.1, 0.022, 0.024, { widthSegs: 10, heightSegs: 6 }), M.trim, 0, 0, 0.085); // crossguard
  mesh(sword, limbGeometry({ length: 0.17, r0: 0.019, r1: 0.019, radial: 6, rings: 3 }), M.glove, 0, 0, -0.09); // grip
  mesh(sword, ellipsoidGeometry(0.028, 0.028, 0.03, { widthSegs: 8, heightSegs: 6 }), M.trim, 0, 0, -0.11); // pommel

  const mats = Object.values(M);
  return {
    root, body, pelvis, spine, chest, head, hair, arms, legs, coat, sword, flask,
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
