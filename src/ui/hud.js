import { DEFENSE, GUARD, POSTURE } from '../combat/rules.js';
import { streakK, streakTier } from '../combat/streak.js';
import { GlyphBar, GlyphPosture } from './glyphBar.js';
import { Banner } from './banner.js';
import { Callouts } from './callouts.js';
import { el, fillKeyText, flashClass, num, relabelChips, safeDt, setChipSource } from './dom.js';
import { CombatFeed } from './feed.js';
import { injectHudStyle } from './hudStyle.js';
import { LogPanel } from './logPanel.js';
import { Minimap } from './minimap.js';
import { NameTags } from './nameTags.js';
import { ScreenProjector } from './project.js';
import { ChangelogPanel } from './changelogPanel.js';
import { RemapPanel } from './remap.js';
import { HelpPanel, PauseMenu, StatsPanel, TitleScreen } from './screens.js';
import { gradeLookNow } from './recordLooks.js';
import { TellEdges } from './tells.js';
import { StreakCounter } from './streakCounter.js';
import { lookOf } from '../entities/enemies/duelist/lookSwitch.js';

// HUD (ADR-098): an ASCII overlay drawn straight on the game, with no panels in play: the player's
// rows (HP, guard, crit, streak, flasks) and the boss's name and bars are text meters
// (ui/glyphBar.js), the big words are block letters (ui/blockText.js), the minimap a small faint
// disc; plus the tabbed log (desktop), name tags and the boss bar
// (HP + posture), screen-edge cues (red flash on a dodge-only tell's timing cue, cyan Ghostep pulse;
// the tells themselves are shown in the world, never as HUD text), call-outs (PARRY, GHOSTEP,
// GUARD BROKEN, damage numbers), the streak of perfect dodges (a row of pips under the HP bar, the
// flurry's cut counter over its target and the banner that names it), banners, title and pause
// screens. Pure DOM under #ui;
// update(realDt) only writes to the DOM when a shown value changes. Screen-grade uniforms are
// driven by GameFlow (src/game/grade.js).

const DMG_FADE = 1.6; // seconds after the last hit before the boss damage counter fades
// The top row shares one line: the hero's meters on the left, the boss's in the middle, the corner
// buttons and the minimap on the right. _fit() gives each what the screen has (ADR-131).
const FIT = {
  hp: 24, // cells of the hero's HP / guard meters ...
  hpCompact: 16, // ... and on a touch screen too narrow for that (a phone, a tablet held upright)
  compactBelow: 900, // px of width
  boss: 48, // the boss's HP meter at its full length ...
  bossMin: 18, // ... and the shortest it is ever cut to
  centred: 36, // with this many cells or more the boss's rows stay on the screen's middle
  post: 2 / 3, // the posture run against the HP meter
  gap: 12, // px kept clear on each side of the boss's rows
  glyph: 0.6, // a letter's advance against its font size (the widest of the HUD's font stack)
};
const GHOST_DEDUPE = 0.4; // s: 'player:perfectDodge' + 'player:ghostep' for the same blink
// a flurry's name by its blows (player:flurryEnd; one blow has none: it is just its art)
const FLURRY_NAMES = ['', '', 'TWIN FLASH', 'TRIPLE FLASH', 'FOURFOLD FLASH', 'FIVEFOLD FLASH', 'SIXFOLD FLASH', 'SEVENFOLD FLASH'];
// the streak pass's 'tiers': a full flurry struck from a longer streak is named by the streak's tier
// (combat/streak.js streakTier; tier 3 is SEVENFOLD itself), and its banner takes a rule more
export const FLURRY_TIER_NAMES = Object.freeze({ 4: 'HUNDREDFOLD FLASH', 5: 'THOUSANDFOLD FLASH' });

export class Hud {
  constructor(game) {
    this.game = game;
    injectHudStyle();
    // key chips ("[@dodge]") read the bindings and the device in use (ui/dom.js); relabel on a remap
    setChipSource({ bindings: game.input?.bindings ?? null, padActive: () => !!game.gamepad?.active, layout: () => game.gamepad?.layout ?? 'xbox' });
    game.input?.bindings?.onChange?.(() => relabelChips());
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
    // the streak counter beside the hero (the streak pass's 'counter'): in the call-outs' layer
    this.streakUi = new StreakCounter(game, this.calls.layer, this.proj);
    this._flurryStreak = 0;
    // the flurry's screen cuts: a line of light across the whole frame on every cut, two crossing
    // on the last blow
    this.slashes = [el('div', 'ab-slash', null, this.root), el('div', 'ab-slash', null, this.root)];
    this.bannerUi = new Banner(this.root);
    this.statsUi = new StatsPanel(this.root, gradeLookNow());
    this.help = new HelpPanel(this.root);
    const hint = el('div', 'ab-hint ab-play ab-nontouch', null, this.root);
    fillKeyText(hint, '[@help] help  [@pause] pause');
    // the stage picker: game.levels / game.pickLevel (main.js; levels/index.js)
    // (begin: the new title layouts' BEGIN button, ?menu=; ui/titleMenu.js)
    const stage = Array.isArray(game.levels) ? { levels: game.levels, current: game.level?.id, pick: (id) => game.pickLevel?.(id), begin: () => game.flow?.beginFromTitle?.() } : null;
    // WHAT'S NEW (ui/changelogPanel.js): opened from the title and the pause menu, both show its badge
    this.newsUi = new ChangelogPanel(game, this.root);
    // each level's best and the BOSS RUSH entry (game/recorder.js; ADR-179): read through the flow's
    // recorder once it exists (the HUD is built first), else straight from game.records
    const bestOf = (id) => {
      const R = game.flow?.recorder;
      if (R) return R.bestFor(id);
      const b = id === 'rush' ? game.records?.rushBest?.() : game.records?.best?.(id);
      return b?.bestGrade ? { grade: b.bestGrade.grade, marks: b.bestGrade.marks ?? [], timeMs: b.bestTime?.timeMs ?? b.bestGrade.timeMs, clears: b.clears } : null;
    };
    const records = { bestFor: bestOf, startRush: () => game.startRush?.() ?? game.flow?.recorder?.startRush?.() };
    // (a boss rush page skips the title: game/rush.js)
    const titleOn = (game.state || 'title') === 'title' && !game.rush?.active;
    this.titleUi = new TitleScreen(this.root, titleOn, stage, this.newsUi, records);
    this.pauseUi = new PauseMenu(game, this.root, this.newsUi);
    this.remapUi = new RemapPanel(game, this.root);
    this.feed = new CombatFeed(game, this);
    this._ghostAt = -10;

    const ev = game.events;
    const on = (name, fn) => ev?.on(name, (d) => fn(d && typeof d === 'object' ? d : {}));
    on('state', (e) => {
      this.root.dataset.state = e.to ?? game.state ?? '';
      if (e.to === 'title' || e.to === 'dead' || (e.to === 'explore' && e.from !== 'paused')) {
        this.calls.clear();
        this.streakUi.clear();
      }
    });
    // a run record was stored (game/recorder.js): the title's bests follow
    on('game:record', () => this.titleUi.refreshRecords?.());
    on('game:retry', () => {
      this.calls.clear();
      this.streakUi.clear();
    });
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

    // call-outs + damage numbers
    on('player:parry', (d) => this.calls.call(d.light && d.perfect ? 'ret' : 'parry')); // (one word for every parry, a blue one too: ADR-294)
    // a returned bullet landing on the wyrm: its damage at the head, like a heavy hit's number
    on('dragon:returned', (d) => this.calls.number(d.damage, d, { heavy: true }));
    // (Bai Wuji: a cut stopped on his barrier that still chipped him, where the blade stopped)
    on('dragon:barrier', (d) => {
      if (d?.state === 'stop' && d.damage > 0 && Number.isFinite(d.x + d.y + d.z)) this.calls.number(d.damage, d, {});
    });
    on('player:block', () => this.calls.call('block'));
    on('player:guardBreak', () => this.calls.call('gbreak'));
    on('player:guardOpen', () => {
      this.calls.call('gopen');
      flashClass(this.guardBar.root, 'open');
    });
    on('player:perfectDodge', (d) => this._ghostep(d.streak));
    on('player:ghostep', () => this._ghostep(this.game.player?.streak));
    // the flurry: a count over the target for every cut that lands, and its name once the last has
    on('player:flurry', (d) => {
      this._flurryStreak = Math.round(num(this.game.player?.streak, 0));
      if (d.art === 'riposte') this.calls.riposte(d.strikes);
    });
    // a foe's streak of guards (a duelist): pips beside his name; lit when his flurry may come
    on('dragon:streak', (d) => {
      const n = Math.max(0, Math.min(DEFENSE.foeStreak.max, Math.round(num(d.count))));
      this.bossStreak.textContent = '◆'.repeat(n);
      this.bossStreak.classList.toggle('on', n > 0);
      this.bossStreak.classList.toggle('ready', n >= DEFENSE.foeStreak.min);
    });
    on('player:flurryHit', (d) => {
      const last = !!d.last, n = Math.round(num(d.n));
      if (num(d.of) >= 2 || last) {
        const A = this.slashes[0], a = ((n * 67) % 150) - 75;
        A.style.setProperty?.('--a', `${a}deg`);
        A.classList.toggle('big', last);
        flashClass(A, 'go');
        if (last && num(d.of) >= 2) {
          const B = this.slashes[1];
          B.style.setProperty?.('--a', `${a + 62}deg`);
          B.classList.add('big');
          flashClass(B, 'go');
        }
      }
    });
    on('player:flurryHit', (d) => {
      if (num(d.of) >= 2 && !d.planted) this.calls.count(d.n, this.game.player?.flurry?.T); // (a planted answer has no flurry target)
    });
    on('player:flurryEnd', (d) => {
      // the deathblow (?parryRiposte=deathblow): its own banner and its damage, whatever the run
      if (d.art === 'deathblow') {
        this.calls.banner(`DEATHBLOW ×${Math.round(num(d.strikes, 1))}`, `${Math.round(num(d.damage))} damage`);
        return;
      }
      const n = Math.round(num(d.strikes));
      if (n < 2) return;
      // a full flurry from a long streak: the tier's name and a rule more (the streak pass's 'tiers')
      const tier = n >= DEFENSE.flurry.max && streakK('tiers') > 0 ? streakTier(this._flurryStreak) : 0;
      const name = FLURRY_TIER_NAMES[tier] ?? FLURRY_NAMES[n] ?? `${n}-FOLD FLASH`;
      this.calls.banner(name, `${d.label ? `${d.label} · ` : ''}${Math.round(num(d.damage))} damage`, tier >= 4 ? tier : 0);
    });
    on('player:streak', (d) => {
      if (num(d.lost) >= 2) flashClass(this.streakRow, 'lost');
    });
    on('player:hitDragon', (d) => this.calls.number(d.damage, d.point, { crit: !!d.crit, heavy: !!d.heavy }));

    this._steps = [
      () => this._fit(),
      (dt) => this._updatePlayer(dt),
      (dt) => this._updateBoss(dt),
      (dt) => this.tags.update(dt),
      (dt) => this.tells.update(dt),
      (dt) => this.calls.update(dt),
      (dt) => this.streakUi.update(dt),
      (dt) => this.map.update(dt),
      (dt) => this.bannerUi.update(dt),
      (dt) => this.titleUi.update(dt),
      () => this.pauseUi.refresh(),
      (dt) => this.feed.flush(dt),
    ];
  }

  // ---------------------------------------------------------------- build
  _buildPlayerFrame() {
    // The player's rows (ADR-098): no panel, no name plate; every meter is a row of characters
    // (ui/glyphBar.js) drawn straight on the game.
    const pf = el('div', 'ab-pf ab-play', null, this.root);
    this.pfEl = pf;
    this.compact = false;
    this._fitKey = '';
    // the hero's name by his meters, as the boss's sits by its bar (?heroName=a|b|off; off until the
    // owner picks): a, a quiet line above the HP row; b, at the head of the flask row under the meters
    const heroName = lookOf('heroName', 'off');
    if (heroName === 'a') el('div', 'ab-hero-name', 'gcd', pf);
    const hpRow = el('div', 'ab-row', null, pf);
    el('span', 'lbl', 'HP', hpRow);
    this.hpBar = new GlyphBar(hpRow, 'hp', { cells: 24, hold: 0.6, drain: 2.4, rise: 6 });
    this.hpVal = el('span', 'val', '', hpRow);

    // the guard meter (GUARD, ADR-095): steel '=' under the HP row; no number, it only has to be glanced at
    const gdRow = el('div', 'ab-row ab-guard', null, pf);
    el('span', 'lbl', 'GD', gdRow);
    this.guardBar = new GlyphBar(gdRow, 'guard', { cells: 24, hold: 0.25, drain: 5, rise: 30, full: '=', lost: '-' });
    this._gLow = null;

    // crit window cue (after a Ghostep): a glowing cyan label + a run of '>' that shrinks to nothing
    this.critRow = el('div', 'ab-row ab-crit', null, pf);
    el('span', 'clbl', `CRIT ×${DEFENSE.ghostep.critMult}`, this.critRow);
    this.critBar = new GlyphBar(this.critRow, 'crit', { cells: 16, full: '>', lost: '>' });

    // the streak of perfect dodges (DEFENSE.flurry): a pip for every blow the next one is answered
    // with; past the most a flurry strikes, only the count climbs
    this.streakRow = el('div', 'ab-row ab-streak', null, pf);
    el('span', 'slbl', 'STREAK', this.streakRow);
    const sp = el('span', 'spips', null, this.streakRow);
    this.streakFull = el('span', 'full', '', sp);
    this.streakEmpty = el('span', 'empty', '', sp);
    this.streakVal = el('span', 'sval', '', this.streakRow);
    this._streak = 0;

    const foot = el('div', 'ab-pf-foot', null, pf);
    if (heroName === 'b') el('span', 'ab-hero-name inl', 'gcd', foot);
    const fl = el('span', '', null, foot);
    this.pipsEl = el('span', 'ab-pips', null, fl);
    this.pipFull = el('span', 'full', '', this.pipsEl);
    this.pipEmpty = el('span', 'empty', '', this.pipsEl);
    fillKeyText(el('span', 'ab-nontouch', null, fl), ' [@flask]'); // (a phone has the FLASK button)
    this.lockEl = el('span', 'ab-lock', '◎ LOCKED ON', foot);

    this._hp = null;
    this._fl = null;
    this._lock = null;
    this._low = null;
    this._critOn = false;
    this._critW = -1;
    this.critMax = DEFENSE.ghostep.critWindow;
  }

  _buildBossBar() {
    this.bossEl = el('div', 'ab-boss', null, this.root);
    const head = el('div', 'ab-boss-head', null, this.bossEl);
    this.bossName = el('span', 'ab-boss-name', '', head);
    // a boss with several bars (dragon.lives = { total, left }: the Starless Lord's blade forms): one
    // pip per bar, the spent ones hollow
    this.lifeEls = [];
    this._lives = -1;
    const lives = this.game?.dragon?.lives;
    if (lives && lives.total > 1) {
      const row = el('span', 'ab-boss-lives', null, head);
      for (let i = 0; i < lives.total; i++) this.lifeEls.push(el('i', 'life', null, row));
    }
    this.bossStreak = el('span', 'ab-boss-streak', '', head);
    this.bossDmg = el('span', 'ab-boss-dmg', '', head);
    this.bossBar = new GlyphBar(el('div', 'ab-boss-bar', null, this.bossEl), 'boss', { cells: 48, hold: 0.6, drain: 1.8, rise: 2.2 });
    // the phase gates (dragon.phaseAt, e.g. 66 % / 33 %): a '|' over the bar where the next phase starts
    const marks = this.game?.dragon?.phaseAt;
    for (const f of Array.isArray(marks) ? marks.slice(1) : []) {
      if (f > 0 && f < 1) this.bossBar.mark(f);
    }
    const post = el('div', 'ab-boss-post', null, this.bossEl);
    this.postBar = new GlyphPosture(post, { cells: 32 });
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

  /** Small lines under the banner's hint (the death screen's recap); null clears them. */
  bannerRecap(lines) {
    this.bannerUi.recap(lines);
  }

  clearBanner(instant = false) {
    this.bannerUi.clear(instant);
  }

  /** The prompt shown now (raw text with "[@interact]" key tokens), or null. Touch controls make it tappable. */
  get promptText() {
    return this._prompt;
  }

  prompt(text) {
    const t = text ? String(text) : null;
    if (t === this._prompt) return;
    this._prompt = t;
    if (t) fillKeyText(this.promptEl, t); // "[@interact]" shows the bound key / pad button
    this.promptEl.classList.toggle('on', !!t);
  }

  showTitle() {
    this.titleUi.show();
  }

  hideTitle() {
    this.titleUi.hide();
  }

  showPause(on) {
    if (!on) {
      this.remapUi.close();
      this.newsUi.close();
    }
    this.pauseUi.show(on);
  }

  toggleHelp(force) {
    return this.help.toggle(force);
  }

  /** Victory record rows [[label, value], ...]; null hides. head (optional): the run's grade, marks,
   *  time and bests (GameFlow._recordHead; ui/recordLooks.js gradeHead). */
  showStats(rows, head = null) {
    this.statsUi.show(rows, head);
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

  /**
   * Fit the top row to the screen (ADR-131). On a narrow touch screen the hero's meters are cut to
   * FIT.hpCompact cells and show the HP number alone; the boss's meter takes what is left between
   * the hero's rows and the corner buttons (never past FIT.boss cells), on the screen's middle while
   * that leaves it FIT.centred cells, in the middle of the free stretch otherwise. Runs when the
   * window, the touch layer or the boss's name changes; reads the layout where there is one.
   */
  _fit() {
    const w = num(globalThis.innerWidth, 0), h = num(globalThis.innerHeight, 0);
    const touch = !!this.game.touch?.active;
    const name = this.bossName.textContent ?? '';
    const key = `${w}x${h}${touch ? 't' : ''}${name.length}${this.lifeEls.length}`;
    if (key === this._fitKey) return;
    this._fitKey = key;
    if (!(w > 0 && h > 0)) return;
    const short = Math.min(w, h) <= 560; // (the stylesheet's phone rules: max-height / max-width 560px)
    const compact = touch && (short || w < FIT.compactBelow);
    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle('ab-compact', compact);
      this.hpBar.resize(compact ? FIT.hpCompact : FIT.hp);
      this.guardBar.resize(compact ? FIT.hpCompact : FIT.hp);
      this._hp = null; // (the number is written again, short or whole)
    }
    const rect = (e) => {
      try {
        const r = e?.getBoundingClientRect?.();
        return r && r.width > 0 && Number.isFinite(r.left + r.right) ? r : null;
      } catch {
        return null;
      }
    };
    const px = (e, d) => {
      try {
        const v = parseFloat(globalThis.getComputedStyle?.(e)?.fontSize);
        return v > 0 ? v : d;
      } catch {
        return d;
      }
    };
    // held upright, a phone has the boss's rows on a line of their own, under the hero's
    const stacked = touch && w <= 560 && h > w;
    const pfFont = px(this.pfEl, touch && short ? 10 : 13), bossFont = px(this.bossEl, touch && short ? 10 : Math.min(15, Math.max(10, w * 0.0115)));
    let left = 8, right = w - 8;
    if (!stacked) {
      // the hero's rows: label, meter in its brackets, number
      const pr = rect(this.pfEl), cells = this.hpBar.cells;
      const pfLeft = pr ? pr.left : touch && short ? 8 : 14;
      left = Math.max(pr ? pr.right : 0, pfLeft + (2 + 1 + cells + 2 + 1 + (compact ? 4 : 9)) * pfFont * FIT.glyph);
      // the corner: LOCK (the leftmost of the touch buttons), else the minimap
      const cr = rect(touch ? this.game.touch?.btn?.lock?.el : null) ?? rect(this.map?.root);
      right = cr ? cr.left : w - (touch ? (short ? 136 : 180) : 84);
    }
    const ch = bossFont * FIT.glyph;
    const fits = (width) => Math.floor(width / ch) - 2;
    const side = Math.max(left, w - right) + FIT.gap;
    let cells = fits(w - side * 2), mid = null;
    if (cells < FIT.centred) {
      const free = fits(right - left - FIT.gap * 2);
      if (free > cells) {
        cells = free;
        mid = (left + right) / 2;
      }
    }
    cells = Math.max(FIT.bossMin, Math.min(FIT.boss, cells));
    const room = mid === null ? w - side * 2 : right - left - FIT.gap * 2;
    this.bossBar.resize(cells);
    this.postBar.resize(Math.max(8, Math.round((cells * FIT.post) / 2) * 2));
    if (this.bossEl.style) this.bossEl.style.left = mid === null ? '' : `${mid.toFixed(1)}px`;
    // a long name with its pips: closer letters before it runs under a neighbour
    const lead = 0.86 * bossFont * (FIT.glyph + 0.3);
    this.bossEl.classList.toggle('tight', name.length * lead + this.lifeEls.length * 14 + 40 > room);
    this.fit = { compact, stacked, cells, left, right, mid };
  }

  _ghostep(streak) {
    const now = num(this.game.realTime);
    if (now - this._ghostAt < GHOST_DEDUPE) return;
    this._ghostAt = now;
    this.calls.ghostep(streak);
    this.tells.ghost(0.6);
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
        // (the short row has room for the number alone)
        this.hpVal.textContent = this.compact ? `${Math.ceil(hp)}` : `${Math.ceil(hp)} / ${Math.round(maxHp)}`;
      }
      const low = hp > 0 && hp / maxHp < 0.25;
      if (low !== this._low) {
        this._low = low;
        this.hpBar.root.classList.toggle('low', low);
      }

      // the guard meter
      const gMax = Math.max(1, num(p.maxGuard, GUARD.max));
      const gd = Math.min(1, Math.max(0, num(p.guard, gMax) / gMax));
      this.guardBar.set(gd);
      const gLow = gd < GUARD.low;
      if (gLow !== this._gLow) {
        this._gLow = gLow;
        this.guardBar.root.classList.toggle('low', gLow);
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

      // the streak of perfect dodges
      const st = Math.max(0, Math.round(num(p.streak, 0)));
      if (st !== this._streak) {
        const up = st > this._streak;
        this._streak = st;
        const max = DEFENSE.flurry.max, f2 = Math.min(st, max);
        this.streakRow.classList.toggle('on', st > 0);
        this.streakRow.classList.toggle('hot', st >= max);
        if (st > 0) {
          this.streakFull.textContent = '◆'.repeat(f2);
          this.streakEmpty.textContent = '◇'.repeat(max - f2);
          this.streakVal.textContent = `×${st}`;
          if (up) flashClass(this.streakRow, 'up');
        }
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
          this.critBar.snap(w);
        }
      }
    }
    this.hpBar.update(dt);
    this.guardBar.update(dt);
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
      if (this.lifeEls.length) {
        const left = num(d.lives?.left, this.lifeEls.length);
        if (left !== this._lives) {
          // a bar refilled for the next form is a new bar, not healing: no slow rise
          if (this._lives >= 0 && left < this._lives) this.bossBar.snap(hp / max);
          this._lives = left;
          this.lifeEls.forEach((e, i) => e.classList.toggle('gone', i >= left));
        }
      }
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
