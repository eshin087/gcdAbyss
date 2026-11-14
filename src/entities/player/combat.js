import * as THREE from 'three';
import { clamp, lerp } from '../../core/math.js';
import { DIM } from './model.js';

// Attack data + the blade sweep used for hit detection. No stamina: pacing comes from windup /
// recovery only (docs/COMBAT.md). Moveset (ADR-041; owner concept sheet "Combat key poses"):
//   LMB tap ×5  a cut from the right → a backhand → a whirl (a full turn) → a lunge, all one-handed
//               (ADR-071), → the two-handed overhead SLAM (combo finisher: ground shard burst, more
//               damage + posture)
//   LMB while sprinting      SPRINT_ATK: a bounding rising slash that keeps the run's momentum
//   LMB out of a forward roll ROLL_ATK: a low cut rising out of the crouch
//               (both count as hit 1: the next tap is the rising backhand)
//   LMB hold    a deep coiled charge, the blade held up behind the right shoulder and glowing;
//               release = the dashing CLEAVE (the root travels forward, farther with more charge, and
//               the blade carves one diagonal through the target as the dash arrives)
//
// Swing shapes (`anim`) are read by anim.js:
//   kind 'clip'   — a keyframed clip from swings.js (`clip`: its name): the light swings and the
//                   cleave. The clip's keys run over this attack's windup / active frames / recovery,
//                   and its blade crosses the front of the hero inside the active frames, exactly
//                   while it can hit. Options: `spin` (±1: the whole body turns once through the
//                   active frames, − = to his right), `turn` (rad, + = to his left: a partial body
//                   pivot through the cut that turns back in the recovery), `hop` (m: a skip off the
//                   ground through the windup into the cut), `feet: 'dash'` (bounding steps for a
//                   long root travel instead of one lunge step; `dashW`: the dash starts at the
//                   windup's end).
//   kind 'slam'   — two-handed vertical slam; a0/a1/a2 = blade elevation (π/2 = straight up,
//                   0 = ahead, − = into the ground, > π/2 = back over the head) at the overhead
//                   coil / impact / follow-through; ready → raise = the windup's path to a0. Takes
//                   `hop` (a leap through the raise, landing on the impact).
//   kind 'thrust' — the execution's lunge: blade level along the facing line, hands driven forward.
//
// `variants` (Session 16, owner: "I don't want him to show the same pattern over and over"): other
// looks for the same hit. The animator picks `anim` or one of them at random when the hit starts
// (its own noise, never the game's RNG; never the same one twice in a row, and never a clip along
// the line the swing before it cut: swings.js `line`). Every variant keeps the hit's timing, damage,
// reach and lunge and sweeps the blade across his front inside the active frames, so the chain
// still connects (the REACH test swings each one).
//
// `lunge` = m stepped forward through the strike; `reach` = how far ahead of the hero the swing
// connects without stepping (used by the step-in assist to size the lunge, see REACH.assist).
// `chain` = the fraction of the recovery after which the next light may start: the cut carries
// through before the next one winds up (it was 0: a mashed chain cut each swing off as its active
// frames ended, 4 hits a second).
//
// Pace (Session 25, owner: the swings were "too fast to follow"): a light's windup and active
// frames are 0.16 / 0.18 s (they were 0.14 / 0.11) and a mashed chain lands a hit every ~0.42 s (it
// was 0.25 s); the lights' damage and posture went up x1.4 with it, so a chain's damage per second
// is about what it was.

export const LIGHT = [
  {
    // 1, a cut from the right. The falling cut: cocked beside the head (blade up-back-right) → a
    // diagonal down across the front → low past the left hip
    name: 'fallingCut', kind: 'light', combo: 1, damage: 42, poise: 17, heavy: false,
    windup: 0.16, active: 0.18, recovery: 0.26, chain: 0.3, lunge: 0.55, reach: 2.2,
    hitstop: 0.06, shake: 0.12,
    anim: { kind: 'clip', clip: 'fallingCut' }, // high right → low left
    variants: [
      { kind: 'clip', clip: 'drawCut', turn: 0.3 }, // low and flat from the right hip, pivoting into it
      { kind: 'clip', clip: 'leapCut', hop: 0.14 }, // a skip in, straight down the middle
    ],
  },
  {
    // 2, a backhand from the left. The rising backhand: from low at the left hip up across the front
    // to high right
    name: 'risingCut', kind: 'light', combo: 2, damage: 45, poise: 17, heavy: false,
    windup: 0.16, active: 0.18, recovery: 0.26, chain: 0.3, lunge: 0.55, reach: 2.2,
    hitstop: 0.06, shake: 0.12,
    anim: { kind: 'clip', clip: 'risingBackhand' }, // low left → high right
    variants: [
      { kind: 'clip', clip: 'flatBackhand', turn: -0.4 }, // level at chest height, pivoting round with it
      { kind: 'clip', clip: 'fallingBackhand' }, // from over the left shoulder down to the right hip
    ],
  },
  {
    // 3, the whirl: he follows the backhand round to his right, a full turn with the sword arm thrown
    // out level; the blade crosses the front two thirds of the way round, inside the active frames
    name: 'whirl', kind: 'light', combo: 3, damage: 50, poise: 22, heavy: false,
    windup: 0.18, active: 0.2, recovery: 0.28, chain: 0.3, lunge: 0.7, reach: 2.2,
    hitstop: 0.07, shake: 0.16,
    anim: { kind: 'clip', clip: 'whirl', spin: -1 },
    variants: [
      { kind: 'clip', clip: 'risingWhirl', spin: -1 }, // the same turn out of a crouch, the blade spiralling up
      { kind: 'clip', clip: 'lowSweep' }, // no turn: a crouching sweep along the grass
    ],
  },
  {
    // 4, the lunge (def name `stab`): the hand draws back to the right ribs, then one long line from
    // the rear heel to the point
    name: 'stab', kind: 'light', combo: 4, damage: 42, poise: 19, heavy: false,
    windup: 0.15, active: 0.12, recovery: 0.26, chain: 0.3, lunge: 0.8, reach: 2.3,
    hitstop: 0.065, shake: 0.14,
    anim: { kind: 'clip', clip: 'lunge' },
    variants: [
      { kind: 'clip', clip: 'risingThrust' }, // out of a crouch, the point driving up into the target
    ],
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
    variants: [
      // a leap through the raise, landing on the blow
      { kind: 'slam', ready: -0.86, raise: 2.54, a0: 3.75, a1: -0.72, a2: -0.8, hop: 0.16 },
    ],
  },
];

/** LMB while sprinting: a bounding rising slash, low right → high left, that carries the run's
 *  momentum `travel` m along the run direction (`keepYaw`: it does not snap to the aim). Counts as
 *  hit 1 of the combo. */
export const SPRINT_ATK = {
  name: 'sprintSlash', kind: 'light', combo: 1, damage: 40, poise: 18, heavy: false,
  windup: 0.14, active: 0.16, recovery: 0.36, chain: 0.25, lunge: 0, travel: 2.4, keepYaw: true, reach: 2.3,
  hitstop: 0.07, shake: 0.2,
  anim: { kind: 'clip', clip: 'sprintSlash', feet: 'dash' },
};

/** LMB out of a forward roll: a low cut that rises out of the crouch, right → left. Counts as hit 1
 *  of the combo. */
export const ROLL_ATK = {
  name: 'rollCut', kind: 'light', combo: 1, damage: 34, poise: 14, heavy: false,
  windup: 0.12, active: 0.14, recovery: 0.28, chain: 0.3, lunge: 0.9, reach: 2.2,
  hitstop: 0.06, shake: 0.14,
  anim: { kind: 'clip', clip: 'rollCut' },
};

/** The charged attack (hold LMB, release): the DASHING CLEAVE. The charge itself is the windup, so
 *  the release is quick: he bursts `travel` m forward (lerped by charge; `dash`: the root's travel
 *  runs through the active frames, front-loaded) with the blade cocked behind the right shoulder,
 *  and carves one two-handed diagonal through whatever the dash reaches as it dies out (the blade
 *  crosses his front over the last 40 % of the active frames), ending low in a long lunge.
 *  (Was a lunging thrust: the owner, session 25: "an impactful slash with a cool weightful hit
 *  instead of a poke".) */
export const CLEAVE = {
  name: 'cleave', kind: 'cleave', combo: 1, heavy: true, dash: true,
  damage: [70, 110], poise: [30, 50], // lerped by charge (see chargeStats)
  travel: [2.2, 3.6],
  windup: 0.08, active: 0.24, recovery: 0.45, lunge: 0, reach: 2.3,
  hitstop: 0.15, shake: 0.45,
  anim: { kind: 'clip', clip: 'cleave', feet: 'dash', dashW: true },
};

/** The lunging thrust: the execution against a broken duelist (player.js _startExecuteThrust). The
 *  root travels forward through the active frames (`dash`). */
export const THRUST = {
  name: 'thrust', kind: 'thrust', combo: 1, heavy: true, dash: true,
  damage: [70, 110], poise: [30, 50],
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

/** Charge fraction 0..1 and the charged attack's damage / poise / travel for a hold of `holdT`
 *  seconds (`def`: CLEAVE, or THRUST for the execution). */
export function chargeStats(holdT, def = CLEAVE) {
  const k = clamp((Number.isFinite(holdT) ? holdT - CHARGE.hold : 0) / (CHARGE.full - CHARGE.hold), 0, 1);
  return {
    k,
    damage: lerp(def.damage[0], def.damage[1], k),
    poise: lerp(def.poise[0], def.poise[1], k),
    travel: lerp(def.travel[0], def.travel[1], k),
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
