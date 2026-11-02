import * as THREE from 'three';
import { damp, lerp, clamp, TAU } from '../../../core/math.js';
import { ANATOMY as A, SCALE as S } from '../tuning.js';
import { Chain, aimJoint, constrainDir } from './chain.js';
import { solveTwoBone } from './ik.js';
import { Gait } from './gait.js';

// Procedural animation for the four-legged drake. Each frame the AI writes a `pose` (targets); the
// rig smooths them and solves: body (hips/chest, breathing, gait bob) -> neck (FABRIK toward a head
// goal, head aims at a look goal, kept near level) -> tail (springs, follow-the-leader, lateral
// hook) -> hind legs + forelegs (2-bone IK on planted contacts) -> wings (FOLD / HALF / SPREAD keys,
// 2-bone arm IK, two-joint fingers, flap) -> membranes.
// Units: joint transforms below the root are MODEL units (the root carries scale = SCALE); every
// world-space quantity (IK bone lengths, chain lengths, contact homes, clearances) is x S.

const V = () => new THREE.Vector3();
const nrm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

// scratch for aimJointUp (allocation-free)
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3();
const _aM = new THREE.Matrix4(), _aQ = new THREE.Quaternion(), _aQi = new THREE.Quaternion();
/**
 * Aim `joint` (+Z) along world `dir` with its local +Y as close as possible to world `upHint`
 * (aimJoint's minimal rotation leaves the roll to the parent chain). parentWorldQ = the parent's
 * world rotation; returns the joint's world rotation in outWorld.
 */
function aimJointUp(joint, dir, upHint, parentWorldQ, outWorld) {
  _az.copy(dir);
  const l = _az.length();
  if (!(l > 1e-6) || !Number.isFinite(l)) return aimJoint(joint, dir, parentWorldQ, outWorld);
  _az.multiplyScalar(1 / l);
  _ay.copy(upHint).addScaledVector(_az, -upHint.dot(_az));
  const ly = _ay.length();
  if (!(ly > 1e-4)) return aimJoint(joint, dir, parentWorldQ, outWorld);
  _ay.multiplyScalar(1 / ly);
  _ax.crossVectors(_ay, _az);
  _aQ.setFromRotationMatrix(_aM.makeBasis(_ax, _ay, _az));
  joint.quaternion.copy(_aQi.copy(parentWorldQ).invert()).multiply(_aQ);
  return outWorld.copy(_aQ);
}

// ---- wing keys (docs/art/dragon.md §2.6 / §4), CHEST frame, LEFT (+X) wing; x mirrors for the right.
// The chest frame is the root frame minus the standing chest joint (0, 2.85, 1.25), so the keys
// ride along with crouches, rears, rolls and the sleep / death slump.
// spread: 0 = FOLD (closed cloak over the flanks), 0.5 = HALF (the painting's mantled sails),
// 1 = SPREAD (roar / breath / leap), blended piecewise.
const CHEST0 = [0, A.hipY + A.chest[1], A.hipZ + A.chest[2]];
const ck = (x, y, z) => [x - CHEST0[0], y - CHEST0[1], z - CHEST0[2]]; // root -> chest frame
const DEG = Math.PI / 180;
/**
 * wrist: target (chest frame); pole: elbow bend direction; fingers: f0..f3 directions; kink: distal
 * droop per finger (rad, toward the trailing edge / down); thumb: thumb-hook direction.
 */
export const WING_KEYS = {
  // folded: the humerus runs back and up from the root (elbow ~(1.25, 4.15, -0.45)), the long forearm
  // comes forward to a wrist just above and ahead of the shoulder; the fingers lie back along the flank
  FOLD: {
    wrist: ck(1.35, 4.6, 2.1),
    pole: [0.3, 0.2, -1],
    fingers: [[0.05, -0.08, -1.0], [0.15, -0.25, -0.96], [0.2, -0.35, -0.92], [0.25, -0.45, -0.85]].map(nrm),
    kink: [-6 * DEG, -12 * DEG, -5 * DEG, 0],
    thumb: nrm([0.1, -0.55, 0.85]),
  },
  // the painting's mantled sails: the arm rises almost straight (elbow ~135°) to a wrist ~1.9 H up;
  // the fingers fan back and down ~20-25° apart and open ~30-35° off vertical, so from the 58° game
  // camera each sail shows its face (at 0.3 / side-view directions they were edge-on white lances).
  // Thumb: up and forward, its tip hooking down in front (the top-most bright accent of the wing).
  HALF: {
    wrist: ck(1.9, 7.5, 1.15),
    pole: [0.35, 0, -1],
    fingers: [[0.62, -0.12, -0.68], [0.58, -0.5, -0.62], [0.46, -0.78, -0.42], [0.3, -0.95, -0.07]].map(nrm),
    kink: [-12 * DEG, -30 * DEG, -10 * DEG, 0],
    thumb: nrm([0.08, 0.78, 0.62]),
  },
  // roar / leap: the arms out and up, the leading finger rising ~20° above the wrist (a dihedral,
  // not a jet's flat wing). The fingers fan out and down with only a little back-sweep, so the sail
  // faces forward-up: from the front / game camera and the front three-quarter both membranes show
  // their face (a strongly back-swept sail was edge-on there: a white lance)
  SPREAD: {
    wrist: ck(2.9, 7.4, 2.1),
    pole: [0.2, 0.45, -1],
    fingers: [[0.82, 0.4, -0.3], [0.85, -0.3, -0.38], [0.62, -0.62, -0.4], [0.3, -0.88, -0.32]].map(nrm),
    kink: [-4 * DEG, -9 * DEG, -3 * DEG, 0],
    thumb: nrm([0.18, 0.7, 0.69]),
  },
  // fire-breath display (the ASCII panel): both wrists stand far above the body (higher than the
  // head) and the fingers fan down to the back in three deep scallops. Blended over SPREAD by
  // pose.mantle. Its wrist is held in the HIPS frame (hipsWrist), so the breath's front crouch
  // doesn't drag the wrists down with the chest.
  MANTLE: {
    wrist: ck(2.3, 7.9, 2.0),
    hipsWrist: true,
    pole: [0.25, 0.45, -1],
    fingers: [[0.8, 0.45, -0.22], [0.85, -0.25, -0.28], [0.6, -0.68, -0.28], [0.28, -0.92, -0.22]].map(nrm),
    kink: [-4 * DEG, -10 * DEG, -4 * DEG, 0],
    thumb: nrm([0.12, 0.75, 0.65]),
  },
  // stunned (stagger / posture break): half-open, arm lowered to the side, finger tips on the ground
  DROOP: {
    wrist: ck(2.45, 3.35, 1.25),
    pole: [0.35, 0.55, -1],
    fingers: [[0.5, -0.55, -0.67], [0.38, -0.85, -0.37], [0.26, -0.94, -0.2], [0.14, -0.99, 0.02]].map(nrm),
    kink: [-10 * DEG, -22 * DEG, -8 * DEG, 0],
    thumb: nrm([0.25, -0.75, 0.6]),
  },
  // lying down (asleep / dead): folded flat onto the back and flanks
  FOLD_LYING: {
    wrist: ck(1.5, 4.1, 1.9),
    pole: [0.35, 0.1, -1],
    fingers: [[0.12, -0.04, -1.0], [0.2, -0.1, -0.97], [0.27, -0.16, -0.95], [0.32, -0.22, -0.92]].map(nrm),
    kink: [-4 * DEG, -8 * DEG, -4 * DEG, 0],
    thumb: nrm([0.2, -0.3, 0.9]),
  },
};

/** Fresh pose targets. The AI resets these every frame (see resetPose) before editing. */
export function createPose() {
  return {
    head: null, // world Vector3 for the neck end (head joint) or null = rest shape
    headTarget: new THREE.Vector3(),
    headRate: 6,
    headOffset: new THREE.Vector3(), // world offset added to the head goal (flinch, recoil)
    look: new THREE.Vector3(), // world point the head aims at
    lookRate: 7,
    lookDown: 0.14, // max nose-down head pitch (rad): the head stays near level unless an attack frees it
    jaw: 0, // 0..1 (1 = 0.7 rad open)
    jawRate: 12,
    pitch: 0, // + = nose down
    roll: 0,
    lower: 0, // crouch (model units); negative rises
    twist: 0, // chest yaw toward a side
    bodyRate: 5,
    alt: 0, // altitude of the body (airborne, world m)
    airborne: 0, // 0..1 feet tucked
    rear: 0, // 0..1 front feet off the ground (rear-up: stomp windup)
    spread: [0, 0], // per wing (0 = +X/left, 1 = -X/right): 0 FOLD, 0.5 HALF, 1 SPREAD
    spreadRate: 4,
    droop: 0, // 0..1 wings sag toward the DROOP key (stagger / posture break: tips on the ground)
    mantle: 0, // 0..1 spread wings brought forward (MANTLE key: the fire-breath display)
    flap: 0, // flap amplitude (rad)
    flapHz: 2,
    // front-paw overrides (foreleg rakes, slams): world target for the PAW (toe), weight 0..1
    pawOv: [
      { w: 0, pos: new THREE.Vector3() },
      { w: 0, pos: new THREE.Vector3() },
    ],
    pawOvRate: 10,
    // true for one frame: the paw lands at pawOv.pos and becomes a ground contact (the gait then
    // steps it home): the rake's end, the stomp's slam
    pawPlant: [false, false],
    // stance (model units, smoothed): front / hind feet set wider (+) and forward (+) of their homes
    stanceF: 0,
    stanceH: 0,
    strideF: 0,
    strideH: 0,
    restep: 0, // 0..1 lowers the stride threshold so the feet re-plant at the moved homes
    hindLock: false, // hind feet stay planted (the push of a lunge)
    elbowsOut: 0, // 0..1 forelegs bow outward (braced / buckled)
    swell: 0, // 0..1 chest swells (+6 % height: breath / roar charge)
    airReach: 0, // 0..1 airborne legs reach down and forward (dive / landing) instead of tucking
    sleep: 0,
    dead: 0,
    stagger: 0,
    stateRate: 2,
    tailCurl: 0, // extra lateral curl per tail segment (rad)
    tailWave: 0.07,
    tailStiff: 1, // spring stiffness multiplier (tail sweep keeps the tail extended)
    eyes: 1,
    speed: 0, // ground speed for the gait
    vel: new THREE.Vector3(),
  };
}

export function resetPose(p) {
  p.head = null;
  p.headRate = 6;
  p.headOffset.set(0, 0, 0);
  p.lookRate = 7;
  p.lookDown = 0.14;
  p.jaw = 0;
  p.jawRate = 12;
  p.pitch = 0;
  p.roll = 0;
  p.lower = 0;
  p.twist = 0;
  p.bodyRate = 5;
  p.alt = 0;
  p.airborne = 0;
  p.rear = 0;
  p.spread[0] = p.spread[1] = 0;
  p.spreadRate = 4;
  p.droop = 0;
  p.mantle = 0;
  p.flap = 0;
  p.flapHz = 2;
  p.pawOv[0].w = p.pawOv[1].w = 0;
  p.pawOvRate = 10;
  p.pawPlant[0] = p.pawPlant[1] = false;
  p.stanceF = p.stanceH = p.strideF = p.strideH = 0;
  p.restep = 0;
  p.hindLock = false;
  p.elbowsOut = 0;
  p.swell = 0;
  p.airReach = 0;
  p.sleep = 0;
  p.dead = 0;
  p.stagger = 0;
  p.stateRate = 2;
  p.tailCurl = 0;
  p.tailWave = 0.07;
  p.tailStiff = 1;
  p.eyes = 1;
  return p;
}

// neck / tail rest-shape presets (angles in the chest / tail-base frame); blended per frame
// awake: a short upright S (rises steeply, nape bulging back over the withers, then curls forward
// so the head is held high just ahead of the chest: occiput ~(0, 4.9, 3.1) model)
const NECK_UP = { pitch0: 2.28, pitchStep: -0.6, pitchCurve: 0.03 };
const NECK_STAGGER = { pitch0: 0.55, pitchStep: -0.2, pitchCurve: 0, yaw0: 0, yawStep: 0 };
// asleep: curled back along the right flank, head on the ground beside the right hind foot
const NECK_SLEEP = { pitch0: -0.3, pitchStep: -0.06, pitchCurve: 0, yaw0: -1.0, yawStep: -0.32 };
const NECK_DEAD = { pitch0: 0.15, pitchStep: -0.14, pitchCurve: 0, yaw0: -0.45, yawStep: -0.12 };
const TAIL_DEAD = { pitch0: -0.45, pitchStep: 0.06, yaw0: 0.08, yawStep: 0.02, yawCurve: 0, waveAmp: 0, wavePhase: 0 };
/** Resting tail hook toward model-right (yaw_i += 0.035 i + TAIL_HOOK * i^2: a ~170° C beside the body). */
export const TAIL_HOOK = 0.017;

const mixParams = (a, b, t, out) => {
  for (const k in a) out[k] = a[k] + ((b[k] ?? 0) - a[k]) * t;
  return out;
};

export class Rig {
  constructor(model, dragon) {
    this.m = model;
    this.d = dragon;
    this.neck = new Chain(model.neck, A.neckLen * S, { minY: 0.5 * S, maxBend: 0.62, baseBend: 1.25 });
    const tailMin = [0, ...model.tailRadii.map((r) => (r * 0.8 + 0.05) * S)];
    this.tail = new Chain(model.tail, A.tailLen * S, { minY: tailMin, maxBend: 0.56, baseBend: 0.8 });
    this.gait = new Gait((limb) => dragon.onStep?.(limb), S);
    this.s = {
      pitch: 0, roll: 0, lower: 0, twist: 0, alt: 0, airborne: 0, rear: 0, sleep: 0, dead: 0, stagger: 0,
      jaw: 0, spread: [0, 0], pawW: [0, 0], flapAmp: 0, flapPhase: 0, eyes: 0, tailCurl: 0, tailWave: 0.07,
      lookDown: 0.14, gaitRoll: 0, frontDip: 0,
      droop: 0, mantle: 0, stanceF: 0, stanceH: 0, strideF: 0, strideH: 0, restep: 0, elbowsOut: 0, swell: 0, airReach: 0,
    };
    this.time = 0;
    this.breathPhase = 0;
    this.headPos = V();
    this.lookPos = V();
    this.lastFlapCos = 1;
    this.needsSnap = true;

    // world-space outputs, refreshed every update
    this.pt = {
      head: V(), snout: V(), jawTip: V(), mouth: V(), headFwd: V(0, 0, 1),
      chest: V(), chestC: V(), hips: V(), neckBase: V(),
      eyes: [V(), V()], nostrils: [V(), V()],
      // hind legs
      legs: [0, 1].map(() => ({ hip: V(), knee: V(), ankle: V(), toe: V() })),
      // front legs: shoulder -> elbow -> wrist -> toe (paw contact)
      arms: [0, 1].map(() => ({ shoulder: V(), elbow: V(), wrist: V(), toe: V() })),
      // wings: root on the back -> elbow -> wrist; per finger the knuckle and the tip; mids = knuckles
      wings: [0, 1].map(() => ({ root: V(), elbow: V(), wrist: V(), tips: [V(), V(), V(), V()], knuckles: [V(), V(), V(), V()], mids: [V(), V(), V(), V()], attachH: V() })),
    };

    // scratch
    this._q = Array.from({ length: 10 }, () => new THREE.Quaternion());
    this._v = Array.from({ length: 16 }, () => V());
    this._m = new THREE.Matrix4();
    this._rootInv = new THREE.Matrix4();
    this._qHips = new THREE.Quaternion();
    this._qChest = new THREE.Quaternion();
    this._qChestInv = new THREE.Quaternion();
    this._qNeckBase = new THREE.Quaternion();
    this._qTailBase = new THREE.Quaternion();
    this._qNeckEnd = new THREE.Quaternion();
    this._qHead = new THREE.Quaternion();
    this._fwd = V();
    this._up = V();
    this._left = V();
    this._fwdFlat = V();
    this._leftFlat = V();
    this._pTailBase = V();
    this._memPts = { wrist: null, elbow: null, root: null, hip: null, tips: null, knuckles: null };
    this._key = { wrist: [0, 0, 0], pole: [0, 0, 0], fingers: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], kink: [0, 0, 0, 0], thumb: [0, 0, 0], hipsW: 0 };
    this._np = {};
    this._tp = {};
    this._nb = {};
    this._tb = [{}, {}, {}];
  }

  _wq(obj, out) {
    return out.setFromRotationMatrix(this._m.extractRotation(obj.matrixWorld));
  }
  _wp(obj, out) {
    return out.setFromMatrixPosition(obj.matrixWorld);
  }

  /** Root-frame point (x, y, z) -> world, using only root position + yaw. */
  _rootToWorld(out, x, y, z) {
    const yaw = this.d.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const p = this.d.position;
    return out.set(p.x + x * c + z * s, p.y + y, p.z - x * s + z * c);
  }

  snap() {
    this.needsSnap = true;
  }

  /**
   * Clamp world point `p` (in place, y = 0) into front paw k's planted reach: the spot a straight-ish
   * foreleg can still put the paw on the ground from the current shoulder (wrist 0.42 up).
   */
  clampPaw(k, p) {
    const sh = this.pt.arms[k]?.shoulder;
    if (!sh || !Number.isFinite(sh.x + sh.y + sh.z) || (sh.x === 0 && sh.y === 0 && sh.z === 0)) {
      p.y = 0;
      return p;
    }
    const L = (A.humerus + A.forearm) * S * 0.95, wy = A.wristOff[1] * S;
    const dy = Math.max(0, sh.y - wy);
    const r = Math.sqrt(Math.max(0, L * L - dy * dy));
    const dx = p.x - sh.x, dz = p.z - sh.z, l = Math.hypot(dx, dz);
    if (l > r && l > 1e-6) {
      p.x = sh.x + (dx * r) / l;
      p.z = sh.z + (dz * r) / l;
    }
    p.y = 0;
    return p;
  }

  update(dt, pose) {
    const s = this.s, m = this.m, pt = this.pt;
    const snap = this.needsSnap;
    this.needsSnap = false;
    this.time += dt;
    const sm = (cur, target, rate) => (snap ? target : damp(cur, target, rate, dt));

    // --- smoothed state
    s.sleep = sm(s.sleep, pose.sleep, pose.stateRate);
    s.dead = sm(s.dead, pose.dead, pose.stateRate);
    s.stagger = sm(s.stagger, pose.stagger, 4);
    s.pitch = sm(s.pitch, pose.pitch, pose.bodyRate);
    s.roll = sm(s.roll, pose.roll, pose.bodyRate);
    s.lower = sm(s.lower, pose.lower, pose.bodyRate);
    s.twist = sm(s.twist, pose.twist, pose.bodyRate);
    const alt0 = s.alt;
    s.alt = sm(s.alt, pose.alt, 12);
    // the head goal is smoothed in world space: carry it with the body's climb / drop (leap) so the
    // neck doesn't stretch up behind a landing body
    this._dAlt = snap ? 0 : s.alt - alt0;
    s.airborne = sm(s.airborne, pose.airborne, 6);
    s.rear = sm(s.rear, pose.rear, pose.bodyRate);
    s.jaw = sm(s.jaw, pose.jaw, pose.jawRate);
    s.eyes = sm(s.eyes, pose.eyes, 3);
    s.tailCurl = sm(s.tailCurl, pose.tailCurl, 4);
    s.tailWave = sm(s.tailWave, pose.tailWave, 2);
    s.lookDown = sm(s.lookDown, pose.lookDown, 6);
    for (let k = 0; k < 2; k++) {
      s.spread[k] = sm(s.spread[k], pose.spread[k], pose.spreadRate);
      s.pawW[k] = sm(s.pawW[k], pose.pawOv[k].w, pose.pawOvRate);
      // a paw that lands (rake end, slam) becomes a ground contact at once (within the leg's reach);
      // the gait steps it home
      if (pose.pawPlant[k]) {
        this.gait.plantAt(2 + k, this.clampPaw(k, pose.pawOv[k].pos));
        s.pawW[k] = 0;
      }
    }
    s.droop = sm(s.droop, pose.droop, 3);
    s.mantle = sm(s.mantle, pose.mantle, 3);
    s.stanceF = sm(s.stanceF, pose.stanceF, 5);
    s.stanceH = sm(s.stanceH, pose.stanceH, 5);
    s.strideF = sm(s.strideF, pose.strideF, 5);
    s.strideH = sm(s.strideH, pose.strideH, 5);
    s.restep = sm(s.restep, pose.restep, 6);
    s.elbowsOut = sm(s.elbowsOut, pose.elbowsOut, 5);
    s.swell = sm(s.swell, pose.swell, 3);
    s.airReach = sm(s.airReach, pose.airReach, 5);
    s.flapAmp = sm(s.flapAmp, pose.flap, 5);
    if (s.flapAmp > 0.02) {
      s.flapPhase += dt * pose.flapHz * TAU;
      const c = Math.cos(s.flapPhase);
      // top of the stroke: downbeat starts (the small roar shudder is not a wing beat)
      if (this.lastFlapCos > 0 && c <= 0 && s.flapAmp > 0.25) this.d.onFlap?.(s.flapAmp);
      this.lastFlapCos = c;
    } else {
      // ease the phase back toward neutral so the next flap starts with a downbeat
      s.flapPhase = s.flapPhase % TAU;
      this.lastFlapCos = Math.cos(s.flapPhase);
    }
    const lying = Math.max(s.sleep, s.dead);

    // --- breathing (slow when asleep)
    this.breathPhase += (dt * TAU) / lerp(2.6, 4.6, s.sleep);
    const br = Math.sin(this.breathPhase);
    m.torso.scale.set(1 + br * 0.025, 1 + br * 0.03, 1);
    m.chestMesh.scale.set(1 + br * 0.03 + s.swell * 0.03, 1 + br * 0.04 + s.swell * 0.06, 1 + br * 0.01 + s.swell * 0.02);

    // --- body: hips dip while a hind foot swings, withers dip while a front foot swings, a little
    // roll toward the planted side (the gait limbs: 0 footL, 1 footR, 2 handL, 3 handR)
    const G = this.gait.limbs;
    const grounded = 1 - s.airborne;
    const hindLift = Math.max(G[0].lift, G[1].lift) * grounded;
    const frontLift = Math.max(G[2].lift, G[3].lift) * grounded;
    s.gaitRoll = sm(s.gaitRoll, 0.04 * (G[0].lift + G[2].lift - G[1].lift - G[3].lift) * grounded * (1 - lying), 8);
    s.frontDip = sm(s.frontDip, frontLift, 10);
    let lower = Math.min(1.6, s.lower + s.sleep * 1.15 + s.dead * 1.2 * (1 - s.sleep));
    // planted forefeet can't follow the shoulders up: a nose-up pitch / rise beyond the forelegs'
    // reach (shoulders > 0.1 above standing) sits the body back onto its haunches instead
    // (shoulder joint = hips frame (+-1, 0.35, 3.3) pitched about the hips)
    {
      const p = s.pitch + s.sleep * 0.08;
      const shY = -lower + (A.chest[1] + A.shoulder[1]) * Math.cos(p) - (A.chest[2] + A.shoulder[2]) * Math.sin(p);
      const over = shY - (A.chest[1] + A.shoulder[1] + 0.1);
      if (over > 0) lower += over * (1 - s.rear) * (1 - s.airborne) * (1 - lying);
    }
    const bob = -0.07 * hindLift + br * 0.03;
    m.hips.position.set(0, A.hipY - lower + bob + s.alt / S, A.hipZ);
    m.hips.rotation.set(s.pitch + s.sleep * 0.08, s.twist * 0.3, s.roll + s.gaitRoll + s.dead * 0.75);
    m.chest.rotation.set(-br * 0.02 + s.stagger * 0.12 + s.frontDip * 0.022, s.twist * 0.7, 0);
    m.root.updateMatrixWorld(true);

    const qHips = this._wq(m.hips, this._qHips);
    const qChest = this._wq(m.chest, this._qChest);
    this._qChestInv.copy(qChest).invert();
    const qNeckBase = this._wq(m.neckBase, this._qNeckBase);
    const qTailBase = this._wq(m.tailBase, this._qTailBase);
    this._wp(m.neckBase, pt.neckBase);
    this._wp(m.tailBase, this._pTailBase);
    this._wp(m.chest, pt.chest);
    // centre of the deep chest (lower and a little ahead of the ribcage joint): hurt sphere, aim point
    pt.chestC.set(0, -0.3, 0.3).applyMatrix4(m.chest.matrixWorld);
    this._wp(m.hips, pt.hips);
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(qHips);
    const up = this._up.set(0, 1, 0).applyQuaternion(qHips);
    const left = this._left.set(1, 0, 0).applyQuaternion(qHips);
    const fwdFlat = this._fwdFlat.set(Math.sin(this.d.yaw), 0, Math.cos(this.d.yaw));
    this._leftFlat.set(fwdFlat.z, 0, -fwdFlat.x);

    this._updateNeck(dt, pose, snap, qChest, qNeckBase);
    this._updateTail(dt, snap, qTailBase, pose.tailStiff);
    this._updateLegs(dt, pose, snap, lying, fwd, up, left, fwdFlat);
    this._updateWings(dt, lying, qChest, fwdFlat, up);

    m.root.updateMatrixWorld(true);
    this._wp(m.mouth, pt.mouth);
    this._wp(m.eyes[0], pt.eyes[0]);
    this._wp(m.eyes[1], pt.eyes[1]);
    this._wp(m.nostrils[0], pt.nostrils[0]);
    this._wp(m.nostrils[1], pt.nostrils[1]);
    this._wp(m.head, pt.head);
    pt.headFwd.set(0, 0, 1).applyQuaternion(this._wq(m.head, this._q[0]));
    pt.snout.copy(pt.head).addScaledVector(pt.headFwd, 1.05 * S);
    const qJaw = this._wq(m.jaw, this._q[1]);
    this._wp(m.jaw, pt.jawTip).addScaledVector(this._v[0].set(0, 0, 1).applyQuaternion(qJaw), 1.15 * S);

    // membranes (local to the root)
    this._rootInv.copy(m.root.matrixWorld).invert();
    for (let k = 0; k < 2; k++) {
      const w = m.wings[k], wp = pt.wings[k];
      this._wp(w.hipAttach, wp.attachH);
      const mp = this._memPts;
      mp.wrist = wp.wrist;
      mp.elbow = wp.elbow;
      mp.root = wp.root;
      mp.hip = wp.attachH;
      mp.tips = wp.tips;
      mp.knuckles = wp.knuckles;
      w.membrane.update(mp, this._rootInv);
    }
  }

  _updateNeck(dt, pose, snap, qChest, qNeckBase) {
    const s = this.s, m = this.m, pt = this.pt, neck = this.neck;
    // look target (smoothed)
    if (snap) this.lookPos.copy(pose.look);
    else this.lookPos.lerp(pose.look, 1 - Math.exp(-pose.lookRate * dt));
    // distribute the look yaw along the neck so it curves toward the target
    const toLook = this._v[0].subVectors(this.lookPos, pt.neckBase).applyQuaternion(this._qChestInv);
    const awakeW = (1 - s.sleep) * (1 - s.dead);
    // a target right under / behind the chest (the hero beneath the belly, a leap landing on him)
    // cannot be looked at: the neck and head stay forward, the head tipped down (no craning back)
    const under = (1 - clamp((Math.hypot(toLook.x, toLook.z) - 2.5 * S) / (2 * S), 0, 1)) * (1 - clamp(toLook.z / (1.5 * S), 0, 1));
    const lookYaw = clamp(Math.atan2(toLook.x, toLook.z), -1.3, 1.3) * awakeW * (1 - s.stagger * 0.7) * (1 - under);
    const n = neck.n;
    const base = this._nb;
    base.pitch0 = NECK_UP.pitch0;
    base.pitchStep = NECK_UP.pitchStep;
    base.pitchCurve = NECK_UP.pitchCurve;
    base.yaw0 = lookYaw * 0.1;
    base.yawStep = (lookYaw * 0.85) / n;
    const p = mixParams(base, NECK_STAGGER, s.stagger, this._np);
    mixParams(p, NECK_SLEEP, s.sleep, p);
    mixParams(p, NECK_DEAD, s.dead, p);
    neck.buildRest(pt.neckBase, qChest, p);
    if (snap) neck.snap();
    else neck.pull(1 - Math.exp(-7 * dt));

    // head goal: explicit target or the rest end, plus offsets; smoothed
    const goal = this._v[1].copy(pose.head ?? neck.rest[n]).add(pose.headOffset);
    if (goal.y < 0.55 * S) goal.y = 0.55 * S;
    if (!Number.isFinite(goal.x + goal.y + goal.z)) goal.copy(neck.rest[n]);
    if (snap) this.headPos.copy(goal);
    else {
      this.headPos.y += this._dAlt || 0;
      this.headPos.lerp(goal, 1 - Math.exp(-pose.headRate * dt));
    }
    neck.solve(this.headPos, 3);
    neck.apply(qNeckBase, this._qNeckEnd);

    // head aims at the look point, held near level (at most lookDown nose-down) so the brow and
    // the lit maw face forward; limp / flat when lying or staggered
    const last = neck.dirs[n - 1];
    const dir = this._v[2].subVectors(this.lookPos, neck.p[n]);
    if (dir.lengthSq() < 1e-6) dir.copy(last);
    dir.normalize();
    if (under > 0.001) {
      // forward (chest frame) and down instead of craning back toward a target under the body
      const fw = this._v[3].set(0, -0.35, 1).normalize().applyQuaternion(qChest);
      dir.lerp(fw, under).normalize();
    }
    const h = Math.hypot(dir.x, dir.z);
    if (h > 1e-4) {
      const pitch = clamp(Math.atan2(dir.y, h), -s.lookDown, 0.6) - 0.05 * awakeW; // a few degrees nose-down at rest
      const cp = Math.cos(pitch) / h;
      dir.set(dir.x * cp, Math.sin(pitch), dir.z * cp);
    }
    const limp = Math.max(s.sleep, s.dead, s.stagger * 0.6);
    if (limp > 0.001) {
      const flat = this._v[3].set(last.x, Math.min(last.y, 0) * 0.3 - 0.12 * s.stagger, last.z);
      if (flat.lengthSq() < 1e-6) flat.copy(last);
      flat.normalize();
      dir.lerp(flat, limp).normalize();
    }
    constrainDir(dir, last, 1.1);
    aimJoint(m.head, dir, this._qNeckEnd, this._qHead);
    m.jaw.rotation.x = s.jaw * 0.7;
  }

  _updateTail(dt, snap, qTailBase, stiff = 1) {
    const s = this.s, tail = this.tail;
    const set = (o, pitch0, pitchStep, yaw0, yawStep, yawCurve, waveAmp, wavePhase) => {
      o.pitch0 = pitch0;
      o.pitchStep = pitchStep;
      o.yaw0 = yaw0;
      o.yawStep = yawStep;
      o.yawCurve = yawCurve;
      o.waveAmp = waveAmp;
      o.wavePhase = wavePhase;
      return o;
    };
    // standing: leaves the rump ~20° down, lies on the ground from ~40 %, hooks to model-right;
    // a big tailCurl (tail sweep) straightens the hook
    const hook = TAIL_HOOK * clamp(1 - Math.abs(s.tailCurl) * 8, 0, 1);
    const base = set(this._tb[0], -0.8, 0.07, 0, s.tailCurl + 0.035 * hook / TAIL_HOOK, hook, s.tailWave, this.time * 1.4);
    const air = set(this._tb[1], -0.6, -0.005, 0, s.tailCurl * 0.5, 0.002, 0.04, this.time * 2.0);
    // asleep: curls around toward the head (model-right, where the neck lies)
    const sleep = set(this._tb[2], -0.5, 0.06, 0.25, 0.14, 0.006, 0.02, this.time * 0.6);
    const p = mixParams(base, air, s.airborne, this._tp);
    mixParams(p, sleep, s.sleep, p);
    mixParams(p, TAIL_DEAD, s.dead, p);
    tail.buildRest(this._pTailBase, qTailBase, p);
    if (snap) tail.snap();
    else {
      this._stiff = damp(this._stiff ?? 1, stiff, 6, dt);
      tail.spring(Math.min(dt, 1 / 30), 70 * this._stiff, 10 * this._stiff * this._stiff, 0.5);
    }
    tail.apply(qTailBase, this._q[2]);
  }

  /** Hind legs + forelegs: homes, gait, 2-bone IK. */
  _updateLegs(dt, pose, snap, lying, fwd, up, left, fwdFlat) {
    const s = this.s, m = this.m, pt = this.pt, gait = this.gait;
    const v = this._v;
    // s of velocity lead on the homes: a walking foot lands ~half a stride ahead, so the stride centres
    // on the home; fast gaits (trot, charge bound) lead less or the feet would reach far ahead
    const lead = clamp(0.6 - Math.max(0, pose.speed - 4.5) * 0.05, 0.12, 0.6);
    // homes (root frame -> world, with a velocity lead)
    const awake = 1 - lying;
    for (let k = 0; k < 2; k++) {
      const side = m.legs[k].side;
      const l = gait.limbs[k];
      this._rootToWorld(l.home, side * (lerp(A.footHome[0], 1.5, lying) + s.stanceH * awake) * S, 0, (lerp(A.footHome[2], -0.95, lying) + s.strideH * awake) * S);
      l.home.addScaledVector(pose.vel, lead);
      l.home.y = 0;
      l.free = s.airborne > 0.3;
      l.lock = !!pose.hindLock && !l.free;
    }
    for (let k = 0; k < 2; k++) {
      const side = m.arms[k].side;
      const l = gait.limbs[2 + k];
      this._rootToWorld(l.home, side * (lerp(A.handHome[0], 1.35, lying) + s.stanceF * awake) * S, 0, (lerp(A.handHome[2], 3.15, lying) + s.strideF * awake) * S);
      l.home.addScaledVector(pose.vel, lead);
      l.home.y = 0;
      l.free = s.airborne > 0.3 || s.rear > 0.35 || s.pawW[k] > 0.35;
      l.lock = false;
    }
    gait.stepScale = 1 - 0.65 * s.restep;
    if (snap) gait.snap();
    else gait.update(dt, pose.speed);

    const qa = this._q[3], qb = this._q[4], qc = this._q[5], qd = this._q[6];
    // --- hind legs (digitigrade: the hock sits above / behind the toe)
    const ankleOff = v[4].set(0, lerp(A.ankleOff[1], 0.22, lying) * S, lerp(A.ankleOff[2], -0.72, lying) * S);
    for (let k = 0; k < 2; k++) {
      const leg = m.legs[k], side = leg.side, out = pt.legs[k];
      const limb = gait.limbs[k];
      this._wp(leg.hip, out.hip);
      const toeT = v[5].copy(limb.pos);
      if (s.airborne > 0.001) {
        // trail back, extended; the dive reaches them down and forward, claws spread, for the landing
        const tuck = v[6].set(side * lerp(1.0, 1.2, s.airReach), lerp(-1.6, -2.55, s.airReach), lerp(-1.9, 0.1, s.airReach)).applyMatrix4(m.hips.matrixWorld);
        toeT.lerp(tuck, s.airborne);
      }
      if (s.dead > 0.001 && side > 0) {
        // death (rolled onto the right side): the upper hind leg stiffens out, straight, down-back
        const stiff = v[6].set(2.85, -1.95, -1.45).applyMatrix4(m.hips.matrixWorld);
        toeT.lerp(stiff, s.dead);
      }
      const ankleT = v[7].copy(toeT);
      ankleT.x += ankleOff.z * fwdFlat.x;
      ankleT.z += ankleOff.z * fwdFlat.z;
      ankleT.y += ankleOff.y;
      // knee forward and a little out
      const pole = v[8].copy(fwd).addScaledVector(left, side * 0.35).addScaledVector(up, 0.15);
      solveTwoBone(out.hip, ankleT, A.thigh * S, A.shin * S, pole, out.knee, out.ankle);
      this._wq(leg.hip, qa);
      aimJoint(leg.thigh, v[9].subVectors(out.knee, out.hip), qa, qb);
      aimJoint(leg.shin, v[9].subVectors(out.ankle, out.knee), qb, qc);
      const md = v[9].subVectors(toeT, out.ankle);
      if (md.lengthSq() < 1e-6) md.set(0, -1, 0);
      md.normalize();
      out.toe.copy(out.ankle).addScaledVector(md, A.meta * S);
      aimJoint(leg.meta, md, qc, qd);
      const toeDir = v[10].copy(fwdFlat).addScaledVector(up, -0.15 - s.airborne * 0.8).normalize();
      aimJointUp(leg.toe, toeDir, up, qd, qa); // no roll: the toes splay flat on the ground
    }

    // --- forelegs (columnar, elbow back; wrist 0.4 off the ground, toes flat and splayed)
    const wristOff = v[11].set(0, lerp(A.wristOff[1], 0.22, lying) * S, lerp(A.wristOff[2], -0.45, lying) * S);
    for (let k = 0; k < 2; k++) {
      const arm = m.arms[k], side = arm.side, out = pt.arms[k];
      const limb = gait.limbs[2 + k];
      this._wp(arm.shoulder, out.shoulder);
      const toeT = v[5].copy(limb.pos);
      let freeW = 0;
      if (s.rear > 0.001) {
        // reared up: paws held high in front of the chest, claws spread
        const lift = v[6].set(side * 1.15, -1.25, 1.35).applyMatrix4(m.chest.matrixWorld);
        toeT.lerp(lift, s.rear);
        freeW = Math.max(freeW, s.rear);
      }
      if (s.airborne > 0.001) {
        // folded under the chest, paws back; the dive reaches them down and forward for the landing
        const tuck = v[6].set(side * lerp(0.9, 1.2, s.airReach), lerp(-1.55, -2.6, s.airReach), lerp(0.2, 1.0, s.airReach)).applyMatrix4(m.chest.matrixWorld);
        toeT.lerp(tuck, s.airborne);
        freeW = Math.max(freeW, s.airborne);
      }
      if (s.dead > 0.001 && side > 0) {
        // death: the upper foreleg stiffens out, straight, down-forward (the lower one stays pinned)
        const stiff = v[6].set(2.55, -2.05, 1.85).applyMatrix4(m.chest.matrixWorld);
        toeT.lerp(stiff, s.dead);
        freeW = Math.max(freeW, s.dead);
      }
      if (s.pawW[k] > 0.001) {
        toeT.lerp(pose.pawOv[k].pos, s.pawW[k]);
        freeW = Math.max(freeW, s.pawW[k]);
      }
      if (toeT.y < 0) toeT.y = 0;
      const wristT = v[7].copy(toeT);
      wristT.x += wristOff.z * fwdFlat.x * (1 - freeW);
      wristT.z += wristOff.z * fwdFlat.z * (1 - freeW);
      // a free paw hangs a hand's length under the wrist so the toe lands ON its target (a paw held on
      // the ground by an override no longer sinks 0.2 into it)
      wristT.y += lerp(wristOff.y, A.hand * S, freeW);
      // elbow back (the reverse of the hind knee), out a little; further out on a rake
      // braced / buckled forelegs bow their elbows outward (elbowsOut)
      const pole = v[8].copy(fwd).multiplyScalar(-1 + s.elbowsOut * 0.6).addScaledVector(left, side * (0.2 + freeW * 0.6 + s.elbowsOut * 1.6)).addScaledVector(up, -0.1);
      solveTwoBone(out.shoulder, wristT, A.humerus * S, A.forearm * S, pole, out.elbow, out.wrist);
      this._wq(arm.shoulder, qa);
      aimJoint(arm.humerus, v[9].subVectors(out.elbow, out.shoulder), qa, qb);
      aimJoint(arm.forearm, v[9].subVectors(out.wrist, out.elbow), qb, qc);
      const hd = v[9].subVectors(toeT, out.wrist);
      if (hd.lengthSq() < 1e-6) hd.set(0, -1, 0);
      hd.normalize();
      out.toe.copy(out.wrist).addScaledVector(hd, A.hand * S);
      aimJoint(arm.hand, hd, qc, qd);
      // paw: flat on the ground and forward; a lifted paw curls with the hand (claws forward-down)
      const pawDir = v[10].copy(fwdFlat).addScaledVector(up, -0.1).normalize();
      if (freeW > 0.001) pawDir.lerp(v[12].copy(fwdFlat).addScaledVector(hd, 0.8).normalize(), freeW).normalize();
      aimJointUp(arm.paw, pawDir, up, qd, qa);
    }
  }

  /** Blend the wing keys for `spread` (0 FOLD, 0.5 HALF, 1 SPREAD), `mantle`, `droop` and `lying` into this._key. */
  _wingKey(spread, lying, droop = 0, mantle = 0) {
    const K = this._key;
    const sp = clamp(spread, 0, 1);
    const a = sp < 0.5 ? WING_KEYS.FOLD : WING_KEYS.HALF;
    const b = sp < 0.5 ? WING_KEYS.HALF : WING_KEYS.SPREAD;
    const f = sp < 0.5 ? sp * 2 : sp * 2 - 1;
    const L = WING_KEYS.FOLD_LYING;
    // lying flattens the folded wing; a spread wing (death splay) keeps most of its shape
    const ly = lying * (1 - sp * 0.6);
    const mix3 = (out, x, y) => {
      for (let i = 0; i < 3; i++) out[i] = x[i] + (y[i] - x[i]) * f;
      return out;
    };
    const toL = (out, l) => {
      for (let i = 0; i < 3; i++) out[i] += (l[i] - out[i]) * ly;
      return out;
    };
    toL(mix3(K.wrist, a.wrist, b.wrist), L.wrist);
    toL(mix3(K.pole, a.pole, b.pole), L.pole);
    toL(mix3(K.thumb, a.thumb, b.thumb), L.thumb);
    for (let k = 0; k < 4; k++) {
      toL(mix3(K.fingers[k], a.fingers[k], b.fingers[k]), L.fingers[k]);
      K.kink[k] = a.kink[k] + (b.kink[k] - a.kink[k]) * f;
      K.kink[k] += (L.kink[k] - K.kink[k]) * ly;
    }
    // breath display: toward MANTLE (wrists high, fingers fanned down); stunned: sag toward DROOP
    const mw = clamp(mantle, 0, 1) * clamp(sp * 2 - 1, 0, 1) * (1 - lying);
    this._toKey(K, WING_KEYS.MANTLE, mw);
    K.hipsW = WING_KEYS.MANTLE.hipsWrist ? mw : 0; // share of the wrist target held in the hips frame
    this._toKey(K, WING_KEYS.DROOP, clamp(droop, 0, 1) * (1 - lying));
    return K;
  }

  /** Blend the working wing key K toward key D by weight w (in place). */
  _toKey(K, D, w) {
    if (!(w > 0.001)) return;
    for (let i = 0; i < 3; i++) {
      K.wrist[i] += (D.wrist[i] - K.wrist[i]) * w;
      K.pole[i] += (D.pole[i] - K.pole[i]) * w;
      K.thumb[i] += (D.thumb[i] - K.thumb[i]) * w;
    }
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 3; i++) K.fingers[k][i] += (D.fingers[k][i] - K.fingers[k][i]) * w;
      K.kink[k] += (D.kink[k] - K.kink[k]) * w;
    }
  }

  /** Wings: arm IK to the keyed wrist (+ flap about the root), two-joint fingers, thumb. */
  _updateWings(dt, lying, qChest, fwdFlat, up) {
    const s = this.s, m = this.m, pt = this.pt;
    const v = this._v;
    const qa = this._q[3], qb = this._q[4], qc = this._q[5], qd = this._q[6], qe = this._q[7];
    const theta = s.flapAmp * Math.sin(s.flapPhase);
    const CW = m.chest.matrixWorld;
    for (let k = 0; k < 2; k++) {
      const w = m.wings[k], side = w.side, out = pt.wings[k];
      const K = this._wingKey(s.spread[k], lying, s.droop, s.mantle);
      // wing beats: the fingers fold ~30 % on the upstroke (theta rising) and fan out on the downstroke
      if (s.flapAmp > 0.25) {
        const up = Math.max(0, Math.cos(s.flapPhase)) * 0.3;
        const F = WING_KEYS.FOLD.fingers;
        for (let f = 0; f < 4; f++) for (let i = 0; i < 3; i++) K.fingers[f][i] += (F[f][i] - K.fingers[f][i]) * up;
      }
      this._wp(w.root, out.root);
      // wrist target in the chest frame, rotated about the root's forward axis by the flap angle
      const rx = side * A.wingRoot[0], ry = A.wingRoot[1], rz = A.wingRoot[2];
      const ox = side * K.wrist[0] - rx, oy = K.wrist[1] - ry;
      const phi = side * theta;
      const c = Math.cos(phi), sn = Math.sin(phi);
      const wx = rx + ox * c - oy * sn, wy = ry + ox * sn + oy * c;
      const wristT = v[5].set(wx, wy, K.wrist[2]).applyMatrix4(CW);
      if (K.hipsW > 0.001) {
        // the same chest-frame point taken from the hips (the standing chest offset A.chest): the
        // wrists stay high while the chest crouches / pitches forward (breath MANTLE)
        const wh = v[13].set(wx + A.chest[0], wy + A.chest[1], K.wrist[2] + A.chest[2]).applyMatrix4(m.hips.matrixWorld);
        wristT.lerp(wh, K.hipsW);
      }
      if (wristT.y < 0.3 * S) wristT.y = 0.3 * S;
      const pole = v[6].set(side * K.pole[0], K.pole[1], K.pole[2]).applyQuaternion(qChest);
      solveTwoBone(out.root, wristT, A.wingHumerus * S, A.wingForearm * S, pole, out.elbow, out.wrist);
      this._wq(w.root, qa);
      aimJoint(w.humerus, v[9].subVectors(out.elbow, out.root), qa, qb);
      aimJoint(w.forearm, v[9].subVectors(out.wrist, out.elbow), qb, qc);
      // fingers: keyed directions (chest frame), flapped with the arm; the distal segment droops
      // toward the trailing edge by the key's kink
      const down = v[10].set(0, -1, 0);
      for (let f = 0; f < 4; f++) {
        const kd = K.fingers[f];
        let dx = side * kd[0], dy = kd[1];
        const cf = Math.cos(phi), sf = Math.sin(phi);
        const tx = dx * cf - dy * sf;
        dy = dx * sf + dy * cf;
        dx = tx;
        const dirW = v[7].set(dx, dy, kd[2]).normalize().applyQuaternion(qChest);
        const len = A.fingers[f] * S, l0 = len * A.knuckle[f], l1 = len - l0;
        // keep finger tips above the ground (crouched / rolled / collapsed body)
        const minDy = (0.15 * S - out.wrist.y) / len;
        if (dirW.y < minDy) {
          dirW.y = Math.min(minDy, 0.95);
          dirW.normalize();
        }
        aimJoint(w.fingers[f], dirW, qc, qd);
        out.knuckles[f].copy(out.wrist).addScaledVector(dirW, l0);
        // distal: rotate toward world-down (in the finger's plane) by the kink
        const perp = v[8].copy(down).addScaledVector(dirW, -down.dot(dirW));
        const pl = perp.length();
        const dist = v[9];
        if (pl > 1e-3) {
          perp.multiplyScalar(1 / pl);
          const kk = -K.kink[f];
          dist.copy(dirW).multiplyScalar(Math.cos(kk)).addScaledVector(perp, Math.sin(kk));
        } else dist.copy(dirW);
        const minD = (0.12 * S - out.knuckles[f].y) / Math.max(1e-3, l1);
        if (dist.y < minD) {
          dist.y = Math.min(minD, 0.95);
          dist.normalize();
        }
        aimJoint(w.distal[f], dist, qd, qe);
        out.tips[f].copy(out.knuckles[f]).addScaledVector(dist, l1);
        out.mids[f].copy(out.knuckles[f]);
      }
      // thumb hook (chest frame direction), rolled so its -Y curve hooks the tip down in front
      const td = v[11].set(side * K.thumb[0], K.thumb[1], K.thumb[2]).applyQuaternion(qChest);
      aimJointUp(w.thumb, td, v[12].set(0, 1, 0).applyQuaternion(qChest), qc, qd);
    }
  }
}
