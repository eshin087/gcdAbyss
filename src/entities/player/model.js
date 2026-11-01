import * as THREE from 'three';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, planarGUV } from '../../render/glyphGeometry.js';

// The knight rig: a joint hierarchy with SurfaceGlyph meshes hung on it. Faces +Z, Y up.
// The character's RIGHT is −X. Hands and feet are placed by IK (anim.js); the joints here only
// define bone lengths and rest offsets.
//
//   root (yaw) → body (waist pivot: rolls / falls) → pelvis → spine → chest → head
//                                                        │                 ├ arms (upper → fore)
//                                                        │                 └ cape0 → cape1 → cape2
//                                                        └ legs (thigh → shin → foot)
//   body → sword (posed directly in body space; origin = grip, blade along +Z)

export const DIM = {
  pivot: 1.08, // body pivot height when standing
  pelvis: [0, -0.12, 0],
  hip: [0.1, -0.06, 0],
  spine: [0, 0.08, 0],
  chest: [0, 0.2, 0],
  shoulder: [0.22, 0.24, 0],
  neck: [0, 0.32, 0],
  upperArm: 0.28,
  foreArm: 0.27, // elbow → grip centre
  thigh: 0.42,
  shin: 0.42,
  ankle: 0.08, // ankle height with the foot flat on the ground
  capeAnchor: [0, 0.22, -0.15],
  capeSeg: [0.34, 0.32, 0.3],
  bladeBase: 0.12, // hit segment along the sword's +Z (hilt side)
  bladeTip: 1.08,
};

// Builder geometries run along native +Z with the aGUV seam on native −Y. Re-orient them so the
// seam ends up on the back/underside where the high camera rarely looks.
const orient = {
  down(g) {
    g.rotateX(Math.PI / 2); // +Z → −Y, seam → −Z
    return g;
  },
  up(g) {
    g.rotateX(-Math.PI / 2); // +Z → +Y
    g.rotateY(Math.PI); // seam → −Z
    return g;
  },
  out(g) {
    g.rotateY(Math.PI / 2); // +Z → +X
    return g;
  },
};

/** Flat tapered cloth panel hanging down −Y from its joint (exact length: no capsule caps), with
 *  glyphs running down the cloth. Slightly overlong so bent segments don't open gaps. */
function capePanel(len, w0, w1, thick = 0.03) {
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 3, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = 0.5 - pos.getY(i); // 0 top → 1 bottom
    pos.setXYZ(i, pos.getX(i) * (w0 + (w1 - w0) * t), -t * (len + 0.03), pos.getZ(i) * thick);
  }
  g.computeVertexNormals();
  return planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
}

export function createKnightMaterials(U) {
  const steel = createSurfaceGlyphMaterial(U, {
    base: [0.02, 0.022, 0.026], ink: [0.55, 0.6, 0.68], glyphs: '.:=#',
    cell: [0.07, 0.09], gain: 2.5, lumScale: 1.7, rim: 0.6,
  });
  const mail = createSurfaceGlyphMaterial(U, {
    base: [0.016, 0.017, 0.02], ink: [0.44, 0.48, 0.55], glyphs: '.oO0',
    cell: [0.06, 0.07], gain: 2.3, lumScale: 1.6, rim: 0.5,
  });
  const cloth = createSurfaceGlyphMaterial(U, {
    base: [0.03, 0.006, 0.005], ink: [0.28, 0.05, 0.04], inkAlt: [0.4, 0.08, 0.05], altChance: 0.2,
    glyphs: '.:/|', cell: [0.07, 0.09], gain: 3.0, lumScale: 1.6, rim: 0.5, side: THREE.DoubleSide,
  });
  const leather = createSurfaceGlyphMaterial(U, {
    base: [0.018, 0.013, 0.01], ink: [0.32, 0.23, 0.16], glyphs: '.:-=',
    cell: [0.06, 0.07], gain: 2.2, rim: 0.45,
  });
  const blade = createSurfaceGlyphMaterial(U, {
    base: [0.06, 0.066, 0.08], ink: [0.78, 0.85, 1.0], glyphs: '.-=I',
    cell: [0.035, 0.06], gain: 3.2, lumScale: 1.9, rim: 0.9, inkGlow: 0.3, emissive: [0.6, 0.8, 1.5],
  });
  const dark = createSurfaceGlyphMaterial(U, {
    base: [0.002, 0.002, 0.003], ink: [0.05, 0.05, 0.06], glyphs: '.',
    cell: [0.03, 0.03], gain: 1, rim: 0.1, glowMask: 0,
  });
  const flask = createSurfaceGlyphMaterial(U, {
    base: [0.12, 0.08, 0.02], ink: [1.1, 0.85, 0.3], glyphs: '.:o0',
    cell: [0.025, 0.03], gain: 2, rim: 0.3, inkGlow: 1.4, glowMask: 0,
  });
  return { steel, mail, cloth, leather, blade, dark, flask };
}

export function buildKnight(U) {
  const M = createKnightMaterials(U);

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

  // belt + crimson tabard skirt
  mesh(pelvis, orient.up(ellipsoidGeometry(0.175, 0.15, 0.05)), M.leather, 0, 0.08, 0);
  mesh(pelvis, orient.down(limbGeometry({ length: 0.3, r0: 0.165, r1: 0.205, sx: 1, sy: 0.8, radial: 12 })), M.cloth, 0, 0.06, 0);

  const spine = joint(pelvis, ...DIM.spine);
  mesh(spine, orient.up(ellipsoidGeometry(0.15, 0.125, 0.14)), M.mail, 0, 0.07, 0); // abdomen
  const chest = joint(spine, ...DIM.chest);
  mesh(chest, orient.up(ellipsoidGeometry(0.205, 0.155, 0.215)), M.steel, 0, 0.1, 0.01); // breastplate
  mesh(chest, orient.up(limbGeometry({ length: 0.1, r0: 0.075, r1: 0.065, radial: 8 })), M.mail, 0, 0.26, 0); // gorget

  // helmet: dome, dark visor slit, short crimson crest
  const head = joint(chest, ...DIM.neck);
  mesh(head, orient.up(ellipsoidGeometry(0.125, 0.135, 0.15)), M.steel, 0, 0.13, 0);
  mesh(head, ellipsoidGeometry(0.1, 0.02, 0.05, { widthSegs: 10, heightSegs: 6 }), M.dark, 0, 0.14, 0.1);
  mesh(head, ellipsoidGeometry(0.022, 0.05, 0.13, { widthSegs: 8, heightSegs: 6 }), M.cloth, 0, 0.27, -0.03);

  const arms = {};
  for (const side of [-1, 1]) {
    // pauldron rides on the chest; its outer edge droops
    const p = mesh(chest, ellipsoidGeometry(0.115, 0.1, 0.12), M.steel, side * 0.25, 0.27, 0);
    p.rotation.z = -side * 0.4;
    const upper = joint(chest, side * DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
    mesh(upper, orient.down(limbGeometry({ length: DIM.upperArm, r0: 0.068, r1: 0.056 })), M.mail);
    const fore = joint(upper, 0, -DIM.upperArm, 0);
    mesh(fore, orient.down(limbGeometry({ length: 0.25, r0: 0.058, r1: 0.048 })), M.steel);
    mesh(fore, orient.down(ellipsoidGeometry(0.05, 0.045, 0.065, { widthSegs: 10, heightSegs: 6 })), M.steel, 0, -DIM.foreArm - 0.015, 0.005);
    arms[side < 0 ? 'R' : 'L'] = { upper, fore };
  }
  // small round shield strapped to the left forearm (faces the forearm's +X = outward)
  mesh(arms.L.fore, orient.out(ellipsoidGeometry(0.19, 0.19, 0.035, { widthSegs: 18, heightSegs: 8 })), M.steel, 0.075, -0.14, 0.02);
  mesh(arms.L.fore, orient.out(ellipsoidGeometry(0.05, 0.05, 0.03, { widthSegs: 8, heightSegs: 6 })), M.steel, 0.105, -0.14, 0.02);
  // estus-like flask, shown only while healing
  const flask = mesh(arms.L.fore, orient.up(ellipsoidGeometry(0.036, 0.036, 0.055, { widthSegs: 10, heightSegs: 6 })), M.flask, 0, -DIM.foreArm - 0.03, 0.06);
  flask.visible = false;

  const legs = {};
  for (const side of [-1, 1]) {
    const thigh = joint(pelvis, side * DIM.hip[0], DIM.hip[1], DIM.hip[2]);
    mesh(thigh, orient.down(limbGeometry({ length: DIM.thigh, r0: 0.088, r1: 0.066, bulge: 0.01 })), M.mail);
    const shin = joint(thigh, 0, -DIM.thigh, 0);
    mesh(shin, orient.down(limbGeometry({ length: 0.4, r0: 0.066, r1: 0.05 })), M.steel);
    mesh(shin, ellipsoidGeometry(0.055, 0.055, 0.045, { widthSegs: 8, heightSegs: 6 }), M.steel, 0, 0, 0.045); // knee cop
    const foot = joint(shin, 0, -DIM.shin, 0);
    mesh(foot, ellipsoidGeometry(0.055, 0.05, 0.12, { widthSegs: 10, heightSegs: 6 }), M.leather, 0, -0.025, 0.045);
    legs[side < 0 ? 'R' : 'L'] = { thigh, shin, foot };
  }

  // crimson cape: 3 hanging segments simulated as a lagging spring chain
  const cape = [];
  const capeW = [[0.34, 0.4], [0.4, 0.44], [0.44, 0.4]];
  let parent = chest;
  for (let i = 0; i < 3; i++) {
    const j = i === 0 ? joint(parent, ...DIM.capeAnchor) : joint(parent, 0, -DIM.capeSeg[i - 1], 0);
    mesh(j, capePanel(DIM.capeSeg[i], capeW[i][0], capeW[i][1]), M.cloth);
    cape.push(j);
    parent = j;
  }

  // longsword: origin at the grip, blade along +Z (wide along X, flat faces ±Y)
  const sword = joint(body);
  mesh(sword, limbGeometry({ length: 0.98, r0: 0.036, r1: 0.012, sx: 1, sy: 0.26, radial: 8, rings: 8, capSegs: 2 }), M.blade, 0, 0, 0.1);
  mesh(sword, ellipsoidGeometry(0.12, 0.024, 0.026, { widthSegs: 10, heightSegs: 6 }), M.steel, 0, 0, 0.085); // crossguard
  mesh(sword, limbGeometry({ length: 0.17, r0: 0.02, r1: 0.02, radial: 6, rings: 3 }), M.leather, 0, 0, -0.09); // grip
  mesh(sword, ellipsoidGeometry(0.032, 0.032, 0.032, { widthSegs: 8, heightSegs: 6 }), M.steel, 0, 0, -0.11); // pommel

  const mats = Object.values(M);
  return {
    root, body, pelvis, spine, chest, head, arms, legs, cape, sword, flask,
    materials: M,
    mats,
    // joints sampled for body-attached FX (burn flames)
    fxPoints: [chest, chest, pelvis, head, arms.R.upper, arms.L.upper, legs.R.thigh, legs.L.thigh, legs.R.shin, legs.L.shin],
  };
}
