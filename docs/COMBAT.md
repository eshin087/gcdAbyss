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
   rings and walls), so the wyrm can keep fighting while they burn. Each shows a red ground warning
   from spawn to impact. They are red: block and parry fail, i-frames or leaving the area avoid them,
   and a perfect dodge of one never plunges (slow-mo + crits in place). A burning strip's lingering
   fire deals small blockable contact ticks, never while you roll (ADR-029).
10. **Fairness checklist for every new attack:** tell type set (per hit for strings) · windup
    ≥ 0.7 s (melee; a string's first hit) and readable from the animation alone (parryable hits get
    no colour before the glint) · flash ~0.35 s before impact · string follow-ups ≥ 0.45 s apart ·
    hitbox matches the visual · recovery window to punish · no unavoidable damage (AoE red attacks
    and hazards show a red ground ring until impact; every hazard can be dodged with i-frames or by
    moving).

## Tell presentation
```
       windup start (combat:tell)            timing cue (combat:flash), 0.35 s before impact
red    body glows red, 0.1 ramping to 0.38   body spike 1.6, gone in 0.25 s
       red ground ring (AoE attacks)         red glyph burst + red light at the part
       audio: low brass sting                red screen-edge flash, ~0.25 s
normal animation only (faint audio tick)     white glint + bright ting
blue   animation only (blade 'shing')        white glint x1.5 (size, brightness)
hazard red ground warning from its spawn     its ring flares, red glyphs + a red light
       audio: a lighter hazard cue           no screen-edge flash
```
- **Dodge-only (`red`) — the attacker warns.** It glows red through the windup (creature material
  uniform `uWarn`: hot red `[1.0, 0.12, 0.05]`, strength ramps from 0.1 at the tell to 0.38 at the
  cue), gives a hard red flash on the cue (strength 1.6 decaying to 0 over 0.25 s, plus a red glyph
  burst and red light at the striking part). Audio: a low brass sting at windup start, a sharp
  crack on the cue. Area attacks also show a red glyph danger ring on the ground until impact. The
  HUD only adds a brief red screen-edge vignette on the cue (fades in ~0.25 s, stronger on the
  attacker's side) — nothing during the windup. Numbers: `TELL_STYLE.red.warn` in `rules.js`. In a
  string every hit is its own beat: a red hit glows through its own windup only.
- **Parryable (`normal`, `blue`) — the animation is the tell.** No colour coding during the windup
  (audio: a faint tick, or a blade "shing" for `blue`). On the cue a brief **white glint** (star
  core, four-point sparkle, a few short rays, a small white light) pops at the striking part with a
  short bright "ting". `blue` (heavy, big-posture) gets a ~1.5× larger, brighter glint
  (`TELL_STYLE.blue.glint`) and a richer ting — still white, never blue.
- **Hazards warn on the ground.** A ring of red `•` dots and `!` marks (an inner ring closes in as
  the impact nears), `>` chevrons down the path of a fire strip or wall, a hot red ring where a
  flame ring will ignite. Meteors and chase pillars announce themselves (their own `combat:tell` /
  `combat:flash` with `hazard: true`): audio plays a lighter cue (no brass sting, no music dip) and
  the HUD skips the red screen edge, so a meteor rain doesn't pulse the screen. The other hazards
  are covered by the spawning attack's own tell (the wyrm glows red through that windup). The
  meteor cast itself has no tell: it deals nothing, and each meteor warns for itself.
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
  glint / red burst on the flash, red ground rings for areas and hazards); audio plays the cues; the
  HUD adds only the red edge flash (not for hazards).

## Player moveset (owner concept sheet "Combat key poses")
Numbers live in `src/entities/player/combat.js` (`LIGHT`, `SPRINT_ATK`, `ROLL_ATK`, `THRUST`,
`CHARGE`, `REACH`); movement / defence timings in `TUNE` (`player.js`). The LMB chain is five hits
(ADR-041; it was sweep, backhand, slam: "the same 3 attack patterns").

| Move | Input | Timing (windup / active / recovery) | Damage | Posture | Notes |
|---|---|---|---|---|---|
| 1 — falling cut | LMB tap | 0.14 / 0.11 / 0.22 s (0.47 s) | 30 | 5 | cocked over the right shoulder (blade up-back-right), a diagonal down across the front, ending low at the left hip; cyan crescent |
| 2 — rising backhand | LMB tap in the recovery | 0.14 / 0.11 / 0.22 s | 32 | 5 | from low at the left hip up across the front to high right |
| 3 — whirl | 3rd tap | 0.16 / 0.17 / 0.24 s (0.57 s) | 36 | 5 | he follows the backhand round to his right: one full turn with the blade held out level; it crosses the front about two thirds of the way round, inside the active frames |
| 4 — stab | 4th tap | 0.12 / 0.09 / 0.22 s (0.43 s) | 30 | 5 | one-handed: the hand draws back to the right ribs, then drives the level blade straight out, the free arm thrown back |
| 5 — slam (finisher) | 5th tap | 0.40 / 0.12 / 0.48 s (1.0 s) | 58 | 16 | two-handed: the blade rises past the head and hangs down the back at the apex (torso arched), then slams into the ground; a crystal-shard burst (r 1.7 m) at the point hits if the blade missed |
| Sprint slash | LMB while sprinting (faster than a run) | 0.14 / 0.14 / 0.36 s | 40 | 5 | a bounding rising slash, low right → high left; carries 2.4 m along the RUN direction (it does not snap to the aim); counts as hit 1 (the next tap is the rising backhand) |
| Roll cut | LMB out of a forward roll | 0.10 / 0.11 / 0.26 s | 34 | 5 | a low cut rising out of the crouch, right → left; counts as hit 1. A backstep (Space with no direction) starts the plain chain |
| Thrust — charged | hold LMB ≥ 0.3 s, release | 0.07 / 0.20 / 0.45 s | 70–110 by charge (full at 1.2 s) | 12–20 | deep crouched charge, sword two-handed at the right hip pointing back-down (moves at ×0.4; lightning crawls on the blade past half charge); the release lunges 2.2–3.6 m along the facing with both arms driven out; a thin straight cyan beam |

- Poses follow the owner's key-pose sheets (`docs/art/hero.md` §4); the timings above are unchanged
  by them. The dodge roll stays 0.6 s (the sheet draws 0.55 s; shortening it is a tuning decision
  that would move the i-frames, so it was not taken). The light sweeps keep an eased arc whose
  front crossing lands at mid-active: a faster ease (closer to the sheet's 0.17 s "commit" frame)
  swung past the front before the step-in assist closed the gap and lost the 3–3.5 m REACH cases.
- Pacing: the next light starts right after the active frames; a roll / flask cancels a recovery
  after 35 %, movement after 60 %; RMB raises the guard out of any windup (not the active frames).
- **Reach against giant targets** (`REACH`): the wyrm's chest hangs 2–4 m above the grass, above a
  sword swung at a 1.75 m hero's chest, so the blade hits through a **vertical band**: a hurt sphere
  counts when it overlaps the blade's swept wall extended `up` 2.6 m above (the slam: 1.0 m) and
  `down` 0.5 m below it; the hit segment runs 0.4 m past the steel (the edge wave). Swings **step
  in** toward a hurt surface within 4.8 m and 0.8 rad of the facing (lunge stretched by ≤ 1.3 m).
  Result (`npm test` → scenario REACH): all five chain hits and the thrust connect from the front
  of an idle wyrm from contact out to 3.5 m from its chest surface.
- **Chain pacing (ADR-041):** the five hits deal 186 damage in 2.94 s (63 per second); the old three
  dealt 120 in 1.94 s (62 per second), so sustained damage is about the same and the finisher comes
  two taps later. One `win` bot run after the change: 154 s (177 s before); one run, not a trend.
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
7. **Land** (0.34 s, free to act after 0.12 s): the crit window (1.6 s, ×1.8) opens with 0.2 s of
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
- **Spells:** **Meteor rain** (a background hazard: meteors fall for ~5 s while the wyrm keeps
  fighting; every 3rd one is led onto you), **Fire eruptions** (lava pillars in a line toward you;
  in phase 3 they may chase you instead), **Flame ring** (expands from the wyrm: roll through it or
  be beyond 20 m), **Flame wall** (sweeps across the arena: roll through it), **Inferno nova** (a
  2.5 s charge, then an arena-sized blast: flee beyond 22 m or perfect-dodge it).
- Every blow is red. Hazard-dealt blows never plunge; the dive's crash and the nova's blast may (the
  wyrm is on the ground for both).
- Flash timing (`npm test` → FIRE): every blow lands within 17 ms of its flash + lead.

## Bullets (2026-11-09, ADR-039)
The wyrm's bullet-hell patterns (`bullets.js`, `bulletAttacks.js`; numbers `tuningBullets.js`) fill
the arena with small fire projectiles that fly at the hero's chest height. Three kinds:

| Bullet | Tell | Answers | Damage (final) |
|---|---|---|---|
| **Ember** (orange, small, straight) | normal | parry · block (chip) · roll through · cut with a swing | 8 |
| **Wisp** (blue-white, hangs, then homes in) | blue | parry · block · roll · cut | 13 + burn 0.8 |
| **Orb** (red, big, straight) | red | dodge only | 20 + burn 1.5, kb 3 |

- **Deflect.** A parried ember or wisp flies back to the wyrm's head (24 m/s) and adds posture (5 /
  12). It is a *light* clash (`player:parry {light: true}`: hit-stop 0.03 s, a quarter of the push
  back, a small shake), so a stream of them does not freeze the game; it counts in the hero's own
  parry rhythm (`chain`) but never recoils the wyrm and is not part of a string's `DEFLECT ×N`
  (`dragon:parried {bullet: true}`, no `onParried`).
- **One parry answers a clump.** A deflect opens a 0.3 s shield: small bullets that touch the hero
  in it pop, and so do the ones within 2.2 m of him or about to land within ~0.33 s.
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
| Ember storm `emberStorm` (1) | N | windup 1.1 · cast [3.4, 3.8, 4.2] · recovery 1.0 | [4, 4, 5] spiral arms of embers round the body (one per arm every 0.11 s, 7.5 m/s, the arms turning 1.05 rad/s); P2+ a ring of 8 / 10 red orbs every 1.6 s (5.5 m/s, one aimed at you); P3 three more arms winding the other way | 4 | [1.4, 1.8, 1.8] / 14 | ≤ 26 m |
| Cinder fan `fanVolley` (1) | N | windup 1.0 · [3, 4, 5] wing beats 0.7 apart · recovery 0.9 | each beat a fan of [7, 8, 9] embers over ±0.62 rad at 9 m/s; the first fan has an ember dead on you whatever the count, every second fan puts you in a gap; P2+ the last beat is a wave of 5 red orbs (7 m/s) | 3 | [2.2, 2.6, 2.6] / 9 | 5–30 m |
| Wisp swarm `wispSwarm` (2) | B | windup 1.0 · cast 1.3 · recovery 0.8 | [–, 7, 9] wisps roared out of the maw: they hang, then home in 0.45 s apart (cruise 5.2 m/s, turning 1.9 rad/s and tighter with age, 6.5 s of life); they outlive the roar | 4 | [0, 1.6, 1.8] / 16 | ≤ 30 m |
| Fire wheel `fireWheel` (2) | R | windup 1.3 (red lines on the ground) · burns [4.2, 4.2, 5.0] · recovery 1.2 | [4, 4, 5] walls of fire from 3.2 to 26 m, 1.1 m thick, turning like spokes at 1.05 rad/s and reversing once: roll through a spoke or run with it. 20 + burn 1.5, kb 4; each approaching spoke flashes | 2 | [0, 1.2, 1.5] / 20 | ≤ 24 m |

The Cinder flurry's last blow (below) also scatters four embers that drop on the hero one by one
(0.55 s after the slam, 0.34 s apart, 11 m/s): the string ends on four more parries, not on a free
punish.

Checked by `npm test` → BULLETS: every answer above per bullet kind, the cue's lead, the clump
rule, the grace, the hit caps, the point-blank dud, the clears, and each pattern in each phase it
runs in (a standing hero is hit at most `maxHits` times; a hero who answers the cues takes fewer
hits than one who stands still); the even-count fan's centring, a sidestepped wisp's second cue,
and the opening flash of a wisp swarm roared from 28 m.

## The Ash Disciple (2026-11-12, ADR-052, ADR-053; `?level=ash`)
A duelist: the same tell rules as the wyrm (every hit cued `flashLead` before impact, a move's first
windup ≥ 0.7 s in every phase, a string's hits ≥ 0.45 s apart, red hits glow and red areas ring the
ground), and the deflect chain (a move's non-final hit is deflected, its last recoils him). His own:
- **His guard** covers ±75° of his facing: in footwork (0.18 s after a move, a stagger or a recoil
  ends; at once after a clash or a flinch), through a clash, and through the first 55 % of each windup
  (after that he has committed: the strike can be traded). A strike into it deals nothing, adds guard
  posture (light 8, heavy 20) and clashes ("GUARDED"). In footwork each guarded strike in a row (within
  2.5 s) makes a counter likelier: 0, 35, 70, 100 % on the 1st–4th: the **Riposte** (N 0.78 · B 0.5).
  A heavy strike with posture ≥ 48 (the charged thrust from ~90 % charge; THRUST.poise 30–50) crushes
  the guard: it lands and he staggers (0.8 s). The chain's slam (posture 40) is turned aside.
- **Openings:** his recoveries; the recoil (1.0 s) after his last hit is parried; the Ghostep (a
  perfect dodge blinks the hero 1.5 m behind him, his `ghostepBehind`: the wyrm's 3.2 m is out of
  sword reach of a man's back; he offers no plunge, and his back is never guarded);
  the posture break. Strikes that land in his footwork make him flinch (his guard comes straight back
  up); after 2 within 1.6 s he backsteps out.
- **Feints never glint:** a feint has no tell and no flash. Only real impacts are cued.
- **Posture break → execution:** broken for 3.2 s on one knee (hits crit ×1.5); an attack within
  3.2 m runs him through: the execution thrust, 260 final damage, the break spent, he gives ground.
- **His reward:** beating him teaches the **Ash Riposte** (see Techniques below). Its counter
  pierces his guard and staggers him.
- **Two phases:** P1 100–50 %, P2 50–0 % (the gate holds damage at 50 % until the transition). The
  transition is **the Kindling**: he kneels, the blade kindles, a red shock ring (r 6 m, 10 damage,
  kb 6) at 1.75 s. In P2 windups × 0.92 and recoveries × 0.85; three moves join.
- **Footwork:** he circles at 3.0–5.6 m with his guard up, runs in beyond 7.5 m, backsteps (60 %)
  when the hero is closer than 1.9 m, and sidesteps a charged thrust levelled at him (45 %, once
  per 3 s). Idle gaps between moves: P1 0.45–0.95 s, P2 0.25–0.65 s.

**Moves** (`moves.js`; N normal, B blue, R red; P1 windup s (damage); hits test a zone from his
root through their active frames: sector r / ±ang, line r × w, ring r, metres):

| Move (phase ≥) | Hits | Zone / motion | AI band (m) · weight [P1, P2] · cooldown |
|---|---|---|---|
| Plum Thrust (1) | N 0.8 (18) | line 1.9 × 0.7; lunges ≤ 3.8 m | 3.2–6.8 · [2.2, 1.8] · 2.5 |
| Falling Ash (1) | B 0.95 (26) two-handed overhead chop | sector 2.3 / ±0.5; steps 0.9 m | 1.2–4.2 · [1.8, 1.6] · 3 |
| Swallow Flicks (1) | N 0.78 (14) · N 0.48 (14) · B thrust 0.55 (20) | sectors 2.1 / ±0.9, line 2.0 | 1.4–4.4 · [2.6, 2.2] · 4 |
| Crane Spins (1) | N spin 0.8 (15) · N spin 0.5 (15) · B leaping chop 0.65 (24) | rings 2.2 (steps 0.8 m into each), sector 2.4 | 1.4–4.0 · [2.0, 2.0] · 5 |
| Hesitating Blade (1) | feint 0.65 · B thrust 0.6 + hold 0.2–0.7 (22) · 50 %: N flick 0.48 (14) | line 2.0, sector 2.1 | 2.4–5.4 · [2.0, 2.2] · 5 |
| Lotus Sweep (1) | R 0.9 (22, knockdown) a low spin at the ankles | ring 3.0 (red ground ring) | 0–3.0 · [1.6, 1.6] · 6 |
| Wind Step (1) | N 0.85 (18) | glides in ≤ 9 m, sector 2.2 / ±1.0 | 5.5–12 · [2.4, 2.4] · 4 |
| Ash Crescent (1) | N 0.8 (14) sword qi along the ground, 14 m/s; P2 a fan of three (±0.36 rad) | each crescent cues itself `flashLead` before it reaches the hero (too late: it fizzles); parry or roll, block chips | 6–16 · [1.2, 2.0] · 5 |
| Riposte (counter) | N 0.78 (16) · B 0.5 (22) | sector 2.1, line 2.0 | only from his guard |
| Thousand Needles (2) | N 0.8 · N 0.45 · N 0.45 · N 0.45 (10 each) · B 0.55 (18) | lines 1.95 | 1.4–4.4 · [0, 2.6] · 7 |
| Ember Whirl (2) | N spin 0.8 (14) · N spin 0.5 (14) · R burning spin 0.75 (26, knockdown) | rings 2.2, ring 3.4 (red) | 1.4–4.6 · [0, 2.2] · 8 |
| Heaven-Splitting Fall (2) | R 1.5 (30, knockdown): a crouch, a leap (apex 3.6 m) | the red ring follows the hero until 67 % of the windup, then locks; ring 2.6 where he lands | 4.5–14 · [0, 1.6] · 10 |

Numbers (`tuning.js`): HP 3000, phases at [1, 0.5]; posture max [320, 380], regen after 2.5 s at
20 / s, parries `POSTURE.parry` (26 / 48), weapon hits 5 / 16 that land, guarded 8 / 20, a parried
Ash Crescent 8. Part multipliers head 1.3, body 1, legs 0.9. Every blow he deals (the table's
damage, the crescents) × `damageScale` 1.35 (a 26 lands as 35).
**Difficulty (measured, `npm test` → DUEL WIN, `node tests/integration/duel.mjs . probe`):** a god-mode
fencing bot that answers every tell wins in 50–54 s (three seeds; 3–4 breaks and executions);
mortal bots reading 85 % of the tells win in 54 s taking 1 hit; 70 % wins in 70–75 s on two seeds
with 1 and 0 flasks left (12–13 hits, worst 35); 60 % dies with him at 10 % HP. Target: 1.5–2.5 min
for a player who knows him. No human has played him yet.

## Techniques (2026-11-12, ADR-054)
Fixed rewards that change how the hero fights: each boss teaches one. Two slots, **Q** and **R**
(touch: a button per filled slot above BLOCK), both paid from one **Qi meter** (the player frame's
QI bar). Data: `src/entities/player/techniques/` (`QI` in `index.js`, one file per technique).

**The Qi meter** (max 100; defence fills it, so the reward pays out for the skill the bosses test):
| Source | Qi |
|---|---|
| a parry, normal / blue | 20 / 30 |
| … each further parry of a deflect chain (the hero's rhythm count) | +5, at most +15 |
| a deflected bullet or sword qi | 3 |
| a perfect dodge (the plunge, the Ghostep, the slow-mo in place) | 40 |
| a strike that deals damage, light / heavy (not a technique's own) | 3 / 6 |
A technique spends its cost as it starts. Dying and every retry empty the meter; resting at the
bonfire keeps it. Five parries in a row fill it; a perfect dodge and three parries do too.

**The Ash Riposte** (Shen Hui's counter; the Ash Disciple's reward; cost: a full meter, 100 Qi):
| Phase | Timing | Effect |
|---|---|---|
| stance | 0.8 s, raised after 0.03 s; rooted, turning to the aim | turns a **normal or blue** blow from its 150° front cone: the attacker is parried (its own deflect / recoil rules apply) |
| counter | windup 0.05 · active 0.18 · recovery 0.42 s; i-frames 0.45 s from the turn | a thrust aimed at the attacker's nearest hurt surface, lunging 0.4–3.6 m to stop 1.4 m short: **140 damage, 80 posture, pierces a guard** (a duelist staggers, guard up or not); a sweep miss on a target within reach + 0.4 m still lands |
| lunge (nothing came) | windup 0.08 · active 0.2 · recovery 0.45 s | a plain thrust along the aim, 2.6 m: 70 damage, 24 posture, no pierce |
- **Red blows are not turned**: they land as usual (a knockdown). The dodge stays the only answer
  to red.
- **Thrown blows** (bullets, the Ash Crescent's sword qi) and blows from an attacker whose nearest
  hurt surface is farther than 6 m are turned (a light clash) and the stance **holds**: no counter.
- A roll cancels the stance after 0.15 s; the Qi stays spent. A blow that lands breaks it.
- Q / R start it from neutral, the held guard, a parry or a Ghostep after their cancel points, the
  end of a roll, an attack's recovery after 35 %, or a charge (cancelled).
- Measured (`npm test` → TECHNIQUE): against the Ash Disciple a turned Plum Thrust is answered for
  126–140 damage (his part multipliers) and +80 posture on top of the parry's 26, and he staggers;
  a turned first flick of Swallow Flicks ends the string; against the wyrm a turned bite is
  answered for 210 on its head. No human has used it yet: how often a player fills the meter
  against him is unmeasured.

## Current numbers (v0.6 "bullet hell", 2026-11-09)
Source of truth: `rules.js` (`DEFENSE`, `POSTURE`), `player.js` `TUNE`, `tuning.js`, `tuningFire.js`,
`tuningBullets.js`.
**Damage scale (v0.6):** the wyrm attacks far more often than in v0.5, so every hit it deals through
`hitPlayer` is multiplied by `TUNING.damageScale` 0.85. The damage columns of the three tables below
are the data values *before* that scale (a 20 lands as 17). Bullets and the fire wheel are exempt
(the Bullets table above lists their final damage).
S = `SCALE` 1.875 (model units → metres).

**Player:** HP 160, 5 flasks (+70 HP, 0.85 s), roll 0.6 s (i-frames 0.04–0.4 s), backstep 0.4 s
(0.03–0.22 s), the moveset above. Parry window 0.22 s, re-arm 0.25 s (skipped right after a
deflect), perfect-dodge window 0.2 s, slow-mo ×0.3 for 0.6 s, crit window 1.6 s at ×1.8.

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
| Meteor rain `meteorRain` (2) | windup 1.0 · cast 0.7 · recovery 0.8; impacts from 1.3 s over 5 s, rings 1.5 s (led ones 1.1 s), a 0.75 s visible fall | 18 each, burn 1.5, kb 3; ≤ 3 hits | r 3.4; 8–11 meteors (P3 11–14), every 3rd led onto you, the rest 4–14 m round you | [0, 1.3, 1.4] / 24 | not while a rain falls |
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
  58, charged thrust 70–110 by charge (moveset table above).
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
