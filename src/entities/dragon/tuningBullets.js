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
// Every bullet is BREATHED (ADR-046): it leaves rig.pt.mouth along the head's aim, so the pattern
// shapes are what a head can make (a swept stream, coughed cones, a sustained breath on the ground).
// "Hard" (2026-11-11): ~1.6-2x the bullets of v0.6, ~20 % faster, shorter cooldowns, higher caps.

import { TELL } from '../../combat/rules.js';

export const BULLETS = {
  // posture: a parry's deflect; returnDamage / returnPosture: a PERFECT parry's return (ADR-047): HP
  // damage to the wyrm when the shot lands (an ember about one light hit, a wisp about one heavy hit)
  // and the posture it adds instead of `posture`
  ember: { tell: TELL.NORMAL, r: 0.32, damage: 8, burn: 0, knockback: 0, posture: 5, returnDamage: 30, returnPosture: 14 },
  // turn rad/s (x (1 + 0.25 age)), cruise m/s, burst: the outward speed decays to this fraction / s
  wisp: { tell: TELL.BLUE, r: 0.4, damage: 13, burn: 0.8, knockback: 0, posture: 12, returnDamage: 70, returnPosture: 30, turn: 1.9, cruise: 5.2, life: 6.5 },
  orb: { tell: TELL.RED, r: 0.62, damage: 20, burn: 1.5, knockback: 3 },
  height: 1.0, // flight height (m): chest height of the hero
  arm: 0.05, // a bullet cannot hit in its first `arm` s
  grace: 0.45, // after a bullet HIT every touching bullet fizzles for this long (no chain melts)
  pop: 1.5, // a deflect also bursts the small bullets within this many metres of the hero ...
  cut: 0.45, // ... and a sword swing cuts the small bullets within this of the blade
  // every bullet that will hit announces itself with a glint + combat:tell / combat:flash flashLead s
  // before impact; impacts within cueGap s of an announced one ride on that cue (one parry answers
  // them all), a bullet that could only be announced later than cueMin s before impact fizzles when
  // it is younger than `young` s (spawned point-blank), else it hits (the hero ran into it); a
  // homing wisp still flying `recue` s after the impact its cue announced is announced again
  cueGap: 0.3, cueMin: 0.24, young: 0.6, recue: 0.12,
  ricochet: 24, // a deflected bullet's speed back to the wyrm's head (m/s)
  returnSpeed: 34, // a perfectly parried bullet's speed back to the head (m/s; drawn x returnSize)
  returnSize: 1.8,
  bound: 33, // bullets die silently this far from the wyrm
  // a breathed bullet leaves at mouth height and reaches `height` after drop = clamp(dropK x the
  // mouth-to-hero distance / speed, dropMin, dropMax) s: a close hero is not flown over
  dropK: 0.55, dropMin: 0.12, dropMax: 0.8,
};

export const BULLET_ATTACKS = {
  // EMBER TORRENT: plants its feet, lowers the head and sweeps it side to side across the hero's
  // bearing, breathing a continuous stream of embers: snaking curtains that cross the hero once per
  // half-sweep (parry the crossing, or walk with the wave). P2+: at each sweep extreme the head
  // snaps round and coughs a tight fan of red orbs at him (roll). P3: the last `pirouette` s is a full
  // body turn, breathing throughout: one spiral arm, the only time embers go behind it.
  emberStorm: {
    label: 'Ember torrent (sweeping breath)', tell: TELL.NORMAL, phase: 1,
    windup: 1.1, cast: [3.6, 4.2, 4.8], recovery: 1.0,
    arc: [0.9, 1.1, 1.25], // rad either side of the (slowly re-centred) hero bearing
    sweepHz: [0.45, 0.55, 0.65], recentre: 0.6, // sweeps / s; the centre follows the hero at rad/s
    every: 0.06, speed: 9, life: 3.4, // one ember per lane every `every` s
    lanes: [1, 2, 3], laneGap: 0.22, // the stream split into a forked tongue (rad between lanes)
    orbs: [0, 3, 4], orbSpread: 0.18, orbSpeed: 6.5, cough: 0.3, // P2+: red orbs coughed at each extreme
    pirouette: [0, 0, 1.5], // s: P3's closing full turn
    reach: 2.5, dy: -0.55, // the head's reach out of the neck base (model units) and its dip
    maxHits: 6, // a torrent cannot hit more often than this
    maxDist: 26,
    weight: [1.6, 2.0, 2.0], cooldown: 10,
  },
  // CINDER BURST: the head snaps onto the hero and coughs shotgun cones, every bullet from the jaws.
  // Even coughs put an ember dead on him, odd ones put him in a gap (weave or deflect); P2+ the last
  // cough is a red orb wave (roll); P3 every other cough is a double tap (a second cone 0.14 s later,
  // half a spacing over: one parry's shield answers both)
  fanVolley: {
    label: 'Cinder burst (coughed cones)', tell: TELL.NORMAL, phase: 1,
    windup: 1.0, gap: 0.55, recovery: 0.9,
    volleys: [4, 6, 7], count: [9, 11, 13], spread: 0.55, // half-angle (rad)
    speed: 10.5, life: 3.2,
    orbWave: [0, 6, 7], orbSpread: 0.5, orbSpeed: 8,
    doubleTap: [0, 0, 1], tapGap: 0.14,
    chain: [0, 0, 0.35], // P3: chance the burst runs straight into an Ember torrent (brain.queued)
    recoil: 0.3, // m the head kicks up per cough
    maxHits: 5,
    minDist: 5, maxDist: 30,
    weight: [2.4, 2.8, 2.8], cooldown: 6.5,
  },
  // roars a swarm of blue wisps out of its maw: they hang, then home in one after another
  // (parry each: the clash sends it back; or cut them down with a swing). They outlive the roar.
  // (P1 is never picked by the AI; the Lab may still trigger it there)
  wispSwarm: {
    label: 'Wisp swarm (homing)', tell: TELL.BLUE, phase: 2,
    windup: 1.0, cast: 1.3, recovery: 0.8,
    count: [7, 10, 13], stagger: 0.36, first: 0.5, out: 6.5, leadSpeed: 9,
    maxHits: 6,
    maxAlive: 3, // a new swarm may start while at most this many wisps are still alive
    maxDist: 30,
    weight: [0, 1.6, 1.8], cooldown: 12,
  },
  // SCOURING BREATH: a sustained breath strikes the ground in front of the snout and runs out along
  // it as tongues of fire, fixed offsets off the head's aim; the wyrm sweeps them round by turning
  // head and body, pausing once (the head stops ~0.25 s) and reversing. The windup heats the ground
  // where the tongues will catch. Roll through a tongue, or stay behind it until the sweep comes round.
  fireWheel: {
    label: 'Scouring breath (sweeping tongues)', tell: TELL.RED, phase: 2,
    windup: 1.3, dur: [4.6, 4.6, 5.4], recovery: 1.2,
    tongues: [3, 3, 5], spread: [0.45, 0.45, 0.8], // tongues evenly over +-spread round the head's aim
    // rad/s body turn (2.15: the cast sweeps >= 1.25 turns in all; 1.5 managed ~0.9), the ramps, the
    // head's pause before the reversal, and when it comes (share of the cast)
    speed: 2.15, ramp: 0.35, pause: 0.25, reverseAt: 0.62,
    lead: 0.55, // rad: the wedge ignites this far beside the hero (its leading tongue) and sweeps onto him
    r0: 1.5, r1: 26, width: 1.1, // from the strike point (the mouth's ground projection)
    reach: 2.7, dy: -0.5, strike: 3.0, // the head's reach / dip (model units); the strike point (m ahead of the mouth)
    damage: 20, burn: 1.5, knockback: 4,
    maxHits: 3,
    maxDist: 24,
    weight: [0, 1.2, 1.5], cooldown: 15,
  },
};
