// Shared combat rules (Phantom-Blade-Zero-inspired, RPG-friendly — no stamina).
// Every attacker (dragon today, mobs later) describes its hits with these tells; every defender
// (the player today) resolves them with these windows. Numbers here are the single source of truth.
// Design + rationale: docs/COMBAT.md.

/**
 * How an attack must be answered. Read from the attacker itself (no HUD text or icons): parryable
 * hits are read from the windup animation and glint white on the timing cue; dodge-only hits make
 * the attacker glow red through the windup and flash red on the cue. See docs/COMBAT.md.
 */
export const TELL = Object.freeze({
  NORMAL: 'normal', // white glint: block, parry or dodge — any defence works
  BLUE: 'blue', // big white glint: a heavy blow you should PARRY (block works but chips hard)
  RED: 'red', // red warning glow + flash: cannot be blocked or parried — PERFECT DODGE it (Ghostep)
});

/** Resolution of a hit from the defender's point of view (returned by takeHit). */
export const RESULT = Object.freeze({
  HIT: 'hit',
  BLOCKED: 'blocked',
  PARRIED: 'parried',
  DODGED: 'dodged', // i-frames, not perfectly timed
  PERFECT: 'perfectDodge', // dodge started within the perfect window → plunge / Ghostep
  IGNORED: 'ignored',
});

/**
 * Presentation for each tell. World side (linear HDR): `color` = the in-world timing flash —
 * white for the parryable tells (blue is the same white, only `glint`x larger and brighter), red
 * for dodge-only; `red.warn` = the attacker's red windup glow (creature material uniform uWarn:
 * strength ramps `from` → `to` between combat:tell and combat:flash, spikes to `spike` on the
 * flash, decays to 0 in `decay` s). `css` = the dev / UI colour (Lab chips, HUD red edge flash,
 * success call-outs); the HUD shows no per-tell colour coding during a windup.
 */
export const TELL_STYLE = Object.freeze({
  normal: { color: [3.2, 3.05, 2.8], glint: 1, css: '#f2ead8' },
  blue: { color: [3.2, 3.05, 2.8], glint: 1.5, css: '#5fb4ff' },
  red: {
    color: [3.4, 0.35, 0.2],
    glint: 1,
    css: '#ff4a3a',
    warn: { color: [1.0, 0.12, 0.05], from: 0.1, to: 0.38, spike: 1.6, decay: 0.25 },
  },
});

export const DEFENSE = Object.freeze({
  // --- parry: tap RMB shortly before impact
  parryWindow: 0.22, // s between the RMB press and the impact
  // a parry pressed this close before the impact is PERFECT (player:parry.perfect). Today only
  // bullets use it: a perfectly parried ember / wisp flies back as a damaging shot (ADR-051)
  perfectParryWindow: 0.08,
  parryRearm: 0.25, // s RMB must be released before a new press can parry again (anti-mash)
  parryArc: (110 * Math.PI) / 180, // the attacker must be within this cone in front of the defender
  // --- block: hold RMB
  blockArc: (130 * Math.PI) / 180,
  blockReduction: { normal: 0.8, blue: 0.5 }, // fraction of damage removed while blocking
  blockMoveSpeed: 0.45, // movement multiplier while holding block
  blockPushback: { normal: 0.6, blue: 1.6 }, // meters slid back on a blocked hit
  // --- dodge: Space
  perfectDodgeWindow: 0.2, // s between the dodge start and the impact for a perfect dodge
  // --- Ghostep: reward for a perfect dodge (any tell): slow-mo + the crit window. Against an attacker
  // that offers a plunge (plungePoint / onPlunge: the wyrm) it becomes the plunge below; against any
  // other attacker within its range it blinks `distanceBehind` m behind it (the v0.2 Ghostep)
  ghostep: { distanceBehind: 3.2, slowmoScale: 0.3, slowmoTime: 0.6, critWindow: 1.6, critMult: 1.8 },
  // --- the plunge (contract 2): a perfect dodge of a plungeable attacker within `range` m (the hit
  // may forbid it: takeHit `plunge: false`) → vanish, reappear `appearUp` m above its head
  // (`appearBack` m out toward the landing side), hang, dive, a reverse-grip stab into the head
  // (attacker.onPlunge once: `damage`, `posture`), ride the head down, backflip off to a landing in
  // front of it, toward where the hero came from; the crit window opens on landing. While the
  // attacker is posture-broken, attack within `execRange` m of its head starts the same move from
  // the appear step as an execution (`execDamage`, no slow-mo). Times: game seconds (the vanish +
  // hang run inside the slow-mo); `flip` = [base, max] (longer from higher up). Lengths: m.
  plunge: {
    range: 30, execRange: 9, damage: 90, posture: 40, execDamage: 260,
    vanish: 0.05, hang: 0.13, dive: 0.14, ride: 0.42, flip: [0.5, 0.85], land: 0.34, landCancel: 0.12,
    // (the 58° camera sees height at half scale: 5 m up puts him clearly above the head on screen)
    appearUp: 5, appearBack: 0.3, rideBack: 0.3, flipUp: 1.7,
    landMin: 4.5, landMax: 12, landClear: 0.8, // landing distance from the head; margin past the body
    impactStop: 0.13, impactShake: 0.6, execShake: 0.75, landIframes: 0.2,
  },
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
