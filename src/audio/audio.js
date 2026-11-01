import { clamp } from '../core/math.js';
import { createNoiseBuffers, createImpulse, limiterCurve, num } from './dsp.js';
import { Voice } from './voice.js';
import { SFX } from './sfx.js';
import { ForestAmbience, BreathLoop } from './ambience.js';
import { createMusic } from './music.js';

// Procedural WebAudio engine: every sound is synthesised at runtime (no sample files).
// The AudioContext is created lazily by unlock() (flow calls it on title dismiss; the engine
// also unlocks itself on the first pointer/key gesture). Every method is a no-op before that.
//
// Graph:
//   sfx / music / ambient buses ─┐
//   reverb return (2.8 s hall) ──┴→ mix → pause-duck LPF → master (volume/mute)
//   ui bus (blips, never ducked) ──────────────────────────→ master → compressor → soft limiter → out
//   every voice / layer also feeds a send into the convolution reverb.
//
// play(name, opts) one-shots — opts.x/opts.z spatialise against the player (pan by Δx,
// full level within 8 m, ≈ −12 dB at 35 m), opts.gain, opts.pan, opts.delay (s):
//   player   swing{heavy,combo} hit{heavy,crit,part} hurt{damage,kind} sizzle roll
//            footstep{sprint} heal noStamina noFlask lockOn{on} dodge gong
//   dragon   roar{strength,pitch} wake dragonStep{heavy} wingFlap{strength} takeoff land bite
//            windup{name} dragonSwipe dragonPain fireball explosion{radius} stagger
//            phase2{roar} dragonDeath emberHiss
//   world/ui bonfire victory area retry blip{kind: select|start|pause|resume|error}
//   aliases  ui click select confirm start pause resume back cancel error → blip variants
//
// Music (setMusic): 'none' | 'ambient' | 'boss' | 'boss2' | 'victory' | 'death', 1.5 s
// crossfades. If flow does not pick music itself, the engine follows game.state / dragon
// events; an explicit setMusic() in the same frame always wins over the automatic choice.

const MODES = new Set(['none', 'ambient', 'boss', 'boss2', 'victory', 'death']);
const XFADE = 1.5;
const MASTER = 0.9;
const BUS = { sfx: 1, music: 0.42, ambient: 0.55, reverb: 0.6, ui: 0.8 };
const POOL_CAPS = { sfx: 24, music: 18, amb: 6 };
const BREATH_MAX = 12; // s of unpaused breath before the safety stop
const VICTORY_SETTLE = 10; // s of victory pad before settling to ambient
const GRUNT_GAP = 0.5; // s: rapid fire-contact ticks only grunt this often (sizzle in between)
const DUCK_HZ = 650;
const EMPTY = Object.freeze({});
const RX_OWN_SOUND = /breath|fire|flame|ball|bite|roar|inferno|blaze|meteor/i;

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
      this.reverbIn = this.ambience = this.breath = this.music = null;
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
    let def = SFX[name];
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
    const bus = def.bus === 'ui' ? this.uiBus : this.sfxBus;
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
    this.mix.connect(this.duck).connect(this.master);

    const bus = (level, dest) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(dest);
      return g;
    };
    this.sfxBus = bus(BUS.sfx, this.mix);
    this.musicBus = bus(BUS.music, this.mix);
    this.ambientBus = bus(BUS.ambient, this.mix);
    this.uiBus = bus(BUS.ui, this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createImpulse(ctx, 2.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(bus(BUS.reverb, this.mix));

    this.ambience = new ForestAmbience(this);
    this.breath = new BreathLoop(this);

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
    else if (to === 'boss') want = this.game.dragon?.phase === 2 ? 'boss2' : 'boss';
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
    on('player:attack', (d) => this.play('swing', { heavy: d.kind === 'heavy', combo: d.combo }));
    on('player:hitDragon', (d) =>
      this.play('hit', { heavy: d.heavy, crit: d.crit, part: d.part, damage: d.damage, x: d.point?.x, z: d.point?.z }),
    );
    on('player:hurt', (d) => {
      // burn DoT ticks (every 0.5 s) and the breath's contact ticks (every 0.15 s) would grunt
      // like a machine gun: they get a short sizzle, the full impact + grunt at most per GRUNT_GAP
      const kind = String(d.kind || '');
      const now = this.ctx.currentTime;
      if (kind === 'burn' || (kind === 'fire' && now >= this._hurtAt && now - this._hurtAt < GRUNT_GAP)) {
        this.play('sizzle');
        return;
      }
      if (this.play('hurt', d)) this._hurtAt = now;
    });
    on('player:dodge', () => this.play('dodge'));
    on('player:roll', () => this.play('roll'));
    on('player:heal', () => this.play('heal'));
    on('player:noStamina', () => this.play('noStamina'));
    on('player:noFlask', () => this.play('noFlask'));
    on('player:lockOn', (d) => this.play('lockOn', d));
    on('player:footstep', (d) => this.play('footstep', d));
    on('player:died', () => {
      this.breath?.stop(0.3);
      // flow counts a death after the wyrm has fallen as a victory: no toll in that case
      const ds = this.game.dragon?.state;
      if (ds === 'dying' || ds === 'dead') return;
      this.play('gong');
      this._autoMusic('death');
    });

    // dragon
    on('dragon:wake', () => this.play('wake', this._atDragon()));
    on('dragon:roar', (d) => this.play('roar', this._atDragon({ strength: d.strength })));
    on('dragon:windup', (d) => this.play('windup', this._atDragon({ name: d.name })));
    on('dragon:attack', (d) => {
      if (!RX_OWN_SOUND.test(String(d.name || ''))) this.play('dragonSwipe', this._atDragon());
    });
    on('dragon:step', (d) => this.play('dragonStep', d));
    on('dragon:wingFlap', (d) => this.play('wingFlap', this._atDragon({ strength: d.strength })));
    on('dragon:takeoff', () => this.play('takeoff', this._atDragon()));
    on('dragon:land', (d) => this.play('land', d));
    on('dragon:breathStart', () => this.breath?.start());
    on('dragon:breathEnd', () => this.breath?.stop());
    on('dragon:fireball', (d) => this.play('fireball', d));
    on('dragon:explosion', (d) => this.play('explosion', d));
    on('dragon:bite', () => this.play('bite', this._atDragon()));
    on('dragon:hurt', (d) => {
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
      this.play('stagger', this._atDragon());
    });
    on('dragon:phase2', () => {
      // the dragon emits dragon:roar in the same frame: the phase2 sting carries the enraged
      // roar itself, so it claims the roar slot (rate limit) instead of stacking two roars
      const now = this.ctx.currentTime;
      const last = this._last.get('roar');
      const roared = last !== undefined && now >= last && now - last < 0.3;
      this.play('phase2', this._atDragon({ roar: !roared }));
      this._last.set('roar', now);
      if (this.musicMode === 'boss' || this.game.state === 'boss') this._autoMusic('boss2');
    });
    on('dragon:death', () => {
      this._painPending = false;
      this.breath?.stop(0.3);
      this.play('dragonDeath', this._atDragon());
      this._autoMusic('none');
    });
    on('dragon:dead', () => this.play('emberHiss', this._atDragon()));

    // flow
    on('bonfire:rest', () => {
      const bf = this.game.world?.bonfire;
      this.play('bonfire', bf ? { x: bf.x, z: bf.z } : EMPTY);
    });
    on('game:retry', () => {
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
