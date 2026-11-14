import { TELL, TELL_STYLE, RESULT } from '../../../combat/rules.js';
import { DuelFx } from '../duelist/fx.js';
import { perPhase } from '../duelist/realise.js';

// The Starless Lord's glyph FX (STYLE.md: everything is glyph particles from the world atlas + pooled
// lights), on top of the duelist's (tells, clashes, sparks, sweep trails). His own: the blades of red
// light (a glow of strokes along each blade and a red light that follows it), the Void spells
// (lightning, the push's wall of force, the pull, the thrown blade, torn stone, called lightning),
// form 4's aura, the blink's afterimage and the forms' ignitions.
// Thrown things (the blade, the stones) fly here: each cues itself `flashLead` before it reaches the
// hero (a glint on it + combat:flash), and one that could only cue too late fizzles on touch, as the
// wyrm's bullets and the Ash Crescent do (COMBAT.md → fairness).

const TAU = Math.PI * 2;
const RED = [3.4, 0.2, 0.12], RED_CORE = [3.9, 0.95, 0.7], RED_END = [0.5, 0.03, 0.02];
const VOID = [2.6, 0.5, 3.4], VOID_CORE = [4.6, 3.4, 5.2], VOID_END = [0.35, 0.05, 0.6]; // Void lightning: violet-white
const GOLD = [3.6, 2.6, 0.9];
const STONE = [0.5, 0.5, 0.58];

export class LordFx extends DuelFx {
  constructor(d) {
    super(d);
    this.shots = Array.from({ length: 8 }, () => ({ alive: false }));
    this.strikes = Array.from({ length: 10 }, () => ({ alive: false }));
    this.glowAcc = 0;
    this.auraAcc = 0;
    this.light = null; // the red light that follows the main blade
  }

  reset() {
    super.reset();
    for (const s of this.shots) s.alive = false;
    for (const s of this.strikes) s.alive = false;
    this.light?.kill?.();
    this.light = null;
  }

  update(dt, d) {
    super.update(dt, d);
    this.updateShots(dt, d);
    this.updateStrikes(dt, d);
  }

  /** The on-screen angle of a world direction (for strokes laid along it). */
  _screenRot(dx, dy, dz) {
    const U = this.game.U, Rg = U?.uCamRight?.value, Up = U?.uCamUp?.value;
    const sx = dx * (Rg?.x ?? 1) + dy * (Rg?.y ?? 0) + dz * (Rg?.z ?? 0);
    const sy = dx * (Up?.x ?? 0) + dy * (Up?.y ?? 1) + dz * (Up?.z ?? 0);
    return sx * sx + sy * sy > 1e-10 ? Math.atan2(sy, sx) - Math.PI / 2 : 0;
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

  /** Form 4: the Void wreathes him: dark-red wisps rising off the body, a small arc now and then. */
  aura(x, y, z, dt, k = 1) {
    this.auraAcc += dt * 34 * k;
    while (this.auraAcc >= 1) {
      this.auraAcc -= 1;
      const a = this.rnd() * TAU, r = this.rand(0.2, 0.5);
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: y + this.rand(-0.9, 0.5), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.4, vy: this.rand(0.8, 2.2), vz: Math.sin(a) * 0.4,
        life: this.rand(0.4, 0.9), size: this.rand(0.16, 0.3), sizeEnd: 0.04, glyph: "~'^`", color: [2.2, 0.16, 0.2], colorEnd: [0.3, 0.02, 0.08], alpha: 0.9, alphaEnd: 0, drag: 1, flicker: 0.4,
      });
      if (this.rnd() < 0.1) {
        const bx = x + this.rand(-0.6, 0.6), by = y + this.rand(-0.8, 0.6), bz = z + this.rand(-0.6, 0.6);
        this.lightning(x, y, z, bx, by, bz, 0.35, false);
      }
    }
  }

  // ---------------------------------------------------------------- Void lightning
  /** A bolt from a to b: a jagged line of violet-white strokes with a fork or two. `k` = size;
   *  `gold`: a bolt thrown back by a perfect parry. */
  lightning(ax, ay, az, bx, by, bz, k = 1, lit = true, gold = false) {
    const add = this.add;
    if (!add || !Number.isFinite(ax + ay + az + bx + by + bz)) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (!(len > 0.05)) return;
    const steps = Math.max(3, Math.min(34, Math.round(len / 0.42)));
    const body = gold ? GOLD : VOID, core = gold ? [4.6, 4.2, 3] : VOID_CORE, end = gold ? [0.6, 0.3, 0.05] : VOID_END;
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, j = (i < steps ? 0.34 * k : 0) * Math.sin(Math.PI * t) + (i < steps ? 0.1 : 0);
      const x = ax + dx * t + this.rand(-j, j), y = ay + dy * t + this.rand(-j, j), z = az + dz * t + this.rand(-j, j);
      const sx = x - px, sy = y - py, sz = z - pz, sl = Math.hypot(sx, sy, sz);
      const o = this._rec((x + px) / 2, (y + py) / 2, (z + pz) / 2, this.rand(0.1, 0.2), 0.34 * k, 0.12 * k, '|', i & 1 ? core : body, end);
      o.rot = this._screenRot(sx, sy, sz);
      o.stretch = Math.min(3.5, (sl / (0.34 * k)) * 1.2);
      add.spawn(o);
      if (k >= 0.8 && this.rnd() < 0.2) {
        // a fork that dies in the air
        let fx = x, fy = y, fz = z;
        for (let q = 0; q < 3; q++) {
          const nx = fx + this.rand(-0.5, 0.5), ny = fy + this.rand(-0.4, 0.5), nz = fz + this.rand(-0.5, 0.5);
          const f = this._rec((fx + nx) / 2, (fy + ny) / 2, (fz + nz) / 2, this.rand(0.06, 0.14), 0.22, 0.08, '|', body, end);
          f.rot = this._screenRot(nx - fx, ny - fy, nz - fz);
          f.stretch = 1.6;
          add.spawn(f);
          fx = nx;
          fy = ny;
          fz = nz;
        }
      }
      px = x;
      py = y;
      pz = z;
    }
    if (lit) {
      this._light({ x: (ax + bx) / 2, y: Math.max(1, (ay + by) / 2), z: (az + bz) / 2, color: gold ? [1, 0.8, 0.4] : [0.7, 0.4, 1], intensity: 5 * k, radius: 9 + len * 0.3, life: 0.22, fade: 0.2 });
      for (let i = 0; i < 10; i++) {
        const a = this.rnd() * TAU, sp = this.rand(2, 6);
        this._spawn(add, { x: bx, y: by, z: bz, vx: Math.cos(a) * sp, vy: this.rand(0, 4), vz: Math.sin(a) * sp, life: this.rand(0.15, 0.35), size: 0.2, sizeEnd: 0.04, glyph: '+x*', color: core, colorEnd: end, alpha: 1, alphaEnd: 0, drag: 4 });
      }
    }
  }

  /** The Void gathering in his hand through a cast's windup (`k` 0..1). */
  crackle(x, y, z, k, dt, color = VOID) {
    this.auraAcc += dt * (20 + 50 * k);
    while (this.auraAcc >= 1) {
      this.auraAcc -= 1;
      const a = this.rnd() * TAU, e = this.rand(-1, 1), r = this.rand(0.1, 0.34 + 0.2 * k);
      const ex = x + Math.cos(a) * r, ey = y + e * r, ez = z + Math.sin(a) * r;
      const o = this._rec((x + ex) / 2, (y + ey) / 2, (z + ez) / 2, this.rand(0.05, 0.12), 0.2, 0.06, '|', color, VOID_END);
      o.rot = this._screenRot(ex - x, ey - y, ez - z);
      o.stretch = 1.2;
      this.add?.spawn(o);
    }
    this._spawn(this.add, { x, y, z, life: 0.06, size: 0.2 + 0.25 * k, sizeEnd: 0.1, glyph: '*', color: [color[0] * (0.6 + k), color[1] * (0.6 + k), color[2] * (0.6 + k)], alpha: 1, alphaEnd: 0.4 });
  }

  // ---------------------------------------------------------------- the push, the pull, the crescents
  throwCrescent(x, z, dx, dz, o) {
    const c = super.throwCrescent(x, z, dx, dz, o);
    if (c) {
      c.style = o.style ?? 'crescent';
      c.speed = o.speed;
      c.radius = o.radius;
      c.half = o.half;
      c.life = o.life;
    }
    return c;
  }

  _drawCrescent(c) {
    const life = Math.max(0.02, (this.game.fxDt ?? this.game.dt ?? 0.016) * 1.7);
    const px = -c.dz, pz = c.dx, rot = Math.atan2(c.dz, c.dx);
    if (c.style === 'push') {
      // a wall of force: three ranks of pale strokes bowed forward, the air torn behind it
      const half = c.half ?? 2.4;
      for (let rank = 0; rank < 3; rank++) {
        const back = rank * 0.42, n = 9 - rank * 2, col = rank === 0 ? [2.6, 2.2, 2.4] : [1.2 - rank * 0.3, 0.3, 0.5];
        for (let i = -n; i <= n; i++) {
          const u = i / n, bow = 0.7 * (1 - u * u) - back;
          const o = this._rec(c.x + px * u * half + c.dx * bow, 0.25 + 1.5 * ((i + n + rank) % 3) / 2.2, c.z + pz * u * half + c.dz * bow, life, 0.5 - rank * 0.1, 0.5, ')', col, null);
          o.rot = rot;
          o.alphaEnd = 1;
          o.alpha = rank === 0 ? 1 : 0.7;
          this._spawn(this.add, o);
        }
      }
      if (this.rnd() < 0.9) {
        this._spawn(this.alpha, {
          x: c.x + this.rand(-half, half) * px, y: 0.15, z: c.z + this.rand(-half, half) * pz,
          vx: c.dx * 3, vy: this.rand(0.4, 1.6), vz: c.dz * 3, life: this.rand(0.3, 0.6), size: 0.24, sizeEnd: 0.6, glyph: ".,'~", color: [0.3, 0.27, 0.3], alpha: 0.8, alphaEnd: 0, drag: 2,
        });
      }
      return;
    }
    // a crescent of red light
    for (let i = -3; i <= 3; i++) {
      const u = i / 3, bow = 0.35 * (1 - u * u);
      const o = this._rec(c.x + px * u * 0.9 + c.dx * bow, 0.55 + 0.1 * (1 - u * u), c.z + pz * u * 0.9 + c.dz * bow, life, 0.46, 0.46, ')', i === 0 ? RED_CORE : RED, null);
      o.rot = rot;
      o.alphaEnd = 1;
      this._spawn(this.add, o);
    }
    if (this.rnd() < 0.7) this._spawn(this.add, { x: c.x + this.rand(-0.6, 0.6) * px, y: 0.3, z: c.z + this.rand(-0.6, 0.6) * pz, vx: -c.dx * 2, vy: this.rand(0.3, 1), vz: -c.dz * 2, life: this.rand(0.2, 0.5), size: 0.14, sizeEnd: 0.04, glyph: ".'", color: RED, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 2 });
  }

  _fizzle(c) {
    const col = c.style === 'push' ? [1.6, 1.4, 1.5] : RED;
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * TAU, sp = this.rand(1, 5);
      this._spawn(this.add, { x: c.x, y: 0.7, z: c.z, vx: Math.cos(a) * sp, vy: this.rand(0, 2.5), vz: Math.sin(a) * sp, life: this.rand(0.2, 0.5), size: 0.2, sizeEnd: 0.05, glyph: ")'.", color: col, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 3 });
    }
  }

  /** The pull's windup: the air streaming from the hero toward his hand. */
  pullStream(hx, hy, hz, px, py, pz, k, dt) {
    this.glowAcc += dt * (30 + 60 * k);
    while (this.glowAcc >= 1) {
      this.glowAcc -= 1;
      const u = this.rnd(), x = px + (hx - px) * u, y = py + (hy - py) * u, z = pz + (hz - pz) * u;
      const dx = hx - px, dy = hy - py, dz = hz - pz, l = Math.hypot(dx, dy, dz) || 1, sp = 9 + 6 * k;
      const o = this._rec(x + this.rand(-0.4, 0.4), y + this.rand(-0.5, 0.5), z + this.rand(-0.4, 0.4), this.rand(0.12, 0.24), 0.26, 0.08, '-', [2.4, 0.2, 0.3], RED_END);
      o.vx = (dx / l) * sp;
      o.vy = (dy / l) * sp;
      o.vz = (dz / l) * sp;
      o.rot = this._screenRot(dx, dy, dz) + Math.PI / 2;
      o.stretch = 1.4;
      this.add?.spawn(o);
    }
  }

  // ---------------------------------------------------------------- thrown things: the blade, torn stone
  /**
   * Throw something. o: { kind 'glaive' | 'stone', x, y, z, dx, dz, speed, radius, life, tell, damage,
   * knockback, attack, delay (s it hangs in the air first), big, range, back (the glaive's return speed) }.
   */
  throwShot(o) {
    const s = this.shots.find((p) => !p.alive);
    if (!s) return null;
    const l = Math.hypot(o.dx, o.dz) || 1;
    Object.assign(s, {
      alive: true, kind: o.kind, x: o.x, y: o.y ?? 1, z: o.z, ox: o.x, oz: o.z, dx: o.dx / l, dz: o.dz / l, speed: o.speed, radius: o.radius ?? 0.8, life: o.life ?? 2.5,
      tell: o.tell ?? TELL.NORMAL, damage: o.damage ?? 14, kb: o.knockback ?? 1.2, attack: o.attack ?? 'thrown', age: 0, flashed: -1, done: false,
      wait: 0, delay: o.delay ?? 0, big: !!o.big, range: o.range ?? 12, back: o.back ?? o.speed, phase: o.delay > 0 ? 'hang' : 'fly', spin: this.rnd() * TAU, hx: o.x, hz: o.z, rise: o.rise ?? 1.8,
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
        // torn from the floor: it rises beside him and hangs, turning, until its turn to fly
        const k = Math.min(1, s.age / Math.max(0.2, s.delay * 0.7));
        s.y = 0.2 + (s.rise - 0.2) * (1 - (1 - k) * (1 - k));
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
    // the disc it draws in the air
    for (let i = 0; i < 3; i++) {
      const a = s.spin - 0.5 - i * 0.55, x = s.x + Math.cos(a) * 0.95, z = s.z + Math.sin(a) * 0.95;
      this._spawn(this.add, { x, y: s.y, z, life: 0.1, size: 0.24, sizeEnd: 0.08, glyph: ')', rot: this._screenRot(-Math.sin(a), 0, Math.cos(a)), color: RED, colorEnd: RED_END, alpha: 0.8 - i * 0.2, alphaEnd: 0 });
    }
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
    if (hang && this.rnd() < 0.5) {
      this._spawn(this.alpha, { x: s.x + this.rand(-0.3, 0.3), y: s.y - 0.2, z: s.z + this.rand(-0.3, 0.3), vy: -this.rand(1, 3), life: this.rand(0.2, 0.5), size: 0.14, sizeEnd: 0.05, glyph: ".,'", color: [0.3, 0.3, 0.34], alpha: 0.9, alphaEnd: 0 });
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

  // ---------------------------------------------------------------- called lightning (form 4)
  /** Mark the ground at (x, z): it is struck `warn` s from now. */
  callStrike(x, z, r, warn, o = {}) {
    const s = this.strikes.find((p) => !p.alive);
    if (!s) return null;
    Object.assign(s, { alive: true, x, z, r, t: 0, at: warn, flashed: false, damage: o.damage ?? 26, kb: o.knockback ?? 3, attack: o.attack ?? 'storm' });
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
      if (s.t < s.at) {
        this.warnRing(s.x, s.z, s.r, Math.min(1, s.t / s.at), dt);
        if (this.rnd() < 0.35) this.lightning(s.x + this.rand(-s.r, s.r) * 0.6, 0.1, s.z + this.rand(-s.r, s.r) * 0.6, s.x + this.rand(-0.4, 0.4), this.rand(0.6, 1.6), s.z + this.rand(-0.4, 0.4), 0.3, false);
        if (!s.flashed && s.t >= s.at - lead) {
          s.flashed = true;
          d.emit('combat:tell', { source: 'dragon', attack: s.attack, tell: TELL.RED, impactIn: lead, x: s.x, z: s.z, hazard: true });
          d.emit('combat:flash', { source: 'dragon', attack: s.attack, tell: TELL.RED, x: s.x, y: 0.6, z: s.z, hazard: true });
          this.ringPulse(s.x, s.z, s.r * 0.5);
        }
        continue;
      }
      s.alive = false;
      this.lightning(s.x + this.rand(-2, 2), 26, s.z + this.rand(-1, 1), s.x, 0.1, s.z, 2.2, true);
      this.ringPulse(s.x, s.z, s.r);
      this.game.world?.scorch?.burnCircle?.(s.x, s.z, s.r * 0.8, 0.3, 0.9);
      this.game.shake?.(0.22);
      d.emit('dragon:explosion', { x: s.x, z: s.z, radius: s.r });
      const pp = p?.position;
      if (pp && p.alive !== false && Math.hypot(pp.x - s.x, pp.z - s.z) <= s.r + (p.radius ?? 0.45) * 0.5) {
        d.hitPlayer({ damage: s.damage, knockback: s.kb, knockdown: true, kind: 'lightning', tell: TELL.RED, parryable: false, blockable: false, attack: s.attack, from: { x: s.x, z: s.z }, extra: { plunge: false } });
      }
    }
  }

  // ---------------------------------------------------------------- the blink, the ignition, the deathblow
  /** He is gone from (x0, z0) and at (x1, z1): a red-black streak between, a shape left behind. */
  blinkTrail(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const n = Math.max(4, Math.round(len / 0.35));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      for (let h = 0; h < 3; h++) {
        this._spawn(this.add, {
          x: x0 + dx * u + this.rand(-0.15, 0.15), y: 0.4 + h * 0.55, z: z0 + dz * u + this.rand(-0.15, 0.15),
          life: this.rand(0.14, 0.3) + 0.1 * (1 - u), size: 0.34, sizeEnd: 0.06, glyph: '-~', rot: this._screenRot(dx, 0, dz) + Math.PI / 2, stretch: 1.5,
          color: [2.4 * (0.4 + 0.6 * u), 0.14, 0.2], colorEnd: [0.2, 0.01, 0.05], alpha: 1, alphaEnd: 0,
        });
      }
    }
    for (let h = 0; h < 7; h++) {
      this._spawn(this.add, { x: x0 + this.rand(-0.2, 0.2), y: 0.2 + h * 0.26, z: z0 + this.rand(-0.2, 0.2), vy: 0.6, life: 0.4, size: 0.4, sizeEnd: 0.1, glyph: 'XVA#', color: [1.6, 0.1, 0.14], colorEnd: [0.1, 0, 0.03], alpha: 0.9, alphaEnd: 0 });
    }
    this._light({ x: x1, y: 1.2, z: z1, color: [1, 0.15, 0.2], intensity: 3.5, radius: 6, life: 0.2, fade: 0.18 });
  }

  /** A form's ignition lands: a red shock ring racing out, glyphs thrown up. */
  igniteNova(x, z, r) {
    const c = TELL_STYLE.red.color;
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      this._spawn(this.add, {
        x: x + ca * 0.8, y: 0.5, z: z + sa * 0.8, vx: ca * (r / 0.3), vz: sa * (r / 0.3),
        life: 0.32, size: 0.8, sizeEnd: 1.3, glyph: ')', rot: Math.atan2(-sa, ca), color: [c[0] * 1.4, c[1] * 0.7, c[2] * 0.5], colorEnd: [c[0] * 0.3, c[1] * 0.15, c[2] * 0.15], alpha: 1, alphaEnd: 0, drag: 0.5,
      });
    }
    for (let i = 0; i < 30; i++) {
      const a = this.rnd() * TAU, sp = this.rand(2, 9);
      this._spawn(this.add, { x, y: 1, z, vx: Math.cos(a) * sp, vy: this.rand(2, 9), vz: Math.sin(a) * sp, life: this.rand(0.4, 0.9), size: this.rand(0.16, 0.3), sizeEnd: 0.04, glyph: "+*'", color: RED_CORE, colorEnd: RED_END, alpha: 1, alphaEnd: 0, drag: 1.5, gravity: -8 });
    }
    this._light({ x, y: 1.4, z, color: [1, 0.2, 0.1], intensity: 7, radius: r * 1.5, life: 0.5, fade: 0.4 });
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
