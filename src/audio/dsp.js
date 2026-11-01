import { clamp } from '../core/math.js';

// Procedural DSP building blocks for the audio engine: looping noise tables, the generated
// reverb impulse, waveshaper curves and AudioParam envelope helpers. Buffers/curves are built
// once and shared; envelope helpers never receive non-finite numbers from callers.

export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** `v` if it is a finite number, else the fallback. */
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// --- noise tables -------------------------------------------------------------------------

const LOOP_XFADE = 4096;

/** Mono buffer whose head is crossfaded with the samples after its tail → seamless loop. */
function loopable(ctx, seconds, gen) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const raw = new Float32Array(len + LOOP_XFADE);
  gen(raw);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  d.set(raw.subarray(0, len));
  for (let i = 0; i < LOOP_XFADE; i++) {
    const w = i / LOOP_XFADE;
    d[i] = raw[i] * w + raw[len + i] * (1 - w);
  }
  let peak = 1e-6;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = 0.9 / peak;
  for (let i = 0; i < len; i++) d[i] *= k;
  return buf;
}

export function createNoiseBuffers(ctx) {
  const white = loopable(ctx, 2, (a) => {
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
  });
  // Paul Kellet's refined pink filter
  const pink = loopable(ctx, 3, (a) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < a.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  });
  // leaky-integrated white → brown (rumbles, wind, fire body)
  const brown = loopable(ctx, 4, (a) => {
    let l = 0;
    for (let i = 0; i < a.length; i++) {
      l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      a[i] = l * 3.5;
    }
  });
  return { white, pink, brown };
}

// --- reverb impulse -----------------------------------------------------------------------

/**
 * Stereo "dark hall": pre-delay, a few early reflections, then exponentially decaying noise
 * (−60 dB at `seconds`) through a 2-pole lowpass whose cutoff falls as the tail decays.
 */
export function createImpulse(ctx, seconds = 2.8) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.018);
  const k = Math.log(1000) / seconds;
  const step = Math.exp(-k / sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0, lp2 = 0, decay = 1;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const fc = 4200 * Math.exp(-t * 1.1) + 380;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (Math.random() * 2 - 1 - lp);
      lp2 += a * (lp - lp2);
      d[i] = lp2 * decay * Math.min(1, t / 0.012);
      decay *= step;
    }
    for (let r = 0; r < 7; r++) {
      const at = pre + Math.floor(sr * rnd(0.004, 0.075));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * rnd(0.12, 0.35) * (1 - r / 9);
    }
  }
  return buf;
}

// --- waveshaper curves --------------------------------------------------------------------

const curves = new Map();

/** Classic soft-saturation curve; `amount` 0 = linear, ~5 warm, 30+ crunchy. Cached. */
export function distortionCurve(amount) {
  const k = Math.round(clamp(amount, 0, 200));
  let c = curves.get(k);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  curves.set(k, c);
  return c;
}

/**
 * Output safety limiter. Feed it the signal pre-scaled by 0.5: the curve spans ±2 of signal,
 * is unity below 0.6 and bends smoothly toward ±1 above (no harsh digital clipping).
 */
export function limiterCurve() {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = ((i * 2) / (n - 1) - 1) * 2;
    const a = Math.abs(s);
    const y = a <= 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4);
    c[i] = Math.sign(s) * y;
  }
  return c;
}

// --- AudioParam helpers (times absolute, in ctx seconds) ------------------------------------

/** Piecewise-linear automation; `pts` = [[relativeTime, value], ...] in ascending time. */
export function env(p, t, pts) {
  p.setValueAtTime(pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
}

/** Percussive envelope: linear attack to `peak`, exponential decay to silence. */
export function perc(p, t, peak, attack, decay) {
  const pk = Math.max(peak, 1e-4);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + attack);
  p.exponentialRampToValueAtTime(pk * 1e-3, t + attack + decay);
  p.linearRampToValueAtTime(0, t + attack + decay + 0.01);
}

/** Exponential slide (frequencies). */
export function glide(p, t, from, to, dur) {
  p.setValueAtTime(Math.max(from, 1e-3), t);
  p.exponentialRampToValueAtTime(Math.max(to, 1e-3), t + dur);
}

/** Random crackle spikes on a gain param (use a dedicated GainNode). `fade` 0..1 tapers them. */
export function spikes(p, t, dur, count, amp, tauMin = 0.003, tauMax = 0.012, fade = 0) {
  const times = [];
  for (let i = 0; i < count; i++) times.push(t + Math.random() * dur);
  times.sort((a, b) => a - b);
  p.setValueAtTime(0, t);
  for (const tt of times) {
    const life = (tt - t) / dur;
    const a = amp * Math.pow(Math.random(), 1.8) * (1 - fade * life);
    p.setValueAtTime(Math.max(a, 0), tt);
    p.setTargetAtTime(0, tt + 0.0008, rnd(tauMin, tauMax));
  }
}

/** Freeze a param at its current value so a new ramp can start from there. */
export function holdAt(p, now) {
  const v = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(v, now);
}

/** Linear ramp from the current value to `value` over `dur` seconds (0 = immediate). */
export function rampTo(p, value, now, dur) {
  holdAt(p, now);
  if (dur > 0) p.linearRampToValueAtTime(value, now + dur);
  else p.setValueAtTime(value, now);
}
