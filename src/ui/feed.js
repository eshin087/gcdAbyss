import { num } from './dom.js';

// Turns gameplay events into log lines. Player hits are batched per frame (flushed from
// hud.update) so a hit that raises both 'player:hitDragon' and 'dragon:hurt' is logged once.
// Flow-level messages (rest, retry, quality, ...) are logged by GameFlow itself.

const HURT_TEXT = [
  ['bite', 'Bitten'],
  ['claw', 'Clawed'],
  ['swipe', 'Clawed'],
  ['tail', 'Lashed by the tail'],
  ['stomp', 'Trampled'],
  ['slam', 'Crushed'],
  ['breath', 'Engulfed in flame'],
  ['fireball', 'Struck by a fireball'],
  ['explo', 'Caught in the blast'],
  ['blast', 'Caught in the blast'],
  ['wing', 'Battered by a wing'],
  ['charge', 'Rammed'],
  ['sweep', 'Swept aside'],
  ['dive', 'Struck by the dive'],
  ['land', 'Crushed by the landing'],
  ['roar', 'Shaken by the roar'],
  ['fire', 'Scorched'],
];
const DODGE_TEXT = [
  ['bite', 'the bite'],
  ['claw', 'the claw'],
  ['swipe', 'the claw'],
  ['tail', 'the tail'],
  ['stomp', 'the stomp'],
  ['slam', 'the slam'],
  ['breath', 'the flames'],
  ['fireball', 'the fireball'],
  ['explo', 'the blast'],
  ['blast', 'the blast'],
  ['wing', 'the wing'],
  ['charge', 'the charge'],
  ['sweep', 'the sweep'],
  ['dive', 'the dive'],
  ['roar', 'the roar'],
  ['fire', 'the flames'],
];
// damage streams summed into one log line per second: burn DoT (every 0.5 s) and breath contact
// ticks (dragon kind 'fire', every 0.15 s)
const STREAMS = [
  ['burn', 'Burning for'],
  ['fire', 'Engulfed in flame for'],
];

function pick(list, kind, fallback) {
  const k = String(kind ?? '').toLowerCase();
  if (!k) return fallback;
  for (const [key, text] of list) if (k.includes(key)) return text;
  return fallback;
}

export class CombatFeed {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.lastAt = new Map();
    this.hits = [];
    this.hurts = [];
    this.streams = STREAMS.map(([kind, label]) => ({ kind, label, sum: 0, t: 0 }));
    const on = (name, fn) => game.events?.on(name, (d) => fn(d && typeof d === 'object' ? d : {}));
    const log = (text, ch, key, gap) => this._log(text, ch, key, gap);

    // player
    on('player:hitDragon', (d) => this.hits.push({ damage: d.damage, part: d.part, crit: !!d.crit, heavy: !!d.heavy }));
    on('player:hurt', (d) => {
      const dmg = Math.round(num(d.damage));
      if (dmg <= 0) return;
      const kind = String(d.kind ?? '').toLowerCase();
      const stream = this.streams.find((s) => s.kind === kind);
      if (stream) {
        stream.sum += dmg;
        if (stream.t <= 0) stream.t = 1;
        return;
      }
      const label = pick(HURT_TEXT, kind, null);
      log(label ? `${label} for ${dmg}` : `Took ${dmg} damage`, 'combat');
    });
    on('player:dodge', (d) => log(`You dodged ${pick(DODGE_TEXT, d.kind, 'the attack')}.`, 'combat'));
    on('player:heal', (d) => {
      const amt = Math.round(num(d.amount));
      const left = Math.max(0, Math.round(num(d.flasks, num(game.player?.flasks))));
      log(`Flask restored ${amt} HP (${left} left)`, 'combat');
    });
    on('player:noFlask', () => log('Your flask is empty.', 'warn', 'noFlask', 1.5));
    on('player:noStamina', () => log('Too exhausted.', 'system', 'noStamina', 3));
    on('player:died', () => log('You died.', 'warn'));

    // dragon
    on('dragon:hurt', (d) => this.hurts.push({ damage: d.damage, part: d.part, crit: false, heavy: false }));
    on('dragon:wake', () => log('The wyrm stirs…', 'warn', 'wake', 5));
    on('dragon:roar', () => log(`${this._name()} roars!`, 'combat', 'roar', 6));
    on('dragon:introDone', () => log(`${this._name()}, the Cinder Wyrm, bars your path.`, 'warn', 'intro', 5));
    on('dragon:breathStart', () => log(`${this._name()} breathes fire!`, 'combat', 'breath', 4));
    on('dragon:takeoff', () => log(`${this._name()} takes to the sky!`, 'combat', 'takeoff', 4));
    on('dragon:stagger', () => log(`${this._name()} staggers!`, 'warn', 'stagger', 1));
    on('dragon:phase2', () => log("The Cinder Wyrm's fury ignites!", 'warn'));
    on('dragon:death', () => log(`${this._name()}, the Cinder Wyrm, falls.`, 'warn'));

    // flow
    on('area', (d) => log(`Entered ${d.name || 'Cinderwood Hollow'}.`, 'system'));
  }

  /** Short boss name for log lines ("Vaelgrim"). */
  _name() {
    const full = String(this.game.dragon?.name || 'Vaelgrim');
    const first = full.split(',')[0].trim().toLowerCase();
    return first ? first[0].toUpperCase() + first.slice(1) : 'Vaelgrim';
  }

  _log(text, channel, key = null, gap = 0) {
    if (key) {
      const now = num(this.game.realTime);
      const last = this.lastAt.get(key);
      if (last !== undefined && now - last < gap) return;
      this.lastAt.set(key, now);
    }
    this.hud.log(text, channel);
  }

  static hitText(h) {
    const dmg = Math.round(num(h.damage));
    if (dmg <= 0) return null;
    const part = h.part ? ` (${h.part})` : '';
    return `${h.crit ? 'Critical hit' : h.heavy ? 'Heavy hit' : 'Hit'} for ${dmg}${part}`;
  }

  /** Called once per frame from hud.update. */
  flush(dt) {
    const list = this.hits.length ? this.hits : this.hurts;
    for (const h of list) {
      const t = CombatFeed.hitText(h);
      if (t) this.hud.log(t, 'combat');
    }
    this.hits.length = 0;
    this.hurts.length = 0;
    for (const s of this.streams) {
      if (s.t <= 0) continue;
      s.t -= dt;
      if (s.t <= 0 && s.sum > 0) {
        this.hud.log(`${s.label} ${s.sum}`, 'combat');
        s.sum = 0;
      }
    }
  }
}
