import { MAX_PL } from './shaderLib.js';

// Pool of dynamic point lights (fire breath, fireballs, bonfire, embers). Any number can be
// alive; each frame the MAX_PL most relevant to the camera focus are written to the shaders.
//
//   const l = game.lights.add({ x, y, z, color: [1, 0.45, 0.12], intensity: 3, radius: 9,
//                               life: 0.6, fade: 0.3, flicker: 0.4 });
//   l.x = ...;      // move it any time (or l.set(x, y, z))
//   l.kill();       // fade out over `fade` seconds
export class LightPool {
  constructor(U) {
    this.U = U;
    this.lights = [];
    this.t = 0;
  }

  add({ x = 0, y = 1, z = 0, color = [1, 0.5, 0.15], intensity = 1, radius = 8, life = Infinity, fade = 0.25, fadeIn = 0, flicker = 0 } = {}) {
    const light = {
      x, y, z, color, intensity, radius, life, fade, fadeIn, flicker,
      age: 0,
      seed: Math.random() * 100,
      current: 0,
      dead: false,
      set(nx, ny, nz) {
        this.x = nx; this.y = ny; this.z = nz;
        return this;
      },
      kill() {
        this.life = Math.min(this.life, this.age + this.fade);
      },
    };
    this.lights.push(light);
    return light;
  }

  clear() {
    this.lights.length = 0;
  }

  update(dt, focus) {
    this.t += dt;
    const live = [];
    for (const l of this.lights) {
      l.age += dt;
      if (l.age >= l.life) {
        l.dead = true;
        continue;
      }
      let k = 1;
      if (l.fadeIn > 0) k *= Math.min(1, l.age / l.fadeIn);
      const remaining = l.life - l.age;
      if (remaining < l.fade) k *= remaining / l.fade;
      if (l.flicker > 0) {
        const n = Math.sin(this.t * 17.3 + l.seed) * 0.5 + Math.sin(this.t * 7.1 + l.seed * 2.3) * 0.35 + Math.sin(this.t * 31.7 + l.seed * 0.7) * 0.15;
        k *= 1 - l.flicker * (0.5 + 0.5 * n) * 0.6;
      }
      l.current = l.intensity * k;
      const d = Math.hypot(l.x - focus.x, l.z - focus.z);
      l.score = (l.current * l.radius) / (1 + Math.max(0, d - l.radius) * 0.5);
      live.push(l);
    }
    this.lights = live;
    live.sort((a, b) => b.score - a.score);
    const { uPLPos, uPLCol, uPLRad } = this.U;
    for (let i = 0; i < MAX_PL; i++) {
      const l = live[i];
      if (l && l.current > 0.001) {
        uPLPos.value[i].set(l.x, l.y, l.z);
        uPLCol.value[i].set(l.color[0] * l.current, l.color[1] * l.current, l.color[2] * l.current);
        uPLRad.value[i] = l.radius;
      } else {
        uPLRad.value[i] = 0;
      }
    }
  }
}
