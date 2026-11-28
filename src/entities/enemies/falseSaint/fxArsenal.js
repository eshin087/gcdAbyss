import { K_FIRE, K_SMOKE, K_VOID, K_STEEL, GROUND_Y, GROUND_GAIN } from '../duelist/fx.js';
import { TELL } from '../../../combat/rules.js';
import { lookOf } from '../duelist/lookSwitch.js';

// The False Saint's arsenal, drawn (the FX AGENT's file): the lasers, the palm and core cannons, the forearm
// gun's bolts, the missiles, the mortar's shells, the sky lance, and the pools behind them. FsFx (fx.js)
// forwards its surface here; `F` is the FsFx (DuelFx's _blob / _ink / _dot / _frame / _rec / _spawn /
// _toCamera / _axes / lr(), AscFx's beam / _keep / _across). Heat in the fire field (STYLE.md "The fire
// field"): the void slot is HIS palette here (FIRE_PALETTES.saint: incandescent, a dark amber rim, a pale
// amber-white body, a white heart: jet exhaust and white-hot metal), `fire` is molten steel, burning and every
// RED cue (the marks, the sight line, the locked reticle), `steel` the white-hot cores and sparks' strokes.
// NOTHING here that signals an attack is cyan or blue (blue means "parry" in this game; the owner's v04 pack):
// cyan is his sensors' and his shell's sparks' alone (fx.js), cosmetic.
// Glyph particles only for what flies on its own, one letter cell: sparks, casings, grit, plate
// chips. Jitter from F.lr() (the looks' stream), never Math.random.
//
// TWO LAYERS, both open to the arsenal agent:
//   (1) THE DRAWINGS, stateless: the caller owns the thing and calls them (every frame for the held
//       ones, once for the others; fx.js's header has the list). Sounds are played from here: a held
//       thing's sound starts on its first frame (a call after a gap of 0.25 s is a new one).
//   (2) THE FLIGHTS (`F.fly(o)`): a fixed pool of 32 projectiles this file flies AND draws (a missile's
//       arc, a mortar shell's climb and fall, a bolt's line), each with its arrival time on the boss's
//       clock, its ledger handle (brain.expect: the fairness guard sees it from the launch) and the
//       caller's callbacks. The caller deals the damage and breaks the world in `onLand`; this file only
//       draws (and, unless `burst: false`, draws the landing: blast / shellBurst / boltHit). See fly().
//
// POOLS (fixed, nothing allocated per frame): flights 32 (12 missiles + a barrage row of 10 + the great
// shell + 3 bolts + a returned one, with room), scars 12 (laser scars, trenches; their glow is long-lived
// blobs spawned once, the pool only keeps their smoke and embers going), the `fresh` table 32 (which
// stateless calls are new things: their sounds).

const TAU = Math.PI * 2;
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
// glyph colours (linear; the additive pool for what burns, the alpha pool for what is matter)
const WHITE = [3.3, 3.3, 3.1], WHITE_END = [0.6, 0.55, 0.5];
const HOT = [3.4, 2.1, 0.8], HOT_END = [0.6, 0.1, 0.02];
const RED = [3.2, 0.35, 0.2], RED_END = [0.7, 0.04, 0.02];
const BRASS = [1.5, 1.15, 0.5], BRASS_END = [0.35, 0.25, 0.1];
const PLATE = [0.52, 0.52, 0.55], PLATE_END = [0.16, 0.16, 0.17];
const DIRT = [0.32, 0.29, 0.26], DIRT_END = [0.12, 0.11, 0.1];
const SMOKE_G = [0.34, 0.33, 0.32], SMOKE_END = [0.1, 0.1, 0.1];
// lights
/** The warm white light of his jets, beams and guns (his attacks: never cyan or blue, which mean a parry). */
export const L_HEAT = [1.0, 0.84, 0.6];
const L_WHITE = [1.0, 0.95, 0.88], L_FIRE = [1.0, 0.52, 0.18], L_RED = [1.0, 0.14, 0.06];

/** The look's numbers (data, not logic): sizes in metres, heats as the fire field reads them. */
export const FS_FX_ARSENAL = Object.freeze({
  sight: { heat: 0.34, blink: 9, dash: 0.55 }, // the sight line: its heat at k 1, its blink (Hz) in the last 0.2 of k, dash period m
  laser: { core: 1.12, sheath: 0.42, sparks: 60, smoke: 12, light: 2.6 },
  scar: { life: 6.5, step: 0.32, heat: 0.24, steel: 0.5, smoke: 6, embers: 9 }, // life s at k 1; heat per blob (x GROUND_GAIN)
  trench: { life: 9, rows: 2, heat: 0.22 },
  cannon: { lick: 70, foot: 1.2, light: 4.5 },
  mark: { step: 0.34, heat: 0.36, rise: 0.2, fill: 0.2, blink: 7, disc: [0.05, 0.09] }, // disc: the 'disc' style's fill heat at k 0 / added by k 1
  missile: { apex: 5, r: 1.3, trailStep: 0.28, speedMin: 8 },
  shell: { r: 1.6, top: 34, climb: 0.3 }, // top: the height it climbs out of view to; climb: share of the flight spent going up
  reticle: { r0: 2.4, r1: 1.15, column: 7 },
  lance: { top: 28 },
});
const A_ = FS_FX_ARSENAL;
/** The marks' look (`?fsMark=ring|disc`, read live): ring = a ring of red blobs and a ring closing in;
 *  disc = a dim red disc under the ring, the rim written on the letter grid. */
const markStyle = () => lookOf('fsMark', 'disc');

// ---------------------------------------------------------------- the pools
/** One projectile of the flights' pool (fly). Valid while `alive` and its `id` is the one you were given. */
class FsFlight {
  constructor() {
    this.alive = false;
    this.id = 0;
    this.kind = 'missile';
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.dx = this.dy = this.dz = 0; // (a bolt's direction, for fx.bolt)
    this.x0 = this.y0 = this.z0 = 0;
    this.tx = this.ty = this.tz = 0;
    this.t = 0;
    this.T = 1;
    this.at = 0;
    this.k = 0;
    this.apex = 5;
    this.r = 1.3;
    this.mark = true;
    this.markLead = 99;
    this.tell = TELL.RED;
    this.attack = '';
    this.power = 1;
    this.track = 0;
    this.trackSpeed = 6;
    this.burst = true;
    this.sound = true;
    this.back = false;
    this.cue = null;
    this.ownCue = false;
    this.cued = false;
    this.cueLead = 0;
    this.onLand = null;
    this.onCue = null;
    this.data = null;
    this._clock = null;
  }
  /** Seconds until it lands (NaN once it is gone). */
  get left() {
    return this.alive ? this.T - this.t : NaN;
  }
  /** It lands `s` s from now instead (its ledger handle follows). */
  retime(s) {
    if (!this.alive || !Number.isFinite(s)) return this;
    this.T = this.t + Math.max(0.05, s);
    if (this._clock) this.at = this._clock() + Math.max(0.05, s);
    if (this.ownCue) this.cue?.retime?.(Math.max(0.05, s));
    return this;
  }
  /** It will not land (cut out of the air, the move cut short): gone, its ledger handle cancelled. */
  cancel() {
    if (!this.alive) return this;
    this.alive = false;
    if (this.ownCue) this.cue?.cancel?.();
    this.cue = null;
    return this;
  }
}

export function createState() {
  return {
    flights: Array.from({ length: 32 }, () => new FsFlight()),
    scars: Array.from({ length: 12 }, () => ({ alive: false, ax: 0, az: 0, bx: 0, bz: 0, w: 1, t: 0, T: 1, acc: 0, eacc: 0, trench: false })),
    fresh: Array.from({ length: 32 }, () => ({ kind: '', x: 0, z: 0, t: -99 })),
    freshI: 0,
    held: new Map(), // key -> { t0, last, said } (a held sound's clock; a handful of fixed keys)
    nextId: 1,
    reticle: { locked: false, t: -99 },
    acc: { sight: 0, laserSpark: 0, laserSmoke: 0, beamLick: 0, beamSpark: 0, chargeMote: 0, pour: 0, lance: 0, trail: 0 },
    live: 0, // flights alive (the tests: pools never grow)
  };
}

export function resetState(F, S) {
  if (!S) return;
  for (const f of S.flights) f.cancel();
  for (const s of S.scars) s.alive = false;
  for (const e of S.fresh) e.t = -99;
  S.held.clear();
  S.reticle.locked = false;
  S.live = 0;
}

const now = (F) => {
  const g = F.game;
  return g.realTime ?? g.time ?? 0;
};

/** Is this a new thing (no call of `kind` within `r` m in the last 0.25 s)? The stateless held drawings'
 *  sounds start with it. Updates the table (a ring of 32). */
export function fresh(F, S, kind, x, z, r = 1.6) {
  const t = now(F);
  for (const e of S.fresh) {
    if (e.kind === kind && t - e.t < 0.25 && Math.abs(e.x - x) < r && Math.abs(e.z - z) < r) {
      e.t = t;
      e.x = x;
      e.z = z;
      return false;
    }
  }
  const e = S.fresh[S.freshI];
  S.freshI = (S.freshI + 1) % S.fresh.length;
  e.kind = kind;
  e.x = x;
  e.z = z;
  e.t = t;
  return true;
}

/** A held sound: `name` on the first frame of a held thing (keyed), again every `every` s while it holds. */
export function heldSay(F, S, key, name, x, z, every, dur) {
  const t = now(F);
  let h = S.held.get(key);
  if (!h) S.held.set(key, (h = { t0: -99, last: -99, said: -99 }));
  if (t - h.last > 0.25) {
    h.t0 = t;
    h.said = -99;
  }
  h.last = t;
  if (t - h.said >= every) {
    h.said = t;
    F._say(name, x, z, dur);
    return true;
  }
  return false;
}
/** How long (s) a held thing has been held (0 on its first frame). */
export const heldFor = (F, S, key) => {
  const h = S.held.get(key);
  return h ? Math.max(0, now(F) - h.t0) : 0;
};

// ---------------------------------------------------------------- THE LASERS
/**
 * The sight line before a cut (k 0..1 to the fire; every frame). (ax, az) → (bx, bz) the line on the
 * floor the cut will draw (a == b: one spot); `fromEye` (default true): a thin line from his eye to b too.
 * Thin PALE WHITE strokes on the letter grid (steel: crisp, it does not climb as the fire kind would off a
 * line in the air) with a small RED cross where it will cut (the fire kind at a low heat, as every dodge
 * cue); never cyan or blue, which mean a parry. Dashed and faint early, solid and brighter late, blinking in
 * the last fifth. ~2 lines of ink cells.
 */
export function sightLine(F, S, ax, az, bx, bz, k, fromEye = true) {
  if (!F.fire || !Number.isFinite(ax + az + bx + bz + k)) return;
  k = clamp01(k);
  const Q = A_.sight, t = now(F);
  const blink = k > 0.8 ? (Math.sin(t * Q.blink * TAU) > -0.2 ? 1 : 0.45) : 1;
  const h = (0.45 + Q.heat * k) * blink, y = 0.42;
  const L = Math.hypot(bx - ax, bz - az);
  if (L > 0.3) {
    if (k < 0.55) {
      // dashed: pieces of Q.dash m with gaps, running toward b
      const n = Math.min(40, Math.ceil(L / Q.dash)), ph = (t * 3) % 1;
      for (let i = 0; i < n; i += 2) {
        const u0 = Math.min(1, (i + ph) / n), u1 = Math.min(1, (i + ph + 1) / n);
        F._ink(ax + (bx - ax) * u0, y, az + (bz - az) * u0, ax + (bx - ax) * u1, y, az + (bz - az) * u1, 0, h, 0, h, 0, K_STEEL);
      }
    } else F._ink(ax, y, az, bx, y, bz, 0, h, 0, h, 0, K_STEEL);
  }
  if (fromEye && F.d?.eyePoint) {
    const E = F.d.eyePoint(F._eyeV);
    if (E && Number.isFinite(E.x + E.y + E.z)) F._ink(E.x, E.y, E.z, bx, y, bz, 0, h * 0.8, 0, h, 0, K_STEEL);
  }
  // the spot it picks: a small red cross
  const c = 0.28 + 0.2 * k;
  const hc = (0.42 + 0.2 * k) * blink;
  F._ink(bx - c, y, bz, bx + c, y, bz, 0, hc, 0, hc, 0, K_FIRE);
  F._ink(bx, y, bz - c, bx, y, bz + c, 0, hc, 0, hc, 0, K_FIRE);
  if (fresh(F, S, 'sight', bx, bz, 30)) F._say('fsSight', bx, bz, 0);
}

/**
 * The line a jet pass will run along the floor, a → b (every frame; k 0..1 its strength: faint and dashed
 * while it still follows the hero, solid and brighter once it is fixed, blinking at the very end). His
 * flight lines (Vespers' passes, Passing Bell's strafe) are shown so: a crisp PALE WHITE stroke on the
 * letter grid (steel) with a row of low HEAT either side of it (the fire kind at a low heat: dull orange
 * letters lying on the plates) and a small heat chevron at b pointing the way he will go. Never cyan or
 * blue (blue means a parry). The arsenal agent's (wave 2); ~2 - 3 ink lines and up to 24 blobs a frame.
 */
export function passLine(F, S, ax, az, bx, bz, k) {
  if (!F.fire || !Number.isFinite(ax + az + bx + bz + k)) return;
  k = clamp01(k);
  const L = Math.hypot(bx - ax, bz - az);
  if (!(L > 0.3)) return;
  const t = now(F), Q = A_.sight;
  const blink = k > 0.92 ? (Math.sin(t * Q.blink * TAU) > -0.2 ? 1 : 0.55) : 1;
  const ux = (bx - ax) / L, uz = (bz - az) / L, y = 0.42;
  const h = (0.36 + 0.36 * k) * blink;
  if (k < 0.5) {
    // dashed: pieces running toward b
    const n = Math.min(48, Math.ceil(L / Q.dash)), ph = (t * 2.5) % 1;
    for (let i = 0; i < n; i += 2) {
      const u0 = Math.min(1, (i + ph) / n), u1 = Math.min(1, (i + ph + 1) / n);
      F._ink(ax + (bx - ax) * u0, y, az + (bz - az) * u0, ax + (bx - ax) * u1, y, az + (bz - az) * u1, 0, h, 0, h, 0, K_STEEL);
    }
  } else F._ink(ax, y, az, bx, y, bz, 0, h, 0, h, 0, K_STEEL);
  const life = F._frame();
  if (life > 0) {
    // the heat either side of it, low (it lies on the plates), a little brighter as it is fixed
    const n = Math.min(10, Math.max(3, Math.round(L / 2))), hh = (0.05 + 0.08 * k) * GROUND_GAIN * blink;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
      for (const sd of [-1, 1]) F._blob(x - uz * 0.32 * sd, GROUND_Y, z + ux * 0.32 * sd, 0, 0, 0, life, 0.3, 0.3, hh, hh, K_FIRE);
    }
    // the chevron at its end: the way he goes
    const c = 0.55, hc = (0.32 + 0.2 * k) * GROUND_GAIN * blink;
    for (const sd of [-1, 1]) F._ink(bx, GROUND_Y, bz, bx - ux * c - uz * c * sd, GROUND_Y, bz - uz * c + ux * c * sd, 0, hc, 0, hc, 0, K_FIRE);
  }
}

/** The white-hot cutting line, his eye (a) → where it meets the floor (b), k its strength (every frame).
 *  A white core, a fainter steel stroke either side, the foot molten (fire), sparks spat back, smoke. */
export function laser(F, S, ax, ay, az, bx, by, bz, k) {
  if (!F.fire || !Number.isFinite(ax + ay + az + bx + by + bz + k) || !(k > 0.01)) return;
  k = clamp01(k);
  const Q = A_.laser, dt = Math.max(0, fin(F.game.fxDt, F.game.dt ?? 0.016));
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  if (!(L > 0.05)) return;
  const C = F._across(dx, dy, dz), t = now(F);
  const fl = 0.88 + 0.12 * Math.sin(t * 53) * Math.sin(t * 17);
  F._ink(ax, ay, az, bx, by, bz, 0, Q.core * fl * (0.6 + 0.4 * k), 0, Q.core * fl * (0.6 + 0.4 * k), 0, k > 0.6 ? K_STEEL : K_FIRE);
  const off = 0.07;
  for (const sd of [-1, 1]) F._ink(ax + C.x * off * sd * 0.4, ay + C.y * off * sd * 0.4, az + C.z * off * sd * 0.4, bx + C.x * off * sd, by + C.y * off * sd, bz + C.z * off * sd, 0, Q.sheath * fl * k, 0, Q.sheath * fl * k, 0, K_STEEL);
  const life = F._frame();
  const fy = Math.max(0.12, Math.min(by, 0.5));
  if (life > 0) {
    // the foot: a molten spot, a white heart
    for (let i = 0; i < 10; i++) {
      const a = i * 2.39996, r = 0.42 * Math.sqrt((i + 0.5) / 10);
      F._blob(bx + Math.cos(a) * r, fy, bz + Math.sin(a) * r, 0, 0, 0, life, 0.3, 0.3, (0.5 + 0.25 * F.lr()) * k, 0, K_FIRE);
    }
    F._blob(bx, fy + 0.05, bz, 0, 0, 0, life, 0.2, 0.2, 1.25 * k, 0, K_STEEL);
  }
  // sparks spat back along it and up; smoke
  const ux = dx / L, uz = dz / L;
  S.acc.laserSpark += dt * Q.sparks * k;
  while (S.acc.laserSpark >= 1) {
    S.acc.laserSpark -= 1;
    const a = Math.atan2(-uz, -ux) + F.lrand(-1.2, 1.2), sp = F.lrand(3, 8);
    const o = F._rec(bx, fy + 0.1, bz, F.lrand(0.2, 0.45), 0.1, 0.03, "*+'", F.lr() < 0.3 ? WHITE : HOT, HOT_END);
    o.vx = Math.cos(a) * sp;
    o.vz = Math.sin(a) * sp;
    o.vy = F.lrand(2, 6);
    o.gravity = -14;
    o.drag = 1.2;
    F._spawn(F.add, o);
  }
  S.acc.laserSmoke += dt * Q.smoke * k;
  while (S.acc.laserSmoke >= 1) {
    S.acc.laserSmoke -= 1;
    F._blob(bx + F.lrand(-0.3, 0.3), 0.8, bz + F.lrand(-0.3, 0.3), F.lrand(-0.2, 0.2), F.lrand(0.7, 1.4), F.lrand(-0.2, 0.2), F.lrand(0.7, 1.1), 0.4, 0.9, 0.45, 0, K_SMOKE, 0.6);
  }
  F._keep('fsLaserFoot', bx, fy + 0.4, bz, L_WHITE, Q.light * k, 4.5, 0.3);
  heldSay(F, S, 'laser', 'fsLaser', bx, bz, 0.9, 1.0);
}

/** One long-lived line of heat on the floor, a → b (spawned ONCE: the field's own fade cools it):
 *  `rows` across w, `life` s, heat per blob; a short white-hot steel core first. */
function hotLine(F, ax, az, bx, bz, w, life, heat, rows, steel) {
  const L = Math.hypot(bx - ax, bz - az), Q = A_.scar;
  if (!(L > 0.05) || !(life > 0)) return 0;
  const ux = (bx - ax) / L, uz = (bz - az) / L, n = Math.min(120, Math.max(1, Math.ceil(L / Q.step)));
  // (the fire kind climbs as tongues by its heat: the long glow is kept LOW, so it lies on the plates as a
  // line of dull red-orange letters and does not stand up as a wall of flame; the white-hot is a short steel
  // core and a short hot fire line over it, the long cooling glow the scorch map's heat in the floor)
  const sc = F.d?.game?.world?.scorch;
  let spent = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
    for (let r = 0; r < rows; r++) {
      const off = rows > 1 ? (r / (rows - 1) - 0.5) * w * 0.8 : 0, j = F.lr();
      const s = Math.max(0.3, (w / rows) * 1.1);
      F._blob(x - uz * off, GROUND_Y, z + ux * off, 0, 0, 0, life * (0.8 + 0.4 * j), s, s * 0.7, heat * GROUND_GAIN * (0.85 + 0.3 * j), 0, K_FIRE);
      spent++;
    }
    if (steel > 0 && i % 2 === 0) {
      F._blob(x, GROUND_Y + 0.05, z, 0, 0, 0, 0.45 + 0.3 * F.lr(), 0.3, 0.2, steel * GROUND_GAIN, 0, K_STEEL);
      F._blob(x, GROUND_Y, z, 0, 0, 0, 0.35 + 0.2 * F.lr(), 0.3, 0.2, 0.3 * GROUND_GAIN, 0, K_FIRE);
      spent += 2;
    }
    if (sc?.burnCircle && i % 2 === 0) sc.burnCircle(x, z, Math.max(0.35, w * 0.6), 0.35, 0.9);
  }
  return spent;
}

/** A hot scar left along a line (once): white for a moment, then orange, red, dark; smoke and embers off
 *  it while it cools. `w` m wide, `k` its strength (its life and heat). ~2 blobs per 0.32 m, once. */
export function scar(F, S, ax, az, bx, bz, w, k = 1) {
  if (!F.fire || !Number.isFinite(ax + az + bx + bz + w + k)) return 0;
  k = Math.max(0.2, Math.min(1.5, k));
  w = Math.max(0.2, Math.min(4, w));
  const Q = A_.scar, life = Q.life * k;
  const spent = hotLine(F, ax, az, bx, bz, w, life, Q.heat * Math.min(1.2, k), w > 1.2 ? 2 : 1, Q.steel * k);
  keepScar(S, ax, az, bx, bz, w, life, false);
  return spent;
}

function keepScar(S, ax, az, bx, bz, w, T, trench) {
  let s = S.scars.find((x) => !x.alive);
  if (!s) {
    s = S.scars[0];
    for (const x of S.scars) if (x.t / x.T > s.t / s.T) s = x;
  }
  s.alive = true;
  s.ax = ax;
  s.az = az;
  s.bx = bx;
  s.bz = bz;
  s.w = w;
  s.t = 0;
  s.T = T;
  s.acc = 0;
  s.eacc = 0;
  s.trench = trench;
}

/** The scars' smoke and embers while they cool (every frame from update). */
function updateScars(F, S, dt) {
  const Q = A_.scar;
  for (const s of S.scars) {
    if (!s.alive) continue;
    s.t += dt;
    if (s.t >= s.T) {
      s.alive = false;
      continue;
    }
    const cool = 1 - s.t / s.T, L = Math.hypot(s.bx - s.ax, s.bz - s.az), m = Math.min(3, L / 6) * (s.trench ? 1.6 : 1);
    s.acc += dt * Q.smoke * m * cool;
    while (s.acc >= 1) {
      s.acc -= 1;
      const u = F.lr(), x = s.ax + (s.bx - s.ax) * u, z = s.az + (s.bz - s.az) * u;
      F._blob(x + F.lrand(-0.2, 0.2) * s.w, 0.8, z + F.lrand(-0.2, 0.2) * s.w, F.lrand(-0.15, 0.15), F.lrand(0.5, 1.1), F.lrand(-0.15, 0.15), F.lrand(0.8, 1.5), 0.35, 0.9, 0.36 * cool + 0.1, 0, K_SMOKE, 0.5);
    }
    s.eacc += dt * Q.embers * m * cool * cool;
    while (s.eacc >= 1) {
      s.eacc -= 1;
      const u = F.lr(), x = s.ax + (s.bx - s.ax) * u, z = s.az + (s.bz - s.az) * u;
      const o = F._rec(x + F.lrand(-0.3, 0.3) * s.w, 0.15, z + F.lrand(-0.3, 0.3) * s.w, F.lrand(0.5, 1.1), 0.12, 0.04, ".'`*", HOT, HOT_END);
      o.vx = F.lrand(-0.3, 0.3);
      o.vy = F.lrand(0.5, 1.6);
      o.vz = F.lrand(-0.3, 0.3);
      o.drag = 0.8;
      o.flicker = 0.5;
      F._spawn(F.add, o);
    }
  }
}

// ---------------------------------------------------------------- THE CANNONS
/** A cannon's charge at `part` ('palmR' | 'palmL' | 'core'), k 0..1 (every frame): motes of his heat drawn in,
 *  an iris of light tightening, a white heart growing; the level's light dims (ambience.dim). */
export function cannonCharge(F, S, part, k) {
  const d = F.d;
  if (!F.fire || !d?.partPoint || !Number.isFinite(k)) return;
  k = clamp01(k);
  const P = d.partPoint(part === 'core' ? 'core' : part === 'palmL' ? 'palmL' : 'palmR', F._partV);
  if (!P || !Number.isFinite(P.x + P.y + P.z)) return;
  const x = P.x, y = P.y, z = P.z, big = part === 'core' ? 1.6 : 1;
  const dt = Math.max(0, fin(F.game.fxDt, F.game.dt ?? 0.016)), t = now(F);
  // motes from a sphere round it, arriving as they die
  S.acc.chargeMote += dt * (30 + 60 * k) * big;
  while (S.acc.chargeMote >= 1) {
    S.acc.chargeMote -= 1;
    const a = F.lr() * TAU, e = F.lrand(-0.7, 0.9), r = F.lrand(0.9, 1.7) * big, life = F.lrand(0.22, 0.36);
    const ox = Math.cos(a) * Math.cos(e) * r, oy = Math.sin(e) * r, oz = Math.sin(a) * Math.cos(e) * r;
    F._blob(x + ox, y + oy, z + oz, -ox / life, -oy / life, -oz / life, life, 0.14, 0.05, 0.55, 0.9, K_VOID);
  }
  const life = F._frame();
  if (life > 0) {
    // the iris: a ring in the camera's plane closing, turning
    const A = F._axes(), Pc = F._toCamera(x, y, z), R = (0.55 - 0.38 * k) * big;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * (2 + 6 * k), ca = Math.cos(a) * R, sa = Math.sin(a) * R;
      const h = (0.35 + 0.55 * k) * (0.7 + 0.3 * Math.max(0, Math.cos(a * 3 - t * 9)));
      F._blob(Pc.x + A.rx * ca + A.ux * sa, Pc.y + A.ry * ca + A.uy * sa, Pc.z + A.rz * ca + A.uz * sa, 0, 0, 0, life, 0.14, 0.14, h, h, K_VOID);
    }
    const hh = 0.4 + 0.95 * k;
    F._blob(Pc.x, Pc.y, Pc.z, 0, 0, 0, life, (0.12 + 0.2 * k) * big, (0.12 + 0.2 * k) * big, hh, hh, k > 0.6 ? K_STEEL : K_VOID);
  }
  const key = part === 'core' ? 'chargeCore' : part === 'palmL' ? 'chargePalmL' : 'chargePalmR';
  F._keep(key, x, y, z, L_HEAT, 0.6 + 2.4 * k, 3 + 3 * k, 0.15);
  F.game.world?.forest?.ambience?.dim?.(k * (part === 'core' ? 0.9 : 0.6));
  heldSay(F, S, key, 'fsCharge', x, z, 99, part === 'core' ? 2 : 1.2);
}

/** The incinerating beam held (every frame): a → b, `w` m wide (1.2 the palm, 3.2 the core), k 0..1.
 *  AscFx's beam (a white core on the grid, the body in his palette, its edge boiling) with fire licking
 *  off its edges and the floor at its foot molten. Its body's heat is held down so the hero and the
 *  cues still read through it. */
export function cannonBeam(F, S, ax, ay, az, bx, by, bz, w, k) {
  if (!F.fire || !Number.isFinite(ax + ay + az + bx + by + bz + w + k) || !(k > 0.01)) return;
  k = clamp01(k);
  w = Math.max(0.4, Math.min(4.5, w));
  const dt = Math.max(0, fin(F.game.fxDt, F.game.dt ?? 0.016)), Q = A_.cannon;
  // (a wide beam is drawn a little cooler: the core beam of Revelation must not bury the hero)
  const kb = k * (w > 2.4 ? 0.78 : 1);
  F.beam(ax, ay, az, bx, by, bz, w, kb, dt, 2);
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  if (!(L > 0.3)) return;
  const ux = dx / L, uy = dy / L, uz = dz / L, C = F._across(dx, dy, dz);
  // fire licking off its edges: the incineration
  S.acc.beamLick += dt * Q.lick * (L / 14) * k * Math.min(2, w);
  while (S.acc.beamLick >= 1) {
    S.acc.beamLick -= 1;
    const s = F.lr() * L, sd = F.lr() < 0.5 ? -1 : 1, hf = 0.42 * w;
    F._blob(ax + ux * s + C.x * sd * hf, ay + uy * s + C.y * sd * hf, az + uz * s + C.z * sd * hf, C.x * sd * F.lrand(0.8, 2) + ux * F.lrand(1, 4), F.lrand(0.6, 2), C.z * sd * F.lrand(0.8, 2) + uz * F.lrand(1, 4), F.lrand(0.18, 0.32), 0.4, 0.25, 0.42 * k, 0, K_FIRE, 2, 1.2);
  }
  // the foot: molten floor, sparks, smoke
  const fy = Math.max(0.12, Math.min(by, 0.6)), life = F._frame();
  if (life > 0) {
    const R = Q.foot * Math.min(1.6, w / 1.2);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996, r = R * Math.sqrt((i + 0.5) / 14);
      F._blob(bx + Math.cos(a) * r, fy, bz + Math.sin(a) * r, 0, 0, 0, life, 0.45, 0.45, (0.55 + 0.3 * F.lr()) * k, 0, K_FIRE);
    }
  }
  S.acc.beamSpark += dt * 45 * k;
  while (S.acc.beamSpark >= 1) {
    S.acc.beamSpark -= 1;
    const a = F.lr() * TAU, sp = F.lrand(3, 9);
    const o = F._rec(bx, fy + 0.15, bz, F.lrand(0.25, 0.5), 0.11, 0.03, "*+'", F.lr() < 0.3 ? WHITE : HOT, HOT_END);
    o.vx = Math.cos(a) * sp;
    o.vz = Math.sin(a) * sp;
    o.vy = F.lrand(2.5, 7);
    o.gravity = -14;
    o.drag = 1;
    F._spawn(F.add, o);
  }
  F._keep('fsBeamFoot', bx, fy + 0.5, bz, L_FIRE, Q.light * k, 6, 0.35);
  F._keep('fsBeamMouth', ax, ay, az, L_HEAT, 2.5 * k, 5, 0.2);
  if (w > 2.4) heldSay(F, S, 'beamCore', 'fsCoreBeam', ax, az, 1.1, 1.2);
  else heldSay(F, S, 'beamPalm', 'fsBeam', ax, az, 1.1, 1.2);
}

/** The beam ends (once): its trench a → b glows and cools (wider and longer than a laser's scar), a puff
 *  of smoke along it, a hiss. */
export function cannonEnd(F, S, ax, az, bx, bz, w) {
  if (!F.fire || !Number.isFinite(ax + az + bx + bz + w)) return 0;
  w = Math.max(0.4, Math.min(4.5, w));
  const Q = A_.trench;
  const spent = hotLine(F, ax, az, bx, bz, w, Q.life, Q.heat, Q.rows, 0.7);
  keepScar(S, ax, az, bx, bz, w, Q.life, true);
  const L = Math.hypot(bx - ax, bz - az), n = Math.min(24, Math.ceil(L / 1.2));
  for (let i = 0; i < n; i++) {
    const u = (i + F.lr()) / n;
    F._blob(ax + (bx - ax) * u, 0.85, az + (bz - az) * u, F.lrand(-0.3, 0.3), F.lrand(0.6, 1.4), F.lrand(-0.3, 0.3), F.lrand(1.0, 1.8), 0.6, 1.6, 0.5, 0, K_SMOKE, 0.6);
  }
  F._say('fsBeamEnd', (ax + bx) / 2, (az + bz) / 2, 0);
  return spent;
}

// ---------------------------------------------------------------- THE BOLTS
/** The forearm gun fires (once): a hot white flash, strokes thrown forward, two brass casings kicked out. */
export function gunFlash(F, S, x, y, z, dx, dz) {
  if (!F.fire || !Number.isFinite(x + y + z + dx + dz)) return;
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, base = Math.atan2(uz, ux);
  const P = F._toCamera(x, y, z), A = F._axes();
  for (let i = 0; i < 9; i++) {
    const rr = 0.26 * Math.sqrt((i + 0.5) / 9), a = i * 2.39996, ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
    F._blob(P.x + A.rx * ox + A.ux * oy, P.y + A.ry * ox + A.uy * oy, P.z + A.rz * ox + A.uz * oy, ux * 2, 0, uz * 2, 0.1, 0.22, 0.4, 0.75, 0, K_VOID, 3);
  }
  F._blob(P.x, P.y, P.z, 0, 0, 0, 0.08, 0.22, 0.34, 1.1, 0, K_STEEL);
  for (let i = -2; i <= 2; i++) {
    const a = base + (i / 2) * 0.35, len = F.lrand(0.6, 1.0) * (1 - 0.15 * Math.abs(i));
    F._ink(x + Math.cos(a) * 0.15, y, z + Math.sin(a) * 0.15, x + Math.cos(a) * len, y + F.lrand(-0.08, 0.08), z + Math.sin(a) * len, 0.08, 0.6, 0, 0.3, 0, K_VOID);
  }
  // casings: two, kicked out to his right of the line and up, tumbling
  for (let i = 0; i < 2; i++) {
    const o = F._rec(x, y + 0.05, z, F.lrand(0.5, 0.8), 0.12, 0.1, '=-', BRASS, BRASS_END);
    o.vx = -uz * F.lrand(1.5, 3) + ux * F.lrand(-0.5, 0.5);
    o.vz = ux * F.lrand(1.5, 3) + uz * F.lrand(-0.5, 0.5);
    o.vy = F.lrand(2, 3.5);
    o.gravity = -12;
    o.spin = F.lrand(-12, 12);
    o.alphaEnd = 0.6;
    F._spawn(F.alpha, o);
  }
  F._light({ x, y, z, color: L_HEAT, intensity: 2.4, radius: 5, life: 0.1, fade: 0.1 });
  F._say('fsGun', x, z, 0);
}

/** A bolt in flight (every frame): b { x, y, z, dx, dy, dz, k, back }: a hard white head, a streak of his heat
 *  behind it; `back` (a perfect parry sent it home): white-hot with a fire edge. */
export function bolt(F, S, b) {
  if (!F.fire || !b || !Number.isFinite(b.x + b.y + b.z + b.dx + b.dz)) return;
  const k = clamp01(fin(b.k, 1)), dy = fin(b.dy, 0), l = Math.hypot(b.dx, dy, b.dz) || 1;
  const ux = b.dx / l, uy = dy / l, uz = b.dz / l, len = 0.9;
  const tx = b.x - ux * len, ty = b.y - uy * len, tz = b.z - uz * len;
  F._ink(tx, ty, tz, b.x, b.y, b.z, 0, 0.55 * k, 0, 1.15 * k, 0, b.back ? K_FIRE : K_VOID);
  const life = F._frame();
  if (life > 0) {
    F._blob(b.x, b.y, b.z, 0, 0, 0, life, 0.2, 0.2, 1.2 * k, 1.2 * k, K_STEEL);
    F._blob(b.x - ux * 0.3, b.y - uy * 0.3, b.z - uz * 0.3, 0, 0, 0, life, 0.36, 0.36, 0.45 * k, 0.45 * k, b.back ? K_FIRE : K_VOID);
  }
  if (F.lr() < 0.35) F._blob(tx, ty, tz, F.lrand(-0.3, 0.3), F.lrand(0, 0.4), F.lrand(-0.3, 0.3), F.lrand(0.14, 0.22), 0.26, 0.12, 0.3 * k, 0, b.back ? K_FIRE : K_VOID, 2);
}

/** A bolt bites what it hits (once): a burst of sparks, a hot flash, a puff of grit. */
export function boltHit(F, S, x, y, z, k = 1) {
  if (!Number.isFinite(x + y + z + k)) return;
  k = Math.max(0.3, Math.min(2, k));
  for (let i = 0; i < Math.round(12 * k); i++) {
    const a = F.lr() * TAU, sp = F.lrand(2, 7) * k;
    const o = F._rec(x, y, z, F.lrand(0.15, 0.35), 0.11, 0.03, "*+'", F.lr() < 0.4 ? HOT : WHITE, HOT_END);
    o.vx = Math.cos(a) * sp;
    o.vz = Math.sin(a) * sp;
    o.vy = F.lrand(-1, 4);
    o.drag = 2.5;
    o.gravity = -8;
    F._spawn(F.add, o);
  }
  if (F.fire) {
    for (let i = 0; i < 8; i++) {
      const a = F.lr() * TAU, sp = F.lrand(2, 4);
      F._blob(x, y, z, Math.cos(a) * sp, F.lrand(-0.5, 1.5), Math.sin(a) * sp, 0.14, 0.34 * k, 0.2, 0.7, 0, K_VOID, 4);
    }
  }
  F.dust?.(x, z, 0.5 * k);
  F._light({ x, y, z, color: L_HEAT, intensity: 2 * k, radius: 4, life: 0.12, fade: 0.1 });
  F._say('fsBoltHit', x, z, k);
}

// ---------------------------------------------------------------- THE MISSILES
/** The shoulder petals open and `n` leave (once): smoke puffed off both shoulders, a flash per cell. */
export function missileLaunch(F, S, x, y, z, n = 8) {
  if (!Number.isFinite(x + y + z + n)) return;
  n = Math.max(1, Math.min(16, Math.round(n)));
  const d = F.d;
  for (const side of ['shoulderR', 'shoulderL']) {
    const P = d?.partPoint ? d.partPoint(side, F._partV) : null;
    const px = P && Number.isFinite(P.x) ? P.x : x, py = P && Number.isFinite(P.y) ? P.y : y, pz = P && Number.isFinite(P.z) ? P.z : z;
    if (F.fire) {
      for (let i = 0; i < 4 + n; i++) {
        F._blob(px + F.lrand(-0.15, 0.15), py + 0.1, pz + F.lrand(-0.15, 0.15), F.lrand(-0.6, 0.6), F.lrand(1.2, 3), F.lrand(-0.6, 0.6), F.lrand(0.7, 1.3), 0.35, 1.2, 0.5, 0, K_SMOKE, 1.2);
      }
      for (let i = 0; i < Math.ceil(n / 2); i++) F._blob(px, py + 0.15, pz, F.lrand(-1, 1), F.lrand(3, 6), F.lrand(-1, 1), 0.12, 0.3, 0.15, 0.9, 0, K_FIRE, 3);
    }
    for (let i = 0; i < 4; i++) {
      const o = F._rec(px, py + 0.1, pz, F.lrand(0.2, 0.4), 0.11, 0.03, "'+.", HOT, HOT_END);
      o.vx = F.lrand(-2, 2);
      o.vy = F.lrand(2, 5);
      o.vz = F.lrand(-2, 2);
      o.drag = 2;
      F._spawn(F.add, o);
    }
  }
  F._light({ x, y: y + 0.5, z, color: L_FIRE, intensity: 2.2, radius: 5, life: 0.3, fade: 0.25 });
  F._say('fsLaunch', x, z, n);
}

/** A missile in flight (every frame): m { x, y, z, vx, vy, vz, k }: a bright head, its motor's flame, a
 *  thin smoke trail of tiny letters laid back along its last frame's path. */
export function missile(F, S, m) {
  if (!m || !Number.isFinite(m.x + m.y + m.z + m.vx + m.vy + m.vz)) return;
  const k = clamp01(fin(m.k, 1)), dt = Math.max(1 / 240, fin(F.game.fxDt, F.game.dt ?? 0.016));
  const sp = Math.hypot(m.vx, m.vy, m.vz) || 1, ux = m.vx / sp, uy = m.vy / sp, uz = m.vz / sp;
  const life = F._frame();
  if (F.fire && life > 0) {
    F._blob(m.x, m.y, m.z, 0, 0, 0, life, 0.16, 0.16, 1.15, 1.15, K_STEEL);
    F._blob(m.x - ux * 0.25, m.y - uy * 0.25, m.z - uz * 0.25, 0, 0, 0, life, 0.3, 0.3, 0.75 * k, 0.75 * k, K_FIRE);
  }
  // the trail: tiny faint letters along the path flown this frame
  const back = Math.min(1.5, sp * dt), n = Math.max(1, Math.round(back / A_.missile.trailStep));
  for (let i = 0; i < n; i++) {
    const u = (i + F.lr()) / n, px = m.x - ux * (0.3 + back * u), py = m.y - uy * (0.3 + back * u), pz = m.z - uz * (0.3 + back * u);
    const o = F._rec(px, py, pz, F.lrand(0.6, 1.1), 0.1, 0.16, ".,'`", SMOKE_G, SMOKE_END);
    o.vx = F.lrand(-0.15, 0.15);
    o.vy = F.lrand(0.05, 0.35);
    o.vz = F.lrand(-0.15, 0.15);
    o.alpha = 0.7;
    o.drag = 0.6;
    F._spawn(F.alpha, o);
  }
}

/** A ring marked on the floor where one comes down (every frame; k 0..1 to its landing; the tell): a ring
 *  of red strokes, a red fill growing in from the rim as it arrives, a cross at its heart late; it blinks
 *  in the last fifth. `cross` (default true): the cross. */
export function missileMark(F, S, x, z, r, k, cross = true) {
  if (!F.fire || !Number.isFinite(x + z + r + k) || !(r > 0)) return;
  const life = F._frame();
  if (!(life > 0)) return;
  k = clamp01(k);
  const Q = A_.mark, t = now(F);
  const blink = k > 0.8 ? (Math.sin(t * Q.blink * TAU) > 0 ? 1.18 : 0.8) : 1;
  const n = Math.min(64, Math.max(14, Math.round((TAU * r) / Q.step))), h = (Q.heat + Q.rise * k) * GROUND_GAIN * blink;
  if (markStyle() === 'disc') {
    // a dim red disc over the whole area (it warms as it comes), its rim written on the letter grid
    for (let i = 0; i < 9; i++) {
      const rr = r * 0.62 * Math.sqrt((i + 0.5) / 9), a = i * 2.39996;
      F._blob(x + Math.cos(a) * rr, GROUND_Y, z + Math.sin(a) * rr, 0, 0, 0, life, r * 0.8, r * 0.8, (Q.disc[0] + Q.disc[1] * k) * GROUND_GAIN, 0, K_FIRE);
    }
    const m = Math.min(40, Math.max(12, Math.round((TAU * r) / 0.5)));
    let px = x + r, pz = z;
    for (let i = 1; i <= m; i++) {
      const a = (i / m) * TAU, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
      F._ink(px, GROUND_Y, pz, qx, GROUND_Y, qz, 0, h * 0.75, 0, h * 0.75, 1, K_FIRE);
      px = qx;
      pz = qz;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      F._blob(x + Math.cos(a) * r, GROUND_Y, z + Math.sin(a) * r, 0, 0, 0, life, 0.28, 0.28, h, h, K_FIRE);
    }
  }
  // the fill: a second ring closing in from the rim (where it has reached, the floor between is red)
  const ri = r * (1 - 0.92 * k), m = Math.min(48, Math.max(6, Math.round((TAU * ri) / 0.36))), hi = Q.fill * GROUND_GAIN;
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU;
    F._blob(x + Math.cos(a) * ri, GROUND_Y, z + Math.sin(a) * ri, 0, 0, 0, life, 0.26, 0.26, hi, hi, K_FIRE);
  }
  if (cross && k > 0.5) {
    const c = r * 0.45, hc = Q.heat * GROUND_GAIN * 0.8;
    F._ink(x - c, GROUND_Y, z, x + c, GROUND_Y, z, 0, hc, 0, hc, 0, K_FIRE);
    F._ink(x, GROUND_Y, z - c, x, GROUND_Y, z + c, 0, hc, 0, hc, 0, K_FIRE);
  }
}

/** A missile's blast (once), r m, power ~1: a ball of fire, a dust front, grit and plate chips, smoke. */
export function blast(F, S, x, z, r = 1.6, power = 1) {
  if (!Number.isFinite(x + z + r + power)) return;
  r = Math.max(0.5, Math.min(8, r));
  const p = Math.max(0.3, Math.min(3, power));
  if (F.fire) {
    for (let i = 0; i < Math.round(22 * p); i++) {
      const a = F.lr() * TAU, e = F.lrand(0.1, 1.2), sp = F.lrand(1.5, 4.5) * Math.sqrt(r / 1.6);
      F._blob(x + Math.cos(a) * 0.2, 0.6, z + Math.sin(a) * 0.2, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, F.lrand(0.3, 0.55), 0.55, 1.1, F.lrand(0.8, 1.3), 0, K_FIRE, 2.5, 1.5);
    }
    F._blob(x, 0.8, z, 0, 0.5, 0, 0.16, 0.8 * Math.sqrt(r), 1.3 * Math.sqrt(r), 1.6, 0, K_STEEL, 3);
    for (let i = 0; i < Math.round(8 * p); i++) {
      const a = F.lr() * TAU, sp = F.lrand(0.5, 1.6);
      F._blob(x + Math.cos(a) * 0.4, F.lrand(0.9, 1.4), z + Math.sin(a) * 0.4, Math.cos(a) * sp, F.lrand(0.8, 1.8), Math.sin(a) * sp, F.lrand(1, 1.8), 0.7, 1.9, 0.55, 0, K_SMOKE, 1.2, 0.3);
    }
  }
  F.shock?.(x, z, r * 1.2, F._opt(0.6 + 0.3 * p, 0.4, 'fire', 0, p > 1.2));
  for (let i = 0; i < Math.round(10 * p); i++) {
    const a = F.lr() * TAU, sp = F.lrand(2.5, 7);
    const plate = F.lr() < 0.4;
    const o = F._rec(x, 0.3, z, F.lrand(0.5, 1.0), F.lrand(0.14, 0.22), 0.07, plate ? '=#-' : "%&,.", plate ? PLATE : DIRT, plate ? PLATE_END : DIRT_END);
    o.vx = Math.cos(a) * sp;
    o.vy = F.lrand(3, 7);
    o.vz = Math.sin(a) * sp;
    o.gravity = -14;
    o.drag = 1;
    o.spin = F.lrand(-8, 8);
    F._spawn(F.alpha, o);
  }
  F._light({ x, y: 1.2, z, color: L_FIRE, intensity: 4.5 * p, radius: r * 3, life: 0.35, fade: 0.3 });
  F._say('fsBlast', x, z, p);
}

/** A missile cut out of the air by the hero's blade (once): it bursts where it was, smaller, and sparks
 *  run along the cut. */
export function missileCut(F, S, x, y, z, dx = 0, dz = 0) {
  if (!Number.isFinite(x + y + z)) return;
  if (F.fire) {
    for (let i = 0; i < 12; i++) {
      const a = F.lr() * TAU, sp = F.lrand(1.5, 3.5);
      F._blob(x, y, z, Math.cos(a) * sp, F.lrand(-0.5, 2), Math.sin(a) * sp, F.lrand(0.25, 0.4), 0.4, 0.8, F.lrand(0.8, 1.1), 0, K_FIRE, 2.5, 1);
    }
  }
  const l = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 10; i++) {
    const s = F.lrand(-1, 1), o = F._rec(x, y, z, F.lrand(0.2, 0.4), 0.11, 0.03, "*+'", WHITE, HOT_END);
    o.vx = (dx / l) * s * 6 + F.lrand(-1, 1);
    o.vy = F.lrand(0, 3);
    o.vz = (dz / l) * s * 6 + F.lrand(-1, 1);
    o.drag = 2.5;
    o.gravity = -8;
    F._spawn(F.add, o);
  }
  F._light({ x, y, z, color: L_FIRE, intensity: 2.5, radius: 5, life: 0.2, fade: 0.2 });
  F._say('fsMissileCut', x, z, 0);
}

// ---------------------------------------------------------------- THE ARTILLERY
/** The mortar tubes on his back fire (once): a flash and a column of smoke straight up off his back. */
export function mortarFlash(F, S, x, y, z, n = 1) {
  if (!Number.isFinite(x + y + z)) return;
  n = Math.max(1, Math.min(6, Math.round(fin(n, 1))));
  if (F.fire) {
    for (let i = 0; i < 6 * n; i++) F._blob(x + F.lrand(-0.2, 0.2), y + 0.2, z + F.lrand(-0.2, 0.2), F.lrand(-0.4, 0.4), F.lrand(4, 9), F.lrand(-0.4, 0.4), F.lrand(0.1, 0.18), 0.3, 0.2, 1.0, 0, K_FIRE, 3);
    for (let i = 0; i < 4 * n; i++) F._blob(x + F.lrand(-0.25, 0.25), y + 0.4, z + F.lrand(-0.25, 0.25), F.lrand(-0.5, 0.5), F.lrand(1.5, 3.5), F.lrand(-0.5, 0.5), F.lrand(0.8, 1.5), 0.4, 1.4, 0.5, 0, K_SMOKE, 1.4);
    F._blob(x, y + 0.3, z, 0, 0, 0, 0.08, 0.3, 0.45, 1.2, 0, K_STEEL);
  }
  F._light({ x, y: y + 0.5, z, color: L_FIRE, intensity: 3, radius: 6, life: 0.15, fade: 0.15 });
  F._say('fsMortar', x, z, n);
}

/** A marked shell of the creeping barrage (every frame; k 0..1 to its landing): the missile's red ring
 *  with four ticks outside it (a sight), so the barrage's rows read apart from the missiles' rings. */
export function shellMark(F, S, x, z, r, k) {
  if (!F.fire || !Number.isFinite(x + z + r + k) || !(r > 0)) return;
  missileMark(F, S, x, z, r, k, false);
  const h = (A_.mark.heat + A_.mark.rise * clamp01(k)) * GROUND_GAIN;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    F._ink(x + ca * r * 1.08, GROUND_Y, z + sa * r * 1.08, x + ca * (r * 1.08 + 0.55), GROUND_Y, z + sa * (r * 1.08 + 0.55), 0, h, 0, h, 0, K_FIRE);
  }
}

/** A shell coming down (every frame; k 0..1 to its landing): a white streak falling, a hot head; its
 *  whistle starts with it. */
export function shellFall(F, S, x, y, z, k) {
  if (!Number.isFinite(x + y + z + k)) return;
  if (F.fire) {
    F._ink(x, y + 1.6, z, x, y, z, 0, 0.35, 0, 1.0, 0, K_STEEL);
    const life = F._frame();
    if (life > 0) F._blob(x, y, z, 0, 0, 0, life, 0.22, 0.22, 0.9, 0.9, K_FIRE);
  }
  if (fresh(F, S, 'shellFall', x, z, 1.2)) F._say('fsWhistle', x, z, Math.max(0.2, (1 - clamp01(k)) * 1.5));
}

/** A shell's burst (once; the great shell: a larger r and power): fire, a front of dust, earth and plate
 *  thrown, a crater (AscFx.crater), smoke hanging. */
export function shellBurst(F, S, x, z, r = 2, power = 1) {
  if (!Number.isFinite(x + z + r + power)) return;
  r = Math.max(0.6, Math.min(9, r));
  const p = Math.max(0.3, Math.min(4, power));
  if (F.fire) {
    for (let i = 0; i < Math.round(26 * p); i++) {
      const a = F.lr() * TAU, sp = F.lrand(0.6, 2.2) * Math.sqrt(r);
      F._blob(x + Math.cos(a) * 0.3, 0.5, z + Math.sin(a) * 0.3, Math.cos(a) * sp, F.lrand(3, 9) * Math.sqrt(p), Math.sin(a) * sp, F.lrand(0.35, 0.6), 0.55, 1.2, F.lrand(0.9, 1.3), 0, K_FIRE, 2, 1.8);
    }
    F._blob(x, 0.8, z, 0, 0.5, 0, 0.18, r * 0.5, r * 0.8, 1.6, 0, K_STEEL, 3);
    for (let i = 0; i < Math.round(10 * p); i++) {
      const a = F.lr() * TAU, sp = F.lrand(0.3, 1.2);
      F._blob(x + Math.cos(a) * 0.6, F.lrand(1.2, 2.4), z + Math.sin(a) * 0.6, Math.cos(a) * sp, F.lrand(1.2, 2.6), Math.sin(a) * sp, F.lrand(1.4, 2.4), 0.8, 2.4, 0.55, 0, K_SMOKE, 1, 0.3);
    }
  }
  F.crater?.(x, z, r, Math.min(2.2, 0.8 + 0.4 * p));
  for (let i = 0; i < Math.round(12 * p); i++) {
    const a = F.lr() * TAU, sp = F.lrand(3, 9);
    const plate = F.lr() < 0.5;
    const o = F._rec(x, 0.3, z, F.lrand(0.6, 1.2), F.lrand(0.16, 0.26), 0.08, plate ? '=#-' : '%&#,.', plate ? PLATE : DIRT, plate ? PLATE_END : DIRT_END);
    o.vx = Math.cos(a) * sp;
    o.vy = F.lrand(4, 10);
    o.vz = Math.sin(a) * sp;
    o.gravity = -14;
    o.drag = 0.8;
    o.spin = F.lrand(-8, 8);
    F._spawn(F.alpha, o);
  }
  F._light({ x, y: 1.5, z, color: L_FIRE, intensity: 5 * p, radius: r * 3, life: 0.45, fade: 0.35 });
  F._say('fsShellBurst', x, z, p);
}

// ---------------------------------------------------------------- THE LANCE
/**
 * The reticle on the hero (every frame; k 0..1 to the lock): four pale steel brackets turning, closing in from
 * A_.reticle.r0 to r1 m; `locked`: they stop, turn RED and blink, a ring closes round them and a thin red
 * column stands over the spot. The moment it locks (false → true): a burst of red, the lock tone. The lock
 * is drawn on the floor AND in the air (the column), so it reads behind the hero's body.
 */
export function reticle(F, S, x, z, k, locked = false) {
  if (!F.fire || !Number.isFinite(x + z + k)) return;
  const life = F._frame();
  k = clamp01(k);
  const Q = A_.reticle, t = now(F), R = S.reticle;
  if (locked && !R.locked) {
    // the lock: a ring of red flung in, the tone
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      F._blob(x + Math.cos(a) * Q.r0 * 1.4, GROUND_Y + 0.1, z + Math.sin(a) * Q.r0 * 1.4, -Math.cos(a) * 6, 0, -Math.sin(a) * 6, 0.25, 0.4, 0.3, 0.6 * GROUND_GAIN, 0, K_FIRE, 2);
    }
    F._say('fsLock', x, z, 0);
  } else if (!locked && fresh(F, S, 'reticle', x, z, 6)) F._say('fsTrack', x, z, 0);
  R.locked = !!locked;
  R.t = t;
  if (!(life > 0)) return;
  const r = locked ? Q.r1 : Q.r0 + (Q.r1 - Q.r0) * k, spin = locked ? 0 : t * 1.6;
  const blink = locked ? (Math.sin(t * 10 * TAU) > -0.3 ? 1 : 0.55) : 1;
  const kind = locked ? K_FIRE : K_STEEL, h = (locked ? 0.62 : 0.26 + 0.14 * k) * GROUND_GAIN * blink;
  for (let i = 0; i < 4; i++) {
    const a = spin + (i / 4) * TAU + Math.PI / 4;
    // a bracket: an arc of a quarter's third, and a tick inward
    for (let j = -2; j <= 2; j++) {
      const b = a + j * 0.13;
      F._blob(x + Math.cos(b) * r, GROUND_Y, z + Math.sin(b) * r, 0, 0, 0, life, 0.3, 0.3, h, h, kind);
    }
    F._ink(x + Math.cos(a) * r, GROUND_Y, z + Math.sin(a) * r, x + Math.cos(a) * r * 0.62, GROUND_Y, z + Math.sin(a) * r * 0.62, 0, h, 0, h, 0, kind);
  }
  if (locked) {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      F._blob(x + Math.cos(a) * r * 1.35, GROUND_Y, z + Math.sin(a) * r * 1.35, 0, 0, 0, life, 0.28, 0.28, h * 0.8, h * 0.8, K_FIRE);
    }
    F._ink(x, 0.4, z, x, Q.column, z, 0, 0.5 * blink, 0, 0.3 * blink, 0, K_FIRE);
    F._keep('fsReticle', x, 1.5, z, L_RED, 1.6 * blink, 4, 0);
  } else F._keep('fsReticle', x, 1.2, z, L_HEAT, 0.6 + 0.8 * k, 3.5, 0);
}

/** The pillar of light (every frame; k 0..1 through its life: up fast, held, then thinning): from the
 *  sky to (x, z), r m its radius; the floor at its foot molten, a ring of sparks. AscFx's beam stood on
 *  end (his palette, a white core). */
export function skyLance(F, S, x, z, r, k) {
  if (!F.fire || !Number.isFinite(x + z + r + k)) return;
  k = clamp01(k);
  const s = k < 0.12 ? k / 0.12 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
  if (!(s > 0.01)) return;
  const dt = Math.max(0, fin(F.game.fxDt, F.game.dt ?? 0.016));
  F.beam(x, A_.lance.top, z, x, 0.15, z, Math.max(0.6, 2 * r * (0.6 + 0.4 * s)), s, dt, 3);
  const life = F._frame();
  if (life > 0) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, rr = r * 1.2 * Math.sqrt((i + 0.5) / n);
      F._blob(x + Math.cos(a) * rr, GROUND_Y, z + Math.sin(a) * rr, 0, 0, 0, life, 0.5, 0.5, (0.45 + 0.25 * F.lr()) * s * GROUND_GAIN * 0.5, 0, K_FIRE);
    }
  }
  S.acc.lance += dt * 50 * s;
  while (S.acc.lance >= 1) {
    S.acc.lance -= 1;
    const a = F.lr() * TAU, sp = F.lrand(3, 8);
    const o = F._rec(x + Math.cos(a) * r, 0.3, z + Math.sin(a) * r, F.lrand(0.3, 0.55), 0.12, 0.03, "*+'", F.lr() < 0.5 ? WHITE : HOT, HOT_END);
    o.vx = Math.cos(a) * sp;
    o.vz = Math.sin(a) * sp;
    o.vy = F.lrand(2, 6);
    o.gravity = -12;
    o.drag = 1;
    F._spawn(F.add, o);
  }
  F._keep('fsLance', x, 2, z, L_WHITE, 6 * s, 10, 0.2);
  heldSay(F, S, 'lance', 'fsLance', x, z, 99, 1.4);
}

/** A ring shock along the floor from (x, z) out to r m (once): Verdict's ring, Last Rite's blast ring. A
 *  front of fire and dust (DuelFx.shock), a crisp echo, a thump. `k` its strength. */
export function ringShock(F, S, x, z, r, k = 1) {
  if (!Number.isFinite(x + z + r + k) || !(r > 0.3)) return;
  F.shock?.(x, z, r, F._opt(Math.max(0.4, Math.min(2, k)), 0.55, 'fire', 0, true));
  F._light({ x, y: 1, z, color: L_FIRE, intensity: 3 * k, radius: r * 1.6, life: 0.35, fade: 0.3 });
  F._say('fsRing', x, z, k);
}

// ---------------------------------------------------------------- THE FLIGHTS (the projectiles' pool)
/**
 * Launch a projectile this file flies and draws. Returns its record (FsFlight; null when the pool is full)
 * with: `at` (the boss's clock, d.time, when it lands), `left` (s), `retime(s)`, `cancel()`, `x y z` now,
 * `tx tz` its target, `cue` (its ledger handle), `data` (the caller's). o:
 *   kind      'missile' (an arc up and down onto its ring) | 'shell' (climbs out of view, falls straight
 *             onto its mark) | 'bolt' (a straight line, `speed` m/s; lands at its target)
 *   x y z     where it leaves (a missile: a shoulder cell; a shell: the mortar; a bolt: the gun)
 *   tx tz     where it comes down (ty: a bolt's end height, default 1.1)
 *   T         flight time s (missile / shell; a bolt from its `speed`, default 26 m/s)
 *   apex      a missile's peak over the higher end (m, default 5) · r its mark's radius (m)
 *   mark      draw its mark (default true for missile / shell) · markLead: s before landing it shows
 *   track     0..1: the share of its flight its target follows the hero (`trackSpeed` m/s, default 6)
 *   tell      default RED (a bolt: BLUE) · attack: its name (the ledger, the meter)
 *   expect    true (default): a ledger handle brain.expect(T, tell, attack) from the launch, retimed and
 *             cancelled with it · false: none · a handle: shared (a barrage row's one), left alone
 *   cueLead + onCue(rec): called once `cueLead` s before it lands (the caller's flash)
 *   onLand(rec): called once as it lands (the caller deals the damage and breaks the world there)
 *   burst     default true: the landing is drawn here (missile: blast, shell: shellBurst, bolt: boltHit)
 *   power     the landing's drawn size (1) · back: a bolt sent home by a perfect parry · data: anything
 */
export function fly(F, S, o = {}) {
  const f = S.flights.find((x) => !x.alive);
  if (!f) return null;
  const d = F.d;
  const kind = o.kind === 'shell' || o.kind === 'bolt' ? o.kind : 'missile';
  f.kind = kind;
  f.id = S.nextId++;
  f.x0 = fin(o.x, d?.position?.x ?? 0);
  f.y0 = fin(o.y, 1.8);
  f.z0 = fin(o.z, d?.position?.z ?? 0);
  f.tx = fin(o.tx, f.x0);
  f.tz = fin(o.tz, f.z0);
  f.ty = kind === 'bolt' ? fin(o.ty, 1.1) : 0;
  if (kind === 'bolt') {
    const L = Math.hypot(f.tx - f.x0, f.ty - f.y0, f.tz - f.z0);
    f.T = Math.max(0.05, fin(o.T, L / Math.max(1, fin(o.speed, 26))));
  } else f.T = Math.max(0.2, fin(o.T, kind === 'shell' ? 2 : 1.4));
  f.t = 0;
  f.apex = fin(o.apex, A_.missile.apex);
  f.r = fin(o.r, kind === 'shell' ? A_.shell.r : A_.missile.r);
  f.mark = kind === 'bolt' ? !!o.mark : o.mark !== false;
  f.markLead = fin(o.markLead, 99);
  f.tell = o.tell ?? (kind === 'bolt' ? TELL.BLUE : TELL.RED);
  f.attack = o.attack ?? '';
  f.power = fin(o.power, 1);
  f.track = clamp01(fin(o.track, 0));
  f.trackSpeed = fin(o.trackSpeed, 6);
  f.burst = o.burst !== false;
  f.sound = o.sound !== false;
  f.back = !!o.back;
  f.onLand = typeof o.onLand === 'function' ? o.onLand : null;
  f.onCue = typeof o.onCue === 'function' ? o.onCue : null;
  f.cueLead = fin(o.cueLead, 0);
  f.cued = false;
  f.data = o.data ?? null;
  f.k = 1;
  f._clock = F._clock;
  f.at = F._clock() + f.T;
  f.cue = null;
  f.ownCue = false;
  if (o.expect && typeof o.expect === 'object') f.cue = o.expect;
  else if (o.expect !== false) {
    try {
      f.cue = d?.brain?.expect?.(f.T, f.tell, f.attack) ?? null;
      f.ownCue = !!f.cue;
    } catch (err) {
      console.error('[saint] fx flight expect', err);
    }
  }
  f.alive = true;
  place(F, f, 0);
  return f;
}

/** Its position at its age (and the velocity it flies with, for the trail). */
function place(F, f, dt) {
  const u = clamp01(f.t / f.T);
  const px = f.x, py = f.y, pz = f.z;
  if (f.kind === 'missile') {
    // up out of the cell first, over the apex, down onto the ring: a parabola over a straight ground path
    const peak = Math.max(f.y0, 0) + f.apex;
    f.x = f.x0 + (f.tx - f.x0) * u;
    f.z = f.z0 + (f.tz - f.z0) * u;
    f.y = f.y0 * (1 - u) * (1 - u) + 2 * peak * u * (1 - u) + f.ty * u * u;
  } else if (f.kind === 'shell') {
    const c = A_.shell.climb, top = A_.shell.top;
    if (u < c) {
      const v = u / c;
      f.x = f.x0 + (f.tx - f.x0) * v * 0.15;
      f.z = f.z0 + (f.tz - f.z0) * v * 0.15;
      f.y = f.y0 + (top - f.y0) * v * v;
    } else {
      const v = (u - c) / (1 - c);
      f.x = f.tx;
      f.z = f.tz;
      f.y = top * (1 - v * v) + f.ty * v * v;
    }
  } else {
    f.x = f.x0 + (f.tx - f.x0) * u;
    f.y = f.y0 + (f.ty - f.y0) * u;
    f.z = f.z0 + (f.tz - f.z0) * u;
    const L = Math.hypot(f.tx - f.x0, f.ty - f.y0, f.tz - f.z0) || 1;
    f.dx = (f.tx - f.x0) / L;
    f.dy = (f.ty - f.y0) / L;
    f.dz = (f.tz - f.z0) / L;
  }
  if (dt > 0) {
    f.vx = (f.x - px) / dt;
    f.vy = (f.y - py) / dt;
    f.vz = (f.z - pz) / dt;
  } else {
    f.vx = (f.tx - f.x0) / f.T;
    f.vy = f.kind === 'shell' ? 20 : 4;
    f.vz = (f.tz - f.z0) / f.T;
  }
}

/** Every frame (FsFx.update, the game's dt: the boss's clock): fly, draw, cue, land. */
export function update(F, S, dt, d) {
  if (!S) return;
  updateScars(F, S, Math.max(0, fin(F.game.fxDt, dt)));
  let live = 0;
  const p = F.game.player?.position;
  for (const f of S.flights) {
    if (!f.alive) continue;
    live++;
    if (dt > 0) {
      f.t += dt;
      // a tracking one: its target walks after the hero for the first `track` of its flight
      if (f.track > 0 && p && f.t / f.T < f.track) {
        const ex = p.x - f.tx, ez = p.z - f.tz, el = Math.hypot(ex, ez), m = f.trackSpeed * dt;
        if (el > 1e-3) {
          const s = Math.min(1, m / el);
          f.tx += ex * s;
          f.tz += ez * s;
        }
      }
      place(F, f, dt);
    }
    const u = clamp01(f.t / f.T);
    f.k = u;
    try {
      if (f.onCue && !f.cued && f.T - f.t <= f.cueLead) {
        f.cued = true;
        f.onCue(f);
      }
    } catch (err) {
      console.error('[saint] fx flight onCue', err);
    }
    if (!f.alive) continue;
    if (f.t >= f.T) {
      // it lands: the caller's, then its burst
      f.alive = false;
      try {
        f.onLand?.(f);
      } catch (err) {
        console.error('[saint] fx flight onLand', err);
      }
      if (f.burst) {
        if (f.kind === 'missile') blast(F, S, f.tx, f.tz, f.r * 1.15, f.power);
        else if (f.kind === 'shell') shellBurst(F, S, f.tx, f.tz, f.r * 1.2, f.power);
        else boltHit(F, S, f.x, f.y, f.z, f.power);
      }
      f.cue = null;
      continue;
    }
    // the drawing
    if (f.kind === 'missile') {
      F.missile(f);
      if (f.mark && f.T - f.t <= f.markLead) F.missileMark(f.tx, f.tz, f.r, u);
    } else if (f.kind === 'shell') {
      if (f.mark && f.T - f.t <= f.markLead) F.shellMark(f.tx, f.tz, f.r, u);
      if (u >= A_.shell.climb) F.shellFall(f.x, f.y, f.z, u);
      else if (F.fire) F._ink(f.x, f.y - 1.2, f.z, f.x, f.y, f.z, 0, 0.3, 0, 0.9, 0, K_STEEL);
    } else F.bolt(f);
  }
  S.live = live;
}

/** Every flight alive cancelled (the move cut short, a reaction, his death). */
export function cancelAll(F, S) {
  for (const f of S?.flights ?? []) f.cancel();
}

/** What the pools hold now (the tests, the Lab). */
export function poolState(S) {
  let fl = 0, sc = 0;
  for (const f of S.flights) if (f.alive) fl++;
  for (const s of S.scars) if (s.alive) sc++;
  return { flights: fl, flightsMax: S.flights.length, scars: sc, scarsMax: S.scars.length, fresh: S.fresh.length };
}
