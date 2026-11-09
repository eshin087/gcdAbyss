import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { FS_VERT, HERO_PARTS } from './shaderLib.js';
import { createGridAtlas, createArtAtlas, createPixelArtAtlas, pixelArtCell, GRID_COLS, GRID_ROW } from './glyphs.js';
import { createWyrmArtAtlas, wyrmArtCell } from './wyrmGlyphs.js';
import { HERO_ART } from './materials.js';

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
        uHeroCount: { value: 22 }, // letters in the hero atlas' top row (sparse → dense)
        uHeroCols: { value: 22 }, // hero atlas columns (row 2 = the ink-line glyphs, PIXEL_LINES)
        // The hero as INK-LINE ART (the owner's reference): bright line glyphs on the cells where his
        // silhouette, a depth step (the nearer side) or a part edge (the higher part, HERO_ART ids)
        // runs, over a dim, dense letter fill.
        // ink: x / y = line brightness in dark / lit cells, z = how much of the part's hue a line keeps
        // (0 = white), w = fill left on the far side of a depth step (the dark gap beside a line)
        uHeroInk: { value: new THREE.Vector4(0.62, 0.9, 0.62, 0.3) },
        // fill: x / y = letter brightness at the dark / lit end, z / w = letter-ramp position there
        uHeroFill: { value: new THREE.Vector4(0.02, 0.36, 0.27, 1.0) },
        // inner lines are dimmer than the silhouette: brightness × x at a depth step, × y at a part edge,
        // × z between pieces of one part
        uHeroLine: { value: new THREE.Vector3(0.9, 0.75, 0.55) },
        // a crease line where a cell is lit brighter than its neighbour (same part): luma > n × x + y
        uHeroCrease: { value: new THREE.Vector2(1.7, 0.035) },
        // distance LOD by view depth (m): x / y = where the far look starts / is complete (the game
        // camera is 24–54 m, phones 14–34 m; the Lab's close-ups 1.5–5 m), z = fill brightness there,
        // w = line brightness there (parts whose ink gain is > 1.5 keep theirs: blade, gem, flask).
        // Far away the creases and piece edges drop out (dithered per cell) and part edges dim.
        uHeroLod: { value: new THREE.Vector4(6.0, 20.0, 2.9, 0.5) },
        // look-dev: 1 = show the hero's raw art source (fill) instead of letters, 2 = only the ink
        // lines, 3 = the ink lines coloured by class (silhouette, depth step, part edge, crease, piece)
        uHeroDebug: { value: 0 },
        // each hero part's ink-line tint (rgb) × gain (a), from HERO_INK (player/model.js)
        uHeroPartInk: U.uHeroPartInk ?? { value: Array.from({ length: HERO_PARTS }, () => new THREE.Vector4(1, 1, 1, 1)) },
        // ... and each part's letter-fill brightness (x) and dotted-edge flag (y)
        uHeroPartFill: U.uHeroPartFill ?? { value: Array.from({ length: HERO_PARTS }, () => new THREE.Vector2(1, 0)) },
        // per creature kind: x = hero (FLAG.ART_HERO), y = wyrm / other (FLAG.ART)
        // hero: uArtLum.x / uArtBlack.x map his flat art fill (HERO_INK) to the light value v that picks
        // his fill letters and brightness (uHeroFill); uArtMin.x is unused since the ink-line pass
        uArtLum: { value: new THREE.Vector2(3.0, 4.5) }, // brightness -> ramp position: 1 - exp(-luma * k)
        uArtBlack: { value: new THREE.Vector2(0.04, 0.0) }, // source luma treated as black (contrast)
        uArtMin: { value: new THREE.Vector2(0.14, 0.3) }, // glyph value at the dark end of the ramp
        uArtMax: { value: 0.8 }, // glyph value at the bright end (tone-maps to white without bloom haloes)
        uArtDither: { value: new THREE.Vector2(2.6, 1.6) }, // per-cell ramp jitter (letters): variety
        // relative depth jump that marks a part boundary (arm over coat, leg over leg). Wyrm (.y): cells
        // spanning it go black (0 = off). Hero (.x): beyond the slope a neighbour predicts, it draws an
        // ink line on the nearer side and a dim gap on the far one (0.004 = 0.14 m at the 36 m camera).
        uArtEdge: { value: new THREE.Vector2(0.004, 0.0) },
        // ---- the wyrm's letters (wyrmCell; thin pixel font from wyrmGlyphs.js). Its .y uniforms above
        // map the source: black point, 1 - exp(-luma * k), min brightness, dither, part-gap depth.
        // x = brightest letter, y = brightness gamma (dim charcoal body, bright rims), z = v below
        // which a cell prints nothing (the black gaps between scales), w = how much each stroke
        // pixel takes its own source pixel instead of the cell average (crisp shapes through text)
        uWyrmTone: { value: new THREE.Vector4(0.95, 1.3, 0.022, 0.85) },
        // glyph pick: x / y = cell value v where the letter set steps dim -> mid -> bright (the cell's
        // hash picks the letter inside its set, so letters hold still while the wyrm moves), z = per-
        // cell dither of those steps (no contour lines), w = samples (of 4) a stroke code needs to
        // turn the cell into a stroke glyph
        uWyrmGlyph: { value: new THREE.Vector4(0.12, 0.42, 0.08, 1) },
        // atlas columns (wyrmGlyphs.js): mid set start, bright set start, stroke start, glyphs in the row
        uWyrmAtlas: { value: new THREE.Vector4(10, 20, 28, 32) },
        uWyrmOutline: { value: 1 }, // 1: silhouette cells draw their edge as a stroke glyph
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
        uniform float uHeroCols;
        uniform vec4 uHeroInk;
        uniform vec4 uHeroFill;
        uniform vec3 uHeroLine;
        uniform vec2 uHeroCrease;
        uniform vec4 uHeroLod;
        uniform float uHeroDebug;
        uniform vec4 uHeroPartInk[${HERO_PARTS}];
        uniform vec2 uHeroPartFill[${HERO_PARTS}];
        uniform vec2 uArtLum;
        uniform vec2 uArtBlack;
        uniform vec2 uArtMin;
        uniform float uArtMax;
        uniform vec2 uArtDither;
        uniform vec2 uArtEdge;
        uniform vec4 uWyrmTone;
        uniform vec4 uWyrmGlyph;
        uniform vec4 uWyrmAtlas;
        uniform float uWyrmOutline;
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

        // ---- the wyrm (FLAG.ART): thin one-pixel letters on black (wyrmGlyphs.js atlas in tArt).
        // The letter is picked per cell: its average source picks a letter SET (a dark cell prints
        // nothing; dim / mid / bright sets, the steps dithered per cell), the cell's own hash picks the
        // letter inside it, so the letters hold still while the wyrm moves under them (the owner's
        // reference prints whole digits even in the dark parts). Its strokes take brightness and hue
        // from their OWN pixel of the source (cp, blended by uWyrmTone.w): in the reference a bright
        // scale edge cuts crisply through the letters, so the shapes survive the text. Brightness
        // goes through a black point and a gamma (dim charcoal hide, bright rims); saturated HDR
        // sources (lava, eyes) bloom.
        // stroke >= 0: the material marked this cell as a scale rim / thin part running in that screen
        // direction (0 '-', 1 '/', 2 '|', 3 '\\'): draw the stroke glyph, the reference's edge-shaped
        // letters that outline every scale
        vec3 wyrmCell(vec3 c, vec3 cp, vec2 acell, vec2 local, float stroke) {
          float v = 1.0 - exp(-max(luma(c) - uArtBlack.y, 0.0) * uArtLum.y);
          float h = hash12(acell * 1.37 + 11.0);
          float d = (hash12(acell * 0.71 + 3.7) - 0.5) * uWyrmGlyph.z;
          float s0 = v < uWyrmGlyph.x + d ? 1.0 : v < uWyrmGlyph.y + d ? uWyrmAtlas.x : uWyrmAtlas.y;
          float s1 = v < uWyrmGlyph.x + d ? uWyrmAtlas.x : v < uWyrmGlyph.y + d ? uWyrmAtlas.y : uWyrmAtlas.z;
          float idx = s0 + min(floor(h * (s1 - s0)), s1 - s0 - 1.0);
          if (stroke >= 0.0) idx = uWyrmAtlas.z + stroke;
          if (v < uWyrmTone.z) idx = 0.0;
          float m = texture2D(tArt, vec2((idx + local.x) / uWyrmAtlas.w, local.y)).a;
          vec3 s = mix(c, cp, uWyrmTone.w);
          float vp = 1.0 - exp(-max(luma(s) - uArtBlack.y, 0.0) * uArtLum.y);
          float mx = max(max(s.r, s.g), s.b);
          vec3 hue = s / max(mx, 1e-4);
          float sat = (mx - min(min(s.r, s.g), s.b)) / max(mx, 1e-4);
          float b = mix(uArtMin.y, uWyrmTone.x, pow(vp, uWyrmTone.y));
          return hue * b * mix(1.0, max(1.0, mx), smoothstep(0.25, 0.6, sat)) * m;
        }

        // ---- the hero as ink-line art (the owner's reference: anime line art turned into ASCII).
        // A cell is one of: an INK LINE (a bright stroke glyph | - / \\ following the edge, in a whitened
        // tint of the part) where the silhouette, a depth step (its nearer side) or a part edge (the
        // higher part, HERO_ART ids in alpha) runs; a GAP (the far side of a depth step: a dark fill);
        // or FILL (dim, dense letters from the density ramp, following the source's light).
        float heroGlyph(float idx, vec2 local, float lineRow) {
          vec2 auv = vec2((idx + local.x) / uHeroCols, (1.0 - lineRow) * 0.5 + local.y * 0.5);
          return texture2D(tHeroArt, auv).a;
        }
        // a neighbouring cell centre: x = its alpha (0 = not the hero), y = its view depth, z = its luma
        vec3 heroAt(vec2 uv) {
          vec4 s = texture2D(tScene, uv);
          return isHero(s.a) ? vec3(s.a, linDepth(uv), luma(s.rgb)) : vec3(0.0, -1.0, 0.0);
        }
        // ... and when that centre is off the hero, whether the cell still draws the outline itself
        // (the midpoint of its two samples nearer this cell hits him, so ≥ 2 of its 4 do): x = -1, and
        // this cell draws none, so the outline stays one letter thick (a double band turned the figure
        // into a wireframe at the game camera, where he is only ~12 letters wide)
        vec3 heroNb(vec2 uv, vec2 toC) {
          vec3 s = heroAt(uv);
          if (s.x <= 0.0 && isHero(texture2D(tScene, uv + toC * 0.25).a)) s.x = -1.0;
          return s;
        }
        // neighbour n seen from this cell (depth dC, part alpha aC, luma lC); the opposite neighbour's
        // depth dO predicts a smooth slope, so curved and grazing surfaces draw no line, only real
        // steps and sharp creases do. x = the ink line this cell draws: 1 silhouette (n is
        // background; none if n draws it itself, x = -1, see heroNb), 0.8 a depth step (n lies
        // behind), 0.6 a part edge (n is a lower part at the same depth), 0.5 a crease in the light
        // (fold, terminator, glint: this cell is the lit side) and 0.4 a piece edge inside one part
        // (both only where near: up close, see uHeroLod), 0 none; y = 1: n steps in front (this cell
        // is the far side of a step: a gap)
        vec2 heroEdge(vec3 n, float dC, float aC, float lC, float dO, float th, bool near) {
          if (n.x <= 0.0) return vec2(n.x < 0.0 ? 0.0 : 1.0, 0.0);
          float pred = dO > 0.0 && abs(dC - dO) < th * 4.0 ? 2.0 * dC - dO : dC;
          float d = n.y - pred;
          if (d > th) return vec2(0.8, 0.0);
          if (d < -th) return vec2(0.0, 1.0);
          if (n.x >= aC - ${(HERO_ART.step * 0.5).toFixed(5)}) {
            return vec2(near && n.x < aC + ${(HERO_ART.step * 0.5).toFixed(5)} && lC > n.z * uHeroCrease.x + uHeroCrease.y ? 0.5 : 0.0, 0.0);
          }
          float pc = floor((aC - ${HERO_ART.a0.toFixed(4)}) / ${(HERO_ART.step * 2).toFixed(4)} + 0.25);
          float pn = floor((n.x - ${HERO_ART.a0.toFixed(4)}) / ${(HERO_ART.step * 2).toFixed(4)} + 0.25);
          return vec2(pc != pn ? 0.6 : near ? 0.4 : 0.0, 0.0);
        }

        void main() {
          vec2 px = gl_FragCoord.xy;
          // the hero first: his own pixel-font grid, drawn as ink-line art
          vec2 hcell = floor(px / uHeroCell);
          vec2 hbase = hcell * uHeroCell;
          vec3 hsum = vec3(0.0);
          float hhits = 0.0, dN = 1e9, aN = 0.0;
          vec4 hin = vec4(0.0); // which of the 4 samples hit the hero (the in-cell silhouette direction)
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i == 1 || i == 3 ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25);
            vec2 suv = (hbase + o * uHeroCell) / uRes;
            vec4 sa = texture2D(tScene, suv);
            if (isHero(sa.a)) {
              hsum += sa.rgb;
              hhits += 1.0;
              hin[i] = 1.0;
              float dz = linDepth(suv);
              if (dz < dN) { dN = dz; aN = sa.a; }
            }
          }
          vec2 cuvH = (hbase + 0.5 * uHeroCell) / uRes;
          vec4 cH = texture2D(tScene, cuvH);
          bool cHero = isHero(cH.a);
          if (cHero || hhits >= 2.0) {
            // the cell's part = its centre (else its nearest hero sample)
            float dC = cHero ? linDepth(cuvH) : dN;
            float aC = cHero ? cH.a : aN;
            vec3 c = (hsum + (cHero ? cH.rgb : vec3(0.0))) / (hhits + (cHero ? 1.0 : 0.0));
            float th = max(uArtEdge.x, 1e-4) * dC;
            vec2 dx = vec2(uHeroCell.x, 0.0) / uRes, dy = vec2(0.0, uHeroCell.y) / uRes;
            vec3 sL = heroNb(cuvH - dx, dx), sR = heroNb(cuvH + dx, -dx), sD = heroNb(cuvH - dy, dy), sU = heroNb(cuvH + dy, -dy);
            float lC = luma(c);
            // distance LOD (view depth): 0 up close, 1 at the game camera. Far away nearly every cell
            // of a 12-letter-wide figure sits on some edge, so the fine inner lines (creases, piece
            // edges) drop out, dithered per cell so there is no pop, and the fill carries the body.
            float far = smoothstep(uHeroLod.x, uHeroLod.y, dC);
            bool fine = hash12(hcell * 0.73 + 5.1) >= smoothstep(0.0, 0.6, far);
            vec2 eL = heroEdge(sL, dC, aC, lC, sR.y, th, fine), eR = heroEdge(sR, dC, aC, lC, sL.y, th, fine);
            vec2 eD = heroEdge(sD, dC, aC, lC, sU.y, th, fine), eU = heroEdge(sU, dC, aC, lC, sD.y, th, fine);
            float sil = hhits < 4.0 ? 1.0 : 0.0; // the silhouette runs through this cell
            float line = max(sil, max(max(eL.x, eR.x), max(eD.x, eU.x)));
            // stroke direction: the edge runs across the direction (gx, gy) in which the other side lies
            vec4 e4 = step(0.1, vec4(eL.x, eR.x, eD.x, eU.x));
            float gx = (e4.y - e4.x) * 2.0 + (hin.x + hin.z - hin.y - hin.w);
            float gy = (e4.w - e4.z) * 2.0 + (hin.x + hin.y - hin.z - hin.w);
            float ax = abs(gx), ay = abs(gy);
            float hz = e4.x + e4.y, vt = e4.z + e4.w;
            // an inner cell walled in on 3–4 sides is a speck, not an edge: no stroke (noise)
            if (sil < 0.5 && line < 0.9 && hz + vt > 2.5) line = 0.0;
            float gap = max(max(eL.y, eR.y), max(eD.y, eU.y)) * step(line, 0.1);
            vec2 local = (px - hbase) / uHeroCell;
            float mx = max(max(c.r, c.g), c.b);
            vec3 hue = c / max(mx, 1e-4);
            float sat = (mx - min(min(c.r, c.g), c.b)) / max(mx, 1e-4);
            float v = 1.0 - exp(-max(luma(c) - uArtBlack.x, 0.0) * uArtLum.x);
            float hdr = mix(1.0, max(1.0, mx), smoothstep(0.25, 0.6, sat)); // the blade / gem keep their glow
            int pid = int(clamp(floor((aC - ${HERO_ART.a0.toFixed(4)}) / ${(HERO_ART.step * 2).toFixed(4)} + 0.25), 0.0, ${(HERO_PARTS - 1).toFixed(1)}));
            vec3 col;
            if (uHeroDebug > 0.5 && uHeroDebug < 1.5) {
              col = c; // look-dev: the raw art source
            } else if (uHeroDebug > 2.5 && line > 0.1) {
              // look-dev: the line classes (white silhouette, red depth step, green part edge, blue
              // crease, yellow piece edge)
              col = 0.5 * (line > 0.9 ? vec3(1.0) : line > 0.7 ? vec3(1.0, 0.08, 0.05) : line > 0.55 ? vec3(0.1, 1.0, 0.15) : line > 0.45 ? vec3(0.15, 0.3, 1.0) : vec3(1.0, 0.85, 0.05));
            } else if (line > 0.1) {
              float j;
              if (ax + ay < 0.5) j = hz > vt + 0.5 ? 0.0 : vt > hz + 0.5 ? 1.0 : 4.0; // a thin part: lines on both sides
              else if (ax > 2.0 * ay) j = 0.0;
              else if (ay > 2.0 * ax) j = 1.0;
              else j = gx * gy > 0.0 ? 3.0 : 2.0;
              bool outer = line > 0.9;
              float k = outer ? 1.0 : (line > 0.7 ? uHeroLine.x : line > 0.5 ? uHeroLine.y : uHeroLine.z) * mix(1.0, 0.7, far);
              vec4 pInk = uHeroPartInk[pid];
              vec3 ink = mix(vec3(1.0), hue, uHeroInk.z * (0.35 + 0.65 * sat)) * pInk.rgb;
              // far away the lines step back toward the fill, so the figure reads as a letter mass with
              // a bright rim rather than a wireframe (the glowing parts, gain > 1.5, keep their ink)
              float lg = mix(1.0, uHeroLod.w, far * step(pInk.a, 1.5));
              // torn tails and hair: their outer edges are rows of bright specks (sparse letters), the
              // reference's dotted rags and wisps, not a drawn stroke. Far away a tail is a strip only a
              // letter or two wide: denser letters, so it reads as lavender cloth, not scattered dust
              float g = uHeroPartFill[pid].y > 0.5 && line > 0.7
                ? heroGlyph(floor(2.0 + 4.0 * far + hash12(hcell + 3.7) * 4.0), local, 0.0)
                : heroGlyph(j, local, 1.0);
              col = ink * mix(uHeroInk.x, uHeroInk.y, v) * k * pInk.a * hdr * g * lg;
            } else if (uHeroDebug > 1.5) {
              col = vec3(0.0);
            } else {
              float jit = (hash12(hcell * 1.37 + 11.0) - 0.5) * uArtDither.x;
              float idx = clamp(floor(mix(uHeroFill.z, uHeroFill.w, v) * (uHeroCount - 1.0) + 0.5 + jit), 1.0, uHeroCount - 1.0);
              col = hue * mix(uHeroFill.x, uHeroFill.y, v * v) * uHeroPartFill[pid].x * hdr * mix(1.0, uHeroInk.w, gap) * mix(1.0, uHeroLod.z, far) * heroGlyph(idx, local, 0.0);
            }
            gl_FragColor = vec4(col, 1.0);
            return;
          }
          // the wyrm (other creatures): the art grid
          vec2 acell = floor(px / uArtCell);
          vec2 abase = acell * uArtCell;
          vec3 asum = vec3(0.0);
          float ahits = 0.0, dmin = 1e9, dmax = 0.0;
          vec4 votes = vec4(0.0); // wyrm stroke codes (alpha 0.51 .. 0.54, materials.js wyrmMain)
          vec3 arim = vec3(0.0); // brightest stroke-coded sample: a stroke glyph's colour
          vec4 amask = vec4(0.0); // which samples hit the wyrm: x BL, y BR, z TL, w TR
          for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i == 1 || i == 3 ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25);
            vec2 suv = (abase + o * uArtCell) / uRes;
            vec4 sa = texture2D(tScene, suv);
            if (isArt(sa.a) && !isHero(sa.a)) {
              if (i == 0) amask.x = 1.0; else if (i == 1) amask.y = 1.0; else if (i == 2) amask.z = 1.0; else amask.w = 1.0;
              asum += sa.rgb;
              ahits += 1.0;
              float dz = linDepth(suv);
              dmin = min(dmin, dz);
              dmax = max(dmax, dz);
              float code = floor((sa.a - 0.5) * 100.0 + 0.5);
              votes += vec4(equal(vec4(code), vec4(1.0, 2.0, 3.0, 4.0)));
              if (code > 0.5 && luma(sa.rgb) > luma(arim)) arim = sa.rgb;
            }
          }
          // silhouette cells (1-3 of the 4 samples on the wyrm) draw their edge as a stroke glyph along
          // it (marching squares on the samples): the reference's character-drawn outlines, so spikes,
          // claws and torn wing edges keep their shape instead of dissolving into digits
          float edgeS = -1.0;
          if (uWyrmOutline > 0.5 && ahits >= 1.0 && ahits <= 3.0) {
            if (ahits == 2.0 && amask.x == amask.w) edgeS = amask.x > 0.5 ? 1.0 : 3.0; // diagonal pair
            else {
              float gx = (amask.y + amask.w) - (amask.x + amask.z);
              float gy = (amask.z + amask.w) - (amask.x + amask.y);
              edgeS = mod(floor(mod(atan(gx, -gy), 3.14159265) / 0.7853982 + 0.5), 4.0);
            }
            // a horizontal edge prints a letter, not '-': long dash runs along the wing tops, the
            // tail and the toes read as ruled lines, not as the reference's lettered outlines
            if (edgeS == 0.0) edgeS = -1.0;
          }
          // a cell needs 2 of 4 samples on the wyrm, or 1 when it draws a stroke (an outline, or a
          // stroke-coded spike / claw / horn tip that would otherwise vanish between the samples)
          float strokeHits = max(max(votes.x, votes.y), max(votes.z, votes.w));
          if (ahits >= 2.0 || (ahits >= 1.0 && (strokeHits >= 1.0 || edgeS >= 0.0))) {
            if (uArtEdge.y > 0.0 && (dmax - dmin) > uArtEdge.y * dmin) {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }
            vec4 sp = texture2D(tScene, px / uRes);
            vec3 cp = isArt(sp.a) && !isHero(sp.a) ? sp.rgb : asum / ahits;
            float best = max(max(votes.x, votes.y), max(votes.z, votes.w));
            float stroke = best < uWyrmGlyph.w ? -1.0 : votes.x == best ? 0.0 : votes.y == best ? 1.0 : votes.z == best ? 2.0 : 3.0;
            vec3 ca = asum / ahits;
            if (stroke >= 0.0) { ca = arim; cp = arim; } // an outline glyph is drawn whole in the rim's colour
            if (edgeS >= 0.0) { stroke = edgeS; ca = max(asum / ahits, arim); cp = ca; }
            gl_FragColor = vec4(wyrmCell(ca, cp, acell, (px - abase) / uArtCell, stroke), 1.0);
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
    {
      // the wyrm's (.y) art-pass numbers, read by wyrmCell: its source (materials.js wyrmMain) is a
      // dark hide with bright scale rims, so a steep curve + low floor keeps most letters charcoal
      const u = this.asciiMat.uniforms;
      u.uArtLum.value.y = 2.2;
      u.uArtBlack.value.y = 0.004;
      u.uArtMin.value.y = 0.012;
    }

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
    // the wyrm's ASCII art: thin 4x6 pixel letters in 5x8 cells (x2 from 1620 px tall), the owner's
    // reference grid (~5 x 7.5 px letters on its 1024 px image)
    const ws = Math.max(1, Math.round(H / 1080));
    const [artW, artH] = wyrmArtCell(ws);
    if (!this.art || artW !== this.artCell.x || artH !== this.artCell.y) {
      this.art?.texture.dispose();
      this.artCell.set(artW, artH);
      this.art = createWyrmArtAtlas(ws);
      this.asciiMat.uniforms.tArt.value = this.art.texture;
      this.asciiMat.uniforms.uArtCount.value = this.art.sets[2];
      this.asciiMat.uniforms.uWyrmAtlas.value.set(...this.art.sets, this.art.total);
    }
    const hs = Math.max(1, Math.floor(H / 1080));
    const [heroW, heroH] = pixelArtCell(hs);
    if (!this.heroArt || heroW !== this.heroCell.x || heroH !== this.heroCell.y) {
      this.heroArt?.texture.dispose();
      this.heroCell.set(heroW, heroH);
      this.heroArt = createPixelArtAtlas(hs);
      this.asciiMat.uniforms.tHeroArt.value = this.heroArt.texture;
      this.asciiMat.uniforms.uHeroCount.value = this.heroArt.count;
      this.asciiMat.uniforms.uHeroCols.value = this.heroArt.cols;
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
