// Gameplay + anatomy numbers for the drake. Everything a designer might want to tweak lives here.
// Shared combat windows (parry / block / dodge / posture) live in src/combat/rules.js — never here.

import { TELL } from '../../combat/rules.js';
import { FIRE_ATTACKS } from './tuningFire.js';
import { BULLETS, BULLET_ATTACKS } from './tuningBullets.js';
import { TERRAIN, TERRAIN_ATTACKS } from './tuningTerrain.js';
import { LINKS } from './tuningLinks.js';
import { SPELLS } from './tuningSpells.js';
import { BROOD } from './tuningBrood.js';
import { WYRM_QUICK } from './tuningMotion.js';
import { lookOf } from '../enemies/duelist/lookSwitch.js';

const DEG = Math.PI / 180;

/**
 * Uniform size of the wyrm (v0.2: 25 % bigger than v0.1; v0.3: 1.5x v0.2 = 1.875x v0.1).
 * The model (model.js) and ANATOMY are authored in MODEL units (= the v0.1 metres); the root
 * Object3D is scaled by SCALE. Everything that works in WORLD space — IK bone lengths, neck/tail
 * chain lengths, gait strides, hurt spheres, body circles, attack reaches / radii, grass pushers,
 * FX sizes, pose targets (`dragon.rootPt`) — multiplies by SCALE. Change it here only.
 */
export const SCALE = 1.875;
const S = SCALE;

export const TUNING = {
  // v0.5 "epic wyrm fight" starting difficulty (the lead tunes after the merge): a 3-5 min fight for
  // a player who knows the moves (docs/COMBAT.md "Difficulty")
  maxHp: 4500,
  // v0.6 "bullet hell": the wyrm attacks far more often (shorter idle gaps, two more strings, four
  // bullet patterns), so every hit it deals through hitPlayer is scaled by this (the attack tables
  // keep their relative numbers). Bullets and the fire wheel are exempt: tuningBullets.js holds
  // their final damage.
  damageScale: 0.85,
  bullets: BULLETS, // the small projectiles of bullets.js (tuningBullets.js)
  terrain: TERRAIN, // what the jaws and the tail can take from the clearing (tuningTerrain.js, ADR-110)
  // three phases (contract 4): phase n starts at phaseAt[n - 1] of max HP (P1 100 %, P2 66 %, P3 33 %).
  // Each threshold is a gate: with the AI on, damage stops there until the transition roar starts.
  phaseAt: [1, 0.66, 0.33],
  phase2At: 0.66, // = phaseAt[1] (kept for older readers)
  phase3At: 0.33, // = phaseAt[2]
  radius: 2.0 * S, // collision radius vs stones / arena bound
  // what its blows do to the world (ADR-107; world/breakTuning.js POWER scale: 1 fells a tree)
  world: {
    melee: 0.7, // a striking part, x its radius in body units (a claw 0.77, the charge's chest 1.2)
    stomp: 0.8, leap: 1.4, hop: 1.2, dive: 1.8, // (tuning, 2026-11-15: stomp 1.0, leap 1.7, dive 2.5)
    nova: [1.2, 0.3, 0.45], // (tuning: [2.2, 0.45, 0.45]: its heart flattened ten metres of the clearing)
    // a ground blow (the stomp, a leap, a hop, a dive, the nova) is this much weaker at its rim than at
    // its heart (2026-11-15: the dive's 7.5 m felled all it covered: a four-minute fight left a sixth standing)
    falloff: 0.6, // the blast: at its heart, at its rim; the heart's share of the radius
    // the marks its blows leave on the floor (world.groundBlow → scars.mark, ADR-107; a POWER each):
    // the claws' rake at a swipe's plant (3 gashes), an overhead's claws in the ground, the charge's
    // skid (a furrow), a landing (a crater), a hind foot (a faint print), the tail slapped down
    marks: { rake: 0.55, claws: 1.0, clawLen: 1.5, skid: 0.8, skidLen: 2.6, land: 1.6, step: 0.7, tail: 1.2, spread: 0.55 },
    explosion: 0.7, meteor: 0.7, pillar: 0.9, // (tuning: explosion 0.9, meteor 1.5, pillar 1.0: Armageddon's sixty meteors broke the whole paving)
    trample: 1.2, // (ADR-107's trample round the root: replaced by `body` below; kept for older readers)
    // the body against the world (dragon.js _wreck, 2026-11-15): each hurt sphere that moves faster
    // than minSpeed m/s sweeps the pieces it passes through: power = (speed - minSpeed) x perSpeed x its
    // part's mass, at most `max` (a walk's chest ~0.4 every 0.18 s: an oak goes down in about a second
    // of pushing; the tail of a turn ~1.5; a charge or a dive ~2). `pad` m on each sphere; nothing
    // above maxY m (a sphere's bottom) is near the treetops; a step over `jump` m is a teleport, after
    // which it settles `settle` s before its body meets the world again
    body: { minSpeed: 1.6, perSpeed: 0.17, max: 2.2, pad: 0.15, maxY: 12, jump: 6, settle: 0.6, mass: { head: 0.7, neck: 0.8, body: 1.9, tail: 1.1, wing: 0.8, leg: 0.9 } }, // (tuning: body 1.5: with BREAK.brush the torso's weight pushes a tree over in a few seconds of walking into it)
    // the wings' blasts on what stands round it: as it leaves the ground (alt rising through `alt` m),
    // and each downbeat of its wings under maxAlt (weaker the higher it is): wood only, the wind bends
    // trees; as it lands (alt falling through `alt` after a flight at least `minFall` high): its weight,
    // stone too
    takeoff: { alt: 1.0, radius: 7, power: 1.0 }, // (tuning: radius 9)
    landing: { alt: 0.6, minFall: 2.5, radius: 8.5, power: 1.6 }, // (tuning: power 1.4, now weaker toward its rim: falloff; its heart fells)
    downbeat: { maxAlt: 11, radius: 7.5, power: 0.6 },
    // fire that lands sets the grass and the wood alight: how long (x FIRE.life / BREAK.burn.time)
    // and how much of the blast's radius catches
    ignite: { breath: 1, strip: 1, explosion: [1, 0.6], meteor: [0.7, 0.55], pillar: [0.8, 0.7], dive: [0.8, 0.5], nova: [1, 0.6] },
    bullet: 0.12, // a small bullet stopped by cover takes this out of it (the orb: x 3)
    // ITS REACH INTO THE WALL (wallReach.js, 2026-11-16: the owner's "destroy more of ... the tree walls
    // surrounding the map"; the wyrm fights inside the clearing and before this a fight left the wall
    // much as it stood). None of it touches the hero.
    // wind: [power (x the call's k), reach m, from m (nothing nearer the centre), falloff (else
    // BREAK.wind.fall)] of the front of wind a source sends out (world.destructibles.wind: wear, never a
    // fall: BREAK.wind.floor). A phase roar is a moment: its front runs round the whole ring, tearing
    // leaves off everywhere, boughs here and there far off (a flat falloff, a ragged front) and near it
    wind: {
      roar: [0.3, 32, 0], // a roar (x its strength: the wake 1, the nova 1.3, a flight's 0.6)
      phaseRoar: [0.22, 58, 0, 1.0], // the phase roars (phase 3 x 1.5 / 1.3)
      shock: [0.35, 26, 0], // the roar's damaging shock ring
      takeoff: [0.4, 26, 0], landing: [0.5, 28, 0], downbeat: [0.16, 20, 26], // its wings (x the beat's strength)
      buffet: [0.4, 26, 0], // a wing buffet's downstroke, a wing rend
      ground: [0.22, 22, 0], // a heavy body on the ground (a stomp, a leap, a crash: x its k)
    },
    // carry: [length m, at most every s, burn k (x BREAK.burn.time), heat blobs in its streak] of fire
    // that does not stop where it lands (world.destructibles.carryFire): from the end of a breath, a pass's
    // strip, a flame wall or ring that ran out, a shot that left the clearing, on to the first wood
    carry: {
      breath: [24, 0.35, 0.9, 10], strip: [20, 0.3, 0.9, 6], wall: [18, 0.25, 0.8, 6], ring: [16, 0.3, 0.8, 4],
      shot: [22, 0.2, 0.7, 4], meteor: [0, 0, 0, 0],
    },
    // the WRECKAGE scenario's bounds (integ.mjs: a whole AI fight on the real clearing, 80 s a phase):
    // the share of the clearing's pieces (inside the hero's bound) standing at the end, the liftable
    // pieces as phase 3 starts, the pieces burnt through. Measured 2026-11-15 on seeds 1337, 7, 4242:
    // 36 - 50 % standing (11 - 15 before the tuning pass), 9 - 12 liftable, 2 - 4 burnt
    // (run alone, seed 1337 stands at 47 %; inside the whole suite, after the scenarios before it have
    // taught the director other tells, the same seed's fight went another way and left 24 %: the lower
    // bound sits under that)
    // (2026-11-16: the landmarks inside the bound count too: the nest's ribcage and skull, the elder
    // wyrm's pieces, the Cinder Tree's boughs, 107 pieces in all (72 before). burnt 6 -> 9: the Cinder
    // Tree's five boughs burn. Measured on seeds 1337, 7, 4242, 99, 2024: brk report)
    // (2026-11-16, the tuning pass: `wall`: the share of the wall's front rows (32 - 46 m) worn or down
    // at the end, `wallP1` at least that share marked by phase 1's end. Measured on seeds 1337, 7, 4242,
    // 99, 2024 at 80 s a phase: 43, 41, 37, 45, 57 % (the merged build before it: 23, 33, 19, 34, 29 %);
    // P1 8 - 18 %)
    // (2026-11-21: `wall` from 0.3: run alone seed 1337 marks 44 % of the front rows; inside the whole
    // suite the same seed's fight went another way and marked 29 %, as `endShare` above had found for
    // the pieces: the lower bound sits under that. Seen when the sims began to reseed at each model's
    // build, tests/integration/integ.mjs onModelBuilt)
    // (2026-11-26, ADR-223: `burnt` from 9: with the held windups and the quick swipe the same seed's fight
    // rolls other moves and burnt 11 of 184 pieces through; nothing of the fire changed)
    meter: { endShare: [0.2, 0.7], liftP3: 8, burnt: 12, wall: [0.25, 0.75], wallP1: 0.03 },
  },
  // the root stays inside min(CONFIG.world.dragonBound, bound) (m). CONFIG's 26 was sized for the
  // v0.2 wyrm; at x1.875 the chest / neck-base body circles (~5.8 m ahead of the root) would cross
  // the 30 m clearing and pin the hero against its edge. 24 keeps them inside.
  bound: 24,
  // per phase [P1, P2, P3] below
  turnSpeed: [70 * DEG, 110 * DEG, 125 * DEG], // rad/s (inside attacks; between them x pressure.turn)
  walkSpeed: [3.6, 4.6, 5.3], // (v0.6: 3.0, 4.1, 4.6) it closes on the hero between moves
  // later phases speed the fight up: windups + recoveries x this (the swings themselves keep their speed)
  phaseTimeScale: [1, 0.82, 0.7], // (tuning, 2026-11-15: [1, 0.85, 0.78])
  phase2TimeScale: 0.82, // = phaseTimeScale[1] (kept for older readers)
  // pause between attacks (walking / turning / snorting) — the main "breathing room" knob; phase 3
  // keeps the pressure on (v0.6: 1.0-1.7, 0.7-1.2, 0.35-0.7 s: now pressure.openingGap)
  idleGap: [
    [0.25, 0.5], // (tuning, 2026-11-15: 0.6 - 1.0: phase 1 hunts)
    [0.25, 0.5], // (tuning: 0.3 - 0.6)
    [0.05, 0.25], // (tuning: 0.1 - 0.35)
  ],
  // THE DIRECTOR (ai.js): how the pick between moves is steered, how moves chain into each other,
  // the small fire it adds on its own and the fairness guards. Per phase [P1, P2, P3].
  pressure: {
    // the hero's opening is kept as it was: after a parry recoil, a stagger, a posture break, a
    // plunge reaction, or a move he answered with his flurry / counter, the pause is the old one
    openingGap: [
      [1.0, 1.7],
      [0.7, 1.2],
      [0.35, 0.7],
    ],
    // COMBO LINKS (an attack's tuning `links: [{ to, when, chance }]`, all in tuningLinks.js; read
    // when it ends on its own):
    // at most this many links in a row, then a breather of chainRest s
    chainDepth: [3, 3, 5], // (tuning: [2, 3, 4])
    chainRest: [
      [0.7, 1.0], // (tuning: 1.1 - 1.5)
      [0.8, 1.1],
      [0.4, 0.65], // (tuning: 0.55 - 0.8)
    ],
    // `when` of a link: the hero's bearing off the nose (rad) and distance from the root (m)
    front: 0.9, behind: 1.75, near: 9, far: 18,
    // the weighted pick: the last pick x repeat[0], the one before x repeat[1]
    repeat: [0.3, 0.65],
    // categories (melee / wing / tail / fire / flight / spell / terrain): derived from where an attack
    // is tuned and what its hits are; an attack's own tuning `category` wins, then this map
    category: { tail: 'tail', stomp: 'melee', breath: 'fire', fireball: 'fire', leap: 'flight', roar: 'spell' },
    // a new phase staggers the first use of its attacks (TUNING.unlockStagger), except these (the
    // phase-3 roar queues the nova itself)
    unlockSkip: ['nova', 'roar'],
    maxRun: [2, 2, 2], // no more than this many picks of one category in a row ...
    overRun: 0.03, // ... (a category past it: its weight x this; 0 would stall a lone candidate)
    sameCat: 0.7, // the last pick's category x this
    floorAfter: [32, 15, 12], // (tuning: P1 20: a forced flight every minute was a quarter of phase 1 in the air at a cue every 4 s) // s: a category absent this long comes back ...
    floorBoost: 2.5, // ... its weight x this (x absent / floorAfter, up to x3 more)
    floorForce: 3, // ... and absent past floorAfter x this, usable from where it stands: it is the pick
    // a bias per category [P1, P2, P3]: the body moves (many cues, close) over the long casts
    bias: { melee: [1.25, 1.25, 1.3], wing: [1.25, 1.25, 1.3], tail: [1.25, 1.25, 1.3] },
    // gap closers when the hero is far (an attack's tuning `closer: true` adds one)
    closers: ['charge', 'pounce', 'leap', 'skyStrafe', 'diveBomb'],
    farDist: 15, closerBoost: 2.2,
    behindBoost: 2.5, // tail moves when the hero stands behind it (beyond `behind`)
    // the ceiling: share of the last ~20 s spent airborne, and live hazards at once (spells wait)
    maxAir: [0.18, 0.24, 0.3],
    maxCast: [3, 5, 7],
    layer: 0, // a spell / bullet pattern while another's emitter or bullets are live: weight x this
    // a move asking for a guard while meteors / a chase fall, or for a dodge while bullets fly
    // (cues of the other answer at times nobody knows yet): weight x this
    mixed: 0,
    // MOVEMENT between moves: the idle turn is the attacks' turnSpeed x this; it walks at the hero's
    // spot `lead` s ahead when he is farther than `approach` m (cuts him off), circles him
    // (`strafe` m/s) through a longer pause
    // (tuning, 2026-11-15: [1.6, 1.7, 1.8] = 112 - 225 deg/s: filmed, the turn in place lifted all four feet
    // at once in 0.13 s steps, a pirouette; 80 - 130 deg/s keeps one foot up at a time, two at most)
    turn: [1.15, 1.1, 1.05],
    // the director repositions for a category absent past floorAfter that nothing can use from where
    // it stands: tries these changes of the hero's distance (m) and bearing (rad; -1 = as now), takes
    // the cheapest under `max` s (backing off at walkSpeed x back), at most once every `every` s
    // (tuning, 2026-11-15: dist [0, -3, 3, 6, 9], back 1.5, max [1.3, 1.1, 0.9], every 6. Filmed, the
    // bound back was a 5.4 - 6.6 m/s walk backwards while turning: a moonwalk. It now only closes in
    // and turns; a category that needs room comes back through the floors and the links)
    seek: { dist: [0, -3], ang: [-1, 0, 1.3, 2.2], max: [1.0, 0.9, 0.8], back: 0.6, every: 9 },
    approach: [12, 11, 10],
    lead: 0.6,
    strafe: [1.2, 1.5, 1.7], // (tuning: [2.2, 2.8, 3.2] m/s: a crab's scramble, three feet up at once)
    // AMBIENT FIRE (from phase 2): cinders shaken from its wings and spat from its jaws, falling near
    // the hero while it fights: self-announcing small blasts (their ground heats, red flash, roll).
    // Every `every` s on average (n of them), `warn` s of heated ground, landing `spread` m round the
    // hero (onHero: the share aimed where he will be); at most `alive` of them at once
    ambient: {
      every: [0, 1.4, 0.7], // (tuning: [0, 2.0, 1.1]: more fire each phase)
      n: [[0, 0], [1, 2], [2, 3]],
      warn: [1.2, 1.2, 1.05],
      fall: 0.75, // s of the visible fall at the end of the warning
      spread: [1.5, 4.8],
      onHero: [0, 0.25, 0.4],
      lead: 0.5, // s of the hero's velocity
      radius: [1.6, 1.6, 1.9],
      damage: 14, burn: 1.0, knockback: 2,
      alive: [0, 3, 6], // (tuning: [0, 3, 5])
      // when none may fall near him (a fire pattern runs, bullets fly, a pause): they fall this far
      // from him (m, + their radius: beyond a run and a roll before they land): no cue, no hit
      far: [8, 13],
    },
    // FAIRNESS: blows that need different answers (dodge vs parry / guard) never land within `sep` s
    // of each other: a melee blow about to be cued waits (<= maxHold s, its windup held) for a blast or
    // a bullet already on its way; an ambient cinder never lands within sep of a known blow nor after
    // the running move ends. A cinder is only dropped where at least `safeMin` of 17 spots (the hero's
    // and 16 a roll away) stay clear of every blast due within `horizon` s
    guard: { sep: 0.3, margin: 0.05, maxHold: 0.5, safeMin: 6, horizon: 1.4, roll: 4.2 },
    // the pressure meter's bounds (integ.mjs scenario PRESSURE): each phase's cues per minute at least
    // x ramp the last's; the longest gap between cues (s). Measured on three seeds before the director
    // (v0.6 numbers): P1 6.6 - 7.2, P2 6.7 - 7.7, P3 5.6 - 10.3 s; with it: 5.7 - 7.6, 3.6 - 6.5, 3.5 - 4.5
    // (tuning pass, 2026-11-15, five seeds 1337 7 4242 99 2026: P1 30.7 - 36.7, P2 53.2 - 63.4, P3 71.6 -
    // 86.0 cues a minute, P3 / P2 x1.15 - 1.62, P2 / P1 x1.55 - 1.88; longest gaps P1 4.4, P2 3.6, P3 3.2 s.
    // Was maxGap [8, 7, 5] and no floor on the rate)
    // ramp: each phase busier than the one before in the seeds' MEAN; rampSeed: per seed (the duelists'
    // rule, ADR-122). The same seed replays a different fight whenever the scenarios before it change
    // (2026-11-23, the streak pass: seed 1337 read 66.5 -> 70.7 inside `all`, x1.06, and 60.0 -> 77.0
    // alone; over ten seeds alone every one ramps at least x1.21, main x1.31)
    meter: { ramp: 1.12, rampSeed: 1.05, maxGap: [5.5, 5, 4.5], minRate: [28, 48, 64] },
  },
  // the wyrm's heat per phase: crack glow (glowTarget) and body embers per second (phase 3 burns
  // white-hot)
  phaseGlow: [0, 0.5, 0.8],
  phaseEmbers: [0, 22, 50],
  // posture meter size per phase; gains / regen / break time come from rules.js POSTURE. Sized so a
  // player parrying the strings breaks it about every 30-60 s (the god-mode defending bot of the
  // integration WIN scenario is the reference player)
  posture: { max: [560, 640, 720], headMult: 1.25 },
  stagger: { time: 1.6 }, // ordinary (short) stagger: Lab button, charging head-first into a stone
  recoilTime: 0.6, // parried melee attack (the last hit of a string): head snaps back, attack cancelled
  // a parried hit that is NOT the last of its string: the struck part is knocked back (visual only,
  // no timing change; contract 1 "deflect chain")
  deflectKnock: { time: 0.14, head: 1.1, paw: 0.9, up: 0.5 },
  // the plunge reaction (contract 2): a hero's head-stab slams the head to the ground, it thrashes and
  // rises; airborne it first falls (`fall` s) and crash-lands. `exec` = an execution on a broken wyrm
  // (heavier, longer; consumes the break)
  plunged: {
    fall: 0.6, slam: 0.3, thrash: 0.6, rise: 0.45,
    exec: { slam: 0.35, thrash: 1.15, rise: 0.5 },
    crashShake: 0.6,
    flash: 0.45, // cap on the hurt flash at the impact (the hitstop freezes its decay)
  },
  // a new phase's abilities unlock one by one: opening cooldown = first + step x i + jitter (s), in a
  // random order (Dragon.enterPhase). The phase-3 opener (nova) is queued by the roar and not delayed.
  unlockStagger: [1.5, 1.6, 1.5], // (v0.6: 2, 2.5, 2) the new moves arrive faster
  // the tell's timing cue: combat:flash + in-world flash this many seconds before impact (COMBAT.md)
  flashLead: 0.35,
  // how late after its impact a string's bite may still connect (s; inside the 0.085 s timing
  // tolerance): a hero standing inside the snout was caught by the lunge 0.1 s after the flash said
  // it would land (cataclysm's held bite at 3 m); past this the bite misses instead (2026-11-20)
  biteLate: 0.07,
  // ... and how early (s before its impact; the motion audit's spread snap, motionFix.js)
  biteEarly: 0.06,
  // strings (contract 1): a follow-up hit lands at least this long after the previous one (the
  // player releases and re-presses RMB: DEFENSE.parryRearm 0.25 s); checked by the STRINGS scenario
  minHitGap: 0.45,
  // Lab trigger: quick turn toward the player before a forced ability (rad/s, max seconds)
  forceTurn: { rate: 7, maxTime: 0.5 },
  partMult: { head: 1.5, neck: 1.15, body: 1.0, tail: 0.8, wing: 0.9, leg: 1.0 },
  // seconds before each attack is first allowed once the fight starts (the intro roar)
  openingCooldowns: { breath: 5, fireball: 4, charge: 3, leap: 8 }, // (v0.6: 7, 5, 4, 10)
  flashDecay: 9,
  // resting body language while awake (ai.js baseline; attacks return to it): wings mantled HALF
  // (0 FOLD, 0.5 HALF, 1 SPREAD: the painting's tall sails, the biggest shapes at the game camera),
  // tucked a little while walking; the jaw rests open like the painting's snarl, so the lit maw and
  // the fangs show (1 = 0.7 rad; visual only) [P1, P2, P3]
  rest: { spread: 0.5, walkSpread: 0.3, jaw: [0.65, 0.85, 0.95] },

  // Every attack declares its tell (TELL.NORMAL / BLUE / RED) and may override parryable /
  // blockable (defaults: tellDefaults(tell) in rules.js). Times in seconds (P1 values; later phases
  // x phaseTimeScale on windup + recovery). `impact` = seconds into the active phase at which the
  // blow typically lands (drives the timing flash). AI selection (ai.js, generic for every ATTACKS
  // entry): `phase` = first phase the AI uses it in (the Lab can force any), `weight` = a number or
  // [P1, P2, P3], `cooldown` s. Damage: a string hit 14-24, a heavy blow 30-40 (the hero has 160 HP).
  //
  // STRINGS (contract 1, attacks.js makeString): an attack made of N `hits`, each with its own
  //   kind      the performance (attacks.js KINDS): claw (foreleg rake), overhead (overhead claw
  //             smash), bite, rearBite (reared, hesitant bite), lungeBite, wing (wing buffet),
  //             tailJab, tailSweep, hop (pounce), stomp
  //   side      claw / overhead / wing: +1 = the limb on the side the hero stood at the string's
  //             start, -1 = the other one
  //   tell, windup (P1 s), hold [min, max] (optional random extra windup hold: baits an early
  //   parry; the flash still comes flashLead before the real impact), active, impact (s into the
  //   active), damage, knockback (+ knockdown and kind extras: reach, lunge, radius, turn ...),
  //   chance (0..1: the hit only happens this often, rolled at the string's start)
  //   flare     on a BLUE hit (or a single blue attack): a parry MOMENT (ADR-118): the blue flare
  //             cues it, and a parry of it is answered by the hero's counter and ends the string
  //   tell BLACK  a CHARGED blow: darkness gathers on the striking part through a long windup
  // plus the string's recovery / cooldown / weight / phase and its AI band: `range` [min, max] model
  // units (x SCALE) from the root, `maxAng` / `minAng` rad off the nose. Every hit fires combat:tell
  // at its windup start and combat:flash flashLead s before its impact. A parried hit that is not
  // the last one is deflected (the string goes on); parrying the last one recoils the wyrm.
  attacks: {
    bite: {
      label: 'Bite', tell: TELL.BLUE, flare: true,
      windup: 0.75, active: 0.2, impact: 0.06, recovery: 0.8,
      damage: 24, knockback: 2, reach: 5.4 * S, cooldown: 1.2, weight: 1.5,
    },
    swipe: {
      label: 'Claw swipe (foreleg rake)', tell: TELL.NORMAL,
      windup: 0.8, active: 0.25, impact: 0.15, recovery: 0.7,
      damage: 20, knockback: 3, cooldown: 1.6, weight: 1.6, // (w2: 2.6: the hands-only feel)
    },
    // three hits: left claw, right claw, finishing lunge-bite (a string since v0.5)
    clawCombo: {
      label: 'Claw combo (3 hits)', tell: TELL.BLUE, // headline tell = the finisher
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.8, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.55, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.8 },
        // reach: max head reach from the neck base; lunge: max root travel during the bite (m)
        { kind: 'lungeBite', tell: TELL.BLUE, flare: true, windup: 0.6, active: 0.24, impact: 0.05, damage: 22, knockback: 3, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.0, cooldown: 5, weight: [1.8, 1.2, 0.9], range: [2.4, 5.4], maxAng: 0.9, // (w2: [2.4, 2.4, 2.0]; merge [1.4, 1.0, 0.6])
    },
    // claw, claw, an overhead smash and a lunging bite: parry, parry, PARRY, PARRY
    rendingFlurry: {
      label: 'Rending flurry (4 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 0.8 },
        // lunge: root travel (model units) to close on a far hero
        { kind: 'overhead', side: 1, tell: TELL.BLUE, windup: 0.62, active: 0.24, impact: 0.22, damage: 22, knockback: 3, lunge: 1.2 },
        { kind: 'lungeBite', tell: TELL.BLUE, windup: 0.55, active: 0.24, impact: 0.05, damage: 24, knockback: 3.5, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.1, cooldown: 7, weight: [1.8, 1.4, 1.2], range: [2.4, 5.4], maxAng: 0.9, // (w2: [3.0, 2.8, 2.4]; merge [1.6, 1.2, 0.8])
    },
    // the head rears back and HOLDS (a random delay), then snaps; half the time a quick second snap
    hesitantMaw: {
      label: 'Hesitant maw (1-2 bites)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'rearBite', tell: TELL.BLUE, flare: true, windup: 0.85, hold: [0.25, 0.9], active: 0.2, impact: 0.06, damage: 24, knockback: 2.5, reach: 5.4 * S },
        { kind: 'bite', chance: 0.5, tell: TELL.BLUE, windup: 0.5, active: 0.2, impact: 0.06, damage: 20, knockback: 2.5, reach: 5.4 * S },
      ],
      // (the reared head can't reach down under the snout: from 3.5 out)
      recovery: 0.9, cooldown: 6, weight: [1.5, 1.6, 1.4], range: [3.5, 6.5], maxAng: 0.65, // (tuning: [2.4, 2.2, 2.0]; 0.4 - 0.6 cues a second)
    },
    // a wing smashes down beside the body, it pivots, the other wing smashes down (a gust shoves)
    wingBuffet: {
      label: 'Wing buffet (2 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        // wing extras: face = rad off the nose the hero is turned to, spread = the struck wing's
        // opening, amp = the beat (rad), roll / twist = the body leaning / the chest swinging the wing
        // forward through the blow
        { kind: 'wing', side: 1, tell: TELL.NORMAL, windup: 0.8, active: 0.3, impact: 0.25, damage: 18, knockback: 5, face: 1.15, spread: 0.45, amp: 0.95, roll: 0.38, twist: 0.6 },
        { kind: 'wing', side: -1, tell: TELL.BLUE, flare: true, windup: 0.9, active: 0.3, impact: 0.25, damage: 22, knockback: 7, face: 1.15, spread: 0.45, amp: 0.95, roll: 0.38, twist: 0.6 },
      ],
      // the wing comes down ~7-8 model units out (its fingers): a mid-range answer to a hero standing
      // off out of claw reach (any side: the windup turns the flank to him)
      recovery: 1.0, cooldown: 6, weight: [1.8, 2.0, 1.8], range: [6.8, 8.3], maxAng: 2.6, // (tuning: [2.2, 2.4, 2.4])
    },
    // a claw, a pivot (it turns its back), a tail jab thrust (dodge), a tail sweep (dodge)
    tailLash: {
      label: 'Tail lash (3 hits)', tell: TELL.RED, phase: 2,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 18, knockback: 1.5, turn: 0.7 },
        // the jab: the pivot stops the tail `offset` rad short of the hero, then a short lash snaps it
        // through him (`past` beyond); the hips thrust back `lunge` model units
        { kind: 'tailJab', tell: TELL.RED, windup: 1.0, active: 0.36, impact: 0.245, damage: 26, knockback: 4, offset: 0.95, past: 0.8, lunge: 0.8, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'tailSweep', tell: TELL.RED, windup: 0.9, active: 0.45, impact: 0.2, impactFlank: 0.1, damage: 30, knockback: 3, spin: 200 * DEG, minReach: 2.0 * S, reach: 9.5 * S },
      ],
      recovery: 1.0, cooldown: 8, weight: [0, 2.6, 2.4], range: [2.4, 5.4], maxAng: 0.9,
    },
    // a short hop onto the hero (red ring), then a bite
    pounce: {
      label: 'Pounce (2 hits)', tell: TELL.RED, phase: 2,
      hits: [
        // impact = the landing (the end of the active); radius around the forefeet's landing spot;
        // hop apex height (m) and the longest hop (model units)
        { kind: 'hop', tell: TELL.RED, windup: 0.8, active: 0.6, impact: 0.6, damage: 30, knockback: 5, knockdown: true, radius: 3.3 * S, height: 4.5, maxHop: 10 },
        // (windup 0.57: phase 3's x 0.7 put the bite 0.445 s after the landing; tuning, was 0.55)
        { kind: 'bite', tell: TELL.BLUE, windup: 0.57, active: 0.2, impact: 0.06, damage: 22, knockback: 2.5, reach: 5.4 * S },
      ],
      recovery: 1.0, cooldown: 7, weight: [0, 2.2, 2.4], range: [6.0, 13.0], maxAng: 1.0,
    },
    // phase 3: six or seven hits, a delayed claw, a blue bite and a red stomp to finish
    frenzy: {
      label: 'Frenzy (6-7 hits)', tell: TELL.RED, phase: 3,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 16, knockback: 1.2, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.5, active: 0.25, impact: 0.15, damage: 16, knockback: 1.2, turn: 0.8 },
        // (a short windup leaves the neck half coiled: the snap lands a little later than the bite's)
        { kind: 'bite', tell: TELL.NORMAL, windup: 0.55, active: 0.2, impact: 0.125, damage: 18, knockback: 1.5, reach: 5.4 * S },
        // (w2: was a claw; now the wing scythed across the front)
        { kind: 'wingSweep', side: 0, chance: 0.6, tell: TELL.NORMAL, windup: 0.5, active: 0.4, impact: 0.27, damage: 16, knockback: 3, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
        { kind: 'claw', side: 0, tell: TELL.NORMAL, windup: 0.5, hold: [0.3, 0.75], active: 0.25, impact: 0.15, damage: 18, knockback: 1.5, turn: 0.8 },
        { kind: 'bite', tell: TELL.BLUE, windup: 0.55, active: 0.2, impact: 0.12, damage: 24, knockback: 3, reach: 5.4 * S },
        { kind: 'stomp', tell: TELL.RED, windup: 0.85, active: 0.15, impact: 0.15, damage: 36, knockback: 4, radius: 4.5 * S },
      ],
      recovery: 1.2, cooldown: 12, weight: [0, 0, 1.8], range: [3.0, 5.4], maxAng: 0.9, // (w2: [0, 0, 3.4])
    },
    // the long clash: three quick claws, the overhead, the lunging bite. Five parries in rhythm
    // (the deflect chain rings higher with each); lighter blows than the rending flurry's
    stormFlurry: {
      label: 'Storm flurry (5 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 13, knockback: 1.2, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.42, active: 0.25, impact: 0.15, damage: 13, knockback: 1.2, turn: 0.8 },
        // (w2: was a third claw; now a wing scythed across)
        { kind: 'wingSweep', side: 0, tell: TELL.NORMAL, windup: 0.55, active: 0.4, impact: 0.27, damage: 15, knockback: 3, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
        { kind: 'overhead', side: 0, tell: TELL.BLUE, windup: 0.6, active: 0.24, impact: 0.22, damage: 18, knockback: 2.5, lunge: 2.4, turn: 2.2 }, // (w2: side -1, lunge 1.2; the scythe gives ground and turns it away)
        { kind: 'lungeBite', tell: TELL.BLUE, windup: 0.55, active: 0.24, impact: 0.05, damage: 20, knockback: 3.5, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.1, cooldown: 9, weight: [1.6, 1.6, 1.6], range: [3.0, 5.4], maxAng: 0.9, // (w2: [1.6, 2.2, 2.4]; merge [1.2, 1.4, 1.2])
    },
    // claws, a bite, then an overhead whose slam scatters hanging embers (`burst`: n embers that
    // drop on the hero one by one, `wait` s after the slam and `stagger` s apart, at `speed` m/s):
    // the string does not end on a free punish, it ends on four more parries (bullets.js)
    cinderFlurry: {
      label: 'Cinder flurry (4 hits + embers)', tell: TELL.BLUE, phase: 2,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 14, knockback: 1.2, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 14, knockback: 1.2, turn: 0.8 },
        { kind: 'bite', tell: TELL.BLUE, windup: 0.55, active: 0.2, impact: 0.06, damage: 20, knockback: 2.5, reach: 5.4 * S },
        { kind: 'overhead', side: 1, tell: TELL.BLUE, windup: 0.62, active: 0.24, impact: 0.22, damage: 18, knockback: 3, lunge: 1.2, burst: { n: 4, wait: 0.55, stagger: 0.34, speed: 11 } },
      ],
      recovery: 1.5, cooldown: 11, weight: [0, 2.0, 2.2], range: [2.4, 5.4], maxAng: 0.9, // (w2: [0, 2.2, 2.6]; merge [0, 1.4, 1.4])
    },
    // THE CHARGED BLOW (ADR-118): the head rears and holds, darkness drawn into the jaws (a second
    // and a half and a held beat that is never the same), then the snap. Black: dodge it. A guard or a
    // parry in its way is knocked wide open, the whole guard meter gone
    blackMaw: {
      label: 'Black maw (charged)', tell: TELL.BLACK, phase: 1,
      hits: [
        { kind: 'rearBite', tell: TELL.BLACK, windup: 1.5, hold: [0.15, 0.6], active: 0.2, impact: 0.06, damage: 44, knockback: 5, reach: 5.6 * S },
      ],
      recovery: 1.2, cooldown: 14, weight: [1.1, 1.3, 1.2], range: [3.5, 6.5], maxAng: 0.65, // (tuning: [1.3, 1.6, 1.8]: one cue in 3 s)
    },
    // ---- the whole body (w2 melee): strings of claws, jaws, wings, tail and fire. New kinds
    // (attacks.js): wingSweep (a wing scythed down and across the front: face = rad off the nose the
    // hero stands at on the wing's side as it starts, sweep = the body's pivot through it), wingSlam
    // (both wings down in front: radius round the slam point, locked near..far model units ahead),
    // tailWhip (a pivot puts the hero `at` rad off the nose, then a short `spin`), tailSlam (the tail
    // raised `lift` x its arch and brought down along a line: width = its reach either side, model
    // units), fireSnap (open jaws, a gout of fire: ticks of tickDamage every `tick` from `impact`, a
    // cone of `range` / `halfAngle`, tracked at `track` rad/s, `turn` rad/s whirl in its windup),
    // emberRake (a claw whose raked arc burns from ground.phase). `side: 0` = the side the hero is on
    // as that hit's windup starts. `ground`: the burning ground a fire blow leaves (a hazards strip
    // that only ticks: w m wide, linger s, tickDamage every tick s, blockable, never while rolling).
    // `links`: follow-ups the AI may chain straight into (tuningLinks.js; ai.js reads them).
    // a claw, a wing scythed across the front, a held claw (it may not come), a lunging bite (parry moment)
    wingRend: {
      label: 'Wing rend (3-4 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 15, knockback: 1.5, turn: 0.7 },
        { kind: 'wingSweep', side: 0, tell: TELL.NORMAL, windup: 0.65, active: 0.4, impact: 0.27, damage: 18, knockback: 4, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
        { kind: 'claw', side: 0, chance: 0.7, tell: TELL.NORMAL, windup: 0.5, hold: [0.2, 0.6], active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 1.0 },
        { kind: 'lungeBite', tell: TELL.BLUE, flare: true, windup: 0.6, active: 0.24, impact: 0.05, damage: 22, knockback: 3, reach: 6.0 * S, lunge: 2.5 * S },
      ],
      recovery: 1.0, cooldown: 7, weight: [2.6, 2.2, 1.6], range: [3.0, 5.4], maxAng: 0.9,
    },
    // he stands at its flank: a pivot and a tail whip (roll), a wing scythed across, a claw, and maybe the tail
    // back the other way
    pivotLash: {
      label: 'Pivot lash (3-4 hits)', tell: TELL.RED, phase: 1,
      hits: [
        { kind: 'tailWhip', tell: TELL.RED, windup: 0.85, active: 0.3, impact: 0.24, damage: 22, knockback: 4, at: 1.7, back: 0.3, spin: 165 * DEG, pivotRate: 5, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'wingSweep', side: 0, tell: TELL.NORMAL, windup: 0.8, active: 0.4, impact: 0.27, damage: 18, knockback: 4, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
        { kind: 'claw', side: 0, tell: TELL.NORMAL, windup: 0.55, active: 0.25, impact: 0.15, damage: 16, knockback: 1.5, turn: 1.3 },
        { kind: 'tailWhip', chance: 0.6, tell: TELL.RED, windup: 0.7, active: 0.3, impact: 0.24, damage: 22, knockback: 4, at: 1.7, back: 0.3, spin: 165 * DEG, pivotRate: 5, minReach: 2.0 * S, reach: 9.5 * S },
      ],
      recovery: 1.0, cooldown: 7, weight: [2.2, 2.2, 2.0], range: [2.4, 7.0], minAng: 1.0,
    },
    // he stands behind it: the tail rises over its back and hammers down along a line (roll aside),
    // whips round (roll), and a wing scythes across the front it has turned to him
    rearGuard: {
      label: 'Rear guard (3 hits)', tell: TELL.RED, phase: 1,
      hits: [
        // (windup 1.1, was 1.0: phase 3's x 0.7 let the slam come down a frame into the whip's windup at one
        // placement of TIMING; 1.1 x 0.7 = 0.77 s, the old phase 3's)
        { kind: 'tailSlam', tell: TELL.RED, windup: 1.1, hold: [0, 0.3], active: 0.34, impact: 0.34, damage: 32, knockback: 5, knockdown: true, width: 0.9, lift: 2.6, pivotRate: 3,
          ground: { phase: 2, w: 1.0 * S, linger: 1.6, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.1 } },
        { kind: 'tailWhip', tell: TELL.RED, windup: 0.75, active: 0.3, impact: 0.24, damage: 22, knockback: 4, at: 1.7, back: 0.3, spin: 165 * DEG, pivotRate: 5, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'wingSweep', side: 0, tell: TELL.NORMAL, windup: 0.7, active: 0.4, impact: 0.27, damage: 18, knockback: 4, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
      ],
      recovery: 1.0, cooldown: 8, weight: [2.2, 2.2, 2.0], range: [5.0, 6.0], minAng: 2.2,
    },
    // an overhead smash, a bite, then both wings brought down on him: the blue flare (parry it, he counters)
    skyHammer: {
      label: 'Sky hammer (3 hits)', tell: TELL.BLUE, phase: 1,
      hits: [
        { kind: 'overhead', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.24, impact: 0.22, damage: 18, knockback: 2.5, lunge: 1.2 },
        { kind: 'bite', tell: TELL.NORMAL, windup: 0.55, active: 0.2, impact: 0.08, damage: 18, knockback: 2, reach: 5.4 * S },
        { kind: 'wingSlam', tell: TELL.BLUE, flare: true, windup: 0.95, active: 0.3, impact: 0.3, damage: 30, knockback: 6, radius: 3.0 * S, near: 4.0, far: 7.0,
          burst: { phase: 2, n: 4, wait: 0.55, stagger: 0.3, speed: 11 } },
      ],
      recovery: 1.1, cooldown: 8, weight: [2.0, 2.2, 2.4], range: [2.4, 5.4], maxAng: 0.9, // (tuning: [2.0, 1.8, 1.4])
    },
    // phase 2: claws, a bite, the jaws open into fire (block it or get out of the cone; the ground
    // burns), and both wings brought down: red, roll (embers fly from the slam)
    furnaceMaw: {
      label: 'Furnace maw (5 hits + fire)', tell: TELL.RED, phase: 2,
      hits: [
        { kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 15, knockback: 1.2, turn: 0.7 },
        { kind: 'claw', side: -1, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 15, knockback: 1.2, turn: 0.8 },
        { kind: 'bite', tell: TELL.NORMAL, windup: 0.55, active: 0.2, impact: 0.118, damage: 18, knockback: 2, reach: 5.4 * S },
        { kind: 'fireSnap', tell: TELL.NORMAL, parryable: false, blockable: true, windup: 0.6, active: 0.6, impact: 0.12, tickDamage: 6, tick: 0.12, burn: 0.8, range: 7.5 * S, halfAngle: 24 * DEG, room: 3.6, backSpeed: 6, track: 0.6, turn: 4, fall: 0.2,
          ground: { w: 1.7 * S, linger: 1.4, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.1 } },
        { kind: 'wingSlam', tell: TELL.RED, windup: 0.9, active: 0.3, impact: 0.3, damage: 32, knockback: 6, knockdown: true, radius: 3.0 * S, near: 4.0, far: 7.5,
          burst: { phase: 2, n: 5, wait: 0.5, stagger: 0.28, speed: 12 } },
      ],
      recovery: 1.2, cooldown: 9, weight: [0, 2.8, 2.6], range: [2.4, 5.4], maxAng: 0.9, // (tuning: [0, 2.8, 2.4])
    },
    // phase 2: two burning rakes (the arcs burn), a tail whip, a whirl into a fire snap, maybe a bite,
    // an overhead that scatters embers: the parry moment
    cinderRake: {
      label: 'Cinder rake (5-6 hits + fire)', tell: TELL.BLUE, phase: 2,
      hits: [
        { kind: 'emberRake', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 15, knockback: 1.2, turn: 0.7,
          ground: { phase: 2, w: 1.2 * S, linger: 1.8, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.25 } },
        { kind: 'emberRake', side: -1, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 15, knockback: 1.2, turn: 0.8,
          ground: { phase: 2, w: 1.2 * S, linger: 1.8, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.25 } },
        { kind: 'tailWhip', tell: TELL.RED, windup: 0.7, active: 0.3, impact: 0.24, damage: 22, knockback: 4, at: 1.7, back: 0.3, spin: 165 * DEG, pivotRate: 5, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'fireSnap', tell: TELL.NORMAL, parryable: false, blockable: true, windup: 0.7, active: 0.6, impact: 0.12, tickDamage: 6, tick: 0.12, burn: 0.8, range: 7.5 * S, halfAngle: 24 * DEG, room: 3.6, backSpeed: 6, track: 0.6, turn: 4.5, fall: 0.2,
          ground: { w: 1.7 * S, linger: 1.4, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.1 } },
        { kind: 'bite', chance: 0.5, tell: TELL.NORMAL, windup: 0.55, active: 0.2, impact: 0.06, damage: 18, knockback: 2, reach: 5.4 * S },
        { kind: 'overhead', side: 1, tell: TELL.BLUE, flare: true, windup: 0.65, active: 0.24, impact: 0.22, damage: 22, knockback: 3, lunge: 1.2, burst: { n: 4, wait: 0.55, stagger: 0.32, speed: 11 } },
      ],
      recovery: 1.3, cooldown: 10, weight: [0, 2.6, 2.6], range: [2.4, 5.4], maxAng: 0.9, // (tuning: [0, 2.6, 2.2])
    },
    // phase 3: the cataclysm. Burning rakes, a held bite, a wing scythe, a tail whip, a whirl into
    // fire, a rake and a claw that may not come, and both wings down: the blue flare to end it
    cataclysm: {
      label: 'Cataclysm (7-9 hits + fire)', tell: TELL.BLUE, phase: 3,
      hits: [
        { kind: 'emberRake', side: 1, tell: TELL.NORMAL, windup: 0.75, active: 0.25, impact: 0.15, damage: 14, knockback: 1.2, turn: 0.7,
          ground: { phase: 2, w: 1.2 * S, linger: 2.2, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.25 } },
        { kind: 'emberRake', side: -1, tell: TELL.NORMAL, windup: 0.42, active: 0.25, impact: 0.15, damage: 14, knockback: 1.2, turn: 0.8,
          ground: { phase: 2, w: 1.2 * S, linger: 2.2, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.25 } },
        { kind: 'bite', tell: TELL.NORMAL, windup: 0.65, hold: [0.25, 0.6], active: 0.2, impact: 0.09, damage: 18, knockback: 2, reach: 5.4 * S },
        { kind: 'wingSweep', side: 0, tell: TELL.NORMAL, windup: 0.55, active: 0.4, impact: 0.27, damage: 18, knockback: 4, face: 0.55, sweep: 1.2, amp: 0.9, spread: 0.85, room: 5.0, backSpeed: 7 },
        { kind: 'tailWhip', tell: TELL.RED, windup: 0.65, active: 0.3, impact: 0.24, damage: 22, knockback: 4, at: 1.7, back: 0.3, spin: 165 * DEG, pivotRate: 5.5, minReach: 2.0 * S, reach: 9.5 * S },
        { kind: 'fireSnap', tell: TELL.NORMAL, parryable: false, blockable: true, windup: 0.65, active: 0.6, impact: 0.12, tickDamage: 6, tick: 0.12, burn: 0.8, range: 7.5 * S, halfAngle: 24 * DEG, room: 3.6, backSpeed: 6, track: 0.7, turn: 5, fall: 0.2,
          ground: { w: 1.7 * S, linger: 1.6, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.1 } },
        { kind: 'emberRake', side: 0, chance: 0.6, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 14, knockback: 1.2, turn: 1.2,
          ground: { phase: 2, w: 1.2 * S, linger: 2.2, tick: 0.3, tickDamage: 3, burn: 0.5, delay: 0.25 } },
        { kind: 'claw', side: 0, chance: 0.6, tell: TELL.NORMAL, windup: 0.45, active: 0.25, impact: 0.15, damage: 15, knockback: 1.2, turn: 1.2 },
        { kind: 'wingSlam', tell: TELL.BLUE, flare: true, windup: 0.85, active: 0.3, impact: 0.3, damage: 32, knockback: 6, radius: 3.0 * S, near: 4.0, far: 7.5,
          burst: { phase: 2, n: 6, wait: 0.5, stagger: 0.26, speed: 12 } },
      ],
      recovery: 1.3, cooldown: 12, weight: [0, 0, 3.0], range: [3.0, 5.4], maxAng: 0.9,
    },
    // THE QUICK BLOW (`?wyrmQuick=a`, ADR-223; tuningMotion.js WYRM_QUICK): a paw snapped out of the
    // stance with no rear-back (the stance is the tell); white, 0.5 s at phase 1 (0.35 = flashLead at
    // phase 3: its glint shows as it starts), close and ahead only, light
    snapSwipe: {
      label: 'Snap swipe', tell: TELL.NORMAL, phase: 1, quick: true,
      hits: [{ kind: 'claw', side: 1, tell: TELL.NORMAL, windup: 0.5, active: 0.22, impact: 0.12, damage: 11, knockback: 1.2, turn: 1.0 }],
      recovery: 0.6, cooldown: 6, range: [0, 4.4], maxAng: 0.7,
      get weight() { return lookOf('wyrmQuick', '0') === 'a' ? WYRM_QUICK.weight : 0; },
    },
    tail: {
      label: 'Tail sweep', tell: TELL.RED,
      // impact: player straight behind; + impactFlank for a player at the flank (~80 deg off the nose)
      // minWindup: the backswing's floor (phase 3's x0.78 left the tail on a hero straight behind: it
      // landed on the first active frame, 0.2 s before its flash + lead)
      windup: 0.9, minWindup: 0.76, active: 0.45, impact: 0.2, impactFlank: 0.1, recovery: 0.9,
      damage: 32, knockback: 3, cooldown: 2.5, weight: 2.4, spin: 200 * DEG,
      // swept-arc band around the root: the 16-segment tail's tip reaches 8.9 model units out in the
      // spin (measured v0.4) + its 0.45 hit sphere + the hero's radius
      minReach: 2.0 * S, reach: 9.5 * S,
    },
    stomp: {
      label: 'Stomp', tell: TELL.RED,
      windup: 1.0, active: 0.15, recovery: 1.0, // impact = end of active
      damage: 34, radius: 4.5 * S, knockback: 3, cooldown: 3, weight: 1.4,
    },
    // a stream: blockable (chip), not parryable; dodge through it or step out of the cone
    breath: {
      label: 'Fire breath', tell: TELL.NORMAL, parryable: false, blockable: true,
      windup: 1.1, active: 1.8, activeP2: 2.4, recovery: 1.0,
      tickDamage: 5, tick: 0.15, burn: 1.5, halfAngle: 28 * DEG, range: 11.5 * S, sweepP2: 70 * DEG,
      particlesPerSec: 200, cooldown: 8, weight: [1.0, 1.2, 0.7], // (tuning: [2.2, 2.64, 2.64]: one cue and a held guard in ~4 s)
      // the body while it breathes (w2): the aim is a heavy spring (k stiffness, c damping, acc rad/s²,
      // capped at maxV rad/s: the old constant 32 deg/s track; maxVP2 for the P2 rake's eased arc); the neck carries it within neckArc rad
      // of the facing, beyond that the body shuffles round at bodyTurn rad/s (was 1.2: a turntable);
      // the fire's kick lasts ~recoil s; the breath surges `surge` times a second
      track: { k: 9, c: 5, acc: 1.6, maxV: 32 * DEG, maxVP2: 50 * DEG }, neckArc: 0.45, bodyTurn: 0.7, recoil: 0.35, surge: 1.3,
    },
    // projectile blast radius is not body-linked: kept at the v0.1 size (approachable)
    fireball: {
      label: 'Fireball', tell: TELL.NORMAL,
      windup: 0.9, active: 0.35, activeP2: 0.9, recovery: 0.9,
      damage: 22, radius: 3, burn: 1.5, gravity: 16, cooldown: 6.5, weight: [2.5, 3, 3],
    },
    charge: {
      label: 'Charge', tell: TELL.RED,
      windup: 0.9, active: 1.0, recovery: 1.1,
      damage: 36, distance: 14 * S, knockback: 6, cooldown: 6, weight: 2,
    },
    leap: {
      label: 'Leap slam', tell: TELL.RED, phase: 2,
      windup: 0.8, air: 1.8, recovery: 1.2, // impact = landing (end of air)
      damage: 40, radius: 6 * S, knockback: 6, height: 10, cooldown: 13, weight: [0, 0.9, 0.5], // (tuning: 1.8 in P2 and P3: one cue in 3.6 s)
    },
    // phase transition roar: a damaging shock ring around the wyrm (also a Lab ability)
    roar: {
      label: 'Roar ring', tell: TELL.RED, phase: 2,
      windup: 1.2, roar: 1.6, recovery: 0.6,
      damage: 12, radius: 7 * S, knockback: 6,
    },
  },
};
Object.assign(TUNING.attacks, FIRE_ATTACKS); // fire / flight attacks and spells (tuningFire.js)
Object.assign(TUNING.attacks, BULLET_ATTACKS); // the bullet-hell patterns (tuningBullets.js)
Object.assign(TUNING.attacks, TERRAIN_ATTACKS); // the terrain moves (tuningTerrain.js, ADR-110)
Object.assign(TUNING.attacks, SPELLS); // the roar-cast spells: serpent, firestorm (tuningSpells.js, ADR-197)
Object.assign(TUNING.attacks, BROOD.moves); // the brood's moves: drakelings, wisps (tuningBrood.js, ADR-197)
// every move's combo links (tuningLinks.js: one table for the fight's flow)
for (const k in LINKS) if (TUNING.attacks[k]) TUNING.attacks[k].links = LINKS[k];

// Skeleton proportions in MODEL units (see SCALE above). Root = ground point under the torso centre,
// facing +Z, model-left = +X. See model.js for how these are assembled and docs/art/dragon.md
// (§1.2 skeleton layout, Appendix A) for where every number comes from.
// v0.4 "four-legged rebuild": a quadruped drake (columnar forelegs + digitigrade hind legs) with a
// separate pair of wings rising from the back (the v0.3 wyvern walked on its wing wrists).
export const ANATOMY = {
  withers: 4.0, // reference height H (top of the shoulders, no spikes): every ratio in the art spec is x H
  hipY: 2.4, // pelvis body joint when standing
  hipZ: -1.45,
  chest: [0, 0.45, 2.7], // ribcage body joint, hips frame -> root (0, 2.85, 1.25)
  neckBase: [0, 0.45, 0.45], // chest frame -> root (0, 3.3, 1.7)
  neckSegs: 7,
  neckLen: 0.46, // 3.2 chain, coiled into an upright S at rest (reads ~2.3); stretches for the bite
  headLen: 1.3,
  tailBase: [0, 0.15, -1.1], // hips frame -> root (0, 2.55, -2.55)
  tailSegs: 16,
  tailLen: 0.52,
  // hind legs (digitigrade: knee forward, hock high behind the toe)
  hipJoint: [1.0, -0.1, 0.1], // hips frame (x mirrored)
  thigh: 1.25,
  shin: 1.3,
  meta: 0.78,
  footHome: [1.25, 0, -1.45], // hind toe contact, root frame
  ankleOff: [0, 0.75, -0.15], // hock above / behind the toe contact (world-aligned, x yaw)
  // front legs (columnar, semi-digitigrade: elbow back, wrist 0.5 off the ground)
  shoulder: [1.0, -0.1, 0.6], // chest frame (x mirrored) -> root (+-1.0, 2.75, 1.85)
  humerus: 1.05,
  forearm: 1.37,
  hand: 0.45,
  handHome: [1.25, 0, 2.15], // front toe contact, root frame (outside the chest: reads from above)
  wristOff: [0, 0.42, -0.2], // front wrist above / behind the toe contact
  // wings: separate limbs on top of the back, behind the neck base
  wingRoot: [0.7, 1.0, -0.25], // chest frame -> root (+-0.7, 3.85, 1.0)
  wingHumerus: 1.5,
  // arm 4.1 (~1.0 H): long enough for the roar / breath wrists to stand ~1.85 H high and well out to
  // the side (the panel's raised 'M'); the half-raised sail keeps a ~135° elbow (fix round 1)
  wingForearm: 2.6,
  // f0 = leading edge, f3 = inner. knuckle = proximal fraction of each finger (the distal kink joint).
  // The proximal bones (wrist -> knuckle: fingers x knuckle = 3.35 / 3.48 / 2.88 / 2.21) are v0.4's:
  // the knuckles carry the wing hurt spheres (dragon.js). Only the distal bones (knuckle -> tip) are
  // longer (~1.35x, visual only): the owner's reference has huge bat wings (~1.6x was too much for the
  // game camera: the span nearly filled the screen).
  fingers: [6.2, 6.9, 5.5, 3.9],
  knuckle: [(5.4 * 0.62) / 6.2, (6.0 * 0.58) / 6.9, (4.8 * 0.6) / 5.5, (3.4 * 0.65) / 3.9],
  hipAttach: [1.0, 0.5, -0.15], // inner membrane's flank attach, hips frame -> root (+-1.0, 2.9, -1.6)
};
