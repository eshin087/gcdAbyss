// The False Saint's terrain numbers (the TERRAIN AGENT's file: the foundry as his weapon, the molten
// pools' damage to the hero and to him, the transitions' world effects). Read as TUNING.terrain (tuning.js
// merges it). The handler: terrain.js FsTerrain; the moves: moves/terrain.js; the poses: posesTerrain.js.
// Times in seconds, distances in metres, damage before TUNING.damageScale (1.6) unless it says raw; POWER in
// the world's units (world/breakTuning.js: 1 fells a tree; metal takes a cut at 0.3; the set's pieces:
// world/lastFoundry.js FOUNDRY_TUNING: a frame 0.8, a tank 0.9, a girder 2.4, ingots 2.2, a column 3.2, the
// press's head 4.5). Every number a move reads is here (content is data).
export const TUNING_TERRAIN = {
  // ---- THE MOLTEN POOLS (FsTerrain._molten): a pool the set lays (foundry.molten.add: a spilled ladle, his
  // Crucible's splash) is cued RED as it lands (`arm` s before it burns: combat:tell, combat:flash with
  // `hazard`, the brain's ledger), then burns whoever stands in it every `tick` s for its life.
  //   the hero: `hero` damage (x damageScale: 14.4 of his 160), thrown out to `rim` m past its edge (at least
  //     `knockback` m): one burn per entry, never a trap. Never on a hero who is down; `grace` s after he is
  //     up (or let go of a hold) before the first. Red, unblockable, unparryable; a roll's i-frames pass
  //     through it (no perfect dodge, no plunge: a pool is no blow to answer).
  //   him: `boss` damage (raw) and `posture`, `strip` of his shell (d.onMolten), at most once per `tick`
  //     (his stagger in it at most every `staggerEvery` s: saint.js onMolten).
  // MEASURED (saint.mjs trPools): from a fresh pool's middle (the worst place) a roll started `arm` - 0.1 s
  // after its cue clears it unburnt (the roll's i-frames 0.04 - 0.4 s, 4.2 m); a walk out from its middle
  // takes one burn; standing at its rim, a step clears it.
  // (the tuning pass: his `posture` 70 -> 35 a burn: a pool of his own making broke him in the pace runs, P2
  // broken 6 - 9 % of the time against a hero who never struck; a pool still strips him and costs him the bar)
  molten: { arm: 0.55, tick: 0.5, hero: 9, knockback: 2.2, rim: 0.7, grace: 0.5, boss: 60, posture: 35, strip: 0.06, pad: 0.15, staggerEvery: 2.5 },

  // ---- EVERY TERRAIN MOVE: no more than `max` of them start inside `window` s, none while something of
  // his is still in the air or held (Bai Wuji's precedent: never a rain of wreckage). `maxDelay` s: the
  // fairness guard may hold a thrown piece's landing that long; past it, the piece lands uncued and harmless.
  pace: { window: 9, max: 1 },
  maxDelay: 0.6,
  // ---- THE FETCH (Relic, Offertory): he jets to the piece (a jet hop: the calf and back jets lit, the
  // afterimage where he left), plants (the deep stop) and tears it up. The piece must be within `find` m of
  // him; where he stands for it (the side of it toward the hero, or the nearest open side) at most `out` m
  // past his circle (FOUNDRY.floor.r 13.8) and inside the casting floor (|x|, |z| <= `square`): out there for
  // the length of the move, then he walks back in at `home` m/s (FsTerrain.footwork / frame). `hop` the
  // share of the fetch's windup the hop takes ([from, to] u), `take` the u he tears it up at.
  // (the tuning pass: `find` 11 -> 13: the corner tanks stand 16.7 m from the middle, so Offertory found one
  // ~1 % of the time in phase 3 (they were whole: saint.mjs tuneFight counts them at each phase's start))
  fetch: { find: 13, out: 3.4, square: 14.6, gap: 0.55, hop: [0.12, 0.62], take: 0.84, home: 7, minHero: 4 },

  // ---- CRUCIBLE (P3+, red mark): a full ladle within `reach` m of the hero. His forearm gun is raised at
  // its chain (the red sight line to it) through the windup; the pools' marks are fixed at `fix` u of it:
  // the ladle's spill under it (FOUNDRY_TUNING.molten.spill r 2.6) and, the hero standing past `under` m
  // from it, the SPLASH (`splash` r, `life`) where he stood (at most `splash.max` m from the ladle, along the
  // ladle -> hero line: the crucible bursts and its steel throws that way). The shot (a bolt `bolt` m/s) cuts
  // the chain (foundry.drop(L, 'boss')); the pools are cued as they land and burn `arm` s later.
  crucible: { reach: 6.2, under: 2.4, fix: 0.3, bolt: 70, splash: { r: 1.9, life: 11, max: 4.6 }, selfK: 0.6 },

  // ---- RELIC (P3+, blue, the flare on the piece): a frame / a girder / an ingot stack fetched, hoisted, and
  // thrown at where the hero will be `lead` s on, `speed` m/s (a flight of `time`, at least `minFlight`). It
  // strikes the hero within `hit` m of where it lands (damage by kind; `knockback`; parried: it breaks on the
  // hero's blade in front of him and costs him `parryPosture`; blocked: the guard's chip). It bites what it
  // flies through low (the world's thrown piece) and bursts where it lands (`power` over `radius` x its weight).
  relic: {
    kinds: ['girder', 'ingots', 'frame'],
    damage: { girder: 26, ingots: 24, frame: 18 },
    knockback: 5, hit: 1.7, lead: 0.18, speed: 20, time: [0.55, 1.0], minFlight: 0.55, parryPosture: 22,
    power: 1.4, radius: 2.2, mark: 1.2, hold: 2.15,
  },

  // ---- OFFERTORY (P2+, red, the flare on the tank): a gas tank fetched and KICKED low at the hero (a
  // flight of `time`, `speed` m/s, `lead` s led); where it lands it BURSTS: the set's tank blast
  // (foundry.boom: FOUNDRY_TUNING.tank: r 3.2 power 1.6 on the world; the hero within 2.6 m: 16 raw,
  // knockback 4). The red flare on the tank flashLead s before it lands; a roll at it clears the blast.
  // Uncued (the fairness guard): it lands a dud (it breaks, no burst).
  offertory: { speed: 17, time: [0.6, 1.0], minFlight: 0.6, lead: 0.12, dud: 0.9 },

  // ---- PROSTRATION (P3+, red, the world's strip): a column of the hall within `reach` m of the hero (at
  // least `min` m), standing: his eye's laser cuts its foot (the red sight line through the windup, the
  // white line in its last `laser` u), and it comes down across the floor ON the hero's place (destructibles
  // topple: the world marks its strip, cues it, strikes what stands under it, and the hero under it: 22 x its
  // weight, knocked back; FOUNDRY column fallT 1.3 s). The runway section on its top comes down with it.
  prostration: { reach: 8.6, min: 2.2, laser: 0.22, footY: 0.7 },

  // ---- DIES IRAE (P4, red, the shock's front): his forearm gun into the press's ram (`bolt` m/s): the press
  // slams, and a SHOCK runs out across the whole floor from it at `speed` m/s (from `r0` m, out to `r1`),
  // `band` m deep. Each piece it passes is struck (`power` at the press, falling off to `farK` of it at r1;
  // a plate `plate` x that); it reaches the hero once: `damage`, `knockback` m out along it (red,
  // unblockable: a roll through the front). The slam bites the press (`slam` power at its ram: about six
  // slams bring its head down; then the move is gone). Cued on the front: the tell at the slam, the flash
  // flashLead s before it reaches the hero (his own way toward or away from it counted in).
  // (the tuning pass: `plate` 0.45 -> 0.25: from phase 4's start (28 % of the plates already broken by then) three slams
  // broke 74 % of the floor (saint.mjs tuneWreck); now they crack more than they break, about half left whole or chipped)
  diesIrae: { bolt: 70, speed: 15, r0: 2.6, r1: 38, band: 1.4, damage: 22, knockback: 3, power: 1.6, farK: 0.15, plate: 0.25, slam: 1.0, aimY: 4.6, gridStep: 0.6 },

  // ---- THE TRANSITIONS' WORLD (FsTerrain.onMoment, called by saint.js _moment in place of its one push ring;
  // until that edit is made, FsTerrain._change adds the rest on top of core's 7 m ring at 2.2): at the
  // change's impact, round where he stands
  //   2 THE SKIN BREAKS   a small shock: the ring `ring` (r, power), a front of dust `shock` m, the plates under
  //                       him cracked (`crack` over `crackR`)
  //   3 WEAPONS FREE      the lift's blast ring (`ring`): `plates` floor plates torn up from `rIn` m out (the
  //                       nearest whole ones, at most rOut + rim m) and thrown out `throw` m further (they burst
  //                       where they land), a jet burst under him
  //   4 TRUE FRAME        the core vent's nova (`ring`): `plates` plates thrown, every standing piece within
  //                       `reach` m struck (`power`, falling off to `farK` at the edge), the furnace roaring (the
  //                       ambience's flare, `flare`)
  change: {
    2: { ring: { r: 3.2, power: 0.9 }, shock: 3.2, crack: 0.5, crackR: 2.6 },
    3: { ring: { r: 4.6, power: 1.8 }, plates: 8, rIn: 2.2, rOut: 4.6, rim: 5, throw: [3, 5.5], flight: [0.55, 0.8], shock: 5 },
    4: { ring: { r: 7, power: 2.4 }, plates: 14, rIn: 2.0, rOut: 6.0, rim: 5, throw: [4, 8], flight: [0.6, 0.95], reach: 16, power: 1.6, farK: 0.3, flare: 1, shock: 8 },
  },
};
