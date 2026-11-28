// THE ANSWER's numbers (answer.js): how the world answers the fight. One block per level id; a level
// without one gets DEFAULT. Every strength is multiplied by life.k; every radius is in metres.
//
//   gap.*        s: the least time between two answers of that kind (fifty call sites must not spam it)
//   roar         dragon:roar {strength}: a gust front from the boss toward the hero, every creature in
//                the arena flees, what lies near the boss is thrown
//   wake         dragon:wake: the level notices him (a smaller front, a startle)
//   blow         dragon:land / dragon:explosion / player:slam / player:plungeHit: what lies round the
//                point is thrown and what lives near it flees (the radial air push itself already comes
//                through world.gust → life.gust → wind.burst)
//   hush         combat:tell red / black, combat:charge: the world holds its breath until the blow lands
//   phase        a new form: a hush first, then one long front
//   lull         dragon:dead / game:victory: the wind drops to nothing, then the breeze returns
//   died         player:died: a hush
//   gust         life.gust: a burst this strong startles the creatures within its radius

const DEFAULT = {
  gap: { roar: 1.5, wake: 4, blow: 0.25, hush: 2.5, phase: 4, lull: 6, died: 3, gust: 0.3 },
  roar: { front: { strength: 2.4, speed: 15, width: 11 }, startleR: 70, startleK: 1, scatterR: 12, scatterK: 1.2 },
  wake: { front: { strength: 0.8, speed: 9, width: 7 }, startleR: 40, startleK: 0.5, scatterR: 0, scatterK: 0 },
  blow: { scatterR: 4, scatterK: 0.8, startleR: 12, startleK: 0.7, radiusK: 1.3, maxR: 12 },
  hush: { minSec: 0.3, maxSec: 2.5, k: 0.85, chargeK: 0.7 },
  phase: { hushSec: 1, hushK: 1, front: { strength: 1.3, speed: 7, width: 22 }, startleR: 70, startleK: 1 },
  lull: { sec: 4, k: 1 },
  died: { sec: 2.5, k: 0.8 },
  gust: { minStrength: 1.2, startleK: 0.8 },
};

const level = (o = {}) => Object.freeze({ ...DEFAULT, ...o });

export const ANSWER_TUNING = Object.freeze({
  DEFAULT: level(),
  cinderwood: level(),
  // a dry, fitful wind: the roar drags the ash low and far
  ash: level({ roar: { ...DEFAULT.roar, front: { strength: 2.2, speed: 16, width: 8 }, scatterR: 11 } }),
  // the crater: almost nothing moves, so what does is a draw, slow and wide
  starless: level({
    roar: { ...DEFAULT.roar, front: { strength: 1.2, speed: 10, width: 14 } },
    wake: { ...DEFAULT.wake, front: { strength: 0.6, speed: 6, width: 10 } },
  }),
  // the plateau: a strong wind already blows; the answer must cut through it
  ring: level({ roar: { ...DEFAULT.roar, front: { strength: 1.8, speed: 17, width: 9 } } }),
  fox: level(),
  // the Windless Grove: the fight is the only thing that ever moves the air here. The fronts are the
  // same; the hush is deeper and longer (there is no breeze to come back, only the bamboo settling)
  // the Veiled Crossing: the defaults (a blow's breath across the rubble)
  veil: level(),
  // the Last Foundry: the furnace's draw is already moving the air; the answer runs a little harder
  foundry: level({ roar: { ...DEFAULT.roar, front: { strength: 2.8, speed: 15, width: 11 } } }),
  grove: level({
    roar: { ...DEFAULT.roar, front: { strength: 1.4, speed: 12, width: 8 } },
    wake: { ...DEFAULT.wake, front: { strength: 0.5, speed: 7, width: 6 } },
    lull: { sec: 6, k: 1 },
  }),
});

export const answerTuning = (id) => ANSWER_TUNING[id] ?? ANSWER_TUNING.DEFAULT;
