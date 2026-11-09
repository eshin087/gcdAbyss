import * as THREE from 'three';
import { ANATOMY as A } from './tuning.js';
import { solveTwoBone } from './rig/ik.js';

// Wing membrane: four Coons patches rebuilt every frame from bone positions (docs/art/dragon.md §2.6).
//   panel 0: finger 0 | finger 1   (fan from the wrist, scalloped + torn trailing edge tip0 -> tip1)
//   panel 1: finger 1 | finger 2
//   panel 2: finger 2 | finger 3
//   panel 3: finger 3 | wing root -> hip attach   (inner membrane down the flank, bounded by the arm)
// Each finger edge is the bent bone polyline wrist -> knuckle -> tip, so the skin follows the distal
// kinks. aGUV is computed ONCE from the HALF (mantled) layout, the pose seen most, so the glyph
// grid is square and even there (a SPREAD wing stretches it into bigger round glyphs; parametrizing
// from a flat SPREAD layout crushed the rows into stripes at HALF). Glyph +y runs from the wrist out
// along the fingers. aEdge (0 inside -> 1 on the free trailing edge) drives the material's tears and
// ragged trailing edge, aBone (distance to the panel's nearer bone) its embers along the fingers
// (render/materials.js, wyrm `membrane`).

const NU = 10; // samples along the fingers
const NV = 13; // samples across a panel (enough for the tears of the trailing edge)
const PANELS = 4;
/** Trailing-edge scallop per panel (fraction pulled toward the wrist / elbow): one deep arc each. */
export const SAG = [0.42, 0.4, 0.34, 0.22];
// extra pull toward the wrist / elbow per trailing-edge sample: mostly a smooth scallop with two or
// three irregular rips per panel (never periodic: a regular sawtooth read as feathers / a saw blade);
// deep enough to notch the silhouette like the reference's torn sails (the shader adds holes)
const RAG = [
  [0, 0.03, 0, 0.05, 0.26, 0.03, 0, 0.02, 0.07, 0, 0.21, 0.03, 0],
  [0, 0.02, 0.05, 0, 0.12, 0, 0.06, 0.29, 0.04, 0, 0.02, 0.16, 0],
  [0, 0.04, 0.23, 0.03, 0, 0.02, 0.03, 0.13, 0.04, 0.01, 0.27, 0.03, 0],
  [0, 0.03, 0, 0.02, 0.07, 0.03, 0.22, 0.02, 0, 0.12, 0.03, 0.01, 0],
];

// scratch point slots: 0 wrist, 1 elbow, 2 wing root, 3 hip attach, 4..7 finger tips, 8..11 knuckles
const P = Array.from({ length: 12 }, () => [0, 0, 0]);
const S = [0, 0, 0];
const KN = A.knuckle;

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
function quad3(out, a, c, b, t) {
  const u = 1 - t;
  out[0] = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
  out[1] = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
  out[2] = u * u * a[2] + 2 * u * t * c[2] + t * t * b[2];
  return out;
}
/** Finger k as the bent polyline wrist -> knuckle -> tip, at u (0..1). */
function finger(out, k, u) {
  const kn = KN[k];
  if (u <= kn) return lerp3(out, P[0], P[8 + k], u / kn);
  return lerp3(out, P[8 + k], P[4 + k], (u - kn) / (1 - kn));
}

const C0 = [0, 0, 0], C1 = [0, 0, 0], D0 = [0, 0, 0], D1 = [0, 0, 0], CTRL = [0, 0, 0], MID = [0, 0, 0];

/** Trailing-edge tear at v (0..1) for panel k: RAG sampled at the grid columns, linear between. */
function rag(k, v) {
  const r = RAG[k], f = v * (r.length - 1), i = Math.min(r.length - 2, Math.floor(f)), t = f - i;
  return r[i] + (r[i + 1] - r[i]) * t;
}

/** Evaluate panel k at (u, v) into out[3] using the point slots P. */
function evalPanel(out, k, u, v) {
  const wrist = P[0];
  let p00, p10, p01, p11;
  if (k < 3) {
    const ta = P[4 + k], tb = P[5 + k];
    finger(C0, k, u);
    finger(C1, k + 1, u);
    D0[0] = wrist[0]; D0[1] = wrist[1]; D0[2] = wrist[2];
    lerp3(MID, ta, tb, 0.5);
    lerp3(CTRL, MID, wrist, SAG[k]);
    quad3(D1, ta, CTRL, tb, v);
    lerp3(D1, D1, wrist, rag(k, v));
    p00 = wrist; p10 = ta; p01 = wrist; p11 = tb;
  } else {
    const tip = P[7], elbow = P[1], rootP = P[2], hip = P[3];
    finger(C0, 3, u);
    lerp3(C1, rootP, hip, u);
    if (v < 0.5) lerp3(D0, wrist, elbow, v * 2);
    else lerp3(D0, elbow, rootP, v * 2 - 1);
    lerp3(MID, tip, hip, 0.5);
    lerp3(CTRL, MID, elbow, SAG[3]);
    quad3(D1, tip, CTRL, hip, v);
    lerp3(D1, D1, elbow, rag(k, v) * 0.8);
    p00 = wrist; p10 = tip; p01 = rootP; p11 = hip;
  }
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
  for (let i = 0; i < 3; i++) {
    out[i] = (1 - v) * C0[i] + v * C1[i] + (1 - u) * D0[i] + u * D1[i] - (a * p00[i] + b * p10[i] + c * p01[i] + d * p11[i]);
  }
  return out;
}

export class WingMembrane {
  /**
   * @param material surface-glyph material (DoubleSide)
   * @param side +1 left wing, -1 right
   * @param restKey wing key the glyph grid is laid out on ({ wrist, pole, fingers[4], kink[4] } in
   *        the chest frame, left wing; rig/anim.js WING_KEYS.HALF)
   */
  constructor(material, side, restKey) {
    this.side = side;
    const count = PANELS * NU * NV;
    this.count = count;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.nrm = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let k = 0; k < PANELS; k++) {
      const base = k * NU * NV;
      for (let i = 0; i < NU - 1; i++) {
        for (let j = 0; j < NV - 1; j++) {
          const a = base + i * NV + j, b = a + NV, c = a + 1, d = b + 1;
          idx.push(a, b, c, c, b, d);
        }
      }
    }
    geo.setIndex(idx);
    this.geometry = geo;
    this._buildRestGUV(restKey);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = side > 0 ? 'membraneL' : 'membraneR';
    this.mesh.frustumCulled = false; // positions change every frame
    this._v = new THREE.Vector3();
  }

  /** Rest layout (model units, chest frame) used only to parametrize the glyph field (aGUV, aEdge). */
  _buildRestGUV(key) {
    const set = (slot, x, y, z) => {
      P[slot][0] = x; P[slot][1] = y; P[slot][2] = z;
    };
    const R = new THREE.Vector3(A.wingRoot[0], A.wingRoot[1], A.wingRoot[2]);
    const W = new THREE.Vector3(...key.wrist);
    const E = new THREE.Vector3(), Wr = new THREE.Vector3();
    solveTwoBone(R, W, A.wingHumerus, A.wingForearm, new THREE.Vector3(...key.pole), E, Wr);
    set(0, Wr.x, Wr.y, Wr.z); // wrist (as reached)
    set(1, E.x, E.y, E.z); // elbow
    set(2, R.x, R.y, R.z); // wing root
    // hip attach: hips frame -> chest frame (the standing chest offset)
    set(3, A.hipAttach[0], A.hipAttach[1] - A.chest[1], A.hipAttach[2] - A.chest[2]);
    const dir = new THREE.Vector3(), perp = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    for (let k = 0; k < 4; k++) {
      const L = A.fingers[k], kn = KN[k];
      dir.set(...key.fingers[k]).normalize();
      const kx = Wr.x + dir.x * L * kn, ky = Wr.y + dir.y * L * kn, kz = Wr.z + dir.z * L * kn;
      set(8 + k, kx, ky, kz);
      // distal segment drooped toward down by the kink (as the rig does)
      perp.copy(down).addScaledVector(dir, -down.dot(dir));
      const kk = -(key.kink?.[k] ?? 0);
      if (perp.lengthSq() > 1e-6) dir.multiplyScalar(Math.cos(kk)).addScaledVector(perp.normalize(), Math.sin(kk)).normalize();
      const l1 = L * (1 - kn);
      set(4 + k, kx + dir.x * l1, ky + dir.y * l1, kz + dir.z * l1);
    }
    const gv = new Float32Array(this.count * 2);
    const bone = new Float32Array(this.count);
    const grid = new Float32Array(NU * NV * 3);
    for (let k = 0; k < PANELS; k++) {
      for (let i = 0; i < NU; i++) {
        for (let j = 0; j < NV; j++) {
          evalPanel(S, k, i / (NU - 1), j / (NV - 1));
          const g = (i * NV + j) * 3;
          grid[g] = S[0]; grid[g + 1] = S[1]; grid[g + 2] = S[2];
        }
      }
      const dist = (a, b) => Math.hypot(grid[a] - grid[b], grid[a + 1] - grid[b + 1], grid[a + 2] - grid[b + 2]);
      for (let j = 0; j < NV; j++) {
        let y = 0;
        for (let i = 0; i < NU; i++) {
          if (i > 0) y += dist((i * NV + j) * 3, ((i - 1) * NV + j) * 3);
          const vi = k * NU * NV + i * NV + j;
          gv[vi * 2 + 1] = y;
        }
      }
      for (let i = 0; i < NU; i++) {
        let x = 0;
        for (let j = 0; j < NV; j++) {
          if (j > 0) x += dist((i * NV + j) * 3, (i * NV + j - 1) * 3);
          const vi = k * NU * NV + i * NV + j;
          gv[vi * 2] = x * this.side + k * 17.3; // separate glyph fields per panel
          bone[vi] = x; // across-panel distance from the leading bone (finished below)
        }
        // aBone: distance (model units) to the nearer edge bone of the panel across this row
        for (let j = 0; j < NV; j++) {
          const vi = k * NU * NV + i * NV + j;
          bone[vi] = Math.min(bone[vi], x - bone[vi]);
        }
      }
    }
    this.geometry.setAttribute('aGUV', new THREE.BufferAttribute(gv, 2));
    this.geometry.setAttribute('aBone', new THREE.BufferAttribute(bone, 1));
    // free trailing edge (u = 1, away from the bone / body edges at v = 0 / 1)
    const edge = new Float32Array(this.count);
    for (let k = 0; k < PANELS; k++) {
      for (let i = 0; i < NU; i++) {
        for (let j = 0; j < NV; j++) {
          const u = i / (NU - 1), v = j / (NV - 1);
          edge[k * NU * NV + i * NV + j] = u * Math.min(1, Math.min(v, 1 - v) * 6);
        }
      }
    }
    this.geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  }

  /**
   * pts: { wrist, elbow, root, hip, tips: [4], knuckles: [4] } world-space Vector3s.
   * rootInv: inverse world matrix of the mesh's parent (mesh itself has identity local transform).
   */
  update(pts, rootInv) {
    const v = this._v;
    const put = (slot, src) => {
      v.copy(src).applyMatrix4(rootInv);
      P[slot][0] = v.x; P[slot][1] = v.y; P[slot][2] = v.z;
    };
    put(0, pts.wrist);
    put(1, pts.elbow);
    put(2, pts.root);
    put(3, pts.hip);
    for (let k = 0; k < 4; k++) {
      put(4 + k, pts.tips[k]);
      put(8 + k, pts.knuckles[k]);
    }
    const pos = this.pos;
    for (let k = 0; k < PANELS; k++) {
      for (let i = 0; i < NU; i++) {
        for (let j = 0; j < NV; j++) {
          evalPanel(S, k, i / (NU - 1), j / (NV - 1));
          const o = (k * NU * NV + i * NV + j) * 3;
          // guard against NaN creeping in from a degenerate pose
          pos[o] = Number.isFinite(S[0]) ? S[0] : 0;
          pos[o + 1] = Number.isFinite(S[1]) ? S[1] : 0;
          pos[o + 2] = Number.isFinite(S[2]) ? S[2] : 0;
        }
      }
    }
    this._normals();
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  // Grid normals from central differences; degenerate fan corners borrow the next row.
  _normals() {
    const pos = this.pos, nrm = this.nrm;
    const at = (k, i, j) => (k * NU * NV + i * NV + j) * 3;
    for (let k = 0; k < PANELS; k++) {
      for (let i = 0; i < NU; i++) {
        for (let j = 0; j < NV; j++) {
          const ii = k < 3 && i === 0 ? 1 : i; // wrist row collapses to a point on fan panels
          const iu0 = at(k, Math.max(0, ii - 1), j), iu1 = at(k, Math.min(NU - 1, ii + 1), j);
          const iv0 = at(k, ii, Math.max(0, j - 1)), iv1 = at(k, ii, Math.min(NV - 1, j + 1));
          const ux = pos[iu1] - pos[iu0], uy = pos[iu1 + 1] - pos[iu0 + 1], uz = pos[iu1 + 2] - pos[iu0 + 2];
          const vx = pos[iv1] - pos[iv0], vy = pos[iv1 + 1] - pos[iv0 + 1], vz = pos[iv1 + 2] - pos[iv0 + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          // sqrt, not Math.hypot: the varargs builtin boxed its doubles (~100 KB of garbage per frame
          // over the 1040 grid points of both wings)
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (l > 1e-9 && Number.isFinite(l)) {
            nx /= l; ny /= l; nz /= l;
          } else {
            nx = 0; ny = 1; nz = 0;
          }
          const o = at(k, i, j);
          nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
        }
      }
    }
  }
}
