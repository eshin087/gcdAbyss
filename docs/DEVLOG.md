# Dev log

Chronological session notes — newest first. Each entry: date, goal, what changed, decisions,
verification, open issues / next steps. Keep entries short; link commits/PRs when available.

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
