// AN OUTFIT'S PRESENCE (2026-11-28, ADR-291's fourth pass; the owner, of costume 11: "somehow make him feel mystique
// and powerful as well", and on the three ideas offered: "show me these 3 variations"). Three ways, one at a time,
// for a look that asks for them (HERO_LOOKS[...].presence: today costume 11 only), behind `?presence=`
// (the Lab's `presence` row), none by default until the owner picks:
//   wisps  tiny faint lavender letters drifting off the cloak's torn hem like smoke, carried on the wind, more of
//          them while he moves
//   sway   the cloak heavy and alive: a slow swell of its flare while he stands, its hem pushed by the wind
//          (anim.js reads a streamer's `breeze` and `windPush`, set here)
//   aura   on a heavy attack and on the light chain's finisher, a short dark-violet pulse of tiny letters: a ring
//          that runs out from his feet and a few rising round him
// The letters are the living world's tiny letters (world/life/letterBatch.js, the house font), drifting on the
// world's one wind (STYLE.md "The living world"); never Math.random (a seeded stream). Nothing is built or drawn
// while it is off or the look does not ask for it; no allocation a frame.
import { LetterBatch } from '../../world/life/letterBatch.js';
import { HERO_LOOKS } from './gear/looks.js';

export const PRESENCE_IDS = Object.freeze(['off', 'wisps', 'sway', 'aura']);
/** Its numbers. wisps: letters a second standing / at a run, life (s), rise (m/s), the wind's share, the colour
 *  and its end, alpha. sway: the flare's swell [extra out, rate] and the wind's push on the hem. aura: letters in
 *  the ring and rising, the ring's speed (m/s), life, colours, alpha. */
export const PRESENCE = {
  wisps: { rate: [16, 44], life: [1.2, 2.4], rise: [0.18, 0.42], wind: 0.55, spread: 0.14, color: [0.66, 0.56, 0.95], end: [0.2, 0.15, 0.34], alpha: 0.8 },
  sway: { breeze: [0.14, 0.55], push: 0.16 },
  aura: { ring: 56, rise: 22, speed: [2.2, 3.4], life: [0.42, 0.7], color: [0.62, 0.32, 1.05], end: [0.12, 0.04, 0.26], alpha: 0.8 },
};
const CHARS = ".,'`~:";
const MAX = 520;
const read = () => {
  try {
    const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('presence') : null;
    return PRESENCE_IDS.includes(v) ? v : 'off';
  } catch {
    return 'off';
  }
};
const PICK = { id: read() };
export const presenceMode = () => PICK.id;
/** Lab / tests: pick one (anything unknown: off). Returns the id now set. */
export function setPresence(id) {
  PICK.id = PRESENCE_IDS.includes(id) ? id : 'off';
  return PICK.id;
}

let seed = 0x5e11a7;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const WIND = { x: 0, z: 0 };
const _o = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, col: 1, color: [1, 1, 1], colorEnd: [0, 0, 0], alpha: 1, alphaEnd: 0, drag: 0.6, gravity: 0, flicker: 0 };

export class Presence {
  constructor(player) {
    this.player = player;
    this.game = player.game;
    this.lb = null;
    this._tried = false;
    this.t = 0;
    this.acc = 0; // wisps owed
    this.auraRec = null; // the attack whose pulse has fired
    this.pulses = 0; // (tests)
    this.spawned = 0; // (tests)
    this._swayOn = false;
  }

  /** The mode in force for this hero now: the switch, if his look asks for a presence. */
  mode() {
    const L = HERO_LOOKS[this.player?.look];
    return L?.presence ? PICK.id : 'off';
  }

  update(dt) {
    const P = this.player, g = this.game;
    const m = this.mode();
    this._sway(m === 'sway');
    const fdt = Math.max(Number.isFinite(g?.fxDt) ? g.fxDt : 0, Number.isFinite(dt) ? dt : 0);
    if (m !== 'wisps' && m !== 'aura') {
      if (this.lb && this.lb.np) {
        this.lb.begin();
        this.lb.np = 0;
        this.lb.end();
      }
      return;
    }
    if (!(fdt > 0) || !P) return;
    const lb = this._letters();
    if (!lb) return;
    lb.begin();
    this.t += fdt;
    try {
      if (P.alive && P.state !== 'dead' && P.object3d?.visible !== false) {
        if (m === 'wisps') this._wisps(fdt);
        else this._aura();
      }
    } catch (err) {
      console.error('[presence]', err);
    }
    lb.flow(fdt, this.t);
    lb.end();
  }

  _letters() {
    if (this.lb || this._tried) return this.lb;
    this._tried = true;
    const g = this.game, mr = Math.random;
    try {
      Math.random = rnd;
      this.lb = new LetterBatch(g, MAX, CHARS, { additive: false, spawned: MAX, rand: rnd });
      g?.pipeline?.registerParticles?.(this.lb);
    } catch (err) {
      console.error('[presence] letters', err);
      this.lb = null;
    } finally {
      Math.random = mr;
    }
    return this.lb;
  }

  _wind() {
    const W = this.game?.world?.life?.wind, P = this.player.position;
    WIND.x = 0;
    WIND.z = 0;
    if (W && typeof W.at === 'function') {
      const o = W.at(P.x, P.z, WIND);
      if (o && Number.isFinite(o.x + o.z)) {
        WIND.x = o.x;
        WIND.z = o.z;
      }
    }
    return WIND;
  }

  /** The cloak's hem: a point on a streamer's lower edge, in the world (into _o.x/y/z). */
  _hem(S) {
    const j = S?.segs?.[1], e = j?.matrixWorld?.elements;
    if (!e) return false;
    const w = S.w?.[2] ?? 0.3, L = S.len?.[1] ?? 0.4;
    const x = (rnd() - 0.5) * w, y = -L * (0.85 + 0.2 * rnd());
    _o.x = e[0] * x + e[4] * y + e[12];
    _o.y = e[1] * x + e[5] * y + e[13];
    _o.z = e[2] * x + e[6] * y + e[14];
    return Number.isFinite(_o.x + _o.y + _o.z);
  }

  _wisps(dt) {
    const W = PRESENCE.wisps, P = this.player, lb = this.lb, st = P.rig?.streamers;
    if (!st?.length) return;
    const v = P.vel, sp = v ? Math.hypot(v.x, v.z) : 0, run = Math.min(1, sp / 5);
    this.acc += dt * (W.rate[0] + (W.rate[1] - W.rate[0]) * run);
    const wd = this._wind();
    while (this.acc >= 1) {
      this.acc -= 1;
      if (!this._hem(st[(rnd() * st.length) | 0])) continue;
      _o.vx = wd.x * W.wind + (rnd() - 0.5) * W.spread - (v?.x ?? 0) * 0.15;
      _o.vz = wd.z * W.wind + (rnd() - 0.5) * W.spread - (v?.z ?? 0) * 0.15;
      _o.vy = W.rise[0] + (W.rise[1] - W.rise[0]) * rnd();
      _o.life = W.life[0] + (W.life[1] - W.life[0]) * rnd();
      _o.col = lb.col(CHARS[(rnd() * CHARS.length) | 0]);
      _o.color = W.color;
      _o.colorEnd = W.end;
      _o.alpha = W.alpha * (0.5 + 0.5 * rnd());
      _o.alphaEnd = 0;
      _o.drag = 0.9;
      _o.gravity = 0;
      _o.flicker = 0.25;
      if (!lb.spawn(_o)) break;
      this.spawned++;
    }
  }

  _aura() {
    const P = this.player, a = P.atk, d = a?.def;
    if (!a || !d || a.pending || this.auraRec === a) return;
    const big = (P.state === 'heavy' || d.heavy || (d.kind === 'light' && d.combo === 5)) && a.t >= d.windup;
    if (!big) return;
    this.auraRec = a;
    this.pulses++;
    const A = PRESENCE.aura, lb = this.lb, p = P.position;
    for (let k = 0; k < A.ring + A.rise; k++) {
      const ring = k < A.ring, an = ring ? (k / A.ring) * Math.PI * 2 + rnd() * 0.1 : rnd() * Math.PI * 2;
      const s = A.speed[0] + (A.speed[1] - A.speed[0]) * rnd(), r = ring ? 0.25 : 0.2 + 0.35 * rnd();
      _o.x = p.x + Math.sin(an) * r;
      _o.z = p.z + Math.cos(an) * r;
      _o.y = ring ? 0.06 + 0.05 * rnd() : 0.2 + 1.3 * rnd();
      _o.vx = Math.sin(an) * (ring ? s : 0.3);
      _o.vz = Math.cos(an) * (ring ? s : 0.3);
      _o.vy = ring ? 0.1 : 0.9 + 0.8 * rnd();
      _o.life = A.life[0] + (A.life[1] - A.life[0]) * rnd();
      _o.col = lb.col(CHARS[(rnd() * CHARS.length) | 0]);
      _o.color = A.color;
      _o.colorEnd = A.end;
      _o.alpha = A.alpha;
      _o.alphaEnd = 0;
      _o.drag = ring ? 2.2 : 1.2;
      _o.gravity = 0;
      _o.flicker = 0.1;
      if (!lb.spawn(_o)) break;
      this.spawned++;
    }
  }

  /** The heavy cloak: the streamers' `breeze` (a slow swell of their flare while near still) and `windPush` (the
   *  wind on the hem, anim.js); cleared when off. */
  _sway(on) {
    const st = this.player?.rig?.streamers;
    if (!st) return;
    if (!on) {
      if (this._swayOn) for (const S of st) {
        if (S._presenceBreeze) S.breeze = S._presenceBreeze[0];
        S._presenceBreeze = null;
        S.windPush = null;
      }
      this._swayOn = false;
      return;
    }
    const W = PRESENCE.sway, wd = this._wind();
    for (const S of st) {
      if (!S._presenceBreeze) {
        S._presenceBreeze = [S.breeze ?? null];
        S.breeze = W.breeze;
      }
      S.windPush ??= [0, 0];
      S.windPush[0] = wd.x * W.push;
      S.windPush[1] = wd.z * W.push;
    }
    this._swayOn = true;
  }
}
