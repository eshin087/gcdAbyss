import * as THREE from 'three';
import { clamp, damp } from './math.js';
import { CONFIG } from './config.js';

// Fixed-yaw, steep top-down perspective camera (Ansenjeo-style): looks north (-Z),
// pitched ~58° down, follows a focus point with damping, trauma-based screen shake.
export class CameraRig {
  constructor(camera) {
    const c = CONFIG.camera;
    this.camera = camera;
    this.pitch = c.pitch;
    this.distance = c.distance;
    this.targetDistance = c.distance;
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.t = 0;
    this.extraZoom = 0; // gameplay may push the camera out (e.g. boss framing), in meters
    this._off = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  snap(focus) {
    this.focus.copy(focus);
    this.distance = this.targetDistance + this.extraZoom;
    this.update(0, focus);
  }

  zoom(steps) {
    const c = CONFIG.camera;
    this.targetDistance = clamp(this.targetDistance + steps * 2.5, c.minDistance, c.maxDistance);
  }

  /** amount 0..1; stacks and decays. ~0.25 light hit, ~0.6 big slam. */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt, desiredFocus) {
    const c = CONFIG.camera;
    this.t += dt;
    this.focus.x = damp(this.focus.x, desiredFocus.x, c.followLambda, dt);
    this.focus.y = damp(this.focus.y, desiredFocus.y, c.followLambda, dt);
    this.focus.z = damp(this.focus.z, desiredFocus.z, c.followLambda, dt);
    this.distance = damp(this.distance, this.targetDistance + this.extraZoom, 4, dt);

    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const sx = (Math.sin(t * 1.13) + Math.sin(t * 2.71 + 1.3) * 0.5) * s * 0.55;
    const sz = (Math.sin(t * 1.31 + 2.1) + Math.sin(t * 2.37 + 0.4) * 0.5) * s * 0.55;

    this._off.set(0, Math.sin(this.pitch), Math.cos(this.pitch)).multiplyScalar(this.distance);
    this.camera.position.copy(this.focus).add(this._off);
    this.camera.position.x += sx;
    this.camera.position.z += sz;
    this._look.copy(this.focus);
    this._look.x += sx * 0.6;
    this._look.z += sz * 0.6;
    this.camera.lookAt(this._look);
    this.camera.updateMatrixWorld();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }
}
