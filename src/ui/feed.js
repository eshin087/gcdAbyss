import { num } from './dom.js';

// Turns gameplay events into log lines without spamming. Player hits are batched per frame
// (flushed from hud.update) so a hit that raises both 'player:hitDragon' and 'dragon:hurt' is
// logged once; hurts / dodges / blocks are also resolved at flush time so one blow logs one line
// (a blocked hit's chip damage is not logged twice; a perfect dodge is not also "You dodged").
// Flow-level messages (rest, retry, quality, ...) are logged by GameFlow itself. Attack tells are
// never logged: they are read from the attacker in the world (docs/COMBAT.md).

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
const BLOCK_WINDOW = 0.8; // s: blocks inside this window are summed into one line

function pick(list, kind, fallback) {
  const k = String(kind ?? '').toLowerCase();
  if (!k) return fallback;
  for (const [key, text] of list) if (k.includes(key)) return text;
  return fallback;
}

/** Attack name from an event field (string or attack definition object). */
function attackName(a) {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') return String(a.name ?? a.id ?? a.label ?? '');
  return '';
}

export class CombatFeed {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.lastAt = new Map();
    this.hits = [];
    this.hurts = [];
    this.hurtLines = []; // { damage, kind }, resolved at flush
    this.dodges = []; // kinds, resolved at flush
    this.blockDmg = []; // chip damage of the blocks seen this frame
    this.block = { n: 0, chip: 0, t: 0 };
    this.perfectAt = -10;
    this.streams = STREAMS.map(([kind, label]) => ({ kind, label, sum: 0, t: 0 }));
    const on = (name, fn) => game.events?.on(name, (d) => fn(d && typeof d === 'object' ? d : {}));
    const log = (text, ch, key, gap) => this._log(text, ch, key, gap);
    const now = () => num(this.game.realTime);

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
      this.hurtLines.push({ damage: dmg, kind });
    });
    on('player:dodge', (d) => this.dodges.push(d.kind));
    on('player:block', (d) => {
      const chip = Math.max(0, Math.round(num(d.damage)));
      this.blockDmg.push(chip);
      const b = this.block;
      if (b.t <= 0) b.t = BLOCK_WINDOW;
      b.n++;
      b.chip += chip;
    });
    on('player:parry', (d) => {
      const what = pick(DODGE_TEXT, attackName(d.attack), 'the blow');
      log(d.tell === 'blue' ? `Deflected ${what}!` : `Parried ${what}!`, 'combat', 'parry', 0.2);
    });
    on('player:perfectDodge', (d) => {
      this.perfectAt = now();
      const what = pick(DODGE_TEXT, attackName(d.attack), 'the attack');
      log(`Ghostep: you slip past ${what}. Strike now!`, 'combat', 'ghostep', 0.8);
    });
    on('player:ghostep', () => {
      // only when no perfectDodge announced it (the two normally arrive together)
      if (now() - this.perfectAt > 0.5) {
        this.perfectAt = now();
        log('Ghostep: strike now!', 'combat', 'ghostep', 0.8);
      }
    });
    on('player:guardBreak', () => log('Your guard is broken!', 'warn', 'guardBreak', 1));
    on('player:heal', (d) => {
      const amt = Math.round(num(d.amount));
      const left = Math.max(0, Math.round(num(d.flasks, num(game.player?.flasks))));
      log(`Flask restored ${amt} HP (${left} left)`, 'combat');
    });
    on('player:noFlask', () => log('Your flask is empty.', 'warn', 'noFlask', 1.5));
    on('player:died', () => log('You died.', 'warn'));

    // dragon
    on('dragon:hurt', (d) => this.hurts.push({ damage: d.damage, part: d.part, crit: !!d.crit, heavy: false }));
    on('dragon:wake', () => log('The wyrm stirs…', 'warn', 'wake', 5));
    on('dragon:roar', () => log(`${this._name()} roars!`, 'combat', 'roar', 6));
    on('dragon:introDone', () => log(`${this._name()}, the Cinder Wyrm, bars your path.`, 'warn', 'intro', 5));
    on('dragon:breathStart', () => log(`${this._name()} breathes fire!`, 'combat', 'breath', 4));
    on('dragon:takeoff', () => log(`${this._name()} takes to the sky!`, 'combat', 'takeoff', 4));
    on('dragon:stagger', () => log(`${this._name()} staggers!`, 'warn', 'stagger', 1));
    on('dragon:postureBreak', () => log(`${this._name()}'s posture breaks! Critical hits land now.`, 'warn', 'postureBreak', 2));
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

    // hurts: a blow that was blocked this frame is already counted as chip in the block line
    for (const h of this.hurtLines) {
      const i = this.blockDmg.findIndex((c) => Math.abs(c - h.damage) <= 1);
      if (i >= 0) {
        this.blockDmg.splice(i, 1);
        continue;
      }
      const label = pick(HURT_TEXT, h.kind, null);
      this.hud.log(label ? `${label} for ${h.damage}` : `Took ${h.damage} damage`, 'combat');
    }
    this.hurtLines.length = 0;
    this.blockDmg.length = 0;

    // dodges: a perfect dodge (Ghostep) has its own line
    if (this.dodges.length) {
      if (num(this.game.realTime) - this.perfectAt > 0.5) {
        this.hud.log(`You dodged ${pick(DODGE_TEXT, this.dodges[0], 'the attack')}.`, 'combat');
      }
      this.dodges.length = 0;
    }

    const b = this.block;
    if (b.t > 0) {
      b.t -= dt;
      if (b.t <= 0 && b.n > 0) {
        const what = b.n > 1 ? `${b.n} blows` : 'a blow';
        this.hud.log(b.chip > 0 ? `Blocked ${what} (took ${b.chip})` : `Blocked ${what}`, 'combat');
        b.n = 0;
        b.chip = 0;
      }
    }

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
