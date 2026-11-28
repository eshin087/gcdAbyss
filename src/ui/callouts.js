import { el, num } from './dom.js';
import { streakK } from '../combat/streak.js';

// Short combat call-outs: world-anchored pop-ups over the player's head (PARRY /
// GHOSTEP / GUARD BROKEN / BLOCK, "PARRY ×N" for parries in a row (ADR-294: no deflect), EXECUTION, RETURN for a
// perfectly parried bullet sent back at the wyrm), floating damage
// numbers at the hit point (crits read "CRIT 123"), and a small mid-screen "POSTURE BROKEN"
// banner. Pooled DOM nodes, animated from update(realDt) on real time so they stay readable during
// Ghostep slow-mo; only transform and opacity are written per frame, and only for live items.
// Subscribes itself to combat:deflectChain { count } (a string's blows parried in a row) and
// player:plungeHit { execution } (the hud wires the rest). The streak of perfect dodges: the
// GHOSTEP call-out counts ("GHOSTEP ×4", bigger with every one), and a flurry's cuts count up in
// one place over its target ("×3").
// With the streak counter on (the streak pass's 'counter', ui/streakCounter.js) the streak's number
// lives beside the hero, so GHOSTEP and RIPOSTE keep their word and drop their count (one streak
// number near the hero, not two). PARRY ×N keeps its count: it counts the boss's string, not the streak.
// The flurry's cut counter then ticks without popping again while its cuts come faster than its pop (the accelerating storm).

const HEAD_UP = 3.0; // m above the player's feet (just over the name tag)
const KINDS = {
  parry: { text: 'PARRY', life: 0.95, rise: 30, pop: 1.35 },
  ghostep: { text: 'GHOSTEP', life: 1.25, rise: 26, pop: 1.5, streak: true },
  // a parried last blow answered with flash cuts (player:flurry, art 'riposte')
  riposte: { text: 'RIPOSTE', life: 1.1, rise: 26, pop: 1.5, cls: 'deflect', streak: true },
  gbreak: { text: 'GUARD BROKEN', life: 1.3, rise: 22, pop: 1.3 },
  // the guard meter ran out on a blocked blow (player:guardOpen): styled as the guard break
  gopen: { text: 'GUARD DOWN', life: 1.0, rise: 20, pop: 1.25, cls: 'gbreak' },
  block: { text: 'BLOCK', life: 0.6, rise: 16, pop: 1.15 },
  // parries in a row inside one string: the parry call-out of that blow turns into "PARRY ×N" (ADR-294: there is
  // no deflect, every parry is a parry; the css class keeps its old name)
  chain: { text: 'PARRY', life: 1.15, rise: 34, pop: 1.5, cls: 'deflect' },
  exec: { text: 'EXECUTION', life: 1.4, rise: 30, pop: 1.6, cls: 'deflect' },
  // the execution of a boss with several bars (dragon.lives: the Starless Lord): it ends a form
  deathblow: { text: 'DEATHBLOW', life: 1.5, rise: 30, pop: 1.7, cls: 'deflect', streak: true },
  ret: { text: 'RETURN', life: 1.0, rise: 34, pop: 1.5, cls: 'return' },
  // a duelist's guard turned the hero's strike (dragon:guard; the Ash Disciple) ...
  guard: { text: 'GUARDED', life: 0.7, rise: 16, pop: 1.15 },
  // ... or beat it away: the hero's blade is thrown back and his counter is coming (red: a warning)
  deflected: { text: 'DEFLECTED', life: 0.9, rise: 20, pop: 1.5, cls: 'danger' },
  // ... or caught it in his counter stance (dragon:guard with `caught`; Tian Lei): his punish is coming
  caught: { text: 'CAUGHT', life: 0.9, rise: 20, pop: 1.5, cls: 'danger' },
  // two cuts met (combat:clash): neither landed
  trade: { text: 'CLASH', life: 1.0, rise: 24, pop: 1.6, cls: 'deflect' },
  // ... and the flash counter (player:counter): the cut went through his blow and through him
  counter: { text: 'FLASH COUNTER', life: 1.4, rise: 30, pop: 1.8, cls: 'deflect', streak: true },
  // ... the flash chain's links (?counter=chain, ADR-246): the second, and the last, which ends it
  counter2: { text: 'FLASH COUNTER ×2', life: 1.3, rise: 32, pop: 1.9, cls: 'deflect', streak: true },
  counterLast: { text: 'THREE FLASHES', life: 1.7, rise: 34, pop: 2.1, cls: 'deflect', streak: true },
  // the counter (player:flareCounter, ADR-118): a blue flare blow parried, and the hero's own answer landed
  flareCounter: { text: 'COUNTER', life: 1.3, rise: 30, pop: 1.8, cls: 'deflect', streak: true },
  // the duel's moments (player:lock, player:mikiri, dragon:deflected)
  lock: { text: 'BLADE LOCK', life: 1.1, rise: 20, pop: 1.5, cls: 'deflect' },
  lockWon: { text: 'BREAKTHROUGH', life: 1.3, rise: 30, pop: 1.6, cls: 'deflect' },
  mikiri: { text: 'MIKIRI', life: 1.3, rise: 30, pop: 1.7, cls: 'deflect', streak: true },
  fullDeflect: { text: 'PERFECT PARRY', life: 1.5, rise: 32, pop: 1.7, cls: 'deflect', streak: true },
};
const NUM = { life: 0.95, rise: 34 };
const COUNT = { life: 0.9, rise: 10 }; // a flurry's cut counter over its target
const COUNT_TICK = 0.2; // s: (counter on) a cut landing while the last pop is younger ticks the number, no new pop
const CALL_POOL = 6;
const NUM_POOL = 12;
const STACK_GAP = 0.32; // s: call-outs younger than this push a new one up
const STACK_PX = 21;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

class Item {
  constructor(layer, className) {
    this.node = el('div', className, null, layer);
    this.span = el('span', 't', '', this.node);
    this.streak = null;
    this.active = false;
    this.kind = null;
    this.age = 0;
    this.popT = 0; // s since the last pop (the age, unless a count ticked in place)
    this.life = 1;
    this.rise = 20;
    this.pop = 1.2;
    this.lift = 0;
    this.jx = 0;
    this.head = true;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this._tr = '';
    this._op = -1;
    this._st = '';
  }

  hide() {
    this.active = false;
    this.node.classList.remove('on');
    this._op = -1;
    this._tr = '';
  }
}

export class Callouts {
  constructor(game, parent, projector) {
    this.game = game;
    this.proj = projector;
    this.layer = el('div', 'ab-calls ab-play', null, parent);
    this.calls = [];
    for (let i = 0; i < CALL_POOL; i++) {
      const it = new Item(this.layer, 'ab-call');
      it.streak = el('div', 'streak', null, it.node);
      this.calls.push(it);
    }
    this.nums = [];
    for (let i = 0; i < NUM_POOL; i++) this.nums.push(new Item(this.layer, 'ab-num'));
    this.pools = [this.calls, this.nums];
    this.p = { x: 0, y: 0, on: false, front: false };
    this.mini = new MiniBanner(parent);
    this.critMult = 0;
    game.events?.on?.('combat:deflectChain', (d) => this.chain(d?.count));
    game.events?.on?.('player:plungeHit', (d) => {
      if (d?.execution) this.call(game.dragon?.lives ? 'deathblow' : 'exec');
    });
    game.events?.on?.('dragon:guard', (d) => this.call(d?.caught ? 'caught' : d?.deflect ? 'deflected' : 'guard'));
    game.events?.on?.('combat:clash', (d) => {
      if (!d?.counter) this.call('trade');
    });
    game.events?.on?.('player:counter', (d) => this.call(d?.links > 1 && d.link >= d.links ? 'counterLast' : d?.link === 2 ? 'counter2' : 'counter'));
    game.events?.on?.('player:flareCounter', () => this.call('flareCounter'));
    game.events?.on?.('player:lock', (d) => {
      if (d?.phase === 'start') this.call('lock');
      else if (d?.phase === 'won') this.call('lockWon');
    });
    game.events?.on?.('player:mikiri', () => this.call('mikiri'));
    // every blow of a long string parried (the full deflect's reward): "PERFECT PARRY ×N"
    game.events?.on?.('dragon:deflected', (d) => {
      this.call('fullDeflect');
      const n = Math.round(num(d?.count));
      const it = n >= 2 ? this.calls.find((c) => c.active && c.kind === 'fullDeflect' && c.age === 0) : null;
      if (it) it.span.textContent = `${KINDS.fullDeflect.text} ×${n}`;
    });
  }

  /** Pop a call-out over the player's head. kind ∈ KINDS. */
  call(kind) {
    const k = KINDS[kind];
    if (!k) return;
    // blocks come in bursts (multi-hit attacks): refresh the live one instead of stacking
    if (kind === 'block' || kind === 'guard') {
      const live = this.calls.find((c) => c.active && c.kind === kind && c.age < 0.3);
      if (live) {
        live.age = 0;
        return;
      }
    }
    // the blow that knocked the guard open was blocked first: its BLOCK pop makes way
    if (kind === 'gopen') this.calls.find((c) => c.active && c.kind === 'block' && c.age < 0.05)?.hide();
    let lift = 0;
    for (const c of this.calls) if (c.active && c.age < STACK_GAP) lift = Math.max(lift, c.lift + STACK_PX);
    const it = this._take(this.calls);
    it.kind = kind;
    it.life = k.life;
    it.rise = k.rise;
    it.pop = k.pop;
    it.lift = Math.min(lift, STACK_PX * 3);
    it.jx = 0;
    it.head = true;
    it.span.textContent = k.text;
    it.node.className = `ab-call on k-${k.cls ?? kind}`;
    it.streak.style.display = k.streak ? '' : 'none';
    this._start(it);
  }

  /**
   * Parries in a row (combat:deflectChain): "PARRY ×N" over the hero's head, popping bigger as the
   * chain climbs. One counter per string: the live chain call-out counts up in place, and the
   * PARRY call-out this same blow just popped folds into it, so a string parried in
   * rhythm reads as one climbing counter, not a stack of words.
   */
  chain(count) {
    const n = Math.round(num(count));
    if (!(n >= 2)) return;
    const k = KINDS.chain;
    const fresh = this.calls.find((c) => c.active && c.age < 0.05 && c.kind === 'parry');
    let it = this.calls.find((c) => c.active && c.kind === 'chain');
    if (it) {
      if (fresh) fresh.hide();
    } else if (fresh) it = fresh;
    else {
      let lift = 0;
      for (const c of this.calls) if (c.active && c.age < STACK_GAP) lift = Math.max(lift, c.lift + STACK_PX);
      it = this._take(this.calls);
      it.lift = Math.min(lift, STACK_PX * 3);
    }
    it.kind = 'chain';
    it.life = k.life;
    it.rise = k.rise;
    it.pop = Math.min(2, k.pop + 0.1 * (n - 2));
    it.jx = 0;
    it.head = true;
    it.span.textContent = `${k.text} ×${n}`;
    it.node.className = `ab-call on k-${k.cls}`;
    it.streak.style.display = 'none';
    this._start(it);
  }

  /** GHOSTEP over the hero's head; from the second perfect dodge of a streak on it counts
   *  ("GHOSTEP ×N") and pops bigger with every one. */
  ghostep(streak) {
    const n = Math.round(num(streak));
    this.call('ghostep');
    if (!(n >= 2) || streakK('counter') > 0) return;
    const it = this.calls.find((c) => c.active && c.kind === 'ghostep' && c.age === 0);
    if (!it) return;
    it.span.textContent = `${KINDS.ghostep.text} ×${n}`;
    it.pop = Math.min(2.3, KINDS.ghostep.pop + 0.12 * (n - 1));
    it.life = KINDS.ghostep.life + Math.min(0.5, 0.06 * n);
  }

  /** RIPOSTE over the hero's head ("RIPOSTE ×N" for two cuts or more). */
  riposte(strikes) {
    const n = Math.round(num(strikes));
    this.call('riposte');
    if (!(n >= 2) || streakK('counter') > 0) return;
    const it = this.calls.find((c) => c.active && c.kind === 'riposte' && c.age === 0);
    if (!it) return;
    it.span.textContent = `${KINDS.riposte.text} ×${n}`;
    it.pop = Math.min(2.3, KINDS.riposte.pop + 0.12 * (n - 1));
  }

  /** A flurry's cut `n` landed at world `point`: one counter over the target, counting up in place. */
  count(n, point) {
    const k = Math.round(num(n));
    const x = num(point?.x, NaN), y = num(point?.y, NaN), z = num(point?.z, NaN);
    if (!(k >= 1) || !Number.isFinite(x + y + z)) return;
    const live = this.nums.find((c) => c.active && c.kind === 'count');
    if (live && live.popT < COUNT_TICK && streakK('counter') > 0) {
      // the storm's last cuts: the number ticks where it is, the pop it is in carries on
      live.life = live.age + COUNT.life;
      live.pop = Math.min(2.4, 1.5 + 0.12 * k);
      live.x = x;
      live.y = y + 1.5;
      live.z = z;
      live.span.textContent = `×${k}`;
      return;
    }
    const it = live ?? this._take(this.nums);
    it.kind = 'count';
    it.life = COUNT.life;
    it.rise = COUNT.rise;
    it.pop = Math.min(2.4, 1.5 + 0.12 * k);
    it.lift = 0;
    it.jx = 0;
    it.head = false;
    it.x = x;
    it.y = y + 1.5;
    it.z = z;
    it.span.textContent = `×${k}`;
    it.node.className = 'ab-num on k-count';
    this._start(it);
  }

  /** Floating damage number at a world point (falls back to the dragon's lock point). */
  number(damage, point, { crit = false, heavy = false } = {}) {
    const dmg = Math.round(num(damage));
    if (dmg <= 0) return;
    let x = num(point?.x, NaN);
    let y = num(point?.y, NaN);
    let z = num(point?.z, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      const d = this.game.dragon?.position;
      if (!d) return;
      x = num(d.x);
      z = num(d.z);
      y = 3;
    }
    if (!Number.isFinite(y)) y = 2;
    const it = this._take(this.nums);
    it.kind = crit ? 'crit' : heavy ? 'heavy' : 'hit';
    it.life = crit ? NUM.life * 1.25 : NUM.life;
    it.rise = crit ? NUM.rise * 1.15 : NUM.rise;
    it.pop = crit ? 1.6 : heavy ? 1.3 : 1.12;
    it.lift = 0;
    it.jx = (Math.random() * 2 - 1) * 16;
    it.head = false;
    it.x = x;
    it.y = y + 0.4;
    it.z = z;
    it.span.textContent = crit ? `CRIT ${dmg}` : String(dmg);
    it.node.className = `ab-num on k-${it.kind}`;
    this._start(it);
  }

  /** Mid-screen small banner (e.g. "POSTURE BROKEN"). */
  banner(text, sub = '', tier = 0) {
    this.mini.show(text, sub, tier);
  }

  clear() {
    for (const c of this.calls) if (c.active) c.hide();
    for (const n of this.nums) if (n.active) n.hide();
    this.mini.clear();
  }

  _take(pool) {
    let it = pool.find((i) => !i.active);
    if (!it) it = pool.reduce((a, b) => (a.age >= b.age ? a : b)); // recycle the oldest
    return it;
  }

  _start(it) {
    it.active = true;
    it.age = 0;
    it.popT = 0;
    it._tr = '';
    it._op = -1;
    it._st = '';
  }

  update(dt) {
    const g = this.game;
    const pp = g.player?.position;
    const p = this.p;
    for (const pool of this.pools) {
      for (const it of pool) {
        if (!it.active) continue;
        it.age += dt;
        it.popT += dt;
        if (it.age >= it.life) {
          it.hide();
          continue;
        }
        let ok;
        if (it.head) ok = !!pp && this.proj.project(num(pp.x), num(pp.y) + HEAD_UP, num(pp.z), p);
        else ok = this.proj.project(it.x, it.y, it.z, p);
        if (!ok || !p.front) {
          it.hide();
          continue;
        }
        const u = it.age / it.life;
        // pop: grow from 0.6 with an overshoot bump (~pop at the middle), settle to 1 at 0.2 s
        const k = clamp01(it.popT / 0.2);
        const s = k < 1 ? 0.6 + 0.4 * k + (it.pop - 1) * Math.sin(k * Math.PI) : 1;
        const rise = it.rise * easeOut(u) + it.lift;
        const tr = `translate3d(${(p.x + it.jx).toFixed(1)}px, ${(p.y - rise).toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
        if (tr !== it._tr) {
          it._tr = tr;
          it.node.style.transform = tr;
        }
        const op = Math.round((u < 0.62 ? 1 : 1 - (u - 0.62) / 0.38) * 100) / 100;
        if (op !== it._op) {
          it._op = op;
          it.node.style.opacity = String(op);
        }
        if (it.kind === 'ghostep' && it.streak) {
          // a cyan streak that sweeps out from the word and thins away
          const w = clamp01(it.age / 0.22);
          const st = `scaleX(${(0.2 + 1.3 * easeOut(w)).toFixed(3)}) scaleY(${(1 - 0.6 * u).toFixed(3)})`;
          if (st !== it._st) {
            it._st = st;
            it.streak.style.transform = st;
          }
        }
      }
    }
    this.mini.update(dt);
  }
}

/** Small centre banner (gold, between thin rules) — fades in, holds, fades out. */
class MiniBanner {
  constructor(parent) {
    this.root = el('div', 'ab-mini', null, parent);
    this.txt = el('div', 'txt', '', this.root);
    this.sub = el('div', 'sub', '', this.root);
    this.t = -1;
    this.life = 1.9;
    this._op = -1;
    this._tr = '';
  }

  /** tier (the streak pass's 'tiers'): 4 and 5 add a thin rule or two, never size. */
  show(text, sub = '', tier = 0) {
    const t = Math.round(num(tier));
    const name = String(text ?? '');
    if (t >= 5 && !this.over) this.over = this.root.insertBefore(el('div', 'over'), this.txt);
    this.root.className = `ab-mini${t >= 4 ? ` t${Math.min(5, t)}` : ''}${t >= 4 && name.length > 15 ? ' long' : ''}`;
    this.txt.textContent = name;
    this.sub.textContent = String(sub ?? '');
    this.t = 0;
    this._op = -1;
    this._tr = '';
    this.root.classList.add('on');
  }

  clear() {
    if (this.t < 0) return;
    this.t = -1;
    this.root.classList.remove('on');
    this.root.style.opacity = '0';
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    if (t >= this.life) {
      this.clear();
      return;
    }
    const op = Math.round((t < 0.08 ? t / 0.08 : t > this.life - 0.5 ? (this.life - t) / 0.5 : 1) * 100) / 100;
    if (op !== this._op) {
      this._op = op;
      this.root.style.opacity = String(op);
    }
    const s = 1 + 0.35 * Math.exp(-t * 14);
    const tr = `translateX(-50%) scale(${s.toFixed(3)})`;
    if (tr !== this._tr) {
      this._tr = tr;
      this.root.style.transform = tr;
    }
  }
}
