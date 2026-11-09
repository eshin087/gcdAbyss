// Fire / flight attacks and spells (contract 3, docs/ARCHITECTURE.md "Hazards and fire attacks").
// Registered into TUNING.attacks by tuning.js (Object.assign), so the Lab, abilities() and hitPlayer
// read them like every other attack. The performances live in fireAttacks.js, the background
// threats (meteors, pillars, fire strips / rings / walls) in hazards.js.
//
// Units: seconds (phase-1 values; windups and recoveries x d.tScale in later phases, the airborne /
// travelling parts keep their speed), WORLD metres (hazards are not body-linked: they are sized
// against the 1.8 m hero, not the wyrm), HP. `phase` = the first phase the AI uses it in (the Lab
// can force any); `weight` = AI weight per phase [P1, P2, P3] (0 = never picked there), applied by
// each attack's weight(d, s) together with its range gate; `cooldown` s after it ends.
// Every hit is red (dodge-only): it glows / rings red through its windup and flashes flashLead s
// before impact (docs/COMBAT.md). Hazard hits pass `plunge: false` (dodging a meteor never
// teleports); the dive bomb's crash and the nova pass the default (a perfect dodge may plunge).

import { TELL } from '../../combat/rules.js';

export const FIRE_ATTACKS = {
  // takes off with heavy downbeats, flies low over the player in a line breathing fire down; the
  // fire front ignites a strip that keeps burning (contact ticks), then lands on the far side
  skyStrafe: {
    label: 'Burning pass (sky strafe)', tell: TELL.RED, phase: 1,
    windup: 1.0, takeoff: 0.75, pass: 1.9, land: 1.05,
    alt: 7, // root altitude of the pass (m): the head stays > 6 m up, out of sword reach
    frontLead: 8, // the fire front runs this far ahead of the root (the mouth ~5 m + the stream's reach)
    reach: [24, 40], // landing distance along the line: player distance + 14, clamped to this (and the bound)
    strip: { start: 10, width: 4.6, linger: 2.5, tick: 0.25, tickDamage: 4, tickBurn: 1.0 },
    damage: 26, burn: 2.0, knockback: 4,
    minDist: 7, maxDist: 34,
    weight: [0.9, 1.4, 1.2], cooldown: 16,
  },
  // climbs ~14 m, hovers and tracks the player (red ring under it), then dives onto the spot; the
  // crash landing's shockwave is the hit (a perfect dodge may plunge onto its head)
  diveBomb: {
    label: 'Sky dive (dive bomb)', tell: TELL.RED, phase: 2,
    windup: 0.8, climb: 1.1, hover: 1.2, dive: 0.5, recovery: 1.4,
    alt: 13, hoverBack: 9, // hovers this far beside the target (east / west, so it stays on screen)
    track: 2.6, lead: 0.35, // the target ring follows the player (exp rate /s, velocity lead s) until the dive
    radius: 7.5, damage: 34, burn: 1.0, knockback: 7,
    minDist: 0,
    weight: [0, 1.6, 1.4], cooldown: 15,
  },
  // rises ~9 m and spits 3-5 fireballs while hovering; each shell's landing spot rings red from
  // `aim` s before the spit; then it lands
  hoverBarrage: {
    label: 'Hover barrage', tell: TELL.RED, phase: 2,
    windup: 0.8, rise: 1.0, aim: 0.4, interval: 0.5, land: 1.2,
    shots: [3, 5], // random count, inclusive
    alt: 9, standoff: 13, // hovers this far beside the player (east / west, so it stays on screen)
    lead: 0.55, // aim lead (s of the player's velocity)
    radius: 3.2, damage: 15, burn: 1.2, knockback: 2.5, maxHits: 2,
    minDist: 0,
    weight: [0, 1.4, 1.2], cooldown: 13,
  },
  // roars skyward and spits a shell up; 8-14 meteors then fall over ~5 s in red rings (a background
  // hazard: the wyrm keeps fighting). Every `ledEvery`-th one is led onto the player
  meteorRain: {
    label: 'Meteor rain', tell: TELL.RED, phase: 2,
    windup: 1.0, cast: 0.7, recovery: 0.8,
    count: [[8, 11], [8, 11], [11, 14]], // per phase [min, max]
    first: 1.3, span: 5.0, // s after the cast: the first impact, the spread of impacts
    warn: 1.5, warnLed: 1.1, ledEvery: 3, spread: [4, 14], // ring warning (s); random meteors land 4-14 m from the player
    fall: 0.75, // s of the visible fall before impact
    radius: 3.4, damage: 18, burn: 1.5, knockback: 3, maxHits: 3,
    weight: [0, 1.3, 1.4], cooldown: 24,
  },
  // slams the forefeet: lava pillars erupt in a line toward the player one after another (each
  // rings >= `first` s); in phase 3 a chasing variant spawns pillars under the player for ~3 s
  eruptions: {
    label: 'Fire eruptions', tell: TELL.RED, phase: 2,
    windup: 0.9, slam: 0.2, recovery: 1.5,
    line: { start: 5.5, step: 3.4, beyond: 7, max: 9, first: 0.65, delay: 0.11 },
    chase: { chance: 0.6, time: 3.0, every: 0.42, warn: 0.7, lead: 0.3, maxHits: 2 },
    radius: 2.4, active: 0.3, damage: 20, burn: 1.2, knockback: 4,
    minDist: 6, maxDist: 28,
    weight: [0, 1.5, 1.4], cooldown: 11,
  },
  // a ring of fire ignites round the wyrm and expands outward: roll through it (or be beyond r1)
  flameRing: {
    label: 'Flame ring', tell: TELL.RED, phase: 2,
    windup: 1.1, cast: 0.25, recovery: 1.0, // recovery >= the ring's travel to r1
    r0: 3.0, r1: 20, speed: 10, width: 2.2, // r0 round the root: the band covers the flanks from ignition
    damage: 24, burn: 2.0, knockback: 4,
    maxDist: 14,
    weight: [0, 1.4, 1.2], cooldown: 12,
  },
  // a wall of fire springs up in front of the wyrm and sweeps across the arena: roll through it
  // (i-frames) or get behind the wyrm
  flameWall: {
    label: 'Flame wall', tell: TELL.RED, phase: 3,
    windup: 1.2, cast: 0.3, recovery: 1.0, // recovery >= the sweep
    start: 4, length: 40, width: 2.4, speed: 10, sweep: 30,
    damage: 28, burn: 2.0, knockback: 5,
    weight: [0, 0, 1.6], cooldown: 14,
  },
  // 2.5 s charge (white-hot body, embers sucked in, rising sound), then an arena-sized blast: flee
  // beyond the radius or perfect-dodge it (plunge). Also the phase-3 opener (dragon-melee's ai.js)
  nova: {
    label: 'Inferno nova', tell: TELL.RED, phase: 3,
    windup: 2.5, blast: 0.45, recovery: 1.6,
    radius: 22, damage: 70, burn: 3, knockback: 10,
    weight: [0, 0, 0.7], cooldown: 32,
  },
};
