// Tiny DOM helpers shared by the HUD widgets (no framework, no innerHTML with dynamic text).

export function el(tag, className = '', text = null, parent = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Finite number or a fallback. */
export const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Clamp a frame delta coming from the outside world. */
export const safeDt = (dt) => {
  const v = num(dt, 0);
  return v < 0 ? 0 : v > 0.1 ? 0.1 : v;
};

/** Seconds → "mm:ss". */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(num(seconds)));
  const m = Math.floor(s / 60);
  return `${m < 10 ? '0' : ''}${m}:${s % 60 < 10 ? '0' : ''}${s % 60}`;
}

// ---------------------------------------------------------------- key chips
// "[...]" tokens become keycaps. "[@action]" is an ACTION chip (core/bindings.js): it shows the key
// bound to that action, or the pad button while a gamepad is the device in use, and every action chip
// is relabelled when a binding, the device or the pad layout changes (relabelChips). Pseudo actions:
// @move (WASD / LS), @aim (Mouse / RS), @zoom (Wheel / the D-pad zoom buttons).
// dev: null = follow the device in use; 'kb' | 'pad' = always that device (the control grids).
let chipSource = null; // { bindings, padActive(), layout() } — set by the HUD
const chips = new Set();

export function setChipSource(src) {
  chipSource = src ?? null;
  relabelChips();
}

/** The text an action chip shows now. all = every bound key ("Tab / MMB"), else the first. */
export function chipText(act, dev = null, all = false) {
  const S = chipSource, B = S?.bindings;
  const pad = (dev ?? (S?.padActive?.() ? 'pad' : 'kb')) === 'pad';
  const layout = S?.layout?.() ?? 'xbox';
  if (act === 'move') return pad ? 'LS' : (B?.moveText?.() ?? 'WASD');
  if (act === 'aim') return pad ? 'RS' : 'Mouse';
  if (act === 'zoom') return pad && B ? `${B.padText('zoomIn', layout)} ${B.padText('zoomOut', layout)}` : 'Wheel';
  if (!B) return act;
  if (pad) {
    const t = B.padText(act, layout, all);
    if (t !== '—' || dev === 'pad') return t;
  }
  return B.keyText(act, all);
}

/** Redraw every action chip on screen (bindings / device / layout changed). */
export function relabelChips() {
  for (const c of chips) {
    if (c.isConnected === false) {
      chips.delete(c);
      continue;
    }
    c.textContent = chipText(c.dataset.act, c.dataset.dev || null, c.dataset.all === '1');
  }
}

/** An action chip ("[@dodge]") in `parent`. */
export function actionChip(parent, act, dev = null, all = false) {
  const k = el('span', 'ab-key', null, parent);
  k.dataset.act = act;
  if (dev) k.dataset.dev = dev;
  if (all) k.dataset.all = '1';
  k.textContent = chipText(act, dev, all);
  if (chips.size > 400) for (const c of chips) if (c.isConnected === false) chips.delete(c);
  chips.add(k);
  return k;
}

/** Fill `target` with text where "[E]" style tokens become keycaps ("[@action]": action chips). */
export function fillKeyText(target, text, dev = null) {
  target.textContent = '';
  const str = String(text ?? '');
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) target.appendChild(document.createTextNode(str.slice(last, m.index)));
    if (m[1][0] === '@') actionChip(target, m[1].slice(1), dev);
    else el('span', 'ab-key', m[1], target);
    last = re.lastIndex;
  }
  if (last < str.length) target.appendChild(document.createTextNode(str.slice(last)));
}

/** Append text where numbers are emphasised (<b>), e.g. combat log damage values. */
export function fillNumberText(target, text) {
  const parts = String(text ?? '').split(/(\d+)/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (i % 2 === 1) el('b', '', parts[i], target);
    else target.appendChild(document.createTextNode(parts[i]));
  }
}

/** Restart a one-shot CSS animation class (forces one reflow; only used on rare events). */
export function flashClass(node, cls = 'flash') {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** A HUD button that never keeps focus (Space/Enter must stay game keys). */
export function button(parent, className, onClick) {
  const b = el('button', `ab-btn ${className}`.trim(), null, parent);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    b.blur();
    try {
      onClick();
    } catch (err) {
      console.error('[hud] button handler failed', err);
    }
  });
  return b;
}

// Shared controls reference (title, pause menu, help panel): one row per action ('@id': its bound
// keys, relabelled on a remap) or a fixed key; `only` = shown in that device's grid alone.
export const CONTROLS = [
  ['@move', 'move'],
  ['@aim', 'aim', 'kb'],
  ['@aim', 'aim (let go: auto-aim at the boss)', 'pad'],
  ['@attack', 'attack · hold to charge heavy'],
  ['@block', 'hold block · tap to parry'],
  ['@dodge', 'dodge · perfect dodge = Ghostep'],
  ['@sprint', 'sprint (a stick click: until you let go)', 'pad'],
  ['@sprint', 'sprint', 'kb'],
  ['@flask', 'drink flask'],
  ['@lockOn', 'lock-on'],
  ['@interact', 'rest at bonfire · fight again'],
  ['@pause', 'pause'],
  ['@help', 'help'],
  ['@mute', 'mute', 'kb'],
  ['F1', 'lab (debug)', 'kb'],
  ['F2', 'quality', 'kb'],
  ['F3', 'fps', 'kb'],
  ['@zoom', 'zoom'],
];

/** The controls grid for one device ('kb' | 'pad'): keys follow the bindings. */
export function controlsGrid(parent, dev = 'kb') {
  const grid = el('div', 'ab-ctrls', null, parent);
  for (const [k, a, only] of CONTROLS) {
    if (only && only !== dev) continue;
    const kc = el('span', 'k', null, grid);
    if (k[0] === '@') actionChip(kc, k.slice(1), dev, true);
    else el('span', 'ab-key', k, kc);
    el('span', 'a', a, grid);
  }
  return grid;
}

// The touch-controls reference (pause menu on touch devices; src/ui/touch.js).
export const TOUCH_CONTROLS = [
  ['STICK', 'move · push to the rim: sprint'],
  ['ATTACK', 'tap: combo · hold: charged cleave'],
  ['BLOCK', 'hold: block · tap: parry'],
  ['DODGE', 'roll · perfect dodge = Ghostep'],
  ['FLASK', 'drink flask'],
  ['LOCK', 'lock-on (attacks auto-aim anyway)'],
  ['||', 'pause'],
  ['TAP', 'the prompt: rest / fight again'],
  ['PINCH', 'zoom'],
];

export function touchGrid(parent) {
  const grid = el('div', 'ab-ctrls', null, parent);
  for (const [k, a] of TOUCH_CONTROLS) {
    el('span', 'ab-key', k, el('span', 'k', null, grid));
    el('span', 'a', a, grid);
  }
  return grid;
}

/**
 * One-line attack-tell legend for the title / pause / help screens (the tells themselves are only
 * shown in the world): "red flash = dodge only · white glint = parry timing · perfect dodge = Ghostep".
 */
export function tellLegend(parent) {
  const row = el('div', 'ab-legend', null, parent);
  const item = (cls, cue, text) => {
    const s = el('span', `it ${cls}`, null, row);
    el('b', '', cue, s);
    s.appendChild(document.createTextNode(` = ${text}`));
  };
  item('r', 'red flash', 'dodge only');
  item('n', 'white glint', 'parry timing');
  el('span', 'it hint', 'perfect dodge = Ghostep', row);
  return row;
}
