import { TUNING } from './tuning.js';
import { TELL, RESULT } from '../../combat/rules.js';
import { clamp } from '../../core/math.js';

// Fire hazards (contract 3): pooled world-space threats that run on their own, independent of the
// wyrm's current action, so it can fight while meteors fall. Dragon.update calls update(dt) every
// frame (it never throws); everything is cleared on reset, death and every phase change.
//
// Shapes (SHAPE): circle (a meteor, a lava pillar, a barrage shell: one blast at `impact`), strip
// (a fire front runs A -> B, the ground it passed keeps burning `linger` s: contact ticks), ring
// (ignites at r0 and expands to r1), wall (a fire wall sweeping along its normal), line (lava
// pillars along A + dir * k * step, erupting one after another) and two emitters that spawn
// circles over time: rain (meteors round the player) and chase (pillars under the player).
//
// Every hazard draws a red glyph ground warning from spawn until it goes off, then hits through
// dragon.hitPlayer({ ..., tell: TELL.RED, plunge: false }): i-frames dodge it, block / parry fail
// (a hazard spawned with plunge: true, fire breathed or spat from the air, lets a perfect dodge plunge).
// The main hit lands at most once per hazard (a strip's lingering fire ticks: blockable contact
// damage, skipped while the hero rolls). A hazard either announces itself (`announce`, circles:
// 'combat:tell' once the hero is near its ring, 'combat:flash' flashLead s before impact) or is
// covered by the spawning attack's own tell beat (announce: false; the attack re-times its flash
// with timeTo()). Groups cap how many hits a whole rain / barrage / chase may deal.
// No per-frame allocations: pooled hazard records, reused hit / event scratch.

export const SHAPE = Object.freeze({ CIRCLE: 0, STRIP: 1, RING: 2, WALL: 3, LINE: 4, RAIN: 5, CHASE: 6 });
const MAX = 48;
const MAX_GROUPS = 8;
const ANNOUNCE_PAD = 3.0; // m: a self-announcing circle tells once the hero is this close to its ring
const ARENA_R = 27; // m: meteors / pillars land inside this radius (the clearing is 30)
const PILLAR_BURN = 0.75; // s a lava pillar's column keeps erupting (visual; it hits for `active`)
const CRATER = 1.3; // s a meteor crater smoulders (visual)
const FADE = 0.35; // s a ring / wall's flames die out after its travel

const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function blank(i) {
  return {
    slot: i, id: 0, alive: false, shape: 0, kind: '', attack: '',
    t: 0, impact: 0, end: 0, fired: false, hit: false,
    // geometry
    x: 0, z: 0, r: 0, ax: 0, az: 0, dx: 0, dz: 1, len: 0, w: 0,
    r0: 0, r1: 0, speed: 0, dist: 0, n: 0, step: 0, delay: 0, active: 0,
    f: 0, // last front / radius / sweep position (swept hit tests)
    // blow
    damage: 0, burn: 0, knockback: 0, knockdown: false, plunge: false,
    // strip contact fire
    linger: 0, tick: 0, tickT: 0, tickDamage: 0, tickBurn: 0,
    // tells
    announce: false, told: false, flashed: false, group: -1,
    // projectile (meteor / shell): origin + visible fall
    fall: 0, ox: 0, oy: 0, oz: 0, fell: false, shell: false,
    // emitters
    count: 0, done: 0, first: 0, span: 0, warn: 0, warnLed: 0, ledEvery: 0, lo: 0, hi: 0, every: 0, until: 0,
    lead: 0, linkFirst: false,
    // fx scratch (accumulators, held sprites, pillars burst bitmask, lights)
    hold: 0, acc: 0, acc2: 0, acc3: 0, acc4: 0, seed: 0, mask: 0,
    l0: null, l1: null, l2: null,
  };
}

export class Hazards {
  constructor(dragon) {
    this.d = dragon;
    this.game = dragon.game;
    this.list = Array.from({ length: MAX }, (_, i) => blank(i));
    this.groups = Array.from({ length: MAX_GROUPS }, () => ({ hits: 0, max: 1e9 }));
    this._g = 0;
    this._serial = 0;
    this._next = 0;
    this._phase = dragon.phase;
    this.alive = 0;
    // reused hit record (hitPlayer copies what it keeps)
    this._from = { x: 0, z: 0 };
    this._pt = { x: 0, y: 0, z: 0 };
    this._hit = {
      damage: 0, from: this._from, knockback: 0, knockdown: false, kind: '', burn: 0,
      tell: TELL.RED, parryable: false, blockable: false, attack: '', plunge: false, point: this._pt,
    };
  }

  get player() {
    return this.game.player;
  }

  /** Live hazards of `kind` (or of every kind), emitters included. */
  count(kind = null) {
    let n = 0;
    for (const h of this.list) if (h.alive && (!kind || h.kind === kind)) n++;
    return n;
  }

  /** The live hazard spawned as (slot, id), or null (gone or recycled). */
  get(ref) {
    const h = ref && this.list[ref.slot];
    return h && h.alive && h.id === ref.id ? h : null;
  }

  /** A hit cap shared by several hazards (a rain, a barrage, a chase): returns its index. */
  group(max) {
    const i = this._g;
    this._g = (this._g + 1) % MAX_GROUPS;
    const g = this.groups[i];
    g.hits = 0;
    g.max = max > 0 ? max : 1e9;
    return i;
  }

  clear() {
    for (const h of this.list) if (h.alive) this._kill(h);
    for (const g of this.groups) g.hits = 0;
    this.alive = 0;
  }

  // ------------------------------------------------------------------ spawning
  _take(shape, o) {
    let h = null;
    for (let k = 0; k < MAX && !h; k++) {
      const c = this.list[(this._next + k) % MAX];
      if (!c.alive) h = c;
    }
    if (!h) return null; // pool full: the hazard is dropped (never throws)
    this._next = (h.slot + 1) % MAX;
    const slot = h.slot;
    Object.assign(h, blank(slot)); // (spawns are rare: a fresh record keeps every field honest)
    h.id = ++this._serial;
    h.alive = true;
    h.shape = shape;
    h.kind = o.kind ?? 'hazard';
    h.attack = o.attack ?? 'hazard';
    h.damage = num(o.damage, 0);
    h.burn = num(o.burn, 0);
    h.knockback = num(o.knockback, 0);
    h.knockdown = !!o.knockdown;
    // plunge: true = a perfect dodge of this hazard's blow may send the hero onto the wyrm's head (fire
    // the wyrm breathes or spits from the air: the strafe's front, the hover barrage's shells). Spells
    // that fall from the sky or burst from the ground (meteors, pillars, rings, walls) never do.
    h.plunge = o.plunge === true;
    h.announce = o.announce !== false;
    h.group = Number.isInteger(o.group) ? o.group : -1;
    h.impact = Math.max(0.05, num(o.delay, 1));
    h.seed = Math.random() * 100;
    this.alive++;
    return h;
  }

  _ref(h) {
    return h ? { slot: h.slot, id: h.id } : null;
  }

  /**
   * One blast at (x, z) radius r, `delay` s from now. kind 'meteor' (falls from `from` over the last
   * `fall` s), 'pillar' (a lava column), 'shell' (the barrage: the shell is drawn by DragonFx unless
   * `drawShell`). `active` s it keeps hitting after impact (a pillar's column).
   */
  circle(o) {
    const h = this._take(SHAPE.CIRCLE, o);
    if (!h) return null;
    h.x = num(o.x, 0);
    h.z = num(o.z, 0);
    h.r = Math.max(0.3, num(o.r, 3));
    h.active = Math.max(1 / 60, num(o.active, 0.1));
    h.fall = Math.max(0, num(o.fall, 0));
    h.shell = !!o.drawShell;
    const f = o.from;
    h.ox = num(f?.x, h.x);
    h.oy = num(f?.y, 0);
    h.oz = num(f?.z, h.z);
    const linger = h.kind === 'pillar' ? PILLAR_BURN + 0.6 : h.kind === 'meteor' ? CRATER : 0.3;
    h.end = h.impact + h.active + linger;
    return this._ref(h);
  }

  /** Fire front from A to B (unit dir, length) starting `delay` s from now at `speed` m/s, width w. */
  strip(o) {
    const h = this._take(SHAPE.STRIP, o);
    if (!h) return null;
    h.ax = num(o.ax, 0);
    h.az = num(o.az, 0);
    const bx = num(o.bx, h.ax), bz = num(o.bz, h.az + 1);
    const l = Math.hypot(bx - h.ax, bz - h.az) || 1;
    h.dx = (bx - h.ax) / l;
    h.dz = (bz - h.az) / l;
    h.len = l;
    h.w = Math.max(0.5, num(o.w, 4));
    h.speed = Math.max(0.5, num(o.speed, 12));
    h.linger = Math.max(0, num(o.linger, 2.5));
    h.tick = Math.max(0.05, num(o.tick, 0.25));
    h.tickDamage = num(o.tickDamage, 0);
    h.tickBurn = num(o.tickBurn, 0);
    h.end = h.impact + h.len / h.speed + h.linger;
    return this._ref(h);
  }

  /** Ring of fire round (x, z): ignites at r0 `delay` s from now, expands at `speed` to r1, band w. */
  ring(o) {
    const h = this._take(SHAPE.RING, o);
    if (!h) return null;
    h.x = num(o.x, 0);
    h.z = num(o.z, 0);
    h.r0 = Math.max(0, num(o.r0, 2));
    h.r1 = Math.max(h.r0 + 1, num(o.r1, 20));
    h.speed = Math.max(0.5, num(o.speed, 10));
    h.w = Math.max(0.5, num(o.w, 2));
    h.f = h.r0;
    h.end = h.impact + (h.r1 - h.r0) / h.speed + FADE;
    return this._ref(h);
  }

  /** Wall of fire: centre (x, z), sweeping along unit (dx, dz) `dist` m at `speed`, length len, thickness w. */
  wall(o) {
    const h = this._take(SHAPE.WALL, o);
    if (!h) return null;
    h.x = num(o.x, 0);
    h.z = num(o.z, 0);
    const l = Math.hypot(num(o.dx, 0), num(o.dz, 1)) || 1;
    h.dx = num(o.dx, 0) / l;
    h.dz = num(o.dz, 1) / l;
    h.len = Math.max(2, num(o.len, 40));
    h.w = Math.max(0.5, num(o.w, 2.4));
    h.speed = Math.max(0.5, num(o.speed, 10));
    h.dist = Math.max(1, num(o.dist, 30));
    h.end = h.impact + h.dist / h.speed + FADE;
    return this._ref(h);
  }

  /** Lava pillars at A + dir * k * step (k < n), pillar k erupting `delay + k * stagger` s from now. */
  line(o) {
    const h = this._take(SHAPE.LINE, o);
    if (!h) return null;
    h.ax = num(o.ax, 0);
    h.az = num(o.az, 0);
    const l = Math.hypot(num(o.dx, 0), num(o.dz, 1)) || 1;
    h.dx = num(o.dx, 0) / l;
    h.dz = num(o.dz, 1) / l;
    h.n = clamp(Math.round(num(o.n, 5)), 1, 30);
    h.step = Math.max(0.5, num(o.step, 3));
    h.r = Math.max(0.3, num(o.r, 2.4));
    h.delay = Math.max(0, num(o.stagger, 0.1));
    h.active = Math.max(1 / 60, num(o.active, 0.3));
    h.end = h.impact + (h.n - 1) * h.delay + PILLAR_BURN + 0.6;
    return this._ref(h);
  }

  /**
   * Meteor rain (emitter): `count` meteors whose impacts spread over `span` s from `first` s on; every
   * `ledEvery`-th one lands on the hero's led position (rings `warnLed` s), the rest `lo`-`hi` m round
   * him (rings `warn` s). Meteors share `group` (hit cap) and announce themselves.
   */
  rain(o) {
    const h = this._take(SHAPE.RAIN, { ...o, delay: 0.05, announce: false });
    if (!h) return null;
    h.kind = 'rain';
    h.count = clamp(Math.round(num(o.count, 10)), 1, 30);
    h.first = Math.max(0.2, num(o.first, 1.3));
    h.span = Math.max(0, num(o.span, 5));
    h.warn = Math.max(0.6, num(o.warn, 1.5));
    h.warnLed = Math.max(0.6, num(o.warnLed, 1.1));
    h.ledEvery = Math.max(1, Math.round(num(o.ledEvery, 3)));
    h.lo = Math.max(0, num(o.lo, 4));
    h.hi = Math.max(h.lo, num(o.hi, 14));
    h.r = Math.max(0.5, num(o.r, 3.4));
    h.fall = Math.max(0.2, num(o.fall, 0.75));
    h.group = Number.isInteger(o.group) ? o.group : -1;
    h.end = h.first + h.span + 0.2; // (all spawned by then; the meteors live on their own)
    return this._ref(h);
  }

  /** Pillar chase (emitter): every `every` s for `until` s a pillar rings under the led hero, erupting `warn` s later. */
  chase(o) {
    const h = this._take(SHAPE.CHASE, { ...o, delay: 0.05, announce: false });
    if (!h) return null;
    h.kind = 'chase';
    h.every = Math.max(0.15, num(o.every, 0.42));
    h.until = Math.max(0, num(o.until, 3));
    h.warn = Math.max(0.6, num(o.warn, 0.7));
    h.lead = Math.max(0, num(o.lead, 0.3));
    h.r = Math.max(0.3, num(o.r, 2.4));
    h.active = Math.max(1 / 60, num(o.active, 0.3));
    h.group = Number.isInteger(o.group) ? o.group : -1;
    h.linkFirst = !!o.linkFirst; // the first pillar is covered by the attack's own beat
    h.acc = 0; // s until the next pillar
    h.end = h.until + 0.05;
    return this._ref(h);
  }

  /** Stop a strip's fire front where it is (the wyrm was knocked out of its pass); the burnt part lingers. */
  cutStrip(ref) {
    const h = this.get(ref);
    if (!h || h.shape !== SHAPE.STRIP) return;
    const f = clamp((h.t - h.impact) * h.speed, 0, h.len);
    h.len = Math.max(0.01, f);
    h.end = Math.min(h.end, h.t + h.linger);
  }

  // ------------------------------------------------------------------ timing (attack beats re-time on this)
  /**
   * Seconds from now until hazard `ref` reaches the point (px, pz) moving at (vx, vz) (the hero), or
   * until it ends if it never would. Used by the spawning attack to re-time its own timing flash.
   */
  timeTo(ref, px, pz, vx = 0, vz = 0, pr = 0.45) {
    const h = this.get(ref);
    if (!h) return 0;
    const t0 = h.impact - h.t; // to ignition (may be < 0)
    const left = Math.max(0, h.end - h.t);
    switch (h.shape) {
      case SHAPE.STRIP: {
        const s = (px - h.ax) * h.dx + (pz - h.az) * h.dz;
        const vs = vx * h.dx + vz * h.dz;
        const run = h.len / h.speed;
        if (s <= pr) return Math.max(0, t0);
        if (s >= h.len + pr) return Math.max(0, t0 + run);
        const tau = (s - pr - (h.t - h.impact) * h.speed) / Math.max(0.5, h.speed - vs);
        return clamp(tau, Math.max(0, t0), Math.max(0, t0 + run));
      }
      case SHAPE.RING: {
        const ex = px - h.x, ez = pz - h.z, dist = Math.hypot(ex, ez) || 1e-3;
        const vr = (vx * ex + vz * ez) / dist;
        const edge = h.w / 2 + pr;
        const tau = dist - h.r0 - edge <= 0 ? t0 : (dist - h.r0 - edge + t0 * h.speed) / Math.max(0.5, h.speed - vr);
        return clamp(tau, Math.max(0, t0), Math.max(0, t0 + (h.r1 - h.r0) / h.speed));
      }
      case SHAPE.WALL: {
        const s = (px - h.x) * h.dx + (pz - h.z) * h.dz;
        const vs = vx * h.dx + vz * h.dz;
        const edge = h.w / 2 + pr;
        const tau = s - edge <= 0 ? t0 : (s - edge + t0 * h.speed) / Math.max(0.5, h.speed - vs);
        return clamp(tau, Math.max(0, t0), Math.max(0, t0 + h.dist / h.speed));
      }
      case SHAPE.LINE: {
        const s = (px - h.ax) * h.dx + (pz - h.az) * h.dz;
        const k = clamp(Math.round(s / h.step), 0, h.n - 1);
        return Math.max(0, t0 + k * h.delay);
      }
      case SHAPE.CIRCLE:
        return Math.max(0, t0);
      default:
        return left;
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (!(dt > 0)) return;
    try {
      this._update(dt);
    } catch (err) {
      // never freeze the frame: a broken hazard is dropped, the rest keep going next frame
      console.error('[dragon] hazards update failed', err);
      this.clear();
    }
  }

  _update(dt) {
    const d = this.d;
    // phase transitions, death and resets clear the field
    if (d.phase !== this._phase) {
      this._phase = d.phase;
      this.clear();
    }
    if (d.state === 'dying' || d.state === 'dead' || d.state === 'sleeping') {
      if (this.alive) this.clear();
      return;
    }
    if (!this.alive) return;
    const p = this.player?.position;
    const px = p && Number.isFinite(p.x) ? p.x : 1e6, pz = p && Number.isFinite(p.z) ? p.z : 1e6;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const h = this.list[i];
      if (!h.alive) continue;
      h.t += dt;
      switch (h.shape) {
        case SHAPE.CIRCLE:
          this._circle(h, dt, px, pz);
          break;
        case SHAPE.STRIP:
          this._strip(h, dt, px, pz);
          break;
        case SHAPE.RING:
          this._ring(h, dt, px, pz);
          break;
        case SHAPE.WALL:
          this._wall(h, dt, px, pz);
          break;
        case SHAPE.LINE:
          this._line(h, dt, px, pz);
          break;
        case SHAPE.RAIN:
          this._rain(h, px, pz);
          break;
        case SHAPE.CHASE:
          this._chase(h, dt, px, pz);
          break;
      }
      if (h.alive && h.t >= h.end) this._kill(h);
      if (h.alive) n++;
    }
    this.alive = n;
  }

  _kill(h) {
    h.alive = false;
    h.l0?.kill?.();
    h.l1?.kill?.();
    h.l2?.kill?.();
    h.l0 = h.l1 = h.l2 = null;
  }

  // ------------------------------------------------------------------ hits
  _pr() {
    return this.player?.radius ?? 0.45;
  }

  _capped(h) {
    return h.group >= 0 && this.groups[h.group].hits >= this.groups[h.group].max;
  }

  /** The hazard's one blow (red, unblockable, i-frames dodge it, never a plunge). */
  _blow(h, fx, fz, y = 0.8) {
    h.hit = true;
    if (this._capped(h)) return RESULT.IGNORED;
    const o = this._hit;
    o.damage = h.damage;
    o.knockback = h.knockback;
    o.knockdown = h.knockdown;
    o.kind = h.kind;
    o.burn = h.burn;
    o.tell = TELL.RED;
    o.parryable = false;
    o.blockable = false;
    o.attack = h.attack;
    o.plunge = h.plunge === true;
    this._from.x = fx;
    this._from.z = fz;
    const p = this.player.position;
    this._pt.x = p.x;
    this._pt.y = y;
    this._pt.z = p.z;
    const r = this.d.hitPlayer(o, null);
    if (r === RESULT.HIT && h.group >= 0) this.groups[h.group].hits++;
    return r;
  }

  /** Lingering fire: blockable contact damage (like the breath's stream), skipped while the hero rolls. */
  _tick(h, fx, fz) {
    const p = this.player;
    if (!p || p.alive === false || p.state === 'roll' || p.isInvulnerable?.()) return;
    const o = this._hit;
    o.damage = h.tickDamage;
    o.knockback = 0;
    o.knockdown = false;
    o.kind = 'fire';
    o.burn = h.tickBurn;
    o.tell = TELL.NORMAL;
    o.parryable = false;
    o.blockable = true;
    o.attack = h.attack;
    o.plunge = false;
    this._from.x = fx;
    this._from.z = fz;
    this._pt.x = p.position.x;
    this._pt.y = 0.5;
    this._pt.z = p.position.z;
    this.d.hitPlayer(o, null);
  }

  // ------------------------------------------------------------------ tells (self-announcing circles)
  _announce(h, x, z, near) {
    const lead = TUNING.flashLead;
    const left = h.impact - h.t;
    if (!h.told && left > 0 && near) {
      h.told = true;
      this.d.emit('combat:tell', { source: 'dragon', attack: h.attack, tell: TELL.RED, impactIn: Math.max(0.05, left), x, z, hazard: true });
    }
    if (h.told && !h.flashed && left <= lead + 1e-6) {
      h.flashed = true;
      this.d.emit('combat:flash', { source: 'dragon', attack: h.attack, tell: TELL.RED, x, y: 0.6, z, hazard: true });
      this.d.fx.hazardFlash(x, z, h.r);
    }
  }

  // ------------------------------------------------------------------ shapes
  _circle(h, dt, px, pz) {
    const fx = this.d.fx;
    const left = h.impact - h.t;
    const pr = this._pr();
    const dist = Math.hypot(px - h.x, pz - h.z);
    if (h.announce) this._announce(h, h.x, h.z, dist <= h.r + pr + ANNOUNCE_PAD);
    const life = fx.holdLife(h, dt);
    if (left > 0) {
      // the red ground warning until impact (an inner ring closes in as it nears), the projectile
      const k = clamp(1 - left / Math.max(0.3, h.impact), 0, 1);
      fx.hzRing(life, h.x, h.z, h.r, k, h.flashed, h.kind === 'pillar' ? 1 : 0);
      if (h.kind === 'pillar') fx.pillarRumble(h, dt, h.x, h.z, h.r, k);
      if (h.fall > 0 && left <= h.fall) {
        if (!h.fell) {
          h.fell = true;
          if (h.kind === 'meteor') this.d.emit('dragon:hazard', { kind: 'meteor', stage: 'fall', x: h.x, z: h.z, radius: h.r });
        }
        const u = 1 - left / h.fall;
        const e = u * (0.75 + 0.25 * u); // a little acceleration
        if (h.kind === 'meteor' || h.shell) fx.meteor(life, h, dt, h.ox + (h.x - h.ox) * e, h.oy * (1 - e), h.oz + (h.z - h.oz) * e, h.x - h.ox, -h.oy, h.z - h.oz, h.kind === 'meteor');
      }
      return;
    }
    if (!h.fired) {
      h.fired = true;
      if (h.announce && !h.flashed && h.told) this._announce(h, h.x, h.z, true); // (late tell: flash now)
      if (h.kind === 'meteor') fx.meteorImpact(h, h.x, h.z, h.r);
      else if (h.kind === 'pillar') fx.pillarBurst(h, h.x, h.z, h.r);
      else if (h.shell) fx.shellImpact(h.x, h.z, h.r);
      if (h.kind === 'meteor' || h.kind === 'pillar') this.d.emit('dragon:hazard', { kind: h.kind, stage: 'hit', x: h.x, z: h.z, radius: h.r });
    }
    const since = h.t - h.impact;
    if (!h.hit && since <= h.active + 1e-6 && dist <= h.r + pr) this._blow(h, h.x, h.z);
    if (h.kind === 'meteor') fx.crater(h, dt, h.x, h.z, h.r, clamp(1 - since / CRATER, 0, 1));
    else if (h.kind === 'pillar') fx.pillarBurn(h, dt, h.x, h.z, h.r, clamp(1 - since / PILLAR_BURN, 0, 1));
  }

  _strip(h, dt, px, pz) {
    const fx = this.d.fx;
    const pr = this._pr();
    const run = h.t - h.impact;
    const f = clamp(run * h.speed, 0, h.len);
    const b0 = clamp((run - h.linger) * h.speed, 0, h.len); // start of the part still burning
    const life = fx.holdLife(h, dt);
    // red warning ahead of the front; flames behind it
    if (f < h.len) fx.stripWarn(life, h, dt, f, clamp(1 - Math.max(0, -run) / Math.max(0.3, h.impact), 0, 1));
    if (run > 0) fx.stripFire(h, dt, b0, f, run < h.len / h.speed);
    const ex = px - h.ax, ez = pz - h.az;
    const s = ex * h.dx + ez * h.dz;
    const l = Math.abs(ex * h.dz - ez * h.dx);
    const inW = l <= h.w / 2 + pr;
    const ox = h.ax + h.dx * clamp(s, 0, h.len), oz = h.az + h.dz * clamp(s, 0, h.len);
    // the front passing over the hero (swept from last frame's front)
    if (!h.hit && run > 0 && f > h.f && inW && s >= h.f - pr && s <= f + pr) {
      this._blow(h, ox - h.dz * 0.01, oz + h.dx * 0.01);
      h.tickT = h.tick;
    }
    h.f = f;
    // lingering fire: contact ticks while standing in the burnt part
    if (run > 0 && h.tickDamage > 0) {
      h.tickT -= dt;
      if (h.tickT <= 0) {
        h.tickT = h.tick;
        if (inW && s >= b0 - pr && s <= f + pr && b0 < f) this._tick(h, ox, oz);
      }
    }
    if (run > 0 && !h.l0) {
      h.l0 = fx.hazardLight(h.ax, h.az, [1, 0.45, 0.12], 3.2, 10);
      h.l1 = fx.hazardLight(h.ax, h.az, [1, 0.4, 0.1], 2.6, 9);
    }
    if (h.l0) {
      const a = b0 + (f - b0) * 0.75, c = b0 + (f - b0) * 0.25;
      h.l0.set(h.ax + h.dx * a, 1.2, h.az + h.dz * a);
      h.l1?.set(h.ax + h.dx * c, 1.2, h.az + h.dz * c);
      if (b0 >= f - 1e-3 && run > 0.1) {
        h.l0.kill();
        h.l1?.kill();
      }
    }
  }

  _ring(h, dt, px, pz) {
    const fx = this.d.fx;
    const pr = this._pr();
    const run = h.t - h.impact;
    const life = fx.holdLife(h, dt);
    if (run < 0) {
      fx.ringWarn(life, h, clamp(1 - -run / Math.max(0.3, h.impact), 0, 1));
      return;
    }
    const r = Math.min(h.r1, h.r0 + run * h.speed);
    const fading = h.r0 + run * h.speed >= h.r1;
    fx.ringFire(life, h, dt, r, fading ? clamp(1 - (h.t - (h.impact + (h.r1 - h.r0) / h.speed)) / FADE, 0, 1) : 1);
    if (!h.l0) {
      h.l0 = fx.hazardLight(h.x, h.z, [1, 0.45, 0.12], 4, 12);
      h.l1 = fx.hazardLight(h.x, h.z, [1, 0.42, 0.1], 4, 12);
      h.l2 = fx.hazardLight(h.x, h.z, [1, 0.42, 0.1], 4, 12);
    }
    // three lights ride the band (the side toward the hero first)
    const a0 = Math.atan2(pz - h.z, px - h.x);
    for (let k = 0; k < 3; k++) {
      const l = h[k === 0 ? 'l0' : k === 1 ? 'l1' : 'l2'];
      const a = a0 + (k - 1) * 1.1;
      l?.set(h.x + Math.cos(a) * r, 1.0, h.z + Math.sin(a) * r);
    }
    if (!h.hit && !fading) {
      const dist = Math.hypot(px - h.x, pz - h.z);
      const edge = h.w / 2 + pr;
      if (dist >= h.f - edge && dist <= r + edge) {
        const k = dist > 1e-3 ? 1 / dist : 0;
        this._blow(h, px - (px - h.x) * k * 0.5, pz - (pz - h.z) * k * 0.5);
      }
    }
    h.f = r;
  }

  _wall(h, dt, px, pz) {
    const fx = this.d.fx;
    const pr = this._pr();
    const run = h.t - h.impact;
    const life = fx.holdLife(h, dt);
    if (run < 0) {
      fx.wallWarn(life, h, clamp(1 - -run / Math.max(0.3, h.impact), 0, 1));
      return;
    }
    const s = Math.min(h.dist, run * h.speed);
    const fading = run * h.speed >= h.dist;
    const cx = h.x + h.dx * s, cz = h.z + h.dz * s;
    fx.wallFire(life, h, dt, cx, cz, fading ? clamp(1 - (run - h.dist / h.speed) / FADE, 0, 1) : 1);
    if (!h.l0) {
      h.l0 = fx.hazardLight(cx, cz, [1, 0.45, 0.12], 4.5, 13);
      h.l1 = fx.hazardLight(cx, cz, [1, 0.42, 0.1], 3.5, 11);
      h.l2 = fx.hazardLight(cx, cz, [1, 0.42, 0.1], 3.5, 11);
    }
    const qx = -h.dz, qz = h.dx; // along the wall
    const pl = (px - h.x) * qx + (pz - h.z) * qz;
    const lc = clamp(pl, -h.len / 2, h.len / 2);
    h.l0?.set(cx + qx * lc, 1.4, cz + qz * lc);
    h.l1?.set(cx + qx * (lc - 9), 1.4, cz + qz * (lc - 9));
    h.l2?.set(cx + qx * (lc + 9), 1.4, cz + qz * (lc + 9));
    if (!h.hit && !fading && Math.abs(pl) <= h.len / 2 + pr) {
      const sp = (px - h.x) * h.dx + (pz - h.z) * h.dz;
      const edge = h.w / 2 + pr;
      if (sp >= h.f - edge && sp <= s + edge) this._blow(h, px - h.dx, pz - h.dz);
    }
    h.f = s;
  }

  _line(h, dt, px, pz) {
    const fx = this.d.fx;
    const pr = this._pr();
    const life = fx.holdLife(h, dt);
    let burst = false;
    for (let k = 0; k < h.n; k++) {
      const x = h.ax + h.dx * k * h.step, z = h.az + h.dz * k * h.step;
      const ik = h.impact + k * h.delay;
      const left = ik - h.t;
      if (left > 0) {
        const kk = clamp(1 - left / Math.max(0.3, ik), 0, 1);
        fx.hzRing(life, x, z, h.r, kk, left <= TUNING.flashLead, 1);
        fx.pillarRumble(h, dt, x, z, h.r, kk);
        continue;
      }
      const bit = 1 << k;
      if (!(h.mask & bit)) {
        h.mask |= bit;
        fx.pillarBurst(h, x, z, h.r);
        burst = true;
      }
      const since = -left;
      if (!h.hit && since <= h.active + 1e-6 && Math.hypot(px - x, pz - z) <= h.r + pr) this._blow(h, x, z);
      if (since < PILLAR_BURN) fx.pillarBurn(h, dt, x, z, h.r, clamp(1 - since / PILLAR_BURN, 0, 1));
    }
    // (one sound cue per frame for the pillars bursting together)
    if (burst) this.d.emit('dragon:hazard', { kind: 'pillar', stage: 'hit', x: h.ax, z: h.az, radius: h.r });
  }

  _rain(h, px, pz) {
    const d = this.d;
    const n = h.count;
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if (h.mask & bit) continue;
      const led = i % h.ledEvery === 0;
      const jit = (hash(h.seed, i) - 0.5) * 0.3;
      const impact = h.first + (n > 1 ? (h.span * i) / (n - 1) : 0) + jit;
      const warn = led ? h.warnLed : h.warn;
      if (h.t < impact - warn) continue;
      h.mask |= bit;
      // where: the led hero, or a random spot round him (inside the clearing)
      let x, z;
      const s = d.sense, lead = led ? 0.5 : 0;
      const bx = (Number.isFinite(px) && px < 1e5 ? px : d.position.x) + (s?.vel?.x ?? 0) * lead;
      const bz = (Number.isFinite(pz) && pz < 1e5 ? pz : d.position.z) + (s?.vel?.z ?? 0) * lead;
      if (led) {
        x = bx;
        z = bz;
      } else {
        const a = hash(h.seed + 3.1, i) * Math.PI * 2;
        const rr = h.lo + (h.hi - h.lo) * Math.sqrt(hash(h.seed + 7.7, i));
        x = bx + Math.cos(a) * rr;
        z = bz + Math.sin(a) * rr;
      }
      const rl = Math.hypot(x, z);
      if (rl > ARENA_R) {
        x *= ARENA_R / rl;
        z *= ARENA_R / rl;
      }
      // it streaks in from the sky, up-screen (north) and to one side, so it reads at the game camera
      const side = hash(h.seed + 11.3, i) < 0.5 ? -1 : 1;
      const left = Math.max(0.6, impact - h.t);
      this.circle({
        kind: 'meteor', attack: h.attack, x, z, r: h.r, delay: left, damage: h.damage, burn: h.burn, knockback: h.knockback,
        group: h.group, active: 0.12, fall: Math.min(h.fall, left - 0.05),
        from: { x: x + side * (5 + 3 * hash(h.seed + 5.5, i)), y: 30, z: z - 11 - 3 * hash(h.seed + 9.2, i) },
      });
    }
  }

  _chase(h, dt, px, pz) {
    if (h.t > h.until) return;
    h.acc -= dt;
    if (h.acc > 0) return;
    h.acc += h.every;
    const d = this.d, s = d.sense;
    if (!(px < 1e5)) return;
    let x = px + (s?.vel?.x ?? 0) * h.lead, z = pz + (s?.vel?.z ?? 0) * h.lead;
    const rl = Math.hypot(x, z);
    if (rl > ARENA_R) {
      x *= ARENA_R / rl;
      z *= ARENA_R / rl;
    }
    const first = h.done === 0;
    h.done++;
    this.circle({
      kind: 'pillar', attack: h.attack, x, z, r: h.r, delay: h.warn, damage: h.damage, burn: h.burn, knockback: h.knockback,
      group: h.group, active: h.active, announce: !(first && h.linkFirst),
    });
  }
}

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
