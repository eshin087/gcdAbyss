import { DelayedBar } from './bars.js';
import { button, el, fillKeyText, flashClass, num } from './dom.js';
import { SLOT_COUNT, SLOT_LABELS, TECHNIQUE_IDS, getTechnique } from '../entities/player/techniques/index.js';

// The techniques on the HUD (ADR-054): the Qi meter and the slot chips in the player frame (QiRow),
// the "TECHNIQUE LEARNED" card after a victory that taught one (RewardCard), and the equip panel
// opened from the pause menu (TechniquePanel). Data: entities/player/techniques/; the hero's book is
// game.player.techniques, his meter player.qi / player.qiMax. Own stylesheet (#ab-tech-style).

const REWARD_DELAY = 2.6; // s (real) after the victory: the banner first, then the record and this card
const REWARD_HOLD = 14; // s it stays (it also goes when the victory screen is left)

/** "[Q]" on a keyboard, the button's name on touch (the HUD root carries .ab-touch there). */
function slotKey(i) {
  return `[${SLOT_LABELS[i] ?? i + 1}]`;
}

/** Where a technique is taught, for the locked entries: "defeat Shen Hui, the Ash Disciple". */
function taughtBy(T) {
  return T?.from ? `defeat ${T.from}` : 'a boss teaches it';
}

// ------------------------------------------------------------------ the Qi row (player frame)
export class QiRow {
  constructor(game, parent) {
    this.game = game;
    this.root = el('div', 'ab-row ab-qi', null, parent);
    el('span', 'lbl', 'QI', this.root);
    this.bar = new DelayedBar(this.root, 'qi', { hold: 0.15, drain: 8, rise: 10, chunk: false });
    this.slotsEl = el('span', 'ab-tslots', null, this.root);
    this.chips = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const c = el('span', 'ab-tslot empty', null, this.slotsEl);
      el('span', 'ab-key kb-only', SLOT_LABELS[i], c);
      const ic = el('span', 'ic', '·', c);
      this.chips.push({ el: c, ic, id: undefined, ready: null });
    }
    this._on = null;
    this._full = null;
    const ev = game.events;
    ev?.on?.('player:techniqueDenied', () => flashClass(this.bar.root));
    ev?.on?.('player:qiFull', () => flashClass(this.root, 'filled'));
    ev?.on?.('player:technique', (d) => {
      const c = this.chips[d?.slot];
      if (c && d?.phase === 'stance') flashClass(c.el, 'fire');
    });
  }

  update(dt) {
    const p = this.game.player, book = p?.techniques;
    const on = !!book?.equippedAny;
    if (on !== this._on) {
      this._on = on;
      this.root.classList.toggle('on', on);
    }
    if (!on) return;
    const max = Math.max(1, num(p.qiMax, 100));
    const k = Math.min(1, Math.max(0, num(p.qi, 0) / max));
    this.bar.set(k);
    this.bar.update(dt);
    const full = k >= 1;
    if (full !== this._full) {
      this._full = full;
      this.root.classList.toggle('full', full);
    }
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      const id = book.slots[i] ?? null;
      if (id !== c.id) {
        c.id = id;
        const T = getTechnique(id);
        c.ic.textContent = T ? T.icon : '·';
        c.el.classList.toggle('empty', !T);
        c.el.title = T ? `${T.name} — ${SLOT_LABELS[i]}` : 'empty slot';
      }
      const ready = !!p.techReady?.(i);
      if (ready !== c.ready) {
        c.ready = ready;
        c.el.classList.toggle('ready', ready);
      }
    }
  }
}

// ------------------------------------------------------------------ the reward card (victory)
export class RewardCard {
  constructor(game, parent) {
    this.game = game;
    this.root = el('div', 'ab-reward ab-panel', null, parent);
    el('div', 'h', 'TECHNIQUE LEARNED', this.root);
    const row = el('div', 'nm', null, this.root);
    this.icon = el('span', 'ic', '', row);
    this.name = el('span', 'n', '', row);
    this.from = el('div', 'f', '', this.root);
    this.desc = el('div', 'd', '', this.root);
    this.how = el('div', 'k', '', this.root);
    this.where = el('div', 'w', 'change it from the pause menu: TECHNIQUES', this.root);
    this.wait = -1; // s until it shows
    this.left = 0; // s it stays
    this.on = false;
    const ev = game.events;
    ev?.on?.('technique:learned', (d) => this._learned(d ?? {}));
    ev?.on?.('state', (e) => {
      if (e?.to !== 'victory' && e?.to !== 'paused') this.hide();
    });
    ev?.on?.('game:retry', () => this.hide());
  }

  _learned(d) {
    const T = getTechnique(d.id);
    if (!T) return;
    if (!d.first) {
      this.game.hud?.log?.(`You already know the ${T.name}.`, 'lore');
      return;
    }
    this.icon.textContent = T.icon;
    this.name.textContent = T.name.toUpperCase();
    this.from.textContent = `taught by ${T.from}`;
    this.desc.textContent = T.desc;
    const slot = Number.isInteger(d.slot) ? d.slot : -1;
    const touch = !!this.game.touch?.active;
    if (slot >= 0) fillKeyText(this.how, touch ? `Equipped in slot ${slot + 1}: the ${T.icon} ${T.short} button · costs a full Qi meter` : `Equipped in slot ${slot + 1}: press ${slotKey(slot)} · costs a full Qi meter`);
    else this.how.textContent = 'Both slots are full: equip it from the pause menu.';
    this.wait = REWARD_DELAY;
    this.left = REWARD_HOLD;
    this.game.hud?.log?.(`Technique learned: ${T.name}. ${T.hint}`, 'lore');
  }

  hide() {
    this.wait = -1;
    if (!this.on) return;
    this.on = false;
    this.root.classList.remove('on');
  }

  update(dt) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.on = true;
        this.root.classList.add('on');
      }
      return;
    }
    if (this.on) {
      this.left -= dt;
      if (this.left <= 0) this.hide();
    }
  }
}

// ------------------------------------------------------------------ the equip panel (pause menu)
export class TechniquePanel {
  /** `parent`: the pause overlay; `onBack`: back to the pause menu. */
  constructor(game, parent, onBack) {
    this.game = game;
    this.root = el('div', 'ab-pause-panel ab-panel ab-techs', null, parent);
    el('div', 'ab-pause-title', 'TECHNIQUES', this.root);
    el('div', 'ab-tech-note', 'Fill the Qi meter with parries, perfect dodges and strikes that land; a technique spends it.', this.root);
    this.slotBtns = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const b = button(this.root, 'ab-tslot-btn', () => this._cycle(i));
      const k = el('span', 'sk', null, b);
      fillKeyText(el('span', 'kb-only', null, k), `SLOT ${i + 1} ${slotKey(i)}`);
      el('span', 'tp-only', `SLOT ${i + 1}`, k);
      const v = el('span', 'v', '', b);
      this.slotBtns.push({ b, v });
    }
    el('div', 'ab-tech-note tap', 'tap a slot to change what it holds', this.root);
    el('div', 'ab-sep', null, this.root);
    this.list = el('div', 'ab-tech-list', null, this.root);
    el('div', 'ab-sep', null, this.root);
    const back = button(this.root, 'primary', () => onBack?.());
    back.textContent = 'BACK';
    this.on = false;
    this._sig = '';
    game.events?.on?.('technique:equip', () => this.refresh(true));
    game.events?.on?.('technique:learned', () => this.refresh(true));
  }

  show(on) {
    this.on = !!on;
    this.root.classList.toggle('on', this.on);
    if (this.on) this.refresh(true);
  }

  /** Slot i → the next learned technique not already in it, then empty, then round again. */
  _cycle(i) {
    const book = this.game.player?.techniques;
    if (!book) return;
    const opts = [...book.list(), null];
    const cur = book.slots[i] ?? null;
    const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    book.equip(i, next);
    this.refresh(true);
  }

  refresh(force = false) {
    if (!this.on && !force) return;
    const book = this.game.player?.techniques;
    if (!book) return;
    const sig = `${book.list().join(',')}|${book.slots.join(',')}`;
    if (!force && sig === this._sig) return;
    this._sig = sig;
    for (let i = 0; i < this.slotBtns.length; i++) {
      const T = getTechnique(book.slots[i]);
      const s = this.slotBtns[i];
      s.v.textContent = T ? `${T.icon} ${T.name.toUpperCase()}` : '— empty —';
      s.b.classList.toggle('filled', !!T);
    }
    this.list.textContent = '';
    for (const id of TECHNIQUE_IDS) {
      const T = getTechnique(id);
      const known = book.has(id);
      const row = el('div', `ab-tech-row${known ? '' : ' locked'}`, null, this.list);
      const head = el('div', 'th', null, row);
      el('span', 'ic', known ? T.icon : '?', head);
      el('span', 'n', known ? T.name.toUpperCase() : '???', head);
      const at = book.slotOf(id);
      el('span', 'sl', known ? (at >= 0 ? `slot ${at + 1}` : 'not equipped') : 'locked', head);
      el('div', 'td', known ? `${T.desc} Costs ${T.cost} Qi.` : `${taughtBy(T)} to learn it.`, row);
    }
    if (!book.list().length) el('div', 'ab-tech-note', 'No techniques yet: every boss you defeat teaches one.', this.list);
  }
}

const CSS = `
/* the Qi row in the player frame (shown once a technique is equipped) */
.ab-qi { display: none; margin-top: 3px; }
.ab-qi.on { display: flex; }
.ab-bar.qi { height: 5px; border-color: rgba(216, 184, 106, 0.3); }
.ab-bar.qi > .fill { background: linear-gradient(90deg, #6f6a62, #d8d2c6); }
.ab-qi.full .ab-bar.qi { border-color: rgba(255, 138, 61, 0.75); box-shadow: 0 0 7px rgba(255, 138, 61, 0.6); }
.ab-qi.full .ab-bar.qi > .fill { background: linear-gradient(90deg, #ffb070, #fff0d8); animation: ab-pulse 0.9s ease-in-out infinite; }
.ab-qi.filled .ab-bar.qi { animation: ab-flash 0.55s ease-out; }
.ab-qi .lbl { color: #b9b1a2; }
.ab-tslots { display: inline-flex; gap: 4px; width: 64px; justify-content: flex-end; }
.ab-tslot { display: inline-flex; align-items: center; gap: 1px; font-size: 11px; color: #6b7385; }
.ab-tslot .ab-key { min-width: 12px; padding: 0 2px; font-size: 9px; line-height: 11px; }
.ab-tslot.empty { opacity: 0.35; }
.ab-tslot .ic { width: 10px; text-align: center; }
.ab-tslot.ready .ic { color: #ffd2a4; text-shadow: 0 0 7px rgba(255, 138, 61, 0.95); }
.ab-tslot.ready .ab-key { border-color: rgba(255, 138, 61, 0.7); color: #ffe2cc; }
.ab-tslot.fire { animation: ab-tfire 0.5s ease-out; }
@keyframes ab-tfire { 0% { transform: scale(1.5); filter: brightness(2); } 100% { transform: none; } }

/* the reward card (victory) */
.ab-reward {
  position: absolute;
  right: 5%;
  top: calc(50% + 64px); /* below the minimap, right of the record */
  width: 300px;
  padding: 10px 14px 11px;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 1.1s ease;
  z-index: 6;
  border-color: rgba(255, 138, 61, 0.45);
  box-shadow: 0 0 18px rgba(255, 138, 61, 0.12);
}
.ab-reward.on { opacity: 1; }
.ab-reward .h { text-align: center; font-size: 10px; letter-spacing: 0.3em; color: var(--ab-gold); margin-bottom: 6px; }
.ab-reward .nm { display: flex; justify-content: center; align-items: baseline; gap: 8px; }
.ab-reward .nm .ic { font-size: 20px; color: #ffd2a4; text-shadow: 0 0 9px rgba(255, 138, 61, 0.9); }
.ab-reward .nm .n { font-family: var(--ab-serif); font-size: 18px; letter-spacing: 0.22em; color: #f3eadb; }
.ab-reward .f { text-align: center; font-size: 10px; color: var(--ab-dim); margin: 2px 0 7px; }
.ab-reward .d { font-size: 11px; line-height: 1.45; color: var(--ab-ink); }
.ab-reward .k { margin-top: 7px; font-size: 10.5px; color: #ffd2a4; }
.ab-reward .w { margin-top: 3px; font-size: 10px; color: var(--ab-faint); }

/* the equip panel (pause menu → TECHNIQUES) */
.ab-pause-panel.ab-techs { display: none; text-align: left; }
.ab-pause-panel.ab-techs.on { display: block; }
.ab-pause.techs .ab-pause-panel:not(.ab-techs) { display: none; }
.ab-techs .ab-pause-title { text-align: center; }
.ab-tech-note { font-size: 10px; color: var(--ab-dim); line-height: 1.45; margin: 2px 0 8px; }
.ab-tech-note.tap { margin: 0; text-align: right; }
.ab-tslot-btn .sk { color: var(--ab-dim); }
.ab-tslot-btn .v { color: var(--ab-faint); letter-spacing: 0.12em; }
.ab-tslot-btn.filled .v { color: #ffd2a4; }
.ab-tech-row { margin: 6px 0 9px; }
.ab-tech-row .th { display: flex; align-items: baseline; gap: 7px; }
.ab-tech-row .ic { width: 14px; text-align: center; font-size: 14px; color: #ffd2a4; }
.ab-tech-row .n { flex: 1; font-size: 11px; letter-spacing: 0.18em; color: #eef1f8; }
.ab-tech-row .sl { font-size: 10px; color: var(--ab-gold); }
.ab-tech-row .td { margin: 2px 0 0 21px; font-size: 10px; line-height: 1.45; color: var(--ab-dim); }
.ab-tech-row.locked .ic, .ab-tech-row.locked .n { color: var(--ab-faint); }
.ab-tech-row.locked .sl { color: var(--ab-faint); }

/* narrow windows: keep clear of the record in the centre */
@media (max-width: 1000px) {
  .ab-reward { right: 1.5%; width: 232px; padding: 8px 11px 9px; }
  .ab-reward .nm .n { font-size: 15px; }
  .ab-reward .d { font-size: 10px; }
}
@media (max-height: 560px) {
  .ab-touch .ab-reward { right: 2.5%; top: calc(50% + 34px); width: 236px; padding: 6px 10px 7px; }
  .ab-touch .ab-reward .h { margin-bottom: 3px; }
  .ab-touch .ab-reward .f { margin: 1px 0 4px; }
  .ab-touch .ab-reward .w { display: none; }
  .ab-touch .ab-reward .nm .n { font-size: 15px; }
  .ab-touch .ab-reward .d { font-size: 10px; }
  .ab-touch .ab-tech-row { margin: 4px 0 6px; }
}
`;

export function injectTechStyle() {
  if (typeof document === 'undefined' || document.getElementById?.('ab-tech-style')) return;
  const style = document.createElement('style');
  style.id = 'ab-tech-style';
  style.textContent = CSS;
  document.head?.appendChild(style);
}
