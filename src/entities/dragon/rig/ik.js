import * as THREE from 'three';

// Analytic two-bone IK: root A, target T, bone lengths l1/l2, `pole` = world direction the
// middle joint should bend toward. Writes the middle joint and the reached end point.

const _u = new THREE.Vector3();
const _w = new THREE.Vector3();

export function solveTwoBone(A, T, l1, l2, pole, outMid, outEnd) {
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
  d = Math.min(maxD, Math.max(minD, d));
  let cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  cosA = Math.min(1, Math.max(-1, cosA));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // bend direction: pole projected perpendicular to the A->T axis
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) {
    _w.set(_u.y, -_u.x, 0);
    if (_w.lengthSq() < 1e-8) _w.set(0, _u.z, -_u.y);
  }
  _w.normalize();
  outMid.copy(A).addScaledVector(_u, l1 * cosA).addScaledVector(_w, l1 * sinA);
  outEnd.copy(A).addScaledVector(_u, d);
  return outEnd;
}
