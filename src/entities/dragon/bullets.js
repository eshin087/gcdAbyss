// Bullets (docs/COMBAT.md "Bullets", ADR-039): the wyrm's bullet-hell projectiles and the fire
// wheel. One pooled field owned by the dragon (d.bullets), stepped after the hazards every frame.
//
//   EMBER (orange, normal tell)  small, straight; parry / block / roll / cut with a swing
//   WISP  (blue)                 hangs, then homes in; parry / block / roll / cut
//   ORB   (red)                  big, straight; dodge only (a perfect dodge counts, no plunge)
//
// The fairness rule (the cue): every bullet that is going to hit announces itself TUNING.flashLead s
// before impact with a glint and a paired combat:tell + combat:flash ({ hazard: true, bullet: true }).
// Impacts within K.cueGap s of an announced one ride on that cue: one parry answers them all (the
// deflect opens a short shield that pops the small bullets touching the hero, and bursts the ones
// around him). A bullet that could only be announced too late (K.cueMin) is a dud when it was
// spawned point-blank (it fizzles on touch); a HIT opens K.grace s in which every touching bullet
// fizzles, and each pattern caps its hits (group().max): a storm never melts the hero.
// A cue stands for ONE predicted impact, not for the bullet's whole life: a homing wisp that
// outlives it (it missed him and is coming round) is announced again, or is a dud when that could
// only be done too late. A pattern's headline flash follows its lead bullet even after the action
// has ended (holdFlash).
//
// A deflected bullet flies back to the wyrm's head and adds posture; it never interrupts the wyrm
// (dragon.onParried is for its own blows). A PERFECT parry (player.deflect.perfect: pressed within
// DEFENSE.perfectParryWindow, ADR-051) returns it instead: a bigger, faster shot that lands on the
// head for the kind's returnDamage (dragon.takeHit: phase gates and death as for a sword hit) and
// returnPosture, flinches the head and emits dragon:returned; it never interrupts either. The field
// is cleared on phase changes, death, reset, and fizzles when the wyrm's posture breaks.
//
// No per-frame allocations (pooled records, reused hit record; event payloads only when a cue
// fires); never throws out of update(): a failure logs once and clears the field.
// Must NOT import attacks.js (attacks.js -> bulletAttacks.js -> bullets.js).

import { TUNING } from './tuning.js';
import { TELL, RESULT } from '../../combat/rules.js';
import { clamp, smoothstep, angleDiff, distPointSegment } from '../../core/math.js';
import * as BFX from './bulletFx.js';

export const BULLET = Object.freeze({ EMBER: 0, WISP: 1, ORB: 2 });
export const CUE = Object.freeze({ NEW: 0, COVERED: 1, LATE: 2 });

const KEYS = ['ember', 'wisp', 'orb'];
const MAX = 360;
const MAX_GROUPS = 8;
const HIT_Y = 2.3; // a bullet above this flies over the hero
const TAU = Math.PI * 2;
const NEVER = -1e9;

function record(slot) {
  return {
    slot, alive: false, kind: 0, attack: '', tell: TELL.NORMAL,
    x: 0, y: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0,
    y0: 0, yT: 0, yH: 1, drop: 0.4,
    cruise: 0, turn: 0, homeAt: 0, homing: false,
    wait: 0, launch: 0, launched: true, born: 0,
    r: 0.3, t: 0, life: 4, arm: 0, group: -1,
    cued: false, lead: false, dud: false, deflected: false, returned: false, defT: 0,
    cueAt: Infinity, // bullet time (b.t) of the impact its cue announced; Infinity: none announced
    hold: 0, acc: 0, seed: 0,
  };
}

export class Bullets {
  constructor(dragon) {
    this.d = dragon;
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push(record(i));
    this.groups = [];
    // hits / max: the pattern's hit cap; ret / retMax: the HP its perfect-parry returns may deal
    for (let i = 0; i < MAX_GROUPS; i++) this.groups.push({ hits: 0, max: 99, ret: 0, retMax: Infinity });
    this.time = 0;
    this.live = 0;
    this._cursor = 0;
    this._gi = 0;
    this._phase = null;
    this._grace = 0;
    this._shield = 0;
    this._wasBroken = false;
    this._lead = null;
    this._held = { on: false, a: null, beat: null, b: null, kind: 0 }; // holdFlash()
    this._cueSmall = new Float64Array(8).fill(NEVER);
    this._cueOrb = new Float64Array(8).fill(NEVER);
    this._ci = 0;
    this._failed = false;
    this._hit = {
      damage: 0, burn: 0, knockback: 0, kind: 'fire', tell: TELL.NORMAL, parryable: true, blockable: true,
      plunge: false, perfect: false, bullet: true, attack: '', from: { x: 0, z: 0 }, point: { x: 0, y: 0, z: 0 },
    };
    // a returned shot's blow on the wyrm (dragon.takeHit copies what it keeps)
    this._ret = { damage: 0, part: 'head', point: { x: 0, y: 0, z: 0 }, dir: { x: 0, z: 1 }, heavy: false, exact: true, posture: 0 };
    this.wheel = {
      on: false, lit: false, attack: 'fireWheel', x: 0, z: 0, n: 4, ang: 0, dir: 1, u: 0, t: 0, fade: 1,
      warn: 0, warn0: 1, dur: 4, speed: 1, r0: 3, r1: 26, width: 1, damage: 0, burn: 0, knockback: 0,
      hits: 0, max: 2, cd: 0, cueT: NEVER, acc: 0, acc4: 0, heatT: 0, scorchT: 0, lightT: 0, hold: 0,
      tt: Infinity, // s until the next spoke reaches the hero (Infinity: none coming)
      headline: false, // the first crossing is announced by the attack's headline beat
      // spoke i lies at ang + offs[i]. follow: the spokes are tongues of a breath (the Scouring
      // breath, ADR-050): the attack sets origin, ang and the turn rate every frame (aimWheel);
      // otherwise the wheel turns itself (speed, one reversal) with spokes evenly round
      offs: new Float64Array(8), follow: false, om: 0, px: 0, pz: 0, // px / pz: the pivot it turns about
    };
    this._ttA = 0; // the spoke angle / radius of the last _wheelTti() touch (the cue's glint)
    this._ttR = 0;
  }

  get K() {
    return TUNING.bullets;
  }

  // ---------------------------------------------------------------- spawning
  /** One flying bullet; returns its record (valid until it dies) or null (bad input / pool full). */
  spawn(kind, attack, x, y, z, yaw, speed, group = -1, life = 0) {
    const K = this.K, spec = K?.[KEYS[kind]];
    if (!spec || !Number.isFinite(x + y + z + yaw + speed)) return null;
    let b = null;
    for (let i = 0; i < MAX; i++) {
      const c = this.pool[(this._cursor + i) % MAX];
      if (!c.alive) {
        b = c;
        this._cursor = (c.slot + 1) % MAX;
        break;
      }
    }
    if (!b) return null;
    if (this._held.on && this._held.b === b) this._fireHeld(Infinity); // its record is being reused
    b.alive = true;
    b.kind = kind;
    b.attack = attack;
    b.tell = spec.tell;
    b.x = b.px = x;
    b.y = b.y0 = y;
    b.z = b.pz = z;
    b.vx = Math.sin(yaw) * speed;
    b.vz = Math.cos(yaw) * speed;
    b.yT = 0;
    b.yH = K.height;
    b.drop = clamp((y - K.height) / 8, 0.3, 0.8);
    b.cruise = spec.cruise ?? speed;
    b.turn = 0;
    b.homeAt = 0;
    b.homing = false;
    b.wait = 0;
    b.launch = speed;
    b.launched = true;
    b.born = 0;
    b.r = spec.r;
    b.t = 0;
    b.life = life > 0 ? life : spec.life ?? 4;
    b.arm = K.arm;
    b.group = group;
    b.cued = b.lead = b.dud = b.deflected = b.returned = false;
    b.cueAt = Infinity;
    b.defT = 0;
    b.hold = 0;
    b.acc = Math.random();
    b.seed = Math.random() * TAU;
    this.live++;
    return b;
  }

  /**
   * n embers burst out of a point (a slam's fire on the ground: they rise out of a puff of flame),
   * hang in the air and fly at the hero one after another.
   */
  burst(attack, x, y, z, n, wait, stagger, speed, group = -1) {
    BFX.muzzle(this.d.fx, x, y, z, 0, 0, 12, false);
    for (let i = 0; i < n; i++) {
      const b = this.spawn(BULLET.EMBER, attack, x, y, z, Math.random() * TAU, 2.2 + Math.random() * 1.2, group, 0);
      if (!b) return;
      b.launched = false;
      b.wait = wait + i * stagger;
      b.launch = speed;
      b.yH = 1.5;
      b.life = b.wait + 3;
      b.arm = 1e9;
    }
  }

  /** A hit budget for one pattern: its bullets stop hurting after `max` hits. Returns the group id. */
  /** A hit budget for one pattern; `retMax`: the HP its returned shots may deal (TUNING.bullets.returnBudget). */
  group(max, retMax = this.K?.returnBudget ?? Infinity) {
    const i = this._gi++ % MAX_GROUPS;
    const g = this.groups[i];
    g.hits = 0;
    g.max = max > 0 ? max : 99;
    g.ret = 0;
    g.retMax = retMax >= 0 ? retMax : Infinity;
    return i;
  }

  count(kind) {
    let n = 0;
    for (let i = 0; i < MAX; i++) if (this.pool[i].alive && this.pool[i].kind === kind) n++;
    return n;
  }

  /** The bullet the pattern's headline tell stands for (announced by the brain, not by the cue). */
  setLead(b) {
    if (!b) return;
    b.lead = true;
    b.cued = true;
    this._lead = b;
  }
  leadAlive() {
    const b = this._lead;
    return !!b && b.alive && b.lead && !b.deflected;
  }
  leadPos(out) {
    const b = this._lead;
    if (!b || !b.alive || !b.lead) return false;
    out.set(b.x, b.y, b.z);
    return true;
  }
  leadTti() {
    return this.leadAlive() ? this.tti(this._lead) : Infinity;
  }

  /** The headline flash went out `tti` s before the lead bullet's impact: register that impact. */
  headlined(kind, tti) {
    this.cover(kind, tti);
    if (this.leadAlive() && Number.isFinite(tti)) this._lead.cueAt = this._lead.t + tti;
  }

  /**
   * A pattern ended before its headline flash (beat record `beat` of the ended action `a`). While
   * its lead bullet is still on its way to the hero the field keeps the flash and fires it
   * flashLead s before THAT impact; at once if the lead dies first (tell / flash stay paired);
   * dropped when the field is cleared or fizzles. Returns false when there is nothing to wait for:
   * the caller flashes now, and a lead still in the air is handed to its own cue.
   */
  holdFlash(a, beat, kind) {
    if (!a || !beat || !this.leadAlive()) return false;
    const b = this._lead;
    if (!Number.isFinite(this.tti(b))) {
      b.cued = false;
      return false;
    }
    const h = this._held;
    if (h.on) this._fireHeld(Infinity); // one at a time: the older one goes out now
    h.on = true;
    h.a = a;
    h.beat = beat;
    h.b = b;
    h.kind = kind;
    return true;
  }

  _heldFlash() {
    const h = this._held;
    if (!h.on) return;
    const b = h.b;
    if (!b.alive || !b.lead || b.deflected) {
      this._fireHeld(Infinity);
      return;
    }
    const tt = this.tti(b);
    if (tt <= TUNING.flashLead) this._fireHeld(tt);
  }

  _fireHeld(tt) {
    const h = this._held, K = this.K;
    const b = h.b, a = h.a, beat = h.beat, kind = h.kind;
    this._dropHeld();
    beat.flashed = true;
    const keep = this._lead;
    this._lead = b; // the flash is drawn at ITS bullet (dragon.partPos 'bullet')
    try {
      this.d.flashTell(a, beat);
    } finally {
      this._lead = keep;
    }
    if (!b.alive || !b.lead || b.deflected) return;
    if (!Number.isFinite(tt)) b.cued = false; // flashed early: its own cue announces the impact
    else if (tt < K.cueMin && (b.kind === BULLET.WISP || b.t - b.born < K.young)) b.dud = true;
    else {
      this.cover(kind, tt);
      b.cueAt = b.t + tt;
    }
  }

  _dropHeld() {
    const h = this._held;
    h.on = false;
    h.a = h.beat = h.b = null;
  }

  /** Silent: every bullet and the wheel gone (phase change, death, reset). */
  clear() {
    for (let i = 0; i < MAX; i++) this.pool[i].alive = false;
    this.live = 0;
    this.wheel.on = false;
    this._grace = this._shield = 0;
    this._lead = null;
    this._dropHeld();
    this._cueSmall.fill(NEVER);
    this._cueOrb.fill(NEVER);
  }

  // ---------------------------------------------------------------- the cue
  /** Seconds until this bullet touches the hero on its present course (Infinity: it will not). */
  tti(b) {
    if (!b.alive || b.deflected || b.dud) return Infinity;
    const d = this.d, p = d.game.player?.position;
    if (!p) return Infinity;
    const R = b.r + (d.game.player.radius ?? 0.45);
    const dx = p.x - b.x, dz = p.z - b.z;
    const dist = Math.hypot(dx, dz);
    if (!Number.isFinite(dist)) return Infinity;
    if (!b.launched) return Math.max(0, b.wait - b.t) + Math.max(0, dist - R) / Math.max(1, b.launch);
    let t;
    if (b.kind === BULLET.WISP && b.turn > 0) {
      if (b.t < b.homeAt) return b.homeAt - b.t + Math.max(0, dist - R) / Math.max(1, b.cruise);
      const sp = Math.hypot(b.vx, b.vz);
      if (dist <= R) t = 0;
      else if (sp > 0.1 && (b.vx * dx + b.vz * dz) / (sp * dist) > 0.86) {
        const v = d.sense?.vel;
        const away = v ? (v.x * dx + v.z * dz) / dist : 0;
        const closing = sp - (Number.isFinite(away) ? away : 0);
        if (closing <= 0.5) return Infinity;
        t = (dist - R) / closing;
      } else t = this._ray(b, dx, dz, R);
    } else t = this._ray(b, dx, dz, R);
    if (!Number.isFinite(t)) return Infinity;
    t = Math.max(t, b.arm - b.t);
    if (b.t + t > b.life) return Infinity;
    const yk = smoothstep(0, 1, clamp((b.t + t - b.yT) / b.drop, 0, 1));
    if (b.y0 + (b.yH - b.y0) * yk > HIT_Y) return Infinity;
    return t;
  }

  _ray(b, dx, dz, R) {
    const v = this.d.sense?.vel;
    const hvx = Number.isFinite(v?.x) ? v.x : 0, hvz = Number.isFinite(v?.z) ? v.z : 0;
    const rx = b.vx - hvx, rz = b.vz - hvz;
    const c = dx * dx + dz * dz - R * R;
    if (c <= 0) return 0;
    const a = rx * rx + rz * rz;
    const bq = -(dx * rx + dz * rz); // q . rv, q = bullet - hero
    if (a < 1e-6 || bq >= 0) return Infinity;
    const disc = bq * bq - a * c;
    if (disc < 0) return Infinity;
    return (-bq - Math.sqrt(disc)) / a;
  }

  /**
   * Announce an impact `tti` s from now. NEW: glint + combat:tell + combat:flash went out;
   * COVERED: an announced impact of the same class is close enough to answer it too;
   * LATE: too late to react to (the caller decides: dud or hit).
   */
  cue(kind, attack, tell, tti, x, y, z) {
    if (!Number.isFinite(tti)) return CUE.LATE;
    const K = this.K, orb = kind === BULLET.ORB;
    const tr = orb ? this._cueOrb : this._cueSmall;
    const at = this.time + tti;
    const pre = orb ? 0.05 : 0.08;
    for (let i = 0; i < 8; i++) if (at >= tr[i] - pre && at <= tr[i] + K.cueGap) return CUE.COVERED;
    if (tti < K.cueMin + (orb ? 0.03 : 0)) return CUE.LATE;
    tr[this._ci++ & 7] = at;
    const d = this.d;
    d.emit('combat:tell', { source: 'dragon', attack, tell, impactIn: tti, x, z, hazard: true, bullet: true });
    d.emit('combat:flash', { source: 'dragon', attack, tell, x, y, z, hazard: true, bullet: true });
    BFX.cueGlint(d.fx, x, y, z, tell);
    return CUE.NEW;
  }

  /** Register an impact that something else announces (a pattern's headline tell). */
  cover(kind, tti) {
    if (!Number.isFinite(tti)) return;
    const tr = kind === BULLET.ORB ? this._cueOrb : this._cueSmall;
    const at = this.time + tti;
    for (let i = 0; i < 8; i++) if (Math.abs(tr[i] - at) < 0.06) return;
    tr[this._ci++ & 7] = at;
  }

  // ---------------------------------------------------------------- the wheel
  /**
   * o: { attack, x, z, n, ang, dir, warn, dur, speed, r0, r1, width, damage, burn, knockback, max,
   * offs? } — `offs` (n angles off `ang`, n <= 8): the spokes are a breath's tongues and follow the
   * attack's aimWheel(); without it n spokes evenly round turn by themselves.
   */
  startWheel(o) {
    const w = this.wheel;
    if (!Number.isFinite(o.x + o.z + o.ang + o.warn + o.dur)) return;
    w.on = true;
    w.lit = false;
    w.attack = o.attack ?? 'fireWheel';
    w.x = o.x;
    w.z = o.z;
    w.follow = Array.isArray(o.offs) && o.offs.length > 0;
    w.n = w.follow ? Math.min(8, o.offs.length) : clamp(o.n | 0, 2, 8);
    for (let i = 0; i < w.n; i++) w.offs[i] = w.follow ? Number(o.offs[i]) || 0 : (i * TAU) / w.n;
    w.om = 0;
    w.ang = o.ang;
    w.dir = o.dir < 0 ? -1 : 1;
    w.u = 0;
    w.t = 0;
    w.fade = 1;
    w.warn = w.warn0 = Math.max(0.05, o.warn);
    w.dur = o.dur;
    w.speed = o.speed;
    w.r0 = o.r0;
    w.r1 = o.r1;
    w.width = o.width;
    w.damage = o.damage;
    w.burn = o.burn ?? 0;
    w.knockback = o.knockback ?? 0;
    w.hits = 0;
    w.max = o.max ?? 2;
    w.cd = 0;
    w.cueT = NEVER;
    w.acc = 0;
    w.scorchT = 0;
    w.lightT = 0;
    w.hold = 0;
    w.tt = Infinity;
    w.headline = !!o.headline;
  }
  stopWheel() {
    this.wheel.on = false;
  }

  /**
   * A following wheel (offs): its root (x, z), the aim its tongues hang off, that aim's turn rate
   * (rad/s) and the pivot (px, pz) the root swings round with it (the wyrm's body: the mouth orbits).
   */
  aimWheel(x, z, ang, om = 0, px = x, pz = z) {
    const w = this.wheel;
    if (!w.on || !w.follow || !Number.isFinite(x + z + ang)) return;
    w.x = x;
    w.z = z;
    w.ang = ang;
    w.om = Number.isFinite(om) ? om : 0;
    w.px = Number.isFinite(px) ? px : x;
    w.pz = Number.isFinite(pz) ? pz : z;
  }

  /**
   * Seconds until a spoke first touches the hero (Infinity: not within 2.5 s): the wheel stepped
   * forward with its spokes turning at `om` and its root swinging round the pivot with them, the hero
   * on his sensed velocity. A breath's root orbits with the mouth, so the bearing of a close hero
   * from it changes faster than any fixed-origin estimate (that cue came 0.07 s before the touch).
   */
  _wheelTti(w, om, hx, hz, hr) {
    const v = this.d.sense?.vel;
    const vx = Number.isFinite(v?.x) ? v.x : 0, vz = Number.isFinite(v?.z) ? v.z : 0;
    const px = w.follow ? w.px : w.x, pz = w.follow ? w.pz : w.z;
    const ox0 = w.x - px, oz0 = w.z - pz;
    let tau = 0;
    for (let s = 0; s < 80; s++) {
      tau += s < 36 ? 1 / 60 : 1 / 20;
      if (tau > 2.5) break;
      const da = om * tau, c = Math.cos(da), sn = Math.sin(da);
      const ox = px + ox0 * c + oz0 * sn, oz = pz - ox0 * sn + oz0 * c;
      const dx = hx + vx * tau - ox, dz = hz + vz * tau - oz;
      const r = Math.hypot(dx, dz);
      if (r < w.r0 - hr || r > w.r1 || r < 0.5) continue;
      const th = Math.atan2(dx, dz), half = Math.asin(Math.min(1, (w.width / 2 + hr / 2) / r));
      for (let i = 0; i < w.n; i++) {
        const a = w.ang + da + w.offs[i];
        if (Math.abs(angleDiff(a, th)) <= half) {
          this._ttA = a;
          this._ttR = r;
          return tau;
        }
      }
    }
    return Infinity;
  }

  _wheel(dt, p, hr) {
    const w = this.wheel, d = this.d, fx = d.fx;
    w.tt = Infinity;
    if (!w.on) return;
    w.t += dt;
    const hx = p ? p.x : NaN, hz = p ? p.z : NaN;
    if (w.warn > 0) {
      w.warn -= dt;
      BFX.wheelWarn(fx, w, dt, 1 - clamp(w.warn / w.warn0, 0, 1));
      if (w.warn <= 0) {
        w.lit = true;
        w.hold = 0;
        BFX.wheelIgnite(fx, w);
        d.game.shake?.(0.45);
      }
      return;
    }
    w.u += dt;
    if (w.u >= w.dur) {
      w.on = false;
      return;
    }
    w.fade = 1 - smoothstep(w.dur - 0.4, w.dur, w.u);
    let om;
    if (w.follow) om = w.om; // (the attack turns the tongues: aimWheel)
    else {
      const rev = 0.55 * w.dur;
      om = w.dir * w.speed * smoothstep(0, 0.5, w.u) * (1 - 2 * smoothstep(rev - 0.6, rev + 0.6, w.u)) * w.fade;
      w.ang += om * dt;
    }
    BFX.wheelLive(fx, w, dt, om, hx, hz);
    w.cd -= dt;
    if (!p || !Number.isFinite(hx + hz)) return;
    const dx = hx - w.x, dz = hz - w.z;
    const r = Math.hypot(dx, dz);
    if (r < w.r0 - hr || r > w.r1 || r < 0.5) return;
    const th = Math.atan2(dx, dz);
    // the spoke nearest the hero: dl = signed angle from it to him
    let dl = Infinity;
    for (let i = 0; i < w.n; i++) {
      const di = angleDiff(w.ang + w.offs[i], th);
      if (Math.abs(di) < Math.abs(dl)) dl = di;
    }
    const half = Math.asin(Math.min(1, (w.width / 2 + hr / 2) / r));
    if (w.u > 0.15 && w.fade > 0.5 && w.hits < w.max && w.cd <= 0 && Math.abs(dl) <= half) {
      const h = this._hit;
      h.damage = w.damage;
      h.burn = w.burn;
      h.knockback = w.knockback;
      h.kind = 'fire';
      h.tell = TELL.RED;
      h.parryable = h.blockable = false;
      h.plunge = false;
      h.perfect = true;
      h.attack = w.attack;
      h.from.x = w.x;
      h.from.z = w.z;
      h.point.x = hx;
      h.point.y = 1;
      h.point.z = hz;
      const res = d.hitPlayer(h, null);
      if (res === RESULT.HIT) {
        w.hits++;
        w.cd = 1.0;
      } else w.cd = res === RESULT.DODGED || res === RESULT.PERFECT ? 0.5 : 0.3;
      return;
    }
    // the spoke's own cue: time until a spoke next touches the hero (stepped forward, _wheelTti)
    const tt = this._wheelTti(w, om, hx, hz, hr);
    if (!Number.isFinite(tt)) return;
    w.tt = tt;
    if (w.headline || w.hits >= w.max || w.cd > TUNING.flashLead || this.time - w.cueT < 0.4) return;
    if (tt >= 0.27 && tt <= TUNING.flashLead + 0.04) {
      w.cueT = this.time;
      const a = this._ttA, rr = this._ttR;
      const gx = w.x + Math.sin(a) * rr, gz = w.z + Math.cos(a) * rr;
      d.emit('combat:tell', { source: 'dragon', attack: w.attack, tell: TELL.RED, impactIn: tt, x: hx, z: hz, hazard: true, bullet: true });
      d.emit('combat:flash', { source: 'dragon', attack: w.attack, tell: TELL.RED, x: gx, y: 1.2, z: gz, hazard: true, bullet: true });
      BFX.cueGlint(fx, gx, 1.4, gz, TELL.RED);
    }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (!(dt > 0)) return;
    try {
      this._update(dt);
    } catch (err) {
      if (!this._failed) console.error('[dragon] bullets update failed', err);
      this._failed = true;
      this.clear();
    }
  }

  _kill(b) {
    if (!b.alive) return;
    b.alive = false;
    b.lead = false;
    this.live = Math.max(0, this.live - 1);
  }

  _fizzleAll() {
    const fx = this.d.fx;
    this._dropHeld();
    for (let i = 0; i < MAX; i++) {
      const b = this.pool[i];
      if (!b.alive) continue;
      BFX.fizzle(fx, b.x, b.y, b.z, b.kind);
      this._kill(b);
    }
  }

  _update(dt) {
    const d = this.d, g = d.game, fx = d.fx, K = this.K;
    this.time += dt;
    if (this._phase !== d.phase) {
      if (this._phase !== null) this.clear();
      this._phase = d.phase;
    }
    const st = d.state;
    if (st === 'dying' || st === 'dead' || st === 'sleeping') {
      if (this.live > 0) this._fizzleAll();
      if (this.wheel.on) this.wheel.on = false;
      this._dropHeld();
      return;
    }
    if (d.broken && !this._wasBroken) this._fizzleAll(); // a posture break clears the air
    this._wasBroken = !!d.broken;
    if (this._grace > 0) this._grace -= dt;
    if (this._shield > 0) this._shield -= dt;

    const pl = g.player;
    const p = pl?.position && Number.isFinite(pl.position.x + pl.position.z) ? pl.position : null;
    const hr = pl?.radius ?? 0.45;
    this._wheel(dt, p, hr);
    this._heldFlash();
    if (this.live <= 0) return;

    const sw = p && pl.isSwinging?.() && pl.sweep?.valid ? pl.sweep : null;
    const FL = TUNING.flashLead;
    const bound2 = K.bound * K.bound;
    for (let i = 0; i < MAX; i++) {
      const b = this.pool[i];
      if (!b.alive) continue;
      b.t += dt;
      b.px = b.x;
      b.pz = b.z;
      if (b.deflected) {
        this._ricochet(b, dt);
        if (b.alive) {
          if (b.returned) BFX.drawReturned(fx, b, dt, K.returnSize);
          else BFX.drawBullet(fx, b, dt);
        }
        continue;
      }
      if (!b.launched) {
        // hanging: drifts out of the burst and rises, then flies at the hero
        const dec = Math.exp(-3 * dt);
        b.vx *= dec;
        b.vz *= dec;
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.y = b.y0 + (b.yH - b.y0) * smoothstep(0, 1, clamp(b.t / 0.45, 0, 1));
        if (b.t >= b.wait) {
          if (!p) {
            BFX.fizzle(fx, b.x, b.y, b.z, b.kind);
            this._kill(b);
            continue;
          }
          const yaw = Math.atan2(p.x - b.x, p.z - b.z);
          b.vx = Math.sin(yaw) * b.launch;
          b.vz = Math.cos(yaw) * b.launch;
          b.launched = true;
          b.y0 = b.y;
          b.yT = b.t;
          b.yH = K.height;
          b.drop = 0.2;
          b.born = b.t;
          b.arm = b.t + 0.05;
          b.life = b.t + 2.5;
          BFX.muzzle(fx, b.x, b.y, b.z, b.vx / b.launch, b.vz / b.launch, 3, false);
        }
      } else {
        if (b.kind === BULLET.WISP && b.turn > 0) {
          if (b.t < b.homeAt) {
            const dec = Math.exp(-2.2 * dt);
            b.vx *= dec;
            b.vz *= dec;
          } else {
            if (!b.homing) {
              b.homing = true;
              b.born = b.t;
              b.y0 = b.y;
              b.yT = b.t;
              b.drop = 0.4;
              b.yH = K.height;
            }
            if (p) {
              const cur = Math.atan2(b.vx, b.vz), want = Math.atan2(p.x - b.x, p.z - b.z);
              const rate = b.turn * (1 + 0.25 * (b.t - b.born)) * dt;
              const yaw = cur + clamp(angleDiff(cur, want), -rate, rate);
              let sp = Math.hypot(b.vx, b.vz);
              sp += (b.cruise - sp) * (1 - Math.exp(-3 * dt));
              b.vx = Math.sin(yaw) * sp;
              b.vz = Math.cos(yaw) * sp;
            }
          }
        }
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.y = b.y0 + (b.yH - b.y0) * smoothstep(0, 1, clamp((b.t - b.yT) / b.drop, 0, 1));
      }
      if (!Number.isFinite(b.x + b.y + b.z)) {
        this._kill(b);
        continue;
      }
      if (b.t >= b.life) {
        BFX.fizzle(fx, b.x, b.y, b.z, b.kind);
        this._kill(b);
        continue;
      }
      const ox = b.x - d.position.x, oz = b.z - d.position.z;
      if (ox * ox + oz * oz > bound2) {
        this._kill(b);
        continue;
      }
      // a swing cuts the small ones out of the air
      if (sw && b.kind !== BULLET.ORB) {
        const R = b.r + K.cut;
        const A = sw.a, B = sw.b, PA = sw.pa, PB = sw.pb;
        if (
          distPointSegment(b.x, b.y, b.z, A.x, A.y, A.z, B.x, B.y, B.z) <= R ||
          distPointSegment(b.x, b.y, b.z, PA.x, PA.y, PA.z, PB.x, PB.y, PB.z) <= R ||
          distPointSegment(b.x, b.y, b.z, (A.x + PA.x) / 2, (A.y + PA.y) / 2, (A.z + PA.z) / 2, (B.x + PB.x) / 2, (B.y + PB.y) / 2, (B.z + PB.z) / 2) <= R
        ) {
          BFX.cutSpark(fx, b.x, b.y, b.z, b.kind);
          this._kill(b);
          continue;
        }
      }
      if (p) {
        // a homing wisp still flying after the impact its cue announced (it missed him and is
        // coming round) has to announce the next one: a cue is for one impact
        if (b.cued && b.homing && b.turn > 0 && !b.dud && b.t > b.cueAt + K.recue) {
          b.cued = false;
          b.cueAt = Infinity;
        }
        if (!b.cued && !b.dud) {
          const tt = this.tti(b);
          if (tt <= FL + (b.kind === BULLET.ORB ? 0.04 : 0)) {
            const r = this.cue(b.kind, b.attack, b.tell, tt, b.x, b.y, b.z);
            if (r === CUE.LATE && (b.kind === BULLET.WISP || b.t - b.born < K.young)) b.dud = true;
            b.cued = true;
            b.cueAt = b.t + tt;
          }
        }
        if (b.launched && b.t >= b.arm && b.y <= HIT_Y) {
          const R = b.r + hr;
          if (distPointSegment(p.x, 0, p.z, b.px, 0, b.pz, b.x, 0, b.z) <= R) {
            this._touch(b, p);
            if (!b.alive) continue;
          }
        }
      }
      BFX.drawBullet(fx, b, dt);
    }
  }

  _ricochet(b, dt) {
    const d = this.d, K = this.K;
    const head = d.rig?.pt?.head;
    b.defT += dt;
    if (!head || !Number.isFinite(head.x + head.y + head.z) || b.defT > 1.5) {
      BFX.burst(d.fx, b.x, b.y, b.z, b.kind);
      this._kill(b);
      return;
    }
    const dx = head.x - b.x, dy = head.y - b.y, dz = head.z - b.z;
    const l = Math.hypot(dx, dy, dz);
    const sp = b.returned ? K.returnSpeed : K.ricochet;
    const step = sp * dt;
    if (l <= step + 1) {
      if (b.returned) this._land(b, head);
      else {
        BFX.burst(d.fx, head.x, head.y, head.z, b.kind);
        d.flash = Math.max(d.flash || 0, 0.3);
      }
      this._kill(b);
      return;
    }
    b.vx = (dx / l) * sp;
    b.vz = (dz / l) * sp;
    b.x += (dx / l) * step;
    b.y += (dy / l) * step;
    b.z += (dz / l) * step;
  }

  /**
   * A returned shot reaches the head: the kind's returnDamage through dragon.takeHit (final, part
   * head: the phase gate holds, it may kill) with returnPosture instead of the weapon gain, a head
   * flinch (visual), a burst, a small shake; 'dragon:returned' { kind, damage, x, y, z }. The wyrm's
   * action goes on (takeHit never interrupts it).
   */
  _land(b, head) {
    const d = this.d, K = this.K, spec = K[KEYS[b.kind]];
    BFX.returnBurst(d.fx, head.x, head.y, head.z, b.kind);
    const o = this._ret;
    o.damage = spec?.returnDamage ?? 0;
    o.posture = spec?.returnPosture ?? 0;
    o.heavy = b.kind === BULLET.WISP;
    o.point.x = head.x;
    o.point.y = head.y;
    o.point.z = head.z;
    const sp = Math.hypot(b.vx, b.vz) || 1;
    o.dir.x = b.vx / sp;
    o.dir.z = b.vz / sp;
    let dmg = 0;
    try {
      dmg = d.takeHit?.(o) ?? 0;
    } catch (err) {
      console.error('[dragon] returned shot takeHit failed', err);
    }
    d.flinchHead = true;
    d.flash = Math.max(d.flash || 0, 0.7);
    d.game.shake?.(b.kind === BULLET.WISP ? 0.18 : 0.12);
    if (dmg > 0) d.emit('dragon:returned', { kind: b.kind, damage: dmg, x: head.x, y: head.y, z: head.z });
  }

  _touch(b, p) {
    const d = this.d, fx = d.fx, K = this.K;
    const grp = b.group >= 0 ? this.groups[b.group] : null;
    if (b.dud || this._grace > 0 || (grp && grp.hits >= grp.max)) {
      BFX.fizzle(fx, b.x, b.y, b.z, b.kind);
      this._kill(b);
      return;
    }
    const orb = b.kind === BULLET.ORB;
    if (this._shield > 0 && !orb) {
      BFX.cutSpark(fx, b.x, b.y, b.z, b.kind);
      this._kill(b);
      return;
    }
    const spec = K[KEYS[b.kind]];
    const sp = Math.hypot(b.vx, b.vz) || 1;
    const h = this._hit;
    h.damage = spec.damage;
    h.burn = spec.burn ?? 0;
    h.knockback = spec.knockback ?? 0;
    h.kind = orb ? 'fireball' : 'fire';
    h.tell = b.tell;
    h.parryable = h.blockable = !orb;
    h.plunge = false;
    h.perfect = orb;
    h.attack = b.attack;
    h.from.x = p.x - (b.vx / sp) * 3;
    h.from.z = p.z - (b.vz / sp) * 3;
    h.point.x = b.x;
    h.point.y = b.y;
    h.point.z = b.z;
    const r = d.hitPlayer(h, null);
    if (r === RESULT.PARRIED) this._deflect(b, spec, p, !!d.game.player?.deflect?.perfect);
    else if (r === RESULT.HIT) {
      BFX.burst(fx, b.x, b.y, b.z, b.kind);
      if (grp) grp.hits++;
      this._grace = K.grace;
      this._kill(b);
    } else if (r === RESULT.BLOCKED) {
      BFX.burst(fx, b.x, b.y, b.z, b.kind);
      this._kill(b);
    } else if (r === RESULT.DODGED || r === RESULT.PERFECT) {
      b.arm = b.t + 0.7; // rolled through: it flies on
      b.turn = 0;
      b.cued = true;
    } else b.arm = b.t + 0.3;
  }

  /**
   * A parried bullet flies back to the head. Normal: the kind's posture now, no damage. `perfect`
   * (an ember / wisp parried within DEFENSE.perfectParryWindow): it is RETURNED, and its damage and
   * returnPosture land with it (_land). Only the struck bullet comes back: the clump it opens the
   * shield for is popped as usual.
   */
  _deflect(b, spec, p, perfect = false) {
    const d = this.d, fx = d.fx, K = this.K;
    const grp = b.group >= 0 ? this.groups[b.group] : null;
    b.deflected = true;
    // a pattern gives back at most its group's return budget (a well-played pattern returns <= ~8 %
    // of a phase's HP): past it a perfect parry is a plain deflect
    b.returned = !!perfect && spec.returnDamage > 0 && (!grp || grp.ret + spec.returnDamage <= grp.retMax + 1e-6);
    if (b.returned && grp) grp.ret += spec.returnDamage;
    b.defT = 0;
    b.lead = false;
    b.y0 = b.yH = b.y;
    if (!b.returned) d.addPosture?.(spec.posture ?? 0);
    BFX.deflectSpark(fx, b.x, b.y, b.z, b.kind);
    if (b.returned) BFX.returnLaunch(fx, b.x, b.y, b.z);
    d.emit('dragon:parried', { attack: b.attack, tell: b.tell, hit: 0, last: false, bullet: true, perfect: !!perfect });
    this._shield = K.cueGap;
    // the clash bursts the small bullets round the hero and the ones about to land
    const pop2 = K.pop * K.pop;
    for (let i = 0; i < MAX; i++) {
      const o = this.pool[i];
      if (!o.alive || o === b || o.deflected || !o.launched || o.kind === BULLET.ORB) continue;
      const dx = o.x - p.x, dz = o.z - p.z;
      if (dx * dx + dz * dz <= pop2 || this.tti(o) < K.cueGap + 0.03) {
        BFX.cutSpark(fx, o.x, o.y, o.z, o.kind);
        this._kill(o);
      }
    }
  }
}
