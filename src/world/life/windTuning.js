// The wind's numbers (world/life/wind.js), one block per level. Speeds in m/s, times in s, angles in
// degrees (0 = toward +x, 90 = toward +z: the game camera looks toward -z, so 0 blows left to right
// across the screen, where a lean reads best).
//
//   dir, wander      the prevailing direction and how far it wanders (slowly, two incommensurate sines)
//   speed            the prevailing speed at the top of a breath
//   breath           how it breathes: `floor` (0..1 of `speed` at the bottom of a breath), `periods` (two
//                    sines, s), `pause` (0..1: the bottom of the breath is held still: the fox's sighs),
//                    `fit` (0..1: a fast restless part on top: the ash's fitful wind)
//   fronts           gust fronts: `every` [min, max] s apart, `strength` [min, max] (1 = an ordinary gust),
//                    `speed` [min, max] m/s they travel, `tail` [min, max] m behind the edge, `lead` m
//                    ahead of it, `air` m/s of wind a strength-1 front adds, `spread` deg off the
//                    prevailing, `from` / `to` m upwind / downwind of the camera's focus where one is born
//                    and dies
//   sink             (the Obsidian Throne) the air is drawn toward a point instead: { x, z, radius }
//   wisps            the air drawn in letters: clumps of many tiny faint letters (the house letter's size)
//                    that ride the air low over the ground, stretch, curl and come apart. `max` clumps at
//                    once (x quality), `per` [min, max] letters each (a breeze's wisp has `calmPer` of
//                    them), `rate` born a second in view in the breeze at its top speed, `gust` a second
//                    per strength-1 front passing the view, `life` [s, s], `len` [m, m] along the air at
//                    birth (x `gustLen` for a front's), `width` [m, m] across, `stretch` / `spread` how
//                    much longer / wider by its end, `flow` m/s each letter runs ahead of or behind the
//                    clump, `curl` m its axis bends, `wave` rad/m of that bend, `y` [m, m] over the
//                    ground, `rise` m of a letter's own height, `carry` of the air's speed, `ease` s to
//                    answer the air, `view` [half width, near, far] m round the focus where one is born,
//                    `size` m (one letter: ~0.3 m is the house letter at the game camera), `alpha` a
//                    letter's most, `color` (linear, dim), `glyph` (the thinnest characters),
//                    `heroClear` [m, m] letters fade out this near the hero
//   grass            how the meadow answers (the shader, uWindFronts[10]): `lean` (the prevailing lean, x
//                    the blade's height at a strong wind), `wave` (the travelling patches on top of it),
//                    `front` (how far a passing front stirs a blade), `patch` (0..1: how far that stir is
//                    broken into loose local patches instead of the front's whole band)
//   trees            how the canopy answers (uWindFronts[11]): `lean`, `rock` (the sway on top of it),
//                    `front`, `stir` (the crosswise flutter as a front passes), metres at aSway 1
//   loud             m/s of air (prevailing + a front at the focus) that is `level` 1 (the air's sound)
//   fire             how the fire field's smoke and flames ride the wind: acceleration = wind x this

const BASE = {
  dir: 0, wander: 8, speed: 1.4,
  breath: { floor: 0.55, periods: [11, 29], pause: 0, fit: 0 },
  // (a front crosses the ~30 m of ground the game camera sees in 3.5 - 4.5 s: a band with a sharp edge)
  fronts: { every: [9, 15], strength: [0.9, 1.2], speed: [7, 8.5], tail: [4.5, 6.5], lead: 0.9, air: 2.2, spread: 10, from: 40, to: 50 },
  sink: null,
  // wisps of tiny faint letters riding the air: a few in the breeze, more where a front passes
  wisps: {
    max: 10, per: [64, 96], calmPer: 0.65, rate: 0.6, gust: 3.2, life: [5, 8], len: [1.8, 3], gustLen: 1.35,
    width: [0.16, 0.34], stretch: 0.9, spread: 0.8, flow: 0.28, curl: 0.3, wave: 0.9, y: [0.45, 1.3], rise: 0.12,
    carry: 1, ease: 0.9, view: [19, -13, 9], size: 0.34, alpha: 0.4, color: [0.62, 0.7, 0.68],
    glyph: "-~.,'`-.~-,:", heroClear: [0.6, 1.8],
  },
  grass: { lean: 0.16, wave: 0.2, front: 0.24, patch: 1 },
  trees: { lean: 0.3, rock: 0.25, front: 0.28, stir: 0.08 },
  loud: 4,
  fire: { smoke: 0.5, flame: 0.55 },
};

const level = (o) => Object.freeze({
  ...BASE, ...o,
  breath: Object.freeze({ ...BASE.breath, ...o.breath }),
  fronts: o.fronts === null ? null : Object.freeze({ ...BASE.fronts, ...o.fronts }),
  wisps: o.wisps === null ? null : Object.freeze({ ...BASE.wisps, ...o.wisps }),
  grass: Object.freeze({ ...BASE.grass, ...o.grass }),
  trees: Object.freeze({ ...BASE.trees, ...o.trees }),
  fire: Object.freeze({ ...BASE.fire, ...o.fire }),
  sink: o.sink ? Object.freeze({ ...o.sink }) : null,
});

export const WIND_TUNE = Object.freeze({
  /** a moonlit clearing: a night breeze in slow breaths; a front every 8 - 14 s crosses the meadow */
  cinderwood: level({
    dir: -18, speed: 1.5,
    breath: { floor: 0.5, periods: [12, 31] },
    fronts: { every: [8, 14] },
  }),
  /** the burned sect: dry and fitful; gusts drag low across the paving */
  ash: level({
    dir: -8, wander: 14, speed: 1.6,
    breath: { floor: 0.35, periods: [7, 17], fit: 0.45 },
    fronts: { every: [6, 11], strength: [0.8, 1.25], speed: [8, 9.5], tail: [3.5, 5.5], lead: 0.8, spread: 16 },
    wisps: { color: [0.52, 0.5, 0.47], rate: 0.7, gust: 3.4 },
    grass: { lean: 0.12, wave: 0.24, front: 0.22 },
  }),
  /** the crater of the fallen star: no weather wind, a slow draw of the air toward the star, breathing */
  starless: level({
    dir: -90, wander: 0, speed: 0.45,
    breath: { floor: 0.15, periods: [9, 9], pause: 0.2 },
    fronts: null,
    sink: { x: 0, z: -21.4, radius: 60 },
    wisps: null,
    grass: { lean: 0.1, wave: 0.05, front: 0 },
    trees: { lean: 0.05, rock: 0.02 },
    loud: 3,
  }),
  /** high badlands at dusk: a steady strong plateau wind from the west (toward +x), few lulls */
  ring: level({
    dir: 0, wander: 5, speed: 3.2,
    breath: { floor: 0.78, periods: [14, 37] },
    fronts: { every: [5, 9], strength: [0.8, 1.1], speed: [9, 10.5], tail: [5, 8], lead: 1.0, air: 2.6, spread: 6 },
    wisps: { color: [0.58, 0.5, 0.39], rate: 0.8, gust: 3.2 },
    grass: { lean: 0.2, wave: 0.16, front: 0.22 },
    loud: 6,
  }),
  /** the hill shrine: a soft breeze that comes in sighs, with real pauses between */
  fox: level({
    dir: -25, wander: 10, speed: 1.3,
    breath: { floor: 0.05, periods: [10, 23], pause: 0.38 },
    fronts: { every: [11, 18], strength: [0.8, 1.05], speed: [6.5, 7.5], tail: [5, 7] },
    wisps: { color: [0.54, 0.58, 0.66], rate: 0.45 },
  }),
  /** the Windless Grove: none. The grove holds its breath (wind.still) */
  grove: level({ speed: 0, wander: 0, fronts: null, still: true, wisps: null }),
  /** the Veiled Crossing: a low cold moan along the streets under the veil, slow breaths, few fronts
   *  (east to west down the street); the wisps grey with ash */
  veil: level({
    dir: 180, wander: 7, speed: 1.1,
    breath: { floor: 0.4, periods: [15, 37] },
    fronts: { every: [16, 26], strength: [0.7, 0.95], speed: [6, 7.5], tail: [5, 7.5], spread: 8 },
    wisps: { color: [0.46, 0.47, 0.52], rate: 0.35, gust: 2.4, alpha: 0.34 },
    loud: 3.5,
  }),
  /** the Last Foundry: the furnace draws the night air in across the casting floor from the south (toward
   *  -z), in long breaths, a front now and then off the broken walls; the wisps are steam and smoke,
   *  grey with a warm cast; the fire field's smoke and flames lean hard on it */
  foundry: level({
    dir: -100, wander: 9, speed: 1.3,
    breath: { floor: 0.45, periods: [13, 31] },
    fronts: { every: [12, 20], strength: [0.75, 1.05], speed: [6.5, 8], tail: [4.5, 6.5], spread: 14 },
    wisps: { color: [0.5, 0.46, 0.43], rate: 0.45, gust: 2.6, alpha: 0.32 },
    grass: { lean: 0.12, wave: 0.12, front: 0.2 },
    loud: 4,
    fire: { smoke: 0.6, flame: 0.45 },
  }),
});

/** a level without a block: a quiet breeze, no fronts */
export const WIND_DEFAULT = level({ speed: 0.8, fronts: null, wisps: null });

/** s a lull (the Lab's button) holds the air still, and how it eases in and out */
export const WIND_LULL = Object.freeze({ hold: 6, ease: 1.2 });

/** a radial burst (life.gust): the ring's speed (radius per s), how long it lives, the air it pushes */
export const WIND_BURST = Object.freeze({ life: 1.6, grow: 1.1, width: 0.45, air: 4 });

/** life.hush (the world holds its breath): the prevailing speed falls by `speed` x hush, and no new
 *  front is born while it holds (the level's own fronts already crossing fade by it; a front born at a point, a roar's, goes on: it is the blow itself) */
export const WIND_HUSH = Object.freeze({ speed: 0.85 });
