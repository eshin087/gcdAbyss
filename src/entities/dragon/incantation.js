import { SCALE } from './tuning.js';
import { BROOD } from './tuningBrood.js';
import { K_FIRE, K_VOID } from '../enemies/duelist/fx.js';
import { FIRE_PALETTES } from '../../render/firePalettes.js';

// The wyrm's incantation (ADR-197): the roar that opens a cast spell, and the seal of burning script
// it draws on the ground round it (or hanging before its jaws), in the fire field's small letters
// (game.fx.fire, docs/STYLE.md "The fire field"). Every roar-cast spell (spellsFire.js,
// broodAttacks.js) calls cast() at its windup and reads back where the circle stands.
//
//   cast({ x, y, z, r, dur, kind, color, under }) -> id
//                     a circle at (x, y, z), radius r m, burning `dur` s (then it burns out by itself;
//                     end() sooner). kind 'ground' (flat on the ground round x, z) | 'jaws' (a seal
//                     hanging in the air, facing the camera; with x unset it hangs before the wyrm's
//                     mouth and follows it). color: the ink ('script' | 'fire' | 'blood'; ?incantInk).
//                     under: a ground circle round the wyrm's feet that stays under it while it burns
//                     (it turns and shuffles through a cast: left where it was cast, the circle was
//                     seen beside it; 2026-11-28)
//   flare(id, k)      the circle's power 0..1 (it brightens as the spell charges; a rise to 1 flashes)
//   end(id)           the circle burns out (its lines tear up into tongues over a short tail)
//   update(dt)        every frame (Dragon.update; never throws)
//   reset()           nothing left (death, phase change, the level's reset)
//   at(id, out)       fills out.{x, y, z, r} with where it stands now and returns true; false when gone
//   point(id, i, n, out)  the i-th of n points round its sigil ring (where things burst out of it)
//
// THE DRAWING. Its lines are WRITTEN ON THE LETTER GRID (the duelists' DuelFx._ink: one blob per cell
// the line crosses, re-drawn each frame on the one frame clock), in `fire`: at these heats a line
// prints as orange digits and the field's turbulence makes tongues climb off it, so the script burns.
// It is written in (the rings run round, the sigils appear one by one, the star's lines grow), turns
// (the band of sigils against the star), brightens with flare(), flashes white-hot as the spell
// releases and tears up into tongues as it burns out. The dragon script is a table of small shapes
// made of 2 - 5 strokes (SIGILS): claws, fangs, an eye, horns, a flame, a hook; not a font.
//
// THE LOOKS (`?incant=a|b`, the owner picks; a is the default):
//   a  the seal: everything flat on the ground (a 'jaws' seal stands upright before the mouth)
//   b  standing script: the rings and star flat, the sigils stand up on the ring as burning letters
//      that face the camera (they read at the game camera, where flat ones are 2 - 3 rows tall)
//   (c, script streaming off its body into the seal as motes of fire, was dropped in round 2: at the
//    game camera the motes did not read, and bigger ones were a second effect on top of the seal)
// The ink (`?incantInk=script|fire|blood`, script the default). The field's `fire` kind tears a thin
// line into climbing tongues, so the script is written in the fire field's void slot (free on the
// wyrm's level), re-dressed once: `script` the fire's own colours with little turbulence (BROOD.ink:
// the line holds its shape and boils; tongues of real fire climb off it), `blood` the crimson of
// firePalettes.js glareDeep (an existing palette), `fire` the plain fire kind (the lines burn away).
//
// No per-frame allocation (pooled records, scratch); nothing drawn while no circle burns; the look's
// jitter comes from a hash (never Math.random: the seeded sims replay that stream).

const I = BROOD.incant;
const TAU = Math.PI * 2;
const MAX = 4;
const LOOKS = ['a', 'b'];
const INKS = ['script', 'fire', 'blood'];
let LOOK = 'a';
let INK = 'script';
try {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  if (LOOKS.includes(q.get('incant'))) LOOK = q.get('incant');
  if (INKS.includes(q.get('incantInk'))) INK = q.get('incantInk');
} catch {
  /* headless */
}
/** The incantation's look in use ('a' | 'b'). */
export const incantLook = () => LOOK;
export const setIncantLook = (k) => {
  if (LOOKS.includes(k)) LOOK = k;
};
/** The incantation's ink ('script' | 'fire' | 'blood'; ?incantInk, 'script' the default). */
export const incantInk = () => INK;
export const setIncantInk = (k) => {
  if (INKS.includes(k)) INK = k;
};

// The dragon script: each sigil a list of strokes [x0, y0, x1, y1] in a box of -0.5 .. 0.5 (y up: the
// way out of the circle on the ground, up on a standing one).
const SIGILS = [
  [[0, -0.5, 0, 0.5], [-0.42, 0.3, 0, -0.05], [0.42, 0.3, 0, -0.05]], // the claw
  [[-0.4, 0.5, 0, -0.5], [0, -0.5, 0.4, 0.5], [-0.24, 0.02, 0.24, 0.02]], // the fang
  [[0, 0.5, 0.42, 0], [0.42, 0, 0, -0.5], [0, -0.5, -0.42, 0], [-0.42, 0, 0, 0.5], [0, 0.16, 0, -0.16]], // the eye
  [[-0.32, -0.5, 0, 0.5], [0, 0.5, 0.32, -0.5], [-0.46, -0.5, 0.46, -0.5]], // the flame
  [[-0.4, -0.5, -0.4, 0.2], [-0.4, 0.2, 0.42, 0.5], [0.42, -0.5, 0.42, 0.5]], // the horn
  [[-0.44, -0.44, 0.44, 0.44], [-0.44, 0.44, 0.44, -0.44], [0, -0.5, 0, 0.5]], // the crossing
  [[-0.3, 0.5, -0.3, -0.5], [-0.3, -0.5, 0.42, -0.18], [0, 0.12, 0.42, 0.12]], // the hook
  [[-0.42, 0.5, -0.42, 0], [0, 0.5, 0, -0.5], [0.42, 0.5, 0.42, 0], [-0.42, 0, 0.42, 0]], // the trident
];
const STAR = 7, STAR_STEP = 3; // a {7/3} heptagram

const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function blank() {
  return {
    alive: false, id: 0, kind: 'ground', follow: false, under: false, look: 'a', ink: 'fire',
    x: 0, y: 0, z: 0, r: 4, dur: 3, t: 0, k: 0, kPrev: 0, flashT: 9, ending: false, endT: 0,
    // the plane: u (right) and v (up / outward) axes; ground: u = +x, v = +z
    ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: 1, rot0: 0, rot1: 0, seed: 0, lickAcc: 0,
  };
}

export class Incantation {
  constructor(d) {
    this.d = d;
    this.game = d.game;
    this._next = 1;
    this.list = Array.from({ length: MAX }, blank);
    this.live = 0;
    this._p = { x: 0, y: 0, z: 0 }; // _map's result
    this._q = { x: 0, y: 0, z: 0 };
    this._inkSet = '';
  }

  /** The duelists' FX object the wyrm keeps for its timing cues: its _ink writes on the letter grid. */
  get _fx() {
    return this.d.fx?.tells ?? null;
  }

  cast(o = {}) {
    let c = null;
    for (const e of this.list) if (!e.alive) {
      c = e;
      break;
    }
    if (!c) {
      // the oldest gives way
      c = this.list[0];
      for (const e of this.list) if (e.id < c.id) c = e;
    }
    const d = this.d;
    c.alive = true;
    c.id = this._next++;
    c.kind = o.kind === 'jaws' ? 'jaws' : 'ground';
    c.look = LOOK;
    c.ink = INKS.includes(o.color) ? o.color : INK;
    c.r = Math.max(0.5, fin(o.r, c.kind === 'jaws' ? 2.4 : 6));
    c.dur = Math.max(0.2, fin(o.dur, 3));
    c.t = 0;
    c.k = 0;
    c.kPrev = 0;
    c.flashT = 9;
    c.ending = false;
    c.endT = 0;
    c.seed = (c.id * 7.31) % 13;
    c.rot0 = hash(c.id, 1) * TAU;
    c.rot1 = hash(c.id, 2) * TAU;
    c.lickAcc = 0;
    c.follow = c.kind === 'jaws' && !Number.isFinite(o.x);
    c.under = c.kind === 'ground' && !!o.under;
    if (c.follow) this._toJaws(c);
    else if (c.under) {
      this._toRoot(c);
      c.y = fin(o.y, 0);
      this._flat(c);
    }
    else {
      c.x = fin(o.x, d.position?.x ?? 0);
      c.z = fin(o.z, d.position?.z ?? 0);
      c.y = c.kind === 'jaws' ? fin(o.y, 3) : fin(o.y, 0);
      if (c.kind === 'jaws') this._toCamera(c);
      else this._flat(c);
    }
    if (c.ink !== 'fire') this._dress(c.ink);
    this.live++;
    return c.id;
  }

  flare(id, k) {
    const c = this._get(id);
    if (!c || !Number.isFinite(k)) return;
    c.k = clamp01(k);
    // a rise to full power is the release: the flash
    if (c.k >= 0.999 && c.kPrev < 0.999) {
      c.flashT = 0;
      this._release(c);
    }
    c.kPrev = c.k;
  }

  end(id) {
    const c = this._get(id);
    if (!c || c.ending) return;
    c.ending = true;
    c.endT = 0;
  }

  /** Where circle `id` stands now: out.{x, y, z, r}; false when it is gone. */
  at(id, out) {
    const c = this._get(id);
    if (!c || !out) return false;
    out.x = c.x;
    out.y = c.y;
    out.z = c.z;
    out.r = c.r;
    return true;
  }

  /** The i-th of n points round its sigil ring (world): where something bursts out of it. */
  point(id, i, n, out) {
    const c = this._get(id);
    if (!c || !out) return false;
    const a = c.rot0 + ((i + 0.5) / Math.max(1, n)) * TAU, rr = c.r * I.sigilAt;
    this._map(c, Math.cos(a) * rr, Math.sin(a) * rr, 0);
    out.x = this._p.x;
    out.y = this._p.y;
    out.z = this._p.z;
    return true;
  }

  reset() {
    for (const c of this.list) c.alive = false;
    this.live = 0;
  }

  update(dt) {
    if (this.live <= 0) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    let n = 0;
    for (const c of this.list) {
      if (!c.alive) continue;
      c.t += step;
      c.flashT += step;
      if (c.ending) c.endT += step;
      if (c.t >= c.dur && !c.ending) {
        c.ending = true;
        c.endT = 0;
      }
      if (c.ending && c.endT >= I.tail) {
        c.alive = false;
        continue;
      }
      n++;
      if (c.follow) this._toJaws(c);
      else if (c.under) this._toRoot(c);
      else if (c.kind === 'jaws') this._toCamera(c);
      try {
        this._draw(c, step);
      } catch (err) {
        c.alive = false;
        console.error('[incantation] draw failed', err);
      }
    }
    this.live = n;
  }

  // ---------------------------------------------------------------- placement
  _get(id) {
    for (const c of this.list) if (c.alive && c.id === id) return c;
    return null;
  }

  _flat(c) {
    c.ux = 1;
    c.uy = 0;
    c.uz = 0;
    c.vx = 0;
    c.vy = 0;
    c.vz = 1;
  }

  _toRoot(c) {
    const p = this.d.position;
    if (!p || !Number.isFinite(p.x + p.z)) return;
    c.x = p.x;
    c.z = p.z;
  }

  _toJaws(c) {
    const pt = this.d.rig?.pt, m = pt?.mouth, f = pt?.headFwd;
    if (!m || !f || !Number.isFinite(m.x + m.y + m.z + f.x + f.z)) return;
    const fl = Math.hypot(f.x, f.z) || 1, off = I.jawOffset * SCALE;
    c.x = m.x + (f.x / fl) * off;
    c.y = Math.max(c.r * 0.75, m.y + f.y * off * 0.5);
    c.z = m.z + (f.z / fl) * off;
    this._toCamera(c);
  }

  /** A seal in the air faces the camera (seen edge on it is one white-hot bar): u, v = its axes. */
  _toCamera(c) {
    const A = this._fx?._axes?.();
    if (!A) return;
    c.ux = A.rx;
    c.uy = A.ry;
    c.uz = A.rz;
    c.vx = A.ux;
    c.vy = A.uy;
    c.vz = A.uz;
  }

  /** Circle-plane (u, v) m + lift h -> world (this._p). Ground: u = x, v = z, at the ground height. */
  _map(c, u, v, h) {
    const P = this._p;
    if (c.kind === 'ground') {
      P.x = c.x + u;
      P.y = c.y + I.groundY + h;
      P.z = c.z + v;
    } else {
      P.x = c.x + c.ux * u + c.vx * v;
      P.y = c.y + c.uy * u + c.vy * v;
      P.z = c.z + c.uz * u + c.vz * v;
    }
    return P;
  }

  /** Dress the field's void slot for the script's ink (once per page: a level is its own load). */
  _dress(ink) {
    if (this._inkSet === ink) return;
    const f = this.game.fx?.fire;
    if (!f?.setPalette) return;
    const pal = ink === 'blood' ? FIRE_PALETTES.glareDeep : { ...FIRE_PALETTES.fire, ...I.ink };
    if (pal && f.setPalette('void', pal)) this._inkSet = ink;
  }

  // ---------------------------------------------------------------- drawing
  _kind(c) {
    return c.ink === 'fire' ? K_FIRE : K_VOID;
  }

  /** The heat a line burns at now (x its own flicker share `w`). */
  _heat(c, w) {
    const out = c.ending ? Math.max(0, 1 - c.endT / I.tail) : 1;
    const flash = c.flashT < I.flash ? 1 - c.flashT / I.flash : 0;
    const base = I.heat[0] + (I.heat[1] - I.heat[0]) * c.k;
    const fl = 1 + I.flicker * (Math.sin(c.t * 9.1 + w * 17) * 0.6 + Math.sin(c.t * 23.7 + w * 5) * 0.4);
    let h = (base * fl + (I.heatFlare - base) * flash) * out;
    if (c.kind === 'ground') h *= I.groundGain;
    else h *= I.jawGain; // (a small seal: its lines lie close and add up)
    return h;
  }

  /** One line of the seal, (u0, v0) -> (u1, v1) in its plane, drawn up to share `s` of its length. */
  _seg(c, u0, v0, u1, v1, s, heat, kind) {
    const fx = this._fx;
    if (!fx || !(s > 0) || !(heat > 0.04)) return;
    const ue = u0 + (u1 - u0) * Math.min(1, s), ve = v0 + (v1 - v0) * Math.min(1, s);
    const a = this._map(c, u0, v0, 0), ax = a.x, ay = a.y, az = a.z;
    const b = this._map(c, ue, ve, 0);
    fx._ink(ax, ay, az, b.x, b.y, b.z, 0, heat, 0, heat, 0, kind);
  }

  /** A ring of radius rr, written round from angle a0 up to share `s` of the way, in `n` segments. */
  _ring(c, rr, a0, s, n, heat, kind) {
    const fx = this._fx;
    if (!fx || !(s > 0)) return;
    const m = Math.max(1, Math.ceil(n * Math.min(1, s)));
    const span = TAU * Math.min(1, s);
    let pu = Math.cos(a0) * rr, pv = Math.sin(a0) * rr;
    for (let i = 1; i <= m; i++) {
      const a = a0 + (span * i) / m, u = Math.cos(a) * rr, v = Math.sin(a) * rr;
      const p = this._map(c, pu, pv, 0), px = p.x, py = p.y, pz = p.z;
      const q = this._map(c, u, v, 0);
      fx._ink(px, py, pz, q.x, q.y, q.z, 0, heat, 0, heat, i > 1 ? 1 : 0, kind);
      pu = u;
      pv = v;
    }
  }

  _draw(c, dt) {
    const fx = this._fx;
    if (!fx || !this.game.fx?.fire) return;
    const low = (this.game.settings?.quality ?? 2) === 0; // (the LOW preset: CONFIG.quality[0], a phone's default)
    const kind = this._kind(c);
    const life = Math.max(0.2, c.dur);
    const w = clamp01(c.t / Math.max(0.15, life * I.write)); // written so far
    const r = c.r;
    const jaws = c.kind === 'jaws';
    const segs = Math.max(12, Math.round((low ? I.segsLow : I.segs) * (jaws ? 0.7 : 1)));
    const spin0 = c.rot0 + c.t * I.spin[0], spin1 = c.rot1 + c.t * I.spin[1];
    const hR = this._heat(c, 0.1);
    // the outer ring and the band's inner ring (written round from the hero's side of it)
    this._ring(c, r, spin0, w * 1.35, segs, hR, kind);
    this._ring(c, r * I.band, -spin0, w * 1.2 - 0.12, Math.round(segs * 0.8), hR * 0.8, kind);
    // the sigils between them
    const ns = jaws ? I.jawSigils : I.sigils;
    const stand = c.look === 'b' && !jaws;
    const size = stand ? I.standSize : r * I.sigilSize;
    for (let i = 0; i < ns; i++) {
      const on = w * (ns + 3) - i * 1.0 - 1; // they appear one by one as it is written
      if (on <= 0) break;
      const hs = this._heat(c, i * 0.37 + c.seed);
      const shape = SIGILS[(i * 5 + (c.id | 0)) % SIGILS.length];
      const a = spin0 + ((i + 0.5) / ns) * TAU;
      const cu = Math.cos(a) * r * I.sigilAt, cv = Math.sin(a) * r * I.sigilAt;
      if (stand) this._sigilStanding(c, shape, cu, cv, size, Math.min(1, on), hs * 1.05, kind);
      else this._sigilFlat(c, shape, cu, cv, a, size, Math.min(1, on), hs * 1.25, kind);
    }
    // the seven-point star and the small ring at its heart
    const ws = clamp01(w * 1.6 - 0.45);
    if (ws > 0) {
      const hS = this._heat(c, 0.71) * 0.8, rs = r * I.star;
      for (let i = 0; i < STAR; i++) {
        const a0 = spin1 + (i / STAR) * TAU, a1 = spin1 + (((i + STAR_STEP) % STAR) / STAR) * TAU;
        this._seg(c, Math.cos(a0) * rs, Math.sin(a0) * rs, Math.cos(a1) * rs, Math.sin(a1) * rs, ws, hS, kind);
      }
      if (!low || jaws) this._ring(c, r * I.heart, spin1, ws, jaws ? 10 : 14, hS, kind);
    }
    this._licks(c, dt, low);
  }

  /** A sigil lying on the circle's plane at (cu, cv), its up pointing out from the centre. */
  _sigilFlat(c, shape, cu, cv, a, size, s, heat, kind) {
    const ox = Math.cos(a), oy = Math.sin(a); // out of the circle (the sigil's up)
    const rx = oy, ry = -ox; // along the ring (its right)
    for (let j = 0; j < shape.length; j++) {
      const sg = shape[j], sj = clamp01(s * shape.length - j);
      if (sj <= 0) break;
      const u0 = cu + (rx * sg[0] + ox * sg[1]) * size, v0 = cv + (ry * sg[0] + oy * sg[1]) * size;
      const u1 = cu + (rx * sg[2] + ox * sg[3]) * size, v1 = cv + (ry * sg[2] + oy * sg[3]) * size;
      this._seg(c, u0, v0, u1, v1, sj, heat, kind);
    }
  }

  /** A sigil standing up at (cu, cv) on the ground ring, facing the camera (look b). */
  _sigilStanding(c, shape, cu, cv, size, s, heat, kind) {
    const fx = this._fx;
    const A = fx._axes();
    const base = this._map(c, cu, cv, 0), bx = base.x, by = c.y + I.standY, bz = base.z;
    // (a hover: each sigil rises and sinks a little on its own beat)
    const hov = Math.sin(c.t * 1.7 + cu * 0.9 + cv * 0.4) * 0.12;
    for (let j = 0; j < shape.length; j++) {
      const sg = shape[j], sj = clamp01(s * shape.length - j);
      if (sj <= 0) break;
      const x1 = sg[0] + (sg[2] - sg[0]) * sj, y1 = sg[1] + (sg[3] - sg[1]) * sj;
      fx._ink(
        bx + (A.rx * sg[0] + A.ux * sg[1]) * size, by + hov + (A.ry * sg[0] + A.uy * sg[1]) * size, bz + (A.rz * sg[0] + A.uz * sg[1]) * size,
        bx + (A.rx * x1 + A.ux * y1) * size, by + hov + (A.ry * x1 + A.uy * y1) * size, bz + (A.rz * x1 + A.uz * y1) * size,
        0, heat, 0, heat, 0, kind,
      );
    }
  }

  /** Tongues of fire climbing off the lines while it burns (more as it charges; a burst as it ends). */
  _licks(c, dt, low) {
    const fx = this._fx;
    const rate = I.licks * (0.35 + c.k) * (c.ending ? 3 * Math.max(0, 1 - c.endT / I.tail) : 1) * (low ? 0.5 : 1);
    c.lickAcc += rate * dt;
    let i = 0;
    while (c.lickAcc >= 1 && i++ < 12) {
      c.lickAcc -= 1;
      const h1 = hash(c.t * 13.1 + i, c.id), h2 = hash(c.t * 7.7 + i * 3, c.id + 5);
      const a = h1 * TAU, rr = c.r * (h2 < 0.6 ? 1 : h2 < 0.85 ? I.band : I.star * (0.4 + h2 * 0.6));
      const p = this._map(c, Math.cos(a) * rr, Math.sin(a) * rr, 0);
      fx._blob(p.x, p.y, p.z, 0, 0.6 + h2, 0, 0.3 + 0.25 * h1, 0.45, 0.8, 0.5 + 0.3 * c.k, 0.05, K_FIRE, 0.5, 2.2);
    }
  }

  /** The release: the whole seal flares, a crisp ring runs out from it, embers spring off the lines. */
  _release(c) {
    const fx = this._fx;
    if (!fx) return;
    const kind = this._kind(c);
    const n = c.kind === 'jaws' ? 18 : 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + hash(i, c.id) * 0.2, rr = c.r * (0.85 + 0.2 * hash(i, c.id + 9));
      const p = this._map(c, Math.cos(a) * rr, Math.sin(a) * rr, 0);
      const ox = p.x - c.x, oz = p.z - c.z, ol = Math.hypot(ox, oz) || 1;
      fx._blob(p.x, p.y, p.z, (ox / ol) * 2.5, 2.4 + 2 * hash(c.id, i), (oz / ol) * 2.5, 0.4 + 0.25 * hash(i, 3), 0.7, 1.6, 0.8, 0.05, kind, 1.5, 3);
    }
    // the air rings (steel, an echo of the roar) and a light
    const p = this._map(c, 0, 0, 0);
    if (c.kind === 'ground') this.d.fx?.tells?._airRipple?.(c.x, c.z, 0.9, c.r * 0.5, c.r * 1.3, 0.35, 0.8, 0.7);
    this.d.fx?._light?.({ x: p.x, y: p.y + 1, z: p.z, color: [1, 0.45, 0.15], intensity: 5, radius: c.r * 2.2, life: 0.35, fade: 0.3 });
  }
}
