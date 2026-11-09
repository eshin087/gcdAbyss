# Combat design

ABYSS is an action RPG, not a stamina-gated soulslike. Fights are about **reading tells** and
answering them with **block, parry or a perfectly timed dodge** — inspired by Phantom Blade Zero's
attack tells, read from the enemy itself rather than from HUD text. Numbers live in
`src/combat/rules.js` (shared) and each actor's `tuning`.

## Core rules
1. **No stamina.** Attacking, rolling, sprinting and blocking are free; pacing comes from attack
   recovery, roll recovery and the enemy's patterns.
2. **Every enemy attack has a tell** declared in its data: `normal`, `blue` or `red`
   (`TELL` in `rules.js`). Tells are **read from the attacker, never from HUD text or icons** (no
   PARRY / DODGE labels, no marks or rings over the enemy, no off-screen arrows). Every hit has a
   **timing cue ~0.35 s before impact** (`combat:flash`). Windups are long enough to react to
   (≥ 0.7 s in phase 1 for melee). How each tell looks: see *Tell presentation* below.
3. **Answers**
   | Tell | Block (hold RMB) | Parry (tap RMB just before impact) | Dodge (Space) |
   |---|---|---|---|
   | `normal` — white glint | −80 % dmg, small pushback | full negate, posture dmg | i-frames; perfect → Ghostep |
   | `blue` — big white glint (heavy blow) | −50 % dmg, big pushback | full negate, **big** posture dmg | i-frames; perfect → Ghostep |
   | `red` — red glow + red flash | **fails** (full dmg, knockdown) | **fails** | **only answer**; perfect → Ghostep |
   Attacks may override parry/block (a fire stream is blockable but not parryable).
4. **Parry** = RMB pressed ≤ `parryWindow` (0.22 s) before impact, attacker within the front arc.
   Mashing is prevented: RMB must be released `parryRearm` (0.25 s) before a new press counts.
   Holding RMB after the press keeps blocking.
5. **Perfect dodge** = a dodge started ≤ `perfectDodgeWindow` (0.2 s) before impact → **Ghostep**:
   the player blinks behind the attacker, time slows (×0.3 for 0.6 s), and for 1.6 s the player's
   hits crit (×1.8). A dodge outside the window is a normal i-frame dodge. A dodge with no
   direction held is a **backstep** (shorter i-frames 0.03–0.22 s). Streams (fire breath) only
   Ghostep when the roll starts into them; rolling out of one is a plain dodge.
6. **Posture.** Enemies have a posture meter (gold bar under the boss HP). Parries and weapon hits
   fill it; at max the enemy is **broken** for 3.2 s (open: ×2.2 crits). It recovers after 3 s
   without posture damage.
7. **Phase gate.** While the AI runs the fight, phase-1 damage stops at the phase-2 threshold until
   the transition starts, so burst crits can't skip phase 2 (damage numbers still show).
8. **Fairness checklist for every new attack:** tell type set · windup ≥ 0.7 s (melee) and
   readable from the animation alone (parryable hits get no colour before the glint) · flash
   ~0.35 s before impact · hitbox matches the visual · recovery window to punish · no unavoidable
   chip (AoE red attacks show a red ground ring).

## Tell presentation
```
       windup start (combat:tell)            timing cue (combat:flash), 0.35 s before impact
red    body glows red, 0.1 ramping to 0.38   body spike 1.6, gone in 0.25 s
       red ground ring (AoE attacks)         red glyph burst + red light at the part
       audio: low brass sting                red screen-edge flash, ~0.25 s
normal animation only (faint audio tick)     white glint + bright ting
blue   animation only (blade 'shing')        white glint x1.5 (size, brightness)
```
- **Dodge-only (`red`) — the attacker warns.** It glows red through the windup (creature material
  uniform `uWarn`: hot red `[1.0, 0.12, 0.05]`, strength ramps from 0.1 at the tell to 0.38 at the
  cue), gives a hard red flash on the cue (strength 1.6 decaying to 0 over 0.25 s, plus a red glyph
  burst and red light at the striking part). Audio: a low brass sting at windup start, a sharp
  crack on the cue. Area attacks also show a red glyph danger ring on the ground until impact. The
  HUD only adds a brief red screen-edge vignette on the cue (fades in ~0.25 s, stronger on the
  attacker's side) — nothing during the windup. Numbers: `TELL_STYLE.red.warn` in `rules.js`.
- **Parryable (`normal`, `blue`) — the animation is the tell.** No colour coding during the windup
  (audio: a faint tick, or a blade "shing" for `blue`). On the cue a brief **white glint** (star
  core, four-point sparkle, a few short rays, a small white light) pops at the striking part with a
  short bright "ting". `blue` (heavy, big-posture) gets a ~1.5× larger, brighter glint
  (`TELL_STYLE.blue.glint`) and a richer ting — still white, never blue.
- The glow clears the moment the windup is cancelled: stagger, posture break, parry recoil, death,
  reset, or a Lab interrupt replacing the attack.
- After-the-fact feedback (PARRY / DEFLECT / GHOSTEP / GUARD BROKEN call-outs, white/gold parry
  sparks) is not a tell and stays.

## Contract (summary — full signatures in ARCHITECTURE.md)
- Attacker → defender: `defender.takeHit({ damage, from, knockback, knockdown, kind, burn, tell,
  parryable, blockable, attack, attacker })` returns a `RESULT` (`hit` / `blocked` / `parried` /
  `dodged` / `perfectDodge` / `ignored`).
- On `parried` the attacker calls its own parry reaction (recoil + posture damage); on
  `perfectDodge` the defender performs Ghostep using `attacker.position` / `yaw`.
- Attackers announce tells via events: `combat:tell` at windup start, `combat:flash` at the
  timing cue. The attacker draws its own tell in the world (red windup glow via `uWarn`, white
  glint / red burst on the flash); audio plays the cues; the HUD adds only the red edge flash.

## Player moveset (owner concept sheet "Combat key poses")
Numbers live in `src/entities/player/combat.js` (`LIGHT`, `THRUST`, `CHARGE`, `REACH`); movement /
defence timings in `TUNE` (`player.js`).

| Move | Input | Timing (windup / active / recovery) | Damage | Posture | Notes |
|---|---|---|---|---|---|
| Light 1 — sweep | LMB tap | 0.14 / 0.11 / 0.22 s (0.47 s) | 30 | 5 | coiled low at the right hip (blade back-right, 15° down), sweeps round the front at chest height to left-back, then rises up-left over the head; cyan crescent |
| Light 2 — backhand | LMB tap in the recovery | 0.14 / 0.11 / 0.22 s | 32 | 5 | left → right, the mirror of light 1 (rising finish) |
| Slam — combo finisher | 3rd tap | 0.40 / 0.12 / 0.48 s (1.0 s) | 58 | 16 | two-handed: the blade rises past the head and hangs down the back at the apex (torso arched), then slams into the ground; a crystal-shard burst (r 1.7 m) at the point hits if the blade missed |
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
  Result (`npm test` → scenario REACH): light 1, light 2, the slam and the thrust all connect from
  the front of an idle wyrm from contact out to 3.5 m from its chest surface.

## Current numbers (v0.2, "approachable RPG")
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

## Strings, the deflect chain and three phases (v0.5 "epic wyrm fight", dragon side)
**Strings** (`attacks.js` `makeString`, data in `tuning.js` `TUNING.attacks[name].hits`): an attack
of N hits, each with its own kind (performance), tell, windup (+ an optional random `hold` that baits
an early parry), active, impact, damage and knockback; a hit with `chance` < 1 may be rolled out.
Every hit announces itself (`combat:tell` at its windup start) and flashes `flashLead` (0.35 s)
before its real impact, holds included. Data rules (checked by `npm test` → STRINGS, all phases):
a tell per hit, the first windup ≥ 0.7 s, the flash after the tell, ≥ `minHitGap` 0.45 s from one
impact to the next (time to release and re-press RMB: `parryRearm` 0.25 s).

| String (phase ≥) | Hits (tell; P1 windup / active / impact s; damage) |
|---|---|
| Claw combo (1) | claw (N; 0.8 / 0.25 / 0.15; 16) · claw (N; 0.55 / 0.25 / 0.15; 16) · lunge bite (B; 0.6 / 0.24 / 0.05; 22) |
| Rending flurry (1) | claw (N; 0.75; 16) · claw (N; 0.45; 16) · overhead claw (B; 0.62 / 0.24 / 0.22; 22) · lunge bite (B; 0.55 / 0.24 / 0.05; 24) |
| Hesitant maw (1) | reared bite (B; 0.85 + hold 0.25–0.9 / 0.2 / 0.06; 24) · 50 %: quick bite (B; 0.5 / 0.2 / 0.06; 20) |
| Wing buffet (1) | wing slam (N; 0.8 / 0.3 / 0.25; 18, kb 5) · pivot + the other wing (B; 0.9 / 0.3 / 0.25; 22, kb 7) |
| Tail lash (2) | claw (N; 0.75; 18) · pivot + tail lash (R; 1.0 / 0.36 / 0.245; 26) · tail sweep (R; 0.9 / 0.45 / 0.2 + flank; 30) |
| Pounce (2) | a hop onto the hero (R, ground ring; 0.8 / 0.6 / 0.6 = the landing; 30, knockdown) · bite (B; 0.55 / 0.2 / 0.06; 22) |
| Frenzy (3) | claw · claw · bite (N) · 60 %: claw · a delayed claw (hold 0.3–0.75) · bite (B) · stomp (R, ground ring; 36) |

Later phases scale windups and recoveries by `phaseTimeScale` [1, 0.85, 0.78] (the swings keep their
speed). AI bands (model units × SCALE from the root): the claw strings 2.4–5.4 within 0.9 rad of the
nose, Hesitant maw 3.5–6.5 / 0.65 rad, Wing buffet 6.8–8.3 on any side up to 2.6 rad (its windup turns
the flank to the hero; the fingers come down there), Pounce 6–13 / 1.0 rad.
**Verifier** (`npm test` → TIMING): every string and single melee attack, started through the AI's
own start path from every placement the AI picks it at (phases 1–3, the hero standing still), lands
each contact within ±85 ms of its flash + lead (worst 67–83 ms), and every pick lands its first hit.

**Deflect chain** (contract 1): parrying a hit that is not its string's last does not cancel the
string: the posture damage applies (`POSTURE.parry`), the struck paw / head is knocked back for
0.14 s (visual only) and the next hit comes on schedule. Parrying the last hit (or a single melee
attack) recoils the wyrm as before (the punish window). `dragon:parried` carries `{hit, last}`;
`combat:deflectChain {count}` fires from the 2nd parry in a row within one string (a hit that lands or
is blocked resets the count; dodges keep it). A red hit inside a string can't be parried or blocked:
dodge it (a perfect dodge → the plunge, which cancels the string).

**Plunge reaction** (contract 2, dragon side): `onPlunge` deals its damage to the head (the phase gate
holds), adds its posture, cancels the action (not the intro, a transition or the death) and plays the
`plunged` reaction (~1.35 s: the head slammed to the ground, a thrash, the rise; airborne: a fall and
a crash landing first). An execution on a broken wyrm (~2 s) consumes the break. A full posture meter
breaks after the reaction; a pending phase transition waits for it too.

**Three phases** (contract 4): P1 100–66 %, P2 66–33 %, P3 33–0 % of 4200 HP, each threshold a gate
until its transition roar (the red shock ring, which also clears the hazards). Per phase [P1, P2, P3]:
posture max 560 / 640 / 720 (a near-perfect defender breaks it every ~25–60 s), turn speed 70 / 110 /
125 °/s, idle gap 1.3–2.1 / 0.9–1.5 / 0.4–0.8 s. Phase 3 burns white-hot (glow 0.8, embers) and opens
with the inferno nova when the fire attacks are in. Damage: string hits 16–24, heavy blows 30–40
(tail sweep 32, stomp 34, charge 36, leap 40), the roar ring 12.
