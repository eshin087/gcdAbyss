import { TELL, TELL_STYLE, RESULT } from '../../../combat/rules.js';
import { DuelFx } from '../duelist/fx.js';
import { perPhase } from '../duelist/realise.js';

// The Starless Lord's glyph FX (STYLE.md: everything is glyph particles from the world atlas + pooled
// lights), on top of the duelist's (tells, clashes, sparks, sweep trails). His own: the blades of red
// light (a glow of strokes along each blade and a red light that follows it), the Void spells
// (lightning, the push's wall of force, the pull's vortex, the Crushing Dark, the thrown blade, torn
// stone, the Rift, called lightning, the Dark Star), the wake of his glide, form 4's aura, the blink's
// afterimage and the forms' ignitions.
// Thrown things (the blade, the stones, the fissures) fly here: each cues itself `flashLead` before it
// reaches the hero (a glint on it + combat:flash), and one that could only cue too late fizzles on
// touch, as the wyrm's bullets and the Ash Crescent do (COMBAT.md → fairness).

const TAU = Math.PI * 2;
const RED = [3.4, 0.2, 0.12], RED_CORE = [3.9, 0.95, 0.7], RED_END = [0.5, 0.03, 0.02], RED_DIM = [1.5, 0.08, 0.1];
const VOID = [2.6, 0.5, 3.4], VOID_CORE = [4.6, 3.4, 5.2], VOID_END = [0.35, 0.05, 0.6], VOID_DIM = [0.9, 0.16, 1.3]; // Void lightning: violet-white
const GOLD = [3.6, 2.6, 0.9];
const STONE = [0.5, 0.5, 0.58];
const DARK = [0.012, 0.0, 0.02]; // the Dark Star's heart: it drinks the light (the alpha pool)
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class LordFx extends DuelFx {
  constructor(d) {
    super(d);
    this.shots = Array.from({ length: 8 }, () => ({ alive: false }));
    this.strikes = Array.from({ length: 10 }, () => ({ alive: false }));
    this.crushes = Array.from({ length: 2 }, () => ({ alive: false }));
    this.glowAcc = 0;
    this.auraAcc = 0;
    this.castAcc = 0;
    this.wakeAcc = 0;
    this.light = null; // the red light that follows the main blade
    this._pts = new Float32Array(3 * 40);
  }

  reset() {
    super.reset();
    for (const s of this.shots) s.alive = false;
    for (const s of this.strikes) s.alive = false;
    for (const s of this.crushes) s.alive = false;
    this.light?.kill?.();
    this.light = null;
  }

  update(dt, d) {
    super.update(dt, d);
    this.updateShots(dt, d);
    this.updateStrikes(dt, d);
    this.updateCrushes(dt, d);
  }

  /** The on-screen angle of a world direction (for strokes laid along it). */
  _screenRot(dx, dy, dz) {
    const U = this.game.U, Rg = U?.uCamRight?.value, Up = U?.uCamUp?.value;
    const sx = dx * (Rg?.x ?? 1) + dy * (Rg?.y ?? 0) + dz * (Rg?.z ?? 0);
    const sy = dx * (Up?.x ?? 0) + dy * (Up?.y ?? 1) + dz * (Up?.z ?? 0);
    return sx * sx + sy * sy > 1e-10 ? Math.atan2(sy, sx) - Math.PI / 2 : 0;
  }

  /** One stroke from a to b: a '|' laid along it on screen and stretched to its length. Returns the
   *  spawn record before it is spawned (so the caller may set more on it), or null. */
  _stroke(ax, ay, az, bx, by, bz, life, w, color, end = null) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
    if (!(l > 1e-4) || !Number.isFinite(l + ax + ay + az)) return null;
    const o = this._rec((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, life, w, w * 0.4, '|', color, end);
    o.rot = this._screenRot(dx, dy, dz);
    o.stretch = Math.min(4.5, (l / w) * 1.2);
    return o;
  }

  // ---------------------------------------------------------------- the blades of red light
  /** One blade's glow this frame (hilt a → tip b, `k` 0..1 how far it is lit, `hot` > 1 in form 4):
   *  a row of red strokes along it, a white-hot core, re-drawn every frame. */
  bladeGlow(a, b, k = 1, hot = 1) {
    const add = this.add;
    if (!add || !(k > 0.02) || !Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z)) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) * k;
    if (!(len > 0.05)) return;
    const life = Math.max(0.02, (this.game.fxDt ?? this.game.dt ?? 0.016) * 1.6);
    const rot = this._screenRot(dx, dy, dz);
    const n = Math.max(3, Math.round(len / 0.16));
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n) * k;
      const o = this._rec(a.x + dx * u, a.y + dy * u, a.z + dz * u, life, 0.3 * hot, 0.3 * hot, '|', RED, null);
      o.rot = rot;
      o.stretch = 0.5;
      o.alpha = 0.85;
      o.alphaEnd = 0.85;
      add.spawn(o);
      if (i & 1) {
        const c = this._rec(a.x + dx * u, a.y + dy * u, a.z + dz * u, life, 0.17, 0.17, '|', RED_CORE, null);
        c.rot = rot;
        c.stretch = 0.8;
        c.alphaEnd = 1;
        add.spawn(c);
      }
    }
  }

  /** The red light on the main blade (one pooled light, moved every frame; `k` 0 = dark). */
  bladeLight(a, b, k, hot = 1) {
    if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z)) return;
    if (!this.light || this.light.dead) {
      if (!(k > 0.02)) return;
      this.light = this._light({ x: a.x, y: a.y, z: a.z, color: [1.0, 0.12, 0.06], intensity: 0, radius: 6.5, flicker: 0.25 });
    }
    const L = this.light;
    if (!L) return;
    L.x = (a.x + b.x) * 0.5;
    L.y = Math.max(0.6, (a.y + b.y) * 0.5);
    L.z = (a.z + b.z) * 0.5;
    L.intensity = 2.3 * k * hot;
    L.radius = 6.5 + 2 * (hot - 1);
  }

  /** A blade ignites (or dies): sparks thrown off along it, a flash. */
  igniteBurst(a, b, k = 1) {
    if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z)) return;
    for (let i = 0; i < 16 * k; i++) {
      const u = this.rnd(), ang = this.rnd() * TAU, sp = this.rand(1.5, 5);
      this._spawn(this.add, {
        x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u,
        vx: Math.cos(ang) * sp, vy: this.rand(-0.5, 3), vz: Math.sin(ang) * sp,
        life: this.rand(0.2, 0.5), size: this.rand(0.14, 0.26), sizeEnd: 0.04, glyph: "+*'", color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 3, gravity: -4,
      });
    }
    this._light({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, color: [1, 0.2, 0.1], intensity: 5 * k, radius: 8, life: 0.3, fade: 0.25 });
  }

  /** Embers shed by a blade (always a few; more in form 4). */
  bladeEmbers(a, b, dt, k = 1) {
    this.glowAcc += dt * 14 * k;
    while (this.glowAcc >= 1) {
      this.glowAcc -= 1;
      const u = this.rnd();
      this._spawn(this.add, {
        x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u,
        vx: this.rand(-0.4, 0.4), vy: this.rand(0.3, 1.2), vz: this.rand(-0.4, 0.4),
        life: this.rand(0.3, 0.7), size: this.rand(0.08, 0.15), sizeEnd: 0.03, glyph: ".'", color: RED, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 0.8, flicker: 0.5,
      });
    }
  }

  /** Form 4: the Void wreathes him: dark-red wisps rising off the body, arcs crawling over the plate,
   *  and under his feet a slow wheel of marks. */
  aura(x, y, z, dt, k = 1, fx = x, fz = z) {
    this.auraAcc += dt * 38 * k;
    while (this.auraAcc >= 1) {
      this.auraAcc -= 1;
      const a = this.rnd() * TAU, r = this.rand(0.2, 0.55);
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: y + this.rand(-1.0, 0.5), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.4, vy: this.rand(0.8, 2.4), vz: Math.sin(a) * 0.4,
        life: this.rand(0.4, 0.9), size: this.rand(0.16, 0.3), sizeEnd: 0.04, glyph: "~'^`", color: [2.2, 0.16, 0.2], colorEnd: [0.3, 0.02, 0.08], alpha: 0.9, alphaEnd: 0, drag: 1, flicker: 0.4,
      });
      if (this.rnd() < 0.12) {
        const bx = x + this.rand(-0.7, 0.7), by = y + this.rand(-0.9, 0.7), bz = z + this.rand(-0.7, 0.7);
        this.arc(x + this.rand(-0.2, 0.2), y + this.rand(-0.4, 0.4), z + this.rand(-0.2, 0.2), bx, by, bz, 0.3, RED_CORE, RED_END);
      }
    }
    // the wheel on the floor: twelve marks turning slowly, re-drawn every frame
    const life = Math.max(0.02, (this.game.dt ?? 0.016) * 1.6), t = this.d.time ?? 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 0.7, r = 1.25 + 0.06 * Math.sin(t * 3 + i);
      const o = this._rec(fx + Math.cos(a) * r, 0.07, fz + Math.sin(a) * r, life, 0.3, 0.3, i & 1 ? '+' : 'x', RED_DIM, null);
      o.alpha = 0.75 * k;
      o.alphaEnd = 0.75 * k;
      this._spawn(this.add, o);
    }
  }

  /** The wake of his glide: red wisps torn off under him, a ripple on the floor now and then. */
  glideWake(x, z, vx, vz, dt, k = 1) {
    const sp = Math.hypot(vx, vz);
    this.wakeAcc += dt * (16 + 4 * sp) * k;
    while (this.wakeAcc >= 1) {
      this.wakeAcc -= 1;
      const a = this.rnd() * TAU, r = this.rand(0, 0.4);
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: this.rand(0.05, 0.4), z: z + Math.sin(a) * r,
        vx: -vx * 0.25 + this.rand(-0.5, 0.5), vy: this.rand(-0.2, 0.9), vz: -vz * 0.25 + this.rand(-0.5, 0.5),
        life: this.rand(0.25, 0.6), size: this.rand(0.16, 0.3), sizeEnd: 0.04, glyph: "~-'`", rot: this._screenRot(vx, 0, vz) + Math.PI / 2,
        color: [1.9, 0.12, 0.2], colorEnd: [0.16, 0.01, 0.06], alpha: 0.85, alphaEnd: 0, drag: 2,
      });
    }
  }

  // ---------------------------------------------------------------- Void lightning
  /** A small arc from a to b: a few jagged strokes (the Void crawling over him, a mark crackling). */
  arc(ax, ay, az, bx, by, bz, w = 0.22, color = VOID, end = VOID_END, steps = 4) {
    const add = this.add;
    if (!add || !Number.isFinite(ax + ay + az + bx + by + bz)) return;
    let px = ax, py = ay, pz = az;
    const j = 0.18 * Math.hypot(bx - ax, by - ay, bz - az);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = i < steps ? 1 : 0;
      const x = ax + (bx - ax) * t + this.rand(-j, j) * e, y = ay + (by - ay) * t + this.rand(-j, j) * e, z = az + (bz - az) * t + this.rand(-j, j) * e;
      const o = this._stroke(px, py, pz, x, y, z, this.rand(0.05, 0.13), w, color, end);
      if (o) add.spawn(o);
      px = x;
      py = y;
      pz = z;
    }
  }

  /**
   * A bolt from a to b: a white-violet core in a violet sheath, two thinner strands winding round
   * it, forks that die in the air, a burst where it lands. `k` = size; `lit`: its flash of light and
   * its landing burst; `gold`: a bolt thrown back by a perfect parry.
   */
  lightning(ax, ay, az, bx, by, bz, k = 1, lit = true, gold = false) {
    const add = this.add;
    if (!add || !Number.isFinite(ax + ay + az + bx + by + bz)) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (!(len > 0.05)) return;
    const steps = Math.max(3, Math.min(36, Math.round(len / 0.4)));
    const body = gold ? GOLD : VOID, core = gold ? [4.6, 4.2, 3] : VOID_CORE, end = gold ? [0.6, 0.3, 0.05] : VOID_END, dim = gold ? [1.4, 0.9, 0.3] : VOID_DIM;
    const P = this._pts;
    // the core's path: jagged, its ends true
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, j = i > 0 && i < steps ? (0.3 * k * Math.sin(Math.PI * t) + 0.1) : 0;
      P[i * 3] = ax + dx * t + this.rand(-j, j);
      P[i * 3 + 1] = ay + dy * t + this.rand(-j, j);
      P[i * 3 + 2] = az + dz * t + this.rand(-j, j);
    }
    const big = k >= 0.8;
    for (let i = 1; i <= steps; i++) {
      const x0 = P[i * 3 - 3], y0 = P[i * 3 - 2], z0 = P[i * 3 - 1], x1 = P[i * 3], y1 = P[i * 3 + 1], z1 = P[i * 3 + 2];
      const c = this._stroke(x0, y0, z0, x1, y1, z1, this.rand(0.12, 0.22), 0.3 * k, core, end);
      if (c) add.spawn(c);
      if (big) {
        // the sheath: wider, dimmer, it lingers a moment after the core is gone
        const s = this._stroke(x0, y0, z0, x1, y1, z1, this.rand(0.2, 0.34), 0.62 * k, dim, end);
        if (s) {
          s.alpha = 0.6;
          add.spawn(s);
        }
        if (this.rnd() < 0.22 && i < steps) {
          // a fork that dies in the air
          let fx = x1, fy = y1, fz = z1;
          for (let q = 0; q < 3; q++) {
            const nx = fx + this.rand(-0.55, 0.55), ny = fy + this.rand(-0.45, 0.55), nz = fz + this.rand(-0.55, 0.55);
            const f = this._stroke(fx, fy, fz, nx, ny, nz, this.rand(0.06, 0.14), 0.2 * k, body, end);
            if (f) add.spawn(f);
            fx = nx;
            fy = ny;
            fz = nz;
          }
        }
      }
    }
    if (big) {
      // two strands winding round the core
      for (let sIdx = 0; sIdx < 2; sIdx++) {
        const n = Math.max(3, Math.round(steps * 0.6)), ph = this.rnd() * TAU;
        let px = ax, py = ay, pz = az;
        for (let i = 1; i <= n; i++) {
          const t = i / n, w = (i < n ? 0.42 * k : 0) * Math.sin(Math.PI * t), a = ph + t * 9 + sIdx * Math.PI;
          const x = ax + dx * t + Math.cos(a) * w + this.rand(-0.08, 0.08), y = ay + dy * t + Math.sin(a) * w * 0.7, z = az + dz * t + Math.sin(a + 1) * w + this.rand(-0.08, 0.08);
          const o = this._stroke(px, py, pz, x, y, z, this.rand(0.07, 0.16), 0.16 * k, body, end);
          if (o) add.spawn(o);
          px = x;
          py = y;
          pz = z;
        }
      }
    }
    if (lit) {
      this._light({ x: (ax + bx) / 2, y: Math.max(1, (ay + by) / 2), z: (az + bz) / 2, color: gold ? [1, 0.8, 0.4] : [0.7, 0.4, 1], intensity: 5.5 * k, radius: 9 + len * 0.3, life: 0.24, fade: 0.2 });
      this._spawn(add, { x: bx, y: by, z: bz, life: 0.14, size: 1.5 * k, sizeEnd: 0.3, glyph: '*', color: core, colorEnd: end, alpha: 1, alphaEnd: 0, spin: 6 });
      for (let i = 0; i < 14; i++) {
        const a = this.rnd() * TAU, sp = this.rand(2, 7);
        this._spawn(add, { x: bx, y: by, z: bz, vx: Math.cos(a) * sp, vy: this.rand(0, 4.5), vz: Math.sin(a) * sp, life: this.rand(0.15, 0.4), size: 0.2, sizeEnd: 0.04, glyph: '+x*', color: core, colorEnd: end, alpha: 1, alphaEnd: 0, drag: 4 });
      }
      // where it meets the floor it runs out along it
      if (by < 0.8) for (let i = 0; i < 4; i++) {
        const a = this.rnd() * TAU, r = this.rand(0.8, 1.9) * k;
        this.arc(bx, 0.08, bz, bx + Math.cos(a) * r, 0.08, bz + Math.sin(a) * r, 0.2, body, end, 3);
      }
    }
  }

  /** The Void gathering in his hand through a cast's windup (`k` 0..1): arcs snapping off the hand,
   *  motes drawn in to it, and past half-way an arc to the floor now and then. */
  crackle(x, y, z, k, dt, color = VOID) {
    this.castAcc += dt * (22 + 60 * k);
    const add = this.add;
    while (this.castAcc >= 1) {
      this.castAcc -= 1;
      const a = this.rnd() * TAU, e = this.rand(-1, 1), r = this.rand(0.12, 0.36 + 0.26 * k);
      const ex = x + Math.cos(a) * r, ey = y + e * r, ez = z + Math.sin(a) * r;
      const o = this._stroke(x, y, z, ex, ey, ez, this.rand(0.05, 0.12), 0.18, color, VOID_END);
      if (o) add?.spawn(o);
      // a mote drawn in from further out
      const R = this.rand(0.7, 1.3), b = this.rnd() * TAU, h = this.rand(-0.6, 0.6);
      const mx = x + Math.cos(b) * R, my = y + h, mz = z + Math.sin(b) * R, life = this.rand(0.16, 0.28);
      this._spawn(add, { x: mx, y: my, z: mz, vx: (x - mx) / life, vy: (y - my) / life, vz: (z - mz) / life, life, size: 0.12, sizeEnd: 0.04, glyph: ".'", color, colorEnd: VOID_END, alpha: 0.2, alphaEnd: 1 });
      if (k > 0.5 && this.rnd() < 0.1) this.arc(x, y, z, x + this.rand(-0.7, 0.7), 0.06, z + this.rand(-0.7, 0.7), 0.2, color, VOID_END, 5);
    }
    this._spawn(add, { x, y, z, life: 0.06, size: 0.22 + 0.3 * k, sizeEnd: 0.1, glyph: '*', color: [color[0] * (0.6 + k), color[1] * (0.6 + k), color[2] * (0.6 + k)], alpha: 1, alphaEnd: 0.4 });
  }

  // ---------------------------------------------------------------- the push, the pull, crescents, the rift
  throwCrescent(x, z, dx, dz, o) {
    const c = super.throwCrescent(x, z, dx, dz, o);
    if (c) {
      c.style = o.style ?? 'crescent';
      c.speed = o.speed;
      c.radius = o.radius;
      c.half = o.half;
      c.life = o.life;
      c.seed = this.rnd() * 100;
    }
    return c;
  }

  /** The push leaves his palm: a cone of force torn out of the air before him, the floor swept. */
  pushBurst(x, y, z, dx, dz) {
    const base = Math.atan2(dz, dx);
    for (let i = -9; i <= 9; i++) {
      const a = base + (i / 9) * 1.15, ca = Math.cos(a), sa = Math.sin(a), sp = this.rand(11, 16);
      this._spawn(this.add, {
        x: x + ca * 0.5, y: y + this.rand(-0.7, 0.5), z: z + sa * 0.5, vx: ca * sp, vz: sa * sp,
        life: this.rand(0.16, 0.28), size: 0.6, sizeEnd: 1.3, glyph: ')', rot: Math.atan2(sa, ca), color: [2.4, 2.0, 2.3], colorEnd: [0.3, 0.1, 0.3], alpha: 0.9, alphaEnd: 0, drag: 2.5,
      });
    }
    for (let i = 0; i < 18; i++) {
      const a = base + this.rand(-1, 1), sp = this.rand(3, 10);
      this._spawn(this.alpha, { x: x + Math.cos(a) * 0.6, y: 0.12, z: z + Math.sin(a) * 0.6, vx: Math.cos(a) * sp, vy: this.rand(0.4, 2.2), vz: Math.sin(a) * sp, life: this.rand(0.3, 0.7), size: 0.22, sizeEnd: 0.7, glyph: ".,'~", color: [0.3, 0.27, 0.32], alpha: 0.8, alphaEnd: 0, drag: 2.4 });
    }
    this._light({ x, y, z, color: [0.9, 0.75, 1], intensity: 4, radius: 8, life: 0.2, fade: 0.18 });
  }

  _drawCrescent(c) {
    const life = Math.max(0.02, (this.game.fxDt ?? this.game.dt ?? 0.016) * 1.7);
    const px = -c.dz, pz = c.dx, rot = Math.atan2(c.dz, c.dx);
    if (c.style === 'push') {
      // a wall of force: ranks of pale strokes bowed forward and standing as tall as a man, a shimmer
      // of upright strokes through it, the dust of the floor torn along behind
      const half = c.half ?? 2.4, t = c.age ?? 0;
      for (let rank = 0; rank < 3; rank++) {
        const back = rank * 0.42, n = 9 - rank * 2, col = rank === 0 ? [2.6, 2.2, 2.6] : [1.2 - rank * 0.3, 0.3, 0.6];
        for (let i = -n; i <= n; i++) {
          const u = i / n, bow = 0.7 * (1 - u * u) - back;
          const o = this._rec(c.x + px * u * half + c.dx * bow, 0.25 + 1.6 * ((i + n + rank) % 3) / 2.2, c.z + pz * u * half + c.dz * bow, life, 0.5 - rank * 0.1, 0.5, ')', col, null);
          o.rot = rot;
          o.alphaEnd = 1;
          o.alpha = rank === 0 ? 1 : 0.7;
          this._spawn(this.add, o);
        }
      }
      for (let i = 0; i < 5; i++) {
        const u = Math.sin(t * 23 + i * 2.4 + (c.seed ?? 0)), bow = 0.7 * (1 - u * u);
        const o = this._rec(c.x + px * u * half + c.dx * bow, 1.0, c.z + pz * u * half + c.dz * bow, life, 0.34, 0.34, '|', [1.6, 1.3, 1.9], null);
        o.stretch = 2.6;
        o.alpha = 0.55;
        o.alphaEnd = 0.55;
        this._spawn(this.add, o);
      }
      for (let i = 0; i < 2; i++) {
        this._spawn(this.alpha, {
          x: c.x + this.rand(-half, half) * px, y: 0.15, z: c.z + this.rand(-half, half) * pz,
          vx: c.dx * 3, vy: this.rand(0.4, 1.8), vz: c.dz * 3, life: this.rand(0.3, 0.6), size: 0.24, sizeEnd: 0.65, glyph: ".,'~", color: [0.3, 0.27, 0.32], alpha: 0.8, alphaEnd: 0, drag: 2,
        });
      }
      return;
    }
    if (c.style === 'rift') {
      // a fissure racing along the floor: a bright jagged head, red light bursting up out of the
      // crack behind it, the crack itself left glowing for a moment
      const t = c.age ?? 0, jag = Math.sin(t * 40 + (c.seed ?? 0)) * 0.22;
      const hx = c.x + px * jag, hz = c.z + pz * jag;
      for (let i = -1; i <= 1; i++) {
        const o = this._rec(hx + px * i * 0.26 - c.dx * Math.abs(i) * 0.3, 0.1, hz + pz * i * 0.26 - c.dz * Math.abs(i) * 0.3, life, 0.5, 0.5, i === 0 ? '^' : i < 0 ? '/' : '\\', i === 0 ? RED_CORE : RED, null);
        o.rot = rot - Math.PI / 2;
        o.alphaEnd = 1;
        this._spawn(this.add, o);
      }
      // the scar it leaves
      const s = this._rec(hx, 0.06, hz, this.rand(0.5, 0.8), 0.34, 0.2, "v<>x"[Math.floor(this.rnd() * 4)], RED, RED_END);
      s.rot = this.rnd() * TAU;
      s.alphaEnd = 0;
      this._spawn(this.add, s);
      for (let i = 0; i < 3; i++) {
        const b = this.rand(0, 1.3), w = this.rand(-0.14, 0.14);
        const o = this._rec(c.x - c.dx * b + px * w, 0.1, c.z - c.dz * b + pz * w, this.rand(0.16, 0.34), 0.26, 0.08, '|', i ? RED : RED_CORE, RED_END);
        o.vy = this.rand(3.5, 8) * (1 - b * 0.5);
        o.stretch = 1.8;
        o.alphaEnd = 0;
        this._spawn(this.add, o);
      }
      if (this.rnd() < 0.5) this._spawn(this.alpha, { x: hx, y: 0.1, z: hz, vx: this.rand(-1.5, 1.5), vy: this.rand(1, 3.5), vz: this.rand(-1.5, 1.5), life: this.rand(0.3, 0.6), size: 0.16, sizeEnd: 0.05, glyph: "#,.'", color: STONE, alpha: 1, alphaEnd: 0, gravity: -9 });
      return;
    }
    // a crescent of red light: a bowed blade of strokes standing off the floor, a hot core, embers
    for (let i = -4; i <= 4; i++) {
      const u = i / 4, bow = 0.4 * (1 - u * u);
      const o = this._rec(c.x + px * u * 1.0 + c.dx * bow, 0.6 + 0.16 * (1 - u * u), c.z + pz * u * 1.0 + c.dz * bow, life, 0.5, 0.5, ')', Math.abs(i) <= 1 ? RED_CORE : RED, null);
      o.rot = rot;
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    for (let i = -2; i <= 2; i++) {
      const u = i / 2.6, bow = 0.4 * (1 - u * u) - 0.28;
      const o = this._rec(c.x + px * u + c.dx * bow, 0.6, c.z + pz * u + c.dz * bow, life, 0.4, 0.4, ')', RED_DIM, null);
      o.rot = rot;
      o.alpha = 0.6;
      o.alphaEnd = 0.6;
      this._spawn(this.add, o);
    }
    this._spawn(this.add, { x: c.x + this.rand(-0.7, 0.7) * px, y: 0.3, z: c.z + this.rand(-0.7, 0.7) * pz, vx: -c.dx * 2, vy: this.rand(0.3, 1.2), vz: -c.dz * 2, life: this.rand(0.2, 0.5), size: 0.14, sizeEnd: 0.04, glyph: ".'", color: RED, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 2 });
  }

  _fizzle(c) {
    const col = c.style === 'push' ? [1.6, 1.4, 1.5] : RED;
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * TAU, sp = this.rand(1, 5);
      this._spawn(this.add, { x: c.x, y: 0.7, z: c.z, vx: Math.cos(a) * sp, vy: this.rand(0, 2.5), vz: Math.sin(a) * sp, life: this.rand(0.2, 0.5), size: 0.2, sizeEnd: 0.05, glyph: ")'.", color: col, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 3 });
    }
  }

  /** The pull's windup: the air drawn from the hero down a narrowing vortex into his hand, and a
   *  taut line between the two. */
  pullStream(hx, hy, hz, px, py, pz, k, dt) {
    const dx = hx - px, dy = hy - py, dz = hz - pz, l = Math.hypot(dx, dy, dz) || 1;
    // two unit vectors across the line
    const ux = -dz / (Math.hypot(dx, dz) || 1), uz = dx / (Math.hypot(dx, dz) || 1);
    this.glowAcc += dt * (34 + 70 * k);
    const t = this.d.time ?? 0;
    while (this.glowAcc >= 1) {
      this.glowAcc -= 1;
      const u = this.rnd(), ang = u * 11 - t * 14 + (this.rnd() < 0.5 ? Math.PI : 0), r = (0.75 * (1 - u) + 0.1) * (0.5 + 0.5 * k);
      const x = px + dx * u + ux * Math.cos(ang) * r, y = py + dy * u + Math.sin(ang) * r, z = pz + dz * u + uz * Math.cos(ang) * r;
      const sp = 9 + 7 * k;
      const o = this._rec(x, y, z, this.rand(0.1, 0.2), 0.24, 0.07, '-', [2.6, 0.22, 0.4], RED_END);
      o.vx = (dx / l) * sp;
      o.vy = (dy / l) * sp;
      o.vz = (dz / l) * sp;
      o.rot = this._screenRot(dx, dy, dz) + Math.PI / 2;
      o.stretch = 1.5;
      this.add?.spawn(o);
    }
    // the line: a few strokes along it, flickering
    const life = Math.max(0.02, (this.game.dt ?? 0.016) * 1.6);
    for (let i = 0; i < 6; i++) {
      const u0 = (i + this.rnd() * 0.4) / 6, u1 = u0 + 0.1;
      const o = this._stroke(px + dx * u0, py + dy * u0, pz + dz * u0, px + dx * u1, py + dy * u1, pz + dz * u1, life, 0.1, [1.6 + 1.6 * k, 0.1, 0.3], null);
      if (o) {
        o.alpha = 0.5 + 0.5 * k;
        o.alphaEnd = o.alpha;
        this.add?.spawn(o);
      }
    }
  }

  // ---------------------------------------------------------------- the Crushing Dark
  /** The grip's windup round the hero (x, y, z = his chest; `k` 0..1): five talons of the Void
   *  closing in on him from above, a ring tightening on the floor. Re-drawn every frame. */
  gripClaw(x, y, z, k) {
    const add = this.add;
    if (!add || !Number.isFinite(x + y + z)) return;
    const life = Math.max(0.02, (this.game.dt ?? 0.016) * 1.6), t = this.d.time ?? 0;
    const R = 1.75 - 0.85 * k, col = [1.2 + 2.2 * k, 0.1, 0.16 + 0.3 * k];
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * TAU + t * 1.4;
      let px = x + Math.cos(a) * R * 0.25, py = y + R * 1.05, pz = z + Math.sin(a) * R * 0.25;
      for (let i = 1; i <= 4; i++) {
        const u = i / 4, th = u * (1.25 + 0.5 * k); // how far down the sphere the talon has curled
        const nx = x + Math.cos(a) * R * Math.sin(th), ny = y + R * Math.cos(th) * 1.05, nz = z + Math.sin(a) * R * Math.sin(th);
        const o = this._stroke(px, py, pz, nx, ny, nz, life, 0.2 + 0.08 * (1 - u), i === 4 ? RED_CORE : col, null);
        if (o) {
          o.alpha = 0.5 + 0.5 * k;
          o.alphaEnd = o.alpha;
          add.spawn(o);
        }
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU - t * 2, r = R * 0.95;
      const o = this._rec(x + Math.cos(a) * r, 0.07, z + Math.sin(a) * r, life, 0.34, 0.34, ')', col, null);
      o.rot = a + Math.PI;
      o.alpha = 0.6 + 0.4 * k;
      o.alphaEnd = o.alpha;
      add.spawn(o);
    }
  }

  /** The hand closed on nothing: the talons snap shut and scatter. */
  gripSnap(x, y, z) {
    for (let i = 0; i < 20; i++) {
      const a = this.rnd() * TAU, e = this.rand(-0.3, 1), r = 0.9, life = this.rand(0.1, 0.2);
      const sx = x + Math.cos(a) * r, sy = y + e * r, sz = z + Math.sin(a) * r;
      this._spawn(this.add, { x: sx, y: sy, z: sz, vx: (x - sx) / life * 0.8, vy: (y - sy) / life * 0.8, vz: (z - sz) / life * 0.8, life, size: 0.26, sizeEnd: 0.06, glyph: "-'~", color: RED, colorEnd: RED_END, alpha: 1, alphaEnd: 0 });
    }
  }

  /** The hand closed on the hero: for `dur` s the Void presses him into the floor at (x, z). */
  gripCrush(x, z, dur = 0.55) {
    const c = this.crushes.find((p) => !p.alive) ?? this.crushes[0];
    Object.assign(c, { alive: true, x, z, t: 0, dur });
    this._light({ x, y: 1, z, color: [1, 0.15, 0.2], intensity: 5, radius: 7, life: dur, fade: 0.3 });
    return c;
  }

  updateCrushes(dt) {
    const add = this.add;
    for (const c of this.crushes) {
      if (!c.alive) continue;
      c.t += dt;
      const k = clamp01(c.t / c.dur), life = Math.max(0.02, dt * 1.6);
      // three rings closing on him, strokes driven down onto him from above
      for (let ring = 0; ring < 3; ring++) {
        const r = (1.5 - ring * 0.42) * (1 - 0.75 * k) + 0.16, n = 12 - ring * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + c.t * (5 + ring * 2) * (ring & 1 ? -1 : 1);
          const o = this._rec(c.x + Math.cos(a) * r, 0.08 + ring * 0.02, c.z + Math.sin(a) * r, life, 0.36, 0.36, ')', ring === 0 ? RED : RED_CORE, null);
          o.rot = a + Math.PI;
          o.alphaEnd = 1;
          this._spawn(add, o);
        }
      }
      for (let i = 0; i < 3; i++) {
        const a = this.rnd() * TAU, r = this.rand(0, 0.7);
        const o = this._rec(c.x + Math.cos(a) * r, this.rand(1.6, 2.6), c.z + Math.sin(a) * r, this.rand(0.1, 0.18), 0.22, 0.08, '|', [2.6, 0.2, 0.4], RED_END);
        o.vy = -this.rand(9, 14);
        o.stretch = 2.2;
        this._spawn(add, o);
      }
      if (c.t >= c.dur) {
        c.alive = false;
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * TAU, sp = this.rand(5, 9);
          this._spawn(add, { x: c.x, y: 0.2, z: c.z, vx: Math.cos(a) * sp, vy: this.rand(0, 1.5), vz: Math.sin(a) * sp, life: this.rand(0.2, 0.4), size: 0.5, sizeEnd: 0.9, glyph: ')', rot: Math.atan2(-Math.sin(a), Math.cos(a)), color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 3 });
        }
        this.game.shake?.(0.3);
        this.game.world?.scorch?.burnCircle?.(c.x, c.z, 1.1, 0.3, 0.8);
      }
    }
  }

  // ---------------------------------------------------------------- thrown things: the blade, torn stone
  /**
   * Throw something. o: { kind 'glaive' | 'stone', x, y, z, dx, dz, speed, radius, life, tell, damage,
   * knockback, attack, delay (s it hangs in the air first), big, range, back (the glaive's return
   * speed), orbit: { r, a, w } (a stone turns round him at radius r from angle a at w rad/s while it hangs) }.
   */
  throwShot(o) {
    const s = this.shots.find((p) => !p.alive);
    if (!s) return null;
    const l = Math.hypot(o.dx, o.dz) || 1;
    Object.assign(s, {
      alive: true, kind: o.kind, x: o.x, y: o.y ?? 1, z: o.z, ox: o.x, oz: o.z, dx: o.dx / l, dz: o.dz / l, speed: o.speed, radius: o.radius ?? 0.8, life: o.life ?? 2.5,
      tell: o.tell ?? TELL.NORMAL, damage: o.damage ?? 14, kb: o.knockback ?? 1.2, attack: o.attack ?? 'thrown', age: 0, flashed: -1, done: false,
      wait: 0, delay: o.delay ?? 0, big: !!o.big, range: o.range ?? 12, back: o.back ?? o.speed, phase: o.delay > 0 ? 'hang' : 'fly', spin: this.rnd() * TAU, hx: o.x, hz: o.z, rise: o.rise ?? 1.8,
      orbit: o.orbit ?? null,
    });
    return s;
  }

  get shotsAlive() {
    return this.shots.some((s) => s.alive);
  }

  updateShots(dt, d) {
    const p = this.game.player, pp = p?.position, lead = perPhase(d.T.flashLead, d.phase);
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.age += dt;
      s.spin += dt * (s.kind === 'glaive' ? 26 : 5);
      if (s.phase === 'hang') {
        // torn from the floor: it rises, turning round him in the Void's grip, until its turn to fly
        const k = Math.min(1, s.age / Math.max(0.2, s.delay * 0.7));
        s.y = 0.2 + (s.rise - 0.2) * (1 - (1 - k) * (1 - k));
        if (s.orbit) {
          const a = s.orbit.a + s.orbit.w * s.age;
          s.x = d.position.x + Math.cos(a) * s.orbit.r;
          s.z = d.position.z + Math.sin(a) * s.orbit.r;
        }
        this._drawStone(s, true);
        if (s.age >= s.delay) {
          s.phase = 'fly';
          s.age = 0;
          // thrown at where the hero is now
          if (pp) {
            const dx = pp.x - s.x, dz = pp.z - s.z, l = Math.hypot(dx, dz) || 1;
            s.dx = dx / l;
            s.dz = dz / l;
          }
          s.ox = s.x;
          s.oz = s.z;
        }
        continue;
      }
      if (s.phase === 'back') {
        // the blade comes home to his hand (it hangs a moment where it turned: time for its cue)
        const hx = d._hilt.x - s.x, hz = d._hilt.z - s.z, l = Math.hypot(hx, hz);
        if (l < 1.1 || d.mode === 'dying' || d.mode === 'dead') {
          s.alive = false;
          d.onGlaiveBack?.();
          continue;
        }
        s.dx = hx / l;
        s.dz = hz / l;
        if (s.wait > 0) s.wait -= dt;
        else {
          s.x += s.dx * s.back * dt;
          s.z += s.dz * s.back * dt;
        }
      } else {
        s.x += s.dx * s.speed * dt;
        s.z += s.dz * s.speed * dt;
        if (s.kind === 'stone') s.y += (0.95 - s.y) * Math.min(1, dt * 6);
      }
      if (s.kind === 'glaive' && s.phase === 'fly' && (Math.hypot(s.x - s.ox, s.z - s.oz) >= s.range || Math.hypot(s.x, s.z) > d.bound + 6)) {
        s.phase = 'back';
        s.wait = 0.32;
        s.flashed = -1;
        s.done = false;
      }
      if (s.age > s.life + (s.kind === 'glaive' ? 3 : 0) || Math.hypot(s.x, s.z) > 60) {
        s.alive = false;
        if (s.kind === 'glaive') d.onGlaiveBack?.();
        continue;
      }
      if (s.kind === 'glaive') this._drawGlaive(s);
      else this._drawStone(s, false);
      if (!pp || s.done || p.alive === false) continue;
      const rx = pp.x - s.x, rz = pp.z - s.z;
      const along = rx * s.dx + rz * s.dz, across = Math.abs(-rx * s.dz + rz * s.dx);
      const reach = s.radius + (p.radius ?? 0.45), half = s.radius + 0.5;
      const speed = s.phase === 'back' ? s.back : s.speed;
      if (across < half && along > 0 && s.flashed < 0 && (along - reach) / speed + Math.max(0, s.wait ?? 0) <= lead) {
        s.flashed = s.age;
        d.emit('combat:flash', { source: 'dragon', attack: s.attack, tell: s.tell, x: s.x, y: s.y, z: s.z, hazard: true, bullet: true });
        this.tellFlash(s.tell, s.x, s.y, s.z);
      }
      if (across < half && Math.abs(along) <= reach) {
        s.done = true;
        const cued = s.flashed >= 0 ? s.age - s.flashed : 0;
        if (s.flashed < 0 || cued < 0.2) {
          // announced too late (the hero ran into it point-blank): it only breaks
          if (s.kind === 'stone') this._shatter(s);
          continue;
        }
        const red = s.tell === TELL.RED;
        const r = d.hitPlayer({
          damage: s.damage, knockback: s.kb, knockdown: red, kind: 'thrown', tell: s.tell, attack: s.attack, from: { x: s.x - s.dx, z: s.z - s.dz },
          projectile: true, light: !red, parryPosture: s.kind === 'glaive' ? 14 : 8, extra: red ? { plunge: false } : null,
        });
        if (s.kind === 'stone') this._shatter(s);
        else if (r === RESULT.PARRIED && s.phase === 'fly') {
          // the blade struck aside: it turns for home at once
          s.phase = 'back';
          s.wait = 0;
          s.flashed = -1;
          s.done = true; // (its way home starts from the hero: no second pass through him)
        }
      }
    }
  }

  _drawGlaive(s) {
    const life = Math.max(0.02, (this.game.fxDt ?? this.game.dt ?? 0.016) * 1.6);
    const c = Math.cos(s.spin), sn = Math.sin(s.spin);
    for (let i = -4; i <= 4; i++) {
      const u = i / 4, x = s.x + c * u * 0.95, z = s.z + sn * u * 0.95;
      const o = this._rec(x, s.y, z, life, 0.3, 0.3, '|', i === 0 ? [1.2, 1.2, 1.3] : Math.abs(i) === 4 ? RED_CORE : RED, null);
      o.rot = this._screenRot(c, 0, sn);
      o.stretch = 0.6;
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    // the disc it draws in the air: a wheel of fading arcs behind each end of the blade
    for (let e = 0; e < 2; e++) {
      for (let i = 0; i < 5; i++) {
        const a = s.spin + e * Math.PI - 0.35 - i * 0.42, x = s.x + Math.cos(a) * 0.95, z = s.z + Math.sin(a) * 0.95;
        this._spawn(this.add, { x, y: s.y, z, life: 0.08, size: 0.26, sizeEnd: 0.08, glyph: ')', rot: this._screenRot(-Math.sin(a), 0, Math.cos(a)), color: RED, colorEnd: RED_END, alpha: 0.85 - i * 0.16, alphaEnd: 0 });
      }
    }
    if (this.rnd() < 0.6) this._spawn(this.add, { x: s.x + this.rand(-0.8, 0.8), y: s.y, z: s.z + this.rand(-0.8, 0.8), vx: -s.dx * 3, vy: this.rand(-0.5, 1), vz: -s.dz * 3, life: this.rand(0.2, 0.45), size: 0.13, sizeEnd: 0.03, glyph: ".'", color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 2 });
  }

  _drawStone(s, hang) {
    const life = Math.max(0.02, (this.game.fxDt ?? this.game.dt ?? 0.016) * 1.6);
    const k = s.big ? 1.7 : 1, n = s.big ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const a = s.spin + (i / n) * TAU, r = i === 0 ? 0 : 0.26 * k, e = Math.sin(a * 1.7 + i) * 0.5;
      const o = this._rec(s.x + Math.cos(a) * r, s.y + e * r, s.z + Math.sin(a) * r, life, 0.42 * k, 0.42 * k, '#&%@8'[i % 5], s.big ? [0.75, 0.3, 0.3] : STONE, null);
      o.alphaEnd = 1;
      this._spawn(this.alpha, o);
    }
    // the Void's red grip on it
    const g = this._rec(s.x, s.y, s.z, life, (s.big ? 1.5 : 0.9), (s.big ? 1.5 : 0.9), 'o', s.big ? [2.6, 0.2, 0.14] : [1.1, 0.1, 0.12], null);
    g.alphaEnd = 1;
    g.alpha = 0.7;
    this._spawn(this.add, g);
    if (hang) {
      if (this.rnd() < 0.5) this._spawn(this.alpha, { x: s.x + this.rand(-0.3, 0.3), y: s.y - 0.2, z: s.z + this.rand(-0.3, 0.3), vy: -this.rand(1, 3), life: this.rand(0.2, 0.5), size: 0.14, sizeEnd: 0.05, glyph: ".,'", color: [0.3, 0.3, 0.34], alpha: 0.9, alphaEnd: 0 });
      // a thread of the Void from his hand to the stone it holds
      const h = this.d._hand;
      if (h && this.rnd() < 0.3) this.arc(h.x, h.y, h.z, s.x, s.y, s.z, 0.14, [2.2, 0.16, 0.3], RED_END, 5);
    } else if (this.rnd() < 0.7) {
      this._spawn(this.add, { x: s.x, y: s.y, z: s.z, vx: -s.dx * 2, vy: this.rand(-0.3, 0.6), vz: -s.dz * 2, life: this.rand(0.15, 0.35), size: 0.2 * k, sizeEnd: 0.04, glyph: "-'", rot: this._screenRot(s.dx, 0, s.dz) + Math.PI / 2, color: s.big ? RED : RED_DIM, colorEnd: RED_END, alpha: 0.8, alphaEnd: 0 });
    }
  }

  /** A stone tears out of the floor (dust and chips where it left). */
  tearUp(x, z) {
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * TAU, sp = this.rand(1, 4);
      this._spawn(this.alpha, { x, y: 0.15, z, vx: Math.cos(a) * sp, vy: this.rand(1, 4), vz: Math.sin(a) * sp, life: this.rand(0.3, 0.7), size: 0.24, sizeEnd: 0.5, glyph: ",.`#", color: [0.26, 0.26, 0.3], alpha: 0.8, alphaEnd: 0, drag: 2.5, gravity: -6 });
    }
  }

  _shatter(s) {
    s.alive = false;
    for (let i = 0; i < (s.big ? 22 : 12); i++) {
      const a = this.rnd() * TAU, sp = this.rand(1.5, 6);
      this._spawn(this.alpha, { x: s.x, y: s.y, z: s.z, vx: Math.cos(a) * sp + s.dx * 3, vy: this.rand(-1, 4), vz: Math.sin(a) * sp + s.dz * 3, life: this.rand(0.3, 0.7), size: this.rand(0.16, 0.32), sizeEnd: 0.05, glyph: "#%,.'", color: STONE, colorEnd: [0.15, 0.15, 0.18], alpha: 1, alphaEnd: 0, drag: 2, gravity: -9 });
    }
    this.game.shake?.(s.big ? 0.3 : 0.12);
  }

  // ---------------------------------------------------------------- marked ground: called lightning, the Dark Star
  /**
   * Mark the ground at (x, z): it is struck `warn` s from now. o: { damage, knockback, attack, style
   * ('bolt': lightning called down, the default; 'star': the Dark Star), drift (m/s the mark follows
   * the hero until its cue) }.
   */
  callStrike(x, z, r, warn, o = {}) {
    const s = this.strikes.find((p) => !p.alive);
    if (!s) return null;
    Object.assign(s, { alive: true, x, z, r, t: 0, at: warn, flashed: false, damage: o.damage ?? 26, kb: o.knockback ?? 3, attack: o.attack ?? 'storm', style: o.style ?? 'bolt', drift: o.drift ?? 0, acc: 0 });
    return s;
  }

  get strikesAlive() {
    return this.strikes.some((s) => s.alive);
  }

  updateStrikes(dt, d) {
    const p = this.game.player, lead = perPhase(d.T.flashLead, d.phase);
    for (const s of this.strikes) {
      if (!s.alive) continue;
      s.t += dt;
      const star = s.style === 'star';
      if (s.t < s.at) {
        const k = Math.min(1, s.t / s.at);
        if (star && s.drift > 0 && !s.flashed && p?.position && p.alive !== false) {
          // the star follows the hero until its cue (then it is where it will burst)
          const dx = p.position.x - s.x, dz = p.position.z - s.z, l = Math.hypot(dx, dz);
          if (l > 0.05) {
            const step = Math.min(l, s.drift * dt);
            s.x += (dx / l) * step;
            s.z += (dz / l) * step;
            d.clampTarget?.(s);
          }
        }
        this.warnRing(s.x, s.z, s.r, k, dt);
        if (star) this._drawStar(s, k, dt);
        else this._drawMark(s, k, dt);
        if (!s.flashed && s.t >= s.at - lead) {
          s.flashed = true;
          d.emit('combat:tell', { source: 'dragon', attack: s.attack, tell: TELL.RED, impactIn: lead, x: s.x, z: s.z, hazard: true });
          d.emit('combat:flash', { source: 'dragon', attack: s.attack, tell: TELL.RED, x: s.x, y: 0.6, z: s.z, hazard: true });
          this.ringPulse(s.x, s.z, s.r * 0.5);
        }
        continue;
      }
      s.alive = false;
      if (star) this._starBurst(s);
      else {
        this.lightning(s.x + this.rand(-2, 2), 26, s.z + this.rand(-1, 1), s.x, 0.1, s.z, 2.4, true);
        this.ringPulse(s.x, s.z, s.r);
      }
      this.game.world?.scorch?.burnCircle?.(s.x, s.z, s.r * 0.8, 0.3, 0.9);
      this.game.shake?.(star ? 0.4 : 0.22);
      d.emit('dragon:explosion', { x: s.x, z: s.z, radius: s.r });
      const pp = p?.position;
      if (pp && p.alive !== false && Math.hypot(pp.x - s.x, pp.z - s.z) <= s.r + (p.radius ?? 0.45) * 0.5) {
        d.hitPlayer({ damage: s.damage, knockback: s.kb, knockdown: true, kind: star ? 'void' : 'lightning', tell: TELL.RED, parryable: false, blockable: false, attack: s.attack, from: { x: s.x, z: s.z }, extra: { plunge: false } });
      }
    }
  }

  /** A mark waiting for its lightning: arcs crackling up off the floor inside it, and high above it
   *  a wheel of light turning faster, leaders reaching down as the strike nears. */
  _drawMark(s, k, dt) {
    if (this.rnd() < 0.35) this.arc(s.x + this.rand(-s.r, s.r) * 0.6, 0.1, s.z + this.rand(-s.r, s.r) * 0.6, s.x + this.rand(-0.4, 0.4), this.rand(0.6, 1.6), s.z + this.rand(-0.4, 0.4), 0.22, VOID, VOID_END, 3);
    const life = Math.max(0.02, dt * 1.6), H = 8.5, t = s.t;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * (2 + 6 * k), r = 1.3 - 0.5 * k;
      const o = this._rec(s.x + Math.cos(a) * r, H, s.z + Math.sin(a) * r, life, 0.42, 0.42, ')', VOID, null);
      o.rot = a + Math.PI;
      o.alpha = 0.3 + 0.7 * k;
      o.alphaEnd = o.alpha;
      this._spawn(this.add, o);
    }
    if (k > 0.45 && this.rnd() < 0.5) {
      const y0 = H - this.rand(0, 1), y1 = y0 - this.rand(1.2, 3.2) * k;
      this.arc(s.x + this.rand(-0.4, 0.4), y0, s.z + this.rand(-0.4, 0.4), s.x + this.rand(-0.6, 0.6), y1, s.z + this.rand(-0.6, 0.6), 0.2, VOID_CORE, VOID_END, 3);
    }
  }

  /** The Dark Star gathering over its ring: a heart that drinks the light inside a turning rim, the
   *  air spiralling in to it, arcs from it to the floor. */
  _drawStar(s, k, dt) {
    const life = Math.max(0.02, dt * 1.6), y = 1.3 + 0.1 * Math.sin(s.t * 5), R = 0.6 + 0.55 * k;
    for (let i = 0; i < 4; i++) {
      const o = this._rec(s.x + this.rand(-0.1, 0.1) * R, y + this.rand(-0.1, 0.1) * R, s.z + this.rand(-0.1, 0.1) * R, life, R * 1.9, R * 1.9, '@#8M'[i], DARK, null);
      o.alphaEnd = 1;
      o.rot = s.t * 3 + i;
      this._spawn(this.alpha, o);
    }
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + s.t * (3 + 5 * k);
      const o = this._rec(s.x + Math.cos(a) * R, y + Math.sin(a * 2 + s.t * 4) * 0.08, s.z + Math.sin(a) * R, life, 0.26, 0.26, ')', i % 4 ? VOID_DIM : VOID, null);
      o.rot = this._screenRot(Math.cos(a), 0, Math.sin(a));
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    // its corona: short rays standing off the rim, flickering
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU - s.t * 2.2 + Math.sin(s.t * 7 + i) * 0.2, c = Math.cos(a), sn = Math.sin(a), l = 0.25 + 0.3 * k + 0.12 * Math.sin(s.t * 13 + i * 2.1);
      const o = this._stroke(s.x + c * R * 1.05, y + sn * R * 0.35, s.z + sn * R * 1.05, s.x + c * (R + l), y + sn * (R + l) * 0.35, s.z + sn * (R + l), life, 0.14, VOID, null);
      if (o) {
        o.alphaEnd = 1;
        this._spawn(this.add, o);
      }
    }
    // its reach on the floor, in the Void's own colour (the hall's inlays are red): a turning ring of
    // strokes that brightens as it fills, motes of the dark inside it
    const m = Math.max(24, Math.round((TAU * s.r) / 0.42)), b = 0.6 + 0.6 * k;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU - s.t * 0.9;
      const o = this._rec(s.x + Math.cos(a) * s.r, 0.09, s.z + Math.sin(a) * s.r, life, 0.5, 0.5, ')', [VOID[0] * b, VOID[1] * b, VOID[2] * b], null);
      o.rot = a + Math.PI;
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    const ri = s.r * (1 - 0.8 * k), mi = Math.max(10, Math.round((TAU * ri) / 0.6));
    for (let i = 0; i < mi; i++) {
      const a = (i / mi) * TAU + s.t * 1.6;
      const o = this._rec(s.x + Math.cos(a) * ri, 0.08, s.z + Math.sin(a) * ri, life, 0.3, 0.3, '-', VOID_DIM, null);
      o.rot = a + Math.PI / 2;
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    s.acc += dt * (40 + 70 * k);
    while (s.acc >= 1) {
      s.acc -= 1;
      // drawn in along a spiral from the ring's edge
      const a = this.rnd() * TAU, r = s.r * this.rand(0.5, 1.05), h = this.rand(0.05, 2.4), lf = this.rand(0.3, 0.5);
      const sx = s.x + Math.cos(a) * r, sz = s.z + Math.sin(a) * r;
      this._spawn(this.add, {
        x: sx, y: h, z: sz, vx: ((s.x - sx) / lf) - Math.sin(a) * 3, vy: (y - h) / lf, vz: ((s.z - sz) / lf) + Math.cos(a) * 3,
        life: lf, size: 0.2, sizeEnd: 0.05, glyph: "-~'", rot: this._screenRot(-Math.sin(a), 0, Math.cos(a)) + Math.PI / 2, color: this.rnd() < 0.5 ? VOID : RED, colorEnd: VOID_END, alpha: 0.3, alphaEnd: 1, drag: 0.6,
      });
    }
    if (this.rnd() < 0.3 + 0.4 * k) {
      const a = this.rnd() * TAU, r = this.rand(0.4, 1) * s.r * 0.8;
      this.arc(s.x, y, s.z, s.x + Math.cos(a) * r, 0.06, s.z + Math.sin(a) * r, 0.2, VOID, VOID_END, 5);
    }
  }

  /** The Dark Star bursts: the heart flares white, a violet ring races out to its edge, arcs run out
   *  along the floor, the dark is thrown up. */
  _starBurst(s) {
    const add = this.add, y = 1.25;
    this._spawn(add, { x: s.x, y, z: s.z, life: 0.2, size: 3.4, sizeEnd: 0.4, glyph: '*', color: VOID_CORE, colorEnd: VOID_END, alpha: 1, alphaEnd: 0, spin: 8 });
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      this._spawn(add, { x: s.x + ca * 0.5, y: 0.4, z: s.z + sa * 0.5, vx: ca * (s.r / 0.22), vz: sa * (s.r / 0.22), life: 0.26, size: 0.8, sizeEnd: 1.4, glyph: ')', rot: Math.atan2(-sa, ca), color: i & 1 ? VOID_CORE : VOID, colorEnd: VOID_END, alpha: 1, alphaEnd: 0, drag: 0.6 });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + this.rnd(), r = s.r * this.rand(0.8, 1.05);
      this.lightning(s.x, y, s.z, s.x + Math.cos(a) * r, 0.1, s.z + Math.sin(a) * r, 0.7, false);
    }
    for (let i = 0; i < 36; i++) {
      const a = this.rnd() * TAU, sp = this.rand(2, 10);
      this._spawn(this.alpha, { x: s.x, y, z: s.z, vx: Math.cos(a) * sp, vy: this.rand(1, 8), vz: Math.sin(a) * sp, life: this.rand(0.4, 0.9), size: this.rand(0.2, 0.44), sizeEnd: 0.05, glyph: "#@%*'", color: [0.05, 0.0, 0.09], alpha: 1, alphaEnd: 0, drag: 1.5, gravity: -7 });
    }
    this._light({ x: s.x, y: 1.4, z: s.z, color: [0.75, 0.45, 1], intensity: 9, radius: s.r * 3.4, life: 0.5, fade: 0.4 });
  }

  // ---------------------------------------------------------------- the blink, the ignition, the deathblow
  /** A shape left where he stood: his bones traced in dark-red strokes that rise and fade. `segs` =
   *  [x0, y0, z0, x1, y1, z1] per bone (world), `n` of them. */
  afterimage(segs, n) {
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      for (let q = 0; q < 2; q++) {
        const o = this._stroke(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], segs[k + 4], segs[k + 5], this.rand(0.3, 0.5), q ? 0.34 : 0.2, q ? [0.9, 0.05, 0.14] : [2.4, 0.2, 0.3], [0.1, 0, 0.04]);
        if (!o) continue;
        o.vy = 0.5;
        o.alpha = q ? 0.6 : 1;
        this.add?.spawn(o);
      }
    }
  }

  /** He is gone from (x0, z0) and at (x1, z1): a red-black streak between, an implosion where he
   *  stood, a burst where he is. */
  blinkTrail(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const n = Math.max(4, Math.round(len / 0.35));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      for (let h = 0; h < 3; h++) {
        this._spawn(this.add, {
          x: x0 + dx * u + this.rand(-0.15, 0.15), y: 0.4 + h * 0.6, z: z0 + dz * u + this.rand(-0.15, 0.15),
          life: this.rand(0.14, 0.3) + 0.1 * (1 - u), size: 0.34, sizeEnd: 0.06, glyph: '-~', rot: this._screenRot(dx, 0, dz) + Math.PI / 2, stretch: 1.5,
          color: [2.4 * (0.4 + 0.6 * u), 0.14, 0.2], colorEnd: [0.2, 0.01, 0.05], alpha: 1, alphaEnd: 0,
        });
      }
    }
    // where he stood: the air falls in
    for (let i = 0; i < 18; i++) {
      const a = this.rnd() * TAU, r = this.rand(0.8, 1.5), h = this.rand(0.2, 2.2), lf = this.rand(0.14, 0.26);
      this._spawn(this.add, { x: x0 + Math.cos(a) * r, y: h, z: z0 + Math.sin(a) * r, vx: -Math.cos(a) * r / lf, vy: (1.2 - h) / lf, vz: -Math.sin(a) * r / lf, life: lf, size: 0.22, sizeEnd: 0.05, glyph: "-'", color: RED_DIM, colorEnd: [0.1, 0, 0.03], alpha: 0.4, alphaEnd: 1 });
    }
    // where he is: thrown out
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      this._spawn(this.add, { x: x1, y: 1.1, z: z1, vx: Math.cos(a) * 7, vy: this.rand(-1, 1), vz: Math.sin(a) * 7, life: 0.2, size: 0.4, sizeEnd: 0.7, glyph: ')', rot: Math.atan2(-Math.sin(a), Math.cos(a)), color: RED, colorEnd: RED_END, alpha: 0.9, alphaEnd: 0, drag: 4 });
    }
    this._light({ x: x1, y: 1.2, z: z1, color: [1, 0.15, 0.2], intensity: 3.5, radius: 6, life: 0.2, fade: 0.18 });
  }

  /** A form's ignition lands: a pillar of red light through him, a shock ring racing out, arcs along
   *  the floor, glyphs thrown up. */
  igniteNova(x, z, r) {
    const c = TELL_STYLE.red.color;
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      this._spawn(this.add, {
        x: x + ca * 0.8, y: 0.5, z: z + sa * 0.8, vx: ca * (r / 0.3), vz: sa * (r / 0.3),
        life: 0.32, size: 0.8, sizeEnd: 1.3, glyph: ')', rot: Math.atan2(-sa, ca), color: [c[0] * 1.4, c[1] * 0.7, c[2] * 0.5], colorEnd: [c[0] * 0.3, c[1] * 0.15, c[2] * 0.15], alpha: 1, alphaEnd: 0, drag: 0.5,
      });
    }
    // the pillar
    for (let i = 0; i < 34; i++) {
      const a = this.rnd() * TAU, rr = this.rand(0, 0.5), h = this.rand(0, 3);
      const o = this._rec(x + Math.cos(a) * rr, h, z + Math.sin(a) * rr, this.rand(0.3, 0.6), 0.34, 0.1, '|', i % 3 ? RED : RED_CORE, RED_END);
      o.vy = this.rand(9, 20);
      o.stretch = 3;
      this._spawn(this.add, o);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + this.rnd() * 0.5, rr = r * this.rand(0.55, 0.9);
      this.lightning(x, 0.2, z, x + Math.cos(a) * rr, 0.1, z + Math.sin(a) * rr, 0.6, false, false);
    }
    for (let i = 0; i < 30; i++) {
      const a = this.rnd() * TAU, sp = this.rand(2, 9);
      this._spawn(this.add, { x, y: 1, z, vx: Math.cos(a) * sp, vy: this.rand(2, 9), vz: Math.sin(a) * sp, life: this.rand(0.4, 0.9), size: this.rand(0.16, 0.3), sizeEnd: 0.04, glyph: "+*'", color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 1.5, gravity: -8 });
    }
    this._light({ x, y: 1.4, z, color: [1, 0.2, 0.1], intensity: 8, radius: r * 1.6, life: 0.55, fade: 0.45 });
  }

  /** The deathblow goes through him: a burst of red light out of his back. */
  deathblowBurst(x, y, z, dx, dz) {
    for (let i = 0; i < 26; i++) {
      const sp = this.rand(3, 11), a = Math.atan2(dz, dx) + this.rand(-0.5, 0.5);
      this._spawn(this.add, { x, y, z, vx: Math.cos(a) * sp, vy: this.rand(-1, 3.5), vz: Math.sin(a) * sp, life: this.rand(0.25, 0.6), size: this.rand(0.16, 0.34), sizeEnd: 0.04, glyph: "*+'-", color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 3 });
    }
    this._light({ x, y, z, color: [1, 0.25, 0.15], intensity: 6, radius: 9, life: 0.35, fade: 0.3 });
  }
}
