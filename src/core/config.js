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
// `?noseen` in the URL (read once): do not print the hero through what covers him (render/pipeline.js,
// ADR-106). An A/B switch for frame-rate and image checks.
const NO_SEEN = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('noseen');
  } catch {
    return false;
  }
})();

// `?shadowCache=0` in the URL (read once): draw the moon's shadow map whole every frame, as before the still
// map (render/shadowCache.js, ADR-201). An A/B switch for frame-rate and image checks.
const NO_SHADOW_CACHE = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowCache') === '0';
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
    // A window taller than it is wide (a phone held upright; ADR-097): the vertical field of view
    // opens until the view is as WIDE as a square window's (cameraRig.js fovFor), portraitMaxFov at
    // most. A phone held upright also stands portraitDistance x further back and looks portraitLead
    // m south of the hero, so he stands above the middle of the screen, clear of the thumbs.
    portraitMaxFov: 68,
    portraitDistance: 1.2,
    portraitLead: 1.5,
    // The letters follow the zoom (?zoomArt=a|b|c; render/pipeline.js, wyrmGlyphs.js zoomArtStep):
    // past the default distance the art cell (the wyrm, prop art, the fire field) and the screen grid
    // (trees, the bonfire) step down the font ladder so an object keeps about the letters it has at
    // the default distance. `strength` per option: 0 = today's fixed letters, 1 = the letters
    // shrink as the picture does, 0.5 = half of that (log). `hyst`: how far (log of the cell height)
    // past the midpoint between two steps the wanted size must go before the font steps (a wheel
    // notch or the fight's breathing camera must not flicker it). `minPitch`: the camera must look
    // down at least this steeply (sine) for its distance to count (a Lab shot along the ground does
    // not). Desktop only: a phone (cameraRig.mobile) keeps its letters.
    zoomArt: { strength: { a: 0, b: 1, c: 0.5 }, hyst: 0.1, minPitch: 0.35 },
  },

  // Touch controls (src/ui/touch.js). Sizes in CSS px.
  touch: {
    stickRadius: 52, // knob travel
    deadZone: 0.16, // fraction of stickRadius ignored
    runAt: 0.62, // deflection that reaches full run speed (analog below)
    sprintAt: 0.94, // stick pushed to the rim = sprint (Shift)
    autoAimRange: 32, // m: in a fight, attacks / facing auto-aim at the dragon within this range
    aimDistance: 6, // m ahead of the hero along the stick when there is nothing to auto-aim at
    // The right-thumb cluster (ADR-096): ATTACK, BLOCK and DODGE are three tiles that all touch one
    // another, so the thumb goes from any one to any other without crossing a gap or a third tile.
    //   tiles  each tile in the cluster's own box: x from its right edge, y up from its bottom edge
    //   flask  the flask button rides with the cluster (same box), a gap away from the tiles
    //   reach  a touch this far outside the cluster still goes to the nearest tile
    //   slide  a thumb that slides from one tile onto another releases the first and presses the
    //          second without lifting; `stick`: how far it must leave its tile before that happens
    //   pos    where the cluster's bottom-right corner sits, [in from the right edge, up from the
    //          bottom]; the player picks one in the pause menu (PAD POSITION), as its size (PAD SIZE)
    //   tall   screens taller than 560 px (tablets): everything this much larger
    // (ADR-270, the owner's call, after ADR-115's 2 x 2 square): ATTACK in the middle with HEAVY
    // over it, BLOCK beside it where DODGE stood and DODGE right under it; the FLASK sits where BLOCK
    // stood (its own button, out of the slide). ATTACK touches the other three tiles.
    //   FLASK | HEAVY
    //   BLOCK | ATTACK
    //         | DODGE
    pad: {
      tiles: {
        dodge: { x: 0, y: 0, w: 92, h: 56 },
        attack: { x: 0, y: 56, w: 92, h: 80 },
        heavy: { x: 0, y: 136, w: 92, h: 60 },
        block: { x: 92, y: 56, w: 80, h: 80 },
      },
      flask: { x: 100, y: 142, w: 66, h: 48 },
      reach: 26,
      slide: true,
      stick: 10,
      // (ADR-270: further in from the right edge than before, where a thumb rests holding a phone)
      pos: { low: [44, 18], mid: [78, 34], high: [92, 64] },
      // the same three places on a screen held upright (thumbs come up from the bottom corners)
      posPortrait: { low: [20, 44], mid: [30, 104], high: [30, 170] },
      size: { s: 0.88, m: 1, l: 1.14 },
      // the whole touch layer scales with the screen (ADR-270): k = clamp(min(short / base[0],
      // long / base[1]), min, max), so a small near-square screen (a fold's cover screen) gets
      // smaller controls and a tablet larger ones; an iPhone on its side stays at 1
      fit: { base: [390, 760], min: 0.62, max: 1.25 },
      // PAD LAYOUT 'split' (ADR-131): the guard goes to the LEFT hand, so one thumb never has to
      // both cut and parry. The right cluster keeps ATTACK, HEAVY and DODGE (the flask where BLOCK
      // stood); GUARD is a button of its own beside the stick's ring.
      //   guard          `gap` px right of the ring, `y` up from the cluster's bottom line
      //   guardPortrait  held upright (no room beside the stick): `lift` px above the ring
      split: {
        tiles: {
          // (ADR-278, the owner: a second guard under ATTACK; the left hand's GUARD stays)
          block: { x: 0, y: 0, w: 92, h: 56 },
          attack: { x: 0, y: 56, w: 92, h: 84 },
          heavy: { x: 0, y: 140, w: 92, h: 66 },
          dodge: { x: 92, y: 56, w: 80, h: 84 },
        },
        flask: { x: 103, y: 152, w: 58, h: 42 },
        // (ADR-278, the owner: closer to the stick) its left edge just over the ring's glyphs
        guard: { gap: -6, y: 0, w: 84, h: 100 },
        guardPortrait: { lift: 4, w: 100, h: 70 },
      },
    },
    // HOLD ATTACK (a pause-menu switch, off by default; ADR-131): a thumb resting on ATTACK keeps
    // cutting, as if it tapped: the first repeat `after` s into the hold, then one every `every` s.
    // Not while the guard is held (the guard has the hero), and not for `quiet` s after DODGE,
    // HEAVY or FLASK was pressed (the repeat must not write over that press in the input buffer).
    hold: { after: 0.22, every: 0.1, quiet: 0.32 },
    // the fight starts locked on (ADR-270): on touch the hero takes the lock as the boss fight
    // begins (retried for `autoLock` s while the boss is out of lock range); 0 = off
    autoLock: 4,
    // SWIPE DODGE (a pause-menu switch, on by default, the owner's pick; ADR-278): a quick flick on the bare right half of the screen
    // dodges the way it flicked, so the thumb never has to find the DODGE tile. It fires the moment
    // the finger has travelled `dist` px (x the screen's fit) within `time` s of touching down, not
    // on the lift; a slower drag, or a second finger (a pinch), is no swipe. `from`: where the right
    // part begins, as a share of the screen's width
    swipe: { dist: 30, time: 0.2, from: 0.5 },
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
      hitLight: [40, 0, 0.3], // every landed light cut: a short weak buzz
    },
  },

  render: {
    maxPixelRatio: 2,
    shadowSize: 2048, // default moon shadow map size (texels); the quality presets set their own
    shadowExtent: 80, // half-size in meters of the moon's orthographic shadow frustum
    // The still shadow map (render/shadowCache.js, ADR-201; `on` false with ?shadowCache=0): what has not
    // moved for `settle` frames is drawn into a map of its own only when it changes, and each frame starts
    // from a copy of it. `snap`: while it is on, the shadow camera follows the view in steps of this many
    // of its own texels, in its own plane (32: 2.5 m at 2048, 5 m at 1024; pipeline.js updateShadowCamera),
    // so walking redraws it a few times a second, not every frame, and a texel never moves on the world. A caster of more than `big` triangles (a level's merged tree run, cut by a
    // blow) rejoins the still map after `settleBig` quiet frames: drawing it moving costs about what drawing
    // the still map again does.
    shadowCache: { on: !NO_SHADOW_CACHE, settle: 20, settleBig: 3, big: 60000, snap: 32 },
    batch: !NO_BATCH, // rigid batching of the hero and the wyrm (false with ?nobatch)
    // The hero printed through whatever covers him on screen (pipeline.js, ADR-106; `on` false with
    // ?noseen). `reach`: half-size (m) of the box round him that is drawn a second time (his figure
    // and his sword's reach). `margin`: how far (m) in front of him a thing must stand to count as
    // cover (what touches him, a blade that crosses his body, does not). `bareMargin`: the same for
    // untagged pixels (alpha 0: the grass at his feet must never count). The pass only runs while a
    // probe finds something in front of his torso (`probe`: the slab it tests, [half-width, from,
    // to] in m above his feet) and for `hold` frames after it last did.
    // The hero's letters follow his size (render/pipeline.js _updateHeroLetters): one letter cell of
    // his is `size` metres at his depth, on every screen and at every camera distance (0 = the fixed
    // 4 px cell he had before). 0.115 m is the hero of the owner's reference picture: a 720p frame at
    // the 36 m camera, about 9 letters across the cloak and 13 rows of them. From `near` m in to
    // `close` m (where the art pass fades from his far look to the close-up's line art, uHeroLod) the
    // cell goes back to the fixed one: a close-up (the title, an intro, the Lab) is drawn as it
    // always was. `hyst`: slack (log of the cell size) before the cell steps.
    heroLetters: { size: 0.115, near: 20, close: 6, hyst: 0.06 },
    seenThrough: { on: !NO_SEEN, reach: 2.8, margin: 0.6, bareMargin: 1.5, probe: [0.4, 0.6, 1.9], hold: 20 },
    exposure: 1.55,
    bloomStrength: 0.85,
    bloomThreshold: 0.55,
    // through a freeze-frame (game.hitstop) particles and lights run on at this share of real time:
    // the fighters hold the impact's pose while its sparks fly (game.fxDt)
    fxLive: 0.6,
  },

  // Quality presets (cycle with F2). grass = blade instances drawn, shadow = moon shadow map size.
  quality: [
    { name: 'LOW', grass: 90000, dpr: 1, shadow: 1024 },
    { name: 'MEDIUM', grass: 170000, dpr: 1.25, shadow: 2048 },
    { name: 'HIGH', grass: 260000, dpr: 2, shadow: 2048 },
  ],
  defaultQuality: 2,
  defaultQualityTouch: 0, // touch devices start on LOW when AUTO is off (phones with DPR 3 + 260k blades crawl)

  // AUTO quality (render/autoQuality.js, ADR-200): the render resolution follows the measured frame
  // time, so the game holds `target` fps where the device can. On by default; F2 / the pause menu
  // pick a preset instead (AUTO off), ?autoq=0 starts with it off (A/B), ?autoq=1 on.
  autoQuality: {
    on: true,
    // render scale steps (device pixels per CSS pixel), high to low, each with its shadow map and
    // grass; a step above the screen's own pixel ratio (or maxPixelRatio) is drawn at that ratio
    steps: [
      { scale: 2, shadow: 2048, grass: 260000 },
      { scale: 1.5, shadow: 2048, grass: 260000 },
      { scale: 1.25, shadow: 2048, grass: 170000 },
      { scale: 1, shadow: 2048, grass: 170000 },
      { scale: 0.75, shadow: 1024, grass: 90000 },
      { scale: 0.5, shadow: 1024, grass: 90000 },
    ],
    floor: 1, // the lowest scale AUTO may use: below 1x the letters get fewer and bigger (the owner picked 1x; ?autoqFloor=)
    target: 60, // fps
    window: 1.5, // s of frames per decision
    downAt: 1.1, // a window whose mean frame is over target frame × this is slow (under ~54.5 fps)
    downWindows: 2, // slow windows in a row before a step down
    gpuShare: 0.8, // without a GPU timer: script time under this share of the frame = the GPU is the limit
    minGain: 0.06, // a step down that took less than this share off the frame did not help: undone
    upAt: 1.03, // a window whose mean frame is at most target frame × this holds the target
    upWait: 8, // s of holding the target (no GPU timer) before a step up is tried
    upGpuAt: 0.72, // with a GPU timer: step up when the step's predicted GPU time ≤ target frame × this
    upGpuWindows: 2, // ... for this many windows in a row
    fixedShare: 0.25, // share of the GPU frame that does not follow the pixel count (ADR-199: ~20 - 25 %)
    probeWatch: 5, // s after a step up in which a slow window means it failed (back down)
    backoff: [20, 60, 180], // s before a failed step up is tried again; after the last, not this page load
    settle: 0.6, // s of frames ignored after a step (its own rebuild hitch)
    spike: 0.25, // a frame longer than this (s) is no sample (a hidden tab, a load): the window restarts
    // the first guess (main.js, the title's first frames): the median of `frames` frames timed at
    // the top step (each waits for the GPU) after `warm` untimed ones (the first frames after the
    // load run ~3x slow); the highest step whose predicted frame fits target × `fit`
    bench: { warm: 20, frames: 11, fit: 0.7 },
  },
  // A frame-rate cap on touch devices (heat, battery): on a 120 Hz screen every second refresh is
  // drawn, so the pace stays even; a screen under 105 Hz is not capped (90 Hz would pace unevenly).
  // ?fpscap=0|1 forces it; the pause menu toggles it.
  fpsCap: { touch: true, fps: 60 },
};
