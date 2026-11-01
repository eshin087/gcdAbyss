// Central tuning knobs. Gameplay numbers for the player/dragon live in their own modules.
export const CONFIG = {
  seed: 1337,

  world: {
    arenaRadius: 30, // the clearing
    playerBound: 31, // player can't leave this circle
    dragonBound: 26, // dragon center stays inside this circle
    worldExtent: 160, // square size covered by grass/scorch/shadows
    bonfire: { x: 0, z: 25.5 },
    playerSpawn: { x: 0.6, z: 23.8 },
    dragonSleep: { x: 3, z: -10, yaw: 2.4 }, // curled up beside the bone pile, head toward the SW
    bossTriggerZ: 6, // crossing north of this line (or getting within wakeRadius) wakes the dragon
    wakeRadius: 13,
  },

  camera: {
    fov: 32,
    pitch: (58 * Math.PI) / 180,
    distance: 36,
    minDistance: 24,
    maxDistance: 54,
    followLambda: 5.5,
    near: 1,
    far: 220,
  },

  render: {
    maxPixelRatio: 2,
    shadowSize: 2048,
    shadowExtent: 80, // half-size in meters of the moon's orthographic shadow frustum
    exposure: 1.55,
    bloomStrength: 0.85,
    bloomThreshold: 0.55,
  },

  // Quality presets (cycle with F2): render resolution (device pixel ratio cap).
  quality: [
    { name: 'LOW', dpr: 1 },
    { name: 'MEDIUM', dpr: 1.25 },
    { name: 'HIGH', dpr: 2 },
  ],
  defaultQuality: 2,
};
