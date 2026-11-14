import { clamp } from '../core/math.js';
import { env, perc, glide, spikes, rnd, mtof, num } from './dsp.js';

// One-shot sound recipes, played through AudioEngine.play(name, opts).
// Each entry: { prio, rev, gap, falloff, bus, gain, play(v, t, o, E) }
//   prio     voice-steal priority (0 footsteps … 6 hero sounds)
//   rev      reverb send level
//   gap      minimum seconds between two plays of the same name
//   falloff  distance attenuation multiplier for spatial sounds (<1 = carries further)
//   bus      'ui' bypasses the pause duck; 'cue' (combat cues) bypasses the Ghostep low-pass but
//            not the pause duck; default is the sfx bus
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
      const D = o.thrust ? 0.5 : heavy ? 0.42 : 0.24;
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
      const f0 = (big ? 740 : 880) * up * rnd(0.98, 1.02);
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
      if (o.perfectMelee) {
        // perfect: a sharper crack and a high bright bell that rings through the slow motion
        burst(v, t, 'white', 'highpass', 5200, 1.2, 0.45, 0.03, 0.0004);
        ping(v, t + 0.003, 'sine', f0 * 3, 0.08, 1.3, 0.001);
        ping(v, t + 0.003, 'triangle', f0 * 4.5, 0.035, 0.9, 0.001);
      }
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
      notes.forEach((m, i) => ping(v, t + 0.04 + i * 0.035, 'sine', mtof(m) * up, 0.05 * k, 0.35, 0.002));
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

  /** dragon:returned — a returned bullet bursts on the wyrm's head: a fiery crack and a low hit. opts.kind 1 (wisp): heavier. */
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
