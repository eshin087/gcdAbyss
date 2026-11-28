// THE FAUNA'S NUMBERS (world/life/flock.js, animals.js; drawn by creatures.js). Content is data: every
// count, speed, radius, letter and per-level choice lives here. A level without a block has none.
//
// Both are drawn in the house letter (world/life/letterBatch.js: one cell of the wyrm's pixel font per
// letter, whatever its distance), the approved look of the living world: a bird is ONE tiny faint letter
// and the flock is what reads; an animal is two to five letters and its GAIT is what reads. Colours are
// linear and dim. Counts scale by life.quality, speeds by life.k.

/** A flock: the birds hidden in a stretch of canopy that burst out together and wheel away. */
const FLOCK = Object.freeze({
  /** the wing letters: a beat flips between the first two; a glide holds the last */
  wings: Object.freeze(['v', '-', '-']),
  /** beats a second as it bursts out, and once it is under way (each bird its own, x 0.8 - 1.2) */
  beat: Object.freeze([7, 3.6]),
  /** s over which the birds of one roost leave (each its own moment; more go early than late) */
  burst: 1.1,
  /** a bird's first m/s up out of the crown, and its push along the flock's way */
  launchUp: Object.freeze([4.5, 7]),
  launchOut: Object.freeze([1.5, 3]),
  /** the flock's speed along its way: m/s at the start and under way (it gathers speed over `accel` s) */
  speed: Object.freeze([5, 8.5]),
  accel: 1.1,
  /** its way (flock.js "The way it flies"): out of the crown `out` m and up `rise` m; a roost not behind
   *  the camera (on screen above `behind`, -1..1 bottom to top) is routed through the sky the camera
   *  sees: up to `high` m, into the top band (`band`, screen height -1..1) `near` of the half screen out
   *  to the roost's side, then across and out of the frame at `far` on the other side, `top` up, climbing
   *  `climbOut` m more */
  way: Object.freeze({ out: 6, rise: 2.5, behind: -1.15, high: Object.freeze([9, 12]), band: Object.freeze([0.6, 0.74]), near: Object.freeze([0.15, 0.45]), far: 1.45, top: 0.82, climbOut: 3 }),
  /** the shape (m): along its way, across it, up and down. It starts tight and loosens to `loose` x
   *  over its flight; every bird's place in it drifts on its own slow beat (`drift` Hz), so the shape
   *  stretches, curls and thins and is never evenly spaced */
  along: 1.1,
  across: 0.55,
  up: 0.4,
  loose: 2.4,
  drift: Object.freeze([0.12, 0.35]),
  /** how a bird keeps its place: a spring (1/s^2) and its damping (1/s); the spring comes in over
   *  `gather` s (the burst first scatters them, then they close up) */
  spring: 6,
  damp: 3.4,
  gather: 1.1,
  /** s the flock flies; each bird drops out (fades over `fade` s) at its own share of it, `quit`, so the
   *  flock thins as it goes instead of ending */
  life: 10,
  quit: Object.freeze([0.4, 1]),
  fade: 1.4,
  /** the look: a moon-grey letter, faint; alone it is near invisible (the flock's mass reads) */
  color: Object.freeze([0.46, 0.48, 0.56]),
  alpha: 0.72,
  /** a bird whose letter would land within this many m (ground) of the hero or the boss is not drawn */
  clear: 2.2,
});

/** What sends a roost up (world/life/flock.js). */
const FLUSH = Object.freeze({
  /** fire within `fire` m of the roost (plus the fire's radius): it goes */
  fire: 10,
  /** a blow of at least `power` (POWER scale) within `blow` m (plus its reach) */
  blow: 8,
  power: 0.9,
  /** a tree falling, crashing or catching (world:impact 'topple' | 'crash' | 'burn' | 'break' on wood)
   *  within `fell` m of the roost */
  fell: 14,
  /** a startle (a roar, a gust's alarm, the Lab) of strength k >= `startleK`: the roost nearest its
   *  centre within min(r, startleR) */
  startleK: 0.6,
  startleR: 45,
  /** s between two flocks anywhere on the level: a fire fight must not empty the sky every second */
  gap: 5,
  /** at most this many flocks in the air at once */
  max: 3,
});

/** After the fight (game state 'explore' or 'victory'): what comes back, and when. */
const RETURN = Object.freeze({
  /** s after the fight before a roost fills again (each its own; birds fly in to it: an inbound flock
   *  of `inbound` birds where it shows) */
  roost: Object.freeze([20, 80]),
  inbound: Object.freeze([5, 9]),
  /** s an inbound flock takes from where it shows to the crown */
  inT: 5,
  /** s after the fight (or after it hid) before an animal is back at its place (it fades in over
   *  `fadeIn` s, only with the hero more than `far` x its alarm radius away) */
  animal: Object.freeze([25, 90]),
  fadeIn: 3,
  far: 1.6,
});

/**
 * The ground animals' kinds. A body is a list of letters [dx, dy, ch] in letter CELLS round its
 * point (dx forward along the way it faces on screen, dy up), drawn facing right and mirrored when it
 * faces left (`/` and a back-slash swap). `sit` is the body at rest, `run` the frames of its gait
 * (picked by the gait's phase), `air` (a hop's or bound's top half).
 *   gait     'hop' (an arc, a pause: rabbit, frog) | 'bound' (long arcs, no pause: deer) | 'dart' (low,
 *            fast, one pause: rat) | 'scuttle' (stop-start: lizard) | 'trot' (a steady trot and a look
 *            back: the fox)
 *   speed    m/s along the ground while it moves;  arc  m of a hop or bound (up), hz its steps a second
 *   pause    s of a hop's or a scuttle's stop (a range)
 *   r / runR the hero within r m (runR while he runs) puts it up;  react  s before it goes (a range)
 *   color / alpha (at rest, and moving)
 */
const BS = String.fromCharCode(92); // (a back-slash)
const KINDS = Object.freeze({
  rabbit: Object.freeze({
    gait: 'hop', speed: 5.5, arc: 0.38, hz: 2.6, pause: Object.freeze([0.08, 0.22]), zig: 0.45,
    r: 7, runR: 11, react: Object.freeze([0.05, 0.25]),
    sit: Object.freeze([[0, 0, '0'], [0.45, 0.85, "'"]]),
    run: Object.freeze([[[0, 0, '0'], [0.6, 0.6, "'"]], [[-0.45, 0, '-'], [0.4, 0.05, '0'], [0.95, 0.5, "'"]]]),
    air: Object.freeze([[-0.5, 0, '-'], [0.4, 0.1, '0'], [1, 0.45, "'"]]),
    color: Object.freeze([0.33, 0.3, 0.26]), alpha: Object.freeze([0.42, 0.7]), y: 0.15, front: 1.2,
  }),
  deer: Object.freeze({
    gait: 'bound', speed: 7.5, arc: 0.85, hz: 1.7, zig: 0.12,
    r: 13, runR: 18, react: Object.freeze([0.1, 0.45]),
    // (a long body, the neck and head up at the front, the legs under: wider than tall)
    sit: Object.freeze([[-0.55, 0, '='], [0.45, 0, '='], [1.2, 0.8, '/'], [-0.6, -0.95, '|'], [0.5, -0.95, '|']]),
    run: Object.freeze([
      [[-0.55, 0, '='], [0.45, 0, '='], [1.3, 0.65, '/'], [-1, -0.85, '/'], [0.95, -0.85, BS]],
      [[-0.55, 0, '='], [0.45, 0, '='], [1.3, 0.65, '/'], [-0.25, -0.85, BS], [0.25, -0.85, '/']],
    ]),
    air: Object.freeze([[-0.55, 0, '='], [0.45, 0, '='], [1.35, 0.55, '/'], [-1.25, -0.6, '-'], [1.3, -0.55, '-']]),
    color: Object.freeze([0.3, 0.25, 0.2]), alpha: Object.freeze([0.4, 0.68]), y: 0.95, front: 2,
  }),
  rat: Object.freeze({
    gait: 'dart', speed: 6, arc: 0, hz: 9, pause: Object.freeze([0.25, 0.5]),
    r: 5, runR: 8, react: Object.freeze([0, 0.12]),
    sit: Object.freeze([[-0.75, -0.05, '~'], [0.2, 0, 'c']]),
    run: Object.freeze([[[-0.85, 0, '-'], [0.15, 0, 'c']], [[-0.85, 0, '~'], [0.15, 0, 'c']]]),
    color: Object.freeze([0.24, 0.22, 0.21]), alpha: Object.freeze([0.4, 0.66]), y: 0.08, front: 1.2,
  }),
  lizard: Object.freeze({
    gait: 'scuttle', speed: 5, arc: 0, hz: 12, pause: Object.freeze([0.18, 0.5]), move: Object.freeze([0.2, 0.38]), zig: 0.6,
    r: 5, runR: 8, react: Object.freeze([0, 0.1]),
    sit: Object.freeze([[-0.9, 0, '~'], [0, 0, 'x'], [0.85, 0, '-']]),
    run: Object.freeze([[[-0.95, 0, '~'], [0, 0, 'x'], [0.85, 0, '-']], [[-0.95, 0.05, '-'], [0, 0, '+'], [0.85, 0, '-']]]),
    // (a dusty mid tone: on the clay round the Ring a darker one was near invisible, and the first
    //  ones were placed inside a butte: animals.js keeps them clear of what stands)
    color: Object.freeze([0.22, 0.18, 0.12]), alpha: Object.freeze([0.7, 0.85]), y: 0.06, front: 1.2,
  }),
  fox: Object.freeze({
    gait: 'trot', speed: 3.4, arc: 0.06, hz: 3.2, zig: 0,
    /** it watches longer than the others: it goes when he comes within r, and on the way it stops once
     *  and looks back at him for `look` s (`lookAt` s into its run) */
    look: 1.1, lookAt: 0.9,
    r: 11, runR: 14, react: Object.freeze([0.4, 0.7]),
    // (long and low: the brush trailing, the body, the head and its ears up at the front, one leg
    //  letter under that flickers with the trot)
    sit: Object.freeze([[-1.85, 0.3, '~'], [-0.9, 0, '='], [0.05, 0, '='], [0.95, 0.6, 'v'], [-0.4, -0.9, '|']]),
    run: Object.freeze([
      [[-1.9, 0.15, '~'], [-0.9, 0, '='], [0.05, 0, '='], [1, 0.5, 'v'], [-0.4, -0.9, 'x']],
      [[-1.9, 0.3, '~'], [-0.9, 0, '='], [0.05, 0, '='], [1, 0.55, 'v'], [-0.4, -0.9, '|']],
    ]),
    /** the tail: the foxfire's pale blue, a glint that hangs where it slipped into the dark */
    tail: Object.freeze([0.3, 0.55, 0.75]), glint: 1.4,
    color: Object.freeze([0.27, 0.13, 0.06]), alpha: Object.freeze([0.55, 0.75]), y: 0.55, front: 1.6,
  }),
});

/** The letters the fauna's batch can print (creatures.js builds it with these). */
const LETTERS = "v-~'0=|/" + BS + 'cx+.';

export const FAUNA_TUNE = Object.freeze({
  flock: FLOCK,
  flush: FLUSH,
  back: RETURN,
  kinds: KINDS,
  letters: LETTERS,
  /** letters the batch holds at most (a full sky of flocks and every animal) */
  max: 260,
  /**
   * Per level:
   *   keepOut   m: the fighting ground's radius (round the origin; `square` true: |x|, |z| <= it).
   *             Nothing alive is placed or runs inside it
   *   roosts    { kinds, r, minH, n (roosts), birds [a, b] each, yK (crown height share), inK (m toward
   *             the clearing), look? (FLOCK keys a level dresses: a crow is darker and heavier) }
   *   animals   [{ kind, n, r [a, b] (round the origin; `square`: its |x| or |z|), near? (the set's kinds
   *             it sits by, within `nearR` m), group? (deer: a herd of n), cover (m out from where it
   *             sits it is in cover: gone), along? (a rat: share of its run along the wall) }]
   */
  levels: Object.freeze({
    cinderwood: Object.freeze({
      keepOut: 22,
      // (ADR-197: the forest he walks in, out to the ridge at ~48 m: roosts and animals live in it too)
      roosts: { kinds: ['tree'], r: [29, 45], minH: 7, n: 13, birds: [30, 44], yK: 0.78, inK: 1.6 },
      animals: [
        { kind: 'rabbit', n: 8, r: [24.5, 38], cover: 9 },
        { kind: 'deer', n: 4, group: true, r: [30.5, 40], cover: 10 },
      ],
    }),
    ash: Object.freeze({
      keepOut: 14.5,
      square: true,
      // crows off the ruins: darker, fewer, heavier
      roosts: {
        kinds: ['pillar', 'deadTree'], r: [16, 32], minH: 3, n: 5, birds: [9, 15], yK: 0.95, inK: 0,
        look: { color: [0.2, 0.2, 0.235], alpha: 0.7, beat: [4.5, 2.6], speed: [2.6, 6.2], launchUp: [3.5, 5], wings: ['v', '~', '-'], along: 1.3, across: 0.9 },
      },
      animals: [{ kind: 'rat', n: 6, r: [14.9, 16.2], square: true, near: ['pillar', 'colossus', 'lantern'], nearR: 2.2, cover: 6, along: 0.6 }],
    }),
    ring: Object.freeze({
      keepOut: 16,
      square: true,
      // (no birds on the ground: the hawk keeps the sky)
      animals: [{ kind: 'lizard', n: 5, r: [17.5, 22], square: true, cover: 7 }],
    }),
    fox: Object.freeze({
      keepOut: 14.5,
      roosts: { kinds: ['deadTree'], r: [20, 34], minH: 5, n: 5, birds: [12, 22], yK: 0.9, inK: 0.3, look: { color: [0.38, 0.41, 0.48] } },
      // one fox, by the great fox's statue: it watches, and slips away once a visit
      animals: [{ kind: 'fox', n: 1, at: [-15.6, 3.2], cover: 12, once: true }],
    }),
    city: Object.freeze({
      keepOut: 15,
      // pigeons on the tower tops and the blocks' fronts: grey-blue, quick
      roosts: {
        kinds: ['towerTop', 'blockFront'], r: [20, 36], minH: 6, n: 5, birds: [14, 24], yK: 1, inK: 0,
        look: { color: [0.4, 0.43, 0.5], beat: [8, 4.4], speed: [3.4, 9.5] },
      },
    }),
    // starless: nothing alive. grove: stillness (the fireflies hang; nothing runs). code: an indoor
    // hall of falling script: nothing alive. foundry: a mill no one is left to feed: nothing alive.
  }),
});
