// THE CLOAK HELD CALM IN THE SWINGS (ADR-292; the owner, 2026-11-28: "the bottom left part of the cloak feathered
// part appears during the 5th light attack combo and makes it look bad. make sure his cloak feathers aren't
// clipping anywhere or moving randomly like in the 5th attack. its flapping too much"). Two causes, measured on
// the light chain (the cloak's sheets are anim.js `_streamers`, gear/shroud.js SHROUD_SHEETS):
//   - the torn drape hung on his LEFT UPPER ARM turned with that arm: in the two-handed finisher (combo A's 5th,
//     heavyCrush) the arm crosses his chest to the grip, and the drape stood out level off his left side, its
//     pale torn points a wing at shoulder height from behind (it hit its swing limit, 1.45 rad, every finisher);
//   - every sheet trails the speed of its own root, and in a swing the roots move with the arms and the chest's
//     turn, not with him: 6 - 9 m/s in the chain against 4.7 at a run, so the cloak flapped harder in a cut than
//     in a sprint.
// The calm:
//   arm    a sheet hung on an arm is carried by the chest as that arm lifts off hanging (the angle between the
//          arm's down and the chest's down, from `lift[0]` to `lift[1]` rad, `hold` of the way at the most):
//          hanging, it rides the arm as it always did; raised or across his chest, it hangs from the shoulder
//   rel    the part of a root's speed that is not his body's own travel (the arms' and the chest's whip) is
//          kept under rel[0] m/s for a sheet on the chest, rel[1] for one on an arm; a run, a lunge, a roll and
//          a dodge stream the cloak exactly as before
//   armMax the most an arm's sheet swings from hanging (rad; the cloak's own is 1.45)
//   push   how fast (rad/s) a sheet is eased onto its bound when the bound jumps (the blade or an arm crossing
//          its line: the bound flips side), instead of set onto it in one frame
// Only today's cloak (gear/shroud.js, its sheets' `calm`): the outfits kept for later keep the cloth they were tuned
// with. `?cloth=old` (Lab: the 'cloth' button) draws the cloak as before.

export const CLOTH = { lift: [0.4, 1.0], hold: 1, rel: [1.6, 0.8], armMax: 0.95, push: 7 };
export const CLOTH_IDS = ['calm', 'old'];
let clothNow = 'calm';
export const clothMode = () => clothNow;
/** Pick the cloak's behaviour (live); false for an unknown id. */
export function setCloth(m) {
  if (!CLOTH_IDS.includes(m)) return false;
  clothNow = m;
  return true;
}
{
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('cloth') : null;
  if (q) setCloth(q);
}
