# Dev log

Chronological session notes — newest first. Each entry: date, goal, what changed, decisions,
verification, open issues / next steps. Keep entries short; link commits/PRs when available.

---

## 2026-11-09 — Session 8: single-figure reference, round 2 (stopped part-way)
**Owner:** the hero "still does not look like the attached reference image on terms of detail and
feel"; mirror the single-figure image as closely as possible; the sword hold and its angle are
awkward. Branch `look/hero-reference-round-2`. The owner stopped the session before the geometry
rebuild was finished, so this entry records a PARTIAL result.

**Done:**
- **Idle and sword hold (ADR-036):** the single-figure stance. Weight on the left leg, the right leg
  straight out to his right and forward, the sword arm hanging beside the right hip, the blade in a
  low diagonal across his front (`IDLE_SW` [0.75, -0.58, 0.26], ~37° below level; the reference is
  ~44°), the head bowed and turned along the blade. Reverses ADR-034's blade hung at his right side.
- **Dot-matrix shading (ADR-036):** the hero's fill is a 3x3 micro-font (29 marks, `PIXEL_3X3`) in
  square 4x4 px cells instead of 3x5 letters in 4x6 cells; fill brightness linear in the light
  value, a little greyer; cel-stepped key light (`U.uArtHeroCel`); per-part silhouette ink
  (`U.uHeroPartRim`; fill style + 8 = a dotted silhouette); plain ink lines kept under the bloom
  threshold. `PIXEL_3X5` and `PIXEL_LINES` are gone.
- **Coat:** six wider, longer panels with drawn fold lines (`foldLines`: a smooth `aPart` field whose
  0.5 contour the ink pass prints as a crease; `HERO_INK.*.sub` / `uArtSub` shades the valley side).
- **Cape:** the two sleeve streamers became four torn ribbons from under the pauldron on the same
  streamer springs, each with its own outward flare (`out`).

**Verification:** `npm test` green, `npm run build` OK. Captures (session scratchpad): the reference
angle, front / sides / back / rear 3/4, and every move from the back, right and front after the coat
and cape change: grip in the right hand, no gross clipping, moves read as before. Not checked: the
real 36 m gameplay camera in the grass, a phone, frame cost of the wider coat.

**Honest state:** closer to the reference in stance, sword hold, mass and tone; still clearly NOT a
match. The coat reads as a closed pleated skirt covered in straight lines (from behind it hides the
legs that ADR-034 opened up); the cape is stiff shards, not a wide torn sheet; hair too narrow; no
face; collar not winged; legs are wireframe plates; one smooth pauldron with long claws; plain
straight sword; overall grey where the reference is near-black with sparse bright edges.

**Next (planned, not started):** open flared coat (fewer, broader folds), a face-on cape sheet, hair
mop, face lines, winged collar, dark legs with knee guards, layered pauldron, jagged blade, darker
tones. See ROADMAP M1.9.

---

## 2026-11-09 — Session 7: the lean reference match (the hero from every side)
**Owner:** improve the hero to closely match two new ASCII references (a single-figure image for
appearance, detail and the sword; a six-view turnaround for construction), "especially from the back
and rear three-quarter gameplay views". Priorities: a lean anime swordsman silhouette; distinct,
asymmetric pointed hair with crown and nape layers; a raised collar and a layered right pauldron with
depth; an intentional back (shaped upper panels, a diagonal strap, restrained seams, a narrow belted
waist); two tapered coat tails and narrow side panels instead of the broad skirt, legs visible; the
reference's sword; ASCII shading with dark planes, readable midtones, selective bright edges and
restrained bloom. Plus an inspection view (dark background, front / both sides / back / rear 3/4, the
real gameplay camera at play size, a turntable, solid and ASCII toggles). Branch `look/lean-hero`.

**How:**
- Measured the references first: the six views' silhouettes per height (closed masks), in fractions
  of his height H: shoulders ≈ 0.24 H, chest ≈ 0.18 H, belted waist ≈ 0.12 H, thighs ≈ 0.06 H, the
  coat tails to ≈ 0.8 H, flaring to ≈ ±0.24 H. Diagnosis of the baseline: round 3's broad build and
  closed A-line skirt (from behind at the game camera a lettered trapezoid with no legs), a round mop,
  a tall tube of a collar, the portrait idle's blade across his front (hidden from behind), a blade
  halo over his body.
- Built the look-dev tools before touching geometry (ADR-035), then iterated: geometry first in the
  Solid look, then the ASCII shading; each round compared side by side with the reference panels at
  matched height (headless Chrome on the RTX 4090 over DevTools, the sim stepped with `__tick`).

**Done — look-dev (ADR-035):** model viewer angles 3/4 R, Right, Rear R / L; Spin (a turntable);
Sheet (ten live tiles: front, front 3/4, right, left, back, rear 3/4 ×2 at eye level and the gameplay
camera on his back / front / right side at ×2, read back in the new `lab.postRender` hook); looks
ASCII / Solid / Source / Lines (`U.uHeroSolid`: a clay render with alpha 0 that the ASCII pass passes
through).

**Done — the hero (ADR-034):**
- Lean `BODY` (chest 0.34 over a 0.23 m waist, shoulders ±0.16, slim limbs) on the same bones.
- Hair: layered pointed locks (crown spikes, top, two back layers hanging down with lifted points,
  nape flicks, side locks, a jagged fringe; the scalp cap's hairline under the fringe roots).
- Collar: lower and flared behind, points beside the jaw in front, a turned-over rim.
- Back: a yoke whose seams dip to a four-point star, a centre seam, the baldric (a strap round the
  torso in a tilted plane, right shoulder → left hip, buckle and ring), two belts.
- Pauldron: a ×1.3 stack (cap, band, two arm lames standing off the sleeve, claw blades).
- Coat: six panels: two back tails split by a vent, narrow side panels, front panels; `skew` keeps
  the vent / front edges straight while the outer edges flare, `slant` slopes the hems, piping on the
  vent and front edges, 12 strips (outer longest). Banded calves; slimmer boots and knee guards.
- Sword: the single-figure image's (broad base, long taper, hooked barbs, lightning notches, a guard
  swept up round a violet four-point star gem).
- Idle: the sword hung at his right side, out and forward-down; `dirLerp` sends near half-turns round
  the front (the light combo's finish → idle cut the sword arm's shoulder for one frame).
- Game-camera shading: blade far self-light 2.3 → 1.25 × far and HDR cap 1.8 → 1.3 (a tight glow),
  armour far fill / lines −25 %, the lavender torn zone's far fill 0.4 → 0.8.

**Decisions:** ADR-034 (lean hero, coat tails, idle at the right side), ADR-035 (look-dev tools).
The idle follows the turnaround, not the single-figure image's dynamic portrait stance: the user
gave the rear views equal priority, and from behind the portrait's diagonal blade was hidden.

**Verification:**
- Captures (session scratchpad `cap/`): every angle in Solid and ASCII at inspection scale, the
  gameplay camera at 36 m from the back / front / side / rear 3/4 (dark and in the grass), the sword
  face-on, reference-vs-ours side by side (back, rear 3/4, front, right), and every move (idle, walk,
  run, sprint, light 1, light 2, slam, charge + thrust, dodge) at key moments from the back, right
  side and front: the grip stays in the right hand, nothing passes through his body.
- Game camera, facing away: his lit area now matches the reference's at the same height (4357 vs
  4374 px; the broad build covered 6462); mean luma 74 (reference 55; baseline 79), dark share 49 %
  (reference 56 %, baseline 40 %).
- `herolook`: lean proportions asserted; the drawn blade never enters his body over 831 frames
  (closest 2.9 cm; the baseline let it sink ≤ 2 cm); it crosses a coat panel on 1 of 509 locomotion
  frames. `hero`: 6 panels / 12 strips, strip tips ≥ 0.1 m above the grass, the steel point ≥ 0.014 m.
- New Lab checks: the rear 3/4 + solid look, the turntable, the sheet overlay, a clean exit.
- `npm test`: ALL PASSED; `npm run build`: OK (see the PR).
- The DIE scenario's "dragon frozen while paused" failed once: the blade halo now spawns fewer
  particles, which shifts the shared `Math.random` stream the seeded wyrm AI rolls on, and the wyrm
  happened to walk on the Esc frame (which still runs on the pre-pause dt). The check now snapshots
  the wyrm after that frame.

**Open issues / next:**
- At the game camera he is still brighter than the scaled reference (the one-pixel silhouette line,
  kept for legibility on the grass); the hair has less volume than the reference's mop; the tails'
  dotted lavender rag along the outer edges is fainter; the face has no nose / mouth lines.
- The sleeve streamers are not in the new references (kept for now).
- The slash / slam FX look huge in close-ups (sized for the 36 m camera, known).
- Cosmetic FX share `Math.random` with the wyrm AI: give FX their own stream.
- Move the capture harness into the repo (carried over).
- **Next:** the owner reviews the PR preview (Lab → MODEL VIEW → Hero, Dark, Sheet / Spin / Solid).

---

## 2026-11-09 — Session 6: the epic wyrm fight (combos, the plunge, flights and fire, three phases)
**Owner:** the hero is "too lanky / skinny", and his sword always shows and clips through him, even
through his back from behind. The dragon needs far more attacks, epic fire spells, flying attacks and
fire from the air. A perfect dodge should put the hero on top of the dragon for a flying stab into
its head (the teleport behind it confused players). Enemy combos should be parried hit after hit,
like Sekiro / Phantom Blade Zero. The fight should be longer and harder.
**Owner's answers:** the head-stab is automatic on every perfect dodge in range; the fight lasts
3–5 min, is hard and has three phases; flying means short flying attacks; all four spells (meteor
rain, eruptions, flame walls / rings, an inferno nova).

**How:** a shared spec with four contracts (1 strings and the deflect chain, 2 the plunge, 3 hazards
and fire attacks, 4 three phases) and four worktree agents in parallel, each owning its files:
hero-look (`c3/hero-look`), plunge (`c3/plunge`), dragon-melee (`c3/dragon-melee`) and dragon-fire
(`c3/dragon-fire`). Base: `main` @ `8ce6aef` (PR #4, the reference match, merged). The lead merged
them into `combat/epic-wyrm` (`cbc3056`, `b528723`, `4020ad6`, `c6f4411`; the dragon-side plunge
scenario renamed `plungeReact`) and tuned the result (`64543ac`, `b3a69b3`, `1fe7f42`, `9fbf9fd`).

**Done — the hero:**
- **Broad build (ADR-031):** a `BODY` girth table on the same bones: chest 0.40 × 0.21 → 0.50 ×
  0.27 m, waist 0.27 → 0.31, hips 0.30 → 0.34, thick arms and legs, bigger boots, shoulders ±0.21.
  The sword hand aims from the old shoulder spot, so the grips are unchanged.
- **The blade is depth-tested again:** the depth pull (ADR-022) is gone, so the sword no longer shows
  through his back or legs. The coat yields to the steel (hangs inside the sword hand or drapes over
  it, latched per panel): blade-through-coat frames 156 → 25 over 23 clips.
- **The plunge (ADR-027):** a perfect dodge of the wyrm within 30 m of its head: vanish, hang 5 m
  above the head, dive, a reverse-grip stab (90 final damage, 40 posture), ride the head down,
  backflip to a visible landing in front of it toward where he came from, then the crit window.
  Out of range or against a fire hazard: slow-mo + crits in place. On a posture break, attack near
  the head for the **execution** (260). Plunge poses (hang, dive, ride, flip, three-point landing),
  cold FX, a dive whoosh and a skull-crunch impact.
- **Deflect chain feel:** parries in rhythm snap the blade to alternating sides, push him back a
  little, grow the clash and raise the clang a step each; the guard lingers between taps; "DEFLECT
  ×N" and "EXECUTION" call-outs.
- **Camera keep-in-view:** `cameraRig.keep` pans (and pulls back a little) so the hero and the head
  stay on screen through the plunge; the flow uses it to frame a flying wyrm.

**Done — the wyrm:**
- **Strings (ADR-026):** a data-driven string framework with ten hit kinds and seven strings: claw
  combo, rending flurry, hesitant maw (a held bite that baits an early parry), wing buffet, tail
  lash, pounce, frenzy (6–7 hits). A parried non-final hit is deflected (posture + a 0.14 s
  knock-back), the string goes on; the last hit's parry recoils it.
- **Plunge reaction:** `plungePoint` / `onPlunge`, the `plunged` reaction (the head slammed down, a
  thrash, the rise; in the air a fall and a crash landing first; an execution heavier, spending the
  break).
- **Three phases (ADR-028):** gates at 66 % and 33 %, transition roars that clear the hazards, a
  white-hot phase 3 that opens with the nova, per-phase tuning arrays, a generic weight-based AI
  selection, the Lab's Phase 3 button, boss-bar phase ticks, the phase-3 banner and music.
- **Short flights (ADR-030):** the burning pass, the sky dive, the hover barrage, with hover, glide
  and dive poses and the GLIDE / DIVE wing keys.
- **Fire spells and hazards (ADR-029):** meteor rain, fire eruptions (a phase-3 chase), flame ring,
  flame wall, inferno nova; a pooled hazard system with red ground warnings; 12 procedural fire
  sounds; all FX from world-atlas glyphs.

**Lead, after the merge:**
- A successful deflect re-arms the parry at once (ADR-032): a player holding the guard a moment
  between blows could not re-arm in time for the next blow of a string.
- Fire hazards no longer flash the red screen edge (a meteor rain pulsed the whole HUD).
- AI weights retuned: up close the stomp and the bite were ~2/3 of the picks. The dive and the hover
  barrage have no minimum distance, the strafe's is 7 m, the eruptions' 6 m, the breath works from
  4.5 × S. Close-range pick shares now: P1 strings ~60 %, bite / stomp ~40 %; P2 strings ~39 %, fire
  and flights ~35 %, singles ~25 %; P3 strings ~42 %, fire ~41 %.
- A new phase's abilities unlock one by one (`unlockStagger` [2, 2.5, 2] s); the nova opener is not
  delayed.
- HP 4200 → 4500; the plunge's hurt flash is capped at 0.45 (the hitstop froze its decay and washed
  the wyrm white).
- The airborne plunge in play: fire the wyrm breathes or spits from the air (the burning pass's
  strip front, the hover barrage's shells) spawns its hazard with `plunge: true`, so perfect-dodging
  it sends the hero onto the flying wyrm's head and it crashes (before, every blow dealt in flight
  was a no-plunge hazard and the crash was only reachable from the Lab). Spells from the sky or the
  ground (meteors, pillars, rings, walls) still never plunge. A deflect's instant re-arm is cleared
  on respawn.
- Tests: the opt-in `probe` scenario (ADR-033), the plunge's head damage exact, the eruption chase
  judged against each pillar's live window, the deflect re-arm assert, a perfect dodge of the burning
  pass plunging onto the flying wyrm (it crashes and fights on); the win scenario's pre-merge plunge
  emulation is gone.

**Decisions:** ADR-026 … ADR-033.

**Verification:**
- Per-agent headless GPU captures (deterministic boot, the game camera plus side / back / close
  views): `scratchpad/combat3/<agent>/` (hero-look `sheet_*`, plunge `plunge_*` and
  `deflect_chain_*`, dragon-melee `sheet_<string>_side/game`, dragon-fire
  `sheet_game_<ability>`).
- Merged captures at the game camera (`scratchpad/combat3/final/`): a live fight with the AI on, the
  plunge from in front, the sky dive with the flying framing, the dive and the barrage from the air,
  the phase-3 roar and the nova opener, and the hero's back / reference / side views.
- `npm test`: ALL PASSED on the tuned merge (0 console errors; 54 catalogued events, payloads match;
  glyph check 218 literals, bad = 0). New scenarios: `plunge`, `deflect`, `strings`, `plungeReact`,
  `timing`, `fire`, `herolook`; `win` now runs three phases. Highlights: every string contact
  within ±85 ms of its flash + lead (worst 67 ms, 661 placements); every fire blow within 17 ms; the
  plunge deals exactly 90, lands in front of the head and keeps both on screen (also onto a flying
  wyrm and through the leap); the blade never sinks > 2 cm into the body (831 frames).
- `npm run build`: OK (1402 KB).
- Difficulty (integration bots; the probe ran at 4200 HP, 4500 adds ~7 %): a 95 % probe bot wins in
  145–150 s, 85 % wins 1 of 3 (129 s) and dies 2 of 3, 70 % always dies; the god-mode `win` bot at
  4500 HP wins in 157.5 s (P2 at 51 s, P3 at 91 s; 44 of 46 parries, 26 deflect chains, 24 plunges,
  posture breaks at 25 s and 87 s).

**Open issues / next:**
- **Playtest:** a human playtest is needed. The bots heal poorly, so the probe's death rates are
  pessimistic; the 3–5 min target is inferred from the bots.
- **Hero:**
  - his mass reads only modestly at the game camera (the wide skirt dominates the outline)
  - from behind, the low idle guard now shows only the point
  - 25 coat-crossing frames remain (near the hilt; the torn strips and sleeve streamers ignore the
    blade), the coat swings more in runs, the block's free hand doesn't brace the flat
  - over the wyrm at the game camera the plunging hero reads mainly through his cold tint and the
    cyan blade
- **Wyrm:**
  - the tail "jab" is a lash, not a thrust (needs a tail-raise control in the rig)
  - the wing buffet's range band is narrow (6.8–8.3 model units)
  - later string hits can whiff a hero who doesn't move (the frenzy's 4th–6th hits land on 13–17 of
    33 placements)
  - the overhead claw is hard to read at the game camera; the deflect knock-back is a small 0.14 s
    offset
  - the meteor cast has no red windup glow of its own; the dive hovers at 13 m and the barrage at
    9 m (spec 14 / 8)
  - the phase-3 eruption chase is verified in the sim only
- **FX:** the clash bloom is large in synthetic captures (the wyrm's parry spark can land on the
  hero's chest; in real fights it is at the claw).
- **Carried over from session 5:** the capture determinism leak, the stray `"` glyph particles, the
  hero's coat drape and face, the boss camera in melee, the wyrm's letter boil.
- **Next:** open the PR from `combat/epic-wyrm`; the owner plays its preview and approves; tune from
  the playtest; then cut the release (the reference match is merged but not released yet).

---

## 2026-11-08 — Session 5: the reference match (wyrm and hero look and motion)
**Owner:** "i want you to focus on making the dragon and character look as identical and good as
the attached reference images and make sure the animations and movement look great." Attached: a
red-black ASCII dragon and the "Shadow Swordsman" ASCII line-art hero.

**How:** two rounds, each with four worktree agents (dragon look, hero look, dragon motion, hero
motion), merged into `look/reference-match` (draft PR #4).
- **Round 1** (`main..f66017b`): each build agent was followed by an independent reviewer that scored
  it and added a polish pass. Scores after polish: dragon look 6, dragon motion 7, hero look 6, hero
  motion 7.5 (out of 10).
- **Round 2** (merges `ca69453`, `fc44cf4`, `c8f61c9`, `419a6ca`, from the lead's review of round 1)
  was **stopped early** because the owner wanted to wrap up:
  - hero look (self-score 6) and hero motion (7) finished and reported, tests passing
  - dragon look and dragon motion were stopped near the end, before their final self-report; their
    commits are merged (the commit messages are the record) and the full suite passes on the merge
  - none of round 2's review / polish passes completed; the hero ones were stopped mid-way and their
    unfinished edits discarded (saved as `scratchpad/look/hero-look-polish-unfinished.patch`)
- **Lead fixes after the merge:** the blade's halo dots and tip streak sit on the drawn point
  (`DIM.drawnTip ?? DIM.steelTip` in `player/fx.js`); the dead generic `artCell()` pass function,
  its `uArtCount` uniform and the unused `createArtAtlas` import are gone from `pipeline.js`.

**Done — the wyrm:**
- **Letters (ADR-018):** a thin one-pixel 4x6 font in 5x8 cells (`wyrmGlyphs.js`; 3x5 in 4x6 cells
  under 900 px tall). The v0.4 bold browser font filled its cells and printed a "silver blob".
  Letter sets by brightness tier with a per-cell letter, so letters hold still; stroke pixels take
  their own source pixel; structure codes in alpha (`0.5 + 0.01 × code`) and marching-squares
  silhouette strokes keep spikes, claws and torn edges.
- **Art source** (`wyrm` material option): charcoal shingle scales with bright free edges lit by a
  camera-fixed key light, greyed moonlight, molten cracks along the scale gaps on the undersides only
  (round 2; round 1's voronoi net drew red worms over the back), gold-rimmed orange chest and throat
  scales, crimson mottled sails with holes, torn edges, hot bone streaks and ember specks (`aEdge`,
  new `aBone`). Round 2: hide outlines by letter brightness only (rim strokes printed chevron noise),
  cooler cracks on the legs and tail.
- **Shape:** a 1.3× head (visual only, about the mouth) held low with the jaw open in a snarl, eagle
  feet with hooked talons, legs ~15 % thicker, a heavier tail, spiky crest / frills / saw tail,
  longer distal finger bones and fuller sails.
- **Motion:** flip-free joints and IK, feet planted through turns, the tail sweep's spin, the roar
  and the walk (turning in place 1.41 → 0.01 m of foot slide; roar / intro 0.7–2.6 → 0–0.33 m), the
  stomp's paws on the impact frame, the
  painting's resting display (HALF sails fitted to read broad from every game-camera yaw, an S-neck
  with the head low, a stalking stance, the arched tail, idle life). Round 2 (ADR-025): the shown
  neck spreads a strike down its length with the head pinned to the measured solve, the bite eases
  into its strike over the last windup frames (`headLead`), a head-aim turn limit except where
  spheres ride on the head (`headExact`), a parry recoil on an arc, swinging feet that absorb home
  jumps, a tail that can't fold over, and a death that falls with weight (feet planted, wings
  crumpling onto the ground).

**Done — the hero:**
- **Ink-line art (ADR-019):** part ids in alpha (`HERO_ART`, `HERO_INK`), bright lines on
  silhouettes, depth steps and part edges over dim, dense letters. Round 2 traces the lines per
  pixel (ADR-020: no letter-grid staircase), and at the game camera he is a dark figure with a dim
  cool rim, bright armour and a crisp cyan blade, cut out of the grass by a dark halo (ADR-021).
- **Blade (ADR-022):** drawn 1.64 m (`DIM.drawnTip` 1.45; the animator keeps `DIM.steelTip` 1.17)
  with a ridge line and serrations; drawn up to 0.65 m nearer the camera at the game camera, so the
  low guard reads from behind.
- **Model:** coat drapes with folds and a lavender torn zone, wider hems, kite greaves, a bigger
  spiky pauldron, a fuller mop, the face shows, more key light and contrast.
- **Motion:** speed-matched gait and a world-space foot planner, blade blending round the outside
  of the body (ADR-023), the portrait's wide contrapposto idle, light 1 cocking over the right
  shoulder, the slam's gather-and-raise windup, finish holds, the charge's coil with a coat updraft,
  a two-step thrust dash, the roll's intended sliding kneel with dust and sparks, one continuous
  slash crescent, a snappier turn, sprint hair blow-back, quiet guard taps, a shorter stagger jolt, a
  flask swig that reads from behind.

**Decisions:** ADR-018 … ADR-025. The common rule (ADR-024): look and motion polish never moves a
hit-tested frame. Hero attack active frames are bit-identical; the wyrm's attack spheres stay
within a few cm; visual size changes hang off the gameplay joints.

**Verification:**
- Deterministic headless captures on a real GPU (the real-time loop frozen, `Math.random` seeded,
  audio off), compared with the references by pixel statistics (luma shares, ink / bright %,
  white / orange / red mix) and by eye: the reference angles, side, front, back and head views, the
  1080p game camera, a live fight, and per-action strips. The owner got before / after images for
  both rounds.
  - wyrm, reference view: lit-ink colour mix white 43 / orange 23 / red 35 % (painting 41 / 22 / 37)
  - hero, reference view: mean luma 106 (reference 108), 37 % of pixels above 120 (38 %)
  - hero at the game camera, facing away: mean 113 → 80 (the scaled reference is 56)
- Gameplay, per frame in seeded Lab runs: the hero's blade matrix and hit points on 192 hit-tested
  frames, 0 differ; the wyrm's attack spheres within a few cm (round 2: ≤ 4 mm, the rake 2.3 cm);
  first contact unchanged except three swipe placements that now land, and the tail sweep no longer
  lands before its red flash (0 of 24 probes; v0.4: 5). COMBAT.md has the numbers.
- `npm test`: ALL PASSED (glyph check bad=0) on the merged code; `npm run build`: OK (1293 KB).

**Open issues / next:**
- **Process:** no round-2 review pass ran; the round-2 dragon work has no self-report. Review it (or
  have the owner play the PR preview) before merging.
- **Determinism:** captures of the merged code are no longer bit-identical run to run (two runs of
  `scratchpad/look/steps_final.mjs` differ by small pose and timing amounts), so a time or random
  source leaks into the sim. Find it before trusting before / after compares again.
- **FX:** stray `"` glyph particles show left of the hero in a back view; source unknown.
- **Hero:**
  - the coat still reads as separate flat panels with outlines, not one ragged drape with holes
  - proportions are round 1's; the hair is straight clumps; the face has no nose, mouth or shadow
  - at the game camera he is still brighter than the scaled reference (80–97 vs 56: blade glow,
    rim, the armour column), and the capital fill letters can read as text
  - the halo does not darken the wyrm's letters; the reference-angle idle is near frontal
  - strike key poses are limited by the bit-identical rule; light 1's loop is fast (a longer
    windup would be a tuning call); light 2 has no free-arm choreography; the knockdown's blade
    swings wide; the thrust's legs hide under the coat at 36 m
  - the foot-slide metrics were not re-run on the merged wide idle
- **Wyrm:**
  - at the reference angle the sails sit lower than the painting's, and with the hero straight
    ahead the far wing is a sliver behind the neck
  - in melee at 16:9 the head, neck and wings are mostly off the top of the screen (boss camera)
  - some fast motions still jump far per frame (charge thigh, bite neck); close-ups show large
    flat scales; letters change on ~39 % of lit cells per frame at idle
- **Tooling:** the capture and per-frame compare tools (deterministic boot, blade compare, hitbox
  compare) live in the session scratchpad; move them into the repo.
- **Next:** the owner reviews PR #4's preview; on approval, merge and release.

---

## 2026-11-02 — Session 4b: the hero shows his details in game
**Owner:** "everything is perfect but the main character isn't showing the details like it does in
your preview pictures", with a screenshot (~13 rows of dense `MMBM` letters) and the reference again.
"Do we need to make the character a little bigger?"

**Measured:** the hero was ~9 visible rows at the 36 m camera (1038 px tall) and ~5 on a phone (20 m,
390 px, 4x7 cells). The reference is ~90 rows. Tuned by the bonfire, his source was too bright (all
dense letters); in the arena it was 40 % darker.

**Done:**
- **Bigger on screen, gameplay unchanged (ADR-017):** `HERO_SCALE` 1.2 + a camera lean (half the
  camera pitch, feet planted), applied after the animator. `unlean()` for the sweep's hit test and
  the dragon's aim; `leanPoint()` for the name tag; the run cycle slows by `HERO_SCALE`.
- **Hero letter grid:** `createPixelArtAtlas` (3x5 pixel font, 4x6 px cells); the pass tests the
  hero grid first. Browser fonts at 5–6 px filled whole cells (tried: solid blocks).
- **Shading:** `U.uArtHeroKey` 1.15 (fixed key light), `U.uArtHeroEdge` 0.7 (darker toward the
  silhouette, no moonlit outline on the hero), `uArtBlack.x` 0.04, `uArtLum.x` 3, `uArtMin.x` 0.14,
  `uArtDither.x` 1.1, `uArtEdge.x` 0.004 (0.018 never fired at 36 m).
- **Phones:** an upscaled canvas uses `image-rendering: pixelated`.
- Result: ~25 rows at the desktop camera (front, back and running all read as the swordsman), ~15
  on a phone; the Lab close-up keeps the reference look. `npm test` green.

**Released:** owner: "push out all the changes to production including the mobile controls".
PR #3 squash-merged as v0.4.0 (classic ASCII-art creatures, touch controls, phone camera, Lab
toggle, hero detail).

**Open issues / next:**
- Real-phone check of the pixelated upscale (non-integer DPRs such as 2.625 give uneven strokes).
- The lean follows the camera: cut-in cameras get half their pitch.

---

## 2026-11-02 — Session 4: classic ASCII-art creatures
**Owner:** "Make the character and dragon look more ASCII like. Right now it doesn't have the ASCII
art style." They attached two reference images (a dragon and a hooded figure as coloured
image-to-text art) and chose smaller letters over zooming the camera in.

**Done:**
- New `FLAG.ART` class and creature ASCII-art path in the pipeline:
  - a finer grid than the world's (H/135 px cells: 4x7 at 720p, 5x8 at 1080p)
  - 4-sample cell average
  - a density-sorted `ART_CHARS` atlas built at runtime
  - brightness → letter with per-cell jitter, colour = source hue, HDR only for saturated parts
- Creature materials default to `FLAG.ART` with a smooth shaded source (`U.uArtSolid`). Per-material
  `artGain`: wyrm 0.28, hero 0.62.
- Tuned in the Lab model viewer (close-ups) and at the game camera (`uArtLum` 4.5, `uArtMin` 0.3).
  Red tells and the stomp ring read in ASCII.

**Follow-up (same day):** the owner said the dragon looks good but the hero "looks like a bunch of
random text". They also couldn't close the Lab on their phone, and asked for touch controls.
- **Hero:** own pass settings via `FLAG.ART_HERO`:
  - `artGain` 1.1
  - jitter 0.5
  - ramp floor 0.42
  - depth-edge gaps (`uArtEdge` 0.018)
  - `uArtMax` 0.8, so white letters don't bloom

  It now reads like the reference figure.
- **Phone (agent):**
  - touch layer on `core/input.js`
  - an ASCII stick and buttons with auto-aim
  - a phone camera profile (20 m), LOW quality on phones, a compact HUD
  - a rotate overlay
  - the Lab `LAB` / `× LAB` toggle
  - a `touch` test scenario
- **Decisions:** ADR-016.

**Open issues / next:**
- Real-phone check:
  - native multi-touch
  - iOS long-press and scroll blocking
  - audio unlock on the first tap
  - LOW quality look and frame rate
  - whether rim-sprint triggers by accident
- At the desktop game camera the hero is still a small letter cluster.
- Characters re-pick as creatures move (inherent to the style).

---

## 2026-11-01 — Session 3c: match the concept sheets (four-legged drake)
**Owner:** "The character hair and outfit doesn't look like the images. The dragon as well. Try to
get it accurately as close as possible." They chose to rebuild the dragon as four-legged.

**How (ultracode workflows):**
1. **Prep workflow:**
   - a Lab model viewer (side views, dark backdrop)
   - specs measured from the sheets (`docs/art/hero.md`, `docs/art/dragon.md`)
   - baseline art-director review: hero 2.5/10, dragon 2/10
2. **Build workflow:**
   - a material upgrade (`levels`, `glowAxis`/`inkAxis`, voronoi cracks, `seamAxis`)
   - parallel hero and dragon chains: the dragon in two stages (anatomy/gait, then the
     four-legged moveset), each followed by independent critic → fix rounds
   - the owner asked to finish sooner, so the loop was capped at one fix round plus a final review
   - integration verify, then side-by-side review boards
   - two usage-limit interruptions were resumed from the workflow journal with no work lost

**Results:**
- **Dragon: 6/10.** Silhouette 7, proportions 7, game read 6; no P0 left.
- **Hero: 4.5/10.** Glyph rendering 6, poses 6.5. Remaining P0s: the hair mass, and the blade
  hidden from behind at the game camera.
- **Verify fixed:**
  - the tail sweep landing 0.2 s early from straight behind (fairness)
  - membrane per-frame garbage
  - hero glyph zoom at the game camera
- **Verify flagged:**
  - clawCombo hits 2/3 tell→impact is 0.65 s, below the 0.7 s rule (pre-existing)
  - the AI rarely picks swipe/fireball/charge against a stationary hero

**Boards:** `scratchpad/art/final/*.png` (sent to the owner).

**Next:** the owner reviews the boards. A focused hero round (hair, blade read, details) is the
obvious follow-up.

---

## 2026-11-01 — Session 3b: copy the concept sheets; carved stones
**Owner feedback:** "much better". They then shared concept art (Shadow Swordsman sheet,
movement and combat key poses, Obsidian Drake sheet) and asked to make the hero and dragon look
like it. They also want better ground stones.

**Their choices:**
- restyle the wyvern (don't rebuild it as four-legged)
- make it 1.5× bigger
- the heavy slam becomes the 3rd hit of the combo
- carved crisp glyphs for stones

**Done:** three parallel agents (hero, dragon, stones) did the work, then I integrated it.
- **Hero:**
  - new model, a 1.34 m sword with a violet gem and cyan edges, and poses from the sheets
  - slam finisher and lunge thrust
  - cyan arc trails, thrust streak and crystal shards
  - reach band + step-in assist (REACH test)
- **Wyrm:**
  - obsidian / silver chevrons, lava belly, throat and inner legs, red ragged wings
  - horns, frill and spikes (merged per joint, 109 meshes)
  - upright S-neck
  - `SCALE` 1.875, with an audit of bound, bite floor, swipe reach, FX and test distances
- **Stones:** `createCarvedGlyphMaterial` (world lattice perpendicular to the camera view). Flagstones
  are irregular half-sunk slabs with grass up to their edges. Fixed the fallen stones' colliders.
- **Me:** capped the agent's boss framing zoom from +16 m to +5 m. At ~50 m the hero was lost
  again; it now sits at 39–41 m and the wyrm crops at the edges.

**Decisions:** ADR-012 (concept sheets + carved stones), ADR-013 (reach band, hero-first camera).

**Open issues / next**
- **Lava underside:** mostly visible when the wyrm faces the camera or rears. A normal-driven
  underside glow mask in the material would put it on a single mesh.
- **Cracks:** a regular grid; an irregular (Voronoi) crack pattern would read more like fissures.
- **Hero coat:** tail strips move as panels, not individually. The dodge is a forward roll, not the
  sheet's sideways dive.
- **Carved marks:** some digits (`1`, `7`) can read as text on the stones; consider symbol-only ramps.

---

## 2026-11-01 — Session 3: look pass from the v0.2 review
**Owner feedback on v0.2 (live):**
- The grass is TOO ascii: noisy, distracting, and the ground seems to move, which makes the game dizzy.
- The main character is barely visible, and the hero and dragon are blurry.
- No PARRY / DODGE text notices: dodge-only attacks should be a red warning flash from the boss,
  and parryable attacks should be read from animation.

They want previews to approve. Their answers to my questions: v0.1 grass but calmer; crisp surface
glyphs for the creatures; a brighter outline to find the hero; red flash + white glint tells.

**Done**
- Grass: restored v0.1 `world/grass.js` / `ground.js` / world wiring / quality presets; tips ~20 %
  darker; wind amplitude 0.07 → 0.04 and slower. Removed the grass path from the ASCII pass.
- Creatures: `createSurfaceGlyphMaterial` is surface-glyph by default again. It uses `SURFACE_SETS`
  defaults per `ascii` set, `glyphZoom` 0.72, sharpened coverage, darker gaps and an `outline` term
  (pow 6 falloff; a wide falloff shaded the coat flare like plastic).
  - Wyrm: cells = v0.1 × 1.3, `lumScale` 3.3–3.5, lit gaps, no outline.
  - Hero: cells 0.045–0.12 m, coat ink brighter, outline 0.8–1.7.

  Tuned live against v0.1 (scratch worktree at `v0.1.0`) and v0.2 (production).
- Tells (sub-agent): text/icon marks and log tips removed. The wyrm drives `uWarn`: red glow through
  a red attack's windup and a hard red flash at the timing cue. Parryable attacks get a white glint
  (bigger for blue). See ADR-010 and COMBAT.md.
- Lab: Showroom + Camera default buttons.

**Decisions:** ADR-010 (tells on the attacker), ADR-011 (hybrid rendering).

**Open issues / next**
- Owner approval of the previews; then merge and release v0.3.0.
- The hero is still small at the default zoom (the owner chose outline only, not a closer camera).
- Not yet done: wind-up animations exaggerated for parry reads, if the glint alone isn't enough.

---

## 2026-11-01 — Session 2: combat & presentation pass (v0.2.0)
**Goal:** the owner's v0.2 feedback (see Session 1) plus a long-term repo/deploy setup.

**Done**
- GitHub repo `eshin087/gcdAbyss` (public) + Vercel project `gcdabyss` (Git integration, `main` =
  production, PR previews, 30-day retention). `main` is protected: PR + green `test-and-build`
  required, even for admins (ADR-006).
- Rendering: one screen-space ASCII grid for everything (ADR-007) — procedural grass meadow, stone
  outlines, creature glyph sets with flow angles.
- A parallel agent workflow (builders → reviewers → integration) built the dragon (tells, posture,
  ×1.25 size, roar ring), the black-coat hero (block / parry / Ghostep / charged heavy), HUD / audio
  / flow tell presentation and the Lab. Reviewers fixed ~30 issues (flash timing vs moving players,
  AI picking attacks that can't land, Ghostep slow-mo turning into a freeze, Lab keys leaking into
  the game, ...). Integration rewrote the tests: 195 asserts, AI seeds 1–40 all green.
- Browser playtest (Lab): blue PARRY and red DODGE marks read clearly; perfect dodges at 0.2 /
  0.15 / 0.1 s before impact all Ghostep; posture break + phase-2 roar work; no console errors.
  Tuned creature cells: dark backing (`uCreatureBg` 0.04) and `uCreatureLum` 4.2 → 3.0 so the dragon
  reads as glyphs instead of white tiles; ink-independent moon rim for the black coat; grass gain
  2.3 → 1.9 so creatures pop.
- `main.js` calls `lab.postUpdate()` after the actors so the hitbox overlay isn't a frame late.

**Decisions:** ADR-007 (single ASCII grid), ADR-008 (tell-driven combat, no stamina), ADR-009
(phase gate).

**Open issues / next**
- Human playtest of balance: the god-mode bot kills the wyrm in ~20 s of combat (crits stack).
- From straight ahead only the overhead combo hit reaches the bigger wyrm's chest.
- The hero is small at default zoom; consider a stronger rim / ground ring.
- Breath can't hit a hero standing under the head (< ~7 m); the AI never picks it there.
- Not yet heard in a browser: tell audio levels, charge hum, Ghostep low-pass.

---

## 2026-11-01 — Session 1: from reference study to playable slice (v0.1.0)
**Goal:** a demo matching @Ansenjeo's ASCII MMORPG look (camera, art style) with a dragon in a forest.

**Done**
- Studied the reference (X banner + 4 clips): steep top-down perspective camera, three glyph
  techniques (arranged strokes, screen-grid ASCII, glyph FX), night palette, fire light spill.
  Findings in `docs/STYLE.md`.
- Built the rendering foundation + world myself; validated against the reference via screenshots.
- Parallel agent workflow built the dragon, player, HUD/flow and audio modules against
  `docs/ARCHITECTURE.md`, each independently reviewed, then an integration check (35 events wired,
  headless sims for win / death / retry / pause / breath).
- Playtest fixes: opening breath killed a standing player in ~2 s (tick 9→5, range 13→11.5,
  opening cooldowns); sword hitbox more forgiving (blade radius 0.05→0.22); phase-2 molten glow
  reduced to thin seams; shadow lookups use `textureLod`.

**Feedback from the owner (drives v0.2)**
- Loves the overall look; trees are the reference for "perfect ASCII feel".
- Wants: anime (SAO-like) characters; more detailed stone ASCII; creatures less "solid" / more
  ASCII; grass more ASCII; bigger dragon; much easier fight, no stamina (RPG/MMO not pure souls);
  block + parry + perfect dodge with Phantom-Blade-Zero-style tells; a Lab/debug mode;
  long-term repo + docs structure.

**Next:** v0.2 combat & presentation pass (see ROADMAP M1).
