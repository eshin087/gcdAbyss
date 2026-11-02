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
| Light 1 — sweep | LMB tap | 0.14 / 0.11 / 0.22 s (0.47 s) | 30 | 5 | blade drawn back over the right shoulder, horizontal sweep right → left, cyan arc |
| Light 2 — backhand | LMB tap in the recovery | 0.14 / 0.11 / 0.22 s | 32 | 5 | left → right |
| Slam — combo finisher | 3rd tap | 0.40 / 0.12 / 0.48 s (1.0 s) | 58 | 16 | two-handed overhead raise → slam into the ground; a crystal-shard burst (r 1.7 m) at the point hits if the blade missed |
| Thrust — charged | hold LMB ≥ 0.3 s, release | 0.07 / 0.20 / 0.45 s | 70–110 by charge (full at 1.2 s) | 12–20 | low crouched charge (moves at ×0.4); the hero lunges 2.2–3.6 m along the facing; long cyan streak |

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
  Size ×1.875 (v0.3, `SCALE`; ~30 m nose to tail): reaches, radii, hurt spheres and AI ranges
  scale with it, windups / tells / flash timing do not. The hero does not grow, so the 3D swings
  were re-measured at this size: the bite needs ≥ 3.7 model units (6.9 m) from the root (closer it
  passes over the hero), the wing-claw swipe connects 7.5–9.75 m out (wrist sphere 1.35 × SCALE,
  the bigger thumb claw), the bite head snap is 18/s so the blow lands on the announced impact.
