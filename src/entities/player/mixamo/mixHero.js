import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markCaster } from '../../../render/pipeline.js';
import { MIX_BODIES, MIX_FPS, MIX_SWING, MIX_LIGHT, MIX_BY_NAME, MIX_LOOP_SPEED, MIX_MOVES } from './mixClips.js';

// The Mixamo hero trial (ADR-294; `?hero=mixamo|mixrig`): a skinned body from Mixamo, posed by
// Mixamo's Great Sword clips, drawn instead of the hero's own rig. Only the DRAWING changes:
//
//  - the hero's rig, animator and gameplay all run as before (hits, reach, timing, FX anchors read
//    the same joints), its meshes are hidden every frame after the animator has run
//  - the body is printed in the hero's own letter materials (rig.materials by name; the surface glyph
//    vertex shader skins it: materials.js), its letter layout (aGUV) baked by scripts/mixamo/convert.py
//  - the clip and its time follow the player's state: a swing's clip is stretched so its cut lands
//    at the game's contact (mixClips.js MIX_SWING), the loops run at his real ground speed
//  - his sword is drawn in the Mixamo hands: set after the hit checks, put back before the next
//    animator step (restore), so the sweep and the animator never see it
//  - `?hero=mixamo` (the Ninja body) also wears his head, hair, shoulder plate, belts, coat and cape:
//    pieces of a rest-pose hero hung on the matching Mixamo bones (_gear)
//
// The GLB is fetched; until it is in (or if it fails) today's hero is drawn.

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

const bone = (bones, name) => bones[name] ?? null;

export class MixHero {
  constructor(player, mode) {
    this.p = player;
    this.mode = mode;
    this.cfg = MIX_BODIES[mode];
    this.ready = false;
    this.failed = false;
    this.animKey = 'loco';
    this.track = null; // { id, action, time }
    this.prev = null;
    this.blendT = 1;
    this.blendDur = 0.15;
    this.loopPhase = 0;
    this.saved = null; // the sword's own local transform while the drawn one is set
    this._wrapPlay();
    this._load();
  }

  async _load() {
    try {
      const res = await fetch(this.cfg.file);
      if (!res.ok) throw new Error(`${this.cfg.file}: ${res.status}`);
      const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
      this._build(gltf);
    } catch (e) {
      this.failed = true;
      console.warn('[mixHero] the Mixamo hero did not load; today\'s hero is drawn', e);
    }
  }

  /** The animator's key for the state just entered ('dead' vs 'deadDown', 'roll' vs 'backstep'). */
  _wrapPlay() {
    const anim = this.p.anim;
    if (!anim || anim._mixWrapped) return;
    const play = anim.play.bind(anim);
    anim.play = (key, ...rest) => {
      this.animKey = key;
      return play(key, ...rest);
    };
    anim._mixWrapped = true;
  }

  _build(gltf) {
    const p = this.p, rig = p.rig, M = rig.materials;
    const scene = gltf.scene;
    const bones = {};
    const skinned = [];
    scene.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o;
      if (o.isSkinnedMesh) skinned.push(o);
    });
    for (const m of skinned) {
      const g = m.geometry;
      const uv = g.attributes.uv, uv1 = g.attributes.uv1;
      if (uv) {
        // glTF stores v flipped (1 - v): the letter layout wants it back
        const a = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) {
          a[i * 2] = uv.getX(i);
          a[i * 2 + 1] = 1 - uv.getY(i);
        }
        g.setAttribute('aGUV', new THREE.BufferAttribute(a, 2));
      }
      if (uv1) {
        const a = new Float32Array(uv1.count);
        for (let i = 0; i < uv1.count; i++) a[i] = uv1.getX(i);
        g.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
      }
      const name = m.material?.name ?? 'coat';
      m.material = M[name] ?? M.coat;
      m.frustumCulled = false;
      m.userData.noBatch = true;
    }

    // the clips, in place: the hips keep their height, the game moves the root
    const hips = bones.Hips;
    const hp = hips.position.clone();
    const up = Math.abs(hp.y) >= Math.abs(hp.x) && Math.abs(hp.y) >= Math.abs(hp.z) ? 1 : Math.abs(hp.z) >= Math.abs(hp.x) ? 2 : 0;
    const bind = [hp.x, hp.y, hp.z];
    const clips = {};
    for (const c of gltf.animations) {
      for (const t of c.tracks) {
        if (t.name === `${hips.name}.position`) {
          const v = t.values;
          for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) if (k !== up) v[i + k] = bind[k];
        }
      }
      clips[c.name] = c;
    }

    // the fit: his size and his ground
    const wrap = new THREE.Group();
    wrap.name = 'mixHero';
    wrap.add(scene);
    // the file's nodes ARE the bind pose; keep it (skeleton.pose() would misplace the root bone under
    // the armature node's own transform)
    const rest = [];
    for (const b of Object.values(bones)) rest.push([b, b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    const toRest = () => {
      for (const [b, p, q, s] of rest) {
        b.position.copy(p);
        b.quaternion.copy(q);
        b.scale.copy(s);
      }
      scene.updateMatrixWorld(true);
    };
    scene.updateMatrixWorld(true);
    if (this.cfg.fit === 'box') {
      const box = new THREE.Box3().setFromObject(scene, true);
      const k = 1.8677 / Math.max(box.max.y - box.min.y, 1e-6); // the hero's T-pose height (export-hero-obj.mjs)
      scene.scale.multiplyScalar(k);
      scene.position.y -= box.min.y * k;
    } else {
      hips.getWorldPosition(_v);
      const heroHips = this._heroHipsY();
      scene.scale.multiplyScalar(heroHips / Math.max(_v.y, 1e-6));
    }
    scene.updateMatrixWorld(true);

    this.scene = scene;
    this.wrap = wrap;
    this.bones = bones;
    this.skinned = skinned;
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    for (const [k, c] of Object.entries(clips)) this.actions[k] = this.mixer.clipAction(c);

    this._grip();
    toRest();
    if (this.cfg.gear) this._gear();
    this._attach();
    this.ready = true;
  }

  /** The hero's hips (pelvis joint) height in his idle stance, from a rest-pose hero. */
  _heroHipsY() {
    const rest = this._rest ?? (this._rest = this.p.restHero());
    rest.root.updateMatrixWorld(true);
    return rest.pelvis.getWorldPosition(_v2).y;
  }

  /** Where his sword sits in the right hand: measured from the two-handed hold of the idle clip. */
  _grip() {
    const B = this.bones, R = B.RightHand, L = B.LeftHand, RM = B.RightHandMiddle1 ?? R, LM = B.LeftHandMiddle1 ?? L;
    const idle = this.actions.idle;
    const pR = new THREE.Vector3(), pL = new THREE.Vector3(), m1 = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    let n = 0;
    if (idle) {
      idle.reset().play();
      idle.setEffectiveWeight(1);
      idle.paused = true;
      const d = idle.getClip().duration;
      for (let i = 0; i < 6; i++) {
        idle.time = (d * i) / 6;
        this.mixer.update(0);
        this.scene.updateMatrixWorld(true);
        inv.copy(R.matrixWorld).invert();
        const palm = (a, b) => a.getWorldPosition(_v).add(b.getWorldPosition(_v2)).multiplyScalar(0.5);
        pR.add(palm(R, RM).applyMatrix4(inv));
        pL.add(palm(L, LM).applyMatrix4(inv));
        m1.add(RM.getWorldPosition(_v).applyMatrix4(inv));
        n++;
      }
      idle.stop();
    }
    if (!n) {
      pR.set(0, 0.08, 0);
      pL.set(0, 0.08, -0.1);
      m1.set(0, 0.1, 0);
      n = 1;
    }
    pR.divideScalar(n);
    pL.divideScalar(n);
    m1.divideScalar(n);
    const flip = this.cfg.swordFlip ? -1 : 1;
    this.gripOrigin = pR.clone().add(pL).multiplyScalar(0.5);
    this.gripBlade = pR.clone().sub(pL).normalize().multiplyScalar(flip);
    this.gripEdge = m1.clone().normalize();
  }

  /** `?hero=mixamo`: his head, shoulder plate, belts, coat and cape hung on the Ninja's bones. */
  _gear() {
    const rest = this._rest ?? (this._rest = this.p.restHero());
    const M = this.p.rig.materials;
    const key = new Map(Object.entries(rest.materials).map(([k, m]) => [m, k]));
    // his T-pose (the Mixamo bind pose)
    rest.arms.R.upper.rotation.set(0, 0, -Math.PI / 2);
    rest.arms.L.upper.rotation.set(0, 0, Math.PI / 2);
    rest.root.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    const B = this.bones;
    const map = new Map([
      [rest.head, ['Head', 'Neck']],
      [rest.chest, ['Spine2', 'Spine2']],
      [rest.spine, ['Spine1', 'Spine1']],
      [rest.pelvis, ['Hips', 'Hips']],
      [rest.body, ['Hips', 'Hips']],
      [rest.pauldron, ['RightArm', 'RightArm']],
      [rest.arms.R.upper, ['RightArm', 'RightArm']],
      [rest.arms.L.upper, ['LeftArm', 'LeftArm']],
    ]);
    const take = new Set(['shoulders', 'waist', 'back']);
    const pelvisY = rest.pelvis.getWorldPosition(_v2).y;
    const meshes = [];
    rest.root.traverse((o) => {
      if (!o.isMesh || o === rest.flask || !o.visible) return;
      let s = null;
      for (let a = o; a; a = a.parent) if (a.userData.slot) { s = a.userData.slot; break; }
      let under = false;
      for (let a = o; a; a = a.parent) if (a === rest.head) under = true;
      if (s === 'weapon') return;
      if (under || take.has(s)) meshes.push([o, s]);
    });
    const wrapInv = new THREE.Matrix4().copy(this.wrap.matrixWorld).invert();
    for (const [o, s] of meshes) {
      let j = o.parent;
      while (j && !map.has(j)) j = j.parent;
      let [bn, an] = j ? map.get(j) : ['Hips', 'Hips'];
      // the coat's skirts below the belt swing with the thigh on their side
      if (s === 'waist') {
        o.geometry.computeBoundingSphere();
        const c = _v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
        if (c.y < pelvisY - 0.15 && c.z > -0.03) bn = an = c.x < 0 ? 'RightUpLeg' : 'LeftUpLeg';
      }
      const b = B[bn], a = B[an] ?? b;
      if (!b) continue;
      const Wj = (j ?? rest.root).matrixWorld;
      // the joint's frame put at the anchor bone (bind pose, in the wrap's space)
      a.getWorldPosition(_v).applyMatrix4(wrapInv);
      Wj.decompose(_v2, _q, _s);
      const A = _m.compose(_v, _q, _s);
      const local = _m2.copy(b.matrixWorld).premultiply(wrapInv).invert().multiply(A).multiply(new THREE.Matrix4().copy(Wj).invert()).multiply(o.matrixWorld);
      const mat = M[key.get(o.material)] ?? o.material;
      const c = new THREE.Mesh(o.geometry, mat);
      local.decompose(c.position, c.quaternion, c.scale);
      c.userData.noBatch = true;
      c.name = `mixGear.${s ?? 'head'}`;
      b.add(c);
    }
    for (const m of rest.mats) if (!Object.values(M).includes(m)) m.dispose();
  }

  /** Hang the body on the player's root; hide the rig's own meshes; point the FX anchors at bones. */
  _attach() {
    const rig = this.p.rig;
    if (this.wrap.parent !== rig.root) rig.root.add(this.wrap);
    markCaster(this.wrap);
    const keep = new Set();
    rig.sword.traverse((o) => keep.add(o));
    this.wrap.traverse((o) => keep.add(o));
    this.hidden = [];
    rig.root.traverse((o) => {
      if (o.isMesh && !keep.has(o)) this.hidden.push(o);
    });
    const B = this.bones;
    const swap = new Map([
      [rig.chest, B.Spine2], [rig.pelvis, B.Hips], [rig.head, B.Head], [rig.spine, B.Spine1],
      [rig.arms.R.upper, B.RightArm], [rig.arms.R.fore, B.RightForeArm], [rig.arms.L.upper, B.LeftArm], [rig.arms.L.fore, B.LeftForeArm],
      [rig.legs.R.thigh, B.RightUpLeg], [rig.legs.L.thigh, B.LeftUpLeg], [rig.legs.R.shin, B.RightLeg], [rig.legs.L.shin, B.LeftLeg],
      [rig.legs.R.foot, B.RightFoot], [rig.legs.L.foot, B.LeftFoot],
    ]);
    const re = (arr) => arr && arr.forEach((o, i) => swap.get(o) && (arr[i] = swap.get(o)));
    re(rig.fxPoints);
    for (const c of rig.ghostChains ?? []) re(c);
  }

  /** The player's rig was rebuilt (a gear change): hang the body on the new one. */
  rebind() {
    this._wrapPlay();
    if (!this.ready) return;
    this.saved = null;
    this._attach();
  }

  // ---------------------------------------------------------------- per frame
  /** Put the sword back where the animator left it (before the next animator step). */
  restore() {
    const s = this.saved, sw = this.p.rig?.sword;
    if (!s || !sw) return;
    sw.position.copy(s.p);
    sw.quaternion.copy(s.q);
    sw.scale.copy(s.s);
    this.saved = null;
  }

  update(dt) {
    if (!this.ready) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    for (const o of this.hidden) o.visible = false;
    this.wrap.visible = this.p.object3d.visible !== false;
    this._pose(dt);
    this.mixer.update(0);
    this.wrap.updateMatrixWorld(true);
    this._sword();
  }

  _play(id, clip, time, blend = 0.15) {
    const action = this.actions[clip];
    if (!action) return;
    if (!this.track || this.track.id !== id) {
      if (this.prev && this.prev.action !== action) this.prev.action.stop();
      if (this.track && this.track.action !== action) this.prev = this.track;
      else this.prev = null;
      this.track = { id, clip, action, time };
      this.blendT = 0;
      this.blendDur = Math.max(blend, 1e-3);
      action.reset().play();
      action.paused = true;
    }
    this.track.time = time;
  }

  _pose(dt) {
    const p = this.p, st = p.state, key = this.animKey;
    const T = fin(p.stateT);
    const atk = p.atk;
    if ((st === 'attack' || st === 'heavy') && atk?.def) {
      const def = atk.def, clip = swingClip(def), sw = MIX_SWING[clip];
      const W = fin(def.windup), A = fin(def.active), R = fin(def.recovery);
      const t = fin(atk.t), cA = W + A * 0.5, tot = W + A + R;
      const f = t < cA ? sw.start + (sw.contact - sw.start) * (t / Math.max(cA, 1e-3)) : sw.contact + (sw.end - sw.contact) * Math.min(1, (t - cA) / Math.max(tot - cA, 1e-3));
      this._play(`swing:${p.enterN}`, clip, f / MIX_FPS, Math.min(0.08, W * 0.8 + 0.02));
    } else if (MIX_MOVES[st === 'iai' ? st : key] || MIX_MOVES[st]) {
      // (the animator's key first: 'deadDown', 'backstep', 'guardBreak'; One Breath's draw plays the flurry's key)
      const mv = MIX_MOVES[st === 'iai' ? st : key] ?? MIX_MOVES[st];
      const a = this.actions[mv.clip];
      const d = a ? a.getClip().duration : 1;
      let time;
      if (mv.loop) {
        const id = `move:${mv.clip}`;
        const prevT = this.track?.id === id ? this.track.time : 0;
        time = (prevT + dt * (mv.rate ?? 1)) % d;
      } else if (mv.bounce) {
        const [to, over] = mv.bounce, u = Math.min(1, T / over);
        time = (to * (u < 0.5 ? u * 2 : Math.max(0, 2 - 2 * u))) / MIX_FPS;
      } else {
        time = (mv.from + (mv.to - mv.from) * Math.min(1, T / mv.over)) / MIX_FPS;
      }
      this._play(mv.loop ? `move:${mv.clip}` : `move:${key}:${p.enterN}`, mv.clip, Math.min(time, d), 0.1);
    } else {
      // on his feet: stand, walk, run, back off, side-step, at his real speed
      const vx = fin(p.groundVel?.x), vz = fin(p.groundVel?.z), sp = Math.hypot(vx, vz);
      const y = fin(p.yaw);
      const fwd = vx * Math.sin(y) + vz * Math.cos(y);
      const right = vx * -Math.cos(y) + vz * Math.sin(y);
      let clip = 'idle';
      if (sp > 0.35) {
        if (Math.abs(right) > Math.abs(fwd) * 1.2) clip = right > 0 ? 'strafeR' : 'strafeL';
        else if (fwd < -0.2) clip = 'back';
        else clip = sp < 2.4 ? 'walk' : 'run';
      }
      const a = this.actions[clip];
      if (!a) return;
      const d = a.getClip().duration;
      const k = this.scene.scale.x * (this.cfg.fit === 'box' ? 0.01 : 1); // (the clips' metres at this model's size)
      const rate = clip === 'idle' ? 1 : sp / Math.max(MIX_LOOP_SPEED[clip] * Math.max(k, 0.2), 0.1);
      const id = `loco:${clip}`;
      if (this.track?.id !== id) this.loopPhase = clip === 'idle' ? 0 : this.loopPhase; // (feet keep their phase between gaits)
      this.loopPhase = (this.loopPhase + (dt * rate) / d) % 1;
      this._play(id, clip, this.loopPhase * d, 0.2);
    }
    // the weights: the new clip fades in over the old
    this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
    const w = this.blendT * this.blendT * (3 - 2 * this.blendT);
    const cur = this.track;
    if (!cur) return;
    cur.action.time = cur.time;
    cur.action.setEffectiveWeight(this.prev ? w : 1);
    if (this.prev) {
      if (w >= 1) {
        this.prev.action.stop();
        this.prev = null;
      } else {
        this.prev.action.time = this.prev.time;
        this.prev.action.setEffectiveWeight(1 - w);
      }
    }
  }

  /** His sword in the Mixamo hands (drawn only: restore() puts it back before the animator runs). */
  _sword() {
    const sw = this.p.rig?.sword, R = this.bones.RightHand;
    if (!sw || !R || !sw.parent) return;
    this.saved = { p: sw.position.clone(), q: sw.quaternion.clone(), s: sw.scale.clone() };
    sw.matrixWorld.decompose(_v2, _q, _s); // (keep the sword's drawn size)
    const W = R.matrixWorld;
    const o = _v.copy(this.gripOrigin).applyMatrix4(W);
    _z.copy(this.gripBlade).transformDirection(W);
    _x.copy(this.gripEdge).transformDirection(W);
    _x.addScaledVector(_z, -_x.dot(_z)).normalize();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    _m.compose(o, _q, _s);
    _m2.copy(sw.parent.matrixWorld).invert().multiply(_m);
    _m2.decompose(sw.position, sw.quaternion, sw.scale);
    sw.updateMatrixWorld(true);
  }
}

function fin(v, d = 0) {
  return Number.isFinite(v) ? v : d;
}

/** The clip a swing plays: the light string by its place, the rest by name. */
function swingClip(def) {
  const n = def.combo | 0;
  if ((def.kind === 'light' || def.kind === 'slam') && n >= 1 && n <= MIX_LIGHT.length && !def.button) return MIX_LIGHT[n - 1];
  const name = `${def.name ?? ''} ${def.label ?? ''}`;
  for (const [re, clip] of MIX_BY_NAME) if (re.test(name)) return clip;
  return def.kind === 'light' ? 'slash1' : 'heavy';
}
