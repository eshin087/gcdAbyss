import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG, createAsciiObjectMaterial, createCarvedGlyphMaterial } from '../render/materials.js';
import { markCaster } from '../render/pipeline.js';
import { mulberry32, range, hash2, fbm2 } from '../core/rng.js';
import { CONFIG } from '../core/config.js';
import { TAU } from '../core/math.js';
import {
  prep, lumpy, paint, carve, slabGeometry, mul, STONE, STONE_LOOK, SLAB_LOOK,
  buildDeadTree, buildStandingStone, buildBoulder, buildFlagstone, buildBonfire,
} from './forest.js';

// The Ashfall Courtyard (docs/specs/ash-disciple.md §2): the ruins of a sword sect on a burned
// hillside. South to north (the player walks north, -z): the bonfire on a scorched landing, a path of
// half-sunk flagstones between dead trees, rows of broken steps, a broken gate (two pillars, the
// fallen lintel beside them), then the courtyard: a square of paving ~29 m across centred on the
// origin, ringed by broken pillars and stone lanterns, a fallen bronze bell and a stele by the ruined
// hall to the north. Burned trees all round. Same output shape as createForest (world.js reads it),
// plus `ash: true` (atmosphere.js: falling ash instead of fireflies and leaves; grass.js: grey grass).
// Every prop is drawn through the existing glyph materials (STYLE.md): carved glyphs for stone, the
// AsciiObject screen grid for trees, the bell and the bonfire.

/** Layout numbers (world metres). The level's CONFIG.world overrides match these (levels/ashfall.js). */
export const COURTYARD = {
  half: 14.5, // the paving: |x|, |z| <= half
  cell: 1.45, // paving slab pitch
  pillarAt: 15.6, // the ring of pillars, this far out from the centre along each edge
  gateZ: 15.6,
  gateX: 3.4, // the gate pillars at x = ±gateX
  steps: [16.6, 17.5, 18.4, 19.3], // rows of broken steps (z)
  pathTo: 34, // the flagstone path runs from the steps to here
  bonfire: { x: 0, z: 36 },
};

/** The path's centre line (x at z): a gentle bend up the slope. */
const pathX = (z) => 1.1 * Math.sin((z - 20) * 0.22);

/** A whole floor of slabs under the duel must stay calm: sparser, dimmer glyphs than the forest's
 *  scattered flagstones (forest.js SLAB_LOOK), a softer chipped rim. */
const PAVING_LOOK = {
  gain: 1.55,
  lumScale: 2.0,
  edge: 0.3,
  inkFloor: 0.035,
  topGlyphs: ['.   ', '. . ', '.:. ', ':.;.', ';:=.', '=;%:'],
};
const BRONZE = [0.2, 0.15, 0.08];
const CHAR = [0.07, 0.065, 0.065];

/** A square-ish paving slab: four jittered corners, chamfered, laid on a slight tilt. */
function pavingSlab(rng, x, z, w, d, yaw) {
  const j = 0.05;
  const pts = [
    [-w / 2 + range(rng, -j, j), -d / 2 + range(rng, -j, j)],
    [w / 2 + range(rng, -j, j), -d / 2 + range(rng, -j, j)],
    [w / 2 + range(rng, -j, j), d / 2 + range(rng, -j, j)],
    [-w / 2 + range(rng, -j, j), d / 2 + range(rng, -j, j)],
  ];
  // a chipped corner on some slabs
  if (rng() < 0.25) {
    const k = Math.floor(rng() * 4), a = pts[k], b = pts[(k + 1) % 4];
    pts.splice(k + 1, 0, [a[0] * 0.55 + b[0] * 0.45, a[1] * 0.55 + b[1] * 0.45]);
    a[0] *= 0.82;
    a[1] *= 0.82;
  }
  const g = slabGeometry(pts, { top: range(rng, 0.03, 0.05), inset: 0.06, drop: 0.04 });
  const ax = range(rng, -1, 1), az = range(rng, -1, 1);
  g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(ax, 0, az).normalize(), range(rng, 0.005, 0.03)));
  g.rotateY(yaw);
  g.translate(x, 0, z);
  const rad = Math.max(w, d) * 0.5;
  carve(g, {
    // ash-grey stone, scorched darker in patches
    col: (px, py, pz) => mul(STONE, (0.55 + 0.4 * fbm2(px * 1.6, pz * 1.6, 2)) * (0.75 + 0.25 * fbm2(px * 0.15 + 4, pz * 0.15, 2))),
    ao: 0.85,
    moss: (px, py, pz) => 0.04 + 0.16 * Math.min(1, Math.hypot(px - x, pz - z) / rad),
    edge: (px, py, pz, nx, ny) => (ny > 0.5 && ny < 0.95 ? 1 : 0),
  });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const outline = pts.map(([px, pz]) => [x + c * px + s * pz, z - s * px + c * pz]);
  return { geo: g, outline, r: rad * 1.15 };
}

/** A temple pillar: an octagonal shaft on a square base, its top broken off at `h`. */
function buildPillar(rng, x, z, h, { r = 0.42, fallen = false, yaw = 0 } = {}) {
  const parts = [];
  const base = prep(new THREE.BoxGeometry(r * 2.6, 0.32, r * 2.6, 2, 1, 2));
  base.translate(0, 0.16, 0);
  parts.push(base);
  const shaft = prep(new THREE.CylinderGeometry(r * 0.92, r, h, 8, Math.max(2, Math.round(h * 2))));
  shaft.translate(0, 0.32 + h / 2, 0);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // a jagged break at the top
    if (y > 0.32 + h * 0.92) p.setY(i, y - hash2(p.getX(i) * 13 + x, p.getZ(i) * 13 + z) * Math.min(0.5, h * 0.2));
  }
  lumpy(shaft, 0.06, 2.4, rng() * 99, new THREE.Vector3(0, 0.32 + h / 2, 0));
  parts.push(shaft);
  if (h > 2.6 && rng() < 0.6) {
    // a capital block on the survivors
    const cap = prep(new THREE.BoxGeometry(r * 2.4, 0.3, r * 2.4));
    cap.translate(0, 0.32 + h + 0.12, 0);
    parts.push(cap);
  }
  const g = mergeGeometries(parts);
  if (fallen) {
    g.rotateX(Math.PI / 2 - 0.05);
    g.translate(0, r - 0.05, 0);
  }
  g.rotateY(yaw);
  carve(g, {
    col: (px, py, pz) => mul(STONE, 0.7 + 0.45 * fbm2(px * 1.9 + x, pz * 1.9 + py, 2)),
    moss: (px, py) => (py < 0.4 ? 0.25 : 0.04),
    ao: (px, py) => 0.55 + 0.45 * Math.min(1, py / 1.4),
  });
  g.translate(x, 0, z);
  return g;
}

/** A stone lantern: base, post, the lamp box with its window, a pointed cap. */
function buildLantern(rng, x, z, yaw) {
  const parts = [];
  const box = (w, h, d, y) => {
    const b = prep(new THREE.BoxGeometry(w, h, d));
    b.translate(0, y + h / 2, 0);
    parts.push(b);
  };
  box(0.7, 0.18, 0.7, 0);
  box(0.26, 0.75, 0.26, 0.18);
  box(0.5, 0.1, 0.5, 0.93);
  box(0.42, 0.38, 0.42, 1.03);
  const cap = prep(new THREE.ConeGeometry(0.48, 0.42, 4));
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 1.62, 0);
  parts.push(cap);
  const g = mergeGeometries(parts);
  lumpy(g, 0.025, 4, rng() * 9, new THREE.Vector3(0, 0.8, 0));
  g.rotateY(yaw);
  carve(g, {
    col: (px, py, pz) => mul(STONE, 0.8 + 0.4 * fbm2(px * 3 + x, pz * 3 + py, 2)),
    moss: (px, py, pz, nx, ny) => (ny > 0.6 ? 0.4 : 0.05),
    ao: (px, py) => 0.6 + 0.4 * Math.min(1, py / 1.2),
  });
  g.translate(x, 0, z);
  return g;
}

/** The sect's great bronze bell, fallen on its side and cracked. Screen-grid prop. */
function buildBell(rng, x, z, yaw) {
  const prof = [
    [0.02, 0.0], [0.5, 0.02], [0.92, 0.12], [1.02, 0.3], [0.98, 0.5], [0.86, 1.1],
    [0.76, 1.6], [0.66, 1.9], [0.4, 2.02], [0.1, 2.06],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = prep(new THREE.LatheGeometry(prof, 14));
  lumpy(g, 0.04, 3, 3);
  const lug = prep(new THREE.TorusGeometry(0.22, 0.08, 5, 8));
  lug.translate(0, 2.2, 0);
  const all = mergeGeometries([g, lug]);
  all.rotateZ(Math.PI / 2 - 0.12); // on its side, the mouth facing +x
  all.translate(0, 0.98, 0);
  all.rotateY(yaw);
  paint(all, {
    col: (px, py, pz) => mul(BRONZE, 0.7 + 0.6 * fbm2(px * 2.2 + 5, pz * 2.2 + py, 2)),
    flag: FLAG.STONE,
    ao: (px, py) => 0.55 + 0.45 * Math.min(1, py / 1.6),
  });
  all.translate(x, 0, z);
  return [all];
}

/** A charred stump with a few roots. Screen-grid prop. */
function buildStump(rng, x, z, s) {
  const h = range(rng, 0.5, 1.2) * s;
  const g = prep(new THREE.CylinderGeometry(0.26 * s, 0.42 * s, h, 7, 2));
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > h * 0.9) p.setY(i, p.getY(i) - hash2(p.getX(i) * 9 + x, p.getZ(i) * 9) * h * 0.35);
  lumpy(g, 0.08 * s, 2, rng() * 9, new THREE.Vector3(0, h / 2, 0));
  paint(g, { col: CHAR, flag: FLAG.STONE, ao: (px, py) => 0.6 + 0.4 * (py / h) });
  g.translate(x, 0, z);
  return [g];
}

// ---------- assembly ----------
export function createCourtyard(U, colliders) {
  const rng = mulberry32(CONFIG.seed + 101);
  const C = COURTYARD;
  const group = new THREE.Group();
  group.name = 'courtyard';
  const treeGeos = [];
  const stoneGeos = [];
  const slabGeos = [];
  const propGeos = [];
  const treeSpots = [];
  const bare = [];
  const slabs = [];

  // ---- the paving: rows of slabs, some two cells long, a staggered bond; some missing (scorched
  // earth shows through)
  const n = Math.round((2 * C.half) / C.cell);
  for (let j = 0; j < n; j++) {
    const z = -C.half + (j + 0.5) * C.cell;
    let i = j % 2 ? -0.5 : 0; // stagger every other row by half a slab
    while (i < n) {
      const long = rng() < 0.38 && i + 2 <= n;
      const span = Math.min(long ? 2 : 1, n - Math.max(0, i));
      const i0 = Math.max(0, i), i1 = Math.min(n, i + span);
      i += span;
      if (i1 - i0 < 0.4) continue;
      const x = -C.half + ((i0 + i1) / 2) * C.cell;
      if (rng() < 0.12) {
        bare.push({ x, z, r: 0.6 * (i1 - i0) });
        continue;
      }
      const w = (i1 - i0) * C.cell - range(rng, 0.1, 0.2), d = C.cell - range(rng, 0.1, 0.2);
      const s = pavingSlab(rng, x + range(rng, -0.04, 0.04), z + range(rng, -0.04, 0.04), w, d, range(rng, -0.06, 0.06));
      slabGeos.push(s.geo);
      slabs.push({ x, z, r: s.r, outline: s.outline });
    }
  }

  // ---- the ring of pillars round the paving; the gate gap to the south
  const P = C.pillarAt;
  const ring = [];
  for (let k = -3; k <= 3; k++) {
    const t = k * 5.2;
    ring.push([t, -P, 0], [-P, t, Math.PI / 2], [P, t, -Math.PI / 2]);
    if (Math.abs(t) > 5) ring.push([t, P, Math.PI]);
  }
  ring.forEach(([x, z, yaw], i) => {
    const roll = hash2(i * 3.1, i * 7.7);
    const fallen = roll < 0.16;
    const h = fallen ? range(rng, 3, 4) : roll < 0.5 ? range(rng, 1.0, 2.2) : range(rng, 3.4, 4.4);
    // a fallen pillar lies outward, away from the duel
    const out = Math.atan2(x, z);
    stoneGeos.push(buildPillar(rng, x, z, h, { fallen, yaw: fallen ? out + range(rng, -0.4, 0.4) : 0 }));
    if (fallen) {
      const dx = Math.sin(out), dz = Math.cos(out);
      for (const f of [0.3, 0.75]) colliders.add(x + dx * h * f, z + dz * h * f, 0.55, 'stone');
    } else colliders.add(x, z, 0.62, 'stone');
  });
  // the gate: two tall pillars, the lintel fallen beside them
  for (const s of [-1, 1]) {
    stoneGeos.push(buildPillar(rng, s * C.gateX, C.gateZ, 4.6, { r: 0.5 }));
    colliders.add(s * C.gateX, C.gateZ, 0.7, 'stone');
  }
  {
    const lx = C.gateX + 2.6, lz = C.gateZ + 1.6, yaw = 0.35;
    stoneGeos.push(buildStandingStone(rng, lx, lz, { h: 6.8, w: 0.85, d: 0.7, yaw, fallen: true }));
    for (const f of [0.15, 0.5, 0.85]) colliders.add(lx + Math.sin(yaw) * 6.8 * f, lz + Math.cos(yaw) * 6.8 * f, 0.5, 'stone');
  }
  // stone lanterns at the inner corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (C.half - 2.2), z = sz * (C.half - 2.2);
    stoneGeos.push(buildLantern(rng, x, z, range(rng, -0.2, 0.2)));
    colliders.add(x, z, 0.45, 'stone');
  }
  // the ruined hall to the north: a row of column stumps, a stele
  for (const x of [-9, -4.5, 4.5, 9]) {
    const h = Math.abs(x) > 6 ? range(rng, 3.5, 4.5) : range(rng, 0.6, 1.4);
    stoneGeos.push(buildPillar(rng, x, -C.half - 4.2, h, { r: 0.5 }));
    colliders.add(x, -C.half - 4.2, 0.7, 'stone');
  }
  stoneGeos.push(buildStandingStone(rng, 9.6, -10.8, { h: 2.6, w: 1.2, d: 0.35, yaw: 0.25 }));
  colliders.add(9.6, -10.8, 0.75, 'stone');
  // the fallen bell
  propGeos.push(...buildBell(rng, -9.2, -10.6, 0.5));
  colliders.add(-9.2, -10.6, 1.25, 'stone');

  // ---- the steps up to the gate: long slabs in rows, cracked into pieces
  for (const z of C.steps) {
    let x = -3.9;
    while (x < 3.9) {
      const w = Math.min(3.9 - x, range(rng, 1.3, 2.6));
      const s = pavingSlab(rng, x + w / 2, z, w - 0.08, 0.78, range(rng, -0.03, 0.03));
      slabGeos.push(s.geo);
      slabs.push({ x: x + w / 2, z, r: s.r, outline: s.outline });
      x += w;
    }
  }
  // ---- the path down the slope to the bonfire
  for (let z = 20.2; z < C.pathTo; z += range(rng, 0.9, 1.3)) {
    const x = pathX(z) + range(rng, -0.6, 0.6);
    const w = range(rng, 0.9, 1.5), d = range(rng, 0.7, 1.2);
    const s = buildFlagstone(rng, x, z, w, d, rng() * TAU);
    slabGeos.push(s.geo);
    slabs.push({ x, z, r: Math.max(w, d) * 0.65, outline: s.outline });
  }

  // ---- the bonfire on its scorched landing
  const bf = C.bonfire;
  propGeos.push(...buildBonfire(rng, bf.x, bf.z));
  colliders.add(bf.x, bf.z, 0.75, 'bonfire');
  bare.push({ x: bf.x, z: bf.z, r: 2.4 });

  // ---- the burned forest: dead trees and stumps all round, the courtyard and the path left open
  const open = (x, z) => {
    if (Math.abs(x) < C.half + 3.5 && Math.abs(z) < C.half + 3.5) return false; // the courtyard + pillar ring
    if (z > C.half && z < C.pathTo + 4 && Math.abs(x - pathX(z)) < 4.6) return false; // steps + path
    if (Math.hypot(x - bf.x, z - bf.z) < 5) return false;
    return true;
  };
  const trees = [];
  for (let i = 0; i < 30000 && trees.length < 340; i++) {
    const a = rng() * TAU, r = 18 + Math.pow(rng(), 1.3) * 52;
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 6;
    if (!open(x, z)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < (r < 40 ? 3.2 : 3.8))) continue;
    trees.push({ x, z, s: range(rng, 0.85, 1.4), stump: rng() < 0.3 });
  }
  for (const t of trees) {
    const g = t.stump ? buildStump(rng, t.x, t.z, t.s) : buildDeadTree(rng, t.x, t.z, t.s);
    // the dead trees here are charred: darken their paint
    for (const geo of g) {
      const col = geo.attributes.aCol;
      if (col && !t.stump) for (let k = 0; k < col.count; k++) col.setXYZ(k, col.getX(k) * 0.55, col.getY(k) * 0.52, col.getZ(k) * 0.52);
    }
    treeGeos.push(...g);
    treeSpots.push({ x: t.x, z: t.z, r: (t.stump ? 1.2 : 2.4) * t.s });
    if (Math.hypot(t.x, t.z) < 46) colliders.add(t.x, t.z, (t.stump ? 0.4 : 0.42) * t.s, 'trunk');
  }
  // toppled stones and boulders on the slope
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU, r = range(rng, 20, 55);
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 6;
    if (!open(x, z)) continue;
    const size = range(rng, 0.7, 1.7);
    stoneGeos.push(buildBoulder(rng, x, z, size));
    if (r < 46) colliders.add(x, z, size * 0.85, 'boulder');
  }

  const mat = createAsciiObjectMaterial(U, { fadeNearPlayer: true, side: THREE.DoubleSide });
  const treeMesh = new THREE.Mesh(mergeGeometries(treeGeos), mat);
  treeMesh.name = 'trees';
  const propMesh = new THREE.Mesh(mergeGeometries(propGeos), mat);
  propMesh.name = 'props';
  const pitch = CONFIG.camera.pitch;
  const stoneMat = createCarvedGlyphMaterial(U, { ...STONE_LOOK, fadeNearPlayer: true, viewPitch: pitch });
  const stoneMesh = new THREE.Mesh(mergeGeometries(stoneGeos), stoneMat);
  stoneMesh.name = 'stones';
  const slabMat = createCarvedGlyphMaterial(U, { ...SLAB_LOOK, ...PAVING_LOOK, viewPitch: pitch });
  const slabMesh = new THREE.Mesh(mergeGeometries(slabGeos), slabMat);
  slabMesh.name = 'paving';
  group.add(treeMesh, propMesh, stoneMesh, slabMesh);
  markCaster(group);

  const S = CONFIG.world.dragonSleep ?? { x: 0, z: 0 };
  return {
    group, treeSpots, bare, slabs, nest: { x: S.x, z: S.z }, bonfire: { x: bf.x, z: bf.z },
    material: mat, stoneMaterial: stoneMat, slabMaterial: slabMat,
    ash: true,
    // a burned hillside: sparse, short, ash-grey grass; in the courtyard only a few tufts in the cracks
    grass: {
      ash: 0.85,
      height: 0.62,
      density: (x, z) => {
        const inYard = Math.abs(x) < C.half + 1 && Math.abs(z) < C.half + 1;
        const onPath = z > C.half && z < C.pathTo + 3 && Math.abs(x - pathX(z)) < 2.2;
        return inYard ? 0.12 : onPath ? 0.3 : 0.16 + 0.22 * fbm2(x * 0.08 + 11, z * 0.08 - 3, 2);
      },
    },
  };
}
