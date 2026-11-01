import { NodeBag } from './voice.js';
import { holdAt, num } from './dsp.js';

// Heavy-attack charge hum: starts on 'player:charge', rises in pitch / brightness while LMB is
// held, and stops on release ('player:attack') or interruption (the engine also polls the
// player's state, so a hit, roll, death or state change never leaves it droning; under the pause
// menu it fades out and comes back on resume). Sustained sound, so it lives outside the one-shot
// voice pools, like the breath loop.

const RISE = 0.9; // s to reach the top of the sweep (when the event gives no usable duration)
const LEVEL = 0.8; // output level at full charge
const MAX_AGE = 4; // s safety stop (unpaused time)
const REPEAT = 0.25; // s: a repeated 'player:charge' this soon is the same charge, not a new one
const HOLD_STATES = new Set(['charge', 'attack', 'heavy']); // player states the hum survives

export class ChargeHum {
  constructor(E) {
    this.E = E;
    this.cur = null;
    this.dying = [];
    this.grace = 0;
    this.paused = false;
  }

  get active() {
    return !!this.cur;
  }

  /** opts.t: seconds to full charge (0.25..3), else RISE. */
  start(opts) {
    const E = this.E;
    if (!E.ctx || !E.sfxBus) return;
    const ctx = E.ctx;
    const now = ctx.currentTime;
    if (this.cur && now - this.cur.t0 < REPEAT) return;
    if (this.cur) this.stop(0.04);
    const tIn = num(opts?.t, RISE);
    const rise = tIn >= 0.25 && tIn <= 3 ? tIn : RISE;
    const b = new NodeBag(E);
    b.age = 0;
    b.t0 = now;
    b.out = b.gain(0);
    b.out.connect(E.sfxBus);
    if (E.reverbIn) b.out.connect(b.gain(0.18)).connect(E.reverbIn);

    // body: two detuned saws an octave apart through a lowpass that opens as the charge builds
    const lp = b.filter('lowpass', 380, 4);
    lp.frequency.setValueAtTime(380, now);
    lp.frequency.linearRampToValueAtTime(2600, now + rise);
    const body = b.gain(0.16);
    lp.connect(body).connect(b.out);
    for (const [mul, det] of [[1, -7], [1, 7], [2, 0]]) {
      const o = b.osc('sawtooth', 98 * mul, now, null, det);
      o.frequency.setValueAtTime(98 * mul, now);
      o.frequency.exponentialRampToValueAtTime(196 * mul, now + rise);
      o.connect(lp);
    }
    // shimmer: a sine two octaves up with a fast tremolo that speeds up
    const sh = b.osc('sine', 392, now);
    sh.frequency.setValueAtTime(392, now);
    sh.frequency.exponentialRampToValueAtTime(784, now + rise);
    const shg = b.gain(0.05);
    const trem = b.osc('sine', 6, now);
    trem.frequency.setValueAtTime(6, now);
    trem.frequency.linearRampToValueAtTime(18, now + rise);
    trem.connect(b.gain(0.04)).connect(shg.gain);
    sh.connect(shg).connect(b.out);
    // airy hiss rising with it
    const n = b.noise('pink', now);
    const bp = b.filter('bandpass', 900, 1.2);
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.linearRampToValueAtTime(4200, now + rise);
    n.connect(bp).connect(b.gain(0.06)).connect(b.out);

    b.out.gain.setValueAtTime(0, now);
    b.out.gain.linearRampToValueAtTime(0.55, now + 0.12);
    b.out.gain.linearRampToValueAtTime(LEVEL, now + rise);
    this.cur = b;
    this.paused = false;
    this.grace = 0.12; // the player's state may lag the event by a frame
  }

  stop(fade = 0.08) {
    const b = this.cur;
    if (!b) return;
    this.cur = null;
    this.paused = false;
    const now = this.E.ctx.currentTime;
    try {
      holdAt(b.out.gain, now);
      b.out.gain.linearRampToValueAtTime(0, now + fade);
    } catch {
      /* ignore */
    }
    b.stopAll(now + fade + 0.05);
    b.deadAt = now + fade + 0.25;
    this.dying.push(b);
  }

  /** Per frame: dispose faded hums, stop on interruption, fade out under the pause menu. */
  update(now, dt, game) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (now > this.dying[i].deadAt) {
        this.dying[i].dispose();
        this.dying.splice(i, 1);
      }
    }
    const b = this.cur;
    if (!b) return;
    const st = game.state;
    if (st === 'paused') {
      // the charge is frozen with the game; a drone under the menu would be the only thing left
      if (!this.paused) {
        this.paused = true;
        this._level(b, 0, 0.08, now);
      }
      return;
    }
    if (this.paused) {
      this.paused = false;
      this._level(b, LEVEL, 0.12, now);
      this.grace = Math.max(this.grace, 0.12);
    }
    b.age += dt;
    if (this.grace > 0) this.grace -= dt;
    const ps = game.player?.state;
    const interrupted = this.grace <= 0 && typeof ps === 'string' && !HOLD_STATES.has(ps);
    const wrongState = st !== 'explore' && st !== 'boss' && st !== 'bossIntro';
    if (interrupted || wrongState || b.age > MAX_AGE || game.player?.alive === false) this.stop(0.1);
  }

  _level(b, value, dur, now) {
    try {
      holdAt(b.out.gain, now);
      b.out.gain.linearRampToValueAtTime(value, now + dur);
    } catch {
      /* ignore */
    }
  }
}
