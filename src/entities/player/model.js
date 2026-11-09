import * as THREE from 'three';
import { createSurfaceGlyphMaterial, FLAG } from '../../render/materials.js';
import { limbGeometry, ellipsoidGeometry, hornGeometry, planarGUV } from '../../render/glyphGeometry.js';

// The Wanderer, "Shadow Swordsman" (owner concept sheets; build spec docs/art/hero.md): a slim
// 1.80 m anime swordsman, 7.8 heads tall. A small head under a messy black mop whose heavy fringe
// falls over the eyes; a tall flared stand collar up to the jaw; a long OPEN black greatcoat over
// a buttoned black shirt, a belt stack at the natural waist, the skirt flaring into an A-line of
// 22 claw-like torn strips with grey-lavender edges; a stepped, spiked pauldron on the RIGHT
// shoulder only; a plate vambrace + gauntlet on the right arm, a leather bracer + fingerless glove
// on the left; torn sleeve streamers; knee-high armoured boots with kite knee guards; one long
// sword (1.36 m of steel: faceted dark blade, cyan edges, upswept quillons, a scalloped gem cage,
// a violet gem, a kite pommel) in the right hand.
//
// A joint hierarchy with surface-glyph meshes hung on it. Faces +Z, Y up, the character's RIGHT
// is −X. Hands and feet are placed by IK (anim.js); the joints here only define bone lengths and
// rest offsets. Heights in comments are metres in the idle stance (pivot 1.055).
//
//   root (yaw) → body (waist pivot: rolls / falls) → pelvis → spine → chest → head → hair clusters
//                                                     │        │        ├ collar, arms (upper → fore → streamers)
//                                                     │        │        └ pauldron (follows the right arm)
//                                                     │        └ torso shell, shirt, belts, straps
//                                                     ├ legs (thigh → shin → foot)
//                                                     └ coat panels (anchor → upper → lower → torn strips)
//   body → sword (posed directly in body space; origin = grip centre, blade along +Z)
//
// Readability (hero.md §3): the ASCII panel's light-grey 'A'-family glyph field on near-black
// gaps, no heavy outline; upright glyphs (aGUV +y = up the body; limbs use flip), whole glyphs
// (`levels`, picked per cell), neutral grey ink, violet only at the gem / hair sheen / collar
// inside / torn edges, cyan only on the blade.

export const DIM = {
  pivot: 1.04, // body pivot height with straight legs (the idle stands 0.015 above it)
  pelvis: [0, -0.1, 0],
  hip: [0.1, -0.05, 0], // hip joints ±0.1 (round 3: 0.09; room for the thicker thighs)
  spine: [0, 0.08, 0],
  chest: [0, 0.19, 0],
  // shoulder joints ±0.21 (round 3: 0.17), deltoid to deltoid ≈ 0.62 m: the broad shoulders
  shoulder: [0.21, 0.215, 0],
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
  coatR: 0.163, // skirt anchor half-width at the sides (the depth is 0.69 of it: inside the shell)
  // the sword (sword space: origin = grip centre, blade along +Z)
  gripBack: 0.08, // grip runs from −gripBack …
  guard: 0.1, // … to the crossguard
  gem: 0.17, // the violet gem on the forte, inside its cage
  forte: 0.25, // end of the dark gunmetal forte under the gem cage (the cyan glyph blade from here on)
  // the steel length the animator poses with (anim.js keeps this point on the grass and out of the
  // legs; the integration test checks it): unchanged, so every attack's hit segment stays the same
  steelTip: 1.17,
  // the DRAWN point: 1.64 m of steel (pommel tip at −0.19). The owner's reference draws the blade
  // from the gem to the point ≈ 70 % of his height. Visual only (the hit segment below is unchanged
  // and the point stays inside it); the idle stance (anim.js IDLE_SW) rests this point on the grass
  drawnTip: 1.45,
  bladeBase: 0.16, // hit segment along +Z (hilt side) …
  bladeTip: 1.5, // … to here (+ REACH.tipExt 0.4): gameplay reach, independent of the drawn steel
};

/**
 * Girth (round 3; owner: "the character is too lanky / skinny"): an athletic, broad-shouldered
 * swordsman on the same bones. Bone lengths drive the IK, the foot planner and the blade's hit
 * segment, so the mass comes from mesh radii and widths: a deeper, wider chest and back over a V to a
 * fuller waist, thick upper arms and forearms, heavy thighs and calves in bigger boots. Metres; the
 * meshes below are built from these, anim.js sizes the blade's leg clearance, the coat's leg push and
 * the ground-clamp spheres from them, and the look-dev tools measure blade-in-body against them.
 * Was (round 2): chest 0.40 × 0.21 m, waist 0.27, hips 0.30, upper arm r 0.064, forearm 0.06, thigh
 * 0.076 → 0.056, boot 0.058 → 0.045.
 */
export const BODY = {
  // torso shell (the coat over the chest): rings at world idle height y, half-width rx, half-depth
  // rz, centre offset cz (the chest pushes forward), the open coat front's half-chord `gap`
  shell: [
    { y: 1.09, rx: 0.17, rz: 0.12, gap: 0.09 },
    { y: 1.21, rx: 0.157, rz: 0.113, gap: 0.095 },
    { y: 1.3, rx: 0.198, rz: 0.128, cz: 0.01, gap: 0.068 },
    { y: 1.37, rx: 0.232, rz: 0.14, cz: 0.017, gap: 0.048 },
    { y: 1.43, rx: 0.25, rz: 0.134, cz: 0.012, gap: 0.034 },
    { y: 1.475, rx: 0.215, rz: 0.114, cz: 0.003, gap: 0.025 },
    { y: 1.505, rx: 0.115, rz: 0.09, gap: 0.017 },
  ],
  hips: { c: [0, 0, -0.005], r: [0.172, 0.127, 0.125] }, // pelvis ellipsoid (pelvis space, x y z)
  head: { c: [0, 0.154, -0.007], r: [0.12, 0.132, 0.126] }, // the hair cap round the skull (head space)
  deltoid: [0.1, 0.088, 0.096], // shoulder cap on each upper arm (x out, y, z)
  upperArm: [0.088, 0.074], // sleeve radius at the shoulder / the elbow
  foreArm: [0.076, 0.062], // vambrace / bracer at the elbow / the wrist
  thigh: [0.098, 0.07, 0.014], // r at the hip, at the knee, mid bulge
  shin: [0.074, 0.056, 0.01], // the boot: r at the knee, at the ankle, calf bulge
  foot: { c: [0, -0.02, 0.054], r: [0.062, 0.05, 0.152] }, // boot foot ellipsoid (foot space)
};

/** Idle-stance reference heights (m) of the joints the meshes hang on. */
const REST = (() => {
  const body = DIM.pivot + 0.015;
  const pelvis = body + DIM.pelvis[1];
  const spine = pelvis + DIM.spine[1];
  const chest = spine + DIM.chest[1];
  return { body, pelvis, spine, chest, head: chest + DIM.neck[1] };
})();

/** Coat skirt (hero.md §2.4): six panels + a front flap hanging from 1.12 m (az: 0 = front, + =
 *  the hero's left). Each panel = an upper and a lower solid segment (`len`, widths `w` at the top,
 *  the join and the tear line), then torn `strips` (lengths, m; 1 in 4 forks) on their own springs.
 *  The front is open (the legs show), a back vent splits the two back panels. `out` nudges a panel
 *  outward so overlapping neighbours never z-fight. */
// The owner's reference flares the coat WIDE on both sides into long ragged strips (to mid-calf, the
// side tails out past the hands): wide hems, long strips, and a per-panel resting `flare` (the
// animator's outward pull, see COAT_FLARE in anim.js: 0.3 ≈ 17°; 0.62 ≈ 32° on the sides).
// (round 2: the front panels hang nearly straight, the coat's open front edges; the side and back
// drapes are wider at the hem with soft folds, so the flare reads as cloth, not planks)
// (round 3: the anchor ring follows the fuller hips, DIM.coatR 0.139 → 0.163, and the panel tops
// widen with it (×1.17) so they keep their overlaps; the hems only ×1.07, so the skirt's A-line does
// not outgrow the broader shoulders)
export const COAT_PANELS = [
  { az: 0.75, w: [0.164, 0.25, 0.32], len: [0.26, 0.26], strips: [0.22, 0.27, 0.19], fork: [0, 1, 0], out: 0.006, flare: 0.22, folds: 1 }, // front-left
  { az: -0.75, w: [0.164, 0.25, 0.32], len: [0.26, 0.26], strips: [0.19, 0.27, 0.22], fork: [0, 0, 1], out: 0.006, flare: 0.22, folds: 1 }, // front-right
  { az: 1.6, w: [0.246, 0.43, 0.64], len: [0.3, 0.32], strips: [0.4, 0.28, 0.46, 0.33], fork: [0, 1, 0, 0], out: 0, flare: 0.5 }, // left
  { az: -1.6, w: [0.246, 0.43, 0.64], len: [0.3, 0.32], strips: [0.35, 0.46, 0.27, 0.4], fork: [0, 0, 1, 0], out: 0, flare: 0.5 }, // right
  { az: 2.55, w: [0.234, 0.4, 0.59], len: [0.34, 0.38], strips: [0.29, 0.36, 0.2, 0.33], fork: [1, 0, 0, 0], out: 0.012, flare: 0.3 }, // back-left
  { az: -2.55, w: [0.234, 0.4, 0.59], len: [0.34, 0.38], strips: [0.32, 0.19, 0.36, 0.27], fork: [0, 0, 0, 1], out: 0.012, flare: 0.3 }, // back-right
  // the front flap: hangs between the legs from 1.05 m to a point at 0.55 m (seen in wide stances)
  { az: 0, w: [0.14, 0.14, 0.125], len: [0.28, 0.22], strips: [], fork: [], out: 0, flap: true, y: -0.085, r: 0.131 },
];

/** Hair clusters: each is one merged mesh on a spring joint (pivot in head space). `tip` is the
 *  mean clump direction, used by the animator to turn wind / inertia into a lagging sway. */
export const HAIR_CLUSTERS = [
  { name: 'fringe', pivot: [0, 0.22, 0.075], tip: [0.15, -0.93, 0.33] },
  { name: 'left', pivot: [0.075, 0.165, 0.02], tip: [0.35, -0.88, -0.3] },
  { name: 'right', pivot: [-0.075, 0.175, 0.0], tip: [-0.55, -0.3, -0.78] },
  { name: 'crown', pivot: [0, 0.25, -0.03], tip: [0, 0.55, -0.83] },
  { name: 'nape', pivot: [0, 0.15, -0.09], tip: [0, -0.9, -0.42] },
];

// Builder geometries run along native +Z with the aGUV seam on native −Y. Re-orient them so the
// seam ends up on the back/underside where the high camera rarely looks.
const orient = {
  down(g) {
    g.rotateX(Math.PI / 2); // +Z → −Y, seam → −Z (build limbs with flip: aGUV +y then runs UP)
    return g;
  },
  up(g) {
    g.rotateX(-Math.PI / 2); // +Z → +Y (aGUV +y runs up)
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
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * A parametric sheet: fn(s, t, out) fills out = [x, y, z, guvX, guvY] for s, t in 0..1 over a
 * (cols × rows) grid. The front face is the side Ps × Pt points to (flip reverses it). `skip(i, j,
 * pos, a, b, c, d)` may drop a quad.
 */
function gridGeometry(cols, rows, fn, flip = false, skip = null) {
  const nv = (cols + 1) * (rows + 1);
  const pos = new Float32Array(nv * 3), guv = new Float32Array(nv * 2);
  const o = [0, 0, 0, 0, 0];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      fn(i / cols, j / rows, o);
      const k = j * (cols + 1) + i;
      pos[k * 3] = o[0];
      pos[k * 3 + 1] = o[1];
      pos[k * 3 + 2] = o[2];
      guv[k * 2] = o[3];
      guv[k * 2 + 1] = o[4];
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      if (skip && skip(i, j, pos, a, b, c, d)) continue;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aGUV', new THREE.BufferAttribute(guv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Lofted body shell around +Y through elliptical rings {y, rx, rz, cz, gap}: `gap` = half the
 * chord left open at the front (the open coat), 0 = closed except a hairline at the front.
 * `span` limits it to the front ±span rad instead (the shirt). aGUV: x = angle × 0.15 (columns line
 * up down the body, like the panel), y = height, so glyphs stand upright.
 */
function shellGeometry(rings, { sub = 2, cols = 24, span = 0 } = {}) {
  const rows = (rings.length - 1) * sub;
  return gridGeometry(cols, rows, (s, t, o) => {
    const f = t * (rings.length - 1);
    const k = Math.min(rings.length - 2, Math.floor(f));
    const u = f - k;
    const A = rings[k], B = rings[k + 1];
    const y = lerp(A.y, B.y, u), rx = lerp(A.rx, B.rx, u), rz = lerp(A.rz, B.rz, u);
    const cz = lerp(A.cz ?? 0, B.cz ?? 0, u), gap = lerp(A.gap ?? 0, B.gap ?? 0, u);
    let a;
    if (span > 0) {
      a = (s - 0.5) * 2 * span;
    } else {
      const a0 = Math.asin(Math.min(0.95, Math.max(0.004, gap) / rx));
      a = a0 + s * (Math.PI * 2 - 2 * a0);
    }
    o[0] = Math.sin(a) * rx;
    o[1] = y;
    o[2] = Math.cos(a) * rz + cz;
    o[3] = (a - Math.PI) * 0.15;
    o[4] = y;
  });
}

/** A coat-skirt sheet hanging −Y from its joint: width wTop → wBot over `len`, curved around the
 *  hips with a radius that grows down the panel (R0 + flare × depth) so neighbours form a cone.
 *  Local +Z = outward; the front face points out (the lining is the back face). */
function skirtSheet(len, wTop, wBot, R0, flare = 0.3, jag = 0, seed = 1, fold = [0, 0, 0], t0 = 0, t1 = 1) {
  const r = rng(seed);
  const cols = 12, rows = Math.max(2, Math.round(5 * (t1 - t0)));
  const jitter = Array.from({ length: cols + 1 }, () => (r() - 0.5) * jag);
  // `fold` [amplitude at the top, at the bottom (m), waves across, phase]: the reference's coat
  // drapes in soft vertical folds that deepen toward the hem (a flat sheet read as a plank).
  // t0 … t1: build only that stretch of the sheet (the dark coat above, the lavender torn zone below)
  const ph = fold[3] ?? r() * Math.PI * 2;
  return gridGeometry(cols, rows, (s, tt, o) => {
    const t = lerp(t0, t1, tt);
    const w = lerp(wTop, wBot, t);
    const u = (s - 0.5) * w;
    const R = R0 + flare * t * len;
    const a = u / R;
    const y = -t * (len + 0.02) + (tt === 1 && t1 === 1 ? jitter[Math.round(s * cols)] : 0);
    const f = lerp(fold[0], fold[1], t) * Math.sin(s * Math.PI * 2 * fold[2] + ph) * Math.sin(Math.PI * Math.min(1, s * 6) * 0.5) * Math.sin(Math.PI * Math.min(1, (1 - s) * 6) * 0.5);
    o[0] = Math.sin(a) * (R + f);
    o[1] = y;
    o[2] = (Math.cos(a) - 1) * R + Math.cos(a) * f;
    o[3] = u;
    o[4] = y;
  }, true);
}

/**
 * One torn strip hanging −Y from its joint: width w at the tear, tapering to a sharp claw point
 * that curls outward (+Z); `fork` splits the last half into two points; jagged notched edges.
 * `tip: false` = a plain rectangular strip (the root segment of a streamer). aGUV: x across, y up.
 */
function tatterStrip(L, w, { fork = false, tip = true, curl = 0.25, seed = 1 } = {}) {
  const r = rng(seed);
  const rows = 8, cols = 4;
  const notch = Array.from({ length: rows + 1 }, () => (r() < 0.45 ? (0.4 + 0.6 * r()) * 0.016 : 0));
  const notchR = Array.from({ length: rows + 1 }, () => (r() < 0.45 ? (0.4 + 0.6 * r()) * 0.016 : 0));
  const skew = (r() - 0.5) * 0.06;
  const cl = curl * (0.7 + 0.6 * r());
  const tear = Array.from({ length: cols + 1 }, () => (r() - 0.5) * 0.025);
  return gridGeometry(cols, rows, (s, t, o) => {
    let e = 1;
    if (tip) e = fork ? 1 - 0.5 * Math.abs(4 * (s < 0.5 ? s : s - 0.5) - 1) : 1 - 0.55 * Math.abs(2 * s - 1);
    const tt = t * e;
    const width = w * (1 - 0.3 * tt);
    let x = (s - 0.5) * width + skew * tt * tt;
    const j = Math.round(t * rows), i = Math.round(s * cols);
    if (i === 0) x += notch[j];
    if (i === cols) x -= notchR[j];
    let y = -tt * L;
    const isTip = tip && (fork ? i === 1 || i === 3 : i === 2);
    if (j === rows && !isTip) y += tear[i];
    o[0] = x;
    o[1] = y;
    o[2] = cl * tt * tt * L;
    o[3] = x;
    o[4] = y;
  }, true);
}

/** A cylindrical plate arc around the local −Y axis (an arm / shin lame): angle centred on `ac`
 *  (rad from +Z toward +X; the outer side of a right arm is −π/2) spanning ±half, from y0 down to
 *  y1, radius r0 → r1. Outward-facing; aGUV y up. */
function arcPlate(y0, y1, r0, r1, ac, half, cols = 6) {
  return gridGeometry(cols, 2, (s, t, o) => {
    const a = ac + (s - 0.5) * 2 * half;
    const r = lerp(r0, r1, t);
    const y = lerp(y0, y1, t);
    o[0] = Math.sin(a) * r;
    o[1] = y;
    o[2] = Math.cos(a) * r;
    o[3] = a * r;
    o[4] = y;
  }, true);
}

/** A straight flat strap (box) from point a to point b (parent space), `w` wide across `side`
 *  (any vector roughly across the strap), `th` thick. aGUV: x across, y along (up toward a). */
function strapGeometry(a, b, w, th, side) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(w, len, th, 1, Math.max(1, Math.round(len / 0.05)), 1);
  planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const ay = A.clone().sub(B).normalize();
  const ax = new THREE.Vector3(...side);
  ax.addScaledVector(ay, -ax.dot(ay)).normalize();
  const az = new THREE.Vector3().crossVectors(ax, ay);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(A.clone().add(B).multiplyScalar(0.5)));
  return g;
}

/** A small box (buckle, ferrule, heel) with planar aGUV. */
function boxGeometry(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  return place(g, x, y, z, rx, ry, rz);
}

/** A faceted rhombus / kite (octahedron) with half-extents (x, y, z); `zNeg` stretches the −Z
 *  half (the kite pommel), `yPos` the +Y half (the knee guard's top point). Flat facets. */
function kiteGeometry(x, y, z, { zNeg = 1, yPos = 1, guv = 'xy' } = {}) {
  const g = new THREE.OctahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vz = p.getZ(i), vy = p.getY(i);
    p.setXYZ(i, p.getX(i) * x, vy * y * (vy > 0 ? yPos : 1), vz * z * (vz < 0 ? zNeg : 1));
  }
  g.computeVertexNormals();
  return guv === 'xz'
    ? planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1))
    : planarGUV(g, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
}

/**
 * The blade: a flattened diamond prism along +Z (width on X, flat faces ±Y) that holds its width
 * and tapers to a point over the last `tipFrac`. aGUV x is normalised to the local width so each
 * half of the blade is exactly one glyph column (chevrons pointing to the tip), with cell seams
 * on the edges and the centre ridge (the material draws column seams only: seamAxis 'y').
 */
function bladeGeometry(len, hw0, hw1, tipFrac, th, cellW, half = 0) {
  // half −1 / +1: only that side of the centre ridge (the two halves get different ink-line sub-ids,
  // so the art pass draws the reference's bright ridge line between them)
  const g = half ? new THREE.BoxGeometry(0.5, 1, 1, 1, 2, 18).translate(half * 0.25, 0, 0) : new THREE.BoxGeometry(1, 1, 1, 2, 2, 18);
  const pos = g.attributes.position;
  const guv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i), t = pos.getZ(i) + 0.5;
    const body = 1 - tipFrac;
    const hw = tipFrac <= 0 || t < body ? hw0 + (hw1 - hw0) * (t / Math.max(1e-6, body)) : hw1 * Math.max(0, 1 - (t - body) / tipFrac);
    const thick = th * (1 - Math.abs(u) * 1.7) * Math.sqrt(Math.max(0.05, hw / hw0));
    pos.setXYZ(i, u * 2 * hw, v * 2 * Math.max(0.002, thick), t * len);
    guv[i * 2] = u * 2 * cellW;
    guv[i * 2 + 1] = t * len;
  }
  g.computeVertexNormals();
  g.setAttribute('aGUV', new THREE.BufferAttribute(guv, 2));
  return g;
}

/** Concatenate indexed/non-indexed geometries that carry position, normal and aGUV (and aPart, the
 *  ink-line sub-id: 0 where a geometry has none). */
function mergeGeometries(list) {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), guv = new Float32Array(nv * 2), part = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.aGUV, k = g.attributes.aPart;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i);
      nor[(vo + i) * 3 + 1] = n.getY(i);
      nor[(vo + i) * 3 + 2] = n.getZ(i);
      guv[(vo + i) * 2] = u.getX(i);
      guv[(vo + i) * 2 + 1] = u.getY(i);
      part[vo + i] = k ? k.getX(i) : 0;
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
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Ink-line sub-id (0 / 1) of a geometry: the art pass draws a line between neighbouring pieces of
 * one material whose sub-ids differ (coat panels, torn strips, hair locks, armour lames), on top of
 * the per-material part ids (HERO_ART in materials.js). Returns g.
 */
function sub(g, k) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(k ? 1 : 0), 1));
  return g;
}

/** Merge the static meshes hung directly on each joint that share a material into one mesh
 *  (their own transforms baked in). `keep` = meshes that must stay separate (toggled ones). */
function mergeStatic(root, keep) {
  const joints = [];
  root.traverse((o) => {
    if (!o.isMesh) joints.push(o);
  });
  for (const j of joints) {
    const groups = new Map();
    for (const c of j.children) {
      if (!c.isMesh || keep.has(c)) continue;
      const list = groups.get(c.material) ?? [];
      list.push(c);
      groups.set(c.material, list);
    }
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        return m.geometry.clone().applyMatrix4(m.matrix);
      });
      for (const m of list) j.remove(m);
      j.add(new THREE.Mesh(mergeGeometries(geos), mat));
    }
  }
}

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** A tapered spike from `base` along `dir`, its tip curling toward `bend`. Parent space. aGUV +y
 *  runs toward the tip, so the 'A' / '^' glyphs point along it. `flat` < 1 flattens it into a
 *  blade (thin across the bend plane). */
function spike(len, r, base, dir, bend, curl = 0.22, radial = 5, flat = 1) {
  const g = hornGeometry(len, r, { radial, curve: curl });
  if (flat !== 1) g.scale(flat, 1, 1);
  orientTo(g, base, dir, bend);
  if (flat !== 1) g.computeVertexNormals();
  return g;
}

/** Re-orient a geometry built along local +Z (its curl toward local +Y, its width along local X)
 *  so +Z runs along `dir` from `base` and +Y leans toward `bend`. Parent space. */
function orientTo(g, base, dir, bend) {
  _bz.set(dir[0], dir[1], dir[2]).normalize();
  _by.set(bend[0], bend[1], bend[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-6) _by.set(0, -1, 0).addScaledVector(_bz, _bz.y);
  if (_by.lengthSq() < 1e-6) _by.set(1, 0, 0).addScaledVector(_bz, _bz.x);
  _by.normalize();
  _bx.crossVectors(_by, _bz);
  _m.makeBasis(_bx, _by, _bz).setPosition(base[0], base[1], base[2]);
  return g.applyMatrix4(_m);
}

/**
 * A flattened tapered clump / blade along local +Z (length L): half-width `w` along X, half-
 * thickness `th` along Y, tapering to a point (`taper` < 1 keeps it full longer), the tip curling
 * toward +Y by `curl` × L. Only the stretch t0 … t1 of its length is built, so one clump can be
 * split between two materials (dark roots, sheened tips). aGUV: x around, y toward the tip (the
 * 'A' / '^' carets point along it). Use orientTo() to place it.
 */
function clumpGeometry(L, w, th, { t0 = 0, t1 = 1, curl = 0.2, taper = 1, cols = 6, rows = 3 } = {}) {
  return gridGeometry(cols, rows, (s, tt, o) => {
    const t = lerp(t0, t1, tt);
    const k = Math.pow(Math.max(0, 1 - t), taper);
    const a = s * Math.PI * 2;
    o[0] = Math.cos(a) * w * k;
    o[1] = Math.sin(a) * th * k + curl * L * t * t;
    o[2] = t * L;
    o[3] = (a - Math.PI) * Math.max(w, 0.02);
    o[4] = t * L;
  });
}

/** A straight-sided elliptical band around local Y (a belt): radii rx / rz, height h, centred on
 *  y = 0. Outward-facing; aGUV x around, y up. */
function bandGeometry(rx, rz, h, segs = 24) {
  return gridGeometry(segs, 1, (s, t, o) => {
    const a = s * Math.PI * 2;
    o[0] = Math.sin(a) * rx;
    o[1] = (t - 0.5) * h;
    o[2] = Math.cos(a) * rz;
    o[3] = (a - Math.PI) * (rx + rz) * 0.5;
    o[4] = o[1];
  });
}

/** An open dome shell (the upper part of an ellipsoid, elevation elMin → top) for a pauldron
 *  lame: thin plate, the lower rim left open so the gap to the next lame shows. aGUV upright. */
function domeShell(rx, ry, rz, elMin = -0.15, cols = 14, rows = 4) {
  return gridGeometry(cols, rows, (s, t, o) => {
    const a = s * Math.PI * 2;
    const el = lerp(elMin, Math.PI / 2, t);
    o[0] = Math.sin(a) * Math.cos(el) * rx;
    o[1] = Math.sin(el) * ry;
    o[2] = Math.cos(a) * Math.cos(el) * rz;
    o[3] = (a - Math.PI) * (rx + rz) * 0.5;
    o[4] = el * ry;
  });
}

/** The bevel band along a dome shell's lower rim: a short outward-facing strip just proud of it. */
function domeRim(rx, ry, rz, elMin, h = 0.01, proud = 0.004, cols = 14) {
  return gridGeometry(cols, 1, (s, t, o) => {
    const a = s * Math.PI * 2;
    const el = elMin + (t * h) / ry;
    const k = 1 + proud / Math.min(rx, rz);
    o[0] = Math.sin(a) * Math.cos(el) * rx * k;
    o[1] = Math.sin(el) * ry - 0.002;
    o[2] = Math.cos(a) * Math.cos(el) * rz * k;
    o[3] = (a - Math.PI) * (rx + rz) * 0.5;
    o[4] = o[1];
  });
}

/** A geometry rotated (X, then Y, then Z) and moved in place. */
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Scalp-cap radii (hero.md §2.1, widened for the game read: the head with its hair reads ≈1.25×
 *  the skull), centred 1 cm behind the skull centre. The clumps root on this surface. */
const CAP = { rx: 0.12, ry: 0.132, rz: 0.126, y: 0.014, z: -0.012 };

/** A point on the scalp cap (head space): azimuth from +Z toward +X (the hero's left), elevation
 *  above the cap's equator, `f` < 1 sinks it under the surface so a clump's root is hidden. */
function capPoint(az, el, f = 0.9) {
  const [sx, sy, sz] = DIM.skull;
  return [
    sx + Math.sin(az) * Math.cos(el) * CAP.rx * f,
    sy + CAP.y + Math.sin(el) * CAP.ry * f,
    sz + CAP.z + Math.cos(az) * Math.cos(el) * CAP.rz * f,
  ];
}

/** Messy black mop (hero.md §2.1): a scalp cap that leaves the face open, a heavy fringe of 7
 *  tapered clumps falling DOWN over the eyes (one strand across the right eye), a long left lock to
 *  the jaw, short right locks with the ear exposed, a jagged rim of clumps sticking out sideways and
 *  back at temple / crown height, short crown flicks (2–3 near vertical) and nape locks down to the
 *  collar. Each clump is split at 60 % of its length: dark roots (`hair`) and sheened tips
 *  (`hairTip`), so the violet glints sit on the strand ends only. Per-cluster geometries offset to
 *  their pivots: { name: { mass, tip } }. */
function hairGeometries() {
  const r = rng(77);
  const j = (a) => (r() - 0.5) * 2 * a;
  const S = {};
  for (const c of HAIR_CLUSTERS) S[c.name] = { mass: [], tip: [] };
  // clump: length, half-width, half-thickness, root, direction, curl-toward, curl amount
  // ink-line sub-ids: the locks of the mop alternate, so the art pass draws a strand line where one
  // overlaps the next (they radiate from the crown whorl: the reference's strand lines); the fringe
  // takes one id (alternating fringe ids drew parallel bars over the face)
  let lock = 0;
  const clump = (name, L, w, th, base, dir, bend, curl = 0.18, taper = 0.85) => {
    const k = name === 'fringe' ? 0 : lock++ % 2;
    for (const [t0, t1, key] of [[0, 0.6, 'mass'], [0.6, 1, 'tip']]) {
      S[name][key].push(sub(orientTo(clumpGeometry(L, w, th, { t0, t1, curl, taper, rows: key === 'mass' ? 3 : 2 }), base, dir, bend), k));
    }
  };
  // scalp directions at (azimuth, elevation): straight out, and down the scalp along the meridian
  const radial = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const merid = (az, el) => [Math.sin(az) * Math.sin(el), -Math.cos(el), Math.cos(az) * Math.sin(el)];
  const side = (az) => (Math.abs(Math.atan2(Math.sin(az), Math.cos(az))) > 2.5 ? 'crown' : Math.sin(az) > 0 ? 'left' : 'right');
  // fringe (the reference: thin pointed locks of uneven length hanging over the eyes to the nose,
  // fanned to either side): 9 locks across the front hairline, tips curling a little off the face,
  // plus two long strands across the eyes. The two locks over his LEFT eye stop above it, so it
  // shows between the strands as in the reference (the right eye stays covered)
  for (let i = 0; i < 9; i++) {
    const u = (i / 8) * 2 - 1 + j(0.07);
    // (round 2: a little shorter, so the pale face shows under the fringe as in the reference)
    const L = (0.065 + 0.045 * (1 - u * u) + j(0.02)) * (i === 5 || i === 6 ? 0.55 : 1);
    const base = capPoint(u * 0.72, 0.72 - 0.1 * u * u + j(0.05), 0.99);
    clump('fringe', L, 0.02 + 0.007 * r() - 0.003 * Math.abs(u), 0.008, base, [u * 0.5 + j(0.25), -0.9, 0.44 - 0.12 * Math.abs(u)], [u * 0.3, 0.25, -1], 0.08 + j(0.05), 0.9);
  }
  clump('fringe', 0.12, 0.012, 0.005, capPoint(-0.25, 0.66, 0.99), [-0.2, -0.93, 0.4], [0, 0.2, -1], 0.08, 0.95);
  // hero's left: the long lock down in front of the ear to the jaw, flicks out and back
  clump('left', 0.14, 0.017, 0.008, capPoint(1.12, 0.3), [0.25, -1, 0.12], [1, 0, 0.2], 0.22, 0.85);
  clump('left', 0.11, 0.015, 0.007, capPoint(1.38, 0.42), [0.85, -0.45, -0.3], [0.3, 1, 0], 0.3, 0.8);
  clump('left', 0.1, 0.015, 0.007, capPoint(1.8, 0.38), [0.75, -0.3, -0.65], [0.2, 1, 0], 0.3, 0.8);
  // hero's right: locks swept back and out over the ear (the ear shows below)
  for (let i = 0; i < 4; i++) {
    clump('right', 0.095 + 0.015 * (i % 2) + j(0.01), 0.015, 0.007, capPoint(-1.2 - i * 0.25, 0.4 + 0.05 * i), [-0.75 + j(0.1), -0.3 + j(0.1), -0.6], [-0.2, 1, 0], 0.3, 0.8);
  }
  // the messy mop: thick locks rooted round the crown whorl lie down over the scalp (each one
  // outlined by the art pass: the reference's strand lines) and lift off it at their pointed ends,
  // so the dome is hidden and the outline is a jagged ring of tips outside the cap
  // (round 2: a bigger cap and longer locks that hang down round it, lifting a little at the tips:
  // the reference's big, round, messy volume instead of a tight cap)
  // (the locks lie over the bigger cap and lift only a little at their ends: lifting them further
  // turned the mop into a brim of horizontal spikes)
  for (const [n, el0, a0, L0, curl, lift] of [[14, 1.12, 0.6, 0.17, 0.14, 0.06], [12, 0.72, 0.85, 0.14, 0.1, 0.0]]) {
    for (let i = 0; i < n; i++) {
      const az = a0 + ((i + (el0 < 1 ? 0.5 : 0)) / n) * (Math.PI * 2 - 2 * a0) + j(0.12); // all round but the fringe's front
      const el = el0 + j(0.1);
      const rad = radial(az, el), m = merid(az, el);
      clump(side(az), L0 + j(0.03), 0.028, 0.012, capPoint(az, el, 0.95), [m[0] + rad[0] * lift, m[1] * 1.15 + rad[1] * lift, m[2] + rad[2] * lift], [-rad[0], -rad[1], -rad[2]], curl + j(0.06), 0.6);
    }
  }
  // ragged flicks out sideways and back at temple / ear height (the jagged side edges), drooping;
  // thin, so up close they print as the reference's dotted wisps rather than solid spikes
  for (const az of [1.45, 1.8, 2.15, 2.5, -1.5, -1.85, -2.2, -2.55, 2.85, -2.9]) {
    const el = 0.22 + j(0.12);
    const rad = radial(az, el);
    clump(side(az), 0.06 + j(0.015), 0.012, 0.008, capPoint(az + j(0.06), el, 0.9), [rad[0] * 0.55, -0.8 + j(0.12), rad[2] * 0.55 - 0.15], [0, 1, 0], 0.3, 0.8);
  }
  // crown: thin strands standing up and out at 30–60° and curling back (the reference's wispy,
  // bed-head top edge, not a crown of broad spikes), longest toward the hero's right
  for (const [az, el, L] of [[0.45, 1.25, 0.08], [-0.55, 1.2, 0.095], [2.8, 1.3, 0.07], [1.4, 1.1, 0.075], [-1.35, 1.05, 0.09], [-0.1, 1.38, 0.08], [2.1, 1.2, 0.07]]) {
    const ox = Math.sin(az), oz = Math.cos(az);
    // wisps out and back, curling over (not straight spikes standing up)
    clump('crown', L + j(0.012), 0.009, 0.006, capPoint(az, el, 0.88), [ox * 0.9 + j(0.2), 0.45, oz * 0.3 - 0.6], [ox * 0.4, -0.6, -1], 0.75, 0.85);
  }
  // nape locks down to the collar top, tips flicking out
  for (let i = 0; i < 7; i++) {
    const u = (i / 6) * 2 - 1;
    clump('nape', 0.09 + j(0.015), 0.017, 0.007, capPoint(Math.PI + u * 0.8, -0.1 + 0.06 * u * u, 0.92), [u * 0.45, -0.9, -0.38], [u * 0.4, 0.2, -1], 0.28, 0.85);
  }
  const out = {};
  for (const c of HAIR_CLUSTERS) {
    out[c.name] = {};
    for (const key of ['mass', 'tip']) {
      const g = mergeGeometries(S[c.name][key]);
      g.translate(-c.pivot[0], -c.pivot[1], -c.pivot[2]);
      out[c.name][key] = g;
    }
  }
  return out;
}

/** Scalp cap (CAP radii, 1 cm behind the skull centre) with the face left open: the hairline sits
 *  at +0.03 m at the front, above the ears at the sides (higher on the right, where the ear
 *  shows), at the collar behind. aGUV upright. Head space. */
function hairCap() {
  const [sx, sy, sz] = DIM.skull;
  const limit = (cx, cz) => {
    const h = Math.max(1e-6, Math.hypot(cx, cz));
    const right = Math.max(0, -cx / h) * Math.max(0, 1 - Math.abs(cz / h) * 1.6);
    return -0.07 + 0.1 * Math.pow((1 + cz / h) / 2, 1.5) + 0.03 * right;
  };
  return gridGeometry(22, 10, (s, t, o) => {
    const ph = (s - 0.5) * Math.PI * 2;
    const th = t * Math.PI * 0.82;
    o[0] = sx + Math.sin(th) * Math.sin(ph) * CAP.rx;
    o[1] = sy + CAP.y + Math.cos(th) * CAP.ry;
    o[2] = sz + CAP.z + Math.sin(th) * Math.cos(ph) * CAP.rz;
    o[3] = ph * 0.1;
    o[4] = o[1];
  }, true, (i, jj, pos, a, b, c, d) => {
    let x = 0, y = 0, z = 0;
    for (const k of [a, b, c, d]) {
      x += pos[k * 3] / 4;
      y += pos[k * 3 + 1] / 4;
      z += pos[k * 3 + 2] / 4;
    }
    return y - sy < limit(x - sx, z - sz + 0.01);
  });
}

/** The tall flared stand collar (hero.md §2.3), chest space: base ring (r 0.078) at 1.505 m
 *  flaring to r 0.12 at 1.61 m behind, the top edge rolled out 0.015 m, the front corners rising to
 *  1.635 m beside the jaw; open in a V at the throat (0.02 m at the base → 0.07 m at the top), so the
 *  chin and jaw show. */
function collarGeometry() {
  const y0 = 1.505 - REST.chest, yB = 1.61 - REST.chest, yF = 1.635 - REST.chest;
  return gridGeometry(24, 5, (s, t, o) => {
    const gap = lerp(0.015, 0.08, Math.pow(t, 1.4));
    const fl = Math.pow(t, 0.8);
    const roll = 0.015 * Math.pow(Math.max(0, (t - 0.65) / 0.35), 2);
    // (round 3: ~11 % bigger round the thicker neck and the broader shoulders)
    const rx = lerp(0.088, 0.132, fl) + roll, rz = lerp(0.081, 0.106, fl) + roll * 0.5;
    const a0 = Math.asin(gap / rx);
    const a = a0 + s * (Math.PI * 2 - 2 * a0);
    const front = Math.pow((1 + Math.cos(a)) / 2, 2);
    const y = lerp(y0 + 0.012 * front * (1 - t), lerp(yB, yF, front), t);
    o[0] = Math.sin(a) * rx;
    o[1] = y;
    o[2] = Math.cos(a) * rz - 0.008;
    o[3] = (a - Math.PI) * 0.1;
    o[4] = y;
  });
}

// Glyph ramps (hero.md §3): `levels` dark → bright, each a set of per-cell variants; spaces are
// the panel's empty interior cells. The caret family A / ^ carries the figure at every light
// level (the darkest level is still carets, so shadow sides print dim ' ^ instead of going black),
// dense 8 B D on the lit flanks, strokes ' 1 between. No bar glyphs (they read as text) and no
// lone dots (polka dots).
const CLOTH_LEVELS = ["'^ '^", "A' ^'", "A^ A'", "AA^ A", "AA^A8", "AAA8A^"];
const PANTS_LEVELS = ["'^'", "A'^ ", "A^1A", "AA^ ", "AAA8", "AA8BA"];
const HEM_LEVELS = ["'A^ ", "A'^ ", "^A'A", "AA^", "AAA^", "AAA"];
const HAIR_LEVELS = [" '", "' ^", "'^ ", "^'A", "A^'", "A^'A"];
const ARMOR_LEVELS = ["-'A", "-A=", "=A-", "A=A^", "A=AA8", "AA8A="];
const BLADE_LEVELS = ["^'", "'^", "^A", "A^"];
const LEATHER_LEVELS = [":'", "=:", ":=", "=#="];

/**
 * Glyph scale follows the view distance (hero.md §7): at the 36 m game camera the cells are the
 * in-game size (10–14 rows for the figure, ≥ 6 px per glyph); closer in (Lab, showroom, cut-ins)
 * they shrink to a third, so a 4 m close-up shows the ASCII panel's ~30-row field instead of a
 * mannequin stamped with giant letters. Small parts (hair, collar, plates) are also capped, so a
 * curved part never holds one huge glyph cut into stripes by its silhouette. Per material:
 * userData.cell = the in-game cell, userData.cellMax = the cap, userData.lockX = keep the width
 * (the blade's two columns are tied to its geometry). Materials without userData.cell stay fixed.
 * `farZoom` = the cloth / plate glyph zoom at the game camera (userData.zoom): 0.45 lets each glyph
 * fill its ~5 px cell, so the 26 px figure prints as the panel's light-grey caret field next to the
 * wyrm; at 0.62 the strokes went sub-pixel and the hero read as a dark blob among the stones.
 */
export const GLYPH_SCALE = { refDist: 12, min: 0.15, farZoom: 0.45 };

/** Set every hero material's glyph cell (and glyph zoom) for a camera `dist` metres away. Returns
 *  the scale k (1 = the game camera). No allocation. */
export function setHeroGlyphScale(mats, dist) {
  const k = Math.min(1, Math.max(GLYPH_SCALE.min, (Number.isFinite(dist) ? dist : GLYPH_SCALE.refDist) / GLYPH_SCALE.refDist));
  const near = (1 - k) / (1 - GLYPH_SCALE.min); // 0 at the game camera … 1 in a close-up
  for (const m of mats) {
    const ud = m.userData;
    const b = ud?.cell;
    if (!b) continue;
    const mx = ud.cellMax;
    let w = ud.lockX ? b[0] : b[0] * k, h = b[1] * k;
    if (mx) {
      w = Math.min(w, mx[0]);
      h = Math.min(h, mx[1]);
    }
    m.uniforms.uCell.value.set(w, h);
    // close up, cloth glyphs sit smaller in their cells (more black between them, like the
    // panel's thin glyph field); at the game camera they fill the cell so they stay legible
    if (ud.zoom != null) m.uniforms.uGlyphZoom.value = ud.zoom + (ud.zoomNear - ud.zoom) * near;
  }
  return k;
}

/**
 * Camera lean (ADR-017). Seen from the steep game camera, a standing figure mostly shows its top and
 * spans about half its height on screen. The hero's root therefore shears the body away from the
 * camera, with the feet planted, so the figure faces the view like the owner's reference and gets
 * ~1.5x the letter rows. The lean angle is `frac` × the camera's pitch below the horizon (29° at
 * the 58° game camera, ~0 in a side view), capped at `max`. Visual only: gameplay reads unleaned
 * positions (Player.unlean).
 */
export const LEAN = { frac: 0.5, max: (32 * Math.PI) / 180 };

/**
 * Drawn size of the hero (model units → world metres), owner: "a little bigger for his details to
 * show". Visual only, like the lean: hits, the hurt cylinder and the dragon's aim keep the 1.85 m
 * body (Player.unlean divides it out). The blade then draws to 1.8 m, about the gameplay reach
 * (DIM.bladeTip 1.5 + REACH.tipExt 0.4).
 */
export const HERO_SCALE = 1.2;

/**
 * Make `root` compose its matrix as T · lean · R · HERO_SCALE while `lean.on` (drawing, FX, the
 * sword sweep), or the plain T · R while it is off: the animator runs with it off, so its IK, ground
 * clamps and coat springs work on the upright 1.85 m body in metres. Returns the live lean
 * { k, dx, dz, on }: the drawn body shifts by k · height along the horizontal unit vector (dx, dz).
 */
export function installLean(root) {
  const lean = { k: 0, dx: 0, dz: -1, on: true };
  root.updateMatrix = function updateLeanMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    if (lean.on) {
      const e = this.matrix.elements;
      for (let c = 0; c < 12; c += 4) {
        e[c] *= HERO_SCALE;
        e[c + 1] *= HERO_SCALE;
        e[c + 2] *= HERO_SCALE;
        const y = e[c + 1];
        e[c] += lean.k * lean.dx * y;
        e[c + 2] += lean.k * lean.dz * y;
      }
    }
    this.matrixWorldNeedsUpdate = true;
  };
  return lean;
}

// The moonlight is cold (B/R ≈ 1.7), so the body inks lean warm: lit glyphs come out the panel's
// neutral grey instead of lavender. Cloth stays under the bloom threshold (no halos: the panel's
// glyphs sit on pure black) and averages a mid grey; only the blade, the gem, the buckles and the
// hair tips glow. `inkGlow` (≈0.13 on cloth) keeps the shadow side a dim field of carets; outline
// / rim stay low (the panel has no drawn outline): the black gaps between glyphs carry the form.
/**
 * Brightness of the smooth source the creature ASCII-art pass converts (FLAG.ART_HERO): 1.1 keeps the
 * owner's reference look: mostly mid-to-dense letters, sparse ones only in real shadow.
 */
export const ART_GAIN = 1.1;

/**
 * The hero as INK-LINE ART (the owner's reference image: anime line art turned into ASCII). Per
 * material, the art source the pass converts: a dim flat `fill` (linear rgb: the pass prints it as
 * dense dark letters), a `part` id (the pass draws a bright ink line where two parts meet; the
 * higher id draws it, so parts layered on top get higher ids), white glints on metal (`spec`,
 * `specPow`), the cool screen-left rim (`rim`, default 1) and how much of the animated ink glow the
 * part emits (`glow`: the blade, the gem, the flask). `line` = that part's ink-line tint [r, g, b]
 * and gain (> 1 glows under bloom: the cyan blade edges, the violet gem); default white × 1.
 * `fillGain` scales the brightness of its letter fill (default 1); `dotted` prints its outer edges
 * as bright specks instead of strokes (the reference's dotted rags and hair wisps). Materials
 * sharing a part must share these. `folds` [bands per metre across aGUV x (rad), depth, wander]
 * darkens fold streaks into the fill up close (the coat), per material. See HERO_ART in
 * render/materials.js.
 */
// `farFill` = the part's letter-fill gain at the game camera (× the pass's uHeroLod.z): there the
// reference scaled down is a DARK figure (black coat, dark pants and hair) with bright silver
// armour, pale lavender tails, a pale face and the cyan blade, so cloth drops and metal rises.
// `farLine` = how much light its inner lines keep there (0: a dark seam, the cloth; 1: the armour).
// `solid` = unbroken ink lines (the blade, the gem); `open` = its letters stay lit beside an edge (no
// dark channel or depth-step gap: the face, a small pale patch walled in by the fringe and the
// collar, would print dim). The blade is depth-tested like every other part (round 3 removed the
// game-camera depth pull: the sword showed through his back and legs).
export const HERO_INK = {
  skin: { part: 1, fill: [0.92, 0.64, 0.56], rim: 0.3, line: [1.0, 0.82, 0.76, 0.65], fillGain: 2.2, farFill: 0.8, open: true },
  eye: { part: 2, fill: [0.07, 0.055, 0.12], rim: 0, line: [0.75, 0.62, 1.0, 0.9] },
  shirt: { part: 3, fill: [0.1, 0.1, 0.12], line: [1, 1, 1, 0.85], farFill: 0.35 },
  lining: { part: 4, fill: [0.075, 0.07, 0.12], line: [0.75, 0.72, 1.0, 0.85], farFill: 0.5 },
  collarIn: { part: 4, fill: [0.12, 0.1, 0.26], line: [0.75, 0.72, 1.0, 0.85], farFill: 0.5 },
  pants: { part: 5, fill: [0.12, 0.12, 0.14], line: [1, 1, 1, 0.9], farFill: 0.35 },
  coat: { part: 6, fill: [0.175, 0.165, 0.155], folds: [34, 0.85, 1.1], farFill: 0.35 },
  collar: { part: 6, fill: [0.175, 0.165, 0.155], farFill: 0.35 },
  facing: { part: 7, fill: [0.13, 0.12, 0.22], line: [0.9, 0.88, 1.0, 1], farFill: 0.5 },
  hem: { part: 8, fill: [0.3, 0.28, 0.42], rim: 1.2, line: [0.85, 0.82, 1.0, 1], dotted: true, farFill: 0.4 },
  piping: { part: 9, fill: [0.3, 0.28, 0.36], line: [0.9, 0.88, 1.0, 1], farFill: 0.6 },
  leather: { part: 10, fill: [0.3, 0.2, 0.15], line: [1.0, 0.93, 0.85, 0.9], farFill: 0.8 },
  // the reference's hair: near-neutral dark letters (lit mean ≈ rgb 103 99 113) with violet-white
  // strands on the outer edges and tips, not a navy cap; the tips carry the violet
  hair: { part: 11, fill: [0.085, 0.08, 0.12], rim: 0.9, line: [0.8, 0.72, 1.0, 1.4], fillGain: 2.6, dotted: true, farFill: 0.5 },
  hairTip: { part: 11, fill: [0.2, 0.16, 0.4], rim: 0.9, line: [0.8, 0.72, 1.0, 1.4], fillGain: 2.6, dotted: true, farFill: 0.5 },
  // the reference's armour: dark steel plates whose bright white edges and glints make it the
  // brightest thing on him (a light grey fill read as flat paper cut-outs up close)
  armor: { part: 12, fill: [0.3, 0.3, 0.34], spec: 1.35, specPow: 18, line: [1, 1, 1, 1.3], fillGain: 1.35, farLine: 0.55, farFill: 1.05 },
  spike: { part: 13, fill: [0.32, 0.32, 0.36], spec: 0.8, specPow: 16, line: [1, 1, 1, 1.35], fillGain: 1.05, farLine: 0.7, farFill: 1.2 },
  bevel: { part: 14, fill: [0.5, 0.52, 0.6], spec: 0.5, line: [1, 1, 1, 1.2], fillGain: 1.6, farLine: 0.6, farFill: 1.1 },
  welt: { part: 15, fill: [0.3, 0.31, 0.36] },
  trim: { part: 16, fill: [0.36, 0.37, 0.42], spec: 0.8, line: [1, 1, 1, 1.25], fillGain: 1.3, farLine: 0.7, farFill: 1.2 },
  // the reference's blade: dark steel between two glowing cyan edges and a bright ridge line (the
  // fill letters stay dim up close; far away the whole blade reads as one bright cyan line)
  blade: { part: 17, fill: [0.06, 0.1, 0.18], spec: 0.5, glow: 1, line: [0.45, 0.95, 1.35, 1.7], fillGain: 0.4, solid: true, farLine: 1, farFill: 2.0 },
  bladeTip: { part: 17, fill: [0.1, 0.2, 0.32], glow: 1, line: [0.45, 0.95, 1.35, 1.7], fillGain: 0.4, solid: true, farLine: 1, farFill: 2.0 },
  gem: { part: 18, fill: [0.3, 0.06, 0.7], glow: 1, rim: 0, line: [1.1, 0.45, 1.8, 2.0], solid: true, farLine: 1 },
  flask: { part: 19, fill: [0.6, 0.45, 0.15], glow: 1, rim: 0, line: [1.2, 0.9, 0.4, 1.5], solid: true, farLine: 1 },
};

export function createHeroMaterials(U) {
  const S = (o, opts = {}) => ({ o, opts });
  const make = (name, o, { max = null, lockX = false, fixed = false, zoomNear = null } = {}) => {
    const heroArt = HERO_INK[name];
    if (!heroArt) throw new Error(`hero material "${name}" has no HERO_INK entry`);
    const m = createSurfaceGlyphMaterial(U, { glyphZoom: 0.62, artGain: ART_GAIN, flag: FLAG.ART_HERO, heroArt, ...o });
    if (!fixed && o.cell) {
      m.userData.cell = o.cell.slice();
      if (max) m.userData.cellMax = max;
      if (lockX) m.userData.lockX = true;
      if (zoomNear != null) {
        m.userData.zoom = o.glyphZoom ?? GLYPH_SCALE.farZoom;
        m.userData.zoomNear = zoomNear;
      }
    }
    return m;
  };
  const Z = 1.0; // close-up glyph zoom for cloth / plates (> GLYPH_SCALE.farZoom: smaller glyphs, more black)
  const hair = {
    levels: HAIR_LEVELS, cell: [0.09, 0.1], rowShift: 0.5, base: [0.005, 0.005, 0.01],
    levelInk: [[0.16, 0.16, 0.21], [0.2, 0.2, 0.26], [0.25, 0.25, 0.32]], ink: [0.22, 0.22, 0.3],
    inkAlt: [0.55, 0.42, 0.95], altChance: 0, lumScale: 3.5, gain: 1.1, rim: 0.1, outline: 0.06, inkGlow: 0.26, glowMask: 0,
  };
  const cloth = {
    levels: CLOTH_LEVELS, rowShift: 0, base: [0.007, 0.007, 0.011],
    levelInk: [[0.26, 0.25, 0.215], [0.29, 0.28, 0.24], [0.32, 0.31, 0.265], [0.35, 0.34, 0.29], [0.38, 0.37, 0.315], [0.42, 0.41, 0.35]],
    ink: [0.35, 0.34, 0.29], inkAlt: [0.38, 0.36, 0.4], altChance: 0.08, lumScale: 3.5,
    gain: 0.85, rim: 0.15, outline: 0.12, inkGlow: 0.14,
  };
  const silver = { glyphs: '-=#8', rowShift: 0, base: [0.025, 0.027, 0.032], ink: [0.8, 0.84, 1.0], lumScale: 4 };
  const specs = {
    // black mop, dark roots: near-black blue-grey carets, no sheen
    hair: S({ ...hair, seed: 4.2 }, { max: [0.045, 0.055], zoomNear: 0.85 }),
    // the outer 40 % of every clump: the same mass with violet glints on ~45 % of the cells, so the
    // sheen sits on the strand tips (outer rim, flicks), never as a flat purple cap
    hairTip: S({ ...hair, altChance: 0.45, inkGlow: 0.34, seed: 4.9 }, { max: [0.045, 0.055], zoomNear: 0.85 }),
    // pale face: dense warm cells in the gap between the fringe and the collar, the lightest thing
    // on the head; even the darkest level prints :o so the face is never a black void. Fixed
    // 0.016 m cells (≈12 px in a head close-up, a pale 1–2 px sliver at the game camera)
    skin: S({
      levels: [":o", "o:", "oo0", "o0o"], cell: [0.016, 0.016], rowShift: 0.5, base: [0.12, 0.1, 0.1],
      ink: [0.78, 0.72, 0.7], gain: 0.65, rim: 0.1, outline: 0.06, inkGlow: 0.44, lumScale: 3, glowMask: 0, glyphZoom: 0.5, seed: 9.1,
    }, { fixed: true }),
    // the visible (left) eye: one grey-violet half-lidded cell
    eye: S({
      glyphs: '----', cell: [0.03, 0.016], rowShift: 0, base: [0.05, 0.04, 0.06],
      ink: [0.5, 0.46, 0.72], gain: 0.6, rim: 0, outline: 0, inkGlow: 0.7, glowMask: 0, glyphZoom: 0.7, seed: 9.7,
    }, { fixed: true }),
    // black greatcoat: upright carets in aligned columns, neutral grey, under the bloom threshold
    coat: S({ ...cloth, cell: [0.12, 0.19], seed: 17.5 }, { zoomNear: Z }),
    // the stand collar: the coat's ink in a fine grid (a 0.10 m band must not hold one huge glyph)
    collar: S({ ...cloth, cell: [0.06, 0.075], seed: 19.1 }, { max: [0.04, 0.05], zoomNear: Z }),
    // the collar's blue-violet inner face: reads even unlit
    collarIn: S({
      glyphs: "'^AA", cell: [0.06, 0.075], rowShift: 0, base: [0.03, 0.025, 0.08],
      ink: [0.3, 0.27, 0.55], gain: 0.55, rim: 0.06, outline: 0.04, inkGlow: 0.3, lumScale: 3, glowMask: 0, side: THREE.BackSide, seed: 23.9,
    }, { max: [0.04, 0.05], zoomNear: 0.9 }),
    // indigo lining: the inside of the skirt flare
    lining: S({
      glyphs: "'^AA", cell: [0.1, 0.14], rowShift: 0.5, base: [0.012, 0.01, 0.035],
      ink: [0.2, 0.18, 0.4], inkAlt: [0.27, 0.23, 0.45], altChance: 0.3, lumScale: 3,
      gain: 1.0, rim: 0.1, outline: 0.08, inkGlow: 0.18, glowMask: 0, side: THREE.BackSide, seed: 23.1,
    }, { zoomNear: Z }),
    // the lapel facings and the back emblem: front-facing lining
    facing: S({
      glyphs: "'^AA", cell: [0.05, 0.08], rowShift: 0, base: [0.016, 0.014, 0.04],
      ink: [0.22, 0.2, 0.4], gain: 0.8, rim: 0.08, outline: 0.06, inkGlow: 0.16, lumScale: 3, glowMask: 0, seed: 23.7,
    }, { max: [0.04, 0.06], zoomNear: 0.9 }),
    // 5 mm grey-violet piping along the coat's front edges and lapels
    piping: S({
      glyphs: '-=-=', cell: [0.03, 0.03], rowShift: 0, base: [0.02, 0.018, 0.03],
      ink: [0.45, 0.42, 0.55], gain: 0.9, rim: 0.08, outline: 0.06, inkGlow: 0.32, lumScale: 3, glowMask: 0, seed: 24.4,
    }, { max: [0.03, 0.03] }),
    // torn tails + sleeve streamers: a dusty grey-lavender torn zone, not glowing trim
    hem: S({
      levels: HEM_LEVELS, cell: [0.1, 0.16], rowShift: 0.5, base: [0.012, 0.009, 0.018],
      levelInk: [[0.28, 0.265, 0.27], [0.31, 0.295, 0.3], [0.35, 0.33, 0.34]], ink: [0.35, 0.33, 0.34],
      inkAlt: [0.46, 0.36, 0.72], altChance: 0.18, lumScale: 3.5,
      gain: 0.95, rim: 0.12, outline: 0.1, inkGlow: 0.15, glowMask: 0, side: THREE.DoubleSide, seed: 31.3,
    }, { zoomNear: Z }),
    // black shirt in the open coat front: a finer grid than the coat, so the V reads as its own cloth
    shirt: S({
      levels: ["'^", "'^'", "^A'", "A^"], cell: [0.04, 0.06], rowShift: 0, base: [0.006, 0.006, 0.01],
      levelInk: [[0.24, 0.24, 0.26], [0.3, 0.3, 0.33]], ink: [0.3, 0.3, 0.33],
      gain: 0.95, rim: 0.1, outline: 0.08, inkGlow: 0.13, lumScale: 3.5, seed: 12.2,
    }, { max: [0.03, 0.045], zoomNear: Z }),
    // silver hardware: buckles, rings, the gem frame — the brightest small metal
    trim: S({ ...silver, cell: [0.05, 0.045], gain: 0.85, rim: 0.12, outline: 0.1, inkGlow: 0.34, seed: 2.7 }, { max: [0.035, 0.03] }),
    // silver plate bevels (pauldron, vambrace, shin lames, knee guards): thin bright lines
    bevel: S({ ...silver, glyphs: '-=-=', cell: [0.04, 0.02], ink: [0.72, 0.76, 0.9], gain: 1.0, rim: 0.1, outline: 0.08, inkGlow: 0.3, glowMask: 0, seed: 2.9 }, { max: [0.03, 0.014] }),
    // the boots' sole welt: a quiet silver line (no light-up sneakers)
    welt: S({ ...silver, glyphs: '-=-=', cell: [0.04, 0.03], ink: [0.5, 0.52, 0.6], gain: 0.8, rim: 0.06, outline: 0.05, inkGlow: 0.18, glowMask: 0, seed: 3.3 }, { max: [0.03, 0.025] }),
    // dark gunmetal plates: pauldron, vambrace, gauntlet, boots, knee guards, crossguard, forte
    armor: S({
      levels: ARMOR_LEVELS, cell: [0.09, 0.1], rowShift: 0, base: [0.012, 0.013, 0.02],
      levelInk: [[0.27, 0.27, 0.27], [0.33, 0.33, 0.33], [0.4, 0.4, 0.4]], ink: [0.4, 0.4, 0.4],
      inkAlt: [0.5, 0.52, 0.6], altChance: 0.2, lumScale: 3.5,
      gain: 1.0, rim: 0.15, outline: 0.12, inkGlow: 0.15, side: THREE.DoubleSide, seed: 21.4,
    }, { max: [0.05, 0.06], zoomNear: 0.92 }),
    // pauldron / knee / vambrace points and blades: +y toward the tip, so the carets point along them
    spike: S({
      glyphs: "'^AA", cell: [0.05, 0.06], rowShift: 0, base: [0.014, 0.015, 0.022],
      ink: [0.52, 0.52, 0.56], gain: 1.1, rim: 0.15, outline: 0.15, inkGlow: 0.3, lumScale: 3.5, side: THREE.DoubleSide, seed: 8.8,
    }, { max: [0.04, 0.05], zoomNear: 0.85 }),
    // black pants: aligned columns of carets down each leg
    pants: S({
      levels: PANTS_LEVELS, cell: [0.11, 0.18], rowShift: 0, base: [0.005, 0.005, 0.008],
      levelInk: [[0.25, 0.24, 0.215], [0.29, 0.28, 0.25], [0.34, 0.33, 0.295]], ink: [0.34, 0.33, 0.295],
      inkAlt: [0.36, 0.34, 0.4], altChance: 0.08, lumScale: 3.5,
      gain: 0.95, rim: 0.15, outline: 0.12, inkGlow: 0.15, seed: 13.3,
    }, { zoomNear: Z }),
    // brown leather: belts, straps, the bracer, the grip — stitched = / : bands, not a mesh of #
    leather: S({
      levels: LEATHER_LEVELS, cell: [0.05, 0.035], rowShift: 0, base: [0.016, 0.011, 0.009],
      ink: [0.42, 0.36, 0.32], gain: 1.15, rim: 0.12, outline: 0.1, inkGlow: 0.3, lumScale: 3.5, glowMask: 0.5, glyphZoom: 0.7, seed: 6.6,
    }, { max: [0.04, 0.03] }),
    // dark faceted blade: two columns of cold chevrons pointing to the tip; the cyan glow lives on
    // the edge and ridge seams (uGlow, driven by player.js), the flats stay dark steel up close and
    // self-light with distance (player.js), so the sword stays the brightest thing in game
    blade: S({
      levels: BLADE_LEVELS, cell: [0.045, 0.09], rowShift: 0, seamAxis: 'y', base: [0.02, 0.03, 0.05],
      levelInk: [[0.12, 0.2, 0.34], [0.15, 0.25, 0.42], [0.18, 0.3, 0.5]], ink: [0.18, 0.3, 0.5],
      inkAlt: [0.3, 0.5, 0.8], altChance: 0.15, lumScale: 3, glyphZoom: 0.72,
      gain: 0.8, rim: 0.25, outline: 0.35, inkGlow: 0.3, emissive: [0.3, 1.25, 2.6], glowMask: 1, seed: 1.9,
    }, { lockX: true }),
    // the last 0.15 m (the taper to the point): the brightest steel
    bladeTip: S({
      levels: ["^A", "A^", "AA"], cell: [0.045, 0.09], rowShift: 0, seamAxis: 'y', base: [0.04, 0.08, 0.12],
      levelInk: [[0.3, 0.62, 0.9], [0.38, 0.8, 1.12], [0.45, 0.95, 1.35]], ink: [0.45, 0.95, 1.35],
      lumScale: 3, glyphZoom: 0.72,
      gain: 1.0, rim: 0.3, outline: 0.5, inkGlow: 0.6, emissive: [0.4, 1.4, 2.8], glowMask: 1, seed: 2.3,
    }, { lockX: true }),
    // the violet gem: saturated violet glyphs (not blown to white), glowing seams
    gem: S({
      glyphs: '+*@@', cell: [0.03, 0.03], base: [0.22, 0.04, 0.5], glyphZoom: 0.72,
      ink: [0.55, 0.12, 1.3], gain: 1.0, rim: 0.3, outline: 0.3, inkGlow: 0.8, lumScale: 4,
      emissive: [0.9, 0.2, 2.2], glowMask: 1, seed: 5.5,
    }, { fixed: true }),
    // flask (only while drinking)
    flask: S({
      glyphs: '.:o0', cell: [0.035, 0.04], base: [0.12, 0.08, 0.02], glyphZoom: 0.72,
      ink: [1.1, 0.85, 0.3], gain: 1.4, rim: 0.3, outline: 0.4, inkGlow: 1.4, glowMask: 0, seed: 3.1,
    }, { fixed: true }),
  };
  // each part's ink-line tint, letter-fill brightness and dotted-edge flag for the art pass
  const partInk = U.uHeroPartInk?.value, partFill = U.uHeroPartFill?.value;
  for (const h of Object.values(HERO_INK)) {
    const l = h.line ?? [1, 1, 1, 1];
    partInk?.[h.part]?.set(l[0], l[1], l[2], l[3]);
    partFill?.[h.part]?.set(h.fillGain ?? 1, (h.dotted ? 1 : h.solid ? 2 : 0) + (h.open ? 4 : 0), h.farLine ?? 0, h.farFill ?? 1);
  }
  return Object.fromEntries(Object.entries(specs).map(([name, s]) => [name, make(name, s.o, s.opts)]));
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
    if (!geo.attributes.aPart) sub(geo, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const ring = (rx, rz, h, segs = 16) => orient.up(ellipsoidGeometry(rx, rz, h, { widthSegs: segs, heightSegs: 4 }));
  const limb = (o) => orient.down(limbGeometry({ flip: true, ...o }));
  const ySp = (h) => h - REST.spine; // world idle height → spine-joint local y
  const yCh = (h) => h - REST.chest;
  const yPe = (h) => h - REST.pelvis;

  const root = new THREE.Group();
  root.name = 'player';
  const body = joint(root, 0, DIM.pivot, 0);
  const pelvis = joint(body, ...DIM.pelvis);

  // ---------------------------------------------------------------- hips, hip strap, drop strap
  {
    const [hx, hy, hz] = BODY.hips.r;
    mesh(pelvis, orient.up(ellipsoidGeometry(hx, hz, hy)), M.pants, ...BODY.hips.c);
  }
  {
    // H1: diagonal hip strap (0.034 m), left hip (1.13 m) down across the front to the right thigh
    const h1 = mesh(pelvis, bandGeometry(0.196, 0.148, 0.034, 28), M.leather, 0.012, yPe(1.04), 0.004);
    h1.rotation.z = 0.55;
    // D1: centre drop strap from the second belt to 0.93 m, a D-ring and a pointed metal tip
    mesh(pelvis, strapGeometry([0, yPe(1.13), 0.137], [0, yPe(0.93), 0.129], 0.028, 0.008, [1, 0, 0]), M.leather);
    mesh(pelvis, mergeGeometries([
      boxGeometry(0.034, 0.026, 0.012, 0, yPe(1.07), 0.144),
      kiteGeometry(0.016, 0.024, 0.007, { yPos: 0.4 }).translate(0, yPe(0.915), 0.131),
      boxGeometry(0.05, 0.04, 0.014, -0.11, yPe(1.0), 0.12, 0, -0.5, -0.5), // H1 buckle, right thigh
    ]), M.trim);
  }

  // ---------------------------------------------------------------- torso: one V-shell
  const spine = joint(pelvis, ...DIM.spine);
  // open coat (BODY.shell): hips 0.33 → waist 0.30 (1.21 m) → chest 0.43 → shoulders 0.46, the
  // front open from the collar (0.03 m) to the belt (0.19 m)
  const SHELL = BODY.shell;
  const shellAt = (h) => {
    let k = 0;
    while (k < SHELL.length - 2 && SHELL[k + 1].y < h) k++;
    const A = SHELL[k], B = SHELL[k + 1], u = Math.min(1, Math.max(0, (h - A.y) / (B.y - A.y)));
    return { rx: lerp(A.rx, B.rx, u), rz: lerp(A.rz, B.rz, u), cz: lerp(A.cz ?? 0, B.cz ?? 0, u), gap: lerp(A.gap, B.gap, u) };
  };
  /** z of the coat shell's front (s = 1) / back (s = −1) surface at height h, x across. */
  const shellZ = (h, x, s = 1) => {
    const R = shellAt(h);
    return s * Math.sqrt(Math.max(0, 1 - (x / R.rx) ** 2)) * R.rz + R.cz;
  };
  mesh(spine, shellGeometry(SHELL.map((r) => ({ ...r, y: ySp(r.y) })), { sub: 3, cols: 28 }), M.coat);
  // the black shirt in the open front (just inside the coat shell), buttons down the centre
  const SHIRT = [1.17, 1.3, 1.43, 1.5].map((h) => {
    const R = shellAt(h);
    return { h, rx: R.rx * 0.93, rz: R.rz - 0.008, cz: R.cz };
  });
  mesh(spine, shellGeometry(SHIRT.map((r) => ({ y: ySp(r.h), rx: r.rx, rz: r.rz, cz: r.cz })), { span: 1.0, cols: 8, sub: 2 }), M.shirt);
  // the main belt W1 (1.21 m) and W2 (1.15 m) radii: 0.012 m off the coat
  const W1 = [shellAt(1.21).rx + 0.012, shellAt(1.21).rz + 0.012], W2 = [shellAt(1.15).rx + 0.016, shellAt(1.15).rz + 0.015];
  {
    const bt = [];
    for (let i = 0; i < 7; i++) {
      const h = 1.255 + i * 0.03;
      // on the shirt's front (its rings are linear between SHIRT heights)
      let k = 0;
      while (k < SHIRT.length - 2 && SHIRT[k + 1].h < h) k++;
      const A = SHIRT[k], B = SHIRT[k + 1], u = Math.min(1, Math.max(0, (h - A.h) / (B.h - A.h)));
      bt.push(ellipsoidGeometry(0.007, 0.007, 0.004, { widthSegs: 5, heightSegs: 3 }).translate(0, ySp(h), lerp(A.rz + A.cz, B.rz + B.cz, u) + 0.006));
    }
    // belt hardware: W1 buckle (3 cm left of centre), W2 buckle (front-right), C1 buckle, rivets
    bt.push(boxGeometry(0.05, 0.04, 0.014, 0.03, ySp(1.21), W1[1] + 0.004));
    bt.push(boxGeometry(0.046, 0.036, 0.014, -0.045, ySp(1.152), W2[1] + 0.003, 0, 0, 0.14));
    bt.push(boxGeometry(0.036, 0.03, 0.012, -0.034, ySp(1.42), shellZ(1.42, -0.034) + 0.016, 0, 0, -0.75));
    for (const [x, h] of [[0.105, 1.21], [-0.095, 1.21], [0.138, 1.21], [-0.132, 1.21]]) {
      bt.push(ellipsoidGeometry(0.008, 0.008, 0.006, { widthSegs: 5, heightSegs: 3 }).translate(x, ySp(h), Math.sqrt(Math.max(0, 1 - (x / W1[0]) ** 2)) * W1[1] + 0.003));
    }
    mesh(spine, mergeGeometries(bt), M.trim);
  }
  // W1 main belt at the natural waist, W2 sloping 1.17 (left) → 1.13 (right): flat leather bands
  // 0.045 m wide standing 0.012 m off the coat — the bright band between the torso and the skirt
  mesh(spine, bandGeometry(W1[0], W1[1], 0.048, 32), M.leather, 0, ySp(1.21), 0.0);
  mesh(spine, bandGeometry(W2[0], W2[1], 0.04, 32), M.leather, 0, ySp(1.15), 0.0).rotation.z = 0.14;
  // C1: chest harness (0.035 m) from the right collarbone (1.47 m) across the shirt to the left ribs
  {
    const c1 = mesh(spine, bandGeometry(0.25, 0.145, 0.035, 32), M.leather, 0.04, ySp(1.375), 0.008);
    c1.rotation.z = -0.76;
  }
  // lapels: narrow facings folded out from the collar to ~1.37 m, grey-violet piping along their
  // outer edges and down both front edges of the open coat to the belts
  {
    const lp = [], pp = [];
    const lapel = (s, u, t, o) => {
      const h = lerp(1.485, 1.365, t);
      const w = lerp(0.034, 0.062, Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.6 + t * 0.4);
      const xi = s * lerp(0.024, 0.06, t);
      const x = xi + s * u * w;
      const R = shellAt(h);
      const z = Math.sqrt(Math.max(0, 1 - (x / R.rx) ** 2)) * R.rz + R.cz + 0.01 + 0.008 * u;
      o[0] = x;
      o[1] = ySp(h);
      o[2] = z;
      o[3] = x;
      o[4] = ySp(h);
    };
    for (const s of [1, -1]) {
      lp.push(gridGeometry(1, 3, (u, t, o) => lapel(s, u, t, o), s > 0));
      // piping on the lapel's outer edge
      pp.push(gridGeometry(1, 4, (u, t, o) => {
        lapel(s, 1, t, o);
        o[0] += s * (u - 0.5) * 0.008;
        o[2] += 0.003;
        o[3] = o[0];
      }, s > 0));
      // piping down the coat's front edge, from under the lapel to the belts
      pp.push(gridGeometry(1, 6, (u, t, o) => {
        const h = lerp(1.38, 1.13, t);
        const R = shellAt(h);
        const x = s * (R.gap + 0.004 + u * 0.008);
        o[0] = x;
        o[1] = ySp(h);
        o[2] = Math.sqrt(Math.max(0, 1 - (x / R.rx) ** 2)) * R.rz + R.cz + 0.004;
        o[3] = x;
        o[4] = o[1];
      }, s < 0));
    }
    // the back emblem: a dark grey-violet spearhead diamond between the shoulder blades
    lp.push(kiteGeometry(0.034, 0.056, 0.006, { yPos: 1.2 }).translate(0, ySp(1.385), shellZ(1.385, 0, -1) - 0.0065));
    mesh(spine, mergeGeometries(lp), M.facing);
    mesh(spine, mergeGeometries(pp), M.piping);
  }

  const chest = joint(spine, ...DIM.chest);
  // tall flared stand collar: black outside, blue-violet inside; the shirt's mandarin collar
  {
    const cg = collarGeometry();
    mesh(chest, cg, M.collar);
    mesh(chest, cg, M.collarIn);
    mesh(chest, bandGeometry(0.057, 0.054, 0.032, 16), M.shirt, 0, yCh(1.52), 0.01);
  }

  // ---------------------------------------------------------------- pauldron (RIGHT only)
  const pauldron = joint(chest, -DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
  {
    // P1 cap and P2 upper deltoid: thin stepped shells standing off the shoulder (black gaps
    // between them), each with a silver bevel along its lower rim so every step reads
    // P1: a shallow cap over the shoulder top; P2: a band wrapping the deltoid from front to back
    // (a flat stepped lame, not a puffed dome), flaring 0.03–0.045 m off the sleeve
    // the reference's pauldron is a big layered mass (≈ 0.3 m across, three claw-like blades towering
    // over the shoulder): P1 a wide shallow cap, P2 a broad band over the deltoid, both standing off
    // the sleeve so black gaps and ink lines show between the layers
    // (round 3: ×1.24 round the bigger deltoid, the claws ×1.12 long: it sits on the broad shoulder)
    const S = 1.24, SL = 1.12;
    const p1 = { r: [0.105 * S, 0.042 * S, 0.108 * S], el: -0.35, at: [-0.012 * S, 0.064 * S, 0], tilt: 0.34 };
    const pg = [
      place(domeShell(...p1.r, p1.el), ...p1.at, 0, 0, p1.tilt),
      sub(place(arcPlate(0.04 * S, -0.045 * S, 0.1 * S, 0.122 * S, -Math.PI / 2, 1.6, 12), -0.014 * S, 0, 0.004, 0, 0, 0.14), 1),
    ];
    const tg = [
      place(domeRim(...p1.r, p1.el, 0.012, 0.004), ...p1.at, 0, 0, p1.tilt),
      place(arcPlate(-0.031 * S, -0.046 * S, 0.1195 * S, 0.1235 * S, -Math.PI / 2, 1.6, 12), -0.014 * S, 0, 0.004, 0, 0, 0.14),
    ];
    // broad flattened claw blades (length ≈ 3–4× width, curving back): S1 inner by the collar, S2
    // the tallest tilted out, S3 and S4 outward-up (they make the top-down star), S5 the fang down
    // over the chest, S6 a short spur off the band's outer edge
    const blade = (L, w, base, dir, bend, curl = 0.17) => orientTo(clumpGeometry(L * SL, w * SL, 0.006, { curl, taper: 1, cols: 8, rows: 4 }), base.map((c) => c * S), dir, bend);
    const sg = [
      blade(0.11, 0.027, [0.03, 0.096, -0.022], [0.08, 1, -0.32], [0, 0, -1]), // S1 inner
      sub(blade(0.21, 0.038, [-0.018, 0.104, -0.024], [-0.55, 0.78, -0.3], [0, 0.25, -1], 0.22), 1), // S2 tallest
      blade(0.16, 0.034, [-0.07, 0.082, -0.014], [-0.85, 0.5, -0.18], [0, 0.45, -1], 0.22), // S3 outer
      sub(blade(0.12, 0.028, [-0.105, 0.04, 0.0], [-0.95, 0.15, 0.05], [0, 1, 0], 0.25), 1), // S4 out
      blade(0.12, 0.032, [-0.03, 0.004, 0.1], [0.32, -0.76, 0.5], [0, 0, -1], 0.08), // S5 the fang
      sub(blade(0.075, 0.02, [-0.12, -0.03, 0.02], [-0.8, -0.55, 0.1], [0, -1, 0], 0.2), 1), // S6 spur
    ];
    mesh(pauldron, mergeGeometries(pg), M.armor);
    mesh(pauldron, mergeGeometries(tg), M.bevel);
    mesh(pauldron, mergeGeometries(sg), M.spike);
  }

  // ---------------------------------------------------------------- head
  const head = joint(chest, ...DIM.neck);
  {
    const [sx, sy, sz] = DIM.skull;
    mesh(head, limb({ length: 0.12, r0: 0.043, r1: 0.04, radial: 8, rings: 2, capSegs: 1 }), M.skin, 0, 0.1, 0.0);
    mesh(head, orient.up(ellipsoidGeometry(0.078, 0.09, 0.1)), M.skin, sx, sy, sz);
    // slim V-jaw with a pointed chin (chin at ~1.57 m)
    const jaw = ellipsoidGeometry(0.05, 0.04, 0.056, { widthSegs: 10, heightSegs: 6 });
    const jp = jaw.attributes.position;
    for (let i = 0; i < jp.count; i++) {
      const z = jp.getZ(i), y = jp.getY(i);
      const k = 1 - 0.45 * Math.max(0, z / 0.056) * Math.max(0, -y / 0.04 + 0.3);
      jp.setX(i, jp.getX(i) * k);
    }
    jaw.computeVertexNormals();
    mesh(head, jaw, M.skin, sx, sy - 0.066, sz + 0.016);
    // the right ear shows below the swept-back locks
    mesh(head, ellipsoidGeometry(0.012, 0.024, 0.018, { widthSegs: 6, heightSegs: 4 }), M.skin, sx - 0.08, sy - 0.014, sz - 0.008);
    // the visible LEFT eye (the right one is under the fringe): a dark half-lidded almond, large
    // enough to print as a few dark letters with a violet rim between the fringe strands
    mesh(head, ellipsoidGeometry(0.016, 0.0075, 0.005, { widthSegs: 8, heightSegs: 4 }), M.eye, sx + 0.032, sy - 0.012, sz + 0.084);
    mesh(head, hairCap(), M.hair);
  }
  const hairGeo = hairGeometries();
  const hair = {};
  for (const c of HAIR_CLUSTERS) {
    const j = joint(head, ...c.pivot);
    mesh(j, hairGeo[c.name].mass, M.hair);
    mesh(j, hairGeo[c.name].tip, M.hairTip);
    hair[c.name] = j;
  }

  // ---------------------------------------------------------------- arms (asymmetric)
  // flattened wedge (pauldron / elbow / knee points): base 2w wide, curving toward `bend`
  const wedge = (L, w, base, dir, bend, curl = 0.17) => orientTo(clumpGeometry(L, w, 0.006, { curl, taper: 1, cols: 8, rows: 3 }), base, dir, bend);
  const arms = {};
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm;
  for (const side of [-1, 1]) {
    const R = side < 0;
    const out = side; // the outer side of this arm is x = side (right arm: −X)
    const upper = joint(chest, side * DIM.shoulder[0], DIM.shoulder[1], DIM.shoulder[2]);
    // sleeves: sub-id 1 against the torso shell's 0, so the arm is outlined where it meets the body
    // (round 2: fuller coat sleeves, the reference's arms are not thin tubes; round 3: thick upper
    // arms with a rounded deltoid cap, the broad shoulder line)
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0, r1: ua1, bulge: 0.004 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(out * 0.008, -0.02, 0), 1),
    ]), M.coat);
    const fore = joint(upper, 0, -DIM.upperArm, 0);
    mesh(fore, sub(limb({ length: 0.09, r0: ua1, r1: ua1 - 0.003 }), 1), M.coat);
    if (R) {
      // P3 / P4: lower pauldron lames riding on the arm itself, standing 0.03 m off the sleeve,
      // a silver bevel along each lower edge and a small down-back blade each
      const o = ua0 - 0.064; // round 3: everything on the sleeve stands this much further out
      mesh(upper, mergeGeometries([
        sub(arcPlate(-0.045, -0.125, 0.1 + o, 0.096 + o, -Math.PI / 2, 1.95), 0),
        sub(arcPlate(-0.11, -0.185, 0.094 + o, 0.088 + o, -Math.PI / 2, 1.85), 1),
      ]), M.armor);
      mesh(upper, mergeGeometries([
        arcPlate(-0.113, -0.126, 0.0975 + o, 0.0975 + o, -Math.PI / 2, 1.95),
        arcPlate(-0.173, -0.186, 0.0895 + o, 0.0895 + o, -Math.PI / 2, 1.85),
      ]), M.bevel);
      mesh(upper, mergeGeometries([
        wedge(0.09, 0.022, [-0.095 - o, -0.11, -0.03], [-0.6, -0.6, -0.5], [0, -1, 0], 0.15),
        wedge(0.075, 0.018, [-0.088 - o, -0.17, -0.03], [-0.6, -0.65, -0.45], [0, -1, 0], 0.15),
      ]), M.spike);
      // A1 strap just below the pauldron
      mesh(upper, bandGeometry(ua1 + 0.011, ua1 + 0.011, 0.02, 12), M.leather, 0, -0.19, 0);
      // plate vambrace: 3 overlapping lames with silver bevels, an elbow point and a wrist barb
      const v = fa0 - 0.06; // round 3: the thicker forearm
      mesh(fore, mergeGeometries([
        limb({ length: 0.085, r0: 0.06 + v, r1: 0.056 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.035, 0),
        sub(limb({ length: 0.08, r0: 0.057 + v, r1: 0.053 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.105, 0), 1),
        limb({ length: 0.075, r0: 0.054 + v, r1: 0.05 + v, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.17, 0),
        // the articulated gauntlet over the grip
        sub(ellipsoidGeometry(0.05, 0.048, 0.066, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm - 0.008, 0.006), 1),
      ]), M.armor);
      mesh(fore, mergeGeometries([
        bandGeometry(0.0605 + v, 0.0605 + v, 0.01, 14).translate(0, -0.113, 0),
        bandGeometry(0.0575 + v, 0.0575 + v, 0.01, 14).translate(0, -0.178, 0),
      ]), M.bevel);
      mesh(fore, mergeGeometries([
        bandGeometry(0.054 + v, 0.054 + v, 0.016, 14).translate(0, -0.247, 0), // the gauntlet cuff ring
        ellipsoidGeometry(0.035, 0.014, 0.046, { widthSegs: 8, heightSegs: 3 }).translate(0, -DIM.foreArm + 0.02, 0.042),
      ]), M.trim);
      mesh(fore, mergeGeometries([
        wedge(0.07, 0.022, [out * (0.045 + v), -0.04, -0.025], [out * 0.35, 1, -0.55], [0, 0, -1], 0.12), // elbow point
        wedge(0.05, 0.015, [out * (0.05 + v), -0.21, 0], [out, 0.25, 0], [0, 1, 0], 0.1), // wrist barb
      ]), M.spike);
    } else {
      // left: plain coat shoulder, A2 strap above the elbow, a leather bracer with two silver
      // bands, a silver cuff ring, a fingerless glove with skin fingertips
      mesh(upper, bandGeometry(ua1 + 0.011, ua1 + 0.011, 0.02, 12), M.leather, 0, -0.19, 0);
      mesh(fore, limb({ length: 0.18, r0: fa0, r1: fa1, radial: 10, rings: 3 }), M.leather, 0, -0.05, 0);
      mesh(fore, mergeGeometries([
        bandGeometry(fa0 - 0.0035, fa0 - 0.0035, 0.012, 14).translate(0, -0.1, 0),
        bandGeometry(fa1 + 0.0035, fa1 + 0.0035, 0.012, 14).translate(0, -0.17, 0),
      ]), M.bevel);
      mesh(fore, bandGeometry(fa1 + 0.002, fa1 + 0.002, 0.025, 14).translate(0, -0.236, 0), M.trim);
      mesh(fore, wedge(0.05, 0.018, [out * (fa0 - 0.015), -0.05, -0.02], [out * 0.3, 1, -0.5], [0, 0, -1], 0.12), M.spike);
      mesh(fore, ellipsoidGeometry(0.047, 0.045, 0.062, { widthSegs: 10, heightSegs: 6 }), M.pants, 0, -DIM.foreArm - 0.006, 0.004);
      mesh(fore, ellipsoidGeometry(0.035, 0.016, 0.023, { widthSegs: 8, heightSegs: 4 }), M.skin, 0, -DIM.foreArm - 0.05, 0.026);
    }
    arms[R ? 'R' : 'L'] = { upper, fore };
  }
  // the sword hand's targets stay offsets from the round-2 shoulder (DIM.gripShoulder)
  arms.R.anchor = new THREE.Vector3(-DIM.gripShoulder[0], DIM.gripShoulder[1], DIM.gripShoulder[2]);
  // flask, shown only while healing
  const flask = mesh(arms.L.fore, orient.up(ellipsoidGeometry(0.036, 0.036, 0.055, { widthSegs: 10, heightSegs: 6 })), M.flask, 0, -DIM.foreArm - 0.03, 0.068);
  flask.visible = false;

  // sleeve streamers: torn strips on springs, from the back of the right upper arm under P4 (0.54
  // m) and the back of the left elbow (0.35 m); black at the root, lavender-grey toward the end
  const streamers = [];
  {
    const defs = [
      { arm: arms.R.upper, at: [-0.014, -0.12, -(ua0 - 0.004)], w: 0.08, len: [0.26, 0.28], seed: 501 },
      { arm: arms.L.fore, at: [0.004, -0.012, -(ua1 - 0.002)], w: 0.072, len: [0.17, 0.18], seed: 507 },
    ];
    for (const d of defs) {
      const s0 = joint(d.arm, ...d.at);
      mesh(s0, tatterStrip(d.len[0] + 0.02, d.w, { tip: false, curl: 0.05, seed: d.seed }), M.hem);
      const s1 = joint(s0, 0, -d.len[0], 0);
      mesh(s1, tatterStrip(d.len[1], d.w * 0.95, { fork: d.seed === 507, curl: 0.15, seed: d.seed + 1 }), M.hem);
      streamers.push({ segs: [s0, s1], len: d.len });
    }
  }

  // ---------------------------------------------------------------- legs
  const legs = {};
  const [th0, th1, thB] = BODY.thigh, [sh0, sh1, shB] = BODY.shin;
  /** limb radius t (0 → 1) along a bulging taper */
  const rAt = (r0, r1, bulge, t) => lerp(r0, r1, t) + bulge * Math.sin(Math.PI * t);
  for (const side of [-1, 1]) {
    const thigh = joint(pelvis, side * DIM.hip[0], DIM.hip[1], DIM.hip[2]);
    mesh(thigh, limb({ length: DIM.thigh, r0: th0, r1: th1, bulge: thB }), M.pants);
    // knee-guard straps
    const ks = (y) => rAt(th0, th1, thB, (-y) / DIM.thigh) + 0.004;
    mesh(thigh, mergeGeometries([
      bandGeometry(ks(-DIM.thigh + 0.085), ks(-DIM.thigh + 0.085), 0.015, 12).translate(0, -DIM.thigh + 0.085, 0),
      bandGeometry(ks(-DIM.thigh + 0.035), ks(-DIM.thigh + 0.035), 0.015, 12).translate(0, -DIM.thigh + 0.035, 0),
    ]), M.leather);
    if (side < 0) {
      // D2: the sword hanger down the right thigh to 0.85 m, with a ring
      mesh(thigh, strapGeometry([-(th0 - 0.006), 0.04, 0.04], [-(th0 - 0.002), -0.06, 0.03], 0.022, 0.008, [0, 0, 1]), M.leather);
      mesh(thigh, ring(0.016, 0.016, 0.005, 8).rotateX(Math.PI / 2).translate(-(th0 - 0.002), -0.065, 0.025), M.trim);
    }
    const shin = joint(thigh, 0, -DIM.thigh, 0);
    // knee-high armoured boot: the shell, a cuff lame under the knee and one at the ankle, and the
    // reference's KITE GREAVE down the shin: a faceted diamond plate pointed at the knee and the
    // ankle with a raised centre ridge, silver bevels on its edges and the ridge (stacked ring lames
    // read as a stack of tyres). Round 3: a heavier boot round a real calf (BODY.shin)
    mesh(shin, limb({ length: DIM.shin - 0.02, r0: sh0, r1: sh1, bulge: shB }), M.armor, 0, -0.02, 0);
    const b = sh0 - 0.058; // how much further out the boot's plates stand (round 3)
    mesh(shin, mergeGeometries([
      sub(arcPlate(-0.045, -0.09, 0.067 + b, 0.065 + b, 0, 1.4, 6), 1),
      sub(arcPlate(-0.33, -0.375, 0.054 + b * 0.9, 0.052 + b * 0.9, 0, 1.5, 6), 1),
    ]), M.armor);
    {
      const T = [0, -0.06, 0.069 + b], Rt = [0.058 + b, -0.16, 0.058 + b], B = [0, -0.355, 0.051 + b * 0.9], Lf = [-0.058 - b, -0.16, 0.058 + b], C = [0, -0.16, 0.08 + b * 1.3];
      const kg = new THREE.BufferGeometry();
      kg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...T, ...C, ...Rt, ...T, ...Lf, ...C, ...C, ...Lf, ...B, ...C, ...B, ...Rt]), 3));
      kg.computeVertexNormals();
      planarGUV(kg, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      mesh(shin, kg, M.armor);
      const e = (a, b) => strapGeometry([a[0], a[1], a[2] + 0.003], [b[0], b[1], b[2] + 0.003], 0.009, 0.004, [-(b[1] - a[1]), b[0] - a[0], 0]);
      mesh(shin, mergeGeometries([
        e(T, Rt), e(Rt, B), e(B, Lf), e(Lf, T), e(T, C), e(C, B),
        arcPlate(-0.083, -0.092, 0.0675 + b, 0.0675 + b, 0, 1.4, 6),
        arcPlate(-0.366, -0.375, 0.0535 + b * 0.9, 0.0535 + b * 0.9, 0, 1.5, 6),
      ]), M.bevel);
    }
    // kite knee guard (poleyn): 0.12 W × 0.14 H standing 0.02 m off the knee, a ridge down the
    // middle, silver bevels on all four edges, wings wrapping the sides; its point leans 15° out
    // and a short spike carries it to 0.60 m
    {
      const lean = -side * 0.26;
      const T = [0, 0.085, 0.082 + b], Rt = [0.06, 0.004, 0.072 + b], B = [0, -0.05, 0.08 + b], Lf = [-0.06, 0.004, 0.072 + b], C = [0, 0.012, 0.094 + b];
      const kp = new THREE.BufferGeometry();
      kp.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...T, ...C, ...Rt, ...T, ...Lf, ...C, ...C, ...Lf, ...B, ...C, ...B, ...Rt]), 3));
      kp.computeVertexNormals();
      planarGUV(kp, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      const wings = [];
      for (const s of [-1, 1]) wings.push(place(kiteGeometry(0.014, 0.034, 0.034), s * (0.06 + b), -0.006, 0.03 + b * 0.5, 0, s * 0.6, 0));
      mesh(shin, mergeGeometries([kp, ...wings]).rotateZ(lean), M.armor);
      const edge = (a, c) => strapGeometry([a[0], a[1], a[2] + 0.003], [c[0], c[1], c[2] + 0.003], 0.01, 0.004, [-(c[1] - a[1]), c[0] - a[0], 0]);
      mesh(shin, mergeGeometries([edge(T, Rt), edge(Rt, B), edge(B, Lf), edge(Lf, T), edge(T, C), edge(C, B)]).rotateZ(lean), M.bevel);
      mesh(shin, wedge(0.038, 0.013, [0, 0.075, 0.083 + b], [0, 1, 0.12], [0, 0, 1], 0.05).rotateZ(lean), M.spike);
    }
    const foot = joint(shin, 0, -DIM.shin, 0);
    // boot foot, 2 instep lames, a rounded slightly pointed toe, heel, the silver sole welt (round
    // 3: a bigger boot under the heavier leg; the sole still rests on the ground at −0.07)
    const F = BODY.foot;
    mesh(foot, mergeGeometries([
      ellipsoidGeometry(...F.r, { widthSegs: 10, heightSegs: 6 }).translate(...F.c),
      sub(place(ellipsoidGeometry(0.053, 0.026, 0.045, { widthSegs: 8, heightSegs: 4 }), 0, F.c[1] + F.r[1] - 0.016, 0.068, -0.35), 1),
      place(ellipsoidGeometry(0.048, 0.023, 0.04, { widthSegs: 8, heightSegs: 4 }), 0, F.c[1] + F.r[1] - 0.032, 0.118, -0.25),
      sub(boxGeometry(0.07, 0.034, 0.056, 0, -0.053, -0.066), 1),
    ]), M.armor);
    mesh(foot, ellipsoidGeometry(F.r[0] + 0.006, 0.007, F.r[2] + 0.007, { widthSegs: 14, heightSegs: 3 }), M.welt, 0, -0.062, F.c[2]);
    legs[side < 0 ? 'R' : 'L'] = { thigh, shin, foot };
  }

  // ---------------------------------------------------------------- coat skirt
  // 6 panels (+ the front flap) × (upper + lower solid segment, each a lagging spring) → torn
  // strips, each on its own spring (anim.js); indigo lining on the inside of the flare. The panel
  // tops tuck under the belt stack, just inside the coat shell (no hard rim at the waist).
  const coat = [];
  COAT_PANELS.forEach((P, i) => {
    const sa = Math.sin(P.az), ca = Math.cos(P.az);
    const R0 = P.r ?? 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + P.out * 0.5;
    const ay = P.flap ? DIM.coatY + P.y : DIM.coatY;
    const anchor = joint(pelvis, sa * R0, ay, ca * R0);
    anchor.rotation.y = P.az; // local +Z = outward, +X = tangent
    const s0 = joint(anchor);
    // neighbouring panels alternate ink-line sub-ids: their overlapping edges are outlined. Soft
    // folds deepen down each panel (the same phase across the join, so the two segments meet)
    const fph = i * 2.1 + 0.7, fw = P.flap ? 0 : P.folds ?? 1.5;
    const g0 = sub(skirtSheet(P.len[0], P.w[0], P.w[1], R0, 0.25, 0, 11 + i, [0, 0.014, fw, fph]), i % 2);
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -P.len[0], 0);
    const R1 = R0 + 0.25 * P.len[0];
    let g1;
    if (P.flap) {
      // pointed tip, violet lower part (hem ink)
      g1 = tatterStrip(P.len[1], P.w[1], { curl: 0.05, seed: 900 });
      mesh(s1, g1, M.hem);
    } else {
      // the lower segment lightens into the dusty lavender torn zone over its last 55 % (the
      // reference's tails: black at the hips, grey-lavender toward the ragged hem)
      const fold = [0.014, 0.034, fw, fph];
      g1 = sub(skirtSheet(P.len[1], P.w[1], P.w[2], R1, 0.25, 0.03, 31 + i, fold, 0, 0.45), i % 2);
      mesh(s1, g1, M.coat);
      mesh(s1, g1, M.lining);
      const g2 = sub(skirtSheet(P.len[1], P.w[1], P.w[2], R1, 0.25, 0.03, 31 + i, fold, 0.45, 1), i % 2);
      mesh(s1, g2, M.hem);
      mesh(s1, g2, M.lining);
    }
    // torn strips along the tear line (0.06–0.12 m wide at the root, overlapping a little)
    const strips = [];
    const n = P.strips.length;
    const R2 = R1 + 0.25 * P.len[1];
    const wr = P.w[2] / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.5) / n - 0.5) * P.w[2];
      const a = u / R2;
      const sj = joint(s1, Math.sin(a) * R2, -P.len[1], (Math.cos(a) - 1) * R2);
      sj.rotation.y = a;
      mesh(sj, sub(tatterStrip(P.strips[k], Math.max(0.065, wr * 1.3), { fork: !!P.fork[k], curl: 0.4, seed: 1000 + i * 31 + k * 7 }), (i + k) % 2), M.hem);
      strips.push({ joint: sj, len: P.strips[k], rest: a, phase: (i * 1.7 + k * 2.3) % (Math.PI * 2) });
    }
    // r0 = the sheet's radius round the hips at the anchor (the lower segment's is r0 + 0.25 × len[0])
    coat.push({ anchor, segs: [s0, s1], def: P, strips, len: [P.len[0], P.len[1] + (n ? Math.max(...P.strips) * 0.8 : 0)], r0: R0 });
  });

  // ---------------------------------------------------------------- the longsword
  // origin at the grip centre, blade along +Z (width on X, flat faces ±Y). The forte under the gem
  // cage (to DIM.forte) is dark gunmetal, so the violet gem sits on dark metal between silver
  // rails; the glyph blade starts above it, and its last 0.15 m (the point) is the brightest steel.
  const sword = joint(body);
  {
    const tipZ = DIM.drawnTip;
    const z0 = 0.125, L = tipZ - z0, hw0 = 0.0475, hw1 = 0.04, tipF = 0.14;
    const hwAt = (z) => hw0 + (hw1 - hw0) * Math.min(1, (z - z0) / (L * (1 - tipF)));
    const zT = tipZ - L * tipF; // where the point's taper starts
    for (const h of [-1, 1]) {
      const k = h > 0 ? 1 : 0;
      mesh(sword, sub(bladeGeometry(DIM.forte - z0 + 0.004, hw0, hwAt(DIM.forte), 0, 0.012, 0.045, h), k), M.armor, 0, 0, z0);
      mesh(sword, sub(bladeGeometry(zT - DIM.forte + 0.002, hwAt(DIM.forte), hw1, 0, 0.012, 0.045, h), k), M.blade, 0, 0, DIM.forte);
      mesh(sword, sub(bladeGeometry(tipZ - zT, hw1, hw1, 0.999, 0.012, 0.045, h), k), M.bladeTip, 0, 0, zT);
    }
    // the reference's jagged edge: flat saw teeth along both edges, raking toward the point and
    // growing toward it, the biggest (lightning-like notches) on the last third (the art pass
    // outlines them in the blade's cyan)
    const teeth = [];
    for (const s of [-1, 1]) {
      for (let t = 0; t < 6; t++) {
        const z = 0.52 + t * 0.15 + (s > 0 ? 0.075 : 0);
        if (z > zT - 0.02) continue;
        const k = t / 5;
        teeth.push(spike(0.026 + 0.03 * k * k, 0.013 + 0.004 * k, [s * (hwAt(z) - 0.006), 0, z], [s * 0.74, 0, 0.67], [0, 0, 1], 0.25, 4, 0.3));
      }
    }
    mesh(sword, mergeGeometries(teeth), M.blade);
  }
  mesh(sword, limbGeometry({ length: 0.16, r0: 0.016, r1: 0.017, radial: 6, rings: 3 }), M.leather, 0, 0, -DIM.gripBack); // grip
  {
    // gunmetal: guard block, upswept quillons (tips hooked back toward the pommel), the gem cage
    // rails with outward barbs (a scalloped outline), the kite pommel
    const gg = [
      ellipsoidGeometry(0.04, 0.022, 0.024, { widthSegs: 10, heightSegs: 6 }).translate(0, 0, DIM.guard + 0.005),
      kiteGeometry(0.022, 0.014, 0.05, { zNeg: 1.5 }).translate(0, 0, -0.135),
    ];
    for (const s of [-1, 1]) {
      gg.push(spike(0.115, 0.017, [s * 0.03, 0, DIM.guard + 0.006], [s, 0, -0.18], [0, 0, -1], 0.4, 5, 0.6));
      gg.push(spike(0.03, 0.007, [s * 0.128, 0, DIM.guard - 0.03], [-s * 0.6, 0, 0.8], [0, 0, 1], 0, 4)); // inner hook
      for (let b = 0; b < 3; b++) gg.push(spike(0.022 - b * 0.003, 0.006, [s * (0.056 - b * 0.004), 0, 0.16 + b * 0.065], [s, 0, 0.55], [0, 0, 1], 0.2, 4));
      // the reference's spiky guard: a claw on each side sweeping out toward the blade
      gg.push(spike(0.085, 0.012, [s * 0.045, 0, DIM.guard + 0.03], [s * 0.6, 0, 0.8], [s, 0, 0], 0.35, 5, 0.55));
    }
    mesh(sword, mergeGeometries(gg), M.armor);
    // silver: ferrules, the pommel collar, the cage rails, the diamond frame holding the gem
    const sv = [
      ring(0.02, 0.02, 0.008, 8).rotateX(Math.PI / 2).translate(0, 0, DIM.guard - 0.012),
      ring(0.02, 0.02, 0.008, 8).rotateX(Math.PI / 2).translate(0, 0, -DIM.gripBack),
      ring(0.019, 0.019, 0.007, 8).rotateX(Math.PI / 2).translate(0, 0, -0.095),
      kiteGeometry(0.038, 0.016, 0.062, { guv: 'xz' }).translate(0, 0, DIM.gem),
    ];
    for (const s of [-1, 1]) sv.push(place(limbGeometry({ length: 0.2, r0: 0.008, r1: 0.005, radial: 5, rings: 2, capSegs: 1 }), s * 0.054, 0, DIM.guard + 0.01, 0, s * -0.045, 0));
    mesh(sword, mergeGeometries(sv), M.trim);
  }
  // the gem: two half-gems proud of both flats by 0.018 m (0.07 m long so it stays a cell) on the
  // dark forte; a marker joint for its glow sprite and glints
  mesh(sword, mergeGeometries([
    kiteGeometry(0.024, 0.014, 0.038, { guv: 'xz' }).translate(0, 0.016, 0),
    kiteGeometry(0.024, 0.014, 0.038, { guv: 'xz' }).translate(0, -0.016, 0),
  ]), M.gem, 0, 0, DIM.gem);
  const gem = joint(sword, 0, 0, DIM.gem);
  // fewer draw calls: static meshes sharing a joint and a material become one mesh
  mergeStatic(root, new Set([flask]));

  const mats = Object.values(M);
  return {
    root, body, pelvis, spine, chest, head, hair, arms, legs, coat, streamers, sword, gem, pauldron, flask,
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
