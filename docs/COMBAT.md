# Combat design

ABYSS is an action RPG, not a stamina-gated soulslike. Fights are about **reading tells** and
answering them with **block, parry or a perfectly timed dodge** — inspired by Phantom Blade Zero's
attack tells, read from the enemy itself rather than from HUD text, and by Sekiro's deflect
exchanges: an enemy's combo is met blow by blow. Numbers live in `src/combat/rules.js` (shared) and
each actor's `tuning`.

## Core rules
1. **No stamina.** Attacking, rolling, sprinting and blocking are free; pacing comes from attack
   recovery, roll recovery and the enemy's patterns.
2. **Every enemy attack has a tell** declared in its data: `normal`, `blue` or `red`
   (`TELL` in `rules.js`); every hit of a combo string has its own. Tells are **read from the
   attacker, never from HUD text or icons** (no PARRY / DODGE labels, no marks or rings over the
   enemy, no off-screen arrows). Every hit has a **timing cue ~0.35 s before impact**
   (`combat:flash`). Windups are long enough to react to (≥ 0.7 s in phase 1 for melee, the first
   hit of a string included; a string's next hit lands ≥ 0.45 s after the previous one). How each
   tell looks: see *Tell presentation* below.
3. **Answers**
   | Tell | Block (hold RMB) | Parry (tap RMB just before impact) | Dodge (Space) |
   |---|---|---|---|
   | `normal` — white glint | −80 % dmg, small pushback | full negate, posture dmg; a string goes on | i-frames; perfect → plunge |
   | `blue` — big white glint (heavy blow) | −50 % dmg, big pushback | full negate, **big** posture dmg; a string goes on | i-frames; perfect → plunge |
   | `red` — red glow + red flash | **fails** (full dmg, knockdown) | **fails** | **only answer**; perfect → plunge (a fire hazard: in place) |

   Attacks may override parry/block (a fire stream is blockable but not parryable). "Perfect →
   plunge" needs an attacker with a head to stab (the wyrm) within range; otherwise a perfect dodge
   gives the slow-mo and the crit window where you dodged (rule 5).
4. **Parry** = RMB pressed ≤ `parryWindow` (0.22 s) before impact, attacker within the front arc.
   Pressed ≤ `perfectParryWindow` (0.08 s) before impact it is a **perfect parry**
   (`player:parry.perfect`): a perfectly parried bullet comes back as a damaging shot (ADR-051,
   *Bullets* below); melee perfect parries change nothing yet.
   Mashing is prevented: RMB must be released `parryRearm` (0.25 s) before a new press counts —
   **except right after a successful parry**: a deflect re-arms at once, so the next press counts as
   soon as RMB was released, even when the guard was held between blows (ADR-032). A press that
   parries nothing needs the full re-arm again, so mashing still fails. Holding RMB after the press
   keeps blocking; between parries in rhythm the guard stays up (~0.3–0.6 s).
5. **Perfect dodge** = a dodge started ≤ `perfectDodgeWindow` (0.2 s) before impact:
   - against the wyrm, with its head within `DEFENSE.plunge.range` (30 m) → **the plunge** (below):
     you appear above its head and drive the blade in (ADR-027);
   - out of range, or against a hit that forbids it (`plunge: false`: the fire spells' hazards —
     meteors, pillars, rings, walls; fire breathed or spat from the air, the burning pass's stream
     and the hover barrage's shells, does allow it: the hero lands on the flying wyrm, which crashes) →
     **slow-mo + crits in place**: time slows (×0.3 for 0.6 s) and for 1.6 s your hits crit (×1.8),
     with no teleport;
   - against an attacker with no head to plunge into (future enemies) → the v0.2 **Ghostep**: a
     blink 3.2 m behind it (within 12 m), the same slow-mo and crits. The blink behind the wyrm is
     retired: players lost sight of themselves behind it.

   A dodge outside the window is a normal i-frame dodge. A dodge with no direction held is a
   **backstep** (shorter i-frames 0.03–0.22 s). Streams (fire breath) only count as a perfect dodge
   when the roll starts into them; rolling out of one is a plain dodge.
6. **Posture.** Enemies have a posture meter (gold bar under the boss HP). Parries fill it most (26 /
   48 per normal / blue parry, against 5 / 16 per light / heavy weapon hit; the plunge adds 40); at
   max the enemy is **broken** for 3.2 s (open: ×2.2 crits). It recovers after 3 s without posture
   damage. **Execution:** while the wyrm is broken, attack with its head within 9 m → the plunge as
   an execution (260 damage, no slow-mo); it spends the break.
7. **Phases and gates.** The wyrm has three phases: P1 100–66 %, P2 66–33 %, P3 33–0 % of its HP.
   While the AI runs the fight, damage stops at the next phase's threshold until its transition
   starts, so burst crits can't skip a phase (damage numbers still show). Each transition is a
   scripted roar (a red shock ring) that clears every fire hazard; the new phase's abilities then
   come in one by one, and phase 3 opens with the Inferno nova (ADR-028).
8. **Strings and the deflect chain.** A string is one attack of several hits. Parrying a hit that is
   not the string's last **deflects** it: its posture damage applies, the struck paw or head is
   knocked back (visual only), and the next hit comes on schedule. Parrying the **last** hit (or a
   single melee attack) recoils the wyrm: the punish window. A red hit inside a string must be
   dodged; a perfect dodge of it plunges and ends the string (ADR-026).
9. **Hazards** are world threats that live on their own (meteors, lava pillars, burning strips, fire
   rings and walls), so the wyrm can keep fighting while they burn. Each heats the ground it will hit
   from spawn to impact (ADR-052: a glow of small ground glyphs and scorch heat, darker to brighter
   as it nears; the exact edge in the last 0.35 s). They are red: block and parry fail, i-frames or leaving the area avoid them,
   and a perfect dodge of one never plunges (slow-mo + crits in place). A burning strip's lingering
   fire deals small blockable contact ticks, never while you roll (ADR-029).
10. **Fairness checklist for every new attack:** tell type set (per hit for strings) · windup
    ≥ 0.7 s (melee; a string's first hit) and readable from the animation alone (parryable hits get
    no colour before the glint) · flash ~0.35 s before impact · string follow-ups ≥ 0.45 s apart ·
    hitbox matches the visual · recovery window to punish · no unavoidable damage (AoE red attacks
    and hazards heat the ground they will hit until impact, the edge drawn in the last flashLead s;
    every hazard can be dodged with i-frames or by moving) · every projectile has a visible source
    (bullets leave the jaws, ADR-050).

## Tell presentation
```
       windup start (combat:tell)            timing cue (combat:flash), 0.35 s before impact
red    body glows red, 0.1 ramping to 0.38   body spike 1.6, gone in 0.25 s
       the ground heats up (AoE attacks)     red glyph burst + red light at the part
       audio: low brass sting                red screen-edge flash, ~0.25 s
normal animation only (faint audio tick)     white glint + bright ting
blue   animation only (blade 'shing')        white glint x1.5 (size, brightness)
hazard the ground heats up from its spawn     its edge shows, the heat flares, a warm light
       audio: a lighter hazard cue           no screen-edge flash
```
- **Dodge-only (`red`) — the attacker warns.** It glows red through the windup (creature material
  uniform `uWarn`: hot red `[1.0, 0.12, 0.05]`, strength ramps from 0.1 at the tell to 0.38 at the
  cue), gives a hard red flash on the cue (strength 1.6 decaying to 0 over 0.25 s, plus a red glyph
  burst and red light at the striking part). Audio: a low brass sting at windup start, a sharp
  crack on the cue. Area attacks also heat the ground of their danger area until impact (ADR-052). The
  HUD only adds a brief red screen-edge vignette on the cue (fades in ~0.25 s, stronger on the
  attacker's side) — nothing during the windup. Numbers: `TELL_STYLE.red.warn` in `rules.js`. In a
  string every hit is its own beat: a red hit glows through its own windup only.
- **Parryable (`normal`, `blue`) — the animation is the tell.** No colour coding during the windup
  (audio: a faint tick, or a blade "shing" for `blue`). On the cue a brief **white glint** (star
  core, four-point sparkle, a few short rays, a small white light) pops at the striking part with a
  short bright "ting". `blue` (heavy, big-posture) gets a ~1.5× larger, brighter glint
  (`TELL_STYLE.blue.glint`) and a richer ting — still white, never blue.
- **Hazards warn on the ground, diegetically (ADR-052).** The ground they will hit heats up: a
  sparse fill of small ground glyphs and the scorch map's heat, dark ember at spawn, orange by
  half way, white-orange at impact, sparks rising near the end; a thin bright rim marks the exact
  edge only in the last `flashLead` s; on the flash the heat flares. A strip heats ahead of its
  fire front (hottest just ahead of it), a flame ring where it catches round the body, a wall along
  its line. No red rings, no `!` marks, no chevrons. Meteors and chase pillars announce themselves (their own `combat:tell` /
  `combat:flash` with `hazard: true`): audio plays a lighter cue (no brass sting, no music dip) and
  the HUD skips the red screen edge, so a meteor storm doesn't pulse the screen. The other hazards
  are covered by the spawning attack's own tell (the wyrm glows red through that windup).
  Armageddon's rear-up and salvo glow red on the body (`dragon.bodyWarn`) but send no tell: the
  salvo deals nothing, and each meteor warns for itself.
- The glow clears the moment the windup is cancelled: stagger, posture break, parry recoil, the
  plunge's reaction, death, reset, or a Lab interrupt replacing the attack.
- After-the-fact feedback (PARRY / DEFLECT / DEFLECT ×N / GHOSTEP / EXECUTION / GUARD BROKEN
  call-outs, white/gold parry sparks, the clang that climbs with a deflect chain) is not a tell and
  stays.

## Contract (summary — full signatures in ARCHITECTURE.md)
- Attacker → defender: `defender.takeHit({ damage, from, knockback, knockdown, kind, burn, tell,
  parryable, blockable, attack, attacker, plunge })` returns a `RESULT` (`hit` / `blocked` /
  `parried` / `dodged` / `perfectDodge` / `ignored`). `plunge: false` keeps a perfect dodge of that
  hit from becoming the plunge (fire hazards).
- On `parried` the attacker calls its own parry reaction: a deflect for a string's non-final hit
  (posture + a knock-back; `dragon:parried {hit, last}`, `combat:deflectChain {count}`), a recoil
  (posture + the punish window) for its last hit or a single melee attack.
- On `perfectDodge` the defender plunges onto an attacker that offers `plungePoint(out)` /
  `onPlunge(o)` (in range, allowed by the hit), takes the slow-mo in place when it can't, and
  Ghosteps behind an attacker without that API.
- Attackers announce tells via events: `combat:tell` at windup start (per hit), `combat:flash` at the
  timing cue. The attacker draws its own tell in the world (red windup glow via `uWarn`, white
  glint / red burst on the flash, the ground heating up for areas and hazards); audio plays the
  cues; the HUD adds only the red edge flash (not for hazards).

## Player moveset (owner concept sheet "Combat key poses")
Numbers live in `src/entities/player/combat.js` (`LIGHT`, `SPRINT_ATK`, `ROLL_ATK`, `CLEAVE`,
`THRUST` (the execution's), `CHARGE`, `REACH`); the swings' key poses in `src/entities/player/swings.js`
(ADR-071); movement / defence timings in `TUNE` (`player.js`). The LMB chain is five hits (ADR-041;
it was sweep, backhand, slam: "the same 3 attack patterns"). Hits 1–4 are one-handed, the free hand
held composed against the sword hand, and he walks through them: the lead foot changes with every
hit. The slam and the charged cleave are two-handed.

| Move | Input | Timing (windup / active / recovery) | Damage | Posture | Notes |
|---|---|---|---|---|---|
| 1 — falling cut | LMB tap | 0.11 / 0.12 / 0.24 s (0.47 s) | 30 | 5 | one-handed: cocked beside the head (blade up-back-right), the free hand out toward the target; a diagonal down across the front as the hips turn through and the body sinks, ending low past the left hip; cyan crescent |
| 2 — backhand | LMB tap in the recovery | 0.11 / 0.12 / 0.24 s | 32 | 5 | back across his front from the left: rising from the left hip to high right, the body rising with it (or level at chest height with a pivot, or falling from over the left shoulder) |
| 3 — whirl | 3rd tap | 0.13 / 0.15 / 0.26 s (0.54 s) | 36 | 6 | he follows the backhand round to his right: one full turn with the sword arm thrown out level and the free arm flung wide, dropping into the turn and leaning to the inside of it, his head staying on the target and coming round ahead of the body; the blade crosses the front about two thirds of the way round, inside the active frames, and carries on round to his right |
| 4 — lunge | 4th tap | 0.11 / 0.10 / 0.24 s (0.45 s) | 30 | 6 | one-handed: the hand draws back to the right ribs with the free hand out along the line, then one long line from the rear heel to the point, the free arm thrown straight back |
| 5 — slam (finisher) | 5th tap | 0.28 / 0.13 / 0.42 s (0.83 s) | 66 | 18 | two-handed (ADR-076): he gathers (dips and coils right, the blade drawn down-back past the right hip), leaps as the blade sweeps up his right side and cocks over the shoulder, and brings it down in one diagonal across his front into the ground ahead and a little left, landing folded over the planted blade and holding it; a crystal-shard burst (r 1.7 m) at the point hits if the blade missed |
| Sprint slash | LMB while sprinting (faster than a run) | 0.11 / 0.13 / 0.32 s | 40 | 7 | a bounding rising slash, low right → high left; carries 2.4 m along the RUN direction (it does not snap to the aim); counts as hit 1 (the next tap is the rising backhand) |
| Roll cut | LMB out of a forward roll | 0.10 / 0.11 / 0.26 s | 34 | 6 | a low cut rising out of the crouch, right → left; counts as hit 1. A backstep (Space with no direction) starts the plain chain |
| Cleave — charged | hold LMB ≥ 0.3 s, release | 0.08 / 0.24 / 0.45 s | 70–110 by charge (full at 1.2 s) | 12–20 | a deep stance coiled away from the target, both hands on the grip beside the right ear, the blade standing nearly upright beside his head (moves at ×0.4; lightning crawls on the blade past half charge); the release dashes 2.2–3.6 m along the facing with the blade still cocked and carves one two-handed diagonal, high right to past the left hip, as the dash dies out (the blade crosses his front over the last 45 % of the active frames), sinking into a long low lunge that he holds; a wide crescent that hangs in the air, and on a hit a 0.15–0.2 s freeze, a ring and a fan of streaks (ADR-072; it was a lunging thrust) |

- **Variants** (ADR-055, ADR-071): hits 1–5 each have 2–3 looks, picked at random as the hit starts
  (never the same one twice in a row, and never along the line the swing before it cut, so two hits
  in a row are never in the same plane): 1 falling cut / low draw cut / rising slash with a skip;
  2 rising backhand / flat backhand with a pivot / falling backhand; 3 whirl / rising whirl / a
  crouching low sweep; 4 lunge / rising thrust out of a crouch; 5 the slam with a leap / nearly grounded (one clip; both come down from over the right shoulder: a diagonal). A variant
  changes only the look: the timing, damage, posture, reach and lunge in the table are the hit's,
  and every variant connects from the front at contact, 2 m and 3.5 m (the REACH test). The sprint
  slash, the roll cut and the cleave have one look each.
- **Diagonals** (ADR-071): no cut runs straight up and down. The blade stays under ~45° of
  elevation through a cut and crosses his front near chest height, so a "falling" cut runs from a
  high shoulder across the chest to the far hip. The camera looks down from behind him: a cut in an
  upright plane is drawn as one straight bar up the screen. The blade whips: the hand runs ahead
  through the first half of a cut, and the blade comes through and passes it as the cut ends.
- Poses follow the owner's key-pose sheets (`docs/art/hero.md` §4); the timings above are unchanged
  by them. The dodge roll stays 0.6 s (the sheet draws 0.55 s; shortening it is a tuning decision
  that would move the i-frames, so it was not taken). The light swings' blades cross his front at
  mid-active (the low sweep later, at ~65 %: a low blade reaches less far under a tall target): a
  cut that crossed earlier swung past the front before the step-in assist closed the gap and lost
  the 3–3.5 m REACH cases.
- Pacing (ADR-075): a light is a short gather, a quick cut and a held finish (0.11 / 0.12 s, then
  the next light may start 30 % into the recovery: `chain`), so a mashed chain lands a hit every
  ~0.32 s. History: 0.25 s a hit until Session 25, where the owner found the swings "too fast to
  follow" and they went to 0.42 s with a 0.18 s cut; then "its too slow right now" (Session 26). The
  cut is now as quick as the old one; what makes it readable is the pose at each end and the arc
  that hangs behind the blade (ADR-074). The slam has a `chain` too: a mashed button no longer cuts
  its landing off (the next chain starts ≥ 0.13 s after the blow). A roll / flask cancels a recovery
  after 35 %, movement after 60 %; RMB raises the guard out of any windup (not the active frames).
- **The recovery flows** (ADR-076): he starts back to the ready stance 30 % into the recovery (a
  clip's `home`), while the follow-through is still moving, so the blade never stands still between
  the cut and the way home and comes home at about half the cut's speed (it stopped for two frames
  and then snapped home in 0.12 s, as fast as it had cut). The slam and the cleave hold their finish
  (`home` 0.55).
- **Reach against giant targets** (`REACH`): the wyrm's chest hangs 2–4 m above the grass, above a
  sword swung at a 1.75 m hero's chest, so the blade hits through a **vertical band**: a hurt sphere
  counts when it overlaps the blade's swept wall extended `up` 2.6 m above (the slam: 1.0 m) and
  `down` 0.5 m below it; the hit segment runs 0.4 m past the steel (the edge wave). Swings **step
  in** toward a hurt surface within 4.8 m and 0.8 rad of the facing (lunge stretched by ≤ 1.3 m).
  Result (`npm test` → scenario REACH): all five chain hits and the cleave connect from the front
  of an idle wyrm from contact out to 3.5 m from its chest surface.
- **Chain pacing (ADR-041, ADR-071, ADR-075):** the five hits deal 194 damage in 2.76 s of full
  swings (70 per second; at the slow pace 237 in 3.79 s, 63). Mashed, the whole chain lands 194 in
  ~1.86 s, about 104 per second (the slow chain: 237 in ~2.17 s, 109): the lights' ×1.4 of the slow
  pace is gone (30 / 32 / 36 / 30 again) and the slam went from 58 to 66 for the beat its landing
  now holds. The old three dealt 120 in 1.94 s.
- The broad build (2026-11-09) kept the bones: the REACH table is unchanged; the hit segment moved
  by ≤ 2.5 cm on some active frames (ARCHITECTURE.md, animator).
- Not in the table: **the plunge** (a perfect dodge of the wyrm) and **the execution** (an attack
  near a broken wyrm's head), below. A flying wyrm is out of sword reach: only the plunge gets there.

## The plunge and the execution (2026-11-09, ADR-027)
A perfect dodge of the wyrm (any tell, except a fire hazard) with its head within 30 m:
1. **Vanish** (0.05 s): a cold afterimage at the dodge spot; the ×0.3 slow-mo starts (0.6 s real).
2. **Hang** (0.13 s, inside the slow-mo): he reappears 5 m above the head, 0.3 m out toward his
   landing side, coiled in a reverse grip. (The 58° camera sees height at about half scale: at the
   design's 2–3 m he was drawn on top of the head.)
3. **Dive** (0.14 s): accelerating onto the head as time snaps back.
4. **Impact:** 90 damage to the head, final (no head or break multiplier; the phase gate holds),
   +40 posture; a 0.13 s (real) hitstop at ×0.03 and a heavy shake. The wyrm's `plunged` reaction
   cancels its attack (not a phase transition or its death): the head is slammed to the ground, it
   thrashes and rises (1.35 s). A wyrm hit in the air falls (~0.6 s, longer from higher up) and
   crash-lands first.
5. **Ride** (0.42 s): he holds his place on the skull as it is slammed down.
6. **Flip** (0.5–0.85 s, apex +1.7 m): a backflip to a landing you can see, 4.5–12 m in front of
   the head toward where you came from (≥ 0.8 m clear of the body, inside the arena).
7. **Land** (0.34 s, free to act after 0.12 s): the crit window (2.2 s, ×1.8) opens with 0.2 s of
   i-frames.

The whole move is invulnerable (every hit is ignored) and takes ~1.6–1.9 s of game time (~2.2 s
real). The camera keeps the hero and the head on screen throughout.
**Execution:** while the wyrm is posture-broken, an attack press with its head within 9 m starts
the same move at the hang (no slow-mo, no perfect-dodge events): 260 damage (final), a heavier
reaction (slam 0.35, thrash 1.15, rise 0.5 = 2.0 s), and the break is spent (the meter starts over).
An EXECUTION call-out shows it. A plunge that lands during a transition roar (or the wake-up) only
deals its damage; a dying wyrm can't be plunged. Numbers: `DEFENSE.plunge` (`rules.js`),
`TUNING.plunged` (dragon).

## Strings and the deflect chain (2026-11-09, ADR-026)
**Strings** (`attacks.js` `makeString`, data in `tuning.js` `TUNING.attacks[name].hits`): an attack
of N hits, each with its own kind (performance), tell, windup (+ an optional random `hold` that baits
an early parry), active, impact, damage and knockback; a hit with `chance` < 1 may be rolled out.
Every hit announces itself (`combat:tell` at its windup start) and flashes `flashLead` (0.35 s)
before its real impact, holds included. Data rules (checked by `npm test` → STRINGS, all phases): a
tell per hit, the first windup ≥ 0.7 s, the flash after the tell, ≥ `minHitGap` 0.45 s from one
impact to the next (time to release and re-press RMB). The nine strings are in *Current numbers*.
**Verifier** (`npm test` → TIMING): every string and single melee attack, started through the AI's
own start path from every placement the AI picks it at (phases 1–3, the hero standing still), lands
each contact within ±85 ms of its flash + lead (worst 67 ms on the merged build), and every pick
lands its first hit. Later hits can whiff a hero who doesn't move (the TIMING table counts them).

**Deflect chain** (contract 1): parrying a hit that is not its string's last does not cancel the
string: the posture damage applies (`POSTURE.parry`), the struck paw / head is knocked back for
0.14 s (visual only) and the next hit comes on schedule. Parrying the last hit (or a single melee
attack) recoils the wyrm as before (the punish window). `dragon:parried` carries `{hit, last}`;
`combat:deflectChain {count}` fires from the 2nd parry in a row within one string (a hit that lands
or is blocked resets the count; dodges keep it) and shows as "DEFLECT ×N" over the hero. On the
hero's side each parry in rhythm (≤ 1.1 s apart) snaps the blade to the other side, slides him back
0.16 m (×1.6 for blue), grows the clash and raises the clang two semitones; the next tap counts at
once (rule 4). A red hit inside a string can't be parried or blocked: dodge it (a perfect dodge →
the plunge, which cancels the string). Rending flurry parried hit by hit: `dragon:parried` [0, f],
[1, f], [2, f], [3, true], chain 2 → 3 → 4, +148 posture, no damage (STRINGS scenario).

## Three phases (2026-11-09, ADR-028)
P1 100–66 %, P2 66–33 %, P3 33–0 % of 4500 HP, each threshold a gate until its transition roar
(always phase-1 timings; the red shock ring, 12 damage, which also clears the hazards). Later phases
speed the windups and recoveries up (the swings keep their speed), turn and walk faster, idle less,
grow the posture meter and glow hotter: phase 3 burns white-hot (crack glow 0.8, 50 body embers /
s) and opens with the Inferno nova. A pending transition waits for a plunge reaction to finish. A
new phase's abilities unlock one by one (opening cooldowns 2 + 2.5 × i + 0–2 s, in a random order),
not all at once after the roar.

## Fire attacks and hazards (2026-11-09, ADR-029, ADR-030)
- **Short flights** (take off, attack from the air, land, all inside one attack; no flight phase):
  the **Burning pass** (a low pass over you breathing fire down; the ground it passes burns for
  2.5 s), the **Sky dive** (climbs, hovers beside you while a red ring tracks you, dives onto the
  spot: the crash landing is the blow) and the **Hover barrage** (3–5 fireballs from the air, each
  landing in a red ring). Flying, the wyrm is out of sword reach; its body circles are off.
- **Spells:** **Armageddon** (ADR-053, key `meteorRain`; replaced the Meteor rain): the wyrm
  rears onto its hind legs, glowing red, the throat white-hot (1.4 s), and fires a salvo of 12 / 16
  bolts into the sky out of its jaws (1.6 s; it deals nothing: rearing for ~3 s, it is open to a
  hero close enough to reach its legs and belly). The sky answers: an orange glow overhead and a
  rumble while it drops to all fours and fights on. Then the meteors come down in waves over the
  whole clearing, falling on a slant from the sky above it: 3 waves of 8 (P2) / 4 of 10 (P3), 1.6
  s apart, 0.12 s between impacts. Each heats its ground for 1.5 s (a led one 1.2 s): every 3rd is
  led onto you (never two within 0.5 s), the rest spread evenly, and within 12 m of you a wave never
  covers more than 45 % of the ground, nor do two of its craters overlap by more than a third: there
  is always somewhere to stand. In P3 the craters burn on for 2 s (blockable contact ticks, never
  while rolling: walk out). 1.2 s after the last wave one great meteor falls on you (r 7, a 2 s
  warning). **Fire eruptions** (lava pillars in a line toward you;
  in phase 3 they may chase you instead), **Flame ring** (expands from the wyrm: roll through it or
  be beyond 20 m), **Flame wall** (sweeps across the arena: roll through it), **Inferno nova** (a
  2.5 s charge, then an arena-sized blast: flee beyond 22 m or perfect-dodge it).
- Every blow is red. Hazard-dealt blows never plunge; the dive's crash and the nova's blast may (the
  wyrm is on the ground for both).
- Flash timing (`npm test` → FIRE): every blow lands within 17 ms of its flash + lead.

## Bullets (2026-11-09, ADR-039; breathed, perfect returns and Hard: 2026-11-11, ADR-050, ADR-051)
The wyrm's bullet-hell patterns (`bullets.js`, `bulletAttacks.js`; numbers `tuningBullets.js`) fill
the arena with small fire projectiles that fly at the hero's chest height. **Every bullet is
breathed** (ADR-050): it leaves the wyrm's jaws along the way its head points, at mouth height, and
comes down to chest height before it reaches you (the head draws in over a close hero so the stream
is not fired over him). Nothing comes out of the body or the wings. Three kinds:

| Bullet | Tell | Answers | Damage (final) |
|---|---|---|---|
| **Ember** (orange, small, straight) | normal | parry · block (chip) · roll through · cut with a swing | 8 |
| **Wisp** (blue-white, hangs, then homes in) | blue | parry · block · roll · cut | 13 + burn 0.8 |
| **Orb** (red, big, straight) | red | dodge only | 20 + burn 1.5, kb 3 |

- **Perfect parry → return** (ADR-051). RMB ≤ 0.08 s before the impact: the ember or wisp comes
  back as a bigger white-gold shot (34 m/s) that hits the wyrm's head for HP damage (ember 30 ≈ a
  light hit, wisp 70 ≈ a heavy hit) and 14 / 30 posture instead of the deflect's, flinching the
  head (RETURN call-out, a gold burst, a 0.05 s stop, a brighter clang). Through the wyrm's own
  damage path: the phase gate holds, it may kill. It never interrupts the wyrm. Only the struck
  bullet returns. Orbs are never parried. A pattern gives back at most 120 HP in all
  (`returnBudget`, ~8 % of a phase: four embers or one wisp); past that a perfect parry is a plain
  deflect, so returns never out-damage the sword.
- **Deflect.** A parried ember or wisp flies back to the wyrm's head (24 m/s) and adds posture (5 /
  12). It is a *light* clash (`player:parry {light: true}`: hit-stop 0.03 s, a quarter of the push
  back, a small shake), so a stream of them does not freeze the game; it counts in the hero's own
  parry rhythm (`chain`) but never recoils the wyrm and is not part of a string's `DEFLECT ×N`
  (`dragon:parried {bullet: true}`, no `onParried`).
- **One parry answers a clump.** A deflect opens a 0.3 s shield: small bullets that touch the hero
  in it pop, and so do the ones within 1.5 m of him (was 2.2) or about to land within ~0.33 s.
- **Cut.** A light or heavy swing's active frames cut the small bullets within 0.45 m of the blade
  (`Player.isSwinging()`, the sweep segment). **Roll.** Rolling through a small bullet is a plain
  dodge (`hit.perfect === false`: no Ghostep, no slow-mo); the bullet flies on. An orb can be
  perfect-dodged like any red blow (slow-mo in place; bullets never start the plunge).
- **The cue (the fairness rule).** Every bullet that is going to hit announces itself `flashLead`
  (0.35 s) before impact: a glint on the bullet and a paired `combat:tell` + `combat:flash`
  `{hazard: true, bullet: true}` (a ping, no music dip). Impacts within 0.3 s of an announced one ride
  on that cue. A bullet that could only be announced later than 0.24 s before impact fizzles on
  touch when it is younger than 0.6 s (spawned point-blank); an older one hits (the hero ran into
  it). A cue stands for one impact: a homing wisp that misses and comes round again (still flying
  0.12 s after the impact it announced, `recue`) announces the second pass too, and fizzles when
  it could only do that too late. A pattern's opening flash follows its lead bullet even when the
  wyrm has already finished the move (a wisp swarm roared at a hero 25–30 m away).
- **No melting.** After a bullet hit every touching bullet fizzles for 0.45 s, and each pattern has
  a hit cap (below). The field is cleared on a phase change, the wyrm's death and a reset, and
  fizzles when its posture breaks.
- Bullet and fire-wheel damage is final: it is **not** scaled by `TUNING.damageScale`.

| Pattern (phase ≥) | Tell | P1 timing (s) | What flies | Hit cap | Weight [P1, P2, P3] / cooldown | AI gate |
|---|---|---|---|---|---|---|
| Ember torrent `emberStorm` (1) | N | windup 1.1 · cast [3.6, 4.2, 4.8] · recovery 1.0 | plants its feet and sweeps its head ±[0.9, 1.1, 1.25] rad across your bearing at [0.45, 0.55, 0.65] Hz, breathing an ember every 0.06 s (9 m/s) in [1, 2, 3] lanes 0.22 rad apart: snaking curtains that cross you once per half-sweep (parry the crossing or walk with the wave); P2+ at each sweep extreme the head snaps round and coughs [–, 3, 4] red orbs at you (6.5 m/s); P3's last 1.5 s is a full body pirouette, breathing: one spiral arm | 6 | [1.6, 2.0, 2.0] / 10 | ≤ 26 m |
| Cinder burst `fanVolley` (1) | N | windup 1.0 · [4, 6, 7] coughs 0.55 apart · recovery 0.9 | the head snaps onto you and coughs cones of [9, 11, 13] embers over ±0.55 rad at 10.5 m/s; the first has an ember dead on you, every second puts you in a gap (wider than you only from ~14 m off the jaws); P2+ the last cough is [–, 6, 7] red orbs (8 m/s); P3 every other cough is a double tap (a second cone 0.14 s later, half a spacing over: one parry's shield answers both), and 35 % of P3 bursts run straight into an Ember torrent | 5 | [2.4, 2.8, 2.8] / 6.5 | 5–30 m |
| Wisp swarm `wispSwarm` (2) | B | windup 1.0 · cast 1.3 · recovery 0.8 | [–, 10, 13] wisps roared out of the maw: they hang, then home in 0.36 s apart (cruise 6.2 m/s, turning 1.9 rad/s and tighter with age, 6.5 s of life); they outlive the roar; a new swarm may start while ≤ 3 are alive | 6 | [0, 1.6, 1.8] / 12 | ≤ 30 m |
| Scouring breath `fireWheel` (2) | R | windup 1.3 (the ground heats where the tongues will catch) · burns [4.6, 4.6, 5.4] · recovery 1.2 | a sustained breath strikes the ground before the snout and runs out as [3, 3, 5] tongues of fire over ±[0.45, 0.45, 0.8] rad of its aim, 1.5–26 m from the strike point, 1.1 m thick; the body turns them round at 2.15 rad/s (≥ 1.25 turns in all), the head stopping 0.25 s before it reverses once. It catches 0.55 rad beside you and sweeps onto you: roll through a tongue, or stay behind it. 20 + burn 1.5, kb 4; each approaching tongue flashes | 3 | [0, 1.2, 1.5] / 15 | ≤ 24 m |

The Cinder flurry's last blow (below) also scatters four embers that rise out of a puff of flame
where it lands and drop on the hero one by one (0.55 s after the slam, 0.34 s apart, 11 m/s): the
string ends on four more parries, not on a free punish.

Checked by `npm test` → BULLETS: every answer above per bullet kind, the perfect parry (RMB 0.05 s
before impact returns the shot for its damage and posture; 0.17 s is a plain deflect; an orb is
never parried; a return cannot push the wyrm past a phase gate; in a transition roar it deals what
a sword hit deals), the cue's lead, the clump rule, the grace, the hit caps, the point-blank dud,
the clears, and each pattern in each phase it runs in (every bullet born at the jaws along the
head's aim; a standing hero is hit at most `maxHits` times; a hero who answers the cues takes fewer
hits than one who stands still); the even-count burst's centring at range, a sidestepped wisp's
second cue, the opening flash of a wisp swarm roared from 28 m, and the P3 burst → torrent chain.

**Difficulty of the patterns** (scripted heroes, 2026-11-11; hits taken, standing / answering every
cue, before → after the Hard breath patterns):

| Pattern | P1 | P2 | P3 |
|---|---|---|---|
| Ember storm → torrent | 2 / 1 → 4 / 0 | 4 / 1 → 6 / 0 | 4 / 2 → 6 / 0 |
| Cinder fan → burst | 2 / 1 → 4 / 1 | 3 / 1 → 5 / 1 | 3 / 1 → 5 / 1 |
| Wisp swarm | – | 4 / 1 → 6 / 1 | 4 / 0 → 6 / 0 |
| Fire wheel → Scouring breath | – | 2 / 0 → 1 / 0 | 2 / 0 → 1 / 0 |
| Meteor rain → Armageddon | – | 3 (P1 values) → 5 / 0 | – → 5 / 0 (+ 31 crater ticks) |

A standing hero now takes the full cap in almost every pattern; the cue-answering bot (it parries
0.12 s before impact and rolls 0.1 s before a red one, in a frame) still comes through nearly clean,
so the patterns stay fair to perfect reads. Whether a person can read a P3 torrent with orbs is not
something a bot shows: a human playtest is owed.

## The Ash Disciple (2026-11-12, ADR-060 – ADR-063; `?level=ash`)
A duelist at **PBZ-boss speed** (owner, 2026-11-12): a move's first hit winds up 0.46–0.6 s (red
0.6–0.7 s), the hits of a string ~0.34 s apart, every strike a ~0.1 s snap out of its cock. The tell
rules hold at that speed: every hit cued by its flash `flashLead` 0.3 s before impact, a move's first
windup ≥ 0.42 s in every phase, a string's impacts ≥ 0.32 s apart (so each flash comes after the hit
before it), red hits glow and red areas ring the ground; the deflect chain (a move's non-final hit is
deflected, its last recoils him). His own:
- **His guard** covers ±75° of his facing: in footwork (0.18 s after a move, a stagger or a recoil
  ends; at once after a clash or a flinch), through a clash, and through the first 55 % of each windup
  (after that he has committed: the strike can be traded). A strike into it deals nothing, adds guard
  posture (light 8, heavy 20) and clashes ("GUARDED", a 0.07 s freeze, 0.11 s for a heavy strike). In
  footwork each guarded strike in a row (within 2.5 s) makes a counter likelier: 0, 35, 70, 100 % on
  the 1st–4th: the **Riposte**. A heavy strike with posture ≥ 48 (the charged cleave from ~90 %
  charge; CLEAVE.poise 30–50) crushes the guard: it lands and he staggers (0.8 s).
- **Openings:** his recoveries (0.45–0.8 s); the recoil (1.0 s) after his last hit is parried; the
  Ghostep (a perfect dodge blinks the hero 1.5 m behind him; no plunge; his back is never guarded); the
  reeling and trampled reactions of the moments below; the posture break.
- **Hit stun on him (ADR-063):** every blow that lands freezes the frame (light 0.065 s, heavy 0.1 s,
  a crit 0.12 s), snaps his chest and head back (a jolt layered on whatever he is doing) and shoves
  him 0.14 / 0.32 m along the blow. It never cancels a windup. In footwork a blow makes him flinch
  (after 2 within 1.6 s he backsteps); **in his recovery** a light blow makes him flinch and a heavy one
  staggers him.
- **Feints never glint:** a feint has no tell and no flash. Only real impacts are cued.
- **Posture break → execution:** broken for 3.2 s on one knee (hits crit ×1.5); an attack within
  3.2 m runs him through: the execution thrust (a cinematic moment), 260 final damage, the break
  spent, he gives ground.
- **Two phases:** P1 100–50 %, P2 50–0 % (the gate holds damage at 50 % until the transition). The
  transition is **the Kindling**: he kneels, the blade kindles, a red shock ring (r 6 m, 10 damage,
  kb 6) at 1.75 s. Windups × [1, 0.92], recoveries × [0.9, 0.8]; four moves join in P2.

### Pressure: how he closes (ADR-063)
(owner: "it shouldn't be attacking if it's not near the player or able to hit them ... it should
sprint and catch up ... instead of the player able to kite it out easily")
- **Striking range only.** He circles (guard up, 2.2 m/s) only inside 1.8–3.2 m, for a breather of
  P1 0.12–0.38 s / P2 0.08–0.26 s; beyond it he runs (5.6 m/s), beyond 5.5 m he **sprints at
  8.6 m/s** (the hero sprints at 7.2). Each move's AI band is the distance it can really reach from.
- **The step-in:** through every windup he steps toward the hero (a move's first hit up to 3 m, later
  hits 1.4 m, at most 12 m/s) so the blow arrives where its zone reaches him; the step, the track and
  every dash **lead** a moving hero (aimed at where he will be at the impact, from his velocity), so a
  running hero is met, not chased. A cut is never thrown at air.
- **Strings stop:** if the hero is out of reach of a string's next hit (a long roll, a Ghostep
  elsewhere) the string ends there and he goes after him (a sprint, or a move that reaches).
- **Flow:** when a move ends he goes straight into the next one 45 % of the time (P2 60 %).
- **A flask is punished:** while the hero drinks there is no breather, the moves that cover ground
  (a dash ≥ 3 m, the leap, the qi) weigh ×4, and he sprints in from any distance.
- He sometimes backsteps (30 %) when the hero is closer than 1.1 m, and sidesteps a charge
  held against him (45 %, once per 3 s).

### The duel's moments (ADR-062)
Sekiro / Phantom Blade Zero beats, each read from his data (`moves.js` beat flags, `tuning.js`):
- **Full deflect** — parry every hit of a string of ≥ 5 (Rain of Ashes 7, Thousand Needles 5) and
  the last parry throws him off balance: "PERFECT DEFLECT", `dragon:deflected`, posture +70, he
  **reels** (1.45 s, wide open) and the moment plays in slow motion. (Hundred Petals ends on a
  perilous thrust, so its climax is the mikiri instead.)
- **Blade lock** — a **perfect** parry (≤ `perfectParryWindow` 0.08 s before the impact) of a blow
  marked `lock` (Falling Ash, Falling Star, Crane Spins' leaping chop, the overhead cut in Rain of
  Ashes and Hundred Petals) crosses the blades: "BLADE LOCK", the camera closes in (7 m, no slow
  motion), a prompt `MASH [LMB]  [#####-----]` (touch: TAP ATTACK). Each press of attack or guard
  pushes +0.085; he pushes back 0.32 / s (P2 0.38). Full = won, empty = lost; when 2.6 s run out the
  hero wins at ≥ 0.6. About 1.5 s at 8 presses a second; 5 a second just holds it to the end; none
  loses in ~1.5 s. **Won:** "BREAKTHROUGH", posture +110, he reels, the hero gets the crit window
  (1.6 s) and 0.3 s of i-frames, slow motion. **Lost:** he shoves the hero (14, kb 2.6, unblockable)
  and comes straight in with the Riposte. The hero can't be hit while locked.
- **Mikiri (perilous thrust)** — a red thrust marked `mikiri` (Piercing Ash; the last hit of Hundred
  Petals) flashes `combat:flash` with `perilous: true`. A roll **into** it (the roll's direction
  against his facing, dot ≥ 0.55) whose impact comes within 0.3 s of the roll's start steps on the
  blade: "MIKIRI", `player:mikiri`, 0.55 s of i-frames, the crit window, posture +130, he is
  **trampled** (1.5 s, pinned), slow motion. A roll across or away is an ordinary dodge.
- **The cinematic** (`flow.cinematic`) — the full deflect, a won lock, the mikiri and the execution:
  time × 0.28 for 0.9 real s, easing back over the last third (the flow's own time scale, so an
  actor's short hitstop is not stretched over it), the camera 10 m closer, leaning 60 % toward the
  clash, a deep gong. A newer moment replaces a running one.

### Impact: the parry and the hit (ADR-063)
For every blade the hero meets (the wyrm's too; bullets keep their light clash):
- **A parry** freezes the frame (0.1 s; a blue blow 0.12 s; a perfect parry 0.15 s, at ×0.02), throws
  the clash's sparks already mid-burst (the freeze shows a burst, not a blot), a **shockwave ring** in
  the screen's plane that bursts out when time resumes (a blue or perfect parry: two rings), a camera
  kick (0.3–0.5), a **white flash** of the whole frame (`grade.flashPulse`: 0.28, blue 0.4, perfect
  0.85) and a heavier clang (a deep body, a low ring). The clash sits in front of the hero's guard.
- **A perfect parry** adds a beat of slow motion (× 0.35 for 0.36 real s, the camera 2.5 m closer:
  `game:cinematic` 'perfectParry', no gong), a gold ring and gold sparks, and a bright bell.
- **A blow that lands on the hero** freezes the frame (0.085 s; a big one 0.13 s) with a heavier
  shake (0.3–0.6) on top of the hurt flash and the stagger.
- **His blade** leaves a sweep trail through every strike, from the snap out of the cock through the
  follow-through: a crescent of strokes laid along each blade point's path, pale steel (ember in P2).

**Moves** (`moves.js`; N normal, B blue, R red; P1 windup s (damage); LOCK = a perfect parry locks
the blades, MIKIRI = perilous; hits test a zone from his root through their active frames: sector
r / ±ang, line r × w, ring r, metres; every hit also steps in, above):

| Move (phase ≥) | Hits | Zone / motion | AI band (m) · weight [P1, P2] · cooldown |
|---|---|---|---|
| Plum Thrust (1) | N 0.5 (18) | line 1.9 × 0.7; lunges ≤ 4.8 m | 2.6–6.8 · [2.0, 1.6] · 2.5 |
| Falling Ash (1) | B 0.6 (26) LOCK, two-handed overhead chop | sector 2.3 / ±0.5 | 0–3.8 · [1.6, 1.4] · 3 |
| Falling Star (1) | B 0.5 (24) LOCK, a leaping cut from high on his right | sector 2.3 / ±0.6, steps in ≤ 2.8 m | 0–4.2 · [2.2, 1.8] · 3 |
| Piercing Ash (1) | R 0.68 (30) MIKIRI, a low coiled thrust | line 2.1 × 0.7; dashes ≤ 6.5 m | 3–9 · [1.6, 1.8] · 5 |
| Rain of Ashes (1) | N 0.46 (14) rising · N 0.34 (13) backhand · N 0.34 (13) flat · B 0.4 + hold 0.1–0.3 (20) LOCK overhead · N 0.36 (12) diagonal · N 0.34 (12) flat back · B 0.4 (20) thrust | sectors 2.15–2.3, line 2.0 (dash ≤ 2.2) | 0–3.6 · [2.4, 2.2] · 7 |
| Swallow Flicks (1) | N 0.46 (14) rising · N 0.34 (14) backhand · B 0.4 (20) thrust | sectors 2.15, line 2.0 | 0–3.8 · [2.6, 2.2] · 3.5 |
| Crane Spins (1) | N spin 0.5 (15) · N spin 0.36 (15) · B leaping chop 0.46 (24) LOCK | rings 2.2, sector 2.4 (dash ≤ 3) | 0–3.6 · [2.0, 2.0] · 5 |
| Hesitating Blade (1) | feint 0.4 · B thrust 0.42 + hold 0.2–0.6 (22) · 50 %: N rising 0.34 (14) | line 2.0, sector 2.15 | 0–4.6 · [1.8, 2.0] · 5 |
| Lotus Sweep (1) | R 0.62 (22, knockdown) a low spin at the ankles | ring 3.0 (red ground ring) | 0–3.4 · [1.6, 1.6] · 6 |
| Wind Step (1) | N 0.56 (18) | glides in ≤ 10.5 m, sector 2.2 / ±1.0 | 4.6–13 · [2.6, 2.6] · 3 |
| Ash Crescent (1) | N 0.5 (14) sword qi along the ground, 14 m/s; P2 a fan of three (±0.36 rad) | each crescent cues itself `flashLead` before it reaches the hero (too late: it fizzles); parry or roll, block chips | 6–16 · [1.0, 1.6] · 5 |
| Riposte (counter) | N 0.46 (16) diagonal · B 0.36 (22) thrust | sector 2.15, line 2.0 | only from his guard, or after he wins a blade lock |
| Thousand Needles (2) | N 0.5 · N 0.34 · N 0.34 · N 0.34 (10 each) · B 0.38 (18) | lines 1.95 | 0–3.8 · [0, 2.6] · 6 |
| Hundred Petals (2) | N 0.5 · N 0.34 × 3 (11 each) · B 0.4 + hold 0.1–0.3 (18) LOCK · N 0.36 · N 0.34 × 2 (10) · B 0.36 thrust (16) · R 0.62 (26) MIKIRI | sectors 2.15–2.3, lines 2.0–2.1 | 0–3.6 · [0, 2.6] · 9 |
| Ember Whirl (2) | N spin 0.5 (14) · N spin 0.36 (14) · R burning spin 0.6 (26, knockdown) | rings 2.2, ring 3.4 (red) | 0–3.8 · [0, 2.2] · 7 |
| Heaven-Splitting Fall (2) | R 1.15 (30, knockdown): a crouch, a leap (apex 3.6 m) | the red ring follows the hero until 66 % of the windup, then locks; ring 2.6 where he lands | 4.2–14 · [0, 1.8] · 9 |

**His look and motion (owner picks, 2026-11-12):** a small straw hat (r 0.235 m), a long slender jian
(a 1.28 m blade from the guard, tapering to 60 %, bevelled edges and a ridge, disc guard and pommel,
a banded grip, a red tassel) held in **the classic jian guard** (pick "A" of three stances): side-on
and sunk, the right foot forward, the blade at chest height pointing straight at the hero, the free
hand's sword-finger raised in an arc over the head. His cuts are authored as the blade's path; the
hand follows the steel (poses.js `arm`), the hips and chest turn with it, the front foot steps in.

Numbers (`tuning.js`): HP 3000, phases at [1, 0.5]; posture max [320, 380], regen after 2.5 s at
20 / s, parries `POSTURE.parry` (26 / 48), weapon hits 5 / 16 that land, guarded 8 / 20, a parried
Ash Crescent 8; the moments above. Part multipliers head 1.3, body 1, legs 0.9. Every blow he deals
(the table's damage, the crescents, the shove) × `damageScale` 1.15 (a 26 lands as 30).
**Difficulty (measured at PBZ speed, `npm test` → DUEL WIN, `node tests/integration/duel.mjs .
probe`; seeds 4242 / 7 / 99):** a god-mode fencing bot that answers every tell wins in ~45 s (4
breaks and executions); mortal bots reading 85 % of the tells win all three in 48–52 s (7–8 hits
taken, 3–4 flasks left); 70 % die all three with him at 8–10 % HP (12–18 hits taken). At × 1.35
damage the 85 % bot won one of three: his pressure lands more blows than before, so each one hurts
less. The bots never use the blade lock (their parries are not perfect) or the mikiri (they roll
across red). Target: 1.5–2.5 min for a player who knows him. No human has played him yet.

## The Starless Lord (2026-11-13, ADR-068 – ADR-070; `?level=starless`)
Varr Nihil, a dark lord who fell out of the night sky and took the Obsidian Throne: black plate, a
horned helm with one slit of red light, blades of red light, and the Void in his free hand. The owner's
brief: very fast, acrobatic and fluid, strings of six with variations, jump and flip attacks, spells
between the cuts, four blade forms. He runs on the duelist engine (the Ash Disciple's: the guard, the
deflect chain, the blade lock, the mikiri, the full deflect, the Ghostep behind him, pressure and
hit stun are all as written above), with these differences.

**Four forms, four bars, a deathblow each** (the owner's pick):
| Form | Blades | Reach | A string's follow-up windup | Recovery × |
|---|---|---|---|---|
| 1 | one blade, the free hand casts | 2.3 m | 0.34 s | 0.9 |
| 2 | twin blades (the off hand's own) | 2.3 m | 0.32 s | 0.85 |
| 3 | the blades joined: a staff lit at both ends | 2.95 m | 0.30 s | 0.8 |
| 4 | one long cross-hilted blade, two-handed, the Void's aura | 2.6 m | 0.28 s | 0.72 |

- Each form has its own bar of 1400 HP (the boss bar shows four pips). **An empty bar does not kill
  him: it breaks him**, as a full posture meter does: on one knee for 4.5 s. An attack within 3.4 m
  then is the **deathblow** (the hero's execution thrust; DEATHBLOW call-out, the cinematic moment):
  the form ends. He is thrown back, rises, and the next form **ignites**: 2.1 s, then a red shock ring
  (r 6.5 m, 12 damage, knockback 7: roll through it or stand clear); nothing lands on him from the
  deathblow until that ring goes out. The fourth deathblow kills him.
- A break nobody answers: he rises with 20 % of the bar back (if it was empty) and half the meter.
- **Posture, the Sekiro rule:** every posture gain is × 0.45 on a full bar rising to × 1.25 on an empty
  one, and the meter recovers × 1.5 on a full bar down to × 0.5 on an empty one (22 / s after 2.2 s).
  Pure deflecting breaks him, slowly; cutting his bar down first makes his posture give way. Meter:
  [460, 500, 540, 600] per form. A parry gives the usual 26 / 48 (normal / blue) before that factor.
- **Speed:** a move's first hit winds up 0.48 – 0.62 s in form 1 (red 0.62 – 0.8 s); later forms scale
  windups × [1, 0.94, 0.89, 0.83], so a string's blows land 0.42 s apart in form 1 and 0.36 s in form
  4 (Shen Hui: 0.42 s). The glint comes 0.26 s before every impact (his `flashLead`; Shen Hui's is
  0.3 s) and never before the blow ahead of it has landed. Breathers [0.14 – 0.4, 0.1 – 0.32, 0.08 –
  0.26, 0.05 – 0.18] s; he flows straight into another move [40, 50, 55, 65] % of the time.
- **He keeps to the hall's floor** (a rectangle: between the walls, off the dais, inside the door), so
  a hero backed into a corner or against the door is still in his reach. He runs at 6 m/s and sprints
  at 9.2 m/s past 5.5 m (the hero sprints at 7.2).
- Every blow × `damageScale` 1.1.

**The Void** (his spells; each is read and answered like a blade):
| Spell | Tell | What it is | Answers |
|---|---|---|---|
| **Void lightning** | blue | 0.78 s with the hand raised, crackling, then a bolt down a 17 × 1.7 m line he tracks until 92 % of the windup | **parry** (it counts in a string's deflect chain: 48 posture); a **perfect parry sends it back**: 55 damage and 34 posture to him, RETURN; block halves it; roll |
| **Void push** | normal | a wall of force 4.8 m wide along the floor at 12.5 m/s (15 damage, thrown back 6.5 m) | parry cuts it (it cues itself 0.26 s before it reaches you); block: chip and a shove; roll through |
| **Void pull** | red | 0.8 s, then a 11 × 2.4 m line: 5 damage and you are dragged 5.5 m to him, into the blow that follows | roll (i-frames): the pull misses; a block is broken |
| **Returning blade** (forms 2, 3) | normal | the blade thrown spinning: out 12.5 m at 15 m/s, it hangs 0.32 s, then home to his hand at 17 m/s through you again (16 each way) | parry each pass (each cues itself); a parry on the way out turns it for home at once; roll |
| **Torn stone** (forms 3, 4) | normal + red | floor torn up beside him: three stones (14) thrown 0.42 s apart at 16 m/s, then a great one (red, 27, knockdown) | parry / cut the small ones, roll the great one |
| **The Starless Sky** (form 4) | red | six strikes, one called every 0.5 s onto where you are heading: a red ring (r 2.3 m) for 0.95 s, then the bolt (26, knockdown); he fights on meanwhile | leave the ring or roll as it lands |
| **Red tide** (form 4) | normal | three cuts that throw crescents of red light (1, a fan of 3, 1) at 14 m/s | parry, roll, block chips |
| **The blink** (form 4, Void Rend) | - | as a cut's windup starts he is gone and 2 m behind you (to your side if there is no floor there) | turn and parry, or roll: the cut is cued as any other |

Thrown things (the push, the crescents, the blade, the stones) cue themselves `flashLead` before they
reach the hero; one that could only cue later than 0.2 s before contact fizzles, as the wyrm's
bullets do. The ground under a strike is marked from the moment it is called.

**Moves** (`starlessLord/moves.js`; N normal, B blue, R red; form 1 windup s (damage); LOCK / MIKIRI as
Shen Hui's; `a | b` = one of the two is drawn as the move starts; weights are per form, 0 = not in it):
| Move (forms) | Hits | AI band (m) · cooldown |
|---|---|---|
| **Crimson Litany** (1) | N 0.48 (13) · N 0.34 (12) · N 0.34 (12) · B overhead 0.42 + hold 0.1–0.3 (20) LOCK `|` B thrust 0.4 (19) · N 0.36 (12) · B somersault chop 0.6 (24) LOCK `|` N 0.34 (12) · 50 %: B thrust 0.4 (19) | 0–3.8 · 6 |
| **Void Cadence** (1) | N 0.5 (13) · N 0.34 (12) · the push 0.55 · N 0.46 (12) · N 0.34 (12) · B thrust 0.4 (20) `|` a bolt 0.62 (20) | 0–4.2 · 7 |
| Starless Lunge (1, 4) | N 0.5 (17), a lunge ≤ 5 m | 2.6–7 · 2.5 |
| **Falling Star** (1, 2, 4) | B 0.72 (26) LOCK: a somersault across ≤ 5.5 m (apex 1.5 m), the chop where he lands | 2.2–7.5 · 4 |
| Reaping Arc (1) | R 0.62 (22, knockdown): a low spin, ring 2.9 m | 0–3.4 · 6 |
| Void Lightning (1, 2, 3) | B 0.78 (24) · 50 %: B 0.5 (22) | 4.5–16 · 5 |
| Void Push (all) | N 0.62 (15) | 2.5–11 · 5 |
| **Grasp and Sever** (all) | R pull 0.8 (5) · B overhead 0.62 (24) LOCK | 4.5–10.5 · 8 |
| **Twin Tempest** (2) | seven, the blades alternating: N 0.48 · N 0.34 · N 0.34 · N 0.34 (11 each) · B overhead 0.42 + hold (20) LOCK `|` B thrust 0.4 (18) · N 0.36 · N 0.34 (11) | 0–3.8 · 6 |
| **Bladed Gale** (2) | N spin 0.5 (13) · N spin 0.36 (13) · N 0.36 (11) · N 0.34 (11) · B somersault chop 0.6 (24) LOCK `|` R low spin 0.62 (22) | 0–3.8 · 7 |
| Scissor (2) | B 0.52 (22) LOCK: both blades thrust home on a dash ≤ 5 m | 2.6–7 · 3 |
| Returning Blade (2, 3) | N 0.6 (16), twice (above) | 4–13 · 9 |
| Reaping Arcs (2) | N spin 0.5 (13) · R low spin 0.6 (22) | 0–3.4 · 6 |
| **Cyclone** (3) | N 0.5 (13) · N 0.34 (13) · N spin 0.38 (14) · N spin 0.36 (14) · B overhead 0.44 + hold (22) LOCK `|` B thrust 0.4 (20) · R low spin 0.62 (24) `|` B somersault chop 0.6 (26) LOCK | 0–4.4 · 6 |
| **Turning Mill** (3) | four N spins walking forward 0.52 · 0.34 · 0.34 · 0.34 (12 each) · B thrust 0.42 (21) | 1.5–6.5 · 7 |
| Starfall (3, 4) | R 1.15 (30, knockdown): a leap (apex 3.8 m), the red ring follows you until 66 % of the windup | 4.2–14 · 9 |
| Torn Stone (3, 4) | above | 5–15 · 10 |
| Drawn Under (3) | R pull 0.8 · N spin 0.62 (16) · B overhead 0.42 (22) LOCK | 4.5–10.5 · 8 |
| **Judgment** (4) | N 0.5 (14) · N 0.34 (13) · N 0.34 (13) · B overhead 0.44 + hold 0.1–0.32 (22) LOCK · N 0.36 (13) · R perilous thrust 0.62 (28) MIKIRI `|` B somersault chop 0.6 (26) LOCK | 0–4 · 6 |
| **Eclipse** (4) | N 0.5 (13) · N 0.34 (13) · N spin 0.36 (14) · a bolt 0.5 (20) · N 0.42 (13) · B somersault chop 0.6 (26) LOCK `|` B thrust 0.4 (22) | 0–4 · 7 |
| **Void Rend** (4) | blink, N 0.62 (14) · blink, N 0.5 (14) · blink, B overhead 0.56 (24) LOCK (windups not scaled) | 0–12 · 8 |
| Chained Lightning (4) | four bolts: B 0.8 (20) · 0.46 (20) · 0.46 (20) · 0.46 (24) | 4–16 · 9 |
| Red Tide (4) | above (14 each) | 6–16 · 8 |
| The Starless Sky (4) | above | 0–16 · 14 |
| Riposte (each form its own) | 2–3 hits, only from his guard or after he wins a blade lock | - |

Checked by `npm test` → `tests/integration/lord.mjs`: LEVEL (the set, its colliders, the boss slot),
DATA (176 realisations: a tell per hit, first windup ≥ 0.4 s, blows ≥ 0.34 s apart, each flash after
the blow before it, a six-hit string that varies in every form, faster form by form), TIMING (42 move ×
form runs: every contact within 40 ms of its flash + 0.26 s, every move's first hit lands), FORMS (the
whole four-bar flow through the hero's own attack press), SPELLS (every answer in the table above),
BOUNDS (never off the floor; 47 blows reach a cornered hero in 45 s), FLOW (the door, the throne
intro, a death and the reset), WIN.
**Difficulty (measured, seed 4242, god-mode fencing bots):** a bot that answers every tell wins in
75 s with 63 parries (forms at 0 / 18 / 33 / 54 s); answering 85 % it takes 18 hits for 325 damage in
89 s (the hero has 160 HP and five flasks of 70: he would live); answering 70 % it takes 44 hits for
740 damage in 111 s (he would not). Shen Hui's 85 % bot takes 7 – 8 hits. Target: 3 – 5 min for a
player who knows him. No human has played him yet, and the bots never use the blade lock or the
mikiri and stand inside his reach the whole fight.

## Current numbers (v0.6 "bullet hell", 2026-11-09)
Source of truth: `rules.js` (`DEFENSE`, `POSTURE`), `player.js` `TUNE`, `tuning.js`, `tuningFire.js`,
`tuningBullets.js`.
**Damage scale (v0.6):** the wyrm attacks far more often than in v0.5, so every hit it deals through
`hitPlayer` is multiplied by `TUNING.damageScale` 0.85. The damage columns of the three tables below
are the data values *before* that scale (a 20 lands as 17). Bullets and the fire wheel are exempt
(the Bullets table above lists their final damage).
S = `SCALE` 1.875 (model units → metres).

**Player:** HP 160, 5 flasks (+70 HP, 0.85 s), roll 0.6 s (i-frames 0.04–0.4 s), backstep 0.4 s
(0.03–0.22 s), the moveset above. Parry window 0.22 s (perfect within 0.08 s: a bullet returns),
re-arm 0.25 s (skipped right after a deflect), perfect-dodge window 0.2 s, slow-mo ×0.3 for 0.6 s, crit window 2.2 s at ×1.8 (1.6 s until Session 25; kept at 2.2 s when the chain sped up again, ADR-075).

**The wyrm:**
- HP 4500. Phase gates at 66 % (2970 HP) and 33 % (1485 HP).
- Per phase [P1, P2, P3]: windups and recoveries × [1, 0.85, 0.78] (the swings, the flights'
  airborne parts, the nova's charge and the transition roars keep their timings); turn [70, 110,
  125] °/s; walk [3.0, 4.1, 4.6] m/s; idle gap [1.0–1.7, 0.7–1.2, 0.35–0.7] s (v0.5: [1.3–2.1,
  0.9–1.5, 0.4–0.8]); posture max [560, 640,
  720]; crack glow [0, 0.5, 0.8]; body embers [0, 22, 50] / s.
- Posture (`POSTURE`, unchanged since v0.2): parry 26 / 48 (normal / blue), weapon hit 5 / 16
  (light / heavy, ×1.25 on the head), regen after 3 s at 14 / s, break 3.2 s with ×2.2 crits. The
  plunge adds 40. A near-perfect defender breaks it about every 30–60 s.
- The plunge 90, the execution 260 (final damage). Reactions 1.35 s / 2.0 s (+ ~0.6 s fall in the air).
- Weapon-hit part multipliers: head 1.5, neck 1.15, body 1, tail 0.8, wing 0.9, leg 1.
- Opening cooldowns after the intro: breath 7, fireball 5, charge 4, leap 10 s. A new phase's
  abilities: 2 + 2.5 × i + 0–2 s (random order; the nova opener is not delayed).

**Single attacks** (N normal, B blue, R red; P1 times; weight = AI weight, per phase where an array):

| Attack (phase ≥) | Tell | Windup / active / recovery (s) | Damage | Weight / cooldown | Notes |
|---|---|---|---|---|---|
| Bite (1) | B | 0.75 / 0.2 / 0.8 | 24 | 1.5 / 1.2 | |
| Claw swipe (1) | N | 0.8 / 0.25 / 0.7 | 20 | 2.6 / 1.6 | foreleg rake |
| Tail sweep (1) | R | 0.9 (≥ 0.76) / 0.45 / 0.9 | 32 | 2.4 / 2.5 | spin 200°; the windup floor keeps it after its flash in P3 |
| Stomp (1) | R | 1.0 / 0.15 / 1.0 | 34 | 1.4 / 3 | ring r 4.5 × S |
| Fire breath (1) | N, blockable, not parryable | 1.1 / 1.8 (P2+ 2.4, sweeping 70°) / 1.0 | 5 per 0.15 s + burn | [2.2, 2.64, 2.64] / 8 | AI band 4.5–16 × S |
| Fireball (1) | N | 0.9 / 0.35 (P2+ 0.9: 3 shells) / 0.9 | 22, r 3 m | [2.5, 3, 3] / 6.5 | |
| Charge (1) | R | 0.9 / 1.0 / 1.1 | 36 | 2 / 6 | |
| Leap slam (2) | R | 0.8 / air 1.8 / 1.2 | 40, r 6 × S | 1.8 / 13 | |
| Roar ring (transitions) | R | 1.2 / 1.6 / 0.6 | 12, r 7 × S | never picked | |

**Strings** (hits: tell; P1 windup / active / impact s; damage):

| String (phase ≥) | Hits | Recovery / cooldown | Weight [P1, P2, P3] | AI band (× S from the root) |
|---|---|---|---|---|
| Claw combo (1) | claw (N; 0.8 / 0.25 / 0.15; 16) · claw (N; 0.55 / 0.25 / 0.15; 16) · lunge bite (B; 0.6 / 0.24 / 0.05; 22) | 1.0 / 5 | [2.4, 2.4, 2.0] | 2.4–5.4, ≤ 0.9 rad off the nose |
| Rending flurry (1) | claw (N; 0.75; 16) · claw (N; 0.45; 16) · overhead claw (B; 0.62 / 0.24 / 0.22; 22) · lunge bite (B; 0.55 / 0.24 / 0.05; 24) | 1.1 / 7 | [3.0, 2.8, 2.4] | 2.4–5.4, ≤ 0.9 |
| Hesitant maw (1) | reared bite (B; 0.85 + hold 0.25–0.9 / 0.2 / 0.06; 24) · 50 %: quick bite (B; 0.5 / 0.2 / 0.06; 20) | 0.9 / 6 | [2.4, 2.2, 2.0] | 3.5–6.5, ≤ 0.65 |
| Wing buffet (1) | wing slam (N; 0.8 / 0.3 / 0.25; 18, kb 5) · pivot + the other wing (B; 0.9 / 0.3 / 0.25; 22, kb 7) | 1.0 / 6 | [2.2, 2.4, 2.4] | 6.8–8.3, any side up to 2.6 rad |
| Tail lash (2) | claw (N; 0.75; 18) · pivot + tail lash (R; 1.0 / 0.36 / 0.245; 26) · tail sweep (R; 0.9 / 0.45 / 0.2 + flank 0.1; 30) | 1.0 / 8 | [0, 2.6, 2.4] | 2.4–5.4, ≤ 0.9 |
| Pounce (2) | a hop onto the hero (R, ground ring r 3.3 × S; 0.8 / 0.6 / 0.6 = the landing; 30, knockdown) · bite (B; 0.55 / 0.2 / 0.06; 22) | 1.0 / 7 | [0, 2.2, 2.4] | 6–13, ≤ 1.0 |
| Storm flurry (1) | claw (N; 0.75; 13) · claw (N; 0.42; 13) · claw (N; 0.42; 13) · overhead claw (B; 0.6 / 0.24 / 0.22; 18) · lunge bite (B; 0.55 / 0.24 / 0.05; 20) | 1.1 / 9 | [1.6, 2.2, 2.4] | 2.4–5.4, ≤ 0.9 |
| Cinder flurry (2) | claw (N; 0.75; 14) · claw (N; 0.45; 14) · bite (B; 0.55 / 0.2 / 0.06; 20) · overhead claw (B; 0.62 / 0.24 / 0.22; 18) that scatters 4 embers (see Bullets) | 1.5 / 11 | [0, 2.2, 2.6] | 2.4–5.4, ≤ 0.9 |
| Frenzy (3) | claw (N; 0.75; 16) · claw (N; 0.5; 16) · bite (N; 0.55; 18) · 60 %: claw (N; 0.5; 16) · a delayed claw (N; 0.5 + hold 0.3–0.75; 18) · bite (B; 0.55; 24) · stomp (R, ground ring; 0.85; 36) | 1.2 / 12 | [0, 0, 3.4] | 2.4–5.4, ≤ 0.9 |

**Fire attacks** (`tuningFire.js`; every blow red; sizes in world metres):

| Ability (phase ≥) | P1 timing (s) | Damage | Size | Weight [P1, P2, P3] / cooldown | AI gate |
|---|---|---|---|---|---|
| Burning pass `skyStrafe` (1) | windup 1.0 · takeoff 0.75 · pass 1.9 (7 m up) · land 1.05 | front 26 + burn 2, kb 4; the burning ground 4 per 0.25 s (blockable) | strip 4.6 m wide from 10 m out to 3 m short of the landing (24–40 m along the line), burns 2.5 s | [0.9, 1.4, 1.2] / 16 | 7–34 m |
| Sky dive `diveBomb` (2) | windup 0.8 · climb 1.1 · hover 1.2 (13 m up, 9 m beside the target; the tell) · dive 0.5 · recovery 1.4 | 34, knockdown, burn 1, kb 7; a perfect dodge may plunge | r 7.5 | [0, 1.6, 1.4] / 15 | any distance |
| Hover barrage `hoverBarrage` (2) | windup 0.8 · rise 1.0 (9 m up, 13 m beside you) · 3–5 shells 0.5 s apart, each ringing 0.4 s before its spit · land 1.2 | 15 each, burn 1.2, kb 2.5; ≤ 2 hits | r 3.2 | [0, 1.4, 1.2] / 13 | any distance |
| Armageddon `meteorRain` (2) | windup 1.4 · salvo 1.6 · recovery 0.9; the sky answers 0.8 s later, waves 1.6 s apart (0.12 s between impacts), the ground heating 1.5 s (led 1.2 s) under each, a 0.9 s visible fall; the great meteor 1.2 s after the last wave (a 2 s warning) | 20 each, burn 1.5, kb 3; ≤ 4 hits; the great one 34, kb 7 (not capped); P3 craters 4 per 0.25 s for 2 s (blockable) | r 3.4 (great r 7); 3 × 8 (P3 4 × 10) over the whole clearing, every 3rd led onto you, a wave covers ≤ 45 % within 12 m of you | [0, 1.2, 1.5] / 28 | not while a barrage or meteors fall |
| Fire eruptions `eruptions` (2) | windup 0.9 · slam 0.2 · recovery 1.5; pillar k erupts 0.65 + 0.11 k after the slam | 20, burn 1.2, kb 4 | r 2.4; ≤ 9 pillars 3.4 m apart from 5.5 m out to 7 m past you; P3 chase (60 %): a pillar under you every 0.42 s for 3 s, each ringing 0.7 s, ≤ 2 hits | [0, 1.5, 1.4] / 11 | 6–28 m, ≤ 1.3 rad |
| Flame ring `flameRing` (2) | windup 1.1 · cast 0.25 · recovery until the ring has run (≥ 1.85) | 24, burn 2, kb 4 | from 3 m round the wyrm to 20 m at 10 m/s, band 2.2 m | [0, 1.4, 1.2] / 12 | ≤ 14 m |
| Flame wall `flameWall` (3) | windup 1.2 · cast 0.3 · recovery until the sweep ends (≥ 3.15) | 28, burn 2, kb 5 | 40 m long × 2.4 m thick, springs up 4 m ahead, sweeps 30 m at 10 m/s | [0, 0, 1.6] / 14 | any |
| Inferno nova `nova` (3) | charge 2.5 in every phase · blast 0.45 · recovery 1.6 | 70, knockdown, burn 3, kb 10; a perfect dodge may plunge | r 22 | [0, 0, 0.7] / 32 | also the P3 opener |

**AI pick shares at close range** (measured for v0.5, before the two new strings and the four bullet
patterns joined the pool; not re-measured): P1 strings ~60 %, bite / stomp ~40 %; P2 strings ~39 %, fire and flights ~35 %, singles
~25 %; P3 strings ~42 %, fire ~41 %.

**Difficulty (measured, ADR-033).** Integration bots (`tests/integration/integ.mjs`): `win` is a
god-mode defender that answers every tell; the opt-in `probe` is a mortal bot that answers a share
of them (`ABYSS_SKILL`, default 0.8; `node tests/integration/integ.mjs . probe`) and fights until it
wins or dies. The v0.5 probe runs were at 4200 HP, before the last bump to 4500 (+~7 % fight length);
the v0.6 runs are one run each at 4500 HP (the sims are seeded, but one run is one sample).

| Bot | v0.5 (before the bullets) | v0.6 "bullet hell" (this build) |
|---|---|---|
| probe, 95 % of tells | wins in 145–150 s | wins in 134 s; took 110 of 160 HP (worst hit 20), 57 parries, 30 deflect chains, 15 perfect dodges, 9 plunges |
| probe, 85 % | wins 1 of 3 (129 s), dies 2 of 3 | dies at 122 s with the wyrm at 4 % HP (P3 reached at 99 s); 46 parries |
| probe, 70 % | always dies | not re-run |
| `win` (god mode) at 4500 HP | 157.5 s; P2 at 51 s, P3 at 91 s; 44 of 46 parries, 26 deflect chains (longest ×5), 24 plunges, posture breaks at 25 s and 87 s | 177 s; P2 at 60 s, P3 at 103 s; 77 of 82 parries, 39 deflect chains (longest ×5), 14 Ghosteps, 17 plunges, posture breaks at 24, 56, 100 and 136 s; 104 tells |

Reading: the bots land where they did in v0.5 (95 % wins, 85 % is on the edge), and the `win` bot parries
1.75× as often (77 against 44). The `win` fight is ~20 s longer because bullet patterns are time the wyrm is
not in sword reach. The bots do not cut bullets and heal poorly, so the probe's death rates are
pessimistic. Target: 3–5 min for a player who knows the moves, several deaths while learning it.
**A human playtest is still needed**: a bot answers a flash in a frame; whether a person can read
a phase-3 ember storm is not something these runs show.

## Earlier numbers (v0.2 "approachable RPG" … the reference match) — superseded
*Superseded 2026-11-09 by "Current numbers" above: HP 1500 → 4500, one phase gate at 50 % → three
phases, every attack's damage, the posture meter (120 / 140 → 560 / 640 / 720), the claw combo (now
a string). The geometry and timing measurements below (reaches, AI ranges, first contact against
the flash) still describe the single attacks; they are kept as history.*
- Player: HP 160, 5 flasks (+70 HP), roll 0.6 s with i-frames 0.04–0.4 s, light combo 30/32 + slam
  66, charged cleave 70–110 by charge (moveset table above).
- Cinder Wyrm: HP 1500, see `src/entities/dragon/tuning.js` for every attack's tell and timings.
  Size ×1.875 (`SCALE`): reaches, radii, hurt spheres and AI ranges scale with it, windups / tells
  / flash timing do not. v0.4 four-legged rebuild (docs/art/dragon.md): every ability keeps its
  name, tell, windup, flash timing and damage; who does the work changed, so the 3D swings were
  re-measured against the (unscaled) hero in the integration sims (model units from the root):
  - bite: the short S-neck (3.2 chain from a neck base 1.7 ahead of the root) lands it 3–6.5 out
    (was 3.7–8.4 with the wyvern's long neck); head snap 18/s, snout sphere 1.05 × SCALE.
  - swipe: now a FORELEG rake (paw sphere 1.1, wrist 0.8, forearm 0.75 × SCALE; 0.5 forward
    lunge) landing 2–5.5 out from ~23° to ~77° off the nose (2.75–5.5 beyond ~66°: right beside
    the shoulder the paw passes over the hero); the claw combo's three hits all land 3–5.4.
  - stomp: rears up on the hind legs (`pose.rear`: both forefeet leave the ground), slams the
    forefeet down onto (±1.2, 0, 2.9); the slam ring is unchanged (centre 2.9 ahead = between the
    two landing paws, r 4.5). Its tell part is 'forefeet' (the red flash bursts at both paws).
  - The hero is kept out from under the belly by a loins body circle (1.15 × SCALE) between the
    chest and hips circles; each planted foot adds a 0.45 × SCALE circle.
  - Stage 2 (attack performances per docs/art/dragon.md §5) re-measured in the sims / Lab:
    `MOUTH_Z` 5.8 → 4.3 (the short neck spits from ~4.3 ahead), `CHARGE_REACH` 7.15 → 6.8 (snout
    ~5.65 ahead during the run + its 1.15 sphere; the head goal now leads by the run speed so it
    doesn't trail behind the chest), tail sweep `reach` 9.6 → 9.5 (the 16-segment tail's tip
    reaches 8.9 in the spin + its 0.45 sphere + the hero's radius). Every AI pick of bite / swipe /
    claw combo / tail / stomp lands in the coverage probe, and each hit lands close to its
    `combat:flash` + `flashLead` across the picked distances (integration verifier, AI start path,
    1–10 model units × 0–360°, both phases: bite −17…+67 ms, swipe −50…+33, claw combo −17…+33,
    stomp 0, charge 0…+17, tail −83…+83). Timings, tells and damage unchanged.
  - Tail sweep windup fix (verifier): the windup curled the tail back toward the player
    (`tailCurl` = `dir` × 0.06, against the body's 0.35 rad backswing), and with the new resting
    hook its tip lay over a hero standing straight behind, so the sweep landed on the first active
    frame, up to 0.2 s before flash + lead (−200 ms AI path, −217 ms Lab path; v0.3 had −133 /
    −67). It now coils away from the player (`tailCurl` = −`dir` × 0.06, the same side as the
    backswing and the spin's trailing curl): −83 ms worst (AI path), −67 ms (Lab path).
  - Look fix round 1 (no gameplay number changed): the wing forearm is 2.6 model units (was 2.05)
    and the resting wings are mantled HALF in both phases (wrists ~7.5 up, ~14 m), so the two wing
    hurt spheres (wrist, finger-1 knuckle) sit higher and further out; they were already above the
    hero's sword band, and every melee band / AI range re-checks unchanged in the sims.
  - Reference match (2026-11-08; no timing, tell, damage or reach number changed; ADR-024): the
    hero's attack active frames are bit-identical to v0.4's poses (192 hit-tested frames compared);
    the wyrm's attack spheres stay within a few cm on their active frames (round 2 vs round 1 within
    4 mm, the rake paw 2.3 cm). First contact is identical for bite, claw combo and charge probes;
    three swipe placements that missed in v0.4 now land (+33 ms); the tail sweep's median contact is
    −50 ms (v0.4 −58.5) and it no longer lands before its red flash (0 of 24 probes; v0.4: 5). Hurt
    volumes that moved: the arched resting tail lifts its first spheres to ~3–4.5 m (a hero behind
    the wyrm hits hips and legs more, the tail less); the resting head (lower, on the painting's S)
    keeps its sphere above the sword band (bottom ~5.9 m vs ~4 m). The 1.3× drawn head, the longer
    distal finger bones and the thicker drawn tail are visual only.
