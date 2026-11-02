import * as THREE from 'three';
import { COMMON_GLSL } from '../render/shaderLib.js';
import { gi, gis } from '../render/glyphs.js';
import { mulberry32, pickWeighted, fbm2 } from '../core/rng.js';

// Hundreds of thousands of grass blades, each ONE glyph stroke ( | / \ ' Y V ... ) standing
// on the ground, leaning with the wind, pushed aside by feet, flattened by wing gusts and
// burnt to ash glyphs by dragon fire. Instances are generated in random order, so drawing
// only the first N (quality setting) thins the field evenly.

const BLADES = [
  ['|', 22], ['/', 16], ['\\', 16], ['l', 7], ['!', 3], ['i', 5], ['V', 5], ['Y', 5],
  ['v', 4], ["'", 5], ['(', 2], [')', 2], ['1', 1], ['j', 2], ['t', 1],
];
const FLOWERS = [['o', 4], ['*', 3], ['·', 5], ['°', 2], ['.', 3]];

/**
 * density(x, z) -> 0..1 acceptance, height(x, z, rng) -> blade height in meters.
 */
export function createGrass(U, { count = 260000, extent = 150, density, height, seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const root = new Float32Array(count * 4);
  const data = new Float32Array(count * 4);
  const blades = BLADES.map(([c, w]) => [gi(c), w]);
  const flowers = FLOWERS.map(([c, w]) => [gi(c), w]);
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 12) {
    const x = (rng() - 0.5) * extent;
    const z = (rng() - 0.5) * extent;
    if (rng() > density(x, z)) continue;
    const flower = rng() < 0.028;
    const h = height(x, z, rng);
    root[n * 4] = x;
    root[n * 4 + 1] = z;
    root[n * 4 + 2] = h;
    root[n * 4 + 3] = rng();
    data[n * 4] = flower ? pickWeighted(rng, flowers) : pickWeighted(rng, blades);
    data[n * 4 + 1] = (rng() - 0.5) * 0.55; // in-plane tilt
    data[n * 4 + 2] = rng(); // colour variation
    data[n * 4 + 3] = flower ? 1 : 0;
    n++;
  }

  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('iRoot', new THREE.InstancedBufferAttribute(root, 4));
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = n;

  const burnt = gis(".,'");
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor, uAmbient: U.uAmbient,
      uFogColor: U.uFogColor, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uFocus: U.uFocus,
      uCamPos: U.uCamPos, uPLPos: U.uPLPos, uPLCol: U.uPLCol, uPLRad: U.uPLRad,
      uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel,
      uGlyphAtlas: U.uGlyphAtlas, uScorch: U.uScorch, uScorchBounds: U.uScorchBounds,
      uCamRight: U.uCamRight, uBladeUp: U.uBladeUp, uPushers: U.uPushers, uGust: U.uGust,
      uCullDist: U.uCullDist,
      uBurnt: { value: new THREE.Vector3(...burnt) },
    },
    vertexShader: /* glsl */ `
      ${COMMON_GLSL}
      attribute vec4 iRoot;  // x, z, height, rand
      attribute vec4 iData;  // glyph, tilt, colour var, kind (1 = flower)
      uniform vec3 uCamRight;
      uniform vec3 uBladeUp;
      uniform vec4 uPushers[MAX_PUSH];
      uniform vec4 uGust;
      uniform float uCullDist;
      uniform vec3 uBurnt;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vGlyph;
      void main() {
        vec3 root = vec3(iRoot.x, 0.0, iRoot.y);
        vec2 rel = root.xz - uFocus.xz;
        // cheap cull: outside the visible ellipse around the focus
        if (length(rel * vec2(0.75, 1.0)) > uCullDist) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

        vec2 sc = scorchAt(root.xz);
        float burn = sc.x, heat = sc.y;
        float flower = iData.w;
        float h = iRoot.z * mix(1.0, 0.32, burn);
        float w = h * 0.92; // square-ish quads keep glyphs at their natural proportions
        float baseY = 0.0;
        if (flower > 0.5) {
          w = h = 0.13 + iData.z * 0.09;
          baseY = iRoot.z * 0.55;
          if (burn > 0.3) { w = h = 0.0; }
        }

        float tilt = iData.y;
        vec2 q = vec2(position.x * w, position.y * h);
        q = vec2(cos(tilt) * q.x - sin(tilt) * q.y, sin(tilt) * q.x + cos(tilt) * q.y);
        vec3 wp = root + vec3(0.0, baseY, 0.0) + uCamRight * q.x + uBladeUp * q.y;
        float tip = position.y;

        // wind
        // gentle: big slow swells, small amplitude (a busy, fast sway reads as the ground swimming)
        float wv = sin(uTime * 1.05 + root.x * 0.22 + root.z * 0.14) + 0.35 * sin(uTime * 1.9 + root.x * 0.6 - root.z * 0.4);
        vec3 off = uCamRight * wv * 0.04 * h + vec3(0.0, 0.0, -0.025 * h);
        // trample / pushers (ignore airborne ones: y > 1.5)
        for (int i = 0; i < MAX_PUSH; i++) {
          vec4 P = uPushers[i];
          if (P.w <= 0.0 || P.y > 1.5) continue;
          vec2 d = root.xz - P.xz;
          float dist = length(d);
          if (dist < P.w) {
            float k = 1.0 - dist / P.w;
            vec2 dir = d / max(dist, 1e-3);
            off.xz += dir * k * h * 1.1;
            off.y -= k * h * 0.55;
          }
        }
        // radial gust from wing beats / landings
        if (uGust.z > 0.0) {
          vec2 d = root.xz - uGust.xy;
          float dist = length(d);
          float k = clamp(1.0 - dist / uGust.w, 0.0, 1.0);
          float wave = 0.55 + 0.45 * sin(dist * 0.8 - uTime * 13.0);
          off.xz += (d / max(dist, 1e-3)) * k * wave * uGust.z * h * 1.4;
          off.y -= k * uGust.z * h * 0.3;
        }
        wp += off * tip * tip;

        vec3 rootC = vec3(0.010, 0.018, 0.013);
        // calmer than v0.1: ~20 % darker so the hero and the wyrm stay the brightest things on screen
        vec3 tipC = mix(vec3(0.1, 0.16, 0.072), vec3(0.132, 0.188, 0.08), iData.z);
        tipC = mix(tipC, vec3(0.12, 0.144, 0.104), step(0.82, iData.z));
        vec3 alb = mix(rootC, tipC, tip);
        alb = mix(alb, vec3(0.014, 0.012, 0.011) * (0.6 + tip), burn);
        float sh = shadowAtFast(vec3(root.x, 0.3, root.z));
        vec3 L = uAmbient * 1.6 + uMoonColor * 0.62 * sh + pointLights(root + vec3(0.0, 0.35, 0.0), vec3(0.0, 1.0, 0.0), 1.0);
        vec3 col = alb * L;
        if (flower > 0.5) {
          col = mix(vec3(0.55, 0.58, 0.52), vec3(0.62, 0.56, 0.42), iData.z) * (uAmbient * 4.0 + uMoonColor * 0.9 * sh + pointLights(root + vec3(0.0, 0.4, 0.0), vec3(0.0, 1.0, 0.0), 1.0));
        }
        float flick = 0.6 + 0.4 * sin(uTime * 8.0 + iRoot.w * 60.0);
        col += vec3(1.0, 0.3, 0.05) * heat * heat * tip * 1.6 * flick;
        col = applyFog(col, wp);
        vCol = col;
        vUv = uv;
        vGlyph = iData.x;
        if (burn > 0.55 && flower < 0.5) {
          float r = fract(iRoot.w * 13.1);
          vGlyph = r < 0.4 ? uBurnt.x : r < 0.75 ? uBurnt.y : uBurnt.z;
        }
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGlyphAtlas;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vGlyph;
      void main() {
        vec2 uv = clamp(vUv, 0.03, 0.97);
        float col = mod(vGlyph, 16.0);
        float row = floor(vGlyph / 16.0);
        float m = texture2D(uGlyphAtlas, vec2((col + uv.x) / 16.0, (7.0 - row + uv.y) / 8.0)).a;
        if (m < 0.42) discard;
        gl_FragColor = vec4(vCol * (0.55 + 0.45 * m), 0.0);
      }
    `,
    blending: THREE.NoBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return {
    mesh,
    total: n,
    setCount(c) {
      geo.instanceCount = Math.max(0, Math.min(n, c));
    },
  };
}

/**
 * Default meadow: dense in the clearing, thinner under the forest, none on stones / bare spots.
 * Baked into a 0.5 m grid so per-sample lookups are O(1).
 * bare: [{x, z, r}] circles with no grass (bonfire ash, nest dirt).
 * slabs: [{x, z, r, outline: [[x, z], ...]}] half-sunk flagstones. Grass grows right up to their
 *   edges (blades rooted just outside lean over the slab on screen) and a few blades push up
 *   through the slab near its rim; the middle stays almost bare. Evaluated exactly per sample.
 */
export function meadowDensity(colliders, treeSpots, bare = [], extent = 150, slabs = []) {
  const res = 0.5;
  const N = Math.ceil(extent / res);
  const half = extent / 2;
  const grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) * res;
      const z = -half + (j + 0.5) * res;
      const r = Math.hypot(x, z);
      let d = r > 74 ? 0 : r < 29 ? 1 : r < 35 ? 1 - ((r - 29) / 6) * 0.55 : 0.45 * (1 - Math.max(0, (r - 60) / 14));
      grid[j * N + i] = d * (0.55 + 0.45 * fbm2(x * 0.09 + 3.1, z * 0.09 - 1.7));
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
  for (const c of colliders.circles) {
    // stones and boulders: grass grows up against the rock (their colliders are a little wider
    // than the stone); trunks and the bonfire keep a trodden ring
    if (c.tag === 'stone' || c.tag === 'boulder') stamp(c.x, c.z, c.r + 0.4, (dd) => (dd < c.r * 0.8 ? 0 : 0.7));
    else stamp(c.x, c.z, c.r + 0.8, (dd) => (dd < c.r + 0.1 ? 0 : 0.4));
  }
  for (const t of treeSpots) stamp(t.x, t.z, t.r, (dd) => 0.5 + 0.5 * (dd / t.r));
  for (const b of bare) stamp(b.x, b.z, b.r, (dd) => Math.min(1, Math.max(0, (dd - b.r * 0.75) / (b.r * 0.25))));
  // bounding box of all slabs: most samples skip the exact test
  let sx0 = Infinity, sx1 = -Infinity, sz0 = Infinity, sz1 = -Infinity;
  for (const s of slabs) {
    sx0 = Math.min(sx0, s.x - s.r);
    sx1 = Math.max(sx1, s.x + s.r);
    sz0 = Math.min(sz0, s.z - s.r);
    sz1 = Math.max(sz1, s.z + s.r);
  }
  const slabFactor = (x, z) => {
    if (x < sx0 || x > sx1 || z < sz0 || z > sz1) return 1;
    for (const s of slabs) {
      if (Math.abs(x - s.x) > s.r || Math.abs(z - s.z) > s.r) continue;
      const e = insideDist(s.outline, x, z);
      if (e > 0) return e < 0.1 ? 0.45 : e < 0.22 ? 0.14 : 0.03;
    }
    return 1;
  };
  return (x, z) => {
    const i = Math.floor((x + half) / res), j = Math.floor((z + half) / res);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return grid[j * N + i] * slabFactor(x, z);
  };
}

/** Distance from (x, z) to the nearest edge of polygon `poly` if inside it, else 0. */
function insideDist(poly, x, z) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xj - xi, ez = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - xi - ex * t, z - zi - ez * t));
  }
  return inside ? best : 0;
}

export function meadowHeight(x, z, rng) {
  const r = Math.hypot(x, z);
  const n = fbm2(x * 0.06 - 7.3, z * 0.06 + 2.2);
  const base = r < 30 ? 0.34 + 0.3 * n : 0.26 + 0.22 * n;
  return base * (0.75 + rng() * 0.5);
}
