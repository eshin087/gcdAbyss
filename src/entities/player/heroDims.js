// The hero's measurements: bone lengths and joint offsets (DIM), girth (BODY), idle joint heights
// (REST) and the hair clusters. Plain data with no imports, so the model (model.js), the gear
// items (gear/*.js) and the Blender part builder can all read it without an import cycle. model.js
// re-exports everything here; outside the hero model, import it from model.js.

export const DIM = {
  pivot: 1.04, // body pivot height with straight legs (the idle stands 0.015 above it)
  pelvis: [0, -0.1, 0],
  hip: [0.105, -0.05, 0], // hip joints ±0.105 (room for the athletic build's thighs)
  spine: [0, 0.08, 0],
  chest: [0, 0.19, 0],
  // shoulder joints ±0.178 (lean match: 0.16, round 3: 0.21), deltoid to deltoid ≈ 0.52 m: the
  // athletic build (ADR-040; the lean match read as lanky)
  shoulder: [0.178, 0.215, 0],
  // the point the SWORD hand's pose targets are offsets from: where the shoulder joint was before
  // round 3 widened it, so every sword-hand target the arm can reach (and with it every attack's
  // hit segment) is unchanged by the broader frame (anim.js _handTarget, rig.arms.R.anchor)
  gripShoulder: [0.17, 0.215, 0],
  neck: [0, 0.31, 0], // head (neck-base) joint, 1.535 m
  skull: [0, 0.14, 0.005], // skull centre above the head joint (1.675 m; chin 1.57, crown 1.775)
  upperArm: 0.28,
  foreArm: 0.27, // elbow → grip centre
  thigh: 0.43,
  shin: 0.42,
  ankle: 0.07, // ankle height with the foot flat on the ground
  coatY: 0.18, // coat-skirt anchor above the pelvis joint (1.135 m: tucked under the belt stack)
  coatR: 0.148, // skirt anchor half-width at the sides (the depth is 0.69 of it: inside the shell)
  // the sword (sword space: origin = grip centre, blade along +Z)
  gripBack: 0.08, // grip runs from −gripBack …
  guard: 0.1, // … to the crossguard
  gem: 0.116, // the violet star gem at the heart of the guard, where the quillons meet
  // the OFF hand on the grip (two-handed): this far down from the sword hand toward the pommel,
  // fist against fist (was 0.11 in anim.js, a hand's width of gap between them)
  offGrip: 0.08,
  forte: 0.2, // end of the dark gunmetal base under the barbs (the cyan glyph blade from here on)
  // the steel length the animator poses with (anim.js keeps this point off the grass and out of the
  // legs; the integration test checks it). A little past the drawn point, so the drawn steel never
  // touches the ground
  steelTip: 1.17,
  // the DRAWN point: a 1.25 m sword from the pommel tip (−0.19) to here (owner: "a little shorter",
  // the 1.64 m blade was "way too long" and ran through the coat skirt). Visual only: the hit segment
  // below is unchanged, the swing crescent (fx.js) covers the reach past the steel
  drawnTip: 1.06,
  bladeBase: 0.16, // hit segment along +Z (hilt side) …
  bladeTip: 1.5, // … to here (+ REACH.tipExt 0.4): gameplay reach, independent of the drawn steel
};

/**
 * Girth: the ATHLETIC build (ADR-040, owner: "he is a bit too lanky"): a 0.39 m chest over a 0.27 m
 * waist, shoulder joints ±0.178, upper arm r 0.066, thigh r 0.086, a head drawn 1.08× (7.3 heads),
 * between the two builds below. Collar, pauldron, lapels and cape follow it (hero_parts.py).
 * Before it: the lean anime swordsman of the owner's reference sheets (2026-11-09 lean reference
 * match, ADR-034: chest 0.34 over 0.23, upper arm r 0.056, thigh r 0.07), superseding round 3's
 * broad build. The lean build's measurements, for the record: Measured on the six-view sheet's silhouettes, in
 * fractions of his height H: shoulders ≈ 0.24 H across, the chest under the arms ≈ 0.18 H, the
 * belted waist ≈ 0.12 H, thighs ≈ 0.06 H, boots at the calf ≈ 0.05 H, torso depth ≈ 0.12 H. A V from
 * the shoulders to a narrow waist, slim arms and long legs; the armour, the collar, the coat tails
 * and the hair carry the outline. Bone lengths drive the IK, the foot planner and the blade's hit
 * segment, so they stay; only mesh radii and widths changed. Metres; the meshes below are built from
 * these, anim.js sizes the blade's leg clearance, the coat's leg push and the ground-clamp spheres
 * from them, and the look-dev tools measure blade-in-body against them. Was (round 3): chest 0.50 ×
 * 0.27 m, waist 0.31, hips 0.34, upper arm r 0.088, forearm 0.076, thigh 0.098 → 0.07, boot 0.074.
 */
export const BODY = {
  // torso shell (the coat over the chest): rings at world idle height y, half-width rx, half-depth
  // rz, centre offset cz (the chest pushes forward), the open coat front's half-chord `gap`
  shell: [
    { y: 1.09, rx: 0.15, rz: 0.112, gap: 0.074 },
    { y: 1.21, rx: 0.134, rz: 0.1, gap: 0.076 },
    { y: 1.3, rx: 0.158, rz: 0.11, cz: 0.008, gap: 0.06 },
    { y: 1.37, rx: 0.184, rz: 0.122, cz: 0.014, gap: 0.044 },
    { y: 1.43, rx: 0.196, rz: 0.118, cz: 0.01, gap: 0.032 },
    { y: 1.475, rx: 0.17, rz: 0.102, cz: 0.003, gap: 0.024 },
    { y: 1.505, rx: 0.092, rz: 0.074, gap: 0.016 },
  ],
  hips: { c: [0, 0.012, -0.005], r: [0.142, 0.1, 0.106] }, // pelvis ellipsoid (pelvis space, x y z)
  head: { c: [0, 0.154, -0.007], r: [0.105, 0.118, 0.112] }, // the hair cap round the skull (head space)
  headScale: 1.08, // the head joint's scale (skull, face, hair): 7.3 heads tall instead of 7.8
  neck: [0.05, 0.046], // neck radius at the collar / under the jaw (head space, before headScale)
  deltoid: [0.074, 0.07, 0.078], // shoulder cap on each upper arm (x out, y, z)
  upperArm: [0.066, 0.056], // sleeve radius at the shoulder / the elbow
  foreArm: [0.057, 0.048], // vambrace / bracer at the elbow / the wrist
  hand: 1.12, // gauntlet / glove size (× the lean build's)
  thigh: [0.086, 0.062, 0.01], // r at the hip, at the knee, mid bulge
  shin: [0.064, 0.049, 0.01], // the boot: r at the knee, at the ankle, calf bulge
  foot: { c: [0, -0.02, 0.052], r: [0.056, 0.048, 0.146] }, // boot foot ellipsoid (foot space)
};

/** Idle-stance reference heights (m) of the joints the meshes hang on. */
export const REST = (() => {
  const body = DIM.pivot + 0.015;
  const pelvis = body + DIM.pelvis[1];
  const spine = pelvis + DIM.spine[1];
  const chest = spine + DIM.chest[1];
  return { body, pelvis, spine, chest, head: chest + DIM.neck[1] };
})();

/** Hair clusters: each is one merged mesh on a spring joint (pivot in head space). `tip` is the
 *  mean clump direction, used by the animator to turn wind / inertia into a lagging sway. */
export const HAIR_CLUSTERS = [
  { name: 'fringe', pivot: [0, 0.22, 0.075], tip: [0.15, -0.93, 0.33] },
  { name: 'left', pivot: [0.075, 0.165, 0.02], tip: [0.35, -0.88, -0.3] },
  { name: 'right', pivot: [-0.075, 0.175, 0.0], tip: [-0.55, -0.3, -0.78] },
  { name: 'crown', pivot: [0, 0.25, -0.03], tip: [0, 0.55, -0.83] },
  { name: 'nape', pivot: [0, 0.15, -0.09], tip: [0, -0.9, -0.42] },
];
