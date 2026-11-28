import { COURTYARD } from '../courtyard.js';
import { THRONE } from '../throneHall.js';
import { RING } from '../skybreakRing.js';
import { GROVE } from '../windlessGrove.js';
import { CROSSING } from '../veiledCrossing.js';
import { FOUNDRY } from '../lastFoundry.js';

// THE STEPS' numbers (steps.js reads them): what the ground is where, and how each surface answers a
// foot. Every per-level choice is a block under `levels`; a level without one gets `fallback`.
//
// surfaceAt(x, z) asks, in this order (the first that answers wins):
//   1. `over`   shapes that win over everything (the courtyard's ash lies on its paving; the crater's
//               obsidian; the ring's tiles)
//   2. a slab   inside one of the set's slab outlines (paving, flagstones, steps, plates): `slab`
//   3. `areas`  shapes under the slabs (the grove's packed earth round its paving)
//   4. grass    the meadow's density (world.fire.density) at least `grassMin`: `grass`
//   5. `ground` what is left
// A shape: { disc: r, x?, z?, surface } (round (x, z), default the origin) | { square: half, surface }
// | { ring: [r0, r1], surface }.

const freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v);
  return Object.freeze(o);
};

export const STEPS = freeze({
  /** the surface map's cache: one byte per `cell` m over `extent` m round the origin (filled as asked) */
  cell: 0.5,
  extent: 160,
  /** the meadow's density from which a foot is in grass */
  grassMin: 0.3,
  /** m: a point this close (diagonally) to a slab is on it (the joints between slabs are floor too) */
  joint: 0.18,

  levels: {
    // a moonlit clearing: grass all round, the 26 flagstones tap, the nest and the bonfire are bare earth
    cinderwood: { slab: 'stone', grass: 'grass', ground: 'earth' },
    // the burned sect: ash lies over the yard's paving and wins there (the prints are the level's
    // answer; the sound keeps a faint stone tap under the puff). The steps and the path are stone,
    // the burnt hillside's grey grass and earth are ash
    ash: { over: [{ square: COURTYARD.half, surface: 'ash' }], slab: 'stone', grass: 'ash', ground: 'ash' },
    // the crater: obsidian plates to its rim; the path's flagstones; grey tufts, dark earth beyond
    starless: { over: [{ disc: THRONE.R, surface: 'obsidian' }], slab: 'stone', grass: 'grass', ground: 'earth' },
    // the ring's sandstone tiles; the lake bed's clay plates and the badlands round them: dry ground
    // that gives a puff the wind carries off
    ring: { over: [{ square: RING.half, surface: 'stone' }], slab: 'sand', grass: 'grass', ground: 'sand' },
    // the hill shrine: paving taps; where a slab is missing, earth; grass off it
    fox: { slab: 'stone', grass: 'grass', ground: 'earth' },
    // the bamboo grove: the paving round the grave, packed earth to the clearing's edge, a floor of
    // fallen bamboo leaves beyond it (the stepping stones are slabs)
    grove: { areas: [{ disc: GROVE.clearR, surface: 'earth' }], slab: 'stone', grass: 'leaf', ground: 'leaf' },
    // the Veiled Crossing: the asphalt, its painted bars and the corners' kerbs are slabs (stone taps);
    // where a slab is gone, and past the floor, rubble and ash (a gritty scuff)
    veil: { slab: 'stone', grass: 'ash', ground: 'ash', areas: [{ square: CROSSING.outer, surface: 'ash' }] },
    // the Last Foundry: the casting floor's steel plates and the path's plates tap (stone's tick); where a
    // plate is gone, and off the floor, cinder and slag (an ash puff, a print that fills in)
    foundry: { slab: 'stone', grass: 'ash', ground: 'ash', areas: [{ square: FOUNDRY.half, surface: 'ash' }] },
  },
  fallback: { slab: 'stone', grass: 'grass', ground: 'earth' },

  /** the trodden grass (scorch.trample: the scorch map's blue channel) */
  trample: {
    /** s for a fully trodden blade to stand up again (linear) */
    decay: 10,
    /** a step's disc (m) and how deeply it treads (0..1); a sprint; a heavy landing (a run leaves a
     *  trail ~1.3 m wide: a narrower one is lost among the blades at the game camera) */
    r: 0.7, k: 1,
    rSprint: 0.85, kSprint: 1,
    rHeavy: 1.2, kHeavy: 1,
    /** at most this many cells trodden at once (the oldest stand up first when full) */
    maxCells: 2048,
  },

  /**
   * The flash print (the default with the dragon print; `?prints=0` the prints before). The owner (2026-11-24):
   * the ash's footprints were "very ugly ... and they last too long. make it more like cool subtle matrix
   * flash footprints that look cool on spawn and fade away quickly"; picked matrix green. A print is `n`
   * code letters (the code rain's own, GRASS.spray.code) laid in the foot's oval (`foot`: long, wide, m),
   * lit heel to toe `cascade` s apart: each flashes `hot` (white-green) for `hotT` s, cools to `color`,
   * re-rolls its letter every `flicker` s and is gone `life` s after it lit (dimming to `colorEnd`).
   * On every surface in every level (the owner, 2026-11-25: "have the footprints show in every stage"); the
   * grass's wake and the puffs are not changed.
   */
  flash: {
    glyphs: '0123456789ZTHKEX<>=:+*',
    n: [4, 6],
    foot: [0.36, 0.15],
    /** on a dragon-printed floor (render/dragonStep.js) the oval of the floor's cells that flash (long, wide, m:
     *  the floor's cells are 0.135 x 0.25 m, so a print is a few cells, not one) */
    cells: [0.62, 0.46],
    size: 0.2,
    cascade: 0.018,
    life: 0.75,
    hotT: 0.12,
    hot: [0.75, 1.35, 0.8],
    color: [0.16, 0.6, 0.26],
    colorEnd: [0.015, 0.06, 0.025],
    flicker: 0.07,
    alpha: 0.85,
  },

  /** the prints (an own pool, `max` x the quality) */
  prints: {
    max: 120,
    /** s between two refreshes of the batch (the fade steps at this rate: far below what the eye sees) */
    refresh: 0.1,
    y: 0.1,
    /** the batch's soft depth (m): low, so a mark on the floor is not faded into it */
    soft: 0.08,
  },

  /**
   * How each surface answers. Counts are letters per step at a run / a sprint / a heavy landing
   * (scaled by the quality and, in the fight, by 0.5 + 0.5 calm). Colours are linear, dim.
   */
  surfaces: {
    grass: {
      // torn blade bits on a sprint (player/fx.js COL.grassBit), and the trample
      bits: { run: 0, sprint: 1.5, heavy: 4, glyph: "/\\',", color: [0.16, 0.26, 0.12], colorEnd: [0.05, 0.09, 0.04], y: [0.15, 0.3], size: [0.15, 0.22], up: [1.0, 1.8], out: [0.5, 1.2], life: [0.35, 0.6], gravity: -6, drag: 2.2, alpha: 0.8 },
      trample: true,
    },
    earth: {
      // a small low dust puff (the hero's own dust, smaller)
      puff: { run: 1.5, sprint: 2.5, heavy: 6, glyph: '.,:', color: [0.2, 0.18, 0.14], colorEnd: [0.09, 0.08, 0.065], y: [0.15, 0.3], size: [0.18, 0.26], sizeEnd: [0.32, 0.45], up: [0.15, 0.45], out: [0.35, 0.9], life: [0.45, 0.75], gravity: -0.6, drag: 3, alpha: 0.7 },
      print: { life: 5, glyph: '0', size: 0.2, stretch: 0.3, color: [0.1, 0.085, 0.065], alpha: 0.75, hold: 1.6 },
    },
    stone: {
      // a tiny grit puff on a sprint or a landing only
      puff: { run: 0, sprint: 1, heavy: 4, glyph: '.,', color: [0.18, 0.17, 0.15], colorEnd: [0.08, 0.075, 0.07], y: [0.15, 0.3], size: [0.14, 0.2], sizeEnd: [0.22, 0.3], up: [0.2, 0.5], out: [0.3, 0.8], life: [0.3, 0.5], gravity: -1.5, drag: 3, alpha: 0.65 },
    },
    sand: {
      // dry clay and grit: a puff on every step that the wind carries off (`wind`: the share of the
      // air's velocity it takes)
      puff: { run: 1, sprint: 2, heavy: 5, glyph: '.,:', color: [0.55, 0.46, 0.33], colorEnd: [0.3, 0.25, 0.18], y: [0.18, 0.35], size: [0.22, 0.3], sizeEnd: [0.42, 0.56], up: [0.2, 0.5], out: [0.25, 0.7], life: [0.9, 1.4], gravity: -0.2, drag: 0.9, alpha: 0.65, wind: 0.8 },
    },
    ash: {
      // a soft grey puff every step: it hangs a moment, then sinks; and a print that fills in
      puff: { run: 2.5, sprint: 3.5, heavy: 8, glyph: '.,:', color: [0.22, 0.215, 0.21], colorEnd: [0.1, 0.098, 0.095], y: [0.2, 0.4], size: [0.2, 0.28], sizeEnd: [0.36, 0.5], up: [0.25, 0.6], out: [0.3, 0.8], life: [0.8, 1.2], gravity: -0.35, drag: 3.2, alpha: 0.7, wind: 0.3 },
      print: { life: 14, glyph: '0', size: 0.3, stretch: 0.35, color: [0.09, 0.09, 0.095], alpha: 0.95, hold: 2.2 },
    },
    obsidian: {
      // no dust: a dim red glint, one or two letters, gone in under a second
      // (a mark of the prints' batch: it lies on the floor)
      glint: { run: 1.5, sprint: 2, heavy: 4, glyph: "'`*", color: [1.25, 0.24, 0.09], size: 0.26, life: 0.75, alpha: 0.9, hold: 0.6 },
    },
    leaf: {
      // a fallen leaf or two flicked aside (the litter's own leaves are asked to scatter too)
      flick: { run: 1, sprint: 1.5, heavy: 4, glyph: ",'`", color: [0.12, 0.13, 0.07], colorEnd: [0.06, 0.065, 0.035], y: [0.15, 0.3], size: [0.15, 0.22], up: [0.6, 1.2], out: [0.6, 1.3], life: [0.4, 0.65], gravity: -4, drag: 2.5, alpha: 0.75 },
    },
  },

  /** the litter is asked to move what lies under a foot (r m, k), on every surface; a heavy landing more */
  scatter: { r: 0.5, k: 0.25, rHeavy: 1.4, kHeavy: 0.7 },

  /** wet ground (weather.wet over `min`): a tiny splash of two or three dim letters */
  splash: { min: 0.3, run: 2, sprint: 3, heavy: 5, glyph: "'.", color: [0.16, 0.18, 0.22], colorEnd: [0.06, 0.07, 0.09], y: [0.1, 0.2], size: [0.1, 0.14], up: [0.8, 1.4], out: [0.4, 0.9], life: [0.22, 0.32], gravity: -9, drag: 1.5, alpha: 0.6 },

  /** per-level changes to a surface's answer: `perLevel[level][surface][part]` replaces that part
   *  (null: the part is left out) */
  perLevel: {
    // the grove holds its breath: packed earth gives a soft step and no dust cloud
    grove: { earth: { puff: null } },
  },
});
