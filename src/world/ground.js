import * as THREE from 'three';
import { COMMON_GLSL, BASIC_VERT } from '../render/shaderLib.js';
import { gis } from '../render/glyphs.js';

// Near-black soil carrying a faint world-space field of dim glyphs, scorch marks and ash.
export function createGround(U) {
  const geo = new THREE.PlaneGeometry(240, 240, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const soil = gis(".,'`:-");
  const ash = gis(".,:;~");
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor, uAmbient: U.uAmbient,
      uFogColor: U.uFogColor, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uFocus: U.uFocus,
      uCamPos: U.uCamPos, uPLPos: U.uPLPos, uPLCol: U.uPLCol, uPLRad: U.uPLRad,
      uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel,
      uGlyphAtlas: U.uGlyphAtlas, uScorch: U.uScorch, uScorchBounds: U.uScorchBounds,
      uSoil: { value: soil },
      uAsh: { value: ash },
    },
    vertexShader: BASIC_VERT,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform float uSoil[6];
      uniform float uAsh[5];
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        // glyph field: cells 0.34 x 0.5 m, upright on screen (north = glyph up)
        vec2 g = vec2(vW.x, -vW.z) / vec2(0.34, 0.5);
        g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float h = hash12(cell);
        vec2 sc = scorchAt(vW.xz);
        float burn = sc.x, heat = sc.y;
        float m = 0.0;
        if (h > 0.5) {
          int i = int(fract(h * 13.7) * 6.0);
          float idx = uSoil[0];
          for (int k = 0; k < 6; k++) if (k == i) idx = uSoil[k];
          if (burn > 0.35) {
            int j = int(fract(h * 7.1) * 5.0);
            for (int k = 0; k < 5; k++) if (k == j) idx = uAsh[k];
          }
          m = glyphGrad(idx, f, dFdx(g), dFdy(g));
        }
        float sh = shadowAt(vW + vec3(0.0, 0.05, 0.0));
        vec3 L = ambientAt(vec3(0.0, 1.0, 0.0)) + uMoonColor * uMoonDir.y * sh * 0.85 + pointLights(vW + vec3(0.0, 0.05, 0.0), vec3(0.0, 1.0, 0.0), 0.0);
        vec3 soil = vec3(0.010, 0.013, 0.012);
        vec3 ink = mix(vec3(0.045, 0.06, 0.05), vec3(0.07, 0.065, 0.06), burn);
        vec3 col = soil * L + ink * L * m * 1.6;
        col = mix(col, col * vec3(0.5, 0.45, 0.42), burn * 0.6);
        // embers glowing in the ash
        float flick = 0.65 + 0.35 * sin(uTime * 9.0 + h * 40.0);
        col += vec3(1.0, 0.28, 0.04) * heat * heat * (0.18 + 1.6 * m) * flick;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 0.0);
      }
    `,
    blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  return mesh;
}
