import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG, createAsciiObjectMaterial, createCarvedGlyphMaterial } from '../render/materials.js';
import { markCaster } from '../render/pipeline.js';
import { GlyphParticles } from '../render/particles.js';
import { mulberry32, range, fbm2 } from '../core/rng.js';
import { CONFIG } from '../core/config.js';
import { TAU } from '../core/math.js';
import {
  prep, lumpy, paint, carve, slabGeometry, mul, STONE_LOOK, SLAB_LOOK,
  buildDeadTree, buildBoulder, buildFlagstone, buildBonfire,
} from './forest.js';

// The Obsidian Throne Hall (the Starless Lord's level; owner's pick "A" of three rendered arenas,
// 2026-11-13). South to north (the player walks north, -z): the bonfire, a path of flagstones through
// dead trees, the door in the south wall, then the hall: a floor of great black tiles with a red seal
// inlaid at its centre (the origin: the duel's centre), two rows of square pillars each with a slit of
// red light, braziers, and at the north end a dais of three tiers under the throne's crown of spikes.
// Same output shape as createForest / createCourtyard (world.js reads it), plus
//   sky        the hall's own night: world.js writes it into the shared uniforms
//   ambience   { setup(game), update(dt, game), flare(k), setVisible(on) }: atmosphere.js runs it instead of the
//              fireflies / mist / leaves: the brazier flames and their lights, red motes, the glowing
//              inlay; flare(k) brightens the seal (the boss calls it as each blade form ignites)
// Everything is drawn through the glyph systems (STYLE.md): carved glyphs for the stone, the screen
// grid for braziers, trees and the bonfire, glyph particles for flames and the inlay.

/** Layout numbers (world metres). The level's CONFIG.world overrides match these (levels/starless.js). */
export const HALL = {
  halfX: 14.3, // the floor: |x| <= halfX
  zN: -21, // ... from here (the wall behind the throne)
  zS: 16, // ... to here (the south wall, the door in it)
  cell: 2.2, // floor tile pitch
  daisZ: -13.5, // the dais's front edge (not walkable beyond it)
  throne: { x: 0, z: -18.6, seatY: 1.27 }, // the seat (he sits here until the hero comes through the door)
  seal: { x: 0, z: 0, r: 6.2 }, // the inlaid seal: the centre of the duel
  pillarX: 10.4,
  pillarZ: [-15.5, -10, -4.5, 1, 6.5, 12],
  doorX: 3.1, // the door: |x| < doorX in the south wall
  bonfire: { x: 0, z: 31 },
};

const SIN_PITCH = Math.sin(CONFIG.camera.pitch);
const OBS = [0.075, 0.078, 0.105]; // obsidian
const IRON = [0.1, 0.085, 0.085];
const edgeBand = (px, py, pz, nx, ny) => (ny > 0.5 && ny < 0.95 ? 1 : 0);
const obs = (k) => (px, py, pz) => mul(OBS, k * (0.72 + 0.5 * fbm2(px * 0.55 + 3, pz * 0.55 + py, 2)));
/** The on-screen angle of a ground direction (dx, dz) at the fixed camera (north up). */
const groundRot = (dx, dz) => Math.atan2(-dz * SIN_PITCH, dx);

/** A polygon slab (pts round its own centre), tilted a little, carved. */
function slab(rng, pts, x, z, { top = 0.04, inset = 0.06, drop = 0.04, tilt = 0.015, col }) {
  const g = slabGeometry(pts, { top, inset, drop });
  if (tilt) {
    const ax = new THREE.Vector3(range(rng, -1, 1), 0, range(rng, -1, 1) + 1e-3).normalize();
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(ax, range(rng, 0.2, 1) * tilt));
  }
  g.translate(x, 0, z);
  carve(g, { col, ao: 0.85, edge: edgeBand });
  let r = 0;
  for (const [px, pz] of pts) r = Math.max(r, Math.hypot(px, pz));
  return { geo: g, outline: pts.map(([px, pz]) => [x + px, z + pz]), r };
}

/** A box with its base at y, carved. */
function box(w, h, d, x, y, z, { col, seg = 1 }) {
  const g = prep(new THREE.BoxGeometry(w, h, d, 1, seg, 1));
  g.translate(x, y + h / 2, z);
  carve(g, { col, ao: (px, py) => 0.55 + 0.45 * Math.min(1, (py - y) / 1.4) });
  return g;
}

/** A leaning spike: a box tapering to `tip` of its base, leaning `lean` rad toward (sin yaw, cos yaw). */
function spike(rng, x, y, z, { h, w, d = w, tip = 0.1, lean = 0, yaw = 0, col }) {
  const g = prep(new THREE.BoxGeometry(w, h, d, 1, 4, 1));
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = 1 - (1 - tip) * Math.pow(Math.max(0, p.getY(i) / h), 1.2);
    p.setX(i, p.getX(i) * t);
    p.setZ(i, p.getZ(i) * t);
  }
  lumpy(g, 0.04, 1.3, rng() * 99, new THREE.Vector3(0, h / 2, 0));
  g.rotateX(lean);
  g.rotateY(yaw);
  g.translate(x, y, z);
  carve(g, { col, ao: (px, py) => 0.5 + 0.5 * Math.min(1, (py - y) / 1.5) });
  return g;
}

const acc = (o, key, dt, rate, fn) => {
  o[key] = (o[key] ?? 0) + dt * rate;
  while (o[key] >= 1) {
    o[key] -= 1;
    fn();
  }
};

export function createThroneHall(U, colliders) {
  const rng = mulberry32(CONFIG.seed + 211);
  const H = HALL, S = H.seal, T = H.throne, BF = H.bonfire;
  const stoneGeos = [], slabGeos = [], propGeos = [], treeGeos = [], slabs = [], bare = [], treeSpots = [];
  /** the glowing inlay and slits: { x, y, z, glyph, size, color, rot, flicker, seal } */
  const glow = [];
  const braziers = [];

  // ---- the floor: great square tiles, the centre runner a shade lighter
  for (let z = H.zN + H.cell / 2; z < H.zS; z += H.cell) {
    for (let x = -H.halfX + H.cell / 2; x < H.halfX; x += H.cell) {
      if (z < H.daisZ && Math.abs(x) < 7.4) continue; // under the dais
      const w = H.cell - 0.08;
      const pts = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
      const s = slab(rng, pts, x, z, { top: 0.035, inset: 0.05, drop: 0.03, tilt: 0.004, col: obs(Math.abs(x) < H.cell ? 1.3 : 1) });
      slabGeos.push(s.geo);
      slabs.push({ x, z, r: s.r, outline: s.outline });
    }
  }

  // ---- the dais: three tiers up to the throne (not walkable: a row of colliders along its edge)
  for (const [hx, z0, top] of [[7.2, H.daisZ, 0.16], [5.6, H.daisZ - 1.3, 0.34], [4.0, H.daisZ - 2.6, 0.52]]) {
    const zc = (z0 + H.zN) / 2, hd = (z0 - H.zN) / 2;
    slabGeos.push(slab(rng, [[-hx, -hd], [hx, -hd], [hx, hd], [-hx, hd]], 0, zc, { top, inset: 0.09, drop: 0.06, tilt: 0, col: obs(1.5) }).geo);
  }
  for (let x = -7; x <= 7; x += 1.4) colliders.add(x, H.daisZ - 0.75, 0.75, 'stone');
  for (const sx of [-1, 1]) for (let z = H.daisZ - 2; z > H.zN; z -= 1.4) colliders.add(sx * 7, z, 0.75, 'stone');

  // ---- the throne: a seat under a crown of black spikes
  const dark = obs(1.55);
  stoneGeos.push(box(1.7, 0.75, 1.4, T.x, 0.52, T.z + 0.5, { col: dark }));
  for (const sx of [-1, 1]) stoneGeos.push(box(0.34, 0.5, 1.3, T.x + sx * 1.02, 1.27, T.z + 0.5, { col: dark }));
  stoneGeos.push(spike(rng, T.x, 0.52, T.z - 0.45, { h: 6.4, w: 1.9, d: 0.5, tip: 0.12, lean: -0.06, col: dark }));
  for (const sx of [-1, 1]) {
    stoneGeos.push(spike(rng, T.x + sx * 1.25, 0.52, T.z - 0.5, { h: 4.6, w: 0.9, d: 0.45, tip: 0.08, lean: 0.3, yaw: (sx * Math.PI) / 2, col: dark }));
    stoneGeos.push(spike(rng, T.x + sx * 2.15, 0.52, T.z - 0.4, { h: 3.1, w: 0.7, d: 0.4, tip: 0.08, lean: 0.52, yaw: (sx * Math.PI) / 2, col: dark }));
  }

  // ---- two rows of square pillars, a slit of red light down each inner face
  for (const sx of [-1, 1]) {
    for (const z of H.pillarZ) {
      const x = sx * H.pillarX;
      stoneGeos.push(box(1.75, 0.36, 1.75, x, 0, z, { col: obs(1.5) }));
      stoneGeos.push(box(1.18, 5.2, 1.18, x, 0.36, z, { col: obs(1.35), seg: 5 }));
      stoneGeos.push(box(1.65, 0.42, 1.65, x, 5.56, z, { col: obs(1.6) }));
      colliders.add(x, z, 0.98, 'stone');
      for (let y = 1.0; y <= 4.7; y += 0.52) glow.push({ x: x - sx * 0.66, y, z: z + 0.05, glyph: '|', size: 0.5, color: [2.3, 0.11, 0.07], flicker: 0.12 });
    }
  }

  // ---- the walls: long blocks east and west, the tall north wall with three red windows, the south
  // wall with its door
  const wallX = H.halfX + 1.3;
  for (const sx of [-1, 1]) {
    for (let z = H.zN - 1.6; z < H.zS + 1; z += 3.8) {
      stoneGeos.push(box(1.3, range(rng, 2.7, 3.3), 3.7, sx * wallX, 0, z + 1.9, { col: obs(1.2), seg: 2 }));
    }
    for (let z = H.zN - 1; z < H.zS + 2; z += 1.5) colliders.add(sx * wallX, z, 0.95, 'stone');
  }
  const northZ = H.zN - 1.5;
  for (let x = -wallX; x < wallX; x += 3.7) {
    const mid = Math.abs(x + 1.85) < 5.6;
    stoneGeos.push(box(3.6, mid ? range(rng, 6.2, 7) : range(rng, 3.6, 4.4), 1.3, x + 1.85, 0, northZ, { col: obs(1.25), seg: 3 }));
  }
  for (let x = -wallX; x <= wallX; x += 1.5) colliders.add(x, northZ, 0.95, 'stone');
  for (const wx of [-3.4, 0, 3.4]) {
    for (let y = 2.6; y <= 5.6; y += 0.5) glow.push({ x: wx, y, z: northZ + 0.75, glyph: '|', size: 0.55, color: [2.6, 0.12, 0.08], flicker: 0.1 });
  }
  const southZ = H.zS + 1.2;
  for (const sx of [-1, 1]) {
    for (let x = H.doorX + 0.3; x < wallX; x += 3.6) {
      const w = Math.min(3.5, wallX - x + 0.6);
      stoneGeos.push(box(w, range(rng, 2.6, 3.1), 1.3, sx * (x + w / 2), 0, southZ, { col: obs(1.2), seg: 2 }));
    }
    for (let x = H.doorX + 0.5; x <= wallX; x += 1.5) colliders.add(sx * x, southZ, 0.95, 'stone');
    stoneGeos.push(box(1.3, 4.8, 1.5, sx * H.doorX, 0, southZ, { col: obs(1.5), seg: 4 }));
    colliders.add(sx * H.doorX, southZ, 0.95, 'stone');
  }

  // ---- braziers: four down the hall behind the line of the pillars' inner faces, two by the throne
  for (const [bx, bz] of [[-8.9, -7.2], [8.9, -7.2], [-8.9, 9.2], [8.9, 9.2], [-3.7, H.daisZ - 1.9], [3.7, H.daisZ - 1.9]]) {
    const y0 = bz < H.daisZ ? 0.34 : 0;
    const post = prep(new THREE.CylinderGeometry(0.1, 0.16, 1.15, 5));
    post.translate(bx, y0 + 0.58, bz);
    const bowl = prep(new THREE.CylinderGeometry(0.52, 0.26, 0.36, 8, 1));
    bowl.translate(bx, y0 + 1.3, bz);
    for (const g of [post, bowl]) {
      paint(g, { col: IRON, flag: FLAG.STONE, ao: 0.9 });
      propGeos.push(g);
    }
    colliders.add(bx, bz, 0.45, 'stone');
    braziers.push({ x: bx, y: y0 + 1.5, z: bz });
  }

  // ---- the seal in the floor and the lines down the runner (glowing inlay)
  const ring = (r, n, glyphs, size, col) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      glow.push({ x: S.x + Math.cos(a) * r, y: 0.08, z: S.z + Math.sin(a) * r, glyph: glyphs[i % glyphs.length], size, color: col, rot: groundRot(-Math.sin(a), Math.cos(a)), flicker: 0.18, seal: true });
    }
  };
  ring(S.r, 128, '-', 0.74, [1.7, 0.11, 0.07]);
  ring(S.r - 0.42, 128, '-', 0.5, [0.9, 0.06, 0.04]);
  ring(S.r - 1.05, 30, 'X+ZTHKY7', 0.5, [1.25, 0.09, 0.055]);
  ring(4.3, 92, '-', 0.66, [1.5, 0.1, 0.065]);
  ring(1.6, 36, '-', 0.6, [1.6, 0.11, 0.07]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    for (let r = 1.85; r < 4.2; r += 0.3) {
      glow.push({ x: S.x + Math.cos(a) * r, y: 0.08, z: S.z + Math.sin(a) * r, glyph: '-', size: 0.62, color: [1.25, 0.085, 0.055], rot: groundRot(Math.cos(a), Math.sin(a)), flicker: 0.18, seal: true });
    }
  }
  for (const sx of [-1, 1]) {
    for (let z = H.zS - 0.6; z > H.daisZ + 0.6; z -= 0.95) {
      if (Math.hypot(sx * 1.1 - S.x, z - S.z) < S.r + 0.5) continue;
      glow.push({ x: sx * 1.1, y: 0.08, z, glyph: '|', size: 0.4, color: [0.85, 0.06, 0.045], flicker: 0.1 });
    }
  }

  // ---- outside: the path up from the bonfire, dead trees and boulders in the dark
  for (let z = southZ + 1.6; z < BF.z - 1.6; z += range(rng, 0.9, 1.3)) {
    const x = range(rng, -0.9, 0.9), w = range(rng, 0.9, 1.5), d = range(rng, 0.7, 1.2);
    const s = buildFlagstone(rng, x, z, w, d, rng() * TAU);
    slabGeos.push(s.geo);
    slabs.push({ x, z, r: Math.max(w, d) * 0.65, outline: s.outline });
  }
  propGeos.push(...buildBonfire(rng, BF.x, BF.z));
  colliders.add(BF.x, BF.z, 0.75, 'bonfire');
  bare.push({ x: BF.x, z: BF.z, r: 2.4 });
  const outside = (x, z) => !(Math.abs(x) < wallX + 3 && z > northZ - 3 && z < southZ + 2.5) && !(z > southZ && z < BF.z + 4 && Math.abs(x) < 4.4);
  for (let i = 0, n = 0; i < 6000 && n < 150; i++) {
    const a = rng() * TAU, r = 20 + Math.pow(rng(), 1.3) * 46;
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 4;
    if (!outside(x, z) || treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 3.6)) continue;
    const s = range(rng, 0.85, 1.4);
    treeGeos.push(...buildDeadTree(rng, x, z, s));
    treeSpots.push({ x, z, r: 2.4 * s });
    if (r < 46) colliders.add(x, z, 0.42 * s, 'trunk');
    n++;
  }
  for (let i = 0; i < 18; i++) {
    const a = rng() * TAU, r = range(rng, 22, 50);
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 4;
    if (!outside(x, z)) continue;
    const size = range(rng, 0.7, 1.6);
    stoneGeos.push(buildBoulder(rng, x, z, size));
    colliders.add(x, z, size * 0.85, 'boulder');
  }

  // ---- meshes
  const group = new THREE.Group();
  group.name = 'throneHall';
  const mat = createAsciiObjectMaterial(U, { fadeNearPlayer: true, side: THREE.DoubleSide });
  const pitch = CONFIG.camera.pitch;
  const stoneMat = createCarvedGlyphMaterial(U, {
    ...STONE_LOOK, gain: 3.3, lumScale: 4.6, jitter: 0.36, inkFloor: 0.07, crackAmount: 0.35, mossInk: [0.05, 0.012, 0.014], fadeNearPlayer: true, viewPitch: pitch,
  });
  // a whole floor under the duel must stay calm: sparse, dim glyphs
  const slabMat = createCarvedGlyphMaterial(U, {
    ...SLAB_LOOK, gain: 1.55, lumScale: 2.2, edge: 0.42, inkFloor: 0.03, crackAmount: 0.3, topGlyphs: ['.   ', '. . ', '.:. ', ':.;.', ';:=.', '=;%:'], viewPitch: pitch,
  });
  const add = (geos, m, name) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.name = name;
    group.add(mesh);
  };
  add(treeGeos, mat, 'trees');
  add(propGeos, mat, 'props');
  add(stoneGeos, stoneMat, 'stones');
  add(slabGeos, slabMat, 'paving');
  markCaster(group);

  // ---- the hall's life: flames, lights, motes, the inlay
  const st = { flare: 0, shown: -1 };
  let glowSys = null;
  /** (Re)fill the inlay batch; the seal's glyphs at brightness 1 + 2.2 × flare. */
  const fillGlow = () => {
    if (!glowSys) return;
    glowSys.clear();
    const k = 1 + 2.2 * st.flare;
    for (const g of glow) {
      const c = g.seal ? [g.color[0] * k, g.color[1] * k + 0.25 * st.flare, g.color[2] * k + 0.12 * st.flare] : g.color;
      glowSys.spawn({ x: g.x, y: g.y, z: g.z, life: 1e9, size: g.size, sizeEnd: g.size, glyph: g.glyph, color: c, colorEnd: c, alpha: 1, alphaEnd: 1, rot: g.rot ?? 0, flicker: g.flicker ?? 0 });
    }
    st.shown = st.flare;
  };
  const ambience = {
    setup(game) {
      // the inlay: glyphs that stay where they are, in one additive batch of their own
      glowSys = new GlyphParticles(game.U, { max: glow.length, additive: true });
      game.pipeline?.registerParticles?.(glowSys);
      fillGlow();
      for (const b of braziers) {
        b.light = game.lights?.add?.({ x: b.x, y: b.y + 0.5, z: b.z, color: [1.0, 0.15, 0.07], intensity: 2.5, radius: 11, flicker: 0.5 }) ?? null;
      }
    },
    /** Lab (world.debug.setVisible): the inlay goes with the rest of the set. */
    setVisible(on) {
      if (glowSys?.mesh) glowSys.mesh.visible = !!on;
    },
    /** The seal flares (k 0..1) and settles again over ~1.5 s. */
    flare(k = 1) {
      st.flare = Math.max(st.flare, Math.min(1, Math.max(0, Number(k) || 0)));
    },
    update(dt, game) {
      if (st.flare > 0) st.flare = Math.max(0, st.flare - dt * 0.7);
      if (Math.abs(st.flare - st.shown) > 0.03 || (st.flare === 0 && st.shown !== 0)) fillGlow();
      glowSys?.update(dt, game.time);
      const fx = game.fx?.add;
      if (!fx) return;
      for (const b of braziers) {
        acc(b, 'fire', dt, 24, () => {
          const a = Math.random() * TAU, r = Math.random() * 0.3, hot = Math.random();
          fx.spawn({
            x: b.x + Math.cos(a) * r, y: b.y + Math.random() * 0.12, z: b.z + Math.sin(a) * r,
            vx: (Math.random() - 0.5) * 0.25, vy: 1.1 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.25,
            life: 0.4 + Math.random() * 0.5, size: 0.3 + hot * 0.16, sizeEnd: 0.05, glyph: "*^'`\"~%",
            color: [3.4, 0.5 + hot * 0.4, 0.28], colorEnd: [0.8, 0.03, 0.03], alpha: 1, alphaEnd: 0,
            drag: 1.2, flicker: 0.25, spin: (Math.random() - 0.5) * 2,
          });
        });
      }
      // red motes rising slowly through the hall
      const f = game.U.uFocus.value;
      acc(st, 'motes', dt, 9, () => {
        const x = f.x + (Math.random() - 0.5) * 30, z = f.z + (Math.random() - 0.5) * 24 - 3;
        if (Math.abs(x) > H.halfX || z < H.zN || z > H.zS) return;
        fx.spawn({
          x, y: 0.2 + Math.random() * 1.5, z, vx: (Math.random() - 0.5) * 0.15, vy: 0.25 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.15,
          life: 4 + Math.random() * 4, size: 0.11, sizeEnd: 0.04, glyph: ".'·", color: [1.8, 0.16, 0.08], colorEnd: [0.4, 0.02, 0.02],
          alpha: 1, alphaEnd: 0, drag: 0.2, flicker: 0.5,
        });
      });
    },
  };

  return {
    group, treeSpots, bare, slabs, nest: { x: T.x, z: T.z }, bonfire: { x: BF.x, z: BF.z },
    material: mat, stoneMaterial: stoneMat, slabMaterial: slabMat,
    // no grass on the tiles; thin grey tufts in the dark outside
    grass: { ash: 0.7, height: 0.6, density: (x, z) => (outside(x, z) ? 0.14 : 0) },
    sky: { moonColor: [0.2, 0.23, 0.37], ambient: [0.03, 0.021, 0.029], fogColor: [0.007, 0.003, 0.0045], fogNear: 30, fogFar: 60 },
    ambience,
  };
}
