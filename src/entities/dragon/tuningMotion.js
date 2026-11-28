// The wyrm's motion pass (ADR-223): its held tells and its quick blow, as data. Read by tellPose.js and
// attacks.js; behind `?wyrmMotion=a|b` and `?wyrmQuick=a` (lookSwitch.js: '0', the wyrm as it shipped, is
// the default until the owner picks).

/** HELD TELLS: a blue or red hit of a string holds its cock (its kind's windup pose at k = 1) `hold` s
 *  longer before the strike (its windup, and so its impact, that much later: the cue and the strike are
 *  as before), and in mode 'a' its body says the colour while it holds. The audit (integ.mjs `wyrmaudit`)
 *  measured the striking part and the body moving through the whole windup of every blue lunge bite,
 *  wing buffet, wing slam and overhead and every red tail blow (held 0.00 - 0.13 s), and the blue and
 *  white windups of a kind alike. Numbers are model units (x SCALE) and pose fields (rig/anim.js
 *  createPose); `w` eases the colour in over the windup's u (0..1 of its own windup, before the hold). */
export const WYRM_HELD = Object.freeze({
  hold: 0.18, // s more of the cock
  longer: 0.95, // s: a hit wound up this long already reads (the slams): left alone; so is a hit with its own bait `hold`
  w: Object.freeze([0.25, 0.85]),
  // BLUE: it rears up, head high and drawn back over the withers, the jaw open, the chest swelled, the
  // sails lifted: "here it comes, meet it". `rear` lifts the forepaws (rig: a rise past the forelegs'
  // reach sits it back on its haunches instead), for a blow of the head only (a paw or a wing strikes)
  blue: Object.freeze({ lower: 0, pitch: -0.08, rear: 0.32, headUp: 0.6, headBack: 0.45, jaw: 0.25, swell: 0.45, spread: 0.2, tailLift: 0, tailCurl: 0, elbowsOut: 0 }),
  // RED: it sinks onto braced forelegs, head down and low, the sails folded tight, the tail coiled and
  // up: "get out of its way"
  red: Object.freeze({ lower: 0.42, pitch: 0.14, rear: 0, headUp: -0.5, headBack: 0.15, jaw: 0.1, swell: 0, spread: -0.18, tailLift: 0.35, tailCurl: 0.1, elbowsOut: 0.7 }),
});

/** THE QUICK BLOW (`?wyrmQuick=a`): a paw snapped out of its stance, no rear-back (the stance is the
 *  tell; the white glint cue at its very start: windup >= flashLead). Close only, a low weight, never a
 *  string's link. */
export const WYRM_QUICK = Object.freeze({
  weight: [1.1, 1.2, 1.3], // (×0 with the switch off)
});

/** THE STRIKE PASS (ADR-257, strike.js; `?wyrmStrike=a`, the owner's pick, the default; '0' as it shipped): the order a blow runs
 *  through the body. Measured by integ.mjs `wyrmanatomy`. Model units / pose fields / seconds. */
export const WYRM_STRIKE = Object.freeze({
  // BITES: over the last `lead` s of the windup the chest drops to `lower` and pitches to `pitch` (the
  // active's own 0.3 / 0.14, a little past: it settles back over `settle` s of the snap) while the head
  // hangs in the air; the snap runs the head to its goal on u^2 (`ease` its start's share of linear)
  // arriving on the impact, `headRate` the rig's follow (high: the path is the motion)
  // the body also surges `surge` units toward the hero over the lead (only when it stands `surgeFrom` units off)
  bite: Object.freeze({ lead: 0.1, lower: 0.42, pitch: 0.22, settle: 0.12, ease: 0.35, headRate: 70, surge: 0.4, surgeFrom: 4,
    // THE SNAP SPREAD (2026-11-28, the motion audit: `?wyrmFix=0` as before): the head no longer hangs still
    // through the lead and then jumps its 7 - 9 m in the 3 - 4 frames to the impact (a 3 - 4 m step in one
    // frame, the chain whipping after it): it sets off as the body surges, over the lead and the impact
    // (~10 frames), from rest (`v1`: its speed at the contact, x the average), on an arc round the neck's
    // base (a straight line passed 1.7 m from it, nearer than the neck can fold)
    // (`pre`: the head sets off this long before the active, after the cue (0.35 s): ~16 frames for the path;
    // `followRate`: the rig follows the path closely while it runs)
    snap: true, v1: 0.9, pre: 0.2, followRate: 200 }),
});

/** THE PAW BLOWS' TELLS (pawTells.js; `?pawBlue=a|b|c`, `?pawRed=a|b`; '0' as they shipped; the owner's picks, the
 *  defaults (2026-11-28, ADR-274): a the scythe, a the leap). The owner (2026-11-27): "the blue and red warning paw attacks from the dragon need to be
 *  completely different ... it kinda uses the same animation". Both rose up out of the stance and came down in
 *  front of the hero: the blue overhead (one paw raised over the shoulder) and the red stomp (reared, both paws
 *  raised). The options split them on what the game camera reads first: blue is ONE paw, its body twisted or
 *  coiled to one side, at the hero's height; red is the WHOLE body, both paws, symmetric. Model units (x SCALE)
 *  in the root frame (x mirrored by the paw's side), pose fields (rig/anim.js createPose). */
export const WYRM_PAW = Object.freeze({
  // BLUE (the overhead's performance when its tell is blue; a white overhead keeps today's)
  // a  THE SCYTHE: the paw swung out wide and back beside the flank at shoulder height, the chest twisted
  //    away and the near wing folded out of its way, the head low on the hero; then a flat sweep across that
  //    chops down on him
  scythe: Object.freeze({ wind: [3.6, 2.7, 0.2], turn: 0.32, twist: 0.42, roll: 0.1, lower: 0.06, spreadNear: 0.15, spreadFar: 0.62, mid: [2.6, 2.2], follow: 0.3, ease: 1.6 }),
  // b  THE JAB: crouched low, the paw drawn back and tucked under the chest, the wings folded tight, the head
  //    down and still on him, a tremble at the end of the cock; then a straight punch along the ground
  jab: Object.freeze({ wind: [0.8, 1.15, 0.5], lower: 0.34, pitch: 0.16, head: -1.1, spread: 0.12, tremble: [0.75, 0.06, 41], mid: 1.1, ease: 2.2, lunge: 0.8 }),
  // c  THE UPPERCUT: the claws dragged low and back along the ground on the paw's side (grit off them), the
  //    body leaning over them; then swept up from below into the hero, ending at his chest
  upper: Object.freeze({ wind: [2.0, 0.35, 1.0], roll: 0.14, lower: 0.2, twist: 0.2, spreadNear: 0.3, top: 1.25, low: 0.35, ease: 2.4, grit: 0.4 }),
  // RED (the stomp, every one)
  // a  THE LEAP: it crouches, then the whole body jumps straight up off the ground with a beat of the wings
  //    (its shadow left behind), hangs at the top with both paws raised and the wings wide; then it falls
  //    onto both paws. Seen from the fight camera's height a blow that leaves the ground cannot be a paw's
  leap: Object.freeze({ crouchEnd: 0.4, lower: 0.36, pitch: 0.16, alt: 2.6, airPitch: -0.32, paws: [1.6, 2.4, 3.2], flap: 0.55, flapHz: 2.4, spread: 1.0, head: [0, 6.4, 3.4] }),
  // b  THE QUAKE: it sinks low, the wings flat over its back, both paws pressed out wide on the ground, the
  //    head down between them, a shudder building through the body; at the end of the windup it heaves up
  //    (the paws off the ground, the wings snapped open) and slams
  quake: Object.freeze({ lower: 0.46, pitch: 0.18, spread: 0.0, paws: [2.4, 3.1], head: [0, 1.6, 4.6], shake: [0.05, 37], heave: 0.78, heavePitch: -0.5, heaveLower: -0.18, heavePaws: [1.7, 2.6, 3.0], heaveSpread: 0.95 }),
});
