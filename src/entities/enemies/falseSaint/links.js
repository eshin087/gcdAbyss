import { FILE_LINKS } from './moves.js';

// The False Saint's combo links (the MELEE AGENT's file; duelist/brain.js header, director.js linkFor:
// { from: [{ to, when, chance, force, band, cut }] }). When a move ends on its own, the first entry whose
// `when` holds (near < 3.3 m, mid < 6 m, far beyond: TUNING.pressure.near / far; front / side / behind;
// away: the hero backing off; guarding: his guard held; any), whose `chance` roll passes ([P1, P2, P3,
// P4]) and whose target is usable now (its phase, its weight in this phase, its cooldown, its band, the
// handlers' say, the reach of its first blow) starts straight out of it at `cut` of the recovery (default
// pressure.linkCut 0.5: the first half of every recovery stays the punish window). pressure.chainDepth
// ([3, 4, 5, 6]) moves in a row at most, then a breather (pressure.chainRest).
//
// THE WHOLE TABLE BY ID (BRIEF section 2; the moves of the other agents' files among them): a target that
// does not exist (yet) is passed over safely (linkUsable: no def → not usable; the chance was rolled, the
// next entry is tried). Each move file may add links of its own (its `LINKS`: moves.js FILE_LINKS); a
// file's own entries for a move come FIRST (its author's word), then this table's, the same (target, when) once.
//
// HOW HE CHAINS (the fastest duelist in the game, still fair):
//   - a hero he threw or who backed off is crossed to: the walk (P1), the booster punch (P2+), the dive
//     (P3+), the overclock passes (P4); or answered from where he stands: the eye laser, the palm cannon;
//   - close, a string goes on into ANOTHER string (never the same move twice: its cooldown), each phase its
//     own vocabulary: the palms and the sweep (P1), the gavel and the double palm (P2), the low kick and
//     the jet strings (P3);
//   - a held guard draws what beats a guard: the grab (red), the double palm and the gavel (they cost the
//     meter / are red);
//   - after the big ones (the cannon, the barrage, the full burst, the throw) a link is rarer, so the hero
//     who survived it gets his turn.
// The pursuits first (far / away), then guarding, then the ranges.

const far = (to, chance, o) => ({ to, when: 'far', chance, ...o });
const away = (to, chance, o) => ({ to, when: 'away', chance, ...o });
const mid = (to, chance, o) => ({ to, when: 'mid', chance, ...o });
const near = (to, chance, o) => ({ to, when: 'near', chance, ...o });
const guarding = (to, chance, o) => ({ to, when: 'guarding', chance, ...o });
const any = (to, chance, o) => ({ to, when: 'any', chance, ...o });

/** After a blow that THROWS the hero (a knockback of 4.5 - 10 m, a block push of 3.4 - 5.2): the plan is
 *  made as the recovery starts, while the hero is still sliding (3 - 4 m off), and the link starts at its
 *  cut (half the recovery later), when he has come to rest 6 - 9 m off. So these links are `any`: the gap
 *  closers whose band reaches both (the booster punch P2+, the dive P3+, the overclock P4, the walk). */
const THROWN = [
  any('votiveFist', [0, 0.5, 0.45, 0.4]),
  any('descent', [0, 0, 0.3, 0.3]),
  any('vespers', [0, 0, 0, 0.25]),
  any('longWalk', [0.6, 0.35, 0.25, 0.2]),
];

/** A hero far off or backing away: crossed to, or shot at (by phase: the walk; the booster punch; the dive;
 *  the overclock). */
const PURSUE = [
  away('votiveFist', [0, 0.5, 0.45, 0.4]),
  far('votiveFist', [0, 0.45, 0.4, 0.35]),
  far('descent', [0, 0, 0.35, 0.3]),
  far('vespers', [0, 0, 0, 0.3]),
  far('longWalk', [0.45, 0.25, 0.15, 0.1]),
  far('vigil', [0, 0.25, 0.2, 0.15]),
  far('triptych', [0, 0, 0.25, 0.2]),
];
/** Close, after a blow: the next string (each phase its own). */
const CLOSE = [
  guarding('layHands', [0.3, 0.25, 0.2, 0.2]),
  guarding('castOut', [0, 0.3, 0.25, 0.25]),
  near('interdict', [0, 0.3, 0.25, 0.2]),
  near('lauds', [0, 0, 0.3, 0.25]),
  near('censerWheel', [0, 0, 0.3, 0.3]),
  near('genuflect', [0.3, 0.2, 0.15, 0.1]),
  near('benediction', [0.3, 0.2, 0.15, 0.1]),
];
/** Mid range (the hero his last blow slid 3 - 6 m off): a jet in, a string that steps in after him (its
 *  first beat's close-in: TUNING.close.first 3.2 m), a gun. */
const MID = [
  mid('votiveFist', [0, 0.35, 0.3, 0.3]),
  mid('thurible', [0, 0, 0.3, 0.3]),
  mid('castOut', [0, 0.3, 0.25, 0.2]),
  mid('interdict', [0, 0.3, 0.25, 0.2]),
  mid('lauds', [0, 0, 0.25, 0.2]),
  mid('benediction', [0.4, 0.25, 0.2, 0.15]),
  mid('genuflect', [0.3, 0.2, 0.15, 0.1]),
  mid('relic', [0, 0, 0.2, 0.2]),
  mid('longWalk', [0.3, 0.15, 0, 0]),
];
/** (the tuning pass) A hero a string's last blow slid 3 - 6 m off (a block's push, a knockback) is followed
 *  by the next string on the run: planned while he still slides (`any`: near or mid), checked at its cut against
 *  where he has come to rest not by the target's band (`band: false`) but by its first blow's reach
 *  (pressure.pursue: the step-in, the dash): a string that cannot get there is passed over. Without these,
 *  phase 1 never linked (0 links a minute against the guarding bot: saint.mjs tunePace). */
const FOLLOW = [
  any('genuflect', [0.5, 0.25, 0.15, 0.1], { band: false }),
  any('benediction', [0.5, 0.25, 0.15, 0.1], { band: false }),
  any('interdict', [0, 0.35, 0.25, 0.2], { band: false }),
  any('lauds', [0, 0, 0.3, 0.25], { band: false }),
  any('thurible', [0, 0, 0.25, 0.25], { band: false }),
];
const without = (list, name) => list.filter((L) => L.to !== name);
/** The usual tail after a blow of move `name` (never into itself). */
const after = (name, pre = []) => [...pre, ...without(PURSUE, name), ...without(CLOSE, name), ...without(MID, name)];
/** ... after a blow that throws him: only what reaches where he will have come to rest (a near / mid link
 *  planned while he slides would fail at its cut, and it would have taken the place of the flow's roll),
 *  and the strings that follow him on the run (FOLLOW: checked by their reach, not their band). */
const thrown = (name, pre = []) => [...pre, ...without(THROWN, name), ...without(PURSUE, name), guarding('castOut', [0, 0.3, 0.25, 0.25]), ...without(FOLLOW, name)].filter((L) => L.to !== name);

const TABLE = {
  // ================================================================ the melee agent's moves
  benediction: thrown('benediction'),
  genuflect: thrown('genuflect'),
  // (a whiffed grab: no link, he stands open for the whole recovery; caught and thrown: the lift's links)
  layHands: [],
  // (the tuning pass: the throw knocks the hero down, so out of it only what takes long enough to come that he
  // is up and has read it, from the recovery's end: the walk, the eye laser, the ladle, the barrage. The fast
  // closers (the punch, the dive, the passes) came down on a hero still getting up: a grab, a throw into a
  // pool and the dive were 54 + 2 x 14 on one mortal bot in 2.4 s)
  layHandsLift: [far('longWalk', [0.6, 0.3, 0.15, 0], { cut: 1 }), far('vigil', [0, 0.3, 0.25, 0.2], { cut: 1 }), far('crucible', [0, 0, 0.25, 0.2], { cut: 1 }), far('kyrie', [0, 0, 0, 0.25], { cut: 1 })],
  longWalk: thrown('longWalk'),
  interdict: thrown('interdict'),
  castOut: [...THROWN, far('votiveFist', [0, 0.5, 0.45, 0.4]), far('longWalk', [0, 0.3, 0.15, 0.1]), far('absolution', [0, 0.2, 0.2, 0.15]), far('choir', [0, 0, 0.25, 0.2]), far('descent', [0, 0, 0.25, 0.25])],
  lauds: thrown('lauds'),
  // (the counters and the flurry: what follows them is decided as for any move that ended on its own)
  rebuke: [near('benediction', [0.3, 0, 0, 0]), far('longWalk', [0.3, 0, 0, 0])],
  penance: [near('interdict', [0, 0.3, 0, 0]), far('votiveFist', [0, 0.4, 0, 0])],
  anathema: [...without(THROWN, 'anathema'), far('descent', [0, 0, 0.35, 0]), far('votiveFist', [0, 0, 0.35, 0]), near('lauds', [0, 0, 0.3, 0])],
  requiem: [far('vespers', [0, 0, 0, 0.35]), far('votiveFist', [0, 0, 0, 0.35]), near('lauds', [0, 0, 0, 0.3])],
  litany: [near('genuflect', [0.3, 0.2, 0.2, 0.2]), far('longWalk', [0.3, 0.1, 0, 0]), far('votiveFist', [0, 0.35, 0.3, 0.3])],

  // ================================================================ the boost agent's
  votiveFist: after('votiveFist', [near('rosary', [0, 0.3, 0.3, 0.3]), near('castOut', [0, 0.2, 0.2, 0.2])]),
  rosary: after('rosary'),
  censerWheel: after('censerWheel', [near('lauds', [0, 0, 0.25, 0.25])]),
  thurible: after('thurible', [near('interdict', [0, 0, 0.25, 0.2])]),
  descent: [near('genuflect', [0, 0, 0.3, 0.25]), near('interdict', [0, 0, 0.3, 0.25]), far('votiveFist', [0, 0, 0.35, 0.3]), far('choir', [0, 0, 0.2, 0.2])],
  vespers: [near('lauds', [0, 0, 0, 0.25]), far('verdict', [0, 0, 0, 0.25])],
  lastRite: [],

  // ================================================================ the arsenal agent's
  vigil: [far('votiveFist', [0, 0.4, 0.35, 0.3]), far('longWalk', [0, 0.25, 0.1, 0]), near('interdict', [0, 0.3, 0.25, 0.2]), near('benediction', [0, 0.2, 0.15, 0.1])],
  absolution: [far('votiveFist', [0, 0.3, 0.25, 0.2]), near('castOut', [0, 0.25, 0.2, 0.15])],
  triptych: [far('votiveFist', [0, 0, 0.4, 0.35]), far('descent', [0, 0, 0.3, 0.25]), near('lauds', [0, 0, 0.3, 0.25])],
  choir: [far('votiveFist', [0, 0, 0.4, 0.35]), far('passingBell', [0, 0, 0.2, 0.15]), near('interdict', [0, 0, 0.25, 0.2])],
  passingBell: [far('choir', [0, 0, 0.25, 0.2]), near('censerWheel', [0, 0, 0.3, 0.25]), near('genuflect', [0, 0, 0.2, 0.15])],
  // (the phase-4 big ones: a link is rarer; the hero who lived through it gets his turn)
  kyrie: [far('votiveFist', [0, 0, 0, 0.3]), near('interdict', [0, 0, 0, 0.2])],
  verdict: [far('vespers', [0, 0, 0, 0.25]), near('lauds', [0, 0, 0, 0.2])],
  revelation: [],

  // ================================================================ the terrain agent's
  crucible: [far('vigil', [0, 0, 0.3, 0.25]), far('votiveFist', [0, 0, 0.3, 0.3]), near('castOut', [0, 0, 0.25, 0.2])],
  relic: [far('votiveFist', [0, 0, 0.35, 0.3]), near('benediction', [0, 0, 0.2, 0.15]), near('interdict', [0, 0, 0.2, 0.2])],
};

/** A file's own links for a move first, then the table's; the same (target, when) once. */
function merged() {
  const out = {};
  for (const name of new Set([...Object.keys(FILE_LINKS), ...Object.keys(TABLE)])) {
    const seen = new Set(), list = [];
    for (const L of [...(FILE_LINKS[name] ?? []), ...(TABLE[name] ?? [])]) {
      const key = `${L.to}|${L.when}`;
      if (!L?.to || seen.has(key)) continue;
      seen.add(key);
      list.push(Object.freeze({ ...L }));
    }
    out[name] = Object.freeze(list);
  }
  return out;
}

export const LINKS = Object.freeze(merged());
/** The table as written here (tests, the Lab). */
export const LINK_TABLE = TABLE;
