import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSurfaceGlyphMaterial } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry, cylindricalGUV } from '../../render/glyphGeometry.js';
import { ANATOMY as A, SCALE } from './tuning.js';
import { WingMembrane } from './membrane.js';
import { WING_KEYS } from './rig/anim.js';

// Procedural four-legged drake ("Obsidian Drake", owner concept sheet; build spec docs/art/dragon.md):
// a hierarchy of Object3D joints carrying rigid glyph-skinned meshes. Every bone joint points its
// local +Z down the bone; the next joint sits at (0, 0, length).
// Root = ground point under the torso, facing +Z, model-left = +X (side sign s = +1).
// All numbers here are MODEL units; the root is scaled by SCALE (tuning.js) into world metres.
//
// Body plan (v0.4): deep barrel chest on columnar forelegs (elbow back), massive digitigrade hind
// legs (knee forward, hock high), a short thick upright S-neck, a long tail lying in a sideways hook,
// and a SEPARATE pair of bat wings rooted on top of the back behind the neck base (4 two-joint
// fingers each, held half-raised like tall sails at rest). The v0.3 wyvern walked on its wings.

/**
 * Tail aGUV +y runs toward the body (flipped), like the limbs below, so directional glyphs point
 * down the tail toward its tip. Set false to flip them back.
 */
export const TAIL_FLIP = true;

// ---- materials (docs/art/dragon.md §3.2) ------------------------------------------------------
// What the player sees is the ASCII-art source WYRM_ART (below; uArtSolid 1). The surface-glyph
// options here are the patterned render behind the look-dev A/B (uArtSolid 0).
// Per-cell glyph variants (`levels`, dark → bright, a space = empty cell): the hide reads as dense
// mixed blocky glyphs instead of one chevron. Every glyph must be in the world atlas (npm test).
// Five hide levels: even the darkest prints small glyphs (the panel fills ~95 % of the silhouette;
// shadowed flanks print grey letters, not black), lit tops climb to the blocky white '8B0A' set.
const HIDE_LEVELS = ['vco:ce.o', ':vco;(ce', 'AVSDC5?K', 'AVSD8B0K', '8B0A69&Y'];
const NECK_LEVELS = ['vco:ce.o', ':vco;(ce', 'AVSDC5?K', 'AVSD8B0O', '8B0O69&A'];
const LAVA_LEVELS = [' .:.', 'vcuo', 'VAUO', '8A0#'];
// sternum / belly: no chevron-heavy rows (they stacked into a radiator grille on the keel)
const BELLY_LEVELS = [' .:.', 'vcuo', 'VAU', '8A0'];
// the membrane is mostly glyph-filled even on its shadowed / backlit side (the panel: ~85 %)
const MEMBRANE_LEVELS = ['.:co', 'oc:e', 'oeCs', 'O068'];
const WINGBONE_LEVELS = ['.:..', ':|!:', '|!l|', '|!A8'];
const SPINE_LEVELS = [".:.'", '^!|:', '^A^!', 'AA^8'];
// horns / spikes: dark obsidian; lit glyphs only on the brightest level (thin silver edges)
const BONE_LEVELS = ['.:..', '.::.', ':..:', 'A|!A'];
const CLAW_LEVELS = ['.:|!', '|!Y|', 'V|Y!', 'YV|A'];

// obsidian hide: warm-white lit tops, grey flanks, near-black gaps, ~8 % ember scales. The inks are
// pre-warmed against the blue moon (a neutral ink read lavender: bright-glyph B - R ~ +24 sRGB);
// inkGlow is the shading floor (shadowed flanks still print grey glyphs, as the panel does).
// The phase-1 crack glow runs in sparse irregular voronoi fissures (a glowing cell lattice read as
// tiles, a dense fissure net as a giraffe pattern).
const OBSIDIAN = {
  levels: HIDE_LEVELS,
  levelInk: [
    [0.26, 0.23, 0.2],
    [0.32, 0.28, 0.24],
    [0.42, 0.36, 0.29],
    [0.5, 0.43, 0.34],
    [0.64, 0.52, 0.38],
  ],
  base: [0.016, 0.012, 0.013],
  cell: [0.2, 0.24],
  rowShift: 0.5,
  lumScale: 2.0,
  glyphZoom: 0.74, // glyphs fill most of the cell (the panel's dense field), a thin black gap remains
  ink: [0.5, 0.43, 0.34],
  inkAlt: [0.85, 0.3, 0.07], // ember scales
  altChance: 0.08,
  gain: 2.4,
  rim: 0.4,
  outline: 0,
  inkGlow: 0.25, // shading floor
  emissive: [1.0, 0.36, 0.06],
  crack: 'voronoi',
  crackScale: 3.5,
  crackWidth: 0.7,
};
// molten parts: orange glyphs that glow on their own (visible on the shadowed underside)
const LAVA = {
  levels: LAVA_LEVELS,
  base: [0.16, 0.03, 0.008],
  cell: [0.19, 0.22],
  rowShift: 0.5,
  lumScale: 3.0,
  ink: [1.0, 0.42, 0.1],
  inkAlt: [1.0, 0.7, 0.32],
  altChance: 0.2,
  gain: 1.6,
  rim: 0.15,
  outline: 0,
  inkGlow: 0.55,
  emissive: [1.0, 0.34, 0.05],
  glowMask: 1,
  crack: 'voronoi',
};

/**
 * Crack-glow (uGlow) per material, applied by Dragon._applyMaterials every frame:
 * [phase-1 ember baseline, x this.glow (phase 2 0.5, dying 0.85), x throat charge (breath / roar)].
 * The eye material is driven separately (eye glow follows rig.s.eyes). docs/art/dragon.md §2.9.
 * The ASCII-art source (WYRM_ART) multiplies its vein / gap glow by these: the owner's reference
 * shows the molten fissures from the start (chest, throat, undersides strongest, sparse on the back).
 */
export const GLOW = {
  scales: [0.35, 0.5, 0], // the cracks in the scale gaps (undersides); phase 2: they wake up
  limbs: [0.32, 0.5, 0], // legs, tail, wing arm: as scales
  neck: [0.32, 0.7, 0.3], // the throat strip carries the molten S and its charge
  head: [0.3, 0.7, 0.2], // skull, brow and jaw: as the neck, a little heat while the breath charges
  belly: [0.5, 1.0, 0.3],
  throat: [0.5, 0.9, 2.4], // calm at rest, a strong flare while the breath / roar charges (the tell)
  lava: [0.5, 1.0, 0],
  membrane: [0.35, 0.8, 0.3], // embers along the bones and in specks
  wingBone: [0.15, 0.35, 0],
  spine: [0.3, 0.8, 0],
  bone: [0.08, 0.5, 0],
  claw: [0, 0, 0],
  teeth: [0, 0, 0.5],
  maw: [0.55, 0.6, 1.3],
};

/**
 * ASCII-art source per material (createSurfaceGlyphMaterial `wyrm`, render/materials.js): the image
 * the art pass turns into letters, matched to the owner's red-black reference. The hide is dark
 * charcoal shingle scales (aGUV units, tips toward -y: tailward on the body, down the limbs) whose
 * free edges catch a camera key light; molten plates glow in their gaps; the membrane is crimson.
 *   scale [w, h] · tone [gap, body, rim, rimW] · gap [rows, px] · ink · rimInk
 *   light [gain, key, fresnel, floor] · key [right, up, toward] · envSat
 *   vein [strength, share, width, plate] · glow [gaps, all] · under [r, g, b, k] · membrane
 */
const UNDER = [1.0, 0.3, 0.06, 0.8]; // lava light from below: the orange spill under jaw and belly
// every part: the key light from the viewer's upper left (the reference's light: silver upper
// edges, the lower half left to the lava's orange under-light), the blue moon mostly greyed out
// (horns and bones read lavender), thin black gaps between the scales (a wide gap drew a black
// diamond lattice over the hide)
const LIT = { key: [-0.5, 0.9, 1.0], envSat: 0.3, gap: [0.12, 3.5] };
// The hide's scales are drawn by letter BRIGHTNESS only (strokes 'none'): the bright free edges pass
// through the digits as the reference's white scale outlines. Stroke glyphs on every rim printed a
// field of '\ / |' chevrons ('Y V ^' noise from the game camera, plank-like bars in close-ups).
const HIDE_ART = {
  ...LIT,
  scale: [0.42, 0.32],
  strokes: 'none',
  // darker scale bodies, brighter and thinner free edges: crisp white outlines on charcoal
  tone: [0.0, 0.11, 2.0, 0.16],
  vary: 0.35, // an even charcoal (a scale-to-scale lottery of greys read as noise)
  ink: [0.34, 0.31, 0.29],
  light: [1.0, 0.55, 0.25, 0.03],
  // molten cracks in the scale gaps, only where the hide faces down (the reference's cracks on the
  // lower flanks, legs and tail underside; a voronoi net over the whole back read as red worms)
  crack: [22, 0.1, -0.4, 0.6],
  under: UNDER,
};
// molten undersides: the reference's chest is grey scales lit orange from below with gold rims and
// glowing cracks between them, not a lamp (an all-over glow flattened it into a smooth orange blob)
const LAVA_ART = {
  ...LIT,
  scale: [0.36, 0.27],
  strokes: 'none',
  tone: [0.0, 0.22, 1.7, 0.22],
  vary: 0.5,
  ink: [0.45, 0.3, 0.22],
  rimInk: [0.85, 0.5, 0.25],
  light: [1.0, 0.55, 0.25, 0.04],
  crack: [14, 0.3, -0.9, 0.15],
  glow: [1.4, 0.02],
  under: [1.0, 0.3, 0.06, 1.2],
};
export const WYRM_ART = {
  // barrel (torso, ribcage, rump, haunches, shoulders: aGUV around the body axis, bodyGUV below):
  // roof-tile scales hanging from the dorsal line, [along the body, around it]
  scales: { ...HIDE_ART, scaleDir: 'down', scale: [0.48, 0.34] },
  // limbs and neck: scales big enough to read as shapes at the reference view (~3-4 letters across;
  // smaller ones printed as letter noise)
  limbs: { ...HIDE_ART, scale: [0.3, 0.23] },
  neck: { ...HIDE_ART, scale: [0.4, 0.3] },
  // the head keeps fine scales (the neck's big plates turned the skull into a few flat tiles)
  head: { ...HIDE_ART, scale: [0.2, 0.15], crack: [12, 0.06, -0.3, 0.7] },
  // the sternum: the brightest scales on the body, lit gold from below (the reference's focal chest)
  belly: { ...LAVA_ART, scale: [0.56, 0.4], tone: [0.0, 0.24, 2.0, 0.22], ink: [0.42, 0.34, 0.29], rimInk: [0.85, 0.55, 0.3], glow: [1.2, 0], under: [1.0, 0.32, 0.07, 1.5] },
  // the throat: orange-lit scales with amber rims, kept under the bloom threshold at rest (a gold
  // hot spot glowed like a lamp under the jaw); it still flares for the breath / roar charge
  // (round 2: the reference's throat S is the brightest body area after the maw: hotter gaps and
  // under-light than round 1's calm strip, still under the bloom threshold)
  throat: { ...LAVA_ART, scale: [0.4, 0.3], tone: [0.0, 0.28, 1.5, 0.24], ink: [0.55, 0.3, 0.16], rimInk: [0.95, 0.52, 0.2], glow: [1.8, 0.06], under: [1.0, 0.3, 0.06, 1.4] },
  lava: LAVA_ART,
  // deep crimson, blotched, torn: [mottle, ember specks, tear noise frequency, trailing-edge tears]
  // (its embers and bone streaks glow orange, not the hide's red-orange: the reference's sails carry
  // orange-yellow sparks)
  // (round 2: the reference's sails glow orange along the finger bones and carry more sparks: a wider,
  // hotter bone streak and denser specks)
  membrane: { ...LIT, ink: [0.5, 0.045, 0.03], light: [1.0, 0.3, 0.15, 0.02], membrane: [0.8, 0.085, 2.0, 0.62], boneGlow: [0.65, 0.1, 1.05], emit: [1.0, 0.45, 0.1], under: UNDER },
  // finger bones: charcoal lines with pale outlines, a little ember along them
  wingBone: { ...LIT, ink: [0.3, 0.29, 0.28], light: [1.0, 0.45, 0.45, 0.02], vein: [1.2, 0.5, 0.06, 0.6], strokes: 'axis', strokeEdge: 0.2, under: UNDER },
  // dorsal / tail blades: charcoal with pale edges and tips, molten red at the root only (the
  // reference's tail blades: grey-white blades over a red-orange glow; a glow up 60 % of each blade
  // printed them as flat salmon-orange teeth and the tail read too orange)
  spine: { ...LIT, ink: [0.34, 0.3, 0.28], light: [1.0, 0.15, 1.5, 0.02], tip: [0.0, 0.3, 0.3, 3.0], emit: [1.0, 0.11, 0.02], strokes: 'axis', under: UNDER },
  // horns, head / limb spikes: dark obsidian, outlined in strokes (only at the very edge: wider bands
  // hatched every horn into a plank), bright tips
  bone: { ...LIT, ink: [0.4, 0.38, 0.37], light: [1.0, 0.35, 1.6, 0.02], tip: [0.0, 0.5, 0.3, 0], strokes: 'axis', strokeEdge: 0.35, under: UNDER },
  // talons: dark roots curving into bright ivory tips, letters inside a stroked outline (strokes all
  // over drew each foot as a hatched broom)
  claw: { ...LIT, ink: [0.42, 0.4, 0.37], light: [1.0, 0.55, 0.5, 0.03], tip: [0.0, 0.45, 0.25, 0], strokes: 'axis', strokeEdge: 0.3, under: UNDER },
  teeth: { ...LIT, ink: [0.85, 0.83, 0.78], light: [1.0, 0.6, 0.3, 0.12], strokes: 'axis', strokeEdge: 0, under: UNDER },
  // fire inside the mouth: deep red-orange and dimmer than the fangs, so the white teeth read on it
  maw: { ink: [0.8, 0.14, 0.02], light: [0.3, 0.1, 0, 0.04], glow: [0, 0.42], emit: [1.0, 0.16, 0.025] },
  eye: { ink: [0.45, 0.12, 0.02], light: [0.3, 0, 0, 0.05], glow: [0, 1.0], emit: [0.85, 0.17, 0.02] },
};

/**
 * Brightness of the generic smooth art source (FLAG.ART without the `wyrm` option). The wyrm's
 * materials all carry WYRM_ART, whose wyrmMain source replaces it; kept for the generic path.
 */
export const ART_GAIN = 0.28;

export function createDragonMaterials(U) {
  // every part also carries its ASCII-art source (WYRM_ART): what the letters are made from
  const mat = (key, o) => createSurfaceGlyphMaterial(U, { ...o, wyrm: WYRM_ART[key] });
  const mats = {
    // back / flanks / shoulders / haunches: mixed blocky glyphs over obsidian
    scales: mat('scales', { ...OBSIDIAN, seed: 11.3 }),
    // legs, tail and the wing arm: the same hide, its fissures stretched along the limb
    limbs: mat('limbs', { ...OBSIDIAN, seamAxis: 'y', seed: 47.3 }),
    // neck + head + neck shingles get their own instance (finer cells, the 'O' in the lit set)
    neck: mat('neck', {
      ...OBSIDIAN,
      levels: NECK_LEVELS,
      cell: [0.17, 0.21],
      altChance: 0.1,
      seamAxis: 'y',
      seed: 23.7,
    }),
    // skull, brow and jaw: the neck's surface, its own (finer) ASCII-art scales
    head: mat('head', { ...OBSIDIAN, levels: NECK_LEVELS, cell: [0.17, 0.21], altChance: 0.1, seamAxis: 'y', seed: 61.7 }),
    // sternum plate + belly strip: molten plates, fissures running down the keel
    belly: mat('belly', { ...LAVA, levels: BELLY_LEVELS, cell: [0.24, 0.22], seamAxis: 'y', gain: 1.1, inkGlow: 0.6, seed: 5.1 }),
    // throat strip under the neck: lava that charges before the breath / roar
    throat: mat('throat', { ...LAVA, cell: [0.16, 0.2], seed: 17.9 }),
    // inner thighs, armpits, leg back-edge strips, tail underside
    lava: mat('lava', { ...LAVA, altChance: 0.15, inkGlow: 0.5, seed: 29.4 }),
    // wing membranes: a straight grid of round red glyphs, seams running out along the fingers
    membrane: mat('membrane', {
      levels: MEMBRANE_LEVELS,
      cell: [0.22, 0.26],
      rowShift: 0,
      seamAxis: 'y',
      glyphZoom: 0.8, // each round glyph keeps a black gap (the panel's dotted membrane)
      base: [0.1, 0.014, 0.011],
      lumScale: 3.0,
      ink: [0.45, 0.08, 0.05],
      inkAlt: [1.0, 0.38, 0.08],
      altChance: 0.12,
      gain: 2.0,
      rim: 0.2,
      outline: 0,
      inkGlow: 0.2, // the sail reads red from both sides (a bat wing is translucent; the backlit side was empty)
      emissive: [1.0, 0.3, 0.05],
      glowMask: 0.7,
      side: THREE.DoubleSide,
      seed: 41.9,
    }),
    // wing forearm + finger bones: single bright white glyph lines
    wingBone: mat('wingBone', {
      levels: WINGBONE_LEVELS,
      cell: [0.13, 0.2],
      base: [0.045, 0.043, 0.048],
      lumScale: 2.6,
      ink: [0.58, 0.56, 0.54],
      gain: 1.7,
      rim: 0.2,
      outline: 0,
      inkGlow: 0.05, // below the bloom threshold: thin white lines, not neon tubes
      emissive: [1.0, 0.34, 0.05],
      glowMask: 0.3,
      seed: 37.1,
    }),
    // dorsal blade row nape -> tail tip, tail blades, wrist spikes: the orange "spine line"
    spine: mat('spine', {
      levels: SPINE_LEVELS,
      cell: [0.1, 0.15],
      base: [0.05, 0.02, 0.012],
      lumScale: 3.2,
      ink: [0.95, 0.45, 0.12],
      inkAlt: [1.0, 0.7, 0.3],
      altChance: 0.2,
      gain: 2.0,
      rim: 0.35,
      outline: 0,
      inkGlow: 0.35,
      emissive: [1.0, 0.38, 0.06],
      glowMask: 1,
      seed: 31.3,
    }),
    // horns, head spikes, limb / shoulder shards, neck shingles: dark obsidian, silver edges
    bone: mat('bone', {
      levels: BONE_LEVELS,
      cell: [0.1, 0.16],
      base: [0.07, 0.068, 0.075],
      lumScale: 2.8,
      ink: [0.48, 0.46, 0.45],
      inkAlt: [0.85, 0.3, 0.07],
      altChance: 0.1,
      gain: 1.9,
      rim: 0.25,
      outline: 0,
      inkGlow: 0.02, // dark obsidian: the eye and the maw are the head's bright points
      emissive: [1.0, 0.34, 0.05],
      glowMask: 0.5,
      seed: 7.7,
    }),
    // claws, thumb hooks, finger-tip claws: heavy ivory
    claw: mat('claw', {
      levels: CLAW_LEVELS,
      cell: [0.09, 0.15],
      base: [0.14, 0.12, 0.1],
      lumScale: 3.5,
      ink: [0.9, 0.84, 0.72],
      gain: 2.4,
      rim: 0.4,
      outline: 0,
      inkGlow: 0.12, // ivory, legible in shadow, without a bloom halo
      glowMask: 0,
      seed: 13.9,
    }),
    // teeth: bright white even inside the dark mouth
    teeth: mat('teeth', {
      ascii: 'strands',
      glyphs: ".'|!",
      cell: [0.06, 0.09],
      base: [0.3, 0.27, 0.23],
      lumScale: 3.0,
      outline: 0,
      ink: [1.0, 0.96, 0.88],
      gain: 2.0,
      rim: 0.3,
      inkGlow: 0.08, // separate needles against the fire, not one glowing grille
      emissive: [1.0, 0.45, 0.1],
      glowMask: 0.6,
      seed: 19.3,
    }),
    // the maw: fire inside the mouth (the jaw rests a little open, so it glows at idle)
    maw: mat('maw', {
      ascii: 'smooth',
      glyphs: '.*%#',
      cell: [0.08, 0.1],
      base: [0.3, 0.05, 0.01], // deep: the fangs silhouette against it
      lumScale: 2.0,
      outline: 0,
      ink: [1.0, 0.4, 0.07], // deep orange fire (a yellow-white maw swallowed the ivory teeth)
      gain: 1.0,
      rim: 0,
      inkGlow: 1.15,
      emissive: [1.0, 0.4, 0.06],
      glowMask: 1,
      seed: 2.7,
    }),
    // eyes: small almond slits, self-lit through uInkGlow / uGlow while awake
    eye: mat('eye', {
      ascii: 'smooth',
      glyphs: '%@#@',
      cell: [0.1, 0.1],
      base: [0.09, 0.02, 0.005],
      lumScale: 2.2,
      outline: 0,
      ink: [1.0, 0.42, 0.06],
      gain: 1.0,
      rim: 0,
      emissive: [2.2, 0.8, 0.1], // a small amber slit, not a glowing patch
      glowMask: 1,
      inkGlow: 0,
      seed: 3.3,
    }),
  };
  // generic art-source brightness (only used if a part ever drops its WYRM_ART source)
  for (const m of Object.values(mats)) m.uniforms.uArtGain.value = ART_GAIN;
  return mats;
}

// ---- small builders --------------------------------------------------------------------------
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

// static detail (spikes, horns, teeth, claws) is baked into one merged mesh per joint + material
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Transform `geo` in place: rotation (Euler rx, ry, rz in `order`) then translation. */
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e), _one);
  return geo.applyMatrix4(_m4);
}

/** Cone along +Z, optionally flattened across (`flat` < 1 scales local x: a blade, not a needle). */
function cone(len, r, curve = 0, radial = 5, flat = 1) {
  const g = hornGeometry(len, r, { radial, curve });
  if (flat !== 1) g.scale(flat, 1, 1);
  return g;
}

/**
 * Spike (a horn along +Z) standing up from a surface: points up (+Y), leaning back toward -Z by
 * `tilt` rad (negative leans toward +Z), then rolled sideways by `roll` (+ leans toward -X).
 * A positive `curve` sweeps the tip further back; `flat` < 1 makes it a thin blade.
 */
function spike(len, r, x, y, z, tilt = 0.5, roll = 0, curve = 0, radial = 5, flat = 1) {
  return place(cone(len, r, curve, radial, flat), x, y, z, -(Math.PI / 2 + tilt), 0, roll, 'ZYX');
}

/** Horn / claw along +Z, aimed by pitch (+ = toward -Y) and yaw (Euler YXZ, like Object3D rotations). */
function horn(len, r, x, y, z, pitch, yaw, curve = 0, radial = 5, flat = 1) {
  return place(cone(len, r, curve, radial, flat), x, y, z, pitch, yaw, 0, 'YXZ');
}

/**
 * A talon: a cone of length `len` along +Z bent along a circular arc of `bend` rad toward -Y (its
 * length kept: a real hook, where hornGeometry's quadratic `curve` only shears a straight cone).
 * aGUV is laid out on the straight cone, so glyphs run along the claw.
 */
function hookGeometry(len, r, bend, radial = 6) {
  const geo = new THREE.ConeGeometry(r, len, radial, 6, false);
  geo.translate(0, len / 2, 0);
  geo.rotateX(Math.PI / 2);
  cylindricalGUV(geo);
  const pos = geo.attributes.position;
  const R = len / Math.max(1e-3, bend);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), phi = z / R;
    pos.setY(i, -R + (R + y) * Math.cos(phi));
    pos.setZ(i, (R + y) * Math.sin(phi));
  }
  geo.computeVertexNormals();
  return geo;
}

/** limbGeometry from point a to point b (parent frame), transformed in place for batch(). */
function segGeo(a, b, opts) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  const g = limbGeometry({ radial: 8, rings: 3, capSegs: 2, ...opts, length: len });
  _q.setFromUnitVectors(Z_AXIS, _d.normalize());
  _m4.compose(_p.set(a[0], a[1], a[2]), _q, _one);
  return g.applyMatrix4(_m4);
}

/**
 * The painting's eagle-like foot on a paw / toe joint (local +Z forward, +Y up, ground at y 0): a pad
 * and thick knuckled toes splayed by yaw, each arching off the pad and ending in a long talon that
 * hooks down into the ground. toes: [[yaw, toe length, talon length], ...]. Returns the hide geometry
 * (pad, toes, knuckles) and the talons, for one batch each.
 */
function eagleFoot(toes, { pad = [0.5, 0.17, 0.46], padZ = 0.08, r = 0.15 } = {}) {
  const hide = [place(ellipsoidGeometry(pad[0], pad[1], pad[2], { widthSegs: 10, heightSegs: 6 }), 0, 0.13, padZ)];
  const claws = [];
  for (const [yaw, len, tl] of toes) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const at = (f, up) => [sn * f, up, padZ + c * f]; // along the toe's heading from the pad
    const p0 = at(0.1, 0.2), k = at(0.1 + len * 0.55, 0.27), t = at(0.1 + len, 0.15);
    hide.push(segGeo(p0, k, { r0: r, r1: r * 0.82 }), segGeo(k, t, { r0: r * 0.82, r1: r * 0.66 }));
    hide.push(place(ellipsoidGeometry(r * 1.08, r * 0.92, r * 1.12, { widthSegs: 7, heightSegs: 5 }), k[0], k[1], k[2], 0, yaw, 0, 'YXZ'));
    // the talon: a thick eagle's hook rising off the toe tip and curling ~110° down in front of it, its
    // point at the ground (long, gently bent cones read as the tines of a rake)
    claws.push(place(hookGeometry(tl, r * 1.0, 1.9), t[0], t[1] + 0.02, t[2], -0.55, yaw, 0, 'YXZ'));
  }
  return { hide, claws };
}

/** Merge `geos` into one mesh under `parent` (one draw call). */
function batch(parent, mat, geos) {
  if (!geos.length) return null;
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  return mesh(parent, geo, mat);
}

/** Tapered capsule from point a to point b (parent frame): pivot at a, local +Z toward b. */
function capsule(parent, mat, a, b, opts) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  const m = mesh(parent, limbGeometry({ radial: 12, rings: 5, ...opts, length: len }), mat, a[0], a[1], a[2]);
  m.quaternion.setFromUnitVectors(Z_AXIS, _d.normalize());
  return m;
}

/**
 * Re-map a barrel part's aGUV around the BODY axis (a line along its joint frame's +Z at height y0)
 * instead of the part's own axis: x = angle from the dorsal line x radius, y = z. The hide's 'down'
 * scales then hang from the spine on the ribcage, loins, rump, haunches and shoulders alike (a haunch
 * mapped around its own lateral axis radiated scales from its pole). Visual only.
 */
function bodyGUV(m, y0 = 0) {
  m.updateMatrix();
  const pos = m.geometry.attributes.position;
  const arr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
    const y = _p.y - y0;
    arr[i * 2] = Math.atan2(_p.x, y) * Math.max(0.05, Math.hypot(_p.x, y));
    arr[i * 2 + 1] = _p.z;
  }
  m.geometry.setAttribute('aGUV', new THREE.BufferAttribute(arr, 2));
  return m;
}

/** Linear interpolation over a sorted table of [x, y] pairs (clamped at the ends). */
function table(rows, x) {
  if (x <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const [x0, y0] = rows[i - 1], [x1, y1] = rows[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return rows[rows.length - 1][1];
}

// standing frames (root frame, model units): body joints and the dorsal profile (spec §2.3)
const HIP = [0, A.hipY, A.hipZ];
const CH = [0, A.hipY + A.chest[1], A.hipZ + A.chest[2]]; // (0, 2.85, 1.25)
const inHips = (x, y, z) => [x, y - HIP[1], z - HIP[2]];
const inChest = (x, y, z) => [x, y - CH[1], z - CH[2]];
// top of the back (no spikes) by root z: withers 4.1 over the shoulders sloping ~16° to the rump
const BACK = [
  [-2.6, 2.6],
  [-1.65, 2.95],
  [-0.9, 3.15],
  [-0.2, 3.38],
  [0.5, 3.85],
  [1.1, 4.08],
  [1.6, 4.02],
];
const backY = (z) => table(BACK, z);

/** Skull half-height profile along the head (head frame z): limb r0 0.44 -> r1 0.15, sy 0.7. */
const SKULL = { len: A.headLen, r0: 0.44, r1: 0.15, sy: 0.7, bulge: 0.03, z0: -0.12, y0: 0.04 };
function skullR(z) {
  const t = Math.min(1, Math.max(0, (z - SKULL.z0) / SKULL.len));
  return SKULL.r0 + (SKULL.r1 - SKULL.r0) * t + Math.sin(Math.PI * t) * SKULL.bulge;
}
const JAW = { len: 1.15, r0: 0.3, r1: 0.11, sx: 0.92, sy: 0.42, y0: -0.05 };
/** The mouth joint (head frame): breath / fireball origin, and the fixed point of the visual head scale. */
const MOUTH = [0, -0.12, 1.3];
/**
 * Drawn size of the head (visual only, see buildDrake's headVis): the owner's reference wyrm has a big,
 * fierce head; the gameplay joints (head, mouth) and every hit volume on them are unchanged.
 */
export const HEAD_VIS = 1.3;
function jawR(z) {
  const t = Math.min(1, Math.max(0, z / JAW.len));
  return JAW.r0 + (JAW.r1 - JAW.r0) * t;
}
/** Deterministic jitter in [-1, 1] (teeth lengths). */
const jit = (i) => {
  const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/**
 * Shingle plate on a tube of radius r (local +Z = along the tube): a flattened cone pointing back
 * down the tube (-Z), lifted `lift` rad off the skin, at `ang` rad around the tube from the top
 * (+Y) toward +X. `flat` = thickness across the skin normal (a blade lying on the surface).
 */
function shingle(len, w, r, ang, z, lift = 0.26, sy = 1, flat = 0.35) {
  const g = cone(len, w, 0, 4);
  g.scale(1, flat, 1); // thin across the skin normal: a plate lying on the surface
  g.rotateX(-lift);
  g.rotateY(Math.PI);
  g.rotateZ(-ang);
  g.translate(Math.sin(ang) * r, Math.cos(ang) * r * sy, z);
  return g;
}

export function buildDrake(U) {
  const mats = createDragonMaterials(U);
  const root = new THREE.Group();
  root.name = 'dragon';
  root.scale.setScalar(SCALE); // model units -> world metres (see tuning.js SCALE)

  // ============================================================ torso (spec §2.3)
  const hips = joint(root, HIP[0], HIP[1], HIP[2], 'hips');
  hips.rotation.order = 'YXZ';
  // waist (loins): poles buried in the ribcage and the rump
  const torso = mesh(hips, ellipsoidGeometry(0.95, 0.8, 1.45, { widthSegs: 20, heightSegs: 12 }), mats.scales, ...inHips(0, 2.55, -0.2));
  bodyGUV(torso, 0.05);
  // molten belly strip under the loins
  mesh(hips, ellipsoidGeometry(0.8, 0.45, 1.4, { widthSegs: 16, heightSegs: 8 }), mats.belly, ...inHips(0, 2.05, -0.1));
  // rump / pelvis (back pole inside the tail root)
  bodyGUV(mesh(hips, ellipsoidGeometry(0.95, 0.62, 1.05, { widthSegs: 18, heightSegs: 10 }), mats.scales, ...inHips(0, 2.35, -1.65)), 0.05);
  // haunches: lateral-axis ellipsoids, poles buried in the rump and the thigh's hip cap
  for (const s of [1, -1]) {
    const h = mesh(hips, ellipsoidGeometry(0.85, 0.72, 0.5, { widthSegs: 14, heightSegs: 8 }), mats.scales, ...inHips(s * 0.82, 2.42, -1.35));
    h.rotation.y = (s * Math.PI) / 2;
    bodyGUV(h, 0.05);
  }

  const chest = joint(hips, ...A.chest, 'chest');
  chest.rotation.order = 'YXZ';
  // ribcage: deeper than wide, tilted chest-up so its front pole runs into the neck base
  const chestMesh = mesh(chest, ellipsoidGeometry(1.05, 1.25, 1.5, { widthSegs: 22, heightSegs: 14 }), mats.scales, 0, 0, 0);
  chestMesh.rotation.x = -0.28;
  bodyGUV(chestMesh, 0);
  // molten sternum / keel plate: a capsule along the throat-to-belly line (no pole faces a camera);
  // its lowest point is the 1.4 keel
  capsule(chest, mats.belly, inChest(0, 2.02, 0.85), inChest(0, 2.95, 2.1), { r0: 0.62, r1: 0.7, bulge: 0.16, sx: 1.08 });
  // the molten seam down the sternum (continues the throat's S onto the keel): a narrow hot strip
  capsule(chest, mats.throat, inChest(0, 1.86, 1.05), inChest(0, 3.3, 2.32), { r0: 0.72, r1: 0.78, bulge: 0.2, sx: 0.25, radial: 10, rings: 6 });
  // shoulder masses (scapulae): slabs sloping down-forward to the shoulder joints
  for (const s of [1, -1]) {
    bodyGUV(capsule(chest, mats.scales, inChest(s * 0.88, 3.62, 1.08), inChest(s * 1.0, 2.72, 1.82), { r0: 0.4, r1: 0.47, bulge: 0.06, sx: 0.78 }), 0);
  }

  // dorsal blade row (orange spine line): tall back-swept blades from the withers to the rump, the
  // tallest over the shoulders, with a lower splayed pair every other blade (the reference's spiny
  // back reads in the silhouette from every side); chest-mounted ahead of z 0.3, hips behind
  const spineChest = [], spineHips = [], flankChest = [], flankHips = [];
  const DORSAL = [0.95, 1.08, 1.02, 0.94, 0.86, 0.8, 0.74, 0.68, 0.63, 0.58, 0.54, 0.5];
  DORSAL.forEach((len, i) => {
    const z = 1.3 - i * 0.33;
    const y = backY(z) - 0.08;
    const onChest = z > 0.3;
    const at = onChest ? inChest(0, y, z) : inHips(0, y, z);
    (onChest ? spineChest : spineHips).push(spike(len, 0.2, at[0], at[1], at[2], 0.6, 0, 0.24, 5, 0.38));
    if (i % 2 === 1) {
      for (const s of [1, -1]) {
        const zz = z - 0.16, yy = backY(zz) - 0.2;
        const a2 = zz > 0.3 ? inChest(s * 0.3, yy, zz) : inHips(s * 0.3, yy, zz);
        (zz > 0.3 ? flankChest : flankHips).push(spike(len * 0.5, 0.1, a2[0], a2[1], a2[2], 0.75, -s * 0.6, 0.12, 5, 0.45));
      }
    }
  });
  // small flank rows over the shoulders and the rump
  for (const z of [1.5, 1.05, -1.25, -1.7, -2.15]) {
    const onChest = z > 0.3;
    for (const s of [1, -1]) {
      const y = backY(z) - 0.3;
      const at = onChest ? inChest(s * 0.62, y, z) : inHips(s * 0.58, y, z);
      (onChest ? flankChest : flankHips).push(spike(0.3, 0.08, at[0], at[1], at[2], 0.8, -s * 1.1, 0, 5, 0.45));
    }
  }
  // shoulder "pauldrons": 3 silver shards per scapula, back and up
  for (const s of [1, -1]) {
    [
      [1.02, 3.62, 1.2, 0.35],
      [1.14, 3.38, 1.48, 0.32],
      [1.22, 3.1, 1.76, 0.28],
    ].forEach(([x, y, z, len]) => {
      const at = inChest(s * x, y, z);
      flankChest.push(spike(len, 0.09, at[0], at[1], at[2], 0.95, -s * 0.75, 0.08, 5, 0.5));
    });
  }
  batch(chest, mats.spine, spineChest);
  batch(hips, mats.spine, spineHips);
  batch(chest, mats.bone, flankChest);
  batch(hips, mats.bone, flankHips);

  // ============================================================ neck (spec §2.2)
  // short, massive upright S; dorsal crest in spine orange, two lateral rows of shingle plates
  // (the head study's serrated ruff), a lava throat strip that shows only underneath
  const neckBase = joint(chest, ...A.neckBase, 'neckBase');
  neckBase.rotation.x = -1.25; // points up-forward (the chain's minimal rotations keep +Y dorsal)
  const neck = [];
  let parent = neckBase;
  for (let i = 0; i < A.neckSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.neckLen, `neck${i}`);
    const t = i / (A.neckSegs - 1);
    const r0 = THREE.MathUtils.lerp(0.62, 0.4, t);
    const r1 = r0 - 0.035;
    mesh(j, limbGeometry({ length: A.neckLen + 0.12, r0, r1, sy: 0.92, radial: 14, rings: 4 }), mats.neck, 0, 0, -0.06);
    // lava throat: under the neck only (narrower, set low; overlapping segments make it continuous)
    mesh(j, limbGeometry({ length: A.neckLen + 0.14, r0: r0 * 0.8, r1: r1 * 0.8, sx: 0.86, sy: 0.72, radial: 12, rings: 3 }), mats.throat, 0, -r0 * 0.4, -0.07);
    // dorsal crest: two tall back-swept spines per segment (the reference's spiky mane) and a
    // splayed pair beside them, one batch per segment
    const crest = [];
    for (let q = 0; q < 2; q++) crest.push(spike(THREE.MathUtils.lerp(0.8, 0.58, t) * (q ? 0.82 : 1), 0.14, 0, r0 * 0.86, A.neckLen * (0.22 + 0.5 * q), 0.72, 0, 0.2, 5, 0.38));
    for (const s of [1, -1]) crest.push(spike(THREE.MathUtils.lerp(0.5, 0.32, t), 0.08, s * r0 * 0.5, r0 * 0.72, A.neckLen * 0.45, 0.7, -s * 0.65, 0.14, 5, 0.45));
    batch(j, mats.spine, crest);
    // the head study's mane: 3 rows of long pointed blade scales per side (±40°, ±70°, ±100° around
    // the neck), 2 per row per segment, rows offset half a plate, all pointing down and back toward
    // the body, tips lifted ~23° so the profile serrates
    const sh = [];
    for (const s of [1, -1]) {
      [0.7, 1.22, 1.75].forEach((ang, row) => {
        for (let q = 0; q < 2; q++) {
          const z = 0.12 + q * 0.23 + (row % 2) * 0.115;
          sh.push(shingle(0.58 - row * 0.07, 0.14 - row * 0.015, r0 * 0.93, s * ang, z, 0.4, 0.92, 0.3));
        }
      });
    }
    batch(j, mats.neck, sh);
    neck.push(j);
    parent = j;
  }

  // ============================================================ head (spec §2.1)
  // `head` (the neck chain's end) and its `mouth` are GAMEPLAY joints: the bite / charge spheres sit on
  // the head + snout, the breath / fireballs leave the mouth. Every head mesh hangs on `headVis`
  // instead, scaled HEAD_VIS about the mouth point: the painting's big, fierce head (its snout tip and
  // open jaws stay on the mouth, the skull, crown and mane grow back over the top of the neck), with
  // the hit volumes and the fire's origin exactly where they were.
  const head = joint(parent, 0, 0, A.neckLen, 'head');
  const headVis = joint(head, MOUTH[0] * (1 - HEAD_VIS), MOUTH[1] * (1 - HEAD_VIS), MOUTH[2] * (1 - HEAD_VIS), 'headVis');
  headVis.scale.setScalar(HEAD_VIS);
  // long wedge skull: flat-topped snout, broad occiput
  mesh(headVis, limbGeometry({ length: SKULL.len, r0: SKULL.r0, r1: SKULL.r1, sx: 1.0, sy: SKULL.sy, bulge: SKULL.bulge, radial: 16, rings: 7 }), mats.head, 0, SKULL.y0, SKULL.z0);
  const skullTop = (z) => SKULL.y0 + skullR(z) * SKULL.sy;
  const skullBot = (z) => SKULL.y0 - skullR(z) * SKULL.sy;
  const browG = [], hornsG = [], teethG = [];
  for (const s of [1, -1]) {
    // heavy brow shelves overhanging the eyes
    browG.push(place(ellipsoidGeometry(0.16, 0.1, 0.42, { widthSegs: 8, heightSegs: 6 }), s * 0.25, 0.25, 0.45, 0, s * 0.2, 0, 'YXZ'));
    // main horns: sabres back along the skull line, tips curving up (~26° above it overall; a
    // steeper root made two vertical posts from the front)
    hornsG.push(horn(1.7, 0.15, s * 0.2, 0.3, -0.02, -0.24, Math.PI - s * 0.3, 0.34, 7)); // a V from the front, not two posts
    // secondary horns
    hornsG.push(horn(1.0, 0.1, s * 0.3, 0.12, 0.0, -0.12, Math.PI - s * 0.45, 0.18, 6));
    // cheek (jugal) horns: straight back, behind and below the eye
    hornsG.push(horn(0.75, 0.09, s * 0.38, -0.02, 0.3, 0.08, Math.PI - s * 0.5, 0, 6));
    // nape frill: 6 blades per side fanning back from the occiput, top to cheek (the reference's
    // crest of back-swept spikes)
    for (let k = 0; k < 6; k++) {
      hornsG.push(horn(0.78 - k * 0.07, 0.075, s * (0.18 + 0.055 * k), 0.12 - 0.075 * k, -0.08, -0.32 + 0.17 * k, Math.PI - s * (0.28 + 0.16 * k), 0.16, 5, 0.55));
    }
    // brow spikes over the eye and a cheek frill down to the jaw hinge, all swept back
    hornsG.push(horn(0.34, 0.05, s * 0.29, 0.3, 0.6, -0.45, Math.PI - s * 0.22, 0.12, 5, 0.6));
    hornsG.push(horn(0.26, 0.04, s * 0.3, 0.27, 0.8, -0.4, Math.PI - s * 0.2, 0.1, 5, 0.6));
    [
      [0.5, 0.42, -0.1, 0.42],
      [0.42, 0.4, -0.2, 0.28],
      [0.34, 0.37, -0.28, 0.14],
    ].forEach(([len, x, y, z]) => hornsG.push(horn(len, 0.06, s * x, y, z, 0.25, Math.PI - s * 0.62, 0.08, 5, 0.55)));
    // upper teeth: 9 per side, long separate needles, irregular, hooked slightly back (fang in front;
    // x1.4 the sheet's lengths so each fang reads against the lit maw)
    const UP = [0.22, 0.14, 0.11, 0.13, 0.1, 0.11, 0.085, 0.1, 0.085];
    UP.forEach((len, k) => {
      const z = 1.15 - k * 0.1;
      const r = skullR(z);
      const L = len * (1 + 0.25 * jit(k * 2 + (s > 0 ? 0 : 1)));
      teethG.push(horn(L, k === 0 ? 0.05 : 0.035, s * r * 0.78, skullBot(z) + 0.03, z, Math.PI / 2 + 0.14, 0, 0, 4));
    });
  }
  // crown: 6 midline spikes snout -> occiput, plus a nose horn
  [
    [0.14, 0.04, 0.95],
    [0.22, 0.05, 0.76],
    [0.32, 0.06, 0.57],
    [0.44, 0.08, 0.38],
    [0.58, 0.09, 0.18],
    [0.66, 0.1, -0.02],
  ].forEach(([len, r, z]) => hornsG.push(spike(len, r, 0, skullTop(z) - 0.02, z, 0.95, 0, 0.14, 5, 0.55)));
  hornsG.push(spike(0.24, 0.06, 0, 0.14, 1.18, 0.5, 0, 0.1));
  batch(headVis, mats.head, browG);
  batch(headVis, mats.bone, hornsG);
  batch(headVis, mats.teeth, teethG);
  // the maw: glowing roof of the mouth (shows through the teeth: the jaw rests a little open)
  batch(headVis, mats.maw, [place(ellipsoidGeometry(0.24, 0.06, 0.6, { widthSegs: 10, heightSegs: 6 }), 0, -0.12, 0.62)]);
  // eyes: small amber slits tucked under the brow shelf, outer corner tilted ~20° up
  const eyes = [];
  for (const s of [1, -1]) {
    const e = mesh(headVis, ellipsoidGeometry(0.07, 0.045, 0.11, { widthSegs: 8, heightSegs: 6 }), mats.eye, s * 0.27, 0.12, 0.55);
    e.rotation.set(0.35, s * 0.3, 0, 'YXZ');
    eyes.push(e);
  }
  // nostrils (snort smoke) follow the drawn snout; the mouth is the gameplay joint
  const nostrils = [joint(headVis, 0.1, 0.1, 1.2, 'nostrilL'), joint(headVis, -0.1, 0.1, 1.2, 'nostrilR')];
  const mouth = joint(head, MOUTH[0], MOUTH[1], MOUTH[2], 'mouth');
  // hinged lower jaw: lower teeth, jaw-line spikes, chin spike, the glowing floor of the mouth
  const jaw = joint(headVis, 0, -0.15, 0.05, 'jaw');
  mesh(jaw, limbGeometry({ length: JAW.len, r0: JAW.r0, r1: JAW.r1, sx: JAW.sx, sy: JAW.sy, radial: 12, rings: 5 }), mats.head, 0, JAW.y0, 0);
  const lowTeeth = [], jawSpikes = [];
  for (const s of [1, -1]) {
    const LOW = [0.18, 0.13, 0.11, 0.1, 0.1, 0.085, 0.085, 0.07];
    LOW.forEach((len, k) => {
      const z = 1.02 - k * 0.095;
      const L = len * (1 + 0.25 * jit(k * 3 + (s > 0 ? 7 : 11)));
      lowTeeth.push(horn(L, k === 0 ? 0.045 : 0.032, s * jawR(z) * JAW.sx * 0.78, JAW.y0 + jawR(z) * JAW.sy - 0.02, z, -(Math.PI / 2 + 0.1), 0, 0, 4));
    });
    // jaw-line spikes: down and back, growing toward the hinge (a spiky jaw frill)
    [
      [0.2, 0.75],
      [0.28, 0.56],
      [0.36, 0.38],
      [0.44, 0.2],
      [0.5, 0.02],
    ].forEach(([len, z]) => jawSpikes.push(horn(len, 0.055, s * jawR(z) * JAW.sx * 0.9, JAW.y0 - jawR(z) * JAW.sy * 0.6, z, 0.85, Math.PI - s * 0.3, 0.06, 5, 0.6)));
  }
  jawSpikes.push(horn(0.2, 0.05, 0, JAW.y0 - 0.08, 1.0, 1.3, 0, 0, 5));
  batch(jaw, mats.teeth, lowTeeth);
  batch(jaw, mats.bone, jawSpikes);
  batch(jaw, mats.maw, [place(ellipsoidGeometry(0.19, 0.05, 0.52, { widthSegs: 10, heightSegs: 6 }), 0, 0.02, 0.55)]);

  // ============================================================ tail (spec §2.7)
  // 16 x 0.52, tapering to a point (no mace); flat orange saw-blades on top, small silver blades
  // on the sides, lava underside on the first 70 %
  const tailBase = joint(hips, ...A.tailBase, 'tailBase');
  tailBase.rotation.y = Math.PI;
  const tail = [];
  const tailRadii = [];
  parent = tailBase;
  // `tailR` is the tail chain's ground clearance (rig/anim.js: tailRadii); the drawn tail is thicker at
  // the root (the painting's heavy tail, ~the thigh's girth) and tapers faster (visual only: the sweep's
  // chain, and the hit spheres on it, keep their clearance)
  const tailR = (t) => 0.05 + 0.52 * Math.pow(Math.max(0, 1 - t), 1.15);
  const tailRV = (t) => 0.06 + 0.7 * Math.pow(Math.max(0, 1 - t), 1.4);
  for (let i = 0; i < A.tailSegs; i++) {
    const j = joint(parent, 0, 0, i === 0 ? 0 : A.tailLen, `tail${i}`);
    const t = i / A.tailSegs;
    const r0 = tailRV(t), r1 = tailRV((i + 1) / A.tailSegs);
    tailRadii.push(tailR(t));
    mesh(j, limbGeometry({ length: A.tailLen + 0.08, r0, r1, sy: 0.9, radial: 12, rings: 3, flip: TAIL_FLIP }), mats.limbs, 0, 0, -0.04);
    if (i < 11) mesh(j, limbGeometry({ length: A.tailLen + 0.04, r0: r0 * 0.94, r1: r1 * 0.94, sx: 0.8, sy: 0.74, radial: 10, rings: 2, flip: TAIL_FLIP }), mats.lava, 0, -r0 * 0.34, -0.02);
    // a saw of tall back-swept blades along the top (molten roots: the reference's orange-lit tail
    // spikes, big broad blades), splayed blades down both sides and, past the middle, under the tail
    const saw = [spike(1.05 - t * 0.62, 0.25 - t * 0.14, 0, r0 * 0.84, A.tailLen * 0.5, -0.5, 0, -0.22, 5, 0.36)];
    for (const s of [1, -1]) saw.push(spike(0.48 - t * 0.28, 0.08 - t * 0.035, s * r0 * 0.62, r0 * 0.6, A.tailLen * 0.2, -0.55, -s * 0.75, -0.14, 5, 0.42));
    if (t > 0.4) saw.push(spike(0.42 - t * 0.2, 0.08 - t * 0.03, 0, -r0 * 0.8, A.tailLen * 0.5, -0.85, Math.PI, -0.12, 5, 0.4));
    // and a flat pair straight out the sides (one batch per segment, all molten-rooted)
    if (i < 14) for (const s of [1, -1]) saw.push(spike(0.4 - t * 0.26, 0.07 - t * 0.03, s * r0 * 0.8, r0 * 0.22, A.tailLen * 0.45, -0.75, -s * 1.3, -0.08, 5, 0.45));
    batch(j, mats.spine, saw);
    tail.push(j);
    parent = j;
  }
  const tailTip = joint(parent, 0, 0, A.tailLen, 'tailTip');
  // the tip: a long blade with a fan of barbs (the reference's spiked tail end)
  batch(tailTip, mats.spine, [
    horn(0.75, 0.11, 0, 0, -0.08, 0, 0, 0, 5, 0.4),
    horn(0.32, 0.06, 0, 0, -0.22, -0.2, 0.62, 0.05, 5, 0.5),
    horn(0.32, 0.06, 0, 0, -0.22, -0.2, -0.62, 0.05, 5, 0.5),
    horn(0.26, 0.05, 0, 0.04, -0.3, -0.75, 0, 0.05, 5, 0.5),
  ]);

  // ============================================================ hind legs (spec §2.5)
  const legs = [];
  for (const s of [1, -1]) {
    const hip = joint(hips, s * A.hipJoint[0], A.hipJoint[1], A.hipJoint[2], s > 0 ? 'hipL' : 'hipR');
    hip.rotation.x = Math.PI / 2; // +Z points down, +Y forward
    const thigh = joint(hip, 0, 0, 0, 'thigh');
    // the painting's legs are massive and muscular: radii ~15 % over v0.4's (visual; lengths, IK unchanged)
    mesh(thigh, limbGeometry({ length: A.thigh + 0.1, r0: 0.8, r1: 0.5, bulge: 0.17, radial: 14, rings: 5, flip: true }), mats.limbs, 0, 0, -0.05);
    // lava on the inner thigh
    mesh(thigh, limbGeometry({ length: A.thigh - 0.1, r0: 0.55, r1: 0.32, bulge: 0.1, sx: 0.8, radial: 10, rings: 4, flip: true }), mats.lava, -s * 0.36, 0, 0.08);
    // 5 blades along the top / outer contour of the thigh (below the haunch), leaning back toward
    // the hip (they continue the rump row)
    const tb = [];
    for (let k = 0; k < 5; k++) {
      const z = 0.3 + k * 0.2;
      const r = 0.8 + (0.5 - 0.8) * ((z + 0.05) / (A.thigh + 0.1)) + 0.17 * Math.sin((Math.PI * (z + 0.05)) / (A.thigh + 0.1));
      tb.push(spike(0.55 - k * 0.07, 0.12, s * r * 0.6, r * 0.72, z, 0.7, -s * 0.85, 0.1, 5, 0.4));
    }
    batch(thigh, mats.bone, tb);
    const shin = joint(thigh, 0, 0, A.thigh, 'shin');
    mesh(shin, limbGeometry({ length: A.shin + 0.06, r0: 0.54, r1: 0.34, bulge: 0.04, radial: 12, rings: 4, flip: true }), mats.limbs);
    // a row of small spikes down the back of the shin (shin frame: +Y forward, -Y back, +Z down)
    batch(shin, mats.bone, [
      horn(0.3, 0.07, 0, -0.42, 0.35, 1.95, 0, 0.05, 5, 0.5),
      horn(0.26, 0.06, 0, -0.38, 0.7, 1.95, 0, 0.05, 5, 0.5),
      horn(0.21, 0.05, 0, -0.34, 1.0, 1.95, 0, 0.05, 5, 0.5),
    ]);
    const meta = joint(shin, 0, 0, A.shin, 'meta');
    mesh(meta, limbGeometry({ length: A.meta + 0.05, r0: 0.34, r1: 0.27, radial: 10, rings: 3, flip: true }), mats.limbs);
    // three spikes back off the hock (meta frame: -Y = back, -Z = up)
    batch(meta, mats.bone, [horn(0.48, 0.09, 0, -0.22, 0.05, 2.15, 0, 0.08, 5, 0.5), horn(0.34, 0.07, 0, -0.21, 0.25, 2.0, 0, 0.05, 5, 0.5), horn(0.22, 0.05, 0, -0.2, 0.45, 1.9, 0, 0, 5, 0.5)]);
    const toe = joint(meta, 0, 0, A.meta, 'toe');
    // the painting's eagle foot, ON the ground (the toe joint is at ground level, nose ~8° down): a
    // pad and three thick knuckled toes splayed wide, each ending in a long hooked talon (a pad with
    // claws stuck on read as a paw with a rake), plus the inner claw and a heel spur
    const hf = eagleFoot([[-0.48, 0.5, 0.7], [0, 0.6, 0.78], [0.48, 0.5, 0.7]], { pad: [0.5, 0.17, 0.5], padZ: 0.1, r: 0.16 });
    batch(toe, mats.limbs, hf.hide);
    const claws = hf.claws;
    claws.push(horn(0.55, 0.11, -s * 0.4, 0.15, 0.05, -0.12, -s * 1.1, -0.4, 5)); // inner claw
    claws.push(horn(0.5, 0.09, 0, 0.16, -0.3, -0.3, Math.PI, -0.15, 5)); // heel spur
    batch(toe, mats.claw, claws);
    legs.push({ side: s, hip, thigh, shin, meta, toe });
  }

  // ============================================================ front legs (spec §2.4)
  const arms = [];
  for (const s of [1, -1]) {
    const shoulder = joint(chest, s * A.shoulder[0], A.shoulder[1], A.shoulder[2], s > 0 ? 'shoulderL' : 'shoulderR');
    shoulder.rotation.x = Math.PI / 2; // +Z points down, +Y forward
    const humerus = joint(shoulder, 0, 0, 0, 'humerus');
    mesh(humerus, limbGeometry({ length: A.humerus + 0.08, r0: 0.6, r1: 0.44, bulge: 0.12, radial: 12, rings: 4, flip: true }), mats.limbs);
    // armpit lava patch on the inner side
    mesh(humerus, limbGeometry({ length: 0.6, r0: 0.34, r1: 0.26, sx: 0.7, radial: 10, rings: 2, flip: true }), mats.lava, -s * 0.22, 0, 0.05);
    const forearm = joint(humerus, 0, 0, A.humerus, 'forearm');
    mesh(forearm, ellipsoidGeometry(0.36, 0.36, 0.38, { widthSegs: 10, heightSegs: 6 }), mats.limbs, 0, -0.04, 0);
    mesh(forearm, limbGeometry({ length: A.forearm + 0.06, r0: 0.47, r1: 0.33, bulge: 0.06, radial: 12, rings: 4, flip: true }), mats.limbs);
    // posterior lava rim down the back of the forearm (the ASCII panel's orange back edge)
    mesh(forearm, limbGeometry({ length: A.forearm - 0.2, r0: 0.22, r1: 0.16, sx: 0.55, radial: 8, rings: 3, flip: true }), mats.lava, 0, -0.25, 0.15);
    // elbow: 3 big blades back and up (~40° above horizontal); 4 small spikes down the back edge
    const fs = [];
    [
      [0.7, 0.0, 2.27, 0.0],
      [0.55, 0.14, 2.1, s * 0.14],
      [0.4, 0.28, 1.95, -s * 0.12],
    ].forEach(([len, z, p, x]) => fs.push(horn(len * 1.2, 0.13, x, -0.36, z, p, 0, -0.1, 5, 0.42)));
    for (let k = 0; k < 5; k++) fs.push(horn(0.32 - k * 0.04, 0.06, 0, -0.39 + k * 0.025, 0.4 + k * 0.2, 1.25, 0, 0.04, 5, 0.5));
    // outer-side spikes down the forearm
    for (let k = 0; k < 3; k++) fs.push(horn(0.24 - k * 0.04, 0.05, s * 0.4, -0.05, 0.35 + k * 0.32, 1.0, s * 1.2, 0.04, 5, 0.5));
    batch(forearm, mats.bone, fs);
    const hand = joint(forearm, 0, 0, A.forearm, 'hand');
    mesh(hand, limbGeometry({ length: A.hand + 0.04, r0: 0.31, r1: 0.25, radial: 10, rings: 2, flip: true }), mats.limbs);
    const paw = joint(hand, 0, 0, A.hand, 'paw');
    // the painting's big eagle foot, its pad on the ground (paw joint = ground level): four thick
    // knuckled toes splayed ±0.55 rad, each ending in a long talon hooking down into the ground
    const ff = eagleFoot([[s * 0.55, 0.42, 0.62], [s * 0.18, 0.5, 0.7], [-s * 0.18, 0.5, 0.7], [-s * 0.55, 0.42, 0.62]], { pad: [0.5, 0.17, 0.46], padZ: 0.08, r: 0.15 });
    batch(paw, mats.limbs, ff.hide);
    batch(paw, mats.claw, ff.claws);
    // inner dewclaw and a wrist spike back and out (one batch)
    batch(hand, mats.claw, [horn(0.28, 0.06, -s * 0.2, -0.12, 0.08, 2.4, -s * 0.35, 0, 5), horn(0.3, 0.06, s * 0.12, -0.24, 0.05, 1.9, s * 0.4, 0.05, 5, 0.5)]);
    arms.push({ side: s, shoulder, humerus, forearm, hand, paw });
  }

  // ============================================================ wings (spec §2.6)
  // separate limbs rooted on top of the back: humerus (hide) -> forearm (bone line) -> wrist with a
  // hooked ivory thumb and two orange wrist spikes -> 4 two-joint fingers spanned by the membrane
  const wings = [];
  for (const s of [1, -1]) {
    const wroot = joint(chest, s * A.wingRoot[0], A.wingRoot[1], A.wingRoot[2], s > 0 ? 'wingRootL' : 'wingRootR');
    // a boss of hide where the wing grows out of the withers
    mesh(chest, ellipsoidGeometry(0.42, 0.34, 0.5, { widthSegs: 10, heightSegs: 6 }), mats.limbs, s * (A.wingRoot[0] + 0.05), A.wingRoot[1] - 0.25, A.wingRoot[2] + 0.05);
    // the wing arm is a thick dark scaled column with a spiked trailing edge (the painting), not a
    // glowing bone tube: hide on both segments, tapering 0.30 -> 0.22; only the fingers are bone lines
    const humerus = joint(wroot, 0, 0, 0, 'wingHumerus');
    mesh(humerus, limbGeometry({ length: A.wingHumerus + 0.08, r0: 0.3, r1: 0.27, bulge: 0.03, radial: 10, rings: 4 }), mats.limbs);
    const hs = [];
    for (let k = 0; k < 5; k++) hs.push(horn(0.34 - k * 0.02, 0.07, 0, 0.24, 0.25 + k * 0.27, -1.25, 0, 0.06, 5, 0.5));
    batch(humerus, mats.bone, hs);
    const forearm = joint(humerus, 0, 0, A.wingHumerus, 'wingForearm');
    mesh(forearm, limbGeometry({ length: A.wingForearm + 0.06, r0: 0.27, r1: 0.22, radial: 10, rings: 5 }), mats.limbs);
    const ser = [];
    for (let k = 0; k < 5; k++) ser.push(horn(0.36 - k * 0.03, 0.07, 0, 0.22, 0.3 + k * 0.5, -1.25, 0, 0.06, 5, 0.5)); // trailing spikes
    for (let k = 0; k < 6; k++) ser.push(horn(0.2, 0.045, 0, -0.2, 0.25 + k * 0.42, 1.3, 0, 0.04, 4)); // leading serrations
    batch(forearm, mats.bone, ser);
    const wrist = joint(forearm, 0, 0, A.wingForearm, 'wrist');
    mesh(wrist, ellipsoidGeometry(0.24, 0.22, 0.28, { widthSegs: 8, heightSegs: 6 }), mats.limbs);
    batch(wrist, mats.spine, [horn(0.62, 0.1, 0, 0.12, 0.05, -2.2, 0, 0.12, 5, 0.5), horn(0.42, 0.08, s * 0.15, 0.05, 0.1, -0.6, s * 1.2, 0.06, 5, 0.5)]);
    const fingers = [], distal = [];
    A.fingers.forEach((len, k) => {
      const kn = A.knuckle[k];
      const l0 = len * kn, l1 = len - l0;
      const f = joint(wrist, 0, 0, 0, `finger${k}`);
      // finger bones: thinner than the thick wing arm, but 2-3 letters wide at the reference view
      // like the reference's (at 0.05 they printed as hairlines)
      const rMid = 0.068;
      batch(f, mats.wingBone, [limbGeometry({ length: l0, r0: 0.1, r1: rMid, radial: 6, rings: 4, capSegs: 2 })]);
      const fd = joint(f, 0, 0, l0, `finger${k}d`);
      const tip = k === 0 ? horn(0.5, 0.05, 0, 0, l1 - 0.04, 0, 0, 0, 5) : null;
      batch(fd, mats.wingBone, tip ? [limbGeometry({ length: l1, r0: rMid, r1: 0.04, radial: 6, rings: 4, capSegs: 2 }), tip] : [limbGeometry({ length: l1, r0: rMid, r1: 0.04, radial: 6, rings: 4, capSegs: 2 })]);
      // knuckle bump + a back-swept spike
      batch(fd, mats.bone, [place(ellipsoidGeometry(0.08, 0.08, 0.1, { widthSegs: 6, heightSegs: 4 }), 0, 0, 0), horn(0.3, 0.045, 0, 0.06, 0, -1.15, 0, 0.06, 4)]);
      if (k > 0) batch(fd, mats.claw, [horn(k === 3 ? 0.34 : 0.38, 0.05, 0, 0, l1 - 0.03, 0.3, 0, -0.35, 5)]);
      fingers.push(f);
      distal.push(fd);
    });
    const thumb = joint(wrist, 0, 0, 0, 'thumb');
    // the big ivory sickle on the wrist: rises up-forward, the tip hooking down in front (the rig
    // rolls the joint so the -Y curve points down)
    mesh(thumb, hornGeometry(1.1, 0.17, { radial: 6, curve: -0.55 }), mats.claw);
    const hipAttach = joint(hips, s * A.hipAttach[0], A.hipAttach[1], A.hipAttach[2], 'hipAttach');
    const membrane = new WingMembrane(mats.membrane, s, WING_KEYS.HALF);
    root.add(membrane.mesh);
    wings.push({ side: s, root: wroot, humerus, forearm, wrist, fingers, distal, thumb, hipAttach, membrane });
  }

  return {
    root, mats, glow: GLOW, hips, torso, chest, chestMesh, neckBase, neck, head, headVis, jaw, eyes, nostrils, mouth,
    tailBase, tail, tailRadii, tailTip, legs, arms, wings,
  };
}

/** @deprecated v0.3 name (the wyvern); the drake is built by buildDrake. */
export const buildWyvern = buildDrake;
