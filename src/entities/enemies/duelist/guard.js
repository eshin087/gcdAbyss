// A duelist's guard, as the reaction clips every duelist shares (a kit spreads GUARD_CLIPS into its
// own reaction clips; they are compiled round its stance, poses.js, so a field not keyed here is the
// stance's). Keyed in body space round a side-on body (yaw 0.5), as the first 'clash' clip was.
//
// What the guard has to say, read from him alone (COMBAT.md → "His guard"):
//   wardHold   the guard RAISED: the hero is swinging at him and he will turn it. The blade leaves
//              the en-garde line (its point at the hero) and stands across his body as a wall, the
//              free palm braced behind the flat. brain.js blends it in over his footwork (wardK).
//   ward / wardR / wardHigh   a strike MET: on his left, on his right, from above. The contact pose
//              is the clip's FIRST frame (a hit-stop holds that frame: a pose that only arrives 0.06 s
//              in is never seen), then he gives with the blow and comes back to his guard.
//   deflect    he does not hold the strike, he BEATS it away: the blade whips out across the hero's
//              line and the hero's is thrown back (player.onGuarded { deflect }). His counter follows.
//   clash      (the old name: a ward) kept for the lost blade lock's shove.

const TURN = { yaw: 0.5, hdY: -0.42 };
// a wall on his left: the grip low before the right chest, the blade steep across the body to past
// the left shoulder, the free palm behind the flat
const WARD_L = { ...TURN, bY: -0.21, bZ: -0.04, pitch: -0.02, spX: 0.02, rH: [0.12, -0.04, 0.36], rP: [-0.7, -0.55, -0.2], sw: [1.15, 0.86], swF: [0, 0.3, -1], lH: [-0.03, 0.26, 0.42], lP: [0.7, -0.4, 0.2] };
// on his right: the grip out beside the right shoulder, the blade standing up and a little out
const WARD_R = { ...TURN, yaw: 0.36, bY: -0.21, bZ: -0.04, pitch: -0.02, spY: -0.3, rH: [-0.12, -0.02, 0.32], rP: [-0.9, -0.3, -0.2], sw: [-1.25, 1.0], swF: [0, 0.3, 1], lH: [0.06, -0.06, 0.3], lP: [0.7, -0.4, 0.2] };
// from above: the grip up before the brow, the blade level across over the head, the palm under it
const WARD_HIGH = { ...TURN, yaw: 0.3, bY: -0.26, bZ: -0.03, pitch: -0.05, spX: -0.04, hdX: -0.1, rH: [-0.04, 0.26, 0.3], rP: [-0.9, 0.2, -0.2], sw: [1.3, 0.1], swF: [0, 1, 0], lH: [-0.02, 0.36, 0.34], lP: [0.8, 0.3, 0.1] };
/** A met strike: the contact (t 0), the give (he is driven back into his chest), and back to the
 *  ward, which he keeps raised (`hold`: the clip ends in it, and his footwork carries it on: wardK). */
const met = (W, dur = 0.34) => ({
  dur, hold: true,
  keys: [
    [0, { ...W }],
    [0.07, { e: 'o', ...W, bZ: W.bZ - 0.07, pitch: W.pitch - 0.05, rH: [W.rH[0], W.rH[1], W.rH[2] - 0.07], spX: (W.spX ?? 0.02) - 0.05 }],
    [0.2, { ...W, bZ: W.bZ - 0.03 }],
  ],
});
// the beat: from the wall the blade whips out and down across the hero's line, the body driving in
const BEAT = { yaw: 0.72, hdY: -0.6, bY: -0.24, bZ: 0.08, pitch: 0.07, spY: -0.25, rH: [-0.16, 0.06, 0.4], rP: [-0.9, -0.2, -0.1], sw: [-1.35, 0.42], swF: [0, 1, 0.3], lH: [0.16, 0.0, 0.2], lP: [0.8, -0.2, 0.3] };

export const GUARD_CLIPS = {
  ward: met(WARD_L),
  wardR: met(WARD_R),
  wardHigh: met(WARD_HIGH, 0.38),
  clash: met(WARD_L, 0.26),
  deflect: {
    dur: 0.24,
    keys: [
      [0, { ...WARD_L, bZ: 0.0 }],
      [0.07, { e: 'o', ...BEAT }],
      [0.17, { ...BEAT, bZ: 0.05, sw: [-1.2, 0.36] }],
    ],
  },
  wardHold: { dur: 1, hold: true, keys: [[0, { ...WARD_L }]] },
};

/** How far each of them moves him along his facing (m; brain.js REACT_BASE takes them). */
export const GUARD_TRAVEL = { ward: -0.24, wardR: -0.24, wardHigh: -0.16, clash: -0.15, deflect: 0.12 };
/** The reaction kinds that are a guard (his guard is up through them). */
export const GUARD_KINDS = new Set(['ward', 'wardR', 'wardHigh', 'clash', 'deflect']);
