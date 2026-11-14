// Remappable controls (contract: docs/ARCHITECTURE.md → Bindings; ADR-067).
// The game reads ACTIONS, not keys: input.act(a) / actPressed(a) / actReleased(a) (core/input.js)
// are true when any code bound to `a` is down / pressed / released. Keyboard / mouse bindings are
// KeyboardEvent.code strings or 'Mouse0' | 'Mouse1' | 'Mouse2'; every action also answers to its
// own virtual code '@<action>' (what the touch and gamepad layers press, so a keyboard remap never
// moves a touch button or a pad button). Gamepad bindings are Gamepad API "standard" button indices.
// A rebind takes the code / button away from any other action; an action left with nothing gets the
// rebound action's old ones (a swap), so every action always has a binding. Reserved keys (pause,
// Lab, quality, fps) are never bound. Saved per browser in localStorage.

/** id, label (the remap list), kb defaults, pad defaults (null = not on that device). */
export const ACTIONS = [
  { id: 'up', label: 'move up', kb: ['KeyW', 'ArrowUp'], pad: null },
  { id: 'down', label: 'move down', kb: ['KeyS', 'ArrowDown'], pad: null },
  { id: 'left', label: 'move left', kb: ['KeyA', 'ArrowLeft'], pad: null },
  { id: 'right', label: 'move right', kb: ['KeyD', 'ArrowRight'], pad: null },
  { id: 'attack', label: 'attack · hold: charge', kb: ['Mouse0'], pad: [5, 7] },
  { id: 'block', label: 'block · tap: parry', kb: ['Mouse2'], pad: [4, 6] },
  { id: 'dodge', label: 'dodge', kb: ['Space'], pad: [0] },
  { id: 'sprint', label: 'sprint', kb: ['ShiftLeft', 'ShiftRight'], pad: [1, 10] },
  { id: 'flask', label: 'drink flask', kb: ['KeyF'], pad: [2] },
  { id: 'lockOn', label: 'lock-on', kb: ['Tab', 'Mouse1'], pad: [11] },
  { id: 'interact', label: 'rest · fight again', kb: ['KeyE', 'KeyR'], pad: [3] },
  { id: 'help', label: 'help', kb: ['KeyH'], pad: [8] },
  { id: 'mute', label: 'mute', kb: ['KeyM'], pad: null },
  { id: 'zoomIn', label: 'zoom in', kb: null, pad: [12] },
  { id: 'zoomOut', label: 'zoom out', kb: null, pad: [13] },
  // fixed (not in the remap list): Esc / Menu always pause, so a remap can never lock you out
  { id: 'pause', label: 'pause', kb: ['Escape'], pad: [9], fixed: true },
];
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

/** Keys no remap may take: pause, the Lab, quality, fps. */
export const RESERVED_KEYS = new Set(['Escape', 'F1', 'F2', 'F3', 'Backquote']);
/** Pad buttons no remap may take: Menu (pause). The sticks' axes are never bindable. */
export const RESERVED_PAD = new Set([9]);
export const PAD_BUTTONS = 16;
/** Stick clicks: bound to sprint they latch it until the stick is let go (holding one while moving is awkward). */
export const STICK_CLICKS = new Set([10, 11]);

const STORE_KEY = 'abyss.bindings.v1';

// ---------------------------------------------------------------- labels
const KEY_NAMES = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'Alt', AltRight: 'R-Alt', MetaLeft: 'Meta', MetaRight: 'R-Meta', Tab: 'Tab', Enter: 'Enter',
  Backspace: 'Bksp', CapsLock: 'Caps', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←',
  ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Delete: 'Del',
  Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
};
// fillKeyText's chips are "[...]"-delimited: a key named "[" or "]" would close the token early
const SAFE = { '[': '⟦', ']': '⟧' };

/** Short on-screen name of a keyboard / mouse code ('KeyE' → 'E', 'Mouse2' → 'RMB'). */
export function keyLabel(code) {
  if (typeof code !== 'string' || !code) return '—';
  let s = KEY_NAMES[code];
  if (!s) {
    const m = /^(?:Key|Digit)(.+)$/.exec(code) ?? /^Numpad(.+)$/.exec(code);
    s = m ? (code.startsWith('Numpad') ? `Num${m[1]}` : m[1]) : code;
  }
  return SAFE[s] ?? s;
}

/** On-screen names of the standard pad buttons, per layout. */
export const PAD_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'],
};

export function padLabel(i, layout = 'xbox') {
  return (PAD_NAMES[layout] ?? PAD_NAMES.xbox)[i] ?? `B${i}`;
}

// ---------------------------------------------------------------- bindings
const isKb = (c) => typeof c === 'string' && /^(Mouse[012]|[A-Za-z][A-Za-z0-9]*)$/.test(c) && !RESERVED_KEYS.has(c);
const isPad = (i) => Number.isInteger(i) && i >= 0 && i < PAD_BUTTONS && !RESERVED_PAD.has(i);

export class Bindings {
  /** storage: a localStorage-like object, or null (tests: defaults, nothing saved). */
  constructor(storage = globalThis.localStorage ?? null) {
    this.storage = storage;
    this.kb = {};
    this.pad = {};
    this.version = 0; // bumped on every change (the UI relabels when it moves)
    this._listeners = new Set();
    this.reset(false);
    this._load();
  }

  /** Codes bound to an action on the keyboard / mouse (an array, maybe empty). */
  codes(action) {
    return this.kb[action] ?? [];
  }

  /** Pad buttons bound to an action (an array, maybe empty). */
  buttons(action) {
    return this.pad[action] ?? [];
  }

  /** The action a pad button is bound to, or null. */
  padAction(i) {
    for (const a in this.pad) if (this.pad[a].includes(i)) return a;
    return null;
  }

  /** The keyboard label of an action: its first code ('E'), or all of them joined ('Tab / MMB'). */
  keyText(action, all = false) {
    const c = this.codes(action);
    if (!c.length) return '—';
    return all ? c.map(keyLabel).join(' / ') : keyLabel(c[0]);
  }

  padText(action, layout = 'xbox', all = false) {
    const b = this.buttons(action);
    if (!b.length) return '—';
    return all ? b.map((i) => padLabel(i, layout)).join(' / ') : padLabel(b[0], layout);
  }

  /** The four move keys as one chip: 'WASD' when each is a single character, else 'W/A/S/D'. */
  moveText() {
    const k = ['up', 'left', 'down', 'right'].map((a) => this.keyText(a));
    return k.every((s) => [...s].length === 1) ? k.join('') : k.join('/');
  }

  /** Bind a keyboard / mouse code to an action (replacing its codes). Returns false when refused. */
  bindKey(action, code) {
    const def = BY_ID[action];
    if (!def || def.fixed || !def.kb || !isKb(code)) return false;
    return this._bind(this.kb, action, code);
  }

  /** Bind a pad button to an action (replacing its buttons). Returns false when refused. */
  bindPad(action, i) {
    const def = BY_ID[action];
    if (!def || def.fixed || !def.pad || !isPad(i)) return false;
    return this._bind(this.pad, action, i);
  }

  _bind(map, action, v) {
    const old = map[action] ?? [];
    if (old.length === 1 && old[0] === v) return true;
    for (const a in map) {
      if (a === action || !map[a].includes(v)) continue;
      map[a] = map[a].filter((x) => x !== v);
      if (!map[a].length) map[a] = old.filter((x) => x !== v); // swap: the other action takes the old ones
    }
    map[action] = [v];
    this._changed();
    return true;
  }

  /** Back to the defaults (both devices, or one: 'kb' | 'pad'). */
  reset(save = true, which = null) {
    for (const a of ACTIONS) {
      if (a.kb && which !== 'pad') this.kb[a.id] = [...a.kb];
      if (a.pad && which !== 'kb') this.pad[a.id] = [...a.pad];
    }
    if (save) this._changed();
  }

  /** Is everything at its default? (per device, or both) */
  isDefault(which = null) {
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    return ACTIONS.every((a) => (!a.kb || which === 'pad' || same(this.codes(a.id), a.kb)) && (!a.pad || which === 'kb' || same(this.buttons(a.id), a.pad)));
  }

  /** fn() after every change. Returns an unsubscribe function. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _changed() {
    this.version++;
    this._save();
    for (const fn of this._listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error('[bindings] listener failed', err);
      }
    }
  }

  _save() {
    try {
      this.storage?.setItem?.(STORE_KEY, JSON.stringify({ kb: this.kb, pad: this.pad }));
    } catch {
      // private mode / quota / blocked storage: the bindings still hold for this session
    }
  }

  _load() {
    let data;
    try {
      const raw = this.storage?.getItem?.(STORE_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    // only well-formed entries for known, remappable actions; then repair clashes (first wins)
    for (const a of ACTIONS) {
      if (a.fixed) continue;
      const kb = Array.isArray(data.kb?.[a.id]) ? data.kb[a.id].filter(isKb) : null;
      if (a.kb && kb?.length) this.kb[a.id] = [...new Set(kb)];
      const pad = Array.isArray(data.pad?.[a.id]) ? data.pad[a.id].filter(isPad) : null;
      if (a.pad && pad?.length) this.pad[a.id] = [...new Set(pad)];
    }
    // a key / button stored twice keeps its first action; a device left with an unbound action
    // (a hand-edited or stale store) goes back to its defaults
    for (const which of ['kb', 'pad']) {
      const map = this[which], seen = new Set();
      for (const a of ACTIONS) {
        if (!map[a.id]) continue;
        map[a.id] = map[a.id].filter((v) => !seen.has(v));
        map[a.id].forEach((v) => seen.add(v));
      }
      if (ACTIONS.some((a) => map[a.id] && !map[a.id].length)) this.reset(false, which);
    }
  }
}

// ---------------------------------------------------------------- the action API (core/input.js; test mocks)
const MOUSE = { Mouse0: 0, Mouse1: 1, Mouse2: 2 };

function any(inp, action, key, mouse) {
  if (inp.enabled === false) return false;
  if (inp[key](`@${action}`)) return true;
  for (const c of inp.bindings?.codes(action) ?? BY_ID[action]?.kb ?? []) {
    const b = MOUSE[c];
    if (b !== undefined ? inp[mouse](b) : inp[key](c)) return true;
  }
  return false;
}

/** Install act / actPressed / actReleased on an input-like object (down/pressed/released/mouse*). */
export function installActions(inp, bindings) {
  inp.bindings = bindings;
  inp.act = (a) => any(inp, a, 'down', 'mouseDown');
  inp.actPressed = (a) => any(inp, a, 'pressed', 'mousePressed');
  inp.actReleased = (a) => any(inp, a, 'released', 'mouseReleased') && !inp.act(a);
  return inp;
}

export const actionDef = (id) => BY_ID[id] ?? null;
