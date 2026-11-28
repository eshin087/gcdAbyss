import { lookOf } from '../enemies/duelist/lookSwitch.js';
import { clamp, lerp, smoothstep } from '../../core/math.js';
import { WYRM_STRIKE } from './tuningMotion.js';
import { SCALE as S } from './tuning.js';
import * as THREE from 'three';
import { fixOn } from './motionFix.js';

const _q = new THREE.Quaternion(), _qI = new THREE.Quaternion(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _pg = new THREE.Vector3();
/** The snap spread over the lead (WYRM_STRIKE.bite.snap; `?wyrmFix=0`: the head holds, then jumps). */
export const snapOn = () => WYRM_STRIKE.bite.snap && fixOn();
/** Hermite ease from rest to `v1` x the average speed at u = 1. */
const ease = (u, v1) => (v1 - 2) * u * u * u + (3 - v1) * u * u;
/** The head on its arc round the neck's base `nb`, from `from` to `goal` at e (0..1), into `out`. */
function arc(out, nb, from, goal, e) {
  _d0.subVectors(from, nb);
  _d1.subVectors(goal, nb);
  const r0 = _d0.length(), r1 = _d1.length();
  if (!(r0 > 1e-3 && r1 > 1e-3)) return out.lerpVectors(from, goal, e);
  _d0.multiplyScalar(1 / r0);
  _d1.multiplyScalar(1 / r1);
  _q.setFromUnitVectors(_d0, _d1);
  _q.slerp(_qI, 1 - e);
  return out.copy(_d0).applyQuaternion(_q).multiplyScalar(r0 + (r1 - r0) * e).add(nb);
}

// The wyrm's strike pass (ADR-257; tuningMotion.js WYRM_STRIKE; `?wyrmStrike=a`, the owner's pick, the default; '0' as it shipped):
// the order a bite travels through its body. The anatomy audit (integ.mjs `wyrmanatomy`) found every bite
// moving hips, chest, neck and head on the same frame (the front of the wyrm one block), its jaws still
// 1.2 - 3.3 m short of the hero when the flash's impact came (closest 0.07 - 0.27 s after it: the head's
// chase was fastest on its first frame). Here the body surges first while the head hangs back, then the
// head snaps onto the beat. Pose fields and a short root surge, read the frame they are set (ai.js resets
// them); the windup, the cue, the impact and the hit spheres are as before.

/** The pass is on (read every frame: the Lab flips it live). */
export const strikeOn = () => lookOf('wyrmStrike', '0') === 'a';

/**
 * A bite's last windup frames (every bite kind, after its own windup pose): the body leads. Over the last
 * WYRM_STRIKE.bite.lead s the chest drops and pitches into the strike off the planted hind feet (to a
 * little past the active's own body: the overshoot it settles from), while the head HANGS where it was
 * (its goal frozen in the world): the neck compresses under it, the coil the snap releases. `st` is the
 * bite's state (biteStart). Off: nothing.
 */
export function biteLead(d, a, st, dt, predict = null) {
  if (!strikeOn()) return false;
  const B = WYRM_STRIKE.bite, left = a.dur - a.t;
  // (the spread snap starts the head `pre` s before the active, the body's lead stays `lead`)
  const spread = snapOn() && !!predict;
  const pre = spread ? Math.max(B.lead, B.pre) : B.lead;
  if (!(left < pre)) {
    st.held = false;
    return false;
  }
  const pose = d.pose;
  if (!st.held) {
    st.held = true;
    st.hold.copy(d.rig.headPos);
  }
  pose.head = pose.headTarget.copy(st.hold);
  pose.headRate = 14;
  // the snap sets off, toward the goal the active is about to lock (predicted), along its arc
  if (spread && predict(_pg)) {
    st.lead = pre;
    const u = clamp((pre - left) / (pre + (st.impact ?? 0.06)), 0, 1);
    arc(pose.headTarget, d.rig.pt.neckBase, st.hold, _pg, ease(u, B.v1));
    pose.headRate = B.followRate;
    pose.headOffset.set(0, 0, 0);
    d._snapAt = d.time; // (tellPose.js: the held colour pose leaves the head to the path this frame)
  }
  pose.headLead.set(0, 0, 0);
  if (!(left < B.lead)) return true; // (the body's own lead has not begun)
  const e = smoothstep(B.lead, 0, left);
  pose.lower = lerp(pose.lower, B.lower, e);
  pose.pitch = lerp(pose.pitch, B.pitch, e);
  pose.bodyRate = 12;
  pose.hindLock = true;
  // the surge: the whole body travels `surge` model units toward the hero over the lead (a lunge reads from
  // the high camera where a neck's reach toward the lens does not), never into a hero already in reach
  if (d.sense.dist > B.surgeFrom * S) d.moveForward(((2 * B.surge * S) / B.lead) * (1 - left / B.lead), dt);
  return true;
}

/**
 * The snap (a bite's active, `t` s into it, its impact at `impact` s): the head runs from where it hung
 * to the bite's goal on an accelerating path that arrives ON the impact (the flash's promise), at full
 * speed, then holds there through the bite; the body settles back from its overshoot. Returns true when
 * it drove the head (the caller skips its own head goal).
 */
export function biteSnap(d, st, t, impact) {
  if (!strikeOn() || !st.held) return false;
  const pose = d.pose, B = WYRM_STRIKE.bite;
  if (!st.from) return false;
  if (!st.snapFrom) {
    st.snapFrom = true;
    st.from.copy(d.rig.headPos);
  }
  if (snapOn() && st.lead > 0) {
    // the spread snap goes on from where the lead left it: one path from the hold to the goal, on the beat
    const u = clamp((st.lead + t) / (st.lead + Math.max(1 / 60, impact)), 0, 1);
    arc(pose.headTarget, d.rig.pt.neckBase, st.hold, st.goal, ease(u, B.v1));
    pose.head = pose.headTarget;
    pose.headRate = B.headRate;
  } else {
    const u = clamp(t / Math.max(1 / 60, impact), 0, 1);
    const e = B.ease * u + (1 - B.ease) * u * u; // fast in: it moves at once and accelerates into the contact
    pose.head = pose.headTarget.lerpVectors(st.from, st.goal, e);
    pose.headRate = B.headRate;
  }
  // the body: from a little past its strike pose back onto it (overshoot, then settle)
  const o = 1 - smoothstep(0, B.settle, t);
  pose.lower += (B.lower - 0.3) * o;
  pose.pitch += (B.pitch - 0.14) * o;
  return true;
}
