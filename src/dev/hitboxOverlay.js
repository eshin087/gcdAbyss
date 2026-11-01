import * as THREE from 'three';
import { DEFENSE } from '../combat/rules.js';

// Lab hitbox overlay: wireframe spheres for the target's hitboxes (debug.hitboxes(), falling back to
// hurtSpheres) plus the player's collision ring, facing and parry arc. One LineSegments in fxScene
// (drawn after the ASCII pass, no depth test) whose fixed-size buffers are rewritten each frame.

const SEG = 20; // segments per ring
const RINGS = 3; // XZ, XY, YZ great circles per sphere
const PER_SPHERE = RINGS * SEG * 2; // vertices
const MAX_SPHERES = 96;
const EXTRA = SEG * 2 + 3 * 2; // player ring + facing line + two parry-arc edges
const PLAYER_Y = 0.06;

// linear HDR (the final pass tone-maps; > 1 blooms a little so thin lines stay readable)
const COLORS = {
  hurt: [0.2, 1.15, 1.35], // cyan
  attack: [2.2, 0.16, 0.1], // red
  other: [1.6, 1.3, 0.3], // unknown kind: amber
  player: [1.3, 1.3, 1.3],
  blocking: [0.45, 1.0, 2.6],
  crit: [2.0, 1.5, 0.35],
  invulnerable: [1.5, 0.45, 1.8],
  arc: [0.5, 0.56, 0.68],
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export class HitboxOverlay {
  constructor(game) {
    this.game = game;
    this.cap = MAX_SPHERES * PER_SPHERE + EXTRA;
    this.pos = new Float32Array(this.cap * 3);
    this.col = new Float32Array(this.cap * 3);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    // never culled; a huge fixed bound keeps three from scanning the buffer for sorting
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = geo;
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.name = 'lab:hitboxes';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1000;
    this.lines.matrixAutoUpdate = false;
    this.lines.visible = false;

    this.cos = new Float32Array(SEG + 1);
    this.sin = new Float32Array(SEG + 1);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
    this.n = 0; // vertices written this frame
    this.count = { hurt: 0, attack: 0, source: 'none' };
  }

  get visible() {
    return this.lines.visible;
  }

  setVisible(on) {
    const scene = this.game.fxScene;
    if (on && scene) {
      if (this.lines.parent !== scene) scene.add(this.lines);
      this.lines.visible = true;
    } else {
      this.lines.visible = false;
      this.lines.parent?.remove(this.lines);
      this.geo.setDrawRange(0, 0);
    }
  }

  /** Rebuild the line buffers from `target`'s hitboxes (+ the player ring). Never throws. */
  update(target = this.game.dragon) {
    if (!this.lines.visible) return;
    this.n = 0;
    const c = this.count;
    c.hurt = 0;
    c.attack = 0;
    c.source = 'none';
    const g = this.game;

    let list = null;
    const dbg = target?.debug;
    if (typeof dbg?.hitboxes === 'function') {
      try {
        const r = dbg.hitboxes();
        if (Array.isArray(r)) {
          list = r;
          c.source = 'debug';
        }
      } catch {
        list = null;
      }
    }
    if (!list && Array.isArray(target?.hurtSpheres)) {
      list = target.hurtSpheres; // contract fallback: hurt volumes only
      c.source = 'hurtSpheres';
    }

    const limit = this.cap - EXTRA - PER_SPHERE;
    if (list) {
      for (let i = 0; i < list.length && this.n <= limit; i++) {
        const b = list[i];
        if (!b || !finite(b.x) || !finite(b.y) || !finite(b.z) || !finite(b.r) || b.r <= 0) continue;
        const kind = b.kind ?? 'hurt';
        const color = COLORS[kind] ?? COLORS.other;
        if (kind === 'attack') c.attack++;
        else c.hurt++;
        this._sphere(b.x, b.y, b.z, Math.min(b.r, 60), color);
      }
    }
    this._player(g.player);

    this.geo.setDrawRange(0, this.n);
    if (this.n > 0) {
      this._upload(this.posAttr);
      this._upload(this.colAttr);
    }
  }

  _upload(attr) {
    // only the written prefix goes to the GPU
    attr.clearUpdateRanges?.();
    attr.addUpdateRange?.(0, this.n * 3);
    attr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- writers
  _v(x, y, z, c) {
    const i = this.n * 3;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.col[i] = c[0];
    this.col[i + 1] = c[1];
    this.col[i + 2] = c[2];
    this.n++;
  }

  _ring(x, y, z, r, plane, c) {
    const co = this.cos, si = this.sin;
    for (let k = 0; k < SEG; k++) {
      for (let j = k; j <= k + 1; j++) {
        const a = co[j] * r, b = si[j] * r;
        if (plane === 0) this._v(x + a, y, z + b, c); // horizontal
        else if (plane === 1) this._v(x + a, y + b, z, c);
        else this._v(x, y + a, z + b, c);
      }
    }
  }

  _sphere(x, y, z, r, c) {
    this._ring(x, y, z, r, 0, c);
    this._ring(x, y, z, r, 1, c);
    this._ring(x, y, z, r, 2, c);
  }

  _line(ax, ay, az, bx, by, bz, c) {
    this._v(ax, ay, az, c);
    this._v(bx, by, bz, c);
  }

  _player(p) {
    const pos = p?.position;
    if (!pos || !finite(pos.x) || !finite(pos.z)) return;
    const x = pos.x, z = pos.z;
    const r = finite(p.radius) && p.radius > 0 ? p.radius : 0.45;
    let c = COLORS.player;
    try {
      if (p.isInvulnerable?.()) c = COLORS.invulnerable;
      else if (p.critTimer > 0) c = COLORS.crit;
      else if (p.blocking) c = COLORS.blocking;
    } catch {
      c = COLORS.player;
    }
    this._ring(x, PLAYER_Y, z, r, 0, c);
    const yaw = finite(p.yaw) ? p.yaw : 0;
    this._line(x, PLAYER_Y, z, x + Math.sin(yaw) * 1.8, PLAYER_Y, z + Math.cos(yaw) * 1.8, c);
    const half = DEFENSE.parryArc * 0.5;
    for (let s = -1; s <= 1; s += 2) {
      const a = yaw + s * half;
      this._line(x, PLAYER_Y, z, x + Math.sin(a) * 1.3, PLAYER_Y, z + Math.cos(a) * 1.3, COLORS.arc);
    }
  }

  dispose() {
    this.setVisible(false);
    this.geo.dispose();
    this.mat.dispose();
  }
}
