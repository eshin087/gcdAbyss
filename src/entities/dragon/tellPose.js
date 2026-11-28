import { TELL } from '../../combat/rules.js';
import { smoothstep } from '../../core/math.js';
import { lookOf } from '../enemies/duelist/lookSwitch.js';
import { SCALE } from './tuning.js';
import { WYRM_HELD } from './tuningMotion.js';

// The wyrm's held tells (ADR-223; tuningMotion.js WYRM_HELD): which hits hold, and the body that says the
// colour while they wind up. Used by attacks.js makeString.

/** The held mode of a string's hit spec ('a' held and coloured, 'b' held, null: as it shipped), read once
 *  when the string starts (`?wyrmMotion=`). */
export function heldMode(spec) {
  const m = lookOf('wyrmMotion', '0');
  if (m !== 'a' && m !== 'b') return null;
  if (spec?.tell !== TELL.BLUE && spec?.tell !== TELL.RED) return null;
  if (!(spec.windup < WYRM_HELD.longer)) return null;
  // (a hit with its own bait hold already hesitates, its head weaving: the Hesitant Maw's rear bite)
  if (Array.isArray(spec.hold) && spec.hold[1] > 0) return null;
  return m;
}

/** Add the colour's posture to the pose targets this frame (after the kind's own windup): `k` the hit's
 *  windup u (0..1, 1 through the hold), `part` its striking part (the rear-up only for a blow of the
 *  head). Pose fields are reset every frame (ai.js), so this only adds. */
export function tellPose(d, tell, k, part = null) {
  const C = tell === TELL.BLUE ? WYRM_HELD.blue : tell === TELL.RED ? WYRM_HELD.red : null;
  const pose = d?.pose;
  if (!C || !pose) return;
  const w = smoothstep(WYRM_HELD.w[0], WYRM_HELD.w[1], k);
  if (!(w > 0.001)) return;
  const S = SCALE, f = d.fwd;
  pose.lower += C.lower * w;
  pose.pitch += C.pitch * w;
  if (C.rear && (part === 'snout' || part === 'head' || part === 'mouth')) pose.rear = Math.max(pose.rear, C.rear * w);
  // (not while a bite's spread snap runs its path, strike.js: the path starts from where this pose put the head)
  const head = d._snapAt !== d.time;
  if (head) pose.headOffset.y += C.headUp * S * w;
  if (head && f && Number.isFinite(f.x + f.z)) {
    pose.headOffset.x -= f.x * C.headBack * S * w;
    pose.headOffset.z -= f.z * C.headBack * S * w;
  }
  pose.jaw = Math.min(1, pose.jaw + C.jaw * w);
  pose.swell = Math.min(1, pose.swell + C.swell * w);
  pose.spread[0] = Math.max(0, Math.min(1, pose.spread[0] + C.spread * w));
  pose.spread[1] = Math.max(0, Math.min(1, pose.spread[1] + C.spread * w));
  pose.tailLift += C.tailLift * w;
  pose.tailCurl += C.tailCurl * w;
  pose.elbowsOut = Math.max(pose.elbowsOut, C.elbowsOut * w);
}
