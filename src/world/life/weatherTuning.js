// The weather's numbers (world/life/weather.js): one block per level id. A level without a block has no
// weather of its own (the layer does nothing there).
//
// A level:
//   calm        the spell every visit starts in, and the one the fight eases back to
//   spells      name → { hold: [s, s] how long it holds once in, fade: [s, s] how long it takes to come
//               in (the spell it replaces goes as this one comes), next: [[name, weight], ...] what may
//               follow (a spell whose `option` the set does not have is left out), and its VALUES (any
//               left out: 0, or 1 for a factor):
//                 mist 0..1     the low mist's thickness (weather.mist; the mist bands draw by it)
//                 foot 0..1     a second band of mist (the fox terrace's foot)
//                 wet 0..1      rain falling (weather.wet; the drizzle draws by it)
//                 windK         what the weather asks of the wind (weather.windK; 1 = nothing)
//                 moon, ambient the moonlight / ambient light, multiplied (a cloud on the moon)
//                 fogNear, fogFar, fogColor   the fog, multiplied (a grey-out pulls it in and greys it)
//                 embers 0..1   the ember squall's stream (ash)
//                 grey 0..1     the grey-out's extra ash in the air (ash)
//                 breath 0..1   the fallen star breathes: the seal swells, the motes quicken (starless)
//                 devils, bolts dust devils / dry lightning, a minute (ring, before the fight only)
//                 snow 0..1     snow falling straight down (grove, option c only)
//   sky         false: the layer never touches the light / fog uniforms here (a set's own ambience writes
//               them every frame)
//   mist / rain / embers / grey / snow / devils / bolts / breath    how each thing is drawn
//
// Rates are per second at quality 1, life.k 1, before the fight (life.calm 1); every rate is multiplied
// by life.quality, life.k and life.calm. Colours are linear and dim (the level's own hue).

/** a bank of mist: a soft low cloud of many tiny pale letters (the house letter's size, ~0.3 m at the
 *  game camera), densest in its middle and thinning to single letters at its edges. It drifts with the
 *  air, comes in and goes out over seconds and keeps clear of the hero; inside it every letter comes
 *  and goes on its own beat (`cycle` [s, s]: in, out, and back elsewhere in the bank) and streams
 *  `stream` m along the air while it is there, rising `lift` m, so the bank rolls and thins instead of
 *  sliding as one. Drawn in the weather's own batch (weather.js): `max` banks at once (x quality), `per`
 *  letters each, `spread` [along, across] m (a soft heap: three uniforms summed), `scale` [min, max] of
 *  that per bank, `thin` the share of `per` a bank of the thinnest mist has (and it is half as
 *  bright), `grow` how much longer it gets along the air by its end, `rise` m its heart stands
 *  higher. rate: banks born a second in view at full mist */
const BANK = Object.freeze({
  max: 6, rate: 1.2, per: [160, 220], spread: [4.6, 1.8], scale: [0.75, 1.15], thin: 0.3, grow: 0.35, rise: 0.5,
  size: [0.28, 0.34], alpha: 0.5, cycle: [4, 9], stream: 0.7, lift: 0.12,
  life: [18, 28], fadeIn: 5, fadeOut: 6, color: [0.56, 0.62, 0.72], glyph: ".,'-.`-:.-.'~", wobble: 0.12,
  heroClear: [0.5, 1.7],
});

export const WEATHER_TUNE = Object.freeze({
  /** a spell fades this fast when the Lab forces it (s) */
  labFade: 8,
  /** the director's values may move this much a frame at most (the test's epsilon, at 60 fps) */
  maxStep: 0.02,
  /** a factor this close to 1 is 1 (the uniforms are left alone) */
  idle: 1e-4,
  /** below this `life.calm` counts as the fight: no new spell, back to the calm one */
  fightCalm: 0.995,
  /** s: the most a spell takes to clear once the fight starts */
  fightFade: 10,
  /** s: a spell not seen for this long weighs twice its weight when the director picks what follows */
  longing: 90,
  // (a level may carry `firstHold: [s, s]`: the calm spell's first hold of a visit, shorter, so the
  //  level shows what it does within the first seconds)
  /** the most falling letters (drizzle, ash, snow) the weather's own batch holds at once */
  fallMax: 700,
  /** spawns are kept this far (m) from the hero */
  heroGap: { mist: 2.5, fall: 0.8 },

  cinderwood: {
    calm: 'clear',
    spells: {
      clear: { hold: [55, 95], fade: [35, 50], next: [['mist', 3], ['drizzle', 1]], mist: 0.3 },
      mist: { hold: [40, 75], fade: [30, 45], next: [['clear', 3], ['drizzle', 2]], mist: 1, fogNear: 0.82, fogFar: 0.95, fogColor: 4, moon: 0.94 },
      drizzle: { hold: [30, 55], fade: [25, 35], next: [['clear', 1]], mist: 0.55, wet: 0.5, windK: 1.25, moon: 0.84, ambient: 0.92, fogNear: 0.9, fogFar: 0.96, fogColor: 2.5 },
    },
    // the low mist: banks of many tiny pale letters, a few thin ones in the calm and more as it thickens,
    // more in the tree line (r > 30) than in the clearing
    mist: {
      bank: BANK,
      // (`veil` 0: the banks come in from the first breath of mist; the calm spell's 0.3 is a few thin ones)
      bands: [{ key: 'mist', r: [12, 46], inner: [16, 30], innerK: 0.25, y: [0.75, 1.3], veil: 0 }],
      /** m/s: the drift when there is no wind to carry it (today's), and how much of the wind it takes */
      drift: [0.45, 0], carry: 0.4, view: [20, 12, -4],
    },
    // a thin rain: short dim strokes falling at the wind's slant
    rain: {
      rate: 70, area: [36, 28], y: [4.5, 8], fall: [7.5, 9.5], carry: 0.8, drift: [0.9, 0],
      // (a drop prints as the stroke along its fall: | or, past `slant` of the fall's speed across, a
      //  leaning one; `ticks` of them a ' or a , instead)
      size: 0.3, slant: 0.45, ticks: 0.3, color: [0.44, 0.48, 0.58], alpha: 0.22, alphaEnd: 0.1, glyph: "',",
    },
  },

  ash: {
    calm: 'ashfall',
    sky: true,
    spells: {
      ashfall: { hold: [50, 85], fade: [30, 45], next: [['squall', 3], ['greyout', 2]] },
      squall: { hold: [15, 25], fade: [12, 18], next: [['ashfall', 1]], windK: 1.6, embers: 1 },
      greyout: { hold: [40, 65], fade: [30, 45], next: [['ashfall', 1]], grey: 1, fogNear: 0.55, fogFar: 0.66, fogColor: 2.2, ambient: 1.08, moon: 0.86 },
    },
    // embers lifted off the ruins and carried across the yard in a loose faint stream of tiny dots, a
    // few (`bright` of them) brighter
    embers: {
      rate: 26, upwind: [4, 20], band: 6, wander: [6, 0.11], y: [0.3, 1.6], carry: 1.6, drift: [2.6, 0], min: 2.8,
      rise: [0.3, 0.8], gravity: -0.05, drag: 0.04, life: [8, 11], size: 0.3, sizeEnd: 0.22,
      color: [0.85, 0.26, 0.05], colorEnd: [0.3, 0.05, 0.01], flicker: 0.35, glyph: "..'.",
      bright: 0.15, brightColor: [2.2, 0.75, 0.14],
    },
    // the grey-out: more ash hanging in the air (fine, slow)
    grey: {
      rate: 16, area: [46, 34], y: [1, 7], fall: [0.3, 0.55], carry: 0.25, drift: [0.35, 0], life: [8, 11],
      size: 0.26, color: [0.34, 0.33, 0.31], colorEnd: [0.16, 0.15, 0.15], alpha: 0.42, glyph: ".,'`",
    },
  },

  starless: {
    calm: 'still',
    // (the first breath comes soon: a player standing at the spawn sees the crater breathe once)
    firstHold: [4, 7],
    spells: {
      still: { hold: [20, 36], fade: [8, 11], next: [['breath', 1]] },
      // the crater's dark warms with it (a breath of red in the fog and the ambient)
      breath: { hold: [2, 3.5], fade: [5, 7], next: [['still', 1]], breath: 1, ambient: 1.5, fogColor: 4.5, moon: 1.15 },
    },
    // the set's ambience does the drawing (throneHall.js: ambience.breathe(k)): k = breath × this
    breath: { k: 1 },
  },

  ring: {
    calm: 'dusk',
    // (the ring's own ambience writes the light every frame: its far lightning reads weather.flash)
    sky: false,
    spells: {
      dusk: { hold: [45, 80], fade: [35, 50], next: [['gathering', 1]], devils: 1.6, bolts: 2.4 },
      gathering: { hold: [40, 70], fade: [30, 45], next: [['dusk', 1]], windK: 1.3, devils: 2.6, bolts: 5 },
    },
    // a loose rising column of the level's dust, crossing the badlands with the wind, never onto the ring
    devils: {
      max: 2, first: [3, 6], keepOut: 18, upwind: [14, 22], across: 10, south: 3, heroGap: 6, tries: 10, life: [10, 15], speed: 1.5, carry: 0.9,
      // the column: `letters` pale dust letters turning round it (rad/s), rising (m/s) and wrapping, a
      // funnel `radius` wide at the top, leaning downwind; soft as it gathers and falls apart
      letters: 150, height: [5, 7], radius: [0.55, 0.9], swirl: 2.4, rise: 1.1, lean: 0.14, fadeIn: 2.5, fadeOut: 3.5,
      size: [0.26, 0.32], color: [0.66, 0.56, 0.43], alpha: 0.32, glyph: ".,'`-:.,",
    },
    // dry lightning far off: weather.flash (0..1), a soft brightening of the far side of the sky (the fog:
    // the horizon side of the frame) and a breath of the ambient; skybreakRing.js adds it
    bolts: { first: [2, 5], peak: [0.6, 1], rise: 20, decay: 2.6, double: 0.4, gap: [0.12, 0.22], fog: [0.17, 0.17, 0.21], ambient: [0.1, 0.105, 0.14], moon: [0.22, 0.24, 0.32] },
  },

  fox: {
    calm: 'moonlit',
    spells: {
      moonlit: { hold: [50, 90], fade: [25, 40], next: [['cloud', 3], ['groundmist', 2]], mist: 0.3 },
      cloud: { hold: [8, 20], fade: [20, 35], next: [['moonlit', 1]], mist: 0.3, moon: 0.75, ambient: 0.82 },
      groundmist: { hold: [45, 80], fade: [30, 45], next: [['moonlit', 1]], mist: 0.3, foot: 1, fogNear: 0.9, fogColor: 2.5 },
    },
    mist: {
      bank: { ...BANK, color: [0.4, 0.44, 0.55] },
      bands: [
        { key: 'mist', r: [24, 44], y: [0.5, 1.2], veil: 0 },
        // the terrace's foot, never on the paving (r 14) nor its steps
        { key: 'foot', r: [17, 24], y: [0.45, 1.2], veil: 0 },
      ],
      drift: [0.4, 0], carry: 0.35, view: [20, 12, -4],
    },
  },

  // the Last Foundry: sparks off the furnace and the pour carried across the floor in a loose faint
  // stream of tiny dots (a few brighter), and now and then the smoke hangs thicker (a grey-out); the set's
  // ambience writes the light every frame (sky false: the light by his phase is the set's)
  foundry: {
    calm: 'still',
    sky: false,
    firstHold: [6, 10],
    spells: {
      still: { hold: [35, 60], fade: [15, 25], next: [['sparks', 3], ['smoke', 2]], embers: 0.35 },
      sparks: { hold: [14, 24], fade: [10, 16], next: [['still', 1]], windK: 1.3, embers: 1 },
      smoke: { hold: [30, 50], fade: [20, 30], next: [['still', 1]], embers: 0.3, grey: 1 },
    },
    embers: {
      rate: 22, upwind: [4, 18], band: 7, wander: [6, 0.11], y: [0.4, 2.2], carry: 1.4, drift: [0, -2.2], min: 2.5,
      rise: [0.4, 1.0], gravity: -0.04, drag: 0.04, life: [6, 9], size: 0.28, sizeEnd: 0.2,
      color: [0.95, 0.34, 0.06], colorEnd: [0.3, 0.06, 0.01], flicker: 0.4, glyph: "..'.",
      bright: 0.18, brightColor: [2.3, 0.95, 0.2],
    },
    grey: {
      rate: 14, area: [46, 34], y: [1.5, 8], fall: [0.15, 0.3], carry: 0.3, drift: [0, -0.3], life: [8, 12],
      size: 0.26, color: [0.3, 0.27, 0.25], colorEnd: [0.14, 0.12, 0.11], alpha: 0.38, glyph: ".,'`",
    },
  },

  grove: {
    calm: 'still',
    spells: {
      still: { hold: [50, 85], fade: [35, 50], next: [['mist', 3], ['snow', 2]], mist: 0.3, snow: 0.3 },
      mist: { hold: [50, 80], fade: [35, 50], next: [['still', 1]], mist: 1, snow: 0.3, fogNear: 0.85, fogFar: 0.94, fogColor: 3 },
      snow: { hold: [60, 100], fade: [30, 40], next: [['still', 1]], option: 'c', mist: 0.3, snow: 1, moon: 0.94 },
    },
    // the mist pools low between the canes and does not drift (no wind here)
    mist: {
      bank: { ...BANK, color: [0.38, 0.46, 0.44], spread: [2.6, 1.6], per: [110, 150], stream: 0.2, grow: 0.1, wobble: 0.04 },
      bands: [{ key: 'mist', r: [6.5, 24], y: [0.15, 0.6], veil: 0 }],
      drift: [0, 0], carry: 0, view: [20, 12, -4],
    },
    // option c: snow straight down, slow, sparse
    snow: {
      option: 'c', rate: 40, area: [36, 28], y: [5, 9], fall: [0.5, 0.75], carry: 0, drift: [0, 0],
      size: 0.28, color: [0.7, 0.72, 0.8], alpha: 0.36, alphaEnd: 0.26, glyph: ".'.*..'", spin: 0.8,
    },
  },
});
