import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { injectLabStyle } from './labStyle.js';

// Lab model viewer: frames the hero or the dragon from any angle around ITS OWN facing, so the models
// can be compared with side-view concept sheets (the game camera is a fixed 58° top-down view).
// Contract + usage: docs/ARCHITECTURE.md → Lab → Model viewer, src/dev/README.md.
//
// It touches the game only through documented hooks:
//   game.viewOverride = { pos, target, focus }   camera placement, applied by main.js after the rig
//   world.debug.setVisible(bool)                 "dark" renders (actors alone on black)
//   dragon.debug.setAI(false), player.debug.god  set on enter, restored on exit if it changed them
//   game.mouseGround                             pinned ahead of the hero (see pinAim)
//   <other actor>.object3d.visible               `solo`: false for the render only (see _soloHide)
//   #ui.lab-mv                                   hides every HUD layer except the Lab panel

const DEG = Math.PI / 180;
const MARGIN = 1.1; // auto-fit: ~10% breathing room around the bounding box
const AIM_DIST = 6; // hero aim pin, metres ahead of it
const PITCH_MIN = -30;
const PITCH_MAX = 89;
const DIST_MIN = 0.5;
const DIST_MAX = 200;
const HUD_CLASS = 'lab-mv';
const TARGETS = new Set(['hero', 'dragon']);
const FALLBACK_BOX = { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] };
/** A 1 x 2 x 1 m box (actor with no visible mesh, e.g. a dead dragon): corners + bounds. */
function fallbackPoints() {
  const { min, max } = FALLBACK_BOX, pts = [];
  for (let i = 0; i < 8; i++) pts.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
  return { min, max, pts };
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => +v.toFixed(2);

/** Named angles used by the Lab buttons (yaw / pitch in degrees; `game` = the gameplay camera). */
export const VIEW_ANGLES = [
  ['front', 'Front', { yaw: 0, pitch: 8 }],
  ['3-4', '3/4', { yaw: 35, pitch: 8 }],
  ['side', 'Side', { yaw: 90, pitch: 8 }],
  ['back', 'Back', { yaw: 180, pitch: 8 }],
  ['game', 'Game', { game: true }],
];

export class ModelViewer {
  constructor(game, lab) {
    this.game = game;
    this.lab = lab;
    this.state = null; // the active view (see set()), null when off
    this._ov = { pos: new THREE.Vector3(), target: new THREE.Vector3(), focus: new THREE.Vector3() };
    this._v = new THREE.Vector3();
    this._restoreAI = false;
    this._restoreGod = false;
    this._dark = false; // world hidden by us
    this._aimYaw = null;
    this._solo = null; // { obj, vis }: the other actor, hidden between postUpdate and the next update
  }

  get active() {
    return this.state !== null;
  }

  actor(name) {
    return name === 'dragon' ? this.game.dragon : this.game.player;
  }

  /**
   * Enter / update the view. opts: { target: 'hero'|'dragon', yaw, pitch, dist, height, dark,
   * solo?, forward?, lockYaw?, game? } (degrees / metres; see ARCHITECTURE.md). null / false = exit.
   * Returns a summary of the framing (with the fitted dist / height), or null if n/a.
   */
  set(opts) {
    if (opts === null || opts === undefined || opts === false) return this.exit();
    this._soloRestore(); // between frames the other actor is still hidden from the last render
    const o =typeof opts === 'string' ? { target: opts } : typeof opts === 'object' ? opts : {};
    const target = TARGETS.has(o.target) ? o.target : (this.state?.target ?? 'hero');
    const a = this.actor(target);
    if (!a?.position || !a.object3d) return null;
    const game = o.game === true;
    const pitch0 = num(o.pitch) ? o.pitch : game ? CONFIG.camera.pitch / DEG : 8;
    const enter = !this.state;
    this.state = {
      target,
      yaw: num(o.yaw) ? o.yaw : 0,
      pitch: clamp(pitch0, PITCH_MIN, PITCH_MAX),
      dist: num(o.dist) && o.dist > 0 ? clamp(o.dist, DIST_MIN, DIST_MAX) : null,
      height: num(o.height) ? o.height : null,
      forward: num(o.forward) ? o.forward : null,
      dark: !!o.dark,
      solo: typeof o.solo === 'boolean' ? o.solo : !!o.dark, // hide the other actor (default: with dark)
      game,
      lockYaw: !!o.lockYaw,
      yaw0: num(a.yaw) ? a.yaw : 0,
      // filled by _fit()
      look: { x: 0, y: 1, z: 0 },
      fitDist: 10,
      shift: 0,
      aspect: 0,
      panelOpen: null,
    };
    if (enter) this._enter();
    // re-sample the hero's aim on every call (a roll may have turned it)
    const py = this.game.player?.yaw;
    if (num(py)) this._aimYaw = py;
    this._setDark(this.state.dark);
    this._fit();
    this.frame();
    this.game.viewOverride = this._ov;
    return this.describe();
  }

  exit() {
    if (!this.state) return 'off';
    this.state = null;
    this.game.viewOverride = null;
    this._soloRestore();
    this._setDark(false);
    this._hud(false);
    const d = this.game.dragon, pd = this.game.player?.debug;
    if (this._restoreAI && typeof d?.debug?.setAI === 'function') {
      try {
        d.debug.setAI(true);
      } catch (err) {
        console.error('[lab] model view: restore AI failed', err);
      }
    }
    if (this._restoreGod && pd && typeof pd === 'object') pd.god = false;
    this._restoreAI = this._restoreGod = false;
    this._aimYaw = null;
    return 'off';
  }

  /** Current framing, numbers rounded (what a console caller needs to reproduce it with fixed dist / height). */
  describe() {
    const s = this.state;
    if (!s) return null;
    return {
      target: s.target,
      yaw: s.yaw,
      pitch: r2(s.pitch),
      dist: r2(s.dist ?? s.fitDist),
      height: r2(s.look.y),
      forward: r2(s.look.z),
      dark: s.dark,
      solo: s.solo,
      game: s.game,
      lockYaw: s.lockYaw,
      auto: { dist: s.dist === null, height: s.height === null },
    };
  }

  /** Re-fit (auto dist / centre) to the current pose, aspect and Lab panel width. */
  refit() {
    if (!this.state) return null;
    this._soloRestore();
    this._fit();
    this.frame();
    return this.describe();
  }

  /** lab.update (before the actors): keep the hero's mouse aim pinned so it never chases the cursor. */
  pinAim() {
    this._soloRestore(); // the actors' own logic always sees its own `visible` flag
    if (!this.state) return;
    const p = this.game.player?.position, mg = this.game.mouseGround;
    const y = this._aimYaw;
    if (!p || !mg || typeof mg.set !== 'function' || !num(y) || !num(p.x + p.z)) return;
    mg.set(p.x + Math.sin(y) * AIM_DIST, 0, p.z + Math.cos(y) * AIM_DIST);
  }

  /** lab.postUpdate (after the actors, before main.js applies the override): follow the actor. */
  frame() {
    const s = this.state;
    if (!s) return;
    const a = this.actor(s.target);
    const P = a?.position;
    if (!P || !num(P.x + P.y + P.z)) return; // keep last frame's override
    const cam = this.game.camera;
    // re-fit on resize or when the Lab panel opens / closes (cheap checks: no layout read per frame)
    if ((num(cam?.aspect) && Math.abs(cam.aspect - s.aspect) > 1e-3) || !!this.lab?.open !== s.panelOpen) this._fit();

    const ref = s.lockYaw ? s.yaw0 : num(a.yaw) ? a.yaw : s.yaw0;
    const c = Math.cos(ref), sn = Math.sin(ref);
    const L = s.look;
    const lx = P.x + L.x * c + L.z * sn;
    const lz = P.z - L.x * sn + L.z * c;
    const ly = P.y + L.y;
    const h = s.game ? s.yaw * DEG : ref + s.yaw * DEG;
    const cp = Math.cos(s.pitch * DEG), sp = Math.sin(s.pitch * DEG);
    const dist = s.dist ?? s.fitDist;
    const dx = cp * Math.sin(h), dz = cp * Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    const sx = -rx * s.shift, sz = -rz * s.shift; // slide left so the actor centres right of the panel
    const ov = this._ov;
    ov.target.set(lx + sx, ly, lz + sz);
    ov.pos.set(lx + sx + dx * dist, ly + sp * dist, lz + sz + dz * dist);
    ov.focus.set(lx, ly, lz);
    if (s.solo) this._soloHide();
    else this._soloRestore();
  }

  /** Hide the non-target actor for this frame's render; pinAim() / exit() give its flag back. */
  _soloHide() {
    const other = this.actor(this.state.target === 'dragon' ? 'hero' : 'dragon')?.object3d;
    if (!other) return;
    if (this._solo?.obj !== other) {
      this._soloRestore();
      this._solo = { obj: other, vis: other.visible };
    }
    other.visible = false;
  }

  _soloRestore() {
    const h = this._solo;
    if (!h) return;
    this._solo = null;
    h.obj.visible = h.vis;
  }

  // ---------------------------------------------------------------- internals
  _enter() {
    const d = this.game.dragon, pd = this.game.player?.debug;
    this._restoreAI = false;
    if (d?.debug?.aiEnabled !== false && typeof d?.debug?.setAI === 'function') {
      try {
        d.debug.setAI(false);
        this._restoreAI = true;
      } catch (err) {
        console.error('[lab] model view: AI off failed', err);
      }
    }
    this._restoreGod = false;
    if (pd && typeof pd === 'object' && !pd.god) {
      pd.god = true;
      this._restoreGod = true;
    }
    this._hud(true);
  }

  _setDark(on) {
    const w = this.game.world;
    if (typeof w?.debug?.setVisible !== 'function') return;
    if (on && !this._dark) {
      w.debug.setVisible(false);
      this._dark = true;
    } else if (!on && this._dark) {
      w.debug.setVisible(true);
      this._dark = false;
    }
  }

  _hud(hide) {
    if (typeof document === 'undefined') return;
    try {
      if (hide) injectLabStyle();
      document.getElementById?.('ui')?.classList?.toggle(HUD_CLASS, !!hide);
    } catch (err) {
      console.error('[lab] model view: HUD toggle failed', err);
    }
  }

  /** Fraction of the window width (from the left) covered by the open Lab panel, 0 when closed. */
  _panelFrac() {
    const lab = this.lab, root = lab?.open ? lab.root : null;
    if (!root || typeof root.getBoundingClientRect !== 'function') return 0;
    try {
      const W = globalThis.innerWidth;
      const r = root.getBoundingClientRect();
      if (!num(W) || W <= 0 || !num(r?.right) || !(r.width > 0)) return 0;
      return r2(clamp((r.right + 12) / W, 0, 0.6));
    } catch {
      return 0;
    }
  }

  /**
   * Corner points of every visible mesh's own bounding box, in the actor's yaw frame (x = its left,
   * y = up, z = its front; metres, relative to the root), plus their overall box. Per-mesh corners
   * hug the silhouette far better than one big box (a dragon is mostly empty air). Dynamic geometry
   * (wing membranes) is re-measured. Allocates; called on set / refit / resize / panel toggle only.
   */
  _localPoints(a, yaw) {
    const obj = a.object3d, P = a.position;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const pts = [];
    const v = this._v;
    obj.updateMatrixWorld(true);
    obj.traverseVisible((o) => {
      const g = o.isMesh ? o.geometry : null;
      const pos = g?.attributes?.position;
      if (!pos) return;
      if (!g.boundingBox || pos.usage === THREE.DynamicDrawUsage) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb || bb.isEmpty()) return;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
        const wx = v.x - P.x, wz = v.z - P.z;
        const x = wx * c - wz * sn, y = v.y - P.y, z = wx * sn + wz * c;
        if (!num(x + y + z)) continue;
        pts.push(x, y, z);
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
    });
    return pts.length ? { min, max, pts } : fallbackPoints();
  }

  /**
   * Look point + auto distance. Auto look point: the bounding-box centre, then re-centred once on
   * the projected silhouette (so the actor sits in the middle of the free frame from any angle);
   * an explicit `height` / `forward` pins that axis. Auto dist: the closest camera that keeps every
   * point inside the free frame (right of the Lab panel when it is open) with MARGIN to spare.
   */
  _fit() {
    const s = this.state;
    const a = this.actor(s.target);
    if (!a?.object3d) return;
    // reference frame: its facing now, or the facing sampled at the call (lockYaw)
    const ref = s.lockYaw ? s.yaw0 : num(a.yaw) ? a.yaw : s.yaw0;
    let box;
    try {
      box = this._localPoints(a, ref);
    } catch (err) {
      console.error('[lab] model view: bounding box failed', err);
      box = fallbackPoints();
    }
    const { min, max, pts } = box;
    const L = s.look;
    L.x = s.forward !== null ? 0 : (min[0] + max[0]) / 2;
    L.z = s.forward !== null ? s.forward : (min[2] + max[2]) / 2;
    L.y = s.height !== null ? s.height : (min[1] + max[1]) / 2;

    const cam = this.game.camera;
    const aspect = num(cam?.aspect) && cam.aspect > 0 ? cam.aspect : 16 / 9;
    const vfov = (num(cam?.fov) ? cam.fov : CONFIG.camera.fov) * DEG;
    const near = num(cam?.near) ? cam.near : CONFIG.camera.near;
    const panel = this._panelFrac();
    const tv = Math.tan(vfov / 2), th = tv * aspect;
    const tx = (th * (1 - panel)) / MARGIN, ty = tv / MARGIN;

    // camera basis in the reference frame (game view: world-fixed yaw, relative to that frame)
    const t = s.game ? s.yaw * DEG - ref : s.yaw * DEG;
    const cp = Math.cos(s.pitch * DEG), sp = Math.sin(s.pitch * DEG);
    const dir = [cp * Math.sin(t), sp, cp * Math.cos(t)];
    const right = [Math.cos(t), 0, -Math.sin(t)];
    const up = [-sp * Math.sin(t), cp, -sp * Math.cos(t)];
    const n = pts.length;
    const fit = () => {
      let need = 0;
      for (let i = 0; i < n; i += 3) {
        const qx = pts[i] - L.x, qy = pts[i + 1] - L.y, qz = pts[i + 2] - L.z;
        const along = qx * dir[0] + qy * dir[1] + qz * dir[2];
        const x = Math.abs(qx * right[0] + qz * right[2]);
        const y = Math.abs(qx * up[0] + qy * up[1] + qz * up[2]);
        need = Math.max(need, along + x / tx, along + y / ty, along + near * 1.5);
      }
      return clamp(num(need) ? need : 10, DIST_MIN, DIST_MAX);
    };
    let d = fit();
    if (s.forward === null || s.height === null) {
      // re-centre on the projected silhouette at that distance (one pass is plenty)
      const dist0 = s.dist ?? d;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i += 3) {
        const qx = pts[i] - L.x, qy = pts[i + 1] - L.y, qz = pts[i + 2] - L.z;
        const depth = dist0 - (qx * dir[0] + qy * dir[1] + qz * dir[2]);
        if (!(depth > 0.05)) continue;
        const x = (qx * right[0] + qz * right[2]) / depth;
        const y = (qx * up[0] + qy * up[1] + qz * up[2]) / depth;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (num(x0 + x1 + y0 + y1)) {
        const mx = s.forward === null ? ((x0 + x1) / 2) * dist0 : 0;
        const my = s.height === null ? ((y0 + y1) / 2) * dist0 : 0;
        L.x += right[0] * mx + up[0] * my;
        L.y += up[1] * my;
        L.z += right[2] * mx + up[2] * my;
        d = fit();
      }
    }
    s.fitDist = d;
    const dist = s.dist ?? s.fitDist;
    s.shift = panel * th * dist; // the actor's centre lands in the middle of the free area
    s.aspect = aspect;
    s.panelOpen = !!this.lab?.open;
  }
}
