import * as THREE from 'three';

// Position-based joint chains (neck, tail) + helpers that turn world-space bone directions into
// local joint rotations. Joints point +Z down their bone; consecutive joints sit `len` apart.

const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _perp = new THREE.Vector3();
const _d = new THREE.Vector3();

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
   */
  constructor(joints, len, { minY = 0.3, maxBend = 0.5, baseBend = 0.9 } = {}) {
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
    this.baseAxis = new THREE.Vector3(0, 0, 1);
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
  }

  /**
   * Rest polyline from `origin`, angles in `frameQ`:
   *   yaw_i = yaw0 + yawStep*i + waveAmp*sin(wavePhase - i*0.5)*(i/n)
   *   pitch_i = pitch0 + pitchStep*i + pitchCurve*i*i   (pitchCurve < 0 with pitchStep > 0 = S-curve)
   */
  buildRest(origin, frameQ, { pitch0 = 0, pitchStep = 0, pitchCurve = 0, yaw0 = 0, yawStep = 0, waveAmp = 0, wavePhase = 0 }) {
    const r = this.rest;
    r[0].copy(origin);
    for (let i = 0; i < this.n; i++) {
      const yaw = yaw0 + yawStep * i + waveAmp * Math.sin(wavePhase - i * 0.5) * (i / this.n);
      const pitch = pitch0 + pitchStep * i + pitchCurve * i * i;
      frameDir(_d, yaw, pitch, frameQ);
      if (i === 0) this.baseAxis.copy(_d);
      r[i + 1].copy(r[i]).addScaledVector(_d, this.len);
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
    for (let i = 0; i < n; i++) {
      _d.subVectors(p[i + 1], p[i]);
      const l = _d.length();
      if (l < 1e-6 || !Number.isFinite(l)) _d.copy(ref);
      else _d.multiplyScalar(1 / l);
      constrainDir(_d, ref, i === 0 ? this.baseBend : this.maxBend);
      p[i + 1].copy(p[i]).addScaledVector(_d, len);
      const minY = this.minY[i + 1];
      if (p[i + 1].y < minY) {
        p[i + 1].y = minY;
        _d.subVectors(p[i + 1], p[i]);
        const l2 = _d.length();
        if (l2 > 1e-6) {
          _d.multiplyScalar(1 / l2);
          p[i + 1].copy(p[i]).addScaledVector(_d, len);
        }
      }
      this.dirs[i].copy(_d);
      ref = this.dirs[i];
    }
  }

  /** Write joint rotations from `dirs`. parentQ = world quaternion of joints[0].parent. Returns last joint world quat. */
  apply(parentQ, out) {
    this._q.copy(parentQ);
    for (let i = 0; i < this.n; i++) {
      aimJoint(this.joints[i], this.dirs[i], this._q, this._q2);
      this._q.copy(this._q2);
    }
    return out.copy(this._q);
  }
}
