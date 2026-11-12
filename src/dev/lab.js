import { CONFIG } from '../core/config.js';
import { DEFENSE, TELL } from '../combat/rules.js';
import { el, setText, setClass, button, slider, section } from './labDom.js';
import { injectLabStyle } from './labStyle.js';
import { HitboxOverlay } from './hitboxOverlay.js';
import { TimingTrainer, tellName } from './timingTrainer.js';
import { ModelViewer, VIEW_ANGLES, VIEW_LOOKS } from './modelView.js';

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
const STORE_KEY = 'abyss.lab.v1';
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
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
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
    const r = this._call(this.target, 'dragon', 'trigger', [name], quiet);
    if (r !== null && r !== false) this.trainer.dropPendingUpTo(mark);
    return r;
  }

  /** Phase 2 / stagger / posture break / kill: a fight action, so stand in 'boss' first if needed. */
  _fightAction(method) {
    if (method === 'kill') this.setLoop(false);
    this._prepareFlow();
    const r = this._dragon(method);
    // these interrupt the current attack: its announced impacts will never land
    if (r !== null && r !== false) this.trainer.clearPending();
    return r;
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

  /** Techniques (player.techniques / player.debug.qiFull): 'learn' | 'forget' | 'qi'. */
  _techs(what) {
    const p = this.game.player, book = p?.techniques;
    if (!book) {
      this._status('n/a: player.techniques', 'warn');
      return;
    }
    try {
      if (what === 'learn') book.learnAll();
      else if (what === 'forget') book.forget();
      else if (what === 'qi') p.debug?.qiFull?.();
      const slots = book.slots.map((s) => s ?? '-').join(' / ');
      this._status(what === 'qi' ? `Qi ${Math.round(p.qi)} / ${p.qiMax}` : `techniques: ${book.list().join(', ') || 'none'} · slots ${slots}${book.saved ? '' : ' (not saved)'}`, 'ok');
    } catch (err) {
      this._status(`techniques ${what} failed: ${err?.message ?? err}`, 'warn');
    }
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
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(this.prefs));
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
      el('span', 'lab-hint', 'F1 / ` toggle · 1-9 abilities · [ ] time', head);
      button(head, '×', () => this.setOpen(false), 'lab-close').title = 'close the Lab (F1)';
      this.ui.status = el('div', 'lab-status', 'ready', root);

      this._buildLevel(root);
      this._buildFight(root);
      this._buildAbilities(root);
      this._buildPlayer(root);
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

  _buildFight(root) {
    const { body } = this._section(root, 'fight', 'FIGHT');
    const grid = el('div', 'lab-grid', null, body);
    button(grid, 'Wake', () => this._wake()).title = 'play the wake-up intro';
    button(grid, 'Start fight', () => this._startFight()).title = 'skip the intro, straight into combat';
    button(grid, 'Reset', () => this._resetFight()).title = 'dragon back to sleep at the nest (mid-fight: flow -> explore, player to the bonfire)';
    button(grid, 'Phase 2', () => this._fightAction('phase2'));
    button(grid, 'Phase 3', () => this._fightAction('phase3')).title = 'the phase-3 transition roar: hotter, faster wyrm (opens with the nova when the AI runs)';
    button(grid, 'Stagger', () => this._fightAction('stagger'));
    button(grid, 'Posture break', () => this._fightAction('postureBreak'));
    button(grid, 'Kill', () => this._fightAction('kill'), 'danger');
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

  _buildPlayer(root) {
    const { body } = this._section(root, 'player', 'PLAYER');
    const grid = el('div', 'lab-grid', null, body);
    this.ui.godBtn = button(grid, 'God mode', () => this._togglePlayerFlag('god', 'god mode'));
    this.ui.flaskBtn = button(grid, 'Inf. flasks', () => this._togglePlayerFlag('infiniteFlasks', 'infinite flasks'));
    button(grid, 'Full heal', () => this._call(this.game.player, 'player', 'heal'));
    // techniques (ADR-054): learn / forget (the save follows), fill the Qi meter, free techniques
    const tg = el('div', 'lab-grid', null, body);
    button(tg, 'Learn techs', () => this._techs('learn')).title = 'learn every technique (each into a free slot; saved)';
    button(tg, 'Qi full', () => this._techs('qi')).title = 'fill the Qi meter';
    this.ui.qiBtn = button(tg, 'Inf. Qi', () => this._togglePlayerFlag('infiniteQi', 'infinite Qi'));
    this.ui.qiBtn.title = 'techniques cost no Qi';
    button(tg, 'Forget techs', () => this._techs('forget'), 'danger').title = 'forget every technique and empty the slots (saved)';
    const row = el('div', 'lab-row', null, body);
    el('span', 'lab-lbl', 'tp', row);
    const tp = el('div', 'lab-grid', null, row);
    tp.style.flex = '1';
    button(tp, 'Front 8m', () => this._teleport('front')).title = '8 m in front of the dragon, facing it';
    button(tp, 'Behind', () => this._teleport('behind')).title = '8 m behind the dragon, facing it';
    button(tp, 'Bonfire', () => this._teleport('bonfire'));
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

  _buildView(root) {
    const { body } = this._section(root, 'view', 'VIEW');
    const show = el('div', 'lab-grid c2', null, body);
    button(show, 'Showroom', () => this.showroom()).title =
      'look-dev: fight on, AI off, god mode, hero 7 m in front of the wyrm, camera zoomed in';
    button(show, 'Camera default', () => this._cameraDistance(null)).title = 'back to the default camera distance';
    this.ui.touchBtn = button(show, 'Touch UI', () => this._toggleTouch());
    this.ui.touchBtn.title = 'show / hide the phone touch controls (stick + buttons, close camera, LOW quality); ?touch in the URL forces them';
    setClass(this.ui.touchBtn, 'on', !!this.game.touch?.active);
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
    setText(pv.cheats, pd ? [pd.god && 'god', pd.infiniteFlasks && 'inf flasks', pd.infiniteQi && 'inf Qi'].filter(Boolean).join(', ') || '-' : 'n/a');

    // game
    setText(u.gv.state, show(g.state));
    const scale = finite(g.timeScale, 1) * finite(g.debugTimeScale, 1);
    setText(u.gv.clock, `t ${finite(g.time).toFixed(2)}s  x${+scale.toFixed(3)}  ${finite(g.fps)} fps`);

    // controls that mirror live values
    setClass(u.godBtn, 'on', !!pd?.god);
    setClass(u.flaskBtn, 'on', !!pd?.infiniteFlasks);
    setClass(u.godBtn, 'na', !pd);
    setClass(u.flaskBtn, 'na', !pd);
    setClass(u.qiBtn, 'on', !!pd?.infiniteQi);
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
    if (pd?.infiniteQi) flags.push('inf Qi');
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
