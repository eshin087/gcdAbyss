import { BEHIND } from './poses.js';

// Xin Yi's motion after the reference pack (docs/art/character-packs-v04/xin-yi, ADR-285), behind
// `?oneRefMove=a` (look.js oneRefMoveNow; '0' = as shipped). A pose layer over whatever keys the shipped
// switches chose (`?oneMoves=0|a|b`): the same key times, the same eases, the same cock, so every windup,
// hold, impact, active window, zone, flash, cue and effect lands where it did (the realiser times a beat
// from its windup, never from its poses), and no root field is written (bX / bZ, travel, lift, dash are
// left as they are: the source owns the root motion). His guards are the pack's (poses.js GUARDS_REF);
// what changes in the keys, from the strips (COVERAGE.md):
//   - a hand blow on the floor lands into a lunge (A1 contact: the weight forward, the rear leg long): the
//     body a little lower and leaning in at the contact, half that through the follow; kicks keep the
//     rebuild's straight leg (A2: the support leg is the rebuild's already);
//   - the beckon's open hand further out (A5.1);
//   - the reload throws both arms wide (A4.5: the guns tossed), the hands into the coat, out low;
//   - Unwriting lifts both open palms (S1.4), the Dive Within drives in long and low (S1.5), the burst off the
//     floor goes up with the hands low at his sides (S2.1: no arms thrown wide), the Falling Fist lands low on
//     the fist (S2.2);
//   - phase 1, gear 1: the left hand stays behind his back in every key (oneHand, before this layer).
// Not touched: the guns' aims (gunAim.js puts the muzzles on the line of fire), the palm bolts' and the
// shots' release poses (a projectile leaves from the hand as drawn: handPoint / muzzlePoint), the
// transitions' kneel and rising (their own keys, S2.4 / S2.5 already), the flight's hover and pass.
// The reaction clips (refClipKey): the Lean's slips further over (T2.4), the high duck lower, the recoils,
// the stagger and the reeling bigger (T2.5 / T2.6), the Bend arched further back (S3.4), the Stop's palm
// out straighter (S1.2); in phase 1 gear 1 the left hand behind his back through all of them.

const REF = { sink: 0.05, lean: 0.06, rear: 0.05, floor: -0.42 };
/** The hand blows that land into the lunge. */
const HANDS = new Set(['jab', 'cross', 'palm', 'double', 'backfist', 'hook', 'elbow', 'uppercut']);
// (a key already lower than `floor` keeps its own height: a crouch is not pushed deeper)
const sinkTo = (bY, by) => Math.max(bY - by, Math.min(bY, REF.floor));
/** A foot on the floor ([x, z], or [x, y, z] with y at the ankle) behind him, put `d` m further back. */
const rearLong = (v, d) => {
  if (!Array.isArray(v)) return v;
  if (v.length === 2) return v[1] < 0 ? [v[0], v[1] - d] : v;
  return v[2] < 0 && v[1] <= 0.12 ? [v[0], v[1], v[2] - d] : v;
};
const lifted = (k) => Math.abs(k.pitch ?? 0) > 0.9 || Math.abs(k.roll ?? 0) > 0.9;
/** The acrobatic kicks (strikes.js) that take off and land (A3.1 - A3.4; the flying knee by its part). */
const AIR = new Set(['tornado', 'butterfly', 'flash', 'aerial']);
/** A pitch leaning forward at least `p` (a key that ends a whole flip keeps its turns: -2π + p, not p). */
function leanTo(pitch, p) {
  const a = pitch ?? 0, w = a - TAU * Math.round(a / TAU);
  return a + Math.max(0, p - w);
}
const TAU = Math.PI * 2;

/** One key of a beat in the reference's poses. `ctx.oneHand`: phase 1 gear 1 (the left hand stays). */
function refKey(u, k, b, ctx) {
  const o = { ...k };
  const hit = Math.abs(u - 1) < 1e-6, follow = u > 1 + 1e-6;
  const grounded = !b.air && !b.leap && !b.flit && !lifted(k) && !Array.isArray(b.lift) && !b.iron && !b.cast && !b.bolt && !b.aim;
  if (grounded && HANDS.has(b.blow) && (hit || follow)) {
    const f = hit ? 1 : 0.5;
    if (k.bY != null) o.bY = sinkTo(k.bY, REF.sink * f);
    o.pitch = (k.pitch ?? 0) + REF.lean * f;
    if (hit) {
      o.rF = rearLong(k.rF, REF.rear);
      o.lF = rearLong(k.lF, REF.rear);
    }
  }
  if (grounded && (b.blow === 'palm' || b.blow === 'double')) {
    // A1.5 / A1.6: the palm (or both) pushed out straight at his chest's height from an upright, long stance
    // (the rebuild drove it from a deep crouch, the lead knee far forward); drawn back to the shoulder first
    const two = b.blow === 'double';
    if (hit || follow) {
      const f = hit ? 1 : 0.85;
      Object.assign(o, { bY: Math.max(k.bY ?? 0, -0.12), pitch: 0.08, lF: [0.16, 0.38], rF: [-0.18, -0.36] });
      o.rH = two ? [0.1, 0.04, 0.54 * f] : [0.06, 0.05, 0.57 * f];
      if (two) o.lH = [-0.1, 0.04, 0.54 * f];
    } else if (u >= 0.6) {
      o.bY = Math.max(k.bY ?? 0, -0.16);
      o.rH = [0.08, 0.06, 0.12];
      if (two) o.lH = [-0.08, 0.06, 0.12];
    }
  }
  if (b.blow === 'front' && (hit || follow)) {
    // A2.1: the snap kick to the head's height, the body leaning back over the support leg
    for (const f of ['rF', 'lF']) if (Array.isArray(k[f]) && k[f].length === 3 && k[f][1] > 0.4) o[f] = [k[f][0], k[f][1] + (hit ? 0.24 : 0.16), k[f][2]];
    o.pitch = (k.pitch ?? 0) - 0.08;
  }
  if ((b.blow === 'round' || b.blow === 'side') && (hit || follow)) {
    // A2.2 / A2.3: the kick at the chest's height, not the hip's
    for (const f of ['rF', 'lF']) if (Array.isArray(k[f]) && k[f].length === 3 && k[f][1] > 0.4) o[f] = [k[f][0], k[f][1] + (hit ? 0.14 : 0.1), k[f][2]];
  }
  if (b.blow === 'sweep' && u >= 0.6) {
    // A2.5: down into a deep crouch, the sweeping leg out straight along the floor at the ankle's height,
    // the right hand down by the floor (the rebuild swung it at knee height from a standing stance)
    const deep = hit || follow ? -0.66 : -0.46;
    o.bY = Math.min(k.bY ?? 0, deep);
    o.pitch = Math.max(k.pitch ?? 0, 0.22);
    const sw = String(b.part ?? 'footR').endsWith('L') ? 'lF' : 'rF', st = sw === 'rF' ? 'lF' : 'rF';
    const v = k[sw];
    if ((hit || follow) && Array.isArray(v)) {
      const x = v[0], z = v.length === 3 ? v[2] : v[1], r = Math.hypot(x, z) || 1, L = Math.max(r, 0.75);
      o[sw] = [x / r * L, 0.06, z / r * L];
    }
    o[st] = [st === 'lF' ? 0.14 : -0.14, 0.06];
    o.rH = [0.06, -0.52, 0.34];
  }
  if (b.beckon && Array.isArray(k.rH)) o.rH = [k.rH[0] - 0.02, k.rH[1] + 0.02, k.rH[2] * 1.12];
  if (b.iron === 'reload') {
    // A4.5: both arms thrown wide (the guns tossed), the hands into the coat at his hips, the new pair low
    if (u > 0.2 && u < 0.45) Object.assign(o, { bY: -0.08, rH: [-0.5, 0.02, 0.14], rP: [-0.9, -0.2, -0.3], lH: [0.5, 0.02, 0.14], lP: [0.9, -0.2, -0.3], hdX: -0.06 });
    else if (u > 0.6 && u < 0.8) Object.assign(o, { rH: [0.06, -0.34, -0.02], lH: [-0.06, -0.34, -0.02] });
    else if (u > 0.9) Object.assign(o, { rH: [-0.07, -0.45, 0.13], lH: [0.07, -0.45, 0.13], bY: -0.08 });
  }
  if (b.unwrite) {
    // S1.4: both open palms low before him, turned up, then lifted (the bricks rise from the pillars)
    if (hit || follow) Object.assign(o, { rH: [-0.16, 0.08, 0.42], lH: [0.16, 0.08, 0.42], pitch: -0.08 });
    else if (u > 0.3) Object.assign(o, { rH: [-0.12, -0.24, 0.34], lH: [0.12, -0.24, 0.34] });
  }
  if (b.dive && hit) {
    // S1.5: the lunge long and low, the rear leg out behind
    if (k.bY != null) o.bY = Math.min(k.bY, -0.36);
    o.pitch = Math.max(k.pitch ?? 0, 0.46);
    o.rF = rearLong(k.rF, 0.12);
    o.lF = rearLong(k.lF, 0.12);
  }
  if (b.rise && (hit || follow)) {
    // S2.1: straight up, the hands low at his sides (no arms thrown wide)
    Object.assign(o, { rH: [-0.2, -0.42, 0.06], rP: [-0.9, -0.1, -0.3], lH: [0.2, -0.42, 0.06], lP: [0.9, -0.1, -0.3] });
  }
  if (b.fist && u >= 1 - 1e-6 && k.bY != null) o.bY = Math.min(k.bY, -0.62); // S2.2: down on the fist, low
  if (b.fist && Math.abs(u - 0.4) < 1e-6) {
    // S2.2's chamber: upright in the hover, the right fist drawn up by his ear before the dive
    Object.assign(o, { pitch: 0.06, rH: [0.04, 0.34, -0.02], lH: [0.3, -0.24, 0.16] });
  }
  if (b.rise && Math.abs(u - (b.cock ?? 0.7)) < 1e-6) {
    // S2.1's telegraph: down in a deep crouch, the right hand on the floor
    Object.assign(o, { bY: Math.min(k.bY ?? 0, -0.62), pitch: Math.max(k.pitch ?? 0, 0.36), hdX: 0.0, rH: [0.06, -0.62, 0.36] });
  }
  const aero = AIR.has(b.blow) || (b.air && String(b.part ?? '').startsWith('knee') && b.dash);
  if (aero && u >= 2 - 1e-6) {
    // A3.x's return: he lands low and long (the lead leg bent, the rear one out behind), not half standing
    o.bY = Math.min(k.bY ?? 0, -0.44);
    o.pitch = leanTo(k.pitch, 0.26);
    for (const f of ['rF', 'lF']) {
      const v = k[f];
      if (Array.isArray(v) && v.length === 2) o[f] = [v[0] * 1.15, v[1] < 0 ? -0.46 : 0.32];
    }
  }
  if (aero && u < (b.cock ?? 0.5) * 0.5 + 1e-6 && (b.blow === 'tornado' || b.blow === 'aerial' || b.blow === 'butterfly')) {
    // A3.1 / A3.2 / A3.4's anticipation: sunk deep into the lunge before the jump
    o.bY = Math.min(k.bY ?? 0, -0.44);
    o.pitch = leanTo(k.pitch, 0.28);
  }
  if (aero && !AIR.has(b.blow) && u > (b.cock ?? 0.6) + 1e-6 && u <= 1 + 1e-6) {
    // A3.6: the flying knee driven up, the knee's fist drawn up by the head, the other hand reaching ahead
    const L = String(b.part).endsWith('L');
    o[L ? 'lH' : 'rH'] = [L ? -0.04 : 0.04, 0.32, 0.04];
    o[L ? 'rH' : 'lH'] = [L ? 0.1 : -0.1, 0.12, 0.46];
  }
  if (b.blow === 'dropHeel' && u >= 1 - 1e-6) {
    // A2.6: the heel slammed down just ahead of him, upright over it (the rebuild split the legs a metre)
    const sw = String(b.part ?? 'footR').endsWith('L') ? 'lF' : 'rF', st = sw === 'rF' ? 'lF' : 'rF';
    const v = k[sw], w = k[st];
    o.bY = Math.max(k.bY ?? 0, hit ? -0.18 : -0.14);
    o.pitch = Math.min(k.pitch ?? 0, 0.06);
    if (Array.isArray(v) && v.length === 3) o[sw] = [v[0], v[1], hit ? 0.42 : 0.38];
    if (Array.isArray(w) && w.length === 2) o[st] = [w[0], -0.14];
  }
  // the guns and the palm bolt: only the legs and the free hand change, the body and the firing arm stay as
  // drawn (a shot or a bolt leaves from the hand: the same point, the same speed, the same line)
  const gun = (b.aim || (b.iron === 'rain' && !b.air) || b.iron === 'wheel') && u >= (b.cock ?? 0.7) - 1e-6;
  if (gun && !lifted(k)) {
    // A4.1 / A4.2 / A4.4: shooting from a wide stance (at the height drawn: a heavy shot's speed is set by
    // where it leaves, so the shoulders stay exactly where they were)
    for (const f of ['rF', 'lF']) if (Array.isArray(k[f]) && k[f].length === 2) o[f] = [k[f][0] * 1.4, k[f][1] * 1.35];
  }
  if ((b.bolt || b.send) && u >= (b.cock ?? 0.72) - 1e-6) {
    // S1.1 / S1.3: pushed from a shorter stance than the lunge, the free hand down at his side (his height
    // and the pushing arm as drawn: the arm is at full stretch, so any change of the shoulder moves the bolt)
    for (const f of ['rF', 'lF']) if (Array.isArray(k[f]) && k[f].length === 2) o[f] = [k[f][0] * 0.85, k[f][1] * 0.75];
    if (b.bolt && Array.isArray(k.lH)) o.lH = [0.06, -0.5, 0.06];
  }
  if (b.stance) {
    // S1.6: the Still Hand raised flat from an upright, narrow stance, the arm out straighter
    if (k.bY != null) o.bY = k.bY + 0.1;
    for (const f of ['rF', 'lF']) if (Array.isArray(k[f]) && k[f].length === 2) o[f] = [k[f][0] * 0.7, k[f][1] * 0.7];
    if (u >= 0.8 - 1e-6) o.rH = [0.04, 0.12, 0.56];
  }
  if (ctx.oneHand) {
    o.lH = BEHIND.lH;
    o.lP = BEHIND.lP;
  }
  return o;
}

const CACHE = new WeakMap(); // beat -> Map(ctxKey -> (keys -> ref keys))
/** A beat's keys in the reference's poses (cached per beat, per keys array and per context). */
export function refKeysOf(b, keys, ctx) {
  if (!Array.isArray(keys)) return keys;
  let M = CACHE.get(b);
  if (!M) CACHE.set(b, (M = new Map()));
  const ck = ctx.oneHand ? 1 : 0;
  let W = M.get(ck);
  if (!W) M.set(ck, (W = new WeakMap()));
  let r = W.get(keys);
  if (!r) {
    r = keys.map(([u, k]) => [u, refKey(u, k, b, ctx)]);
    W.set(keys, r);
  }
  return r;
}

const BIG = new Set(['flinch', 'stagger', 'recoil', 'reeling', 'trampled']);
const LEAN = new Set(['ward', 'wardR', 'clash', 'deflect']);
/** One key of a reaction clip in the reference's poses (`oneHand`: phase 1 gear 1). */
export function refClipKey(name, k, oneHand = false) {
  let o = k;
  if (BIG.has(name)) {
    o = { ...k };
    if (k.pitch != null) o.pitch = k.pitch * 1.3;
    if (k.bZ != null) o.bZ = k.bZ * 1.35;
    if (k.spX != null) o.spX = k.spX * 1.3;
    if (k.bY != null) o.bY = sinkTo(k.bY, 0.05);
  } else if (LEAN.has(name)) {
    o = { ...k };
    if (k.pitch != null) o.pitch = k.pitch * 1.25;
    if (k.roll != null) o.roll = k.roll * 1.3;
    if (k.bY != null) o.bY = sinkTo(k.bY, 0.04);
  } else if (name === 'wardHigh') {
    o = { ...k };
    if (k.bY != null) o.bY = sinkTo(k.bY, 0.14);
    if (k.pitch != null) o.pitch = k.pitch + 0.12;
  } else if (name === 'bend') {
    o = { ...k };
    if ((k.pitch ?? 0) < -0.9) {
      o.pitch = k.pitch * 1.15;
      o.bY = Math.min(k.bY ?? -0.5, -0.56);
    }
  } else if (name === 'stop' && Array.isArray(k.rH)) {
    o = { ...k, rH: [0.04, 0.12, 0.56] };
  }
  if (oneHand && name !== 'meditate' && name !== 'intro') o = { ...o, lH: BEHIND.lH, lP: BEHIND.lP };
  return o;
}
