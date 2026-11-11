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
//   U.uHeroSolid, pipeline uHeroDebug             `look`: the hero's look-dev renders (restored on exit)
//   renderer.domElement                           `sheet`: read back after each render (lab.postRender)

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

/** Named angles used by the Lab buttons (yaw / pitch in degrees; `game` = the gameplay camera). yaw
 *  0 = its front faces you, 90 = its left side, 180 = its back, 270 = its right side: "3/4 R" and
 *  "Rear R" show its right side (the hero's pauldron and sword side, the reference sheet's angles). */
export const VIEW_ANGLES = [
  ['front', 'Front', { yaw: 0, pitch: 8 }],
  ['3-4', '3/4 L', { yaw: 35, pitch: 8 }],
  ['3-4r', '3/4 R', { yaw: 325, pitch: 8 }],
  ['side', 'Left', { yaw: 90, pitch: 8 }],
  ['right', 'Right', { yaw: 270, pitch: 8 }],
  ['back', 'Back', { yaw: 180, pitch: 8 }],
  ['rear', 'Rear R', { yaw: 215, pitch: 8 }],
  ['rear-l', 'Rear L', { yaw: 145, pitch: 8 }],
  ['game', 'Game', { game: true }],
];
/** Look-dev renders of the hero: the game's ASCII art, the bare geometry plain-lit with no ASCII
 *  pass (`solid`), the art pass's flat source (`source`) or only its ink lines (`lines`). */
export const VIEW_LOOKS = ['ascii', 'solid', 'source', 'lines'];
/** The sheet (`sheet: true`): the reference sheet's six angles and the left side at eye level, and
 *  the gameplay camera (its 58° pitch and the rig's distance, drawn ×2 with nearest-neighbour pixels)
 *  on his back (the usual fight view), front and right side, one live tile each. A `game` tile's yaw
 *  is around his facing too: the same picture as the real world-fixed camera with him turned so. */
export const SHEET_VIEWS = [
  { label: 'FRONT', yaw: 0 },
  { label: 'FRONT 3/4', yaw: 325 },
  { label: 'RIGHT SIDE', yaw: 270 },
  { label: 'LEFT SIDE', yaw: 90 },
  { label: 'GAME BACK', yaw: 180, game: true },
  { label: 'BACK', yaw: 180 },
  { label: 'REAR 3/4', yaw: 215 },
  { label: 'REAR 3/4 L', yaw: 145 },
  { label: 'GAME FRONT', yaw: 0, game: true },
  { label: 'GAME RIGHT', yaw: 270, game: true },
];
const SPIN_DEG_S = 36; // turntable: one turn in 10 s of real time
const GAME_LOOK = Object.freeze({ x: 0, y: 1, z: 0 }); // the sheet's gameplay tiles aim 1 m above the root
const SHEET_COLS = 5;
const SHEET_PITCH = 8;
const SHEET_GAME_ZOOM = 2; // the gameplay tile: its pixels ×2, nearest-neighbour (the glyphs stay crisp)
/** yaws an auto-fit encloses while spinning or in the sheet (the whole turn fits one distance) */
const FIT_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];

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
    // sheet: the tile being shown (i) and how many renders it has been on screen (each view is held
    // for 2 frames and read back on the 2nd: the hero's materials read the camera one frame late)
    this._sheet = { i: 0, held: 0, canvas: null, ctx: null, w: 0, h: 0, x0: 0 };
  }

  get active() {
    return this.state !== null;
  }

  actor(name) {
    return name === 'dragon' ? this.game.dragon : this.game.player;
  }

  /**
   * Enter / update the view. opts: { target: 'hero'|'dragon', yaw, pitch, dist, height, dark,
   * solo?, forward?, lockYaw?, game?, spin?, sheet?, look? } (degrees / metres; see ARCHITECTURE.md).
   * null / false = exit. Returns a summary of the framing (with the fitted dist / height), or null.
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
    const sheet = o.sheet === true;
    this.state = {
      target,
      yaw: num(o.yaw) ? o.yaw : 0,
      pitch: clamp(pitch0, PITCH_MIN, PITCH_MAX),
      dist: num(o.dist) && o.dist > 0 ? clamp(o.dist, DIST_MIN, DIST_MAX) : null,
      height: num(o.height) ? o.height : null,
      forward: num(o.forward) ? o.forward : null,
      dark: !!o.dark,
      solo: typeof o.solo === 'boolean' ? o.solo : !!o.dark, // hide the other actor (default: with dark)
      game: game && !sheet,
      lockYaw: !!o.lockYaw,
      yaw0: num(a.yaw) ? a.yaw : 0,
      spin: o.spin === true && !sheet && !game, // turntable: the yaw turns SPIN_DEG_S per real second
      sheet, // every SHEET_VIEWS angle at once, in tiles on an overlay (lab.postRender reads them back)
      // the hero's look-dev render: kept across calls until set, restored to 'ascii' on exit
      lookMode: VIEW_LOOKS.includes(o.look) ? o.look : (this.state?.lookMode ?? 'ascii'),
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
    this._applyLook(this.state.lookMode);
    if (sheet) this._sheetOn();
    else this._sheetOff();
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
    this._applyLook('ascii');
    this._sheetOff();
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
      yaw: r2(s.yaw),
      pitch: r2(s.pitch),
      dist: r2(s.dist ?? s.fitDist),
      height: r2(s.look.y),
      forward: r2(s.look.z),
      dark: s.dark,
      solo: s.solo,
      game: s.game,
      lockYaw: s.lockYaw,
      spin: s.spin,
      sheet: s.sheet,
      look: s.lookMode,
      auto: { dist: s.dist === null, height: s.height === null },
    };
  }

  /** The hero's look-dev render (VIEW_LOOKS): 'ascii' (play), 'solid', 'source', 'lines'. */
  _applyLook(mode) {
    const U = this.game.U, am = this.game.pipeline?.asciiMat?.uniforms;
    if (U?.uHeroSolid) U.uHeroSolid.value = mode === 'solid' ? 1 : 0;
    if (am?.uHeroDebug) am.uHeroDebug.value = mode === 'source' ? 1 : mode === 'lines' ? 2 : 0;
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
    if (s.spin) s.yaw = (s.yaw + SPIN_DEG_S * clamp(num(this.game.realDt) ? this.game.realDt : 0, 0, 0.1)) % 360;

    // this frame's view: the state's, or the sheet tile on screen (each one held for two renders)
    let yawD = s.yaw, pitchD = s.pitch, isGame = s.game, dist = s.dist ?? s.fitDist, L = s.look, shift = s.shift;
    if (s.sheet) {
      const v = SHEET_VIEWS[this._sheet.i] ?? SHEET_VIEWS[0];
      shift = 0;
      isGame = false; // sheet yaws are all around his facing
      yawD = v.yaw;
      if (v.game) {
        // the gameplay camera's pitch at the rig's distance, aimed at the body 1 m up
        pitchD = CONFIG.camera.pitch / DEG;
        const td = this.game.cameraRig?.targetDistance;
        dist = num(td) && td > 0 ? td : CONFIG.camera.distance;
        L = GAME_LOOK;
      } else pitchD = SHEET_PITCH;
    }

    const ref = s.lockYaw ? s.yaw0 : num(a.yaw) ? a.yaw : s.yaw0;
    const c = Math.cos(ref), sn = Math.sin(ref);
    const lx = P.x + L.x * c + L.z * sn;
    const lz = P.z - L.x * sn + L.z * c;
    const ly = P.y + L.y;
    const h = isGame ? yawD * DEG : ref + yawD * DEG;
    const cp = Math.cos(pitchD * DEG), sp = Math.sin(pitchD * DEG);
    const dx = cp * Math.sin(h), dz = cp * Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    const sx = -rx * shift, sz = -rz * shift; // slide left so the actor centres right of the panel
    const ov = this._ov;
    ov.target.set(lx + sx, ly, lz + sz);
    ov.pos.set(lx + sx + dx * dist, ly + sp * dist, lz + sz + dz * dist);
    ov.focus.set(lx, ly, lz);
    if (s.solo) this._soloHide();
    else this._soloRestore();
  }

  /**
   * lab.postRender (main.js, right after the frame is drawn, same task): in the sheet, copy the tile
   * on screen out of the WebGL canvas into its slot on the overlay, then move to the next angle. A
   * view is read back on its second render: the hero's materials (glyph scale, blade light) measure
   * the camera one frame late, so the first render of a new angle still shows the last one's.
   */
  postRender() {
    const s = this.state, sh = this._sheet;
    if (!s?.sheet || !sh.ctx) return;
    if (sh.held < 1) {
      sh.held++;
      return;
    }
    const src = this.game.renderer?.domElement;
    const W = src?.width, H = src?.height;
    if (num(W) && num(H) && W > 0 && H > 0) {
      this._sheetLayout(W, H);
      const v = SHEET_VIEWS[sh.i] ?? SHEET_VIEWS[0];
      const ctx = sh.ctx, tw = sh.tw, th = sh.th;
      const dx = sh.x0 + (sh.i % SHEET_COLS) * tw, dy = Math.floor(sh.i / SHEET_COLS) * th;
      // close tiles: the full frame height, centred (the fit centres the root); the gameplay tile:
      // its own pixels ×2, nearest-neighbour, so the letters and ink lines read as they do in play
      const ch = v.game ? th / SHEET_GAME_ZOOM : H, cw = v.game ? tw / SHEET_GAME_ZOOM : (H * tw) / th;
      ctx.imageSmoothingEnabled = !v.game;
      ctx.fillStyle = '#000';
      ctx.fillRect(dx, dy, tw, th);
      ctx.drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, dx, dy, tw, th);
      ctx.strokeStyle = 'rgba(160,170,190,0.25)';
      ctx.strokeRect(dx + 0.5, dy + 0.5, tw - 1, th - 1);
      ctx.fillStyle = 'rgba(220,226,236,0.9)';
      ctx.font = `${Math.max(10, Math.round(H / 80))}px monospace`;
      const td = this.game.cameraRig?.targetDistance;
      const lbl = v.game ? `${v.label} ${Math.round(num(td) ? td : CONFIG.camera.distance)} m ×${SHEET_GAME_ZOOM}` : v.label;
      ctx.fillText(`${lbl} · ${s.lookMode.toUpperCase()}`, dx + 8, dy + Math.max(14, Math.round(H / 60)));
    }
    sh.held = 0;
    sh.i = (sh.i + 1) % SHEET_VIEWS.length;
  }

  /** The sheet's overlay: a full-window 2D canvas over the game canvas and under the HUD layer
   *  (#ui, z 2, whose Lab panel stays on top and usable; the viewer fades the rest of it), tiles
   *  right of the Lab panel. */
  _sheetOn() {
    const sh = this._sheet;
    sh.i = 0;
    sh.held = 0;
    if (sh.canvas || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    try {
      const c = document.createElement('canvas');
      c.className = 'lab-sheet';
      c.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:1;pointer-events:none;background:#000';
      (document.body ?? document.documentElement)?.appendChild?.(c);
      sh.canvas = c;
      sh.ctx = c.getContext?.('2d') ?? null;
      sh.w = sh.h = 0;
    } catch (err) {
      console.error('[lab] model view: sheet overlay failed', err);
      sh.canvas = sh.ctx = null;
    }
  }

  _sheetOff() {
    const sh = this._sheet;
    try {
      sh.canvas?.remove?.();
    } catch {
      /* already gone */
    }
    sh.canvas = sh.ctx = null;
    sh.w = sh.h = 0;
  }

  /** Size the overlay to the drawing buffer and lay the tiles out right of the Lab panel. */
  _sheetLayout(W, H) {
    const sh = this._sheet;
    const x0 = Math.round(this._panelFrac() * W);
    if (sh.w === W && sh.h === H && sh.x0 === x0) return;
    sh.canvas.width = W;
    sh.canvas.height = H;
    sh.w = W;
    sh.h = H;
    sh.x0 = x0;
    sh.tw = Math.floor((W - x0) / SHEET_COLS);
    sh.th = Math.floor(H / Math.ceil(SHEET_VIEWS.length / SHEET_COLS));
    sh.ctx.fillStyle = '#000';
    sh.ctx.fillRect(0, 0, W, H);
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
      // (a rigid batch's merged geometry is in its bones' local spaces: its sources are measured)
      const g = o.isMesh && !o.userData.rigidBatch ? o.geometry : null;
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
    // turning (spin, the sheet): the camera circles the root, so every angle centres the body
    const turn = s.spin || s.sheet;
    L.x = s.forward !== null || turn ? 0 : (min[0] + max[0]) / 2;
    L.z = s.forward !== null ? s.forward : turn ? 0 : (min[2] + max[2]) / 2;
    L.y = s.height !== null ? s.height : (min[1] + max[1]) / 2;

    const cam = this.game.camera;
    const aspect = num(cam?.aspect) && cam.aspect > 0 ? cam.aspect : 16 / 9;
    const vfov = (num(cam?.fov) ? cam.fov : CONFIG.camera.fov) * DEG;
    const near = num(cam?.near) ? cam.near : CONFIG.camera.near;
    const panel = this._panelFrac();
    const tv = Math.tan(vfov / 2), th = tv * aspect;
    // the sheet's close tiles are crops of the frame: as wide as a tile is for the frame's height
    const rows = Math.ceil(SHEET_VIEWS.length / SHEET_COLS);
    const tx = s.sheet ? (tv * ((aspect * (1 - panel) * rows) / SHEET_COLS)) / MARGIN : (th * (1 - panel)) / MARGIN;
    const ty = tv / MARGIN;
    const pitch = s.sheet ? SHEET_PITCH : s.pitch;
    const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
    const dir = [0, sp, 0], right = [0, 0, 0], up = [0, cp, 0];
    // camera basis in the reference frame for yaw t (game view: world-fixed yaw, relative to it)
    const basis = (t) => {
      dir[0] = cp * Math.sin(t);
      dir[2] = cp * Math.cos(t);
      right[0] = Math.cos(t);
      right[2] = -Math.sin(t);
      up[0] = -sp * Math.sin(t);
      up[2] = -sp * Math.cos(t);
    };
    basis(s.game ? s.yaw * DEG - ref : s.yaw * DEG);
    const n = pts.length;
    // the sheet's tiles are narrow: fit his height and let a long reach (the sword) run a little past
    // the tile's sides instead of shrinking the figure
    const wide = s.sheet ? 1.45 : 1;
    const fit = () => {
      let need = 0;
      for (let i = 0; i < n; i += 3) {
        const qx = pts[i] - L.x, qy = pts[i + 1] - L.y, qz = pts[i + 2] - L.z;
        const along = qx * dir[0] + qy * dir[1] + qz * dir[2];
        const x = Math.abs(qx * right[0] + qz * right[2]);
        const y = Math.abs(qx * up[0] + qy * up[1] + qz * up[2]);
        need = Math.max(need, along + x / (tx * wide), along + y / ty, along + near * 1.5);
      }
      return clamp(num(need) ? need : 10, DIST_MIN, DIST_MAX);
    };
    let d = fit();
    if (turn) {
      // one distance for the whole turn (the sword swings round into the widest views)
      for (const yw of FIT_YAWS) {
        basis(yw * DEG);
        d = Math.max(d, fit());
      }
    } else if (s.forward === null || s.height === null) {
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
    // the actor's centre lands in the middle of the free area (the sheet crops the frame's centre)
    s.shift = s.sheet ? 0 : panel * th * dist;
    s.aspect = aspect;
    s.panelOpen = !!this.lab?.open;
  }
}
