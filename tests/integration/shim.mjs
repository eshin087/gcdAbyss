// Browser shims for headless integration runs: minimal DOM, window listeners, strict-ish WebAudio mock.

// ---------------------------------------------------------------- DOM
class TextNode {
  constructor(t) { this.textContent = t; this.parentNode = null; }
  remove() { if (this.parentNode) { const c = this.parentNode.children; c.splice(c.indexOf(this), 1); this.parentNode = null; } }
}
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}
const ctxStub = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 8 }) : () => {}),
  set: (t, k, v) => ((t[k] = v), true),
});
let docEl;
export class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.style = {}; this.dataset = {}; this.classList = new ClassList(); this.listeners = {}; this.id = ''; this.width = 0; this.height = 0; }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(' '); }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? new TextNode(c) : c); }
  insertBefore(c) { return this.appendChild(c); }
  remove() { TextNode.prototype.remove.call(this); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === docEl; }
  get childElementCount() { return this.children.filter((c) => c instanceof El).length; }
  get firstElementChild() { return this.children.find((c) => c instanceof El); }
  get childNodes() { return this.children; }
  set textContent(v) { this.children.forEach((c) => (c.parentNode = null)); this.children = []; if (v !== '' && v != null) this.appendChild(new TextNode(String(v))); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.textContent = ''; }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  removeEventListener() {}
  dispatch(n, e = {}) { (this.listeners[n] || []).forEach((f) => f({ preventDefault() {}, stopPropagation() {}, target: this, ...e })); }
  get offsetWidth() { return 0; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
  closest() { return null; }
  blur() {}
  focus() {}
  getContext() { return ctxStub; }
  find(pred) { if (pred(this)) return this; for (const c of this.children) if (c instanceof El) { const r = c.find(pred); if (r) return r; } return null; }
  findAll(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) if (c instanceof El) c.findAll(pred, out); return out; }
}
docEl = new El('html');
const head = docEl.appendChild(new El('head'));
const body = docEl.appendChild(new El('body'));
export const ui = body.appendChild(new El('div'));
ui.id = 'ui';
export const winListeners = {};
globalThis.window = globalThis;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
globalThis.devicePixelRatio = 1;
globalThis.document = {
  documentElement: docEl, head, body, hidden: false,
  fonts: null,
  createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t),
  getElementById: (id) => (id === 'ui' ? ui : docEl.find((e) => e.id === id)),
  querySelector: () => null,
  addEventListener: (n, f) => (winListeners['doc:' + n] ||= []).push(f),
};
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
/** Dispatch a window event. Returns true when a capture listener stopped it (the game never sees it). */
export const fireWin = (n, e = {}) => {
  let stopped = false;
  const ev = { preventDefault() {}, stopPropagation() { stopped = true; }, ...e };
  // capture listeners (Lab key handler) run first and may stop the event, like the browser
  for (const f of (winListeners['capture:' + n] || []).slice()) f(ev);
  if (stopped) return true;
  for (const f of (winListeners[n] || []).slice()) f(ev);
  return false;
};
globalThis.addEventListener = (n, f, opts) => {
  const capture = opts === true || !!opts?.capture;
  (winListeners[(capture ? 'capture:' : '') + n] ||= []).push(f);
};
globalThis.removeEventListener = (n, f, opts) => {
  const capture = opts === true || !!opts?.capture;
  const l = winListeners[(capture ? 'capture:' : '') + n];
  if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); }
};
/** Drop every window / document listener (each scenario builds a fresh game). */
export const resetWindow = () => { for (const k of Object.keys(winListeners)) delete winListeners[k]; };

// ---------------------------------------------------------------- WebAudio
export const AUDIO = { ctx: null };
class Param {
  constructor(v) { this.value = v; }
  _chk(v, t, name) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name}: non-finite value ${v}`);
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new TypeError(`${name}: bad time ${t}`);
  }
  setValueAtTime(v, t) { this._chk(v, t, 'setValueAtTime'); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this._chk(v, t, 'linearRamp'); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this._chk(v, t, 'expRamp'); if (v === 0) throw new RangeError('expRamp to 0'); this.value = v; return this; }
  setTargetAtTime(v, t, tau) { this._chk(v, t, 'setTarget'); if (!Number.isFinite(tau) || tau < 0) throw new RangeError(`tau ${tau}`); return this; }
  cancelScheduledValues(t) { this._chk(0, t, 'cancel'); return this; }
  cancelAndHoldAtTime(t) { this._chk(0, t, 'cancelHold'); return this; }
}
class Node {
  constructor(kind) { this.kind = kind; this.outs = new Set(); }
  connect(d) { if (d instanceof Param) { this.outs.add(d); return undefined; } if (!(d instanceof Node)) throw new TypeError(`${this.kind}.connect bad dest`); this.outs.add(d); return d; }
  disconnect() { this.outs.clear(); }
}
class Src extends Node {
  constructor(kind) { super(kind); this.started = false; this.onended = null; }
  start(t = 0, off = 0) { if (this.started) throw new Error('start twice'); if (!Number.isFinite(t) || t < 0 || !Number.isFinite(off) || off < 0) throw new RangeError(`start ${t}`); this.started = true; }
  stop(t = 0) { if (!this.started) throw new Error('stop before start'); if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop ${t}`); }
}
class MockCtx {
  constructor() { AUDIO.ctx = this; this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = new Node('dest'); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { const n = new Node('gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() { const n = new Node('biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); n.detune = new Param(0); return n; }
  createOscillator() { const n = new Src('osc'); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); n.setPeriodicWave = () => {}; return n; }
  createBufferSource() { const n = new Src('buf'); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); n.detune = new Param(0); return n; }
  createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  createConvolver() { const n = new Node('conv'); n.buffer = null; return n; }
  createDynamicsCompressor() { const n = new Node('comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createWaveShaper() { const n = new Node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createStereoPanner() { const n = new Node('pan'); n.pan = new Param(0); return n; }
  createDelay() { const n = new Node('delay'); n.delayTime = new Param(0); return n; }
  createPeriodicWave() { return {}; }
}
globalThis.AudioContext = MockCtx;
