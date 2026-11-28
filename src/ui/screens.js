import { CONFIG } from '../core/config.js';
import { fpsCapOn, qualityLabel } from '../render/autoQuality.js';
import { GAME_VERSION } from './changelog.js';
import { button, controlsGrid, el, fillKeyText, tellLegend, touchGrid } from './dom.js';
import { dressStageButton, gradeHead, recLookNow, sharedLine } from './recordLooks.js';
import { TitleMenu, menuNow } from './titleMenu.js';
import { GCD_LOGO } from './gcdLogo.js';

// Full-screen / panel UI: title, pause menu, help panel, victory record.

// "gcd", lowercase, in a block/box-drawing figlet face (the banners' face, ui/blockText.js, drawn
// small: d's stem rises a row above the bowls, g's tail drops a row below them). Every row is one
// width. The <pre> uses a font stack that has the box glyphs
// itself (JetBrains Mono from Google Fonts is subset without them, which would misalign columns).
const LOGO = [
  '        ' + ' ' + '        ' + ' ' + '     ██╗',
  ' ██████╗' + ' ' + ' ██████╗' + ' ' + ' ██████║',
  '██╔══██║' + ' ' + '██╔════╝' + ' ' + '██╔══██║',
  '╚██████║' + ' ' + '╚██████╗' + ' ' + '╚██████║',
  ' ╚═══██║' + ' ' + ' ╚═════╝' + ' ' + ' ╚═════╝',
  ' █████╔╝' + ' ' + '        ' + ' ' + '        ',
];
const SHIMMER_HZ = 12;
// solid blocks per column of the first title logo (41 columns): see TitleScreen.update
const STREAM_COLS = [4, 5, 2, 2, 2, 5, 4, 0, 5, 5, 3, 3, 3, 5, 2, 0, 1, 2, 2, 3, 3, 2, 2, 1, 0, 4, 4, 3, 3, 3, 4, 4, 0, 4, 4, 3, 3, 3, 4, 4, 0];

// the title's controls line; "[@action]" chips show the bound key (or the pad button while a pad is
// in use) and follow every remap (ui/dom.js actionChip)
const TITLE_KEYS = [
  '[@move] move',
  '[@aim] aim',
  '[@attack] light',
  '[@heavy] heavy · hold: charge',
  '[@block] block · tap: parry',
  '[@dodge] dodge',
  '[@sprint] sprint',
  '[@flask] flask',
  '[@lockOn] lock-on',
  '[@interact] rest',
  '[@pause] pause',
  '[@help] help',
];
const TITLE_KB_ONLY = ['[@mute] mute', '[F1] lab'];

// the same list for the touch controls (src/ui/touch.js); shown instead on touch devices
const TITLE_TOUCH = [
  '[STICK] move · rim: sprint',
  '[ATTACK] light combo',
  '[HEAVY] heavy · hold: cleave',
  '[BLOCK] hold · tap: parry',
  '[DODGE] roll',
  '[FLASK] heal',
  '[LOCK] lock-on',
  '[||] pause',
  '[PINCH] zoom',
];

export class TitleScreen {
  /** stage (optional): { levels: [{ id, name }], current: id, pick(id) } — the stage picker (each
   *  level is its own page load: picking one reloads the game into it, levels/index.js).
   *  news (optional): the WHAT'S NEW panel (ui/changelogPanel.js): a button under the picker opens
   *  it and carries its unread badge. */
  /** records (optional): { bestFor(id) → { grade, marks, timeMs, clears } | null, startRush() } — each
   *  level's best under its button and the BOSS RUSH entry (ADR-179; ?recLook=, ui/recordLooks.js). */
  constructor(parent, visible, stage = null, news = null, records = null) {
    // ?menu=a|b|c: one of the new layouts (ui/titleMenu.js); none: the title as before
    this.menuLook = stage?.levels?.length > 1 ? menuNow() : null;
    if (this.menuLook) {
      this.root = el('div', `ab-title gm gm-${this.menuLook}`, null, parent);
      this.stageButtons = [];
      this.records = records;
      this.newsButton = null;
      this.current = stage.current;
      this.menu = new TitleMenu(this, this.root, this.menuLook, stage, news, records);
      this.logo = this.menu.logo;
      this._shimmerInit(GCD_LOGO);
      this._visibleInit(visible);
      return;
    }
    this.root = el('div', 'ab-title', null, parent);
    const inner = el('div', 'ab-title-inner', null, this.root);
    inner.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    this.logo = el('pre', 'ab-logo', LOGO.join('\n'), inner);
    el('div', 'ab-title-rule', '◆', inner);
    el('div', 'ab-title-sub', 'an ASCII action RPG', inner);
    this.stageButtons = []; // the stage picker's buttons, for the gamepad's focus (ui/gamepad.js)
    this.records = records;
    this.recLook = recLookNow();
    this._stages = []; // [button, id, name]
    if (stage?.levels?.length > 1) {
      const row = el('div', `ab-stage r-${this.recLook}`, null, inner);
      for (const L of stage.levels) {
        const b = button(row, L.id === stage.current ? 'on' : '', () => {
          if (L.id !== stage.current) stage.pick?.(L.id);
        });
        b.textContent = String(L.name).toUpperCase();
        b.dataset.level = L.id;
        this.stageButtons.push(b);
        this._stages.push([b, L.id, String(L.name).toUpperCase()]);
      }
      // the boss rush: every level back to back for one time (game/rush.js); pad-walked with the stages
      if (records?.startRush) {
        const b = button(row, 'ab-rush-btn', () => records.startRush());
        b.dataset.level = 'rush';
        this.stageButtons.push(b);
        this._stages.push([b, 'rush', 'BOSS RUSH']);
        this.rushButton = b;
      }
      this.current = stage.current;
      this.sharedEl = this.recLook === 'c' ? el('div', 'ab-stage-shared', null, inner) : null;
      if (this.sharedEl) {
        for (const [b, id] of this._stages) b.addEventListener('mouseenter', () => this._share(id));
        row.addEventListener('mouseleave', () => this._share(null));
      }
      this.refreshRecords();
    }
    // WHAT'S NEW: walked with the stage buttons on a pad (ui/gamepad.js), never starts the game
    this.newsButton = null;
    if (news) {
      const row = el('div', 'ab-stage ab-news-row', null, this.root);
      const b = button(row, 'ab-news-btn', () => news.open());
      el('span', '', "WHAT'S NEW", b);
      this.newsBadge = el('span', 'ab-news-badge', '', b);
      this.newsButton = b;
      this._news = news;
      const sync = () => setBadge(this.newsBadge, news.unseenCount(), (n) => `${n} NEW`);
      news.onChange(sync);
      sync();
    }
    el('div', 'ab-press kb-only', 'PRESS ANY KEY', inner);
    el('div', 'ab-press tp-only', 'TAP TO BEGIN', inner);
    el('div', 'ab-press pad-only', 'PRESS ANY BUTTON', inner);
    // keyboard and pad share one list (the chips follow the device); hidden on touch
    const ctrl = el('div', 'ab-title-ctrl ab-nontouch', null, inner);
    for (const item of TITLE_KEYS) fillKeyText(el('span', 'item', null, ctrl), item);
    for (const item of TITLE_KB_ONLY) fillKeyText(el('span', 'item kb-only', null, ctrl), item);
    const tctrl = el('div', 'ab-title-ctrl tp-only', null, inner);
    for (const item of TITLE_TOUCH) fillKeyText(el('span', 'item', null, tctrl), item);
    tellLegend(inner).classList.add('title');
    el('div', 'ab-credit', `prototype v${GAME_VERSION}`, this.root);

    this._shimmerInit(LOGO);
    this._visibleInit(visible);
  }

  /** shimmer: a sweeping column of '▓' plus a few random '▒' over the solid blocks of `lines` */
  _shimmerInit(lines) {
    this.logoW = lines[0].length;
    this.chars = [...lines.join('\n')];
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
  }

  _visibleInit(visible) {
    this.visible = true;
    this.goneT = 0;
    this.t = 0;
    this.acc = 0;
    this.seed = 0x9e3779b9; // the shimmer's own random numbers: the game's stream must not depend on the logo
    if (!visible) {
      this.visible = false;
      this.root.classList.add('off', 'gone');
    }
  }

  /** The new layouts: did the menu use this key (an arrow, Enter on an entry) this frame? */
  eatsKey(code) {
    return !!this.menu?.eats?.(code);
  }

  /** The new layouts: the CONTROLS panel is open (a key or a click closes it, not starts the game). */
  holdsStart() {
    return !!this.menu?.drawerOn;
  }

  /** The new layouts: the entry from `el` in direction (dx, dy) (ui/gamepad.js); null: none. */
  navigate(el, dx, dy) {
    return this.menu?.navigate?.(el, dx, dy) ?? null;
  }

  /** Each stage button's best (and the rush's) from the records; call again when a record is saved. */
  refreshRecords() {
    if (this.menu) {
      this.menu.refresh();
      return;
    }
    const R = this.records;
    for (const [b, id, name] of this._stages) {
      let best = null;
      try {
        best = R?.bestFor?.(id) ?? null;
      } catch {
        best = null;
      }
      dressStageButton(b, name, best, this.recLook);
    }
    this._share(this._shareId ?? null, true);
  }

  /** recLook c: the shared line shows stage `id` (null: the pad's focus, else the current stage). */
  _share(id, force = false) {
    if (!this.sharedEl) return;
    const focus = this._stages.find(([b]) => b.classList?.contains('pad-focus'))?.[1];
    const want = id ?? focus ?? this.current;
    if (want === this._shownId && !force) return;
    this._shareId = id;
    this._shownId = want;
    const S = this._stages.find(([, sid]) => sid === want);
    let best = null;
    try {
      best = this.records?.bestFor?.(want) ?? null;
    } catch {
      best = null;
    }
    sharedLine(this.sharedEl, S?.[2] ?? '', best);
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

  /** A small xorshift in [0, 1): the shimmer's sparkle only (never Math.random, which the fights share). */
  _rand() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  update(dt) {
    if (this.goneT > 0) {
      this.goneT -= dt;
      if (this.goneT <= 0) this.root.classList.add('gone');
    }
    if (!this.visible) return;
    if (this.sharedEl && this._shareId == null) this._share(null); // follows the pad's focus
    this.menu?.update(dt);
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / SHIMMER_HZ) return;
    this.acc = 0;
    const sweep = ((this.t * 15) % (this.logoW + 30)) - 15;
    const w = this.work;
    for (let k = 0; k < this.blocks.length; k += 2) {
      const i = this.blocks[k], col = this.blocks[k + 1];
      const d = Math.abs(col - sweep);
      w[i] = d < 1.2 ? '▓' : d < 2.4 ? '▒' : this._rand() < 0.012 ? '▓' : '█';
    }
    this.logo.textContent = w.join('');
    // The seeded fight sims were tuned on the stream the first title logo left behind: it drew
    // Math.random once per solid block away from its sweep. Those draws are kept (the count only,
    // from that logo's blocks per column), so a new logo or layout never moves a fight (ADR-195).
    const old = ((this.t * 15) % (STREAM_COLS.length + 30)) - 15;
    for (let c = 0; c < STREAM_COLS.length; c++) {
      if (Math.abs(c - old) < 2.4) continue;
      for (let n = STREAM_COLS[c]; n > 0; n--) Math.random();
    }
  }
}

const QUIT_CONFIRM = 3; // s: QUIT TO TITLE's second press must come within this

export class PauseMenu {
  constructor(game, parent, news = null) {
    this.game = game;
    this.root = el('div', 'ab-pause', null, parent);
    const panel = el('div', 'ab-pause-panel ab-panel', null, this.root);
    el('div', 'ab-pause-title', 'PAUSED', panel);
    const resume = button(panel, 'primary', () => game.flow?.resume?.());
    el('span', '', 'RESUME', resume);
    fillKeyText(el('span', 'v', null, resume), '[@pause]');
    this.btnQuality = button(panel, '', () => game.flow?.cycleQuality?.());
    fillKeyText(el('span', '', null, this.btnQuality), 'QUALITY [F2]');
    this.qualityVal = el('span', 'v', '', this.btnQuality);
    this.btnMute = button(panel, '', () => game.flow?.toggleMute?.());
    fillKeyText(el('span', '', null, this.btnMute), 'SOUND [@mute]', 'kb');
    this.muteVal = el('span', 'v', '', this.btnMute);
    // the frame-rate cap (ADR-200: on by default on a touch device; heat and battery)
    this.btnCap = button(panel, '', () => game.flow?.toggleFpsCap?.());
    el('span', '', `${CONFIG.fpsCap.fps} FPS CAP`, this.btnCap);
    this.capVal = el('span', 'v', '', this.btnCap);
    // remap keys, mouse buttons and pad buttons (ui/remap.js; the HUD builds the panel)
    this.btnControls = button(panel, 'ab-nontouch', () => game.hud?.remapUi?.open?.()); // no keys on a phone (unless a pad is in use)
    el('span', '', 'CONTROLS', this.btnControls);
    el('span', 'v', 'REMAP ›', this.btnControls);
    // touch devices: fullscreen (hides the browser bars; Android also locks landscape), if supported
    const doc = globalThis.document;
    if (doc?.fullscreenEnabled && typeof doc.documentElement?.requestFullscreen === 'function') {
      this.btnFull = button(panel, 'tp-only', () => toggleFullscreen());
      el('span', '', 'FULLSCREEN', this.btnFull);
      this.fullVal = el('span', 'v', '', this.btnFull);
    }
    // touch: where the right-thumb cluster sits and how large it is (ui/touch.js cyclePad; the
    // controls show through the pause screen while these are stepped)
    this.btnPadPos = button(panel, 'tp-only', () => game.touch?.cyclePad?.('pos'));
    el('span', '', 'PAD POSITION', this.btnPadPos);
    this.padPosVal = el('span', 'v', '', this.btnPadPos);
    this.btnPadSize = button(panel, 'tp-only', () => game.touch?.cyclePad?.('size'));
    el('span', '', 'PAD SIZE', this.btnPadSize);
    this.padSizeVal = el('span', 'v', '', this.btnPadSize);
    // ... which hand guards, and whether a held ATTACK keeps cutting (ADR-131)
    this.btnPadLayout = button(panel, 'tp-only', () => game.touch?.cyclePad?.('layout'));
    el('span', '', 'PAD LAYOUT', this.btnPadLayout);
    this.padLayoutVal = el('span', 'v', '', this.btnPadLayout);
    // ... and which of the two guard buttons are drawn (ADR-278: the one beside the stick, the one in the cluster)
    this.btnLGuard = button(panel, 'tp-only', () => game.touch?.cyclePad?.('lguard'));
    el('span', '', 'LEFT BLOCK', this.btnLGuard);
    this.lGuardVal = el('span', 'v', '', this.btnLGuard);
    this.btnRGuard = button(panel, 'tp-only', () => game.touch?.cyclePad?.('rguard'));
    el('span', '', 'RIGHT BLOCK', this.btnRGuard);
    this.rGuardVal = el('span', 'v', '', this.btnRGuard);
    this.btnPadHold = button(panel, 'tp-only', () => game.touch?.cyclePad?.('hold'));
    el('span', '', 'HOLD ATTACK', this.btnPadHold);
    this.padHoldVal = el('span', 'v', '', this.btnPadHold);
    // ... and whether a flick on the right half dodges (ADR-271)
    this.btnPadSwipe = button(panel, 'tp-only', () => game.touch?.cyclePad?.('swipe'));
    el('span', '', 'SWIPE DODGE', this.btnPadSwipe);
    this.padSwipeVal = el('span', 'v', '', this.btnPadSwipe);
    // WHAT'S NEW (ui/changelogPanel.js): every version and what changed; the value counts the unread
    this.btnNews = null;
    if (news) {
      this.btnNews = button(panel, '', () => news.open());
      el('span', '', "WHAT'S NEW", this.btnNews);
      this.newsVal = el('span', 'v', '›', this.btnNews);
      const sync = () => {
        const n = news.unseenCount();
        this.newsVal.textContent = n > 0 ? `${n} NEW ›` : '›';
        this.btnNews.classList.toggle('has-new', n > 0);
      };
      news.onChange(sync);
      sync();
    }
    // back to the title screen (the fight is lost): a second press within QUIT_CONFIRM s confirms
    this.btnQuit = button(panel, '', () => this._quit());
    el('span', '', 'QUIT TO TITLE', this.btnQuit);
    this.quitVal = el('span', 'v', '›', this.btnQuit);
    this.quitArmed = 0;
    // the buttons in order, for the gamepad's menu focus (ui/gamepad.js)
    this.buttons = [resume, this.btnQuality, this.btnMute, this.btnCap, this.btnControls, this.btnFull, this.btnPadPos, this.btnPadSize, this.btnPadLayout, this.btnLGuard, this.btnRGuard, this.btnPadHold, this.btnPadSwipe, this.btnNews, this.btnQuit].filter(Boolean);
    el('div', 'ab-sep', null, panel);
    controlsGrid(panel, 'kb').classList.add('kb-only');
    touchGrid(panel).classList.add('tp-only');
    controlsGrid(panel, 'pad').classList.add('pad-only');
    tellLegend(panel);
    this.on = false;
    this._q = null;
    this._m = null;
  }

  /** QUIT TO TITLE: the first press arms it ("SURE? PRESS AGAIN"), a second within QUIT_CONFIRM s leaves. */
  _quit() {
    const now = Number(globalThis.performance?.now?.() ?? Date.now()) / 1000;
    if (this.quitArmed > 0 && now - this.quitArmed <= QUIT_CONFIRM) {
      this._disarm();
      this.game.flow?.quitToTitle?.();
      return;
    }
    this.quitArmed = now;
    this.btnQuit.classList.add('confirm');
    this.quitVal.textContent = 'SURE? PRESS AGAIN';
  }

  _disarm() {
    this.quitArmed = 0;
    this.btnQuit.classList.remove('confirm');
    this.quitVal.textContent = '›';
  }

  show(on) {
    this.on = !!on;
    this._disarm();
    this.root.classList.toggle('on', this.on);
    this.refresh();
  }

  /** Cheap: only touches the DOM when quality / mute changed. */
  refresh() {
    if (!this.on) return;
    if (this.quitArmed > 0 && Number(globalThis.performance?.now?.() ?? Date.now()) / 1000 - this.quitArmed > QUIT_CONFIRM) this._disarm();
    const q = qualityLabel(this.game.settings, this.game.autoQ, CONFIG.quality);
    if (q !== this._q) {
      this._q = q;
      this.qualityVal.textContent = q;
    }
    const cap = fpsCapOn(this.game);
    if (cap !== this._cap) {
      this._cap = cap;
      this.capVal.textContent = cap ? 'ON' : 'OFF';
    }
    const m = !!this.game.audio?.muted;
    if (m !== this._m) {
      this._m = m;
      this.muteVal.textContent = m ? 'MUTED' : 'ON';
    }
    const tc = this.game.touch, pp = tc?.padPos, ps = tc?.padSize;
    if (pp !== this._pp) {
      this._pp = pp;
      this.padPosVal.textContent = String(pp ?? '').toUpperCase();
    }
    if (ps !== this._ps) {
      this._ps = ps;
      this.padSizeVal.textContent = { s: 'SMALL', m: 'MEDIUM', l: 'LARGE' }[ps] ?? '';
    }
    const pl = tc?.layout, ph = tc?.holdAttack;
    if (pl !== this._pl) {
      this._pl = pl;
      this.padLayoutVal.textContent = { classic: 'BLOCK BESIDE', split: 'BLOCK UNDER' }[pl] ?? '';
    }
    if (ph !== this._ph) {
      this._ph = ph;
      this.padHoldVal.textContent = ph ? 'ON' : 'OFF';
    }
    const lg = !!tc?.leftGuard, rg = tc?.rightGuard !== false;
    if (lg !== this._lg) {
      this._lg = lg;
      this.lGuardVal.textContent = lg ? 'ON' : 'OFF';
    }
    if (rg !== this._rg) {
      this._rg = rg;
      this.rGuardVal.textContent = rg ? 'ON' : 'OFF';
    }
    const sw = !!tc?.swipeDodge;
    if (sw !== this._sw) {
      this._sw = sw;
      this.padSwipeVal.textContent = sw ? 'ON' : 'OFF';
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

/** A badge's text and visibility: shown with label(n) while n > 0. */
function setBadge(node, n, label) {
  if (!node) return;
  const on = Number.isFinite(n) && n > 0;
  node.textContent = on ? label(n) : '';
  node.classList.toggle('on', on);
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
    fillKeyText(el('span', '', null, head), '[@help] close');
    controlsGrid(this.root, 'kb').classList.add('kb-only');
    controlsGrid(this.root, 'pad').classList.add('pad-only');
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
  /** look: the grade's look option ('a' | 'b' | 'c'; ?gradeLook=, ui/recordLooks.js). */
  constructor(parent, look = 'a') {
    this.root = el('div', `ab-stats ab-panel g-${look}`, null, parent);
    this.look = look;
    // with a grade (has-head): the grade on the left, the rows beside it in two columns (stacked on a
    // phone held upright), so the panel is no taller than the rows were
    this.head = el('div', 'ab-rec-head', null, this.root);
    const rowsEl = el('div', 'ab-rec-rows', null, this.root);
    this.titleEl = el('div', 'ab-stats-title', 'RECORD', rowsEl);
    this.body = el('div', 'ab-stats-body', null, rowsEl);
  }

  /** rows: [[label, value], ...] or null to hide. head (optional): the run's grade, marks and time
   *  (GameFlow._recordHead): { title, grade, marks, time, newBestTime, newBestGrade, first, prev, note }. */
  show(rows, head = null) {
    if (!Array.isArray(rows) || !rows.length) {
      this.root.classList.remove('on');
      return;
    }
    this.titleEl.textContent = head?.title ?? 'RECORD';
    gradeHead(this.head, head, this.look);
    this.root.classList.toggle('has-head', !!head?.grade);
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
