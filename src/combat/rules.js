// Shared combat rules (Phantom-Blade-Zero-inspired, RPG-friendly — no stamina).
// Every attacker (dragon today, mobs later) describes its hits with these tells; every defender
// (the player today) resolves them with these windows. Numbers here are the single source of truth.
// Design + rationale: docs/COMBAT.md.

/** How an attack must be answered. Shown to the player as a coloured tell before impact. */
export const TELL = Object.freeze({
  NORMAL: 'normal', // white glint: block, parry or dodge — any defence works
  BLUE: 'blue', // blue flash: a heavy blow you should PARRY (block works but chips hard)
  RED: 'red', // red flash: cannot be blocked or parried — PERFECT DODGE it (Ghostep)
});

/** Resolution of a hit from the defender's point of view (returned by takeHit). */
export const RESULT = Object.freeze({
  HIT: 'hit',
  BLOCKED: 'blocked',
  PARRIED: 'parried',
  DODGED: 'dodged', // i-frames, not perfectly timed
  PERFECT: 'perfectDodge', // dodge started within the perfect window → Ghostep
  IGNORED: 'ignored',
});

/** Presentation for each tell (HUD, FX and audio all read this). Colours are linear HDR. */
export const TELL_STYLE = Object.freeze({
  normal: { color: [1.6, 1.5, 1.3], css: '#f2ead8', glyph: '+', label: '' },
  blue: { color: [0.45, 1.1, 3.2], css: '#5fb4ff', glyph: '◆', label: 'PARRY' },
  red: { color: [3.4, 0.35, 0.2], css: '#ff4a3a', glyph: '!', label: 'DODGE' },
});

export const DEFENSE = Object.freeze({
  // --- parry: tap RMB shortly before impact
  parryWindow: 0.22, // s between the RMB press and the impact
  parryRearm: 0.25, // s RMB must be released before a new press can parry again (anti-mash)
  parryArc: (110 * Math.PI) / 180, // the attacker must be within this cone in front of the defender
  // --- block: hold RMB
  blockArc: (130 * Math.PI) / 180,
  blockReduction: { normal: 0.8, blue: 0.5 }, // fraction of damage removed while blocking
  blockMoveSpeed: 0.45, // movement multiplier while holding block
  blockPushback: { normal: 0.6, blue: 1.6 }, // meters slid back on a blocked hit
  // --- dodge: Space
  perfectDodgeWindow: 0.2, // s between the dodge start and the impact for a perfect dodge
  // --- Ghostep: reward for a perfect dodge (any tell) — teleport behind the attacker
  ghostep: { distanceBehind: 3.2, slowmoScale: 0.3, slowmoTime: 0.6, critWindow: 1.6, critMult: 1.8 },
});

/** Attacker posture (enemy "break" meter, shown under the boss HP bar). */
export const POSTURE = Object.freeze({
  parry: { normal: 26, blue: 48 }, // posture damage dealt to the attacker by a parry
  hit: { light: 5, heavy: 16 }, // posture damage dealt by the player's weapon hits
  regenDelay: 3.0, // s without posture damage before it starts recovering
  regenRate: 14, // posture/s
  breakTime: 3.2, // s the attacker stays broken (open to crits)
  breakCritMult: 2.2,
});

/** Default defensive properties for a tell; attacks may override (e.g. a fire stream is not parryable). */
export function tellDefaults(tell) {
  switch (tell) {
    case TELL.RED:
      return { parryable: false, blockable: false };
    case TELL.BLUE:
      return { parryable: true, blockable: true };
    default:
      return { parryable: true, blockable: true };
  }
}

/** Shortest absolute angle between a defender's facing (yaw) and the direction to a point. */
export function facingDelta(yaw, fromX, fromZ, toX, toZ) {
  const want = Math.atan2(toX - fromX, toZ - fromZ);
  let d = (want - yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
