import * as THREE from 'three';
import { clamp, damp } from './math.js';
import { CONFIG } from './config.js';

// Fixed-yaw, steep top-down perspective camera (Ansenjeo-style): looks north (-Z),
// pitched ~58° down, follows a focus point with damping, trauma-based screen shake.
// Two distance profiles: desktop (CONFIG.camera.distance / min / max, extra zoom unlimited) and
// mobile (setMobile(true): closer default, own zoom range, extra zoom capped so lock-on, boss
// framing and establishing shots never push the phone camera far out).
//
// Keep-in-view (`keep`): modules may ask, every frame, for world spheres to stay on screen — the
// hero riding the wyrm's head through the plunge, a wyrm flying 16 m up. After the usual focus /
// distance damping the rig projects them with the real camera and eases a ground-plane pan (and,
// for `must` subjects only, a little extra distance) until they fit inside FIT.box; with nothing
// asked it eases back to the plain framing. `must` subjects (the hero) are never cropped to fit
// the others. The pan / zoom are damped (FIT.lambda), never snapped, and reset by snap().
const FIT = {
  box: [0.9, 0.86, 0.78], // NDC limits: |x|, top, bottom (the boss bar sits at the bottom)
  lambda: 5, // 1/s: how fast the fit pans / zooms (and eases back) …
  mustLambda: 12, // … and how fast it pans while a must subject is off the box (a blink up into the air)
  maxPan: 30, // m
  maxZoom: 12, // m of extra distance (must subjects only) …
  mobileMaxZoom: 3, // … on a phone (the close camera stays close: it pans instead)
  max: 16, // subjects per frame
  near: 2, // m: a subject closer to the camera plane than this is clamped (never divides by ~0)
};

export class CameraRig {
  constructor(camera) {
    const c = CONFIG.camera;
    this.camera = camera;
    this.pitch = c.pitch;
    this.mobile = false;
    this.defaultDistance = c.distance;
    this.minDistance = c.minDistance;
    this.maxDistance = c.maxDistance;
    this.maxExtraZoom = Infinity;
    this.distance = c.distance;
    this.targetDistance = c.distance;
    /** The focus the camera looks at this frame (the damped follow focus + the keep-in-view pan). */
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.t = 0;
    this.extraZoom = 0; // gameplay may push the camera out (e.g. boss framing), in meters
    // keep-in-view: this frame's subjects and the eased pan (fitX / fitZ, m) and zoom (fitZoom, m)
    this.fitX = 0;
    this.fitZ = 0;
    this.fitZoom = 0;
    this._subj = Array.from({ length: FIT.max }, () => ({ x: 0, y: 0, z: 0, r: 0, must: false }));
    this._n = 0;
    this._base = new THREE.Vector3(); // the damped follow focus (before the pan)
    this._off = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  /** Switch the distance profile (phones: true). Resets the zoom to the profile's default. */
  setMobile(on) {
    on = !!on;
    if (on === this.mobile) return;
    const c = CONFIG.camera;
    this.mobile = on;
    this.defaultDistance = on ? c.mobileDistance : c.distance;
    this.minDistance = on ? c.mobileMinDistance : c.minDistance;
    this.maxDistance = on ? c.mobileMaxDistance : c.maxDistance;
    this.maxExtraZoom = on ? c.mobileMaxExtraZoom : Infinity;
    this.targetDistance = this.defaultDistance;
  }

  snap(focus) {
    this._base.copy(focus);
    this.focus.copy(focus);
    this.fitX = this.fitZ = this.fitZoom = 0;
    this._n = 0;
    this.distance = this.targetDistance + this._extra();
    this.update(0, focus);
  }

  zoom(steps) {
    if (!Number.isFinite(steps)) return;
    this.targetDistance = clamp(this.targetDistance + steps * 2.5, this.minDistance, this.maxDistance);
  }

  /** amount 0..1; stacks and decays. ~0.25 light hit, ~0.6 big slam. */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Keep the world sphere (x, y, z, radius r m) on screen this frame (the request lasts one
   * update). `must`: never crop it to fit the others, and the rig may pull back a little for it.
   */
  keep(x, y, z, r = 1, must = false) {
    if (this._n >= FIT.max || !Number.isFinite(x + y + z + r)) return;
    const s = this._subj[this._n++];
    s.x = x;
    s.y = y;
    s.z = z;
    s.r = Math.max(0, r);
    s.must = !!must;
  }

  _extra() {
    const e = Number.isFinite(this.extraZoom) ? this.extraZoom : 0;
    return Math.min(e, this.maxExtraZoom);
  }

  update(dt, desiredFocus) {
    const c = CONFIG.camera;
    this.t += dt;
    const b = this._base;
    b.x = damp(b.x, desiredFocus.x, c.followLambda, dt);
    b.y = damp(b.y, desiredFocus.y, c.followLambda, dt);
    b.z = damp(b.z, desiredFocus.z, c.followLambda, dt);
    this.distance = damp(this.distance, this.targetDistance + this._extra(), 4, dt);
    this._fit(dt);
    this.focus.set(b.x + this.fitX, b.y, b.z + this.fitZ);
    const D = this.distance + this.fitZoom;

    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const sx = (Math.sin(t * 1.13) + Math.sin(t * 2.71 + 1.3) * 0.5) * s * 0.55;
    const sz = (Math.sin(t * 1.31 + 2.1) + Math.sin(t * 2.37 + 0.4) * 0.5) * s * 0.55;

    this._off.set(0, Math.sin(this.pitch), Math.cos(this.pitch)).multiplyScalar(D);
    this.camera.position.copy(this.focus).add(this._off);
    this.camera.position.x += sx;
    this.camera.position.z += sz;
    this._look.copy(this.focus);
    this._look.x += sx * 0.6;
    this._look.z += sz * 0.6;
    this.camera.lookAt(this._look);
    this.camera.updateMatrixWorld();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this._n = 0; // keep() requests last one frame
  }

  /**
   * Keep-in-view: project this frame's subjects with the camera the current focus / distance /
   * fit gives (no shake), find the pan that brings them all inside FIT.box (or, if they cannot all
   * fit, the `must` ones, centred on the rest), plus extra distance when even the must subjects
   * span more than the box, then ease toward it. With no subjects (or slack) it eases back to 0.
   * A proportional controller: re-solved every frame from where the camera is now.
   */
  _fit(dt) {
    let tx = 0, tz = 0, tzoom = 0, lambda = FIT.lambda;
    const n = this._n, cam = this.camera;
    if (n > 0 && cam) {
      const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
      const D = this.distance + this.fitZoom;
      const fx = this._base.x + this.fitX, fy = this._base.y, fz = this._base.z + this.fitZ;
      const cx = fx, cy = fy + sp * D, cz = fz + cp * D;
      const tanV = Math.tan(((Number.isFinite(cam.fov) ? cam.fov : CONFIG.camera.fov) * Math.PI) / 360);
      const asp = Number.isFinite(cam.aspect) && cam.aspect > 0.1 ? cam.aspect : 16 / 9;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
      let depthSum = 0, mDepth = 0, nm = 0;
      for (let i = 0; i < n; i++) {
        const S = this._subj[i];
        const qx = S.x - cx, qy = S.y - cy, qz = S.z - cz;
        const depth = Math.max(FIT.near, -sp * qy - cp * qz);
        const up = cp * qy - sp * qz;
        const ny = up / (depth * tanV), nx = qx / (depth * tanV * asp);
        const ry = S.r / (depth * tanV), rx = ry / asp;
        x0 = Math.min(x0, nx - rx);
        x1 = Math.max(x1, nx + rx);
        y0 = Math.min(y0, ny - ry);
        y1 = Math.max(y1, ny + ry);
        depthSum += depth;
        if (S.must) {
          mx0 = Math.min(mx0, nx - rx);
          mx1 = Math.max(mx1, nx + rx);
          my0 = Math.min(my0, ny - ry);
          my1 = Math.max(my1, ny + ry);
          mDepth += depth;
          nm++;
        }
      }
      const dAvg = depthSum / n;
      const [LX, LT, LB] = FIT.box;
      // the NDC shift (subjects move by +δ) that undoes the current pan: the relaxed choice
      const k = dAvg * tanV;
      const relaxY = (-this.fitZ * sp) / k, relaxX = (this.fitX) / (k * asp);
      const dy = pick(relaxY, -LB - y0, LT - y1, nm ? -LB - my0 : -Infinity, nm ? LT - my1 : Infinity);
      const dx = pick(relaxX, -LX - x0, LX - x1, nm ? -LX - mx0 : -Infinity, nm ? LX - mx1 : Infinity);
      // subjects shift by δ (NDC) when the focus moves by Δz = δ·k / sp (south +), Δx = −δ·k·asp
      tz = this.fitZ + (dy * k) / sp;
      tx = this.fitX - dx * k * asp;
      if (nm) {
        // extra distance only when the must subjects themselves span more than the box
        const span = Math.max((my1 - my0) / (LT + LB), (mx1 - mx0) / (2 * LX));
        const zoomMax = this.mobile ? FIT.mobileMaxZoom : FIT.maxZoom;
        tzoom = clamp(this.fitZoom + (mDepth / nm) * (span - 0.92), 0, zoomMax);
        if (my1 > LT || my0 < -LB || mx1 > LX || mx0 < -LX) lambda = FIT.mustLambda;
      }
    }
    const P = FIT.maxPan;
    tx = clamp(tx, -P, P);
    tz = clamp(tz, -P, P);
    this.fitX = damp(this.fitX, tx, lambda, dt);
    this.fitZ = damp(this.fitZ, tz, lambda, dt);
    this.fitZoom = damp(this.fitZoom, tzoom, FIT.lambda * 0.6, dt);
    if (!Number.isFinite(this.fitX + this.fitZ + this.fitZoom)) this.fitX = this.fitZ = this.fitZoom = 0;
  }
}

/**
 * One axis of the keep-in-view solve: the shift closest to `relax` inside [lo, hi] (every subject
 * inside the box); if the subjects can't all fit, the middle of their span pulled inside
 * [mlo, mhi] (the must subjects inside); if not even those fit, the middle of theirs.
 */
function pick(relax, lo, hi, mlo, mhi) {
  if (lo <= hi) return clamp(relax, lo, hi);
  const mid = (lo + hi) * 0.5;
  if (mlo <= mhi) return clamp(mid, mlo, mhi);
  return Number.isFinite(mlo + mhi) ? (mlo + mhi) * 0.5 : mid;
}
