import { range } from '../core/rng.js';
import { TAU } from '../core/math.js';

// Living night: bonfire flames + embers (and its light), fireflies drifting at the forest edge,
// leaves falling from the canopy near the camera. A set with `ash: true` (the Ashfall courtyard)
// has ash flakes falling everywhere and a few drifting embers instead of the fireflies, mist and leaves.
export class Atmosphere {
  constructor(game, forest) {
    this.game = game;
    this.forest = forest;
    this.ash = !!forest.ash;
    this.bonfire = forest.bonfire;
    this.bonfireLit = true;
    this.fireAcc = 0;
    this.emberAcc = 0;
    this.leafAcc = 0;
    this.ashAcc = 0;
    this.t = 0;
    this.light = game.lights.add({
      x: this.bonfire.x, y: 1.1, z: this.bonfire.z,
      color: [1.0, 0.46, 0.14], intensity: 2.4, radius: 9.5, flicker: 0.55,
    });
    this.fireflies = Array.from({ length: 70 }, (_, i) => {
      const a = Math.random() * TAU;
      const r = range(Math.random, 22, 46);
      return {
        x: Math.cos(a) * r, z: Math.sin(a) * r, y: range(Math.random, 0.5, 2.8),
        p: Math.random() * 100, s: range(Math.random, 0.4, 1.0), i,
      };
    });
  }

  update(dt) {
    this.t += dt;
    const fxA = this.game.fx.add;
    const fxB = this.game.fx.alpha;
    const bf = this.bonfire;

    if (this.bonfireLit) {
      this.fireAcc += dt * 48;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        const a = Math.random() * TAU, r = Math.random() * 0.32;
        const hot = Math.random();
        fxA.spawn({
          x: bf.x + Math.cos(a) * r, y: 0.25 + Math.random() * 0.15, z: bf.z + Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 0.3, vy: 1.3 + Math.random() * 1.3, vz: (Math.random() - 0.5) * 0.3,
          life: 0.45 + Math.random() * 0.55,
          size: 0.34 + hot * 0.18, sizeEnd: 0.06,
          glyph: "*^'`\"~%",
          color: [3.4, 1.7 + hot * 0.6, 0.5], colorEnd: [0.9, 0.12, 0.02],
          alpha: 1, alphaEnd: 0, drag: 1.2, flicker: 0.25, spin: (Math.random() - 0.5) * 2,
        });
      }
      this.emberAcc += dt * 7;
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        fxA.spawn({
          x: bf.x + (Math.random() - 0.5) * 0.4, y: 0.6, z: bf.z + (Math.random() - 0.5) * 0.4,
          vx: (Math.random() - 0.5) * 0.9, vy: 1.6 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 0.9,
          life: 1.4 + Math.random() * 1.6, size: 0.14, sizeEnd: 0.05,
          glyph: ".·'", color: [2.8, 0.9, 0.2], colorEnd: [0.6, 0.08, 0.01],
          alpha: 1, alphaEnd: 0, drag: 0.4, flicker: 0.6,
        });
      }
    }

    if (this.ash) {
      this._ashFall(dt, fxA, fxB);
      return;
    }

    // fireflies: re-emitted each frame at their wandering positions (life = 1 frame-ish)
    for (const f of this.fireflies) {
      const t = this.t * f.s + f.p;
      f.x += Math.sin(t * 0.7) * dt * 0.6;
      f.z += Math.cos(t * 0.53 + 1.3) * dt * 0.6;
      f.y = Math.max(0.3, f.y + Math.sin(t * 1.3) * dt * 0.35);
      const blink = Math.max(0, Math.sin(t * 1.9)) ** 3;
      if (blink < 0.05) continue;
      fxA.spawn({
        x: f.x, y: f.y, z: f.z, life: dt * 1.5 + 0.001, size: 0.2, glyph: '·',
        color: [1.6 * blink, 2.4 * blink, 0.6 * blink], alpha: 1, alphaEnd: 1,
      });
    }

    // low mist: faint, wide tilde strokes drifting along the forest edge
    const focus = this.game.U.uFocus.value;
    this.mistAcc = (this.mistAcc ?? 0) + dt * 3.2;
    while (this.mistAcc >= 1) {
      this.mistAcc -= 1;
      const a = Math.random() * TAU, r = range(Math.random, 24, 44);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x - focus.x) > 34 || Math.abs(z - focus.z) > 26) continue;
      // low alpha so overlapping strokes build soft banks
      fxB.spawn({
        x, y: range(Math.random, 0.3, 1.2), z,
        vx: 0.35 + Math.random() * 0.25, vy: 0, vz: (Math.random() - 0.5) * 0.15,
        life: 9 + Math.random() * 5, size: range(Math.random, 2.2, 4.2), sizeEnd: 4.8,
        glyph: '~-', color: [0.2, 0.24, 0.3], alpha: 0.07, alphaEnd: 0,
        rot: (Math.random() - 0.5) * 0.15,
      });
    }

    // leaves drifting down near the camera focus, under the canopy ring
    this.leafAcc += dt * 2.2;
    while (this.leafAcc >= 1) {
      this.leafAcc -= 1;
      const a = Math.random() * TAU, r = range(Math.random, 26, 40);
      const x = focus.x + Math.cos(a) * r * 0.6, z = focus.z + Math.sin(a) * r * 0.5;
      if (Math.hypot(x, z) < 27) continue;
      fxB.spawn({
        x, y: range(Math.random, 5, 8), z,
        vx: 0.6 + Math.random() * 0.6, vy: -0.7, vz: (Math.random() - 0.5) * 0.4,
        life: 7, size: 0.28, glyph: ",`'~",
        color: [0.16, 0.26, 0.14], colorEnd: [0.1, 0.14, 0.08],
        alpha: 0.9, alphaEnd: 0.0, spin: (Math.random() - 0.5) * 4, drag: 0.2,
      });
    }
  }

  /** Ash falling round the camera focus: slow grey flakes that sway as they sink, and now and then a
   *  dim ember drifting with them (the sect still smoulders). */
  _ashFall(dt, fxA, fxB) {
    const focus = this.game.U.uFocus.value;
    this.ashAcc += dt * 26;
    while (this.ashAcc >= 1) {
      this.ashAcc -= 1;
      const x = focus.x + (Math.random() - 0.5) * 46, z = focus.z + (Math.random() - 0.5) * 34 - 4;
      const pale = Math.random();
      fxB.spawn({
        x, y: range(Math.random, 4, 9), z,
        vx: 0.25 + Math.random() * 0.35, vy: -0.55 - Math.random() * 0.35, vz: (Math.random() - 0.5) * 0.3,
        life: 9 + Math.random() * 4, size: 0.12 + pale * 0.1, glyph: ".,'`",
        color: [0.3 + pale * 0.12, 0.29 + pale * 0.11, 0.28 + pale * 0.1], colorEnd: [0.16, 0.15, 0.15],
        alpha: 0.85, alphaEnd: 0, spin: (Math.random() - 0.5) * 3, drag: 0.15,
      });
    }
    this.leafAcc += dt * 1.6;
    while (this.leafAcc >= 1) {
      this.leafAcc -= 1;
      const x = focus.x + (Math.random() - 0.5) * 40, z = focus.z + (Math.random() - 0.5) * 30 - 4;
      fxA.spawn({
        x, y: range(Math.random, 0.5, 4), z,
        vx: 0.3 + Math.random() * 0.3, vy: 0.15 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.3,
        life: 3 + Math.random() * 3, size: 0.1, sizeEnd: 0.04, glyph: ".'",
        color: [1.6, 0.5, 0.1], colorEnd: [0.4, 0.06, 0.01], alpha: 1, alphaEnd: 0, drag: 0.3, flicker: 0.5,
      });
    }
  }

  setBonfireLit(lit) {
    this.bonfireLit = lit;
    this.light.intensity = lit ? 2.4 : 0;
  }
}
