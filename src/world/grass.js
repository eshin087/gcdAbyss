import * as THREE from 'three';
import { fbm2 } from '../core/rng.js';

// The meadow is drawn by the screen-space ASCII pass (pipeline.js): every character cell over the
// ground picks a grass glyph from this density field + wind / trample / gust / scorch, so the grass
// reads as true terminal text like the trees. This module only bakes the field into a texture:
//   R = grass density (0 bare … 1 lush), G = tallness variation (0 short tufts … 1 tall blades)

/**
 * Dense in the clearing, thinner under the forest, none on stones / bare spots.
 * bare: [{x, z, r}] circles with no grass (flagstones, bonfire ash, nest dirt).
 */
export function createMeadow(colliders, treeSpots, bare = [], extent = 150, res = 0.5) {
  const N = Math.ceil(extent / res);
  const half = extent / 2;
  const grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) * res;
      const z = -half + (j + 0.5) * res;
      const r = Math.hypot(x, z);
      const d = r > 74 ? 0 : r < 29 ? 1 : r < 35 ? 1 - ((r - 29) / 6) * 0.5 : 0.5 * (1 - Math.max(0, (r - 60) / 14));
      grid[j * N + i] = d * (0.6 + 0.4 * fbm2(x * 0.09 + 3.1, z * 0.09 - 1.7));
    }
  }
  const stamp = (cx, cz, radius, fn) => {
    const i0 = Math.max(0, Math.floor((cx - radius + half) / res));
    const i1 = Math.min(N - 1, Math.floor((cx + radius + half) / res));
    const j0 = Math.max(0, Math.floor((cz - radius + half) / res));
    const j1 = Math.min(N - 1, Math.floor((cz + radius + half) / res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * res, z = -half + (j + 0.5) * res;
        const dd = Math.hypot(x - cx, z - cz);
        if (dd <= radius) grid[j * N + i] *= fn(dd);
      }
    }
  };
  for (const c of colliders.circles) stamp(c.x, c.z, c.r + 0.8, (dd) => (dd < c.r + 0.1 ? 0 : 0.45));
  for (const t of treeSpots) stamp(t.x, t.z, t.r, (dd) => 0.55 + 0.45 * (dd / t.r));
  for (const b of bare) stamp(b.x, b.z, b.r, (dd) => Math.min(1, Math.max(0, (dd - b.r * 0.75) / (b.r * 0.25))));

  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = -half + (i + 0.5) * res, z = -half + (j + 0.5) * res;
      data[k * 4] = Math.round(Math.min(1, grid[k]) * 255);
      data[k * 4 + 1] = Math.round(fbm2(x * 0.06 - 7.3, z * 0.06 + 2.2) * 255);
      data[k * 4 + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return {
    texture,
    bounds: new THREE.Vector4(-half, -half, extent, 0),
    density(x, z) {
      const i = Math.floor((x + half) / res), j = Math.floor((z + half) / res);
      return i < 0 || j < 0 || i >= N || j >= N ? 0 : grid[j * N + i];
    },
  };
}
