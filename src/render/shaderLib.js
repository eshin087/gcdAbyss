import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

// Shared uniforms + GLSL used by every world material, so moonlight, fire lights, shadows,
// fog, scorch marks and grass pushers are consistent everywhere.

export const MAX_PL = 8; // dynamic point lights visible at once
export const MAX_PUSH = 10; // grass pushers (feet, bodies)
export const HERO_PARTS = 20; // hero ink-line part ids (HERO_ART in materials.js, HERO_INK in player/model.js)

export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    // points TOWARD the moon: south-west, so camera-facing sides are lit and shadows fall up-right
    uMoonDir: { value: new THREE.Vector3(-0.55, 1.0, 0.32).normalize() },
    uMoonColor: { value: new THREE.Color(0.42, 0.5, 0.72) },
    uAmbient: { value: new THREE.Color(0.026, 0.034, 0.056) },
    uFogColor: { value: new THREE.Color(0.004, 0.006, 0.011) },
    uFogNear: { value: 30 },
    uFogFar: { value: 62 },
    uFocus: { value: new THREE.Vector3() }, // fog is radial around the camera focus (the player)
    uCamPos: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uBladeUp: { value: new THREE.Vector3(0, 1, 0) },
    uPLPos: { value: Array.from({ length: MAX_PL }, () => new THREE.Vector3()) },
    uPLCol: { value: Array.from({ length: MAX_PL }, () => new THREE.Vector3()) },
    uPLRad: { value: new Array(MAX_PL).fill(0) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / CONFIG.render.shadowSize },
    uGlyphAtlas: { value: null },
    uScorch: { value: null },
    uScorchBounds: { value: new THREE.Vector4(-80, -80, 160, 0) },
    uPushers: { value: Array.from({ length: MAX_PUSH }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uGust: { value: new THREE.Vector4(0, 0, 0, 1) }, // x, z, strength, radius (radial wind)
    uPlayerScreen: { value: new THREE.Vector4(0.5, 0.5, 1e9, 0) }, // uv x, uv y, view depth, unused
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCullDist: { value: 60 },
    // creature ASCII art: 1 = materials feed the pass a smooth shaded source (no surface-glyph gaps),
    // 0 = the patterned surface render (look-dev A/B; see FLAG.ART in materials.js)
    uArtSolid: { value: 1 },
    // hero ASCII-art source only (FLAG.ART_HERO): darken toward the silhouette, like the owner's
    // reference (dim letters at the edge of every part) instead of the moonlit outline
    uArtHeroEdge: { value: 0.7 },
    // ... and a fixed key light from the camera's upper left, so he models the same in moonlight,
    // firelight or the Lab (the reference figure is evenly lit)
    uArtHeroKey: { value: 1.15 },
    // the hero's ink-line art source (materials with `heroArt`): fill = part colour × (x flat + y key
    // light from the camera's upper left + z × the scene light); w scales the metal glints
    uArtHeroLight: { value: new THREE.Vector4(0.45, 0.55, 0.25, 1.0) },
    // ... and its cool rim from the screen's left (the reference's blue-lavender silhouette side)
    uArtHeroRim: { value: new THREE.Color(0.12, 0.15, 0.55) },
    // the art pass's ink lines per hero part (filled from HERO_INK by player/model.js): rgb tint × a
    // gain (> 1 glows under bloom: the cyan blade edges, the violet gem)
    uHeroPartInk: { value: Array.from({ length: HERO_PARTS }, () => new THREE.Vector4(1, 1, 1, 1)) },
    // ... x = the brightness of each part's letter fill (the pale face reads lighter than the coat),
    // y = 1: its silhouette takes the heavy 2 px stroke at the game camera (0: the hair stays fine),
    // z = 1: its edges are bright DOTS (sparse letters), not strokes (the torn tails, the hair)
    uHeroPartFill: { value: Array.from({ length: HERO_PARTS }, () => new THREE.Vector3(1, 1, 0)) },
  };
}

export const COMMON_GLSL = /* glsl */ `
#define MAX_PL ${MAX_PL}
#define MAX_PUSH ${MAX_PUSH}
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFocus;
uniform vec3 uCamPos;
uniform vec3 uPLPos[MAX_PL];
uniform vec3 uPLCol[MAX_PL];
uniform float uPLRad[MAX_PL];
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform sampler2D uGlyphAtlas;
uniform sampler2D uScorch;
uniform vec4 uScorchBounds;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}

// --- glyph atlas (16 x 8 cells). uv in [0,1], y up = top of the character.
vec2 glyphAtlasUV(float idx, vec2 uv) {
  uv = clamp(uv, 0.03, 0.97);
  float col = mod(idx, 16.0);
  float row = floor(idx / 16.0);
  return vec2((col + uv.x) / 16.0, (7.0 - row + uv.y) / 8.0);
}
float glyph(float idx, vec2 uv) {
  return texture2D(uGlyphAtlas, glyphAtlasUV(idx, uv)).a;
}
// Seam-free version for tiled glyph fields: pass derivatives of the continuous cell coordinate.
float glyphGrad(float idx, vec2 uv, vec2 dx, vec2 dy) {
  return textureGrad(uGlyphAtlas, glyphAtlasUV(idx, uv), dx / vec2(16.0, 8.0), dy / vec2(16.0, 8.0)).a;
}

// --- moon shadow map (orthographic, linear depth)
float shadowAt(vec3 wp) {
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = 0.0009;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float d = textureLod(uShadowMap, p.xy + vec2(float(i), float(j)) * uShadowTexel * 1.25, 0.0).r;
      s += (p.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return s / 9.0;
}
float shadowAtFast(vec3 wp) {
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  return (p.z - 0.0012 > textureLod(uShadowMap, p.xy, 0.0).r) ? 0.0 : 1.0;
}

// --- lighting
vec3 pointLights(vec3 wp, vec3 n, float wrap) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_PL; i++) {
    float r = uPLRad[i];
    if (r <= 0.0) continue;
    vec3 d = uPLPos[i] - wp;
    float dist = length(d);
    if (dist >= r) continue;
    float att = 1.0 - dist / r;
    att *= att;
    float ndl = (dot(n, d / max(dist, 1e-3)) + wrap) / (1.0 + wrap);
    acc += uPLCol[i] * att * max(ndl, 0.0);
  }
  return acc;
}
vec3 ambientAt(vec3 n) {
  return uAmbient * mix(0.45, 1.25, n.y * 0.5 + 0.5);
}
vec3 lightAt(vec3 wp, vec3 n, float wrap, float shadow) {
  float ndl = (dot(n, uMoonDir) + wrap) / (1.0 + wrap);
  return ambientAt(n) + uMoonColor * max(ndl, 0.0) * shadow + pointLights(wp, n, wrap);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// --- fog: radial darkness around the focus so the play space stays readable
vec3 applyFog(vec3 col, vec3 wp) {
  float d = length(wp.xz - uFocus.xz);
  return mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
}

// --- scorch map: r = burn (persistent char), g = heat (glowing embers, decays)
vec2 scorchAt(vec2 xz) {
  vec2 uv = (xz - uScorchBounds.xy) / uScorchBounds.z;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec2(0.0);
  return textureLod(uScorch, uv, 0.0).rg;
}
`;

/** Standard vertex shader for meshes (world position + normal varyings). */
export const BASIC_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Fullscreen triangle vertex shader for post passes. */
export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
