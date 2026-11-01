import { NodeBag } from './voice.js';
import { env, perc, glide, rampTo, mtof, rnd, pick } from './dsp.js';

// Procedural score. Each mode is a MusicLayer feeding the music bus; AudioEngine crossfades
// layers (1.5 s) and calls schedule(now, lookahead) every frame. Percussion and swells are
// short-lived Voices from the engine's 'music' pool, scheduled ahead on ctx.currentTime.
//
//   ambient  sparse low A drone + occasional soft pentatonic chimes
//   boss     D-minor drone, taiko ostinato at 80 BPM (sine kicks w/ pitch drop, noise slaps,
//            o-daiko every 4 bars) and low brassy filtered-saw swells every 2 bars
//   boss2    boss + 16th shime percussion, extra kicks and a dissonant formant "choir"
//   victory  calm D-major pad swell with bell chimes (engine settles to ambient afterwards)

class MusicLayer extends NodeBag {
  constructor(E, rev) {
    super(E);
    this.kind = 'layer';
    this.fading = false;
    this.deadAt = Infinity;
    this.out = this.gain(0);
    this.out.connect(E.musicBus);
    if (rev > 0 && E.reverbIn) this.out.connect(this.gain(rev)).connect(E.reverbIn);
  }

  fadeIn(now, dur) {
    rampTo(this.out.gain, 1, now, dur);
  }

  fadeOut(now, dur) {
    this.fading = true;
    rampTo(this.out.gain, 0, now, dur);
    this.deadAt = now + dur + 0.4;
  }

  /** Short-lived voice in the engine's music pool, routed into this layer. */
  voice(bus, rev = 0.2, pan = 0, prio = 1) {
    return this.E._voice('music', { bus, rev, pan, prio });
  }

  schedule() {}
}

const PADS = {
  ambient: {
    kind: 'ambient', rev: 0.45,
    notes: [33, 40, 45], wave: 'triangle', detune: [-5, 5], voiceGain: 0.22, sine: 0,
    cutoff: 420, level: 0.3, attack: 2.5,
    chimes: [57, 60, 62, 64, 67, 69], chimeFirst: [3, 6], chimeEvery: [7, 14],
    chimePeak: 0.1, chimeAttack: 1.2, chimeHold: 0.4, chimeRelease: 4.5,
  },
  victory: {
    kind: 'victory', rev: 0.55,
    notes: [50, 54, 57, 62, 66], wave: 'sawtooth', detune: [-7, 6], voiceGain: 0.06, sine: 0.08,
    cutoff: 900, level: 0.6, attack: 4,
    chimes: [74, 76, 78, 81, 83, 86], chimeFirst: [1, 2], chimeEvery: [1.4, 3.2],
    chimePeak: 0.08, chimeAttack: 0.01, chimeHold: 0, chimeRelease: 2.5,
  },
};

class PadMusic extends MusicLayer {
  constructor(E, cfg) {
    super(E, cfg.rev);
    this.kind = cfg.kind;
    this.cfg = cfg;
    const now = this.ctx.currentTime;
    const lp = this.filter('lowpass', cfg.cutoff, 0.8);
    const lfo = this.osc('sine', 0.045, now);
    lfo.connect(this.gain(cfg.cutoff * 0.35)).connect(lp.frequency);
    const pad = this.gain(0);
    pad.gain.setValueAtTime(0, now);
    pad.gain.linearRampToValueAtTime(cfg.level, now + cfg.attack);
    lp.connect(pad).connect(this.out);
    for (const m of cfg.notes) {
      const f = mtof(m);
      for (const det of cfg.detune) this.osc(cfg.wave, f, now, null, det).connect(this.gain(cfg.voiceGain)).connect(lp);
      if (cfg.sine > 0) this.osc('sine', f, now).connect(this.gain(cfg.sine)).connect(lp);
    }
    this.nextChime = now + rnd(cfg.chimeFirst[0], cfg.chimeFirst[1]);
  }

  schedule(now, ahead) {
    if (this.fading) return;
    const c = this.cfg;
    if (this.nextChime < now - 0.5) this.nextChime = now + 0.05;
    let guard = 0;
    while (this.nextChime < now + ahead && guard++ < 4) {
      this._chime(this.nextChime);
      this.nextChime += rnd(c.chimeEvery[0], c.chimeEvery[1]);
    }
  }

  _chime(t) {
    const c = this.cfg;
    const v = this.voice(this.out, 0.5, rnd(-0.5, 0.5));
    if (!v) return;
    const f = mtof(pick(c.chimes));
    const a = c.chimeAttack, h = c.chimeHold, r = c.chimeRelease;
    for (const [mult, amp] of [[1, 1], [2, 0.2], [3, 0.06]]) {
      const s = v.osc('sine', f * mult, t, t + a + h + r + 0.05);
      const g = v.gain(0);
      if (a < 0.05) perc(g.gain, t, c.chimePeak * amp, a, r / mult);
      else env(g.gain, t, [[0, 0], [a, c.chimePeak * amp], [a + h, c.chimePeak * amp * 0.8], [a + h + r, 0]]);
      s.connect(g).connect(v.out);
    }
  }
}

// 32 sixteenth-steps = 2 bars of 4/4. Values are accents.
const KICK = { 0: 1, 6: 0.7, 12: 0.8, 16: 1, 20: 0.6, 22: 0.8, 28: 0.45, 30: 0.6 };
const SLAP = { 4: 0.55, 10: 0.45, 26: 0.5 };
const KICK2 = { 3: 0.4, 9: 0.45, 19: 0.4, 25: 0.45, 29: 0.5, 31: 0.55 };
const SHIME = [1, 0, 0.45, 0.6, 0.8, 0, 0.5, 0.35, 1, 0.3, 0.5, 0.6, 0.8, 0, 0.6, 0.4];
// Dm – B♭ – Gm – A (harmonic-minor dominant), low brass voicings
const CHORDS = [[38, 45, 50, 53], [34, 41, 46, 50], [31, 38, 43, 46], [33, 40, 45, 49]];

export class BossMusic extends MusicLayer {
  constructor(E, level) {
    super(E, 0.22);
    this.kind = 'boss';
    const now = this.ctx.currentTime;
    this.step = 60 / 80 / 4;
    this.i = 0;
    this.nextT = now + 0.12;
    this.level = 0;
    this.choir = null;
    this.drums = this.gain(1);
    this.drums.connect(this.out);
    this.extra = this.gain(0); // boss2 percussion
    this.extra.connect(this.out);

    // ominous drone: D1 + D2 saws through a breathing lowpass (harmonics up to ~300 Hz keep
    // it audible on laptop speakers), D2 / F2 / A2 sines above
    const lp = this.filter('lowpass', 220, 1.2);
    lp.connect(this.gain(0.28)).connect(this.out);
    for (const det of [-6, 7]) this.osc('sawtooth', mtof(26), now, null, det).connect(lp);
    this.osc('sawtooth', mtof(38), now, null, 3).connect(this.gain(0.45)).connect(lp);
    this.osc('sine', 0.06, now).connect(this.gain(70)).connect(lp.frequency);
    this.osc('sine', mtof(38), now).connect(this.gain(0.1)).connect(this.out);
    this.osc('sine', mtof(41), now).connect(this.gain(0.03)).connect(this.out);
    const fifth = this.gain(0.04);
    this.osc('sine', mtof(45), now).connect(fifth).connect(this.out);
    this.osc('sine', 0.2, now).connect(this.gain(0.025)).connect(fifth.gain);

    this.setIntensity(level, now, 0);
  }

  /** 1 = boss, 2 = boss2. Extra parts fade in/out over `fade` seconds on the same beat grid. */
  setIntensity(level, now, fade) {
    this.level = level;
    if (level >= 2 && !this.choir) this._buildChoir(now);
    const on = level >= 2 ? 1 : 0;
    rampTo(this.extra.gain, on, now, fade);
    if (this.choir) rampTo(this.choir.gain, on * 0.3, now, fade);
  }

  _buildChoir(now) {
    // dissonant cluster D3 / E♭3 / A3 of vibrato saws → "ah"/"oh" formant bank
    const sum = this.gain(0.18);
    const vib = this.osc('sine', 5.2, now);
    const vibAmt = this.gain(9); // cents
    vib.connect(vibAmt);
    for (const m of [50, 51, 57]) {
      for (const det of [-7, 7]) {
        const o = this.osc('sawtooth', mtof(m), now, null, det);
        vibAmt.connect(o.detune);
        o.connect(sum);
      }
    }
    const lp = this.filter('lowpass', 3200, 0.7);
    this.choir = this.gain(0);
    lp.connect(this.choir).connect(this.out);
    const bank = [[700, 5, 2, 160, 0.05], [1150, 7, 1.5, 280, 0.07], [2700, 9, 0.8, 0, 0]];
    for (const [f, q, g, depth, hz] of bank) {
      const bp = this.filter('bandpass', f, q);
      if (depth > 0) this.osc('sine', hz, now).connect(this.gain(depth)).connect(bp.frequency);
      sum.connect(bp).connect(this.gain(g)).connect(lp);
    }
  }

  schedule(now, ahead) {
    if (this.fading) return;
    if (this.nextT < now - 0.1) {
      // fell behind (tab throttled): skip missed steps instead of firing them all at once
      const n = Math.ceil((now - this.nextT) / this.step);
      this.nextT += n * this.step;
      this.i += n;
    }
    let guard = 0;
    while (this.nextT < now + ahead && guard++ < 16) {
      this._step(this.i, this.nextT);
      this.i++;
      this.nextT += this.step;
    }
  }

  _step(i, t) {
    const s = i % 32;
    if (KICK[s]) this._kick(t, KICK[s], this.drums);
    if (SLAP[s]) this._slap(t, SLAP[s]);
    if (i % 64 === 0) this._odaiko(t);
    if (s === 0) this._brass(t, CHORDS[((i / 32) | 0) % 4]);
    if (this.level >= 2) {
      const sh = SHIME[s % 16];
      if (sh) this._shime(t, sh);
      if (KICK2[s]) this._kick(t, KICK2[s], this.extra);
    }
  }

  _kick(t, acc, bus) {
    const v = this.voice(bus, 0.2, 0, 2);
    if (!v) return;
    const s = v.osc('sine', 150, t, t + 0.75);
    s.frequency.setValueAtTime(150, t);
    s.frequency.exponentialRampToValueAtTime(58, t + 0.07);
    s.frequency.exponentialRampToValueAtTime(46, t + 0.5);
    const g = v.gain(0);
    perc(g.gain, t, 0.55 * acc, 0.002, 0.6);
    s.connect(g).connect(v.out);
    const sk = v.osc('triangle', 240, t, t + 0.15);
    glide(sk.frequency, t, 240, 120, 0.08);
    const kg = v.gain(0);
    perc(kg.gain, t, 0.12 * acc, 0.001, 0.1);
    sk.connect(kg).connect(v.out);
    const n = v.noise('white', t, t + 0.06);
    const lp = v.filter('lowpass', 1100, 0.7);
    const ng = v.gain(0);
    perc(ng.gain, t, 0.14 * acc, 0.001, 0.03);
    n.connect(lp).connect(ng).connect(v.out);
  }

  _odaiko(t) {
    const v = this.voice(this.drums, 0.3, 0, 2);
    if (!v) return;
    const s = v.osc('sine', 72, t, t + 1.8);
    glide(s.frequency, t, 72, 30, 0.3);
    const g = v.gain(0);
    perc(g.gain, t, 0.75, 0.003, 1.7);
    s.connect(g).connect(v.out);
    const n = v.noise('brown', t, t + 1.0);
    const lp = v.filter('lowpass', 130, 0.7);
    const ng = v.gain(0);
    perc(ng.gain, t, 0.35, 0.003, 0.9);
    n.connect(lp).connect(ng).connect(v.out);
  }

  _slap(t, acc) {
    const v = this.voice(this.drums, 0.2, -0.25);
    if (!v) return;
    const n = v.noise('white', t, t + 0.09);
    const bp = v.filter('bandpass', 1900, 1.3);
    const g = v.gain(0);
    perc(g.gain, t, 0.22 * acc, 0.001, 0.06);
    n.connect(bp).connect(g).connect(v.out);
    const s = v.osc('triangle', 720, t, t + 0.05);
    const sg = v.gain(0);
    perc(sg.gain, t, 0.07 * acc, 0.001, 0.025);
    s.connect(sg).connect(v.out);
  }

  _shime(t, acc) {
    const v = this.voice(this.extra, 0.15, 0.3, 0);
    if (!v) return;
    const n = v.noise('white', t, t + 0.07);
    const bp = v.filter('bandpass', 3800, 2.5);
    const g = v.gain(0);
    perc(g.gain, t, 0.1 * acc, 0.001, 0.04);
    n.connect(bp).connect(g).connect(v.out);
    const s = v.osc('sine', 470, t, t + 0.08);
    const sg = v.gain(0);
    perc(sg.gain, t, 0.05 * acc, 0.001, 0.05);
    s.connect(sg).connect(v.out);
  }

  _brass(t, chord) {
    const v = this.voice(this.out, 0.35, 0, 1);
    if (!v) return;
    const D = 4.8;
    const lp = v.filter('lowpass', 160, 3);
    env(lp.frequency, t, [[0, 160], [D * 0.45, 1100], [D, 200]]);
    const g = v.gain(0);
    env(g.gain, t, [[0, 0], [D * 0.35, 0.05], [D * 0.7, 0.045], [D, 0]]);
    lp.connect(g).connect(v.out);
    for (const m of chord) {
      for (const det of [-9, 8]) v.osc('sawtooth', mtof(m), t, t + D + 0.05, det).connect(lp);
    }
  }
}

/** Layer for a music mode, or null for 'none' / 'death'. */
export function createMusic(E, mode) {
  switch (mode) {
    case 'ambient':
      return new PadMusic(E, PADS.ambient);
    case 'victory':
      return new PadMusic(E, PADS.victory);
    case 'boss':
      return new BossMusic(E, 1);
    case 'boss2':
      return new BossMusic(E, 2);
    default:
      return null;
  }
}
