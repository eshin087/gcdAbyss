import * as THREE from 'three';

// Analytic two-bone IK: root A, target T, bone lengths l1/l2, `pole` = world direction the
// middle joint should bend toward. Writes the middle joint and the reached end point.
// `bend` (optional, per limb, persistent): last frame's unit bend direction. When the pole runs
// nearly parallel to the root -> target axis (a paw raised straight out in front of a backward pole,
// a foot trailing along a forward one) its perpendicular part vanishes and flips sign, so the elbow /
// knee would jump to the other side in one frame; there the bend leans on last frame's instead.

const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();

export function solveTwoBone(A, T, l1, l2, pole, outMid, outEnd, bend = null, soft = 0) {
  _u.subVectors(T, A);
  let d = _u.length();
  if (d < 1e-5 || !Number.isFinite(d)) {
    _u.copy(pole).normalize();
    d = 1e-3;
  } else {
    _u.multiplyScalar(1 / d);
  }
  const minD = Math.abs(l1 - l2) + 0.02;
  const maxD = l1 + l2 - 0.002;
  // soft IK (`soft` = fraction of the reach): over the last stretch the reached distance eases toward
  // full extension instead of hitting it, so a limb pulled out of a nearly straight pose bends
  // smoothly (near full extension a small change in distance swings the middle joint far: a wing
  // lowered from a high spread popped its elbow 1.3 m in one frame). The end then falls a little short
  if (soft > 0 && d > maxD * (1 - soft)) {
    const ds = maxD * (1 - soft), span = maxD - ds;
    d = ds + span * (1 - Math.exp(-(d - ds) / span));
  }
  d = Math.min(maxD, Math.max(minD, d));
  let cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  cosA = Math.min(1, Math.max(-1, cosA));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // bend direction: pole projected perpendicular to the A->T axis
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  const pl = pole.length();
  let wl = _w.length();
  if (bend && bend.lengthSq() > 0.25 && pl > 1e-6) {
    _p.copy(bend).addScaledVector(_u, -bend.dot(_u));
    const plen = _p.length();
    if (plen > 1e-4) {
      // 1 = the pole is well conditioned (>= ~30° off the axis), 0 = degenerate (< ~9°)
      const t = Math.min(1, Math.max(0, (wl / pl - 0.15) / 0.35));
      const k = t * t * (3 - 2 * t);
      if (k < 0.999) {
        _p.multiplyScalar(1 / plen);
        if (wl > 1e-8) _w.multiplyScalar(1 / wl);
        else _w.set(0, 0, 0);
        _w.multiplyScalar(k).addScaledVector(_p, 1 - k);
        wl = _w.length();
      }
    }
  }
  if (wl < 1e-8) {
    _w.set(_u.y, -_u.x, 0);
    if (_w.lengthSq() < 1e-8) _w.set(0, _u.z, -_u.y);
  }
  _w.normalize();
  if (bend) bend.copy(_w);
  outMid.copy(A).addScaledVector(_u, l1 * cosA).addScaledVector(_w, l1 * sinA);
  outEnd.copy(A).addScaledVector(_u, d);
  return outEnd;
}
