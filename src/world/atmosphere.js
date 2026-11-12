import { range } from '../core/rng.js';
import { TAU } from '../core/math.js';

// Living night: bonfire flames + embers (and its light), fireflies drifting at the forest edge,
// leaves falling from the canopy near the camera; skyGlow(k): the sky over the clearing burning
// orange (Armageddon, ADR-049) by warming the shared ambient and fog colours.
// (subtle: at the phone's close LOW camera the fog fills most of the frame, and a stronger fog tint
// washed the whole view brown)
const GLOW_AMBIENT = [0.055, 0.018, 0.004]; // added to U.uAmbient at full glow
const GLOW_FOG = [0.007, 0.002, 0.0004]; // added to U.uFogColor
export class Atmosphere {
  constructor(game, forest) {
    this.game = game;
    this.forest = forest;
    this.bonfire = forest.bonfire;
    this.bonfireLit = true;
    this.glow = 0; // the sky glow shown (eases toward the asked one)
    this._glowWant = 0;
    this._glowHold = 0; // s the last skyGlow() call still holds
    this._amb0 = null; // the ambient / fog colours without the glow
    this._fog0 = null;
    this.fireAcc = 0;
    this.emberAcc = 0;
    this.leafAcc = 0;
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

  /**
   * The sky over the clearing glows orange by k (0..1). Call every frame while it should show; it eases
   * in and out (~0.4 s) and lets go 0.2 s after the last call.
   */
  skyGlow(k) {
    const v = Number(k);
    this._glowWant = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    this._glowHold = 0.2;
  }

  _updateGlow(dt) {
    const U = this.game.U;
    if (!U?.uAmbient?.value || !U?.uFogColor?.value) return;
    if (this._glowHold > 0) this._glowHold -= dt;
    else this._glowWant = 0;
    if (this.glow <= 0 && this._glowWant <= 0) return;
    if (!this._amb0) {
      this._amb0 = U.uAmbient.value.clone();
      this._fog0 = U.uFogColor.value.clone();
    }
    this.glow += (this._glowWant - this.glow) * (1 - Math.exp(-dt * 2.5));
    if (this.glow < 0.002 && this._glowWant <= 0) this.glow = 0;
    const g = this.glow, a = this._amb0, f = this._fog0;
    U.uAmbient.value.setRGB(a.r + GLOW_AMBIENT[0] * g, a.g + GLOW_AMBIENT[1] * g, a.b + GLOW_AMBIENT[2] * g);
    U.uFogColor.value.setRGB(f.r + GLOW_FOG[0] * g, f.g + GLOW_FOG[1] * g, f.b + GLOW_FOG[2] * g);
    if (g === 0) {
      this._amb0 = this._fog0 = null; // (back to whatever the colours are now)
    }
  }

  update(dt) {
    this.t += dt;
    this._updateGlow(dt);
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

  setBonfireLit(lit) {
    this.bonfireLit = lit;
    this.light.intensity = lit ? 2.4 : 0;
  }
}
