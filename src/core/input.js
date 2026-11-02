// Keyboard + mouse state with per-frame "pressed" edges.
// Keys use KeyboardEvent.code ("KeyW", "Space", "ShiftLeft", ...). Mouse buttons: 0 left, 1 middle, 2 right.
//
// Virtual sources (touch controls, src/ui/touch.js) feed the SAME state through setVirtual(code, down)
// and setVirtualAxis(x, y): a virtual press sets the same one-frame `pressed` edge as a real key /
// button, a virtual release the same `released` edge, so the player / flow code reads one API and tap
// vs hold timings (parry window, charge hold) behave identically. Virtual holds are tracked apart
// from the real device (a real keyup never drops a held touch button, and vice versa).
// Mouse events that the browser synthesises from a touch (compatibility mousedown / mouseup /
// mousemove, fired ~0-300 ms after the touch) are ignored, so one tap never counts twice.

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);
const MOUSE_CODE = { Mouse0: 0, Mouse1: 1, Mouse2: 2 };
const TOUCH_MOUSE_GUARD = 1000; // ms after a touch during which mouse events are treated as synthetic
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.buttons = [false, false, false];
    this.pressedButtons = [false, false, false];
    this.releasedButtons = [false, false, false];
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false };
    this.wheel = 0;
    this.anyPressed = false;
    this.enabled = true;
    // virtual (touch) sources
    this.vKeys = new Set();
    this.vButtons = [false, false, false];
    this.vAxis = { x: 0, y: 0 };
    this.lastTouch = -Infinity; // performance.now() of the last touch pointer event

    // capture phase: stamp touches before any mouse compatibility event can arrive
    const stamp = (e) => {
      if (e?.pointerType === 'touch') this.lastTouch = now();
    };
    addEventListener('pointerdown', stamp, true);
    addEventListener('pointerup', stamp, true);
    addEventListener('pointercancel', stamp, true);

    addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      this.anyPressed = true;
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = [false, false, false];
      this.releaseVirtual();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (e.button > 2 || this._fromTouch()) return;
      if (e.target !== canvas && !e.target.closest?.('[data-passthrough]')) return;
      this.buttons[e.button] = true;
      this.pressedButtons[e.button] = true;
      this.anyPressed = true;
      if (e.button === 1) e.preventDefault();
    });
    addEventListener('mouseup', (e) => {
      if (e.button > 2 || this._fromTouch()) return;
      this.buttons[e.button] = false;
      this.releasedButtons[e.button] = true;
    });
    addEventListener('mousemove', (e) => {
      if (this._fromTouch()) return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ndcY = -((this.mouse.y / r.height) * 2 - 1);
      this.mouse.inside = true;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  _fromTouch() {
    return now() - this.lastTouch < TOUCH_MOUSE_GUARD;
  }

  down(code) {
    return this.enabled && (this.keys.has(code) || this.vKeys.has(code));
  }
  pressed(code) {
    return this.enabled && this.pressedKeys.has(code);
  }
  released(code) {
    return this.enabled && this.releasedKeys.has(code);
  }
  mouseDown(b) {
    return this.enabled && (this.buttons[b] || this.vButtons[b]);
  }
  mousePressed(b) {
    return this.enabled && this.pressedButtons[b];
  }
  mouseReleased(b) {
    return this.enabled && this.releasedButtons[b];
  }
  /**
   * WASD / arrows as a vector in screen space: x right, y up (north). Keys give a unit vector; a
   * virtual stick (when deflected) wins and keeps its analog length (0..1).
   */
  moveAxis() {
    const v = this.vAxis;
    if (this.enabled && (v.x !== 0 || v.y !== 0)) return { x: v.x, y: v.y };
    let x = 0, y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------- virtual sources (touch)
  /**
   * Press (down = true) or release a virtual key / mouse button. `code` is a KeyboardEvent.code
   * ('Space', 'KeyF', 'Tab', 'Escape', 'ShiftLeft', ...) or 'Mouse0' | 'Mouse1' | 'Mouse2'.
   * Edges match the real device: a press sets `pressed` for one frame (only on the up → down change),
   * a release sets `released` for one frame.
   */
  setVirtual(code, down) {
    const b = MOUSE_CODE[code];
    if (b !== undefined) {
      if (down === this.vButtons[b]) return;
      this.vButtons[b] = !!down;
      if (down) {
        this.pressedButtons[b] = true;
        this.anyPressed = true;
      } else this.releasedButtons[b] = true;
      return;
    }
    if (typeof code !== 'string' || !code) return;
    if (!!down === this.vKeys.has(code)) return;
    if (down) {
      this.vKeys.add(code);
      this.pressedKeys.add(code);
      this.anyPressed = true;
    } else {
      this.vKeys.delete(code);
      this.releasedKeys.add(code);
    }
  }

  /** Virtual stick: x right, y up (north), length clamped to 1. Non-finite input reads as centred. */
  setVirtualAxis(x, y) {
    x = Number.isFinite(x) ? x : 0;
    y = Number.isFinite(y) ? y : 0;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.vAxis.x = x;
    this.vAxis.y = y;
  }

  /** Release every virtual key / button (with their `released` edges) and centre the stick. */
  releaseVirtual() {
    for (const code of [...this.vKeys]) this.setVirtual(code, false);
    for (let b = 0; b < 3; b++) if (this.vButtons[b]) this.setVirtual(`Mouse${b}`, false);
    this.vAxis.x = this.vAxis.y = 0;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressedButtons = [false, false, false];
    this.releasedButtons = [false, false, false];
    this.wheel = 0;
    this.anyPressed = false;
  }
}
