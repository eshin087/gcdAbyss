// The False Saint's arsenal's numbers (the ARSENAL AGENT's file: the eye laser, the palm cannon, the
// forearm gun's bolts, the missile swarm, the strafing pass's laser, the mortar barrage, the sky lance, the
// full burst). Read as TUNING.arsenal (tuning.js merges it). Times in seconds, distances in metres, damage
// before TUNING.damageScale (1.6); per-phase values [P1, P2, P3, P4]. Every power a shot hits the world
// with is here (POWER scale, breakTuning.js: 1 fells a tree). The beams', the laser's and the bolts'
// windups are scaled by the phase's windupScale (so the fairness guard may hold them at the cock); the
// casts' and the pass's are `fixed`. A shot from range is read by its tell: every first windup is >= 0.9 s
// in every phase (well over COMBAT.md's 0.7 x windupScale). The cue (the glint / the flare) comes
// TUNING.flashLead (0.35) s before each impact; hits of one move are >= TUNING.minHitGap (0.45) s apart
// (saint.mjs DATA). Nothing of his that signals an attack is cyan or blue (blue means parry; the owner's
// v04 pack): the sight lines are pale white with a red cross, the marks red, the beams his white-hot palette.
// (the tuning pass: the bands of the swarm, the pass, the barrage, the full burst and the gun open from 3 m (2.8
// the swarm; were 3.5 - 5): against a hero who fights close, the barrage, the swarm and the pass were never picked)
export const TUNING_ARSENAL = {
  // ---- the beams' shared rules (absolution, revelation's twin and core beams, the cuts of vigil and the
  // pass): the hero is hit ONCE per beam (red: unblockable, unparryable; a roll through it, its i-frames,
  // is the answer and spends it), from `hitFrom` s before the beat's impact on (the cue's moment). What the
  // beam meets is struck every `every` s with a fresh swing id (a held beam keeps biting). The first COVER
  // on a beam's line (a piece flagged cover: a tank, a column, a jib post, the press) stops it there and
  // takes `cover` power a tick: it holds a few ticks, then melts (the hero behind it is safe while it stands).
  // `eyes`: the most his cyan sensors may brighten while a weapon is used. 0 (the lead's call, from the owner's v04
  // rule: cyan is cosmetic and must not move with an attack, so the sensors never flare in step with a charge).
  beams: { hitFrom: 0, every: 0.1, cover: 0.32, eyes: 0 },

  // ---- VIGIL, the eye's cutting laser (P2+, red): through the windup a thin sight line shows the floor
  // line the cut will draw (across the hero's spot, square to his line of sight, `half` m each side),
  // following the hero (his movement led `lead` s) until `fix` of the windup, then held. The laser lights
  // at the cue (flashLead before the impact) at one end of the line and its foot runs along it at `speed`
  // m/s, crossing the hero's spot AT the impact, on to the other end. The foot (`hitR` m) hits a hero it
  // passes. Every piece on the line is cut at the foot's height (`y`, `power`) and the beam's own line
  // from his eye down to the floor (`airPower`); the plates keep a hot beam scar (groundBlow 'beam',
  // `markPower`, `scarW` m wide).
  vigil: {
    windup: 1.3, cock: 0.8, fix: 0.6, half: 3.6, lead: 0.25, speed: 10, hitR: 0.55, damage: 22, knockback: 4,
    y: 0.25, power: 1.4, airPower: 1.0, markPower: 1.3, scarW: 0.55,
    weight: [0, 0.9, 0.8, 0.6], cooldown: [99, 8, 7, 7], band: [2.4, 22], recovery: 0.8,
  },

  // ---- ABSOLUTION, the palm cannon (P2+, red, held `lit` s): the right palm's iris opens and charges
  // through the windup (the light dims: ambience.dim `dim`), the beam's bearing follows the hero until
  // `fix`, then holds. Lit at the impact on that bearing (`len` m, `w` m wide), it sweeps `arc` degrees in
  // all toward the side the hero is on while he WALKS sideways `walk` m/s the same way. One hit (`damage`,
  // knocked down, `knockback` m out of its side). Every `every` s what stands in it is struck (`sweep`
  // power, at its real height), the floor under it is trenched (world.impact stations `trenchR` m every
  // `step` m, a 'beam' mark) and set alight (`ignite`); a beam scar along it every `markEvery` s.
  absolution: {
    windup: 1.5, cock: 0.82, fix: 0.72, lit: 1.2, len: 18, w: 1.3, arc: 34, walk: 1.3, damage: 28, knockback: 5,
    sweep: 1.5, trench: 1.0, trenchR: 0.75, step: 1.3, ignite: 0.8, markPower: 1.5, markEvery: 0.3, dim: 0.6,
    weight: [0, 0.8, 0.7, 0.55], cooldown: [99, 10, 9, 9], band: [3, 24], recovery: 1.0,
  },

  // ---- TRIPTYCH, the forearm gun (P3+, three blue bolts): `first` s of windup for the first (the
  // forearm opens: d.fsGunK), `gap` for the next two. Each bolt leaves the gun so it reaches the hero AT
  // its beat's impact (after its glint: a flight of `minT` .. `maxT` s, at least `speed` m/s), aimed where
  // he will be (`lead` s of his movement). A hero within `hitR` m of where it arrives takes it (blue: a
  // parry or a block answers it; a parry spends it and nicks his posture `posture`). A PERFECT parry sends
  // it home: it flies back into his chest (`back`: damage, posture, speed). A bolt that misses flies on
  // `carry` m; every bolt bites what it meets (`power`; the first cover on its way stops it).
  triptych: {
    first: 1.1, gap: 0.5, cock: 0.8, speed: 30, minT: 0.16, maxT: 0.3, lead: 0.2, hitR: 0.8, damage: 14, knockback: 2.2, posture: 18,
    back: { speed: 30, damage: 70, posture: 110 }, carry: 7, power: 1.2,
    weight: [0, 0, 1.1, 0.95], cooldown: [99, 99, 6.5, 6], band: [3, 20], recovery: 0.75,
  },

  // ---- CHOIR, the missile swarm (P3+, red marks): the shoulder petals open through the windup
  // (d.fsPetalK); at the cast `n` micro-missiles leave the cells. Each comes down on a ring marked on the
  // floor (`r` m) from the launch: the first ones on a spiral round the hero's spot (`ring` m out from it:
  // they cage him, none on him), landing `spread` s apart from `T0` s; then the last `track.n` on him,
  // `track.gap` s apart after `track.after` s more, their marks walking after him (`track.speed` m/s)
  // until `track.stop` s before each lands (then held: it reads). Each is told to the ledger from the launch and moved later by the fairness
  // guard (never inside a blue / normal blow's window; one it cannot clear is not fired). The hero's blade
  // cuts one out of the air within `cutR` m of it (it bursts there, harmless). A landing hurts a hero
  // inside its ring (`damage`), and craters the floor (world.impact `craterR`, `power`; a blast mark).
  choir: {
    windup: 1.1, cock: 0.75, n: [0, 0, 9, 11], ring: [2.3, 5.4], T0: 1.5, spread: 0.12, apex: [5, 7.5], r: 1.3,
    track: { n: 3, gap: 0.5, after: 0.3, stop: 0.75, speed: 5.5 }, damage: 12, knockback: 3, cutR: 0.8, craterR: 1.6, power: 1.5,
    weight: [0, 0, 1.1, 1.1], cooldown: [99, 99, 11, 10], band: [2.8, 30], recovery: 0.9,
  },

  // ---- PASSING BELL, the strafing pass (P3+, red line): up on the back thrusters to `h` m by `rise` of
  // the windup; the line he will fly (from where he hangs, through the hero's spot, on to his circle's far
  // side, at most `beyond` m past the hero) shows on the floor, following the hero until `fix`. He flies
  // it at `speed` m/s (faster if the line asks: the laser's foot, `foot` m ahead of him, crosses the hero's
  // spot AT the impact), the eye laser cutting the floor beneath him the whole way: one hit on a hero the
  // foot passes (`hitR`), every piece on the line cut (`power`; the beam from his eye `airPower`), one
  // long beam scar across the floor. He comes down at the line's end.
  passingBell: {
    windup: 1.35, cock: 0.8, rise: 0.4, h: 3.4, fix: 0.62, foot: 1.6, speed: 17, beyond: 14, lit: 1.0, hitR: 0.65, damage: 24, knockback: 5,
    y: 0.25, power: 1.5, airPower: 1.0, markPower: 1.5, scarW: 0.75,
    weight: [0, 0, 0.9, 0.8], cooldown: [99, 99, 10, 10], band: [3, 26], recovery: 0.9,
  },

  // ---- KYRIE, the artillery (P4): the mortar tubes on his back rise through the windup (d.fsTubeK).
  // A CREEPING BARRAGE: `rows` rows of `per` marked shells, fired `rowGap` s apart, each row marked the
  // moment it is fired and landing `T` s later. A row lies across his line to the hero, `step` m further
  // on than the last (`along` x step from the hero's spot as it fires: they walk over him), its shells
  // `r` m with SAFE LANES of `lane` m of clear floor between them (the centres 2 r + lane apart); each row
  // is laid so a lane's middle is as near the hero as the spacing allows (at most half a spacing: within a
  // roll of where he stands, `measured` by saint.mjs kyrieLanes), the lanes of one row off those of the
  // last. A shell hurts a hero inside its mark (`damage`), smashes every piece within `worldR` m (`power`)
  // and craters the floor. Then THE GREAT SHELL on the hero's spot (`great`: its windup after the last row,
  // its flight `T`, a mark of `r` m). One ledger handle per row (the fairness guard moves a row later, or
  // drops it).
  kyrie: {
    windup: 1.2, cock: 0.75, rows: 4, per: 5, r: 1.25, lane: 2.2, step: 2.7, along: [-2, -1, 0, 1], T: 1.5, rowGap: 0.85,
    damage: 16, knockback: 4, power: 2.2, worldR: 1.9,
    great: { windup: 0.9, T: 1.7, r: 3.0, damage: 28, knockback: 7, power: 3.4, worldR: 3.6 },
    weight: [0, 0, 0, 1.2], cooldown: [99, 99, 99, 15], band: [3, 30], recovery: 1.0,
  },

  // ---- VERDICT, the sky lance (P4): his right hand raised to the sky; a reticle follows the hero
  // through the windup and LOCKS at the cast where he stands (the lock tone); `fall` s later the pillar
  // of light comes down there (red; `r` m; the fairness guard may hold it a little), then `ring.delay` s
  // after it a ring shock runs out along the floor (normal: a block or a parry answers it; `ring.speed`
  // m/s out to `ring.r`, `ring.w` m deep), cued as it nears the hero. The pillar leaves a molten crater
  // (the set's pool, `pool`) and smashes what stands within `worldR` (`power`).
  verdict: {
    windup: 1.7, cock: 0.85, fall: 0.95, r: 1.5, damage: 32, knockback: 6, power: 3.6, worldR: 2.6,
    ring: { delay: 0.55, speed: 12, r: 7, w: 0.8, damage: 10, knockback: 3, power: 0.8 },
    pool: { r: 2.4, life: 12 },
    weight: [0, 0, 0, 0.9], cooldown: [99, 99, 99, 13], band: [3, 30], recovery: 1.6,
  },

  // ---- REVELATION, the full burst (P4, red, held ~2 s): both palms and the chest core charge through
  // the windup (the light dims hard). TWIN BEAMS from both palms, lit at the cue `twin.ang` rad either side
  // of the hero's bearing (fixed at `fix`), converging to cross on it AT the impact, held crossed `twin.lit`
  // s. Then the CORE CANNON (`core.windup` more): a beam `core.w` m wide lit at its impact on the hero's
  // bearing and swept `core.arc` degrees over `core.lit` s toward his side. One hit each (twin, core). The
  // biggest scar in the game: its trench, its beam marks, everything on it struck and set alight.
  revelation: {
    windup: 1.6, cock: 0.85, fix: 0.7, dim: 0.9,
    twin: { lit: 0.75, ang: 0.3, len: 20, w: 1.0, damage: 20, knockback: 4, sweep: 1.4 },
    core: { windup: 0.75, cock: 0.8, lit: 2.0, len: 22, w: 3.2, arc: 60, damage: 38, knockback: 7, sweep: 2.4 },
    trench: 1.6, trenchR: 1.4, step: 1.4, ignite: 1.1, markPower: 2.2, markEvery: 0.25,
    weight: [0, 0, 0, 0.8], cooldown: [99, 99, 99, 16], band: [3, 30], recovery: 1.2,
  },
};
