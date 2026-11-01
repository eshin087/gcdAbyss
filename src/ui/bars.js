import { damp } from '../core/math.js';
import { el, num } from './dom.js';

// Souls-style thin bar: the fill drops instantly on a loss while a light "chunk" behind it holds
// the previous value for `hold` seconds (re-armed by every new loss), then drains. Gains rise
// smoothly. Only writes a transform when the shown value actually changes.
export class DelayedBar {
  constructor(parent, className, { hold = 0.6, drain = 2.4, rise = 6, chunk = true } = {}) {
    this.root = el('div', `ab-bar ${className}`, null, parent);
    this.chunkEl = chunk ? el('div', 'chunk', null, this.root) : null;
    this.fillEl = el('div', 'fill', null, this.root);
    this.hold = hold;
    this.drain = drain;
    this.rise = rise;
    this.target = 1;
    this.fill = 1;
    this.chunk = 1;
    this.timer = 0;
    this._wFill = -1;
    this._wChunk = -1;
  }

  /** New value 0..1. */
  set(v) {
    v = Math.min(1, Math.max(0, num(v, 0)));
    if (v < this.target - 1e-5) {
      this.timer = this.hold;
      if (this.fill > v) {
        this.chunk = Math.max(this.chunk, this.fill);
        this.fill = v;
      }
    }
    this.target = v;
  }

  /** Jump straight to a value (no chunk, no rise). */
  snap(v) {
    v = Math.min(1, Math.max(0, num(v, 0)));
    this.target = this.fill = this.chunk = v;
    this.timer = 0;
  }

  update(dt) {
    if (this.fill < this.target) {
      this.fill = damp(this.fill, this.target, this.rise, dt);
      if (this.target - this.fill < 0.002) this.fill = this.target;
    } else if (this.fill > this.target) {
      this.fill = this.target;
    }
    if (this.chunk < this.fill) {
      this.chunk = this.fill;
    } else if (this.chunk > this.fill) {
      if (this.timer > 0) this.timer -= dt;
      else {
        this.chunk -= dt * Math.max(0.12, (this.chunk - this.fill) * this.drain);
        if (this.chunk < this.fill) this.chunk = this.fill;
      }
    }
    if (Math.abs(this.fill - this._wFill) > 0.0005) {
      this._wFill = this.fill;
      this.fillEl.style.transform = `scaleX(${this.fill.toFixed(4)})`;
    }
    if (this.chunkEl && Math.abs(this.chunk - this._wChunk) > 0.0005) {
      this._wChunk = this.chunk;
      this.chunkEl.style.transform = `scaleX(${this.chunk.toFixed(4)})`;
    }
  }
}

/**
 * Enemy posture: a thin gold bar that grows from its centre outward (it fills toward a break).
 * Rises snap in with a brief brighten ('hit' class); recovery drains smoothly. `hot` near full.
 */
export class PostureBar {
  constructor(parent) {
    this.root = el('div', 'ab-bar post', null, parent);
    this.fillEl = el('div', 'fill', null, this.root);
    this.target = 0;
    this.fill = 0;
    this.hitT = 0;
    this._w = -1;
    this._hot = null;
    this._hit = null;
  }

  /** New value 0..1. */
  set(v) {
    v = Math.min(1, Math.max(0, num(v, 0)));
    if (v > this.target + 0.003) this.hitT = 0.14;
    this.target = v;
  }

  snap(v) {
    this.target = this.fill = Math.min(1, Math.max(0, num(v, 0)));
    this.hitT = 0;
  }

  update(dt) {
    if (this.fill < this.target) this.fill = Math.min(this.target, damp(this.fill, this.target, 22, dt) + 0.002);
    else if (this.fill > this.target) this.fill = Math.max(this.target, damp(this.fill, this.target, 5, dt) - 0.0005);
    if (this.hitT > 0) this.hitT -= dt;
    if (Math.abs(this.fill - this._w) > 0.0005) {
      this._w = this.fill;
      this.fillEl.style.transform = `scaleX(${this.fill.toFixed(4)})`;
    }
    const hot = this.fill > 0.75;
    if (hot !== this._hot) {
      this._hot = hot;
      this.root.classList.toggle('hot', hot);
    }
    const hit = this.hitT > 0;
    if (hit !== this._hit) {
      this._hit = hit;
      this.root.classList.toggle('hit', hit);
    }
  }
}
