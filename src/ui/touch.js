import { CONFIG } from '../core/config.js';
import { el } from './dom.js';
import { injectTouchStyle } from './touchStyle.js';

// Touch controls for phones / tablets (contract: docs/ARCHITECTURE.md → Touch controls).
// A thin layer ON TOP of core/input.js: the left-thumb stick feeds input.setVirtualAxis(), the
// right-thumb buttons feed input.setVirtual(code, down) with the real key / mouse codes, so the
// player and flow keep reading the same game.input API and every edge (tap / hold / release) is
// the real device's:
//   stick → move (analog; pushed to the rim = Shift sprint)   ATTACK → Mouse0 (tap light, hold thrust)
//   BLOCK → Mouse2 (hold block, tap parry)   DODGE → Space   FLASK → KeyF   LOCK → Tab   || → Escape
// Aim: in a fight with the dragon targetable (and within CONFIG.touch.autoAimRange) game.mouseGround
// is put on its lock point (auto-aim); otherwise it sits CONFIG.touch.aimDistance m ahead of the hero
// along the last stick direction. Taps on the bare screen dismiss "press any key" screens (title,
// death) as a virtual click; the HUD prompt ("[E] Rest", "[R] Fight again") is tappable. Two fingers
// on the bare screen pinch-zoom through cameraRig.zoom. Portrait shows a rotate overlay and pauses.
// Inert (no DOM, no state) until activated: `pointer: coarse` at boot, ?touch in the URL, or the
// first touch. ?touch=0 keeps it off. Desktop mouse + keyboard play never sees it.

const PLAY = new Set(['explore', 'bossIntro', 'boss']);
const TAP_DISMISS = new Set(['title', 'dead']);
const RING = 12; // glyphs around the stick: an ASCII-drawn circle, arrows at the four cardinals
const RING_R = 62; // px
const TAU = Math.PI * 2;
const CHARGE_CELLS = 6;
const SPRINT_OFF = 0.08; // hysteresis below sprintAt before the sprint drops

const BUTTONS = [
  { id: 'attack', code: 'Mouse0', glyph: '†', label: 'ATTACK' },
  { id: 'block', code: 'Mouse2', glyph: '[#]', label: 'BLOCK', sub: 'tap: parry' },
  { id: 'dodge', code: 'Space', glyph: '»', label: 'DODGE' },
  { id: 'flask', code: 'KeyF', glyph: '◆', label: 'FLASK' },
  { id: 'lock', code: 'Tab', glyph: '◎', label: 'LOCK' },
  { id: 'pause', code: 'Escape', glyph: '||', label: '' },
];

// a phone in portrait, drawn in ASCII (the overlay turns it to landscape); '@' is the hero
const PHONE_ART = [
  ' .------. ',
  ' |  --  | ',
  ' | .--. | ',
  ' | |  | | ',
  ' | | <b>@</b>| | ',
  ' | |  | | ',
  " | '--' | ",
  ' |  ()  | ',
  " '------' ",
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

function media(query) {
  try {
    return !!globalThis.matchMedia?.(query)?.matches;
  } catch {
    return false;
  }
}

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

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
    this._keys = { charge: -1, flask: -1, lock: null };
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
    on(
      globalThis.document,
      'touchmove',
      (e) => {
        if (!this.active || e.target?.closest?.('.lab-root, .ab-pause-panel')) return; // scrollable panels
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
    globalThis.document?.documentElement?.classList?.toggle('abyss-touch', on);
    this.game.hud?.root?.classList?.toggle('ab-touch', on);
    if (this.ui) this.ui.root.style.display = on ? '' : 'none';
    const s = this.game.settings;
    if (on && s && !this._qualitySet && s.quality === CONFIG.defaultQuality) {
      // touch devices start on the light preset (unless the player already picked one)
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
      this.ui?.rotate.classList.remove('on');
      this.portrait = false;
      this.phone = false;
      this.autoAim = false;
      this.game.cameraRig?.setMobile?.(false);
    }
    this._shown = null;
    this._layout(true);
  }

  /** Per frame (main.js, right after the mouse ray and before the Lab / flow / player). */
  update() {
    if (!this.active) return;
    const g = this.game;
    this._layout(false);
    const st = g.state;
    const play = PLAY.has(st);
    if (this.portrait && play) g.flow?.pause?.(true); // rotate overlay up: the fight waits
    const live = play && !this.portrait && !g.lab?.viewer?.active;
    if (live !== this._shown) {
      this._shown = live;
      this.ui?.root.classList.toggle('off', !live);
      if (!live) this._releaseControls();
    }
    if (play) this._aimUpdate();
    else this.autoAim = false;
    if (live) this._syncButtons();
  }

  // ---------------------------------------------------------------- aim
  _aimUpdate() {
    const g = this.game, p = g.player, mg = g.mouseGround, pos = p?.position;
    if (!pos || !mg) return;
    const d = g.dragon;
    this.autoAim = false;
    if (p.alive !== false && typeof d?.isTargetable === 'function' && typeof d.lockPoint === 'function' && d.isTargetable()) {
      d.lockPoint(this._v);
      const dx = this._v.x - pos.x, dz = this._v.z - pos.z, r = CONFIG.touch.autoAimRange;
      if (Number.isFinite(dx + dz) && dx * dx + dz * dz <= r * r) {
        mg.set(this._v.x, 0, this._v.z);
        this.autoAim = true;
        return;
      }
    }
    const A = this.aim;
    if (!A.set) {
      const y = fin(p.yaw, Math.PI);
      A.x = Math.sin(y);
      A.z = Math.cos(y);
      A.set = true;
    }
    const D = CONFIG.touch.aimDistance;
    mg.set(pos.x + A.x * D, 0, pos.z + A.z * D);
  }

  // ---------------------------------------------------------------- layout / visibility
  _layout(force) {
    const w = fin(globalThis.innerWidth, 1), h = fin(globalThis.innerHeight, 1);
    if (!force && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    if (!this.active) return;
    this.phone = Math.min(w, h) <= CONFIG.camera.mobileMaxSide;
    this.game.cameraRig?.setMobile?.(this.phone);
    const portrait = h > w;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.ui?.rotate.classList.toggle('on', portrait);
      if (portrait) this._releaseAll();
    }
    if (this.stick.id === null) this._restStick();
  }

  // ---------------------------------------------------------------- DOM
  _build() {
    if (this.ui || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    try {
      injectTouchStyle();
      const host = document.getElementById?.('ui') ?? document.body;
      if (!host) return;
      const root = el('div', 'tc-root off', null, host);
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

      this.ui = { root, zone, stick, knob, tag, dots, rotate: null };
      this._bindStick(zone);

      // right thumb: buttons
      this.buttons = BUTTONS.map((def) => this._button(root, def));
      this.btn = Object.fromEntries(this.buttons.map((b) => [b.def.id, b]));

      // the HUD prompt ("[E] Rest at bonfire", "[R] Fight again") is a tap target on touch
      const prompt = this.game.hud?.promptEl;
      if (prompt?.addEventListener) {
        prompt.addEventListener('pointerdown', (e) => this._guard('prompt', () => this._promptDown(e), e));
        prompt.addEventListener('pointerup', (e) => this._guard('prompt', () => this._tapUp(e), e));
        prompt.addEventListener('pointercancel', (e) => this._guard('prompt', () => this._tapUp(e), e));
      }

      // portrait: rotate your phone
      const rot = el('div', 'tc-rotate', null, document.body ?? host);
      const art = el('pre', 'tc-phone', null, rot);
      art.innerHTML = PHONE_ART.join('\n');
      el('div', 'h', 'ROTATE YOUR PHONE', rot);
      el('div', 'rule', '◆', rot);
      el('div', 'sub', 'ABYSS is played in landscape', rot);
      this.ui.rotate = rot;
      this._restStick();
    } catch (err) {
      this._report('build', err);
      this.ui?.root?.remove?.();
      this.ui = null;
    }
  }

  _button(root, def) {
    const b = el('button', `tc-btn tc-${def.id}`, null, root);
    b.type = 'button';
    b.tabIndex = -1;
    const g = el('span', 'g', def.glyph, b);
    const t = def.label ? el('span', 't', def.label, b) : null;
    if (def.sub) el('span', 's', def.sub, b);
    const rec = { def, el: b, g, t, ids: new Set() };
    const down = (e) => {
      e.preventDefault?.(); // no compatibility mouse events, no focus, no text selection
      if (!this._live() || rec.ids.has(e.pointerId)) return;
      try {
        b.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic pointer: capture is a nicety */
      }
      rec.ids.add(e.pointerId);
      if (rec.ids.size === 1) {
        b.classList.add('on');
        this.game.input?.setVirtual?.(def.code, true);
      }
    };
    const up = (e) => {
      if (!rec.ids.delete(e.pointerId) || rec.ids.size) return;
      b.classList.remove('on');
      this.game.input?.setVirtual?.(def.code, false);
    };
    b.addEventListener('pointerdown', (e) => this._guard(def.id, down, e));
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(n, (e) => this._guard(def.id, up, e));
    b.addEventListener('contextmenu', (e) => e.preventDefault?.());
    b.addEventListener('click', (e) => e.preventDefault?.());
    return rec;
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
        const m = RING_R + 14;
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
    const S = this.stick, T = CONFIG.touch, R = T.stickRadius;
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
      input?.setVirtual?.('ShiftLeft', sprint);
    }
    // visuals
    const u = this.ui;
    if (!u) return;
    const kl = Math.min(len, R), kx = len > 0 ? (dx / len) * kl : 0, ky = len > 0 ? (dy / len) * kl : 0;
    u.stick.style.transform = `translate3d(${S.ox.toFixed(1)}px, ${S.oy.toFixed(1)}px, 0)`;
    u.knob.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0)`;
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
      input?.setVirtual?.('ShiftLeft', false);
    }
    this._restStick();
  }

  _restStick() {
    const u = this.ui, S = this.stick;
    if (!u) return;
    const R = RING_R + 22;
    S.ox = R + 18;
    S.oy = Math.max(R, fin(globalThis.innerHeight, 400) - R - 14);
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
    // ATTACK: ASCII charge meter while the thrust charges
    const charging = p.state === 'charge';
    const cells = charging ? Math.max(0, Math.min(CHARGE_CELLS, Math.round(fin(p.chargeK) * CHARGE_CELLS))) : -1;
    if (cells !== K.charge) {
      K.charge = cells;
      const a = B.attack;
      a.el.classList.toggle('charge', charging);
      a.el.classList.toggle('full', cells === CHARGE_CELLS);
      if (a.t) a.t.textContent = charging ? `[${'#'.repeat(cells)}${'.'.repeat(CHARGE_CELLS - cells)}]` : 'ATTACK';
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
    return this.active && !this.portrait && this._shown === true;
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
    if (e.target !== this._canvas() || this.portrait) return; // controls / menus / Lab handle their own
    e.preventDefault?.();
    const st = this.game.state;
    if (TAP_DISMISS.has(st)) {
      // "press any key": the tap is a click on the game canvas
      this.taps.set(e.pointerId, 'Mouse0');
      this.game.input?.setVirtual?.('Mouse0', true);
    } else if (PLAY.has(st)) {
      this.pinch.set(e.pointerId, { x: fin(e.clientX), y: fin(e.clientY) });
      this.pinchD0 = 0;
    }
  }

  _onMove(e) {
    const p = this.pinch.get(e?.pointerId);
    if (!p) return;
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
    this._tapUp(e);
  }

  _promptDown(e) {
    if (!this.active || this.portrait) return;
    e.preventDefault?.();
    const m = /\[([A-Z0-9])\]/.exec(String(this.game.hud?.promptText ?? ''));
    if (!m) return;
    const code = /[0-9]/.test(m[1]) ? `Digit${m[1]}` : `Key${m[1]}`;
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
    if (this.stick.id !== null || this.stick.sprint) this._stickRelease();
    this.pinch.clear();
    this.pinchD0 = 0;
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
