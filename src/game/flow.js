import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { clamp, damp, lerp } from '../core/math.js';
import { DEFENSE } from '../combat/rules.js';
import { ScreenGrade } from './grade.js';
import { RunStats } from './stats.js';

// Game flow: owns game.state and every transition
//   title → explore → bossIntro → boss → dead | victory   (+ paused from explore/bossIntro/boss)
// plus bonfire rest (E), retry after death, victory restart (R), pause (Esc), F2 quality, M mute,
// F3 fps, H help, the camera override for establishing / intro shots, the screen grade, run stats,
// and `debug.toState(name)` for the Lab (jump to explore / boss / dead / victory from any state).
// Gameplay events are queued and handled at the start of the next frame (robust to ordering and to
// events arriving while paused); every transition emits 'state' {from, to}.

const PLAY = new Set(['explore', 'bossIntro', 'boss']);
const FIGHTING = new Set(['combat', 'staggered', 'airborne']);
// settings keys don't skip screens; nor do modifiers / function keys (Alt-Tab, F11 fullscreen, F12 devtools)
// (Backquote opens the Lab)
const NON_DISMISS = new Set(['KeyM', 'KeyH', 'Escape', 'Backquote', 'ContextMenu', 'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen']);
const NON_DISMISS_RE = /^(F\d+|Alt|Control|Meta|OS)/;
const QUEUED = ['dragon:introDone', 'dragon:phase2', 'dragon:phase3', 'dragon:death', 'dragon:dead', 'player:died'];
const AREA = 'Cinderwood Hollow';
const DEBUG_STATES = new Set(['explore', 'boss', 'dead', 'victory']);
const DRAGON_DOWN = new Set(['dying', 'dead']);
const PHASE2_TEXT = "THE CINDER WYRM'S FURY IGNITES";
const PHASE3_TEXT = 'ITS HEART BURNS WHITE-HOT';

const TUNE = {
  restRadius: 2.4,
  restCooldown: 2,
  // establishing shot: focus most of the way from the player to the sleeping dragon, pulled back
  title: { toward: 0.88, weight: 0.8, zoom: 8, drift: 1.6, minTime: 0.5 },
  intro: { weight: 0.55, zoom: 6, lambda: 2.2, fallback: 14 },
  victoryCam: { weight: 0.35, zoom: 3 },
  // boss fight: pull the camera back / over so the hero + the whole (x1.875, ~30 m) wyrm stay in
  // view. Box = hero + dragon hurt spheres (tall parts lean up the screen by y * lean). Visible
  // ground per metre of camera distance (fov 32, pitch 58, 16:9, HUD bars): `north` / `south` of
  // the focus, `side` either way. When even maxZoom can't fit the box (spread wings + tail), the
  // focus is clamped so the hero stays `margin` m inside the view and the far end of the wyrm crops.
  // Fades back to the plain hero camera when the hero is farther than `far` m from the body.
  // maxZoom stays small on purpose: the hero must stay readable (owner feedback), the wyrm may crop
  bossCam: { weight: 1, lean: 0.6, margin: 3, north: 0.39, south: 0.22, side: 0.44, maxZoom: 5, near: 16, far: 36 },
  // phones (cameraRig.mobile): the close camera stays close (the rig also caps extra zoom); the wider
  // landscape screen shows more to the sides; the hero may sit lower (marginSouth: the bottom
  // centre is free, the thumbs cover the corners) so more of the wyrm shows above it
  bossCamMobile: { weight: 0.85, margin: 3.5, marginSouth: 1.6, north: 0.37, south: 0.24, side: 0.52, maxZoom: 2 },
  deathBannerDelay: 0.7,
  deathHold: 4.5,
  deathSlowmo: 0.35,
  deathSlowmoHold: 0.9,
  bossBarHideDelay: 2.4,
  statsDelay: 2.2,
  warmBoss: 0.35,
  warmPhase2: 0.7,
  warmVictory: 0.12,
  debugVictoryTimeout: 12, // s: Lab 'victory' forces the state if the dragon never reports its death
};

const BOSS_CAM_MOBILE = { ...TUNE.bossCam, ...TUNE.bossCamMobile };

const finite = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class GameFlow {
  constructor(game) {
    this.game = game;
    /** Read by main.js: null | { focus: Vector3, weight 0..1, zoom meters }. */
    this.cameraOverride = null;
    this._ov = { focus: new THREE.Vector3(), weight: 0, zoom: 0 };
    this._ovW = 0;
    this._ovZ = 0;
    this._ovLambda = 2;
    this._tmp = new THREE.Vector3();

    this.grade = new ScreenGrade(game);
    this.stats = new RunStats();
    this.queue = [];
    this.pausedFrom = null;
    this.stateTime = 0;
    this.phase2 = false;
    this.restCooldown = 0;
    this.slowmo = 1;
    this.slowmoHold = 0;
    this.respawning = null;
    this.titleFramed = false;
    this.introT = 0;
    this.deathT = 0;
    this.victoryT = 0;
    this.deathBanner = false;
    this.canRetry = false;
    this.statsShown = false;
    this.dragonDownT = -1; // seconds since 'dragon:death' (-1 = alive)
    this.deadPollT = 0;
    this.bossBarHideT = -1;
    this.hitWhileAsleep = false;
    this.audioUnlocked = false;
    this.autoPause = false;
    this.swallowInput = false;
    this.debugVictoryT = -1;
    this._ghostAt = -10;
    this._errors = 0;

    /** Lab hooks (contract): jump straight to a flow state with consistent side effects. */
    this.debug = {
      toState: (name) => {
        try {
          return this._debugToState(name);
        } catch (err) {
          this._report(`debug.toState(${name})`, err);
          return false;
        }
      },
    };

    const ev = game.events;
    for (const name of QUEUED) ev?.on(name, () => this.queue.push(name));
    ev?.on('dragon:hurt', () => {
      if (this.game.state === 'explore' && this._dragonAsleep()) this.hitWhileAsleep = true;
    });
    ev?.on('player:hurt', (d) => {
      const dmg = finite(d?.damage);
      this.stats.damageTaken += dmg;
      if (dmg > 0) this.grade.hurtPulse(dmg, d?.kind === 'burn');
    });
    ev?.on('player:heal', () => this.stats.flasksUsed++);
    ev?.on('player:hitDragon', (d) => {
      this.stats.damageDealt += finite(d?.damage);
      this.stats.hits++;
    });
    ev?.on('player:dodge', () => this.stats.dodges++);
    ev?.on('player:parry', () => this.stats.parries++);
    ev?.on('player:block', () => this.stats.blocks++);
    ev?.on('player:guardBreak', () => this.stats.guardBreaks++);
    // a perfect dodge and its Ghostep blink normally arrive together: count / pulse once
    const ghostep = () => {
      const now = finite(this.game.realTime);
      if (now - this._ghostAt < 0.4) return;
      this._ghostAt = now;
      this.stats.perfectDodges++;
      this.grade.ghostPulse(DEFENSE.ghostep.slowmoTime);
    };
    ev?.on('player:perfectDodge', ghostep);
    ev?.on('player:ghostep', ghostep);

    // Unlock audio inside the first real DOM gesture (autoplay policies), F3 must not open find.
    addEventListener('pointerdown', () => this._unlockAudio());
    addEventListener('keydown', (e) => {
      if (e.code === 'F2' || e.code === 'F3') e.preventDefault();
      this._unlockAudio();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause = true;
    });

    game.state = 'title';
    game.timeScale = 1;
    game.hud?.showTitle?.();
  }

  // ------------------------------------------------------------------ public
  update(dt, realDt) {
    const g = this.game;
    const rdt = clamp(finite(realDt), 0, 0.1);
    if (this.swallowInput && g.input) {
      g.input.enabled = true;
      this.swallowInput = false;
    }
    try {
      this._update(rdt);
    } catch (err) {
      this._report('update', err);
    }
    // always keep time + screen grade coherent, even after an error
    g.timeScale = g.state === 'paused' ? 0 : clamp(this.slowmo, 0.05, 1);
    try {
      this._gradeTargets();
      this.grade.update(rdt);
    } catch (err) {
      this._report('grade', err);
    }
  }

  /** Esc / pause menu. Only from explore, bossIntro or boss. */
  pause(on) {
    const g = this.game;
    if (on) {
      if (!PLAY.has(g.state)) return;
      this.pausedFrom = g.state;
      this._setState('paused');
      g.timeScale = 0;
      g.hud?.showPause?.(true);
    } else {
      if (g.state !== 'paused') return;
      const to = PLAY.has(this.pausedFrom) ? this.pausedFrom : 'explore';
      this.pausedFrom = null;
      this._setState(to);
      g.timeScale = clamp(this.slowmo, 0.05, 1);
      g.hud?.showPause?.(false);
    }
  }

  togglePause() {
    this.pause(this.game.state !== 'paused');
  }

  resume() {
    this.pause(false);
  }

  cycleQuality() {
    const g = this.game;
    const n = CONFIG.quality.length;
    if (!g.settings || !n) return;
    const q = ((Math.round(finite(g.settings.quality)) % n) + n + 1) % n;
    g.settings.quality = q;
    this._try(() => g.applyQuality?.(), 'applyQuality');
    this._log(`Quality: ${CONFIG.quality[q].name}`, 'system');
  }

  toggleMute() {
    const a = this.game.audio;
    this._try(() => a?.toggleMute?.(), 'audio.toggleMute');
    this._log(a?.muted ? 'Sound muted.' : 'Sound on.', 'system');
  }

  // ------------------------------------------------------------------ frame
  _update(rdt) {
    const g = this.game;
    const inp = g.input;
    this.stateTime += rdt;

    this._globalKeys();
    if (this.autoPause) {
      this.autoPause = false;
      if (PLAY.has(g.state)) this.pause(true);
    } else if (inp?.pressed('Escape')) {
      this.togglePause();
    }

    if (g.state !== 'paused') this._drainQueue();

    switch (g.state) {
      case 'title':
        this._title();
        break;
      case 'explore':
        this._explore(rdt);
        break;
      case 'bossIntro':
        this._bossIntro(rdt);
        break;
      case 'boss':
        this._boss(rdt);
        break;
      case 'dead':
        this._dead(rdt);
        break;
      case 'victory':
        this._victory(rdt);
        break;
      default:
        break;
    }

    this._updateRespawn(rdt);

    if (this.bossBarHideT > 0) {
      this.bossBarHideT -= rdt;
      if (this.bossBarHideT <= 0) {
        this.bossBarHideT = -1;
        g.hud?.hideBossBar?.();
      }
    }
    if (this.restCooldown > 0) this.restCooldown -= rdt;
    if (this.slowmoHold > 0) this.slowmoHold -= rdt;
    else if (this.slowmo < 1) {
      this.slowmo = damp(this.slowmo, 1, 1.8, rdt);
      if (this.slowmo > 0.995) this.slowmo = 1;
    }
    this._updateOverride(rdt);
  }

  _globalKeys() {
    const g = this.game;
    const inp = g.input;
    if (!inp) return;
    if (inp.pressed('F2')) this.cycleQuality();
    if (inp.pressed('KeyM')) this.toggleMute();
    if (inp.pressed('F3') && g.settings) g.settings.showFps = !g.settings.showFps;
    if (inp.pressed('KeyH')) g.hud?.toggleHelp?.();
  }

  _drainQueue() {
    if (!this.queue.length) return;
    const g = this.game;
    const items = this.queue;
    this.queue = [];
    for (const name of items) {
      const st = g.state;
      switch (name) {
        case 'dragon:introDone':
          if (st === 'bossIntro' || st === 'explore') this._enterBoss();
          break;
        case 'dragon:phase2':
        case 'dragon:phase3':
          if (st === 'boss' || st === 'bossIntro') {
            this.phase2 = true;
            g.hud?.banner?.(name === 'dragon:phase3' ? PHASE3_TEXT : PHASE2_TEXT, 'phase');
            g.audio?.setMusic?.('boss2');
          }
          break;
        case 'player:died':
          // once the wyrm has fallen, a simultaneous death still counts as a victory
          if (PLAY.has(st) && this.dragonDownT < 0) this._enterDead();
          break;
        case 'dragon:death':
          if (st === 'boss' || st === 'bossIntro') {
            this.dragonDownT = 0;
            this.bossBarHideT = TUNE.bossBarHideDelay;
          }
          break;
        case 'dragon:dead':
          if (PLAY.has(st)) this._enterVictory();
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ states
  _title() {
    this._titleShot();
    if (this.stateTime > TUNE.title.minTime && this._dismissPressed()) this._startGame();
  }

  _titleShot() {
    const g = this.game;
    const W = CONFIG.world;
    const T = TUNE.title;
    const p = g.player?.position;
    const px = finite(p?.x, W.playerSpawn.x);
    const pz = finite(p?.z, W.playerSpawn.z);
    const s = W.dragonSleep;
    const drift = Math.sin(finite(g.realTime) * 0.11) * T.drift;
    this._ov.focus.set(lerp(px, s.x, T.toward) + drift, 0, lerp(pz, s.z, T.toward));
    this._ovW = T.weight;
    this._ovZ = T.zoom;
    this._ovLambda = 2;
    if (!this.titleFramed) {
      // start already framed instead of swooping from the player on boot
      this.titleFramed = true;
      this._ov.weight = T.weight;
      this._ov.zoom = T.zoom;
      this.cameraOverride = this._ov;
      const rig = g.cameraRig;
      if (rig) {
        rig.extraZoom = T.zoom;
        this._tmp.set(px, 0, pz).lerp(this._ov.focus, T.weight);
        this._try(() => rig.snap?.(this._tmp), 'cameraRig.snap');
      }
    }
  }

  _startGame() {
    const g = this.game;
    // contract: unlock on title dismiss (idempotent; the earlier latch may have fired on a
    // non-activating key such as Esc, so call it again inside this gesture's frame)
    this.audioUnlocked = true;
    this._try(() => g.audio?.unlock?.(), 'audio.unlock');
    g.hud?.hideTitle?.();
    this.stats.reset();
    this._setState('explore');
    g.hud?.banner?.(AREA.toUpperCase(), 'area', { sub: 'where the cinder wyrm sleeps' });
    g.events?.emit('area', { name: AREA });
    g.audio?.setMusic?.('ambient');
    this._log('Ash drifts through the hollow. Something vast sleeps among the bones to the north.', 'lore');
    this._log('Rest at the bonfire to restore your flasks.', 'lore');
    if (!g.touch?.active) this._log('H: controls  ·  Esc: pause', 'system');
    // ease the camera from the establishing shot back to the player
    this._ovW = 0;
    this._ovZ = 0;
    this._ovLambda = 1.3;
    // the key/click that dismissed the title must not also swing the sword this frame
    if (g.input) {
      g.input.enabled = false;
      this.swallowInput = true;
    }
  }

  _explore(rdt) {
    const g = this.game;
    const p = g.player;
    const d = g.dragon;
    this.stats.totalTime += rdt;
    if (this._playerDead()) {
      this._enterDead();
      return;
    }
    const pos = p?.position;
    if (!pos) return;

    const bf = g.world?.bonfire;
    const near = !!bf && Math.hypot(pos.x - bf.x, pos.z - bf.z) < TUNE.restRadius;
    g.hud?.prompt?.(near ? '[E] Rest at bonfire' : null);
    if (near && this.restCooldown <= 0 && g.input?.pressed('KeyE')) this._rest();

    if (d) {
      const ds = d.state;
      if (this._dragonAsleep()) {
        const W = CONFIG.world;
        const dp = d.position;
        const dist = dp ? Math.hypot(pos.x - dp.x, pos.z - dp.z) : Infinity;
        if (pos.z < W.bossTriggerZ || dist < W.wakeRadius || this.hitWhileAsleep) this._enterBossIntro(true);
      } else if (ds === 'waking' && this.stateTime > 0.5) {
        this._enterBossIntro(false); // woke by itself: frame it without restarting the intro
      } else if (FIGHTING.has(ds) && this.stateTime > 0.5) {
        this._enterBoss();
      }
    }
    this.hitWhileAsleep = false;
  }

  _rest() {
    const g = this.game;
    const p = g.player;
    const d = g.dragon;
    this.restCooldown = TUNE.restCooldown;
    this._try(() => {
      if (typeof p?.restAtBonfire === 'function') p.restAtBonfire();
      else if (p) {
        p.hp = p.maxHp;
        p.flasks = p.maxFlasks;
      }
    }, 'player.restAtBonfire');
    const ds = d?.state;
    if (d && ds && ds !== 'sleeping' && ds !== 'dying' && ds !== 'dead') {
      // resting while the wyrm is awake sends it back to its nest
      this._try(() => d.reset?.(), 'dragon.reset');
      this._try(() => g.world?.scorch?.reset?.(), 'scorch.reset');
      g.hud?.hideBossBar?.();
      this.phase2 = false;
      this._log('The wyrm returns to its slumber.', 'lore');
    }
    this._try(() => g.world?.atmosphere?.setBonfireLit?.(true), 'setBonfireLit');
    g.hud?.banner?.('REST', 'bonfire');
    this.grade.dip(0.45, 1.0);
    g.events?.emit('bonfire:rest');
    this._log('You rest at the bonfire. Health and flasks restored.', 'system');
  }

  _enterBossIntro(callStart) {
    const g = this.game;
    this._setState('bossIntro');
    this.introT = 0;
    g.hud?.prompt?.(null);
    g.audio?.setMusic?.('none');
    this._log('The ground trembles…', 'warn');
    if (callStart) this._try(() => g.dragon?.startIntro?.(), 'dragon.startIntro');
    this._dragonFocus(this._ov.focus);
    this._ovW = TUNE.intro.weight;
    this._ovZ = TUNE.intro.zoom;
    this._ovLambda = TUNE.intro.lambda;
    this.cameraOverride = this._ov;
  }

  _bossIntro(rdt) {
    const g = this.game;
    this.introT += rdt;
    this.stats.totalTime += rdt;
    if (this._playerDead()) {
      this._enterDead();
      return;
    }
    this._dragonFocus(this._tmp);
    const f = this._ov.focus;
    f.x = damp(f.x, this._tmp.x, 3, rdt);
    f.z = damp(f.z, this._tmp.z, 3, rdt);
    const ds = g.dragon?.state;
    // fallbacks if 'dragon:introDone' never arrives
    if (this.introT > TUNE.intro.fallback || (this.introT > 6 && FIGHTING.has(ds))) this._enterBoss();
  }

  _enterBoss() {
    const g = this.game;
    if (g.state === 'boss') return;
    this._setState('boss');
    g.hud?.prompt?.(null); // may arrive straight from explore with the bonfire prompt up
    g.hud?.showBossBar?.(g.dragon?.name ?? 'VAELGRIM, THE CINDER WYRM');
    g.audio?.setMusic?.(this.phase2 ? 'boss2' : 'boss');
    this._ovW = 0;
    this._ovZ = 0;
    this._ovLambda = 1.5;
    this.bossBarHideT = -1;
    this.dragonDownT = -1;
    this.deadPollT = 0;
  }

  _boss(rdt) {
    const g = this.game;
    this.stats.attemptTime += rdt;
    this.stats.totalTime += rdt;
    if (this.dragonDownT < 0 && this._playerDead()) {
      this._enterDead();
      return;
    }
    this._bossFrame(rdt);
    // Lab 'victory': the dragon never reported its death
    if (this.debugVictoryT > 0) {
      this.debugVictoryT -= rdt;
      if (this.debugVictoryT <= 0) {
        this._enterVictory();
        return;
      }
    }
    // fallbacks if 'dragon:dead' never arrives
    if (this.dragonDownT >= 0) {
      this.dragonDownT += rdt;
      if (this.dragonDownT > 9) {
        this._enterVictory();
        return;
      }
    }
    if (g.dragon?.state === 'dead') {
      this.deadPollT += rdt;
      if (this.deadPollT > 1.2) this._enterVictory();
    } else this.deadPollT = 0;
  }

  /** Boss framing (TUNE.bossCam): hero + the wyrm's hurt spheres in view at the default camera. */
  _bossFrame(rdt) {
    const g = this.game, H = g.dragon?.hurtSpheres, p = g.player?.position;
    const rig = g.cameraRig;
    const T = rig?.mobile ? BOSS_CAM_MOBILE : TUNE.bossCam;
    this._ovLambda = 1.5;
    if (!Array.isArray(H) || !H.length || !p || !Number.isFinite(p.x + p.z)) {
      this._ovW = 0;
      this._ovZ = 0;
      return;
    }
    let x0 = p.x, x1 = p.x, z0 = p.z, z1 = p.z, cx = 0, cz = 0, n = 0;
    for (const h of H) {
      if (!h || !Number.isFinite(h.x + h.y + h.z + h.r)) continue;
      const z = h.z - Math.max(0, h.y) * T.lean;
      x0 = Math.min(x0, h.x - h.r);
      x1 = Math.max(x1, h.x + h.r);
      z0 = Math.min(z0, z - h.r);
      z1 = Math.max(z1, z + h.r);
      cx += h.x;
      cz += h.z;
      n++;
    }
    if (!n) return;
    const m = T.margin;
    const need = Math.max((x1 - x0 + 2 * m) / (2 * T.side), (z1 - z0 + 2 * m) / (T.north + T.south));
    const C = CONFIG.camera;
    const def = finite(rig?.defaultDistance, C.distance), min = finite(rig?.minDistance, C.minDistance);
    const base = finite(rig?.targetDistance, def);
    // wheel / pinch-zoomed in (Lab showroom too): the player asked for a close-up, frame less
    const user = clamp((base - min) / Math.max(1, def - min), 0, 1);
    const dist = Math.hypot(p.x - cx / n, p.z - cz / n);
    this._ovW = T.weight * user * clamp((T.far - dist) / (T.far - T.near), 0, 1);
    this._ovZ = this._ovW > 0 ? clamp(need - base, 0, T.maxZoom) * user : 0;
    // centre the box in the (asymmetric) view, then keep the hero inside it
    const D = base + this._ovZ;
    const tx = clamp((x0 + x1) / 2, p.x - T.side * D + m, p.x + T.side * D - m);
    const ms = T.marginSouth ?? m;
    const tz = clamp((z0 + z1) / 2 + ((T.north - T.south) / 2) * D, p.z - T.south * D + ms, p.z + T.north * D - m);
    const f = this._ov.focus;
    const k = this._ov.weight > 0.05 ? 1 - Math.exp(-4 * rdt) : 1; // override idle: start on target
    f.x += (tx - f.x) * k;
    f.z += (tz - f.z) * k;
    f.y = 0;
  }

  _enterDead() {
    const g = this.game;
    if (g.state === 'dead') return;
    this._setState('dead');
    this.stats.deaths++;
    this.deathT = 0;
    this.deathBanner = false;
    this.canRetry = false;
    g.hud?.prompt?.(null);
    g.audio?.setMusic?.('death');
    this.grade.desatTo(1, 0.65);
    this.grade.fadeTo(0.6, 0.16);
    this.slowmo = TUNE.deathSlowmo;
    this.slowmoHold = TUNE.deathSlowmoHold;
    this._ovW = 0;
    this._ovZ = 0;
    this._ovLambda = 2;
    this.bossBarHideT = 1.5;
  }

  _dead(rdt) {
    const g = this.game;
    this.deathT += rdt;
    if (!this.deathBanner && this.deathT >= TUNE.deathBannerDelay) {
      this.deathBanner = true;
      g.hud?.banner?.('YOU DIED', 'death', { hold: Infinity });
    }
    if (!this.canRetry && this.deathT >= TUNE.deathHold) {
      this.canRetry = true;
      g.hud?.bannerHint?.(g.touch?.active ? 'tap to rise again' : 'press any key to rise again');
    }
    if (this.canRetry && !this.respawning && this._dismissPressed()) {
      g.hud?.bannerHint?.(null);
      this._beginRespawn(false);
    }
  }

  _enterVictory() {
    const g = this.game;
    if (g.state === 'victory') return;
    this.debugVictoryT = -1;
    this._setState('victory');
    this.victoryT = 0;
    this.statsShown = false;
    g.hud?.prompt?.(null);
    g.hud?.banner?.('WYRM VANQUISHED', 'victory');
    g.audio?.setMusic?.('victory');
    g.events?.emit('game:victory', this.stats.snapshot());
    if (this.bossBarHideT < 0) this.bossBarHideT = 1.2;
    this._dragonFocus(this._ov.focus);
    this._ovW = TUNE.victoryCam.weight;
    this._ovZ = TUNE.victoryCam.zoom;
    this._ovLambda = 1;
    this.cameraOverride = this._ov;
    this._log('The cinders cool. Cinderwood Hollow falls silent.', 'lore');
  }

  _victory(rdt) {
    const g = this.game;
    this.victoryT += rdt;
    if (!this.statsShown && this.victoryT >= TUNE.statsDelay) {
      this.statsShown = true;
      g.hud?.showStats?.(this.stats.rows());
      g.hud?.prompt?.('[R] Fight again');
    }
    if (this.victoryT > 1 && !this.respawning && g.input?.pressed('KeyR')) this._beginRespawn(true);
  }

  // ------------------------------------------------------------------ respawn / restart
  _beginRespawn(resetRun) {
    this.respawning = { stage: 'out', resetRun, t: 0 };
    this.grade.fadeTo(1, 1.25);
  }

  _updateRespawn(rdt) {
    const r = this.respawning;
    if (!r) return;
    r.t += rdt;
    if (r.stage === 'out') {
      if (this.grade.fade >= 0.999 || r.t > 3) {
        this._doRespawn(r.resetRun);
        r.stage = 'in';
        r.t = 0;
        this.grade.fadeTo(0, 0.85);
        this.grade.desatTo(0, 1.1);
      }
    } else if (this.grade.fade <= 0.001 || r.t > 4) {
      this.respawning = null;
    }
  }

  /** Runs while the screen is fully black. */
  _doRespawn(resetRun) {
    const g = this.game;
    this._resetWorld();
    if (resetRun) this.stats.reset();
    else this.stats.attemptTime = 0;

    this._setState('explore');
    g.events?.emit('game:retry');
    g.audio?.setMusic?.('ambient');
    this._log(resetRun ? 'The wyrm sleeps once more. The hollow waits.' : 'You rise again at the bonfire.', 'lore');
  }

  /** Player at the bonfire spawn, dragon asleep in its nest, scorch/FX cleared, HUD + flow reset. */
  _resetWorld() {
    const g = this.game;
    const p = g.player;
    this._respawnPlayer();
    this._try(() => g.dragon?.reset?.(), 'dragon.reset');
    this._try(() => g.world?.scorch?.reset?.(), 'scorch.reset');
    this._try(() => g.world?.clearPushers?.(1), 'world.clearPushers');
    this._try(() => {
      g.fx?.add?.clear?.();
      g.fx?.alpha?.clear?.();
    }, 'fx.clear');
    this._try(() => g.world?.atmosphere?.setBonfireLit?.(true), 'setBonfireLit');

    const hud = g.hud;
    hud?.hideBossBar?.();
    hud?.clearBanner?.(true);
    hud?.bannerHint?.(null);
    hud?.prompt?.(null);
    hud?.showStats?.(null);

    this.phase2 = false;
    this.bossBarHideT = -1;
    this.dragonDownT = -1;
    this.deadPollT = 0;
    this.slowmo = 1;
    this.slowmoHold = 0;
    this.hitWhileAsleep = false;
    this.queue.length = 0; // drop stale events from the previous attempt
    this._ovW = 0;
    this._ovZ = 0;
    this._ov.weight = 0;
    this._ov.zoom = 0;
    this.cameraOverride = null;
    const rig = g.cameraRig;
    if (rig) {
      rig.extraZoom = 0;
      if (p?.position) this._try(() => rig.snap?.(p.position), 'cameraRig.snap');
    }
    this.grade.resetInstant();
    this.debugVictoryT = -1;
  }

  _respawnPlayer() {
    const S = CONFIG.world.playerSpawn;
    const p = this.game.player;
    this._try(() => {
      if (typeof p?.respawn === 'function') p.respawn(S.x, S.z);
      else p?.position?.set(S.x, 0, S.z);
    }, 'player.respawn');
  }

  // ------------------------------------------------------------------ Lab (debug.toState)
  _debugToState(name) {
    const to = String(name ?? '');
    if (!DEBUG_STATES.has(to)) return false;
    this._debugPrelude();
    if (to === 'explore') this._debugExplore();
    else if (to === 'boss') this._debugBoss();
    else if (to === 'dead') this._debugDead();
    else this._debugVictory();
    this._log(`[lab] state → ${to}`, 'system');
    return true;
  }

  /** Leave whatever screen we are on (title / pause / death / victory / a respawn fade) cleanly. */
  _debugPrelude() {
    const g = this.game;
    if (g.state === 'paused') {
      this.pausedFrom = null;
      g.hud?.showPause?.(false);
    }
    if (g.state === 'title') {
      g.hud?.hideTitle?.();
      this.titleFramed = true;
      this.stats.reset();
    }
    this._unlockAudio();
    this._try(() => g.audio?.unlock?.(), 'audio.unlock');
    if (g.input && !g.input.enabled) g.input.enabled = true;
    this.swallowInput = false;
    this.respawning = null;
    this.queue.length = 0; // stale events from before the jump
    this.slowmo = 1;
    this.slowmoHold = 0;
    this.hitWhileAsleep = false;
    this.bossBarHideT = -1;
    this.dragonDownT = -1;
    this.deadPollT = 0;
    this.debugVictoryT = -1;
    this.deathBanner = false;
    this.canRetry = false;
    this.statsShown = false;
    const hud = g.hud;
    hud?.clearBanner?.(true);
    hud?.bannerHint?.(null);
    hud?.showStats?.(null);
    hud?.prompt?.(null);
    this.grade.fadeTo(0, 4);
    this.grade.desatTo(0, 4);
    this._ovW = 0;
    this._ovZ = 0;
    this._ovLambda = 3;
  }

  _debugExplore() {
    const g = this.game;
    this._resetWorld();
    this.grade.fade = 0;
    this.grade.desat = 0;
    this.stats.attemptTime = 0;
    this._setState('explore');
    g.events?.emit('game:retry');
    g.audio?.setMusic?.('ambient');
  }

  _debugBoss() {
    const g = this.game;
    const d = g.dragon;
    if (this._playerDead()) this._respawnPlayer();
    if (d && DRAGON_DOWN.has(d.state)) this._try(() => d.reset?.(), 'dragon.reset');
    this._try(() => {
      if (typeof d?.debug?.startFight === 'function') d.debug.startFight();
      else d?.startIntro?.();
    }, 'dragon.debug.startFight');
    this.phase2 = d?.phase >= 2;
    this.grade.desat = 0;
    this._setState('boss');
    g.hud?.showBossBar?.(d?.name ?? 'VAELGRIM, THE CINDER WYRM');
    g.audio?.setMusic?.(this.phase2 ? 'boss2' : 'boss');
  }

  _debugDead() {
    const g = this.game;
    if (this._playerDead()) {
      // already down: just make sure the flow agrees
      if (g.state !== 'dead') this._enterDead();
      return;
    }
    // takeHit ignores hits on the title / victory screens: stand in a play state first
    if (!PLAY.has(g.state)) {
      const ds = g.dragon?.state;
      this._setState(ds && FIGHTING.has(ds) ? 'boss' : 'explore');
    }
    this._killPlayer();
    if (this._playerDead()) this._enterDead();
  }

  _debugVictory() {
    const g = this.game;
    const d = g.dragon;
    if (this._playerDead()) this._respawnPlayer();
    if (g.state === 'victory') {
      // replay the victory beat (the prelude cleared the banner and the record)
      this.victoryT = 0;
      g.hud?.banner?.('WYRM VANQUISHED', 'victory');
      return;
    }
    if (!d || d.state === 'dead' || typeof d.debug?.kill !== 'function') {
      this._enterVictory();
      return;
    }
    // stand in the boss state so the death events are handled the normal way
    if (g.state !== 'boss') {
      this._setState('boss');
      g.hud?.showBossBar?.(d.name ?? 'VAELGRIM, THE CINDER WYRM');
      g.audio?.setMusic?.(d.phase >= 2 ? 'boss2' : 'boss');
    }
    this.debugVictoryT = TUNE.debugVictoryTimeout;
    this._try(() => d.debug.kill(), 'dragon.debug.kill');
  }

  /** Kill the player through its normal death path (takeHit), with fallbacks. */
  _killPlayer() {
    const g = this.game;
    const p = g.player;
    if (!p || this._playerDead()) return;
    if (typeof p.debug?.kill === 'function') this._try(() => p.debug.kill(), 'player.debug.kill');
    if (!this._playerDead() && typeof p.takeHit === 'function') {
      const dbg = p.debug && typeof p.debug === 'object' ? p.debug : null;
      const god = dbg ? dbg.god : undefined;
      if (dbg) dbg.god = false;
      const pos = p.position;
      this._try(
        () =>
          p.takeHit({
            damage: Math.ceil(Math.max(1, finite(p.hp, 1))) + 1,
            from: { x: finite(pos?.x), z: finite(pos?.z) - 1 },
            knockback: 0,
            kind: 'lab',
            tell: 'normal',
            parryable: false,
            blockable: false,
            attack: 'lab',
            attacker: g.dragon ?? null,
          }),
        'player.takeHit',
      );
      if (dbg) dbg.god = god;
    }
    // i-frames (roll / Ghostep) swallowed the hit: last resort
    if (!this._playerDead()) {
      this._try(() => {
        p.hp = 0;
        if (typeof p._die === 'function') p._die();
      }, 'player.die');
    }
  }

  // ------------------------------------------------------------------ helpers
  _setState(to) {
    const g = this.game;
    const from = g.state;
    if (from === to) return;
    g.state = to;
    this.stateTime = 0;
    g.events?.emit('state', { from, to });
  }

  _gradeTargets() {
    const g = this.game;
    const st = g.state === 'paused' ? this.pausedFrom : g.state;
    this.grade.warmTarget =
      st === 'boss' ? (this.phase2 ? TUNE.warmPhase2 : TUNE.warmBoss) : st === 'victory' ? TUNE.warmVictory : 0;
    const p = g.player;
    let low = 0;
    if (p && PLAY.has(st) && p.alive !== false) {
      const f = finite(p.hp, 1) / Math.max(1, finite(p.maxHp, 1));
      if (f > 0 && f < 0.3) low = 0.35 + 0.65 * (1 - f / 0.3);
    }
    this.grade.lowHp = low;
  }

  _updateOverride(rdt) {
    const ov = this._ov;
    ov.weight = damp(ov.weight, this._ovW, this._ovLambda, rdt);
    ov.zoom = damp(ov.zoom, this._ovZ, this._ovLambda, rdt);
    if (this._ovW <= 0 && ov.weight < 0.005 && ov.zoom < 0.05) {
      ov.weight = 0;
      ov.zoom = 0;
      this.cameraOverride = null;
    } else {
      this.cameraOverride = ov;
    }
  }

  /** Ground point under the dragon's lock point (falls back to its root / sleep spot). */
  _dragonFocus(out) {
    const d = this.game.dragon;
    let ok = false;
    if (typeof d?.lockPoint === 'function') {
      try {
        d.lockPoint(out);
        ok = Number.isFinite(out.x) && Number.isFinite(out.z);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      const s = CONFIG.world.dragonSleep;
      out.set(finite(d?.position?.x, s.x), 0, finite(d?.position?.z, s.z));
    }
    out.y = 0;
    return out;
  }

  _dragonAsleep() {
    const s = this.game.dragon?.state;
    return s === undefined || s === null || s === 'sleeping';
  }

  _playerDead() {
    const p = this.game.player;
    return !!p && (p.alive === false || p.state === 'dead');
  }

  /** Any key (except settings keys) or a click on the game canvas this frame. */
  _dismissPressed() {
    const inp = this.game.input;
    if (!inp) return false;
    if (inp.mousePressed?.(0) || inp.mousePressed?.(1) || inp.mousePressed?.(2)) return true;
    const keys = inp.pressedKeys;
    if (keys && typeof keys[Symbol.iterator] === 'function') {
      for (const k of keys) if (!NON_DISMISS.has(k) && !NON_DISMISS_RE.test(k)) return true;
      return false;
    }
    return !!inp.anyPressed;
  }

  _unlockAudio() {
    if (this.audioUnlocked) return;
    const a = this.game.audio;
    if (typeof a?.unlock !== 'function') return;
    this.audioUnlocked = true;
    this._try(() => a.unlock(), 'audio.unlock');
  }

  _log(text, channel) {
    this.game.hud?.log?.(text, channel);
  }

  _try(fn, label) {
    try {
      return fn();
    } catch (err) {
      this._report(label, err);
      return undefined;
    }
  }

  _report(label, err) {
    if (this._errors >= 8) return;
    this._errors++;
    console.error(`[flow] ${label} failed`, err);
  }
}
