import { WANDERER_ITEMS } from './wanderer.js';
import { SHROUD_ITEMS } from './shroud.js';
import { BASE_ITEMS, BASE_LOADOUT } from './base.js';

// The hero's equipment, as data. A LOADOUT maps each slot to the id of the item worn there (or
// nothing); buildHero(U, loadout) in model.js builds the skeleton and the body, then lets each
// equipped item hang its meshes on the joints. gear/README.md: how to add an item and what the
// animator needs from one.

/** The equipment slots, in the order their items are built. */
export const SLOTS = Object.freeze(['head', 'chest', 'shoulders', 'arms', 'legs', 'waist', 'back', 'weapon']);

/** Every known item: id → { id, slot, name, build(ctx) } (+ `dims` on a weapon). */
export const GEAR = {};

/** Add an item to the registry (throws on a malformed item or a taken id). Returns the item. */
export function registerItem(item) {
  if (!item || typeof item.id !== 'string' || !item.id) throw new Error('gear item needs an id');
  if (!SLOTS.includes(item.slot)) throw new Error(`gear item "${item.id}" has no valid slot (got "${item.slot}"; slots: ${SLOTS.join(', ')})`);
  if (typeof item.build !== 'function') throw new Error(`gear item "${item.id}" needs a build(ctx) function`);
  if (Object.hasOwn(GEAR, item.id) && GEAR[item.id] !== item) throw new Error(`gear item id "${item.id}" is already registered`);
  GEAR[item.id] = item;
  return item;
}

/** The item registered under `id`, or null. */
export function getItem(id) {
  return typeof id === 'string' && Object.hasOwn(GEAR, id) ? GEAR[id] : null;
}

for (const item of [...WANDERER_ITEMS, ...SHROUD_ITEMS, ...BASE_ITEMS]) registerItem(item);

/** What the hero wears today: the Shrouded set (gear/shroud.js, ADR-043: a hood, a wrap tunic,
 *  bound sleeves and the tattered cloak) over the Wanderer's boots, coat tails and sword. No
 *  shoulder armour: the mantle carries the shoulders. */
export const DEFAULT_LOADOUT = Object.freeze({
  head: 'shroud.hood',
  chest: 'shroud.tunic',
  shoulders: null,
  arms: 'shroud.arms',
  legs: 'wanderer.legs',
  waist: 'wanderer.skirt',
  back: 'shroud.cloak',
  weapon: 'wanderer.sword',
});

/** The outfit before ADR-043: the Wanderer's greatcoat, pauldron and half-cape, bare-headed. */
export const WANDERER_LOADOUT = Object.freeze({
  head: null,
  chest: 'wanderer.coat',
  shoulders: 'wanderer.pauldron',
  arms: 'wanderer.arms',
  legs: 'wanderer.legs',
  waist: 'wanderer.skirt',
  back: 'wanderer.cape',
  weapon: 'wanderer.sword',
});

/** The slots that are never left bare: an empty one gets the plain undersuit (gear/base.js). */
export { BASE_LOADOUT };

/**
 * A loadout as the list buildHero walks: [{ slot, item }] in SLOTS order, `item` null for an empty
 * slot. An empty `chest`, `arms` or `legs` gets its BASE_LOADOUT item. Throws on an id that is not
 * registered or an item put in the wrong slot: a loadout is data, so a bad one is a bug to fix,
 * not something to draw around.
 */
export function resolveLoadout(loadout) {
  const L = loadout ?? {};
  return SLOTS.map((slot) => {
    const id = L[slot] ?? BASE_LOADOUT[slot] ?? null;
    if (id == null) return { slot, item: null };
    const item = getItem(id);
    if (!item) throw new Error(`loadout.${slot}: no gear item "${id}" is registered`);
    if (item.slot !== slot) throw new Error(`loadout.${slot}: "${id}" is a ${item.slot} item`);
    return { slot, item };
  });
}
