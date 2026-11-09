// Gameplay + anatomy numbers for the drake. Everything a designer might want to tweak lives here.
// Shared combat windows (parry / block / dodge / posture) live in src/combat/rules.js — never here.

import { TELL } from '../../combat/rules.js';
import { FIRE_ATTACKS } from './tuningFire.js';

const DEG = Math.PI / 180;

/**
 * Uniform size of the wyrm (v0.2: 25 % bigger than v0.1; v0.3: 1.5x v0.2 = 1.875x v0.1).
 * The model (model.js) and ANATOMY are authored in MODEL units (= the v0.1 metres); the root
 * Object3D is scaled by SCALE. Everything that works in WORLD space — IK bone lengths, neck/tail
 * chain lengths, gait strides, hurt spheres, body circles, attack reaches / radii, grass pushers,
 * FX sizes, pose targets (`dragon.rootPt`) — multiplies by SCALE. Change it here only.
 */
export const SCALE = 1.875;
const S = SCALE;

export const TUNING = {
  // v0.5 "epic wyrm fight" starting difficulty (the lead tunes after the merge): a 3-5 min fight for
  // a player who knows the moves (docs/COMBAT.md "Difficulty")
  maxHp: 4200,
  // three phases (contract 4): phase n starts at phaseAt[n - 1] of max HP (P1 100 %, P2 66 %, P3 33 %).
  // Each threshold is a gate: with the AI on, damage stops there until the transition roar starts.
  phaseAt: [1, 0.66, 0.33],
  phase2At: 0.66, // = phaseAt[1] (kept for older readers)
  phase3At: 0.33, // = phaseAt[2]
  radius: 2.0 * S, // collision radius vs stones / arena bound
  // the root stays inside min(CONFIG.world.dragonBound, bound) (m). CONFIG's 26 was sized for the
  // v0.2 wyrm; at x1.875 the chest / neck-base body circles (~5.8 m ahead of the root) would cross
  // the 30 m clearing and pin the hero against its edge. 24 keeps them inside.
  bound: 24,
  // per phase [P1, P2, P3] below
  turnSpeed: [70 * DEG, 110 * DEG, 125 * DEG], // rad/s
  walkSpeed: [3.0, 4.1, 4.6],
  // later phases speed the fight up: windups + recoveries x this (the swings themselves keep their speed)
  phaseTimeScale: [1, 0.85, 0.78],
  phase2TimeScale: 0.85, // = phaseTimeScale[1] (kept for older readers)
  // pause between attacks (walking / turning / snorting) — the main "breathing room" knob; phase 3
  // keeps the pressure on
  idleGap: [
    [1.3, 2.1],
    [0.9, 1.5],
    [0.4, 0.8],
  ],
  // the wyrm's heat per phase: crack glow (glowTarget) and body embers per second (phase 3 burns
  // white-hot)
  phaseGlow: [0, 0.5, 0.8],
  phaseEmbers: [0, 22, 50],
  // posture meter size per phase; gains / regen / break time come from rules.js POSTURE. Sized so a
  // player parrying the strings breaks it about every 30-60 s (the god-mode defending bot of the
  // integration WIN scenario is the reference player)
  posture: { max: [560, 640, 720], headMult: 1.25 },
  stagger: { time: 1.6 }, // ordinary (short) stagger: Lab button, charging head-first into a stone
  recoilTime: 0.6, // parried melee attack (the last hit of a string): head snaps back, attack cancelled
  // a parried hit that is NOT the last of its string: the struck part is knocked back (visual only,
  // no timing change; contract 1 "deflect chain")
  deflectKnock: { time: 0.14, head: 1.1, paw: 0.9, up: 0.5 },
  // the plunge reaction (contract 2): a hero's head-stab slams the head to the ground, it thrashes and
  // rises; airborne it first falls (`fall` s) and crash-lands. `exec` = an execution on a broken wyrm
  // (heavier, longer; consumes the break)
  plunged: {
    fall: 0.6, slam: 0.3, thrash: 0.6, rise: 0.45,
    exec: { slam: 0.35, thrash: 1.15, rise: 0.5 },
    crashShake: 0.6,
  },
  // the tell's timing cue: combat:flash + in-world flash this many seconds before impact (COMBAT.md)
  flashLead: 0.35,
  // strings (contract 1): a follow-up hit lands at least this long after the previous one (the
  // player releases and re-presses RMB: DEFENSE.parryRearm 0.25 s); checked by the STRINGS scenario
  minHitGap: 0.45,
  // Lab trigger: quick turn toward the player before a forced ability (rad/s, max seconds)
  forceTurn: { rate: 7, maxTime: 0.5 },
  partMult: { head: 1.5, neck: 1.15, body: 1.0, tail: 0.8, wing: 0.9, leg: 1.0 },
  // seconds before each attack is first allowed once the fight starts (the intro roar)
  openingCooldowns: { breath: 7, fireball: 5, charge: 4, leap: 10 },
  flashDecay: 9,
  // resting body language while awake (ai.js baseline; attacks return to it): wings mantled HALF
  // (0 FOLD, 0.5 HALF, 1 SPREAD: the painting's tall sails, the biggest shapes at the game camera),
  // tucked a little while walking; the jaw rests open like the painting's snarl, so the lit maw and
  // the fangs show (1 = 0.7 rad; visual only) [P1, P2, P3]
  rest: { spread: 0.5, walkSpread: 0.3, jaw: [0.65, 0.85, 0.95] },

  // Every attack declares its tell (TELL.NORMAL / BLUE / RED) and may override parryable /
  // blockable (defaults: tellDefaults(tell) in rules.js). Times in seconds (P1 values; later phases
  // x phaseTimeScale on windup + recovery). `impact` = seconds into the active phase at which the
  // blow typically lands (drives the timing flash). AI selection (ai.js, generic for every ATTACKS
  // entry): `phase` = first phase the AI uses it in (the Lab can force any), `weight` = a number or
  // [P1, P2, P3], `cooldown` s. Damage: a string hit 14-24, a heavy blow 30-40 (the hero has 160 HP).
  //
  // STRINGS (contract 1, attacks.js makeString): an attack made of N `hits`, each with its own
  //   kind      the performance (attacks.js KINDS): claw (foreleg rake), overhead (overhead claw
  //             smash), bite, rearBite (reared, hesitant bite), lungeBite, wing (wing buffet),
  //             tailJab, tailSweep, hop (pounce), stomp
  //   side      claw / overhead / wing: +1 = the limb on the side the hero stood at the string's
  //             start, -1 = the other one
  //   tell, windup (P1 s), hold [min, max] (optional random extra windup hold: baits an early
  //   parry; the flash still comes flashLead before the real impact), active, impact (s into the
  //   active), damage, knockback (+ knockdown and kind extras: reach, lunge, radius, turn ...),
  //   chance (0..1: the hit only happens this often, rolled at the string's start)
  // plus the string's recovery / cooldown / weight / phase and its AI band: `range` [min, max] model
  // units (x SCALE) from the root, `maxAng` / `minAng` rad off the nose. Every hit fires combat:tell
  // at its windup start and combat:flash flashLead s before its impact. A parried hit that is not
  // the last one is deflected (the string goes on); parrying the last one recoils the wyrm.
  attacks: {
    bite: {
      label: 'Bite', tell: TELL.BLUE,
      windup: 0.75, active: 0.2, impact: 0.06, recovery: 0.8,
      damage: 24, knockback: 2, reach: 5.4 * S, cooldown: 1.2, weight: 3,
    },
    swipe: {
      label: 'Claw swipe (foreleg rake)', tell: TELL.NORMAL,
      windup: 0.8, active: 0.25, impact: 0.15, recovery: 0.7,
      damage: 20, knockback: 3, cooldown: 1.6, weight: 2.6,
    },
    // three hits: left claw, right claw, finishing lunge-bite (a string since v0.5)
    clawCombo: {
      label: 'Claw combo (3 hits)', tell: TELL.BLUE, // headline tell = the finisher
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.8, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.55, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.8 },
        // reach: max head reach from the neck base; lunge: max root travel during the bite (m)
        { kind: 'lungeBite', tell: TELL.BLUE, windup: 0.6, active: 0.24, impact: 0.05, damage: 22, knockback: 3, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.0, cooldown: 5, weight: [2.2, 2.64, 2.4], range: [2.4, 5.4], maxAng: 0.9,
    },
    // claw, claw, an overhead smash and a lunging bite: parry, parry, PARRY, PARRY
    rendingFlurry: {
      label: 'Rending flurry (4 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.8 },
        // lunge: root travel (model units) to close on a far hero
        { kind: 'overhead', side: 1, tell: TELL.BLUE, windup: 0.62, active: 0.24, impact: 0.22, damage: 22, knockback: 3, lunge: 1.2 },
        { kind: 'lungeBite', tell: TELL.BLUE, windup: 0.55, active: 0.24, impact: 0.05, damage: 24, knockback: 3.5, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.1, cooldown: 7, weight: [2.0, 2.4, 2.2], range: [2.4, 5.4], maxAng: 0.9,
    },
    // the head rears back and HOLDS (a random delay), then snaps; half the time a quick second snap
    hesitantMaw: {
      label: 'Hesitant maw (1-2 bites)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'rearBite', tell: TELL.BLUE, windup: 0.85, hold: [0.25, 0.9], active: 0.2, impact: 0.06, damage: 24, knockback: 2.5, reach: 5.4 * S },
        { kind: 'bite', chance: 0.5, tell: TELL.BLUE, windup: 0.5, active: 0.2, impact: 0.06, damage: 20, knockback: 2.5, reach: 5.4 * S },
      ],
      // (the reared head can't reach down under the snout: from 3.5 out)
      recovery: 0.9, cooldown: 6, weight: [1.8, 2.0, 2.0], range: [3.5, 6.5], maxAng: 0.65,
    },
    // a wing smashes down beside the body, it pivots, the other wing smashes down (a gust shoves)
    wingBuffet: {
      label: 'Wing buffet (2 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        // wing extras: face = rad off the nose the hero is turned to, spread = the struck wing's
        // opening, amp = the beat (rad), roll / twist = the body leaning / the chest swinging the wing
        // forward through the blow
        { kind: 'wing', side: 1, tell: TELL.NORMAL, windup: 0.8, active: 0.3, impact: 0.25, damage: 18, knockback: 5, face: 1.15, spread: 0.45, amp: 0.95, roll: 0.38, twist: 0.6 },
        { kind: 'wing', side: -1, tell: TELL.BLUE, windup: 0.9, active: 0.3, impact: 0.25, damage: 22, knockback: 7, face: 1.15, spread: 0.45, amp: 0.95, roll: 0.38, twist: 0.6 },
      ],
      // the wing comes down ~7-8 model units out (its fingers): a mid-range answer to a hero standing
      // off out of claw reach (any side: the windup turns the flank to him)
      recovery: 1.0, cooldown: 6, weight: [2.2, 2.4, 2.4], range: [6.8, 8.3], maxAng: 2.6,
    },
    // a claw, a pivot (it turns its back), a tail jab thrust (dodge), a tail sweep (dodge)
    tailLash: {
      label: 'Tail lash (3 hits)', tell: TELL.RED, phase: 2,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 18, knockback: 1.5, turn: 0.7 },
        // the jab: the pivot stops the tail `offset` rad short of the hero, then a short lash snaps it
        // through him (`past` beyond); the hips thrust back `lunge` model units
        { kind: 'tailJab', tell: TELL.RED, windup: 1.0, active: 0.36, impact: 0.245, damage: 26, knockback: 4, offset: 0.95, past: 0.8, lunge: 0.8, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'tailSweep', tell: TELL.RED, windup: 0.9, active: 0.45, impact: 0.2, impactFlank: 0.1, damage: 30, knockback: 3, spin: 200 * DEG, minReach: 2.0 * S, reach: 9.5 * S },
      ],
      recovery: 1.0, cooldown: 8, weight: [0, 2.0, 2.2], range: [2.4, 5.4], maxAng: 0.9,
    },
    // a short hop onto the hero (red ring), then a bite
    pounce: {
      label: 'Pounce (2 hits)', tell: TELL.RED, phase: 2,
      hits: [
        // impact = the landing (the end of the active); radius around the forefeet's landing spot;
        // hop apex height (m) and the longest hop (model units)
        { kind: 'hop', tell: TELL.RED, windup: 0.8, active: 0.6, impact: 0.6, damage: 30, knockback: 5, knockdown: true, radius: 3.3 * S, height: 4.5, maxHop: 10 },
        { kind: 'bite', tell: TELL.BLUE, windup: 0.55, active: 0.2, impact: 0.06, damage: 22, knockback: 2.5, reach: 5.4 * S },
      ],
      recovery: 1.0, cooldown: 7, weight: [0, 2.2, 2.4], range: [6.0, 13.0], maxAng: 1.0,
    },
    // phase 3: six or seven hits, a delayed claw, a blue bite and a red stomp to finish
    frenzy: {
      label: 'Frenzy (6-7 hits)', tell: TELL.RED, phase: 3,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 16, knockback: 1.2, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.5, active: 0.25, impact: 0.15, damage: 16, knockback: 1.2, turn: 0.8 },
        // (a short windup leaves the neck half coiled: the snap lands a little later than the bite's)
        { kind: 'bite', tell: TELL.NORMAL, windup: 0.55, active: 0.2, impact: 0.125, damage: 18, knockback: 1.5, reach: 5.4 * S },
        { kind: 'claw', side: 1, chance: 0.6, tell: TELL.NORMAL, windup: 0.5, active: 0.25, impact: 0.15, damage: 16, knockback: 1.2, turn: 0.8 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.5, hold: [0.3, 0.75], active: 0.25, impact: 0.15, damage: 18, knockback: 1.5, turn: 0.8 },
        { kind: 'bite', tell: TELL.BLUE, windup: 0.55, active: 0.2, impact: 0.12, damage: 24, knockback: 3, reach: 5.4 * S },
        { kind: 'stomp', tell: TELL.RED, windup: 0.85, active: 0.15, impact: 0.15, damage: 36, knockback: 4, radius: 4.5 * S },
      ],
      recovery: 1.2, cooldown: 12, weight: [0, 0, 2.6], range: [2.4, 5.4], maxAng: 0.9,
    },
    tail: {
      label: 'Tail sweep', tell: TELL.RED,
      // impact: player straight behind; + impactFlank for a player at the flank (~80 deg off the nose)
      // minWindup: the backswing's floor (phase 3's x0.78 left the tail on a hero straight behind: it
      // landed on the first active frame, 0.2 s before its flash + lead)
      windup: 0.9, minWindup: 0.76, active: 0.45, impact: 0.2, impactFlank: 0.1, recovery: 0.9,
      damage: 32, knockback: 3, cooldown: 2.5, weight: 3, spin: 200 * DEG,
      // swept-arc band around the root: the 16-segment tail's tip reaches 8.9 model units out in the
      // spin (measured v0.4) + its 0.45 hit sphere + the hero's radius
      minReach: 2.0 * S, reach: 9.5 * S,
    },
    stomp: {
      label: 'Stomp', tell: TELL.RED,
      windup: 1.0, active: 0.15, recovery: 1.0, // impact = end of active
      damage: 34, radius: 4.5 * S, knockback: 3, cooldown: 3, weight: 3,
    },
    // a stream: blockable (chip), not parryable; dodge through it or step out of the cone
    breath: {
      label: 'Fire breath', tell: TELL.NORMAL, parryable: false, blockable: true,
      windup: 1.1, active: 1.8, activeP2: 2.4, recovery: 1.0,
      tickDamage: 5, tick: 0.15, burn: 1.5, halfAngle: 28 * DEG, range: 11.5 * S, sweepP2: 70 * DEG,
      particlesPerSec: 200, cooldown: 8, weight: [2.2, 2.64, 2.64],
    },
    // projectile blast radius is not body-linked: kept at the v0.1 size (approachable)
    fireball: {
      label: 'Fireball', tell: TELL.NORMAL,
      windup: 0.9, active: 0.35, activeP2: 0.9, recovery: 0.9,
      damage: 22, radius: 3, burn: 1.5, gravity: 16, cooldown: 6.5, weight: [2.5, 3, 3],
    },
    charge: {
      label: 'Charge', tell: TELL.RED,
      windup: 0.9, active: 1.0, recovery: 1.1,
      damage: 36, distance: 14 * S, knockback: 6, cooldown: 6, weight: 2,
    },
    leap: {
      label: 'Leap slam', tell: TELL.RED, phase: 2,
      windup: 0.8, air: 1.8, recovery: 1.2, // impact = landing (end of air)
      damage: 40, radius: 6 * S, knockback: 6, height: 10, cooldown: 13, weight: 1.8,
    },
    // phase transition roar: a damaging shock ring around the wyrm (also a Lab ability)
    roar: {
      label: 'Roar ring', tell: TELL.RED, phase: 2,
      windup: 1.2, roar: 1.6, recovery: 0.6,
      damage: 12, radius: 7 * S, knockback: 6,
    },
  },
};
Object.assign(TUNING.attacks, FIRE_ATTACKS); // fire / flight attacks and spells (tuningFire.js)

// Skeleton proportions in MODEL units (see SCALE above). Root = ground point under the torso centre,
// facing +Z, model-left = +X. See model.js for how these are assembled and docs/art/dragon.md
// (§1.2 skeleton layout, Appendix A) for where every number comes from.
// v0.4 "four-legged rebuild": a quadruped drake (columnar forelegs + digitigrade hind legs) with a
// separate pair of wings rising from the back (the v0.3 wyvern walked on its wing wrists).
export const ANATOMY = {
  withers: 4.0, // reference height H (top of the shoulders, no spikes): every ratio in the art spec is x H
  hipY: 2.4, // pelvis body joint when standing
  hipZ: -1.45,
  chest: [0, 0.45, 2.7], // ribcage body joint, hips frame -> root (0, 2.85, 1.25)
  neckBase: [0, 0.45, 0.45], // chest frame -> root (0, 3.3, 1.7)
  neckSegs: 7,
  neckLen: 0.46, // 3.2 chain, coiled into an upright S at rest (reads ~2.3); stretches for the bite
  headLen: 1.3,
  tailBase: [0, 0.15, -1.1], // hips frame -> root (0, 2.55, -2.55)
  tailSegs: 16,
  tailLen: 0.52,
  // hind legs (digitigrade: knee forward, hock high behind the toe)
  hipJoint: [1.0, -0.1, 0.1], // hips frame (x mirrored)
  thigh: 1.25,
  shin: 1.3,
  meta: 0.78,
  footHome: [1.25, 0, -1.45], // hind toe contact, root frame
  ankleOff: [0, 0.75, -0.15], // hock above / behind the toe contact (world-aligned, x yaw)
  // front legs (columnar, semi-digitigrade: elbow back, wrist 0.5 off the ground)
  shoulder: [1.0, -0.1, 0.6], // chest frame (x mirrored) -> root (+-1.0, 2.75, 1.85)
  humerus: 1.05,
  forearm: 1.37,
  hand: 0.45,
  handHome: [1.25, 0, 2.15], // front toe contact, root frame (outside the chest: reads from above)
  wristOff: [0, 0.42, -0.2], // front wrist above / behind the toe contact
  // wings: separate limbs on top of the back, behind the neck base
  wingRoot: [0.7, 1.0, -0.25], // chest frame -> root (+-0.7, 3.85, 1.0)
  wingHumerus: 1.5,
  // arm 4.1 (~1.0 H): long enough for the roar / breath wrists to stand ~1.85 H high and well out to
  // the side (the panel's raised 'M'); the half-raised sail keeps a ~135° elbow (fix round 1)
  wingForearm: 2.6,
  // f0 = leading edge, f3 = inner. knuckle = proximal fraction of each finger (the distal kink joint).
  // The proximal bones (wrist -> knuckle: fingers x knuckle = 3.35 / 3.48 / 2.88 / 2.21) are v0.4's:
  // the knuckles carry the wing hurt spheres (dragon.js). Only the distal bones (knuckle -> tip) are
  // longer (~1.35x, visual only): the owner's reference has huge bat wings (~1.6x was too much for the
  // game camera: the span nearly filled the screen).
  fingers: [6.2, 6.9, 5.5, 3.9],
  knuckle: [(5.4 * 0.62) / 6.2, (6.0 * 0.58) / 6.9, (4.8 * 0.6) / 5.5, (3.4 * 0.65) / 3.9],
  hipAttach: [1.0, 0.5, -0.15], // inner membrane's flank attach, hips frame -> root (+-1.0, 2.9, -1.6)
};
