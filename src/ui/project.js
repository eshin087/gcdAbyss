import * as THREE from 'three';

// World → screen projection shared by the world-anchored HUD widgets (call-outs, damage numbers,
// the side of the red tell edge flash). Results are CSS pixels from the top-left of the window.
// No allocations per call.

export class ScreenProjector {
  constructor(game) {
    this.game = game;
    this.v = new THREE.Vector3();
    this.w = window.innerWidth || 1;
    this.h = window.innerHeight || 1;
    addEventListener('resize', () => {
      this.w = window.innerWidth || 1;
      this.h = window.innerHeight || 1;
    });
  }

  /**
   * Projects (x, y, z) into `out` = { x, y, on, front }. `on`: inside the viewport (± margin in
   * NDC); `front`: in front of the camera (points behind it are mirrored so the direction still
   * reads). Returns false when nothing could be projected (no camera / non-finite input).
   */
  project(x, y, z, out, margin = 0.06) {
    out.on = false;
    out.front = false;
    const cam = this.game.camera;
    if (!cam || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const v = this.v.set(x, y, z).project(cam);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return false;
    let nx = v.x;
    let ny = v.y;
    out.front = v.z > -1 && v.z < 1;
    if (!out.front) {
      nx = -nx;
      ny = -ny;
    }
    out.x = (nx * 0.5 + 0.5) * this.w;
    out.y = (0.5 - ny * 0.5) * this.h;
    const m = 1 + margin;
    out.on = out.front && nx > -m && nx < m && ny > -m && ny < m;
    return true;
  }
}
