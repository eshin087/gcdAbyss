# Spec — Breath-born bullets, perfect-parry returns, Armageddon, diegetic warnings

Status: **approved scope, not started** (2026-11-11). Planner: Fable. Implementer: Opus.
*Implementation note: PR #14 took ADR-046 to ADR-049 first, so the four ADRs named below are
ADR-050 (breathed bullets), ADR-051 (perfect parry), ADR-052 (ground warnings) and ADR-053
(Armageddon) in `docs/DECISIONS.md`.*
Read `CLAUDE.md`, `docs/COMBAT.md` ("Bullets", "Fire attacks and hazards", the fairness checklist)
and ADR-029 / 030 / 039 before starting. Numbers below are **starting values**: tune them in the
Lab, keep them in `tuningBullets.js` / `tuningFire.js` / `rules.js`, never in logic.

## Owner decisions (do not re-open)
| Topic | Decision |
|---|---|
| Bullet origin | **Redesign as breath.** Every bullet leaves the jaws along the head's aim. Pattern shapes change to what a head can produce. No bullets from the body ring or the wings. |
| Parry-back | A normal parry deflects as today (posture only). A **perfect parry** (tight window) returns the bullet as a bigger, faster shot that deals **HP damage** + more posture and flinches the head. Red orbs stay dodge-only. |
| Armageddon | **Replaces Meteor rain** as a headline set-piece: the wyrm aims straight up, fires a visible salvo into the sky, then 24–40 meteors hammer the whole arena in waves. |
| Intensity | **Hard**: ~1.6–2× bullets, ~20 % faster, shorter cooldowns, higher hit caps, more overlap in P2–P3. Bullet damage unchanged. |
| Ground warnings | **Diegetic scorch glow**, for **all** ground warnings. No `!` marks, no hard red dot rings. A sharper edge only in the last `flashLead` (0.35 s). |
| Fire wheel | Reworked into **breath beams from the head**, swept by turning the head / body. |

## Working setup
- The checkout on `player/two-hands-idle-life` has **uncommitted work that is not yours**
  (`src/entities/player/gear/shroud.js`, `src/entities/player/model.js`, `tests/integration/integ.mjs`).
  Do not touch, stash or commit it. Work in a fresh worktree branched from `origin/main`.
- One branch, e.g. `dragon/breath-armageddon`, four code commits in the order of the work packages
  below (each leaves `npm test` + `npm run build` green), docs in their own commit(s), last pushed
  commit a code commit (Vercel `ignoreCommand`). PR per `CLAUDE.md`; never push to `main`.
- The owner tests on an iPhone Pro: watch particle / bullet counts, check the phone preset, hand
  over the Vercel preview. On-device fps is theirs to confirm.

---

## WP1 — Diegetic ground warnings (do this first; WP3 and WP4 build on it)

**Problem.** `fx.hzRing`, `fx.warnRing`, `fx.stripWarn`, `fx.ringWarn`, `fx.wallWarn` and
`BFX.wheelWarn` draw rotating rings / lines of bright red `•` and `!` (plus `>` chevrons and a
closing inner ring). They read as UI painted on the world.

**New language: the ground heats up.** One shared look for every footprint:
1. **Fill, not outline.** The footprint is sparsely filled with small ground-hugging glyphs
   (from the world atlas only: check `glyphcheck`; candidates `.` `,` `:` `'` `*`) that do **not**
   rotate or march. Positions are stable per hazard (hash of hazard id + index), with a slow flicker.
2. **Colour = heat, not alarm.** Dark ember (≈ `[0.35, 0.08, 0.02]`) at spawn → orange → near
   white-orange at impact. No pure `RED`, no `TELL_STYLE.red.color` on the ground.
3. **Intensity follows `k`** (0 at spawn → 1 at impact): alpha ≈ 0.22 → 0.7, density ≈ 35 % → 100 %,
   a few rising sparks / heat wisps from `k > 0.6`.
4. **The edge appears late.** Only when `hot` (the last `TUNING.flashLead` s) a thin, bright rim is
   drawn at the true radius / band edge, so the exact boundary is known when it matters.
5. **Scorch map.** Also feed `world.scorch` heat (see `src/world/scorch.js` `burnCircle` /
   `heatAt`) with a low `burnAmount` and a `heatAmount` rising with `k`, if that makes the ground
   glyphs themselves glow before impact. Verify in the browser; if heat without burn is not
   expressible, add a small heat-only stamp to `scorch.js` (document it in ARCHITECTURE). The
   particle fill is the baseline; the scorch heat is the part that makes it feel like the world.

**Apply to every warning:**
| Today | Becomes |
|---|---|
| `hzRing` (meteors, pillars, barrage shells, nova) | heat disc; pillars keep a slight lava tint + a couple of `^` only when `hot` |
| `warnRing` (`ai.js:639`, red AoE melee zones: slams, pounces, the sky-dive target) | same heat disc (this is the "pound" circle the owner called out) |
| `stripWarn` (burning pass) | heat band along the strip; **no chevrons**; brightest just ahead of the front |
| `ringWarn` (flame ring) | heat band where it ignites; drop the dotted `r1` reach ring entirely |
| `wallWarn` (flame wall) | heat line under the wall; no chevron field (the wall itself shows the direction once lit) |
| `wheelWarn` (fire wheel lines) | replaced in WP3 by the breath-beam windup |

`fx.shockRing` (the roar's `)` shock strokes) is an effect, not a warning: recolour from tell-red to
fire orange, otherwise leave it.

**Fairness must survive.** Readability bar: on a screenshot at `k = 0.3` a new player can still
point at the danger area; at `hot` the edge is unambiguous. Warn durations stay ≥ current values.
Audio cues and `combat:tell` / `combat:flash` are unchanged.

**Acceptance:** no `HZ_MARK` / `CHEVRON` / tell-red left in any ground warning; film strips (Lab +
`__tick`, see memory note on capture quirks) of a meteor, a slam zone, the burning pass, flame ring
and flame wall at k = 0.2 / 0.6 / hot, desktop and phone preset; `npm test` green (glyph check).

---

## WP2 — Perfect parry returns the bullet

**Rule.** `DEFENSE.perfectParryWindow = 0.08` s (`rules.js`). In `Player`'s hit resolution
(`player.js` ~line 291, step (d)) a parry is *perfect* when `time - rmb.parryT <= perfectParryWindow`.
The flag is computed for every parry but **only bullets consume it** in this change (melee perfect
parries are out of scope).

**Plumbing (contract change → update `docs/ARCHITECTURE.md` in the same commit):**
- `Player._parry(..., perfect)` stores it on `this.deflect.perfect` and adds `perfect` to
  `player:parry { tell, attack, chain, light, perfect }`.
- `bullets.js` `_touch` → on `RESULT.PARRIED` reads the flag and calls `_deflect(b, spec, p, perfect)`.
- `dragon:parried { ..., bullet: true, perfect }`.
- New event `dragon:returned { kind, damage, x, y, z }` when a returned shot lands (audio, call-out).

**Normal parry:** exactly as today (ricochet 24 m/s to the head, posture 5 / 12, no HP damage).

**Perfect parry — the returned shot:**
| | Ember | Wisp |
|---|---|---|
| HP damage to the wyrm (`returnDamage`) | 30 | 70 |
| Posture (`returnPosture`, replaces the normal value) | 14 | 30 |
Sanity-check the damage against the sword's light / heavy hit damage in `player.js` `TUNE`: an
ember return ≈ one light hit, a wisp return ≈ one heavy hit. Wyrm HP is 4500; a denser field must
not make returns the best DPS in the game (target: a well-played storm returns ≤ ~8 % of a phase's HP).
- Flight: `returnSpeed` 34 m/s, radius drawn ×1.8, white-gold core with an orange trail (new
  `BFX.drawReturned` / reuse `deflectSpark` colours), homes on `rig.pt.head` like `_ricochet`.
- On arrival: damage through the wyrm's normal damage entry point (find what the player's sword
  hits call in `dragon.js`; phase gates and death must work, a returned shot may kill), a head
  flinch (`d.flinchHead`, visual only), a burst, `d.flash`, a small shake.
- **Never interrupts** the wyrm's action and never counts in a string's `DEFLECT ×N` (unchanged
  contract). Posture break from accumulated returns is allowed (it already is for deflects).
- Only the struck bullet returns; the clump shield / pop behaves as today (popped bullets do not return).
- Feedback: call-out `RETURN` (`ui/callouts.js`), a brighter, higher clang (`audio`), hit-stop
  0.05 s (between light 0.03 and melee 0.08), gold spark burst on the blade.
- Deflected / returned bullets flying while the field is cleared (phase change, death, reset) die
  silently as today.

**Tests (`tests/integration/integ.mjs` → BULLETS):** press at impact − 0.05 s → `PARRIED`,
`perfect: true`, wyrm HP drops by `returnDamage` when the shot lands, posture + `returnPosture`;
press at − 0.18 s → normal deflect, HP unchanged; orb + perfect timing → still not parried; a
returned shot that lands during a transition roar does no damage if sword hits don't either.

---

## WP3 — Bullets are breathed: pattern redesign + "Hard" intensity

**Shared rule (ADR).** A bullet's spawn point is `rig.pt.mouth` and its initial heading is the
head's aim. Add one helper in `bulletAttacks.js` (e.g. `spit(d, kind, attack, yaw, speed, grp, life)`)
that every pattern uses; no pattern calls `bullets.spawn` with a body- or wing-relative position.
- The pose drives the head so `pt.headFwd`'s yaw is within ~0.15 rad of the emission yaw at the
  moment of emission (aim the head first, emit along where it actually points — do not emit along
  an ideal angle the head has not reached).
- Bullets leave at mouth height and must be at hit height (`BULLETS.height` 1.0 m, `HIT_Y`) before
  they can reach the hero: reuse the existing `y0` / `yH` / `drop` descent in `bullets.js`; for a
  close hero the head dips so the stream is not fired over him. The existing point-blank rules
  (`young`, `cueMin`, pre-cues from the emission schedule) stay and must be re-derived for the new
  origin: hugging the wyrm is neither a blind spot nor a free pass.
- Every emission has a visible cause: jaw open, throat lit (`d.throat`), `BFX.muzzle` at the mouth,
  a small head recoil per burst.
- The Cinder flurry's four scattered embers (`attacks.js` ~2003, `spec.burst`) come from the slam's
  fire on the ground, not thin air: keep, but they must rise visibly out of the impact burst.

### Patterns
**1. Ember storm → "Ember torrent" (`emberStorm`, P1+).** Plants its feet, lowers the head and
sweeps it side to side across the hero's bearing while breathing a continuous stream of embers.
The oscillating stream makes snaking curtains: the hero is crossed once per half-sweep (a parry
rhythm) and can walk with the wave instead.
- Sweep: ±`arc` [0.9, 1.1, 1.25] rad about the hero bearing (re-centred slowly, 0.6 rad/s),
  `sweepHz` [0.45, 0.55, 0.65]; the neck does the sweep, the body turns only to re-centre.
- Emission: one ember every `every` 0.06 s (was 0.11 across 4 arms), `speed` 9 (was 7.5),
  in `lanes` [1, 2, 3] (extra lanes are the same stream split ± 0.22 rad: a forked tongue).
- P2+: at each sweep extreme it coughs `orbs` [0, 3, 4] red orbs in a tight fan at the hero (`orbSpeed` 6.5).
- P3: the last 1.5 s is a full body pirouette (one 360° turn, breathing throughout): a true spiral
  arm, the only time embers go behind it.
- `cast` [3.6, 4.2, 4.8], `maxHits` 6 (was 4), `cooldown` 10 (was 14), `weight` [1.6, 2.0, 2.0].

**2. Cinder fan → "Cinder burst" (`fanVolley`, P1+).** The wing beats go. The head snaps onto
the hero and coughs shotgun cones: all bullets start at the mouth and diverge.
- `volleys` [4, 6, 7] (was [3, 4, 5]), `count` [9, 11, 13] (was [7, 8, 9]), `gap` 0.55 (was 0.7),
  `spread` 0.55 rad half-angle, `speed` 10.5 (was 9).
- Keep the on-hero / in-the-gap alternation (`fanOnHero`, `fanOffset`) — it is the pattern's read.
- P2+: the last cough is the red orb wave, `orbWave` [0, 6, 7], `orbSpeed` 8.
- P3: every other cough is a double tap (two cones 0.14 s apart, the second offset half a spacing).
- `maxHits` 5 (was 3), `cooldown` 6.5 (was 9), `weight` [2.4, 2.8, 2.8]. Animation: neck coils
  back between coughs, jaw snaps, head recoils up ~0.3 m per cough.

**3. Wisp swarm (`wispSwarm`, P2+).** Already roared from the maw; density only.
`count` [0, 10, 13] (was [–, 7, 9]), `stagger` 0.36 (was 0.45), `wisp.cruise` 6.2 (was 5.2),
`maxHits` 6, `cooldown` 12. AI gate: allow a new swarm while ≤ 3 wisps are still alive (was 0).

**4. Fire wheel → "Scouring breath" (`fireWheel`, P2+).** A sustained breath strikes the ground
in front of the snout and runs out along it as tongues of fire; the wyrm sweeps them round by
turning head and body, reversing once.
- Reuse the `bullets.wheel` model with two changes: the origin is the mouth's ground projection,
  **updated every frame** (not the root, fixed at start), and the spokes are `tongues` at fixed
  offsets from the head's yaw — [3, 3, 5] tongues over ± [0.45, 0.45, 0.8] rad — not evenly round 2π.
- Sweep: body turn at `speed` 1.5 rad/s (was 1.05), ≥ 1.25 turns in `dur` [4.6, 4.6, 5.4], one
  reversal telegraphed by the head pausing ~0.25 s. `r1` 26, `width` 1.1, `maxHits` 3 (was 2),
  `cooldown` 15 (was 20). Damage 20 + burn 1.5, kb 4 (unchanged, final).
- A visible beam (`fx.breathEmit`-style stream, reuse the breath / flame-wall look) from the jaws to
  the strike point; tongues are the existing `wheelLive` fire.
- Windup (replaces `wheelWarn`): the WP1 heat glow along where the tongues will ignite, growing out
  from the strike point, while the throat charges. Per-spoke cues (`w.tt`, headline) stay.
- Behind the wyrm is safe only until the sweep comes round; body contact circles are unchanged.

### Field rules for the denser field
- `MAX` in `bullets.js` is 360: size it for the worst case (P3 torrent + live wisps + a burst) and
  check draw cost on the phone preset; raise only as far as needed.
- `pop` 2.2 → 1.5 m (one parry still answers a clump, but no longer clears the screen). `grace`
  0.45, `cueGap` 0.3, `cueMin`, `flashLead` unchanged — the cue contract is not negotiable.
- P3 overlap: 35 % chance that a Cinder burst is followed at once (no idle gap) by an Ember
  torrent, **only if** `ai.js` already has a follow-up / combo mechanism to hang it on; if not,
  skip it and note it in the DEVLOG rather than building one.
- Bullet damage stays 8 / 13 / 20, final, not scaled by `damageScale`.

**Tests (BULLETS, all phases):** every bullet a pattern spawns is born within 0.6 m of `pt.mouth`
and within 0.2 rad of `headFwd`'s yaw; existing guarantees re-proved with the new numbers (cue
lead on every hit, hit caps, point-blank dud, a hero who answers cues takes fewer hits than one who
stands still, opening flash from 28 m, even-count centring). Update `src/audio/fire.js` and the
Lab labels for the renamed patterns (keys stay `emberStorm` / `fanVolley` / `wispSwarm` / `fireWheel`).

---

## WP4 — Armageddon (replaces Meteor rain)

Keep the attack key `meteorRain` (audio, Lab, tests, hazard kinds reference it); change the label
to `Armageddon` and the design. Phase 2+.

**Beats**
1. **Windup 1.4 s.** Rears onto its hind legs, wings flared, neck straight up, throat charging
   white-hot, embers streaming upward off the jaws. Red tell on the body per `TELL_STYLE.red.warn`.
2. **Salvo 1.6 s (`cast`).** Fires `missiles` [–, 12, 16] fire bolts straight up from the mouth,
   one every ~0.11 s, inside a ±0.15 rad cone: each a white-hot `@` core with a long orange trail,
   ~45 m/s, visible until it leaves the top of the view; the head kicks with every shot, light
   camera shake, a launch sound each (`dragon:hazard { kind: 'meteor', stage: 'launch' }` — new
   stage, document it). The missiles are visual; the hazard emitter is armed here.
   The wyrm is committed and rearing for windup + salvo (3 s): **this is the punish window** for a
   hero close enough to reach the hind legs / belly.
3. **The hush ~0.8 s.** The sky answers: an orange glow overhead (use the atmosphere / light rig in
   `src/world`; add a small `skyGlow(k)` hook if none exists), a rising rumble. The wyrm drops to
   all fours and resumes fighting (`recovery` 0.9 s) — the barrage is a background hazard as today.
4. **The barrage.** `waves` [–, 3, 4] × `perWave` [–, 8, 10] meteors (24 / 40, was 8–14), waves
   `waveGap` 1.6 s apart, impacts inside a wave `stagger` 0.12 s apart.
   - Placement is **arena-wide** (inside `ARENA_R` 27 m), jittered-stratified so coverage is even,
     not the current 4–14 m cloud round the hero. Every `ledEvery` 3rd meteor is led onto the hero
     (existing logic); never two led impacts within 0.5 s.
   - **Safe ground guarantee:** within 12 m of the hero a wave's footprints cover ≤ 45 % of the
     area and no two footprints of the same wave overlap by more than a third. Test it.
   - Meteors come down on a slant from above the wyrm (they are the bolts it fired), visible fall
     `fall` 0.9 s, larger core + trail than today, `meteorImpact` + crater as now; from P3 a crater
     burns for 2 s (contact ticks like the burning strip: `tickDamage` 4, blockable, skipped while rolling).
   - `radius` 3.4, `damage` 20 (was 18), burn 1.5, kb 3, `warn` 1.5 / `warnLed` 1.2 (the WP1 heat
     disc), `maxHits` 4 (was 3).
5. **The last one.** 1.2 s after the final wave a single great meteor falls on the hero's led
   position: `radius` 7, `warn` 2.0, `damage` 34, kb 7, the biggest impact in the fight (flash,
   long shake, scorch). Perfect-dodgeable like any red blow; hazard hits never plunge (unchanged).
- `cooldown` 28, `weight` [0, 1.2, 1.5]; still gated on no rain / meteors alive. The phase
  transition roar still clears it.

**Implementation notes.** Extend `hazards.rain` (or add `hazards.barrage`) with `waves`,
`perWave`, `waveGap`, `stagger`, arena-wide placement, a fall origin, crater burn and the finale;
`MAX` in `hazards.js` is 48 — size it for 10 live meteors + craters + other hazards. Flash timing
contract (`npm test` → FIRE: every blow within 17 ms of its flash + lead) must hold for all 41 impacts.

**Tests (FIRE):** counts per phase; every impact cued; safe-ground guarantee over 200 seeded runs;
hit cap; a standing hero is hit ≤ `maxHits` + the finale; a hero who rolls on cues takes ≤ 1 hit;
cleared by a phase change; meteors never land outside `ARENA_R`.

---

## Docs to update (own commits)
- `docs/COMBAT.md`: fairness rule 9 / 10 and the tells section ("red ground ring" → heat glow),
  Bullets section + pattern table, perfect parry, Fire attacks (Armageddon), Current numbers.
- `docs/STYLE.md`: the heat-glow warning language; breath-born bullets; returned shot look.
- `docs/ARCHITECTURE.md`: `player:parry.perfect`, `dragon:parried.perfect`, `dragon:returned`,
  `dragon:hazard` stage `launch`, any new `scorch` / sky hook.
- `docs/DECISIONS.md`: ADR-046 (bullets are breathed), ADR-047 (perfect parry returns damage),
  ADR-048 (diegetic ground warnings), ADR-049 (Armageddon replaces Meteor rain).
- `docs/DEVLOG.md`, `CHANGELOG.md` `[Unreleased]`, `docs/ROADMAP.md` checkboxes.

## Verification checklist (before the PR)
- `npm test` and `npm run build` green.
- Lab (`?lab`): each pattern in each phase it runs in, god mode off; film strips via `__tick` of:
  every pattern's emission (bullets visibly leave the jaws), a perfect-parry return landing, the
  full Armageddon sequence, each WP1 warning at k = 0.2 / 0.6 / hot.
- Phone preset pass for bullet / particle counts; Vercel preview link to the owner.
- Honest difficulty note in the DEVLOG: hits taken by the test heroes (standing / cue-answering)
  per pattern per phase, before vs after.

## Out of scope
Melee perfect parries; reflecting red orbs; new bullet kinds; changing bullet damage; a flight
phase; any player-side changes beyond the parry flag, call-out and sound.
