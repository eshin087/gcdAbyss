import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import { shellGeometry, bandGeometry, mergeGeometries, sub, orient, limb } from '../heroGeo.js';

// The undersuit: what covers the body where a loadout leaves `chest`, `arms` or `legs` empty, so
// the figure is never missing a torso or a limb (gear/index.js BASE_LOADOUT). A plain dark shirt
// and pants built from the same shell / limb builders and the same materials as the Wanderer's
// outfit, to the body's own measurements (ctx.BODY): no armour, no straps, bare hands.

/** A closed shirt over the torso shell (the coat's rings with the front shut), drawn in to a
 *  mandarin collar at the neck. */
function buildChest({ spine, chest, M, BODY, REST, mesh }) {
  const top = BODY.shell[BODY.shell.length - 1];
  const rings = [...BODY.shell, { y: top.y + 0.02, rx: 0.056, rz: 0.054 }].map((r) => ({ ...r, gap: 0, y: r.y - REST.spine }));
  mesh(spine, shellGeometry(rings, { sub: 3, cols: 28 }), M.shirt);
  mesh(chest, bandGeometry(0.052, 0.05, 0.03, 16), M.shirt, 0, 1.515 - REST.chest, 0.008);
}

/** Shirt sleeves to the wrist (sub-id 1: outlined against the torso) and bare hands. */
function buildArms({ arms, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  for (const side of [-1, 1]) {
    const { upper, fore } = arms[side < 0 ? 'R' : 'L'];
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0, r1: ua1, bulge: 0.004 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.02, 0), 1),
    ]), M.shirt);
    mesh(fore, mergeGeometries([
      sub(limb({ length: 0.09, r0: ua1, r1: ua1 - 0.003 }), 1),
      sub(limb({ length: 0.18, r0: fa0, r1: fa1, radial: 10, rings: 3 }).translate(0, -0.05, 0), 1),
    ]), M.shirt);
    mesh(fore, ellipsoidGeometry(0.042 * HK, 0.04 * HK, 0.055 * HK, { widthSegs: 10, heightSegs: 6 }), M.skin, 0, -DIM.foreArm - 0.006, 0.004);
  }
}

/** Pants from the hips to the ankles and plain soft shoes. */
function buildLegs({ pelvis, legs, M, DIM, BODY, mesh }) {
  const [hx, hy, hz] = BODY.hips.r;
  mesh(pelvis, orient.up(ellipsoidGeometry(hx, hz, hy)), M.pants, ...BODY.hips.c);
  const [th0, th1, thB] = BODY.thigh, [sh0, sh1, shB] = BODY.shin, F = BODY.foot;
  for (const side of ['R', 'L']) {
    const { thigh, shin, foot } = legs[side];
    mesh(thigh, limb({ length: DIM.thigh, r0: th0, r1: th1, bulge: thB }), M.pants);
    mesh(shin, sub(limb({ length: DIM.shin - 0.02, r0: sh0, r1: sh1, bulge: shB }), 1), M.pants, 0, -0.02, 0);
    mesh(foot, ellipsoidGeometry(...F.r, { widthSegs: 10, heightSegs: 6 }).translate(...F.c), M.pants);
  }
}

export const BASE_ITEMS = [
  { id: 'base.chest', slot: 'chest', name: 'Undershirt', build: buildChest },
  { id: 'base.arms', slot: 'arms', name: 'Shirt Sleeves', build: buildArms },
  { id: 'base.legs', slot: 'legs', name: 'Plain Pants', build: buildLegs },
];

/** slot → the item an empty slot falls back to. Slots not named here may be left empty. */
export const BASE_LOADOUT = Object.freeze({ chest: 'base.chest', arms: 'base.arms', legs: 'base.legs' });
