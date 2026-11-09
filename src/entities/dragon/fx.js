import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { TELL_STYLE } from '../../combat/rules.js';

// Dragon FX: fire breath stream (glyph particles + pooled lights + scorch), fireball projectiles,
// roar shock rings, dust, nostril embers, eye glints, phase-2 / death embers, and the combat
// read-outs: timing flashes (red alarm burst for dodge-only tells, a white glint for parryable
// ones — no colour coding or text for parry), red ground warning rings, white/gold parry sparks,
// posture break. Every light this module creates is tracked so reset() can kill them.
// Body-linked sizes / distances scale with the wyrm (SCALE); projectile blasts do not.

const S = SCALE;
const FIRE = '*#%@&~^';
const EMBER = ".'`*";
const DUST = ",.`:'";
// atlas glyphs only (STYLE.md): alarm marks for the red flash; a star + line rays for the glint
const RED_GLYPHS = '!#';
const RED_CORE = '!';
const GLINT_CORE = '*';
const GLINT_RAY = '|';
// four-point sparkle strokes (screen-space rotation of '|'): vertical, horizontal, two diagonals
const SPARKLE_ROT = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
// parry sparks: hot white core, white + gold sparks (blue parries are bigger, not blue)
const PARRY_WHITE = [3.4, 3.2, 2.8];
const PARRY_GOLD = [3.4, 2.3, 0.75];
const PARRY_END = [0.8, 0.5, 0.2];
const PARRY_LIGHT = [1, 0.88, 0.62];
// red warning ring: '!' marks between dots
const RING_MARK = '!';
const RING_DOT = '·';
const rand = (a, b) => a + Math.random() * (b - a);
// scorch + ground flames along the breath: [distance from the mouth, radius] (v0.1 metres)
const SCORCH_STEPS = [[4, 1.4], [6.5, 1.7], [9, 2.0], [11.5, 2.2]];
const tellStyle = (tell) => TELL_STYLE[tell] ?? TELL_STYLE.normal;
// fire hazards / spells / flight (dragon-fire): atlas glyphs and linear HDR colours
const HZ_DOT = '·';
const HZ_MARK = '!';
const HZ_CROSS = '+';
const HZ_RISE = '^';
const CHEVRON = '>';
const STREAK = '|';
const SHOCK = ')';
const METEOR_CORE = '@';
const METEOR_HALO = '*';
const FIRE_TALL = '^*#%&';
const FIRE_LOW = '^~*';
const CRACK = '~^,';
const ROCK = '.,:;o';
const LAVA_COLUMN = '#%@&!|';
const LAVA_DROPS = '.o•';
const LAVA_SPLASH = '~';
const EMBER_STAR = ".'*•";
const SMOKE_GLYPHS = '%&#@';
const RED = TELL_STYLE.red.color;
const HOT = [4.6, 3.5, 1.5]; // white-yellow fire core
const HOT_END = [2.2, 0.45, 0.06];
const FLAME = [3.4, 1.4, 0.28]; // orange
const DARK = [0.8, 0.08, 0.012]; // a dying flame
const EMBER_COL = [3.0, 1.0, 0.18];
const WHITE_HOT = [6.0, 5.2, 4.0];
const LAVA_HOT = [5.4, 3.4, 1.2];
const LAVA = [3.8, 1.25, 0.2];
const LAVA_END = [1.1, 0.12, 0.02];
const SMOKE = [0.045, 0.04, 0.036];
const ROCK_COL = [0.17, 0.14, 0.12];
const NO_HIT = Object.freeze({ hitDone: true }); // a volley that never deals damage (visual shells)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Pooled-light colour (0..1) from an HDR tell colour. */
function lightColor(c) {
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  return [c[0] / m, c[1] / m, c[2] / m];
}

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
    this._bodyAcc = 0;
    this._held = { glint: 0, warn: 0, stars: 0 };
    this._warnAcc = 0;
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
    // reused spawn record for the per-frame warning ring (see warnRing)
    this._ringSpawn = { x: 0, y: 0.4, z: 0, life: 0.02, size: 0.4, sizeEnd: 0.4, glyph: RING_DOT, color: [0, 0, 0], alpha: 1, alphaEnd: 1 };
    // fire hazards / spells (see the "fire" section): one reused spawn record + colour scratch
    this._r = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.1, size: 0.4, sizeEnd: 0.4, glyph: '*', color: null, colorEnd: null, alpha: 1, alphaEnd: 0, drag: 0, gravity: 0, spin: 0, rot: 0, flicker: 0, stretch: 0 };
    this._c0 = [0, 0, 0];
    this._c1 = [0, 0, 0];
    this.skyLights = [];
    this.skyAcc = 0;
    this._novaAcc = 0;
    this._novaRing = 0;
    this._gatherAcc = 0;
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
    this.breathAcc = this.smokeAcc = this.emberAcc = this._bodyAcc = 0;
    this.scorchTimer = 0;
    this._held.glint = this._held.warn = this._held.stars = 0;
    this._warnAcc = 0;
    this.skyLights.length = 0;
    this.skyAcc = this._novaAcc = this._novaRing = this._gatherAcc = 0;
    this.d.hazards?.clear(); // (their lights were just killed with the rest)
  }

  // ---------------------------------------------------------------- fire breath
  breathBegin() {
    if (this.breathing) return;
    this.breathing = true;
    this.breathLights.length = 0;
    for (let i = 0; i < 3; i++) {
      const l = this._light({ x: 0, y: 1.2, z: 0, color: [1, 0.45, 0.12], intensity: 3.6 - i * 0.4, radius: (9 + i) * S, fadeIn: 0.15, fade: 0.35, flicker: 0.5 });
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
      const sp = rand(20, 27) * S; // the stream reaches T.range (scaled with the body)
      const hot = Math.random() < 0.5;
      this._spawn(add, {
        x: mouth.x + rand(-0.1, 0.1), y: mouth.y + rand(-0.1, 0.1), z: mouth.z + rand(-0.1, 0.1),
        vx: Math.sin(y) * cp * sp, vy: -Math.sin(pj) * sp, vz: Math.cos(y) * cp * sp,
        life: rand(0.55, 0.8), size: rand(0.3, 0.45) * S, sizeEnd: rand(1.3, 1.8) * S,
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
      const dd = rand(7, 13) * S;
      this._spawn(this.alpha, {
        x: mouth.x + sa * dd + rand(-1, 1), y: rand(0.8, 2.0), z: mouth.z + ca * dd + rand(-1, 1),
        vx: sa * 2 + rand(-0.6, 0.6), vy: rand(1.2, 2.4), vz: ca * 2 + rand(-0.6, 0.6),
        life: rand(0.9, 1.4), size: 0.8 * S, sizeEnd: 2.2 * S, glyph: '%&#@',
        color: [0.035, 0.03, 0.028], alpha: 0.55, alphaEnd: 0, drag: 0.8, spin: rand(-1, 1),
      });
    }
    // lights along the stream
    this.breathLights.forEach((l, i) => {
      const dd = (3 + i * 4) * S;
      l.set(mouth.x + sa * dd, 1.2, mouth.z + ca * dd);
    });
    // scorch + ground flames
    this.scorchTimer -= dt;
    if (this.scorchTimer <= 0) {
      this.scorchTimer = 0.08;
      const scorch = this.game.world?.scorch;
      for (const [d0, r0] of SCORCH_STEPS) {
        const dd = d0 * S, r = r0 * S;
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
        x: mouth.x + rand(-0.15, 0.15) * S, y: mouth.y + rand(-0.1, 0.1) * S, z: mouth.z + rand(-0.15, 0.15) * S,
        vx: (fwd?.x ?? 0) * 1.5 * S + rand(-0.6, 0.6), vy: rand(0.4, 1.6), vz: (fwd?.z ?? 0) * 1.5 * S + rand(-0.6, 0.6),
        life: rand(0.4, 0.8), size: rand(0.18, 0.3) * S, sizeEnd: 0.06 * S, glyph: EMBER,
        color: [3.2, 1.2, 0.2], colorEnd: [0.6, 0.06, 0.01], alpha: 1, alphaEnd: 0, drag: 1.2, gravity: 1.2, flicker: 0.5,
      });
    }
  }

  // ---------------------------------------------------------------- fireballs
  /**
   * `volley`: shared {hitDone} so a whole volley damages the player at most once.
   * Returns the shell's flight time (s) to the ground, 0 if no shell slot was free.
   */
  launchFireball(from, target, volley = null) {
    const T = TUNING.attacks.fireball;
    const slot = this.projectiles.find((p) => !p.alive);
    if (!slot) return 0;
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
    return flight;
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
      const sp = rand(5, 10) * strength * S;
      this._spawn(this.alpha, {
        x: x + Math.cos(a) * r, y: rand(0.15, 0.6), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: rand(0.3, 2.2), vz: Math.sin(a) * sp,
        life: rand(0.6, 1.1), size: rand(0.4, 0.7) * S, sizeEnd: rand(1.0, 1.6) * S, glyph: DUST,
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
        const sp = (13 + ring * 4) * strength * S;
        this._spawn(this.add, {
          x: x + ca * (1 + ring) * S, y: y - ring * 0.6 * S, z: z + sa * (1 + ring) * S,
          vx: ca * sp, vy: 0, vz: sa * sp,
          life: 0.55 + ring * 0.12, size: 0.7 * S, sizeEnd: 1.6 * S, glyph: ')',
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
          vx: (fwd?.x ?? 0) * 1.2 * strength * S + rand(-0.4, 0.4), vy: rand(0.3, 1.2), vz: (fwd?.z ?? 0) * 1.2 * strength * S + rand(-0.4, 0.4),
          life: rand(0.6, 1.2), size: rand(0.16, 0.26) * S, sizeEnd: 0.05 * S, glyph: EMBER,
          color: [2.4, 0.75, 0.12], colorEnd: [0.5, 0.05, 0.01], alpha: 1, alphaEnd: 0, drag: 1.4, gravity: 0.8, flicker: 0.6,
        });
      }
      this._spawn(this.alpha, {
        x: p.x, y: p.y, z: p.z,
        vx: (fwd?.x ?? 0) * 0.8, vy: 0.6, vz: (fwd?.z ?? 0) * 0.8,
        life: 1.2, size: 0.3 * S, sizeEnd: 1.0 * S, glyph: '~',
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
        x += (dx / l) * 0.45 * S; y += (dy / l) * 0.45 * S; z += (dz / l) * 0.45 * S;
      }
      // a small hot-orange glint (the reference's eye glows orange with a small halo; a 0.64 m
      // yellow-white dot bloomed into a ball over the ASCII head)
      this._spawn(this.add, {
        x, y, z, life, size: 0.2 * S, sizeEnd: 0.18 * S, glyph: '•',
        color: [2.0 * glow, 0.38 * glow, 0.05 * glow], alpha: 1, alphaEnd: 1,
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
        life: big ? rand(0.9, 1.8) : rand(0.6, 1.2), size: (big ? rand(0.25, 0.5) : rand(0.14, 0.24)) * S, sizeEnd: 0.05 * S,
        glyph: big ? ".'`*^" : EMBER,
        color: big ? [3.4, 1.2, 0.25] : [2.4, 0.7, 0.12], colorEnd: [0.55, 0.05, 0.01],
        alpha: 1, alphaEnd: 0, drag: 0.6, gravity: big ? 1.5 : 0.6, flicker: 0.5, spin: rand(-2, 2),
      });
    }
  }

  // ---------------------------------------------------------------- combat read-outs
  /**
   * Red AoE warning: a ring of red glyphs over the danger area + sparse ground sparks inside it.
   * Call every frame while it shows; `k` 0..1 ramps toward impact, `hot` = past the timing flash.
   */
  warnRing(dt, x, z, r, k, hot = false) {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = TELL_STYLE.red.color;
    const life = this._hold(this._held, 'warn', dt);
    const pool = this.add;
    if (life && pool) {
      const n = Math.max(24, Math.min(72, Math.round((Math.PI * 2 * r) / 0.75)));
      const t = this.game.time ?? 0;
      const b = (0.55 + 0.45 * k) * (hot ? 1.35 : 1) * (0.85 + 0.15 * Math.sin(t * (hot ? 30 : 12)));
      // up to 72 sprites every frame: one reused spawn record (the pool copies its fields)
      const o = this._ringSpawn;
      o.life = life;
      o.color[0] = c[0] * b;
      o.color[1] = c[1] * b;
      o.color[2] = c[2] * b;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.5;
        const mark = i % 6 === 0;
        o.x = x + Math.cos(a) * r;
        o.z = z + Math.sin(a) * r;
        o.size = o.sizeEnd = mark ? 0.62 : 0.4;
        o.glyph = mark ? RING_MARK : RING_DOT;
        pool.spawn(o);
      }
    }
    // interior: faint sparks rising off the ground so the whole area reads as dangerous
    this._warnAcc += dt * r * r * (0.9 + 1.6 * k);
    let m = Math.min(24, Math.floor(this._warnAcc));
    this._warnAcc -= m;
    while (m-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r * Math.sqrt(Math.random());
      const b = 0.35 + 0.5 * k;
      this._spawn(this.add, {
        x: x + Math.cos(a) * rr, y: 0.25, z: z + Math.sin(a) * rr,
        vx: 0, vy: rand(0.4, 1.2), vz: 0,
        life: rand(0.25, 0.45), size: 0.3, sizeEnd: 0.12, glyph: ".'·",
        color: [c[0] * b, c[1] * b, c[2] * b], alpha: 0.9, alphaEnd: 0, flicker: 0.4,
      });
    }
  }

  /**
   * Timing flash of a tell at the striking part (combat:flash). Red (dodge only): an alarm burst of
   * red glyphs + a red light. Normal / blue (parryable): a white glint — see _glint.
   */
  tellFlash(tell, x, y, z) {
    if (!Number.isFinite(x + y + z)) return;
    if (tell === 'red') this._redFlash(x, y, z);
    else this._glint(x, y, z, tellStyle(tell));
  }

  _redFlash(x, y, z) {
    const c = TELL_STYLE.red.color;
    // hard core mark
    this._spawn(this.add, {
      x, y, z, life: 0.3, size: 1.7 * S, sizeEnd: 0.4 * S, glyph: RED_CORE,
      color: [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6], colorEnd: c, alpha: 1, alphaEnd: 0,
    });
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.15, 0.15);
      const sp = rand(4, 9) * S;
      this._spawn(this.add, {
        x, y, z,
        vx: Math.cos(a) * sp, vy: rand(-1.5, 3.5), vz: Math.sin(a) * sp,
        life: rand(0.22, 0.4), size: rand(0.35, 0.55) * S, sizeEnd: 0.1, glyph: RED_GLYPHS,
        color: c, colorEnd: [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], alpha: 1, alphaEnd: 0, drag: 4, flicker: 0.3,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: lightColor(c), intensity: 4, radius: 6 * S, life: 0.3, fade: 0.25 });
  }

  /**
   * White glint (parry timing): a star core, a four-point sparkle (long screen-aligned cross + short
   * diagonals) and a few short rays shooting out in the screen plane, plus a small white light.
   * `st.glint` scales size and brightness (blue = 1.5: a heavier blow, same white). Pulled toward
   * the camera so the body doesn't swallow it.
   */
  _glint(x, y, z, st) {
    const k = st.glint > 0 ? st.glint : 1;
    const c = st.color;
    const cam = this.game.camera?.position;
    if (cam) {
      const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z;
      const l = Math.hypot(dx, dy, dz);
      if (l > 1e-3) {
        const o = (0.7 * S) / l;
        x += dx * o; y += dy * o; z += dz * o;
      }
    }
    const add = this.add;
    // star core
    this._spawn(add, {
      x, y, z, life: 0.26, size: 1.15 * S * k, sizeEnd: 0.25 * S * k, glyph: GLINT_CORE,
      color: [c[0] * 1.6 * k, c[1] * 1.6 * k, c[2] * 1.6 * k], colorEnd: [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5],
      alpha: 1, alphaEnd: 0, rot: rand(0, 0.6), spin: 2.5,
    });
    // four-point sparkle: long vertical + horizontal strokes, shorter diagonals (rot is screen-space)
    for (let i = 0; i < 4; i++) {
      const long = i < 2;
      const sz = (long ? 0.62 : 0.4) * S * k;
      this._spawn(add, {
        x, y, z, life: long ? 0.24 : 0.18, size: sz, sizeEnd: 0, glyph: GLINT_RAY,
        rot: SPARKLE_ROT[i], stretch: long ? 2.6 : 1.4,
        color: [c[0] * 1.3 * k, c[1] * 1.3 * k, c[2] * 1.3 * k], colorEnd: c, alpha: 1, alphaEnd: 0.2,
      });
    }
    // a few short rays flying out in the screen plane, each stroke aligned with its direction
    const U = this.game.U;
    const R = U?.uCamRight?.value, Up = U?.uCamUp?.value;
    const rx = R?.x ?? 1, ry = R?.y ?? 0, rz = R?.z ?? 0;
    const ux = Up?.x ?? 0, uy = Up?.y ?? 1, uz = Up?.z ?? 0;
    const n = k > 1 ? 8 : 6;
    const a0 = rand(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rand(-0.12, 0.12);
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp = rand(6, 9) * S * k;
      this._spawn(add, {
        x, y, z,
        vx: (rx * ca + ux * sa) * sp, vy: (ry * ca + uy * sa) * sp, vz: (rz * ca + uz * sa) * sp,
        life: rand(0.16, 0.24), size: 0.3 * S * k, sizeEnd: 0.06 * S, glyph: GLINT_RAY,
        rot: a - Math.PI / 2, stretch: 0.9,
        color: [c[0] * k, c[1] * k, c[2] * k], colorEnd: [c[0] * 0.25, c[1] * 0.25, c[2] * 0.25], alpha: 1, alphaEnd: 0, drag: 7,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: lightColor(c), intensity: 2.2 * k, radius: 4 * S * k, life: 0.22, fade: 0.2 });
  }

  /** Impact cue for AoE tells: the ring flares and throws its glyphs up. */
  ringPulse(x, z, r, tell = 'red') {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = tellStyle(tell).color;
    const n = Math.max(24, Math.min(64, Math.round((Math.PI * 2 * r) / 0.9)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this._spawn(this.add, {
        x: x + Math.cos(a) * r, y: 0.4, z: z + Math.sin(a) * r,
        vx: 0, vy: rand(2.5, 5), vz: 0,
        life: rand(0.3, 0.45), size: 0.6, sizeEnd: 0.25, glyph: '!#',
        color: [c[0] * 1.3, c[1] * 1.3, c[2] * 1.3], colorEnd: c, alpha: 1, alphaEnd: 0, drag: 3,
      });
    }
  }

  /** The roar's damaging shock ring: red glyphs racing out to the ring's edge. */
  shockRing(x, z, r) {
    if (!(r > 0) || !Number.isFinite(x + z)) return;
    const c = TELL_STYLE.red.color;
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      this._spawn(this.add, {
        x: x + ca * 1.5 * S, y: 0.6, z: z + sa * 1.5 * S,
        vx: ca * (r / 0.32), vy: 0, vz: sa * (r / 0.32),
        life: 0.34, size: 0.8, sizeEnd: 1.4, glyph: ')',
        rot: Math.atan2(-sa, ca), // ')' bulges outward on screen
        color: [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2], colorEnd: [c[0] * 0.3, c[1] * 0.2, c[2] * 0.2], alpha: 1, alphaEnd: 0, drag: 0.5,
      });
    }
  }

  /** Parry: a hard white/gold spark burst where the blow was turned aside (blue: bigger, still white/gold). */
  parrySpark(x, y, z, tell = 'normal') {
    if (!Number.isFinite(x + y + z)) return;
    const big = tell === 'blue';
    const w = PARRY_WHITE;
    this._spawn(this.add, {
      x, y, z, life: big ? 0.26 : 0.22, size: (big ? 2.3 : 1.8) * S, sizeEnd: 0.5 * S, glyph: '*',
      color: [w[0] * 1.5, w[1] * 1.5, w[2] * 1.5], colorEnd: PARRY_GOLD, alpha: 1, alphaEnd: 0,
    });
    const n = big ? 36 : 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(5, big ? 15 : 13);
      this._spawn(this.add, {
        x, y, z,
        vx: Math.cos(a) * sp, vy: rand(-1, 6), vz: Math.sin(a) * sp,
        life: rand(0.2, 0.45), size: rand(0.25, 0.45), sizeEnd: 0.05, glyph: "*+x'`",
        color: Math.random() < 0.5 ? w : PARRY_GOLD, colorEnd: PARRY_END, alpha: 1, alphaEnd: 0, drag: 3, gravity: 8, stretch: 0.3,
      });
    }
    this._light({ x, y: Math.max(0.8, y), z, color: PARRY_LIGHT, intensity: big ? 6 : 5, radius: big ? 8.5 : 7, life: 0.25, fade: 0.2 });
  }

  /** Posture break: a gold burst off the head as it slumps. */
  breakBurst(x, y, z) {
    if (!Number.isFinite(x + y + z)) return;
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 9) * S;
      this._spawn(this.add, {
        x, y, z,
        vx: Math.cos(a) * sp, vy: rand(1, 6), vz: Math.sin(a) * sp,
        life: rand(0.35, 0.7), size: rand(0.35, 0.6) * S, sizeEnd: 0.1, glyph: '#*+',
        color: [3.4, 2.4, 0.7], colorEnd: [0.9, 0.3, 0.05], alpha: 1, alphaEnd: 0, drag: 2.5, gravity: 4,
      });
    }
    this._light({ x, y: Math.max(1, y), z, color: [1, 0.75, 0.3], intensity: 4.5, radius: 9 * S, life: 0.5, fade: 0.4 });
  }

  /** Dazed stars circling the head while the posture is broken (call every frame). */
  stunStars(dt, head) {
    const life = this._hold(this._held, 'stars', dt);
    if (!life || !head || !Number.isFinite(head.x + head.y + head.z)) return;
    const t = this.game.time ?? 0;
    for (let i = 0; i < 4; i++) {
      const a = t * 3.2 + (i / 4) * Math.PI * 2;
      this._spawn(this.add, {
        x: head.x + Math.cos(a) * 0.9 * S, y: head.y + 1.0 * S + Math.sin(a * 2) * 0.12, z: head.z + Math.sin(a) * 0.9 * S,
        life, size: 0.45 * S, sizeEnd: 0.45 * S, glyph: i % 2 ? '+' : '*',
        color: [2.6, 2.0, 0.6], alpha: 1, alphaEnd: 1,
      });
    }
  }

  /** Current position of the first live shell of `volley` (fireball tell flash). */
  shellPos(volley, out) {
    for (const p of this.projectiles) {
      if (p.alive && p.volley === volley) {
        out.copy(p.p);
        return true;
      }
    }
    return false;
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

  // ================================================================ fire hazards, spells and flight
  // (dragon-fire, contract 3). All glyph particles from the world atlas + pooled lights; the
  // per-frame emitters reuse one spawn record (the pools copy its fields): no per-particle objects.

  /** The reused spawn record with every field reset (colours: the _c0 / _c1 scratch, see _col). */
  _rec(x, y, z, life, size, sizeEnd, glyph) {
    const o = this._r;
    o.x = x;
    o.y = y;
    o.z = z;
    o.vx = o.vy = o.vz = 0;
    o.life = life;
    o.size = size;
    o.sizeEnd = sizeEnd;
    o.glyph = glyph;
    o.color = this._c0;
    o.colorEnd = this._c1;
    o.alpha = 1;
    o.alphaEnd = 0;
    o.drag = o.gravity = o.spin = o.rot = o.flicker = o.stretch = 0;
    return o;
  }

  /** Start / end colours of the next spawns: c0 x k0 -> c1 x k1. */
  _col(c0, k0, c1, k1) {
    const a = this._c0, b = this._c1;
    a[0] = c0[0] * k0;
    a[1] = c0[1] * k0;
    a[2] = c0[2] * k0;
    b[0] = c1[0] * k1;
    b[1] = c1[1] * k1;
    b[2] = c1[2] * k1;
  }

  /** Screen-space rotation that turns a glyph's +x (or, with `up`, its +y) along world direction (dx, dy, dz). */
  _screenRot(dx, dy, dz, up = false) {
    const U = this.game.U, R = U?.uCamRight?.value, Up = U?.uCamUp?.value;
    const sx = R ? dx * R.x + dy * R.y + dz * R.z : dx;
    const sy = Up ? dx * Up.x + dy * Up.y + dz * Up.z : -dz;
    return up ? Math.atan2(-sx, sy) : Math.atan2(sy, sx);
  }

  /** Life (s) for hazard `h`'s held sprites this frame (0 = last frame's copy still shows). */
  holdLife(h, dt) {
    return this._hold(h, 'hold', dt);
  }

  /** A light a hazard owns (tracked: reset() kills it; the hazard kills it when it ends). */
  hazardLight(x, z, color, intensity, radius) {
    return this._light({ x, y: 1.2, z, color, intensity, radius, fadeIn: 0.12, fade: 0.35, flicker: 0.45 });
  }

  /**
   * A hazard's red ground warning: red dots with '!' marks on the ring of radius r, an inner ring
   * closing in on the centre as the impact nears (k 0 -> 1: a countdown), a centre '+'. `hot` = past
   * its timing flash (brighter, faster pulse). style 1 = a lava pillar (the inner ring rises as '^').
   */
  hzRing(life, x, z, r, k, hot, style = 0) {
    const pool = this.add;
    if (!life || !pool || !Number.isFinite(x + z + r)) return;
    const t = this.game.time ?? 0;
    const b = (0.5 + 0.55 * k) * (hot ? 1.45 : 1) * (0.85 + 0.15 * Math.sin(t * (hot ? 32 : 10 + 10 * k)));
    const n = Math.max(14, Math.min(56, Math.round((Math.PI * 2 * r) / 0.8)));
    const o = this._rec(x, 0.35, z, life, 0.4, 0.4, HZ_DOT);
    o.alphaEnd = 1;
    this._col(RED, b, RED, b);
    const a0 = t * 0.45;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const mark = i % 5 === 0;
      o.x = x + Math.cos(a) * r;
      o.z = z + Math.sin(a) * r;
      o.size = o.sizeEnd = mark ? 0.58 : 0.4;
      o.glyph = mark ? HZ_MARK : HZ_DOT;
      pool.spawn(o);
    }
    const ri = r * (1 - k);
    if (ri > 0.35) {
      const m = Math.max(8, Math.round(n * (ri / r) * 0.7));
      const kb = b * (style ? 0.35 : 0.7);
      this._col(style ? LAVA : RED, kb, style ? LAVA : RED, kb);
      o.glyph = style ? HZ_RISE : HZ_DOT;
      o.size = o.sizeEnd = 0.36;
      for (let i = 0; i < m; i++) {
        const a = -a0 * 1.6 + (i / m) * Math.PI * 2;
        o.x = x + Math.cos(a) * ri;
        o.z = z + Math.sin(a) * ri;
        pool.spawn(o);
      }
    }
    this._col(RED, b * 0.9, RED, b * 0.9);
    o.x = x;
    o.z = z;
    o.glyph = HZ_CROSS;
    o.size = o.sizeEnd = 0.55 + 0.3 * k;
    pool.spawn(o);
  }

  /** A hazard's timing flash (combat:flash): its ring flares and throws red glyphs up, a red core, a red light. */
  hazardFlash(x, z, r) {
    if (!Number.isFinite(x + z + r)) return;
    const add = this.add;
    const n = Math.max(14, Math.min(40, Math.round((Math.PI * 2 * r) / 0.9)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const o = this._rec(x + Math.cos(a) * r, 0.4, z + Math.sin(a) * r, rand(0.25, 0.4), 0.6, 0.22, RED_GLYPHS);
      o.vy = rand(2.5, 5);
      o.drag = 3;
      this._col(RED, 1.35, RED, 1);
      this._spawn(add, o);
    }
    const o = this._rec(x, 0.9, z, 0.28, 1.5, 0.4, HZ_MARK);
    this._col(RED, 1.6, RED, 1);
    this._spawn(add, o);
    this._light({ x, y: 1, z, color: lightColor(RED), intensity: 3, radius: 5 + r, life: 0.28, fade: 0.22 });
  }

  /** Before a lava pillar: the ground cracks glow and spit sparks, faster as the eruption nears. */
  pillarRumble(h, dt, x, z, r, k) {
    h.acc2 += dt * (5 + 30 * k * k);
    let m = Math.min(6, Math.floor(h.acc2));
    h.acc2 -= m;
    while (m-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r * 0.85 * Math.sqrt(Math.random());
      const o = this._rec(x + Math.cos(a) * rr, 0.15, z + Math.sin(a) * rr, rand(0.35, 0.7), rand(0.3, 0.45), 0.1, CRACK);
      o.vy = rand(0.5, 1.8 + 2 * k);
      o.flicker = 0.4;
      this._col(LAVA, 0.45 + 0.6 * k, LAVA_END, 0.6);
      this._spawn(this.add, o);
    }
  }

  /**
   * A falling meteor at (x, y, z) moving along (vx, vy, vz): a white-hot core in an orange halo, a
   * streak of '|' strokes laid along its screen-space motion, a fire trail, smoke, its own light.
   */
  meteor(life, h, dt, x, y, z, vx, vy, vz, big = true) {
    if (!Number.isFinite(x + y + z + vx + vy + vz)) return;
    const add = this.add;
    const s = big ? 1 : 0.7;
    const vl = Math.hypot(vx, vy, vz) || 1;
    if (life && add) {
      const o = this._rec(x, y, z, life, 1.5 * s, 1.5 * s, METEOR_CORE);
      o.alphaEnd = 1;
      this._col(WHITE_HOT, 1.1, WHITE_HOT, 1.1);
      add.spawn(o);
      o.glyph = METEOR_HALO;
      o.size = o.sizeEnd = 2.8 * s;
      o.alpha = o.alphaEnd = 0.55;
      this._col(FLAME, 0.7, FLAME, 0.7);
      add.spawn(o);
      o.glyph = STREAK;
      o.rot = this._screenRot(vx, vy, vz, true);
      o.alpha = o.alphaEnd = 1;
      o.stretch = 2.2;
      for (let i = 1; i <= 3; i++) {
        const back = i * 1.4 * s;
        o.x = x - (vx / vl) * back;
        o.y = y - (vy / vl) * back;
        o.z = z - (vz / vl) * back;
        o.size = o.sizeEnd = (1.25 - i * 0.22) * s;
        this._col(i === 1 ? HOT : FLAME, 1.3 - i * 0.25, FLAME, 1);
        add.spawn(o);
      }
    }
    h.acc += dt * 110 * s;
    let m = Math.min(10, Math.floor(h.acc));
    h.acc -= m;
    while (m-- > 0) {
      const o = this._rec(x + rand(-0.3, 0.3), y + rand(-0.3, 0.3), z + rand(-0.3, 0.3), rand(0.28, 0.55), rand(0.8, 1.35) * s, 0.15, FIRE);
      o.vx = vx * 0.08 + rand(-1, 1);
      o.vy = vy * 0.08 + rand(-0.5, 1.5);
      o.vz = vz * 0.08 + rand(-1, 1);
      o.drag = 2.5;
      o.spin = rand(-4, 4);
      o.rot = rand(0, 6.28);
      o.flicker = 0.3;
      this._col(Math.random() < 0.4 ? HOT : FLAME, 1, DARK, 1);
      this._spawn(add, o);
    }
    h.acc2 += dt * 26;
    while (h.acc2 >= 1) {
      h.acc2 -= 1;
      const o = this._rec(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), rand(0.8, 1.3), 1.0 * s, 2.6 * s, SMOKE_GLYPHS);
      o.vx = vx * 0.04;
      o.vy = 0.8;
      o.vz = vz * 0.04;
      o.drag = 1.2;
      o.alpha = 0.5;
      o.spin = rand(-1, 1);
      this._col(SMOKE, 1, SMOKE, 1);
      this._spawn(this.alpha, o);
    }
    if (!h.l0) h.l0 = this._light({ x, y, z, color: [1, 0.6, 0.25], intensity: 4.5, radius: 11, fade: 0.15, flicker: 0.3 });
    h.l0?.set(x, Math.max(1, y), z);
  }

  /** A meteor strikes: a white flash, a fire burst, flung rocks, a shock of ')' strokes, dust, scorch, a crater glow. */
  meteorImpact(h, x, z, r) {
    if (!Number.isFinite(x + z + r)) return;
    const add = this.add, g = this.game;
    h.l0?.kill();
    h.l0 = null;
    let o = this._rec(x, 0.8, z, 0.2, 3.4, 1.2, METEOR_CORE);
    this._col(WHITE_HOT, 1.2, HOT, 0.6);
    this._spawn(add, o);
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 12);
      o = this._rec(x, rand(0.2, 0.8), z, rand(0.35, 0.8), rand(0.5, 1.0), 0.12, FIRE);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(1, 8);
      o.vz = Math.sin(a) * sp;
      o.drag = 2.4;
      o.gravity = -3;
      o.spin = rand(-5, 5);
      o.flicker = 0.3;
      this._col(Math.random() < 0.4 ? HOT : FLAME, 1.1, DARK, 1);
      this._spawn(add, o);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(4, 10);
      o = this._rec(x, 0.4, z, rand(0.6, 1.0), rand(0.3, 0.5), 0.25, ROCK);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(5, 11);
      o.vz = Math.sin(a) * sp;
      o.gravity = -22;
      o.drag = 0.4;
      o.alpha = 0.95;
      o.alphaEnd = 0.6;
      o.spin = rand(-6, 6);
      this._col(ROCK_COL, 1, ROCK_COL, 0.7);
      this._spawn(this.alpha, o);
    }
    this._shock(x, z, r * 0.3, r * 1.3, 0.26, 26, 0.5, HOT, 0.9);
    this.dustRing(x, z, r * 0.6, 24, 0.9);
    g.world?.scorch?.burnCircle?.(x, z, r, 0.6, 1);
    g.world?.gust?.(x, z, 1.2, 9);
    this._light({ x, y: 1.5, z, color: [1, 0.62, 0.3], intensity: 8, radius: 13, life: 0.5, fade: 0.4, flicker: 0.2 });
    h.l1 = this._light({ x, y: 0.8, z, color: [1, 0.38, 0.08], intensity: 2.2, radius: 6, life: 1.3, fade: 1.0, flicker: 0.5 });
    const p = g.player?.position;
    const dist = p ? Math.hypot(p.x - x, p.z - z) : 99;
    g.shake?.(dist < 8 ? 0.32 : dist < 16 ? 0.16 : 0.07);
  }

  /** A ring of ')' strokes racing out from r0 to r1 in T s (each stroke bulging outward on screen). */
  _shock(x, z, r0, r1, T, n, y, c, k) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const o = this._rec(x + ca * r0, y, z + sa * r0, T, 0.85, 1.4, SHOCK);
      o.vx = (ca * (r1 - r0)) / T;
      o.vz = (sa * (r1 - r0)) / T;
      o.rot = Math.atan2(-sa, ca);
      this._col(c, k * 1.2, c, k * 0.3);
      this._spawn(this.add, o);
    }
  }

  /** The meteor's crater smoulders: embers and small flames rising (k 1 -> 0). */
  crater(h, dt, x, z, r, k) {
    if (k <= 0) return;
    h.acc3 += dt * 45 * k;
    let m = Math.min(5, Math.floor(h.acc3));
    h.acc3 -= m;
    while (m-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r * 0.6 * Math.sqrt(Math.random());
      const flame = Math.random() < 0.35;
      const o = this._rec(x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr, rand(0.4, 0.9), flame ? rand(0.4, 0.7) : rand(0.18, 0.3), 0.06, flame ? FIRE_LOW : EMBER);
      o.vx = rand(-0.4, 0.4);
      o.vy = flame ? rand(1, 2.4) : rand(1, 3.2);
      o.vz = rand(-0.4, 0.4);
      o.drag = 0.8;
      o.flicker = 0.5;
      this._col(flame ? FLAME : EMBER_COL, 0.6 + 0.6 * k, DARK, 0.6);
      this._spawn(this.add, o);
    }
  }

  /** A lava pillar erupts: a column of molten glyphs shoots up, droplets fly, a splash ring, scorch. */
  pillarBurst(h, x, z, r) {
    if (!Number.isFinite(x + z + r)) return;
    const add = this.add, g = this.game;
    let o;
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, rr = r * 0.5 * Math.sqrt(Math.random());
      o = this._rec(x + Math.cos(a) * rr, rand(0.2, 1.5), z + Math.sin(a) * rr, rand(0.45, 0.8), rand(1.0, 1.6), rand(0.3, 0.6), LAVA_COLUMN);
      o.vx = Math.cos(a) * rand(0, 1.5);
      o.vy = rand(13, 24);
      o.vz = Math.sin(a) * rand(0, 1.5);
      o.gravity = -16;
      o.drag = 0.6;
      o.stretch = 1.3;
      o.flicker = 0.25;
      this._col(Math.random() < 0.45 ? LAVA_HOT : LAVA, 1.1, LAVA_END, 1);
      this._spawn(add, o);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(3, 7);
      o = this._rec(x, rand(2, 6), z, rand(0.7, 1.1), rand(0.3, 0.5), 0.15, LAVA_DROPS);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(4, 10);
      o.vz = Math.sin(a) * sp;
      o.gravity = -20;
      this._col(LAVA_HOT, 1, LAVA_END, 1);
      this._spawn(add, o);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      o = this._rec(x + ca * r * 0.5, 0.3, z + sa * r * 0.5, 0.3, 0.6, 1.0, LAVA_SPLASH);
      o.vx = ca * r * 2.6;
      o.vz = sa * r * 2.6;
      o.drag = 2;
      this._col(LAVA, 0.9, LAVA_END, 0.5);
      this._spawn(add, o);
    }
    g.world?.scorch?.burnCircle?.(x, z, r * 1.1, 0.7, 1);
    this._light({ x, y: 2.5, z, color: [1, 0.5, 0.15], intensity: 7, radius: 11, life: 0.85, fade: 0.6, flicker: 0.3 });
    const p = g.player?.position;
    const dist = p ? Math.hypot(p.x - x, p.z - z) : 99;
    g.shake?.(dist < 6 ? 0.18 : 0.06);
  }

  /** The erupting column (k 1 -> 0 as it dies down). */
  pillarBurn(h, dt, x, z, r, k) {
    if (k <= 0) return;
    h.acc3 += dt * 150 * k;
    let m = Math.min(12, Math.floor(h.acc3));
    h.acc3 -= m;
    while (m-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r * 0.45 * Math.sqrt(Math.random());
      const o = this._rec(x + Math.cos(a) * rr, rand(0.1, 0.8), z + Math.sin(a) * rr, rand(0.3, 0.55), rand(0.9, 1.4), rand(0.25, 0.5), LAVA_COLUMN);
      o.vy = rand(8, 18) * (0.5 + 0.5 * k);
      o.gravity = -10;
      o.stretch = 1.1;
      o.flicker = 0.3;
      this._col(Math.random() < 0.4 ? LAVA_HOT : LAVA, 0.8 + 0.4 * k, LAVA_END, 0.8);
      this._spawn(this.add, o);
    }
  }

  /** A barrage shell the hazard drew itself (no free shell slot): the usual blast, no damage. */
  shellImpact(x, z, r) {
    this.explode(x, z, r, NO_HIT);
  }

  /** Red warning ahead of a strip's fire front: dotted edges and '>' chevrons from f to its end. */
  stripWarn(life, h, f, k) {
    const pool = this.add;
    if (!life || !pool) return;
    const t = this.game.time ?? 0;
    const hw = h.w / 2, dx = h.dx, dz = h.dz, qx = -dz, qz = dx;
    const o = this._rec(0, 0.35, 0, life, 0.4, 0.4, HZ_DOT);
    o.alphaEnd = 1;
    const rot = this._screenRot(dx, 0, dz);
    const step = 1.1;
    for (let i = Math.ceil(f / step); i * step <= h.len; i++) {
      const s = i * step;
      const near = clamp01(1 - (s - f) / 7);
      const b = (0.45 + 0.45 * k + 0.6 * near) * (0.85 + 0.15 * Math.sin(t * 12 - s * 0.6));
      this._col(RED, b, RED, b);
      const cx = h.ax + dx * s, cz = h.az + dz * s;
      o.glyph = HZ_DOT;
      o.rot = 0;
      o.size = o.sizeEnd = 0.4;
      o.x = cx + qx * hw;
      o.z = cz + qz * hw;
      pool.spawn(o);
      o.x = cx - qx * hw;
      o.z = cz - qz * hw;
      pool.spawn(o);
      if (i % 3 === 0) {
        o.glyph = CHEVRON;
        o.rot = rot;
        o.size = o.sizeEnd = 0.62;
        o.x = cx;
        o.z = cz;
        pool.spawn(o);
      }
    }
  }

  /** Flames over a strip's burning stretch [b0, f]; the fresh front burns tallest and scorches as it runs. */
  stripFire(h, dt, b0, f, front) {
    const add = this.add;
    const L = f - b0;
    if (!(L > 0.01)) return;
    const hw = h.w / 2, dx = h.dx, dz = h.dz, qx = -dz, qz = dx;
    h.acc += dt * Math.min(520, L * h.w * 3.2);
    let m = Math.min(16, Math.floor(h.acc));
    h.acc -= m;
    while (m-- > 0) {
      const s = b0 + Math.random() * L, l = (Math.random() * 2 - 1) * hw;
      const young = clamp01(1 - (f - s) / 6);
      const o = this._rec(h.ax + dx * s + qx * l, 0.2, h.az + dz * s + qz * l, rand(0.35, 0.65), rand(0.55, 0.95) * (1 + 0.5 * young), 0.12, FIRE_TALL);
      o.vy = rand(1.5, 3.5) * (1 + young);
      o.vx = rand(-0.4, 0.4);
      o.vz = rand(-0.4, 0.4);
      o.drag = 1.2;
      o.flicker = 0.4;
      o.spin = rand(-2, 2);
      this._col(Math.random() < 0.3 + 0.4 * young ? HOT : FLAME, 1, DARK, 1);
      this._spawn(add, o);
    }
    if (front) {
      const fx = h.ax + dx * f, fz = h.az + dz * f;
      h.acc2 -= dt;
      if (h.acc2 <= 0) {
        h.acc2 = 0.07;
        this.game.world?.scorch?.burnCircle?.(fx, fz, hw * 1.1, 0.16, 1);
        for (let i = 0; i < 6; i++) {
          const l = (Math.random() * 2 - 1) * hw;
          const o = this._rec(fx + qx * l, 0.3, fz + qz * l, rand(0.4, 0.7), rand(1.1, 1.7), 0.2, FIRE);
          o.vx = dx * rand(1, 4);
          o.vy = rand(3, 7);
          o.vz = dz * rand(1, 4);
          o.drag = 1.6;
          o.flicker = 0.3;
          this._col(HOT, 1.15, DARK, 1);
          this._spawn(add, o);
        }
      }
    }
    h.acc3 += dt * Math.min(30, L * 0.8);
    while (h.acc3 >= 1) {
      h.acc3 -= 1;
      const s = b0 + Math.random() * L;
      const o = this._rec(h.ax + dx * s, rand(1, 2.5), h.az + dz * s, rand(1, 1.6), 1.2, 3.0, SMOKE_GLYPHS);
      o.vy = rand(0.8, 1.8);
      o.drag = 0.6;
      o.alpha = 0.45;
      o.spin = rand(-1, 1);
      this._col(SMOKE, 1, SMOKE, 1);
      this._spawn(this.alpha, o);
    }
  }

  /** Before a flame ring ignites: a hot red ring at r0 round the wyrm and a dim dotted limit at r1. */
  ringWarn(life, h, k) {
    const pool = this.add;
    if (!life || !pool) return;
    const t = this.game.time ?? 0;
    const o = this._rec(0, 0.35, 0, life, 0.45, 0.45, HZ_DOT);
    o.alphaEnd = 1;
    const b = (0.55 + 0.6 * k) * (0.85 + 0.15 * Math.sin(t * (10 + 14 * k)));
    this._col(RED, b, RED, b);
    let n = Math.max(16, Math.min(48, Math.round((Math.PI * 2 * h.r0) / 0.55)));
    for (let i = 0; i < n; i++) {
      const a = t * 0.8 + (i / n) * Math.PI * 2;
      o.x = h.x + Math.cos(a) * h.r0;
      o.z = h.z + Math.sin(a) * h.r0;
      o.glyph = i % 4 === 0 ? HZ_MARK : HZ_DOT;
      o.size = o.sizeEnd = i % 4 === 0 ? 0.6 : 0.45;
      pool.spawn(o);
    }
    const kb = 0.35 + 0.35 * k;
    this._col(RED, kb, RED, kb);
    n = Math.max(24, Math.min(72, Math.round((Math.PI * 2 * h.r1) / 1.6)));
    o.glyph = HZ_DOT;
    o.size = o.sizeEnd = 0.38;
    for (let i = 0; i < n; i++) {
      const a = -t * 0.15 + (i / n) * Math.PI * 2;
      o.x = h.x + Math.cos(a) * h.r1;
      o.z = h.z + Math.sin(a) * h.r1;
      pool.spawn(o);
    }
  }

  /** The expanding ring of fire: a dense band of flames at r with a red leading edge; k fades it out. */
  ringFire(life, h, dt, r, k) {
    const add = this.add;
    if (!add || !(k > 0)) return;
    const hw = h.w / 2;
    h.acc += dt * Math.min(1100, Math.PI * 2 * r * 9) * k;
    let m = Math.min(30, Math.floor(h.acc));
    h.acc -= m;
    while (m-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r + (Math.random() * 2 - 1) * hw;
      const ca = Math.cos(a), sa = Math.sin(a);
      const o = this._rec(h.x + ca * rr, 0.2, h.z + sa * rr, rand(0.3, 0.55), rand(0.7, 1.2), 0.15, FIRE_TALL);
      o.vx = ca * h.speed * 0.6;
      o.vz = sa * h.speed * 0.6;
      o.vy = rand(2, 5);
      o.drag = 2.2;
      o.flicker = 0.4;
      o.spin = rand(-2, 2);
      this._col(Math.random() < 0.45 ? HOT : FLAME, k, DARK, 1);
      this._spawn(add, o);
    }
    if (life && k > 0.5) {
      const re = r + hw + 0.7;
      const n = Math.max(24, Math.min(72, Math.round((Math.PI * 2 * re) / 1.1)));
      const o = this._rec(0, 0.3, 0, life, 0.42, 0.42, HZ_DOT);
      o.alphaEnd = 1;
      this._col(RED, 1.1, RED, 1.1);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        o.x = h.x + Math.cos(a) * re;
        o.z = h.z + Math.sin(a) * re;
        add.spawn(o);
      }
    }
    h.acc2 -= dt;
    if (h.acc2 <= 0 && k > 0.5) {
      h.acc2 = 0.12;
      const sc = this.game.world?.scorch;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        sc?.burnCircle?.(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r, hw * 1.4, 0.18, 0.9);
      }
    }
  }

  /** Before a flame wall: a red line where it springs up, '>' chevrons down its corridor (the sweep). */
  wallWarn(life, h, k) {
    const pool = this.add;
    if (!life || !pool) return;
    const t = this.game.time ?? 0;
    const qx = -h.dz, qz = h.dx, half = h.len / 2;
    const o = this._rec(0, 0.35, 0, life, 0.45, 0.45, HZ_DOT);
    o.alphaEnd = 1;
    const b = (0.55 + 0.6 * k) * (0.85 + 0.15 * Math.sin(t * (10 + 14 * k)));
    this._col(RED, b, RED, b);
    let i = 0;
    for (let l = -half; l <= half; l += 1.0, i++) {
      o.x = h.x + qx * l;
      o.z = h.z + qz * l;
      o.glyph = i % 4 === 0 ? HZ_MARK : HZ_DOT;
      o.size = o.sizeEnd = i % 4 === 0 ? 0.62 : 0.45;
      pool.spawn(o);
    }
    o.rot = this._screenRot(h.dx, 0, h.dz);
    o.glyph = CHEVRON;
    o.size = o.sizeEnd = 0.6;
    const bb = 0.3 + 0.4 * k;
    for (let s = 3; s <= h.dist; s += 4) {
      const w = bb * (0.6 + 0.4 * Math.sin(t * 6 - s * 0.35));
      this._col(RED, w, RED, w);
      for (let l = -half + 3; l <= half - 3; l += 6) {
        o.x = h.x + h.dx * s + qx * l;
        o.z = h.z + h.dz * s + qz * l;
        pool.spawn(o);
      }
    }
  }

  /** The sweeping wall at centre (cx, cz): tall flames along it (k fades it out), a red leading edge, scorch. */
  wallFire(life, h, dt, cx, cz, k) {
    const add = this.add;
    if (!add || !(k > 0)) return;
    const qx = -h.dz, qz = h.dx, half = h.len / 2, hw = h.w / 2;
    h.acc += dt * Math.min(900, h.len * 18) * k;
    let m = Math.min(26, Math.floor(h.acc));
    h.acc -= m;
    while (m-- > 0) {
      const l = (Math.random() * 2 - 1) * half, s = (Math.random() * 2 - 1) * hw;
      const o = this._rec(cx + qx * l + h.dx * s, rand(0.1, 0.6), cz + qz * l + h.dz * s, rand(0.35, 0.6), rand(1.0, 1.6), 0.25, FIRE_TALL);
      o.vx = h.dx * h.speed * 0.8;
      o.vz = h.dz * h.speed * 0.8;
      o.vy = rand(4, 9);
      o.drag = 1.4;
      o.flicker = 0.35;
      o.stretch = 0.5;
      o.spin = rand(-1.5, 1.5);
      this._col(Math.random() < 0.5 ? HOT : FLAME, k, DARK, 1);
      this._spawn(add, o);
    }
    if (life && k > 0.5) {
      const o = this._rec(0, 0.3, 0, life, 0.42, 0.42, HZ_DOT);
      o.alphaEnd = 1;
      this._col(RED, 1.1, RED, 1.1);
      const ex = cx + h.dx * (hw + 0.8), ez = cz + h.dz * (hw + 0.8);
      for (let l = -half; l <= half; l += 1.1) {
        o.x = ex + qx * l;
        o.z = ez + qz * l;
        add.spawn(o);
      }
    }
    h.acc2 -= dt;
    if (h.acc2 <= 0 && k > 0.5) {
      h.acc2 = 0.12;
      const sc = this.game.world?.scorch;
      for (let l = -half + 2; l <= half; l += 5) sc?.burnCircle?.(cx + qx * l, cz + qz * l, hw * 1.5, 0.15, 0.9);
    }
  }

  // ---------------------------------------------------------------- flight + spell casts
  /** The aerial breath (sky strafe): lights along the stream, created / killed with the pass. */
  skyBegin() {
    this.skyEnd();
    for (let i = 0; i < 3; i++) {
      const l = this._light({ x: 0, y: 1, z: 0, color: [1, 0.46, 0.13], intensity: 3.6 - i * 0.5, radius: 9 + 2 * i, fadeIn: 0.12, fade: 0.35, flicker: 0.5 });
      if (l) this.skyLights.push(l);
    }
  }

  skyEnd() {
    for (const l of this.skyLights) l.kill();
    this.skyLights.length = 0;
  }

  /** One frame of fire streaming from the mouth down onto the ground front (fx, fz). */
  skyStream(dt, mouth, fx, fz) {
    if (!mouth || !Number.isFinite(mouth.x + mouth.y + mouth.z + fx + fz)) return;
    const dx = fx - mouth.x, dy = 0.3 - mouth.y, dz = fz - mouth.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const sp = 34;
    this.skyAcc += dt * 190;
    let n = Math.min(12, Math.floor(this.skyAcc));
    this.skyAcc -= n;
    while (n-- > 0) {
      const j = 0.09;
      const o = this._rec(mouth.x + rand(-0.15, 0.15), mouth.y + rand(-0.15, 0.15), mouth.z + rand(-0.15, 0.15), (L / sp) * rand(0.9, 1.12), rand(0.5, 0.75), rand(2.2, 3.0), FIRE);
      o.vx = (ux + rand(-j, j)) * sp;
      o.vy = (uy + rand(-j, j)) * sp;
      o.vz = (uz + rand(-j, j)) * sp;
      o.drag = 0.5;
      o.spin = rand(-4, 4);
      o.rot = rand(0, 6.28);
      o.flicker = 0.25;
      o.stretch = 0.25;
      if (Math.random() < 0.5) this._col(HOT, 1, HOT_END, 1);
      else this._col(FLAME, 1, DARK, 1);
      this._spawn(this.add, o);
    }
    const L0 = this.skyLights;
    L0[0]?.set(mouth.x, mouth.y, mouth.z);
    L0[1]?.set(mouth.x + dx * 0.55, mouth.y + dy * 0.55, mouth.z + dz * 0.55);
    L0[2]?.set(fx, 1.2, fz);
  }

  /** A wingbeat's downdraft near the ground: a dust ring and the grass flattened under the flier. */
  wingDust(x, z, strength) {
    if (!(strength > 0.05) || !Number.isFinite(x + z)) return;
    this.dustRing(x, z, 1.4 * S, Math.round(10 + 18 * strength), 0.5 + 0.7 * strength);
    this.game.world?.gust?.(x, z, Math.min(2, 0.8 + 1.2 * strength), 12 * S);
  }

  /** The meteor cast: a fireball spat straight up into the sky (a rising streak and a light). */
  castBolt(m) {
    if (!m || !Number.isFinite(m.x + m.y + m.z)) return;
    let o = this._rec(m.x, m.y, m.z, 0.85, 1.8, 0.9, METEOR_CORE);
    o.vy = 42;
    o.drag = 0.4;
    this._col(WHITE_HOT, 1, FLAME, 1);
    this._spawn(this.add, o);
    for (let i = 0; i < 36; i++) {
      o = this._rec(m.x + rand(-0.3, 0.3), m.y + rand(0, 2), m.z + rand(-0.3, 0.3), rand(0.4, 0.9), rand(0.7, 1.1), 0.15, FIRE);
      o.vx = rand(-1, 1);
      o.vy = rand(18, 40);
      o.vz = rand(-1, 1);
      o.drag = 1.0;
      o.flicker = 0.3;
      this._col(Math.random() < 0.5 ? HOT : FLAME, 1, DARK, 1);
      this._spawn(this.add, o);
    }
    this._light({ x: m.x, y: m.y + 4, z: m.z, color: [1, 0.55, 0.2], intensity: 6, radius: 12, life: 0.7, fade: 0.5 });
  }

  /** Fire gathering round the wyrm before a flame ring (k 0 -> 1): flames swirl in on a circle round (x, z). */
  gatherFire(dt, x, z, r, k) {
    if (!Number.isFinite(x + z + r)) return;
    this._gatherAcc += dt * (30 + 140 * k);
    let n = Math.min(14, Math.floor(this._gatherAcc));
    this._gatherAcc -= n;
    while (n-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = r * rand(1.2, 2.6);
      const ca = Math.cos(a), sa = Math.sin(a);
      const o = this._rec(x + ca * rr, rand(0.2, 2.5), z + sa * rr, rand(0.5, 0.8), rand(0.35, 0.6), 0.1, FIRE_TALL);
      o.vx = -sa * 7 - ca * 3;
      o.vz = ca * 7 - sa * 3;
      o.vy = rand(0.3, 1.5);
      o.flicker = 0.4;
      o.drag = 0.5;
      this._col(FLAME, 0.6 + 0.6 * k, DARK, 1);
      this._spawn(this.add, o);
    }
  }

  /**
   * The nova's charge (k 0 -> 1): embers sucked in from all round onto the chest (cx, cy, cz), rings
   * of ')' contracting onto it, glowing cracks round its feet.
   */
  novaCharge(dt, cx, cy, cz, k) {
    if (!Number.isFinite(cx + cy + cz)) return;
    const add = this.add;
    this._novaAcc += dt * (50 + 300 * k * k);
    let n = Math.min(24, Math.floor(this._novaAcc));
    this._novaAcc -= n;
    while (n-- > 0) {
      const a = Math.random() * Math.PI * 2, rr = rand(9, 18);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = rand(0.3, 10);
      const T = rand(0.5, 0.75);
      const o = this._rec(x, y, z, T * 0.97, rand(0.3, 0.5), 0.12, EMBER_STAR);
      o.vx = (cx - x) / T;
      o.vy = (cy - y) / T;
      o.vz = (cz - z) / T;
      o.flicker = 0.3;
      this._col(EMBER_COL, 0.9, WHITE_HOT, 0.8 + 0.4 * k);
      this._spawn(add, o);
    }
    this._novaRing -= dt;
    if (this._novaRing <= 0) {
      this._novaRing = 0.42 - 0.2 * k;
      const r = 14, m = 40, T = 0.5;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const o = this._rec(cx + ca * r, 0.6, cz + sa * r, T, 1.2, 0.5, SHOCK);
        o.vx = (-ca * r) / T;
        o.vz = (-sa * r) / T;
        o.rot = Math.atan2(-sa, ca) + Math.PI; // ')' turned to bulge inward
        this._col(FLAME, 0.5 + 0.7 * k, WHITE_HOT, 0.7 + 0.5 * k);
        this._spawn(add, o);
      }
    }
    this._gatherAcc += dt * (10 + 50 * k);
    while (this._gatherAcc >= 1) {
      this._gatherAcc -= 1;
      const a = Math.random() * Math.PI * 2, rr = rand(2, 9);
      const o = this._rec(cx + Math.cos(a) * rr, 0.15, cz + Math.sin(a) * rr, rand(0.4, 0.8), rand(0.35, 0.5), 0.1, CRACK);
      o.vy = rand(0.6, 2.2);
      o.flicker = 0.4;
      this._col(LAVA, 0.5 + 0.8 * k, LAVA_END, 0.6);
      this._spawn(add, o);
    }
  }

  /** The nova goes off at (x, y, z): shock rings race out to r, a white flash, a fire storm, the ground scorched. */
  novaBlast(x, y, z, r) {
    if (!Number.isFinite(x + y + z + r)) return;
    const add = this.add, g = this.game;
    let o = this._rec(x, y, z, 0.3, 9, 2.5, METEOR_CORE);
    this._col(WHITE_HOT, 1.4, HOT, 0.8);
    this._spawn(add, o);
    this._shock(x, z, 2, r, 0.3, 56, 0.6, WHITE_HOT, 1);
    this._shock(x, z, 2, r, 0.4, 56, 1.8, FLAME, 1.1);
    this._shock(x, z, 2, r, 0.52, 56, 3.2, RED, 1);
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(10, 36);
      o = this._rec(x + Math.cos(a) * 2, rand(0.4, 3), z + Math.sin(a) * 2, rand(0.45, 0.95), rand(0.7, 1.3), 0.2, FIRE);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(0.5, 8);
      o.vz = Math.sin(a) * sp;
      o.drag = 1.7;
      o.gravity = -2;
      o.spin = rand(-5, 5);
      o.flicker = 0.3;
      this._col(Math.random() < 0.5 ? HOT : FLAME, 1.1, DARK, 1);
      this._spawn(add, o);
    }
    for (let i = 0; i < 60; i++) {
      o = this._rec(x + rand(-3, 3), y + rand(-2, 2), z + rand(-3, 3), rand(1, 1.8), rand(0.25, 0.45), 0.08, EMBER);
      o.vx = rand(-6, 6);
      o.vy = rand(8, 18);
      o.vz = rand(-6, 6);
      o.gravity = -5;
      o.drag = 0.6;
      o.flicker = 0.5;
      this._col(EMBER_COL, 1.2, DARK, 1);
      this._spawn(add, o);
    }
    this.dustRing(x, z, 3 * S, 48, 1.6);
    g.world?.scorch?.burnCircle?.(x, z, r * 0.85, 0.32, 1);
    g.world?.gust?.(x, z, 2, r * 1.4);
    this._light({ x, y: 4, z, color: [1, 0.85, 0.6], intensity: 14, radius: 34, life: 0.55, fade: 0.45 });
    this._light({ x, y: 2, z, color: [1, 0.45, 0.12], intensity: 4, radius: 22, life: 1.8, fade: 1.4, flicker: 0.4 });
  }

  /** The dive bomb's crash landing: shock strokes out to the radius, fire and rocks flung, a big dust ring. */
  crashWave(x, z, r) {
    if (!Number.isFinite(x + z + r)) return;
    const add = this.add, g = this.game;
    this._shock(x, z, 2, r, 0.24, 40, 0.5, HOT, 1);
    this._shock(x, z, 2, r, 0.34, 40, 1.5, FLAME, 1);
    let o;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(4, 14);
      o = this._rec(x, rand(0.3, 1.2), z, rand(0.35, 0.7), rand(0.6, 1.1), 0.15, FIRE);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(1, 6);
      o.vz = Math.sin(a) * sp;
      o.drag = 2.2;
      o.gravity = -3;
      o.flicker = 0.3;
      this._col(Math.random() < 0.4 ? HOT : FLAME, 1, DARK, 1);
      this._spawn(add, o);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(5, 13);
      o = this._rec(x + Math.cos(a) * 2, 0.5, z + Math.sin(a) * 2, rand(0.6, 1.1), rand(0.35, 0.6), 0.3, ROCK);
      o.vx = Math.cos(a) * sp;
      o.vy = rand(6, 13);
      o.vz = Math.sin(a) * sp;
      o.gravity = -22;
      o.alpha = 0.95;
      o.alphaEnd = 0.6;
      o.spin = rand(-6, 6);
      this._col(ROCK_COL, 1, ROCK_COL, 0.7);
      this._spawn(this.alpha, o);
    }
    this.dustRing(x, z, 2.2 * S, 60, 1.7);
    g.world?.scorch?.burnCircle?.(x, z, r * 0.7, 0.4, 0.8);
    g.world?.gust?.(x, z, 2, 24 * S);
    this._light({ x, y: 2, z, color: [1, 0.6, 0.25], intensity: 9, radius: 16, life: 0.6, fade: 0.45 });
  }

  update(dt) {
    this._updateProjectiles(dt);
    this._pruneLights();
  }
}
