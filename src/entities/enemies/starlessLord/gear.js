import * as THREE from 'three';
import { ellipsoidGeometry, limbGeometry } from '../../../render/glyphGeometry.js';
import { registerItem } from '../../player/gear/index.js';
import { boxGeometry, bandGeometry, mergeGeometries, sub, limb, spike, gripFist, looseHand, lerp } from '../../player/heroGeo.js';

// The Starless Lord's outfit: gear items on the hero's skeleton, so he is built by the same
// buildHero(U, loadout) and driven by the same animator. A dark lord from the stars (the owner's
// pick): a closed black helm with a red visor slit and a crown of swept-back horns, the Wanderer's
// greatcoat, pauldron, boots and coat tails recoloured black and crimson, armoured sleeves and
// gauntlets of his own, a cape, and the blades of red light.
// The colours are his own material instances (lord.js _tint): `coat` = black cloth, `lining` /
// `facing` = crimson, `armor` / `spike` = black plate, `bevel` / `trim` = dark gunmetal, `flask` = the
// blades' red light (its ink lines burn gold-white: a hot core in a red glow), `shirt` = gauntlets.
//
// The blades (weapon space: origin = the grip centre, the main blade along +Z). One hilt carries
// every form's steel; lord.js shows what the current form ignites:
//   lordBladeA    the main blade (forms 1, 2, 3; longer in form 4)
//   lordBladeB    the staff's second blade, out of the pommel (form 3) + lordHiltB, the joined hilt
//   lordQuillons  the cross-hilt's two short side blades (form 4)
// The off-hand blade of form 2 hangs on a joint of its own (lord.js builds it from saberParts).

/** The hilt and the blades (m, weapon space). */
export const SABER = Object.freeze({
  gripBack: 0.14, // the grip runs from −gripBack …
  guard: 0.15, // … to the emitter
  tip: 1.2, // the main blade's point
  tip4: 1.36, // … in form 4 (the cross-hilted blade)
  hiltB: 0.4, // the joined hilt runs back to −hiltB (form 3)
  tipB: 1.42, // the second blade's point at −tipB (form 3)
  quillon: 0.2, // the side blades' length (form 4)
  r: 0.017, // blade radius
});

/**
 * The saber's pieces as geometries (weapon space): { hilt, grip, bladeA (origin at the emitter, along
 * +Z, 1 m long: scaled to its length), bladeB (origin at the back emitter, along −Z, 1 m), hiltB,
 * quillons }.
 */
export function saberParts() {
  const S = SABER;
  const band = (z0, z1, r, k) => sub(limbGeometry({ length: z1 - z0, r0: r, r1: r, radial: 7, rings: 1 }).translate(0, 0, z0), k);
  // the hilt: a ribbed black grip between two gunmetal collars, the emitter shroud at the blade end
  const grip = [];
  for (let k = 0; k < 6; k++) grip.push(band(-S.gripBack + 0.03 + k * 0.035, -S.gripBack + 0.03 + (k + 1) * 0.035 - 0.004, 0.0165, k & 1));
  const hilt = mergeGeometries([
    band(-S.gripBack, -S.gripBack + 0.03, 0.021, 0),
    band(S.guard - 0.05, S.guard - 0.012, 0.022, 0),
    band(S.guard - 0.012, S.guard, 0.026, 1),
    boxGeometry(0.012, 0.03, 0.05, 0, 0.022, S.guard - 0.06), // the activation stud
  ]);
  const blade = (dir) => {
    const g = limbGeometry({ length: 1, r0: S.r * 1.15, r1: S.r * 0.8, radial: 6, rings: 8 });
    if (dir < 0) g.rotateY(Math.PI);
    return g;
  };
  const hiltB = mergeGeometries([
    band(-S.hiltB, -S.hiltB + 0.014, 0.026, 1),
    band(-S.hiltB + 0.014, -S.hiltB + 0.06, 0.022, 0),
    ...[0, 1, 2, 3, 4].map((k) => band(-S.hiltB + 0.06 + k * 0.038, -S.hiltB + 0.06 + (k + 1) * 0.038 - 0.004, 0.0165, k & 1)),
  ]);
  const q = (s) => limbGeometry({ length: S.quillon, r0: S.r * 0.9, r1: S.r * 0.55, radial: 5, rings: 3 }).rotateY((s * Math.PI) / 2).translate(s * 0.02, 0, S.guard + 0.012);
  return { hilt, grip: mergeGeometries(grip), bladeA: blade(1), bladeB: blade(-1), hiltB, quillons: mergeGeometries([q(-1), q(1)]) };
}

// ---------------------------------------------------------------- head: the helm
/** A closed helm (head space): a black dome, a smooth faceplate with one red visor slit, a neck
 *  guard, and a crown of five swept-back horns that echoes the throne's spikes. */
function buildHelm({ head, M, DIM, mesh }) {
  const [sx, sy, sz] = DIM.skull;
  mesh(head, mergeGeometries([
    sub(ellipsoidGeometry(0.098, 0.112, 0.11, { widthSegs: 14, heightSegs: 10 }).translate(sx, sy + 0.012, sz - 0.004), 0),
    sub(ellipsoidGeometry(0.07, 0.088, 0.045, { widthSegs: 12, heightSegs: 8 }).translate(sx, sy - 0.04, sz + 0.078), 1),
    sub(bandGeometry(0.082, 0.088, 0.07, 18).translate(sx, sy - 0.1, sz - 0.004), 1),
  ]), M.armor);
  // the visor: one slit of red light, and a breather below it
  mesh(head, boxGeometry(0.108, 0.013, 0.016, sx, sy - 0.006, sz + 0.112), M.flask);
  mesh(head, mergeGeometries([
    boxGeometry(0.03, 0.04, 0.012, sx, sy - 0.074, sz + 0.112),
    boxGeometry(0.012, 0.11, 0.014, sx, sy + 0.05, sz + 0.1), // the brow ridge running up into the crest
  ]), M.bevel);
  const horns = [];
  for (const s of [-1, 1]) {
    horns.push(spike(0.2, 0.024, [sx + s * 0.07, sy + 0.07, sz - 0.01], [s * 0.42, 0.72, -0.55], [0, 0.2, -1], 0.3, 5, 0.6));
    horns.push(spike(0.14, 0.02, [sx + s * 0.092, sy + 0.01, sz - 0.03], [s * 0.7, 0.35, -0.62], [0, 0.2, -1], 0.3, 5, 0.6));
  }
  horns.push(spike(0.24, 0.024, [sx, sy + 0.1, sz + 0.01], [0, 0.82, -0.57], [0, 0.2, -1], 0.34, 5, 0.5));
  mesh(head, mergeGeometries(horns), M.spike);
}

// ---------------------------------------------------------------- arms: plate sleeves and gauntlets
/** Black cloth to the elbow, a plate vambrace on each forearm, gauntlets: the sword hand closed
 *  round the grip (on the `sword` joint), the free hand open or (two-handed) closed below it. */
function buildArms({ arms, sword, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand * 1.08;
  let open = null, grip = null;
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]), M.shirt);
  }
  for (const side of [-1, 1]) {
    const R = side < 0;
    const { upper, fore } = arms[R ? 'R' : 'L'];
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.004, r1: ua1 + 0.004, bulge: 0.008 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.02, 0), 1),
      sub(ellipsoidGeometry(ua1 + 0.008, ua1 + 0.006, ua1 + 0.01, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.upperArm, -0.004), 1),
    ]), M.coat);
    // the vambrace: three overlapping plates stepping down to the wrist
    const plates = [];
    const n = 3, y0 = -0.06, y1 = -DIM.foreArm + 0.07;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(y0, y1, t), r = lerp(fa0, fa1, t) + 0.012 - 0.003 * i;
      plates.push(sub(limb({ length: (y0 - y1) / (n - 1) + 0.03, r0: r, r1: r - 0.006, radial: 10, rings: 2, capSegs: 1 }).translate(0, y + 0.012, 0), i & 1));
    }
    mesh(fore, sub(limb({ length: 0.08, r0: ua1 + 0.004, r1: fa0 + 0.006 }), 1), M.coat);
    mesh(fore, mergeGeometries(plates), M.armor);
    mesh(fore, limb({ length: 0.05, r0: fa1 - 0.002, r1: fa1, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.075, 0), M.shirt);
    if (R) {
      mesh(fore, ellipsoidGeometry(0.036 * HK, 0.042 * HK, 0.044 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004), M.shirt);
    } else {
      const H = looseHand(DIM.foreArm - 0.03, side, HK);
      open = mesh(fore, mergeGeometries([H.palm, H.fingers, H.tips, H.thumb]), M.shirt);
      open.name = 'lordOpenHand';
      const F = gripFist(HK);
      grip = mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]).translate(0, 0, -DIM.offGrip - 0.02), M.shirt);
      grip.visible = false;
    }
  }
  return { offHand: { open, grip }, keep: [open, grip] };
}

// ---------------------------------------------------------------- weapon: the blades of red light
function buildSaber({ sword, M, mesh }) {
  const S = SABER, G = saberParts();
  mesh(sword, G.hilt, M.trim);
  mesh(sword, G.grip, M.shirt);
  const named = (name, geo, mat, z) => {
    const m = mesh(sword, geo, mat, 0, 0, z);
    m.name = name;
    return m;
  };
  const a = named('lordBladeA', G.bladeA, M.flask, S.guard);
  a.scale.z = S.tip - S.guard;
  const hb = named('lordHiltB', G.hiltB, M.trim, 0);
  const b = named('lordBladeB', G.bladeB, M.flask, -S.hiltB);
  b.scale.z = S.tipB - S.hiltB;
  const q = named('lordQuillons', G.quillons, M.flask, 0);
  hb.visible = b.visible = q.visible = false;
  return { keep: [a, hb, b, q] };
}

/** The off-hand saber of form 2 (lord.js hangs it on a joint at the left wrist): hilt, blade, fist. */
export function buildOffSaber(M) {
  const S = SABER, G = saberParts();
  const root = new THREE.Object3D();
  root.name = 'lordOffSaber';
  root.rotation.order = 'YXZ';
  const add = (geo, mat, z = 0, name = '') => {
    if (!geo.attributes.aPart) sub(geo, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    m.name = name;
    root.add(m);
    return m;
  };
  add(G.hilt, M.trim);
  add(G.grip, M.shirt);
  const F = gripFist(1.08);
  add(mergeGeometries([F.fingers, F.thumb, F.ridge]), M.shirt);
  const blade = add(G.bladeA, M.flask, S.guard, 'lordBladeL');
  blade.scale.z = S.tip - S.guard;
  return { root, blade };
}

/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const LORD_ITEMS = [
  { id: 'lord.helm', slot: 'head', name: 'Starless Helm', hidesHair: true, shadowsFace: true, build: buildHelm },
  { id: 'lord.arms', slot: 'arms', name: 'Void Gauntlets', build: buildArms },
  { id: 'lord.saber', slot: 'weapon', name: 'Blade of Red Light', dims: SABER, build: buildSaber },
];
for (const item of LORD_ITEMS) registerItem(item);

/** What the Starless Lord wears. */
export const LORD_LOADOUT = Object.freeze({
  head: 'lord.helm',
  chest: 'wanderer.coat',
  shoulders: 'wanderer.pauldron',
  arms: 'lord.arms',
  legs: 'wanderer.legs',
  waist: 'wanderer.skirt',
  back: 'wanderer.cape',
  weapon: 'lord.saber',
});
