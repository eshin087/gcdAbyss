import { Vector3 } from 'three';
import { AscFx } from '../ascendant/fx.js';
import { K_FIRE, K_SMOKE, K_VOID, K_STEEL, GROUND_Y, GROUND_GAIN } from '../duelist/fx.js';
import { FIRE_PALETTES } from '../../../render/firePalettes.js';
import { PARTS } from './shell.js';
import * as ARSENAL_FX from './fxArsenal.js';
import * as FX_DEBUG from './fxDebug.js';

// The False Saint's effects (the FX AGENT's file): Tian Lei's AscFx (the beam's helpers, the crater, the
// kept lights, every draw on its own stream) under his own surface. Everything that glows or strikes as a
// body is heat in the fire field (game.fx.fire); small things that fly are glyph particles of one letter
// cell (sparks, flakes, casings); nothing is a big glyph sprite (STYLE.md "The fire field"). Look jitter
// comes from lr() / hashes, never from Math.random or the stream game code reads. Sounds ride
// `dragon:spell { name: 'fs…', x, z, dur }` (this._say) emitted by the effects, never by the moves.
// Positions are world metres; `d` the boss; `k` 0..1 a strength / progress; `dt` the frame's.
//
// HIS COLOURS: the fire field's VOID slot is his palette on this level (FIRE_PALETTES.saint, swapped in as
// this class is built, as the Skybreak Ring swaps in gold): INCANDESCENT, a dark amber rim, a pale
// amber-white body, a white heart: jet exhaust and white-hot metal; his jets, the lance, the charges and the
// beams' bodies are it. `fire` is what burns and molten steel (scars, trenches, blasts, the pour) and every
// RED cue (the fire kind at a low heat: the marks, the sight line, the locked reticle); `steel` the white-hot
// cores. CYAN IS COSMETIC ONLY (the owner's v04 pack): his sensors and his shell's sparks, drawn as tiny glyph
// particles and a light, never heat, never anything that signals an attack (blue means "parry" here). The
// engine's white contact glint (combat:flash) stays the brightest thing at a contact.
//
// THE SURFACE (C = the caller calls it every frame while the thing lives; 1 = once). Every method draws
// nothing and costs nothing until it is called; none throws; a NaN argument is ignored.
//   THE BODY (the body's points: d.partPoint(name, out), d.eyePoint(out), d.handPoint(side, out))
//   jet(part, k, stutter = 0)           C  a booster lit at `part` ('elbowR' | 'elbowL' | 'back' | 'calfR' |
//                                          'calfL' | 'palmR' | 'palmL'), k 0..1 (the booster punch's tell is
//                                          this); `stutter` 0..1 cuts it in and out (the flurry). Its
//                                          ignition sound plays on its first frame (a gap of 0.2 s = a new one)
//   jetBurst(x, z, dx, dz, k)           1  the kick of a jet launch at (x, z) along (dx, dz): exhaust kicked
//                                          back, dust, grit, a thump
//   afterimage(d, dx, dz, life, ox = 0, oz = 0)  1  a figure left where he was (moved by ox, oz m), drifting
//                                          along (dx, dz), hanging `life` s (0.6; 1.0 - 1.4 for Vespers'
//                                          lines): pale steel with a hot edge. Returns the blobs spent (~150 - 300)
//   dashTrail(ax, az, bx, bz, k)        1  a jet streak's line from a (where he left) to b: a crisp floor line,
//                                          a fainter one at his chest's height, his jets' heat hanging on it, grit
//   sensor(k)                           C  his sensor(s) lit: tiny cyan letters, cosmetic (k 0..1; how many by
//                                          d.dressPhase: 1 from P2, 3 in P4). Through his death (mode 'dying') they go out one by one
//                                          as the body's dress calls sensorOut (look.js SENSOR_OUT: 1.0, 1.65, 2.3 s)
//   sensorOut(i)                        1  sensor i (0..2) goes out: a pop of cyan, a falling blip
//   shellFlake(point, cut, k)           1  a chip of his shell at world point {x,y,z}, `cut` {x, z} the
//                                          blade's travel, k the exposure it took (d.shell.last): 2 - 6 small
//                                          pale chips flying OUTWARD from the part, a cyan spark or two off
//                                          the bare metal (cosmetic; the pack's C4 shed)
//   palmHit(x, y, z, dx, dz, k)         1  a palm's physical contact (the pack's C1): small white sparks on
//                                          along the blow, fading pale chips, a puff of air (k 1.5 the shove)
//   footPlant(x, z, dx, dz, len, k)     1  a foot planted hard, sliding `len` m along (dx, dz) (the pack's C2
//                                          slip / brake): a scuff on the floor, grit and dust, sparks from P3
//   shellStrip(x, y, z, k)              1  a burn of shell off him (molten 0.05: a few flakes there; a
//                                          transition 1: flakes curling off his whole body, burning)
//   coreVent(k)                         C  the chest core's vent (P4's change, Last Rite's whine), k 0..1
//   transition(n, u)                    C  the change into phase n, u 0..1 through its windup (2: the
//                                          forearm's skin peeling, sparks, the eye kindling; 3: his right
//                                          side burning, the petals glinting, the jets lifting; 4: heat
//                                          drawn into the core, the core venting, three sensors flickering)
//   transitionBurst(n, x, z, r)         1  its impact: 2 sparks and dust; 3 a ring of jet heat; 4 a NOVA
//   THE LASERS
//   sightLine(ax, az, bx, bz, k, fromEye = true)  C  the thin RED sight line before a cut: the floor line
//                                          a → b it marks (dashed early, solid, blinking late), a cross at b,
//                                          a thin line from his eye to b (k 0..1 to the fire)
//   laser(ax, ay, az, bx, by, bz, k)    C  the white-hot cutting line (a his eye, b where it meets the floor)
//   scar(ax, az, bx, bz, w, k)          1  a hot scar left on the plates a → b, w m wide (white, orange,
//                                          red, dark over ~6.5 s x k; smoke and embers while it cools)
//   passLine(ax, az, bx, bz, k)         C  the line a jet pass will run on the floor (Vespers, Passing Bell):
//                                          pale white on the grid, low heat either side, a chevron at b;
//                                          dashed while k < 0.5 (still following the hero), solid after
//                                          (the arsenal agent's, wave 2; never cyan or blue)
//   THE CANNONS
//   cannonCharge(part, k)               C  the palm's iris ('palmR' | 'palmL') / the core ('core') charging,
//                                          k 0..1; it dims the level's light (ambience.dim)
//   cannonBeam(ax, ay, az, bx, by, bz, w, k)  C  the held incinerating beam, w m wide (1.2 a palm, 3.2 the core)
//   cannonEnd(ax, az, bx, bz, w)        1  the beam ends: its trench glows and cools (~9 s)
//   THE BOLTS
//   gunFlash(x, y, z, dx, dz)           1  the forearm gun fires (a flash, two brass casings)
//   bolt(b)                             C  a bolt in flight, b { x, y, z, dx, dy, dz, k, back }
//   boltHit(x, y, z, k)                 1  a bolt bites what it hits
//   THE MISSILES
//   missileLaunch(x, y, z, n)           1  the shoulder petals open and n leave (smoke off both shoulders)
//   missile(m)                          C  a missile in flight, m { x, y, z, vx, vy, vz, k }
//   missileMark(x, z, r, k)             C  the RED ring marked where one comes down (k 0..1 to its landing:
//                                          its fill closes in from the rim; a cross late; it blinks last)
//   blast(x, z, r, power)               1  a missile's blast
//   missileCut(x, y, z, dx, dz)         1  a missile cut out of the air by the hero's blade (dx, dz the cut)
//   THE ARTILLERY
//   mortarFlash(x, y, z, n)             1  the tubes on his back fire (n shells): a flash, smoke straight up
//   shellMark(x, z, r, k)               C  a marked shell of the creeping barrage (the red ring + four ticks)
//   shellFall(x, y, z, k)               C  the shell coming down (its whistle starts with it)
//   shellBurst(x, z, r, power)          1  its burst (the great shell: a larger r and power)
//   THE LANCE
//   reticle(x, z, k, locked)            C  the reticle on the hero (pale brackets closing, k 0..1 to the
//                                          lock); `locked`: red, still, blinking, a column over it; the
//                                          moment it locks a burst and the lock tone
//   skyLance(x, z, r, k)                C  the pillar of light (k 0..1 through its life)
//   ringShock(x, z, r, k)               1  a ring shock along the floor (Verdict's ring, Last Rite's blast)
//   THE FOUNDRY
//   pour(x, y, z, k)                    C  molten steel falling from a ladle at (x, y, z) to the floor
//   sparks(x, y, z, dx, dz, n, k)       1  n metal sparks off (x, y, z) along (dx, dz)
//   THE FLIGHTS (fxArsenal.js fly(): projectiles this file flies AND draws, with their ledger handles)
//   fly(o) → record | null              1  a missile / mortar shell / bolt; record.at (d.time it lands),
//                                          .left, .retime(s), .cancel(); o.onLand(rec) is the caller's
//                                          damage; o.expect (default true) gives it a brain.expect handle
//   cancelFlights()                     1  every flight cancelled (stop(), his death)
//   pools()                                what the pools hold { flights, scars, ... } (the tests, the Lab)
//   ALSO (the engine calls them): hitSpark (struck: metal sparks and a clank where his frame is bare,
//   ash where it is skin), update (his servo steps from P3, the death's sensors, the pools)
//   DEBUG
//   drive / step through fxDebug.js (dragon.debug.fx(name, opts))

/** Every drawing method of the surface (saint.mjs FX checks each exists; the moves may call any). */
export const FS_FX_METHODS = Object.freeze([
  'jet', 'jetBurst', 'afterimage', 'dashTrail', 'sensor', 'sensorOut', 'shellFlake', 'shellStrip', 'coreVent', 'transition', 'transitionBurst',
  'sightLine', 'laser', 'scar', 'cannonCharge', 'cannonBeam', 'cannonEnd', 'gunFlash', 'bolt', 'boltHit',
  'missileLaunch', 'missile', 'missileMark', 'blast', 'shellMark', 'shellFall', 'shellBurst', 'reticle', 'skyLance', 'pour', 'sparks',
  'missileCut', 'mortarFlash', 'ringShock', 'palmHit', 'footPlant', 'fly', 'cancelFlights',
  'passLine',
]);

/** Every sound his effects emit (`dragon:spell { name }`; sfx.js has a recipe for each: saint.mjs checks). */
export const FS_SOUNDS = Object.freeze([
  'fsJetLight', 'fsJetBurst', 'fsDash', 'fsSensorOut', 'fsFlake', 'fsStrip', 'fsCoreWhine', 'fsSkin', 'fsArm', 'fsFrame', 'fsMoment',
  'fsSight', 'fsLaser', 'fsCharge', 'fsBeam', 'fsCoreBeam', 'fsBeamEnd', 'fsGun', 'fsBoltHit', 'fsLaunch', 'fsBlast', 'fsMissileCut',
  'fsMortar', 'fsWhistle', 'fsShellBurst', 'fsTrack', 'fsLock', 'fsLance', 'fsRing', 'fsPour', 'fsServo', 'fsHitMetal', 'fsPowerDown',
  'fsPalm', 'fsScuff',
]);

/** The look's numbers (data): the jets, the sensors, the death, the servo. */
export const FS_FX_BODY = Object.freeze({
  jet: { len: [0.4, 1.25], width: [0.09, 0.22], rate: 45, light: 1.5 },
  sensor: { size: 0.13, light: 0.45 },
  death: { out: [1.0, 1.65, 2.3] }, // s into his death sensor i goes out: the body's look.js SENSOR_OUT (it puts them out; this only flickers them first)
  servo: { stride: 1.05, from: 3 }, // m between two servo sounds; the phase they start in
  metal: 0.5, // a part's exposure from which a cut on it rings as metal
});
const B_ = FS_FX_BODY;

const TAU = Math.PI * 2;
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
// glyph colours
const SKIN = [1.0, 0.82, 0.66], SKIN_END = [0.32, 0.25, 0.2];
const CLOTH = [0.32, 0.32, 0.34], CLOTH_END = [0.1, 0.1, 0.11];
const CYAN = [1.3, 2.7, 3.2], CYAN_END = [0.08, 0.35, 0.55], SENSOR = [0.55, 1.35, 1.6], CYAN_DIM = [0.25, 0.6, 0.72];
const WHITE = [3.3, 3.3, 3.1];
const HOT = [3.4, 2.1, 0.8], HOT_END = [0.6, 0.1, 0.02];
const PALE = [1.15, 1.12, 1.05], PALE_END = [0.25, 0.24, 0.22];
const GRIT = [0.32, 0.3, 0.28], GRIT_END = [0.12, 0.11, 0.1], DUSTG = [0.5, 0.47, 0.43];
const PLATE = [0.52, 0.52, 0.55], PLATE_END = [0.16, 0.16, 0.17];
const L_HEAT = ARSENAL_FX.L_HEAT, L_SENSOR = [0.55, 0.88, 1.0], L_WHITE = [1.0, 0.95, 0.88], L_FIRE = [1.0, 0.52, 0.18];
// (AscFx's gold, met in the inherited beam: turned to his warm white)
const isGold = (c) => Array.isArray(c) && c[0] === 1.0 && c[1] === 0.78 && c[2] === 0.36;
const isGoldGlyph = (c) => Array.isArray(c) && ((c[0] === 4.0 && c[1] === 3.0) || (c[0] === 0.8 && c[1] === 0.4 && c[2] === 0.04));
const BURN_AT = ['shoulderR', 'elbowR', 'chest', 'handR'], SHOULDERS = ['shoulderR', 'shoulderL'];
const JET_PARTS = ['elbowR', 'elbowL', 'back', 'calfR', 'calfL', 'palmR', 'palmL'];
const JET_KEY = Object.freeze(Object.fromEntries(JET_PARTS.map((p) => [p, 'fsJet_' + p])));
// the methods drawn on the private drawing stream (LordFx's: the inherited helpers' rnd() inside them)
const FS_DRAW = [...FS_FX_METHODS.filter((n) => n !== 'fly' && n !== 'cancelFlights'), 'hitSpark'];

const _v = new Vector3(), _w = new Vector3(), _s = new Vector3();

export class FsFx extends AscFx {
  constructor(d) {
    super(d);
    // his palette in the void slot (AscFx put gold there: a level is its own page load, nothing swaps back)
    this.game.fx?.fire?.setPalette?.('void', FIRE_PALETTES.saint);
    this.arsenalFx = ARSENAL_FX;
    this._eyeV = new Vector3();
    this._partV = new Vector3();
    this._clock = () => fin(this.d?.time, 0);
    this._arsenalState = ARSENAL_FX.createState?.() ?? null;
    this._drive = null; // fxDebug's timeline (dragon.debug.fx)
    this._jets = Object.fromEntries(JET_PARTS.map((p) => [p, { t: -99, acc: 0 }]));
    this._sens = { out: [false, false, false], n: 0 };
    this._death = { on: false, t: 0, next: 0, n: 0 };
    this._tr = { n: 0, u: 0, t: -99, acc: 0, acc2: 0 };
    this._core = { acc: 0 };
    this._step = { x: NaN, z: NaN, acc: 0 };
    this._pourAcc = 0;
    this._pourSpark = 0;
    for (const n of FS_DRAW) {
      const f = this[n];
      if (typeof f !== 'function') continue;
      this[n] = function (a, b, c, d2, e, f2, g, h, i, j, k, l) {
        this._drawing++;
        try {
          return f.call(this, a, b, c, d2, e, f2, g, h, i, j, k, l);
        } catch (err) {
          console.error(`[saint] fx ${n}`, err);
          return undefined;
        } finally {
          this._drawing--;
        }
      };
    }
  }

  /** One-shot sound of an effect (audio.js maps `dragon:spell` names starting with 'fs'). */
  _say(name, x, z, extra = 0) {
    try {
      this.d?.emit?.('dragon:spell', { name, x: fin(x), z: fin(z), dur: fin(extra) });
    } catch (err) {
      console.error('[saint] fx sound', err);
    }
  }

  /** A light kept while asked for: AscFx's gold (the inherited beam's) is his warm white here. */
  _keep(key, x, y, z, color, intensity, radius, flicker = 0) {
    return super._keep(key, x, y, z, isGold(color) ? L_HEAT : color, intensity, radius, flicker);
  }
  _light(o) {
    if (o && isGold(o.color)) o.color = L_HEAT;
    return super._light(o);
  }
  _spawn(pool, o) {
    if (o && isGoldGlyph(o.color)) {
      o.color = WHITE;
      if (isGoldGlyph(o.colorEnd) || o.colorEnd) o.colorEnd = HOT_END;
    }
    super._spawn(pool, o);
  }

  reset() {
    super.reset();
    this._drive = null;
    ARSENAL_FX.resetState?.(this, this._arsenalState);
    for (const p of JET_PARTS) this._jets[p].t = -99;
    this._sens.out.fill(false);
    this._death.on = false;
    this._tr.n = 0;
    this._step.x = NaN;
  }

  update(dt, d) {
    super.update(dt, d);
    const fdt = Math.max(0, Math.min(0.1, fin(this.game.fxDt, dt)));
    if (this._drive) {
      try {
        if (FX_DEBUG.step?.(d, this._drive, fdt) === false) this._drive = null;
      } catch (err) {
        console.error('[saint] fxDebug step', err);
        this._drive = null;
      }
    }
    this._drawing++;
    try {
      ARSENAL_FX.update?.(this, this._arsenalState, Math.max(0, fin(dt, 0)), d);
      this._deathStep(fdt, d);
      this._servo(d);
    } catch (err) {
      console.error('[saint] fx update', err);
    } finally {
      this._drawing--;
    }
  }

  // ---------------------------------------------------------------- helpers
  /** The world point of a part (a Vector3 of this object's), or null. */
  _part(name, out = this._partV) {
    const d = this.d;
    if (!d?.partPoint) return null;
    const P = d.partPoint(name, out);
    return P && Number.isFinite(P.x + P.y + P.z) ? P : null;
  }
  /** His forward (x, z) from his yaw (a reused record). */
  _fwd() {
    const y = fin(this.d?.yaw, 0), f = (this._fw ??= { x: 0, z: 1 });
    f.x = Math.sin(y);
    f.z = Math.cos(y);
    return f;
  }

  /** Where a jet points (the way its exhaust leaves) for `part`, into _w (unit). */
  _jetDir(part, P) {
    const d = this.d, y = fin(d?.yaw, 0), fx = Math.sin(y), fz = Math.cos(y);
    if (part === 'elbowR' || part === 'elbowL' || part === 'palmR' || part === 'palmL') {
      const side = part.endsWith('L') ? 'L' : 'R';
      const H = d?.handPoint ? d.handPoint(side, _s) : null;
      const E = part.startsWith('palm') ? this._part(side === 'L' ? 'elbowL' : 'elbowR', _v) : null;
      if (H && Number.isFinite(H.x + H.y + H.z)) {
        // an elbow's jet leaves back along the forearm (hand → elbow); a palm's out of the palm (elbow → hand)
        if (part.startsWith('palm') && E) _w.set(H.x - E.x, H.y - E.y, H.z - E.z);
        else _w.set(P.x - H.x, P.y - H.y, P.z - H.z);
        if (_w.lengthSq() > 1e-4) return _w.normalize();
      }
      return _w.set(-fx, 0, -fz);
    }
    if (part === 'back') return _w.set(-fx * 0.55, -0.83, -fz * 0.55).normalize();
    return _w.set(-fx * 0.3, -0.95, -fz * 0.3).normalize();
  }

  // ---------------------------------------------------------------- THE BODY
  jet(part, k, stutter = 0) {
    if (!this.fire || !Number.isFinite(k) || !(k > 0.02)) return;
    const name = JET_KEY[part] ? part : 'elbowR';
    const P = this._part(name);
    if (!P) return;
    const x = P.x, y = P.y, z = P.z, t = this._now(), st = this._jets[name];
    k = clamp01(k);
    // the stutter: the jet cut in and out on an uneven beat (the flurry)
    if (stutter > 0) {
      const b = Math.floor(t * 26), h = Math.sin(b * 12.9898 + name.length * 78.233) * 43758.5453;
      if (h - Math.floor(h) < 0.45 * clamp01(stutter)) k *= 0.25;
    }
    if (t - st.t > 0.2 && k > 0.15) this._say('fsJetLight', x, z, k);
    st.t = t;
    const D = this._jetDir(name, P), dx = D.x, dy = D.y, dz = D.z;
    const Q = B_.jet, L = Q.len[0] + (Q.len[1] - Q.len[0]) * k, W = Q.width[0] + (Q.width[1] - Q.width[0]) * k;
    const life = this._frame();
    if (life > 0) {
      const fl = 0.85 + 0.15 * Math.sin(t * 61 + name.length) * Math.sin(t * 23);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, s = L * u * fl, w = W * (0.7 + 0.6 * u) * (1 - 0.5 * u * u);
        const h = (0.95 - 0.55 * u) * k;
        this._blob(x + dx * s, y + dy * s, z + dz * s, 0, 0, 0, life, w * 2, w * 2, h, h, K_VOID);
      }
      // the hot core at the nozzle
      const hc = 0.8 + 0.5 * k;
      this._blob(x + dx * 0.06, y + dy * 0.06, z + dz * 0.06, 0, 0, 0, life, 0.14, 0.14, hc, hc, K_STEEL);
      if (k > 0.5) this._ink(x, y, z, x + dx * L * 0.45, y + dy * L * 0.45, z + dz * L * 0.45, 0, 0.9 * k, 0, 0.5 * k, 0, K_STEEL);
    }
    // exhaust flowing off it (it hangs behind him as he moves: the wake)
    const fdt = Math.max(0, fin(this.game.fxDt, 0.016));
    st.acc += fdt * Q.rate * k;
    while (st.acc >= 1) {
      st.acc -= 1;
      const sp = this.lrand(4, 8) * (0.5 + 0.5 * k);
      this._blob(x + dx * L * 0.5, y + dy * L * 0.5, z + dz * L * 0.5, dx * sp + this.lrand(-0.5, 0.5), dy * sp + this.lrand(-0.3, 0.5), dz * sp + this.lrand(-0.5, 0.5), this.lrand(0.08, 0.14), W * 1.2, W * 1.8, 0.32 * k, 0, K_VOID, 3);
    }
    this._keep(JET_KEY[name], x, y, z, L_HEAT, Q.light * k, 3 + 2 * k, 0.25);
  }

  jetBurst(x, z, dx = 0, dz = 0, k = 1) {
    if (!Number.isFinite(x + z + dx + dz + k)) return;
    k = Math.max(0.2, Math.min(2, k));
    const l = Math.hypot(dx, dz), ux = l > 1e-3 ? dx / l : 0, uz = l > 1e-3 ? dz / l : 0;
    if (this.fire) {
      // the exhaust kicked back along the floor, opposite the way he goes
      for (let i = 0; i < Math.round(18 * k); i++) {
        const a = Math.atan2(-uz, -ux) + this.lrand(-0.7, 0.7) * (l > 1e-3 ? 1 : 4.5), sp = this.lrand(3, 8) * k;
        this._blob(x, this.lrand(0.3, 0.7), z, Math.cos(a) * sp, this.lrand(0, 1), Math.sin(a) * sp, this.lrand(0.14, 0.26), 0.4, 0.8, this.lrand(0.5, 0.8), 0, K_VOID, 4);
      }
      this._blob(x, 0.45, z, 0, 0, 0, 0.1, 0.4, 0.6, 1.1, 0, K_STEEL);
    }
    this.dust(x, z, 0.8 * k);
    for (let i = 0; i < Math.round(8 * k); i++) {
      const a = Math.atan2(-uz, -ux) + this.lrand(-1, 1), sp = this.lrand(2, 6);
      const o = this._rec(x, 0.15, z, this.lrand(0.3, 0.6), 0.14, 0.05, ",.'`", GRIT, GRIT_END);
      o.vx = Math.cos(a) * sp;
      o.vy = this.lrand(0.5, 2.5);
      o.vz = Math.sin(a) * sp;
      o.drag = 2;
      o.gravity = -8;
      this._spawn(this.alpha, o);
    }
    this._light({ x, y: 0.6, z, color: L_HEAT, intensity: 2 * k, radius: 4, life: 0.15, fade: 0.15 });
    this._say('fsJetBurst', x, z, k);
  }

  afterimage(d, dx = 0, dz = 0, life = 0.6, ox = 0, oz = 0) {
    if (!d || !this.fire) return 0;
    const lf = Math.max(0.15, Math.min(2, fin(life, 0.6)));
    const ddx = fin(dx, 0), ddz = fin(dz, 0), mx = fin(ox, 0), mz = fin(oz, 0);
    let spent = this.ghost(d, this._ghostOpt(ddx * 0.6, ddz * 0.6, lf, 1, mx, mz, 0, 0, 0));
    // a hot edge: every fifth of the figure's points, a small blob of his palette (his jets' heat)
    const n = this._bodyPts(d), P = this._gp;
    for (let i = 0; i < n; i += 5) {
      this._blob(P[i * 3] + mx, P[i * 3 + 1], P[i * 3 + 2] + mz, ddx * 0.15, this.lrand(0, 0.15), ddz * 0.15, lf * this.lrand(0.6, 0.9), 0.16, 0.1, 0.4, 0, K_VOID, 1);
      spent++;
    }
    return spent;
  }

  dashTrail(ax, az, bx, bz, k = 1) {
    if (!this.fire || !Number.isFinite(ax + az + bx + bz + k)) return;
    k = Math.max(0.2, Math.min(1.5, k));
    const L = Math.hypot(bx - ax, bz - az);
    if (!(L > 0.2)) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    // the floor line (crisp, on the grid), a fainter one at his chest's height
    this._ink(ax, 0.45, az, bx, 0.45, bz, 0.45 + 0.35 * k, 0.95 * k, 0, 0.75 * k, 0, K_STEEL);
    this._ink(ax, 1.25, az, bx, 1.25, bz, 0.28 + 0.12 * k, 0.55 * k, 0, 0.35 * k, 0, K_VOID);
    // his jets' heat hanging on it, rising a little; smoke low along it
    const n = Math.min(60, Math.ceil(L / 0.4));
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
      this._blob(x, this.lrand(0.6, 1.5), z, -ux * 0.4, this.lrand(0.1, 0.4), -uz * 0.4, this.lrand(0.45, 0.8) * k, 0.3, 0.5, 0.36 * k, 0, K_VOID, 1);
      if (i % 3 === 0) this._blob(x, 0.8, z, this.lrand(-0.2, 0.2), this.lrand(0.3, 0.7), this.lrand(-0.2, 0.2), this.lrand(0.7, 1.2), 0.4, 1.0, 0.4, 0, K_SMOKE, 0.8);
    }
    // grit thrown at the start, behind him
    for (let i = 0; i < 8; i++) {
      const a = Math.atan2(-uz, -ux) + this.lrand(-0.8, 0.8), sp = this.lrand(2, 5);
      const o = this._rec(ax, 0.15, az, this.lrand(0.3, 0.6), 0.13, 0.05, ",.'", GRIT, GRIT_END);
      o.vx = Math.cos(a) * sp;
      o.vy = this.lrand(0.5, 2);
      o.vz = Math.sin(a) * sp;
      o.drag = 2;
      o.gravity = -8;
      this._spawn(this.alpha, o);
    }
    this._say('fsDash', (ax + bx) / 2, (az + bz) / 2, L);
  }

  /** The point of sensor i (0..2) on his face (into `out`): along the diagonal slot from his right eye. */
  _sensorPt(i, out) {
    const d = this.d, h = d?.rig?.head;
    if (h?.matrixWorld) {
      out.set(-0.033 + 0.042 * i, 0.128 + 0.016 * i, 0.11 - 0.004 * i).applyMatrix4(h.matrixWorld);
      if (Number.isFinite(out.x + out.y + out.z)) return out;
    }
    return d?.eyePoint ? d.eyePoint(out) : null;
  }

  sensor(k = 1) {
    const d = this.d;
    if (!this.fire || !d) return;
    const ph = fin(d.dressPhase, 1), n = ph >= 4 ? 3 : ph >= 2 ? 1 : 0;
    if (!n) return;
    const dying = d.mode === 'dying';
    k = dying ? 1 : clamp01(fin(k, 1));
    if (!(k > 0.02)) return;
    this._sens.n = n;
    this._sensorDraw(n, k, dying);
  }

  /** Draw n sensors at strength k (the ones out skipped; the next to go flickers through the death). */
  _sensorDraw(n, k, dying = false) {
    const life = this._frame();
    if (!(life > 0)) return;
    const Q = B_.sensor, t = this._now(), D = this._death;
    let lit = 0, lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < n; i++) {
      if (dying && this._sens.out[i]) continue;
      const P = this._sensorPt(i, _s);
      if (!P) continue;
      let kk = k;
      if (dying && D.on) {
        const at = B_.death.out[i] ?? 9;
        if (at - D.t < 0.3) kk *= Math.sin(t * 70 + i) > 0 ? 1 : 0.25;
      }
      // (one tiny cyan letter a sensor: a glyph particle held one frame, pulled toward the camera so his
      // head does not hide it; never heat, so it can never read as a cue)
      const C = this._toCamera(P.x, P.y, P.z);
      const o = this._rec(C.x, C.y, C.z, life, Q.size, Q.size, '*', kk > 0.55 ? SENSOR : CYAN_DIM, null);
      o.alphaEnd = 1;
      this._spawn(this.add, o);
      lit++;
      lx += P.x;
      ly += P.y;
      lz += P.z;
    }
    if (lit) this._keep('fsSensor', lx / lit, ly / lit, lz / lit, L_SENSOR, Q.light * k * (0.6 + 0.4 * lit), 1.8, 0);
  }

  sensorOut(i = 0) {
    const n = Math.max(0, Math.min(2, Math.round(fin(i, 0))));
    this._sens.out[n] = true;
    const P = this._sensorPt(n, _s);
    if (!P) return;
    for (let j = 0; j < 6; j++) {
      const o = this._rec(P.x, P.y, P.z, this.lrand(0.25, 0.5), 0.1, 0.03, "'.+", CYAN, CYAN_END);
      o.vx = this.lrand(-1.2, 1.2);
      o.vy = this.lrand(-0.5, 1.5);
      o.vz = this.lrand(-1.2, 1.2);
      o.gravity = -6;
      o.drag = 2;
      this._spawn(this.add, o);
    }
    const C = this._toCamera(P.x, P.y, P.z), f = this._rec(C.x, C.y, C.z, 0.2, 0.16, 0.05, '*', CYAN, CYAN_END);
    this._spawn(this.add, f);
    this._say('fsSensorOut', P.x, P.z, n);
  }

  /** His death: the sensors go out one by one, the core's light fails (P4); then nothing. */
  _deathStep(dt, d) {
    const D = this._death;
    if (!d) return;
    if (d.mode !== 'dying') {
      if (D.on && d.mode !== 'dead') {
        D.on = false;
        this._sens.out.fill(false);
      }
      return;
    }
    if (!D.on) {
      D.on = true;
      D.t = 0;
      D.next = 0;
      D.n = Math.max(this._sens.n, fin(d.dressPhase, 1) >= 4 ? 3 : fin(d.dressPhase, 1) >= 2 ? 1 : 0);
      this._sens.out.fill(false);
      this._say('fsPowerDown', d.position?.x, d.position?.z, D.n);
    }
    D.t += dt;
    // (the sensors themselves are put out by the body's dress, look.js SENSOR_OUT, timed to the knee going
    // down; it calls sensorOut(i) once each. One driver: this only plays the power-down and the core.)
    // the core's light failing (P4): a dim glow that sinks out
    if (fin(d.dressPhase, 1) >= 4) {
      const k = Math.max(0, 1 - D.t / 1.9);
      if (k > 0.02) this._coreGlow(0.55 * k * (0.75 + 0.25 * Math.sin(D.t * 40)), false);
    }
  }

  /** His servo steps from phase 3: a soft whirr every stride he moves on the floor. */
  _servo(d) {
    const S = this._step;
    if (!d?.position || fin(d.dressPhase, 1) < B_.servo.from || d.mode === 'dying' || d.mode === 'dead' || d.mode === 'sleep') {
      S.x = NaN;
      return;
    }
    const x = d.position.x, z = d.position.z;
    if (!Number.isFinite(S.x) || d.position.y > 0.2) {
      S.x = x;
      S.z = z;
      return;
    }
    const m = Math.hypot(x - S.x, z - S.z);
    S.x = x;
    S.z = z;
    if (m > 2) return; // (a teleport, a dash: no steps)
    S.acc += m;
    if (S.acc >= B_.servo.stride) {
      S.acc = 0;
      this._say('fsServo', x, z, fin(d.dressPhase, 3));
    }
  }

  /** (the v04 pack's C4 shed) A cut chipped his shell: a FEW SMALL chips fly OUTWARD from the struck part
   *  (away from his body's axis, a little along the blade), tumble and fade; a cyan spark or two off the
   *  metal left bare (cosmetic). Never a cloud: 2 - 6 chips. */
  shellFlake(point, cut, k = 0.1) {
    if (!point || !Number.isFinite(point.x + point.y + point.z)) return;
    const x = point.x, y = point.y, z = point.z, kk = clamp01(fin(k, 0.1));
    const n = Math.max(2, Math.min(6, Math.round(2 + kk * 25)));
    const cx = fin(cut?.x, 0), cz = fin(cut?.z, 0), cl = Math.hypot(cx, cz);
    const p = this.d?.position, ox = p ? x - p.x : 0, oz = p ? z - p.z : 0, ol = Math.hypot(ox, oz) || 1;
    for (let i = 0; i < n; i++) {
      const out = this.lrand(1.6, 3.2), along = this.lrand(0.3, 1.1), cloth = i % 3 === 2;
      const o = this._rec(x + this.lrand(-0.05, 0.05), y + this.lrand(-0.06, 0.06), z + this.lrand(-0.05, 0.05), this.lrand(0.45, 0.8), this.lrand(0.09, 0.13), 0.06, cloth ? "~-," : "'`,.^", cloth ? CLOTH : SKIN, cloth ? CLOTH_END : SKIN_END);
      o.vx = (ox / ol) * out + (cl > 1e-3 ? (cx / cl) * along : 0) + this.lrand(-0.5, 0.5);
      o.vy = this.lrand(0.6, 2.2);
      o.vz = (oz / ol) * out + (cl > 1e-3 ? (cz / cl) * along : 0) + this.lrand(-0.5, 0.5);
      o.gravity = -9;
      o.drag = 1.2;
      o.spin = this.lrand(-9, 9);
      this._spawn(this.alpha, o);
    }
    // where the frame shows under it: a cyan spark or two (cosmetic; the pack's shell sparks)
    const sh = this.d?.shell;
    if ((sh?.exposure ?? 0) > 0.12) {
      for (let i = 0; i < 2; i++) {
        const o = this._rec(x, y, z, this.lrand(0.15, 0.3), 0.09, 0.03, "'+", CYAN, CYAN_END);
        o.vx = (ox / ol) * 2.5 + this.lrand(-1.2, 1.2);
        o.vy = this.lrand(0, 2);
        o.vz = (oz / ol) * 2.5 + this.lrand(-1.2, 1.2);
        o.drag = 3;
        this._spawn(this.add, o);
      }
    }
    this._say('fsFlake', x, z, kk);
  }

  /** (the v04 pack's C1 palm) A palm's physical contact at (x, y, z) along (dx, dz), `k` its weight (1 a
   *  palm, 1.5 the heel-palm shove): small white contact sparks thrown on along the blow, a few pale glyph
   *  chips that fade where it met, a puff of air. Small on purpose: the engine's white glint (combat:flash)
   *  stays the brightest thing at the contact. ~10 particles, 8 blobs, once. */
  palmHit(x, y, z, dx = 0, dz = 0, k = 1) {
    if (!Number.isFinite(x + y + z + dx + dz + k)) return;
    k = Math.max(0.4, Math.min(2, k));
    const l = Math.hypot(dx, dz), ux = l > 1e-3 ? dx / l : 0, uz = l > 1e-3 ? dz / l : 0;
    for (let i = 0; i < Math.round(10 * k); i++) {
      const sp = this.lrand(2.5, 6) * k;
      const o = this._rec(x, y, z, this.lrand(0.16, 0.34), 0.12, 0.03, "'+.", WHITE, HOT_END);
      o.vx = ux * sp + this.lrand(-1.8, 1.8);
      o.vy = this.lrand(-0.5, 2);
      o.vz = uz * sp + this.lrand(-1.8, 1.8);
      o.drag = 3.5;
      this._spawn(this.add, o);
    }
    for (let i = 0; i < Math.round(4 * k); i++) {
      const o = this._rec(x + this.lrand(-0.12, 0.12), y + this.lrand(-0.1, 0.12), z + this.lrand(-0.12, 0.12), this.lrand(0.4, 0.7), 0.12, 0.08, ".:'", PALE, PALE_END);
      o.vx = ux * this.lrand(0.3, 1) + this.lrand(-0.3, 0.3);
      o.vy = this.lrand(0.1, 0.6);
      o.vz = uz * this.lrand(0.3, 1) + this.lrand(-0.3, 0.3);
      o.drag = 2;
      this._spawn(this.alpha, o);
    }
    if (this.fire) {
      // (a small hot point where the hand met: a quarter of the cue's glint, under it in heat and size)
      this._blob(x, y, z, 0, 0, 0, 0.07, 0.22, 0.3, 0.75, 0, K_STEEL);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        this._blob(x, y + sa * 0.2, z, (ux * 2 - uz * ca * 2.5) * k, sa * 2.5 * k, (uz * 2 + ux * ca * 2.5) * k, 0.12, 0.26, 0.4, 0.3, 0, K_SMOKE, 4);
      }
    }
    this._say('fsPalm', x, z, k);
  }

  /** (the v04 pack's C2 slip / brake) A foot planted hard at (x, z), sliding along (dx, dz) `len` m: a short
   *  scuff line on the floor, grit and dust kicked ahead of the sole, a few sparks off the metal shin from
   *  phase 3. The jet dash's landing, the slip of his counter, a booster move's stop. Once. */
  footPlant(x, z, dx = 0, dz = 0, len = 0.6, k = 1) {
    if (!Number.isFinite(x + z + dx + dz + len + k)) return;
    k = Math.max(0.3, Math.min(2, k));
    const l = Math.hypot(dx, dz), ux = l > 1e-3 ? dx / l : 0, uz = l > 1e-3 ? dz / l : 0, L = Math.max(0.1, Math.min(3, len));
    if (this.fire && l > 1e-3) this._ink(x - ux * L, 0.42, z - uz * L, x, 0.42, z, 0.8, 0.75 * k, 0, 0.9 * k, 0, K_SMOKE);
    for (let i = 0; i < Math.round(14 * k); i++) {
      const sp = this.lrand(1, 3.5) * k;
      const o = this._rec(x, 0.1, z, this.lrand(0.35, 0.7), 0.15, 0.06, ",.'`", DUSTG, GRIT_END);
      o.vx = ux * sp + this.lrand(-1, 1);
      o.vy = this.lrand(0.4, 1.8);
      o.vz = uz * sp + this.lrand(-1, 1);
      o.drag = 2.4;
      o.gravity = -7;
      this._spawn(this.alpha, o);
    }
    this.dust(x, z, 0.9 * k);
    if (fin(this.d?.dressPhase, 1) >= 3) {
      for (let i = 0; i < 4; i++) {
        const o = this._rec(x, 0.15, z, this.lrand(0.15, 0.3), 0.09, 0.03, "'+", HOT, HOT_END);
        o.vx = ux * this.lrand(2, 5) + this.lrand(-1, 1);
        o.vy = this.lrand(0.5, 2);
        o.vz = uz * this.lrand(2, 5) + this.lrand(-1, 1);
        o.drag = 3;
        o.gravity = -9;
        this._spawn(this.add, o);
      }
    }
    this._say('fsScuff', x, z, k);
  }

  shellStrip(x, y, z, k = 0.1) {
    if (!Number.isFinite(x + y + z + k)) return;
    const kk = clamp01(k), d = this.d;
    const n = Math.max(3, Math.min(44, Math.round(4 + 40 * kk)));
    const whole = kk >= 0.5 && d;
    const np = whole ? this._bodyPts(d) : 0, P = this._gp;
    for (let i = 0; i < n; i++) {
      let px = x + this.lrand(-0.25, 0.25), py = y + this.lrand(-0.2, 0.3), pz = z + this.lrand(-0.25, 0.25);
      if (np > 12) {
        const j = Math.floor(this.lr() * np) * 3;
        px = P[j];
        py = P[j + 1];
        pz = P[j + 2];
      }
      const o = this._rec(px, py, pz, this.lrand(0.6, 1.2), this.lrand(0.11, 0.17), 0.05, "'`,.^~", SKIN, HOT_END);
      o.vx = this.lrand(-0.8, 0.8);
      o.vy = this.lrand(0.6, 2.2);
      o.vz = this.lrand(-0.8, 0.8);
      o.drag = 1.4;
      o.gravity = -2;
      o.spin = this.lrand(-6, 6);
      o.flicker = 0.3;
      this._spawn(this.alpha, o);
      // the burning edge: a small lick of fire with every other flake
      if (this.fire && i % 2 === 0) this._blob(px, py, pz, this.lrand(-0.2, 0.2), this.lrand(0.5, 1.4), this.lrand(-0.2, 0.2), this.lrand(0.25, 0.45), 0.22, 0.12, 0.55, 0, K_FIRE, 1, 1);
    }
    this._say('fsStrip', x, z, kk);
  }

  /** The core's glow at its point: a white heart, a disc of his heat; `vent` puffs heat out of it. */
  _coreGlow(k, vent = true) {
    const P = this._part('core');
    if (!P || !this.fire) return;
    const x = P.x, y = P.y, z = P.z;
    const life = this._frame();
    if (life > 0) {
      const C = this._toCamera(x, y, z);
      this._blob(C.x, C.y, C.z, 0, 0, 0, life, 0.1 + 0.16 * k, 0.1 + 0.16 * k, 0.55 + 0.75 * k, 0.55 + 0.75 * k, K_STEEL);
      this._disc(x, y, z, 0.16 + 0.3 * k, 10, 0.16 + 0.12 * k, 0.32 + 0.4 * k, K_VOID);
    }
    if (vent) {
      const f = this._fwd(), dt = Math.max(0, fin(this.game.fxDt, 0.016));
      this._core.acc += dt * 45 * k;
      while (this._core.acc >= 1) {
        this._core.acc -= 1;
        const sp = this.lrand(1.5, 4) * k;
        this._blob(x + f.x * 0.1, y, z + f.z * 0.1, f.x * sp + this.lrand(-0.6, 0.6), this.lrand(0.5, 2), f.z * sp + this.lrand(-0.6, 0.6), this.lrand(0.15, 0.3), 0.26, 0.5, 0.45 * k, 0, K_VOID, 2, 1);
        if (k > 0.6 && this.lr() < 0.25) {
          const o = this._rec(x, y, z, this.lrand(0.2, 0.4), 0.1, 0.03, "'+.", WHITE, HOT_END);
          o.vx = f.x * 4 + this.lrand(-2, 2);
          o.vy = this.lrand(0, 3);
          o.vz = f.z * 4 + this.lrand(-2, 2);
          o.drag = 3;
          this._spawn(this.add, o);
        }
      }
    }
    this._keep('fsCore', x, y, z, L_HEAT, 0.5 + 2 * k, 2.5 + 2 * k, 0.15);
  }

  coreVent(k) {
    if (!Number.isFinite(k) || !(k > 0.02)) return;
    k = clamp01(k);
    this._coreGlow(k, true);
    const P = this._part('core');
    if (P) ARSENAL_FX.heldSay(this, this._arsenalState, 'core', 'fsCoreWhine', P.x, P.z, 99, 1.6);
  }

  transition(n, u) {
    const d = this.d;
    if (!d || !Number.isFinite(u)) return;
    u = clamp01(u);
    const T = this._tr, t = this._now(), fdt = Math.max(0, fin(this.game.fxDt, 0.016));
    const start = n !== T.n || u < T.u - 0.05 || t - T.t > 0.3;
    T.n = n;
    T.u = u;
    T.t = t;
    if (n === 2) {
      if (start) this._say('fsSkin', d.position.x, d.position.z, 0);
      // the forearm's skin peeling: flakes off between the elbow and the hand, sparks where it is bare
      const E = this._part('elbowR', _v), ex = E?.x, ey = E?.y, ez = E?.z, H = d.handPoint?.('R', _s);
      if (E && H && Number.isFinite(H.x + H.y + H.z)) {
        T.acc += fdt * (18 + 40 * u);
        while (T.acc >= 1) {
          T.acc -= 1;
          const q = this.lr(), px = ex + (H.x - ex) * q, py = ey + (H.y - ey) * q, pz = ez + (H.z - ez) * q;
          const o = this._rec(px, py, pz, this.lrand(0.5, 0.9), 0.12, 0.06, "'`,.^", SKIN, SKIN_END);
          o.vx = this.lrand(-1, 1);
          o.vy = this.lrand(0.2, 1.6);
          o.vz = this.lrand(-1, 1);
          o.gravity = -8;
          o.drag = 1.2;
          o.spin = this.lrand(-8, 8);
          this._spawn(this.alpha, o);
          if (u > 0.4 && this.lr() < 0.35) {
            const s = this._rec(px, py, pz, this.lrand(0.15, 0.3), 0.1, 0.03, "'+", WHITE, HOT_END);
            s.vx = this.lrand(-2.5, 2.5);
            s.vy = this.lrand(0, 2.5);
            s.vz = this.lrand(-2.5, 2.5);
            s.drag = 3;
            this._spawn(this.add, s);
          }
        }
      }
      // the eye kindling
      if (u > 0.55) this._sensorDraw(1, (u - 0.55) / 0.45);
    } else if (n === 3) {
      if (start) this._say('fsArm', d.position.x, d.position.z, 0);
      // his right side burning: the jacket going up off the shoulder, the arm, the chest
      if (this.fire) {
        T.acc += fdt * (30 + 70 * u);
        while (T.acc >= 1) {
          T.acc -= 1;
          const P = this._part(BURN_AT[Math.floor(this.lr() * 4)], _v);
          if (!P) break;
          this._blob(P.x + this.lrand(-0.12, 0.12), P.y + this.lrand(-0.15, 0.15), P.z + this.lrand(-0.12, 0.12), this.lrand(-0.3, 0.3), this.lrand(0.8, 2), this.lrand(-0.3, 0.3), this.lrand(0.25, 0.45), 0.28, 0.14, 0.55 + 0.3 * u, 0, K_FIRE, 1, 1.2);
          if (this.lr() < 0.3) {
            const o = this._rec(P.x, P.y, P.z, this.lrand(0.6, 1.1), 0.12, 0.04, ".'`*", HOT, HOT_END);
            o.vx = this.lrand(-0.6, 0.6);
            o.vy = this.lrand(0.8, 2);
            o.vz = this.lrand(-0.6, 0.6);
            o.drag = 0.8;
            o.flicker = 0.5;
            this._spawn(this.add, o);
          }
        }
        // the shoulder petals glinting as they open
        if (u > 0.35) {
          const life = this._frame();
          for (const s of SHOULDERS) {
            const P = this._part(s, _v);
            if (!P || !(life > 0)) continue;
            const C = this._toCamera(P.x, P.y + 0.08, P.z), h = 0.6 + 0.5 * Math.max(0, Math.sin(t * 30 + s.length));
            this._blob(C.x, C.y, C.z, 0, 0, 0, life, 0.12, 0.12, h, h, K_STEEL);
          }
        }
      }
      // the lift: the back and calf jets light
      if (u > 0.55) {
        const k = (u - 0.55) / 0.45;
        this.jet('back', k);
        this.jet('calfR', k * 0.8);
        this.jet('calfL', k * 0.8);
      }
    } else if (n === 4) {
      if (start) this._say('fsFrame', d.position.x, d.position.z, 2);
      // heat drawn into the core from all round him, the core venting harder, the sensors flickering on
      const P = this._part('core', _v);
      if (P && this.fire) {
        T.acc2 += fdt * (40 + 90 * u);
        while (T.acc2 >= 1) {
          T.acc2 -= 1;
          const a = this.lr() * TAU, e = this.lrand(-0.5, 0.8), r = this.lrand(1.2, 2.4), life = this.lrand(0.25, 0.4);
          const ox = Math.cos(a) * Math.cos(e) * r, oy = Math.sin(e) * r, oz = Math.sin(a) * Math.cos(e) * r;
          this._blob(P.x + ox, P.y + oy, P.z + oz, -ox / life, -oy / life, -oz / life, life, 0.16, 0.06, 0.5, 0.85, K_VOID);
        }
      }
      this._coreGlow(0.3 + 0.7 * u, true);
      if (u > 0.7) this._sensorDraw(3, Math.sin(t * 34) > -0.2 ? (u - 0.7) / 0.3 : 0.1);
    }
  }

  transitionBurst(n, x, z, r = 4) {
    if (!Number.isFinite(x + z + r)) return;
    r = Math.max(1, Math.min(10, r));
    const d = this.d, y = 1.2;
    if (n >= 4) {
      // THE NOVA: a ring of his heat thrown out flat, a white flash, a fire front, plates flung
      if (this.fire) {
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * TAU + this.lrand(-0.05, 0.05), sp = (r / 0.4) * this.lrand(0.85, 1.1);
          this._blob(x + Math.cos(a) * 0.5, this.lrand(0.6, 1.6), z + Math.sin(a) * 0.5, Math.cos(a) * sp, this.lrand(-0.2, 0.6), Math.sin(a) * sp, this.lrand(0.36, 0.48), 0.6, 1.3, this.lrand(0.7, 1.0), 0, K_VOID, 2.4);
        }
        this._blob(x, y, z, 0, 0, 0, 0.2, 1.2, 2.4, 1.6, 0, K_STEEL, 3);
      }
      this.shock(x, z, r * 1.1, this._opt(1.4, 0.55, 'fire', 0, true));
      for (let i = 0; i < 18; i++) {
        const a = this.lr() * TAU, sp = this.lrand(4, 10);
        const o = this._rec(x, 0.3, z, this.lrand(0.7, 1.2), this.lrand(0.16, 0.24), 0.08, '=#-', PLATE, PLATE_END);
        o.vx = Math.cos(a) * sp;
        o.vy = this.lrand(4, 9);
        o.vz = Math.sin(a) * sp;
        o.gravity = -14;
        o.spin = this.lrand(-8, 8);
        this._spawn(this.alpha, o);
      }
      this._light({ x, y: 1.5, z, color: L_WHITE, intensity: 9, radius: r * 3, life: 0.5, fade: 0.45 });
    } else if (n === 3) {
      // a ring of jet heat blown out under him as he lifts
      if (this.fire) {
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * TAU, sp = (r / 0.35) * this.lrand(0.8, 1.05);
          this._blob(x + Math.cos(a) * 0.4, 0.5, z + Math.sin(a) * 0.4, Math.cos(a) * sp, this.lrand(0, 0.4), Math.sin(a) * sp, this.lrand(0.3, 0.4), 0.5, 1.0, 0.6, 0, K_VOID, 2.6);
        }
      }
      this.shock(x, z, r, this._opt(1.0, 0.25, 'dust', 0, true));
      this._light({ x, y: 1, z, color: L_HEAT, intensity: 5, radius: r * 2.4, life: 0.4, fade: 0.35 });
    } else {
      // sparks off him and a front of dust
      for (let i = 0; i < 26; i++) {
        const a = this.lr() * TAU, sp = this.lrand(3, 8);
        const o = this._rec(x, y, z, this.lrand(0.25, 0.5), 0.11, 0.03, "*+'", this.lr() < 0.4 ? WHITE : HOT, HOT_END);
        o.vx = Math.cos(a) * sp;
        o.vy = this.lrand(0, 4);
        o.vz = Math.sin(a) * sp;
        o.gravity = -10;
        o.drag = 2;
        this._spawn(this.add, o);
      }
      this.shock(x, z, r * 0.8, this._opt(0.7, 0.1, 'dust', 0, false));
      this._light({ x, y, z, color: L_HEAT, intensity: 3, radius: 6, life: 0.3, fade: 0.3 });
    }
    this._say('fsMoment', x, z, n);
    void d;
  }

  // ---------------------------------------------------------------- struck (the engine's hitSpark)
  /** Struck: where his frame is bare (the part under the cut at least B_.metal exposed) the hero's blade
   *  rings on metal: white sparks, a crisp stroke of steel along the blow, a clank; where it is skin, the
   *  engine's spray of ash (with a spark or two once anything of him is bare). */
  hitSpark(x, y, z, dx, dz, heavy) {
    if (!Number.isFinite(x + y + z + dx + dz)) return;
    const m = this._metalAt(x, y, z);
    if (m < B_.metal) {
      super.hitSpark(x, y, z, dx, dz, heavy);
      if (m < 0.15) return;
    }
    const n = m >= B_.metal ? (heavy ? 16 : 11) : 4;
    for (let i = 0; i < n; i++) {
      const sp = this.lrand(2.5, heavy ? 9 : 6);
      const o = this._rec(x, y, z, this.lrand(0.18, 0.4), this.lrand(0.1, 0.15), 0.03, "*+'", this.lr() < 0.45 ? WHITE : HOT, HOT_END);
      o.vx = dx * sp + this.lrand(-2, 2);
      o.vy = this.lrand(0, 3.5);
      o.vz = dz * sp + this.lrand(-2, 2);
      o.drag = 2.6;
      o.gravity = -9;
      this._spawn(this.add, o);
    }
    if (m >= B_.metal) {
      if (this.fire) {
        const l = heavy ? 0.7 : 0.45;
        for (let i = -2; i <= 2; i++) {
          const u = i / 2;
          this._blob(x + dx * u * l, y + 0.05 * u, z + dz * u * l, dx * 4, 0, dz * 4, 0.12, 0.24, 0.18, 0.62 - 0.15 * Math.abs(u), 0, K_STEEL, 6);
        }
      }
      this._light({ x, y, z, color: L_WHITE, intensity: heavy ? 2.4 : 1.5, radius: 3, life: 0.1, fade: 0.1 });
      this._say('fsHitMetal', x, z, heavy ? 1.4 : 1);
    }
  }

  /** How bare his frame is at a world point (the shell's part nearest it, in his body frame). */
  _metalAt(x, y, z) {
    const d = this.d, sh = d?.shell, p = d?.position;
    if (!sh?.part || !p) return 0;
    const H = fin(sh.T?.height, 2), yaw = fin(d.yaw, 0), dx = x - p.x, dz = z - p.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw), ly = y - fin(p.y, 0);
    let best = Infinity, name = '';
    for (const P of PARTS) {
      const q = Math.hypot(lx - P.at[0], ly - P.at[1] * H, lz - P.at[2]);
      if (q < best) {
        best = q;
        name = P.name;
      }
    }
    return name ? fin(sh.part(name), 0) : 0;
  }

  // ---------------------------------------------------------------- THE ARSENAL (fxArsenal.js)
  sightLine(ax, az, bx, bz, k, fromEye = true) {
    ARSENAL_FX.sightLine(this, this._arsenalState, ax, az, bx, bz, k, fromEye);
  }
  laser(ax, ay, az, bx, by, bz, k) {
    ARSENAL_FX.laser(this, this._arsenalState, ax, ay, az, bx, by, bz, k);
  }
  scar(ax, az, bx, bz, w = 0.6, k = 1) {
    return ARSENAL_FX.scar(this, this._arsenalState, ax, az, bx, bz, w, k);
  }
  passLine(ax, az, bx, bz, k = 1) {
    ARSENAL_FX.passLine(this, this._arsenalState, ax, az, bx, bz, k);
  }
  cannonCharge(part, k) {
    ARSENAL_FX.cannonCharge(this, this._arsenalState, part, k);
  }
  cannonBeam(ax, ay, az, bx, by, bz, w, k) {
    ARSENAL_FX.cannonBeam(this, this._arsenalState, ax, ay, az, bx, by, bz, w, k);
  }
  cannonEnd(ax, az, bx, bz, w = 1.2) {
    return ARSENAL_FX.cannonEnd(this, this._arsenalState, ax, az, bx, bz, w);
  }
  gunFlash(x, y, z, dx, dz) {
    ARSENAL_FX.gunFlash(this, this._arsenalState, x, y, z, dx, dz);
  }
  bolt(b) {
    ARSENAL_FX.bolt(this, this._arsenalState, b);
  }
  boltHit(x, y, z, k = 1) {
    ARSENAL_FX.boltHit(this, this._arsenalState, x, y, z, k);
  }
  missileLaunch(x, y, z, n = 8) {
    ARSENAL_FX.missileLaunch(this, this._arsenalState, x, y, z, n);
  }
  missile(m) {
    ARSENAL_FX.missile(this, this._arsenalState, m);
  }
  missileMark(x, z, r, k) {
    ARSENAL_FX.missileMark(this, this._arsenalState, x, z, r, k);
  }
  blast(x, z, r = 1.6, power = 1) {
    ARSENAL_FX.blast(this, this._arsenalState, x, z, r, power);
  }
  missileCut(x, y, z, dx = 0, dz = 0) {
    ARSENAL_FX.missileCut(this, this._arsenalState, x, y, z, dx, dz);
  }
  mortarFlash(x, y, z, n = 1) {
    ARSENAL_FX.mortarFlash(this, this._arsenalState, x, y, z, n);
  }
  shellMark(x, z, r, k) {
    ARSENAL_FX.shellMark(this, this._arsenalState, x, z, r, k);
  }
  shellFall(x, y, z, k) {
    ARSENAL_FX.shellFall(this, this._arsenalState, x, y, z, k);
  }
  shellBurst(x, z, r = 2, power = 1) {
    ARSENAL_FX.shellBurst(this, this._arsenalState, x, z, r, power);
  }
  reticle(x, z, k, locked = false) {
    ARSENAL_FX.reticle(this, this._arsenalState, x, z, k, locked);
  }
  skyLance(x, z, r, k) {
    ARSENAL_FX.skyLance(this, this._arsenalState, x, z, r, k);
  }
  ringShock(x, z, r, k = 1) {
    ARSENAL_FX.ringShock(this, this._arsenalState, x, z, r, k);
  }
  fly(o) {
    try {
      return ARSENAL_FX.fly(this, this._arsenalState, o);
    } catch (err) {
      console.error('[saint] fx fly', err);
      return null;
    }
  }
  cancelFlights() {
    ARSENAL_FX.cancelAll(this, this._arsenalState);
  }
  pools() {
    return ARSENAL_FX.poolState(this._arsenalState);
  }

  // ---------------------------------------------------------------- THE FOUNDRY
  pour(x, y, z, k = 1) {
    if (!this.fire || !Number.isFinite(x + y + z + k) || !(k > 0.02)) return;
    k = clamp01(k);
    const life = this._frame(), t = this._now(), fdt = Math.max(0, fin(this.game.fxDt, 0.016));
    const top = Math.max(0.6, y);
    if (life > 0) {
      // the stream: a column of molten heat, wobbling, a white thread down its middle near the lip
      const n = Math.min(24, Math.ceil(top / 0.25));
      for (let i = 0; i <= n; i++) {
        const u = i / n, py = top * (1 - u), wob = 0.04 * Math.sin(t * 9 + u * 7);
        this._blob(x + wob, py, z - wob, 0, 0, 0, life, 0.3 * (0.8 + 0.4 * k), 0.3, (0.7 + 0.2 * Math.sin(t * 13 + i)) * k, 0, K_FIRE);
      }
      this._ink(x, top, z, x, top * 0.4, z, 0, 0.75 * k, 0, 0.4 * k, 0, K_STEEL);
      // the splash where it lands
      for (let i = 0; i < 10; i++) {
        const a = i * 2.39996 + t, r = 0.6 * Math.sqrt((i + 0.5) / 10);
        this._blob(x + Math.cos(a) * r, GROUND_Y, z + Math.sin(a) * r, 0, 0, 0, life, 0.4, 0.4, 0.45 * k * GROUND_GAIN, 0, K_FIRE);
      }
    }
    this._pourAcc += fdt * 20 * k;
    while (this._pourAcc >= 1) {
      this._pourAcc -= 1;
      this._blob(x + this.lrand(-0.08, 0.08), top, z + this.lrand(-0.08, 0.08), this.lrand(-0.3, 0.3), -this.lrand(1, 3), this.lrand(-0.3, 0.3), Math.min(0.8, top / 6 + 0.15), 0.3, 0.25, 0.7 * k, 0.5 * k, K_FIRE, 0.2, -9);
    }
    this._pourSpark += fdt * 28 * k;
    while (this._pourSpark >= 1) {
      this._pourSpark -= 1;
      const a = this.lr() * TAU, sp = this.lrand(1.5, 4.5);
      const o = this._rec(x, 0.25, z, this.lrand(0.3, 0.7), 0.11, 0.03, "*+'.", HOT, HOT_END);
      o.vx = Math.cos(a) * sp;
      o.vz = Math.sin(a) * sp;
      o.vy = this.lrand(2, 5);
      o.gravity = -12;
      o.drag = 0.8;
      this._spawn(this.add, o);
    }
    this._keep('fsPour', x, Math.min(2, top), z, L_FIRE, 2.5 * k, 6, 0.3);
    ARSENAL_FX.heldSay(this, this._arsenalState, 'pour', 'fsPour', x, z, 1.4, 1.5);
  }

  sparks(x, y, z, dx = 0, dz = 0, n = 10, k = 1) {
    if (!Number.isFinite(x + y + z + dx + dz + n + k)) return;
    const m = Math.max(1, Math.min(40, Math.round(n))), l = Math.hypot(dx, dz), ux = l > 1e-3 ? dx / l : 0, uz = l > 1e-3 ? dz / l : 0;
    for (let i = 0; i < m; i++) {
      const sp = this.lrand(2, 7) * Math.max(0.3, Math.min(2, k));
      const o = this._rec(x, y, z, this.lrand(0.2, 0.5), this.lrand(0.1, 0.14), 0.03, "*+'", this.lr() < 0.35 ? WHITE : HOT, HOT_END);
      o.vx = ux * sp + this.lrand(-1.8, 1.8);
      o.vy = this.lrand(0.5, 3.5);
      o.vz = uz * sp + this.lrand(-1.8, 1.8);
      o.drag = 2;
      o.gravity = -10;
      this._spawn(this.add, o);
    }
  }
}
