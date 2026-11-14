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

/** Fill `target` with text where "[E]" style tokens become keycaps. */
export function fillKeyText(target, text, pad = false) {
  target.textContent = '';
  const str = String(text ?? '');
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) target.appendChild(document.createTextNode(str.slice(last, m.index)));
    const k = el('span', 'ab-key', m[1], target);
    if (pad) k.dataset.pad = m[1]; // a gamepad button token: relabelled per layout (ui/gamepad.js)
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

// Shared controls reference (title, pause menu, help panel).
export const CONTROLS = [
  ['WASD', 'move'],
  ['Mouse', 'aim'],
  ['LMB', 'attack · hold to charge heavy'],
  ['RMB', 'hold block · tap to parry'],
  ['Space', 'dodge · perfect dodge = Ghostep'],
  ['Shift', 'sprint'],
  ['F', 'drink flask'],
  ['Tab / MMB', 'lock-on'],
  ['E', 'rest at bonfire'],
  ['Esc', 'pause'],
  ['H', 'help'],
  ['M', 'mute'],
  ['F1', 'lab (debug)'],
  ['F2', 'quality'],
  ['F3', 'fps'],
  ['Wheel', 'zoom'],
];

export function controlsGrid(parent) {
  const grid = el('div', 'ab-ctrls', null, parent);
  for (const [k, a] of CONTROLS) {
    const kc = el('span', 'k', null, grid);
    for (const part of k.split(' / ')) {
      if (kc.childNodes.length) kc.appendChild(document.createTextNode(' '));
      el('span', 'ab-key', part, kc);
    }
    el('span', 'a', a, grid);
  }
  return grid;
}

// The gamepad reference (src/ui/gamepad.js; shown while a pad is the device in use). Xbox tokens;
// the chips carry data-pad and are relabelled for a PlayStation pad (PAD_LABELS).
export const PAD_CONTROLS = [
  ['LS', 'move'],
  ['RS', 'aim (let go: auto-aim at the boss)'],
  ['RB / RT', 'attack · hold to charge heavy'],
  ['LB / LT', 'hold block · tap to parry'],
  ['A', 'dodge · perfect dodge = Ghostep'],
  ['B / L3', 'sprint (hold B · click L3)'],
  ['X', 'drink flask'],
  ['R3', 'lock-on'],
  ['Y', 'rest at bonfire · fight again'],
  ['MENU', 'pause'],
  ['VIEW', 'help'],
  ['D-PAD', 'zoom'],
];

export function padGrid(parent) {
  const grid = el('div', 'ab-ctrls', null, parent);
  for (const [k, a] of PAD_CONTROLS) {
    const kc = el('span', 'k', null, grid);
    for (const part of k.split(' / ')) {
      if (kc.childNodes.length) kc.appendChild(document.createTextNode(' '));
      el('span', 'ab-key', part, kc).dataset.pad = part;
    }
    el('span', 'a', a, grid);
  }
  return grid;
}

// The touch-controls reference (pause menu on touch devices; src/ui/touch.js).
export const TOUCH_CONTROLS = [
  ['STICK', 'move · push to the rim: sprint'],
  ['ATTACK', 'tap: combo · hold: charged thrust'],
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
