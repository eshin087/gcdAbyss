// Tiny DOM helpers for the Lab panel (no framework, no innerHTML with dynamic text).
// Kept local to src/dev so the Lab never depends on the HUD's internals.

export function el(tag, className = '', text = null, parent = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Set text only when it changed (the readout refreshes ~12x per second). */
export function setText(node, text) {
  if (!node) return;
  const s = String(text);
  if (node._labText === s) return;
  node._labText = s;
  node.textContent = s;
}

/** Toggle a class only when it changed. */
export function setClass(node, cls, on) {
  if (!node?.classList) return;
  const v = !!on;
  if (node.classList.contains(cls) !== v) node.classList.toggle(cls, v);
}

/** A button that never keeps keyboard focus (Space / digits must stay game + Lab keys). */
export function button(parent, label, onClick, className = '') {
  const b = el('button', `lab-btn ${className}`.trim(), label, parent);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault?.());
  b.addEventListener('click', (e) => {
    e?.preventDefault?.();
    b.blur?.();
    try {
      onClick(e);
    } catch (err) {
      console.error('[lab] button handler failed', err);
    }
  });
  return b;
}

/**
 * Range slider. `onInput(value)` fires while dragging; `drag` reports whether the user is holding it
 * (so the periodic refresh does not fight the mouse). Blurs on release so keys go back to the game.
 */
export function slider(parent, { min, max, step, value }, onInput) {
  const s = el('input', 'lab-range', null, parent);
  s.type = 'range';
  s.min = String(min);
  s.max = String(max);
  s.step = String(step);
  s.value = String(value);
  s.tabIndex = -1;
  const state = { el: s, drag: false };
  s.addEventListener('pointerdown', () => (state.drag = true));
  s.addEventListener('input', () => {
    const v = Number(s.value);
    if (!Number.isFinite(v)) return;
    try {
      onInput(v);
    } catch (err) {
      console.error('[lab] slider handler failed', err);
    }
  });
  const release = () => {
    state.drag = false;
    s.blur?.();
  };
  s.addEventListener('change', release);
  s.addEventListener('pointerup', release);
  s.addEventListener('pointercancel', release);
  return state;
}

/** Collapsible section: returns { sec, body }. `onToggle(key, collapsed)` persists the choice. */
export function section(parent, key, title, collapsed, onToggle) {
  const sec = el('div', 'lab-sec', null, parent);
  const head = el('div', 'lab-sec-h', null, sec);
  el('span', '', title, head);
  const caret = el('span', 'lab-caret', null, head);
  const body = el('div', 'lab-sec-b', null, sec);
  const set = (c) => {
    setClass(sec, 'closed', c);
    caret.textContent = c ? '+' : '-';
  };
  set(!!collapsed);
  head.addEventListener('click', () => {
    const c = !sec.classList.contains('closed');
    set(c);
    try {
      onToggle?.(key, c);
    } catch (err) {
      console.error('[lab] section toggle failed', err);
    }
  });
  return { sec, body, head };
}
