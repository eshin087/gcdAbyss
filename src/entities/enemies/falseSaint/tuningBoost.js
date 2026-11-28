// The False Saint's boosters' numbers (the BOOST AGENT's file: the booster punch, the rapid flurry of the
// plated arm, the jet dash footwork, the dive, the jet strings, the overclock passes, the last grab). Read
// as TUNING.boost (tuning.js merges it). Times in seconds, distances in metres, damage before
// TUNING.damageScale (1.6); per-phase values [P1, P2, P3, P4]. Windups not marked fixed shrink by
// TUNING.windupScale [1, 0.94, 0.88, 0.84]; the data rules (saint.mjs DATA) hold in every phase.
export const TUNING_BOOST = {
  // ---- CENSER STEP, his jet step (FsBoost.footwork; `on` is its switch):
  // from phase `from`, a hero further than `at` m is closed on a jet: `pre` s of the boosters lighting
  // (he does not move), then a straight dash at `speed` m/s that stops `stop` m short of the hero (never
  // through him), `max` m at most, an afterimage where he left. From phase `zig` the dash is two legs: the
  // first `zigAng` rad off the line for `zigShare` of the way, the second onto the stop point. The last leg
  // DECELERATES (`decel` m/s^2) to zero and he lands in the deep planted stop (the owner's v04 pack, A12 /
  // B4) held `brake` s. `every` s between dashes (the hero can still walk away). `hover`: his height in
  // footwork from phase 3 (stiff, on the thrusters; 0 = on the floor). The dash deals nothing. In a molten
  // pool he jets (from phase 2; walks in phase 1) out of it to `poolOut` m past its rim.
  // (the tuning pass: `pick` [P1..P4], the share of the picks made with the hero past `at` that wait for the
  // step first (saint.js FsBrain._stepFirst; one roll per `pickEvery` s): in phase 4 his ranged moves took
  // every pick at range and he never stepped. Then at 6.5 / 6 / 5.5 m, every 3.4 / 2.7 / 2.1 s: more often
  // with each phase now)
  step: {
    on: true, from: 2, at: [99, 6, 5.5, 5], every: [99, 3.0, 2.3, 1.7], pick: [0, 0.3, 0.45, 0.6], pickEvery: 0.6, speed: [22, 22, 25, 29], stop: 2.4, max: 10, pre: [0.12, 0.12, 0.1, 0.09],
    zig: 3, zigAng: 0.62, zigShare: 0.45, decel: 60, brake: [0.3, 0.3, 0.26, 0.22], hover: [0, 0, 0.2, 0.24], hoverEase: 7, scorch: 0.35, poolOut: 1.2,
  },
  // ---- THE BRAKE (every booster move's stop: the jet step, the punch's carry and its parried skid, the
  // passes): the sole planted, a scuff `scuff` m long on the plates (world.groundBlow 'dash', `power`), dust
  // (fx.dust, `dust`) (the v04 pack, C2)
  brake: { scuff: 1.2, power: 0.35, dust: 1.0 },

  // ---- VOTIVE FIST, the booster punch (P2+, blue, a parry moment): the elbow's jet lights from `jetFrom`
  // of the windup (the tell, held at the coil from `cock` to `dashFrom`), then he crosses up to `reach` m in
  // a blink behind the fist and stops `stop` m short of the hero. A miss (rolled, whiffed) CARRIES ON
  // `carry` m along the line at `carrySpeed` (everything on it struck at fist height `y`, `power`; a
  // crater of `crater` m where it ends), and the punch's wave goes on `wave` m past that at `waveK` of the
  // power (his body stops at his floor's edge, 13.8 m; the set's pieces stand from 16 m). Parried:
  // `parryPosture` more posture than any blue parry, and he skids `overshoot` m past the hero's side.
  votive: {
    windup: 0.95, cock: 0.62, jetFrom: 0.1, dashFrom: 0.86, reach: 10, stop: 1.3, damage: 30, knockback: 6.5, blockPush: 4.5,
    y: 1.25, w: 0.9, power: 2.4, carry: 3.4, carrySpeed: 26, crater: 1.6, craterPower: 2.2, wave: 4.5, waveK: 0.75, parryPosture: 90, overshoot: 1.5,
    weight: [0, 1.3, 1.15, 1.0], cooldown: [9, 5.2, 4.4, 3.8], band: [2.2, 11], recovery: 0.95,
  },

  // ---- ROSARY, the plated arm's rapid flurry (his flurry from P2; DEFENSE.foeStreak launches it): `first`
  // the jet-lit coil, then the pistons in groups of three (`beat`: short, short, long: the stutter), the
  // `chance` beats drawn (7 - 10 blows in all), the last a blue parry moment. Every blow chips what stands
  // `side` m beside the hero (`chip` power).
  // (the tuning pass: `guardCost` / `lastGuardCost`, what a blocked piston / the blocked last blow costs the
  // hero's guard meter (100; GUARD.cost would be 16 a piston, 52 the last): a guard held through the whole
  // flurry holds it now, as a held guard holds every duelist's flurry (training foeBlock). `close` 1.0 -> 0.6: a piston chasing a
  // roller stepped in 1.6 m (x pressure.pursue.closeK) and caught him out of a 4.2 m roll. Measured before: the
  // guarding bot took 630 of its P2 damage from Rosary, its guard broken at the 7th piston)
  rosary: {
    first: 0.72, beat: [0.41, 0.41, 0.55], last: 0.56, active: 0.05, damage: 10, knockback: 0.9, lastDamage: 22, lastKnockback: 5.5, guardCost: 6, lastGuardCost: 34,
    middle: 8, chance: [3, 5, 7], p: 0.5, reach: 1.95, side: 1.35, chip: 0.7, close: 0.6, recovery: 0.85,
  },

  // ---- DESCENT, the dive knee (P3+, red): up `h` m on the back thrusters by `rise` of the windup, the
  // mark on the floor follows the hero until `lock`, he drifts over it, dives from `fall` (the glint), and
  // lands knee-first: a ring of `r` m, a crater, the plates thrown (`power` over `r + 0.8`).
  descent: {
    windup: 1.55, cock: 0.86, rise: 0.3, lock: 0.74, fall: 0.84, h: 7.5, short: 1.2, r: 2.8, damage: 34, knockback: 6, power: 3.4, mark: 3.0,
    weight: [0, 0, 1.0, 0.8], cooldown: 9, band: [3, 14], recovery: 1.05,
  },

  // ---- THE JET STRINGS (P3+): Censer Wheel (the booster punch, a jet-spun back elbow, a rising jet kick:
  // blue, n, blue) and Thurible (the elbow, the kick, the booster punch out of the air: n, blue, blue)
  strings: {
    elbow: 0.46, elbowFirst: 0.75, elbowDamage: 16, elbowKnockback: 2.2, elbowReach: 1.8,
    kick: 0.52, kickDamage: 24, kickKnockback: 5, kickReach: 2.15, kickLift: 0.85,
    airPunch: 0.8, airReach: 7,
    wheel: { weight: [0, 0, 1.3, 1.3], cooldown: 7, band: [3, 10], recovery: 0.85 },
    thurible: { weight: [0, 0, 1.3, 1.3], cooldown: 7, band: [0, 3.4], recovery: 0.85 },
  },

  // ---- VESPERS, OVERCLOCK (P4): `passes` jet-streak passes through the hero from the sides `turns` (rad
  // round the hero from where he stood), each announced: the set (`set` s: he jets to its launch point
  // `launch` m out and the line shows), then the pass (`windup`; he leaves `dist / speed` s before the
  // impact and runs `over` m past). The last comes from above (`high` m up, red, a ring of `lastR`).
  vespers: {
    passes: 4, turns: [0, 2.05, -2.05, 1.0], set: 0.32, windup: 0.62, active: 0.18, launch: 6.2, speed: 44, over: 3.2, track: 0.62, y: 1.15, w: 0.8,
    damage: 20, knockback: 3.5, r: 1.35, power: 1.6,
    lastSet: 0.42, lastWindup: 0.66, lastDive: 0.24, high: 6, lastLaunch: 4.5, lastDamage: 30, lastKnockback: 6, lastR: 2.4, lastPower: 3.0,
    weight: [0, 0, 0, 1.6], cooldown: 14, band: [0, 12], recovery: 1.2,
  },

  // ---- LAST RITE (P4, once, under `below` of his bar): he stops, the core whines through a long red windup
  // (`windup`, fixed), and lunges `reach` m to embrace. Dodged or missed: he stands wide open (his posture
  // breaks: the deathblow's chance). Caught: a heavy blast (never the hero's last HP: at most his HP - 1)
  // and a ring of `blastR` m that bites the world.
  rite: { below: 0.08, windup: 1.75, cock: 0.84, dashFrom: 0.88, reach: 5, stop: 0.9, damage: 60, knockback: 7, blastR: 4.5, power: 3.2, weight: [0, 0, 0, 1], boost: 60 },
};
