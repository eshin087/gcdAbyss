import { clamp } from '../core/math.js';
import { env, perc, glide, spikes, rnd, mtof, num } from './dsp.js';

// One-shot sound recipes, played through AudioEngine.play(name, opts).
// Each entry: { prio, rev, gap, falloff, bus, gain, play(v, t, o, E) }
//   prio     voice-steal priority (0 footsteps … 6 hero sounds)
//   rev      reverb send level
//   gap      minimum seconds between two plays of the same name
//   falloff  distance attenuation multiplier for spatial sounds (<1 = carries further)
//   bus      'ui' bypasses the pause duck; default is the sfx bus
// `v` is a Voice (node factory whose output is v.out), `t` the start time in ctx seconds.

const RX_FIRE = /burn|fire|flame|breath|blaze|inferno|ball/i;

// --- shared building blocks ---------------------------------------------------------------

/**
 * Creature voice: detuned saws with vibrato → growl AM → saturation → three moving formant
 * band-passes (+ a chest lowpass), distorted breath noise riding the same growl, and a sub sine.
 * Envelope/contour points are [relativeSeconds, value].
 */
function vocal(v, t, c) {
  const D = c.D;
  const peak = c.peak ?? 1;
  const rough = c.rough ?? 0.45;
  const end = t + D + 0.05;
  const out = v.gain(0);
  out.connect(v.out);
  const amp = c.ampPts || [[0, 0], [0.12, 0.55], [D * 0.25, 1], [D * 0.75, 0.85], [D, 0]];
  env(out.gain, t, amp.map(([dt, a]) => [dt, a * peak]));

  // voiced source
  const f0 = c.pitch[0][1];
  const src = v.gain(0.5);
  const vib = v.osc('sine', rnd(5.2, 7), t, end);
  const vibAmt = v.gain(f0 * (c.vib ?? 0.035));
  vib.connect(vibAmt);
  for (const det of [-11, 8]) {
    const o = v.osc('sawtooth', f0, t, end, det);
    env(o.frequency, t, c.pitch);
    vibAmt.connect(o.frequency);
    o.connect(src);
  }
  // roughness: fast amplitude modulation = the "growl"
  const am = v.gain(1 - rough);
  const growl = v.osc('sine', c.roughHz ?? 30, t, end);
  const depth = v.gain(rough);
  growl.connect(depth).connect(am.gain);
  src.connect(am);
  const sat = v.shaper(6);
  am.connect(sat);

  const formants = [
    [c.f1, 5, 2.0],
    [c.f2, 7, 2.4],
    [c.f3, 9, 2.2],
  ];
  for (const [pts, q, g] of formants) {
    const bp = v.filter('bandpass', pts[0][1], q);
    env(bp.frequency, t, pts);
    const fg = v.gain(g);
    sat.connect(bp).connect(fg).connect(out);
  }
  const body = c.body ?? 0.3;
  if (body > 0) {
    const lp = v.filter('lowpass', 260, 0.7);
    const bg = v.gain(body);
    sat.connect(lp).connect(bg).connect(out);
  }

  // breath: distorted noise in a moving band, roughened by the same growl LFO
  const breath = c.breath ?? 0.35;
  if (breath > 0) {
    const n = v.noise('pink', t, end);
    const bp = v.filter('bandpass', 800, 0.8);
    env(bp.frequency, t, [[0, 600], [D * 0.3, 1400], [D, 700]]);
    const nd = v.shaper(18);
    const nam = v.gain(1 - rough * 0.5);
    const ndepth = v.gain(rough * 0.5);
    growl.connect(ndepth).connect(nam.gain);
    const ng = v.gain(breath);
    n.connect(bp).connect(nd).connect(nam).connect(ng).connect(out);
  }

  // sub weight (own envelope, bypasses the formant bank)
  const sub = (c.sub ?? 0.5) * peak;
  if (sub > 0) {
    const s = v.osc('sine', f0 * 0.6, t, end);
    env(s.frequency, t, [[0, f0 * 0.6], [D, Math.max(18, c.pitch[c.pitch.length - 1][1] * 0.5)]]);
    const sg = v.gain(0);
    env(sg.gain, t, [[0, 0], [Math.min(0.25, D * 0.3), sub], [D * 0.8, sub * 0.8], [D, 0]]);
    s.connect(sg).connect(v.out);
  }
  return out;
}

/** One wing beat: low whoosh through a sweeping lowpass + membrane whump + flutter. */
function flap(v, t, s) {
  const D = 0.32 + 0.14 * s;
  const n = v.noise('brown', t, t + D + 0.05, rnd(0.9, 1.1));
  const lp = v.filter('lowpass', 200, 1.4);
  env(lp.frequency, t, [[0, 160], [D * 0.35, 520 + 300 * s], [D, 140]]);
  const g = v.gain(0);
  env(g.gain, t, [[0, 0], [D * 0.35, 0.8 * s], [D, 0]]);
  n.connect(lp).connect(g).connect(v.out);

  const w = v.osc('sine', 72, t, t + D + 0.05);
  glide(w.frequency, t + D * 0.25, 72, 38, D * 0.6);
  const wg = v.gain(0);
  perc(wg.gain, t + D * 0.25, 0.4 * s, 0.03, D * 0.6);
  w.connect(wg).connect(v.out);

  const f = v.noise('pink', t, t + D + 0.02);
  const bp = v.filter('bandpass', 420, 1.6);
  const fg = v.gain(0);
  env(fg.gain, t, [[0, 0], [D * 0.4, 0.15 * s], [D, 0]]);
  f.connect(bp).connect(fg).connect(v.out);
}

/** Additive bell: inharmonic partials, each with its own decay. */
function bell(v, t, f, a, decay = 3.2) {
  for (const [r, amp, d] of [[1, 1, 1], [2, 0.45, 0.6], [3.01, 0.22, 0.4], [4.2, 0.14, 0.28], [5.43, 0.08, 0.2]]) {
    const s = v.osc('sine', f * r, t, t + decay * d + 0.05);
    const g = v.gain(0);
    perc(g.gain, t, a * amp, 0.002, decay * d);
    s.connect(g).connect(v.out);
  }
}

/** Short pitched sine/tri decay → v.out. */
function ping(v, t, type, f, a, decay, attack = 0.002) {
  const s = v.osc(type, f, t, t + attack + decay + 0.02);
  const g = v.gain(0);
  perc(g.gain, t, a, attack, decay);
  s.connect(g).connect(v.out);
  return s;
}

/** Filtered noise with a percussive envelope → v.out. */
function burst(v, t, kind, type, freq, q, a, decay, attack = 0.002) {
  const n = v.noise(kind, t, t + attack + decay + 0.02, rnd(0.92, 1.08));
  const f = v.filter(type, freq, q);
  const g = v.gain(0);
  perc(g.gain, t, a, attack, decay);
  n.connect(f).connect(g).connect(v.out);
  return f;
}

/** Filtered noise with a piecewise-linear gain envelope → v.out. Returns the filter. */
function swish(v, t, kind, type, freq, q, pts) {
  const D = pts[pts.length - 1][0];
  const n = v.noise(kind, t, t + D + 0.02, rnd(0.92, 1.08));
  const f = v.filter(type, freq, q);
  const g = v.gain(0);
  env(g.gain, t, pts);
  n.connect(f).connect(g).connect(v.out);
  return f;
}

/**
 * Sine thump with a falling pitch, plus a quieter triangle an octave up so the impact still
 * reads on small speakers that cannot reproduce the fundamental.
 */
function thump(v, t, from, to, slide, a, decay) {
  const s = v.osc('sine', from, t, t + decay + 0.05);
  glide(s.frequency, t, from, to, slide);
  const g = v.gain(0);
  perc(g.gain, t, a, 0.003, decay);
  s.connect(g).connect(v.out);
  const h = v.osc('triangle', from * 2, t, t + decay * 0.5 + 0.05);
  glide(h.frequency, t, from * 2, to * 2, slide);
  const hg = v.gain(0);
  perc(hg.gain, t, a * 0.22, 0.003, decay * 0.5);
  h.connect(hg).connect(v.out);
}

// --- catalogue ----------------------------------------------------------------------------

export const SFX = {
  // ===== player =====
  swing: {
    prio: 2, rev: 0.08, gap: 0.04,
    play(v, t, o) {
      const heavy = !!o.heavy;
      const D = heavy ? 0.42 : 0.24;
      const c = 1 + ((num(o.combo, 0) | 0) % 3) * 0.07;
      const lo = heavy ? 300 : 650;
      const hi = (heavy ? 1500 : 2900) * c * rnd(0.92, 1.08);
      const bp = swish(v, t, 'white', 'bandpass', lo, heavy ? 1.1 : 1.6, [[0, 0], [D * 0.4, heavy ? 0.75 : 0.6], [D, 0]]);
      env(bp.frequency, t, [[0, lo], [D * 0.45, hi], [D, lo * 1.3]]);
      if (heavy) {
        const s = v.osc('sine', 120, t, t + D);
        glide(s.frequency, t, 120, 55, D);
        const sg = v.gain(0);
        env(sg.gain, t, [[0, 0], [D * 0.45, 0.3], [D, 0]]);
        s.connect(sg).connect(v.out);
      }
    },
  },

  hit: {
    prio: 3, rev: 0.12, gap: 0.04,
    play(v, t, o) {
      const heavy = !!o.heavy;
      const crit = !!o.crit;
      const wing = o.part === 'wing';
      const k = heavy ? 1.3 : 1;
      // meaty thud + flesh slap
      thump(v, t, heavy ? 125 : 150, heavy ? 36 : 46, heavy ? 0.16 : 0.12, 0.85 * k, heavy ? 0.32 : 0.2);
      burst(v, t, 'brown', 'lowpass', wing ? 1500 : 950, 0.9, 0.9 * k, heavy ? 0.14 : 0.09);
      // scaly clack (membrane thwap on wings)
      burst(v, t + 0.004, 'white', 'bandpass', wing ? 700 : rnd(2300, 3200), wing ? 1.3 : 3.5, wing ? 0.7 : 0.55, wing ? 0.08 : 0.04, 0.001);
      if (!wing) {
        const q = v.osc('square', rnd(1100, 1500), t, t + 0.06);
        const hp = v.filter('highpass', 900, 0.7);
        const qg = v.gain(0);
        perc(qg.gain, t + 0.003, 0.09, 0.001, 0.025);
        q.connect(hp).connect(qg).connect(v.out);
      }
      // bright metallic ring for heavies, full for crits
      if (crit || heavy) {
        const ring = crit ? 1 : 0.45;
        for (const [f, a, d] of [[2093, 0.12, 0.35], [3136, 0.08, 0.25], [4699, 0.05, 0.18]]) {
          ping(v, t + 0.005, 'sine', f * rnd(0.99, 1.01), a * ring, d);
        }
        if (crit) burst(v, t + 0.003, 'white', 'highpass', 6000, 0.7, 0.18, 0.12, 0.001);
      }
    },
  },

  hurt: {
    prio: 4, rev: 0.1, gap: 0.08,
    play(v, t, o) {
      const k = clamp(num(o.damage, 20) / 40, 0.6, 1.4);
      thump(v, t, 95, 36, 0.14, 0.9 * k, 0.24);
      burst(v, t, 'brown', 'lowpass', 500, 0.8, 0.8 * k, 0.11);
      // grunt: a short formant "uh"
      const g0 = t + 0.025;
      const f0 = rnd(125, 150);
      const src = v.osc('sawtooth', f0, g0, g0 + 0.25);
      glide(src.frequency, g0, f0 * 1.08, f0 * 0.82, 0.2);
      const gg = v.gain(0);
      env(gg.gain, g0, [[0, 0], [0.015, 0.5], [0.08, 0.4], [0.22, 0]]);
      for (const [f, q, a] of [[560, 6, 2.2], [1050, 8, 1.6], [2400, 10, 0.6]]) {
        const bp = v.filter('bandpass', f, q);
        const fg = v.gain(a);
        src.connect(bp).connect(fg).connect(gg);
      }
      gg.connect(v.out);
      if (RX_FIRE.test(String(o.kind || ''))) swish(v, t, 'white', 'highpass', 3500, 0.7, [[0, 0], [0.02, 0.2], [0.5, 0]]);
    },
  },

  /** Burn tick / repeated breath contact: short flesh sizzle with a dull pop, no grunt. */
  sizzle: {
    prio: 2, rev: 0.06, gap: 0.12,
    play(v, t) {
      swish(v, t, 'white', 'highpass', 3800, 0.7, [[0, 0], [0.015, 0.14], [0.28, 0]]);
      const c = v.noise('white', t, t + 0.3);
      const bp = v.filter('bandpass', 2600, 0.9);
      const cg = v.gain(0);
      spikes(cg.gain, t, 0.26, 6, 0.35, 0.002, 0.006, 0.6);
      c.connect(bp).connect(cg).connect(v.out);
      burst(v, t, 'brown', 'lowpass', 420, 0.7, 0.22, 0.06);
    },
  },

  roll: {
    prio: 2, rev: 0.06, gap: 0.1,
    play(v, t) {
      const D = 0.34;
      const bp = swish(v, t, 'pink', 'bandpass', 450, 0.9, [[0, 0], [D * 0.35, 0.5], [D, 0]]);
      env(bp.frequency, t, [[0, 450], [D * 0.4, 1700], [D, 520]]);
      swish(v, t, 'white', 'highpass', 3200, 0.7, [[0, 0], [0.08, 0.09], [D, 0]]);
      const th = t + 0.24;
      thump(v, th, 80, 42, 0.12, 0.45, 0.14);
      burst(v, th, 'brown', 'lowpass', 320, 0.8, 0.35, 0.08);
    },
  },

  footstep: {
    prio: 0, rev: 0.02, gap: 0.07,
    play(v, t, o) {
      const k = o.sprint ? 1.6 : 1;
      burst(v, t, 'white', 'bandpass', rnd(2600, 4200), 0.8, 0.1 * k, rnd(0.05, 0.08), 0.006);
      burst(v, t, 'brown', 'lowpass', 220, 0.7, 0.14 * k, 0.05);
    },
  },

  heal: {
    prio: 3, rev: 0.35, gap: 0.5,
    play(v, t) {
      [69, 73, 76, 81].forEach((m, i) => {
        const t0 = t + i * 0.09;
        const f = mtof(m);
        const s = v.osc('sine', f, t0, t0 + 1.5);
        s.frequency.setValueAtTime(f, t0);
        s.frequency.linearRampToValueAtTime(f * 1.012, t0 + 1.4);
        const g = v.gain(0);
        env(g.gain, t0, [[0, 0], [0.25, 0.085], [0.6, 0.06], [1.45, 0]]);
        s.connect(g).connect(v.out);
      });
      const bp = swish(v, t, 'pink', 'bandpass', 300, 1.2, [[0, 0], [0.4, 0.14], [1.0, 0]]);
      env(bp.frequency, t, [[0, 300], [0.9, 2600]]);
      const w = v.osc('triangle', 220, t, t + 1.3);
      const lp = v.filter('lowpass', 700, 0.7);
      const wg = v.gain(0);
      env(wg.gain, t, [[0, 0], [0.35, 0.12], [1.3, 0]]);
      w.connect(lp).connect(wg).connect(v.out);
    },
  },

  noStamina: {
    prio: 1, rev: 0.03, gap: 0.25,
    play(v, t) {
      const s = v.osc('triangle', 200, t, t + 0.12);
      glide(s.frequency, t, 200, 140, 0.06);
      const lp = v.filter('lowpass', 900, 0.7);
      const g = v.gain(0);
      perc(g.gain, t, 0.28, 0.002, 0.06);
      s.connect(lp).connect(g).connect(v.out);
      burst(v, t, 'brown', 'lowpass', 600, 0.7, 0.15, 0.035, 0.001);
    },
  },

  noFlask: {
    prio: 1, rev: 0.05, gap: 0.3,
    play(v, t) {
      // muffled empty-bottle clink + a dull thunk
      const lp = v.filter('lowpass', 1800, 0.7);
      lp.connect(v.out);
      for (const [f, a, dt] of [[523, 0.07, 0], [784, 0.05, 0.012]]) {
        const s = v.osc('sine', f, t + dt, t + dt + 0.2);
        const g = v.gain(0);
        perc(g.gain, t + dt, a, 0.002, 0.16);
        s.connect(g).connect(lp);
      }
      thump(v, t, 150, 110, 0.05, 0.3, 0.07);
    },
  },

  lockOn: {
    prio: 1, rev: 0.05, gap: 0.05,
    play(v, t, o) {
      const on = o.on !== false;
      ping(v, t, 'sine', on ? 2300 : 1700, 0.07, 0.025, 0.001);
      ping(v, t + 0.035, 'sine', on ? 3100 : 1250, 0.06, 0.03, 0.001);
    },
  },

  dodge: {
    // gap > the breath's 0.15 s tick: rolling through fire dodges several ticks in one roll
    prio: 2, rev: 0.15, gap: 0.3,
    play(v, t) {
      const D = 0.22;
      const bp = swish(v, t, 'white', 'bandpass', 1800, 0.7, [[0, 0], [D * 0.4, 0.22], [D, 0]]);
      env(bp.frequency, t, [[0, 1800], [D * 0.5, 5200], [D, 3000]]);
      // faint reward shimmer
      const s = v.osc('sine', 1760, t, t + 0.36);
      glide(s.frequency, t, 1760, 2640, 0.25);
      const g = v.gain(0);
      perc(g.gain, t, 0.035, 0.01, 0.3);
      s.connect(g).connect(v.out);
    },
  },

  /** Death bell: low inharmonic gong with a long tail (player:died / setMusic('death')). */
  gong: {
    prio: 6, rev: 0.85, gap: 3,
    play(v, t) {
      const f0 = 87.3 * rnd(0.99, 1.01);
      const bus = v.gain(0.55);
      bus.connect(v.out);
      const P = [
        [0.5, 0.32, 7], [1, 0.5, 6.5], [1.003, 0.3, 6], [1.19, 0.2, 4.5], [1.56, 0.24, 4], [2.0, 0.2, 3.4],
        [2.51, 0.15, 2.8], [2.66, 0.12, 2.4], [3.01, 0.1, 2], [4.1, 0.07, 1.4], [5.4, 0.045, 0.9],
      ];
      for (const [r, a, d] of P) {
        const f = f0 * r;
        const s = v.osc('sine', f, t, t + d + 0.1);
        glide(s.frequency, t, f * 1.004, f, 0.6);
        const g = v.gain(0);
        perc(g.gain, t, a, r < 1.5 ? 0.02 : 0.004, d);
        s.connect(g).connect(bus);
      }
      burst(v, t, 'brown', 'lowpass', 260, 0.7, 0.6, 0.18);
    },
  },

  // ===== dragon =====
  /** The hero sound. opts: strength (≈0.3–1.5, scales length/weight), pitch (multiplier). */
  roar: {
    prio: 6, rev: 0.5, gap: 0.6, falloff: 0.45,
    play(v, t, o) {
      const s = clamp(num(o.strength, 1), 0.3, 1.6);
      const p = clamp(num(o.pitch, 1), 0.5, 2) * rnd(0.94, 1.06);
      const D = 1.3 + 1.1 * s;
      vocal(v, t, {
        D,
        peak: 0.6 + 0.4 * Math.min(s, 1.2),
        pitch: [[0, 46 * p], [D * 0.18, 78 * p], [D * 0.5, 70 * p], [D * 0.85, 57 * p], [D, 40 * p]],
        f1: [[0, 280], [D * 0.2, 650], [D * 0.6, 560], [D, 340]],
        f2: [[0, 620], [D * 0.2, 1100], [D * 0.6, 920], [D, 620]],
        f3: [[0, 1900], [D * 0.2, 2500], [D * 0.6, 2200], [D, 1800]],
        rough: 0.45, roughHz: rnd(26, 34), breath: 0.4, sub: 0.55, body: 0.3,
      });
    },
  },

  wake: {
    prio: 5, rev: 0.4, gap: 2, falloff: 0.5,
    play(v, t) {
      const D = 1.9;
      vocal(v, t, {
        D, peak: 0.55,
        ampPts: [[0, 0], [0.7, 0.6], [1.3, 0.7], [D, 0]],
        pitch: [[0, 36], [0.8, 50], [D, 38]],
        f1: [[0, 240], [D, 380]], f2: [[0, 520], [D, 760]], f3: [[0, 1650], [D, 1900]],
        rough: 0.6, roughHz: 21, breath: 0.25, sub: 0.7, body: 0.45,
      });
      swish(v, t, 'brown', 'lowpass', 110, 0.7, [[0, 0], [0.8, 0.5], [2.2, 0]]);
      // snort at the end
      swish(v, t + 1.95, 'pink', 'bandpass', 700, 0.9, [[0, 0], [0.03, 0.35], [0.25, 0]]);
    },
  },

  dragonStep: {
    prio: 2, rev: 0.12, gap: 0.06, falloff: 0.85,
    play(v, t, o) {
      const h = !!o.heavy;
      thump(v, t, h ? 52 : 62, h ? 24 : 30, h ? 0.4 : 0.28, h ? 1.1 : 0.8, h ? 0.55 : 0.36);
      burst(v, t, 'brown', 'lowpass', h ? 220 : 170, 0.8, h ? 0.8 : 0.55, h ? 0.32 : 0.22, 0.003);
      swish(v, t, 'white', 'highpass', 2500, 0.7, [[0, 0], [0.015, h ? 0.14 : 0.09], [0.22, 0]]);
    },
  },

  wingFlap: {
    prio: 3, rev: 0.15, gap: 0.1, falloff: 0.7,
    play(v, t, o) {
      flap(v, t, clamp(num(o.strength, 1), 0.2, 2));
    },
  },

  takeoff: {
    prio: 4, rev: 0.25, gap: 1, falloff: 0.6,
    play(v, t) {
      flap(v, t, 1.2);
      flap(v, t + 0.45, 1.4);
      flap(v, t + 0.9, 1.5);
      const bp = swish(v, t, 'brown', 'bandpass', 200, 0.8, [[0, 0], [1.0, 0.35], [1.8, 0]]);
      env(bp.frequency, t, [[0, 200], [1.8, 700]]);
    },
  },

  land: {
    prio: 5, rev: 0.3, gap: 0.5, falloff: 0.55,
    play(v, t) {
      thump(v, t, 58, 20, 0.7, 1.2, 1.1);
      const n = v.noise('brown', t, t + 1.0);
      const lp = v.filter('lowpass', 280, 0.8);
      const sh = v.shaper(4);
      const ng = v.gain(0);
      perc(ng.gain, t, 0.9, 0.003, 0.8);
      n.connect(lp).connect(sh).connect(ng).connect(v.out);
      swish(v, t, 'white', 'highpass', 1800, 0.7, [[0, 0], [0.02, 0.22], [0.55, 0]]);
    },
  },

  bite: {
    prio: 4, rev: 0.12, gap: 0.15, falloff: 0.8,
    play(v, t) {
      burst(v, t, 'white', 'bandpass', 3200, 2.2, 0.6, 0.025, 0.0008);
      burst(v, t + 0.028, 'white', 'bandpass', 2500, 2.2, 0.45, 0.025, 0.0008);
      const q = v.osc('square', 900, t, t + 0.04);
      const hp = v.filter('highpass', 700, 0.7);
      const qg = v.gain(0);
      perc(qg.gain, t, 0.08, 0.001, 0.018);
      q.connect(hp).connect(qg).connect(v.out);
      thump(v, t, 170, 55, 0.12, 0.75, 0.17);
    },
  },

  /** opts.name: attack name — fire attacks get an inhale, everything else a low growl. */
  windup: {
    prio: 3, rev: 0.2, gap: 0.3, falloff: 0.7,
    play(v, t, o) {
      if (RX_FIRE.test(String(o.name || ''))) {
        const D = 0.95;
        const bp = swish(v, t, 'pink', 'bandpass', 250, 1.1, [[0, 0], [D * 0.85, 0.38], [D, 0]]);
        env(bp.frequency, t, [[0, 250], [D, 1200]]);
        // throat gurgle
        const s = v.osc('sawtooth', 45, t, t + D + 0.12);
        const lp = v.filter('lowpass', 220, 0.8);
        const am = v.gain(0.6);
        const lfo = v.osc('sine', 18, t, t + D + 0.12);
        const depth = v.gain(0.4);
        lfo.connect(depth).connect(am.gain);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [D, 0.18], [D + 0.1, 0]]);
        s.connect(lp).connect(am).connect(g).connect(v.out);
      } else {
        vocal(v, t, {
          D: 0.9, peak: 0.4,
          ampPts: [[0, 0], [0.55, 1], [0.9, 0]],
          pitch: [[0, 48], [0.9, 58]],
          f1: [[0, 320], [0.9, 430]], f2: [[0, 600], [0.9, 720]], f3: [[0, 1800], [0.9, 1950]],
          rough: 0.7, roughHz: 23, breath: 0.15, sub: 0.35, body: 0.45,
        });
      }
    },
  },

  /** Generic heavy limb/tail whoosh for dragon:attack names without a dedicated sound. */
  dragonSwipe: {
    prio: 3, rev: 0.12, gap: 0.2, falloff: 0.8,
    play(v, t) {
      const D = 0.5;
      const bp = swish(v, t, 'brown', 'bandpass', 180, 0.8, [[0, 0], [D * 0.4, 0.7], [D, 0]]);
      env(bp.frequency, t, [[0, 180], [D * 0.45, 900], [D, 250]]);
      swish(v, t, 'pink', 'bandpass', 1200, 1, [[0, 0], [D * 0.45, 0.15], [D, 0]]);
    },
  },

  dragonPain: {
    prio: 3, rev: 0.3, gap: 1.2, falloff: 0.6,
    play(v, t) {
      const D = 0.55;
      vocal(v, t, {
        D, peak: 0.5,
        ampPts: [[0, 0], [0.05, 0.8], [0.2, 1], [D, 0]],
        pitch: [[0, 110], [0.12, 135], [D, 80]],
        f1: [[0, 750], [D, 600]], f2: [[0, 1200], [D, 1000]], f3: [[0, 2600], [D, 2300]],
        rough: 0.35, roughHz: 33, breath: 0.3, sub: 0.2,
      });
    },
  },

  fireball: {
    prio: 3, rev: 0.2, gap: 0.05, falloff: 0.8,
    play(v, t) {
      const D = 0.75;
      const bp = swish(v, t, 'pink', 'bandpass', 400, 0.9, [[0, 0], [0.06, 0.55], [D, 0]]);
      env(bp.frequency, t, [[0, 400], [D * 0.3, 1400], [D, 600]]);
      swish(v, t, 'brown', 'lowpass', 320, 0.7, [[0, 0], [0.05, 0.5], [D, 0]]);
      const c = v.noise('white', t, t + D + 0.05);
      const hp = v.filter('highpass', 2500, 0.7);
      const cg = v.gain(0);
      spikes(cg.gain, t, D, 14, 0.5, 0.002, 0.008, 0.7);
      c.connect(hp).connect(cg).connect(v.out);
      thump(v, t, 80, 45, 0.3, 0.35, 0.3);
    },
  },

  /** opts.radius scales the boom (4 m = nominal). */
  explosion: {
    prio: 5, rev: 0.35, gap: 0.03, falloff: 0.6,
    play(v, t, o) {
      const s = clamp(num(o.radius, 4) / 4, 0.6, 1.6);
      thump(v, t, 72, 24, 0.8, 1.0 * s, 1.1);
      const n = v.noise('brown', t, t + 1.4);
      const lp = v.filter('lowpass', 1100, 0.8);
      env(lp.frequency, t, [[0, 1100], [0.9, 140]]);
      const sh = v.shaper(8);
      const ng = v.gain(0);
      perc(ng.gain, t, 0.85 * s, 0.002, 1.1);
      n.connect(lp).connect(sh).connect(ng).connect(v.out);
      burst(v, t, 'pink', 'bandpass', 700, 0.7, 0.6, 0.25);
      // crackle tail
      const c = v.noise('white', t + 0.08, t + 1.9);
      const cb = v.filter('bandpass', 2600, 0.8);
      const cg = v.gain(0);
      spikes(cg.gain, t + 0.08, 1.6, 30, 0.9 * s, 0.003, 0.012, 0.85);
      c.connect(cb).connect(cg).connect(v.out);
    },
  },

  stagger: {
    prio: 5, rev: 0.3, gap: 0.5, falloff: 0.6,
    play(v, t) {
      // bone/scale crunch
      const n = v.noise('white', t, t + 0.25);
      const bp = v.filter('bandpass', 1100, 0.9);
      const sh = v.shaper(30);
      const g = v.gain(0);
      perc(g.gain, t, 0.4, 0.001, 0.16);
      n.connect(bp).connect(sh).connect(g).connect(v.out);
      thump(v, t, 95, 32, 0.2, 0.9, 0.35);
      burst(v, t, 'brown', 'lowpass', 420, 0.8, 0.55, 0.2);
      // pained growl
      const D = 0.95;
      vocal(v, t + 0.08, {
        D, peak: 0.6,
        pitch: [[0, 92], [0.15, 122], [D, 60]],
        f1: [[0, 720], [D, 460]], f2: [[0, 1180], [D, 800]], f3: [[0, 2600], [D, 2000]],
        rough: 0.5, roughHz: 31, breath: 0.45, sub: 0.3,
      });
    },
  },

  /** Enraged roar + rising dissonant cluster that slams shut. opts.roar === false: swell only. */
  phase2: {
    prio: 6, rev: 0.5, gap: 2, falloff: 0.4,
    play(v, t, o, E) {
      if (o.roar !== false) SFX.roar.play(v, t, { strength: 1.25, pitch: 1.12 }, E);
      const t0 = t + 0.4;
      const D = 3.2;
      const lp = v.filter('lowpass', 150, 2.5);
      glide(lp.frequency, t0, 150, 2600, D);
      const g = v.gain(0);
      env(g.gain, t0, [[0, 0], [D * 0.9, 0.3], [D, 0.32], [D + 0.12, 0]]);
      lp.connect(g).connect(v.out);
      for (const m of [38, 39, 44, 50, 51]) {
        for (const det of [-12, 10]) {
          const s = v.osc('sawtooth', mtof(m), t0, t0 + D + 0.15, det);
          const sg = v.gain(0.12);
          s.connect(sg).connect(lp);
        }
      }
      const hp = swish(v, t0, 'white', 'highpass', 600, 0.7, [[0, 0], [D, 0.16], [D + 0.05, 0]]);
      glide(hp.frequency, t0, 600, 6000, D);
      thump(v, t0 + D, 60, 22, 0.5, 0.9, 0.9);
      burst(v, t0 + D, 'brown', 'lowpass', 200, 0.8, 0.6, 0.5);
    },
  },

  /** Long descending death roar + collapse rumble ~2.5 s in. */
  dragonDeath: {
    prio: 6, rev: 0.55, gap: 3, falloff: 0.4,
    play(v, t) {
      const D = 4.2;
      vocal(v, t, {
        D, peak: 0.9,
        ampPts: [[0, 0], [0.15, 0.7], [0.6, 1], [2.4, 0.8], [3.6, 0.4], [D, 0]],
        pitch: [[0, 58], [0.5, 86], [1.4, 74], [2.6, 50], [D, 28]],
        f1: [[0, 300], [0.5, 660], [2, 520], [D, 250]],
        f2: [[0, 650], [0.5, 1100], [2, 850], [D, 540]],
        f3: [[0, 1900], [0.5, 2400], [2, 2100], [D, 1600]],
        rough: 0.55, roughHz: 27, breath: 0.5, sub: 0.6, body: 0.35,
      });
      const c = t + 2.5;
      thump(v, c, 50, 20, 0.8, 1.2, 1.4);
      burst(v, c, 'brown', 'lowpass', 160, 0.8, 1.0, 2.4, 0.004);
      swish(v, c, 'white', 'highpass', 1500, 0.7, [[0, 0], [0.03, 0.2], [0.8, 0]]);
      thump(v, c + 0.55, 60, 26, 0.4, 0.7, 0.6);
    },
  },

  /** Fading ember hiss over the corpse (dragon:dead). */
  emberHiss: {
    prio: 2, rev: 0.25, gap: 2, falloff: 0.8,
    play(v, t) {
      const D = 4.5;
      swish(v, t, 'white', 'highpass', 4500, 0.7, [[0, 0], [0.6, 0.1], [D, 0]]);
      const c = v.noise('white', t, t + D + 0.05);
      const bp = v.filter('bandpass', 2800, 0.9);
      const cg = v.gain(0);
      spikes(cg.gain, t, D, 34, 0.4, 0.002, 0.01, 0.9);
      c.connect(bp).connect(cg).connect(v.out);
      swish(v, t, 'brown', 'lowpass', 200, 0.7, [[0, 0], [0.5, 0.18], [D, 0]]);
    },
  },

  // ===== world / ui =====
  bonfire: {
    prio: 4, rev: 0.4, gap: 1,
    play(v, t) {
      const bp = swish(v, t, 'pink', 'bandpass', 200, 0.8, [[0, 0], [0.5, 0.32], [2.0, 0]]);
      env(bp.frequency, t, [[0, 200], [0.7, 1500], [2.0, 400]]);
      for (let i = 0; i < 10; i++) {
        ping(v, t + 0.25 + Math.random() * 1.6, 'sine', rnd(3000, 6500), rnd(0.025, 0.06), 0.14);
      }
      for (const m of [45, 52, 57]) {
        const s = v.osc('sine', mtof(m), t, t + 2.65);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [0.8, 0.07], [2.6, 0]]);
        s.connect(g).connect(v.out);
      }
    },
  },

  /** Bright bell chord swell (game:victory). */
  victory: {
    prio: 6, rev: 0.6, gap: 3,
    play(v, t) {
      [62, 66, 69, 74, 81].forEach((m, i) => bell(v, t + i * 0.14, mtof(m), 0.12, 3.6));
      swish(v, t, 'pink', 'bandpass', 2400, 0.6, [[0, 0], [1.2, 0.07], [3.5, 0]]);
      const lp = v.filter('lowpass', 800, 0.7);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [1.5, 0.06], [4, 0]]);
      lp.connect(g).connect(v.out);
      for (const m of [50, 57]) {
        for (const det of [-6, 6]) v.osc('sawtooth', mtof(m), t, t + 4.05, det).connect(lp);
      }
    },
  },

  /** Soft low chime for area banners. */
  area: {
    prio: 2, rev: 0.6, gap: 2,
    play(v, t) {
      bell(v, t, mtof(50), 0.06, 3.5);
      bell(v, t + 0.25, mtof(57), 0.045, 3);
      const s = v.osc('sine', mtof(38), t, t + 3.05);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.8, 0.08], [3, 0]]);
      s.connect(g).connect(v.out);
    },
  },

  /** Reverse-swell for retry after death. */
  retry: {
    prio: 3, rev: 0.4, gap: 1,
    play(v, t) {
      const lp = swish(v, t, 'pink', 'lowpass', 300, 0.8, [[0, 0], [0.95, 0.25], [1.02, 0]]);
      glide(lp.frequency, t, 300, 2400, 1.0);
      const s = v.osc('sine', mtof(38), t, t + 1.1);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.9, 0.12], [1.05, 0]]);
      s.connect(g).connect(v.out);
    },
  },

  /** UI blips. opts.kind: 'select' | 'start' | 'pause' | 'resume' | 'error'. */
  blip: {
    prio: 1, rev: 0.1, gap: 0.04, bus: 'ui',
    play(v, t, o) {
      const k = o.kind || 'select';
      const seq =
        k === 'pause' ? [[880, 0], [660, 0.06]]
          : k === 'resume' ? [[660, 0], [880, 0.06]]
            : k === 'start' ? [[587, 0], [880, 0.08], [1175, 0.16]]
              : k === 'error' ? [[220, 0], [196, 0.07]]
                : [[1320, 0]];
      for (const [f, dt] of seq) ping(v, t + dt, 'triangle', f, 0.09, k === 'start' ? 0.35 : 0.07, 0.003);
    },
  },
};
