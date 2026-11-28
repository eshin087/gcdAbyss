// THE INSTANT SLASH (ADR-240; the owner, 2026-11-26: "use the current production auto attack combo and remove
// the curvy slashes with the instant slashes", for every attack and the flurry). Where the blade passed,
// ONE STRAIGHT LINE hangs for a moment instead of the curved crescent (fx.js `trail`): thin, sharp at both
// ends, white-hot in the middle, cooling the way the arc cools; the eye gets the line, not the swing. Drawn
// with the arc's own strokes (fx.js `|` strokes in the additive pool, its colours), so it is the same ink as
// the arc it replaces. `?slash=arc` (the Lab's `slash` button) draws the crescent as before.
//
// The line IS the blade's cut, and it comes WITH the swing: the blade's drawn point is followed frame by frame;
// on the first frame the swing has ended (the point slows past its fastest step: SWING) the line is
// drawn through where the point was as the swing began and where it is now, carried on past each end. Its
// angle, height and place are the blade's own, from every side. Per attack, from what it is (combat.js defs,
// the look the animator picked):
//   a cut     the chord of the swing (above)
//   a turn    (the picked look's `spin`: the whirl, the rising whirl, Whirling Tempest) three straight cuts
//             round him between points evenly along the swing, drawn together as it ends
//   a thrust  (a clip whose `line` is 'point', or a `thrust` def: the stab, the heavy thrust, the execution)
//             a short streak straight on off the point, along the blade, as the thrust stops
// The look (SLASH): 'light' for a light attack, 'heavy' for a heavy one (`heavy` on the def: the slam, the
// heavies, the charged cleave, One Breath, the execution): the heavy arc's violet, longer and thicker, the
// camera kicked along the cut with a small shake. Nothing on a dead hero, no allocation a frame, no
// Math.random. The lines were first drawn for the instant cuts of ADR-233 (PR 118, closed); this is their
// drawing, driven by the production attacks.

import { SWINGS } from './swings.js';
import { DIM } from './model.js';
import { ARC_TONE } from './fx.js';
import * as THREE from 'three';

const _pv = new THREE.Vector3(), _OUT = [0, 0, 0];
const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);

/** 'line' (the default): the instant slash; 'arc': the curved crescent as before. */
export const SLASH_IDS = ['line', 'arc'];
let slashNow = 'line';
export const slashMode = () => slashNow;
/** Pick the look of every swing's mark; false for an unknown id. */
export function setSlash(m) {
  if (!SLASH_IDS.includes(m)) return false;
  slashNow = m;
  return true;
}
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('slash') : null;
  if (q) setSlash(q);
}

/** THE ENDING SLASH (the owner, 2026-11-26: "I didn't mean the instant slash is showing the sword swing, it should
 *  show at the end like an ending slash feel"; shown all three places and both timings, they picked enemy, as the
 *  swing ends). Where the line is drawn once the swing has ended, the way the sword crossed the screen:
 *    enemy   across what it hit, centred on the contact; a whiff: a shorter line at the target place (default)
 *    target  through the space ahead of him where the foe stands (END.ahead m out, at the cut's height)
 *    body    across him, centred on his chest
 *    blade   along the blade's own path (the first instant slash: the chord of the swing)
 *  and when: '0' as the swing ends (default), 'beat' END.beat s later (the 'already cut' beat, the pose held). */
export const PLACE_IDS = ['sweep', 'enemy', 'target', 'body', 'blade'];
export const BEAT_IDS = ['0', 'beat'];
// THE SWEEP (ADR-292, the default; the owner, 2026-11-28: "the instant slashes coming from the auto attacks don't
// look accurate based on the sword swing. make sure it looks good and accurate no matter which camera view the
// player is facing"). Measured: on a whiff `enemy` hung the line END.ahead (1.9 m) out in front of him, which the
// camera behind him draws ABOVE his head (the finisher's violet band floated a body's height over a blade that
// ended at his hip), and its 3.6 - 5.6 m ran far past the steel; its way was the hand's, not the blade's. The
// sweep is the steel's own path ON THE SCREEN, read through the camera's projection so it holds from every side:
//   way     the weighted sum of the screen steps of three points along the blade (SWEEP.along: near the hand,
//           the middle, the drawn point), each step weighted by the square of the point's speed that frame (the
//           fast cut decides it, not the slow raise before it)
//   place   across: the speed-weighted middle of where those points passed; along: from the first to the last
//           place the steel reached while it was moving fast, carried SWEEP.ext of that past each end
//   depth   the blade's middle at the fastest frame (a landed blow: the contact, and the line is moved across to
//           run through it, so it still cuts through what it hit)
// It is laid in the screen's plane at that depth: what the eye saw the sword do is where the slash is.
// (the owner's baseline before, 2026-11-26: "combo A with the slash on the enemy", as the swing ends: `enemy`)
let placeNow = 'sweep', beatNow = '0';
export const placeMode = () => placeNow;
export const beatMode = () => beatNow;
export function setPlace(m) {
  if (!PLACE_IDS.includes(m)) return false;
  placeNow = m;
  return true;
}
export function setBeat(m) {
  const id = String(m);
  if (!BEAT_IDS.includes(id)) return false;
  beatNow = id;
  return true;
}
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q?.get('endslash')) setPlace(q.get('endslash'));
  if (q?.get('endbeat')) setBeat(q.get('endbeat'));
}
/** The ending slash's numbers: `ahead` (m, × his scale) the target place in front of him, `y` the height
 *  range of its middle (m), `len` [light, heavy] its length (m), `thrust` a thrust's, `miss` × the length of
 *  an enemy-placed whiff, `beat` (s) the pause before it in 'beat', `star` (rad) how far a turn's three cuts
 *  are fanned round their middle. */
export const END = { ahead: 1.9, y: [0.55, 1.7], len: [3.6, 5.6], thrust: 2.4, miss: 0.6, beat: 0.12, star: 0, at: 0.2, reveal: 3, step: 1 / 60 };
// (`at`: the point along the blade, from its base to its drawn point, whose way across the screen is the
// slash's direction: near the hand, so a blade raised overhead with its point back toward the camera still
// reads as the swing does, from where the sword came down to where it went; `reveal` pieces drawn `step` s
// apart, from the swing's start to its end: the slash runs the way the sword did)
const NP = 24; // ending slashes' pieces waiting for their time
/** The sweep's numbers: `along` the points on the blade (0 its base, 1 the drawn point) whose path is read,
 *  `fast` x the fastest step a frame counts as the cut (its place), `ext` the share carried on past each end,
 *  `len` [light, heavy] [shortest, longest] (m, x his scale), `thrust` a thrust streak's length (m). */
export const SWEEP = { along: [0.25, 0.6, 1], fast: 0.35, ext: 0.18, len: [[1.1, 2.6], [1.6, 3.4]], thrust: 1.2 };
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3();

/** The line's looks: strokes, their size at the middle (m), life (s) at the ends … the middle, the
 *  four-frame flash, the hairline that outlasts it, the colours (the arc's: white-hot → its core → the
 *  colour it cools to); `ext` the share of the recorded stretch it is carried on past each end, `min` the
 *  shortest line (m), `max` the longest; `rows` strokes side by side (`gap` m apart on the screen's plane;
 *  the outer ones `outer` × the size, in `edge`'s colour); `hold` the share of its size a stroke still has
 *  at the end of its life and `fade` its opacity then; `kick` the camera's kick along the cut (m) and the
 *  shake on the frame it is drawn; `over` (m): carried on no higher than this over the higher of its two
 *  points, × (1 − its steepness²) (a cut straight down never draws a pillar into the sky); `floor` (m) the
 *  line never goes under; `thrust` (m) a thrust's streak; `ring` the turn's cuts. */
export const SLASH = {
  light: {
    n: 30, size: 0.13, life: [0.14, 0.3], flash: { size: 0.19, life: 0.05 }, hair: { size: 0.045, life: 0.95, alpha: 0.7 },
    hot: [3.0, 3.5, 4.3], core: ARC_TONE.light.core, end: ARC_TONE.light.end, ext: 0.35, min: 1.5, max: 4.2,
    rows: 1, gap: 0, outer: 1, hold: 0.12, fade: 0, kick: null, over: 1.6,
  },
  heavy: {
    n: 44, size: 0.2, life: [0.24, 0.42], flash: { size: 0.26, life: 0.05 }, hair: { size: 0.07, life: 1.3, alpha: 0.8 },
    hot: [2.6, 2.6, 3.6], core: ARC_TONE.heavy.core, end: ARC_TONE.heavy.end, ext: 0.6, min: 3.0, max: 7.0,
    rows: 3, gap: 0.07, outer: 0.8, edge: [0.95, 0.32, 2.5], hold: 0.6, fade: 0.25, kick: { m: 0.08, shake: 0.12 }, over: 2.0,
  },
  floor: 0.08,
  thrust: 0.9,
  ring: 3,
};
const LOOKS = ['light', 'heavy'];
/** When the line is drawn: the swing is followed from `from` × the windup; its fastest frame is looked for
 *  from `peakFrom` × the windup (the active window on); the swing has ended on the first frame after it whose point moves under `end`
 *  of that (the line is drawn then, with the blade); the line starts where the point was just before the
 *  first frame moving `start` of it; at the latest `late` of the recovery in. (The owner, 2026-11-26: the
 *  lines "look out of place and a bit lagged. it should show as soon as the animation swing ends": they
 *  were drawn at the end of the active window, from the frame before it opened.) */
export const SWING = { from: 0.5, peakFrom: 1, end: 0.8, start: 0.3, late: 0.35, bite: 0.1 };
const NB = 64; // frames of the point kept (a swing from late in its windup to its end)

export class SlashFx {
  constructor(player) {
    this.p = player;
    this.game = player.game;
    this.rec = null; // the attack record the line belongs to
    this.kind = 0; // 0 a cut, 1 a turn, 2 a thrust
    this.look = 0;
    this.st = 0; // 0 following the swing, 2 drawn
    this.T = [0, 0, 0];
    this.H = [0, 0, 0];
    this.buf = new Float32Array(NB * 3); // the point, frame by frame
    this.mid = new Float32Array(NB * 3); // … and the blade near the hand (END.at): the swing's way on the screen
    this.base = new Float32Array(NB * 3); // … and the blade's base (the sweep: points along the steel)
    this.spd = new Float32Array(NB); // … and how far it moved that frame
    this.nb = 0;
    this.peak = 0; // the fastest frame's step, and its index
    this.pi = -1;
    this.lastT = -1;
    this.pend = new Float32Array(NP * 13); // ax ay az bx by bz, the time it is drawn at, thrust, kick, look, the piece [f0, f1), kind
    this._dly = 0;
    this.np = 0;
    this.hitRec = null; // the attack that landed, and where (the enemy place)
    this.hit = [0, 0, 0];
    player.game?.events?.on?.('player:hitDragon', (e) => {
      const at = this.p.atk, q = e?.point;
      if (!at || !q || !Number.isFinite(q.x + q.y + q.z) || this.hitRec === at) return;
      this.hitRec = at;
      this.hit[0] = q.x;
      this.hit[1] = q.y;
      this.hit[2] = q.z;
    });
    this.lines = 0; // drawn so far (tests)
    this.last = new Float32Array(8); // the last line drawn: its ends, heavy, the kind (tests)
    this.kicks = 0;
    /** Tests: (ax, ay, az, bx, by, bz, look, kind) as each line is decided. */
    this.onLine = null;
    this._o = { x: 0, y: 0, z: 0, life: 0.2, size: 0.1, sizeEnd: 0.02, glyph: '|', rot: 0, stretch: 1, color: SLASH.light.core, colorEnd: SLASH.light.end, alpha: 1, alphaEnd: 0, drag: 0 };
  }

  /** Does this attack draw its line here (player.js: then no crescent behind the blade)? */
  owns(at) {
    // (a deathblow's swing draws no blade line of its own, neither this line nor the arc: the owner found the
    // big slashes across the screen distracting; the deathblow's hit effect marks the cut, deathblowFx.js)
    if (at?.rip?.db) return true;
    return slashNow === 'line' && !!at?.def;
  }

  _blade() {
    const e = this.p.rig?.sword?.matrixWorld?.elements;
    if (!e) return false;
    // (the DRAWN point, model.js: the line sits on the steel the eye sees, not on the hit's reach past it)
    const zt = DIM.drawnTip, zh = DIM.bladeBase, T = this.T, H = this.H;
    T[0] = e[8] * zt + e[12];
    T[1] = e[9] * zt + e[13];
    T[2] = e[10] * zt + e[14];
    H[0] = e[8] * zh + e[12];
    H[1] = e[9] * zh + e[13];
    H[2] = e[10] * zh + e[14];
    return Number.isFinite(T[0] + T[1] + T[2] + H[0] + H[1] + H[2]);
  }

  /** Per frame, after the pose and the sweep (player.js _combat). */
  update() {
    if (this.np) this._flush();
    const P = this.p, at = P.atk, d = at?.def;
    if (slashNow !== 'line' || !(P.hp > 0) || !d || (P.state !== 'attack' && P.state !== 'heavy') || at.pending || at.rip?.db) {
      this.rec = null;
      return;
    }
    if (!this._blade()) return;
    if (this.rec !== at) {
      this.rec = at;
      this.st = 0;
      this.nb = 0;
      this.peak = 0;
      this.pi = -1;
      this.lastT = -1;
      // what it is: the look the animator picked (a variant may turn or not)
      const an = P.anim?.atkDef === d && P.anim.atkAnim ? P.anim.atkAnim : d.anim;
      const C = an?.clip ? SWINGS[an.clip] : null;
      this.kind = d.kind === 'thrust' || an?.kind === 'thrust' || C?.line === 'point' ? 2 : an?.spin ? 1 : 0;
      this.look = d.heavy ? 1 : 0;
    }
    const W = d.windup, Ac = d.active, R = d.recovery, t = at.t;
    // (the point is followed from late in the windup; a frozen frame, the hit-pause, moves nothing)
    if (this.st === 2 || t < SWING.from * W || t === this.lastT) return;
    this.lastT = t;
    const T = this.T, B = this.buf, n = this.nb;
    const sp = n > 0 ? Math.hypot(T[0] - B[n * 3 - 3], T[1] - B[n * 3 - 2], T[2] - B[n * 3 - 1]) : 0;
    if (n < NB) {
      B[n * 3] = T[0];
      B[n * 3 + 1] = T[1];
      B[n * 3 + 2] = T[2];
      const H = this.H, M = this.mid, f = END.at;
      for (let c = 0; c < 3; c++) M[n * 3 + c] = H[c] + (T[c] - H[c]) * f;
      for (let c = 0; c < 3; c++) this.base[n * 3 + c] = H[c];
      this.spd[n] = sp;
      this.nb = n + 1;
    }
    // the swing: its fastest frame from the windup's end on; it has ENDED on the first frame after that
    // peak (the cut proper: from the active window on) whose point moves under SWING.end of it (at the latest SWING.late of the recovery in)
    if (t >= SWING.peakFrom * W && sp > this.peak) {
      this.peak = sp;
      this.pi = this.nb - 1;
    }
    // (not while a landed blow's bite holds the blade, anim.js BITE: the hit-pause and the bite slow it for a
    // few frames at the contact; read as the swing's end, the line came at the contact from the windup's last
    // motion only: a chop's raise drew its line upward)
    const biting = at.hitAt >= 0 && t - at.hitAt < SWING.bite;
    const ended = !biting && this.pi >= 0 && this.nb - 1 > this.pi && sp < SWING.end * this.peak;
    if (!ended && t < W + Ac + SWING.late * R && this.nb < NB) return;
    this.st = 2;
    if (!(this.peak > 0)) return;
    // the cut: from the first frame moving at least SWING.start of its fastest step (the bite's slow frames inside it
    // count, weighed by speed) to where the point is now
    let s = 0;
    while (s < this.pi && this.spd[s] < SWING.start * this.peak) s++;
    const a = Math.max(0, s - 1), e = this.nb - 1;
    if (this.kind === 2) this._streak(SLASH.thrust * (this.look ? 1.4 : 1));
    else if (this.kind === 1) {
      // a turn: three straight cuts between points evenly along the stretch
      const k = SLASH.ring;
      for (let j = 1; j <= k; j++) {
        const i0 = Math.round(a + ((e - a) * (j - 1)) / k), i1 = Math.round(a + ((e - a) * j) / k);
        if (i1 > i0) this._swing(i0, i1, j === 1, (j - 1) * END.reveal * END.step);
      }
    } else this._swing(a, e, true, 0);
  }

  /** A cut from buffered frame i0 to i1: along the blade's point (the `blade` place), or, at every other
   *  place, the way the blade near the hand crossed the screen. */
  _swing(i0, i1, kick, delay) {
    this._dly = delay;
    if (placeNow === 'sweep') this._sweep(i0, i1, kick);
    else if (placeNow === 'blade') {
      const B = this.buf;
      this._cut(B[i0 * 3], B[i0 * 3 + 1], B[i0 * 3 + 2], B[i1 * 3], B[i1 * 3 + 1], B[i1 * 3 + 2], kick);
    } else {
      // the cut's way: the blade's steps near the hand, each weighted by the square of the point's speed that
      // frame, so the fast cut decides it and not the quicker part of a raise before it (the chord of the
      // whole stretch ran a chop's line upward: the owner, "the opposite of what is currently displaying")
      // (on the screen, through the camera's own projection: a chop that runs away from the camera moves
      // DOWN the picture, though its depth would lay it upward)
      const M = this.mid, S = this.spd, cam = this.game?.camera;
      if (!cam) return;
      let x = 0, y = 0, px = 0, py = 0;
      for (let i = i0; i <= i1; i++) {
        _pv.set(M[i * 3], M[i * 3 + 1], M[i * 3 + 2]).project(cam);
        if (i > i0) {
          const w = S[i] * S[i];
          x += (_pv.x - px) * w;
          y += (_pv.y - py) * w;
        }
        px = _pv.x;
        py = _pv.y;
      }
      if (this._screen(x * (cam.aspect || 1), y)) {
        const ax = M[i0 * 3], ay = M[i0 * 3 + 1], az = M[i0 * 3 + 2], D = _OUT;
        this._cut(ax, ay, az, ax + D[0], ay + D[1], az + D[2], kick);
      }
    }
    this._dly = 0;
  }

  /** THE SWEEP: the cut from buffered frame i0 to i1 as the steel crossed the screen (SWEEP above): its way, its
   *  place and its length from points along the blade, laid in the screen's plane at the blade's (or the
   *  contact's) depth, then drawn as the line is (_end keeps it where it is). */
  _sweep(i0, i1, kick) {
    const cam = this.game?.camera, Bt = this.buf, Bb = this.base, S = this.spd, A = SWEEP.along;
    if (!cam || !(i1 > i0)) return;
    const asp = cam.aspect || 1;
    // the way: every point's screen steps, each weighted by the square of the point's speed that frame
    let wx = 0, wy = 0;
    for (const f of A) {
      let px = 0, py = 0;
      for (let i = i0; i <= i1; i++) {
        const o = i * 3;
        _pv.set(Bb[o] + (Bt[o] - Bb[o]) * f, Bb[o + 1] + (Bt[o + 1] - Bb[o + 1]) * f, Bb[o + 2] + (Bt[o + 2] - Bb[o + 2]) * f).project(cam);
        const x = _pv.x * asp, y = _pv.y;
        if (i > i0) {
          const w = S[i] * S[i];
          wx += (x - px) * w;
          wy += (y - py) * w;
        }
        px = x;
        py = y;
      }
    }
    const wl = Math.hypot(wx, wy);
    if (!(wl > 1e-9)) return;
    const ux = wx / wl, uy = wy / wl, vx = -uy, vy = ux;
    // the place: along the way, from the first to the last place the steel reached moving fast; across it, the
    // speed-weighted middle; the depth of the blade's middle at the fastest frame
    let s0 = Infinity, s1 = -Infinity, cs = 0, cw = 0, top = 0, iPk = i0;
    for (let i = i0 + 1; i <= i1; i++) if (S[i] > top) { top = S[i]; iPk = i; }
    for (let i = i0; i <= i1; i++) {
      const fast = S[i] >= SWEEP.fast * top || i === i0 || i === i1;
      const o = i * 3;
      for (const f of A) {
        _pv.set(Bb[o] + (Bt[o] - Bb[o]) * f, Bb[o + 1] + (Bt[o + 1] - Bb[o + 1]) * f, Bb[o + 2] + (Bt[o + 2] - Bb[o + 2]) * f).project(cam);
        const x = _pv.x * asp, y = _pv.y, sa = x * ux + y * uy, sc = x * vx + y * vy;
        if (fast) {
          if (sa < s0) s0 = sa;
          if (sa > s1) s1 = sa;
        }
        const w = S[i] + 1e-6;
        cs += sc * w;
        cw += w;
      }
    }
    if (!(s1 > s0) || !(cw > 0)) return;
    let c = cs / cw;
    {
      const o = iPk * 3;
      _pv.set((Bb[o] + Bt[o]) / 2, (Bb[o + 1] + Bt[o + 1]) / 2, (Bb[o + 2] + Bt[o + 2]) / 2).project(cam);
    }
    let z = _pv.z;
    // a landed blow: through the contact, at its depth (still as long as the steel's way)
    if (this.hitRec === this.rec) {
      _sa.set(this.hit[0], this.hit[1], this.hit[2]).project(cam);
      if (Number.isFinite(_sa.x + _sa.y + _sa.z) && Math.abs(_sa.z) < 1) {
        const x = _sa.x * asp, y = _sa.y, sa = x * ux + y * uy;
        c = x * vx + y * vy;
        z = _sa.z;
        if (sa < s0) s0 = sa;
        if (sa > s1) s1 = sa;
      }
    }
    if (!(Math.abs(z) < 1)) return;
    const e = (s1 - s0) * SWEEP.ext;
    s0 -= e;
    s1 += e;
    // back to the world: the ends at that depth, the length held to the look's bounds (in metres, x his scale)
    const ax = (ux * s0 + vx * c) / asp, ay = uy * s0 + vy * c, bx = (ux * s1 + vx * c) / asp, by = uy * s1 + vy * c;
    _sa.set(ax, ay, z).unproject(cam);
    _sb.set(bx, by, z).unproject(cam);
    if (!Number.isFinite(_sa.x + _sa.y + _sa.z + _sb.x + _sb.y + _sb.z)) return;
    const sc = this.p.drawScale || 1, [lo, hi] = SWEEP.len[this.look], d = _sa.distanceTo(_sb);
    if (!(d > 1e-4)) return;
    const L = clampN(d, lo * sc, hi * sc);
    if (L !== d) {
      _pv.subVectors(_sb, _sa).multiplyScalar((L - d) / (2 * d));
      _sa.sub(_pv);
      _sb.add(_pv);
    }
    // kept off the floor (a line cut where it meets it)
    let x0 = _sa.x, y0 = _sa.y, z0 = _sa.z, x1 = _sb.x, y1 = _sb.y, z1 = _sb.z;
    const fl = SLASH.floor;
    if (y0 < fl && y1 < fl) return;
    if (y0 < fl || y1 < fl) {
      const t = (fl - y0) / (y1 - y0);
      if (y0 < fl) {
        x0 += (x1 - x0) * t;
        z0 += (z1 - z0) * t;
        y0 = fl;
      } else {
        x1 = x0 + (x1 - x0) * t;
        z1 = z0 + (z1 - z0) * t;
        y1 = fl;
      }
    }
    if (Math.hypot(x1 - x0, y1 - y0, z1 - z0) < 0.2) return;
    this._end(x0, y0, z0, x1, y1, z1, false, kick);
  }

  /** A direction across the screen (sx right, sy up, in pixels' proportions) as a world direction in the
   *  screen's plane → _OUT; false when there is none. */
  _screen(sx, sy) {
    const C = this.game?.camera?.matrixWorld?.elements, l = Math.hypot(sx, sy);
    if (!C || !(l > 1e-9)) return false;
    sx /= l;
    sy /= l;
    _OUT[0] = C[0] * sx + C[4] * sy;
    _OUT[1] = C[1] * sx + C[5] * sy;
    _OUT[2] = C[2] * sx + C[6] * sy;
    return Number.isFinite(_OUT[0] + _OUT[1] + _OUT[2]);
  }

  /** The line through the point's two places, carried on past both (no shorter than its min), kept off
   *  the ground and under its ceiling. `kick`: this line may kick the camera (a turn's first cut only). */
  _cut(x0, y0, z0, x1, y1, z1, kick) {
    const L = SLASH[LOOKS[this.look]];
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const d = Math.hypot(dx, dy, dz);
    if (!(d > 1e-3)) return;
    dx /= d;
    dy /= d;
    dz /= d;
    const len = Math.min(L.max, Math.max(L.min, d * (1 + 2 * L.ext)));
    const pad = (len - d) / 2;
    let s0 = -pad, s1 = d + pad; // along the line from the first point
    if (Math.abs(dy) > 1e-6) {
      const sF = (SLASH.floor - y0) / dy; // where it meets the floor
      if (dy < 0) s1 = Math.min(s1, sF);
      else s0 = Math.max(s0, sF);
      const sT = (Math.max(y0, y1) + L.over * (1 - dy * dy) - y0) / dy; // where it reaches its ceiling
      if (dy > 0) s1 = Math.min(s1, sT);
      else s0 = Math.max(s0, sT);
    } else if (y0 < SLASH.floor) return;
    if (!(s1 - s0 > 0.2)) return;
    this._end(x0 + dx * s0, y0 + dy * s0, z0 + dz * s0, x0 + dx * s1, y0 + dy * s1, z0 + dz * s1, false, kick);
  }

  /** A thrust: a short streak straight on off the point, along the blade. */
  _streak(len) {
    const T = this.T, H = this.H, cam = this.game?.camera;
    if (placeNow !== 'blade' && cam) {
      // (the blade's way across the screen, through the camera's projection)
      _pv.set(H[0], H[1], H[2]).project(cam);
      const hx = _pv.x, hy = _pv.y;
      _pv.set(T[0], T[1], T[2]).project(cam);
      if (this._screen((_pv.x - hx) * (cam.aspect || 1), _pv.y - hy)) {
        this._end(T[0], T[1], T[2], T[0] + _OUT[0] * len, T[1] + _OUT[1] * len, T[2] + _OUT[2] * len, true, true);
        return;
      }
    }
    let dx = T[0] - H[0], dy = T[1] - H[1], dz = T[2] - H[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    this._end(T[0], T[1], T[2], T[0] + dx * len, T[1] + dy * len, T[2] + dz * len, true, true);
  }

  /** The ending slash: the cut's line (a → b) moved to its place (placeNow) at the cut's angle, kept off the
   *  floor, drawn now or after the beat (beatNow). */
  _end(ax, ay, az, bx, by, bz, thrust, kick) {
    // (the sweep's line is already where the steel went; its thrust runs on off the point, SWEEP.thrust long)
    if (placeNow === 'sweep' && thrust) {
      const l = Math.hypot(bx - ax, by - ay, bz - az);
      if (l > 1e-4) {
        const k = (SWEEP.thrust * (this.p.drawScale || 1) * (this.look ? 1.4 : 1)) / l;
        bx = ax + (bx - ax) * k;
        by = ay + (by - ay) * k;
        bz = az + (bz - az) * k;
      }
    }
    if (placeNow !== 'blade' && placeNow !== 'sweep') {
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const l = Math.hypot(dx, dy, dz);
      if (!(l > 1e-4)) return;
      dx /= l;
      dy /= l;
      dz /= l;
      // (laid in the screen's plane: the slash crosses the picture the way the sword did, whatever its
      // depth; a cut toward or away from the camera no longer turns into a stub, or its mirror)
      const C = this.game?.camera?.matrixWorld?.elements;
      if (C) {
        const sx = dx * C[0] + dy * C[1] + dz * C[2], sy = dx * C[4] + dy * C[5] + dz * C[6], sl = Math.hypot(sx, sy);
        if (sl > 0.05) {
          dx = (C[0] * sx + C[4] * sy) / sl;
          dy = (C[1] * sx + C[5] * sy) / sl;
          dz = (C[2] * sx + C[6] * sy) / sl;
        }
      }
      const P = this.p, sc = P.drawScale || 1, E = END;
      let cx, cy, cz, L = (thrust ? E.thrust : E.len[this.look]) * sc;
      const ch = P.rig?.chest?.matrixWorld?.elements;
      if (placeNow === 'body' && ch) {
        cx = ch[12];
        cy = ch[13];
        cz = ch[14];
      } else if (placeNow === 'enemy' && this.hitRec === this.rec) {
        cx = this.hit[0];
        cy = this.hit[1];
        cz = this.hit[2];
      } else {
        const y = P.yaw ?? 0;
        cx = P.position.x + Math.sin(y) * E.ahead * sc;
        cz = P.position.z + Math.cos(y) * E.ahead * sc;
        cy = Math.min(E.y[1] * sc, Math.max(E.y[0] * sc, (ay + by) / 2));
        if (placeNow === 'enemy') L *= E.miss;
      }
      if (!Number.isFinite(cx + cy + cz)) return;
      // (a thrust's streak runs on from just behind the place; a cut is centred on it)
      const f0 = thrust ? -0.3 : -0.5, f1 = thrust ? 0.7 : 0.5;
      let s0 = f0 * L, s1 = f1 * L;
      if (Math.abs(dy) > 1e-6) {
        const sF = (SLASH.floor - cy) / dy;
        if (dy < 0) s1 = Math.min(s1, sF);
        else s0 = Math.max(s0, sF);
      } else if (cy < SLASH.floor) return;
      if (!(s1 - s0 > 0.2)) return;
      ax = cx + dx * s0;
      ay = cy + dy * s0;
      az = cz + dz * s0;
      bx = cx + dx * s1;
      by = cy + dy * s1;
      bz = cz + dz * s1;
    }
    // drawn in END.reveal pieces END.step apart from where the swing began (a) to where it ended (b): the slash
    // runs the sword's way; after the beat (beatNow) and a turn's later cuts' delay
    const now = this.game?.time ?? 0, t0 = now + (beatNow === 'beat' ? END.beat : 0) + (this._dly || 0), R = Math.max(1, END.reveal | 0);
    for (let i = 0; i < R; i++) {
      const f0 = i / R, f1 = (i + 1) / R, at = t0 + i * END.step;
      if (!(at > now)) {
        this._draw(ax, ay, az, bx, by, bz, thrust, kick && i === 0, f0, f1);
        continue;
      }
      if (this.np >= NP) return;
      const o = this.np++ * 13, Q = this.pend;
      Q[o] = ax;
      Q[o + 1] = ay;
      Q[o + 2] = az;
      Q[o + 3] = bx;
      Q[o + 4] = by;
      Q[o + 5] = bz;
      Q[o + 6] = at;
      Q[o + 7] = thrust ? 1 : 0;
      Q[o + 8] = kick && i === 0 ? 1 : 0;
      Q[o + 9] = this.look;
      Q[o + 10] = f0;
      Q[o + 11] = f1;
      Q[o + 12] = this.kind;
    }
  }

  /** The ending slashes whose beat is up (dropped if he has died since). */
  _flush() {
    const Q = this.pend, now = this.game?.time ?? 0, alive = this.p.hp > 0;
    for (let i = 0; i < this.np; ) {
      const o = i * 13;
      if (alive && now < Q[o + 6]) {
        i++;
        continue;
      }
      if (alive) {
        const look = this.look, kind = this.kind;
        this.look = Q[o + 9];
        this.kind = Q[o + 12];
        this._draw(Q[o], Q[o + 1], Q[o + 2], Q[o + 3], Q[o + 4], Q[o + 5], Q[o + 7] > 0, Q[o + 8] > 0, Q[o + 10], Q[o + 11]);
        this.look = look;
        this.kind = kind;
      }
      const l = --this.np * 13;
      for (let k = 0; k < 13; k++) Q[o + k] = Q[l + k];
    }
  }

  /** Draw the line a → b, or its piece [f0, f1) of it (the strokes of the whole line that fall there). */
  _draw(ax, ay, az, bx, by, bz, thrust, kick, f0 = 0, f1 = 1) {
    const look = this.look, Lk = SLASH[LOOKS[look]];
    if (f0 <= 0) {
      this.onLine?.(ax, ay, az, bx, by, bz, LOOKS[look], this.kind);
      const la = this.last;
      la[0] = ax;
      la[1] = ay;
      la[2] = az;
      la[3] = bx;
      la[4] = by;
      la[5] = bz;
      la[6] = look;
      la[7] = this.kind;
      this.lines++;
    }
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-4)) return;
    dx /= len;
    dy /= len;
    dz /= len;
    // the weight of a heavy line: the picture thrown along the cut, a small shake
    const K = Lk.kick;
    if (K && kick) {
      const g = this.game;
      g?.kick?.(dx, dy, dz, K.m);
      g?.shake?.(K.shake);
      this.kicks++;
    }
    const fx = this.p.fx?.add;
    if (!fx?.spawn) return;
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
    // the stroke's turn on the screen (as fx.js alongRot), and the screen's across (for the rows)
    const C = this.game?.camera?.matrixWorld?.elements;
    let rot = Math.atan2(dy, dx) - Math.PI / 2;
    let px = 0, py = 1, pz = 0;
    if (C) {
      const sx = dx * C[0] + dy * C[1] + dz * C[2], sy = dx * C[4] + dy * C[5] + dz * C[6];
      if (sx * sx + sy * sy > 1e-10) rot = Math.atan2(sy, sx) - Math.PI / 2;
      const qx = dy * C[10] - dz * C[9], qy = dz * C[8] - dx * C[10], qz = dx * C[9] - dy * C[8], ql = Math.hypot(qx, qy, qz);
      if (ql > 1e-6) {
        px = qx / ql;
        py = qy / ql;
        pz = qz / ql;
      }
    }
    // (a thrust's streak: fewer strokes, thinner, sharp toward its far end)
    const n = thrust ? Math.max(10, Math.round(Lk.n * 0.4)) : Lk.n;
    const o = this._o, seg = len / n, k0 = thrust ? 0.75 : 1;
    const rows = thrust ? 1 : Math.max(1, Lk.rows | 0);
    o.rot = rot;
    o.colorEnd = Lk.end;
    for (let r = 0; r < rows; r++) {
      // (the middle row is the line; the rows beside it thinner, shorter, no flash, no hairline)
      const mid = (rows - 1) / 2, off = rows > 1 ? (r - mid) * Lk.gap : 0, side = off !== 0, k = side ? k0 * Lk.outer : k0;
      const wMin = side ? 0.3 + (0.25 * Math.abs(r - mid)) / mid : 0;
      for (let pass = 0; pass < 3; pass++) {
        if (side && pass > 0) break;
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n, s = (f - 0.5) * len;
          if (f < f0 || f >= f1) continue;
          const y = cy + dy * s + py * off;
          if (y < SLASH.floor) continue;
          // sharp at both ends (a thrust: full at the point, sharp at its far end)
          const w = thrust ? Math.pow(Math.max(0, 1 - f), 0.6) : Math.pow(Math.sin(Math.PI * f), 0.7);
          if (side && w < wMin) continue;
          o.x = cx + dx * s + px * off;
          o.y = y;
          o.z = cz + dz * s + pz * off;
          if (pass === 0) {
            const size = Lk.size * k * (0.25 + 0.75 * w);
            o.size = size;
            o.sizeEnd = size * Lk.hold;
            o.stretch = Math.min(30, (seg / size) * 1.8);
            o.life = (Lk.life[0] + (Lk.life[1] - Lk.life[0]) * w) * (side ? 0.9 : 1);
            o.alphaEnd = Lk.fade;
            o.color = side ? Lk.edge ?? Lk.core : w > 0.92 ? Lk.hot : Lk.core;
            o.alpha = (0.55 + 0.45 * w) * (side ? 0.7 : 1);
          } else if (pass === 2) {
            // the flash: for a few frames the middle of the line is a blade of light
            if (w < 0.55) continue;
            o.size = Lk.flash.size * k * w;
            o.sizeEnd = Lk.size * k;
            o.stretch = Math.min(30, (seg / o.size) * 1.8);
            o.life = Lk.flash.life;
            o.color = Lk.hot;
            o.alpha = 1;
            o.alphaEnd = 0;
          } else {
            // the hairline: thinner, fainter, the last of it to go (the lines of a chain hang together)
            o.size = Lk.hair.size * k;
            o.sizeEnd = Lk.hair.size * k * 0.5;
            o.stretch = Math.min(40, (seg / o.size) * 1.6);
            o.life = Lk.hair.life * (0.6 + 0.4 * w);
            o.color = Lk.core;
            o.alpha = Lk.hair.alpha * w;
            o.alphaEnd = 0;
          }
          fx.spawn(o);
        }
      }
    }
  }
}
