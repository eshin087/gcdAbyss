import { lookOf } from '../duelist/lookSwitch.js';

// Shen Hui drawn after the reference pack (docs/art/character-packs-v04/shen-hui, ADR-289). Two switches,
// each '0' (the figure and the motion as they ship) until the owner picks:
//   ?ashRef=a      his look (gear.js, read when his rig is built: a page load per option): the bracer of
//                  old bronze on his sword forearm (the anchor's "bracer (old bronze)", not the charcoal
//                  cloth strips), brick-red inner folds showing down the front and the back of the robe
//                  between its panels, and the robe layered and ragged: an over-robe's torn edge at
//                  mid-thigh and frayed ends along the whole hem in every phase (phase 3's own frays
//                  still come on top). The hat, the straight jian with its disc guard, its red tassel,
//                  the colours and the phase dressing (`?ashLook`: phase 2's smoulder, phase 3's lost hat,
//                  loose hair and pale robe) are kept as they are.
//   ?ashRefMove=a  his motion (poses.js / moves.js): the poses only, never the timing, the zones, the
//                  damage or the root motion.

export const refLook = () => lookOf('ashRef', '0') !== '0';

/**
 * The rebuild's three steps of one build (refGear.js; `?ashRef=a|b|c`): a after the anchor, b fuller and
 * longer (the robe to the lower calf, wider sleeves, deeper tears), c leaner (the robe to the knee, closer
 * sleeves, shallower tears). Lengths in metres:
 *   len        the skirt's two segments (sash -> mid-thigh, mid-thigh -> hem)   full   panel widths x
 *   tear       the hem's torn points' depth          over   the over-layer's tear (0: none)
 *   blouse     the robe's fullness over the sash     loose  at the chest
 *   sleeve     the upper sleeve's fullness at the shoulder / the elbow
 *   swordCuff  the sword sleeve below the elbow      freeLen / freeBell  the free sleeve's length / its bell
 *   sleeveTear the sleeves' torn edge                trouser  the trousers' fullness
 *   wrapTop    the wraps start this far below the knee   hatFray  the brim's loose straw
 *   locks      the locks by his face                 tail   the hair's tail (two segments)
 *   sashTail   the sash's two tails
 */
export const REF_BUILD = Object.freeze({
  a: Object.freeze({ len: [0.34, 0.32], full: 1, tear: 0.11, over: 0.06, blouse: 0.02, loose: 0.014, sleeve: [0.018, 0.036], swordCuff: 0.08, freeLen: 0.25, freeBell: 0.06, sleeveTear: 0.035, trouser: 0.026, wrapTop: 0.17, hatFray: 0.018, locks: 0.12, tail: [0.15, 0.18], sashTail: [0.26, 0.2] }),
  b: Object.freeze({ len: [0.37, 0.43], full: 1.15, tear: 0.15, over: 0.08, blouse: 0.026, loose: 0.02, sleeve: [0.024, 0.05], swordCuff: 0.1, freeLen: 0.27, freeBell: 0.085, sleeveTear: 0.05, trouser: 0.032, wrapTop: 0.19, hatFray: 0.024, locks: 0.14, tail: [0.17, 0.22], sashTail: [0.32, 0.24] }),
  c: Object.freeze({ len: [0.32, 0.22], full: 0.9, tear: 0.08, over: 0.045, blouse: 0.012, loose: 0.01, sleeve: [0.012, 0.024], swordCuff: 0.06, freeLen: 0.22, freeBell: 0.04, sleeveTear: 0.025, trouser: 0.02, wrapTop: 0.16, hatFray: 0.012, locks: 0.1, tail: [0.13, 0.15], sashTail: [0.22, 0.16] }),
});
/** The build drawn (a for any other non-'0' value). */
export const refBuild = () => REF_BUILD[lookOf('ashRef', '0')] ?? REF_BUILD.a;
export const refMove = () => lookOf('ashRefMove', '0') !== '0';

/**
 * The guard after F01 [1.5 - 6.5] / P01 "front guard" / A01 08 / V01 "base (return) pose": the same jian
 * level at chest height pointing at the opponent and the same sword-finger arc over his head, on a lower,
 * wider stance (the knees bent, the feet a long stride apart: the sheets' "stable and composed").
 */
export const GUARD_REF = Object.freeze({ sink: 0.07, wide: 0.04, stride: 1.18, knee: 0.08 });

/**
 * The pose layer over a beat's keys (moves.js refKeysOf). From the strips' contact and follow panels
 * (D01 - D12 CONTACT / FOLLOW, F01 rows 1 - 6 "contact" / "follow": the weight committed, the stance long):
 *   load   the windup's last keys sink a little (the D sheets' PREPARE: knees loading);
 *   sink   the contact and the follow-through sink and the body leans into the cut;
 *   wide   feet on the floor a little wider;
 *   floor  a key already lower than this keeps its height (a kneel, a sweep, the Kindling, Ash on the Wind
 *          are not pushed deeper: the knees would fold shut);
 *   free   a one-handed blow's free hand, if it would sit in front of his body at the contact, goes out to
 *          the side and back (opposition: D01 plumThrust / piercingAsh CONTACT, D04 glideKick 4, D12
 *          needleDart 3, the left hand behind, not over the blade);
 *   react  the reactions read bigger (R01 rows 5 - 7: the flinch, the stagger, the reel thrown further).
 */
export const REF = Object.freeze({ load: 0.04, sink: 0.07, lean: 0.08, wide: 0.03, floor: -0.42, free: [0.16, 0.02, -0.18], freeZ: 0.1, reach: 0.52, react: { pitch: 1.3, bZ: 1.35, spX: 1.25, by: 0.04 } });
