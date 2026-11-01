import { CONFIG } from '../core/config.js';
import { button, controlsGrid, el, fillKeyText, tellLegend } from './dom.js';

// Full-screen / panel UI: title, pause menu, help panel, victory record.

// "ABYSS" in a block/box-drawing figlet face. The <pre> uses a font stack that has the box glyphs
// itself (JetBrains Mono from Google Fonts is subset without them, which would misalign columns).
const LOGO = [
  ' █████╗ ' + '██████╗ ' + '██╗   ██╗' + '███████╗' + '███████╗',
  '██╔══██╗' + '██╔══██╗' + '╚██╗ ██╔╝' + '██╔════╝' + '██╔════╝',
  '███████║' + '██████╔╝' + ' ╚████╔╝ ' + '███████╗' + '███████╗',
  '██╔══██║' + '██╔══██╗' + '  ╚██╔╝  ' + '╚════██║' + '╚════██║',
  '██║  ██║' + '██████╔╝' + '   ██║   ' + '███████║' + '███████║',
  '╚═╝  ╚═╝' + '╚═════╝ ' + '   ╚═╝   ' + '╚══════╝' + '╚══════╝',
];
const LOGO_W = LOGO[0].length;
const SHIMMER_HZ = 12;

const TITLE_KEYS = [
  '[WASD] move',
  '[Mouse] aim',
  '[LMB] attack · hold: heavy',
  '[RMB] block · tap: parry',
  '[Space] dodge',
  '[Shift] sprint',
  '[F] flask',
  '[Tab] lock-on',
  '[E] rest',
  '[Esc] pause',
  '[H] help',
  '[M] mute',
  '[F1] lab',
];

export class TitleScreen {
  constructor(parent, visible) {
    this.root = el('div', 'ab-title', null, parent);
    const inner = el('div', 'ab-title-inner', null, this.root);
    inner.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    this.logo = el('pre', 'ab-logo', LOGO.join('\n'), inner);
    el('div', 'ab-title-rule', '◆', inner);
    el('div', 'ab-title-sub', 'an ASCII action RPG  ·  demo: the Cinder Wyrm', inner);
    el('div', 'ab-press', 'PRESS ANY KEY', inner);
    const ctrl = el('div', 'ab-title-ctrl', null, inner);
    for (const item of TITLE_KEYS) fillKeyText(el('span', 'item', null, ctrl), item);
    tellLegend(inner).classList.add('title');
    el('div', 'ab-credit', "art direction inspired by @Ansenjeo's ASCII MMORPG  ·  prototype v0.2", this.root);

    // shimmer: a sweeping column of '▓' plus a few random '▒' over the solid blocks
    this.chars = [...LOGO.join('\n')];
    this.blocks = [];
    let col = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (this.chars[i] === '\n') {
        col = 0;
        continue;
      }
      if (this.chars[i] === '█') this.blocks.push(i, col);
      col++;
    }
    this.work = this.chars.slice();
    this.visible = true;
    this.goneT = 0;
    this.t = 0;
    this.acc = 0;
    if (!visible) {
      this.visible = false;
      this.root.classList.add('off', 'gone');
    }
  }

  show() {
    this.visible = true;
    this.goneT = 0;
    this.root.classList.remove('gone');
    void this.root.offsetWidth;
    this.root.classList.remove('off');
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('off');
    this.goneT = 1.2;
  }

  update(dt) {
    if (this.goneT > 0) {
      this.goneT -= dt;
      if (this.goneT <= 0) this.root.classList.add('gone');
    }
    if (!this.visible) return;
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / SHIMMER_HZ) return;
    this.acc = 0;
    const sweep = ((this.t * 15) % (LOGO_W + 30)) - 15;
    const w = this.work;
    for (let k = 0; k < this.blocks.length; k += 2) {
      const i = this.blocks[k], col = this.blocks[k + 1];
      const d = Math.abs(col - sweep);
      w[i] = d < 1.2 ? '▓' : d < 2.4 ? '▒' : Math.random() < 0.012 ? '▓' : '█';
    }
    this.logo.textContent = w.join('');
  }
}

export class PauseMenu {
  constructor(game, parent) {
    this.game = game;
    this.root = el('div', 'ab-pause', null, parent);
    const panel = el('div', 'ab-pause-panel ab-panel', null, this.root);
    el('div', 'ab-pause-title', 'PAUSED', panel);
    const resume = button(panel, 'primary', () => game.flow?.resume?.());
    fillKeyText(resume, 'RESUME  [Esc]');
    this.btnQuality = button(panel, '', () => game.flow?.cycleQuality?.());
    fillKeyText(el('span', '', null, this.btnQuality), 'QUALITY [F2]');
    this.qualityVal = el('span', 'v', '', this.btnQuality);
    this.btnMute = button(panel, '', () => game.flow?.toggleMute?.());
    fillKeyText(el('span', '', null, this.btnMute), 'SOUND [M]');
    this.muteVal = el('span', 'v', '', this.btnMute);
    el('div', 'ab-sep', null, panel);
    controlsGrid(panel);
    tellLegend(panel);
    this.on = false;
    this._q = null;
    this._m = null;
  }

  show(on) {
    this.on = !!on;
    this.root.classList.toggle('on', this.on);
    this.refresh();
  }

  /** Cheap: only touches the DOM when quality / mute changed. */
  refresh() {
    if (!this.on) return;
    const q = this.game.settings?.quality;
    if (q !== this._q) {
      this._q = q;
      this.qualityVal.textContent = CONFIG.quality[q]?.name ?? '—';
    }
    const m = !!this.game.audio?.muted;
    if (m !== this._m) {
      this._m = m;
      this.muteVal.textContent = m ? 'MUTED' : 'ON';
    }
  }
}

export class HelpPanel {
  constructor(parent) {
    this.root = el('div', 'ab-help ab-panel', null, parent);
    const head = el('div', 'ab-help-title', null, this.root);
    el('span', '', 'CONTROLS', head);
    fillKeyText(el('span', '', null, head), '[H] close');
    controlsGrid(this.root);
    el('div', 'ab-help-sub', 'ATTACK TELLS', this.root);
    tellLegend(this.root);
    this.on = false;
  }

  toggle(force) {
    this.on = force === undefined ? !this.on : !!force;
    this.root.classList.toggle('on', this.on);
    return this.on;
  }
}

export class StatsPanel {
  constructor(parent) {
    this.root = el('div', 'ab-stats ab-panel', null, parent);
    el('div', 'ab-stats-title', 'RECORD', this.root);
    this.body = el('div', '', null, this.root);
  }

  /** rows: [[label, value], ...] or null to hide. */
  show(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      this.root.classList.remove('on');
      return;
    }
    this.body.textContent = '';
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const r = el('div', 'row', null, this.body);
      el('span', 'k', String(row[0] ?? ''), r);
      el('span', 'v', String(row[1] ?? ''), r);
    }
    this.root.classList.add('on');
  }
}
