// Glyph FX of the bullet-hell projectiles and the fire wheel (bullets.js). Plain functions over the
// wyrm's DragonFx instance (`fx`): they reuse its spawn record (_rec / _col), held-mark timer
// (_hold), pooled lights (_light) and the shared additive glyph pool, so nothing here allocates per
// frame. Only atlas glyphs (tests/glyphcheck.mjs).
//
// The three bullets read apart by colour AND shape (docs/STYLE.md "Bullets"):
//   ember  gold-orange '*' with a short ember tail            (parry / block / roll / cut)
//   wisp   blue-white 'o' in a pale '@' halo, a '~' wake      (homing: parry / cut)
//   orb    red '@' in a turning 'O' ring, a '!' / '#' tail    (dodge only)

import { TELL_STYLE } from '../../combat/rules.js';
import { TUNING } from './tuning.js';

const EMBER_CORE = '*';
const EMBER_TAIL = ".'`*";
const WISP_CORE = 'o';
const WISP_HALO = '@';
const WISP_TAIL = '~';
const ORB_CORE = '@';
const ORB_HALO = 'O';
const ORB_TAIL = '!#';
const SPARKS = "*+x'`";
const CLASH = '+x*×';
const STREAK = '-';
const GLINT_PLUS = '+';
const GLINT_STAR = '*';
const WARN_MARK = '!';
const FLAME_TALL = '^*#%&';
const BEAM_CORE = '#';
const PUFF = '*^~';
const RETURN_HALO = 'O';

const RED = TELL_STYLE.red.color;
const GOLD = [4.4, 2.5, 0.6];
const ORANGE = [3.2, 1.1, 0.2];
const DARK = [0.8, 0.08, 0.012];
const WISP = [1.6, 2.6, 4.4];
const WISP_PALE = [0.7, 1.3, 2.8];
const WISP_END = [0.08, 0.2, 0.7];
const MOON = [2.6, 3.4, 4.6]; // the blade's blue-white: the clash colour
const MOON_END = [0.25, 0.5, 1.2];
const WHITE = [4.2, 4.0, 3.6];
const HOT = [4.6, 3.5, 1.5];
const CLASH_LIGHT = [0.7, 0.85, 1];
const FIRE_LIGHT = [1, 0.5, 0.15];
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

/** One bullet, every frame: a held core (+ halo) and a thin trail. */
export function drawBullet(fx, b, dt) {
  const life = fx._hold(b, 'hold', dt);
  const dim = b.dud ? 0.45 : 1;
  const pulse = 1 + 0.12 * Math.sin(b.t * 14 + b.seed);
  if (life > 0) {
    let o;
    if (b.kind === 2) {
      fx._col(RED, 1.6 * dim, RED, 1.6 * dim);
      o = fx._rec(b.x, b.y, b.z, life, 1.15 * pulse, 1.15 * pulse, ORB_CORE);
      o.alphaEnd = 1;
      fx._spawn(fx.add, o);
      fx._col(RED, 0.75 * dim, RED, 0.75 * dim);
      o = fx._rec(b.x, b.y, b.z, life, 1.75 * pulse, 1.75 * pulse, ORB_HALO);
      o.alphaEnd = 1;
      o.rot = b.t * 3 + b.seed;
      fx._spawn(fx.add, o);
    } else if (b.kind === 1) {
      fx._col(WISP, 1.3 * dim, WISP, 1.3 * dim);
      o = fx._rec(b.x, b.y, b.z, life, 0.7 * pulse, 0.7 * pulse, WISP_CORE);
      o.alphaEnd = 1;
      fx._spawn(fx.add, o);
      fx._col(WISP_PALE, 0.6 * dim, WISP_PALE, 0.6 * dim);
      o = fx._rec(b.x, b.y, b.z, life, 1.15 * pulse, 1.15 * pulse, WISP_HALO);
      o.alphaEnd = 1;
      o.rot = -b.t * 2 + b.seed;
      fx._spawn(fx.add, o);
    } else {
      // (an ember still gathering before its launch is smaller and flickers)
      const k = b.launched ? 1 : 0.6 + 0.25 * Math.sin(b.t * 30 + b.seed);
      fx._col(GOLD, dim * k, GOLD, dim * k);
      o = fx._rec(b.x, b.y, b.z, life, 0.66 * pulse * (b.launched ? 1 : 0.75), 0.66 * pulse, EMBER_CORE);
      o.alphaEnd = 1;
      o.rot = b.t * 5 + b.seed;
      fx._spawn(fx.add, o);
    }
  }
  b.acc += dt * (b.kind === 2 ? 14 : 10);
  while (b.acc >= 1) {
    b.acc -= 1;
    let o;
    if (b.kind === 2) {
      fx._col(RED, 0.9 * dim, RED, 0.2);
      o = fx._rec(b.x + rand(-0.2, 0.2), b.y + rand(-0.2, 0.2), b.z + rand(-0.2, 0.2), rand(0.25, 0.4), 0.55, 0.12, ORB_TAIL);
    } else if (b.kind === 1) {
      fx._col(WISP_PALE, dim, WISP_END, 1);
      o = fx._rec(b.x + rand(-0.1, 0.1), b.y + rand(-0.1, 0.1), b.z + rand(-0.1, 0.1), rand(0.3, 0.45), 0.5, 0.1, WISP_TAIL);
      o.rot = rand(-0.5, 0.5);
    } else {
      fx._col(ORANGE, dim, DARK, 1);
      o = fx._rec(b.x + rand(-0.08, 0.08), b.y + rand(-0.08, 0.08), b.z + rand(-0.08, 0.08), rand(0.22, 0.34), 0.34, 0.06, EMBER_TAIL);
      o.vy = rand(0.2, 0.9);
      o.flicker = 0.4;
    }
    o.vx = -b.vx * 0.12;
    o.vz = -b.vz * 0.12;
    o.drag = 2;
    fx._spawn(fx.add, o);
  }
}

function sparks(fx, x, y, z, n, c0, c1, speed, size, glyph, up = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(0.35, 1) * speed;
    fx._col(c0, 1, c1, 1);
    const o = fx._rec(x, y, z, rand(0.2, 0.42), rand(0.6, 1) * size, 0.05, glyph);
    o.vx = Math.cos(a) * sp;
    o.vy = rand(-1, up);
    o.vz = Math.sin(a) * sp;
    o.drag = 3;
    o.gravity = 6;
    o.stretch = 0.25;
    fx._spawn(fx.add, o);
  }
}

const coreCol = (kind) => (kind === 2 ? RED : kind === 1 ? WISP : GOLD);
const endCol = (kind) => (kind === 2 ? DARK : kind === 1 ? WISP_END : DARK);

/**
 * A perfectly parried bullet on its way back (ADR-047): a white-gold core `size` x a bullet's, a
 * gold halo turning, a long orange trail. Reads apart from the plain deflect (the bullet's own look).
 */
export function drawReturned(fx, b, dt, size = 1.8) {
  const life = fx._hold(b, 'hold', dt);
  const s = b.kind === 1 ? 1.1 * size : size;
  if (life > 0) {
    fx._col(WHITE, 1.25, WHITE, 1.25);
    let o = fx._rec(b.x, b.y, b.z, life, 0.62 * s, 0.62 * s, EMBER_CORE);
    o.alphaEnd = 1;
    o.rot = b.t * 9 + b.seed;
    fx._spawn(fx.add, o);
    fx._col(GOLD, 0.7, GOLD, 0.7);
    o = fx._rec(b.x, b.y, b.z, life, 1.0 * s, 1.0 * s, RETURN_HALO);
    o.alphaEnd = 1;
    o.rot = -b.t * 6 + b.seed;
    fx._spawn(fx.add, o);
  }
  b.acc += dt * 34;
  while (b.acc >= 1) {
    b.acc -= 1;
    fx._col(ORANGE, 1.1, DARK, 1);
    const o = fx._rec(b.x + rand(-0.12, 0.12), b.y + rand(-0.12, 0.12), b.z + rand(-0.12, 0.12), rand(0.28, 0.45), 0.5, 0.08, EMBER_TAIL);
    o.vx = -b.vx * 0.08;
    o.vz = -b.vz * 0.08;
    o.vy = rand(0, 0.8);
    o.drag = 2;
    o.flicker = 0.3;
    fx._spawn(fx.add, o);
  }
}

/** The shot leaving the blade: a gold flare on top of the deflect clash. */
export function returnLaunch(fx, x, y, z) {
  if (!Number.isFinite(x + y + z)) return;
  fx._col(HOT, 1.2, GOLD, 0.4);
  const o = fx._rec(x, y, z, 0.18, 1.6, 0.4, GLINT_STAR);
  o.rot = rand(0, 1.5);
  fx._spawn(fx.add, o);
  sparks(fx, x, y, z, 10, GOLD, DARK, 8, 0.4, SPARKS, 4);
}

/** A returned shot bursting on the wyrm's head: a white-gold star, a ring of fire sparks, a warm light. */
export function returnBurst(fx, x, y, z, kind) {
  if (!Number.isFinite(x + y + z)) return;
  const k = kind === 1 ? 1.3 : 1;
  fx._col(WHITE, 1.4, GOLD, 0.5);
  let o = fx._rec(x, y, z, 0.24, 2.6 * k, 0.6, GLINT_STAR);
  fx._spawn(fx.add, o);
  fx._col(GOLD, 0.9, ORANGE, 0.4);
  o = fx._rec(x, y, z, 0.2, 1.2, 3.2 * k, RETURN_HALO);
  fx._spawn(fx.add, o);
  sparks(fx, x, y, z, Math.round(18 * k), GOLD, DARK, 11, 0.5, SPARKS, 5);
  sparks(fx, x, y, z, Math.round(10 * k), ORANGE, DARK, 6, 0.6, EMBER_TAIL, 3);
  fx._light({ x, y, z, color: FIRE_LIGHT, intensity: 6 * k, radius: 10, life: 0.3, fade: 0.25 });
}

/** A bullet bursting on the hero / his guard / the wyrm's head. */
export function burst(fx, x, y, z, kind) {
  if (!Number.isFinite(x + y + z)) return;
  const c = coreCol(kind);
  fx._col(c, 1.4, c, 0.5);
  const o = fx._rec(x, y, z, 0.2, kind === 2 ? 2.2 : 1.3, 0.3, GLINT_STAR);
  fx._spawn(fx.add, o);
  sparks(fx, x, y, z, kind === 2 ? 16 : 9, c, endCol(kind), kind === 2 ? 9 : 6.5, 0.42, SPARKS, 4);
}

/** A bullet dying on its own (out of time, a dud, popped by a clash nearby): a few motes. */
export function fizzle(fx, x, y, z, kind) {
  if (!Number.isFinite(x + y + z)) return;
  sparks(fx, x, y, z, 4, coreCol(kind), endCol(kind), 2.5, 0.3, EMBER_TAIL, 2);
}

/** The clash of a deflected bullet: a blue-white star on the blade, crossed sparks, a cold light. */
export function deflectSpark(fx, x, y, z, kind) {
  if (!Number.isFinite(x + y + z)) return;
  // compact and not overbright: the hero's own parry burst (player/fx.js) lands on the same spot,
  // and big additive glyphs on top of it clip to one white blob that hides the deflect
  fx._col(MOON, 0.9, MOON_END, 1);
  let o = fx._rec(x, y, z, 0.16, kind === 1 ? 1.0 : 0.8, 0.3, GLINT_STAR);
  fx._spawn(fx.add, o);
  fx._col(MOON, 0.55, MOON_END, 0.8);
  o = fx._rec(x, y, z, 0.16, 1.0, 1.9, GLINT_PLUS);
  o.rot = rand(0, 1.5);
  fx._spawn(fx.add, o);
  sparks(fx, x, y, z, kind === 1 ? 16 : 11, MOON, MOON_END, 10, 0.4, CLASH, 5);
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU, sp = rand(9, 15);
    fx._col(WHITE, 1, MOON_END, 1);
    o = fx._rec(x, y, z, rand(0.12, 0.2), 0.5, 0.1, STREAK);
    o.vx = Math.cos(a) * sp;
    o.vy = rand(-1, 4);
    o.vz = Math.sin(a) * sp;
    o.rot = fx._screenRot(o.vx, o.vy, o.vz);
    o.stretch = 0.6;
    o.drag = 4;
    fx._spawn(fx.add, o);
  }
  fx._light({ x, y: Math.max(0.8, y), z, color: CLASH_LIGHT, intensity: kind === 1 ? 5 : 3.5, radius: 6.5, life: 0.2, fade: 0.16 });
}

/** A bullet cut out of the air by a swing. */
export function cutSpark(fx, x, y, z, kind) {
  if (!Number.isFinite(x + y + z)) return;
  const c = coreCol(kind);
  fx._col(c, 1.1, c, 0.4);
  const o = fx._rec(x, y, z, 0.16, 0.85, 0.2, 'x');
  fx._spawn(fx.add, o);
  sparks(fx, x, y, z, 6, c, endCol(kind), 6, 0.36, SPARKS, 3);
}

/** The timing glint of a bullet about to hit (its combat:flash): a sharp cross on the bullet. */
export function cueGlint(fx, x, y, z, tell) {
  if (!Number.isFinite(x + y + z)) return;
  const red = tell === 'red';
  const c = red ? RED : tell === 'blue' ? MOON : WHITE;
  fx._col(c, red ? 1.5 : 1.3, c, 0.4);
  let o = fx._rec(x, y, z, 0.2, red ? 2.4 : 1.7, 0.3, red ? WARN_MARK : GLINT_PLUS);
  fx._spawn(fx.add, o);
  fx._col(c, 1, c, 0.3);
  o = fx._rec(x, y, z, 0.16, 0.6, red ? 2.6 : 2.0, GLINT_STAR);
  o.rot = 0.6;
  fx._spawn(fx.add, o);
}

/** A puff of fire where a volley leaves (the wing's downbeat, the maw). */
export function muzzle(fx, x, y, z, dx, dz, n = 8, blue = false) {
  if (!Number.isFinite(x + y + z + dx + dz)) return;
  for (let i = 0; i < n; i++) {
    fx._col(blue ? WISP : HOT, 1, blue ? WISP_END : DARK, 1);
    const o = fx._rec(x + rand(-0.4, 0.4), y + rand(-0.3, 0.3), z + rand(-0.4, 0.4), rand(0.25, 0.5), rand(0.5, 0.9), 0.1, PUFF);
    const sp = rand(2, 7);
    o.vx = dx * sp + rand(-1.5, 1.5);
    o.vy = rand(-0.5, 2.5);
    o.vz = dz * sp + rand(-1.5, 1.5);
    o.drag = 2.5;
    o.flicker = 0.3;
    fx._spawn(fx.add, o);
  }
}

// ---------------------------------------------------------------- fire wheel
/** The warning: the ground heats up along the lines where the spokes will ignite (k 0..1, ADR-048). */
export function wheelWarn(fx, w, dt, k) {
  const life = fx._hold(w, 'hold', dt);
  const hot = w.warn <= TUNING.flashLead;
  for (let i = 0; i < w.n; i++) {
    const a = w.ang + (i * TAU) / w.n;
    // (one scorch stamp budget per spoke would be n x the rate: only spoke 0 stamps, the rest glow)
    fx.heatBand(life, w, dt, w.x, w.z, Math.sin(a), Math.cos(a), w.r0, w.r1, w.width / 2 + 0.2, k, hot, 7.3 + i * 3.1, -1, w.r1, i === 0);
  }
}

/** Ignition: every spoke flares up at once, a shock ring runs out from the body. */
export function wheelIgnite(fx, w) {
  for (let i = 0; i < w.n; i++) {
    const a = w.ang + (i * TAU) / w.n;
    const sx = Math.sin(a), sz = Math.cos(a);
    for (let r = w.r0; r <= w.r1; r += 0.9) {
      fx._col(GOLD, 0.9, ORANGE, 0.5);
      const o = fx._rec(w.x + sx * r, 0.3, w.z + sz * r, rand(0.35, 0.6), rand(0.8, 1.3), 0.2, FLAME_TALL);
      o.vy = rand(4, 9);
      o.drag = 2;
      o.flicker = 0.3;
      fx._spawn(fx.add, o);
    }
  }
  fx.shockRing(w.x, w.z, w.r0 + 5);
  fx._light({ x: w.x, y: 2, z: w.z, color: FIRE_LIGHT, intensity: 7, radius: 22, life: 0.5, fade: 0.4 });
}

/** The burning spokes: a gold core line under tall flames that lean back against the turn.
 *  Additive glyphs overlap along a spoke, so each one is kept dim and warm: the sum reads as a
 *  yellow heart in an orange skin (bright ones clip to a row of white blobs). */
export function wheelLive(fx, w, dt, omega, hx, hz) {
  const life = fx._hold(w, 'hold', dt);
  const span = w.r1 - w.r0;
  const fade = w.fade;
  if (life > 0) {
    const step = 0.9, n = Math.floor(span / step);
    for (let i = 0; i < w.n; i++) {
      const a = w.ang + (i * TAU) / w.n;
      const sx = Math.sin(a), sz = Math.cos(a);
      for (let j = 0; j <= n; j++) {
        const r = w.r0 + j * step + ((w.t * 6) % step);
        if (r > w.r1) continue;
        fx._col(GOLD, 0.5 * fade, GOLD, 0.5 * fade);
        const o = fx._rec(w.x + sx * r, 0.5, w.z + sz * r, life, 0.55, 0.55, BEAM_CORE);
        o.alphaEnd = 1;
        fx._spawn(fx.add, o);
      }
    }
  }
  w.acc += dt * 240 * w.n * fade;
  while (w.acc >= 1) {
    w.acc -= 1;
    const a = w.ang + (((Math.random() * w.n) | 0) * TAU) / w.n;
    const sx = Math.sin(a), sz = Math.cos(a);
    const r = w.r0 + Math.random() * span;
    const hot = Math.random() < 0.3;
    fx._col(hot ? GOLD : ORANGE, hot ? 0.75 : 0.7, DARK, hot ? 1.6 : 1);
    const o = fx._rec(w.x + sx * r + rand(-0.25, 0.25), rand(0.15, 0.7), w.z + sz * r + rand(-0.25, 0.25), rand(0.35, 0.7), rand(0.7, 1.25), 0.2, FLAME_TALL);
    // tangent of +angle is (cos, -sin): the flames trail behind the turning spoke
    const lag = -omega * r * 0.35;
    o.vx = sz * lag + rand(-0.4, 0.4);
    o.vy = rand(2.6, 7);
    o.vz = -sx * lag + rand(-0.4, 0.4);
    o.drag = 1.5;
    o.flicker = 0.35;
    fx._spawn(fx.add, o);
  }
  // sparse scorch + one moving light on the spoke nearest the hero
  w.scorchT -= dt;
  if (w.scorchT <= 0) {
    w.scorchT = 0.09;
    const sc = fx.game.world?.scorch;
    for (let i = 0; i < w.n; i++) {
      const a = w.ang + (i * TAU) / w.n;
      const r = w.r0 + Math.random() * span;
      sc?.burnCircle?.(w.x + Math.sin(a) * r, w.z + Math.cos(a) * r, w.width * 0.9, 0.2, 0.9);
    }
  }
  w.lightT -= dt;
  if (w.lightT <= 0 && Number.isFinite(hx + hz)) {
    w.lightT = 0.12;
    const dx = hx - w.x, dz = hz - w.z;
    const r = Math.min(w.r1, Math.max(w.r0, Math.hypot(dx, dz)));
    const th = Math.atan2(dx, dz);
    const seg = TAU / w.n;
    const a = w.ang + Math.round((th - w.ang) / seg) * seg;
    fx._light({ x: w.x + Math.sin(a) * r, y: 1.2, z: w.z + Math.cos(a) * r, color: FIRE_LIGHT, intensity: 3.2 * fade, radius: 8, life: 0.2, fade: 0.14 });
  }
}
