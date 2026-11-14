// The Starless Lord's numbers (COMBAT.md → "The Starless Lord"). Starting values: tune them in the
// Lab. Per-form values are [form 1, 2, 3, 4]. Times in seconds, distances in metres.
//
// Four blade forms, each with its own health bar (the owner's pick: "four bars, a deathblow each"):
//   1  one blade, the free hand casting        2  twin blades
//   3  the blades joined into a long staff     4  one cross-hilted blade, wreathed in the Void
// A bar emptied, or his posture broken, leaves him on one knee: the deathblow (the hero's execution)
// ends that form and he rises into the next; the fourth deathblow kills him.
export const TUNING = {
  name: 'VARR NIHIL, THE STARLESS LORD',
  forms: 4,
  hp: 1400, // each form's bar
  phaseAt: [1], // no gates inside a bar (the boss bar draws no ticks)
  radius: 0.42, // body circle (the hero is pushed out of it)
  bound: 20, // (a circle round the seal that holds the whole hall: the real limit is `hall`)
  // he stays on the hall's floor: between the walls, off the dais, inside the door (world/throneHall.js
  // HALL: halfX 14.3, the dais from z -13.5, the south wall at z 16). A rectangle, not the duelist's
  // circle: a hero backed into a corner or against the door is still in his reach
  hall: { x: 13.0, zN: -12.3, zS: 15.0 },

  // ---- tells (rules: COMBAT.md; checked by tests/integration/lord.mjs). Faster than Shen Hui and
  // ramping (the owner's pick): a string's follow-up windups 0.34 s in form 1 (Shen Hui's) down to
  // 0.28 s in form 4 (windupScale), so its blows land 0.42 → 0.36 s apart; every hit still cued by
  // its flash
  flashLead: 0.26, // the glint this long before every impact (<= the tightest gap: each flash after the hit before it)
  minFirstWindup: 0.4, // a move's first real hit, every form
  minHitGap: 0.34, // impact to impact inside a move
  windupScale: [1, 0.94, 0.89, 0.83],
  recoveryScale: [0.9, 0.85, 0.8, 0.72],
  // the step-in through a windup (duelist/brain.js close-in)
  close: { first: 3.0, next: 1.5, speed: 13 },

  // ---- posture (POSTURE.parry in combat/rules.js for parries). The Sekiro rule: his posture is
  // hard to move while his bar is full and gives way as it empties: every gain × lerp(gainByHp) by
  // the bar's missing fraction, and it recovers faster the fuller the bar (regenByHp)
  posture: {
    max: [460, 500, 540, 600],
    hit: { light: 5, heavy: 16 },
    guard: { light: 8, heavy: 20 },
    regenDelay: 2.2,
    regenRate: 22,
    gainByHp: [0.45, 1.25], // posture gain × this: [bar full, bar empty]
    regenByHp: [1.5, 0.5], // regen rate × this: [bar full, bar empty]
    breakTime: 4.5, // on one knee, waiting for the deathblow
    breakCritMult: 1.5,
    // a break nobody answered: he rises with this much of the bar back (if it was empty) and half the meter
    spared: { hp: 0.2, posture: 0.5 },
  },

  // ---- his guard (as the Ash Disciple's: the front arc, in footwork and early in a windup)
  guard: {
    arc: 1.31,
    raiseDelay: 0.16,
    windupOpen: 0.5,
    counterChance: [0, 0.4, 0.75, 1],
    countWindow: 2.5,
    crushPoise: 48,
    clashStop: 0.07,
  },
  flinch: { breakOff: 2, window: 1.6, hitStun: 0.22 },
  hitStun: { light: { stop: 0.065, jolt: 0.6, push: 0.12 }, heavy: { stop: 0.1, jolt: 1, push: 0.3 }, critStop: 0.12, joltDecay: 5 },
  parts: { head: 1.3, body: 1, leg: 0.9 },

  // ---- the deathblow (a broken lord, player.js _tryExecution → onExecute)
  execRange: 3.4,
  ghostepBehind: 1.5,
  execution: { damage: 260 }, // (shown as the deathblow's number; the form ends whatever it is)

  // ---- footwork: he circles only inside striking range, runs outside it, sprints past sprintAt
  move: {
    walk: 2.4,
    run: 6.0,
    sprint: 9.2,
    turn: [8, 9, 10, 11],
    trackTurn: [14, 15, 16, 18],
    band: [1.8, 3.4],
    sprintAt: 5.5,
    near: 1.1,
    backChance: 0.3,
    backstep: { dist: 2.2, time: 0.36 },
    strafeSwitch: [0.9, 2.0],
  },
  idleGap: [[0.14, 0.4], [0.1, 0.32], [0.08, 0.26], [0.05, 0.18]], // s of footwork between moves per form
  chain: [0.4, 0.5, 0.55, 0.65], // the chance a move flows straight into the next
  punish: { weight: 4 }, // a hero drinking a flask: the moves that close distance × this

  // ---- the duel's moments (as the Ash Disciple's, ADR-062)
  fullDeflect: { minHits: 5, posture: 70 },
  lock: { start: 0.5, push: 0.085, decay: [0.32, 0.35, 0.38, 0.42], dur: 2.6, hold: 0.6, posture: 110, shove: { damage: 12, knockback: 2.6 }, camera: { zoom: -7, weight: 0.55 } },
  mikiri: { posture: 130 },
  cinematic: { zoom: -10, weight: 0.6, slowmo: 0.28, dur: 0.9 },
  // every blow he deals (moves.js damage, the spells) × this
  damageScale: 1.1,

  // ---- the blade forms' ignition (the transition into forms 2-4): a red shock ring round him
  ignite: { ringRadius: 6.5, damage: 12, knockback: 7 },

  // ---- the Void spells (lord.js / fx.js). Thrown things cue themselves `flashLead` before they
  // reach the hero (too late: they fizzle), as the wyrm's bullets and the Ash Crescent do
  crescent: { speed: 14, radius: 0.7, life: 2.2, chip: 0.25 }, // red sword-light off a cut (form 4)
  push: { speed: 12.5, radius: 0.8, half: 2.4, life: 1.9 }, // the Void push: a wall of force along the ground
  bolt: { range: 17, width: 1.7, returnDamage: 55, returnPosture: 34 }, // Void lightning (a perfect parry sends it back)
  pull: { range: 11, drag: 5.5 }, // the Void pull: dragged this far toward him
  glaive: { speed: 15, back: 17, range: 12.5, radius: 0.9, life: 3.2 }, // the thrown blade: out, then back to his hand
  debris: { speed: 16, radius: 0.8, life: 2.4, gap: 0.42, rise: 1.9 }, // hurled stones, `gap` s apart
  storm: { radius: 2.3, warn: 0.95, gap: 0.5, lead: 0.5 }, // called lightning: marked ground, then the strike

  // ---- the intro: he rises from the throne and leaps down to the seal
  wakeRadius: 10,
  // (seatY: the root's height while he sits; daisY: the dais's top tier; stand: how far in front of
  // the seat he stands up; then the leap to `land`, on the seal's northern edge)
  intro: { seatY: 0.74, daisY: 0.52, stand: 1.0, land: { x: 0, z: -5.5 }, leapFrom: 1.5, leapTo: 2.5, apex: 2.6 },
};

/** Value for the form (1-based) from a per-form array, or the value itself. */
export function perForm(v, form) {
  return Array.isArray(v) ? v[Math.min(v.length, Math.max(1, form)) - 1] : v;
}
