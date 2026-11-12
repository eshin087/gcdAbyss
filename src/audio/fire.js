import { clamp } from '../core/math.js';
import { env, perc, glide, spikes, rnd, num } from './dsp.js';

// Procedural sounds of the wyrm's fire spells, flights and hazards (dragon-fire, contract 3). Same
// recipe shape as sfx.js (AudioEngine.play looks names up here after SFX): { prio, rev, gap,
// falloff, bus, gain, play(v, t, o) }. subscribeFire() maps the events to them:
//   dragon:spell {name}         skyStrafe -> skyRoar · diveBomb -> diveScream · meteorRain -> meteorCast
//                               eruptions -> rumble · flameRing / flameWall -> flameIgnite · nova -> novaCharge
//   dragon:hazard {kind, stage} meteor fall -> meteorFall · meteor hit -> meteorHit · pillar -> pillar
//                               crash -> crash · nova -> novaBlast · Armageddon: meteor launch (a
//                               bolt of the salvo) -> boltLaunch · meteor sky (the sky answers) -> rumble
//   combat:tell {hazard: true}  -> hazardTell (a hazard's own tell: lighter than the brass sting)

// --- small building blocks (local copies of sfx.js's) -----------------------------------------
function swish(v, t, kind, type, freq, q, pts) {
  const D = pts[pts.length - 1][0];
  const n = v.noise(kind, t, t + D + 0.02, rnd(0.92, 1.08));
  const f = v.filter(type, freq, q);
  const g = v.gain(0);
  env(g.gain, t, pts);
  n.connect(f).connect(g).connect(v.out);
  return f;
}

function burst(v, t, kind, type, freq, q, a, decay, attack = 0.002) {
  const n = v.noise(kind, t, t + attack + decay + 0.02, rnd(0.92, 1.08));
  const f = v.filter(type, freq, q);
  const g = v.gain(0);
  perc(g.gain, t, a, attack, decay);
  n.connect(f).connect(g).connect(v.out);
  return f;
}

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

/** Crackling fire: random spikes of high-passed noise over `D` s. */
function crackle(v, t, D, count, amp, freq = 2600) {
  const c = v.noise('white', t, t + D + 0.05);
  const b = v.filter('bandpass', freq, 0.8);
  const g = v.gain(0);
  spikes(g.gain, t, D, count, amp, 0.003, 0.012, 0.8);
  c.connect(b).connect(g).connect(v.out);
}

/** A deep distorted boom (brown noise through a closing low-pass). */
function boom(v, t, D, a, lp0 = 1100, lp1 = 120, drive = 8) {
  const n = v.noise('brown', t, t + D + 0.1);
  const lp = v.filter('lowpass', lp0, 0.8);
  env(lp.frequency, t, [[0, lp0], [D * 0.8, lp1]]);
  const sh = v.shaper(drive);
  const g = v.gain(0);
  perc(g.gain, t, a, 0.002, D);
  n.connect(lp).connect(sh).connect(g).connect(v.out);
}

// --- catalogue ------------------------------------------------------------------------------------
export const FIRE_SFX = {
  /** A meteor's descent (~fall s): a falling whistle over a growing roar. opts.fall */
  meteorFall: {
    prio: 3, rev: 0.25, gap: 0.12, falloff: 0.7,
    play(v, t, o) {
      const D = clamp(num(o.fall, 0.75), 0.3, 1.5);
      const bp = swish(v, t, 'white', 'bandpass', 3200, 3, [[0, 0], [D * 0.5, 0.12], [D, 0.22], [D + 0.04, 0]]);
      glide(bp.frequency, t, 3400, 700, D);
      const w = v.osc('sine', 1500, t, t + D + 0.05);
      glide(w.frequency, t, 1600, 420, D);
      const wg = v.gain(0);
      env(wg.gain, t, [[0, 0], [D * 0.3, 0.035], [D, 0.06], [D + 0.03, 0]]);
      w.connect(wg).connect(v.out);
      swish(v, t, 'brown', 'lowpass', 300, 0.7, [[0, 0], [D, 0.5], [D + 0.05, 0]]);
    },
  },

  /** One bolt of Armageddon's salvo shot into the sky: a short rising hiss over a thud. */
  boltLaunch: {
    prio: 3, rev: 0.25, gap: 0.05, falloff: 0.7,
    play(v, t) {
      const bp = swish(v, t, 'white', 'bandpass', 900, 2.2, [[0, 0], [0.03, 0.22], [0.35, 0]]);
      glide(bp.frequency, t, 900, 4200, 0.35);
      thump(v, t, 140, 60, 0.08, 0.35, 0.12);
    },
  },

  /** A meteor strikes: a heavy boom, a rock crack, flames crackling out. */
  meteorHit: {
    prio: 5, rev: 0.35, gap: 0.05, falloff: 0.6,
    play(v, t) {
      thump(v, t, 64, 20, 0.75, 1.1, 1.0);
      boom(v, t, 1.2, 0.85, 1300, 110, 9);
      burst(v, t, 'pink', 'bandpass', 900, 0.8, 0.55, 0.18);
      burst(v, t + 0.01, 'white', 'bandpass', 2400, 1.5, 0.3, 0.05, 0.0008);
      crackle(v, t + 0.06, 1.4, 26, 0.8);
    },
  },

  /** A lava pillar erupts: a hissing roar shooting up over a low thump and a bubbling gurgle. */
  pillar: {
    prio: 4, rev: 0.3, gap: 0.07, falloff: 0.65,
    play(v, t) {
      const D = 0.75;
      const bp = swish(v, t, 'pink', 'bandpass', 300, 1.0, [[0, 0], [0.04, 0.6], [D, 0]]);
      env(bp.frequency, t, [[0, 260], [0.12, 1500], [D, 700]]);
      thump(v, t, 85, 32, 0.3, 0.8, 0.45);
      const s = v.osc('sawtooth', 48, t, t + D);
      const lp = v.filter('lowpass', 280, 0.8);
      const am = v.gain(0.5);
      const lfo = v.osc('sine', 22, t, t + D);
      const depth = v.gain(0.5);
      lfo.connect(depth).connect(am.gain);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.05, 0.2], [D, 0]]);
      s.connect(lp).connect(am).connect(g).connect(v.out);
      swish(v, t + 0.1, 'white', 'highpass', 3000, 0.7, [[0, 0], [0.1, 0.12], [0.7, 0]]);
    },
  },

  /** The dive bomb's crash landing: an enormous thump, debris and a shock whoosh. */
  crash: {
    prio: 6, rev: 0.4, gap: 0.4, falloff: 0.5,
    play(v, t) {
      thump(v, t, 54, 15, 0.9, 1.3, 1.3);
      boom(v, t, 1.3, 1.0, 1000, 90, 6);
      const ws = swish(v, t, 'pink', 'bandpass', 500, 0.7, [[0, 0], [0.03, 0.5], [0.6, 0]]);
      glide(ws.frequency, t, 500, 1800, 0.5);
      crackle(v, t + 0.05, 1.0, 30, 0.6, 1800);
    },
  },

  /** The dive: a screaming stoop, wind rising to a shriek with a wing flutter. */
  diveScream: {
    prio: 5, rev: 0.3, gap: 0.5, falloff: 0.5,
    play(v, t) {
      const D = 0.55;
      const bp = swish(v, t, 'white', 'bandpass', 600, 2.2, [[0, 0], [D * 0.8, 0.35], [D, 0.1], [D + 0.05, 0]]);
      glide(bp.frequency, t, 600, 2800, D);
      const wind = swish(v, t, 'pink', 'lowpass', 500, 0.7, [[0, 0], [D, 0.55], [D + 0.08, 0]]);
      glide(wind.frequency, t, 400, 1600, D);
      const n = v.noise('brown', t, t + D);
      const lp = v.filter('lowpass', 260, 0.8);
      const am = v.gain(0.5);
      const lfo = v.osc('sine', 28, t, t + D);
      const depth = v.gain(0.5);
      lfo.connect(depth).connect(am.gain);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [D, 0.5], [D + 0.02, 0]]);
      n.connect(lp).connect(am).connect(g).connect(v.out);
    },
  },

  /** The burning pass: a rushing roar of wind and fire as it sweeps over. */
  skyRoar: {
    prio: 4, rev: 0.3, gap: 0.8, falloff: 0.55,
    play(v, t) {
      const D = 1.6;
      const bp = swish(v, t, 'pink', 'bandpass', 300, 0.8, [[0, 0], [0.25, 0.55], [D * 0.7, 0.4], [D, 0]]);
      env(bp.frequency, t, [[0, 300], [0.3, 1100], [D, 500]]);
      swish(v, t, 'brown', 'lowpass', 350, 0.7, [[0, 0], [0.3, 0.6], [D, 0]]);
      crackle(v, t + 0.1, D - 0.1, 40, 0.55);
    },
  },

  /** The meteor cast: a shell screaming up into the sky. */
  meteorCast: {
    prio: 4, rev: 0.45, gap: 1, falloff: 0.45,
    play(v, t) {
      const D = 1.0;
      const bp = swish(v, t, 'pink', 'bandpass', 400, 1.2, [[0, 0], [0.05, 0.6], [D, 0]]);
      glide(bp.frequency, t, 400, 2600, D);
      const w = v.osc('sine', 300, t, t + D);
      glide(w.frequency, t, 300, 1900, D);
      const wg = v.gain(0);
      env(wg.gain, t, [[0, 0], [0.1, 0.05], [D, 0]]);
      w.connect(wg).connect(v.out);
      thump(v, t, 90, 50, 0.25, 0.4, 0.3);
    },
  },

  /** The ground rumbling as the eruptions wake (under the slam). */
  rumble: {
    prio: 3, rev: 0.3, gap: 0.5, falloff: 0.6,
    play(v, t) {
      const D = 1.3;
      const n = v.noise('brown', t, t + D + 0.05);
      const lp = v.filter('lowpass', 120, 0.9);
      const am = v.gain(0.6);
      const lfo = v.osc('sine', 13, t, t + D);
      const depth = v.gain(0.4);
      lfo.connect(depth).connect(am.gain);
      const g = v.gain(0);
      env(g.gain, t, [[0, 0], [0.08, 0.9], [D, 0]]);
      n.connect(lp).connect(am).connect(g).connect(v.out);
      thump(v, t, 48, 26, 0.5, 0.6, 0.8);
    },
  },

  /** A ring / wall of fire springs up: a whooshing roar swelling out, flames crackling. */
  flameIgnite: {
    prio: 5, rev: 0.35, gap: 0.3, falloff: 0.5,
    play(v, t, o) {
      const D = clamp(num(o.length, 1.4), 0.6, 3);
      const bp = swish(v, t, 'pink', 'bandpass', 220, 0.9, [[0, 0], [0.12, 0.7], [D * 0.6, 0.45], [D, 0]]);
      env(bp.frequency, t, [[0, 220], [0.18, 950], [D, 400]]);
      swish(v, t, 'brown', 'lowpass', 300, 0.7, [[0, 0], [0.1, 0.65], [D, 0]]);
      thump(v, t, 70, 30, 0.35, 0.6, 0.5);
      crackle(v, t + 0.05, D, Math.round(25 * D), 0.7);
    },
  },

  /** The nova's 2.5 s charge: a sub swell, a rising air roar and a shimmering whine that climb together. */
  novaCharge: {
    prio: 6, rev: 0.45, gap: 2, falloff: 0.3,
    play(v, t, o) {
      const D = clamp(num(o.time, 2.5), 0.8, 4);
      const sub = v.osc('sine', 32, t, t + D + 0.05);
      glide(sub.frequency, t, 30, 62, D);
      const sg = v.gain(0);
      env(sg.gain, t, [[0, 0], [D * 0.9, 0.7], [D, 0.75], [D + 0.04, 0]]);
      sub.connect(sg).connect(v.out);
      const bp = swish(v, t, 'pink', 'bandpass', 200, 1.4, [[0, 0], [D * 0.95, 0.5], [D + 0.03, 0]]);
      glide(bp.frequency, t, 200, 3200, D);
      // the shimmer: inharmonic partials rising a fifth with a quickening tremolo
      for (const [r, a] of [[1, 0.05], [1.5, 0.035], [2.24, 0.025]]) {
        const s = v.osc('sine', 220 * r, t, t + D + 0.05);
        glide(s.frequency, t, 220 * r, 330 * r * 1.5, D);
        const am = v.gain(0.5);
        const lfo = v.osc('sine', 4, t, t + D);
        glide(lfo.frequency, t, 4, 22, D);
        const depth = v.gain(0.5);
        lfo.connect(depth).connect(am.gain);
        const g = v.gain(0);
        env(g.gain, t, [[0, 0], [D, a], [D + 0.03, 0]]);
        s.connect(am).connect(g).connect(v.out);
      }
    },
  },

  /** The nova goes off: the biggest boom in the game, a white blast and a long burning tail. */
  novaBlast: {
    prio: 6, rev: 0.6, gap: 1, falloff: 0.25,
    play(v, t) {
      thump(v, t, 58, 14, 1.4, 1.4, 1.8);
      boom(v, t, 2.0, 1.1, 2400, 80, 10);
      burst(v, t, 'white', 'lowpass', 6000, 0.6, 0.7, 0.4, 0.001);
      crackle(v, t + 0.1, 2.6, 60, 0.9);
    },
  },

  /** A hazard announcing itself (combat:tell with hazard): a short low warning hiss, not the brass sting. */
  hazardTell: {
    prio: 4, rev: 0.25, gap: 0.25, falloff: 0.4, bus: 'cue',
    play(v, t) {
      const bp = swish(v, t, 'pink', 'bandpass', 500, 1.6, [[0, 0], [0.05, 0.16], [0.32, 0]]);
      glide(bp.frequency, t, 420, 1100, 0.3);
      thump(v, t, 70, 40, 0.18, 0.35, 0.25);
    },
  },
};

// (the bullet patterns keep their keys: emberStorm = the Ember torrent, fanVolley = the Cinder burst,
// fireWheel = the Scouring breath; the torrent and the breath also run the breath loop through
// dragon:breathStart / breathEnd, ADR-046)
const SPELL = { skyStrafe: 'skyRoar', diveBomb: 'diveScream', meteorRain: 'meteorCast', eruptions: 'rumble', flameRing: 'flameIgnite', flameWall: 'flameIgnite', nova: 'novaCharge', emberStorm: 'flameIgnite', fanVolley: 'flameIgnite', fireWheel: 'flameIgnite', wispSwarm: 'meteorCast' };
const SPELL_OPTS = { flameRing: { length: 1.6 }, flameWall: { length: 2.6 }, nova: { time: 2.5 } };
const HIT = { meteor: 'meteorHit', pillar: 'pillar', crash: 'crash', nova: 'novaBlast' };

/**
 * Subscribe the fire events (`on` = the engine's guarded subscriber: (name, fn(data))). Spells and
 * hazards are spatialised at their event's x / z.
 */
export function subscribeFire(on, E) {
  on('dragon:spell', (d) => {
    const name = SPELL[d.name];
    if (!name) return;
    const o = { ...(SPELL_OPTS[d.name] ?? null) };
    if (Number.isFinite(d.x) && Number.isFinite(d.z)) {
      o.x = d.x;
      o.z = d.z;
    }
    E.play(name, o);
  });
  on('dragon:hazard', (d) => {
    const st = d.stage;
    const name = st === 'fall' ? (d.kind === 'meteor' ? 'meteorFall' : null) : st === 'launch' ? 'boltLaunch' : st === 'sky' ? 'rumble' : HIT[d.kind];
    if (!name) return;
    E.play(name, { x: d.x, z: d.z, fall: 0.75 });
  });
}
