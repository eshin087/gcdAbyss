import { clamp, damp } from '../core/math.js';

// Screen feedback through the final pass uniforms (pipeline.finalMat): uHurt (red edge pulse),
// uFade (black), uDesat (death grey-out), uWarm (boss-fight grade). Owned by GameFlow and updated
// with real time so it keeps animating while the game is paused or in hit-stop.
// Ghostep slow-mo adds a short cool pulse: a little desaturation with the warm grade pulled out;
// it only ever adds on top of the other targets and releases back to them on its own.

const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const finite = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class ScreenGrade {
  constructor(game) {
    this.game = game;
    this.hurt = 0;
    this.fade = 1; // boot: fade in from black
    this.fadeTarget = 0;
    this.fadeSpeed = 0.7;
    this.desat = 0;
    this.desatTarget = 0;
    this.desatSpeed = 1;
    this.warm = 0;
    this.warmTarget = 0;
    this.lowHp = 0; // 0..1 heartbeat strength, set by flow
    this.dipAmt = 0;
    this.dipT = 0;
    this.dipDur = 1;
    this.ghost = 0; // Ghostep cool pulse 0..1 (envelope below)
    this.ghostHold = 0;
    this.t = 0;
  }

  get uniforms() {
    return this.game.pipeline?.finalMat?.uniforms ?? null;
  }

  /** Red edge pulse scaled by damage; decays ~2/s. `soft` for damage-over-time ticks (burn). */
  hurtPulse(damage, soft = false) {
    const base = soft ? 0.14 : 0.3;
    const a = clamp(base + finite(damage) / 70, base, 1);
    this.hurt = Math.max(this.hurt, a);
    this._write();
  }

  fadeTo(target, speed = 1) {
    this.fadeTarget = clamp(finite(target), 0, 1);
    this.fadeSpeed = Math.max(0.01, finite(speed, 1));
  }

  desatTo(target, speed = 1) {
    this.desatTarget = clamp(finite(target), 0, 1);
    this.desatSpeed = Math.max(0.01, finite(speed, 1));
  }

  /** Brief dip toward black (bonfire rest). */
  dip(amount = 0.5, duration = 0.9) {
    this.dipAmt = clamp(finite(amount), 0, 1);
    this.dipDur = Math.max(0.05, finite(duration, 0.9));
    this.dipT = this.dipDur;
  }

  /** Ghostep slow-mo: quick cool/desaturated swell held for `hold` seconds, then released. */
  ghostPulse(hold = 0.6) {
    this.ghostHold = Math.max(this.ghostHold, clamp(finite(hold, 0.6), 0.05, 3));
    if (this.ghost < 0.01) this.ghost = 0.01;
  }

  /** Instantly drop all effects (used while the screen is fully black). */
  resetInstant() {
    this.hurt = 0;
    this.warm = 0;
    this.dipT = 0;
    this.ghost = 0;
    this.ghostHold = 0;
  }

  update(dt) {
    dt = clamp(finite(dt), 0, 0.1);
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - dt * 2);
    this.fade = approach(this.fade, this.fadeTarget, this.fadeSpeed * dt);
    this.desat = approach(this.desat, this.desatTarget, this.desatSpeed * dt);
    this.warm = damp(this.warm, this.warmTarget, 1.4, dt);
    if (this.dipT > 0) this.dipT = Math.max(0, this.dipT - dt);
    if (this.ghostHold > 0) {
      this.ghostHold = Math.max(0, this.ghostHold - dt);
      this.ghost = Math.min(1, this.ghost + dt / 0.08); // fast attack
    } else if (this.ghost > 0) {
      this.ghost = Math.max(0, this.ghost - dt / 0.4); // gentle release
    }
    this._write();
  }

  _write() {
    const u = this.uniforms;
    if (!u) return;
    // low-HP heartbeat: sharp periodic pulse on the red edge
    const beat = this.lowHp > 0 ? this.lowHp * (0.1 + 0.16 * Math.pow(Math.max(0, Math.sin(this.t * 5.4)), 8)) : 0;
    const dip = this.dipT > 0 ? this.dipAmt * Math.sin(Math.PI * (1 - this.dipT / this.dipDur)) : 0;
    if (u.uHurt) u.uHurt.value = clamp(Math.max(this.hurt, beat), 0, 1);
    if (u.uFade) u.uFade.value = clamp(Math.max(this.fade, dip), 0, 1);
    const g = this.ghost * this.ghost * (3 - 2 * this.ghost);
    if (u.uDesat) u.uDesat.value = clamp(Math.max(this.desat, g * 0.38), 0, 1);
    if (u.uWarm) u.uWarm.value = clamp(this.warm * (1 - 0.85 * g), 0, 1);
  }
}
