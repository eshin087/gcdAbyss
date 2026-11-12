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

## ADR-014 — Four-legged drake; look work is reviewed against the sheets by an independent critic (2026-11-01)
- **Context:** the restyled wyvern still didn't look like the owner's Obsidian Drake. A wyvern's
  wings are its front legs, and the art is a quadruped with separate sail-like wings. The owner
  asked for "as close as possible" and chose the rebuild.
- **Decision:**
  - The boss is a quadruped (`buildDrake`), with a new rig/gait and wings that rest half-raised.
    Every ability keeps its name, tell, windup, flash timing and damage.
  - Look work follows `docs/art/*.md`. It is checked in the Lab model viewer from the sheets'
    angles, by an independent reviewer who scores silhouette, proportions, details, colours,
    glyph rendering, poses and the game-camera read.
- **Consequences:**
  - Attack anchors moved to the real striking parts (forefeet, claws, snout, tail).
  - Hit-timing spreads are measured per ability in COMBAT.md.
  - Future look passes start from the critic's gap list rather than impressions.

## ADR-015 — Creatures as classic ASCII art: screen-grid conversion of a shaded source (2026-11-02)
- **Context:** the owner shared two reference images and asked for the hero and dragon to "look more
  ASCII like". The references are image-to-text conversions: upright characters on a fixed grid,
  density by brightness, per-character colour, black backing. Glyphs printed on 3D surfaces
  (ADR-011) don't read that way.
- **Decision:**
  - Creature materials render a smooth shaded source (`FLAG.ART`).
  - The ASCII pass converts it on a finer grid than the world's (owner's choice: smaller letters so
    the hero keeps a few rows at the game camera), using a density-sorted `ART_CHARS` ramp and the
    source hue.
  - Per-material `artGain` balances bright and dark inks.
  - The world grid (stones, trees) and the world-anchored grass are unchanged.
- **Consequences:**
  - Characters re-pick as creatures move, the inherent "ASCII video" look. This is acceptable for
    actors; the ground stays calm.
  - Surface-glyph patterns now only shape the source image.
  - At the default camera the hero is a small letter cluster; detail lives in close-ups.

## ADR-016 — Touch is a virtual layer on the input system; phones get their own camera (2026-11-02)
- **Context:** the owner tests on a phone. They couldn't close the Lab (it is keyboard-toggled) and
  had no controls.
- **Decision:**
  - Touch controls feed virtual keys, buttons and an analog axis into `core/input.js`
    (`setVirtual`, `setVirtualAxis`). Player and flow code are unchanged and read the same API.
  - Auto-aim parks `game.mouseGround` on the dragon instead of forcing lock-on.
  - The camera rig has a phone profile: 20 m default, extra zoom capped at 3 m.
  - Phones default to LOW quality.
  - Landscape only.
- **Consequences:**
  - Gameplay and tests are shared between desktop and touch (a `touch` test scenario).
  - Real-device checks are still needed for native multi-touch, iOS gestures and frame rate.

## ADR-017 — The hero is drawn bigger and leaned toward the camera; gameplay keeps the upright body (2026-11-02)
- **Context:** the owner saw the hero in game as ~9 rows of dense letters, "not showing the details"
  of the close-ups, and asked whether he should be bigger. From the 58° camera a standing figure
  shows mostly its top and spans about half its height; at 36 m that is ~5 % of the screen.
- **Decision:**
  - The hero's root draws him `HERO_SCALE` 1.2x and sheared away from the camera by half its pitch
    (29°, feet planted), so he faces the view. The animator poses the plain body first
    (`lean.on = false`); the drawn transform is applied after it.
  - Gameplay stays on the upright 1.85 m body: the sword's hit test unleans its points, the
    dragon aims at the unleaned chest, the hurt cylinder is unchanged. FX follow the drawn body.
  - The hero gets a finer pixel-font letter grid and a key-lit, edge-darkened source.
  - The camera distance is unchanged (wheel / pinch zoom still work).
- **Consequences:**
  - ~2.7x the letter rows with no change to combat balance or framing.
  - The drawn blade (1.8 m) is about the gameplay reach (1.5 m + `REACH.tipExt` 0.4).
  - The drawn body overlaps more of an attack's area than the hurt cylinder (generous to the player).
  - The moon shadow is cast by the leaned, scaled body.
  - New code that reads hero joint positions for gameplay must use `player.unlean()`.

## ADR-018 — The wyrm prints in a thin pixel font: letter sets by brightness, structure in alpha (2026-11-08)
- **Context:** the owner asked for the dragon and hero to look "as identical and good as" his two
  reference images. The dragon reference is thin, anti-aliased digits on black whose brightness
  draws charcoal scales, orange cracks and crimson sails; scale outlines cut through the letters. The
  v0.4 wyrm printed as a "silver blob": a 7 px bold browser font filled its 4x7 cells, one colour per
  cell dissolved shapes into digit noise, thin spikes vanished (a cell needed 2 of 4 samples), and a
  22-step density ramp re-lettered ~60 % of the lit cells every frame at idle.
- **Decision:**
  - The wyrm gets its own pixel font (`wyrmGlyphs.js`): one-pixel 4x6 glyphs with a soft halo in 5x8
    cells, mostly digits; 3x5 glyphs in 4x6 cells under 900 px tall.
  - A cell's brightness picks a letter SET (dim / mid / bright) and the cell's hash picks the letter
    inside it. Each stroke pixel takes brightness and hue from its own source pixel.
  - The material encodes structure in alpha: `0.5 + 0.01 × stroke code` (the screen direction of a
    thin part's outline). Coded cells and silhouette cells (marching squares on the 4 samples) print
    `/ | \` strokes; one sample is enough for a stroke cell.
  - A dedicated art source (`wyrm` material option): shingle scales with bright free edges, molten
    cracks along the scale gaps on down-facing surfaces, torn crimson membranes (`aEdge`, `aBone`),
    a key light fixed to the camera and greyed moonlight.
  - Round 2: the hide's scale outlines come from letter brightness only (rim strokes printed a field
    of chevrons at the game camera); strokes stay on thin parts and the silhouette.
- **Consequences:**
  - Supersedes ADR-015's single `ART_CHARS` ramp for the wyrm (the generic `artCell` path is gone).
  - Alpha 0.50–0.54 is the wyrm's stroke-code window (ARCHITECTURE.md alpha contract).
  - Letters still change on ~39 % of the lit cells per frame at idle (v0.4: 34 %); going lower needs
    a temporal buffer.
  - About +0.3 ms per frame on an RTX 4090 at 1080p (round 1).

## ADR-019 — The hero is ink-line ASCII art (2026-11-08)
- **Context:** the hero reference is anime line art turned into ASCII: a dim, dense letter fill
  inside bright ink strokes along every silhouette and panel edge (29 % bright / 59 % dim lit
  pixels). The v0.4 hero (ADR-017's key light, edge darkening and black depth gaps) was a uniform
  light-grey letter field (81 % bright / 18 % dim) and, at the 36 m camera, a pale column of text.
- **Decision:**
  - Hero materials write a PART ID into alpha (`HERO_ART`: `0.4632 + (part × 2 + aPart) × 0.0006`)
    instead of a flag.
  - The art pass draws bright ink lines on the silhouette, on the nearer side of depth steps and on
    part edges (the higher part draws), over dim fill letters.
  - All per-part look data lives in one table (`HERO_INK` in `player/model.js`: fill, line tint and
    gain, fill gain, line style, far values), packed into shared uniforms.
  - The source is an opt-in `heroArt` material block, compiled only for the hero (the wyrm's shader
    is unchanged).
- **Consequences:**
  - Supersedes ADR-017's hero shading (`uArtHeroKey` / `uArtHeroEdge` are left declared but have no
    effect) and its black depth gaps. ADR-017's size and lean stay.
  - Part ids need a half-float scene target; the 8-bit fallback collapses them (rare on WebGL2).
  - A new hero part needs a `HERO_INK` entry; parts layered on top get higher ids.
  - GPU cost stayed within noise on an RTX 4090.

## ADR-020 — The hero's ink lines are traced per pixel (2026-11-08)
- **Context:** round 1 drew one centred stroke glyph (`| - / \`) per 4x6 letter cell. Every diagonal
  and curve stair-stepped, which read as "boxy, robotic". The reference's lines are continuous
  ~2 px strokes with dotted rag edges.
- **Decision:** each hero pixel is classified against its 1-px neighbours: silhouette, depth step
  (the nearer side draws; a slope predictor skips curved and grazing surfaces), part edge (the higher
  part), piece edge (sub-id, up close). Lines are one font pixel wide with a dimmer second pixel up
  close, and break at the letter spacing so a contour reads as a chain of stroke glyphs; per part
  they are per-cell strokes, dotted (tails, hair) or unbroken (blade, gem). The letter grid only
  picks the fill letters.
- **Consequences:**
  - About 9 extra texture fetches per hero pixel (17 up close); GPU time stayed within noise.
  - The `PIXEL_LINES` atlas row is no longer sampled.
  - The lines are no longer quantised to the letter grid. Accepted: the reference's are not either.

## ADR-021 — At the game camera the hero is a dark figure cut out by a halo (2026-11-08)
- **Context:** at ~125–150 px tall almost every cell sat on an edge, so the hero read as a grey or
  white wireframe (mean luma 104–113, 43–51 % of pixels above 120). The reference scaled to that size
  is a dark figure (mean 56, 56 % below 50) with silver armour, pale lavender tails, a pale face and a
  cyan blade. A round-1 switch to heavy strokes at 14 m popped exactly at the phone camera's minimum
  distance.
- **Decision:**
  - A distance LOD by view depth (6 → 20 m, dithered per cell, no pop): a one-letter outline, piece
    edges drop out, cloth inner lines turn into dark seams (`farLine`), each part gets a far fill gain
    (`farFill`: cloth dark, armour bright), the silhouette is a dim cool rim, the blade's HDR is
    capped to a tight line.
  - A dark halo round him darkens the world grid next to his figure (two rings of taps round his
    screen position), fading in from 8 to 20 m.
- **Consequences:**
  - Facing away (the usual fight view): mean luma 113 → 80, above-120 share 51 → 24 %. Still brighter
    than the scaled reference (80–97 vs 56).
  - The halo only darkens the world grid; over the wyrm's letters he has no cut-out.
  - The far look is a judgment call the owner should confirm in play (`uHeroLod.w`, `farFill` tune it
    live).

## ADR-022 — The drawn blade is decoupled from gameplay: a longer point and a depth pull (2026-11-08)
- **Context:** the portrait's blade runs from the gem to the point over ~70 % of his height; ours
  was ~56–60 %. Lengthening `DIM.steelTip` raised the slam's blade by 28 cm at the end of the hit
  segment on its impact frame. From behind at the game camera the low guard lay just behind his legs
  and in the grass: only a glow at his boot showed.
- **Decision:**
  - Three lengths: `DIM.drawnTip` 1.45 (the drawn point), `DIM.steelTip` 1.17 (what the animator
    poses and clamps; unchanged), the hit segment 0.16 → 1.5 (+ `REACH.tipExt` 0.4; unchanged).
  - `heroArt.pull`: at the game camera the blade, point and gem are drawn up to 0.65 m nearer the
    camera along their own view rays (`BLADE_PULL`: none under 10 m, full from 24 m): the same pixels,
    a nearer depth, so the blade shows over his legs and the grass.
- **Consequences:**
  - Every attack's active frames stay bit-identical; the drawn point stays inside the hit segment.
  - FX on the point must use `DIM.drawnTip ?? DIM.steelTip`.
  - The pulled blade draws over parts of his body it is really behind. Accepted for readability;
    close-ups are unaffected.

## ADR-023 — The hero's feet are planned in world space; blade directions blend round the outside (2026-11-08)
- **Context:** the feet skated in every moving clip (run 0.8 m/s, combo 2.3 m/s with 12 m/s peaks):
  the stride did not match the speed and idle and gait feet were blended. The blade whipped through
  the legs and the ground on every side change: a component lerp passes through straight down (tip
  jumps of 0.67–0.75 m per frame, the blade inside a thigh for 1–29 frames per clip), and
  cross-fades re-chose their way round every frame (a ~350° spin between light 1 and light 2).
- **Decision:**
  - Stride and cycle length follow the speed, so a stance foot moves at the drawn ground speed; a
    foot planner holds planted feet in world space through starts, stops, curves and turns, and
    standing feet re-plant with short steps.
  - The drawn heading follows a critically damped spring (visual only); attacks and guards use the
    gameplay facing.
  - Blade directions blend by azimuth and elevation round the outside of the body; a fade keeps last
    frame's way round; outside attacks the blade is pushed out of the leg capsules before the ground
    clamp.
- **Consequences:**
  - Planted-foot slide ~0.03 m/s; 0 frames of blade inside the body in every clip.
  - A standing 180° turn trails the gameplay yaw by up to ~0.2 s (visual only).
  - Where the gameplay root keeps moving (the roll's 4–6 m/s), feet slide; the roll's kneel was made
    an intended slide with dust instead.

## ADR-024 — Look and motion polish never moves a hit-tested frame (2026-11-08)
- **Context:** two rounds of four agents reshaped poses and silhouettes on a fight whose timings,
  reaches and windows are balanced and tested (COMBAT.md). The look wanted a bigger head, longer
  blade and longer wings; the motion wanted new windup paths and key poses.
- **Decision:**
  - Hero: attack **active frames stay bit-identical**. A path that reshapes a windup reaches the
    clip's own pose by windup − 1/30 s and hands its channels back; recovery shaping starts at
    windup + active + 0.035 s (the frame after the window is still hit-tested); active-frame shaping
    uses only non-blade channels. Proof: a per-frame compare of `sword.matrixWorld` and the hit points
    against the previous build (round 2: 192 frames, 0 differ).
  - Dragon: attack hit spheres on active frames stay within a few cm of the baseline, measured per
    frame in seeded Lab runs, and first-contact timing is re-measured per ability (round 1 vs v0.4:
    mostly 2–6 cm, a few frames up to ~13 cm on the charge's 3.2 m chest sphere; round 2 vs round 1:
    ≤ 4 mm except the rake's 2.3 cm).
  - Visual size changes hang off gameplay joints instead of moving them: the 1.3× head on `headVis`
    about the mouth, longer distal finger bones with the knuckles fixed, a thicker drawn tail over the
    unchanged chain clearance, the hero's longer drawn blade.
  - Cosmetic randomness in code the integration sims run uses the animator's own noise, never
    `Math.random` (the sims seed it and the wyrm's AI rolls on it).
- **Consequences:**
  - Gameplay (hitboxes, timings, balance) is unchanged; `npm test` stays the gate.
  - Strike key poses can't get stronger holds on active frames without a hit-volume decision or
    decoupling the sword's world matrix from the body.
  - Every motion change needs the per-frame compare run. The tools live in the session scratchpad,
    not in the repo yet.

## ADR-025 — The wyrm's shown motion is separate from its measured motion (2026-11-08)
- **Context:** FABRIK moves a chain's tip first, so the bite's 1.8 m strike step turned the last
  neck segment 75° in one frame while the base barely moved; the strike had no acceleration (an
  exponential approach from a still coil); the head's aim flipped 30–90° in a frame when the look
  target passed under it. Letting the painting's resting S shape the one neck chain changed how the
  next windup coiled it (the bite's head ended ~0.8 m short).
- **Decision:**
  - Two neck solves: `_neckSim`, the measured one every attack's head path and hit spheres were tuned
    on, and `neck`, the shown chain (the resting S at rest; while an attack drives the head it swings
    toward the measured head, spreading the step down its length). The head joint is pinned to the
    measured solve.
  - `pose.headLead` lets the last three windup frames lead the SHOWN head into the strike (no hit
    test runs in a windup).
  - `pose.headExact` marks the frames whose hit spheres ride on the snout or mouth; there the head
    aims exactly, elsewhere its aim turns at most 11 rad/s.
  - `pose.tailLegacy`: the tail sweep runs the v0.4 tail solve its spheres were measured on; the new
    tail limits apply everywhere else.
- **Consequences:**
  - Worst neck joint per frame: bite 75 → 37°, parry recoil 137 → 46°; attack spheres within ~1 cm.
  - New attacks with head-borne hit volumes must set `headExact` on those frames, and polish must
    never edit the measured solve.
  - The neck hurt spheres ride on the shown chain, so they can differ from the measured neck.

## ADR-026 — Enemy combos are data-driven strings; a parry deflects a hit without ending the string (2026-11-09)
- **Context:** the owner asked for Sekiro / Phantom Blade Zero combos where several parries in a row
  are possible: a flow of exchanges. Until now a parry cancelled any melee attack with a recoil, so
  the one multi-hit attack (the claw combo) ended at its first parry.
- **Decision:**
  - A string is data: `TUNING.attacks[name].hits[]`, each hit a `kind` (a performance in `KINDS`)
    with its own tell, windup (+ an optional random hold that baits an early parry), active, impact,
    damage, knockback and an optional `chance`. `makeString` builds the action with one tell beat
    per hit.
  - A parried hit that is not the string's last is deflected: its posture damage and a 0.14 s visual
    knock-back, no timing change; the next hit comes on schedule. Parrying the last hit (or a single
    melee attack) recoils as before. `dragon:parried` gains `{hit, last}`; `combat:deflectChain
    {count}` fires from the second parry in a row.
  - Data rules, tested: the first windup ≥ 0.7 s, ≥ 0.45 s from impact to impact, every contact
    within ±85 ms of its flash + lead.
  - A red hit inside a string must be dodged; a perfect dodge of it plunges and ends the string.
- **Consequences:**
  - Seven strings today (claw combo, rending flurry, hesitant maw, wing buffet, tail lash, pounce,
    frenzy); new enemies get combos from data plus kinds.
  - Posture comes mostly from parry chains, so the meter grew (560 / 640 / 720 per phase).
  - The AI picks a string by its first hit's band: later hits can whiff a hero who stands still.

## ADR-027 — A perfect dodge of the wyrm becomes a plunge onto its head (2026-11-09)
- **Context:** Ghostep (ADR-008) blinked the hero 3.2 m behind the attacker. Behind a 7.5 m-tall wyrm
  the player could not see himself and lost his bearings. The owner asked for the hero to appear on
  top of the dragon and stab down into its head, automatically on every perfect dodge in range.
- **Decision:**
  - An attacker that offers `plungePoint(out)` and `onPlunge(o)` gets the plunge on a perfect dodge
    with its head within `DEFENSE.plunge.range` (30 m), unless the hit forbids it (`takeHit`
    `plunge: false`): vanish, hang 5 m above the head, dive, one `onPlunge` (90 final damage, 40
    posture), ride the head down, backflip to a visible landing in front of it toward where he came
    from, then the crit window. Invulnerable throughout; the camera keeps both on screen.
  - Out of range or forbidden: the slow-mo and crits in place, no teleport. Attackers without the
    API keep the v0.2 blink behind them.
  - While the wyrm is posture-broken, an attack near its head (9 m) starts the same move as an
    execution (260 final damage), which spends the break.
  - The attacker plays its own `plunged` reaction (the head slammed down, a thrash, the rise; in the
    air a crash first) and keeps its head on its joints for the rider.
- **Consequences:**
  - Supersedes ADR-008's "blink behind" for the wyrm; `player:perfectDodge` and `player:ghostep`
    still fire.
  - The hero's `position.y` is no longer always 0 (the plunge's lift); hits and body circles are
    skipped meanwhile.
  - The camera rig got a general keep-in-view request (`cameraRig.keep`).
  - The plunge is a large damage source (90 per perfect dodge): the damage is final (no head ×1.5)
    and the HP was raised to match (ADR-033).
  - The airborne crash is reached in play by perfect-dodging fire the wyrm breathes or spits from the
    air (the burning pass's stream, the hover barrage's shells: hazards spawned with `plunge: true`,
    ADR-029), and by the dive's crash landing.

## ADR-028 — Three boss phases behind HP gates; a new phase's abilities unlock one by one (2026-11-09)
- **Context:** the owner wants a 3–5 min, hard fight in three phases. ADR-009's gate covered one
  transition at 50 %. When a phase unlocked several new abilities at once, they all came right after
  the roar.
- **Decision:**
  - Phases start at `TUNING.phaseAt` [1, 0.66, 0.33] of max HP. Every threshold is a gate: while the
    AI runs, damage clamps there until the transition starts. `brain.pendingPhase` holds the next
    transition; it waits for the intro, another transition, the death or a plunge reaction, and never
    starts while the wyrm is broken.
  - Each transition is a scripted roar (a red shock ring) that clears every hazard and heats the
    wyrm up; phase 3 opens with the Inferno nova.
  - Per-phase tuning as `[P1, P2, P3]` arrays read with `perPhase`: time scale, turn, walk, idle
    gap, posture max, glow, embers, jaw, attack weights.
  - `enterPhase(n)` gives the abilities phase n unlocks staggered opening cooldowns
    (`TUNING.unlockStagger` [2, 2.5, 2] s, in a random order).
- **Consequences:**
  - Extends ADR-009 to every gate. `dragon:phase3` and `dragon:phase {n}` join `dragon:phase2`.
  - Each phase reads as a step up, and the nova's 2.5 s charge announces phase 3.
  - The transition roars always run at phase-1 timings.

## ADR-029 — Fire hazards are world threats that run on their own (2026-11-09)
- **Context:** the owner wanted epic fire spells: meteor rain, eruptions, flame walls and rings, an
  inferno nova. If each spell were one long action, the wyrm would stand still while it rains;
  layering threats needs them to live apart from the current action.
- **Decision:**
  - A pooled `Hazards` system on the dragon (`hazards.js`): circles, strips, rings, walls and pillar
    lines, plus rain and chase emitters. `dragon.update` runs it every frame (guarded); it is cleared
    on reset, death and every phase change, and allocates nothing per frame.
  - Every hazard shows a red ground warning from spawn to impact and deals one red blow through
    `dragon.hitPlayer` (default `plunge: false`): block and parry fail, i-frames or moving away avoid
    it, and a perfect dodge gives the slow-mo in place (dodging a meteor must not put you on the
    wyrm's head). Fire the wyrm itself breathes or spits from the air (the burning pass's stream, the
    hover barrage's shells) spawns with `plunge: true`: perfect-dodging it plunges onto the flier.
  - A hazard either announces itself (`combat:tell` / `combat:flash` with `hazard: true`) or is
    covered by the spawning attack's own tell, re-timed from the hazard's geometry (`timeTo`).
  - The AI may start melee while hazards burn. Hit caps per group limit what a rain or a chase can
    deal (meteors ≤ 3 hits). The HUD's red screen edge skips hazard flashes (a meteor rain pulsed the
    whole screen); audio plays a lighter cue.
- **Consequences:**
  - The fight layers: a string while meteors fall.
  - `hazards.js` lives in the dragon module; a second enemy that casts hazards would move it to a
    shared place.

## ADR-030 — The wyrm flies only inside single attacks (2026-11-09)
- **Context:** the owner wanted flying attacks and fire from the air, and chose short flights over
  an extended flight phase.
- **Decision:**
  - Each flight is one action: take off, attack from the air, land (the burning pass, the sky dive,
    the hover barrage). In the air `state === 'airborne'` (the leap's convention): no body circles,
    staggers wait, and the hurt spheres ride the drawn body, out of sword reach; only the plunge
    reaches the head.
  - The AI never picks an attack while airborne (`attackWeight`'s `air` flag exists; nothing sets
    it).
  - Flight poses are rig pose fields (`hover`, `glide`, `dive`, `altRate`) and two wing keys
    (GLIDE, DIVE). Hover points sit beside the hero so the flier stays on screen, and the flow asks
    the camera to keep its head and body in view.
- **Consequences:**
  - No flight-phase AI or aerial targeting to maintain; flights stay ≤ 16 m up and in the bound.
  - A plunge mid-flight crashes the wyrm where it was hit (`d.crashing`), but every blow dealt in
    flight comes from a hazard, so in play the plunge always meets a grounded wyrm.

## ADR-031 — The hero gets girth, not longer bones; his blade is depth-tested again (2026-11-09)
- **Context:** the owner found the hero "too lanky / skinny", and the sword always showed and clipped
  through him, even through his back from behind. ADR-022's depth pull drew the blade up to 0.65 m
  nearer the camera so the low guard would read from behind; it also drew it over parts of his body
  that are really in front of it.
- **Decision:**
  - The mass comes from mesh radii and widths (`BODY` in `player/model.js`): chest 0.50 × 0.27 m,
    waist 0.31, hips 0.34, thick arms and legs, shoulder joints ±0.21. Bone lengths drive the IK, the
    foot planner and the blade's hit segment, so they stay.
  - The sword hand aims from the old shoulder spot (`DIM.gripShoulder`, `rig.arms.R.anchor`).
  - The depth pull is removed (`heroArt.pull`, `SG_HERO_PULL`, `uArtPull`, `BLADE_PULL`): the blade
    is depth-tested like every other part.
  - The coat yields to the steel: each panel hangs inside the sword hand and the blade or drapes over
    them, latched per panel.
- **Consequences:**
  - Supersedes ADR-022's depth pull; its three blade lengths stay.
  - From behind only the steel beside his silhouette shows: the low idle guard shows just its point.
  - Not bit-identical (ADR-024): the hit segment moved by ≤ 2.5 cm on some active frames; the REACH
    table is unchanged.
  - At the game camera the extra mass reads only modestly; the coat skirt dominates the outline.

## ADR-032 — A successful deflect re-arms the parry at once (2026-11-09)
- **Context:** strings put a blow every ~0.45 s. The anti-mash rule (RMB must be up `parryRearm`
  0.25 s before a press counts) failed a player who held the guard a moment after each deflect,
  which is natural because holding keeps blocking. The parry freeze also stretches real time while
  `parryRearm` counts game time.
- **Decision:** a successful parry sets `player.rmb.chain`: the next press counts as soon as RMB has
  been released. Every press clears it, so a press that parries nothing needs the full re-arm again.
- **Consequences:**
  - A string can be deflected blow by blow with the guard held between taps (DEFLECT scenario: two
    blows 0.3 s apart with taps held 0.2 s, both parried).
  - Mashing still fails (the PARRY scenario's mashed RMB).
  - Player-side only: enemies need nothing.

## ADR-033 — Difficulty is set by measurement: the probe bot (2026-11-09)
- **Context:** the target is a 3–5 min fight for a player who knows the moves, hard enough that a
  skilled player dies several times while learning it. Guessed numbers had missed before (v0.2's
  god-mode bot won in ~20 s of combat), and on the melee branch the god-mode bot won in 75–90 s with
  ~35 % of the HP from emulated plunges.
- **Decision:**
  - Tune against the integration bots: `win` (god mode, answers every tell) for fight length and
    phase timing, and the opt-in `probe` scenario (a mortal bot that answers a share of the tells,
    `ABYSS_SKILL`; reseed with `ABYSS_SEED`) for danger, at several skills.
  - The lead's retune: HP 4200 → 4500, the plunge's damage final (no head ×1.5), AI weights toward
    the strings and the fire attacks, the unlock stagger.
  - Record the measurements in COMBAT.md "Current numbers" whenever the balance changes.
- **Consequences:**
  - Measured (probe at 4200 HP): a 95 % bot wins in 145–150 s, an 85 % bot wins 1 of 3, a 70 % bot
    always dies; the god-mode bot at 4500 HP wins in 157.5 s.
  - The bots heal poorly and never learn, so the death rates are pessimistic; a human playtest still
    decides.
  - `probe` is not part of `npm test`'s `all` run.


## ADR-034 — The hero is the lean swordsman of the reference sheet; the coat is two tails and panels (2026-11-09)
- **Context:** the owner attached a six-view ASCII turnaround and a single-figure image of the hero
  and asked for the character to match them, "especially from the back and rear three-quarter
  gameplay views". Measured on the sheet's silhouettes (fractions of his height H): shoulders ≈ 0.24 H
  across, the chest ≈ 0.18 H, the belted waist ≈ 0.12 H, thighs ≈ 0.06 H. Round 3's broad build
  (ADR-031: a 0.50 m chest, 0.62 m across the deltoids, heavy limbs) and its closed A-line skirt read,
  from behind at the game camera, as a cloaked trapezoid with no legs; the hair was a round helmet,
  and the portrait idle's blade lay across his front, so from behind only its point showed.
- **Decision:**
  - A lean V on the same bones (`BODY`): chest 0.34 m over a 0.23 m waist, shoulder joints ±0.16,
    slim limbs. The sword hand still aims from `DIM.gripShoulder`, so no grip target moved.
  - The coat (`COAT_PANELS`) is six panels: two back TAILS split by a vent from just under the belts,
    narrow side panels, two front panels. A panel's vent / front edge hangs straight or drifts out
    (`skew`: the width it gains goes to its outer side, `sheetOffset`), its hem slopes down to the
    outer point (`slant`), and piping runs down the vent and front edges (`edge`). The legs show in
    the vent and the open front in every view. No front flap; 12 torn strips (was 22).
  - Hair of distinct pointed locks in layers (crown spikes, top, two back layers hanging down with
    their points lifting, nape flicks, side locks, a jagged fringe) on a closer scalp cap.
  - A taller-at-the-front, flared collar with a turned-over rim; a shaped upper back (a yoke whose
    seams dip to a four-point star, a centre seam); a baldric from the right shoulder to the left hip;
    a stack of spiked lames on the right shoulder; banded calves.
  - The sword after the single-figure image: broad at the guard, one long taper to a sharp point,
    barbs at the base, lightning notches, a guard swept up toward the blade round a violet
    four-point star gem (`DIM.gem` 0.116 at the guard, `DIM.forte` 0.2).
  - The idle (`guard`) hangs the sword at his right side, angled out and forward-down, as on the
    sheet; a near half-turn of the blade (from the light combo's finish over his left shoulder) goes
    round the FRONT below head height (`DIR_FLIP`): the way behind cut through the sword arm.
  - At the game camera the blade self-lights about half as much (`player.js`) under a lower HDR cap
    (`uHeroFar.w` 1.8 → 1.3), the armour's far fill and lines come down ~25 %, the lavender torn
    zone's far fill doubles.
- **Consequences:**
  - Supersedes ADR-031's broad build (its depth-tested blade and coat-vs-steel rules stay).
  - Gameplay unchanged: no bone length, grip target, attack timing or hit segment changed; the hurt
    cylinder is the same. The slam / light poses are untouched; only the idle and the way a near
    half-turn blends changed. The cosmetic blade halo spawns fewer particles, which shifts the shared
    `Math.random` stream the seeded wyrm AI rolls on (the DIE scenario's pause check now snapshots the
    wyrm after the Esc frame).
  - `herolook` (831 frames): the drawn blade never enters his body (closest 2.9 cm, was ≤ 2 cm deep);
    the blade crosses a coat panel on 1 of 509 locomotion frames.
  - At the game camera facing away, his lit area matches the reference's at the same height (4357 vs
    4374 px; the broad build covered 6462); he is still brighter (mean luma 74 vs 55), mostly the
    one-pixel silhouette line, kept for legibility against the grass.

## ADR-035 — Look-dev: a solid render through the ASCII pass and a live multi-angle sheet (2026-11-09)
- **Context:** matching a turnaround needs every angle at once, the gameplay camera next to the
  close-ups, and a way to tell a geometry problem from a renderer problem. The model viewer showed one
  angle at a time, ASCII only.
- **Decision:**
  - `U.uHeroSolid` (shared uniform, hero materials only): 1 = a plain-lit clay render of the geometry,
    tinted per part, the two sub-pieces of a part shaded apart, written with alpha 0 so the ASCII pass
    passes it through untouched. The pipeline's existing `uHeroDebug` gives the art source and the ink
    lines. The model viewer's `look` ('ascii' | 'solid' | 'source' | 'lines') sets them and restores
    'ascii' on exit.
  - More angles (3/4 right, right side, both rear 3/4s), `spin` (a turntable at 36°/s) and `sheet`:
    ten live tiles (the reference sheet's six angles, the left side, the gameplay camera on his back,
    front and right side at ×2 nearest-neighbour). Each view is held two frames and read back in a new
    `lab.postRender()` hook, which main.js calls right after the frame is drawn (same task).
- **Consequences:**
  - In play the cost is one uniform test per hero fragment and an empty `postRender` call.
  - The sheet re-renders the scene from a new camera every other frame, so each tile updates at
    1/20 of the frame rate; the canvas underneath flickers, covered by the overlay.
  - Every capture in this session used it (and a headless DevTools harness that drives `__tick`).

## ADR-036 — The idle is the single-figure stance; the hero's fill is a dot matrix (2026-11-09)
- **Context:** after ADR-034 the owner judged the hero still unlike the single-figure reference "on
  terms of detail and feel" and called the sword hold awkward: the blade hung straight down his right
  side read as a stiff A-pose carrying a pole. The reference's tone is carried by a regular grid of
  tiny marks (charcoal dots, sparse bright edges), not by legible letters.
- **Decision:**
  - Idle: the reference's stance. Weight on the left leg, right leg straight out, the sword arm
    hanging beside the right hip, the blade a low diagonal across his front to a point above the
    grass at his left (`IDLE_SW`), head bowed along it. This reverses ADR-034's idle; from the 58°
    game camera the blade lies forward-left of the body, so most of it still shows from behind.
  - Fill: a 3x3 micro-font (`PIXEL_3X3`, 29 marks sorted by density) in square 4x4 px cells replaces
    the 3x5 letters; brightness is linear in the light value; the key light is cel-stepped
    (`U.uArtHeroCel`); plain ink lines stay under the bloom threshold; each part has its own
    silhouette ink (`U.uHeroPartRim`).
  - Folds are drawn, not shaded bands: `foldLines(g, fn)` writes a smooth 0..0.9 `aPart` field, the
    ink pass prints its 0.5 contour, `sub` (HERO_INK → `uArtSub`) darkens the valley side. `aPart`
    exactly 1 remains the plain second sub-piece.
  - The cape is four ribbons on the streamer springs (per-ribbon `out`); the sleeve streamers are gone.
- **Consequences:**
  - The hero no longer shows readable letters up close; the wyrm keeps its letter grid.
  - The six-panel pleated coat closes round the legs again and its fold lines are busy, most of all
    from behind: a known regression against ADR-034's "legs visible" goal, accepted as an
    intermediate state. The session was stopped before the open coat, hair, face, collar, legs,
    pauldron and sword were rebuilt (ROADMAP M1.9); the result is closer to the reference, not a match.
  - Gameplay is untouched: no bone, grip target, hit segment or timing changed.

## ADR-037 — The hero's sculpted parts are built in a headless Blender and committed as packed data (2026-11-09)
- **Context:** two rounds of matching the single-figure reference with hand-written JS geometry
  (grids of sines) stalled on the organic parts: a hair mop, a winged collar, a torn cape, layered
  plates. The owner offered Blender. Its interactive MCP link timed out, and a tool that needs a
  running GUI would not be reproducible anyway.
- **Decision:**
  - `scripts/blender/hero_parts.py` builds the parts with Blender's Python API (bmesh, mathutils),
    run headless by `scripts/blender/build-hero-parts.mjs` (`npm run hero-parts`). The body
    dimensions it fits the parts to are dumped from `model.js` (`DIM`, `BODY`, `REST`,
    `HAIR_CLUSTERS`, `CAPE_SHEETS`), so there is one source of truth for sizes.
  - The output is `src/entities/player/heroParts.js`: `HERO_PARTS[name] = { n, p, nrm, uv, k, i }`,
    base64 little-endian (positions Int16 / 8192 m, normals Int8 / 127, `aGUV` Int16 / 8192, `aPart`
    Uint8 / 200, Uint16 indices). It is generated, never edited by hand, and COMMITTED.
  - A part is geometry only, in the space of the joint it hangs on, with the same attributes as
    every hero mesh (`aGUV`, `aPart`). `model.js` (`partGeometry(key)`) chooses the joint and the
    material; the rig, the springs, the ink pass and the glyph systems are unchanged. No flat image
    or billboard: the parts are meshes on the one 3D character.
  - The cape stays four streamer records (`{ segs, len, out }`, the animator's and the tests'
    contract); each is now a wide sheet in three parts (`cape.N.a` / `.b` on the two spring
    segments, `.c` the torn zone).
- **Consequences:**
  - The game, `npm test`, `npm run build` and Vercel need no Blender; only changing a sculpted part
    does (Blender 4.2+, tested on 5.2.1). After changing a dimension the parts are fitted to, rerun
    `npm run hero-parts` or the parts no longer fit the body.
  - The bundle grows by ~210 KB (1615 KB in all). Quantisation is 0.12 mm, below anything visible.
  - Sculpted parts are not content-as-data in `tuning.js` terms: their shape parameters live in the
    Python script. Sizes shared with the rig stay in `model.js`.
  - The result is closer to the reference, not a match (DEVLOG Session 9): the coat, the face and
    the limb armour are still JS geometry.

## ADR-038 — A 1.25 m moonlit sword held in a low ready at the right side (2026-11-09)
- **Context:** the owner: "the pants fabric in the front keeps clipping through the sword ... the
  current sword is way too long and dark". ADR-036's idle laid a 1.64 m blade in a low diagonal
  across his front, between the thighs and the front coat panels: the cloth had nowhere to hang but
  through the steel. The blade's flats were dark steel up close (ADR-022 kept the glow on the seams).
- **Decision:**
  - The drawn sword is 1.25 m with the pommel (`DIM.drawnTip` 1.45 → 1.06; the owner picked this
    length). The Blender blade parts are rebuilt to it (`npm run hero-parts`).
  - Gameplay reach is untouched: the hit segment (`DIM.bladeBase → bladeTip` + `REACH.tipExt`) and
    the animator's `DIM.steelTip` keep their values; the swing crescent covers the reach past the
    steel.
  - The blade is lit blue with white-blue edges (`BLADE_BASE`, brighter inks, emissive and rest
    glow), and still self-lights with distance.
  - The idle holds it in a low ready at his right side (`IDLE_SW` forward, ~38° down, a little
    outward; the grip outside the coat), not across his front.
- **Consequences:**
  - Supersedes ADR-036's blade line and ADR-022's dark flats; the stance itself (weight, legs, free
    hand) is ADR-036's.
  - The steel is ~0.44 m shorter than the hit segment. Hits past the drawn point are sold by the
    crescent and the dot halo; if that reads as "hit by air", shorten the segment in a balance pass.
  - Checked in the idle and at the game camera; the run and attack frames were not re-audited for
    coat crossings (ROADMAP M1.7's open item stands).

## ADR-039 — Bullet hell: deflectable bullets with a guaranteed cue, in a field of their own (2026-11-09)
- **Context:** the owner wants "sekiro / phantom blade zero like clashes" and "more bullet hell
  moments that requires the player to dodge and react", at about today's difficulty. The fire
  hazards (ADR-029) are few, big, red and dodge-only; dozens of small projectiles need different
  rules, and the tell contract (one flash per blow, 0.35 s ahead) cannot ring per bullet without
  drowning the fight.
- **Decision:**
  - A second pooled field, `dragon.bullets` (`bullets.js`, 360 records), beside the hazards. Three
    kinds carry the three tells: embers (normal), homing wisps (blue), orbs (red). Embers and wisps
    can be parried one by one (the bullet flies back at the head and adds posture), blocked, rolled
    or cut with a swing; orbs are dodge-only (the owner's choice: "deflect or dodge").
  - **The cue is the contract:** a bullet may only hurt after it announced itself `flashLead`
    before impact (glint + `combat:tell` / `combat:flash` with `bullet: true`). Impacts within
    `cueGap` share a cue and one parry answers them; a bullet that cannot be announced in time is a
    dud. After a hit, a grace window; per pattern, a hit cap.
  - A bullet parry is a light clash (`hit.light`) and never interrupts the wyrm; rolling through a
    small bullet is a plain dodge (`hit.perfect === false`), so a storm is not a Ghostep farm.
  - Four patterns as ordinary attacks (`bulletAttacks.js`, data in `tuningBullets.js`): ember storm,
    cinder fan, wisp swarm, fire wheel; plus two strings (`stormFlurry`, `cinderFlurry`, the second
    ending on scattered embers) and shorter idle gaps.
  - More attacks at the same difficulty: `TUNING.damageScale` 0.85 on every `hitPlayer` blow;
    bullet numbers are final and small (8 / 13 / 20).
- **Consequences:**
  - Two new payload flags (`bullet`, `light`) and two hit-spec fields (`perfect`, `light`);
    consumers that ignore them behave as before. Audio and the HUD read `bullet` to stay quiet.
  - The fire wheel lives in `bullets.js` (it shares the cue, grace and cap rules), not in
    `hazards.js`.
  - The attack tables in COMBAT.md list data values before the damage scale.
  - Difficulty is measured, not guessed (ADR-033): see COMBAT.md "Difficulty" for the bots' runs on
    this build. A human playtest still decides.

## ADR-040 — An athletic build, and the idle blade out to his side (2026-11-09)
- **Context:** the owner: "review the main character ... make sure his animations and sword posture
  looks natural and good. right now he is a bit too lanky". ADR-034's lean build (a 0.34 m chest,
  0.07 m thighs, 7.8 heads) read as thin tubes under a small head. ADR-038's idle pointed the blade
  nearly straight ahead from a straight hanging arm: the wrist was cocked ~50°, and from the 58° game
  camera his body and cape hid the whole sword whenever he faced away (the usual fight view).
- **Decision:**
  - `BODY` / `DIM` in `model.js`: chest 0.39 m over a 0.27 m waist, shoulder joints ±0.178, hips
    ±0.105, upper arm r 0.066, forearm 0.057, thigh 0.086, boot 0.064, hands ×1.12, the head joint
    scaled 1.08 (`BODY.headScale`). Bone lengths, `DIM.gripShoulder` and so every sword-hand target
    and hit segment are unchanged.
  - `hero_parts.py`: the collar's girth follows the shell (`COL_K`), the pauldron the deltoid
    (`PAUL_K`); parts rebuilt. Coat panel tops and cape roots widened with the body; cape flare
    (`CAPE_SHEETS.out`) reduced by about a fifth.
  - Idle (`guard` in `anim.js`): `IDLE_SW` [-0.725, -0.68, 0.1] (out to his right, ~43° down), the
    elbow bent back beside the ribs so the forearm runs toward the blade's line, a shoulder-width
    stance (right foot 0.25 m out instead of 0.33, knee soft).
  - A light attack that finishes over his left shoulder comes home round the front (`HOME_WAY`):
    the short way to the new idle ran behind his head and through the sword arm's shoulder.
  - The blade's tip streak sits on the drawn point (it floated up to 0.3 m past it).
- **Consequences:**
  - Supersedes ADR-034's girth and ADR-038's idle blade line. The `herolook` test asserts the
    athletic ranges and still holds the blade within 2 cm of his body over every move.
  - Facing west or north-west at the game camera the idle blade is on his far side and still hidden;
    facing north about half of it shows past the cape.
  - Gameplay is untouched (hurt cylinder, reach, timings).

## ADR-041 — A five-hit chain with sprint and roll attacks; real hands; a slim profile (2026-11-11)
- **Context:** the owner, with a reference image (a cloaked swordsman, the sword low at his side):
  "the character right now has no right hand, the way he's holding the sword is a bit awkward ...
  his first 2 arc swings can also be improved. Add a few more animations ... instead of the same 3
  attack patterns. He looks weird when viewed from the side." Lights 1 and 2 were one flat sweep and
  its mirror; the sword hand was a 5 cm ellipsoid behind the guard; in profile the cape trailed
  0.75 m behind him and the coat skirt was a bell. The owner chose: the blade low at his side, a
  longer varied chain plus a sprint attack and a roll attack.
- **Decision:**
  - `LIGHT` is five hits: falling cut (high right → low left), rising backhand, whirl (one full
    body turn to his right with the blade held out), stab, slam. `SPRINT_ATK` (LMB while sprinting:
    a bounding slash carrying 2.4 m along the run direction) and `ROLL_ATK` (LMB out of a forward
    roll: a low rising cut) both count as hit 1.
  - Swing shapes stay data: `anim.kind 'h'` gained `loop`, `spin`, `sink` and `feet: 'dash'`; a new
    `kind 'stab'`. The whirl turns the pose's body yaw and carries the foot targets round with it,
    ending on exactly one turn written as 0.
  - Per-hit numbers keep sustained damage level: 186 damage in 2.94 s (63 /s) against 120 in 1.94 s
    (62 /s). The finisher comes two taps later.
  - Hands: `gripFist` on the `sword` joint (owned by the `arms` gear slot), `looseHand` on the left
    forearm.
  - Idle: `IDLE_SW` [-0.6, -0.79, 0.12] (~52° below level), edge down, the upper arm by the ribs.
  - Profile: the outer cape sheets turn to his right, the back sheets and the front coat panels hang
    close (`CAPE_SHEETS`, `COAT_PANELS` in `gear/wanderer.js`).
- **Consequences:**
  - Supersedes ADR-040's idle blade angle and the three-hit chain in COMBAT.md. `player:attack`'s
    `combo` now runs 1–5.
  - The REACH test covers all five hits (contact to 3.5 m). One `win` bot run took 144–154 s
    against 177 s before; too few runs to call it easier.
  - The whirl turns his back on the target for about 0.1 s; nothing in the rules punishes that yet.
  - The sprint slash does not use the step-in assist and does not turn to the aim.

## ADR-042 — The hero's outfit and weapon are gear items in equipment slots (2026-11-11)
- **Context:** the owner plans an RPG with equippable armor and weapons: "make sure the characters
  outfit can be replaced easily". `buildHero` was one 550-line function building skeleton, body,
  coat, cape, armour and sword together. The owner chose the structure only for now: no new gear,
  no inventory.
- **Decision:**
  - `player/gear/`: items `{ id, slot, name, build(ctx) }` in eight slots (head, chest, shoulders,
    arms, legs, waist, back, weapon), a registry, `DEFAULT_LOADOUT` (today's look) and the `base.*`
    undersuit for an empty chest / arms / legs slot. `model.js` keeps the skeleton and the body.
  - `buildHero(U, loadout)`; `rig.loadout`, `rig.slots`; static meshes merge only within a slot.
  - `player.equip(slot, id | null)` / `player.setLoadout(loadout)` rebuild the rig under the same
    root and recreate the animator.
  - Geometry builders moved to `heroGeo.js`, measurements to `heroDims.js`.
- **Consequences:**
  - With the default loadout the refactor was checked mesh by mesh against the old build (136 of
    136 identical) before the hand and profile changes went on top.
  - A swap restarts the pose from the ready stance and rebuilds every mesh: fine in a menu, not
    mid-fight.
  - A weapon of another length is not supported yet: the animator, the hit segment and the blade FX
    read `DIM`, not the item's `dims`. Helmets cannot hide the hair. Items carry no stats.
  - Materials are still the shared hero set; an item cannot bring its own yet.

## ADR-043 — The Shrouded set: a hooded tattered cloak is the default outfit (2026-11-11)
- **Context:** the owner sent a reference again (a hooded swordsman in a huge ragged cloak, seen
  from behind, the sword low in his right hand) and asked whether rebuilding the character would
  make the motion easier to fix and the look closer. Asked to choose, the owner picked "new outfit,
  same skeleton" over keeping the white-haired coat design or a full rebuild.
- **Decision:**
  - A new gear set, `gear/shroud.js`: `shroud.hood` (head; `hidesHair`), `shroud.tunic` (chest),
    `shroud.arms` (cloth sleeves, leather-bound forearms, bare hands), `shroud.cloak` (back: a
    mantle on the chest and `SHROUD_SHEETS`, seven ragged two-segment sheets on the streamer
    springs). Built from `heroGeo.js` sheets and shells only: no sculpted parts, no Blender step.
  - `DEFAULT_LOADOUT` is that set over `wanderer.legs`, `wanderer.skirt` and `wanderer.sword`, with
    no shoulder item. The old outfit stays selectable as `WANDERER_LOADOUT`.
  - The cloak is asymmetric: it covers his back and his LEFT side and arm (one sheet hangs on the
    left upper arm and lifts with it), and is thrown back behind the sword shoulder, so the sword
    arm and the blade are never behind cloth.
  - Streamers take `lag` (default 1). The cloak uses 0.5: about 40° of trail at a run. At 1 the big
    sheets stood out level from the shoulders.
  - `HERO_INK` far fill: coat 0.42 → 0.8, hem 0.8 → 1.1, lining 0.5 → 0.6. The cloak is most of the
    figure now; at 0.42 he was a dark blob in dark grass on a phone.
  - No new materials or ink-line part ids: the set reuses `coat`, `lining`, `hem`, `shirt`,
    `leather`, `trim`, `skin` (the part ids are full at 20 and live in a narrow alpha band).
- **Consequences:**
  - The skeleton, the animator, combat timing and the hit segment are untouched by the outfit.
  - The far-fill change also brightens the Wanderer's coat when that loadout is worn.
  - The cloak's springs have no collision: sheets can pass through the legs, the coat tails and,
    in a roll, each other. Nothing keeps them off the ground.
  - The face is still built under the hood; it shows from eye level, not from the game camera.
  - `docs/art/hero.md` describes the Wanderer's set, not this one.

## ADR-044 — The sword arm folds, leads and never locks (2026-11-11)
- **Context:** the owner: "the hand motion and animation looks very unnatural", for standing,
  running, attacks and the defensive moves alike. Measured over the five-hit chain (elbow bend and
  the angle between the forearm and the blade, every frame): the sword arm reached 4° of bend, a
  straight stick, in the falling cut, the rising cut, the whirl and the stab, and the forearm-to-
  blade angle stayed within 24–40° through the whole rising cut and the whole whirl. Cause: `slashH` put the hand on a 0.42 m
  circle round the shoulder, at or past the arm's 0.55 m reach once the forward offset was added,
  with the blade exactly radial to it. In light 1's windup the free arm was also sent out straight,
  so both arms stood out from the body.
- **Decision:**
  - `slashH(p, A, th, elev, lunge, ext, lead)`: `ext` (0 folded … 1 open) sets the hand's radius
    (0.23–0.42 m) and height, and moves the elbow pole out and back when the arm is cocked; `lead`
    (rad) puts the hand ahead of the blade round the body. `attackPose` drives them from `SWING`
    (`SWING_SPIN` for the whirl): cocked in the coil, the fist leading into the cut while the arm
    opens, the blade passing the fist while the arm folds in the finish.
  - The blade's direction is still `th` / `elev`, so the arc the hit test sweeps is the one in the
    attack data; only the grip point moves.
  - `_arm` compresses the last fifth of the reach (`ARM_SOFT` 0.78–0.955 of the arm's length), for
    both arms and every pose. The off hand gets its full reach back as `twoHand` rises, so two hands
    still meet on the grip.
  - Light 1's free hand: a bent guard before the chest, then drawn back beside the hip.
  - Run: the sword hand rides 4 cm higher and swings 9 cm with the stride.
- **Consequences:**
  - Sword-arm bend over the chain: 46–146° (was 4–146°). The `HERO` test asserts both elbows keep
    more than 23° through the run, the roll and every attack (measured: 40° and 46°).
  - The grip sits up to ~5 cm nearer the shoulder at a full stretch. REACH still passes for all five
    hits; damage per second was not re-measured.
  - The slam's apex: the hands used to stop straight overhead with the blade hanging down the
    back, 147° between forearm and steel. They now go on to behind the head on a tighter circle
    (`SLAM_BACK`), and lead the blade on the way down (`SLAM_LEAD`): 99° at the apex. A 145° peak
    remains for about three frames in the windup, between the gather and the raise.
  - Idle, block, heal, roll and the thrust were looked at with the new arms and left as they were,
    apart from the soft reach.

## ADR-045 — Rigid batching: one draw per material per actor (2026-11-11)
- **Context:** the owner: the game "seem[s] to have slowed down" on an iPhone 15 / 16 / 17 Pro,
  all the time, not only in the fight. Measured: about 510 draw calls a frame in the fight on the
  phone preset (575 in a 1024 x 768 window), the hero 138 meshes and the wyrm 183, nearly all drawn
  twice (shadow pass + world pass). GPU timer
  queries on a desktop showed the hero or the wyrm alone costs the same into a 4 x 4 target as at
  full size: per-draw overhead, not fill. Grass, forest and the fullscreen ASCII pass were small
  next to it. Not measured on a phone.
- **Decision:**
  - `render/rigidBatch.js`: a shared RGBA32F bone texture (`U.uBoneTex`); `batchRigid(U, root)`
    merges an actor's surface-glyph meshes per material into one mesh with a per-vertex `aRigid`
    slot, plus one positions-only shadow mesh per actor on `LAYER_CASTER_RIGID`.
  - Every source mesh is its own bone and stays in the scene graph (hidden from the cameras by its
    layers), so per-mesh transforms, `visible` flags, the tests, the Lab and the FX that read
    joints keep working with no list of what is static. A hidden mesh writes a zero matrix.
  - One shader program per material for batched and unbatched meshes: slot 0 means "use
    modelMatrix". No material cloning (the shared uniform objects must stay shared).
  - `pipeline.render()` updates the scene's matrices once, syncs the bones, and renders both scene
    passes without three walking the graph again.
  - `CONFIG.render.batch` (`?nobatch` in the URL turns it off) for an A/B on a device.
  - Quality presets carry a shadow map size: LOW 1024, MEDIUM and HIGH 2048.
- **Alternatives:** `THREE.BatchedMesh` (needs `WEBGL_multi_draw` for a single draw; its fallback is
  one draw per part); merging the materials themselves (a larger change to the hero's ink-line
  look); shadow proxies only (leaves the world pass as it was).
- **Consequences:**
  - Draw calls per frame at 852 x 393, LOW, the Shrouded set: title 432 → 55, fight 509 → 56.
  - Batched parts are not frustum-culled one by one, and draw order within a material is build
    order. A pixel can differ from the unbatched picture where a shadow depth sits at the bias
    threshold (float32 on the GPU).
  - Baked at build time: each part's geometry, material and mirroring. A mesh added to an actor
    after `batchRigid` draws unbatched. The hero's rig rebuild disposes and rebuilds its batches.
  - Raycasts do not see the hidden source meshes. Nothing raycasts actors today.
  - World matrices must be final before `pipeline.render()`.
  - Whether this restores the frame rate on the owner's iPhone is not known until it is tried
    there.

## ADR-046 — Both hands on every swing; a raised two-handed guard (2026-11-12)
- **Context:** the owner: "make the character use both hands when he's swinging. it looks awkward
  when he's just using 1 hand", and "when he guards, make him hold the sword up in a higher angle".
  Asked, the owner chose both hands on every swing with the one-handed low carry kept at rest, and a
  two-handed guard with the blade raised across the body. Until now only the slam, the charge and the
  thrust were two-handed.
- **Decision:**
  - The light sweeps (all five chain hits, the sprint slash, the roll cut) and the stab set
    `twoHand` 1. The cross-fade brings the off hand onto the grip during the windup; the recovery's
    blend home lets it go.
  - `slashH(…, two)`: with two hands the grip travels round the chest's centre line in front of it
    (`TWO_R` 0.17–0.3 m across, at least `TWO_Z[0]` 0.13 m in front), a little higher, elbows down
    and out. A chest turned far left pulled the left shoulder out of reach of a grip at the left hip
    (the left arm locked straight, up to 8 cm short): the left turn is now 0.14 of the blade's
    azimuth instead of 0.36. The blade's own direction is unchanged, so the hit arcs are the data's.
  - The off hand sits `DIM.offGrip` 0.08 m below the sword hand (fist against fist; was 0.11).
  - `rig.offHand { open, grip }`: the Shrouded arms build the free hand twice and the animator shows
    the closed one on the grip while `twoHand` > 0.6.
  - The block: grip before the chest, blade ~50° up across the body, flat to the enemy, both hands.
- **Consequences:**
  - The off hand reaches the grip within 2.5 cm in every swing (the HEROLIFE test: 3.5 cm).
  - REACH passes at every distance for all five hits; one bot `win` run took 139 s (144–154 s
    before), so the swings did not get worse at landing. Damage numbers are unchanged.
  - In the two-handed stab and the slam the left arm still straightens fully at the end of its reach.
  - The parry flicks inherit the two-handed block.

## ADR-047 — Idle life: random actions while standing still (2026-11-12)
- **Context:** the owner: "add some idle animations of the character doing random stuff while not
  moving to make it look like the character is alive instead of him just being static". Chose all
  four kinds offered: look around / stretch, inspect the blade, twirl it, rest it.
- **Decision:** six layered actions in `anim.js` (`FIDGETS`: look, stretch, inspect, twirl,
  shoulder, lean), started by `HeroAnimator._idleLife` after 2.5 s standing still and 2–4.5 s after
  the last one, picked with the animator's own noise, never the same twice in a row; cut within
  0.16 s by any move, lock-on, guard or other clip. Not while locked on.
- **Consequences:**
  - Purely visual; no gameplay state reads it. The game's `Math.random` stream is untouched (the
    integration sims seed it).
  - In 25 s of standing still the test saw 4 actions, 3 different.
  - The twirl's blade passes behind his right side through the cloak's region for about 0.3 s.

## ADR-048 — Cloak sheets keep out of the blade and the arms (2026-11-12)
- **Context:** the owner: "when he's charging the sword, the sword and arm are clipping through the
  cape". Measured with a probe (blade and arm points within 3–4 cm of a sheet's surface): the blade
  was inside a cloak sheet in 94 of 150 charge frames and the sword arm in nearly all of them; the
  streamer springs had no collision at all.
- **Decision:**
  - Four spheres along the blade every frame (`_colliders`). Each streamer segment records which
    side of it each sphere came in from (`streamState[i].side`) and is bounded to stay on that side
    by the sphere's radius (`_sheetBound`): from the body side the sphere holds the cloth out, from
    outside it holds it in; the inside wins a conflict. The bound limits both the spring's target and
    its state.
  - Streamer records gain `w` (widths) and `arm` (the arm a sheet hangs on, which it ignores if arm
    spheres are ever used).
  - The charge pose: hands before the right hip (were 0.28 m behind it), the blade out to his right
    and low, past the cloak's edge; the off arm unchanged.
  - The arms are NOT colliders, and the charge does not lift the cloak. A first version had spheres on
    both arms, rooted the sheet behind the sword shoulder on the shoulder blade, and lifted the sheets
    in the charge's updraft: the owner found the back cape "too floaty" and him "wider from the back
    view" ("make it look similar to the original look"). Holding the sheets out round the arms at rest
    and on the move did that; it was reverted.
- **Consequences:**
  - Held charge: the blade within 2 cm of a cloak sheet in 0 of 96 frames (the HEROLIFE test).
  - Against the original cloak (main before this work, measured at the hems over 60 idle / 90 run
    frames): idle 1.29 m across (1.23 m), run 1.15 m (1.15 m). The 5 cm at rest is the short sheet
    behind the sword shoulder draped over the resting blade instead of passing through it.
  - The arms pass through the cloak where they did before (at the sheets' roots in the charge).
  - From straight behind, the cloak drapes over the blade's first half in the charge; its outer part
    shows past the cloak's right edge.
  - The coat panels keep their own steel rules (`_coat`); hair has no collision.

## ADR-049 — Gold hair under a pushed-back hood (2026-11-12)
- **Context:** the owner liked the hood but "the front details and visuals makes him look like
  death. have his hair show a bit and make his hair colored gold to stand out. also his hood is too
  pointy at the top". Chose "hood back a little" with the fringe and strands showing.
- **Decision:**
  - The hood's rings: a rounded crown with a short soft peak; the rim runs behind the hairline and the
    opening is wider.
  - A head item lists the hair pieces kept under it (`hair: ['cap', 'fringe']` for the hood); the
    side, crown and nape clusters poked through the cloth. The hood builds two gold locks per cheek.
  - The hair is gold for the body (both loadouts): warm gold letters, brighter tips, lines under the
    bloom threshold. The face is warmer and less pale (skin fill gain 3.0 → 2.2), the eyes smaller and
    brown instead of large dark violet-rimmed almonds.
- **Consequences:** the Wanderer's set is gold-haired too. The face is still the same mesh.
## ADR-050 — Every bullet is breathed from the jaws along the head's aim (2026-11-11)
- **Context:** the owner: the bullet hell should look natural, "no fire spawning out of nowhere".
  ADR-039's patterns spawned embers on a ring round the body (the storm), off the wing beats (the
  fan) and as walls under the belly (the wheel). Spec `docs/specs/wyrm-breath-armageddon.md`
  (approved: "redesign as breath", no bullets from the body ring or the wings).
- **Decision:**
  - One helper, `spit()` in `bulletAttacks.js`: a bullet spawns at `rig.pt.mouth` and flies along
    the head's ACTUAL yaw (`pt.headFwd`) plus an offset. Patterns emit from their `hit()` hook,
    which runs after the rig, so the bullet leaves the jaws as they are drawn this frame. The pose
    aims the head first (`aimHead`: reach out of the neck base, `headExact`, a look down the line);
    the emission follows where the head really points, never an ideal angle it has not reached.
  - A bullet leaves at mouth height and reaches hit height over a drop scaled to the
    mouth-to-hero distance; the head draws in over a close hero (`reachFor`), so he is not flown
    over. The emission-schedule pre-cues are measured from the mouth.
  - Pattern shapes follow from what a head can do: the Ember torrent (a swept stream, a forked
    tongue, orbs coughed at the extremes, a P3 pirouette), the Cinder burst (coughed cones, P3
    double taps), the Wisp swarm (unchanged origin, denser) and the Scouring breath (tongues of
    fire at fixed offsets off the head's aim, rooted at the mouth's ground projection, swept by
    the body turn). The wheel takes head-relative tongues (`offs`, `aimWheel`) and its cue steps
    the turning wheel forward (its root orbits with the mouth).
  - "Hard" intensity numbers (tuningBullets.js); bullet damage unchanged.
- **Alternatives:** keep the old shapes and only move the spawn points to the mouth (a spiral
  round the body cannot come out of a head that faces one way); emit along the ideal angle and
  snap the head to it (the head lags its target, so bullets would leave sideways out of the jaw).
- **Consequences:**
  - `npm test` → BULLETS checks every bullet is born within 0.6 m of `pt.mouth` and every emission
    leaves within 0.2 rad of `headFwd` (measured: 0.00 m, centre ≤ 0.10 rad: the half-spacing
    offset of a gap cough). Wisps are roared out in a spray and only checked for the origin.
  - Gaps in the denser cones are wider than the hero only at range (spacing x distance > 2 R:
    ~14 m from the mouth in P2): close in, every cough must be parried.
  - Nothing is behind the wyrm except in the P3 pirouette and the Scouring breath's sweep.
  - The mouth reaches ~8 m ahead of the root: tests and AI distances measured from the root are
    ~8 m shorter from the jaws.

## ADR-051 — A perfect parry returns a bullet as a damaging shot (2026-11-11)
- **Context:** the owner wants a perfect parry to send the fire back. Today a parry only deflects
  a bullet for posture (ADR-039).
- **Decision:**
  - `DEFENSE.perfectParryWindow` 0.08 s (inside the 0.22 s parry window). The player computes the
    flag for every parry, stores it on `deflect.perfect` and adds it to `player:parry`; only bullets
    consume it (melee perfect parries are out of scope).
  - On `RESULT.PARRIED` the bullet field reads the flag: a perfectly parried ember or wisp is
    returned (34 m/s, drawn 1.8x, white-gold with an orange trail) and on reaching the head deals
    the kind's `returnDamage` (ember 30 = a light hit, wisp 70 = a heavy hit) through
    `dragon.takeHit` (exact damage, part head: the phase gate and death behave as for a sword hit)
    with `returnPosture` (14 / 30) instead of the deflect posture. It never interrupts the action
    and never counts in a string's DEFLECT xN. `dragon:parried.perfect`, `dragon:returned`.
  - Feedback: RETURN call-out, a gold burst on the blade, a 0.05 s hit-stop, a brighter clang.
  - A return budget per pattern (`TUNING.bullets.returnBudget` 120 HP, ~8 % of a phase's 1500 HP,
    the spec's target): past it a perfect parry is a plain deflect. The spec's per-shot numbers on
    their own let a perfect parrier return all 13 P3 wisps at 70 (~910 HP a swarm, ~3x the sword's
    damage rate).
- **Alternatives:** a bigger posture hit only (no HP damage: not what was asked); returning the
  whole popped clump (would turn one parry into a screen-clearing nuke).
- **Consequences:**
  - The scripted defenders press 0.12 s before impact, outside the window: the bot runs and their
    numbers are unaffected by returns. A human who hits the window can chip HP off with every
    torrent crossing: one return per parry (the clump it pops does not return).
  - A posture break from accumulated returns is allowed and fizzles the field (returns in flight
    included).

## ADR-052 — Ground warnings are the ground heating up (2026-11-11)
- **Context:** the owner: the red ground indicators break immersion ("the pound circle"). Every
  ground warning drew rotating rings of red `•` and `!`, `>` chevrons and a closing inner ring:
  UI painted on the world.
- **Decision:** one diegetic look for every footprint (meteors, pillars, shells, the nova, melee
  slam zones, the burning pass, the flame ring and wall, the Scouring breath's windup):
  `fx.heatDisc` / `fx.heatBand` draw a sparse, stable fill of small ground glyphs (`. , : '`,
  positions hashed per warning, a slow flicker, nothing rotating or marching), coloured by heat
  (dark ember → orange → white-orange as the impact nears), denser and brighter with k, sparks from
  k 0.6; the scorch map's heat channel is stamped under it (no char), so the soil and grass glyphs
  glow. The true edge (a thin bright `·` rim) shows only in the last `flashLead` s. The timing
  flash on the ground is a heat flare (`heatFlare`). No tell red on the ground; the attacker's own
  red glow and flash, the audio and `combat:tell` / `combat:flash` are unchanged.
- **Alternatives:** dimming the red rings (still UI); scorch heat alone (too soft to read at k 0.3).
- **Consequences:**
  - Readability rests on warm-on-dark contrast instead of a red outline: at k 0.2 the footprint is a
    faint warm patch, by k 0.6 an orange field, and the edge is exact when it matters. A human
    readability check is still owed (bots read events, not pixels).
  - Heat stamps decay over ~1.5 s, so a dodged or interrupted warning cools visibly instead of
    vanishing; a little char (burn) builds where heat passes 0.4.
  - The flame ring's outer reach ring and the strip / wall chevrons are gone: the lit fire shows
    the way.

## ADR-053 — Armageddon replaces the Meteor rain (2026-11-11)
- **Context:** the owner asked for a headline set-piece: the dragon fires meteors into the sky that
  crash down across the arena. The Meteor rain dropped 8–14 meteors round the hero without a cast
  anyone could see.
- **Decision:** the attack keeps its key `meteorRain` (audio, Lab, tests, hazard kinds) and becomes
  Armageddon (P2+): a 1.4 s rear-up (the body glows red through `dragon.bodyWarn`, the throat
  white-hot), a 1.6 s salvo of 12 / 16 bolts out of the jaws into the sky (visual, `fx.launchBolt`;
  `dragon:hazard` stage `launch`), the sky answering (`world.atmosphere.skyGlow`, stage `sky`, a
  rumble) while the wyrm drops to all fours and fights on, then a new hazard emitter
  `hazards.barrage`: 3 x 8 (P2) / 4 x 10 (P3) meteors in waves 1.6 s apart, falling on a slant
  from above the wyrm onto the whole clearing (`placeWave`: jittered-stratified; within 12 m of the
  hero a wave covers ≤ 45 % of the ground and no two footprints overlap by more than a third; every
  3rd led onto the hero via `leadInto`, never two led impacts within 0.5 s), P3 craters burning
  2 s (contact ticks), and 1.2 s after the last wave one great meteor (r 7, 34 damage) on the hero.
- **Alternatives:** keep the rain and add a cast animation (not a set-piece); real missile hazards
  for the salvo (they deal nothing: visual only keeps the fairness rules simple).
- **Consequences:**
  - The salvo deals nothing: the windup + salvo (~3 s) is a punish window.
  - The hazard pool is 64 (was 48); the barrage keeps ~10 meteors in the air plus up to two waves of
    craters. Most meteors get no light of their own.
  - A hero who stands in a P3 crater takes 4-damage ticks every 0.25 s (blockable, never while
    rolling): the scripted defender, which never steps out, took 31 ticks over one P3 Armageddon.
    A human who walks out takes a couple. Watch this in the playtest.
  - The timing check pairs each blow with the flash at its own centre (impacts 0.12 s apart).

## ADR-054 — Techniques: a Qi meter, two slots, the Ash Riposte as the first reward (2026-11-12)
- **Context:** ADR-059 made rewards fixed: each boss teaches something that changes how the hero
  fights. The Ash Disciple shipped without his (the owner chose "fight first, reward next PR"). Four
  owner answers (2026-11-12): a technique fires on a **button paid from a meter** that parries and
  perfect dodges fill (not an automatic trigger after a deflect chain); his technique is a **counter
  stance**, the Ash Riposte; **two slots on two keys** (Q / R); on the phone the button sits **above
  BLOCK**.
- **Decision:**
  - A technique is data (`player/techniques/<id>.js`: timings, damage, posture, cost) with a `kind`
    that player.js runs; the registry is `techniques/index.js`. The first kind is `counter`.
  - **The Qi meter** (`player.qi`, max 100): parries 20 (blue 30, +5 per parry in a deflect chain,
    at most +15), a deflected bullet 3, a perfect dodge 40, a strike that deals damage 3 (heavy 6).
    A technique spends its cost as it starts (the Ash Riposte: a full meter). Death and retries
    empty it; the bonfire keeps it. Defence fills it, so the reward pays out for the skill the boss
    tested.
  - **Two slots** on Q / R, one meter for both. The book (`player.techniques`) holds what is
    learned and equipped; the first time a technique is learned it goes into the first empty slot.
    A level's `reward: { technique }` is learned on `game:victory`.
  - **The Ash Riposte**: a 0.8 s stance (the disciple's own jian guard on the hero). A normal or blue
    blow from its 150° front cone is turned (the attacker is parried, so its own deflect / recoil
    rules apply) and answered by a counter-thrust: 140 damage, 80 posture, `pierce` (through a
    duelist's guard; he staggers), i-frames 0.45 s so a string's next blow passes, and an assist so
    a turned blow's counter cannot whiff on a target in reach. Thrown blows (bullets, sword qi) and
    attackers farther than 6 m are only turned and the stance holds. Red blows land: the dodge stays
    the only answer to red. Nothing comes: a plain 70-damage lunge. A roll may cancel it after
    0.15 s (the Qi stays spent).
  - **The save** (`game/save.js`): one localStorage record (`abyss.save.v1`), sections merged on
    write, guarded so blocked storage keeps the state in memory and never throws. The first M2
    "save / load" piece; settings and cleared bosses can join the record later.
  - The UI: a Qi row in the player frame (hidden until something is equipped), a reward card after
    the victory, an equip panel from the pause menu (a tap cycles a slot), touch buttons per filled
    slot with an ASCII meter.
- **Alternatives:** an automatic trigger after a 3-deflect chain (no button: nothing to equip or
  choose, and it fires when the player did not want it); a meter that decays (punishes waiting for
  the right blow, which is the skill); a counter that also turns red blows (it would replace the
  perfect dodge); one slot (simpler on the phone, but the second boss's reward would force a rework).
- **Consequences:** the hero's `takeHit` gains a step (d0) before the parry; the boss slot's
  `takeHit` may receive `posture`, `pierce` and `technique`; five new events. Balance is unmeasured
  against a human: the bots in `npm test` check the mechanics, not how often a player fills the
  meter. If parries alone fill it too slowly or too fast, the numbers are in `QI`.

## ADR-055 — Attack variants: each light hit has 2–3 looks, picked at random (2026-11-12)
- **Context:** the owner: "something about his left clicks is meh to me so lets try to make his
  attack animations and motions cooler and natural looking. i also dont want him to show the same
  pattern over and over so make it have a few variations." Asked, the owner chose "fast and
  flowing" and "random variants per hit", with damage and timing per hit unchanged.
- **Decision:**
  - `LIGHT[i].variants` in `combat.js`: more `anim` blocks for the same hit. 1: low draw cut, leaping
    cut; 2: level backhand, falling backhand; 3: rising whirl, skipping cross-cut; 4: low rising stab;
    5: leaping slam. Each starts where the previous hit's finish leaves the blade (right / left
    alternation kept) so the chain flows whichever variants come up.
  - The animator picks at `play('attack')` with its own noise (never the game's RNG, which the sims
    seed), never the same variant twice in a row for one hit. `forceVariant` pins it for tests.
  - New swing options: `turn` (a partial pivot), `hop` (a skip); `stab` `rise` / `low`; `slam`
    `hop`. Every light sweep without a spin also gets `FLOW` (hips lead, chest trails, weight
    crosses, a dip and a lean into the strike).
  - The pivot starts at mid-strike: turning the body while the blade is hit-tested moved where it
    crossed his front, and three variants fell short at 3.5 m.
- **Consequences:**
  - The REACH test now swings every variant at contact, 2 m and 3.5 m (24 trials, no miss); its
    original table pins `anim` (variant 0).
  - Timing, damage, posture, reach and lunge are the hit's whatever the look; the blade is still the
    hit test, so a variant's arc is gameplay too.
  - The sprint slash, the roll cut and the thrust have one look each.
  - At mid-strike the variants look alike (each blade crosses his front then); they differ in the
    coil, the finish and the footwork.

## ADR-056 — The face in the hood's shadow; gold strands out of the hood (2026-11-12)
- **Context:** the owner: "i can't tell the yellow color in front of his face is his hair. since the
  ascii art and zoom distance will never show the character's actual eyes, nose, and face, we can
  not worry about that." Chose "locks out of the hood", not too long, and asked for three previews
  before any of it was finished; picked "A" of three (spiky fringe + cheek locks; parted framing
  locks; short wild spikes).
- **Decision:**
  - A head item may set `shadowsFace`: the face, ears and neck take the shirt's near-black and the
    eyes are not built. The hood sets it.
  - The hood keeps only the scalp cap of the body's hair and builds `HOOD_HAIR`: four spiky fringe
    strands over the brow, chin-length locks at each cheek, one short strand a side onto the
    collarbone; neighbouring strands alternate the ink sub-id so a line separates them; roots in
    the darker gold, tips in the bright gold.
- **Consequences:** the gold reads as hair against a dark face up close; at the phone's game camera
  every style was only a few gold letters. The Wanderer's set (no hood) keeps its face and hair.

## ADR-057 — A fuller cloak: depth in profile (2026-11-12)
- **Context:** the owner: "the side angle/view also seems like the character is way too skinny and
  doesnt seem to have much depth. add a little bit more." Chose "fuller cloak" (not a deeper body,
  gear on the back or a front drape). The previous round had made the cape too floaty and wide from
  behind, so the width had to stay.
- **Decision:** the three back sheets of `SHROUD_SHEETS` hang from further back (z −0.16 / −0.14,
  were −0.128 / −0.108) and stand off his back more (`out` 0.42 / 0.45, were 0.16 / 0.3); their pull
  points straight back. The mantle is deeper front to back (rz up to 0.2, the extra behind).
- **Consequences:** measured at the hems over 60 idle / 90 run frames: depth behind 0.55 m at rest
  (0.44 on `main`), 0.89 m running (0.81); width 1.28 m at rest, 1.17 m running (1.23 / 1.15 on
  `main`).
## ADR-058 — Levels: one per page load, the boss slot keeps its name (2026-11-11)
- **Context:** the owner wants the Ash Disciple as "a separate level" that can be loaded on its own to
  test it. Everything was built for one zone and one boss: `World` built the forest, main.js built the
  `Dragon`, and fourteen modules read `game.dragon` and listen for `dragon:*` events. Another session
  is changing the wyrm (breath bullets, Armageddon) in parallel.
- **Decision:**
  - `src/levels/index.js` registers level definitions (`id`, `name`, `world` overrides, `buildSet`,
    `createBoss`, the flow's `text`). `?level=<id>` picks one at boot; `applyLevel` merges its world
    layout into `CONFIG.world` before any module is built. Switching level reloads the page: nothing
    has to be torn down. The title screen has a stage picker and the Lab a LEVEL row.
  - **The boss slot:** `game.dragon` stays the name of the current boss and `game.boss` is the same
    object; a level's boss emits the same `dragon:*` events. A boss offers the Dragon contract's
    surface; a duelist (`kind: 'duelist'`) has no plunge and offers `onExecute` instead.
  - Wyrm-specific text moved into the level (flow banners and lore lines, the minimap's zone, the
    combat log's names, the name tag); audio gates creature vocals on the boss's `kind`.
- **Alternatives:** renaming `game.dragon` / `dragon:*` to `game.boss` / `boss:*` now (cleaner, but ~14
  files and a guaranteed collision with the parallel wyrm work; it stays a refactor of its own);
  switching levels at runtime (needs disposal of the world, the boss and the batches); a second HTML
  page per level (two builds, two deployments).

## ADR-059 — Direction: a skill boss rush with fixed rewards (2026-11-11)
- **Context:** the owner: "kinda like phantom blade zero wuxia combat, boss rush, with some exploring
  and rpg elements"; both the wuxia combat and the fiction; "fixed rewards as i want this to be more
  of a skill boss rush game. i do want loot to add cool elements, skills, or abilities to the player
  to give the player the ability to customize and change their combat style."
- **Decision:** the game becomes a series of boss duels, each testing one skill, reached from a
  bonfire through short approaches. Progression is fixed: each boss gives a set reward (a technique,
  a weapon, an ability or an element) that changes how the hero fights; no XP levels, no random loot
  tables. Bosses are wuxia figures (sect disciples, wandering swordsmen) with the Cinder Wyrm as the
  spectacle fight. Each boss gets moves of its own, not the hero's mirrored (owner, about the Ash
  Disciple). The first reward and the technique system come in the PR after the Ash Disciple.
- **Consequences:** ROADMAP M2 (character stats, levels, XP, random rarity) is replaced by techniques
  and fixed rewards; the online milestone is unchanged but not next.

## ADR-060 — The Ash Disciple: a duelist on the hero's skeleton, his moves as keyframe data (2026-11-11)
- **Context:** the first human boss. A swordsman needs the hero's quality of animation (cloth, gait,
  two-bone IK, the ink-line look), but the owner asked that his moves not mirror the hero's.
- **Decision:**
  - He is `buildHero(U, ASH_LOADOUT)` with his own gear items (a douli hat, a robe and skirt on the
    coat springs, a bracer and a bell sleeve, wrapped trousers, a jian with a tassel on a streamer
    spring), recoloured on his own material instances.
  - `HeroAnimator(rig, pilot, poses)`: the animator takes an optional per-instance pose table (merged
    over the hero's; the hero passes none and is unchanged). He brings `loco` (his jian guard on the
    hero's gait and foot planner) and `duel` (a keyframe clip).
  - Every move and reaction is data (moves.js): beats with a tell, a windup (with an optional bait
    hold), active frames, a hit zone, root motion and pose keys in beat-relative marks; `realise()`
    turns a move into absolute times and a compiled clip. The blade is keyed as [azimuth, elevation]
    so swings are arcs and over-the-top chops pass through vertical.
  - Hits are zones (sector, line, ring) tested from his root through the active frames, so contact
    lands on the cue: every move within 17 ms of its flash + lead in the TIMING test.
- **Alternatives:** a new rig and animator for him (months of work to reach the hero's quality);
  mirroring the hero's attacks (rejected by the owner); hit-testing his blade's swept segment like the
  hero's (exact to the pose, but contact times then drift with every pose edit).

## ADR-061 — The duelist's rules: a guard that counters, feints that never glint, the execution thrust (2026-11-11)
- **Context:** the owner chose "Guards and counters": he deflects strikes into his front, they build
  his posture, and after a few he counterattacks. A fencing bot then showed where a guard leaks.
- **Decision:**
  - His guard covers ±75° of his facing in footwork (after a 0.18 s raise delay at the end of a move,
    a stagger or a recoil; at once after a clash or a flinch) and through the first 55 % of each
    windup. A guarded strike deals nothing, adds guard posture (8 light / 20 heavy) and clashes
    (`dragon:guard`, "GUARDED"); in footwork each one makes a counter likelier (0, 35, 70, 100 %): the
    Riposte. A heavy strike with posture 48 or more (a charged thrust from ~90 % charge) crushes the
    guard: it lands and he staggers. The chain's slam (40) does not.
  - **Feints never glint:** a feint has no tell and no flash; only real impacts are cued.
  - A perfect dodge against him is the Ghostep behind him (no plunge), and his back is never guarded.
    The attacker may set the Ghostep's distance (`ghostepBehind`; player.js): his is 1.5 m, since the
    wyrm's 3.2 m left the hero out of sword reach of a man's back.
  - **Execution:** a broken duelist within `execRange` (3.2 m) is executed by a lunging full thrust
    whose first active frame calls `onExecute`; the break is spent. While broken, hits crit ×1.5 (the
    wyrm's 2.2: here the execution is the reward).
  - Openings: his recoveries, the recoil after his last hit is parried, the Ghostep, the break.
- **Tuned on bots** (`npm test` → DUEL WIN; `node tests/integration/duel.mjs . probe`): his blows ×
  1.35 so that a bot reading 70 % of the tells is on the edge. Measured: a god-mode bot that answers
  every tell wins in 50–54 s (three seeds); mortal bots reading 85 % win in 54 s (1 hit taken), 70 %
  win in 70–75 s with 1 and 0 flasks left, 60 % die with him at 10 %. Easier than the wyrm (where 85 %
  is on the edge), as the first boss should be. No human has played it.
- **Alternatives:** no guard (the owner's other option); a guard that holds through whole windups (the
  fencer then never trades, and nothing teaches the commit point); hits during his windups
  interrupting them (makes mashing the answer).
