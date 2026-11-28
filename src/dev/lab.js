import { CONFIG } from '../core/config.js';
import { DEFENSE, TELL, PARRY_KIND, setParryKind } from '../combat/rules.js';
import { ARTS } from '../entities/player/flurry.js';
import { el, setText, setClass, button, slider, section } from './labDom.js';
import { injectLabStyle } from './labStyle.js';
import { HitboxOverlay } from './hitboxOverlay.js';
import { TimingTrainer, tellName } from './timingTrainer.js';
import { ModelViewer, VIEW_ANGLES, VIEW_LOOKS } from './modelView.js';
import { Training } from './training.js';
import { WYRM_FACES, wyrmFace } from '../entities/dragon/heads.js';
import { WYRM_TOPS, wyrmTop } from '../entities/dragon/faces.js';
import { WYRM_LOOKS, wyrmLookId } from '../entities/dragon/looks.js';
import { TrainingPanel } from './trainingPanel.js';
import { setCutStyle, cutStyle } from '../combat/cutFx.js';
import { IMPACT } from '../combat/impact.js';
import { STREAK_FX, setPerfectMode, perfectMode } from '../combat/streak.js';
import { RIP_MODES, ripMode, setRipMode } from '../entities/player/timeRip.js';
import { DB_FX, getDbFx, setDbFx } from '../combat/deathblowFx.js';
import { DB_READ, dbReadMode, setDbRead, DB_LOCK, dbLockMode, setDbLock } from '../entities/player/deathblow.js';
import { STRIKE_GAP, strikeGapMode, setStrikeGap } from '../entities/enemies/duelist/strikeGap.js';
import { PARRY_CLASH, parryClashMode, setParryClash } from '../combat/perfectFx.js';
import { BLUE_TELL_LOOK, blueTellMode, setBlueTell } from '../entities/enemies/duelist/fx.js';
import { DB_MATRIX, getDbMatrix, setDbMatrix } from '../combat/deathblowMatrix.js';
import { BLACK, getBlack, setBlack } from '../combat/blackout.js';
import { RED_TRAIL, getRedTrail, setRedTrail } from '../combat/redTrail.js';
import { BLACK_IMPACT, getBlackImpact, setBlackImpact } from '../combat/blackImpact.js';
import { DB_SFX, getDbSfx, setDbSfx } from '../audio/deathblowSfx.js';
import { PARRY_FX, parryFxMode, setParryFx, parryGrowMode, setParryGrow } from '../combat/parrySparks.js';
import { RIPOSTE_CUT, riposteMode, setRiposteMode } from '../entities/player/riposteCut.js';
import { BURST_LOOK, setBurst, burstLevel } from '../entities/player/flurryBurst.js';
import { CALM_LOOK, setCalm, calmLevel } from '../combat/impactCalm.js';
import { sfxMode, setSfxMode, chainMode, setChainMode, CHAIN_MODES } from '../audio/samples.js';
import { PARRY_CHAIN } from '../audio/parryChain.js';
import { SWORD_PARAM } from '../entities/player/gear/index.js';
import { MYSTIC_IDS, MYSTIC_NAMES, mysticMode, setMystic } from '../entities/player/swordMystic.js';
import { SLASH_IDS, slashMode, setSlash } from '../entities/player/slashFx.js';
import { OFFHAND_IDS, offHandMode, setOffHand } from '../entities/player/offHand.js';
import { FEEL_IDS, feelMode, setFeel } from '../entities/player/feel.js';
import { COMBO_IDS, COMBOS, comboMode, setCombo } from '../entities/player/combos.js';
import { COUNTER_IDS, counterMode, setCounterMode } from '../combat/flashChain.js';
import { CONTACT_IDS, contactMode, setContactMode } from '../combat/contact.js';
import { PLACE_IDS, placeMode, setPlace, BEAT_IDS, beatMode, setBeat } from '../entities/player/slashFx.js';
import { IDLES_IDS, IDLES_NAMES, idlesMode, setIdles, EASE_RESTS, FIGHT_RESTS, EASE_HABITS, EASE_TRICKS, EASE_REF_EXTRA, FIGHT_ACTS, syncStandArm } from '../entities/player/idles.js';
import { GUARD_IDS, GUARD_NAMES, guardMode, setGuard, HOLD_IDS, HOLD_NAMES, holdMode, setHold } from '../entities/player/refStance.js';
import { CLASH_IDS, clashMode, setClashMode } from '../combat/clashDance.js';
import { RUN_ARM_IDS, RUN_ARM_NAMES, runArmMode, setRunArm } from '../entities/player/runArms.js';
import { RUN_SWORD_IDS, RUN_SWORD_NAMES, runSwordMode, setRunSword } from '../entities/player/runSword.js';
import { HAND_LOOK_IDS, HAND_LOOK_NAMES, handLook } from '../entities/player/gear/handLook.js';
import { buildLooks } from './labLooks.js';
import { lookOf, setLook } from '../entities/enemies/duelist/lookSwitch.js';
import { LIFE, setLife, setLifeK } from '../world/life/lifeSwitch.js';

// The Lab — a debug panel to test the boss without playing the fight (contract: docs/ARCHITECTURE.md
// → Lab; usage: src/dev/README.md). It talks only to the actors' `debug` APIs (dragon.debug,
// player.debug, flow.debug) and writes only game.debugTimeScale, so any future enemy that implements
// the same `debug` shape plugs in. Every call is optional-chained: a missing API shows "n/a".
//
// Toggle: F1 or ` (backquote), the floating LAB button (top centre; phones have no F1), or load with
// ?lab. While open: 1-9 trigger abilities, [ ] step time.

const TIME_STEPS = [0, 0.1, 0.25, 0.5, 1, 2];
const STATES = ['explore', 'boss', 'dead', 'victory'];
// flow states where the fight can run (Loop only ticks in these)
const PLAY = new Set(['explore', 'bossIntro', 'boss']);
// flow states a forced fight action leaves alone: in 'explore' the flow follows the dragon into
// 'boss' by itself. From any other (title / paused / dead / victory / bossIntro) the Lab first jumps
// the flow to 'boss' so the HUD, music and arena are consistent with the fight it forces.
const FLOW_FOLLOWS = new Set(['explore', 'boss']);
const DRAGON_DOWN = new Set(['dying', 'dead']);
// keys the Lab consumes while open (kept from the game: digits / brackets would otherwise dismiss
// the title and death screens through the flow's "any key")
const LAB_KEY = /^(?:(?:Digit|Numpad)([1-9])|BracketLeft|BracketRight)$/;
const REFRESH = 1 / 12; // readout refresh period (real s)
const ABILITY_POLL = 1.0; // re-read debug.abilities() while open (real s)
const BADGE_POLL = 0.5; // closed-state badge check (real s)
const storeKey = 'gcd.lab.v1'; // (not an UPPER_CASE const: the glyph check reads those as glyph strings)
const BAR_CELLS = 30;
const BAR_SPAN = 0.9; // s before impact covered by the timing bar

const DEG = Math.PI / 180;

const finite = (v, f = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const show = (v) => (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? 'n/a' : String(v));
const fmtArg = (a) => (typeof a === 'number' ? String(+a.toFixed(3)) : typeof a === 'string' ? a : String(a));

function urlWantsLab() {
  try {
    const s = globalThis.location?.search;
    return typeof s === 'string' && new URLSearchParams(s).has('lab');
  } catch {
    return false;
  }
}

function loadPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(storeKey);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function phaseTag(p) {
  if (typeof p === 'number' && Number.isFinite(p) && p > 0) return `P${p}`;
  if (Array.isArray(p)) return `P${p.join('+')}`;
  if (typeof p === 'string' && p) return p.toUpperCase().slice(0, 5);
  return '';
}

export class Lab {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.root = null; // panel DOM, built on first open
    this.badge = null; // floating LAB toggle (+ "· god · x0.25" cheats while closed), built on demand
    this.ui = {};
    this.prefs = loadPrefs();
    if (!this.prefs.collapsed || typeof this.prefs.collapsed !== 'object') this.prefs.collapsed = {};
    this.hitboxes = !!this.prefs.hitboxes;
    this.overlay = null; // HitboxOverlay, built on first use
    this.selected = null; // ability name used by Loop
    this.loop = { on: false, every: Math.min(8, Math.max(2, finite(this.prefs.loopEvery, 4))), t: 0, count: 0, prevAI: null };
    this.trainer = new TimingTrainer(game);
    this.viewer = new ModelViewer(game, this);
    // Training (training.js): the catalogue of situations, one click each; its panel (trainingPanel.js)
    this.training = new Training(game);
    this.trainingPanel = new TrainingPanel(game, this);
    // model-view buttons' selection: mode 'view' (one angle) | 'spin' (turntable) | 'sheet' (every
    // angle in tiles); look = the hero's look-dev render (VIEW_LOOKS)
    this.mvPick = { target: 'hero', angle: 'front', dark: false, mode: 'view', look: 'ascii' };

    this._abilities = [];
    this._abButtons = [];
    this._abSig = '';
    this._abPollT = 0;
    this._refreshT = 0;
    this._badgeT = 0;
    this._badgeSig = null;
    this._trainerVer = -1;
    this._barSig = '';
    this._hadNext = false;
    this._postUpdated = false;
    this._errors = 0;

    this._onKey = (e) => {
      try {
        this._key(e);
      } catch (err) {
        console.error('[lab] key handler failed', err);
      }
    };
    // capture phase: runs before core/input's window listener, so consumed keys never reach the game
    if (typeof addEventListener === 'function') addEventListener('keydown', this._onKey, true);
    if (urlWantsLab()) this.setOpen(true);
  }

  // ---------------------------------------------------------------- public
  /**
   * The enemy under test. Today the only boss; when more enemies exist, select one here (every
   * Lab feature goes through this getter and the enemy's `debug` API — see src/dev/README.md).
   */
  get target() {
    return this.game.dragon ?? null;
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setOpen(on) {
    on = !!on;
    if (on && !this.root) this._build();
    if (on && !this.root) return; // no DOM (headless) or build failed
    this.open = on;
    setClass(this.root, 'lab-hidden', !on);
    this._applyOverlay();
    if (on) {
      this._refreshT = 0;
      this._abPollT = 0;
      this._trainerVer = -1;
      this._syncAbilities();
      this._refresh();
      this._mvSync();
    }
    this._syncBadge();
  }

  /** Force an ability by name (also selects it for Loop). Returns the debug API's answer, or null if n/a. */
  trigger(name) {
    if (typeof name !== 'string' || !name) return null;
    this.selected = name;
    this._markSelected();
    if (this.loop.on) this.loop.t = 0;
    this._prepareFlow();
    return this._force(name, false);
  }

  /** Trigger the i-th ability of debug.abilities() (number keys 1-9). */
  triggerIndex(i) {
    if (!this._abilities.length) this._syncAbilities();
    const a = this._abilities[i];
    return a ? this.trigger(a.name) : null;
  }

  setTimeScale(v) {
    const s = Math.max(0, Math.min(4, finite(v, 1)));
    this.game.debugTimeScale = s;
    this._status(`time x${s}${s === 0 ? ' (frozen)' : ''}`, 'ok');
    this._syncTimeButtons();
    this._syncBadge();
  }

  stepTime(dir) {
    const cur = finite(this.game.debugTimeScale, 1);
    let idx = 0, best = Infinity;
    TIME_STEPS.forEach((v, i) => {
      const d = Math.abs(v - cur);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const next = Math.max(0, Math.min(TIME_STEPS.length - 1, idx + (dir > 0 ? 1 : -1)));
    this.setTimeScale(TIME_STEPS[next]);
  }

  setHitboxes(on) {
    this.hitboxes = !!on;
    this.prefs.hitboxes = this.hitboxes;
    this._savePrefs();
    this._applyOverlay();
    setClass(this.ui.hitBtn, 'on', this.hitboxes);
  }

  /** Loop: re-trigger the selected ability every `loop.every` game seconds (AI is paused meanwhile). */
  setLoop(on, name = null) {
    const L = this.loop;
    if (name) {
      this.selected = name;
      this._markSelected();
    }
    on = !!on;
    if (on && !this.selected) {
      if (!this._abilities.length) this._syncAbilities();
      this.selected = this._abilities[0]?.name ?? null;
      this._markSelected();
      if (!this.selected) {
        this._status('loop: no ability to loop (dragon.debug.abilities n/a)', 'warn');
        return;
      }
    }
    if (on === L.on) return;
    L.on = on;
    L.count = 0;
    if (on) {
      this._prepareFlow(); // from a menu / death / victory screen: practice starts in 'boss' now
      L.t = L.every; // fire on the next frame
      // pause the AI for clean practice; remember to restore it only if the Lab turned it off
      L.prevAI = null;
      if (this.target?.debug?.aiEnabled !== false) {
        const r = this._call(this.target, 'dragon', 'setAI', [false], true);
        if (r !== null && r !== false) L.prevAI = true;
      }
      this._status(`loop ${this.selected} every ${L.every}s (AI paused)`, 'ok');
    } else {
      if (L.prevAI === true) this._call(this.target, 'dragon', 'setAI', [true], true);
      L.prevAI = null;
      this._status('loop off', 'ok');
    }
    setClass(this.ui.loopBtn, 'on', on);
    this._syncBadge();
  }

  /**
   * Optional late hook: if main.js calls this after the actors updated (before render), the hitbox
   * overlay matches the current frame instead of lagging one frame behind.
   */
  postUpdate() {
    try {
      this.viewer.frame(); // model viewer follows the actors' this-frame pose (before the camera)
    } catch (err) {
      this._fail('model view', err);
    }
    if (!this.open || !this.hitboxes) return;
    this._postUpdated = true;
    try {
      this.overlay?.update(this.target);
    } catch (err) {
      this._fail('overlay', err);
    }
  }

  /** main.js calls this right after the frame is drawn (same task, the canvas still holds it): the
   *  model viewer's sheet copies the tile on screen into its overlay. */
  postRender() {
    try {
      this.viewer.postRender();
    } catch (err) {
      this._fail('model view', err);
    }
  }

  /** Tear down: listeners, DOM, overlay, and any Lab-only cheats left running (loop, time scale). */
  dispose() {
    try {
      this.setLoop(false);
      this.viewer.exit();
      if (finite(this.game.debugTimeScale, 1) !== 1) this.game.debugTimeScale = 1;
      if (typeof removeEventListener === 'function') removeEventListener('keydown', this._onKey, true);
      this.trainer.dispose();
      this.overlay?.dispose();
      this.overlay = null;
      this.root?.remove?.();
      this.badge?.remove?.();
      this.root = null;
      this.badge = null;
      this.ui = {};
      this.open = false;
    } catch (err) {
      this._fail('dispose', err);
    }
  }

  update(realDt) {
    const rdt = Math.min(0.1, Math.max(0, finite(realDt)));
    const late = this._postUpdated; // postUpdate() ran last frame: it owns the overlay refresh
    this._postUpdated = false;
    try {
      this.viewer.pinAim(); // before the player reads game.mouseGround
      this.trainer.trackInput();
      if (this.loop.on) this._tickLoop();
      this.training.update(rdt);
    } catch (err) {
      this._fail('tick', err);
    }

    if (!this.open) {
      this._badgeT -= rdt;
      if (this._badgeT <= 0) {
        this._badgeT = BADGE_POLL;
        this._syncBadge();
      }
      return;
    }

    try {
      // without a late hook, refresh the overlay here (shows the previous frame's hitboxes)
      if (this.hitboxes && !late) this.overlay?.update(this.target);
      this._refreshNext();
      this._refreshT -= rdt;
      if (this._refreshT <= 0) {
        this._refreshT = REFRESH;
        this._refresh();
      }
      this._abPollT -= rdt;
      if (this._abPollT <= 0) {
        this._abPollT = ABILITY_POLL;
        this._syncAbilities();
      }
    } catch (err) {
      this._fail('panel', err);
    }
  }

  // ---------------------------------------------------------------- actions
  /** Call `owner.debug[method](...args)`. Returns the result (true for void), false if refused, null if n/a / error. */
  _call(owner, label, method, args = [], quiet = false) {
    const dbg = owner?.debug;
    const fn = dbg?.[method];
    if (typeof fn !== 'function') {
      this._status(`n/a: ${label}.debug.${method}()`, 'warn');
      return null;
    }
    try {
      const r = fn.apply(dbg, args);
      if (!quiet) this._status(`${label}.${method}(${args.map(fmtArg).join(', ')})${r === false ? ': refused' : ''}`, r === false ? 'warn' : 'ok');
      return r === undefined ? true : r;
    } catch (err) {
      console.error(`[lab] ${label}.debug.${method} failed`, err);
      this._status(`error: ${label}.${method}: ${err?.message ?? err}`, 'err');
      return null;
    }
  }

  _dragon(method, ...args) {
    return this._call(this.target, 'dragon', method, args);
  }

  /**
   * dragon.debug.trigger(name). On success the attack in flight (if any) was replaced, so its
   * announced impacts will never land: drop them from the trainer, keeping the new ability's own.
   */
  _force(name, quiet) {
    const mark = this.trainer.seq;
    // a duelist's move of a later phase / form: he is put into it first, without its change (as the
    // Training's BOSS MOVES do); trigger() refuses a move above his phase
    const mv = this.target?.kit?.MOVES?.[name];
    if (mv && !mv.transition && Number.isFinite(mv.phase) && mv.phase > (this.target.phase ?? 1)) this._skipToPhase(mv.phase);
    const r = this._call(this.target, 'dragon', 'trigger', [name], quiet);
    if (r !== null && r !== false) this.trainer.dropPendingUpTo(mark);
    return r;
  }

  /** Phase 2 / stagger / posture break / kill: a fight action, so stand in 'boss' first if needed. */
  _fightAction(method) {
    if (method === 'kill') this.setLoop(false);
    this._prepareFlow();
    // a duelist's change to phase / form N plays from N - 1 only: from further back he is put into
    // N - 1 first (no change played), then the change to N plays
    const pn = /^phase([2-4])$/.exec(method)?.[1];
    if (pn && this.target?.kit && (this.target.phase ?? 1) < pn - 1) this._skipToPhase(pn - 1);
    const r = this._dragon(method);
    // these interrupt the current attack: its announced impacts will never land
    if (r !== null && r !== false) this.trainer.clearPending();
    return r;
  }

  /** A duelist straight into phase / form `n`, its change not played (the Lord's setForm dresses
   *  the form; Shen Hui's enterPhase sets the phase). */
  _skipToPhase(n) {
    const d = this.target;
    if (!d || !(n > (d.phase ?? 1))) return;
    try {
      if (typeof d.debug?.setForm === 'function') d.debug.setForm(n);
      else d.enterPhase?.(n);
    } catch (err) {
      this._fail('skip to phase', err);
    }
  }

  _flowTo(name, quiet = false) {
    // a state jump ends Loop practice unless it goes (back) into the fight
    if (name !== 'boss' && this.loop.on) this.setLoop(false);
    this.trainer.clearPending();
    return this._call(this.game.flow, 'flow', 'toState', [name], quiet);
  }

  /**
   * Before forcing a fight action from title / paused / dead / victory / bossIntro, jump the flow to
   * 'boss': flow.debug.toState('boss') starts the fight itself (dragon.debug.startFight, skipping
   * any intro) and brings up the boss bar + music. It must run BEFORE the action — a startFight
   * after it could cancel the ability just forced. From explore nothing is needed (the flow follows
   * the dragon into 'boss' on its own). Returns true when the flow jump started the fight.
   */
  _prepareFlow() {
    const st = this.game.state;
    if (FLOW_FOLLOWS.has(st)) return false;
    if (typeof this.game.flow?.debug?.toState !== 'function') return false;
    const r = this._flowTo('boss', true);
    return r !== null && r !== false;
  }

  /** Skip the intro straight into combat, with the flow in 'boss'. */
  _startFight() {
    const g = this.game;
    // outside 'boss', or over a fallen dragon, let the flow do it: it resets a downed dragon first
    const viaFlow = g.state !== 'boss' || DRAGON_DOWN.has(this.target?.state);
    if (viaFlow && typeof g.flow?.debug?.toState === 'function') {
      const r = this._flowTo('boss');
      if (r !== null && r !== false) return; // flow called dragon.debug.startFight for us
    }
    this._dragon('startFight');
  }

  /** Play the wake-up intro. From a non-play screen, first return to exploring (dragon asleep). */
  _wake() {
    const g = this.game;
    if (!PLAY.has(g.state) && typeof g.flow?.debug?.toState === 'function') this._flowTo('explore', true);
    this._dragon('wake');
  }

  /**
   * Dragon back to sleep at the nest. Mid-fight, after it or from the pause menu, the flow returns
   * to exploring too (toState('explore') resets the dragon, the scorch and respawns the player at
   * the bonfire), so the boss bar / music never outlive the fight — and unpausing can never land in
   * 'boss' with a sleeping dragon.
   */
  _resetFight() {
    this.setLoop(false);
    this.trainer.clearPending();
    const st = this.game.state;
    if (st !== 'explore' && st !== 'title') {
      const r = this._flowTo('explore');
      if (r !== null && r !== false && this.target?.state === 'sleeping') return;
    }
    this._dragon('reset');
    this.game.world?.restore?.(); // what broke and burned stands again
  }

  _toggleAI() {
    const cur = this.target?.debug?.aiEnabled;
    this._dragon('setAI', cur === false);
    this._syncBadge();
  }

  _togglePlayerFlag(key, label) {
    const dbg = this.game.player?.debug;
    if (!dbg || typeof dbg !== 'object') {
      this._status(`n/a: player.debug.${key}`, 'warn');
      return;
    }
    dbg[key] = !dbg[key];
    this._status(`${label} ${dbg[key] ? 'on' : 'off'}`, 'ok');
    this._refresh();
    this._syncBadge();
  }

  /**
   * Look-dev preset for reviewing the hero, the wyrm and the grass up close: starts the fight with
   * the AI off and god mode on, puts the hero 7 m in front of the wyrm and zooms the camera in.
   */
  showroom() {
    const g = this.game;
    if (g.state !== 'boss' || DRAGON_DOWN.has(this.target?.state)) this._startFight();
    if (this.target?.debug?.aiEnabled !== false) this._dragon('setAI', false);
    const dbg = g.player?.debug;
    if (dbg && typeof dbg === 'object') dbg.god = true;
    this._teleport('front', 7);
    this._cameraDistance(finite(g.cameraRig?.minDistance, CONFIG.camera.minDistance));
    this._status('showroom: AI off, god mode, camera close (wheel / "Camera default" to reset)', 'ok');
    this._refresh();
    this._syncBadge();
  }

  /**
   * Model viewer (ARCHITECTURE.md → Lab → Model viewer): frame the hero or the dragon from `yaw`
   * degrees around ITS facing (0 front, 90 its left, 180 back, 270 its right) at `pitch` degrees
   * (8 ≈ character-sheet eye level, 58 = the game camera), `dist` m (omit = auto-fit), looking at
   * `height` m above its root (omit = auto); `dark` hides the world. Extras: `forward` (m along its
   * facing for the look point, omit = bounding-box centre), `lockYaw` (sample its facing once instead
   * of following it), `game` (yaw is world-fixed like the gameplay camera). AI off + god mode + HUD
   * hidden while viewing. modelView(null) restores the game camera. Returns the framing or null.
   */
  modelView(opts) {
    let r = null;
    try {
      r = this.viewer.set(opts);
    } catch (err) {
      console.error('[lab] model view failed', err);
      this._status(`error: model view: ${err?.message ?? err}`, 'err');
      try {
        this.viewer.exit();
      } catch {
        /* keep going: the viewer state is reset either way */
      }
      this._mvSync();
      return null;
    }
    if (r && typeof r === 'object') {
      this.mvPick.target = r.target;
      this.mvPick.dark = r.dark;
      this.mvPick.mode = r.sheet ? 'sheet' : r.spin ? 'spin' : 'view';
      this.mvPick.look = r.look ?? 'ascii';
      const hit = r.sheet || r.spin ? null : VIEW_ANGLES.find(([, , p]) => (p.game ? r.game : !r.game && p.yaw === r.yaw && p.pitch === r.pitch));
      if (!r.sheet && !r.spin) this.mvPick.angle = hit ? hit[0] : null;
      const what = r.sheet ? ' sheet' : r.spin ? ' spin' : this.mvPick.angle ? ` ${this.mvPick.angle}` : '';
      this._status(`view ${r.target}${what} · yaw ${r.yaw} · pitch ${r.pitch} · d ${r.dist} m · h ${r.height} m${r.dark ? ' · dark' : ''}${r.look !== 'ascii' ? ` · ${r.look}` : ''}`, 'ok');
    } else if (r === 'off') {
      this._status('view off: game camera', 'ok');
    } else {
      this._status(`n/a: model view target ${opts?.target ?? ''}`.trim(), 'warn');
    }
    this._mvSync();
    this._refresh();
    this._syncBadge();
    return r;
  }

  /** Lab buttons: change the target / angle / dark pick; target + angle buttons (re)enter the view. */
  _mvPick(change, enter) {
    Object.assign(this.mvPick, change);
    if (!enter && !this.viewer.active) {
      this._mvSync();
      return;
    }
    const k = this.mvPick;
    if (k.mode === 'sheet') {
      this.modelView({ target: k.target, dark: k.dark, look: k.look, sheet: true });
      return;
    }
    const preset = VIEW_ANGLES.find(([key]) => key === k.angle)?.[2] ?? VIEW_ANGLES[0][2];
    const opts = { target: k.target, dark: k.dark, look: k.look, ...preset };
    if (k.mode === 'spin') {
      // the turntable starts from the angle on screen (sheet eye level from the gameplay camera)
      const y0 = this.viewer.state && !this.viewer.state.game ? this.viewer.state.yaw : preset.yaw;
      Object.assign(opts, { game: false, spin: true, yaw: finite(y0, 0), pitch: preset.game ? 8 : preset.pitch });
    } else if (preset.game) {
      // the gameplay camera: world-fixed yaw, 58° pitch, the rig's current distance, root on the ground
      Object.assign(opts, { yaw: 0, pitch: (this.game.CONFIG ?? CONFIG).camera.pitch / DEG, dist: finite(this.game.cameraRig?.targetDistance, CONFIG.camera.distance), height: 0, forward: 0 });
    }
    this.modelView(opts);
  }

  _mvSync() {
    const u = this.ui;
    if (!u.mvTargets) return;
    const on = this.viewer.active, k = this.mvPick;
    for (const t of u.mvTargets) setClass(t.el, 'on', k.target === t.key);
    for (const a of u.mvAngles) setClass(a.el, 'on', on && k.mode === 'view' && k.angle === a.key);
    setClass(u.mvSpin, 'on', on && k.mode === 'spin');
    setClass(u.mvSheet, 'on', on && k.mode === 'sheet');
    for (const l of u.mvLooks ?? []) setClass(l.el, 'on', k.look === l.key);
    setClass(u.mvDark, 'on', !!k.dark);
    setClass(u.mvExit, 'na', !on);
    const d = this.viewer.describe();
    setText(u.mvInfo, d ? `${d.target} · d ${d.dist} m${d.auto.dist ? ' (fit)' : ''} · h ${d.height} m · ${d.look} · AI off, god, HUD hidden` : 'off · console: __game.lab.modelView({ target, yaw, pitch, dist, height, dark, spin, sheet, look })');
  }

  _toggleTouch() {
    const t = this.game.touch;
    if (typeof t?.setActive !== 'function') {
      this._status('n/a: game.touch (touch controls)', 'warn');
      return;
    }
    t.setActive(!t.active);
    setClass(this.ui.touchBtn, 'on', !!t.active);
    this._status(`touch UI ${t.active ? 'on' : 'off'}${t.active && t.phone ? ' (phone camera)' : ''}`, 'ok');
  }

  _cameraDistance(d) {
    const rig = this.game.cameraRig;
    if (!rig) return;
    rig.targetDistance = Number.isFinite(d) ? d : finite(rig.defaultDistance, CONFIG.camera.distance);
  }

  _teleport(where, dist = 8) {
    const g = this.game, p = g.player, d = this.target;
    const cfg = g.CONFIG ?? CONFIG;
    let x, z, yaw;
    if (where === 'bonfire') {
      const spawn = cfg?.world?.playerSpawn;
      const fire = g.world?.bonfire ?? cfg?.world?.bonfire ?? { x: 0, z: 25.5 };
      x = finite(spawn?.x, finite(fire.x));
      z = finite(spawn?.z, finite(fire.z) - 1.8);
      yaw = Math.PI; // face north, toward the arena
    } else {
      const dp = d?.position;
      if (!dp || !Number.isFinite(dp.x) || !Number.isFinite(dp.z)) {
        this._status('n/a: dragon position', 'warn');
        return;
      }
      const dy = finite(d.yaw);
      const s = where === 'front' ? 1 : -1;
      x = dp.x + Math.sin(dy) * dist * s;
      z = dp.z + Math.cos(dy) * dist * s;
      // keep it inside the clearing
      const r = Math.hypot(x, z), lim = finite(cfg?.world?.arenaRadius, 30) - 1;
      if (r > lim) {
        x *= lim / r;
        z *= lim / r;
      }
      x = +x.toFixed(2);
      z = +z.toFixed(2);
      yaw = Math.atan2(dp.x - x, dp.z - z);
    }
    const res = this._call(p, 'player', 'teleport', [x, z]);
    // initial facing only (mouse aim / lock-on take over on the next frame)
    if (res !== null && res !== false && p && Number.isFinite(yaw)) p.yaw = yaw;
  }

  _tickLoop() {
    const L = this.loop;
    if (!this.selected) return;
    if (!PLAY.has(this.game.state)) return; // hold on title / pause / death / victory screens
    const dt = finite(this.game.dt);
    if (dt <= 0) return; // frozen
    L.t += dt;
    if (L.t < L.every) return;
    this._prepareFlow(); // bossIntro → boss (skip the rest of the intro)
    const r = this._force(this.selected, true);
    if (r === null) {
      this.setLoop(false);
      this._status('loop stopped: dragon.debug.trigger() n/a or failed', 'warn');
      return;
    }
    if (r === false) {
      L.t = L.every - 0.25; // busy: retry shortly
      return;
    }
    L.t = 0;
    L.count++;
  }

  _key(e) {
    const code = e?.code;
    if (code === 'F1' || code === 'Backquote') {
      e.preventDefault?.();
      if (!e.repeat) this.toggle();
      return;
    }
    if (!this.open || e.ctrlKey || e.metaKey || e.altKey) return;
    const m = LAB_KEY.exec(code ?? '');
    if (!m) return;
    e.stopPropagation?.(); // a Lab key while open: not a game key (repeats included)
    if (e.repeat) return;
    if (m[1]) this.triggerIndex(Number(m[1]) - 1);
    else this.stepTime(code === 'BracketLeft' ? -1 : 1);
  }

  _status(text, cls = '') {
    const s = this.ui.status;
    if (!s) return;
    setText(s, text);
    s.className = `lab-status ${cls}`.trim();
  }

  _fail(where, err) {
    this._errors++;
    if (this._errors <= 5) console.error(`[lab] ${where} failed`, err);
  }

  _savePrefs() {
    try {
      globalThis.localStorage?.setItem(storeKey, JSON.stringify(this.prefs));
    } catch {
      /* private mode / no storage: prefs are a convenience only */
    }
  }

  _applyOverlay() {
    const on = this.open && this.hitboxes;
    if (on && !this.overlay) {
      try {
        this.overlay = new HitboxOverlay(this.game);
      } catch (err) {
        this._fail('overlay init', err);
        return;
      }
    }
    this.overlay?.setVisible(on);
    if (on && !this.game.fxScene) this._status('n/a: game.fxScene (hitbox overlay)', 'warn');
  }

  // ---------------------------------------------------------------- DOM
  _build() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    try {
      injectLabStyle();
      const host = document.getElementById?.('ui') ?? document.body;
      if (!host) return;
      const root = el('div', 'lab-root lab-hidden', null, host);
      this.root = root;
      root.addEventListener('contextmenu', (e) => e.preventDefault?.());

      const head = el('div', 'lab-head', null, root);
      el('span', 'lab-title', 'LAB', head);
      button(head, 'TRAINING', () => this.trainingPanel.toggle(), 'lab-trn').title = 'every situation, one click each (F4)';
      el('span', 'lab-hint', 'F1 / ` toggle · 1-9 abilities · [ ] time', head);
      button(head, '×', () => this.setOpen(false), 'lab-close').title = 'close the Lab (F1)';
      this.ui.status = el('div', 'lab-status', 'ready', root);

      this._buildLevel(root);
      this._buildOutfit(root);
      this._buildLooks(root);
      this._buildFight(root);
      this._buildAbilities(root);
      this._buildPlayer(root);
      this._buildWorld(root);
      this._buildTime(root);
      this._buildStates(root);
      this._buildView(root);
      this._buildReadout(root);
    } catch (err) {
      console.error('[lab] build failed', err);
      this.root?.remove?.();
      this.root = null;
      this.ui = {};
    }
  }

  _section(root, key, title) {
    return section(root, key, title, this.prefs.collapsed[key], (k, c) => {
      this.prefs.collapsed[k] = c;
      this._savePrefs();
    });
  }

  /** LEVEL: reload into another level (game.levels / game.pickLevel, main.js; `?lab` is kept). */
  _buildLevel(root) {
    const levels = this.game.levels;
    if (!Array.isArray(levels) || levels.length < 2) return;
    const { body } = this._section(root, 'level', 'LEVEL');
    const grid = el('div', 'lab-grid c2', null, body);
    const cur = this.game.level?.id;
    for (const L of levels) {
      const b = button(grid, L.name, () => {
        if (L.id !== cur) this.game.pickLevel?.(L.id);
      });
      b.title = L.id === cur ? 'the level loaded now' : `reload into ${L.name} (?level=${L.id})`;
      if (L.id === cur) b.classList?.add?.('on');
    }
  }

  /** OUTFIT: the hero's outfit options (game.heroLooks / game.pickHeroLook, main.js; `?heroLook=`;
   *  kept for later use; today's look is the default). Live: the rig is rebuilt, the pose restarts. */
  _buildOutfit(root) {
    const looks = this.game.heroLooks;
    if (!Array.isArray(looks) || looks.length < 2) return;
    const { body } = this._section(root, 'outfit', 'OUTFIT');
    // two columns (each look beside its shaded-face twin, `looks.js` order), today's look across both
    const grid = el('div', 'lab-grid', null, body);
    if (grid.style) grid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    this.ui.lookBtns = looks.map((L, i) => {
      const b = button(grid, L.name, () => {
        try {
          this.game.pickHeroLook?.(L.id);
          this._status(`outfit: ${L.name}`, 'ok');
        } catch (err) {
          this._status(`error: outfit ${L.id}: ${err?.message ?? err}`, 'err');
          this._fail('outfit', err);
        }
        this._syncOutfit();
        this._mvSync?.();
      });
      b.title = `wear ${L.name} (?heroLook=${L.id}; the rig is rebuilt, the pose restarts)`;
      if (i === 0 && b.style) b.style.gridColumn = '1 / -1';
      return { id: L.id, el: b };
    });
    this._syncOutfit();
  }

  /** LOOKS: the duelists' look options (labLooks.js; ?kindle= ?star= ... ?looks=new), live or by a
   *  reload. Only in a duelist's level; collapsed by default (it is long). */
  _buildLooks(root) {
    const id = this.game.level?.id;
    if (id !== 'ash' && id !== 'starless' && id !== 'ring' && id !== 'fox' && id !== 'grove' && id !== 'city' && id !== 'veil' && id !== 'foundry') return;
    if (this.prefs.collapsed && !('looks' in this.prefs.collapsed)) this.prefs.collapsed.looks = true;
    const { body } = this._section(root, 'looks', 'LOOKS');
    this.ui.looksSync = buildLooks(body, id, (t) => this._status(t, 'ok'));
  }

  _syncIdleBtns() {
    for (const { m, el: b } of this.ui.idleBtns ?? []) setClass(b, 'on', idlesMode() === m);
    for (const { m, el: b } of this.ui.guardBtns ?? []) setClass(b, 'on', guardMode() === m);
    for (const { m, el: b } of this.ui.holdBtns ?? []) setClass(b, 'on', holdMode() === m);
  }

  _syncStanceBtns() {
    const v = this.game.player?.debug?.fightStance ?? null;
    for (const B of this.ui.stanceBtns ?? []) B.el.classList?.toggle?.('on', B.v === v);
  }

  _syncOutfit() {
    for (const B of this.ui.lookBtns ?? []) B.el.classList?.toggle?.('on', B.id === this.game.player?.look);
  }

  _buildFight(root) {
    const { body } = this._section(root, 'fight', 'FIGHT');
    const grid = el('div', 'lab-grid', null, body);
    button(grid, 'Wake', () => this._wake()).title = 'play the wake-up intro';
    button(grid, 'Start fight', () => this._startFight()).title = 'skip the intro, straight into combat';
    button(grid, 'Reset', () => this._resetFight()).title = 'dragon back to sleep at the nest (mid-fight: flow -> explore, player to the bonfire)';
    button(grid, 'Phase 2', () => this._fightAction('phase2'));
    button(grid, 'Phase 3', () => this._fightAction('phase3')).title = 'the phase-3 transition roar: hotter, faster wyrm (opens with the nova when the AI runs)';
    // a boss with a fourth phase (the Starless Lord's blade forms)
    // (every duelist has debug.phase4; only one whose kit counts four forms uses it)
    const D = this.game.dragon;
    if (typeof D?.debug?.phase4 === 'function' && (D.kit ? (D.kit.maxPhase ?? 0) >= 4 : true)) button(grid, 'Phase 4', () => this._fightAction('phase4')).title = 'the next blade form (each button works from the form before it)';
    button(grid, 'Stagger', () => this._fightAction('stagger'));
    button(grid, 'Posture break', () => this._fightAction('postureBreak'));
    button(grid, 'Kill', () => this._fightAction('kill'), 'danger');
    // the wyrm's phase-3 fire (dragon/ablaze.js): cycle its strength off / a / b / c
    if (typeof this.game.dragon?.debug?.ablaze === 'function') {
      const b = button(grid, `Ablaze ${this.game.dragon.debug.ablaze()}`, () => {
        const L = ['off', 'a', 'b', 'c'], d = this.game.dragon.debug;
        b.textContent = `Ablaze ${d.ablaze(L[(L.indexOf(d.ablaze()) + 1) % L.length])}`;
      });
      b.title = 'phase 3 sets the wyrm on fire: its strength (?ablaze=off|a|b|c)';
    }
    // the Sheathed (ADR-144): his draw lethal or not; his sheath's state
    if (typeof this.game.dragon?.debug?.lethal === 'function') {
      const d = this.game.dragon.debug;
      const b = button(grid, `Lethal draw ${d.lethal() ? 'on' : 'off'}`, () => {
        b.textContent = `Lethal draw ${d.lethal(!d.lethal()) ? 'on' : 'off'}`;
      });
      b.title = 'an unanswered draw kills (on) or deals TUNING.draw.damage (off)';
      button(grid, 'Sheath?', () => this._status(`sheath: ${d.sheath?.()}`, 'ok')).title = 'his sheath now: carry / settled / drawn';
    }
    // the hero's One Breath (ADR-146; game/unlocks.js): learned or not
    const U = this.game.unlocks;
    if (U) {
      const ob = button(grid, `One Breath ${U.has('oneBreath') ? 'on' : 'off'}`, () => {
        ob.textContent = `One Breath ${U.toggle('oneBreath', !U.has('oneBreath')) ? 'on' : 'off'}`;
      });
      ob.title = 'the draw-slash: guard, then hold heavy (the Sheathed\'s reward; ?tech=draw)';
      const ls = button(grid, `Long Second ${U.has('longSecond') ? 'on' : 'off'}`, () => {
        ls.textContent = `Long Second ${U.toggle('longSecond', !U.has('longSecond')) ? 'on' : 'off'}`;
      });
      ls.title = 'the lean: guard, then dodge with no direction (Xin Yi\'s reward; ?tech=lean)';
    }
    // the Thousand-Body Fox (ADR-147, ADR-154): his packs of paper selves, the Pearl, the mantle, the Howl
    if (typeof this.game.dragon?.debug?.pack === 'function') {
      const fd = this.game.dragon;
      button(grid, 'Pack: Two Leaves', () => fd.debug.pack('twinFall')).title = 'two selves drop and dive-kick in turn (a pack, out of any move)';
      button(grid, 'Pack: All at Once', () => fd.debug.pack('allAtOnce', { phase: Math.max(2, fd.phase) })).title = 'selves on every side dive at the same instant: one cue, one parry bursts all';
      button(grid, 'Pack: Round', () => fd.debug.pack('foxRing', { phase: Math.max(2, fd.phase) })).title = 'selves drop into a ring and strike in turn';
      button(grid, 'Pack: Kite', () => fd.debug.pack('kiteString', { phase: Math.max(2, fd.phase) })).title = 'three selves slide in low and kick upward in turn';
      button(grid, 'Twin Pearls', () => { if (fd.phase < 2) fd.enterPhase?.(2); fd.debug.trigger('twinPearl'); }).title = 'he and a self drive two Pearls in from two sides (phase 2)';
      if (typeof fd.debug.howl === 'function') button(grid, 'Howl', () => fd.debug.howl()).title = 'Heaven-Devouring Howl: the Nine-Tailed Fox and its beam (phase 3)';
      button(grid, 'Pop all', () => this.game.dragon.debug.popAll()).title = 'pop every paper self';
      button(grid, 'Pearl', () => this.game.dragon.debug.pearl()).title = 'the Pearl of the Hollow Moon now';
      const m = button(grid, 'Mantle', () => {
        const on = this.game.dragon.debug.mantle(!this.game.dragon._mantleForced);
        m.classList?.toggle?.('on', !!on);
      });
      m.title = 'the Fox-Fire Mantle on / off (phase 3 wears it by itself)';
    }
    // Xin Yi, the One Who Woke (ADR-156): the Bend, the fall and the rising, the stop, the scenes, deja vu
    if (typeof this.game.dragon?.debug?.bendNow === 'function') {
      const W = this.game.dragon.debug;
      button(grid, 'Bend now', () => W.bendNow('shot')).title = 'THE BEND now (phase 2: a returned shot\'s; open 1 s, the first cut crits)';
      button(grid, 'Fall + rise', () => W.fallAndRise()).title = 'bar 1 emptied and the deathblow: THE FALL, then the rising into the Source';
      button(grid, 'Hold 3', () => W.hold(3)).title = 'three bolts hanging before his palm (phase 3: Return to Sender comes)';
      button(grid, 'Deja vu', () => W.dejavu('lesson')).title = 'the hall stutters and The First Lesson replays';
      for (const id of ['hall', 'dojo', 'source']) button(grid, `Scene ${id}`, () => W.scene(id)).title = `the hall rewrites itself into the ${id} scene from where he stands (the morph)`;
      // the rework (ADR-168, ADR-169): gear 2, Borrowed Wall's two blows (every move of his is in the move list)
      if (typeof W.setGear === 'function') {
        button(grid, 'Gear 2', () => W.setGear(2)).title = 'phase 1: the second hand comes out now (the opening, then both hands)';
        button(grid, 'Gear 1', () => W.setGear(1)).title = 'phase 1: back to one hand (the left behind his back)';
        button(grid, 'Wall kick', () => W.wall('kick')).title = 'Borrowed Wall: the flying side kick off the upright at your side (blue flare: parry)';
        button(grid, 'Wall heel', () => W.wall('heel')).title = 'Borrowed Wall: the drop heel off the upright onto where you stood (red: roll)';
      }
    }
    // Halcyon (ADR-160): his passes, the tower, the falling sky, the statue, the carry, the cars, the city's light
    if (typeof this.game.dragon?.debug?.fallingSky === 'function') {
      const D = () => this.game.dragon.debug;
      button(grid, 'Pass', () => D().pass()).title = 'Fly-By now (two passes in phase 2, three in phase 3)';
      button(grid, 'Tower', () => D().tower()).title = 'Through the Tower now (a standing tower top)';
      button(grid, 'Falling sky', () => D().fallingSky()).title = 'The Falling Sky now (a standing tower top)';
      button(grid, 'Statue', () => D().statue()).title = 'Monument now: the arm of his statue torn off and swung';
      button(grid, 'Carry', () => D().carry()).title = 'See the World now (the grab and the carry)';
      button(grid, 'Explode', () => D().explode(1)).title = 'the car nearest the hero breaks (by the hero): its fuse, then it goes up';
      button(grid, 'Crash', () => D().crash()).title = 'THE CRASH now: thrown off his line into the first cover on it';
      for (const n of [1, 2, 3]) button(grid, `City ${n}`, () => D().cityPhase(n)).title = `the city's light as in his phase ${n} (1 neon, 2 crimson screens, 3 dark)`;
    }
    // Bai Wuji, the Untouched: the barrier, the domain, the pull, the blink
    if (typeof this.game.dragon?.debug?.domain === 'function' && typeof this.game.dragon?.debug?.barrier === 'function') {
      const D = () => this.game.dragon.debug;
      button(grid, 'Barrier open', () => D().barrier('open')).title = 'the Unreached opens now (as after a perfect parry)';
      button(grid, 'Barrier up', () => D().barrier('up')).title = 'the Unreached closes again now';
      button(grid, 'Crack', () => D().barrier('crack')).title = 'one crack in the barrier (as an ordinary parry)';
      button(grid, 'Domain escape', () => D().domain('escape')).title = 'the Measureless: the hero dodged through the wall (into the void, the barrier open)';
      button(grid, 'Domain caught', () => D().domain('caught')).title = 'the Measureless: the hero is caught (held, one blow, never lethal), into the void';
      button(grid, 'Void break', () => D().domain('break')).title = 'the void breaks: the crossing returns';
      button(grid, 'Pull', () => D().pull()).title = 'an Azure Draw knot where the hero stands (it drags him)';
      button(grid, 'Blink', () => D().blink('behind')).title = 'he is behind the hero now';
    }
    // the False Saint (ADR-285): his shell, a molten pool, his phases through their changes, every effect alone
    if (typeof this.game.dragon?.debug?.fx === 'function' && Array.isArray(this.game.dragon?.debug?.fxNames)) {
      const D = () => this.game.dragon.debug;
      button(grid, 'Pool here', () => D().pool()).title = 'a molten pool at the hero\'s feet (cued red, then it burns)';
      button(grid, 'Shell whole', () => D().shell(0)).title = 'no part bared (until his next cut; a phase\'s floor holds)';
      button(grid, 'Shell half', () => D().shell(0.5)).title = 'every part at least half bared';
      button(grid, 'Shell bare', () => D().shell(1)).title = 'the true frame everywhere';
      for (const n of [2, 3, 4]) button(grid, `Into P${n}`, () => D().setPhase(n)).title = `the next change on the way to phase ${n} (press again after each)`;
      button(grid, 'Tidy', () => D().tidy()).title = 'every handler stops what it holds; he stands at the middle';
      const fxRow = el('div', 'lab-grid c4', null, body);
      for (const n of this.game.dragon.debug.fxNames) button(fxRow, n, () => D().fx(n)).title = `fx: ${n} alone (fxDebug.js; nothing dealt, nothing broken)`;
    }
    const row = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'HP', row);
    this.ui.hp = slider(row, { min: 0, max: 100, step: 1, value: 100 }, (v) => {
      setText(this.ui.hpVal, `${v}%`);
      this._dragon('setHp', v / 100);
    });
    this.ui.hpVal = el('span', 'lab-val', '100%', row);
  }

  _buildAbilities(root) {
    const { body } = this._section(root, 'abilities', 'ABILITIES');
    this.ui.abList = el('div', 'lab-abs', null, body);
    const row = el('div', 'lab-row', null, body);
    this.ui.loopBtn = button(row, 'Loop', () => this.setLoop(!this.loop.on));
    this.ui.loopBtn.title = 're-trigger the selected ability every N s (pauses the AI)';
    el('span', 'lab-lbl', 'every', row);
    this.ui.loopSlider = slider(row, { min: 2, max: 8, step: 0.5, value: this.loop.every }, (v) => {
      this.loop.every = v;
      this.prefs.loopEvery = v;
      this._savePrefs();
      setText(this.ui.loopVal, `${v.toFixed(1)}s`);
    });
    this.ui.loopVal = el('span', 'lab-val', `${this.loop.every.toFixed(1)}s`, row);
    const row2 = el('div', 'lab-row', null, body);
    this.ui.aiBtn = button(row2, 'AI', () => this._toggleAI());
    this.ui.aiBtn.title = 'dragon decision-making on / off (it still reacts to triggers)';
    this.ui.loopInfo = el('span', 'lab-grow', '', row2);
    button(row2, 'reload', () => {
      this._abSig = '';
      this._syncAbilities();
    }).title = 're-read dragon.debug.abilities()';
    el('div', 'lab-note', 'click = trigger + select for Loop · chip = tell (white / blue parry / red dodge)', body);
  }

  /** WORLD (ADR-107): try the destruction by hand: fire, a piece felled at the hero, a blast, the reset. */
  _buildWorld(root) {
    const { body } = this._section(root, 'world', 'WORLD');
    const grid = el('div', 'lab-grid', null, body);
    const w = () => this.game.world, p = () => this.game.player?.position;
    const ahead = (d) => {
      const yaw = this.game.player?.yaw ?? 0, at = p();
      return at ? { x: at.x + Math.sin(yaw) * d, z: at.z + Math.cos(yaw) * d } : null;
    };
    button(grid, 'Burn ahead', () => {
      const a = ahead(5);
      const n = a ? w()?.ignite?.(a.x, a.z, 3.5, 1) : 0;
      this._status(n ? `fire: ${n} cells / pieces alight 5 m ahead` : 'nothing to burn there (ash, bare ground, paving)', n ? 'ok' : '');
    }).title = 'fire lands 5 m in front of the hero: grass and wood there catch';
    button(grid, 'Fell on me', () => {
      const D = w()?.destructibles, at = p();
      let best = null, bd = 1e9;
      for (const b of D?.list ?? []) {
        const d = at ? Math.hypot(b.x - at.x, b.z - at.z) : 1e9;
        if (b.state === 0 && b.topples && d < bd) {
          best = b;
          bd = d;
        }
      }
      const ok = best && D.topple(best, at.x - best.x, at.z - best.z, 'boss');
      this._status(ok ? `a ${best.kind} ${bd.toFixed(1)} m away falls toward the hero` : 'no tall piece standing', ok ? 'ok' : '');
    }).title = 'the nearest tall piece falls toward the hero, as if a boss had felled it (red: be out from under it)';
    button(grid, 'Blast ahead', () => {
      const a = ahead(4);
      const n = a ? w()?.impact?.(a.x, a.z, 3, 3, { kind: 'blast', by: 'boss' }) : 0;
      this._status(`a blast 4 m ahead struck ${n ?? 0} piece(s)`, 'ok');
    }).title = 'a hard blast 4 m in front of the hero: what stands there breaks, the floor cracks';
    // bites (BREAK.chip, on; ?chip=0 off): a blow takes the bricks of a piece where it struck. A level built
    // with it on has finer bricks, so the switch reloads the page with the parameter
    {
      const on = lookOf('chip', 'a', 'a') !== '0';
      button(grid, `Bites ${on ? 'on' : 'off'}`, () => {
        try {
          const u = new URL(globalThis.location.href);
          if (on) u.searchParams.set('chip', '0');
          else u.searchParams.set('chip', 'a');
          u.searchParams.set('lab', '');
          globalThis.location.assign(u.toString());
        } catch (err) {
          console.error('[lab] bites reload failed', err);
        }
      }).title = 'a blow takes the bricks (the letters) of a piece where it struck (on by default; ?chip=0 off; reloads: the level is built with finer bricks)';
      // the hero's blade on what it does not fell (BREAK.chip.pass / .stop): clean through (default) or it
      // stops there as it did (?cutStop=1, ADR-132). Live: read at each swing
      // (the stop also needs bites on: with ?chip=0 the blade goes through whatever this says)
      const stops = () => lookOf('cutStop', '0', '0') !== '0' && lookOf('chip', 'a', 'a') !== '0';
      const b = button(grid, `Blade: ${stops() ? 'stops' : 'through'}`, () => {
        setLook('cutStop', stops() ? '0' : '1');
        b.textContent = `Blade: ${stops() ? 'stops' : 'through'}`;
        this._status(stops() ? 'the blade stops on what it does not fell (?cutStop=1, as before)' : 'the blade goes clean through (the default)', 'ok');
      });
      b.title = 'the hero\'s blade on a rock or a tree it does not fell: clean through, the piece chipped along the cut (default), or it stops there and bounces back (?cutStop=1, the old feel)';
    }
    // (2026-11-16: the tree wall wears down in stages; the landmarks break in pieces)
    const nearestWall = (at) => {
      let best = null, bd = 1e9;
      for (const b of w()?.destructibles?.list ?? []) {
        if (b.state !== 0 || !(b.wall || /^(elder|cinder|nest)/.test(b.kind))) continue;
        const d = Math.hypot(b.x - at.x, b.z - at.z);
        if (d < bd) {
          best = b;
          bd = d;
        }
      }
      return best;
    };
    button(grid, 'Wear wall', () => {
      const D = w()?.destructibles, at = p();
      const b = at && D ? nearestWall(at) : null;
      if (!b) return this._status('no wall tree or landmark piece standing', '');
      const l = Math.hypot(b.x - at.x, b.z - at.z) || 1, dx = (b.x - at.x) / l, dz = (b.z - at.z) / l;
      D.strike(b.x - dx * 0.6, b.z - dz * 0.6, 0.8, 1, { kind: 'blunt', by: 'boss', dx, dz, y: 1.5, src: D.swing() });
      this._status(`a tail's blow (power 1) on a ${b.kind} ${l.toFixed(1)} m away: stage ${b.wear ?? 0}, ${b.hp.toFixed(2)} of ${b.hpMax.toFixed(2)} left`, 'ok');
    }).title = 'the nearest tree of the wall (or landmark piece) takes a blow of a tail\'s power: watch it wear down stage by stage';
    button(grid, 'Wreck wall', () => {
      const D = w()?.destructibles, at = p();
      if (!D || !at) return;
      const R = Math.hypot(at.x, at.z) || 1, ox = at.x / R, oz = at.z / R;
      let n = 0;
      for (let k = 0; k < 4; k++) n += D.strike(ox * (34 + k * 4), oz * (34 + k * 4), 5, 2.5, { kind: 'blast', by: 'boss', dx: ox, dz: oz, src: D.swing() });
      w()?.ignite?.(ox * 40, oz * 40, 4, 1, false);
      this._status(`the wall behind the hero: ${n} blows, and fire (the ground opens there as the trees come down: walk out)`, 'ok');
    }).title = 'blasts and fire in the wall straight out behind the hero (a stretch torn open: the hero and the wyrm may go out through it)';
    // (ADR-125: the edge of the open ground follows what stands of the wall)
    button(grid, 'Open wall', () => {
      const D = w()?.destructibles, E = w()?.edge, at = p();
      if (!D || !E || !at) return this._status('this level has no wall that opens', '');
      const a0 = Math.atan2(at.z, at.x);
      let n = 0;
      for (const b of D.list) {
        if (b.state !== 0 || !(b.def?.edge > 0)) continue;
        const r = Math.hypot(b.x, b.z);
        let da = Math.atan2(b.z, b.x) - a0;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (r > 52 || Math.abs(da) > 0.3) continue;
        D.topple(b, b.x / r, b.z / r, 'world');
        n++;
      }
      this._status(n ? `${n} trees of the wall fall outward behind the hero: a gap ~${Math.round(0.6 * 34)} m wide, 20 m deep` : 'nothing stands there any more', n ? 'ok' : '');
    }).title = 'fells every tree of the wall in a wedge straight out from the hero, out to 52 m: the ground opens, the minimap redraws, the wyrm can follow (on a walk edge, Cinderwood since ADR-197, the hero already walks there: it opens ground for the wyrm only)';
    button(grid, 'Restore', () => {
      // (a hero out among the trees of a walk edge goes back to the bonfire first, as the level's own
      // reset does: the restored wood must not stand up round him; ADR-197)
      const out = !!w()?.edge?.out;
      if (out) this.game.flow?._respawnPlayer?.();
      w()?.scorch?.reset?.();
      w()?.restore?.();
      this._status(out ? 'the world stands again (the hero back at the bonfire)' : 'the world stands again', 'ok');
    }).title = 'everything broken stands again, the fire is out, the marks are gone';
    this._buildLife(body);
  }

  /** The living world, piece by piece (world/life/; ?life=, ?lifeK=): on / off each, its strength, and
   *  the buttons its layers registered (life.action). */
  _buildLife(body) {
    const life = this.game.world?.life;
    if (!life?.enabled) return;
    const row = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'life', row).title = 'the living world, piece by piece (world/life/life.js; ?life=off|all|wind,litter,...)';
    const grid = el('div', 'lab-grid c4', null, row);
    grid.style.flex = '1';
    const TIPS = {
      wind: 'one shared wind: gust fronts through the grass, the trees, smoke and letters',
      litter: 'leaves (ash, paper, grit) that fall, lie on the ground and lift again',
      steps: 'footsteps that answer the surface',
      weather: "the level's slow spells (mist, a drizzle, an ember squall)",
      creatures: 'birds, moths and fireflies that mind the hero',
      air: 'the sound of the air',
      arrival: 'the camera opens wide over the level as the player enters (from the title only)',
      answer: 'the world answers the fight: a roar is a gust front, the hush before a great blow',
    };
    this.ui.lifeBtns = LIFE.pieces.map((s) => {
      const b = button(grid, s, () => {
        LIFE.on[s] = !LIFE.on[s];
        this._syncLifeBtns();
      });
      b.title = `${TIPS[s] ?? s} (?life=${s})`;
      return { s, el: b };
    });
    const row2 = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'life x', row2).title = 'the strength of all of it (?lifeK=)';
    const grid2 = el('div', 'lab-grid c4', null, row2);
    grid2.style.flex = '1';
    button(grid2, 'all / off', () => {
      setLife(LIFE.pieces.some((s) => LIFE.on[s]) ? 'off' : 'all');
      this._syncLifeBtns();
    }).title = 'every piece on, or every piece off (?life=all, ?life=off)';
    this.ui.lifeKBtns = [['quiet', 0.6], ['natural', 1], ['strong', 1.5]].map(([label, k]) => {
      const b = button(grid2, label, () => {
        setLifeK(k);
        this._syncLifeBtns();
      });
      b.title = `?lifeK=${k}`;
      return { k, el: b };
    });
    if (life.actions.length) {
      const grid3 = el('div', 'lab-grid', null, body);
      for (const a of life.actions) {
        button(grid3, a.label, () => {
          try {
            const r = a.run();
            this._status(typeof r === 'string' ? r : a.label, 'ok');
          } catch (err) {
            this._status(`${a.label}: ${err?.message ?? err}`, '');
          }
        }).title = a.title || a.label;
      }
    }
    this._syncLifeBtns();
  }

  _syncLifeBtns() {
    for (const { s, el: b } of this.ui.lifeBtns ?? []) setClass(b, 'on', LIFE.on[s] === true);
    for (const { k, el: b } of this.ui.lifeKBtns ?? []) setClass(b, 'on', Math.abs(LIFE.k - k) < 0.01);
  }

  _buildPlayer(root) {
    const { body } = this._section(root, 'player', 'PLAYER');
    const grid = el('div', 'lab-grid', null, body);
    this.ui.godBtn = button(grid, 'God mode', () => this._togglePlayerFlag('god', 'god mode'));
    this.ui.flaskBtn = button(grid, 'Inf. flasks', () => this._togglePlayerFlag('infiniteFlasks', 'infinite flasks'));
    button(grid, 'Full heal', () => this._call(this.game.player, 'player', 'heal'));
    const row = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'tp', row);
    const tp = el('div', 'lab-grid', null, row);
    tp.style.flex = '1';
    button(tp, 'Front 8m', () => this._teleport('front')).title = '8 m in front of the dragon, facing it';
    button(tp, 'Behind', () => this._teleport('behind')).title = '8 m behind the dragon, facing it';
    button(tp, 'Bonfire', () => this._teleport('bonfire'));
    // the pace of the hero's swings (player.debug.attackSpeed): for finding the speed that feels right
    const sp = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'atk', sp).title = 'attack speed: every swing runs this much faster (1 = the pace of the game)';
    this.ui.atkSpeed = slider(sp, { min: 0.6, max: 1.6, step: 0.05, value: 1 }, (v) => {
      const pd = this.game.player?.debug;
      if (pd) pd.attackSpeed = v;
      setText(this.ui.atkSpeedVal, `x${v.toFixed(2)}`);
    });
    this.ui.atkSpeedVal = el('span', 'lab-val', 'x1.00', sp);
    // the stance he stands in (stances.js; player.debug.fightStance): the game's choice (the fight
    // stance while locked on or in a boss fight), or hold one of the two to look at it
    const stc = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'stance', stc).title = 'the stance he stands in: at ease, or the guard he takes in a fight';
    const stGrid = el('div', 'lab-grid', null, stc);
    stGrid.style.flex = '1';
    this.ui.stanceBtns = [['auto', null, 'the game decides: the fight stance while locked on or in a boss fight'], ['at ease', false, 'hold the at-ease stance'], ['fight', true, 'hold the fight stance']].map(([name, v, tip]) => {
      const btn = button(stGrid, name, () => {
        const pd = this.game.player?.debug;
        if (pd) pd.fightStance = v;
        this._syncStanceBtns();
      });
      btn.title = tip;
      return { v, el: btn };
    });
    this._syncStanceBtns();
    // the hero's idles (player/idles.js, ADR-186; ?idles=old): rests, habits and tricks, or the hand on the
    // belt as before; and a button for each, to play it now (the rests and the actions of the stance he
    // stands in: at ease, or the fight's)
    const idr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'idles', idr).title = "the hero's idles: the reference's stand and two-handed hold (ref, the default), ADR-186's rests, habits with both arms and a trick every few (new), or the hand on the belt (old)";
    const idg = el('div', 'lab-grid', null, idr);
    idg.style.flex = '1';
    this.ui.idleBtns = IDLES_IDS.map((m) => {
      const b = button(idg, m, () => {
        setIdles(m);
        this._syncIdleBtns();
      });
      b.title = `?idles=${m}: ${IDLES_NAMES[m]}`;
      return { m, el: b };
    });
    // the hero's fight hold (player/refStance.js, ADR-275; ?hold=): the middle guard (the owner's pick), the
    // two-handed hold before, and the three turned down
    const hdr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'hold', hdr).title = "the hero's fight stance: the middle guard (a, the default), the hold before (ref, ?hold=ref) or the three turned down (b high, c sword fingers, d low trailing)";
    const hdg = el('div', 'lab-grid', null, hdr);
    hdg.style.flex = '1';
    this.ui.holdBtns = HOLD_IDS.map((m) => {
      const b = button(hdg, m, () => {
        setHold(m);
        syncStandArm();
        this._syncIdleBtns();
      });
      b.title = `?hold=${m}: ${HOLD_NAMES[m]}`;
      return { m, el: b };
    });
    // the hero's guard (player/refStance.js, ADR-207; ?guard=ward): the reference's braced guard, the blade
    // upright, or the cross ward before it
    const gdr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'guard', gdr).title = "the hero's block: the braced guard with the blade upright (ref, the default) or the cross ward before it (?guard=ward)";
    const gdg = el('div', 'lab-grid', null, gdr);
    gdg.style.flex = '1';
    this.ui.guardBtns = GUARD_IDS.map((m) => {
      const b = button(gdg, m, () => {
        setGuard(m);
        this._syncIdleBtns();
      });
      b.title = `?guard=${m}: ${GUARD_NAMES[m]}`;
      return { m, el: b };
    });
    const idp = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'idle ▸', idp).title = 'play one now (stand still; at ease or in the fight stance: the stance row holds either; a rest or a moment of another idles mode says so)';
    const idpg = el('div', 'lab-grid', null, idp);
    idpg.style.flex = '1';
    const playIdle = (name, rest) => {
      const A = this.game.player?.anim;
      const ok = rest ? A?.setRest?.(name) : A?.playIdle?.(name);
      this._status(`${rest ? 'rest' : 'idle'} ${name}${ok ? '' : ': not in this stance (or he is moving)'}`, ok ? 'ok' : 'warn');
    };
    for (const [list, rest, tip] of [[EASE_RESTS, true, 'at ease (new): move to this rest'], [EASE_HABITS, false, 'at ease: a habit'], [EASE_TRICKS, false, 'at ease: a trick'], [EASE_REF_EXTRA, false, 'at ease (ref): the put-away and the draw'], [FIGHT_RESTS, true, 'in the fight (new): this guard hand'], [FIGHT_ACTS, false, 'in the fight: a habit (ref: grip, shift, loosen)']]) {
      for (const D of list) button(idpg, D.name, () => playIdle(D.name, rest)).title = tip;
    }
    this._syncIdleBtns();
    // the look of a landed cut (combat/cutFx.js; the owner's pick): the slash line, or a fan of sparks
    const cut = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'cut', cut).title = 'the look of a landed cut (combat/cutFx.js)';
    const cutGrid = el('div', 'lab-grid', null, cut);
    cutGrid.style.flex = '1';
    this.ui.cutBtns = ['gash', 'fan'].map((s) => {
      const b = button(cutGrid, s, () => {
        setCutStyle(s);
        this._syncCutBtns();
      });
      b.title = s === 'gash' ? 'a tapered slash line across the body, along the cut' : 'no line: a wider fan of sparks along the cut';
      return { s, el: b };
    });
    // a struck duelist's shudder through the freeze (drawn only; duelist.js shudderK)
    this.ui.shudBtn = button(cutGrid, 'shudder', () => {
      const d = this.game.dragon;
      if (d && 'shudderK' in d) d.shudderK = d.shudderK > 0 ? 0 : 1;
      this._syncCutBtns();
    });
    this.ui.shudBtn.title = 'a struck duelist flickers along the cut through the freeze (on / off)';
    // the weight of a landed cut, piece by piece (combat/impact.js; ?impact=): on / off each
    const imp = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'impact', imp).title = 'the weight of a landed cut, piece by piece (combat/impact.js)';
    const impGrid = el('div', 'lab-grid', null, imp);
    impGrid.style.flex = '1';
    const IMPACT_TIPS = {
      stamp: 'the hit as a short ASCII animation printed at the contact',
      ripple: 'the letters of the struck body take the blow',
      react: 'the body answers by where it was hit',
      thump: 'the low end of a heavy hit, a short dip of the music',
    };
    this.ui.impactBtns = IMPACT.pieces.map((s) => {
      const b = button(impGrid, s, () => {
        IMPACT.on[s] = !IMPACT.on[s];
        this._syncCutBtns();
      });
      b.title = IMPACT_TIPS[s] ?? s;
      return { s, el: b };
    });
    // calm at the contact (combat/impactCalm.js; ?calm=): cycles 0 (as before) … 3
    this.ui.calmBtn = button(impGrid, `calm ${calmLevel()}`, () => {
      setCalm((Math.max(0, calmLevel()) + 1) % CALM_LOOK.levels.length);
      this._syncCutBtns();
    });
    this.ui.calmBtn.title = "today's flare at the contact toned down: 0 as before, 1 the default, 2 and 3 calmer";
    // the streak pass, piece by piece (combat/streak.js; ?streakfx=), and the look of a single perfect
    // parry / dodge (?perfect=): cycles today / sharp / cinema
    const stk = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'streak', stk).title = 'the streak pass, piece by piece (combat/streak.js)';
    const stkGrid = el('div', 'lab-grid', null, stk);
    stkGrid.style.flex = '1';
    this.ui.streakBtns = STREAK_FX.pieces.map((s) => {
      const b = button(stkGrid, s, () => {
        STREAK_FX.on[s] = !STREAK_FX.on[s];
        this._syncCutBtns();
      });
      return { s, el: b };
    });
    this.ui.tempoBtn = button(stkGrid, 'tempo', () => {
      STREAK_FX.tempo = !STREAK_FX.tempo;
      this._syncCutBtns();
    });
    this.ui.tempoBtn.title = "the storm's tempo (?tempo=0 off): the first cut a heavy beat, each later one a share of the one before; off = the storm as it was (ADR-167). Only with 'storm' on; read as a flurry starts";
    this.ui.chainBtn = button(stkGrid, 'chain', () => {
      STREAK_FX.chain = !STREAK_FX.chain;
      this._syncCutBtns();
    });
    this.ui.dodgeBtn = button(stkGrid, `dodgefx: ${STREAK_FX.dodgefx || 'off'}`, () => {
      const L = ['', 'a', 'b', 'c', 'd'];
      STREAK_FX.dodgefx = L[(L.indexOf(STREAK_FX.dodgefx || '') + 1) % L.length];
      this._syncCutBtns();
    });
    this.ui.dodgeBtn.title = "the dodge looks (?dodgefx=): off; or a man's flurry gains smeared copies along each dash, floor kicks and aerial cuts (cut 1 from 4 cuts, cut 0 from 6), plus: a = Thunder Thrust, a fourth art (low set, one smeared step, the lunge held, a bloom at the point, tendrils over the floor); b = a bloom at the blade's point and tendrils on every contact; c = a cloud of falling sparks round the foe; d = a heavier finish (longer wind-up and held landing, a camera push). Read as a flurry starts";
    this.ui.figureBtn = button(stkGrid, `figure: ${STREAK_FX.figure}`, () => {
      const L = STREAK_FX.figures;
      STREAK_FX.figure = L[(L.indexOf(STREAK_FX.figure) + 1) % L.length];
      this._syncCutBtns();
    });
    this.ui.figureBtn.title = "the shape the flurry's chained passes draw (?figure=): 'any' a different one each flurry, or one pinned (star, zigzag, cage, spiral, cross). Read as a flurry starts";
    this.ui.chainBtn.title = "the flurry's chain (?chain=0 off): each pass starts where the last ended (A -> B -> C), every slash on the path he ran, letter dust on the last blow; off = the ring-teleport paths, the crescents and the 'A' shards as before. Read as a flurry starts";
    // the time rip (player/timeRip.js; ?rip=): cycles off / tear / strip / ghosts / negative, read at every cut
    this.ui.ripBtn = button(stkGrid, `rip: ${ripMode()}`, () => {
      setRipMode(RIP_MODES[(RIP_MODES.indexOf(ripMode()) + 1) % RIP_MODES.length]);
      this._syncCutBtns();
    });
    this.ui.ripBtn.title = "what a flurry's flash cut does to the picture (?rip=): off, tear (a hairline that splits open a beat later), strip (the letters along the cut slide apart for three frames), ghosts (still copies of him along the line, then they shatter), negative (the line prints in negative for two frames)";
    this.ui.perfectBtn = button(stkGrid, `perfect: ${perfectMode()}`, () => {
      const M = STREAK_FX.perfectModes;
      setPerfectMode(M[(M.indexOf(perfectMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.perfectBtn.title = 'the look of a single perfect parry / dodge: today, sharp or cinema';
    this.ui.parryFxBtn = button(stkGrid, `parryFx ${parryFxMode()}`, () => {
      const M = PARRY_FX.opts;
      setParryFx(M[(M.indexOf(parryFxMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.parryFxBtn.title = "the perfect parry's spit of sparks (?parryFx=): a (the default) a few fast orange sparks off the crossed steel, 0 the parry as before";
    this.ui.parryGrowBtn = button(stkGrid, `parryGrow ${parryGrowMode()}`, () => {
      setParryGrow(parryGrowMode() === 'a' ? '0' : 'a');
      this._syncCutBtns();
    });
    this.ui.parryGrowBtn.title = "a parry chain grows (?parryGrow=): a = more sparks each streak tier, embers that linger, a short heat flash at the blades; 0 = as before";
    this.ui.riposteBtn = button(stkGrid, `riposte ${riposteMode()}`, () => {
      const M = RIPOSTE_CUT.opts;
      setRiposteMode(M[(M.indexOf(riposteMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.riposteBtn.title = "the answer to a parried last blow against a duelist (?parryRiposte=): old (the default) the flurry's flash cuts, planted: he stays where he parried and cuts once, the foe reels; deathblow: parries build posture (not the dodge streak), a parry that breaks him or meets a blue blow is answered by a planted combo of as many blows as perfect parries behind it. Read as the riposte starts";
    this.ui.dbfxBtn = button(stkGrid, `dbfx ${getDbFx()}`, () => {
      const M = DB_FX.opts;
      setDbFx(M[(M.indexOf(getDbFx()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.dbfxBtn.title = "the deathblow's hit effect (?dbfx=): a Steel Bloom (orange heat bloom, sparks, embers), b Shatter Web (long cut-lines through him that snap on the finisher), c Storm Crack (lightning crawling over him, a bolt on the finisher), d Gold Crescent (gold arcs along each swing)";
    this.ui.dbreadBtn = button(stkGrid, `dbread ${dbReadMode()}`, () => {
      const M = DB_READ.opts;
      setDbRead(M[(M.indexOf(dbReadMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.dbreadBtn.title = "the parry -> deathblow exchange made readable (?dbread=; ADR-264): a the break (he is thrown open, reeling, and the hero holds a beat before he steps in), b space (the hero strikes from 1.3 m and every blow drives him back), c a clean contact (the contact's flash smaller and off the wound, the exit burst thinner, his white hurt flash dim), all the three, 0 as before. Read at the parry";
    this.ui.parryKindBtn = button(stkGrid, `parry ${PARRY_KIND.mode}`, () => {
      const M = PARRY_KIND.opts;
      setParryKind(M[(M.indexOf(PARRY_KIND.mode) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.parryKindBtn.title = "the parry (?parry=; ADR-279): one, every parry is a perfect parry (its look, freeze and rewards) anywhere in the 0.22 s window; two, as before: a press 0.20 - 0.22 s early is a plain parry";
    this.ui.dbLockBtn = button(stkGrid, `dbLock ${dbLockMode()}`, () => {
      const M = DB_LOCK.opts;
      setDbLock(M[(M.indexOf(dbLockMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.dbLockBtn.title = "a perfect parry of a blue blow that would cross the blades (?dbLock=; ADR-280): combo, the deathblow combo takes it (he recoils, the combo follows); lock, the blade lock as before. Read at the parry";
    this.ui.strikeGapBtn = button(stkGrid, `strikeGap ${strikeGapMode()}`, () => {
      const M = STRIKE_GAP.opts;
      setStrikeGap(M[(M.indexOf(strikeGapMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.strikeGapBtn.title = "how near a duelist's blade blow brings him (?strikeGap=; ADR-264): a 1.5 m, b 1.8 m centre to centre (never past what the blow reaches), so the swords meet in the open and a parry's clash reads; 0 as before";
    this.ui.parryClashBtn = button(stkGrid, `parryClash ${parryClashMode()}`, () => {
      const M = PARRY_CLASH.opts;
      setParryClash(M[(M.indexOf(parryClashMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.parryClashBtn.title = "the perfect parry's gold clash and mark drawn smaller so the crossing blades show (?parryClash=; ADR-264): a 0.55 x the mark, 0.6 x the burst; b the X alone at 0.4 x, no rings, 0.4 x the burst; the sparks off the steel as they are; 0 as before";
    this.ui.blueTellBtn = button(stkGrid, `blueTell ${blueTellMode()}`, () => {
      const M = BLUE_TELL_LOOK.opts;
      setBlueTell(M[(M.indexOf(blueTellMode()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.blueTellBtn.title = "a duelist's blue (parry) tell (?blueTell=; ADR-264): a = a small cross on his blade dyed blue (no rays, no ring), 0 = the big white star with its ring";
    this.ui.blackBtn = button(stkGrid, `black ${getBlack()}`, () => {
      const M = BLACK.opts;
      setBlack(M[(M.indexOf(getBlack()) + 1) % M.length]);
      this.game.blackout?.clear();
      this._syncCutBtns();
    });
    this.ui.blackBtn.title = "a black (charged) blow's look (?black=; ADR-271): 0 = the violet eclipse, body and flare as before; a = the blackout: the picture drains to dark grey over the last 0.3 s before the cue, the boss stays lit with a white point on the striking part, colour snaps back on the strike; b = as a, the dark builds through the whole charge; c = as a, darker. Default b (the owner's pick)";
    this.ui.blackImpactBtn = button(stkGrid, `blackImpact ${getBlackImpact()}`, () => {
      const M = BLACK_IMPACT.opts;
      setBlackImpact(M[(M.indexOf(getBlackImpact()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.blackImpactBtn.title = "a black blow's landing (?blackImpact=; ADR-271): a (the default) = hit or miss, it lands with a blast: a crater, what stands near breaks, a shock front of dust, a hard shake, a held frame, an explosion's sound; 0 = only what its move did before";
    this.ui.redTrailBtn = button(stkGrid, `redTrail ${getRedTrail()}`, () => {
      const M = RED_TRAIL.opts;
      setRedTrail(M[(M.indexOf(getRedTrail()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.redTrailBtn.title = "a red blow's blade trail (?redTrail=; ADR-271): 0 = none (as before); a (the default, the owner's pick) = from the red flare on, every cut leaves a thin red crescent just outside its edge (~0.2 s); b = the same, longer (~0.45 s). Blades only";
    this.ui.dbmatrixBtn = button(stkGrid, `dbmatrix ${getDbMatrix()}`, () => {
      const M = DB_MATRIX.opts;
      setDbMatrix(M[(M.indexOf(getDbMatrix()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.dbmatrixBtn.title = "the deathblow's code (?dbmatrix=): rain = columns of tiny green letters falling round the fight (they freeze in every hit-pause, burst on the finisher) with a light green cast; world = the whole frame goes green-on-black code view with blinking letters and a scan line; 0 = the cold cast only. Read as the combo starts";
    this.ui.dbsfxBtn = button(stkGrid, `dbsfx ${getDbSfx()}`, () => {
      const M = DB_SFX.opts;
      setDbSfx(M[(M.indexOf(getDbSfx()) + 1) % M.length]);
      this._syncCutBtns();
    });
    this.ui.dbsfxBtn.title = "the deathblow's sound (?dbsfx=): 0 the dodge flurry's sounds, a Flesh (wet tear per blow, deep impact), b Steel (metal strike and ring, a huge clang), c Cinematic (muffled thump, reverse swell, deep boom)";
    this.ui.burstBtn = button(stkGrid, `burst ${burstLevel()}`, () => {
      setBurst((Math.max(0, burstLevel()) + 1) % BURST_LOOK.levels.length);
      this._syncCutBtns();
    });
    this.ui.burstBtn.title = "the flurry's last blow: 0 as before, 1 - 3 lines instead of the white burst";
    // the sound passes (audio/samples.js; ?sfx=new): old (the default) = the original synth sounds (a tick on
    // every tell, all synth); new = cues on blue / red only, recorded / designed where loaded, each boss's
    // blade or fist through the air
    const sfr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'sfx', sfr).title = 'the sound effects: old = the original synth (the default), new = the recorded / designed sounds of the sound passes (?sfx=new)';
    const sfGrid = el('div', 'lab-grid', null, sfr);
    sfGrid.style.flex = '1';
    this.ui.sfxBtns = ['old', 'new'].map((m) => {
      const b = button(sfGrid, m, () => {
        setSfxMode(m);
        this._syncCutBtns();
      });
      b.title = m === 'new'
        ? 'the sound passes: cues on blue / red blows only, recorded / designed sounds where loaded, a boss blade or fist through the air'
        : 'the original synth (the default): a tick on every tell, the flash ping on every blow, all synth, no boss swing sound';
      return { m, el: b };
    });
    this.ui.sfxNote = el('span', 'lab-note', '', sfGrid);
    // the deflect chain on the recorded parry (audio/parryChain.js; ?chain=): a weight, b doubled strike,
    // c long ring (the synth parry, ?sfx=old, keeps its own climb)
    const chr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'chain', chr).title = 'the deflect chain on the recorded parry (?chain=a|b|c)';
    const chGrid = el('div', 'lab-grid', null, chr);
    chGrid.style.flex = '1';
    this.ui.chainBtns = CHAIN_MODES.map((m) => {
      const b = button(chGrid, `${m}: ${PARRY_CHAIN[m].label}`, () => {
        setChainMode(m);
        this._syncCutBtns();
      });
      b.title = `parries in rhythm build: ${PARRY_CHAIN[m].label}`;
      return { m, el: b };
    });
    // the sword looks (gear/moonblade.js; the owner's pick, ?sword=): equip one (a rebuild: build-time
    // cost, Lab only)
    const swr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'sword', swr).title = "the sword looks for the owner's pick (?sword=)";
    const swGrid = el('div', 'lab-grid', null, swr);
    swGrid.style.flex = '1';
    this.ui.swordBtns = Object.keys(SWORD_PARAM).map((k) => {
      const b = button(swGrid, k, () => {
        const p = this.game.player;
        if (typeof p?.equip !== 'function') return this._status('n/a: player.equip()', 'warn');
        try {
          p.equip('weapon', SWORD_PARAM[k]);
          this._status(`player.equip(weapon, ${SWORD_PARAM[k]})`, 'ok');
        } catch (err) {
          console.error('[lab] player.equip failed', err);
          this._status(`error: player.equip: ${err?.message ?? err}`, 'err');
        }
        this._syncCutBtns();
      });
      b.title = `equip ${SWORD_PARAM[k]}`;
      return { k, el: b };
    });
    // the free arm on the run (player/runArms.js, ADR-187, ADR-204, ADR-229; ?runArm=a|b|c|d|e|f|old), live
    const rar = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'run arm', rar).title = "the free (left) arm on the run (?runArm=): natural = a runner's swing, pumping at a sprint; full pump = a runner's pump, the fist before the belly and the elbow high behind him; dash = swept back behind him; by speed = natural, the dash at a sprint; open (the default, the owner's pick) / wider = the full pump opened out from his side, so from behind the arm shows past the coat; before = the swing before";
    const raGrid = el('div', 'lab-grid', null, rar);
    raGrid.style.flex = '1';
    this.ui.runArmBtns = RUN_ARM_IDS.map((m) => {
      const b = button(raGrid, RUN_ARM_NAMES[m], () => {
        setRunArm(m);
        this._syncCutBtns();
      });
      b.title = `?runArm=${m}: ${RUN_ARM_NAMES[m]}`;
      return { m, el: b };
    });
    // the sword arm on the run (player/runSword.js, ADR-204, ADR-229; ?runSword=g2 (default)|g1|g3|nat|n1|n3|flail|b15..b45|a1..a4|hip|trail|swept|side|old), live
    const rsr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'run sword', rsr).title = "the sword arm on the run (?runSword=): forward at the hip = the blade points ahead, low at the right hip, and rocks with the forearm; trailing (the default, the owner's pick: the arm relaxed out at his side, the blade down and out to his right) / swept back / out to the side = the owner's sketch: the blade going on from the forearm's line, behind and down; before = the carry before (the blade trailing back on a cocked wrist)";
    const rsGrid = el('div', 'lab-grid', null, rsr);
    rsGrid.style.flex = '1';
    this.ui.runSwordBtns = RUN_SWORD_IDS.map((m) => {
      const b = button(rsGrid, RUN_SWORD_NAMES[m], () => {
        setRunSword(m);
        this._syncCutBtns();
      });
      b.title = `?runSword=${m}: ${RUN_SWORD_NAMES[m]}`;
      return { m, el: b };
    });
    // the free hand's look (player/gear/handLook.js, ?handLook=0|a-h): built with the rig, so a reload
    const hlr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'hand', hlr).title = "the free (left) hand's size and ink (?handLook=; reloads the page): before, a smaller, b smaller and shaded, c smaller and dark, d a leather glove, e an open hand, f a loose fist, g a fist (the default, the owner's pick), h a gauntlet fist";
    const hlGrid = el('div', 'lab-grid', null, hlr);
    hlGrid.style.flex = '1';
    for (const id of HAND_LOOK_IDS) {
      const b = button(hlGrid, `${id === '0' ? 'before' : id}`, () => {
        try {
          const u = new URL(globalThis.location.href);
          if (id === 'g') u.searchParams.delete('handLook');
          else u.searchParams.set('handLook', id);
          globalThis.location.href = u.toString();
        } catch (err) {
          this._status(`error: ${err?.message ?? err}`, 'err');
        }
      });
      b.title = `?handLook=${id}: ${HAND_LOOK_NAMES[id]}`;
      setClass(b, 'on', handLook().id === id);
    }
    // the sword's flame (player/swordMystic.js: green marks burning round the steel, on by default; ?mystic=0 is
    // today's blade), live
    const myr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'mystic', myr).title = "the sword's flame: tiny green marks burning round the steel (?mystic=0 turns it off)";
    const myGrid = el('div', 'lab-grid', null, myr);
    myGrid.style.flex = '1';
    this.ui.mysticBtns = MYSTIC_IDS.map((m) => {
      const b = button(myGrid, m === '0' ? 'off' : MYSTIC_NAMES[m], () => {
        setMystic(m);
        this._syncCutBtns();
      });
      b.title = `?mystic=${m}: ${MYSTIC_NAMES[m]}`;
      return { m, el: b };
    });
    // every swing's mark (slashFx.js, ?slash=arc) and the free hand in a one-handed swing (offHand.js,
    // ?offhand=side|back|quiet), live
    for (const [lbl, ids, set, key, tip, name] of [
      ['slash', SLASH_IDS, setSlash, 'slashBtns', "every swing's mark: line = the instant straight slash, arc = the curved crescent as before (?slash=arc)", (m) => m],
      ['combo', COMBO_IDS, setCombo, 'comboBtns', 'four light combos for the ending slash: prod = as it ships, a Iai, b Tempest, c Mountain, d Dancer (each with its feel and its free hand) (?combo=)', (m) => (m === '0' ? 'prod' : `${m} ${COMBOS[m].name}`)],
      ['counter', COUNTER_IDS, setCounterMode, 'counterBtns', 'the flash counter: chain (the default) = he strikes back after each one, three in a row and he reels; old = it ends his string and he reels at once (?counter=0)', (m) => (m === '0' ? 'old' : m)],
      ['endslash', PLACE_IDS, setPlace, 'placeBtns', "where the ending slash is drawn: target = ahead of him where the foe stands, body = across him, enemy = across what it hit, blade = along the blade's path (?endslash=)", (m) => m],
      ['endbeat', BEAT_IDS, setBeat, 'beatBtns', 'when the ending slash comes: beat = a short pause after the swing, 0 = as it ends (?endbeat=)', (m) => m],
      ['feel', FEEL_IDS, setFeel, 'feelBtns', "the swings' feel: prod = as it ships, snap = crisp, weight = grounded, flow = fluid; the same moves on another clock, each with its own free hand (?feel=)", (m) => (m === '0' ? 'prod' : m)],
      ['offhand', OFFHAND_IDS, setOffHand, 'offHandBtns', "the free hand in a one-handed swing: auto = the feel's own, prod = as it ships, side = loose at his side, back = behind his back, quiet = its gestures pulled in (?offhand=)", (m) => (m === '0' ? 'prod' : m)],
      ['clash', CLASH_IDS, setClashMode, 'clashBtns', "the clash dance against the duelists (?clash=): dance = parries in a row inside one of his moves pay more posture each (x1, x1.25, x1.5, x1.75), their ring rises a little, and his posture recovers more slowly as his health drops; dance is the default; old = the numbers before (?clash=0). Read at each parry", (m) => (m === '0' ? 'old' : m)],
      ['contact', CONTACT_IDS, setContactMode, 'contactBtns', "where blows meet (?contact=, ADR-259): a = every hit, block and guard is drawn ON what it strikes (the edge bites in, a fist lands on the body; held through the freeze, a heavy longer, then the swing carries on), the sparks at the meeting, and the body hit answers by where it was struck; b = a, and a boss's blow that would fall short is reached into (his drawn body eases into it, feet planted): the default, the owner's pick; c = b, and past the reach his whole drawn body steps in; old = as before. Read at each contact", (m) => (m === '0' ? 'old' : m === 'b' ? 'b reach' : m === 'c' ? 'c step' : m)],
    ]) {
      const r = el('div', 'lab-row', null, body);
      el('span', 'lab-lbl', lbl, r).title = tip;
      const g = el('div', 'lab-grid', null, r);
      g.style.flex = '1';
      this.ui[key] = ids.map((m) => {
        const b = button(g, name(m), () => {
          set(m);
          this._syncCutBtns();
        });
        b.title = `?${lbl}=${m}`;
        return { m, el: b };
      });
    }
    // the wyrm's heads (entities/dragon/heads.js, ?wyrmFace=): a build-time choice, so a page reload
    const wfr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'head', wfr).title = "the Cinder Wyrm's heads (?wyrmFace=; reloads the page): drake as it ships, old = the head before, the rest shown and passed on";
    const wfg = el('div', 'lab-grid', null, wfr);
    wfg.style.flex = '1';
    for (const f of WYRM_FACES) {
      const b = button(wfg, f, () => {
        try {
          const u = new URL(globalThis.location.href);
          u.searchParams.set('wyrmFace', f);
          globalThis.location.href = u.toString();
        } catch (err) {
          this._status(`error: ${err?.message ?? err}`, 'err');
        }
      });
      b.title = `the wyrm wears the ${f} head (?wyrmFace=${f})`;
      if (f === wyrmFace()) b.classList?.add('on');
    }
    // the drake's head from above (entities/dragon/faces.js, ?wyrmTop=; ADR-189): a build-time choice too
    const wtr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'top', wtr).title = "the drake head from above (?wyrmTop=; reloads the page): c as it ships (no eye glints, dark slim horns, a crest), 0 the head before, a no glints, b a + dark horns";
    const wtg = el('div', 'lab-grid', null, wtr);
    wtg.style.flex = '1';
    for (const t of WYRM_TOPS) {
      const b = button(wtg, t, () => {
        try {
          const u = new URL(globalThis.location.href);
          u.searchParams.set('wyrmTop', t);
          globalThis.location.href = u.toString();
        } catch (err) {
          this._status(`error: ${err?.message ?? err}`, 'err');
        }
      });
      b.title = `the drake wears top ${t} (?wyrmTop=${t})`;
      if (t === wyrmTop()) b.classList?.add('on');
    }
    // the builds of the wyrm (entities/dragon/looks.js, ?wyrmLook=): a build-time choice too
    const wlr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'build', wlr).title = 'the build of the Cinder Wyrm (?wyrmLook=; reloads the page): c as it ships (lean + ragged), 0 the wyrm before, a lean, b lean + fierce head';
    const wlg = el('div', 'lab-grid', null, wlr);
    wlg.style.flex = '1';
    for (const k of WYRM_LOOKS) {
      const b = button(wlg, k === '0' ? 'before' : k, () => {
        try {
          const u = new URL(globalThis.location.href);
          u.searchParams.set('wyrmLook', k);
          globalThis.location.href = u.toString();
        } catch (err) {
          this._status(`error: ${err?.message ?? err}`, 'err');
        }
      });
      b.title = `?wyrmLook=${k}`;
      if (k === wyrmLookId()) b.classList?.add('on');
    }
    // the zoom options (render/pipeline.js, ?zoomArt=): live, no reload
    const P = this.game.pipeline;
    if (typeof P?.setZoomArt === 'function') {
      const zr = el('div', 'lab-row', null, body);
      el('span', 'lab-lbl', 'zoom art', zr).title = 'the art letters as the camera pulls back (?zoomArt=a|b|c; a = today)';
      const zg = el('div', 'lab-grid', null, zr);
      zg.style.flex = '1';
      const zb = ['a', 'b', 'c'].map((m) => {
        const b = button(zg, m, () => {
          P.setZoomArt(m);
          for (const o of zb) o.classList?.toggle('on', o === b);
        });
        b.title = m === 'a' ? 'one letter size at every distance (today)' : m === 'b' ? 'smaller letters past the default distance: an object keeps its letters' : 'half of b';
        if (P.zoomArt === m) b.classList?.add('on');
        return b;
      });
    }
    // the flurry (player/flurry.js): a perfect dodge's answer at a streak of N, started on the boss
    // from where the hero stands; `art` pins the last blow's look (flurry.js ARTS) for the next ones
    const fr = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'flurry', fr).title = 'a perfect dodge at this streak, on the boss, now (player.debug.flurry(n))';
    const fg = el('div', 'lab-grid c6', null, fr);
    fg.style.flex = '1';
    for (const n of [1, 2, 3, 4, 5, 7]) button(fg, `x${n}`, () => this._flurry(n)).title = `${n} blow${n > 1 ? 's' : ''}: ${n - 1} flash cut${n === 2 ? '' : 's'} and the art`;
    const ar = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'art', ar).title = 'the last blow of the next flurries (player.debug.flurryArt); "any" = one at random, never the same twice';
    const ag = el('div', 'lab-grid', null, ar);
    ag.style.flex = '1';
    const air = typeof this.game.dragon?.onPlunge === 'function';
    const arts = Object.keys(ARTS).filter((k) => ARTS[k].air === air);
    this.ui.artBtns = [null, ...arts].map((k) => ({ k, el: button(ag, k ? ARTS[k].label : 'any', () => this._flurryArt(k)) }));
    const pinned = this.game.player?.debug?.flurryArt ?? null;
    for (const b of this.ui.artBtns) setClass(b.el, 'on', b.k === pinned);
    this._syncCutBtns();
  }

  _syncCutBtns() {
    for (const { s, el: b } of this.ui.cutBtns ?? []) setClass(b, 'on', cutStyle() === s);
    const d = this.game.dragon;
    setClass(this.ui.shudBtn, 'on', !!d && 'shudderK' in d && d.shudderK > 0);
    for (const { s, el: b } of this.ui.impactBtns ?? []) setClass(b, 'on', IMPACT.on[s] === true);
    for (const { s, el: b } of this.ui.streakBtns ?? []) setClass(b, 'on', STREAK_FX.on[s] === true);
    for (const { m, el: b } of this.ui.runArmBtns ?? []) setClass(b, 'on', runArmMode() === m);
    for (const { m, el: b } of this.ui.runSwordBtns ?? []) setClass(b, 'on', runSwordMode() === m);
    if (this.ui.tempoBtn) setClass(this.ui.tempoBtn, 'on', STREAK_FX.tempo !== false);
    if (this.ui.chainBtn) setClass(this.ui.chainBtn, 'on', STREAK_FX.chain !== false);
    if (this.ui.dodgeBtn) {
      this.ui.dodgeBtn.textContent = `dodgefx: ${STREAK_FX.dodgefx || 'off'}`;
      setClass(this.ui.dodgeBtn, 'on', !!STREAK_FX.dodgefx);
    }
    if (this.ui.figureBtn) this.ui.figureBtn.textContent = `figure: ${STREAK_FX.figure}`;
    if (this.ui.ripBtn) {
      this.ui.ripBtn.textContent = `rip: ${ripMode()}`;
      setClass(this.ui.ripBtn, 'on', ripMode() !== 'off');
    }
    for (const { m, el: b } of this.ui.mysticBtns ?? []) setClass(b, 'on', mysticMode() === m);
    for (const { m, el: b } of this.ui.slashBtns ?? []) setClass(b, 'on', slashMode() === m);
    for (const { m, el: b } of this.ui.offHandBtns ?? []) setClass(b, 'on', offHandMode() === m);
    for (const { m, el: b } of this.ui.feelBtns ?? []) setClass(b, 'on', feelMode() === m);
    for (const { m, el: b } of this.ui.comboBtns ?? []) setClass(b, 'on', comboMode() === m);
    for (const { m, el: b } of this.ui.counterBtns ?? []) setClass(b, 'on', counterMode() === m);
    for (const { m, el: b } of this.ui.placeBtns ?? []) setClass(b, 'on', placeMode() === m);
    for (const { m, el: b } of this.ui.beatBtns ?? []) setClass(b, 'on', beatMode() === m);
    for (const { m, el: b } of this.ui.clashBtns ?? []) setClass(b, 'on', clashMode() === m);
    for (const { m, el: b } of this.ui.contactBtns ?? []) setClass(b, 'on', contactMode() === m);
    if (this.ui.perfectBtn) this.ui.perfectBtn.textContent = `perfect: ${perfectMode()}`;
    if (this.ui.parryFxBtn) this.ui.parryFxBtn.textContent = `parryFx ${parryFxMode()}`;
    if (this.ui.parryGrowBtn) this.ui.parryGrowBtn.textContent = `parryGrow ${parryGrowMode()}`;
    if (this.ui.riposteBtn) this.ui.riposteBtn.textContent = `riposte ${riposteMode()}`;
    if (this.ui.dbfxBtn) this.ui.dbfxBtn.textContent = `dbfx ${getDbFx()}`;
    if (this.ui.dbreadBtn) this.ui.dbreadBtn.textContent = `dbread ${dbReadMode()}`;
    if (this.ui.dbLockBtn) this.ui.dbLockBtn.textContent = `dbLock ${dbLockMode()}`;
    if (this.ui.parryKindBtn) this.ui.parryKindBtn.textContent = `parry ${PARRY_KIND.mode}`;
    if (this.ui.strikeGapBtn) this.ui.strikeGapBtn.textContent = `strikeGap ${strikeGapMode()}`;
    if (this.ui.parryClashBtn) this.ui.parryClashBtn.textContent = `parryClash ${parryClashMode()}`;
    if (this.ui.blueTellBtn) this.ui.blueTellBtn.textContent = `blueTell ${blueTellMode()}`;
    if (this.ui.blackBtn) this.ui.blackBtn.textContent = `black ${getBlack()}`;
    if (this.ui.redTrailBtn) this.ui.redTrailBtn.textContent = `redTrail ${getRedTrail()}`;
    if (this.ui.blackImpactBtn) this.ui.blackImpactBtn.textContent = `blackImpact ${getBlackImpact()}`;
    if (this.ui.dbmatrixBtn) this.ui.dbmatrixBtn.textContent = `dbmatrix ${getDbMatrix()}`;
    if (this.ui.dbsfxBtn) this.ui.dbsfxBtn.textContent = `dbsfx ${getDbSfx()}`;
    if (this.ui.burstBtn) this.ui.burstBtn.textContent = `burst ${burstLevel()}`;
    if (this.ui.calmBtn) {
      this.ui.calmBtn.textContent = `calm ${calmLevel()}`;
      setClass(this.ui.calmBtn, 'on', calmLevel() !== 0);
    }
    const w = this.game.player?.loadout?.weapon;
    for (const { k, el: b } of this.ui.swordBtns ?? []) setClass(b, 'on', w === SWORD_PARAM[k]);
    for (const { m, el: b } of this.ui.sfxBtns ?? []) setClass(b, 'on', sfxMode() === m);
    for (const { m, el: b } of this.ui.chainBtns ?? []) setClass(b, 'on', chainMode() === m);
    const bank = this.game.audio?.samples;
    if (this.ui.sfxNote) setText(this.ui.sfxNote, bank ? `${bank.loaded}/${bank.total} files${bank.failed ? `, ${bank.failed} failed` : ''}` : 'no audio yet');
  }

  /** A flurry of `n` blows on the boss now (player.debug.flurry). */
  _flurry(n) {
    const r = this._call(this.game.player, 'player', 'flurry', [n], true);
    this._status(r ? `flurry x${n}${this.game.player?.flurry?.art ? ` · ${ARTS[this.game.player.flurry.art]?.label}` : ''}` : 'flurry: out of reach (within 30 m of the wyrm\'s head / 12 m of a duelist, fight started)', r ? 'ok' : 'warn');
  }

  /** Pin the art the next flurries end on (null: one at random). */
  _flurryArt(k, quiet = false) {
    const pd = this.game.player?.debug;
    if (pd) pd.flurryArt = k;
    for (const b of this.ui.artBtns ?? []) setClass(b.el, 'on', b.k === k);
    if (!quiet) this._status(`flurry art: ${k ? ARTS[k].label : 'any'}`, 'ok');
  }

  _buildTime(root) {
    const { body } = this._section(root, 'time', 'TIME');
    const grid = el('div', 'lab-grid c6', null, body);
    this.ui.timeBtns = TIME_STEPS.map((v) => {
      const b = button(grid, String(v), () => this.setTimeScale(v));
      b.title = v === 0 ? 'freeze' : `x${v}`;
      return { v, el: b };
    });
    el('div', 'lab-note', '0 = freeze · [ ] step while open · affects game time only', body);
  }

  _buildStates(root) {
    const { body } = this._section(root, 'state', 'STATE');
    const grid = el('div', 'lab-grid c4', null, body);
    this.ui.stateBtns = STATES.map((s) => ({ s, el: button(grid, s[0].toUpperCase() + s.slice(1), () => this._flowTo(s)) }));
  }

  /** Recorded music on / off (A/B against the synthesised score); the music restarts in the other. */
  _toggleTracks() {
    const A = this.game.audio;
    if (!A) return this._status('n/a: game.audio', 'warn');
    if (!A.tracks) A.unlock?.();
    const T = A.tracks;
    if (!T) return this._status('sound starts after the first key / tap', 'warn');
    T.enabled = !T.enabled;
    const mode = A.musicMode;
    A.setMusic('none');
    A.setMusic(mode);
    setClass(this.ui.soundBtn, 'on', T.enabled);
    this._status(T.enabled ? 'recorded music' : 'synthesised music', 'ok');
  }

  _buildView(root) {
    const { body } = this._section(root, 'view', 'VIEW');
    const show = el('div', 'lab-grid c2', null, body);
    button(show, 'Showroom', () => this.showroom()).title =
      'look-dev: fight on, AI off, god mode, hero 7 m in front of the wyrm, camera zoomed in';
    button(show, 'Camera default', () => this._cameraDistance(null)).title = 'back to the default camera distance';
    this.ui.touchBtn = button(show, 'Touch UI', () => this._toggleTouch());
    this.ui.touchBtn.title = 'show / hide the phone touch controls (stick + buttons, close camera, LOW quality); ?touch in the URL forces them';
    setClass(this.ui.touchBtn, 'on', !!this.game.touch?.active);
    this.ui.soundBtn = button(show, 'Recorded music', () => this._toggleTracks());
    this.ui.soundBtn.title = 'A/B the music: the recorded CC0 tracks (on) or the synthesised score (off); ?music=synth starts with it off (ADR-117)';
    setClass(this.ui.soundBtn, 'on', this.game.audio?.tracks?.enabled !== false);
    const row = el('div', 'lab-row', null, body);
    this.ui.hitBtn = button(row, 'Hitboxes', () => this.setHitboxes(!this.hitboxes));
    setClass(this.ui.hitBtn, 'on', this.hitboxes);
    this.ui.hitInfo = el('span', 'lab-grow', '', row);
    const lg = el('div', 'lab-legend', null, body);
    el('span', 'c', 'o hurt', lg);
    el('span', 'r', 'o attack', lg);
    el('span', 'w', 'o player (blue block, gold crit, violet i-frames)', lg);

    // model viewer: side-view framing for comparing the models with concept sheets
    el('div', 'lab-sub', 'MODEL VIEW', body);
    const mv = el('div', 'lab-grid c4', null, body);
    this.ui.mvTargets = [
      ['hero', 'Hero'],
      ['dragon', 'Dragon'],
    ].map(([key, label]) => ({ key, el: button(mv, label, () => this._mvPick({ target: key }, true)) }));
    this.ui.mvDark = button(mv, 'Dark', () => this._mvPick({ dark: !this.mvPick.dark }, false));
    this.ui.mvDark.title = 'hide the world (grass, ground, forest, stones, mist) for clean sheet-like renders';
    this.ui.mvExit = button(mv, 'Exit', () => this.modelView(null));
    this.ui.mvExit.title = 'back to the game camera (restores HUD, AI, god mode, world)';
    const ag = el('div', 'lab-grid c5', null, body);
    ag.style.marginTop = '3px';
    this.ui.mvAngles = VIEW_ANGLES.map(([key, label, p]) => {
      const b = button(ag, label, () => this._mvPick({ angle: key, mode: 'view' }, true));
      b.title = p.game ? 'gameplay camera: 58° pitch, world-fixed yaw, current rig distance (normal play size)' : `yaw ${p.yaw}° around its facing (0 front, 90 its left, 180 back, 270 its right), pitch ${p.pitch}°`;
      return { key, el: b };
    });
    this.ui.mvSpin = button(ag, 'Spin', () => this._mvPick({ mode: this.mvPick.mode === 'spin' ? 'view' : 'spin' }, true));
    this.ui.mvSpin.title = 'turntable: the camera circles the actor at eye level, one turn in 10 s';
    const lk = el('div', 'lab-grid c5', null, body);
    lk.style.marginTop = '3px';
    this.ui.mvSheet = button(lk, 'Sheet', () => this._mvPick({ mode: this.mvPick.mode === 'sheet' ? 'view' : 'sheet' }, true));
    this.ui.mvSheet.title = 'every angle at once: front, front 3/4, both sides, back, both rear 3/4 and the gameplay camera (×2), live';
    const LOOK = { ascii: ['ASCII', 'the game render: the hero as ASCII art'], solid: ['Solid', 'the bare geometry, plain-lit, no ASCII pass: geometry vs renderer problems'], source: ['Source', 'the ASCII pass input (flat part fills), no letters'], lines: ['Lines', 'only the ASCII pass ink lines'] };
    this.ui.mvLooks = VIEW_LOOKS.map((key) => {
      const b = button(lk, LOOK[key][0], () => this._mvPick({ look: key }, false));
      b.title = `hero look: ${LOOK[key][1]}`;
      return { key, el: b };
    });
    this.ui.mvInfo = el('div', 'lab-note', '', body);
    this._mvSync();
  }

  _buildReadout(root) {
    const { body } = this._section(root, 'readout', 'READOUT');
    const kv = (keys) => {
      const g = el('div', 'lab-kv', null, body);
      const out = {};
      for (const k of keys) {
        el('span', 'k', k, g);
        out[k] = el('span', 'v', '-', g);
      }
      return out;
    };
    el('div', 'lab-sub', 'DRAGON', body);
    this.ui.dv = kv(['state', 'action', 'hp', 'posture', 'phase', 'broken', 'ai']);
    el('div', 'lab-sub', 'PLAYER', body);
    this.ui.pv = kv(['state', 'hp', 'flasks', 'crit', 'blocking', 'cheats']);
    el('div', 'lab-sub', 'GAME', body);
    this.ui.gv = kv(['state', 'clock']);

    el('div', 'lab-sub', 'TIMING TRAINER', body);
    this.ui.next = el('div', 'lab-next', 'next: -', body);
    const bar = el('div', 'lab-bar', null, body);
    bar.title = 'time to impact: . before the window, = inside the parry (red: perfect-dodge) window, # now';
    this.ui.bar = bar;
    this.ui.barPre = el('span', 'p', '', bar);
    this.ui.barWin = el('span', 'w', '', bar);
    this.ui.barEnd = el('span', 'e', '|', bar);
    this.ui.res = [];
    for (let i = 0; i < 6; i++) {
      const row = el('div', 'lab-res', null, body);
      row.style.display = 'none';
      const chip = el('span', 'lab-chip', null, row);
      const tx = el('span', 'tx', '', row);
      const dr = el('span', 'dr', '', row);
      dr.title = 'actual impact minus the combat:tell prediction (impactIn)';
      this.ui.res.push({ row, chip, tx, dr });
    }
    el('div', 'lab-note', 'RMB / Space time relative to impact (negative = before)', body);
    el('div', 'lab-sub', 'EVENTS', body);
    this.ui.ev = [];
    for (let i = 0; i < 8; i++) {
      const row = el('div', 'lab-ev', null, body);
      const ts = el('span', 'ts', '', row);
      const nm = el('span', 'nm', '', row);
      const dt = el('span', 'dt', '', row);
      this.ui.ev.push({ row, ts, nm, dt });
    }
    this._bar(null, 0);
  }

  // ---------------------------------------------------------------- refresh
  _readAbilities() {
    try {
      const r = this.target?.debug?.abilities?.();
      return Array.isArray(r) ? r : null;
    } catch (err) {
      this._fail('abilities()', err);
      return null;
    }
  }

  _syncAbilities() {
    const list0 = this._readAbilities();
    const sig = list0 ? list0.map((a) => `${a?.name}|${a?.label}|${a?.tell}|${a?.phase}`).join(',') : 'n/a';
    if (sig === this._abSig) return;
    this._abSig = sig;
    this._abilities = list0 ? list0.filter((a) => a && typeof a.name === 'string' && a.name) : [];
    if (this.selected && !this._abilities.some((a) => a.name === this.selected)) {
      if (this.loop.on) this.setLoop(false);
      this.selected = null;
    }
    const host = this.ui.abList;
    if (!host) return;
    host.textContent = '';
    this._abButtons = [];
    if (!this._abilities.length) {
      el('div', 'lab-note', list0 ? 'no abilities listed' : 'n/a: dragon.debug.abilities()', host);
      return;
    }
    this._abilities.forEach((a, i) => {
      const b = button(host, null, () => this.trigger(a.name), 'lab-ab');
      el('span', 'k', i < 9 ? String(i + 1) : '', b);
      el('span', `lab-chip t-${tellName(a.tell)}`, null, b);
      el('span', 'n', String(a.label || a.name), b);
      el('span', 'ph', phaseTag(a.phase), b);
      b.title = `${a.name} · tell: ${tellName(a.tell)}${a.phase ? ` · phase ${a.phase}` : ''}`;
      this._abButtons.push({ name: a.name, el: b });
    });
    this._markSelected();
  }

  _markSelected() {
    for (const b of this._abButtons) setClass(b.el, 'sel', b.name === this.selected);
  }

  _syncTimeButtons() {
    const cur = finite(this.game.debugTimeScale, 1);
    for (const t of this.ui.timeBtns ?? []) setClass(t.el, 'on', Math.abs(t.v - cur) < 1e-6);
  }

  _actionText(d) {
    try {
      const a = d?.debug?.currentAction?.() ?? d?.brain?.action ?? null;
      if (!a) return '-';
      if (typeof a === 'string') return a;
      const name = a.name ?? a.def?.name ?? '?';
      const ph = typeof a.phase === 'string' ? ` · ${a.phase}` : '';
      const t = Number.isFinite(a.t) && Number.isFinite(a.dur) ? ` ${a.t.toFixed(2)}/${a.dur.toFixed(2)}` : '';
      return `${name}${ph}${t}`;
    } catch {
      return 'n/a';
    }
  }

  _refresh() {
    const g = this.game, u = this.ui;
    if (!u.dv) return;
    const d = this.target, p = g.player;
    const ddbg = d?.debug;
    setClass(u.touchBtn, 'on', !!g.touch?.active); // a first touch can switch it on behind our back

    // dragon
    const dv = u.dv;
    setText(dv.state, show(d?.state));
    setText(dv.action, d ? this._actionText(d) : 'n/a');
    const hpFrac = d && finite(d.maxHp) > 0 ? finite(d.hp) / d.maxHp : NaN;
    const hpPct = Number.isFinite(hpFrac) ? `  ${Math.round(hpFrac * 100)}%` : '';
    setText(dv.hp, d && Number.isFinite(d.hp) ? `${Math.round(d.hp)} / ${Math.round(finite(d.maxHp))}${hpPct}` : 'n/a');
    setText(dv.posture, d && Number.isFinite(d.posture) ? `${Math.round(d.posture)} / ${Math.round(finite(d.maxPosture))}` : 'n/a');
    setText(dv.phase, show(d?.phase));
    setText(dv.broken, typeof d?.broken === 'boolean' ? (d.broken ? 'BROKEN' : 'no') : 'n/a');
    const ai = ddbg?.aiEnabled;
    setText(dv.ai, typeof ai === 'boolean' ? (ai ? 'on' : 'OFF') : 'n/a');

    // player
    const pv = u.pv;
    setText(pv.state, show(p?.state));
    setText(pv.hp, p && Number.isFinite(p.hp) ? `${Math.round(p.hp)} / ${Math.round(finite(p.maxHp))}` : 'n/a');
    setText(pv.flasks, p && Number.isFinite(p.flasks) ? `${p.flasks} / ${show(p.maxFlasks)}` : 'n/a');
    setText(pv.crit, p && Number.isFinite(p.critTimer) ? (p.critTimer > 0 ? `OPEN ${p.critTimer.toFixed(2)}s` : '-') : 'n/a');
    setText(pv.blocking, typeof p?.blocking === 'boolean' ? (p.blocking ? 'YES' : 'no') : 'n/a');
    const pd = p?.debug;
    setText(pv.cheats, pd ? [pd.god && 'god', pd.infiniteFlasks && 'inf flasks'].filter(Boolean).join(', ') || '-' : 'n/a');

    // game
    setText(u.gv.state, show(g.state));
    const scale = finite(g.timeScale, 1) * finite(g.debugTimeScale, 1);
    setText(u.gv.clock, `t ${finite(g.time).toFixed(2)}s  x${+scale.toFixed(3)}  ${finite(g.fps)} fps`);

    // controls that mirror live values
    setClass(u.godBtn, 'on', !!pd?.god);
    setClass(u.flaskBtn, 'on', !!pd?.infiniteFlasks);
    setClass(u.godBtn, 'na', !pd);
    setClass(u.flaskBtn, 'na', !pd);
    setClass(u.aiBtn, 'on', ai === true);
    setClass(u.aiBtn, 'na', typeof ddbg?.setAI !== 'function');
    setText(u.aiBtn, ai === false ? 'AI off' : 'AI on');
    setClass(u.loopBtn, 'on', this.loop.on);
    setText(u.loopInfo, this.loop.on ? `${this.selected}: next ${Math.max(0, this.loop.every - this.loop.t).toFixed(1)}s · x${this.loop.count}` : this.selected ? `selected: ${this.selected}` : '');
    this._syncTimeButtons();
    for (const s of u.stateBtns ?? []) setClass(s.el, 'on', g.state === s.s);
    if (u.hp && !u.hp.drag && Number.isFinite(hpFrac)) {
      const v = Math.round(Math.max(0, Math.min(1, hpFrac)) * 100);
      if (Number(u.hp.el.value) !== v) u.hp.el.value = String(v);
      setText(u.hpVal, `${v}%`);
    }
    const c = this.overlay?.count;
    setText(u.hitInfo, this.hitboxes ? (c ? `${c.hurt} hurt · ${c.attack} attack · ${c.source}` : '') : 'off');
    this._mvSync();

    this._refreshTrainer();
  }

  /** Per-frame while open: the impact countdown + timing bar (two text nodes). */
  _refreshNext() {
    const u = this.ui;
    if (!u.next) return;
    const t = this.trainer, now = t.now;
    const nx = t.nextImpact(now);
    if (!nx) {
      if (this._hadNext) {
        this._hadNext = false;
        setText(u.next, 'next: -');
        this._bar(null, 0);
      }
      return;
    }
    this._hadNext = true;
    const inS = Math.max(0, nx.at - now);
    setText(u.next, `next: ${nx.attack || '?'} [${nx.tell}] impact in ${inS.toFixed(2)}s`);
    this._bar(nx.tell, inS);
  }

  _bar(tell, inS) {
    const u = this.ui;
    if (!u.bar) return;
    const cell = BAR_SPAN / BAR_CELLS;
    const win = tell === TELL.RED ? DEFENSE.perfectDodgeWindow : DEFENSE.parryWindow;
    const wStart = BAR_CELLS - Math.max(1, Math.round(win / cell));
    const cur = tell ? BAR_CELLS - 1 - Math.floor(inS / cell) : -1;
    // the bar only changes when the cursor crosses a cell: skip the string work otherwise
    const sig = `${tell}|${cur}`;
    if (sig === this._barSig) return;
    this._barSig = sig;
    let pre = '', w = '';
    for (let i = 0; i < BAR_CELLS; i++) {
      const ch = i === cur ? '#' : i < wStart ? '.' : '=';
      if (i < wStart) pre += ch;
      else w += ch;
    }
    setText(u.barPre, pre);
    setText(u.barWin, w);
    u.bar.className = `lab-bar t-${tell ?? 'normal'}`;
  }

  _refreshTrainer() {
    const t = this.trainer, u = this.ui;
    if (!u.res || this._trainerVer === t.version) return;
    this._trainerVer = t.version;
    for (let i = 0; i < u.res.length; i++) {
      const slot = u.res[i], r = t.results[i];
      if (!r) {
        slot.row.style.display = 'none';
        continue;
      }
      slot.row.style.display = '';
      slot.row.className = `lab-res ${r.cls}`;
      slot.chip.className = `lab-chip t-${r.tell}`;
      setText(slot.tx, `${r.attack}  ${r.text}${r.n > 1 ? `  x${r.n}` : ''}`);
      setText(slot.dr, r.drift === null ? '' : `Δ${r.drift > 0 ? '+' : ''}${r.drift}`);
      slot.dr.className = r.drift !== null && Math.abs(r.drift) > 60 ? 'dr off' : 'dr';
    }
    for (let i = 0; i < u.ev.length; i++) {
      const slot = u.ev[i], e = t.events[i];
      if (!e) {
        setText(slot.ts, '');
        setText(slot.nm, '');
        setText(slot.dt, '');
        continue;
      }
      slot.row.className = `lab-ev${e.tell ? ` t-${e.tell}` : ''}`;
      setText(slot.ts, `${e.t.toFixed(2).padStart(7)}  `);
      setText(slot.nm, e.label.padEnd(14));
      setText(slot.dt, `${e.detail}${e.n > 1 ? `  x${e.n}` : ''}`);
    }
  }

  /**
   * The floating LAB toggle (top centre): shown whenever the Lab exists in the page (?lab, or opened
   * once) or a Lab cheat is active; it opens / closes the panel (phones have no F1). While closed it
   * also lists the active cheats ("LAB · god · x0.25").
   */
  _syncBadge() {
    const g = this.game;
    const flags = [];
    const pd = g.player?.debug;
    if (pd?.god) flags.push('god');
    if (pd?.infiniteFlasks) flags.push('inf flasks');
    if (finite(pd?.attackSpeed, 1) !== 1) flags.push(`atk x${finite(pd.attackSpeed, 1).toFixed(2)}`);
    if (cutStyle() !== 'gash') flags.push(`cut ${cutStyle()}`);
    if (g.dragon && 'shudderK' in g.dragon && !(g.dragon.shudderK > 0)) flags.push('no shudder');
    const ts = finite(g.debugTimeScale, 1);
    if (ts !== 1) flags.push(ts === 0 ? 'FROZEN' : `x${ts}`);
    if (this.loop.on) flags.push(`loop ${this.selected}`);
    if (this.target?.debug?.aiEnabled === false) flags.push('AI off');
    const cheats = flags.join(' · ');
    const show = !!this.root || !!cheats;
    const sig = show ? (this.open ? 'open' : `closed|${cheats}`) : '';
    if (sig === this._badgeSig) return;
    this._badgeSig = sig;
    if (!show) {
      setClass(this.badge, 'lab-hidden', true);
      return;
    }
    if (!this.badge) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
      try {
        injectLabStyle();
        const host = document.getElementById?.('ui') ?? document.body;
        if (!host) return;
        this.badge = el('div', 'lab-badge lab-toggle', null, host);
        this.badge.title = 'Lab: show / hide the debug panel (F1)';
        this.badge.setAttribute?.('role', 'button');
        this.badge.addEventListener('click', () => this.toggle());
        this.badge.addEventListener('contextmenu', (e) => e.preventDefault?.());
      } catch (err) {
        this._fail('badge', err);
        return;
      }
    }
    setText(this.badge, this.open ? '× LAB' : cheats ? `LAB · ${cheats}` : 'LAB');
    setClass(this.badge, 'open', this.open);
    setClass(this.badge, 'cheats', !this.open && !!cheats);
    setClass(this.badge, 'lab-hidden', false);
  }
}
