import * as THREE from 'three';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry } from '../../render/glyphGeometry.js';
import { ANATOMY as A } from './tuning.js';
import { WingMembrane } from './membrane.js';

// Procedural wyvern: a hierarchy of Object3D joints carrying rigid glyph-skinned meshes.
// Every bone joint points its local +Z down the bone; the next joint sits at (0, 0, length).
// Root = ground point under the torso, facing +Z, model-left = +X (side sign s = +1).

/** Set true to make tail chevrons point back toward the body instead of toward the tip. */
export const TAIL_FLIP = false;

const SCALE_BASE = {
  base: [0.012, 0.01, 0.011],
  ink: [0.42, 0.34, 0.3],
  inkAlt: [0.75, 0.16, 0.05],
  altChance: 0.25,
  glyphs: '.v^A',
  cell: [0.2, 0.24],
  rowShift: 0.5,
  gain: 2.5,
  lumScale: 1.5,
  rim: 0.35,
  emissive: [1.0, 0.28, 0.04],
};

export function createDragonMaterials(U) {
  const mats = {
    scales: createSurfaceGlyphMaterial(U, { ...SCALE_BASE, seed: 11.3 }),
    // neck + head get their own instance so the throat can charge (uGlow) independently
    neck: createSurfaceGlyphMaterial(U, { ...SCALE_BASE, cell: [0.18, 0.22], seed: 23.7 }),
    belly: createSurfaceGlyphMaterial(U, {
      base: [0.03, 0.017, 0.009],
      ink: [0.5, 0.31, 0.12],
      inkAlt: [0.62, 0.36, 0.12],
      altChance: 0.15,
      glyphs: '.-=#',
      cell: [0.32, 0.2],
      rowShift: 0,
      gain: 2.2,
      lumScale: 1.6,
      rim: 0.2,
      emissive: [1.0, 0.32, 0.05],
      glowMask: 0.7,
      seed: 5.1,
    }),
    membrane: createSurfaceGlyphMaterial(U, {
      base: [0.018, 0.007, 0.006],
      ink: [0.36, 0.11, 0.06],
      inkAlt: [0.55, 0.15, 0.06],
      altChance: 0.15,
      glyphs: '.:/|',
      cell: [0.26, 0.32],
      rowShift: 0.5,
      gain: 2.2,
      lumScale: 1.6,
      rim: 0.25,
      emissive: [1.0, 0.25, 0.04],
      glowMask: 0.35,
      side: THREE.DoubleSide,
      seed: 41.9,
    }),
    bone: createSurfaceGlyphMaterial(U, {
      base: [0.06, 0.05, 0.045],
      ink: [0.78, 0.72, 0.62],
      glyphs: '.:|I',
      cell: [0.12, 0.16],
      rowShift: 0.5,
      gain: 2.4,
      lumScale: 1.6,
      rim: 0.4,
      glowMask: 0,
      seed: 7.7,
    }),
    eye: createSurfaceGlyphMaterial(U, {
      base: [0.03, 0.006, 0.002],
      ink: [1.0, 0.36, 0.06],
      glyphs: '%@#@',
      cell: [0.08, 0.08],
      rowShift: 0,
      gain: 1.0,
      lumScale: 1.0,
      rim: 0,
      emissive: [3.0, 0.75, 0.12],
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

/** Spike/horn pointing up and tilted along local -Z (back) by `tilt` radians (negative tilts forward). */
function spike(parent, mat, len, r, x, y, z, tilt = 0.5) {
  const h = mesh(parent, hornGeometry(len, r, { radial: 5 }), mat, x, y, z);
  h.rotation.x = -(Math.PI / 2 + tilt);
  return h;
}

export function buildWyvern(U) {
  const mats = createDragonMaterials(U);
  const root = new THREE.Group();
  root.name = 'dragon';

  // --- hips / torso
  const hips = joint(root, 0, A.hipY, A.hipZ, 'hips');
  hips.rotation.order = 'YXZ';
  const torso = mesh(hips, ellipsoidGeometry(1.2, 0.92, 2.15, { widthSegs: 18, heightSegs: 12 }), mats.scales, 0, 0.15, 1.05);
  mesh(hips, ellipsoidGeometry(1.0, 0.7, 1.95), mats.belly, 0, -0.28, 1.1);
  // dorsal ridge along the back
  for (let i = 0; i < 6; i++) {
    const z = -0.55 + i * 0.62;
    const t = (z - 1.05) / 2.15;
    const y = 0.15 + 0.92 * Math.sqrt(Math.max(0, 1 - t * t)) - 0.06;
    spike(hips, mats.bone, 0.42 + Math.sin((i / 5) * Math.PI) * 0.2, 0.1, 0, y, z, 0.55);
  }

  const chest = joint(hips, ...A.chest, 'chest');
  chest.rotation.order = 'YXZ';
  const chestMesh = mesh(chest, ellipsoidGeometry(1.12, 0.98, 1.15, { widthSegs: 16, heightSegs: 10 }), mats.scales, 0, 0.05, 0.25);
  mesh(chest, ellipsoidGeometry(0.9, 0.6, 0.95), mats.belly, 0, -0.42, 0.3);

  // --- neck chain
  const neckBase = joint(chest, ...A.neckBase, 'neckBase');
  neckBase.rotation.x = -0.6; // points forward-up (keeps chain aiming away from -Z)
  const neck = [];
  let parent = neckBase;
  for (let i = 0; i < A.neckSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.neckLen, `neck${i}`);
    const t = i / (A.neckSegs - 1);
    const r0 = THREE.MathUtils.lerp(0.64, 0.4, t);
    mesh(j, limbGeometry({ length: A.neckLen + 0.1, r0, r1: r0 - 0.035, sy: 0.92, radial: 12, rings: 4 }), mats.neck, 0, 0, -0.05);
    spike(j, mats.bone, 0.32 - t * 0.12, 0.08, 0, r0 * 0.86, A.neckLen * 0.5, 0.6);
    neck.push(j);
    parent = j;
  }

  // --- head (child of the last neck joint, at the end of that segment)
  const head = joint(parent, 0, 0, A.neckLen, 'head');
  mesh(head, limbGeometry({ length: A.headLen, r0: 0.44, r1: 0.17, sx: 1.05, sy: 0.7, bulge: 0.05, radial: 12, rings: 6 }), mats.neck, 0, 0.04, -0.15);
  // brow ridges
  for (const s of [1, -1]) {
    const brow = mesh(head, ellipsoidGeometry(0.13, 0.1, 0.4, { widthSegs: 8, heightSegs: 6 }), mats.neck, s * 0.27, 0.25, 0.42);
    brow.rotation.y = s * 0.22;
  }
  // swept-back horns (two pairs)
  for (const s of [1, -1]) {
    const h1 = mesh(head, hornGeometry(1.3, 0.15, { radial: 6, curve: 0.35 }), mats.bone, s * 0.25, 0.22, 0.02);
    h1.rotation.order = 'YXZ';
    h1.rotation.set(-0.32, Math.PI - s * 0.3, 0);
    const h2 = mesh(head, hornGeometry(0.72, 0.1, { radial: 5, curve: 0.2 }), mats.bone, s * 0.38, -0.02, 0.05);
    h2.rotation.order = 'YXZ';
    h2.rotation.set(-0.08, Math.PI - s * 0.75, 0);
  }
  // upper fangs
  for (const s of [1, -1]) {
    const f = mesh(head, hornGeometry(0.24, 0.05, { radial: 4 }), mats.bone, s * 0.13, -0.12, 1.02);
    f.rotation.x = Math.PI / 2;
  }
  // eyes (glow driven by uGlow / uInkGlow on the eye material)
  const eyes = [];
  for (const s of [1, -1]) {
    const e = mesh(head, ellipsoidGeometry(0.11, 0.08, 0.16, { widthSegs: 8, heightSegs: 6 }), mats.eye, s * 0.3, 0.14, 0.52);
    e.rotation.y = s * 0.3;
    eyes.push(e);
  }
  const nostrils = [joint(head, 0.12, 0.12, 1.42, 'nostrilL'), joint(head, -0.12, 0.12, 1.42, 'nostrilR')];
  const mouth = joint(head, 0, -0.1, 1.5, 'mouth');
  // hinged lower jaw
  const jaw = joint(head, 0, -0.16, 0.0, 'jaw');
  mesh(jaw, limbGeometry({ length: 1.32, r0: 0.3, r1: 0.11, sx: 0.92, sy: 0.42, radial: 10, rings: 5 }), mats.neck, 0, -0.05, 0);
  for (const s of [1, -1]) {
    const f = mesh(jaw, hornGeometry(0.18, 0.045, { radial: 4 }), mats.bone, s * 0.11, 0.0, 0.95);
    f.rotation.x = -Math.PI / 2;
  }

  // --- tail chain (tailBase points backward)
  const tailBase = joint(hips, ...A.tailBase, 'tailBase');
  tailBase.rotation.y = Math.PI;
  const tail = [];
  const tailRadii = [];
  parent = tailBase;
  for (let i = 0; i < A.tailSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.tailLen, `tail${i}`);
    const t = i / A.tailSegs;
    const r0 = 0.08 + 0.66 * Math.pow(1 - t, 0.95);
    const r1 = 0.08 + 0.66 * Math.pow(1 - (i + 1) / A.tailSegs, 0.95);
    tailRadii.push(r0);
    // aGUV +y toward the tip (no flip); glyph direction can be inverted with TAIL_FLIP
    mesh(j, limbGeometry({ length: A.tailLen + 0.08, r0, r1, sy: 0.9, radial: 10, rings: 3, flip: TAIL_FLIP }), mats.scales, 0, 0, -0.04);
    if (i < 10) spike(j, mats.bone, 0.3 - t * 0.16, 0.07, 0, r0 * 0.85, A.tailLen * 0.5, -0.5);
    tail.push(j);
    parent = j;
  }
  const tailTip = joint(parent, 0, 0, A.tailLen, 'tailTip');
  for (const [yaw, pitch, len] of [[0, -0.1, 0.8], [0.6, -0.35, 0.55], [-0.6, -0.35, 0.55], [0.0, -0.9, 0.5]]) {
    const sp = mesh(tailTip, hornGeometry(len, 0.11, { radial: 5 }), mats.bone, 0, 0, -0.1);
    sp.rotation.order = 'YXZ';
    sp.rotation.set(pitch, yaw, 0);
  }

  // --- hind legs
  const legs = [];
  for (const s of [1, -1]) {
    mesh(hips, ellipsoidGeometry(0.55, 0.78, 0.9), mats.scales, s * A.hipJoint[0], A.hipJoint[1] + 0.2, A.hipJoint[2] + 0.05);
    const hip = joint(hips, s * A.hipJoint[0], A.hipJoint[1], A.hipJoint[2], s > 0 ? 'hipL' : 'hipR');
    hip.rotation.x = Math.PI / 2; // +Z points down
    const thigh = joint(hip, 0, 0, 0, 'thigh');
    mesh(thigh, limbGeometry({ length: A.thigh + 0.1, r0: 0.58, r1: 0.34, bulge: 0.12, radial: 12, rings: 5 }), mats.scales, 0, 0, -0.05);
    const shin = joint(thigh, 0, 0, A.thigh, 'shin');
    mesh(shin, limbGeometry({ length: A.shin + 0.06, r0: 0.33, r1: 0.2, radial: 10, rings: 4 }), mats.scales);
    const meta = joint(shin, 0, 0, A.shin, 'meta');
    mesh(meta, limbGeometry({ length: A.meta + 0.05, r0: 0.21, r1: 0.16, radial: 8, rings: 3 }), mats.scales);
    const toe = joint(meta, 0, 0, A.meta, 'toe');
    mesh(toe, ellipsoidGeometry(0.26, 0.14, 0.3, { widthSegs: 8, heightSegs: 6 }), mats.scales, 0, 0.02, 0.1);
    for (const yaw of [-0.45, 0, 0.45]) {
      const c = mesh(toe, hornGeometry(0.55, 0.085, { radial: 5, curve: -0.12 }), mats.bone, Math.sin(yaw) * 0.12, 0.02, 0.15);
      c.rotation.order = 'YXZ';
      c.rotation.set(0.22, yaw, 0);
    }
    const dew = mesh(toe, hornGeometry(0.3, 0.06, { radial: 4 }), mats.bone, 0, 0.1, -0.1);
    dew.rotation.y = Math.PI;
    legs.push({ side: s, hip, thigh, shin, meta, toe });
  }

  // --- wings (forelimbs): humerus -> forearm -> wrist -> fingers, plus thumb claw
  const wings = [];
  for (const s of [1, -1]) {
    const shoulder = joint(chest, s * A.shoulder[0], A.shoulder[1], A.shoulder[2], s > 0 ? 'shoulderL' : 'shoulderR');
    shoulder.rotation.y = (s * Math.PI) / 2; // +Z points outward
    mesh(chest, ellipsoidGeometry(0.5, 0.55, 0.7), mats.scales, s * (A.shoulder[0] - 0.1), A.shoulder[1] + 0.1, A.shoulder[2]);
    const humerus = joint(shoulder, 0, 0, 0, 'humerus');
    mesh(humerus, limbGeometry({ length: A.humerus + 0.08, r0: 0.34, r1: 0.2, bulge: 0.06, radial: 10, rings: 4 }), mats.scales);
    const forearm = joint(humerus, 0, 0, A.humerus, 'forearm');
    mesh(forearm, limbGeometry({ length: A.forearm + 0.06, r0: 0.22, r1: 0.15, radial: 8, rings: 4 }), mats.scales);
    const wrist = joint(forearm, 0, 0, A.forearm, 'wrist');
    mesh(wrist, ellipsoidGeometry(0.22, 0.2, 0.26, { widthSegs: 8, heightSegs: 6 }), mats.scales);
    const fingers = A.fingers.map((len, k) => {
      const f = joint(wrist, 0, 0, 0, `finger${k}`);
      mesh(f, limbGeometry({ length: len, r0: 0.12, r1: 0.04, radial: 6, rings: 4, capSegs: 2 }), mats.scales);
      return f;
    });
    const thumb = joint(wrist, 0, 0, 0, 'thumb');
    mesh(thumb, hornGeometry(0.55, 0.1, { radial: 5, curve: -0.18 }), mats.bone);
    const shoulderAttach = joint(chest, s * 0.95, 0.35, 0.1, 'shoulderAttach');
    const hipAttach = joint(hips, s * 0.9, 0.25, -0.25, 'hipAttach');
    const membrane = new WingMembrane(mats.membrane, s);
    root.add(membrane.mesh);
    wings.push({ side: s, shoulder, humerus, forearm, wrist, fingers, thumb, shoulderAttach, hipAttach, membrane });
  }

  return {
    root, mats, hips, torso, chest, chestMesh, neckBase, neck, head, jaw, eyes, nostrils, mouth,
    tailBase, tail, tailRadii, tailTip, legs, wings,
  };
}
