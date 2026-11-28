// THE AFTERMATH's numbers (aftermath.js): what a fight leaves in the air. One block per level id; a
// level without one gets DEFAULT. Counts at life.quality 1 (x quality on the phone); m, s, m/s.
// Everything is tiny faint letters clumped into a shape (the house letter, LetterBatch): never a grey
// sprite, never bright. It thins by TIME (the fight is when it is made), not by life.calm.
//
//   smoke    a slow column of letters rising where fire landed, once its flames are out:
//            max        columns at once (x quality, at least 2; the newest win)
//            merge      m: fire landing within this of a column feeds that column (a breath lands
//                       along its whole cone: a few columns, not hundreds)
//            wait       s after the last fire landed before it starts (the flames' own smoke first)
//            life       [s, s] how long it smokes (it thins over that: fewer letters, fainter)
//            per        letters a column (x quality)
//            height     [m, m] how high it rises before it is gone (x its strength)
//            rise       m/s it rises
//            spread     m: its width at the foot, `grow` more at the top
//            carry      how much of the wind's speed it takes as it rises (it leans: the lean at a
//                       height is the wind x the time it took to get there), at most `lean` m
//            curl       m of slow sideways curl, growing with height
//            minBurn    the scorch map's char under it must be at least this (fire that left no mark: no smoke)
//            color / alpha   dim, faint
//   embers   a few sparks lifting off the hot part of the burn, carried on the wind, dying as they go
//            (rate per column a second while its first `hot` share of its life lasts)
//   dust     a low haze of pale letters hanging over a crater after a big blow (impact power >= min):
//            max, merge, life [s, s], per (x min(2, power / min)), r (x the crater's radius:
//            1.2 + 1.1 power, at most the blow's reach), y [m, m] (densest low), carry (it drifts off
//            downwind), grow (it spreads as it goes), cycle [s, s] (each letter comes and goes on its own)
//   heroClear  [m, m]: letters fade out within this of the hero (never in his way)
//   glyph    the letters

const DEFAULT = {
  smoke: {
    max: 5, merge: 3, wait: 1.6, life: [20, 40], per: 130, height: [2.4, 3.4], rise: [0.4, 0.6],
    spread: 0.28, grow: 0.6, carry: 0.35, lean: 1.8, curl: 0.3, minBurn: 0.05,
    color: [0.44, 0.44, 0.47], alpha: 0.72, fadeIn: 3,
  },
  embers: { rate: 1.4, hot: 0.35, life: [1.8, 3.4], rise: [0.25, 0.6], carry: 0.7, color: [0.78, 0.26, 0.06], colorEnd: [0.22, 0.04, 0.01], flicker: 0.45, max: 48 },
  dust: {
    min: 1.2, max: 3, merge: 3, life: [6, 10], per: 90, r: 1.1, y: [0.12, 1.1], carry: 0.32, grow: 0.7, cycle: [2.2, 4.5],
    color: [0.52, 0.48, 0.42], alpha: 0.5, fadeIn: 0.8,
  },
  heroClear: [0.5, 1.4],
  glyph: { smoke: ".,'`:~-.'", dust: ".,'`-.:.", ember: ".'." },
};

const level = (o = {}) => Object.freeze({ ...DEFAULT, ...o });

export const AFTERMATH_TUNING = Object.freeze({
  DEFAULT: level(),
  cinderwood: level(),
  // the burned sect: grey ash-dust, the smoke a shade warmer
  ash: level({ dust: { ...DEFAULT.dust, color: [0.42, 0.41, 0.39] }, smoke: { ...DEFAULT.smoke, color: [0.46, 0.45, 0.44] } }),
  // the crater: what hangs is dark, red-grey; smoke drawn slowly toward the star by the air
  starless: level({ dust: { ...DEFAULT.dust, color: [0.42, 0.3, 0.28], alpha: 0.46 }, smoke: { ...DEFAULT.smoke, color: [0.4, 0.36, 0.37] } }),
  // the badlands: ochre dust; the plateau wind takes smoke away fast (a shorter, leaning column)
  ring: level({
    dust: { ...DEFAULT.dust, color: [0.55, 0.47, 0.35], carry: 0.38 },
    smoke: { ...DEFAULT.smoke, life: [16, 28], height: [2, 2.8], lean: 2.4 },
  }),
  fox: level({ dust: { ...DEFAULT.dust, color: [0.44, 0.42, 0.39] } }),
  // the grove: no wind; smoke rises straight and the haze hangs where it is
  grove: level({ dust: { ...DEFAULT.dust, color: [0.4, 0.42, 0.37] } }),
  // the Veiled Crossing: concrete dust, ash-grey; the smoke of burning wrecks a little bluer
  veil: level({ dust: { ...DEFAULT.dust, color: [0.44, 0.44, 0.46] }, smoke: { ...DEFAULT.smoke, color: [0.4, 0.41, 0.45] } }),
  // the Last Foundry: scale and slag dust, rust-grey; the smoke of hot metal warmer and darker
  foundry: level({ dust: { ...DEFAULT.dust, color: [0.42, 0.38, 0.34] }, smoke: { ...DEFAULT.smoke, color: [0.36, 0.33, 0.32] }, embers: { ...DEFAULT.embers, rate: 2.2, color: [0.95, 0.34, 0.06] } }),
  // (code, city: the defaults; no living-world tuning of their own yet)
});

export const aftermathTuning = (id) => AFTERMATH_TUNING[id] ?? AFTERMATH_TUNING.DEFAULT;
