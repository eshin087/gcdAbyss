import * as THREE from 'three';
import { COMMON_GLSL } from './shaderLib.js';
import { gi } from './glyphs.js';

// Material families (see STYLE.md):
//  - AsciiObject: rocks, ruins, trees. Writes a FLAG in alpha so the post pass converts the
//    object into a screen-space character grid (stone ramp for flag≈1, leaf ramp for flag≈0.6).
//  - SurfaceGlyph: creatures and the player. Glyphs are laid out ON the surface (in aGUV space,
//    meters), oriented along the body, chosen by lighting — "arranged symbols" for scales/armour.

// Alpha flag values written into the scene target.
export const FLAG = { NONE: 0.0, LEAF: 0.6, STONE: 1.0 };

function pickShared(U, names) {
  const out = {};
  for (const n of names) out[n] = U[n];
  return out;
}
const SHARED = [
  'uTime', 'uMoonDir', 'uMoonColor', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar', 'uFocus',
  'uCamPos', 'uPLPos', 'uPLCol', 'uPLRad', 'uShadowMap', 'uShadowMatrix', 'uShadowTexel',
  'uGlyphAtlas', 'uScorch', 'uScorchBounds',
];

/**
 * Geometry attributes required: position, normal, aCol (vec3 albedo, linear), aFlag (float),
 * aSway (float, 0 = rigid), aAO (float 0..1).
 * fadeNearPlayer: canopy/foreground occluders dither away around the player on screen.
 */
export function createAsciiObjectMaterial(U, { fadeNearPlayer = false, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uPlayerScreen: U.uPlayerScreen,
      uResolution: U.uResolution,
      uFadeOn: { value: fadeNearPlayer ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      ${COMMON_GLSL}
      attribute vec3 aCol;
      attribute float aFlag;
      attribute float aSway;
      attribute float aAO;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vFlag;
      varying float vAO;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float s = aSway;
        wp.x += (sin(uTime * 0.9 + wp.z * 0.15 + wp.x * 0.05) * 0.6 + sin(uTime * 2.1 + wp.x * 0.4) * 0.25) * 0.14 * s;
        wp.z += cos(uTime * 0.7 + wp.x * 0.13) * 0.08 * s;
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vCol = aCol;
        vFlag = aFlag;
        vAO = aAO;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform float uFadeOn;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vFlag;
      varying float vAO;
      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.18);
        vec3 L = lightAt(vW, n, 0.3, sh);
        vec3 col = vCol * L * vAO;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, vFlag);
      }
    `,
    side,
    blending: THREE.NoBlending,
  });
}

/**
 * Surface glyph material. Geometry needs `aGUV` (vec2, meters: x = around, y = along; glyphs
 * point toward +y). Use helpers in glyphGeometry.js to generate it.
 *
 * Options (all optional):
 *   base:  [r,g,b] dark "skin" between glyphs (linear)
 *   ink:   [r,g,b] glyph colour,  inkAlt: second glyph colour mixed per cell (altChance 0..1)
 *   glyphs: string of 4 chars ordered dark→bright, e.g. '.v^A' (picked by local lighting)
 *   cell:  [w,h] meters per glyph cell;  rowShift: 0.5 = brick/scale offset per row
 *   gain:  glyph brightness multiplier;  lumScale: how fast glyphs climb the 4-step ramp
 *   rim:   moon-coloured rim light strength (keeps silhouettes readable on dark grass)
 *   emissive: [r,g,b] crack glow colour (driven by uniforms.uGlow 0..1 at runtime)
 *   glowMask: 0..1 how much this part participates in uGlow
 *   side: THREE side;  flag: FLAG value (keep NONE for creatures)
 * Runtime uniforms you can animate: uGlow, uInkGlow (glyphs self-lit), uFlash (hit flash 0..1),
 * uDissolve (0..1, per-cell disintegration), uTint (multiplies ink).
 */
export function createSurfaceGlyphMaterial(U, o = {}) {
  const g = [...(o.glyphs ?? '.v^A')].map(gi);
  while (g.length < 4) g.push(g[g.length - 1]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uBase: { value: new THREE.Color(...(o.base ?? [0.016, 0.014, 0.016])) },
      uInk: { value: new THREE.Color(...(o.ink ?? [0.55, 0.5, 0.46])) },
      uInkAlt: { value: new THREE.Color(...(o.inkAlt ?? o.ink ?? [0.55, 0.5, 0.46])) },
      uAltChance: { value: o.altChance ?? 0 },
      uGlyphs: { value: new THREE.Vector4(g[0], g[1], g[2], g[3]) },
      uCell: { value: new THREE.Vector2(...(o.cell ?? [0.22, 0.26])) },
      uRowShift: { value: o.rowShift ?? 0.5 },
      uGain: { value: o.gain ?? 2.4 },
      uLumScale: { value: o.lumScale ?? 1.5 },
      uRim: { value: o.rim ?? 0.35 },
      uEmissive: { value: new THREE.Color(...(o.emissive ?? [1.0, 0.3, 0.05])) },
      uGlow: { value: 0 },
      uGlowMask: { value: o.glowMask ?? 1 },
      uInkGlow: { value: o.inkGlow ?? 0 },
      uFlash: { value: 0 },
      uDissolve: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSeed: { value: o.seed ?? Math.random() * 97 },
      uFlag: { value: o.flag ?? 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aGUV;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vG;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vG = aGUV;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform vec3 uBase;
      uniform vec3 uInk;
      uniform vec3 uInkAlt;
      uniform float uAltChance;
      uniform vec4 uGlyphs;
      uniform vec2 uCell;
      uniform float uRowShift;
      uniform float uGain;
      uniform float uLumScale;
      uniform float uRim;
      uniform vec3 uEmissive;
      uniform float uGlow;
      uniform float uGlowMask;
      uniform float uInkGlow;
      uniform float uFlash;
      uniform float uDissolve;
      uniform vec3 uTint;
      uniform float uSeed;
      uniform float uFlag;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vG;
      void main() {
        vec2 g = vG / uCell;
        g.x += step(1.0, mod(floor(g.y), 2.0)) * uRowShift;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float h = hash12(cell + uSeed);
        if (uDissolve > 0.0 && h < uDissolve) discard;

        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.1);
        vec3 L = lightAt(vW, n, 0.25, sh);
        vec3 V = normalize(uCamPos - vW);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * uRim;

        float lum = luma(L) * uLumScale + (h - 0.5) * 0.4;
        float li = floor(clamp(lum, 0.0, 0.999) * 4.0);
        float idx = li < 0.5 ? uGlyphs.x : li < 1.5 ? uGlyphs.y : li < 2.5 ? uGlyphs.z : uGlyphs.w;
        float m = glyphGrad(idx, f, dFdx(g), dFdy(g));

        vec3 inkC = mix(uInk, uInkAlt, step(1.0 - uAltChance, fract(h * 7.31))) * uTint;
        vec3 base = uBase * (L * 1.4 + 0.015);
        vec3 ink = inkC * (L * uGain + rim * uMoonColor * 2.0) + inkC * uInkGlow;
        vec3 col = mix(base, ink, m);

        // molten seams: thin hot cracks between scale rows/columns, the glyphs stay readable
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float seam = 1.0 - smoothstep(0.012, 0.075, edge);
        float pulse = 0.6 + 0.4 * sin(uTime * 3.3 + h * 6.283);
        float hot = uGlow * uGlowMask;
        col += uEmissive * hot * (seam * (1.0 - m) * 0.95 + (1.0 - m) * 0.03) * pulse;
        col = mix(col, col * vec3(1.2, 0.92, 0.8) + uEmissive * 0.06 * m, hot * 0.45);

        col += vec3(1.0, 0.92, 0.85) * uFlash * (0.25 + 0.75 * m);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uFlag);
      }
    `,
    side: o.side ?? THREE.FrontSide,
    blending: THREE.NoBlending,
  });
  return mat;
}
