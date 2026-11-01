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

## Current numbers (v0.2, "approachable RPG")
- Player: HP 160, 5 flasks (+70 HP), roll 0.6 s with i-frames 0.04–0.4 s, light combo 30/32/46,
  heavy (hold LMB) 70–110 by charge.
- Cinder Wyrm: HP 1500, see `src/entities/dragon/tuning.js` for every attack's tell and timings.
