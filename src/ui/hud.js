import { DEFENSE, POSTURE } from '../combat/rules.js';
import { DelayedBar, PostureBar } from './bars.js';
import { Banner } from './banner.js';
import { Callouts } from './callouts.js';
import { el, fillKeyText, flashClass, num, safeDt } from './dom.js';
import { CombatFeed } from './feed.js';
import { injectHudStyle } from './hudStyle.js';
import { LogPanel } from './logPanel.js';
import { Minimap } from './minimap.js';
import { NameTags } from './nameTags.js';
import { ScreenProjector } from './project.js';
import { HelpPanel, PauseMenu, StatsPanel, TitleScreen } from './screens.js';
import { QiRow, RewardCard, injectTechStyle } from './techniques.js';
import { TellEdges } from './tells.js';
import { getTechnique } from '../entities/player/techniques/index.js';

// HUD: Ansenjeo-style MMO overlay (player frame, minimap, tabbed log, name tags) plus the boss bar
// (HP + posture), screen-edge cues (red flash on a dodge-only tell's timing cue, cyan Ghostep pulse;
// the tells themselves are shown in the world, never as HUD text), call-outs (PARRY, GHOSTEP,
// GUARD BROKEN, damage numbers), banners, title and pause screens. Pure DOM under #ui;
// update(realDt) only writes to the DOM when a shown value changes. Screen-grade uniforms are
// driven by GameFlow (src/game/grade.js).

const DMG_FADE = 1.6; // seconds after the last hit before the boss damage counter fades
const GHOST_DEDUPE = 0.4; // s: 'player:perfectDodge' + 'player:ghostep' for the same blink

export class Hud {
  constructor(game) {
    this.game = game;
    injectHudStyle();
    injectTechStyle();
    const host = document.getElementById('ui') ?? document.body;
    this.root = el('div', 'ab-root', null, host);
    this.root.dataset.state = game.state || 'title';
    this._warned = 0;
    this.proj = new ScreenProjector(game);

    this.tells = new TellEdges(game, this.root, this.proj);
    this._buildPlayerFrame();
    this.map = new Minimap(game, this.root);
    this.logPanel = new LogPanel(game, this.root);
    this._buildBossBar();
    this.promptEl = el('div', 'ab-prompt ab-panel', null, this.root);
    this._prompt = null;
    this.tags = new NameTags(game, this.root);
    this.calls = new Callouts(game, this.root, this.proj);
    this.bannerUi = new Banner(this.root);
    this.statsUi = new StatsPanel(this.root);
    this.rewardUi = new RewardCard(game, this.root);
    this.help = new HelpPanel(this.root);
    const hint = el('div', 'ab-hint ab-play kb-only', null, this.root);
    fillKeyText(hint, '[H] help  [Esc] pause');
    // the stage picker: game.levels / game.pickLevel (main.js; levels/index.js)
    const stage = Array.isArray(game.levels) ? { levels: game.levels, current: game.level?.id, pick: (id) => game.pickLevel?.(id) } : null;
    this.titleUi = new TitleScreen(this.root, (game.state || 'title') === 'title', stage);
    this.pauseUi = new PauseMenu(game, this.root);
    this.feed = new CombatFeed(game, this);
    this._ghostAt = -10;

    const ev = game.events;
    const on = (name, fn) => ev?.on(name, (d) => fn(d && typeof d === 'object' ? d : {}));
    on('state', (e) => {
      this.root.dataset.state = e.to ?? game.state ?? '';
      if (e.to === 'title' || e.to === 'dead' || (e.to === 'explore' && e.from !== 'paused')) this.calls.clear();
    });
    on('game:retry', () => this.calls.clear());
    on('dragon:phase2', () => {
      if (this.bossOn) this.bossEl.classList.add('p2');
    });
    on('player:noFlask', () => flashClass(this.pipsEl));

    // posture
    on('dragon:posture', (d) => {
      const max = num(d.max, 0);
      if (max > 0) this.postBar.set(num(d.posture, 0) / max);
    });
    on('dragon:postureBreak', () => {
      this.brokenT = POSTURE.breakTime;
      flashClass(this.postBar.root, 'break');
      this.calls.banner('POSTURE BROKEN', `critical hits ×${POSTURE.breakCritMult}`);
    });

    // call-outs + damage numbers (a blow turned by a technique's stance into its counter calls the
    // technique's name instead of PARRY)
    on('player:parry', (d) => {
      if (d.technique && !d.light) return;
      this.calls.call(d.light && d.perfect ? 'ret' : d.tell === 'blue' ? 'deflect' : 'parry');
    });
    on('player:technique', (d) => {
      const T = getTechnique(d.id);
      if (T && d.phase === 'counter') this.calls.call('tech', T.short);
    });
    // a returned bullet landing on the wyrm: its damage at the head, like a heavy hit's number
    on('dragon:returned', (d) => this.calls.number(d.damage, d, { heavy: true }));
    on('player:block', () => this.calls.call('block'));
    on('player:guardBreak', () => this.calls.call('gbreak'));
    on('player:perfectDodge', () => this._ghostep());
    on('player:ghostep', () => this._ghostep());
    on('player:hitDragon', (d) => this.calls.number(d.damage, d.point, { crit: !!d.crit, heavy: !!d.heavy }));

    this._steps = [
      (dt) => this._updatePlayer(dt),
      (dt) => this._updateBoss(dt),
      (dt) => this.tags.update(dt),
      (dt) => this.tells.update(dt),
      (dt) => this.calls.update(dt),
      (dt) => this.map.update(dt),
      (dt) => this.bannerUi.update(dt),
      (dt) => this.rewardUi.update(dt),
      (dt) => this.titleUi.update(dt),
      () => this.pauseUi.refresh(),
      (dt) => this.feed.flush(dt),
    ];
  }

  // ---------------------------------------------------------------- build
  _buildPlayerFrame() {
    const pf = el('div', 'ab-pf ab-panel ab-play', null, this.root);
    const head = el('div', 'ab-pf-head', null, pf);
    this.nameEl = el('span', 'ab-pf-name', String(this.game.player?.name || 'Wanderer').toUpperCase(), head);
    el('span', 'ab-pf-lv', 'Lv 12', head);
    el('div', 'ab-pf-sub', 'Swordsman  ·  Tattered Shroud', pf);

    const hpRow = el('div', 'ab-row', null, pf);
    el('span', 'lbl', 'HP', hpRow);
    this.hpBar = new DelayedBar(hpRow, 'hp', { hold: 0.6, drain: 2.4, rise: 6 });
    this.hpVal = el('span', 'val', '', hpRow);
    // the Qi meter + the technique slots (ui/techniques.js; hidden until a technique is equipped)
    this.qiRow = new QiRow(this.game, pf);

    // crit window cue (after a Ghostep): glowing cyan label + a bar that shrinks to zero
    this.critRow = el('div', 'ab-row ab-crit', null, pf);
    el('span', 'clbl', `CRIT ×${DEFENSE.ghostep.critMult}`, this.critRow);
    const cb = el('div', 'ab-bar crit', null, this.critRow);
    this.critFill = el('div', 'fill', null, cb);

    const foot = el('div', 'ab-pf-foot', null, pf);
    const fl = el('span', '', null, foot);
    this.pipsEl = el('span', 'ab-pips', null, fl);
    this.pipFull = el('span', 'full', '', this.pipsEl);
    this.pipEmpty = el('span', 'empty', '', this.pipsEl);
    fillKeyText(el('span', '', null, fl), ' [F]');
    this.lockEl = el('span', 'ab-lock', '◎ LOCKED ON', foot);

    this._hp = null;
    this._fl = null;
    this._lock = null;
    this._low = null;
    this._name = null;
    this._critOn = false;
    this._critW = -1;
    this.critMax = DEFENSE.ghostep.critWindow;
  }

  _buildBossBar() {
    this.bossEl = el('div', 'ab-boss', null, this.root);
    const head = el('div', 'ab-boss-head', null, this.bossEl);
    this.bossName = el('span', 'ab-boss-name', '', head);
    this.bossDmg = el('span', 'ab-boss-dmg', '', head);
    this.bossBar = new DelayedBar(this.bossEl, 'boss', { hold: 0.6, drain: 1.8, rise: 2.2 });
    // the phase gates (dragon.phaseAt, e.g. 66 % / 33 %): thin ticks where the next phase starts
    const marks = this.game?.dragon?.phaseAt;
    for (const f of Array.isArray(marks) ? marks.slice(1) : []) {
      if (!(f > 0 && f < 1)) continue;
      el('div', 'tick', null, this.bossBar.root).style.left = `${(f * 100).toFixed(1)}%`;
    }
    const post = el('div', 'ab-boss-post', null, this.bossEl);
    this.postBar = new PostureBar(post);
    this.brokenEl = el('span', 'ab-broken', 'BROKEN', post);
    this.bossOn = false;
    this.bossHpLast = 0;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this.brokenT = 0;
    this._broken = false;
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
    const pmax = num(d?.maxPosture, 0);
    this.postBar.snap(pmax > 0 ? num(d?.posture, 0) / pmax : 0);
    this.brokenT = 0;
    this.bossHpLast = hp;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this._setDmgShown(false);
    this._p2 = d?.phase >= 2;
    this._p3 = d?.phase >= 3;
    this.bossEl.classList.toggle('p2', this._p2);
    this.bossEl.classList.toggle('p3', this._p3);
    this.bossOn = true;
    this.bossEl.classList.add('on');
  }

  hideBossBar() {
    this.bossOn = false;
    this.bossEl.classList.remove('on');
    this._setDmgShown(false);
    this.brokenT = 0;
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

  /** The prompt shown now (raw text with "[E]" key tokens), or null. Touch controls make it tappable. */
  get promptText() {
    return this._prompt;
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

  _ghostep() {
    const now = num(this.game.realTime);
    if (now - this._ghostAt < GHOST_DEDUPE) return;
    this._ghostAt = now;
    this.calls.call('ghostep');
    this.tells.ghost(0.6);
  }

  _updatePlayer(dt) {
    const p = this.game.player;
    if (p) {
      const name = String(p.name || 'Wanderer');
      if (name !== this._name) {
        this._name = name;
        this.nameEl.textContent = name.toUpperCase();
      }
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

      // crit window: the bar shrinks from the window length (or the longest seen) to zero
      const ct = Math.max(0, num(p.critTimer, 0));
      const critOn = ct > 0 && p.alive !== false;
      if (critOn !== this._critOn) {
        this._critOn = critOn;
        this.critRow.classList.toggle('on', critOn);
        if (critOn) this.critMax = DEFENSE.ghostep.critWindow;
      }
      if (critOn) {
        this.critMax = Math.max(this.critMax, ct);
        const w = Math.min(1, ct / Math.max(0.05, this.critMax));
        if (Math.abs(w - this._critW) > 0.004) {
          this._critW = w;
          this.critFill.style.transform = `scaleX(${w.toFixed(3)})`;
        }
      }
    }
    this.hpBar.update(dt);
    this.qiRow.update(dt);
  }

  _updateBoss(dt) {
    const d = this.game.dragon;
    if (this.bossOn && d) {
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
      // posture is polled too (authoritative); 'dragon:posture' only makes rises instant
      const pmax = num(d.maxPosture, 0);
      if (pmax > 0 && Number.isFinite(d.posture)) this.postBar.set(d.posture / pmax);
      const p2 = d.phase >= 2, p3 = d.phase >= 3;
      if (p2 !== this._p2) {
        this._p2 = p2;
        this.bossEl.classList.toggle('p2', p2);
      }
      if (p3 !== this._p3) {
        this._p3 = p3;
        this.bossEl.classList.toggle('p3', p3);
      }
    }
    if (this.dmgT > 0) {
      this.dmgT -= dt;
      if (this.dmgT <= 0) this._setDmgShown(false);
    }
    // BROKEN while the dragon says so; the event timer covers a dragon without the flag
    if (this.brokenT > 0) this.brokenT -= dt;
    const broken = this.bossOn && (typeof d?.broken === 'boolean' ? d.broken || this.brokenT > POSTURE.breakTime - 0.3 : this.brokenT > 0);
    if (broken !== this._broken) {
      this._broken = broken;
      this.bossEl.classList.toggle('broken', broken);
    }
    this.bossBar.update(dt);
    this.postBar.update(dt);
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
