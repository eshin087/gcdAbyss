import * as THREE from 'three';
import { clamp } from '../../core/math.js';
import { DIM } from './model.js';

// Attack data + the blade sweep used for hit detection.
//
// Swing shapes (`anim`) are read by anim.js:
//   kind 'h' — horizontal slash; a0/a1/a2 = blade azimuth in body space (0 = ahead, + = the
//              knight's left) at coil / end of active frames / follow-through; elev = blade pitch.
//   kind 'v' — vertical slash; a0/a1/a2 = blade elevation (π/2 = straight up, 0 = ahead).
// The arc travels a0 → a1 during the active frames, so the blade crosses the front of the knight
// exactly while it can hit.

export const LIGHT = [
  {
    kind: 'light', combo: 1, cost: 14, damage: 30, poise: 12,
    windup: 0.18, active: 0.12, recovery: 0.35, lunge: 0.45,
    hitstop: 0.055, shake: 0.12,
    anim: { kind: 'h', a0: -1.9, a1: 1.25, a2: 1.75, elev: -0.12 }, // right → left
  },
  {
    kind: 'light', combo: 2, cost: 14, damage: 32, poise: 12,
    windup: 0.18, active: 0.12, recovery: 0.35, lunge: 0.45,
    hitstop: 0.055, shake: 0.12,
    anim: { kind: 'h', a0: 1.75, a1: -1.3, a2: -1.85, elev: -0.1 }, // left → right (backhand)
  },
  {
    kind: 'light', combo: 3, cost: 18, damage: 46, poise: 12,
    windup: 0.18, active: 0.12, recovery: 0.35, lunge: 0.6,
    hitstop: 0.055, shake: 0.12,
    anim: { kind: 'v', a0: 2.0, a1: -0.8, a2: -0.95 }, // overhead vertical
  },
];

export const HEAVY = {
  kind: 'heavy', combo: 1, cost: 32, damage: 80, poise: 40,
  windup: 0.5, active: 0.14, recovery: 0.55, lunge: 0.75,
  hitstop: 0.095, shake: 0.25,
  anim: { kind: 'v', a0: 2.5, a1: -0.75, a2: -0.85, heavy: true }, // lean back, overhead slam
};

const BLADE_R = 0.22; // forgiving blade half-width added to sphere radii (giant target, top-down camera)

/**
 * Tracks the blade segment (hilt → tip) in world space frame to frame and tests the swept
 * volume against the dragon's hurt spheres with 3 sub-steps.
 */
export class SwordSweep {
  constructor(sword) {
    this.sword = sword;
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
    this.b.set(0, 0, DIM.bladeTip).applyMatrix4(m);
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

  /**
   * Sweep last frame's blade to this frame's in 3 sub-steps. At the earliest sub-step that touches
   * anything, picks the deepest sphere. Fills out.{sphere, x, y, z} and returns true on a hit.
   */
  test(spheres, out) {
    if (!this.valid || !spheres || !spheres.length) return false;
    const sa = this._sa, sb = this._sb;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3;
      sa.lerpVectors(this.pa, this.a, t);
      sb.lerpVectors(this.pb, this.b, t);
      const abx = sb.x - sa.x, aby = sb.y - sa.y, abz = sb.z - sa.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let best = null, bestPen = 0, bestU = 0;
      for (let i = 0; i < spheres.length; i++) {
        const h = spheres[i];
        if (!h || !(h.r > 0) || !Number.isFinite(h.x + h.y + h.z)) continue;
        const u = len2 > 1e-9 ? clamp(((h.x - sa.x) * abx + (h.y - sa.y) * aby + (h.z - sa.z) * abz) / len2, 0, 1) : 0;
        const cx = sa.x + abx * u - h.x, cy = sa.y + aby * u - h.y, cz = sa.z + abz * u - h.z;
        const pen = h.r + BLADE_R - Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (pen > bestPen) {
          bestPen = pen;
          best = h;
          bestU = u;
        }
      }
      if (best) {
        out.sphere = best;
        out.x = sa.x + abx * bestU;
        out.y = sa.y + aby * bestU;
        out.z = sa.z + abz * bestU;
        return true;
      }
    }
    return false;
  }
}
