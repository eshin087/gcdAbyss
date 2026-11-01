import * as THREE from 'three';
import { gi } from './glyphs.js';

// Camera-facing glyph particles (fire, embers, sparks, dust, blood-ash...). Rendered in the FX
// pass AFTER the ASCII grid conversion, with a soft manual depth test against the scene.
//
//   game.fx.add.spawn({ x, y, z, vx, vy, vz, life: 0.8, size: 0.5, sizeEnd: 0.1,
//                       glyph: '*', color: [3, 1.4, 0.4], colorEnd: [0.8, 0.1, 0.02],
//                       alpha: 1, alphaEnd: 0, gravity: -2, drag: 1.5, spin: 3, flicker: 0.3 });
// `glyph` may be a single char, a string (one char picked at random) or an atlas index.
// Colours are linear HDR: values > 1 bloom.

const FIELDS = 26;
// layout: 0 x,1 y,2 z,3 vx,4 vy,5 vz,6 age,7 life,8 size,9 sizeEnd,10 r,11 g,12 b,13 r1,14 g1,15 b1,
// 16 alpha,17 alphaEnd,18 glyph,19 rot,20 spin,21 drag,22 gravity,23 flicker,24 seed,25 stretch

export class GlyphParticles {
  constructor(U, { max = 4000, additive = true } = {}) {
    this.max = max;
    this.count = 0;
    this.data = new Float32Array(max * FIELDS);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iData', this.iData);
    geo.setAttribute('iColor', this.iColor);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.uniforms = {
      uGlyphAtlas: U.uGlyphAtlas,
      uCamRight: U.uCamRight,
      uCamUp: U.uCamUp,
      uDepth: { value: null },
      uRes: U.uResolution,
      uNear: { value: 1 },
      uFar: { value: 200 },
      uSoft: { value: 0.6 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec4 iData;   // size, glyph, rotation, stretch
        attribute vec4 iColor;  // rgb, alpha
        uniform vec3 uCamRight;
        uniform vec3 uCamUp;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vGlyph;
        varying float vViewZ;
        void main() {
          float c = cos(iData.z), s = sin(iData.z);
          vec2 p = position.xy * vec2(1.0, 1.0 + iData.w);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          vec3 wp = iPos + (uCamRight * p.x + uCamUp * p.y) * iData.x;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vViewZ = -mv.z;
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          vColor = iColor;
          vGlyph = iData.y;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uGlyphAtlas;
        uniform sampler2D uDepth;
        uniform vec2 uRes;
        uniform float uNear;
        uniform float uFar;
        uniform float uSoft;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vGlyph;
        varying float vViewZ;
        float linearDepth(float d) {
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec2 uv = clamp(vUv, 0.03, 0.97);
          float col = mod(vGlyph, 16.0);
          float row = floor(vGlyph / 16.0);
          float m = texture2D(uGlyphAtlas, vec2((col + uv.x) / 16.0, (7.0 - row + uv.y) / 8.0)).a;
          if (m < 0.02) discard;
          float sceneZ = linearDepth(texture2D(uDepth, gl_FragCoord.xy / uRes).r);
          float fade = clamp((sceneZ - vViewZ) / uSoft, 0.0, 1.0);
          float a = m * vColor.a * fade;
          gl_FragColor = vec4(vColor.rgb * a, a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  spawn(o) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    const d = this.data;
    const k = i * FIELDS;
    let glyph = o.glyph ?? '*';
    if (typeof glyph === 'string') glyph = gi(glyph.length > 1 ? glyph[Math.floor(Math.random() * glyph.length)] : glyph);
    const c0 = o.color ?? [1, 1, 1];
    const c1 = o.colorEnd ?? c0;
    d[k] = o.x ?? 0; d[k + 1] = o.y ?? 0; d[k + 2] = o.z ?? 0;
    d[k + 3] = o.vx ?? 0; d[k + 4] = o.vy ?? 0; d[k + 5] = o.vz ?? 0;
    d[k + 6] = 0; d[k + 7] = Math.max(0.01, o.life ?? 1);
    d[k + 8] = o.size ?? 0.4; d[k + 9] = o.sizeEnd ?? (o.size ?? 0.4);
    d[k + 10] = c0[0]; d[k + 11] = c0[1]; d[k + 12] = c0[2];
    d[k + 13] = c1[0]; d[k + 14] = c1[1]; d[k + 15] = c1[2];
    d[k + 16] = o.alpha ?? 1; d[k + 17] = o.alphaEnd ?? 0;
    d[k + 18] = glyph;
    d[k + 19] = o.rot ?? 0; d[k + 20] = o.spin ?? 0;
    d[k + 21] = o.drag ?? 0; d[k + 22] = o.gravity ?? 0;
    d[k + 23] = o.flicker ?? 0; d[k + 24] = Math.random() * 100; d[k + 25] = o.stretch ?? 0;
    return i;
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt, time) {
    const d = this.data;
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const k = i * FIELDS;
      const age = d[k + 6] + dt;
      if (age >= d[k + 7]) continue;
      if (w !== i) d.copyWithin(w * FIELDS, k, k + FIELDS);
      const o = w * FIELDS;
      d[o + 6] = age;
      const drag = Math.exp(-d[o + 21] * dt);
      d[o + 3] *= drag;
      d[o + 4] = d[o + 4] * drag + d[o + 22] * dt;
      d[o + 5] *= drag;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      d[o + 19] += d[o + 20] * dt;
      w++;
    }
    this.count = w;

    const P = this.iPos.array, D = this.iData.array, C = this.iColor.array;
    for (let i = 0; i < w; i++) {
      const k = i * FIELDS;
      const t = d[k + 6] / d[k + 7];
      P[i * 3] = d[k]; P[i * 3 + 1] = d[k + 1]; P[i * 3 + 2] = d[k + 2];
      D[i * 4] = d[k + 8] + (d[k + 9] - d[k + 8]) * t;
      D[i * 4 + 1] = d[k + 18];
      D[i * 4 + 2] = d[k + 19];
      D[i * 4 + 3] = d[k + 25];
      let a = d[k + 16] + (d[k + 17] - d[k + 16]) * t;
      if (d[k + 23] > 0) a *= 1 - d[k + 23] * (0.5 + 0.5 * Math.sin(time * 23 + d[k + 24]));
      C[i * 4] = d[k + 10] + (d[k + 13] - d[k + 10]) * t;
      C[i * 4 + 1] = d[k + 11] + (d[k + 14] - d[k + 11]) * t;
      C[i * 4 + 2] = d[k + 12] + (d[k + 15] - d[k + 12]) * t;
      C[i * 4 + 3] = a;
    }
    this.geometry.instanceCount = w;
    this.iPos.needsUpdate = this.iData.needsUpdate = this.iColor.needsUpdate = true;
  }
}
