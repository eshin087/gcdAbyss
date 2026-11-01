import * as THREE from 'three';
import { damp, lerp, clamp, TAU } from '../../../core/math.js';
import { ANATOMY as A, SCALE as S } from '../tuning.js';
import { Chain, aimJoint, constrainDir } from './chain.js';
import { solveTwoBone } from './ik.js';
import { Gait } from './gait.js';

// Procedural animation. Each frame the AI writes a `pose` (targets); the rig smooths them and
// solves: body (hips/chest) -> neck (FABRIK toward a head goal, head aims at a look goal) ->
// tail (springs, follow-the-leader) -> legs + wing arms (2-bone IK on planted contacts) ->
// wing fingers (fold/spread/flap) -> membranes.
// Units: joint transforms below the root are MODEL units (the root carries scale = SCALE); every
// world-space quantity (IK bone lengths, chain lengths, contact homes, clearances) is x S.

const V = () => new THREE.Vector3();
const nrm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
// finger directions in the hips frame for the LEFT (+X) wing; x mirrors for the right wing
// folded = a cape draped over the flank (fingers back + inward), flatter when lying down
const FOLD = [[-0.35, 0.45, -0.82], [-0.2, 0.3, -0.93], [-0.05, 0.12, -0.99]].map(nrm);
const FOLD_LYING = [[-0.3, 0.22, -0.93], [-0.12, 0.1, -0.99], [0.05, 0.0, -1.0]].map(nrm);
const SPREAD = [[0.5, 0.22, 0.84], [0.92, 0.08, 0.38], [0.75, -0.04, -0.66]].map(nrm);

/** Fresh pose targets. The AI resets these every frame (see resetPose) before editing. */
export function createPose() {
  return {
    head: null, // world Vector3 for the neck end (head joint) or null = rest shape
    headTarget: new THREE.Vector3(),
    headRate: 6,
    headOffset: new THREE.Vector3(), // world offset added to the head goal (flinch, recoil)
    look: new THREE.Vector3(), // world point the head aims at
    lookRate: 7,
    jaw: 0,
    jawRate: 12,
    pitch: 0, // + = nose down
    roll: 0,
    lower: 0, // crouch (m); negative rises
    twist: 0, // chest yaw toward a side
    bodyRate: 5,
    alt: 0, // altitude of the body (airborne)
    airborne: 0, // 0..1 feet tucked
    spread: [0, 0], // per wing (0 = +X/left, 1 = -X/right)
    spreadRate: 4,
    flap: 0, // flap amplitude (rad)
    flapHz: 2,
    wingOv: [
      { w: 0, pos: new THREE.Vector3() },
      { w: 0, pos: new THREE.Vector3() },
    ],
    wingOvRate: 10,
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
  p.jaw = 0;
  p.jawRate = 12;
  p.pitch = 0;
  p.roll = 0;
  p.lower = 0;
  p.twist = 0;
  p.bodyRate = 5;
  p.alt = 0;
  p.airborne = 0;
  p.spread[0] = p.spread[1] = 0;
  p.spreadRate = 4;
  p.flap = 0;
  p.flapHz = 2;
  p.wingOv[0].w = p.wingOv[1].w = 0;
  p.wingOvRate = 10;
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
const NECK_STAGGER = { pitch0: -0.12, pitchStep: -0.07, yaw0: 0, yawStep: 0 };
const NECK_SLEEP = { pitch0: -0.28, pitchStep: 0.045, yaw0: -0.4, yawStep: -0.42 }; // curls to the right
const NECK_DEAD = { pitch0: -0.42, pitchStep: 0.065, yaw0: -0.3, yawStep: -0.14 };
const TAIL_DEAD = { pitch0: -0.62, pitchStep: 0.06, yaw0: 0.1, yawStep: 0.09, waveAmp: 0, wavePhase: 0 };

const mixParams = (a, b, t, out) => {
  for (const k in a) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
};

export class Rig {
  constructor(model, dragon) {
    this.m = model;
    this.d = dragon;
    this.neck = new Chain(model.neck, A.neckLen * S, { minY: 0.5 * S, maxBend: 0.55, baseBend: 1.1 });
    const tailMin = [0, ...model.tailRadii.map((r) => (r * 0.8 + 0.05) * S)];
    this.tail = new Chain(model.tail, A.tailLen * S, { minY: tailMin, maxBend: 0.42, baseBend: 0.8 });
    this.gait = new Gait((limb) => dragon.onStep?.(limb), S);
    this.s = {
      pitch: 0, roll: 0, lower: 0, twist: 0, alt: 0, airborne: 0, sleep: 0, dead: 0, stagger: 0,
      jaw: 0, spread: [0, 0], ovW: [0, 0], flapAmp: 0, flapPhase: 0, eyes: 0, tailCurl: 0, tailWave: 0.07,
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
      chest: V(), hips: V(), neckBase: V(),
      eyes: [V(), V()], nostrils: [V(), V()],
      legs: [0, 1].map(() => ({ hip: V(), knee: V(), ankle: V(), toe: V() })),
      wings: [0, 1].map(() => ({ shoulder: V(), elbow: V(), wrist: V(), tips: [V(), V(), V()], mids: [V(), V(), V()], attachS: V(), attachH: V() })),
    };

    // scratch
    this._q = Array.from({ length: 8 }, () => new THREE.Quaternion());
    this._v = Array.from({ length: 12 }, () => V());
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
    this._memPts = { wrist: null, elbow: null, shoulder: null, hip: null, tips: null };
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
    s.alt = sm(s.alt, pose.alt, 12);
    s.airborne = sm(s.airborne, pose.airborne, 6);
    s.jaw = sm(s.jaw, pose.jaw, pose.jawRate);
    s.eyes = sm(s.eyes, pose.eyes, 3);
    s.tailCurl = sm(s.tailCurl, pose.tailCurl, 4);
    s.tailWave = sm(s.tailWave, pose.tailWave, 2);
    for (let k = 0; k < 2; k++) {
      s.spread[k] = sm(s.spread[k], pose.spread[k], pose.spreadRate);
      s.ovW[k] = sm(s.ovW[k], pose.wingOv[k].w, pose.wingOvRate);
    }
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
    m.torso.scale.set(1 + br * 0.025, 1 + br * 0.035, 1);
    m.chestMesh.scale.set(1 + br * 0.03, 1 + br * 0.04, 1);

    // --- body
    let hindLift = 0;
    for (let k = 0; k < 2; k++) hindLift = Math.max(hindLift, this.gait.limbs[k].lift);
    const lower = Math.min(1.35, s.lower + s.sleep * 1.22 + s.dead * 1.32 * (1 - s.sleep));
    const bob = -0.07 * hindLift * (1 - s.airborne) + br * 0.03;
    m.hips.position.set(0, A.hipY - lower + bob + s.alt / S, A.hipZ);
    m.hips.rotation.set(s.pitch, s.twist * 0.3, s.roll + s.dead * 0.18);
    m.chest.rotation.set(-br * 0.02 + s.stagger * 0.1, s.twist * 0.7, 0);
    m.root.updateMatrixWorld(true);

    const qHips = this._wq(m.hips, this._qHips);
    const qChest = this._wq(m.chest, this._qChest);
    this._qChestInv.copy(qChest).invert();
    const qNeckBase = this._wq(m.neckBase, this._qNeckBase);
    const qTailBase = this._wq(m.tailBase, this._qTailBase);
    this._wp(m.neckBase, pt.neckBase);
    this._wp(m.tailBase, this._pTailBase);
    this._wp(m.chest, pt.chest);
    this._wp(m.hips, pt.hips);
    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(qHips);
    const up = this._up.set(0, 1, 0).applyQuaternion(qHips);
    const left = this._left.set(1, 0, 0).applyQuaternion(qHips);
    const fwdFlat = this._fwdFlat.set(Math.sin(this.d.yaw), 0, Math.cos(this.d.yaw));
    this._leftFlat.set(fwdFlat.z, 0, -fwdFlat.x);

    this._updateNeck(dt, pose, snap, qChest, qNeckBase);
    this._updateTail(dt, snap, qTailBase, pose.tailStiff);
    this._updateLimbs(dt, pose, snap, lying, qHips, fwd, up, left, fwdFlat);

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
      this._wp(w.shoulderAttach, wp.attachS);
      this._wp(w.hipAttach, wp.attachH);
      const mp = this._memPts;
      mp.wrist = wp.wrist;
      mp.elbow = wp.elbow;
      mp.shoulder = wp.attachS;
      mp.hip = wp.attachH;
      mp.tips = wp.tips;
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
    const lookYaw = clamp(Math.atan2(toLook.x, toLook.z), -1.3, 1.3) * awakeW * (1 - s.stagger * 0.7);
    const n = neck.n;
    const base = this._nb;
    base.pitch0 = 0.95;
    base.pitchStep = -0.21;
    base.yaw0 = lookYaw * 0.15;
    base.yawStep = (lookYaw * 0.8) / n;
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
    else this.headPos.lerp(goal, 1 - Math.exp(-pose.headRate * dt));
    neck.solve(this.headPos, 3);
    neck.apply(qNeckBase, this._qNeckEnd);

    // head aims at the look point (limp / flat when lying or staggered)
    const last = neck.dirs[n - 1];
    const dir = this._v[2].subVectors(this.lookPos, neck.p[n]);
    if (dir.lengthSq() < 1e-6) dir.copy(last);
    dir.normalize();
    const limp = Math.max(s.sleep, s.dead, s.stagger * 0.6);
    if (limp > 0.001) {
      const flat = this._v[3].set(last.x, Math.min(last.y, 0) * 0.3 - 0.12 * s.stagger, last.z);
      if (flat.lengthSq() < 1e-6) flat.copy(last);
      flat.normalize();
      dir.lerp(flat, limp).normalize();
    }
    constrainDir(dir, last, 1.0);
    aimJoint(m.head, dir, this._qNeckEnd, this._qHead);
    m.jaw.rotation.x = s.jaw * 0.8;
  }

  _updateTail(dt, snap, qTailBase, stiff = 1) {
    const s = this.s, tail = this.tail;
    const set = (o, pitch0, pitchStep, yaw0, yawStep, waveAmp, wavePhase) => {
      o.pitch0 = pitch0;
      o.pitchStep = pitchStep;
      o.yaw0 = yaw0;
      o.yawStep = yawStep;
      o.waveAmp = waveAmp;
      o.wavePhase = wavePhase;
      return o;
    };
    const base = set(this._tb[0], -0.42, 0.03, 0, s.tailCurl, s.tailWave, this.time * 1.4);
    const air = set(this._tb[1], -0.7, -0.005, 0, s.tailCurl * 0.5, 0.04, this.time * 2.0);
    const sleep = set(this._tb[2], -0.62, 0.06, 0.25, 0.24, 0.02, this.time * 0.6); // curls toward the head
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

  _updateLimbs(dt, pose, snap, lying, qHips, fwd, up, left, fwdFlat) {
    const s = this.s, m = this.m, pt = this.pt, gait = this.gait, d = this.d;
    const v = this._v;
    const lead = 0.22;
    // homes (root frame -> world, with a little velocity lead)
    for (let k = 0; k < 2; k++) {
      const side = m.legs[k].side;
      const l = gait.limbs[k];
      this._rootToWorld(l.home, side * lerp(A.footHome[0], 1.55, lying) * S, 0, lerp(A.footHome[2], -0.2, lying) * S);
      l.home.addScaledVector(pose.vel, lead);
      l.home.y = 0;
      l.free = s.airborne > 0.3;
    }
    for (let k = 0; k < 2; k++) {
      const side = m.wings[k].side;
      const l = gait.limbs[2 + k];
      this._rootToWorld(l.home, side * lerp(A.wristHome[0], 2.35, lying) * S, lerp(A.wristHome[1], 0.25, lying) * S, lerp(A.wristHome[2], 1.7, lying) * S);
      l.home.addScaledVector(pose.vel, lead);
      l.home.y = lerp(A.wristHome[1], 0.25, lying) * S;
      l.free = s.spread[k] > 0.35 || s.ovW[k] > 0.35 || s.airborne > 0.3;
    }
    if (snap) gait.snap();
    else gait.update(dt, pose.speed);

    // --- hind legs
    const qa = this._q[3], qb = this._q[4], qc = this._q[5], qd = this._q[6];
    const ankleOff = v[4].set(0, lerp(0.62, 0.22, lying) * S, lerp(-0.42, -0.72, lying) * S);
    for (let k = 0; k < 2; k++) {
      const leg = m.legs[k], side = leg.side, out = pt.legs[k];
      const limb = gait.limbs[k];
      this._wp(leg.hip, out.hip);
      const toeT = v[5].copy(limb.pos);
      if (s.airborne > 0.001) {
        const tuck = v[6].set(side * 1.0, -1.5, -0.8).applyMatrix4(m.hips.matrixWorld);
        toeT.lerp(tuck, s.airborne);
      }
      // ankle sits above/behind the toe (digitigrade); rotate the offset by yaw
      const ankleT = v[7].copy(toeT);
      ankleT.x += ankleOff.z * fwdFlat.x;
      ankleT.z += ankleOff.z * fwdFlat.z;
      ankleT.y += ankleOff.y;
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
      aimJoint(leg.toe, toeDir, qd, qa);
    }

    // --- wings
    const theta = s.flapAmp * Math.sin(s.flapPhase);
    for (let k = 0; k < 2; k++) {
      const w = m.wings[k], side = w.side, out = pt.wings[k];
      const limb = gait.limbs[2 + k];
      const spread = s.spread[k];
      this._wp(w.shoulder, out.shoulder);
      // spread wrist position in the hips frame, rotated about the shoulder by the flap angle
      const shx = side * A.shoulder[0], shy = A.chest[1] + A.shoulder[1], shz = A.chest[2] + A.shoulder[2];
      // lying (asleep / dead): spread wings rest splayed on the ground instead of held up
      const ox = side * 4.6 - shx, oy = lerp(2.6, 0.4, lying) - shy;
      const phi = side * theta;
      const c = Math.cos(phi), sn = Math.sin(phi);
      const rx = ox * c - oy * sn, ry = ox * sn + oy * c;
      const spreadW = v[5].set(shx + rx, shy + ry, 2.4).applyMatrix4(m.hips.matrixWorld);
      const wristT = v[6].copy(limb.pos).lerp(spreadW, spread);
      if (s.ovW[k] > 0.001) wristT.lerp(pose.wingOv[k].pos, s.ovW[k]);
      if (wristT.y < 0.3 * S) wristT.y = 0.3 * S;
      const poleFold = v[7].copy(left).multiplyScalar(side * 0.6).addScaledVector(up, 0.75).addScaledVector(fwd, -0.35);
      const poleSpread = v[8].copy(up).multiplyScalar(0.35).addScaledVector(fwd, -1.0);
      const pole = poleFold.lerp(poleSpread, Math.max(spread, s.ovW[k] * 0.6));
      solveTwoBone(out.shoulder, wristT, A.humerus * S, A.forearm * S, pole, out.elbow, out.wrist);
      this._wq(w.shoulder, qa);
      aimJoint(w.humerus, v[9].subVectors(out.elbow, out.shoulder), qa, qb);
      aimJoint(w.forearm, v[9].subVectors(out.wrist, out.elbow), qb, qc);
      // fingers: fold <-> spread in the hips frame, flapped with the arm
      const fs = Math.max(spread, s.ovW[k] * 0.55);
      for (let f = 0; f < 3; f++) {
        const fa = FOLD[f], fl = FOLD_LYING[f], b = SPREAD[f];
        const ax = lerp(fa[0], fl[0], lying), ay = lerp(fa[1], fl[1], lying), az = lerp(fa[2], fl[2], lying);
        let dx = side * lerp(ax, b[0], fs), dy = lerp(ay, b[1] - 0.3 * lying, fs);
        const dz = lerp(az, b[2], fs);
        const pf = phi * fs;
        const cf = Math.cos(pf), sf = Math.sin(pf);
        const tx = dx * cf - dy * sf;
        dy = dx * sf + dy * cf;
        dx = tx;
        const dirW = v[10].set(dx, dy, dz).normalize().applyQuaternion(qHips);
        // keep finger tips above the ground (rolled / collapsed body)
        const len = A.fingers[f] * S;
        const minDy = (0.15 * S - out.wrist.y) / len;
        if (dirW.y < minDy) {
          dirW.y = Math.min(minDy, 0.95);
          dirW.normalize();
        }
        aimJoint(w.fingers[f], dirW, qc, qd);
        out.tips[f].copy(out.wrist).addScaledVector(dirW, len);
        out.mids[f].copy(out.wrist).addScaledVector(dirW, len * 0.5);
      }
      const thumbDir = v[11].copy(fwdFlat).multiplyScalar(0.7).addScaledVector(up, -0.7).addScaledVector(left, side * 0.15);
      aimJoint(w.thumb, thumbDir, qc, qd);
    }
  }
}
