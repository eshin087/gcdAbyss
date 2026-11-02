// Gameplay + anatomy numbers for the wyvern. Everything a designer might want to tweak lives here.
// Shared combat windows (parry / block / dodge / posture) live in src/combat/rules.js — never here.

import { TELL } from '../../combat/rules.js';

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
  maxHp: 1500,
  phase2At: 0.5, // hp fraction
  radius: 2.0 * S, // collision radius vs stones / arena bound
  // the root stays inside min(CONFIG.world.dragonBound, bound) (m). CONFIG's 26 was sized for the
  // v0.2 wyrm; at x1.875 the chest / neck-base body circles (~5.8 m ahead of the root) would cross
  // the 30 m clearing and pin the hero against its edge. 24 keeps them inside.
  bound: 24,
  turnSpeed: [70 * DEG, 110 * DEG], // P1, P2 (rad/s)
  walkSpeed: [3.0, 4.1],
  // phase 2 speeds the fight up: windups + recoveries x0.85 (the swings themselves keep their speed)
  phase2TimeScale: 0.85,
  // pause between attacks (walking / turning / snorting) — the main "breathing room" knob
  idleGap: [
    [1.3, 2.1],
    [0.9, 1.5],
  ],
  // posture meter size per phase; gains / regen / break time come from rules.js POSTURE
  posture: { max: [120, 140], headMult: 1.25 },
  stagger: { time: 1.6 }, // ordinary (short) stagger: Lab button, charging head-first into a stone
  recoilTime: 0.6, // parried melee attack: head snaps back, attack cancelled
  // the tell's timing cue: combat:flash + in-world flash this many seconds before impact (COMBAT.md)
  flashLead: 0.35,
  // Lab trigger: quick turn toward the player before a forced ability (rad/s, max seconds)
  forceTurn: { rate: 7, maxTime: 0.5 },
  partMult: { head: 1.5, neck: 1.15, body: 1.0, tail: 0.8, wing: 0.9, leg: 1.0 },
  // seconds before each attack is first allowed once the fight starts (the intro roar)
  openingCooldowns: { breath: 7, fireball: 5, charge: 4, leap: 10 },
  flashDecay: 9,

  // Every attack declares its tell (TELL.NORMAL / BLUE / RED) and may override parryable /
  // blockable (defaults: tellDefaults(tell) in rules.js). Times in seconds (P1 values; P2 x0.85 on
  // windup + recovery). `impact` = seconds into the active phase at which the blow typically lands
  // (drives the timing flash). `phase` = first phase the AI uses it in (the Lab can force any).
  // AI selection ranges (attacks.js) are in v0.1 metres x SCALE.
  attacks: {
    bite: {
      label: 'Bite', tell: TELL.BLUE,
      windup: 0.75, active: 0.2, impact: 0.06, recovery: 0.8,
      damage: 22, knockback: 2, reach: 5.4 * S, cooldown: 1.2, weight: 3,
    },
    swipe: {
      label: 'Wing-claw swipe', tell: TELL.NORMAL,
      windup: 0.8, active: 0.25, impact: 0.15, recovery: 0.7,
      damage: 18, knockback: 3, cooldown: 1.6, weight: 2.6,
    },
    // three hits, each with its own windup + tell: left claw, right claw, finishing lunge-bite
    clawCombo: {
      label: 'Claw combo (3 hits)', tell: TELL.BLUE, // headline tell = the finisher
      hits: [
        { kind: 'swipe', side: 1, tell: TELL.NORMAL, windup: 0.8, active: 0.25, impact: 0.15, damage: 14, knockback: 1.5 },
        { kind: 'swipe', side: -1, tell: TELL.NORMAL, windup: 0.55, active: 0.25, impact: 0.15, damage: 14, knockback: 1.5 },
        // reach: max head reach from the neck base; lunge: max root travel during the bite (m)
        { kind: 'lunge', tell: TELL.BLUE, windup: 0.6, active: 0.24, impact: 0.05, damage: 20, knockback: 3, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.0, cooldown: 5, weight: 2.2,
    },
    tail: {
      label: 'Tail sweep', tell: TELL.RED,
      // impact: player straight behind; + impactFlank for a player at the flank (~80 deg off the nose)
      windup: 0.9, active: 0.45, impact: 0.2, impactFlank: 0.1, recovery: 0.9,
      damage: 20, knockback: 3, cooldown: 2.5, weight: 3, spin: 200 * DEG,
      minReach: 2.0 * S, reach: 9.6 * S, // swept-arc band around the root
    },
    stomp: {
      label: 'Stomp', tell: TELL.RED,
      windup: 1.0, active: 0.15, recovery: 1.0, // impact = end of active
      damage: 18, radius: 4.5 * S, knockback: 3, cooldown: 3, weight: 3,
    },
    // a stream: blockable (chip), not parryable; dodge through it or step out of the cone
    breath: {
      label: 'Fire breath', tell: TELL.NORMAL, parryable: false, blockable: true,
      windup: 1.1, active: 1.8, activeP2: 2.4, recovery: 1.0,
      tickDamage: 4, tick: 0.15, burn: 1.5, halfAngle: 28 * DEG, range: 11.5 * S, sweepP2: 70 * DEG,
      particlesPerSec: 200, cooldown: 8, weight: 2.2,
    },
    // projectile blast radius is not body-linked: kept at the v0.1 size (approachable)
    fireball: {
      label: 'Fireball', tell: TELL.NORMAL,
      windup: 0.9, active: 0.35, activeP2: 0.9, recovery: 0.9,
      damage: 16, radius: 3, burn: 1.5, gravity: 16, cooldown: 6.5, weight: 2.5,
    },
    charge: {
      label: 'Charge', tell: TELL.RED,
      windup: 0.9, active: 1.0, recovery: 1.1,
      damage: 24, distance: 14 * S, knockback: 6, cooldown: 6, weight: 2,
    },
    leap: {
      label: 'Leap slam', tell: TELL.RED, phase: 2,
      windup: 0.8, air: 1.8, recovery: 1.2, // impact = landing (end of air)
      damage: 30, radius: 6 * S, knockback: 6, height: 10, cooldown: 13, weight: 1.8,
    },
    // phase-2 transition roar: a damaging shock ring around the wyrm (also a Lab ability)
    roar: {
      label: 'Roar ring', tell: TELL.RED, phase: 2,
      windup: 1.2, roar: 1.6, recovery: 0.6,
      damage: 8, radius: 7 * S, knockback: 6,
    },
  },
};

// Skeleton proportions in MODEL units (see SCALE above). Root = ground point under the torso centre,
// facing +Z, model-left = +X. See model.js for how these are assembled.
export const ANATOMY = {
  hipY: 2.0, // hips joint height when standing
  hipZ: -1.0,
  chest: [0, 0.2, 2.2], // chest joint, in hips frame
  neckBase: [0, 0.45, 0.9], // in chest frame
  neckSegs: 7,
  neckLen: 0.68,
  headLen: 1.45,
  tailBase: [0, 0.0, -0.95], // in hips frame
  tailSegs: 14,
  tailLen: 0.52,
  hipJoint: [0.95, -0.25, 0.0], // in hips frame (x mirrored)
  thigh: 1.15,
  shin: 1.05,
  meta: 0.75,
  shoulder: [1.0, 0.25, 0.4], // in chest frame (x mirrored)
  humerus: 1.6,
  forearm: 2.2,
  fingers: [3.8, 3.4, 3.0],
  footHome: [1.25, 0, -0.55], // toe contact, root frame
  wristHome: [2.5, 0.35, 2.6], // wing knuckle contact, root frame
};
