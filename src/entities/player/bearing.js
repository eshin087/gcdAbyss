// THE HERO'S BEARING (ADR-292; the owner, 2026-11-28: "try to make gcd feel like the main character of an anime in
// terms of vibe and confidence"; asked which touches, they picked a taller, chin-up posture and a blade flick
// after the combo). Two layers over the poses (anim.js HeroAnimator.update), each with its switch:
//
//   BEARING  `?bearing=0` as before. The chest carried up and the chin lifted: standing (at ease and in the
//            fight stance) and between the hits of a chain (from the end of a swing's active frames into its
//            recovery, so the cut itself keeps all its lean and sink). Measured before: at ease the head hung
//            0.08 rad forward (a bowed head), in the fight stance the chest leaned 0.1 rad over the guard.
//              chest / head   rad taken off the chest's lean forward / the head's nod (+ = up), standing at
//                             ease, standing in the fight, and in a swing's recovery
//              ease           s it takes to come in after the active frames (a swing) and to go (anything
//                             else: a run, a roll, a block keep their own bearing)
//   FLICK    `?flick=0` none. After the chain's last hit, when he stops there (no button within the hit's
//            recovery, standing still), a chiburi: the blade comes up, snaps down and out to his right to
//            throw it clean, holds a beat, and the free hand comes to the hilt as it goes back to rest. The
//            idle trick's motion (idles.js trickFlick) on a quicker clock (`dur` s, the snap `snap` of the way
//            in); played as an idle action (anim.js _idleLife), so a step, a guard, an attack or a roll cuts it
//            at once, the way they cut every idle action. `within` s: how long after the hit it may still start.

export const BEARING = {
  chest: { ease: 0.05, fight: 0.06, swing: 0.05 },
  head: { ease: 0.09, fight: 0.06, swing: 0.08 },
  ease: [0.15, 0.25],
};
export const FLICK = { dur: 1.7, snap: 0.3, within: 0.45 };

const q = (name) => {
  try {
    return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(name) : null;
  } catch {
    return null;
  }
};
const S = { bearing: q('bearing') !== '0', flick: q('flick') !== '0' };
export const bearingOn = () => S.bearing;
export const flickOn = () => S.flick;
/** Lab / tests: switch either live. */
export function setBearing(on) {
  S.bearing = !!on;
  return S.bearing;
}
export function setFlick(on) {
  S.flick = !!on;
  return S.flick;
}
