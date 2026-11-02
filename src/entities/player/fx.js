import * as THREE from 'three';

// Glyph-particle effects owned by the Wanderer: cyan slash arcs (light sweeps, the slam), the
// thrust's long streak, the slam's crystal-shard burst, the violet gem's glow + glints, impact
// sparks, dust, heal glow, burn flames, hurt spray, and the defence set — parry burst, block
// sparks, guard-break shards, Ghostep afterimage + streak, charge gather / ready glint, crit-window
// motes. Every glyph used here is in the world atlas.

const R = (a, b) => a + Math.random() * (b - a);

const COL = {
  trail: [0.4, 1.25, 2.3], trailEnd: [0.02, 0.14, 0.45], // icy cyan arcs
  trailHeavy: [0.55, 1.6, 2.9], trailCore: [1.1, 2.1, 3.1],
  shard: [0.9, 1.9, 4.2], shardEnd: [0.1, 0.25, 1.0], // blue crystal burst
  gem: [1.7, 0.5, 3.4], gemEnd: [0.45, 0.08, 0.9], gemCore: [3.4, 2.2, 4.6], // violet
  spark: [3.4, 2.7, 1.6], sparkEnd: [1.4, 0.45, 0.1],
  crit: [2.2, 2.8, 4.2], critEnd: [0.3, 0.55, 1.4],
  flash: [4.2, 3.6, 2.6],
  dust: [0.2, 0.18, 0.14], dustEnd: [0.09, 0.08, 0.065],
  heal: [1.3, 1.9, 0.55], healEnd: [0.25, 0.6, 0.12],
  flame: [3.0, 1.35, 0.32], flameEnd: [0.9, 0.12, 0.02],
  ash: [0.34, 0.035, 0.028], ashEnd: [0.1, 0.012, 0.01],
  hurt: [2.2, 1.8, 1.6], hurtEnd: [0.6, 0.15, 0.08],
  parry: [4.0, 3.4, 2.2], parryEnd: [1.6, 0.9, 0.25],
  parryBlue: [1.6, 2.6, 4.6], parryBlueEnd: [0.25, 0.6, 1.8],
  block: [2.3, 2.0, 1.5], blockEnd: [0.7, 0.35, 0.1],
  break: [1.5, 1.5, 1.6], breakEnd: [0.3, 0.3, 0.38],
  ghost: [1.3, 1.75, 2.6], ghostEnd: [0.12, 0.25, 0.75],
  ghostCore: [2.6, 3.0, 3.8],
  charge: [0.7, 1.7, 3.0], chargeEnd: [0.2, 0.5, 1.6],
};

// points along the hit segment (0 = hilt … 1 = the edge-wave tip past the steel) that leave a trail
const TRAIL_ALONG = [0.66, 0.84, 1.0];
const TRAIL_ALONG_HEAVY = [0.5, 0.68, 0.84, 1.0];
// screen axes of the fixed camera (pitch 58°): right = +X, up ≈ (0, cos 58°, −sin 58°)
const UP_Y = 0.53, UP_Z = -0.85;
/** Screen-space rotation that lays a '|' glyph along world direction (dx, dy, dz). */
const alongRot = (dx, dy, dz) => Math.atan2(dy * UP_Y + dz * UP_Z, dx) - Math.PI / 2;

export class PlayerFx {
  constructor(game, rig) {
    this.game = game;
    this.rig = rig;
    this._v = new THREE.Vector3();
    this.flameAcc = 0;
    this.healAcc = 0;
    this.chargeAcc = 0;
    this.critAcc = 0;
    this.gemAcc = 0;
  }

  get add() {
    return this.game.fx?.add ?? null;
  }
  get alpha() {
    return this.game.fx?.alpha ?? null;
  }

  _light(o) {
    return this.game.lights?.add?.(o) ?? null;
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

  /**
   * Icy cyan slash arc: strokes laid ALONG the motion of each point of the outer blade (so a sweep
   * reads as one continuous crescent), filling the gap between last frame's blade (pa→pb) and this
   * one's (a→b). kind: 'light' | 'slam' (bigger, denser, longer-lived) | 'thrust' (the streak is
   * drawn by thrustStreak; only a thin edge trail here).
   */
  trail(pa, pb, a, b, kind = 'light', crit = false) {
    const fx = this.add;
    if (!fx) return;
    const heavy = kind === 'slam';
    const thrust = kind === 'thrust';
    const along = heavy ? TRAIL_ALONG_HEAVY : thrust ? TRAIL_ALONG.slice(3) : TRAIL_ALONG;
    const col = crit ? COL.crit : heavy ? COL.trailHeavy : COL.trail;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3, t0 = (s - 1) / 3;
      for (let k = 0; k < along.length; k++) {
        const f = along[k];
        // this point now, and a sub-step earlier: the stroke lies along its path
        const ax = pa.x + (a.x - pa.x) * t, ay = pa.y + (a.y - pa.y) * t, az = pa.z + (a.z - pa.z) * t;
        const bx = pb.x + (b.x - pb.x) * t, by = pb.y + (b.y - pb.y) * t, bz = pb.z + (b.z - pb.z) * t;
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
        const ax0 = pa.x + (a.x - pa.x) * t0, ay0 = pa.y + (a.y - pa.y) * t0, az0 = pa.z + (a.z - pa.z) * t0;
        const bx0 = pb.x + (b.x - pb.x) * t0, by0 = pb.y + (b.y - pb.y) * t0, bz0 = pb.z + (b.z - pb.z) * t0;
        const dx = x - (ax0 + (bx0 - ax0) * f), dy = y - (ay0 + (by0 - ay0) * f), dz = z - (az0 + (bz0 - az0) * f);
        const step = Math.hypot(dx, dy, dz);
        const size = (heavy ? 0.28 : 0.22) * (0.65 + 0.35 * f);
        const outer = f > 0.95;
        fx.spawn({
          x, y, z,
          vx: R(-0.15, 0.15), vy: R(0, 0.25), vz: R(-0.15, 0.15),
          life: R(0.12, 0.2) * (heavy ? 1.35 : 1), size, sizeEnd: size * 0.3,
          glyph: step > 0.02 ? '|' : '-~', rot: step > 0.02 ? alongRot(dx, dy, dz) : R(-0.4, 0.4),
          stretch: step > 0.02 ? Math.min(1.4, (step / size) * 1.2) : 0,
          color: outer && !crit ? COL.trailCore : col, colorEnd: COL.trailEnd,
          alpha: 0.8, alphaEnd: 0, drag: 2.5,
        });
      }
    }
    // a few loose motes peeling off the edge
    for (let i = 0; i < (heavy ? 3 : 1); i++) {
      const f = R(0.6, 1);
      fx.spawn({
        x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f,
        vx: R(-0.8, 0.8), vy: R(0.2, 1.2), vz: R(-0.8, 0.8),
        life: R(0.25, 0.45), size: R(0.1, 0.16), sizeEnd: 0.03,
        glyph: "·'+", color: col, colorEnd: COL.trailEnd, alpha: 1, alphaEnd: 0, drag: 2, flicker: 0.3,
      });
    }
  }

  /** The charged thrust's long cyan streak along the point's path (from → to, world), lingering
   *  as one line behind the lunge; k = charge 0..1. */
  thrustStreak(from, to, k = 0, crit = false) {
    const fx = this.add;
    if (!fx) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-3) || !Number.isFinite(len) || len > 8) return;
    const rot = alongRot(dx, dy, dz);
    const col = crit ? COL.crit : COL.trailCore;
    const n = Math.min(24, Math.max(1, Math.ceil(len / 0.12)));
    for (let i = 0; i < n; i++) {
      const f = (i + Math.random()) / n;
      const size = R(0.2, 0.28) * (1 + 0.3 * k);
      fx.spawn({
        x: from.x + dx * f, y: from.y + dy * f, z: from.z + dz * f,
        vx: (dx / len) * R(0.2, 0.8), vy: R(-0.05, 0.1), vz: (dz / len) * R(0.2, 0.8),
        life: R(0.32, 0.5) * (1 + 0.3 * k), size, sizeEnd: size * 0.4, stretch: 1.4,
        glyph: '|', rot, color: col, colorEnd: COL.trailEnd, alpha: 0.95, alphaEnd: 0, drag: 2,
      });
      if (Math.random() < 0.35) {
        fx.spawn({
          x: from.x + dx * f, y: from.y + dy * f, z: from.z + dz * f,
          vx: R(-1.2, 1.2), vy: R(0.1, 1.2), vz: R(-1.2, 1.2),
          life: R(0.2, 0.4), size: R(0.1, 0.15), sizeEnd: 0.03,
          glyph: "·'+", color: COL.trail, colorEnd: COL.trailEnd, alpha: 1, alphaEnd: 0, drag: 2.5,
        });
      }
    }
  }

  /** The slam's ground impact: blue crystal shards burst up out of the grass in a ring, a few
   *  big crystals stand for a moment, a shock ring of strokes runs out, a cold flash + light. */
  slamShards(x, z, crit = false) {
    const fx = this.add;
    if (fx) {
      const c0 = crit ? COL.crit : COL.shard, c1 = crit ? COL.critEnd : COL.shardEnd;
      // flung shards
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + R(-0.12, 0.12);
        const r = R(0.1, 0.5), sp = R(1.5, 4.5);
        fx.spawn({
          x: x + Math.cos(a) * r, y: R(0.05, 0.25), z: z + Math.sin(a) * r,
          vx: Math.cos(a) * sp, vy: R(2.5, 6), vz: Math.sin(a) * sp,
          life: R(0.4, 0.75), size: R(0.2, 0.34), sizeEnd: 0.06,
          glyph: '^A/\\', color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, gravity: -14, drag: 1.2, spin: R(-6, 6),
        });
      }
      // crystals jutting from the ground, leaning outward
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + R(-0.25, 0.25);
        const r = R(0.35, 1.25);
        const size = R(0.42, 0.75) * (1.2 - r * 0.3);
        fx.spawn({
          x: x + Math.cos(a) * r, y: size * 0.45, z: z + Math.sin(a) * r,
          vy: R(0.2, 0.6), life: R(0.45, 0.7), size, sizeEnd: size * 0.6,
          glyph: 'A^', rot: -Math.cos(a) * 0.45, stretch: 0.5,
          color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 3,
        });
      }
      // shock ring along the ground
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        fx.spawn({
          x: x + Math.cos(a) * 0.3, y: 0.08, z: z + Math.sin(a) * 0.3,
          vx: Math.cos(a) * 6, vz: Math.sin(a) * 6,
          life: 0.28, size: 0.26, sizeEnd: 0.1,
          glyph: '-~', rot: -a, color: c0, colorEnd: c1, alpha: 0.9, alphaEnd: 0, drag: 5,
        });
      }
      fx.spawn({ x, y: 0.3, z, life: 0.14, size: 1.8, sizeEnd: 0.5, glyph: '*', color: COL.trailCore, colorEnd: c0, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
      fx.spawn({ x, y: 0.2, z, life: 0.2, size: 1.2, sizeEnd: 2.6, glyph: '°', color: c0, colorEnd: c1, alpha: 0.8, alphaEnd: 0 });
    }
    this.dust(x, z, 12, 1.4);
    this._light({ x, y: 0.6, z, color: [0.35, 0.75, 1.5], intensity: 4.5, radius: 7, life: 0.35, fade: 0.3 });
  }

  /** A violet four-point glint at the gem (s 0..1 = size / brightness); (vx, vz) = the hero's
   *  ground velocity so it rides along with the hilt. */
  gemGlint(x, y, z, s = 0.5, vx = 0, vz = 0) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    const k = Math.max(0.2, Math.min(1.2, s));
    fx.spawn({ x, y, z, vx, vz, life: 0.28, size: 0.55 * k + 0.15, sizeEnd: 0.08, glyph: '+', color: COL.gemCore, colorEnd: COL.gem, alpha: 1, alphaEnd: 0, rot: 0.785, spin: 3 });
    fx.spawn({ x, y, z, vx, vz, life: 0.18, size: 0.3 * k + 0.1, sizeEnd: 0.6 * k + 0.2, glyph: '°', color: COL.gem, colorEnd: COL.gemEnd, alpha: 0.7, alphaEnd: 0 });
  }

  /** The gem's steady glow: a short-lived violet point kept alive at the hilt (k 0..1.5 = strength). */
  gemTick(dt, x, y, z, k, vx = 0, vz = 0) {
    const fx = this.add;
    if (!fx || !(k > 0) || !Number.isFinite(x + y + z)) return;
    this.gemAcc += dt * (20 + 30 * k);
    while (this.gemAcc >= 1) {
      this.gemAcc -= 1;
      fx.spawn({
        x: x + R(-0.02, 0.02), y: y + R(-0.02, 0.02), z: z + R(-0.02, 0.02),
        vx, vy: R(0, 0.2), vz, life: R(0.06, 0.1), size: R(0.13, 0.19) * (0.8 + 0.4 * k), sizeEnd: 0.08,
        glyph: '•', color: COL.gem, colorEnd: COL.gemEnd, alpha: 0.75, alphaEnd: 0.2,
      });
    }
  }

  /** White-gold sparks at a sword contact (cold blue-white on a crit). (dx, dz) = swing direction. */
  sparks(x, y, z, dx, dz, heavy, crit = false) {
    const fx = this.add;
    if (!fx) return;
    const n = heavy || crit ? 22 : 12;
    const c0 = crit ? COL.crit : COL.spark, c1 = crit ? COL.critEnd : COL.sparkEnd;
    for (let i = 0; i < n; i++) {
      const sp = R(1, 4) * (heavy ? 1.4 : 1);
      fx.spawn({
        x, y, z,
        vx: dx * sp + R(-3, 3), vy: R(0.5, 4.5), vz: dz * sp + R(-3, 3),
        life: R(0.18, 0.42), size: R(0.16, 0.26), sizeEnd: 0.05,
        glyph: '+x*', color: c0, colorEnd: c1,
        alpha: 1, alphaEnd: 0, gravity: -9, drag: 1.8, spin: R(-6, 6),
      });
    }
    fx.spawn({
      x, y, z, life: 0.1, size: heavy || crit ? 1.15 : 0.75, sizeEnd: 0.2,
      glyph: '*', color: crit ? COL.ghostCore : COL.flash, colorEnd: c0, alpha: 1, alphaEnd: 0, rot: R(0, 3),
    });
    this._light({ x, y, z, color: crit ? [0.6, 0.8, 1.2] : [1, 0.8, 0.5], intensity: heavy || crit ? 3.5 : 2.4, radius: heavy ? 6 : 4.5, life: 0.16, fade: 0.14 });
  }

  /** Charged heavy's release: a short ground gust ring of dust and glints around the feet. */
  release(x, z, k) {
    this.dust(x, z, 6 + Math.round(8 * k), 0.8 + 0.8 * k);
  }

  /** Parry: bright white-gold burst at the blade (blue-tinted for blue tells) + a ring of streaks. */
  parry(x, y, z, blue) {
    const fx = this.add;
    if (!fx) return;
    const c0 = blue ? COL.parryBlue : COL.parry, c1 = blue ? COL.parryBlueEnd : COL.parryEnd;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + R(-0.12, 0.12);
      const sp = R(3, 7);
      fx.spawn({
        x, y, z,
        vx: Math.cos(a) * sp, vy: R(-1, 3.5), vz: Math.sin(a) * sp,
        life: R(0.16, 0.34), size: R(0.18, 0.3), sizeEnd: 0.04,
        glyph: '+x*×', color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, gravity: -6, drag: 3.5, spin: R(-8, 8),
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fx.spawn({
        x: x + Math.cos(a) * 0.15, y, z: z + Math.sin(a) * 0.15,
        vx: Math.cos(a) * 9, vy: 0, vz: Math.sin(a) * 9,
        life: 0.12, size: 0.3, sizeEnd: 0.1, stretch: 2.5, rot: -a,
        glyph: '-', color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 10,
      });
    }
    fx.spawn({ x, y, z, life: 0.12, size: 1.6, sizeEnd: 0.3, glyph: '*', color: COL.flash, colorEnd: c0, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
    fx.spawn({ x, y, z, life: 0.16, size: 1.1, sizeEnd: 2.0, glyph: '°', color: c0, colorEnd: c1, alpha: 0.8, alphaEnd: 0 });
    this._light({ x, y, z, color: blue ? [0.5, 0.75, 1.3] : [1.2, 1.0, 0.65], intensity: 4.5, radius: 7, life: 0.2, fade: 0.18 });
  }

  /** Blocked blow: '#' sparks thrown off the guard, away from the attacker (nx, nz). */
  block(x, y, z, nx, nz, heavy) {
    const fx = this.add;
    if (!fx) return;
    const n = heavy ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const sp = R(1.5, 4) * (heavy ? 1.3 : 1);
      fx.spawn({
        x, y, z,
        vx: -nx * sp * 0.4 + R(-2.5, 2.5), vy: R(0.5, 3.5), vz: -nz * sp * 0.4 + R(-2.5, 2.5),
        life: R(0.18, 0.36), size: R(0.16, 0.24), sizeEnd: 0.05,
        glyph: '#=+', color: COL.block, colorEnd: COL.blockEnd, alpha: 1, alphaEnd: 0, gravity: -9, drag: 2, spin: R(-5, 5),
      });
    }
    fx.spawn({ x, y, z, life: 0.08, size: heavy ? 0.9 : 0.6, sizeEnd: 0.2, glyph: '#', color: COL.flash, colorEnd: COL.block, alpha: 1, alphaEnd: 0 });
    this._light({ x, y, z, color: [1, 0.85, 0.6], intensity: heavy ? 2.6 : 1.6, radius: 4, life: 0.12, fade: 0.1 });
  }

  /** Small chip sparks for a blocked stream tick (fire breath on the guard). */
  blockChip(x, y, z) {
    const fx = this.add;
    if (!fx) return;
    for (let i = 0; i < 2; i++) {
      fx.spawn({
        x, y, z, vx: R(-1.5, 1.5), vy: R(0.5, 2), vz: R(-1.5, 1.5),
        life: R(0.12, 0.22), size: R(0.12, 0.18), sizeEnd: 0.04,
        glyph: '#+', color: COL.block, colorEnd: COL.blockEnd, alpha: 1, alphaEnd: 0, gravity: -6, drag: 2,
      });
    }
  }

  /** Guard break: the guard shatters — grey shards + a hot flash, thrown back with the hero. */
  guardBreak(x, y, z, nx, nz) {
    const fx = this.add;
    if (fx) {
      for (let i = 0; i < 18; i++) {
        const sp = R(2, 5);
        fx.spawn({
          x, y, z,
          vx: nx * sp + R(-2.5, 2.5), vy: R(1, 4.5), vz: nz * sp + R(-2.5, 2.5),
          life: R(0.3, 0.6), size: R(0.18, 0.28), sizeEnd: 0.06,
          glyph: '/\\#|', color: COL.break, colorEnd: COL.breakEnd, alpha: 1, alphaEnd: 0, gravity: -10, drag: 1.4, spin: R(-9, 9),
        });
      }
      fx.spawn({ x, y, z, life: 0.12, size: 1.4, sizeEnd: 0.4, glyph: 'X', color: [3.6, 1.2, 0.5], colorEnd: [1.2, 0.2, 0.05], alpha: 1, alphaEnd: 0 });
    }
    this.dust(x, z, 10, 1.2);
    this._light({ x, y, z, color: [1.2, 0.5, 0.25], intensity: 3, radius: 5, life: 0.18, fade: 0.16 });
  }

  /**
   * Ghostep: a cold blue-white afterimage traced along the hero's pose at the old spot (`segs`:
   * flat [ax, ay, az, bx, by, bz, ...] world segments sampled before the blink), a streak to the
   * new spot, and a reappear burst.
   */
  ghostep(segs, nSegs, ox, oz, nx, nz) {
    const fx = this.add;
    if (!fx) return;
    // afterimage: strokes along each bone, oriented to the bone's screen direction
    for (let s = 0; s < nSegs; s++) {
      const k = s * 6;
      const ax = segs[k], ay = segs[k + 1], az = segs[k + 2];
      const dx = segs[k + 3] - ax, dy = segs[k + 4] - ay, dz = segs[k + 5] - az;
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 1e-3) || !Number.isFinite(len)) continue;
      const rot = Math.atan2(dy * UP_Y + dz * UP_Z, dx) - Math.PI / 2;
      const n = Math.max(1, Math.round(len / 0.11));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        fx.spawn({
          x: ax + dx * f, y: ay + dy * f, z: az + dz * f,
          vx: R(-0.15, 0.15), vy: R(0.05, 0.35), vz: R(-0.15, 0.15),
          life: R(0.45, 0.65), size: R(0.2, 0.26), sizeEnd: 0.12,
          glyph: '|', rot: rot + R(-0.15, 0.15), color: COL.ghost, colorEnd: COL.ghostEnd,
          alpha: 0.9, alphaEnd: 0, drag: 1.5, flicker: 0.25,
        });
      }
    }
    // streak from the old spot to the new one
    const sx = nx - ox, sz = nz - oz;
    const dist = Math.hypot(sx, sz);
    if (dist > 0.3 && Number.isFinite(dist)) {
      const rot = Math.atan2(sz * UP_Z, sx);
      const n = Math.min(60, Math.round(dist / 0.18));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        for (let j = 0; j < 2; j++) {
          fx.spawn({
            x: ox + sx * f + R(-0.12, 0.12), y: R(0.35, 1.45), z: oz + sz * f + R(-0.12, 0.12),
            vx: (sx / dist) * R(0.5, 2), vy: R(-0.1, 0.2), vz: (sz / dist) * R(0.5, 2),
            life: R(0.25, 0.5) * (0.5 + 0.5 * f), size: R(0.18, 0.26), sizeEnd: 0.05, stretch: 1.5,
            glyph: '-=~·', rot: rot + R(-0.1, 0.1), color: COL.ghost, colorEnd: COL.ghostEnd,
            alpha: 0.85, alphaEnd: 0, drag: 2.5,
          });
        }
      }
    }
    // reappear: a ring of motes collapsing upward + a core flash
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      fx.spawn({
        x: nx + Math.cos(a) * 0.7, y: R(0.1, 1.5), z: nz + Math.sin(a) * 0.7,
        vx: -Math.cos(a) * 1.4, vy: R(0.4, 1.4), vz: -Math.sin(a) * 1.4,
        life: R(0.3, 0.5), size: R(0.14, 0.2), sizeEnd: 0.04,
        glyph: '·+°', color: COL.ghost, colorEnd: COL.ghostEnd, alpha: 1, alphaEnd: 0, drag: 2, flicker: 0.3,
      });
    }
    fx.spawn({ x: nx, y: 0.95, z: nz, life: 0.18, size: 1.8, sizeEnd: 0.4, glyph: '|', color: COL.ghostCore, colorEnd: COL.ghost, alpha: 1, alphaEnd: 0 });
    this._light({ x: nx, y: 1.1, z: nz, color: [0.55, 0.75, 1.3], intensity: 3.2, radius: 6, life: 0.5, fade: 0.45, fadeIn: 0.02 });
  }

  /** Charging: cold motes drawn in toward the blade (rate and brightness scale with k 0..1). */
  chargeTick(dt, a, b, k) {
    const fx = this.add;
    if (!fx || !(k >= 0)) return;
    this.chargeAcc += dt * (10 + 40 * k);
    while (this.chargeAcc >= 1) {
      this.chargeAcc -= 1;
      const f = R(0.3, 1);
      const px = a.x + (b.x - a.x) * f, py = a.y + (b.y - a.y) * f, pz = a.z + (b.z - a.z) * f;
      const ang = Math.random() * Math.PI * 2, r = R(0.35, 0.8);
      const ox = Math.cos(ang) * r, oz = Math.sin(ang) * r, oy = R(-0.2, 0.5);
      const life = R(0.22, 0.34);
      fx.spawn({
        x: px + ox, y: py + oy, z: pz + oz,
        vx: -ox / life, vy: -oy / life, vz: -oz / life,
        life, size: R(0.1, 0.16) * (0.8 + 0.5 * k), sizeEnd: 0.03,
        glyph: "·'.+", color: COL.charge, colorEnd: COL.chargeEnd, alpha: 0.5 + 0.5 * k, alphaEnd: 0.1,
      });
    }
  }

  /** Full charge reached: a glint on the blade. */
  chargeReady(x, y, z) {
    const fx = this.add;
    if (fx) {
      fx.spawn({ x, y, z, life: 0.22, size: 1.0, sizeEnd: 0.2, glyph: '+', color: COL.ghostCore, colorEnd: COL.charge, alpha: 1, alphaEnd: 0, spin: 4 });
      fx.spawn({ x, y, z, life: 0.16, size: 0.5, sizeEnd: 1.3, glyph: '°', color: COL.charge, colorEnd: COL.chargeEnd, alpha: 0.9, alphaEnd: 0 });
    }
    this._light({ x, y, z, color: [0.5, 0.75, 1.4], intensity: 2.2, radius: 4, life: 0.25, fade: 0.2 });
  }

  /** Crit window open: faint cold motes peeling off the blade. */
  critTick(dt, a, b) {
    const fx = this.add;
    if (!fx) return;
    this.critAcc += dt * 24;
    while (this.critAcc >= 1) {
      this.critAcc -= 1;
      const f = R(0.2, 1);
      fx.spawn({
        x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f,
        vx: R(-0.2, 0.2), vy: R(0.3, 0.8), vz: R(-0.2, 0.2),
        life: R(0.25, 0.45), size: R(0.1, 0.15), sizeEnd: 0.03,
        glyph: "·'", color: COL.crit, colorEnd: COL.critEnd, alpha: 0.9, alphaEnd: 0, drag: 1, flicker: 0.4,
      });
    }
  }

  /** Spray away from the attacker when the hero is hit. (nx, nz) = push direction. */
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
    this.chargeAcc = 0;
    this.critAcc = 0;
    this.gemAcc = 0;
  }
}
