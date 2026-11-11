import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { LAYER_CASTER, LAYER_CASTER_RIGID, RIGID_TEX, RIGID_MAX } from './shaderLib.js';

// Rigid batching: an actor built from many small rigid meshes (the hero: ~140, the wyrm: ~180)
// is drawn with ONE draw call per material in the world pass and ONE draw call in the moon shadow
// pass, instead of one per mesh in each. On a phone the per-draw overhead of those meshes, paid
// twice, was most of the frame.
//
// How: every batched mesh ("source") becomes a BONE. Its vertices are copied, still in the mesh's
// own local space, into one merged geometry per (material, renderOrder), each vertex tagged with
// its bone's slot (`aRigid`). The bones' world matrices live in one float texture (`U.uBoneTex`,
// shaderLib.js RIGID_TEX) that the surface-glyph vertex shader and the pipeline's rigid depth
// material read with `rigidMatrix()` (RIGID_VERT_GLSL). `sync()` copies every source's
// `matrixWorld` into the texture once per frame (pipeline.render), so whatever moves, scales or
// hides a source mesh keeps working exactly as before: nothing is assumed to be static.
//
// The sources STAY in the scene graph (gameplay, FX, the Lab and the tests traverse them and read
// their matrixWorld), with their `visible` flags and their layer mask intact, but their `layers`
// is swapped for one no camera can see, so three never draws them. A hidden source (itself or an
// ancestor below the actor root not `visible`) writes an all-zero matrix: its triangles collapse.
//
// Shadows: the depth pass does not care about materials, so each actor also gets one SHADOW mesh
// (positions + bone slots of its casters, drawn only by the shadow camera on LAYER_CASTER_RIGID).
// It casts while one of its sources is a caster (LAYER_CASTER in its mask, read every sync, so
// markCaster / dragon.setShadowCasting work before or after the build).
//
// Not batched (left as ordinary meshes): materials without `userData.rigid` (only
// createSurfaceGlyphMaterial sets it), instanced / skinned meshes, geometry that is rewritten at
// runtime (any attribute not StaticDrawUsage: the wyrm's wing membranes), morph targets, a partial
// drawRange, meshes with onBeforeRender / onAfterRender, and `userData.noBatch`.

const CASTER_BIT = 1 << LAYER_CASTER;
const RIGID_CASTER_BIT = 1 << LAYER_CASTER_RIGID;
const NO_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const NO_AFTER = THREE.Object3D.prototype.onAfterRender;
const noRaycast = () => {};
const _m = new THREE.Matrix4();
// the shadow meshes' own material is never used: the shadow pass draws with an override material
const SHADOW_PROXY = new THREE.MeshBasicMaterial({ name: 'rigidShadowProxy' });

/** A batched source's layers: the mask stays readable and writable, but nothing ever sees it. */
class HiddenLayers extends THREE.Layers {
  test() {
    return false;
  }
}

/** True for a mesh that is drawn through a rigid batch (kept in the graph, never drawn itself). */
export function isRigidSource(o) {
  return o?.layers instanceof HiddenLayers;
}

/** The bone registry behind `U.uBoneTex`: slots, the matrix texture and the live batches. */
class RigidBones {
  constructor() {
    this.data = new Float32Array(RIGID_TEX * RIGID_TEX * 4);
    this.data[0] = this.data[5] = this.data[10] = this.data[15] = 1; // slot 0 (never read)
    this.texture = new THREE.DataTexture(this.data, RIGID_TEX, RIGID_TEX, THREE.RGBAFormat, THREE.FloatType);
    this.texture.name = 'rigidBones';
    this.texture.needsUpdate = true;
    this.free = []; // released slots, reused first
    this.top = 1; // the next never-used slot (0 is reserved)
    this.sets = []; // live batch sets (one per actor)
    this.batches = []; // their batches, flat: { mesh, root, slots, sources }
    /** True when the last sync found a visible actor that casts shadows (pipeline.render). */
    this.casting = false;
    this._warned = false;
  }

  /** Bones in use. */
  get count() {
    return this.top - 1 - this.free.length;
  }

  /** Slots still available. */
  get room() {
    return RIGID_MAX - this.top + this.free.length;
  }

  _alloc() {
    return this.free.length ? this.free.pop() : this.top++;
  }

  _release(slot) {
    this.data.fill(0, slot * 16, slot * 16 + 16);
    this.free.push(slot);
  }

  /**
   * Once per frame, after the scene's matrixWorld update and before the passes draw: write every
   * bone's world matrix (zero when hidden) and put each batch mesh on the world layer and each
   * actor's shadow mesh on the rigid caster layer (or on none). No allocation.
   */
  sync() {
    const d = this.data, S = this.sets;
    let casting = false, wrote = false;
    for (let s = 0; s < S.length; s++) {
      const set = S[s], root = set.root, B = set._batches;
      if (root.visible === false) continue; // three skips the whole actor
      let cast = false;
      for (let b = 0; b < B.length; b++) {
        const batch = B[b], slots = batch.slots, sources = batch.sources;
        let world = false, shown = false;
        for (let i = 0; i < slots.length; i++) {
          const src = sources[i], at = slots[i] * 16;
          const mask = src.layers.mask;
          if (mask & 1) world = true;
          let vis = true;
          for (let o = src; o !== root; o = o.parent) {
            if (!o || o.visible === false) {
              vis = false; // hidden, or no longer under the actor
              break;
            }
          }
          if (vis) {
            const e = src.matrixWorld.elements;
            for (let k = 0; k < 16; k++) d[at + k] = e[k];
            shown = true;
            if (mask & CASTER_BIT) cast = true;
          } else {
            for (let k = 0; k < 16; k++) d[at + k] = 0;
          }
        }
        batch.mesh.visible = shown;
        batch.mesh.layers.mask = world ? 1 : 0;
      }
      const shadow = set.shadow;
      if (shadow) {
        shadow.visible = cast;
        shadow.layers.mask = cast ? RIGID_CASTER_BIT : 0;
        if (cast) casting = true;
      }
      wrote = true;
    }
    this.casting = casting;
    if (wrote) this.texture.needsUpdate = true;
  }
}

const REGISTRIES = new WeakMap();

/** The bone registry of the shared uniforms `U` (created on first use; fills `U.uBoneTex`). */
export function rigidBones(U) {
  let reg = REGISTRIES.get(U);
  if (!reg) {
    reg = new RigidBones();
    REGISTRIES.set(U, reg);
    if (U.uBoneTex) U.uBoneTex.value = reg.texture;
    else U.uBoneTex = { value: reg.texture };
  }
  return reg;
}

function batchable(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  if (o.userData.rigidBatch || o.userData.noBatch || isRigidSource(o)) return false;
  const mat = o.material, g = o.geometry;
  if (!mat || Array.isArray(mat) || mat.userData?.rigid !== true) return false;
  if (o.onBeforeRender !== NO_BEFORE || o.onAfterRender !== NO_AFTER) return false;
  const pos = g?.attributes?.position;
  if (!pos || pos.count < 3 || g.attributes.aRigid) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  for (const k in g.morphAttributes) if (g.morphAttributes[k]) return false;
  for (const name in g.attributes) {
    const a = g.attributes[name];
    // (an interleaved attribute has no usage of its own: left alone too)
    if (a.usage !== THREE.StaticDrawUsage || a.isInstancedBufferAttribute || a.count !== pos.count || a.itemSize > 4) return false;
  }
  if (g.index && g.index.usage !== THREE.StaticDrawUsage) return false;
  return true;
}

/** True when `o` is mirrored relative to `root` (an odd number of negative scales on the way up). */
function mirrored(o, root) {
  _m.identity();
  for (let n = o; n && n !== root; n = n.parent) {
    if (n.matrixAutoUpdate) n.updateMatrix();
    _m.premultiply(n.matrix);
  }
  return _m.determinant() < 0;
}

function copyAttribute(src, out, at, itemSize) {
  const n = src.count * itemSize;
  if (src.array instanceof Float32Array && !src.normalized) {
    out.set(n === src.array.length ? src.array : src.array.subarray(0, n), at);
    return;
  }
  for (let i = 0; i < src.count; i++) {
    out[at + i * itemSize] = src.getX(i);
    if (itemSize > 1) out[at + i * itemSize + 1] = src.getY(i);
    if (itemSize > 2) out[at + i * itemSize + 2] = src.getZ(i);
    if (itemSize > 3) out[at + i * itemSize + 3] = src.getW(i);
  }
}

function batchMesh(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.rigidBatch = true;
  mesh.frustumCulled = false; // its vertices are placed by the bones, not by its own matrix
  mesh.matrixAutoUpdate = false;
  mesh.raycast = noRaycast;
  return mesh;
}

/** The batches of one actor (batchRigid). `dispose()` undoes them. */
class RigidBatchSet {
  constructor(registry, root) {
    this.registry = registry;
    this.root = root;
    /** The world-pass batch meshes (children of the root, `userData.rigidBatch`), one per material. */
    this.meshes = [];
    /** The actor's one shadow-pass mesh (child of the root, `userData.rigidBatch`), or null. */
    this.shadow = null;
    /** Every batched source mesh (still in the graph, never drawn itself). */
    this.sources = [];
    this._batches = [];
  }

  /** Bones this set holds. */
  get bones() {
    return this.sources.length;
  }

  /** One world-pass batch from meshes sharing a material (and renderOrder). */
  _build(list) {
    const reg = this.registry;
    // attribute layout: every attribute any source has; a source that disagrees on an item size
    // stays an ordinary mesh
    const layout = new Map();
    const sources = [];
    for (const m of list) {
      const attrs = m.geometry.attributes;
      let ok = true;
      for (const name in attrs) {
        const size = layout.get(name);
        if (size !== undefined && size !== attrs[name].itemSize) ok = false;
      }
      if (!ok) continue;
      for (const name in attrs) if (!layout.has(name)) layout.set(name, attrs[name].itemSize);
      sources.push(m);
    }
    if (!sources.length) return;
    if (sources.length > reg.room) {
      if (!reg._warned) console.warn(`rigidBatch: out of bone slots (${RIGID_MAX}); some meshes stay unbatched`);
      reg._warned = true;
      return;
    }
    let verts = 0, indices = 0;
    for (const m of sources) {
      const g = m.geometry;
      verts += g.attributes.position.count;
      indices += g.index ? g.index.count : g.attributes.position.count;
    }
    const arrays = new Map();
    for (const [name, size] of layout) arrays.set(name, new Float32Array(verts * size)); // missing: zeros
    const rigid = new Float32Array(verts);
    const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const slots = new Uint16Array(sources.length);
    let v0 = 0, i0 = 0;
    for (let s = 0; s < sources.length; s++) {
      const m = sources[s], g = m.geometry, n = g.attributes.position.count;
      const slot = (slots[s] = reg._alloc());
      for (const [name, size] of layout) {
        const a = g.attributes[name];
        if (a) copyAttribute(a, arrays.get(name), v0 * size, size);
      }
      rigid.fill(slot, v0, v0 + n);
      const ic = g.index ? g.index.count : n;
      if (g.index) {
        const src = g.index.array;
        for (let j = 0; j < ic; j++) index[i0 + j] = src[j] + v0;
      } else {
        for (let j = 0; j < ic; j++) index[i0 + j] = v0 + j;
      }
      // a mirrored source: three would flip its front face per draw, so its winding is flipped here
      if (mirrored(m, this.root)) {
        for (let j = 0; j + 2 < ic; j += 3) {
          const t = index[i0 + j + 1];
          index[i0 + j + 1] = index[i0 + j + 2];
          index[i0 + j + 2] = t;
        }
      }
      v0 += n;
      i0 += ic;
    }
    const geo = new THREE.BufferGeometry();
    for (const [name, size] of layout) geo.setAttribute(name, new THREE.BufferAttribute(arrays.get(name), size));
    geo.setAttribute('aRigid', new THREE.BufferAttribute(rigid, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));

    const first = sources[0];
    const mesh = batchMesh(geo, first.material);
    mesh.name = 'rigidBatch';
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = 1; // the world pass only; the set's shadow mesh casts for it
    this.root.add(mesh);

    const batch = { mesh, root: this.root, slots, sources };
    reg.batches.push(batch);
    this._batches.push(batch);
    this.meshes.push(mesh);
    for (const m of sources) this.sources.push(m);
  }

  /**
   * The actor's shadow mesh: the positions and bone slots of every batched source that is a caster
   * now (of all of them when none is yet: markCaster may come later), in one geometry. Drawn only
   * by the shadow camera, with the pipeline's rigid depth material (double-sided: no winding fix).
   */
  _buildShadow() {
    const B = this._batches;
    let anyCaster = false;
    for (const m of this.sources) if (m.layers.mask & CASTER_BIT) anyCaster = true;
    const casts = (m) => !anyCaster || (m.layers.mask & CASTER_BIT) !== 0;
    let verts = 0, indices = 0;
    for (const b of B) {
      for (const m of b.sources) {
        if (!casts(m)) continue;
        const g = m.geometry;
        verts += g.attributes.position.count;
        indices += g.index ? g.index.count : g.attributes.position.count;
      }
    }
    if (!verts) return;
    const position = new Float32Array(verts * 3), rigid = new Float32Array(verts);
    const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let v0 = 0, i0 = 0;
    for (const b of B) {
      for (let s = 0; s < b.sources.length; s++) {
        const m = b.sources[s];
        if (!casts(m)) continue;
        const g = m.geometry, n = g.attributes.position.count;
        copyAttribute(g.attributes.position, position, v0 * 3, 3);
        rigid.fill(b.slots[s], v0, v0 + n);
        const ic = g.index ? g.index.count : n;
        if (g.index) {
          const src = g.index.array;
          for (let j = 0; j < ic; j++) index[i0 + j] = src[j] + v0;
        } else {
          for (let j = 0; j < ic; j++) index[i0 + j] = v0 + j;
        }
        v0 += n;
        i0 += ic;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('aRigid', new THREE.BufferAttribute(rigid, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = batchMesh(geo, SHADOW_PROXY);
    mesh.name = 'rigidShadow';
    mesh.layers.mask = anyCaster ? RIGID_CASTER_BIT : 0;
    this.root.add(mesh);
    this.shadow = mesh;
  }

  /** The sources stop drawing themselves; the set starts syncing. */
  _finish() {
    if (!this._batches.length) return;
    this._buildShadow();
    for (const m of this.sources) {
      const hidden = new HiddenLayers();
      hidden.mask = m.layers.mask;
      m.layers = hidden;
    }
    this.registry.sets.push(this);
  }

  /**
   * Remove the batch meshes, free their geometry and bone slots, and give the sources their layers
   * back (they draw themselves again). Safe to call twice.
   */
  dispose() {
    const reg = this.registry;
    for (const b of this._batches) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      for (let i = 0; i < b.slots.length; i++) {
        const m = b.sources[i];
        if (isRigidSource(m)) {
          const layers = new THREE.Layers();
          layers.mask = m.layers.mask;
          m.layers = layers;
        }
        reg._release(b.slots[i]);
      }
      const k = reg.batches.indexOf(b);
      if (k >= 0) reg.batches.splice(k, 1);
    }
    if (this.shadow) {
      this.shadow.removeFromParent();
      this.shadow.geometry.dispose();
      this.shadow = null;
    }
    const k = reg.sets.indexOf(this);
    if (k >= 0) reg.sets.splice(k, 1);
    this._batches.length = 0;
    this.meshes.length = 0;
    this.sources.length = 0;
  }
}

/**
 * Batch the rigid surface-glyph meshes under the actor `root`: one draw call per material in the
 * world pass and one in the shadow pass, instead of one per mesh in each (see the header). Call it
 * once the actor is built and marked a caster, and again (after `dispose()` on the previous set)
 * whenever its meshes are rebuilt. Returns the set: `{ meshes, shadow, sources, bones, dispose() }`;
 * with batching off (`?nobatch` → CONFIG.render.batch false, or `opts.enabled: false`) it is empty
 * and nothing is changed. Build-time cost (allocates): never call it per frame.
 */
export function batchRigid(U, root, opts = {}) {
  const set = new RigidBatchSet(rigidBones(U), root);
  if (!(opts.enabled ?? (CONFIG.render.batch !== false))) return set;
  const groups = new Map();
  root.traverse((o) => {
    if (!batchable(o)) return;
    const key = `${o.material.id}:${o.renderOrder}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  });
  for (const list of groups.values()) set._build(list);
  set._finish();
  return set;
}
