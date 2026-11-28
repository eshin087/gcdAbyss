import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { range, fbm2, hash2 } from '../core/rng.js';
import { TAU } from '../core/math.js';
import { prep, carve, mul, lumpy, buildRubble } from './forest.js';
import { facetCol } from './landmarks.js';
import { hangFrom, mergeHang } from './hang.js';

// THE LAST FOUNDRY's builders (world/lastFoundry.js places them; ADR-285). Every builder works in the
// prop's own frame (its base on the origin, facing +z), carves its parts for the prop art path (the house
// style: a dark body, brighter facets where the light catches, an edge band on the chamfers) and places
// them in WORLD space last. Non-indexed triangles only (`prep`): the breakables cut them to brick size
// at build (ARCHITECTURE "Making a new object destructible"). No Math.random: every builder takes the
// set's own stream `rng`.

// ---------------------------------------------------------------- palette (linear albedo)
export const FD_COL = Object.freeze({
  steel: [0.11, 0.112, 0.12],
  dark: [0.055, 0.056, 0.062],
  rust: [0.17, 0.095, 0.05],
  brick: [0.15, 0.07, 0.045],
  refractory: [0.2, 0.15, 0.11],
  concrete: [0.15, 0.145, 0.14],
  paint: [0.32, 0.22, 0.05], // the cranes' warning yellow, worn
  tank: [0.22, 0.05, 0.035], // the gas bottles' red
  band: [0.36, 0.34, 0.3],
  titanium: [0.24, 0.24, 0.255], // the unfinished frames: matte titanium, smoked ceramic, the dark weave
  ceramic: [0.13, 0.132, 0.142],
  weave: [0.045, 0.045, 0.05],
  crust: [0.2, 0.07, 0.02], // the skin on molten steel (the heat over it is the fire field's)
  ingot: [0.17, 0.125, 0.1],
  slag: [0.09, 0.075, 0.07],
  burnt: [0.04, 0.036, 0.034],
});
const C = FD_COL;

const edgeBand = (px, py, pz, nx, ny) => (ny > 0.5 && ny < 0.95 ? 1 : 0);

// ---------------------------------------------------------------- primitives (local frame)
/** A box w x h x d standing on (x, y0, z) of the local frame. */
export function bx(w, h, d, x = 0, y0 = 0, z = 0, yaw = 0) {
  const g = prep(new THREE.BoxGeometry(w, h, d));
  g.translate(0, h / 2, 0);
  if (yaw) g.rotateY(yaw);
  g.translate(x, y0, z);
  return g;
}
/** A cylinder r0 (bottom) → r1 (top), h tall, standing on (x, y0, z). */
export function cy(r0, r1, h, x = 0, y0 = 0, z = 0, sides = 8) {
  const g = prep(new THREE.CylinderGeometry(r1, r0, h, sides, 1));
  g.translate(x, y0 + h / 2, z);
  return g;
}
/** A rod (cylinder) from a to b ([x, y, z]), radius r. */
export function rod(a, b, r, sides = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb) || 0.01;
  const g = prep(new THREE.CylinderGeometry(r, r, len, sides, 1));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}
/** A lying I-beam along local z, length L, depth dh, on its flange at y0. */
function ibeamLying(L, dh = 0.36, fw = 0.32, x = 0, y0 = 0, z = 0) {
  return [bx(fw, 0.045, L, x, y0, z), bx(0.045, dh - 0.09, L, x, y0 + 0.045, z), bx(fw, 0.045, L, x, y0 + dh - 0.045, z)];
}
/** A standing I-beam (a column), its flanges across local x. */
function ibeamStanding(h, w = 0.44, d = 0.4, x = 0, z = 0, y0 = 0) {
  return [bx(w, h, 0.05, x, y0, z + d / 2 - 0.025), bx(w, h, 0.05, x, y0, z - d / 2 + 0.025), bx(0.05, h, d - 0.1, x, y0, z)];
}

/**
 * Carve parts [[geo, col, k?]] for prop art: the facet shading, an ambient occlusion that darkens toward
 * the floor (over `H` m), the moonlit chamfer band. Returns the geos (still in the local frame).
 */
function ink(parts, H = 3, ao0 = 0.55) {
  for (const [g, col, k = 1] of parts) {
    carve(g, {
      col: typeof col === 'function' ? col : facetCol(col, k),
      ao: (px, py) => ao0 + (1 - ao0) * Math.min(1, Math.max(0, py) / H),
      edge: edgeBand,
    });
  }
  return parts.map((p) => p[0]);
}

/** Turn local geos by `yaw` and move them to (x, z) (world space). */
export function place(geos, x, z, yaw = 0) {
  for (const g of geos) {
    if (yaw) g.rotateY(yaw);
    g.translate(x, 0, z);
  }
  return geos;
}

/** A worn colour: the base x a slow blotch (world position), for big flat faces. */
const worn = (col, f = 0.9, seed = 0) => (px, py, pz, nx, ny, nz) => {
  const k = (0.72 + 0.32 * fbm2(px * f + seed, pz * f + py * 0.7 - seed, 2)) * (0.8 + 0.2 * (Math.abs(nx) * 0.9 + ny * 1.1 + Math.abs(nz) * 0.75));
  return mul(col, k);
};

// ---------------------------------------------------------------- the floor's pieces
/** A riveted plate of the casting floor (or a grating): its tone. Returned as a carve `col`. */
export function plateTone(base, i, j, kind) {
  const h = hash2(i * 1.7 + 3, j * 2.3 - 1);
  const k = kind === 'grate' ? 0.62 : 0.82 + 0.3 * h;
  const warm = kind === 'hot' ? [1.35, 0.95, 0.75] : [1, 1, 1];
  return (px, py, pz) => {
    const n = 0.72 + 0.32 * fbm2(px * 1.3 + i, pz * 1.3 - j, 2);
    return [base[0] * k * n * warm[0], base[1] * k * n * warm[1], base[2] * k * n * warm[2]];
  };
}

// ---------------------------------------------------------------- columns, cranes, ladles
/** An I-beam column of the hall, h tall, a base plate, haunch brackets near its top. */
export function buildColumn(rng, x, z, h, yaw = 0) {
  const parts = ibeamStanding(h).map((g) => [g, C.steel, 1.05]);
  parts.push([bx(0.8, 0.06, 0.8), C.dark], [bx(0.9, 0.18, 0.7, 0, 0.06, 0), C.concrete, 0.9]);
  // a few rivet bands where the column was spliced, a scorched lower third
  for (const y of [range(rng, 2.6, 3.2), range(rng, 5.2, 6)]) parts.push([bx(0.5, 0.12, 0.46, 0, y, 0), C.dark]);
  return place(ink(parts, h, 0.5), x, z, yaw);
}
/** What stands on a column: its head plate and a run of the crane's runway girder along local z. */
export function buildGantryHead(rng, x, z, y0, len, yaw = 0) {
  const parts = [[bx(0.62, 0.1, 0.62, 0, y0, 0), C.dark]];
  for (const g of ibeamLying(len, 0.62, 0.42, 0, y0 + 0.1, 0)) parts.push([g, C.rust, 1.1]);
  // the rail on top, a broken end hanging down a little (the runway was hit before)
  parts.push([bx(0.1, 0.08, len * 0.96, 0, y0 + 0.72, 0), C.steel, 1.3]);
  parts.push([bx(0.3, 0.5, 0.06, 0, y0 - 0.35, len / 2 - 0.2), C.dark]);
  return place(ink(parts, y0 + 1, 0.8), x, z, yaw);
}
/** A jib crane's post (an I-beam on a footing). */
export function buildJibPost(rng, x, z, h) {
  const parts = ibeamStanding(h, 0.36, 0.34).map((g) => [g, C.paint, 0.8]);
  parts.push([bx(0.9, 0.22, 0.9), C.concrete, 0.9], [bx(0.5, 0.2, 0.5, 0, h - 0.2, 0), C.dark]);
  // the hazard bands at hip height
  for (const y of [0.9, 1.3]) parts.push([bx(0.4, 0.14, 0.38, 0, y, 0), C.dark]);
  return place(ink(parts, h, 0.5), x, z);
}
/**
 * A jib's arm: from its post at local x 0 out along +x by `reach` m at height y0, a brace back to the
 * post, the trolley and its hook block at the tip (the ladle's chain hangs from it). Turned by `yaw`.
 */
export function buildJib(rng, x, z, y0, reach, yaw = 0) {
  const parts = [];
  for (const g of ibeamLying(reach + 0.3, 0.42, 0.32, 0, y0, 0)) {
    g.rotateY(Math.PI / 2);
    g.translate(reach / 2 - 0.15, 0, 0);
    parts.push([g, C.paint, 0.85]);
  }
  parts.push([rod([0.1, y0 - 1.3, 0], [reach * 0.55, y0 + 0.02, 0], 0.07), C.paint, 0.75]);
  parts.push([bx(0.5, 0.26, 0.5, reach - 0.05, y0 - 0.27, 0), C.dark], [bx(0.18, 0.2, 0.14, reach - 0.05, y0 - 0.48, 0), C.steel, 1.2]);
  return place(ink(parts, y0 + 1, 0.85), x, z, yaw);
}
/** A chain from y0 up to y1 at (x, z): links every 0.21 m, turned a quarter each. Returns geos. */
function chain(y0, y1, x = 0, z = 0) {
  const out = [];
  for (let y = y0, i = 0; y < y1 - 0.12; y += 0.21, i++) out.push(bx(0.075, 0.2, 0.026, x, y, z, i % 2 ? Math.PI / 2 : 0));
  return out;
}
/**
 * A ladle: a crucible of molten steel hung on a bail and a chain from a hook block at `top` (m), its
 * body at `h` m (the crucible's middle), its spout toward `spoutYaw`. Every part HANGS (world/hang.js
 * 'rope': it swings as one on its line, on the level's wind). Returns { geos, stub }: the stub is the
 * chain left hanging from the trolley once it is cut.
 */
export function buildLadle(rng, x, z, h, top, spoutYaw = 0) {
  const y0 = h - 0.55, y1 = h + 0.45; // the crucible's foot and rim
  const shell = (px, py, pz, nx, ny, nz) => {
    // the molten skin on its top (the heat over it is the set's ambience), refractory bands, the shell
    if (ny > 0.9 && py > y1 && Math.hypot(px, pz) < 0.6) return mul(C.crust, 1.2);
    const band = Math.abs(py - (y0 + 0.28)) < 0.06 || Math.abs(py - (y1 - 0.25)) < 0.06;
    return mul(band ? C.dark : C.rust, (band ? 1 : 0.85 + 0.25 * fbm2(px * 3, py * 3 + pz * 2, 2)) * (0.8 + 0.25 * (Math.abs(nx) + ny * 0.8 + Math.abs(nz) * 0.7)));
  };
  const parts = [
    [cy(0.48, 0.64, y1 - y0, 0, y0, 0, 10), shell],
    [cy(0.7, 0.7, 0.1, 0, y1 - 0.02, 0, 10), shell],
    [cy(0.36, 0.44, 0.12, 0, y0 - 0.1, 0, 8), C.dark],
  ];
  // the spout, the trunnions, the bail (two straps and a crossbar), the hook block, the chain
  const sp = bx(0.24, 0.12, 0.34, 0, y1 - 0.06, 0.74);
  sp.rotateY(spoutYaw);
  parts.push([sp, C.rust, 0.9]);
  for (const s of [-1, 1]) {
    parts.push([bx(0.14, 0.14, 0.14, s * 0.74, h - 0.07, 0), C.dark]);
    parts.push([bx(0.07, 1.25, 0.11, s * 0.78, h - 0.05, 0), C.steel, 1.15]);
  }
  parts.push([bx(1.66, 0.1, 0.12, 0, h + 1.2, 0), C.steel, 1.15], [bx(0.24, 0.3, 0.16, 0, h + 1.3, 0), C.dark]);
  for (const g of chain(h + 1.58, top)) parts.push([g, C.steel, 1.3]);
  const geos = ink(parts, 3, 0.7);
  const merged = mergeGeometries(geos);
  hangFrom(merged, top, 'rope');
  // the stub: the chain's top end, cut (it still hangs)
  const sParts = chain(top - range(rng, 0.7, 1.1), top).map((g) => [g, C.steel, 1.3]);
  const sg = mergeGeometries(ink(sParts, 3, 0.8));
  hangFrom(sg, top, 'rope');
  return { geos: place([merged], x, z), stub: place([sg], x, z) };
}

// ---------------------------------------------------------------- the press
/**
 * The forging press: the bed and the lower die, four columns (the base piece) and the crown with its
 * cylinder and the ram (the head, standing on the base from `headY`). A glowing billet lies on the die
 * (its heat: the ambience). Returns { base, head, ruin }.
 */
export function buildPress(rng, x, z, { headY = 3.4, yaw = 0 } = {}) {
  const base = [], head = [];
  base.push([bx(4.6, 0.9, 3.6), worn(C.concrete, 0.6, 3)], [bx(3.6, 0.55, 2.6, 0, 0.9, 0), C.dark], [bx(2.2, 0.35, 1.6, 0, 1.45, 0), C.steel, 1.2]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.push([cy(0.24, 0.24, 7.6 - 0.9, sx * 1.55, 0.9, sz * 1.0, 8), C.steel, 1.25]);
  // the crown, its cylinder, the ram and the upper die
  head.push([bx(4.2, 1.3, 3.0, 0, 6.3, 0), C.rust, 1.05], [cy(0.75, 0.75, 1.7, 0, 7.6, 0, 12), C.dark], [bx(1.0, 0.25, 1.0, 0, 9.3, 0), C.steel]);
  head.push([bx(2.8, 0.5, 2.0, 0, headY + 1.2, 0), C.steel, 1.1], [cy(0.42, 0.42, 6.3 - (headY + 1.7), 0, headY + 1.7, 0, 10), C.steel, 1.3], [bx(2.0, 1.0, 1.4, 0, headY + 0.2, 0), C.dark]);
  // a hose looping off the crown
  head.push([rod([1.9, 7.2, 0.8], [2.5, 5.4, 1.2], 0.09), C.dark], [rod([2.5, 5.4, 1.2], [2.3, 1.2, 1.4], 0.09), C.dark]);
  const ruin = [[bx(4.4, 0.9, 3.4), mul(C.concrete, 0.6)], [bx(3.4, 0.4, 2.4, 0, 0.9, 0), mul(C.dark, 0.8)]];
  for (const sx of [-1, 1]) ruin.push([cy(0.24, 0.24, range(rng, 0.8, 2.2), sx * 1.55, 0.9, -1.0, 10), C.steel]);
  return { base: place(ink(base, 8, 0.5), x, z, yaw), head: place(ink(head, 10, 0.75), x, z, yaw), ruin: place(ink(ruin, 2), x, z, yaw) };
}

// ---------------------------------------------------------------- the line and its frames
/** A run of the conveyor along local z, `len` long: the bed, the rollers, the legs, the hanger posts. */
export function buildConveyor(rng, x, z, len, posts = []) {
  const parts = [[bx(1.5, 0.1, len - 0.1, 0, 0.72, 0), C.dark], [bx(0.1, 0.22, len, -0.78, 0.62, 0), C.steel, 1.2], [bx(0.1, 0.22, len, 0.78, 0.62, 0), C.steel, 1.2]];
  for (let k = 0; k < Math.floor(len / 0.7); k++) {
    const r = bx(1.4, 0.07, 0.11, 0, 0.82, -len / 2 + 0.35 + k * 0.7);
    parts.push([r, C.steel, 1.3]);
  }
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) parts.push([bx(0.1, 0.62, 0.1, sx * 0.7, 0, sz * (len / 2 - 0.3)), C.dark]);
  // the hanger posts behind each frame (the clamp at its back)
  for (const pz of posts) parts.push([bx(0.08, 1.7, 0.08, -0.48, 0.82, pz), C.steel, 1.1], [bx(0.36, 0.06, 0.06, -0.32, 2.2, pz), C.steel, 1.1]);
  return place(ink(parts, 2, 0.6), x, z);
}
/**
 * An unfinished frame: a plated body of his kind, headless or half built (a variant by `kind`: 0
 * headless and plated, 1 one arm, no chest plate, 2 a half-shell head, the woven core bare). Built
 * standing in its own frame (feet at y 0, facing +z, 1.75 m), then turned (`lie`: on its back) and placed
 * at (x, y0, z) facing `yaw`. Returns geos (world).
 */
export function buildFrame(rng, x, y0, z, yaw, kind = 0, { lie = 0 } = {}) {
  const T = C.titanium, K = C.ceramic, W = C.weave;
  const parts = [];
  const limb = (a, b, r, col = T) => parts.push([rod(a, b, r, 6), col, 1.1]);
  // pelvis, legs (thigh, knee, shin, foot)
  parts.push([bx(0.34, 0.16, 0.2, 0, 0.86, 0), K, 1.05]);
  for (const s of [-1, 1]) {
    limb([s * 0.11, 0.9, 0], [s * 0.12, 0.5, 0.02], 0.055);
    parts.push([bx(0.11, 0.1, 0.12, s * 0.12, 0.44, 0.02), W]);
    limb([s * 0.12, 0.46, 0.02], [s * 0.12, 0.08, -0.02], 0.048);
    if (kind !== 1 || s > 0) parts.push([bx(0.09, 0.3, 0.04, s * 0.12, 0.12, 0.06), K, 1.15]);
    parts.push([bx(0.11, 0.07, 0.25, s * 0.12, 0, 0.04), K]);
  }
  // the spine: a stack of vertebrae; the ribs; the chest plate (not on kind 1)
  for (let k = 0; k < 5; k++) parts.push([bx(0.07, 0.07, 0.07, 0, 1.0 + k * 0.1, -0.06), W]);
  for (let k = 0; k < 3; k++) parts.push([bx(0.34 - k * 0.02, 0.045, 0.2, 0, 1.18 + k * 0.1, -0.01), T, 1.15]);
  if (kind !== 1) parts.push([bx(0.36, 0.3, 0.05, 0, 1.18, 0.1), K, 1.2]);
  parts.push([bx(0.5, 0.08, 0.15, 0, 1.47, -0.02), T, 1.1]);
  // arms (kind 1: the left one never fitted)
  for (const s of [-1, 1]) {
    if (kind === 1 && s < 0) continue;
    limb([s * 0.27, 1.5, 0], [s * 0.3, 1.18, 0.02], 0.042);
    limb([s * 0.3, 1.18, 0.02], [s * 0.31, 0.92, 0.08], 0.036, W);
    parts.push([bx(0.08, 0.12, 0.05, s * 0.31, 0.82, 0.09), K]);
  }
  // the neck; the head (kind 2: half a faceted shell, its slot dark)
  limb([0, 1.53, -0.02], [0, 1.64, 0], 0.03, W);
  if (kind === 2) {
    const hd = prep(new THREE.IcosahedronGeometry(0.12, 0));
    hd.scale(0.9, 1.15, 1);
    hd.translate(0.03, 1.73, 0);
    parts.push([hd, K, 1.2], [bx(0.16, 0.025, 0.04, 0, 1.75, 0.1), W]);
  }
  const geos = ink(parts, 1.75, 0.6);
  for (const g of geos) {
    if (lie) {
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.12, 0.8);
    }
    g.rotateY(yaw);
    g.translate(x, y0, z);
  }
  return geos;
}

// ---------------------------------------------------------------- what stands round the floor
/** Three gas bottles chained to a rack: red, a pale band, a valve cap each. Returns geos (world). */
export function buildTank(rng, x, z, yaw = 0) {
  const parts = [[bx(1.2, 0.08, 0.5, 0, 0, -0.32), C.dark], [bx(0.06, 1.3, 0.06, -0.55, 0, -0.5), C.steel], [bx(0.06, 1.3, 0.06, 0.55, 0, -0.5), C.steel], [bx(1.2, 0.05, 0.05, 0, 1.1, -0.48), C.steel, 1.2]];
  const at = [[-0.36, -0.18], [0.36, -0.2], [0, 0.22]];
  for (const [bx0, bz0] of at) {
    const r = 0.23, H = range(rng, 1.4, 1.6);
    parts.push([cy(r, r, H, bx0, 0, bz0, 10), C.tank, 1.0], [cy(r, r * 0.4, 0.2, bx0, H, bz0, 10), C.tank, 1.1], [cy(0.07, 0.07, 0.12, bx0, H + 0.2, bz0, 6), C.steel, 1.3]);
    parts.push([cy(r + 0.01, r + 0.01, 0.1, bx0, H * 0.62, bz0, 10), C.band, 0.9]);
  }
  return place(ink(parts, 1.7, 0.6), x, z, yaw);
}
/** What is left of a tank: the rack, scorched, and three torn stubs. */
export function buildTankWreck(rng, x, z, yaw = 0) {
  const parts = [[bx(1.2, 0.08, 0.5, 0, 0, -0.32), C.burnt], [bx(0.06, 0.8, 0.06, -0.55, 0, -0.5), C.burnt]];
  for (const [bx0, bz0] of [[-0.36, -0.18], [0.36, -0.2], [0, 0.22]]) parts.push([cy(0.24, 0.2, range(rng, 0.15, 0.4), bx0, 0, bz0, 8), C.burnt]);
  return place(ink(parts, 1, 0.6), x, z, yaw);
}
/** A stack of ingots in crossed layers. */
export function buildIngots(rng, x, z, yaw = 0, layers = 4) {
  const parts = [];
  for (let l = 0; l < layers; l++) {
    for (let k = 0; k < 4; k++) {
      const off = -0.36 + k * 0.24;
      const g = l % 2 ? bx(0.9, 0.15, 0.18, 0, l * 0.16, off) : bx(0.18, 0.15, 0.9, off, l * 0.16, 0);
      parts.push([g, C.ingot, 0.9 + 0.2 * rng()]);
    }
  }
  return place(ink(parts, 0.8, 0.6), x, z, yaw);
}
/** A loose girder lying on the floor along local z (an I-beam on its flange), `len` long. */
export function buildGirder(rng, x, z, yaw, len = 3.4) {
  const parts = ibeamLying(len, 0.38, 0.3).map((g) => [g, C.rust, 1.05]);
  // a torn end plate
  parts.push([bx(0.36, 0.42, 0.04, 0, 0, len / 2 - 0.02), C.dark]);
  return place(ink(parts, 0.6, 0.7), x, z, yaw);
}
/**
 * A section of a pipe rack along local z, `len` long: two portal frames, three pipes on them and, with
 * `vent`, a stack venting steam from its top (the steam is the set's). Returns { geos, vent: [x, y, z] }.
 */
export function buildPipeRack(rng, x, z, yaw, len = 4.6, vent = true) {
  const parts = [];
  for (const pz of [-len / 2 + 0.4, len / 2 - 0.4]) {
    for (const s of [-1, 1]) parts.push([bx(0.18, 3.2, 0.18, s * 0.8, 0, pz), C.steel, 1.1]);
    parts.push([bx(1.9, 0.16, 0.2, 0, 3.0, pz), C.steel, 1.15], [bx(1.6, 0.12, 0.16, 0, 1.9, pz), C.dark]);
  }
  const pipe = (px, py, r) => {
    const g = prep(new THREE.CylinderGeometry(r, r, len, 6, 1));
    g.rotateX(Math.PI / 2);
    g.translate(px, py + r, 0);
    return g;
  };
  parts.push([pipe(-0.45, 3.16, 0.2), C.rust, 1.05], [pipe(0.2, 3.16, 0.15), C.steel, 1.1], [pipe(0.0, 2.02, 0.13), C.dark]);
  let v = null;
  if (vent) {
    parts.push([cy(0.16, 0.16, 2.3, -0.45, 3.4, len / 2 - 0.9, 8), C.rust], [cy(0.24, 0.24, 0.16, -0.45, 5.7, len / 2 - 0.9, 8), C.dark]);
    v = [-0.45, 5.9, len / 2 - 0.9];
  }
  const geos = place(ink(parts, 4, 0.55), x, z, yaw);
  let vw = null;
  if (v) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    vw = [x + v[0] * c + v[2] * s, v[1], z - v[0] * s + v[2] * c];
  }
  return { geos, vent: vw };
}
/** A run of catwalk along local x, `len` long, its deck at `y`: grating, rails, two legs to the ground. */
export function buildCatwalk(rng, x, z, len, y = 3.2) {
  const parts = [[bx(len, 0.08, 1.1, 0, y, 0), C.dark], [bx(len, 0.05, 0.05, 0, y + 0.95, 0.52), C.paint, 0.8], [bx(len, 0.05, 0.05, 0, y + 0.95, -0.52), C.paint, 0.8]];
  for (let k = 0; k <= Math.floor(len / 1.5); k++) {
    const px = -len / 2 + 0.1 + k * ((len - 0.2) / Math.floor(len / 1.5));
    for (const s of [-1, 1]) parts.push([bx(0.04, 0.95, 0.04, px, y + 0.06, s * 0.52), C.steel, 1.1]);
  }
  for (const lx of [-len / 2 + 0.5, len / 2 - 0.5]) for (const s of [-1, 1]) parts.push([bx(0.12, y, 0.12, lx, 0, s * 0.46), C.steel]);
  return place(ink(parts, y + 1, 0.55), x, z);
}
/**
 * The blast furnace (left whole on purpose: it chips, hp Infinity): a brick hearth, the tapered stack,
 * the bustle pipe round it, the mantle and its platform, the uptakes; the tap hole on its south face and
 * the runner from it down to the pour (`runTo` m south of its centre). Returns geos (world).
 */
export function buildFurnace(rng, x, z, { r = 5, runTo = 9 } = {}) {
  const brick = (px, py, pz, nx, ny, nz) => {
    const course = Math.floor(py / 0.36), lit = 0.82 + 0.25 * Math.abs(Math.sin(course * 7.1 + Math.floor(Math.atan2(pz, px) * 6)));
    return mul(C.brick, lit * (0.72 + 0.3 * fbm2(px * 0.8, py * 0.8 + pz, 2)) * (0.8 + 0.22 * (Math.abs(nx) + ny + Math.abs(nz) * 0.8)));
  };
  const parts = [
    [cy(r * 1.06, r * 1.04, 1.8, 0, 0, 0, 12), brick],
    [cy(r, r * 0.74, 9, 0, 1.8, 0, 12), worn(C.rust, 0.35, 7)],
    [cy(r * 0.8, r * 0.8, 0.5, 0, 10.8, 0, 12), C.dark],
    [cy(r * 0.62, r * 0.5, 5, 0, 11.3, 0, 10), worn(C.steel, 0.4, 9)],
    [bx(r * 1.6, 0.2, r * 1.6, 0, 10.6, 0), C.dark],
  ];
  // the bustle pipe: a ring of boxes at 7 m; the downcomers
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * TAU, rr = r * 0.95;
    const g = bx(0.6, 0.6, rr * 0.47, 0, 7, rr);
    g.rotateY(a);
    parts.push([g, C.rust, 0.95]);
  }
  for (const a of [0.6, 2.6, 4.2]) parts.push([rod([Math.sin(a) * r * 0.55, 16, Math.cos(a) * r * 0.55], [Math.sin(a) * r * 1.2, 11, Math.cos(a) * r * 1.2], 0.42, 8), C.rust, 0.9]);
  // the tap hole (a dark arch on its south face) and the runner trough to the pour
  parts.push([bx(1.6, 1.8, 0.5, 0, 0, r * 1.02), C.dark, 0.5], [bx(2.2, 0.35, 0.6, 0, 1.8, r * 1.04), C.refractory]);
  const run = runTo - r;
  parts.push([bx(1.4, 0.32, run, 0, 0, r + run / 2), C.refractory, 0.9], [bx(0.7, 0.08, run, 0, 0.32, r + run / 2), C.crust, 0.9]);
  return place(ink(parts, 14, 0.5), x, z);
}
/**
 * A broken wall: brick on a concrete footing, `len` long along local x, its top torn (stepped chunks),
 * a pilaster; `low` true: knocked down to a stub. Returns { geos, ruin }.
 */
export function buildWall(rng, x, z, yaw, len, h, low = false) {
  const brick = (px, py, pz, nx, ny, nz) => {
    const row = Math.floor(py / 0.28), k = 0.78 + 0.3 * hash2(Math.floor(px / 0.55 + (row % 2) * 0.5), row);
    return mul(C.brick, k * (0.8 + 0.22 * (Math.abs(nx) + ny + Math.abs(nz) * 0.8)));
  };
  const parts = [[bx(len + 0.2, 0.4, 0.75), C.concrete, 0.9]];
  const H = low ? h * 0.4 : h;
  const n = Math.max(2, Math.round(len / 1.4));
  for (let k = 0; k < n; k++) {
    const w = len / n, hh = H * range(rng, 0.55, 1.0);
    parts.push([bx(w + 0.02, hh, 0.5, -len / 2 + (k + 0.5) * w, 0.4, 0), brick]);
  }
  parts.push([bx(0.7, H + 0.4, 0.75, -len / 2 + 0.35, 0.4, 0), worn(C.concrete, 0.7, 5)]);
  if (!low && rng() < 0.6) parts.push([rod([len * 0.1, H * 0.9, 0], [len * 0.1 + 0.3, H + 0.8, 0.2], 0.03, 5), C.rust]);
  const ruin = [[bx(len, 0.6, 0.75), mul(C.concrete, 0.7)]];
  return { geos: place(ink(parts, H + 0.4, 0.55), x, z, yaw), ruin: place(ink(ruin, 1), x, z, yaw) };
}
/** A heap of slag and scale: a few lumps on a low mound (a breakable heap, a stone's rubble when it goes). */
export function buildSlagHeap(rng, x, z, r) {
  const parts = [];
  const mound = prep(new THREE.IcosahedronGeometry(r, 1));
  mound.scale(1, 0.32, 1);
  lumpy(mound, r * 0.25, 1.4 / r, rng() * 99);
  parts.push([mound, C.slag, 1]);
  for (let k = 0; k < 4; k++) {
    const a = rng() * TAU, d = r * range(rng, 0.2, 0.7), s = r * range(rng, 0.18, 0.32);
    const g = prep(new THREE.IcosahedronGeometry(s, 0));
    lumpy(g, s * 0.4, 1.6 / s, rng() * 99);
    g.translate(Math.cos(a) * d, r * 0.22, Math.sin(a) * d);
    parts.push([g, k % 2 ? C.burnt : C.rust, 0.9]);
  }
  return place(ink(parts, r * 0.5, 0.6), x, z);
}

// ---------------------------------------------------------------- the pour (left whole: the kerb)
/** The pour's kerb and its molten skin (the heat over it is the set's ambience): x0..x1, z0..z1. */
export function buildPourKerb(rng, x0, x1, z0, z1) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const brick = (px, py, pz, nx, ny, nz) => mul(C.refractory, (0.65 + 0.35 * hash2(Math.floor(px / 0.6), Math.floor(pz / 0.6) + Math.floor(py / 0.25))) * (0.8 + 0.22 * (Math.abs(nx) + ny)));
  const parts = [
    [bx(w + 0.8, 0.36, 0.4, cx, 0, z1 + 0.2), brick],
    [bx(w + 0.8, 0.36, 0.4, cx, 0, z0 - 0.2), brick],
    [bx(0.4, 0.36, d, x0 - 0.2, 0, cz), brick],
    [bx(0.4, 0.36, d, x1 + 0.2, 0, cz), brick],
  ];
  // the molten skin, low in the channel and nearly black (the steel's light is the heat over it); a few
  // dark crust rafts on it
  parts.push([bx(w, 0.04, d, cx, 0.02, cz), mul(C.crust, 0.3)]);
  for (let k = 0; k < 9; k++) parts.push([bx(range(rng, 0.4, 1.2), 0.04, d * range(rng, 0.3, 0.7), x0 + (k + 0.5) * (w / 9) + range(rng, -0.6, 0.6), 0.04, cz + range(rng, -0.4, 0.4)), mul(C.burnt, 0.7)]);
  return ink(parts, 0.6, 0.6);
}

// ---------------------------------------------------------------- the wreck field (scenery past the walls)
/** A machine husk: a big burnt frame lying on its side, an arm reaching. Static scenery (world). */
export function buildHusk(rng, x, z, yaw, s = 1.4) {
  const geos = buildFrame(rng, 0, 0, 0, 0, Math.floor(rng() * 3), { lie: 1 });
  for (const g of geos) {
    g.scale(s, s, s);
    // (recoloured burnt: its plates the war's)
    const a = g.attributes.aCol;
    for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * 0.55 + 0.02, a.getY(i) * 0.45 + 0.01, a.getZ(i) * 0.4 + 0.008);
    g.rotateY(yaw);
    g.translate(x, 0, z);
  }
  return geos;
}
/** A tracked hulk: a hull on two tracks, its turret knocked askew, the gun down. Static scenery (world). */
export function buildHulk(rng, x, z, yaw) {
  const parts = [[bx(3.2, 1.2, 6.2, 0, 0.55, 0), worn(C.burnt, 0.5, 2)], [bx(2.6, 0.5, 2.4, 0, 1.75, 2.6), C.burnt]];
  for (const s of [-1, 1]) {
    parts.push([bx(0.9, 1.05, 6.8, s * 1.95, 0, 0), C.dark]);
    for (let k = 0; k < 6; k++) parts.push([cy(0.42, 0.42, 0.2, s * 2.42, 0.08, -2.6 + k * 1.04, 8), C.burnt]);
  }
  const tur = bx(2.4, 0.9, 2.6, 0.3, 1.75, -0.4, 0.35);
  parts.push([tur, worn(C.burnt, 0.6, 4)], [rod([0.6, 2.2, -0.6], [2.4, 0.7, -3.8], 0.16, 8), C.dark]);
  return place(ink(parts, 3, 0.55), x, z, yaw);
}
/** A rubble mound of the broken wall (static scenery past the fight). */
export function buildMound(rng, x, z, r) {
  return buildRubble(rng, x, z, r, { col: mul(C.brick, 0.9), h: r * 0.5 });
}

/** Merge a list of geos with hang marks kept (a set's own static mesh never hangs: this is for a piece). */
export const mergeHung = (parts) => mergeHang(parts, mergeGeometries(parts));
