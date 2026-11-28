// The fire field's looks (render/fireField.js, ADR-113): data, not logic. One block per kind of heat.
//
// A heat value h runs from 0 (nothing) through ~0.4 (the cool rim), ~1 (the body) to 2+ (the heart,
// where many blobs overlap). `stops` are the five linear HDR colours the letters take along that
// run (rim, low, body, hot, heart); they are multiplied by `hdr`.
//   hdr    overall brightness. Kept low on purpose: the owner called big bright letters "way too
//          flashy", and above ~1 the bloom swallows the digits.
//   fill   how much of the colour fills the cell behind the letter in the body
//   back   [rim, body] opacity of the dark backing behind each letter (the house style: a dark body
//          with brighter digits; it is what keeps the fire readable over lit grass)
//   lick   how far the heat climbs above its source as tongues (0 = none)
//   erode  how hard noise tears the cool rim into separate tongues (0 = a smooth edge)
//   boil   letter re-rolls per second (each cell on its own beat)
//   warp   how far (in cells) noise pushes the body about
//   haze   (optional) the colour the letters of the world take beside this heat (render/pipeline.js
//          heat haze; read for the void slot only)
// `steel` is the crisp kind (sparks, glints, cuts): no turbulence, and a thin line of it prints as
// the stroke character that runs along it.
export const FIRE_PALETTES = {
  fire: {
    stops: [[0.42, 0.016, 0.0], [1.1, 0.1, 0.006], [1.8, 0.44, 0.025], [2.4, 1.35, 0.2], [3.1, 2.8, 1.9]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 1.0, erode: 1.0, boil: 7, warp: 1.0,
  },
  void: {
    stops: [[0.34, 0.05, 0.8], [0.62, 0.1, 1.45], [1.05, 0.32, 2.05], [1.7, 1.15, 2.7], [2.8, 2.6, 3.2]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 0.6, erode: 1.0, boil: 9, warp: 1.0, haze: [0.62, 0.34, 1.0],
  },
  // GOLD (the Skybreak Ring: Tian Lei's energy). Not a kind of its own: a level swaps the void slot
  // for it (FireField.setPalette('void', FIRE_PALETTES.gold); the Lord's level never does). Energy,
  // not fire: an amber rim (no red in it), a gold body, a pale yellow-white heart; it boils fast and
  // climbs far less than flame (a blast stays a ball, a beam a beam: what rises is made to rise).
  gold: {
    stops: [[0.62, 0.36, 0.035], [1.25, 0.82, 0.1], [1.95, 1.48, 0.3], [2.5, 2.2, 0.85], [3.1, 3.0, 2.3]],
    hdr: 0.6, fill: 0.08, back: [0.45, 0.75], lick: 0.4, erode: 0.6, boil: 11, warp: 0.6, haze: [1.0, 0.78, 0.32],
  },
  // FOXFIRE (the Foxfire Terrace: Wen Yao's Pearl and mantle; ADR-147). Like gold, a swap of the void
  // slot (FoxFx). `foxfire` (?foxfire=a): jade, dark green strokes, jade digits, a pale mint heart (not
  // a cue's red, blue or black, not the wyrm's orange, not the Void's violet). `moon` (?foxfire=c): a
  // cold moon-white. Both climb less than flame and erode a little less (lick 0.5, erode 0.85): the
  // Pearl stays a ball and the mantle's ears and tail keep their shape; the jade heart is kept mint, not
  // white (a white-hot heart read as a plain white light at the game camera).
  foxfire: {
    stops: [[0.02, 0.28, 0.11], [0.07, 0.76, 0.34], [0.22, 1.42, 0.68], [0.6, 2.15, 1.2], [1.5, 3.0, 2.1]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 0.5, erode: 0.85, boil: 9, warp: 0.8, haze: [0.36, 0.95, 0.62],
  },
  moon: {
    stops: [[0.22, 0.26, 0.4], [0.6, 0.68, 0.92], [1.2, 1.3, 1.6], [2.0, 2.1, 2.4], [3.0, 3.05, 3.2]],
    hdr: 0.55, fill: 0.06, back: [0.5, 0.8], lick: 0.5, erode: 0.85, boil: 9, warp: 0.8, haze: [0.7, 0.78, 1.0],
  },
  // CODE (the Hall of Falling Script: Xin Yi's shots, bolts, wakes and fronts; ADR-156). Like gold, a
  // swap of the void slot (WokenFx). The falling script's green: a dark green rim, a jade body, a pale
  // mint-white heart, no red in it; it boils fast and hardly climbs (a slug stays a slug, a ring a ring).
  // Tells keep their own colours: nothing green is ever a cue.
  code: {
    stops: [[0.0, 0.2, 0.05], [0.03, 0.62, 0.14], [0.14, 1.32, 0.34], [0.5, 2.2, 0.8], [1.7, 3.1, 2.0]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 0.3, erode: 0.55, boil: 14, warp: 0.4, haze: [0.3, 0.95, 0.45],
  },
  // PEARL (?foxfire=c, the default since ADR-154): moon's step bluer, so the palm Pearl reads as a pale
  // blue-white orb and not a plain white light: a deep blue rim, sky-blue digits, a near-white heart
  pearl: {
    stops: [[0.08, 0.2, 0.62], [0.24, 0.55, 1.5], [0.6, 1.1, 2.3], [1.3, 1.9, 2.9], [2.6, 2.9, 3.3]],
    hdr: 0.55, fill: 0.06, back: [0.5, 0.8], lick: 0.45, erode: 0.8, boil: 10, warp: 0.8, haze: [0.5, 0.72, 1.0],
  },
  // GLARE (Halcyon Plaza: Halcyon's eyes, his beams, and from his phase 2 every screen; ADR-159). A swap
  // of the void slot, as gold and foxfire (HalFx). `glare` (?glare=a): a deep crimson rim, a crimson
  // body, a white-hot heart (the beam's steel core prints over it); `glareDeep` (?glare=b): crimson all
  // through, its heart a hot pink, never white. Both climb little (a beam stays a beam) and boil fast.
  glare: {
    stops: [[0.42, 0.01, 0.02], [1.25, 0.05, 0.05], [2.1, 0.24, 0.16], [2.8, 1.1, 0.8], [3.2, 2.9, 2.6]],
    hdr: 0.6, fill: 0.08, back: [0.5, 0.8], lick: 0.35, erode: 0.6, boil: 12, warp: 0.5, haze: [1.0, 0.3, 0.26],
  },
  glareDeep: {
    stops: [[0.38, 0.008, 0.015], [1.1, 0.03, 0.04], [1.8, 0.12, 0.1], [2.5, 0.42, 0.34], [3.0, 0.9, 0.8]],
    hdr: 0.6, fill: 0.08, back: [0.5, 0.8], lick: 0.35, erode: 0.6, boil: 12, warp: 0.5, haze: [0.9, 0.2, 0.2],
  },
  // AZURE (the Veiled Crossing: Bai Wuji's blue pull, his eyes from phase 2). A swap of the void slot
  // (untouched/fx.js WjFx: the slot's resting look on that level; it turns to `void`'s violet only for
  // the Null and the realm's edge). A deep ink-blue rim, an electric blue body, a pale ice heart: bluer
  // and harder than `pearl` (a pull that bites, not a moon). It hardly climbs (a knot stays a knot).
  azure: {
    stops: [[0.02, 0.07, 0.62], [0.05, 0.28, 1.6], [0.2, 0.78, 2.5], [0.85, 1.7, 3.0], [2.3, 2.85, 3.3]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 0.3, erode: 0.7, boil: 11, warp: 0.6, haze: [0.34, 0.6, 1.0],
  },
  // CRIMSON (the Veiled Crossing: his red push, Crimson Cast). A swap of the FIRE slot for the length of
  // his fight (WjFx; the engine's fire is back on a reset, his death, before the fight). Its rim keeps the
  // fire's red (the red cues, which print the fire kind at a low heat, read as they always do); the body
  // is crimson, the heart a hot pale rose, never orange or yellow. Climbs half as far as flame (a point
  // stays a point; the bonfire and the lamps, out of the fight's view, still flicker).
  crimson: {
    stops: [[0.44, 0.012, 0.03], [1.3, 0.04, 0.08], [2.2, 0.16, 0.2], [2.85, 0.8, 0.78], [3.2, 2.5, 2.45]],
    hdr: 0.6, fill: 0.08, back: [0.5, 0.8], lick: 0.5, erode: 0.75, boil: 12, warp: 0.6,
  },
  // SAINT (the Last Foundry: the False Saint's jets, charges, lance and the beams' bodies; ADR-285). A swap of
  // the void slot (falseSaint/fx.js FsFx), as gold. INCANDESCENT: jet exhaust and white-hot metal, a dark
  // amber rim, a pale amber-white body, a white heart; paler and whiter than `gold`, never red (the red cues
  // keep the fire kind's red) and never cyan or blue (blue means a parry: nothing of his that signals an
  // attack may be either; his cyan sensors are glyph particles, not heat). The fire slot stays the engine's
  // (molten steel, what burns). It hardly climbs (a jet stays a tongue, a beam a beam) and boils fast.
  saint: {
    stops: [[0.46, 0.2, 0.04], [1.1, 0.58, 0.14], [1.8, 1.36, 0.66], [2.45, 2.2, 1.6], [3.05, 3.0, 2.8]],
    hdr: 0.6, fill: 0.07, back: [0.5, 0.8], lick: 0.35, erode: 0.6, boil: 13, warp: 0.5, haze: [1.0, 0.82, 0.55],
  },
  // FOUNDRY (the Last Foundry: the molten steel of the pour, the ladles and the pools; ADR-285). A swap of
  // the FIRE slot for the level (world/lastFoundry.js, its ambience, once): the cues' red rim kept (a red
  // cue prints the fire kind at a low heat and reads as it always does), an orange body, a heavy
  // yellow-white heart. Molten metal does not climb as flame does: it lies and churns (lick low, slow
  // boil, little erosion), so the pour reads as a surface and a pool as a pool; what burns on the level
  // still flickers, lower.
  foundry: {
    stops: [[0.44, 0.02, 0.0], [1.2, 0.16, 0.01], [2.0, 0.6, 0.05], [2.6, 1.6, 0.36], [3.1, 2.7, 1.5]],
    hdr: 0.6, fill: 0.09, back: [0.5, 0.8], lick: 0.35, erode: 0.45, boil: 4.5, warp: 0.55,
  },
  steel: {
    stops: [[0.5, 0.5, 0.6], [1.2, 1.2, 1.32], [1.9, 1.88, 1.85], [2.7, 2.65, 2.55], [3.5, 3.4, 3.2]],
    hdr: 0.6, fill: 0.06, back: [0.3, 0.55], lick: 0, erode: 0, boil: 12, warp: 0,
  },
};

/** Smoke: dim grey letters where the fire has gone out. */
export const FIRE_SMOKE = { color: [0.085, 0.078, 0.074], back: 0.42 };

/** The kinds a blob can be (FireField.spawn's `kind`): each has its own channel of the heat buffer. */
export const FIRE_KIND = { fire: 0, smoke: 1, void: 2, steel: 3 };
/**
 * Added to a blob's kind: SEEN, drawn over the scene (no soft depth test). For a timing cue only (a
 * boss's white / blue glint, DuelFx._drawGlint): a cue must be seen whatever stands between it and the
 * camera (the wyrm's own paw and wing hid its claw glints; 2026-11-27).
 */
export const FIRE_SEEN = 4;
