// Central tuning knobs. Gameplay numbers for the player/dragon live in their own modules.

// `?nobatch` in the URL (read once): draw the hero and the wyrm mesh by mesh instead of through
// rigid batches (render/rigidBatch.js). An A/B switch for frame-rate and image checks.
const NO_BATCH = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobatch');
  } catch {
    return false;
  }
})();

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
    // Phones (touch controls on and the short screen side ≤ mobileMaxSide CSS px): a much closer
    // camera so the hero reads and the wyrm fills the view. Pinch zooms between min and max.
    // Lock-on, boss framing and the title / intro shots may add at most mobileMaxExtraZoom on top.
    mobileDistance: 20,
    mobileMinDistance: 14,
    mobileMaxDistance: 34,
    mobileMaxExtraZoom: 3,
    mobileMaxSide: 600,
  },

  // Touch controls (src/ui/touch.js). Sizes in CSS px.
  touch: {
    stickRadius: 52, // knob travel
    deadZone: 0.16, // fraction of stickRadius ignored
    runAt: 0.62, // deflection that reaches full run speed (analog below)
    sprintAt: 0.94, // stick pushed to the rim = sprint (Shift)
    autoAimRange: 32, // m: in a fight, attacks / facing auto-aim at the dragon within this range
    aimDistance: 6, // m ahead of the hero along the stick when there is nothing to auto-aim at
  },

  // Gamepad (src/ui/gamepad.js; the Gamepad API "standard" layout). Stick values are 0..1 deflection.
  gamepad: {
    deadZone: 0.2, // radial dead zone of the left (move) stick
    runAt: 0.9, // deflection that reaches full run speed (analog below)
    aimDeadZone: 0.35, // the right stick steers the aim past this deflection
    triggerOn: 0.5, // an analog trigger (LT / RT) presses at this pull ...
    triggerOff: 0.3, // ... and releases below this one
    autoAimRange: 32, // m: with the right stick idle, attacks / facing auto-aim at the boss within this range
    aimDistance: 6, // m ahead of the hero along the aim direction when there is nothing to auto-aim at
    menuRepeat: 0.22, // s between repeated menu steps while the D-pad / stick is held
    // rumble per event: [duration ms, strong 0..1, weak 0..1] (dual-rumble; silently off where unsupported)
    rumble: {
      hurt: [180, 0.85, 0.5],
      guardBreak: [260, 1, 0.6],
      block: [70, 0.25, 0.35],
      parry: [90, 0.35, 0.8],
      perfectParry: [160, 0.7, 1],
      perfectDodge: [110, 0.15, 0.6],
      hitHeavy: [90, 0.45, 0.25],
    },
  },

  render: {
    maxPixelRatio: 2,
    shadowSize: 2048, // default moon shadow map size (texels); the quality presets set their own
    shadowExtent: 80, // half-size in meters of the moon's orthographic shadow frustum
    batch: !NO_BATCH, // rigid batching of the hero and the wyrm (false with ?nobatch)
    exposure: 1.55,
    bloomStrength: 0.85,
    bloomThreshold: 0.55,
  },

  // Quality presets (cycle with F2). grass = blade instances drawn, shadow = moon shadow map size.
  quality: [
    { name: 'LOW', grass: 90000, dpr: 1, shadow: 1024 },
    { name: 'MEDIUM', grass: 170000, dpr: 1.25, shadow: 2048 },
    { name: 'HIGH', grass: 260000, dpr: 2, shadow: 2048 },
  ],
  defaultQuality: 2,
  defaultQualityTouch: 0, // touch devices start on LOW (phones with DPR 3 + 260k blades crawl)
};
