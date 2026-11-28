// The Mixamo hero trial's data (ADR-294): which body, which clip plays each of the hero's moves, and
// where each swing's clip cuts. Clips are Mixamo's "Great Sword Pack" (scripts/mixamo/clips.json
// names the source of every key; scripts/mixamo/convert.py builds the GLBs in assets/models/).
//
// `?hero=mixamo`: the Ninja body from Mixamo, wearing his head, hair, shoulder plate, coat and sword
// `?hero=mixrig`: his own mesh, auto-rigged on Mixamo (every part keeps its letters)
// (no `?hero=`: today's hero, nothing here loads)

export const MIX_FPS = 30;

export const MIX_BODIES = {
  mixamo: { file: 'assets/models/hero-mixamo.glb', fit: 'hips', gear: true },
  mixrig: { file: 'assets/models/hero-mixrig.glb', fit: 'box', gear: false },
};

/** `?hero=mixamo|mixrig` -> that id, else null (today's hero). */
export function mixHeroMode() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('hero');
  return Object.hasOwn(MIX_BODIES, q) ? q : null;
}

// Every swing's clip, in frames at 30 fps: from `start` the body winds up to the cut at `contact`
// (the blade's fastest frame, measured in Blender and checked on the contact sheets) and follows
// through to `end`. The game's own timing is kept: start -> contact runs over the windup and half of
// the active window, contact -> end over the rest of it and the recovery.
export const MIX_SWING = {
  slash1: { start: 8, contact: 19, end: 38 }, // a level cut, wound up over the shoulder
  slash2: { start: 16, contact: 30, end: 50 }, // a falling diagonal
  slash3: { start: 15, contact: 23, end: 40 }, // a rising cut out of a turn
  slash4: { start: 0, contact: 5, end: 30 }, // a short thrust
  slash5: { start: 62, contact: 78, end: 100 }, // the last blow of a long string: the finisher
  spin: { start: 6, contact: 13, end: 45 }, // the whirl
  heavy: { start: 20, contact: 36, end: 60 }, // a leaping overhead slam
  slide: { start: 30, contact: 42, end: 60 }, // a sliding lunge
};

// The light combo's five blows by their place in the string (def.combo 1..5).
export const MIX_LIGHT = ['slash1', 'slash2', 'slash3', 'slash4', 'slash5'];

// A swing whose name says what it is takes its own clip, whatever its place.
export const MIX_BY_NAME = [
  [/whirl|tempest|spin/i, 'spin'],
  [/slam|crush/i, 'heavy'],
  [/gale|lunge|dash|sprint|thrust|pierc/i, 'slide'],
  [/rising|crescent/i, 'slash3'],
];

// Ground speed (m/s) each loop covers at its own pace, at the model's scale 1 (the root motion the
// clips had before it was stripped): the loops are played at the hero's real speed over this.
export const MIX_LOOP_SPEED = { walk: 0.93, run: 3.63, back: 2.35, strafeL: 2.0, strafeR: 2.7 };

// Moves that are not swings: which clip, and how its time runs.
//   loop: plays at its own pace, looping
//   over: s -> the whole clip [from, to] (frames) is stretched over that long, then holds
//   bounce: [to, over] -> to frame `to` and back over `over` seconds
export const MIX_MOVES = {
  block: { clip: 'block', loop: true },
  parry: { clip: 'parry', over: 0.22, from: 0, to: 15 },
  mikiri: { clip: 'parry', over: 0.22, from: 0, to: 15 },
  charge: { clip: 'charge', loop: true },
  stagger: { clip: 'stagger', over: 0.5, from: 0, to: 31 },
  guardBreak: { clip: 'reel', over: 0.9, from: 0, to: 35 },
  bounce: { clip: 'reel', over: 0.45, from: 0, to: 20 },
  knockdown: { clip: 'death2', bounce: [38, 1.4] },
  roll: { clip: 'leap', over: 0.6, from: 0, to: 19 },
  backstep: { clip: 'hop', over: 0.4, from: 0, to: 27 },
  lean: { clip: 'hop', over: 0.42, from: 0, to: 27 },
  ghostep: { clip: 'leap', over: 0.35, from: 0, to: 19 },
  heal: { clip: 'heal', over: 0.85, from: 0, to: 60 },
  victory: { clip: 'heal', over: 2.5, from: 0, to: 91 },
  dead: { clip: 'death', over: 2.0, from: 0, to: 72 },
  dying: { clip: 'death', over: 2.0, from: 0, to: 72 },
  deadDown: { clip: 'death2', over: 2.0, from: 0, to: 72 },
  plunge: { clip: 'heavy', over: 0.7, from: 24, to: 50 },
  flurry: { clip: 'spin', loop: true, rate: 2 },
  iai: { clip: 'slide', over: 0.6, from: 30, to: 60 },
};
