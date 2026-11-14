// The hero's swings as keyframed clips (data only; anim.js `swingPose` plays them, combat.js names
// one per hit: `anim: { kind: 'clip', clip: '<name>' }`).
//
// A clip is a list of KEYS over the attack's own phases, so a clip follows its hit's timing:
//   u  0 … 1  the windup      (0 = the pose he was in when the swing started: the clip always
//                               starts from there, whatever it was)
//      1 … 2  the active frames (the hit test reads the drawn blade: it must cross his front here)
//      2 … 3  the recovery     (from `home`, default 0.5 of it, anim.js eases him back to the ready
//                               stance: keys past that are not needed)
// A held attack button freezes the clip at u = 1 (the coil), so that key is a pose worth holding.
//
// Key fields (body axes: +x his LEFT, +y up, +z forward; metres, radians). A field missing from a
// key is interpolated between the keys that have it (Catmull-Rom: the motion runs through the keys
// without stopping; two keys close together with the same value make a hold):
//   h   the sword hand, as an offset from the right shoulder (reach 0.55)
//   a   the blade's direction as [azimuth, elevation] in DEGREES: azimuth round the body (0 = ahead,
//       + = his left, 180 = behind), elevation above level. Consecutive keys at most ~100° apart.
//   l   the free hand, as an offset from the left shoulder
//   by bx bz   the hips: sink (−) / across (+ = left) / forward
//   hip sy     the hips' and the chest's turn (+ = to his left); the chest's is on top of the hips'
//   sx sz      the chest's lean forward (+) and to his right (+)
//   hy hx hz   the head (default: the eyes stay on the target)
//   two        0..1 the free hand on the grip (then `l` is ignored);  offAt  m up the blade (a brace)
//   rp lp      elbow directions (default: worked out from where the hand is)
//   f          the flat's normal (default: the plane the blade is swinging in, so the edge leads)
// Clip options: `rF` / `lF` [x, z] the stance the step lands in (default: the fighting stance),
//   `step` [u0, u1] when the front foot steps, `flat` the flat's normal while the blade is slow
//   (and the side the swing's plane is taken on: give it for a vertical cut), `home` the fraction of
//   the recovery after which he eases back to the ready stance, `line` the line the cut runs along
//   as he sees it ('right': the diagonal between high right and low left, either way; 'left': its
//   mirror; 'flat'; 'down' the middle; 'low' along the grass; 'spiral'; 'point' a thrust): the
//   animator never follows a swing with another on the same line (anim.js _pickVariant).
//
// Authoring notes: a cut reads as powered by the body when the hips lead (their turn is ahead of the
// chest's at mid-cut), the hand is furthest from the shoulder as the blade crosses his front, and the
// weight goes from the back foot (`bz` -, the hips up) into the front one (`bz` +, the hips down).
// The COIL is one key, at u = 1: the blade is still moving as it gets there and turns into the cut
// (two keys there made a dead stop, a hitch between the hits of a chain). The free hand stays
// composed: before the chest in the coil, drawn back beside the hip by the end of the cut, never
// flung from in front of him to behind him (it then snapped forward again for the next coil), and
// never near the hip with the elbow out ("hand on hip"). Each hit of the chain cuts in a different
// plane, and each starts on the side where the hit before it leaves the blade (hit 1 ends on his
// left, hit 2 on his right), so the steel swings back the way a pendulum does.

export const SWINGS = {
  // ---- hit 1: right to left ------------------------------------------------------------------
  /** The falling cut: cocked beside the head, a diagonal from high right down past the left hip. */
  fallingCut: {
    line: 'right',
    keys: [
      { u: 1.0, h: [-0.08, 0.22, -0.06], a: [-152, 42], l: [0.0, -0.1, 0.34], by: -0.07, bz: -0.06, bx: -0.03, hip: -0.36, sy: -0.44, sx: -0.04, sz: 0.04 },
      { u: 1.25, h: [0.0, 0.22, 0.2], a: [-60, 70] },
      { u: 1.5, h: [0.13, -0.04, 0.47], a: [-8, 8], l: [0.2, -0.24, 0.14], by: -0.19, bz: 0.06, bx: 0.0, hip: 0.16, sy: -0.02, sx: 0.32, sz: 0.0 },
      { u: 1.75, h: [0.24, -0.24, 0.42], a: [28, -28] },
      { u: 2.0, h: [0.3, -0.36, 0.3], a: [50, -42], l: [0.3, -0.40, -0.04], by: -0.26, bz: 0.1, bx: 0.03, hip: 0.38, sy: 0.38, sx: 0.44, sz: -0.06 },
      { u: 2.4, h: [0.34, -0.38, 0.16], a: [118, -26], l: [0.3, -0.40, -0.08], by: -0.24, bz: 0.08, bx: 0.03, hip: 0.42, sy: 0.46, sx: 0.38, sz: -0.05 },
    ],
  },
  /** The draw cut: low and flat from behind the right hip, sinking into it. */
  drawCut: {
    line: 'flat',
    keys: [
      { u: 1.0, h: [-0.14, -0.37, -0.16], a: [-156, -10], l: [0.02, -0.2, 0.32], by: -0.2, bz: -0.05, bx: -0.03, hip: -0.42, sy: -0.48, sx: 0.26 },
      { u: 1.3, h: [-0.02, -0.34, 0.24], a: [-80, -6] },
      { u: 1.5, h: [0.14, -0.3, 0.44], a: [-5, -3], l: [0.22, -0.26, 0.1], by: -0.28, bz: 0.06, bx: 0.0, hip: 0.12, sy: 0.0, sx: 0.36 },
      { u: 1.75, h: [0.3, -0.26, 0.36], a: [55, 3] },
      { u: 2.0, h: [0.38, -0.2, 0.2], a: [100, 10], l: [0.3, -0.36, -0.06], by: -0.24, bz: 0.09, bx: 0.03, hip: 0.4, sy: 0.42, sx: 0.28 },
      { u: 2.4, h: [0.36, -0.12, 0.1], a: [138, 22], l: [0.3, -0.36, -0.1], by: -0.18, bz: 0.07, bx: 0.03, hip: 0.44, sy: 0.48, sx: 0.2 },
    ],
  },
  /** The leaping cut: a skip in, the blade from behind the head straight down the middle. */
  leapCut: {
    line: 'down',
    flat: [1, 0, 0],
    keys: [
      { u: 1.0, h: [0.03, 0.32, -0.08], a: [180, 52], l: [0.0, -0.02, 0.36], by: -0.02, bz: -0.05, hip: -0.16, sy: -0.22, sx: -0.18 },
      { u: 1.3, h: [0.08, 0.3, 0.22], a: [0, 78] },
      { u: 1.55, h: [0.14, 0.02, 0.47], a: [0, 12], l: [0.24, -0.2, 0.1], by: -0.14, bz: 0.06, hip: 0.05, sy: 0.05, sx: 0.3 },
      { u: 1.8, h: [0.16, -0.24, 0.42], a: [2, -35] },
      { u: 2.0, h: [0.17, -0.36, 0.34], a: [5, -58], l: [0.3, -0.32, -0.1], by: -0.29, bz: 0.1, hip: 0.1, sy: 0.12, sx: 0.52 },
      { u: 2.4, h: [0.18, -0.4, 0.3], a: [8, -62], l: [0.3, -0.32, -0.12], by: -0.3, bz: 0.1, sx: 0.52 },
    ],
  },

  // ---- hit 2: left to right ------------------------------------------------------------------
  /** The rising backhand: from the left hip up across his front to high on the right. */
  risingBackhand: {
    line: 'right',
    keys: [
      { u: 1.0, h: [0.36, -0.37, 0.06], a: [148, -30], l: [-0.14, -0.14, 0.26], by: -0.23, bz: -0.04, bx: 0.03, hip: 0.38, sy: 0.47, sx: 0.32 },
      { u: 1.25, h: [0.3, -0.3, 0.34], a: [70, -22] },
      { u: 1.5, h: [0.14, -0.12, 0.47], a: [8, 0], l: [0.14, -0.24, 0.12], by: -0.16, bz: 0.06, bx: 0.0, hip: -0.04, sy: 0.1, sx: 0.22 },
      { u: 1.75, h: [-0.08, 0.08, 0.42], a: [-40, 26] },
      { u: 2.0, h: [-0.2, 0.2, 0.3], a: [-70, 46], l: [0.3, -0.40, -0.06], by: -0.05, bz: 0.09, bx: -0.03, hip: -0.34, sy: -0.32, sx: 0.04, sz: 0.05 },
      { u: 2.4, h: [-0.24, 0.26, 0.12], a: [-118, 58], l: [0.3, -0.42, -0.08], by: -0.03, bz: 0.07, bx: -0.03, hip: -0.4, sy: -0.42, sx: -0.03, sz: 0.04 },
    ],
  },
  /** The flat backhand: level at chest height, the whole body pivoting round with it. */
  flatBackhand: {
    line: 'flat',
    keys: [
      { u: 1.0, h: [0.36, -0.1, 0.16], a: [148, 12], l: [-0.12, -0.16, 0.26], by: -0.16, bz: -0.04, bx: 0.03, hip: 0.4, sy: 0.5, sx: 0.16 },
      { u: 1.25, h: [0.3, -0.1, 0.36], a: [80, 4] },
      { u: 1.5, h: [0.1, -0.08, 0.47], a: [5, 2], l: [0.16, -0.24, 0.1], by: -0.19, bz: 0.06, bx: 0.0, hip: -0.04, sy: 0.05, sx: 0.22 },
      { u: 1.75, h: [-0.16, -0.06, 0.42], a: [-55, 4] },
      { u: 2.0, h: [-0.3, -0.04, 0.26], a: [-100, 6], l: [0.3, -0.36, -0.08], by: -0.17, bz: 0.09, bx: -0.03, hip: -0.38, sy: -0.38, sx: 0.12 },
      { u: 2.4, h: [-0.32, -0.02, 0.1], a: [-138, 12], l: [0.3, -0.36, -0.1], by: -0.15, bz: 0.07, bx: -0.03, hip: -0.44, sy: -0.46, sx: 0.08 },
    ],
  },
  /** The falling backhand: lifted over the left shoulder, a diagonal down to the right hip. */
  fallingBackhand: {
    line: 'left',
    keys: [
      { u: 1.0, h: [0.32, 0.14, 0.1], a: [156, 46], l: [0.02, -0.16, 0.3], by: -0.08, bz: -0.05, bx: 0.03, hip: 0.34, sy: 0.45, sx: 0.0, sz: -0.04 },
      { u: 1.25, h: [0.24, 0.14, 0.34], a: [70, 56] },
      { u: 1.5, h: [0.1, -0.06, 0.47], a: [6, 10], l: [0.2, -0.26, 0.06], by: -0.19, bz: 0.06, bx: 0.0, hip: -0.04, sy: 0.02, sx: 0.3 },
      { u: 1.75, h: [-0.12, -0.26, 0.4], a: [-38, -26] },
      { u: 2.0, h: [-0.24, -0.36, 0.26], a: [-70, -40], l: [0.3, -0.30, -0.1], by: -0.26, bz: 0.1, bx: -0.03, hip: -0.34, sy: -0.36, sx: 0.4, sz: 0.06 },
      { u: 2.4, h: [-0.26, -0.4, 0.08], a: [-122, -30], l: [0.3, -0.30, -0.12], by: -0.24, bz: 0.08, bx: -0.03, hip: -0.4, sy: -0.44, sx: 0.34, sz: 0.05 },
    ],
  },

  // ---- hit 3 ---------------------------------------------------------------------------------
  /** The whirl: he follows the backhand round to his right, a full turn (combat.js `spin`) with the
   *  sword arm thrown out level and the free arm carried out by the turn; the blade crosses his front
   *  late in the turn and carries on round to his right. */
  whirl: {
    line: 'flat',
    keys: [
      { u: 1.0, h: [-0.34, -0.05, 0.0], a: [-128, 4], l: [-0.1, -0.12, 0.28], by: -0.16, hip: -0.16, sy: -0.24, sx: 0.14 },
      { u: 1.5, h: [-0.4, -0.06, 0.14], a: [-100, 0], l: [0.26, -0.14, 0.04], by: -0.2, hip: -0.1, sy: -0.12, sx: 0.22 },
      { u: 2.0, h: [-0.36, -0.08, 0.26], a: [-62, -3], l: [0.3, -0.32, -0.06], by: -0.22, bz: 0.06, hip: -0.12, sy: -0.2, sx: 0.26 },
      { u: 2.35, h: [-0.34, -0.16, 0.1], a: [-115, -14], l: [0.26, -0.3, -0.06], by: -0.2, bz: 0.05, hip: -0.32, sy: -0.4, sx: 0.2 },
    ],
  },
  /** The rising whirl: the same turn out of a crouch, the blade spiralling up from the knee. */
  risingWhirl: {
    line: 'spiral',
    keys: [
      { u: 1.0, h: [-0.3, -0.3, 0.0], a: [-128, -32], l: [-0.1, -0.2, 0.28], by: -0.28, hip: -0.16, sy: -0.24, sx: 0.32 },
      { u: 1.5, h: [-0.4, -0.14, 0.14], a: [-100, -5], l: [0.26, -0.16, 0.04], by: -0.17, hip: -0.1, sy: -0.12, sx: 0.2 },
      { u: 2.0, h: [-0.34, 0.1, 0.26], a: [-62, 30], l: [0.3, -0.38, -0.06], by: -0.05, bz: 0.06, hip: -0.12, sy: -0.2, sx: 0.04 },
      { u: 2.35, h: [-0.3, 0.2, 0.1], a: [-115, 48], l: [0.3, -0.42, -0.08], by: -0.03, bz: 0.05, hip: -0.32, sy: -0.38, sx: -0.02 },
    ],
  },
  /** The low sweep: dropping from the backhand's finish into a crouch, the blade skimming the grass
   *  right to left, the free hand up for balance. */
  lowSweep: {
    line: 'low',
    keys: [
      { u: 1.0, h: [-0.22, -0.32, -0.16], a: [-150, -14], l: [0.1, 0.06, 0.24], by: -0.34, bz: -0.04, hip: -0.36, sy: -0.42, sx: 0.42 },
      { u: 1.4, h: [-0.06, -0.36, 0.24], a: [-78, -12] },
      // (the blade crosses his front late in the cut, when the step in is nearly done: a low blade
      // reaches less far under a tall target, combat.js REACH)
      { u: 1.65, h: [0.13, -0.34, 0.45], a: [-5, -10], l: [0.24, 0.04, 0.04], by: -0.36, bz: 0.07, hip: 0.1, sy: 0.05, sx: 0.5 },
      { u: 1.85, h: [0.28, -0.36, 0.34], a: [55, -12] },
      { u: 2.0, h: [0.36, -0.34, 0.18], a: [100, -10], l: [0.3, 0.08, -0.12], by: -0.35, bz: 0.08, hip: 0.36, sy: 0.4, sx: 0.44 },
      { u: 2.4, h: [0.36, -0.3, 0.08], a: [138, -6], l: [0.3, 0.08, -0.14], by: -0.32, bz: 0.07, hip: 0.4, sy: 0.45, sx: 0.4 },
    ],
  },

  // ---- hit 4: along the line ------------------------------------------------------------------
  /** The lunge: the hand drawn back to the ribs, then one long line from the rear heel to the
   *  point, the free hand drawn back to the hip as the sword arm drives out. */
  lunge: {
    line: 'point',
    lF: [0.14, 0.46],
    keys: [
      { u: 1.0, h: [-0.03, -0.16, -0.08], a: [3, 2], l: [0.0, -0.12, 0.32], by: -0.17, bz: -0.07, hip: -0.34, sy: -0.5, sx: 0.08 },
      { u: 1.45, h: [0.08, -0.1, 0.26], a: [1, 1], l: [0.12, -0.16, 0.14], by: -0.22, bz: 0.04, hip: -0.04, sy: -0.06, sx: 0.28 },
      { u: 1.9, h: [0.15, -0.05, 0.51], a: [0, -1], l: [0.24, -0.16, -0.08], by: -0.27, bz: 0.13, hip: 0.24, sy: 0.34, sx: 0.47 },
      { u: 2.45, h: [0.14, -0.07, 0.47], a: [0, -2], l: [0.26, -0.14, -0.14], by: -0.25, bz: 0.1, hip: 0.22, sy: 0.3, sx: 0.42 },
    ],
  },
  /** The rising thrust: out of a crouch, the point driven up into the target. */
  risingThrust: {
    line: 'point',
    lF: [0.14, 0.46],
    keys: [
      { u: 1.0, h: [-0.04, -0.34, -0.06], a: [4, 12], l: [0.0, -0.2, 0.32], by: -0.32, bz: -0.07, hip: -0.34, sy: -0.46, sx: 0.3 },
      { u: 1.45, h: [0.07, -0.16, 0.26], a: [2, 18], l: [0.12, -0.22, 0.14], by: -0.24, bz: 0.04, hip: -0.04, sy: -0.06, sx: 0.26 },
      { u: 1.9, h: [0.15, 0.08, 0.5], a: [0, 24], l: [0.24, -0.26, -0.08], by: -0.1, bz: 0.12, hip: 0.24, sy: 0.32, sx: 0.16 },
      { u: 2.45, h: [0.14, 0.04, 0.45], a: [0, 20], l: [0.26, -0.26, -0.12], by: -0.12, bz: 0.1, hip: 0.22, sy: 0.3, sx: 0.16 },
    ],
  },

  // ---- the charged attack ----------------------------------------------------------------------
  /** The dashing cleave (combat.js CLEAVE), both hands on the grip: he leaves the charge's coil
   *  leaning into the dash with the blade still up beside his head, winding back over the shoulder,
   *  and as the dash dies out the whole body unwinds: one diagonal from high right through his front
   *  to past the left hip, sinking into a long low lunge. The off hand lets go as the blade sweeps
   *  on behind him, and he holds that finish. */
  cleave: {
    line: 'right',
    home: 0.55,
    keys: [
      { u: 0.9, h: [-0.04, 0.08, 0.1], a: [-145, 74], two: 1, by: -0.26, bz: 0.05, hip: -0.34, sy: -0.5, sx: 0.4 },
      { u: 1.4, h: [-0.02, 0.12, 0.04], a: [-160, 55], two: 1, by: -0.23, bz: 0.06, hip: -0.32, sy: -0.52, sx: 0.44 },
      { u: 1.55, h: [0.05, 0.18, 0.2], a: [-90, 66] },
      { u: 1.7, h: [0.14, -0.02, 0.44], a: [-10, 12], by: -0.26, hip: 0.1, sy: 0.0, sx: 0.4 },
      { u: 1.86, h: [0.24, -0.26, 0.4], a: [35, -32] },
      { u: 2.0, h: [0.3, -0.38, 0.3], a: [58, -44], two: 1, by: -0.32, bz: 0.08, hip: 0.36, sy: 0.4, sx: 0.5 },
      { u: 2.25, h: [0.36, -0.4, 0.12], a: [125, -28], two: 0, l: [0.3, -0.34, -0.12], by: -0.34, hip: 0.42, sy: 0.5, sx: 0.46 },
      { u: 2.6, h: [0.36, -0.4, 0.12], a: [128, -26], two: 0, l: [0.3, -0.34, -0.14], by: -0.33, hip: 0.42, sy: 0.5, sx: 0.44 },
    ],
  },

  // ---- out of a sprint / a roll ----------------------------------------------------------------
  /** The sprint slash: on the run, from behind the right knee up across his front to high left. */
  sprintSlash: {
    line: 'left',
    keys: [
      { u: 1.0, h: [-0.16, -0.37, -0.18], a: [-156, -38], l: [0.0, -0.16, 0.32], by: -0.22, hip: -0.32, sy: -0.42, sx: 0.42 },
      { u: 1.3, h: [-0.02, -0.3, 0.26], a: [-75, -28] },
      { u: 1.5, h: [0.14, -0.12, 0.47], a: [-5, 5], l: [0.2, -0.26, 0.1], by: -0.16, bz: 0.05, hip: 0.1, sy: 0.0, sx: 0.25 },
      { u: 1.75, h: [0.3, 0.08, 0.38], a: [45, 38] },
      { u: 2.0, h: [0.4, 0.22, 0.2], a: [80, 58], l: [0.3, -0.40, -0.06], by: -0.05, bz: 0.05, hip: 0.3, sy: 0.34, sx: 0.02 },
      { u: 2.35, h: [0.4, 0.28, 0.06], a: [128, 62], l: [0.3, -0.42, -0.08], by: -0.03, hip: 0.34, sy: 0.4, sx: -0.04 },
    ],
  },
  /** The roll cut: out of the roll's crouch, low from the right and rising past the left shoulder. */
  rollCut: {
    line: 'left',
    keys: [
      { u: 1.0, h: [-0.14, -0.37, -0.14], a: [-152, -14], l: [0.0, -0.25, 0.3], by: -0.36, hip: -0.38, sy: -0.44, sx: 0.45 },
      { u: 1.3, h: [-0.02, -0.34, 0.24], a: [-78, -10] },
      { u: 1.5, h: [0.14, -0.28, 0.44], a: [-5, -4], l: [0.2, -0.28, 0.1], by: -0.3, bz: 0.05, hip: 0.1, sy: 0.02, sx: 0.4 },
      { u: 1.75, h: [0.3, -0.16, 0.36], a: [52, 14] },
      { u: 2.0, h: [0.38, -0.04, 0.2], a: [95, 34], l: [0.3, -0.38, -0.06], by: -0.18, bz: 0.05, hip: 0.34, sy: 0.38, sx: 0.2 },
      { u: 2.4, h: [0.38, 0.06, 0.08], a: [133, 46], l: [0.3, -0.38, -0.08], by: -0.12, hip: 0.38, sy: 0.44, sx: 0.14 },
    ],
  },
};
