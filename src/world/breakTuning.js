// Destruction numbers (world/destructibles.js, world/fire.js, world/scars.js; ADR-107). Content is
// data: what a material is worth, how hard a blow is, how long things burn.
//
// POWER is the one scale every blow is put on (0 = a touch, 1 = a blow that fells a tree):
//   0.12 a quick cut      0.3 a duelist's cut       0.5 a heavy cut (an overhead, the hero's finisher)
//   0.8 a claw, the hero's charged cleave           1.0 a tail, a slam, a thrown stone
//   1.5 a meteor, a bolt of the Void                2.5 the dive's crash, the nova
// An object loses `power × the material's factor for that kind of blow` of its structure.

export const BLOW = Object.freeze({ CUT: 'cut', BLUNT: 'blunt', BLAST: 'blast', FIRE: 'fire' });

export const BREAK = Object.freeze({
  /** per material: structure of a 1 m wide, 3 m tall piece; how each kind of blow bites; its debris */
  mats: Object.freeze({
    wood: Object.freeze({
      hp: 0.9,
      take: Object.freeze({ cut: 1, blunt: 0.9, blast: 1.1, fire: 0 }),
      chips: "/\\|-'`,", // splinters
      dust: ".,'",
      color: [0.34, 0.25, 0.17],
      colorEnd: [0.1, 0.07, 0.05],
      burns: true,
    }),
    stone: Object.freeze({
      hp: 1.3,
      take: Object.freeze({ cut: 0.7, blunt: 1, blast: 1.15, fire: 0 }),
      chips: '#%&o:.,', // chunks
      dust: '.:,',
      color: [0.3, 0.33, 0.42], // (kept low: debris in the stone's own dim hue, never a white flash)
      colorEnd: [0.12, 0.13, 0.16],
      burns: false,
    }),
    metal: Object.freeze({
      hp: 2.6,
      take: Object.freeze({ cut: 0.3, blunt: 0.8, blast: 0.9, fire: 0 }),
      chips: '*+x.', // sparks
      dust: ".'",
      color: [2.4, 1.5, 0.5],
      colorEnd: [0.5, 0.12, 0.03],
      burns: false,
      sparks: true,
    }),
    bone: Object.freeze({
      hp: 0.8,
      take: Object.freeze({ cut: 0.8, blunt: 1.1, blast: 1.2, fire: 0 }),
      chips: "|/\\-:.'",
      dust: '.:',
      color: [0.3, 0.285, 0.245], // (2026-11-16: 0.46, 0.43, 0.36 broke a rib in a white cloud; now the bone's own hue, landmarks.js BONE)
      colorEnd: [0.16, 0.15, 0.13],
      burns: false,
    }),
  }),
  /** a blow weaker than this leaves a mark and takes nothing (a quick cut on stone) */
  scratch: 0.1,
  /** a struck object cannot be struck again by the same source for this long (one swing, one chip) */
  rehit: 0.18,
  /**
   * A BRUSH (a blow with `o.brush`: a boss's body walking, turning, shouldering into a piece): only
   * what the blow has over `brush` x the piece's structure bites; the rest is a shove and a shudder.
   * A walk shakes a big tree and breaks the small things (bones, helms, a sapling); a charge, a tail
   * swept hard, a landing or a thrown piece still fells what it meets (2026-11-15, the tuning pass: the
   * body's sweeps added up step by step and a four-minute fight left a sixth of the clearing standing).
   * A flat stone (a flagstone: lower than `flat` m) takes nothing from a brush: claws and feet scrape
   * over the paving; a stomp, a landing, a dive or a thrown piece (world.impact) still breaks it
   */
  brush: 0.55,
  // ... but never less than this share of it: a body that keeps pushing into a tree (walking straight
  // through it) still brings it down in a couple of seconds; a turn's brush only shakes it
  brushMin: 0.4,
  brushRehit: 0.3, // s between two brushes of one piece (a limb rubbing past it)
  brushFlat: 0.3,
  /**
   * Fire that LANDS lights wood (destructibles.ignite: a breath, a flame wall, a burning pass; not the
   * spread, which has its own budget below): at most `perSec` new fires a second over the level
   * (banking `bank`), and only while fewer than `maxBurning` x the quality factor burn. Past it the
   * grass still burns and the wood is only scorched (a flame wall that crossed the ring lit 22 - 29
   * trees at once)
   */
  light: Object.freeze({ perSec: 0.12, bank: 3, maxBurning: 6 }),
  /** falling over: seconds for a 5 m piece (scaled by sqrt(h / 5)), the strip it lands on, what it deals */
  topple: Object.freeze({
    time: 1.0,
    minH: 2.2, // shorter pieces shatter where they stand
    pad: 0.55, // m either side of the falling piece that it hits
    damage: 22, // to the hero under it (dodge it: red), × the piece's weight (0.6 … 1.3)
    bossDamage: 220, // to a boss under a piece the hero felled, × weight
    bossPosture: 90,
    knock: 6,
    shake: 0.42,
  }),
  /** a thrown piece (a boss's move supplies its own tell and blow; these are the world's share) */
  thrown: Object.freeze({ gravity: 22, spin: 5.5, blast: 1.2, shake: 0.4 }),
  /** cover: a piece stops a projectile and pays for it */
  cover: Object.freeze({ minH: 1.1, bullet: 0.12, bolt: 1.5, stone: 0.7, crescent: 0.35 }),
  /** burning wood (`char`: m round its trunk the ground lies black once it has burned through): seconds alight, the ring round the trunk that burns the hero, ticks as the ground fire's.
   *  `glow`: its light is a LOCAL glow (radius m, intensity; it was ~16 m and 2.6, a yellow flood that
   *  buried the fire on the ground the hero must read): a piece that catches within `share` m of one
   *  already lit shares that light (it is kept on for as long as either burns); at most `lights` at once
   *  (only 8 reach the shaders) */
  burn: Object.freeze({ char: 2.2, time: 7, pad: 1.0, light: [3.2, 1.1, 0.25], lights: 4, glow: Object.freeze({ radius: 5, intensity: 1.5, share: 8 }) }),
  /** the spatial grid every query walks (strike, sweep, stop, coverAt, ignite, nearest): cell size, m */
  grid: Object.freeze({ cell: 4 }),
  /**
   * Fire spreads (2026-11-15: the owner's "fire spreads from tree to tree"; ADR-107 had it burn where
   * it lands): a piece alight for `after` s tries every `every` s to light ONE unburnt wood piece (or a
   * log) whose base is within `reach` m of its own (+ both radii), with `chance`. Limits: at most
   * `maxBurning` things alight at once (x the quality factor), a budget of `perSec` spreads a second
   * over the whole level (it banks up to `bank`), and a fire passes on at most `gens` times from where
   * fire landed (a blaze stays a stand, it never walks round the whole ring).
   */
  spread: Object.freeze({ after: 2.2, every: 1.1, chance: 0.45, reach: 5.2, maxBurning: 7, perSec: 0.25, bank: 2, k: 0.9, gens: 2 }), // (tuning, 2026-11-15: maxBurning 9, perSec 0.3)
  /**
   * Wreckage (world/wreckage.js): what a felled tree, a broken stone and a thrown piece leave lying,
   * scenery the hero walks over (no collider, it stops nothing). Pools of prop-art meshes: `logs` fallen
   * trunks, `chars` burnt ones, `rubble` piles. The quality factor scales how many may lie at once; past
   * that the oldest sinks into the ground (`sink` s). `trunk`: share of a tree's height that lies as its
   * trunk [a crowned tree, a bare one] (the crown comes apart as before); `thick`: the log's radius x the
   * piece's; `flatten`: the char it leaves on the grass under it (the blades shrink: it lies on them,
   * not under them). A burnt log smoulders `smoulder` s (at most `smoulderMax` x quality at once: smoke and
   * embers, a warm patch of ground); a log that catches burns `burn` s.
   */
  wreck: Object.freeze({ logs: 64, chars: 36, rubble: 30, bones: 48, blocks: 12, shards: 16, sink: 1.4, trunk: Object.freeze([0.5, 0.85]), thick: 0.85, flatten: 0.4, smoulder: 30, smoulderMax: 8, burn: 6 }),
  /**
   * HOW A TREE LIES once felled (ADR-128, 2026-11-21: "make the cleared trees not look the same and have
   * it broken in different angles based on how it was hit"). Per kind of blow:
   *   h       its stump's height x the one it was built with [min, max] (a blade: x the height it bit at)
   *   slant   the break's rise per m across the stump, along the blow (> 0: higher on the side it fell to:
   *           the fibres it tore standing up; a blade's cut slants either way)
   *   jag     splinters, x the stump's height
   *   lean    rad the stump is pushed over toward the fall
   *   spread  rad the fall may turn off the blow's line
   *   yaw     rad the trunk turns as it lands (it bounces, rolls off its crown)
   *   split   share of trunks that break in two where they land (`kink` rad between the halves, `gap` m)
   *   snag    share of the trees that burn through and stay standing as a black snag (`snagH`: x its height,
   *           `snagLean` rad); `char`: how dark its stump burns (x its colour)
   * `spin`: rad a falling tree may roll about its own trunk on the way down; `pitch`: rad a log's far end
   * may rest raised on its broken crown.
   */
  fell: Object.freeze({
    cut: Object.freeze({ h: [0.85, 1.25], slant: [0.55, 1.1], jag: 0.1, lean: 0.03, spread: 0.08, yaw: 0.08, split: 0.08 }),
    blunt: Object.freeze({ h: [0.6, 1.25], slant: [0.2, 0.8], jag: 0.5, lean: 0.14, spread: 0.2, yaw: 0.22, split: 0.35 }),
    blast: Object.freeze({ h: [0.3, 0.75], slant: [-0.3, 0.3], jag: 0.7, lean: 0.08, spread: 0.4, yaw: 0.45, split: 0.6 }),
    fire: Object.freeze({ h: [0.3, 0.7], slant: [-0.25, 0.25], jag: 0.18, lean: 0.03, spread: 0.6, yaw: 0.6, split: 0.3, snag: 0.4, snagH: [0.35, 0.7], snagLean: 0.25, char: 0.3 }),
    spin: 0.7,
    pitch: 0.1,
    kink: Object.freeze([0.25, 0.7]),
    gap: 0.3,
  }),
  /**
   * A FLOOR (2026-11-16: the Ashfall Courtyard's paving and the crater's plates break). Each slab is a
   * breakable 'range' piece (its body is its run of vertices in the set's one paving mesh: an intact
   * floor costs no draw call more than it did), marked `floor` by the set. Three states that read at
   * the game camera: whole, CRACKED (its structure under `crack` of itself: the slab shows split into
   * a few pieces with seams) and BROKEN (shattered: rubble over bare earth, or tilted shards: the
   * owner's pick, `?floor=a|b`). Cracked and broken slabs come from two more merged meshes of the set,
   * hidden until the first slab shows in them (one draw call each from then on).
   * A blow's power on a slab falls off from the blow's centre: full within `core` m, `rim` of it at its
   * edge, so a heavy blow breaks the slab under it and cracks its neighbours, a cut cracks one.
   *   hp      a paving slab's structure: a red heavy blow (a ring, a knockdown: 0.75 - 0.94), a hurled
   *           stone (1.2 x weight), a falling pillar (0.7 x weight, its whole strip) break the one under
   *           it; a heavy blow that is not red (0.6) cracks it and a second breaks it; a cut (0.25 -
   *           0.375 x 0.7) cracks it, a few in one place break it
   *   plate   the crater's big plates (over `big` m2: most of its rings)
   *   sweep   the share of a blow drawn ALONG the floor (an edge, a dash: destructibles.sweep) a slab
   *           takes; a blow landing on it (strike, world.impact, a falling piece's strip) bites in full
   *   debris  the share of a standing piece's chips and crumble a slab throws (a ring blow strikes many)
   *   grit    glyphs of grit and chunks a slab throws up as it breaks (x the quality factor)
   *   lift    its lift class: 3 = only a move that asks for floor takes it (nearest / floorNear with
   *           lift 3); the wyrm's (1) and the Void's (2) choices are unchanged
   *   carry   meshes for slabs in a boss's hands (a slab torn out shows as a block of prop art)
   */
  floor: Object.freeze({ hp: 0.85, plate: 1.3, big: 5, crack: 0.8, core: 0.8, rim: 0.35, sweep: 0.6, debris: 0.45, grit: 8, lift: 3, carry: 6 }),
  /**
   * A colossus comes down in two stages (the courtyard's two stone swordsmen): its upper half (chest,
   * arms, head) is one piece standing on its legs; blows on either wear the upper half down (`top`),
   * and it topples from the cut as one falling piece (the world's falling rule: a marked strip, the
   * flash, 22 x weight on the hero, 220 x weight on a boss), over `fall` s, landing `off` m out from
   * the plinth. Then the legs are a tall stump that is cover and breaks in its turn (`legs`), leaving
   * the plinth. Each stage leaves `blocks` of the wreckage's big blocks.
   */
  colossus: Object.freeze({ top: 6, legs: 4.5, weight: 2.2, fall: 1.4, off: 1.6, blocks: 4 }),
  /** a thrown piece smashes what stands in its way: power x its weight, while it flies under `y` m */
  flight: Object.freeze({ power: 0.8, y: 7 }),
  /**
   * Wearing down (2026-11-16, the owner's "slowly crumble and break"): a tree loses itself in stages
   * before it falls. At each share of its structure in `at` it reaches the next stage: 1 a burst of
   * leaves and a thinner crown, 2 boughs snapped and half the crown gone, 3 it leans `lean` rad (x 0.75
   * .. 1.25) along the blow, over `leanTime` s. Which parts go by each stage is the set's (forest.js
   * `wear`). A burning tree's crown is all gone by `burn` of its burn. `debris`: glyphs a dropped part
   * throws per metre of its size (x quality). `shakeMax`: range pieces (the forest's trees) that may
   * shudder at once (their vertices are rewritten each frame; x quality; the rest only chip).
   */
  wear: Object.freeze({ at: Object.freeze([0.82, 0.5, 0.22]), lean: 0.32, leanTime: 0.6, burn: 0.85, debris: 14, shakeMax: 10 }),
  /**
   * The tree wall round the clearing (2026-11-16): every tree of it breaks, out to the forest's edge
   * (74 m). A tree whose base is beyond `from` m is the wall's: `hp` x the structure of a tree of its
   * size (it takes a fight's worth of blows, a hit shows at once as a stage), and it falls mostly AWAY
   * from the arena: at least `out` of its way points out (a fall that cannot reach the hero's bound tells
   * nothing: there is nothing to dodge). Where it lands it strikes the trees behind with `domino` x its
   * weight (0.7 elsewhere: a felled rim tree tears into the wall behind it), and a fire in the wall may
   * pass on `gens` more times than BREAK.spread.gens (a blaze eats into the wall, not round the ring).
   */
  // `fire` (2026-11-16, the tuning pass): the wall burns on budgets of its own, so fire that carries
  // into it (destructibles.carryFire: a breath past its end, a missed shot) neither waits for nor eats the
  // clearing's (BREAK.light / BREAK.spread stay the clearing's caps): new fires that land there `perSec`
  // (banking `bank`), spreads `spreadPerSec` (`spreadBank`, with `chance`), at most `maxBurning` alight
  // in the wall at once (x quality); `width` m either side of a ray that carries fire
  wall: Object.freeze({
    from: 32, hp: 1.15, out: 0.55, domino: 1.4, gens: 0,
    fire: Object.freeze({ perSec: 0.15, bank: 2, maxBurning: 6, spreadPerSec: 0.08, spreadBank: 2, chance: 0.45, width: 1.2 }),
  }),
  /**
   * The edge of the open ground (world/edge.js, ADR-125; the owner's "the outer tree border ring should
   * slowly crumble and allow the dragon and player to move outside"): the ring is cut into `lanes`; in
   * each the hero's ground ends `margin` m short of the nearest tree still standing in it, and at
   * `outer` m from the centre once none stands (the forest ends at 74 m, the grass and the scorch map
   * at 80). A tree closes the lanes its crown covers: `crown` x its crown's radius, at least
   * `minBlock` m either side of its trunk. The boss's share of the opened ground: `body` m narrower
   * at either side of a gap than the hero's (its shoulders: a slot a few metres wide does not let its
   * root in at all), and from there rising no faster than `slope` (m out per m along the ring), so it
   * has to tear a wide gap to follow the hero deep. `every`: s between two readings of the trees.
   * `seal`: a lane nothing has fallen in opens beside open ground only if that frees more than this
   * many m of it (a natural gap in the wall; a lane with a tree at the line stays shut).
   */
  // `walk` (the fire-and-forest pass, edge.js WALK mode: a set whose hero walks out into its forest): a
  // boss follows him out to `lead` m past how far beyond the base he stands, at once; when he comes back
  // its gain falls at `ease` m/s; never past `bossIn` m short of the set's end
  edge: Object.freeze({ lanes: 120, crown: 0.6, minBlock: 1.1, margin: 1.0, outer: 62, body: 3, slope: 2, every: 0.2, seal: 2, walk: Object.freeze({ lead: 2, ease: 3, bossIn: 7 }) }),
  /**
   * Wind and shock on wood (destructibles.wind, 2026-11-16): a front rolls out at `speed` m/s; a tree
   * it reaches takes power x (1 - d / reach)^fall as a blast's wear, nothing under `min`, never below
   * `floor` of its structure (wind alone takes a tree to its second stage, never to its lean or its
   * fall), at most once each `rehit` s, x 1 -/+ `vary` at random (a ragged front), and loses `leaves` leaves to it (x the power). `queue`: trees
   * waiting for a front (a roar's reaches the whole ring: ~560)
   */
  wind: Object.freeze({ speed: 30, fall: 1.3, min: 0.04, floor: 0.3, rehit: 0.35, vary: 0.45, leaves: 5, queue: 1400 }),
  /**
   * BITES (`?chip=a`; the owner's "have the ascii pieces fall off exactly where the player or enemy
   * boss is hitting ... destructible like minecraft/lego"): every piece is the bricks it is drawn with,
   * its triangles (two that share their longest edge and lie flat together are one brick: a block).
   * With bites on, a level is built with no face of a breakable longer than `brick` m (forest.js
   * `refine`: the same shapes cut finer, about one letter cell at the game camera; a part whose
   * triangles are already narrower than `thin` m on average is left alone, and the forest's trees
   * beyond `near` m of the centre are cut `far` x as coarse). A blow takes the
   * bricks nearest the point it struck: of those within `reach` of it (the blow's own radius + `pad`,
   * between `reach[0]` and `reach[1]` m) the share of the piece's structure the blow took (x `k`),
   * nearest first, at most `max` a blow and at least one. So a notch grows where a blade keeps biting
   * and is cut through as the piece's structure runs out. A blow over a disc (a blast, a slam, a
   * landing) counts from its own centre, as far as it reaches into the piece (at most `reach[2]` m),
   * so it eats the side that faced it. A brick of a SOLID part (a trunk, a stone, a bone) is not taken
   * out: it is set back into the piece, `sink.k` of the piece's thickness there and at most `sink.max`
   * m, so the piece keeps a skin and never opens onto its empty inside; foliage, a face with no wall
   * behind it and a part too thin to show a dent (set back less than `sink.min` m: a bough, a small
   * bone) lose the brick outright. A crown part with `shed` of its bricks gone drops whole. Each
   * brick falls as a letter of what it was drawn in, from where it sat (`out` m/s along the blow, `up`
   * m/s), and every `litter`-th leaves a letter lying under it until the reset. `windY`: a front's
   * bite on a tree of the wall is taken from its windward crown, at this share of its height. A
   * piece's bricks are made once, when the level is built (destructibles.js `brickSink`).
   * `stop` (the hero's blade, with bites on; player.js `_cutWorld`): a cut that meets a piece it does
   * not cut through STOPS on it instead of passing through: the frame freezes `freeze` s (wood / the
   * rest: stone, metal, bone), the camera shakes `shake`, the blade is held in the cut `stick` s (it
   * bit into wood; it rings off stone at once), then it is thrown back (the hero's bounce, `push` m
   * away). Steel on stone or metal throws sparks. A piece the cut breaks or fells lets it through, with
   * a `through` freeze. Only on contact: the steel within `touch` m of the piece's footprint (the
   * blade's own thickness, as its hit on a boss: combat.js REACH.radius 0.24). Not the execution, the plunge, the slam's
   * shards or a piece lower than `minH` m (a helm, a bone on the ground: the blade passes over or
   * breaks it).
   */
  chip: Object.freeze({ brick: 0.8, thin: 0.12, near: 48, far: 2.5, reach: Object.freeze([0.55, 3.2, 14]), pad: 0.25, k: 1, max: 96, sink: Object.freeze({ k: 0.42, max: 0.3, min: 0.07 }),
    stop: Object.freeze({
      freeze: Object.freeze({ wood: 0.075, hard: 0.095 }), shake: Object.freeze({ wood: 0.14, hard: 0.2 }),
      stick: Object.freeze({ wood: 0.11, hard: 0 }), push: Object.freeze({ wood: 0.25, hard: 0.45 }),
      through: 0.05, minH: 0.6, touch: 0.25,
    }),
    /**
     * `pass` (the hero's blade by default; 2026-11-23, the owner: "allow the player to swing their attack
     * animation through it"): the blade goes CLEAN THROUGH every piece, at full speed: no rewind, no
     * freeze, no bounce. The piece takes the blow as before; what it knocks off (its bricks, its chips,
     * its dust) flies on ALONG the cut (`along` x the blade's travel, `face` x out of the face where it
     * was struck) instead of back toward him. On each piece the steel crosses, once a swing
     * (player/fx.js `cutPass`): stone and metal throw a short spray of `sparks` (light, heavy) off the
     * face along the cut, wood `splinters` and a breath of bark dust; a `line` of faint pale strokes
     * marks where the edge crossed the face for `lineLife` s (`lineStep` m apart, at most `lineMax`).
     * The hand feels it: one camera `jolt` a swing (light, heavy: under a landed cut's 0.12 / 0.3).
     * `?cutStop=1` gives back the blade that stops (`stop` above, ADR-132).
     */
    pass: Object.freeze({
      along: 1.1, face: 0.45,
      sparks: Object.freeze([5, 9]), splinters: Object.freeze([6, 10]),
      line: false, lineLife: 0.2, lineStep: 0.16, lineMax: 9,
      jolt: Object.freeze([0.05, 0.12]),
    }), out: 1.6, up: 1.4, litter: 3, shed: 0.72, windY: 0.7 }),
  /**
   * SLICED pieces (a def's `slice: true`: the Windless Grove's bamboo; the owner: "make the bamboo all
   * sliceable in 1 swoop and make sure it falls the moment the sword is going through"): any blade or
   * blow that takes anything of it (not fire, not a body brushing past) cuts it through at the height
   * it bit, `low` m above the ground at least and `top` m under its top at most. Its stump keeps that
   * height on a clean slant (`slant` rise per m across, either way). Its top slides `slide` m off the
   * cut along the blow in `slideT` s (and sinks `sink` of that), then goes over about its lower end in
   * `fall` x sqrt(its length) s, kicked `kick` m out along the blow, turned up to `spread` rad off it
   * and rolling up to `spin` rad about its length, and comes apart where it lands.
   */
  slice: Object.freeze({ low: 0.25, top: 1.2, slant: Object.freeze([1.0, 1.8]), slide: 0.3, slideT: 0.09, sink: 0.6, fall: 0.3, kick: 0.9, spread: 0.35, spin: 0.9 }),
  /** debris glyphs (a stage's burst, the wind's leaves) a second over the level, banking `bank` (x quality) */
  debris: Object.freeze({ perSec: 1500, bank: 900 }),
  /** a piece some of whose `guards` stand (the Cinder Tree's trunk under its boughs) takes this share of a blow */
  guarded: 0.2,
  /**
   * The landmarks of Cinderwood (2026-11-16: the owner reversed ADR-119's "they stay whole"; the bonfire
   * stays): structure in POWER units by piece. The Elder Wyrm's skeleton comes apart rib by rib over a
   * fight (a tail blow takes a third to a half of a rib); the Cinder Tree loses its boughs first (each
   * burns too), then its trunk breaks where it stands and leaves a charred stump; the bone nest's great ribcage and skull.
   */
  landmark: Object.freeze({
    rib: 2.8, spine: 3.2, skull: 6, jaw: 3, horn: 2, hip: 3, mast: 2.6, fingers: 1.6, wing: 2.2,
    bough: 2.6, trunk: 7,
    nestRib: 2.6, nestSkull: 5,
  }),
});

/**
 * The phone budget (world.setQuality, from the quality preset: LOW, MEDIUM, HIGH): a factor on the debris
 * glyphs a break throws, the flames of burning wood, how much wreckage lies at once, how many fires and
 * smouldering logs, and how many marks stay on the floor.
 */
export const QUALITY = Object.freeze({ LOW: 0.5, MEDIUM: 0.75, HIGH: 1 });

// (How a broken piece comes apart is the owner's pick of three filmed looks, 2026-11-15: "digits",
// a shower of the characters it is drawn in. Chunks and shards were turned down: destructibles.js
// `_crumble`.)

/**
 * Grass and ground fire (world/fire.js). Grass fire burns where it lands and does not creep through
 * the grass (the owner's pick); standing wood is another matter: it passes fire on, BREAK.spread.
 */
export const FIRE = Object.freeze({
  minFuel: 0.18, // grass density below this does not catch
  life: [3.2, 4.6], // s a cell burns: thin grass … a full meadow
  grace: 0.45, // s after it catches before it can hurt (a roll through the blast ends outside)
  tick: 0.55, // s between burns on a hero who stays in it
  damage: 5,
  heat: 0.55, // the scorch map's heat a burning cell holds (the ground's ember glow under the flames)
  flames: 46, // flame glyphs per second per burning square metre (capped below)
  maxFlames: 800, // … per second over the whole field
  maxCells: 2600, // burning cells at once (a hard cap: the oldest fires are simply left to finish)
  glow: Object.freeze({ intensity: 1.5, pad: 2, max: 6 }), // a blaze's one light: radius min(max, its radius + pad) m
  // under a live breath (world.fire.hush): the grass's flames x k heat (and smaller, lower). At 1 they
  // added up with the breath's own blobs into white-yellow knots along its cone (integration, 2026-11-15)
  hush: Object.freeze({ k: 0.45, slots: 8 }),
});

/** Impact marks (world/scars.js). */
export const SCAR = Object.freeze({
  // glyphs kept (x the world's quality: half on a phone); the oldest go first. The marks stay until the
  // fight's reset (the owner, 2026-11-23): 3600 holds a whole fight (the bot's wyrm fight leaves ~2700).
  // They cost nothing per frame while nothing changes (the batch is written only when a mark comes or fades)
  max: 3600,
  ground: Object.freeze({ min: 0.45, glyphs: 'x+*', spokes: [5, 9], reach: [0.7, 2.6] }),
  object: Object.freeze({ glyphs: 'x/\\+', size: [0.22, 0.5] }),
  /** a crater: a blow of `min` power or more leaves a rim of thrown-up earth and a charred disc */
  crater: Object.freeze({ min: 1.2, glyphs: '.:o,', ring: [10, 26], char: 0.85 }),
  /**
   * A level whose floor reads every pale letter (the Veiled Crossing's black asphalt at night: a whole fight
   * of grit read as snow) keeps only a share of the GRIT (a slam's and a crater's thrown-up ring, a blast's
   * dots), the RUBBLE (what lands where a piece came down, each bitten letter that falls) and today's crack
   * SPOKES; the strokes that give a mark its shape stay. `cool`: rubble of a material whose end colour
   * is a spark's ember (metal: the cars, the lamps, the bus) lies cold grey instead of as orange embers
   * glowing on the floor till the reset (`?coolRubble=1` / `0` overrides it on any level). Per level id; absent: all (1), as before.
   */
  thin: Object.freeze({
    veil: Object.freeze({ grit: 0.35, rubble: 0.25, ground: 0.4, cool: true }),
    // Halcyon Plaza: no thinning; its metal rubble lies cold grey (the owner, from round 2's sheet: "if it
    // looks better grey then yes"; `?coolRubble=0` gives the orange back)
    city: Object.freeze({ grit: 1, rubble: 1, ground: 1, cool: true }),
    // the Last Foundry: dark steel plates at night read every pale letter (the veil's precedent), so the
    // grit and the rubble thin; its metal rubble glows as embers (a steel mill: hot scrap is the place)
    foundry: Object.freeze({ grit: 0.5, rubble: 0.45, ground: 0.6, cool: false }),
  }),
  /** at the cap this share of the oldest marks goes, fading out over `fade` s (never a pop in view) */
  evict: 0.15,
  fade: 1.4,
  /**
   * The mark each KIND of blow leaves on the floor (scars.mark, world.groundBlow; `?marks=0`: today's
   * cracks only). Glyphs from the world atlas in the set's crack ink, dim; nothing red or bright (a
   * danger marker is red strokes): `lineInk` caps a line's brightest channel (the throne hall's ember
   * ink would draw a gash like a red strip). A mark of the same kind landing within `merge.near` x its
   * size of an older one is thinned to `merge.keep` of its glyphs per mark already there (a hundred
   * blows on one spot do not turn it to noise). `by.player`: the hero's marks are smaller.
   */
  mark: Object.freeze({
    min: 0.12, // a blow lighter than this leaves nothing
    y: 0.07,
    soft: 0.08, // m: the batch's soft depth (a floor mark is not faded into the floor; the footprints' 0.08)
    alpha: 0.85,
    lineInk: 0.42,
    inkSat: 0.3, // of the set ink's colour a kind mark keeps (the rest grey)
    /** the lit lip of a gash / a crack / a furrow and the thrown-up grit: broken stone where the light
     *  catches it (the house style's few brighter digits), dim, never white; per level (game.level.id) */
    lip: Object.freeze({
      default: Object.freeze({ color: [0.42, 0.4, 0.37], alpha: 0.66 }),
    }),
    lipOff: 0.11, // m: the lip a hair north of its stroke (the far edge)
    grassLift: 0.3, // m x the grass's density there: a mark on a meadow lies on the blades' tips (under them it is hidden)
    merge: Object.freeze({ near: 0.8, keep: 0.45, floor: 0.2, slots: 192, twice: 0.35 }),
    by: Object.freeze({ player: 0.6 }),
    /** the hero's heavy blows (player.js; light cuts leave nothing): the charged cleave's end in the
     *  floor (power from charge 0 to 1, a gash `cleaveLen` m), the plunge's landing (a slam); the slam
     *  finisher's is its world.impact (a blunt blow: a slam) */
    hero: Object.freeze({ cleave: [0.45, 1.25], cleaveLen: 1.3, plunge: 0.75 }),
    /** a fist, a tail, a foot, a landing: a shallow crater, a ring of grit and short radial cracks;
     *  from `crater` power today's crater rim is the ring */
    slam: Object.freeze({ r: [0.55, 2.3], rk: 0.75, grit: [6, 15], spokes: [3, 6], glyphs: '.,:;', crack: 0.42 }),
    /** a blade's edge in the floor: one long thin gash along its way, grit thrown to one side */
    cut: Object.freeze({ step: 0.2, size: [0.3, 0.5], len: [0.8, 3.4], bow: 0.14, grit: [2, 5], claws: 0.42 }),
    /** a point driven in: a short deep nick, a spray ahead of it */
    thrust: Object.freeze({ len: [0.4, 0.8], size: 0.55, spray: [4, 8], reach: [0.5, 1.5] }),
    /** a body or a blade dragged along the floor: a shallow furrow, scuffed edges, a heap at its end */
    dash: Object.freeze({ step: 0.36, w: 0.2, size: 0.32, len: [0.8, 6], alpha: 0.62 }),
    /** ki, a spell, an explosion: a scorched round, a star of thin cracks */
    blast: Object.freeze({ r: [0.6, 2.4], rk: 0.8, dots: [7, 18], spokes: [5, 8], glyphs: '.:;,', char: [0.03, 0.026, 0.022] }),
    /** a beam: a long charred trench along its path, a glassy middle. A caller may give the trench's
     *  half-width (`o.w`, m, `w` .. `wMax`: Bai Wuji's Null, 2.5): then its edges are that far out every
     *  `wideStep` m with rubble on `rubble` of them, the glass in rows `rows` m apart across the floor
     *  between (none given: as before) */
    beam: Object.freeze({ step: 0.32, w: 0.32, len: [0.5, 30], glass: [0.15, 0.16, 0.19], glassAlpha: 0.45, wMax: 4, wideStep: 0.45, rows: 1.4, glassK: 0.4, rubble: 0.25,
      // the wide trench READS (the integration pass: a dim lip vanished on the Crossing's night asphalt):
      // its two edges in `edge` (a pale violet-grey, the lit ones x `lit`), `edgeA`, `edgeSize`; its glass
      // rows `wideGlass` / `wideGlassA`, `wideGlassK` of the cells (the narrow beam: as before)
      edge: [0.5, 0.46, 0.62], lit: 1.3, edgeA: 0.95, edgeSize: 0.42, wideGlass: [0.38, 0.34, 0.56], wideGlassA: 0.9, wideGlassK: 0.55 }),
    /** a heavy footfall: a faint print, only above `min` power, at most one in `gap` m of the last */
    step: Object.freeze({ min: 0.5, gap: 2.6, alpha: 0.5 }),
    /** the scorch map, charred ONLY where no grass grows (paving: the cells' fuel is under
     *  FIRE.minFuel either way, so no fire burns differently), no heat, no random draw */
    char: Object.freeze({ blast: 0.5, beam: 0.75 }),
  }),
});
