import * as THREE from 'three';
import { DIM } from './model.js';

// Glyph-particle effects owned by the Wanderer: cyan slash arcs (the light swings, the slam, the
// cleave and its impact), the thrust's long streak, the slam's crystal-shard burst, the violet gem's glow + glints, impact
// sparks, dust, heal glow, burn flames, hurt spray, and the defence set — parry burst, block
// sparks, guard-break shards, Ghostep afterimage + streak, charge gather / ready glint, crit-window
// motes. Every glyph used here is in the world atlas.

const R = (a, b) => a + Math.random() * (b - a);

const COL = {
  trail: [0.4, 1.25, 2.3], trailEnd: [0.02, 0.14, 0.45], // icy cyan arcs
  trailHeavy: [0.55, 1.6, 2.9], trailCore: [1.1, 2.1, 3.1],
  arcCore: [1.5, 2.1, 2.8], arcGlint: [3.0, 3.5, 4.3], // the sword arc's edge line (white-hot) and its glint
  arcVeil: [0.3, 0.95, 2.2], arcEnd: [0.14, 0.1, 0.8], // its veil, and the indigo everything cools to as it fades
  shard: [0.9, 1.9, 4.2], shardEnd: [0.1, 0.25, 1.0], // blue crystal burst
  gem: [1.7, 0.5, 3.4], gemEnd: [0.45, 0.08, 0.9], gemCore: [3.4, 2.2, 4.6], // violet
  spark: [3.4, 2.7, 1.6], sparkEnd: [1.4, 0.45, 0.1],
  crit: [2.2, 2.8, 4.2], critEnd: [0.3, 0.55, 1.4],
  flash: [4.2, 3.6, 2.6],
  dust: [0.2, 0.18, 0.14], dustEnd: [0.09, 0.08, 0.065],
  grassBit: [0.16, 0.26, 0.12], grassBitEnd: [0.05, 0.09, 0.04], // torn grass kicked up by a slide
  heal: [1.3, 1.9, 0.55], healEnd: [0.25, 0.6, 0.12],
  flame: [3.0, 1.35, 0.32], flameEnd: [0.9, 0.12, 0.02],
  ash: [0.34, 0.035, 0.028], ashEnd: [0.1, 0.012, 0.01],
  hurt: [2.2, 1.8, 1.6], hurtEnd: [0.6, 0.15, 0.08],
  parry: [4.0, 3.4, 2.2], parryEnd: [1.6, 0.9, 0.25],
  parryBlue: [1.6, 2.6, 4.6], parryBlueEnd: [0.25, 0.6, 1.8],
  moon: [2.6, 3.4, 4.8], moonEnd: [0.3, 0.7, 1.9], // the moonlit blade's steel light (deflect slash)
  block: [2.3, 2.0, 1.5], blockEnd: [0.7, 0.35, 0.1],
  break: [1.5, 1.5, 1.6], breakEnd: [0.3, 0.3, 0.38],
  ghost: [1.3, 1.75, 2.6], ghostEnd: [0.12, 0.25, 0.75],
  ghostCore: [2.6, 3.0, 3.8],
  charge: [0.7, 1.7, 3.0], chargeEnd: [0.2, 0.5, 1.6],
  halo: [0.2, 0.6, 1.0], haloEnd: [0.02, 0.1, 0.25], // the blade's dot halo
  tipStreak: [0.4, 1.1, 1.9], // the edge-wave past the point
  gemGlow: [0.6, 0.15, 1.4], // the gem's always-on glow point
};

// The sword arc's looks (ADR-077). The arc is drawn off the STEEL: `at` is where its edge line runs
// along the hit segment (0 = the hilt … 1 = the end of the gameplay reach, 1.9 m out; the drawn
// steel's point is at ARC_STEEL). It ran at 1: a crescent twice the sword's length, whose end dipped
// under the grass on a low cut and whose glint flashed on the ground a metre past the point.
//   edge   the edge line's stroke size (m; the stroke is a sliver of it wide)
//   life   s the edge hangs in the air
//   veil   rows inside the edge: [fraction of `at`, opacity]
//   ghost  opacity of the blade's afterimages (0 = none): faint copies of the steel left behind it
//   motes  specks of light shed off the point per frame (at most)
export const ARC_STYLES = {
  // one fine line of light off the point, and nothing else
  line: { at: 0.6, edge: 0.11, life: [0.22, 0.3], veil: [], ghost: 0, motes: 1 },
  // the line with a short faint veil inside it: a thin crescent, pointed at both ends
  crescent: { at: 0.64, edge: 0.11, life: [0.2, 0.27], veil: [[0.94, 0.3], [0.88, 0.2], [0.82, 0.12], [0.76, 0.06]], ghost: 0, motes: 1 },
  // afterimages of the blade itself fanned out behind it, under a faint line
  ghost: { at: 0.5, edge: 0.08, life: [0.14, 0.2], veil: [], ghost: 0.34, motes: 0 },
};
export const ARC_DEFAULT = 'crescent';
const ARC_STEEL = 0.44; // the drawn steel's point along the hit segment (heroDims: drawnTip / bladeTip + REACH.tipExt)
const ARC_HEAVY = 1.22; // the slam's and the cleave's arc reaches this much further out
const ARC_TURN = [0.03, 0.2]; // rad the blade turns in a frame: below, no arc; above, the full one
const TRAIL_SUB_LEN = 0.11; // m of the edge's travel per trail sub-step (short: the line bends smoothly) …
const TRAIL_SUB_MAX = 14; // … up to this many sub-steps a frame
// the swept blade between two frames: hilt lerped, direction slerped round it, length lerped
const ARC = { ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, n0: [0, 0, 1], n1: [0, 0, 1], l0: 1, l1: 1, th: 0, s: 1 };
const ARC_P = [0, 0, 0], ARC_Q = [0, 0, 0];
function arcSetup(pa, pb, a, b) {
  ARC.ax = pa.x; ARC.ay = pa.y; ARC.az = pa.z;
  ARC.dx = a.x - pa.x; ARC.dy = a.y - pa.y; ARC.dz = a.z - pa.z;
  const ux = pb.x - pa.x, uy = pb.y - pa.y, uz = pb.z - pa.z, vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  ARC.l0 = Math.hypot(ux, uy, uz) || 1e-6;
  ARC.l1 = Math.hypot(vx, vy, vz) || 1e-6;
  const n0 = ARC.n0, n1 = ARC.n1;
  n0[0] = ux / ARC.l0; n0[1] = uy / ARC.l0; n0[2] = uz / ARC.l0;
  n1[0] = vx / ARC.l1; n1[1] = vy / ARC.l1; n1[2] = vz / ARC.l1;
  const c = Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]));
  ARC.th = Math.acos(c);
  ARC.s = Math.sin(ARC.th);
}
/** Point f (0 hilt … 1 tip) of the swept blade at sub-step t (0 last frame … 1 now) → o. */
function arcPoint(t, f, o) {
  let w0 = 1 - t, w1 = t;
  if (ARC.th > 0.02 && ARC.th < 2.8) {
    w0 = Math.sin((1 - t) * ARC.th) / ARC.s;
    w1 = Math.sin(t * ARC.th) / ARC.s;
  }
  const n0 = ARC.n0, n1 = ARC.n1;
  let x = n0[0] * w0 + n1[0] * w1, y = n0[1] * w0 + n1[1] * w1, z = n0[2] * w0 + n1[2] * w1;
  const l = Math.hypot(x, y, z) || 1;
  const len = (ARC.l0 + (ARC.l1 - ARC.l0) * t) * f / l;
  o[0] = ARC.ax + ARC.dx * t + x * len;
  o[1] = ARC.ay + ARC.dy * t + y * len;
  o[2] = ARC.az + ARC.dz * t + z * len;
}
const TRAIL_NONE = [];
// the halftone dot fields sit on a world lattice so their dots line up like the panel's grid
const LATTICE = 0.12;
// screen axes of the fixed camera (pitch 58°): right = +X, up ≈ (0, cos 58°, −sin 58°)
const UP_Y = 0.53, UP_Z = -0.85;
// the rendering camera's matrixWorld elements (columns: right, up): glyph particles are screen
// billboards, so a stroke laid along a world direction needs the real camera's axes. The game
// camera is the fixed 58° one, but the Lab's model views look from any angle (there the fixed
// basis turned the tip streak and the sweep strokes into stray bars across the blade).
let CAM = null;
/** Screen-space rotation that lays a '|' glyph along world direction (dx, dy, dz). */
const alongRot = (dx, dy, dz) => {
  if (CAM) {
    const sx = dx * CAM[0] + dy * CAM[1] + dz * CAM[2], sy = dx * CAM[4] + dy * CAM[5] + dz * CAM[6];
    if (sx * sx + sy * sy > 1e-12 && Number.isFinite(sx + sy)) return Math.atan2(sy, sx) - Math.PI / 2;
  }
  return Math.atan2(dy * UP_Y + dz * UP_Z, dx) - Math.PI / 2;
};

// a parry's sparks are born this many s along their way (the freeze-frame shows them mid-burst)
const PRE = 0.045;
// colours near the contact, kept below the bloom's blow-out (a freeze-frame holds them for 0.1 s+)
const CENTER = [2.4, 2.2, 1.8];
const MOON_SOFT = [1.7, 2.2, 3.0];
// the parry shockwave's rings (shockwave): bright, but not so hot that bloom swallows the duel
const RING = { white: [1.5, 1.55, 1.75], warm: [1.6, 1.3, 0.8], gold: [2.0, 1.45, 0.45] };

export class PlayerFx {
  constructor(game, rig) {
    this.arcStyle = ARC_DEFAULT; // the sword arc's look (ARC_STYLES); player.js sets it from debug.arcStyle
    this.game = game;
    this.rig = rig;
    this._v = new THREE.Vector3();
    this.flameAcc = 0;
    this.healAcc = 0;
    this.chargeAcc = 0;
    this.critAcc = 0;
    this.gemAcc = 0;
    this.haloAcc = 0;
    this.gemGlowAcc = 0;
    this.tipAcc = 0;
    this.skidAcc = [0, 0]; // per sliding contact (skid)
    this.scrapeAcc = 0;
    this.plAcc = 0; // the plunge's hang motes / ride embers
  }

  get add() {
    CAM = this.game.camera?.matrixWorld?.elements ?? null; // every spawner starts here (alongRot)
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

  /** Where the arc's edge runs along the hit segment for a swing of `kind` (0 hilt … 1 reach end). */
  arcAt(kind = 'light') {
    const S = ARC_STYLES[this.arcStyle] ?? ARC_STYLES[ARC_DEFAULT];
    return Math.min(1, S.at * (kind === 'slam' || kind === 'cleave' ? ARC_HEAVY : 1));
  }

  /**
   * The sword arc (ADR-077; its look: ARC_STYLES[this.arcStyle]). Fills the gap between last
   * frame's blade (pa→pb) and this one's (a→b) with:
   *  - the EDGE: one fine line of light just past the steel's point, laid along its path in strokes
   *    that overlap, white-hot as it is drawn and cooling to indigo as it thins away: the cut hangs
   *    in the air for a moment as a drawn line, its tail tapering to nothing;
   *  - the VEIL (crescent): two or three faint rows inside the line, close to it;
   *  - GHOSTS (ghost): faint copies of the steel itself where it was a moment ago;
   *  - MOTES: a speck of light shed off the point now and then.
   * The arc is the blade TURNING: its strength follows how far the blade turned this frame (`gate`),
   * so it swells and tapers with the cut and a blade merely carried along (a dash, a lunge) leaves
   * none. kind: 'light' | 'slam' | 'cleave' (both reach further and hang longer) | 'thrust' (the
   * edge only: thrustStreak draws the beam).
   * (Session 25: a line at the end of the reach with a four-row veil, in place of a slab of bright
   * strokes under a rim of letters. Session 26, owner: "make the sword trail effect look way cooler
   * and more subtle": that veil was still a glowing band half the reach wide, its edge was a row of
   * dashes, and it ran a metre past the steel.)
   */
  trail(pa, pb, a, b, kind = 'light', crit = false, gate = true) {
    const fx = this.add;
    if (!fx) return;
    const S = ARC_STYLES[this.arcStyle] ?? ARC_STYLES[ARC_DEFAULT];
    const cleave = kind === 'cleave';
    const heavy = kind === 'slam' || cleave;
    const thrust = kind === 'thrust';
    arcSetup(pa, pb, a, b);
    const turn = gate ? Math.min(1, Math.max(0, (ARC.th - ARC_TURN[0]) / (ARC_TURN[1] - ARC_TURN[0]))) : 1;
    if (!(turn > 0.02) || !Number.isFinite(turn)) return;
    const at = this.arcAt(kind);
    // sub-steps follow the edge's travel (a fast frame sweeps a metre), each stroke covering its own
    // and a little of the next, so the line is unbroken at any speed
    const tipStep = Math.hypot(b.x - pb.x, b.y - pb.y, b.z - pb.z) * at;
    const nSub = Math.min(TRAIL_SUB_MAX, Math.max(2, Math.ceil(tipStep / TRAIL_SUB_LEN)));
    const core = crit ? COL.crit : COL.arcCore, veil = crit ? COL.crit : COL.arcVeil;
    const end = crit ? COL.critEnd : COL.arcEnd;
    const linger = cleave ? 1.7 : heavy ? 1.3 : 1;
    const rows = thrust ? TRAIL_NONE : S.veil;
    for (let s = 1; s <= nSub; s++) {
      const t = s / nSub, t0 = (s - 1) / nSub;
      // the edge
      arcPoint(t, at, ARC_P);
      arcPoint(t0, at, ARC_Q);
      let dx = ARC_P[0] - ARC_Q[0], dy = ARC_P[1] - ARC_Q[1], dz = ARC_P[2] - ARC_Q[2];
      let step = Math.hypot(dx, dy, dz);
      if (step > 0.01) {
        const size = S.edge * (heavy ? 1.25 : 1) * (0.6 + 0.4 * turn);
        fx.spawn({
          x: (ARC_P[0] + ARC_Q[0]) / 2, y: (ARC_P[1] + ARC_Q[1]) / 2, z: (ARC_P[2] + ARC_Q[2]) / 2,
          life: R(S.life[0], S.life[1]) * linger, size, sizeEnd: size * 0.15,
          glyph: '|', rot: alongRot(dx, dy, dz), stretch: Math.min(30, (step / size) * 1.7),
          color: core, colorEnd: end, alpha: 0.45 + 0.55 * turn, alphaEnd: 0, drag: 2,
        });
      }
      // the veil
      for (let k = 0; k < rows.length; k++) {
        const f = at * (rows[k][0] + R(-0.015, 0.015));
        arcPoint(t, f, ARC_P);
        arcPoint(t0, f, ARC_Q);
        dx = ARC_P[0] - ARC_Q[0];
        dy = ARC_P[1] - ARC_Q[1];
        dz = ARC_P[2] - ARC_Q[2];
        step = Math.hypot(dx, dy, dz);
        if (!(step > 0.02)) continue;
        const size = heavy ? 0.12 : 0.1;
        fx.spawn({
          x: (ARC_P[0] + ARC_Q[0]) / 2, y: (ARC_P[1] + ARC_Q[1]) / 2, z: (ARC_P[2] + ARC_Q[2]) / 2,
          life: R(0.08, 0.13) * linger, size, sizeEnd: size * 0.4,
          glyph: '|', rot: alongRot(dx, dy, dz), stretch: Math.min(24, (step / size) * 1.5),
          color: veil, colorEnd: end, alpha: rows[k][1] * turn, alphaEnd: 0, drag: 2.5,
        });
      }
      // the blade's afterimages: the steel where it was, from the guard to the point
      if (S.ghost > 0 && !thrust && (s & 1) === (nSub & 1)) {
        arcPoint(t, 0.04, ARC_Q);
        arcPoint(t, ARC_STEEL * (heavy ? 1.1 : 1), ARC_P);
        dx = ARC_P[0] - ARC_Q[0];
        dy = ARC_P[1] - ARC_Q[1];
        dz = ARC_P[2] - ARC_Q[2];
        step = Math.hypot(dx, dy, dz);
        if (step > 0.05) {
          const size = 0.1;
          fx.spawn({
            x: (ARC_P[0] + ARC_Q[0]) / 2, y: (ARC_P[1] + ARC_Q[1]) / 2, z: (ARC_P[2] + ARC_Q[2]) / 2,
            life: R(0.1, 0.15) * linger, size, sizeEnd: size * 0.6,
            glyph: '|', rot: alongRot(dx, dy, dz), stretch: Math.min(30, (step / size) * 1.5),
            color: veil, colorEnd: end, alpha: S.ghost * turn, alphaEnd: 0, drag: 3,
          });
        }
      }
    }
    // motes off the point, carried on along the cut
    const n = thrust ? 0 : S.motes + (heavy ? 1 : 0);
    const tx = b.x - pb.x, ty = b.y - pb.y, tz = b.z - pb.z, tl = Math.hypot(tx, ty, tz) || 1;
    for (let i = 0; i < n; i++) {
      if (Math.random() > turn * 0.7) continue;
      arcPoint(Math.random(), at * R(0.9, 1), ARC_P);
      const sp = R(0.5, 2);
      fx.spawn({
        x: ARC_P[0], y: ARC_P[1], z: ARC_P[2],
        vx: (tx / tl) * sp + R(-0.3, 0.3), vy: (ty / tl) * sp + R(-0.1, 0.5), vz: (tz / tl) * sp + R(-0.3, 0.3),
        life: R(0.26, 0.46) * Math.sqrt(linger), size: R(0.06, 0.1), sizeEnd: 0.03,
        glyph: "·'`.", color: core, colorEnd: end, alpha: 0.85, alphaEnd: 0, drag: 3, gravity: -1.2,
      });
    }
  }

  /** The glint as a cut comes through: a small four-point star on the arc's edge for a few frames
   *  and a pinch of sparks thrown on along the cut (dx, dy, dz: the point's travel). Once a swing
   *  (player.js, at the arc's edge: arcAt). */
  arcGlint(x, y, z, dx = 0, dy = 0, dz = 0, heavy = false, crit = false) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    const core = crit ? COL.ghostCore : COL.arcGlint, c1 = crit ? COL.critEnd : COL.arcEnd;
    const size = heavy ? 0.4 : 0.26;
    fx.spawn({ x, y, z, life: 0.09, size, sizeEnd: size * 0.2, glyph: '+', rot: R(0.5, 1.1), color: core, colorEnd: c1, alpha: 0.95, alphaEnd: 0 });
    const l = Math.hypot(dx, dy, dz) || 1, n = heavy ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const sp = R(2.5, 6);
      fx.spawn({
        x, y, z,
        vx: (dx / l) * sp + R(-1.2, 1.2), vy: (dy / l) * sp + R(-0.6, 1.4), vz: (dz / l) * sp + R(-1.2, 1.2),
        life: R(0.14, 0.26), size: R(0.07, 0.11), sizeEnd: 0.03, glyph: "·'", color: core, colorEnd: c1,
        alpha: 0.95, alphaEnd: 0, drag: 4, gravity: -2,
      });
    }
  }

  /** A thrust's (the execution's, the plunge's) long cyan beam along the point's path (from → to, world): a thin
   *  white-cyan core of '-' / '=' laid along the line with a '·' halo, lingering as one line behind
   *  the lunge; k = charge 0..1. */
  thrustStreak(from, to, k = 0, crit = false) {
    const fx = this.add;
    if (!fx) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-3) || !Number.isFinite(len) || len > 8) return;
    const rot = alongRot(dx, dy, dz) + Math.PI / 2; // '-' laid along the line
    const col = crit ? COL.crit : COL.trailCore;
    const n = Math.min(24, Math.max(1, Math.ceil(len / 0.1)));
    for (let i = 0; i < n; i++) {
      const f = (i + Math.random()) / n;
      const size = R(0.16, 0.2) * (1 + 0.2 * k);
      const x = from.x + dx * f, y = from.y + dy * f, z = from.z + dz * f;
      fx.spawn({
        x, y, z,
        vx: (dx / len) * R(0.1, 0.5), vy: 0, vz: (dz / len) * R(0.1, 0.5),
        life: R(0.3, 0.42) * (1 + 0.3 * k), size, sizeEnd: size * 0.6, stretch: 1.6,
        glyph: '-=', rot, color: col, colorEnd: COL.trailEnd, alpha: 0.95, alphaEnd: 0, drag: 2,
      });
      if (Math.random() < 0.5) {
        const L = LATTICE * 0.75;
        const side = Math.random() < 0.5 ? -1 : 1;
        fx.spawn({
          x: Math.round(x / L) * L, y: Math.round((y + side * R(0.05, 0.1)) / L) * L, z: Math.round(z / L) * L,
          life: R(0.3, 0.45), size: 0.09, sizeEnd: 0.04,
          glyph: '·', color: COL.trail, colorEnd: COL.trailEnd, alpha: 0.8, alphaEnd: 0,
        });
      }
    }
  }

  /** The slam's ground impact: 10–14 kite crystal shards fanned up and out across ~160° (mostly in
   *  the plane facing the camera), a few big crystals standing for a moment, dark rock debris, a
   *  cyan ground ring ~1.2 m across, a cold flash + light. */
  slamShards(x, z, crit = false) {
    const fx = this.add;
    if (fx) {
      const c0 = crit ? COL.crit : COL.shard, c1 = crit ? COL.critEnd : COL.shardEnd;
      // the fan of kite shards
      const nS = 12;
      for (let i = 0; i < nS; i++) {
        const ph = ((i + 0.5) / nS - 0.5) * 2.8 + R(-0.1, 0.1); // −80° … +80° from vertical
        const sp = R(2.4, 4.6);
        const vx = Math.sin(ph) * sp, vy = Math.cos(ph) * sp * 1.15;
        fx.spawn({
          x: x + Math.sin(ph) * 0.15, y: R(0.05, 0.2), z: z + R(-0.15, 0.15),
          vx, vy, vz: R(-0.6, 0.6),
          life: R(0.4, 0.6), size: R(0.14, 0.34), sizeEnd: 0.06, stretch: 0.6,
          glyph: 'A^V', rot: alongRot(vx, vy, 0), spin: R(-2, 2),
          color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, gravity: -11, drag: 1.2,
        });
      }
      // crystals jutting from the ground, leaning outward
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + R(-0.25, 0.25);
        const r = R(0.3, 0.9);
        const size = R(0.38, 0.62) * (1.2 - r * 0.3);
        fx.spawn({
          x: x + Math.cos(a) * r, y: size * 0.45, z: z + Math.sin(a) * r,
          vy: R(0.2, 0.5), life: R(0.4, 0.6), size, sizeEnd: size * 0.6,
          glyph: 'A^', rot: -Math.cos(a) * 0.45, stretch: 0.5,
          color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 3,
        });
      }
      // ground ring ~1.2 m across
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        fx.spawn({
          x: x + Math.cos(a) * 0.25, y: 0.08, z: z + Math.sin(a) * 0.25,
          vx: Math.cos(a) * 3.2, vz: Math.sin(a) * 3.2,
          life: 0.3, size: 0.2, sizeEnd: 0.08,
          glyph: '-~', rot: -a, color: c0, colorEnd: c1, alpha: 0.9, alphaEnd: 0, drag: 5,
        });
      }
      fx.spawn({ x, y: 0.3, z, life: 0.14, size: 1.6, sizeEnd: 0.5, glyph: '*', color: COL.trailCore, colorEnd: c0, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
      fx.spawn({ x, y: 0.2, z, life: 0.2, size: 1.0, sizeEnd: 2.2, glyph: '°', color: c0, colorEnd: c1, alpha: 0.7, alphaEnd: 0 });
    }
    // dark rock debris thrown 0.3–0.8 m
    const fa = this.alpha;
    if (fa) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, sp = R(0.8, 2.2);
        fa.spawn({
          x: x + Math.cos(a) * 0.15, y: 0.08, z: z + Math.sin(a) * 0.15,
          vx: Math.cos(a) * sp, vy: R(1.5, 3.2), vz: Math.sin(a) * sp,
          life: R(0.4, 0.6), size: R(0.08, 0.14), sizeEnd: 0.06,
          glyph: '#%&', color: COL.dust, colorEnd: COL.dustEnd, alpha: 1, alphaEnd: 0, gravity: -12, drag: 1, spin: R(-5, 5),
        });
      }
    }
    this.dust(x, z, 10, 1.3);
    this._light({ x, y: 0.6, z, color: [0.35, 0.75, 1.5], intensity: 4.5, radius: 7, life: 0.35, fade: 0.3 });
  }

  /** A small violet four-point glint ON the gem (s 0..1 = size / brightness): a white-hot core
   *  star, short-lived (≤ 0.16 s) and moving with the gem's own velocity (vx, vy, vz), so it never
   *  floats off the hilt. */
  gemGlint(x, y, z, s = 0.5, vx = 0, vz = 0, vy = 0) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z + vx + vy + vz)) return;
    const k = Math.max(0.2, Math.min(1.2, s));
    fx.spawn({ x, y, z, vx, vy, vz, life: 0.16, size: 0.22 * k + 0.08, sizeEnd: 0.05, glyph: '+', color: COL.gemCore, colorEnd: COL.gem, alpha: 1, alphaEnd: 0, rot: 0.785, spin: 3 });
    fx.spawn({ x, y, z, vx, vy, vz, life: 0.1, size: 0.12 * k + 0.06, sizeEnd: 0.18 * k + 0.08, glyph: '°', color: COL.gem, colorEnd: COL.gemEnd, alpha: 0.5, alphaEnd: 0 });
  }

  /** The gem's steady glow: an always-on violet glow point (~0.24 m: a 3–4 px violet dot at the
   *  game camera) plus a few motes, kept alive at the hilt (k 0..1.5 = strength). */
  gemTick(dt, x, y, z, k, vx = 0, vz = 0, vy = 0) {
    const fx = this.add;
    if (!fx || !(k > 0) || !Number.isFinite(x + y + z + vx + vy + vz)) return;
    this.gemGlowAcc += dt;
    if (this.gemGlowAcc >= 0.03) {
      this.gemGlowAcc = 0;
      const s = 0.22 + 0.04 * Math.min(1, k);
      fx.spawn({ x, y, z, vx, vy, vz, life: 0.06, size: s, sizeEnd: s, glyph: '•', color: COL.gemGlow, colorEnd: COL.gemGlow, alpha: 0.5, alphaEnd: 0.35 });
    }
    this.gemAcc += dt * (8 + 30 * k);
    while (this.gemAcc >= 1) {
      this.gemAcc -= 1;
      fx.spawn({
        x: x + R(-0.015, 0.015), y: y + R(-0.015, 0.015), z: z + R(-0.015, 0.015),
        vx, vy: vy + R(0, 0.15), vz, life: R(0.06, 0.1), size: R(0.06, 0.1) * (0.8 + 0.4 * k), sizeEnd: 0.04,
        glyph: '•', color: COL.gem, colorEnd: COL.gemEnd, alpha: 0.5, alphaEnd: 0.15,
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

  /**
   * The charged cleave bites: a ring bursting out of the contact in the camera's plane, a fan of long
   * cyan-white streaks thrown on along the cut's way (dx, dz), and a cold flash of light; k = charge.
   */
  cleaveImpact(x, y, z, dx, dz, k = 0, crit = false) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    this.shockwave(x, y, z, k > 0.5);
    const c0 = crit ? COL.crit : COL.trailCore, c1 = crit ? COL.critEnd : COL.trailEnd;
    const base = Math.atan2(dz, dx), n = 10 + Math.round(8 * k);
    for (let i = 0; i < n; i++) {
      const a = base + R(-1.1, 1.1), sp = R(7, 14) * (1 + 0.3 * k);
      const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = R(-1, 5);
      fx.spawn({
        x, y, z, vx, vy, vz,
        life: R(0.16, 0.3), size: R(0.2, 0.3), sizeEnd: 0.05, glyph: '-=', rot: alongRot(vx, vy, vz) + Math.PI / 2, stretch: 2.2,
        color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 3.5,
      });
    }
    this._light({ x, y, z, color: crit ? [0.6, 0.8, 1.3] : [0.55, 0.85, 1.25], intensity: 4 + 2 * k, radius: 7, life: 0.2, fade: 0.18 });
  }

  /** Charged heavy's release: a short ground gust ring of dust and glints around the feet. */
  release(x, z, k) {
    this.dust(x, z, 6 + Math.round(8 * k), 0.8 + 0.8 * k);
  }

  /**
   * Parry (deflect): a bright white-gold clash at the blade (blue-tinted for blue tells) + a ring of
   * streaks. `chain` = the deflect chain count (player.deflect): each deflect in rhythm clashes
   * bigger and brighter, with a crossed pair of sparking streaks; (dx, dz) = toward the blow.
   */
  parry(x, y, z, blue, chain = 1, dx = 0, dz = 0) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    // the blade point is sampled from the pose BEFORE the parry snaps up (the idle blade hangs low):
    // keep the clash at a blade's height, and its light well off the floor (a light ~0.3 m above the
    // paving blows it out into a white disc, worse with every parry of a long string)
    const ly = Math.max(1, y);
    y = Math.max(0.75, y);
    const c0 = blue ? COL.parryBlue : COL.parry, c1 = blue ? COL.parryBlueEnd : COL.parryEnd;
    const n = Math.max(1, Math.min(6, Number.isFinite(chain) ? chain : 1));
    const k = 1 + 0.16 * (n - 1);
    const fdx = Number.isFinite(dx) ? dx : 0, fdz = Number.isFinite(dz) ? dz : 0;
    for (let i = 0; i < Math.round(26 * k); i++) {
      const a = (i / 26) * Math.PI * 2 + R(-0.12, 0.12);
      const sp = R(3, 7) * (0.9 + 0.1 * k);
      // the clash sprays back toward the blow and up; born a step along their way (PRE s), so the
      // parry's freeze-frame shows a burst frozen in the air, not every spark stacked on the contact
      const vx = Math.cos(a) * sp + fdx * 2, vy = R(-1, 3.5) + 0.5 * (n - 1), vz = Math.sin(a) * sp + fdz * 2, pre = R(0.5, 1) * PRE;
      fx.spawn({
        x: x + vx * pre, y: y + vy * pre, z: z + vz * pre,
        vx, vy, vz,
        life: R(0.16, 0.34) * (0.9 + 0.1 * k), size: R(0.18, 0.3), sizeEnd: 0.04,
        glyph: '+x*×', color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, gravity: -6, drag: 3.5, spin: R(-8, 8),
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fx.spawn({
        x: x + Math.cos(a) * (0.15 + 9 * k * PRE), y, z: z + Math.sin(a) * (0.15 + 9 * k * PRE),
        vx: Math.cos(a) * 9 * k, vy: 0, vz: Math.sin(a) * 9 * k,
        life: 0.12, size: 0.3, sizeEnd: 0.1, stretch: 2.5, rot: -a,
        glyph: '-', color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 10,
      });
    }
    if (n >= 2) {
      // a chained deflect: two crossed streaks of steel light through the contact (an X on screen,
      // laid along the rendering camera's axes)
      const rx = CAM ? CAM[0] : 1, ry = CAM ? CAM[1] : 0, rz = CAM ? CAM[2] : 0;
      const ux = CAM ? CAM[4] : 0, uy = CAM ? CAM[5] : UP_Y, uz = CAM ? CAM[6] : UP_Z;
      for (let d = 0; d < 2; d++) {
        const s = d ? -0.785 : 0.785, cs = Math.cos(s), sn = Math.sin(s);
        for (let j = -3; j <= 3; j++) {
          if (!j) continue;
          const o = j * 0.12 * k;
          fx.spawn({
            x: x + o * (cs * rx + sn * ux), y: y + o * (cs * ry + sn * uy), z: z + o * (cs * rz + sn * uz),
            life: 0.1 + 0.02 * Math.abs(j), size: 0.26, sizeEnd: 0.08,
            glyph: '-', rot: s, stretch: 2.2, color: CENTER, colorEnd: c1, alpha: 1, alphaEnd: 0,
          });
        }
      }
    }
    // the moonlit blade's own light: one cold slash of steel through the contact on every deflect
    // (laid along a screen diagonal, alternating with the chain), and sparks that fall, still lit
    {
      const rx = CAM ? CAM[0] : 1, ry = CAM ? CAM[1] : 0, rz = CAM ? CAM[2] : 0;
      const ux = CAM ? CAM[4] : 0, uy = CAM ? CAM[5] : UP_Y, uz = CAM ? CAM[6] : UP_Z;
      const s = (n % 2 ? 0.62 : -0.62) + R(-0.12, 0.12), cs = Math.cos(s), sn = Math.sin(s);
      for (let j = -5; j <= 5; j++) {
        const o = j * 0.15 * k;
        fx.spawn({
          x: x + o * (cs * rx + sn * ux), y: y + o * (cs * ry + sn * uy), z: z + o * (cs * rz + sn * uz),
          life: 0.16 - 0.012 * Math.abs(j), size: 0.3 - 0.03 * Math.abs(j), sizeEnd: 0.05,
          glyph: '-', rot: s, stretch: 2.6, color: MOON_SOFT, colorEnd: COL.moonEnd, alpha: 1, alphaEnd: 0,
        });
      }
      for (let i = 0; i < Math.round(9 * k); i++) {
        const a = R(0, Math.PI * 2), sp = R(1.5, 5);
        const vx = Math.cos(a) * sp + fdx * 3, vy = R(2.5, 7), vz = Math.sin(a) * sp + fdz * 3, pre = R(0.5, 1) * PRE;
        fx.spawn({
          x: x + vx * pre, y: y + vy * pre, z: z + vz * pre,
          vx, vy, vz,
          life: R(0.5, 0.9), size: R(0.13, 0.22), sizeEnd: 0.03,
          glyph: ".'`•", color: i % 3 ? c0 : COL.moon, colorEnd: i % 3 ? c1 : COL.moonEnd, alpha: 1, alphaEnd: 0, gravity: -16, drag: 0.9, flicker: 0.3,
        });
      }
    }
    // (the core flash stays compact: the wyrm's own parry burst lands on the same spot, and two big
    // blooms hid the hero's deflect snap for a few frames)
    fx.spawn({ x, y, z, life: 0.08, size: 0.7 * Math.min(k, 1.3), sizeEnd: 0.2, glyph: '*', color: [2.6, 2.3, 1.7], colorEnd: c0, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
    fx.spawn({ x, y, z, life: 0.12, size: 0.5 * Math.min(k, 1.3), sizeEnd: 1.0 * Math.min(k, 1.3), glyph: '°', color: c1, colorEnd: c1, alpha: 0.4, alphaEnd: 0 });
    // (the light barely grows with the chain: the wyrm's own parry light lands on top of it)
    this._light({ x, y: ly, z, color: blue ? [0.5, 0.75, 1.3] : [1.2, 1.0, 0.65], intensity: 4.5 * (1 + 0.05 * (n - 1)), radius: 7, life: 0.2, fade: 0.18 });
  }

  /**
   * A blade's parry, layered on the clash (player.js _parry): a white shockwave ring in the screen's
   * plane bursting out of the contact (`big`: blue or perfect, wider, a second slower ring), a hard
   * white core flash; `perfect` adds a gold ring and a spray of gold sparks.
   */
  shockwave(x, y, z, big = false, perfect = false) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    const rx = CAM ? CAM[0] : 1, ry = CAM ? CAM[1] : 0, rz = CAM ? CAM[2] : 0;
    const ux = CAM ? CAM[4] : 0, uy = CAM ? CAM[5] : UP_Y, uz = CAM ? CAM[6] : UP_Z;
    // (the ring is born already open: the parry's freeze-frame holds it there, a crisp ring round the
    // clash; born at the centre, its strokes stacked into one blooming white blot for the whole freeze)
    const rings = big ? [[0.55, 1.9, 0.2, 20, RING.white], [0.42, 1.2, 0.28, 14, perfect ? RING.gold : RING.warm]] : [[0.48, 1.4, 0.18, 16, RING.white]];
    for (const [R0, R1, life, n, col] of rings) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const dx = rx * ca + ux * sa, dy = ry * ca + uy * sa, dz = rz * ca + uz * sa;
        const sp = (R1 - R0) / life;
        fx.spawn({
          x: x + dx * R0, y: y + dy * R0, z: z + dz * R0, vx: dx * sp, vy: dy * sp, vz: dz * sp,
          life, size: 0.17, sizeEnd: 0.06, glyph: '-', rot: a + Math.PI / 2, stretch: 1.4,
          color: col, colorEnd: COL.parryEnd, alpha: 1, alphaEnd: 0, drag: 1.5,
        });
      }
    }
    // (no core of its own: parry() has one, and stacked cores bloom into a white blot that hides
    // both fighters through the freeze-frame)
    if (perfect) {
      for (let i = 0; i < 14; i++) {
        const a = R(0, Math.PI * 2), sp = R(5, 10);
        fx.spawn({
          x, y, z, vx: (rx * Math.cos(a) + ux * Math.sin(a)) * sp, vy: (ry * Math.cos(a) + uy * Math.sin(a)) * sp + R(0, 2), vz: (rz * Math.cos(a) + uz * Math.sin(a)) * sp,
          life: R(0.18, 0.3), size: R(0.18, 0.28), sizeEnd: 0.04, glyph: "*+'", color: [4.2, 2.9, 0.9], colorEnd: [1.4, 0.5, 0.1], alpha: 1, alphaEnd: 0, drag: 3,
        });
      }
    }
  }

  /**
   * A perfect parry of a bullet (ADR-051): a gold star on the blade and a fan of gold sparks thrown
   * back along the shot's way out (dx, dz = toward the blow), on top of the usual clash.
   */
  perfectParry(x, y, z, dx = 0, dz = 0) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    const fdx = Number.isFinite(dx) ? dx : 0, fdz = Number.isFinite(dz) ? dz : 0;
    fx.spawn({ x, y, z, life: 0.16, size: 1.5, sizeEnd: 0.3, glyph: '*', color: [4.6, 3.4, 1.2], colorEnd: [2.0, 0.9, 0.2], alpha: 1, alphaEnd: 0, rot: R(0, 3), spin: 3 });
    for (let i = 0; i < 16; i++) {
      const a = Math.atan2(fdz, fdx) + R(-0.7, 0.7), sp = R(6, 12);
      fx.spawn({
        x, y, z,
        vx: Math.cos(a) * sp, vy: R(0.5, 4), vz: Math.sin(a) * sp,
        life: R(0.18, 0.32), size: R(0.2, 0.32), sizeEnd: 0.04,
        glyph: "*+'", color: [4.2, 2.9, 0.9], colorEnd: [1.4, 0.5, 0.1], alpha: 1, alphaEnd: 0, drag: 3, gravity: -5,
      });
    }
    this._light({ x, y, z, color: [1.3, 0.95, 0.45], intensity: 5, radius: 7, life: 0.22, fade: 0.2 });
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
    this._afterimage(fx, segs, nSegs);
    // streak from the old spot to the new one
    const sx = nx - ox, sz = nz - oz;
    const dist = Math.hypot(sx, sz);
    if (dist > 0.3 && Number.isFinite(dist)) {
      const rot = alongRot(sx, 0, sz) + Math.PI / 2; // '-' laid along the ground path
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

  /** The cold blue-white afterimage: strokes along each bone of the pose sampled before a blink
   *  (`segs`: flat [ax, ay, az, bx, by, bz, ...] world segments), oriented to their screen direction. */
  _afterimage(fx, segs, nSegs) {
    for (let s = 0; s < nSegs; s++) {
      const k = s * 6;
      const ax = segs[k], ay = segs[k + 1], az = segs[k + 2];
      const dx = segs[k + 3] - ax, dy = segs[k + 4] - ay, dz = segs[k + 5] - az;
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 1e-3) || !Number.isFinite(len + ax + ay + az)) continue;
      const rot = alongRot(dx, dy, dz);
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
  }

  // ------------------------------------------------------------------ the plunge (player.js)
  /**
   * The plunge's blink: the afterimage at the dodge spot (ox, oz), a cold streak rising from it to
   * the hang point above the head (nx, ny, nz: the root there) and the reappear burst round him.
   */
  plungeBlink(segs, nSegs, ox, oz, nx, ny, nz) {
    const fx = this.add;
    if (!fx || !Number.isFinite(ox + oz + nx + ny + nz)) return;
    this._afterimage(fx, segs, nSegs);
    // the rising streak, laid along the 3D path (it reads as the way he went)
    const sx = nx - ox, sy = ny + 0.4, sz = nz - oz;
    const dist = Math.hypot(sx, sy, sz);
    if (dist > 0.3 && dist < 60) {
      const rot = alongRot(sx, sy, sz) + Math.PI / 2;
      const n = Math.min(70, Math.round(dist / 0.16));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        fx.spawn({
          x: ox + sx * f + R(-0.1, 0.1), y: 0.9 + sy * f + R(-0.1, 0.1), z: oz + sz * f + R(-0.1, 0.1),
          vx: (sx / dist) * R(0.3, 1.2), vy: (sy / dist) * R(0.3, 1.2), vz: (sz / dist) * R(0.3, 1.2),
          life: R(0.25, 0.5) * (0.45 + 0.55 * f), size: R(0.18, 0.26), sizeEnd: 0.05, stretch: 1.5,
          glyph: '-=~·', rot: rot + R(-0.1, 0.1), color: COL.ghost, colorEnd: COL.ghostEnd,
          alpha: 0.85, alphaEnd: 0, drag: 2.5,
        });
      }
    }
    // reappear: motes collapsing onto him + a cold core flash
    const cy = ny + 1.0;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2, r = R(0.7, 1.1);
      const ex = Math.cos(a) * r, ey = R(-0.6, 0.7), ez = Math.sin(a) * r;
      fx.spawn({
        x: nx + ex, y: cy + ey, z: nz + ez, vx: -ex * 2.4, vy: -ey * 2.4, vz: -ez * 2.4,
        life: R(0.28, 0.4), size: R(0.14, 0.22), sizeEnd: 0.04,
        glyph: '·+°', color: COL.ghost, colorEnd: COL.ghostEnd, alpha: 1, alphaEnd: 0, drag: 2, flicker: 0.3,
      });
    }
    // (short: it runs in the slow-mo, and a long flare hid him for most of the hang)
    fx.spawn({ x: nx, y: cy, z: nz, life: 0.1, size: 1.7, sizeEnd: 0.4, glyph: '+', color: COL.ghostCore, colorEnd: COL.ghost, alpha: 1, alphaEnd: 0, rot: 0.785 });
    this._light({ x: nx, y: cy, z: nz, color: [0.55, 0.78, 1.4], intensity: 3, radius: 6, life: 0.3, fade: 0.25, fadeIn: 0.02 });
  }

  /** The hang at the apex: cold motes drawn in onto him (x, y, z: his chest). */
  plungeHang(dt, x, y, z) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    this.plAcc += dt * 60;
    while (this.plAcc >= 1) {
      this.plAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = R(0.6, 1.2);
      const ex = Math.cos(a) * r, ey = R(-0.7, 0.9), ez = Math.sin(a) * r;
      const life = R(0.16, 0.26);
      fx.spawn({
        x: x + ex, y: y + ey, z: z + ez, vx: -ex / life, vy: -ey / life, vz: -ez / life,
        life, size: R(0.09, 0.15), sizeEnd: 0.03, glyph: "·'.+", color: COL.charge, colorEnd: COL.chargeEnd, alpha: 0.85, alphaEnd: 0.1,
      });
    }
  }

  /**
   * The blade meets the head (x, y, z: the wound): a white-cyan flash, cold crystal shards fanned
   * up and out, molten blood thrown up from the wyrm, a shock ring round the skull, two lights.
   * (dx, dz) = his spring-off side; exec: the execution (bigger, gold-white).
   */
  plungeImpact(x, y, z, dx, dz, exec = false) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    const k = exec ? 1.35 : 1;
    const c0 = exec ? COL.parry : COL.shard, c1 = exec ? COL.parryEnd : COL.shardEnd;
    fx.spawn({ x, y: y + 0.3, z, life: 0.16, size: 3.2 * k, sizeEnd: 0.6, glyph: '*', color: COL.flash, colorEnd: COL.trailCore, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
    fx.spawn({ x, y: y + 0.2, z, life: 0.3, size: 1.4 * k, sizeEnd: 4.2 * k, glyph: '°', color: COL.trailCore, colorEnd: COL.shardEnd, alpha: 0.85, alphaEnd: 0 });
    // the crystal fan: kite shards up and out all round
    const nS = Math.round(16 * k);
    for (let i = 0; i < nS; i++) {
      const a = (i / nS) * Math.PI * 2 + R(-0.15, 0.15), up = R(0.35, 1.25), sp = R(3.5, 7) * k;
      const vx = Math.cos(a) * sp * Math.cos(up), vy = Math.sin(up) * sp, vz = Math.sin(a) * sp * Math.cos(up);
      fx.spawn({
        x: x + Math.cos(a) * 0.25, y: y + 0.1, z: z + Math.sin(a) * 0.25, vx, vy, vz,
        life: R(0.4, 0.7), size: R(0.2, 0.42) * k, sizeEnd: 0.06, stretch: 0.6,
        glyph: 'A^V', rot: alongRot(vx, vy, vz), spin: R(-2, 2),
        color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, gravity: -12, drag: 1.1,
      });
    }
    // molten blood: hot embers thrown up out of the wound, falling back
    for (let i = 0; i < Math.round(26 * k); i++) {
      const a = Math.random() * Math.PI * 2, sp = R(1.5, 6);
      fx.spawn({
        x, y: y + 0.1, z, vx: Math.cos(a) * sp * 0.6 + dx * 1.2, vy: R(3, 9), vz: Math.sin(a) * sp * 0.6 + dz * 1.2,
        life: R(0.4, 0.85), size: R(0.15, 0.3), sizeEnd: 0.05,
        glyph: "*^~'", color: COL.flame, colorEnd: COL.flameEnd, alpha: 1, alphaEnd: 0, gravity: -14, drag: 0.8, spin: R(-5, 5),
      });
    }
    // the shock ring round the skull
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      fx.spawn({
        x: x + Math.cos(a) * 0.4, y: y + 0.15, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * 7 * k, vz: Math.sin(a) * 7 * k,
        life: 0.28, size: 0.28, sizeEnd: 0.1, stretch: 1.6, glyph: '-~', rot: -a, color: c0, colorEnd: c1, alpha: 1, alphaEnd: 0, drag: 6,
      });
    }
    // white-gold sparks off the steel
    this.sparks(x, y + 0.2, z, dx, dz, true, exec);
    // (kept small: a big light here turns the whole wyrm's ASCII art white)
    this._light({ x, y: y + 0.6, z, color: [0.7, 0.95, 1.5], intensity: 3 * k, radius: 6, life: 0.25, fade: 0.22 });
    this._light({ x, y: y + 0.3, z, color: [1.4, 0.5, 0.15], intensity: 2.2 * k, radius: 5, life: 0.6, fade: 0.5 });
  }

  /** Riding the head: embers spurting from the wound round the buried blade (k 0..1 = strength). */
  plungeRide(dt, x, y, z, dx, dz, k = 1) {
    const fx = this.add;
    if (!fx || !(k > 0) || !Number.isFinite(x + y + z)) return;
    this.plAcc += dt * 70 * k;
    while (this.plAcc >= 1) {
      this.plAcc -= 1;
      const a = Math.random() * Math.PI * 2, sp = R(0.5, 2.5);
      const cold = Math.random() < 0.25;
      fx.spawn({
        x: x + R(-0.15, 0.15), y: y + R(0, 0.2), z: z + R(-0.15, 0.15),
        vx: Math.cos(a) * sp - dx * 0.8, vy: R(2, 6), vz: Math.sin(a) * sp - dz * 0.8,
        life: R(0.3, 0.6), size: R(0.12, 0.24), sizeEnd: 0.04,
        glyph: cold ? "·'" : "*^~'", color: cold ? COL.crit : COL.flame, colorEnd: cold ? COL.critEnd : COL.flameEnd,
        alpha: 1, alphaEnd: 0, gravity: -11, drag: 1, spin: R(-4, 4),
      });
    }
  }

  /** The blade ripped out of the head as he springs off: a gout of embers and a cold flick. */
  plungeRip(x, y, z, dx, dz) {
    const fx = this.add;
    if (!fx || !Number.isFinite(x + y + z)) return;
    for (let i = 0; i < 18; i++) {
      const sp = R(2, 6);
      fx.spawn({
        x, y: y + 0.2, z, vx: dx * sp + R(-1.5, 1.5), vy: R(3, 7), vz: dz * sp + R(-1.5, 1.5),
        life: R(0.35, 0.7), size: R(0.15, 0.28), sizeEnd: 0.05,
        glyph: "*^~'", color: COL.flame, colorEnd: COL.flameEnd, alpha: 1, alphaEnd: 0, gravity: -13, drag: 0.8, spin: R(-5, 5),
      });
    }
    fx.spawn({ x, y: y + 0.4, z, life: 0.12, size: 1.3, sizeEnd: 0.3, glyph: '*', color: COL.trailCore, colorEnd: COL.trail, alpha: 1, alphaEnd: 0, rot: R(0, 3) });
    this._light({ x, y: y + 0.5, z, color: [1.3, 0.55, 0.2], intensity: 3, radius: 6, life: 0.3, fade: 0.25 });
  }

  /** Touchdown in front of the head: a dust ring, a low cold ring, a puff where he slides. */
  plungeLand(x, z, dx, dz) {
    const fa = this.alpha, fx = this.add;
    if (!Number.isFinite(x + z)) return;
    if (fa) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        fa.spawn({
          x: x + Math.cos(a) * 0.3, y: 0.06, z: z + Math.sin(a) * 0.3,
          vx: Math.cos(a) * 2.2 + dx * 1.2, vy: R(0.1, 0.5), vz: Math.sin(a) * 2.2 + dz * 1.2,
          life: R(0.45, 0.7), size: R(0.16, 0.24), sizeEnd: 0.4,
          glyph: '.,:', color: COL.dust, colorEnd: COL.dustEnd, alpha: 0.85, alphaEnd: 0, drag: 3,
        });
      }
    }
    if (fx) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        fx.spawn({
          x: x + Math.cos(a) * 0.2, y: 0.08, z: z + Math.sin(a) * 0.2, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3,
          life: 0.26, size: 0.18, sizeEnd: 0.06, glyph: '-~', rot: -a, color: COL.trail, colorEnd: COL.trailEnd, alpha: 0.85, alphaEnd: 0, drag: 5,
        });
      }
    }
    this.dust(x, z, 8, 1.1);
  }

  /** Charging: cold motes drawn in toward the blade, and past half charge jagged cyan lightning
   *  strokes ('/' '\' '^', 0.1–0.3 m) crawling along the blade and round the hands (rate and
   *  brightness scale with k 0..1). */
  chargeTick(dt, a, b, k) {
    const fx = this.add;
    if (!fx || !(k >= 0)) return;
    this.chargeAcc += dt * (10 + 40 * k);
    while (this.chargeAcc >= 1) {
      this.chargeAcc -= 1;
      const f = R(0.3, 1);
      const px = a.x + (b.x - a.x) * f, py = a.y + (b.y - a.y) * f, pz = a.z + (b.z - a.z) * f;
      if (k > 0.45 && Math.random() < 0.35 + 0.4 * k) {
        // a lightning stroke hugging the blade
        const g = R(0, 0.85);
        fx.spawn({
          x: a.x + (b.x - a.x) * g + R(-0.08, 0.08), y: a.y + (b.y - a.y) * g + R(-0.06, 0.1), z: a.z + (b.z - a.z) * g + R(-0.08, 0.08),
          life: R(0.08, 0.18), size: R(0.12, 0.24) * (0.8 + 0.4 * k), sizeEnd: 0.06, rot: R(-0.6, 0.6),
          glyph: "/\\^'", color: COL.trailCore, colorEnd: COL.charge, alpha: 1, alphaEnd: 0, flicker: 0.5,
        });
        continue;
      }
      const ang = Math.random() * Math.PI * 2, r = R(0.35, 0.8);
      const ox = Math.cos(ang) * r, oz = Math.sin(ang) * r, oy = R(-0.2, 0.5);
      const life = R(0.22, 0.34);
      fx.spawn({
        x: px + ox, y: py + oy, z: pz + oz,
        vx: -ox / life, vy: -oy / life, vz: -oz / life,
        life, size: R(0.08, 0.13) * (0.8 + 0.5 * k), sizeEnd: 0.03,
        glyph: "·'.+", color: COL.charge, colorEnd: COL.chargeEnd, alpha: 0.5 + 0.5 * k, alphaEnd: 0.1,
      });
    }
  }

  /** Full charge reached: a glint on the blade + a dust ring at the feet (x, z). */
  chargeReady(x, y, z, fx0, fz0) {
    const fx = this.add;
    if (fx) {
      fx.spawn({ x, y, z, life: 0.18, size: 0.75, sizeEnd: 0.15, glyph: '+', color: COL.ghostCore, colorEnd: COL.charge, alpha: 1, alphaEnd: 0, spin: 4 });
      fx.spawn({ x, y, z, life: 0.12, size: 0.35, sizeEnd: 0.8, glyph: '°', color: COL.charge, colorEnd: COL.chargeEnd, alpha: 0.8, alphaEnd: 0 });
    }
    const fa = this.alpha;
    if (fa && Number.isFinite(fx0 + fz0)) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        fa.spawn({
          x: fx0 + Math.cos(a) * 0.3, y: 0.06, z: fz0 + Math.sin(a) * 0.3,
          vx: Math.cos(a) * 1.6, vy: R(0.1, 0.4), vz: Math.sin(a) * 1.6,
          life: R(0.4, 0.6), size: R(0.14, 0.2), sizeEnd: 0.3,
          glyph: '.,:', color: COL.dust, colorEnd: COL.dustEnd, alpha: 0.8, alphaEnd: 0, drag: 3,
        });
      }
    }
    this._light({ x, y, z, color: [0.5, 0.75, 1.4], intensity: 2.2, radius: 4, life: 0.25, fade: 0.2 });
  }

  /**
   * The blade's halo (hero.md §3.2): a sparse field of cold '·' dots on a 0.06 m lattice beside
   * both edges, and a short dot streak 0.2–0.3 m past the steel point (the visible reach of the
   * edge wave). k = strength 0..2 (dim at idle, brighter through strikes and the charge); far
   * 0..1 = close-up … game camera (the dots grow so they still print at 36 m). The blade plane
   * comes from the sword's own matrix.
   */
  bladeHalo(dt, k, far = 1) {
    const fx = this.add;
    const sw = this.rig?.sword;
    if (!fx || !sw || !(k > 0)) return;
    const e = sw.matrixWorld.elements;
    const tip = DIM.drawnTip ?? DIM.steelTip; // the drawn point (model.js), not anim's grass-clamp point
    // the edge-wave: a short bright streak laid along the blade at the drawn point (it sat 0.06–0.26 m
    // past it, × HERO_SCALE: a dash floating off the sword, left behind by every roll and swing)
    this.tipAcc += dt * 14;
    while (this.tipAcc >= 1) {
      this.tipAcc -= 1;
      const zz = tip - R(0.05, 0.12); // the glyph is ~0.15 m long: centred here its far end stops at the point
      const x = e[8] * zz + e[12], y = e[9] * zz + e[13], z = e[10] * zz + e[14];
      const dl = Math.hypot(e[8], e[9], e[10]) || 1;
      if (!Number.isFinite(x + y + z) || y < 0.02) continue;
      fx.spawn({
        x, y, z, life: 0.07, size: 0.1 * (1 + far), sizeEnd: 0.06, glyph: '|', stretch: 1.4,
        rot: alongRot(e[8] / dl, e[9] / dl, e[10] / dl),
        color: COL.tipStreak, colorEnd: COL.halo, alpha: Math.min(1, 0.55 + 0.25 * k), alphaEnd: 0,
      });
    }
    this.haloAcc += dt * (9 + 10 * k);
    if (this.haloAcc < 1) return;
    const L = 0.06;
    while (this.haloAcc >= 1) {
      this.haloAcc -= 1;
      const past = Math.random() < 0.3;
      const zz = past ? tip + R(0.0, 0.1) : R(DIM.forte, tip);
      const xx = past ? R(-0.02, 0.02) : (Math.random() < 0.5 ? -1 : 1) * R(0.06, 0.12);
      // sword space (xx, 0, zz) → world
      const x = e[0] * xx + e[8] * zz + e[12], y = e[1] * xx + e[9] * zz + e[13], z = e[2] * xx + e[10] * zz + e[14];
      if (!Number.isFinite(x + y + z) || y < 0.02) continue;
      fx.spawn({
        x: Math.round(x / L) * L, y: Math.round(y / L) * L, z: Math.round(z / L) * L,
        life: 0.4, size: (past ? 0.09 : 0.08) * (1 + 1.2 * far), sizeEnd: 0.04, glyph: '·',
        color: COL.halo, colorEnd: COL.haloEnd, alpha: Math.min(1, 0.6 + 0.2 * k), alphaEnd: 0,
      });
    }
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

  /**
   * A sliding contact (the roll's kneel: the shin, the planted foot): a low spray of dust and torn
   * grass kicked off the ground spot (x, z), thrown back against the slide (dx, dz unit) and
   * outward, faster and denser with the slide speed sp (m/s). `slot` keeps one rate accumulator
   * per contact.
   */
  skid(dt, slot, x, z, dx, dz, sp, k = 1) {
    const fx = this.alpha;
    if (!fx || !(sp > 0.3)) return;
    const acc = this.skidAcc;
    acc[slot] += dt * 40 * k * Math.min(1.5, sp / 4);
    while (acc[slot] >= 1) {
      acc[slot] -= 1;
      const s = sp * R(0.15, 0.45), side = R(-0.9, 0.9);
      const grass = Math.random() < 0.3;
      fx.spawn({
        x: x + R(-0.08, 0.08), y: R(0.03, 0.12), z: z + R(-0.08, 0.08),
        vx: -dx * s - dz * side, vy: R(0.4, 1.5), vz: -dz * s + dx * side,
        life: R(0.3, 0.6), size: grass ? R(0.12, 0.17) : R(0.14, 0.22), sizeEnd: grass ? 0.08 : R(0.3, 0.42),
        glyph: grass ? "/\\'," : '.,:', color: grass ? COL.grassBit : COL.dust, colorEnd: grass ? COL.grassBitEnd : COL.dustEnd,
        alpha: 0.85, alphaEnd: 0, drag: 2.2, gravity: -2.4, spin: R(-4, 4),
      });
    }
  }

  /** The blade's point dragging in the grass (the roll's slide): cold sparks flicked off it, back
   *  against the slide (dx, dz unit). */
  scrape(dt, x, y, z, dx, dz, sp) {
    const fx = this.add;
    if (!fx || !(sp > 0.3)) return;
    this.scrapeAcc += dt * 30 * Math.min(1.5, sp / 4);
    while (this.scrapeAcc >= 1) {
      this.scrapeAcc -= 1;
      const s = sp * R(0.2, 0.6), side = R(-1.2, 1.2);
      const vx = -dx * s - dz * side, vy = R(0.6, 2.2), vz = -dz * s + dx * side;
      fx.spawn({
        x: x + R(-0.04, 0.04), y: y + R(0, 0.05), z: z + R(-0.04, 0.04),
        vx, vy, vz,
        life: R(0.12, 0.26), size: R(0.08, 0.14), sizeEnd: 0.03,
        glyph: "'|", rot: alongRot(vx, vy, vz), stretch: 0.8,
        color: COL.trailCore, colorEnd: COL.trailEnd, alpha: 1, alphaEnd: 0, drag: 1.5, gravity: -4,
      });
    }
  }

  reset() {
    this.flameAcc = 0;
    this.healAcc = 0;
    this.chargeAcc = 0;
    this.critAcc = 0;
    this.gemAcc = 0;
    this.haloAcc = 0;
    this.gemGlowAcc = 0;
    this.tipAcc = 0;
    this.skidAcc[0] = this.skidAcc[1] = 0;
    this.scrapeAcc = 0;
    this.plAcc = 0;
  }
}
