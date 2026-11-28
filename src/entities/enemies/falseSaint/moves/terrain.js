import { FsTerrain } from '../terrain.js';
import { TUNING_TERRAIN } from '../tuningTerrain.js';

// The False Saint's terrain moves as move data (the TERRAIN AGENT's file; moves.js is the router: its
// header has the format, moves/melee.js the exports). The foundry as his weapon. What each does once
// started, and every number of the pieces: the handler ../terrain.js (FsTerrain) and ../tuningTerrain.js
// (TUNING.terrain); the poses ../posesTerrain.js (`tr` fragments laid over his guard here).
//
// THE MOVES (BRIEF table rows 17, 18; the last three are the terrain agent's, one per phase from 2):
//   offertory    Offertory    P2+  red   he jets to a gas tank and KICKS it low at the hero: where it lands it
//                                        bursts (the set's tank blast). The flare on the tank, nothing on the
//                                        ground (a thrown piece: COMBAT.md, the owner's rule).
//   crucible     Crucible     P3+  red   a full ladle near the hero: his forearm gun on its chain (the red
//                                        sight line), the pools' marks on the floor where the steel will land
//                                        (under the ladle; and a splash where the hero stood), the shot, the
//                                        pour, the pools (cued as they land, burning `arm` s later). The
//                                        pools burn him too (the level's trick).
//   relic        Relic        P3+  blue  he jets to a girder, an ingot stack or one of his unfinished brothers
//                                        off the line, tears it up, hoists it and throws it (the flare on the
//                                        piece). Parried, it breaks on the blade in front of the hero.
//   prostration  Prostration  P3+  red   his eye's laser cuts the foot of a column of the hall near the hero
//                                        and it comes down across the floor on him (the world's strip:
//                                        marked from the moment it goes, flashed, 22 x its weight).
//   diesIrae     Dies Irae    P4   red   his forearm gun into the press's ram: the press slams, and a shock runs
//                                        out across the whole floor (the flare on its front where it meets the
//                                        hero; every piece it passes struck, the plates cracked).
//
// THE BEAT FIELDS this file's handler owns (FIELDS; saint.js routes every beat carrying one to it; grepped
// against every boss's move data: none in use):
//   fsRelic:  'fetch' | 'throw' | 'kick'   the fetch (a feint: the jet hop to the piece, the tear) / the
//                                           throw (Relic, blue) / the kick (Offertory, red)
//   fsLadle:  'shot'                       Crucible's shot at the chain
//   fsPillar: 'cut'                        Prostration's cut at the column's foot
//   fsPress:  'shot'                       Dies Irae's shot at the press
// Every real beat is a `cast` with `selfCue`: what it sends carries its own cue (the flare ON the piece, the
// mark where it falls, the flash on the front), flashLead before it reaches the hero; the brain sends none for
// the beat (its windup's announcement still goes out). Every windup is `fixed` (unscaled by phase) and at
// least COMBAT.md's 0.7 s; a move whose piece is gone is refused (FsTerrain.onActStart → false) and weighed 0.
export const FIELDS = Object.freeze(['fsLadle', 'fsRelic', 'fsPillar', 'fsPress']);
export const create = (d) => new FsTerrain(d);

const T = TUNING_TERRAIN;
const clampHead = (v) => Math.max(-1.1, Math.min(1.1, v));

export function moves(X) {
  const { TELL, FRAGS: FR } = X;
  const { B, R } = TELL;
  const STAND = FR.STAND ?? {};
  /** A whole pose: his guard, then the fragment; the head turned back onto the hero unless it turns it. */
  const P = (frag, extra = null) => {
    const q = extra ? { ...frag, ...extra } : frag;
    const out = { ...STAND, ...q };
    if (q.hdY === undefined) out.hdY = clampHead((STAND.hdY ?? 0) - ((q.yaw ?? STAND.yaw ?? 0) - (STAND.yaw ?? 0)) * 0.82 - (q.spY ?? 0) * 0.82);
    return out;
  };
  const CROUCH = P(FR.trCrouch), JET = P(FR.trJet), PLANT = P(FR.boBrake ?? FR.trCrouch), GRIP = P(FR.trGrip);
  const HOIST = P(FR.trHoist), WIND = P(FR.trWind), HURL = P(FR.trHurl);
  const KCOIL = P(FR.trKickCoil), KICK = P(FR.trKick);
  const AIM = P(FR.trAim), SHOT = P(FR.trShot), SIGN = P(FR.trSign);
  const H = T.fetch.hop;
  /** The fetch (a feint: no cue, no blow): crouch, the jet hop, the planted stop, the grip on the piece. */
  const fetch = (o = {}) => ({
    feint: true, windup: o.windup ?? 0.62, fixed: true, active: 0.05, close: 0, track: 0, fsRelic: 'fetch',
    keys: [[H[0], CROUCH], [H[0] + 0.1, { ...JET, e: 'o' }], [H[1] - 0.04, JET], [H[1] + 0.08, { ...PLANT, e: 'o' }], [T.fetch.take, o.grip ?? GRIP], [2.0, o.grip ?? GRIP]],
  });
  /** A cast beat (fixed: what it sends carries its cue); he faces the hero (or the handler turns him). */
  const cast = (tell, windup, damage, knockback, field, keys, o = {}) => ({
    tell, windup, fixed: true, active: 0.1, damage, knockback, cast: { kind: 'fsTerrain', selfCue: true }, part: 'fistR', close: 0, track: 0.9, cock: 0.8, ...field, keys, ...o,
  });
  const back = (from) => [[0.45, from], [1.0, STAND]];
  const RL = T.relic;
  return {
    // ================================================================ phase 2 on: OFFERTORY
    /** Offertory: he jets to a gas tank, chambers the kick (the calf jet lit) and drives it low at the
     *  hero; where it lands it bursts (red: the flare on the tank 0.35 s before it lands; roll). */
    offertory: {
      label: 'Offertory', phase: 2, weight: [0, 0.9, 0.7, 0.6], cooldown: 14, band: [4.5, 26], recovery: 0.95, cat: 'terrain',
      beats: [
        fetch({ grip: KCOIL }),
        cast(R, 0.78, 16, 4, { fsRelic: 'kick' }, [[0.3, KCOIL], [0.82, { ...KCOIL, bY: -0.14, rF: [-0.12, 0.54, 0.08] }], [1.0, { ...KICK, e: 'i' }], [1.6, KICK], [2.0, { ...KICK, rF: [-0.16, 0.12, 0.4], e: 'o' }]], { part: 'footR', track: 0.95 }),
      ],
      recoveryKeys: back(KICK),
    },
    // ================================================================ phase 3 on: CRUCIBLE
    /** Crucible: the gun on a ladle's chain (the red sight line, the marks where its steel will land), the
     *  shot, the pour: a pool under the ladle and a splash where the hero stood (red; walk or roll out). */
    crucible: {
      label: 'Crucible', phase: 3, weight: [0, 0, 1.3, 1.1], cooldown: 12, band: [0, 30], recovery: 0.8, cat: 'terrain',
      beats: [cast(R, 1.0, 0, 0, { fsLadle: 'shot' }, [[0.25, AIM], [0.96, AIM], [1.0, { ...SHOT, e: 'o' }], [2.0, SHOT]], { part: 'gunR', track: 0 })],
      recoveryKeys: back(SHOT),
    },
    // ================================================================ phase 3 on: RELIC
    /** Relic: he jets to a girder, an ingot stack or an unfinished frame, tears it up, hoists it (held: the
     *  blue read) and throws it at the hero (blue: the flare on the piece; parried, it breaks on the blade). */
    relic: {
      label: 'Relic', phase: 3, weight: [0, 0, 0.9, 0.8], cooldown: 11, band: [4, 26], recovery: 0.9, cat: 'terrain',
      beats: [
        fetch(),
        cast(B, 0.76, RL.damage.girder, RL.knockback, { fsRelic: 'throw' }, [[0.26, HOIST], [0.6, WIND], [0.84, WIND], [1.0, { ...HURL, e: 'i' }], [2.0, HURL]], { flare: true }),
      ],
      recoveryKeys: back(HURL),
    },
    // ================================================================ phase 3 on: PROSTRATION
    /** Prostration: his eye's laser on the foot of a column of the hall near the hero (the red sight line),
     *  the cut, and the column comes down across the floor on the hero's place (red: the world's strip). */
    prostration: {
      label: 'Prostration', phase: 3, weight: [0, 0, 0.8, 0.7], cooldown: 16, band: [0, 30], recovery: 0.7, cat: 'terrain',
      beats: [cast(R, 0.92, 0, 0, { fsPillar: 'cut' }, [[0.25, SIGN], [1.0, { ...SIGN, hdX: 0.26, e: 'o' }], [2.0, SIGN]], { part: 'eyes', track: 0 })],
      recoveryKeys: back(SIGN),
    },
    // ================================================================ phase 4: DIES IRAE
    /** Dies Irae: the gun into the press's ram; the press slams and a shock runs out across the whole floor
     *  (red: the flash on its front where it meets the hero; roll through it). */
    diesIrae: {
      label: 'Dies Irae', phase: 4, weight: [0, 0, 0, 0.9], cooldown: 16, band: [0, 30], recovery: 0.8, cat: 'terrain',
      beats: [cast(R, 0.95, T.diesIrae.damage, T.diesIrae.knockback, { fsPress: 'shot' }, [[0.25, AIM], [0.95, AIM], [1.0, { ...SHOT, e: 'o' }], [2.0, SHOT]], { part: 'gunR', track: 0 })],
      recoveryKeys: back(SHOT),
    },
  };
}

// ---------------------------------------------------------------- his combo links (links.js format)
// (a file's own entries come first: links.js merged(). After a thrown piece the gap closer starts only at
// the recovery's end, `cut: 1`, so it lands AFTER the piece, never with it: the Ash Disciple's THROWN rule)
const L = (to, when, chance, o = null) => ({ to, when, chance, ...o });
const AFTER_THROW = { cut: 1 };
export const LINKS = {
  offertory: [L('votiveFist', 'far', [0, 0.3, 0.3, 0.25], AFTER_THROW), L('interdict', 'near', [0, 0.25, 0.2, 0.15])],
  relic: [L('votiveFist', 'far', [0, 0, 0.35, 0.3], AFTER_THROW)],
  prostration: [L('votiveFist', 'far', [0, 0, 0.3, 0.25], AFTER_THROW), L('descent', 'far', [0, 0, 0.2, 0.2], AFTER_THROW)],
  diesIrae: [L('vespers', 'far', [0, 0, 0, 0.3], AFTER_THROW), L('votiveFist', 'far', [0, 0, 0, 0.3], AFTER_THROW)],
};
