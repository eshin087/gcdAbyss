import { DEFENSE, TELL } from '../combat/rules.js';

// Timing trainer: measures how early / late the player's defensive input was relative to each
// impact. Pure data (no DOM) so it can be tested headless; the Lab panel renders `results`/`events`.
//
// Clock: game time (game.time), the same clock the parry / perfect-dodge windows are measured in,
// so the numbers stay true under the Lab time scale. Negative ms = pressed before the impact.
//   - press times: RMB (block / parry) and Space (dodge) edges read from game.input every frame
//   - impact time: the moment the player's result event fires (player:parry / block / perfectDodge /
//     dodge / hurt / guardBreak) — attackers resolve takeHit at impact
//   - prediction: combat:tell {impactIn} → the trainer also reports the tell's prediction error (Δ)

const LOOKBACK = 1.0; // s: presses older than this before an impact count as "no input"
const LATE = 0.5; // s after an unanswered hit during which a press is reported as "late"
const MATCH = 0.45; // s: max gap between a predicted impact (combat:tell) and a result
const COLLAPSE = 0.3; // s: repeated passive results (breath ticks, held guard) / events merge into "xN"
const SAME_HIT = 0.05; // s: a block / guard break that also emits player:hurt is graded once
const DOT_KIND = 'burn'; // player:hurt kind of damage-over-time ticks (no impact to grade)
const MAX_RESULTS = 6;
const MAX_EVENTS = 8;
const MAX_PENDING = 12;

/** Events shown in the rolling list (name → short label). */
const LOGGED = {
  'combat:tell': 'tell',
  'combat:flash': 'flash',
  'player:parry': 'P parry',
  'player:block': 'P block',
  'player:guardBreak': 'P guardBreak',
  'player:perfectDodge': 'P perfect',
  'player:dodge': 'P dodge',
  'player:hurt': 'P hurt',
  'player:ghostep': 'P ghostep',
  'player:died': 'P died',
  'dragon:parried': 'D parried',
  'combat:deflectChain': 'D deflect chain',
  'dragon:postureBreak': 'D postureBreak',
  'dragon:stagger': 'D stagger',
  'dragon:phase2': 'D phase2',
  'dragon:phase3': 'D phase3',
  'dragon:phase': 'D phase',
  'dragon:plunged': 'D plunged',
  'dragon:death': 'D death',
};

/** Player result events the trainer grades. */
const RESULTS = {
  'player:parry': 'parry',
  'player:block': 'block',
  'player:guardBreak': 'guardBreak',
  'player:perfectDodge': 'perfect',
  'player:dodge': 'dodge',
  'player:hurt': 'hurt',
};

const TELLS = new Set(Object.values(TELL));
const finite = (v, f = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const ms = (s) => Math.round(s * 1000);
const signed = (s) => (s === null ? '?' : `${s > 0 ? '+' : ''}${ms(s)}ms`);

/** Attack name from an event payload: a string, or an attack definition object. */
export function attackName(a) {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') return String(a.name ?? a.id ?? a.label ?? '');
  return '';
}

export function tellName(t) {
  return TELLS.has(t) ? t : TELL.NORMAL;
}

export class TimingTrainer {
  constructor(game) {
    this.game = game;
    this.rmbAt = -1e9;
    this.spaceAt = -1e9;
    this.pending = []; // { attack, tell, at, seq } predicted impacts from combat:tell
    this.seq = 0; // id of the latest prediction (see dropPendingUpTo)
    this.results = []; // newest first: { kind, attack, tell, text, cls, drift, t, t1, n }
    this.events = []; // newest first: { t, t1, name, label, detail, tell, key, n }
    this.late = null; // { at, entry } an unanswered hit still accepting a "late" press
    this.version = 0; // bumps whenever results / events change (the panel re-renders on change)
    this._off = [];
    const ev = game?.events;
    if (typeof ev?.on === 'function') {
      for (const name of Object.keys(LOGGED)) {
        const off = ev.on(name, (d) => this._on(name, d));
        if (typeof off === 'function') this._off.push(off);
      }
    }
  }

  get now() {
    return finite(this.game?.time);
  }

  /** Call once per frame (cheap: two edge checks). */
  trackInput() {
    const inp = this.game?.input;
    if (!inp) return;
    const rmb = !!inp.mousePressed?.(2);
    const space = !!inp.pressed?.('Space');
    if (!rmb && !space) return;
    const now = this.now;
    if (rmb) this.rmbAt = now;
    if (space) this.spaceAt = now;
    const L = this.late;
    if (!L) return;
    this.late = null;
    if (now - L.at <= LATE) {
      L.entry.text += `, late ${rmb ? 'RMB' : 'Space'} +${ms(now - L.at)}ms`;
      this.version++;
    }
  }

  /** Earliest predicted impact that has not happened yet (or null). No allocation. */
  nextImpact(now = this.now) {
    let best = null;
    for (const p of this.pending) {
      if (p.at < now - 0.03) continue;
      if (!best || p.at < best.at) best = p;
    }
    return best;
  }

  clear() {
    this.pending.length = 0;
    this.results.length = 0;
    this.events.length = 0;
    this.late = null;
    this.version++;
  }

  /** Forget predicted impacts (after a reset / state jump the announced hits will never land). */
  clearPending() {
    this.pending.length = 0;
    this.late = null;
  }

  /**
   * Forget predictions announced up to `seq` (a forced ability replaced the attack in flight), but
   * keep any the new ability announced since — read `trainer.seq` before forcing it.
   */
  dropPendingUpTo(seq) {
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].seq <= seq) this.pending.splice(i, 1);
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
  }

  // ---------------------------------------------------------------- internals
  _on(name, d) {
    try {
      const now = this.now;
      if (name === 'combat:tell') {
        const inS = finite(d?.impactIn, NaN);
        if (Number.isFinite(inS)) {
          this._prune(now);
          this.pending.push({ attack: attackName(d?.attack), tell: tellName(d?.tell), at: now + Math.max(0, inS), seq: ++this.seq });
          if (this.pending.length > MAX_PENDING) this.pending.shift();
        }
      }
      const kind = RESULTS[name];
      if (kind) this._result(kind, d, now);
      this._log(name, d, now);
      this.version++;
    } catch (err) {
      console.error('[lab] trainer event failed', name, err);
    }
  }

  _prune(now) {
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].at < now - MATCH) this.pending.splice(i, 1);
  }

  /** Take the predicted impact closest to `now` (within MATCH). */
  _match(now) {
    this._prune(now);
    let bi = -1, bd = MATCH;
    for (let i = 0; i < this.pending.length; i++) {
      const dd = Math.abs(this.pending[i].at - now);
      if (dd <= bd) {
        bd = dd;
        bi = i;
      }
    }
    return bi >= 0 ? this.pending.splice(bi, 1)[0] : null;
  }

  /** Press time relative to `now` (≤ 0), or null when older than LOOKBACK. */
  _rel(at, now) {
    const d = at - now;
    return d <= 0.0001 && d >= -LOOKBACK ? Math.min(0, d) : null;
  }

  _result(kind, d, now) {
    const top = this.results[0];
    if (kind === 'hurt') {
      // damage-over-time ticks have no impact to grade (and must not spend the next press)
      if (d?.kind === DOT_KIND) return;
      // a block's chip damage / a guard break may also emit player:hurt for the same impact
      if (top && (top.kind === 'block' || top.kind === 'guardBreak') && now - top.t1 <= SAME_HIT) return;
    }
    const r = this._rel(this.rmbAt, now);
    const s = this._rel(this.spaceAt, now);
    const m = this._match(now);
    const tell = d?.tell ? tellName(d.tell) : m?.tell ?? TELL.NORMAL;
    const attack = attackName(d?.attack) || m?.attack || (typeof d?.kind === 'string' ? d.kind : '') || '?';
    // passive repeats (breath ticks, hits on a held guard) merge into "xN"; a result with its own
    // press is always listed, so every hit of a parried / dodged combo keeps its own timing
    if (r === null && s === null && top && top.kind === kind && top.attack === attack && now - top.t1 <= COLLAPSE) {
      top.n++;
      top.t1 = now;
      return;
    }

    const PW = DEFENSE.parryWindow;
    const DW = DEFENSE.perfectDodgeWindow;
    let text = '', cls = 'mid';
    switch (kind) {
      case 'parry':
        text = `PARRY  RMB ${signed(r)}  (window -${ms(PW)}..0)`;
        cls = 'good';
        break;
      case 'perfect':
        text = `PERFECT DODGE  Space ${signed(s)}  (window -${ms(DW)}..0)`;
        cls = 'good';
        break;
      case 'block':
        if (r === null) text = 'BLOCK  (guard held)';
        else if (-r > PW) text = `BLOCK  RMB ${signed(r)}: ${ms(-r - PW)}ms early for a parry`;
        else text = `BLOCK  RMB ${signed(r)}: in window, parry refused (arc / rearm / unparryable)`;
        break;
      case 'dodge':
        if (s === null) text = 'DODGE  (i-frames)';
        else if (-s > DW) text = `DODGE  Space ${signed(s)}: ${ms(-s - DW)}ms early for perfect`;
        else text = `DODGE  Space ${signed(s)}`;
        break;
      case 'guardBreak':
        text = `GUARD BREAK  RMB ${signed(r)}${tell === TELL.RED ? ': red cannot be blocked, dodge it' : ''}`;
        cls = 'bad';
        break;
      default: {
        // hurt: grade the most recent defensive press
        cls = 'bad';
        if (r === null && s === null) {
          text = `HURT  no input${tell === TELL.RED ? ' (red: perfect dodge)' : tell === TELL.BLUE ? ' (blue: parry)' : ''}`;
        } else if (s !== null && (r === null || s >= r)) {
          text = -s > DW ? `HURT  Space ${signed(s)}: ${ms(-s - DW)}ms early` : `HURT  Space ${signed(s)}: too late / no i-frames`;
        } else if (tell === TELL.RED) {
          text = `HURT  RMB ${signed(r)}: red cannot be blocked, dodge it`;
        } else if (-r > PW) {
          text = `HURT  RMB ${signed(r)}: ${ms(-r - PW)}ms early (guard released?)`;
        } else {
          text = `HURT  RMB ${signed(r)}: in window, not parried (arc / rearm?)`;
        }
      }
    }
    // each press is graded once: a parry / dodge press must not explain the next hit too
    if (r !== null) this.rmbAt = -1e9;
    if (s !== null) this.spaceAt = -1e9;
    const entry = { kind, attack, tell, text, cls, drift: m ? ms(now - m.at) : null, t: now, t1: now, n: 1 };
    this.results.unshift(entry);
    if (this.results.length > MAX_RESULTS) this.results.length = MAX_RESULTS;
    this.late = kind === 'hurt' && r === null && s === null ? { at: now, entry } : null;
  }

  _log(name, d, now) {
    const label = LOGGED[name];
    if (!label) return;
    const attack = attackName(d?.attack);
    const key = `${name}|${attack}|${typeof d?.kind === 'string' ? d.kind : ''}`;
    const detail = this._detail(name, d, attack);
    const top = this.events[0];
    if (top && top.key === key && now - top.t1 <= COLLAPSE) {
      top.n++;
      top.t1 = now;
      top.detail = detail;
      return;
    }
    this.events.unshift({ t: now, t1: now, name, label, detail, tell: d?.tell ? tellName(d.tell) : '', key, n: 1 });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  _detail(name, d, attack) {
    const tell = d?.tell ? tellName(d.tell) : '';
    switch (name) {
      case 'combat:tell':
        return `${tell} ${attack} in ${finite(d?.impactIn).toFixed(2)}s`;
      case 'combat:flash':
      case 'player:parry':
      case 'player:perfectDodge':
      case 'dragon:parried':
        return `${tell} ${attack}`.trim();
      case 'player:block':
        return `${tell} -${Math.round(finite(d?.damage))}`;
      case 'player:hurt':
        return `-${Math.round(finite(d?.damage))} ${typeof d?.kind === 'string' ? d.kind : ''} hp ${Math.round(finite(d?.hp))}`;
      case 'player:dodge':
        return typeof d?.kind === 'string' ? d.kind : '';
      case 'player:guardBreak':
        return attack;
      case 'player:ghostep':
        return `${finite(d?.x).toFixed(1)}, ${finite(d?.z).toFixed(1)}`;
      case 'combat:deflectChain':
        return `x${Math.round(finite(d?.count))}`;
      case 'dragon:phase':
        return `phase ${Math.round(finite(d?.n))}`;
      case 'dragon:plunged':
        return d?.execution ? 'execution' : '';
      default:
        return '';
    }
  }
}
