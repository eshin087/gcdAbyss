import { DelayedBar } from './bars.js';
import { Banner } from './banner.js';
import { el, fillKeyText, flashClass, num, safeDt } from './dom.js';
import { CombatFeed } from './feed.js';
import { injectHudStyle } from './hudStyle.js';
import { LogPanel } from './logPanel.js';
import { Minimap } from './minimap.js';
import { NameTags } from './nameTags.js';
import { HelpPanel, PauseMenu, StatsPanel, TitleScreen } from './screens.js';

// HUD: Ansenjeo-style MMO overlay (player frame, minimap, tabbed log, name tags) plus souls-style
// boss bar, banners, title and pause screens. Pure DOM under #ui; update(realDt) only writes to the
// DOM when a shown value changes. Screen-grade uniforms are driven by GameFlow (src/game/grade.js).

const DMG_FADE = 1.6; // seconds after the last hit before the boss damage counter fades

export class Hud {
  constructor(game) {
    this.game = game;
    injectHudStyle();
    const host = document.getElementById('ui') ?? document.body;
    this.root = el('div', 'ab-root', null, host);
    this.root.dataset.state = game.state || 'title';
    this._warned = 0;

    this._buildPlayerFrame();
    this.map = new Minimap(game, this.root);
    this.logPanel = new LogPanel(game, this.root);
    this._buildBossBar();
    this.promptEl = el('div', 'ab-prompt ab-panel', null, this.root);
    this._prompt = null;
    this.tags = new NameTags(game, this.root);
    this.bannerUi = new Banner(this.root);
    this.statsUi = new StatsPanel(this.root);
    this.help = new HelpPanel(this.root);
    const hint = el('div', 'ab-hint ab-play', null, this.root);
    fillKeyText(hint, '[H] help  [Esc] pause');
    this.titleUi = new TitleScreen(this.root, (game.state || 'title') === 'title');
    this.pauseUi = new PauseMenu(game, this.root);
    this.feed = new CombatFeed(game, this);

    const ev = game.events;
    ev?.on('state', (e) => {
      this.root.dataset.state = e?.to ?? game.state ?? '';
    });
    ev?.on('dragon:phase2', () => {
      if (this.bossOn) this.bossEl.classList.add('p2');
    });
    ev?.on('player:noStamina', () => flashClass(this.stBar.root));
    ev?.on('player:noFlask', () => flashClass(this.pipsEl));

    this._steps = [
      (dt) => this._updatePlayer(dt),
      (dt) => this._updateBoss(dt),
      (dt) => this.tags.update(dt),
      (dt) => this.map.update(dt),
      (dt) => this.bannerUi.update(dt),
      (dt) => this.titleUi.update(dt),
      () => this.pauseUi.refresh(),
      (dt) => this.feed.flush(dt),
    ];
  }

  // ---------------------------------------------------------------- build
  _buildPlayerFrame() {
    const pf = el('div', 'ab-pf ab-panel ab-play', null, this.root);
    const head = el('div', 'ab-pf-head', null, pf);
    el('span', 'ab-pf-name', 'WANDERER', head);
    el('span', 'ab-pf-lv', 'Lv 12', head);
    el('div', 'ab-pf-sub', 'Unkindled  ·  Ashen Knight', pf);

    const hpRow = el('div', 'ab-row', null, pf);
    el('span', 'lbl', 'HP', hpRow);
    this.hpBar = new DelayedBar(hpRow, 'hp', { hold: 0.6, drain: 2.4, rise: 6 });
    this.hpVal = el('span', 'val', '', hpRow);

    const stRow = el('div', 'ab-row', null, pf);
    el('span', 'lbl', 'ST', stRow);
    this.stBar = new DelayedBar(stRow, 'st', { hold: 0.35, drain: 3, rise: 14, chunk: false });
    this.stVal = el('span', 'val dim', '', stRow);

    const foot = el('div', 'ab-pf-foot', null, pf);
    const fl = el('span', '', null, foot);
    this.pipsEl = el('span', 'ab-pips', null, fl);
    this.pipFull = el('span', 'full', '', this.pipsEl);
    this.pipEmpty = el('span', 'empty', '', this.pipsEl);
    fillKeyText(el('span', '', null, fl), ' [F]');
    this.lockEl = el('span', 'ab-lock', '◎ LOCKED ON', foot);

    this._hp = null;
    this._st = null;
    this._fl = null;
    this._lock = null;
    this._low = null;
  }

  _buildBossBar() {
    this.bossEl = el('div', 'ab-boss', null, this.root);
    const head = el('div', 'ab-boss-head', null, this.bossEl);
    this.bossName = el('span', 'ab-boss-name', '', head);
    this.bossDmg = el('span', 'ab-boss-dmg', '', head);
    this.bossBar = new DelayedBar(this.bossEl, 'boss', { hold: 0.6, drain: 1.8, rise: 2.2 });
    this.bossOn = false;
    this.bossHpLast = 0;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this._dmgShown = false;
    this._p2 = false;
  }

  // ---------------------------------------------------------------- contract API
  log(text, channel = 'system') {
    try {
      this.logPanel.add(text, channel);
    } catch (err) {
      this._warn(err);
    }
  }

  showBossBar(name) {
    const d = this.game.dragon;
    this.bossName.textContent = String(name || d?.name || 'VAELGRIM, THE CINDER WYRM').toUpperCase();
    const max = Math.max(1, num(d?.maxHp, 1));
    const hp = num(d?.hp, max);
    // fill in from empty, souls-style
    this.bossBar.snap(0);
    this.bossBar.set(hp / max);
    this.bossHpLast = hp;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this._setDmgShown(false);
    this._p2 = d?.phase === 2;
    this.bossEl.classList.toggle('p2', this._p2);
    this.bossOn = true;
    this.bossEl.classList.add('on');
  }

  hideBossBar() {
    this.bossOn = false;
    this.bossEl.classList.remove('on');
    this._setDmgShown(false);
  }

  banner(text, kind = 'area', opts = {}) {
    this.bannerUi.show(text, kind, opts || {});
  }

  /** Blinking sub-line under the current banner (null clears). */
  bannerHint(text) {
    this.bannerUi.hint(text);
  }

  clearBanner(instant = false) {
    this.bannerUi.clear(instant);
  }

  prompt(text) {
    const t = text ? String(text) : null;
    if (t === this._prompt) return;
    this._prompt = t;
    if (t) fillKeyText(this.promptEl, t);
    this.promptEl.classList.toggle('on', !!t);
  }

  showTitle() {
    this.titleUi.show();
  }

  hideTitle() {
    this.titleUi.hide();
  }

  showPause(on) {
    this.pauseUi.show(on);
  }

  toggleHelp(force) {
    return this.help.toggle(force);
  }

  /** Victory record rows [[label, value], ...]; null hides. */
  showStats(rows) {
    this.statsUi.show(rows);
  }

  // ---------------------------------------------------------------- per frame
  update(realDt) {
    const dt = safeDt(realDt);
    // each widget is isolated so one failing piece never stalls the rest of the HUD
    for (const step of this._steps) {
      try {
        step(dt);
      } catch (err) {
        this._warn(err);
      }
    }
  }

  _updatePlayer(dt) {
    const p = this.game.player;
    if (p) {
      const maxHp = Math.max(1, num(p.maxHp, 1));
      const hp = Math.max(0, num(p.hp, maxHp));
      this.hpBar.set(hp / maxHp);
      const hpKey = Math.ceil(hp) * 100000 + Math.round(maxHp);
      if (hpKey !== this._hp) {
        this._hp = hpKey;
        this.hpVal.textContent = `${Math.ceil(hp)} / ${Math.round(maxHp)}`;
      }
      const low = hp > 0 && hp / maxHp < 0.25;
      if (low !== this._low) {
        this._low = low;
        this.hpBar.root.classList.toggle('low', low);
      }

      const maxSt = Math.max(1, num(p.maxStamina, 1));
      const st = Math.max(0, num(p.stamina, maxSt));
      this.stBar.set(st / maxSt);
      const stKey = Math.round(st);
      if (stKey !== this._st) {
        this._st = stKey;
        this.stVal.textContent = String(stKey);
      }

      const maxF = Math.max(0, Math.min(9, Math.round(num(p.maxFlasks, 0))));
      const f = Math.max(0, Math.min(maxF, Math.round(num(p.flasks, 0))));
      const flKey = f * 16 + maxF;
      if (flKey !== this._fl) {
        this._fl = flKey;
        this.pipFull.textContent = '◆'.repeat(f);
        this.pipEmpty.textContent = '◇'.repeat(maxF - f);
      }

      const lock = !!p.lockOn;
      if (lock !== this._lock) {
        this._lock = lock;
        this.lockEl.classList.toggle('on', lock);
      }
    }
    this.hpBar.update(dt);
    this.stBar.update(dt);
  }

  _updateBoss(dt) {
    if (this.bossOn) {
      const d = this.game.dragon;
      if (d) {
        const max = Math.max(1, num(d.maxHp, 1));
        const hp = Math.max(0, num(d.hp, max));
        // the damage counter sums consecutive HP losses (authoritative, independent of events)
        if (hp < this.bossHpLast - 0.01) {
          if (this.dmgT <= 0) this.dmgAcc = 0;
          this.dmgAcc += this.bossHpLast - hp;
          this.dmgT = DMG_FADE;
          this.bossDmg.textContent = String(Math.round(this.dmgAcc));
          this._setDmgShown(true);
        }
        this.bossHpLast = hp;
        this.bossBar.set(hp / max);
        const p2 = d.phase === 2;
        if (p2 !== this._p2) {
          this._p2 = p2;
          this.bossEl.classList.toggle('p2', p2);
        }
      }
    }
    if (this.dmgT > 0) {
      this.dmgT -= dt;
      if (this.dmgT <= 0) this._setDmgShown(false);
    }
    this.bossBar.update(dt);
  }

  _setDmgShown(on) {
    if (on === this._dmgShown) return;
    this._dmgShown = on;
    this.bossDmg.classList.toggle('on', on);
  }

  _warn(err) {
    if (this._warned >= 5) return;
    this._warned++;
    console.error(`[hud] update failed${this._warned === 5 ? ' (further errors suppressed)' : ''}`, err);
  }
}
