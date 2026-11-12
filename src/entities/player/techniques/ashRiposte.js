// The Ash Riposte: Shen Hui's counter, the Ash Disciple's reward (ADR-054; COMBAT.md "Techniques").
// A counter stance: the hero raises the blade forward at chest height (the disciple's own jian
// guard). A normal or blue blow that meets it is turned aside (the attacker is parried) and answered
// at once with a lightning thrust that pierces a guard; if nothing comes before the stance ends, he
// lunges anyway (a plain thrust). Red blows still need a dodge: the stance does not turn them.
// Every number lives here; player.js runs the `counter` kind.

/** A thrust strike as player.js's attack record wants it (`kind: 'thrust'` drives the animator's
 *  thrust pose and the root's lunge through the active frames). */
const strike = (o) => Object.freeze({ kind: 'thrust', combo: 1, heavy: true, lunge: 0, anim: Object.freeze({ kind: 'thrust' }), ...o });

export const ASH_RIPOSTE = Object.freeze({
  id: 'ashRiposte',
  name: 'Ash Riposte',
  short: 'RIPOSTE', // the touch button and the HUD slot chip
  icon: '‡', // HUD only (touch button, slot chip, equip panel): never fed to the world atlas
  from: 'Shen Hui, the Ash Disciple',
  level: 'ash', // the level whose boss teaches it (levels/index.js `reward`)
  kind: 'counter',
  cost: 100, // Qi spent when it starts (QI.max: a full meter)
  desc: 'A counter stance. A blow that meets it is turned aside and answered with a lightning thrust that pierces any guard. If nothing comes, you lunge anyway.',
  hint: 'Raise it as the blow comes. Red blows still need a dodge.',
  stance: Object.freeze({
    dur: 0.8, // s held; then the lunge
    open: 0.03, // s of the raise before it can turn a blow
    arc: (150 * Math.PI) / 180, // the front cone it covers (a parry's is 110°)
    rollAfter: 0.15, // s: a roll may cancel it from here (the Qi stays spent)
    turn: 10, // damp rate toward the aim (lock-on target / cursor) while it is held
    counterRange: 6, // m to the attacker's nearest hurt surface: a blow from farther (or a thrown one)
    //                 is turned aside and the stance holds
  }),
  // the answer to a blow met in the stance
  counter: strike({
    name: 'ashRiposte', windup: 0.05, active: 0.18, recovery: 0.42, reach: 2.3, hitstop: 0.14, shake: 0.42,
    damage: 140, poise: 50, posture: 80, pierce: true, // pierce: through a duelist's guard, and he staggers
    travel: [0.4, 3.6], // m: it lunges to stop ~1.4 m short of the attacker's surface, within this
    stopShort: 1.4,
    iframes: 0.45, // s from the turn: a string's next blow passes through the counter
    assist: true, // a counter that the blade's sweep misses still lands on a target in reach (a hurt sphere
    //               within reach + 0.4 m along the facing, at mid-active)
  }),
  // nothing came: the stance ends in a plain lunge along the aim
  lunge: strike({
    name: 'ashLunge', windup: 0.08, active: 0.2, recovery: 0.45, reach: 2.3, hitstop: 0.1, shake: 0.3,
    damage: 70, poise: 30, posture: 24, pierce: false, travel: 2.6, iframes: 0, assist: false,
  }),
});
