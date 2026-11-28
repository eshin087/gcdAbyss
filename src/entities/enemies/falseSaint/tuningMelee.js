// The False Saint's ground game's numbers (the MELEE AGENT's file: the open-hand strings, the sweep and
// knee, the grab, the long walk, the counters, the phase-1 flurry, the plated arm's strings). Read as
// TUNING.melee (tuning.js merges it). The shared numbers (chain, idleGap, pressure, the phase scales) stay
// in tuning.js. Times in seconds, phase 1's (TUNING.windupScale [1, 0.94, 0.88, 0.84] tightens the later
// phases). COMBAT.md's floors (the lead's correction of the BRIEF): every move's FIRST windup >= 0.7 s in
// phase 1 (a string's first hit, a counter, the flurry included); a string's next hit >= 0.45 s after the
// last in every phase (a follow-up windup >= 0.5 here: 0.09 active + 0.5 x 0.84 = 0.51 s in phase 4); the cue
// 0.35 s before the impact (TUNING.flashLead, core's / boost's). Distances
// in metres, damage before TUNING.damageScale (1.6). Per-beat values are [beat 1, beat 2, ...]. Every
// field the moves read is named here.
export const TUNING_MELEE = {
  // ---- FOLLOW: how far a string's later beat may step in after the last one slid the hero away
  follow: { close: 3.6 },
  // ---- HIS BLOWS ON THE WORLD (FsMelee._world: every beat of this file, at the striking limb's REAL height;
  // the engine's own blow at y 1 is off for them, `noWorld`). power = damage / DUEL_WORLD.per (40) x `k`
  // (x DUEL_WORLD.red for a red blow): he is the strongest hand in the game
  world: { k: 1.5 },
  // ---- the hero thrown through what stands behind him (player.js crash, `wjCrash`): `damage` per piece met
  crash: { damage: 5 },
  // ---- BENEDICTION: the lead palm; the advancing right palm (`step` m of root: the pack's B1); then the
  // delayed quarter turn (held, with a bait hold of `hold` s: his rhythm, a delay then a long reach) and the
  // left palm's long lunge (`lunge` m of root: B2), the heel plant (recovery). The last throws the hero
  // `knockback` m through the scenery (`crash`: its power).
  benediction: { windup: [0.72, 0.5, 0.62], hold: [0.04, 0.22], damage: [14, 14, 22], knockback: [2.2, 2.6, 6.5], blockPush: 3.4, step: 0.35, lunge: 0.45, crash: 2.2 },
  // ---- GENUFLECT: the low sweep at the ankles (a scuff on the plates), the rising knee (blue)
  genuflect: { windup: [0.72, 0.52], damage: [12, 20], knockback: [2.2, 4.5] },
  // ---- LAYING ON OF HANDS (the red grab): the reach (`windup`, a line `reach` m, `close` m of step-in);
  // caught: `catch` damage, held (player.hold) while he lifts the hero `lift` m (the lift move's
  // `liftWindup`), then thrown at the nearest standing piece within `seek` m (one the throw breaks counts `tough` m nearer
  // than one it cannot; knockback its distance +
  // `over`, `kbMin` .. `kbMax`), `throwDamage`, through the world at `crash` power; the piece he reaches takes the `slam`. Never the last HP.
  // `cap`: the hero's whole loss of control (the hold + the knockdown), s at most (Halcyon's carry: 1.6).
  layHands: { windup: 0.76, reach: 1.9, close: 2.4, catch: 6, lift: 0.5, liftWindup: 0.62, throwDamage: 22, seek: 9, over: 1.4, kbMin: 4, kbMax: 10, crash: 3.0, slam: 4, tough: 4, cap: 1.9, hold: 0.9 },
  // ---- THE LONG WALK: one beat; the walk is its windup (`windup` s, fixed: unhurried in every phase,
  // `close` m of walking), light cuts do not stop it, heavy ones do; then ONE straight. A straight that is
  // not parried carries on into the scenery: a sweep `carry` m on along its line, `carryW` m half-wide, at
  // `power` (it bites deep), at the palm's height.
  longWalk: { windup: 1.9, cock: 0.86, close: 7.5, damage: 26, knockback: 5, blockPush: 3.6, crash: 2.4, carry: 9, carryW: 0.55, power: 2.4 },
  // ---- THE COUNTERS (out of his guard, one per phase): Rebuke (P1) a slip and a short elbow; Penance
  // (P2) the rising hand-heel; Anathema (P3) the elbow into the double palm; Requiem (P4) the elbow into
  // the gavel. Rebuke's slip: `slip` m to his left through the windup's draw (the owner's pack B3: a lateral
  // evasive step, then the elbow)
  rebuke: { windup: 0.72, damage: 18, knockback: 3.5, slip: 0.6 },
  penance: { windup: 0.72, damage: 20, knockback: 4.5 },
  anathema: { windup: [0.72, 0.5], damage: [14, 20], knockback: [2.2, 7], crash: 2.4 },
  requiem: { windup: [0.72, 0.6], damage: [14, 28], knockback: [2.2, 4.5] },
  // ---- LITANY (his phase-1 flurry): quick alternating palms (normal)
  litany: { windup: [0.72, 0.5], damage: 12, knockback: 1.8, blows: 5 },
  // ---- INTERDICT (P2+): the lead palm, then the plated arm brought down like a gavel (red): a crater
  // `crater.r` m `fwd` m before him (world.impact at `crater.power`) and a slam on the plates
  interdict: { windup: [0.72, 0.72], damage: [14, 30], knockback: [2.2, 4.5], ring: 2.4, fwd: 0.9, crater: { r: 2.6, power: 2.2 } },
  // ---- CAST OUT (P2+): the double palm (blue) that shoves through cover: the palms break what stands
  // between him and the hero (a sweep `shove.len` m ahead), the hero thrown `knockback` m through the world
  castOut: { windup: 0.76, damage: 16, knockback: 8, blockPush: 5.2, guardCost: 40, crash: 2.8, lunge: 0.45, shove: { len: 4.2, w: 0.7, power: 2.6 } },
  // ---- LAUDS (P3+): a low kick at the knee (normal), the overhand hand-heel (blue)
  lauds: { windup: [0.72, 0.58], damage: [14, 24], knockback: [1.8, 5] },
};
