import { loadSave, writeSave } from '../../../game/save.js';
import { SLOT_COUNT, TECHNIQUE_IDS, getTechnique } from './index.js';

// The hero's technique book (player.techniques): which techniques are learned and which sit in the
// slots, kept in the save (game/save.js, section `techniques`: { learned: [id], slots: [id|null] }).
// Beating a level's boss teaches its reward: on 'game:victory' the level's `reward.technique`
// (levels/index.js) is learned and, the first time, put in the first empty slot.
// Events: 'technique:learned' {id, slot, first} and 'technique:equip' {slot, id, slots}.

export class TechniqueBook {
  constructor(game) {
    this.game = game;
    this.learned = new Set();
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.saved = false; // the last change reached storage (false: kept in memory only)
    this._load();
    game?.events?.on?.('game:victory', () => this._reward());
  }

  /** Is `id` learned? */
  has(id) {
    return this.learned.has(id);
  }

  /** Learned ids, in registry order. */
  list() {
    return TECHNIQUE_IDS.filter((id) => this.learned.has(id));
  }

  /** The slot `id` sits in, or -1. */
  slotOf(id) {
    return id == null ? -1 : this.slots.indexOf(id);
  }

  /** Any technique in a slot? */
  get equippedAny() {
    return this.slots.some((s) => s !== null);
  }

  /** The technique definition in slot `i`, or null. */
  inSlot(i) {
    return getTechnique(this.slots[i] ?? null);
  }

  /**
   * Learn `id`. The first time it also goes into the first empty slot (if it is not in one).
   * Returns { id, slot, first } (slot -1: both slots were full), or null for an unknown id.
   */
  learn(id) {
    if (!getTechnique(id)) return null;
    const first = !this.learned.has(id);
    if (first) {
      this.learned.add(id);
      if (this.slotOf(id) < 0) {
        const empty = this.slots.indexOf(null);
        if (empty >= 0) this.slots[empty] = id;
      }
      this._save();
    }
    const r = { id, slot: this.slotOf(id), first };
    this._emit('technique:learned', r);
    if (first) this._emit('technique:equip', { slot: r.slot, id, slots: this.slots.slice() });
    return r;
  }

  /**
   * Put a learned technique (or null: empty it) in slot `i`. A technique already in the other slot
   * swaps places with what slot `i` held. Returns false (nothing changes) for a bad slot, an unknown
   * or unlearned id.
   */
  equip(i, id) {
    if (!Number.isInteger(i) || i < 0 || i >= SLOT_COUNT) return false;
    id = id ?? null;
    if (id !== null && (!getTechnique(id) || !this.learned.has(id))) return false;
    const was = this.slotOf(id);
    if (id !== null && was === i) return true;
    if (id !== null && was >= 0) this.slots[was] = this.slots[i];
    this.slots[i] = id;
    this._save();
    this._emit('technique:equip', { slot: i, id, slots: this.slots.slice() });
    return true;
  }

  /** Lab: learn every technique (each into a free slot). */
  learnAll() {
    for (const id of TECHNIQUE_IDS) this.learn(id);
  }

  /** Lab: forget everything (the save's technique section is cleared too). */
  forget() {
    this.learned.clear();
    this.slots.fill(null);
    this._save();
    this._emit('technique:equip', { slot: -1, id: null, slots: this.slots.slice() });
  }

  // ---------------------------------------------------------------- internals
  /** On a victory: learn the level's reward. */
  _reward() {
    const id = this.game?.level?.reward?.technique;
    if (id) this.learn(id);
  }

  _load() {
    const T = loadSave().techniques;
    if (!T || typeof T !== 'object') return;
    if (Array.isArray(T.learned)) for (const id of T.learned) if (getTechnique(id)) this.learned.add(id);
    if (Array.isArray(T.slots)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const id = T.slots[i];
        if (typeof id === 'string' && this.learned.has(id) && this.slotOf(id) < 0) this.slots[i] = id;
      }
    }
  }

  _save() {
    this.saved = writeSave({ techniques: { learned: this.list(), slots: this.slots.slice() } });
  }

  _emit(name, data) {
    try {
      this.game?.events?.emit?.(name, data);
    } catch (err) {
      console.error(`[techniques] ${name} listener failed`, err);
    }
  }
}
