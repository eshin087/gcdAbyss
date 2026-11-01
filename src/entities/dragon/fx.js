import * as THREE from 'three';
import { TUNING } from './tuning.js';

// Dragon FX: fire breath stream (glyph particles + pooled lights + scorch), fireball projectiles,
// roar shock rings, dust, nostril embers, eye glints, phase-2 / death embers. Every light this
// module creates is tracked so reset() can kill them.

const FIRE = '*#%@&~^';
const EMBER = ".'`*";
const DUST = ",.`:'";
const rand = (a, b) => a + Math.random() * (b - a);

export class DragonFx {
  constructor(dragon) {
    this.d = dragon;
    this.game = dragon.game;
    this.lights = new Set();
    this.breathLights = [];
    this.breathing = false;
    this.breathAcc = 0;
    this.smokeAcc = 0;
    this.scorchTimer = 0;
    this.emberAcc = 0;
    this.trailAcc = 0;
    this._bodyAcc = 0;
    this._held = { glint: 0, warn: 0 };
    this.projectiles = Array.from({ length: 6 }, () => ({
      alive: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      light: null,
      volley: null,
      age: 0,
      trail: 0,
      hold: 0,
    }));
    this._dir = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  get add() {
    return this.game.fx?.add;
  }
  get alpha() {
    return this.game.fx?.alpha;
  }

  _spawn(pool, o) {
    if (!pool) return;
    if (!(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z))) return;
    pool.spawn(o);
  }

  _light(opts) {
    const l = this.game.lights?.add?.(opts);
    if (l) this.lights.add(l);
    return l || null;
  }

  _pruneLights() {
    for (const l of this.lights) if (l.dead) this.lights.delete(l);
  }

  /**
   * Sprites glued to a moving point (eye glints, fireball cores, the landing ring) are re-spawned
   * with a ~1.5-frame life only when the previous copy expires this frame, so exactly one copy is
   * visible at any frame rate. (A fixed minimum life stacked 3x at 60 fps, 7x at 144 fps and ~15x
   * during hit-stop, all additive.) Returns the life to spawn with, or 0 = keep the current copy.
   */
  _hold(obj, key, dt) {
    obj[key] -= dt;
    if (obj[key] > 0) return 0;
    const life = Math.max(0.011, dt * 1.5); // the pool floors life at 0.01
    obj[key] = life - dt;
    return life;
  }

  reset() {
    this.breathing = false;
    this.breathLights.length = 0;
    for (const l of this.lights) {
      l.life = 0;
      l.intensity = 0;
    }
    this.lights.clear();
    for (const p of this.projectiles) {
      p.alive = false;
      p.light = null;
      p.volley = null;
    }
    this.breathAcc = this.smokeAcc = this.emberAcc = this.trailAcc = this._bodyAcc = 0;
    this.scorchTimer = 0;
    this._held.glint = this._held.warn = 0;
  }

  // ---------------------------------------------------------------- fire breath
  breathBegin() {
    if (this.breathing) return;
    this.breathing = true;
    this.breathLights.length = 0;
    for (let i = 0; i < 3; i++) {
      const l = this._light({ x: 0, y: 1.2, z: 0, color: [1, 0.45, 0.12], intensity: 3.6 - i * 0.4, radius: 9 + i, fadeIn: 0.15, fade: 0.35, flicker: 0.5 });
      if (l) this.breathLights.push(l);
    }
  }

  breathEnd() {
    if (!this.breathing) return;
    this.breathing = false;
    for (const l of this.breathLights) l.kill();
    this.breathLights.length = 0;
  }

  /** Emit one frame of the stream from `mouth` along `aimYaw`, pitched down by `pitch`. */
  breathEmit(dt, mouth, aimYaw, pitch = 0.17) {
    const T = TUNING.attacks.breath;
    const ca = Math.cos(aimYaw), sa = Math.sin(aimYaw);
    const add = this.add;
    this.breathAcc += dt * T.particlesPerSec;
    let n = Math.min(12, Math.floor(this.breathAcc));
    this.breathAcc -= n;
    while (n-- > 0) {
      const yj = rand(-0.09, 0.09), pj = pitch + rand(-0.05, 0.06);
      const y = aimYaw + yj;
      const cp = Math.cos(pj);
      const sp = rand(20, 27);
      const hot = Math.random() < 0.5;
      this._spawn(add, {
        x: mouth.x + rand(-0.1, 0.1), y: mouth.y + rand(-0.1, 0.1), z: mouth.z + rand(-0.1, 0.1),
        vx: Math.sin(y) * cp * sp, vy: -Math.sin(pj) * sp, vz: Math.cos(y) * cp * sp,
        life: rand(0.55, 0.8), size: rand(0.3, 0.45), sizeEnd: rand(1.3, 1.8),
        glyph: FIRE,
        color: hot ? [4.6, 3.5, 1.5] : [3.4, 1.4, 0.28],
        colorEnd: hot ? [2.2, 0.45, 0.06] : [0.8, 0.08, 0.012],
        alpha: 1, alphaEnd: 0, drag: 1.0, gravity: 2.5, spin: rand(-4, 4), rot: rand(0, 6.28), flicker: 0.25, stretch: 0.25,
      });
    }
    // smoke rolling off the far end
    this.smokeAcc += dt * 28;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const dd = rand(7, 13);
      this._spawn(this.alpha, {
        x: mouth.x + sa * dd + rand(-1, 1), y: rand(0.8, 2.0), z: mouth.z + ca * dd + rand(-1, 1),
        vx: sa * 2 + rand(-0.6, 0.6), vy: rand(1.2, 2.4), vz: ca * 2 + rand(-0.6, 0.6),
        life: rand(0.9, 1.4), size: 0.8, sizeEnd: 2.2, glyph: '%&#@',
        color: [0.035, 0.03, 0.028], alpha: 0.55, alphaEnd: 0, drag: 0.8, spin: rand(-1, 1),
      });
    }
    // lights along the stream
    this.breathLights.forEach((l, i) => {
      const dd = 3 + i * 4;
      l.set(mouth.x + sa * dd, 1.2, mouth.z + ca * dd);
    });
    // scorch + ground flames
    this.scorchTimer -= dt;
    if (this.scorchTimer <= 0) {
      this.scorchTimer = 0.08;
      const scorch = this.game.world?.scorch;
      for (const [dd, r] of [[4, 1.4], [6.5, 1.7], [9, 2.0], [11.5, 2.2]]) {
        const x = mouth.x + sa * dd + rand(-0.4, 0.4), z = mouth.z + ca * dd + rand(-0.4, 0.4);
        scorch?.burnCircle?.(x, z, r, 0.05, 0.9);
        this._spawn(add, {
          x: x + rand(-r, r) * 0.6, y: 0.25, z: z + rand(-r, r) * 0.6,
          vx: rand(-0.5, 0.5), vy: rand(1.5, 3.2), vz: rand(-0.5, 0.5),
          life: rand(0.35, 0.6), size: rand(0.35, 0.6), sizeEnd: 0.15, glyph: '^~*',
          color: [3.2, 1.3, 0.25], colorEnd: [0.7, 0.07, 0.01], alpha: 1, alphaEnd: 0, drag: 1.5, flicker: 0.4,
        });
      }
    }
  }

  /** Embers leaking from the mouth / nostrils while the throat charges. */
  mouthEmbers(dt, mouth, rate, fwd) {
    this.emberAcc += dt * rate;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      this._spawn(this.add, {
        x: mouth.x + rand(-0.15, 0.15), y: mouth.y + rand(-0.1, 0.1), z: mouth.z + rand(-0.15, 0.15),
        vx: (fwd?.x ?? 0) * 1.5 + rand(-0.6, 0.6), vy: rand(0.4, 1.6), vz: (fwd?.z ?? 0) * 1.5 + rand(-0.6, 0.6),
        life: rand(0.4, 0.8), size: rand(0.18, 0.3), sizeEnd: 0.06, glyph: EMBER,
        color: [3.2, 1.2, 0.2], colorEnd: [0.6, 0.06, 0.01], alpha: 1, alphaEnd: 0, drag: 1.2, gravity: 1.2, flicker: 0.5,
      });
    }
  }

  // ---------------------------------------------------------------- fireballs
  /** `volley`: shared {hitDone} so a whole volley damages the player at most once. */
  launchFireball(from, target, volley = null) {
    const T = TUNING.attacks.fireball;
    const slot = this.projectiles.find((p) => !p.alive);
    if (!slot) return;
    const dx = target.x - from.x, dz = target.z - from.z;
    const dist = Math.hypot(dx, dz);
    const flight = Math.min(1.3, Math.max(0.7, dist / 18));
    slot.alive = true;
    slot.volley = volley;
    slot.age = 0;
    slot.trail = 0;
    slot.hold = 0;
    slot.p.copy(from);
    slot.v.set(dx / flight, (0 - from.y + 0.5 * T.gravity * flight * flight) / flight, dz / flight);
    slot.light = this._light({ x: from.x, y: from.y, z: from.z, color: [1, 0.5, 0.15], intensity: 3.2, radius: 8, fade: 0.2, flicker: 0.35 });
    this.game.events?.emit('dragon:fireball', { x: from.x, y: from.y, z: from.z });
    for (let i = 0; i < 14; i++) {
      this._spawn(this.add, {
        x: from.x, y: from.y, z: from.z,
        vx: slot.v.x * 0.15 + rand(-3, 3), vy: rand(-1, 3), vz: slot.v.z * 0.15 + rand(-3, 3),
        life: rand(0.2, 0.4), size: rand(0.4, 0.7), sizeEnd: 0.1, glyph: FIRE,
        color: [4.5, 2.8, 1.0], colorEnd: [1.2, 0.15, 0.02], alpha: 1, alphaEnd: 0, drag: 3,
      });
    }
  }

  _updateProjectiles(dt) {
    const T = TUNING.attacks.fireball;
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.age += dt;
      pr.v.y -= T.gravity * dt;
      pr.p.addScaledVector(pr.v, dt);
      const p = pr.p;
      if (!Number.isFinite(p.x + p.y + p.z)) {
        pr.alive = false;
        pr.light?.kill();
        pr.light = null;
        continue;
      }
      pr.light?.set(p.x, p.y, p.z);
      const life = this._hold(pr, 'hold', dt);
      for (let i = 0; life > 0 && i < 2; i++) {
        this._spawn(this.add, {
          x: p.x + rand(-0.15, 0.15), y: p.y + rand(-0.15, 0.15), z: p.z + rand(-0.15, 0.15),
          life, size: rand(0.8, 1.15), sizeEnd: 0.9, glyph: i ? '@' : '#%',
          color: [5.2, 3.2, 1.3], alpha: 1, alphaEnd: 0.6, rot: rand(0, 6.28),
        });
      }
      pr.trail += dt * 70;
      while (pr.trail >= 1) {
        pr.trail -= 1;
        this._spawn(this.add, {
          x: p.x + rand(-0.2, 0.2), y: p.y + rand(-0.2, 0.2), z: p.z + rand(-0.2, 0.2),
          vx: rand(-0.6, 0.6), vy: rand(0.2, 1.2), vz: rand(-0.6, 0.6),
          life: rand(0.3, 0.5), size: rand(0.45, 0.65), sizeEnd: 0.12, glyph: FIRE,
          color: [3.4, 1.3, 0.25], colorEnd: [0.6, 0.05, 0.01], alpha: 1, alphaEnd: 0, drag: 2, spin: rand(-3, 3), flicker: 0.3,
        });
      }
      if (p.y <= 0.15 || pr.age > 3) {
        pr.alive = false;
        pr.light?.kill();
        pr.light = null;
        const volley = pr.volley;
        pr.volley = null;
        this.explode(p.x, p.z, T.radius, volley);
      }
    }
  }

  explode(x, z, radius, volley = null) {
    this._light({ x, y: 1.2, z, color: [1, 0.5, 0.16], intensity: 7, radius: 12, life: 0.6, fade: 0.45, flicker: 0.3 });
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 11);
      this._spawn(this.add, {
        x, y: rand(0.2, 0.8), z,
        vx: Math.cos(a) * sp, vy: rand(1, 7), vz: Math.sin(a) * sp,
        life: rand(0.35, 0.8), size: rand(0.45, 0.9), sizeEnd: 0.12, glyph: FIRE,
        color: Math.random() < 0.4 ? [5, 3.6, 1.5] : [3.6, 1.3, 0.25], colorEnd: [0.7, 0.06, 0.01],
        alpha: 1, alphaEnd: 0, drag: 2.4, gravity: -3, spin: rand(-5, 5), flicker: 0.3,
      });
    }
    this.dustRing(x, z, radius * 0.6, 26, 1);
    this.game.world?.scorch?.burnCircle?.(x, z, radius, 0.55, 1);
    this.d.onExplosion?.(x, z, radius, volley);
  }

  // ---------------------------------------------------------------- shock / dust / roar
  dustRing(x, z, r, n = 36, strength = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      const sp = rand(5, 10) * strength;
      this._spawn(this.alpha, {
        x: x + Math.cos(a) * r, y: rand(0.15, 0.6), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: rand(0.3, 2.2), vz: Math.sin(a) * sp,
        life: rand(0.6, 1.1), size: rand(0.4, 0.7), sizeEnd: rand(1.0, 1.6), glyph: DUST,
        color: [0.2, 0.19, 0.17], alpha: 0.75, alphaEnd: 0, drag: 2.8, gravity: -1.5, spin: rand(-2, 2),
      });
    }
  }

  /** Expanding rings of curved glyphs = the sound of a roar. */
  roarWave(x, y, z, strength = 1) {
    for (let ring = 0; ring < 3; ring++) {
      const n = 30;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const sp = (13 + ring * 4) * strength;
        this._spawn(this.add, {
          x: x + ca * (1 + ring), y: y - ring * 0.6, z: z + sa * (1 + ring),
          vx: ca * sp, vy: 0, vz: sa * sp,
          life: 0.55 + ring * 0.12, size: 0.7, sizeEnd: 1.6, glyph: ')',
          rot: Math.atan2(-sa, ca), // screen: x right, -z up -> ')' bulges outward
          color: [0.75, 0.6, 0.5], colorEnd: [0.5, 0.12, 0.04], alpha: 0.9, alphaEnd: 0, drag: 1.2,
        });
      }
    }
  }

  /** Ember puff from the nostrils (sleeping breaths, snorts). */
  snort(nostrils, fwd, strength = 1) {
    for (const p of nostrils) {
      for (let i = 0; i < Math.round(5 * strength); i++) {
        this._spawn(this.add, {
          x: p.x, y: p.y, z: p.z,
          vx: (fwd?.x ?? 0) * 1.2 * strength + rand(-0.4, 0.4), vy: rand(0.3, 1.2), vz: (fwd?.z ?? 0) * 1.2 * strength + rand(-0.4, 0.4),
          life: rand(0.6, 1.2), size: rand(0.16, 0.26), sizeEnd: 0.05, glyph: EMBER,
          color: [2.4, 0.75, 0.12], colorEnd: [0.5, 0.05, 0.01], alpha: 1, alphaEnd: 0, drag: 1.4, gravity: 0.8, flicker: 0.6,
        });
      }
      this._spawn(this.alpha, {
        x: p.x, y: p.y, z: p.z,
        vx: (fwd?.x ?? 0) * 0.8, vy: 0.6, vz: (fwd?.z ?? 0) * 0.8,
        life: 1.2, size: 0.3, sizeEnd: 1.0, glyph: '~',
        color: [0.06, 0.055, 0.05], alpha: 0.5 * strength, alphaEnd: 0, drag: 1, spin: rand(-1, 1),
      });
    }
  }

  /** Per-frame glint over each glowing eye (offset toward the camera so it isn't depth-faded). */
  eyeGlints(dt, eyes, glow) {
    if (glow < 0.05) {
      this._held.glint = 0;
      return;
    }
    const life = this._hold(this._held, 'glint', dt);
    if (!life) return;
    const cam = this.game.camera?.position;
    for (const e of eyes) {
      let x = e.x, y = e.y, z = e.z;
      if (cam) {
        const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z;
        const l = Math.hypot(dx, dy, dz) || 1;
        x += (dx / l) * 0.45; y += (dy / l) * 0.45; z += (dz / l) * 0.45;
      }
      this._spawn(this.add, {
        x, y, z, life, size: 0.34, sizeEnd: 0.3, glyph: '•',
        color: [3.2 * glow, 0.75 * glow, 0.12 * glow], alpha: 1, alphaEnd: 1,
      });
    }
  }

  /** Embers drifting off the body (phase 2, death). points: array of {x,y,z,r}. */
  bodyEmbers(dt, points, rate, big = false) {
    if (!points.length) return;
    this._bodyAcc = (this._bodyAcc || 0) + dt * rate;
    while (this._bodyAcc >= 1) {
      this._bodyAcc -= 1;
      const s = points[Math.floor(Math.random() * points.length)];
      const r = s.r ?? 0.5;
      this._spawn(this.add, {
        x: s.x + rand(-r, r), y: s.y + rand(-r, r) * 0.7, z: s.z + rand(-r, r),
        vx: rand(-0.4, 0.4), vy: big ? rand(1.5, 4) : rand(0.6, 1.8), vz: rand(-0.4, 0.4),
        life: big ? rand(0.9, 1.8) : rand(0.6, 1.2), size: big ? rand(0.25, 0.5) : rand(0.14, 0.24), sizeEnd: 0.05,
        glyph: big ? ".'`*^" : EMBER,
        color: big ? [3.4, 1.2, 0.25] : [2.4, 0.7, 0.12], colorEnd: [0.55, 0.05, 0.01],
        alpha: 1, alphaEnd: 0, drag: 0.6, gravity: big ? 1.5 : 0.6, flicker: 0.5, spin: rand(-2, 2),
      });
    }
  }

  /** Ring of ember dots marking the leap-slam landing spot (call every frame while it shows). */
  warnRing(dt, x, z, r, intensity) {
    const life = this._hold(this._held, 'warn', dt);
    if (!life) return;
    const n = 26;
    const k = 3.2 * intensity;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (this.game.time ?? 0) * 0.8;
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: 0.45, z: z + Math.sin(a) * r,
        life, size: 0.38, sizeEnd: 0.34, glyph: '·',
        color: [k, k * 0.23, k * 0.04], alpha: 1, alphaEnd: 1,
      });
    }
  }

  /** Small spray of embers where the dragon was struck. */
  hitSpark(x, y, z, dx, dz, heavy) {
    const n = heavy ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const sp = rand(2, heavy ? 8 : 5);
      this._spawn(this.add, {
        x, y, z,
        vx: dx * sp + rand(-2, 2), vy: rand(0.5, 4), vz: dz * sp + rand(-2, 2),
        life: rand(0.25, 0.55), size: rand(0.2, 0.35), sizeEnd: 0.05, glyph: "*+'`.",
        color: [3.5, 1.3, 0.3], colorEnd: [0.6, 0.06, 0.01], alpha: 1, alphaEnd: 0, drag: 2, gravity: -6,
      });
    }
  }

  update(dt) {
    this._updateProjectiles(dt);
    this._pruneLights();
  }
}
