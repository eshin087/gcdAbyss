// Bullet-hell tuning (docs/COMBAT.md "Bullets"): the small projectiles of bullets.js and the four
// patterns of bulletAttacks.js. Registered into TUNING (tuning.js): TUNING.bullets = BULLETS,
// Object.assign(TUNING.attacks, BULLET_ATTACKS), so the Lab, abilities() and hitPlayer read the
// patterns like every other attack.
//
// Units: seconds (phase-1 values; windups and recoveries x d.tScale in later phases, the bullets
// keep their speed), WORLD metres (bullets are sized against the 1.8 m hero), HP, radians.
// Per-phase values are [P1, P2, P3]. `weight` = AI weight per phase (0 = never picked there).
//
// The rule of the bullets: EMBERS (orange, normal tell) and WISPS (blue, homing) can be parried one
// by one (each deflect sends the bullet back at the wyrm's head and adds `posture`), blocked for
// chip, rolled through or cut out of the air with a swing; ORBS (red) are dodge-only like every
// red attack. Bullet damage is NOT scaled by TUNING.damageScale: these are the final numbers.

import { TELL } from '../../combat/rules.js';

export const BULLETS = {
  ember: { tell: TELL.NORMAL, r: 0.32, damage: 8, burn: 0, knockback: 0, posture: 5 },
  // turn rad/s (x (1 + 0.25 age)), cruise m/s, burst: the outward speed decays to this fraction / s
  wisp: { tell: TELL.BLUE, r: 0.4, damage: 13, burn: 0.8, knockback: 0, posture: 12, turn: 1.9, cruise: 5.2, life: 6.5 },
  orb: { tell: TELL.RED, r: 0.62, damage: 20, burn: 1.5, knockback: 3 },
  height: 1.0, // flight height (m): chest height of the hero
  arm: 0.05, // a bullet cannot hit in its first `arm` s
  grace: 0.45, // after a bullet HIT every touching bullet fizzles for this long (no chain melts)
  pop: 2.2, // a deflect also bursts the small bullets within this many metres of the hero ...
  cut: 0.45, // ... and a sword swing cuts the small bullets within this of the blade
  // every bullet that will hit announces itself with a glint + combat:tell / combat:flash flashLead s
  // before impact; impacts within cueGap s of an announced one ride on that cue (one parry answers
  // them all), a bullet that could only be announced later than cueMin s before impact fizzles when
  // it is younger than `young` s (spawned point-blank), else it hits (the hero ran into it)
  cueGap: 0.3, cueMin: 0.24, young: 0.6,
  ricochet: 24, // a deflected bullet's speed back to the wyrm's head (m/s)
  bound: 33, // bullets die silently this far from the wyrm
};

export const BULLET_ATTACKS = {
  // crouches over its fire, then roars: spiral arms of embers wind out round the body (deflect the
  // arm that sweeps over you, or walk with the gaps); phase 2 adds red orb rings, phase 3
  // counter-rotating arms
  emberStorm: {
    label: 'Ember storm (spiral)', tell: TELL.NORMAL, phase: 1,
    windup: 1.1, cast: [3.4, 3.8, 4.2], recovery: 1.0,
    arms: [4, 4, 5], counter: [0, 0, 3], // arms winding the other way (0.8 x omega, 0.85 x speed)
    omega: 1.05, every: 0.11, speed: 7.5, life: 3.4,
    r0: 3.0, y0: 2.4, // spawn ring round the root (m) and spawn height
    orbRing: [0, 8, 10], orbEvery: 1.6, orbSpeed: 5.5, // red orb rings (one orb aimed at the hero)
    maxHits: 4, // a storm cannot hit more often than this
    maxDist: 26,
    weight: [1.4, 1.8, 1.8], cooldown: 14,
  },
  // wings spread, then beat: each beat flings a fan of embers at the hero; every second fan is
  // offset half a gap (weave or deflect); from phase 2 the last beat is a red orb wave (roll)
  fanVolley: {
    label: 'Cinder fan (wing volleys)', tell: TELL.NORMAL, phase: 1,
    windup: 1.0, gap: 0.7, recovery: 0.9,
    volleys: [3, 4, 5], count: [7, 8, 9], spread: 0.62, // half-angle (rad)
    speed: 9, life: 3.2, r0: 4.6, y0: 2.6,
    orbWave: [0, 5, 5], orbSpread: 0.5, orbSpeed: 7,
    maxHits: 3,
    minDist: 5, maxDist: 30,
    weight: [2.2, 2.6, 2.6], cooldown: 9,
  },
  // roars a swarm of blue wisps out of its maw: they hang, then home in one after another
  // (parry each: the clash sends it back; or cut them down with a swing). They outlive the roar.
  wispSwarm: {
    label: 'Wisp swarm (homing)', tell: TELL.BLUE, phase: 2,
    windup: 1.0, cast: 1.3, recovery: 0.8,
    count: [5, 7, 9], stagger: 0.45, first: 0.5, out: 6.5, leadSpeed: 9,
    maxHits: 4,
    maxDist: 30,
    weight: [0, 1.6, 1.8], cooldown: 16,
  },
  // red lines burn out from under it (the warning), ignite into walls of fire and turn like the
  // spokes of a wheel, reversing once: roll through a spoke or run with it close to the body
  fireWheel: {
    label: 'Fire wheel (sweeping beams)', tell: TELL.RED, phase: 2,
    windup: 1.3, dur: [4.2, 4.2, 5.0], recovery: 1.2,
    spokes: [4, 4, 5], speed: 1.05, // rad/s
    r0: 3.2, r1: 26, width: 1.1,
    damage: 20, burn: 1.5, knockback: 4,
    maxHits: 2,
    maxDist: 24,
    weight: [0, 1.2, 1.5], cooldown: 20,
  },
};
