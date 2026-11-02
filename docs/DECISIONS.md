# Architecture Decision Records

Short records of significant decisions. Append new ones; don't rewrite history — supersede instead.
Template: **Context** (why decide) · **Decision** · **Consequences**.

## ADR-001 — Browser + Three.js, plain ES modules, no framework (2026-11-01)
- **Context:** fastest iteration on a custom rendering style; the reference (Ansenjeo) is also JS.
- **Decision:** Three.js (WebGL2) with hand-written ShaderMaterials; plain ES modules served as-is in
  dev (import map → `node_modules`); esbuild only to produce the single-file release.
- **Consequences:** no bundler config to maintain; zero-install play via `dist/index.html`; we own
  all shaders (no three.js lighting/shadow chunks), so shared GLSL lives in `render/shaderLib.js`.

## ADR-002 — Hybrid ASCII rendering (2026-11-01)
- **Context:** the reference uses three glyph techniques: arranged stroke glyphs (grass, dragon
  skin), screen-grid ASCII (rocks, canopies) and glyph FX.
- **Decision:** materials write an alpha FLAG into an HDR scene target; a post pass converts flagged
  pixels to a pixel-exact character grid (stone / leaf ramps); creatures use surface-space glyph
  cells; FX are glyph particles composited after the grid pass with a soft depth test.
- **Consequences:** every visible thing must pick one of these paths (see STYLE.md). New looks are
  added as new ramps/flags or glyph layouts, not as conventional shading.

## ADR-003 — Module contracts + event bus (2026-11-01)
- **Context:** modules were built in parallel by several agents and must keep scaling.
- **Decision:** a shared `game` context object, explicit per-module contracts and an event catalogue
  in `docs/ARCHITECTURE.md`; HUD/audio/flow react to events instead of being called directly.
- **Consequences:** adding a feature = emit/subscribe catalogued events; contract changes must update
  the doc and all consumers in one commit.

## ADR-004 — Headless integration tests with real modules (2026-11-01)
- **Context:** agents often cannot watch the game; logic regressions must be caught without WebGL.
- **Decision:** `tests/integration` runs the real Player/Dragon/Hud/Flow/Audio with a mocked DOM,
  WebAudio and world, driven by a bot through scripted scenarios; `tests/glyphcheck.mjs` statically
  validates glyph literals.
- **Consequences:** `npm test` must stay green on `main`; new systems add scenarios.

## ADR-005 — Hosting: GitHub (public) + Vercel static deploy (2026-11-01)
- **Decision:** public repo `eshin087/gcdAbyss`; Vercel project `gcdabyss` builds `npm run build`
  and serves `dist/` at gcdabyss.vercel.app; every push to `main` deploys, PRs get previews.
- **Consequences:** `main` must always be shippable; CI runs tests + build on every push/PR.

## ADR-006 — Protected main, PR-only changes, lean deployments (2026-11-01)
- **Context:** the owner wants every change reviewed through a PR and auto-deployed, and Vercel
  deployment storage across the owner's projects had grown far past the quota from stale deployments.
- **Decision:** GitHub branch protection on `main`: PR required (0 approvals, enforced for admins),
  required check `test-and-build` with up-to-date branches, linear history, no force-push/deletion;
  squash/rebase merges only, branches auto-delete. Vercel: Git integration only (no CLI deploys),
  30-day retention for every deployment state, and an `ignoreCommand` that skips docs/tests-only
  commits.
- **Consequences:** releases happen by merging PRs; production is always the latest merged `main`;
  previews exist per PR and expire automatically.

## ADR-007 — Everything visible goes through the screen-space ASCII grid (2026-11-01)
- **Context:** v0.1 grass (instanced stroke quads) and creatures (surface glyphs) read as "solid",
  while the screen-grid trees were the owner's reference for the right ASCII feel.
- **Decision:** one pixel-exact character grid for the whole frame. Materials write lit colour plus
  an alpha class code: grass (procedural meadow drawn in the pass from depth -> world position),
  leaf, stone (with outline glyphs on raised stones) and creatures, whose code packs a glyph set
  (scales / strands / plates / smooth) and the screen-space flow angle so glyphs follow the body.
  Creature cells use their own dark backing and brightness ramp.
- **Consequences:** every glyph on screen is aligned to the same grid. New looks are new grid rows
  + class codes in `glyphs.js` / `pipeline.js`, not new geometry. Instanced grass is gone (cheaper).

## ADR-008 — Tell-driven combat without stamina (Phantom Blade Zero model) (2026-11-01)
- **Context:** v0.1 was a stamina-gated soulslike; the owner wants an approachable RPG/MMO fight
  where skill means reading tells.
- **Decision:** remove stamina. Every enemy attack declares `normal` / `blue` (parryable) / `red`
  (dodge only) in data; shared windows and posture numbers live in `src/combat/rules.js`;
  `takeHit` returns a `RESULT`; perfect dodges trigger Ghostep (blink behind, slow-mo, crit window);
  parries and hits fill a posture meter that breaks into a crit window. `combat:flash` is the
  single authoritative timing cue.
- **Consequences:** new enemies only declare data + call the shared contract; the HUD, audio and
  Lab render any attacker's tells for free. Balance is tuned in data, not code.

## ADR-009 — Phase gate on boss HP (2026-11-01)
- **Context:** stacked Ghostep / posture-break crits could take the wyrm from >50 % HP to dead,
  skipping phase 2 and its transition entirely.
- **Decision:** while the AI runs the fight, phase-1 damage clamps at the phase-2 threshold until
  the transition starts. The Lab (AI off) bypasses the gate.
- **Consequences:** every player sees phase 2. Hits at the threshold still show damage numbers but
  don't move the bar; revisit if it reads as unfair in playtests.

## ADR-010 — Tells live on the attacker, not in the HUD (2026-11-01)
- **Context:** v0.2 showed tells as HUD marks over the enemy (◆ PARRY / ! DODGE labels, closing
  rings, off-screen arrows, red edge pulse through the windup) plus log tips. The owner rejected
  text indicators: dodge-only attacks should read as a red warning flash from the enemy itself, and
  parryable attacks should be read from the animation.
- **Decision:** the attacker renders its own tell. Red (dodge-only): the creature glows red
  through the windup via a material uniform (`uWarn`, ramping toward the timing cue), spikes on
  `combat:flash` with a red glyph burst, and AoEs keep their red ground ring. Normal / blue
  (parryable): no colour during the windup; a white glint at the striking part on `combat:flash`,
  larger and brighter for blue (still white). The HUD keeps only a ~0.25 s red screen-edge flash on
  a red cue; no text, icons, rings or arrows in the world. `TELL` semantics and the
  `combat:tell` / `combat:flash` contract are unchanged; the presentation numbers live in
  `TELL_STYLE` (`rules.js`). Supersedes the HUD-marks part of ADR-008's "HUD renders any
  attacker's tells".
- **Consequences:** every new enemy must expose `uWarn` on its materials (free with
  `createSurfaceGlyphMaterial`), drive it from its tell beats, and have windups readable from the
  animation alone — parryable hits get no colour hint before the glint. Readability now depends on
  animation quality; the Lab's coloured chips remain as a dev aid.

## ADR-011 — Hybrid rendering: calm world-anchored grass, crisp surface-glyph creatures (2026-11-01)
- **Context:** ADR-007 put everything through one screen-space character grid. In review the owner
  found the grass "TOO ascii" (noisy, distracting), the ground seemed to move as the camera panned
  (dizzying: glyphs were re-picked per screen cell every frame), the hero was hard to find and the
  hero and wyrm were blurry (one glyph per 8x12 px cell is too coarse for a 50 px hero).
- **Decision:** supersede ADR-007 for grass and creatures. Grass returns to v0.1's instanced glyph
  strokes fixed in the world, darker and with gentler wind. Creatures print glyphs on their surface
  again (v0.1 technique), but sized to stay >= ~6 screen px, drawn larger inside their cells with
  sharpened edges, over near-black gaps; the hero gets a thin moonlit silhouette line. Stones,
  ruins, trunks and canopies stay on the screen grid (the owner's favourite part). The creature
  grid path remains available behind `grid: true` but is unused.
- **Consequences:** two glyph systems to keep visually consistent (STYLE.md rules of thumb). The
  ground is calm by construction. Glyph legibility now depends on cell size vs camera distance, so
  new creatures must check it at the default zoom (Lab → Showroom helps).

## ADR-012 — Concept sheets drive the look; stones become carved world-lattice glyphs (2026-11-01)
- **Context:** the owner supplied concept sheets (Shadow Swordsman: model, movement and combat key
  poses; Obsidian Drake: painting + ASCII version) and asked to copy them. They also disliked the
  screen-grid stones (`+=+=` rows read as text).
- **Decision:**
  - The hero and wyrm follow the sheets within the existing skeletons. The wyvern stays a wyvern
    (owner's choice), and the wyrm grows to 1.5× its v0.2 size (`SCALE` 1.875).
  - Rocks, standing stones and flagstones use `createCarvedGlyphMaterial`: a world-anchored glyph
    lattice perpendicular to the fixed camera view, glyphs picked by facet light, with cracks and
    moss. Trees, bones and the bonfire stay on the screen grid.
- **Consequences:**
  - The sheets are the reference for future look work.
  - Carved glyphs shrink with zoom, unlike the grid.
  - A bigger wyrm needs the player reach band (ADR-013) and a bounded boss camera.

## ADR-013 — Player reach band, step-in assist, hero-first boss camera (2026-11-01)
- **Context:** at 1.875× the wyrm's chest sits ~4 m up. Blade-vs-sphere hits missed from the front.
  The automatic boss framing then zoomed out to ~50 m, shrinking the hero the owner already found
  hard to see.
- **Decision:**
  - Sword hits test a vertical reach band (2.6 m up, 1.0 m for the slam; 0.5 m down; 0.4 m tip
    extension).
  - A short step-in assist (≤ 1.3 m) applies when the target is within 4.8 m and 0.8 rad.
  - The boss camera may add at most 5 m of zoom. The wyrm crops at the screen edges before the hero
    shrinks.
- **Consequences:**
  - All attacks land from 2–3.5 m in front (REACH scenario).
  - Very large future bosses will crop at the screen edge. That is accepted: readability of the
    player comes first.
