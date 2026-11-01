import { clamp } from '../core/math.js';
import { distortionCurve } from './dsp.js';

// Node bookkeeping. Everything a sound creates is registered here so it can be stopped and
// disconnected in one go (WebAudio nodes otherwise linger in the graph).

export class NodeBag {
  constructor(E) {
    this.E = E;
    this.ctx = E.ctx;
    this.nodes = [];
    this.sources = [];
    this.end = this.ctx.currentTime;
  }

  _n(node) {
    this.nodes.push(node);
    return node;
  }

  /** Extend the lifetime of the bag to at least `t`. */
  until(t) {
    if (t > this.end) this.end = t;
  }

  gain(value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return this._n(g);
  }

  filter(type, freq, Q = 0.707) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    return this._n(f);
  }

  shaper(amount) {
    const s = this.ctx.createWaveShaper();
    s.curve = distortionCurve(amount);
    s.oversample = 'none';
    return this._n(s);
  }

  /** StereoPanner (falls back to a unity gain where unsupported — check `.pan` before use). */
  panner(pan = 0) {
    if (!this.ctx.createStereoPanner) return this.gain(1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return this._n(p);
  }

  /** Oscillator started at t0; stopped at t1 when given (null = runs until disposed). */
  osc(type, freq, t0, t1 = null, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.start(t0);
    if (t1 !== null) {
      o.stop(t1);
      this.until(t1);
    }
    this.sources.push(o);
    this.nodes.push(o);
    return o;
  }

  /** Looping noise from the shared tables, started at a random offset. */
  noise(kind, t0, t1 = null, rate = 1) {
    const buf = this.E.noise[kind] || this.E.noise.white;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t0, Math.random() * buf.duration * 0.9);
    if (t1 !== null) {
      s.stop(t1);
      this.until(t1);
    }
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }

  stopAll(t) {
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.until(t);
  }

  dispose() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* not connected */
      }
    }
    this.sources.length = 0;
    this.nodes.length = 0;
  }
}

/**
 * One-shot sound instance managed by an engine voice pool:
 *   recipe nodes → out (gain) → [panner] → bus   (+ panner → reverb send)
 */
export class Voice extends NodeBag {
  constructor(E, { bus, pan = 0, gain = 1, rev = 0, prio = 2 }) {
    super(E);
    this.prio = prio;
    this.start = this.ctx.currentTime;
    this.end = this.start + 0.05;
    this.killed = false;
    this.out = this.gain(gain);
    let tail = this.out;
    if (pan) {
      const p = this.panner(pan);
      tail.connect(p);
      tail = p;
    }
    tail.connect(bus);
    if (rev > 0 && E.reverbIn) {
      const s = this.gain(rev);
      tail.connect(s);
      s.connect(E.reverbIn);
    }
  }

  /** Quick fade-out (voice stealing / aborted sounds). */
  kill(now, fade = 0.03) {
    if (this.killed) return;
    this.killed = true;
    const g = this.out.gain;
    try {
      const v = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(v, now);
      g.linearRampToValueAtTime(0, now + fade);
    } catch {
      /* ignore */
    }
    for (const s of this.sources) {
      try {
        s.stop(now + fade + 0.01);
      } catch {
        /* already stopped */
      }
    }
    this.end = now + fade + 0.02;
  }
}
