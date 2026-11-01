import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG, createAsciiObjectMaterial } from '../render/materials.js';
import { markCaster } from '../render/pipeline.js';
import { mulberry32, range, hash2, fbm2 } from '../core/rng.js';
import { CONFIG } from '../core/config.js';
import { TAU } from '../core/math.js';

// Procedural forest ring around a moonlit clearing: blob oaks and pines (leaf-ramp ASCII),
// a broken standing-stone circle, boulders, flagstones, the bones of past challengers near
// the wyrm's nest, and the bonfire at the southern entrance. Everything is merged into a few
// meshes using the AsciiObject material so the post pass renders it as character grids.

// ---------- small helpers ----------
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const h = (a, b, c) => hash2(a * 7 + c * 131, b * 13 - c * 57);
  const lx = s(xf), ly = s(yf), lz = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(h(xi, yi, zi), h(xi + 1, yi, zi), lx), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), lx), ly),
    L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), lx), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), lx), ly),
    lz,
  );
}

function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  return g;
}

/** Displace vertices along their direction from `center` by 3D noise (watertight: position-keyed). */
function lumpy(geo, amp, freq, seed = 0, center = new THREE.Vector3()) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * freq + seed, v.y * freq - seed * 0.7, v.z * freq + seed * 1.3) - 0.5;
    const dir = v.clone().sub(center);
    const len = dir.length() || 1;
    v.addScaledVector(dir, (n * amp) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

/** Bake per-vertex aCol/aFlag/aSway/aAO. col/sway/ao may be constants or fn(x,y,z,nx,ny,nz). */
function paint(geo, { col, flag, sway = 0, ao = 1 }) {
  geo.computeVertexNormals();
  const p = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = p.count;
  const aCol = new Float32Array(n * 3);
  const aFlag = new Float32Array(n).fill(flag);
  const aSway = new Float32Array(n);
  const aAO = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const c = typeof col === 'function' ? col(x, y, z, nx, ny, nz) : col;
    aCol[i * 3] = c[0];
    aCol[i * 3 + 1] = c[1];
    aCol[i * 3 + 2] = c[2];
    aSway[i] = typeof sway === 'function' ? sway(x, y, z) : sway;
    aAO[i] = typeof ao === 'function' ? ao(x, y, z, nx, ny, nz) : ao;
  }
  geo.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
  geo.setAttribute('aFlag', new THREE.BufferAttribute(aFlag, 1));
  geo.setAttribute('aSway', new THREE.BufferAttribute(aSway, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aAO, 1));
  return geo;
}

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- palette (linear) ----------
// leaf albedos carry little blue: the moonlight already tints everything teal
const LEAF = [
  [0.17, 0.29, 0.13],
  [0.14, 0.27, 0.15],
  [0.19, 0.3, 0.12],
  [0.13, 0.23, 0.13],
  [0.2, 0.29, 0.16],
];
const PINE = [
  [0.09, 0.19, 0.1],
  [0.1, 0.2, 0.09],
  [0.08, 0.16, 0.1],
];
const BARK = [0.12, 0.09, 0.075];
const STONE = [0.15, 0.165, 0.205];
const MOSS = [0.08, 0.13, 0.085];
const BONE = [0.27, 0.255, 0.22];

// ---------- builders ----------
function buildOak(rng, x, z, s) {
  const parts = [];
  const lean = new THREE.Vector2(range(rng, -0.12, 0.12), range(rng, -0.12, 0.12));
  const trunkH = range(rng, 3.4, 4.4) * s;
  const trunk = prep(new THREE.CylinderGeometry(0.2 * s, 0.42 * s, trunkH, 7, 3));
  trunk.translate(0, trunkH / 2, 0);
  {
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) + lean.x * y);
      p.setZ(i, p.getZ(i) + lean.y * y);
    }
  }
  paint(trunk, {
    col: (px, py) => mul(BARK, 0.75 + 0.5 * hash2(px * 9 + x, py * 5 + z)),
    flag: FLAG.STONE,
    sway: (px, py) => (py / trunkH) * 0.15,
    ao: (px, py) => 0.55 + 0.45 * Math.min(1, py / trunkH),
  });
  parts.push(trunk);

  const cTop = new THREE.Vector3(lean.x * trunkH, trunkH + 1.1 * s, lean.y * trunkH);
  const nBlobs = 4 + Math.floor(rng() * 3);
  const leaf = LEAF[Math.floor(rng() * LEAF.length)];
  const canopyBottom = trunkH - 0.6 * s;
  const canopyTop = trunkH + 3.6 * s;
  const seed = rng() * 100;
  for (let b = 0; b < nBlobs; b++) {
    const r = range(rng, 1.4, 2.3) * s;
    const ico = prep(new THREE.IcosahedronGeometry(r, 1));
    const a = (b / nBlobs) * TAU + rng() * 0.8;
    const d = b === 0 ? 0 : range(rng, 0.9, 1.8) * s;
    const off = new THREE.Vector3(Math.cos(a) * d, range(rng, -0.5, 0.9) * s + (b === 0 ? 0.8 * s : 0), Math.sin(a) * d);
    ico.scale(1, 0.82, 1);
    lumpy(ico, r * 0.42, 1.25 / s, seed + b);
    ico.translate(cTop.x + off.x, cTop.y + off.y, cTop.z + off.z);
    paint(ico, {
      col: (px, py, pz) => {
        const n = fbm2(px * 0.9 + seed, pz * 0.9 - py * 0.5, 2);
        return mul(leaf, 0.62 + 0.62 * n);
      },
      flag: FLAG.LEAF,
      sway: (px, py) => 0.6 + 0.6 * Math.max(0, (py - canopyBottom) / (canopyTop - canopyBottom)),
      ao: (px, py, pz) => {
        const h = Math.max(0, Math.min(1, (py - canopyBottom) / (canopyTop - canopyBottom)));
        const hollow = noise3(px * 0.75 + seed, py * 0.75, pz * 0.75) > 0.66 ? 0.42 : 1;
        return (0.55 + 0.45 * h) * hollow;
      },
    });
    parts.push(ico);
  }
  for (const g of parts) g.translate(x, 0, z);
  return parts;
}

function buildPine(rng, x, z, s) {
  const parts = [];
  const trunkH = 2.0 * s;
  const trunk = prep(new THREE.CylinderGeometry(0.12 * s, 0.28 * s, trunkH + 1.5 * s, 6, 2));
  trunk.translate(0, (trunkH + 1.5 * s) / 2, 0);
  paint(trunk, { col: mul(BARK, 0.9), flag: FLAG.STONE, sway: 0.05, ao: 0.6 });
  parts.push(trunk);
  const tiers = 4;
  const col = PINE[Math.floor(rng() * PINE.length)];
  const seed = rng() * 50;
  const top = trunkH + tiers * 1.55 * s + 1.0 * s;
  for (let t = 0; t < tiers; t++) {
    const r = (2.1 - t * 0.42) * s;
    const h = 2.5 * s;
    const cone = prep(new THREE.ConeGeometry(r, h, 9, 2, true));
    cone.rotateY(rng() * TAU);
    const y0 = trunkH + t * 1.55 * s;
    cone.translate(0, y0 + h / 2, 0);
    lumpy(cone, r * 0.32, 1.6 / s, seed + t, new THREE.Vector3(0, y0 + h / 2, 0));
    paint(cone, {
      col: (px, py, pz) => mul(col, 0.65 + 0.6 * fbm2(px * 1.3 + seed, pz * 1.3 + py, 2)),
      flag: FLAG.LEAF,
      sway: (px, py) => 0.3 + 0.7 * (py / top),
      ao: (px, py, pz, nx, ny) => (0.45 + 0.55 * Math.max(0, ny * 0.5 + 0.5)) * (0.55 + 0.45 * ((py - y0) / h)),
    });
    parts.push(cone);
  }
  for (const g of parts) g.translate(x, 0, z);
  return parts;
}

function buildDeadTree(rng, x, z, s) {
  const parts = [];
  const h = range(rng, 4.5, 6.5) * s;
  const trunk = prep(new THREE.CylinderGeometry(0.14 * s, 0.38 * s, h, 6, 4));
  trunk.translate(0, h / 2, 0);
  lumpy(trunk, 0.18 * s, 1.2, rng() * 10, new THREE.Vector3(0, h / 2, 0));
  const dead = [0.16, 0.155, 0.16];
  paint(trunk, { col: dead, flag: FLAG.STONE, sway: 0, ao: (px, py) => 0.5 + 0.5 * (py / h) });
  parts.push(trunk);
  const nb = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < nb; i++) {
    const len = range(rng, 1.4, 2.6) * s;
    const br = prep(new THREE.CylinderGeometry(0.03 * s, 0.11 * s, len, 4, 1));
    br.translate(0, len / 2, 0);
    br.rotateZ(range(rng, 0.5, 1.1));
    br.rotateY(rng() * TAU);
    br.translate(0, h * range(rng, 0.45, 0.9), 0);
    paint(br, { col: dead, flag: FLAG.STONE, sway: 0.1, ao: 0.85 });
    parts.push(br);
  }
  for (const g of parts) g.translate(x, 0, z);
  return parts;
}

function buildStandingStone(rng, x, z, { h, w, d, yaw, fallen = false, broken = false }) {
  const g = prep(new THREE.BoxGeometry(w, h, d, 2, 5, 2));
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = 1 - 0.28 * (y / h);
    p.setX(i, p.getX(i) * t);
    p.setZ(i, p.getZ(i) * t);
    if (broken && y > h * 0.9) p.setY(i, y - hash2(p.getX(i) * 20, p.getZ(i) * 20) * h * 0.25);
  }
  lumpy(g, 0.22, 1.7, rng() * 99, new THREE.Vector3(0, h / 2, 0));
  if (fallen) {
    g.rotateX(Math.PI / 2 - 0.08);
    g.translate(0, d / 2 - 0.1, 0);
  }
  g.rotateY(yaw);
  paint(g, {
    col: (px, py, pz, nx, ny) => {
      const n = 0.7 + 0.55 * fbm2(px * 1.7 + x, pz * 1.7 + py, 2);
      const moss = ny > 0.55 || (py < 0.6 && hash2(px * 13, pz * 13) > 0.6) ? 0.65 : 0;
      return mix3(mul(STONE, n), mul(MOSS, n), moss);
    },
    flag: FLAG.STONE,
    ao: (px, py) => 0.55 + 0.45 * Math.min(1, py / 1.2),
  });
  g.translate(x, 0, z);
  return g;
}

function buildBoulder(rng, x, z, r) {
  const g = prep(new THREE.IcosahedronGeometry(r, 1));
  lumpy(g, r * 0.5, 1.4 / r, rng() * 99);
  g.scale(1, range(rng, 0.5, 0.75), 1);
  g.rotateY(rng() * TAU);
  g.translate(x, r * 0.2, z);
  paint(g, {
    col: (px, py, pz, nx, ny) => {
      const n = 0.65 + 0.6 * fbm2(px * 1.4, pz * 1.4 + py, 2);
      return ny > 0.6 ? mix3(mul(STONE, n), mul(MOSS, n), 0.5) : mul(STONE, n * 0.95);
    },
    flag: FLAG.STONE,
    ao: (px, py) => 0.5 + 0.5 * Math.min(1, py / (r * 0.8)),
  });
  return g;
}

function buildFlagstone(rng, x, z, w, d, yaw) {
  const g = prep(new THREE.BoxGeometry(w, 0.12, d, 2, 1, 2));
  lumpy(g, 0.05, 2.5, rng() * 50);
  g.rotateY(yaw);
  g.translate(x, 0.0, z);
  paint(g, { col: (px, py, pz) => mul(STONE, 0.6 + 0.4 * fbm2(px * 2, pz * 2, 2)), flag: FLAG.STONE, ao: 0.85 });
  return g;
}

function buildBones(rng, cx, cz) {
  const parts = [];
  const add = (geo, colK = 1) => {
    paint(geo, { col: (px, py, pz) => mul(BONE, colK * (0.7 + 0.45 * hash2(px * 11, pz * 11 + py))), flag: FLAG.STONE, ao: 0.9 });
    parts.push(geo);
  };
  // great ribcage of an older wyrm, half sunk into the earth
  const ribs = 7;
  const spineYaw = -0.5;
  const dir = new THREE.Vector2(Math.sin(spineYaw), Math.cos(spineYaw));
  for (let i = 0; i < ribs; i++) {
    const t = i / (ribs - 1);
    const rad = 2.4 - Math.abs(t - 0.35) * 1.8;
    for (const side of [-1, 1]) {
      const arc = prep(new THREE.TorusGeometry(rad, 0.13, 5, 12, Math.PI * 0.62));
      arc.rotateZ(side > 0 ? 0.15 : Math.PI - 0.15 - Math.PI * 0.62);
      arc.rotateY(spineYaw); // rib plane perpendicular to the spine
      const along = (i - ribs / 2) * 0.95;
      arc.translate(cx + dir.x * along, -0.35, cz + dir.y * along);
      add(arc);
    }
  }
  // spine vertebrae (gently curving, some missing)
  for (let i = -6; i < 7; i++) {
    if (rng() < 0.18) continue;
    const v = prep(new THREE.BoxGeometry(0.3, 0.22, 0.42));
    const bend = Math.sin(i * 0.35) * 0.6;
    v.rotateY(spineYaw + rng() * 0.5);
    v.translate(cx + dir.x * i * 0.62 + dir.y * bend, -0.02, cz + dir.y * i * 0.62 - dir.x * bend);
    add(v, 0.8);
  }
  // giant skull
  const skull = prep(new THREE.IcosahedronGeometry(1.0, 1));
  skull.scale(0.95, 0.7, 1.5);
  lumpy(skull, 0.25, 2.2, 5);
  const snout = prep(new THREE.BoxGeometry(0.9, 0.55, 1.6, 2, 1, 2));
  snout.translate(0, -0.1, 1.5);
  const hornL = prep(new THREE.ConeGeometry(0.2, 1.6, 5));
  hornL.rotateX(-1.9);
  hornL.translate(0.55, 0.5, -1.2);
  const hornR = hornL.clone();
  hornR.translate(-1.1, 0, 0);
  for (const g of [skull, snout, hornL, hornR]) {
    g.rotateY(spineYaw + 2.6);
    g.translate(cx + dir.x * -5.6 + 1.2, 0.2, cz + dir.y * -5.6 - 0.4);
    add(g, 1.05);
  }
  // remains of fallen knights: helms, swords, long bones
  for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, r = range(rng, 2.5, 8);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (rng() < 0.4) {
      const helm = prep(new THREE.SphereGeometry(0.24, 7, 5, 0, TAU, 0, Math.PI * 0.6));
      helm.translate(x, 0.0, z);
      paint(helm, { col: [0.2, 0.21, 0.23], flag: FLAG.STONE, ao: 0.9 });
      parts.push(helm);
    } else if (rng() < 0.5) {
      const sword = prep(new THREE.BoxGeometry(0.08, 1.15, 0.03));
      sword.translate(0, 0.45, 0);
      sword.rotateZ(range(rng, -0.4, 0.4));
      sword.rotateY(rng() * TAU);
      sword.translate(x, 0, z);
      paint(sword, { col: [0.3, 0.31, 0.34], flag: FLAG.STONE, ao: 1 });
      parts.push(sword);
    } else {
      const bone = prep(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5));
      bone.rotateZ(Math.PI / 2);
      bone.rotateY(rng() * TAU);
      bone.translate(x, 0.05, z);
      add(bone);
    }
  }
  return parts;
}

function buildBonfire(rng, x, z) {
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rng() * 0.3;
    const st = prep(new THREE.IcosahedronGeometry(0.2, 0));
    lumpy(st, 0.1, 4, i);
    st.scale(1, 0.7, 1);
    st.translate(x + Math.cos(a) * 0.72, 0.08, z + Math.sin(a) * 0.72);
    paint(st, { col: mul(STONE, 1.1), flag: FLAG.STONE, ao: 0.9 });
    parts.push(st);
  }
  const ash = prep(new THREE.SphereGeometry(0.55, 10, 4, 0, TAU, 0, Math.PI / 2));
  ash.scale(1, 0.22, 1);
  ash.translate(x, 0, z);
  paint(ash, { col: [0.06, 0.055, 0.05], flag: FLAG.STONE, ao: 1 });
  parts.push(ash);
  for (let i = 0; i < 3; i++) {
    const log = prep(new THREE.CylinderGeometry(0.07, 0.09, 0.95, 5));
    log.rotateZ(Math.PI / 2 - 0.35);
    log.rotateY((i / 3) * TAU);
    log.translate(x, 0.22, z);
    paint(log, { col: [0.05, 0.035, 0.025], flag: FLAG.STONE, ao: 0.8 });
    parts.push(log);
  }
  const sword = prep(new THREE.BoxGeometry(0.09, 1.25, 0.035));
  const guard = prep(new THREE.BoxGeometry(0.34, 0.06, 0.06));
  guard.translate(0, 0.42, 0);
  sword.translate(0, 0.2, 0);
  for (const g of [sword, guard]) {
    g.rotateZ(0.12);
    g.rotateY(0.6);
    g.translate(x, 0.35, z);
    paint(g, { col: [0.32, 0.31, 0.3], flag: FLAG.STONE, ao: 1 });
    parts.push(g);
  }
  return parts;
}

// ---------- assembly ----------
export function createForest(U, colliders) {
  const rng = mulberry32(CONFIG.seed);
  const W = CONFIG.world;
  const group = new THREE.Group();
  group.name = 'forest';
  const treeGeos = [];
  const stoneGeos = [];
  const treeSpots = [];
  const bare = [];

  // trees in a ring around the clearing, leaving a path open to the south
  const trees = [];
  const open = (x, z) => !(z > 27 && Math.abs(x) < 4.2 + (z - 27) * 0.18);
  // spatial hash so the min-spacing test stays cheap with many trees
  const cellOf = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const buckets = new Map();
  const tooClose = (x, z, d) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const t of buckets.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < d) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < 40000 && trees.length < 560; i++) {
    const a = rng() * TAU;
    const r = 32.2 + Math.pow(rng(), 1.25) * 42; // denser near the clearing
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!open(x, z)) continue;
    if (tooClose(x, z, r < 44 ? 3.0 : 3.6)) continue;
    const roll = rng();
    const t = { x, z, s: range(rng, 0.85, 1.35), type: roll < 0.36 ? 'pine' : roll < 0.41 ? 'dead' : 'oak' };
    trees.push(t);
    const key = cellOf(x, z);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  for (const t of trees) {
    const g = t.type === 'pine' ? buildPine(rng, t.x, t.z, t.s) : t.type === 'dead' ? buildDeadTree(rng, t.x, t.z, t.s) : buildOak(rng, t.x, t.z, t.s);
    treeGeos.push(...g);
    treeSpots.push({ x: t.x, z: t.z, r: t.type === 'pine' ? 2.2 * t.s : 3.0 * t.s });
    if (Math.hypot(t.x, t.z) < 42) colliders.add(t.x, t.z, 0.45 * t.s, 'trunk');
  }

  // broken stone circle (gap to the south for the entrance)
  const ringR = 19.5;
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + 0.18;
    const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
    if (z > 15 && Math.abs(x) < 6) continue;
    const fallen = i === 3 || i === 8;
    const broken = !fallen && (i === 1 || i === 6);
    const h = broken ? range(rng, 1.4, 2.1) : range(rng, 2.8, 4.0);
    const w = range(rng, 1.1, 1.5), d = range(rng, 0.65, 0.9);
    const yaw = -a + Math.PI / 2 + range(rng, -0.2, 0.2);
    stoneGeos.push(buildStandingStone(rng, x, z, { h, w, d, yaw, fallen, broken }));
    if (fallen) {
      const fx = Math.cos(yaw) * 0, fz = 0;
      colliders.add(x + fx, z + fz, 0.95, 'stone');
      const ax = Math.sin(yaw) * (h * 0.33), az = Math.cos(yaw) * (h * 0.33);
      colliders.add(x + ax, z + az, 0.8, 'stone');
      colliders.add(x - ax, z - az, 0.8, 'stone');
    } else {
      colliders.add(x, z, Math.max(w, d) * 0.62, 'stone');
    }
  }

  // boulders: some framing the arena edge, many in the woods
  for (let i = 0; i < 34; i++) {
    const a = rng() * TAU;
    const edge = i < 7;
    const r = edge ? range(rng, 27.5, 31.5) : range(rng, 33, 70);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!open(x, z) || (edge && z > 20 && Math.abs(x) < 8)) continue;
    const size = edge ? range(rng, 0.9, 1.6) : range(rng, 0.7, 2.0);
    stoneGeos.push(buildBoulder(rng, x, z, size));
    if (r < 42) colliders.add(x, z, size * 0.85, 'boulder');
  }

  // flagstones around the centre (walkable)
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 1;
    const w = range(rng, 0.8, 1.6), d = range(rng, 0.6, 1.3);
    stoneGeos.push(buildFlagstone(rng, x, z, w, d, rng() * TAU));
    bare.push({ x, z, r: Math.max(w, d) * 0.6 });
  }

  // the nest: bones to the north
  const nest = { x: -3, z: -15.5 };
  stoneGeos.push(...buildBones(rng, nest.x, nest.z));
  bare.push({ x: nest.x, z: nest.z, r: 3.2 });

  // bonfire at the southern entrance
  const bf = W.bonfire;
  stoneGeos.push(...buildBonfire(rng, bf.x, bf.z));
  colliders.add(bf.x, bf.z, 0.75, 'bonfire');
  bare.push({ x: bf.x, z: bf.z, r: 1.6 });

  const mat = createAsciiObjectMaterial(U, { fadeNearPlayer: true, side: THREE.DoubleSide });
  const treeMesh = new THREE.Mesh(mergeGeometries(treeGeos), mat);
  treeMesh.name = 'trees';
  const stoneMesh = new THREE.Mesh(mergeGeometries(stoneGeos), mat);
  stoneMesh.name = 'stones';
  group.add(treeMesh, stoneMesh);
  markCaster(group);

  return { group, treeSpots, bare, nest, bonfire: { x: bf.x, z: bf.z }, material: mat };
}
