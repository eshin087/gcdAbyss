import * as THREE from 'three';

// Foot planting for the four ground contacts of the drake: two hind feet and two front paws.
// A contact stays planted until its home (root-relative rest spot + velocity / turn lead) drifts
// beyond a stride threshold, or the leg is about to run out of reach, then steps. Gaits by ground
// speed (docs/art/dragon.md §4):
//   walk  (<= 5 m/s, and turning in place): 4-beat lateral sequence LH -> LF -> RH -> RF, one foot in
//         the air at a time (three always down); a second foot may lift when one falls behind (sharp
//         turns), never both feet of one girdle at once
//   trot  (5-8 m/s): diagonal pairs {LH, RF} / {RH, LF}
//   bound (> 8 m/s, the charge): hind pair, then the front pair a beat later
// Step timing follows how fast each home moves (`homeSpeed`): turning in place at 70-110°/s moves
// the front homes ~6-9 m/s with no root speed at all, and the tail sweep's spin ~30-60 m/s, so those
// steps get short and quick instead of letting the planted paws fall metres behind the shoulders
// (they used to drag along the ground or hang in the air at full stretch).
// `scale` = body size (tuning SCALE): stride thresholds and step heights grow with the body.

const LH = 0, RH = 1, LF = 2, RF = 3;
const WALK = [LH, LF, RH, RF];
const PARTNER = [RH, LH, RF, LF]; // the other foot of the same girdle
const TROT = [
  [LH, RF],
  [RH, LF],
];
const BOUND = [
  [LH, RH],
  [LF, RF],
];
const REACH_SOFT = 0.92; // a planted foot past this fraction of its leg's reach wants to step
const MIN_DUR = 0.13; // fastest step (s): the spin's scramble
// settling while standing (Gait.settle): a foot further than SETTLE_DIST (x scale) from its spot
// steps there, SETTLE_DUR s per step, SETTLE_GAP s from one lift-off to the next
const SETTLE_DIST = 0.24;
const SETTLE_DUR = 0.42;
const SETTLE_GAP = 0.75;
// a contact that leaves the ground eases to its home at this rate (1/s) instead of snapping there
const FREE_RATE = 10;

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
    // set by the rig every frame: horizontal distance from the hip / shoulder to the planted contact
    // as a fraction of what the leg can reach at its current height (> 1 = out of reach)
    reach: 0,
    homeSpeed: 0, // m/s, smoothed
    _prevHome: new THREE.Vector3(),
    _hasPrev: false,
    // swinging foot: world offset (x / z) that absorbs a jump of its home mid-swing and fades out by
    // the landing (see update), and last frame's swing progress
    off: new THREE.Vector3(),
    _tPrev: 0,
    // the contact without that offset (what pos was before it existed): the shoulders' scapula glide
    // follows this one, so the offset can't feed back into the reach and the step decisions
    posRef: new THREE.Vector3(),
    wasFree: false,
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
    this.turnRate = 0; // |root yaw rate| (rad/s, set by the rig): turning in place trots the feet round
    this.dYaw = 0; // this frame's root yaw change (rad, set by the rig) and the pivot (root position)
    this.pivot = new THREE.Vector3();
    this.settle = 0; // 0..1 (set by the rig): standing still and idle, stray feet step back to their spots
    this._settleT = 0;
  }

  /**
   * Walk step duration (s) at ground speed `v` (m/s). Four steps make a cycle, so the stride is
   * v x 4 x dur; the rig leads the homes by two steps (half a cycle) so each foot's stance centres on
   * its rest spot under the shoulder / hip (it used to land 1.8 m ahead and leave 3 m behind: the
   * forelegs ran out of reach and the paw lifted off the ground before its step).
   */
  static walkDur(v) {
    return Math.min(0.45, Math.max(0.24, 0.34 + (3 - v) * 0.06));
  }

  /** Plant contact `i` at `pos` now (a rake / slam that ends on the ground); it steps home later. */
  plantAt(i, pos) {
    const l = this.limbs[i];
    if (!l || !Number.isFinite(pos.x + pos.z)) return;
    l.plant.set(pos.x, 0, pos.z);
    l.pos.copy(l.plant);
    l.posRef.copy(l.plant);
    l.off.set(0, 0, 0);
    l.stepping = false;
    l.t = 0;
    l.lift = 0;
  }

  /** Plant every contact at its current home. */
  snap() {
    for (const l of this.limbs) {
      l.plant.copy(l.home);
      l.pos.copy(l.home);
      l.posRef.copy(l.home);
      l.off.set(0, 0, 0);
      l.stepping = false;
      l.t = 0;
      l.lift = 0;
      l.homeSpeed = 0;
      l._prevHome.copy(l.home);
      l._hasPrev = true;
    }
  }

  _disp(l) {
    return Math.hypot(l.plant.x - l.home.x, l.plant.z - l.home.z);
  }

  /** How badly a planted foot wants to step (>= 1: it should). */
  _urgency(l, threshold) {
    let u = this._disp(l) / threshold;
    if (l.reach > REACH_SOFT) u = Math.max(u, 1 + (l.reach - REACH_SOFT) * 10);
    return u;
  }

  _start(l, dur, speed, adapt = true) {
    l.stepping = true;
    l.t = 0;
    // quick steps when the home races round the root (turning in place, the spin): a step should land
    // before the home has swung much more than a stride further. Only the part of the home's speed the
    // root's own travel doesn't explain counts: a straight run keeps its gait's cadence
    const sc = this.scale;
    const swing = l.homeSpeed - speed;
    const fast = adapt && swing > 1e-3 ? (0.95 * sc) / swing : dur;
    l.dur = adapt ? Math.max(MIN_DUR, Math.min(dur, fast)) : dur;
    const quick = l.dur < 0.22 && adapt;
    l.height = (l.hind ? 0.3 : 0.35) * Math.min(1.4, 0.8 + speed * 0.05) * sc * (quick ? 0.7 : 1);
    l.from.copy(l.plant);
    l.to.copy(l.home);
    l.off.set(0, 0, 0);
    l._tPrev = 0;
  }

  _inAir(l, until) {
    return l.stepping && l.t < until;
  }

  update(dt, speed) {
    const limbs = this.limbs;
    const sc = this.scale;
    this._settleT = Math.max(0, this._settleT - dt);
    const threshold = (0.45 + Math.min(speed, 20) * 0.06) * sc * Math.max(0.2, this.stepScale);
    // turning in place (no real ground speed): quick diagonal pairs carry the feet round the root
    // (not while an attack re-stances the feet: those keep the measured quick 4-beat re-plant)
    const turning = this.turnRate > 0.55 && speed < 3 && this.stepScale > 0.8;
    const mode = (this.mode = speed > 8 ? 'bound' : speed > 5 || turning ? 'trot' : 'walk');

    // home speeds: turning in place / spinning moves the homes with no root speed
    for (const l of limbs) {
      if (l._hasPrev && dt > 1e-5) {
        const hv = Math.min(90, Math.hypot(l.home.x - l._prevHome.x, l.home.z - l._prevHome.z) / dt);
        l.homeSpeed += (hv - l.homeSpeed) * Math.min(1, dt * 14);
      }
      l._prevHome.copy(l.home);
      l._hasPrev = true;
    }

    // a spin far faster than any step can follow (the tail sweep whips the body round at up to
    // ~13 rad/s, the front homes racing 30-60 m/s): planted feet pivot and skid round with the body
    // instead of staying behind and stretching the legs out flat (quick steps still carry them on)
    if (Math.abs(this.dYaw) > 1e-5) {
      const c = this.pivot;
      for (const l of limbs) {
        if (l.free || l.stepping || l.lock) continue;
        // (a rake's 0.6 rad body twist, ~11-15 m/s at the front homes, still steps: only the spin skids)
        const skid = Math.min(1, Math.max(0, (l.homeSpeed - speed - 20) / 12));
        if (skid <= 0) continue;
        const a = this.dYaw * skid, ca = Math.cos(a), sa = Math.sin(a);
        const x = l.plant.x - c.x, z = l.plant.z - c.z;
        // yaw rotates (x, z) as x' = x cos + z sin, z' = -x sin + z cos (Dragon._rootToWorld)
        l.plant.x = c.x + x * ca + z * sa;
        l.plant.z = c.z - x * sa + z * ca;
      }
    }

    // free contacts follow their home (re-plant there when they come back down). They ease there
    // (FREE_RATE) instead of snapping: a paw lifted off a plant far from its home (a forefoot left
    // behind by a lunge, then hopped off the ground by a parry recoil) jumped 1 m in one frame
    const fk = 1 - Math.exp(-FREE_RATE * dt);
    for (const l of limbs) {
      if (l.free) {
        if (l.wasFree) l.pos.lerp(l.home, fk);
        else l.pos.y = 0;
        l.plant.set(l.pos.x, 0, l.pos.z);
        l.posRef.copy(l.pos);
        l.off.set(0, 0, 0);
        l.stepping = false;
        l.lift = 0;
      }
      l.wasFree = l.free;
    }

    const restance = this.stepScale < 0.8;
    // ... unless a planted foot is already past its leg's reach (a windup's fast turn, the tail
    // sweep's backswing): the old stepping would have dragged it or hung it in the air
    let overreach = false;
    for (const l of limbs) if (!l.free && !l.stepping && !l.lock && l.reach > 1.02) overreach = true;
    if (mode === 'walk' && restance && !overreach) {
      // an attack re-stancing its feet (stepScale < 1): the measured v0.4 stepping every windup's
      // body motion (and so its hit spheres) was tuned on, kept exactly. In place (root barely
      // moving): quick overlapping steps so all four re-plant within ~0.7 s, inside the shortest
      // windup, and the stance ends symmetric
      const quick = speed < 1.5;
      const dur = quick ? 0.26 : Math.min(0.5, Math.max(0.28, 0.4 + (3 - speed) * 0.055));
      let busy = false;
      for (const l of limbs) if (l.stepping && l.t < (quick ? 0.55 : 0.97)) busy = true;
      if (!busy) {
        for (let n = 0; n < 4; n++) {
          const i = WALK[(this.seq + n) % 4];
          const l = limbs[i];
          if (l.free || l.stepping || l.lock) continue;
          if (this._disp(l) > threshold * (n === 0 || quick ? 1 : 1.7) || l.reach > 1) {
            this._start(l, dur, speed, false);
            this.seq = (WALK.indexOf(i) + 1) % 4;
            break;
          }
        }
      }
    } else if (mode === 'walk') {
      // one foot at a time, in the lateral sequence (three feet always down): cycle 4 x walkDur
      // (~1.4 s at 3 m/s, stride ~4.3 m: inside the forelegs' reach)
      const dur = Gait.walkDur(speed);
      let nAir = 0, worst = 0;
      for (const l of limbs) {
        if (this._inAir(l, 0.9)) nAir++;
        else if (!l.stepping && !l.free && !l.lock) worst = Math.max(worst, this._urgency(l, threshold));
      }
      // a foot falling behind (sharp turn, the spin) may lift while another is still in the air
      const maxAir = worst >= 1.6 ? 2 : 1;
      if (nAir < maxAir) {
        let pick = -1, pickU = 0;
        for (let n = 0; n < 4; n++) {
          const i = WALK[(this.seq + n) % 4];
          const l = limbs[i];
          if (l.free || l.stepping || l.lock) continue;
          const p = limbs[PARTNER[i]];
          const u = this._urgency(l, threshold);
          // never both feet of a girdle in the air at once, unless this one is out of reach
          if (this._inAir(p, 0.6) && u < 2.2) continue;
          // the sequenced foot steps when it drifted past the threshold; a later one only if it is
          // far behind (a sharp turn), so the order holds while walking
          const need = n === 0 ? 1 : 1.7;
          if (u >= need && u > pickU) {
            pick = i;
            pickU = u;
            if (n === 0) break;
          }
        }
        if (pick >= 0) {
          this._start(limbs[pick], dur, speed);
          this.seq = (WALK.indexOf(pick) + 1) % 4;
        } else if (this.settle > 0.5 && nAir === 0 && this._settleT <= 0) {
          // standing still: square the stance up, one unhurried step at a time, for the foot left
          // furthest from its spot (a turn or a stop leaves the feet wherever the last steps put them;
          // the idle stance moves the homes less than a stride)
          let far = -1, farD = SETTLE_DIST * sc;
          for (let i = 0; i < 4; i++) {
            const l = limbs[i];
            if (l.free || l.stepping || l.lock) continue;
            const dd = this._disp(l);
            if (dd > farD) {
              far = i;
              farD = dd;
            }
          }
          if (far >= 0) {
            this._start(limbs[far], SETTLE_DUR, speed, false);
            this._settleT = SETTLE_GAP;
          }
        }
      }
    } else {
      const groups = mode === 'trot' ? TROT : BOUND;
      const dur = mode === 'trot' ? 0.34 : 0.27;
      const overlap = mode === 'trot' ? 0.5 : 0.3; // the next group lifts mid-stride
      let busy = false;
      for (const l of limbs) if (l.stepping && l.t < overlap) busy = true;
      let best = -1, bestU = 1;
      for (let g = 0; g < groups.length && !busy; g++) {
        for (const i of groups[g]) {
          const l = limbs[i];
          if (l.free || l.stepping || l.lock) continue;
          const u = this._urgency(l, threshold);
          if (u > bestU) {
            bestU = u;
            best = g;
          }
        }
      }
      if (best >= 0) {
        for (const i of groups[best]) {
          const l = limbs[i];
          if (l.free || l.stepping || l.lock || (this._disp(l) < 0.15 * sc && l.reach < REACH_SOFT)) continue;
          this._start(l, dur, speed);
        }
      }
    }

    for (const l of limbs) {
      if (l.free) continue;
      if (!l.stepping) {
        l.pos.copy(l.plant);
        l.posRef.copy(l.plant);
        l.lift = 0;
        continue;
      }
      l.t += dt / Math.max(0.05, l.dur);
      const t = Math.min(1, l.t);
      const e = t * t * (3 - 2 * t);
      // track the moving home so fast gaits don't lag behind. A home can also JUMP (the root's velocity
      // lead changes in one frame when a run starts or stops dead: the charge's first frame and its
      // skid / bonk, a lunge): the swinging foot jumped with it, 1.5-2.5 m in a frame (thigh / shin
      // pops of 55-65°). The part of the home's move beyond what the root's travel and turn explain is
      // taken into `off`, which fades out by the landing: the foot sweeps over smoothly and still lands
      // exactly on the home (step decisions, lift timing and landing spots are unchanged)
      {
        const dx = l.home.x - l.to.x, dz = l.home.z - l.to.z, dl = Math.hypot(dx, dz);
        const r = Math.hypot(l.home.x - this.pivot.x, l.home.z - this.pivot.z);
        const expect = (Math.abs(speed) * 1.25 + this.turnRate * r * 1.25 + 1.5 * sc) * dt;
        const fade = l._tPrev < 1 ? Math.max(0, Math.min(1, (1 - t) / Math.max(1e-4, 1 - l._tPrev))) : 0;
        l.off.multiplyScalar(fade);
        if (dl > expect && Number.isFinite(dl)) {
          const k = ((dl - expect) / dl) * e;
          l.off.x -= dx * k;
          l.off.z -= dz * k;
        }
        l.off.y = 0;
        if (!Number.isFinite(l.off.x + l.off.z)) l.off.set(0, 0, 0);
        l._tPrev = t;
      }
      l.to.copy(l.home);
      l.posRef.lerpVectors(l.from, l.to, e);
      l.lift = Math.sin(Math.PI * t);
      l.posRef.y = l.to.y + l.lift * l.height;
      l.pos.copy(l.posRef).add(l.off);
      if (l.t >= 1) {
        l.stepping = false;
        l.plant.copy(l.to);
        l.pos.copy(l.plant);
        l.posRef.copy(l.plant);
        l.off.set(0, 0, 0);
        l.lift = 0;
        this.onStep?.(l);
      }
    }
  }
}
