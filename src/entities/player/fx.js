import * as THREE from 'three';

// Glyph-particle effects owned by the knight: sword trail, impact sparks, dust, heal glow,
// burn flames, hurt spray. Every glyph used here is in the world atlas.

const R = (a, b) => a + Math.random() * (b - a);

const COL = {
  trail: [1.4, 1.75, 2.5], trailEnd: [0.1, 0.18, 0.45],
  trailHeavy: [1.9, 2.1, 2.9],
  spark: [3.4, 2.7, 1.6], sparkEnd: [1.4, 0.45, 0.1],
  flash: [4.2, 3.6, 2.6],
  dust: [0.2, 0.18, 0.14], dustEnd: [0.09, 0.08, 0.065],
  heal: [1.3, 1.9, 0.55], healEnd: [0.25, 0.6, 0.12],
  flame: [3.0, 1.35, 0.32], flameEnd: [0.9, 0.12, 0.02],
  ash: [0.34, 0.035, 0.028], ashEnd: [0.1, 0.012, 0.01],
  hurt: [2.2, 1.8, 1.6], hurtEnd: [0.6, 0.15, 0.08],
};

const TRAIL_ALONG = [0.6, 0.8, 1.0];
const TRAIL_ALONG_HEAVY = [0.45, 0.62, 0.8, 1.0];

export class PlayerFx {
  constructor(game, rig) {
    this.game = game;
    this.rig = rig;
    this._v = new THREE.Vector3();
    this.flameAcc = 0;
    this.healAcc = 0;
  }

  get add() {
    return this.game.fx?.add ?? null;
  }
  get alpha() {
    return this.game.fx?.alpha ?? null;
  }

  /** Grey-brown ground puff (roll start/end, landings). */
  dust(x, z, n = 8, power = 1, y = 0.08) {
    const fx = this.alpha;
    if (!fx) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = R(0.6, 1.6) * power;
      fx.spawn({
        x: x + Math.cos(a) * 0.2, y: y + R(0, 0.1), z: z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * sp, vy: R(0.2, 0.7) * power, vz: Math.sin(a) * sp,
        life: R(0.45, 0.85), size: R(0.18, 0.28), sizeEnd: R(0.35, 0.5),
        glyph: '.,:', color: COL.dust, colorEnd: COL.dustEnd,
        alpha: 0.75, alphaEnd: 0, drag: 3, gravity: -0.6, spin: R(-2, 2),
      });
    }
  }

  /** Cold streaks along the outer blade, filling the gap between last and current blade. */
  trail(pa, pb, a, b, heavy) {
    const fx = this.add;
    if (!fx) return;
    const along = heavy ? TRAIL_ALONG_HEAVY : TRAIL_ALONG;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3;
      const ax = pa.x + (a.x - pa.x) * t, ay = pa.y + (a.y - pa.y) * t, az = pa.z + (a.z - pa.z) * t;
      const bx = pb.x + (b.x - pb.x) * t, by = pb.y + (b.y - pb.y) * t, bz = pb.z + (b.z - pb.z) * t;
      for (let k = 0; k < along.length; k++) {
        const f = along[k];
        const size = (heavy ? 0.3 : 0.22) * (0.7 + 0.3 * f);
        fx.spawn({
          x: ax + (bx - ax) * f, y: ay + (by - ay) * f, z: az + (bz - az) * f,
          vx: R(-0.2, 0.2), vy: R(0, 0.3), vz: R(-0.2, 0.2),
          life: R(0.12, 0.2) * (heavy ? 1.3 : 1), size, sizeEnd: size * 0.35,
          glyph: '-~=/\\', color: heavy ? COL.trailHeavy : COL.trail, colorEnd: COL.trailEnd,
          alpha: 0.85, alphaEnd: 0, drag: 2, rot: R(-0.4, 0.4),
        });
      }
    }
  }

  /** White-gold sparks at a sword contact. (dx, dz) = swing direction. */
  sparks(x, y, z, dx, dz, heavy) {
    const fx = this.add;
    if (!fx) return;
    const n = heavy ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const sp = R(1, 4) * (heavy ? 1.4 : 1);
      fx.spawn({
        x, y, z,
        vx: dx * sp + R(-3, 3), vy: R(0.5, 4.5), vz: dz * sp + R(-3, 3),
        life: R(0.18, 0.42), size: R(0.16, 0.26), sizeEnd: 0.05,
        glyph: '+x*', color: COL.spark, colorEnd: COL.sparkEnd,
        alpha: 1, alphaEnd: 0, gravity: -9, drag: 1.8, spin: R(-6, 6),
      });
    }
    fx.spawn({
      x, y, z, life: 0.1, size: heavy ? 1.15 : 0.75, sizeEnd: 0.2,
      glyph: '*', color: COL.flash, colorEnd: COL.spark, alpha: 1, alphaEnd: 0, rot: R(0, 3),
    });
    this.game.lights?.add({ x, y, z, color: [1, 0.8, 0.5], intensity: heavy ? 3.5 : 2.4, radius: heavy ? 6 : 4.5, life: 0.16, fade: 0.14 });
  }

  /** Heavy-slam impact on the ground. */
  slam(x, z) {
    this.dust(x, z, 16, 1.7);
    const fx = this.add;
    if (!fx) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.spawn({
        x, y: 0.1, z, vx: Math.cos(a) * R(1.5, 3), vy: R(1, 3), vz: Math.sin(a) * R(1.5, 3),
        life: R(0.2, 0.35), size: R(0.14, 0.2), sizeEnd: 0.04, glyph: '+x', color: COL.spark, colorEnd: COL.sparkEnd,
        alpha: 1, alphaEnd: 0, gravity: -9, drag: 1.5,
      });
    }
  }

  /** Spray away from the attacker when the knight is hit. (nx, nz) = push direction. */
  hurt(x, y, z, nx, nz, big) {
    const fa = this.alpha, fx = this.add;
    const n = big ? 14 : 8;
    if (fa) {
      for (let i = 0; i < n; i++) {
        const sp = R(1, 3.2);
        fa.spawn({
          x, y: y + R(-0.15, 0.15), z,
          vx: nx * sp + R(-1, 1), vy: R(0.4, 2.2), vz: nz * sp + R(-1, 1),
          life: R(0.35, 0.7), size: R(0.14, 0.24), sizeEnd: 0.06,
          glyph: '.,;', color: COL.ash, colorEnd: COL.ashEnd, alpha: 0.9, alphaEnd: 0, gravity: -6, drag: 1.5,
        });
      }
    }
    if (fx) {
      for (let i = 0; i < (big ? 5 : 3); i++) {
        fx.spawn({
          x, y, z, vx: nx * R(1, 3) + R(-1.5, 1.5), vy: R(0.5, 2.5), vz: nz * R(1, 3) + R(-1.5, 1.5),
          life: R(0.12, 0.25), size: R(0.18, 0.28), sizeEnd: 0.05, glyph: '+x', color: COL.hurt, colorEnd: COL.hurtEnd,
          alpha: 1, alphaEnd: 0, drag: 2, gravity: -4,
        });
      }
    }
  }

  /** Ring of rising gold-green motes the moment a flask takes effect. */
  healBurst(x, z) {
    const fx = this.add;
    if (!fx) return;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + R(-0.1, 0.1);
      const r = R(0.3, 0.5);
      fx.spawn({
        x: x + Math.cos(a) * r, y: R(0.1, 0.5), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.3, vy: R(1.2, 2.2), vz: Math.sin(a) * 0.3,
        life: R(0.7, 1.1), size: R(0.15, 0.22), sizeEnd: 0.05, glyph: '+·', color: COL.heal, colorEnd: COL.healEnd,
        alpha: 1, alphaEnd: 0, drag: 1.2, flicker: 0.3,
      });
    }
  }

  /** Continuous glow while healing (rate scales with k 0..1). */
  healTick(dt, x, z, k) {
    const fx = this.add;
    if (!fx || k <= 0) return;
    this.healAcc += dt * 34 * k;
    while (this.healAcc >= 1) {
      this.healAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = R(0.15, 0.45);
      fx.spawn({
        x: x + Math.cos(a) * r, y: R(0.2, 1.5), z: z + Math.sin(a) * r,
        vx: 0, vy: R(0.6, 1.2), vz: 0,
        life: R(0.6, 1.0), size: R(0.12, 0.18), sizeEnd: 0.04, glyph: '+··', color: COL.heal, colorEnd: COL.healEnd,
        alpha: 0.9, alphaEnd: 0, drag: 0.8, flicker: 0.4,
      });
    }
  }

  /** Small flames licking off random body joints while burning (k 0..1). */
  flames(dt, k) {
    const fx = this.add;
    if (!fx || k <= 0) return;
    this.flameAcc += dt * 28 * k;
    const pts = this.rig.fxPoints;
    while (this.flameAcc >= 1) {
      this.flameAcc -= 1;
      const j = pts[(Math.random() * pts.length) | 0];
      j.getWorldPosition(this._v);
      fx.spawn({
        x: this._v.x + R(-0.12, 0.12), y: this._v.y + R(-0.08, 0.12), z: this._v.z + R(-0.12, 0.12),
        vx: R(-0.3, 0.3), vy: R(0.9, 1.8), vz: R(-0.3, 0.3),
        life: R(0.25, 0.5), size: R(0.16, 0.26), sizeEnd: 0.05, glyph: "*^~'", color: COL.flame, colorEnd: COL.flameEnd,
        alpha: 1, alphaEnd: 0, drag: 1.2, flicker: 0.4, spin: R(-3, 3),
      });
    }
  }

  reset() {
    this.flameAcc = 0;
    this.healAcc = 0;
  }
}
