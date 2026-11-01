import * as THREE from 'three';

// Geometry builders that emit the `aGUV` attribute used by SurfaceGlyph materials.
// aGUV is in METERS: x runs around the body, y runs along it. Glyphs point toward +y.

/**
 * Cylindrical glyph mapping around the local Z axis: x = angle * radius, y = z.
 * The seam sits on the underside (-Y) where the top-down camera rarely looks.
 * `flip` reverses the along-axis direction (glyphs then point toward -Z).
 */
export function cylindricalGUV(geometry, { flip = false, minRadius = 0.05 } = {}) {
  const pos = geometry.attributes.position;
  const arr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.max(minRadius, Math.hypot(x, y));
    arr[i * 2] = Math.atan2(x, y) * r;
    arr[i * 2 + 1] = flip ? -z : z;
  }
  geometry.setAttribute('aGUV', new THREE.BufferAttribute(arr, 2));
  return geometry;
}

/** Planar mapping: project positions onto two local axes (Vector3s), in meters. */
export function planarGUV(geometry, uAxis, vAxis) {
  const pos = geometry.attributes.position;
  const arr = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    arr[i * 2] = p.dot(uAxis);
    arr[i * 2 + 1] = p.dot(vAxis);
  }
  geometry.setAttribute('aGUV', new THREE.BufferAttribute(arr, 2));
  return geometry;
}

/**
 * Tapered capsule from z = 0 (radius r0) to z = length (radius r1) with rounded caps,
 * optional elliptical cross-section (sx, sy) and mid bulge. Includes aGUV.
 * Pivot is at the z = 0 end, so parent it at a joint and point +Z down the bone.
 */
export function limbGeometry({
  length = 1,
  r0 = 0.2,
  r1 = 0.15,
  radial = 10,
  rings = 6,
  capSegs = 3,
  sx = 1,
  sy = 1,
  bulge = 0,
  flip = false,
} = {}) {
  const pts = [];
  for (let i = 0; i <= capSegs; i++) {
    const a = -Math.PI / 2 + (i / capSegs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r0), Math.sin(a) * r0));
  }
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const r = THREE.MathUtils.lerp(r0, r1, t) + Math.sin(Math.PI * t) * bulge;
    pts.push(new THREE.Vector2(r, t * length));
  }
  for (let i = 0; i <= capSegs; i++) {
    const a = (i / capSegs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r1), length + Math.sin(a) * r1));
  }
  const geo = new THREE.LatheGeometry(pts, radial);
  geo.rotateX(Math.PI / 2); // lathe axis Y -> Z
  if (sx !== 1 || sy !== 1) geo.scale(sx, sy, 1);
  geo.computeVertexNormals();
  return cylindricalGUV(geo, { flip });
}

/** Ellipsoid centred at origin with radii (rx, ry, rz), long axis Z. Includes aGUV. */
export function ellipsoidGeometry(rx, ry, rz, { widthSegs = 14, heightSegs = 10, flip = false } = {}) {
  const geo = new THREE.SphereGeometry(1, widthSegs, heightSegs);
  geo.rotateX(Math.PI / 2);
  geo.scale(rx, ry, rz);
  geo.computeVertexNormals();
  return cylindricalGUV(geo, { flip });
}

/** Cone/horn along +Z from base radius r to a point at `length`. Includes aGUV. */
export function hornGeometry(length, r, { radial = 6, curve = 0.0 } = {}) {
  const geo = new THREE.ConeGeometry(r, length, radial, 4, false);
  geo.translate(0, length / 2, 0);
  geo.rotateX(Math.PI / 2);
  if (curve !== 0) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setY(i, pos.getY(i) + curve * (z / length) * (z / length) * length);
    }
    geo.computeVertexNormals();
  }
  return cylindricalGUV(geo);
}
