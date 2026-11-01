import * as THREE from 'three';

// Foot planting for the four ground contacts (two hind feet, two wing wrists / knuckles).
// Contacts stay planted until their home (root-relative rest spot + velocity lead) drifts
// beyond a stride threshold, then step in diagonal pairs (trot): {footL, wingR} / {footR, wingL}.

const GROUPS = [
  [0, 3],
  [1, 2],
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
    free: false, // not using the ground (spread wing, airborne...)
    lift: 0, // 0..1 arc progress, for body bob
  };
}

export class Gait {
  constructor(onStep) {
    this.onStep = onStep;
    this.limbs = [makeLimb('footL', 1, true), makeLimb('footR', -1, true), makeLimb('wingL', 1, false), makeLimb('wingR', -1, false)];
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

  update(dt, speed) {
    const limbs = this.limbs;
    const threshold = 0.7 + Math.min(speed, 20) * 0.08;
    const dur = Math.min(0.48, Math.max(0.2, 0.48 - speed * 0.022));

    // free contacts follow their home (re-plant there when they come back down)
    for (const l of limbs) {
      if (l.free) {
        l.plant.copy(l.home);
        l.pos.copy(l.home);
        l.stepping = false;
        l.lift = 0;
      }
    }

    // start a diagonal pair when the other pair is (mostly) on the ground
    const overlap = speed > 6 ? 0.5 : 0.98; // fast gaits let the next pair lift mid-stride
    let busy = false;
    for (const l of limbs) if (l.stepping && l.t < overlap) busy = true;
    let best = -1, bestDisp = threshold;
    for (let gi = 0; gi < GROUPS.length && !busy; gi++) {
      for (const i of GROUPS[gi]) {
        const l = limbs[i];
        if (l.free || l.stepping) continue;
        const disp = Math.hypot(l.plant.x - l.home.x, l.plant.z - l.home.z);
        if (disp > bestDisp) {
          bestDisp = disp;
          best = gi;
        }
      }
    }
    if (best >= 0) {
      for (const i of GROUPS[best]) {
        const l = limbs[i];
        if (l.free || l.stepping) continue;
        const disp = Math.hypot(l.plant.x - l.home.x, l.plant.z - l.home.z);
        if (disp < 0.15) continue;
        l.stepping = true;
        l.t = 0;
        l.dur = dur * (l.hind ? 1 : 0.9);
        l.height = (l.hind ? 0.45 : 0.65) * Math.min(1.4, 0.8 + speed * 0.05);
        l.from.copy(l.plant);
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
