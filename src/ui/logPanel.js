import { el, fillNumberText, fmtClock, num } from './dom.js';

// MMO-style chat/log panel (bottom-left) with [General][Combat][System] tabs.
// Lines fade with a CSS animation (no per-frame work); identical consecutive lines stack as "×N".

const CHANNELS = new Set(['system', 'combat', 'warn', 'lore']);
const TABS = [
  ['general', 'General', null],
  ['combat', 'Combat', new Set(['combat', 'warn'])],
  ['system', 'System', new Set(['system'])],
];
const MAX_VISIBLE = 7;
const MAX_KEEP = 60;
const STACK_WINDOW = 6; // seconds in which a repeated line stacks instead of adding a new one

export class LogPanel {
  constructor(game, parent) {
    this.game = game;
    this.root = el('div', 'ab-log ab-panel ab-play', null, parent);
    const tabs = el('div', 'ab-tabs', null, this.root);
    this.tabs = new Map();
    for (const [id, label, filter] of TABS) {
      const t = el('span', 'ab-tab', label, tabs);
      t.addEventListener('mousedown', (e) => e.preventDefault());
      t.addEventListener('click', () => this.setFilter(id));
      this.tabs.set(id, { node: t, filter });
    }
    this.lines = el('div', 'ab-lines', null, this.root);
    this.entries = [];
    this.filter = 'general';
    this.tabs.get('general').node.classList.add('on');
  }

  _passes(channel) {
    const f = this.tabs.get(this.filter)?.filter;
    return !f || f.has(channel);
  }

  add(text, channel = 'system') {
    const ch = CHANNELS.has(channel) ? channel : 'system';
    const str = String(text ?? '').trim();
    if (!str) return;
    const now = num(this.game.realTime, 0);
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === str && last.channel === ch && now - last.time < STACK_WINDOW) {
      last.count++;
      last.time = now;
      if (last.node && last.node.isConnected) {
        last.cnt.textContent = `×${last.count}`;
        // restart the fade so the stacked line reads as fresh
        last.node.style.animation = 'none';
        void last.node.offsetWidth;
        last.node.style.animation = '';
      }
      return;
    }
    const entry = { text: str, channel: ch, time: now, count: 1, node: null, cnt: null };
    this.entries.push(entry);
    if (this.entries.length > MAX_KEEP) this.entries.shift();
    if (this._passes(ch)) this._append(entry);
  }

  _append(entry) {
    const node = el('div', `ab-ln ch-${entry.channel}`);
    el('span', 'ts', fmtClock(entry.time), node);
    fillNumberText(node, entry.text);
    entry.cnt = el('span', 'cnt', entry.count > 1 ? `×${entry.count}` : '', node);
    entry.node = node;
    this.lines.appendChild(node);
    while (this.lines.childElementCount > MAX_VISIBLE) this.lines.firstElementChild.remove();
  }

  setFilter(id) {
    if (!this.tabs.has(id) || id === this.filter) return;
    this.tabs.get(this.filter).node.classList.remove('on');
    this.filter = id;
    this.tabs.get(id).node.classList.add('on');
    this.lines.textContent = '';
    for (const e of this.entries) e.node = null;
    const shown = this.entries.filter((e) => this._passes(e.channel)).slice(-MAX_VISIBLE);
    for (const e of shown) this._append(e);
  }
}
