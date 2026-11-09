import * as THREE from 'three';

// Position-based joint chains (neck, tail) + helpers that turn world-space bone directions into
// local joint rotations. Joints point +Z down their bone; consecutive joints sit `len` apart.

const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _perp = new THREE.Vector3();
const _d = new THREE.Vector3();
const _rd = new THREE.Vector3();

/**
 * Rotate `joint` so its +Z follows world direction `dir`, given the parent's world quaternion.
 * Writes the joint's resulting world quaternion into `outWorld` and returns it.
 */
export function aimJoint(joint, dir, parentWorldQ, outWorld) {
  _qi.copy(parentWorldQ).invert();
  _v.copy(dir).applyQuaternion(_qi);
  const l = _v.length();
  if (l > 1e-6 && Number.isFinite(l)) {
    _v.multiplyScalar(1 / l);
    joint.quaternion.setFromUnitVectors(Z, _v);
  }
  return outWorld.copy(parentWorldQ).multiply(joint.quaternion);
}

const _qd = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _pz = new THREE.Vector3();
/**
 * aimJoint with twist continuity. The minimal rotation from +Z (aimJoint's convention: the roll the
 * model's spikes were authored for) is singular when the bone points back along its parent's -Z (a
 * folded or drooping wing's humerus, a finger lying back along the forearm, a foreleg reaching far
 * behind): there its twist can spin ~180° in one frame, flipping every spike, claw and child joint.
 * Near that cone the joint instead swings minimally from LAST frame's local rotation (parallel
 * transport, always continuous) and eases back to the authored roll as the bone leaves it, so a
 * still pose always settles on exactly the aimJoint roll. `snap` = take the authored roll at once.
 */
export function aimJointStable(joint, dir, parentWorldQ, outWorld, snap = false) {
  _qi.copy(parentWorldQ).invert();
  _v.copy(dir).applyQuaternion(_qi);
  const l = _v.length();
  if (l > 1e-6 && Number.isFinite(l)) {
    _v.multiplyScalar(1 / l);
    _qd.setFromUnitVectors(Z, _v);
    // conditioning of the authored roll: 1 for bones within ~80° of +Z, 0 beyond ~140°
    const t = Math.min(1, Math.max(0, (_v.z + 0.75) / 0.95));
    const w = snap ? 1 : t * t * (3 - 2 * t);
    if (w < 0.999) {
      _pz.set(0, 0, 1).applyQuaternion(joint.quaternion);
      if (_pz.dot(_v) > -0.9) {
        _qp.setFromUnitVectors(_pz, _v).multiply(joint.quaternion);
        joint.quaternion.copy(_qp).slerp(_qd, w);
        if (!Number.isFinite(joint.quaternion.x + joint.quaternion.y + joint.quaternion.z + joint.quaternion.w)) joint.quaternion.copy(_qd);
      } else joint.quaternion.copy(_qd); // a reversal in one frame (teleport): nothing to continue
    } else joint.quaternion.copy(_qd);
  }
  return outWorld.copy(parentWorldQ).multiply(joint.quaternion);
}

/** Clamp unit vector `d` to within `maxAngle` of unit vector `ref` (in place). */
export function constrainDir(d, ref, maxAngle) {
  const c = d.dot(ref);
  const cosMax = Math.cos(maxAngle);
  if (c >= cosMax) return d;
  _perp.copy(d).addScaledVector(ref, -c);
  let pl = _perp.length();
  if (pl < 1e-6) {
    // opposite: pick any perpendicular
    _perp.set(ref.y, -ref.x, 0);
    if (_perp.lengthSq() < 1e-6) _perp.set(0, ref.z, -ref.y);
    pl = _perp.length();
  }
  _perp.multiplyScalar(1 / pl);
  return d.copy(ref).multiplyScalar(cosMax).addScaledVector(_perp, Math.sin(maxAngle));
}

/** Direction from yaw/pitch in a frame (yaw about +Y from +Z toward +X, pitch up). */
export function frameDir(out, yaw, pitch, frameQ) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).applyQuaternion(frameQ);
}

export class Chain {
  /**
   * joints: Object3D[] (each child of the previous), len: segment length,
   * minY: number | number[] (per point, ground clearance), maxBend / baseBend in radians.
   * groundGlide / stableTwist: see enforce() / apply() (the tail uses both; the neck keeps v0.4's)
   */
  constructor(joints, len, { minY = 0.3, maxBend = 0.5, baseBend = 0.9, groundGlide = false, stableTwist = false } = {}) {
    this.joints = joints;
    this.n = joints.length;
    this.len = len;
    const mk = () => Array.from({ length: this.n + 1 }, () => new THREE.Vector3());
    this.p = mk();
    this.rest = mk();
    this.vel = mk();
    this.prev = mk();
    this.dirs = Array.from({ length: this.n }, () => new THREE.Vector3(0, 0, 1));
    this.minY = Array.isArray(minY) ? minY : new Array(this.n + 1).fill(minY);
    this.maxBend = maxBend;
    this.baseBend = baseBend;
    // ground contact keeps each segment's length and heading over the ground (see enforce); off = the
    // v0.4 lift-and-restretch the neck's lying / stunned poses were tuned with
    this.groundGlide = groundGlide;
    this.stableTwist = stableTwist;
    // soft limit on how far each segment may swing away from its REST direction (radians; see
    // enforce): `devSoft` starts compressing the swing, `devMax` caps it. Infinity = off (v0.4)
    this.devSoft = Infinity;
    this.devMax = Infinity;
    this.baseAxis = new THREE.Vector3(0, 0, 1);
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
  }

  /**
   * Rest polyline from `origin`, angles in `frameQ`:
   *   yaw_i = yaw0 + yawStep*i + yawCurve*i*i + waveAmp*sin(wavePhase - i*0.5)*(i/n)
   *   pitch_i = pitch0 + pitchStep*i + pitchCurve*i*i - dipAmp*exp(-((i - dipAt) / dipWidth)^2)
   *   (pitchCurve < 0 with pitchStep > 0 = S-curve; the dip bends a stretch of segments around dipAt
   *   down and lets the ones after it level out again: a carried tail arching down to the ground)
   * yawCurve > 0 makes a lateral HOOK (straight at the base, curling ever tighter toward the tip);
   * a constant yawStep makes a circle.
   */
  buildRest(origin, frameQ, { pitch0 = 0, pitchStep = 0, pitchCurve = 0, yaw0 = 0, yawStep = 0, yawCurve = 0, waveAmp = 0, wavePhase = 0, dipAmp = 0, dipAt = 0, dipWidth = 1, sinkMax = Infinity }) {
    const r = this.rest;
    r[0].copy(origin);
    const dip = dipAmp !== 0 && dipWidth > 1e-3;
    const sink = Number.isFinite(sinkMax) ? sinkMax * this.len : Infinity;
    for (let i = 0; i < this.n; i++) {
      const yaw = yaw0 + yawStep * i + yawCurve * i * i + waveAmp * Math.sin(wavePhase - i * 0.5) * (i / this.n);
      let pitch = pitch0 + pitchStep * i + pitchCurve * i * i;
      if (dip) {
        const u = (i - dipAt) / dipWidth;
        pitch -= dipAmp * Math.exp(-u * u);
      }
      frameDir(_d, yaw, pitch, frameQ);
      if (i === 0) this.baseAxis.copy(_d);
      r[i + 1].copy(r[i]).addScaledVector(_d, this.len);
      // sinkMax (segments): a rest shape that dives deep under the ground clearance (a tail slapped
      // flat, the stunned / dead tail) is laid along the ground instead, at most sinkMax segments under
      // it, keeping the segment's length and heading. The springs used to pull those points metres
      // into the ground against the clamp in enforce(): the lying segments fought it and flickered
      // 30-65° a frame. A rest shape that stays within sinkMax (the arched resting tail) is untouched
      const floor = this.minY[i + 1] - sink;
      if (r[i + 1].y < floor) {
        const dy = floor - r[i].y;
        const hx = _d.x, hz = _d.z, hl = Math.hypot(hx, hz);
        if (Math.abs(dy) < this.len && hl > 1e-4) {
          const h = Math.sqrt(this.len * this.len - dy * dy) / hl;
          r[i + 1].set(r[i].x + hx * h, floor, r[i].z + hz * h);
        } else r[i + 1].y = floor;
      }
    }
  }

  snap() {
    for (let i = 0; i <= this.n; i++) {
      this.p[i].copy(this.rest[i]);
      this.vel[i].set(0, 0, 0);
    }
    this.enforce();
  }

  /** Ease every point (except the base) toward the rest shape. k in 0..1. */
  pull(k) {
    this.p[0].copy(this.rest[0]);
    for (let i = 1; i <= this.n; i++) this.p[i].lerp(this.rest[i], k);
  }

  /** Damped springs toward the rest shape, stiffer at the base; then length/bend constraints. */
  spring(dt, kBase, kTip, zeta) {
    const n = this.n;
    this.p[0].copy(this.rest[0]);
    for (let i = 1; i <= n; i++) {
      const t = Math.pow(i / n, 0.7);
      const k = kBase + (kTip - kBase) * t;
      const c = 2 * zeta * Math.sqrt(k);
      const p = this.p[i], v = this.vel[i], r = this.rest[i];
      this.prev[i].copy(p);
      v.x += (k * (r.x - p.x) - c * v.x) * dt;
      v.y += (k * (r.y - p.y) - c * v.y) * dt;
      v.z += (k * (r.z - p.z) - c * v.z) * dt;
      p.addScaledVector(v, dt);
    }
    this.enforce();
    if (dt > 1e-5) {
      for (let i = 1; i <= n; i++) {
        this.vel[i].subVectors(this.p[i], this.prev[i]).multiplyScalar(1 / dt);
        if (!Number.isFinite(this.vel[i].x + this.vel[i].y + this.vel[i].z)) this.vel[i].set(0, 0, 0);
        this.vel[i].clampLength(0, 60);
      }
    }
  }

  /** FABRIK toward `target` for the end point, with bend limits enforced on each forward pass. */
  solve(target, iterations = 3) {
    const n = this.n, p = this.p, len = this.len;
    for (let it = 0; it < iterations; it++) {
      p[n].copy(target);
      for (let i = n - 1; i >= 0; i--) {
        _d.subVectors(p[i], p[i + 1]);
        const l = _d.length();
        if (l < 1e-6) _d.copy(this.dirs[i]).negate();
        else _d.multiplyScalar(1 / l);
        p[i].copy(p[i + 1]).addScaledVector(_d, len);
      }
      p[0].copy(this.rest[0]);
      this.enforce();
    }
  }

  /** Forward pass from the base: segment lengths, bend limits, ground clearance. */
  enforce() {
    const n = this.n, p = this.p, len = this.len;
    p[0].copy(this.rest[0]);
    let ref = this.baseAxis;
    const dev = this.devSoft < this.devMax || Number.isFinite(this.devMax);
    for (let i = 0; i < n; i++) {
      _d.subVectors(p[i + 1], p[i]);
      const l = _d.length();
      if (l < 1e-6 || !Number.isFinite(l)) _d.copy(ref);
      else _d.multiplyScalar(1 / l);
      if (dev) {
        // never further than devMax from the rest direction (softly beyond devSoft): a tail whipped by
        // a fast body (the stomp's slam, a rake) used to fold back on itself into a U lying on the
        // ground, and the fold rolled down the chain, every joint it passed spinning 20-40° a frame
        _rd.subVectors(this.rest[i + 1], this.rest[i]);
        const rl = _rd.length();
        if (rl > 1e-6) {
          _rd.multiplyScalar(1 / rl);
          const a = Math.acos(Math.min(1, Math.max(-1, _d.dot(_rd))));
          if (a > this.devSoft) constrainDir(_d, _rd, Math.min(this.devMax, this.devSoft + (a - this.devSoft) * 0.4));
        }
      }
      constrainDir(_d, ref, i === 0 ? this.baseBend : this.maxBend);
      p[i + 1].copy(p[i]).addScaledVector(_d, len);
      const minY = this.minY[i + 1];
      if (p[i + 1].y < minY) {
        // onto the ground, keeping the segment's length and its heading over the ground. (Lifting the
        // end straight up and re-stretching the segment along the new direction pushed it back under
        // the ground whenever the lift had shortened it: the next segment then had to point back up
        // out of it, folding the chain ~130°, and unfolding flipped the rest of it 180° in a frame.)
        const dy = minY - p[i].y;
        let hx = p[i + 1].x - p[i].x, hz = p[i + 1].z - p[i].z;
        let hl = Math.hypot(hx, hz);
        if (hl < 1e-4 * len) {
          hx = ref.x;
          hz = ref.z;
          hl = Math.hypot(hx, hz);
        }
        if (this.groundGlide && dy < len && hl > 1e-6) {
          const h = Math.sqrt(len * len - dy * dy) / hl;
          p[i + 1].set(p[i].x + hx * h, minY, p[i].z + hz * h);
          _d.subVectors(p[i + 1], p[i]).multiplyScalar(1 / len);
        } else {
          p[i + 1].y = minY;
          _d.subVectors(p[i + 1], p[i]);
          const l2 = _d.length();
          if (l2 > 1e-6) {
            _d.multiplyScalar(1 / l2);
            p[i + 1].copy(p[i]).addScaledVector(_d, len);
          }
        }
      }
      this.dirs[i].copy(_d);
      ref = this.dirs[i];
    }
  }

  /**
   * Write joint rotations from `dirs`. parentQ = world quaternion of joints[0].parent. Returns last joint
   * world quat. stableTwist: aimJointStable instead of aimJoint. The bend limits keep every segment
   * within ~35° of the one before, where the two are identical, but the ground clamp in enforce() can
   * fold a segment back on itself (a tail slapped into the ground): there the minimal rotation flipped
   * the roll of that joint and everything after it ~180° in one frame.
   */
  apply(parentQ, out) {
    this._q.copy(parentQ);
    for (let i = 0; i < this.n; i++) {
      if (this.stableTwist) aimJointStable(this.joints[i], this.dirs[i], this._q, this._q2);
      else aimJoint(this.joints[i], this.dirs[i], this._q, this._q2);
      this._q.copy(this._q2);
    }
    return out.copy(this._q);
  }

  /**
   * World rotation the LAST joint would get from apply() (aimJoint, no stable twist), without touching
   * the joints: lets another chain be shown while a child is placed as if this one were.
   */
  endQuat(parentQ, out) {
    out.copy(parentQ);
    for (let i = 0; i < this.n; i++) {
      _qi.copy(out).invert();
      _v.copy(this.dirs[i]).applyQuaternion(_qi);
      const l = _v.length();
      if (l > 1e-6 && Number.isFinite(l)) out.multiply(_qe.setFromUnitVectors(Z, _v.multiplyScalar(1 / l)));
      else out.multiply(this.joints[i].quaternion);
    }
    return out;
  }
}
