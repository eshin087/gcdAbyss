import { FrontSide, Quaternion, Vector3 } from 'three';
import { lookOf } from '../duelist/lookSwitch.js';
import { setFill } from '../ashDisciple/bodyArt.js';
import { DIM } from '../../player/model.js';
import { FS_ART } from './bodyArt.js';

// The False Saint's look (the BODY AGENT's file; the body contract: gear.js header; ADR-286). His rig is
// the hero's skeleton carrying the disguise over the frame (gear.js); this file colours it once (tintSaint)
// and dresses it every frame (dressSaint): the shards of the disguise by the shell (d.shell: a shard is
// gone while its part's exposure >= its threshold), the frame under every part that has started to go,
// the metal hands, the weapons by the moves' values, the sensors by phase and at his death.
//
// His look switches (`?fs...=`, duelist/lookSwitch.js lookOf; default a):
//   ?fsLook=a|b     how much of the legs the third milestone bares (a reload): a the second sheet's 03
//                   (both legs plated in phase 3), b the first sheet's 03 (the right leg plated, the left
//                   trouser whole until phase 4)
//   ?fsLetters=a|0  his letters follow his size on screen by the hero's rule (live; core's)
//
// dressSaint(d, dt), once a frame (kit.dress, after the animator). It does real work only when the
// shell's version moved (the shards, the frame, the hands' skin) or a weapon's value moved (its pivots);
// every frame it writes his part inks (a few Vector4 sets: the tables are shared by every boss rig on the
// page), the sensors' glow, and mirrors the free hand the animator picked. No allocation.

export const FS_LOOKS = Object.freeze({ fsLetters: 'a', fsLook: 'a' });
export const fsLook = (name) => lookOf(name, FS_LOOKS[name] ?? 'a');

/** His letters follow his size on screen by the hero's rule (`?fsLetters=a`; live). */
export function fsLettersOn() {
  return fsLook('fsLetters') === 'a';
}
/** The reading of the milestones his rig is built with: 'a' | 'b'. */
export function fsLookNow() {
  return fsLook('fsLook') === 'b' ? 'b' : 'a';
}

/** His colours (the kit's _tint), once after his rig is built. */
export function tintSaint(M) {
  if (!M) return;
  const A = FS_ART;
  for (const k in A.fill) if (M[k]) setFill(M[k], A.fill[k][0], A.fill[k][1], A.fill[k][2]);
  for (const k in A.rim) {
    const u = M[k]?.uniforms?.uArtRim;
    if (u) u.value *= A.rim[k];
  }
  for (const k in A.spec) M[k]?.uniforms?.uArtSpec?.value.set(A.spec[k][0], A.spec[k][1]);
  // (his `lining` is the woven frame, seen from outside; the skirt's inside is `collarIn`: gear.js)
  if (M.lining) M.lining.side = FrontSide;
  for (const k in A.glow) {
    const u = M[k]?.uniforms;
    if (!u) continue;
    if (u.uGlowMask) u.uGlowMask.value = 1;
    u.uInk?.value.setRGB(...A.glow[k][0]);
    u.uEmissive?.value.setRGB(...A.glow[k][1]);
  }
}

const INK = Object.freeze(Object.entries(FS_ART.ink).map(([p, t]) => [Number(p), t]));
/** His part inks into the tables every boss rig shares (rewritten every frame: a rig built later writes
 *  the hero's into them). */
function writeInk(U) {
  const I = U?.uHeroPartInk?.value, R = U?.uHeroPartRim?.value, F = U?.uHeroPartFill?.value;
  if (!I || !R || !F) return;
  for (let i = 0; i < INK.length; i++) {
    const p = INK[i][0], t = INK[i][1];
    I[p]?.set(t.ink[0], t.ink[1], t.ink[2], t.ink[3]);
    R[p]?.set(t.rim[0], t.rim[1], t.rim[2], t.rim[3]);
    F[p]?.set(t.fill[0], t.fill[1], t.fill[2], t.fill[3]);
  }
}

// ---------------------------------------------------------------- the reveal
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const k01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
/** The weapon values the moves drive (fields on d; 0 when unset). */
export const FS_WEAPON_KEYS = Object.freeze(['fsJetK', 'fsJetR', 'fsJetL', 'fsPalmK', 'fsGunK', 'fsPetalK', 'fsThrustK', 'fsCoreK', 'fsTubeK', 'eyesK', 'fsFistR']);

/** The shards, the frame and the hands' skin by the shell (only when its version moved). */
function reveal(D, sh, all) {
  const part = (n) => (sh ? sh.part(n) : 0);
  for (const e of D.shards) {
    const gone = part(e.part) >= e.t;
    if (gone === e.gone && !all) continue;
    e.gone = gone;
    for (const m of e.meshes) m.visible = !gone;
  }
  for (const f of D.frame) {
    let on = false;
    for (const p of f.parts) if (part(p) > 1e-4) on = true;
    if (on === f.on && !all) continue;
    f.on = on;
    for (const m of f.meshes) m.visible = on;
  }
  for (const h of D.hands) h.bare = part(h.part) >= h.t;
  D.handsDirty = true;
}

const coverGone = (W) => {
  if (!W?.cover?.length) return true;
  for (const e of W.cover) if (e && !e.gone) return false;
  return true;
};

const _q = new Quaternion(), _x = new Vector3(1, 0, 0);
/** A pivot turned `a` rad about its own X from its rest. */
function turnX(p, rest, a) {
  _q.setFromAxisAngle(_x, a);
  p.quaternion.copy(rest).multiply(_q);
}
function nozzle(W, k) {
  if (!W) return;
  const on = coverGone(W);
  for (const m of W.meshes) m.visible = on;
  const s = 0.62 + 0.6 * k;
  W.pivot.scale.set(s, 0.4 + 0.8 * k, s);
}

/** The weapons by the moves' values (only when one moved, or the shell did). */
function weapons(d, D, force) {
  const wk = D.wk;
  let moved = force;
  for (let i = 0; i < FS_WEAPON_KEYS.length; i++) {
    const key = FS_WEAPON_KEYS[i];
    const v = k01(fin(d[key]));
    if (v !== wk[key]) {
      wk[key] = v;
      moved = true;
    }
  }
  if (!moved) return;
  const W = D.weapons;
  nozzle(W.elbowR, Math.max(wk.fsJetK, wk.fsJetR));
  nozzle(W.elbowL, Math.max(wk.fsJetK, wk.fsJetL));
  nozzle(W.backR, wk.fsThrustK);
  nozzle(W.backL, wk.fsThrustK);
  nozzle(W.calfR, wk.fsThrustK);
  nozzle(W.calfL, wk.fsThrustK);
  for (const side of ['R', 'L']) {
    const P = W[`petals${side}`];
    if (!P) continue;
    const on = coverGone(P), k = wk.fsPetalK;
    for (const p of P.petals) {
      p.m.visible = on;
      turnX(p.p, p.rest, k * 1.1);
    }
    P.cells.visible = on && k > 0.04;
  }
  if (W.gun) {
    const on = coverGone(W.gun), k = wk.fsGunK;
    W.gun.barrel.visible = on && k > 0.02;
    W.gun.meshes[1].visible = on;
    W.gun.barrel.position.y = -0.02 + 0.07 * k;
    W.gun.housing.position.z = 0.002 + 0.014 * k;
  }
  if (W.core) {
    const on = coverGone(W.core);
    for (const m of W.core.meshes) m.visible = on;
    W.core.slit.scale.set(1, 0.6 + 1.4 * wk.fsCoreK, 1);
  }
  if (W.mortar) {
    const on = coverGone(W.mortar);
    for (const m of W.mortar.meshes) m.visible = on;
    turnX(W.mortar.pivot, W.mortar.rest, wk.fsTubeK * 2.35);
  }
  const gem = d.rig.materials?.gem?.uniforms;
  if (gem) {
    const g = 0.35 + 1.8 * Math.max(wk.fsCoreK, wk.fsPalmK);
    if (gem.uGlow) gem.uGlow.value = g;
    if (gem.uInkGlow) gem.uInkGlow.value = g;
  }
  D.handsDirty = true;
}

/** The hand shapes a pose may ask for (d.fsHandR / d.fsHandL); `reach` draws as the open hand. */
export const FS_HAND_SHAPES = Object.freeze(['open', 'reach', 'relax', 'guard', 'clench']);
const shapeOf = (v, def = 'guard') => (v === 'reach' ? 'open' : v === 'relax' ? 'guard' : v === 'open' || v === 'guard' || v === 'clench' ? v : def);

/** The hands: skin, or the metal under it once the part is bare (a wrist, a hand), in the shape the pose
 *  asks for. The left hand's open / grip groups are the animator's to show (their `visible`); what is
 *  inside them is ours. Every frame, but it only writes when the shape or the layer changed. */
function hands(d, D) {
  const sR = D.wk.fsFistR > 0.5 ? 'clench' : shapeOf(d.fsHandR), sL = shapeOf(d.fsHandL);
  for (let i = 0; i < D.hands.length; i++) {
    const h = D.hands[i];
    if (h.wrist) {
      if (!D.handsDirty) continue;
      for (const m of h.skin) m.visible = !h.bare;
      for (const m of h.metal) m.visible = h.bare;
      continue;
    }
    const want = h.fixed ?? (h.side === 'R' ? sR : sL);
    if (want === h.shape && h.bare === h.drawnBare && !D.handsDirty) continue;
    h.shape = want;
    h.drawnBare = h.bare;
    for (const name in h.shapes) {
      const S = h.shapes[name], on = name === want;
      S.skin.visible = on && !h.bare;
      S.metal.visible = on && h.bare;
    }
  }
  // the palm's iris: on the metal right hand, any shape but the fist
  const I = D.weapons.iris, H = D.handR;
  if (I && H) {
    const on = H.bare && sR !== 'clench';
    if (I.ring.visible !== on || D.handsDirty) {
      I.ring.visible = I.centre.visible = on;
      const k = D.wk.fsPalmK;
      I.ring.scale.setScalar(0.7 + 0.6 * k);
      I.centre.scale.setScalar(0.5 + 0.8 * k);
    }
  }
  D.handsDirty = false;
}

// ---------------------------------------------------------------- the sensors
/** The sensors' size at the game camera (× their close size), from `near` to `far` m: each still lights a
 *  letter cell there. */
export const SENSOR_FAR = Object.freeze({ near: 5, far: 26, k: 5 });
/** His death: the sensors go out one by one, at these seconds into his dying (the knee is down by 0.8 s). */
export const SENSOR_OUT = Object.freeze([1.0, 1.65, 2.3]);

function sensors(d, D) {
  const S = D.sensors;
  if (!S.length) return;
  const ph = Math.min(4, Math.max(1, fin(d.dressPhase, 1) | 0));
  const lit = ph - 1;
  // the death: out one by one
  const dying = d.mode === 'dying', dead = d.mode === 'dead';
  let out = 0;
  if (dead) out = 7;
  else if (dying) {
    const t = fin(d.brain?.modeT);
    for (let i = 0; i < SENSOR_OUT.length; i++) if (t >= SENSOR_OUT[i]) out |= 1 << i;
  }
  if (out !== D.out) {
    const fresh = out & ~D.out;
    D.out = out;
    if (dying && fresh) for (let i = 0; i < 3; i++) if (fresh & (1 << i) && i < lit) d.fx?.sensorOut?.(i);
  }
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    let on = s.i < lit && !(out & (1 << s.i));
    for (let j = 0; j < s.cover.length; j++) if (s.cover[j] && !s.cover[j].gone) on = false;
    if (s.mesh.visible !== on) s.mesh.visible = on;
  }
  // their light: d.eyesK flares it (a sight line, a charge); written only when it moves
  const fu = d.rig.materials?.flask?.uniforms;
  // (v04: restrained: cosmetic cyan, never a tell, always under the white contact glint)
  const k = 0.27 + 0.6 * k01(fin(d.eyesK));
  if (fu && k !== D.glowK) {
    D.glowK = k;
    if (fu.uGlow) fu.uGlow.value = k;
    if (fu.uInkGlow) fu.uInkGlow.value = k;
  }
  // they grow with the camera's distance (no Math.hypot: it allocates)
  const cam = d.game?.camera?.position, hp = d.position;
  if (cam && hp) {
    const dx = cam.x - hp.x, dy = cam.y - hp.y - 1.8, dz = cam.z - hp.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = Math.min(1, Math.max(0, (fin(dist, 30) - SENSOR_FAR.near) / (SENSOR_FAR.far - SENSOR_FAR.near)));
    if (Math.abs(f - (D.sensK ?? -1)) > 0.01) {
      D.sensK = f;
      for (const s of S) s.mesh.scale.setScalar(1 + (SENSOR_FAR.k - 1) * f);
    }
  }
}

// ---------------------------------------------------------------- the skirt
/** How far a skirt panel may swing in all (rad, both segments): out, in. A short fitted jacket. */
export const SKIRT_SWING = Object.freeze({ out: 0.55, in: 0.22 });
/** After the animator: hold each panel inside SKIRT_SWING (the spring's state too). Bai Wuji's clamp. */
function clampSkirt(d) {
  const st = d.anim?.coatState, coat = d.rig?.coat;
  if (!st || !coat) return;
  for (let i = 0; i < coat.length; i++) {
    const s = st[i], C = coat[i];
    if (!s || !C?.segs) continue;
    const a = s[0], b = s[1], tot = a.x + b.x;
    const want = tot < -SKIRT_SWING.out ? -SKIRT_SWING.out : tot > SKIRT_SWING.in ? SKIRT_SWING.in : tot;
    if (want === tot || !Number.isFinite(tot) || Math.abs(tot) < 1e-6) continue;
    const k = want / tot;
    a.x *= k;
    b.x *= k;
    if (tot < 0) {
      if (a.vx < 0) a.vx = 0;
      if (b.vx < 0) b.vx = 0;
    } else {
      if (a.vx > 0) a.vx = 0;
      if (b.vx > 0) b.vx = 0;
    }
    C.segs[0].rotation.x = a.x;
    C.segs[1].rotation.x = b.x;
    C.segs[0].updateMatrixWorld(true);
  }
}

/**
 * Once a frame (kit.dress): the reveal by the shell, the weapons by the moves' values, the hands, the
 * sensors by phase (dark in phase 1; 1, 2, 3 lit in phases 2, 3, 4; out one by one at his death).
 */
export function dressSaint(d) {
  const D = d?.rig?.root?.userData?.fsDress;
  if (!D || D.kind !== 'fs') return;
  if (!D.init) {
    D.init = true;
    D.out = 0;
    for (const k of FS_WEAPON_KEYS) if (d[k] === undefined) d[k] = 0;
  }
  // (his inks: on his first frame, then twice a second, against a rig built later writing the hero's
  // into the shared tables; a write stores fresh numbers, so not every frame)
  if (!(D.inkN-- > 0)) {
    D.inkN = 30;
    writeInk(d.game?.U);
  }
  const sh = d.shell;
  const v = sh ? sh.version : 0;
  const all = D.ver === -1;
  let shellMoved = false;
  if (v !== D.ver) {
    D.ver = v;
    reveal(D, sh, all);
    shellMoved = true;
  }
  weapons(d, D, shellMoved);
  hands(d, D);
  sensors(d, D);
  clampSkirt(d);
}

// ---------------------------------------------------------------- his points
const _a = new Vector3();
const pt = (d, name) => d?.rig?.root?.userData?.fsDress?.pts?.[name] ?? null;
/** A marker's world position into out (finite or false). */
function at(o, out) {
  if (!o?.matrixWorld) return false;
  out.setFromMatrixPosition(o.matrixWorld);
  return Number.isFinite(out.x + out.y + out.z);
}

/** His (right) eye as drawn (world): the human eye in phase 1, the first sensor from phase 2; out a
 *  Vector3, finite even before the rig has a matrix. */
export function eyePoint(d, out) {
  const o = pt(d, fin(d?.dressPhase, 1) >= 2 ? 'sensor0' : 'eyeHuman');
  if (at(o, out)) return out;
  const p = d.position, y = fin(d.yaw);
  return out.set(p.x + Math.sin(y) * 0.2, p.y + 2.0, p.z + Math.cos(y) * 0.2);
}

/** His right ('R') or left ('L') hand as drawn (world). */
export function handPoint(d, side, out) {
  const A = d?.rig?.arms?.[side === 'L' ? 'L' : 'R'];
  if (A?.fore?.matrixWorld) {
    out.set(0, -DIM.foreArm, 0).applyMatrix4(A.fore.matrixWorld);
    if (Number.isFinite(out.x + out.y + out.z)) return out;
  }
  const p = d.position, s = side === 'L' ? 1 : -1, y = fin(d.yaw);
  return out.set(p.x + Math.cos(y) * 0.3 * s, p.y + 1.0, p.z - Math.sin(y) * 0.3 * s);
}

/** Where a weapon of his frame is, as drawn (world): out a Vector3; finite whatever the rig (gear.js
 *  header lists the names). */
export function partPoint(d, name, out) {
  if (name === 'handR') return handPoint(d, 'R', out);
  if (name === 'handL') return handPoint(d, 'L', out);
  if (name === 'eye') return eyePoint(d, out);
  if (at(pt(d, name), out)) return out;
  if (name === 'palmR') return handPoint(d, 'R', out);
  if (name === 'palmL') return handPoint(d, 'L', out);
  const p = d.position;
  _a.set(p.x, p.y + 1.4, p.z);
  return out.copy(_a);
}
