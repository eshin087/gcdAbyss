import { CONFIG } from '../core/config.js';
import { el } from './dom.js';
import { injectTouchStyle } from './touchStyle.js';
import { aimWithoutCursor } from './aim.js';

// Touch controls for phones / tablets (contract: docs/ARCHITECTURE.md → Touch controls).
// A thin layer ON TOP of core/input.js: the left-thumb stick feeds input.setVirtualAxis(), the
// right-thumb buttons feed input.setVirtual(code, down) with the actions' virtual codes ('@attack',
// core/bindings.js: a keyboard remap never moves a touch button), so the player and flow keep
// reading the same actions and every edge (tap / hold / release) is the real device's:
//   stick → move (analog; pushed to the rim = @sprint)   ATTACK → @attack (tap light, hold the charged cleave)
//   BLOCK → @block (hold block, tap parry)   DODGE → @dodge   FLASK → @flask   LOCK → @lockOn   || → @pause
// ATTACK, HEAVY, BLOCK and DODGE are one cluster of tiles that touch (the pad, CONFIG.touch.pad):
// a touch on or near it goes to the nearest tile, and a thumb that slides from one tile onto another
// releases the first and presses the second without lifting. The player moves and sizes the cluster
// in the pause menu (PAD POSITION / PAD SIZE, kept in localStorage), and drags it where the thumb
// likes it after tapping the small padlock beside it (ADR-270: the offset is kept too; the padlock
// again locks it). Everything scales with the screen (CONFIG.touch.pad.fit, --tc-f). Two more switches there
// (ADR-131, both off by default): PAD LAYOUT 'split' moves the guard to the left hand (a GUARD button
// beside the stick; the right cluster keeps ATTACK, HEAVY and DODGE), and HOLD ATTACK makes a thumb
// that rests on ATTACK keep cutting (input.pulse, CONFIG.touch.hold). ?pad=split|classic and
// ?hold=1|0 in the URL set them for one page load. SWIPE DODGE (ADR-271, a third switch there, ?swipe=1|0):
// a quick flick on the bare right half of the screen dodges that way (input.dodgeToward), the DODGE
// tile stays.
// Aim: in a fight with the dragon targetable (and within CONFIG.touch.autoAimRange) game.mouseGround
// is put on its lock point (auto-aim); otherwise it sits CONFIG.touch.aimDistance m ahead of the hero
// along the last stick direction. Taps on the bare screen dismiss "press any key" screens (title,
// death) as a virtual click; the HUD prompt ("[@interact] Rest", "... Fight again") is tappable. Two fingers
// on the bare screen pinch-zoom through cameraRig.zoom. Held upright (portrait) the game plays on:
// the stick and the pad sit in the lower part of the screen and the camera opens (ADR-097).
// Inert (no DOM, no state) until activated: `pointer: coarse` at boot, ?touch in the URL, or the
// first touch. ?touch=0 keeps it off. Desktop mouse + keyboard play never sees it.

const PLAY = new Set(['explore', 'bossIntro', 'boss']);
const TAP_DISMISS = new Set(['title', 'dead']);
const RING = 12; // glyphs around the stick: an ASCII-drawn circle, arrows at the four cardinals
const RING_R = 62; // px
const TAU = Math.PI * 2;
const DOUBLE_TAP_MS = 350; // two touchends this close are a double tap (iOS zooms the page on one)
const CHARGE_CELLS = 6;
const SPRINT_OFF = 0.08; // hysteresis below sprintAt before the sprint drops

const BUTTONS = [
  { id: 'attack', code: '@attack', glyph: '†', label: 'ATTACK', tile: true },
  { id: 'heavy', code: '@heavy', glyph: '‡', label: 'HEAVY', sub: 'hold: charge', tile: true },
  { id: 'block', code: '@block', glyph: '[#]', label: 'BLOCK', sub: 'tap: parry', tile: true },
  { id: 'dodge', code: '@dodge', glyph: '»', label: 'DODGE', tile: true },
  { id: 'guard', code: '@block', glyph: '[#]', label: 'BLOCK', sub: 'tap: parry' }, // (PAD LAYOUT split: the left hand)
  { id: 'flask', code: '@flask', glyph: '◆', label: 'FLASK' },
  { id: 'lock', code: '@lockOn', glyph: '◎', label: 'LOCK' },
  { id: 'pause', code: '@pause', glyph: '||', label: '' },
];

/** The stroke an ASCII artist draws a circle with at angle a (screen space, y down): its tangent. */
function ringGlyph(a) {
  const t = ((((Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI) % 180) + 180) % 180;
  return '-\\|/'[Math.round(t / 45) % 4];
}

function urlTouch() {
  try {
    const s = globalThis.location?.search;
    if (typeof s !== 'string') return null;
    const q = new URLSearchParams(s);
    if (!q.has('touch')) return null;
    const v = (q.get('touch') || '').toLowerCase();
    return !(v === '0' || v === 'false' || v === 'off');
  } catch {
    return null;
  }
}

/** ?leftLook=a|b|c: how the stick and the left BLOCK are drawn (ADR-278; the owner picked c, glyphs only). */
export const LEFT_LOOKS = ['a', 'b', 'c'];
function urlLeftLook() {
  try {
    const v = new URLSearchParams(String(globalThis.location?.search ?? '')).get('leftLook');
    return LEFT_LOOKS.includes(v) ? v : 'c';
  } catch {
    return 'c';
  }
}

/** ?pad=split|classic and ?hold=1|0: the pad switches for this page load (a link to try one). */
function urlPad() {
  const o = { layout: null, hold: null, swipe: null, lguard: null, rguard: null };
  try {
    const s = globalThis.location?.search;
    if (typeof s !== 'string') return o;
    const q = new URLSearchParams(s);
    const l = (q.get('pad') || '').toLowerCase();
    // ?pad=split: the left BLOCK on (the owner: with BLOCK beside ATTACK and DODGE under it, so the
    // arrangement stays the player's); ?pad=classic: the left BLOCK off; ?pad=under: BLOCK under ATTACK
    if (l === 'split') o.lguard = true;
    else if (l === 'classic') {
      o.lguard = false;
      o.layout = 'classic';
    } else if (l === 'under') o.layout = 'split';
    const flag = (k) => (q.has(k) ? !['0', 'false', 'off'].includes((q.get(k) || '').toLowerCase()) : null);
    if (flag('lguard') !== null) o.lguard = flag('lguard');
    if (flag('rguard') !== null) o.rguard = flag('rguard');
    if (q.has('hold')) o.hold = !['0', 'false', 'off'].includes((q.get('hold') || '').toLowerCase());
    if (q.has('swipe')) o.swipe = !['0', 'false', 'off'].includes((q.get('swipe') || '').toLowerCase());
  } catch {
    /* no URL: nothing asked */
  }
  return o;
}

function media(query) {
  try {
    return !!globalThis.matchMedia?.(query)?.matches;
  } catch {
    return false;
  }
}

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A CSS custom property on an element (a plain style object where there is no CSSOM: headless). */
const setVar = (node, name, v) => {
  const s = node?.style;
  if (!s) return;
  if (typeof s.setProperty === 'function') s.setProperty(name, v);
  else s[name] = v;
};

export const PAD_POS = ['low', 'mid', 'high'];
export const PAD_SIZE = ['s', 'm', 'l'];
export const PAD_LAYOUT = ['classic', 'split'];
const PAD_KEY = 'gcd.touchPad';
const LOCK_SVG = (open) =>
  `<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><path d="${open ? 'M5 7V5a3 3 0 0 1 5.6-1.5' : 'M5 7V5a3 3 0 0 1 6 0v2'}" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3.5" y="7" width="9" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.3" y="9.3" width="1.4" height="2.6" fill="currentColor"/></svg>`;
const GUARD_STEPS = 25; // the BLOCK tile's guard gauge is written in this many steps

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.forced = urlTouch(); // true / false from ?touch, null = automatic
    this.phone = false; // active and the short screen side ≤ CONFIG.camera.mobileMaxSide
    this.portrait = false;
    this.autoAim = false; // this frame's aim is on the dragon
    this.ui = null;
    this.buttons = [];
    this.stick = { id: null, ox: 0, oy: 0, mag: 0, sprint: false, lit: -2, on: false };
    this.aim = { x: 0, z: -1, set: false };
    this.pinch = new Map(); // pointerId → { x, y } (bare-screen fingers during play)
    this.pinchD0 = 0;
    this.pinchZ0 = 0;
    this.taps = new Map(); // pointerId → virtual code pressed by a bare-screen / prompt tap
    this._shown = null;
    this._w = -1;
    this._h = -1;
    this._qualitySet = false;
    this._v = game.THREE ? new game.THREE.Vector3() : { x: 0, y: 0, z: 0, copy() { return this; }, set() { return this; } };
    this._keys = { charge: -1, flask: -1, lock: null, guard: -1, low: null };
    // the pad: which tile each finger holds, where the cluster is, the player's placement
    this.padHeld = new Map(); // pointerId → button record
    this.padGeo = null; // { k, cx, cy, reach, stick, tiles: { id: [u0, v0, u1, v1] } } (px, client)
    this.padPos = 'mid';
    this.padSize = 'm';
    this.padOff = { x: 0, y: 0 }; // the player's drag (px at fit 1: + left, + up), kept
    this.guardOff = { x: 0, y: 0 }; // split: GUARD's own drag (px at fit 1: + right, + up), kept
    this._gdrag = null; // { id, x, y, ox, oy } while a finger drags GUARD
    this.editing = false; // the padlock is open: a drag on the pad moves it
    this._drag = null; // { id, x, y, ox, oy } while a finger drags the pad
    this.fit = 1; // the touch layer's scale from the screen (CONFIG.touch.pad.fit)
    this.layout = 'classic'; // PAD_LAYOUT, the right cluster's arrangement: 'classic' BLOCK beside ATTACK, DODGE under; 'split' DODGE beside, BLOCK under
    this.leftLook = urlLeftLook(); // ?leftLook=a|b|c (default c, the owner's pick)
    this.leftGuard = false; // the GUARD button beside the stick (ADR-278: its own switch)
    this.rightGuard = true; // the BLOCK tile in the right cluster (never both off)
    this.holdAttack = false; // a held ATTACK keeps cutting
    this.swipeDodge = true; // SWIPE DODGE (on by default, the owner's pick): a flick on the bare right half dodges that way
    this.swipes = new Map(); // pointerId → { x, y, t, done } (bare-screen fingers on the right half)
    this.guardGeo = null; // split: the GUARD button { x, y, w, h } (its middle, client px)
    this._hold = { t: 0, next: 0, quiet: 0 };
    this._peek = false;
    this._loadPad();
    const asked = urlPad();
    if (asked.layout) this.layout = asked.layout;
    if (asked.lguard !== null) this.leftGuard = asked.lguard;
    if (asked.rguard !== null) this.rightGuard = asked.rguard;
    if (!this.leftGuard && !this.rightGuard) this.rightGuard = true;
    if (asked.hold !== null) this.holdAttack = asked.hold;
    if (asked.swipe !== null) this.swipeDodge = asked.swipe;
    this._errors = 0;

    const on = (target, name, fn, opts) => target?.addEventListener?.(name, (e) => this._guard(name, fn, e), opts);
    if (typeof addEventListener === 'function') {
      on(globalThis, 'pointerdown', (e) => this._onDown(e));
      on(globalThis, 'pointermove', (e) => this._onMove(e));
      on(globalThis, 'pointerup', (e) => this._onUp(e));
      on(globalThis, 'pointercancel', (e) => this._onUp(e));
      on(globalThis, 'blur', () => this._releaseAll());
      // long-press menus / page pinch-zoom / scroll-bounce while the touch UI is on
      on(globalThis, 'contextmenu', (e) => this.active && e.preventDefault?.(), true);
    }
    on(globalThis.document, 'gesturestart', (e) => this.active && e.preventDefault?.());
    on(globalThis.document, 'gesturechange', (e) => this.active && e.preventDefault?.());
    // iOS Safari ignores user-scalable=no: two quick taps (mashing ATTACK, LOCK twice, DODGE twice)
    // zoomed the whole page in about 2x round the tap, and it stayed so (the pinch that would undo it
    // is blocked above). The controls and the canvas are driven by pointer events alone, so their
    // touchend default (the double-tap zoom, the synthetic click) is never needed. Anywhere else (the
    // menus) the second of two quick taps loses its default too, and a button gets its click by hand.
    on(
      globalThis.document,
      'touchend',
      (e) => {
        if (!this.active || e.cancelable === false) return;
        const t = e.target, now = Number(e.timeStamp) || 0, quick = now - this._lastTouchEnd < DOUBLE_TAP_MS;
        this._lastTouchEnd = now;
        if (t === this._canvas() || t?.closest?.('.tc-root')) {
          e.preventDefault?.();
          return;
        }
        if (!quick) return;
        e.preventDefault?.();
        const b = t?.closest?.('button, .ab-btn');
        if (b && typeof b.click === 'function') b.click();
      },
      { passive: false },
    );
    this._lastTouchEnd = -1e9;
    on(globalThis.document, 'dblclick', (e) => this.active && e.preventDefault?.());
    // ... and if the page is zoomed anyway (an older iOS, a gesture that got through), it is put back
    // at once: rewriting the viewport meta makes Safari lay the page out at initial-scale 1 again
    const vv = globalThis.visualViewport;
    if (vv?.addEventListener) on(vv, 'resize', () => this._unzoom());
    // ?camdebug: a one-line readout of the page zoom, the camera distance and the canvas size, for a
    // report from a phone (a screenshot shows which of them changed)
    this.camDebug = /[?&]camdebug\b/.test(String(globalThis.location?.search ?? ''));
    this._dbgEl = null;
    this._dbgT = 0;
    on(
      globalThis.document,
      'touchmove',
      (e) => {
        if (!this.active || e.target?.closest?.('.lab-root, .ab-pause-panel, .ab-news-list, .gm-scroll')) return; // scrollable panels (gm-scroll: the title's new layouts, ?menu=)
        if (e.cancelable !== false) e.preventDefault?.();
      },
      { passive: false },
    );

    if (this.forced ?? media('(pointer: coarse)')) this.setActive(true);
  }

  // ---------------------------------------------------------------- public
  /** Show / hide the touch UI (Lab button, tests, first touch). */
  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    this.active = on;
    if (on) this._build();
    globalThis.document?.documentElement?.classList?.toggle('gcd-touch', on);
    this.game.hud?.root?.classList?.toggle('ab-touch', on);
    if (this.ui) this.ui.root.style.display = on ? '' : 'none';
    const s = this.game.settings;
    if (on && s && !s.autoQuality && !this._qualitySet && s.quality === CONFIG.defaultQuality) {
      // touch devices start on the light preset (unless the player already picked one; with AUTO on
      // the frame time picks the resolution: render/autoQuality.js)
      s.quality = CONFIG.defaultQualityTouch;
      this._qualitySet = true;
      this._try(() => this.game.applyQuality?.(), 'applyQuality');
    } else if (!on && this._qualitySet && s?.quality === CONFIG.defaultQualityTouch) {
      s.quality = CONFIG.defaultQuality;
      this._qualitySet = false;
      this._try(() => this.game.applyQuality?.(), 'applyQuality');
    }
    if (!on) {
      this._releaseAll();
      this.portrait = false;
      this.phone = false;
      this.autoAim = false;
      this.game.cameraRig?.setMobile?.(false);
    }
    this._shown = null;
    this._layout(true);
  }

  /** Per frame (main.js, right after the mouse ray and before the Lab / flow / player). */
  update(realDt) {
    if (!this.active) return;
    const g = this.game;
    this._layout(false);
    if (this.camDebug) this._camDebug(realDt);
    const st = g.state;
    const play = PLAY.has(st);
    const live = play && !g.lab?.viewer?.active;
    if (live !== this._shown) {
      this._shown = live;
      this.ui?.root.classList.toggle('off', !live);
      if (!live) {
        this._releaseControls();
        if (this.editing) this.setEditing(false);
      }
    }
    // paused: the controls show through, inert, so PAD POSITION / PAD SIZE are seen as they change
    const peek = st === 'paused';
    if (peek !== this._peek) {
      this._peek = peek;
      this.ui?.root.classList.toggle('peek', peek);
    }
    if (play) this._aimUpdate();
    else this.autoAim = false;
    if (live) {
      this._holdRepeat(realDt);
      this._syncButtons();
    }
  }

  /**
   * HOLD ATTACK: while a thumb rests on ATTACK the hero keeps cutting. Each repeat is one press edge
   * of the attack action (input.pulse), so the chain, the sprint cut and the execution read it as a
   * tap. The guard has the hero while it is held; DODGE / HEAVY / FLASK keep the buffer for a moment.
   */
  _holdRepeat(dt) {
    const H = CONFIG.touch.hold, B = this.btn, K = this._hold;
    if (!this.holdAttack || !H || !B?.attack?.ids.size) {
      K.t = K.next = K.quiet = 0;
      return;
    }
    dt = Math.min(0.1, Math.max(0, fin(dt)));
    if (K.t === 0) K.next = fin(H.after, 0.22);
    K.t += dt;
    if (B.block?.ids.size || B.guard?.ids.size) K.quiet = Math.max(K.quiet, fin(H.every, 0.1));
    if (K.quiet > 0) {
      K.quiet -= dt;
      return;
    }
    // ... and for as long as the player still holds a buffered dodge / heavy / flask: its buffer
    // ages on the game's clock (slower than this one in a hit-stop or the Lab's slow motion), so the
    // timer above can run out first, and the next repeat would overwrite the press
    const queued = this.game.player?.buf?.action;
    if (queued && queued !== 'light') return;
    if (K.t < K.next) return;
    K.next = K.t + fin(H.every, 0.1);
    this.game.input?.pulse?.('@attack');
  }

  /** The page was zoomed (visualViewport.scale > 1): rewrite the viewport meta, Safari lays it out
   *  at scale 1 again. Counted in `unzooms` (the ?camdebug readout shows it). */
  _unzoom() {
    const vv = globalThis.visualViewport, doc = globalThis.document;
    if (!this.active || !(fin(vv?.scale, 1) > 1.01)) return;
    const m = doc?.querySelector?.('meta[name="viewport"]');
    if (!m) return;
    const base = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no';
    this.unzooms = (this.unzooms ?? 0) + 1;
    m.setAttribute('content', `${base},minimum-scale=1`);
    globalThis.setTimeout?.(() => m.setAttribute('content', base), 60);
  }

  /** ?camdebug: page zoom · camera distance · canvas / window size, a few times a second. */
  _camDebug(dt) {
    this._dbgT -= fin(dt, 0.016);
    if (this._dbgT > 0) return;
    this._dbgT = 0.25;
    const doc = globalThis.document;
    if (!this._dbgEl && doc?.body) {
      this._dbgEl = el('div', 'tc-camdebug', null, doc.body);
      this._dbgEl.style.cssText = 'position:fixed;left:50%;top:2px;transform:translateX(-50%);z-index:99;font:10px monospace;color:#ff8a3d;background:rgba(0,0,0,.6);padding:1px 6px;pointer-events:none;white-space:nowrap';
    }
    if (!this._dbgEl) return;
    const g = this.game, r = g.cameraRig, vv = globalThis.visualViewport, c = this._canvas();
    const D = r && g.camera?.position?.distanceTo ? g.camera.position.distanceTo(r.focus) : NaN;
    this._dbgEl.textContent = `page x${fin(vv?.scale, 1).toFixed(2)} (fixed ${this.unzooms ?? 0}) · cam ${fin(D).toFixed(1)} m (base ${fin(r?.targetDistance).toFixed(0)}) · canvas ${c?.clientWidth}x${c?.clientHeight} / win ${globalThis.innerWidth}x${globalThis.innerHeight}`;
  }

  /** Step the cluster's placement ('pos': low / mid / high), its size ('size': s / m / l), its
   *  layout ('layout': classic / split), the held attack ('hold': off / on) or the swipe dodge
   *  ('swipe': off / on); kept. */
  cyclePad(what) {
    if (what === 'size') this.padSize = PAD_SIZE[(PAD_SIZE.indexOf(this.padSize) + 1) % PAD_SIZE.length];
    else if (what === 'layout' || what === 'lguard' || what === 'rguard') {
      this._releaseControls(); // every button is somewhere else now: nothing stays held
      if (what === 'layout') this.layout = PAD_LAYOUT[(PAD_LAYOUT.indexOf(this.layout) + 1) % PAD_LAYOUT.length];
      else if (what === 'lguard') {
        this.leftGuard = !this.leftGuard;
        if (!this.leftGuard) this.rightGuard = true; // (one guard stays)
      } else {
        this.rightGuard = !this.rightGuard;
        if (!this.rightGuard) this.leftGuard = true;
      }
    } else if (what === 'hold') this.holdAttack = !this.holdAttack;
    else if (what === 'swipe') this.swipeDodge = !this.swipeDodge;
    else this.padPos = PAD_POS[(PAD_POS.indexOf(this.padPos) + 1) % PAD_POS.length];
    this._savePad();
    this._padLayout();
    if (this.stick.id === null) this._restStick();
    return what === 'size' ? this.padSize : what === 'layout' ? this.layout : what === 'lguard' ? this.leftGuard : what === 'rguard' ? this.rightGuard : what === 'hold' ? this.holdAttack : what === 'swipe' ? this.swipeDodge : this.padPos;
  }

  _savePad() {
    try {
      const o = { v: 2, pos: this.padPos, size: this.padSize, layout: this.layout, lg: this.leftGuard, rg: this.rightGuard, hold: this.holdAttack, sw: this.swipeDodge, off: [Math.round(this.padOff.x), Math.round(this.padOff.y)], goff: [Math.round(this.guardOff.x), Math.round(this.guardOff.y)] };
      globalThis.localStorage?.setItem?.(PAD_KEY, JSON.stringify(o));
    } catch {
      /* private mode: the choice lasts for this page */
    }
  }

  /** The padlock: open (a drag moves the pad; its tiles press nothing) or shut (kept where it is). */
  setEditing(on) {
    on = !!on;
    if (on === this.editing) return this.editing;
    this._releaseControls();
    this.editing = on;
    this._drag = null;
    this._gdrag = null;
    const u = this.ui;
    if (u) {
      u.root.classList.toggle('editing', on);
      if (u.lockBtn) {
        u.lockBtn.innerHTML = LOCK_SVG(on);
        u.lockBtn.setAttribute?.('aria-label', on ? 'Lock the controls here' : 'Move the controls');
      }
      if (u.guardLock) u.guardLock.innerHTML = LOCK_SVG(on);
    }
    if (!on) this._savePad();
    return on;
  }

  /** Put the dragged pad back where PAD POSITION puts it. */
  resetPadOffset() {
    this.padOff.x = 0;
    this.padOff.y = 0;
    this.guardOff.x = 0;
    this.guardOff.y = 0;
    this._savePad();
    this._padLayout();
    if (this.stick.id === null) this._restStick();
  }

  /** The touch layer's scale for a w x h screen (CONFIG.touch.pad.fit). */
  _fitFor(w, h) {
    const F = CONFIG.touch.pad?.fit;
    if (!F) return 1;
    const s = Math.min(w, h), l = Math.max(w, h);
    const k = Math.min(s / fin(F.base?.[0], 390), l / fin(F.base?.[1], 760));
    return Math.min(fin(F.max, 1.25), Math.max(fin(F.min, 0.62), fin(k, 1)));
  }

  /** The screen point (client px) at the middle of a pad tile ('attack' / 'block' / 'dodge'), or null. */
  padPoint(id) {
    if (id === 'guard') return this.guardGeo ? { x: this.guardGeo.x, y: this.guardGeo.y } : null;
    const G = this.padGeo, r = G?.tiles?.[id];
    return r ? { x: G.cx - (r[0] + r[2]) / 2, y: G.cy - (r[1] + r[3]) / 2 } : null;
  }

  _loadPad() {
    try {
      const o = JSON.parse(globalThis.localStorage?.getItem?.(PAD_KEY) ?? 'null');
      if (PAD_POS.includes(o?.pos)) this.padPos = o.pos;
      if (PAD_SIZE.includes(o?.size)) this.padSize = o.size;
      // (v2, ADR-278: a pad saved before kept 'split' for the left guard; the arrangement it meant is BLOCK
      // under ATTACK, the owner's swap puts BLOCK beside it again, so an old save takes the default)
      if (PAD_LAYOUT.includes(o?.layout) && o?.v === 2) this.layout = o.layout;
      // (a pad saved before the guards had their own switches: 'split' was the guard on the left)
      this.leftGuard = typeof o?.lg === 'boolean' ? o.lg : o?.layout === 'split';
      if (typeof o?.rg === 'boolean') this.rightGuard = o.rg;
      if (!this.leftGuard && !this.rightGuard) this.rightGuard = true;
      if (typeof o?.hold === 'boolean') this.holdAttack = o.hold;
      if (typeof o?.sw === 'boolean') this.swipeDodge = o.sw;
      if (Array.isArray(o?.goff)) {
        this.guardOff.x = fin(Number(o.goff[0]));
        this.guardOff.y = fin(Number(o.goff[1]));
      }
      if (Array.isArray(o?.off)) {
        this.padOff.x = fin(Number(o.off[0]));
        this.padOff.y = fin(Number(o.off[1]));
      }
    } catch {
      /* no storage / a broken entry: the defaults */
    }
  }

  // ---------------------------------------------------------------- aim
  _aimUpdate() {
    const T = CONFIG.touch;
    this.autoAim = aimWithoutCursor(this.game, this.aim, T.autoAimRange, T.aimDistance, this._v);
  }

  // ---------------------------------------------------------------- layout / visibility
  _layout(force) {
    const w = fin(globalThis.innerWidth, 1), h = fin(globalThis.innerHeight, 1);
    if (!force && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    if (!this.active) return;
    this.phone = Math.min(w, h) <= CONFIG.camera.mobileMaxSide;
    const portrait = h > w;
    this.game.cameraRig?.setMobile?.(this.phone, portrait);
    if (portrait !== this.portrait) {
      // the phone was turned: every control is somewhere else now, so nothing stays held
      this.portrait = portrait;
      this._releaseAll();
    }
    this._padLayout();
    if (this.stick.id === null) this._restStick();
  }

  /**
   * Place the cluster (CONFIG.touch.pad, the player's position and size) and keep its geometry for
   * the hit test: tiles as [u0, v0, u1, v1], u = px left of the cluster's right edge, v = px above
   * its bottom edge; (cx, cy) = that corner on screen.
   */
  _padLayout() {
    const P = CONFIG.touch.pad, u = this.ui;
    const w = fin(globalThis.innerWidth, 1), h = fin(globalThis.innerHeight, 1);
    const fit = (this.fit = this._fitFor(w, h));
    const k = fin(P.size[this.padSize], 1) * fit;
    const places = (h > w && P.posPortrait) || P.pos;
    const pos = places[this.padPos] ?? places.mid;
    const split = this.layout === 'split' && !!P.split; // (the arrangement)
    const lguard = !!this.leftGuard && !!P.split; // (the GUARD beside the stick)
    const from = split ? P.split.tiles : P.tiles;
    const tiles = {};
    let W = 0, H = 0;
    for (const id in from) {
      if (id === 'block' && !this.rightGuard) continue; // (no BLOCK tile: the player turned it off)
      const t = from[id];
      tiles[id] = [t.x * k, t.y * k, (t.x + t.w) * k, (t.y + t.h) * k];
      W = Math.max(W, tiles[id][2]);
      H = Math.max(H, tiles[id][3]);
    }
    // the player's drag, kept on screen (the cluster and its padlock whole, clear of the top buttons)
    const reach = P.reach * k;
    const fl = (split && P.split.flask) || P.flask;
    const H2 = Math.max(H, fl ? (fl.y + fl.h) * k : 0) + 34 * fit;
    let px = pos[0] * fit + this.padOff.x * fit, py = pos[1] * fit + this.padOff.y * fit;
    px = Math.min(Math.max(px, 4), Math.max(4, w * 0.62 - W));
    py = Math.min(Math.max(py, 4), Math.max(4, h - H2 - 52 * fit));
    // (the kept drag is the clamped one: dragging back from past an edge moves at once)
    if (this.padOff.x || this.padOff.y) {
      this.padOff.x = (px - pos[0] * fit) / fit;
      this.padOff.y = (py - pos[1] * fit) / fit;
    }
    this.padGeo = { k, cx: w - px, cy: h - py, reach, stick: P.stick * k, tiles };
    // the left GUARD beside the stick's ring (held upright: above it), on the cluster's bottom line
    let guard = null;
    if (lguard) {
      const rest = this._stickRest(), up = h > w, g = (up && P.split.guardPortrait) || P.split.guard;
      // (landscape: centred on the stick, ADR-278; look b: the stick's square tile's height, against its edge)
      const pair = this.leftLook === 'b' && !up;
      const gw = g.w * k, gh = pair ? 128 * fit : g.h * k;
      const left0 = up ? Math.max(8, rest.x - gw / 2) : pair ? rest.x + 64 * fit : rest.x + RING_R * fit + fin(g.gap, 14) * fit;
      const bottom0 = up ? h - rest.y + RING_R * fit + fin(g.lift, 14) * fit : h - rest.y - gh / 2;
      // the player's drag (the padlock open), kept on the left half and clear of the top
      const left = Math.min(Math.max(left0 + this.guardOff.x * fit, 4), Math.max(4, w * 0.5 - gw));
      const bottom = Math.min(Math.max(bottom0 + this.guardOff.y * fit, 4), Math.max(4, h - gh - 52 * fit));
      if (this.guardOff.x || this.guardOff.y) {
        this.guardOff.x = (left - left0) / fit;
        this.guardOff.y = (bottom - bottom0) / fit;
      }
      guard = { left, bottom, w: gw, h: gh };
      this.guardGeo = { x: left + gw / 2, y: h - bottom - gh / 2, w: gw, h: gh };
    } else this.guardGeo = null;
    if (!u?.pad) return;
    const px2 = (v) => `${v.toFixed(1)}px`;
    const S = u.pad.style;
    S.right = px2(px - reach);
    S.bottom = px2(py - reach);
    S.width = px2(W + reach * 2);
    S.height = px2(H + reach * 2);
    setVar(u.root, '--tc-k', k.toFixed(3));
    setVar(u.root, '--tc-f', fit.toFixed(3));
    u.root.classList.toggle('split', split);
    u.root.classList.toggle('lguard', lguard);
    const gs = this.btn?.guard?.el.style;
    if (guard && gs) {
      gs.left = px2(guard.left);
      gs.bottom = px2(guard.bottom);
      gs.width = px2(guard.w);
      gs.height = px2(guard.h);
    }
    // GUARD's own padlock: over its top-right corner (the same lock as the pad's)
    const gl = u.guardLock?.style;
    if (guard && gl) {
      const lw2 = Math.max(22, 26 * fit);
      gl.left = px2(guard.left + guard.w - lw2 * 0.65);
      gl.bottom = px2(guard.bottom + guard.h - lw2 * 0.35);
      gl.width = px2(lw2);
      gl.height = px2(lw2);
    }
    for (const id in tiles) {
      const r = tiles[id], s = this.btn?.[id]?.el.style;
      if (!s) continue;
      s.right = px2(reach + r[0]);
      s.bottom = px2(reach + r[1]);
      s.width = px2(r[2] - r[0]);
      s.height = px2(r[3] - r[1]);
    }
    if (this.btn?.block) this.btn.block.el.style.display = tiles.block ? '' : 'none'; // (RIGHT GUARD off: no BLOCK tile)
    const f = fl, fs = this.btn?.flask?.el.style;
    if (f && fs) {
      fs.right = px2(px + f.x * k);
      fs.bottom = px2(py + f.y * k);
      fs.width = px2(f.w * k);
      fs.height = px2(f.h * k);
    }
    // the padlock: a small button over the cluster's top-left corner, out of the thumb's way
    const ls = u.lockBtn?.style, lw = Math.max(22, 26 * fit);
    if (ls) {
      ls.right = px2(px + W - lw * 0.35);
      ls.bottom = px2(py + H2 - lw);
      ls.width = px2(lw);
      ls.height = px2(lw);
    }
    const hs = u.editHint?.style;
    if (hs) {
      hs.right = px2(px);
      hs.bottom = px2(py + H2 + 4 * fit);
      hs.width = px2(Math.max(W, 150 * fit));
    }
  }

  /** Where the stick's ring rests (client px): the bottom left corner; held upright, level with the
   *  pad (the thumbs come up from below). */
  _stickRest() {
    const R = RING_R * this.fit + 22, G = this.padGeo, w = fin(globalThis.innerWidth, 800), h = fin(globalThis.innerHeight, 400), up = h > w;
    const lift = up && G ? h - G.cy + 24 * G.k : 14;
    return { x: R + (up ? 8 : 18 * this.fit), y: Math.max(R, h - R - lift) };
  }

  /** The cluster's corner on screen from the laid-out element (safe areas, a host that is not the
   *  whole window); the computed one stands where there is no layout to ask (headless). */
  _padOrigin() {
    const G = this.padGeo, r = this._try(() => this.ui?.pad?.getBoundingClientRect?.(), 'padRect');
    if (!G || !r || !(r.width > 0) || !Number.isFinite(r.right) || !Number.isFinite(r.bottom)) return;
    G.cx = r.right - G.reach;
    G.cy = r.bottom - G.reach;
  }

  /**
   * The tile a finger at screen (x, y) is on. A finger that already holds `cur` keeps it until it
   * has left that tile by `stick` px; then, and for a new touch, the nearest tile takes it (a slide
   * that wanders further than `reach` from every tile keeps the one it holds).
   */
  _padPick(x, y, cur) {
    const G = this.padGeo;
    if (!G || !Number.isFinite(x) || !Number.isFinite(y)) return cur;
    const u = G.cx - x, v = G.cy - y;
    let best = null, bd = Infinity;
    for (const id in G.tiles) {
      const r = G.tiles[id], rec = this.btn?.[id];
      if (!rec) continue;
      const d = Math.hypot(Math.max(r[0] - u, 0, u - r[2]), Math.max(r[1] - v, 0, v - r[3]));
      if (rec === cur && d <= G.stick) return cur;
      if (d < bd) {
        bd = d;
        best = rec;
      }
    }
    return cur && bd > G.reach ? cur : best;
  }

  // ---------------------------------------------------------------- DOM
  _build() {
    if (this.ui || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    try {
      injectTouchStyle();
      const host = document.getElementById?.('ui') ?? document.body;
      if (!host) return;
      const root = el('div', `tc-root off look-${this.leftLook}`, null, host);
      root.addEventListener('contextmenu', (e) => e.preventDefault?.());

      // left thumb: capture zone + the floating ASCII stick
      const zone = el('div', 'tc-zone', null, root);
      const stick = el('div', 'tc-stick', null, root);
      el('div', 'tc-disc', null, stick);
      const ring = el('div', 'tc-ring', null, stick);
      const dots = [];
      for (let i = 0; i < RING; i++) {
        const a = (i / RING) * TAU;
        const card = (i * 4) % RING === 0 ? '>v<^'[(i * 4) / RING] : null;
        const d = el('span', card ? 'c' : '', card ?? ringGlyph(a), ring);
        d.style.left = `${(Math.cos(a) * RING_R).toFixed(1)}px`;
        d.style.top = `${(Math.sin(a) * RING_R).toFixed(1)}px`;
        dots.push(d);
      }
      el('div', 'tc-centre', '+', stick);
      const knob = el('div', 'tc-knob', '@', stick);
      const tag = el('div', 'tc-tag', 'MOVE', stick);

      // right thumb: the pad (one pointer surface under the three tiles) and the small buttons
      const pad = el('div', 'tc-pad', null, root);
      this.ui = { root, zone, stick, knob, tag, dots, pad };
      this._bindStick(zone);
      this.buttons = BUTTONS.map((def) => this._button(def.tile ? pad : root, def));
      this.btn = Object.fromEntries(this.buttons.map((b) => [b.def.id, b]));
      this._bindPad(pad);

      // the padlock: tap to move the right-hand controls (drag the pad), tap again to keep them there
      // (split: GUARD has one too, ADR-278; the two are one lock: open, the pad and GUARD both drag)
      const padlock = (cls) => {
        const b = el('button', cls, null, root);
        b.type = 'button';
        b.tabIndex = -1;
        b.innerHTML = LOCK_SVG(false);
        b.setAttribute?.('aria-label', 'Move the controls');
        b.addEventListener('pointerdown', (e) =>
          this._guard('padlock', () => {
            e.preventDefault?.();
            e.stopPropagation?.();
            if (this._live()) this.setEditing(!this.editing);
          }, e),
        );
        b.addEventListener('click', (e) => e.preventDefault?.());
        return b;
      };
      const lockBtn = padlock('tc-padlock');
      this.ui.guardLock = padlock('tc-padlock tc-guardlock');
      const editHint = el('div', 'tc-edit-hint', null, root);
      el('span', 't', 'DRAG TO MOVE', editHint);
      const reset = el('button', 'tc-edit-reset', 'RESET', editHint);
      reset.type = 'button';
      reset.tabIndex = -1;
      reset.addEventListener('pointerdown', (e) =>
        this._guard('padreset', () => {
          e.preventDefault?.();
          e.stopPropagation?.();
          this.resetPadOffset();
        }, e),
      );
      this.ui.lockBtn = lockBtn;
      this.ui.editHint = editHint;

      // the HUD prompt ("[@interact] Rest at bonfire") is a tap target on touch
      const prompt = this.game.hud?.promptEl;
      if (prompt?.addEventListener) {
        prompt.addEventListener('pointerdown', (e) => this._guard('prompt', () => this._promptDown(e), e));
        prompt.addEventListener('pointerup', (e) => this._guard('prompt', () => this._tapUp(e), e));
        prompt.addEventListener('pointercancel', (e) => this._guard('prompt', () => this._tapUp(e), e));
      }

      this._restStick();
    } catch (err) {
      this._report('build', err);
      this.ui?.root?.remove?.();
      this.ui = null;
    }
  }

  _button(root, def) {
    const b = el(def.tile ? 'div' : 'button', `tc-btn tc-${def.id}${def.tile ? ' tc-tile' : ''}`, null, root);
    if (!def.tile) {
      b.type = 'button';
      b.tabIndex = -1;
    }
    const g = el('span', 'g', def.glyph, b);
    const t = def.label ? el('span', 't', def.label, b) : null;
    if (def.sub) el('span', 's', def.sub, b);
    const rec = { def, el: b, g, t, ids: new Set() };
    if (def.tile) return rec; // the pad owns its tiles' pointers (_bindPad)
    const down = (e) => {
      e.preventDefault?.(); // no compatibility mouse events, no focus, no text selection
      if (!this._live() || rec.ids.has(e.pointerId)) return;
      if (this.editing && def.id === 'flask') return; // (the padlock is open: nothing on the pad acts)
      try {
        b.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic pointer: capture is a nicety */
      }
      if (this.editing && def.id === 'guard') {
        // the padlock is open: GUARD is a piece to drag, not a button
        if (!this._gdrag) this._gdrag = { id: e.pointerId, x: fin(e.clientX), y: fin(e.clientY), ox: this.guardOff.x, oy: this.guardOff.y };
        return;
      }
      this._press(rec, e.pointerId);
    };
    const up = (e) => {
      if (this._gdrag && this._gdrag.id === e.pointerId) {
        this._gdrag = null;
        this._savePad();
        return;
      }
      this._release(rec, e.pointerId);
    };
    if (def.id === 'guard') {
      b.addEventListener('pointermove', (e) =>
        this._guard('guard', () => {
          const D = this._gdrag;
          if (!D || D.id !== e.pointerId) return;
          const f = Math.max(0.1, this.fit);
          this.guardOff.x = D.ox + (fin(e.clientX, D.x) - D.x) / f;
          this.guardOff.y = D.oy - (fin(e.clientY, D.y) - D.y) / f;
          this._padLayout();
        }, e),
      );
    }
    b.addEventListener('pointerdown', (e) => this._guard(def.id, down, e));
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(n, (e) => this._guard(def.id, up, e));
    b.addEventListener('contextmenu', (e) => e.preventDefault?.());
    b.addEventListener('click', (e) => e.preventDefault?.());
    return rec;
  }

  /** A finger takes a button: lit, and its action goes down with the first finger on it. */
  _press(rec, id) {
    if (rec.ids.has(id)) return;
    rec.ids.add(id);
    if (rec.ids.size !== 1) return;
    rec.el.classList.add('on');
    this.game.input?.setVirtual?.(rec.def.code, true);
    const b = rec.def.id;
    if (b === 'dodge' || b === 'heavy' || b === 'flask') this._hold.quiet = fin(CONFIG.touch.hold?.quiet, 0.3);
  }

  /** A finger leaves a button: its action goes up with the last finger off it. */
  _release(rec, id) {
    if (!rec.ids.delete(id) || rec.ids.size) return;
    rec.el.classList.remove('on');
    this.game.input?.setVirtual?.(rec.def.code, false);
  }

  /** The pad: every touch on it holds the nearest tile, and follows the thumb from tile to tile. */
  _bindPad(pad) {
    const held = this.padHeld;
    pad.addEventListener('pointerdown', (e) =>
      this._guard('pad', () => {
        e.preventDefault?.();
        if (!this._live() || held.has(e.pointerId)) return;
        try {
          pad.setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        if (this.editing) {
          if (!this._drag) this._drag = { id: e.pointerId, x: fin(e.clientX), y: fin(e.clientY), ox: this.padOff.x, oy: this.padOff.y };
          return;
        }
        this._padOrigin();
        const rec = this._padPick(fin(e.clientX, NaN), fin(e.clientY, NaN), null);
        if (!rec) return;
        held.set(e.pointerId, rec);
        this._press(rec, e.pointerId);
      }, e),
    );
    pad.addEventListener('pointermove', (e) =>
      this._guard('pad', () => {
        const D = this._drag;
        if (D && D.id === e.pointerId) {
          const f = Math.max(0.1, this.fit);
          this.padOff.x = D.ox - (fin(e.clientX, D.x) - D.x) / f;
          this.padOff.y = D.oy - (fin(e.clientY, D.y) - D.y) / f;
          this._padLayout();
          return;
        }
        const cur = held.get(e.pointerId);
        if (!cur || !CONFIG.touch.pad.slide) return;
        const next = this._padPick(fin(e.clientX, NaN), fin(e.clientY, NaN), cur);
        if (!next || next === cur) return;
        this._release(cur, e.pointerId); // the old tile's release edge first, then the new one's press
        held.set(e.pointerId, next);
        this._press(next, e.pointerId);
      }, e),
    );
    const end = (e) => {
      if (this._drag?.id === e.pointerId) {
        this._drag = null;
        this._savePad();
        return;
      }
      const cur = held.get(e.pointerId);
      if (!cur) return;
      held.delete(e.pointerId);
      this._release(cur, e.pointerId);
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(n, (e) => this._guard('pad', end, e));
    pad.addEventListener('contextmenu', (e) => e.preventDefault?.());
  }

  _bindStick(zone) {
    const S = this.stick;
    zone.addEventListener('pointerdown', (e) =>
      this._guard('stick', () => {
        e.preventDefault?.();
        if (!this._live() || S.id !== null) return;
        try {
          zone.setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        S.id = e.pointerId;
        // floating stick: it centres under the thumb (kept fully on screen)
        const m = RING_R * this.fit + 14;
        S.ox = Math.min(Math.max(fin(e.clientX), m), Math.max(m, fin(globalThis.innerWidth, 800) * 0.5));
        S.oy = Math.min(Math.max(fin(e.clientY), m), Math.max(m, fin(globalThis.innerHeight, 400) - m));
        this._stickTo(fin(e.clientX, S.ox), fin(e.clientY, S.oy));
      }, e),
    );
    zone.addEventListener('pointermove', (e) =>
      this._guard('stick', () => {
        if (e.pointerId !== S.id) return;
        this._stickTo(fin(e.clientX, S.ox), fin(e.clientY, S.oy));
      }, e),
    );
    const end = (e) => {
      if (e.pointerId !== S.id) return;
      this._stickRelease();
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(n, (e) => this._guard('stick', end, e));
  }

  /** Stick at screen point (x, y): virtual axis, sprint, aim direction, knob + ring. */
  _stickTo(x, y) {
    const S = this.stick, T = CONFIG.touch, F = Math.max(0.1, this.fit), R = T.stickRadius * F;
    const dx = x - S.ox, dy = y - S.oy;
    const len = Math.hypot(dx, dy);
    const m = Math.min(1, len / R);
    S.mag = m;
    let ax = 0, ay = 0;
    if (m > T.deadZone && len > 0) {
      const k = Math.min(1, (m - T.deadZone) / Math.max(0.01, T.runAt - T.deadZone));
      ax = (dx / len) * k;
      ay = (-dy / len) * k; // screen down = south
      this.aim.x = dx / len; // world +X = screen right, world +Z = screen down
      this.aim.z = dy / len;
      this.aim.set = true;
    }
    const input = this.game.input;
    input?.setVirtualAxis?.(ax, ay);
    const sprint = m >= T.sprintAt || (S.sprint && m >= T.sprintAt - SPRINT_OFF);
    if (sprint !== S.sprint) {
      S.sprint = sprint;
      input?.setVirtual?.('@sprint', sprint);
    }
    // visuals
    const u = this.ui;
    if (!u) return;
    const kl = Math.min(len, R), kx = len > 0 ? (dx / len) * kl : 0, ky = len > 0 ? (dy / len) * kl : 0;
    u.stick.style.transform = `translate3d(${S.ox.toFixed(1)}px, ${S.oy.toFixed(1)}px, 0)`;
    u.knob.style.transform = `translate3d(${(kx / F).toFixed(1)}px, ${(ky / F).toFixed(1)}px, 0)`; // (inside the scaled stick)
    this._stickClass(true, sprint);
    const lit = m > T.deadZone ? ((Math.round((Math.atan2(dy, dx) / TAU) * RING) % RING) + RING) % RING : -1;
    this._ring(lit);
  }

  _stickRelease() {
    const S = this.stick;
    S.id = null;
    S.mag = 0;
    const input = this.game.input;
    input?.setVirtualAxis?.(0, 0);
    if (S.sprint) {
      S.sprint = false;
      input?.setVirtual?.('@sprint', false);
    }
    this._restStick();
  }

  _restStick() {
    const u = this.ui, S = this.stick;
    if (!u) return;
    const rest = this._stickRest();
    S.ox = rest.x;
    S.oy = rest.y;
    u.stick.style.transform = `translate3d(${S.ox}px, ${S.oy}px, 0)`;
    u.knob.style.transform = 'translate3d(0px, 0px, 0)';
    this._stickClass(false, false);
    this._ring(-1);
  }

  _stickClass(on, sprint) {
    const S = this.stick, u = this.ui;
    if (!u || (S.on === on && S._sp === sprint)) return;
    S.on = on;
    S._sp = sprint;
    u.stick.classList.toggle('on', on);
    u.stick.classList.toggle('sprint', sprint);
    u.tag.textContent = sprint ? 'SPRINT' : 'MOVE';
  }

  _ring(lit) {
    const S = this.stick, u = this.ui;
    if (!u || S.lit === lit) return;
    S.lit = lit;
    for (let i = 0; i < RING; i++) {
      const d = lit < 0 ? RING : Math.min((i - lit + RING) % RING, (lit - i + RING) % RING);
      const c = u.dots[i];
      c.classList.toggle('l2', d === 0);
      c.classList.toggle('l1', d === 1);
    }
  }

  _syncButtons() {
    const p = this.game.player, B = this.btn, K = this._keys;
    if (!p || !B) return;
    // HEAVY: ASCII charge meter while the cleave charges (the heavy button holds the charge, ADR-115)
    const charging = p.state === 'charge';
    const cells = charging ? Math.max(0, Math.min(CHARGE_CELLS, Math.round(fin(p.chargeK) * CHARGE_CELLS))) : -1;
    if (cells !== K.charge && B.heavy) {
      K.charge = cells;
      const a = B.heavy;
      a.el.classList.toggle('charge', charging);
      a.el.classList.toggle('full', cells === CHARGE_CELLS);
      if (a.t) a.t.textContent = charging ? `[${'#'.repeat(cells)}${'.'.repeat(CHARGE_CELLS - cells)}]` : 'HEAVY';
    }
    // FLASK: count, dim when empty
    const inf = !!p.debug?.infiniteFlasks;
    const n = inf ? 99 : Math.max(0, Math.round(fin(p.flasks)));
    if (n !== K.flask) {
      K.flask = n;
      const f = B.flask;
      if (f.t) f.t.textContent = inf ? 'FLASK ∞' : `FLASK ${n}`;
      f.el.classList.toggle('dim', n <= 0);
    }
    // BLOCK: the guard meter as a gauge along the tile's foot, warm when it runs low
    const gMax = Math.max(1, fin(p.maxGuard, 100));
    const gd = Math.max(0, Math.min(GUARD_STEPS, Math.round((fin(p.guard, gMax) / gMax) * GUARD_STEPS)));
    if (gd !== K.guard) {
      K.guard = gd;
      const low = gd / GUARD_STEPS < 0.3, turned = low !== K.low;
      K.low = low;
      for (const b of [B.block, B.guard]) {
        if (!b) continue;
        setVar(b.el, '--tc-gd', (gd / GUARD_STEPS).toFixed(2));
        if (turned) b.el.classList.toggle('low', low);
      }
    }
    // LOCK: lit while locked on
    const lock = !!p.lockOn;
    if (lock !== K.lock) {
      K.lock = lock;
      B.lock.el.classList.toggle('lit', lock);
    }
  }

  // ---------------------------------------------------------------- window pointers
  /** Controls accept presses: active, landscape, in play, not hidden by the model viewer. */
  _live() {
    return this.active && this._shown === true;
  }

  _canvas() {
    return this.game.renderer?.domElement ?? globalThis.document?.getElementById?.('game') ?? null;
  }

  _onDown(e) {
    if (e?.pointerType !== 'touch') return;
    if (!this.active) {
      if (this.forced === false) return;
      this.setActive(true); // first touch on a device that did not report a coarse pointer
    }
    if (e.target !== this._canvas()) return; // controls / menus / Lab handle their own
    e.preventDefault?.();
    const st = this.game.state;
    if (TAP_DISMISS.has(st)) {
      // "press any key": the tap is a click on the game canvas
      this.taps.set(e.pointerId, 'Mouse0');
      this.game.input?.setVirtual?.('Mouse0', true);
    } else if (PLAY.has(st)) {
      this.pinch.set(e.pointerId, { x: fin(e.clientX), y: fin(e.clientY) });
      this.pinchD0 = 0;
      // SWIPE DODGE: a finger on the bare right half may be a flick; a second bare finger is a pinch
      if (this.pinch.size > 1) this.swipes.clear();
      else if (this.swipeDodge && this._live() && fin(e.clientX) >= fin(globalThis.innerWidth, 800) * fin(CONFIG.touch.swipe?.from, 0.5)) {
        this.swipes.set(e.pointerId, { x: fin(e.clientX), y: fin(e.clientY), t: this._now(), done: false });
      }
    }
  }

  _now() {
    const p = globalThis.performance;
    return typeof p?.now === 'function' ? p.now() / 1000 : Date.now() / 1000;
  }

  /** A bare-screen finger on the right half moved: a quick enough flick dodges its way, once. */
  _swipeMove(e) {
    const S = this.swipes.get(e?.pointerId);
    if (!S || S.done) return;
    const W = CONFIG.touch.swipe ?? {};
    if (!this._live() || this._now() - S.t > fin(W.time, 0.2)) {
      this.swipes.delete(e.pointerId); // too slow: a drag, not a flick
      return;
    }
    const dx = fin(e.clientX, S.x) - S.x, dy = fin(e.clientY, S.y) - S.y;
    if (Math.hypot(dx, dy) < fin(W.dist, 30) * Math.max(0.5, this.fit)) return;
    S.done = true;
    this.game.input?.dodgeToward?.(dx, -dy); // screen y down → the move axis's y up (north)
    this._swipeMark(S.x, S.y, dx, dy);
  }

  /** The flick's mark: a short ASCII streak where the thumb went, gone in a moment. */
  _swipeMark(x, y, dx, dy) {
    const root = this.ui?.root;
    if (!root) return;
    let m = this.ui.swipeEl;
    if (!m) m = this.ui.swipeEl = el('div', 'tc-swipe', '»»»', root);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    m.style.left = `${Math.round(x)}px`;
    m.style.top = `${Math.round(y)}px`;
    m.style.transform = `translate(-10%, -50%) rotate(${a.toFixed(0)}deg)`;
    m.classList.remove('on');
    void m.offsetWidth; // restart the fade
    m.classList.add('on');
  }

  _onMove(e) {
    const p = this.pinch.get(e?.pointerId);
    if (!p) return;
    this._swipeMove(e);
    p.x = fin(e.clientX, p.x);
    p.y = fin(e.clientY, p.y);
    if (this.pinch.size !== 2) return;
    const [a, b] = this.pinch.values();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const rig = this.game.cameraRig;
    if (!rig || !(d > 0)) return;
    if (!this.pinchD0) {
      this.pinchD0 = d;
      this.pinchZ0 = fin(rig.targetDistance, CONFIG.camera.distance);
      return;
    }
    // fingers apart = closer; the distance scales with the pinch ratio, clamped by the rig
    const want = this.pinchZ0 * (this.pinchD0 / Math.max(24, d));
    rig.zoom((want - rig.targetDistance) / 2.5);
  }

  _onUp(e) {
    const id = e?.pointerId;
    if (this.pinch.delete(id)) this.pinchD0 = 0;
    this.swipes.delete(id);
    this._tapUp(e);
  }

  _promptDown(e) {
    if (!this.active) return;
    e.preventDefault?.();
    // the prompt's action chip ("[@interact] Rest at bonfire") is the action the tap presses
    const m = /\[@([A-Za-z]+)\]/.exec(String(this.game.hud?.promptText ?? ''));
    if (!m) return;
    const code = `@${m[1]}`;
    this.taps.set(e.pointerId, code);
    this.game.input?.setVirtual?.(code, true);
  }

  _tapUp(e) {
    const code = this.taps.get(e?.pointerId);
    if (code === undefined) return;
    this.taps.delete(e.pointerId);
    for (const c of this.taps.values()) if (c === code) return; // another finger still holds it
    this.game.input?.setVirtual?.(code, false);
  }

  // ---------------------------------------------------------------- release
  /** Buttons + stick up (with their release edges). */
  _releaseControls() {
    for (const b of this.buttons) {
      if (!b.ids.size) continue;
      b.ids.clear();
      b.el.classList.remove('on');
      this.game.input?.setVirtual?.(b.def.code, false);
    }
    this.padHeld.clear();
    if (this.stick.id !== null || this.stick.sprint) this._stickRelease();
    this.pinch.clear();
    this.pinchD0 = 0;
    this.swipes.clear();
  }

  _releaseAll() {
    this._releaseControls();
    this.taps.clear();
    this.game.input?.releaseVirtual?.();
  }

  // ---------------------------------------------------------------- errors
  _guard(label, fn, e) {
    try {
      fn(e);
    } catch (err) {
      this._report(label, err);
    }
  }

  _try(fn, label) {
    try {
      return fn();
    } catch (err) {
      this._report(label, err);
      return undefined;
    }
  }

  _report(label, err) {
    if (++this._errors > 5) return;
    console.error(`[touch] ${label} failed`, err);
  }
}
