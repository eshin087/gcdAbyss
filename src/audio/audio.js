import { clamp } from '../core/math.js';
import { DEFENSE } from '../combat/rules.js';
import { createNoiseBuffers, createImpulse, limiterCurve, holdAt, num, arand } from './dsp.js';
import { Voice } from './voice.js';
import { SFX, bladeWhooshPeak, CUT_SND, cutPitch, RX_FIRE } from './sfx.js';
import { SampleBank, sfxMode, chainMode } from './samples.js';
import { SLOT, HEAVY, BLOWS, HERO, BEAST, blowSlot, HERO_SLOT, HURT, HIT_HEAVY, CUT_SLOT, CUT_REF, FLURRY, EXEC, GUARD_HEAVY, CLASH_HEAVY } from './sampleList.js';
import { PARRY_CHAIN, chainRate, chainGain, chainLayers } from './parryChain.js';
import { clashRing } from '../combat/clashDance.js';
import { ForestAmbience, BreathLoop } from './ambience.js';
import { Air } from './air.js';
import { ChargeHum } from './charge.js';
import { createMusic } from './music.js';
import { FIRE_SFX, subscribeFire } from './fire.js';
import { TrackBank, TrackLoop } from './tracks.js';
import { THUMP_SFX, Thump } from './thump.js';
import { LIFE_SFX } from './lifeSfx.js';
import { DB_SFX_DEFS, getDbSfx, deathblowSound } from './deathblowSfx.js';

// the flash chain's ring (player:counter with a link > 1): + gain and + playback rate (pitch) per link past the first
const CHAIN_RING = { gain: 0.12, rate: 0.07 };
import { StreakSound, perfectSound } from './streakSound.js';

// WebAudio engine: the sound effects are synthesised at runtime, except the attack sounds, the red cues
// and the combat core (parries, hurt, the hero's landed cuts, slam, flurry, plunge, clash, the boss's
// guard), which are recorded / designed one-shots over the synth (samples.js, sampleList.js; OFF by default,
// ADR-176: `?sfx=new` turns them on; `?sfx=old`, the default:
// all synth, as before); the music is recorded tracks per level and boss phase (tracks.js; ADR-117) over a
// synthesised fallback score (music.js).
// The AudioContext is created lazily by unlock() (flow calls it on title dismiss; the engine
// also unlocks itself on the first pointer/key gesture). Every method is a no-op before that.
//
// Graph:
//   sfx / music(→ thump dip → dip) / ambient buses ─┐
//   reverb return (2.8 s hall) ─────────┴→ mix → Ghostep LPF+gain → pause-duck LPF → master
//   cue bus (tells, timing flash, Ghostep: never Ghostep-ducked) ──→ pause-duck LPF ─┘
//   ui bus (blips, never ducked) ─────────────────────────────────→ master → compressor → limiter → out
//   every voice / layer also feeds a send into the convolution reverb.
//
// play(name, opts) one-shots — opts.x/opts.z spatialise against the player (pan by Δx,
// full level within 8 m, ≈ −12 dB at 35 m), opts.gain, opts.pan, opts.delay (s):
//   player   swing{heavy,combo,thrust} (the light cut recorded sword-light when loaded) slam hit{heavy,crit,part}
//            cut{weight,combo,alt} hurt{damage,kind} sizzle roll footstep{sprint} heal noFlask lockOn{on}
//            dodge gong flurryCut flurryCoil plungeDive plungeHit (recorded over the synth when loaded:
//            slam, hit-scale (+ hitCrit), cut-light / cut-heavy, hurt (+ hurtFire), flurry-cut,
//            flurry-coil, plunge-dive, plunge-hit; sampleList.js)
//   combat   tellBlue tellRed tellTick flash{tell} parry{tell,chain} block{tell} guardBreak trade guard
//            (recorded cue-red / time-red over tellRed / flash, cue-blue / time-blue the synth (no file);
//            a blade's parry recorded parry / parry-blue (+ parryPerfect, the chain's build:
//            parryChain.js), trade → clash, guard → boss-guard; normal tells and flashes silent unless
//            ?sfx=old)
//   duelist  bladeWhoosh{weapon,weight,shape} (the recorded sword-* / fist-* when loaded; dragon:attack)
//            ghostep{slow}   (+ the sustained charge hum: player:charge → release/interrupt)
//            plungeDive{exec} plungeHit{exec}
//   dragon   roar{strength,pitch} wake dragonStep{heavy} wingFlap{strength} takeoff land bite
//            windup{name} dragonSwipe (recorded beast-claw / beast-tail by name) dragonPain dragonRecoil{tell} postureBreak{roar}
//            fireball explosion{radius} stagger phase2{roar} dragonDeath emberHiss paperTear{soft}
//   world/ui bonfire victory area retry blip{kind: select|start|pause|resume|error}
//   aliases  ui click select confirm start pause resume back cancel error → blip variants
//
// Music (setMusic): 'none' | 'ambient' | 'boss' | 'boss2' | 'victory' | 'death', 1.5 s
// crossfades. A level's recorded tracks (tracks.js, trackList.js; ADR-117) play over the synthesised
// score when they have loaded: 'ambient' is the level's exploring track, 'boss' / 'boss2' the track of
// the boss's current phase (a phase change crossfades to the next); the synth is the fallback.
// If flow does not pick music itself, the engine follows game.state / dragon
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
// the wyrm's claw / tail attacks by name (sampleList.js BEAST) → their recorded slot
const BEAST_SLOT = new Map([...BEAST.claw.map((n) => [n, 'beast-claw']), ...BEAST.tail.map((n) => [n, 'beast-tail'])]);

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
    this.tracks = null; // recorded music (built with the graph; ADR-117)
    this.thump = new Thump(this); // the impact pass's low end + music dip (thump.js; no nodes of its own)
    this.thumpDip = null; // its gain on the music path (built with the graph; 1 when idle)
    this.streakSound = new StreakSound(this); // the streak pass's climb, loss and layer (streakSound.js; builds nothing until it plays)
    this.samples = null; // the recorded attack sounds and blue / red cues (built with the graph; samples.js)
    this._blowAt = -10; // ctx time the last boss blow's sound starts (BLOWS.gap)
    this._smp = { x: undefined, z: undefined, impactIn: 0 }; // reused opts for a blow's sample
    this._smpAt = { x: undefined, z: undefined, impactIn: 0 }; // reused opts for the hero's own samples
    this._smpStart = { from: 0, fadeIn: 0, cut: 0, fadeOut: 0, dest: null }; // reused SampleBank.start opts
    this._musicPhase = 0; // the boss phase whose track is playing (0: not a boss mode)
    this._phaseHint = 1; // the latest phase a dragon:phase* event announced (the wyrm sets its own number later)
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
    this._db = null; // the deathblow in progress { at, gap } (player:flurry art 'deathblow'), else null
    this._cutN = 0; // landed cuts: the 'cut' layer alternates its detune
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
      this.cueBus = this.slowLp = this.slowGain = this.musicDip = this.thumpDip = null;
      this.reverbIn = this.ambience = this.breath = this.charge = this.music = this.tracks = this.samples = null;
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
    let def = SFX[name] ?? FIRE_SFX[name] ?? THUMP_SFX[name] ?? LIFE_SFX[name] ?? DB_SFX_DEFS[name];
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

  /**
   * A recorded one-shot of `slot` (sampleList.js). False when the slot has nothing ready (no file, not
   * loaded, failed, no fetch, `?sfx=old`): the caller plays its synth recipe. True when it is handled,
   * played or dropped (the slot's `gap`, BLOWS.gap for a boss's blow, a full voice pool).
   *   o        x / z (spatialised at that point), impactIn (game s to the blow's impact: an `align` slot
   *            puts the clip's loudest moment there, less its `lead`)
   *   gainMul, rateMul   on top of the slot's own
   *   who      'hero' (the hero's own swing: HERO's prio / rev / gap) | 'blow' (a boss's blow: BLOWS.gap
   *            across every blow slot) | undefined
   *   layer    (v, t, r, rate) => void: more in the same voice, after the clip starts at t (the deflect
   *            chain's build)
   * An `align` slot with `skip` whose peak would land late starts into the file instead; one with `cut`
   * fades out that long after its peak (the flurry's coil: its top on the strike).
   */
  _sample(slot, o, gainMul = 1, rateMul = 1, who, layer) {
    const ctx = this.ctx, bank = this.samples, C = SLOT[slot];
    if (!ctx || ctx.state === 'closed' || !bank || !C || sfxMode() === 'old') return false;
    const r = bank.pick(slot);
    if (!r) return false;
    const now = ctx.currentTime;
    const hero = who === 'hero';
    // (prefixed: the gap keys never meet a play() recipe of the same name, 'parry', 'slam', 'hurt')
    const key = hero ? 'smp:hero' : `smp:${slot}`;
    const gap = hero ? HERO.gap : C.gap;
    const last = this._last.get(key);
    if (last !== undefined && now >= last && now - last < gap) return true;
    const rate = Math.max(0.25, C.rate * rateMul * (1 + (bank.rand() * 2 - 1) * C.jitter));
    let delay = 0, from = 0;
    if (C.align && o) {
      const d = num(o.impactIn, 0) / this._timeScale() - r.peak / rate - C.lead;
      if (d >= 0) delay = d;
      else if (C.skip) from = Math.min(r.peak, -d * rate); // s of the file skipped (file time)
    }
    const at = now + delay;
    // (a boss's blows together: a flurry's next one inside BLOWS.gap of the last is left out)
    if (who === 'blow') {
      if (Math.abs(at - this._blowAt) < BLOWS.gap) return true;
      this._blowAt = at;
    }
    let pan = 0;
    let gain = Math.max(0, gainMul) * C.gain * (hero ? HERO.gain : 1);
    if (o && o.x !== undefined && o.z !== undefined) {
      const sp = this._spatial(o.x, o.z, C.falloff);
      pan = sp.pan;
      gain *= sp.gain;
    }
    const bus = C.bus === 'cue' ? this.cueBus || this.sfxBus : this.sfxBus;
    const v = this._voice('sfx', { bus, pan, gain, rev: hero ? HERO.rev : C.rev, prio: hero ? HERO.prio : C.prio });
    if (!v) return true;
    this._last.set(key, now);
    try {
      let so = null;
      const cut = C.align && C.cut >= 0 ? C.cut : -1;
      if (from > 0 || cut >= 0) {
        so = this._smpStart;
        so.from = from;
        so.fadeIn = from > 0 ? num(C.fadeIn, 0) : 0;
        so.cut = cut >= 0 ? Math.max(0.005, (r.peak - from) / rate + cut) : 0;
        so.fadeOut = num(C.fadeOut, 0.01);
      }
      this.samples.start(v, at + 0.006, r, 1, rate, so);
      if (layer) layer(v, at + 0.006, r, rate);
    } catch (err) {
      v.kill(now);
      this._warn(`sample:${slot}`, err);
    }
    return true;
  }

  /** Game seconds per real second now (Ghostep's slow-mo, the Lab's time scale): a blow's impactIn in real s. */
  _timeScale() {
    const g = this.game;
    return clamp(num(g?.timeScale, 1) * num(g?.debugTimeScale, 1), 0.05, 4);
  }

  /** A duelist's blow through the air (dragon:attack from duelist/brain.js, a fox's paper self): its
   *  recorded slot, else the quiet synth whoosh; either way its loudest moment on the impact. */
  _blow(d) {
    const slot = blowSlot(d.weapon, d.weight, d.shape);
    const heavy = d.weight === 'heavy' && !slot.endsWith('-heavy');
    const o = this._smp;
    o.x = num(d.x, NaN);
    o.z = num(d.z, NaN);
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) o.x = o.z = undefined;
    o.impactIn = num(d.impactIn, 0);
    if (this._sample(slot, o, heavy ? HEAVY.gain : 1, heavy ? HEAVY.rate : 1, 'blow')) return;
    // the fallback: bladeWhoosh, started so its own peak lands on the impact (BLOWS.gap as the samples)
    const now = this.ctx.currentTime;
    const delay = Math.max(0, o.impactIn / this._timeScale() - bladeWhooshPeak(d));
    if (Math.abs(now + delay - this._blowAt) < BLOWS.gap) return;
    if (this.play('bladeWhoosh', { weapon: d.weapon, weight: d.weight, shape: d.shape, x: o.x, z: o.z, delay })) this._blowAt = now + delay;
  }

  /** The hero's own samples' opts (reused): at x / z (or none), impactIn s. */
  _at(x, z, impactIn = 0) {
    const o = this._smpAt;
    o.x = Number.isFinite(x) && Number.isFinite(z) ? x : undefined;
    o.z = o.x === undefined ? undefined : z;
    o.impactIn = impactIn;
    return o;
  }

  /**
   * A parry of a blade, recorded: 'parry-blue' for a blue blow or a perfect parry (+ the perfect layer,
   * 'parryPerfect': its crack and high bell, ring per perfectMode()), else 'parry'; a deflect chain (chain >=
   * 2) builds per chainMode() (parryChain.js). False: nothing recorded (the caller plays the synth 'parry').
   * `o`: the synth parry's opts.
   */
  _parry(o) {
    const slot = o.tell === 'blue' || o.perfectMelee ? 'parry-blue' : 'parry';
    const ch = clamp(Math.round(num(o.chain, 1)), 1, 8);
    const V = ch >= 2 ? PARRY_CHAIN[chainMode()] : null;
    const layer = V ? (v, t, r, rate) => chainLayers(this, V, ch, v, t, r, rate, this.samples, o.tune) : null;
    // the clash dance's ring (?clash=dance; combat/clashDance.js, ADR-247): the run's parries a little higher
    // and louder, on top of the chain's weight ([1, 1] with it off or on a run's first parry)
    const [rg, rr] = clashRing(o.clash);
    if (!this._sample(slot, null, (V ? chainGain(V, ch) : 1) * rg, (V ? chainRate(V, ch) : 1) * rr, undefined, layer)) return false;
    // (its pitch as a single parry: the perfect bell does not climb with the chain)
    if (o.perfectMelee) this.play('parryPerfect', { tell: o.tell, chain: 1, tune: o.tune, ring: o.ring });
    return true;
  }

  /**
   * The parry's other uses (mikiri, the counter, a blade lock won, a boss deflected, a blue flare's timing
   * ring, the flare counter): the blue parry recording as ONE strike (no climb, no bell: the owner, round
   * two sign-off), the synth `parry` with its old chain value until the file loads and with `?sfx=old`.
   */
  _parryAlso(o) {
    if (sfxMode() !== 'old' && this._sample('parry-blue', null)) return true;
    return this.play('parry', o);
  }

  /** A blow on the hero (end of frame): recorded, louder with the damage (HURT), a burn's hiss over it. */
  _hurt(o) {
    const k = clamp(num(o.damage, 20) / HURT.div, HURT.min, HURT.max) / HURT.min;
    if (this._sample('hurt', null, Math.pow(k, HURT.exp))) {
      if (RX_FIRE.test(String(o.kind || ''))) this.play('hurtFire');
      return true;
    }
    return this.play('hurt', o);
  }

  /** A landed cut's body sound: the wyrm's scales recorded (not a wing), a duelist's cloth the synth. */
  _hit(d, x, z, beast) {
    if (beast && d.part !== 'wing') {
      const heavy = !!d.heavy;
      if (this._sample('hit-scale', this._at(x, z), heavy ? HIT_HEAVY.gain : 1, heavy ? HIT_HEAVY.rate : 1)) {
        if (d.crit) this.play('hitCrit', { x, z });
        return;
      }
    }
    this.play('hit', { heavy: d.heavy, crit: d.crit, part: d.part, damage: d.damage, body: beast ? 'scale' : 'cloth', x, z });
  }

  /** A landed cut's blade layer: recorded per weight (CUT_SLOT), at the synth's pitch up the chain. */
  _cut(o) {
    const slot = CUT_SLOT[o.weight];
    const W = CUT_SND[o.weight], R = CUT_SND[CUT_REF[slot]];
    if (slot && W && R && this._sample(slot, this._at(o.x, o.z), W.a / R.a, cutPitch(o))) return;
    this.play('cut', o);
  }

  /** A flash cut of the flurry: recorded, a step higher each cut (the synth's whole tone, or the streak's
   *  scale: f / base), lighter in the storm's merged run. */
  _flurryCut(o) {
    const n = clamp(num(o.n, 1), 1, 8);
    const up = o.f > 0 && o.base > 0 ? o.f / o.base : Math.pow(2, (2 * (n - 1)) / 12);
    if (this._sample('flurry-cut', null, o.fast ? FLURRY.fastGain : 1, Math.min(FLURRY.maxRate, up))) return;
    this.play('flurryCut', o);
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
    this.thumpDip = bus(1, this.musicDip); // a heavy blow's short dip (thump.js); multiplies with the rest
    this.musicBus = bus(BUS.music, this.thumpDip);
    this.ambientBus = bus(BUS.ambient, this.mix);
    this.cueBus = bus(BUS.cue, this.duck);
    this.uiBus = bus(BUS.ui, this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createImpulse(ctx, 2.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(bus(BUS.reverb, this.mix));

    this.ambience = new ForestAmbience(this);
    this.air = new Air(this); // the sound of the air (?life=air): no node until the piece is on
    this.breath = new BreathLoop(this);
    this.charge = new ChargeHum(this);
    this.tracks = new TrackBank(this);
    this.tracks.load();
    this.samples = new SampleBank(this);
    this.samples.load();

    this._applyMaster(0.35);
    if (this._ducked) this._duck(true);
    const mode = this.musicMode;
    this.musicMode = 'none';
    this._musicPhase = 0;
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

  /** The stillness before a draw (the Sheathed): the music drops low while his hand is on the hilt. */
  _stillDuck(on) {
    if (!this.ctx || !this.musicBus || this._ducked) return;
    this.musicBus.gain.setTargetAtTime(BUS.music * (on ? 0.3 : 1), this.ctx.currentTime, on ? 0.12 : 0.3);
  }

  /** THE FALL (Xin Yi): the music drops to silence while he lies, and comes back `lie` s later (on its
   *  own: a reset or a death in between leaves nothing held). */
  _fallDuck(lie) {
    if (!this.ctx || !this.musicBus || this._ducked) return;
    const now = this.ctx.currentTime, g = this.musicBus.gain;
    holdAt(g, now);
    g.setTargetAtTime(BUS.music * 0.02, now, 0.08);
    g.setTargetAtTime(BUS.music, now + clamp(num(lie, 2.2), 0.3, 5), 0.6);
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

  /** End the slow-mo muffle now (a flurry's last blow lands before its planned time is up). */
  _slowOpen() {
    if (!this.ctx || !this.slowLp || !this.slowGain) return;
    const now = this.ctx.currentTime;
    const f = this.slowLp.frequency;
    holdAt(f, now);
    f.setTargetAtTime(this._openHz, now, 0.03);
    const g = this.slowGain.gain;
    holdAt(g, now);
    g.setTargetAtTime(1, now, 0.04);
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
      if (this._blockFrame !== this._frame && this._hurt(this._hurtOpts)) this._hurtAt = now;
    }
    // a perfect dodge has its own (Ghostep) sound, and the rest of that attack passing through the
    // Ghostep i-frames must not whoosh over the slow-mo
    if (this._dodgePending) {
      this._dodgePending = false;
      const sinceGhost = now - this._ghostAt;
      if (this._ghostFrame !== this._frame && !(sinceGhost >= 0 && sinceGhost < GHOST_QUIET)) this.play('dodge');
    }
    this.charge?.update(now, dt, this.game);
    this.streakSound?.tick(now);

    // the boss's phase moved without a music call (a phase number set after its event): follow it
    if ((this.musicMode === 'boss' || this.musicMode === 'boss2') && this._bossPhase(this.musicMode) !== this._musicPhase) {
      this._setMusic(this.musicMode);
    }
    if (this.music) {
      // a recorded track that cannot load hands over to the synthesised score
      if (this.music.failed) {
        this.music.dispose();
        this.music = createMusic(this, this.musicMode);
        this.music?.fadeIn(now, XFADE);
      }
      this.music?.schedule(now, 0.3);
    }
    for (let i = this._fading.length - 1; i >= 0; i--) {
      const l = this._fading[i];
      if (now > l.deadAt) {
        l.dispose();
        this._fading.splice(i, 1);
      }
    }
    if (this.musicMode === 'victory' && now - this._musicSince > VICTORY_SETTLE) this._setMusic('ambient');

    this.ambience?.update(now, dt, this.game);
    this.air?.update(now, dt, this.game);

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
    // a single perfect dodge per perfectMode() (sharp: no long slow motion; cinema: a deeper beat)
    const slow = num(DEFENSE.ghostep?.slowmoTime, 0.6) * (perfectSound()?.slow ?? 1);
    this.play('ghostep', { slow });
    this._slowDuck(slow);
  }

  // --- music --------------------------------------------------------------------------------

  _setMusic(mode) {
    if (!MODES.has(mode)) mode = 'none';
    const ctx = this.ctx;
    // a boss mode follows the boss's phase: each phase may have a recorded track of its own
    const boss = mode === 'boss' || mode === 'boss2';
    if (!boss) this._phaseHint = 1; // a fight over (or not begun): the next one starts at phase 1
    const phase = boss ? this._bossPhase(mode) : 0;
    if (mode === this.musicMode && phase === this._musicPhase) return;
    if (mode !== this.musicMode) this._musicSince = ctx ? ctx.currentTime : 0;
    this.musicMode = mode;
    this._musicPhase = phase;
    if (!ctx) return;
    const now = ctx.currentTime;
    const cur = this.music;
    const spec = this.tracks?.track(mode, phase) ?? null;
    // the same recorded track (a phase past the level's last listed one): it plays on
    if (spec && cur && cur.kind === 'track' && cur.spec.file === spec.file) return;
    // synth boss ↔ boss2 keeps the same beat grid; only the extra parts fade
    if (!spec && cur && cur.kind === 'boss' && boss) {
      cur.setIntensity(mode === 'boss2' ? 2 : 1, now, XFADE);
      return;
    }
    if (cur) {
      cur.fadeOut(now, XFADE);
      this._fading.push(cur);
      this.music = null;
    }
    if (mode === 'death') this.play('gong'); // rate-limited: no double toll with player:died
    const layer = spec ? new TrackLoop(this, this.tracks, spec, this.musicBus) : createMusic(this, mode);
    if (layer) {
      layer.fadeIn(now, XFADE);
      this.music = layer;
    }
  }

  /** The boss's current phase (1-based) for the phase tracks; without a boss, 'boss2' is phase 2. */
  _bossPhase(mode) {
    const p = Number(this.game.dragon?.phase);
    const n = Math.max(Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1, this._phaseHint, mode === 'boss2' ? 2 : 1);
    return Math.min(9, n);
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
      // the recorded blade when it is there (pitched above the bosses', rising up the combo), else the synth
      // (HERO_SLOT: the heavy cut and the thrust are the synth's own)
      const slot = HERO_SLOT[d.kind === 'thrust' ? 'thrust' : heavy ? 'heavy' : 'light'];
      // (the light chain's combo runs 1..5: every cut a step higher, the whirl and the lunge too; it used to
      // fall back at the whirl, `combo % 3`: the owner, round two sign-off)
      const step = clamp((num(d.combo, 1) | 0) - 1, 0, 4);
      if (!slot || !this._sample(slot, null, 1, HERO.rate * (1 + step * HERO.combo), 'hero')) this.play('swing', { heavy, combo: d.combo, thrust: d.kind === 'thrust' });
    });
    on('player:slam', (d) => this._sample('slam', this._at(d.x, d.z)) || this.play('slam', { x: d.x, z: d.z }));
    on('player:charge', (d) => this.charge?.start(d));
    on('player:hitDragon', (d) => {
      // the plunge's own impact plays on player:plungeHit; a guarded strike's clash plays on
      // dragon:guard (a 'hit' here played over it)
      if (d.kind === 'plunge' || d.guarded) return;
      if (d.kind === 'flurry') {
        // a flash cut has its own sound (player:flurryHit); the last blow lands in the open
        if (!d.heavy) return;
        this._slowOpen();
        if (this._db && getDbSfx() !== '0') return; // (the deathblow's finisher has its own sound)
      }
      const x = d.point?.x, z = d.point?.z, beast = this.game.dragon?.kind !== 'duelist';
      this._hit(d, x, z, beast);
      // the blade's own layer on top: a slice and a ring, per weight, rising a semitone up the chain
      // (not the slam's ground shards: the blade is in the ground, the shards hit)
      if (d.shards) return;
      this._cutN = (this._cutN + 1) | 0;
      this._cut({ weight: d.weight ?? (d.heavy ? 'slam' : 'light'), combo: d.combo, crit: d.crit, alt: this._cutN & 1, x, z });
      // the impact pass: the sub under a heavy blow and the music's dip (thump.js; off: nothing at all)
      this.thump?.onHit(d);
    });
    // the plunge: the dive's rush, then the blade into the skull
    // (recorded: the dive's loudest moment lined up with the blade's landing, DEFENSE.plunge.dive s on)
    on('player:plunge', (d) => {
      const exec = !!d.execution;
      if (!this._sample('plunge-dive', this._at(NaN, NaN, num(DEFENSE.plunge?.dive, 0.14)), exec ? EXEC.dive : 1)) this.play('plungeDive', { exec });
    });
    on('player:plungeHit', (d) => {
      this._slowOpen(); // (a flurry's world-hold may still be muffling: the blow lands in the open)
      const exec = !!d.execution;
      if (!this._sample('plunge-hit', null, exec ? EXEC.hit : 1)) this.play('plungeHit', { exec });
    });
    // the flurry (player/flurry.js): the world is held and muffled for as long as he cuts; every
    // flash cut rings a tone higher, the last blow's coil rises, the hanging cuts open in a run of rings
    on('player:flurry', (d) => {
      this._db = d.art === 'deathblow' ? { at: -1, gap: 0.4 } : null; // (a deathblow's own sounds: deathblowSfx.js)
      if (num(d.strikes, 1) >= 2) this._slowDuck(num(d.dur, 0.6));
    });
    on('player:flurryHit', (d) => {
      // a deathblow under ?dbsfx=a|b|c: the option's blow / finisher instead of the flurry's cut (0: today's)
      if (this._db && getDbSfx() !== '0') {
        const now = this.ctx?.currentTime ?? 0;
        if (this._db.at >= 0 && now > this._db.at) this._db.gap = Math.max(0.2, (now - this._db.at) * 0.9); // the next gap, a little shorter
        this._db.at = now;
        const s = deathblowSound(d, getDbSfx(), this._db.gap);
        if (s) this.play(s.name, s.opts);
        return;
      }
      // (the streak's sound: the ring on the scale, a fast run merged into one sweep; off: null)
      if (!d.last) this._flurryCut(this.streakSound?.flurryCut(d) ?? { n: num(d.n, 1) });
    });
    // a duelist answers a streak of guards with his own flurry: a low gong under its first tell
    on('dragon:flurry', () => this.play('gong'));
    // the Sheathed's sheath (ADR-145): the settle draws a low breath that cuts out to silence and the
    // music ducks under it; the click is a dry tick with a short high ring; the blade going home a soft one
    on('dragon:sheath', (d) => {
      const st = d?.state;
      if (st === 'settle') {
        this.play('sheathBreath', this._atDragon());
        this._stillDuck(true);
      } else if (st === 'draw') {
        this.play('sheathClick', this._atDragon({ loud: 1 }));
        this._stillDuck(false);
      } else if (st === 'click') this.play('sheathClick', this._atDragon({ loud: 0.45 }));
      else this._stillDuck(false);
    });
    // the hero's One Breath (ADR-146): the stance draws a breath, the cut clicks
    on('player:draw', (d) => this.play(d?.phase === 'cut' ? 'sheathClick' : 'sheathBreath', { loud: 0.7 }));
    // (recorded: its top on the strike, `dur` s on, cut off there)
    on('player:flurryArt', (d) => {
      const dur = num(d.dur, 0.2);
      if (!this._sample('flurry-coil', this._at(NaN, NaN, clamp(dur, 0.1, 0.6)))) this.play('flurryCoil', { dur });
    });
    on('player:flurryEnd', (d) => {
      this._slowOpen();
      const db = this._db && getDbSfx() !== '0';
      this._db = null;
      if (!db && num(d.strikes, 1) >= 2) this.play('flurryBurst', this.streakSound?.burst(d) ?? { n: num(d.strikes, 2) - 1 });
    });
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
      // (the streak's sound on: the chain climbs the track's scale; a perfect one's ring per perfectMode())
      // (a blade's parry recorded: _parry; a bullet's, light, keeps the synth)
      const pm = !d.light && d.perfect ? perfectSound() : null;
      const o = { tell: d.tell, chain: d.chain, clash: d.clash | 0, perfect: !!(d.light && d.perfect), melee: !d.light, perfectMelee: !d.light && !!d.perfect, tune: d.light ? null : this.streakSound?.parryTune() ?? null, ring: pm ? pm.ring : 1 };
      if (d.light || !this._parry(o)) this.play('parry', o);
      if (!d.light) this.streakSound?.onDefence('parry');
    });
    // the streak (player:streak { count, lost }): the climb waits for the defence that raised it (same
    // call stack); a loss of 2+ answers; the layer follows the tier (streakSound.js)
    on('player:streak', (d) => this.streakSound?.onStreak(d));
    // the duel's moments (a duelist; the Ash Disciple): steel on steel, heavier as they land
    on('player:lock', (d) => {
      if (d.phase === 'start') this.play('block', { tell: 'blue', damage: 0 });
      else if (d.phase === 'push') this.play('guard', { heavy: false }); // (a shove grinds: no bell per press)
      else if (d.phase === 'won') this._parryAlso({ tell: 'blue', chain: 6 });
      else this.play('block', { tell: 'blue', damage: 10 });
    });
    on('player:mikiri', () => {
      this._parryAlso({ tell: 'blue', chain: 5 });
      this.streakSound?.onDefence('mikiri');
    });
    on('player:counter', (e) => {
      // the flash chain's links (?counter=chain, ADR-246): each link's steel rings higher and louder
      const L = e?.links > 1 ? e.link | 0 : 0;
      if (L > 1 && sfxMode() !== 'old' && this._sample('parry-blue', null, 1 + CHAIN_RING.gain * (L - 1), 1 + CHAIN_RING.rate * (L - 1))) return;
      this._parryAlso({ tell: 'blue', chain: 7, perfect: true });
    });
    // a deep gong under the slow motion (the blade lock's camera push-in has its own clash and no slow-mo)
    on('game:cinematic', (e) => { if (e?.kind !== 'lock' && e?.kind !== 'perfectParry' && e?.kind !== 'flurry') this.play('gong'); });
    on('dragon:deflected', () => this._parryAlso({ tell: 'blue', chain: 8 }));
    on('player:guardBreak', () => {
      this.charge?.stop(0.05);
      this.play('guardBreak');
    });
    // the guard meter ran out on a blocked blow: the same crack (the block's own ring came first)
    on('player:guardOpen', () => {
      this.charge?.stop(0.05);
      this.play('guardBreak');
    });
    on('player:perfectDodge', () => {
      this._ghostep();
      this.streakSound?.onDefence('dodge');
    });
    on('player:ghostep', () => this._ghostep());

    // attack tells (any attacker): the player's reaction cues
    // Only a blue or a red (black) blow has cues: a warning as its windup starts and a timing sound just
    // before it lands, recorded (cue-* / time-*, sampleList.js) or the synth recipe until they load. An
    // ordinary blow has none: its white glint and its own sound through the air (dragon:attack) tell it.
    // Hazards and bullets keep their cues as they were. `?sfx=old`: a tick on every tell and the flash's
    // ping on every blow, as before.
    on('combat:tell', (d) => {
      if (d.bullet) return; // a bullet's cue is its combat:flash ping alone (dozens per pattern)
      this.streakSound?.onTell(); // (the streak's climb dips under every tell)
      const o = this._atEvent(d);
      const old = sfxMode() === 'old';
      if (d.hazard) this.play('hazardTell', o); // a fire hazard's own tell (meteors, pillars): no brass sting
      else if (d.tell === 'blue') {
        if (old || !this._sample('cue-blue', o)) this.play('tellBlue', o);
      } else if (d.tell === 'red' || d.tell === 'black') {
        // (a black, charged, blow opens on the same low sting: its long charge is the rest of it)
        if (old || !this._sample('cue-red', o)) this.play('tellRed', o);
        this._dipMusic();
      } else if (old) this.play('tellTick', o);
    });
    on('combat:flash', (d) => {
      const o = this._atEvent(d);
      if (!d.bullet) this.streakSound?.onTell();
      // (the black flare cracks like the red one; a blue flare is the crystal ping, louder: a moment)
      o.tell = d.tell === 'black' ? 'red' : d.tell === 'blue' || d.tell === 'red' ? d.tell : 'normal';
      if (sfxMode() === 'old' || d.bullet || d.hazard) {
        if (this.play('flash', o) && !d.bullet) this._dipMusic();
      } else if (o.tell !== 'normal') {
        // (the white glint of an ordinary blow is visual alone)
        if (this._sample(o.tell === 'red' ? 'time-red' : 'time-blue', o) || this.play('flash', o)) this._dipMusic();
      }
      if (d.flare && d.tell === 'blue') this._parryAlso({ tell: 'blue', chain: 3 });
    });
    // the counter blow (a parried blue flare blow answered by the hero, ADR-118)
    on('player:flareCounter', () => this._parryAlso({ tell: 'blue', chain: 6, perfect: true }));

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
      // a duelist's blow (duelist/brain.js; a fox's paper self): its weapon through the air
      // (told by its weapon: the wyrm's carries none; `?sfx=old`: a duelist's blade had no sound)
      if (d.weapon) {
        if (sfxMode() !== 'old') this._blow(d);
        return;
      }
      if (!beast()) return;
      const name = String(d.name || '');
      if (RX_OWN_SOUND.test(name)) return;
      // the wyrm: a claw or a tail / body sweep recorded (sampleList.js BEAST), else the synth swipe
      const slot = sfxMode() === 'old' ? undefined : BEAST_SLOT.get(name);
      const o = this._atDragon();
      if (!slot || !this._sample(slot, o)) this.play('dragonSwipe', o);
    });
    // two cuts meet (the trade clash)
    on('combat:clash', (d) => {
      this.charge?.stop(0.05);
      const heavy = !!d?.heavy;
      if (!this._sample('clash', null, heavy ? CLASH_HEAVY : 1)) this.play('trade', { heavy });
      this.streakSound?.onDefence('clash');
    });
    // his guard: a dry clack when he holds the strike (recorded: boss-guard), a harsh falling clang when he
    // beats it away (the synth's own)
    on('dragon:guard', (d) => {
      const heavy = !!d?.heavy;
      if (d?.deflect) this.play('deflected', { heavy });
      else if (!this._sample('boss-guard', null, heavy ? GUARD_HEAVY.gain : 1, heavy ? GUARD_HEAVY.rate : 1)) this.play('guard', { heavy });
    });
    on('dragon:step', (d) => this.play('dragonStep', d));
    on('dragon:wingFlap', (d) => this.play('wingFlap', this._atDragon({ strength: d.strength })));
    on('dragon:takeoff', () => beast() && this.play('takeoff', this._atDragon()));
    on('dragon:land', (d) => this.play('land', d));
    on('dragon:breathStart', () => this.breath?.start());
    on('dragon:breathEnd', () => this.breath?.stop());
    on('dragon:fireball', (d) => this.play('fireball', d));
    on('dragon:explosion', (d) => this.play('explosion', d));
    // the fox's paper selves (ADR-147): a dry, quiet paper tear as one pops, a softer one as one tears
    // free (or burns into him at his change)
    on('dragon:clone', (d) => this.play('paperTear', { x: d?.x, z: d?.z, soft: d?.kind === 'spawn' || d?.by === 'mantle' }));
    // Xin Yi, the One Who Woke (ADR-156): the guns, the Bend, the stop, deja vu, the hall rewriting
    // itself, the fall (the music drops to silence while he lies)
    on('dragon:shot', (d) => this.play('ironShot', this._atDragon({ heavy: !!d.heavy })));
    on('dragon:bend', () => this.play('bendWhoosh', this._atDragon()));
    on('dragon:stop', () => this.play('stopHum', this._atDragon()));
    on('dragon:sent', () => this.play('codeBurst', this._atDragon()));
    on('dragon:reload', () => this.play('gunClatter', this._atDragon()));
    // the rework (ADR-168): a burst's blows patter (a soft dry tick each), the kick-off from a wall thumps,
    // the second hand coming out (gear 2) is a short rising hum
    on('dragon:burst', (d) => this.play('burstPatter', this._atDragon({ i: num(d.i, 0) })));
    on('dragon:wallKick', () => this.play('land', this._atDragon()));
    on('dragon:gear', () => this.play('stillHum', this._atDragon({ dur: 0.5 })));
    on('dragon:unwrite', () => this.play('morphTicks', this._atDragon({ short: true })));
    on('dragon:dejavu', () => this.play('dejaBlip'));
    on('dragon:stillHand', (d) => this.play('stillHum', this._atDragon({ dur: num(d.dur, 1.5) })));
    on('world:scene', (d) => this.play('morphTicks', { x: num(d.x, 0), z: num(d.z, 0) }));
    on('dragon:fall', (d) => this._fallDuck(num(d.lie, 2.2)));
    // the fox's Pearl (ADR-154): a quiet rising whirr as he shapes it (the drive, the Twin Pearls)
    on('dragon:windup', (d) => {
      if (d?.name === 'foxPearl' || d?.name === 'twinPearl') this.play('pearlWhirr', this._atDragon());
    });
    // Halcyon Plaza (ADR-159, ADR-160; the existing synth sounds): a car goes up, his body through the
    // street, the clap's ring of force
    on('world:blast', (d) => this.play('explosion', d));
    on('dragon:crash', (d) => this.play('crash', { x: d?.x, z: d?.z, mat: 'stone', power: 2 }));
    on('dragon:clap', (d) => this.play('explosion', d));
    // (the grab, the pass's crack, the tower burst through, a thrown car cut in two, his statue broken)
    on('dragon:grab', (d) => this.play('land', d));
    on('dragon:dash', () => this.play('takeoff', this._atDragon()));
    on('dragon:tower', (d) => this.play('crash', { x: d?.x, z: d?.z, mat: 'stone', power: 3 }));
    on('dragon:split', (d) => this.play('crash', { x: d?.x, z: d?.z, mat: 'metal', power: 1.5 }));
    on('dragon:statue', () => this.play('crash', { ...this._atDragon(), mat: 'stone', power: 1 }));
    // Bai Wuji (the Veiled Crossing; the fx agent's sounds go here: on('dragon:barrier' ...), on('dragon:domain' ...))
    // his barrier's states, the domain's moments, and his effects' own sounds (untouched/fx.js emits
    // `dragon:spell { name: 'wj...' }` once per effect; recipes in sfx.js)
    on('dragon:barrier', (d) => {
      const s = d?.state === 'stop' ? 'wjStop' : d?.state === 'crack' ? 'wjCrack' : d?.state === 'open' ? 'wjOpen' : d?.state === 'close' ? 'wjClose' : null;
      if (s) this.play(s, this._atDragon({ n: num(d.cracks, 1) }));
    });
    on('dragon:domain', (d) => {
      const s = d?.state === 'caught' ? 'wjCaught' : d?.state === 'break' ? 'wjBreak' : d?.state === 'void' ? 'wjVoid' : d?.state === 'escape' ? 'wjBlink' : null;
      if (s) this.play(s, { x: num(d.x, 0), z: num(d.z, 0) });
    });
    on('dragon:spell', (d) => {
      const n = d?.name;
      // (and the False Saint's: `fs...`, falseSaint/fx.js _say; recipes in sfx.js's fs block)
      if (typeof n !== 'string' || !(n.startsWith('wj') || n.startsWith('fs')) || !SFX[n]) return;
      this.play(n, { x: num(d.x, 0), z: num(d.z, 0), dur: num(d.dur, 0) });
    });
    // the world breaks (ADR-107): a blow on wood / stone / metal, something coming down, fire catching
    on('world:impact', (d) => {
      const o = { x: d.x, z: d.z, mat: d.mat, power: num(d.power, 0.5) };
      if (d.kind === 'chip') this.play('chip', o);
      else if (d.kind === 'wear') this.play('wear', o); // (a stage reached: quiet, not a crash)
      else if (d.kind === 'burn') this.play('sizzle', o);
      else if (d.kind === 'burnout') this.play('emberHiss', o);
      else this.play('crash', o);
    });
    on('world:fire', (d) => this.play('sizzle', { x: d.x, z: d.z }));
    on('dragon:bite', () => this.play('bite', this._atDragon()));
    on('dragon:hurt', (d) => {
      if (!beast()) return;
      const now = this.ctx.currentTime;
      if (now - this._staggerAt < 1.5 || num(d.hp, 1) <= 0) return;
      const max = num(this.game.dragon?.maxHp, 0);
      const frac = max > 0 ? num(d.damage, 0) / max : 0;
      // played in update(): takeHit emits stagger/death right after hurt, which cancel it
      if (frac > 0.035 || arand() < 0.25) this._painPending = true;
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
      this._phaseHint = Math.max(this._phaseHint, 2);
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
      this._phaseHint = Math.max(this._phaseHint, name === 'dragon:phase4' ? 4 : 3);
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
