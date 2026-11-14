import { ACTIONS, RESERVED_KEYS, RESERVED_PAD, keyLabel, padLabel } from '../core/bindings.js';
import { button, el } from './dom.js';

// The CONTROLS panel (pause menu → CONTROLS; contract: docs/ARCHITECTURE.md → Bindings; ADR-067).
// Two tabs, KEYBOARD · MOUSE and CONTROLLER, one row per remappable action. Pick a row (click, or the
// pad's D-pad + A), then press the new key / mouse button / pad button: core/bindings.js takes it
// from any other action (a swap when that action would be left with nothing) and saves it.
// Esc (or the pad's Menu / B) cancels a pick; Esc / B / BACK close the panel. Reserved keys (Esc,
// F1-F3, `) and the pad's Menu are refused. The panel swallows the keys it uses (capture phase), so
// the game never sees the key that was just bound. Pad input reaches it through ui/gamepad.js.


export class RemapPanel {
  constructor(game, parent) {
    this.game = game;
    this.on = false;
    this.tab = 'kb'; // 'kb' | 'pad'
    this.waiting = null; // the action being rebound, or null
    this.rows = [];
    this._msg = '';
    this._eatClick = false; // a mouse button was just bound: its own click must not pick a row

    this.root = el('div', 'ab-remap', null, parent);
    const panel = el('div', 'ab-remap-panel ab-panel', null, this.root);
    el('div', 'ab-pause-title', 'CONTROLS', panel);
    const tabs = el('div', 'ab-remap-tabs', null, panel);
    tabs.dataset.nobind = '1';
    this.tabKb = button(tabs, '', () => this.setTab('kb'));
    this.tabKb.textContent = 'KEYBOARD · MOUSE';
    this.tabPad = button(tabs, '', () => this.setTab('pad'));
    this.tabPad.textContent = 'CONTROLLER';
    this.list = el('div', 'ab-remap-list', null, panel);
    this.hint = el('div', 'ab-remap-hint', null, panel);
    const foot = el('div', 'ab-remap-foot', null, panel);
    foot.dataset.nobind = '1';
    this.btnReset = button(foot, '', () => this.resetTab());
    this.btnReset.textContent = 'RESET TAB';
    this.btnBack = button(foot, 'primary', () => this.close());
    this.btnBack.textContent = 'BACK';

    // capture phase: before core/input (and the Lab), so a key being bound never reaches the game
    if (typeof addEventListener === 'function') {
      addEventListener('keydown', (e) => this._guard(() => this._onKey(e)), true);
      addEventListener('mousedown', (e) => this._guard(() => this._onMouse(e)), true);
      addEventListener('click', (e) => this._guard(() => this._onClick(e)), true);
      addEventListener('contextmenu', (e) => this.on && this.waiting && e.preventDefault?.(), true);
    }
    game.input?.bindings?.onChange?.(() => this._render());
  }

  get bindings() {
    return this.game.input?.bindings ?? null;
  }

  /** The buttons the gamepad walks, in order (the rows, RESET, BACK). */
  get navButtons() {
    return [...this.rows.map((r) => r.btn), this.btnReset, this.btnBack];
  }

  open() {
    this.tab = this.game.gamepad?.active ? 'pad' : 'kb';
    this.waiting = null;
    this._msg = '';
    this.on = true;
    this.root.classList.add('on');
    this.game.hud?.pauseUi?.root?.classList?.add('remap');
    this._render();
  }

  close() {
    if (!this.on) return;
    this.on = false;
    this.waiting = null;
    this.root.classList.remove('on');
    this.game.hud?.pauseUi?.root?.classList?.remove('remap');
  }

  setTab(tab) {
    if (tab !== 'kb' && tab !== 'pad') return;
    this.tab = tab;
    this.waiting = null;
    this._msg = '';
    this._render();
  }

  /** Start rebinding an action (its row was picked). */
  begin(id) {
    this.waiting = this.waiting === id ? null : id; // picking the same row again cancels
    this._msg = '';
    this._render();
  }

  cancel() {
    this.waiting = null;
    this._msg = '';
    this._render();
  }

  resetTab() {
    this.waiting = null;
    this._msg = '';
    this.bindings?.reset(true, this.tab);
    this._render();
  }

  /** A pad button pressed while a CONTROLLER row waits (ui/gamepad.js). Returns true when handled. */
  capturePad(i) {
    if (!this.on || !this.waiting || this.tab !== 'pad') return false;
    const id = this.waiting;
    if (RESERVED_PAD.has(i)) {
      this.cancel(); // Menu cancels the pick
      return true;
    }
    this.waiting = null;
    this._msg = this.bindings?.bindPad(id, i) ? '' : `${padLabel(i, this._layout())} can't be used`;
    this._render();
    return true;
  }

  // ---------------------------------------------------------------- keyboard / mouse capture
  _onKey(e) {
    if (!this.on) return;
    const code = e?.code;
    if (this.waiting) {
      swallow(e);
      if (e.repeat) return;
      if (code === 'Escape' || this.tab !== 'kb') {
        this.cancel();
        return;
      }
      const id = this.waiting;
      this.waiting = null;
      this._msg = RESERVED_KEYS.has(code) || !this.bindings?.bindKey(id, code) ? `${keyLabel(code)} is reserved` : '';
      this._render();
      return;
    }
    if (code === 'Escape') {
      swallow(e); // Esc closes this panel, not the pause menu
      this.close();
    }
  }

  _onMouse(e) {
    this._eatClick = false;
    if (!this.on || !this.waiting || this.tab !== 'kb') return;
    const b = e?.button;
    if (!(b >= 0 && b <= 2) || this.game.input?._fromTouch?.()) return;
    if (e.target?.closest?.('[data-nobind]')) return; // the tabs, RESET and BACK stay clickable
    swallow(e);
    const id = this.waiting;
    this.waiting = null;
    this._eatClick = true;
    this._msg = this.bindings?.bindKey(id, `Mouse${b}`) ? '' : 'that button is reserved';
    this._render();
  }

  /** The click that ends a binding mousedown (it would land on a row and pick it again). */
  _onClick(e) {
    if (!this._eatClick) return;
    this._eatClick = false;
    swallow(e);
  }

  // ---------------------------------------------------------------- view
  _layout() {
    return this.game.gamepad?.layout ?? 'xbox';
  }

  _render() {
    if (!this.on) return;
    const B = this.bindings, pad = this.tab === 'pad', layout = this._layout();
    this.tabKb.classList.toggle('on', !pad);
    this.tabPad.classList.toggle('on', pad);
    // rows: rebuilt only when the tab changes; their values are rewritten every render
    const ids = ACTIONS.filter((a) => !a.fixed && (pad ? a.pad : a.kb)).map((a) => a.id);
    if (this._rowsFor !== this.tab) {
      this._rowsFor = this.tab;
      this.list.textContent = '';
      this.rows = ids.map((id) => {
        const def = ACTIONS.find((a) => a.id === id);
        const btn = button(this.list, 'ab-remap-row', () => this.begin(id));
        el('span', 'n', def.label.toUpperCase(), btn);
        const v = el('span', 'v', '', btn);
        return { id, btn, v };
      });
    }
    for (const r of this.rows) {
      const wait = this.waiting === r.id;
      r.btn.classList.toggle('wait', wait);
      r.v.textContent = wait ? (pad ? 'press a button…' : 'press a key or click…') : B ? (pad ? B.padText(r.id, layout, true) : B.keyText(r.id, true)) : '—';
    }
    this.btnReset.classList.toggle('dim', !!B?.isDefault?.(this.tab));
    this.hint.textContent =
      this._msg ||
      (this.waiting
        ? pad
          ? `press the new button  ·  ${padLabel(9, layout)}: cancel`
          : 'press the new key or mouse button  ·  Esc: cancel'
        : pad
          ? `${padLabel(0, layout)}: pick  ·  ${padLabel(4, layout)} / ${padLabel(5, layout)}: tab  ·  ${padLabel(1, layout)}: back`
          : 'click an action, then press its new key  ·  Esc: back');
    this.hint.classList.toggle('warn', !!this._msg);
  }

  _guard(fn) {
    try {
      fn();
    } catch (err) {
      if ((this._errors = (this._errors ?? 0) + 1) <= 3) console.error('[remap] handler failed', err);
    }
  }
}

/** Stop an event before anything else sees it: the game's input, the Lab's key handler, a button. */
function swallow(e) {
  e.preventDefault?.();
  e.stopImmediatePropagation?.();
  e.stopPropagation?.();
}
