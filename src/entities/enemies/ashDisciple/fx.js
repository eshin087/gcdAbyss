import { TELL, TELL_STYLE, RESULT } from '../../../combat/rules.js';
import { TUNING } from './tuning.js';

// The Ash Disciple's glyph FX (STYLE.md: everything is glyph particles from the world atlas + pooled
// lights). The tells look exactly like the wyrm's (COMBAT.md "Tell presentation": a white glint for
// parryable hits, a red flash for dodge-only ones, a red ground ring for areas), so every boss reads
// the same way. His own: the clash when his guard turns a strike, ash-grey swing trails (ember in
// phase 2), the Ash Crescent's sword qi, and the ash he dissolves into.
// Cosmetic randomness uses its own stream: the seeded sims replay the AI's Math.random draws.

const GLINT_CORE = '*';
const GLINT_RAY = '|';
const SPARKLE_ROT = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
const WHITE = [3.4, 3.2, 2.8];
const GOLD = [3.4, 2.3, 0.75];
const SPARK_END = [0.8, 0.5, 0.2];
const ASH = [0.5, 0.48, 0.46];
const EMBER = [3.2, 1.1, 0.25];
const tellStyle = (t) => TELL_STYLE[t] ?? TELL_STYLE.normal;
const lightColor = (c) => {
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  return [c[0] / m, c[1] / m, c[2] / m];
};

export class DiscipleFx {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this._ns = 0x51ed27;
    this.trailAcc = 0;
    this.emberAcc = 0;
    this.ashAcc = 0;
    this._r = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.1, size: 0.3, sizeEnd: 0.3, glyph: '.', color: [1, 1, 1], colorEnd: null, alpha: 1, alphaEnd: 0, drag: 0, gravity: 0, spin: 0, rot: 0, flicker: 0, stretch: 0 };
    // Ash Crescent projectiles (pooled)
    this.crescents = Array.from({ length: 6 }, () => ({ alive: false, x: 0, z: 0, dx: 0, dz: 1, age: 0, flashed: -1, done: false, tell: TELL.NORMAL, damage: 0, kb: 0, attack: '' }));
  }

  rnd() {
    this._ns = (Math.imul(this._ns, 1664525) + 1013904223) >>> 0;
    return this._ns / 4294967296;
  }
  rand(a, b) {
    return a + this.rnd() * (b - a);
  }
  get add() {
    return this.game.fx?.add;
  }
  get alpha() {
    return this.game.fx?.alpha;
  }
  _spawn(pool, o) {
    if (!pool || !Number.isFinite(o.x + o.y + o.z)) return;
    pool.spawn(o);
  }
  _light(o) {
    return this.game.lights?.add?.(o) ?? null;
  }
  /** The reused spawn record, every field reset. */
  _rec(x, y, z, life, size, sizeEnd, glyph, color, colorEnd = null) {
    const o = this._r;
    o.x = x;
    o.y = y;
    o.z = z;
    o.vx = o.vy = o.vz = 0;
    o.life = life;
    o.size = size;
    o.sizeEnd = sizeEnd;
    o.glyph = glyph;
    o.color = color;
    o.colorEnd = colorEnd;
    o.alpha = 1;
    o.alphaEnd = 0;
    o.drag = o.gravity = o.spin = o.rot = o.flicker = o.stretch = 0;
    return o;
  }

  reset() {
    for (const c of this.crescents) c.alive = false;
  }

  // ---------------------------------------------------------------- tells
  /** The timing cue: a white glint (normal / blue, bigger) or a red flash at (x, y, z). */
  tellFlash(tell, x, y, z) {
    if (!Number.isFinite(x + y + z)) return;
    if (tell === TELL.RED) this._redFlash(x, y, z);
    else this._glint(x, y, z, tellStyle(tell));
  }

  _redFlash(x, y, z) {
    const c = TELL_STYLE.red.color;
    this._spawn(this.add, { x, y, z, life: 0.3, size: 1.2, sizeEnd: 0.3, glyph: '!', color: [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6], colorEnd: c, alpha: 1, alphaEnd: 0 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + this.rand(-0.15, 0.15), sp = this.rand(3, 6.5);
      this._spawn(this.add, {
        x, y, z, vx: Math.cos(a) * sp, vy: this.rand(-1, 3), vz: Math.sin(a) * sp,
        life: this.rand(0.2, 0.36), size: this.rand(0.25, 0.4), sizeEnd: 0.08, glyph: '!#',
        color: c, colorEnd: [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], alpha: 1, alphaEnd: 0, drag: 4, flicker: 0.3,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: lightColor(c), intensity: 3.5, radius: 5, life: 0.3, fade: 0.25 });
  }

  /** The white glint (as the wyrm's, dragon/fx.js _glint, at a human scale), pulled toward the camera. */
  _glint(x, y, z, st) {
    const k = st.glint > 0 ? st.glint : 1;
    const c = st.color;
    const cam = this.game.camera?.position;
    if (cam) {
      const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z, l = Math.hypot(dx, dy, dz);
      if (l > 1e-3) {
        const o = 0.5 / l;
        x += dx * o;
        y += dy * o;
        z += dz * o;
      }
    }
    const add = this.add;
    this._spawn(add, {
      x, y, z, life: 0.26, size: 0.95 * k, sizeEnd: 0.2 * k, glyph: GLINT_CORE,
      color: [c[0] * 1.6 * k, c[1] * 1.6 * k, c[2] * 1.6 * k], colorEnd: [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5], alpha: 1, alphaEnd: 0, rot: this.rand(0, 0.6), spin: 2.5,
    });
    for (let i = 0; i < 4; i++) {
      const long = i < 2;
      this._spawn(add, {
        x, y, z, life: long ? 0.24 : 0.18, size: (long ? 0.5 : 0.32) * k, sizeEnd: 0, glyph: GLINT_RAY, rot: SPARKLE_ROT[i], stretch: long ? 2.6 : 1.4,
        color: [c[0] * 1.3 * k, c[1] * 1.3 * k, c[2] * 1.3 * k], colorEnd: c, alpha: 1, alphaEnd: 0.2,
      });
    }
    const U = this.game.U, Rg = U?.uCamRight?.value, Up = U?.uCamUp?.value;
    const rx = Rg?.x ?? 1, ry = Rg?.y ?? 0, rz = Rg?.z ?? 0, ux = Up?.x ?? 0, uy = Up?.y ?? 1, uz = Up?.z ?? 0;
    const n = k > 1 ? 8 : 6, a0 = this.rand(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), sp = this.rand(5, 7.5) * k;
      this._spawn(add, {
        x, y, z, vx: (rx * ca + ux * sa) * sp, vy: (ry * ca + uy * sa) * sp, vz: (rz * ca + uz * sa) * sp,
        life: this.rand(0.16, 0.24), size: 0.24 * k, sizeEnd: 0.05, glyph: GLINT_RAY, rot: a - Math.PI / 2, stretch: 0.9,
        color: [c[0] * k, c[1] * k, c[2] * k], colorEnd: [c[0] * 0.25, c[1] * 0.25, c[2] * 0.25], alpha: 1, alphaEnd: 0, drag: 7,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: lightColor(c), intensity: 2 * k, radius: 3.5 * k, life: 0.22, fade: 0.2 });
  }

  /** The red ground warning of a dodge-only area (call every frame of its windup): a ring of red
   *  dots with `!` marks, an inner ring closing in as the impact nears (`k` 0 → 1). */
  warnRing(x, z, r, k, dt) {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = TELL_STYLE.red.color, life = Math.max(0.02, dt * 1.6);
    const n = Math.max(16, Math.round((Math.PI * 2 * r) / 0.75));
    const spin = (this.game.time ?? 0) * 0.6;
    const b = 0.45 + 0.55 * k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + spin;
      const o = this._rec(x + Math.cos(a) * r, 0.12, z + Math.sin(a) * r, life, i % 4 ? 0.22 : 0.42, i % 4 ? 0.22 : 0.42, i % 4 ? '•' : '!', [c[0] * b, c[1] * b, c[2] * b], null);
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    const ri = r * (1 - 0.85 * k);
    const m = Math.max(8, Math.round((Math.PI * 2 * ri) / 0.9));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 - spin;
      const o = this._rec(x + Math.cos(a) * ri, 0.1, z + Math.sin(a) * ri, life, 0.2, 0.2, '•', [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6], null);
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
  }

  /** The ring flares as the area lands: red glyphs thrown up round its edge. */
  ringPulse(x, z, r) {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = TELL_STYLE.red.color;
    const n = Math.max(20, Math.min(56, Math.round((Math.PI * 2 * r) / 0.7)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: 0.3, z: z + Math.sin(a) * r, vy: this.rand(2, 4.5),
        life: this.rand(0.28, 0.42), size: 0.5, sizeEnd: 0.2, glyph: '!#', color: [c[0] * 1.3, c[1] * 1.3, c[2] * 1.3], colorEnd: c, alpha: 1, alphaEnd: 0, drag: 3,
      });
    }
  }

  /** The kindling's shock ring racing out to radius r. */
  shockRing(x, z, r) {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = TELL_STYLE.red.color;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      this._spawn(this.add, {
        x: x + ca * 0.8, y: 0.5, z: z + sa * 0.8, vx: ca * (r / 0.3), vz: sa * (r / 0.3),
        life: 0.32, size: 0.7, sizeEnd: 1.2, glyph: ')', rot: Math.atan2(-sa, ca),
        color: [c[0] * 1.2, c[1] * 0.9, c[2] * 0.6], colorEnd: [c[0] * 0.3, c[1] * 0.2, c[2] * 0.2], alpha: 1, alphaEnd: 0, drag: 0.5,
      });
    }
    this._light({ x, y: 1, z, color: [1, 0.45, 0.15], intensity: 5, radius: r * 1.2, life: 0.4, fade: 0.35 });
  }

  // ---------------------------------------------------------------- contact
  /** His guard turns a strike: a white-gold clash at the steel. */
  clash(x, y, z, heavy = false) {
    if (!Number.isFinite(x + y + z)) return;
    this._spawn(this.add, { x, y, z, life: 0.2, size: heavy ? 1.5 : 1.1, sizeEnd: 0.3, glyph: '*', color: [WHITE[0] * 1.4, WHITE[1] * 1.4, WHITE[2] * 1.4], colorEnd: GOLD, alpha: 1, alphaEnd: 0 });
    const n = heavy ? 24 : 16;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(4, heavy ? 12 : 9);
      this._spawn(this.add, {
        x, y, z, vx: Math.cos(a) * sp, vy: this.rand(0, 5), vz: Math.sin(a) * sp,
        life: this.rand(0.18, 0.4), size: this.rand(0.2, 0.36), sizeEnd: 0.04, glyph: "*+x'`",
        color: this.rnd() < 0.5 ? WHITE : GOLD, colorEnd: SPARK_END, alpha: 1, alphaEnd: 0, drag: 3, gravity: 8, stretch: 0.3,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: [1, 0.9, 0.65], intensity: heavy ? 4.5 : 3.5, radius: heavy ? 6 : 5, life: 0.2, fade: 0.18 });
  }

  /** The hero parried his blow: the white-gold burst at the clash (blue: bigger). The core stays
   *  compact: the hero's own parry flash lands on the same spot (player fx.parry), and two big
   *  blooms read as a white blot on a human-sized duel, not a spark. */
  parrySpark(x, y, z, tell = TELL.NORMAL) {
    if (!Number.isFinite(x + y + z)) return;
    const big = tell === TELL.BLUE;
    this._spawn(this.add, { x, y, z, life: big ? 0.2 : 0.16, size: big ? 1.1 : 0.85, sizeEnd: 0.2, glyph: '*', color: [WHITE[0] * 1.5, WHITE[1] * 1.5, WHITE[2] * 1.5], colorEnd: GOLD, alpha: 1, alphaEnd: 0 });
    for (let i = 0; i < (big ? 30 : 22); i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(5, big ? 14 : 12);
      this._spawn(this.add, {
        x, y, z, vx: Math.cos(a) * sp, vy: this.rand(-1, 6), vz: Math.sin(a) * sp,
        life: this.rand(0.2, 0.45), size: this.rand(0.22, 0.4), sizeEnd: 0.05, glyph: "*+x'`",
        color: this.rnd() < 0.5 ? WHITE : GOLD, colorEnd: SPARK_END, alpha: 1, alphaEnd: 0, drag: 3, gravity: 8, stretch: 0.3,
      });
    }
    for (let i = 0; i < (big ? 14 : 10); i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(2.5, 7);
      this._spawn(this.add, {
        x, y, z, vx: Math.cos(a) * sp, vy: this.rand(3, 8), vz: Math.sin(a) * sp,
        life: this.rand(0.5, 0.9), size: this.rand(0.14, 0.24), sizeEnd: 0.04, glyph: ".'`•",
        color: this.rnd() < 0.35 ? WHITE : GOLD, colorEnd: SPARK_END, alpha: 1, alphaEnd: 0, drag: 0.9, gravity: -17, flicker: 0.3,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: [1, 0.88, 0.62], intensity: big ? 5.5 : 4.5, radius: big ? 7.5 : 6, life: 0.25, fade: 0.2 });
  }

  /** Struck: a spray of ash and a few embers along the blow. */
  hitSpark(x, y, z, dx, dz, heavy) {
    if (!Number.isFinite(x + y + z)) return;
    const n = heavy ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const sp = this.rand(1.5, heavy ? 7 : 4.5), ember = this.rnd() < 0.3;
      this._spawn(ember ? this.add : this.alpha, {
        x, y, z, vx: dx * sp + this.rand(-1.5, 1.5), vy: this.rand(0.3, 3), vz: dz * sp + this.rand(-1.5, 1.5),
        life: this.rand(0.3, 0.7), size: this.rand(0.16, 0.3), sizeEnd: 0.05, glyph: ember ? "*'." : ".,'`",
        color: ember ? EMBER : ASH, colorEnd: ember ? [0.5, 0.06, 0.01] : [0.2, 0.19, 0.18], alpha: 1, alphaEnd: 0, drag: 2.2, gravity: ember ? -5 : -3,
      });
    }
  }

  /** Posture broken: a gold burst at the chest. */
  breakBurst(x, y, z) {
    if (!Number.isFinite(x + y + z)) return;
    for (let i = 0; i < 30; i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(2.5, 7);
      this._spawn(this.add, {
        x, y, z, vx: Math.cos(a) * sp, vy: this.rand(1, 5), vz: Math.sin(a) * sp,
        life: this.rand(0.35, 0.7), size: this.rand(0.3, 0.5), sizeEnd: 0.08, glyph: '#*+',
        color: [3.4, 2.4, 0.7], colorEnd: [0.9, 0.3, 0.05], alpha: 1, alphaEnd: 0, drag: 2.5, gravity: 4,
      });
    }
    this._light({ x, y: Math.max(1, y), z, color: [1, 0.75, 0.3], intensity: 4, radius: 7, life: 0.5, fade: 0.4 });
  }

  /** Dazed stars round the hat while his posture is broken (every frame). */
  stunStars(head) {
    if (!head || !Number.isFinite(head.x + head.y + head.z)) return;
    const t = this.game.time ?? 0, life = Math.max(0.02, (this.game.dt ?? 0.016) * 1.6);
    for (let i = 0; i < 3; i++) {
      const a = t * 3.4 + (i / 3) * Math.PI * 2;
      const o = this._rec(head.x + Math.cos(a) * 0.55, head.y + 0.55 + Math.sin(a * 2) * 0.06, head.z + Math.sin(a) * 0.55, life, 0.3, 0.3, i % 2 ? '+' : '*', [2.6, 2.0, 0.6]);
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
  }

  // ---------------------------------------------------------------- the blade
  /** The swing's trail: glyphs left along the tip's path through the active frames. */
  trail(ax, ay, az, bx, by, bz, ember, dt) {
    if (!Number.isFinite(ax + ay + az + bx + by + bz)) return;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.min(6, Math.max(1, Math.round(len / 0.18)));
    for (let i = 0; i < n; i++) {
      const u = (i + this.rnd()) / n;
      this._spawn(ember ? this.add : this.alpha, {
        x: ax + (bx - ax) * u, y: ay + (by - ay) * u, z: az + (bz - az) * u,
        vx: this.rand(-0.3, 0.3), vy: this.rand(0, 0.6), vz: this.rand(-0.3, 0.3),
        life: this.rand(0.14, 0.26), size: this.rand(0.22, 0.34), sizeEnd: 0.05, glyph: ember ? "~'*" : "~-'",
        color: ember ? EMBER : [0.62, 0.6, 0.58], colorEnd: ember ? [0.5, 0.08, 0.01] : [0.18, 0.17, 0.17], alpha: 0.95, alphaEnd: 0, drag: 2,
      });
    }
  }

  /** Phase 2: the kindled blade sheds embers along its length. */
  emberBlade(ax, ay, az, bx, by, bz, dt, k = 1) {
    this.emberAcc += dt * 26 * k;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const u = this.rnd();
      this._spawn(this.add, {
        x: ax + (bx - ax) * u, y: ay + (by - ay) * u, z: az + (bz - az) * u,
        vx: this.rand(-0.4, 0.4), vy: this.rand(0.6, 1.6), vz: this.rand(-0.4, 0.4),
        life: this.rand(0.4, 0.9), size: this.rand(0.1, 0.18), sizeEnd: 0.03, glyph: ".'",
        color: EMBER, colorEnd: [0.4, 0.05, 0.01], alpha: 1, alphaEnd: 0, drag: 0.6, flicker: 0.5,
      });
    }
  }

  /** Dust and ash kicked up by a landing or a hard step. */
  dust(x, z, k = 1) {
    if (!Number.isFinite(x + z)) return;
    for (let i = 0; i < Math.round(8 * k); i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(1, 3) * k;
      this._spawn(this.alpha, {
        x, y: 0.15, z, vx: Math.cos(a) * sp, vy: this.rand(0.2, 1), vz: Math.sin(a) * sp,
        life: this.rand(0.4, 0.8), size: 0.3, sizeEnd: 0.7, glyph: ",.`", color: [0.22, 0.21, 0.2], alpha: 0.7, alphaEnd: 0, drag: 3,
      });
    }
  }

  /** Dying: ash lifting off his body (call every frame with a body point and the strength 0..1). */
  ashRise(x, y, z, k, dt) {
    this.ashAcc += dt * 70 * k;
    while (this.ashAcc >= 1) {
      this.ashAcc -= 1;
      this._spawn(this.alpha, {
        x: x + this.rand(-0.35, 0.35), y: y + this.rand(-0.7, 0.6), z: z + this.rand(-0.35, 0.35),
        vx: this.rand(-0.2, 0.5), vy: this.rand(0.6, 1.8), vz: this.rand(-0.3, 0.3),
        life: this.rand(1.2, 2.4), size: this.rand(0.12, 0.24), sizeEnd: 0.04, glyph: ".,'`",
        color: [0.46, 0.44, 0.42], colorEnd: [0.15, 0.14, 0.14], alpha: 0.95, alphaEnd: 0, drag: 0.5, spin: this.rand(-2, 2),
      });
    }
  }

  // ---------------------------------------------------------------- Ash Crescent (sword qi)
  /** Throw a crescent from (x, z) along (dx, dz). */
  throwCrescent(x, z, dx, dz, o) {
    const c = this.crescents.find((p) => !p.alive);
    if (!c) return null;
    const l = Math.hypot(dx, dz) || 1;
    Object.assign(c, { alive: true, x, z, dx: dx / l, dz: dz / l, age: 0, flashed: -1, done: false, tell: o.tell ?? TELL.NORMAL, damage: o.damage ?? 14, kb: o.knockback ?? 0.8, attack: o.attack ?? 'ashCrescent' });
    return c;
  }

  get crescentsAlive() {
    return this.crescents.some((c) => c.alive);
  }

  /**
   * Fly the crescents: each one cues `flashLead` before it reaches the hero (combat:flash + a glint on
   * it); a crescent that could only cue later than 0.24 s before contact fizzles on touch (fairness:
   * as the wyrm's bullets). A parry or a dodge spends it; a block chips.
   */
  updateCrescents(dt, d) {
    const C = TUNING.crescent, p = this.game.player;
    for (const c of this.crescents) {
      if (!c.alive) continue;
      c.age += dt;
      c.x += c.dx * C.speed * dt;
      c.z += c.dz * C.speed * dt;
      if (c.age > C.life || Math.hypot(c.x, c.z) > 60) {
        c.alive = false;
        continue;
      }
      this._drawCrescent(c, d.phase >= 2);
      const pp = p?.position;
      if (!pp || c.done || p.alive === false) continue;
      // along / across the crescent's path
      const rx = pp.x - c.x, rz = pp.z - c.z;
      const along = rx * c.dx + rz * c.dz, across = Math.abs(-rx * c.dz + rz * c.dx);
      const reach = C.radius + (p.radius ?? 0.45);
      if (across < 1.0 && along > 0 && c.flashed < 0) {
        const tti = (along - reach) / C.speed;
        if (tti <= TUNING.flashLead) {
          c.flashed = c.age;
          const fy = 0.7;
          d.emit('combat:flash', { source: 'dragon', attack: c.attack, tell: c.tell, x: c.x, y: fy, z: c.z });
          this.tellFlash(c.tell, c.x, fy, c.z);
        }
      }
      if (across < 1.0 && Math.abs(along) <= reach) {
        c.done = true;
        // fairness: a crescent announced too late (the hero ran into it point-blank) only fizzles
        const lead = c.flashed >= 0 ? c.age - c.flashed : 0;
        if (c.flashed < 0 || lead < 0.24) {
          this._fizzle(c);
          c.alive = false;
          continue;
        }
        const r = d.hitPlayer({ damage: c.damage, knockback: c.kb, kind: 'qi', tell: c.tell, attack: c.attack, from: { x: c.x - c.dx, z: c.z - c.dz }, point: { x: c.x, y: 0.7, z: c.z }, crescent: true });
        if (r === RESULT.PARRIED || r === RESULT.BLOCKED) {
          this._fizzle(c);
          c.alive = false;
        }
      }
    }
  }

  _drawCrescent(c, ember) {
    // an arc of ')' strokes across the path, bulging forward, re-drawn each frame
    const life = Math.max(0.02, (this.game.dt ?? 0.016) * 1.7);
    const px = -c.dz, pz = c.dx;
    const col = ember ? EMBER : [1.6, 1.5, 1.4];
    for (let i = -3; i <= 3; i++) {
      const u = i / 3, bow = 0.35 * (1 - u * u);
      const x = c.x + px * u * 0.9 + c.dx * bow, z = c.z + pz * u * 0.9 + c.dz * bow;
      const o = this._rec(x, 0.55 + 0.1 * (1 - u * u), z, life, 0.42, 0.42, ')', col, null);
      o.rot = Math.atan2(c.dz, c.dx);
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    if (this.rnd() < 0.6) {
      this._spawn(this.alpha, {
        x: c.x + this.rand(-0.6, 0.6) * px, y: 0.2, z: c.z + this.rand(-0.6, 0.6) * pz,
        vx: -c.dx * 2, vy: this.rand(0.3, 1), vz: -c.dz * 2, life: this.rand(0.3, 0.6), size: 0.2, sizeEnd: 0.05, glyph: ".,'",
        color: ASH, colorEnd: [0.15, 0.14, 0.14], alpha: 0.9, alphaEnd: 0, drag: 2,
      });
    }
  }

  _fizzle(c) {
    for (let i = 0; i < 10; i++) {
      const a = this.rnd() * Math.PI * 2, sp = this.rand(1, 4);
      this._spawn(this.alpha, {
        x: c.x, y: 0.6, z: c.z, vx: Math.cos(a) * sp, vy: this.rand(0, 2), vz: Math.sin(a) * sp,
        life: this.rand(0.3, 0.6), size: 0.22, sizeEnd: 0.05, glyph: ".,'`", color: ASH, colorEnd: [0.15, 0.14, 0.14], alpha: 1, alphaEnd: 0, drag: 3,
      });
    }
  }
}
