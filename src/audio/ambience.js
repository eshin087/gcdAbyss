import { clamp } from '../core/math.js';
import { NodeBag } from './voice.js';
import { env, holdAt, rnd } from './dsp.js';

// Persistent sound beds: the night-forest ambience (always on after unlock) and the dragon's
// sustained fire-breath loop. Both are long-lived graphs driven from AudioEngine.update().

const TENSE = new Set(['bossIntro', 'boss', 'dead']);
const LOOKAHEAD = 0.35;

/** Push a param toward `value` only when it moved enough (avoids piling up automation). */
function follow(p, value, now, tau, eps) {
  if (!p) return;
  if (p._target !== undefined && Math.abs(p._target - value) < eps) return;
  p._target = value;
  p.setTargetAtTime(value, now, tau);
}

export class ForestAmbience extends NodeBag {
  constructor(E) {
    super(E);
    const now = this.ctx.currentTime;
    this.out = this.gain(0);
    this.out.connect(E.ambientBus);
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + 2.5);

    // wind: two brown-noise layers through slowly wandering lowpasses, panned apart
    for (const [pan, base] of [[-0.55, 0.5], [0.55, 0.42]]) {
      const n = this.noise('brown', now, null, rnd(0.85, 1.05));
      const lp = this.filter('lowpass', 340, 0.6);
      const g = this.gain(base);
      const p = this.panner(pan);
      n.connect(lp).connect(g).connect(p).connect(this.out);
      this._lfo(rnd(0.04, 0.07), 170, lp.frequency, now);
      this._lfo(rnd(0.09, 0.14), base * 0.45, g.gain, now);
    }
    // faint whistle through the branches
    const w = this.noise('white', now);
    const wb = this.filter('bandpass', 760, 9);
    const wg = this.gain(0.03);
    w.connect(wb).connect(wg).connect(this.out);
    this._lfo(0.035, 260, wb.frequency, now);
    this._lfo(0.075, 0.025, wg.gain, now);

    // crickets: persistent oscillators, chirps are gain automation only (no per-chirp nodes)
    this.cricketBus = this.gain(1);
    this.cricketBus.connect(this.out);
    this.hush = 1;
    const pans = [-0.65, 0.5, 0.05, -0.25];
    this.crickets = [4350, 4900, 4100, 5250].map((f, i) => {
      const o1 = this.osc('sine', f, now);
      const o2 = this.osc('triangle', f * 1.004, now);
      const g = this.gain(0);
      const o2g = this.gain(0.35);
      o1.connect(g);
      o2.connect(o2g).connect(g);
      g.connect(this.panner(pans[i])).connect(this.cricketBus);
      return {
        g: g.gain,
        next: now + rnd(0.3, 2.5),
        period: rnd(0.42, 0.75),
        pulses: 2 + (i % 3),
        amp: rnd(0.016, 0.03),
        on: true,
        until: now + rnd(4, 12),
      };
    });

    // bonfire: low roar + hiss + crackle spikes; level follows the player's distance
    this.fire = this.gain(0);
    this.firePan = this.panner(0);
    this.fire.connect(this.firePan).connect(this.out);
    const r = this.noise('brown', now);
    const rl = this.filter('lowpass', 240, 0.7);
    const rg = this.gain(0.5);
    r.connect(rl).connect(rg).connect(this.fire);
    this._lfo(0.9, 0.18, rg.gain, now);
    const h = this.noise('white', now);
    const hh = this.filter('highpass', 5200, 0.7);
    const hg = this.gain(0.018);
    h.connect(hh).connect(hg).connect(this.fire);
    const c = this.noise('white', now);
    this.crackleBp = this.filter('bandpass', 2400, 0.9);
    this.crackle = this.gain(0);
    c.connect(this.crackleBp).connect(this.crackle).connect(this.fire);
    this.crackleNext = now + 0.1;

    this.owlNext = now + rnd(14, 26);
  }

  _lfo(hz, depth, param, now) {
    const o = this.osc('sine', hz, now);
    const g = this.gain(depth);
    o.connect(g).connect(param);
  }

  update(now, dt, game) {
    // pausing mid-fight must not bring the crickets/owl back: judge by the pre-pause state
    const st = game.state === 'paused' ? this.E._prePause : game.state;
    const tense = TENSE.has(st);

    // insects fall silent while the wyrm is awake, and creep back afterwards
    const hush = tense ? 0 : 1;
    if (hush !== this.hush) {
      this.hush = hush;
      this.cricketBus.gain.setTargetAtTime(hush, now, hush ? 3.0 : 0.5);
    }
    if (hush > 0 || this.cricketBus.gain.value > 0.005) {
      for (const c of this.crickets) this._cricket(c, now);
    }

    this._bonfire(now, game);

    if (tense) {
      if (this.owlNext < now + 8) this.owlNext = now + 8;
    } else if (now > this.owlNext) {
      this.owlNext = now + rnd(26, 60);
      this._owl(now + 0.05);
    }
  }

  _cricket(c, now) {
    if (c.next < now) c.next = now + 0.02;
    const horizon = now + LOOKAHEAD;
    let guard = 0;
    while (c.next < horizon && guard++ < 24) {
      if (c.next >= c.until) {
        c.on = !c.on;
        c.until = c.next + (c.on ? rnd(4, 14) : rnd(1.5, 7));
      }
      if (!c.on) {
        c.next = c.until;
        continue;
      }
      for (let p = 0; p < c.pulses; p++) {
        const tp = c.next + p * 0.034;
        c.g.setValueAtTime(0, tp);
        c.g.linearRampToValueAtTime(c.amp, tp + 0.004);
        c.g.linearRampToValueAtTime(c.amp * 0.6, tp + 0.013);
        c.g.linearRampToValueAtTime(0, tp + 0.019);
      }
      c.next += c.period * rnd(0.9, 1.12);
    }
  }

  _bonfire(now, game) {
    const bf = game.world?.bonfire;
    const p = game.player?.position;
    let lvl = 0.25;
    let pan = 0;
    if (bf && p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      const lit = game.world.atmosphere?.bonfireLit !== false;
      const d = Math.hypot(bf.x - p.x, bf.z - p.z);
      const f = clamp(1 - (d - 1.5) / 22, 0, 1);
      lvl = lit ? f * f * 0.95 : 0;
      pan = clamp((bf.x - p.x) / 8, -0.8, 0.8);
    }
    follow(this.fire.gain, lvl, now, 0.25, 0.004);
    follow(this.firePan.pan, pan, now, 0.25, 0.02);

    if (this.crackleNext < now) this.crackleNext = now + 0.02;
    if (lvl < 0.002) return;
    let guard = 0;
    while (this.crackleNext < now + 0.25 && guard++ < 16) {
      const tt = this.crackleNext;
      const big = Math.random() < 0.08;
      const a = big ? rnd(0.5, 0.9) : 0.35 * Math.pow(Math.random(), 1.6);
      this.crackleBp.frequency.setValueAtTime(big ? rnd(900, 1600) : rnd(1800, 4800), tt);
      this.crackle.gain.setValueAtTime(a, tt);
      this.crackle.gain.setTargetAtTime(0, tt + 0.0008, big ? rnd(0.01, 0.025) : rnd(0.002, 0.008));
      this.crackleNext += -Math.log(1 - Math.random()) / 11;
    }
  }

  /** Distant owl: two soft hoots, panned somewhere in the treeline. */
  _owl(t) {
    const v = this.E._voice('amb', { bus: this.out, pan: rnd(-0.75, 0.75), gain: rnd(0.7, 1), rev: 0.55, prio: 1 });
    if (!v) return;
    const f = rnd(330, 390);
    const lp = v.filter('lowpass', 1200, 0.7);
    lp.connect(v.out);
    for (const [dt, len] of [[0, 0.3], [0.45, 0.55]]) {
      const t0 = t + dt;
      const s = v.osc('sine', f, t0, t0 + len + 0.05);
      env(s.frequency, t0, [[0, f * 0.92], [len * 0.25, f], [len, f * 0.9]]);
      const h2 = v.osc('sine', f * 2, t0, t0 + len + 0.05);
      const h2g = v.gain(0.08);
      const g = v.gain(0);
      env(g.gain, t0, [[0, 0], [0.06, 0.07], [len * 0.7, 0.06], [len, 0]]);
      s.connect(g);
      h2.connect(h2g).connect(g);
      g.connect(lp);
      const n = v.noise('pink', t0, t0 + len + 0.05);
      const nb = v.filter('bandpass', f, 6);
      const ng = v.gain(0);
      env(ng.gain, t0, [[0, 0], [0.06, 0.05], [len, 0]]);
      n.connect(nb).connect(ng).connect(lp);
    }
  }
}

/**
 * Sustained roaring-fire loop for the dragon's breath. start() is idempotent while active;
 * stop() fades the current instance out while a new one may already be starting.
 */
export class BreathLoop {
  constructor(E) {
    this.E = E;
    this.cur = null;
    this.dying = [];
  }

  get active() {
    return !!this.cur;
  }

  get age() {
    return this.cur ? this.cur.age : 0;
  }

  start() {
    const E = this.E;
    if (!E.ctx) return;
    if (this.cur) {
      this.cur.age = 0;
      return;
    }
    const now = E.ctx.currentTime;
    const b = new NodeBag(E);
    b.age = 0;
    b.crackleNext = now;
    b.out = b.gain(0);
    b.sp = b.gain(1);
    b.pan = b.panner(0);
    b.out.connect(b.sp).connect(b.pan).connect(E.sfxBus);
    const send = b.gain(0.25);
    b.pan.connect(send).connect(E.reverbIn);

    // roaring body
    const n = b.noise('brown', now);
    const bp = b.filter('bandpass', 420, 0.6);
    const sh = b.shaper(5);
    const ng = b.gain(0.9);
    n.connect(bp).connect(sh).connect(ng).connect(b.out);
    // turbulent hiss with a wandering band + flame flutter
    const h = b.noise('pink', now);
    const hb = b.filter('bandpass', 2200, 0.55);
    const hg = b.gain(0.4);
    h.connect(hb).connect(hg).connect(b.out);
    const l1 = b.osc('sine', 0.35, now);
    l1.connect(b.gain(700)).connect(hb.frequency);
    const l2 = b.osc('sine', 7, now);
    l2.connect(b.gain(0.12)).connect(hg.gain);
    // low rumble
    const rl = b.filter('lowpass', 150, 0.9);
    const rg = b.gain(0.35);
    rl.connect(rg).connect(b.out);
    for (const det of [0, 25]) b.osc('sawtooth', 42, now, null, det).connect(rl);
    // crackle spikes (scheduled in update)
    const c = b.noise('white', now);
    const chp = b.filter('highpass', 1800, 0.7);
    b.cg = b.gain(0);
    c.connect(chp).connect(b.cg).connect(b.out);

    b.out.gain.setValueAtTime(0, now);
    b.out.gain.linearRampToValueAtTime(0.8, now + 0.22);
    this.cur = b;
  }

  stop(fade = 0.45) {
    const b = this.cur;
    if (!b) return;
    this.cur = null;
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

  update(now, dt, game, pos) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (now > this.dying[i].deadAt) {
        this.dying[i].dispose();
        this.dying.splice(i, 1);
      }
    }
    const b = this.cur;
    if (!b) return;
    const paused = game.state === 'paused';
    if (!paused) b.age += dt;

    // the dragon is frozen mid-breath under the pause menu: fade the loop out, back on resume
    let gain = paused ? 0 : 1;
    if (pos) {
      const sp = this.E._spatial(pos.x, pos.z, 0.7);
      follow(b.pan.pan, sp.pan, now, 0.08, 0.02);
      gain *= sp.gain;
    }
    follow(b.sp.gain, gain, now, 0.08, 0.02);

    if (b.crackleNext < now) b.crackleNext = now + 0.01;
    let guard = 0;
    while (b.crackleNext < now + 0.2 && guard++ < 24) {
      const tt = b.crackleNext;
      b.cg.gain.setValueAtTime(rnd(0.1, 0.55), tt);
      b.cg.gain.setTargetAtTime(0, tt + 0.0008, rnd(0.003, 0.012));
      b.crackleNext += -Math.log(1 - Math.random()) / 26;
    }
  }
}
