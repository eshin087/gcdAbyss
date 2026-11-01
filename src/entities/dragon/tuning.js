// Gameplay + anatomy numbers for the wyvern. Everything a designer might want to tweak lives here.

const DEG = Math.PI / 180;

export const TUNING = {
  maxHp: 1800,
  phase2At: 0.5, // hp fraction
  radius: 2.0, // collision radius vs stones / arena bound
  turnSpeed: [70 * DEG, 110 * DEG], // P1, P2 (rad/s)
  walkSpeed: [3.0, 4.1],
  recoveryScaleP2: 0.75,
  idleGap: [
    [0.7, 1.3],
    [0.35, 0.8],
  ],
  // player poise per hit: light 12, heavy 40 (x1.5 heavy, x1.4 head) -> P1 breaks after ~12 lights
  // or 3 heavies landed without a 3.5 s pause
  poise: { max: [140, 170], regenDelay: 3.5, regen: 24, staggerTime: 2.4 },
  partMult: { head: 1.5, neck: 1.15, body: 1.0, tail: 0.8, wing: 0.9, leg: 1.0 },
  // seconds before each attack is first allowed once the fight starts (the intro roar)
  openingCooldowns: { breath: 7, fireball: 5, charge: 4, leap: 10 },
  flashDecay: 9,

  attacks: {
    bite: { windup: 0.55, active: 0.2, recovery: 0.7, damage: 32, knockback: 2, cooldown: 1.0, weight: 3 },
    swipe: { windup: 0.6, active: 0.25, recovery: 0.6, damage: 28, knockback: 3, cooldown: 1.6, weight: 2.6 },
    tail: { windup: 0.7, active: 0.45, recovery: 0.8, damage: 30, knockback: 4, cooldown: 2.5, weight: 3, spin: 200 * DEG },
    stomp: { windup: 0.8, active: 0.15, recovery: 0.9, damage: 24, radius: 4.5, knockback: 3, cooldown: 3, weight: 3 },
    // standing in a full P1 breath costs ~60 hp (12 ticks) + burn: punishing, not instant death
    breath: {
      windup: 0.9, active: 1.8, activeP2: 2.4, recovery: 1.0,
      tickDamage: 5, tick: 0.15, burn: 2.0, halfAngle: 28 * DEG, range: 11.5, sweepP2: 70 * DEG,
      particlesPerSec: 200, cooldown: 8, weight: 2.2,
    },
    fireball: { windup: 0.7, active: 0.35, activeP2: 0.9, recovery: 0.9, damage: 26, radius: 3, burn: 2, gravity: 16, cooldown: 6.5, weight: 2.5 },
    charge: { windup: 0.6, active: 1.0, recovery: 1.1, damage: 34, distance: 14, knockback: 6, cooldown: 6, weight: 2 },
    leap: { windup: 0.7, air: 1.8, recovery: 1.2, damage: 45, radius: 6, knockback: 6, height: 10, cooldown: 13, weight: 1.8 },
    phase2: { windup: 0.5, roar: 1.6, recovery: 0.6, damage: 10, radius: 7, knockback: 6 },
  },
};

// Skeleton proportions (meters). Root = ground point under the torso centre, facing +Z,
// model-left = +X. See model.js for how these are assembled.
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
