import * as THREE from 'three';

// Foot planting for the four ground contacts of the drake: two hind feet and two front paws.
// A contact stays planted until its home (root-relative rest spot + velocity lead) drifts beyond a
// stride threshold, then steps. Gaits by ground speed (docs/art/dragon.md §4):
//   walk  (<= 5 m/s, and turning in place): 4-beat lateral sequence LH -> LF -> RH -> RF, one foot in
//         the air at a time (three always down)
//   trot  (5-8 m/s): diagonal pairs {LH, RF} / {RH, LF}
//   bound (> 8 m/s, the charge): hind pair, then the front pair a beat later
// `scale` = body size (tuning SCALE): stride thresholds and step heights grow with the body.

const LH = 0, RH = 1, LF = 2, RF = 3;
const WALK = [LH, LF, RH, RF];
const TROT = [
  [LH, RF],
  [RH, LF],
];
const BOUND = [
  [LH, RH],
  [LF, RF],
];

function makeLimb(name, side, hind) {
  return {
    name,
    side,
    hind,
    home: new THREE.Vector3(),
    plant: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    pos: new THREE.Vector3(), // current contact point (lifted while stepping)
    t: 0,
    dur: 0.4,
    height: 0.5,
    stepping: false,
    free: false, // not using the ground (raised paw, rear-up, airborne...)
    lock: false, // planted and pushing: never starts a step (bite / charge-skid push-off)
    lift: 0, // 0..1 arc progress, for body bob
  };
}

export class Gait {
  constructor(onStep, scale = 1) {
    this.onStep = onStep;
    this.scale = scale;
    // order matters: Rig reads limbs[0..1] as the hind feet, limbs[2..3] as the front paws
    this.limbs = [makeLimb('footL', 1, true), makeLimb('footR', -1, true), makeLimb('handL', 1, false), makeLimb('handR', -1, false)];
    this.seq = 0; // next limb in the 4-beat walk sequence
    this.mode = 'walk';
    this.stepScale = 1; // x the stride threshold (< 1: feet re-plant at homes that moved a little)
  }

  /** Plant contact `i` at `pos` now (a rake / slam that ends on the ground); it steps home later. */
  plantAt(i, pos) {
    const l = this.limbs[i];
    if (!l || !Number.isFinite(pos.x + pos.z)) return;
    l.plant.set(pos.x, 0, pos.z);
    l.pos.copy(l.plant);
    l.stepping = false;
    l.t = 0;
    l.lift = 0;
  }

  /** Plant every contact at its current home. */
  snap() {
    for (const l of this.limbs) {
      l.plant.copy(l.home);
      l.pos.copy(l.home);
      l.stepping = false;
      l.t = 0;
      l.lift = 0;
    }
  }

  _disp(l) {
    return Math.hypot(l.plant.x - l.home.x, l.plant.z - l.home.z);
  }

  _start(l, dur, speed) {
    l.stepping = true;
    l.t = 0;
    l.dur = dur;
    l.height = (l.hind ? 0.3 : 0.35) * Math.min(1.4, 0.8 + speed * 0.05) * this.scale;
    l.from.copy(l.plant);
  }

  update(dt, speed) {
    const limbs = this.limbs;
    const sc = this.scale;
    const threshold = (0.45 + Math.min(speed, 20) * 0.06) * sc * Math.max(0.2, this.stepScale);
    const mode = (this.mode = speed > 8 ? 'bound' : speed > 5 ? 'trot' : 'walk');

    // free contacts follow their home (re-plant there when they come back down)
    for (const l of limbs) {
      if (l.free) {
        l.plant.copy(l.home);
        l.pos.copy(l.home);
        l.stepping = false;
        l.lift = 0;
      }
    }

    if (mode === 'walk') {
      // one foot at a time, in the lateral sequence, each swinging ~25 % of the cycle (three feet
      // always down): cycle ~1.6 s at 3 m/s (stride ~2.6 model units: the forelegs' reach), ~1.35 s
      // at 4.1 m/s.
      // Re-stancing in place (an attack moved the homes: stepScale < 1, root barely moving): quick
      // overlapping steps (the next foot lifts once the last is past mid-swing) so all four re-plant
      // within ~0.7 s, inside the shortest windup, and the stance ends symmetric
      const quick = this.stepScale < 0.8 && speed < 1.5;
      const dur = quick ? 0.26 : Math.min(0.5, Math.max(0.28, 0.4 + (3 - speed) * 0.055));
      let busy = false;
      for (const l of limbs) if (l.stepping && l.t < (quick ? 0.55 : 0.97)) busy = true;
      if (!busy) {
        for (let n = 0; n < 4; n++) {
          const i = WALK[(this.seq + n) % 4];
          const l = limbs[i];
          if (l.free || l.stepping || l.lock) continue;
          // the sequenced foot steps when it drifted past the threshold; a later one only if it is
          // far behind (a sharp turn), so the order holds while walking
          if (this._disp(l) > threshold * (n === 0 || quick ? 1 : 1.7)) {
            this._start(l, dur, speed);
            this.seq = (WALK.indexOf(i) + 1) % 4;
            break;
          }
        }
      }
    } else {
      const groups = mode === 'trot' ? TROT : BOUND;
      const dur = mode === 'trot' ? 0.34 : 0.27;
      const overlap = mode === 'trot' ? 0.5 : 0.3; // the next group lifts mid-stride
      let busy = false;
      for (const l of limbs) if (l.stepping && l.t < overlap) busy = true;
      let best = -1, bestDisp = threshold;
      for (let g = 0; g < groups.length && !busy; g++) {
        for (const i of groups[g]) {
          const l = limbs[i];
          if (l.free || l.stepping || l.lock) continue;
          const disp = this._disp(l);
          if (disp > bestDisp) {
            bestDisp = disp;
            best = g;
          }
        }
      }
      if (best >= 0) {
        for (const i of groups[best]) {
          const l = limbs[i];
          if (l.free || l.stepping || l.lock || this._disp(l) < 0.15 * sc) continue;
          this._start(l, dur, speed);
        }
      }
    }

    for (const l of limbs) {
      if (l.free) continue;
      if (!l.stepping) {
        l.pos.copy(l.plant);
        l.lift = 0;
        continue;
      }
      l.t += dt / Math.max(0.05, l.dur);
      l.to.copy(l.home); // track the moving home so fast gaits don't lag behind
      const t = Math.min(1, l.t);
      const e = t * t * (3 - 2 * t);
      l.pos.lerpVectors(l.from, l.to, e);
      l.lift = Math.sin(Math.PI * t);
      l.pos.y = l.to.y + l.lift * l.height;
      if (l.t >= 1) {
        l.stepping = false;
        l.plant.copy(l.to);
        l.pos.copy(l.plant);
        l.lift = 0;
        this.onStep?.(l);
      }
    }
  }
}
