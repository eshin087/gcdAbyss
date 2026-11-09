import * as THREE from 'three';
import { TUNING, SCALE } from './tuning.js';
import { TELL } from '../../combat/rules.js';
import { clamp, lerp, smoothstep, easeInOutSine, easeOutCubic, easeInCubic, turnToward, angleDiff } from '../../core/math.js';
import { FIRE } from './fireAttacks.js';

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
// AI selection (ai.js) is generic: `phase` (first phase), `weight` (number, [P1, P2, P3] or a
// function of (d, sense) that may return either), `cooldown`, `air` (usable while airborne).
// STRINGS (makeString, contract 1): multi-hit attacks built from TUNING.attacks[name].hits; each hit
// is a KIND (the performance below: claw, overhead, bite, rearBite, lungeBite, wing, tailJab,
// tailSweep, hop, stomp) with its own windup (+ optional random hold), tell, flash and hit volume.

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

/** Later phases speed up windups + recoveries (TUNING.phaseTimeScale); swings keep their speed. */
const wind = (d, base) => base * (d.tScale ?? 1);
/** A number or a per-phase array [P1, P2, P3] (the last entry covers later phases). */
export function perPhase(v, phase) {
  if (!Array.isArray(v)) return v;
  return v[clamp((phase | 0) - 1, 0, v.length - 1)];
}
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

// ------------------------------------------------------------------ shared bite (bite + string bites)
// `st` = the bite's own state ({target, goal, snapped}): the action itself for the single bite, the
// hit's scratch in a string (a string may bite twice)
function biteStart(st) {
  st.target = V();
  st.goal = V();
  st.snapped = false;
  return st;
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
function biteWindup(d, a, k, dt, reach = T.bite.reach) {
  const pose = d.pose, nb = d.rig.pt.neckBase, f = d.fwd;
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
  strikeLead(d, a, dt, reach);
}

/** The neck uncoils and the shoulders drive forward off the planted hind feet; the jaw snaps at k 0.62. */
function biteActive(d, st, k, dt, speed) {
  const pose = d.pose;
  pose.headExact = true; // the snout / head spheres ride on the head's aim
  pose.head = pose.headTarget.copy(st.goal);
  pose.look.copy(st.target);
  pose.lookDown = 1.2; // the snout aims down at the hero
  // snap speed: 18 (was 22 at x1.25) so the x1.875 head meets the hero on the announced impact
  pose.headRate = 18;
  pose.jaw = k < 0.62 ? 1 : 0;
  pose.jawRate = 30;
  pose.pitch = 0.14;
  pose.lower = 0.3;
  pose.bodyRate = 9;
  pose.stanceF = 0.25;
  pose.hindLock = true; // the hind feet push; the forelegs take a fast half-step
  d.throat = 0;
  if (speed > 0) d.moveForward(speed, dt);
  if (k >= 0.62 && !st.snapped) {
    st.snapped = true;
    d.emit('dragon:bite');
  }
}

/** Head lifts, the body rocks back onto the hind legs, the forelegs re-plant. */
function biteRecover(d, st, k) {
  const pose = d.pose;
  pose.lookDown = 1.2;
  if (k < 0.5) {
    pose.head = pose.headTarget.copy(st.goal);
    pose.head.y += 0.4 * S;
    pose.headRate = 5;
  } else pose.headRate = 3;
  pose.look.copy(st.target);
  pose.jaw = 0.1;
  pose.pitch = 0.14 * (1 - k) - 0.12 * Math.sin(Math.PI * Math.min(1, k * 1.6));
  pose.lower = 0.3 * (1 - k);
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
    if (a.phase === 'windup') biteWindup(d, a, a.k, dt);
    else if (a.phase === 'active') biteActive(d, a, a.k, dt, 3.0 * S);
    else biteRecover(d, a, a.k);
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

// ------------------------------------------------------------------ tail sweep
const TAIL_KEYS = [];
/** Cached sweep keys per tail joint (no per-frame string building). */
const tailKeys = (n) => {
  while (TAIL_KEYS.length <= n) TAIL_KEYS.push(`t${TAIL_KEYS.length}`);
  return TAIL_KEYS;
};
/** 0 = the player straight behind the wyrm .. 1 = at the flank (~80 deg off the nose). */
const tailFlank = (d) => clamp((Math.PI - d.sense.absAng) / (Math.PI - 1.4), 0, 1);
/** The sweep's spin plan (on `st`: the action, or a string hit's scratch): rotate away, then into the player. */
function tailSweepStart(d, st) {
  st.dir = d.sense.ang >= 0 ? -1 : 1; // rotate away so the tail swings INTO the player
  if (d.sense.absAng > 2.85) {
    // (nearly) straight behind, the side is a coin flip: spin from where the tail actually lies, so
    // the backswing first carries it away from him (the same choice as above everywhere else)
    const ch = d.rig.tail, mid = ch.p[Math.min(9, ch.n)];
    const rel = angleDiff(Math.atan2(mid.x - d.position.x, mid.z - d.position.z), d.sense.yawTo);
    if (Math.abs(rel) > 1e-3) st.dir = rel > 0 ? 1 : -1;
  }
  st.yaw0 = d.yaw;
  // the backswing: 0.35 rad, more for a hero (nearly) straight behind, where the resting tail already
  // lies on his bearing (the timing verifier found the sweep landing on its first active frame, 0.2 s
  // before its flash + lead, for a hero within a degree of straight behind)
  st.back = 0.35 + 0.3 * smoothstep(2.85, Math.PI, d.sense.absAng);
  st.yawW = st.yaw0 - st.dir * st.back;
  st.tailAng = undefined;
}
/** Sweep pose per stage ('windup' | 'active' | 'recovery'), k = progress in it. */
function tailSweepPose(d, st, stage, k, dt, spec) {
  const pose = d.pose;
  // the sweep's tail is the measured v0.4 chain solve (its hit spheres and swept arc ride on it)
  pose.tailLegacy = true;
  // wings folded tight through the whole sweep so the membranes stay clear of the tail
  pose.spread[0] = pose.spread[1] = stage === 'recovery' && k > 0.4 ? REST_SPREAD : 0;
  pose.spreadRate = 5;
  // the arched resting tail drops low for the sweep (the measured v0.4 tail) and lifts back after
  pose.tailLift = stage === 'recovery' && k > 0.3 ? 1 : 0;
  if (stage === 'windup') {
    // looks over its shoulder at the player (pose.look = the player's chest), crouches, the hind
    // feet brace wide, the tail coils to the opposite side (away from the player, with the body's
    // backswing: curling its tip back over a hero standing straight behind landed the sweep on the
    // first active frame, ~0.2 s before its combat:flash + flashLead)
    d.yaw = turnToward(d.yaw, st.yawW, 2.2 * dt);
    pose.lower = 0.25;
    pose.pitch = 0.08;
    pose.tailCurl = -st.dir * 0.06;
    pose.lookRate = 5;
    pose.stanceH = 0.35;
    pose.restep = 1;
    pose.speed = 3;
  } else if (stage === 'active') {
    // spins about the root, feet shuffling (gait at speed), tail stiff and whipping through, head
    // leading the turn
    const e = easeInOutSine(k);
    d.yaw = st.yawW + st.dir * (spec.spin + (st.back ?? 0.35)) * e;
    pose.tailCurl = -st.dir * 0.05;
    pose.tailStiff = 2.6;
    pose.lower = 0.3;
    pose.bodyRate = 8;
    pose.stanceH = 0.35;
    pose.speed = 6;
    pose.tailWave = 0;
    d.rootPt(pose.look, st.dir * 7, 1, 3);
  } else {
    pose.lower = 0.25 * (1 - k);
    pose.speed = 2;
  }
}
/** Sweep hit test (after the rig, every frame of the hit: the tail's angle is tracked from its windup). */
function tailSweepHit(d, a, st, spec, stage, k) {
  const chain = d.rig.tail, radii = d.model.tailRadii, keys = tailKeys(chain.n);
  // angle of the visible tail (mid segment) around the root, tracked every frame
  const mid = chain.p[Math.min(9, chain.n)];
  const ang = Math.atan2(mid.x - d.position.x, mid.z - d.position.z);
  const prevAng = st.tailAng ?? ang;
  st.tailAng = ang;
  if (a.hitDone) return;
  if (stage !== 'active' && !(stage === 'recovery' && k < 0.15)) return;
  const tip = chain.p[chain.n];
  // swept arc: the tail crossed the player's bearing this frame within its reach
  const p = d.game.player?.position;
  if (p) {
    const pd = Math.hypot(p.x - d.position.x, p.z - d.position.z);
    const delta = angleDiff(prevAng, ang);
    const rel = angleDiff(prevAng, Math.atan2(p.x - d.position.x, p.z - d.position.z));
    const tol = (0.9 * S) / Math.max(1, pd);
    const crossed = Math.abs(delta) > 1e-4 && rel * delta >= -tol * Math.abs(delta) && Math.abs(rel) <= Math.abs(delta) + tol;
    if (crossed && pd >= spec.minReach && pd <= spec.reach) {
      d.strike(a, { damage: spec.damage, knockback: spec.knockback, kind: 'tail', from: d.position, point: tip });
      return;
    }
  }
  for (let i = 4; i <= chain.n; i++) {
    const r = ((radii[Math.min(i, radii.length - 1)] ?? 0.2) + 0.4) * S;
    if (sweepHit(d, a, keys[i], chain.p[i], r)) {
      d.strike(a, { damage: spec.damage, knockback: spec.knockback, kind: 'tail', from: d.position, point: tip });
      return;
    }
  }
}
const tail = {
  name: 'tail',
  cooldown: T.tail.cooldown,
  faceAway: true, // Lab trigger turns the tail toward the player
  // (the windup's backswing needs its time: phase 3 doesn't shorten it below minWindup)
  phases: (d) => [['windup', Math.max(wind(d, T.tail.windup), T.tail.minWindup ?? 0)], ['active', T.tail.active], ['recovery', wind(d, T.tail.recovery)]],
  // the tail reaches a player at the flank later in the spin than one straight behind
  beats: (d, a) => [beat('tail', 0, a.list[0][1] + T.tail.impact + T.tail.impactFlank * tailFlank(d), T.tail, 'tailTip')],
  weight: (d, s) => {
    if (s.dist <= 9.4 * S && s.absAng >= 1.75) return T.tail.weight;
    if (s.dist <= 6.5 * S && s.absAng >= 1.2) return T.tail.weight * 0.5;
    return 0;
  },
  start(d, a) {
    tailSweepStart(d, a);
  },
  update(d, a, dt) {
    tailSweepPose(d, a, a.phase, a.k, dt, T.tail);
  },
  hit(d, a) {
    tailSweepHit(d, a, a, T.tail, a.phase, a.k);
  },
};

// ------------------------------------------------------------------ stomp (rear up + slam)
// The forefeet slam down together at (+-STOMP_X, 0, STOMP_Z) in the root frame (model units, just
// ahead of the front-paw homes): the ring is centred on their midpoint, the flash / dust sit on them.
const STOMP_Z = 2.9;
const STOMP_X = 1.2;
const _slam = V();
/**
 * Rears up on the hind legs (hips as the pivot): both forefeet leave the ground and rise to chest
 * height, claws spread; the tail presses flat (the third leg of the tripod), head high, wings flare;
 * the hind feet brace wider. The last third coils higher (anticipation).
 */
function stompWindup(d, k, dt) {
  const pose = d.pose, s = d.sense;
  d.turnToward(s.yawTo, d.turnRate * 0.6, dt);
  const coil = smoothstep(0.62, 1, k);
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
  pose.swell = k;
  pose.tailWave = 0;
  pose.tailLift = 0; // pressed flat behind: the tripod's third leg
}
/** The slam starts from wherever the rear-up holds the paws and body (`st`: the action / hit scratch). */
function stompAim(d, st) {
  const A2 = d.rig.pt.arms;
  st.paw0 = [V().copy(A2[0].toe), V().copy(A2[1].toe)];
  st.pitch0 = d.rig.s.pitch;
  st.rear0 = d.rig.s.rear;
  st.lower0 = d.rig.s.lower;
}
/**
 * Both forefeet slam down together on their landing spots, accelerating all the way so they strike
 * exactly on the impact (the end of the active, when the ring and the dust go off: they used to land
 * ~5 frames early and wait); the body pitches forward with them, the wings beat down (a gust).
 */
function stompActive(d, st, k) {
  const pose = d.pose;
  const e = k * k;
  pose.pitch = lerp(st.pitch0 ?? -0.62, 0.16, e);
  pose.rear = (st.rear0 ?? 1) * (1 - e);
  pose.lower = lerp(st.lower0 ?? -0.2, 0.15, e);
  pose.bodyRate = 60;
  for (let i = 0; i < 2; i++) {
    const ov = pose.pawOv[i];
    ov.w = 1;
    const spot = d.rootPt(_slam, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
    if (st.paw0) ov.pos.lerpVectors(st.paw0[i], spot, e);
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
}
/** The slam lands (the end of the active): shake, dust, heavy steps, the ring hit. */
function stompImpact(d, a, spec) {
  const c = d.rootPt(_a, 0, 0, STOMP_Z);
  const g = d.game;
  g.shake?.(0.45);
  g.world?.gust?.(c.x, c.z, 1.4, 13 * S);
  d.fx.dustRing(c.x, c.z, 1.5 * S, 40, 1.1);
  d.markHitbox?.(c.x, 0, c.z, spec.radius);
  // the striking forefeet: a dust burst + a heavy step where each one landed
  for (let i = 0; i < 2; i++) {
    const f = d.rootPt(_b, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
    d.fx.dustRing(f.x, f.z, 0.5 * S, 16, 0.8);
    d.emit('dragon:step', { x: f.x, z: f.z, heavy: true });
  }
  const p = g.player?.position;
  if (p && Math.hypot(p.x - c.x, p.z - c.z) <= spec.radius + playerR(g)) {
    d.strike(a, { damage: spec.damage, knockback: spec.knockback, kind: 'stomp', from: c, point: c });
  }
}
/**
 * Settle: the forefeet stay pressed into the slam spots for a beat (held by the override, so the gait
 * can't lift them), then plant there as contacts and step back home; the impact travels through the
 * body (squash), the head and the wings follow through downward, the tail slaps, then all settles.
 */
function stompRecover(d, st, k) {
  const pose = d.pose;
  const hold = k < 0.3;
  if (hold || !st.planted) {
    for (let i = 0; i < 2; i++) {
      const ov = pose.pawOv[i];
      d.rootPt(ov.pos, (i === 0 ? 1 : -1) * STOMP_X, 0, STOMP_Z);
      ov.w = 1;
      if (!hold) pose.pawPlant[i] = true;
    }
    pose.pawOvRate = 40;
    if (!hold) st.planted = true;
  }
  const sq = k < 0.1 ? k / 0.1 : Math.max(0, 1 - (k - 0.1) / 0.32);
  const ease = sq * sq * (3 - 2 * sq);
  pose.pitch = 0.08 * (1 - k) + 0.06 * ease;
  pose.bodyRate = k < 0.45 ? 9 : 3;
  pose.lower = 0.15 * (1 - k) + 0.2 * ease;
  pose.headOffset.y -= 0.7 * S * ease;
  pose.headRate = k < 0.45 ? 8 : 4;
  pose.spread[0] = pose.spread[1] = REST_SPREAD - 0.18 * ease;
  pose.spreadRate = k < 0.3 ? 10 : 3;
  pose.tailWave = 0.07 + 0.08 * ease;
  // the tail stays down through the slam's squash and lifts back to its arch once the body settles
  // (lifting while the slam whipped the chain into the ground folded it)
  pose.tailLift = k < 0.5 ? 0 : 1;
  pose.restep = hold ? 0 : 1;
  pose.jaw = 0.1 + 0.25 * ease;
}
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
    if (phase === 'active') stompAim(d, a);
    else if (phase === 'recovery') stompImpact(d, a, T.stomp);
  },
  update(d, a, dt) {
    if (a.phase === 'windup') stompWindup(d, a.k, dt);
    else if (a.phase === 'active') stompActive(d, a, a.k);
    else stompRecover(d, a, a.k);
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
    ['active', d.phase >= 2 ? T.breath.activeP2 : T.breath.active],
    ['recovery', wind(d, T.breath.recovery)],
  ],
  beats: (d, a) => [beat('breath', 0, a.list[0][1], T.breath, 'mouth')],
  weight: (d, s) => (s.dist >= 6 * S && s.dist <= 16 * S && s.absAng <= 1.0 ? perPhase(T.breath.weight, d.phase) : 0),
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
      a.aim0 = center - (d.phase >= 2 ? (a.side * T.breath.sweepP2) / 2 : 0);
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
      if (d.phase >= 2) a.aim = a.aim0 + a.side * T.breath.sweepP2 * a.k;
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
    ['active', d.phase >= 2 ? T.fireball.activeP2 : T.fireball.active],
    ['recovery', wind(d, T.fireball.recovery)],
  ],
  // impact = the first shell landing (launched from the mouth, ~MOUTH_Z ahead of the root, at the
  // start of the active phase)
  beats: (d, a) => [beat('fireball', 0, a.list[0][1] + flightTime(Math.max(0, d.sense.dist - MOUTH_Z * S)), T.fireball, 'shell')],
  weight: (d, s) => {
    if (s.dist >= 13 * S) return perPhase(T.fireball.weight, d.phase);
    if (s.dist >= 10 * S && s.absAng <= 0.8) return perPhase(T.fireball.weight, 1) * 0.5;
    return 0;
  },
  start(d, a) {
    a.shots = 0;
    a.count = d.phase >= 2 ? 3 : 1;
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
    if (s.dist >= 9 * S && d.phase >= 2 && s.absAng <= 0.5) return T.charge.weight * 0.6;
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
  weight: (d, s) => (d.phase >= 2 ? T.leap.weight * (s.dist >= 7 * S ? 1 : 0.35) : 0),
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
      // killed mid-air: drop to the target (no damage); a reset() just discards the flight; a plunge
      // crash (d.crashing) falls from where it is (ai.js SEQ.plunged)
      if (interrupted && a.phase === 'air' && !d.resetting && !d.crashing) this.land(d, a, false);
      if (d.state === 'airborne' && !d.crashing) d.state = 'combat';
    }
  },
};

// ------------------------------------------------------------------ roar ring (phase transitions)
const R = T.roar;
/**
 * Shock-ring roar around the wyrm (red: dodge through it or get out of the ring). `toPhase` 2 / 3 =
 * the scripted phase transition (always P1 timings; switches the phase, clears the hazards), 0 = the
 * Lab ability.
 */
function makeRoar(name, toPhase = 0) {
  const scripted = toPhase > 0;
  return {
    name,
    cooldown: 0,
    phases: (d) => [
      ['windup', scripted ? R.windup : wind(d, R.windup)],
      ['roar', R.roar],
      ['recovery', scripted ? R.recovery : wind(d, R.recovery)],
    ],
    beats: (d, a) => [beat('roar', 0, a.list[0][1], R, 'mouth')],
    zone(d, a, out) {
      out.copy(d.rig.pt.chest);
      out.y = 0;
      return R.radius;
    },
    weight: () => 0, // never picked by the AI: the phase transitions play it
    start(d, a) {
      a.announced = false;
      if (!scripted) return;
      d.enterPhase?.(toPhase);
      // the transition sweeps the field: meteors, fire walls and lava pillars die with the roar
      try {
        d.hazards?.clear?.();
      } catch (err) {
        console.error('[dragon] hazards.clear failed', err);
      }
    },
    enter(d, a, phase) {
      if (phase !== 'roar') return;
      const g = d.game;
      if (scripted) announcePhase(d, a, toPhase);
      roarFx(d, toPhase === 3 ? 1.5 : scripted ? 1.3 : 1.1);
      const c = d.rig.pt.chest, p = g.player?.position;
      d.fx.shockRing(c.x, c.z, R.radius);
      d.markHitbox?.(c.x, 0, c.z, R.radius);
      // the forefeet stamp down with the ring
      for (const arm of d.rig.pt.arms) {
        d.fx.dustRing(arm.toe.x, arm.toe.z, 0.45 * S, 14, 0.8);
        d.emit('dragon:step', { x: arm.toe.x, z: arm.toe.z, heavy: true });
      }
      if (toPhase === 3) {
        // phase 3: the heart catches: a burst of embers from the whole body with the roar
        d.fx.bodyEmbers(0.25, d.hurtSpheres, 240, true);
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
        if (toPhase === 3) d.fx.mouthEmbers(dt, d.rig.pt.mouth, 40 * a.k, d.rig.pt.headFwd);
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
      if (scripted && interrupted && !d.resetting && d.hp > 0) announcePhase(d, a, toPhase);
      // phase 3 opens with the inferno nova (dragon-fire's ATTACKS.nova) when the fight runs itself
      if (toPhase === 3 && !interrupted && d.hp > 0 && d.brain?.aiEnabled && ATTACKS.nova && !d.brain.queued) d.brain.queued = ATTACKS.nova;
    },
  };
}

/** 'dragon:phase2' / 'dragon:phase3' + 'dragon:phase {n}' once per transition; the wyrm heats up. */
function announcePhase(d, a, n) {
  if (a.announced) return;
  a.announced = true;
  d.emit(n >= 3 ? 'dragon:phase3' : 'dragon:phase2');
  d.emit('dragon:phase', { n });
  d.glowTarget = perPhase(TUNING.phaseGlow, n) ?? 0.5;
}

const roar = makeRoar('roar', 0);
/** Scripted phase transitions (run by ai.js as SEQ.phase2 / SEQ.phase3). */
export const PHASE2_ROAR = makeRoar('phase2', 2);
export const PHASE3_ROAR = makeRoar('phase3', 3);

// ================================================================== STRINGS (contract 1)
// A string is an attack made of N hits (TUNING.attacks[name].hits). Its phase list is built at the
// start: per hit ['windup' / 'windupN', windup x phaseTimeScale + a random hold, hit] and
// ['active' / 'activeN', active, hit], then ['recovery', ..., null]. A hit with `chance` < 1 may be
// rolled out. Every realized hit gets a beat (combat:tell at its windup start, combat:flash
// flashLead s before its impact) and the hit's own tell / parry data. Each hit's KIND performs it:
//   part            striking part for the tell flash (Dragon.partPos; `wi` picks a paw / wing)
//   init(d, a, h)   once at the string's start (per-hit scratch on h)
//   enterWindup     at the hit's windup start (before its combat:tell: may re-time a.beats[h.idx])
//   windup(d, a, h, k, dt)   k = progress over the base windup (held at 1 through the hold; h.holdK
//                            = progress through the hold)
//   aim(d, a, h)    when its active starts (lock the target)
//   active(d, a, h, k, dt)
//   endActive(d, a, h)       the active just ended (slams that land at the end: stomp, hop)
//   recover(d, a, h, k, dt)  blended into the next hit's windup (first half), or the string's recovery
//   hit(d, a, h, stage, k, dt)   after the rig, every frame of the hit (stage windup / active / recovery)
//   zone(d, a, h, out)       red AoE ring (centre in out, returns the radius)
//   noBreakActive   a posture break / stagger waits until this hit's active is over (mid-air hop)
// A parried hit that is not the last one does not cancel the string (Dragon.onParried: the deflect
// chain); the last one recoils the wyrm.

const _h = V(), _h2 = V();
/** World point -> root frame (model units) x / z. */
function toRootXZ(d, p, out) {
  const dx = p.x - d.position.x, dz = p.z - d.position.z, c = Math.cos(d.yaw), sn = Math.sin(d.yaw);
  out.x = (dx * c - dz * sn) / S;
  out.z = (dx * sn + dz * c) / S;
  return out;
}
const _rxz = { x: 0, z: 0 };

// ---- claw: the foreleg rake (swipe performance), from the side `spec.side` x the hero's side
const CLAW = {
  part: 'claw',
  init(d, a, h) {
    h.w = swipeCurve((h.spec.side ?? 1) * a.side0);
    h.wi = h.w.wi;
  },
  windup(d, a, h, k, dt) {
    swipeWindup(d, h.w, k, dt, h.spec.turn ?? 0.5);
    if (h.holdK > 0) {
      // a delayed claw: the cocked paw lifts a little higher and trembles, the head lowers to watch
      const ov = d.pose.pawOv[h.wi], e = smoothstep(0, 0.35, h.holdK);
      ov.pos.y += (0.35 * e + Math.sin(d.time * 29) * 0.05 * e) * S;
      d.pose.jaw = 0.15;
      d.pose.lower += 0.08 * e;
    }
  },
  active(d, a, h, k, dt) {
    swipeActive(d, h.w, k, dt, a.dur);
  },
  recover(d, a, h, k) {
    swipeRecover(d, h.w, k);
  },
  hit(d, a, h, stage) {
    if (stage === 'active') swipeHit(d, a, h.w, h.spec);
  },
};

// ---- overhead: the paw raised high over the shoulder, then smashed straight down onto the hero
const OVH_RAISE = [1.15, 5.0, 2.8]; // root frame (x mirrored by side): the raised paw
const OVH_REACH = 4.2; // model units ahead of the root a planted foreleg smashes without a lunge
const OVERHEAD = {
  part: 'claw',
  init(d, a, h) {
    h.w = swipeCurve((h.spec.side ?? 1) * a.side0);
    h.wi = h.w.wi;
    h.p0 = V();
    h.slam = V();
    h.p1 = V();
    h.lungeV = 0;
    h.plant = null;
    h.planted = false;
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose, side = h.w.side, ov = pose.pawOv[h.wi];
    d.turnToward(d.sense.yawTo - side * 0.2, d.turnRate * 0.8, dt);
    ov.w = 1;
    // up out of the stance beside the chest, then high over the shoulder, claws spread; the chest
    // lifts and twists toward the raised paw, the weight shifts onto the other three legs
    const e = smoothstep(0, 0.7, k);
    d.rootPt(ov.pos, side * lerp(1.4, OVH_RAISE[0], e), lerp(0.6, OVH_RAISE[1], e) + 0.25 * Math.sin(k * Math.PI), lerp(2.3, OVH_RAISE[2], e));
    pose.pawOvRate = 7;
    pose.pitch = -0.14 * e;
    pose.lower = -0.1 * e;
    pose.roll = side * 0.08 * e;
    pose.twist = side * 0.18 * e;
    pose.spread[h.wi] = 0.72;
    pose.spread[1 - h.wi] = 0.45;
    pose.spreadRate = 5;
    pose.jaw = 0.4 + 0.25 * e;
    pose.stanceF = 0.15;
    pose.restep = 1;
  },
  aim(d, a, h) {
    // lock the smash point: the hero's spot (led a little) pulled into the paw's band in the root
    // frame; a far hero gets a short lunge (spec.lunge model units at most)
    const s = d.sense, side = h.w.side;
    _h.copy(s.pos).addScaledVector(s.vel, 0.1);
    const r = toRootXZ(d, _h, _rxz);
    const lx = clamp(r.x, side > 0 ? -0.8 : -2.0, side > 0 ? 2.0 : 0.8);
    const travel = clamp(r.z - OVH_REACH, 0, h.spec.lunge ?? 0);
    const lz = clamp(r.z, 3.0, OVH_REACH + travel);
    d.rootPt(h.slam, lx, 0.3, lz);
    // the arc's top: above the raised paw, a third of the way to the smash point
    d.rootPt(h.p1, lerp(side * OVH_RAISE[0], lx, 0.35), OVH_RAISE[1] + 0.9, lerp(OVH_RAISE[2], lz, 0.35));
    h.p0.copy(d.rig.pt.arms[h.wi].toe);
    h.lungeV = (travel * S) / Math.max(0.05, a.dur);
  },
  active(d, a, h, k, dt) {
    const pose = d.pose, side = h.w.side, ov = pose.pawOv[h.wi];
    ov.w = 1;
    // over the top and down, accelerating into the ground
    const u = k * k;
    const iu = 1 - u;
    ov.pos.set(
      iu * iu * h.p0.x + 2 * iu * u * h.p1.x + u * u * h.slam.x,
      iu * iu * h.p0.y + 2 * iu * u * h.p1.y + u * u * h.slam.y,
      iu * iu * h.p0.z + 2 * iu * u * h.p1.z + u * u * h.slam.z,
    );
    pose.pawOvRate = 45;
    pose.pitch = lerp(-0.14, 0.24, u);
    pose.lower = lerp(-0.1, 0.32, u);
    pose.roll = -side * 0.1 * u;
    pose.twist = side * 0.32;
    pose.bodyRate = 10;
    pose.spread[h.wi] = 0.5;
    pose.jaw = 0.75;
    if (h.lungeV > 0) d.moveForward(h.lungeV, dt);
  },
  endActive(d, a, h) {
    // the claws bite into the ground: a heavy dust burst, the paw plants there
    h.plant = d.rig.clampPaw(h.wi, V().copy(h.slam));
    d.fx.dustRing(h.plant.x, h.plant.z, 0.7 * S, 22, 0.9);
    d.emit('dragon:step', { x: h.plant.x, z: h.plant.z, heavy: true });
    d.game.shake?.(0.22);
  },
  recover(d, a, h, k) {
    const pose = d.pose, ov = pose.pawOv[h.wi];
    if (h.plant && !h.planted) {
      ov.w = 1;
      ov.pos.copy(h.plant);
      pose.pawOvRate = 30;
      if (k > 0.15) {
        h.planted = true;
        pose.pawPlant[h.wi] = true;
      }
    }
    pose.twist = h.w.side * 0.2 * (1 - k);
    pose.lower = 0.3 * (1 - k);
    pose.pitch = 0.2 * (1 - k);
    if (h.planted) pose.restep = 1;
  },
  hit(d, a, h, stage) {
    if (stage === 'active') swipeHit(d, a, h.w, h.spec);
  },
};

// ---- bite (the single bite's performance)
const BITE = {
  part: 'snout',
  init(d, a, h) {
    h.st = biteStart({});
  },
  windup(d, a, h, k, dt) {
    biteWindup(d, a, k, dt, h.spec.reach ?? T.bite.reach);
  },
  aim(d, a, h) {
    biteAim(d, h.st, h.spec.reach ?? T.bite.reach);
  },
  active(d, a, h, k, dt) {
    biteActive(d, h.st, k, dt, 3.0 * S);
  },
  recover(d, a, h, k) {
    biteRecover(d, h.st, k);
  },
  hit(d, a, h, stage) {
    if (stage === 'active') biteHit(d, a, h.spec);
  },
};

// ---- rearBite: the head rears high and back, holds (the hesitation: a slow weave, the jaw
// quivering), then snaps
const REAR_BITE = {
  part: 'snout',
  init(d, a, h) {
    h.st = biteStart({});
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose, nb = d.rig.pt.neckBase, f = d.fwd;
    d.turnToward(d.sense.yawTo, d.turnRate * 1.1, dt);
    const e = smoothstep(0, 0.85, k);
    // higher and further back than the bite's coil: the neck stands up over the withers
    const fw = lerp(0.9, 0.15, e) * S, up = lerp(1.95, 2.75, e) * S;
    pose.head = pose.headTarget.set(nb.x + f.x * fw, nb.y + up, nb.z + f.z * fw);
    pose.headRate = 5;
    pose.lookDown = 0.9;
    pose.jaw = 0.25 + 0.35 * e;
    pose.lower = -0.06 * e;
    pose.pitch = -0.1 * e;
    pose.swell = 0.6 * e;
    pose.stanceF = 0.25;
    pose.restep = 1;
    pose.spread[0] = pose.spread[1] = REST_SPREAD + 0.16 * e;
    pose.spreadRate = 5;
    d.throat = 0.4 * e;
    if (h.holdK > 0) {
      // the hesitation: the reared head weaves slowly side to side, the jaw quivers
      const w = smoothstep(0, 0.25, h.holdK);
      const sw = Math.sin(d.time * 3.4) * 0.3 * S * w;
      pose.headOffset.x += f.z * sw;
      pose.headOffset.z -= f.x * sw;
      pose.headOffset.y += Math.sin(d.time * 5.3) * 0.08 * S * w;
      pose.jaw += Math.sin(d.time * 27) * 0.06 * w;
    }
    strikeLead(d, a, dt, h.spec.reach ?? T.bite.reach);
  },
  aim: BITE.aim,
  active: BITE.active,
  recover: BITE.recover,
  hit: BITE.hit,
};

// ---- lungeBite: sits back onto its haunches (both forefeet planted, head drawn up and back, both
// wings pulse), then a lunging bite that closes up to spec.lunge (the claw combo's finisher)
const LUNGE_BITE = {
  part: 'snout',
  init(d, a, h) {
    h.st = biteStart({});
    h.lungeV = 0;
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose;
    d.turnToward(d.sense.yawTo, d.turnRate * 1.4, dt);
    pose.head = d.rootPt(pose.headTarget, 0, 4.7, 1.7);
    pose.headRate = 6;
    pose.jaw = 0.35 + 0.3 * k;
    pose.pitch = -0.1;
    pose.lower = 0.05;
    pose.strideH = 0.35; // hind feet under the haunches: the spring of the lunge
    pose.restep = 1;
    pose.spread[0] = pose.spread[1] = REST_SPREAD + 0.12 * Math.sin(Math.PI * k);
    pose.spreadRate = 8;
    d.throat = 0.25 * k;
    strikeLead(d, a, dt, h.spec.reach);
  },
  aim(d, a, h) {
    biteAim(d, h.st, h.spec.reach);
    // close the gap: travel up to spec.lunge so the snout ends at the player
    const travel = clamp(d.sense.dist - h.spec.reach * 0.75, 0, h.spec.lunge);
    h.lungeV = travel / Math.max(0.05, a.dur);
  },
  active(d, a, h, k, dt) {
    biteActive(d, h.st, k, dt, h.lungeV);
  },
  recover: BITE.recover,
  hit: BITE.hit,
};

/** Drive the rig's flap phase to `ph` this frame (pose fields only: flap amplitude + flapHz). */
function flapTo(d, ph, amp, dt) {
  const pose = d.pose, s = d.rig.s;
  pose.flap = amp;
  pose.flapHz = dt > 1e-5 ? (ph - (s.flapPhase ?? 0)) / (dt * Math.PI * 2) : 0;
}
// ---- wing: the buffet. The struck wing half-opens (its fingers fan out and FORWARD) and rises to
// the top of a beat while the body turns that flank to the hero and leans away; then the wing crashes
// down beside it (one full downstroke of the rig's flap, pose fields only), the body rolling into the
// blow: the fingers rake the ground out to the side and ahead (a gust shoves)
const WING = {
  part: 'wing',
  init(d, a, h) {
    h.side = (h.spec.side ?? 1) * a.side0;
    h.wi = h.side > 0 ? 0 : 1;
    h.ph0 = 0;
    h.top = 0;
    h.yaw0 = 0;
  },
  enterWindup(d, a, h) {
    // from wherever the beat stands now to the nearest top of the stroke (sin = 1)
    const ph = d.rig.s.flapPhase;
    h.ph0 = Number.isFinite(ph) ? ph : 0;
    h.top = h.ph0 + angleDiff(h.ph0, Math.PI / 2);
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose, side = h.side, W = h.spec;
    // the struck flank turns to the hero; the second hit pivots hard (the other wing comes round)
    d.turnToward(d.sense.yawTo - side * (W.face ?? 1.15), d.turnRate * (h.idx > 0 ? 2.6 : 1.5), dt);
    pose.speed = Math.max(pose.speed, 2);
    pose.spread[h.wi] = W.spread ?? 0.55;
    pose.spread[1 - h.wi] = 0.3;
    pose.spreadRate = 6;
    // the wing rises to the top of the beat and holds there, cocked: the chest twists away (the wing
    // swings back), the body leans away from it
    const e = smoothstep(0, 0.8, k);
    flapTo(d, lerp(h.ph0, h.top, e), W.amp ?? 0.8, dt);
    pose.roll = -side * 0.12 * e;
    pose.twist = side * (W.twistBack ?? 0.3) * e;
    pose.lower = 0.05 * e;
    pose.pitch = -0.05 * e;
    pose.jaw = 0.35 + 0.25 * e;
    pose.stanceH = 0.3;
    pose.restep = 1;
    if (h.holdK > 0) pose.headOffset.y += Math.sin(d.time * 6) * 0.06 * S;
  },
  aim(d, a, h) {
    h.yaw0 = d.yaw;
  },
  active(d, a, h, k, dt) {
    const pose = d.pose, side = h.side, W = h.spec;
    pose.spread[h.wi] = W.spread ?? 0.55;
    pose.spread[1 - h.wi] = 0.3;
    pose.spreadRate = 6;
    // the downstroke accelerates through half a beat (top -> bottom) while the chest twists the wing
    // forward through the hero's side; the body rolls into it and drops
    const u = k * k;
    flapTo(d, h.top + Math.PI * u, W.amp ?? 0.8, dt);
    d.yaw = h.yaw0 - side * (W.turn ?? 0.15) * u;
    pose.roll = lerp(-0.12, W.roll ?? 0.26, u) * side;
    pose.twist = side * lerp(W.twistBack ?? 0.3, -(W.twist ?? 0.6), smoothstep(0, 0.8, k));
    pose.lower = 0.05 + 0.3 * u;
    pose.pitch = 0.08 * u;
    pose.bodyRate = 12;
    pose.jaw = 0.75;
    pose.stanceH = 0.3;
  },
  endActive(d, a, h) {
    // the gust off the downstroke: dust where the fingers hit the ground, a shove
    const w = d.rig.pt.wings[h.wi];
    for (let i = 1; i < 3; i++) d.fx.dustRing(w.tips[i].x, w.tips[i].z, 0.7 * S, 16, 0.9);
    d.game.world?.gust?.(w.knuckles[1].x, w.knuckles[1].z, 1.8, 10 * S);
    d.game.shake?.(0.2);
  },
  recover(d, a, h, k) {
    // the wing rides back up as the beat dies (its phase held at the bottom)
    const pose = d.pose;
    pose.flap = 0;
    pose.flapHz = 0;
    pose.spread[h.wi] = k < 0.5 ? h.spec.spread ?? 0.55 : REST_SPREAD;
    pose.spreadRate = 3;
    pose.roll = h.side * (h.spec.roll ?? 0.26) * (1 - k);
    pose.lower = 0.35 * (1 - k);
  },
  hit(d, a, h, stage) {
    if (stage !== 'active' || a.hitDone) return;
    const w = d.rig.pt.wings[h.wi];
    // the wing's bones: wrist, the four knuckles, the middle of the three outer fingers and their
    // tips (the membrane spans them)
    let hit = sweepHit(d, a, 'ww', w.wrist, 0.75 * S);
    for (let i = 0; i < 4 && !hit; i++) hit = sweepHit(d, a, WING_KEYS_K[i], w.knuckles[i], 0.7 * S);
    for (let i = 0; i < 4 && !hit; i++) hit = sweepHit(d, a, WING_KEYS_M[i], _h.lerpVectors(w.knuckles[i], w.tips[i], 0.5), 0.65 * S);
    for (let i = 0; i < 4 && !hit; i++) hit = sweepHit(d, a, WING_KEYS_T[i], w.tips[i], 0.55 * S);
    if (hit) d.strike(a, { damage: h.spec.damage, knockback: h.spec.knockback, kind: 'wing', from: d.rig.pt.chest, point: w.knuckles[1] });
  },
};
const WING_KEYS_K = ['wk0', 'wk1', 'wk2', 'wk3'];
const WING_KEYS_M = ['wm0', 'wm1', 'wm2', 'wm3'];
const WING_KEYS_T = ['wt0', 'wt1', 'wt2', 'wt3'];

// ---- tailJab: the pivot and a short, sharp lash. The windup turns its back on the hero (the feet
// trot it round) and stops with the tail `offset` rad short of him, coiled low and stiff; the active
// snaps the tail through him (a short spin, the hips thrusting back) and past. The hit is the sweep's
// (swept arc + tail spheres: tailSweepHit), so it lands when the tail crosses him.
const TAIL_JAB = {
  part: 'tailTip',
  init(d, a, h) {
    h.st = { dir: 1, yawW: 0, tailAng: undefined };
    h.v = 0;
  },
  enterWindup(d, a, h) {
    // the lash comes from the side the hero stands on (the pivot turns that way)
    h.st.dir = d.sense.ang >= 0 ? 1 : -1;
    h.st.tailAng = undefined;
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose, st = h.st, off = h.spec.offset ?? 0.6;
    // the pivot: its back to the hero, the tail stopping `off` short of him. Its speed is capped (rad/s,
    // not the phase's turn rate): a faster spin flung the trailing tail past its stop, onto him
    d.turnToward(d.sense.yawTo + Math.PI + st.dir * off, h.spec.pivotRate ?? 4.0, dt);
    pose.speed = Math.max(pose.speed, 3.5);
    pose.tailLegacy = true;
    pose.tailLift = 0;
    pose.tailCurl = st.dir * 0.05; // coiled toward the side it will lash from
    pose.tailStiff = 1.6;
    pose.tailWave = 0;
    const e = smoothstep(0.4, 1, k);
    pose.lower = 0.25 * e;
    pose.pitch = 0.1 * e;
    pose.stanceH = 0.35;
    pose.restep = 1;
    pose.spread[0] = pose.spread[1] = 0; // folded tight: the membranes clear the tail
    pose.spreadRate = 5;
    pose.lookRate = 6; // it looks back over its shoulder at the hero
  },
  aim(d, a, h) {
    h.st.yawW = d.yaw;
    h.v = ((h.spec.lunge ?? 0) * S) / Math.max(0.05, a.dur);
  },
  active(d, a, h, k, dt) {
    const pose = d.pose, st = h.st, off = h.spec.offset ?? 0.6;
    // the lash: a short, fast spin back through the hero's bearing (and `past` beyond it)
    d.yaw = st.yawW - st.dir * (off + (h.spec.past ?? 0.45)) * easeInOutSine(k);
    pose.tailLegacy = true;
    pose.tailLift = 0;
    pose.tailCurl = -st.dir * 0.05;
    pose.tailStiff = 2.8;
    pose.tailWave = 0;
    pose.lower = 0.3;
    pose.pitch = 0.14;
    pose.bodyRate = 10;
    pose.stanceH = 0.35;
    pose.speed = 6;
    pose.spread[0] = pose.spread[1] = 0;
    // the hips thrust back into it
    if (h.v > 0) d.moveForward(-h.v * 2 * (1 - k), dt);
  },
  recover(d, a, h, k) {
    const pose = d.pose;
    pose.tailLegacy = true;
    pose.tailLift = k > 0.5 ? 1 : 0;
    pose.lower = 0.3 * (1 - k);
    pose.pitch = 0.14 * (1 - k);
    pose.spread[0] = pose.spread[1] = 0;
  },
  hit(d, a, h, stage, k) {
    tailSweepHit(d, a, h.st, h.spec, stage, k);
  },
};

// ---- tailSweep: the tail sweep's spin as a string hit (its plan is made at its own windup start)
const TAIL_SWEEP = {
  part: 'tailTip',
  init(d, a, h) {
    h.st = {};
  },
  enterWindup(d, a, h) {
    tailSweepStart(d, h.st);
    // re-time this hit's flash from where the hero stands now (behind vs at the flank)
    const b = a.beats?.[h.idx];
    if (b && !b.told) b.impactIn = Math.max(0.05, a.dur + h.spec.impact + (h.spec.impactFlank ?? 0) * tailFlank(d));
  },
  windup(d, a, h, k, dt) {
    tailSweepPose(d, h.st, 'windup', k, dt, h.spec);
  },
  active(d, a, h, k, dt) {
    tailSweepPose(d, h.st, 'active', k, dt, h.spec);
  },
  recover(d, a, h, k, dt) {
    tailSweepPose(d, h.st, 'recovery', k, dt, h.spec);
  },
  hit(d, a, h, stage, k) {
    tailSweepHit(d, a, h.st, h.spec, stage, k);
  },
};

// ---- hop: the pounce. A crouch that tracks the hero, a short hop (red ring where the forefeet come
// down), the landing slam
const HOP_Z = 2.9; // the forefeet land this far ahead of the root (model units), like the stomp
function hopTrack(d, h, k) {
  const s = d.sense, g = d.game;
  _h.copy(s.pos);
  _h.y = 0;
  // where the root must land so the forefeet come down on the hero
  const dx = _h.x - d.position.x, dz = _h.z - d.position.z, l = Math.hypot(dx, dz) || 1;
  const reach = Math.min(l - HOP_Z * S, (h.spec.maxHop ?? 10) * S);
  _h2.set(d.position.x + (dx / l) * Math.max(0, reach), 0, d.position.z + (dz / l) * Math.max(0, reach));
  const R2 = TUNING.radius;
  g.world?.resolve?.(_h2, R2, d.bound + R2);
  _h2.y = 0;
  if (k >= 1) h.root.copy(_h2);
  else {
    h.root.x += (_h2.x - h.root.x) * k;
    h.root.z += (_h2.z - h.root.z) * k;
  }
  // the ring: where the forefeet land, on the line from the root to the hero
  const rx = _h.x - h.root.x, rz = _h.z - h.root.z, rl = Math.hypot(rx, rz) || 1;
  h.ring.set(h.root.x + (rx / rl) * HOP_Z * S, 0, h.root.z + (rz / rl) * HOP_Z * S);
}
const HOP = {
  part: 'forefeet',
  noBreakActive: true,
  init(d, a, h) {
    h.root = V();
    h.ring = V();
    h.p0 = V();
    h.landed = false;
  },
  zone(d, a, h, out) {
    out.copy(h.ring);
    return h.spec.radius;
  },
  enterWindup(d, a, h) {
    hopTrack(d, h, 1);
  },
  windup(d, a, h, k, dt) {
    const pose = d.pose;
    hopTrack(d, h, 1 - Math.exp(-5 * dt));
    d.turnToward(Math.atan2(h.ring.x - d.position.x, h.ring.z - d.position.z), d.turnRate * 1.6, dt);
    // the crouch: legs bunched under it, wings half open for the spring, head low toward the hero
    const e = smoothstep(0, 0.7, k);
    pose.lower = 0.62 * e;
    pose.bodyRate = 6;
    pose.pitch = 0.08 * e;
    pose.strideH = 0.5 * e;
    pose.strideF = -0.35 * e;
    pose.restep = 1;
    pose.spread[0] = pose.spread[1] = 0.5 + 0.35 * e;
    pose.spreadRate = 5;
    pose.head = d.rootPt(pose.headTarget, 0, 3.3, 4.4);
    pose.headRate = 5;
    pose.jaw = 0.45;
    pose.look.copy(h.ring);
  },
  aim(d, a, h) {
    h.p0.copy(d.position);
    h.p0.y = 0;
    d.emit('dragon:takeoff');
    d.fx.dustRing(d.position.x, d.position.z, 1.6 * S, 26, 0.9);
    d.game.world?.gust?.(d.position.x, d.position.z, 1.2, 10 * S);
  },
  active(d, a, h, k, dt) {
    const pose = d.pose;
    // the landing follows the hero through the first half of the hop, then it is committed
    if (k < 0.45) hopTrack(d, h, 1 - Math.exp(-4 * dt));
    const w = smoothstep(0, 1, k);
    d.position.x = h.p0.x + (h.root.x - h.p0.x) * w;
    d.position.z = h.p0.z + (h.root.z - h.p0.z) * w;
    d.turnToward(Math.atan2(h.ring.x - d.position.x, h.ring.z - d.position.z), 4, dt);
    // a short arc (the rig's altitude lags a little: the curve lands a beat early)
    const u = Math.min(1, k * 1.1);
    pose.alt = (h.spec.height ?? 4) * 4 * u * (1 - u);
    pose.airborne = k < 0.6 ? 1 : 0;
    pose.airReach = k > 0.45 ? 1 : 0;
    pose.spread[0] = pose.spread[1] = k < 0.5 ? 1 : 0.7;
    pose.spreadRate = 8;
    pose.flap = k < 0.4 ? 0.5 : 0;
    pose.flapHz = 2.2;
    pose.pitch = lerp(-0.12, 0.22, k);
    pose.bodyRate = 6;
    pose.jaw = 0.7;
    pose.look.copy(h.ring);
  },
  endActive(d, a, h) {
    // the forefeet slam down on the ring: shake, dust, heavy steps, the hit
    if (h.landed) return;
    h.landed = true;
    const g = d.game;
    d.position.x = h.root.x;
    d.position.z = h.root.z;
    d.emit('dragon:land', { x: h.ring.x, z: h.ring.z });
    g.shake?.(0.5);
    g.world?.gust?.(h.ring.x, h.ring.z, 1.6, 14 * S);
    d.fx.dustRing(h.ring.x, h.ring.z, 1.6 * S, 44, 1.2);
    d.markHitbox?.(h.ring.x, 0, h.ring.z, h.spec.radius);
    const p = g.player?.position;
    if (p && Math.hypot(p.x - h.ring.x, p.z - h.ring.z) <= h.spec.radius + playerR(g)) {
      d.strike(a, { damage: h.spec.damage, knockback: h.spec.knockback, knockdown: !!h.spec.knockdown, kind: 'slam', from: h.ring, point: h.ring });
    }
  },
  recover(d, a, h, k) {
    const pose = d.pose;
    pose.lower = 0.5 * (1 - k);
    pose.pitch = 0.16 * (1 - k);
    pose.spread[0] = pose.spread[1] = k < 0.4 ? 0.8 : REST_SPREAD;
    pose.spreadRate = 4;
    pose.restep = 1;
  },
};

// ---- stomp: the rear-up slam as a string hit (the frenzy's finisher)
const STOMP = {
  part: 'forefeet',
  init(d, a, h) {
    h.st = {};
  },
  zone(d, a, h, out) {
    d.rootPt(out, 0, 0, STOMP_Z);
    return h.spec.radius ?? T.stomp.radius;
  },
  windup(d, a, h, k, dt) {
    stompWindup(d, k, dt);
  },
  aim(d, a, h) {
    stompAim(d, h.st);
  },
  active(d, a, h, k) {
    stompActive(d, h.st, k);
  },
  endActive(d, a, h) {
    stompImpact(d, a, { radius: T.stomp.radius, ...h.spec });
  },
  recover(d, a, h, k) {
    stompRecover(d, h.st, k);
  },
};

/** The performances a string hit can use (TUNING.attacks[name].hits[i].kind). */
export const KINDS = {
  claw: CLAW,
  overhead: OVERHEAD,
  bite: BITE,
  rearBite: REAR_BITE,
  lungeBite: LUNGE_BITE,
  wing: WING,
  tailJab: TAIL_JAB,
  tailSweep: TAIL_SWEEP,
  hop: HOP,
  stomp: STOMP,
};

/** The hit (string scratch) the runner is in: its windup / active entry, or null in the recovery. */
const curHit = (a) => a?.list?.[a.i]?.[2] ?? null;
const stageOf = (a) => (a.phase.startsWith('active') ? 'active' : a.phase.startsWith('windup') ? 'windup' : 'recovery');

/**
 * Selection weight of a data-described attack: phase gate, AI band (range / maxAng / minAng) and the
 * per-phase weight.
 */
export function bandWeight(spec, d, s) {
  if (!spec) return 0;
  if ((d.phase ?? 1) < (spec.phase ?? 1)) return 0;
  const r = spec.range;
  if (r && (s.dist < r[0] * S || s.dist > r[1] * S)) return 0;
  if (spec.maxAng !== undefined && s.absAng > spec.maxAng) return 0;
  if (spec.minAng !== undefined && s.absAng < spec.minAng) return 0;
  const w = perPhase(spec.weight, d.phase);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** Build a string attack from TUNING.attacks[name] (see the STRINGS block above). */
export function makeString(name) {
  const spec = T[name];
  return {
    name,
    string: true, // multi-hit: the deflect chain (Dragon.onParried)
    melee: true, // parryable close-range: a parry on the last hit recoils
    phase: spec.phase ?? 1,
    cooldown: spec.cooldown ?? 0,
    phases(d) {
      const list = [];
      let n = 0;
      for (const hs of spec.hits) {
        if (hs.chance !== undefined && hs.chance < 1 && !(Math.random() < hs.chance)) continue;
        const K = KINDS[hs.kind];
        if (!K) continue;
        const base = wind(d, hs.windup);
        const hold = Array.isArray(hs.hold) ? hs.hold[0] + Math.random() * (hs.hold[1] - hs.hold[0]) : 0;
        const h = { idx: n, spec: hs, K, base, hold, holdK: 0, wi: 0 };
        const sfx = n === 0 ? '' : String(n + 1);
        list.push([`windup${sfx}`, base + hold, h], [`active${sfx}`, hs.active, h]);
        n++;
      }
      list.push(['recovery', wind(d, spec.recovery ?? 1), null]);
      return list;
    },
    beats(d, a) {
      const out = [];
      let t = 0;
      for (const e of a.list) {
        const h = e[2];
        if (h && e[0].startsWith('windup')) out.push(beat(name, t, e[1] + h.spec.impact, h.spec, h.K.part, { hit: h.idx, wi: h.wi }));
        t += e[1];
      }
      return out;
    },
    zone(d, a, out) {
      const b = a.cur, h = b ? a.hits?.[b.hit] : null;
      return h?.K.zone ? h.K.zone(d, a, h, out) : 0;
    },
    weight: (d, s) => bandWeight(spec, d, s),
    /** A posture break / stagger waits while a hit's active can't be cut (the hop in the air). */
    noBreak(a) {
      const h = curHit(a);
      return !!h && !!h.K.noBreakActive && a.phase.startsWith('active');
    },
    start(d, a) {
      a.side0 = d.sense.ang >= 0 ? 1 : -1; // + = the hero on the model-left (+X) side
      a.chain = 0; // parries in a row in this string (Dragon.onParried)
      a.hits = [];
      for (const e of a.list) if (e[2] && e[0].startsWith('windup')) a.hits.push(e[2]);
      for (const h of a.hits) h.K.init?.(d, a, h);
    },
    enter(d, a, phase) {
      // the hit whose active just ended lands its slam (stomp, hop) or settles
      const prev = a.i > 0 ? a.list[a.i - 1] : null;
      if (prev?.[2] && prev[0].startsWith('active')) {
        prev[2].K.endActive?.(d, a, prev[2]);
        if (d.brain?.action !== a) return;
      }
      const h = curHit(a);
      if (!h) return;
      if (phase.startsWith('windup')) h.K.enterWindup?.(d, a, h);
      else h.K.aim?.(d, a, h);
    },
    update(d, a, dt) {
      const h = curHit(a);
      if (!h) {
        const L = a.hits[a.hits.length - 1];
        L?.K.recover?.(d, a, L, a.k, dt);
        return;
      }
      if (a.phase.startsWith('windup')) {
        const k = clamp(a.t / Math.max(1e-3, h.base), 0, 1);
        h.holdK = h.hold > 0 ? clamp((a.t - h.base) / h.hold, 0, 1) : 0;
        // the previous hit settles through the first half of this windup (its paw plants, its head
        // lifts), under this hit's own windup pose
        const prev = h.idx > 0 ? a.hits[h.idx - 1] : null;
        if (prev) prev.K.recover?.(d, a, prev, Math.min(1, k * 2), dt);
        h.K.windup(d, a, h, k, dt);
      } else h.K.active(d, a, h, a.k, dt);
    },
    hit(d, a, dt) {
      const h = curHit(a);
      if (h) h.K.hit?.(d, a, h, stageOf(a), a.k, dt);
      else {
        const L = a.hits[a.hits.length - 1];
        L?.K.hit?.(d, a, L, 'recovery', a.k, dt);
      }
    },
    end(d, a, interrupted) {
      d.throat = 0;
      for (const h of a.hits ?? []) h.K.end?.(d, a, h, interrupted);
    },
  };
}

const clawCombo = makeString('clawCombo');
const rendingFlurry = makeString('rendingFlurry');
const hesitantMaw = makeString('hesitantMaw');
const wingBuffet = makeString('wingBuffet');
const tailLash = makeString('tailLash');
const pounce = makeString('pounce');
const frenzy = makeString('frenzy');

/** Every ability (AI-selectable and Lab-triggerable). Order = Lab list order (keys 1-9 = the first nine). */
export const ATTACKS = {
  bite, swipe, clawCombo, rendingFlurry, hesitantMaw, wingBuffet, tailLash, pounce, frenzy,
  tail, stomp, breath, fireball, charge, leap, roar,
  ...FIRE, // fireAttacks.js: the short flights and the fire spells (contract 3)
};

/** Parryable close-range swings (+ every string, `def.melee`): a parry on the last hit recoils. */
export const MELEE = new Set(['bite', 'swipe', ...Object.keys(ATTACKS).filter((k) => ATTACKS[k].melee)]);
