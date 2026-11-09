import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { TELL } from '../../combat/rules.js';
import { clamp, lerp, smoothstep, easeInOutSine, easeOutCubic, easeInCubic, turnToward, angleDiff } from '../../core/math.js';

/** Wing spread the actions return to (the mantled HALF sails, TUNING.rest). */
const REST_SPREAD = TUNING.rest.spread;

// Attack definitions. Each is driven by the action runner in ai.js:
//   phases(d)          -> [[name, seconds], ...]   ('windup*' / 'active*' / 'recovery' are announced)
//   beats(d, a)        -> tell beats (see beat()): one per hit; the runner emits combat:tell at the
//                         hit's windup start, combat:flash + an in-world flash flashLead s before
//                         impact, and arms `a.cur` so strikes carry the hit's tell data
//   zone(d, a, out)    -> optional AoE centre (written to out) + radius: red tells draw a ground ring
//   weight(d, s)       -> selection weight given the sensed player (0 = unusable)
//   start(d, a)        -> once, before the first phase
//   enter(d, a, phase) -> on every phase change
//   update(d, a, dt)   -> every frame BEFORE the rig (pose targets, root motion)
//   hit(d, a, dt)      -> every frame AFTER the rig (hitboxes from fresh joint positions)
//   end(d, a, interrupted)
// `d` is the Dragon, `a` the running action ({phase, t, T, dur, k, cur, ...scratch}).
// Geometry: pose targets go through d.rootPt (root frame in MODEL units, scaled by SCALE); every
// world distance below (reach, radii, AI ranges) is a v0.1 metre value x S.

const T = TUNING.attacks;
const S = SCALE;
const DEG = Math.PI / 180;
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V();

/** Sphere (x,y,z,r) vs the player's vertical cylinder (radius = player.radius, height 1.8). */
export function sphereHitsPlayer(player, x, y, z, r) {
  const p = player?.position;
  if (!p) return false;
  const pr = player.radius ?? 0.45;
  const dh = Math.max(0, Math.hypot(x - p.x, z - p.z) - pr);
  const cy = Math.min(Math.max(y, p.y), p.y + 1.8);
  const dy = y - cy;
  return dh * dh + dy * dy <= r * r;
}

/** Swept sphere test from the previous frame's position (stored on the action under `key`). */
export function sweepHit(d, a, key, pos, r) {
  const prevMap = (a.prev ||= {});
  let prev = prevMap[key];
  if (!prev) prev = prevMap[key] = V().copy(pos);
  d.markHitbox?.(pos.x, pos.y, pos.z, r);
  const player = d.game.player;
  const dist = prev.distanceTo(pos);
  const steps = Math.min(8, Math.max(1, Math.ceil(dist / (r * 0.5))));
  let hit = false;
  for (let i = 1; i <= steps && !hit; i++) {
    _c.lerpVectors(prev, pos, i / steps);
    hit = sphereHitsPlayer(player, _c.x, _c.y, _c.z, r);
  }
  prev.copy(pos);
  return hit;
}

/**
 * A tell beat: the hit whose windup starts `at` s into the action and can land `impactIn` s later.
 * `spec` supplies tell / parryable / blockable (tuning entry or combo hit); `part` names the striking
 * part for the in-world flash (see Dragon.partPos).
 */
export function beat(attack, at, impactIn, spec, part, extra = null) {
  return {
    attack,
    at,
    impactIn: Number.isFinite(impactIn) ? Math.max(0.05, impactIn) : 0.8,
    tell: spec?.tell ?? TELL.NORMAL,
    parryable: spec?.parryable,
    blockable: spec?.blockable,
    part,
    told: false,
    flashed: false,
    ...extra,
  };
}

/** Phase 2 speeds up windups + recoveries (TUNING.phase2TimeScale); swings keep their speed. */
const wind = (d, base) => base * (d.tScale ?? 1);
/** Seconds from the action start to the start of phase `name`. */
function phaseAt(list, name) {
  let t = 0;
  for (const p of list) {
    if (p[0] === name) return t;
    t += p[1];
  }
  return t;
}
const phaseDur = (list, name) => {
  for (const p of list) if (p[0] === name) return p[1];
  return 0;
};
const wingIndex = (side) => (side > 0 ? 0 : 1);
const playerR = (g) => g.player?.radius ?? 0.45;

/** Quadratic Bezier in the root frame (model units) -> world. */
function rootBezier(d, out, p0, p1, p2, t) {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const z = u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2];
  return d.rootPt(out, x, y, z);
}

// ------------------------------------------------------------------ roar helpers (also used by ai.js)
export function roarFx(d, strength) {
  const g = d.game, pt = d.rig.pt;
  d.emit('dragon:roar', { strength });
  g.shake?.(0.5 * strength);
  g.world?.gust?.(d.position.x, d.position.z, 1.6 * strength, 22 * S);
  d.fx.roarWave(pt.mouth.x, pt.mouth.y, pt.mouth.z, strength);
}

/** Roar pose: stands tall on straight forelegs, chest out, head thrown up, jaw wide, shuddering wings. */
export function roarPose(d, a, spread) {
  const pose = d.pose;
  pose.head = d.rootPt(pose.headTarget, 0, 5.9, 3.4);
  pose.headRate = 5;
  pose.jaw = 1;
  pose.jawRate = 14;
  pose.pitch = -0.12;
  pose.lower = -0.15;
  pose.swell = 1;
  d.rootPt(pose.look, 0, 9, 14); // throat up to the sky: the lit maw and the molten S face forward
  pose.spread[0] = pose.spread[1] = spread;
  pose.spreadRate = 5;
  pose.flap = spread > 0.5 ? 0.12 : 0;
  pose.flapHz = 3;
  const j = (Math.sin(d.time * 41) * 0.09 + Math.sin(d.time * 23) * 0.06) * S;
  pose.headOffset.x += j;
  pose.headOffset.y += Math.sin(d.time * 37) * 0.06 * S;
}

// ------------------------------------------------------------------ shared bite (bite + combo finisher)
function biteStart(a) {
  a.target = V();
  a.goal = V();
  a.snapped = false;
}

/** Lock the bite target: the player's chest (led a little), limited to the neck's reach and arc. */
function biteAim(d, a, reach) {
  const s = d.sense, nb = d.rig.pt.neckBase;
  a.target.copy(s.chest).addScaledVector(s.vel, 0.12);
  // the neck only reaches ~50 deg off the snout line: a player at the flank is missed
  const hx = a.target.x - nb.x, hz = a.target.z - nb.z, hd = Math.hypot(hx, hz);
  const rel = angleDiff(d.yaw, Math.atan2(hx, hz));
  const cr = clamp(rel, -0.9, 0.9);
  if (cr !== rel) {
    a.target.x = nb.x + Math.sin(d.yaw + cr) * hd;
    a.target.z = nb.z + Math.cos(d.yaw + cr) * hd;
  }
  _a.subVectors(a.target, nb);
  const len = _a.length() || 1;
  const r = Math.min(len, reach);
  _a.multiplyScalar(1 / len);
  a.target.copy(nb).addScaledVector(_a, r);
  a.goal.copy(a.target).addScaledVector(_a, -1.0 * S);
  a.goal.y = Math.max(0.75 * S, a.goal.y);
}

const _lead = { target: V(), goal: V() };
/**
 * The last frames of a bite's windup lead the SHOWN head into the strike (pose.headLead: no hit test
 * runs in a windup, the measured head waits for the active phase): 12 / 30 / 55 % of the strike's
 * first step, so the head accelerates into the snap instead of jumping its whole first step (~1.8 m)
 * in one frame. The active frames, and every sphere on them, are untouched.
 */
function strikeLead(d, a, dt, reach) {
  const left = (a.dur - a.t) / Math.max(1e-4, dt); // frames until the strike
  const f = left < 1.5 ? 0.55 : left < 2.5 ? 0.3 : left < 3.5 ? 0.12 : 0;
  if (f <= 0) return;
  biteAim(d, _lead, reach); // the goal the active phase is about to lock
  const k = 1 - Math.exp(-18 * Math.max(dt, 1e-4)); // the strike's first step (biteActive's head rate)
  d.pose.headLead.subVectors(_lead.goal, d.rig.headPos).multiplyScalar(k * f);
}

/**
 * Bite windup (four-legged, docs/art/dragon.md §5): the forelegs plant a little wider, the shoulders
 * sink, the neck coils back into a tight S (head cocked up and back over the neck base), the throat
 * glows faintly and the wings flare briefly (threat display).
 */
function biteWindup(d, a, dt) {
  const pose = d.pose, k = a.k, nb = d.rig.pt.neckBase, f = d.fwd;
  d.turnToward(d.sense.yawTo, d.turnRate * 1.3, dt);
  pose.head = pose.headTarget.set(nb.x + f.x * 0.9 * S, nb.y + 1.95 * S, nb.z + f.z * 0.9 * S);
  pose.headRate = 7;
  pose.jaw = 0.3;
  pose.lower = 0.15 + 0.2 * k;
  pose.pitch = 0.1 * k;
  pose.stanceF = 0.25;
  pose.restep = 1;
  pose.spread[0] = pose.spread[1] = k < 0.75 ? 0.6 : REST_SPREAD;
  pose.spreadRate = 6;
  d.throat = 0.3 * k;
  strikeLead(d, a, dt, T.bite.reach);
}

/** The neck uncoils and the shoulders drive forward off the planted hind feet; the jaw snaps at k 0.62. */
function biteActive(d, a, dt, speed) {
  const pose = d.pose;
  pose.headExact = true; // the snout / head spheres ride on the head's aim
  pose.head = pose.headTarget.copy(a.goal);
  pose.look.copy(a.target);
  pose.lookDown = 1.2; // the snout aims down at the hero
  // snap speed: 18 (was 22 at x1.25) so the x1.875 head meets the hero on the announced impact
  pose.headRate = 18;
  pose.jaw = a.k < 0.62 ? 1 : 0;
  pose.jawRate = 30;
  pose.pitch = 0.14;
  pose.lower = 0.3;
  pose.bodyRate = 9;
  pose.stanceF = 0.25;
  pose.hindLock = true; // the hind feet push; the forelegs take a fast half-step
  d.throat = 0;
  if (speed > 0) d.moveForward(speed, dt);
  if (a.k >= 0.62 && !a.snapped) {
    a.snapped = true;
    d.emit('dragon:bite');
  }
}

/** Head lifts, the body rocks back onto the hind legs, the forelegs re-plant. */
function biteRecover(d, a) {
  const pose = d.pose;
  pose.lookDown = 1.2;
  if (a.k < 0.5) {
    pose.head = pose.headTarget.copy(a.goal);
    pose.head.y += 0.4 * S;
    pose.headRate = 5;
  } else pose.headRate = 3;
  pose.look.copy(a.target);
  pose.jaw = 0.1;
  pose.pitch = 0.14 * (1 - a.k) - 0.12 * Math.sin(Math.PI * Math.min(1, a.k * 1.6));
  pose.lower = 0.3 * (1 - a.k);
  pose.bodyRate = 4;
  pose.restep = 1;
  d.throat = 0;
}

function biteHit(d, a, spec) {
  if (a.hitDone) return;
  const pt = d.rig.pt;
  if (sweepHit(d, a, 'snout', pt.snout, 1.05 * S) || sweepHit(d, a, 'head', pt.head, 0.75 * S)) {
    d.strike(a, { damage: spec.damage, knockback: spec.knockback, kind: 'bite', from: pt.head, point: pt.snout });
  }
}

// ------------------------------------------------------------------ bite
const bite = {
  name: 'bite',
  cooldown: T.bite.cooldown,
  phases: (d) => [['windup', wind(d, T.bite.windup)], ['active', T.bite.active], ['recovery', wind(d, T.bite.recovery)]],
  beats: (d, a) => [beat('bite', 0, a.list[0][1] + T.bite.impact, T.bite, 'snout')],
  // AI ranges below follow the sim-measured hit coverage (the attack must be able to land). v0.4
  // four-legged drake: the short S-neck (3.2 chain from a neck base 1.7 ahead of the root) lands
  // the bite 3-6.5 model units out (the v0.3 wyvern's long neck reached 8.4).
  weight: (d, s) => (s.dist >= 3.0 * S && s.dist <= 6.5 * S && s.absAng <= 0.65 ? T.bite.weight + (s.dist < 5.5 * S ? 1 : 0) : 0),
  start(d, a) {
    biteStart(a);
  },
  enter(d, a, phase) {
    if (phase === 'active') biteAim(d, a, T.bite.reach);
  },
  update(d, a, dt) {
    if (a.phase === 'windup') biteWindup(d, a, dt);
    else if (a.phase === 'active') biteActive(d, a, dt, 3.0 * S);
    else biteRecover(d, a);
  },
  hit(d, a) {
    if (a.phase === 'active') biteHit(d, a, T.bite);
  },
  end(d) {
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ shared foreleg rake (swipe)
// v0.4 four-legged drake: the swipe is a FORELEG rake (the v0.3 wyvern swung a wing wrist).
// Root-frame control points for the PAW (model units, x mirrored by side): cocked high and out ->
// out wide and forward -> across the front, claws raking the ground (docs/art/dragon.md §5).
const SWIPE_P0 = [2.3, 3.3, 2.0];
const SWIPE_P1 = [3.3, 1.1, 3.9];
const SWIPE_P2 = [-0.4, 0.3, 4.6];
const SWIPE_LUNGE = 0.5; // root travel through the active phase (model units): the 2.9 leg reaches P1

function swipeCurve(side) {
  return {
    side,
    wi: wingIndex(side), // paw / arm index (0 = left +X, 1 = right)
    p0: [side * SWIPE_P0[0], SWIPE_P0[1], SWIPE_P0[2]],
    p1: [side * SWIPE_P1[0], SWIPE_P1[1], SWIPE_P1[2]],
    p2: [side * SWIPE_P2[0], SWIPE_P2[1], SWIPE_P2[2]],
  };
}

/**
 * Cock the paw high and out (k = windup progress): the weight shifts onto the other three legs (body
 * rolls away, the far foreleg braces wide), the chest twists toward the swing, the elbow flares out;
 * the body turns so the player sits on the swing side.
 */
function swipeWindup(d, w, k, dt, turn = 0.5) {
  const pose = d.pose, ov = pose.pawOv[w.wi];
  d.turnToward(d.sense.yawTo - w.side * 0.5, d.turnRate * turn, dt);
  ov.w = 1;
  // lift: up and out first, then the last 30 cm of cock (a readable hitch before the strike)
  const e = smoothstep(0, 0.55, k);
  d.rootPt(ov.pos, w.side * lerp(1.4, w.p0[0] * w.side, e), lerp(0.4, w.p0[1], e) + Math.sin(k * Math.PI) * 0.3, lerp(2.3, w.p0[2], e));
  pose.pawOvRate = 7;
  pose.spread[w.wi] = 0.45; // the swing-side wing flares (balance + silhouette tell)
  pose.spreadRate = 5;
  pose.roll = w.side * 0.1; // weight onto the other three legs
  pose.twist = w.side * 0.15;
  pose.lower = 0.2;
  pose.stanceF = 0.15;
  pose.jaw = 0.25;
}

function swipeActive(d, w, k, dt, dur) {
  const pose = d.pose, ov = pose.pawOv[w.wi];
  ov.w = 1;
  rootBezier(d, ov.pos, w.p0, w.p1, w.p2, easeInOutSine(k));
  pose.pawOvRate = 30;
  pose.spread[w.wi] = 0.4;
  pose.twist = w.side * 0.35;
  pose.roll = -w.side * 0.08;
  pose.lower = 0.3;
  pose.pitch = 0.1;
  pose.bodyRate = 9;
  d.yaw += (w.side * 0.6 * dt) / Math.max(0.05, dur);
  d.moveForward((SWIPE_LUNGE * S) / Math.max(0.05, dur), dt);
  pose.jaw = 0.5;
}

/**
 * The raking paw slaps down where the arc ended (as far as the leg reaches: claws in the ground,
 * dust) and plants there as a ground contact; the gait later steps it home.
 */
function swipeRecover(d, w, k) {
  const pose = d.pose, ov = pose.pawOv[w.wi];
  if (!w.plant) {
    w.plant = d.rig.clampPaw(w.wi, d.rootPt(V(), w.p2[0], 0, w.p2[2]));
    w.from = V().copy(d.rig.pt.arms[w.wi].toe);
  }
  if (!w.planted) {
    ov.w = 1;
    pose.pawOvRate = 30;
    if (k < 0.2) ov.pos.lerpVectors(w.from, w.plant, smoothstep(0, 0.2, k));
    else {
      w.planted = true;
      ov.pos.copy(w.plant);
      pose.pawPlant[w.wi] = true;
      d.fx.dustRing(w.plant.x, w.plant.z, 0.35 * S, 12, 0.45);
      d.emit('dragon:step', { x: w.plant.x, z: w.plant.z, heavy: false });
    }
  }
  pose.twist = w.side * 0.2 * (1 - k);
  pose.lower = 0.25 * (1 - k);
  if (w.planted) pose.restep = 1; // the planted paw steps home within the recovery
}

function swipeHit(d, a, w, spec) {
  if (a.hitDone) return;
  const ap = d.rig.pt.arms[w.wi];
  _b.lerpVectors(ap.elbow, ap.wrist, 0.5);
  // the paw sphere covers the four claws around the toe; plus the wrist and the forearm
  if (
    sweepHit(d, a, 'paw', ap.toe, 1.1 * S) ||
    sweepHit(d, a, 'wrist', ap.wrist, 0.8 * S) ||
    sweepHit(d, a, 'forearm', _b, 0.75 * S)
  ) {
    d.strike(a, { damage: spec.damage, knockback: spec.knockback, kind: 'swipe', from: ap.shoulder, point: ap.toe });
  }
}

// ------------------------------------------------------------------ foreleg rake (swipe)
const swipe = {
  name: 'swipe',
  cooldown: T.swipe.cooldown,
  phases: (d) => [['windup', wind(d, T.swipe.windup)], ['active', T.swipe.active], ['recovery', wind(d, T.swipe.recovery)]],
  beats: (d, a) => [beat('swipe', 0, a.list[0][1] + T.swipe.impact, T.swipe, 'claw', { wi: a.w.wi })],
  // the foreleg rake (sim-measured, v0.4) lands 2-5.5 model units out up to ~75° off the nose;
  // farther round the flank the paw can't reach (the tail / stomp cover it), so the AI doesn't pick it.
  // Beyond ~66° a hero closer than 2.75 stands beside the shoulder, under the arc (2.5 missed at 1.35
  // rad, 2.0 at 1.2 in the fine probe)
  weight: (d, s) => {
    if (s.absAng < 0.4 || s.absAng > 1.35) return 0;
    if (s.dist >= (s.absAng > 1.15 ? 2.75 : 2.0) * S && s.dist <= 5.5 * S) return T.swipe.weight;
    return 0;
  },
  start(d, a) {
    a.w = swipeCurve(d.sense.ang >= 0 ? 1 : -1); // + = player on the model-left (+X) side
  },
  update(d, a, dt) {
    if (a.phase === 'windup') swipeWindup(d, a.w, a.k, dt);
    else if (a.phase === 'active') swipeActive(d, a.w, a.k, dt, a.dur);
    else swipeRecover(d, a.w, a.k);
  },
  hit(d, a) {
    if (a.phase === 'active') swipeHit(d, a, a.w, T.swipe);
  },
};

// ------------------------------------------------------------------ claw combo (3 hits)
// left claw (normal) -> right claw (normal) -> lunging bite (blue). Each hit has its own windup,
// tell and flash; a parry on any hit recoils the wyrm and ends the string (Dragon.onParried).
const CC = T.clawCombo;
const clawCombo = {
  name: 'clawCombo',
  cooldown: CC.cooldown,
  phases: (d) => [
    ['windup', wind(d, CC.hits[0].windup)],
    ['active', CC.hits[0].active],
    ['windup2', wind(d, CC.hits[1].windup)],
    ['active2', CC.hits[1].active],
    ['windup3', wind(d, CC.hits[2].windup)],
    ['active3', CC.hits[2].active],
    ['recovery', wind(d, CC.recovery)],
  ],
  beats: (d, a) =>
    CC.hits.map((h, i) => {
      const wn = i === 0 ? 'windup' : `windup${i + 1}`;
      const lunge = h.kind === 'lunge';
      return beat('clawCombo', phaseAt(a.list, wn), phaseDur(a.list, wn) + h.impact, h, lunge ? 'snout' : 'claw', { hit: i, wi: lunge ? 0 : a.w[i].wi });
    }),
  // all three hits land 3-5 model units out (sim-measured, v0.4); beyond ~5.5 the claws fall short
  weight: (d, s) => (s.dist >= 3.0 * S && s.dist <= 5.4 * S && s.absAng <= 0.9 ? CC.weight * (d.phase === 2 ? 1.2 : 1) : 0),
  start(d, a) {
    // the first claw comes from the side the player stands on, the second from the other
    const s0 = d.sense.ang >= 0 ? 1 : -1;
    a.w = CC.hits.map((h) => swipeCurve((h.side ?? 1) * s0));
    biteStart(a);
    a.lungeV = 0;
  },
  enter(d, a, phase) {
    if (phase !== 'active3') return;
    const h = CC.hits[2];
    biteAim(d, a, h.reach);
    // close the gap: travel up to h.lunge so the snout ends at the player
    const travel = clamp(d.sense.dist - h.reach * 0.75, 0, h.lunge);
    a.lungeV = travel / Math.max(0.05, a.dur);
  },
  update(d, a, dt) {
    const w0 = a.w[0], w1 = a.w[1];
    switch (a.phase) {
      case 'windup':
        swipeWindup(d, w0, a.k, dt, 0.7);
        break;
      case 'active':
        swipeActive(d, w0, a.k, dt, a.dur);
        break;
      case 'windup2':
        swipeRecover(d, w0, Math.min(1, a.k * 2));
        swipeWindup(d, w1, a.k, dt, 0.8);
        break;
      case 'active2':
        swipeActive(d, w1, a.k, dt, a.dur);
        break;
      case 'windup3': {
        // sits back onto its haunches, both forefeet planted, head drawn up and back, both wings
        // pulse: the blue finisher
        swipeRecover(d, w1, Math.min(1, a.k * 2));
        const pose = d.pose;
        d.turnToward(d.sense.yawTo, d.turnRate * 1.4, dt);
        pose.head = d.rootPt(pose.headTarget, 0, 4.7, 1.7);
        pose.headRate = 6;
        pose.jaw = 0.35 + 0.3 * a.k;
        pose.pitch = -0.1;
        pose.lower = 0.05;
        pose.strideH = 0.35; // hind feet under the haunches: the spring of the lunge
        pose.restep = 1;
        pose.spread[0] = pose.spread[1] = REST_SPREAD + 0.12 * Math.sin(Math.PI * a.k);
        pose.spreadRate = 8;
        d.throat = 0.25 * a.k;
        strikeLead(d, a, dt, CC.hits[2].reach);
        break;
      }
      case 'active3':
        biteActive(d, a, dt, a.lungeV);
        break;
      default:
        biteRecover(d, a);
    }
  },
  hit(d, a) {
    if (a.phase === 'active') swipeHit(d, a, a.w[0], CC.hits[0]);
    else if (a.phase === 'active2') swipeHit(d, a, a.w[1], CC.hits[1]);
    else if (a.phase === 'active3') biteHit(d, a, CC.hits[2]);
  },
  end(d) {
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ tail sweep
const TAIL_KEYS = [];
/** Cached sweep keys per tail joint (no per-frame string building). */
const tailKeys = (n) => {
  while (TAIL_KEYS.length <= n) TAIL_KEYS.push(`t${TAIL_KEYS.length}`);
  return TAIL_KEYS;
};
const tail = {
  name: 'tail',
  cooldown: T.tail.cooldown,
  faceAway: true, // Lab trigger turns the tail toward the player
  phases: (d) => [['windup', wind(d, T.tail.windup)], ['active', T.tail.active], ['recovery', wind(d, T.tail.recovery)]],
  // the tail reaches a player at the flank later in the spin than one straight behind
  beats: (d, a) => {
    const flank = clamp((Math.PI - d.sense.absAng) / (Math.PI - 1.4), 0, 1);
    return [beat('tail', 0, a.list[0][1] + T.tail.impact + T.tail.impactFlank * flank, T.tail, 'tailTip')];
  },
  weight: (d, s) => {
    if (s.dist <= 9.4 * S && s.absAng >= 1.75) return T.tail.weight;
    if (s.dist <= 6.5 * S && s.absAng >= 1.2) return T.tail.weight * 0.5;
    return 0;
  },
  start(d, a) {
    a.dir = d.sense.ang >= 0 ? -1 : 1; // rotate away so the tail swings INTO the player
    a.yaw0 = d.yaw;
    a.yawW = a.yaw0 - a.dir * 0.35;
  },
  update(d, a, dt) {
    const pose = d.pose;
    // the sweep's tail is the measured v0.4 chain solve (its hit spheres and swept arc ride on it)
    pose.tailLegacy = true;
    // wings folded tight through the whole sweep so the membranes stay clear of the tail
    pose.spread[0] = pose.spread[1] = a.phase === 'recovery' && a.k > 0.4 ? REST_SPREAD : 0;
    pose.spreadRate = 5;
    // the arched resting tail drops low for the sweep (the measured v0.4 tail) and lifts back after
    pose.tailLift = a.phase === 'recovery' && a.k > 0.3 ? 1 : 0;
    if (a.phase === 'windup') {
      // looks over its shoulder at the player (pose.look = the player's chest), crouches, the hind
      // feet brace wide, the tail coils to the opposite side (away from the player, with the body's
      // backswing: curling its tip back over a hero standing straight behind landed the sweep on the
      // first active frame, ~0.2 s before its combat:flash + flashLead)
      d.yaw = turnToward(d.yaw, a.yawW, 2.2 * dt);
      pose.lower = 0.25;
      pose.pitch = 0.08;
      pose.tailCurl = -a.dir * 0.06;
      pose.lookRate = 5;
      pose.stanceH = 0.35;
      pose.restep = 1;
      pose.speed = 3;
    } else if (a.phase === 'active') {
      // spins about the root, feet shuffling (gait at speed), tail stiff and whipping through, head
      // leading the turn
      const e = easeInOutSine(a.k);
      d.yaw = a.yawW + a.dir * (T.tail.spin + 0.35) * e;
      pose.tailCurl = -a.dir * 0.05;
      pose.tailStiff = 2.6;
      pose.lower = 0.3;
      pose.bodyRate = 8;
      pose.stanceH = 0.35;
      pose.speed = 6;
      pose.tailWave = 0;
      d.rootPt(pose.look, a.dir * 7, 1, 3);
    } else {
      pose.lower = 0.25 * (1 - a.k);
      pose.speed = 2;
    }
  },
  hit(d, a) {
    const chain = d.rig.tail, radii = d.model.tailRadii, keys = tailKeys(chain.n);
    // angle of the visible tail (mid segment) around the root, tracked every frame
    const mid = chain.p[Math.min(9, chain.n)];
    const ang = Math.atan2(mid.x - d.position.x, mid.z - d.position.z);
    const prevAng = a.tailAng ?? ang;
    a.tailAng = ang;
    if (a.hitDone) return;
    if (a.phase !== 'active' && !(a.phase === 'recovery' && a.k < 0.15)) return;
    const tip = chain.p[chain.n];
    // swept arc: the tail crossed the player's bearing this frame within its reach
    const p = d.game.player?.position;
    if (p) {
      const pd = Math.hypot(p.x - d.position.x, p.z - d.position.z);
      const delta = angleDiff(prevAng, ang);
      const rel = angleDiff(prevAng, Math.atan2(p.x - d.position.x, p.z - d.position.z));
      const tol = (0.9 * S) / Math.max(1, pd);
      const crossed = Math.abs(delta) > 1e-4 && rel * delta >= -tol * Math.abs(delta) && Math.abs(rel) <= Math.abs(delta) + tol;
      if (crossed && pd >= T.tail.minReach && pd <= T.tail.reach) {
        d.strike(a, { damage: T.tail.damage, knockback: T.tail.knockback, kind: 'tail', from: d.position, point: tip });
        return;
      }
    }
    for (let i = 4; i <= chain.n; i++) {
      const r = ((radii[Math.min(i, radii.length - 1)] ?? 0.2) + 0.4) * S;
      if (sweepHit(d, a, keys[i], chain.p[i], r)) {
        d.strike(a, { damage: T.tail.damage, knockback: T.tail.knockback, kind: 'tail', from: d.position, point: tip });
        return;
      }
    }
  },
};

// ------------------------------------------------------------------ stomp (rear up + slam)
// The forefeet slam down together at (+-STOMP_X, 0, STOMP_Z) in the root frame (model units, just
// ahead of the front-paw homes): the ring is centred on their midpoint, the flash / dust sit on them.
const STOMP_Z = 2.9;
const STOMP_X = 1.2;
const _slam = V();
const stomp = {
  name: 'stomp',
  cooldown: T.stomp.cooldown,
  phases: (d) => [['windup', wind(d, T.stomp.windup)], ['active', T.stomp.active], ['recovery', wind(d, T.stomp.recovery)]],
  beats: (d, a) => [beat('stomp', 0, a.list[0][1] + a.list[1][1], T.stomp, 'forefeet')],
  zone(d, a, out) {
    d.rootPt(out, 0, 0, STOMP_Z); // the midpoint of the two striking forefeet's landing spots
    return T.stomp.radius;
  },
  // only when the player stands inside the slam zone (under the chest / beside the forelimbs);
  // players behind the hips get the tail sweep instead
  weight: (d, s) => {
    const fz = Math.cos(s.ang) * s.dist - STOMP_Z * S, fx = Math.sin(s.ang) * s.dist;
    const r = Math.hypot(fx, fz);
    return r <= T.stomp.radius - 0.3 ? T.stomp.weight * (r <= 3 * S ? 1.5 : 1) : 0;
  },
  enter(d, a, phase) {
    if (phase === 'active') {
      // the slam starts from wherever the rear-up holds the paws and body (see update)
      const A2 = d.rig.pt.arms;
      a.paw0 = [V().copy(A2[0].toe), V().copy(A2[1].toe)];
      a.pitch0 = d.rig.s.pitch;
      a.rear0 = d.rig.s.rear;
      a.lower0 = d.rig.s.lower;
      return;
    }
    if (phase !== 'recovery') return;
    const c = d.rootPt(_a, 0, 0, STOMP_Z);
    const g = d.game;
    g.shake?.(0.45);
    g.world?.gust?.(c.x, c.z, 1.4, 13 * S);
    d.fx.dustRing(c.x, c.z, 1.5 * S, 40, 1.1);
    d.markHitbox?.(c.x, 0, c.z, T.stomp.radius);
    // the striking forefeet: a dust burst + a heavy step where each one landed
    for (let k = 0; k < 2; k++) {
      const f = d.rootPt(_b, (k === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
      d.fx.dustRing(f.x, f.z, 0.5 * S, 16, 0.8);
      d.emit('dragon:step', { x: f.x, z: f.z, heavy: true });
    }
    const p = g.player?.position;
    if (p && Math.hypot(p.x - c.x, p.z - c.z) <= T.stomp.radius + playerR(g)) {
      d.strike(a, { damage: T.stomp.damage, knockback: T.stomp.knockback, kind: 'stomp', from: c, point: c });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense;
    if (a.phase === 'windup') {
      // rears up on the hind legs (hips as the pivot): both forefeet leave the ground and rise to
      // chest height, claws spread; the tail presses flat (the third leg of the tripod), head high,
      // wings flare; the hind feet brace wider
      d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
      // the last third coils higher (anticipation): chest and paws lift a little more, the head
      // draws back, the wings flare up for the downstroke
      const coil = smoothstep(0.62, 1, a.k);
      pose.pitch = -0.62 - 0.08 * coil;
      pose.rear = 1;
      pose.bodyRate = 3.5 + 2.5 * coil;
      pose.lower = -0.2 - 0.08 * coil;
      pose.spread[0] = pose.spread[1] = 0.6 + 0.22 * coil;
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 6.0 + 0.3 * coil, 3.5 - 0.35 * coil);
      pose.headRate = 4;
      pose.jaw = 0.45 + 0.2 * coil;
      pose.stanceH = 0.25;
      pose.restep = 1;
      pose.swell = a.k;
      pose.tailWave = 0;
      pose.tailLift = 0; // pressed flat behind: the tripod's third leg
    } else if (a.phase === 'active') {
      // both forefeet slam down together on their landing spots, accelerating all the way so they
      // strike exactly on the impact (the end of the active, when the ring and the dust go off: they
      // used to land ~5 frames early and wait); the body pitches forward with them, the wings beat
      // down through the slam (a gust)
      const e = a.k * a.k;
      pose.pitch = lerp(a.pitch0 ?? -0.62, 0.16, e);
      pose.rear = (a.rear0 ?? 1) * (1 - e);
      pose.lower = lerp(a.lower0 ?? -0.2, 0.15, e);
      pose.bodyRate = 60;
      for (let k = 0; k < 2; k++) {
        const ov = pose.pawOv[k];
        ov.w = 1;
        const spot = d.rootPt(_slam, (k === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
        if (a.paw0) ov.pos.lerpVectors(a.paw0[k], spot, e);
        else ov.pos.copy(spot);
      }
      pose.pawOvRate = 90;
      pose.stanceH = 0.25;
      pose.spread[0] = pose.spread[1] = lerp(0.82, REST_SPREAD - 0.18, e);
      pose.spreadRate = 22;
      pose.headRate = 10;
      pose.jaw = 0.8;
      pose.tailWave = 0;
      pose.tailLift = 0;
    } else {
      // settle: the forefeet stay pressed into the slam spots for a beat (held by the override, so
      // the gait can't lift them), then plant there as contacts and step back home
      const hold = a.k < 0.3;
      if (hold || !a.planted) {
        for (let k = 0; k < 2; k++) {
          const ov = pose.pawOv[k];
          d.rootPt(ov.pos, (k === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
          ov.w = 1;
          if (!hold) pose.pawPlant[k] = true;
        }
        pose.pawOvRate = 40;
        if (!hold) a.planted = true;
      }
      // the impact travels through the body: the chest keeps sinking into the braced forelegs for
      // ~0.1 s (squash), the head and the wings follow through downward, the tail slaps, then all of
      // it settles back to the stance
      const sq = a.k < 0.1 ? a.k / 0.1 : Math.max(0, 1 - (a.k - 0.1) / 0.32);
      const ease = sq * sq * (3 - 2 * sq);
      pose.pitch = 0.08 * (1 - a.k) + 0.06 * ease;
      pose.bodyRate = a.k < 0.45 ? 9 : 3;
      pose.lower = 0.15 * (1 - a.k) + 0.2 * ease;
      pose.headOffset.y -= 0.7 * S * ease;
      pose.headRate = a.k < 0.45 ? 8 : 4;
      pose.spread[0] = pose.spread[1] = REST_SPREAD - 0.18 * ease;
      pose.spreadRate = a.k < 0.3 ? 10 : 3;
      pose.tailWave = 0.07 + 0.08 * ease;
      // the tail stays down through the slam's squash and lifts back to its arch once the body settles
      // (lifting while the slam whipped the chain into the ground folded it)
      pose.tailLift = a.k < 0.5 ? 0 : 1;
      pose.restep = hold ? 0 : 1;
      pose.jaw = 0.1 + 0.25 * ease;
    }
  },
};

// ------------------------------------------------------------------ fire breath
const BREATH_PITCH = 0.2; // front crouch (rad, nose down about the hips): the chest drops ~0.55 model
const BREATH_FALL = 0.17; // the stream's downward angle (rad) from the low mouth
const breath = {
  name: 'breath',
  cooldown: T.breath.cooldown,
  phases: (d) => [
    ['windup', wind(d, T.breath.windup)],
    ['active', d.phase === 2 ? T.breath.activeP2 : T.breath.active],
    ['recovery', wind(d, T.breath.recovery)],
  ],
  beats: (d, a) => [beat('breath', 0, a.list[0][1], T.breath, 'mouth')],
  weight: (d, s) => (s.dist >= 6 * S && s.dist <= 16 * S && s.absAng <= 1.0 ? T.breath.weight * (d.phase === 2 ? 1.2 : 1) : 0),
  start(d, a) {
    a.side = Math.random() < 0.5 ? -1 : 1;
    a.aim = d.sense.yawTo;
    a.aim0 = a.aim;
    a.tick = 0;
    a.on = false;
  },
  enter(d, a, phase) {
    if (phase === 'active') {
      a.on = true;
      d.emit('dragon:breathStart');
      d.fx.breathBegin();
      // start within the snout's reach; P1 then tracks the player, P2 sweeps across them
      const center = d.yaw + clamp(angleDiff(d.yaw, d.sense.yawTo), -0.6, 0.6);
      a.aim0 = center - (d.phase === 2 ? (a.side * T.breath.sweepP2) / 2 : 0);
      a.aim = a.aim0;
      a.tick = 0;
    } else if (phase === 'recovery') this.end(d, a);
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt;
    if (a.phase === 'windup') {
      // plants all four feet wide, the chest swells, the throat-to-chest lava charges, the neck draws
      // back and up, embers leak from the mouth; the wings start to open late in the windup
      d.turnToward(s.yawTo, d.turnRate * 0.9, dt);
      pose.head = d.rootPt(pose.headTarget, 0, 5.6, 2.6);
      pose.headRate = 4;
      pose.jaw = 0.25;
      pose.look.copy(s.chest);
      pose.look.y += 3 * S;
      pose.pitch = -0.08;
      pose.lower = -0.1;
      pose.stanceF = 0.3;
      pose.stanceH = 0.2;
      pose.restep = 1;
      pose.swell = a.k;
      pose.spread[0] = pose.spread[1] = a.k > 0.55 ? 1 : REST_SPREAD;
      pose.mantle = a.k > 0.55 ? 1 : 0;
      pose.spreadRate = 3;
      d.throat = a.k;
      d.fx.mouthEmbers(dt, pt.mouth, 30, pt.headFwd);
    } else if (a.phase === 'active') {
      pose.headExact = true; // the stream leaves the mouth
      if (d.phase === 2) a.aim = a.aim0 + a.side * T.breath.sweepP2 * a.k;
      else a.aim = turnToward(a.aim, s.yawTo, 32 * DEG * dt);
      d.turnToward(a.aim, 1.2, dt);
      const sa = Math.sin(a.aim), ca = Math.cos(a.aim);
      // the ASCII panel's pose: front crouched low (chest toward the ground, hips higher), forelegs
      // braced wide, neck stretched forward and DOWN (the stream angles at the ground; the head
      // tracks / sweeps with the neck alone), wings fully spread and high, the tail lashing slowly
      pose.head = pose.headTarget.set(pt.neckBase.x + sa * 2.7 * S, pt.neckBase.y - 0.4 * S, pt.neckBase.z + ca * 2.7 * S);
      pose.headRate = 5;
      pose.lookDown = 1.0;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 3;
      pose.mantle = 1;
      pose.look.set(pt.mouth.x + sa * 8 * S, 0, pt.mouth.z + ca * 8 * S);
      pose.lookRate = 12;
      pose.jaw = 0.95;
      pose.pitch = BREATH_PITCH;
      pose.lower = 0.15;
      pose.bodyRate = 4;
      pose.stanceF = 0.3;
      pose.stanceH = 0.2;
      pose.restep = 1; // a foot still short of the wide stance re-plants (and the slow aim turn shuffles)
      pose.elbowsOut = 0.45;
      pose.swell = 1;
      pose.tailWave = 0.13;
      d.throat = 1;
      d.fx.breathEmit(dt, pt.mouth, a.aim, BREATH_FALL);
    } else {
      pose.jaw = 0.2;
      pose.pitch = BREATH_PITCH * (1 - a.k);
      pose.lower = 0.15 * (1 - a.k);
      pose.spread[0] = pose.spread[1] = a.k < 0.3 ? 1 : REST_SPREAD;
      pose.spreadRate = 2.5;
      d.throat = 0;
      if (a.k < 0.6) d.fx.mouthEmbers(dt, pt.mouth, 18, pt.headFwd);
    }
  },
  hit(d, a, dt) {
    if (a.phase !== 'active') return;
    const m = d.rig.pt.mouth;
    // debug hitboxes: a few spheres along the cone axis
    for (let i = 1; i <= 3; i++) {
      const dd = (T.breath.range * i) / 3.4;
      d.markHitbox?.(m.x + Math.sin(a.aim) * dd, 1, m.z + Math.cos(a.aim) * dd, dd * Math.tan(T.breath.halfAngle));
    }
    a.tick -= dt;
    if (a.tick > 0) return;
    a.tick += T.breath.tick;
    const p = d.game.player?.position;
    if (!p) return;
    const dx = p.x - m.x, dz = p.z - m.z;
    const dist = Math.hypot(dx, dz);
    const inCone = dist < 1.6 * S || (dist <= T.breath.range && Math.abs(angleDiff(a.aim, Math.atan2(dx, dz))) <= T.breath.halfAngle);
    // a stream: every tick is its own (blockable, unparryable) hit — it never consumes the action
    if (inCone) d.hitPlayer({ damage: T.breath.tickDamage, from: { x: m.x, z: m.z }, knockback: 0, kind: 'fire', burn: T.breath.burn, point: m }, a);
  },
  end(d, a) {
    if (a.on) {
      a.on = false;
      d.fx.breathEnd();
      d.emit('dragon:breathEnd');
    }
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ fireball volley
/** Shell flight time for a throw of `dist` metres (matches DragonFx.launchFireball). */
const MOUTH_Z = 4.3; // mouth ahead of the root while spitting (model units; measured v0.4: the short neck)
const FIREBALL_JERK = 1.1; // P2 volley: the head jerks this far (model units) toward each flank shell
const flightTime = (dist) => Math.min(1.3, Math.max(0.7, dist / 18));
const fireball = {
  name: 'fireball',
  cooldown: T.fireball.cooldown,
  phases: (d) => [
    ['windup', wind(d, T.fireball.windup)],
    ['active', d.phase === 2 ? T.fireball.activeP2 : T.fireball.active],
    ['recovery', wind(d, T.fireball.recovery)],
  ],
  // impact = the first shell landing (launched from the mouth, ~MOUTH_Z ahead of the root, at the
  // start of the active phase)
  beats: (d, a) => [beat('fireball', 0, a.list[0][1] + flightTime(Math.max(0, d.sense.dist - MOUTH_Z * S)), T.fireball, 'shell')],
  weight: (d, s) => {
    if (s.dist >= 13 * S) return T.fireball.weight * (d.phase === 2 ? 1.2 : 1);
    if (s.dist >= 10 * S && s.absAng <= 0.8) return T.fireball.weight * 0.5;
    return 0;
  },
  start(d, a) {
    a.shots = 0;
    a.count = d.phase === 2 ? 3 : 1;
    a.recoil = 0;
    a.headX = 0; // root-frame x of the spitting head: follows each P2 flank shell
    a.volley = { hitDone: false }; // the shells outlive the action: they share this hit lock
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, pt = d.rig.pt;
    a.recoil = Math.max(0, a.recoil - dt * 4);
    pose.headExact = true; // each shell leaves the mouth (launched from last frame's)
    pose.stanceF = 0.15; // forefeet planted a little wider: they absorb each spit
    pose.restep = 1;
    if (a.phase === 'windup') {
      // rears the head back high, chest puffs, throat charges
      d.turnToward(s.yawTo, d.turnRate, dt);
      pose.head = d.rootPt(pose.headTarget, 0, 5.8, 3.0);
      pose.headRate = 4;
      pose.jaw = 0.3;
      pose.look.copy(s.chest);
      pose.look.y += 4 * S;
      pose.pitch = -0.06 * a.k;
      pose.swell = a.k;
      d.throat = a.k * 0.8;
      d.fx.mouthEmbers(dt, pt.mouth, 22, pt.headFwd);
    } else if (a.phase === 'active') {
      // the head snaps forward and up with each spit (P2: centre, then toward each flank shell);
      // the front bounces up as the forelegs absorb the recoil, the wings jolt
      d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
      while (a.shots < a.count && a.t >= a.shots * 0.3) this.launch(d, a, a.shots++);
      pose.head = d.rootPt(pose.headTarget, a.headX, 5.2, 4.2);
      pose.headRate = 6;
      pose.look.copy(s.chest);
      pose.look.y += 2.5 * S;
      pose.jaw = a.recoil > 0.3 ? 1 : 0.4;
      pose.jawRate = 25;
      pose.swell = 0.5;
      d.throat = 0.8;
    } else {
      pose.jaw = 0.1;
      d.throat = 0;
    }
    if (a.recoil > 0) {
      const f = d.fwd;
      pose.headOffset.x -= f.x * a.recoil * 0.9 * S;
      pose.headOffset.z -= f.z * a.recoil * 0.9 * S;
      pose.headOffset.y += a.recoil * 0.5 * S;
      pose.pitch -= 0.07 * a.recoil;
      pose.lower -= 0.1 * a.recoil;
      pose.bodyRate = 10;
      pose.spread[0] = pose.spread[1] = REST_SPREAD + 0.14 * a.recoil;
      pose.spreadRate = 12;
    }
  },
  launch(d, a, i) {
    const s = d.sense, from = d.rig.pt.mouth;
    const flight = flightTime(s.dist);
    const t = _b.copy(s.pos).addScaledVector(s.vel, flight * 0.8);
    if (i > 0) {
      // P2 volley: flank shots bracket the player's dodge directions
      const dx = t.x - d.position.x, dz = t.z - d.position.z;
      const l = Math.hypot(dx, dz) || 1;
      const side = i === 1 ? 1 : -1;
      t.x += (-dz / l) * 4.8 * side;
      t.z += (dx / l) * 4.8 * side;
    }
    const r = Math.hypot(t.x, t.z), max = 30;
    if (r > max) t.multiplyScalar(max / r);
    t.y = 0;
    const real = d.fx.launchFireball(from, t, a.volley);
    a.recoil = 1;
    a.headX = i === 0 ? 0 : i === 1 ? -FIREBALL_JERK : FIREBALL_JERK; // shell 1 flies to the model-right flank
    // the windup only guessed the flight from the start distance: re-time the timing flash to the
    // first shell's real landing (always before the flash: flights are >= 0.7 s)
    const b = a.cur;
    if (i === 0 && real > 0 && b && !b.flashed) b.impactIn = Math.max(0.05, a.T - b.at + real);
  },
  end(d) {
    d.throat = 0;
  },
};

// ------------------------------------------------------------------ charge
const CHARGE_REACH = 6.8; // snout tip (5.65 during the run, measured v0.4) + its 1.15 hit sphere ahead of the root (model units)
const CHARGE_HEAD_RATE = 14; // head smoothing during the run (its goal leads by vel / rate: no trailing)
const ETA_STEP = 1 / 120;
/** Run speed `k` (0..1) through the active phase: 0.2 ramp-up, full, 0.2 slow-down. */
const chargeSpeed = (k) => (T.charge.distance / (T.charge.active * 0.8)) * Math.min(1, k / 0.2) * (k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1);
/**
 * Seconds from now until the snout (CHARGE_REACH ahead of the root) reaches the player: `left` s of
 * windup still to go, then the run from `te` s into the active phase. The player's radial drift is
 * extrapolated, so the timing flash stays honest against a target that keeps running.
 */
function chargeEta(d, left, te) {
  const s = d.sense, dur = T.charge.active;
  const dx = s.pos.x - d.position.x, dz = s.pos.z - d.position.z;
  const l = Math.hypot(dx, dz) || 1;
  const vr = clamp((s.vel.x * dx + s.vel.z * dz) / l, -8, 8); // + = running away
  let gap = Math.max(0, s.dist - CHARGE_REACH * S - playerR(d.game) + vr * left);
  let t = 0, x = 0, k = Math.max(0, te) / dur;
  while (x < gap && k < 1) {
    x += chargeSpeed(k) * ETA_STEP;
    gap += vr * ETA_STEP;
    t += ETA_STEP;
    k += ETA_STEP / dur;
  }
  return left + t;
}
const charge = {
  name: 'charge',
  cooldown: T.charge.cooldown,
  phases: (d) => [['windup', wind(d, T.charge.windup)], ['active', T.charge.active], ['recovery', wind(d, T.charge.recovery)]],
  // first estimate at windup start; update() refines it every frame until the flash fires
  beats: (d, a) => [beat('charge', 0, chargeEta(d, a.list[0][1], 0), T.charge, 'head')],
  weight: (d, s) => {
    if (s.dist >= 12 * S) return T.charge.weight;
    if (s.dist >= 9 * S && d.phase === 2 && s.absAng <= 0.5) return T.charge.weight * 0.6;
    return 0;
  },
  start(d, a) {
    a.v = 0;
    a.bonk = false;
    a.stopped = false;
    a.scrapes = 0;
    a.pawSide = d.sense.ang >= 0 ? 0 : 1; // the forefoot nearer the player paws the ground
  },
  enter(d, a, phase) {
    // rammed a standing stone head-first: a short stagger (a reward for baiting it)
    if (phase === 'recovery' && a.bonk) d.brain?.stagger?.();
    if (phase === 'recovery' && !a.bonk) {
      // the forefeet plant and skid: dust off both front paws
      const A2 = d.rig.pt.arms;
      for (let k = 0; k < 2; k++) d.fx.dustRing(A2[k].toe.x, A2[k].toe.z, 0.6 * S, 18, 0.9);
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense;
    // horns first like a bull: the head held low, nose tipped down toward the ground ahead
    d.rootPt(pose.look, 0, 0, 9);
    pose.lookDown = 0.6;
    if (a.phase === 'windup') {
      d.turnToward(s.yawTo, d.turnRate * 1.6, dt);
      pose.lower = 0.55;
      pose.pitch = 0.18;
      pose.head = d.rootPt(pose.headTarget, 0, 2.4, 5.0); // (5.6 is beyond the short neck)
      pose.headRate = 6;
      pose.jaw = 0.45;
      pose.tailWave = 0.15;
      pose.stanceH = 0.15;
      pose.restep = 1;
      // one forefoot paws the ground twice (an extra tell): lift, reach forward, rake back through
      // the dirt; it plants again for the run
      const ov = pose.pawOv[a.pawSide], side = a.pawSide === 0 ? 1 : -1;
      const u = clamp((a.k - 0.12) / 0.7, 0, 1);
      if (u > 0 && u < 1) {
        const ph = u * 2; // two scrapes
        const c = ph % 1;
        ov.w = 1;
        d.rootPt(ov.pos, side * 1.3, c < 0.45 ? 0.55 * Math.sin((c / 0.45) * Math.PI) : 0.04, c < 0.45 ? 2.15 + 0.7 * (c / 0.45) : 2.85 - 1.0 * ((c - 0.45) / 0.55));
        pose.pawOvRate = 18;
        if (c >= 0.45 && a.scrapes < Math.floor(ph) + 1) {
          a.scrapes = Math.floor(ph) + 1;
          d.fx.dustRing(ov.pos.x, ov.pos.z, 0.3 * S, 10, 0.4);
          d.emit('dragon:step', { x: ov.pos.x, z: ov.pos.z, heavy: false });
        }
      } else if (u >= 1 && !a.pawDone) {
        a.pawDone = true;
        d.rootPt(ov.pos, side * 1.3, 0, 1.85);
        ov.w = 1;
        pose.pawPlant[a.pawSide] = true;
      }
    } else if (a.phase === 'active') {
      const k = a.k;
      pose.headExact = true; // the snout sphere rides on the head's aim
      a.v = chargeSpeed(k);
      if (k < 0.4) d.turnToward(s.yawTo, 0.6, dt);
      const want = a.v * dt;
      const moved = d.moveForward(a.v, dt);
      if (k > 0.2 && want > 0.05 && moved < want * 0.4) {
        // slammed into a stone or the arena edge: stop; only a stone staggers
        a.bonk = Math.hypot(d.position.x, d.position.z) < d.bound - 0.5;
        a.stopped = true;
        a.t = a.dur;
      }
      // the bound: the body pitches with each stride (~2.4 Hz), head low and level, wings tucked;
      // the head goal leads by the run speed so the smoothing doesn't trail it behind the chest
      pose.lower = 0.4;
      pose.pitch = 0.15 + 0.06 * Math.sin(a.t * 15);
      pose.bodyRate = 12;
      pose.head = d.rootPt(pose.headTarget, 0, 2.3, 5.2).addScaledVector(pose.vel, 1 / CHARGE_HEAD_RATE);
      pose.headRate = CHARGE_HEAD_RATE;
      pose.jaw = 0.6;
      pose.spread[0] = pose.spread[1] = 0.22;
      pose.tailWave = 0.02;
    } else {
      // the forefeet skid to a stop, the hind legs bunch under the body
      a.v *= Math.exp(-5 * dt);
      if (a.v > 0.2) d.moveForward(a.v, dt);
      pose.lower = 0.3 * (1 - a.k);
      pose.pitch = 0.1 * (1 - a.k) - 0.08 * Math.sin(Math.PI * Math.min(1, a.k * 2));
      pose.strideH = 0.45 * (1 - a.k);
      pose.restep = 1;
      pose.jaw = 0.15;
    }
    // refine the impact estimate (from this frame's positions) until the timing flash has fired;
    // a run stopped by a stone / the arena edge brings no blow, so its flash is dropped
    const b = a.cur;
    if (b && !b.flashed) {
      if (a.stopped || a.phase === 'recovery') b.flashed = true;
      else {
        const eta = a.phase === 'windup' ? chargeEta(d, Math.max(0, a.dur - a.t), 0) : chargeEta(d, 0, a.t);
        b.impactIn = Math.max(0.05, a.T - b.at + eta);
      }
    }
  },
  hit(d, a) {
    if (a.phase !== 'active' || a.hitDone) return;
    const pt = d.rig.pt;
    if (sweepHit(d, a, 'snout', pt.snout, 1.15 * S) || sweepHit(d, a, 'chest', pt.chest, 1.7 * S)) {
      d.strike(a, { damage: T.charge.damage, knockback: T.charge.knockback, knockdown: true, kind: 'charge', from: d.position, point: pt.snout });
    }
  },
};

// ------------------------------------------------------------------ leap slam (phase 2)
const leap = {
  name: 'leap',
  cooldown: T.leap.cooldown,
  phases: (d) => [['windup', wind(d, T.leap.windup)], ['air', T.leap.air], ['recovery', wind(d, T.leap.recovery)]],
  beats: (d, a) => [beat('leap', 0, a.list[0][1] + a.list[1][1], T.leap, 'chest')],
  // the ground ring marks the predicted landing spot from the windup on
  zone(d, a, out) {
    out.copy(a.target);
    return T.leap.radius;
  },
  weight: (d, s) => (d.phase === 2 ? T.leap.weight * (s.dist >= 7 * S ? 1 : 0.35) : 0),
  start(d, a) {
    a.target = V().copy(d.sense.pos);
    a.target.y = 0;
    a.p0 = V();
    a.landed = false;
  },
  /** Landing spot = the (led) player position, kept clear of stones / inside the arena. */
  track(d, a, dt, lead) {
    const s = d.sense, g = d.game;
    _a.copy(s.pos).addScaledVector(s.vel, lead);
    const k = 1 - Math.exp(-5 * dt);
    a.target.x += (_a.x - a.target.x) * k;
    a.target.z += (_a.z - a.target.z) * k;
    const R = TUNING.radius;
    g.world?.resolve?.(a.target, R, d.bound + R);
    a.target.y = 0;
  },
  enter(d, a, phase) {
    const g = d.game;
    if (phase === 'air') {
      d.state = 'airborne';
      d.emit('dragon:takeoff');
      g.world?.gust?.(d.position.x, d.position.z, 2.0, 14 * S);
      d.fx.dustRing(d.position.x, d.position.z, 3 * S, 40, 1.2);
      g.shake?.(0.2);
      a.p0.copy(d.position);
    } else if (phase === 'recovery') this.land(d, a);
  },
  land(d, a, deal = true) {
    if (a.landed) return;
    a.landed = true;
    const g = d.game;
    d.state = 'combat';
    d.position.x = a.target.x;
    d.position.z = a.target.z;
    d.emit('dragon:land', { x: a.target.x, z: a.target.z });
    g.world?.gust?.(a.target.x, a.target.z, 2.0, 22 * S);
    g.shake?.(0.7);
    d.hitstop(0.08);
    d.fx.dustRing(a.target.x, a.target.z, 2.2 * S, 56, 1.6);
    if (!deal) return;
    d.markHitbox?.(a.target.x, 0, a.target.z, T.leap.radius);
    const p = g.player?.position;
    if (p && Math.hypot(p.x - a.target.x, p.z - a.target.z) <= T.leap.radius + playerR(g)) {
      d.strike(a, { damage: T.leap.damage, knockback: T.leap.knockback, knockdown: true, kind: 'slam', from: a.target, point: a.target });
    }
  },
  update(d, a, dt) {
    const pose = d.pose, s = d.sense, g = d.game;
    const H = T.leap.height;
    if (a.phase === 'windup') {
      // deep crouch, all four legs bunched (hind feet forward under the belly, forefeet back),
      // wings spread for the first downstroke, head toward the landing spot
      d.turnToward(s.yawTo, d.turnRate, dt);
      this.track(d, a, dt, 0);
      pose.lower = 0.75;
      pose.bodyRate = 6;
      pose.pitch = 0.05;
      pose.strideH = 0.55;
      pose.strideF = -0.45;
      pose.restep = 1;
      pose.spread[0] = pose.spread[1] = 1;
      pose.spreadRate = 5;
      pose.head = d.rootPt(pose.headTarget, 0, 3.2, 4.5);
      pose.look.copy(a.target);
    } else if (a.phase === 'air') {
      const t = a.t;
      let h;
      if (t < 0.6) h = H * easeOutCubic(t / 0.6);
      else if (t < 1.4) h = H + Math.sin((t - 0.6) * 4) * 0.3;
      else h = H * (1 - easeInCubic(clamp((t - 1.4) / 0.4, 0, 1)));
      if (t < 1.3) this.track(d, a, dt, 0.35);
      // keep the moon shadow of the body over the target while high up
      const moon = g.U?.uMoonDir?.value;
      const my = Math.max(0.2, moon?.y ?? 1);
      const ox = moon ? (-moon.x / my) * h : 0, oz = moon ? (-moon.z / my) * h : 0;
      const w = smoothstep(0, 0.6, t);
      d.position.x = a.p0.x + (a.target.x - ox - a.p0.x) * w;
      d.position.z = a.p0.z + (a.target.z - oz - a.p0.z) * w;
      d.turnToward(s.yawTo, 3, dt);
      pose.alt = h;
      pose.airborne = 1;
      const diving = t >= 1.4;
      pose.spread[0] = pose.spread[1] = diving ? 0.6 : 1;
      pose.spreadRate = 6;
      pose.flap = diving ? 0.05 : t < 0.6 ? 0.75 : 0.5;
      pose.flapHz = t < 0.6 ? 2.4 : 1.8;
      pose.pitch = diving ? 0.25 : -0.1;
      pose.bodyRate = 4;
      pose.airReach = diving ? 1 : 0; // the dive: all four legs reach down and forward, claws spread
      pose.look.copy(a.target);
      pose.tailWave = 0.04;
    } else {
      // landed (forefeet first: the body is pitched nose-down): the wings snap fully open to brake
      pose.lower = 0.6 * (1 - a.k);
      pose.spread[0] = pose.spread[1] = a.k < 0.25 ? 1 : REST_SPREAD;
      pose.spreadRate = a.k < 0.25 ? 14 : 3;
      pose.pitch = 0.1 * (1 - a.k);
      pose.jaw = a.k < 0.4 ? 0.6 : 0.1;
    }
  },
  end(d, a, interrupted) {
    if (d.state === 'airborne') {
      // killed mid-air: drop to the target (no damage); a reset() just discards the flight
      if (interrupted && a.phase === 'air' && !d.resetting) this.land(d, a, false);
      if (d.state === 'airborne') d.state = 'combat';
    }
  },
};

// ------------------------------------------------------------------ roar ring (phase 2 transition)
const R = T.roar;
/**
 * Shock-ring roar around the wyrm (red: dodge through it or get out of the ring). `phase2` = the
 * scripted transition (always P1 timings; switches the phase), otherwise the Lab ability.
 */
function makeRoar(name, phase2) {
  return {
    name,
    cooldown: 0,
    phases: (d) => [
      ['windup', phase2 ? R.windup : wind(d, R.windup)],
      ['roar', R.roar],
      ['recovery', phase2 ? R.recovery : wind(d, R.recovery)],
    ],
    beats: (d, a) => [beat('roar', 0, a.list[0][1], R, 'mouth')],
    zone(d, a, out) {
      out.copy(d.rig.pt.chest);
      out.y = 0;
      return R.radius;
    },
    weight: () => 0, // never picked by the AI: the phase-2 transition plays it
    start(d, a) {
      a.announced = false;
      if (phase2) d.enterPhase2?.();
    },
    enter(d, a, phase) {
      if (phase !== 'roar') return;
      const g = d.game;
      if (phase2) announcePhase2(d, a);
      roarFx(d, phase2 ? 1.3 : 1.1);
      const c = d.rig.pt.chest, p = g.player?.position;
      d.fx.shockRing(c.x, c.z, R.radius);
      d.markHitbox?.(c.x, 0, c.z, R.radius);
      // the forefeet stamp down with the ring
      for (const arm of d.rig.pt.arms) {
        d.fx.dustRing(arm.toe.x, arm.toe.z, 0.45 * S, 14, 0.8);
        d.emit('dragon:step', { x: arm.toe.x, z: arm.toe.z, heavy: true });
      }
      if (p && Math.hypot(p.x - c.x, p.z - c.z) <= R.radius + playerR(g)) {
        d.strike(a, { damage: R.damage, knockback: R.knockback, kind: 'roar', from: c, point: c });
      }
    },
    update(d, a, dt) {
      const pose = d.pose, s = d.sense;
      if (a.phase === 'windup') {
        // rises tall on straight forelegs, chest out and swelling, the neck lifts into a big S, the
        // throat-to-chest lava charges, wings fully spread; the forefeet lift for the stamp at the ring
        d.turnToward(s.yawTo, d.turnRate, dt);
        pose.head = d.rootPt(pose.headTarget, 0, 6.2, 2.2);
        pose.headRate = 5;
        pose.spread[0] = pose.spread[1] = 1;
        pose.spreadRate = 3;
        pose.jaw = 0.3;
        pose.pitch = -0.12;
        pose.lower = -0.15;
        pose.swell = a.k;
        pose.rear = a.k > 0.7 ? 0.3 : 0;
        pose.bodyRate = a.k > 0.7 ? 6 : 5;
        d.throat = a.k;
      } else if (a.phase === 'roar') {
        roarPose(d, a, 1);
        if (a.t < 0.25) pose.bodyRate = 16; // the lifted forefeet stamp down with the ring
        d.throat = 1;
      } else {
        pose.spreadRate = 3;
        pose.jaw = 0.1;
        d.throat = 0;
      }
    },
    end(d, a, interrupted) {
      d.throat = 0;
      // the phase already switched at start(): a Lab interruption before the roar still announces it
      if (phase2 && interrupted && !d.resetting && d.hp > 0) announcePhase2(d, a);
    },
  };
}

function announcePhase2(d, a) {
  if (a.announced) return;
  a.announced = true;
  d.emit('dragon:phase2');
  d.glowTarget = 0.5;
}

const roar = makeRoar('roar', false);
/** Scripted phase-2 transition (run by ai.js as SEQ.phase2). */
export const PHASE2_ROAR = makeRoar('phase2', true);

/** Every ability (AI-selectable and Lab-triggerable). Order = Lab list order. */
export const ATTACKS = { bite, swipe, clawCombo, tail, stomp, breath, fireball, charge, leap, roar };

/** Parryable close-range swings: a parry interrupts these with a recoil. */
export const MELEE = new Set(['bite', 'swipe', 'clawCombo']);
