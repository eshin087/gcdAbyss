import { ASH_RIPOSTE } from './ashRiposte.js';

// Techniques (ADR-054; contract: docs/ARCHITECTURE.md → "Techniques"; numbers: docs/COMBAT.md →
// "Techniques"). The boss rush's fixed rewards: each boss teaches one, and it changes how the hero
// fights. A technique is DATA (its own file: timings, damage, the meter cost); its behaviour is a
// `kind` that player.js runs (today: 'counter', the Ash Riposte). The hero has SLOT_COUNT slots,
// fired by SLOT_KEYS (touch: one button per filled slot), all paid from one Qi meter.

export const SLOT_COUNT = 2;
/** KeyboardEvent codes that fire slot 1, slot 2 (touch.js feeds the same codes). */
export const SLOT_KEYS = Object.freeze(['KeyQ', 'KeyR']);
export const SLOT_LABELS = Object.freeze(['Q', 'R']);

/**
 * The Qi meter: filled by defence — parries (blue blows more, a deflect chain adds a bonus), perfect
 * dodges a big chunk — and a little by strikes that land; a technique spends its `cost` when it
 * starts. Resting at the bonfire keeps it; death and every retry empty it.
 */
export const QI = Object.freeze({
  max: 100,
  parry: Object.freeze({ normal: 20, blue: 30 }),
  parryLight: 3, // a deflected bullet / sword qi
  chainBonus: 5, // per parry beyond the first in a deflect chain (player.deflect.n) ...
  chainBonusMax: 15, // ... capped
  perfectDodge: 40, // every perfect dodge: the plunge, the Ghostep, the slow-mo in place
  hit: Object.freeze({ light: 3, heavy: 6 }), // a strike that deals damage (not a technique's own)
});

export const TECHNIQUES = Object.freeze({ [ASH_RIPOSTE.id]: ASH_RIPOSTE });
export const TECHNIQUE_IDS = Object.freeze(Object.keys(TECHNIQUES));

/** The technique with this id, or null. */
export function getTechnique(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TECHNIQUES, id) ? TECHNIQUES[id] : null;
}

/** Qi for one parry: `tell` 'normal' / 'blue', `chain` = the hero's deflect count (1 = single),
 *  `light` = a deflected bullet. */
export function qiForParry(tell, chain = 1, light = false) {
  if (light) return QI.parryLight;
  const base = tell === 'blue' ? QI.parry.blue : QI.parry.normal;
  const n = Number.isFinite(chain) ? Math.max(1, chain) : 1;
  return base + Math.min(QI.chainBonusMax, QI.chainBonus * (n - 1));
}
