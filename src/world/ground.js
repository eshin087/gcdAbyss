import * as THREE from 'three';
import { COMMON_GLSL, BASIC_VERT } from '../render/shaderLib.js';
import { FLAG } from '../render/materials.js';

// The ground writes its LIT colour (soil ↔ grass by meadow density, shadows, fire light, scorch,
// embers) with the GRASS flag; the ASCII pass turns every ground cell into a grass glyph.
export function createGround(U, meadow) {
  const geo = new THREE.PlaneGeometry(240, 240, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uMoonDir: U.uMoonDir, uMoonColor: U.uMoonColor, uAmbient: U.uAmbient,
      uFogColor: U.uFogColor, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uFocus: U.uFocus,
      uCamPos: U.uCamPos, uPLPos: U.uPLPos, uPLCol: U.uPLCol, uPLRad: U.uPLRad,
      uShadowMap: U.uShadowMap, uShadowMatrix: U.uShadowMatrix, uShadowTexel: U.uShadowTexel,
      uGlyphAtlas: U.uGlyphAtlas, uScorch: U.uScorch, uScorchBounds: U.uScorchBounds,
      uMeadow: { value: meadow.texture },
      uMeadowBounds: { value: meadow.bounds },
      uFlag: { value: FLAG.GRASS },
    },
    vertexShader: BASIC_VERT,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform sampler2D uMeadow;
      uniform vec4 uMeadowBounds;
      uniform float uFlag;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec2 muv = (vW.xz - uMeadowBounds.xy) / uMeadowBounds.z;
        vec2 meadow = textureLod(uMeadow, muv, 0.0).rg;
        float dens = meadow.r;
        vec2 sc = scorchAt(vW.xz);
        float burn = sc.x, heat = sc.y;
        float sh = shadowAt(vW + vec3(0.0, 0.25, 0.0));
        vec3 L = uAmbient * 1.6 + uMoonColor * 0.62 * sh + pointLights(vW + vec3(0.0, 0.35, 0.0), vec3(0.0, 1.0, 0.0), 1.0);
        // sage grass ↔ dark soil; a little colour variation from tallness
        vec3 grass = mix(vec3(0.12, 0.19, 0.085), vec3(0.165, 0.235, 0.1), meadow.g);
        vec3 soil = vec3(0.055, 0.06, 0.05);
        vec3 alb = mix(soil, grass, smoothstep(0.05, 0.55, dens));
        alb = mix(alb, vec3(0.06, 0.055, 0.05), burn);
        vec3 col = alb * L;
        float flick = 0.65 + 0.35 * sin(uTime * 8.0 + vW.x * 3.1 + vW.z * 2.3);
        col += vec3(1.0, 0.3, 0.05) * heat * heat * 1.4 * flick;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uFlag);
      }
    `,
    blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  return mesh;
}
