// Keyboard + mouse state with per-frame "pressed" edges.
// Keys use KeyboardEvent.code ("KeyW", "Space", "ShiftLeft", ...). Mouse buttons: 0 left, 1 middle, 2 right.

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);

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
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      if (e.target !== canvas && !e.target.closest?.('[data-passthrough]')) return;
      this.buttons[e.button] = true;
      this.pressedButtons[e.button] = true;
      this.anyPressed = true;
      if (e.button === 1) e.preventDefault();
    });
    addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.buttons[e.button] = false;
      this.releasedButtons[e.button] = true;
    });
    addEventListener('mousemove', (e) => {
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

  down(code) {
    return this.enabled && this.keys.has(code);
  }
  pressed(code) {
    return this.enabled && this.pressedKeys.has(code);
  }
  released(code) {
    return this.enabled && this.releasedKeys.has(code);
  }
  mouseDown(b) {
    return this.enabled && this.buttons[b];
  }
  mousePressed(b) {
    return this.enabled && this.pressedButtons[b];
  }
  mouseReleased(b) {
    return this.enabled && this.releasedButtons[b];
  }
  /** WASD / arrows as a vector in screen space: x right, y up (north). */
  moveAxis() {
    let x = 0, y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
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
