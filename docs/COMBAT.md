# Combat design

ABYSS is an action RPG, not a stamina-gated soulslike. Fights are about **reading tells** and
answering them with **block, parry or a perfectly timed dodge** — inspired by Phantom Blade Zero's
colour-coded attacks. Numbers live in `src/combat/rules.js` (shared) and each actor's `tuning`.

## Core rules
1. **No stamina.** Attacking, rolling, sprinting and blocking are free; pacing comes from attack
   recovery, roll recovery and the enemy's patterns.
2. **Every enemy attack has a tell** declared in its data: `normal`, `blue` or `red`
   (`TELL` in `rules.js`). The tell is shown at windup start and **flashes ~0.35 s before impact**
   (the timing cue). Windups are long enough to react to (≥ 0.7 s in phase 1 for melee).
3. **Answers**
   | Tell | Block (hold RMB) | Parry (tap RMB just before impact) | Dodge (Space) |
   |---|---|---|---|
   | `normal` — white glint | −80 % dmg, small pushback | full negate, posture dmg | i-frames; perfect → Ghostep |
   | `blue` — blue ◆ flash | −50 % dmg, big pushback | full negate, **big** posture dmg | i-frames; perfect → Ghostep |
   | `red` — red ! flash | **fails** (full dmg, knockdown) | **fails** | **only answer**; perfect → Ghostep |
   Attacks may override parry/block (a fire stream is blockable but not parryable).
4. **Parry** = RMB pressed ≤ `parryWindow` (0.22 s) before impact, attacker within the front arc.
   Mashing is prevented: RMB must be released `parryRearm` (0.25 s) before a new press counts.
   Holding RMB after the press keeps blocking.
5. **Perfect dodge** = a dodge started ≤ `perfectDodgeWindow` (0.2 s) before impact → **Ghostep**:
   the player blinks behind the attacker, time slows (×0.3 for 0.6 s), and for 1.6 s the player's
   hits crit (×1.8). A dodge outside the window is a normal i-frame dodge.
6. **Posture.** Enemies have a posture meter (gold bar under the boss HP). Parries and weapon hits
   fill it; at max the enemy is **broken** for 3.2 s (open: ×2.2 crits). It recovers after 3 s
   without posture damage.
7. **Fairness checklist for every new attack:** tell type set · windup ≥ 0.7 s (melee) · flash
   ~0.35 s before impact · hitbox matches the visual · recovery window to punish · no unavoidable
   chip (AoE red attacks show a ground ring).

## Contract (summary — full signatures in ARCHITECTURE.md)
- Attacker → defender: `defender.takeHit({ damage, from, knockback, knockdown, kind, burn, tell,
  parryable, blockable, attack, attacker })` returns a `RESULT` (`hit` / `blocked` / `parried` /
  `dodged` / `perfectDodge` / `ignored`).
- On `parried` the attacker calls its own parry reaction (recoil + posture damage); on
  `perfectDodge` the defender performs Ghostep using `attacker.position` / `yaw`.
- Attackers announce tells via events: `combat:tell` at windup start, `combat:flash` at the
  timing cue; HUD/FX/audio render them.

## Current numbers (v0.2, "approachable RPG")
- Player: HP 160, 5 flasks (+70 HP), roll 0.6 s with i-frames 0.04–0.4 s, light combo 30/32/46,
  heavy (hold LMB) 70–110 by charge.
- Cinder Wyrm: HP 1500, see `src/entities/dragon/tuning.js` for every attack's tell and timings.
