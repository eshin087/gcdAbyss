import { CONFIG } from '../core/config.js';
import { button, controlsGrid, el, fillKeyText, tellLegend, touchGrid } from './dom.js';
import { TechniquePanel } from './techniques.js';

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
  '[Q] [R] techniques',
  '[Tab] lock-on',
  '[E] rest',
  '[Esc] pause',
  '[H] help',
  '[M] mute',
  '[F1] lab',
];

// the same list for the touch controls (src/ui/touch.js); shown instead on touch devices
const TITLE_TOUCH = [
  '[STICK] move · rim: sprint',
  '[ATTACK] tap: combo · hold: thrust',
  '[BLOCK] hold · tap: parry',
  '[DODGE] roll',
  '[FLASK] heal',
  '[TECH] technique',
  '[LOCK] lock-on',
  '[||] pause',
  '[PINCH] zoom',
];

export class TitleScreen {
  /** stage (optional): { levels: [{ id, name }], current: id, pick(id) } — the stage picker (each
   *  level is its own page load: picking one reloads the game into it, levels/index.js). */
  constructor(parent, visible, stage = null) {
    this.root = el('div', 'ab-title', null, parent);
    const inner = el('div', 'ab-title-inner', null, this.root);
    inner.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    this.logo = el('pre', 'ab-logo', LOGO.join('\n'), inner);
    el('div', 'ab-title-rule', '◆', inner);
    el('div', 'ab-title-sub', 'an ASCII action RPG', inner);
    if (stage?.levels?.length > 1) {
      const row = el('div', 'ab-stage', null, inner);
      for (const L of stage.levels) {
        const b = button(row, L.id === stage.current ? 'on' : '', () => {
          if (L.id !== stage.current) stage.pick?.(L.id);
        });
        b.textContent = String(L.name).toUpperCase();
        b.dataset.level = L.id;
      }
    }
    el('div', 'ab-press kb-only', 'PRESS ANY KEY', inner);
    el('div', 'ab-press tp-only', 'TAP TO BEGIN', inner);
    const ctrl = el('div', 'ab-title-ctrl kb-only', null, inner);
    for (const item of TITLE_KEYS) fillKeyText(el('span', 'item', null, ctrl), item);
    const tctrl = el('div', 'ab-title-ctrl tp-only', null, inner);
    for (const item of TITLE_TOUCH) fillKeyText(el('span', 'item', null, tctrl), item);
    tellLegend(inner).classList.add('title');
    el('div', 'ab-credit', "art direction inspired by @Ansenjeo's ASCII MMORPG  ·  prototype v0.4", this.root);

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
    // the equip panel (ui/techniques.js): it takes the pause menu's place while open
    this.btnTech = button(panel, '', () => this.showTechniques(true));
    el('span', '', 'TECHNIQUES', this.btnTech);
    this.techVal = el('span', 'v', '', this.btnTech);
    this.techs = new TechniquePanel(game, this.root, () => this.showTechniques(false));
    this.btnQuality = button(panel, '', () => game.flow?.cycleQuality?.());
    fillKeyText(el('span', '', null, this.btnQuality), 'QUALITY [F2]');
    this.qualityVal = el('span', 'v', '', this.btnQuality);
    this.btnMute = button(panel, '', () => game.flow?.toggleMute?.());
    fillKeyText(el('span', '', null, this.btnMute), 'SOUND [M]');
    this.muteVal = el('span', 'v', '', this.btnMute);
    // touch devices: fullscreen (hides the browser bars; Android also locks landscape), if supported
    const doc = globalThis.document;
    if (doc?.fullscreenEnabled && typeof doc.documentElement?.requestFullscreen === 'function') {
      this.btnFull = button(panel, 'tp-only', () => toggleFullscreen());
      el('span', '', 'FULLSCREEN', this.btnFull);
      this.fullVal = el('span', 'v', '', this.btnFull);
    }
    el('div', 'ab-sep', null, panel);
    controlsGrid(panel).classList.add('kb-only');
    touchGrid(panel).classList.add('tp-only');
    tellLegend(panel);
    this.on = false;
    this._q = null;
    this._t = -1;
    this._m = null;
  }

  show(on) {
    this.on = !!on;
    this.root.classList.toggle('on', this.on);
    if (!this.on) this.showTechniques(false); // the next pause opens on the menu
    this.refresh();
  }

  /** Open / close the TECHNIQUES equip panel (in place of the menu). */
  showTechniques(on) {
    on = !!on && this.on;
    this.root.classList.toggle('techs', on);
    this.techs.show(on);
  }

  /** Cheap: only touches the DOM when quality / mute / the learned count changed. */
  refresh() {
    if (!this.on) return;
    const book = this.game.player?.techniques;
    const n = book ? book.list().length : 0;
    if (n !== this._t) {
      this._t = n;
      this.techVal.textContent = n ? `${n} LEARNED` : 'NONE YET';
    }
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
    if (this.fullVal) {
      const f = !!globalThis.document?.fullscreenElement;
      if (f !== this._f) {
        this._f = f;
        this.fullVal.textContent = f ? 'ON' : 'OFF';
      }
    }
  }
}

/** Enter / leave fullscreen; in fullscreen also try to lock landscape (Android; iOS has neither). */
function toggleFullscreen() {
  const doc = globalThis.document;
  if (!doc) return;
  if (doc.fullscreenElement) {
    doc.exitFullscreen?.()?.catch?.(() => {});
    return;
  }
  const p = doc.documentElement?.requestFullscreen?.({ navigationUI: 'hide' });
  p?.then?.(() => globalThis.screen?.orientation?.lock?.('landscape')?.catch?.(() => {}))?.catch?.(() => {});
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
