import { ACTIONS, STICK_CLICKS } from '../core/bindings.js';
import { CONFIG } from '../core/config.js';
import { aimWithoutCursor } from './aim.js';
import { relabelChips } from './dom.js';

// Gamepad controls (contract: docs/ARCHITECTURE.md → Gamepad controls; ADR-066, ADR-067).
// A thin layer ON TOP of core/input.js, like the touch controls: it polls navigator.getGamepads()
// once a frame and, for every action bound to a pad button (core/bindings.js; remappable in the
// pause menu's CONTROLS panel), holds that action's virtual code '@<action>' with input.setPad
// while one of its buttons is down, so the player and flow read the same actions and every edge
// (the parry tap, the charge hold) is the real device's. The left stick moves (setPadAxis), the
// right stick aims; neither is remappable. Default layout (Gamepad API "standard" mapping, Xbox
// names; PlayStation in brackets):
//   RB / RT [R1 / R2] attack   LB / LT [L1 / L2] block, tap parry   A [✕] dodge   B [○] hold sprint
//   L3 sprint until the stick is let go (any stick click bound to sprint latches)   X [□] flask
//   Y [△] rest / fight again   R3 lock-on   View [Share] help   D-pad up / down zoom
//   Menu [Options] pause (fixed, never remappable)
// Menus: on the title any button starts (D-pad left / right + A picks a stage); in the pause menu
// the D-pad / stick moves a focus over its buttons, A presses one, B or Menu resumes; in the CONTROLS
// panel LB / RB switch tabs, A picks a row and the next button press is its new binding.
// Active = the pad is the device in use (its last input is newer than the last keyboard / mouse /
// touch event): `html.abyss-pad` swaps the on-screen hints to pad buttons. A button held across a
// screen change (menu ↔ play, the CONTROLS panel) counts only once it is let go, so the A that
// closes the title never rolls, the Menu that resumes never pauses again. Rumble where supported.

const BTN = { A: 0, B: 1, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const N_BTN = 16;
const TRIGGERS = new Set([BTN.LT, BTN.RT]);
const MENU = new Set(['title', 'paused']); // no gameplay codes: the pad drives the screen instead
const AIM = new Set(['explore', 'bossIntro', 'boss']);
// every button but the D-pad and View dismisses "press any key" on the title
const ANY = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
// the actions the pad holds as '@<action>' codes (zoom is the camera's, handled here)
const HELD = ACTIONS.filter((a) => a.pad && a.id !== 'zoomIn' && a.id !== 'zoomOut').map((a) => a.id);
// Sony's USB vendor id 054c is in Chrome's and Firefox's id strings (an Xbox pad is a "Wireless Controller" too)
const PS_ID = /playstation|dualsense|dualshock|054c/i;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class GamepadControls {
  constructor(game) {
    this.game = game;
    this.active = false; // the pad is the device in use
    this.connected = false;
    this.id = '';
    this.layout = 'xbox';
    this.autoAim = false; // this frame's aim is on the boss
    this.aim = { x: 0, z: -1, set: false };
    this.pad = null; // the latest Gamepad snapshot
    this.raw = new Array(N_BTN).fill(false); // physical state this frame (triggers with hysteresis)
    this.eff = new Array(N_BTN).fill(false); // effective (held and not blocked) this frame
    this.prev = new Array(N_BTN).fill(false); // effective last frame
    this.blocked = new Set(); // held across a screen change: ignored until let go
    this.mode = null; // 'menu' | 'play'
    this.lastPadT = -Infinity; // performance.now() of the last pad activity
    this.sprintLatch = false; // a stick click bound to sprint: sprint until the stick is let go
    this.focus = -1; // menu focus (index into the current screen's buttons)
    this._focusEl = null;
    this._menuKey = null; // which list the focus indexes ('pause', 'remap:kb', ...)
    this.nav = { dir: 0, t: 0 };
    this._v = game.THREE ? new game.THREE.Vector3() : { x: 0, y: 0, z: 0, set() { return this; } };

    if (typeof addEventListener === 'function') {
      addEventListener('gamepadconnected', (e) => this._announce(e?.gamepad, true));
      addEventListener('gamepaddisconnected', (e) => this._announce(e?.gamepad, false));
    }
    this._subscribe(game.events);
  }

  /** The pad button(s) bound to an action, as shown on screen ('A', '△', 'RB'), or null. */
  actionText(action) {
    if (!this.active) return null;
    const t = this.game.input?.bindings?.padText?.(action, this.layout);
    return t && t !== '—' ? t : null;
  }

  /** Per frame (main.js, right after the mouse ray and before the touch layer / Lab / flow / player). */
  update(realDt) {
    const g = this.game, inp = g.input;
    if (!inp?.setPad) return;
    const pad = this._poll();
    if (!pad) {
      if (this.connected) this._lost();
      return;
    }
    this.connected = true;
    this.pad = pad;
    if (pad.id !== this.id) {
      this.id = String(pad.id ?? '');
      this._setLayout(PS_ID.test(this.id) ? 'ps' : 'xbox');
    }
    const C = CONFIG.gamepad;
    const btn = pad.buttons ?? [];
    let edge = false;
    for (let i = 0; i < N_BTN; i++) {
      const b = btn[i];
      const v = fin(typeof b === 'object' ? b?.value : b);
      const on = TRIGGERS.has(i) ? v >= (this.raw[i] ? C.triggerOff : C.triggerOn) : !!(typeof b === 'object' ? b?.pressed : b) || v > 0.5;
      if (on && !this.raw[i]) edge = true;
      this.raw[i] = on;
    }
    const ax = pad.axes ?? [];
    const lx = fin(ax[0]), ly = fin(ax[1]), rx = fin(ax[2]), ry = fin(ax[3]);
    const lm = Math.hypot(lx, ly), rm = Math.hypot(rx, ry);
    if (edge || lm > C.deadZone || rm > C.aimDeadZone) this.lastPadT = now();

    const active = this.lastPadT > fin(inp.kbmT, -Infinity) && this.lastPadT > fin(inp.lastTouch, -Infinity);
    if (active !== this.active) this._setActive(active);
    if (!active) {
      if (this.mode) this._releaseAll();
      return;
    }

    // a mode change while in use blocks what is held; the press that makes the pad active counts
    const mode = MENU.has(g.state) ? 'menu' : 'play';
    if (mode !== this.mode) {
      const was = this.mode;
      this._releaseAll();
      this.mode = mode;
      if (was) this._blockHeld();
    }
    for (const i of this.blocked) if (!this.raw[i]) this.blocked.delete(i);
    for (let i = 0; i < N_BTN; i++) {
      this.prev[i] = this.eff[i];
      this.eff[i] = this.raw[i] && !this.blocked.has(i);
    }

    if (mode === 'play') this._play(lx, ly, lm, rx, ry, rm);
    else this._menu(realDt, ly);
  }

  // ---------------------------------------------------------------- play
  _play(lx, ly, lm, rx, ry, rm) {
    const g = this.game, inp = g.input, C = CONFIG.gamepad, B = inp.bindings;
    const down = (i) => this.eff[i];
    const pressed = (i) => this.eff[i] && !this.prev[i];
    this._clearFocus();

    // move: radial dead zone, rescaled so full run arrives at runAt; stick up = north
    const k = lm <= C.deadZone ? 0 : Math.min(1, (lm - C.deadZone) / Math.max(1e-3, C.runAt - C.deadZone));
    const mx = k > 0 ? (lx / lm) * k : 0, my = k > 0 ? (-ly / lm) * k : 0;
    inp.setPadAxis(mx, my);
    if (k === 0) this.sprintLatch = false;

    // every pad-bound action: '@<action>' held while one of its buttons is
    for (const a of HELD) {
      let on = false;
      for (const i of B?.buttons(a) ?? []) {
        if (a === 'sprint' && STICK_CLICKS.has(i)) {
          if (pressed(i) && k > 0) this.sprintLatch = true; // a stick click latches the sprint
        } else if (down(i)) on = true;
      }
      inp.setPad(`@${a}`, on || (a === 'sprint' && this.sprintLatch));
    }
    for (const i of B?.buttons('zoomIn') ?? []) if (pressed(i)) g.cameraRig?.zoom?.(-1);
    for (const i of B?.buttons('zoomOut') ?? []) if (pressed(i)) g.cameraRig?.zoom?.(1);

    // aim (the touch layer owns it while it is on): the right stick steers; idle → auto-aim at the
    // boss in range, else ahead along the last move direction (screen right = +X, screen down = +Z)
    if (!AIM.has(g.state) || g.touch?.active) {
      this.autoAim = false;
      return;
    }
    const A = this.aim;
    if (rm > C.aimDeadZone) {
      A.x = rx / rm;
      A.z = ry / rm;
      A.set = true;
      aimWithoutCursor(g, A, 0, C.aimDistance, this._v);
      this.autoAim = false;
      return;
    }
    if (k > 0) {
      A.x = mx / k;
      A.z = -my / k;
      A.set = true;
    }
    this.autoAim = aimWithoutCursor(g, A, C.autoAimRange, C.aimDistance, this._v);
  }

  // ---------------------------------------------------------------- menus
  _menu(realDt, ly) {
    const g = this.game, inp = g.input, B = BTN;
    const pressed = (i) => this.eff[i] && !this.prev[i];
    this.autoAim = false;
    if (g.state === 'paused') {
      const R = g.hud?.remapUi;
      if (R?.on) {
        inp.setPad('@pause', false);
        this._remap(R, realDt, ly, pressed);
        return;
      }
      const list = this._pauseButtons();
      this._useList('pause');
      // B (back) or Menu resumes: the flow toggles the pause on the pause action
      inp.setPad('@pause', this.eff[B.START] || this.eff[B.B]);
      if (this.focus < 0 || this.focus >= list.length) this.focus = 0; // opens on RESUME
      const step = this._navStep(realDt, this.eff[B.UP] || ly < -0.5, this.eff[B.DOWN] || ly > 0.5);
      if (step && list.length) this.focus = (this.focus + step + list.length) % list.length;
      if (pressed(B.A) && list.length) this._press(list[this.focus]);
      this._showFocus(list);
      return;
    }
    // title: D-pad left / right walks the stage picker, A on another stage picks it; anything else starts
    this._useList('title');
    const list = this._stageButtons();
    const step = this._navStep(realDt, this.eff[B.LEFT], this.eff[B.RIGHT]);
    if (step && list.length) {
      if (this.focus < 0) this.focus = Math.max(0, list.findIndex((b) => b.classList?.contains('on')));
      this.focus = (this.focus + step + list.length) % list.length;
    }
    this._showFocus(list);
    const target = this.focus >= 0 ? list[this.focus] : null;
    if (pressed(B.A) && target && !target.classList?.contains('on')) {
      this._press(target);
      return;
    }
    for (const i of ANY) {
      if (pressed(i)) {
        inp.pulse('Gamepad');
        break;
      }
    }
  }

  /** The CONTROLS panel (ui/remap.js): a waiting pad row takes the next press; else walk / pick / back. */
  _remap(R, realDt, ly, pressed) {
    const B = BTN;
    if (R.waiting) {
      this._showFocus(R.navButtons, -1);
      if (R.tab === 'pad') {
        for (let i = 0; i < N_BTN; i++) {
          if (!pressed(i)) continue;
          R.capturePad(i);
          this._blockHeld(); // the button just bound must not also act in the panel
          break;
        }
      } else if (pressed(B.B) || pressed(B.START)) R.cancel(); // a keyboard pick: B / Menu cancel it
      return;
    }
    if (pressed(B.B) || pressed(B.START)) {
      R.close();
      this._blockHeld(); // B closes the panel only, not the pause menu under it
      return;
    }
    if (pressed(B.LB)) R.setTab('kb');
    if (pressed(B.RB)) R.setTab('pad');
    const list = R.navButtons;
    this._useList(`remap:${R.tab}`);
    if (this.focus < 0 || this.focus >= list.length) this.focus = 0;
    const step = this._navStep(realDt, this.eff[B.UP] || ly < -0.5, this.eff[B.DOWN] || ly > 0.5);
    if (step && list.length) this.focus = (this.focus + step + list.length) % list.length;
    this._showFocus(list);
    if (pressed(B.A) && list.length) {
      this._press(list[this.focus]);
      this._blockHeld();
    }
  }

  /** The focus indexes a new list: start over at its top. */
  _useList(key) {
    if (key === this._menuKey) return;
    this._menuKey = key;
    this.focus = -1;
  }

  /** -1 / +1 on a fresh press and then every CONFIG.gamepad.menuRepeat s while held; 0 otherwise. */
  _navStep(dt, back, fwd) {
    const N = this.nav, dir = back ? -1 : fwd ? 1 : 0, rep = CONFIG.gamepad.menuRepeat;
    if (dir !== N.dir) {
      N.dir = dir;
      N.t = rep * 1.6;
      return dir;
    }
    if (!dir) return 0;
    N.t -= fin(dt);
    if (N.t > 0) return 0;
    N.t = rep;
    return dir;
  }

  _pauseButtons() {
    const list = this.game.hud?.pauseUi?.buttons ?? [];
    const touch = !!this.game.touch?.active;
    return list.filter((b) => b && (touch || !b.classList?.contains('tp-only')));
  }

  _stageButtons() {
    return this.game.hud?.titleUi?.stageButtons ?? [];
  }

  _press(b) {
    if (typeof b?.click === 'function') b.click();
  }

  _showFocus(list, index = this.focus) {
    const el = index >= 0 ? list[index] ?? null : null;
    if (el === this._focusEl) return;
    this._focusEl?.classList?.remove('pad-focus');
    el?.classList?.add('pad-focus');
    this._focusEl = el;
  }

  _clearFocus() {
    this._menuKey = null;
    if (this.focus < 0 && !this._focusEl) return;
    this.focus = -1;
    this._showFocus([]);
  }

  /** Everything held now counts only after it is let go. */
  _blockHeld() {
    for (let i = 0; i < N_BTN; i++) {
      if (!this.raw[i]) continue;
      this.blocked.add(i);
      this.eff[i] = false;
    }
  }

  // ---------------------------------------------------------------- devices
  _poll() {
    let pads;
    try {
      pads = globalThis.navigator?.getGamepads?.();
    } catch {
      return null; // a permissions policy can forbid the API
    }
    if (!pads) return null;
    let best = null;
    for (const p of pads) {
      if (!p || p.connected === false) continue;
      if (p.mapping === 'standard') return p;
      best ??= p;
    }
    return best;
  }

  _setActive(on) {
    this.active = on;
    globalThis.document?.documentElement?.classList?.toggle('abyss-pad', on);
    this.game.hud?.root?.classList?.toggle('ab-pad', on);
    relabelChips(); // every "[@action]" chip now shows the pad button (or the key again)
    if (!on) this._clearFocus();
  }

  _setLayout(layout) {
    this.layout = layout;
    relabelChips();
  }

  /** Release every pad hold (with `released` edges) and forget the frame state. */
  _releaseAll() {
    this.game.input?.releasePad?.();
    this.sprintLatch = false;
    this.mode = null;
    this.nav.dir = 0;
    for (let i = 0; i < N_BTN; i++) this.eff[i] = this.prev[i] = false;
  }

  _lost() {
    this.connected = false;
    this.pad = null;
    this.id = '';
    this._releaseAll();
    if (this.active) {
      this._setActive(false);
      if (AIM.has(this.game.state)) this.game.flow?.pause?.(true); // the fight waits for the pad
    }
  }

  _announce(pad, on) {
    const name = String(pad?.id ?? 'controller').replace(/\s*\(.*$/, '').slice(0, 40) || 'controller';
    this.game.hud?.log?.(on ? `Controller connected: ${name}.` : 'Controller disconnected.', 'system');
  }

  // ---------------------------------------------------------------- rumble
  _subscribe(ev) {
    if (!ev || typeof ev.on !== 'function') return;
    const R = CONFIG.gamepad.rumble;
    const on = (name, fn) => ev.on(name, (d) => this.active && fn(d && typeof d === 'object' ? d : {}));
    on('player:hurt', () => this.rumble(R.hurt));
    on('player:guardBreak', () => this.rumble(R.guardBreak));
    on('player:bounced', () => this.rumble(R.parry)); // his guard threw the blade back
    on('player:block', () => this.rumble(R.block));
    on('player:parry', (d) => this.rumble(d.perfect && !d.light ? R.perfectParry : d.light ? R.block : R.parry));
    on('player:perfectDodge', () => this.rumble(R.perfectDodge));
    on('player:hitDragon', (d) => d.heavy && this.rumble(R.hitHeavy));
  }

  /** Play [duration ms, strong, weak] on the active pad; silently nothing where unsupported. */
  rumble(fx) {
    const act = this.pad?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function' || !Array.isArray(fx)) return;
    try {
      const r = act.playEffect('dual-rumble', { startDelay: 0, duration: fin(fx[0], 100), strongMagnitude: fin(fx[1]), weakMagnitude: fin(fx[2]) });
      r?.catch?.(() => {});
    } catch {
      // some browsers throw on unsupported effects
    }
  }
}
