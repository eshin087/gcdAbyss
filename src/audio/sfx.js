import { clamp } from '../core/math.js';
import { env, perc, glide, spikes, rnd, mtof, num, arand } from './dsp.js';
import { tuneParry } from './streakSound.js';

// One-shot sound recipes, played through AudioEngine.play(name, opts).
// Each entry: { prio, rev, gap, falloff, bus, gain, play(v, t, o, E) }
//   prio     voice-steal priority (0 footsteps … 6 hero sounds)
//   rev      reverb send level
//   gap      minimum seconds between two plays of the same name
//   falloff  distance attenuation multiplier for spatial sounds (<1 = carries further)
//   bus      'ui' bypasses the pause duck; 'cue' (combat cues) bypasses the Ghostep low-pass but
//            not the pause duck; default is the sfx bus
// `v` is a Voice (node factory whose output is v.out), `t` the start time in ctx seconds.

export const RX_FIRE = /burn|fire|flame|breath|blaze|inferno|ball/i;

// the 'cut' layer's noise offset from its own stream (the seeded sims replay the AI's Math.random)
let cseed = 0x3c6ef372;
const crnd = () => (cseed = (Math.imul(cseed, 1664525) + 1013904223) >>> 0) / 4294967296;
/** A landed cut per weight (player:hitDragon `weight`): the slice's band sweep f0 → f1 Hz over D s at
 *  peak a, and its ring (gain, decay s). */
export const CUT_SND = {
  light: { f0: 5200, f1: 1700, D: 0.075, a: 0.32, ring: 0.05, rd: 0.14 },
  sweep: { f0: 4800, f1: 1500, D: 0.09, a: 0.34, ring: 0.055, rd: 0.16 },
  point: { f0: 6200, f1: 2600, D: 0.06, a: 0.3, ring: 0.06, rd: 0.12 },
  slam: { f0: 4200, f1: 900, D: 0.12, a: 0.45, ring: 0.08, rd: 0.22 },
  cleave: { f0: 4400, f1: 800, D: 0.14, a: 0.48, ring: 0.09, rd: 0.26 },
  execute: { f0: 5600, f1: 1200, D: 0.12, a: 0.45, ring: 0.1, rd: 0.3 },
};
const CUT_STEP = [1, 1.0595, 1.1225, 1.189, 0.84]; // a semitone up each hit of the chain; the finisher drops
/** The cut's pitch (x) for its opts: the chain's step (CUT_STEP by combo) and the ±2 % of alternate cuts
 *  (the recorded cut-light / cut-heavy play at this rate: audio.js). */
export function cutPitch(o) {
  return CUT_STEP[((((num(o.combo, 1) | 0) - 1) % 5) + 5) % 5] * (o.alt ? 1.02 : 0.98);
}

/** The parry clang's base pitch (Hz) for its opts (draws ONE value from the audio stream: the parry recipe's
 *  first draw, so the synth's sequence is unchanged): tell blue 740 else 880, two semitones up per deflect
 *  of the chain (or the streak's scale, opts.tune), a fifth higher for a returned bullet (perfect). */
function parryF0(o) {
  const big = o.tell === 'blue', pf = !!o.perfect;
  const ch = clamp(Math.round(num(o.chain, 1)), 1, 8);
  const up = Math.pow(2, ((ch - 1) * 2) / 12) * (pf ? 1.5 : 1); // +2 semitones per deflect; perfect: +a fifth
  const base = big ? 740 : 880, jit = rnd(0.98, 1.02);
  // the streak's sound on (streakSound.js): the chain climbs the scale of the playing track instead
  // of whole tones (a quarter of the jitter, so it stays in tune)
  return o.tune ? tuneParry(o.tune, base, ch) * (pf ? 1.5 : 1) * (1 + (jit - 1) * 0.25) : base * up * jit;
}
/** The perfect parry of a blade (opts.perfectMelee): a sharper crack and a high bright bell that rings
 *  through the slow motion, its ring × opts.ring (perfectMode(): sharp 0.55, cinema 1.6). */
function parryPerfectLayer(v, t, f0, rk) {
  burst(v, t, 'white', 'highpass', 5200, 1.2, 0.45, 0.03 * Math.min(1, rk), 0.0004);
  ping(v, t + 0.003, 'sine', f0 * 3, 0.08, 1.3 * rk, 0.001);
  ping(v, t + 0.003, 'triangle', f0 * 4.5, 0.035, 0.9 * rk, 0.001);
}
/** A crit's bright metallic ring (over 'hit'). */
function critRing(v, t) {
  for (const [f, a, d] of [[2093, 0.12, 0.35], [3136, 0.08, 0.25], [4699, 0.05, 0.18]]) {
    ping(v, t + 0.005, 'sine', f * rnd(0.99, 1.01), a, d);
  }
  burst(v, t + 0.003, 'white', 'highpass', 6000, 0.7, 0.18, 0.12, 0.001);
}

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

// A boss's blow through the air when its recorded clip is not there (bladeWhoosh): its own noise stream
// (the seeded sims replay the AI's Math.random; this sound must not draw from it).
let wseed = 0x510e527f;
const wrnd = () => (wseed = (Math.imul(wseed, 1664525) + 1013904223) >>> 0) / 4294967296;
/** Filtered noise with a piecewise-linear gain envelope, rate and offset from wrnd → v.out. */
function wswish(v, t, kind, type, freq, q, pts) {
  const D = pts[pts.length - 1][0];
  const n = v.noise(kind, t, t + D + 0.02, 0.92 + 0.16 * wrnd(), wrnd());
  const f = v.filter(type, freq, q);
  const g = v.gain(0);
  env(g.gain, t, pts);
  n.connect(f).connect(g).connect(v.out);
  return f;
}
/** bladeWhoosh's length (s) for its opts (weapon / weight / shape). */
function bladeDur(o) {
  const heavy = o.weight === 'heavy';
  if (o.weapon === 'fist') return o.shape === 'kick' ? 0.3 : heavy ? 0.26 : 0.17;
  if (o.shape === 'draw') return 0.2;
  if (o.shape === 'thrust') return heavy ? 0.36 : 0.3;
  return heavy ? 0.38 : 0.24;
}
const BLADE_PEAK = 0.42; // of its length: where bladeWhoosh is loudest
/** s from bladeWhoosh's start to its loudest moment (audio.js lines it up with the impact). */
export const bladeWhooshPeak = (o) => bladeDur(o || {}) * BLADE_PEAK;

// --- catalogue ----------------------------------------------------------------------------

export const SFX = {
  // ===== player =====
  swing: {
    prio: 2, rev: 0.08, gap: 0.04,
    play(v, t, o) {
      const heavy = !!o.heavy;
      const D = o.thrust ? 0.5 : heavy ? 0.42 : 0.24;
      const c = 1 + clamp((num(o.combo, 1) | 0) - 1, 0, 4) * 0.035; // every cut of the chain a step higher (1..5)
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

  /** The combo-finisher slam meets the ground: a deep crunch + glassy crystal tings. */
  slam: {
    prio: 4, rev: 0.25, gap: 0.2,
    play(v, t) {
      thump(v, t, 90, 30, 0.3, 1.0, 0.5);
      burst(v, t, 'brown', 'lowpass', 700, 0.8, 0.8, 0.22);
      burst(v, t + 0.005, 'white', 'highpass', 4200, 0.7, 0.3, 0.1, 0.001);
      for (const [f, a, d, dl] of [[2637, 0.1, 0.4, 0.01], [3520, 0.08, 0.3, 0.04], [4186, 0.06, 0.25, 0.07], [3136, 0.05, 0.35, 0.1]]) {
        ping(v, t + dl, 'sine', f * rnd(0.98, 1.02), a, d);
      }
    },
  },

  /** The Sheathed's click (ADR-145): a thumb pushes the guard: a dry wooden tick and a short high
   *  ring of steel. `loud` 1 at the draw's cue, softer as the blade goes home. */
  sheathClick: {
    prio: 5, rev: 0.22, gap: 0.08, bus: 'cue',
    play(v, t, o) {
      const k = clamp(num(o.loud, 1), 0.2, 1);
      burst(v, t, 'white', 'bandpass', 3200, 6, 0.55 * k, 0.018, 0.001);
      burst(v, t + 0.002, 'brown', 'bandpass', 900, 3, 0.35 * k, 0.03, 0.001);
      for (const [f, a, d] of [[3520, 0.11, 0.32], [5274, 0.06, 0.22], [7040, 0.035, 0.14]]) ping(v, t + 0.006, 'sine', f, a * k, d);
    },
  },
  /** The stillness: a low breath drawn in through the settle that cuts out to silence. */
  sheathBreath: {
    prio: 3, rev: 0.3, gap: 0.5,
    play(v, t) {
      const f = swish(v, t, 'pink', 'bandpass', 420, 1.4, [[0, 0], [0.25, 0.22], [0.55, 0.16], [0.6, 0]]);
      env(f.frequency, t, [[0, 300], [0.5, 620], [0.6, 640]]);
      const s = v.osc('sine', 72, t, t + 0.62);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.3, 0.12], [0.55, 0.1], [0.58, 0]]);
      s.connect(g).connect(v.out);
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
      if (o.body === 'cloth') {
        // a duelist: cloth over a body, no scales (a muffled slap, no clack or tick)
        burst(v, t + 0.004, 'brown', 'bandpass', 1100, 1.0, 0.45, 0.05, 0.001);
      } else {
        // scaly clack (membrane thwap on wings)
        burst(v, t + 0.004, 'white', 'bandpass', wing ? 700 : rnd(2300, 3200), wing ? 1.3 : 3.5, wing ? 0.7 : 0.55, wing ? 0.08 : 0.04, 0.001);
      }
      if (!wing && o.body !== 'cloth') {
        const q = v.osc('square', rnd(1100, 1500), t, t + 0.06);
        const hp = v.filter('highpass', 900, 0.7);
        const qg = v.gain(0);
        perc(qg.gain, t + 0.003, 0.09, 0.001, 0.025);
        q.connect(hp).connect(qg).connect(v.out);
      }
      // a bright metallic ring for crits (every landed cut rings in its own 'cut' layer)
      if (crit) critRing(v, t);
    },
  },
  /** A crit's ring alone: over the recorded hit-scale (audio.js), which has none of its own. */
  hitCrit: {
    prio: 3, rev: 0.12, gap: 0.04,
    play(v, t) {
      critRing(v, t);
    },
  },

  /** The blade's layer of a landed cut (over 'hit'): a slice (white noise through a falling band) and a
   *  steel ring, per weight (CUT_SND), a semitone up each hit of the chain (CUT_STEP), detuned ±2 %
   *  on alternate cuts; a crit adds a high partial. No Math.random (its noise offset: crnd). */
  cut: {
    prio: 3, rev: 0.1, gap: 0.03,
    play(v, t, o) {
      const W = CUT_SND[o.weight] ?? CUT_SND.light;
      const st = CUT_STEP[((((num(o.combo, 1) | 0) - 1) % 5) + 5) % 5], det = o.alt ? 1.02 : 0.98;
      const n = v.noise('white', t, t + W.D + 0.03, det, crnd()), bp = v.filter('bandpass', W.f0 * st, 1.3), g = v.gain(0);
      env(bp.frequency, t, [[0, W.f0 * st], [W.D, W.f1 * st]]);
      env(g.gain, t, [[0, 0], [0.004, W.a], [W.D * 0.5, W.a * 0.55], [W.D, 0]]);
      n.connect(bp).connect(g).connect(v.out);
      const f = 2350 * st * det;
      ping(v, t + 0.002, 'sine', f, W.ring, W.rd);
      ping(v, t + 0.002, 'sine', f * 2.76, W.ring * 0.5, W.rd * 0.7);
      if (o.crit) ping(v, t + 0.004, 'sine', f * 5.4, W.ring * 0.6, W.rd * 0.5);
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
  /** A burn's hiss alone (the synth hurt's fire layer): over the recorded hurt when fire struck (audio.js). */
  hurtFire: {
    prio: 4, rev: 0.1, gap: 0.08,
    play(v, t) {
      swish(v, t, 'white', 'highpass', 3500, 0.7, [[0, 0], [0.02, 0.2], [0.5, 0]]);
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

  // a step: today's burst; with the living world's steps on (`o.surface`, world/life/steps.js) the
  // ground's own sound, as quiet (prio 0: never the loudest thing), varied a little per step from
  // its own stream (`seed`: not Math.random), and a soft wet tick on wet ground
  footstep: {
    prio: 0, rev: 0.02, gap: 0.07,
    seed: 0x6d2b79f5,
    play(v, t, o, E) {
      const S = o.surface;
      if (!S) {
        const k = o.sprint ? 1.6 : 1;
        burst(v, t, 'white', 'bandpass', rnd(2600, 4200), 0.8, 0.1 * k, rnd(0.05, 0.08), 0.006);
        burst(v, t, 'brown', 'lowpass', 220, 0.7, 0.14 * k, 0.05);
        return;
      }
      const F = SFX.footstep;
      const r = (a, b) => a + (b - a) * ((F.seed = (Math.imul(F.seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const k = (o.sprint ? 1.5 : 1) * r(0.85, 1.1);
      if (S === 'grass') {
        // a soft brush: band-passed pink noise, a slow attack (no click), a faint body under it
        burst(v, t, 'pink', 'bandpass', r(850, 1350), 0.9, 0.09 * k, r(0.08, 0.11), 0.014);
        burst(v, t, 'brown', 'lowpass', 180, 0.7, 0.06 * k, 0.05, 0.01);
      } else if (S === 'earth') {
        // a dull thud
        burst(v, t, 'brown', 'lowpass', r(140, 180), 0.8, 0.2 * k, 0.06, 0.004);
        thump(v, t, r(85, 100), 50, 0.05, 0.06 * k, 0.06);
        burst(v, t, 'pink', 'lowpass', 650, 0.6, 0.03 * k, 0.05, 0.006);
      } else if (S === 'stone' || S === 'obsidian') {
        // a short dry tap; obsidian a touch glassier (higher, narrower, a faint ring)
        const glass = S === 'obsidian';
        burst(v, t, 'white', 'bandpass', glass ? r(4200, 5200) : r(2300, 3200), glass ? 3 : 1.6, 0.1 * k, glass ? 0.035 : 0.03, 0.002);
        burst(v, t, 'brown', 'lowpass', glass ? 240 : 260, 0.7, 0.1 * k, 0.035);
        if (glass) ping(v, t + 0.002, 'sine', r(2600, 3100), 0.012 * k, 0.06);
      } else if (S === 'sand') {
        // a gritty scuff
        burst(v, t, 'white', 'bandpass', r(3000, 4500), 0.6, 0.07 * k, r(0.07, 0.1), 0.01);
        burst(v, t, 'pink', 'bandpass', r(800, 1000), 0.7, 0.06 * k, 0.07, 0.008);
        burst(v, t, 'brown', 'lowpass', 200, 0.7, 0.08 * k, 0.04);
      } else if (S === 'ash') {
        // a muffled puff, a faint stone tap under it (the paving under the ash)
        burst(v, t, 'pink', 'lowpass', r(600, 800), 0.5, 0.1 * k, r(0.09, 0.12), 0.012);
        burst(v, t, 'white', 'bandpass', r(2400, 2900), 1.4, 0.03 * k, 0.025, 0.002);
        burst(v, t, 'brown', 'lowpass', 200, 0.7, 0.1 * k, 0.05);
      } else if (S === 'leaf') {
        // a small crackle: three tiny dry ticks over a brush
        for (let i = 0; i < 3; i++) burst(v, t + i * r(0.008, 0.02), 'white', 'bandpass', r(4200, 6000), 2, 0.035 * k, 0.012, 0.001);
        burst(v, t, 'pink', 'bandpass', r(1300, 1700), 0.8, 0.05 * k, 0.06, 0.008);
        burst(v, t, 'brown', 'lowpass', 200, 0.7, 0.08 * k, 0.04);
      } else {
        burst(v, t, 'brown', 'lowpass', 220, 0.7, 0.14 * k, 0.05);
      }
      // wet ground: a soft wet tick
      const wet = E?.game?.world?.life?.weather?.wet;
      if (Number.isFinite(wet) && wet > 0.3) {
        const s = v.osc('sine', 1400, t, t + 0.06);
        glide(s.frequency, t, r(1300, 1600), 650, 0.03);
        const g = v.gain(0);
        perc(g.gain, t, 0.018 * Math.min(1, wet) * k, 0.002, 0.03);
        s.connect(g).connect(v.out);
        burst(v, t + 0.004, 'white', 'bandpass', r(1600, 2000), 3, 0.025 * Math.min(1, wet) * k, 0.02);
      }
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

  // ===== combat cues: tells, timing flash, defence answers =====
  // Tell / flash / Ghostep sounds use the 'cue' bus (past the Ghostep low-pass, still muffled by
  // pause) and a low falloff: they are the player's reaction cues and must cut through the mix.

  /** Blue tell (parry it): bright rising "shing" — a blade drawn on steel into a rising bell. */
  tellBlue: {
    prio: 6, rev: 0.3, gap: 0.12, falloff: 0.25, bus: 'cue',
    play(v, t) {
      const bp = swish(v, t, 'white', 'bandpass', 2400, 2.6, [[0, 0], [0.025, 0.34], [0.14, 0.14], [0.42, 0]]);
      glide(bp.frequency, t, 2400, 8200, 0.32);
      // inharmonic bell partials that glide up a fourth as they ring (the "rising" part)
      const f = mtof(88);
      for (const [r, a, d] of [[1, 0.17, 0.9], [2.0, 0.07, 0.6], [2.76, 0.06, 0.45], [5.4, 0.03, 0.25]]) {
        const s = v.osc('sine', f * r, t, t + d + 0.06);
        glide(s.frequency, t, f * r * 0.75, f * r, 0.12);
        const g = v.gain(0);
        perc(g.gain, t, a, 0.004, d);
        s.connect(g).connect(v.out);
      }
      ping(v, t + 0.06, 'sine', mtof(100), 0.05, 0.32);
    },
  },

  /** Red tell (dodge it): ominous low brass stab with grit — a distorted, sagging horn chord. */
  tellRed: {
    prio: 6, rev: 0.35, gap: 0.12, falloff: 0.25, bus: 'cue',
    play(v, t) {
      const D = 0.72;
      const lp = v.filter('lowpass', 260, 3);
      env(lp.frequency, t, [[0, 260], [0.05, 2300], [0.25, 950], [D, 380]]);
      const grit = v.shaper(22);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.022, 0.42], [0.18, 0.3], [D * 0.8, 0.17], [D, 0]]);
      lp.connect(grit).connect(g).connect(v.out);
      // D2 power chord + a minor-second rub for menace; the pitch sags at the tail
      for (const [m, a] of [[38, 0.3], [45, 0.22], [50, 0.17], [39, 0.11]]) {
        const f = mtof(m);
        for (const det of [-9, 9]) {
          const o = v.osc('sawtooth', f, t, t + D + 0.05, det);
          glide(o.frequency, t + 0.32, f, f * 0.94, D - 0.32);
          const og = v.gain(a);
          o.connect(og).connect(lp);
        }
      }
      thump(v, t, 72, 36, 0.25, 0.7, 0.42);
      // raspy breath of the horn
      const n = v.noise('pink', t, t + 0.4);
      const nb = v.filter('bandpass', 700, 1.2);
      const ns = v.shaper(40);
      const ng = v.gain(0);
      perc(ng.gain, t, 0.16, 0.006, 0.28);
      n.connect(nb).connect(ns).connect(ng).connect(v.out);
    },
  },

  /** Normal tell: a faint tick (the white glint carries it visually). */
  tellTick: {
    prio: 3, rev: 0.05, gap: 0.12, falloff: 0.4, bus: 'cue',
    play(v, t) {
      ping(v, t, 'triangle', 3400, 0.045, 0.03, 0.001);
      burst(v, t, 'white', 'highpass', 5000, 0.7, 0.035, 0.015, 0.0008);
    },
  },

  /**
   * combat:flash — the TIMING cue (~0.35 s before impact). opts.tell: blue → crystal ping,
   * red → whoosh-crack, normal → short glint. Instant attacks so the cue lands on the beat.
   */
  flash: {
    prio: 6, rev: 0.22, gap: 0.08, falloff: 0.2, bus: 'cue',
    play(v, t, o) {
      if (o.tell === 'red') {
        // a short rising air rip that snaps into a sharp crack
        const W = 0.06;
        const bp = swish(v, t, 'white', 'bandpass', 600, 1.2, [[0, 0.06], [W, 0.5], [W + 0.01, 0]]);
        glide(bp.frequency, t, 600, 5200, W);
        const c = t + W;
        const n = v.noise('white', c, c + 0.12);
        const hp = v.filter('highpass', 1500, 0.7);
        const sh = v.shaper(60);
        const g = v.gain(0);
        perc(g.gain, c, 0.5, 0.0008, 0.07);
        n.connect(hp).connect(sh).connect(g).connect(v.out);
        thump(v, c, 180, 60, 0.06, 0.55, 0.12);
        ping(v, c, 'square', 1900, 0.05, 0.02, 0.0005);
      } else if (o.tell === 'blue') {
        // crystal ping: glassy high partials with an instant attack
        for (const [f, a, d] of [[2637, 0.2, 0.45], [3951, 0.13, 0.35], [5274, 0.08, 0.25], [7040, 0.05, 0.16]]) {
          ping(v, t, 'sine', f, a, d, 0.001);
        }
        burst(v, t, 'white', 'highpass', 7000, 0.7, 0.16, 0.03, 0.0005);
      } else {
        ping(v, t, 'sine', 3136, 0.1, 0.12, 0.001);
        ping(v, t + 0.03, 'sine', 4699, 0.06, 0.1, 0.001);
        burst(v, t, 'white', 'highpass', 6500, 0.7, 0.08, 0.02, 0.0005);
      }
    },
  },

  /**
   * player:parry — steel clang + an ascending sparkle ring. opts.tell 'blue': bigger, held shimmer.
   * opts.chain (the deflect chain count, 1 = a single parry): each deflect in rhythm rings two
   * semitones higher (up to an octave and a bit) with a bright bell 'ting' over it, Sekiro style.
   * opts.perfect (a perfectly parried bullet sent back): a fifth higher and brighter, a gold bell on top.
   */
  parry: {
    prio: 6, rev: 0.4, gap: 0.06,
    play(v, t, o) {
      const big = o.tell === 'blue';
      const pf = !!o.perfect;
      const k = (big ? 1.25 : 1) * (pf ? 1.15 : 1);
      const len = big ? 1.5 : 1;
      const ch = clamp(Math.round(num(o.chain, 1)), 1, 8);
      const up = Math.pow(2, ((ch - 1) * 2) / 12) * (pf ? 1.5 : 1); // +2 semitones per deflect; perfect: +a fifth
      // struck steel: inharmonic partials, instant attack, ringing decay (+ a detuned twin = beating)
      const f0 = parryF0(o);
      // a single perfect parry's ring per perfectMode() (sharp: tighter, cinema: a longer tail; today: 1)
      const rk = num(o.ring, 1);
      for (const [r, a, d] of [[1, 0.2, 0.7], [1.006, 0.1, 0.8], [2.32, 0.15, 0.55], [3.7, 0.11, 0.4], [5.1, 0.08, 0.3], [6.9, 0.05, 0.22]]) {
        ping(v, t, 'sine', f0 * r, a * k, d * len, 0.001);
      }
      burst(v, t, 'white', 'bandpass', 4200, 1.5, 0.5 * k, 0.05, 0.0006);
      burst(v, t, 'white', 'highpass', 8000, 0.7, 0.2 * k, 0.08, 0.0005);
      thump(v, t, 160, 70, 0.08, 0.5 * k, 0.15);
      if (o.melee) {
        // a blade met (not a bullet): the weight of the blow behind it: a deep body, a low ring,
        // a cracking edge (owner, 2026-11-12: "make the parry effect epic and impactful")
        thump(v, t, 120, 40, 0.14, 0.85 * k, 0.32);
        ping(v, t, 'sine', f0 * 0.5, 0.12 * k, 0.9 * len, 0.001);
        burst(v, t, 'pink', 'lowpass', 1400, 0.8, 0.4 * k, 0.12);
      }
      // perfect: a sharper crack and a high bright bell that rings through the slow motion
      if (o.perfectMelee) parryPerfectLayer(v, t, f0, rk);
      if (ch >= 2) {
        // the chain's ring: a high bell on the clang's pitch, longer and brighter as it climbs
        const a = 0.05 + 0.012 * Math.min(6, ch);
        ping(v, t + 0.005, 'sine', f0 * 2, a, 0.9 + 0.1 * ch, 0.001);
        ping(v, t + 0.005, 'triangle', f0 * 3.01, a * 0.5, 0.6, 0.001);
      }
      if (pf) {
        // the return: a bright gold bell over the clang and a quick rising whoosh after the shot
        ping(v, t + 0.004, 'sine', f0 * 2.5, 0.09, 1.1, 0.001);
        ping(v, t + 0.004, 'triangle', f0 * 4.02, 0.04, 0.7, 0.001);
        const bp = swish(v, t + 0.03, 'white', 'bandpass', 2500, 2.5, [[0, 0], [0.04, 0.1], [0.3, 0]]);
        glide(bp.frequency, t + 0.03, 2500, 7000, 0.3);
      }
      // sparkle ring: quick ascending glints
      const notes = big ? [88, 91, 95, 100, 103] : [91, 95, 100];
      // (tuned: the glints are the scale's next notes above the clang's octave)
      notes.forEach((m, i) => ping(v, t + 0.04 + i * 0.035, 'sine', o.tune ? tuneParry(o.tune, f0 * 2, i + (big ? 0 : 1) + 1) : mtof(m) * up, 0.05 * k, 0.35, 0.002));
      if (big) {
        // deflect: a crystalline shimmer blooming over the clang + rising air
        for (const det of [0, 7]) {
          const s = v.osc('sine', mtof(100), t + 0.02, t + 1.32, det);
          const g = v.gain(0);
          env(g.gain, t + 0.02, [[0, 0], [0.08, 0.05], [1.28, 0]]);
          s.connect(g).connect(v.out);
        }
        const bp = swish(v, t, 'white', 'bandpass', 3000, 2, [[0, 0], [0.05, 0.12], [0.6, 0]]);
        glide(bp.frequency, t, 3000, 9000, 0.6);
      }
    },
  },

  /** The perfect parry's own layer alone (parry's opts.perfectMelee block, its pitch from the same opts):
   *  over the recorded parry-blue (audio.js _parry), the crack and the high bell, ring × opts.ring. */
  parryPerfect: {
    prio: 6, rev: 0.4, gap: 0.06,
    play(v, t, o) {
      parryPerfectLayer(v, t, parryF0(o), num(o.ring, 1));
    },
  },

  /** dragon:returned — a returned bullet bursts on the wyrm's head: a fiery crack and a low hit. opts.kind = the bullet's kind (embers today; kind 1, the gone wisp, played heavier). */
  returnHit: {
    prio: 5, rev: 0.3, gap: 0.05,
    play(v, t, o) {
      const k = o.kind === 1 ? 1.3 : 1;
      burst(v, t, 'white', 'bandpass', 1800, 1.1, 0.45 * k, 0.12, 0.0008);
      burst(v, t, 'pink', 'lowpass', 900, 0.8, 0.5 * k, 0.2);
      thump(v, t, 110, 45, 0.12, 0.6 * k, 0.22);
      ping(v, t, 'sine', 1320, 0.05 * k, 0.25, 0.001);
    },
  },

  /** player:block — dull metal thud (muffled steel, no ring). opts.tell 'blue': heavier + scrape. */
  block: {
    prio: 4, rev: 0.12, gap: 0.06,
    play(v, t, o) {
      const big = o.tell === 'blue';
      const k = big ? 1.3 : 1;
      thump(v, t, big ? 120 : 140, 55, 0.1, 0.8 * k, big ? 0.28 : 0.2);
      burst(v, t, 'brown', 'lowpass', 600, 0.8, 0.7 * k, 0.12);
      const lp = v.filter('lowpass', 1300, 0.8);
      lp.connect(v.out);
      for (const [f, a, d] of [[310, 0.16, 0.18], [720, 0.1, 0.14], [1130, 0.06, 0.1]]) {
        const s = v.osc('triangle', f * rnd(0.97, 1.03), t, t + d + 0.03);
        const g = v.gain(0);
        perc(g.gain, t, a * k, 0.001, d);
        s.connect(g).connect(lp);
      }
      burst(v, t, 'white', 'bandpass', 2000, 1.2, 0.18 * k, 0.03, 0.0008);
      if (big) swish(v, t + 0.03, 'pink', 'lowpass', 900, 0.7, [[0, 0], [0.02, 0.2], [0.3, 0]]);
    },
  },

  /**
   * dragon:guard — a duelist's guard holds the hero's strike: steel on steel, DRY. A hard clack with
   * a short dull ring (no bell, no sparkle: nothing was won), heavier for a heavy strike. It has to
   * tell a blocked blow from one that landed by ear alone.
   */
  guard: {
    prio: 5, rev: 0.14, gap: 0.05,
    play(v, t, o) {
      const k = o.heavy ? 1.3 : 1;
      const f0 = (o.heavy ? 520 : 640) * rnd(0.96, 1.04);
      for (const [r, a, d] of [[1, 0.16, 0.16], [2.41, 0.1, 0.11], [3.9, 0.06, 0.08]]) ping(v, t, 'triangle', f0 * r, a * k, d, 0.001);
      burst(v, t, 'white', 'bandpass', 3200, 1.4, 0.42 * k, 0.03, 0.0005);
      burst(v, t, 'pink', 'lowpass', 1100, 0.8, 0.3 * k, 0.07);
      thump(v, t, 150, 70, 0.06, 0.45 * k, 0.11);
    },
  },

  /**
   * dragon:guard { deflect } — he beats the hero's strike away: a harsh clang that BENDS DOWN (the
   * blade thrown off line), a tearing scrape and a low hit. A warning, not a reward: his counter is
   * on its way.
   */
  deflected: {
    prio: 7, rev: 0.35, gap: 0.1,
    play(v, t) {
      const f0 = 700 * rnd(0.97, 1.03);
      for (const [r, a, d] of [[1, 0.2, 0.5], [1.5, 0.12, 0.4], [2.76, 0.12, 0.3], [4.1, 0.07, 0.2]]) {
        const s = v.osc('sawtooth', f0 * r, t, t + d + 0.05);
        const lp = v.filter('lowpass', 3600, 0.7);
        const g = v.gain(0);
        perc(g.gain, t, a * 0.5, 0.001, d);
        glide(s.frequency, t, f0 * r, f0 * r * 0.72, d);
        s.connect(lp).connect(g).connect(v.out);
      }
      burst(v, t, 'white', 'bandpass', 2600, 1.1, 0.6, 0.06, 0.0005);
      burst(v, t, 'white', 'highpass', 6000, 0.7, 0.25, 0.1, 0.0005);
      const bp = swish(v, t + 0.01, 'white', 'bandpass', 5200, 3, [[0, 0], [0.02, 0.2], [0.28, 0]]);
      glide(bp.frequency, t + 0.01, 5200, 1500, 0.28);
      thump(v, t, 130, 45, 0.12, 0.8, 0.26);
    },
  },

  /**
   * combat:clash — two cuts meet: two struck steels a fourth apart ringing against each other, a hard
   * crack, a deep hit under them. Louder and longer than a parry: nobody won, both blades sing.
   */
  trade: {
    prio: 7, rev: 0.45, gap: 0.1,
    play(v, t, o) {
      const k = o.heavy ? 1.25 : 1;
      for (const f0 of [660 * rnd(0.98, 1.02), 880 * rnd(0.98, 1.02)]) {
        for (const [r, a, d] of [[1, 0.17, 0.9], [1.007, 0.09, 1.0], [2.32, 0.12, 0.6], [3.7, 0.08, 0.42], [5.1, 0.05, 0.3]]) ping(v, t, 'sine', f0 * r, a * k, d, 0.001);
      }
      burst(v, t, 'white', 'bandpass', 3800, 1.4, 0.6 * k, 0.05, 0.0005);
      burst(v, t, 'white', 'highpass', 7500, 0.7, 0.25 * k, 0.09, 0.0005);
      burst(v, t, 'pink', 'lowpass', 1200, 0.8, 0.45 * k, 0.14);
      thump(v, t, 115, 40, 0.14, 0.9 * k, 0.34);
    },
  },

  /** player:guardBreak — crunch: saturated fracture + crackle, a bent falling clank, heavy thump. */
  guardBreak: {
    prio: 6, rev: 0.3, gap: 0.3,
    play(v, t) {
      const n = v.noise('white', t, t + 0.4);
      const bp = v.filter('bandpass', 2200, 0.8);
      env(bp.frequency, t, [[0, 2200], [0.3, 600]]);
      const sh = v.shaper(45);
      const g = v.gain(0);
      perc(g.gain, t, 0.55, 0.001, 0.25);
      n.connect(bp).connect(sh).connect(g).connect(v.out);
      const c = v.noise('white', t, t + 0.36);
      const hp = v.filter('highpass', 1800, 0.7);
      const cg = v.gain(0);
      spikes(cg.gain, t, 0.3, 12, 0.7, 0.002, 0.008, 0.7);
      c.connect(hp).connect(cg).connect(v.out);
      const s = v.osc('triangle', 520, t, t + 0.46);
      glide(s.frequency, t, 520, 180, 0.4);
      const lp = v.filter('lowpass', 1600, 0.8);
      const sg = v.gain(0);
      perc(sg.gain, t, 0.22, 0.002, 0.4);
      s.connect(lp).connect(sg).connect(v.out);
      thump(v, t, 110, 34, 0.22, 1.0, 0.4);
      burst(v, t, 'brown', 'lowpass', 380, 0.8, 0.7, 0.22);
    },
  },

  /**
   * Ghostep (perfect dodge): time-slow whoosh. A blink thump and an air rush that falls in pitch,
   * a sagging tape-stop tone, then a reverse-cymbal swell that cuts off as time snaps back.
   * opts.slow: slow-mo length in real seconds.
   */
  ghostep: {
    prio: 6, rev: 0.45, gap: 0.4, bus: 'cue',
    play(v, t, o) {
      const S = clamp(num(o.slow, 0.6), 0.25, 2);
      const bp = swish(v, t, 'pink', 'bandpass', 3600, 1.1, [[0, 0], [0.03, 0.45], [0.35, 0.12], [0.6, 0]]);
      glide(bp.frequency, t, 3600, 380, 0.5);
      thump(v, t, 95, 30, 0.3, 0.9, 0.45);
      const s = v.osc('sine', 330, t, t + S + 0.12);
      glide(s.frequency, t, 330, 70, S);
      const sg = v.gain(0);
      env(sg.gain, t, [[0, 0], [0.03, 0.16], [S, 0.08], [S + 0.08, 0]]);
      s.connect(sg).connect(v.out);
      // reverse cymbal: exponential rise of bright noise + metal partials, cut at the snap-back
      const rs = t + 0.05;
      const R = Math.max(0.2, S - 0.05);
      const n = v.noise('white', rs, rs + R + 0.03);
      const hp = v.filter('highpass', 2500, 0.7);
      glide(hp.frequency, rs, 2500, 6500, R);
      const ng = v.gain(0);
      ng.gain.setValueAtTime(0.0001, rs);
      ng.gain.exponentialRampToValueAtTime(0.28, rs + R);
      ng.gain.linearRampToValueAtTime(0, rs + R + 0.015);
      n.connect(hp).connect(ng).connect(v.out);
      for (const f of [3520, 4980, 6230]) {
        const m = v.osc('sine', f, rs, rs + R + 0.03);
        const mg = v.gain(0);
        mg.gain.setValueAtTime(0.0001, rs);
        mg.gain.exponentialRampToValueAtTime(0.03, rs + R);
        mg.gain.linearRampToValueAtTime(0, rs + R + 0.015);
        m.connect(mg).connect(v.out);
      }
      thump(v, rs + R, 70, 40, 0.1, 0.4, 0.2);
    },
  },

  /**
   * player:flurryHit — a flash cut of the flurry: the blade through the air, a bite, and a ring that
   * climbs a whole tone with every cut (opts.n, 1-based). On the cue bus: it stays crisp while the
   * world is held and muffled round it.
   */
  flurryCut: {
    prio: 6, rev: 0.3, gap: 0.03, bus: 'cue',
    play(v, t, o) {
      const n = clamp(num(o.n, 1), 1, 8), k = (n - 1) / 7;
      // the streak's sound on (streakSound.js): opts.f = the ring on the scale; opts.fast = a cut of the
      // storm's merged run (the sweep voice carries the ring: here only a lighter swish and bite, no thump)
      const up = o.f > 0 ? o.f / 1568 : Math.pow(2, (2 * (n - 1)) / 12);
      const fast = !!o.fast, sk = fast ? 0.55 : 1, ring = fast ? 0.2 : 1;
      const bp = swish(v, t, 'white', 'bandpass', 2600, 1.4, [[0, 0], [0.012, 0.5 * sk], [0.07, 0.16 * sk], [fast ? 0.08 : 0.11, 0]]);
      glide(bp.frequency, t, 2600, 7200, 0.07);
      burst(v, t + 0.012, 'white', 'highpass', 5200, 0.7, 0.28 * sk, fast ? 0.035 : 0.05, 0.001);
      if (!fast) thump(v, t + 0.012, 170, 60, 0.07, 0.45, 0.1);
      for (const [f, a, d] of [[1568, 0.15, 0.3], [2349, 0.09, 0.22], [3951, 0.05, 0.16]]) {
        ping(v, t + 0.012, 'sine', f * up * rnd(0.995, 1.005), a * (0.8 + 0.4 * k) * ring, fast ? d * 0.5 : d);
      }
    },
  },

  /** player:flurryArt — the last blow's coil: a tone and a shimmer rising for opts.dur s, cut off
   *  as he strikes. */
  flurryCoil: {
    prio: 6, rev: 0.4, gap: 0.2, bus: 'cue',
    play(v, t, o) {
      const D = clamp(num(o.dur, 0.2), 0.1, 0.6);
      const s = v.osc('sine', 440, t, t + D + 0.05);
      glide(s.frequency, t, 440, 1760, D);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [D * 0.6, 0.06], [D, 0.13], [D + 0.02, 0]]);
      s.connect(g).connect(v.out);
      const n = v.noise('white', t, t + D + 0.03);
      const hp = v.filter('highpass', 3000, 0.7);
      glide(hp.frequency, t, 3000, 8000, D);
      const ng = v.gain(0);
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.2, t + D);
      ng.gain.linearRampToValueAtTime(0, t + D + 0.015);
      n.connect(hp).connect(ng).connect(v.out);
    },
  },

  /** player:flurryEnd — the hanging cuts open: one bright crack over a low thump, then a run of
   *  glassy rings, one for each cut that hung (opts.n). */
  flurryBurst: {
    prio: 6, rev: 0.6, gap: 0.2, bus: 'cue',
    play(v, t, o) {
      const n = clamp(Math.round(num(o.n, 1)), 1, 7);
      burst(v, t, 'white', 'highpass', 3800, 0.7, 0.45, 0.16, 0.001);
      thump(v, t, 140, 38, 0.2, 0.85, 0.4);
      const steps = [0, 3, 7, 10, 12, 15, 19];
      // the streak's sound on (streakSound.js): opts.f = the run's root in the track's key; opts.tier
      // grows the chord: a longer ring from tier 3, a low root under it, the fifth below, the top octave
      const R = o.f > 0 ? o.f : 880, tier = clamp(Math.round(num(o.tier, 0)), 0, 5), dk = 1 + 0.18 * Math.max(0, tier - 2);
      for (let i = 0; i < n; i++) {
        const f = R * Math.pow(2, steps[i] / 12) * rnd(0.995, 1.005), at = t + 0.012 + i * 0.03;
        ping(v, at, 'sine', f, 0.1, 0.55 * dk);
        ping(v, at, 'sine', f * 2.01, 0.035, 0.3 * dk);
      }
      if (o.f > 0 && tier >= 3) {
        const at = t + 0.012 + n * 0.03, kk = clamp(num(o.k, 1), 0, 2);
        ping(v, t + 0.012, 'sine', R / 2, 0.09 * kk, 0.9 * dk);
        ping(v, t + 0.012, 'triangle', R / 2, 0.025 * kk, 0.5 * dk);
        if (tier >= 4) ping(v, at, 'sine', R * 0.75, 0.06 * kk, 0.8 * dk);
        if (tier >= 5) {
          ping(v, at + 0.03, 'sine', R * 4, 0.04 * kk, 0.9 * dk);
          ping(v, at + 0.03, 'sine', R * 3, 0.045 * kk, 1.0 * dk);
        }
      }
    },
  },

  /** player:plunge — the dive off the apex: a cold air rush rising into a steel whistle. */
  plungeDive: {
    prio: 6, rev: 0.35, gap: 0.3,
    play(v, t, o) {
      const k = o.exec ? 1.15 : 1;
      const bp = swish(v, t, 'pink', 'bandpass', 900, 1.2, [[0, 0], [0.05, 0.42 * k], [0.14, 0.6 * k], [0.2, 0]]);
      glide(bp.frequency, t, 900, 5200, 0.18);
      const s = v.osc('sine', 1300, t, t + 0.22);
      glide(s.frequency, t, 1300, 3600, 0.18);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.1, 0.05], [0.18, 0.09], [0.21, 0]]);
      s.connect(g).connect(v.out);
    },
  },

  /**
   * player:plungeHit — the blade driven into the skull: a deep body thump, a crunch of scale and
   * bone, a ringing steel bite, a low rumble and a molten hiss. opts.exec: the execution (heavier,
   * longer ring).
   */
  plungeHit: {
    prio: 6, rev: 0.55, gap: 0.3,
    play(v, t, o) {
      const k = o.exec ? 1.3 : 1;
      thump(v, t, 120, 30, 0.3, 1.1 * k, 0.6);
      thump(v, t + 0.012, 68, 26, 0.25, 0.75 * k, 0.85);
      const n = v.noise('white', t, t + 0.36);
      const bp = v.filter('bandpass', 2600, 0.9);
      env(bp.frequency, t, [[0, 2600], [0.26, 480]]);
      const sh = v.shaper(40);
      const g = v.gain(0);
      perc(g.gain, t, 0.5 * k, 0.001, 0.24);
      n.connect(bp).connect(sh).connect(g).connect(v.out);
      const f0 = 520 * rnd(0.97, 1.03);
      for (const [r, a, d] of [[1, 0.14, 0.9], [2.41, 0.1, 0.6], [3.93, 0.07, 0.4], [5.6, 0.04, 0.25]]) {
        ping(v, t, 'sine', f0 * r, a * k, d * (o.exec ? 1.4 : 1), 0.001);
      }
      burst(v, t, 'brown', 'lowpass', 300, 0.8, 0.9 * k, 0.45);
      swish(v, t + 0.05, 'white', 'highpass', 4200, 0.7, [[0, 0], [0.05, 0.12], [0.6, 0]]);
    },
  },

  // ===== dragon: combat reactions =====
  /** dragon:parried — pained recoil: a yelp that drops into a growl + a jaw/scale rattle. */
  dragonRecoil: {
    prio: 5, rev: 0.35, gap: 0.4, falloff: 0.6,
    play(v, t, o) {
      const big = o.tell === 'blue';
      const D = big ? 0.85 : 0.6;
      vocal(v, t + 0.02, {
        D, peak: big ? 0.75 : 0.6,
        ampPts: [[0, 0], [0.03, 0.9], [0.12, 1], [D * 0.6, 0.6], [D, 0]],
        pitch: [[0, 130], [0.08, 165], [D, 70]],
        f1: [[0, 820], [D, 520]], f2: [[0, 1350], [D, 900]], f3: [[0, 2800], [D, 2100]],
        rough: 0.55, roughHz: 36, breath: 0.5, sub: 0.25, body: 0.25,
      });
      const c = v.noise('white', t, t + 0.22);
      const bp = v.filter('bandpass', 1800, 1);
      const cg = v.gain(0);
      spikes(cg.gain, t, 0.2, 7, 0.4, 0.002, 0.007, 0.5);
      c.connect(bp).connect(cg).connect(v.out);
    },
  },

  /** dragon:postureBreak — heavy impact (boom, crunch, cracked-gong ring) then a strained roar. */
  postureBreak: {
    prio: 6, rev: 0.5, gap: 1, falloff: 0.4,
    play(v, t, o, E) {
      thump(v, t, 64, 20, 0.6, 1.2, 0.9);
      const n = v.noise('brown', t, t + 0.95);
      const lp = v.filter('lowpass', 900, 0.8);
      env(lp.frequency, t, [[0, 900], [0.7, 150]]);
      const sh = v.shaper(10);
      const ng = v.gain(0);
      perc(ng.gain, t, 0.85, 0.002, 0.7);
      n.connect(lp).connect(sh).connect(ng).connect(v.out);
      const c = v.noise('white', t, t + 0.3);
      const cb = v.filter('bandpass', 1300, 0.9);
      const cs = v.shaper(30);
      const cg = v.gain(0);
      perc(cg.gain, t, 0.4, 0.001, 0.2);
      c.connect(cb).connect(cs).connect(cg).connect(v.out);
      for (const [f, a, d] of [[311, 0.12, 1.4], [466, 0.08, 1.1], [740, 0.06, 0.8], [1180, 0.04, 0.6]]) {
        ping(v, t, 'sine', f, a, d, 0.002);
      }
      if (o.roar !== false) SFX.roar.play(v, t + 0.25, { strength: 1.0, pitch: 1.2 }, E);
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

  /**
   * A duelist's blow through the air when its recorded clip is not there (dragon:attack; audio.js):
   * quieter than the hero's swing and lower. opts.weapon 'sword' | 'fist', weight 'light' | 'heavy',
   * shape 'cut' | 'thrust' | 'kick' | 'draw'. A sword: the swing's band sweep (a draw: short and high,
   * a thrust: a long rising hiss); a fist / kick: a dull low rush of air.
   */
  bladeWhoosh: {
    prio: 3, rev: 0.1, falloff: 0.8, gain: 0.55,
    play(v, t, o) {
      const heavy = o.weight === 'heavy';
      const D = bladeDur(o);
      const pk = D * BLADE_PEAK;
      if (o.weapon === 'fist') {
        const lo = heavy || o.shape === 'kick' ? 160 : 240;
        const hi = (heavy || o.shape === 'kick' ? 900 : 1400) * (0.94 + 0.12 * wrnd());
        const lp = wswish(v, t, 'pink', 'lowpass', lo, 1.2, [[0, 0], [pk, heavy ? 0.7 : 0.55], [D, 0]]);
        env(lp.frequency, t, [[0, lo], [pk, hi], [D, lo]]);
        return;
      }
      const draw = o.shape === 'draw', thrust = o.shape === 'thrust';
      const lo = draw ? 1400 : heavy ? 260 : 480;
      const hi = (draw ? 6200 : thrust ? 2600 : heavy ? 1250 : 2300) * (0.94 + 0.12 * wrnd());
      const bp = wswish(v, t, 'white', 'bandpass', lo, heavy ? 1.1 : 1.5, [[0, 0], [pk, heavy ? 0.7 : 0.55], [D, 0]]);
      env(bp.frequency, t, [[0, lo], [pk, hi], [D, thrust ? hi * 0.8 : lo * 1.3]]);
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

  /** world:impact 'chip' { mat, power }: a blow meets wood, stone, metal or bone (ADR-107). */
  chip: {
    prio: 3, rev: 0.1, gap: 0.05, falloff: 0.8,
    play(v, t, o) {
      const k = 0.6 + 0.5 * clamp(num(o.power, 0.3), 0, 1.2);
      if (o.mat === 'metal') {
        // bronze rings
        for (const [r, a, d] of [[1, 0.2, 0.5], [2.76, 0.12, 0.35], [5.4, 0.06, 0.2]]) ping(v, t, 'sine', 420 * r * rnd(0.98, 1.02), a * k, d, 0.001);
        burst(v, t, 'white', 'bandpass', 3600, 1.6, 0.3 * k, 0.03, 0.0005);
      } else if (o.mat === 'wood' || o.mat === 'bone') {
        // a dry knock
        thump(v, t, 210, 120, 0.05, 0.6 * k, 0.09);
        burst(v, t, 'pink', 'bandpass', o.mat === 'bone' ? 1700 : 900, 1.2, 0.5 * k, 0.05, 0.001);
      } else {
        // stone: a crack and grit
        thump(v, t, 130, 60, 0.07, 0.6 * k, 0.12);
        burst(v, t, 'white', 'bandpass', 2400, 1.1, 0.45 * k, 0.04, 0.0005);
        burst(v, t, 'brown', 'lowpass', 500, 0.8, 0.4 * k, 0.1);
      }
    },
  },

  /**
   * world:impact 'wear' { mat, power: the stage 1 - 3 }: a tree loses a stage (leaves torn off, boughs
   * snapped, it leans). Quiet on purpose (the owner finds loud SFX "too noisy"): a rustle of leaves and a
   * dry crack, a low creak for the lean. A roar's front sets off hundreds: `gap` keeps it to a few.
   */
  /**
   * dragon:clone (the Thousand-Body Fox's paper selves, ADR-147): a short, dry, quiet paper tear. A rip
   * is a quick run of tiny grains through a band that climbs, over a soft breath of the sheet. `soft`
   * (a self tearing free, one burning into him): shorter, higher, half as loud. Quiet on purpose (the
   * owner finds loud SFX "too noisy"); `gap` keeps a burst of five pops to one or two tears. Its jitter
   * comes from the cut layer's stream (crnd), never Math.random: the seeded sims replay the AI from it.
   */
  paperTear: {
    prio: 2, rev: 0.03, gap: 0.06, falloff: 0.8, gain: 0.32,
    play(v, t, o) {
      const soft = !!o.soft, D = soft ? 0.09 : 0.15, a = soft ? 0.5 : 1;
      // the rip: grains through a band that climbs
      const n = v.noise('white', t, t + D + 0.05, 1, crnd());
      const bp = v.filter('bandpass', soft ? 3000 : 2200, 1.3);
      env(bp.frequency, t, [[0, soft ? 3000 : 2200], [D, soft ? 5600 : 4600]]);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      const grains = soft ? 8 : 15;
      for (let i = 0; i < grains; i++) {
        const tt = t + (D * (i + 0.6 * crnd())) / grains, u = i / grains;
        g.gain.setValueAtTime(a * (0.35 + 0.65 * crnd()) * (u < 0.2 ? 0.5 + 2.5 * u : 1 - 0.5 * u), tt);
        g.gain.setTargetAtTime(0, tt + 0.0006, 0.003 + 0.004 * crnd());
      }
      n.connect(bp).connect(g).connect(v.out);
      // the sheet's breath under it
      const b = v.noise('pink', t, t + D + 0.08, 1, crnd());
      const lp = v.filter('lowpass', 1100, 0.7);
      const bg = v.gain(0);
      perc(bg.gain, t, 0.12 * a, 0.004, D * 0.8);
      b.connect(lp).connect(bg).connect(v.out);
    },
  },

  // ===== Xin Yi, the One Who Woke (ADR-156): quiet synth, dry; noise offsets from the cut's own
  // stream (crnd), never Math.random (the seeded sims must not feel them) =====
  /** A gun shot: a dry tick over a low thump (`heavy`: deeper and a little louder). */
  ironShot: {
    prio: 3, rev: 0.06, gap: 0.05, falloff: 0.8, gain: 0.42,
    play(v, t, o) {
      const heavy = !!o.heavy;
      const n = v.noise('white', t, t + 0.04, 1, crnd());
      const hp = v.filter('bandpass', heavy ? 3400 : 4600, 2.5);
      const g = v.gain(0);
      perc(g.gain, t, heavy ? 0.55 : 0.45, 0.001, heavy ? 0.02 : 0.012);
      n.connect(hp).connect(g).connect(v.out);
      thump(v, t + 0.002, heavy ? 100 : 130, heavy ? 36 : 52, heavy ? 0.09 : 0.06, heavy ? 0.6 : 0.42, heavy ? 0.2 : 0.11);
    },
  },
  /** A flurry burst's blow (the rework, ADR-168): a soft dry tick over a small thud, a little higher on
   *  every other blow (the hands alternate). */
  burstPatter: {
    prio: 2, rev: 0.04, gap: 0.04, falloff: 0.8, gain: 0.3,
    play(v, t, o) {
      const hi = (o.i | 0) % 2 === 1;
      const n = v.noise('white', t, t + 0.03, 1, crnd());
      const bp = v.filter('bandpass', hi ? 2600 : 2000, 2.2);
      const g = v.gain(0);
      perc(g.gain, t, 0.32, 0.001, 0.018);
      n.connect(bp).connect(g).connect(v.out);
      thump(v, t + 0.001, hi ? 150 : 120, 60, 0.04, 0.3, 0.06);
    },
  },
  /** THE BEND: a falling whoosh, the air going slow round him. */
  bendWhoosh: {
    prio: 4, rev: 0.32, gap: 0.3, gain: 0.5,
    play(v, t) {
      const D = 0.75;
      const n = v.noise('pink', t, t + D + 0.05, 1, crnd());
      const bp = v.filter('bandpass', 2400, 1.6);
      env(bp.frequency, t, [[0, 2600], [D * 0.4, 900], [D, 260]]);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.08, 0.5], [D * 0.5, 0.3], [D, 0]]);
      n.connect(bp).connect(g).connect(v.out);
      const s = v.osc('sine', 180, t, t + D + 0.05);
      glide(s.frequency, t, 180, 55, D);
      const sg = v.gain(0);
      env(sg.gain, t, [[0, 0], [0.1, 0.14], [D, 0]]);
      s.connect(sg).connect(v.out);
    },
  },
  /** THE STOP: a hum rising under a held bolt, cut to silence the moment it stops. */
  stopHum: {
    prio: 4, rev: 0, gap: 0.1, falloff: 0.8, gain: 0.45,
    play(v, t) {
      const D = 0.34;
      const s = v.osc('sine', 140, t, t + D + 0.01);
      glide(s.frequency, t, 140, 430, D);
      const q = v.osc('triangle', 280, t, t + D + 0.01);
      glide(q.frequency, t, 280, 860, D);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [D * 0.9, 0.3], [D, 0.32]]);
      g.gain.setValueAtTime(0, t + D); // (cut: no tail)
      const qg = v.gain(0.25);
      s.connect(g);
      q.connect(qg).connect(g);
      g.connect(v.out);
    },
  },
  /** The Still Hand held after the rising: a low tone that holds, then lets go. */
  stillHum: {
    prio: 3, rev: 0.2, gap: 0.5, gain: 0.35,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.5), 0.4, 3);
      for (const [f, a] of [[110, 0.2], [220, 0.08], [331, 0.04]]) {
        const s = v.osc('sine', f, t, t + D + 0.3);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [0.15, a], [D, a * 0.8], [D + 0.3, 0]]);
        s.connect(g).connect(v.out);
      }
    },
  },
  /** DEJA VU: the hall stutters: a two-note blip, the same note twice, the second a hair late. */
  dejaBlip: {
    prio: 4, rev: 0.1, gap: 0.3, gain: 0.5,
    play(v, t) {
      for (const dt of [0, 0.075]) {
        const s = v.osc('square', 988, t + dt, t + dt + 0.06);
        const lp = v.filter('lowpass', 2400, 0.8);
        const g = v.gain(0);
        perc(g.gain, t + dt, 0.12, 0.002, 0.045);
        s.connect(lp).connect(g).connect(v.out);
      }
    },
  },
  /** The hall rewrites itself (a scene's morph): a falling run of dry ticks, slowing. */
  morphTicks: {
    prio: 2, rev: 0.25, gap: 0.6, falloff: 0.5, gain: 0.32,
    play(v, t, o) {
      const N = o.short ? 6 : 16, D = o.short ? 0.35 : 1.1;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1), tt = t + D * Math.pow(u, 1.4);
        const n = v.noise('white', tt, tt + 0.03, 1, crnd());
        const bp = v.filter('bandpass', 5200 - 4200 * u, 5);
        const g = v.gain(0);
        perc(g.gain, tt, 0.5 * (1 - 0.5 * u) * (0.7 + 0.3 * crnd()), 0.001, 0.014);
        n.connect(bp).connect(g).connect(v.out);
      }
    },
  },
  /** Return to Sender met / bolts burst: a crackle of ticks over a soft thump. */
  codeBurst: {
    prio: 3, rev: 0.15, gap: 0.15, falloff: 0.8, gain: 0.4,
    play(v, t) {
      const n = v.noise('white', t, t + 0.16, 1, crnd());
      const bp = v.filter('bandpass', 3800, 1.4);
      const g = v.gain(0);
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 9; i++) {
        const tt = t + 0.014 * i + 0.006 * crnd();
        g.gain.setValueAtTime(0.4 * (1 - i / 10), tt);
        g.gain.setTargetAtTime(0, tt + 0.001, 0.004);
      }
      n.connect(bp).connect(g).connect(v.out);
      thump(v, t, 110, 45, 0.1, 0.4, 0.18);
    },
  },
  /** The reload: both guns thrown down, a few hard ticks of metal on the floor. */
  gunClatter: {
    prio: 2, rev: 0.12, gap: 0.3, falloff: 0.8, gain: 0.36,
    play(v, t) {
      for (const [dt, f, a] of [[0.18, 2900, 0.5], [0.24, 2300, 0.35], [0.31, 3400, 0.4], [0.4, 2600, 0.22], [0.47, 3100, 0.15]]) {
        const n = v.noise('white', t + dt, t + dt + 0.05, 1, crnd());
        const bp = v.filter('bandpass', f, 7);
        const g = v.gain(0);
        perc(g.gain, t + dt, a, 0.001, 0.035);
        n.connect(bp).connect(g).connect(v.out);
        ping(v, t + dt, 'triangle', f * 0.5, a * 0.12, 0.06);
      }
    },
  },
  /**
   * The fox's Pearl (ADR-154): a quiet whirr that rises as he shapes it in his palm (~1.9 s: the
   * backstep and the charge). Two detuned triangles climbing from a low hum to a high spin, their level
   * fluttered faster and faster (the spin), through a lowpass that opens; it cuts off at the drive.
   * Quiet on purpose (the owner finds loud SFX "too noisy"); no noise, no random: nothing the seeded
   * sims could feel.
   */
  pearlWhirr: {
    prio: 3, rev: 0.12, gap: 0.5, falloff: 0.6, gain: 0.22,
    play(v, t) {
      const D = 1.9;
      const lp = v.filter('lowpass', 500, 0.9);
      env(lp.frequency, t, [[0, 500], [D, 3800]]);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.25, 0.25], [D - 0.15, 0.5], [D, 0]]);
      // the flutter: a fast tremolo whose rate climbs (the orb spinning up)
      const trem = v.gain(0.6);
      const lfo = v.osc('sine', 9, t, t + D + 0.05);
      env(lfo.frequency, t, [[0, 9], [D, 38]]);
      const depth = v.gain(0.4);
      lfo.connect(depth).connect(trem.gain);
      for (const det of [-9, 9]) {
        const o = v.osc('triangle', 150, t, t + D + 0.05, det);
        env(o.frequency, t, [[0, 150], [D * 0.7, 420], [D, 760]]);
        o.connect(trem);
      }
      trem.connect(lp).connect(g).connect(v.out);
    },
  },

  wear: {
    prio: 2, rev: 0.16, gap: 0.14, falloff: 0.7, gain: 0.45,
    play(v, t, o, E) {
      const st = clamp(num(o.power, 1), 1, 3);
      // the leaves (a soft hiss) and the snap of what broke
      swish(v, t, 'pink', 'bandpass', 3200, 0.7, [[0, 0], [0.04, 0.22], [0.35, 0]]);
      if (st >= 2) burst(v, t + 0.02, 'pink', 'bandpass', o.mat === 'bone' ? 1700 : 1100, 1.4, 0.35, 0.05, 0.001);
      // the lean: a slow creak of wood (with the living world's sound on, its own treeCreak plays it:
      // audio/lifeSfx.js, from the tremor's world:impact listener)
      // (both pieces: the creak is the tremor's, piece 'answer', heard through the air's sound)
      const life = E?.game?.world?.life;
      if (st >= 3 && !(life?.on?.('air') && life?.on?.('answer'))) {
        const c = v.osc('sawtooth', 70 * rnd(0.9, 1.1), t, t + 0.6);
        const f = v.filter('bandpass', 420, 6);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [0.08, 0.12], [0.45, 0.06], [0.6, 0]]);
        c.connect(f).connect(g).connect(v.out);
      }
    },
  },

  /** world:impact 'break' | 'topple' | 'crash' | 'throw' { mat, power }: something comes down (ADR-107). */
  crash: {
    prio: 5, rev: 0.28, gap: 0.12, falloff: 0.6,
    play(v, t, o) {
      const k = 0.7 + 0.4 * clamp(num(o.power, 1), 0, 1.5);
      thump(v, t, 70, 24, 0.5, 1.0 * k, 0.8);
      burst(v, t, 'brown', 'lowpass', 320, 0.8, 0.8 * k, 0.5, 0.004);
      // the rattle of what falls after
      const c = v.noise('pink', t, t + 0.75);
      const bp = v.filter('bandpass', o.mat === 'wood' ? 1100 : 2000, 0.8);
      const cg = v.gain(0);
      spikes(cg.gain, t + 0.04, 0.6, 12, 0.3 * k, 0.002, 0.02, 0.7);
      c.connect(bp).connect(cg).connect(v.out);
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
        ping(v, t + 0.25 + arand() * 1.6, 'sine', rnd(3000, 6500), rnd(0.025, 0.06), 0.14);
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
  // Bai Wuji (the Veiled Crossing; the fx agent's recipes go here)
  // His sounds: low and dry, serious (the owner's taste); every jitter from the audio stream (dsp.js rnd /
  // spikes), never Math.random. The barrier's and the domain's play from their events (audio.js); the
  // others from `dragon:spell { name: 'wj...', x, z, dur }` the effects emit (untouched/fx.js _say).
  // `o.dur`: a held sound's length (s), or a burst's power / a slide's metres.
  /** The blade stopped on the shell: a dull, muffled knock with a short glassy edge. */
  wjStop: {
    prio: 5, rev: 0.22, gap: 0.06, falloff: 0.7,
    play(v, t, o) {
      const k = o.heavy ? 1.3 : 1;
      thump(v, t, 150, 62, 0.1, 0.5 * k, 0.16);
      burst(v, t, 'brown', 'lowpass', 520, 0.9, 0.45 * k, 0.12, 0.002);
      const f = burst(v, t + 0.004, 'white', 'bandpass', 2300, 3, 0.07 * k, 0.05, 0.001);
      glide(f.frequency, t, 2600, 1500, 0.05);
      ping(v, t + 0.003, 'sine', rnd(1180, 1260), 0.025 * k, 0.09);
    },
  },
  /** A crack in the shell (o.n of 3): a dry crack, a little higher and louder each time. */
  wjCrack: {
    prio: 5, rev: 0.25, gap: 0.1, falloff: 0.7,
    play(v, t, o) {
      const n = clamp(num(o.n, 1), 1, 4), up = 1 + 0.12 * (n - 1);
      burst(v, t, 'white', 'highpass', 2400 * up, 0.8, 0.28, 0.035, 0.0005);
      const c = v.noise('pink', t, t + 0.3);
      const bp = v.filter('bandpass', 900 * up, 1.4);
      const g = v.gain(0);
      spikes(g.gain, t, 0.22, 6, 0.34, 0.002, 0.01, 0.6);
      c.connect(bp).connect(g).connect(v.out);
      ping(v, t + 0.01, 'triangle', 420 * up, 0.05, 0.2);
      thump(v, t, 110, 55, 0.12, 0.3, 0.18);
    },
  },
  /** The shell breaks open: a low glassy shatter, falling. */
  wjOpen: {
    prio: 6, rev: 0.4, gap: 0.3, falloff: 0.6,
    play(v, t) {
      thump(v, t, 95, 34, 0.35, 0.7, 0.5);
      burst(v, t, 'white', 'bandpass', 2800, 1.1, 0.3, 0.32, 0.001);
      const c = v.noise('white', t, t + 0.75);
      const bp = v.filter('bandpass', 3600, 2.2);
      const g = v.gain(0);
      spikes(g.gain, t + 0.02, 0.65, 18, 0.22, 0.002, 0.014, 0.8);
      c.connect(bp).connect(g).connect(v.out);
      const s = v.osc('sine', 900, t, t + 0.5);
      glide(s.frequency, t, 900, 180, 0.45);
      const sg = v.gain(0);
      env(sg.gain, t, [[0, 0], [0.02, 0.05], [0.45, 0]]);
      s.connect(sg).connect(v.out);
    },
  },
  /** It knits back: a short rising draw of air that closes on a soft knock. */
  wjClose: {
    prio: 4, rev: 0.3, gap: 0.3, falloff: 0.7,
    play(v, t) {
      const f = swish(v, t, 'pink', 'bandpass', 500, 1.6, [[0, 0], [0.36, 0.16], [0.42, 0]]);
      glide(f.frequency, t, 500, 2000, 0.4);
      thump(v, t + 0.4, 120, 70, 0.08, 0.32, 0.14);
      ping(v, t + 0.4, 'sine', 760, 0.03, 0.12);
    },
  },
  /** The blink: the air displaced at once, quiet and dry. */
  wjBlink: {
    prio: 4, rev: 0.12, gap: 0.08, falloff: 0.8,
    play(v, t) {
      const f = swish(v, t, 'white', 'bandpass', 2400, 2.2, [[0, 0], [0.025, 0.14], [0.13, 0]]);
      glide(f.frequency, t, 3000, 1300, 0.12);
      thump(v, t, 70, 45, 0.06, 0.18, 0.1);
    },
  },
  /** Azure Draw held (o.dur s): a low hum and the air drawn inward, rising as it lives. */
  wjDraw: {
    prio: 4, rev: 0.3, gap: 0.2, falloff: 0.6,
    play(v, t, o) {
      const D = clamp(num(o.dur, 2), 0.3, 4);
      const lp = v.filter('lowpass', 220, 0.9);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.3, 0.16], [Math.max(0.35, D - 0.1), 0.2], [D + 0.1, 0]]);
      lp.connect(g).connect(v.out);
      for (const [f, det] of [[55, -7], [58, 7]]) v.osc('sawtooth', f, t, t + D + 0.15, det).connect(lp);
      glide(lp.frequency, t, 220, 520, D);
      const n = swish(v, t, 'pink', 'bandpass', 300, 0.9, [[0, 0], [0.25, 0.1], [Math.max(0.3, D - 0.05), 0.14], [D + 0.1, 0]]);
      glide(n.frequency, t, 300, 1100, D);
    },
  },
  /** The knot folds in, then a deep crushing thud. */
  wjCollapse: {
    prio: 6, rev: 0.35, gap: 0.15, falloff: 0.55,
    play(v, t) {
      const f = swish(v, t, 'brown', 'lowpass', 300, 0.8, [[0, 0], [0.11, 0.5], [0.13, 0]]);
      glide(f.frequency, t, 300, 1400, 0.12);
      thump(v, t + 0.12, 110, 28, 0.5, 1.0, 0.7);
      burst(v, t + 0.12, 'brown', 'lowpass', 280, 0.8, 0.8, 0.45, 0.003);
      burst(v, t + 0.12, 'white', 'bandpass', 1400, 0.7, 0.12, 0.12, 0.002);
    },
  },
  /** Crimson Cast's burst (o.dur its power ~1 - 2): a hard dry crack and a low boom. */
  wjCast: {
    prio: 6, rev: 0.35, gap: 0.1, falloff: 0.55,
    play(v, t, o) {
      const k = 0.75 + 0.25 * clamp(num(o.dur, 1), 0, 2);
      burst(v, t, 'white', 'highpass', 1800, 0.7, 0.42 * k, 0.06, 0.0005);
      thump(v, t, 92, 26, 0.45, 1.0 * k, 0.6);
      burst(v, t + 0.01, 'brown', 'lowpass', 260, 0.8, 0.85 * k, 0.5, 0.003);
      const c = v.noise('pink', t + 0.05, t + 0.7);
      const bp = v.filter('bandpass', 1600, 0.8);
      const g = v.gain(0);
      spikes(g.gain, t + 0.06, 0.55, 10, 0.2 * k, 0.002, 0.02, 0.7);
      c.connect(bp).connect(g).connect(v.out);
    },
  },
  /** The Null's charge (o.dur s): a long, loud windup, a dark drone rising through its filter. */
  wjNullCharge: {
    prio: 6, rev: 0.45, gap: 0.5, falloff: 0.4,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.8), 0.6, 3.5);
      const lp = v.filter('lowpass', 180, 1.2);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.4, 0.12], [D, 0.24], [D + 0.12, 0]]);
      lp.connect(g).connect(v.out);
      for (const [f, det] of [[41.2, -9], [43.7, 9], [61.7, 0]]) v.osc('sawtooth', f, t, t + D + 0.2, det).connect(lp);
      glide(lp.frequency, t, 180, 2200, D);
      const n = swish(v, t, 'white', 'bandpass', 600, 1.4, [[0, 0], [D * 0.6, 0.05], [D, 0.16], [D + 0.1, 0]]);
      glide(n.frequency, t, 600, 3400, D);
    },
  },
  /** The blue and the red meet: a short bright snap over a low knock. */
  wjNullMerge: {
    prio: 6, rev: 0.4, gap: 0.3, falloff: 0.5,
    play(v, t) {
      burst(v, t, 'white', 'highpass', 3200, 0.8, 0.3, 0.05, 0.0005);
      ping(v, t, 'sine', 1760, 0.08, 0.35);
      ping(v, t, 'sine', 1176, 0.05, 0.45);
      thump(v, t, 130, 55, 0.2, 0.55, 0.3);
    },
  },
  /** The Violet Null fired (o.dur s): a tearing roar of air, a rumble under it; no fire in it. */
  wjNullBeam: {
    prio: 6, rev: 0.45, gap: 0.4, falloff: 0.35,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.2), 0.4, 3);
      thump(v, t, 70, 24, 0.6, 1.0, 0.9);
      const f = swish(v, t, 'pink', 'bandpass', 900, 0.6, [[0, 0], [0.04, 0.42], [D * 0.7, 0.3], [D + 0.25, 0]]);
      glide(f.frequency, t, 1400, 600, D);
      const lp = v.filter('lowpass', 320, 0.9);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.05, 0.22], [D, 0.16], [D + 0.3, 0]]);
      lp.connect(g).connect(v.out);
      for (const [fr, det] of [[41.2, -6], [41.2, 6]]) v.osc('sawtooth', fr, t, t + D + 0.35, det).connect(lp);
    },
  },
  /** The air closes on the emptied line: a dull whoomp. */
  wjNullEnd: {
    prio: 5, rev: 0.4, gap: 0.3, falloff: 0.5,
    play(v, t) {
      const f = swish(v, t, 'brown', 'lowpass', 220, 0.8, [[0, 0], [0.18, 0.45], [0.4, 0]]);
      glide(f.frequency, t, 220, 700, 0.2);
      thump(v, t + 0.16, 80, 38, 0.25, 0.55, 0.45);
    },
  },
  /** The hand sign: one dark low tone, a held breath under it. */
  wjSign: {
    prio: 5, rev: 0.6, gap: 0.8, falloff: 0.4,
    play(v, t) {
      ping(v, t, 'sine', 98, 0.14, 1.8, 0.01);
      ping(v, t, 'sine', 146.8, 0.06, 1.4, 0.01);
      ping(v, t + 0.002, 'triangle', 392, 0.018, 0.9, 0.004);
      swish(v, t, 'brown', 'lowpass', 160, 0.7, [[0, 0], [0.6, 0.1], [1.4, 0]]);
    },
  },
  /** The realm closing on the arena (o.dur s): a deep swell, the air pressed, a pressure drop at the end. */
  wjDomainClose: {
    prio: 6, rev: 0.55, gap: 1, falloff: 0.3,
    play(v, t, o) {
      const D = clamp(num(o.dur, 2), 0.8, 4);
      for (const [f, a] of [[41.2, 0.12], [61.7, 0.06]]) {
        const s = v.osc('sine', f, t, t + D + 0.3);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [D * 0.8, a], [D + 0.25, 0]]);
        s.connect(g).connect(v.out);
      }
      const n = swish(v, t, 'brown', 'lowpass', 150, 0.8, [[0, 0], [D * 0.85, 0.3], [D + 0.2, 0]]);
      glide(n.frequency, t, 150, 900, D);
      thump(v, t + D, 60, 22, 0.5, 0.9, 0.8);
    },
  },
  /** The scene goes to the void (the close's impact): the pressure falls away. */
  wjVoid: {
    prio: 6, rev: 0.7, gap: 1, falloff: 0.3,
    play(v, t) {
      const s = v.osc('sine', 110, t, t + 1.3);
      glide(s.frequency, t, 110, 30, 1.1);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.02, 0.24], [1.2, 0]]);
      s.connect(g).connect(v.out);
      burst(v, t, 'brown', 'lowpass', 200, 0.7, 0.5, 0.6, 0.004);
    },
  },
  /** The hero caught and held: a crackle of static over a low knock. */
  wjCaught: {
    prio: 6, rev: 0.3, gap: 0.8, falloff: 0.6,
    play(v, t) {
      thump(v, t, 100, 40, 0.2, 0.6, 0.3);
      const c = v.noise('white', t, t + 1.0);
      const bp = v.filter('bandpass', 3000, 0.9);
      const g = v.gain(0);
      spikes(g.gain, t, 0.95, 40, 0.16, 0.001, 0.006, 0.4);
      c.connect(bp).connect(g).connect(v.out);
      swish(v, t, 'white', 'highpass', 5000, 0.7, [[0, 0], [0.05, 0.03], [0.9, 0.02], [1.0, 0]]);
    },
  },
  /** The void breaks (his death): a great glassy shatter falling away, a low thud under it. */
  wjBreak: {
    prio: 6, rev: 0.7, gap: 1, falloff: 0.3,
    play(v, t) {
      thump(v, t, 85, 26, 0.5, 0.9, 0.9);
      burst(v, t, 'white', 'highpass', 3800, 0.8, 0.3, 0.7, 0.001);
      const c = v.noise('white', t, t + 1.4);
      const bp = v.filter('bandpass', 2600, 1.6);
      const g = v.gain(0);
      spikes(g.gain, t + 0.05, 1.3, 42, 0.2, 0.002, 0.016, 0.8);
      c.connect(bp).connect(g).connect(v.out);
      const s = v.osc('sine', 1200, t, t + 1.0);
      glide(s.frequency, t, 1200, 160, 0.9);
      const sg = v.gain(0);
      env(sg.gain, t, [[0, 0], [0.02, 0.04], [0.95, 0]]);
      s.connect(sg).connect(v.out);
    },
  },
  /** (round 2) The band comes off: a glassy rising ring and a breath of cold air, a low knock under it. */
  wjUnveil: {
    prio: 6, rev: 0.45, gap: 0.5, falloff: 0.4,
    play(v, t) {
      ping(v, t, 'sine', 1320, 0.06, 0.9);
      ping(v, t + 0.04, 'sine', 1980, 0.04, 0.7);
      const f = swish(v, t, 'white', 'bandpass', 2600, 1.6, [[0, 0], [0.05, 0.16], [0.6, 0]]);
      glide(f.frequency, t, 1800, 4200, 0.5);
      thump(v, t, 90, 40, 0.3, 0.45, 0.5);
    },
  },
  /** (round 2) Dark Spark held (o.dur s): a dry crackle that thickens, a low hum. */
  wjSparkCharge: {
    prio: 5, rev: 0.25, gap: 0.3, falloff: 0.6,
    play(v, t, o) {
      const D = clamp(num(o.dur, 0.8), 0.2, 2);
      const c = v.noise('white', t, t + D + 0.05);
      const bp = v.filter('bandpass', 2400, 1.2);
      const g = v.gain(0);
      spikes(g.gain, t, D, Math.round(18 * D), 0.16, 0.002, 0.015, 0.6);
      c.connect(bp).connect(g).connect(v.out);
      const lp = v.filter('lowpass', 180, 0.8);
      const h = v.gain(0);
      env(h.gain, t, [[0, 0], [D * 0.8, 0.12], [D + 0.05, 0]]);
      lp.connect(h).connect(v.out);
      v.osc('sawtooth', 48, t, t + D + 0.1, 0).connect(lp);
    },
  },
  /** (round 2) Dark Spark lands (o.dur 1 landed, 0 a miss): a black crack of thunder, a deep blow. */
  wjSpark: {
    prio: 7, rev: 0.4, gap: 0.15, falloff: 0.45,
    play(v, t, o) {
      const k = num(o.dur, 1) > 0.5 ? 1 : 0.75;
      burst(v, t, 'white', 'highpass', 2600, 0.7, 0.55 * k, 0.05, 0.0005);
      thump(v, t, 120, 30, 0.45, 1.1 * k, 0.5);
      burst(v, t + 0.01, 'brown', 'lowpass', 300, 0.8, 0.8 * k, 0.45, 0.003);
      const c = v.noise('pink', t + 0.03, t + 0.5);
      const bp = v.filter('bandpass', 1900, 0.9);
      const g = v.gain(0);
      spikes(g.gain, t + 0.03, 0.4, 9, 0.22 * k, 0.002, 0.02, 0.7);
      c.connect(bp).connect(g).connect(v.out);
    },
  },
  /** The hero slid back by a blow (o.dur m): a heavy knock, his heels scraping over the asphalt. */
  wjShove: {
    prio: 5, rev: 0.18, gap: 0.12, falloff: 0.8,
    play(v, t, o) {
      const D = clamp(num(o.dur, 3.5) / 8, 0.2, 0.9);
      thump(v, t, 85, 40, 0.15, 0.45, 0.22);
      const f = swish(v, t, 'pink', 'bandpass', 1300, 2.5, [[0, 0], [0.02, 0.18], [D * 0.8, 0.1], [D, 0]]);
      glide(f.frequency, t, 1500, 700, D);
      burst(v, t, 'brown', 'bandpass', 380, 0.8, 0.3, D * 0.8, 0.003);
    },
  },
  // The False Saint (the Last Foundry; the fx agent's recipes, ADR-285). A machine, not a sorcerer: jets
  // that light with a hard hiss, servos, metal ringing on metal, the deep roar of the beams, the dry crack
  // of his gun, shells that whistle down. Serious and dry (the owner's taste); every jitter from the audio
  // stream (dsp.js rnd / spikes), never Math.random. All from `dragon:spell { name: 'fs...', x, z, dur }`
  // the effects emit (falseSaint/fx.js _say); `o.dur`: a held sound's length (s), a burst's power, a count.
  /** A booster lights (o.dur its strength 0..1): a hard hiss that catches, a low rumble under it. */
  fsJetLight: {
    prio: 4, rev: 0.12, gap: 0.08, falloff: 0.7,
    play(v, t, o) {
      const k = 0.6 + 0.4 * clamp(num(o.dur, 1), 0, 1);
      const f = swish(v, t, 'white', 'bandpass', 2600, 0.9, [[0, 0], [0.015, 0.22 * k], [0.12, 0.12 * k], [0.32, 0]]);
      glide(f.frequency, t, 3800, 1800, 0.25);
      burst(v, t, 'brown', 'lowpass', 220, 0.8, 0.32 * k, 0.3, 0.004);
      thump(v, t, 90, 50, 0.08, 0.22 * k, 0.12);
    },
  },
  /** A jet launch kicks off the floor (o.dur ~1): a blast of exhaust, a heavy knock. */
  fsJetBurst: {
    prio: 5, rev: 0.2, gap: 0.08, falloff: 0.6,
    play(v, t, o) {
      const k = 0.7 + 0.3 * clamp(num(o.dur, 1), 0, 2);
      burst(v, t, 'white', 'highpass', 1600, 0.7, 0.3 * k, 0.12, 0.001);
      thump(v, t, 110, 38, 0.18, 0.7 * k, 0.3);
      const f = swish(v, t, 'pink', 'bandpass', 900, 0.8, [[0, 0], [0.02, 0.35 * k], [0.4, 0]]);
      glide(f.frequency, t, 1400, 500, 0.35);
    },
  },
  /** The booster dash (o.dur its metres): a tearing jet past, falling in pitch. */
  fsDash: {
    prio: 5, rev: 0.18, gap: 0.1, falloff: 0.6,
    play(v, t, o) {
      const D = clamp(num(o.dur, 6) / 20, 0.18, 0.5);
      const f = swish(v, t, 'white', 'bandpass', 2000, 1.1, [[0, 0], [0.03, 0.3], [D, 0.12], [D + 0.15, 0]]);
      glide(f.frequency, t, 3200, 900, D + 0.1);
      burst(v, t, 'brown', 'lowpass', 260, 0.8, 0.4, D + 0.1, 0.004);
    },
  },
  /** A sensor goes out (o.dur 0..2): a small falling blip, dry. */
  fsSensorOut: {
    prio: 5, rev: 0.5, gap: 0.2, falloff: 0.5,
    play(v, t, o) {
      const f0 = 1320 - 180 * clamp(num(o.dur, 0), 0, 2);
      const s = v.osc('sine', f0, t, t + 0.4);
      glide(s.frequency, t, f0, f0 * 0.35, 0.35);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.005, 0.06], [0.35, 0]]);
      s.connect(g).connect(v.out);
      burst(v, t, 'white', 'highpass', 4200, 0.7, 0.03, 0.03, 0.0005);
    },
  },
  /** A chip of his shell flies (o.dur the share it took): a brittle porcelain tick. */
  fsFlake: {
    prio: 3, rev: 0.15, gap: 0.05, falloff: 0.8,
    play(v, t, o) {
      const k = 0.6 + 2 * clamp(num(o.dur, 0.1), 0, 0.3);
      burst(v, t, 'white', 'bandpass', rnd(3200, 4200), 3, 0.09 * k, 0.03, 0.0005);
      ping(v, t + 0.002, 'triangle', rnd(1900, 2300), 0.025 * k, 0.06);
    },
  },
  /** His shell burns off (o.dur 0..1): a crackle that thickens with it, a soft whoosh of heat. */
  fsStrip: {
    prio: 4, rev: 0.25, gap: 0.2, falloff: 0.7,
    play(v, t, o) {
      const k = clamp(num(o.dur, 0.2), 0.05, 1), D = 0.3 + 0.7 * k;
      const c = v.noise('white', t, t + D + 0.05);
      const bp = v.filter('bandpass', 2600, 1.1);
      const g = v.gain(0);
      spikes(g.gain, t, D, Math.round(10 + 30 * k), 0.12 + 0.12 * k, 0.002, 0.012, 0.6);
      c.connect(bp).connect(g).connect(v.out);
      swish(v, t, 'pink', 'lowpass', 700, 0.7, [[0, 0], [0.1, 0.12 * k], [D, 0]]);
    },
  },
  /** The core's whine (o.dur s): a high thin tone climbing, a hum under it. */
  fsCoreWhine: {
    prio: 5, rev: 0.35, gap: 0.6, falloff: 0.5,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.6), 0.4, 3);
      const s = v.osc('sine', 700, t, t + D + 0.1);
      glide(s.frequency, t, 700, 2600, D);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.2, 0.025], [D, 0.06], [D + 0.08, 0]]);
      s.connect(g).connect(v.out);
      const lp = v.filter('lowpass', 200, 0.8);
      const h = v.gain(0);
      env(h.gain, t, [[0, 0], [0.3, 0.1], [D, 0.14], [D + 0.1, 0]]);
      lp.connect(h).connect(v.out);
      v.osc('sawtooth', 55, t, t + D + 0.15, 0).connect(lp);
    },
  },
  /** Phase 2's change: skin tearing off the forearm, a servo shifting under it. */
  fsSkin: {
    prio: 6, rev: 0.3, gap: 1, falloff: 0.5,
    play(v, t) {
      const c = v.noise('pink', t, t + 1.4);
      const bp = v.filter('bandpass', 1500, 1.2);
      const g = v.gain(0);
      spikes(g.gain, t + 0.1, 1.2, 22, 0.16, 0.003, 0.02, 0.7);
      c.connect(bp).connect(g).connect(v.out);
      const s = v.osc('square', 140, t + 0.8, t + 1.4);
      glide(s.frequency, t + 0.8, 140, 220, 0.4);
      const lp = v.filter('lowpass', 600, 1.4);
      const sg = v.gain(0);
      env(sg.gain, t + 0.8, [[0, 0], [0.05, 0.05], [0.5, 0.04], [0.6, 0]]);
      s.connect(lp).connect(sg).connect(v.out);
    },
  },
  /** Phase 3's change: plates unlocking, the petals opening (a run of mechanical clicks), the jets spooling. */
  fsArm: {
    prio: 6, rev: 0.35, gap: 1, falloff: 0.45,
    play(v, t) {
      for (let i = 0; i < 6; i++) {
        const tt = t + 0.15 + i * 0.09;
        burst(v, tt, 'white', 'bandpass', 2400 - i * 120, 4, 0.12, 0.025, 0.0005);
        thump(v, tt, 180, 120, 0.03, 0.12, 0.05);
      }
      const f = swish(v, t + 0.9, 'white', 'bandpass', 900, 1.2, [[0, 0], [0.8, 0.16], [1.1, 0]]);
      glide(f.frequency, t + 0.9, 900, 3200, 1.0);
    },
  },
  /** Phase 4's change (o.dur s): a long rising whine to the top, the room's air pulled in. */
  fsFrame: {
    prio: 6, rev: 0.45, gap: 1.5, falloff: 0.35,
    play(v, t, o) {
      const D = clamp(num(o.dur, 2), 0.8, 3.5);
      for (const [f0, f1, a] of [[220, 1760, 0.05], [223, 1780, 0.03]]) {
        const s = v.osc('sawtooth', f0, t, t + D + 0.1);
        glide(s.frequency, t, f0, f1, D);
        const lp = v.filter('lowpass', 900, 1);
        glide(lp.frequency, t, 900, 4000, D);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [0.3, a * 0.5], [D, a], [D + 0.06, 0]]);
        s.connect(lp).connect(g).connect(v.out);
      }
      const n = swish(v, t, 'brown', 'lowpass', 160, 0.8, [[0, 0], [D * 0.9, 0.3], [D + 0.1, 0]]);
      glide(n.frequency, t, 160, 700, D);
    },
  },
  /** A change lands (o.dur the phase 2..4): a heavy metal boom; 4: a pressure blast with a ringing tail. */
  fsMoment: {
    prio: 7, rev: 0.5, gap: 0.8, falloff: 0.35,
    play(v, t, o) {
      const n = clamp(num(o.dur, 2), 2, 4), k = 0.7 + 0.15 * (n - 2);
      thump(v, t, 100, 26, 0.5, 1.1 * k, 0.8);
      burst(v, t, 'brown', 'lowpass', 300, 0.8, 0.8 * k, 0.6, 0.003);
      burst(v, t, 'white', 'highpass', 2200, 0.7, 0.3 * k, 0.08, 0.0005);
      if (n >= 4) {
        bell(v, t + 0.01, 196, 0.06, 2.4);
        const f = swish(v, t, 'white', 'bandpass', 1800, 0.7, [[0, 0], [0.03, 0.3], [0.9, 0]]);
        glide(f.frequency, t, 3000, 400, 0.8);
      } else bell(v, t + 0.01, 147, 0.035, 1.6);
    },
  },
  /** The sight line finds its mark: a thin high tone, held a moment. */
  fsSight: {
    prio: 5, rev: 0.25, gap: 0.3, falloff: 0.5,
    play(v, t) {
      const s = v.osc('sine', 2093, t, t + 0.6);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.01, 0.04], [0.45, 0.03], [0.55, 0]]);
      s.connect(g).connect(v.out);
      ping(v, t, 'sine', 4186, 0.012, 0.25);
    },
  },
  /** The cutting laser held (o.dur s, sent again while it holds): a searing hiss over a tight buzz. */
  fsLaser: {
    prio: 5, rev: 0.2, gap: 0.5, falloff: 0.5,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1), 0.3, 2);
      swish(v, t, 'white', 'highpass', 3200, 0.8, [[0, 0], [0.03, 0.16], [D - 0.05, 0.14], [D + 0.05, 0]]);
      const s = v.osc('sawtooth', 165, t, t + D + 0.1);
      const bp = v.filter('bandpass', 1300, 3);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.03, 0.06], [D - 0.05, 0.05], [D + 0.05, 0]]);
      s.connect(bp).connect(g).connect(v.out);
      const c = v.noise('white', t, t + D);
      const cb = v.filter('bandpass', 2400, 1.5);
      const cg = v.gain(0);
      spikes(cg.gain, t, D, Math.round(14 * D), 0.08, 0.002, 0.01, 0.6);
      c.connect(cb).connect(cg).connect(v.out);
    },
  },
  /** A cannon charging (o.dur s): a rising electric whine, the air thickening. */
  fsCharge: {
    prio: 6, rev: 0.35, gap: 0.5, falloff: 0.45,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.2), 0.4, 3);
      const s = v.osc('triangle', 300, t, t + D + 0.1);
      glide(s.frequency, t, 300, 1500, D);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [D * 0.5, 0.04], [D, 0.08], [D + 0.05, 0]]);
      s.connect(g).connect(v.out);
      const lp = v.filter('lowpass', 150, 1);
      glide(lp.frequency, t, 150, 900, D);
      const h = v.gain(0);
      env(h.gain, t, [[0, 0], [D, 0.16], [D + 0.08, 0]]);
      lp.connect(h).connect(v.out);
      for (const [f, det] of [[49, -8], [49, 8]]) v.osc('sawtooth', f, t, t + D + 0.12, det).connect(lp);
    },
  },
  /** The palm cannon fired (o.dur s, sent again while it holds): a roaring incineration, a deep rumble. */
  fsBeam: {
    prio: 6, rev: 0.4, gap: 0.6, falloff: 0.4,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.2), 0.4, 2.5);
      thump(v, t, 80, 30, 0.4, 0.7, 0.5);
      const f = swish(v, t, 'pink', 'bandpass', 1100, 0.6, [[0, 0], [0.04, 0.4], [D, 0.3], [D + 0.2, 0]]);
      glide(f.frequency, t, 1600, 800, D);
      const lp = v.filter('lowpass', 300, 0.9);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.05, 0.2], [D, 0.16], [D + 0.25, 0]]);
      lp.connect(g).connect(v.out);
      for (const [fr, det] of [[46, -6], [46, 6]]) v.osc('sawtooth', fr, t, t + D + 0.3, det).connect(lp);
    },
  },
  /** The core beam (o.dur s): the palm's roar lower and wider, a tearing top. */
  fsCoreBeam: {
    prio: 7, rev: 0.5, gap: 0.6, falloff: 0.3,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.2), 0.4, 2.5);
      thump(v, t, 64, 20, 0.6, 1.0, 0.8);
      const f = swish(v, t, 'pink', 'bandpass', 700, 0.5, [[0, 0], [0.05, 0.55], [D, 0.42], [D + 0.3, 0]]);
      glide(f.frequency, t, 1100, 520, D);
      swish(v, t, 'white', 'highpass', 2800, 0.7, [[0, 0], [0.05, 0.12], [D, 0.1], [D + 0.2, 0]]);
      const lp = v.filter('lowpass', 240, 0.9);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.06, 0.28], [D, 0.22], [D + 0.3, 0]]);
      lp.connect(g).connect(v.out);
      for (const [fr, det] of [[32.7, -8], [32.7, 8], [49, 0]]) v.osc('sawtooth', fr, t, t + D + 0.35, det).connect(lp);
    },
  },
  /** A beam ends: the air slams back, molten steel hisses in the trench. */
  fsBeamEnd: {
    prio: 5, rev: 0.4, gap: 0.3, falloff: 0.5,
    play(v, t) {
      thump(v, t, 75, 36, 0.25, 0.5, 0.4);
      swish(v, t, 'white', 'highpass', 3600, 0.7, [[0, 0], [0.05, 0.12], [1.4, 0]]);
    },
  },
  /** The forearm gun: a hard dry crack, a short metallic tail. */
  fsGun: {
    prio: 6, rev: 0.3, gap: 0.05, falloff: 0.5,
    play(v, t) {
      burst(v, t, 'white', 'highpass', 2200, 0.7, 0.5, 0.05, 0.0005);
      thump(v, t, 160, 55, 0.08, 0.6, 0.18);
      burst(v, t + 0.005, 'pink', 'bandpass', 3400, 4, 0.08, 0.12, 0.001);
      ping(v, t + 0.004, 'triangle', rnd(2600, 2900), 0.02, 0.15);
    },
  },
  /** A bolt bites (o.dur its weight): a sharp electric crack. */
  fsBoltHit: {
    prio: 5, rev: 0.25, gap: 0.05, falloff: 0.6,
    play(v, t, o) {
      const k = 0.7 + 0.3 * clamp(num(o.dur, 1), 0, 2);
      burst(v, t, 'white', 'bandpass', 3000, 1.2, 0.3 * k, 0.06, 0.0005);
      thump(v, t, 120, 50, 0.1, 0.4 * k, 0.16);
    },
  },
  /** The petals open and the missiles leave (o.dur how many): a ripple of hard launches. */
  fsLaunch: {
    prio: 6, rev: 0.3, gap: 0.3, falloff: 0.45,
    play(v, t, o) {
      const n = clamp(Math.round(num(o.dur, 8)), 1, 14);
      for (let i = 0; i < n; i++) {
        const tt = t + i * 0.06 + rnd(0, 0.015);
        const f = swish(v, tt, 'white', 'bandpass', 1800, 1.1, [[0, 0], [0.01, 0.12], [0.35, 0]]);
        glide(f.frequency, tt, 1200, 3400, 0.3);
        thump(v, tt, 140, 70, 0.05, 0.16, 0.08);
      }
    },
  },
  /** A missile or a blast of his (o.dur its power): a hard boom, debris. */
  fsBlast: {
    prio: 6, rev: 0.35, gap: 0.07, falloff: 0.45,
    play(v, t, o) {
      const k = 0.65 + 0.3 * clamp(num(o.dur, 1), 0, 2);
      burst(v, t, 'white', 'highpass', 1500, 0.7, 0.35 * k, 0.06, 0.0005);
      thump(v, t, 90, 28, 0.4, 0.95 * k, 0.55);
      burst(v, t + 0.01, 'brown', 'lowpass', 320, 0.8, 0.7 * k, 0.45, 0.003);
      const c = v.noise('pink', t + 0.05, t + 0.6);
      const bp = v.filter('bandpass', 1800, 0.8);
      const g = v.gain(0);
      spikes(g.gain, t + 0.06, 0.5, 9, 0.16 * k, 0.002, 0.02, 0.7);
      c.connect(bp).connect(g).connect(v.out);
    },
  },
  /** A missile cut out of the air: a sharp pop, a ringing scrape. */
  fsMissileCut: {
    prio: 6, rev: 0.3, gap: 0.08, falloff: 0.5,
    play(v, t) {
      burst(v, t, 'white', 'highpass', 2600, 0.7, 0.35, 0.05, 0.0005);
      thump(v, t, 120, 45, 0.2, 0.5, 0.3);
      ping(v, t, 'triangle', 1750, 0.04, 0.3);
    },
  },
  /** The mortar tubes fire (o.dur how many): deep hollow thumps one after another. */
  fsMortar: {
    prio: 6, rev: 0.4, gap: 0.2, falloff: 0.4,
    play(v, t, o) {
      const n = clamp(Math.round(num(o.dur, 1)), 1, 6);
      for (let i = 0; i < n; i++) {
        const tt = t + i * 0.08;
        thump(v, tt, 70, 40, 0.12, 0.6, 0.35);
        burst(v, tt, 'brown', 'bandpass', 260, 1.2, 0.35, 0.25, 0.002);
        burst(v, tt, 'white', 'highpass', 1900, 0.7, 0.08, 0.04, 0.0005);
      }
    },
  },
  /** A shell coming down (o.dur the s it falls): a whistle falling in pitch. */
  fsWhistle: {
    prio: 4, rev: 0.3, gap: 0.12, falloff: 0.55,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1), 0.2, 1.6);
      const s = v.osc('sine', 2400, t, t + D + 0.05);
      glide(s.frequency, t, 2400, 900, D);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [D * 0.3, 0.03], [D, 0.05], [D + 0.03, 0]]);
      s.connect(g).connect(v.out);
      const f = swish(v, t, 'white', 'bandpass', 2200, 6, [[0, 0], [D, 0.05], [D + 0.03, 0]]);
      glide(f.frequency, t, 2400, 900, D);
    },
  },
  /** A shell bursts (o.dur its power; the great shell 2.5): a deep crump, earth falling after. */
  fsShellBurst: {
    prio: 6, rev: 0.4, gap: 0.08, falloff: 0.4,
    play(v, t, o) {
      const p = clamp(num(o.dur, 1), 0.3, 3), k = 0.6 + 0.25 * p;
      thump(v, t, 75, 22, 0.55, 1.0 * k, 0.8);
      burst(v, t, 'brown', 'lowpass', 280, 0.8, 0.85 * k, 0.6, 0.004);
      burst(v, t, 'white', 'highpass', 1300, 0.7, 0.25 * k, 0.07, 0.0005);
      const c = v.noise('pink', t + 0.1, t + 1.0);
      const bp = v.filter('bandpass', 1100, 0.7);
      const g = v.gain(0);
      spikes(g.gain, t + 0.12, 0.8, 14, 0.14 * k, 0.003, 0.03, 0.7);
      c.connect(bp).connect(g).connect(v.out);
    },
  },
  /** The reticle finds the hero: two soft ticks. */
  fsTrack: {
    prio: 4, rev: 0.2, gap: 0.5, falloff: 0.6,
    play(v, t) {
      ping(v, t, 'sine', 1568, 0.03, 0.06);
      ping(v, t + 0.12, 'sine', 1568, 0.03, 0.06);
    },
  },
  /** The reticle LOCKS: a hard two-tone, unmissable. */
  fsLock: {
    prio: 7, rev: 0.25, gap: 0.3, falloff: 0.3,
    play(v, t) {
      for (const dt of [0, 0.09]) {
        const s = v.osc('square', 1760, t + dt, t + dt + 0.07);
        const lp = v.filter('lowpass', 3000, 1);
        const g = v.gain(0);
        perc(g.gain, t + dt, 0.07, 0.002, 0.06);
        s.connect(lp).connect(g).connect(v.out);
      }
      ping(v, t + 0.18, 'sine', 2349, 0.06, 0.3);
    },
  },
  /** The pillar of light (o.dur s): a falling roar from above, a boom as it meets the floor. */
  fsLance: {
    prio: 7, rev: 0.6, gap: 0.6, falloff: 0.3,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.4), 0.5, 2.5);
      const f = swish(v, t, 'white', 'bandpass', 2600, 0.8, [[0, 0], [0.05, 0.3], [D, 0.18], [D + 0.2, 0]]);
      glide(f.frequency, t, 3600, 700, D);
      thump(v, t + 0.04, 70, 22, 0.6, 1.1, 0.9);
      burst(v, t + 0.04, 'brown', 'lowpass', 300, 0.8, 0.8, 0.7, 0.004);
    },
  },
  /** A ring shock rolling out (o.dur its strength): a low crack and the air shoved outward. */
  fsRing: {
    prio: 6, rev: 0.4, gap: 0.2, falloff: 0.45,
    play(v, t, o) {
      const k = 0.7 + 0.25 * clamp(num(o.dur, 1), 0, 2);
      thump(v, t, 85, 30, 0.35, 0.8 * k, 0.5);
      const f = swish(v, t, 'brown', 'lowpass', 400, 0.8, [[0, 0], [0.04, 0.5 * k], [0.6, 0]]);
      glide(f.frequency, t, 700, 200, 0.55);
    },
  },
  /** Molten steel pouring (o.dur s, sent again while it pours): a heavy hiss, a sizzle where it lands. */
  fsPour: {
    prio: 4, rev: 0.3, gap: 0.6, falloff: 0.5,
    play(v, t, o) {
      const D = clamp(num(o.dur, 1.5), 0.4, 3);
      swish(v, t, 'pink', 'bandpass', 900, 0.6, [[0, 0], [0.15, 0.18], [D, 0.16], [D + 0.2, 0]]);
      const c = v.noise('white', t, t + D);
      const bp = v.filter('bandpass', 3000, 1);
      const g = v.gain(0);
      spikes(g.gain, t, D, Math.round(16 * D), 0.06, 0.002, 0.015, 0.6);
      c.connect(bp).connect(g).connect(v.out);
    },
  },
  /** A servo step (from phase 3): a short whirr and a muffled metal set-down. */
  fsServo: {
    prio: 2, rev: 0.12, gap: 0.2, falloff: 0.8,
    play(v, t) {
      const s = v.osc('square', 260, t, t + 0.12);
      glide(s.frequency, t, 260, 340, 0.1);
      const lp = v.filter('lowpass', 900, 2);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.02, 0.025], [0.1, 0]]);
      s.connect(lp).connect(g).connect(v.out);
      thump(v, t + 0.08, 110, 70, 0.05, 0.16, 0.08);
    },
  },
  /** The hero's blade on his bare frame (o.dur 1, 1.4 heavy): metal on metal, a short bright ring. */
  fsHitMetal: {
    prio: 6, rev: 0.25, gap: 0.04, falloff: 0.6,
    play(v, t, o) {
      const k = clamp(num(o.dur, 1), 0.6, 1.6);
      burst(v, t, 'white', 'bandpass', 3600, 2.4, 0.22 * k, 0.04, 0.0005);
      const f0 = rnd(1180, 1320);
      for (const [r, a, d] of [[1, 0.05, 0.35], [2.76, 0.025, 0.2], [5.4, 0.012, 0.12]]) ping(v, t + 0.002, 'sine', f0 * r, a * k, d * k);
      thump(v, t, 140, 70, 0.06, 0.25 * k, 0.1);
    },
  },
  /** His death (o.dur the sensors lit): the power going down, a long falling hum. */
  fsPowerDown: {
    prio: 7, rev: 0.6, gap: 2, falloff: 0.3,
    play(v, t) {
      const s = v.osc('sawtooth', 180, t, t + 2.4);
      glide(s.frequency, t, 180, 30, 2.2);
      const lp = v.filter('lowpass', 1200, 1.2);
      glide(lp.frequency, t, 1200, 150, 2.2);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.05, 0.08], [2.3, 0]]);
      s.connect(lp).connect(g).connect(v.out);
      ping(v, t, 'sine', 880, 0.03, 1.2);
    },
  },
  /** (v04 pack C1) A palm lands (o.dur its weight; 1.5 the shove): a flat, dense slap of a hand on cloth,
   *  a short body thump under it. */
  fsPalm: {
    prio: 5, rev: 0.15, gap: 0.06, falloff: 0.7,
    play(v, t, o) {
      const k = clamp(num(o.dur, 1), 0.4, 2);
      burst(v, t, 'pink', 'bandpass', 1500, 1.1, 0.35 * k, 0.05, 0.0008);
      burst(v, t, 'white', 'highpass', 3000, 0.7, 0.08 * k, 0.025, 0.0005);
      thump(v, t, 120, 55, 0.08, 0.45 * k, 0.16);
    },
  },
  /** (v04 pack C2) A foot planted and slid (o.dur its weight): a gritty scrape over the plates, a knock. */
  fsScuff: {
    prio: 4, rev: 0.12, gap: 0.08, falloff: 0.75,
    play(v, t, o) {
      const k = clamp(num(o.dur, 1), 0.3, 2);
      thump(v, t, 95, 50, 0.06, 0.3 * k, 0.12);
      const c = v.noise('white', t, t + 0.3);
      const bp = v.filter('bandpass', 2200, 1.2);
      const g = v.gain(0);
      spikes(g.gain, t, 0.26, 9, 0.1 * k, 0.002, 0.012, 0.6);
      c.connect(bp).connect(g).connect(v.out);
      swish(v, t, 'pink', 'bandpass', 900, 0.9, [[0, 0], [0.02, 0.12 * k], [0.25, 0]]);
    },
  },
};
