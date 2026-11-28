// THE SOUND OF THE AIR: its numbers (audio/air.js reads them). One block per level id; a level without
// one gets `quiet`. Gains are linear, BEFORE the ambient bus (0.55) and the master: a bed should sit
// round -38 .. -28 dBFS RMS there (tests/integration/life/air.mjs and the offline renders measure it).
// Taste: synthesized only, dark, quiet, never pretty. When unsure: quieter and lower.
//
// A level's recipe (every block optional; a missing one is a layer the level does not have):
//   old      today's bed (ForestAmbience) under the air: { wind, voices } 0..1. Its bonfire always stays.
//   wind     brown noise through a lowpass that opens with the gusts:
//            gain (at drive 1), base (drive with no wind), level (+ per wind.level), gust (+ per gust k),
//            idle (the wind.level to assume when the wind piece is off), sway: [depth, period s] (a slow
//            breath of its own), lp: [closed, open] Hz, hp (Hz, thins it), q, rate (noise playback),
//            pan (the two layers' spread)
//   leaves   a rustle that lives in the gusts: pink noise, bandpass bp / q, gain per gust k
//   whistle  a thin whistle in the gusts: white noise, bandpass f (rises by rise x gust) / q, gain per gust^1.5
//   grit     sand on the wind: white noise, highpass hp, gain per gust k (+ level x per wind.level)
//   rain     soft filtered noise while it falls (weather.wet): pink noise, hp / lp, gain at wet 1. No drops.
//   drone    a very low tone that breathes: f (Hz), fifth (Hz), gain, sway: [depth, period s]
//   spells   weather.name → a colour: { kind: 'embers' (a hiss with sparse crackle) | 'swell' (the drone
//            and a low rumble rise), gain, read (a weather field 0..1 to follow instead of the name) }
//   crickets the level's own: voices [[Hz, pan, amp]], period [a, b] s, pulses, on / off [a, b] s, rev
//   crow     a far crow, rarely: every [a, b] s, f (Hz), gain, caws [a, b]
//   thunder  far thunder after weather.flash: gain, delay [a, b] s, len [a, b] s, lp Hz, gap s
//   hushWind how much of the wind goes with life.hush (0..1); the voices always go all the way

export const AIR_TUNE = Object.freeze({
  /** cross-fade (s, time constants) when the piece is switched on / off */
  fadeIn: 1.2,
  fadeOut: 0.8,
  /** the gust follower (time constants: ~95 % in 3 x tau): attack ~0.4 s, release ~2 s */
  attack: 0.13,
  release: 0.65,
  /** life.hush: the voices go (tau down) and come back slowly (tau up) */
  hushDown: 0.1,
  hushUp: 2.5,
  /** the fight (bossIntro / boss / dead): the air's own voices fall silent as today's crickets do */
  tenseDown: 0.5,
  tenseUp: 3,
  /** life.calm thins the whole bed: gain x (1 - (1 - calm) x calmThin) */
  calmThin: 0.5,
  /** the voices' share sent to the reverb (distance) */
  rev: 0.35,
  /** weather spells come in and go slowly (time constants, s) */
  spellIn: 1.5,
  spellOut: 3,

  levels: Object.freeze({
    // a moonlit forest clearing: today's forest (its crickets and owl stay), the wind now the world's
    cinderwood: Object.freeze({
      old: { wind: 0, voices: 1 },
      wind: { gain: 0.28, base: 0.3, level: 0.55, gust: 0.75, idle: 0.3, sway: [0.25, 11], lp: [260, 820], hp: 0, q: 0.6, rate: [0.85, 1.05], pan: 0.55 },
      leaves: { gain: 0.06, bp: 2600, q: 0.7 },
      rain: { gain: 0.11, hp: 380, lp: 2300 },
      hushWind: 0.35,
    }),
    // a burned sword sect: a dry hollow wind over stone, thinner and higher, a faint whistle in gusts
    ash: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.2, base: 0.3, level: 0.5, gust: 0.8, idle: 0.35, sway: [0.35, 7], lp: [420, 1250], hp: 160, q: 0.9, rate: [1.0, 1.2], pan: 0.6 },
      whistle: { gain: 0.02, f: 1350, rise: 0.18, q: 14 },
      grit: { gain: 0.01, hp: 3800, level: 0.2 },
      spells: { squall: { kind: 'embers', gain: 0.06 } },
      crow: { every: [55, 120], f: 470, gain: 0.03, caws: [1, 3] },
      hushWind: 0.4,
    }),
    // the crater of a fallen star: no wind at all; a drone that breathes with the star, and near-silence
    starless: Object.freeze({
      old: { wind: 0, voices: 0 },
      drone: { f: 34, fifth: 51.4, gain: 0.018, sway: [0.3, 14] },
      spells: { breath: { kind: 'swell', gain: 0.03, read: 'breath' } },
      hushWind: 0.6,
    }),
    // a tournament ring on high badlands: a strong steady plateau wind, grit in the gusts, far thunder
    ring: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.24, base: 0.55, level: 0.4, gust: 0.55, idle: 0.6, sway: [0.12, 13], lp: [330, 1100], hp: 40, q: 0.7, rate: [0.9, 1.1], pan: 0.7 },
      grit: { gain: 0.016, hp: 3200, level: 0.15 },
      thunder: { gain: 0.45, delay: [1.5, 5], len: [3.5, 6.5], lp: 120, gap: 5 },
      hushWind: 0.3,
    }),
    // a moonlit hill shrine: a soft breeze in sighs; crickets farther off than the forest's; no chime
    fox: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.23, base: 0.2, level: 0.55, gust: 0.7, idle: 0.3, sway: [0.6, 9], lp: [240, 700], hp: 0, q: 0.6, rate: [0.85, 1.0], pan: 0.5 },
      leaves: { gain: 0.045, bp: 3200, q: 0.8 },
      rain: { gain: 0.1, hp: 380, lp: 2200 },
      crickets: { voices: [[4150, -0.55, 0.018], [4600, 0.6, 0.014]], period: [0.5, 0.8], pulses: 2, on: [3, 10], off: [3, 9], rev: 0.6 },
      hushWind: 0.35,
    }),
    // bamboo at night, the grove holds its breath: no wind of its own (only a blow's air), one cricket,
    // the bonfire. The silence is the level.
    grove: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.24, base: 0, level: 0, gust: 1, idle: 0, sway: [0, 10], lp: [220, 700], hp: 0, q: 0.6, rate: [0.85, 1.0], pan: 0.5 },
      rain: { gain: 0.08, hp: 400, lp: 2000 },
      crickets: { voices: [[3900, 0.25, 0.03]], period: [0.85, 1.2], pulses: 2, on: [5, 14], off: [4, 11], rev: 0.25 },
      hushWind: 1,
    }),
    // the Veiled Crossing: a low moan down the empty streets under the veil, deep and slow, grit in
    // the gusts; no creature, no water. A faint drone under it (the veil itself)
    veil: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.22, base: 0.35, level: 0.45, gust: 0.6, idle: 0.4, sway: [0.15, 16], lp: [180, 520], hp: 30, q: 1.1, rate: [0.8, 0.95], pan: 0.45 },
      whistle: { gain: 0.012, f: 620, rise: 0.12, q: 10 },
      grit: { gain: 0.008, hp: 3600, level: 0.2 },
      drone: { f: 41, fifth: 61.5, gain: 0.01, sway: [0.25, 18] },
      hushWind: 0.45,
    }),
    // the Last Foundry: the furnace's low roar under everything (a deep drone and its fifth, swelling slowly),
    // the draught through the broken walls, grit; no creature, no water
    foundry: Object.freeze({
      old: { wind: 0, voices: 0 },
      wind: { gain: 0.2, base: 0.4, level: 0.45, gust: 0.55, idle: 0.45, sway: [0.2, 14], lp: [160, 460], hp: 28, q: 0.9, rate: [0.85, 0.95], pan: 0.4 },
      grit: { gain: 0.01, hp: 3400, level: 0.2 },
      drone: { f: 38, fifth: 57, gain: 0.022, sway: [0.35, 11] },
      hushWind: 0.4,
    }),
  }),

  /** a level with no block of its own: a low breeze, nothing else */
  quiet: Object.freeze({
    old: { wind: 0, voices: 0 },
    wind: { gain: 0.18, base: 0.3, level: 0.4, gust: 0.6, idle: 0.3, sway: [0.2, 11], lp: [240, 700], hp: 0, q: 0.6, rate: [0.9, 1.0], pan: 0.5 },
    hushWind: 0.4,
  }),
});

/** The recipe for a level id. */
export const airRecipe = (id) => AIR_TUNE.levels[id] ?? AIR_TUNE.quiet;
