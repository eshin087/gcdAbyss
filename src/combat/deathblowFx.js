import { axes, screenAngle } from './clashFx.js';
import { LetterBatch } from '../world/life/letterBatch.js';
import { FIRE_KIND } from '../render/firePalettes.js';

// THE DEATHBLOW'S HIT EFFECT (?dbfx=a|b|c|d; default a; ?blood=0 turns the blood off). The parry streak's
// combo of N cuts calls `deathblowHit` once per blow at its contact; four looks (the owner picks), the same
// combo. Each grows a little with the blow's number `i` and is biggest on the last (the finisher).
//   a  STEEL BLOOM   a round bloom of orange heat, a line of orange letters along the blade's sweep, a spray
//                    of short orange strokes that slow to dots and fall, embers that drift down. The
//                    finisher: a bloom twice the area and a long ember fall.
//   b  SHATTER WEB   each blow leaves ONE long straight cut-line of pale steel-blue letters from where the
//                    blade came from, through him and out past him, hanging ~0.35 s; on the finisher every
//                    line still hanging snaps into letter shards that fly outward and fall.
//   c  STORM CRACK   each blow runs jagged blue lightning along the blade's sweep, crawling over the body
//                    for ~0.2 s, with branches; the finisher drops one vertical bolt from ~4 m above to
//                    the floor, then crackles out.
//   d  GOLD CRESCENT each blow leaves a crescent of gold letters ALONG THE SWORD'S OWN PATH (two rows, three
//                    on the finisher) that sweeps on a little and crumbles into falling gold embers.
//   e  WEIGHT        (the default, ADR-294) nothing hangs on the screen: a short bite of dark steel letters only
//                    where the blade crosses his body, gone in ~0.1 s, a small heat flash at the contact, and the
//                    blade going THROUGH him: its tip out of his far side and his blood thrown out of his back
//                    along the blow, falling to the floor as pools. The weight itself is the combo's timing
//                    (deathblow.js dbWeight: a hit-pause that grows, each blow driving him back, a slow finisher).
// THE SLASH IS ON THE SWORD: every look draws its cut along `o.path` (the blade tip's real positions from
// the start of the swing to its contact, ending past the contact), not at a guessed angle; without a path
// it falls back to a straight sweep through the contact along the blow's bearing.
// THE BLOOD (all looks; dark red letters, never pink, under the bloom threshold): a spray of droplets along
// the cut and out of his back that hangs nearly frozen through the hit-pause (`o.hold`) and then flies; a
// streak of red letters painted along the path across his body (a wound that follows him) that darkens and
// goes in ~0.6 s; and POOLS, where a droplet lands a small dark red mark stays on the floor until the
// fight's reset (`deathblowFxClear`). The pools are printed here, from their own LetterBatch, not through
// scars.mark: its kinds carry the set's ink, the merge and the grass tearing, none of which a pool wants.
// How it is drawn (STYLE.md "The house style", "The fire field"): the BODY of a blow is a short flash of
// heat in the fire field (`game.fx.fire`), written on whole letter cells and pulled toward the camera
// (as combat/impactStamp.js), one copy alive per frame; everything that flies or hangs is ONE house letter
// through a LetterBatch (as combat/parrySparks.js: one cell, strokes along their screen motion), colour
// under the bloom threshold (0.55 a channel), no white. NEVER the background: no dim, tint, vignette or
// flash of the screen. The effect's clock is real time, slowed to `blood.slow` while a blow's hit-pause
// runs. Noise from this module's own seeded stream (never Math.random). Pooled, no allocation per frame,
// nothing made until the first blow.

let seed = 0x3c6ef372;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const R = (a, b) => a + rnd() * (b - a);
const fin = (v) => Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

/** Glyphs this module prints (tests/glyphcheck.mjs reads every *_GLYPHS list). */
export const DEATHBLOW_FX_GLYPHS = ['-', '/', '\\', '|', "'", '.', ',', ':'];
const CHARS = DEATHBLOW_FX_GLYPHS.join('');
const G_DASH = 0, G_SLASH = 1, G_BACK = 2, G_BAR = 3, G_TICK = 4, G_DOT = 5, G_COMMA = 6, G_COLON = 7;

const OPTS = ['a', 'b', 'c', 'd', 'e'];
const q = (name) => {
  try {
    return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(name) : null;
  } catch {
    return null;
  }
};
export const DBFX_DEFAULT = 'e'; // Weight (ADR-294, the owner asked for it 2026-11-28); b: Shatter Web, the pick before
/** The switch (`?dbfx=`): read at the moment of each blow (the Lab cycles it). */
export const DB_FX = { opts: OPTS, mode: OPTS.includes(q('dbfx')) ? q('dbfx') : DBFX_DEFAULT };
export const getDbFx = () => DB_FX.mode;
export const setDbFx = (m) => (DB_FX.mode = OPTS.includes(m) ? m : DBFX_DEFAULT);
/** The blood (`?blood=0` off; on by default). Read at each blow. */
export const DB_BLOOD = { on: q('blood') !== '0' };
export const setBlood = (on) => (DB_BLOOD.on = !!on);

/**
 * The numbers. Colours are linear, at most 0.55 a channel (the bloom threshold), never near-white.
 *   ramps   colour by life (stops [t, r, g, b]); by ramp id: 0 orange, 1 gold, 2 steel-blue, 3 storm blue,
 *           4 blood (droplets and pools), 5 the wound's streak (bright, then deep red)
 *   pull    m a letter is drawn nearer the camera along its view ray (clear of the soft depth fade)
 *   max     letters alive at most (the oldest give way)
 *   flash   the heat: life (real s), px (a blob across, frame px at a 5 px cell), pull, ...
 *   blood   spray: droplets per blow (14 at the first, up to `sprayMax`; `sprayLast` the finisher's);
 *           slow: the share of the clock the effect runs at while the hit-pause holds; streak: life (s);
 *           pools: the most the floor keeps (the oldest give way); poolSoft: m of the soft depth fade
 */
export const DBFX_TUNE = Object.freeze({
  pull: 0.3,
  max: 700,
  stroke: 0.35,
  tick: 0.12,
  flash: Object.freeze({ budget: 280, life: 0.08, lifeLast: 0.1, px: 12, pull: 2.5, minY: 0.6, hero: Object.freeze({ rx: 0.24, foot: 0.05, head: 1.7, pad: 0.04 }) }),
  // the deathblow's read c (`?dbread=c|all`, ADR-264; o.clean): the flash `flash` x as wide, moved `offset` m out of
  // his far side along the blow (the wound itself left in sight) and aged on the real clock (gone in the hit-pause's
  // first frames, not held through it); the exit burst's spray `burst` x as many, its tip streak `tip` x as long and held
  // `tipHold` x as long
  clean: Object.freeze({ flash: 0.45, offset: 0.7, burst: 0.4, tip: 0.6, tipHold: 0.5 }),
  // e WEIGHT: the bite's half length along the cut (m; the finisher's), its life (s), the flash's size (frame px at
  // a 5 px cell; the finisher's), how many blood droplets the exit throws (x the exit's spray) and how fast
  weight: Object.freeze({ bite: 0.32, biteLast: 0.5, life: 0.11, lifeLast: 0.16, flash: 1.6, flashLast: 2.8, exit: 1.4, exitSpeed: 0.8 }),
  blood: Object.freeze({ spray: 14, sprayMax: 24, sprayLast: 40, slow: 0.15, streak: 0.6, streakLast: 0.8, pools: 480, poolSoft: 0.08, poolLift: 0.08 }),
  ramps: Object.freeze([
    Object.freeze([[0, 0.55, 0.27, 0.06], [0.3, 0.52, 0.17, 0.025], [0.65, 0.32, 0.07, 0.012], [1, 0.13, 0.02, 0.005]].map(Object.freeze)),
    Object.freeze([[0, 0.55, 0.4, 0.08], [0.5, 0.5, 0.27, 0.035], [1, 0.22, 0.08, 0.01]].map(Object.freeze)),
    Object.freeze([[0, 0.3, 0.42, 0.55], [0.4, 0.22, 0.32, 0.48], [1, 0.07, 0.1, 0.2]].map(Object.freeze)),
    Object.freeze([[0, 0.22, 0.45, 0.55], [0.4, 0.12, 0.28, 0.52], [1, 0.04, 0.07, 0.22]].map(Object.freeze)),
    Object.freeze([[0, 0.42, 0.04, 0.03], [1, 0.25, 0.02, 0.02]].map(Object.freeze)),
    Object.freeze([[0, 0.46, 0.06, 0.04], [0.4, 0.35, 0.035, 0.03], [1, 0.19, 0.015, 0.015]].map(Object.freeze)),
  ]),
});

/** What the effect did (tests read it; reused). */
export const DBFX_LAST = {
  hits: 0, mode: 'a', spawned: 0, alive: 0, peak: 0, flash: 0, heatCells: 0, maxCh: 0, white: 0, bad: 0, drawn: 0, snapped: 0,
  blood: 0, pools: 0, ts: 1, src: '', slash: [0, 0, 0, 0, 0, 0], pathS: [0, 0], looksSpawned: 0, clean: false,
};

// ---- the letters' pool: one record of F floats
const MAX = DBFX_TUNE.max;
const F = 18;
// 0 x 1 y 2 z 3 vx 4 vy 5 vz 6 age 7 life 8 drag 9 gravity 10 wait (s) 11 floor y 12 glyph (-1: by its
// motion) 13 ramp 14 alpha 15 kind (0 spark, 1 hanging line, 2 shard, 3 crescent, 4 ember, 5 bolt/arc/cut,
// 6 blood droplet, 7 the wound's streak) 16 fade 17 attached to the boss (x y z are offsets from him)
const D = new Float32Array(MAX * F);
let count = 0;
let holdLeft = 0; // real s of the hit-pause still to run (the clock is slowed through it)

/** A free record (full: the oldest gives way). Returns its offset. */
function take() {
  if (count < MAX) return count++ * F;
  let o = 0, best = -1;
  for (let i = 0; i < count; i++) {
    const a = D[i * F + 6] / Math.max(0.01, D[i * F + 7]);
    if (a > best) {
      best = a;
      o = i;
    }
  }
  return o * F;
}

/** One letter into the pool. Returns its offset (-1: refused). */
function add(x, y, z, vx, vy, vz, life, drag, gravity, glyph, ramp, alpha, kind, wait, floor, fade) {
  if (!fin(x + y + z + vx + vy + vz)) return -1;
  const k = take();
  D[k] = x; D[k + 1] = y; D[k + 2] = z;
  D[k + 3] = vx; D[k + 4] = vy; D[k + 5] = vz;
  D[k + 6] = 0; D[k + 7] = life; D[k + 8] = drag; D[k + 9] = gravity; D[k + 10] = wait; D[k + 11] = floor;
  D[k + 12] = glyph; D[k + 13] = ramp; D[k + 14] = alpha; D[k + 15] = kind; D[k + 16] = fade; D[k + 17] = 0;
  DBFX_LAST.spawned++;
  return k;
}

// ---- the screen (as impactStamp.js), reused
const SC = { mpp: 0.025, px: 0, py: 0, cw: 5, ch: 8, ok: false };
function screen(game, x, y, z) {
  const S = SC, cam = game.camera, p = game.pipeline;
  S.ok = false;
  S.mpp = 0.025;
  S.cw = p?.artCell?.x > 0 ? p.artCell.x : 5;
  S.ch = p?.artCell?.y > 0 ? p.artCell.y : 8;
  const W = p?.width, H = p?.height, m = cam?.matrixWorldInverse?.elements, e = cam?.projectionMatrix?.elements;
  if (!m || !e || !(W > 8) || !(H > 8)) return S;
  const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
  if (!(vz > 0.2) || !fin(vx + vy + vz) || !(e[5] > 0)) return S;
  const mpp = (2 * vz) / (H * e[5]);
  const px = (((vx * e[0]) / vz) * 0.5 + 0.5) * W, py = (((vy * e[5]) / vz) * 0.5 + 0.5) * H;
  if (!fin(mpp + px + py) || !(mpp > 1e-5)) return S;
  S.mpp = mpp;
  S.px = px;
  S.py = py;
  S.ok = true;
  return S;
}

// the plane of the screen at the contact: a point at (sx, sy) m from it (right, up on the screen)
let AX = null;
const wx = (cx, sx, sy) => cx + AX.rx * sx + AX.ux * sy;
const wy = (cy, sx, sy) => cy + AX.ry * sx + AX.uy * sy;
const wz = (cz, sx, sy) => cz + AX.rz * sx + AX.uz * sy;
/** A screen-plane velocity into the world. */
const vxw = (sx, sy) => AX.rx * sx + AX.ux * sy;
const vyw = (sx, sy) => AX.ry * sx + AX.uy * sy;
const vzw = (sx, sy) => AX.rz * sx + AX.uz * sy;

/** The stroke glyph that runs along a screen angle. */
function strokeOf(ang) {
  ang = ((ang % Math.PI) + Math.PI) % Math.PI;
  const e = Math.PI / 8;
  return ang < e || ang >= 7 * e ? G_DASH : ang < 3 * e ? G_SLASH : ang < 5 * e ? G_BAR : G_BACK;
}
/** Metres between two letters along a screen direction (one letter a column or row it crosses). */
const stepAlong = (ang, cellM, rowM) => 1 / Math.max(Math.abs(Math.cos(ang)) / cellM, Math.abs(Math.sin(ang)) / rowM, 1e-3);

// ---- the heat flashes (the body of a blow): pooled, one copy of each alive per frame
const NF = 4;
const flashes = Array.from({ length: NF }, () => ({ alive: false, x: 0, y: 0, z: 0, mpp0: 0.025, age: 0, life: 0.08, shape: 0, rad: 2, heat: 0.7, rim: 0.4, kind: 0, real: false }));
let clean = false, cleanDx = 0, cleanDz = 0; // (this blow's read c: o.clean, the blow's direction on the floor)
let fxNow = 0, deadline = -1;
const copyLife = (d) => Math.max(0.021, d * 1.6);
const B = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.02, size: 0.3, sizeEnd: 0.3, heat: 1, heatEnd: 1, kind: 0, drag: 0, gravity: 0 };
let heatBase = -1; // (the field's size when this run of flashes began)
let flashLive = 0; // (alive flashes after the newest update)

/** The cell offsets (i, j) of a flash into a reused list, shape 0: a disc of `rad` cells (a bloom, hottest
 *  at the centre), 1: a plus of arm `rad`. Returns the count. */
const MAXC = 340;
const CI = new Int16Array(MAXC), CJ = new Int16Array(MAXC), CH = new Float32Array(MAXC);
function cells(Fl, cw, ch) {
  let n = 0;
  const r = Fl.rad;
  if (Fl.shape === 0) {
    const ri = Math.ceil(r), rj = Math.ceil((r * cw) / ch);
    for (let j = -rj; j <= rj; j++) {
      for (let i = -ri; i <= ri; i++) {
        const d = Math.hypot(i * cw, j * ch) / (r * cw);
        if (d > 1 || n >= MAXC) continue;
        CI[n] = i;
        CJ[n] = j;
        CH[n++] = Fl.heat + (Fl.rim - Fl.heat) * d;
      }
    }
  } else {
    CI[n] = 0;
    CJ[n] = 0;
    CH[n++] = Fl.heat;
    const arm = Math.max(1, Math.round(r));
    for (let k = 1; k <= arm && n < MAXC - 4; k++) {
      const h = Fl.heat + (Fl.rim - Fl.heat) * (k / (arm + 1));
      CI[n] = k; CJ[n] = 0; CH[n++] = h;
      CI[n] = -k; CJ[n] = 0; CH[n++] = h;
      CI[n] = 0; CJ[n] = k; CH[n++] = h;
      CI[n] = 0; CJ[n] = -k; CH[n++] = h;
    }
  }
  return n;
}

/** Write flash Fl as heat blobs living `life` s, snapped to the letter cells. Returns the cells written. */
function drawFlash(game, Fl, life) {
  const Fire = game.fx?.fire;
  if (!Fire?.spawn) return 0;
  const T = DBFX_TUNE.flash;
  // (the heat budget: a combo's flashes add at most `T.budget` blobs to the field at any moment, counted
  // against the field's own size from before the first flash; the bulk of a look is letters, the heat only
  // the short flash cores)
  if (heatBase < 0) heatBase = Fire.count ?? 0;
  const room = T.budget - ((Fire.count ?? 0) - heatBase);
  if (room <= 0) return 0;
  AX = axes(game);
  const hp = game.player?.position;
  let hx = 0, hy = 0, hrx = 0, hry = 0;
  if (hp && fin(hp.x + hp.y + hp.z)) {
    const Q = screen(game, hp.x, hp.y + T.hero.foot, hp.z);
    const fx = Q.px, fy = Q.py, ok = Q.ok;
    screen(game, hp.x, hp.y + T.hero.head, hp.z);
    if (ok && Q.ok) {
      hx = (fx + Q.px) * 0.5;
      hy = (fy + Q.py) * 0.5;
      hrx = T.hero.rx / Q.mpp;
      hry = Math.hypot(Q.px - fx, Q.py - fy) * 0.5 + T.hero.pad / Q.mpp;
    }
  }
  const P = screen(game, Fl.x, Fl.y, Fl.z);
  const cw = P.cw, ch = P.ch, mpp = P.mpp, ok = P.ok, px = P.px, py = P.py;
  const nc = cells(Fl, cw, ch);
  let x = Fl.x, y = Fl.y, z = Fl.z;
  if (ok) {
    const ox = ((Math.floor(px / cw) + 0.5) * cw - px) * mpp, oy = ((Math.floor(py / ch) + 0.5) * ch - py) * mpp;
    x += AX.rx * ox + AX.ux * oy;
    y += AX.ry * ox + AX.uy * oy;
    z += AX.rz * ox + AX.uz * oy;
  }
  const ax0 = ok ? (Math.floor(px / cw) + 0.5) * cw : 0, ay0 = ok ? (Math.floor(py / ch) + 0.5) * ch : 0;
  B.life = life;
  B.size = B.sizeEnd = T.px * (cw / 5) * mpp;
  B.kind = Fl.kind;
  let n = 0;
  for (let k = 0; k < nc && n < room; k++) {
    if (hrx > 0 && ok) {
      const ex = (ax0 + CI[k] * cw - hx) / hrx, ey = (ay0 + CJ[k] * ch - hy) / hry;
      if (ex * ex + ey * ey < 1) continue; // (never written over the hero)
    }
    const ox = CI[k] * cw * mpp, oy = CJ[k] * ch * mpp;
    B.x = x + AX.rx * ox + AX.ux * oy;
    B.y = y + AX.ry * ox + AX.uy * oy;
    B.z = z + AX.rz * ox + AX.uz * oy;
    if (!(B.y >= T.minY) || !fin(B.x + B.z)) continue;
    B.heat = B.heatEnd = CH[k];
    if (Fire.spawn(B) >= 0) n++;
  }
  DBFX_LAST.heatCells += n;
  return n;
}

function startFlash(game, x, y, z, shape, rad, heat, rim, kind, last) {
  const T = DBFX_TUNE.flash;
  if (clean) { // (the read's clean contact: smaller, out of his far side)
    const C = DBFX_TUNE.clean;
    rad *= C.flash;
    x += cleanDx * C.offset;
    z += cleanDz * C.offset;
  }
  let S = flashes[0];
  for (const f of flashes) {
    if (!f.alive) {
      S = f;
      break;
    }
    if (f.age > S.age) S = f;
  }
  // the anchor: pulled toward the camera along the view ray (it does not move on screen)
  let ax = x, ay = y, az = z;
  const cam = game.camera?.position;
  if (cam) {
    const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z, l = Math.hypot(dx, dy, dz);
    if (l > T.pull * 1.5 && fin(l)) {
      ax += (dx / l) * T.pull;
      ay += (dy / l) * T.pull;
      az += (dz / l) * T.pull;
    }
  }
  S.alive = true;
  S.x = ax; S.y = ay; S.z = az;
  S.age = 0;
  S.life = last ? T.lifeLast : T.life;
  S.shape = shape; S.rad = rad; S.heat = heat; S.rim = rim; S.kind = kind; S.real = clean;
  const dt = Math.max(0, fin(game.fxDt) ? game.fxDt : 1 / 60);
  let life;
  if (deadline > fxNow + dt) life = deadline - fxNow;
  else {
    life = copyLife(dt);
    deadline = fxNow + life;
  }
  drawFlash(game, S, life);
}

// ---- THE SLASH'S LINE: the blade's path in the screen's plane, metres from the contact (right, up)
const MAXP = 20, MS = 200;
const LX = new Float32Array(MAXP), LY = new Float32Array(MAXP);
let LN = 0, CDA = 0; // points; the cut's direction on the screen at the contact (rad)
const SX = new Float32Array(MS), SY = new Float32Array(MS), SA = new Float32Array(MS), SU = new Float32Array(MS);
let SN = 0, SUC = 0.5; // letters placed along it; where along it (0..1) the contact is

/**
 * The cut's line: ONE clean straight cut CENTRED ON THE CONTACT, along the swing's direction at the contact.
 * The direction is the tip's motion over the last stretch of `o.path` (world points, the last at the contact),
 * in the screen's plane; without a usable path it is the bearing's perpendicular. The raw path samples are
 * never drawn (they start metres off his body). `len` m long (the web passes at least `minLen`).
 * Fills LX / LY / LN / CDA; returns true when the direction came from a path.
 */
function buildLine(o, x, y, z, bearing, last, straight, minLen) {
  const path = o.path;
  let ex = 0, ey = 0, fromPath = false;
  if (path && path.length >= 6) {
    const k = Math.min(16, Math.floor(path.length / 3));
    const ex0 = path[(k - 1) * 3] - x, ey0 = path[(k - 1) * 3 + 1] - y, ez0 = path[(k - 1) * 3 + 2] - z;
    const lx1 = ex0 * AX.rx + ey0 * AX.ry + ez0 * AX.rz, ly1 = ex0 * AX.ux + ey0 * AX.uy + ez0 * AX.uz;
    for (let p = k - 2; p >= 0; p--) {
      const ax = path[p * 3] - x, ay = path[p * 3 + 1] - y, az = path[p * 3 + 2] - z;
      if (!fin(ax + ay + az + lx1 + ly1)) continue;
      const lx = ax * AX.rx + ay * AX.ry + az * AX.rz, ly = ax * AX.ux + ay * AX.uy + az * AX.uz;
      const dx = lx1 - lx, dy = ly1 - ly, l = Math.hypot(dx, dy);
      if (l >= 0.15 || p === 0) {
        if (l > 0.02) {
          ex = dx / l;
          ey = dy / l;
          fromPath = true;
        }
        break;
      }
    }
  }
  if (!fromPath) {
    ex = -Math.sin(bearing);
    ey = Math.cos(bearing);
  }
  const len = Math.min(Math.max(straight ? minLen : 0, last ? 2.2 : 1.3), last ? 2.2 : 1.6), h = len / 2; // (kept on his body: the owner disliked long slashes across the screen)
  LX[0] = -ex * h;
  LY[0] = -ey * h;
  LX[1] = ex * h;
  LY[1] = ey * h;
  LN = 2;
  CDA = Math.atan2(ey, ex);
  return fromPath;
}

/** Letters along the line, one per cell crossed: SX / SY (m), SA the direction, SU (0..1) where along it. */
function sampleLine(cellM, rowM) {
  let total = 0, toContact = 0;
  for (let s = 0; s < LN - 1; s++) total += Math.hypot(LX[s + 1] - LX[s], LY[s + 1] - LY[s]);
  total = Math.max(total, 1e-3);
  SN = 0;
  let cum = 0, rest = 0, found = false;
  for (let s = 0; s < LN - 1; s++) {
    const dx = LX[s + 1] - LX[s], dy = LY[s + 1] - LY[s], len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const ang = Math.atan2(dy, dx), step = stepAlong(ang, cellM, rowM);
    let t = rest;
    while (t <= len && SN < MS) {
      SX[SN] = LX[s] + (dx / len) * t;
      SY[SN] = LY[s] + (dy / len) * t;
      SA[SN] = ang;
      SU[SN] = (cum + t) / total;
      SN++;
      t += step;
    }
    rest = t - len;
    cum += len;
    // (the contact: the last point before the extension, or the chord's own place)
    if (!found && Math.abs(LX[s + 1]) < 1e-6 && Math.abs(LY[s + 1]) < 1e-6) {
      toContact = cum;
      found = true;
    }
  }
  if (!found) toContact = total / 2;
  SUC = clamp(toContact / total, 0, 1);
  if (SN < MS && SN > 0 && SU[SN - 1] < 0.97) {
    SX[SN] = LX[LN - 1];
    SY[SN] = LY[LN - 1];
    SA[SN] = SA[SN - 1];
    SU[SN] = 1;
    SN++;
  }
  const L = DBFX_LAST.slash;
  if (SN) {
    L[0] = SX[0]; L[1] = SY[0]; L[2] = SX[SN - 1]; L[3] = SY[SN - 1];
    L[4] = Math.cos(CDA); L[5] = Math.sin(CDA);
  }
}

// ---- THE BLOOD
let bossP = null; // the boss's position (the wound's letters hold offsets from him)
const PCAP = DBFX_TUNE.blood.pools;
const PX = new Float32Array(PCAP), PY = new Float32Array(PCAP), PZ = new Float32Array(PCAP), PS = new Float32Array(PCAP);
const PG = new Uint8Array(PCAP);
let poolN = 0, poolHead = 0;

/** A droplet landed: a small dark red mark that stays on the floor until the reset. */
function addPool(x, y, z) {
  if (!DB_BLOOD.on || !fin(x + y + z)) return;
  const n = rnd() < 0.3 ? 2 : 1;
  for (let j = 0; j < n; j++) {
    const k = poolN < PCAP ? poolN++ : poolHead++ % PCAP;
    if (poolHead >= PCAP) poolHead = 0;
    const o = j ? R(0.05, 0.14) : 0, a = R(0, TAU);
    PX[k] = x + Math.cos(a) * o;
    PZ[k] = z + Math.sin(a) * o;
    PY[k] = y + DBFX_TUNE.blood.poolLift;
    PS[k] = R(0.1, 0.9);
    const r = rnd();
    PG[k] = r < 0.55 ? G_DOT : r < 0.82 ? G_COMMA : G_COLON;
  }
  DBFX_LAST.pools = poolN;
}

/** Blood for one blow: the wound's streak along the cut, the spray along it and out of his back. */
function blood(game, x, y, z, i, last, floor, dx, dz) {
  const T = DBFX_TUNE.blood, P = DBFX_LAST;
  bossP = game?.dragon?.position ?? null;
  const att = bossP && fin(bossP.x + bossP.y + bossP.z);
  const bx = att ? bossP.x : 0, by = att ? bossP.y : 0, bz = att ? bossP.z : 0;
  // the wound: red letters painted along the path across his body, opening along the sweep
  const slife = last ? T.streakLast : T.streak;
  const wl = last ? 0.6 : 0.5;
  for (let s = 0; s < SN; s++) {
    if (Math.hypot(SX[s], SY[s]) > wl) continue;
    const px = wx(x, SX[s], SY[s]), py = wy(y, SX[s], SY[s]), pz = wz(z, SX[s], SY[s]);
    const near = 1 - 0.4 * Math.abs(SU[s] - SUC);
    let k = add(px - bx, py - by, pz - bz, 0, 0, 0, slife * R(0.85, 1.1), 0, 0, strokeOf(SA[s]), 5, clamp(near, 0.5, 1), 7, SU[s] * 0.014, -1e9, 0.4);
    if (k >= 0) {
      D[k + 17] = att ? 1 : 0;
      if (!att) {
        D[k] += bx;
        D[k + 1] += by;
        D[k + 2] += bz;
      }
      P.blood++;
    }
    // (a second row beside it: a wound has width; the finisher's is wider)
    if (last || (s & 1) === 0) {
      const sx2 = SX[s] - Math.sin(SA[s]) * (last ? 0.07 : 0.05) * (s & 2 ? 1 : -1), sy2 = SY[s] + Math.cos(SA[s]) * (last ? 0.07 : 0.05) * (s & 2 ? 1 : -1);
      k = add(wx(x, sx2, sy2) - bx, wy(y, sx2, sy2) - by, wz(z, sx2, sy2) - bz, 0, 0, 0, slife * R(0.7, 1), 0, 0, rnd() < 0.5 ? G_DOT : G_COMMA, 5, 0.8, 7, SU[s] * 0.014 + 0.004, -1e9, 0.4);
      if (k >= 0) {
        D[k + 17] = att ? 1 : 0;
        if (!att) {
          D[k] += bx;
          D[k + 1] += by;
          D[k + 2] += bz;
        }
        P.blood++;
      }
    }
  }
  // the spray: half along the cut, half out of his back along the blow's bearing; it hangs through the
  // hit-pause (the clock slows) and then flies, arcs and lands as pools
  const ns = last ? T.sprayLast : Math.min(T.sprayMax, T.spray + Math.round((i - 1) * 1.7));
  const kk = last ? 1.2 : 1;
  const ca = CDA;
  for (let k = 0; k < ns; k++) {
    let vx, vy, vz;
    if (k & 1) {
      const fan = R(-0.55, 0.55), c = Math.cos(fan), sn = Math.sin(fan), sp = R(2, 6.5) * kk;
      vx = (dx * c - dz * sn) * sp;
      vz = (dx * sn + dz * c) * sp;
      vy = R(0, 2.6);
    } else {
      const a = ca + R(-0.55, 0.55), sp = R(2.5, 7.5) * kk, sx = Math.cos(a) * sp, sy = Math.sin(a) * sp + R(0, 1.6);
      vx = vxw(sx, sy);
      vy = vyw(sx, sy);
      vz = vzw(sx, sy);
    }
    // (from a point along the cut, on his body)
    const t = R(-0.5, 0.5) * (last ? 1.6 : 0.9), cx = Math.cos(ca) * t, cy = Math.sin(ca) * t;
    if (add(wx(x, cx, cy), wy(y, cx, cy), wz(z, cx, cy), vx, vy, vz, R(0.9, 1.3), R(0.3, 1.0), -9.8, -1, 4, 1, 6, 0, floor, 0.15) >= 0) P.blood++;
  }
}

// ---- the four looks
const FIRE = FIRE_KIND.fire, STEEL = FIRE_KIND.steel;
let snapIn = -1, snapX = 0, snapY = 0, snapZ = 0; // b: the finisher's line hangs a moment, then every line snaps

/** a: STEEL BLOOM */
function lookA(game, x, y, z, i, last, floor) {
  const rad = last ? 10 : Math.min(7, 3 + 0.75 * (i - 1));
  startFlash(game, x, y, z, 0, rad, 0.78, 0.45, FIRE, last);
  // the cut: a line of orange letters along the blade's sweep, drawn from where it came from to past him
  for (let s = 0; s < SN; s++) {
    const al = clamp(1 - 0.5 * Math.abs(SU[s] - SUC), 0.5, 1);
    add(wx(x, SX[s], SY[s]), wy(y, SX[s], SY[s]), wz(z, SX[s], SY[s]), 0, 0, 0, last ? 0.3 : 0.22, 0, 0, strokeOf(SA[s]), 0, al, 5, SU[s] * 0.02, -1e9, 0.4);
  }
  const ns = last ? 32 : Math.min(24, 15 + i);
  for (let k = 0; k < ns; k++) {
    const heavy = k < (last ? 4 : 3);
    const a = CDA + R(-0.9, 0.9);
    const sp = heavy ? R(4, 4.6) : R(4, 7.5);
    const sx = Math.cos(a) * sp, sy = Math.sin(a) * sp + R(0.2, 1.2);
    const life = heavy ? R(0.35, 0.44) : R(0.12, 0.3);
    const drag = heavy ? R(9.5, 11) : sp / R(0.12, 0.56);
    add(x, y, z, vxw(sx, sy), vyw(sx, sy), vzw(sx, sy), life, drag, heavy ? -13 : -9.8, -1, 0, 1, 0, rnd() < 0.5 ? 0 : 1 / 60, floor, 0.25);
  }
  const ne = last ? 26 : Math.min(12, 5 + i);
  for (let k = 0; k < ne; k++) {
    const a = R(0, TAU), sp = R(0.2, 1.0);
    const sx = Math.cos(a) * sp, sy = Math.sin(a) * sp * 0.5 + 0.3;
    const o = R(0, 0.25);
    add(x + vxw(Math.cos(a) * o, Math.sin(a) * o), y + vyw(Math.cos(a) * o, Math.sin(a) * o), z + vzw(Math.cos(a) * o, Math.sin(a) * o), vxw(sx, sy), vyw(sx, sy), vzw(sx, sy),
      last ? R(0.6, 0.85) : R(0.35, 0.5), 2, -1.2, rnd() < 0.5 ? G_DOT : G_COMMA, 0, 0.7, 4, R(0, 0.07), floor, 0.35);
  }
}

/** b: SHATTER WEB */
function lookB(game, x, y, z, i, last, floor) {
  startFlash(game, x, y, z, 1, last ? 5 : 2 + Math.min(1, i / 5), 0.62, 0.45, STEEL, last);
  // one straight line: from the blade's first point, through the contact, out past him (3 m and more)
  for (let s = 0; s < SN; s++) {
    const u = SU[s], al = 0.6 + 0.4 * (1 - Math.pow(Math.abs(2 * u - 1), 2));
    add(wx(x, SX[s], SY[s]), wy(y, SX[s], SY[s]), wz(z, SX[s], SY[s]), 0, 0, 0, last ? 0.42 : 0.35, 0, 0, strokeOf(SA[s]), 2, al, 1, u * 0.025, -1e9, 0.3);
    // (a glint of glass beside it)
    if ((s % 5) === 2) add(wx(x, SX[s] + R(-0.06, 0.06), SY[s] + R(-0.06, 0.06)), y + R(-0.05, 0.05), wz(z, SX[s], SY[s]), 0, 0, 0, 0.2, 0, 0, G_TICK, 2, 0.8, 1, u * 0.025 + 0.02, -1e9, 0.4);
  }
  if (last) {
    snapIn = 0.12;
    snapX = x;
    snapY = y;
    snapZ = z;
  }
}

/** e: WEIGHT. A short bite where the blade crosses him (nothing past his body), a small flash; the exit does the rest. */
function lookE(game, x, y, z, i, last, floor) {
  const W = DBFX_TUNE.weight;
  startFlash(game, x, y, z, 1, last ? W.flashLast : W.flash, 0.5, 0.35, STEEL, last);
  const half = last ? W.biteLast : W.bite, life = last ? W.lifeLast : W.life;
  for (let s = 0; s < SN; s++) {
    const d = Math.hypot(SX[s], SY[s]);
    if (d > half) continue;
    const al = clamp(1 - d / half, 0.35, 1);
    add(wx(x, SX[s], SY[s]), wy(y, SX[s], SY[s]), wz(z, SX[s], SY[s]), 0, 0, 0, life, 0, 0, strokeOf(SA[s]), 2, al, 5, SU[s] * 0.012, -1e9, 0.5);
  }
}

/** The finisher's snap: every hanging line breaks into shards that fly outward and fall. */
function snap(floor) {
  for (let i = 0; i < count; i++) {
    const k = i * F;
    if (D[k + 15] !== 1) continue;
    let dx = D[k] - snapX, dy = D[k + 1] - snapY, dz = D[k + 2] - snapZ;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const sp = R(1.4, 3.8) * (0.6 + Math.min(1, l / 2));
    D[k + 3] = dx * sp + R(-0.3, 0.3);
    D[k + 4] = dy * sp + R(0.4, 1.4);
    D[k + 5] = dz * sp + R(-0.3, 0.3);
    D[k + 6] = 0;
    D[k + 7] = R(0.35, 0.6);
    D[k + 8] = 3;
    D[k + 9] = -7;
    D[k + 10] = 0;
    D[k + 11] = floor;
    D[k + 14] = R(0.7, 1);
    D[k + 15] = 2;
    D[k + 16] = 0.4;
    if (rnd() < 0.45) D[k + 12] = rnd() < 0.5 ? G_TICK : G_DOT;
    DBFX_LAST.snapped++;
  }
}

/** c: STORM CRACK */
function lookC(game, x, y, z, i, last, floor, cellM, rowM) {
  startFlash(game, x, y, z, 1, last ? 5 : 2, last ? 0.72 : 0.58, 0.45, STEEL, last);
  // the lightning runs along the blade's sweep, jagged, crawling from where it came from through him
  let j = 0;
  for (let s = 0; s < SN; s++) {
    j = clamp(j + R(-0.06, 0.06), -0.12, 0.12);
    const a = SA[s], px = SX[s] - Math.sin(a) * j, py = SY[s] + Math.cos(a) * j;
    add(wx(x, px, py), wy(y, px, py), wz(z, px, py), 0, 0, 0, R(0.1, 0.16), 0, 0, strokeOf(a + j * 3), 3, 0.95, 5, SU[s] * 0.05, -1e9, 0.3);
  }
  // branches: short jagged paths off the line
  const np = last || i >= 4 ? 4 : 3;
  const segs = Math.min(6, 3 + (i >> 1));
  for (let p = 0; p < np && SN; p++) {
    const at = Math.min(SN - 1, Math.floor(R(0.15, 0.9) * SN));
    let sx = SX[at], sy = SY[at], h = SA[at] + (p & 1 ? 1 : -1) * R(0.7, 1.3), run = 0;
    const w0 = SU[at] * 0.05 + 0.01;
    for (let s = 0; s < segs; s++) {
      const L = R(0.14, 0.26);
      const step = stepAlong(h, cellM, rowM), n = Math.max(1, Math.round(L / step));
      const gl = strokeOf(h), c = Math.cos(h), sn = Math.sin(h);
      for (let k = 0; k < n; k++) {
        const t = ((k + 1) / n) * L, px = sx + c * t, py = sy + sn * t;
        add(wx(x, px, py), wy(y, px, py), wz(z, px, py), 0, 0, 0, R(0.09, 0.14), 0, 0, gl, 3, 0.85, 5, w0 + (run + t) * 0.03, -1e9, 0.3);
      }
      sx += c * L;
      sy += sn * L;
      run += L;
      h += (s & 1 ? -1 : 1) * R(0.6, 1.2);
    }
  }
  if (!last) return;
  // the bolt: ~4 m of letters from above, straight down through him to the floor, then it crackles out
  const rows = Math.max(4, Math.round(4 / (rowM / Math.max(0.5, Math.abs(AX.uy)))));
  const dy = Math.max(0.05, (y + 4 - floor) / rows);
  let sx = 0, prev = 0;
  for (let q = 0; q <= rows; q++) {
    const yy = y + 4 - q * dy;
    sx += q > 0 && q < rows ? R(-0.5, 0.5) * cellM : 0;
    sx = clamp(sx, -0.14, 0.14);
    const dxs = sx - prev;
    prev = sx;
    add(x + AX.rx * sx, yy, z + AX.rz * sx, 0, 0, 0, 0.17, 0, 0, dxs > 1e-4 ? G_SLASH : dxs < -1e-4 ? G_BACK : G_BAR, 3, 1, 5, (q / rows) * 0.07, -1e9, 0.35);
  }
  for (let p = 0; p < 3; p++) {
    // (out along the floor's line on screen, both ways)
    const h = p === 1 ? 0 : p === 0 ? Math.PI + R(-0.3, 0.3) : R(-0.3, 0.3);
    let px = 0, py = y - floor > 0 ? -(y - floor) * Math.abs(AX.uy) : 0, hh = h;
    for (let s = 0; s < 3; s++) {
      const L = R(0.14, 0.26), step = stepAlong(hh, cellM, rowM), n = Math.max(1, Math.round(L / step)), gl = strokeOf(hh);
      for (let k = 0; k < n; k++) {
        const t = ((k + 1) / n) * L, qx = px + Math.cos(hh) * t, qy = py + Math.sin(hh) * t * 0.6;
        add(wx(x, qx, qy), Math.max(floor + 0.05, wy(y, qx, qy)), wz(z, qx, qy), 0, 0, 0, R(0.1, 0.16), 0, 0, gl, 3, 0.8, 5, 0.17 + p * 0.03 + s * 0.04, -1e9, 0.3);
      }
      px += Math.cos(hh) * L;
      py += Math.sin(hh) * L * 0.6;
      hh += (s & 1 ? -1 : 1) * R(0.5, 1.0);
    }
  }
}

/** d: GOLD CRESCENT, along the sword's own path (two rows; the finisher's three, thicker, with embers). */
function lookD(game, x, y, z, i, last, floor) {
  startFlash(game, x, y, z, 0, last ? 3.8 : 1.8 + Math.min(0.6, 0.12 * i), 0.66, 0.42, FIRE, last);
  const rows = last ? 3 : 2;
  for (let r = 0; r < rows; r++) {
    const off = (r - (rows - 1) / 2) * (last ? 0.1 : 0.08);
    for (let s = 0; s < SN; s++) {
      const a = SA[s], u = SU[s];
      const bow = Math.sin(Math.PI * u) * 0.08 * (last ? 1.5 : 1);
      const o = off + bow, sx = SX[s] - Math.sin(a) * o, sy = SY[s] + Math.cos(a) * o;
      const sp = R(0.8, 1.4), tx = Math.cos(a) * sp, ty = Math.sin(a) * sp;
      add(wx(x, sx, sy), wy(y, sx, sy), wz(z, sx, sy), vxw(tx, ty), vyw(tx, ty), vzw(tx, ty), R(0.36, 0.48) * (last ? 1.15 : 1), 4, -3, strokeOf(a), 1, 0.92, 3, u * 0.03, floor, 0.3);
    }
  }
  const ne = last ? 14 : Math.min(7, 2 + i);
  for (let k = 0; k < ne && SN; k++) {
    const s = Math.min(SN - 1, Math.floor(rnd() * SN));
    add(wx(x, SX[s], SY[s]), wy(y, SX[s], SY[s]), wz(z, SX[s], SY[s]), R(-0.3, 0.3), R(0, 0.5), R(-0.3, 0.3), R(0.35, 0.6), 1.5, -2.5, rnd() < 0.5 ? G_DOT : G_COMMA, 1, 0.8, 4, R(0.1, 0.2), floor, 0.35);
  }
}

/**
 * THE EXIT: every blow goes THROUGH him. On the far side of his body, along the blow's direction (the
 * blade's own line, hilt to contact, when it is given), the blade's tip stands out (a short straight streak
 * of letters, held a beat on a thrust) and letters spray out of his back in the look's own colours. Grows
 * with the blow's number; the finisher's is the largest.
 */
function exitBurst(game, o, mode, ang, i, last, floor) {
  const ramp = mode === 'b' || mode === 'e' ? 2 : mode === 'c' ? 3 : mode === 'd' ? 1 : 0;
  const W = mode === 'e' ? DBFX_TUNE.weight : null; // (the weight: what flies out of his back is his blood, and it lands)
  let dx = fin(o.dx) ? o.dx : 0, dz = fin(o.dz) ? o.dz : 1;
  const bs = o.base;
  if (bs && fin(bs.x + bs.z)) {
    const hx = o.x - bs.x, hz = o.z - bs.z;
    if (hx * hx + hz * hz > 0.01) {
      dx = hx;
      dz = hz;
    }
  }
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  const depth = last ? 0.85 : 0.65, x = o.x + dx * depth, z = o.z + dz * depth, y = o.y;
  const thrust = o.thrust === true;
  // the tip: a straight streak out of his back along the blow, on the screen's cell grid
  const S = screen(game, x, y, z), cellM = S.cw * S.mpp, rowM = S.ch * S.mpp;
  const C = clean ? DBFX_TUNE.clean : null;
  const g = strokeOf(ang), len = ((thrust ? 1.7 : 1.05) + (last ? 0.6 : 0)) * (C ? C.tip : 1), step = stepAlong(ang, cellM, rowM), nt = Math.max(3, Math.min(16, Math.floor(len / step)));
  const hold = (thrust ? 0.14 : last ? 0.12 : 0.09) * (C ? C.tipHold : 1);
  for (let k = 0; k < nt; k++) {
    const u = k / (nt - 1), t = u * len;
    add(x + dx * t, y + R(-0.03, 0.03), z + dz * t, 0, 0, 0, hold * (1 - 0.4 * u), 0, 0, g, ramp, 0.9 - 0.4 * u, 5, u * 0.02, -1e9, 0.35);
  }
  // the spray: letters thrown out of his back (the far side), fanned across the blow's direction
  const ns = Math.round((last ? 46 : Math.min(26, 9 + 3 * i)) * (C ? C.burst : 1) * (W && DB_BLOOD.on ? W.exit : 1));
  for (let k = 0; k < ns; k++) {
    const sp = R(3.5, 8) * (last ? 1.25 : 1) * (W ? W.exitSpeed : 1), fan = R(-0.5, 0.5), c = Math.cos(fan), sn = Math.sin(fan);
    const vx = (dx * c - dz * sn) * sp, vz = (dx * sn + dz * c) * sp, vy = R(-0.4, 2.4);
    if (W && DB_BLOOD.on) {
      // (a droplet: it hangs through the hit-pause, flies, arcs and lands as a pool)
      if (add(x + R(-0.12, 0.12), y + R(-0.3, 0.3), z + R(-0.12, 0.12), vx, vy + R(0.4, 1.6), vz, R(0.9, 1.3), R(0.3, 0.9), -9.8, -1, 4, 1, 6, 0, floor, 0.15) >= 0) DBFX_LAST.blood++;
      continue;
    }
    add(x + R(-0.12, 0.12), y + R(-0.3, 0.3), z + R(-0.12, 0.12), vx, vy, vz, R(0.16, 0.42), sp / R(0.15, 0.5), -9, -1, ramp, 1, 0, 0, floor, 0.3);
  }
  return { dx, dz };
}

/**
 * One blow of the combo lands. o: { x, y, z (contact, m), dx, dz (the blow's direction on the floor, unit),
 * i (1..n), n, last, a0, a1 (the blade's swing on the screen, rad; may be NaN), thrust (the blow is a thrust),
 * path (Float32Array of 3 k world points, the blade tip from the start of the swing's active part to its
 * contact), base ({ x, y, z } the hilt at contact), hold (real s of the hit-pause) }. Returns the letters now
 * alive; never throws.
 */
export function deathblowHit(game, o) {
  try {
    if (!game || !o) return 0;
    const x = o.x, y = o.y, z = o.z;
    if (!fin(x + y + z)) return 0;
    const P = DBFX_LAST;
    P.hits++;
    const mode = DB_FX.mode;
    P.mode = mode;
    seed = (Math.imul(P.hits + 11, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
    AX = axes(game);
    holdLeft = fin(o.hold) && o.hold > 0 ? Math.min(0.6, o.hold) : 0;
    const i = clamp(Math.round(fin(o.i) ? o.i : 1), 1, 99), last = !!o.last;
    let ang = fin(o.dx + o.dz) ? screenAngle(AX, o.dx, 0, o.dz) : NaN;
    if (!fin(ang)) ang = fin(o.a1) ? o.a1 : 0.5;
    const S = screen(game, x, y, z);
    const cellM = S.cw * S.mpp, rowM = S.ch * S.mpp;
    const bd0 = exitBurstDir(o);
    clean = o.clean === true;
    cleanDx = bd0.dx;
    cleanDz = bd0.dz;
    P.clean = clean;
    const py = game.player?.position?.y;
    const floor = fin(py) ? Math.min(py, y - 0.05) : y - 1.2;
    const s0 = P.spawned;
    // the cut along the blade's path, sampled in letters
    const fromPath = buildLine(o, x, y, z, ang, last, false, 0);
    P.src = fromPath ? 'path' : 'fallback';
    P.pathS[0] = LX[0];
    P.pathS[1] = LY[0];
    sampleLine(cellM, rowM);
    const bd = exitBurstDir(o);
    if (DB_BLOOD.on) blood(game, x, y, z, i, last, floor, bd.dx, bd.dz);
    if (mode === 'b') {
      buildLine(o, x, y, z, ang, last, true, 3);
      sampleLine(cellM, rowM);
      lookB(game, x, y, z, i, last, floor);
    } else if (mode === 'c') lookC(game, x, y, z, i, last, floor, cellM, rowM);
    else if (mode === 'd') lookD(game, x, y, z, i, last, floor);
    else if (mode === 'e') lookE(game, x, y, z, i, last, floor);
    else lookA(game, x, y, z, i, last, floor);
    exitBurst(game, o, mode, ang, i, last, floor);
    P.looksSpawned = P.spawned - s0;
    P.alive = count;
    if (count > P.peak) P.peak = count;
    return count;
  } catch {
    return 0;
  }
}

const BD = { dx: 0, dz: 1 };
/** The blow's direction on the floor (the blade's line hilt to contact when given, else the bearing). */
function exitBurstDir(o) {
  let dx = fin(o.dx) ? o.dx : 0, dz = fin(o.dz) ? o.dz : 1;
  const bs = o.base;
  if (bs && fin(bs.x + bs.z)) {
    const hx = o.x - bs.x, hz = o.z - bs.z;
    if (hx * hx + hz * hz > 0.01) {
      dx = hx;
      dz = hz;
    }
  }
  const l = Math.hypot(dx, dz) || 1;
  BD.dx = dx / l;
  BD.dz = dz / l;
  return BD;
}

// ---- the colour
const COL = [0, 0, 0];
function rampCol(id, t) {
  const A = DBFX_TUNE.ramps[id] ?? DBFX_TUNE.ramps[0];
  t = clamp(t, 0, 1);
  let i = 1;
  while (i < A.length - 1 && A[i][0] < t) i++;
  const a = A[i - 1], b = A[i], u = (t - a[0]) / (b[0] - a[0] || 1);
  COL[0] = a[1] + (b[1] - a[1]) * u;
  COL[1] = a[2] + (b[2] - a[2]) * u;
  COL[2] = a[3] + (b[3] - a[3]) * u;
  return COL;
}

// ---- the letters: one LetterBatch per game for the flying and hanging ones, one for the floor's pools
let BG = null, BB = null, BP = null, BFAIL = null;
function makeBatch(game, max, soft) {
  const b = new LetterBatch(game, max, CHARS, { additive: false, spawned: 0, rand: rnd });
  b.uniforms.uSoft.value = soft;
  game.pipeline.registerParticles(b);
  return b;
}
function batches(game) {
  if (BG === game) return BB;
  const pl = game?.pipeline;
  if (BFAIL === game || typeof pl?.registerParticles !== 'function' || !game.U?.uResolution) return null;
  const mr = Math.random;
  Math.random = rnd; // (three.js's uuids: never the sims' stream)
  try {
    BB = makeBatch(game, MAX, 0.25);
    BP = makeBatch(game, PCAP, DBFX_TUNE.blood.poolSoft);
    BG = game;
    return BB;
  } catch {
    BFAIL = game;
    BB = BP = null;
    return null;
  } finally {
    Math.random = mr;
  }
}

const COLS = new Float32Array(DEATHBLOW_FX_GLYPHS.length);
function draw(game) {
  const b = batches(game), P = DBFX_LAST, T = DBFX_TUNE;
  if (b) b.begin();
  if (count) {
    AX = axes(game);
    const cp = game?.camera?.position;
    const bp = game?.dragon?.position;
    const bx = bp && fin(bp.x + bp.y + bp.z) ? bp.x : 0, by = bp && fin(bp.x + bp.y + bp.z) ? bp.y : 0, bz = bp && fin(bp.x + bp.y + bp.z) ? bp.z : 0;
    if (b) for (let i = 0; i < COLS.length; i++) COLS[i] = b.col(DEATHBLOW_FX_GLYPHS[i]);
    for (let i = 0; i < count; i++) {
      const k = i * F;
      if (D[k + 10] > 0) continue;
      const t = D[k + 6] / D[k + 7], kind = D[k + 15];
      let g = D[k + 12];
      if (kind === 3 && t > 0.55) g = t > 0.8 ? G_DOT : G_TICK; // (the crescent crumbles to embers)
      const c = rampCol(D[k + 13], t);
      const fade = D[k + 16], a = (t > 1 - fade ? clamp((1 - t) / fade, 0, 1) : 1) * D[k + 14];
      const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
      if (mx > P.maxCh) P.maxCh = mx;
      if (mn > 0.6 * mx) P.white++;
      if (g < 0) {
        // by its screen motion this frame, in letter cells: a stroke along it, a tick, a dot
        const vx = D[k + 3], vy = D[k + 4], vz = D[k + 5];
        const sx = vx * AX.rx + vy * AX.ry + vz * AX.rz, sy = vx * AX.ux + vy * AX.uy + vz * AX.uz;
        const s = screen(game, D[k], D[k + 1], D[k + 2]);
        const cells = s.ok ? Math.hypot(sx, sy) / s.mpp / 60 / s.cw : Math.hypot(sx, sy) / 60 / 0.12;
        if (cells > T.stroke) g = strokeOf(Math.atan2(sy, sx));
        else g = cells > T.tick ? G_TICK : G_DOT;
      }
      P.drawn++;
      if (!b) continue;
      let px = D[k], py = D[k + 1], pz = D[k + 2];
      if (D[k + 17] > 0) {
        px += bx;
        py += by;
        pz += bz;
      }
      if (cp) {
        const dx = cp.x - px, dy = cp.y - py, dz = cp.z - pz, l = Math.hypot(dx, dy, dz);
        if (l > T.pull * 2 && fin(l)) {
          px += (dx / l) * T.pull;
          py += (dy / l) * T.pull;
          pz += (dz / l) * T.pull;
        }
      }
      b.put(px, py, pz, 0, COLS[g], 0, c, a);
    }
  }
  if (b) b.end();
}

/** The floor's pools: written every frame while there are any (they stay until the reset). */
function drawPools(game) {
  const b = batches(game) && BP;
  if (!b) return;
  b.begin();
  const c0 = b.col('.'), c1 = b.col(','), c2 = b.col(':');
  for (let i = 0; i < poolN; i++) {
    const c = rampCol(4, PS[i]);
    b.put(PX[i], PY[i], PZ[i], 0, PG[i] === G_DOT ? c0 : PG[i] === G_COMMA ? c1 : c2, 0, c, 0.85);
  }
  b.end();
}

/**
 * Per frame (the player's fx update). realDt: real s (this runs on the real clock, through the hit-stop and
 * the slow motion; the effect's own clock runs at `blood.slow` while a blow's hit-pause holds). Never throws.
 */
export function deathblowFxUpdate(game, realDt) {
  try {
    if (!(realDt > 0)) return; // (a pause)
    const P = DBFX_LAST;
    const dB = fin(game?.fxDt) && game.fxDt > 0 ? game.fxDt : realDt;
    fxNow += dB;
    // the clock: slowed while the hit-pause holds
    const ts = holdLeft > 0 ? DBFX_TUNE.blood.slow : 1;
    if (holdLeft > 0) holdLeft = Math.max(0, holdLeft - realDt);
    P.ts = ts;
    const sdt = realDt * ts;
    // the heat: age, then one copy of each alive flash for the next frame
    let any = false;
    for (const S of flashes) {
      if (!S.alive) continue;
      S.age += S.real ? realDt : sdt;
      if (S.age >= S.life) S.alive = false;
      else any = true;
    }
    if (!any) heatBase = -1; // (no flash alive: the next one measures the field afresh)
    flashLive = 0;
    for (const S of flashes) if (S.alive) flashLive++;
    P.flash = flashLive;
    if (any && game?.fx?.fire?.spawn && fxNow + dB >= deadline) {
      const life = copyLife(dB);
      deadline = fxNow + life;
      for (const S of flashes) if (S.alive) drawFlash(game, S, life);
    }
    // the finisher's snap
    if (snapIn >= 0) {
      snapIn -= sdt;
      if (snapIn < 0) {
        const py = game?.player?.position?.y;
        snap(fin(py) ? Math.min(py, snapY - 0.05) : snapY - 1.2);
        snapIn = -1;
      }
    }
    if (poolN) drawPools(game);
    if (!count) return;
    let w = 0;
    for (let i = 0; i < count; i++) {
      const k = i * F;
      if (D[k + 10] > 0) {
        D[k + 10] -= sdt;
        if (w !== i) D.copyWithin(w * F, k, k + F);
        w++;
        continue;
      }
      D[k + 6] += sdt;
      const dr = Math.exp(-D[k + 8] * sdt);
      D[k + 3] *= dr;
      D[k + 5] *= dr;
      const crumbling = D[k + 15] !== 3 || D[k + 6] > 0.55 * D[k + 7];
      D[k + 4] = D[k + 4] * dr + (crumbling ? D[k + 9] * sdt : 0);
      D[k] += D[k + 3] * sdt;
      D[k + 1] += D[k + 4] * sdt;
      D[k + 2] += D[k + 5] * sdt;
      if (!fin(D[k] + D[k + 1] + D[k + 2] + D[k + 3] + D[k + 4] + D[k + 5])) {
        P.bad++;
        continue;
      }
      if (D[k + 1] <= D[k + 11] || D[k + 6] >= D[k + 7]) {
        // (a droplet that came down leaves its mark on the floor)
        if (D[k + 15] === 6 && D[k + 1] <= D[k + 11]) addPool(D[k], D[k + 11], D[k + 2]);
        continue; // (the floor, or its life)
      }
      if (w !== i) D.copyWithin(w * F, k, k + F);
      w++;
    }
    count = w;
    P.alive = w;
    if (w > P.peak) P.peak = w;
    draw(game);
  } catch {
    /* never freeze the frame */
  }
}

/** Drop everything (a fight reset, a level change): the letters, the heat, and the floor's pools. */
export function deathblowFxClear(game) {
  count = 0;
  snapIn = -1;
  deadline = -1;
  holdLeft = 0;
  poolN = 0;
  poolHead = 0;
  for (const S of flashes) S.alive = false;
  DBFX_LAST.alive = 0;
  DBFX_LAST.flash = 0;
  DBFX_LAST.pools = 0;
  DBFX_LAST.ts = 1;
  try {
    BB?.empty?.();
    BP?.empty?.();
  } catch {
    /* (a lost context) */
  }
}

/** Anything still alive (tests): the letters, the flashes, a snap pending. The floor's pools stay (until a clear). */
export const deathblowFxBusy = () => count > 0 || flashes.some((f) => f.alive) || snapIn >= 0;
