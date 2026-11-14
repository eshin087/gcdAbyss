import { clamp } from '../core/math.js';
import { DEFENSE } from '../combat/rules.js';
import { createNoiseBuffers, createImpulse, limiterCurve, holdAt, num } from './dsp.js';
import { Voice } from './voice.js';
import { SFX } from './sfx.js';
import { ForestAmbience, BreathLoop } from './ambience.js';
import { ChargeHum } from './charge.js';
import { createMusic } from './music.js';
import { FIRE_SFX, subscribeFire } from './fire.js';

// Procedural WebAudio engine: every sound is synthesised at runtime (no sample files).
// The AudioContext is created lazily by unlock() (flow calls it on title dismiss; the engine
// also unlocks itself on the first pointer/key gesture). Every method is a no-op before that.
//
// Graph:
//   sfx / music(→ dip) / ambient buses ─┐
//   reverb return (2.8 s hall) ─────────┴→ mix → Ghostep LPF+gain → pause-duck LPF → master
//   cue bus (tells, timing flash, Ghostep: never Ghostep-ducked) ──→ pause-duck LPF ─┘
//   ui bus (blips, never ducked) ─────────────────────────────────→ master → compressor → limiter → out
//   every voice / layer also feeds a send into the convolution reverb.
//
// play(name, opts) one-shots — opts.x/opts.z spatialise against the player (pan by Δx,
// full level within 8 m, ≈ −12 dB at 35 m), opts.gain, opts.pan, opts.delay (s):
//   player   swing{heavy,combo,thrust} slam hit{heavy,crit,part} hurt{damage,kind} sizzle roll
//            footstep{sprint} heal noFlask lockOn{on} dodge gong
//   combat   tellBlue tellRed tellTick flash{tell} parry{tell,chain} block{tell} guardBreak
//            ghostep{slow}   (+ the sustained charge hum: player:charge → release/interrupt)
//            plungeDive{exec} plungeHit{exec}
//   dragon   roar{strength,pitch} wake dragonStep{heavy} wingFlap{strength} takeoff land bite
//            windup{name} dragonSwipe dragonPain dragonRecoil{tell} postureBreak{roar}
//            fireball explosion{radius} stagger phase2{roar} dragonDeath emberHiss
//   world/ui bonfire victory area retry blip{kind: select|start|pause|resume|error}
//   aliases  ui click select confirm start pause resume back cancel error → blip variants
//
// Music (setMusic): 'none' | 'ambient' | 'boss' | 'boss2' | 'victory' | 'death', 1.5 s
// crossfades. If flow does not pick music itself, the engine follows game.state / dragon
// events; an explicit setMusic() in the same frame always wins over the automatic choice.

const MODES = new Set(['none', 'ambient', 'boss', 'boss2', 'victory', 'death']);
const XFADE = 1.5;
const MASTER = 0.9;
const BUS = { sfx: 1, music: 0.42, ambient: 0.55, reverb: 0.6, ui: 0.8, cue: 1 };
// Ghostep slow-mo: the world mix is low-passed + ducked for the slow-mo (real seconds, rules.js)
const SLOW_HZ = 900;
const SLOW_GAIN = 0.55;
const GHOST_DEDUPE = 0.4; // s: 'player:perfectDodge' + 'player:ghostep' describe the same blink
// s after a Ghostep in which i-frame "dodges" (later hits of the same attack) stay silent
const GHOST_QUIET = num(DEFENSE.ghostep?.slowmoTime, 0.6) + 0.4;
// timing flash: the music dips briefly so the cue cuts through
const DIP_LEVEL = 0.5;
const DIP_HOLD = 0.2;
const POOL_CAPS = { sfx: 24, music: 18, amb: 6 };
const BREATH_MAX = 12; // s of unpaused breath before the safety stop
const VICTORY_SETTLE = 10; // s of victory pad before settling to ambient
const GRUNT_GAP = 0.5; // s: rapid fire-contact ticks only grunt this often (sizzle in between)
const DUCK_HZ = 650;
const EMPTY = Object.freeze({});
const RX_OWN_SOUND = /breath|fire|flame|ball|bite|roar|inferno|blaze|meteor|strafe|dive|barrage|erupt|nova/i;

const ALIASES = {
  ui: ['blip', { kind: 'select' }],
  click: ['blip', { kind: 'select' }],
  select: ['blip', { kind: 'select' }],
  confirm: ['blip', { kind: 'start' }],
  start: ['blip', { kind: 'start' }],
  pause: ['blip', { kind: 'pause' }],
  resume: ['blip', { kind: 'resume' }],
  back: ['blip', { kind: 'pause' }],
  cancel: ['blip', { kind: 'pause' }],
  error: ['blip', { kind: 'error' }],
};

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.musicMode = 'none';
    this.music = null; // active music layer
    this.ambience = null;
    this.breath = null;
    this.charge = null; // heavy-attack charge hum (built with the graph)
    this._fading = []; // layers crossfading out
    this._musicSince = 0;
    this.pools = { sfx: [], music: [], amb: [] };
    this._poolLists = [this.pools.sfx, this.pools.music, this.pools.amb];
    this._last = new Map(); // per-name rate limiting
    this._sp = { pan: 0, gain: 1 };
    this._dp = { x: 0, z: 0 };
    this._frame = 0;
    this._explicitFrame = -1;
    this._auto = null;
    this._autoFrame = -2;
    this._seenState = undefined;
    this._prePause = null;
    this._ducked = false;
    this._staggerAt = -10;
    this._hurtAt = -10;
    this._painPending = false;
    // end-of-frame decisions (events of one blow can arrive in any order within a frame)
    this._staggerPending = false;
    this._breakAt = -10;
    this._dodgePending = false;
    this._hurtPending = false;
    this._hurtOpts = { damage: 0, kind: '' };
    this._blockFrame = -1;
    this._ghostFrame = -1;
    this._ghostAt = -10;
    this._failed = false;
    this._gestured = false;
    this._resumeAt = 0;
    this._hiddenSuspend = false;
    this._warned = new Set();
    this._subscribe(game.events);
    this._listenForGesture();
  }

  // --- public API -------------------------------------------------------------------------

  /** Create/resume the AudioContext. Safe to call repeatedly; call from a user gesture. */
  unlock() {
    this._gestured = true;
    if (this._failed) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this._hidden()) this.ctx.resume().catch(() => {});
      return;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        this.ctx = new AC();
      } catch (err) {
        this._warn('context', err);
        this.ctx = null;
        return;
      }
    }
    try {
      this._build();
    } catch (err) {
      this._warn('init', err);
      try {
        this.ctx.close();
      } catch {
        /* ignore */
      }
      // drop the half-built graph so every method stays a no-op (and don't rebuild per gesture)
      this.ctx = null;
      this._failed = true;
      this.master = this.duck = this.sfxBus = this.musicBus = this.ambientBus = this.uiBus = null;
      this.cueBus = this.slowLp = this.slowGain = this.musicDip = null;
      this.reverbIn = this.ambience = this.breath = this.charge = this.music = null;
      this._fading.length = 0;
      for (const l of this._poolLists) l.length = 0;
      return;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  update(realDt) {
    try {
      const st = this.game.state;
      if (st !== this._seenState) this._trackState(this._seenState, st);
      if (this.ctx && this.ctx.state !== 'closed') this._tick(realDt);
      if (this._auto !== null) {
        if (this._explicitFrame !== this._autoFrame) this._setMusic(this._auto);
        this._auto = null;
      }
    } catch (err) {
      this._warn('update', err);
    }
    this._frame++;
  }

  /** One-shot SFX by name (see header). Returns true if a voice was started. */
  play(name, opts) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed' || typeof name !== 'string') return false;
    let o = opts && typeof opts === 'object' ? opts : EMPTY;
    let def = SFX[name] ?? FIRE_SFX[name];
    if (!def && ALIASES[name]) {
      const [n, extra] = ALIASES[name];
      name = n;
      def = SFX[n];
      o = { ...extra, ...o };
    }
    if (!def) return false;
    const now = ctx.currentTime;
    if (def.gap) {
      const last = this._last.get(name);
      if (last !== undefined && now - last < def.gap && now >= last) return false;
      this._last.set(name, now);
    }
    let pan = clamp(num(o.pan, 0), -1, 1);
    let gain = Math.max(0, num(o.gain, 1)) * (def.gain ?? 1);
    if (o.x !== undefined && o.z !== undefined) {
      const sp = this._spatial(o.x, o.z, def.falloff ?? 1);
      pan = sp.pan;
      gain *= sp.gain;
    }
    const bus = def.bus === 'ui' ? this.uiBus : def.bus === 'cue' ? this.cueBus || this.sfxBus : this.sfxBus;
    const v = this._voice('sfx', { bus, pan, gain, rev: def.rev ?? 0.12, prio: def.prio ?? 2 });
    if (!v) return false;
    try {
      def.play(v, now + 0.006 + Math.max(0, num(o.delay, 0)), o, this);
    } catch (err) {
      v.kill(now);
      this._warn(`sfx:${name}`, err);
      return false;
    }
    return true;
  }

  /** 'none' | 'ambient' | 'boss' | 'boss2' | 'victory' | 'death' (1.5 s crossfade). */
  setMusic(mode) {
    this._explicitFrame = this._frame;
    try {
      this._setMusic(mode);
    } catch (err) {
      this._warn('music', err);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyMaster(0.08);
    return this.muted;
  }

  setVolume(v) {
    this.volume = clamp(num(v, this.volume), 0, 1);
    this._applyMaster(0.05);
    return this.volume;
  }

  // --- graph --------------------------------------------------------------------------------

  _build() {
    const ctx = this.ctx;
    this.noise = createNoiseBuffers(ctx);
    this._openHz = Math.min(20000, ctx.sampleRate * 0.45);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const pre = ctx.createGain();
    pre.gain.value = 0.5; // limiter curve expects half-scale input
    const limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    this.master.connect(comp).connect(pre).connect(limiter).connect(ctx.destination);

    this.mix = ctx.createGain();
    this.duck = ctx.createBiquadFilter();
    this.duck.type = 'lowpass';
    this.duck.frequency.value = this._openHz;
    this.duck.Q.value = 0.5;
    // Ghostep slow-mo: its own low-pass + gain on the world mix (the pause duck stays separate)
    this.slowLp = ctx.createBiquadFilter();
    this.slowLp.type = 'lowpass';
    this.slowLp.frequency.value = this._openHz;
    this.slowLp.Q.value = 0.7;
    this.slowGain = ctx.createGain();
    this.mix.connect(this.slowLp).connect(this.slowGain).connect(this.duck).connect(this.master);

    const bus = (level, dest) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(dest);
      return g;
    };
    this.sfxBus = bus(BUS.sfx, this.mix);
    this.musicDip = bus(1, this.mix);
    this.musicBus = bus(BUS.music, this.musicDip);
    this.ambientBus = bus(BUS.ambient, this.mix);
    this.cueBus = bus(BUS.cue, this.duck);
    this.uiBus = bus(BUS.ui, this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createImpulse(ctx, 2.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(bus(BUS.reverb, this.mix));

    this.ambience = new ForestAmbience(this);
    this.breath = new BreathLoop(this);
    this.charge = new ChargeHum(this);

    this._applyMaster(0.35);
    if (this._ducked) this._duck(true);
    const mode = this.musicMode;
    this.musicMode = 'none';
    this._setMusic(mode);
  }

  _applyMaster(tau) {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume * MASTER;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, tau);
  }

  /** Pause: muffle + soften everything except UI blips. */
  _duck(on) {
    this._ducked = on;
    if (!this.ctx || !this.duck) return;
    const now = this.ctx.currentTime;
    this.duck.frequency.setTargetAtTime(on ? DUCK_HZ : this._openHz, now, on ? 0.05 : 0.12);
    this.musicBus.gain.setTargetAtTime(BUS.music * (on ? 0.6 : 1), now, 0.1);
  }

  /** Ghostep: low-pass + duck the world mix for `hold` real seconds, then release. */
  _slowDuck(hold) {
    if (!this.ctx || !this.slowLp || !this.slowGain) return;
    const now = this.ctx.currentTime;
    const h = clamp(num(hold, 0.6), 0.1, 3);
    const f = this.slowLp.frequency;
    holdAt(f, now);
    f.setTargetAtTime(SLOW_HZ, now, 0.03);
    f.setTargetAtTime(this._openHz, now + h, 0.16);
    const g = this.slowGain.gain;
    holdAt(g, now);
    g.setTargetAtTime(SLOW_GAIN, now, 0.04);
    g.setTargetAtTime(1, now + h, 0.18);
  }

  /** Brief music dip under the timing flash. */
  _dipMusic() {
    if (!this.ctx || !this.musicDip) return;
    const now = this.ctx.currentTime;
    const g = this.musicDip.gain;
    holdAt(g, now);
    g.setTargetAtTime(DIP_LEVEL, now, 0.012);
    g.setTargetAtTime(1, now + DIP_HOLD, 0.12);
  }

  // --- per frame ----------------------------------------------------------------------------

  _tick(realDt) {
    const ctx = this.ctx;
    const dt = Number.isFinite(realDt) ? clamp(realDt, 0, 0.1) : 0;
    const now = ctx.currentTime;

    // a context that got suspended behind our back (autoplay policy, device change) → retry
    if (ctx.state === 'suspended' && this._gestured && !this._hiddenSuspend && !this._hidden()) {
      const t = performance.now();
      if (t > this._resumeAt) {
        this._resumeAt = t + 1000;
        ctx.resume().catch(() => {});
      }
    }

    this._reap(now);

    // pain growl decided at end of frame: a stagger/death in the same hit brings its own growl
    if (this._painPending) {
      this._painPending = false;
      this.play('dragonPain', this._atDragon());
    }
    // a posture break carries its own impact + roar: no extra stagger crunch on top
    if (this._staggerPending) {
      this._staggerPending = false;
      if (!(now >= this._breakAt && now - this._breakAt < 0.3)) this.play('stagger', this._atDragon());
    }
    // a blocked blow's chip damage gets the block thud, not a hurt grunt
    if (this._hurtPending) {
      this._hurtPending = false;
      if (this._blockFrame !== this._frame && this.play('hurt', this._hurtOpts)) this._hurtAt = now;
    }
    // a perfect dodge has its own (Ghostep) sound, and the rest of that attack passing through the
    // Ghostep i-frames must not whoosh over the slow-mo
    if (this._dodgePending) {
      this._dodgePending = false;
      const sinceGhost = now - this._ghostAt;
      if (this._ghostFrame !== this._frame && !(sinceGhost >= 0 && sinceGhost < GHOST_QUIET)) this.play('dodge');
    }
    this.charge?.update(now, dt, this.game);

    if (this.music) this.music.schedule(now, 0.3);
    for (let i = this._fading.length - 1; i >= 0; i--) {
      const l = this._fading[i];
      if (now > l.deadAt) {
        l.dispose();
        this._fading.splice(i, 1);
      }
    }
    if (this.musicMode === 'victory' && now - this._musicSince > VICTORY_SETTLE) this._setMusic('ambient');

    this.ambience?.update(now, dt, this.game);

    const b = this.breath;
    if (b) {
      if (b.active) {
        const s = this.game.state;
        const ds = this.game.dragon?.state;
        const wrongState = s !== 'boss' && s !== 'bossIntro' && s !== 'paused';
        if (wrongState || ds === 'dying' || ds === 'dead' || ds === 'sleeping' || b.age > BREATH_MAX) b.stop();
      }
      b.update(now, dt, this.game, b.active ? this._dragonPos() : null);
    }
  }

  _reap(now) {
    for (const list of this._poolLists) {
      for (let i = list.length - 1; i >= 0; i--) {
        const v = list[i];
        if (v.end + 0.15 < now) {
          v.dispose();
          list.splice(i, 1);
        }
      }
    }
  }

  /** New voice in a pool; steals the lowest-priority/oldest one when full (null = dropped). */
  _voice(pool, opts) {
    if (!this.ctx) return null;
    const list = this.pools[pool];
    const cap = POOL_CAPS[pool];
    const now = this.ctx.currentTime;
    const prio = opts.prio ?? 2;
    let active = 0;
    let victim = null;
    for (const v of list) {
      if (v.killed || v.end <= now) continue;
      active++;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
    }
    if (active >= cap) {
      if (!victim || victim.prio > prio) return null;
      victim.kill(now);
    }
    const v = new Voice(this, { ...opts, bus: opts.bus || this.sfxBus });
    list.push(v);
    return v;
  }

  /** Stereo pan + distance gain of a world point relative to the player. Reused object. */
  _spatial(x, z, falloff = 1) {
    const sp = this._sp;
    sp.pan = 0;
    sp.gain = 1;
    const p = this.game.player?.position;
    if (!p || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return sp;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    sp.pan = clamp(dx / 14, -0.8, 0.8);
    if (d > 8) {
      const db = Math.max((-12 * falloff * Math.log(d / 8)) / Math.log(35 / 8), -26);
      sp.gain = Math.pow(10, db / 20);
    }
    return sp;
  }

  /** Dragon head (or root) ground position, or null. Reused object. */
  _dragonPos() {
    const d = this.game.dragon;
    if (!d || !d.position) return null;
    const o = this._dp;
    o.x = d.position.x;
    o.z = d.position.z;
    const hs = d.hurtSpheres;
    if (Array.isArray(hs)) {
      for (let i = 0; i < hs.length; i++) {
        const s = hs[i];
        if (s && s.part === 'head' && Number.isFinite(s.x) && Number.isFinite(s.z)) {
          o.x = s.x;
          o.z = s.z;
          break;
        }
      }
    }
    return Number.isFinite(o.x) && Number.isFinite(o.z) ? o : null;
  }

  /** opts object positioned at the dragon (for events that carry no x/z). */
  _atDragon(extra) {
    const o = extra || {};
    const p = this._dragonPos();
    if (p) {
      o.x = p.x;
      o.z = p.z;
    }
    return o;
  }

  /** opts object at an event's x/z (combat:tell / combat:flash), else at the dragon. */
  _atEvent(d) {
    const x = num(d?.x, NaN);
    const z = num(d?.z, NaN);
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
    return this._atDragon();
  }

  /** Perfect dodge → Ghostep: one whoosh + one slow-mo duck per blink (both events may arrive). */
  _ghostep() {
    const now = this.ctx.currentTime;
    this._ghostFrame = this._frame;
    if (now >= this._ghostAt && now - this._ghostAt < GHOST_DEDUPE) return;
    this._ghostAt = now;
    this.charge?.stop(0.05);
    const slow = num(DEFENSE.ghostep?.slowmoTime, 0.6);
    this.play('ghostep', { slow });
    this._slowDuck(slow);
  }

  // --- music --------------------------------------------------------------------------------

  _setMusic(mode) {
    if (!MODES.has(mode)) mode = 'none';
    const ctx = this.ctx;
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this._musicSince = ctx ? ctx.currentTime : 0;
    if (!ctx) return;
    const now = ctx.currentTime;
    const cur = this.music;
    // boss ↔ boss2 keeps the same beat grid; only the extra parts fade
    if (cur && cur.kind === 'boss' && (mode === 'boss' || mode === 'boss2')) {
      cur.setIntensity(mode === 'boss2' ? 2 : 1, now, XFADE);
      return;
    }
    if (cur) {
      cur.fadeOut(now, XFADE);
      this._fading.push(cur);
      this.music = null;
    }
    if (mode === 'death') {
      this.play('gong'); // rate-limited: no double toll with player:died
      return;
    }
    const layer = createMusic(this, mode);
    if (layer) {
      layer.fadeIn(now, XFADE);
      this.music = layer;
    }
  }

  /** Automatic music choice; applied at the end of the frame unless flow chose explicitly. */
  _autoMusic(mode) {
    this._auto = mode;
    this._autoFrame = this._frame;
  }

  _trackState(from, to) {
    if (to === this._seenState) return;
    const prev = from ?? this._seenState;
    this._seenState = to;
    this._onState(prev, to);
  }

  _onState(from, to) {
    if (to === 'paused') {
      this._prePause = from;
      this._duck(true);
      this.play('blip', { kind: 'pause' });
      return;
    }
    if (from === 'paused') {
      this._duck(false);
      this.play('blip', { kind: 'resume' });
      if (to === this._prePause) return;
    }
    if (to !== 'boss' && to !== 'bossIntro') this.breath?.stop();
    if (from === 'title' && to !== 'title') this.play('blip', { kind: 'start' });
    let want = null;
    if (to === 'title' || to === 'explore') want = 'ambient';
    else if (to === 'bossIntro') want = 'none';
    else if (to === 'boss') want = this.game.dragon?.phase >= 2 ? 'boss2' : 'boss';
    else if (to === 'dead') want = 'death';
    else if (to === 'victory') want = 'victory';
    if (want) this._autoMusic(want);
  }

  // --- events -------------------------------------------------------------------------------

  _subscribe(ev) {
    if (!ev || typeof ev.on !== 'function') return;
    const on = (name, fn) =>
      ev.on(name, (d) => {
        if (!this.ctx) return;
        try {
          fn(d && typeof d === 'object' ? d : EMPTY);
        } catch (err) {
          this._warn(name, err);
        }
      });

    // player
    on('player:attack', (d) => {
      // releasing the charged cleave (or any swing) ends the charge hum; the slam, the cleave and the
      // execution's thrust swing heavy, the thrust as a long rising hiss
      const heavy = d.kind === 'thrust' || d.kind === 'cleave' || d.kind === 'slam' || d.kind === 'heavy';
      if (this.charge?.active) this.charge.stop(heavy ? 0.05 : 0.08);
      this.play('swing', { heavy, combo: d.combo, thrust: d.kind === 'thrust' });
    });
    on('player:slam', (d) => this.play('slam', { x: d.x, z: d.z }));
    on('player:charge', (d) => this.charge?.start(d));
    on('player:hitDragon', (d) => {
      if (d.kind === 'plunge') return; // the plunge's own impact plays on player:plungeHit
      this.play('hit', { heavy: d.heavy, crit: d.crit, part: d.part, damage: d.damage, x: d.point?.x, z: d.point?.z });
    });
    // the plunge: the dive's rush, then the blade into the skull
    on('player:plunge', (d) => this.play('plungeDive', { exec: !!d.execution }));
    on('player:plungeHit', (d) => this.play('plungeHit', { exec: !!d.execution }));
    on('player:hurt', (d) => {
      // (a hit that interrupts a charge is caught by the charge hum's player-state poll)
      // burn DoT ticks (every 0.5 s) and the breath's contact ticks (every 0.15 s) would grunt
      // like a machine gun: they get a short sizzle, the full impact + grunt at most per GRUNT_GAP
      const kind = String(d.kind || '');
      const now = this.ctx.currentTime;
      if (kind === 'burn' || (kind === 'fire' && now >= this._hurtAt && now - this._hurtAt < GRUNT_GAP)) {
        this.play('sizzle');
        return;
      }
      // played at the end of the frame (see _tick); the biggest blow of the frame wins
      const dmg = num(d.damage, 0);
      const h = this._hurtOpts;
      if (!this._hurtPending || dmg > h.damage) {
        h.damage = dmg;
        h.kind = kind;
      }
      this._hurtPending = true;
    });
    on('player:dodge', () => {
      this._dodgePending = true;
    });
    on('player:roll', () => {
      this.charge?.stop(0.06);
      this.play('roll');
    });
    on('player:heal', () => this.play('heal'));
    on('player:noFlask', () => this.play('noFlask'));
    on('player:lockOn', (d) => this.play('lockOn', d));
    on('player:footstep', (d) => this.play('footstep', d));

    // defence answers
    on('player:block', (d) => {
      this._blockFrame = this._frame;
      this.play('block', { tell: d.tell, damage: d.damage });
    });
    on('player:parry', (d) => {
      this.charge?.stop(0.05);
      // a deflect chain (parries in rhythm) rings higher with every blow met
      this.play('parry', { tell: d.tell, chain: d.chain, perfect: !!(d.light && d.perfect), melee: !d.light, perfectMelee: !d.light && !!d.perfect });
    });
    // the duel's moments (a duelist; the Ash Disciple): steel on steel, heavier as they land
    on('player:lock', (d) => {
      if (d.phase === 'start') this.play('block', { tell: 'blue', damage: 0 });
      else if (d.phase === 'push') this.play('guard', { heavy: false }); // (a shove grinds: no bell per press)
      else if (d.phase === 'won') this.play('parry', { tell: 'blue', chain: 6 });
      else this.play('block', { tell: 'blue', damage: 10 });
    });
    on('player:mikiri', () => this.play('parry', { tell: 'blue', chain: 5 }));
    // a deep gong under the slow motion (the blade lock's camera push-in has its own clash and no slow-mo)
    on('game:cinematic', (e) => { if (e?.kind !== 'lock' && e?.kind !== 'perfectParry') this.play('gong'); });
    on('dragon:deflected', () => this.play('parry', { tell: 'blue', chain: 8 }));
    on('player:guardBreak', () => {
      this.charge?.stop(0.05);
      this.play('guardBreak');
    });
    on('player:perfectDodge', () => this._ghostep());
    on('player:ghostep', () => this._ghostep());

    // attack tells (any attacker): the player's reaction cues
    on('combat:tell', (d) => {
      if (d.bullet) return; // a bullet's cue is its combat:flash ping alone (dozens per pattern)
      const o = this._atEvent(d);
      if (d.hazard) this.play('hazardTell', o); // a fire hazard's own tell (meteors, pillars): no brass sting
      else if (d.tell === 'blue') this.play('tellBlue', o);
      else if (d.tell === 'red') {
        this.play('tellRed', o);
        this._dipMusic();
      } else this.play('tellTick', o);
    });
    on('combat:flash', (d) => {
      const o = this._atEvent(d);
      o.tell = d.tell === 'blue' || d.tell === 'red' ? d.tell : 'normal';
      if (this.play('flash', o) && !d.bullet) this._dipMusic();
    });

    on('player:died', () => {
      this.charge?.stop(0.1);
      this.breath?.stop(0.3);
      // flow counts a death after the wyrm has fallen as a victory: no toll in that case
      const ds = this.game.dragon?.state;
      if (ds === 'dying' || ds === 'dead') return;
      this.play('gong');
      this._autoMusic('death');
    });

    // dragon (the boss slot: a creature's voice only for a creature; a duelist, the Ash Disciple,
    // is steel and footfalls: his guard rings like a block, his body makes no roars or yelps)
    const beast = () => this.game.dragon?.kind !== 'duelist';
    on('dragon:wake', () => beast() && this.play('wake', this._atDragon()));
    on('dragon:roar', (d) => beast() && this.play('roar', this._atDragon({ strength: d.strength })));
    on('dragon:windup', (d) => beast() && this.play('windup', this._atDragon({ name: d.name })));
    on('dragon:attack', (d) => {
      if (beast() && !RX_OWN_SOUND.test(String(d.name || ''))) this.play('dragonSwipe', this._atDragon());
    });
    // two cuts meet (the trade clash)
    on('combat:clash', (d) => {
      this.charge?.stop(0.05);
      this.play('trade', { heavy: !!d?.heavy });
    });
    // his guard: a dry clack when he holds the strike, a harsh falling clang when he beats it away
    on('dragon:guard', (d) => this.play(d?.deflect ? 'deflected' : 'guard', { heavy: !!d?.heavy }));
    on('dragon:step', (d) => this.play('dragonStep', d));
    on('dragon:wingFlap', (d) => this.play('wingFlap', this._atDragon({ strength: d.strength })));
    on('dragon:takeoff', () => beast() && this.play('takeoff', this._atDragon()));
    on('dragon:land', (d) => this.play('land', d));
    on('dragon:breathStart', () => this.breath?.start());
    on('dragon:breathEnd', () => this.breath?.stop());
    on('dragon:fireball', (d) => this.play('fireball', d));
    on('dragon:explosion', (d) => this.play('explosion', d));
    on('dragon:bite', () => this.play('bite', this._atDragon()));
    on('dragon:hurt', (d) => {
      if (!beast()) return;
      const now = this.ctx.currentTime;
      if (now - this._staggerAt < 1.5 || num(d.hp, 1) <= 0) return;
      const max = num(this.game.dragon?.maxHp, 0);
      const frac = max > 0 ? num(d.damage, 0) / max : 0;
      // played in update(): takeHit emits stagger/death right after hurt, which cancel it
      if (frac > 0.035 || Math.random() < 0.25) this._painPending = true;
    });
    on('dragon:stagger', () => {
      this._staggerAt = this.ctx.currentTime;
      this._painPending = false;
      this.breath?.stop(0.2);
      this._staggerPending = beast(); // played in update() unless a posture break claims it
    });
    on('dragon:returned', (d) => this.play('returnHit', { x: d.x, z: d.z, kind: d.kind }));
    on('dragon:parried', (d) => {
      if (d.bullet || !beast()) return; // a deflected bullet (or a duelist's blade): the clash rings (player:parry), nothing yelps
      this._painPending = false;
      this.play('dragonRecoil', this._atDragon({ tell: d.tell }));
    });
    on('dragon:postureBreak', () => {
      const now = this.ctx.currentTime;
      this._breakAt = now;
      this._staggerAt = now;
      this._painPending = false;
      this._staggerPending = false;
      this.breath?.stop(0.2);
      // like phase2: a 'dragon:roar' in the same frame already roared, so the break claims the slot
      const last = this._last.get('roar');
      const roared = last !== undefined && now >= last && now - last < 0.3;
      this.play('postureBreak', this._atDragon({ roar: !roared && beast() }));
      this._last.set('roar', now);
    });
    on('dragon:phase2', () => {
      // the dragon emits dragon:roar in the same frame: the phase2 sting carries the enraged
      // roar itself, so it claims the roar slot (rate limit) instead of stacking two roars
      const now = this.ctx.currentTime;
      const last = this._last.get('roar');
      const roared = last !== undefined && now >= last && now - last < 0.3;
      this.play('phase2', this._atDragon({ roar: !roared && beast() }));
      this._last.set('roar', now);
      if (this.musicMode === 'boss' || this.game.state === 'boss') this._autoMusic('boss2');
    });
    // (phase 4: a boss with four forms, the Starless Lord: the same sting)
    for (const name of ['dragon:phase3', 'dragon:phase4']) on(name, () => {
      // the white-hot phase: the enraged sting again (it claims the roar slot like phase 2), and the
      // phase-2 music if the Lab jumped straight here
      const now = this.ctx.currentTime;
      const last = this._last.get('roar');
      const roared = last !== undefined && now >= last && now - last < 0.3;
      this.play('phase2', this._atDragon({ roar: !roared }));
      this._last.set('roar', now);
      if (this.musicMode === 'boss' || this.musicMode === 'boss2' || this.game.state === 'boss') this._autoMusic('boss2');
    });
    on('dragon:plunged', (d) => {
      // the blade in its skull: the body-slam thump and a pained roar (an execution: the break's)
      this._painPending = false;
      this.play(d.execution ? 'postureBreak' : 'dragonPain', this._atDragon({ roar: beast() }));
    });
    on('dragon:death', () => {
      this._painPending = false;
      this.breath?.stop(0.3);
      if (beast()) this.play('dragonDeath', this._atDragon());
      this._autoMusic('none');
    });
    on('dragon:dead', () => this.play('emberHiss', this._atDragon()));
    subscribeFire(on, this); // dragon:spell / dragon:hazard (fire spells, flights, hazards: audio/fire.js)

    // flow
    on('bonfire:rest', () => {
      const bf = this.game.world?.bonfire;
      this.play('bonfire', bf ? { x: bf.x, z: bf.z } : EMPTY);
    });
    on('game:retry', () => {
      this.charge?.stop(0.05);
      this.breath?.stop(0.08);
      this.play('retry');
    });
    on('game:victory', () => {
      this.breath?.stop(0.3);
      this.play('victory');
      this._autoMusic('victory');
    });
    on('area', () => this.play('area'));

    // state changes are tracked even before the context exists (they drive music choice)
    ev.on('state', (d) => {
      try {
        const to = d && d.to !== undefined ? d.to : this.game.state;
        this._trackState(d?.from, to);
      } catch (err) {
        this._warn('state', err);
      }
    });
  }

  // --- browser plumbing -----------------------------------------------------------------------

  _hidden() {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  _listenForGesture() {
    if (typeof addEventListener !== 'function') return;
    const evs = ['pointerdown', 'keydown', 'touchend'];
    const handler = () => {
      this.unlock();
      if (this.ctx && this.ctx.state === 'running') {
        for (const e of evs) removeEventListener(e, handler, true);
      }
    };
    for (const e of evs) addEventListener(e, handler, true);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const ctx = this.ctx;
        if (!ctx || ctx.state === 'closed') return;
        if (document.hidden) {
          if (ctx.state === 'running') {
            this._hiddenSuspend = true;
            ctx.suspend().catch(() => {});
          }
        } else if (this._hiddenSuspend) {
          this._hiddenSuspend = false;
          ctx.resume().catch(() => {});
        }
      });
    }
  }

  _warn(key, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[audio] ${key} failed`, err);
  }
}
