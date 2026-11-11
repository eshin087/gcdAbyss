import * as THREE from 'three';
import { clamp, lerp } from '../../core/math.js';
import { DIM } from './model.js';

// Attack data + the blade sweep used for hit detection. No stamina: pacing comes from windup /
// recovery only (docs/COMBAT.md). Moveset (ADR-041; owner concept sheet "Combat key poses"):
//   LMB tap ×5  falling cut → rising backhand → whirl (a full turn) → stab → two-handed overhead
//               SLAM (combo finisher: ground shard burst, more damage + posture)
//   LMB while sprinting      SPRINT_ATK: a bounding rising slash that keeps the run's momentum
//   LMB out of a forward roll ROLL_ATK: a low cut rising out of the crouch
//               (both count as hit 1: the next tap is the rising backhand)
//   LMB hold    low crouched charge, blade drawn back and glowing; release = lunging THRUST (the
//               root travels forward, farther with more charge)
//
// Swing shapes (`anim`) are read by anim.js:
//   kind 'h'      — a sweep round the body; a0/a1/a2 = blade azimuth in body space (0 = ahead, + =
//                   the hero's left) at coil / end of active frames / follow-through; elev0 → elev →
//                   elev2 = blade pitch at the coil, the strike and the end of the follow-through
//                   (a big elev0 → elev change makes it a diagonal cut). Options: `loop` (the windup
//                   loop over the right shoulder + the free hand's reach: hit 1), `spin` (±1: the
//                   whole body turns once, − = to his right, while the blade is held out), `sink`
//                   (m the hips drop through the cut), `feet: 'dash'` (bounding steps for a long
//                   root travel instead of one lunge step).
//   kind 'stab'   — a one-handed thrust: the hand draws back to the right ribs, then drives the
//                   level blade straight out along the facing line.
//   kind 'slam'   — two-handed vertical slam; a0/a1/a2 = blade elevation (π/2 = straight up,
//                   0 = ahead, − = into the ground, > π/2 = back over the head) at the overhead
//                   coil / impact / follow-through; ready → raise = the windup's path to a0.
//   kind 'thrust' — the charged lunge: blade level along the facing line, hand driven forward.
// The arc travels a0 → a1 during the active frames, so the blade crosses the front of the hero
// exactly while it can hit.
//
// `lunge` = m stepped forward through the strike; `reach` = how far ahead of the hero the swing
// connects without stepping (used by the step-in assist to size the lunge, see REACH.assist).

export const LIGHT = [
  {
    // 1, the falling cut: cocked over the right shoulder (blade up-back-right) → a diagonal down
    // across the front → low at the left hip. (Was a flat sweep at chest height; with hit 2 it read
    // as the same arc twice.)
    name: 'fallingCut', kind: 'light', combo: 1, damage: 30, poise: 12, heavy: false,
    windup: 0.14, active: 0.11, recovery: 0.22, lunge: 0.55, reach: 2.2,
    hitstop: 0.055, shake: 0.12,
    anim: { kind: 'h', loop: true, a0: -2.0, a1: 1.9, a2: 2.3, elev0: 0.75, elev: -0.3, elev2: -0.45 }, // high right → low left
  },
  {
    // 2, the rising backhand: from low at the left hip up across the front to high right
    name: 'risingCut', kind: 'light', combo: 2, damage: 32, poise: 12, heavy: false,
    windup: 0.14, active: 0.11, recovery: 0.22, lunge: 0.55, reach: 2.2,
    hitstop: 0.055, shake: 0.12,
    anim: { kind: 'h', a0: 2.2, a1: -1.85, a2: -2.25, elev0: -0.5, elev: 0.45, elev2: 0.85 }, // low left → high right
  },
  {
    // 3, the whirl: he follows the backhand round to his right, a full turn with the blade held out
    // level; it crosses the front two thirds of the way round, inside the active frames
    name: 'whirl', kind: 'light', combo: 3, damage: 36, poise: 16, heavy: false,
    windup: 0.16, active: 0.17, recovery: 0.24, lunge: 0.7, reach: 2.2,
    hitstop: 0.065, shake: 0.16,
    anim: { kind: 'h', spin: -1, a0: -2.2, a1: -1.0, a2: -0.35, elev0: 0.3, elev: 0.0, elev2: -0.2 },
  },
  {
    // 4, the stab: the hand draws back to the right ribs, then drives the point straight out
    name: 'stab', kind: 'light', combo: 4, damage: 30, poise: 14, heavy: false,
    windup: 0.12, active: 0.09, recovery: 0.22, lunge: 0.8, reach: 2.3,
    hitstop: 0.06, shake: 0.14,
    anim: { kind: 'stab' },
  },
  {
    // 5, the combo finisher: raise two-handed overhead, slam down, crystal shards burst from the ground
    name: 'slam', kind: 'slam', combo: 5, damage: 58, poise: 40, heavy: true,
    windup: 0.4, active: 0.12, recovery: 0.48, lunge: 0.75, reach: 2.1,
    hitstop: 0.11, shake: 0.42,
    up: 1.0, // reach band above the blade: lower than the sweeps' so the raise can't tag the neck overhead
    shards: { radius: 1.7, height: 3.2 }, // ground burst at the impact point (hits if the blade missed)
    // windup: blade low ahead (ready) → up-back 33° past the head (raise, mid-windup) → hanging
    // down the back at the apex (a0, the wrists coil); active: over the top into the ground ahead
    anim: { kind: 'slam', ready: -0.86, raise: 2.54, a0: 3.75, a1: -0.72, a2: -0.8 },
  },
];

/** LMB while sprinting: a bounding rising slash, low right → high left, that carries the run's
 *  momentum `travel` m along the run direction (`keepYaw`: it does not snap to the aim). Counts as
 *  hit 1 of the combo. */
export const SPRINT_ATK = {
  name: 'sprintSlash', kind: 'light', combo: 1, damage: 40, poise: 18, heavy: false,
  windup: 0.14, active: 0.14, recovery: 0.36, lunge: 0, travel: 2.4, keepYaw: true, reach: 2.3,
  hitstop: 0.07, shake: 0.2,
  anim: { kind: 'h', a0: -2.5, a1: 1.7, a2: 2.35, elev0: -0.6, elev: 0.4, elev2: 0.9, feet: 'dash' },
};

/** LMB out of a forward roll: a low cut that rises out of the crouch, right → left. Counts as hit 1
 *  of the combo. */
export const ROLL_ATK = {
  name: 'rollCut', kind: 'light', combo: 1, damage: 34, poise: 14, heavy: false,
  windup: 0.1, active: 0.11, recovery: 0.26, lunge: 0.9, reach: 2.2,
  hitstop: 0.06, shake: 0.14,
  anim: { kind: 'h', a0: -2.3, a1: 1.6, a2: 2.2, elev0: -0.45, elev: -0.05, elev2: 0.6, sink: 0.2 },
};

/** Charged lunging thrust (hold LMB, release). The charge itself is the windup, so the release is
 *  quick; the hero travels `travel` m (lerped by charge) during the active frames. */
export const THRUST = {
  kind: 'thrust', combo: 1, heavy: true,
  damage: [70, 110], poise: [30, 50], // lerped by charge (see thrustStats)
  travel: [2.2, 3.6],
  windup: 0.07, active: 0.2, recovery: 0.45, lunge: 0, reach: 2.3,
  hitstop: 0.1, shake: 0.3,
  anim: { kind: 'thrust' },
};

export const CHARGE = {
  hold: 0.3, // s LMB must be held before a press becomes a charge (shorter = light attack on release)
  full: 1.2, // s of hold for full damage
  maxHold: 2.6, // auto-release (also guards against a lost mouseup)
  move: 0.4, // movement multiplier while charging (low crouched stance)
};

/**
 * Reach against giant targets. The wyrm's chest hangs 2–4 m above the grass, above any sword
 * swung at a 1.75 m hero's chest height, so the blade hits through a vertical BAND: a hurt sphere
 * counts when it overlaps the blade's swept wall extended `up` m above its highest point and
 * `down` m below its lowest (horizontal distance + leftover vertical gap vs radius + `radius`); an attack may lower `up` (its own `up`).
 * `tipExt` lengthens the hit segment past the steel (the cyan edge wave). The step-in assist
 * stretches the lunge (by at most `max` m) toward a hurt surface within `range` m and `arc` rad of
 * the facing, so swings started a few metres out still land.
 */
export const REACH = {
  radius: 0.24,
  up: 2.6,
  down: 0.5,
  tipExt: 0.4,
  assist: { range: 4.8, arc: 0.8, max: 1.3 },
};

/** Charge fraction 0..1 and the thrust's damage / poise / travel for a hold of `holdT` seconds. */
export function thrustStats(holdT) {
  const k = clamp((Number.isFinite(holdT) ? holdT - CHARGE.hold : 0) / (CHARGE.full - CHARGE.hold), 0, 1);
  return {
    k,
    damage: lerp(THRUST.damage[0], THRUST.damage[1], k),
    poise: lerp(THRUST.poise[0], THRUST.poise[1], k),
    travel: lerp(THRUST.travel[0], THRUST.travel[1], k),
  };
}

/**
 * Deepest hurt sphere touched by the vertical wall over segment a→b (band [min y − down, max y +
 * up]), widened by `rad`. Fills out.{sphere, x, y, z} (contact point: on the segment in plan, at
 * the sphere's underside / the band) and returns the penetration (> 0 = hit), else 0.
 */
export function bandHit(spheres, ax, ay, az, bx, by, bz, rad, up, down, out) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  const lo = Math.min(ay, by) - down, hi = Math.max(ay, by) + up;
  let best = null, bestPen = 0, bu = 0, by0 = 0;
  for (let i = 0; i < spheres.length; i++) {
    const h = spheres[i];
    if (!h || !(h.r > 0) || !Number.isFinite(h.x + h.y + h.z)) continue;
    const u = len2 > 1e-9 ? clamp(((h.x - ax) * abx + (h.z - az) * abz) / len2, 0, 1) : 0;
    const cx = ax + abx * u - h.x, cz = az + abz * u - h.z;
    const dh2 = cx * cx + cz * cz;
    const dy = h.y < lo ? lo - h.y : h.y > hi ? h.y - hi : 0;
    const pen = h.r + rad - Math.sqrt(dh2 + dy * dy);
    if (pen > bestPen) {
      bestPen = pen;
      best = h;
      bu = u;
      // contact height: the sphere's surface above / below this plan point, kept inside the band
      const sy = Math.sqrt(Math.max(0, h.r * h.r - dh2));
      const segY = ay + (by - ay) * u;
      by0 = clamp(segY < h.y ? h.y - sy : h.y + sy, lo, hi);
    }
  }
  if (!best) return 0;
  out.sphere = best;
  out.x = ax + abx * bu;
  out.y = by0;
  out.z = az + abz * bu;
  return bestPen;
}

/**
 * Tracks the blade segment (hilt → tip + REACH.tipExt) in world space frame to frame and tests the
 * swept volume against hurt spheres with 3 sub-steps through the vertical reach band.
 */
export class SwordSweep {
  /** `unlean(v)` (optional) maps a visual world point onto the upright gameplay body before hit
   *  tests; a, b, pa, pb and point() stay visual (trails and sparks follow the drawn blade). */
  constructor(sword, unlean = null) {
    this.sword = sword;
    this.unlean = unlean;
    this.a = new THREE.Vector3(); // hilt, this frame
    this.b = new THREE.Vector3(); // tip, this frame
    this.pa = new THREE.Vector3(); // last frame
    this.pb = new THREE.Vector3();
    this.valid = false;
    this._sa = new THREE.Vector3();
    this._sb = new THREE.Vector3();
  }

  /** Read the blade from the sword's (freshly updated) matrixWorld. */
  sample() {
    const m = this.sword.matrixWorld;
    this.a.set(0, 0, DIM.bladeBase).applyMatrix4(m);
    this.b.set(0, 0, DIM.bladeTip + REACH.tipExt).applyMatrix4(m);
    if (!Number.isFinite(this.a.x + this.a.y + this.a.z + this.b.x + this.b.y + this.b.z)) {
      this.valid = false;
      return false;
    }
    if (!this.valid) {
      this.pa.copy(this.a);
      this.pb.copy(this.b);
      this.valid = true;
    }
    return true;
  }

  commit() {
    if (!this.valid) return;
    this.pa.copy(this.a);
    this.pb.copy(this.b);
  }

  /** Point `f` (0 hilt … 1 visible tip) along the current blade. */
  point(f, out) {
    const k = (DIM.bladeTip - DIM.bladeBase) / (DIM.bladeTip + REACH.tipExt - DIM.bladeBase);
    return out.lerpVectors(this.a, this.b, f * k);
  }

  /**
   * Sweep last frame's blade to this frame's in 3 sub-steps. At the earliest sub-step that touches
   * anything, picks the deepest sphere. Fills out.{sphere, x, y, z} and returns true on a hit.
   */
  test(spheres, out, up = REACH.up) {
    if (!this.valid || !spheres || !spheres.length) return false;
    const sa = this._sa, sb = this._sb;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3;
      sa.lerpVectors(this.pa, this.a, t);
      sb.lerpVectors(this.pb, this.b, t);
      if (this.unlean) {
        this.unlean(sa);
        this.unlean(sb);
      }
      if (bandHit(spheres, sa.x, sa.y, sa.z, sb.x, sb.y, sb.z, REACH.radius, up, REACH.down, out) > 0) return true;
    }
    return false;
  }
}
