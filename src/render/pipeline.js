import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { FS_VERT } from './shaderLib.js';
import { createGridAtlas, createArtAtlas, createPixelArtAtlas, pixelArtCell, GRID_COLS, GRID_ROW } from './glyphs.js';

// Frame pipeline:
//   1. moon shadow map  (casters = objects on LAYER_CASTER)
//   2. world -> sceneRT (HDR colour, alpha = ASCII flag, + depth texture)
//   3. ASCII pass: flagged pixels become a screen-space character grid  -> compRT
//   4. FX pass: glyph particles, soft depth-tested against sceneRT depth   -> compRT
//   5. bloom + tone map + grade + vignette + feedback overlays             -> screen

export const LAYER_CASTER = 1;
/** Make an object (and children) cast moon shadows. */
export function markCaster(obj) {
  obj.traverse((o) => o.layers.enable(LAYER_CASTER));
  return obj;
}

class FullscreenPass {
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(g);
    this.mesh.frustumCulled = false;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
  }
}

export class Pipeline {
  constructor(renderer, scene, fxScene, camera, U) {
    this.renderer = renderer;
    this.scene = scene;
    this.fxScene = fxScene;
    this.camera = camera;
    this.U = U;
    this.fs = new FullscreenPass();
    this.fxParticleMaterials = [];

    const canHalf = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const type = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = (opts = {}) =>
      new THREE.WebGLRenderTarget(1, 1, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts });

    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.compRT = rt();
    this.brightRT = rt();
    this.blur = [rt(), rt(), rt(), rt()];

    // --- shadows
    const S = CONFIG.render.shadowSize;
    this.shadowRT = new THREE.WebGLRenderTarget(S, S, {
      depthTexture: new THREE.DepthTexture(S, S),
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const E = CONFIG.render.shadowExtent;
    this.shadowCam = new THREE.OrthographicCamera(-E, E, E, -E, 1, 320);
    this.shadowCam.layers.set(LAYER_CASTER);
    this.shadowMat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    this.shadowBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    U.uShadowMap.value = this.shadowRT.depthTexture;
    this.shadowCenter = new THREE.Vector3();

    // --- ASCII grid pass (see FLAG in materials.js and GRID_ROW in glyphs.js)
    this.cell = new THREE.Vector2(7, 12);
    this.grid = null;
    // finer character grid for the hero / wyrm ASCII art (FLAG.ART), owner's choice: ~5x8 px letters
    this.artCell = new THREE.Vector2(4, 7);
    this.art = null;
    // the hero's own, finer grid: 3x5 pixel-font letters in 4x6 cells (x2 from 2160 px tall), so he
    // gets ~1.5x the rows of the wyrm's letters at the game camera
    this.heroCell = new THREE.Vector2(4, 6);
    this.heroArt = null;
    this.asciiMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tDepth: { value: this.sceneRT.depthTexture },
        tGrid: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCell: { value: this.cell },
        uGridCols: { value: GRID_COLS },
        uGridRows: { value: Object.keys(GRID_ROW).length },
        uGain: { value: 2.4 },
        uBg: { value: 0.16 },
        uLumMap: { value: 13.0 },
        uCreatureGain: { value: 1.8 },
        uCreatureLum: { value: 3.0 },
        uCreatureBg: { value: 0.04 }, // dark cell backing: bright inks must not fill their cells
        uInvViewProj: { value: new THREE.Matrix4() },
        uNear: { value: 1 },
        uFar: { value: 200 },
        tArt: { value: null },
        uArtCell: { value: this.artCell },
        uArtCount: { value: 22 },
        tHeroArt: { value: null },
        uHeroCell: { value: this.heroCell },
        uHeroCount: { value: 22 },
        // per creature kind: x = hero (FLAG.ART_HERO), y = wyrm / other (FLAG.ART)
        // hero: his source (key-lit, U.uArtHeroKey) sits around luma 0.15–0.45 in moonlight and by the
        // fire alike; black point + gentle curve spread it over the whole ramp, dim to dense
        uArtLum: { value: new THREE.Vector2(3.0, 4.5) }, // brightness -> ramp position: 1 - exp(-luma * k)
        uArtBlack: { value: new THREE.Vector2(0.04, 0.0) }, // source luma treated as black (contrast)
        uArtMin: { value: new THREE.Vector2(0.14, 0.3) }, // glyph value at the dark end of the ramp
        uArtMax: { value: 0.8 }, // glyph value at the bright end (tone-maps to white without bloom haloes)
        uArtDither: { value: new THREE.Vector2(1.1, 1.6) }, // per-cell ramp jitter (letters): variety
        // relative depth jump inside a cell that marks a part boundary (arm over coat, leg over leg):
        // such cells go black, the reference images' dark gaps between parts (0 = off). The hero's is
        // low (0.004 = 0.14 m at the 36 m camera, ~1 letter of depth), or no gap ever opens in game.
        uArtEdge: { value: new THREE.Vector2(0.004, 0.0) },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tDepth;
        uniform sampler2D tGrid;
        uniform vec2 uRes;
        uniform vec2 uCell;
        uniform float uGridCols;
        uniform float uGridRows;
        uniform float uGain;
        uniform float uBg;
        uniform float uLumMap;
        uniform float uCreatureGain;
        uniform float uCreatureLum;
        uniform float uCreatureBg;
        uniform mat4 uInvViewProj;
        uniform float uNear;
        uniform float uFar;
        uniform sampler2D tArt;
        uniform vec2 uArtCell;
        uniform float uArtCount;
        uniform sampler2D tHeroArt;
        uniform vec2 uHeroCell;
        uniform float uHeroCount;
        uniform vec2 uArtLum;
        uniform vec2 uArtBlack;
        uniform vec2 uArtMin;
        uniform float uArtMax;
        uniform vec2 uArtDither;
        uniform vec2 uArtEdge;
        varying vec2 vUv;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        // glyph mask from the pixel-exact grid atlas (row 0 at the top of the canvas)
        float glyphAt(float row, float col, vec2 local) {
          vec2 auv = vec2((col + local.x) / uGridCols, (uGridRows - 1.0 - row + local.y) / uGridRows);
          return texture2D(tGrid, auv).a;
        }
        float linDepth(vec2 uv) {
          float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        vec3 worldAt(vec2 uv) {
          float d = texture2D(tDepth, uv).r;
          vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return w.xyz / w.w;
        }
        bool isStone(float a) { return a > 0.8; }

        // ---- stone: luminance ramp + outline glyphs on silhouettes and depth steps
        vec3 stoneCell(vec4 c, vec2 cell, vec2 local) {
          vec2 cuv = (cell + 0.5) * uCell / uRes;
          vec2 dx = vec2(uCell.x, 0.0) / uRes, dy = vec2(0.0, uCell.y) / uRes;
          float sL = isStone(texture2D(tScene, cuv - dx).a) ? 1.0 : 0.0;
          float sR = isStone(texture2D(tScene, cuv + dx).a) ? 1.0 : 0.0;
          float sD = isStone(texture2D(tScene, cuv - dy).a) ? 1.0 : 0.0;
          float sU = isStone(texture2D(tScene, cuv + dy).a) ? 1.0 : 0.0;
          float dC = linDepth(cuv);
          float jx = (linDepth(cuv + dx) - linDepth(cuv - dx)) / dC;
          float jy = (linDepth(cuv + dy) - linDepth(cuv - dy)) / dC;
          float gx = (sR - sL) + clamp(jx * 6.0, -1.0, 1.0) * step(0.035, abs(jx));
          float gy = (sU - sD) + clamp(jy * 6.0, -1.0, 1.0) * step(0.035, abs(jy));
          float h = hash12(cell);
          float lum = luma(c.rgb);
          // outline only stones that stand above the ground (flagstones stay pure texture)
          bool raised = worldAt(cuv).y > 0.22;
          if (raised && abs(gx) + abs(gy) > 0.9) {
            float orient = abs(gx) > 2.0 * abs(gy) ? 0.0 : abs(gy) > 2.0 * abs(gx) ? 1.0 : (gx * gy > 0.0 ? 3.0 : 2.0);
            float m = glyphAt(7.0, orient * 4.0 + floor(h * 4.0), local);
            return mix(c.rgb * uBg, c.rgb * uGain * 1.35 + vec3(0.01), m);
          }
          float l = 1.0 - exp(-lum * uLumMap);
          float level = clamp(floor(l * 14.0), 0.0, 13.0);
          float m = glyphAt(0.0, level * 4.0 + floor(h * 4.0), local);
          return mix(c.rgb * uBg, c.rgb * uGain, m);
        }

        // ---- creature: glyph oriented along the encoded surface flow
        vec3 creatureCell(vec4 c, vec2 cell, vec2 local) {
          float code = clamp(floor((c.a - 0.04) / 0.4 * 96.0), 0.0, 95.0);
          float set = floor(code / 24.0);
          float ang = (code - set * 24.0) / 24.0 * 6.2831853;
          float l = 1.0 - exp(-luma(c.rgb) * uCreatureLum);
          float m;
          if (set > 2.5) {
            float level = clamp(floor(l * 14.0), 1.0, 13.0);
            m = glyphAt(6.0, level * 4.0 + floor(hash12(cell) * 4.0), local);
          } else {
            float level = clamp(floor(l * 7.0), 1.0, 6.0);
            float dir = mod(floor(ang / 0.7853982 + 0.5), 8.0);
            m = glyphAt(3.0 + set, level * 8.0 + dir, local);
          }
          return mix(c.rgb * uCreatureBg, c.rgb * uCreatureGain, m);
        }

        bool isArt(float a) { return a > 0.46 && a < 0.55; }
        bool isHero(float a) { return a > 0.46 && a < 0.49; } // FLAG.ART_HERO = 0.48, FLAG.ART = 0.5

        // ---- ASCII art (hero / wyrm): the creature's crisp render is the source image of a fine grid.
        // Each cell averages 4 samples; a letter from the density-sorted ART_CHARS ramp is picked by
        // brightness (plus per-cell jitter for the images' letter variety) and keeps the source hue
        // (white scales, orange lava, red wings, cyan blade) on a black backing.
        vec3 artCell(vec3 c, vec2 acell, vec2 local, float hero) {
          float lum = max(luma(c) - mix(uArtBlack.y, uArtBlack.x, hero), 0.0);
          float v = 1.0 - exp(-lum * mix(uArtLum.y, uArtLum.x, hero));
          float jit = (hash12(acell * 1.37 + 11.0) - 0.5) * mix(uArtDither.y, uArtDither.x, hero);
          float n = hero > 0.5 ? uHeroCount : uArtCount;
          float idx = clamp(floor(v * (n - 1.0) + 0.5 + jit), 1.0, n - 1.0);
          vec2 auv = vec2((idx + local.x) / n, local.y);
          float m = hero > 0.5 ? texture2D(tHeroArt, auv).a : texture2D(tArt, auv).a;
          float mx = max(max(c.r, c.g), c.b);
          vec3 hue = c / max(mx, 1e-4);
          // saturated emissive parts (lava, the cyan blade, eyes) stay HDR so they bloom; bright but
          // colourless parts (claws, teeth) don't, or they swell into glowing orbs
          float sat = (mx - min(min(c.r, c.g), c.b)) / max(mx, 1e-4);
          vec3 fg = hue * mix(mix(uArtMin.y, uArtMin.x, hero), uArtMax, v) * mix(1.0, max(1.0, mx), smoothstep(0.25, 0.6, sat));
          return fg * m;
        }

        void main() {
          vec2 px = gl_FragCoord.xy;
          // the hero first: his own pixel-font grid
          vec2 hcell = floor(px / uHeroCell);
          vec2 hbase = hcell * uHeroCell;
          vec3 hsum = vec3(0.0);
          float hhits = 0.0, hmin = 1e9, hmax = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i == 1 || i == 3 ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25);
            vec2 suv = (hbase + o * uHeroCell) / uRes;
            vec4 sa = texture2D(tScene, suv);
            if (isHero(sa.a)) {
              hsum += sa.rgb;
              hhits += 1.0;
              float dz = linDepth(suv);
              hmin = min(hmin, dz);
              hmax = max(hmax, dz);
            }
          }
          if (hhits >= 2.0) {
            if (uArtEdge.x > 0.0 && (hmax - hmin) > uArtEdge.x * hmin) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // part boundary: a dark gap, like the references
              return;
            }
            gl_FragColor = vec4(artCell(hsum / hhits, hcell, (px - hbase) / uHeroCell, 1.0), 1.0);
            return;
          }
          // the wyrm (other creatures): the art grid
          vec2 acell = floor(px / uArtCell);
          vec2 abase = acell * uArtCell;
          vec3 asum = vec3(0.0);
          float ahits = 0.0, dmin = 1e9, dmax = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i == 1 || i == 3 ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25);
            vec2 suv = (abase + o * uArtCell) / uRes;
            vec4 sa = texture2D(tScene, suv);
            if (isArt(sa.a) && !isHero(sa.a)) {
              asum += sa.rgb;
              ahits += 1.0;
              float dz = linDepth(suv);
              dmin = min(dmin, dz);
              dmax = max(dmax, dz);
            }
          }
          if (ahits >= 2.0) {
            if (uArtEdge.y > 0.0 && (dmax - dmin) > uArtEdge.y * dmin) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }
            gl_FragColor = vec4(artCell(asum / ahits, acell, (px - abase) / uArtCell, 0.0), 1.0);
            return;
          }
          if (isArt(texture2D(tScene, px / uRes).a)) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // creature edge sliver: black, like the images
            return;
          }
          vec2 cell = floor(px / uCell);
          vec2 cuv = (cell + 0.5) * uCell / uRes;
          vec4 c = texture2D(tScene, cuv);
          vec2 local = (px - cell * uCell) / uCell;
          float a = c.a;
          vec3 col;
          if (a < 0.03) {
            col = texture2D(tScene, px / uRes).rgb; // untagged: pass through
          } else if (a < 0.46) {
            col = creatureCell(c, cell, local);
          } else if (isArt(a)) {
            col = texture2D(tScene, px / uRes).rgb; // world cell centred on a creature edge: raw pixel
          } else if (a < 0.8) {
            float l = 1.0 - exp(-luma(c.rgb) * uLumMap);
            float level = clamp(floor(l * 14.0), 0.0, 13.0);
            float m = glyphAt(1.0, level * 4.0 + floor(hash12(cell) * 4.0), local);
            col = mix(c.rgb * uBg, c.rgb * uGain * 0.78, m); // foliage a touch softer than stone
          } else {
            col = stoneCell(c, cell, local);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // --- bloom
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: CONFIG.render.bloomThreshold } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform float uThreshold;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
          c += texture2D(tSrc, vUv + uDir * 1.3846).rgb * 0.316216;
          c += texture2D(tSrc, vUv - uDir * 1.3846).rgb * 0.316216;
          c += texture2D(tSrc, vUv + uDir * 3.2308).rgb * 0.070270;
          c += texture2D(tSrc, vUv - uDir * 3.2308).rgb * 0.070270;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // --- final grade
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tComp: { value: this.compRT.texture },
        tBloomA: { value: this.blur[1].texture },
        tBloomB: { value: this.blur[3].texture },
        uBloom: { value: CONFIG.render.bloomStrength },
        uExposure: { value: CONFIG.render.exposure },
        uTime: U.uTime,
        uAspect: { value: 1 },
        uHurt: { value: 0 }, // red edge flash 0..1
        uFade: { value: 0 }, // fade to black 0..1
        uDesat: { value: 0 }, // death desaturation 0..1
        uWarm: { value: 0 }, // boss-fight warm grade 0..1
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tComp;
        uniform sampler2D tBloomA;
        uniform sampler2D tBloomB;
        uniform float uBloom;
        uniform float uExposure;
        uniform float uTime;
        uniform float uAspect;
        uniform float uHurt;
        uniform float uFade;
        uniform float uDesat;
        uniform float uWarm;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        void main() {
          vec3 col = texture2D(tComp, vUv).rgb;
          vec3 bloom = texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.9;
          col += bloom * uBloom;
          col *= uExposure;
          col = aces(col);
          // cool shadows / slightly warm highlights
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, col * vec3(0.92, 0.98, 1.08), (1.0 - l) * 0.5);
          col = mix(col, col * vec3(1.06, 0.98, 0.9), uWarm * 0.6);
          col = mix(col, vec3(l), uDesat * 0.85);
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float r = length(q);
          col *= mix(0.45, 1.0, smoothstep(0.95, 0.25, r));
          float edge = smoothstep(0.35, 0.95, r);
          col = mix(col, vec3(0.55, 0.02, 0.01), uHurt * edge * 0.75);
          col *= 1.0 - uFade;
          col = pow(max(col, 0.0), vec3(1.0 / 2.2));
          col += (hash12(gl_FragCoord.xy + fract(uTime * 7.3) * 113.0) - 0.5) * 0.018;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.width = 1;
    this.height = 1;
  }

  /** Camera-dependent uniforms of the ASCII pass (world reconstruction for stone outlines). */
  _updateAsciiCamera() {
    const u = this.asciiMat.uniforms;
    const cam = this.camera;
    u.uInvViewProj.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
  }

  registerParticles(particleSystem) {
    this.fxParticleMaterials.push(particleSystem);
    particleSystem.uniforms.uDepth.value = this.sceneRT.depthTexture;
    this.fxScene.add(particleSystem.mesh);
  }

  setSize(cssW, cssH, dpr) {
    const r = this.renderer;
    r.setPixelRatio(dpr);
    r.setSize(cssW, cssH, false);
    const W = Math.max(1, Math.floor(cssW * dpr));
    const H = Math.max(1, Math.floor(cssH * dpr));
    this.width = W;
    this.height = H;
    this.sceneRT.setSize(W, H);
    this.compRT.setSize(W, H);
    this.brightRT.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.blur[0].setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.blur[1].setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.blur[2].setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    this.blur[3].setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    this.U.uResolution.value.set(W, H);
    this.asciiMat.uniforms.uRes.value.set(W, H);
    this.finalMat.uniforms.uAspect.value = W / H;

    // character cell scales with vertical resolution (terminal-sized glyphs at 1080p)
    const cellH = Math.max(9, Math.min(24, Math.round(H / 90)));
    const cellW = Math.max(5, Math.round(cellH * 0.6));
    if (!this.grid || cellW !== this.cell.x || cellH !== this.cell.y) {
      this.grid?.texture.dispose();
      this.cell.set(cellW, cellH);
      this.grid = createGridAtlas(cellW, cellH);
      this.asciiMat.uniforms.tGrid.value = this.grid.texture;
    }
    // creature ASCII art: ~2/3 of the world cell (owner: "smaller letters" so the hero gets rows)
    const artH = Math.max(7, Math.round(H / 135));
    const artW = Math.max(4, Math.round(artH * 0.6));
    if (!this.art || artW !== this.artCell.x || artH !== this.artCell.y) {
      this.art?.texture.dispose();
      this.artCell.set(artW, artH);
      this.art = createArtAtlas(artW, artH);
      this.asciiMat.uniforms.tArt.value = this.art.texture;
      this.asciiMat.uniforms.uArtCount.value = this.art.count;
    }
    const hs = Math.max(1, Math.floor(H / 1080));
    const [heroW, heroH] = pixelArtCell(hs);
    if (!this.heroArt || heroW !== this.heroCell.x || heroH !== this.heroCell.y) {
      this.heroArt?.texture.dispose();
      this.heroCell.set(heroW, heroH);
      this.heroArt = createPixelArtAtlas(hs);
      this.asciiMat.uniforms.tHeroArt.value = this.heroArt.texture;
      this.asciiMat.uniforms.uHeroCount.value = this.heroArt.count;
    }
  }

  updateShadowCamera(center) {
    const E = CONFIG.render.shadowExtent;
    const dir = this.U.uMoonDir.value;
    // snap to texel grid to avoid shimmering when the center moves
    const texel = (2 * E) / CONFIG.render.shadowSize;
    this.shadowCenter.set(Math.round(center.x / texel) * texel, 0, Math.round(center.z / texel) * texel);
    this.shadowCam.position.copy(this.shadowCenter).addScaledVector(dir, 160);
    this.shadowCam.lookAt(this.shadowCenter);
    this.shadowCam.updateMatrixWorld();
    this.U.uShadowMatrix.value
      .copy(this.shadowBias)
      .multiply(this.shadowCam.projectionMatrix)
      .multiply(this.shadowCam.matrixWorldInverse);
  }

  render() {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;

    // 1. shadows
    this.scene.overrideMaterial = this.shadowMat;
    r.setRenderTarget(this.shadowRT);
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(this.scene, this.shadowCam);
    this.scene.overrideMaterial = null;

    // 2. world
    const fog = this.U.uFogColor.value;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(fog, 0);
    r.clear();
    r.render(this.scene, this.camera);

    // 3. ASCII grid
    this._updateAsciiCamera();
    this.fs.render(r, this.asciiMat, this.compRT);

    // 4. FX particles on top (manual soft depth test)
    for (const p of this.fxParticleMaterials) {
      p.uniforms.uNear.value = this.camera.near;
      p.uniforms.uFar.value = this.camera.far;
    }
    r.autoClear = false;
    r.setRenderTarget(this.compRT);
    r.render(this.fxScene, this.camera);
    r.autoClear = prevAutoClear;

    // 5. bloom
    this.brightMat.uniforms.tSrc.value = this.compRT.texture;
    this.fs.render(r, this.brightMat, this.brightRT);
    const blurPass = (src, dst, dx, dy) => {
      this.blurMat.uniforms.tSrc.value = src.texture;
      this.blurMat.uniforms.uDir.value.set(dx / src.width, dy / src.height);
      this.fs.render(r, this.blurMat, dst);
    };
    blurPass(this.brightRT, this.blur[0], 1, 0);
    blurPass(this.blur[0], this.blur[1], 0, 1);
    blurPass(this.blur[1], this.blur[2], 1, 0);
    blurPass(this.blur[2], this.blur[3], 0, 1);

    // 6. final
    this.fs.render(r, this.finalMat, null);
  }
}
