import * as THREE from 'three';
import { ANATOMY as A } from './tuning.js';

// Wing membrane: three Coons patches rebuilt every frame from bone positions.
//   panel 0: wrist -> finger0 tip | wrist -> finger1 tip   (fan, scalloped trailing edge)
//   panel 1: wrist -> finger1 tip | wrist -> finger2 tip
//   panel 2: wrist -> finger2 tip | shoulder -> hip         (inner membrane, bounded by the arm)
// aGUV is computed ONCE from a flat rest layout so glyphs stretch/fold with the skin.
// Glyph +y runs from the wrist out along the fingers.
// v0.3: a ragged trailing edge (torn notches between the fingers, Obsidian Drake concept art).

const NU = 9; // samples along the fingers
const NV = 11; // samples across a panel (enough for the torn teeth of the trailing edge)
const PANELS = 3;
const SAG = 0.24; // trailing-edge scallop (fraction pulled toward the wrist/elbow)
// extra pull toward the wrist/elbow per trailing-edge sample: tears between jagged points
const RAG = [
  [0, 0.05, 0.16, 0.03, 0.2, 0.06, 0.24, 0.02, 0.14, 0.04, 0],
  [0, 0.12, 0.02, 0.18, 0.05, 0.26, 0.08, 0.2, 0.03, 0.1, 0],
  [0, 0.06, 0.2, 0.04, 0.16, 0.02, 0.22, 0.07, 0.18, 0.05, 0],
];

// scratch point slots: 0 wrist, 1 elbow, 2 shoulder, 3 hip, 4..6 finger tips
const P = Array.from({ length: 7 }, () => [0, 0, 0]);
const S = [0, 0, 0];

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
  if (k < 2) {
    const ta = P[4 + k], tb = P[5 + k];
    lerp3(C0, wrist, ta, u);
    lerp3(C1, wrist, tb, u);
    D0[0] = wrist[0]; D0[1] = wrist[1]; D0[2] = wrist[2];
    lerp3(MID, ta, tb, 0.5);
    lerp3(CTRL, MID, wrist, SAG);
    quad3(D1, ta, CTRL, tb, v);
    lerp3(D1, D1, wrist, rag(k, v));
    p00 = wrist; p10 = ta; p01 = wrist; p11 = tb;
  } else {
    const tip = P[6], elbow = P[1], shoulder = P[2], hip = P[3];
    lerp3(C0, wrist, tip, u);
    lerp3(C1, shoulder, hip, u);
    if (v < 0.5) lerp3(D0, wrist, elbow, v * 2);
    else lerp3(D0, elbow, shoulder, v * 2 - 1);
    lerp3(MID, tip, hip, 0.5);
    lerp3(CTRL, MID, elbow, SAG * 0.8);
    quad3(D1, tip, CTRL, hip, v);
    lerp3(D1, D1, elbow, rag(k, v) * 0.8);
    p00 = wrist; p10 = tip; p01 = shoulder; p11 = hip;
  }
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
  for (let i = 0; i < 3; i++) {
    out[i] = (1 - v) * C0[i] + v * C1[i] + (1 - u) * D0[i] + u * D1[i] - (a * p00[i] + b * p10[i] + c * p01[i] + d * p11[i]);
  }
  return out;
}

export class WingMembrane {
  constructor(material, side) {
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
    this._buildRestGUV();
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = side > 0 ? 'membraneL' : 'membraneR';
    this.mesh.frustumCulled = false; // positions change every frame
    this._v = new THREE.Vector3();
  }

  /** Flat spread layout (meters) used only to parametrize the glyph field. */
  _buildRestGUV() {
    const set = (slot, x, z) => {
      P[slot][0] = x; P[slot][1] = 0; P[slot][2] = z;
    };
    set(0, 4.6, 1.0); // wrist
    set(1, 2.7, 0.0); // elbow
    set(2, 1.0, 0.4); // shoulder
    set(3, 0.9, -2.6); // hip
    const dirs = [[0.5, 0.84], [0.92, 0.38], [0.75, -0.66]];
    dirs.forEach(([x, z], k) => {
      const l = Math.hypot(x, z);
      set(4 + k, 4.6 + (x / l) * A.fingers[k], 1.0 + (z / l) * A.fingers[k]);
    });
    const gv = new Float32Array(this.count * 2);
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
        }
      }
    }
    this.geometry.setAttribute('aGUV', new THREE.BufferAttribute(gv, 2));
  }

  /**
   * pts: { wrist, elbow, shoulder, hip, tips: [3] } world-space Vector3s.
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
    put(2, pts.shoulder);
    put(3, pts.hip);
    put(4, pts.tips[0]);
    put(5, pts.tips[1]);
    put(6, pts.tips[2]);
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
          const ii = k < 2 && i === 0 ? 1 : i; // wrist row collapses to a point on fan panels
          const iu0 = at(k, Math.max(0, ii - 1), j), iu1 = at(k, Math.min(NU - 1, ii + 1), j);
          const iv0 = at(k, ii, Math.max(0, j - 1)), iv1 = at(k, ii, Math.min(NV - 1, j + 1));
          const ux = pos[iu1] - pos[iu0], uy = pos[iu1 + 1] - pos[iu0 + 1], uz = pos[iu1 + 2] - pos[iu0 + 2];
          const vx = pos[iv1] - pos[iv0], vy = pos[iv1 + 1] - pos[iv0 + 1], vz = pos[iv1 + 2] - pos[iv0 + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = Math.hypot(nx, ny, nz);
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
