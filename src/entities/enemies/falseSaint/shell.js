// THE SHELL (CORE'S file; BRIEF section 4): how much of the False Saint's skin and clothes is gone, part by
// part. LOOK ONLY: no armour, no hitbox, no damage rule reads it. A sword cut that lands chips the shell
// where it lands (saint.js takeHit → chip); a phase's transition raises the floor and the limit
// (setPhase, at the transition's impact); molten steel and a transition's burn strip it (strip); a
// bonfire reset restores him whole (reset). Old damage stays. Deterministic: no random anywhere (the
// order the pieces of a part go in is a fixed hash: `order`).
//
// THE SURFACE (the body agent's look reads it; the fx agent's flakes ride its `last`):
//   exposure          0..1 the whole body (the parts' weighted mean)
//   part(name)        0..1 one part (0 whole skin and cloth ... 1 bare frame)
//   order(name, i)    0..1 a fixed hash: piece i of a part is bare when order(name, i) < part(name)
//   chip(point, k)    a cut landed at world `point` ({x, y, z}; null: the chest): the nearest part loses
//                     k of its shell, the next nearest k x spill; never past the phase's limit. Returns the
//                     exposure taken (0: nothing left to take)
//   strip(k, point?)  every part (or, with a point, the parts near it, weighted) loses k x what it has
//                     left; never past the limit. Returns the exposure taken
//   setPhase(n)       phase n: its floor (FLOORS[n]) is the least each part shows, its limit TUNING
//                     .fsShell.limit[n - 1] the most the body may; never lowers a part
//   reset()           whole again: every part 0, phase 1
//   version           bumps whenever anything changed (the look redraws only then)
//   phase, limit      the phase it was set to, the whole body's limit now
//   last              { part, x, y, z, k, version }: where the last chip / strip landed (k the exposure it
//                     took; the fx's shell flakes)
//   force(k)          (debug) every part to at least k, past the limit (the Lab's look at a bare frame)
//   state()           { exposure, phase, limit, parts: { name: v } } (the Lab, the tests)
//
// Body frame (`anchor`): x his LEFT, y up (a share of TUNING.fsShell.height), z forward; the part names
// are the BRIEF's: headR, headL, chestR, chestL, armR, foreR, handR, armL, foreL, handL, hip, legR, shinR,
// legL, shinL ("R" his right).

import { TUNING } from './tuning.js';

/** The parts: their weight in the whole body (sums to 1) and their anchor (x m, y share of his height, z m). */
export const PARTS = Object.freeze([
  { name: 'headR', w: 0.04, at: [-0.05, 0.93, 0.04] },
  { name: 'headL', w: 0.04, at: [0.05, 0.93, 0.04] },
  { name: 'chestR', w: 0.1, at: [-0.1, 0.72, 0.06] },
  { name: 'chestL', w: 0.1, at: [0.1, 0.72, 0.06] },
  { name: 'armR', w: 0.05, at: [-0.24, 0.72, 0] },
  { name: 'foreR', w: 0.04, at: [-0.3, 0.55, 0.06] },
  { name: 'handR', w: 0.02, at: [-0.32, 0.44, 0.1] },
  { name: 'armL', w: 0.05, at: [0.24, 0.72, 0] },
  { name: 'foreL', w: 0.04, at: [0.3, 0.55, 0.06] },
  { name: 'handL', w: 0.02, at: [0.32, 0.44, 0.1] },
  { name: 'hip', w: 0.14, at: [0, 0.5, 0.02] },
  { name: 'legR', w: 0.1, at: [-0.1, 0.36, 0.02] },
  { name: 'shinR', w: 0.08, at: [-0.1, 0.14, 0.02] },
  { name: 'legL', w: 0.1, at: [0.1, 0.36, 0.02] },
  { name: 'shinL', w: 0.08, at: [0.1, 0.14, 0.02] },
]);
export const PART_NAMES = Object.freeze(PARTS.map((p) => p.name));
const INDEX = Object.freeze(Object.fromEntries(PARTS.map((p, i) => [p.name, i])));

/**
 * Where each phase starts the shell (the reference's milestones; parts not named stay as they are):
 *   2 FRACTURE (~20 %): the right cheek and temple to titanium, the right forearm's skin and sleeve gone,
 *     a crack at the left collarbone
 *   3 EXPOSURE (~60 %): the right half of the head and jaw, the right chest and arm, a metal shin; a skin
 *     island on the left cheek, fabric on the left shoulder
 *   4 TRUE FRAME (~94 %): nearly all; a scrap of jacket at the left hip, skin flakes at one shoulder
 */
export const FLOORS = Object.freeze({
  1: Object.freeze({}),
  2: Object.freeze({ headR: 0.8, headL: 0.1, chestR: 0.3, chestL: 0.25, armR: 0.4, foreR: 1, handR: 0.8, legR: 0.1, shinR: 0.2 }),
  3: Object.freeze({ headR: 1, headL: 0.35, chestR: 1, chestL: 0.5, armR: 1, foreR: 1, handR: 1, armL: 0.2, foreL: 0.4, handL: 0.4, hip: 0.45, legR: 0.7, shinR: 1, legL: 0.3, shinL: 0.45 }),
  4: Object.freeze({ headR: 1, headL: 0.85, chestR: 1, chestL: 0.95, armR: 1, foreR: 1, handR: 1, armL: 0.7, foreL: 1, handL: 1, hip: 0.75, legR: 1, shinR: 1, legL: 1, shinL: 1 }),
});

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** A fixed hash of (part, piece) → [0, 1). */
function hashOrder(p, i) {
  let h = Math.imul((p + 1) * 0x9e3779b1, 0x85ebca6b) ^ Math.imul((i + 7) * 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export class FsShell {
  /** `d` the boss (his position and yaw place a cut on his body); `T` TUNING.fsShell. */
  constructor(d, T = TUNING.fsShell) {
    this.d = d;
    this.T = T;
    this.v = new Float32Array(PARTS.length);
    this.version = 0;
    this.phase = 1;
    this.exposure = 0;
    this.last = { part: '', x: 0, y: 0, z: 0, k: 0, version: 0 };
    this._dist = new Float32Array(PARTS.length);
    this._add = new Float32Array(PARTS.length);
  }

  get limit() {
    const L = this.T.limit;
    return fin(L[Math.min(L.length, Math.max(1, this.phase)) - 1], 1);
  }

  part(name) {
    const i = INDEX[name];
    return i === undefined ? 0 : this.v[i];
  }

  order(name, i) {
    const p = INDEX[name];
    return p === undefined ? 1 : hashOrder(p, i | 0);
  }

  reset() {
    this.v.fill(0);
    this.phase = 1;
    this.exposure = 0;
    this.last.k = 0;
    this.last.part = '';
    this.version++;
  }

  setPhase(n) {
    const ph = Math.max(1, Math.min(4, Math.round(fin(n, 1))));
    this.phase = ph;
    const F = FLOORS[ph] ?? {};
    for (const [name, f] of Object.entries(F)) {
      const i = INDEX[name];
      if (i !== undefined && this.v[i] < f) this.v[i] = f;
    }
    this._sum();
    this.version++;
    return this.exposure;
  }

  chip(point, k = this.T.perCut) {
    const amt = fin(k, 0);
    if (!(amt > 0)) return 0;
    this._near(point);
    // the nearest two parts
    let a = -1, b = -1;
    for (let i = 0; i < PARTS.length; i++) {
      if (a < 0 || this._dist[i] < this._dist[a]) {
        b = a;
        a = i;
      } else if (b < 0 || this._dist[i] < this._dist[b]) b = i;
    }
    this._add.fill(0);
    this._add[a] = amt;
    if (b >= 0) this._add[b] = amt * fin(this.T.spill, 0.35);
    return this._apply(a, point);
  }

  strip(k, point = null) {
    const amt = clamp01(fin(k, 0));
    if (!(amt > 0)) return 0;
    let near = -1;
    if (point) {
      this._near(point);
      for (let i = 0; i < PARTS.length; i++) if (near < 0 || this._dist[i] < this._dist[near]) near = i;
    }
    for (let i = 0; i < PARTS.length; i++) {
      // (with a point: the parts within ~0.6 m take it all, farther ones less)
      const w = point ? 1 / (1 + (this._dist[i] / 0.6) ** 2) : 1;
      this._add[i] = (1 - this.v[i]) * amt * w;
    }
    return this._apply(near, point);
  }

  force(k) {
    const f = clamp01(fin(k, 0));
    for (let i = 0; i < PARTS.length; i++) if (this.v[i] < f) this.v[i] = f;
    this._sum();
    this.version++;
    return this.exposure;
  }

  state() {
    const parts = {};
    for (let i = 0; i < PARTS.length; i++) parts[PARTS[i].name] = this.v[i];
    return { exposure: this.exposure, phase: this.phase, limit: this.limit, parts };
  }

  // ---------------------------------------------------------------- inside
  /** this._add (per part) applied, scaled down to stay inside the limit. */
  _apply(at, point) {
    let gain = 0;
    for (let i = 0; i < PARTS.length; i++) {
      this._add[i] = Math.min(this._add[i], 1 - this.v[i]);
      gain += this._add[i] * PARTS[i].w;
    }
    const room = this.limit - this.exposure;
    if (!(gain > 1e-6) || !(room > 1e-6)) return 0;
    const s = gain > room ? room / gain : 1;
    for (let i = 0; i < PARTS.length; i++) this.v[i] = clamp01(this.v[i] + this._add[i] * s);
    const before = this.exposure;
    this._sum();
    const took = this.exposure - before;
    this.version++;
    const L = this.last;
    L.part = at >= 0 ? PARTS[at].name : '';
    L.x = fin(point?.x, this.d?.position?.x ?? 0);
    L.y = fin(point?.y, 1.4);
    L.z = fin(point?.z, this.d?.position?.z ?? 0);
    L.k = took;
    L.version = this.version;
    return took;
  }

  _sum() {
    let s = 0;
    for (let i = 0; i < PARTS.length; i++) s += this.v[i] * PARTS[i].w;
    this.exposure = clamp01(s);
  }

  /** Each part's distance (m) from `point` in his body frame (no point: the chest's). */
  _near(point) {
    const d = this.d, H = fin(this.T.height, 2);
    let lx = 0, ly = 0.72 * H, lz = 0.06;
    const p = d?.position;
    if (point && p && Number.isFinite(point.x + point.y + point.z)) {
      const dx = point.x - p.x, dz = point.z - p.z, yaw = fin(d.yaw, 0);
      // (his left = (cos yaw, -sin yaw), his forward = (sin yaw, cos yaw))
      lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      ly = point.y - fin(p.y, 0);
    }
    for (let i = 0; i < PARTS.length; i++) {
      const a = PARTS[i].at;
      this._dist[i] = Math.hypot(lx - a[0], ly - a[1] * H, lz - a[2]);
    }
  }
}
