// The Ash Disciple's numbers (docs/specs/ash-disciple.md; COMBAT.md → "The Ash Disciple"). Starting
// values: tune them in the Lab. Per-phase values are [P1, P2]. Times in seconds, distances in metres.
export const TUNING = {
  name: 'SHEN HUI, THE ASH DISCIPLE',
  hp: 3000, // a near-perfect fencing bot (tests/integration/duel.mjs WIN) wins in about a minute
  phaseAt: [1, 0.5], // HP fractions where each phase starts (the boss bar's ticks)
  radius: 0.42, // body circle (the hero is pushed out of it)
  bound: 12.5, // he stays this close to the courtyard's centre (min with CONFIG.world.dragonBound)

  // ---- tells (rules: COMBAT.md; checked by the duel tests)
  flashLead: 0.35, // the glint this long before every impact
  minFirstWindup: 0.7, // a move's first real hit, every phase
  minHitGap: 0.45, // impact to impact inside a move
  windupScale: [1, 0.92], // the windups of later phases (moves are authored with first windups >= 0.78)
  recoveryScale: [0.88, 0.75],

  // ---- posture (POSTURE.parry in combat/rules.js for parries)
  posture: {
    max: [320, 380],
    hit: { light: 5, heavy: 16 }, // weapon hits that land
    guard: { light: 8, heavy: 20 }, // weapon hits his guard deflects
    regenDelay: 2.5,
    regenRate: 20,
    breakTime: 3.2,
    breakCritMult: 1.5, // (the wyrm's 2.2: for a duelist the execution is the reward of a break)
  },

  // ---- his guard
  guard: {
    arc: 1.31, // rad either side of his facing (75°)
    raiseDelay: 0.18, // after a move's recovery, a stagger or a recoil ends (a clash or a flinch: at once)
    windupOpen: 0.55, // in a windup his guard holds until this fraction of it (he commits to the strike)
    counterChance: [0, 0.35, 0.7, 1], // on the 1st, 2nd, 3rd, 4th+ guarded strike in a row
    countWindow: 2.5, // guarded strikes further apart than this start the count over
    // a heavy strike with at least this much posture crushes it: the charged thrust from ~90 % charge
    // (player/combat.js THRUST.poise 30..50); the chain's slam (40) is turned aside like any other
    crushPoise: 48,
    clashStop: 0.04, // hit-stop on a clash
  },
  // strikes that land on him outside his attacks: after `breakOff` of them within `window` he backsteps
  flinch: { breakOff: 2, window: 1.6, hitStun: 0.22 },
  parts: { head: 1.3, body: 1, leg: 0.9 },

  // ---- the execution (a broken disciple, player.js _tryExecution → onExecute)
  execRange: 3.2,
  // ---- the Ghostep behind him (player.js _ghostep reads attacker.ghostepBehind; the wyrm's 3.2 m
  // is out of sword reach of a man's back)
  ghostepBehind: 1.5,
  execution: { damage: 260 },

  // ---- footwork
  move: {
    walk: 1.7, // circling with the guard up
    run: 4.4,
    turn: [7.5, 9], // rad/s while tracking in a windup or circling
    band: [3.0, 5.6], // he likes to stand this far off
    far: 7.5, // further than this: run in (or close with Wind Step / throw Ash Crescents)
    near: 1.9, // closer than this: often backsteps out
    backstep: { dist: 2.4, time: 0.42 },
    strafeSwitch: [1.4, 3.0], // s between changes of circling direction
  },
  // PBZ pace (owner, 2026-11-12: "relentless"): short breathers, and after a move he often flows
  // straight into the next one without footwork (`chain`: the chance per move end, per phase)
  idleGap: [[0.25, 0.6], [0.15, 0.42]], // s of footwork between moves [min, max] per phase
  chain: [0.35, 0.55],

  // ---- the duel's moments (ADR-062)
  // the full deflect: every real hit of a string of at least `minHits` parried → he reels (react
  // 'reeling'), +`posture`, a cinematic moment
  fullDeflect: { minHits: 5, posture: 70 },
  // the blade lock: a PERFECT parry (DEFENSE.perfectParryWindow) of a blow marked `lock` crosses the
  // blades (player.startBladeLock): the hero's presses push the meter up `push` each, he pushes it down
  // `decay` per s (per phase); full wins, empty loses, and when `dur` s run out the hero wins if he
  // held it at `hold` or above (a tug of ~1.5 s at 8 presses a second; 5 a second just holds; none
  // loses in ~1.5 s). Won: he reels, +`posture`. Lost: he shoves the hero (`shove`) and counters.
  lock: { start: 0.5, push: 0.085, decay: [0.32, 0.38], dur: 2.6, hold: 0.6, posture: 110, shove: { damage: 12, knockback: 2.6 }, camera: { zoom: -7, weight: 0.55 } },
  // the mikiri: a roll INTO a perilous thrust (a beat marked `mikiri`) steps on his blade (player.js
  // _mikiri): he is pinned and stumbles (react 'trampled'), +`posture`
  mikiri: { posture: 130 },
  // the cinematic moment (flow.cinematic): the camera `zoom` m closer, leaning `weight` toward the
  // clash, time × `slowmo` for `dur` real seconds
  cinematic: { zoom: -10, weight: 0.6, slowmo: 0.28, dur: 0.9 },
  // every blow he deals (moves.js damage, the Ash Crescents) × this: the probe bots set it (a bot reading
  // 70 % of the tells should be on the edge, one reading 85 % should win)
  damageScale: 1.35,

  // ---- the phase-2 transition (the kindling)
  transition: { ringRadius: 6, damage: 10, knockback: 6 },

  // ---- the projectile (Ash Crescent)
  crescent: { speed: 14, radius: 0.7, life: 2.2, chip: 0.25 },

  // ---- the intro: he wakes when the hero crosses the gate or comes this close (flow also checks)
  wakeRadius: 9,
};

/** Value for the phase (1-based) from a per-phase array, or the value itself. */
export function perPhase(v, phase) {
  return Array.isArray(v) ? v[Math.min(v.length, Math.max(1, phase)) - 1] : v;
}
