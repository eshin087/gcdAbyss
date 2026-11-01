import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

// World-space burn map sampled by grass + ground shaders.
//   R = burn (persistent char: grass shrinks to ash glyphs)
//   G = heat (glowing embers, decays over a few seconds)
// Dragon fire calls scorch.burnCircle(x, z, radius, burnAmount, heatAmount).
export class Scorch {
  constructor(U, game, size = 256) {
    this.game = game;
    this.size = size;
    this.extent = CONFIG.world.worldExtent;
    this.min = -this.extent / 2;
    this.cellSize = this.extent / size;
    this.burn = new Float32Array(size * size);
    this.heat = new Float32Array(size * size);
    this.active = new Set();
    this.data = new Uint8Array(size * size * 4);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    U.uScorch.value = this.tex;
    U.uScorchBounds.value.set(this.min, this.min, this.extent, 0);
    this.dirty = false;
    this.emberTimer = 0;
  }

  _idx(x, z) {
    const cx = Math.floor((x - this.min) / this.cellSize);
    const cz = Math.floor((z - this.min) / this.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return -1;
    return cz * this.size + cx;
  }

  burnAt(x, z) {
    const i = this._idx(x, z);
    return i < 0 ? 0 : this.burn[i];
  }
  heatAt(x, z) {
    const i = this._idx(x, z);
    return i < 0 ? 0 : this.heat[i];
  }

  burnCircle(x, z, radius, burnAmount = 0.5, heatAmount = 1) {
    const s = this.size;
    const c0x = Math.floor((x - radius - this.min) / this.cellSize);
    const c1x = Math.floor((x + radius - this.min) / this.cellSize);
    const c0z = Math.floor((z - radius - this.min) / this.cellSize);
    const c1z = Math.floor((z + radius - this.min) / this.cellSize);
    for (let cz = Math.max(0, c0z); cz <= Math.min(s - 1, c1z); cz++) {
      for (let cx = Math.max(0, c0x); cx <= Math.min(s - 1, c1x); cx++) {
        const wx = this.min + (cx + 0.5) * this.cellSize;
        const wz = this.min + (cz + 0.5) * this.cellSize;
        const d = Math.hypot(wx - x, wz - z);
        if (d > radius) continue;
        const k = 1 - d / radius;
        const jitter = 0.75 + 0.5 * Math.random();
        const i = cz * s + cx;
        this.burn[i] = Math.min(1, this.burn[i] + burnAmount * k * jitter);
        this.heat[i] = Math.min(1, Math.max(this.heat[i], heatAmount * Math.sqrt(k) * jitter));
        this.active.add(i);
        this._write(i);
      }
    }
    this.dirty = true;
  }

  _write(i) {
    this.data[i * 4] = Math.round(this.burn[i] * 255);
    this.data[i * 4 + 1] = Math.round(this.heat[i] * 255);
  }

  reset() {
    this.burn.fill(0);
    this.heat.fill(0);
    this.data.fill(0);
    this.active.clear();
    this.tex.needsUpdate = true;
  }

  update(dt) {
    if (this.active.size) {
      const decay = Math.exp(-dt * 0.45);
      for (const i of this.active) {
        this.heat[i] *= decay;
        if (this.heat[i] > 0.4) this.burn[i] = Math.min(1, this.burn[i] + dt * 0.08);
        if (this.heat[i] < 0.01) {
          this.heat[i] = 0;
          this.active.delete(i);
        }
        this._write(i);
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }

    // drifting embers above hot ground
    const fx = this.game.fx?.add;
    if (fx && this.active.size) {
      this.emberTimer += dt * Math.min(60, this.active.size * 0.25);
      const arr = this.emberTimer >= 1 ? [...this.active] : null;
      while (this.emberTimer >= 1 && arr) {
        this.emberTimer -= 1;
        const i = arr[Math.floor(Math.random() * arr.length)];
        const h = this.heat[i];
        if (h < 0.15) continue;
        const cx = i % this.size, cz = Math.floor(i / this.size);
        fx.spawn({
          x: this.min + (cx + Math.random()) * this.cellSize,
          y: 0.15,
          z: this.min + (cz + Math.random()) * this.cellSize,
          vx: (Math.random() - 0.5) * 0.6,
          vy: 0.8 + Math.random() * 1.6,
          vz: (Math.random() - 0.5) * 0.6,
          life: 0.6 + Math.random() * 1.2,
          size: 0.16 + Math.random() * 0.12,
          sizeEnd: 0.05,
          glyph: ".'`*",
          color: [2.6 * h + 0.6, 0.9 * h, 0.12],
          colorEnd: [0.6, 0.06, 0.01],
          alpha: 1,
          alphaEnd: 0,
          drag: 0.6,
          flicker: 0.5,
        });
      }
    }
  }
}
