import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry } from '../../render/glyphGeometry.js';
import { ANATOMY as A, SCALE } from './tuning.js';
import { WingMembrane } from './membrane.js';

// Procedural wyvern: a hierarchy of Object3D joints carrying rigid glyph-skinned meshes.
// Every bone joint points its local +Z down the bone; the next joint sits at (0, 0, length).
// Root = ground point under the torso, facing +Z, model-left = +X (side sign s = +1).
// All numbers here are MODEL units; the root is scaled by SCALE (tuning.js) into world metres.

/**
 * Tail aGUV +y runs toward the body (flipped), like the limbs below, so the scale chevrons ('V',
 * tip toward -y) point down the tail toward its tip. Set false to flip them back.
 */
export const TAIL_FLIP = true;

// v0.3 "Obsidian Drake" (owner concept art): obsidian-black jagged scales printed as white /
// silver chevron glyphs over near-black gaps; molten orange cracks between them, hottest on the
// throat, chest, belly, inner thighs and tail underside (separate `lava` parts with orange,
// self-lit glyphs); deep red wing membranes with orange veins on white-grey glyph-line bones;
// big swept-back horns, a spiky crest / frill, a spiked spine and tail, heavy ivory claws and a
// glowing maw with bright teeth. aGUV cells are in MODEL units (x SCALE in the world): at 1.875
// a 0.19 cell is ~0.36 m, ~12 px at the default camera. Scale chevrons are 'V's: aGUV +y runs
// toward the head on the body / neck / head and toward the body on the tail and limbs (flip), so
// each 'V' tip points back / down the limb like an overlapping scale (seen head-on: a clean '^').
// Strokes on horns, claws and finger bones run toward the tip. uWarn (the red dodge-only tell
// glow) is driven on every material in `mats`.
const OBSIDIAN = {
  ascii: 'scales',
  glyphs: '.vVV',
  base: [0.02, 0.019, 0.024],
  cell: [0.19, 0.23],
  lumScale: 3.4,
  ink: [0.36, 0.375, 0.42], // silver
  inkAlt: [0.8, 0.24, 0.04], // a few ember-orange scales
  altChance: 0.06,
  gain: 2.3,
  rim: 0.32,
  outline: 0,
  emissive: [1.0, 0.36, 0.06],
};
// molten parts: orange glyphs that glow on their own (visible on the shadowed underside)
const LAVA = {
  ascii: 'scales',
  glyphs: 'vvVV',
  base: [0.13, 0.036, 0.008],
  cell: [0.19, 0.22],
  lumScale: 3.0,
  ink: [1.0, 0.42, 0.09],
  inkAlt: [1.0, 0.72, 0.3],
  altChance: 0.18,
  gain: 1.6,
  rim: 0.15,
  outline: 0,
  inkGlow: 0.5,
  emissive: [1.0, 0.34, 0.05],
  glowMask: 1,
};
// bone lines: dashed strokes along the bone ('I' read as a letter)
const STROKE = { ascii: 'strands', outline: 0, glyphs: ".'|!" };

/**
 * Crack-glow (uGlow) per material, applied by Dragon._applyMaterials every frame:
 * [phase-1 ember baseline, x this.glow (phase 2 0.5, dying 0.85), x throat charge (breath / roar)].
 * The eye material is driven separately (eye glow follows rig.s.eyes).
 */
export const GLOW = {
  scales: [0.05, 0.62, 0], // phase 2: bright cracks, the hide stays obsidian
  neck: [0.07, 0.62, 0.35],
  belly: [0.5, 1.0, 0.25],
  throat: [0.55, 0.9, 1.1],
  lava: [0.45, 1.0, 0],
  membrane: [0.16, 0.8, 0],
  wingBone: [0, 0.35, 0],
  bone: [0.04, 0.5, 0],
  claw: [0, 0, 0],
  teeth: [0, 0, 0.5],
  maw: [0.55, 0.6, 1.3],
};

export function createDragonMaterials(U) {
  const mats = {
    // back / flanks / tail / limbs: silver chevron scales along the body flow
    scales: createSurfaceGlyphMaterial(U, { ...OBSIDIAN, seed: 11.3 }),
    // neck + head get their own instance (throat charge)
    neck: createSurfaceGlyphMaterial(U, { ...OBSIDIAN, cell: [0.17, 0.21], altChance: 0.09, seed: 23.7 }),
    // chest + belly: molten plates
    belly: createSurfaceGlyphMaterial(U, { ...LAVA, glyphs: '-=#A', cell: [0.27, 0.19], rowShift: 0.5, seed: 5.1 }),
    // throat strip under the neck: lava that charges before the breath / roar
    throat: createSurfaceGlyphMaterial(U, { ...LAVA, cell: [0.16, 0.2], seed: 17.9 }),
    // inner thighs, tail underside
    lava: createSurfaceGlyphMaterial(U, { ...LAVA, seed: 29.4 }),
    // wing membranes: deep red skin, red vein strokes running out along the fingers, orange veins
    membrane: createSurfaceGlyphMaterial(U, {
      ...STROKE,
      glyphs: '.:|!',
      cell: [0.22, 0.46],
      base: [0.13, 0.013, 0.01],
      lumScale: 3.0,
      ink: [0.5, 0.06, 0.035],
      inkAlt: [1.0, 0.4, 0.07],
      altChance: 0.12,
      gain: 2.0,
      rim: 0.2,
      inkGlow: 0.12,
      emissive: [1.0, 0.3, 0.05],
      glowMask: 0.7,
      side: THREE.DoubleSide,
      seed: 41.9,
    }),
    // forearm + finger bones: white-grey glyph lines along the bone
    wingBone: createSurfaceGlyphMaterial(U, {
      ...STROKE,
      cell: [0.11, 0.22],
      base: [0.045, 0.043, 0.048],
      lumScale: 3.2,
      ink: [0.74, 0.73, 0.76],
      gain: 2.4,
      rim: 0.4,
      inkGlow: 0.12,
      emissive: [1.0, 0.34, 0.05],
      glowMask: 0.3,
      seed: 37.1,
    }),
    // horns, crest, spine spikes: obsidian with silver strokes toward the tip
    bone: createSurfaceGlyphMaterial(U, {
      ...STROKE,
      cell: [0.1, 0.16],
      base: [0.09, 0.088, 0.1], // a shade lighter than the hide: the spikes separate from the back
      lumScale: 3.5,
      ink: [0.8, 0.8, 0.85],
      gain: 2.5,
      rim: 0.5,
      inkGlow: 0.18,
      emissive: [1.0, 0.34, 0.05],
      glowMask: 0.5,
      seed: 7.7,
    }),
    // claws, thumb hooks: heavy ivory
    claw: createSurfaceGlyphMaterial(U, {
      ...STROKE,
      cell: [0.09, 0.15],
      base: [0.2, 0.18, 0.16],
      lumScale: 3.5,
      ink: [0.92, 0.88, 0.8],
      gain: 2.4,
      rim: 0.4,
      inkGlow: 0.2,
      glowMask: 0,
      seed: 13.9,
    }),
    // teeth: bright white even inside the dark mouth
    teeth: createSurfaceGlyphMaterial(U, {
      ...STROKE,
      cell: [0.06, 0.09],
      base: [0.45, 0.4, 0.34],
      lumScale: 3.0,
      ink: [1.0, 0.96, 0.88],
      gain: 2.0,
      rim: 0.3,
      inkGlow: 0.9,
      emissive: [1.0, 0.45, 0.1],
      glowMask: 0.6,
      seed: 19.3,
    }),
    // the maw: fire inside the mouth (seen when the jaw opens)
    maw: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth',
      glyphs: '*%#@',
      cell: [0.08, 0.1],
      base: [0.5, 0.11, 0.015],
      lumScale: 2.0,
      outline: 0,
      ink: [1.0, 0.55, 0.14],
      gain: 1.0,
      rim: 0,
      inkGlow: 1.8,
      emissive: [1.0, 0.4, 0.06],
      glowMask: 1,
      seed: 2.7,
    }),
    // eyes: density ramp, self-lit through uInkGlow / uGlow while awake
    eye: createSurfaceGlyphMaterial(U, {
      ascii: 'smooth',
      glyphs: '%@#@',
      cell: [0.1, 0.1],
      base: [0.09, 0.02, 0.005],
      lumScale: 2.2,
      outline: 0,
      ink: [1.0, 0.42, 0.06],
      gain: 1.0,
      rim: 0,
      emissive: [3.2, 0.9, 0.12],
      glowMask: 1,
      inkGlow: 0,
      seed: 3.3,
    }),
  };
  return mats;
}

function joint(parent, x = 0, y = 0, z = 0, name = '') {
  const j = new THREE.Object3D();
  j.name = name;
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ---- static detail (spikes, horns, teeth, claws) is baked into one merged mesh per joint + material
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** Transform `geo` in place: rotation (Euler rx, ry, rz in `order`) then translation. */
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e), _one);
  return geo.applyMatrix4(_m4);
}

/**
 * Spike (a horn along +Z) standing up from a surface: points up (+Y), leaning back toward -Z by
 * `tilt` rad (negative leans toward +Z), then rolled sideways by `roll` (+ leans toward -X).
 * A positive `curve` sweeps the tip further back.
 */
function spike(len, r, x, y, z, tilt = 0.5, roll = 0, curve = 0, radial = 5) {
  return place(hornGeometry(len, r, { radial, curve }), x, y, z, -(Math.PI / 2 + tilt), 0, roll, 'ZYX');
}

/** Horn / claw along +Z, aimed by pitch (+ = down) and yaw (Euler YXZ, like Object3D rotations). */
function horn(len, r, x, y, z, pitch, yaw, curve = 0, radial = 5) {
  return place(hornGeometry(len, r, { radial, curve }), x, y, z, pitch, yaw, 0, 'YXZ');
}

/** Merge `geos` into one mesh under `parent` (one draw call). */
function batch(parent, mat, geos) {
  if (!geos.length) return null;
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  return mesh(parent, geo, mat);
}

export function buildWyvern(U) {
  const mats = createDragonMaterials(U);
  const root = new THREE.Group();
  root.name = 'dragon';
  root.scale.setScalar(SCALE); // model units -> world metres (see tuning.js SCALE)

  // --- hips / torso
  const hips = joint(root, 0, A.hipY, A.hipZ, 'hips');
  hips.rotation.order = 'YXZ';
  const torso = mesh(hips, ellipsoidGeometry(1.26, 0.98, 2.2, { widthSegs: 20, heightSegs: 12 }), mats.scales, 0, 0.15, 1.05);
  // molten belly bulging under the flanks
  mesh(hips, ellipsoidGeometry(1.2, 0.76, 1.98, { widthSegs: 18, heightSegs: 10 }), mats.belly, 0, -0.32, 1.1);
  // spine: a row of big jagged spikes + two rows of small ones on the upper flanks
  const ridge = [];
  for (let i = 0; i < 9; i++) {
    const z = -0.85 + i * 0.47;
    const t = (z - 1.05) / 2.2;
    const top = Math.sqrt(Math.max(0, 1 - t * t));
    const y = 0.15 + 0.98 * top - 0.07;
    const k = Math.sin((i / 8) * Math.PI);
    // swept well back so the row reads from the top-down camera, not just in profile
    ridge.push(spike(0.65 + k * 0.6, 0.17 + k * 0.07, 0, y - 0.05, z, 0.85, 0, 0.12, 6));
    if (i % 2 === 0 && i > 0 && i < 8) {
      for (const s of [1, -1]) {
        const x = s * 0.62 * top, yy = 0.15 + 0.98 * top * 0.82 - 0.05;
        ridge.push(spike(0.36 + k * 0.18, 0.1, x, yy, z, 0.75, -s * 1.1));
      }
    }
  }
  batch(hips, mats.bone, ridge);

  const chest = joint(hips, ...A.chest, 'chest');
  chest.rotation.order = 'YXZ';
  const chestMesh = mesh(chest, ellipsoidGeometry(1.24, 1.06, 1.22, { widthSegs: 18, heightSegs: 12 }), mats.scales, 0, 0.05, 0.25);
  // molten chest plate pushing out at the front and underneath
  mesh(chest, ellipsoidGeometry(0.96, 0.8, 1.02, { widthSegs: 16, heightSegs: 10 }), mats.belly, 0, -0.32, 0.62);

  // --- neck chain: thick, a spiky crest on top and a small frill along the sides, lava throat
  const neckBase = joint(chest, ...A.neckBase, 'neckBase');
  neckBase.rotation.x = -0.6; // points forward-up (keeps chain aiming away from -Z)
  const neck = [];
  let parent = neckBase;
  for (let i = 0; i < A.neckSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.neckLen, `neck${i}`);
    const t = i / (A.neckSegs - 1);
    const r0 = THREE.MathUtils.lerp(0.74, 0.42, t);
    mesh(j, limbGeometry({ length: A.neckLen + 0.1, r0, r1: r0 - 0.04, sy: 0.92, radial: 12, rings: 4 }), mats.neck, 0, 0, -0.05);
    // lava throat: wider than the neck below its midline, so it shows along the lower sides too
    mesh(j, limbGeometry({ length: A.neckLen + 0.06, r0, r1: r0 - 0.04, sx: 0.96, sy: 0.8, radial: 12, rings: 3 }), mats.throat, 0, -r0 * 0.3, -0.03);
    const crest = [spike(0.7 - t * 0.16, 0.15, 0, r0 * 0.84, A.neckLen * 0.5, 0.9, 0, 0.15, 6)];
    for (const s of [1, -1]) crest.push(spike(0.34 + t * 0.12, 0.075, s * r0 * 0.66, r0 * 0.55, A.neckLen * 0.45, 0.9, -s * 1.15));
    batch(j, mats.bone, crest);
    neck.push(j);
    parent = j;
  }

  // --- head (child of the last neck joint, at the end of that segment)
  const head = joint(parent, 0, 0, A.neckLen, 'head');
  mesh(head, limbGeometry({ length: A.headLen, r0: 0.48, r1: 0.18, sx: 1.08, sy: 0.72, bulge: 0.05, radial: 14, rings: 6 }), mats.neck, 0, 0.04, -0.15);
  const browL = [], hornsG = [], teethG = [], mawG = [];
  for (const s of [1, -1]) {
    // brow ridges
    browL.push(place(ellipsoidGeometry(0.15, 0.11, 0.46, { widthSegs: 8, heightSegs: 6 }), s * 0.29, 0.27, 0.42, 0, s * 0.22, 0));
    // great swept-back horns curling up at the tips, a second pair below
    hornsG.push(horn(2.4, 0.21, s * 0.26, 0.27, 0.02, -0.22, Math.PI - s * 0.3, 0.55, 7));
    hornsG.push(horn(1.4, 0.13, s * 0.4, 0.04, 0.06, 0.02, Math.PI - s * 0.72, 0.3, 6));
    // frill: a fan of spikes behind the skull, sweeping back and out
    for (let k = 0; k < 4; k++) {
      hornsG.push(horn(0.95 - k * 0.14, 0.09 - k * 0.008, s * (0.2 + k * 0.08), 0.16 - k * 0.13, -0.08 - k * 0.02, -0.3 + k * 0.24, Math.PI - s * (0.45 + k * 0.24), 0.15));
    }
    // brow spikes and cheek / jaw-line spikes
    hornsG.push(spike(0.32, 0.07, s * 0.3, 0.32, 0.55, 1.1, -s * 0.5));
    for (let k = 0; k < 3; k++) hornsG.push(horn(0.5 - k * 0.1, 0.07, s * 0.42, -0.1 - k * 0.04, 0.12 + k * 0.2, 0.15, Math.PI - s * 0.85, 0));
    // upper teeth along the jaw line, big front fangs
    for (let k = 0; k < 5; k++) {
      const fang = k === 4;
      teethG.push(horn(fang ? 0.3 : 0.17 - k * 0.012, fang ? 0.055 : 0.04, s * (0.21 - k * 0.022), -0.13, 0.45 + k * 0.17, Math.PI / 2, 0, 0, 4));
    }
  }
  // crest spike on the skull top and a small nose horn
  hornsG.push(spike(0.62, 0.12, 0, 0.32, 0.1, 1.0, 0, 0.2));
  hornsG.push(spike(0.3, 0.08, 0, 0.17, 1.12, 0.85));
  batch(head, mats.neck, browL);
  batch(head, mats.bone, hornsG);
  batch(head, mats.teeth, teethG);
  // the maw: glowing roof of the mouth (hidden inside the skull + jaw when closed)
  mawG.push(place(ellipsoidGeometry(0.25, 0.07, 0.62, { widthSegs: 10, heightSegs: 6 }), 0, -0.17, 0.62));
  batch(head, mats.maw, mawG);
  // eyes (glow driven by uGlow / uInkGlow on the eye material)
  const eyes = [];
  for (const s of [1, -1]) {
    const e = mesh(head, ellipsoidGeometry(0.12, 0.085, 0.17, { widthSegs: 8, heightSegs: 6 }), mats.eye, s * 0.31, 0.15, 0.52);
    e.rotation.y = s * 0.3;
    eyes.push(e);
  }
  const nostrils = [joint(head, 0.12, 0.12, 1.42, 'nostrilL'), joint(head, -0.12, 0.12, 1.42, 'nostrilR')];
  const mouth = joint(head, 0, -0.1, 1.5, 'mouth');
  // hinged lower jaw: lower teeth + the glowing floor of the mouth
  const jaw = joint(head, 0, -0.16, 0.0, 'jaw');
  mesh(jaw, limbGeometry({ length: 1.34, r0: 0.32, r1: 0.12, sx: 0.95, sy: 0.44, radial: 10, rings: 5 }), mats.neck, 0, -0.05, 0);
  const lowTeeth = [];
  for (const s of [1, -1]) {
    for (let k = 0; k < 4; k++) lowTeeth.push(horn(k === 3 ? 0.22 : 0.14, 0.038, s * (0.18 - k * 0.022), 0.0, 0.4 + k * 0.19, -Math.PI / 2, 0, 0, 4));
    lowTeeth.push(horn(0.32, 0.06, s * 0.3, -0.06, 0.15, 0.1, Math.PI - s * 0.9, 0)); // jaw-hinge spike
  }
  batch(jaw, mats.teeth, lowTeeth);
  batch(jaw, mats.maw, [place(ellipsoidGeometry(0.2, 0.05, 0.55, { widthSegs: 10, heightSegs: 6 }), 0, 0.02, 0.58)]);

  // --- tail chain (tailBase points backward): spikes on top and sides, lava underside, spiked end
  const tailBase = joint(hips, ...A.tailBase, 'tailBase');
  tailBase.rotation.y = Math.PI;
  const tail = [];
  const tailRadii = [];
  parent = tailBase;
  for (let i = 0; i < A.tailSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.tailLen, `tail${i}`);
    const t = i / A.tailSegs;
    const r0 = 0.08 + 0.7 * Math.pow(1 - t, 0.95);
    const r1 = 0.08 + 0.7 * Math.pow(1 - (i + 1) / A.tailSegs, 0.95);
    tailRadii.push(r0);
    // aGUV +y toward the body (TAIL_FLIP): chevrons point down the tail
    mesh(j, limbGeometry({ length: A.tailLen + 0.08, r0, r1, sy: 0.9, radial: 10, rings: 3, flip: TAIL_FLIP }), mats.scales, 0, 0, -0.04);
    if (i < 12) mesh(j, limbGeometry({ length: A.tailLen + 0.04, r0: r0 * 0.96, r1: r1 * 0.96, sx: 0.96, sy: 0.78, radial: 10, rings: 2, flip: TAIL_FLIP }), mats.lava, 0, -r0 * 0.3, -0.02);
    const sp = [spike(0.66 - t * 0.36, 0.15 - t * 0.07, 0, r0 * 0.84, A.tailLen * 0.5, -0.85, 0, -0.1)];
    if (i < 13) for (const s of [1, -1]) sp.push(spike(0.42 - t * 0.22, 0.075 - t * 0.02, s * r0 * 0.8, r0 * 0.25, A.tailLen * 0.45, -0.7, -s * 1.3));
    batch(j, mats.bone, sp);
    tail.push(j);
    parent = j;
  }
  const tailTip = joint(parent, 0, 0, A.tailLen, 'tailTip');
  const tipG = [];
  for (const [yaw, pitch, len, r] of [
    [0, -0.08, 1.15, 0.16], [0.5, -0.3, 0.85, 0.12], [-0.5, -0.3, 0.85, 0.12], [1.0, -0.15, 0.6, 0.1],
    [-1.0, -0.15, 0.6, 0.1], [0, -0.95, 0.7, 0.11], [0, 0.55, 0.45, 0.08],
  ]) {
    tipG.push(horn(len, r, 0, 0, -0.12, pitch, yaw, 0, 5));
  }
  batch(tailTip, mats.bone, tipG);

  // --- hind legs: heavy thighs (lava on the inner side), big ivory claws
  const legs = [];
  for (const s of [1, -1]) {
    mesh(hips, ellipsoidGeometry(0.62, 0.86, 0.98), mats.scales, s * A.hipJoint[0], A.hipJoint[1] + 0.2, A.hipJoint[2] + 0.05);
    const hip = joint(hips, s * A.hipJoint[0], A.hipJoint[1], A.hipJoint[2], s > 0 ? 'hipL' : 'hipR');
    hip.rotation.x = Math.PI / 2; // +Z points down
    const thigh = joint(hip, 0, 0, 0, 'thigh');
    mesh(thigh, limbGeometry({ length: A.thigh + 0.1, r0: 0.66, r1: 0.38, bulge: 0.14, radial: 12, rings: 5, flip: true }), mats.scales, 0, 0, -0.05);
    mesh(thigh, limbGeometry({ length: A.thigh - 0.05, r0: 0.52, r1: 0.3, bulge: 0.1, sx: 0.85, radial: 10, rings: 4, flip: true }), mats.lava, -s * 0.32, 0, 0.05);
    const shin = joint(thigh, 0, 0, A.thigh, 'shin');
    mesh(shin, limbGeometry({ length: A.shin + 0.06, r0: 0.38, r1: 0.22, radial: 10, rings: 4, flip: true }), mats.scales);
    const meta = joint(shin, 0, 0, A.shin, 'meta');
    mesh(meta, limbGeometry({ length: A.meta + 0.05, r0: 0.24, r1: 0.18, radial: 8, rings: 3, flip: true }), mats.scales);
    const toe = joint(meta, 0, 0, A.meta, 'toe');
    mesh(toe, ellipsoidGeometry(0.31, 0.16, 0.34, { widthSegs: 8, heightSegs: 6 }), mats.scales, 0, 0.02, 0.1);
    const claws = [];
    for (const yaw of [-0.48, 0, 0.48]) claws.push(horn(0.88, 0.13, Math.sin(yaw) * 0.15, 0.02, 0.16, 0.26, yaw, -0.24, 6));
    claws.push(horn(0.42, 0.08, 0, 0.1, -0.12, -0.2, Math.PI, -0.1));
    batch(toe, mats.claw, claws);
    legs.push({ side: s, hip, thigh, shin, meta, toe });
  }

  // --- wings (forelimbs): humerus -> forearm -> wrist -> fingers, plus thumb claw
  const wings = [];
  for (const s of [1, -1]) {
    const shoulder = joint(chest, s * A.shoulder[0], A.shoulder[1], A.shoulder[2], s > 0 ? 'shoulderL' : 'shoulderR');
    shoulder.rotation.y = (s * Math.PI) / 2; // +Z points outward
    mesh(chest, ellipsoidGeometry(0.62, 0.66, 0.82), mats.scales, s * (A.shoulder[0] - 0.1), A.shoulder[1] + 0.1, A.shoulder[2]);
    const humerus = joint(shoulder, 0, 0, 0, 'humerus');
    mesh(humerus, limbGeometry({ length: A.humerus + 0.08, r0: 0.4, r1: 0.23, bulge: 0.07, radial: 10, rings: 4, flip: true }), mats.scales);
    const forearm = joint(humerus, 0, 0, A.humerus, 'forearm');
    mesh(forearm, limbGeometry({ length: A.forearm + 0.06, r0: 0.25, r1: 0.16, radial: 8, rings: 5 }), mats.wingBone);
    const wrist = joint(forearm, 0, 0, A.forearm, 'wrist');
    mesh(wrist, ellipsoidGeometry(0.25, 0.22, 0.29, { widthSegs: 8, heightSegs: 6 }), mats.scales);
    const fingers = A.fingers.map((len, k) => {
      const f = joint(wrist, 0, 0, 0, `finger${k}`);
      // bone + a spike at the tip, one mesh
      const g = [limbGeometry({ length: len, r0: 0.12, r1: 0.045, radial: 6, rings: 5, capSegs: 2 }), horn(0.6, 0.07, 0, 0, len - 0.06, 0, 0, -0.18)];
      batch(f, mats.wingBone, g);
      return f;
    });
    const thumb = joint(wrist, 0, 0, 0, 'thumb');
    mesh(thumb, hornGeometry(0.95, 0.15, { radial: 6, curve: -0.26 }), mats.claw);
    const shoulderAttach = joint(chest, s * 0.95, 0.35, 0.1, 'shoulderAttach');
    const hipAttach = joint(hips, s * 0.9, 0.25, -0.25, 'hipAttach');
    const membrane = new WingMembrane(mats.membrane, s);
    root.add(membrane.mesh);
    wings.push({ side: s, shoulder, humerus, forearm, wrist, fingers, thumb, shoulderAttach, hipAttach, membrane });
  }

  return {
    root, mats, glow: GLOW, hips, torso, chest, chestMesh, neckBase, neck, head, jaw, eyes, nostrils, mouth,
    tailBase, tail, tailRadii, tailTip, legs, wings,
  };
}
