# Architecture Decision Records

Short records of significant decisions. Append new ones; don't rewrite history — supersede instead.
Template: **Context** (why decide) · **Decision** · **Consequences**.

## ADR-001 — Browser + Three.js, plain ES modules, no framework (2026-11-01)
- **Context:** fastest iteration on a custom rendering style.
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
- **Decision:** public repo `eshin087/gcd`; Vercel project `thegcd` builds `npm run build`
  and serves `dist/` at thegcd.vercel.app; every push to `main` deploys, PRs get previews.
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
    `GCD_SKILL`; reseed with `GCD_SEED`) for danger, at several skills.
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

## ADR-062 — The duel's moments: the full deflect, the blade lock, the mikiri, the cinematic (2026-11-12)
- **Context:** the owner wanted Shen Hui to give "sekiro/phantom blade zero parries opportunities for
  epic combat and moments", and picked all four offered: long deflect strings, a blade lock, perilous
  counters and cinematic finishers, at a relentless, PBZ-fast pace.
- **Decision:**
  - **Moments are data on a move's beats**, read by the duelist (`moves.js`): `lock: true` (a perfect
    parry of it crosses the blades), `mikiri: true` (a perilous red thrust: `hitPlayer` passes
    `mikiri`, its flash `perilous`); the full deflect is a rule on any string of ≥ 5 hits. The numbers
    live in `tuning.js` (`fullDeflect`, `lock`, `mikiri`, `cinematic`, `chain`, `idleGap`).
  - **The hero owns the inputs, the attacker owns the outcome.** `player.startBladeLock(att, L)` runs
    the mash (a meter, a prompt, `player:lock`) and calls `att.onLockEnd(won)`; `player.takeHit` checks
    `hit.mikiri` against a roll into the blade (the roll's direction against the attacker's facing:
    his blade's line, since a dashing thrust is often alongside at the impact) and calls
    `att.onMikiri()`. The wyrm offers neither and is untouched; any later duelist reuses both.
  - **A blade lock needs a perfect parry** (0.08 s), not any parry, so it stays a moment and not a
    tax on every heavy blow. Time-out is not a loss when the hero held his ground (≥ 0.6): pressing
    steadily is enough, pressing nothing loses.
  - **`flow.cinematic`** is the one place that slows time and pulls the camera in for a moment, and
    its slow motion is the flow's own time scale, not a hitstop (the hitstop min-merges its scale, so
    the parry's 0.04 freeze stretched over the moment). The camera uses `cameraRig.cine`, an
    additive pull-in that never fights the boss framing.
  - **The pace:** short idle gaps and a chance to chain one move into the next; the tell rules still
    hold for every chained move (first windup ≥ 0.7 s, hits ≥ 0.45 s apart: the DATA test).
  - **His look (owner pick C of three rendered sheets):** a small hat, a long slender jian, a high
    guard (the sword hand by the temple, the blade slanting down at the hero).
- **Tuned on bots:** the god-mode fencer wins in 52–61 s; mortal bots reading 85 % of the tells win
  (3 of 3), 70 % die (3 of 3), 60 % die (2 of 3). The bots use neither the lock nor the mikiri.
- **Alternatives:** a lock on any parry of a heavy blow (too frequent; it would slow the PBZ pace it
  is meant to punctuate); mikiri as a separate button (the roll the player already has, read by
  direction, keeps the controls as they are and works on touch); the slow motion through `hitstop`
  (the bug above); a scripted camera orbit for each moment (more to tune, and it fights the boss
  framing on a phone).

## ADR-063 — PBZ speed, pressure that reaches, and impact you can feel (2026-11-12)
- **Context:** after playing Shen Hui the owner found "his animation, motions, and weapon stance and
  attacks look bad", his attacks slow, and his AI "stupid": it attacked when it could not reach the
  hero, and the hero could kite him. They asked for an epic fast duel with sword clashes and
  parry / dodge moments, an "epic and impactful" parry, and "more impactful hit stun" both ways.
  Answers: PBZ-boss speed; your hits jolt him but interrupt only footwork and recovery; the parry
  "everything, layered"; he sprints in and punishes a flask. Stance: "A", the classic jian guard.
- **Decision:**
  - **The hand follows the blade.** His clips may drive the sword arm from the blade's direction
    (`arm` / `ext` / `lead`, poses.js), as the hero's swings do; a cut is authored as the blade's
    path through the hero (moves.js `slashKeys`: gather, cock, a ~0.1 s snap, follow-through) and the
    hips, chest and front foot go with it. Keyed hands stay for two-handed and special poses.
  - **Speed with the cue intact:** openers 0.46–0.6 s, a string's hits ~0.34 s apart; the flash lead
    drops to 0.3 s and the minimum impact gap to 0.32 s so every flash still comes after the hit
    before it (the DATA test checks it per phase).
  - **No blow at air:** every beat steps in through its windup within a budget (`close`), and
    every step-in, windup track and dash leads the hero's velocity. A string whose next hit cannot
    reach stops. Footwork circles only inside striking range, runs beyond it and sprints past 5.5 m at
    8.6 m/s (above the hero's 7.2). A drinking hero is punished.
  - **Impact is time:** a parry of a blade freezes the frame (0.1–0.15 s), a blow on either fighter
    freezes it too (him 0.065–0.12 s with a jolt layered on his pose; the hero 0.085–0.13 s). The
    parry's FX are built for the freeze: sparks born mid-burst and a shockwave ring born open (born at
    the contact they stacked into one blooming white blot that hid both fighters for the freeze). A
    white screen flash (`grade.flashPulse`) and a heavier clang; a perfect parry adds a short slow
    motion through `flow.cinematic`.
  - His damage × 1.15 (was 1.35): his pressure lands more blows, so each one hurts less.
- **Measured:** god-mode bot ~45 s; 85 % bots win 3 / 3 in 48–52 s; 70 % die 3 / 3 with him at
  8–10 %. Every non-red glint reaches a hero who stands his ground (29 / 29); a hero sprinting circles
  is caught (0.8 m) and hit.
- **Alternatives:** keep the keyed hands and add more keys (the arm still fights the blade between
  them); faster windups with the old 0.35 s flash (a string's flashes would arrive before the hit
  they follow); a homing hit test instead of the step-in (blows that land without his body getting
  there read as unfair); particles on real time during a hitstop (every slow motion would lose its
  frozen sparks).

## ADR-064 — The player drawn at 90 %: Shen Hui's size in a fight (2026-11-12)
- **Context:** the owner, after the Shen Hui duel: "make the main character similar size and scale to
  shen hui as i think the main character is too big"; after rejecting the first attempt (PR #19, which
  kept his size and changed his outfit, face and swings): "lets start over. lets first focus on making
  the size the same as the new boss and reduce the back cloak from covering too much". The Ash
  Disciple is built on the hero's skeleton and drawn at the same `HERO_SCALE` (1.2): standing side
  by side the two are the same height. In a fight the hero is the nearer of the two to the camera
  (it follows him), and with his hood and cloak he read a size bigger. Rendered at 100 / 90 / 80 %
  beside Shen Hui, side by side and facing him at the fight camera, the owner picked 90 %.
- **Decision:** `PLAYER_SCALE` = 0.9 × `HERO_SCALE` (1.08) in `model.js`; the player's `drawScale`.
  `installLean(root, scale)` takes the drawn scale (default `HERO_SCALE`: Shen Hui is unchanged);
  `Player.unlean` / `leanPoint` and the animator's gait and foot planner (`anim.drawScale`) use the
  figure's own scale.
- **Consequences:** visual only: the gameplay body, the hurt cylinder, the hits, the reach and the
  step-in are unchanged (the drawn sword is 10 % shorter; the swing crescent still shows the reach).
  At the fight camera he reads about Shen Hui's size; side by side he stands a little shorter. Planted
  feet hold still at the new scale (slide < 2 mm a frame at a run and a sprint).

## ADR-065 — A trimmed cloak and shorter coat tails (2026-11-12)
- **Context:** the owner: "reduce the back cloak from covering too much". From behind (the usual
  view) the cloak fanned 1.44 m across at rest and, with the long coat tails under it, hid his back,
  arms and legs. Three rendered options from `main`'s cloak (trimmed; the back sheets only; cut at
  the hips); the owner picked "A trimmed" and asked to shorten the coat tails a little too.
- **Decision:**
  - `SHROUD_SHEETS`: the same seven sheets, ~30 % narrower (widths × 0.68), 15 % shorter (segment
    lengths and torn points × 0.85), standing off his back less (`out` 0.3 on the back sheets and
    the sword-shoulder piece, × 0.8 on the others). The mantle and the hood are unchanged.
  - `COAT_PANELS`: segments and torn points 15 % shorter, the join and hem widths 15 % narrower (the
    slant with them); the top widths, the flare and the panels themselves unchanged.
- **Consequences:** from behind his back, arms and legs show between the sheets; the cloak keeps its
  look (the same pieces, the left wing, the drape over the left arm). The Wanderer's set shares the
  shorter coat tails.

## ADR-066 — Gamepad support as a third input source (2026-11-13)
- **Context:** the owner asked for controller support. The game reads one input API
  (`game.input`: key codes, mouse buttons, `moveAxis()`); the touch controls already proved that a
  layer feeding virtual codes keeps every timing (parry tap, charge hold) identical to the real
  device. A boss-rush fighter is played on a pad by many players.
- **Decision:**
  - `core/input.js` gets a separate gamepad source (`setPad`, `setPadAxis`, `releasePad`, `pulse`)
    beside the touch source, each with its own holds, so a release on one never drops another. The
    player and the flow are unchanged: they still read the same codes.
  - `ui/gamepad.js` polls `navigator.getGamepads()` once a frame (the `standard` mapping) and maps a
    souls-like layout: LS move, RS aim, RB / RT attack, LB / LT guard and parry, A dodge, B sprint
    (hold; L3 latches), X flask, Y the HUD prompt's key, R3 lock-on, Menu pause, View help, D-pad
    zoom. A is dodge (not a tap / hold B) so a perfect dodge has no release latency.
  - Aim without a cursor: the right stick steers; idle, attacks auto-aim at the boss in range (the
    touch rule, now one shared helper `ui/aim.js`).
  - Device in use = whichever produced the last input; `html.gcd-pad` swaps the on-screen hints
    (and PlayStation labels from Sony's vendor id). Menus: title any button / stage picker, pause
    menu focus with the D-pad and A, B to resume. A button held across a menu ↔ play change counts
    only after release, so closing a menu never also rolls or sprints.
  - Rumble on the hero's hits, guards, parries and perfect dodges where the browser supports it.
- **Consequences:** no gameplay code changed; keyboard / mouse and touch play are unchanged. The
  headless PAD scenario drives a fake standard pad through the real `Input`. Browsers do not count
  a pad button as a user gesture, so sound starts only after a key / click / tap (or not at all on a
  pad-only session) — a known limit of the Web Audio autoplay rules. Non-standard mappings are read
  with the standard indices (may be wrong on exotic pads); no rebinding yet (ADR-067 adds it).

## ADR-067 — Remappable controls: the game reads actions, not keys (2026-11-13)
- **Context:** the owner asked for button remapping on both the pad and the keyboard. The player and
  the flow read raw codes (`Space`, `KeyF`, `Mouse2`), and the touch and pad layers pressed those
  same codes, so a keyboard remap would have moved the touch buttons and the pad buttons with it.
- **Decision:**
  - `core/bindings.js`: a list of actions with keyboard / mouse and pad defaults (the controls as
    they were, plus R as a second interact key for "fight again"). `Input` answers `act(a)`,
    `actPressed(a)`, `actReleased(a)`; the player, flow and timing trainer read only actions.
  - Every action also answers to a virtual code `'@<action>'`, which the touch and pad layers press.
    The three devices stay independent: remapping a key never changes a touch or pad control.
  - A rebind takes the key / button from any other action; an action left with nothing gets the
    rebound action's old ones (a swap). No action is ever unbound, and no hidden double-binding.
  - Fixed, never remappable: Esc and the pad's Menu (pause; a remap can never lock you out of the
    pause menu), F1–F3 and ` (the Lab, quality, fps), the sticks (move, aim), and the buttons that
    drive menus (A / B / D-pad / LB / RB).
  - The pause menu's CONTROLS panel: two tabs, pick a row, press the new key / mouse button / pad
    button; usable with mouse + keyboard or entirely from the pad. Saved per browser
    (localStorage); a broken or clashing store falls back to the defaults per device.
  - On-screen keys are `[@action]` chips that show the bound key (or pad button while a pad is in
    use) and relabel on every change: prompts, hints, the title line, the control grids.
- **Consequences:** remapped keys are shown everywhere a key is named. Test mocks get the same action
  API (`installActions`). One binding per action after a remap (defaults can have two, e.g. W and ↑);
  no "secondary key" column yet. Mouse buttons 3+ (side buttons) cannot be bound.

## ADR-068 — One duelist engine for every human boss (2026-11-13)
- **Context:** the Ash Disciple's body, mind, clip format and FX lived in his own folder and read his
  data through module imports. A second human boss would have copied about 2500 lines, and every fix
  to the guard, the deflect chain or the tells would have had to be made twice.
- **Decision:** `src/entities/enemies/duelist/` holds the engine: `duelist.js` (`Duelist`: the boss
  slot, guard, posture, break, execution, the duel's moments), `brain.js` (`DuelBrain`), `realise.js`
  (move timing), `poses.js` (`createDuelPoses(guard)`), `fx.js` (`DuelFx`). A boss is a KIT (plain data:
  tuning, moves, clips, gear, poses, the blade's ends, its transitions) and a subclass with a few
  hooks. The Ash Disciple became `class AshDisciple extends Duelist` with `ASH_KIT`; his files keep
  their exports. The engine gained only what a second boss needs and data can ask for: any number of
  phases (`kit.transitions`, `dragon:phase<n>`), drawn alternatives in a string (`pick`), unscaled
  windups (`fixed`), `cast` beats and per-beat hooks, an off-hand blade channel, thrown things with
  their own speed and size.
- **Consequences:** the Ash Disciple's whole suite (`duel.mjs`) passes unchanged, the seeded WIN run
  included (the refactor keeps the order of the AI's random draws). `brain.js`, `fx.js` and the old
  `disciple.js` moved (git history follows them). New bosses are mostly data.

## ADR-069 — The Starless Lord: four blade forms, four bars, a deathblow each (2026-11-13)
- **Context:** the owner asked for a new level: a master dark-side duelist with a red blade of light
  and "evil force powers", in phases: one blade, dual wield, a combined long blade, then one
  cross-hilted blade with an aura; very fast, acrobatic, strings of six with variations, spells
  between the cuts, effects to dodge and to parry or deflect. Asked, the owner picked: a dark lord
  from the stars (not a wuxia figure), four health bars with a deathblow each, faster than Shen Hui
  and ramping up. The game is public, so he ships under his own names: Varr Nihil, the Starless Lord;
  blades of red light; the Void.
- **Decision:**
  - Four forms = the duelist's phases 1 – 4, each with its own stance, moveset (weights per form), reach
    and pace. Each form has a full bar; an empty bar BREAKS him instead of killing him, and the hero's
    execution is the deathblow that ends the form (Sekiro's structure). `lives` tells the HUD.
  - Posture scales with the bar (hard to move when full): a posture break is a deathblow, so without
    this a parry-perfect player would skip his health entirely and a form would last ~13 s.
  - The spells are beats in the same data as the cuts, answered by the same three answers: lightning
    is a blue hit (deflect; a perfect parry returns it), the push a thrown thing (parry cuts it), the
    pull a red line (roll), the thrown blade and stones cue themselves like bullets, called lightning
    marks its ground. No new input, no new rule.
  - Acrobatics are root motion in the data: a somersault (`lift` + the body pitched through a full
    turn, the feet carried round with it), leaps, dashes, the blink (form 4).
  - His look reuses the Wanderer's coat, pauldron, boots, tails and cape in black and crimson, with a
    helm, gauntlets and sabers of his own. The blades draw on the `flask` part, whose ink lines are
    tinted red for this page load (one level per page load).
- **Consequences:** the hardest boss so far (a bot answering 85 % of his tells takes 18 hits; Shen
  Hui's takes 7 – 8). Not played by a human yet. His sounds are the existing cues (no blade hum, no
  thunder of his own). The grip (a choke the hero mashes out of) was designed and left out.

## ADR-070 — The Obsidian Throne Hall; a set's own sky and weather (2026-11-13)
- **Context:** the owner asked to see the arenas before choosing. Three were prototyped as real sets
  and rendered in game: a black throne hall lit red, a storm peak over a cloud sea, a fallen-star
  crater. The owner picked the hall. The sets needed their own light and air, which world.js and
  atmosphere.js hard-coded for the forest and the courtyard.
- **Decision:** a set may return `sky` (moon, ambient and fog, written into the shared uniforms once)
  and `ambience: { setup, update }` (run instead of the fireflies / mist / leaves / ash). The hall
  (`world/throneHall.js`) is centred on its floor seal (the origin); its inlay, pillar slits and
  windows are glyphs in one additive batch of their own (`GlyphParticles` registered with the
  pipeline), which the boss can flare. The lord keeps to the hall's rectangle, not a circle.
- **Consequences:** the two losing prototypes were deleted. Six brazier lights compete with combat
  lights for the eight visible slots (the pool keeps the ones nearest the camera focus). The hall's
  frame cost on a phone is not measured.
## ADR-071 — The hero's swings are keyframed clips: a one-handed chain, each hit in its own plane (2026-11-13)
- **Context:** the owner, for the third time, on the swings: "something about the way he swings the
  sword looks unnatural and not good ... natural, fluid, awesome, dynamic, and varied different
  patterns instead of being the same pattern over and over". Answer to the style question: **wuxia
  flow** (fast one-handed cuts linked by steps, pivots and spins, each hit in a different plane;
  both hands only on the heavy hits). Filmed frame by frame, the cause was the swing model itself:
  every light swing was `slashH`, the hands on a small circle before the chest (ADR-046's two hands)
  with the blade radial to it. Through a whole cut both fists stayed at the sternum while only the
  steel turned; the body stood upright; and every hit was the same flat arc run one way or the
  other. Tuning its numbers (ADR-044, ADR-055, the rejected PR #19) could not change that.
- **Decision:**
  - Each light swing and the charged attack is a **clip**: key poses over the attack's own phases
    (`player/swings.js`, data only; `anim: { kind: 'clip', clip }` in `combat.js`). A key places the
    sword hand, the blade's direction, the free hand, the hips and the chest; `swingPose` runs
    Catmull-Rom splines through them, so the point travels one smooth arc and the arm opens and folds
    because the keys say so. Timing, damage, reach and lunge stay the hit's own (`combat.js`).
  - A clip starts from the pose he was in and drives its channels itself, so a cut runs on out of
    the last one's follow-through instead of cross-fading to a stop.
  - The chain is one-handed (it reverses ADR-046 for the chain): the free hand reaches for the
    target in the coil and is thrown against the cut. The slam and the cleave stay two-handed.
  - 13 clips: three looks each for hits 1–3 (falling cut / draw cut / rising slash; rising / flat /
    falling backhand; whirl / rising whirl / low sweep), two for hit 4 (lunge / rising thrust), the
    sprint slash and the roll cut. Each has a `line`; the animator never follows a swing with one
    along the same line, so two hits in a row are never in the same plane (before, hit 2 retraced
    hit 1's diagonal).
  - The old model is removed: `slashH`, `stabPose`, the windup loop, `FLOW`, the `h` and `stab` kinds.
  - **After the owner's look at the first preview** ("something still seems off during the attack
    animations"; asked which: too fast to follow, the body looks stiff, the arms look wrong, the hits
    don't flow: all four):
    - *Pace:* a light's windup / active frames 0.16 / 0.18 s (were 0.14 / 0.11) and the next light
      waits for `chain` (30 %) of the recovery, so a mashed chain lands a hit every ~0.42 s (was
      0.25 s). The lights' damage and posture ×1.4 with it; the crit window 1.6 → 2.2 s.
    - *Legs:* `lungeFeet` steps the foot that is BEHIND as the swing starts, so he walks through a
      chain (left, right, left …) and the holding foot's heel peels; it was the same left-foot lunge
      every hit. The keys shift the weight from the back foot (hips up) into the front one.
    - *Arms:* a motion audit (per-frame turn of each arm segment in the body's frame) found elbows
      flipping 50–135° in ONE frame where a pole switched or a hand passed the shoulder, and the
      free hand thrown ~0.7 m front-to-back every hit (15 m/s). `_elbow` now limits an elbow's swing
      round its shoulder → hand line to 14 rad/s for every clip (the hand still reaches); the free
      hand stays before the chest in the coil and comes back to hang beside the hip.
    - *Flow:* the coil is ONE key (two made a dead stop before every cut) and the blade is still
      moving when it gets there; `swingPhase` maps time to phase with a monotone cubic (the straight
      map halved the motion's rate in one frame as the cut ended); the cut carries through before
      the next windup starts from it.
  - **After the second preview** ("looking better but i want the angles not to be so perfectly like
    top to bottom and more diagonals and more natural fluid"): filmed from the game camera, the
    "falling" cuts, the leaping cut, the cleave and the slam all ran in upright planes (the blade
    passing over the top of his head at 66-78° of elevation), and the camera, looking down from
    behind him, draws an upright plane as one straight bar up the screen.
    - Every cut's plane is a diagonal: the blade stays under ~45° of elevation and crosses his front
      near chest height. The leaping cut (straight down the middle) is replaced by a rising slash;
      the slam takes a `tilt` (0.42 rad: it comes down from over the right shoulder).
    - The blade whips: at mid-cut the hand is at full reach in front of him and the blade still
      ~30° short of pointing ahead; it comes through and passes the hand as the cut ends.
- **Consequences:** a new swing is a few lines of data and can be filmed and tuned on its own. The
  keys are authored by hand: a bad key shows as a bad pose, so HEROLIFE measures every look (the
  sword hand ≥ 0.40 m from its shoulder at some active frame, the free hand off the grip, no arm
  segment turning ≥ 45° in a frame, the lead foot changing with every hit, the line rule over 40
  chains, the mashed pace) and HEROLOOK keeps the drawn blade out of his body through every look.
  A windup's blade turns to its coil round the side of the hand away from his spine, and the hand
  comes round in front of his chest (`dirLerp`'s carry rules sent the blade behind him out of a
  recovery; a straight hand path from one hip to the far shoulder ran through the torso). Reach is
  untouched; the pace is slower and each light hits harder (a mashed chain deals ~15 % less per
  second); the low sweep crosses his front later in its active frames, because a low blade reaches
  less far under a tall target. The finisher still uses the older slam code; the whirl's feet still
  turn on the ground with the spin.

## ADR-072 — The charged attack is a dashing cleave (2026-11-13)
- **Context:** the owner: "when he charges the sword the arm bend is all messed up and make his
  charged attack be an impactful slash with a cool weightful hit instead of a poke". The charge held
  both hands down at the right hip with the blade out to his side: the sword elbow stuck out level
  and the free arm folded across the belly. The release was a lunging thrust. Of four options
  (dashing cleave, rising launcher, spinning cleave, leaping chop) the owner picked the first.
- **Decision:**
  - **The charge:** a deep, wide stance coiled away from the target, both hands on the grip beside
    the right ear, the blade standing nearly upright beside his head (80° up, 74° at full charge).
    Both elbows bend the way a raised two-handed guard does; the blade stands clear of the cloak.
    (The first version leaned it 34–44° back over the shoulder. The owner: "it looks like the sword
    is piercing through him": from the camera behind him a blade leaning toward the camera is drawn
    DOWN across his back. Upright, it stands above his shoulder from every side.)
  - **The release (`CLEAVE`, kind `cleave`):** the thrust's dash (2.2–3.6 m by charge, front-loaded
    through 0.24 s of active frames), the blade winding back over the shoulder; over the last 45 %
    of the active frames the whole body unwinds into one two-handed diagonal, high right to past the
    left hip, and he sinks into a long low lunge that he holds while the off hand lets go.
  - **The hit:** a 0.15–0.2 s freeze (was 0.1), a harder shake, a ring and a fan of streaks at the
    contact (`fx.cleaveImpact`), a wide crescent that hangs ~2× as long as a light swing's, and a
    second gust and dust where the cut ends.
  - Same damage (70–110), posture, travel and recovery as the thrust (0.08 / 0.24 s of windup /
    active frames for its 0.07 / 0.2 s). The thrust stays as the execution against a broken duelist
    (`THRUST`, `_startExecuteThrust`); both are `dash: true`.
- **Consequences:** `player:attack` / `player:hitDragon` report kind `cleave` for the charged attack
  (audio, the combat feed, tests and docs follow). The cut happens late in the dash on purpose: a
  target reached at any point of the dash is still in front when the blade comes through; REACH
  connects from contact to 3.5 m. Unlike the thrust the blade is behind him for the first 60 % of
  the active frames, so something that only crosses his path early in the dash is not hit.

## ADR-073 — The guard is a cross ward; the cloak is a narrow cape; a shorter sword (2026-11-13)
- **Context:** the owner: "make his guard stance have a deeper angle" (asked: the blade and the
  stance both) and "i want his cloak to be thinner in the back" (asked: narrower from behind).
  Three guards and three cloaks were rendered close up and at the game camera and the recommended
  ones put in; on the preview the owner said "the new cape seems fine", "have the character raise
  its hand up more during the block", and "make the sword a little bit shorter as the longness
  doesnt seem right".
- **Decision:**
  - **Guard, the cross ward:** sunk 0.17 m and side-on (the left foot well forward, hips and chest
    turned ~28° away), both hands on the grip before the chest (13 cm under the shoulder; the first
    version held them at the hip), the blade slanting ~38° up across the whole body to past the left
    shoulder, its point above his head. From the camera behind him ADR-046's guard (hands before
    the chest, the blade ~50° up) showed only its point over his head; the flatter slant shows as a
    bar across his back, and across his front from ahead. The others rendered: a hanging guard and
    a braced diagonal, both with the free palm on the flat (pose channel `offAt`, kept).
  - **Cloak, a narrow cape:** three sheets down the middle of his back, 0.24 m at the hem in the
    middle and the two beside it turned only 0.3 rad out, plus the drapes on the arms; the wing over
    his left side and the sheet behind the sword shoulder are gone (7 sheets → 5). Arms, waist and
    legs show beside it from the game camera. The others rendered: "slim" (the old cloak ~30 %
    narrower) and "scarf tails" (three thin tatters down the spine). Kept by the owner.
  - **Sword:** the drawn blade 12 % shorter (`DIM.drawnTip` 1.06 → 0.93: a 1.12 m sword with the
    pommel; `steelTip` 1.17 → 1.04), rebuilt with `npm run hero-parts`. Swung in one hand the 1.25 m
    sword looked too long. Visual only: the hit segment and every reach are unchanged.
- **Consequences:** the parry flicks the blade up out of a lower guard (a bigger move). Fewer sheets
  means a coat kick draws fewer random numbers, which moved the seeded meteor layout in one wyrm
  test and showed that test assumed a standing hero is always hittable on a blast's first frame; it
  now allows a blow chained within 0.3 s of another to land inside the blast's 0.12 s.

## ADR-074 — The sword arc is a line and a veil, drawn only where the blade turns (2026-11-13)
- **Context:** the owner, on the second preview: "make the sword arc glow effect be more subtle and
  way more epic cooler looking". The arc was four or five rows of bright strokes under a rim of `A` /
  `8` letters with a halftone of `+` behind: a solid glowing band as wide as half the blade. During
  the cleave's dash it drew a wall of light as tall as the sword, because it filled the space
  between two frames of the blade whether the blade turned or was merely carried along.
- **Decision:** `PlayerFx.trail` draws
  - an **edge**: one bright line along the point's path (round `•` strokes stretched end to end),
    which thins and cools as it fades over ~0.25 s, so the cut hangs in the air as a drawn line;
  - a **veil**: 3–5 rows of faint `|` streaks inside it, each fainter toward the hilt (opacity 0.7
    → 0.15) and gone in ~0.1 s;
  - **motes**: a speck or two of light off the point, carried on along the cut;
  - and `arcGlint`: a small star and a pinch of sparks on the point, once a swing, as it comes through.
  Its strength follows how far the blade TURNED in the frame (nothing under 0.03 rad, the full arc
  from 0.2 rad): the arc tapers in and out with the cut, and a dash or a lunge leaves none. The
  slam's is wider and longer-lived; the cleave's hangs twice as long.
- **Consequences:** far fewer bright pixels (the bloom no longer swallows him through a chain), and
  the arc's shape is the cut's own: with ADR-071's diagonal planes a chain draws curved sweeps round
  him instead of bars. The letters and the halftone lattice are gone from the hero's arc. The
  plunge's dive passes `gate: false` (its blade is carried, not turned, and keeps its band). The
  Ash Disciple's and the Starless Lord's sweep trails are their own code and unchanged.

## ADR-075 — The chain's pace: a quick cut between two held ends, a hit every ~0.32 s (2026-11-14)

**Context.** Session 25 slowed the light chain from a hit every 0.25 s to one every 0.42 s (windup
0.16 s, a 0.18 s cut) because the owner found the swings "too fast to follow", and raised the
lights' damage ×1.4 to pay for it. On the merged build the owner wrote: "speed up the attack speed
on the character. its too slow right now". So 0.25 s was too fast to read and 0.42 s too slow to
play. The swings of Session 25's first build were also stiff and had no arc worth the name: what
was hard to follow then was not only the speed.

**Decision.**
- **A light is a short gather, a quick cut and a held finish:** windup 0.11 s, active 0.12 s
  (the lunge 0.10, the whirl 0.13 / 0.15), recovery 0.24 s with `chain` 0.3. A mashed chain lands a
  hit every ~0.32 s (measured 0.32, 0.32, 0.37). The cut itself is as quick as before Session 25;
  readability comes from the poses at its two ends and from the arc that hangs behind the blade
  (ADR-074), not from a slow blade.
- **Damage follows the pace:** the lights are 30 / 32 / 36 / 30 again (posture 12 / 12 / 16 / 14).
  The slam is 66 (was 58) and has a `chain` of its own (0.3): a mashed button used to cut its
  landing off the frame the blade met the ground. Mashed, the chain deals ~104 a second (109 on the
  slow chain, 120 before Session 25). The crit window stays 2.2 s.
- **The sprint slash and the roll cut** speed up with them (0.11 / 0.13 / 0.32 and 0.10 / 0.11 /
  0.26 s); the slam's windup is 0.28 s (was 0.4), its blow 0.13 s. The cleave is unchanged: its
  charge is its windup.
- **`player.debug.attackSpeed`** (the Lab's "atk" slider, ×0.6 – ×1.6): a multiplier on the attack
  clock, so the owner can try other paces on the preview (the Lab's button works on a phone) and
  name a number instead of "faster" or "slower". 1 in play; the root's speeds are scaled back so a
  swing's step covers the same ground at any pace.

**Rejected.** Going back to 0.25 s (the owner called that too fast, twice). Keeping the 0.18 s cut
and only shortening the windup and the wait between hits (the slow blade is what reads as slow).
Scaling every timing by one factor in code (the timings are data, per hit: combat.js).

**Consequences.** The fastest frame of an arm in a cut is larger (the upper arm's throw into the
falling cut and the lunge: ~55° in a frame, was 42°): the test's limit is 60° (it was 45°; the
elbow flips it guards against were 50–135° on swings half as fast). Tests that walk the chain click
every 0.36 s (`CHAIN_EVERY`).

## ADR-076 — The finisher is a clip; a recovery flows into the way home; the whirl drops and spots (2026-11-14)

**Context.** The owner, with the pace: "think of ways to make the character, animation, and motion
better". Session 25's lesson was to measure motion before tuning it, so the hero was run through
every state (idle, run, sprint, the chain in each look, single hits, roll and sprint attacks,
block, charge and cleave, heal) with nine points tracked in his own frame, and the frames where a
point's motion changed most abruptly were listed. Three things stood out:
- **The slam**, the last swing still on its own code (`slamSwing`): its hands covered 0.54 m in
  one frame of the blow, the point reversed in a single frame at the top, and the blade went over
  the top of his head (an upright plane leaned 24°).
- **Every recovery:** the clip's last key is at ~40 % of the recovery and the way home started at
  50 %, so the blade stood still for two frames and then came home in 0.12 s at 60 cm a frame at the
  point, as fast as it had cut: cut, freeze, snap.
- The roll out of a swing and the guard's raise are also abrupt (the point moves 0.4–0.8 m in a
  frame), but both are reactions that must be instant; they are left alone.
Filmed close up, the whirl turned bolt upright, like a figure on a turntable.

**Decision.**
- **The slam is a swings.js clip** (`slam`, line `down`, two-handed) like every other swing: a
  gather (he dips and coils right, the blade drawn down-back past the right hip), a leap (`hop`
  0.26 m with `tuck` 1.2: the knees draw up) as the blade sweeps up his right side, where the camera
  behind him sees it, and cocks over the right shoulder (46° up), then one diagonal down across his
  front into the ground ahead and a little left, the hands leading and the steel whipping after
  them. He lands folded over the planted blade and holds it (`home` 0.55). The second look is the
  same clip nearly grounded (`hop` 0.09). The shards, the reach band, the hit test and the events
  are the def's and unchanged. `slamPose`, `slamWindup`, `slamSwing`, `slamTilt` and the path
  splines they used are removed (about 190 lines).
- **The way home starts while the follow-through is still moving:** a clip's `home` defaults to 0.3
  of the recovery (`SW_HOME`; it was 0.5). The blade turns round without standing still and comes
  home over 0.17 s at about half the cut's speed.
- **The whirl** drops 7 cm into its turn and leans to the inside of it, and his head spots: it stays
  on the target while the body turns away, comes round ahead of the body and finds the target again
  before the shoulders do (`spinTurn`, `SPIN_SPOT`).

**Rejected.** Smoothing the old slam's easing (its plane and its own windup code would have stayed
a second system). Letting the way home finish after the attack state ends, in the cross-fade to the
ready stance (the cross-fade routes the blade by the carry's rules, not the recovery's: a finish
over the left shoulder could come home behind his head). A slower raise of the guard (a block must
read as instant).

**Consequences.** Every swing of the hero is clip data now; the only attack pose still in code is
the execution's thrust. Tests: the finisher's hands move < 36 cm in a frame (33); a cut's
follow-through runs into the way home (no two still frames, the point home at < 0.62 of the cut's
speed); a mashed button leaves the slam's landing ≥ 0.1 s.

## ADR-077 — The sword arc hugs the steel: a fine line in three looks; the thrusts rise (2026-11-14)

**Context.** The owner on Session 26's preview: "the 4th poke on the sword combo is like clipping
through the ground. make the sword trail effect look way cooler and more subtle".
- **The poke.** Measured, the lunge's steel never came within 0.8 m of the ground. Filmed from the
  game camera with the hero facing it, the level blade is drawn straight down the screen from his
  hand to the grass between his feet: the camera looks down at 58° on a hero whose drawing is
  leaned upright, so "toward the camera and level" reads as "down". The swing's glint made it
  worse: it flashed at the end of the gameplay reach, 1.9 m from the hilt and a metre past the
  steel, which from that camera is on the ground in front of him.
- **The trail** (ADR-074's line and veil) ran at the end of that reach too: a crescent twice the
  sword's length, with a veil half the reach wide that still read as a glowing band, an edge of
  stretched dots that showed as dashes, and an end that dipped under the grass on low cuts (0.26 m
  under on the falling cut, 0.63 m on the slam).

**Decision.**
- **Both thrusts rise:** the lunge's point is driven up at 35° (20° in the coil), the rising
  thrust's at 45°, at a tall foe's chest. Facing the camera the blade now ends at his hip, pointed
  at the viewer; from behind it stands long above his head; from the side it is a rising line. The
  hit test is unchanged (the reach band is vertical; REACH passes at every distance).
- **The arc is drawn off the steel:** its edge runs just past the steel's point (`arcAt`: 0.64 of
  the hit segment for the default look, the steel ends at 0.44), and the glint sits on that edge.
- **The edge is a fine unbroken line:** overlapping `|` strokes 0.11 m in size (a sliver wide),
  one per 0.11 m of travel, white-hot as drawn and cooling to indigo as each thins away, so the tail
  tapers to a hair. No dots, no dashes.
- **The look is a thin crescent** (`ARC_LOOK`): the edge with four faint rows close inside it, the
  faintest at 6 %. It was chosen from three: a trail is a taste call and it moves, so three looks
  were built behind a Lab button (`line`: the edge alone; `crescent`; `ghost`: afterimages of the
  steel fanned behind it), rendered as a sheet and put on the preview. The owner answered
  "Crescent"; the other two, the button and `debug.arcStyle` were deleted.

**Rejected.** Keeping the thrust level and selling it with a long streak along the ground (it would
still point at the grass). Shrinking the old veil's opacity only (the band's width and the dashes
were the problem). One look chosen by me with nothing to compare it to (the last two rounds of
this effect both came back).

**Consequences.** The crescent no longer shows the full gameplay reach (hits land up to 0.7 m past
the drawn arc, in the player's favour). Tests (HEROLIFE 1e): a turning blade is drawn in strokes
of at most 0.14 m no further than 1.3 m from the hilt, a bright edge over a faint veil, with no
letters, and nothing for a carried blade; the thrusts' points are at least 30° above level at full
reach.

## ADR-078 — Joint limits in the solver; the charge is a guard held out from the body (2026-11-14)

**Context.** The owner, with a screenshot of the held charge: "while charging the right hand makes
an unnatural angle. review all the characters animation and make sure the anatomy and motion is all
natural and legit". Poses are authored as hand and foot targets and a blade direction; nothing
stopped a pose, or a cross-fade between two good poses, from asking for what a body cannot do. The
hero was run through every state (idle, run, sprint, every look of the chain, single hits, roll and
sprint attacks, block, charge and cleave, heal) and his joint angles were measured in his own frame
(the drawn hero is sheared toward the camera, which bends angles by up to ~15°). Found:
- **The held charge:** the hands were 0.11 m before the right shoulder. The sword elbow was folded
  to 18°, the forearm stood up under the hilt in one line with the blade, the off hand was inside
  the chest and the off forearm ran 15° off the steel.
- **Elbows** closed to 18–20° in the charge and the falling cut's coil; **knees** to 10° in the
  roll's tuck.
- **The sword wrist** folded the blade back along the forearm to 170° for three frames as the
  charge came up from a low coil, and to 139–150° in the slam's gather.
- **The slam's and the cleave's cocked position** put the grip level with the shoulders beside the
  head: the off arm's elbow went up behind the back to reach it.
- **The free hand** passed 2 cm inside the chest on its way to a backhand's coil; **the neck**
  turned 76° in the whirl (Session 26's own head spotting).
- In range everywhere: the shoulders of the sword arm, knees bending forward, the spine (54° at
  most, in the roll), run / sprint / stop / turn / heal / idle.

**Decision.** Limits live in the solver, so no pose and no blend between poses can pass them:
- **Elbows never close past 40°, knees past 32°** (`ARM_FOLD`, `LEG_FOLD`): a hand or a foot asked
  for nearer its shoulder or hip than that is held out along the same line (`_arm`, `_leg`).
- **The sword wrist** (`_wristLimit`, `WRIST_BACK` 128°): the blade never folds back along the
  forearm further than that from the forearm's own line; a pose that asks for more gets the blade
  at the limit, on the same side.
- **A hand never passes through the chest** (`TORSO_R`): inside the ribs' outline it is moved out
  to the surface. The off hand on the grip is exempt from the first and the last (it keeps the
  grip): two-handed poses are fixed in their data instead.
- **The charge** is a high guard held out from him: the grip a forearm's length before the right
  shoulder, the sword elbow lifted out to the side, the off forearm across the chest. Sword wrist
  103° to the steel, elbows 58° / 49°, the off hand 18 cm from the chest's axis.
- **The slam and the cleave** cock the grip 0.16–0.24 m before the shoulder line, and their off
  elbow is keyed down and out (`lp`); the slam's gather draws the hand behind the hip line.
- **The whirl's head** turns 0.6 rad (`SPIN_SPOT`) and is clamped to 1.0 rad on the chest.

**Rejected.** Fixing only the charge's numbers (the next pose would repeat it; the transitions
cannot be fixed in data at all). A full biomechanical model (shoulder cones, forearm twist): the
rig has no hand bones and the audit found the sword-side shoulder in range everywhere.

**Consequences.** The wrist limit turns the blade by up to ~10° in the first active frame of the
falling cut; REACH passes at every distance. Tests (HEROLIFE 1g): through a held charge and its
cleave, three chains, a roll and the guard, elbows ≥ 38°, knees ≥ 30°, the blade at most 130° back
on the forearm; the held charge's wrist, elbows and off hand in range. Not covered: the off hand's
wrist (it runs 4–40° off the steel in two-handed cuts), the free arm's elbow drawn behind the back
in two backhands' recoveries, hit reactions and the death fall (not driven by the audit).

## ADR-079 — A clash is two blades that meet: the contact is posed, held and drawn once (2026-11-14)

**Context.** The owner: "Make the parries and deflect more epic. the clash is buggy and doesnt feel
like a sword clash." Filmed frame by frame at the game camera (side on, the Ash Disciple):
- A parry's freeze-frame (0.1 – 0.15 s, the picture the player keeps) showed **two white blots**
  and no blades: the hero's burst and the attacker's own, each with a 0.55 – 0.7 m `*` core at HDR
  3 – 4 and a 4.5 light, a body-width apart, both blooming.
- The hero's deflect pose snapped out over the clip's first 0.045 s. The parry's own hit-stop runs
  time at 2 %, so through the whole freeze he stood in the guard he started from; the snap came
  after it. The sides alternated, whatever side the blow was on.
- At the frame a blow lands, the attacker's blade is not at the hero's guard. Measured over three
  moves: a cut travels ~0.4 m a frame, so the impact frame has it 0.25 – 0.55 m PAST the hero; a
  thrust's blade runs down his centre line with the hilt at his chest.
- The same white core every 0.34 s as the tell's glint, the size of the hero.

**Decision.**
- **FX time runs on through a freeze** (`game.fxDt`, `CONFIG.render.fxLive` 0.6): particles and the
  light pool advance at 0.6 of real time while a hit-stop holds the actors. The fighters freeze on
  the contact; its sparks fly.
- **One clash, of lines** (`combat/clashFx.js`, STYLE.md → "Steel on steel"): streaks in the screen's
  plane along the turned blade's way, a cross along the two edges, a two-frame core, embers, a ring
  where the exchange turns. The attacker's own parry burst is gone. The duelist's tell glint keeps
  its four rays and loses the disc.
- **The contact is posed** (`duelist.parryContact`, `player._parry`): for a hit marked `steel` the
  attacker steps his own pose back along the strike to the last frame before the blade crossed the
  hero in which it is 0.34 m clear of him (a thrust is set 0.4 m aside by turning him), and stays
  posed there (`brain.back.off`: the pose shown runs behind the timeline; the timeline, the tells
  and the hits do not move). The hero's deflect goes to that side, up for a blow from above, hung
  for a low cut, with no cross-fade and in the same call, and the grip is nudged until the blades
  touch. A blow that is only deflected rebounds for 0.07 s before the clip takes over again.
- **The freeze is context:** 0.05 – 0.075 s inside a string, 0.11 s on its last blow, 0.14 s
  perfect; a camera punch (`cameraRig.punch`) carries the weight the long freeze used to.

**Alternatives.** Resolving the hit when the blades first touch (a geometric parry): it would move
every contact off its flash + lead, which the timing tests and the player's rhythm rest on.
Animating the sparks only (leaving the poses): the freeze-frame still shows no contact. Slowing
the strike so its impact frame is at the guard: his cuts are a 0.1 s snap by the owner's brief.

**Consequences.** Nine extra pose evaluations of the attacker and two of the hero per parry (once,
not per frame). The step back can show him up to 0.06 s behind his timeline for 0.07 s. A thrust
turns him up to 0.5 rad for one beat; the next windup's tracking takes it back. Seeded sims shift
(fewer particles draw on `Math.random`). Checked by `duel.mjs` CLASH: 7 of 10 parried blows end
with the blades ≤ 0.2 m apart, all 10 held back off the hero, the freeze short inside a string.
Not checked: how it reads on a phone.

## ADR-080 — His guard is read from him; a swing can be cancelled into a guard or a dodge (2026-11-14)

**Context.** The owner: "improve the combat mechanics of enemy guarding, being able to animation
cancel from a swing to a guard or dodge instantly. right now i cant tell animation or feel wise that
the enemy is guarding." Filmed: his guard was his en-garde stance (nothing changed when it was
up); a strike into it drew a white blot and a clip whose blade reached its block 0.06 s in, behind
a 0.07 s freeze; the hero's swing went on through him; the counter was a roll of the dice the
player could not see coming; and the hero could not leave a swing (a guard only out of windups and
recoveries, a dodge only after 35 % of a recovery). The sentence reads two ways (who cancels), and
both were missing, so both are built.

**Decision.**
- **The hero cancels:** a guard press or a dodge ends a swing at any point (not the execution).
- **His guard has three pictures** (`duelist/guard.js`, shared by every duelist): **raised** as
  the hero swings at him (the blade stands across his body; `brain.wardK`); **a ward** on the
  strike's side whose contact pose is the clip's first frame (dull steel sparks, a dry clack,
  GUARDED); **a deflect** (he beats the strike away: orange, a harsh clang, DEFLECTED in red), which
  throws the hero's blade back (`player.onGuarded`: the bounce, cancelled at once by a guard or a
  dodge) and starts his counter as the 0.24 s beat ends. The counter's odds per guarded strike in a
  row are unchanged (0 / 35 / 70 / 100 %); what is new is that it is announced.
- **He cancels too:** past half of a move's recovery he breaks it off into his guard when struck,
  and once per 3 s he may step out of a heavy blow (45 %; from footwork or that late recovery).

**Alternatives.** A guard icon or a bar over him: tells are read from the attacker, never from the
HUD (COMBAT.md rule 2). Bouncing the hero off every guarded strike: attacking a guard is how its
posture is worn (Sekiro's rule), and a bounce per hit would stop the chain dead. Letting him abort
a windup into a guard: a mashed light would then cancel his attacks.

**Consequences.** Attack commitment is gone from the hero's side by design; what keeps mashing in
check is the deflect. His punish window is the first half of a recovery (it was all of it, though
a flinch already raised his guard after one hit). Measured (`duel.mjs` WIN, seed 4242, a fencing bot
that answers every tell): 55 s, 42 parries, 22 guarded swings, 5 breaks; before: about a minute.
No human has played it; whether 45 % of heavy blows dodged feels fair is the owner's call.

## ADR-081 — The blade lock is two crossed blades; a duel is framed closer (2026-11-14)

**Context.** "The clash" may also have meant the blade lock. Filmed from the side: the two stood
1.5 m apart, his blade standing up, the hero's in his ordinary guard: nothing crossed. Every press
drew a white bloom in the air between them. And at the default camera (36 m, 32°) two duelists are
~60 px tall at 720p: no clash reads at that size.

**Decision.**
- **The lock:** the two close to 1.3 m (half each), a lock pose for the hero (both hands driven
  forward, the blade up and across), his grip servoed onto the crossing of the two blades every
  frame (`_lockCross`), sparks grinding out of it, a small spit per press, and the pair sliding
  0.9 m with the meter. The blades break apart in gold or orange.
- **Duel framing:** a duelist's `TUNING.camera` (`within` 6.5 m, `zoom` −6 m, `fade` 4 m) eases the
  camera in while the hero is in his reach, applied after the flow's boss framing (which only ever
  pulls out) and scaled for the phone's closer camera.

**Alternatives.** A fixed closer camera for the whole level: the approach, the leaps and the thrown
qi want the wide view. A scripted side-on camera for the lock: the fixed-yaw camera is the game's
look (ADR-005), and the X reads from above once the blades truly cross.

**Consequences.** In reach the fighters are drawn 20 % larger; the wheel's zoom still applies on
top. The lock moves the boss (`moveBy`, inside his bound). Checked by `duel.mjs` CLASH (1.3 m apart,
blades within 0.2 m). The closer camera is a taste call that was not put to the owner as options:
it is one number to change.

## ADR-082 — The trade clash: two cuts at the same moment meet (2026-11-14)

**Context.** Proposed in Session 27 and picked by the owner ("Trade clash"). Until now a cut of the
hero's and a blow of the duelist's that fell together both landed: the two most committed moments
of a duel passed through each other. The parry and the guard already clash; trading blows did not.

**Decision.** A blade's blow (normal or blue, from a zone beat: not red, not a cast, not a thrown
thing) and the hero's cut within the same moment **meet**: neither is hurt.
- **Two entries, one outcome.** `player.takeHit`: a hit marked `steel` that arrives while the cut
  is in the air (`DEFENSE.trade`: its active frames, 0.03 s before, 0.02 s after) returns
  `RESULT.CLASHED`. `duelist.takeHit` (`_tradeNow`): the hero's cut connects when his blow is at
  most 0.1 s from landing: the beat is spent and his timeline skips to its impact. Without the
  second, a cut that reached him a frame before his blow would bite and then be bitten.
- **The picture is a parry's:** he is held where his blade met the hero (`parryContact`), the
  hero's cut is stopped on it (`_meetBlade`, the code the parry uses), the burst is white-hot with
  two rings. Left in their swing poses the blades were 0.7 m apart in the frozen frame (his cut
  low, the hero's high); stopped on his blade they are 0.01 – 0.22 m apart for cuts.
- **Nobody wins it:** the hero bounces (a guard or a dodge at once, an attack after 0.28 s); a
  string goes on; a single strike or a last blow ends in the short `clash` reaction, not the recoil.
  Guard posture × 1.5 (12 / 30). The exception is a cleave that would crush his guard: it beats
  the blow aside, staggers him and lands.
- **It cannot be mashed:** after one, the next needs `rearm` 0.6 s. The first version had no such
  rule and relied on the bounce's 0.28 s; the test caught a mashed button trading the second blow
  too (a string's blows are 0.42 s apart, not the 0.34 s of their windups).

**Alternatives.** A button for it: it is the absence of one that makes it a trade. Making it a
parry (the recoil, the blade lock, the full deflect's count): attacking would then be the better
defence. Ending the string on a trade: a duelist who is relentless by the owner's brief should
not be stopped by a light.

**Consequences.** `RESULT.CLASHED`, `combat:clash`, the sound `trade`, the CLASH call-out. A press
window of ~0.19 s (the parry's is 0.22 s) for a smaller reward and no opening. An invisible timer
(the re-arm), like the parry's. Checked by `duel.mjs` TRADE (16 checks). Not checked: a human
playing; whether "attack into his attack" is found without being told.

## ADR-083 — Hit reactions fall the way the blow drives them; he dies where he lies; knees and elbows stay above the grass (2026-11-14)

**Context.** ADR-078's audit left out the hit reactions and the death fall; the owner: "Yes, audit
them". The flinch, the block, the parry, the guard break, the knockdown and the death were each
entered from 20–30 states (standing, running, every hit of the chain, the charge, a roll, the heal,
from each side, lying down) with the joints, the ground, the blade against the body and the most
abrupt frames measured, and then filmed. Found:
- **Killed while knocked down** he stood up first: the death clip starts upright, so a man lying on
  his back was lifted to his feet in a tenth of a second (his head from 0.3 m to 1.4 m), knelt and
  fell a second time.
- **The death's collapse** pushed both knees 14–16 cm under the grass: the feet were carried from
  the kneel to "legs laid out along the body" while the hips dropped, and nothing kept a knee above
  the ground (hands and ankles had floors; knees and elbows did not).
- **A knockdown from behind** turned him 180° in ONE frame to face the blow, to fall on his back:
  his hands and feet moved 0.5–0.7 m in that frame.
- **Every flinch snapped him BACK**, also one from a blow between the shoulder blades.
- **Struck in the middle of a swing** the reaction faded in over 3 frames: the blade was thrown
  1.2–1.8 m in one of them (a cut's own fastest frame is 0.9 m), and in the whirl the whole body
  whipped square, the hands 0.57 m in a frame.
- **He fell like a board** (both legs straight, arms at his sides) and lay like one; the corpse too.
- **On the corpse** the left elbow stood up in the air (its pole pointed "behind him", which is up
  once he lies on his front) and the sleeve's cloth sheet stood 0.45 m straight up with it.
- In range: the guard break, the block and the parry (a guard blown open is meant to be violent),
  and every joint angle through all of it (ADR-078's limits held).

**Decision.**
- **A knee and an elbow have a floor** (`KNEE_FLOOR`, `ELBOW_FLOOR`; `_hingeFloor` in `_leg` /
  `_arm`): a joint solved under the grass is swung round its limb's line up to the grass, the short
  way. In the solver, so for every pose and blend, like ADR-078's limits.
- **The knockdown falls away from the blow** (`player.kdProne`, `_fallFrom`): from the front or a
  side onto his back, from behind onto his FRONT (hands thrown out, lies face down, pushes himself
  up, a foot under him, stands). His facing eases square to the blow over the fall
  (`TUNE.knockdownTurn`, 11 rad/s, at most a quarter turn) instead of being set in one frame.
  Timings, i-frames and the slide are unchanged.
- **The fall itself:** the feet stay where they stood as the hips drop, so the knees buckle; the
  hands are left behind out ahead as the chest goes; lying, one knee stays up with its foot flat,
  the other leg long, the sword arm flung wide and the free hand on his belly.
- **Killed in the knockdown he dies where he lies** (`deadDown` clip; `player.deadDown`,
  `downFrom`): the fall carries on to the grass, one arch runs through him and he goes limp. No
  kneel, no second landing (its dust and shake are skipped).
- **The flinch gives the way the blow drives it** (`player.hitPush`, the push in his own axes):
  arched back, folded forward over a blow from behind, bent to the side, with the foot on that
  side catching him.
- **A reaction entered from the middle of a move** fades in over 0.1 s (0.05 from standing or
  running), and one entered mid-turn (the whirl) finishes the turn over 0.3 s (`A.yaw0`,
  `carryYaw`) instead of snapping square. The guard break's fade is 0.07 s (was 0.04).
- **The corpse:** one knee fallen out to the side, his face turned to one side, both elbows flat on
  the grass. Lying on the ground the cloth sheets obey gravity (`_layFlat`: a sheet's far end no
  higher than its root), where "wrapped along the body" stood them up with a raised arm.

**Rejected.** Easing the old turn-to-face (a half pirouette while falling backwards is no more
natural than the snap). A ragdoll (no physics in this game; fixed clips are readable and cheap).
Lengthening the reactions to hide the fades (they are gameplay timings).

**Consequences.** A hero knocked down from behind keeps his back to the attacker when he gets up.
The fastest frames after the change: the blade 0.2–0.75 m entering a reaction from a swing (was
0.9–1.8), the guard break 1.1 m (meant), a knockdown from behind 0.26 m (was 1.8). Tests (HEROLIFE
7): the flinch's direction, the whirl's interrupt, the knockdown from the front, behind and a side
(which way he lands, how far and how fast his facing turns), both deaths, and no knee or elbow
more than 2 cm under the grass through all of it. Not covered: the plunge's and the blade lock's
poses were not part of this audit (the lock was reposed in ADR-081); the off hand's wrist in two-handed cuts and the free arm's
elbow in two backhands' recoveries (ADR-078) still stand.
## ADR-084 — The Starless Lord's harness: an armoured dark lord of his own design (2026-11-14)
- **Context:** the owner asked to improve the boss's "character detail" and to make him look like a
  famous film villain in black armour, a helmet and a cape. He had been built from the Wanderer's
  coat, pauldron, boots and half-cape under a horned helm, at the Ash Disciple's size.
- **Decision:** the archetype, not the character. He gets a harness of his own (gear.js): a deep
  hood over a prow faceplate with one slit of red light and a ribbed breather; a cuirass with a
  gorget and a ring of red light on the breastbone; a plate yoke on the chest joint with a lamed
  pauldron on each arm; plate arms and thighs; hip plates over a war-skirt; and a cape of five sheets
  to the ankles on the streamer springs. Nothing is copied from another work's design: the faceplate
  is his own, there is no chest panel, and the names stay his own. He is drawn at 1.32 (`kit.scale`;
  the hero is 1.08, Shen Hui 1.2): a head taller, visual only.
- **His head, the owner's pick:** three heads were rendered in game on one sheet over the same
  harness (A a crested sallet with a lamed tail, B the same helm under a crown of swept-back spikes,
  C the faceplate in a deep hood) and A was built first. The owner picked C ("the hood",
  2026-11-14). The two helms and the `?lordLook=` switch that showed them on the preview were
  removed, and the hood was finished as his head (`HOOD_RINGS`, a ring per row as [y, half-width,
  front edge, back edge, opening]): a round crown, a brow that hangs forward over the faceplate and
  closes just above it, a rim in the cloth's ember red round the opening, a drape pooled on the
  yoke. As first rendered it read from the side as a flat-topped box. The standing collar behind the
  head went with the helms: it poked through the hood's sides.
- **Consequences:** the game is public, so a look-alike of a film character was not built; the owner
  was told so with the sheet. The yoke is rigid on the chest, so a raised arm passes under it (as the
  hero's mantle). The hood is rigid on the head joint (no springs): its drape turns with his head
  over the yoke. The hero is hooded too; his hood is pushed back off a face and gold hair, the
  lord's is closed over the brow round a faceplate. His drawn body is 32 % larger than his hurt
  spheres (was 20 %).

## ADR-085 — How the Starless Lord moves: the glide, strings that walk, three more spells (2026-11-14)
- **Context:** the owner asked for better animation, movesets, spell and force effects and motion. On
  film a man in full plate sprinting at 9 m/s on the hero's run cycle looked wrong; every cut of a
  string re-planted the same foot; a spinning cut turned the hips a full turn over planted feet; and
  his spells were few strokes each.
- **Decision:** (1) **He does not run.** Past 3.4 m/s in footwork the animator takes his own `glide`
  clip (not a walking clip: no foot planning), lord.js lifts the root 0.22 m and a wake streams off
  under him; his backstep and sidestep are carried the same way. Inside striking range he walks.
  (2) **Strings walk and turn:** cuts alternate the driving foot, a spin's feet go round with the
  body on a hop, two new aerials (a cartwheel cut, a backflip that throws crescents), a flourish per
  form in the recovery of its main strings, a slower and deeper breath in the guard. (3) **Four new
  moves and three new spells** that need no new hero state: the Crushing Dark (a red line; the catch
  is a knockdown under a closing seal), the Rift (fissures along the floor: crescents with their own
  look), the Dark Star (a marked ring that follows the hero until its cue). (4) Every spell's
  effect was redrawn (fx.js); a pilot may raise the cloth's updraft, so his cape lifts through a cast.
  (5) Found on the way: a waiting duelist stood in his guard (the animator's reset came after the
  brain's and went back to the walking clip): both bosses now wait in their clip (he sits, Shen Hui
  kneels).
- **Consequences:** the grip is the pin, not the "lifted and held, mash to break free" grab the
  roadmap sketched: that needs a hero state of its own. 37 moves (was 31); on main's faster chain
  and guard (ADR-075, ADR-080) the 85 % bot takes 315 damage (was 325 at his release) and the 70 %
  bot 692 (was 740): about as hard, not re-tuned against a human. No sounds of their own for any of
  it yet. A flourish is the first half of its recovery only: past `guard.recoverOpen` (ADR-080) his
  guard is up again and he may ward or step out of the rest.

## ADR-086 — The free hand: a wrist, sword fingers, a choreography for every cut (2026-11-14)
- **Context:** the owner: the free hand "looks unnatural and weird during the attack animations",
  "stiff, like a mannequin", and "the hand itself" is wrong; the style they chose is sword fingers.
  Measured: the hand was rigid on the forearm (no wrist), swapped open/fist at `twoHand` 0.6 with a
  9-21 cm pop, locked the off elbow at 152-176° on the grip, ping-ponged the elbow 47° ↔ 126° between
  keys, and moved with no counterbalance to the blade.
- **Decision:** (1) A **wrist joint** for the free arm (`arms.L.wrist`, `arms.L.point` at the
  fingertip), turned only for the hero (`HeroAnimator` `opts.freeHand`; the duelists keep a rigid
  hand) by a spring inside human limits (`WRIST_L`), sub-stepped at ≤ 1/120 s so it is stable at any
  frame rate. (2) The **sword-fingers hand** (`heroGeo.swordFingers`): index and middle straight and
  pressed together, ring and little folded into the palm under the thumb, 1.3× long (`BODY.fingerEx`)
  so the point survives the glyph pass; shown by the pose's hand shape `hs`. (3) Four pose channels
  (N 53 → 61): the fingers' direction `lD`, the palm's normal `lN`, `hs`, and `lk` (rest the hand on
  the sword wrist). (4) **A choreography per cut** (swings.js `FH` places and keys): the hand gathers at
  the sword wrist in the windup and is thrown opposite the cut through the follow-through; overhead
  only rarely; authoring rules written into swings.js. (5) **The grip without pops:** the fist shows
  only once the hand is within 3.5 cm of its place on the grip (kept to 5 cm, 8 cm in a fully
  two-handed pose); `LOCK_REACH` 0.98 keeps the free elbow ≥ 23° bent on the grip. (6) One builder,
  `gear/hands.js` `buildFreeHand`, for every outfit's arms (the sword fingers included).
- **Consequences:** the duelists' animator carries the new channels but ignores them (their wrist is
  identity every frame: DUEL and LORD check). The wrist sits on a limit through much of the falling
  backhand, the falling cut and the whirl (the keys ask for more turn than a wrist has); tune those
  keys in the Lab close-up if it reads stiff. HEROHAND (H1-H14, H5b) guards the contract: the turn
  per frame, the limits, the fingers out of his body, the fist's distance, 30 fps stability.

## ADR-087 — Weight and footwork: the body leads, the edge bites, the feet stay planted (2026-11-14)
- **Context:** the owner asked for "weight and impact" and "footwork and body". On film the hips,
  chest and hand peaked together (0.150 s), a light's step glided past its plant, planted feet skated
  7-30 cm through turns, the whirl skated its planted foot about a metre, and a landed hit changed
  nothing in the body.
- **Decision:** (1) A light's **step is shaped** (`TUNE.lungeShape`: push off, brake at the plant),
  with the root filter's lag pre-compensated inside `_integrate` (`atk.shaped`, `svx`, `svz`).
  (2) **The body leads:** the hips by 0.033 s, the chest by 0.017 s (`anim.leadK`, faded at a held
  coil); anticipation and overshoot keys (body only); bow stances on the thrusts and falling cuts.
  (3) **The bite** (`atk.hitAt`, per-def `bite`): through the freeze the blade holds where it bit, the
  grip pulls in along it, the hips drop, the chest folds and the head nods; then it tears through over
  0.08 s of the swing's clock. The cleave bites hardest (1.5) but folds neither chest nor head
  (swings.js `fold` 0: its upright blade stands before his face). A guarded strike never bites.
  (4) **Planted feet** pivot on the balls of the feet, the rear foot holds, drags its toe when
  stretched and follows in one step; the return to stance moves the foot that stepped. (5) **The
  whirl hops** (`spinFeet: 'hop'`): each foot is carried round from where it stands, tucked in the
  air, and the turn overshoots ~14° and settles.
- **Consequences:** a short click now steps the whole lunge (~35 % further than before in real play:
  a feel check on the phone). The hit segment's far end moves up to 46 cm (lights) and 62 cm (whirl)
  against before; REACH is unchanged (38 ok). `carry` stays a code option for the whirl, for an A/B.
  HEROWEIGHT (W1-W11) guards the lead, the bite, the plant, the drag and the hop.

## ADR-088 — A cut that lands where it is drawn (2026-11-14)
- **Context:** a landed cut's effects were spawned at the hit test's point, on the upright, unleaned,
  unscaled gameplay bodies: at the game camera they sat 13-65 px off both the drawn blade and the drawn
  body, and a big white star hid both fighters in the freeze.
- **Decision:** (1) The **drawn contact** (`player._contactPoint`): the drawn blade's stretch met with
  the boss's drawn hurt spheres (`drawnPoint`, `drawScale`), moved onto the body; on a duelist it moves
  with his shove. (2) **The contact effect** per weight (`combat.js` `contact`: light, sweep, point,
  slam, cleave, execute; `cutFx.js`): a slash line laid along the cut, a tick across it on a crit or a
  puncture, sparks thrown along the blade's travel. (3) **The steel:** a flare at contact
  (`player.bladeFlare`), a glint up the leading edge, a flash along it held through the freeze.
  (4) **The camera:** a kick along the cut (`cameraRig.kick`, sprung back in ~0.25 s; the mouse ray
  leaves it out) and a punch on every landed cut. (5) **Sound:** a `cut` layer (a slice and a ring
  per weight) over the body's hit; none for a guarded strike or a slam's shards. (6) A struck duelist
  **shudders** through the freeze (drawn only; a sword cut's only; his trail pauses). (7) Cosmetic FX
  noise draws from its own random streams, so effects never shift the AI's seeded stream.
- **Consequences:** the lights' freezes are a hair longer (0.055 s, was 0.05). The particle pool peaks
  at ~396 through a mashed chain (the arc trail dominates, as before). CUTFX checks the drawn contact
  within 0.15 m of the drawn body in the frame the freeze holds.

## ADR-089 — Outfits and sword looks as options until the owner picks (2026-11-14)
- **Context:** the owner wanted a new look and asked to be shown options. The hero must stay distinct
  from the Ash Disciple (no douli, no red tassel) and keep the moonlit cyan/violet longsword.
- **Decision:** (1) Three outfits behind `?heroLook=` (gear/looks.js `HERO_LOOKS`; the `?lordLook=`
  precedent): the **Moonlit Robe** (a high-low robe, violet sash, silver guan), the **Swallow** (a short
  jacket, swallow tails, a moon scarf, bare forearms), the **Moon Warden** (lamellar, a left pauldron
  and capelet, a headband and ribbon); each also as `<id>-shade` with the face in shadow (the lit faces
  read as a gold disc at the game camera). Today's look stays the default. (2) Three sword looks behind
  `?sword=` (gear/moonblade.js): **sheet** (a clean leaf blade on the swept guard), **ribbon** (the same
  with a strip of the cloak's hem off the pommel), **crescent** (a silver crescent cradling the star
  gem). (3) Supporting engine: per-rig tints (`tintHero`: one rig's materials, never the shared
  uniforms), `setLoadout` restores the shared part ink even when the build throws, cloth `inMax` (no
  swinging into the wearer) and `floor` (ends kept over the grass in a roll), shell arcs, data-built
  sheets (`gear/sheet.js`).
- **Consequences:** (superseded in part by ADR-090: the owner keeps all of them as options for later,
  with today's look and sword as the default.) As first planned: after the picks the winners become the defaults, and the losers, both
  switches, their Lab rows and the CLAUDE.md line go (a non-default sword also drops the `blade.*`
  Blender parts). The tints recolour the hilt's trim and leather per outfit. LOOKS guards each look's
  cost (≤ today's meshes, ≤ 26.6k triangles, ≤ 21 draws), its cloth above the grass and its colours on
  its own rig.

## ADR-090 — Arms that open and swing; the charged blade clear of his face; a fist that is a hand (2026-11-14)
- **Context:** the owner on the preview of PR #29: "the right hand looks very disfigured", "when
  charging, the sword is piercing the characters face", "something about the arms still feel
  unnatural and stiff"; and the outfits: "keep the new skins for now to be used in the future. we
  will use the current todays look for now as the default". Measured in the chest's own frame (the
  drawn figure is sheared toward the camera and scaled: world angles lie): (1) the fist (`gripFist`,
  every rig since ADR-041) was four thin discs with a plank across them: up close a spring, not a
  hand. (2) In the charge the blade stood 0.10 m from the head's axis, 3-7 cm INSIDE the hood (the
  hood's radius is 0.13-0.17 m): it leaned back toward a head that leans forward. (3) His clips ask
  for the hand at 0.94-1.01 of the arm's length at a cut's contact and a thrust's end, and the soft
  reach (ADR-044: `ARM_SOFT` [0.78, 0.955]) turned every one into an elbow of 124-130°: the arms
  never opened. (4) On the run both elbows pointed 0.47-0.73 out to the side (arms akimbo from the
  front) and the free arm was one rigid 87° crook; and the arms' swing followed the fore-aft move
  direction alone, so strafing with the aim held elsewhere (most of a fight on the mouse, or locked
  on) they hung still.
- **Decision:** (1) **The fist:** finger rolls nearly as deep along the grip as they are apart (one
  hand with shallow grooves) and a rounded back of the hand; for every rig. (2) **The charge:** the
  hands lower and out to his right (`rH` −0.10, −0.11, 0.31), the blade leaning OUT (az −82°, not
  back), less of a bow; the cleave's first keys match and wind back out over the shoulder. The blade
  passes 25 cm from the head's axis through the hold and 21 cm through the release. (3) **The hero's
  reach** (`HERO_SOFT` [0.93, 0.99], `opts.freeHand` only): the elbows open to 143-159° where a clip
  asks for a full reach and never lock (163° at most); the sword arm blends back to `ARM_SOFT` by
  `twoHand`, so the free hand can follow the grip (the slam's and the cleave's gaps are unchanged).
  (4) **The run:** elbow poles back beside the ribs (rest too), the free hand's back swing reaches
  down and back so the elbow opens behind him and folds in front (56° a stride), and the hand is
  open on the move. The swing's sign is the fore-aft direction he last moved in, latched through
  sideways and eased (`anim.armSign`), so the arms swing in a pure strafe (27 cm; 0 before) and do
  not jump when the direction flips. The sword arm rides the stride backing away too. (4b) **The
  guard** breathes and rides the walk (it was rigid from the hips up); **the way home** from a
  swing starts earlier and lands on a smootherstep (both arms whipped home at 6-7 m/s and stopped
  dead on one frame). (5) **The free hand:** sword fingers
  1.15× (1.3× read as claws up close); the `wing` place slopes down from the shoulder (level, it made
  a scarecrow of the whirl's and the flat backhand's finish). (6) **The outfits and sword looks stay**
  as options behind their switches for later use; today's look and sword are the default (ADR-089's
  "temporary" no longer holds).
- **Consequences:** ADR-044's "the elbow keeps ~35° at a full stretch" now holds for the duelists
  only; the hero keeps ≥ 15° (HERO asserts it; it was 23°). His sword hand reaches up to ~3 cm
  further at a full stretch. `loco()` and `guard()` are shared with the duelists' footwork, so the
  hero's free-arm numbers there are gated on `A.freeHand`: the Ash Disciple's running arm is
  bit-identical to before (tucked in like the hero's, his sleeve ran into his ribs). A swing's
  finish is held ~30 % shorter before he comes home. HEROARMS guards the rest pose, the run, a pure
  strafe, the opening at contact, the lock bound and the charged blade's clearance.

## ADR-091 — A streak of perfect dodges is answered blow for blow: the flurry (2026-11-14)
- **Context:** a perfect dodge had one answer for each kind of boss: the plunge onto the wyrm's head
  (ADR-027), a blink behind a duelist (ADR-061). The owner: "more different perfect dodge animations
  instead of the same one of just teleporting on top and stabbing the head or behind the enemy ...
  if the player keeps doing more successful perfect dodges in a streak, make the attack also hit the
  # of attacks the player is on a streak ... epic anime with good visuals, animation, and impact".
- **Decision:** (1) **A streak.** Perfect dodges in a row count up; a blow that hurts ends it.
  Blocks, parries, plain dodges and time do not: the rule a player can hold in his head is "do not
  get hit". (2) **N blows for a streak of N** (7 at most): N − 1 **flash cuts** and one **art**
  (`player/flurry.js`). A flash cut is one primitive for every target: blink to one side, cross the
  target, blink away, each along a new line. The lines **hang** on the target and burst together on
  the last blow, so the count is on the screen as a figure, not only as a number. (3) **Six arts**,
  three for a head in the air and three for a foe on the ground, in three shapes (a level draw cut
  whose hit lands late, a falling cleave, a rising cut and vault) plus the plunge, which stays as it
  was and is now one art of the wyrm's three. One is picked at random with the animator's noise,
  never the same twice running. (4) **The world is held, the hero is not:** a hit-stop at 7 %
  re-armed every frame, while the flurry, the animator and the cloth step on real time. The boss
  stands in his blow while the cuts land; a flurry of seven costs two seconds of the player's time
  and a seventh of a second of the fight's. (5) **Fixed damage:** a flash cut 28, final; the last
  blow the plunge's 90 against the wyrm and 60 against a duelist. The answer grows by a light
  attack for every perfect dodge in the streak. (6) **It asks nothing new of a boss** but two
  optional fields on `takeHit` it already had (`exact`) or ignores (`flash`).
- **Rejected:** *A timer on the streak* (a combo meter that drains): the wyrm's transitions and
  flights leave ten seconds without a blow to dodge, and a streak lost to a cutscene is not the
  player's failure (`keepStreak` is there, at 0). *Ending the streak on a plain dodge or a block:*
  it would punish the safe answer to a blow that cannot be perfect-dodged. *N plunges in a row:* the
  plunge is 1.7 s of its own and its reaction cancels the wyrm's attack once; repeated it is neither
  fast nor readable. *The slow-mo's own time scale for the hold* (`flow.cinematic`): it slows the
  particles with the world, and the cuts' sparks must fly. *Blade trails off the sword's sweep
  during a pass:* carried a metre a frame, the frame-to-frame arc is a wide curl unrelated to the
  cut; the cut's crescent is drawn on purpose instead. *Damage that multiplies with the streak:* a
  player who is never hit would end the fight in a few dodges.
- **Consequences:** against a duelist a perfect dodge now deals damage by itself (60, past his
  guard) where it only offered his back: his fight is a little shorter for a player who dodges
  well; not re-tuned. The first perfect dodge of a streak against the wyrm is the plunge one time
  in three. A streak never runs out, so a player who is not hit answers every perfect dodge with
  seven blows (258 of the wyrm's 4500 HP). Round the wyrm's head the cuts are drawn 3.5 m toward
  the camera (glyph particles are depth-tested, and a line through the head showed only where it
  left it). The hero's body does pass through the target in a pass: it is a blink, and nothing
  collides until the flurry ends. `player:perfectDodge` + `player:ghostep` still fire once per
  perfect dodge, and the wyrm's last blow still emits `player:plunge` / `player:plungeHit`, so the
  stats, the call-outs and the sounds that listened to them did not change.

## ADR-092 — The wyrm in large, readable letters; a grid that travels with it (2026-11-14)

**Context.** The owner: "im not feeling the ascii art style to the fullest". A look at the three
levels at the game camera showed why: most of what is on screen is drawn in marks too small to read
as characters (the wyrm's 3x5 px digits, the fighters' 3x3 dot marks) or too overlapped (the grass).
Three wider options were rendered (a typed lattice ground, the hero in the wyrm's letters, a terminal
finish) and the owner scrapped all of them: "make the dragon, bosses, look more ascii like" and add
bigger background objects full of ASCII. The wyrm was then rendered at three larger letter sizes
(6x10 symbols, 8x13 symbols, 10x16 pixel digits); the owner picked the 8x13 one.

**Decision.**
- The wyrm's letters are the game's bold monospace in cells 1/55 of the screen height (8x13 px at
  720p; `wyrmArtCell(H)`), three sets by brightness of symbols and blocky capitals (`WYRM_SETS`).
  The thin 4x6 / 3x5 pixel fonts are removed.
- A wyrm cell averages a 4x4 grid of its source (16 more taps, only in cells on the wyrm) and a
  letter takes 30 % of its tone from its own pixels (was 85 %).
- The grid is anchored to the boss's root on screen (`U.uBossScreen` → `uWyrmAnchor`).
- Tone back to the picked preview's: bright and dense (`uArtLum.y` 4.5, `uArtMin.y` 0.1, gamma 0.8,
  set steps 0.1 / 0.34). The art source (WYRM_ART) is unchanged.

**Why.** At 4x6 px a letter cannot be read at the game camera, so the wyrm was a texture; at 8x13 it
is about 25 readable characters across, which is what "ASCII art" means to a viewer. Point-sampling a
13 px cell over scales a few px wide gave every cell a random tier. A screen-fixed grid of big
letters re-letters the whole body whenever the camera moves: measured in the wyrm's own frame, 63 %
of its lit pixels change per 0.1 m of camera travel against 13 % anchored.

**Rejected.** A darker, steeper tone (truer to the charcoal reference, but the body turned into sparse
punctuation on black: less ASCII than what was picked). Larger scales in the source (x1.8, x2.6: no
visible gain at this letter size). Black cells at depth steps (they cut holes in the body). The
6x10 and 10x16 sizes (the owner's call).

**Consequences.** The fine scale outlines of the 2026-11-08 reference match are gone from the game
camera: a scale is about two letters, its rim a brighter letter. The reference-view targets in
STYLE.md were measured for the thin digits and are not re-measured. The human bosses and the hero
still use the 4 px dot matrix (a sheet of three sizes was rendered; at their ~70 px height only 5x8
letters hold a figure; no pick yet). Not checked: 1080p and above (the hidden pane timed out), the
frame rate on a phone (16 more texture reads per wyrm pixel), the flight and the dives in motion.

## ADR-093 — The wyrm in fine digits again, one size up; the calm tone back (2026-11-15)

**Context.** ADR-092 printed the wyrm in large bold symbols (8x13 px cells at 720p, bright tone).
Live, the owner: "the dragon is way too flashy right now and the ascii text is too big. use more
smaller and make the ascii graphics detailed instead of huge flashy like this". Three smaller
options were rendered in game with the calm tone of the old thin digits (4x6, 5x8 and 6x9 px cells
at 720p); the owner picked 5x8 ("B, medium").

**Decision.**
- The wyrm's letters are pixel fonts again (`WYRM_FONTS`: the 3x5 and 4x6 fonts of ADR-018 and a new
  5x7 one), in cells about 1/90 of the screen height (`wyrmArtFont(H)`: the font and integer scale
  whose cell height is nearest H / 90): 5x8 px at 720p, 6x9 at 1080p, 4x6 on a 393 px phone. The
  letter sets are the old digit sets (`17iv!;r27` / `2345968017` / `96805A@3`).
- The tone is the old calm one: `uWyrmTone` 0.95 / 1.3 / 0.022 / 0.85, `uWyrmGlyph` steps 0.12 /
  0.42, `uArtLum.y` 2.2, `uArtMin.y` 0.012.
- Kept from ADR-092: the grid anchored to the boss, and the 4x4 average of a cell's source for its
  letter tier.

**Why.** The owner judges the wyrm at the game camera, where detail (scales, joints, wing bones)
matters more than reading single characters; a bright body of big symbols hides the scales and
glows. 5x8 is one step up from the pre-ADR-092 4x6 cells at 720p, so the digits are a little more
legible than before without losing the scale pattern. Pixel fonts keep every letter crisp at these
sizes (a browser font closes up into blots under ~10 px).

**Rejected.** 4x6 cells (the old size: the most detail, unreadable letters), 6x9 cells at 720p
(scales start to break into letters), the large symbols (the owner's reversal).

**Consequences.** The 1080p cell (6x9, H / 120) is relatively finer than 720p's (H / 90): no pixel
font gives an exact 7.5x12. ADR-092's large-letter atlas and its glyph check are gone; the check now
verifies every set letter has a bitmap in each font and the cell per screen height. The human bosses
and the hero are unchanged (their letter size is still the owner's open pick).

## ADR-094 — One streak for every perfect defence; the riposte; a foe's streak and his flurry (2026-11-15)
- **Context:** the flurry (ADR-091) answered perfect dodges only, its cuts landed while the world
  stood still (the target never looked hit), and only the hero had it. The owner: "add some weight,
  hitstun impact to the teleport attacks and make it ... way more epic ... add this streak system to
  parries clash deflects as well. Also give the streak system and attacks to bosses as well ... if
  the boss is on a high streak, the player needs to parry / block the total # of attacks". Asked,
  the owner chose: one shared streak; a counter flurry on a string's last parried blow; duelists
  build theirs by guarding; answering every blow breaks his posture.
- **Decision:** (1) **One streak.** A parry or deflect (not of a bullet), a trade clash and a mikiri
  count in the same streak as a perfect dodge. (2) **The riposte.** A parried LAST blow (of the body
  or the blade, the target near) is answered with as many flash cuts as the streak counts and puts
  the hero back where he parried: no art, no crit window, no plunge. It waits for the parry's own
  freeze, so the clash is seen first, and a blade lock takes precedence. Parries inside a string
  only count: a string is still parried blow for blow. (3) **Weight.** The flurry SETS the world's
  time scale instead of merging a hit-stop: after every cut the world runs at 60 % for a beat, so
  the target reels where it was only held; the hero freezes on each contact; the camera kicks harder
  with every cut; the last blow gets an impact frame (speed lines, a dark blink, a flash, screen
  cuts in the HUD), breaks the ground and staggers a duelist. (4) **A foe's streak** is the mirror:
  a duelist counts the strikes his guard turns, loses the count when one lands, and from three may
  answer out of his guard with a flurry of that many blows, each of the later ones from another
  side of the hero. A guard meets them from any side (`hit.around`), so it tests rhythm, not
  facing. Every blow answered breaks his posture; a missed one breaks nothing and stays in his
  streak. It is a move like his others (data, a tell and a glint for every blow, the realiser
  given a count), not a second engine.
- **Rejected:** *An art on every parried last blow:* a parry would then deal the plunge's 90 and
  cancel the wyrm's recoil, and the dodge would have nothing of its own. *A riposte on every parry:*
  it would cut a string off at its first blow. *Blows of his flurry that must be faced:* the hero
  turns to the mouse or a stick, and a blow from behind every half second would be a test of the
  camera. *The wyrm with a streak:* it has no guard to build one on (the owner's choice: duelists).
  *A perfect dodge of his flurry counting as an answer:* the owner asked for parries and blocks; a
  dodge still avoids the blow.
- **Consequences:** a string parried in full now gives its length to the streak, so the cap of seven
  is reached in two exchanges; a riposte of seven is 196 damage on top of the punish window. Wyrm
  strings now say which blow is their last (`last`), so the hero's parry of an earlier one takes the
  shorter freeze a duelist's always had. A player who only ever strikes a duelist's guard is
  answered with his flurry about every third strike. Nothing was re-tuned. `player.debug.noRiposte`
  switches the riposte off (tests that measure a parry's own numbers).

## ADR-095 — A guard meter that is not stamina (2026-11-14)

**Context.** The owner: "add a guard meter and any parry will restore guard meter. I don't want this
game to be annoying when the guard meter is empty so let it replenish quickly when not taking damage
or attacking as I don't want to punish the player for playing defensive." Until now a held guard
cost HP: a blocked blow let 20 % (normal) or 50 % (blue) of its damage through, and nothing else
limited how long a guard could be held. Asked four questions, the owner picked: at empty the guard
is knocked open (not a leak of damage, not the full guard break); no HP chip while there is guard
left; attacking does not pause the refill; and hits that land restore guard as parries do.

**Decision.** `GUARD` in `combat/rules.js`, `player.guard / maxGuard` (100).
- A blocked blow costs guard (damage × 1, blue × 1.5, clamped 8 – 60) and no HP.
- The blow that empties the meter is blocked, then knocks the guard open: `player:guardOpen`, the
  state `stagger` for 0.55 s in the guard break's opening pose (the same clip, without its
  knockdown), no damage.
- Refill 60 / s from 0.8 s after the last blow blocked or taken (0.35 s after an opening), in every
  state. A parry gives 28 / 45 (bullet 10, perfect + 20), a landed cut 4 / 10.
- Contact streams and bullets (hits with no knockback) keep the old HP chip and do not touch it.
- HUD: a thin steel bar under the HP bar with no number; on touch also a gauge on the BLOCK tile.

**Why.** The meter has to make a held guard a decision without bringing stamina back (COMBAT rule
1): so nothing the hero does spends it, only blows do, and the refill never waits on his own
actions. Empty costs half a second, not HP and not a knockdown, which is the least a break can cost
and still matter inside a string (the next cut, 0.4 s on, lands). Moving the cost of a block from
HP to the meter is what makes the meter worth reading: with both, a block would be taxed twice.
Parries and hits giving guard back reward the two things the game wants more of than turtling.
Streams are left out because seven ticks a second would either empty the meter in a breath or need
a second set of numbers.

**Consequences.** A blocked blow no longer hurts at all, so a careful player takes less damage than
before; the bosses were not re-tuned. `player:block` reports damage 0 for a blow (the chip is still
reported for streams). The duelists' AI does not know the meter exists (it does not press harder on
a low guard). The guard-open stagger reuses the guard break's pose: a pose of its own may read better.

## ADR-096 — The right thumb's pad: three tiles that touch, slide between them, placed by the player; a lock marker that fades (2026-11-14)

**Context.** The owner, playing on an iPhone: "the right side controls are too far bottom in the
right corner so my right hand is uncomfortable since i have to hold it at the corner. Im having a
hard time shuffling between attack dodge and block." ATTACK's middle was 66 px in and 68 px up from
the corner (about 11 mm each way on the phone), and the three buttons stood apart with 20 – 30 px
gaps, so every switch was a lift, a reach and an aimed landing. Also: "make the target lock icon be
subtle and slowly fades away as i hate games that show the lock target icon". Of three ways to
switch (slide between tiles, a flick for the dodge, both) the owner picked the slide.

**Decision.**
- ATTACK, BLOCK and DODGE are three rectangular tiles of one cluster, each sharing an edge with both
  others (ATTACK 98 × 92 bottom right, BLOCK 98 × 62 on top of it, DODGE 70 × 116 down their left
  side), with ATTACK's middle about 97 px in and 98 px up by default.
- The cluster is one pointer surface. A touch on or near it presses the nearest tile; a thumb that
  slides onto another tile releases the first and presses the second (a 10 px stick so a resting
  thumb does not flicker across a border).
- The layout is data (`CONFIG.touch.pad`) and the hit test reads the same numbers the tiles are
  placed with. The player picks one of three positions and three sizes in the pause menu; the
  choice is kept in `localStorage`.
- FLASK rides with the cluster but is its own button a gap away (a slide must never drink). LOCK
  moves to the top right beside pause: on touch the aim is automatic, so it is pressed rarely.
- The lock-on marker is a small dim diamond that shows when the lock is taken and fades out in 3 s.

**Why.** Three tiles that all touch make every switch one short move with no gap to cross and no
third tile in the way (a 2 × 2 grid would put FLASK or ATTACK under a diagonal slide). Nearest-tile
makes a slightly missed landing still count. Where a thumb rests differs by hand and by grip and a
screenshot cannot settle it, so the default is a guess moved well out of the corner and the player
has the last word, on the device. The slide's rules follow from the input layer: a release edge and
a press edge are what a lift and a tap would have sent, so the player code needed no change (a
guard press already cancels a swing, ADR-080).

**Consequences.** Sliding off ATTACK while a charge is held releases the cleave (and the guard or
roll then cancels it). A thumb resting on a border can still cross it by more than 10 px by
accident; `pad.stick` is the knob. The marker gives no lasting sign of the lock in the world; the
player frame's label and the LOCK button do. Not tried on a real phone by anyone but the owner.

## ADR-097 — Played upright too; controls drawn on the game, not over it; a minimap the size of a coin (2026-11-14)

**Context.** The owner, after the pad of ADR-096: "Allow the game to be played in non landscape as
well and adjust the ui to allow that. Make the joystick and right buttons to blend in with the game
so the buttons aren't covering the game screen. The mini map is also covering a lot of the screen
on mobile." Until now a phone held upright got a "rotate your phone" overlay and a pause. The
controls were dark filled panels (46 – 72 % black) and the minimap a framed panel of 114 × 130 px
with a title and coordinates, on a screen 393 px tall.

**Decision.**
- **Upright is a layout, not an error.** The overlay and its pause are gone. The stick's zone is the
  lower left, the pad sits lower right (its three places from `pad.posPortrait`), the frame and the
  boss bar go to the top, the menus take the screen's width.
- **The camera opens instead of cropping.** With a fixed vertical field of view an upright phone
  would see a strip 5 m wide. `fovFor(aspect)` keeps the view as wide as a square window's (the
  vertical field of view goes from 32° to about 64° on a phone), and the upright phone profile
  stands 1.2 × further back and looks 1.5 m south of the hero, so he stands a little above the
  middle with the fight above him and the thumbs below.
- **The controls have no fill.** Transparent tiles with a hairline border and corner brackets,
  glyphs with a dark halo, at 62 % (the stick at 40 %, without its dark disc or its MOVE tag); the
  "tap: parry" sub-label is gone. Under a thumb a control goes to full strength with its ember tint.
- **The minimap on a phone** is a bare 70 px disc at 72 %: no panel, title or coordinates. LOCK and
  pause sit beside it.

**Why.** The arena is a ring with one boss in it: on a phone the minimap answers a question nobody
asks in a fight, so it gets the least screen that still shows which way the boss is. Controls that
are found by where the thumb already rests do not need to be read, only to be findable at a glance
and to confirm a press, which outlines and a lit state do. Opening the field of view was chosen
over pulling the camera back (the hero would be a few glyphs tall) and over letterboxing (wasted
screen): the upright view shows as much width as the landscape one shows height.

**Consequences.** Upright, the view is about 14 m wide against 25 m in landscape: the wyrm does
not fit across it and the keep-in-view pan works harder; nothing was re-tuned for that. Faint
controls can be lost against bright ground (a lit pillar behind the pad); the halo helps, and the
rest opacity is one number in `ui/touchStyle.js`. A desktop window dragged taller than wide also
gets the wider field of view. Not tried on a real phone.

## ADR-098 — An ASCII HUD: meters made of characters, block-letter banners, no panels in play, a minimap that barely exists (2026-11-14)

**Context.** The owner: "Make the minimap much smaller and opaque on mobile. Theres no need for
mini map in general for this game so lets make it small overall on both desktop and mobile ...
Also think of ways to improve the ui design and layout and to also incorporate the ascii art style
as well to fit the ascii theme." The HUD was the first version's MMO-style overlay: a framed player
panel with a name, "Lv 12" and a class line, smooth gradient bars, a serif book font for the boss's
name and the banners. Nothing in it was made of characters except its labels. Asked first: the
minimap tiny and faint ("opaque" meant see-through); the log, the name tags and the key hints
stay, the name plate goes. Three HUD looks were then built and rendered in the game on desktop and
phone (bare glyph lines; the same rows in boxes drawn with + - |; a roguelike status line along
one edge), and three ways to draw the big words (block letters in the logo's letterforms; the same
shapes in # only; spaced monospace capitals). The owner picked the bare lines and the logo-style
blocks.

**Decision.**
- Every meter is text (`ui/glyphBar.js`): fill, the piece just lost, the empty rest, in brackets.
  `ui/bars.js` (the scaled-div bars) is deleted.
- In play nothing has a panel. The player's rows and the boss's are drawn on the game with a dark
  halo. The name plate is removed.
- The banners' words are block letters from one font table (`ui/blockText.js`), the title logo's
  letterforms, fitted to the window's width and stacked on a narrow one. The boss's name, the mini
  banner and the pause title are the game's monospace. The serif font leaves the HUD.
- The minimap is a 72 px disc at 60 % (40 px at 50 % on phones) with no frame, title or
  coordinates, on every device.
- Menus and the desktop log keep their bordered panels.

**Why.** A HUD of smooth bars and a book font sat on top of an ASCII game like a different
program. Characters for the meters cost nothing in legibility (a row of 24 cells reads to about
4 %, and the number is beside it) and make the overlay the same material as the world. Dropping
the panels follows the touch controls of ADR-097: the fight is the picture and the HUD is written
on it. The bare lines were the look that took the least screen on a phone; the frames spent it on
borders and the status line crowded one edge. Block letters come from the logo so the game has
one display face instead of two, and one table serves every banner.

**Consequences.** A meter moves in steps of a cell, not smoothly: the boss's 48 cells are about
2 % each. Text with no panel behind it depends on its halo over bright ground. The block letters
have A – Z and a little punctuation: a banner with a digit or another mark loses that character.
Tablets and the Obsidian Throne were not looked at. The owner picked from stills; the meters were
not seen moving by anyone but me.

## ADR-099 — Training: every situation, one click, played by the game's own input (2026-11-15)
- **Context:** the owner: "Make a lab mode to easily tell every situation with a simple click ... see
  every streak animation and effect between the character and bosses ... every situation i would
  want to test in a list by category like a fighting game lab mode in a cool lab background/stage".
  The Lab could trigger a boss move, but every answer (a parry at the right frame, a perfect dodge,
  a streak of seven) had to be played by hand.
- **Decision:** (1) **Situations are data** (`dev/training.js`): a category, a boss filter, the
  set-up (distances, streaks, art), how it starts, how the hero answers, when it is over, and what
  it must show (`expect`). (2) **The runner plays the hero through the input's virtual keys** (the
  touch controls' path), timing each answer off the boss's own glint (`combat:flash` + the boss's
  flash lead), so what plays is the real game, not a shortcut through the hero's methods. (3) **The
  same catalogue is a test:** the three sims run every situation for their boss and fail on one that
  does not show what it promises. (4) **A lab stage** (`?stage=lab`) puts any level's boss on a
  training room with a measuring grid; it wraps the level (the same boss, the room's set and
  layout), so no boss needs to know about it. Three looks were built (a pale Grid, a dark Holo of
  cyan light, a starry Void without walls); the owner picked **Holo**, and the other two were removed.
- **Rejected:** *Calling the hero's methods directly* (`_parry`, `_startRoll`): faster to write,
  but it skips the input, the buffers and the timing windows, which are what a situation is meant to
  show. *One stage per boss:* the duelists keep to their own rectangles and bounds, and a stage that
  wraps any level keeps them all. *A separate page:* the Lab already owns the debug APIs; Training is
  one more view on them.
- **Consequences:** the BOSS MOVES category grows by itself with every new move. A move of a later
  phase puts a duelist into that phase without its transition; the wyrm takes any move in any phase.
  The Starless Lord seated on the training room's floor (no throne) only shows while the fight has
  not started. On the lab stage the courtyard's pillars and the hall's walls are gone, so a boss that
  relies on them (the Lord's hall bound) still keeps to its own numbers.

## ADR-100 — One art design: background objects in the dragon's look; landmarks (2026-11-15)

**Context.** After the wyrm's fine digits shipped (ADR-093) the owner: "all 3 levels need all the
background objects like the pillars and structures to look completely made of ascii characters.
Right now it looks like a normal object with random ascii pattern stickers put on top of it. There
should be no object or character that has this fake ascii look with empty blank spots". A first
answer (carved glyphs filled to every cell, floors too) was shown and turned down: "Lets not touch
the floor character and bosses ... The prod build is the perfect ascii look im aiming for. Apply
this design to all the background objects as well." Asked, the owner confirmed the small-digit wyrm
as the reference and kept the trees as they are. A whole-frame character grid in the manner of the
owner's gcdAtlas project was then prototyped at their request, previewed and measured; they chose
"dragon look and update any md file to ensure all future background and characters are following
the same art design".

**Decision.**
- **The dragon look is the house style** for every new background object and character. It is
  written as a rule in CLAUDE.md and as the first section of STYLE.md.
- **Prop art:** `FLAG.ART_PROP` (0.57) and `createPropArtMaterial`, a smooth lit source for static
  objects; a prop branch in the art pass prints it with the wyrm's atlas, cell and `artLetters()`,
  its own tone (every cell prints), stroke-glyph outlines on the silhouette and on inner depth
  steps, and a grid counted from the ground.
- **What moved to it:** the three sets' `stones` meshes (standing stones, boulders, pillars,
  lanterns, the stele, walls, the dais, the throne) and the small grid props (bones, the bonfire,
  the fallen bell, braziers).
- **Landmarks** (`world/landmarks.js`), all in prop art: the elder wyrm's skeleton (Cinderwood); two
  stone swordsmen, the sect gate, an incense cauldron (Ashfall); two throne wardens, six great
  swords (the Obsidian Throne). The Cinder Tree is a tree and stays on the screen grid.
- **Untouched by the owner's word:** floors (carved glyphs), the hero, the human bosses; trees.

**Why.** The carved-glyph objects read as stickers for four reasons found by looking: a lit slab
under sparse glyphs, blank or speck-filled dark levels, solid edge bands, and east / west faces that
smeared one lattice column into bars. The wyrm has none of these because the pass draws it: letters
are the only thing on screen, the edge is characters. Reusing its pass gives objects the same letter
size, sets and outline for free, and one place to tune.

**Rejected.** Filling the carved lattice (still a second glyph style beside the wyrm; turned down).
A whole-frame grid like gcdAtlas (feasible; measured about equal to the live game on a desktop GPU;
the fighters shrink to ~9 character rows, and it would replace the wyrm, hero and floors the owner
wanted kept). The wyrm's 16 extra samples per cell for props (a prop's source is smooth: the 4 that
find the cell are enough).

**Consequences.** Upright objects are screen-space letters now, not world-fixed ones: the grid is
anchored to the ground at the camera's focus, so letters hold on an object near the hero and drift
slowly toward the screen edges. `createCarvedGlyphMaterial` is for floors only. Cost, measured in
Chrome on an RTX 4090 in the throne hall (the heaviest view), median ms per frame: 1080p live 10.0 –
10.5, this change 9.1 – 12.5 (equal within noise); 4K live 24.9, this change 32.1 (one noisy run).
The pass reads 4 more samples per screen pixel; a phone was not measured. New colliders stand on the
arena rims. Not checked: the look in motion, a fight played around the landmarks, the phone.

## ADR-101 — The flurry on a man: paced to be followed; an afterimage printed in digits (2026-11-15)
- **Context:** the owner, after watching every flurry in Training: "the animation looks great vs the
  dragon but against the humanoid bosses, the teleportation attacks are a bit hard to follow and
  doesnt seem fluid and buggy. lets also leave a cool after image that fades always in a stunning
  transition effect per teleport and use ascii for the effects where you can as well". Measured
  frame by frame on Shen Hui (five blows, the Passing Cut): the hero crossed him at about a metre a
  frame and froze **on top of him** on every hit; he was in a pose worth reading for three frames a
  cut; the duelist was **shoved 0.32 m in one frame by every cut**, from a new side each time, kept
  his own attack's pose through the first cuts, and after the last blow **staggered back into the
  hero** who had landed behind him (and pushed him 0.36 m); the camera jumped 0.9–1.3 m on every cut
  and 4.6–5.3 m on the last; and the cuts' flares and 5.6 m hanging lines, sized for a head three
  metres across, covered both men. The afterimage was sixteen bone strokes: a few bright sticks.
- **Decision:** (1) **A second pacing for a target on the ground** (`DEFENSE.flurry.ground`; the
  wyrm's is untouched): seen wound up where he appears, in past the foe's side, the strike just
  before he is abeam, slowing into a held finish; a shorter line left on him; smaller effects; a
  gentler camera. (2) **A flurry's blows do not shove a duelist**: each cut flinches him where he
  stands and out of his move; the last staggers him away from where the hero ends (`away`).
  (3) **The afterimage is the hero himself, printed**: points of his own meshes in the pose he was
  last drawn in, one digit to a screen cell, falling apart from the feet up; on every blink some of
  them fly to where he reappears and more rush in onto him. All of it glyph particles (no new
  material, no draw call). Every blink uses it: the Ghostep, the plunge, the flurry, the riposte.
  Three looks were built (digits / echo / shatter); the owner picked **digits**, the figure alone,
  and the other two were removed with the Lab's button.
- **Rejected:** *Slowing the wyrm's flurry too* (the owner: it looks great). *A true copy of the
  hero's meshes as the ghost* (his art, exactly): a second set of bone slots in the rigid batch or
  ~140 draw calls a ghost; the printed figure costs one batch of particles and reads as ASCII, which
  is what was asked. *Keeping the shove but smoothing it:* the cuts are drawn crossing ON him, and a
  target that drifts from under them is the thing that read as a bug.
- **Consequences:** a flurry on a duelist is longer (five blows: 2.2 s, 1.75 s before; seven: about
  2.6 s). A duelist is interrupted by the first cut instead of the last (he was staggered at the end
  either way). An afterimage is up to ~390 particles for ~0.6 s; a seven-blow flurry peaks near
  1700 particles (800 before; the additive batch holds 7000).

## ADR-102 — The riskier the answer, the more it pays: the flurry on red only, the flash counter, a perfect parry that pays (2026-11-15)
- **Context:** the owner asked what would make the combat stand with Sekiro, Phantom Blade Zero and
  Onimusha, then: "yes measure and lets implement your suggestions". The suspicion: a perfect dodge
  worked on every tell, had the parry's window (0.20 s against 0.22 s) and paid the most (the
  flurry: damage, invulnerability, a stagger, the crit window, and the string over), while the
  trade clash, the riskiest answer, earned no opening. Measured with three god-mode bots that
  differ only in how they answer a tell (`strategy`, opt-in, in all three suites): the bot that only
  dodged beat every boss fastest with a third of the inputs (Shen Hui 27 – 32 s against 38 – 45 s for
  parries only; the wyrm 68 s against 149 s). Nobody had to learn a string.
- **Decision:** order the rewards by risk (COMBAT.md "The reward order").
  - The flurry (and the plunge) answer a perfect dodge of a **red** blow only (`DEFENSE.flurry.on`).
    A perfect dodge of a white or heavy blow counts in the streak and gives the slow-mo where the
    hero stands: no teleport, no damage, no crit window (`ghostep.critWindowWhite` 0), the string
    goes on. The streak is built on white blows and cashed on a red one or by the riposte.
  - **The flash counter** (`DEFENSE.counter`, Onimusha's Issen): a trade clash in the instant the
    hero's cut became a cut (≤ 0.03 s into its active frames) is not thrown back: 70 final damage and
    60 posture at once, the attacker reels (`attacker.onCounter`), the crit window opens,
    `player:counter`.
  - **A perfect parry** of a blow of the body or the blade deals × 1.5 posture (`POSTURE.perfect`)
    and readies the counter cut (`DEFENSE.perfectParry`: the next light within 0.9 s winds up twice
    as fast and crits).
  - Found on the way: a blow of a foe's flurry that reached nobody settled nothing, so "block all
    five and he breaks" could silently not happen. It now counts as answered when the hero stood
    within its reach + 1.2 m, and fails the flurry when he left.
- **Alternatives turned down:** a dodge cooldown or shrinking i-frames (the owner: defence must not
  be punished; nothing here stops the player from dodging); a 1.2 s crit window on a white perfect
  dodge (measured: the dodge bot still beat the wyrm fastest, in 63 s, on crits alone).
- **Consequences:** after the change the dodge-only bot is the slowest on both duelists (Shen Hui
  75 – 95 s, the Lord 152 – 161 s) and level with mixed play on the wyrm; mixed and parry-only times
  did not move. A perfect dodge of a white blow against a duelist no longer puts the hero at his
  back. The old rule is one switch away (`flurry.on: 'any'`, `player.debug.flurryAny`). Not done:
  the wyrm's claws are not steel, so the flash counter is a duelist's only; no human has played it
  (the counter's 0.06 s of press timing, the counter cut's feel); the Lab has no button for
  `flurryAny`; the flash counter was not filmed.

## ADR-103 — A frame is simulated in steps of about 1 / 60 s (2026-11-15)
- **Context:** the genre review (the owner: "lets implement your suggestions"; the game is to be
  sold on Steam, so it must play the same on any PC). main.js simulated every rendered frame in ONE
  step of its real length, clamped at 50 ms: a machine at 30 fps took 33 ms steps, in which the
  0.08 s perfect-parry window is sampled two or three times, an attack's 0.12 s active frames three
  or four, and under 20 fps the game ran slow. Every headless test steps at exactly 1 / 60 s, so none
  of that was ever tested.
- **Decision:** `core/timestep.js`: a frame is cut into equal simulation steps none longer than
  20.8 ms (1 / 60 s with a quarter of slack, so a 60 Hz frame a hair late and a 50 Hz display stay
  one step). 30 fps runs two steps of 1 / 60 s, 20 fps three; six steps at most, so the game runs
  slow only under 10 fps. The devices are read once a frame; the input's edges are cleared after the
  first step; the camera, the HUD, the audio and the render run once a frame. `__tick` keeps its
  exact single step (film strips) and gains `asFrame`.
- **Alternatives turned down:** a fixed 120 Hz step with render interpolation (the standard answer,
  and deterministic: but every transform of the hero, the wyrm's rig, the cloth and the particles
  would need an interpolated copy, the tests would run at another step than the game or twice as
  long, and at 60 Hz the simulation would cost twice as much: later, if replays are wanted); stepping
  at 1 / 120 s without interpolation (judder on 144 Hz displays, and not the tests' step).
- **Consequences:** at 50 Hz and above nothing changes (one step, as before). Below it the game
  simulates the steps the tests run, at the cost of simulating twice (30 fps) to six times a frame:
  a machine that is slow because of the SIMULATION (not the picture) gets slower still. Not measured.
  Presses are still read once a frame: at 30 fps a press can be up to 33 ms old when the first step
  sees it (event timestamps could place it in its step: not done). Not deterministic: a step's
  length still follows the display above 50 Hz.


## ADR-106 — The hero prints through what covers him: an ink ghost in the blade's cyan (2026-11-15)
- **Context:** the owner: "i noticed while fighting the dragon the player disappears and cant see
  whats going on if its behind the dragon. think of a good way to still let the player be seen
  somehow for these situations." The camera has a fixed yaw and the wyrm fills a third of the
  screen: north of its body, under a wing, behind it while it rears (Armageddon), under it while it
  flies low, the hero's letters were gone (reproduced at 1280x720 and at a phone's 852x393). The
  scene is drawn once with a depth test, so where the wyrm is in front, nothing of the hero is
  left for the ASCII pass to draw. The owner dislikes lasting overlays, does not want the wyrm or
  the hero restyled, and picks looks from rendered options.
- **Decision:** (1) **The mechanism:** after the world pass the hero is drawn once more, alone,
  into a second target (`seenRT`, only the box round him); a quad erases every pixel of him the
  scene already shows (a depth test against the scene pushed back by a margin: 0.6 m, 1.5 m for
  untagged pixels so grass never counts, never for a pixel in the hero's own alpha window so a
  human boss is never cover); what is left, the hero exactly where he is covered, goes back into
  the scene target over its cover. It is depth based: nothing is asked of the covering object, so
  trees, pillars, landmarks and whatever is thrown or lifted later get it for free. (2) **The
  look:** three were built behind a temporary `?seen=a|b|c` switch and rendered on the same frozen
  frames (five situations at desktop size, four at phone size, a film strip): *A, ink ghost* (his
  own line art in the blade's cyan over a thin dark gap), *B, window* (the letters over him thin
  out, he keeps his colours), *C, rim only* (a cyan outline, the letters untouched). The owner
  picked **A**; the switch and the other two were removed. (3) **A gate:** the pass costs a second
  draw of the hero (18 draw calls), so it runs only while a probe finds something in front of his
  torso: one quad in an occlusion query, answered a frame or two later, held for 20 frames.
- **Rejected:** *A window as the look* (B): it cut a hole into the wyrm's chest glow, which is a
  tell, and its letters dropped in and out as he moved. *A rim only* (C): quiet, but a one-pixel
  line is weak over bright letters. *A mark on the ground or an icon:* it says where he is, not
  what he is doing, and the owner dislikes overlays. *Dithering the wyrm away near the player in
  its material* (what trees and pillars do): it restyles the wyrm, needs every future big thing to
  opt in, and a pixel dither turns to noise on a letter grid. *A stencil or a second depth-greater
  draw of the hero in the scene pass:* his own far side would overwrite his near side; the second
  target resolves his nearest surface first. *Reading the hero's art from two textures in the
  ASCII pass:* it rewrites every tap of the hero's branch; patching the scene target leaves that
  branch as it was. *Running the pass every frame:* +0.44 ms and +20 draw calls a frame on a
  desktop whether he is covered or not, a third more draws on a phone where draw calls are the
  frame. *Gating it by where the boss stands:* not general (props, landmarks, thrown things).
- **Consequences:** a second render target the size of the scene's (half-float + depth; only the
  box round the hero is ever written). One more draw call in the open (the probe), 21 more while
  covered; measured in Edge on an RTX 4090 at 1280x720: nothing measurable in the open, 0.3–0.5 ms
  a frame while covered. The ghost appears a frame or two after cover does (the query's answer)
  and the pass stops 20 frames after it ends. Where the pass runs, the scene target's depth under
  the ghost is the hero's, so particles between him and his cover show over him. Cyan is now the
  hero's colour by rule (STYLE.md). A thing drawn in the FX scene never counts as cover; a cover
  thinner than the margin in front of him (he presses against it) hides him without a ghost. Not
  measured on a phone.
## ADR-107 — The world breaks: breakables in a rigid batch, fire that burns where it lands, cover (2026-11-15)

**Context.** The owner: "i want all the bosses to be able to cause destruction to the background. for
example, the dragon fire that hits the background (trees, grass) get on fire and are a temporarily
hazard until the grass/tree burns away so the player has to dodge those as well ... the humanoid
bosses will chip and damage the structures and leave impact based on the power of the attack. the
players can also do this as well. i want the bosses to also use the terrain as a way for their
defensive or offensive strategy". Asked, they chose: fire **burns where it lands** (it never
spreads); the terrain is **a real tactic** for the hero (cover stops projectiles until it breaks, a
piece felled onto a boss deals real damage); Cinderwood and Ashfall **keep their layouts and get
things to break** brought into the fighting space; **staged PRs by separate sessions** (the hero seen
behind the wyrm: ADR-106; the open Obsidian Throne: ADR-112; the bosses' terrain moves after).

**Decision.**
- **A set lists what can break** (`breakables`) instead of merging it into its static meshes.
  `world/destructibles.js` gives each piece a node of its own and draws them all through two rigid
  batches (the hero's and the wyrm's mechanism, ADR-045): one draw call per material however many
  pieces there are, each free to fall, fly or vanish. The two set materials place vertices with
  `rigidMatrix()`; only twins built with `rigid: true` are batched.
- **One POWER scale** for every blow (1 fells a tree), a structure per material and size, and a
  factor per kind of blow, in `world/breakTuning.js`. Each fighter's numbers live in its own tuning
  (`TUNING.world`, `DUEL_WORLD`; the hero's is its damage / 110).
- **Tall pieces fall; short ones shatter.** A falling piece is the world's own hazard: red, a marked
  strip, a flash 0.3 s before it lands. The hero is never hurt by a piece he felled; a boss under it is.
- **Cover.** A piece 1.1 m or taller stops what is thrown along the ground, and pays for it. For a
  line of the Void the cover answers in the hero's place.
- **Fire** (`world/fire.js`) lives on the scorch map's grid: a cell with grass left catches, burns
  3.2 – 4.6 s as blockable contact ticks, and is ash after. Sweeping fire lights wood only.
- **Marks** (`world/scars.js`): glyphs that stay until the reset, in one batch.
- **Lift and throw** are in the API (`take`, `carry`, `throwTo`, `nearest`); a thrown piece's blow at the
  hero is the thrower's (its own tell), dealt in `onLand`.
- **Everything is reset** with the fight (`world.restore()` beside every scorch reset).
- Cinderwood: the 57 trees within 36.5 m, the stone circle and the edge boulders are breakables, and 7
  dead trees, 4 young pines and 6 boulders stand inside the clearing (81 in all). Ashfall: its pillars,
  lanterns, stele and bell, and the dead trees and boulders within 30 m (72).

**Why.** Per-object meshes would have cost ~160 draw calls a level, twice (the world pass and the
shadow pass); the rigid batch costs 3. A world-side API with one POWER scale lets a new boss or move
hit the world with one call and no knowledge of what stands there. Fire on the scorch grid needs no
new texture and no new shader: the grass and the ground already read that map. The fall of a piece a
boss felled must follow the game's tell rule, so the world emits the tell itself.

**Rejected.** Fire that creeps or spreads freely (offered; the owner chose the readable one). Per-piece
shader state (a burn or damage uniform per object): the batch shares uniforms; the scorch map, a
stump variant and glyph particles do the job. Physics debris as meshes (the look is glyphs). Cover
against melee, breath and blasts (it would make standing behind a stone the answer to everything).
Leaving a felled trunk lying as an obstacle (the hero would clip through it or be blocked by an
invisible wall; it comes apart where it lands). Hooking fire to every `scorch.burnCircle` call (the
hazards' warm-up heats the ground before anything lands).

**Consequences.** Trees and boulders now stand inside the wyrm's clearing: sightlines and paths
changed, and the wyrm fells what it walks through. The minimap re-bakes when the colliders change
(`Colliders.version`). The fights' difficulty with breakables and grass fire is **not measured** (the other
suites' bots run on world mocks; the new `world.mjs` checks the mechanics, not a fight). Cost at the
game camera, the fight on, measured in headless Edge against `main`: Cinderwood 57 → 60 draw calls and
1.025 M → 1.034 M triangles a frame; Ashfall 52 → 54 and 566 k → 574 k. Frame time was not measured
(the run uses virtual time), nor a phone. How a broken piece comes apart was the owner's pick of three
filmed looks: "A: digits", a shower of the characters it is drawn in (bigger lumps and long shards
were turned down; the `?debris=` switch that held them is gone). The Obsidian Throne lists no breakables yet: its
rebuild (ADR-112) does. Sounds for breaking are two new one-shots (`chip`, `crash`); burning reuses
the sizzle and the ember hiss.

## ADR-108 — Every answered blow is logged per move; the death screen names the killing move (2026-11-15)
- **Context:** the genre review (the owner: "Yes, telemetry"). Every difficulty number so far comes
  from bots that answer a cue in one frame, and every boss section of COMBAT.md ends on "no human
  has played him yet". When the owner plays, nothing recorded WHICH move struck or killed them:
  `RunStats` held totals only, and the hero's events did not all carry the attack.
- **Decision:** `player.takeHit` announces every blow it resolves as `combat:answer { attack, tell,
  result, damage, dead, stream, perfect }` (one place, whatever the answer). `game/telemetry.js`
  `MoveLog` keeps a row per boss move, counted in blows, for the attempt, and adds each attempt to
  totals per level in localStorage. The death screen shows the killing move and up to three moves
  that struck the hero ("3 of 4 blows landed") under the hint, as small dim lines; the victory record
  gains "Struck most by". `__telemetry()` in the console prints the level's table. Bosses name
  their moves through `attackLabel(id)`. (ADR-104 / 105 are left to other open work: PR #41 and
  #44 hold 106 and 107.)
- **Alternatives turned down:** deriving it from the existing events (`player:hurt`, `player:block`
  and `player:dodge` carry no attack); a panel with the whole table on the death screen (the owner
  keeps the HUD bare: three lines, and the table stays in the console); sending it anywhere (it is
  the player's own browser storage, nothing leaves the machine).
- **Consequences:** a death teaches which move to learn, and a play session leaves numbers to tune
  from (hit rate and kills per move). A string's blows are counted one by one, so "seen" is blows,
  not casts. The phone has no console: there the recap and the record are all that shows; reading
  the stored table needs a desktop browser on the same origin. Burn deaths read "THE FLAMES".
  Blows dodged by walking out of reach are never "seen" (no hit was resolved).

## ADR-111 — The Ash Disciple uses the courtyard: four moves on its pieces, chosen only with a piece in reach (2026-11-15)
**Context.** The world breaks (ADR-107) and the owner asked for bosses that "use the terrain as a way
for their defensive or offensive strategy" and "showcase the destructibility of the terrain in cool
ascii manner". Shen Hui already chips and cuts down what his blade meets, and cover already stops his
crescents; he did nothing with the set on purpose. He is bound to 12.5 m round the courtyard's centre:
of its 72 pieces only the bell and the stele are inside his reach; the ring of pillars stands at
15.6 m, the lanterns at 17.4 m.

**Decision.**
- Four moves, a spread of uses and of answers (COMBAT.md → "He uses the courtyard"): **Severed Pillar**
  (a standing piece used as a weapon: he cuts the pillar the hero stands under and it falls on him;
  the fall is the world's red hazard), **Flying Lantern** (a kicked piece: blue, cued on the piece in
  the air, a parry bursts it), **Three Tolls** (the set's landmark: three blows on the bell, three rings
  of sound to parry in rhythm or roll through), **Swallow's Return** (positional and defensive: pressed,
  he leaps back onto a pillar and dives off it from another angle).
- They are **moves in his system**: data in `moves.js` (`terrain: kind`), numbers in `TUNING.terrain`,
  realised, told and cued like his others, in the Lab's ABILITIES and Training's BOSS MOVES. What only
  they do is in `ashDisciple/terrain.js`.
- **A move needs a piece.** His AI weighs such a move 0 while no piece for it is in reach (and the hero
  is not placed for it), so it is simply not chosen; started by hand it goes for the nearest piece
  however far, and with no piece at all it does not start. Two generic hooks in the duelist brain carry
  this for any duelist: `weigh(name, def, w, dist)` and `onActStart(act, opts)`.
- **His bound stretches for the move** (up to 9.5 m), and draws him back in after (5 m/s), instead of
  a larger bound for the whole duel.
- **Whose blow it is.** A piece he fells is the world's hazard (red, the strip marked, the world deals
  it: one rule for everything that falls). A piece he sends and a ring he rings are his: each cues
  itself `flashLead` before it reaches the hero, as his crescents do, and a ring that could not cue in
  time (the hero stood at the bell) passes him by.
- **Pieces are spent.** Four lanterns, a few stumps, each pillar once: the courtyard is used up as the
  duel goes on, and the reset puts it back.
- Tests run on the **real set**: `duel.mjs` `build({ real: true })` wires the real courtyard, `Scars` and
  `Destructibles`; scenario TERRAIN (50 checks) and TRAINING use it. The other scenarios keep the mock.

**Why.** A terrain move that can start without its piece would be a move thrown at air, and one that
is always available would crowd out his strings: availability by reach makes the hero's position part
of the fight (stand under a pillar and it can come down; stay in the middle and he has only the bell
and the lanterns he can reach). Routing the pillar's fall through the world keeps one tell for every
falling piece, whoever felled it. Blue on the lantern and white / white / blue on the rings give the
parry player something to do with the terrain, and red on the pillar gives the dodge player one;
"defensive play must not be punished" (owner): three of the four are answered from the guard.

**Rejected.** A larger bound for the whole duel (the fight's footprint and every existing sim would
move). Cutting pillars with sword qi from inside his bound (it reads as an Ash Crescent that missed).
A red landing ring for the lantern (it can be parried, and a parryable blow gets no colour before its
glint: the ring is pale). Standing on top of the bell (he would be out of the hero's reach for the
whole move). Rings stopped by cover (sound; and it would make a pillar the answer to them). New
`src/world` API (nothing was needed: `topple`, `take`, `carry`, `throwTo`, `strike` and `list` cover it).

**Consequences.** The hero's position near the edge of the courtyard now matters. In a 150 s bot duel
on the real set 7 of his 31 moves were these (23 %). The fight's difficulty with them is **not
measured** against a human, and the bots of the other scenarios never meet them (their world has no
pieces). The bell's toll is the world's generic metal `chip` sound: it has no toll of its own yet.
How a ring of sound is drawn was the owner's pick of two filmed looks: "A: arc", one line of bronze
strokes bulging outward (three thin ripples were turned down; the switch that held them is gone).
Training stages each move (category TERRAIN) and puts the courtyard back first.
## ADR-110 — The Cinder Wyrm uses the ground: three moves on the world's pieces, picked only with a piece in reach (2026-11-15)

**Context.** The owner: "i want the bosses to also use the terrain as a way for their defensive or
offensive strategy. like the dragon will pick up a tree or item on the ground and throw it at the
player ... think of fun cool epic different terrain interactions". The world's side was there
(ADR-107: `take`, `carry`, `throwTo`, `stop`, `nearest`, the pieces of a set); a thrown piece's blow at
the hero is the thrower's. Asked of this session: the owner's own example, one move that shapes the
field or defends, one that chains with fire.

**Decision.**
- **Three moves, each a different answer.** *Uproot and hurl* (red, P1): a tree or a boulder in the
  jaws, thrown in an arc; leave the marked ground or roll. *Tail bat* (blue, P1): a boulder lashed
  along the ground; parry it, guard it, step off its line or stand behind cover. *Firebrand* (red,
  P2+): a tree lit in the jaws and thrown; its wreck and the grass round it burn on, so the landing
  is denied for a few seconds. Numbers: `tuningTerrain.js`.
- **A move exists only with a piece.** Each move's AI weight comes from a picker (`jawsPiece`,
  `tailPiece` in `terrain.js`) that returns the piece it would use, or nothing: then the weight is 0.
  Forced with nothing in reach (the Lab, Training on a bare stage) the action is a one-second
  `search`: it casts about and snorts, with no tell and no blow.
- **The wyrm goes to the piece.** The clearing's pieces stand 14 – 28 m from its centre, so the hurl
  and the firebrand start with a `fetch` phase: a turn and a short run (at most 1.7 s) to stand 8.3 m
  from the piece. The tell starts at the bite, not at the run: nothing can land yet.
- **One module holds the piece** (`dragon.terrain`, `terrain.js`): in the jaws, in the air, its mark,
  its blow, the burning wreck. The actions only pose the wyrm. A piece in the air outlives its
  action: it carries the action's beat and sends the flash itself if the action is gone.
- **Arcs are the world's flight; the skim is carried here.** A lobbed piece uses `throwTo` (its blow
  dealt in `onLand`). A batted boulder must stop at the first cover and test the hero along its way,
  which `throwTo` cannot do: it stays HELD and `terrain.js` carries it along its line every frame,
  calls `stop` on each step, and lets it go with a 0.25 s `throwTo` where it ends.
- **Released upright.** The world's flight starts a piece upright and turns it end over end about the
  axis across its travel. `carry(tilt, yaw)` with the yaw of the throw is the same rotation, so a tree
  swung back over the shoulder and whipped forward leaves the jaws at tilt 0 and goes on turning
  without a jump. A tree held across the jaws would snap upright at the release, so it is not offered.
- **The landing is marked as every footprint is** (ADR-052: the ground heats up), a disc for an arc
  and a band for the skim, from before the throw is committed. A pale "dust" mark for pieces that are
  not fire was built and filmed: on the night grass it could not be seen (the heat mark's glow is the
  scorch map lighting the ground itself, not its glyphs), so it was dropped.
- **Readable in the jaws.** Trees are drawn dark; in the jaws one was hard to tell from one standing
  behind the wyrm. A held tree leans (standing trees never do), earth falls from its foot, and it
  sheds leaves and bark along its length; the chosen piece sheds dust before it is taken.
- **Weights on a par with its best picks** (3.0 – 3.2; the rending flurry is 3.0), held back by
  cooldowns of 15 / 12 / 19 s, by the piece having to be in reach, and for the hurl by x 0.7 with the
  hero closer than 9 m (it turns its back on him). In a 150 s bot fight on a field with a piece every
  9 m, 4 of 25 attacks were terrain moves.

**Why.** A move that cannot find a piece must not be chosen: a wyrm that walks to a tree that is not
there reads as a bug. A blue projectile gives the defender (parry, guard) something to do with the
terrain theme, beside two red blows; the owner's taste is that defensive play is not punished. Cover
stopping the boulder makes the hero's use of the terrain and the wyrm's meet in one rule.

**Rejected.** A piece conjured when none is in reach (a slab clawed out of the ground): the move
would stop being about what stands in the level. The tail's own blow during the bat (two blows from
one tell); the AI gate keeps the hero out of the lash's arc instead. A tree club swung through the
hero (a fourth move): left for later. A flat spin for a thrown trunk: the world's flight has one
rotation, and a new API (`burst(piece)` now, or a spin axis on `throwTo`) would be needed.

**Consequences.** `ATTACKS` has 33 entries. The wyrm's suite builds real `Destructibles` on a
hand-built set where a scenario asks for it (`build({ terrain })`: TERRAIN and LAB), and the LAB
scenario restores the pieces before each ability. The lab stage (`world/trainingRoom.js`) lists no
breakables, so the three moves only cast about there. How a tree is held was the owner's pick of two
filmed looks: "A: over shoulder" (swung back, nearly lying along the wyrm, then whipped forward);
held upright like a club was turned down, and the `?hold=` switch that held it is gone. **Not measured:** how
often the moves come up on the real clearing in a played fight, what they do to the difficulty, the
frame time, the phone on a device. The sounds are the existing ones (the bite, the world's tear and
crash, the swipe whoosh, the breath loop, the explosion): `dragon:spell` carries the three names for
sounds of their own.
## ADR-109 — The Starless Lord uses the crater: three moves on its pieces (2026-11-15)

**Context.** The owner, of the level's rebuild (ADR-112) and the destruction system (ADR-107): "the 3rd
sith boss will use the force to pick up rubble or the pillars to throw as examples. think of fun cool
epic different terrain interactions the bosses and players and to showcase the destructibility of the
terrain in cool ascii manner." The crater lists 36 breakables (shards of the star's glass, the rim's
slabs, six stones hanging in the air), all liftable by the Void (`lift: 2`). His blade beats, bolts,
pull and grip already met the world (ADR-107); nothing of his yet TOOK a piece.

**Decision.** Three moves, each one long windup and a cast (`moves.js`, marked `terrain: kind`; the
numbers in `TUNING.terrain`; the pieces' side in `starlessLord/terrain.js`):
- **Void Hurl** (every form; 1.2 s): one piece comes out of its place, crosses to hang beside him and
  is thrown at the hero, 0.15 s ahead of him. A stone already in the air first, then the nearest
  shard, the big rim slabs last. The ring where it lands is drawn from the moment it leaves his grip
  (0.9 – 1.2 s of flight), the glint comes `flashLead` before it lands, and the blow there is his:
  red, 26, knockdown, 2.1 m. What the landing does to the pieces round it is the world's (`throwTo`).
- **Glass Rain** (forms 3, 4; 1.4 s): up to three pieces at once, thrown 0.55 s apart, the later ones up
  to 1 m off the aim (20 each). The throws go on after the cast by themselves, as
  the Starless Sky's marks do.
- **Crown Fall** (forms 2 – 4; 0.85 s): only while the hero stands in the strip a tall piece would fall
  on. His hand closes on it and wrenches it down (`topple(piece, dx, dz, 'boss')`): the fall, its red
  tell, its marked strip and its blow are the world's (ADR-107), about 0.85 s for a 3.6 m shard.
- **Chosen only with a piece for it** (`weigh` → 0 otherwise; the hooks `weigh` / `onActStart` are the
  ones the Ash Disciple's terrain moves added to the duelist engine, ADR-111, copied line for line so
  the two merge). Started by hand it takes what there is and cannot start with none: the lab stage and
  the older tests' world mocks have no pieces.
- **Cut short before the throw** (a stagger, a posture break, his death), what he holds drops where it
  hangs and comes apart there: interrupting him costs him the stone.
- **Torn Stone leaves the floor cracked** where each stone was torn out (a scar per stone).
- **A hanging stone is built on the floor** and hung by its body's own offset (`def.hover`; the set's
  ambience keeps it there while the piece is whole, his grip takes the offset off as it takes the
  stone). A piece lands where its pivot meets the ground, so a stone whose geometry was built 4 m up
  would have burst 4 m up.

**Why.** Thrown pieces follow the rule every thrown thing of his follows (it cues itself where it will
land), so the new moves need no new reading from the player: a long windup with a visible cause, a
red ring, a glint. Crown Fall hands the tell to the world on purpose: the falling piece is the tell,
and the destruction system already draws and deals it. Taking stones that are finite makes the crater
change over a fight: the stones in the air go first, then his throws strip the hero's cover.

**Rejected.** A piece thrown straight from where it stood (shorter, but off screen for a piece at the
rim, and the hero has no cause to look at). Bringing the piece over his head (3.6 m up it was off the
top of a phone's screen). A crush of the hero's cover as its own move (the grip already does it,
ADR-107). Pieces that orbit him as a shield (it would stop the hero's blows: a new defensive rule,
not a terrain move). Dealing the throw's blow from a called strike's timer: `onLand` is the moment
the piece is seen to land.

**Tuned against answering bots** (the owner kept the moves after the film strips: "Keep and tune").
Bots stood still, rolled at the glint, rolled as the ring appeared, ran out of the ring a quarter
second after it appeared, and ran one way the whole time, at three distances. With the first numbers
(flight 0.7 – 1.05 s, ring 2.3 m, aimed 0.4 s ahead, the rain's later throws up to 1.6 m off) only
the rolls escaped: a hero could not run out of the ring in time (0.7 s at close range against 0.8 s
needed), and one who kept running was hit because the throw led him into it. Now (flight 0.9 – 1.2 s,
ring 2.1 m, 0.15 s ahead, 1 m off) every answer escapes every move and standing still is hit by each:
`lord.mjs` TERRAIN asserts both. Crown Fall needed no change (stepping or rolling sideways out of
the strip escapes it). A roll pressed with no direction is a backstep (0.22 s of i-frames, not 0.4):
the glint alone is not enough with it.

**Consequences.** His AI used the three moves 6 times in 39 moves in a 90 s bot fight in form 3 (2 in 40 after the tuning, on another draw of the dice); their
effect on the fight's length and difficulty is **not measured**, and no human has played them. The
crater runs out of stones in the air after six throws and can run low on shards in a long fight (36
pieces, everything stands again on a reset). Training has a TERRAIN category for him (three staged
situations, on a level with pieces only). `tests/integration/lord.mjs` builds the real crater with
its breakables for the TERRAIN and TRAINING scenarios (`build(seed, true)`). The held piece's hang
height and the ring's strength were set from film strips at 1280 x 720 and 852 x 393; the phone itself
was not tried.

## ADR-112 — The Obsidian Throne rebuilt open: Starfall, a crater with no walls (2026-11-15)

**Context.** The Starless Lord's level was a walled hall 28.6 x 37 m (ADR-069): two rows of pillars, a
door in the south wall, wardens and great swords in the side aisles. The owner: "i want you to redo
the sith lord level as the levels in general should not be so confined like the sith lord level. i
realized the walls are also adding a visibility issue so make it more open, cool interesting
objects/structures/terrain etc that will make the gme look stunning in ascii theme and also for the
player bosses to interact with." The camera has a fixed yaw and looks down at 58 degrees, so a wall
or a pillar standing south of the fighters covers them, and the hall's south wall and pillar rows did.
The work is one of the staged pieces of M1.38; the destruction system (ADR-107) was built beside it.

**Decision.**
- **Three open arenas were built far enough to render and shown on one sheet** (the fight at 1280 x
  720, the walk up to the throne, the whole arena, the fight at 852 x 393), behind a temporary
  `?arena=` switch: **A Starfall** (the crater where he fell, the star as his throne), **B the Grave
  of Blades** (a plain of planted swords round a paved duelling ring, under one colossal blade), **C
  the Broken Hall** (the old hall without roof or walls). The owner picked **A Starfall**. The switch
  and the other two are gone; the final build was compared with the picked frames (0.07 – 0.21 % of
  pixels differ: the particles).
- **The crater** (`world/throneHall.js`, layout `THRONE`): a disc of fused plates 15 m in radius laid
  in seven rings round the seal (the origin, unchanged), heaved and broken toward the rim; the dais
  and seat 16 m north of the seal, in front of the cleft of the star itself (`landmarks.js`
  `buildFallenStar`: two faceted halves, a crown of ten glass splinters up to 10 m); twelve clusters
  of the star's glass standing in the floor (1.9 – 4.2 m); six stones hanging in the air; four
  vents burning in the floor (the crater's lights); a rim of slabs and shards thrown up and outward
  from 15.8 m, up to 7 m behind him and under 1.4 m in the south, with gaps all round and the south
  left open; outside, 110 dead trees, those within 24 m of the rim lying flat with their tops away
  from the crater. The bonfire stays due south (z 30), the path runs to the south lip (z 14.8), and
  stepping onto the floor there (z < 14) wakes him.
- **Open is three rules, each tested** (`lord.mjs` LEVEL): no wall (a walk east, west or south from
  the seal leaves the crater), nothing tall on the near side (no breakable south of z 6 is over 3.2
  m), the tall pieces north and on the flanks.
- **Where he may stand is a circle, and the level says so.** The hall's rectangle (`TUNING.hall`) is
  gone: `TUNING.bound` 13.6 m is the duelist engine's circle round the seal, and the dais's line is
  the level's (`CONFIG.world.bossFloor.zN`, read by `StarlessLord.clampTarget`), so the lab stage,
  which has no dais, has no such line.
- **Everything free-standing is a breakable** (ADR-107's contract): 19 shards, 11 rim slabs, 6
  hanging stones, all `lift: 2`. A hanging stone has no collider, gives no cover and only chips: it
  is ammunition for the Void (ADR-109), not cover. The set returns an ember-red `scarInk`
  ([1.4, 0.12, 0.075]: at 0.5 the cracks did not show on the black floor).
- **A flurry's blow comes from a side he can stand on.** A duelist's flurry puts him at another side
  of the hero for each blow (`duelist.flit`). Against a hero at the rim, half of those sides are off
  his floor: he was put there, pushed back, and the blow whiffed (the Training suite caught it: four
  flurry situations never ended). `Duelist.standable(x, z)` (inside his bound, clear of colliders;
  the Lord's adds his floor) now picks the side he turns to or the nearest one he may take.
- **The star is a landmark builder** (STYLE.md's rule for big set pieces), built with `carve()`
  attributes directly; `buildSpike` and `facetCol` are shared from `landmarks.js`.

**Why.** A crater answers both of the owner's complaints at once: nothing encloses it, and what
stands in it is low on the camera's side. It is the place the Lord's story already named (he "fell
out of the night sky"), and its pieces are what a lord who lifts things with his will would throw:
shards, slabs, stones already in the air. A round floor suits the duelist engine, whose bound was
always a circle; the rectangle was a patch for the hall. Rings of plates give the floor seams that
follow the seal instead of a grid.

**Rejected.** B (the owner's pick decided it; thin swords also print mostly as outline strokes, the
least "made of characters" of the three) and C (still the most built, and its pillars stood inside
the fighting space). Keeping the first hall's wardens and great swords in the crater: the picked
render has none, and a pick is matched, not improved; their builders stay in `landmarks.js`.
Animating the hanging stones in this change: the destruction system draws them, and a bob is its
`carry`, which belongs with the moves that take them (ADR-109). Braziers: the vents light the
crater and cannot be knocked over, so nothing here promises a fire the level has no fuel for.

**Consequences.** The level's first hall no longer exists; `createThroneHall` and `throneHall.js`
keep their names (levels, tests and the glyph check know them). Fights move differently: cover is
thin and scattered, there is no corner to be backed into, and the hero can leave the crater (the
Lord cannot). His tuning was not retuned for it and **no human has played it**. Fallen trunks have
two collider circles each within 38 m. Cost against the hall, measured in headless Edge on an RTX
4090 at the fight camera with the AI off: 352 k → 280 k triangles a frame (the hall's unseen grass
out to 75 m was most of the level; the crater's stops at 54 m), 52 → 53 draw calls (the breakables'
batch), 8 → 6 lights, 236 → 185 colliders. Render time, both levels in one page with renders
alternated (other sessions were loading the GPU, so only the ratio means anything): Starfall /
hall 0.85 and 0.89 at 1920 x 1080, 1.03 at 3840 x 2160, 0.92 and 1.01 at 852 x 393 on LOW. So: no
slower, about a tenth cheaper at 1080p, no measurable difference at 4K or at phone size. **A phone
was not measured.** The seal's flare, the intro and the reset are unchanged and tested.

## ADR-113 — Effects in the dragon's letters: the fire field; text effects; landmarks where the camera looks (2026-11-15)

**Context.** The owner, with the wyrm and the background objects in one look (ADR-093, ADR-100): "is
there anything existing we should update? ... i want people to be stunned at the ascii style and
amazed how text can make such detailed 3d objects that look great in animation and effect wise", and
"all the spells, effects, etc need to look as realistic and cool as possible. for example, the dragon
fire attacks look meh and use ascii art, animation better to make it look like real fire and more
threatening and detailed". Every effect was a camera-facing glyph sprite of any size with glow on
top (`fx.add` / `fx.alpha`): outside the 5x8 px digit grid everything else is printed in, so fire
read as a line of blurry symbols. Shown a sheet (the breath as it was; the new fire calm; the new
fire hot), the owner said "Do all 4 and create parallel subagents to work on each task" without
choosing between the two new ones. The calm one is built: it is closer to the tone they chose for
the wyrm, and the hot one loses its letters in the bloom (their objection to the large-letter wyrm,
ADR-092).

**Decision.**
- **Fire is heat, printed.** `render/fireField.js` (`game.fx.fire`): emitters spawn soft blobs of
  heat (metres across, a heat that adds up where blobs overlap). Blobs are drawn into a heat buffer
  with ONE texel per art cell; a flame pass per cell makes the heat climb, lean and tear into tongues
  with noise that scrolls upward; the print pass turns each cell into one letter of the wyrm's atlas:
  red strokes at the rim, digits in the body, round bright digits in the heart, on a dark backing.
  A dense stream therefore has a white-hot heart and a ragged cool rim without the emitter drawing
  either. Looks are data (`render/firePalettes.js`).
- **Four kinds share the buffer** (one channel each): `fire`; `void` (the Starless Lord's violet);
  `steel` (crisp: no turbulence, and a thin line prints as the stroke character that runs along it:
  bolts, cuts, glints, air rings); `smoke` (grey letters where no fire prints).
- **Everything that burns is on it:** every fire of the wyrm, the bonfire, the braziers, the ground
  fire and burning trees of ADR-107, the human bosses' spells, trails and rings. Small things that
  fly on their own (embers, sparks, dust, debris) stay glyph particles, about one cell in size.
- **One set of timing cues for every boss,** written on the letter grid: normal a white cross (one
  row of `-` through one column of `|`), blue a larger eight-point star with a ring, red a ragged red
  blaze. `DuelFx.tellFlash`; the wyrm draws its own through the same code at 1.5x.
- **Ground warnings stay glyph specks** (ADR-052) and draw over the field: "this will burn" must not
  look like "this burns".
- **Text effects** (only a world made of letters can do them): heat haze (the letters of the wyrm and
  of objects beside a flame re-roll on the fire's beat and warm); letting go (the dying wyrm comes
  apart letter by letter, each letter falling before its cell empties; one rule shared by the
  material and the pass, `render/letGo.js`); shed digits (a cut knocks a few of the wyrm's own cells
  loose, `render/shedDigits.js`); the breath's charge fills from the belly to the maw.
- **Landmarks stand where the duel's camera looks,** and are rebuilt as a few flat masses with gaps
  of dark between them. Moved: the sect gate from the north to beyond the east pillars; the stone
  swordsmen into the pillar ring; the cauldron onto the paving; the elder wyrm's skeleton to the east
  rim. The Cinder Tree's wood is prop art (its leaves stay as they were). (The wardens were moved to
  the hall's aisles in dark bronze; ADR-112 replaced the hall before this merged, so they are built
  but not placed.)

**Why.**
- One buffer at cell resolution is what makes it one look and cheap: 256 x 90 texels at 720p. The
  flame maths runs once per cell, not per pixel; the full-screen print pass reads one texel and
  discards where nothing burns; the field skips its passes while it holds no blob.
- Density, not drawing, makes fire: the emitters became shorter, and every fire agrees with every
  other.
- The owner's own words set the brightness: "way too flashy" (ADR-093). `hdr` is 0.6.

**Turned down / not done.**
- A hotter palette (option C of the sheet): not chosen by the owner; one number (`hdr`) if they want it.
- The hero's effects (slash trails, parry sparks, `combat/clashFx.js`, `cutFx.js`): other open work
  was changing those files. They are still glyph sprites.
- The wyrm's blue and red wisp and orb bullets: their colours are combat signals and the field has no
  such kind.
- A crisp red kind (for the red cue, the red rings and the Lord's blade): the four channels of the
  buffer are taken, so it needs a second target. Today red cues are fire at a low heat.

**Consequences.**
- `game.fx.fire` is part of the `game` context; the test harnesses carry one. An effect that burns
  spawns blobs, never big glyph sprites.
- Blobs lower than about 0.7 m fade into the ground (the soft depth test): ground fire is born that high.
- Tongues always climb up the screen, whatever a thing's direction of flight.
- The bonfire and the braziers keep the field's passes running all the time in their levels.
- The Lord's spells changed colour (red to white steel and violet void); his blade stays red glyphs.
- Not measured: a phone. Not checked: motion at real speed by eye, the Lord's intro shot without the
  wardens beside the throne.

## ADR-114 — Two stances: at ease, and a fencer's guard in a fight (2026-11-15)
- **Context:** the owner: "review the current character posture, angle of the right hand sword
  when the character is not attacking. i want the characters hands to have some kind of cool
  looking idle motion/stance where it looks natural and cool. something about the current idle
  animation is bothering me." The ready stance (ADR-036, ADR-040), measured: the blade 52° down and
  79° out from his front, 27° out of line with the forearm, held there from an elbow tucked at the
  ribs (the arm of a man showing the way); both hands beside the hips at one height, the chest
  square; over a 2.4 s breath nothing travelled more than 1-3 cm, under half a pixel at the game
  camera; and the idle actions (ADR-047) never play while locked on, so in a fight he was a statue.
  Asked what is off, the owner ticked the bent wrist, the mannequin arms and the statue (not the
  blade showing at his side), asked for three options across three attitudes, each with a stance
  for exploring and one for a fight, and for motion that is "alive, not busy". Three were built
  behind a temporary switch and rendered (an overview, a detail sheet and a loop each): A "At ease",
  B "Coiled" (two-handed, a deep middle guard), C "Hidden blade" (the sword reversed behind the
  arm). The owner picked A, the motion as shown, and the fight stance for a lock-on or a boss fight.
- **Decision:** (1) **Two stances, one layer.** `stances.js` holds `atEase` and `fencerGuard`;
  `anim.js stand()` writes them over `guard()` for the hero's animator only (`A.freeHand`), blended
  by `HeroAnimator.fightW`. `loco()` builds on `stand()` and an attack's recovery comes home to it.
  `guard()` is unchanged: it stays the base every other clip is written over and what a duelist's
  footwork reads, so no other clip and no boss moved. (2) **At ease:** tall, a little side-on, the
  weight on the rear leg; the sword arm hangs loose (elbow 136°) and the blade lies on the forearm's
  line (6° on average, 10° at most as the point drifts), down and out to his front-right, the point 0.19 m off the grass; the free hand lies
  open on the belt, the elbow out behind it. (3) **The fight stance** is a fencer's guard: the sword
  side turned to the foe (half in the hips, half in the waist) and stepped forward, the arm half
  extended (99°), the blade on the forearm's line (7° on average) with its point on the foe, the flat up; the free
  hand stays on the belt. It holds while `player.lockOn` or the flow is in `bossIntro` / `boss`
  (aiming with the mouse he never locks on: without the second rule he would stand at ease beside a
  boss). He takes it in 0.38 s and lets it down over 0.88 s. (4) **The life** (`STAND_LIFE`): the
  breath (3.7 s at ease, 3.1 s in the guard; the arms follow late), the weight settling from foot to
  foot (7.9 s), a slower drift, a look around made of two sines, and two that carry the blade's
  point; no period within 4 % of a multiple of another. The point travels 18 cm at ease and 13 cm in
  the guard over 12 s (the stance before: 2-4 cm), never more than 0.25 cm in a frame. (5) **What
  the guard asked of the rest:** in a fight the sword arm keeps the guard on the move (`FIGHT_RUN`
  in `loco()`; a sprint still trails the blade); a roll and a backstep, written over `guard()`'s low
  blade, ease the sword arm out of the pose they began in over 0.16 s (`swordFromEntry`), and the
  loco clip settles the blade into the stance over 0.24 s; the idle actions play at ease only.
  (6) The Lab's PLAYER section holds either stance (`player.debug.fightStance`).
- **Why:** the three complaints have one cause each, and A answers all three with the least risk:
  the wrist is straight because the arm, not the wrist, carries the blade's line; the arms differ
  because one hand has a place of its own; and the motion is five times larger because it is
  written for the game camera, where 1 cm is a fifth of a pixel. B kept both hands on the grip,
  which every one-handed light would have had to break; C needed a reversed grip to turn into every
  attack. A fight stance of its own was the owner's call. Keeping `guard()` as the base means
  thirty clips and three bosses were not re-posed for a stance change.
- **Measured** (headless, against `main`; the fastest frame of the blade's point, cm): running,
  strafing and backing away in a fight 2.6 / 3.0 / 3.1 (the old stance 4.7 / 4.6 / 11.4; the guard
  with a trailed blade 15.5 / 17.7); into a block 38 (105); into a roll from the guard 46 (173
  before the easing; the old stance 57); taking the guard 22; letting it down 9. The hand on the
  belt: the palm 2.7-3.2 cm off the waist, no fingertip in the hips or the torso standing, setting
  off or stopping. The flat of the blade to the game camera with him turned four ways: ≥ 0.28 of
  its width at ease (a blade that hangs this steeply cannot face four cameras), ≥ 0.42 in the guard.
- **Rejected:** changing `guard()` itself (every clip that starts from it, and both duelists' rest,
  would have moved); one stance for both (the owner chose two); the fight stance on lock-on only
  (see above); a blade trailed on the move in a fight (the 140° swing at every start and stop);
  the guard's blade straight ahead with its edge down (invisible from the camera behind him).
- **Consequences:** the first frames of every swing begin from another pose, so a seeded bot fight
  plays out differently: the WIN scenario's default seed now sees one guard break (a red fireball
  inside a parry tap); seeds 1-6 see none on either stance, and the check allows one. The idle
  actions were written over the old base and fade in from the new one unchanged. The free hand has
  no finger joints: its fingers lie straight along the hip. Not judged by a human in play yet, nor
  on the phone.

## ADR-115 — A heavy button: five heavy branches off the chain; the charge moves to it (2026-11-15)
- **Context:** the genre review: the hero had one attack button and one fixed chain (13 looks picked
  at random), against Phantom Blade Zero's and Onimusha's choice of what comes out. The owner, asked
  first: heavy branches off the light chain (not direction-chosen swings), hold heavy to charge, a
  fourth tile on the phone (a 2 x 2 square, BLOCK | HEAVY over DODGE | ATTACK), heavy on the right
  click and R2, and the guard on the middle click ("Middle mouse", over a thumb button or keeping the
  guard on the right click).
- **Decision:** `combat.js` `HEAVY`: the heavy pressed on its own is HEAVY[0], pressed in the n-th
  light's recovery HEAVY[n] (`heavyAfter`): Piercing Gale (a dashing thrust), Rising Crescent (staggers
  a duelist: `reel` 2), Whirling Tempest (a full turn), Mountain Splitter (poise 50 crushes a raised
  guard), Earthbreaker (a bigger slam). Two-handed clips of their own (`swings.js`), kind 'heavy' (the
  Earthbreaker is a slam). A heavy ends the chain. The charge moved from the attack button to the
  heavy: a heavy press still held waits at its coil (`pending`) and becomes the charge at 0.3 s; a
  light press cuts at once (it used to wait at its coil while held, in case it became the charge).
  Bindings v2 (LMB / R1 light, RMB / R2 heavy, MMB block, Tab lock-on): a v1 save had the guard on the
  right click, now the heavy's, so it is not read. Training gets the five heavies, and every
  situation now starts on a restored set (a pillar toppled by one situation fell on the hero in the
  next once the timings moved).
- **Alternatives turned down (by the owner):** direction picks the swing; both; hold ATTACK or a
  swipe for the heavy on the phone; heavy on the middle click or Q; the guard on a thumb button.
- **Consequences:** a player now chooses: a fast light chain, or a heavy that answers the moment
  (close a gap, stagger, crush a guard, sweep round). The chain's random looks stay looks. Every
  numbers row is a first pass (`__telemetry()` and play to tune). The guard on the middle click is
  stiffer for timed parries than the right click was (the owner's pick; remappable). Not done: a
  heavy out of a sprint or a roll of its own (both give HEAVY[0]); heavies against the wyrm have no
  special effect beyond damage and posture (the stagger and the crush are a duelist's); the owner's
  look at the swings (a film sheet sent with the PR).

## ADR-116 — WHAT'S NEW in the game; a cinematic's zoom scaled for the phone; the page never zooms (2026-11-15)
- **Context:** the owner: "On mobile theres a bug where after i lock onto the dragon target, the
  camera zooms in really close. Fix that. Also add a changelog in the game menu with an indicator
  showing whats new with all the version changes with notes on what changed." (and: remove every
  reference to the game that first inspired the look, "as i want this to be my own thing now").
  Reproduced on the phone preset (`?touch`, 852 x 393 and 393 x 852): lock-on itself never moves the
  camera in (its pull-out is capped at 3 m on a phone and the distance stayed 20 - 27 m in every
  case tried, the wyrm asleep, waking or fighting, near and far). What did: `flow.cinematic` (a
  duel's perfect deflect, blade lock, counter, mikiri, execution) adds `cine.zoom` (-9 m by default,
  -7 m for the lock) to the distance unscaled, so the phone's 20 m camera, already 3.3 m in from the
  duel camera, went to 9.3 m (56 %; a desktop goes 30 → 21 m, 70 %). Also suspected: iOS Safari
  ignores `user-scalable=no`, and nothing stopped its double-tap zoom on the small LOCK button.
- **Decision:** (1) `cameraRig._extra()` scales `cine.zoom` by `defaultDistance / CONFIG.camera.distance`,
  like the punch and the duel camera already were: the phone's moment comes in by the same share as
  the desktop's (16.7 → 12.6 m). (2) While the touch layer is on, a non-passive `touchend` listener
  cancels the default on the canvas and inside `.tc-root` (they run on pointer events alone, so the
  double-tap zoom and the synthetic click are never needed there), and `gesturechange` / `dblclick`
  are cancelled like `gesturestart` was. Menus keep their default. (3) **WHAT'S NEW**: the releases
  as data (`ui/changelog.js` `RELEASES`, newest first; the work since the last release is the
  versionless LATEST release), a panel (`ui/changelogPanel.js`) opened from a corner button on the
  title screen and an item in the pause menu, each with a count of the entries this browser has not
  read (localStorage `gcd.whatsnew.seen`, the ids read; on a first visit only the newest day's
  entries are new). Closing the panel marks everything read. Entries are short, player-facing
  rewrites of CHANGELOG.md's headlines; `tests/changelogcheck.mjs` (in `npm test`) fails when a
  headline in CHANGELOG.md → [Unreleased] has no entry with the same title, or when `GAME_VERSION`
  is not package.json's `version`. (4) The inspiration's name is gone from the game, the docs and
  the source (the title's credit line now reads `prototype v<version>`); git history keeps it.
- **Why:** the lock-on code was clean, and the only close zoom the phone could reach was the
  unscaled cinematic, which plays in exactly the fights where the player is locked on; the owner may
  also have met the page zoom, which no in-game camera test can show, so both are fixed. Handwritten
  notes over the CHANGELOG's prose: those entries are written for the owner (ADR numbers, Lab rows,
  measurements) and run to ten lines; a player needs two or three. The check keeps the two lists
  from drifting apart without a build step (the dev server has none). An entry is keyed by its date
  and title, not its release, so cutting a version does not make old entries new again.
- **Rejected:** parsing CHANGELOG.md at runtime (the single-file build does not ship it, and its prose
  is not player-facing); a per-version "seen" marker (the site ships continuously between versions,
  so 0.4.0 has carried forty entries); the badge on first visit for every entry (a new player would
  see fifty-odd NEW); a `visualViewport` reset (iOS gives a page no way to undo a zoom).
- **Follow-up (the owner, same day):** "it does not require the target to be locked on for this bug
  to happen and it always happens 100%". A full scripted walk-up and fight on the phone preset never
  took the game camera under 20 m, so the page zoom is the cause that fits: a double tap is constant
  in play (mashing ATTACK), Safari zooms the page about 2x round it, and the blocked pinch leaves it
  stuck. The guard now covers every double tap while the touch layer is on (menus: the second tap
  of a pair loses its default and its button is clicked by hand), and a zoomed page is put back by
  rewriting the viewport meta. `?camdebug` shows what the phone reports, in case it is neither.
- **Consequences:** every CHANGELOG headline needs a WHAT'S NEW entry in the same PR (CLAUDE.md →
  Keep history); a PR rebased after another one landed its headline fails `npm test` until it adds
  the entry. Not checked on an iPhone: whether the page zoom was what the owner saw, and the
  `touchend` guard on the device.

## ADR-117 — Recorded music from OpenGameArt: a dark track per level and per boss phase (2026-11-15)
- **Context:** all music was synthesised at runtime, one score shared by every level, changing once
  (boss → boss2). The owner asked for the game's sound and music to be replaced with CC0 recordings
  from OpenGameArt. A first pass (PR #55, closed unmerged) also replaced the sound effects (129
  recorded sounds and ambience beds); the owner: "the new sounds is way too much right now and feels
  noisy everywhere. lets just focus on changing the background music with something very dark, grim,
  and good to hear in the background for each level where the music changes per phase", with an
  audition page to choose what ships.
- **Decision:** music only; every sound effect stays synthesised. Each level has an exploring track
  and one track per boss phase (the Cinder Wyrm 3, the Ash Disciple 2, the Starless Lord 4), plus a
  shared victory and death track: 14 tracks, all CC0, chosen by the owner on an audition page
  (three candidates per slot, 75 s clips at equal loudness) from OGA's CC0 music, searched for dark,
  grim and horror pieces and measured for darkness (spectral centroid), density and dynamics.
  The picks: Cinderwood Creepy Forest (F) / Dark Intro / Inside the Overlords Domain / Ancient
  Grudge; Ashfall Ruins of an Ancient Culture / Hunted by the Evil / Boss_Koto; the Obsidian Throne
  The Abyss / Zodik Deep Choir / Dramatic Boss Encounter / Final Stand (phase 3) / Fall of
  Nightmares; Victory Fanfare Short; Death of a Ninja. The engine picks the track from the mode and
  the boss's phase (`_bossPhase`), so flow keeps calling `setMusic('boss' | 'boss2')` and every
  phase event crossfades to its track. Tracks are loudness-normalised (fights -18 LUFS, exploring
  -21) and lifted 6 dB on the bus (measured against the synth score). Data in `trackList.js`, player
  in `tracks.js`, the files built by `scripts/audio/build-music.py`.
- **Kept:** the synthesised score as the fallback (before a track decodes, offline, a file://
  build, `?music=synth`, a track that fails to load); the death gong.
- **Licences:** only CC0 (several pages are CC0 and OGA-BY; the CC0 one is used). The first pass
  also showed why a pack's own files are checked: one sound pack listed as CC0 shipped a CC BY-SA
  licence inside.
- **Alternatives turned down:** recorded sound effects (the owner: too noisy); one track per boss
  with the synth's intensity layers (the owner asked for a change per phase); streaming through
  `<audio>` elements (iOS wants a gesture per element; decoded buffers, at most 3 at a time).
- **Consequences:** the build is the page plus `dist/assets/` (about 14 MB of music); the first
  track starts a moment after the first tap (prefetched, decoded on demand). Each level now sounds
  different, and the Starless Lord's four forms each get their own music. Not checked on the
  iPhone: memory and decode time with three decoded tracks.

## ADR-118 — The flare: a moment is cued by a flash alone; the counter; the charged black blow (2026-11-15)
- **Context:** a dodge-only blow warned three ways: the boss glowed red through its windup, a red
  ring burned on the floor under an area, and a ragged red blaze popped 0.3 s before the hit. The
  owner, with two clips of Phantom Blade Zero's perfect dodge and perfect parry: "add more perfect
  parry / perfect dodge moments ... instead of giving a red circular area of where the attack will
  land, i want it to be exactly like phantom blade zero where there's a red flash to give you a
  tell/sign to dodge at that exact moment and if you do dodge it in time, it will do a cool animation
  of the dodge/parry and do a counter attack. also i want to add a black charged up attack ... the
  player needs to dodge it, if they block it they lose all guard". Asked four questions, the owner
  took: flash only (hazards that land away from the boss keep a ground mark); the counters automatic
  for both; a black blow on the guard empties it and deals no damage; all three bosses.
- **Decision:**
  1. **The flare** is the cue of a moment: one wide streak of light through the striking part with
     a white-hot heart, written on the letter grid in the fire field's steel and dyed by a new tint
     zone (`FireField.tint`): red = dodge, blue = parry, black = dodge. Red and black blows always
     flare; a blue blow only when its data says `flare: true` (the unmarked heavy blows keep the white
     star). Nothing shows before it: `TELL_STYLE.red.warn` ramps from 0 to 0, `TELL_STYLE.red.floor`
     is false (the duelists' red ring and the heat under the wyrm's own area blows are off, the code
     kept behind the flag).
  2. **The counter:** any parry of a blue flare blow ends the boss's string and is answered by the
     hero without a further press: the riposte's flash cuts (the streak), the last one a counter blow
     of 64 damage and 30 posture (`DEFENSE.flareCounter`). The red flare's answer is the flurry that a
     perfect dodge of a red blow already was.
  3. **`TELL.BLACK`**, the charged blow: wound up about 1.5 s plus a random held beat while darkness
     gathers on the weapon, then the black flare. Neither a guard nor a parry holds it: either stops
     the blow, deals no damage, empties the guard meter and knocks the guard open for 0.8 s
     (`GUARD.black`). A perfect dodge of it is answered as a red blow's is.
  4. **New moves**, composed from each boss's existing key poses: Shen Hui's Severing Wind (blue
     flare), Twin Embers (red, red) and Black Tide; the Lord's Severance, Red Meridian and Nightfall
     (every form); the wyrm's Black maw. Twelve existing heavy blows are marked as parry moments.
- **The look:** shown a streak (a full-width line with a thick heart), a star (a shorter line with
  rays) and a lance (a full-width hairline), the owner picked the streak. The other two stay in
  `TELL_FLARE` behind `?flare=`.
- **Why a tint zone and not a new kind of fire:** the fire field's heat buffer has four channels and
  all four are taken (fire, smoke, void, steel). A zone of the frame in which steel prints in another
  colour costs two uniforms and no render target, and the flare is steel anyway (strokes along a
  line). Two zones at most; the hero's own blade trail inside a flare's zone is dyed for its 0.3 s.
- **Why black is drawn as an eclipse:** all three levels are dark, so a black shape on them is
  invisible. Black is shown by what rings it (a pale corona round a disc of blacked-out cells, a
  white-hot thread through a dark bar) and by the screen edge going dark.
- **Alternatives turned down:** a faint glow kept through the windup (offered; the owner chose flash
  only); every heavy blow as a parry moment (the full deflect of a seven-blow string would be gone:
  a parried fourth blow would end it); a counter that needs a press (the perfect parry's counter cut
  stays for that); the black blow dealing its damage through the guard (offered; turned down).
- **Consequences:** a boss's own area blow (the wyrm's leap, a duelist's Heaven-Splitting Fall) no
  longer shows where it lands: the roll's i-frames answer it at the flare, walking out of the area
  needs the animation to be read. A held guard has one thing it is wrong for. Also fixed on the way:
  the flurry's art list for a foe on the ground held the riposte's entry (`air: null` passed a
  `!air` filter), so about one perfect dodge in four of a duelist's red blow got no art and dealt nothing.
  **Not measured:** the length and difficulty of the three fights after the change (the strategy
  bots of ADR-102 were not re-run), the flare on a phone screen, and the frame cost of a full-width
  streak (about 300 blobs a frame for 0.34 s).

## ADR-119 — The Cinder Wyrm's second pass: pressure, whole-body combos, flying combos, a clearing that breaks (2026-11-15)
- **Context:** the owner: "i want to make the boss fights a bit more harder, more epic, more crazy
  combos and flurries of attacks ... remove the dragons blue fire homing attacks as it looks bad ...
  his shock wave rings coming out looks really bad ... him breathing out a cone of fire and circling
  looks bad because the fire doesn't look realistic and his animation circling around looks comedic
  ... more cooler melee attacks mixed with wing attack, tail, and fire attacks instead of just using
  his hands a few times ... each phase needs to ramp up the difficulty and chaos ... more flying
  attacks that are combos instead of just 1 attack ... the terrain attack animations and speed need
  to be better ... don't show exactly where the terrain will land ... the terrain itself is barely
  destructible ... plan all the new stuff out with fable and have opus agents do the work." Three
  read-only agents mapped the code first. What they found: the "circling" was the Scouring breath
  (the whole body spun at 123 deg/s) and the Ember torrent's phase-3 pirouette; every shock ring was
  one evenly spaced circle of blobs living 0.3 s; wings were in one string and the tail in one; the AI
  could not act at all while airborne; a terrain throw took 2.9 - 3.2 s from tell to blow; 80 of about
  620 objects in the clearing could break and the wyrm's trample never reached a trunk.
- **The owner's answers** (asked before anything was built): this pass is the wyrm, the two duelists
  follow; harder means **more pressure at the same damage**; thrown terrain shows **no landing mark**
  (the flare only; meteors, pillars and fireballs keep their heated ground); the owner picks the look
  of the shock ring, the fire breath and the apocalypse from rendered options; **the whole clearing
  breaks** (the Cinder Tree, the Elder Wyrm's skeleton and the bonfire stay); **wreckage is scenery
  you walk over**.
- **Decision:**
  1. **A director instead of a dice roll** (`ai.js`, `TUNING.pressure`): every attack has a category
     (melee, wing, tail, fire, flight, spell, terrain); the weighted pick is steered by run limits,
     floors that bring an absent category back (the wyrm repositions for it if it must), gap closers
     when the hero is far and tail moves when he is behind, and ceilings on time in the air and on
     live hazards. **Combo links** (`tuningLinks.js`): each attack lists follow-ups by where the hero
     is as it ends (behind, side, front, near, mid, far) with a chance per phase; a link starts with no
     pause, up to `chainDepth` [3, 3, 5] in a row, then a breather. The hero's openings (a recoil, a
     stagger, a break, his flurry or counter) keep the old, longer pause. From phase 2 the wyrm also
     drops small fire of its own ("cinders") near the hero.
  2. **Fairness is enforced, not hoped for:** two cues that need different answers never land within
     0.3 s of each other, across sources (a melee blow is held up to 0.5 s; a spell or bullet pattern
     does not start on top of another's; a red move does not start while bullets fly) and inside one
     pattern (an ember beside an orb fizzles); an ambient cinder only falls near the hero when at least
     6 of 17 roll spots stay clear. The PRESSURE scenario measures it.
  3. **The whole body fights:** six new attack kinds (wing sweep, wing slam, tail whip, tail slam, a
     bite that ends in a gout of fire, a claw rake that leaves burning ground) and seven new strings
     across the phases; old hands-only strings re-weighted and given wing beats. No new damage band.
  4. **Flights are combos:** a composite action takes off once and strings a strafing pass, a shell
     barrage and a dive (two, three and four parts by phase), ending in a crash landing. A perfect
     dodge of a pass or a shell still plunges and ends the combo.
  5. **No wisps, no spinning:** the homing wisp swarm is removed. The Scouring breath is fire driven
     along the ground in tongues from a braced stance (its body no longer turns faster than its normal
     turn rate, asserted); the Ember torrent ends in barks instead of a pirouette. New patterns: Cinder
     spit, Ember rain, Fire lanes.
  6. **Effects have bodies:** one shock engine (a ragged front that slows, rows behind it, dust, rocks,
     scorch, echoes) behind every ring; one breath (`fx.breathBody`) behind every stream of fire the
     wyrm makes; a sky that answers the apocalypse; no stacked white discs. Three looks each for the
     ring, the breath and the apocalypse behind `?ring=`, `?breath=`, `?apoc=` (the owner's pick is
     recorded below).
  7. **Terrain throws are fast and unmarked:** 1.3 - 1.6 s from tell to blow (firebrand 1.8 s), a
     whole-body grab (a foreleg pins, a tug, the tear, a whip), nothing drawn on the ground; the flare
     is drawn on the flying piece 0.35 s before it lands and a roll at it always dodges. **This
     supersedes ADR-110 and ADR-118 for thrown pieces**, by the owner's choice.
  8. **The clearing breaks:** 183 breakables (80 before; flagstones, loose bones, helms and swords
     among them), found through a spatial grid. The wyrm's body, tail and wings meet the world every
     frame (`dragon._wreck`): a walk or a turn shoves and shakes (a "brush"), a charge, a tail sweep,
     a landing, a low flight and a thrown piece fell what they hit; it passes through wood it can
     break. Felled trunks, rubble and burnt logs stay as scenery with no collider until the fight
     resets; fire spreads from tree to tree within limits and direct ignition is capped. **This
     reverses three choices of ADR-107:** a felled trunk no longer comes apart, fire now spreads, and
     the root-only trample is gone.
- **Why pressure and not damage:** the owner's choice, and it matches ADR-095 (defensive play is not
  punished): a mistake costs what it did, but the fight gives fewer pauses to recover in.
- **Measured** (the PRESSURE scenario, five seeds, 120 s a phase, a bot that blocks and rolls; cues a
  minute): `main` 24 - 28 / 26 - 51 / 37 - 54 by phase; this pass 31 - 37 / 53 - 63 / 72 - 86. Longest
  gap between cues in phase 3: 2.2 - 3.2 s (main 5.6 - 10.3 s on three seeds). Chains per phase: 5 - 22
  (main 0). Bots: a mortal defender that answers 95 % of cues wins all three runs (45 - 89 damage
  taken; on main it died in one of three); one that answers 80 % dies in all three (main: in two of
  three); the worst single blow is 34, as before. The fire field peaked at about 2600 of 6000 blobs
  in a phase-3 fight (measured before the final tuning). A four-minute fight leaves 47 - 60 % of the
  pieces inside the hero's bound standing (run alone; 24 % on one seed inside the whole suite).
- **How it was built:** the lead planned and reviewed; Opus agents built. Three mapping agents, then
  seven building at once in their own worktrees with disjoint files (melee, flight, fx, bullets,
  terrain, world, ai) and a shared brief, each filming its own work; the lead looked at every sheet,
  sent three back (the breath's sheet could not be judged, the ground tongues did not read as lines,
  the grabbed tree could not be seen), merged, and handed the seams to an integration agent and the
  pace to a tuning agent.
- **Changed without being asked** (each agent's own call, surfaced for the owner): the three old
  single flights are picked far less; the phase-3 apocalypse has five waves, not four; opening
  cooldowns are shorter and the wyrm walks faster; a melee blow can be held up to 0.5 s for fairness;
  fire patterns no longer overlap each other; the AI's backward bound was removed (it moonwalked) and
  its idle turn and sidestep were slowed; phase-1 pauses are 0.25 - 0.5 s (the plan said 0.6 - 1.0).
- **Not measured or not right:** nobody has played it. Phase 1 is under its target on two of five
  seeds and phase 3 on three of five; the wing sweep still misses on a quarter to a half of the
  placements in three strings; the grabbed tree reads from in front of the wyrm and poorly from
  beside it; shell and fireball impacts still show bright white knots; the breath's torrent look
  shows two or three hot knots; the wreckage left depends on how the fight went; the render time was
  measured on a desktop GPU at the phone's size (about 5 % over main), not on the phone.
- **The owner's pick of the three looks (2026-11-16):** "Keep a for all", from one sheet each on the
  final build (the roar at four moments; the breath at ignition, full stream and just after, alone
  with the old breath above it and again in play with the grass catching; the apocalypse at the
  rear-up, the cast's peak, the sky answering and the first impacts). So the shock ring is the
  rolling front of fire with dust behind it, the breath is the torrent, the apocalypse is the salvo
  of columns from the ground. These were already the defaults: nothing in the game changed with the
  pick. The looks turned down (ring b: crisp pressure strokes, c: the ground heaves; breath b:
  lashing tongues, c: liquid fire; apocalypse b: one pillar, c: cast from the air) stay behind the
  switches and in the FXLOOKS scenario, as the flare's did (ADR-118); they can be removed later.
  The white knots in breath look a are still open.

## ADR-120 — The wyrm ablaze, a forest that breaks, letters that follow the zoom; three heads kept for later (2026-11-16)
- **Context:** the owner asked for four things at once: a more menacing, realistic face for the
  wyrm ("a lego block dragon face"); that the dragon destroy "the tree walls surrounding the map",
  its melee and fire making the trees "slowly crumble and break", with "every background object"
  destructible; that the ASCII keep its quality when the camera zooms out; and that in phase 3 the
  wyrm "set himself on fire like its wing tips, claws, and tail". Answers to four questions before
  anything was built: three faces rendered to pick from; all of Cinderwood breaks, the two landmarks
  and the nest included, the bonfire stays; the zoom is a desktop complaint; the phase 3 fire burns
  the world and adds no damage to the hero.
- **Decisions:**
  1. **Every tree is a 'range' piece that can be posed.** The rigid batch (1023 bones) cannot hold
     560 trees, so a tree's body stays a run of vertices in one static mesh, split into parts, and
     moves by rewriting those vertices from a home copy (a quaternion about its base plus an
     offset), uploaded once a frame. Pooled rigid bodies borrowed for the fall were the alternative;
     posing covers shudder, lean, fall, carry, flight and reset with one mechanism and no bone.
  2. **Trees wear down in stages** (`BREAK.wear.at` 0.82 / 0.5 / 0.22 of the structure): parts of
     the crown drop in a burst of the tree's own characters, then it leans, then it falls. The
     trees inside the clearing wear the same way and keep their toughness.
  3. **The wall falls outward, quietly.** Trees past 32 m fall at least 0.55 away from the arena,
     and a fall whose strip cannot reach the hero's bound gives no tell, flash or strip: several
     times more trees can fall without a new source of damage (falling trees on the hero: 0 on five
     seeds).
  4. **The landmarks break.** This reverses ADR-119's "the Cinder Tree, the Elder Wyrm's skeleton
     and the bonfire stay whole" for the first two and the nest, by the owner's answer. The
     skeleton is 36 pieces, the Cinder Tree's trunk takes a fifth of a blow while a bough stands,
     every broken bone leaves a heap. The bonfire stays: it is the rest point.
  5. **The wyrm reaches the wall through wind and carried fire, on budgets of the wall's own.** The
     wyrm fights inside the clearing, so tougher or weaker trees could not answer the request: its
     roars, rings, wing beats, take-offs and landings send a front of wind that wears wall trees
     (never past the second stage), and fire that passes the hero carries on to the first wall tree.
     Neither changes an attack's hit, damage, timing or tell, and neither touches the clearing's
     pieces. Meteors that miss still land inside the arena (moving them would change the attack).
  6. **The burning body is fire-field heat with its own random numbers.** No glyph-sprite flames
     (ADR-113). It draws from a generator of its own, so a seeded fight deals the same hits with it
     off or on. It lights wood it passes (5 a minute at most, only from a part moving 3 m/s or more:
     standing beside a tree burned the Lab's grid down); the footprints are a scorch with small
     flames that never go through `world.fire`. It dims round every flash and near the hero.
  7. **The letters follow the player's wheel, not the camera's measured distance.** The boss framing
     keeps the camera 5 - 9 m beyond the wheel; a font chosen from the measured distance changed the
     fight's look at the default zoom and would step as the framing breathes. Past the default
     wheel distance the cell steps down a ladder of the existing pixel fonts (plus 3x5 at 2x), with
     hysteresis; zooming in never grows the letters; a phone keeps its one font. The house style's
     "one letter size" becomes one size per zoom step (ADR-093's pick is the look at the default).
  8. **Three heads kept for later.** The owner looked at the three rendered heads and passed: "lets
     pass on the remake of the dragon head for now." The head is unchanged; the skull, the loong and
     the demon stay behind `?wyrmFace=` as the hero's looks do (ADR-089). Their weak points when
     shown: teeth that print as one white wall from the side, scales that fight the sculpted form
     close up, a modest difference at the game camera.
  9. **The owner's picks:** zoom b (full strength) and fire b (trailing fire, burning footprints)
     of three rendered options each; a and c stay behind `?zoomArt=` and `?ablaze=`.
- **Consequences:** the forest lists 664 breakables on 228 bones (it was 183 on 368). The frame
  costs more: paired against the base at 1080p, 16 - 22 % more render time with the wall intact,
  14 - 21 % in phase 3, mostly the trees' new mesh (dynamic buffers, a stumps mesh), not the fire
  or the zoom; not measured on a phone. `world:impact` has a new kind value for a wear stage and
  its own sound. With zoom b the trees' letters step as well, and far stone prints denser. The wall
  after a fight is damaged over 37 - 57 % of its front rows in one to three long stretches, not the
  four separate ones aimed for.

## ADR-122 — The duelists' second pass: a director, links and a fairness guard; Shen Hui's third phase; the Lord's spells inside his strings; two arenas that break (2026-11-16)
- **Context:** the owner's request was made for all boss fights and the wyrm went first (ADR-119):
  "i want to make the boss fights a bit more harder, more epic, more crazy combos and flurries of
  attacks from them. ... improve the visuals, animations, and effects overall in general. ... each
  phase needs to ramp up the difficulty and chaos. ... i want the player to be constantly being
  forced to dodge, parry, move as the fight goes on. ... these fights should put the player in awe
  in terms of combat depth, visuals, skill, animation etc. plan all the new stuff out with fable and
  have opus agents do the work." Three read-only agents mapped the shared engine and both bosses
  first. What they found: a duelist's pick was a plain weighted roll with a flat chance to flow into
  another random move (no authored follow-ups, no depth cap, the same pause after a recoil as after
  any move); Shen Hui had 24 moves of which 14 were single blows, his long strings were cuts in
  place, phase 2 was a reskin plus four moves, the Kindling had no effect of its own and nothing of
  his stayed on the ground; the Starless Lord's big spells always came alone (one beat of 0.85 -
  1.4 s), his third form measured LESS busy than his second, and he fought on through the Starless
  Sky and the Dark Star with nothing spacing them from his blade. A pace meter written before any
  change gave the baseline, against a defender that only guards, five seeds, 120 s a phase: Shen Hui
  60 / 76 cues a minute by phase, the Lord 71 / 80 / 75 / 85 by form (the wyrm had 24 - 28
  before its pass: the duelists were already dense), and **132 pairs of cues that need different
  answers landing within 0.3 s of each other** (the Lord 8 / 5 / 32 / 86 by form, Shen Hui 1). The
  courtyard had 78 breakables and the crater 36; both floors were static meshes.
- **The owner's answers** (asked before anything was planned): the wyrm's recipe as it is; harder
  means **more pressure at the same damage**; **thrown pieces show the flare only** (pieces that
  topple and strikes called from the sky keep their mark); the owner picks every big new look from
  rendered options; **"everything but landmarks" breaks** in both arenas (the gate, the bell, the
  throne with its dais stay); and, against CLAUDE.md's standing rule for the human bosses, **"bodies
  may change"** (options first).
- **Decision:**
  1. **A director over a duelist's pick** (`duelist/director.js`, numbers in each boss's
     `TUNING.pressure`): every move has a category (string, single, closer, area, ranged, spell,
     terrain, hazard; declared with `cat` or derived from its beats); the weighted roll is steered by
     run limits, floors that bring an absent category back (his footwork seeks the range it needs),
     gap closers when the hero is far, a ceiling on live hazards, a `density` weight (moves that carry
     more cues a second are picked more) and a mixed-answers rule (nothing that asks a guard while a
     dodge is due, or the reverse). A kit without a `pressure` block behaves as before.
  2. **Combo links** (`<boss>/links.js`): each move lists follow-ups by where the hero is as it ends
     (near, mid, far, front, side, behind, away, guarding) with a chance per phase. A link, and the
     old flow roll, now start at HALF the recovery: the first half of every recovery stays the
     hero's punish window, the half in which he used to return to his guard is where the next move
     begins (the gap between two linked moves' blows fell from a median 1.1 - 1.4 s to 0.9 - 1.05 s).
     Up to `chainDepth` moves in a row, then a short rest. **The hero's openings keep their length**
     (`openingGap`): a recoil, a stagger, reeling, trampled and a break are still what they were.
  3. **A cue ledger and a fairness guard** (`duelist/ledger.js`): the brain keeps the impacts it
     knows are coming (the running move's beats exactly; crescents, the returning blade, torn
     stones, called strikes, thrown pieces, rings of sound and the world's falling pieces from a
     predictor; new things through `brain.expect`) and never lets two cues that need different
     answers land within 0.3 s (0.4 s for the Lord: a roll allows no guard for 0.52 s). A blade blow
     waits at its cock like an authored bait hold (at most 0.5 s; the cue and the blow move
     together); if no hold clears it the blow becomes a feint; a called strike comes up to 0.9 s
     later or fades unstruck; a thrown piece that cannot be cleared lands uncued and harmless; the
     world's falling pieces win over his own things in flight. A blow at risk is announced only once
     the guard has cleared it, so a feint made this way cannot be told from an authored one.
  4. **Shen Hui has three phases** (gates at 64 % and 36 % of his health; the lead's decision, put to
     the owner afterwards: "Keep three phases"). Phase 1, the fencer: strings that move (a glide, a
     kick, a spin that travels, a feint from the other side, a nine-blow string that re-closes on a
     hero who stepped back, sword qi as a string's last word). Phase 2, the kindled blade (the
     Kindling now has a body): his big cuts leave lines of fire on the stones, fans of qi, a zig-zag
     of burning dashes, leaps that land in a ring of fire. Phase 3, ash on the wind (a new change,
     `ashWind`): he is gone into ash between blows and strikes from another side inside his normal
     strings, leaves afterimages, an eleven-blow flurry, a storm of nine crescents. Sixteen new
     blade moves and three on the floor's slabs; no blow is faster than phase 2's (the 0.42 s first
     windup and 0.32 s between impacts stand): there are more of them, from more places.
  5. **The Starless Lord's spells sit inside his strings.** Nineteen new moves: in form 1 the hand
     feints, bolts fall between cuts, a pull drags the hero into the string, the Crushing Dark ends
     one; in form 2 the off blade is thrown as a wheel in the middle of a string and caught before
     its last blow; in form 3 strings walk the hero down and end in fissures, torn stones orbit him
     and fire in the string's pauses, the Dark Star is cast inside a string; in form 4 blink strings,
     lightning as a rhythm, **the Starless Sky as weather** (a strike every 3.2 s with a full bar
     down to 1.8 s with an empty one, at most two live, called into his moves' pauses, never into
     the hero's opening) and **Starless Night**, a great spell of three waves across the crater.
     A perilous thrust is in every form; after a red spell he follows with a red blow.
  6. **Thrown pieces show the flare only**, drawn on the flying piece one `flashLead` before it
     lands (the kicked lantern and flagstones; Void Hurl, Glass Rain, the Falling Halo). **This
     supersedes ADR-109's and ADR-111's landing marks for thrown pieces**, as ADR-119 did for the
     wyrm; a felled pillar or colossus, a wrenched shard and a strike of the Sky keep their mark.
  7. **Both arenas break.** The courtyard has 456 breakables (78 before), the crater 222 (36): both
     floors (293 flagstones; 81 plates and 24 flagstones), the colossi in two stages (the upper half
     topples by the world's falling-piece rule, the legs stand as cover), the cauldron, the lintel,
     stumps, the rim's low stones, the vents' stonework. A floor slab is whole, cracked or broken and
     an intact floor costs no extra draw call (the slabs are ranges of the set's paving mesh, the
     cracked and broken looks two meshes hidden until first used). A slab can be lifted (a new lift
     class that today's pickers ignore) and both bosses have moves on it. The pieces live in a tree
     OUTSIDE the scene graph (three walks every scene node every frame: on the phone preset the
     courtyard had cost 21 % more than `main` and measures within 4 % now).
  8. **Effects have bodies, and looks never touch gameplay's dice.** One shock front for both
     duelists (ragged, slowing, dust that hangs), the Kindling, ash on the wind, afterimages, sword
     qi, burning ground, the Lord's spells redrawn in the fire field. Look-only jitter draws from
     its own random streams, a light no longer seeds its flicker from `Math.random`, and a test in
     each suite proves that no look option changes a fight.
  9. **Look options behind one switch helper** (`duelist/lookSwitch.js`): a redraw kept the look as
     it shipped behind option `0` until the owner had picked; the picks are a table in that file;
     `?looks=old` shows every redraw as it was before this pass; the Lab has a LOOKS section that
     flips each one (for judging on the phone). The owner's picks are recorded below.
  10. **Burning ground against a held guard drains the guard meter, never health** (the owner's
      choice of three: the fire is ground to step off, and a block must not cost health, ADR-095).
- **Why a guard in code and not careful authoring:** the Lord already had 131 unfair overlaps before
  a single move was added, from things that are each fair alone (a string, a strike called a second
  earlier, a piece his own blow felled). More moves and weather for a whole form would have made it
  worse; a ledger makes it a property of the engine that a test can assert at zero.
- **Why links cut the late half of a recovery:** the pace meter showed him inside a move 95 % of the
  time already. Shorter pauses had almost nothing left to give; the dead time was the half of each
  recovery in which he only returned to his guard, and the first windup of the next move.
- **Why a third phase for Shen Hui:** "each phase needs to ramp up" with two phases is one step. His
  blows could not get faster (the tell rules), so the third phase ramps in kind: where the blow
  comes from, and how much of the yard is ash and fire.
- **Measured** (the PACE scenario of `duel.mjs` / `lord.mjs` on the final build: ten seeds, 120 s a
  phase, a defender in god mode that only guards and rolls; cues a minute, the mean of the seeds;
  the baseline was five seeds): Shen Hui 60 / 76 (two phases) → **78 / 92 / 99**; the Lord
  71 / 80 / 75 / 85 → **83 / 91 / 98 / 109**. Each phase busier than the one before: Shen Hui on every
  seed, the Lord on every seed too (his third form by as little as 0.7 % on one). Longest gap between cues: Shen Hui 3.2 / 2.7 / 3.2 s, the Lord 2.9 / 2.8 / 3.3 / 2.6 s.
  **Conflicts: 132 → 0.** The share of cues that ask for a dodge: Shen Hui 13 / 17 / 19 % (it was
  5 / 6 / 9 % before his tuning), the Lord 18 / 16 / 16 / 38 %.
  (The pace above is the build with `main`'s wyrm pass, ADR-120, merged in; the bots, the floors'
  shares and the frame below were measured on the last build before that merge.)
  Mortal bots on three seeds: one that answers 95 % of cues wins every fight against both (as on
  `main`); 85 % wins every fight against Shen Hui and two of three against the Lord (all three on
  `main`); 70 % dies in all three against the Lord and in one or two of three against Shen Hui (one
  of three on `main`; these outcomes move by a fight between builds). A pure defender that never
  attacks survives two minutes of every phase and form (on `main` it died in the Lord's fourth form
  on one seed). The worst second of damage a bot took: Shen Hui 50.6 (57.5 before); the Lord 59.4
  (57.2 before: four blows of one string on a defender who missed one). A four-minute duel leaves
  33 - 48 % of the courtyard's floor inside his bound broken; the crater 25 - 40 % in about a minute.
  Frame, paired against `main` on a desktop GPU: phone preset 852 x 393 courtyard -4 %, crater +4 %;
  1280 x 720 -4 % / +2 %; the fire field peaks at about 3000 of 6000 blobs in the Lord's fourth form
  with the weather and Starless Night (1500 on `main`).
- **How it was built:** the lead planned, reviewed every sheet and merged; Opus agents built, each
  in its own worktree on its own files. Three mapping agents; then core (the director, links, the
  ledger and guard, the pace meter), world, the shared and Ash effects, the Lord's effects and the
  bodies at once; then the two bosses' moves and both bosses' terrain on top of the merged core;
  an integration agent for the seams; a tuning agent per boss; a picks, an engine and a docs agent.
  Sent back by the lead: the third phase's change (three options too faint and too alike), the
  broken floor (it printed as blank holes; cracked slabs could not be seen), the Lord's shocks
  (drawn by a fallback until the shared front existed) and the scene-graph cost on the phone.
- **Changed without being asked** (each agent's own call, surfaced for the owner):
  - one number of the WYRM: Furnace Maw's bite is cued 28 ms later (`impact` 0.09 → 0.118 s): on
    `main` it landed up to 100 ms after its cue on one mirrored side, which a seeded test had been
    hiding;
  - Shen Hui: individual blow damage moved inside eight strings (one blow became a red 22, the
    others gave that damage back: every string's total is unchanged, no blow is above 26); the
    phase gates are 64 % / 36 % (62 / 30 as first built); every old move was re-weighted (his
    single blows are openers and link targets now); a crescent that would arrive too soon to be cued
    is not thrown at all; the bell is not rung with the hero beside it;
  - the Lord: a white or blue blow out of a blink now meets a guard from any side (a guard or parry
    of a blow that arrived behind the hero used to fail); his own separation is 0.4 s; his lone slow
    spells are picked far less; Wheel of Stones is no longer picked from beyond its cuts' reach;
    while his blade is in the air he starts no blade move; Void Hurl and
    Glass Rain wind up 0.2 s faster, land in a smaller reach (1.8 m, 2.1 before) and take floor
    plates before the crater's shards;
  - both: a blow may become a feint or a strike may fade when the guard cannot clear it; pauses
    (`idleGap`) are shorter and the flow chance higher; red ring blows throw a ground shock as they
    land; the posture break's ring and the dust puffs were redrawn with no option;
  - the world: the hero can fell a colossus onto the boss (286 damage) and his own low sweeps and
    slams break floor; 49 more dead trees and 32 stumps round the courtyard are breakable; a vent
    flares when its stones break; Cinderwood's flagstone shards are hidden until one breaks;
  - `render/lights.js` seeds a light's flicker from its own stream: every seeded test outcome
    differs from before.
- **Not measured or not right:**
  - nobody has played it; pace, fairness and the bots are measurements, not a fight;
  - **the fights are hardly deadlier for a bot than before**: a bot with a fixed answer rate wins
    or dies almost as on `main` (the one change: the 85 % bot now dies on one seed of three against
    the Lord), and both fights last about a minute for a bot that plays well (each phase or form
    ends by a posture break in 8 - 25 s). The pass made them busier, more varied and fair; how much
    harder that is for a person is the owner's to feel. The levers for a longer or deadlier fight
    are posture and health, which this pass did not touch;
  - a cheese spot that was already there: behind the Obsidian Throne the hero is out of reach of
    everything the Lord has;
  - a missed blow inside a long string often costs most of the string (the hero's stagger is as long
    as the gap between blows); already true on `main`, and the strings are longer now: it is why the
    Lord's worst second is 59.4 where it was 57.2;
  - the fairness guard still steps in 1 - 4 times a minute in the Lord's fourth form (mostly world
    pieces his own blows fell), and two GUARD cues from different sources can land 0.1 - 0.25 s
    apart (a held guard takes both, two parries cannot);
  - the Lord's new keys (the vault back into the Rift, the wheel's catch) were looked at from four
    sides at game scale but no joint or hand speed was measured; Shen Hui's new poses from two
    sides; no palm strike was authored (his free hand still never strikes);
  - phase 3 has no music of its own (phase 2's plays on); no new sound was made for any new move;
  - the iPhone itself: the frame was measured on a desktop GPU at the phone's size;
  - three.js draws object ids from `Math.random`, so a seeded test's outcome still shifts when the
    world builds one object more or less: the pace meters were set over five to ten seeds for that.
- **The owner's picks (2026-11-16, from one sheet per switch, the look as shipped on top):** "Authors'
  picks" for Shen Hui's effects (the Kindling as a front of fire with a gout off the blade, phase 3
  as the wind taking him, sword qi with a body and a wake, the flit as a ghost and a stream of ash,
  burning ground as a glowing seam, the bell's rings as ragged fronts of steel) and for the Lord's
  (the Dark Star as a starless sun, a strike of the Sky answered inside the frame, each form's
  ignition with its own sign, his smaller spells and blades with bodies, a quiet presence for forms
  2 and 3, Starless Night as the dark tide); the bodies **"b: dressed by phase"** (Shen Hui's hem
  smoulders in phase 2, in phase 3 the hat is gone and his hair loose; the Lord's cape tears form by
  form, cracks of red light open in his harness, in form 4 the hood is back and the faceplate split;
  the dragon look was shown and turned down: at the duel camera a man in the wyrm's digits is a
  block of digits); the broken floor **"a: rubble on earth"**. The looks turned down stay behind
  their switches (`kindle`, `ashp3`, `qi`, `flit`, `burn`, `toll`, `ashLook`; `star`, `sky`,
  `ignite`, `void`, `presence`, `great`, `lordLook`; `floor`), as ADR-118's and ADR-119's did.

## ADR-123 — The Cinder Wyrm's build: lean, a fierce head carried high, a mane of quills; drawn only (2026-11-20)
- **Context:** the owner asked for a better-looking wyrm ("more realistic, scarier, epic, and
  mystical"; the wings are its best part) and three variations to pick from. Three full redraws were
  rendered and all turned down: "i dont like any of the remakes. i want the dragon to look more
  menacing, a bit more slender", with a picture of a lean, long-necked dragon roaring with its head
  raised. The shipped wyrm's surface is the house style's reference (ADR-093, ADR-100), and the
  owner had passed on new heads once already (ADR-120).
- **Decisions:**
  1. **Keep the surface, change the build.** Letters, ramp, colours, scale lattice, glow and wings
     are untouched. What changes is girth, lengths of spines, talons, horns and fangs, the head's
     drawn width and size, and how the neck is held at rest. A redraw of the surface was the
     alternative and is what the owner turned down three times in one day.
  2. **A build is data** (`entities/dragon/looks.js`): `barrel`, `limb`, `neck`, `tail`, `talon`,
     `head`, `rest`, `quill`, `mane`. Three were rendered, each adding to the one before (a lean, b
     + fierce head carried high, c + quills). The owner picked **c**; it is what `buildDrake`
     builds with nothing set. `?wyrmLook=0` builds the wyrm before; a and b stay because they are
     subsets of c's numbers and cost no code.
  3. **Drawn only: the skeleton does not move.** Slimming is baked into geometry in the joint's
     frame (`model.js` `slim`), never a joint's scale or position: breathing owns the trunk meshes'
     scale, and every reach, hit volume, foot plant and attack path hangs off the joints. A longer
     neck, tail and legs (the picture's proportions) would change `ANATOMY` and with it every
     measured attack; that was offered as a separate step and not taken.
  4. **One exception, at rest only.** The head carried high is the visible neck's resting shape
     (`rest.neck`, read in `rig/anim.js` in place of `REST_POSE.neck`). It fades out with the rig's
     resting weight as any attack aims the head, so a blow's head is where it was measured (the
     bite: 0.000 m from the old build at its snap). While it stands the head is 2.5 m higher; the
     head's and neck's hurt volumes were out of a standing hero's reach before and still are.
  5. **The horn's tip is measured, not written down.** The old head's horns grow with the build,
     so `buildOldHead` returns the built main horn's farthest vertex (`model.hornTip`) and the
     phase-3 horn fire reads that before `heads.js` `HORN_TIPS`. Measuring showed the written
     `HORN_TIPS.old` had left out the horn's curve (0.52 m low); it is corrected.
- **Consequences:** the default wyrm builds 2 304
  more triangles (+1.8 %), the same 14 draws and 181 bones. Tests seed `Math.random` per build and
  three.js draws ids from it, so the default build shifted the fight's random stream. The body's
  hurt spheres are the old barrel's: generous under the tucked belly. From the steep game camera
  the trunk's change is small; the head, the neck and the mane carry it.
- **Not done:** longer bones; any change to the wings, the surface or the fire; a re-frame of the
  intro's shots and the Lab's model viewer for the higher head; a look on the iPhone.

## ADR-124 — The Cinder Wyrm's face: the drake, on a kit of planes, dark sockets and a dark mouth (2026-11-20)
- **Context:** right after the lean build (ADR-123) merged, the owner: "I really dont like how the
  dragon face looks. It doesnt look realistic or scary. Give me 4 different variations to review". The
  owner had passed on three sculpted heads before (ADR-120). Photographs of the shipped face showed it
  could not be found at the game camera (dark, under the neck's pale quills, eyes one letter wide) and
  read as a scaled tube up close (the body's big rimmed scales, a comb of teeth, a flat orange mouth).
- **Decisions:**
  1. **Fix the surface first, then vary the skull.** All four faces share one kit: fine scales under a
     hard key light (planes, not a pine cone), eyes in black sockets, a black mouth with a red tongue
     and the fire at the back of the throat, outlined teeth of varied size, a nape cleared of quills.
     The skulls differ (drake, tyrant, viper, revenant). The ADR-120 heads had shown that a new skull
     under the old surface reads as the old face.
  2. **The owner picked the drake.** It ships (`heads.js` `WYRM_FACE_SHIPPED`); `?wyrmFace=old` is the
     face before; tyrant, viper, revenant and the three of ADR-120 stay behind the switch, as the
     turned-down looks of ADR-118 to ADR-123 do.
  3. **Hollows are a material, not a shade.** Sockets, nostrils and the mouth's lining are triangles of
     the loft repainted into a near-black `pit` material (`paint` rules in a face's data). Darkening
     the hide there was tried and printed grey under the hard key light. It costs one draw call.
  4. **A face may clear its nape** (`nape`: the crest's and mane's lengths over the last neck
     segments), so the skull's outline stands free of the mane build C grew. Only for faces that ask.
  5. **The fire knows the horns.** A face's extras return its main horn's tip; `model.hornTip` carries
     it to the phase-3 horn fire as the old head's measured tip already did (ADR-123).
- **Consequences:** the default wyrm draws 15 meshes (14), 183 bones (181) and 7170 head triangles
  (4192); the gameplay joints, hit volumes, the breath's origin and every timing are unchanged
  (`integ.mjs . wyrmface`). The extra objects shift the tests' seeded random stream (every suite still
  passes). The four faces differ much more up close than at the game camera.
  6. **The tests roll on a play stream seeded after the build.** `integ.mjs` reseeds `Math.random`
     at the end of `build()`, so the AI's rolls no longer depend on how many three.js objects (each
     draws a uuid from it) the build made. The alternative, loosening the two checks the drake's
     extra objects turned red, would have hidden the next shift too. The new stream exposed a late
     string bite (fixed: `TUNING.biteLate` 0.07 s, after which a string's bite misses) and a terrain
     check that counted feints instead of checking why each had no flash (rewritten).
- **Not done:** a look on the iPhone; the intro's close shots framed for the new head; the
  tyrant / viper / revenant data kept but not tuned further.

## ADR-125 — The edge of the open ground follows the tree wall: the hero and the wyrm leave the clearing where it has come down (2026-11-21)
- **Context:** the owner, after ADR-120 made every tree of Cinderwood breakable: "the terrain still
  isnt as destructible as i'd like. like the 1st dragon level, the outer tree border ring should
  slowly crumble and allow the dragon and player to move outside as the dragon destroys the trees
  with its attacks and fire". Measured first on `main` (seed 1337, 80 s a phase): 27 of the wall's 153
  front-row trees were down at the end, all burnt through, and it made no difference to the fight:
  the hero was held on a circle of 31 m and the wyrm's root on one of 24 m whatever stood.
- **Decisions:**
  1. **The ground ends at the trees that stand** (`world/edge.js`). The ring is cut into 120 lanes;
     in each the hero's ground ends 1 m short of the nearest tree still standing in it. Chosen over
     (a) treating every crown as a big collider and letting him thread the forest (its trees stand
     5 m apart on average: it would have been open from the start and the wyrm's AI would need path
     finding), and (b) a flood fill over a grid (the same leak, and the ground would no longer be
     star-shaped). Lanes keep the ground star-shaped round the centre: a radial clamp is enough for
     the wyrm, the hero can always walk straight back in, and the AI needs no path.
  2. **Nothing moves until a tree is down.** Every lane is sealed at the old circle until its nearest
     tree has come down, so the start of a fight, every tuned distance in it and every existing test
     are as they were. The alternative, the honest tree line from the first frame, opened bays up to
     15 m deep behind the landmarks and the whole path south before any tree had fallen.
  3. **A sealed lane with no tree near the line gives way sideways.** Behind the Elder Wyrm's
     skeleton and the Cinder Tree no tree stands within 5 - 15 m of the line; left sealed they were
     invisible walls beside open ground. They open as far as their more open neighbour, never past
     their own trees. A lane with a tree within 2 m of the line stays shut, or the first breach
     would have moved the whole ring out by a metre at once.
  4. **The hero gets side walls, the wyrm a slope.** The hero is kept by the lanes' ends and their
     radial side walls (a step sideways out of a deep lane is put back in it). The wyrm's bound is a
     radius per direction: its share is the hero's less 3 m at each side of a gap, then no steeper
     than 2 m out per m along the ring, so a radial clamp cannot drag it hard sideways and a slot two
     trees wide lets the hero in and not the wyrm. With a first slope of 1 it stood 21 m from a hero
     at the back of a 28 m wide gap and fought at range; at 2 it stands 11.5 m from him.
  5. **Only the wyrm's moves that put its root somewhere read the new bound** (`dragon.boundAt`:
     its collision, the charge, the leap and hop targets, the flights, the terrain moves' stand).
     No attack's hit, damage, timing or tell changed. A leap or a dive crosses a corner of the
     standing wall in the air (up to 3.8 m over the line in the test) and lands on its ground.
  6. **Out there is no shelter.** Meteors and pillars were clamped to 27 m of the centre and a
     barrage's waves cover the clearing: a hero in a gap would have stood outside all of them. The
     clamp moves out with his ground, and a wave's disc moves with a hero who has left the clearing.
     A wall tree falling onto ground he can reach tells red again (ADR-120's quiet fall asked "can it
     reach his circle"; it now asks "can it reach his ground").
  7. **The wyrm's reach to the wall was not raised.** With the edge open its body goes to the wall
     and fells it: on the same seed the front rows went from 27 down to 46, the whole forest from 501
     standing to 482, with no number changed. Letting wind fell trees was the alternative and was
     not needed.
  8. **One line of feedback.** The feed says once a fight that the wall is torn open (`world:edge`),
     and the minimap draws back so the hero stays on it. No new mark on the ground: the standing
     trees are the wall.
- **Consequences:** over a 4-minute headless fight (three seeds) 86 - 90 of the 120 lanes are open at
  the end, the furthest 51 - 54 m out, the hero's ground 47 - 61 % larger than the circle. The
  forest has 454 collider circles (every trunk out to 65 m; it was those within 42 m). A level
  without `edge` is untouched. `world.resolve` has a fifth argument; `Destructibles` owns the edge
  so the tests' mock worlds get it with the pieces.
- **Not done:** nobody has played it. The hero bot of the fight meter stays near the wyrm and went
  34 - 40 m out at most, so how often a real player ends up in a narrow gap out of the wyrm's melee
  reach is not measured. The landmarks' pieces close no lane (the ground behind the skeleton opens
  when a tree beside it falls, not when its ribs break). The ground cannot go past 62 m. The Ashfall
  Courtyard and the crater have no wall that opens.
## ADR-126 — A duelist's move is motion, not a row of poses: the follow-through's own clock, a cubic through the keys, beats that own their channels, feet that step (2026-11-21)
- **Context:** the owner: "the humanoid bosses have weird attack animations and unnatural poses.
  analyze it and fix it". An audit of every move of both bosses on the rig (DEVLOG Session 66 has
  the tables) found the sword hand crossing up to 0.63 m in one frame, feet that slid 4 - 10 m
  through a string without lifting, channels running on from one beat into the next, and the Lord's
  blade through his own hood. All of it came from how the shared engine turns a move's data into a
  clip, so that is where it was fixed: 106 moves, two files of pose data, one engine.
- **Decisions:**
  1. **Gameplay time is not touched.** Tells, windups, holds, flashes, impacts, active frames, zones,
     root motion and `uAt` are what they were. Everything below is on the clip's side only; the test
     suites pass without a changed threshold.
  2. **A follow-through has its own clock.** A beat's keys past the impact (u 1..2) run over
     `b.F`, not over the active frames: 72 % of the time until the next beat's first pose, 0.24 s at
     most (0.3 s for a spin, whose whole turn is on that clock: 0.18 s for a full turn was a blur),
     never under the active frames. Turned down: stretching the active frames (it would move the hit
     window), and capping the hand's speed in the solver (it would detach the hand from the blade).
  3. **In a string the follow-through is the next wind-up.** A key marked `gather` is left out of a
     beat that follows another, a key marked `settle` out of a beat another follows. A bait hold
     repeats the cocked pose at its end, so the strike out of a pause is as fast as any other.
  4. **A key is passed through.** Fields run on a cubic through their keys with shared tangents (the
     harmonic mean of the two slopes, zero where the field turns back); `i` still arrives at twice
     its segment's slope, `l` and `h` are what they were. Monotone by construction (tangents capped
     at 2.2 x the segment's slope): no overshoot. This holds for every compiled clip, reactions too.
  5. **A beat owns its channels.** `completeBeat` writes the guard's value for every field a beat
     never keys, on its first and last key. The blades' directions are the exception: they carry
     from cut to cut on purpose.
  6. **The blade-driven arm reads the keyed angles**, and knows about two hands: a smaller circle
     nearer his middle, never far out at his sword side.
  7. **A move's feet are planted in the world** (`anim.js _feetClip`, on the walking planner's own
     state, so a move starts from the feet he stood on and the walk resumes from where it left
     them). A lifted foot, a body off the ground or a dash over 9 m/s is the clip's own. Only clips
     with `steps` (a realised move) get it: reactions, deaths and every clip of the hero do not.
  8. **Poses changed only where the audit or the film named a fault:** the spare arm, the overhead
     and its chop, the thrust's stop, Shen Hui's whirl, the Lord's flourish. The guards, the
     silhouettes of the cuts and every blade path are the ones the owner picked or played.
- **Consequences:** a new move gets all of this from the engine; its author marks the draw from the
  guard `gather` and the easing-back after a follow-through `settle`. A beat that wants a channel to
  carry from the beat before must key it. Authored u in 1..2 no longer means "during the active
  frames" for a pose (it still does for `travel` and `lift`).
- **Not measured or not right:** see DEVLOG Session 66 ("Not checked / open"): nobody has played
  it; the Lord's left elbow in the staff's spins; reaction clips not audited one by one.

## ADR-127 — The drake's glare: a slanted almond eye turned to every side; the sims reseed at each model's build (2026-11-21)
- **Context:** the owner turned down four anime faces ("the eyes look very weird") and asked for the
  drake's standing-view eyes, "angled and angry", from every angle, realistic and scary. The drake's
  eye was an ellipsoid in the side wall of the skull; its slant came from the head's pitch in one view.
- **Decisions:**
  1. **The eye is an almond, not an ellipsoid** (`eyeMesh` `leaf`): pointed corners, the outer one high,
     and its face turned out, up and forward together, so the slant is drawn into the eye itself and
     shows from the side, the front, three-quarter and below.
  2. **The brow makes the anger.** It drops lower over the snout and rises steeper than the eye, so it
     cuts the eye's upper edge from every side; an orbit rim and a dark hollow seat the eye.
  3. **The anime faces are not kept.** They were turned down outright, unlike the heads behind the
     switch that were set aside for later; their code is a patch outside the repo.
  4. **The sims reseed when a model is built.** `Dragon` and `Player` call `game.onModelBuilt?.(who)`
     right after building their model (nothing listens in the game), and `integ.mjs` reseeds its stream
     there. The end-of-build reseed of ADR-124 missed the rolls each constructor makes right after its
     model; a bisect showed eight extra draws and two extra geometries give the same fight.
  5. **The resting neck arches into the head** (the owner: "the dragon does a weird twist angle that
     looks like his neck is broken"; same PR). ADR-123's high neck (`looks.js` `HIGH`) rose almost
     straight up and still pointed ~16° up at the skull while the resting head looked ~37° down: a
     ~56° hinge (the 63° limit, often). `HIGH` now arches over at the top (`pitch0` 1.6, `pitchStep`
     -0.06, `pitchCurve` -0.045; the head ~1 m lower, still high), the resting head stays within ~34°
     of the neck's end (`1.1 - 0.5 * rest`) and is held level about its snout at rest (the minimal
     rotation down a neck curved toward a foe far to one side rolled it ~40°). Rest only: every
     attack's measured neck and head are untouched. The eyes went a quarter smaller (`leaf` len 0.21).
- **Consequences:** the shipped drake builds a few more triangles and the same draws and bones. One
  statistical band moved with the new stream (`TUNING.world.meter.wall` lower bound 0.3 -> 0.25). Any
  future change to a model's object count no longer moves the seeded fights.
- **Not done:** the eyes from straight above stay small; not seen on the iPhone.

## ADR-128 — A felled tree lies as the blow left it: its stump, its fall and its trunk follow the kind of blow (2026-11-21)

- **Context:** the owner, after seeing the tree wall come down (ADR-125): "make the cleared trees not
  look the same and have it broken in different angles based on how it was hit". Every felled tree
  left the same squat stump (one per tree, built at load), fell straight along the blow and left one
  straight log from its stump in one of 3 shapes; a tree that burned through dropped a black log at a
  random angle. A cleared stretch read as rows of identical logs pointing out.
- **Decision:** what a felled forest tree leaves depends on the kind of blow (`BREAK.fell`, per
  `cut` / `blunt` / `blast` / `fire`), on a cosmetic stream of its own.
  1. **The stump is cut by the blow.** The stump's run is reshaped once when it shows
     (`RangeBody.reshape`, put back by the reset): its height (a blade: about where it bit, the blow's
     `y`; a blow knocking it over lower; a blast lowest), its top on a plane slanted along the blow (a
     blade: a clean slant either way; knocked over: torn higher on the side it fell to), splinters
     out of that plane (few for a blade, many for a blast), pushed over a little toward the fall.
     Burnt through: low, rounded, black at the top.
  2. **The fall turns and rolls.** It goes over up to `spread` off the blow's line (a blade 0.08 rad,
     a blast 0.4; the wall's outward rule still applies) and rolls about its own trunk on the way
     down. The red tell and its strip are worked out after the turn, so they show where it lands.
  3. **The trunk lands its own way.** Turned up to `yaw` as it lands, 0.85 - 1.15 of its length, its
     far end resting raised on its crown, and for a share of falls (8 % for a blade, 35 % for a blow,
     60 % for a blast) broken in two with a kink between the halves. Three crooked log shapes with a
     snapped bough (two black ones) join the plain ones.
  4. **Some burnt trees stay standing.** 40 % of the trees that burn through leave a black snag on
     their stump (a black log stood on end, 35 - 70 % of the tree's height, leaning up to 0.25 rad);
     the rest leave a black trunk, sometimes in two.
- **Why this way:** the stump and the log are what is left in view for the rest of the fight, so the
  variety goes there; the falling tree is on screen for a second. Reshaping the stump's own vertices
  once costs nothing a frame and needs no new mesh; a snag is a pooled black log stood up, so it needs
  no geometry either. A separate stream keeps the chances that decide play (the fire's spread, the
  leans) drawing what they drew before.
- **Consequences:** no collider, hit, tell or timing changed; the wreckage pools are the same size (a
  split trunk takes two logs: the oldest sink sooner). `Wreckage.log` takes a `pitch`; a log has
  `size` (its length) besides `len` (its reach over the ground). The world test `spread` now starts
  the module's stream from a known point (`reseedBreaks`): it hung on a 9 % chance that moved with
  every change upstream.
- **Not done:** a stump is still one cut plane, not two halves of a split trunk; the falling crown is
  not broken by the blow; the Cinder Tree and the landmarks keep their own remains.

## ADR-129 — A fourth level: the Skybreak Ring and Tian Lei, the Last Ascendant: a bare-handed duelist in three forms, his ki, a ring that is wrecked (2026-11-21)
- **Context:** the owner: "lets build a saiyan level boss where phase 1 starts from normal saiyan, phase 2
  is super saiyan, phase 3 is super saiyan 2. make the background the cell tournament arena and make it
  feel like an anime epic battle. help me come up with the moves, combos, specials from the boss and use
  opus to build this out". Planned by the lead (Fable), built by Opus agents in two waves, an
  integration pass and a tuning pass (DEVLOG Session 69).
- **An original character and place, in that spirit.** The lead would not put an existing series'
  characters, names or arena into the game (ADR-116: a game of its own), and said so before anything was
  built. So: TIAN LEI, THE LAST ASCENDANT, a bare-handed fighter who is beaten three times, each time in
  a greater form (the Challenger; Golden Ascension; Thunder Ascension), on the SKYBREAK RING, a
  tournament ring of stone tiles on the badlands (`?level=ring`). Two things were steered away from a
  likeness on the way: a bare-chested outfit with a swept-up gold mane (built, not offered, removed) and
  a beam charged with cupped hands at the hip (his technique is a palm drawn back at the ribs, the lead
  hand sighting, a palm thrust).
- **The moveset was agreed before the build** (the owner: "Build it"), with four changes the code's facts
  forced and the owner accepted: the sky is never on screen (the camera looks down at 58 degrees), so
  "the sky changes with his form" is the LIGHT changing; buttes stand 20 - 35 m off instead of mesas on
  a horizon; the hero has no air state, so a "launch" is an 11 m knock-back with a knockdown and a blink
  to where he lands; the play surface is flat, so there is no ring-out.
- **Decision, the frame:** three forms, a bar each, the Starless Lord's structure (ADR-069): an empty
  bar or a broken posture leaves him on one knee, the deathblow ends the form, and he TRANSFORMS (2.3 s,
  then a shock ring; nothing lands on him until it goes out; his hair, his light and his aura change AT
  the nova: `d.dressPhase`). Harder forms are more pressure, never more damage (ADR-119, ADR-122).
- **Decision, bare hands on the duelist engine:** no weapon. The engine's "blade" (what the hero's parry,
  the trade, the lock and the trails read) is the STRIKING LIMB of the moment: the forearm of a punch,
  the shin of a kick, the blocking forearm in a guard. His strikes are built by `punch / kick / elbow /
  shoulder` builders; his guard clips are forearm blocks under the engine's keys.
- **Decision, the engine grew by optional beat fields** (a beat or a kit without them is as before; the
  other two bosses' files are byte-identical to `main`): `zone.fwd / side` (a zone placed off his root),
  `air` (a blow tested whatever his height) and `T.airFall`, `sustain { dur, tick }` (a beat that stays
  lit: the ledger holds its whole window; with ADR-126's follow clock, `F = A + S`), `selfHit` (a beat
  whose owner does its own hit test), `brain.startLock(o)` and the blade lock AT RANGE
  (`player.bladeLock.dist`), `Player.streamBlock` (a blocked stream costs guard, never health),
  `_tradeNow` ignoring those beats.
- **Decision, his moves plug in by a routing contract, not by editing his class:** a move or a beat
  marked `ki: '<kind>'` goes to `kiBeam.js` (kinds starting with `beam`) or `kiShots.js`, `terrain:` to
  `terrain.js`; move files are functions of the builders object. This is what let four agents build
  forty moves in parallel with no shared file.
- **Decision, gold is a palette, not a fifth kind of heat:** the fire field's four channels are full, and
  its tint zones belong to the tells. This level swaps the VOID slot's palette for gold
  (`FireField.setPalette`; a level is its own page load, and void is only the Lord's).
- **Decision, the beam and THE CLASH:** a beam is a fixed line (a sighting thread shows it from the moment
  it is fixed, at its cue), a first contact that throws the hero along it, then ticks (capped at three,
  the third throws him clear); a held guard pays guard only. Every beam trenches the tiles and its
  damage to the world carries on to 45 m, so it can take a butte's top. The great beam's head is a blue
  parry moment: a PERFECT parry starts the blade lock at range (the camera frames both); won, the beam
  is split and he reels 4.6 s; lost, 40 damage and a 12 m throw. Stepping off the line stays the safe
  answer.
- **Decision, fairness with things that linger:** while a beam is lit, the disc is out or the cage
  closes, he starts nothing that asks a guard; Thunderfall (form 3's weather) stands down for a beam and
  fades in the hero's openings; after a red thing of his he follows with a red blow or keeps his
  distance (`AFTER_RED`). PACE: 0 conflicts over ten seeds in every form.
- **Decision, two foot planners together:** `main` gained ADR-126's `_feetClip` while his own planner
  was being written. Measured, the two together slide least (0.00 - 0.78 m a string; the engine's alone
  up to 3.72 m, his alone up to 4.14 m), so both stay: his lifts a stepping foot above the engine's
  "in the air" line, the engine pins what he leaves on the floor.
- **The owner's picks** (rendered options, 2026-11-21): arena a (the ring on the flats) of three; body a
  (a crimson tunic and a topknot that rises into a gold plume) of three; aura a (a tall flame, hollow
  behind him) of three; beam a (the column) of two; then the calmer, darker floor and his lighter figure
  ("Keep both"). The others stay behind `?ring=`, `?ascLook=`, `?ascAura=`, `?ascBeam=`, `?ascLift=`.
- **The lead's call, to be confirmed by play:** 2000 health a form and a posture meter of [900, 1000,
  1100], the middle of four measured settings (COMBAT.md has the table). The tuning pass had set 4000 /
  [2400, 2700, 2900]: the 95 % bot's fights did not get longer at the short end (an answered flurry
  breaks him outright at any bar), and the weaker bots died in form 1.
- **Not measured or not right:** nobody has played it. The 3 - 5 minute fight is not met (the lever,
  `flurry.posture`, is built and off). The level borrows three tracks of other levels until its score is
  picked on an audition page. Not polished: the beam technique's pose at the game camera, the
  transformation's body under the gather, Stone Storm's tiles against the aura, Heavenfall's landing
  (a noisy pale cloud), the lost clash's surge; strikes re-filmed after the merge of ADR-126 only for
  form 1 from one side. Not checked: a real phone (frame rate, the touch block in the clash). The dodge
  share is 13 / 23 / 40 % against a target of 15 / 25 / 35.

## ADR-150 — Tian Lei as a recognizable homage: the orange gi by default, the instant beam, the signature options behind switches (2026-11-22)

- **Context:** ADR-129 and ADR-135 kept Tian Lei an original in the spirit of the owner's source. The
  owner reversed that: recognizable ASCII homages of the iconic characters under new names. The lead
  said once that a new name covers the name, not the design, and that the game is public; the owner
  decided.
- **Decision:** three homage bodies behind `?ascLook=` (`h` an orange gi, `g` a purple gi, `v` a blue
  bodysuit and white armour), built on his own rig and art path and dressed by form; the owner picked
  `h`, now the default (`a`, the tunic, stays behind the switch). A new form 3 move, Instant Wave (the
  sign, a vanish to the hero's side, a cupped-hands beam point-blank with a fair red cue). Two
  options not yet picked: `?ascBeamPose=cup` (every beam out of cupped hands) and `?ascOrb=c` (the
  pale gathered sphere). New names only in everything that ships; the source's names appear nowhere.
- **Why not** recolour the aura so the gold hair stands apart in forms 2 - 3: the aura is shared by every
  body and the owner picked it (ADR-129); offered as its own option later.
- **Consequences:** the default body changes for everyone; `?ascLook=a` gives the old one. Form 3 has one
  more red beam (its dodge share 37 → 40 % over ten seeds). Every homage look must be judged at 40 px:
  colour carries it, detail (a lock of hair, the eyes) does not.

## ADR-135 — Tian Lei's third wave: the counter stance as an engine beat, the sign before a vanish, the great orb pushed back (2026-11-22)

- **Context:** the owner asked for the fighting game's iconic moves on Tian Lei: "spirit bomb,
  teleport attacks with the dragon ball teleportation animation, flurry of projectiles like vegeta ...
  more counter moves". ADR-129's rule stands: originals in that spirit, no franchise names or look.
- **Decision:**
  1. **The counter stance is an engine beat field, `stance`** (duelist/brain.js, duelist.js), not a
     move-file trick: a feint beat with a bait hold; from `from` of its windup a sword cut that reaches
     him is caught (no damage, no posture, the hero bounced as by a deflect, `dragon:guard { caught }`)
     and the move jumps to the beat's end so the beats after it, the punish, start at once; nothing
     caught by the impact ends the move there and leaves him open `open` s with his guard down. The
     read is the pose and light drawn INTO his open palms, with no glint: cut into open palms and you
     are caught; wait, and he is yours. Any duelist can carry one.
  2. **The sign**: `blink: { sign: true }` moves the vanish to u 0.5 of the windup; the keys before it
     are the two fingers at the brow, a snap of light marks the moment he goes, and a close-in waits
     for the vanish. Only the FIRST vanish of a string carries it: the later ones stay quick (the
     chain of afterimages), so a string's rhythm is kept and the sign is the string's one big read.
  3. **Heaven's Lantern is answered by THE PUSH**, the beam clash's lock at range reused: a perfect
     parry wins the big reward (it flies back into him; he reels), a plain parry or a block is safe,
     a roll passes it. It never homes, so the roll is honest. Nothing else of his starts while it is
     out, and the weather stands down.
  4. **Several counters a form**: `COUNTER_LISTS`, drawn on the AI's stream; `COUNTERS` stays the
     first of each list for the tests and the docs.
  5. **The pace meter counts a stance while it is catching and the orb's gather as busy time**, as it
     counts a black blow's charge: both are decisions the hero is making, not empty seconds.
- **Why not** make the stance a reaction (a ward kind): a ward answers a strike that already arrived;
  the stance must stand BEFORE the cut and read as an invitation, and its punish must be a string of
  his own with tells. **Why not** count all sixteen barrage blasts on the hero: a held guard was worn
  through (the owner's rule: a block is always an answer), so every third is on him and the rest pock
  the floor round him. **Why not** a homing orb: the roll must work.
- **Options kept:** `?ascOrb=a|b` (a sun / a lantern) until the owner picks.
- **Consequences:** the other duelists are unchanged (no beat of theirs carries `stance` or `sign`; the Starless Lord's own `catch` flag, the beat his thrown blade comes home on, is untouched: the first build named the field `catch` and ended his Wheeling Blade at that beat).
  Form 1 gains a stance (Still Water) and a riposte; forms 2 and 3 gain the sign moves, a stance, a
  riposte, the orb and the barrage. The stance's hold is short (0.2 - 0.4 s): with the brief's 0.7 -
  1.0 s the pace meter's longest gaps broke their caps. COMBAT.md's move tables are regenerated from
  the data (`docs-gen-moves.mjs`).

## ADR-130 — The hero's letters follow his size on screen; his own pixel tag, part tables and a dark blade (2026-11-21)

- **Context:** the owner sent a picture of the hero ("the exact type of feel and look i want. its not
  too detailed but has enough ascii features and style. make the character have this feel on every
  angle, movement, attack"). The picture was the live game: the hero at the 36 m camera on a 720p
  frame, enlarged three times. Rendered beside it on other screens, the same moment showed why it
  did not hold: his letter cell was a fixed 4 px (x2 only from 2160 px tall), so he was 9 letters
  across at 720p and on the phone, 13 at 1080p, 18 at 1440p. Asked where he does not look like the
  picture, the owner ticked "on my screen in general", "from the front or side" and "in attacks and
  dodges" (not "when the camera is close"), then picked from three rendered sheets: letter size B
  (the picture's, of finer / the picture / bolder), the sword "B's blade, today's arc" (dark until
  it cuts; the glowing crescent kept), the front view "A, legs like the cloak". The human bosses:
  "hero only for now".
- **Decision:**
  1. **One letter cell of the hero is 0.115 m at his depth** (`CONFIG.render.heroLetters.size`;
     `Pipeline._updateHeroLetters`), snapped to `HERO_CELLS` (even sizes: 4 6 8 10 12 16 ...) with
     hysteresis, never below the bosses' cell. From 20 m in to 6 m (the pass's fade from the far
     look to the close-up's line art) the cell goes back to the fixed one. The
     atlas is built at any cell size; his ink lines are found per font pixel so they step with the
     letters.
  2. **The player's pixels carry their own alpha window** (0.42, 0.45): `HERO_ART.self` lower than a
     boss's ids, written by `buildHero(..., { self: true })`. The hero branch of the art pass became
     one function run twice: for him on his cell (only inside the box round his screen point), then
     for the bosses on theirs.
  (His window sits above the unused v0.2 creature grid, whose code span was narrowed from 0.4 to 0.37.)
  3. **His own part tables** (`uSelfPartInk / Fill / Rim`): `HERO_INK` with `HERO_SELF` on top. His
     plate takes the cloth's dim dotted rim.
  4. **A dark blade that lights when it cuts**: `TUNE.bladeLook` scales the steel's gains at rest
     (line 0.32, fill 0.6, far 0.5, no dot halo); `TUNE.bladeFlare.strike` rose from 0.12 / 0.2 to
     4.2 / 4.6 and is scaled by `player.bladeHot` (a strike's window, the charge, the flurry, the
     plunge, a crit window; up at once, gone in ~0.1 s), so in a cut the steel is as bright as the
     old blade always was.
- **Why not** render the whole frame at a fixed low resolution (what a phone on LOW already does):
  it would enlarge the wyrm's digits, the props and the grass too, which the owner settled
  separately (ADR-093, ADR-120). **Why not** tell him from a boss by a screen box or by depth: in a
  duel the two overlap, and the boss's arm inside the box would be drawn on his grid. **Why not**
  change `HERO_INK` for the legs and the blade: every boss rig is built from it.
- **Options kept out:** the finer (0.086 m) and bolder (0.144 m) sizes, the "cold steel" blade and
  the lavender-line legs were rendered and not picked; none is kept behind a switch.
  `pipeline.heroLetter` can be set live (0 = the fixed cell).
- **Consequences:** a close-up (6 m and nearer) is drawn exactly as before; the first build kept the
  large cell there, and at 8 m on a 1440p frame the close-up's ink lines came out five pixels thick
  and white, a different close-up than the owner has, which they did not ask to change. Between 20
  and 6 m the cell shrinks while he grows: only a cinematic camera passes through there (the desktop
  camera stays 24 m and further; the phone's 11 .. 34 m all draw the 4 px cell). The art pass samples at most 6 more
  texels per pixel, only inside the box round him; measured on the RTX 4090 at 1440p and at
  852 x 393, the frame cost is the same as before within the noise (0.82 - 0.87 ms against 0.89 -
  0.94 ms; not measured on a phone). The pass reads its textures with `textureLod(.., 0)`: with the
  branch called twice the HLSL compiler warned about gradients in a loop. Tests: scenario
  `heroletters`; the blade flare checks read his own part 17.

## ADR-131 — The phone's top row is fitted to the screen; the guard may go to the left hand; a held attack may repeat (2026-11-21)

**Context.** The owner, playing on an iPhone: "the boss hp and main character hp ui is overlapping.
i'm also having a much harder time playing it on mobile because of having to constantly use the same
finger to hit different parry and block while attacking at the same time ... mobile is priority."

Two separate things:

1. *The overlap.* Safari gives an iPhone 15 Pro in landscape about 734 x 343 px (the notch and the
   home bar are kept clear, the address bar takes the rest), not the 852 x 393 the phone preset was
   checked at. The hero's HP row (24 cells and "160 / 160" at 10 px) ended at x = 242; the boss's
   48-cell bar, centred, began at x = 217, on the same line. Every length in the top row was a
   constant, so any screen narrower than about 790 px overlapped (a narrow desktop window too).
2. *One thumb for everything.* ATTACK, HEAVY, BLOCK and DODGE are all the right thumb's (ADR-096,
   ADR-115). The rules already let a guard cut a swing short at any point (ADR-080), so what costs
   the player is the thumb's travel from ATTACK to BLOCK, and that nothing can be held while another
   thing is pressed.

**Decision.**

- **The top row is fitted, not fixed** (`hud._fit()`). On a touch screen with a short side of 560 px
  or less, or narrower than 900 px, the hero's meters are 16 cells and the HP reads as one number.
  The boss's bar takes what is left between the hero's rows and the corner buttons: 48 cells when
  there is room, fewer when there is not (never under 18), on the screen's middle while that leaves
  it 36 cells and in the middle of the free stretch otherwise. Posture follows at two thirds. Shipped
  as the default: it is a fix.
- **PAD LAYOUT "guard on left"** (`layout: 'split'`), a pause-menu switch, off by default. The guard
  leaves the right-thumb cluster and becomes a GUARD button beside the stick's ring. The right thumb
  keeps ATTACK, HEAVY and DODGE; the left thumb moves or guards. The hero stops moving while the left
  thumb guards: planting the feet to parry is how a duel is fought anyway, and DODGE stays on the
  right because a dodge wants the stick's direction.
- **HOLD ATTACK**, a pause-menu switch, off by default. A thumb that rests on ATTACK keeps cutting.
  It is done in the touch layer with `input.pulse('@attack')` (one press edge per repeat), so the
  player's code is untouched and reads each repeat as a tap. It pauses while the guard is held and
  for a moment after DODGE / HEAVY / FLASK, so it never fights the guard or writes over a buffered
  dodge. With both switches on, the right thumb holds the offence and the left taps the parry.
- Both switches are options because how a control scheme feels cannot be judged from a picture: the
  owner tries them on the phone (`?pad=split&hold=1` opens the game with both on) and picks the
  default.

**Turned down.**
- Moving the boss's rows to a second line under the hero's on a phone in landscape: the screen is
  343 px tall, a third line of HUD costs more than shorter meters do.
- Doing the repeat in the player (`_readInput`): it would put a touch option into the fighter and
  change what a held mouse button does. The touch layer already owns every other touch rule.
- A context button (one button that parries when a blow is coming and cuts otherwise) and an
  automatic guard while standing still: both take the read out of a game that is about the read.
  Kept as ideas for an "assist" setting only if the owner asks.
- A flick on the stick to dodge: the owner chose "slide between buttons" over a flick on 2026-11-14.

**Not built yet (ideas for the phone, in the order I would take them).**
1. Draw the game under the notch (`viewport-fit=cover` with safe-area insets for the HUD and the
   controls): about 16 % more width on an iPhone; costs as many more pixels to draw, so it needs a
   frame-rate check on the device.
2. A drag-to-place layout editor (every button moved and sized by the player, per orientation), the
   feature the large mobile action games all have; a left-handed mirror falls out of it.
3. An "add to home screen" hint on iOS: Safari on an iPhone has no fullscreen call, the address bar
   takes 50 px of a 393 px screen, and the home-screen app has none.

**Consequences.** `GlyphBar` / `GlyphPosture` have `resize(cells)`; lengths in the top row are no
longer constants (`hud.fit` reports them). The touch layer has two more pieces of saved state
(`layout`, `holdAttack`, in `gcd.touchPad`) and one more button (`.tc-guard`). `CONFIG.touch.pad.split`
and `CONFIG.touch.hold` hold the numbers. The defaults play exactly as before.

## ADR-133 — Round the Obsidian Throne: varied breakable props in place of the felled forest (2026-11-22)

- **Context:** the owner: the trees and background round the Obsidian Throne were "incorrect and not
  realistic"; replace them "with more unique random breakable stuff" that "looks good and in the
  right angles". Round the crater lay ~125 felled trunks, every one the same straight log laid
  exactly radial (a starburst from the camera), in the screen grid's tree letters rather than the
  dragon look (CLAUDE.md: every new background object is prop art). (ADR-131 is #76's; ADR-132 is
  left to the open PR #77, which also claimed 131.)
- **Decision:**
  1. **A module of builders**, `world/starfallProps.js`: 13 kinds, each a set of carved parts in
     world space built afresh per piece (size, lean, state, number of parts), in the prop art path.
     Faces (an inscription, a lantern's window, a banner) turn to the camera within ~35 degrees; what
     the blast threw lies along its way out, turned off that line; every piece rests on a face, sunk a
     little. The camera's 1.15x stretch of upright things is built in.
  2. **Placement on a stream of its own** (`CONFIG.seed + 14312`): 125 spots 3.8 m apart off the path
     and the dais, then a shuffled bag of kinds by weight (each kind gets its share, not luck's). The
     layout's `rng` is not read (the trees were its last user, so nothing else moves). Within 43 m of
     the seal a piece is a breakable (`look: 'prop'`; stone leaves rubble, `swords` are metal, the
     banner and the cart wood); beyond, it merges into the set's stones. On the near side of the
     path (z > 6) nothing is taller than 3 m: a banner drawn there is rebuilt as a cairn. **None of
     them topples** (`topples: false`): a grave of swords or a cart is no trunk to fell, and with
     tall pieces that topple the Lord's crescents felled banners onto the hero in the middle of his
     moves (seed 4242: a void push and a falling banner 0.3 s apart, two answers); the fight keeps
     the rim's shards and slabs to bring down, as it was tuned.
  3. **A look switch, the owner's pick**: `?outskirts=0` the felled forest, `a` the shrine the star
     fell on, `b` the star's own debris, `c` those who came for him, `m` all. Rendered in game as four
     sheets plus a close-up of each piece; **the owner picked `c`** (`PICKED.outskirts`). The others
     stay behind the switch (ADR-122's convention); `?looks=old` draws the forest.
  4. **The fairness guard covers a felled piece it could not see coming** (`brain.worldClash`, asked
     by `destructibles.js` at the piece's flash): if a blow of the boss's already cued needs the other
     answer within `guard.sep` of its landing, the piece lands uncued and harmless (`quiet`). The new
     objects shifted the seeded sims (three.js draws its uuids from the seeded `Math.random`), and
     `lord.mjs` pace seed 4242 form 2 met a case main also has: a void push told at 109.68 s, a rim
     shard felled at 110.07 s by his crescent, their flashes 0.25 s apart; the push's hold at its cue
     (0.5 s at most) could not clear it.
- **Consequences:** the throne lists 255 breakables (222) in 365 bones of 1023. The Starless Lord's
  terrain moves leave the new pieces alone: none topples, and none of option c's is his to lift
  (only the jars, `lift` 1). The jars', lanterns' and
  roof's break and burn use their materials' defaults. Option `c` uses 6 of the 13 builders; the
  others are kept for `a`, `b` and `m`.
## ADR-149 — The weight of a landed cut: four pieces behind switches on one hit record, reactions drawn only, picks per kind of body (2026-11-22)

- **Context:** the owner: "how can we make the games combat more impactful and feel weight? i want
  the hits to look realistic where it lands and show some kind of ascii animation to show the impact.
  think of ideas to suggest using fable and once we approve, use opus to implement it". A landed cut
  already froze the frame, shook and punched the camera, kicked the picture along the blade, flared
  the blade, drew a slash line with sparks (STYLE.md "A cut that lands") and shuddered a
  duelist. Nine ideas were proposed (A a stamp, B a ripple, C wounds that stay, D a reaction by where
  it lands, E a spray along the blade, F the ground answers, G the same care when the hero is hit,
  H the sound's weight, I an impact frame); the owner: "Build first batch" (A, B, D, H).
- **Decision:**
  1. **Four pieces, each behind its own switch, on one shared core** (`combat/impact.js`): `IMPACT.on`
     (read at the moment of each hit), `IMPACT.k` (strength), `impactK(piece, who)`; `?impact=off |
     all | a comma list`, the Lab's 'impact' row. Each piece keeps its numbers in its own file. With
     every piece off nothing is drawn, sounded or moved that was not before; each piece's scenario
     checks that.
  2. **One hit record at the drawn contact.** `PlayerFx.contact` builds `o` (tier, cut, edge, hilt,
     crit, power, low, target) once and hands it to the stamp (`stampHit`) and the ripple
     (`game.fx.ripple.hit`) before `cutBurst`, inside one try / catch. The reactions read the boss's
     own `takeHit(o)` (point, cut, part, heavy, crit, swing); the thump reads `player:hitDragon`.
     No new event.
  3. **The stamp is written into the letter grid** in the fire field's `steel`, one blob per cell,
     snapped to cell centres, stepped (each frame held 0.04 s of fx time), its cells inked on black,
     never over the hero (STYLE.md "A cut that lands"). Not glyph sprites: the house rule.
  4. **The ripple is a term of the ASCII pass** on boss cells only (the wyrm's art grid, the human
     bosses' ink-line grid), fed by up to 4 world-space hits projected each frame with the final
     camera (`Pipeline.setRipple`, uniforms `uRipN`, `uRipA/B/C`, `uRip`, `uRip2`). Contrast travels,
     the average brightness does not rise (STYLE.md "Text effects").
  5. **Reactions are drawn only.** A duelist's `hitReact` turns his joints after `_gameplayPoints()`
     and is taken off before the animator runs; the wyrm's `react` goes on as the last line of
     `_step` and comes off as its first. Hurt spheres, hit stun, shove, guard, AI, attack spheres and
     every move's clock run on the plain body (tests: identical on and off). `dragon.drawnPoint(v)`
     maps the wyrm's struck sphere to the drawn body, so the cut's effects land on what is seen.
  6. **The thump** is a sub voice on the sfx bus and its own gain node on the music path
     (`musicBus -> thumpDip -> musicDip -> mix`), so its dip multiplies with the timing flash's dip
     and the pause duck instead of fighting them; never the cue bus.
  7. **The owner's picks per kind of body** (`IMPACT.by`, on top of `k`), from same-take clips and the
     lead's recommendation ("Your recommendation"): the stamp on the human bosses only (`by.stamp`
     duelist 1, wyrm 0), over today's slash line; a human boss's reaction x1.5, the wyrm's x1
     (`by.react`); the ripple and the thump at x1.
- **Turned down or left:** the ripple's round 1 (a ring that re-rolled and lifted the letters, a small
  shove along the cut) read only when two frames were diffed; it stays as the `subtle` preset, not
  drawn. The stamp on the wyrm: a light cut showed 2 - 3 cells, the slam and the cleave almost none,
  under its bright digits and the hero in front of the contact. `?stamp=instead` (the stamp in place
  of the slash line) and `?stampInk=0` are kept as options. The thump's knock under the light chain's
  sweep / point (`THUMP.knock`, 0). The second batch (C, E, F, G) and I were not built.
- **Consequences:**
  - *Today's effects hide the new pieces.* The white blade flare covers frames 0 to +4 of every hit
    (the charged cleave's about 6 frames of the whole crop), the swing arc crosses the contact at
    about +6 to +11, the slash streaks stack on the stamp's first frames, and the jolt, the camera
    punch and the wyrm's flinch move the picture more than the reactions do. The owner accepted a
    before / after with the flare and the arc toned down as the next step.
  - *Calm at the contact* (the same PR, after that before / after): measured one effect off at a
    time, the largest hiders are the struck boss's own white hurt flash (on the wyrm the whole
    struck body goes white through the freeze) and the hero's steel lit by the strike (x(1 + 4.2)
    on a light, x(1 + 4.6) heavy, held through the freeze); the hit's own flare and the cut's core
    are negligible. `combat/impactCalm.js` scales those existing effects together in levels 0 - 3
    (0 = as before), read at the hit; it draws the same random numbers at every level, never removes
    the slash line, and leaves a missed swing, steel on steel and bloom alone. Three levels were
    filmed same-take on the Ash Disciple and the wyrm; the lead recommended 2, the owner picked 1
    (`CALM_DEFAULT`: blade steel x0.7 (the hit's own flare x0.6), the boss's white hurt flash x0.75, sparks / motes alpha x0.65, the cut's pooled light x0.5, its core alpha x0.6, the slash line alpha x0.9, the cleave's fan alpha x0.6, the swing arc alpha x0.5 only within 0.6 - 1.6 m of a fresh contact for the freeze + 0.12 s). The stamp still does not read on the wyrm at any level, so
    `IMPACT.by.stamp.wyrm` stays 0.
  - *The thump adds little on heavy blows*: they already carry almost all their energy below 100 Hz,
    and the master compressor (threshold -14 dB, ratio 4) pulls the whole mix down 8 - 12 dB on each,
    tells included. Measured on offline renders: +0.2 dB below 100 Hz on the slam, about 0 on the
    cleave, +0.7 on the execution; +2 dB (cleave) / +4.5 dB (crit) of 160 - 400 Hz body, the part a
    phone plays. Nobody has listened in the game.
  - *The drawn wyrm and its hurt spheres part for a moment*: while a reaction is drawn the spheres
    stay at their simulated places, up to about 1 m off the drawn body for 0.2 - 0.5 s; phase 3's
    fire comes off the simulated points. Its legs are mostly out of reach (the body sphere is struck
    first) and its head only when it is down, so the leg and head reactions are seldom seen.
  - *The stamp's ink takes a tint slot*: it is one fire-field tint zone (id 800001) of the field's
    2, shared with the tells' dyed flares; a flare and a stamp in the same frame compete, the older
    zone gives way.
  - At x1.5 a duelist's heavy thrust moves a drawn point 0.085 m between two frames once (the duel
    scenario's bound, 0.06 m, is for x1; it pins strength 1). No piece makes a THREE object per hit
    or draws from `Math.random`.


## ADR-132 — Bites: a piece is the bricks it is drawn with, and a blow takes them where it struck (2026-11-21)

- **Context:** the owner: "i want the player to be able to destory the terrain and have the ascii
  pieces fall of exactly where the player or enemy boss is hitting. can we do this to make every
  background object destrutcible like minecraft/lego?" Since ADR-107 / ADR-120 / ADR-122 nearly
  everything that stands in a level breaks, but as WHOLE pieces: a blow takes structure from the
  piece, a tree drops its crown parts in a fixed order at three stages (a blast at a pine's foot took
  its top), a stone only takes a nick, and the chips fly from one point. Nothing came off where the
  blow landed.
- **Decision:** every breakable is treated as the BRICKS it is already drawn with, and a blow takes
  them where it struck (`BREAK.chip`, `destructibles.js` `_bite`). Behind the look switch `?chip=a`
  (the Lab: WORLD -> Bites), **off until the owner picks from the rendered sheet**, as every look
  change is.
  1. **A brick is a triangle, or two that make a flat face.** No object was rebuilt out of cubes. With
     bites on, a level is built with the bitten pieces' faces cut until no edge is over 0.8 m
     (`forest.js` `refine`: the same shape, the same picture, more triangles), about one letter cell
     at the game camera (1 m is ~19 px at 720p). Two triangles that share their longest edge and lie
     flat together are one brick, so a bite on a trunk, a pillar or a stone is block-shaped; foliage
     stays single triangles.
  2. **A blow takes the bricks nearest where it landed, as many as the structure it took.** Of the
     bricks within the blow's reach of the point, the share of the piece's structure this blow took,
     nearest first, at least one. A blade's point is where its segment met the piece, at the blade's
     own height (`o.ya` / `o.yb`, new: the hero passes his blade's two ends); a blast counts from its
     own centre, so it eats the side that faced it. The structure rules are not touched, so a notch
     is used up exactly as the piece's structure runs out and it falls.
  3. **A solid piece keeps a skin; foliage is holed.** A brick of a trunk, a stone or a thick bone is
     not removed: it is set back into the piece along its own normal (0.42 of the thickness there, at
     most 0.3 m). Leaves, boughs and thin bones (a dent under 0.07 m would not show) lose the brick
     outright.
  4. **Each brick falls as its own letter** from where it sat (a leaf, a splinter, a digit), in the
     dim hues the debris already uses; every third leaves a letter lying until the reset. The nick
     mark and most of the splinter spray are left out where a bite shows.
  5. **Two places a brick lives.** A 'range' piece (every tree of Cinderwood, the landmarks) rewrites
     the triangle when its run is written; a piece of the rigid batch (stones, boulders, pillars,
     statues, arena props) moves it in the batch's positions or folds it in the batch's index. Both go
     back at the reset.
- **Why this way:** the alternative that "like minecraft" suggests, rebuilding every object as a grid
  of cubes, would redraw every tree, stone and landmark (each the owner's call, and tuned over
  several sessions) and still print the same letters: a cube smaller than a letter cell is invisible
  in this renderer. Cutting the existing faces finer gives bricks of that size with no change to the
  picture. Tying the bite to the structure taken (not to a fixed radius) keeps every balance number,
  test and boss move as it is, and makes the notch and the fall agree. Setting a brick back, not
  taking it out, came from the first sheets: the meshes are hollow shells, so a holed boulder opened
  onto black ground, a trunk cut half through looked as if the tree floated, and a second option
  that took a wider patch left a standing stone's top hanging over a gap (that option was dropped).
  Thin parts are the exception because a dent a few centimetres deep does not print.
- **Consequences:** `rigidBatch.js` records where each source sits in its batch (`userData.batchRun`:
  its run of the index and of the vertices); the breakables' batch index and positions are dynamic.
  `sweep` takes `ya` / `yb`, and the hero's blade now strikes a piece at the blade's own height in
  every mode (its nick, its chips and a felled tree's stump height sat about 0.3 m lower). With
  bites on: a tree's crown no longer thins in order (it loses what the blows took; a crown part 72 %
  eaten drops whole), the wall's trees show the wind on their windward side, and Cinderwood draws
  1.07 M vertices instead of 0.92 M (the trees' mesh 524 k -> 648 k; the trees beyond 48 m are cut
  2.5 x as coarse to keep it there). Nothing a frame: a bite scans the struck piece's bricks once and
  rewrites its run of vertices, as a shudder already does every frame; the bricks are made four
  pieces a frame after the load, not inside a roar's front.
- **The blade stops (the owner, after trying it: "theres no impact or animation hitting the
  background object. it looks like im just hitting through it. it should chip at it realistically and
  the sword should stop when it hits it instead of going straight through it").** With bites on, a
  cut of the hero's that meets a piece it does not cut through stops on it: the frame freezes, the
  camera shakes, steel on stone sparks, the blade sticks in wood a moment, then it is thrown back
  (the bounce a duelist's deflection already used: its pose, its timings, a guard or a dodge cancels
  it). A cut that fells or breaks the piece goes through with a short freeze. The chips are knocked
  out of the struck face toward the striker. The bounce was reused rather than a new recoil clip:
  it is tested, it already reads as "my blade was thrown back", and its cancels are the ones players
  know. Consequence: a swing that meets cover before the boss stops there (behind the switch until
  the owner picks). The owner, shown the frame-by-frame sheet: "Keep it" (2026-11-21): the stop's
  numbers stay as they are (`BREAK.chip.stop`).
- **On by default (the owner: "Yes, turn it on", 2026-11-21).** The call sites' default is `a`
  (`lookOf('chip', 'a', 'a')`), so bites are on with no parameter and under `?looks=old` too (a new
  thing keeps its pick); `?chip=0` is the way back. Not in lookSwitch's PICKED table: that table is the
  duelists' second pass and its tests check it against the Lab's LOOKS rows, which are per duel level.
  The frame cost on a phone of the finer bricks (Cinderwood 0.92 M -> 1.07 M vertices drawn) is still
  not measured. Turning it on found three things, each fixed: (1) working out each brick's depth
  compared every brick with every other (74 ms for the Cinder Tree's trunk, a frame-time failure in
  the world budget): now a dense grid, ~9 ms for that trunk, and every piece's bricks are made while
  the level loads (~0.2 s for Cinderwood), never in play; (2) the Starless Lord's Training situation
  "Build his streak" stood the hero beside the crater's rim slabs, and his strikes stopped on them:
  such situations are marked `clear` and stand him on open ground; (3) the world tests of the crown's
  stages run with `?chip=0`, the path that still has them.
- **Not done (asked, and worth doing next):** the GROUND itself (the soil and grass of Cinderwood are
  one plane with a glyph shader: a crater is glyph marks and a charred disc; real pits need a dug
  channel in the scorch map or a deformable ground mesh, and a rule for feet); floor slabs (they
  keep ADR-122's whole / cracked / broken looks); the pieces that deliberately stay whole (the
  bonfires, the sect gate, the bell, the throne and its dais, the fallen star: each was decided as a
  landmark or a checkpoint); wreckage (logs, rubble, blocks: scenery with no structure); the shadow
  of a batch piece (it keeps the whole shape). A second layer (a set-back brick struck again) and a
  support rule (what hangs over nothing falls) are not there. The frame cost of the extra vertices
  was not measured on a phone.

## ADR-147 — A fifth level: the Foxfire Terrace and Wen Yao, the Thousand-Body Fox: paper selves that are his own bodies, a Pearl fed by them, a mantle of fire (2026-11-21)

- **Context:** the owner asked for level bosses built on the power fantasy of famous characters, as
  ORIGINALS, and picked two to make now, each planned by Fable and built by Opus ("plan out #1, #2 in
  separate chats with fable and instruct opus 5.5 high to build it out"). This is #1: a duelist who
  fills the arena with clones that pop in one hit while the real one charges a spiralling orb, whose
  last phase wears a fox-spirit cloak of fire. It is in the spirit of a famous ninja-clone hero and
  must not be him.
- **An original, not the franchise.** His own name (WEN YAO, THE THOUSAND-BODY FOX), his own move names
  in the plain wuxia style of the others, a kitsune's fox mask. None of that character's protected
  signature design or words: no orange jumpsuit with black shoulders, no headband with a metal plate,
  no whisker marks, no swirl emblem, no spiky blond hair, no hand seals, no technique names of that
  series; selves that TEAR off him as paper rather than smoke clones.
- **The owner's turn, 2026-11-22:** "make the boss look as recognizable [as] the referenced character and
  use its signature moves ... with different names", then "as similar without causing copyright issue
  ... a fist fighter". A recognisable copy of a character's design is a copy whatever it is called, so
  the homage was pushed through what nobody owns: he fights BARE-HANDED (his dao removed; Tian Lei's
  strike builders and limb-as-blade), the selves fight as a PACK (the Round; one holds the Pearl with
  him; one throws him: Fox Descending), the orb is shaped in his OPEN PALM and DRIVEN into the hero (a
  common anime trope; the thrown volley kept as Pearl Rain), and phase 3 is the NINE-TAILED FOX of the
  old tales (the spirit grows from one tail to nine as his bar runs out), a loud bright figure on
  offer among the looks.
- **Decision, the selves are the boss's own bodies, not an actor list.** The roadmap's "boss slot as an
  actor list" is not done and this does not do it: the game still has one boss. `FoxClones`
  (`thousandFox/clones.js`) is a fixed pool of five hero rigs built in his constructor (never mid-fight:
  three.js draws a uuid from `Math.random` per object, so a rig built mid-fight would shift every seeded
  fight), stepped from his `brainFrame` and posed from his `afterPose`, as the Starless Lord's spells are
  his own things. A self has no body circle (the hero walks through paper and is never boxed in), is not
  a shadow caster, and pushes two hurt spheres marked `clone0` .. `clone4` into his `hurtSpheres`;
  `ThousandFox.takeHit` sees the part, pops it and every other self within `cleave` m of the hit point
  (2.6 m for a heavy cut), adds `popPosture` to the real one's posture each, and returns 0 (no number,
  no call-out: the HUD skips a 0). `drawnPoint` scales and leans a sphere about the NEAREST body's root.
- **Decision, the real one is always findable.** The selves are a crowd to cut through, not a shell
  game (`CLAUDE.md`: readable combat): the lock-on, the name tag, the boss bar and the minimap only
  follow him (nothing changed there); only he holds the Pearl and its threads end in his hand; only he
  casts a shadow; only his blade is steel (the sweep trail, the lit edge); in phase 3 only he wears the
  mantle.
- **Decision, a self fights by the duelists' fairness rules.** One cut at a time (a token: the next
  self winds up `every` s after the last blow at the soonest, only within 3.2 m of the hero, only while
  he is in footwork or in a move marked `clonesFight`, never with a pearl in the air). Its windup is
  told to the cue ledger (`brain.expect`) and lengthened, or put off, by `brain.fairDelay`, so two cues
  that need different answers are never within the guard's `sep`; it is cued as his blows are
  (`combat:tell`, then `combat:flash` and the white glint `flashLead` before it lands, source 'dragon',
  attack 'paperCut') and it lands through `d.hitPlayer` as a thrown thing (`projectile`): blockable,
  parryable, dodgeable; a parry pops it and nicks his posture without recoiling him. Their cuts count
  in his pressure meter like his own.
- **Decision, the Pearl is fed and can be starved.** Drawn out over the blade (1.6 / 1.47 / 1.47 s; his
  guard down), a thread to it from every live self; two cuts on him (one heavy) burst it in his hand
  (he reels, +90 posture); batted at the hero's led spot it is red and bursts in a ring of
  2.0 + 0.35 m per live self (3.4 at most) for 26 + 3 per self (× his damageScale); three pearls in a
  row from phase 2. Its landing is told to the ledger from the start of the charge and retimed at the
  bat; the fairness guard may lengthen its flight by 0.4 s, else it comes apart in the air, uncued and
  harmless (the kicked lantern's rule). The ground it will burst on heats from the bat (a hazard's
  mark, ADR-052). It pops every self it reaches and hits the world (`world.impact`).
- **Decision, the mantle sets the hill alight.** Phase 3's mantle is heat in the fire field round him
  (FoxFx); every 0.6 s `world.ignite` where he stands. Fire never spreads in this game (the owner's rule,
  ADR-107), and he keeps within 12.2 m while the charm posts stand at 16.5 m, so the tail's sweep throws
  its flame 1 m past its 3.6 m ring and the pounce lights the end of its line: the posts catch when the
  fight comes to the rim. The tail's sweep and the pounce also hit the world.
- **The set** (`world/foxTerrace.js`): the courtyard's floor clipped to a circle, a lighter kerb, ten
  lanterns, six stone foxes and two landmarks turned to show their profiles to the camera (a fox seen
  from the front and above prints as a lump), charm posts of wood, 445 breakables, 380 bones; built on
  a quiet `Math.random` so a set that grows does not reshuffle the seeded fights.
- **The looks wait for the owner:** his body `?foxLook=a|b|c|d` (a, the Shrine Fox through the art path,
  is what the fight is built with; d the same outfit in ink-line art), `?foxfire=a|b|c`, `?clones=a|b`,
  rendered on sheets in `docs/looks/fox/`. They are listed in `lookSwitch.js` `PENDING`, not `PICKED`.
- **Decision, foxfire is a palette, not a kind** (as the Skybreak Ring's gold, ADR-129): this level
  swaps the fire field's void slot (`FIRE_PALETTES.foxfire`, jade). `?foxfire=b` draws it as the
  wyrm's orange fire, `?foxfire=c` moon-white.
- **No change to the duelist engine.** Everything is a hook of the kit (`_setup`, `_tint`, `_makeFx`,
  `_makeBrain` (a `FoxBrain` that counts a trade of places in a string's reach and realises the Round
  for the selves alive), `brainFrame`, `afterPose`, `beatMotion`, `onImpact`, `onCast`, `onRelease`,
  `weigh`, `onActStart`, `takeHit`, `_break`, `drawnPoint`, the `guarding` getter, `reset`). One render
  change: the rigid batcher's bone texture grows from 64 to 128 rows (1024 → 2048 matrices) the first
  time a batch would not fit (`RIGID_ROWS_MAX`; the shader reads only the width): six human rigs, the
  hero and the set did not fit in 1024. A level that fits never grows and is drawn as before.
- **Consequences:** a sixth through eleventh hero rig in the scene (each ~one draw call per material
  after batching: measured in DEVLOG Session 77); the selves' animators run every frame (the first
  fallback, if a phone needs it, is every other frame, then `clones.max` [2, 3, 4]). Music is borrowed
  until the owner auditions a score. Tests: `tests/integration/fox.mjs` (in `npm test`).

## ADR-148 — The Thousand-Body Fox's reward, the Paper Double, is recorded, not usable yet (2026-11-21)

- **Context:** every boss gives a fixed reward (ADR-059, ROADMAP M2). The fox's is the Paper Double: a
  decoy the foe strikes instead of the hero.
- **Decision:** it does NOT ship as a working ability. The level carries it as data, `reward: { id:
  'paperDouble', name: 'Paper Double', line, usable: false }` (the `{ id, name, line }` shape of the
  shared rewards store a parallel build adds, so the second of the two to merge only rebases; no store
  and no grant are written here), named in ARCHITECTURE's level contract as the level's fixed reward,
  with a line under ROADMAP M2 "Fixed rewards per boss". No in-fight UI promises it.
- **Why:** (1) there is no technique slot, meter, input or equip screen yet (ROADMAP M2's first item),
  and a decoy needs a button on keyboard, pad and the phone's touch layout, which is the owner's call;
  (2) every boss's AI reads `game.player` directly: a decoy needs a target indirection in the wyrm's AI
  and in the duelist brain, shared code that the parallel boss builds are also changing.
- **Consequences:** the selves' body pool (`FoxClones`: a hero rig, its own animator, two hurt
  spheres, a walk and a cut) is written so a hero-side double can reuse it. When the reward plumbing
  lands (a shared rewards store is being built beside this, for another boss), `usable` flips and the
  double is built on it.

## ADR-144 — The draw's rule: parry or die, a held guard never hurt, no draw on a hero who cannot answer (2026-11-22)

- **Context:** the owner asked for level bosses built on the power fantasy of famous characters, as
  originals. This one, the Sheathed, is a swordsman whose blade stays in the scabbard until one
  blink-fast draw the hero must "parry or die", and his fixed reward is a draw-slash. The owner has also
  said twice that a block must never cost health and that defensive play must not be punished. A blow
  that kills from full health is new in this game; it has to be readable and fair or it is only cruel.
- **Decision:** one rule for every draw (`draw: true` beats: blue, the flare, `fixed`, wound up at least
  0.9 s; a draw that follows another in the same move, Three Autumns', at least 0.78 s). Parried: the
  counter of a blue flare blow as it exists, and he is caught with the blade out for 1.5 s
  (`TUNING.draw.caught`, the 'caught' reaction). Perfect dodge or dodge: clean. A held guard: no health,
  the whole guard meter, the guard knocked open, thrown back (takeHit's new optional `breaksGuard`, the
  black blow's `_guardOpen`). Nothing, a late press, a swing that does not meet it: death
  (`TUNING.draw.lethal`: maxHp x 1.5; off: `draw.damage` 110). The hero's own cut meeting it: the trade
  clash or the flash counter, as for any blade blow. Three guards keep it fair: the HONOR GATE (as the
  cue comes due the actor's `mayCue(beat)` false, a hero knocked down, staggered, guard-open or dead,
  holds the beat at the cock up to `draw.wait` 0.6 s, then it becomes a feint and he gives ground), a
  chain of draws goes on only past a dodge (`stopOn: ['blocked', 'hit']`), and no draw is cued within
  `draw.afterBlock` 1.1 s of a blocked one. A draw's combat:tell goes out with its click (the honor gate
  may still make it a feint). No red or black beat is ever lethal. While the blade is out he has no
  guard at all (a move's `recoverOpen: 1`): the draw answered is the opening.
- **Consequences:** five optional engine fields (`draw`, `stopOn`, a move's `recoverOpen`, a per-phase
  `cooldown`, the actor hooks `mayCue` / `onHonorFeint` / `onStopOn`), one takeHit field; a kit without
  them is unchanged (the other bosses' suites pass as before). A block-only bot never dies to a draw
  (sheath.mjs STRATEGY). The engine's fairness guard never holds a `fixed` beat: a draw that would land
  too near another answer's impact is feinted, not delayed (measured: 0 - 5 feints a minute in phase 3).

## ADR-145 — The Windless Grove and the Sheathed: the sheath on the rig, light pieces, a grove that falls on the click (2026-11-22)

- **Context:** the fifth level: a bamboo grove at night, a round clearing, a kneeling swordsman before a
  mound of planted swords (an original wuxia figure: Lu Wusheng; none of the signature look of any
  existing character). The draw must read though the blade's travel is never seen; the grove must
  answer the cut without ever cueing a blow or holding up one of his.
- **Decision:** the level `?level=grove` (`levels/grove.js` WINDLESS, `world/windlessGrove.js`): packed
  earth 14 m round, a worn round of paving (108 slabs through `breakableFloor`), 366 bamboo stalks as
  `range` pieces of one mesh (no bone of the rigid batch; their stumps a run of a stump mesh, cut where
  the blow bit, ADR-128), the Sword Grave (40 planted swords and the great sword), a stele, two lanterns,
  boulders, a ruined pavilion; `?grove=a|b|c` (moonlit mist, grey dawn, first snow). A new destructibles
  def field `light: true` (the record's `lightPiece`; `light` there is a burn's point light): its fall is
  quiet whoever fells it (no tell, no flash, no blow on the hero, no ground mark, no domino sweep, no
  shake, a soft crash): the bamboo, the grave's swords, the pavilion's posts. The existing `quiet` flag
  was not enough: it is decided by where a fall lands and still sweeps, marks and shakes. The boss on the
  duelist engine (`enemies/sheathed/`): THE SHEATH on the rig, `carry` (the sheathed sword in his right
  hand: the engine's weapon, kit.blade spans the scabbard), `settled` (a left-wrist piece posed along the
  clip's `lsw`, the scabbard with the hilt in it, the right hand on the hilt), `drawn` (the bare blade;
  the empty scabbard at the hip), driven by the beat (TUNING.draw grip / home / handOff); after a
  reaction leaves the blade out he re-sheathes first (the manual move `resheathe`). The cut is one key
  marked 'h' in the clip: the cubic holds the cock and the next frame is the follow-through. The cut is
  one white line in the fire field and a pale wake beyond it; nothing breaks at the impact; at the
  re-sheathe's CLICK (or the moment a parry, stagger or break interrupts it) the sweep runs along the
  blade's part (power 1.2) and the wake (0.55), and The Held Breath fells every stalk within 9 m.
  `dragon:sheath {state}` drives the sound (a breath that cuts to silence, the music ducked, the click).
- **Consequences:** a felled stalk never cues, never hurts and never holds up a blow (sheath.mjs WORLD,
  PACE: 0 conflicts). His body is drawn through the wyrm's art path (toDragonLook with his own spec),
  three bodies behind `?sheathLook=a|b|c`, the cut behind `?drawCut=a|b`. The owner's picks (2026-11-22,
  from the sheets: "keep the recommended"): `a` for the body, the cut and the grove's light; the others
  stay behind their switches. A fourth body, `d` the Wanderer, was added the same day at the owner's ask
  and then picked over `a`: he ships as the Wanderer.

## ADR-146 — One Breath: the first fixed reward, on the smallest store the technique system can read (2026-11-22)

- **Context:** ADR-059 promises a fixed reward per boss; the technique system (slots, a meter, an equip
  screen, ROADMAP M2) is not built. The Sheathed's reward is a draw-slash, and it should ship working.
- **Decision:** `game/unlocks.js` `Unlocks` (`has`, `grant`, `all`, `clear`, `toggle`; localStorage
  `gcd.unlocks.v1`; `?tech=draw|none`), `game.unlocks` (main.js). His death grants `oneBreath`; the
  victory logs YOU LEARNED ONE BREATH; the help lists it once learned; the Lab toggles it. The input
  needs no new button: a HEAVY press begun with the guard up (or within 0.2 s of lowering it) and held
  past CHARGE.hold takes the draw stance instead of the cleave's charge (`_startCharge` redirects only
  while it is learned: locked, every path is as before). The stance is the iai's coil the hero already
  has (anim.js flurryPose 'coil', the right hip; no new mesh on his rig: one more object would shift the
  seeded fights); releasing HEAVY cuts (`ONE_BREATH`, combat.js: a 5 m blink through `_startHeavy`, 46
  damage, 0.55 s recovery). A white or blue blade blow met by the cut is beaten aside as the flash counter
  does (`drawCounter`: 46 damage, 40 posture, no crit window; `Duelist.onCounter` takes the two
  overrides). A red or black blow lands on him in the stance.
- **Consequences:** the first reward is playable now; the technique system can read `game.unlocks` and
  take One Breath into a slot later. Not measured yet: a bot that only uses One Breath on Shen Hui
  (duel.mjs `strategy`) against the mixed bot's time.

## ADR-156 — Xin Yi, the One Who Woke: a recognizable homage on the duelist engine; two bars, the Lean, the Bend and the stop as openings, deja vu (2026-11-22)

- **Context:** the owner asked for a boss in the spirit of the hero of the source film (a famous action
  film of the late nineties: written here as "the source film", never its name), planned by a Fable session
  that asked four questions (2026-11-22): the look RECOGNIZABLE (a long black high-collared coat whose tails
  flare, small dark glasses, short dark hair, pale face and hands, two handguns in phase 2); the set a
  pillared hall that morphs into two or three scenes; four moments not to be cut (the fall and the rising;
  shots and pillars; flight and the falling fist; deja vu and skipped frames); the suited men watchers only.
  The homage line of the merged homages (ADR-150): a new name for the man and every move, none of the
  source's names, title, lines or logo anywhere in the game or its code, every look behind a switch.
- **Decision:** `WokenOne extends Duelist` (wokenOne/), bare-handed with Tian Lei's exported strike builders,
  his limb-as-blade code copied, `WokenFx extends AscFx` (the plan said LordFx: AscFx IS LordFx's pool of
  thrown things plus the blasts that cover stops and the perfect parry returns, which the guns and the bolts
  need; its gold is swapped for the CODE palette). TWO BARS, THREE PHASES: bar 1 (3400) holds phase 1 and
  phase 2 behind the engine's gate at half; bar 1 empty breaks him (Tian Lei's `_onHpZero`) and the
  deathblow is THE FALL (flat on his back, slow time, the script still, `_changing`), then the transition
  `rising` with bar 2 (2600) full, ending in the Still Hand held 1.5 s. PHASE 1 keeps the left hand behind
  his back in every key (a realiser of its own over a one-handed copy of the moves). THE LEAN is only the
  look of his guard (slip clips, one afterimage): no new way to waste a cut. THE BEND (phase 2) and THE
  STOP (phase 3) are openings, never walls: a returned shot or the engine's heavy-blow evade bends him at a
  posture cost, open 1 s with a crit; a second one inside that second lands; the melee Bend once in 6 s;
  a returned bolt hangs before his palm (rooted, posture), three are sent back as ONE blow of the brain's
  (one blue flare, one result). DEJA VU is a link back to the same string (`force`), realised with the
  first pass's draws (`REPLAY`) and, in phase 3, mirrored (a `manual` copy); the set stutters at the link.
  Optional engine fields, other kits unchanged: a beat's `noWorld`, a hit's `guardCost` (Iron Rain: a held
  guard pays guard, never health, 55 at most a volley), a boss's `cameraPull` (flight keeps both in frame).
  Every thrown thing asks the fairness guard (`fairThrow`: it hangs a moment, or goes uncued and harmless).
- **Consequences:** a fifth duelist kit with no change to what the others do. The plan's aliases lost
  'hall' (the Obsidian Throne's). The phase banners do not decode (the plan's first cut). Phase 2 counts
  every one of Iron Rain's eleven shots as a cue, so the pace meter reads phase 2 as busy as phase 3
  (COMBAT.md "The One Who Woke" → measured).

## ADR-157 — The Hall of Falling Script: one arena whose scenes morph, the script wave in the prop and floor letters, watchers (2026-11-22)

- **Context:** the owner: "pillared hall but since this is the matrix, have everything more extra ascii and
  have the stage morph 2-3 variations seamlessly to different scenes". A level is never torn down (one per
  page load), and the owner turned down a terminal post-process and one character grid over the frame
  (STYLE.md "Tried and turned down").
- **Decision:** one set built once with three scenes on the same ten slots (`hall` the Pillared Hall, `dojo`
  the Sparring Hall, `source` the Source); every breakable of a scene carries `scene: '<id>'` and only one
  scene's pieces stand at a time. The smallest scene-aware surface in destructibles.js: `present(b, on)` (out
  of the world: hidden, colliders out, state GONE so every query skips it; back: whole), `sceneHome` /
  `sceneNow`, a reset that puts the other scenes out again; `world.restore` calls the set's `scenes.reset()`.
  A morph (`scenes.to`) runs a front out from him: each piece it crosses lets go as digits and the new
  scene's prints in; it runs only inside his transitions (the beckon, A Hundred Iron Seeds, the rising, his
  death). "More extra ASCII" is four layers inside the existing letter systems: the code palette in the fire
  field, the falling script (one glyph batch of the set's ambience), THE SCRIPT WAVE (uniforms `uScript` /
  `uScriptF` read by the prop-art and the floor's materials: digits brightening in waves down each column
  inside a prop's own letters; at strength 0 the frame is exactly today's, and no other level sets it), and
  things coming apart as letters. The watchers are static prop-art figures that never act and burst into
  digits when struck. The bonfire is the only piece left whole.
- **Consequences:** a set without `scenes` behaves exactly as before (the world suite's `bite` walks each
  scene of a set that has them). The script wave is the one shared-render change; its cost is measured on
  the phone preset (COMBAT / DEVLOG). The look of the hall (`?hall=`), of the wave (`?script=`) and of him
  (`?oneLook=`) wait for the owner's pick (lookSwitch.js PENDING).

## ADR-158 — The Long Second: the second learned technique, a lean in place from a held guard (2026-11-22)

- **Context:** ADR-059's fixed rewards; ADR-146 shipped the first (One Breath) on the smallest store
  (`game/unlocks.js`). The plan gives Xin Yi's: the hero leans back under the blow instead of stepping away.
- **Decision:** `longSecond` in the store (`?tech=lean`), granted on his death (`victoryNote` 'YOU LEARNED THE
  LONG SECOND'). The gesture needs no new button: from a held guard, DODGE with no direction (today a
  backstep) is the lean once learned; with a direction held the roll is the roll, and One Breath keeps
  "guard, then hold heavy". `TUNE.lean` beside the backstep's: no travel (he stays in reach), i-frames 0.03 -
  0.34 s (the backstep's 0.22), free to cut after 0.24 s; a perfect one slows time 0.9 s (the Ghostep's 0.6)
  and leaves three afterimages; everything else is a dodge by ADR-102 (white and heavy: a streak pip and no
  crit window; red and black: the flurry). Its own pose (anim.js `leanPose`).
- **Consequences:** the strategy bots, with a bot that answers every cue with the lean, are the check that
  leaning is not the fastest way through (woke.mjs STRATEGY); if it becomes so, its i-frames shorten first.
## ADR-151 — The grove's bamboo is sliced in one stroke, its top off at the cut; five kinds of cane in clumps, and the back filled (2026-11-22)

- **Context:** the owner: "make the bamboo in windless grove all sliceable in 1 swoop and make sure it falls the moment the sword is going through. have the bamboos more varied, beautiful and some clumped up. i want the bamboo falling to be a cool spectable as the fight happens. have way more in the back empty area as well". A stalk (ADR-145) had 0.5 of structure: a light cut (0.27)
  left it standing, and a felled one went over whole from its base about 1.3 s later, like a tree.
  Every stalk was one kind (one green, one radius), scattered; the clearing behind the boss was
  nearly bare and the static wall stopped at 34 m, black beyond.
- **Decision:**
  1. **Sliced pieces** (a def's `slice: true`; `BREAK.slice`; destructibles.js). Any blade or blow
     that takes anything of it (not fire, not a body brushing past) cuts it through, whatever its
     power, at the height it bit (the blade's own height: ADR-132's `ya` / `yb`). In the frame of the
     blow its body loses everything below the cut (`RangeBody.cutY`, `_writeCut`) and its stump is
     cut to that height on a clean slant (`_shapeStub` with an exact height). The top slides 0.3 m
     off the cut along the blow in 0.09 s, then goes over about its lower end as a falling body
     (`_sliceFall`: the angle with the square of the time, kicked out along the blow, rolling about
     its length), and comes apart in leaves and splinters where it lands. A light piece still: no
     tell, no harm, no shake. The blade goes on through it (it broke; ADR-132's stop is for what
     holds), so one swing cuts a whole clump: 9 - 13 stalks in the films.
  2. **The bamboo's look** (`?bamboo=0|a|b`, read when the level is built): five kinds of cane
     (green, jade, golden with a green stripe turning at each joint, black, dry), three thicknesses,
     clumps that fan out from their middle (tallest there, leaning out at the rim, young shoots at
     their foot), lone stalks, crowns of 3 - 8 sprays. Clumps behind him in the clearing (11, three
     in four north of him, none on the camera's side), a belt of clumps 1.7 x denser behind him than
     before him, and a static wall out to 50 m (it was 34) into the fog. `a`: kinds mixed in a clump;
     `b`: one kind per clump. `a` ships: the owner's pick from the sheet ("a, mixed clumps"); `0` is
     the grove before.
- **Why this way:** the owner asked for the fall "the moment the sword is going through", so the
  cut shows in the frame of the blow and the top moves the next frame, sliding off the cut before it
  tips, which is what reads as a slice rather than a felling. Cutting the run of vertices at a height
  needs no new mesh and no bone, as ADR-128's stumps did. The kinds and the clumps come from colour
  and placement only: the cane, its rings and its leaves are the same three shapes, drawn as prop
  art (the house style).
- **Consequences:** the grove lists 595 - 609 stalks (366) and draws ~0.89 M vertices (0.56 M);
  the frame cost on the phone is not measured. Lu Wusheng's re-sheathe felling and every blow of his
  slice the stalks too. World test `slice`; `bite` treats a sliced piece as cut through, not bitten.
- **Not done:** the cut tops do not lie on the ground (they come apart where they land, as before);
  no sound of its own for a slice.

## ADR-153 — CI: the tests in four parallel jobs behind one required check; docs-only PRs skip them (2026-11-23)

- **Context:** `test-and-build` took 12-15 minutes a PR: ~50 minutes of headless fights four at a time
  on one 4-core runner, and `main` requires it on an up-to-date branch, so a PR behind `main` paid it
  twice. The repo is public: GitHub's standard runners cost nothing. Docs-only PRs ran it all too.
- **Decision:** `tests/run.mjs --shard I/N` deals every task to one of N shares by its estimated CI
  seconds (longest first, to the lightest share); ci.yml runs four shares as a matrix beside a build
  job, and a gate job named `test-and-build` (the name protection requires) passes only when all of
  them did. A `changes` job reads the PR's own diff (the merge commit against its first parent); with
  nothing outside docs/, *.md, .claude/ the tests and the build skip and the gate passes. lord's
  longest scenarios run as tasks of their own (`GCD_SKIP`, as integ and world did).
- **Why this way:** a required check that is skipped is never reported and blocks the merge, so the
  skip lives inside the workflow and the gate always reports. Dealing by estimate keeps one list of
  tasks (a new suite cannot be left out of CI); a wrong estimate only unbalances the shares. Kept: the
  up-to-date rule (two green PRs can still break `main` together) and free runners only.
- **Consequences:** a run takes ~4 minutes (PR #92: 4 min 19 s); a PR shows six checks. The floor is
  the longest task (lord fxlooks ~230 s); re-measure `est` when a suite grows a lot.

## ADR-152 — Lu Wusheng readable: the hero's ink-line print, lifted; three palettes and a mark to pick; a wanderer's motion and names (2026-11-22)

- **Context:** the owner on the live Windless Grove: "its hard to see the new boss character. make it look
  detailed like the main character". At the game camera he was a thin dark column of the wyrm's digits about
  40 px tall beside a drawn hero. The owner's answers (2026-11-22): print him in the hero's ink-line art (not
  bigger letters: the shared renderer stays as it is); the homage to the genre's wandering swordsman rests on
  his silhouette type, a mark of his own, how he moves, and his lines and names; three palettes rendered to
  pick from. He stays an original.
- **Decision:**
  - The print: `?sheathArt=a` (the hero's ink-line art, as the hero and Shen Hui are drawn) is in `PICKED`;
    `?sheathArt=0` keeps the wyrm's digits. The prototype printed him as dark as the grove's floor: the
    Wanderer's fills sit about twice as high and the screen-left rim × 3 (× 3.6 on the scarf and the mark)
    (`sheathed/look.js` `SHEATH_TONE`, `SHEATH_LIFT`, `tintWanderer`). His hair moves off the `hair` part,
    whose shared ink lines are the hero's gold (a gold line round dark hair read as light hair at 30 m),
    onto `shirt`. The scabbard keeps the darkest fill, the drawn blade the brightest pixels.
  - Three palettes, `?sheathTone=a|b|c` (indigo and sand, pale and cold, moss and rust; dark hair in all),
    and a mark, `?sheathMark=a|b|0` (a torn strip of unbleached cloth tied below the scabbard's mouth, on
    springs on both scabbard pieces, snapped by the draw; a white streak through the hair and its tail;
    none): Lab rows marked `awaiting`, not in `PICKED`; the fight draws a / a until the owner picks.
  - The silhouette, sharpened where the outline is what reads: the robe falls loose to mid-thigh over the
    wide pleated trousers, open at both sides (a robe worn loose and long, never a short top tucked into
    the trousers); a longer, thicker high tail with a pale tie; the scarf's turns deeper and its ends wider,
    its tails hanging close down his back when he is still (`out` 0.14 → 0.03), trailing at a run; pale wrist bindings.
  - Motion (poses and keys only): a quiet carry (the head a little bowed, the left thumb in the sash), a
    slower, smaller breath, a low run with the sheathed sword held back at the hip (opt.run; his own
    `duelLoco` sinks and pitches the duelist's run), and a settle that turns sharp (in every draw beat the
    head comes round first, then the body drops into the stance at speed). No tell, windup, hold, flash,
    zone, damage, cooldown or root motion changed; `sheath.mjs` passes with its thresholds as they were.
  - Lines and names: the level's lines and eight move labels play up a wanderer sworn not to draw (ids
    unchanged), original wording.
  - Steered off the famous character: no scar of any shape, no red, orange or pink hair (the gold hair line
    that tinted his outline was moved off), no reversed-edge sword, and not that character's outfit: a long
    loose travelling robe over the trousers, not a short top tucked in, with a scarf that character never
    wears; no palette is that outfit's colour scheme.
- **Consequences:** he reads at 1280 x 720 (the mean luma of his pixels 31.9 against the floor's 16.1; the
  hero 25.2 against 20.1; the prototype 22.2 against 16.3) and on the phone camera (45.4 against 16.5). The
  digits print had a higher mean (40.0) but read as a block of numbers, not a figure: luma alone is not the
  measure, so the sheets show both. `tests/integration/sheath.mjs` gains LOOK (the print, the options, the
  mark's springs, ADR-126's hand audit through One Breath). The mark's strip on the left-wrist piece hangs its
  springs on the animator after the rig is built (sheathed.js `_setup`), a light coupling to anim.js's
  `streamState` shape. Open: the owner's picks of the palette and the mark; a look on a real phone.

- **Addendum (2026-11-23): five steps between the digits and the ink-line art.** The owner picked palette a, then
  found the ink-line print too detailed at fight distance: "reads as a 3D model" (smooth shaded cloth, clean
  outlines) and body flaws the digits hid. `?sheathArt=` now holds five steps: 0 the digits as shipped, 1 the
  digits in his palette with a stroke outline, 2 the digits lit and outlined harder, 3 the ink-line art with
  every cloth piece folded into one (no interior lines), no glints and half the rim, a the ink-line art. Data
  only: the wyrm's art sources (`light`, `strokeEdge`, `rimInk`) and per-rig uniforms; no renderer or shared
  material changed. Prints 1 - a wear a reworked body (full sleeves, one roll of scarf, plain gaiters, no wrist
  bands); 0 keeps him as he shipped. `sheathArt` stays `a` in `PICKED` and its Lab row is `awaiting` again (the
  picks test now lets a picked switch wait for a new pick). The author would pick 2 (DEVLOG 2026-11-23).
- **The pick (2026-11-23): step 2.** The owner picked 2, the digits in his palette, lit and outlined harder:
  `sheathArt: '2'` in `PICKED`, the Lab row no longer `awaiting`. 0, 1, 3 and a stay behind the switch. Known
  limits of 2 at fight distance: his digits are larger than the hero's letters, only his lit side prints (he
  reads narrower than the hero), the face does not read. The mark (`?sheathMark=`) is still not picked.
## ADR-154 — Wen Yao reworked: drawn like the hero, his selves only in packs out of the air, a big Pearl, the Nine-Tailed Fox's beam (2026-11-22)

- **Context:** the owner played the Thousand-Body Fox (ADR-147) and asked, word for word: "its hard to see
  the new boss character. make it look detailed like the main character so we can distinctly tell [whose homage
  he is]. also make the moves more [like that hero's], like [his palm orb] and other signature moves. the
  clones just randomly appearing as sponges is boring. i want them to like appear from the air and all
  attack at the same time or in a fast sequence forcing the player to dodge or parry. make it also summon
  the fox demon to do a ultimate beam that is scary and epic." Planned by Fable, built by Opus (a lead and
  two agents: the body; the fox and its beam).
- **Decision (the homage line does not move):** he stays an ORIGINAL in the spirit of a famous ninja-clone
  hero (ADR-147). The homage goes through what nobody owns: a spiky-haired young fighter in a short bright
  jacket with a long scarf, an orb driven in by the palm with a copy of himself shaping it, copies that drop
  in and gang up, a nine-tailed fox of fire (folklore) firing a beam from its jaws. Kept out, in every look
  option and every string: the orange jumpsuit with black or blue shoulders, a forehead plate, whisker
  marks, any emblem, blond spiky hair (his crest is russet; its gold outline was moved off the hair parts
  because it read as blond), hand seals, and every name from that series. The owner was told this once.
- **Decision (he is hard to see):** he and his selves are drawn in the hero's INK-LINE art, not the wyrm's
  art path: `?foxLook=h1` (a big russet crest with pale tips, a short open amber jacket, a long vermilion
  scarf) the default, h2 and h3 rendered beside it, the art-path outfits kept behind the switch. His letters
  follow his size on screen as the hero's do (`kit.letters`, `?foxLetters=b`): a small additive change to
  the pipeline (`_letterCell`, `_updateBossLetters`) that leaves every boss without the flag drawn exactly
  as before.
- **Decision (the selves):** the ambient mode is gone (Scattered Leaves, the cutting token, stalking). A self
  exists only inside a PACK, data on a move's beat (`pack: { n, mode, gap, form, blow, tell, from, ... }`):
  `FoxClones.pack` books every body as it is called (its mark, the time it appears = its blow's impact minus
  its windup, its impact) and tells every cue to the cue ledger up front, so the director and the fairness
  guard see the whole pack before its first cue; the fairness guard may shift the pack as a whole, or refuse
  it. A body appears in the air in a puff already attacking, strikes, and bursts. `together` is ONE cue and
  ONE result (one parry bursts them all; a held guard pays one blow: defensive play is never punished);
  `sequence` is n cues from n sides. Pack moves: Two Leaves Fall (phase 1: one pack move keeps the first
  phase learnable), the Thousand-Body Round, A Thousand at Once, the Burial (replaces the springboard), the
  Kite String, a harrying pack through the Pearl's charge whose strikers feed it. The pool grows 5 → 6.
- **Decision (signature moves):** the palm Pearl is big (about 0.9 m) and unmistakable: pale blue-white
  (`FIRE_PALETTES.pearl`), spiral arms, a drilling drive, a spiral burst, a quiet synth whirr; the Twin
  Pearls (one red cue, two lines); the Moon-Swallowing Pearl giant and lifted by two selves; "It was a
  copy" (his counter from phase 2, half the time: the struck body bursts as paper and he drops in behind
  the hero, the same cue). Phase 3's fire is its own kind (`?foxFire3`, the wyrm's orange-red), apart from
  the orb's colour. The Moon Wheel was cut (first in the plan's cut order).
- **Decision (the ultimate):** Heaven-Devouring Howl. The Nine-Tailed Fox is a creature, so a BODY in the
  wyrm's art path (CLAUDE.md), built in his constructor on a quiet Math.random (the seeded fights do not
  shift), hidden until summoned, standing side-on to the camera with its head drawn large (a fox seen from
  the front and above prints as a lump). The move is a flit and ONE red beat (`selfHit`, `sustain`: the
  ledger holds the lit window as one interval): the line fixed at the cue; lit 2.4 s; a sweep toward the
  hero's side, one way, so rolling back through it is safe; three ticks at most; a held guard pays guard,
  never health, and slides; the world breaks along it; then he kneels open 2.2 s. (Second pass, the owner's
  "yes, fix the fox": he summons it 10 m from the hero through the middle, not at the far rim, so the camera
  frames the hero and the fox's head at 36 - 41 m instead of ~60; its head is drawn 2.3x in profile with a
  pale throat, its nine tails are separate plumes, the beam fills its 3.6 m strip.) From 12 s into phase 3,
  32 s apart, forced once under 18 %. The camera holds the hero and the fox's head (`cameraRig.hold`: an
  additive, inert-unless-called pull-back, since the cinematic is capped at 3 s and the phone's extra zoom
  at 3 m).
- **Consequences:** phase 3 asks fewer cues a minute than phase 2 (68 against 80; 28 % of them dodges): the
  pressure meter is re-measured and says so. A full pack costs 9 draw calls a rig (73 → 118 with five out)
  and about 1 ms of poses a frame in node; the Howl 9 draw calls and at most ~1500 of the fire field's 6000
  blobs. Every look is behind a switch in `PENDING` for the owner's pick (`foxLook`, `foxLetters`,
  `foxfire`, `foxFire3`, `foxSpirit`, `clones`). Not settled: the fox at the game camera reads only when you
  look for it, and on the phone the Howl pulls the camera far back.

## ADR-155 — Tian Lei printed like the hero: his letters follow his size, the hero's quieter print, his own hair risen, a gi in ember with wraps (2026-11-23)

- **Context:** the owner: "the skybreak ring, the character is too detailed and is showing its flaws in 3d.
  make it more ascii like, like the main character, to hide its flaws. also make the phase 2 and 3 golden
  hair not be so long and more natural iconic looking. also change the character's color and cloth a bit to
  not make it look too obvious its goku". The human bosses are drawn on a fixed 4 px cell (8 at 4K); the
  hero's cell follows his size (ADR-130), so from 1080p up Tian Lei had about twice the hero's letters
  across him, and the extra letters drew his limbs and shoulders as shaded 3D tubes. His print was lifted
  for the ring's floor (`ASC_LIFT`, ADR-129): bright skin, a strong rim. The form 2 - 3 hair stood one and a
  half to two heads above the scalp.
- **Decision** (three rendered sheets, the owner picked the recommended option of each):
  1. **His letters follow his size** (`?ascLetters=a`): his kit's `letters` (a getter on the switch) turns
     on the bosses' letters (ARCHITECTURE "The bosses' letters"): `uHeroCell` from his depth by the
     hero's rule. The renderer code is the fox rework's (PR #94, ADR-154 there), taken word for word, so
     the two branches add the same lines; only the kit flag is his.
  2. **The hero's quieter print** (`?ascLift=b`, `ASC_QUIET`): the cloth × 0.85, the skin × 0.62, the
     rim × 1.5 (lifted: × 1.4 / 1.2 / 3.2).
  3. **His own hair risen** (`?ascHair=b`, `goldRisen`): form 1's spikes, each where it grows, turned up
     and back; about his dark hair's height; form 3 sharper, one lock over the brow, no taller. Measured:
     the gold's top 0.15 / 0.27 m above the dark hair's (forms 2 / 3) before, -0.02 / 0.01 m now.
  4. **The gi with wraps in ember** (`?ascLook=e`, base `k`): the orange gi's cut, a burnt-red gi with
     black where the blue was (undershirt, sash, boots), off-white cloth wraps on the forearms and shins
     (outfit a's arms and legs) instead of wristbands and tall boots, longer sash tails.
- **Options kept** (Lab LOOKS rows): `?ascLetters=0`, `?ascLift=a` / `0`, `?ascHair=0` / `a` (a short
  crown), `?ascLook=r` (crimson top over charcoal) / `w` (an unbleached gi) / `h` (the orange gi).
- **Not kept:** a bolder letter (0.144 m) and a storm-blue gi (it read as the hero's own blue-grey cloak:
  the two fighters must stay apart at a glance).
- **Why not** the hero's own part tables (`uSelfPart*`) for him: they are the player's alone (his pixel
  window); a quieter print from his own fills gets most of the way without a second set. **Why not** the
  ink lines per font pixel for him as for the hero: the fox rework's code does not, and the two bosses
  should not differ; at the 42 m camera on 1440p his lines are one pixel either way.
- **Consequences:** on the phone and at 720p nothing changes in his letters (both were 4 px already): the
  print, the hair and the gi carry the change there. Every other boss is drawn as before (`bossLetters`
  false). Tests: `asc.mjs` `herolike` (the cells beside the hero's on five screens, the fixed cell when
  off, the quieter print, the hair's height, the three gis without blue), `body` (the default is e).

## ADR-162 — Tian Lei's blows audited and fixed: feet that stay planted, arms that open, palms that stop at the hero; he breaks off a blow the hero has left (2026-11-23)

- **Context:** the owner: "ok looks good but i noticed a lot of the attack animations and attacks look unnatural. audit it and fix it to improve it. make the boss also stop attacking empty air if the player moves out of the distance". Asked vaguely, so measured first: an opt-in audit (`asc.mjs audit`: every
  move run with the hero still in front of him and circling him, his joints tracked frame by frame in his
  own frame and in the world round his root; `auditfight`: 30 s a form of his AI against a defending bot,
  the worst jolts with what he was doing) and film of the worst moves.
- **Found and fixed (motion):**
  1. **Feet that jumped.** `Ascendant._planFeet` holds a planted foot in the world while the close-in step
     moves his root; the pose hook dropped that offset the moment the keys lifted the foot above ankle
     + 8 cm, and the keyed height flickered across that line: a foot jumped up to 0.7 m in a frame at the
     strikes of every punching string (jolts 900 - 1966 mm a frame²). The offset now goes smoothly (a
     weight eased at 14/s, the offset fading in the air), the planner answers his TURNS as well as his
     travel (a planted foot no longer swivels with him), and both feet may step when one lags past 1.6x
     the reach.
  2. **Arms that never opened.** The shared arm solver's soft reach (`ARM_SOFT`) left every punch landing
     with the elbow at ~130°, a crooked arm at every contact (the hero had the same complaint in Session 30
     and has `HERO_SOFT`). The animator takes an opt-in `armSoft`; Tian Lei uses the hero's numbers (149 -
     155° at contact). `legSoft` likewise for the legs (his kicks keep a little bend).
  3. **Palms through the hero.** A palm thrust on a dash stopped 0.8 - 1.0 m from the hero while the palm's
     lunge reaches ~1.35 m: it ended 0.37 - 0.44 m inside him. Those dashes stop at `PALM` (1.35 m).
  4. **The roundhouse's knee flipped side to side**: its knee was keyed toward the target, and the leg
     crossed that direction as it swung round. The knee points up and over now (the chamber's).
- **Found and fixed (the empty air):** the engine stopped a string for want of reach only once, at the start of each LATER blow's windup; the first blow was never checked, and a hero who stepped or ran away during a windup still had a blow thrown at the air (a whiff meter, opt-in `asc.mjs whiff`: a fleeing hero drew 18 swings at air a minute in form 1, 60 % of his melee swings). The pursuit (`pressure.pursue`, opt-in in the duelist engine; ported by a helper agent from the stale epic pass's uncommitted `asc5/ai` work and finished): through each real melee beat's windup up to its glint the hero is led to the impact and set against what the blow can still reach; past it by 0.5 m he breaks off (no glint, no hit: a glint is always followed by a blow) and chases (a far / away link, else footwork). A hero backing away is chased with a longer step-in and dash in forms 2 - 3 (form 1 as before: with it, form 1 came out as busy as form 2); a blink arrives where the hero is going but never in front of him (`blinkKeep`); a move that cannot reach where he will be is not picked; a hero who keeps running is read (moves that reach anywhere weigh more). Swings at air: 0 a minute for every bot and form (roam, retreat, flee, kite). A blow at air was a cue, so PACE's floors were re-pinned from the same ten seeds (minRate 74 / 77 / 80, ramp 0.95 / 0.91; the means still climb form over form, x1.067 / x1.10; 0 conflicts)
- **Why not** slow his tracking turn (up to ~900°/s when the hero circles him in a windup): it is a
  difficulty lever (a sidestep would answer more blows), not a pose; asked, the owner kept it as it is
  ("Leave it", 2026-11-23). **Why not** a
  tremble through the long held windups (the beams' charges stand still up to 1.1 s): at the game camera
  a few centimetres do not show and a shimmer of letters would; left as it is.
- **Consequences:** frames of a real fight with a visible pop (a jolt over 300 mm a frame²) 87 -> 23 (the
  worst 1966 -> 715, the sweep kick shooting out); the per-move total 47 316 -> 23 677. `armSoft` /
  `legSoft` are opt-in: the other rigs are drawn as before. Tests: `asc.mjs` `motionfix` (fails on the old
  code: the strings' feet 910 - 1146, elbows 128 - 131°, palms 0.35 - 0.40 m in, the knee 731) and
  `pursuit` (a hero who rolls out of a windup gets no glint and no hit and is chased; a hero who stays is hit as before; a sprinter is caught by the dash; Sign Step still lands behind a runner) and the opt-in whiff meter (0 swings at air a minute for every bot).

## ADR-165 — Attack sounds: a cue only for blue and red, every blow sounds like its weapon, recorded and picked by ear (2026-11-22)

- **Context:** every attack played a synthesised cue: a tick as a white windup started and a ping before
  it landed, a rising bell for blue, a brass stab for red. The owner found the blue / red sounds tacky
  and did not want the player to rely on sound for everything. A human boss's blow made no sound at all
  until it landed. Recorded effects had been tried once (PR #55, 129 sounds over everything) and turned
  down as noisy (ADR-117).
- **Decision:** sound marks only what needs a different answer. A white blow has no cue; blue and red
  (and black) keep two, a warning at the windup (`combat:tell`) and a timing sound before the impact
  (`combat:flash`), as in-world recordings (steel for blue, a drum for red). Every blow sounds like its
  weapon as it travels: the duelist engine announces each real blow with `dragon:attack` and a
  classification from the beat data (`weapon` per boss in its tuning, `weight` from damage / knockdown /
  black, `shape` cut / thrust / kick / draw), and the audio lines the clip's loudest moment up with the
  impact. The recordings are a small set of slots (12), loaded after unlock, synth fallback per slot,
  their own random stream; the owner picks every file by ear on an audition page; `?sfx=old` keeps the
  sounds before. Hazards and bullets keep their cues.
- **Consequences:** the fight reads by eye first and by ear only for parry / dodge; a string of blows
  sounds like a fight, rate-limited (0.09 s between boss blows) so it does not turn into the noise of PR
  #55. New bosses need only a `weapon` in their tuning. The CC0 material has no real punch or creature
  swipe: the fist and wyrm slots are swishes, some slowed, and may be replaced. The blue timing sound
  stays today's synth ping: the owner heard three rounds of candidates and kept it (`time-blue` has no
  file; a pick later is a line in `scripts/audio/sfx-picks.json` and a rerun of `build-sfx.py`).

## ADR-167 — The streak pass: six pieces behind switches on the streak's tiers, looks only past seven, an accelerating storm, a perfect parry's look read at the moment, the burst as lines (2026-11-23)

- **Context:** the owner: "i want to enhance the perfect parry / dodge effects and especially the streak combo hits. right now when the streak is really long, the animation to show the full streak is a bit long and doesn't look epic and cool. the longer the streak, the faster the attacks and way cooler animation and effects. think of cool subtle and epic stunning effects for players to love having a streak and seeing the longer and longer combos. use fable to plan it out and have opus do the work. ask me any questions". The flurry (ADR-091, ADR-094, ADR-101) struck N = the streak blows, 7 at most, and took about 2 s round the wyrm's head and 2.9 s on a man at seven; past seven nothing changed; a single perfect parry / dodge had one look. Asked, the owner chose an "Accelerating storm", "Looks only, in tiers" past seven, all four between-flurry pieces (the hero and blade, a counter moment, a climbing sound, the world), and two perfect looks to compare.
- **Decision:**
  1. **Six pieces behind switches on one core** (`combat/streak.js`): `STREAK_FX.on` / `k` for storm, tiers, aura, counter, sound, world (`?streakfx=off | all | a comma list`, the Lab's 'streak' row), `streakK(piece)` (0 = off), read at the moment each piece acts. With a piece off it draws, sounds and times as before; each piece's scenario checks that.
  2. **Tiers, not counts.** `STREAK_TIERS` [3, 5, 7, 10, 15] give `streakTier(n)` 0 - 5, read anywhere, never stored. Every piece grades by tier (one idea a piece, more of it each tier), so a streak reads in a few steps instead of a new effect per count.
  3. **Looks only past seven.** `DEFENSE.flurry.max` (7) stays the cap of blows and of damage; tiers 4 - 5 change looks (echo lines on the hanging cuts, the banner's name and rules, the aura's coverage, the sound). Asserted: a streak of 15 strikes the same 7 blows for the same damage in the same time as a streak of 7.
  4. **The storm's pacing rule** (`DEFENSE.flurry.storm`): the first `shown` cuts (3 round a head, 2 on a man) are paced as before; each later cut takes `fall` (0.56, ^ the piece's strength) of the one before, never below `floor` (0.12) of a shown cut. A storm cut has no wind-up seen and a contact freeze of at least `stopMin` (0.018 s); when its beats are shorter than a frame, the frame runs on through them, so every blow lands in a frame of its own, in order, with the hero drawn at the contact. Its weight (camera x`cam` 0.35, flare and sparks x`fx` 0.45) is scaled; the last shown cut, the art and a riposte's last cut keep their whole weight. The camera holds the target through the storm.
  5. **A single perfect parry / dodge has three looks, read at the moment, the rules unchanged** (`combat/perfectFx.js` `PERFECT_FEEL`; `?perfect=today | sharp | cinema`; `perfectMode()` defaults to `PERFECT_DEFAULT` 'sharp'). The look changes the freeze, shake, punch, slow motion, flash / dim and the marks; the windows, guard, posture, i-frames, crit window, riposte / flurry and where the hero ends up do not. Slow motion changes real time, not game time (duel `perfectfx`: the punish window 1.016 / 1.002 / 1.014 s of game time). The mark is written in the fire field's `steel` like the impact stamp (ADR-149): one blob a cell, hexagon rings, stepped frames held in REAL time (so a mark does not stretch in the slow motion it sits in), ink on black, never over the hero. Cinema's full beat is gated (a string's inner blows get a short beat; no two full beats within 0.9 real s) so a string of perfect parries does not crawl. `flow.cinematic` gained `ease`, `back` and `quiet`; `ScreenGrade` gained `dimPulse`.
  6. **The burst as lines** (`player/flurryBurst.js`, `?burst=0..3`): the last blow's lights, flares, stars, halo, flashes and the boss's white flash are turned down together and the hanging cuts flare out as thin long lines; level 0 is today, every level makes the same random draws (the flurry's effects have their own seeded stream). Presentation only.
  7. **The aura is a rim in the fire field** (`player/streakFx.js`): one blob a letter cell just outside the hero's projected silhouette at a fixed low heat (0.17); the tiers change coverage, never heat; nothing on the boss's side, never over him; the loss turns it all to smoke in one frame. Round 1's lines on the steel stay under it.
  8. **The owner's picks are the defaults** (from the picks page): sharp; the counter's `lines` look; HUNDREDFOLD / THOUSANDFOLD FLASH; the guqin harmonic on a minor pentatonic; burst level 2; the aura as built.
- **Turned down:** **cinema** as the default perfect look (kept behind `?perfect=cinema`: a long beat on every single blow); **steel-blue fire** for the aura (`?auraFire=b`, kept); **the round-1 aura as the main read** (lines on the steel and a wake of letters: "almost not visible" at the game camera; kept under the fire); round 2's loose rising fire (read as floating stacks of letters, not as him burning); the counter's `brackets` and `ticks` looks (kept behind `?streakCount=`); the sound's singing bowl on a natural minor and its dry steel.
- **Consequences:**
  - The pace of a long flurry: against the wyrm the seven's flash cuts take 1.18 s (were 1.52); a flurry of 4 or fewer is unchanged round a head (3 or fewer on a man). Against Shen Hui the flurry agent measured the whole seven 2.88 -> 2.05 s.
  - Payloads grew (no new event): `player:flurry` gains `streak` (the streak it answers, past the cap), `tier`, `storm` (bool) and `at` (the planned contacts, real s); `player:flurryHit` gains `gap` (real s since the blow before) and `storm` (0 a shown cut, 1, 2, ... into the storm); `player:parry` gains `feel` and `beat`; `player:perfectDodge` gains `feel`.
  - Open: the tier rings on the burst do not read under its remaining glow; on Cinderwood the fire field barely prints near the hero in headless captures (field-wide, cause not found); the aura blinks off for the Ghostep's cold cast after every perfect dodge; nobody has played it, heard the sound in the game, or seen it on the phone.
  - **The wyrm's pace meter is per seed and in the mean** (`TUNING.pressure.meter.rampSeed` 1.05, `ramp` 1.12 over the seeds' mean): a test seed replays a different fight whenever the scenarios before it change (seed 1337: x1.06 inside `all`, x1.28 alone), so a per-seed ramp of x1.12 failed on seed luck, not on the wyrm. The duelists already had this rule (ADR-122). No pressure number changed.

## ADR-159 — Halcyon Plaza: a city read from its streets, explosions the set polls, four kinds of heat, two-stage towers (2026-11-22)

- **Context:** the owner asked for "some kind of ascii city where his moves are completely destroying the
  buildings, cars, signs". The game camera looks down at 58 degrees from the south: the sky and the skyline
  are never on screen, upright things are squashed, and nothing tall may stand south of the fight. The
  destruction system (ADR-107) has no on-break callback and nothing in it explodes; a raised piece (`y0` >
  0) was missed by a blow at its own height.
- **Decision:** `world/halcyonPlaza.js`: a crossroads round a plaza of asphalt (r 15), read from its streets:
  lane paint and crosswalks carved into the floor's slabs (the painted ones cut finer), cars seen from
  above, the south faces of four two-stage towers (a base that `holds` its top: the top `y0` 6.5, `fallT`
  1.6, `blocks` 5; the falling sky takes one), lamp posts, signs, shop signs hung on the fronts (`y0` 3.2,
  light pieces), four screens showing his face, his statue (body, head `y0`, the raised arm `lift` 1), block
  fronts (range pieces) and street furniture; all in `breakables` (82 rigid-batch pieces, 279 floor slabs).
  Only flat silhouettes past 36 m are static (never on a blow's path), as the grove's bamboo wall and the
  forest's far trees are recorded. Explosions are the set's: its ambience polls the cars (as the Skybreak
  Ring polls its braziers' posts): a broken car burns `CITY.car.fuse`, told and cued as a falling piece
  (the boss's fairness guard may quiet it), then a blast that hurts the hero (blockable) and him (when the
  hero broke it), at most two bangs in 0.5 s. Its light is four kinds of heat in the fire field, used on
  purpose (STYLE.md "The city's light"): steel neon and screens, void his crimson, fire the wrecks, smoke
  the rest; `setPhase(n)` by his phase. `destructibles.js`: a blow passes over a piece above `y0 + h`, not
  `h`, and lands inside `y0 .. y0 + h` (no lower bound: a base passes its blows to its top).
- **Consequences:** a fifth kind of set: a hard city, not a natural ground. The y0 fix changes no other
  level's fight (the ring's butte tops were never above a blow that reached them; `asc.mjs` passes). Fallen
  tower tops are wreckage blocks you walk over, not new cover (nothing can be spawned mid-fight). Measured
  at the phone preset (852 x 393, touch on): 76 draw calls against the Skybreak Ring's 73; the set alone
  ~140k triangles after the brick cut. Frame time on the owner's iPhone is not measured.

## ADR-160 — Halcyon, the Last Saviour: flight that never leaves a sword waiting, the crash as the reward loop, his eyes, the grab, the line on the homage (2026-11-22)

- **Context:** the owner asked for an evil caped strongman from the future, two well-known characters named as the reference ("laser eyes, flying
  around a lot with super speed and power". The earlier take (the Heaven-Fallen, PR #78, closed) failed on
  four counts the owner named: he did not look the part, its sunlight rule was a gimmick, its setting a dark
  vault, he was too slow and grounded. A flier against a swordsman is unfair unless the flier comes to the
  sword.
- **Decision:** a duelist on the shared engine (`entities/enemies/halcyon/`), bare-handed. THE FLIGHT RULE:
  he hovers at 0.5 m within sword reach between moves and leaves reach only inside a move that brings him
  back (tests FLIGHT hold the stretch out of reach to 2.6 / 2.2 / 2.2 s and to none in footwork). No special
  rule: the reward loop is that the hero's answers put him through his own city: a parried flying blow, or
  a perfectly dodged red one, THROWS HIM OFF HIS LINE into the first cover on it (the crash: buried, 60
  damage, open; nothing on the line, a skid); his Stare perfectly parried goes back into his eyes; a thrown
  car parried is cut in two and its halves go up behind the hero. His eyes are heat from two points at his
  eyes (`glare.js`, Tian Lei's beam the reference: a held guard pays guard, never health); Red Glare is lit
  at its cue and crosses the hero's bearing flashLead later. See the World carries the hero on his own
  knockdown (the hero has no air state): control is gone at most 1.6 s, never on a hero who is down. The
  line on the homage: a new name for him and every move; the names of the characters the owner gave and of
  their worlds appear nowhere in the game (tests DATA checks his data and the level's lines); no letter,
  shield or symbol on him; what carries it is what nobody owns: a caped strongman who flies, red heat from
  his eyes, a clap that breaks glass, a car thrown one-handed, a smile for the cameras.
- **Consequences:** the bar is 14000 (the fencing bot wins in 156 - 183 s; at 3400 it won in 40 - 46 s:
  every crash is a long opening, as designed). Cut: Last Word (a held two-eyed beam and its clash), the
  hydrants' water spouts, his own SFX (the existing synth sounds play his events). His red role for
  Training is Meteor (a beam is no fixed contact for a perfect dodge); Meteor has no weight in phase 1.

## ADR-161 — Halcyon's looks wait for the owner; no reward yet, by the owner's word (2026-11-22)

- **Context:** the owner answered "Recognizable" for his look (a deep blue armoured suit, a long red cape,
  gold trim, burning red eyes, slick hair, neon cyber seams, no chest emblem) and "i havent decided yet.
  we'll worry about this later" for his reward.
- **Decision:** three bodies behind `?halLook=a|b|c` (a the owner's answer, b the idol, c tomorrow's
  tyrant), his eyes' heat behind `?glare=a|b|c`, the city behind `?city=a|b|c`: all in lookSwitch `PENDING`
  and the Lab's LOOKS rows, none in `PICKED` (`halLook` a is the owner's answer to a question; the sheet is
  still theirs to confirm). Every option in the hero's ink-line art, dense and bright. The sheets:
  `docs/looks/halcyon/` (each body hovering, mid-blow and in a pass beside the hero, true size and x3, at
  1280 x 720, 852 x 393 and 2560 x 1440; the three palettes on a lit Stare; each city wide and at the
  fight camera, whole and wrecked). No reward ships: no `reward` field on the level, no grant, no victory
  note; one line in ROADMAP M2.
- **Consequences:** the fight is built and tuned with a / a / a; a pick changes only colours, the gear and
  the set's light.

## ADR-164 — Halcyon's cape and colours read at game size: `?halCape=0|1|2|3` (2026-11-23)

- **Context:** the owner asked to "fix the look": at true size (he is ~40 px tall at 1280 x 720) the sheets
  did not read as a blue suit, a big red cape and a gold belt. Measured (pixels round him at 1280 x 720 that
  print red / blue / gold, look a): facing the camera 24 / 494 / 0, side-on 115 / 432 / 2, from behind
  199 / 164 / 0, in a pass 332 / 603 / 2. Three causes, all confirmed: facing the camera (most of the
  fight) the cape hung hidden behind his body and the two outer sheets were edge-on; what showed of it was
  its inside, the `lining` part, which prints dim (a 0.24 fill read near black); the cool moonlit rim
  (`uArtRim` x3 on the cape) and the cloth parts' lavender ink turned its red pink; the gold `trim` part's
  white ink lines printed the 5 cm belt cream, under one letter.
- **Decision:** one switch of graded steps of one idea (the wyrm lesson: steps, not redraws), read when his
  rig is built: 0 as he was built; 1 the colours (`look.js` HAL_BRIGHT: the cape a clean red inside and
  out, its lining lit past 1 because that part prints dim, no moonlit rim on the red, a brighter blue suit,
  a gold drawn in the `hair` part whose ink lines are gold, and bigger: belt, buckle, clasps, cuffs, boot
  tops; b navy and gold with the cape's gold lining lit, c black and chrome with a crimson cape); 2 + the
  shape (`gear.js` CAPE_SHAPE: the same five sheets wider, spread off the shoulders' tops so the cape shows
  past his arms on both sides and frames him from the front, longer, flaring a little more); 3 + it never
  hangs still: a new optional streamer field `breeze` ([extra out, rate], `player/anim.js`: a slow swell
  of the flare while the wearer is near still, gone by 4 m/s; no other streamer has it) and a longer
  trail in a pass (`lag` 0.95, `max` 1.7). Default 3 (`HAL_CAPE_STEP`), recommended: it is the only step
  where the cape reads from every side at true size, also on the phone; in `PENDING` and the Lab's LOOKS
  rows, not in `PICKED`. No emblem, letter or symbol; the hero's ink-line art throughout.
- **Consequences:** after (step 3, look a): facing the camera 237 / 463 / 23, side-on 339 / 415 / 37, from
  behind 1262 / 163 / 0, in a pass 368 / 993 / 12; b's gold lining 244 gold pixels facing the camera, c
  black and chrome against a crimson cape: three figures. No new object on his rig (the same five sheets,
  joints and meshes; the gold moved part, not count), so the seeded fights did not move (`city pace`,
  `win` green before the whole suite). Not changed: his eyes' beam (`glare`), the fight's data. The sheets:
  `docs/looks/halcyon/halCape.png` and the three `halLook_*` re-rendered with step 3 (the old ones kept as
  `halLook_*_before`). Not solved: the cloth parts' lavender ink still tints the lining's lines pink at a
  grazing angle (the per-part ink is shared by every rig on the page).
- **The owner's picks (2026-11-23):** his body, `halLook` a (the deep blue suit and red cape), from the
  `halLook_*` sheets drawn with step 3; the city, `city` a, Neon Rain, from `city.png`; his eyes' heat,
  `glare` a, crimson with a white-hot core, from `glare.png`; and the cape, step 3, "billowing", from
  `halCape.png`. `halLook: 'a'`, `city: 'a'`, `glare: 'a'` and `halCape: '3'` moved from `PENDING` into
  `PICKED`; the defaults they already drew, so nothing visible changed. None of his switches waits now.

## ADR-166 — Halcyon printed like the hero, a smaller cape: `?halLetters`, `?halPrint`, `?halCapeSize` (2026-11-23)

- **Context:** after picking his look (halLook a, halCape 3, glare a, city a), the owner: "make his cape
  smaller, make him look more ascii like to look like the main character ascii look more ascii made up".
  Nearly the words of ADR-155 for Tian Lei, and the same cause: the human bosses print on the fixed 4 px
  cell (8 at 4K) while the hero's cell follows his size (ADR-130), so from 1080p up Halcyon had more
  letters down him than the hero (measured, letters down 1.85 m at the fight's distance: 1080p 13.8 vs
  the hero's 8.6, 1440p 18.4 vs 8.6) and read as a shaded 3D model; and his step-3 print was lifted (a
  strong edge of light, rim x3). From the front the wide cape (halCape 2 - 3) was the biggest shape on
  screen.
- **Decision:** three switches, the recommended option the default; the owner kept it ("Yes, keep it",
  2026-11-23): `halLetters` a, `halPrint` a, `halCapeSize` b are in `PICKED`, out of `PENDING`:
  1. `?halLetters=0|a` (default a): his kit's `letters` getter, exactly as Tian Lei's `ascLetters`:
     `pipeline.bossLetters` gives him the hero's cell (ARCHITECTURE "The bosses' letters"). Live.
  2. `?halPrint=0|a|b` (default a): a is Tian Lei's quieter print numbers (`ASC_QUIET`): the suit x 0.85,
     the skin x 0.62, the suit's rim x 1.5 instead of x 3; the cape's red and the gold keep their light
     (lining x 0.9, the gold x 1); b halfway (x 0.92, skin x 0.8, rim x 2.2). Both keep the blue suit, red
     cape and gold belt at true size (red / blue / gold pixels facing the camera at 1280 x 720 with the
     cape b: print 0 123 / 471 / 30, a 112 / 474 / 35, b 118 / 470 / 30).
  3. `?halCapeSize=0|a|b|c` (default b): the cape's sheets' length and width x 1 / 0.8 / 0.65 / 0.5 (the
     root's width by the square root, so it still pins across the shoulders), the flare's angle, the
     colours and the billow kept: the spread from the front shrinks with the length, so the flare needs
     no scale of its own. b: 1.00 m long (was 1.54), its widest hem 0.52 m (was 0.80); it still frames him
     from the front and hangs past his knees; c (0.77 m) shows little of it from the front.
- **Consequences:** letters down him / the hero, before -> after: 720p 9.2 / 8.6 -> same (both 4 px),
  1080p 13.8 / 8.6 -> 9.2 / 8.6 (6 px), 1440p 18.4 / 8.6 -> 9.2 / 8.6 (8 px), 4K 8 px -> 12 px, the phone
  9.8 / 9.2 -> same (4 px): on the phone and at 720p the print and the cape carry the change. No object
  is added to his rig (the same 90 meshes): `city pace` / `win` give the same numbers. Sheets:
  `docs/looks/halcyon/halAscii.png`, `halCapeSize.png`, `halRecommend.png`. Tests: `city.mjs herolike`.

## ADR-163 — The living world: one wind per level, nine layers behind one switch, off until the owner picks (2026-11-23)

- **Context:** the owner: "make the ascii world feel more alive. have natural looking ascii wind, subtle
  falling leaves, subtle different weather effects. before we fight the boss, the player should be awed
  at the background living ascii world. things like players footstep as you run etc." Asked, they chose
  every piece offered (wind you can see, leaves that fall and lie, footsteps, weather that comes and
  goes, small creatures, the sound of the air, an arrival moment, the world answering the fight) and
  one mood per level that changes slowly. Before this the grass swayed on one sine, the trees on
  another, smoke drifted by a constant, three levels shared one default weather, every level shared
  one sound bed, a footstep was one noise burst on every surface, and nothing agreed with anything.
- **Decision:**
  1. **One wind, read by everything.** `game.world.life.wind` is the level's air: a prevailing
     direction and breathing speed, gust FRONTS that cross the level as travelling lines, radial bursts
     (every existing `world.gust` call lands there). The grass, the tree canopies, the fire field's
     smoke and flames, the atmosphere's emitters, the litter, the rain, the creatures, the sound and
     what hangs (banners, paper charms) all read that one field, CPU (`wind.at`) or GPU (`uWind`,
     `uWindFronts`). Nothing new invents a drift of its own.
  2. **Layers behind one switch.** `world.life` (`world/life/life.js`) builds one object per piece
     (wind, weather, litter, steps, creatures, answer; `audio/air.js` and `game/arrival.js` read it
     from outside). `?life=off|all|<pieces>`, `?lifeK=`; the Lab has a toggle per piece. Each layer
     keeps its numbers in its own tuning file with a block per level.
  3. **Off is free, and off is the default for now.** With a piece off its code spawns nothing, writes
     no uniform that changes a pixel and makes no GPU object; the shaders run today's code in their
     wind-off branch. Headless it is always off, so the seeded fight suites replay exactly as before.
     The default stays off until the owner has picked a strength from films and on their phone
     (CLAUDE.md: a change to how something looks is the owner's pick first).
  4. **Its own random stream, and no new events.** Nothing in it calls `Math.random` (the seeded sims
     replay it; three.js even draws object ids from it, so GPU objects made inside the frame go
     through `life.build`). It listens to events the game already emits and adds none;
     `player:footstep` gained one optional field.
  5. **It steps back in the fight.** `life.calm` eases every ambient rate to 0.4 while the boss is up;
     red and black tells make the world hold its breath (`life.hush`); nothing ambient uses a tell's
     colours or draws over the hero. The roar's answer (a gust front from the boss) is the biggest
     thing it ever does.
  6. **The Windless Grove has no wind.** Its bamboo swayed on the forest's sine against the level's own
     lines; with the wind piece on nothing there moves except what the fight moves. The Obsidian Throne
     has nothing alive: its one show is the star's slow breath.
  7. **Cloth stays breakable.** A hanging part is marked in its builder and carries a per-vertex hang
     weight through the brick cutting and the rigid batch, so a banner streams in the wind, takes a
     bite where the blade lands on the leaning cloth, and lies still once felled.
- **Why this way:** a fixed contract with a stub per layer let seven agents build in parallel against
  each other's interfaces and merge with no conflict; one field is what makes many quiet things read
  as one living place (the same gust bends the grass, leans the smoke, lifts the leaves, flutters the
  charms and is heard). Keeping it off by default costs nothing and keeps every seeded test as it was.
- **What the first pass taught (now a STYLE rule):** built to the word "subtle", everything worked and
  almost nothing could be seen: at the game camera a thin stroke under ~0.3 m is one pixel of ink. A
  second pass tuned to a ten-second test (a player at the spawn, told nothing, notices the place is
  alive) while keeping the manner natural: letters with body at 0.3 - 0.5 m, or motion, or both.
- **Tried and cut:** the hawk's shadow on the Ring's floor (invisible at dusk); dark grit at the Throne
  (invisible: ember-edged cinders instead); sparks at the Throne's vents (they added nothing); round
  dots for lying ash (read as snow: flat strokes in drifts instead).
- **Consequences:** a new level needs a block in each layer's tuning file (without one it gets the
  quiet default). Open: the default strength (the owner's pick), the sound's level (an audition page
  exists), the ash drifts and the Throne's glint do not read yet, a banner's moon shadow does not lean,
  the far Throne banners (static mesh) stay rigid, and the `life` suite is the longest new CI task.
- **Addendum (2026-11-23, the owner's verdict):** on the first preview the owner turned the wind and the
  weather down: "wind effects need to be way subtle and not like this random wave taking over a full
  screen, the ascii characters should also not be so big and be tiny feint and clearly many ascii
  characters clumped up. same with the other weather effect. make it very subtle and more ascii like
  and natural realistic." ("sound looks good": the air's sound stays as built.) What changed: the
  front's lit BAND through the grass is gone (`grass.lift` removed; the slot is now `patch`, a gust
  stirring loose local patches, the grass's `front` 0.24 (0.22 on Ashfall and the Ring) where it was 0.8 -
  0.9; the canopy's `front` and `stir` 0.28 and 0.08 where they were 0.75 and 0.16); the streaks became WISPS, clumps of 64 - 96 tiny letters that ride
  the air, stretch, curl and come apart (none on the Throne or in the Grove); the mist banks became soft
  heaps of 160 - 220 tiny letters that roll, the veil under them removed; the drizzle, the ash, the
  squall's embers, the snow and the devils' 150 grains print in the same letters; leaves and paper in
  the air shrank to 0.28 - 0.36 m at alpha 0.72. Every letter of the air prints through a new
  `LetterBatch` (`world/life/letterBatch.js`) as one cell of the house letter, the wyrm's pixel font
  (5 x 8 px at 720p), whatever its distance. Glyph particles from the world atlas were tried for it and
  cut (below about 0.4 m they blur to specks), and so was the fire field (its smoke is the bonfire's,
  any heat in it hazes the world, mist printed in it came out as dark-backed slabs). **Why the
  ten-second test was the wrong standard for this owner:** it asked whether a player told nothing would
  NOTICE the air, and the visibility pass answered by making letters bigger and brighter and the band
  stronger; this owner reads the air as alive when there are MANY tiny faint letters clumped into a
  shape, not when one thing is easy to see. Visibility comes from count and clumping, never from size
  or light (now a STYLE rule, "The living world"). What still holds from the first pass: a letter that
  must be seen on its own (a lying leaf, a firefly, a bird) has body, 0.3 m or more.
- **Addendum (2026-11-23, on by default):** on the round-2 preview the owner said "Looks right", then "Turn
  it on". A page with no `?life=` now gets every piece at strength 1 (`?life=off` turns it all off);
  headless it stays off, so the seeded suites are unchanged. The two levels that arrived from `main`
  meanwhile (the Hall of Falling Script, Halcyon Plaza) have no tuning blocks: on them the arrival and
  the air stand down (the arrival's DEFAULT shot does not know where their spawn is; the air's quiet
  recipe would silence their own voices), weather, litter and creatures have nothing to draw, and the
  wind and the steps run on their defaults. Their blocks are open (ROADMAP).

## ADR-168 — Xin Yi reworked (1): phase 1 in two gears, the flurry burst, acrobatic kicks and air, Borrowed Wall off the side upright (2026-11-23)

- **Context:** the owner played the merged fight (ADR-156) and asked, word for word: "make him more ascii like
  to match the main character feel. he's too detailed and we need the ascii look to hide the imperfections.
  his attacks and animation needs to be improved. he's overall boring right now and you need to add way more
  faster combos, cool acrobatic kicks, air attacks, jumping from the side wall to kick, flurries of combos,
  especially in the first phase. 2nd phase make his bullets not put you in a stunlock so player can parry or
  dodge out of it in a small window." A planning session asked four questions; the owner took the
  recommended option of each: phase 1 is one hand, then both about a third in; strings keep the 0.32 s floor
  and speed comes from longer strings, less rest and one-cue flurry bursts; bullets in bursts of three with
  gaps (ADR-169); he looked too detailed on the iPhone and the desktop (ADR-170). Measured first: phase 1 had
  six moves, 65 - 71 cues a minute, the longest gap 3.29 s, 7 % dodges, and Borrowed Wall almost never ran
  (an upright within 4.5 m only).
- **Decision:**
  1. **Two gears inside phase 1** (same bar, same gate). Gear 1 one hand (the left behind his back). At bar 1
     <= 0.83, between two moves (in his footwork or a move's recovery: under steady links he never stood in his
     footwork for seconds), the move `secondHand`: he flips back, the left hand comes out, a shake of the
     wrist, a two-handed guard (`GEAR2_GUARD`); 0.9 s with his guard down (a real opening; no ring, no
     invulnerability); `dragon:gear`, the banner HE STOPS TEACHING. Gear 2 realises phase 1 two-handed round
     its own guard and adds A Hundred Hands, The Long Lesson and Storm Step; gear 1's moves stay at x 0.55.
     Per-gear pressure through getters on `TUNING.idleGap`, `chain`, `pressure.chainDepth`, `chainRest`
     (`GEARED.now`), so the engine reads them unchanged.
  2. **The flurry burst** (`flurry: { n, dur, cap }` on a `sustain` + `selfHit` beat; flurry.js): ONE cue,
     one windup >= 0.42 s, one glint, one ledger interval; 6 - 8 blows drawn over 0.7 - 0.75 s (the limbs
     alternate at ~10 a second, a fan of three trails, an afterimage every other blow, a patter); the hero's
     answer is decided ONCE by the first blow that finds him: a parry turns it all (+ 20 posture, a heavy
     deflect), a held guard pays at most `cap` (30) guard and no health, a roll dodges it all, a hit is one
     stagger and chip that never re-staggers, pushed out of reach. At most one burst a move; its own category.
     The name was grepped against every boss's move data first (`burst` is Tian Lei's beat field: not used).
  3. **The kicks** (`strikes.js`, built on Tian Lei's builders): the spin back kick, the spinning backfist,
     the tornado, the butterfly, the flash kick (a back flip, he lands 2.4 m back), the no-hand cartwheel kick,
     bicycle snaps hanging in the air, the drop heel (a red ring), the flying knee (dashes stop 1.35 m short).
     A flying foot is keyed in BODY space and turned into model space through the key's own rotation, so a
     turn or a flip carries the legs (the feet are model space in the animator).
  4. **The moves** (COMBAT.md table): Three Steps on Air, The Sky Turns Twice, Crane Crossing Water, Moon Over
     the Shoulder, Rain on One Roof (gear 1); A Hundred Hands, The Long Lesson, Storm Step (gear 2); The First
     Lesson's beckon 0.5 s and a spin back kick; Climbing the Stair four kicks; Idle Hand a spinning backfist
     and a drop heel (red: the dodges); The Sky Turns Twice ends on a drop heel (a sweep after the spins did not
     read at its contact); the counter a spin back kick; his streak flurry a burst, a tornado, a palm;
     Close Iron a spin kick before the point-blank shot; A Thousand Hands a burst in the middle; Iron in the
     Air (phase 2: a sideways leap, one bullet burst, the heavy shot).
  5. **Borrowed Wall reworked** and used often (weight 1.8, cooldown 5, band 3.5 - 12, the first far / away
     link and out of Brushing Dust): the upright he reaches by 0.4 of the windup whose flight crosses the
     hero's facing most (the dojo's posts, the screens, the pillars, the code columns), two steps up its face
     (1.8 m), THE SPRING (a bite on the upright, a thump; the target fixed), a flat arc, the blow in the air:
     a flying side kick (blue flare) or a drop heel (red, a ring on the spot); none in reach: the same off the
     floor beside the hero. His root is driven through the whole beat; never inside a collider or out of bound.
     The long hang (time 0.45 for 0.18 s at the arc's top, the hero in the kick's line, once in 12 s) is in.
  6. **ADR-162's kit for him** (a helper agent, `wokenOne` + `duelist/feetPlan.js`): soft arms and legs (`armSoft` / `legSoft`, the
     hero's numbers), the feet planner lifted out of ascendant.js into `duelist/feetPlan.js` (Tian Lei calls the
     same code: his `asc.mjs audit` / `auditfight` print byte-identical before and after), palms on a dash stop
     1.35 m short, `pressure.pursue` (Tian Lei's block). The audit (`woke.mjs audit`, opt-in; main measured first,
     84 runs): punches' elbows at contact 126 - 131 deg -> 143 - 164 (mean 152); planted feet sliding 198.5 m ->
     64.7 m (the worst frame 788 -> 272 mm), strings with the hero circling 1.8 - 11.3 m -> 0.74 - 1.89 m a string;
     runs with a jolt over 300 mm/f2 41 -> 25; swings thrown at air 2 - 7 a minute (flee / retreat bots) -> 0 for
     every bot and phase. On the new moves the audit then found the spin back kick's knee flipping at the strike
     (jolts up to 1228) and a sweep after a spin jolting in its tuck: the spin kick's knee pole keyed one way, the
     sweeps after spins replaced by drop heels, the cartwheel and tornado turned over their windup.
     `motionfix`: every string's worst jolt 310 - 473 (main 353 - 653).
- **Numbers (`woke.mjs pace`, three seeds x 60 s a stage, the real set):** cues a minute by STAGE: phase 1 gear 1 85.2,
  gear 2 87.3, phase 2 74.9, phase 3 76.7 (seed means) (main: phase 1 65.1 -
  71.1, mean 67.2); the longest gap 2.42 / 2.39 / 2.23 / 3.32 s (main's phase 1: 3.29); dodges 13 / 10 / 7 / 21 %
  of cues (main's phase 1: 7 %); 0 conflicting cues; phases 2 - 3 at 0.86 - 0.88 of gear 2. Pinned from the worst
  seed with a margin (`pressure.meter`: minRate 70 / 78 / 65 / 62, maxGap 3.3 / 3.0 / 3.5 / 3.9). Short of the
  plan's targets, said plainly: gear 2's 95 - 105 (a burst counts one cue), 15 - 25 % dodges in phase 1 (13 % / 10 %).
  STRATEGY (god mode, seeds 4242 and 7): mixed 72 s, parry 106, block-only 75, lean 112, dodge-only 111: dodging
  and leaning are not the fastest. The mortal block-only bot survives and wins (61 - 89 s):
  no health through a block. WIN: the fencing bot wins through both bars in 66 s (84
  before).
- **Why not** more cues in gear 2 by cutting the bursts: a burst of 7 - 8 blows counts as ONE cue by the
  owner's choice (one parry answers it); gear 2's count sits below the plan's 95 - 105 because of that, while
  its strings run at the 0.32 s floor. **Why not** let a burst re-stagger: a hero hit by the first blow must be
  free before the next cue (`woke.mjs flurry`: 0.79 s).
- **Found on the way:** a deathblow on a posture break with less of bar 1 left than the execution's damage
  killed him in phase 2 (the denser fight breaks him more): it is THE FALL now, as bar 1 empty always was.
- **Consequences:** tests `woke.mjs` `flurry` (one parry, one guard under the cap, one dodge, one stagger,
  free before the next blow), `wall` (an upright in reach used, 2.15 m up its face, the floor spring, both
  blows' tells, never inside a collider), `gear` (gear 2 at 0.80, between moves, the opening), `pace` per
  stage, `timing` (a burst's later blows share its cue). Lab: Gear 1 / 2, Wall kick / heel; Training: the
  burst, the wall kick, a bullet burst. Cut (the plan's cut order): phase 3's Falling Leaves, the pillar run
  inside Iron Rain, `doubleWall`.

## ADR-169 — Xin Yi reworked (2): the bullets' rule: a burst is one cue and one result, a hit is a short flinch, nothing locks the hero (2026-11-23)

- **Context:** Iron Rain fired 11 shots 0.14 s apart, each with knock-back 0.4: every shot re-entered the
  hero's 0.4 s stagger and cleared his input buffer (player.js), so the first slug that landed locked him
  through the stream and the heavy shot after it. The owner: "make his bullets not put you in a stunlock so
  player can parry or dodge out of it in a small window"; asked, bursts of three with a gap.
- **Decision:** THE RULE (`woke.mjs nolock`): after any bullet of his hits the hero, the hero can act for at
  least 0.25 s before the next thing of his that can hurt him arrives, and a bullet never re-staggers a hero
  flinching from a bullet.
  1. Iron Rain is three bursts of three (0.09 s inside, 0.5 s between), then the heavy shot (B, returnable).
     Each burst ONE cue (the beat's glint for the first; a glint at the muzzle for the others, `flashLead`
     before the first slug arrives: the slugs themselves are `quiet`) and ONE result (iron.js `slugHit`).
  2. The aim is fixed at the burst's glint (or as it leaves, if earlier), led by the hero's speed then; the
     slugs `keepAim` (a fairness hang does not re-aim them): a roll or a turn after the glint is clean.
  3. A hit: the first slug that lands is a 0.18 s FLINCH (player.js `hit.stun`: a shorter stagger that keeps
     the input buffer; `hit.mercy` 0.1 s more in which no `stun` hit staggers again); EVERY slug carries it,
     whatever the burst's result so far (a guard let go after a blocked first slug, a roll whose i-frames end
     inside the burst: the review of the PR found those gave a full 0.4 s stagger and 0.05 - 0.12 s free), so a
     burst staggers at most once and its other slugs hurt without staggering; each slug keeps its knock-back, so
     a raised guard pays guard, never health, and every slug that lands starts `shotMercy`. A parry turns the burst (its slugs spark off the blade for 0.3 s); a held guard pays 4 a slug
     (12 a burst, 36 a volley, 9 the heavy one), never health.
  4. Every other shot of his is harmless inside `shotMercy` 0.45 s of a bullet that hit him (iron.js `shotHit`).
  5. Iron in the Air uses the same burst (one, `bursts: 1`).
- **Numbers:** `woke.mjs nolock`: a hero who stands unguarded through Iron
  Rain takes 3 flinches (one a burst) and the heavy shot, never a second stagger from a bullet; the least free time
  between two of his hits after a bullet 0.32 s (>= 0.25); hit by burst 1, then guard / parry / roll: burst 2
  blocked / parried / dodged; the guard let go after a blocked slug 1, and a roll straight back whose i-frames
  end inside the burst: every slug's stagger the 0.18 s flinch, 0.42 / 0.37 s free before the next hurt (the
  old code: 0.49 - 0.50 s staggers, 0.12 / 0.05 s free). Each burst lands 7 - 10 ms from its glint + 0.26 s (`timing`). A held guard through a
  whole volley pays 45 guard, no health (`cover`). Before: one slug locked the hero through all eleven and the
  heavy shot.
- **Why not** a separate stagger state: the hero's own stagger with a shorter length and a kept buffer is the
  smallest change; every field is additive and inert for every other attacker (integ / duel / lord / asc /
  fox / sheath suites green).
- **Consequences:** `woke.mjs nolock` (every phase-2 move on a hero who stands unguarded; hit by burst 1, then
  guard / parry / roll: burst 2 blocked / parried / dodged), `cover` (a held guard through a volley: guard
  only), `timing` (each burst lands 7 - 10 ms from its glint + 0.26 s). Two additive fields in
  `ascendant/fx.js` (`quiet`, `keepAim`), set only by his slugs.

## ADR-170 — Xin Yi reworked (3): printed like the hero: his letters follow his size, the quiet print, simpler shapes, a coat that moves (2026-11-23)

- **Context:** he was in the hero's ink-line art but on the bosses' FIXED 4 px cell (about twice the hero's
  letters across him from 1080p up), with a LIFTED print (ink gains 1.6: his jade silhouette at full light at
  any distance, inner seams, a lifted skin fill, a glowing glint) and small modelled parts (the glasses' arms
  and bridge, two collar faces, lapel facings): a lit line drawing of a 3D model. The owner saw it as too
  detailed on the iPhone and the desktop. Built by a helper agent; the owner picked from the sheets.
- **The owner's pick (2026-11-23, from the before | a | b sheets at 1280x720, 2560x1440, 852x393 and 734x343):**
  "Print a": both switches ship at a (`lookSwitch.js` PICKED; their call-site default is '0', as he shipped,
  so `?looks=old` shows it); b and 0 stay behind the switches and in the Lab's LOOKS rows.
- **Decision:** two switches, built with a (Lab LOOKS rows):
  1. `?oneLetters=a|0`: `WOKEN_KIT.letters`, Tian Lei's getter (ADR-155): his cell follows his size (cells
     his / the hero's: 4/4 at 1280x720, 6/6 at 1920x1080, 8/8 at 2560x1440, 4/4 on 852x393 and 734x343).
  2. `?onePrint=a|b|0`: a = every ink / rim gain <= 1.5 (the edge fades with distance), the jade edge at 0.55 of
     the lifted one, no far line, the skin at `HERO_INK.skin`'s numbers with its fill x 0.62 (ADR-155's factor:
     the face printed ~1.5x the hero's), no glow on the glint and the muzzles, phase 3's edge x 1.35; simpler
     shapes (the glasses one dark band, one collar shape, a flat shirt V; rig meshes 59 -> 57); the coat stirs
     from phase 1 (tails 0.048, sides 0.03, the closed front 0.01) and every panel's swing is clamped (75 deg
     out, 20 in: the cartwheel's 122 / 44 deg before). b = a, and one cell bolder on a frame under 540 px tall
     (an additive `kit.letterBias`; 6 cells on the phones). 0 = as shipped exactly.
- **Close-ups:** every close shot (the Bend 30 m, the fall 28 m, the rising ~31 m, the deathblow 27.5 m) stays
  beyond the hero's `near` 20 m: the rule never falls back to the fine cell; nothing pulled back.
- **Why not** a renderer change for the phone: `letterBias` is one additive step on the rule's own cell.
- **Consequences:** `woke.mjs herolike` (the cells on five screens, the quiet print's numbers, 0 = main's table,
  the coat inside its swing). Left: 3 - 6 cm of hanging cloth still meets the legs in strides (a shin push on
  the coat's lower segment would need `anim.js`); the clamp could move into `anim.js` as per-panel limits.

## ADR-172 — Combat sounds, round two: the combat core picked by ear against the originals, sounds designed as well as found (2026-11-23)

- **Context:** after ADR-165 (attack sounds), ~85 sounds were still the original synth. The owner wanted to
  compare them with new options, hear when each plays, and be free to keep an original; they also allowed
  sounds made for the game instead of only found ones.
- **Decision:** a picker per round, one group at a time (this round: the combat core, 25 slots, plus last
  round's 11 against their originals). The originals are rendered through the real engine (OfflineAudioContext
  in headless Edge) so the comparison and every loudness match are true; each slot offers the original, two
  sounds designed from scratch and up to two CC0 recordings; scripted moments timed from the tuning show when
  each sound plays. Picks ship through the sample system of ADR-165 (`sampleList.js` slots, generated
  `sampleFiles.js`, `build-sfx.py` with recorded and designed manifests; designed files are credited "made for
  gcd"); the synth recipe stays the fallback and `?sfx=old` the way back. Each new sound is set to the
  in-game loudness of the sound it replaces, measured through the engine. The deflect chain stops climbing in
  pitch with a bell: it grows in weight (`parryChain.js`, three versions behind `?chain=`).
- **Consequences:** a slot changes by a line in `scripts/audio/sfx-picks.json` and a rerun of `build-sfx.py`.
  The next rounds (the wyrm, the boss specials, the world and menus) reuse the renderer, the designer and the
  picker. At the owner's sign-off: chain `a`; the other parry uses play one strike of the blue parry recording; the
  streak's climb note is half as loud on a parry; the hero's combo swing rises on every cut.

## ADR-177 — The blade goes clean through; every boss blow marks the floor; the set, the birds and the animals answer the fight (2026-11-23)

- **Context:** the owner: "when the player hits something like a rock or tree, the sword gets stopped and
  i dont like this feeling. lets allow the player to swing their attack animation through it while making
  the terrain get damaged and show chip damage. make it look natural and good. i also want the background
  to have more alive like the ground gets damaged per boss attack to show the damage done from the boss.
  have more cool atmospheric moments like animals running away as you get close to them in the fight or a
  flock of birds flying away from the dragon blowing fire at it." Asked, they picked: clean through;
  marks that stay until the fight resets; birds that flee, animals that run, a set that shakes, an
  aftermath; animals drawn tiny, a few letters.
- **Decision:**
  1. **The hero's blade never stops (this supersedes ADR-132's stop).** A swing through a piece it does
     not fell keeps the clock and the reach it has in open air: no rewind, no freeze, no stick, no
     bounce. The piece takes the same blow once per swing; what it loses flies ALONG the cut (the blow
     carries the blade's travel), stone and metal spark, wood splinters, one small jolt. The stop is
     kept behind `?cutStop=1`.
  2. **A blow that meets the ground says so.** `world.groundBlow(x, z, o)` keeps a mark of the blow's
     kind (slam, cut, thrust, dash, blast, beam, step) and tells the living world; it damages nothing.
     The human bosses get it from ONE hook in the shared engine at each beat's impact, read from the
     beat's own shape (a beat may carry `groundMark`, or `false`); the wyrm and the hero call it.
     Marks stay until `world.restore()`; past the cap the oldest fade.
  3. **Marks change nothing in the fight.** No damage, no fire, no timing, no `Math.random`: the seeded
     fights replay line for line. A mark chars the scorch map only where no grass grows (so no fire
     burns differently), which is why marks are weakest on grass.
  4. **The living world feels every blow and every fire.** `world.impact`, `world.groundBlow` and
     `world.ignite` reach every layer with an `impact` / `ignite` method. Two new layers under the
     piece `answer`: the tremor (what stands near shakes without being damaged: leaves off a tree,
     dust off a pillar, a swing in what hangs, pebbles, the bonfire's gutter) and the aftermath (smoke
     where fire burned out, embers, a haze over a crater).
  5. **Flocks and animals, in the approved letter.** Birds roost unseen and leave as a flock when fire,
     a heavy blow, a falling tree or a roar reaches them; a roost that left stays empty for the fight.
     Because the game camera never sees the tree wall in a fight, a flock is routed across the top band
     of the frame. Ground animals are two to five of the wyrm's letters, read by gait, outside the
     fighting ground, untouchable; some come back after the fight.
- **Why this way:** the stop was built to give cover weight, and the owner's hand says it feels like
  being caught; the weight now comes from what the cut throws. One engine hook marks seven bosses'
  moves without forty hand-written calls and covers a boss added later. Everything in the air uses the
  one look the owner approved (many tiny faint letters clumped; ADR-163's addendum).
- **Consequences / open:** at the game camera the KINDS of mark read only zoomed, and marks on grass
  are faint (a floor channel the grass reads as torn would fix it, at the price of touching fire fuel);
  the dust sift, the pebbles, the smoke and the crater haze are faint; Ashfall's crows do not read; the
  wyrm's fire fills the mark cap in about three minutes. The owner has not yet judged any of it in play.

## ADR-178 — Every sound effect back to its first synth version: the sound passes are off by default (2026-11-23)

- **Context:** ADR-165 (attack cues and blows as recordings) and ADR-172 (the combat core as recordings and
  designed sounds) replaced much of the synth. In a session that followed, the owner turned down a new light-cut
  swing (round one picked `e`, then "i dont like any of these"), plucked-string blue and red warnings, seven
  variations of them, and a spread of other families (bamboo, wood, bell, flute, steel, drum, bowstring, breath),
  and said: "lets just make all the sounds go back to their original. i want to start from baseline and undo all
  the sound changes". Asked the scope, they chose: all sound effects, keep the music.
- **Decision:** the existing switch is turned round: `samples.js` `DEFAULT_SFX = 'old'`, `?sfx=new` (the Lab's
  `sfx` row) opts in. Nothing is deleted: the recordings, the designed sounds, `sampleList.js`, `parryChain.js` and
  the synth recipes stay. The sample bank fetches nothing while the mode is `old` and loads on `setSfxMode('new')`
  (verified in a headless browser: default 0 of 35 files requested; `?sfx=new` and the live switch 35 of 35).
  The recorded music (ADR-117) is untouched. Sounds that belong to later features (the streak's climb note, ADR-167;
  the impact pass's sub and music dip, ADR-149; the living world's air, ADR-163) and the round-two sign-off's two
  small fixes (the combo swing's pitch rising on every cut; the streak note × 0.5 on a parry) are not part of the
  switch and stay.
- **Consequences:** a new sound round starts from the first synth sounds. The work of that session (a swing with
  its top on the blade's contact, `player:attack`'s windup / active, `?swing=`, `?blue=` / `?red=` with the
  families above, the pickers) is not in the repo: it is a git stash on the machine that made it ("swing + warning
  sound options") and the pickers' pages. The tests of the sound passes (integ and duel `sfx`) switch the mode on
  and put the default back.

## ADR-180 — Grass the sword mows, lamps that light with the fight, and the living world heard (2026-11-23)

- **Context:** asked "what else do you recommend to make the world and background more alive and
  interactable to make the fight seem cool", the owner got eight ideas and said "Build top three":
  grass the sword cuts (which also lets the boss marks of ADR-177 show on grass, where they were
  faint), the levels' unlit lanterns lighting with the fight, and sound for the new life.
- **Decision:**
  1. **Torn grass is the scorch map's A channel**, the one channel nothing in the fire reads: a tear
     is persistent until the fight's reset and never changes what burns, so the seeded fights replay
     byte for byte. The sword mows (`mowSwing` beside `_cutWorld`: where the steel passes low enough,
     a strip along its ground path; the blade's height decides skim or cut), a floor mark tears its own
     shape out. The grass shader draws two looks from one channel: mown (the blade's own letter clipped
     to a pale stub, some tops lying) and torn out (bare floor). Burnt grass stays black.
  2. **Lamps are a living-world layer** (`life.lamps`, piece `answer`): a breakable def carries
     `lamp: { y, r }`; a lamp kindles by a per-level rule (some at the start, more at each boss phase,
     fire landing near), gutters under a blow, goes out for good when its piece breaks. The flame is
     heat in the fire field; only a few lamps hold a real light: the light pool gained LOW lights
     that take only the slots the fight leaves free and fade in and out of them.
  3. **The living world's one-shot sounds** go through `life.sound` / `lifeSay` into `LIFE_SFX`:
     synthesized, short, one sound per event (a flock is one burst, a shake one or two shudders), per
     level (the Throne and the Hall hear nothing alive, the Grove only its canes and its lamps), no
     louder than a footstep at the same distance except a big flock and a creak, never `Math.random`.
- **Why this way:** one free channel and a shader branch that is skipped where nothing is torn cost
  nothing where nothing happened; the light pool's eight slots belong to the fight, so lamps borrow
  what is left; the sounds lean on the approved air bed's manner (the owner: "sound looks good").
- **Amended 2026-11-24 (the owner saw the cut):** "the grass cut doesn't look good ... we should be
  able to see the grass get cut the moment the sword touches the grass and have ascii grass get thrown
  into the air". Measured: the cut was a blotch of a map cell's share of blades round the steel, and
  most of the DRAWN arc passed over grass that stood. Now **the drawn arc is the cut's source**
  (`player/fx.js` `trail()` → `world/mowFx.js` `cutArc`, each edge stroke low enough, carried along the
  view ray): exact to the blade, one byte per blade instance in a texture the grass shader reads by
  `gl_InstanceID`, so the sword no longer writes A (A stays for the marks; `?mowLook=r1` keeps the first
  round). Each cut blade's top, its own letter, leaves on the frame its stub shows (`MowFx`). Three
  looks were filmed (thrown, sliced, shred); the owner liked sliced, then asked for the cut to follow
  the swing, then chose **thrown, made subtle**: half the tops tossed low with a gentle spin, the rest
  toppling, no brighter than the grass. Why a per-blade texture and not finer scorch cells: the cut
  must sit on the arc's line (~0.5 m wide) and the fire's 0.625 m map is shared with what burns.
- **Consequences / open:** (first round) the mowing is calm (a pale speckled clearing more than a crisp
  swath) and the hero's mostly vertical cuts leave lanes, not arcs (both answered by the amendment);
  the cut tops do not move with the wind once lying; a stub does not spring; after a fire-heavy fight burnt ground still
  dominates the meadow; a lantern's flame is a few letters at the game camera; Foxfire's ten lanterns
  share three lights; the Ring's braziers became low lights (they give way to the fight's) also with
  the living world off; nobody has heard the sounds yet.

## ADR-181 — The perfect parry throws a few orange sparks; nothing else of the moment changes (2026-11-24)

- **Context:** the owner asked to make the perfect parry and dodge "more epic cool with subtle effects". In one session
  they turned down, on film: a four-piece pass (the floor's letters reacting, poses, a darkened iris and camera lean,
  the world answering) with "i dont want the background to change color at all"; a shower of ~170 white-gold sparks
  as "too bright / fireworks, too many / too big, wrong motion, not the right idea" and "calmer"; four richer
  afterimages of the hero's real body with "the original is better". Asked for a reference they said to research it
  and decide.
- **Decision:** the shipped perfect parry (`?perfect=sharp`, ADR-167) stays exactly as it is, and a perfect parry of a
  blow adds a spit of 12 - 16 sparks modelled on real sword sparks and on Sekiro's deflect: few, fast, short-lived,
  orange; most along the blade that glanced off; each a stroke along its motion that becomes a dot as it slows; cooling
  to dark red; under the bloom threshold, so a crisp letter and never a glow; real time; one cell each
  (`combat/parrySparks.js`, `?parryFx=0|a`, default `a`). A normal parry, a perfectly parried bullet and the perfect
  dodge are unchanged.
- **Consequences:** the moment is still dominated by the gold mark; the spit is a detail, read best at the end of the
  freeze and in a string. Against the wyrm the sparks are mostly hidden by its own parry star. One more `LetterBatch`
  draw call while sparks live. The rejected passes stay on local branches; a later round on these moments should start
  from a concrete reference and one narrow prototype, and never change the background.

## ADR-179 — Grades, saved records and a boss rush, shaped for an online leaderboard (2026-11-23)

- **Context:** the owner asked for saved records, grades and a boss-rush mode, and plans online
  leaderboards later, so what is saved must be what a server will take. A planning session settled three
  things with the owner (2026-11-23), final: (1) a grade measures CLEAN PLAY: damage taken and deaths
  decide it, time only separates equal runs, a careful defensive win can be an S (their standing rule:
  defensive play is never punished); (2) in the rush, health and flasks refill before every fight; (3) in
  the rush a death retries the same boss, the clock keeps running, the death is counted.
- **Decision:**
  1. **One run record per finished run, written by one function** (`records.js` `buildRecord`, `v: 1`):
     kind, level(s), game version, time, the clean-play inputs, grade, marks, the RunStats snapshot, the
     device, the learned techniques, the move style (null until PR 105's system is on `main`), and for a
     rush its splits. No player name, no network code. The fields and the timing rules are written into
     ARCHITECTURE.md "Records" as the contract a leaderboard server holds runs to.
  2. **Timing is real time in the boss state.** A boss: the winning attempt (`stats.attemptTime`; a pause,
     the intro, the walk and the screens never count; checked headless: 10 + 10 s around a 20 s pause
     reads 20.0 s). A rush: every boss-state second of every fight, failed attempts included; loads,
     walks, intros and record screens never count, so a slow device or connection costs nothing.
     Client-side times can be forged: validation is the server's job later.
  3. **The grade** (`rank.js`, thresholds as data in `rankTuning.js`): S = no deaths and at most 15 % of
     max HP lost in the winning attempt; A = no deaths, or one death and at most 50 %; B = up to three
     deaths; C = any other win. Time never changes a grade; `compareRank` orders by grade, then time.
     "Damage taken" is HP lost to blows that LANDED (`player:hurt`): a blow met on the guard costs guard,
     not HP (player.js `_block`), so blocking, parrying and rolling all reach an S the same way; only a
     contact stream's chip through a held guard costs HP, and is not counted either. Marks: UNTOUCHED
     (no death, no damage), DEATHLESS, NO FLASK (no flask in any attempt). **A rush's overall grade is
     the same rule on its totals**: deaths summed, the eight winning attempts' damage summed over the
     eight max HPs summed (an S rush is deathless and averaged at most 15 %), flasks summed.
  4. **Eligibility** (`eligibility.js`): a run is recorded only if played as the game ships. VOID: the
     Lab opened on any frame (its controls need it open; `?lab` too), god mode, endless flasks, the
     attack-speed slider, the Lab's time scale, a boss's AI switched off, `window.__tick`,
     `flow.debug.toState`, the training room (`?stage=lab`), `?tech=`, and these URL switches away from
     their shipped value (read from the code with a sweep of every parameter the game reads):
     `training`; `cutStop` (1: the blade stops, a swing ends early); `apoc` (c: the meteor rain
     re-paced, the wyrm out of reach); `ring` (b / c: another Skybreak arena and its colliders); `bamboo`
     (other breakable stalks and colliders); `outskirts` (0: the Throne's props and their colliders
     go); `looks=old` (it sends `outskirts` back to 0); `wyrmLook` (another build carries the neck, so
     the head's hurt sphere, differently between attacks); `ablaze` (its fire lights the cover);
     `perfect` (today / cinema: another slow motion after a perfect defence); `streakfx` (without
     `storm` the flurry's pacing changes). NOT void (looks, sounds, input): `heroLook`, `sword`,
     `wyrmFace`, `breath`, `flare`, `zoomArt`, `nobatch`, `noseen`, `impact`, `calm`, `stamp`,
     `stampInk`, `cutfx`, `burst`, `streakCount`, `auraFire`, `sfx`, `chain`, `music`, `life`, `lifeK`,
     `marks`, `floor`, `grove`, `city`, `hall`, `script`, `chip`, every duelist look switch (ADR-122's
     table: `kindle`, `qi`, `ashLook`, `lordLook`, `asc*`, `sheath*`, `fox*`, `hal*`, `one*` ...),
     `gradeLook`, `recLook`, and the device switches `touch`, `pad`, `hold` (the device is recorded
     instead). A void run's record screen says why in one line (`NOT RECORDED: the Lab was used`); the
     grade is still shown; nothing is stored. Once void, void for the page; a rush, for all its pages.
  5. **The store** (`records.js` `Records`, the pattern of `unlocks.js`): localStorage
     `gcd.records.v1`, injectable storage, never throws (corrupt / another version reads as empty, a
     full store drops the queue to six and retries, blocked or missing storage keeps the page's runs).
     Per level and for the rush: clears, the best time and the best grade, two separate bests; plus the
     last 24 run records in full (a full rush and the runs before it), the queue a later uploader
     drains. `game:record` is emitted per stored record: the seam an uploader subscribes to.
  6. **The boss rush** (`rush.js`): every level in `LEVELS` order (a new level joins with no change), each
     its own page load (`?level=<id>&rush=1`); the run in sessionStorage (`gcd.rush.v1`, this tab).
     What I decided beyond the plan:
     - a rush page plays the rush's level whatever `?level` says, so a reload on the record screen after
       a win goes on to the next boss (the win was banked) instead of losing the rush;
     - the clock is banked about once a second and on `pagehide` / a hidden tab, with a `live` flag in
       the boss state: a reload or a reopened tab mid-fight is a death with the time kept; a crash loses
       at most a second of the clock; a reload outside the fight (walking, the death screen) is no death;
     - opening any page of the game without `?rush` ends the rush (no stale rush waiting in the tab);
       QUIT TO TITLE ends it with no record; a finished rush is cleared when its record screen is left;
     - a rush's fight is also that boss's clear: it updates the level's bests (its time is the winning
       attempt's) and carries the rush's id;
     - "Fight again" is not offered in a rush: the record screen's press goes on ("Next boss", and after
       the last, "Back to the title");
     - the HUD's rush line is under the minimap, the corner the minimap already holds on desktop and
       phone (`3 / 8  4:12.3`, tenths during the fight; hundredths on the record).
  7. **The looks are the owner's to pick** (CLAUDE.md "render options"): three options each for the
     record screen's grade (`?gradeLook=a|b|c`) and the title's record line (`?recLook=a|b|c`), captured at
     720p and at the phone in both orientations in `docs/looks/records/`, behind the switches like the
     other look options. **The owner picked (2026-11-24): the grade `a` (block letters over its lines),
     the title `b` (the grade in the button after the name, the time on a second line)**; the other
     options stay behind their switches. With `b` the phone's title in landscape grew to three rows of
     buttons and lost the top of the logo: on a touch screen in landscape the stage buttons are tighter
     (9.5 px letters, 4 x 8 px padding, 6 px gaps), which keeps them to two rows.
  8. **The record panel's border holds every row** (the owner's report, 2026-11-24: "Total time" and
     "Flasks used" outside the border). Measured in a browser: the right column stuck out by 5 - 31 px
     at 1280 x 720 (looks b / c), 1024 x 640 and 852 x 393, every look; 393 x 852 and 1600 x 900 were
     inside. The cause: the panel was placed at `left: 50%` and shifted back by half its width, and a
     box placed there may only grow to half the screen, so its two columns of rows overflowed it. Now
     the panel with a grade is centred by its margins at its rows' width (at most 94 % of the screen),
     its columns may shrink, and a label that cannot fit is cut short with an ellipsis instead of drawn
     past the border. After: 0 px out for every look at 1280 x 720, 1024 x 640, 1600 x 900, 852 x 393
     and 393 x 852, the rush's record too (`docs/looks/records/panel-overflow-before-after.jpg`). The
     `records` suite guards the rule (layout itself cannot be measured headless).
- **Consequences:** the store and the record are stable shapes; a later version migrates from
  `gcd.records.v1`. The grade thresholds are starting numbers: the suites' winning bots fight in god mode and
  land 0 - 8 blows on the hero a fight (most 0 - 3); a duelist's blow is 18 - 38 HP of 160, so an S allows
  one light blow and about half the bots' wins would be an S, the rest an A, and the owner has not played them. Nothing proves a client's time; the server validates.
  Not checked: a human on a real phone, a pad on the title with nine buttons, a full rush played by a
  person (a full rush was driven in a browser with Lab jumps, which voided it, as it should).

## ADR-182 — The sword burns with a tight green flame in the hero's own micro letters (2026-11-24)

- **Context:** the owner: "i also want his sword to look a bit more mystical in a subtle way. maybe make the sword
  animation change as you get streaks". On record: the blade is dark steel that lights only while it cuts (ADR-130);
  always-on bright glows read "flashy"; ambient effects are many TINY FAINT letters (ADR-163); ADR-167's streak aura
  already puts a faint red rim round him. Over a day of filmed rounds the owner picked: four first readings (a breath
  of violet letters, climbing digits, wisps off the steel, a lingering line) → the wisps "but with neon matrix color
  effect" (one classic green of three) → "not wisps but like a fiery subtle flame cool ascii effect on the sword"
  (three flames in the fire field's red) → "make the sword color matrix green" → "more cooler flame enveloping the
  sword ascii looking" → "the glow is way too big, make the ascii characters much more smaller" → of two, "A: tight".
- **Decision:**
  1. **A tight envelope of green flame round the steel** (`player/swordMystic.js`; on for everyone, `?mystic=0` and
     the Lab's `mystic` row off / flame give today's blade). Every cell touching the steel on the screen (never the
     steel's own cell: it is never covered; at most one below it) burns on its own beat, its mark re-rolling 8 times
     a second; tongues of 1 – 3 cells climb off the top and break away; strokes lick off the steel and climb cell by
     cell (spawned, snapped to his grid). With `streakTier` 0 – 5 (the hero's own streak, independent of
     `?streakfx=`) it burns denser (62 → 90 % of the cells lit) and hotter, the tongues climb higher, the licks come
     6 → 14 a second, and toward the point the marks pale to green-white (the lit head of Matrix rain). Nothing over
     his torso's column below his head; nothing on a dead, hidden or unarmed hero; it rests through the flurry.
  2. **Drawn in the HERO'S OWN micro letters**, not the world's: `render/glyphs.js` PIXEL_3X3 (3 × 3 marks in his
     4 × 4 px cells at 720p, half the world letter's height; `pixelArtOrder()` gives each mark's atlas column),
     through a `LetterBatch` that takes the pipeline's own hero atlas (`pipeline.heroArt`, `heroCell`; never disposed
     by it) and snaps to his grid. Heat picks the mark the way the fire field picks its letter: a stroke at a cool
     tip, a tiny letter shape in the body, a dense mark at the hot heart. In world letters (5 × 8) the flame was as
     wide as his head ("the glow is way too big").
  3. **Not the fire field** (the house rule for burning effects is field heat): the field prints only its three hues
     (red fire, the Lord's violet, steel) in world-sized letters, and its two dye zones serve the bosses' timing
     tells. A green flame at the hero's scale cannot be field heat without a fourth kind. The flame keeps the field's
     grammar (heat → stroke / body / heart, tongues, boiling) in his letters instead.
  4. **Matrix green:** linear body (0.06, 1.0, 0.06) (the grade and the tone map lean a green toward mint, so the
     blue is kept low), cool tips (0, 0.5, 0.04), the lit head (0.62, 1.0, 0.6); alpha 0.5 – 0.9 by heat. Brightest
     pixel before the tone map about 0.76 at tier 0 and 0.93 at tier 5, so its marks carry a small bloom halo (about
     half its pixels are over the 0.55 threshold). The owner approved it so; `GREEN` is the knob if it reads as glow.
- **Status:** shipped. Left out on purpose: the hero's move styles and the growing arc (`?arc=`) of the closed PR
  #105; they were options for the owner's pick and are not part of this.
- **Consequences:** the `swordmystic` scenario holds the flame to his marks, its budgets (6 licks, 110 marks a
  frame), green, colour × alpha at most 0.9, growth by tier, on by default, nothing after death, and the off state
  to today's blade frame by frame and to drawing and building nothing. Every other scenario now runs with it on (the
  harness's pipeline has no frame size, so it draws nothing there). The streak aura's rim stays red: a red rim round
  him and a green sword at tiers 1+ (the owner may want the aura green too). On-device frame rate is unverified (one
  more batch, up to ~160 instances, one draw call).

## ADR-194 — The human bosses are printed the hero's way, in their own colours (2026-11-24)

**Context.** The owner sent the hero at the game camera, enlarged ("i especially love the gray colored details
to make the bottom of the cape look flowing and to show different shades on the upper top"), and asked for
every boss to look "all built with ascii" like him; Wen Yao was the closest. Six of the seven human bosses
already printed in the hero's ink-line art, through the same letters and cells. What set them apart was the
SOURCE they handed the art pass: flat dark fills (the Lord and Xin Yi printed as faint `+` marks inside a thin
bright outline) or flat bright colours (Wen Yao's amber, Halcyon's red), a 1 px hairline outline where the
hero's strokes step with his font pixels, and no pale hem. Lu Wusheng printed in the wyrm's digits.

A first sheet only darkened the fills and added a faint hem; the owner: "im not really seeing the difference
besides a reshade". The second sheet (lit letter bodies, the hero's strokes and rims, the hem; grey or each
boss's own colours) was picked: "Yes, own colours".

**Decision.** `?bossPrint=0|a|b`, default `b` (lookSwitch PICKED; Lab LOOKS row `bossPrint`, live):
- **The fills** (materials.js, `uBossPrint`, a shared uniform; every ink-line material but the player's, which
  compiles `SG_HERO_SELF`): each cloth / hair / plate part (parts 3 - 16; the face, the eyes and what glows keep
  theirs) is lifted to the hero's lit letter body: its brightness mapped to 0.1 - 0.24 like his coat, then
  lifted (× 1.5); its hue kept at 75 % (`b`) or at 35 % with his greys (`a`). Done in the shader, so every
  writer of `uArtFill` (forms, phases, the fox's clones, the Lab) goes through it unchanged.
- **The hem:** below his knee (his feet, `uBossPrint.z`, followed every frame by main.js, + 0.62 m) along a
  ragged line, every part but the trousers, the hair, the plate and the crest prints as the hero's `hem` part
  (16: pale lavender, dotted edges), tinted toward the boss's own colour in `b`.
- **The lines** (pipeline.js `uBossLike`): his ink lines are found per font pixel (the hero's blocky strokes),
  and his plates (parts 12 - 16) read the player's part tables (HERO_SELF: the cloth's dim dotted rim, not a
  white outline). Not the blade: the player's blade entry is dimmed and lit by his own cuts every frame.
- **Lu Wusheng** prints in the ink-line art by default (`sheathArt` a, was 2): the owner picked the sheet that
  showed him so. ADR-152's note ("a read as a 3D model") was before this print.

**Not changed.** Shapes and outfits: the bosses wear slimmer clothes than the hero's broad cloak, so they show
fewer letters across. The Cinder Wyrm (the wyrm's art path), the props and the animals: next, in this direction.

**Cost.** A few ALU per boss fragment, two uniforms; no new draw call, texture or pass.

## ADR-184 — Combat text at fixed, smaller sizes (2026-11-24)

- **Context:** the owner noticed the combat text next to the hero (counter, deflect, damage numbers) looked much
  larger than they remembered and asked for it small like the original. The CSS had not changed since v0.2.0, but
  the call-outs and the crit / cut-counter numbers were sized with `clamp(.., vw, ..)`, so they grew with the window:
  at 1920 wide DEFLECT was 22 px and the cut counter 34 px, against a hero only a few dozen pixels tall.
- **Decision:** fixed pixel sizes, option B of three rendered at 1920x1080 (A today; B about two thirds; C the HUD's
  own size with a lighter weight): call-outs 11 px (12 px for deflect / return / ghostep / danger, 9 px for BLOCK),
  damage numbers 10 / 11 / 12 px, the flurry's cut counter 15 px, letter spacing 0.2em. Weight, colours, glow and the
  pop / rise motion are unchanged (`src/ui/hudStyle.js`).
- **Consequences:** the same size at every window width and on the phone; the text reads as a note beside the
  fight rather than a headline. No switch keeps the old sizes (a pure size change; the old values are in git).

## ADR-185 — CI: the long checks split into processes of their own; every PR auto-merges when green (2026-11-24)

- **Context:** the owner: "it takes a while for new changes to get pushed through". A PR's `test-and-build`
  took 8 - 10 minutes, and one task set it: `lord fxlooks` ran 539 s in its share (est 230) while the other
  shares were done in 3.7 - 7 minutes; after it, `life` (430 s). Nearly all of fxlooks was its last check,
  SPELLS + TERRAIN printed under '0', 'a', 'b' and the shipped looks: TERRAIN alone about 90 % of it. And a
  green PR then waited, often for hours, for someone to press merge.
- **Decision:** lord.mjs takes `GCD_FX` (parts of fxlooks: a switch's name, spy, fight, same,
  same-spells, same-terrain, same-terrain@a / @b / @ship; `!part` leaves one out) and run.mjs runs each
  TERRAIN look as a process of its own (TERRAIN under '0', then that look), the rest of fxlooks as one more.
  life.mjs takes `GCD_SKIP`; run.mjs runs its files in three processes. Every est re-measured from PR
  #113's run. A new workflow, `automerge.yml`, sets auto-merge (squash) on every PR from this repo when it is
  opened, reopened or made ready (not a draft, not one labelled `hold`): the owner's call ("have every pr set
  to auto merge automatically").
- **Why this way:** no check is dropped or weakened: each part asserts exactly what it did inside fxlooks;
  TERRAIN under '0' runs three times instead of once (about 2 more minutes of runner time, none of the
  wall). The main fxlooks task and `life` run "everything but" the split parts, so a part or a life file
  added later runs by itself. Auto-merge changes when a PR merges, not what must pass: the required check
  and the up-to-date rule still decide (a merge queue would update branches by itself, but needs an
  organisation-owned repo). A push by the Actions token starts no workflow, so a PR behind `main` is brought
  up to date by a session or the owner (`gh pr update-branch`), not by a bot.
- **Consequences:** the longest task is `integ` (~295 s); each share deals ~1000 s of tasks four at a time,
  so a run should take about 5 - 6 minutes (was 8 - 10). A PR merges the moment its check is green: the
  Vercel preview is no longer a gate before production, so a PR the owner wants to see first is opened as a
  draft or with `--label hold`. Re-measure `est` when a suite grows a lot.

## ADR-183 — The world grid tests a creature or prop edge before the creature grid's bound (2026-11-25)

- **Context:** a bright halo bloomed round the hero's RESTING blade at some poses and facings, and the point left a
  pale block where it rested in the grass. In the ASCII pass's world grid the creature-grid branch (alpha < 0.46) came
  before `isArt(a) || isProp(a)`. The player's own pixel window (0.42 – 0.45, ADR-130) lies under 0.46, so a world
  cell whose centre fell on his blade printed a creature-grid letter in the steel's raw HDR colour (4 – 6) beside it,
  and it bloomed. The bosses' window (0.46 – 0.49) was always caught by the art test first. Found while filming the
  sword options of ADR-182 (closed PR #105); left out of PR #114, which shipped the flame.
- **Decision:** in the world grid `isArt / isProp` (the raw pixel) is tested before the creature grid
  (`render/pipeline.js`). Always on: a defect, not a look.
- **Consequences:** measured at the game camera (720p, before bloom), 17 – 49 px over the 0.55 threshold round the
  resting blade in a range of poses and facings before, none after (the gem's own violet point aside). A cut, the
  charge, the flurry and a crit light the blade as before. An addendum to ADR-130's pixel windows: a window under 0.46
  must not be read by the creature grid.

## ADR-189 — The wyrm's wake keeps one neck shape until the curl is out; the drake head is drawn for the view from above (2026-11-24)

- **Context:** the owner: "when the fight starts the dragon does an unnatural neck twist as it wakes up" and "i
  really like how the dragons face looks like from the side ... but from the top center view, the dragon head looks
  goofy". Measured on the intro (`SEQ.intro`): in the `rise` phase the head's heading turned ~330 degrees in about
  0.5 s and its up vector went to -0.35 (upside down). The cause: `s.rest` (the combat stance's resting S, blended
  point by point into the measured neck) rose with the pose's `sleep` target (0 in `rise`) while the smoothed
  `s.sleep` still curled the measured neck back along the right flank; lerping two chains whose tips lie on opposite
  sides of the body swept the last segment, and the head riding it, round the long way. From above, photographs
  showed the drake's pale bone (brow, the two long horns, the cheek fins) joined into one wide pale V that hid the
  dark face, and the eye glints (`fx.eyeGlints`: a round dot pulled 0.45 S toward the camera) as two round pupils.
- **Decision:** the resting weight also waits for the curl: `restT *= clamp(1 - s.sleep / WAKE_REST_SLEEP, 0, 1)`
  (`WAKE_REST_SLEEP` 0.12, `rig/anim.js`). Only a waking wyrm has a smoothed sleep between 0 and 1, so no attack,
  stagger or death changes. After: the heading stays within -30 .. +28 degrees through the rise, up vector >= 0.89.
  For the head, three tops were rendered from above, from the side and at the game camera
  (`docs/looks/wyrm/top-options.jpg`) and **the owner picked `c`**: no glints; the horns, fins and brow in their own
  darker material (`mats.horn`: the bone's options, FACE_ART.drake `horn` art: ink 0.13, key 0.2, fresnel 2.2:
  edges and tips lit); the horns' and fins' sideways sweep halved, the horns at 0.7 of their girth; a crest of five
  dark spines down the skull. `?wyrmTop=` (faces.js `WYRM_TOPS`, the Lab's `top` row) keeps `0` (the drake before),
  `a` (no glints) and `b` (a + dark horns). Only the drake wears a top: another face keeps its glints.
- **Consequences:** the main horn's tip moved (ablaze reads it off the built horn, so the phase-3 fire follows).
  One more draw for the drake (the `horn` material). The seeded fights ran differently and showed an old edge: the
  pounce's hop landed its root up to 2.4 m past its ground beside a torn gap; the landing now settles it there
  (`d._collide()`).
  The eyes are the slits only; at the game camera they are smaller than the glint was. Not checked: the owner has
  seen stills and a clip, not played it; the phone view; the other faces with `?wyrmTop=`.

## ADR-190 — The flurry's tempo: a heavy first cut, each later cut a share of the one before, the storm by pace (2026-11-25)

- **Context:** the owner, a day after the streak pass (ADR-167): "looks too fast in the early streaks. something about it just looks not epic/stunning"; asked which part: "All of it, you judge". Measured: a flash cut was 0.35 s on a man with its wind-up on screen for two frames (0.25 s round the wyrm's head, no wind-up seen), the first cut landed 0.12 s after the dodge, and the storm began at a fixed cut whatever the streak, so a streak of 4 or 5 was two full cuts, one or two blips and the art.
- **Decision:** one tempo rule for the flurry, the riposte and the counter (`DEFENSE.flurry.tempo`, `STREAK_FX.tempo`, on with the storm piece): (1) the first cut is a heavy beat, slow / fast / slow (seen wound up 0.11 s, 0.08 round the head; the dash at its old speed; the contact frozen 0.11 s; the finish held 0.15 s, 0.11); (2) each later cut takes `r` of the one before, `r` set by the number of flash cuts (0.78 for two to 0.52 for six, never below `storm.floor`); (3) a storm cut is one whose pace is under `stormAt` (0.4), and weight falls with the pace instead of jumping; (4) a riposte's / counter's last cut is the heavy beat again; (5) timing and weight only; (6) `?tempo=0` gives ADR-167's frames exactly (pinned).
- **Turned down:** slowing the whole flurry (a seven was already called too long at 2.9 s); starting the storm later by place (the cliff stays); a new glint on the heavy beat (timing first).
- **Consequences:** a streak of 2 to 5 takes 0.18 - 0.35 s longer in real time (about 0.02 s of fight under the world's 0.07 hold); a seven keeps its length. integ `breach` replays at the old pace (its other seed path showed the wyrm's pounce past a gap's share, open). Open in play: the step into the storm round the head (24 -> 11 frames at seven), the riposte's last freeze (0.198 s).

## ADR-191 — The flurry flows: chained passes, every slash on his path, a figure each time, cuts that tear the picture (2026-11-25)

- **Context:** after ADR-190 on film the owner asked for slashes "accurate to how the character moved", for the "random 2 curved slashes at the end" to go, for no return to where he started ("A - B - C ... right now it goes back to the original A location"), for a smaller detailed burst instead of the "A" explosion, for slashes "ripping time in a cool flash instant" in variations; then for the passes not to "always form some kind of star". Causes: every cut teleported to a fresh point on a ring and the art began at the foe's front, which faces the dodge spot; on the ground the hanging line ran through the foe while he ran 0.55 m beside it; the iai art spawned two 5 m crescents beside the target; the last blow reused the slam's `A ^ V` kite shards; the planner scored the widest star first.
- **Decision:**
  1. **Chained passes** (`DEFENSE.flurry.chain`, `STREAK_FX.chain`, `?chain=0`): each pass starts where the last ended, the art where the last pass ended; the blink before a cut is a beat of turning where he stands. A riposte still ends where he parried.
  2. **Every slash is his path:** a hanging line is the segment his chest ran (1.2 m over his root); the cut's stroke, star and sparks sit on it; a crescent is kept only where his blade swept (the split / vault, sampled at the blade tip); the iai's two crescents and the cuts' crescents are removed.
  3. **Letter dust for the last blow:** about a hundred tiny white-steel letters, none over 0.09 m, under the bloom, settling as dust; the slam elsewhere keeps its shards.
  4. **Figures** (`player/flurryFigures.js`, `DEFENSE.flurry.chain.figures`, `STREAK_FX.figure`, `?figure=`): star, zigzag, cage, spiral, cross, each a rule for every pass's offset and exit, picked per flurry from the flurry's seeded stream, never the same twice running, only where it reads (cage and spiral not round the head: a side crosses the neck) and fits (walls, the dodge spot 1.6 m clear), else the star. On a man no pass nearer than 0.55 m to his middle (ADR-101).
  5. **The time rip** (`player/timeRip.js`, `game.fx.rip`, `?rip=`): a cut changes the picture along its own line, never beyond a thin band, never its colour. Four looks were built and filmed side by side; **the owner picked `strip`** (three frames: the letters 3 cells either side print shifted 4 / 3 / 1 cells along the cut, each side the other way, a steel seam on the line) and it is the default; `tear`, `ghosts`, `negative` stay behind the switch. It hooks in through `player:flurry` / `player:flurryHit` / `player:flurryEnd` and `flurry.lines`, a band in the ASCII pass (`uCutN`, early-out when idle), steel in the fire field.
- **Turned down:** a fan figure (it cannot stay chained without long runs back round); ghosts through the dodge afterimage's single standing copy (one figure at a time); the four rips' first round on film (negative as flat white blocks, ghosts as a wall of digits, strip too small to see at speed), fixed before the pick.
- **Consequences:** no new event (`player:flurry` gains `figure`); no new draw call; the rip's idle cost is one branch a pixel in the ASCII pass. Seeded fights that hold a flurry replay differently with each switch: city `win` replays with the chain off, integ `pressure` and `storm` with the star, all commented. On film the figures are 100 - 200 px across at the duel camera and the strip lasts three frames: both to be judged in play and on the phone.

## ADR-186 — The hero's idles: rests he moves between, habits with both arms, a trick every few; the guard hand off the belt (2026-11-24)

- **Context:** the owner: "make the main character and several idle positions instead of having the same holding his
  left hand on his hip all the time. i want him to move both his arms around naturally and doing cool sword tricks
  during idle". Asked, they chose a MIX (mostly natural habits moving both arms, a flashy trick every few cycles) and
  BOTH stances (the fight tighter: the hand off the belt, small guard shifts, no tricks that leave him open). ADR-114
  gave him two stances, both with the free hand on the belt; ADR-047's idle life played six actions at ease only.
  On record: the owner judges anatomy and naturalness, measured (elbows, the wrist, gaps, pops), from the game camera;
  the hero's look is not changing, only his motion. Built beside two other sessions (run arm ADR-187, lights ADR-188)
  in their own regions of `anim.js`.
- **Decision:**
  1. **Rests** (`player/idles.js`): the arms' pose over each stance, changed now and then (a slow smootherstep, the
     blade by `dirLerp` with its own memory). At ease `loose` (the free arm hanging, the hand open), `hilt` (both
     hands low on the hilt, the free palm on the sword wrist, the point to the grass), `trail` (the blade low behind
     his right side), `belt` (the old hand on the belt, now one rest of four). In the guard the sword arm and the
     blade stay `fencerGuard`'s and the free hand leaves the belt: `point` (sword fingers at the foe), `eye` (beside
     his face), `hand` (an open guard hand), `low` (floating by the hip).
  2. **Habits** on ADR-047's machinery (`FIDGETS`, `_idleLife`; no second system): at ease four new ones with both
     arms (re-grip, the shoulders, flex the free hand, brush the coat) and the old look and inspect; in the guard
     five small ones (grip, guard shift, loosen, beckon, a flick of the point), which play also locked on (the old
     rule played nothing in a fight).
  3. **Tricks** every 3 - 4 actions at ease, never in the guard: the wrist spin, the figure-eight (out to his right,
     the point drawing an 8 ahead, never pointing back at him), the salute (the blade upright before his right
     cheek, the palm over the fist, a bow, a flourish), the chiburi flick, the reverse-grip flip.
  4. **No whips out of any of it** (the bar: the stance before, bare and with its old actions): an action that
     swings the blade starts only from a low rest; a cut lets such an action go over 0.26 s; at ease a block /
     parry / drink / charge out of one, or out of the trail, enters over at least 0.24 s (their own 0.08 - 0.12 s
     took a far blade the way behind his head through the wrist's limit). Visual only; in a fight (no tricks, no
     trail) nothing about those entries changes.
  5. **Left out, measured:** the blade carried on the shoulder as a rest (the elbow at the fold limit, the blade in
     the torso, 0.7 - 1.4 m a frame out of it); the guard hand over his head (0.4 m a frame into a block); the pass
     behind his back to the other hand (the sword is the right hand's alone in `apply()`; out of it a block's entry
     jumped 1.5 m); the old lean on the pommel (1.4 m a frame into a light, as before).
  6. `?idles=old` (live: `setIdles`, the Lab's `idles` row) is the belt and the six old actions, unchanged; the Lab's
     `idle ▸` row plays any rest or action now (`anim.playIdle`, `anim.setRest`).
- **Status:** built; filmed for the owner (before | after: exploring, the fight, the cuts); their picks pending.
- **Consequences:** the `heroidles` scenario holds every rest and action to a body's range (elbows, the sword wrist
  under `WRIST_BACK` and the point's floor), the drawn blade ≥ 8 cm off his body (≥ 10 in a rest) and out of the
  coat, the point off the grass, the free hand out of him, no pops, every move from every rest and from inside every
  action within the stance before, the schedule (tricks every few at ease, none in the guard, the rests changing),
  and `?idles=old`. `herostance` runs with `?idles=old` (the belt as it was); `herolife` / `heroarms` check the new
  rule. The block's, the roll's and the charge's own entries out of a far blade are left as they were (not this
  session's region): a follow-up could let a clip's entry turn the blade before the hand, as `swordFromEntry` does
  for a roll. A true hand-off (the sword in the left hand) needs the rig to pose the sword from either arm.

- **Amended (2026-11-24, round 2):** the owner: "some of the new idle animations have worse unnatural poses or angles
  ... the old one was holding the sword correctly in both angles", and asked for "cool subtle" sword spells. Every
  rest now keeps the at-ease sword arm (ADR-114) and changes only the free arm, the weight and the head: `hilt` (blade
  hidden from the game camera, the wrist turned) and `trail` (the wrist bent 50-60°) gave way to `fingers` and
  `cloak`; the reverse-grip `flip` (the wrist at 143°) is gone; the re-grip happens where the blade hangs. Three
  SPELLS join the trick pool, motion in idles.js and marks in the sword's green flame (`swordMystic.js` reads
  `anim.spell`): the rite, the sigil, the breath. They stay in the flame's own tiny letters and green; a line of
  them needs a mark every ~3.5 cm to read at the game camera, and anything written near the ground hides in the grass.

- **Amended (2026-11-25, the sword hand):** the owner: "something about the idle animations on the right hand looks
  weird in terms of angle and unnatural feel". The sword fist is on the sword's frame, the back of the hand on the
  forearm's: the spin, the figure-eight, the salute, the rite and the breath turned the blade 66-129° off the forearm
  and the fist off the wrist. They now lead with the forearm (`armAlong`: the elbow placed, the forearm aimed where the
  blade goes, the blade a little off it): 31-52° at worst, and `heroidles` holds every idle action to 60°.
  Then, at the game camera, "the right hand ... looks very jagged": the forearm stood upright beside his head showed
  as a ragged column of vambrace letters. The raised moves (salute, rite, breath) bring the fist before his chest
  instead (`RAISE`), the forearm at ~32° and the wrist cocked 40-54°, his head and shoulder covering the forearm.

## ADR-187 — The run's free arm: three carries for the owner to compare, by speed the default (2026-11-24)

- **Context:** the owner, in a three-part hero motion pass (idle, the run's free arm, the light chain, each its own
  session and PR): "when he runs i want him to have his left hand in a natural running pose". Asked which, "show me
  all 3 variations": (A) a loose natural runner's swing that pumps harder at a sprint, (B) the swordsman's dash, the
  free arm pulled back and low behind him with the sword trailing on the other side, (C) both by speed. Today's arm
  (`loco()`, Session 30) was a fist-forward swing written as hand positions: an 85 – 141° elbow, the hand at the guard's
  shape, the target lerped between two points.
- **Decision:**
  1. **`player/runArms.js`** holds the free arm on the run for the hero's animator (`A.freeHand`); `loco()` calls
     `runArm()` in the hero's branch and keeps today's swing as `?runArm=old`. A duelist's footwork is untouched.
     `?runArm=a|b|c|old` and the Lab's PLAYER row `run arm` (live) pick it; **the default is `c`**.
  2. **Written as joint angles, posed by forward kinematics** on the arm's own bones: the upper arm's swing from
     hanging and how far it stands off his side, the elbow's inside angle, the forearm's cross in toward the chest.
     They give the hand target (`lH`) and the elbow's pole (`lP`: the elbow itself, off the shoulder → hand line).
     A blend between two carries blends the angles, so the hand travels round the shoulder on an arc; lerped hand
     targets from "in front of the chest" to "behind the hip" pass through the ribs, where the solver's rib guard
     pushes them out in a jump.
  3. **A, natural:** the run swings the shoulder −44 … +26° and the elbow 118° behind → 78° in front (measured 75 –
     119°, working 44° a stride; before 85 – 141°), the forearm crossing in 20° in front; the sprint pumps −61 … +43°
     with the elbow 110 → 64° (measured 63 – 111°, the hand 42 cm up and down: chin to hip). The swing lags the legs
     by 0.035 of a cycle. The hand is open (`hs` 0), the palm to the thigh, the fingers along the forearm curled a
     little and drooping; at a sprint straight, a blade hand. The walk's swing is small and nearly straight.
  4. **B, the dash:** the shoulder 58° back (70° at a sprint), 30° (34°) off his side, the elbow soft (152°), the
     open hand trailing palm in and up; it rides the stride ±10° at the shoulder and ±8° at the elbow, so it never
     hangs still (the hand moves ~10 cm). Why so far out and back: rendered straight back, the cape hid the whole arm
     and from behind he seemed to have a hand on his hip; less far back, the side view read a hand hanging by the hip.
     The chest leans 0.05 rad further into it. **Forward only**: the dash's weight is `smoothstep(0.35, 0.8, mz)`, so
     strafing and backing away (lock-on play) swing the arm as in A; the weight eases on its own clock (`dashRate` 5
     /s on `A.time`, `A.runArmS`) because the aim swung behind him flipped `mz` in ~0.1 s and threw the arm 28 cm a
     frame².
  5. **C, by speed:** A, sweeping into B as the sprint builds (`smoothstep(0.15, 0.85, sprintW)`, forward only). The
     sweep is ~0.5 s; the hand never passes 4.6 m/s in it (A's own sprint pump reaches 6.3).
  6. **The sword arm is unchanged:** it already trails the blade low beside the right leg on the run and nearly level
     behind at a sprint, which is B's "sword trailing on the other side". The only shared change is the dash's chest
     lean. `stand()`'s run-start blend (the idle session's) is read, not edited: `loco()` writes the arm with weight
     `moveW` over it, so a start eases from the stance.
- **Why C:** the run keeps a runner's arm that works (the owner called the fixed crook "stiff"), lock-on strafes keep
  it swinging, and the sprint, where the hero is going somewhere, gets the wuxia dash. B at a plain run holds the arm
  still behind him the whole time; A at a sprint is the most natural but the least "swordsman".
- **Status:** the owner compares the four on films and the preview; the default may change with their pick.
- **Consequences:** the `herorun` scenario runs every carry through one course (a start, the run, a stop, a sprint's
  start and end, a strafe and a backpedal in the fight, a turn, out of the run into a light, a roll, a block and the
  flask, out of the sprint into a roll and a block, the sprint's slash) and checks the elbows, the flare, the hand's
  path and a pop audit against `old`. HEROARMS's "elbows in beside the ribs" check no longer covers the free arm
  sprinting under a dashing carry (b, c): the sweep out and back is the pose; HERORUN bounds it (out at most 0.8).
  **Known cost:** out of the dash into a roll or a block, the arm comes from behind him to the front inside that
  clip's short cross-fade, about twice the old jolt (the free elbow 24 cm a frame² vs 13). Those cross-fades are
  outside this pass (the roll's and the block's entries); a guard keeps it under 27.
- **Amended (2026-11-25), the free hand's size:** the owner, trying A on the preview: "the animation looks fine but
  the left hand size and color is standing out too much". The hand was drawn in the face's skin ink (gain 2.2) at
  the gauntlet's size (`BODY.hand` 1.12) beside a near-black sleeve, and the new swing carries it across his coat.
  Of five looks built for the preview (`gear/handLook.js`, `?handLook=0|a|b|c|d`: the hand before, × 0.8, × 0.8 with
  the skin fill at about half or a third, a × 0.85 leather glove) the owner picked **a: × 0.8 in the same skin
  ink**, now every outfit's free hand (the open hand, the sword fingers, the fist on the grip). The sword hand is
  unchanged. The two darker inks (`HERO_INK.handShade` / `handDark`, part 1 with the skin's lines) are built only
  when their look is drawn: a material more on the rig draws a uuid from the seeded `Math.random`.
- **Amended (2026-11-25), the default carry is A:** #117 shipped `c` (by speed) as the default, though the owner had
  tried `?runArm=a` on the preview and approved it ("the animation looks fine"). In production: "the new one looks
  really bad. it doesnt seem to be the one i chose". #122 reverted #117; this re-ships it with **`a`, natural, the
  default** (a runner's swing on the run, the pump at a sprint) and the smaller hand. `b` and `c` stay behind the
  switch. Lesson: the default is what the owner approved in game, not the session's recommendation.

## ADR-192 — The sword's cut throws green code, not grass (2026-11-25)

- **Context:** the cut of ADR-180 works, but the owner, playing the live game, was "not seeing the grass
  cut": at the game camera its stubs and quiet tops vanish into the meadow. They asked for "ascii like
  grass particles when its swung at", picked a light spray, asked for the grass's colour and more detail,
  then for "the matrix ascii art instead of actual grass", then for it "a bit tinier and a bit more
  subtle/natural ... but still enough for players to be like wow thats the grass!".
- **Decision:** on the frame the drawn arc cuts a blade (`cutArc`), it throws chips into the cut tops'
  batch: about one for every other cut blade (more per blade on a lower quality), each a code glyph of
  the Hall of Falling Script's set (world-atlas digits and code letters), about half a blade tall, a calm
  code green that cools fast and settles to the grass's darkness when it lands, re-rolling to another
  glyph as it flies. The throw, fall, lie and thin are the cut tops'. Every look met on the way stays
  behind `?grassSpray=` (`0` none).
- **Why this way:** the game already has one "code" look (the falling script); reusing its glyphs and
  greens keeps one style. The chips share the tops' batch, pool and stream, so the spray costs one more
  attribute, not another draw call, and draws no `Math.random`: the seeded fights replay byte for byte.
- **Consequences / open:** the code green is a new colour in the meadow; the phone gets a brighter,
  larger version (at the desktop strength it vanished); the boss marks throw none; nobody has judged it
  on the phone's own screen.

## ADR-193 — The grass bends round the hero's wake and springs back (2026-11-25)

- **Context:** the owner: "when the player runs through the grass, the ground/grass around it becomes
  too dark too quickly and doesn't look natural and bad transition. make the grass bend and come back to
  normal after the player moves through it". Every grass footfall wrote a full trample into the scorch
  map's blue channel (0.625 m cells): blades every way, up to 0.7 darker at once, standing up over 10 s;
  the live pusher had no memory, so blades snapped upright the frame he left them.
- **Decision:** a polyline of the hero's last 32 points (with their time and radius) goes to the grass
  shader as a uniform array, like the wind's fronts; each blade bends along his way and out from the
  path by its nearest stretch, holds, and springs back by a damped spring of its own, at most 10 %
  darker while bent. The steps stop writing the blue channel while it is on. Three tastes filmed; the
  owner shipped b (a soft lay-down rising over 2 - 3 s). `?bend=0` is the trail before.
- **Why this way:** a path needs no map, so there are no cells to see, and it knows which way he went;
  each blade's own spring makes the recovery natural; the blue channel stays free; fire and the seeded
  fights read nothing new (the trace replays byte for byte). 32 points in four chunks keep the shader's
  loop short (the grass draw went from 0.27 to at most 0.53 ms on desktop).
- **Consequences / open:** the boss's pushers still snap back with no wake; the shader's `trailBend` and
  the CPU's `bendAt` are kept in step by hand; close up a lying blade is a long sheared stroke (as the
  pusher's always was); the phone's frame cost is the owner's to confirm.

## ADR-195 — The game is called gcd (2026-11-25)

- **Context:** the owner renamed the game and named its hero. The repo moves to `eshin087/gcd` and the site
  to https://thegcd.vercel.app; the old address is dropped with no redirect (the owner does the GitHub and
  Vercel renames after the merge).
- **Decision:** the game is **gcd**, written lowercase everywhere a player sees it (the title logo, the
  browser tab, the start-failure text, WHAT'S NEW's header, the credits) and in prose docs. No capitals
  were needed anywhere: every place the name shows stands on its own. The lore, in three sentences: gcd is a
  mysterious being who wields the most powerful sword in all universes. The sword is what lets him defeat
  these legendary bosses. It is also what carries him between campfires in different worlds and universes.
  The title logo is a small lowercase "gcd" in the banners' block face (six rows, one width; the banner
  letterforms are unchanged). Identifiers follow: env vars `GCD_*`, classes `gcd-touch` / `gcd-pad`,
  style ids `gcd-lab-style` / `gcd-training-style`, `.claude/launch.json` `gcd-dev`, the package name
  `gcd`. Storage keys become `gcd.*` (`gcd.bindings.v2`, `gcd.lab.v1`, `gcd.records.v1`, `gcd.rush.v1`,
  `gcd.telemetry.v1`, `gcd.unlocks.v1`, `gcd.whatsnew.seen`, `gcd.touchPad`) with **no migration**.
- **Why:** localStorage and sessionStorage belong to an origin; on the new address nothing saved under the
  old one can be read, whatever the keys are called, so migration code would never run where it matters.
  Renaming every key now keeps one name through the code.
- **The title's random draws are pinned:** the logo's shimmer drew `Math.random` once per solid block a
  tick, from the stream the seeded sims share, so the shorter logo moved every seeded fight (five suites
  failed on their margins). The sparkle now has its own xorshift, and `TitleScreen.update` still draws the
  first logo's count from `Math.random` (`STREAM_COLS`, its blocks per column, skipping the sweep), so the
  sims replay as before and no later logo or title layout can move a fight.
- **Exceptions (left as they are):** third-party work titles and their file names: the music track
  "Ambience of a Fallen Age (The Abyss)" by Umplix (`assets/audio/CREDITS.md`, the `trackList.js` comment,
  `build-music.py`'s `the_abyss.wav`, ADR-117's track list), since a credit must stay accurate; the local
  folder name in absolute paths (the owner renames it later). History documents keep what they said, with
  the product name and URLs replaced in place.
- **Consequences / open:** until the address moves, the live site's players lose saved bindings, records,
  learned techniques and read marks once this deploys. The title screen's layout is being redesigned on
  another branch; it meets this LOGO there.

## ADR-196 — The title is the sword's path; a loading screen from the first paint (2026-11-25)

- **Context:** with the rename (ADR-195) the owner asked for a better front: an ASCII loading progress with
  the gcd branding on a first load, and a title where the stages are easy to pick instead of one long line of
  buttons. Three title layouts (a world list, a campfire grid, the sword's path), two loaders (centred, a
  console) and two places for the hero's name in the HUD were built behind switches and shown as screenshots.
- **Decision:** the owner picked **menu c, the sword's path** (the worlds as fires along one line the sword
  travels; the one in focus opens under it with its keeper, record and the way to travel or begin; upright,
  the path runs down the side), **loader b, the console** (the logo, each finished boot step with its real
  time, the bar, a lore line), and **no name in the HUD**. They asked for the name over the hero's head to
  stay close to him: the tag reads gcd and rides his head bone instead of hanging at a fixed 2.2 m over his
  feet (it floated a metre clear when his head dropped in a roll). `?menu=0` and `?loader=a` keep the
  others; `PICKED.menu = 'c'`.
- **Why the loader is honest:** measured on the built page (gzipped, cold cache): 0.3 s download, 2 s boot
  on a fast machine; on slow 4G with a 4x-slowed CPU 10 s download and 10 s boot, the world's build about 70 %
  of the boot, and a first-ever shader compile up to 7 s. The bar shows a waiting run while bytes arrive
  (nothing to count), then the boot's real steps; no artificial delay, so a warm load barely shows it. The
  web fonts' sheet no longer blocks the first paint (the loader showed at 1.0 s on slow 4G, now 0.25 s).
- **Lore** (the owner's three places: the loader's lines, the picker framed as fires the sword can reach,
  the hero's name): eleven plain lines rotate on the loader; a pick says where the sword takes him next.
- **Consequences / open:** the layouts are DOM text in the HUD's idiom (no images, no new font); the path
  gets tight past about ten worlds (names wrap; it will need to scroll or shrink). Not yet seen on a real
  iPhone notch, home bar or a real gamepad (emulated and stubbed).

## ADR-197 — Every wyrm fire travels from it; roar-cast spells and a brood of fire; a forest you can walk into (2026-11-25)

- **Context:** the owner: "some of the dragon fire attacks seem to come out of nowhere. all the fire should be coming
  from the dragon itself ... add new dragon attacks where the dragon does some kind of cool dynamic fire spell through
  it roaring and it shows some dragon incantation symbols ... maybe like fire mini dragons that must be beaten or
  kamikaze ... make the map not have invisible walls ... more forest tree background and a more living forest detail
  for the dragon to rip and burn through. ensure performance is good". Asked first, they picked: a visible trail for
  every fire; all four spells (drakelings, wisps, serpent, firestorm); walk into the forest; smooth on their iPhone.
  The survey: three fires had no visible cause (the phase-3 second flame wall started 12 m beside the hero; the
  phase-3 chase pillars rose under him for seconds after the slam; Armageddon's meteors fell long after its bolts);
  Cinderwood's ground was a fixed 31 m circle that looked walkable between the trees.
- **Decision:** built by four Opus agents in two rounds on stubs the lead committed first (incantation.js, brood.js,
  broodAttacks.js, spellsFire.js and their tuning files), then an integration and a docs agent.
  - **Trails** (fireTrails.js; `?fireTrail=off`): the chase pillars burst at the head of a crack that runs out of the
    forefeet (18 m/s to the hero, then 9 m/s after him: the crack's arrival is part of the tell, about 0.45 s at 14 m);
    the second wall is laid out from the first wall's line (`?wallSource=a`; b: breathed by a runner); the meteors
    leave a vortex of fire over the wyrm (`?meteorSource=b`; a: its bolts hang as seeds). No draws added.
  - **The incantation** (incantation.js): a seal written on the letter grid in the fire field (rings, a band of sigils
    from an eight-shape dragon script, a {7/3} star), written in, turning, flaring, released, burnt out; on the ground
    or before the jaws; `?incant=a|b` (flat seal / standing runes), `?incantInk=script|fire|blood`.
  - **The brood** (brood.js, broodAttacks.js): drakelings (3 / 4 / 5 from phase 2, orbit and bite one at a time, normal
    or blue, a parry kills one, 1 - 2 cuts, a red dive when their time runs out; `?drakeling=a|b`) and wisps (from phase
    1 below 75 % HP, torn off the body, home in, commit red, burst 0.68 s later). The blade reaches them through its
    swept quad once per swing (player.feelCut gives the cut its stop, sparks and shake). Fairness: a brood cue holds
    (up to 1.8 s) while a cue needing another answer is due within 0.45 s, while the wyrm still has a blow to come,
    and red ones while bullets fly; while a brood lives the director weighs spells, flights and heavy blows by
    PR.layer (0) and counts live wisps as sky emitters.
  - **The spells** (spellsFire.js, spellsFx.js): roar-cast channels. The serpent (out of the circle, 6.4 m/s, turn
    1.35 rad/s, fells and burns its lane, strikes 1 / 2 / 3 times: a 0.78 s red rear, then a lunge) and the firestorm
    (a column that drifts at <= 2.5 m/s, lifts light trees into its spin, gathers 1.15 s red and bursts r 7 m);
    `?serpent=a|b`, `?vortex=a|b`. A stagger, the phase roar, the reset or death ends them harmlessly. A beat may carry
    its own place: Dragon.partPos 'point'.
  - **The walk edge** (edge.js WALK mode, forest.js, undergrowth.js, forestTuning.js): the hero's ground is the whole
    forest to the end (`?forestEnd=a|b|c`: a rock ridge 48.5 m out, a thicket wall, a deadfall), trunks and rocks
    block; a torn lane is the boss's ground only; the boss follows him in (+2 m, falling back at 3 m/s, never within
    7 m of the end). The forest: 1632 breakables (was 664), a treeline of young trees and snags in front of the old
    crowns, undergrowth (bushes, ferns, brambles), logs, stumps, mossy rocks, hanging moss; the wood past 60 m and the
    thicket on a deep mesh the phone does not draw.
  - Found on the way: `Dragon.onParried` dropped a second parry within 0.1 s whatever the attack (a drakeling bite
    parried 0.085 s after a tail lash got no dragon:parried and no posture): the guard is now per attack. The breach
    check now measures the share of time the wyrm spends in a move (the firestorm is one cue in 8.6 s: cues a minute
    no longer measure fighting).
- **Consequences:** ATTACKS 46 -> 50; the attack table hashes to c08725a9 (103cbc42 without the four new moves: no
  existing attack changed). Perf, headless Edge on the desktop GPU: draws 91 -> 97 desktop / 90 -> 93 `?touch`, the
  fight's triangles 1.21M -> 1.69M / 0.87M -> 1.11M, GPU time within noise; each spell or brood +0 - 5 draws, under
  0.2 ms. The phone's frame time is not measured on the device. The owner kept every default look (2026-11-25). Open: the wyrm
  fights at range when the hero stands out among the trees (closing in is an ai.js change); the drakelings' heads are
  their weakest part; the lane's grass fire can burn in bright knots after the serpent sinks.

## ADR-198 — The dragon print: the ground, floors, grass, props and trees printed in the wyrm's digits (2026-11-25)

- **Context:** the owner: the ground "doesn't seem like ascii ground ... make it look cool ascii without being
  too hard on the eyes ... or too grainy"; of four rendered looks they picked b, "the dragon ground" ("it
  allows the ground to look 3d, can help with background shadows") and asked for it on the stones and other
  textures, on grass that bends and is cut, every level's ground, ways to make it cooler, and footprints that
  are "cool subtle matrix flash" instead of Ashfall's dark prints. Having played every piece on at once: "i
  like 'everything on' (grass A) much better ... make all the maps use the dragon ground style ... have the
  footprints show in every stage".
- **Decision:** one print for every surface that is not a fighter: a lit relief (normal, moon, shadow map,
  point lights) printed in the wyrm's digit ramp on a world-anchored lattice of the wyrm's cell (0.135 x
  0.25 m, ~5 x 8 px at 720p), one digit per cell lit at its centre (`render/dragonPrint.js`). The ground
  (look b), the floors of every level (inside `createCarvedGlyphMaterial`, a lit lip per slab), the grass as
  printed tufts in the ground (no 3D blades), props and trees through the art pass with a relief and the
  shadow map, four upgrades (cloud shadows on the wind, contact rings, a re-print ripple from ground blows,
  ridge strokes) and flash footprints printed by the floor's own cells. Every piece behind its own switch,
  all at `a` by default; `?dragon=0` is the game before. Built as a fan-out (a core with hooks, four agents,
  a second round for the props' brightness).
- **Why this way:** world-anchored cells never swim (the reason the typed lattice ground of 2026-11-14 was
  dropped), one cell size ties the ground to the wyrm and the props, and a lit relief gives the ground the
  depth and the shadows the owner liked. Marks INTO the floor (prints, leaves) as shared uniform chunks keep
  them crisp on the lattice instead of soft sprites over it. One shared uniforms object per chunk
  (`DP_FX_U`, `DP_STEP_U`) means one CPU writer for every surface.
- **Consequences / open:** grass b (standing digit blades) lost to a; round 3 (the owner, same day) made the
  sword's cut show in the printed grass (`dgCut` b, the default), gave the fallen leaves a lit lens
  (`leafLook` a) instead of letters, and rendered three steps of more depth for grass a (`a3d1`-`a3d3`); the
  owner kept a ("lets go with the new default") and asked for smaller grass chips (0.6 x the code chips,
  0.7 x the tufts' tips); the
  floors' and trees' looks before (carved glyphs, round letters), once "do not restyle", are now behind
  `?dragon=0`; the phone's frame cost is the owner's to confirm (desktop: the print, floors and upgrades
  add well under 1 ms at 720p); first-round looks a / c / d stay behind `?ground=` until removed.

## ADR-199 — Frame cost: the ground drawn last and its relief baked; the world on its own step (2026-11-25)

- **Context:** the owner: "the game runs pretty slow on less powerful machines ... i want this to be at least
  60 fps on every device"; the machine was a laptop on integrated graphics (Intel Core Ultra 7 255U). A
  measured review (headless Edge on the RTX 4090, every level at 4K where the fill cost shows; the CDP
  profiler and CPU throttle for the script) found: no automatic quality (a desktop starts on HIGH at up to
  2x device pixels); the scene pass 75 - 80 % of the GPU frame, the ground 1.1 - 1.45 ms and the paving
  0.3 - 1.1 ms of a 2.4 - 3.9 ms frame; the ground drawn FIRST (three sorts solid things by material id
  before depth, and the ground's material is the oldest), so every pixel the floors, trees and fighters
  cover was shaded and painted over; the ground's relief worked out for every pixel, eight times, though
  it is fixed in the world and constant across a letter cell; and a slow CPU falling off a cliff, because
  under 50 fps every catch-up step (ADR-103) re-ran the world and every effect with the fighters (CPU
  throttled 10x: 10 fps where one step a frame would give about 33).
- **Decision:** three changes that leave the picture as it was.
  1. The ground is drawn last of the solid things (`renderOrder` 100) with a strict depth test, so
     whatever lies exactly in its plane still wins, as it did when drawn over the ground.
  2. The ground's relief is baked: at load the GPU evaluates the shader's own relief once per cell into
     two float textures (the normal's steps, with the meadow's share kept apart so it stays live, and the
     ridge's four neighbours); the ground reads two texels instead of 48 value-noise lookups. Stored as
     differences, in 32-bit floats where the renderer can draw into them.
  3. A catch-up step runs the Lab, the flow, the hero and the boss only. The world, the lights and every
     particle step once for every two of them and after the last (`STEP.world`), with the time those
     steps took.
- **Alternatives:** a depth pre-pass (a second draw of everything, for what one `renderOrder` gives);
  the floors drawn late too (they already draw after the scenery; what covers them is small, and a tie
  with a prop standing on them could flip); baking the floors' relief (a floor cell is lit on its facet,
  and the slabs lie at many heights and tilts: not a function of the cell); a tiling noise texture read
  with the GPU's filter (8-bit weights: the relief's slopes band) or four fetches a lookup (no cheaper
  than the hash); half-float bake textures (27 MB less; about 0.04 % of the ground's pixels print a
  neighbouring digit); the world once a FRAME whatever its length (a 100 ms step at 10 fps: untested
  ground for what falls and burns; every two steps keeps it under 42 ms, 33 ms at 30 fps, the step it
  had before ADR-103); a budget that drops catch-up steps when they do not fit (it gives up the fair
  parry window ADR-103 bought: the owner's call, not taken here).
- **Consequences:**
  - The picture: at 1080p, old against new on the same frame in all eight levels, at most 9 of 2 073 600
    pixels differ, by at most 2 of 255 (the same frame drawn twice differs in up to 4). The draw order
    alone: 0 - 3 pixels.
  - Frame cost, old against new alternating in one page (the GPU was shared with other sessions: read the
    ratios, not the milliseconds): at 4K 17 - 45 % less across the eight levels (Cinderwood 5.9 -> 3.8 ms,
    Ashfall 6.6 -> 3.7, the Ring 6.0 -> 3.9, the city 5.7 -> 4.5), at 1080p 10 - 25 % less. On a quiet
    GPU Cinderwood's ground went from 2.1 ms to 0.46 ms at 4K.
  - The simulation of a catch-up frame costs 19 - 28 % less at two steps, 14 - 18 % at three, 23 - 25 %
    at six (the simulation alone, old stepping against new in one page). The cliff is lower, not gone: a
    CPU slow enough still runs six steps.
  - Two float textures of 1779 x 961 cells, 54 MB of GPU memory (27 MB as half floats). `?bake=0` leaves
    the shader working the relief out per pixel.
  - The world's clocks: in the world's step `game.dt`, `fxDt` and `realDt` are the time of the steps since
    its last run. What the world does to the fighters (a falling tree, the ground fire's ticks) comes out
    the same at 16.7, 33.3 and 41.7 ms (world test `worldstep`).
  - Not measured: any weak GPU or phone (this machine has only the RTX 4090); the owner's laptop is theirs
    to confirm. Open, in the order the review gave: automatic quality (the render resolution following the
    measured frame time, a 60 fps cap on touch), the shadow map (435 000 - 570 000 triangles of static
    world redrawn every frame), lighter trees on LOW (the presets' grass counts do nothing under the
    dragon print), the shared uniforms' upload (about 0.5 ms of script a frame), the worst frames'
    hitches. The floors' shader is as it was: its relief is most of its cost.

## ADR-200 — AUTO quality: the render resolution follows the measured frame time; a 60 fps cap on touch (2026-11-25)

- **Context:** the owner wants "at least 60 fps on every device"; ADR-199's review found nothing lowers the load
  when a device falls behind (a desktop starts on HIGH at up to 2x device pixels, a phone on LOW at 1x), and the
  GPU's frame is linear in the pixel count (0.22 - 0.39 ms per megapixel on the RTX 4090, the scene pass 75 - 80 %).
  The owner's slow machine is GPU-bound (Intel Core Ultra 7 255U, integrated graphics).
- **Decision:** a controller (`render/autoQuality.js` `AutoQuality`, numbers in `CONFIG.autoQuality`) that steps the
  render scale through 2, 1.5, 1.25, 1, 0.75 (and 0.5 for reviews) device pixels per CSS pixel, capped by the
  screen's ratio and `maxPixelRatio`, floored at `floor`: 1, the owner's pick (2026-11-25), so AUTO never draws fewer letters than 1x.
  - It judges frames in 1.5 s windows. Two slow windows in a row (under ~54.5 fps) while the GPU is the limit step
    one down, at any moment. The GPU is the limit by its timer (`EXT_disjoint_timer_query_webgl2`: longer than the
    script and at least 60 % of the frame) or, without one, when the script takes under 80 % of the frame.
  - Each step down is checked in the next window. On the GPU's time where it is read; without it two steps in a
    row that did not help are needed, because on a vsynced 60 Hz screen 33 ms and 23 ms of GPU both show as 30 fps
    (the trace tests found the first rule undoing a good step). A step that did not help is undone and nothing
    below it is tried again this page load (a slow CPU, a battery saver holding 30 fps).
  - Up only in a calm state (title, explore, paused, dead, victory): with a timer when the step above is predicted
    to fit 72 % of the frame for two windows; without one a probe after 8 s of holding 60, watched for 5 s and on
    failure held back 20, 60, 180 s, then for good.
  - The first guess: the median of 11 frames on the title (each waits for the GPU) after 20 untimed ones (the
    first frames after the load ran ~3x slow), predicted to the other steps with 25 % of the frame fixed.
  - Settings: AUTO is a fourth place in the F2 / pause-menu cycle (AUTO → LOW → MEDIUM → HIGH), on by default; a
    preset turns it off; `?autoq=0|1`, `?autoqFloor=`. Touch keeps its LOW default only with AUTO off.
  - The frame-rate cap (`FramePacer`): every n-th refresh, n from the median refresh interval (120 Hz: 2, 144: 2,
    240: 4; under 105 Hz none, since 90 Hz cannot be cut to 60 evenly). On by default on touch; the pause menu's
    60 FPS CAP and `?fpscap=0|1` set it.
- **Alternatives:** dynamic resolution every frame (a viewport inside fixed render targets: no rebuild, but the
  letter cells and atlases follow the frame height, so the letters would change size continuously; and the
  coarse steps are what the owner reviews); stepping the presets (grass and shadow counts barely matter under the
  dragon print, ADR-199); the renderer string (`WEBGL_debug_renderer_info`) to guess a start (a table to keep, and
  wrong for every unknown chip); a cap by skipping frames by time (uneven on 90 / 144 Hz).
- **Consequences:**
  - A step is a `pipeline.setSize`: render targets reallocated and the letter atlases rebuilt. Measured on the
    RTX 4090 / i9 at a 1280 x 800 window: 2 - 9 ms in `setSize` (about 3 ms of it the atlases) and 5 - 19 ms more on
    the first frame after it, about one dropped frame; not measured on a weak device. What was done about it:
    steps are rare (2 windows to go down, hysteresis, back-off), never UP during a fight, and the 0.6 s after a
    step is not judged.
  - Below a frame height of 810 px the letter cells stay 9 px (`Pipeline.setSize`), so on a 1280 x 800 window 2x to
    1x keep ~89 rows of letters with finer or coarser strokes, 0.75x has 67 rows and 0.5x 44; on a phone 1x
    (today's default) has 44 and 0.75x 33. The owner picked the 1x floor from those sheets (`.claude/autoq-review/`): AUTO trades crispness, never the letter count; a device too slow for 60 fps at 1x stays under 60.
  - A phone may now draw above today's 1x when its GPU has room (more letters, more heat): the cap is on there.
  - Live checks in headless Edge on the 4090 with a GPU load in proportion to the pixels: 30 fps at 2x stepped to
    1.5x then 1.25x (68 - 77 fps) in 7 s and held; with the load gone it climbed back on the title; in a boss fight
    it stepped down but not up. With the CPU throttled 8x (10 fps, GPU idle) it made no step. Headless Edge has no
    back-pressure (a GPU-saturated loop still ran at 100 fps until the GPU was fully saturated): device frame rates
    are not claimed.
  - Tests: the `autoq` suite (device models in, steps out: GPU-bound with and without a timer, probes and back-off,
    CPU-bound, a frame rate held from outside, spikes, calm, a noisy GPU at a step's edge for 20 minutes, the cap's
    pacing at 60 - 240 Hz, the switches, the F2 cycle).

## ADR-201 — The still shadow map: only what moves is drawn into it each frame (2026-11-25)

- **Context:** the owner wants 60 fps on every device, starting from a laptop on integrated graphics (Intel
  Core Ultra 7 255U). ADR-199's review found the moon's shadow map drawn whole every frame: 110 000 - 570 000
  triangles a frame (Cinderwood: its trees, stumps and rocks, half a million triangles that never move), and
  the shadow camera following the view on a grid of the world's x and z, so it moved at each 8 cm of a walk.
  The owner chose this as the next step after ADR-199 ("lets do #2").
- **Decision:** a still map (`render/shadowCache.js`). A caster unchanged for 20 frames (3 for one of more
  than 60 000 triangles) is drawn into a map of its own only when that map must change; the frame's map
  keeps last frame's picture, the texels the changed moving casters covered are copied back from the still
  map (depth blits: a batched actor's moved bones at their old place, a plain mesh's last sphere, a big
  mesh's edited ranges at their old positions), and only the moving casters are drawn. With the cache on the
  shadow camera moves only in its own plane, in steps of 32 of its own texels.
- **Why this way:** the map is unchanged (0 of 4.2 million texels differ from a whole draw in 480 samples
  over the eight levels), the work left is what actually moves, and nothing outside the pipeline must tell
  it what moved: the state each caster already has (its matrix, its geometry's versions, the bones' texture)
  says it. Sampling two maps in every receiver would have cost every pixel of every surface instead.
  Copying the whole still map each frame (the first version) moved 32 MB of memory a frame, which an
  integrated GPU pays for; three's `copyTextureToTexture` reads the GL state back (about 0.7 ms of CPU a
  frame in Chrome), so the blit is made directly.
- **Alternatives:** two maps sampled by every receiver (per-pixel cost on every surface); the old world-axis
  snap with a coarser step (a visible jump of the shadows' edges at each step, measured: most of the frame's
  pixels changed); excluding by hand what the levels know to be static (a list to keep up in every level).
- **Consequences:**
  - Shadow triangles a frame, a scripted fight on each level at 1080p (HIGH, a 2048 map): Cinderwood
    571 633 -> 122 369 (-79 %), the grove 328 389 -> 99 181 (-70 %), the terrace -64 %, the hall -54 %,
    Ashfall -48 %, the Ring -46 %, the city -40 %, the throne -15 % (the Lord's own body is most of it);
    draws in the shadow pass about halved. Copied texels: 4 - 8 % of the map a frame on average, mostly on
    the 2 - 7 % of frames that redraw the still map. CPU: 70 - 115 us a frame for the bookkeeping.
  - A frame that redraws the still map costs what a frame cost before, plus one copy of the map.
  - The shadows' edges no longer crawl while the hero walks: a step of the camera changes at most a few
    pixels by a few levels, where one texel's step of the old camera changed about 93 % of the frame's
    pixels (the letters along every shadow's edge). `?shadowCache=0` gives back the camera and the pass as
    they were.
  - The frame time on the RTX 4090 does not move (its shadow pass was 0.05 - 0.1 ms); what it buys on an
    integrated GPU is not measured (none here). Memory: one more depth map (16 MB at 2048, 4 MB at 1024);
    a big mesh that has moved keeps a copy of its positions on the CPU (Cinderwood's tree run: 11 MB).

## ADR-203 — The wyrm's head held level and kept where a neck can look; the shown neck never leaves its head (2026-11-25)

- **Context:** the owner: "the dragon does weird neck movements when hes flying as well. in general review all the
  dragon neck movements and make sure it looks natural and accurate and not buggy". An audit stepped every one of
  the wyrm's 50 moves (plus the stagger and both phase roars) frame by frame from the same start, logging each
  neck joint's and the head's turn per frame, the head's roll off level, its up vector, where it looks in the
  chest's frame and its twist on the neck's end. Main showed four faults: (1) the head was leveled only at rest,
  so it carried the roll the curved neck adds up to: 57 - 79° in flights and upside down (up vector to -0.9) in
  the sky dive's climb, the wheels, the hover rise and the meteors' cast; (2) look points under, behind or over
  the head swung it round: ~180° back over the spine (tail attacks, rakes, the wheels; the meteors' look 40 m up
  but behind the snout turned the head backward), 60 - 156° in one frame; (3) the driven shown neck (ADR-025's
  swing) could not follow a strike's first step under its bend limits: FABRIK buckled it 2 m to one side while
  the head, pinned to the measured neck, was drawn 3 m from its end (the storm flurry's lunging bite); (4)
  `headExact` had no turn limit: a bite's first frame turned the head alone ~75°.
- **Decision** (rig/anim.js `_updateNeck`, rig/chain.js `apply`; `?neck=c|b|0`, default c): the head is held
  upright about its snout in every move against its own body (the chest's up; the sky's at rest), by a
  correction unwrapped against the last frame, at most 14 rad/s, holding where 'up' lines up with the snout; the
  driven neck takes the same roll spread down its joints (no point moves; resting, only what passes 0.6 rad). It
  looks where its move points it, over a shoulder at most 135° (a foe straight behind watched over the shoulder
  it was on until he is 0.6 rad round the other side); a look point nearly straight overhead takes the chest's
  heading, and a look point set high on purpose lifts the 0.6 rad nose-up limit to 1.2 (the meteors' roar, now
  facing forward). A shown neck missing the measured head by more than 0.35 x scale m blends to the measured
  shape (all of it from 1.0 x scale). `headExact` turns at most 45 rad/s.
  - The first pass (`?neck=b`) held the head upright against the SKY and kept its last heading while the look
    point was under or over it. The owner played it: "the head got worse when flying and when it does a ground
    perfect parry attack" (it rolled oddly and looked the wrong way): a banking body with a head held flat to
    the horizon reads as a twisted neck, and a flight's head held its old heading while the hero was under it.
    `?neck=0` is the wyrm before ADR-203. Also tried and dropped: fading the leveling out near vertical (it
    flipped the dives again); a 24 rad/s leveling rate (the wheels' head spun 25 - 30° a frame).
- **Consequences:** (c against main, the audit) no head flipped upside down by the neck's curl in flight (the
  sky dive's climb roll 72 -> 35°, the wheels 57 - 60 -> 18 - 25°, the hover rise 67 -> 13°); the flips of the
  tail lash, tail sweep, rakes and cataclysm 63 - 150 -> 21 - 29° a frame; bite snaps 68 - 80 -> 43°; the storm
  flurry's neck 128 -> 85° on the strike's first frame (the measured solve's own step, kept: it carries the hit
  spheres) with no sideways buckle; the plunge and the parry recoil as before. The resting stance and the side
  view the owner chose are unchanged. Hit spheres: the neck's joints do not move; the snout rolls about itself
  and turns at most 45 rad/s on an exact strike's first frame. While the hero's flurry runs (a perfect dodge's
  answer, the riposte) the wyrm keeps where it last saw him (`_sensePlayer`, c and b): the owner played c and saw
  its head "home into the players teleporting movement"; its look point travelled 12 - 28 m chasing his blinks,
  now none. Seeded fights drift (the mouth sits a little
  differently, so the bullet cues shift a frame). The owner played c with the flurry fix and picked it: "Ship c" (2026-11-25); b and 0 stay behind `?neck=` for comparison. Open: the rear attacks (tail
  lash, rakes, cataclysm) still curl the neck back over the spine, where 'upright against the body' is ill
  defined and the head can sit rolled; the leap's and pounce's neck strikes stay fast.

## ADR-204 — The run carried like the owner's reference: the blade forward at the hip, a full pump, a closed fist (2026-11-25)

- **Context:** the owner, after the run's free arm (ADR-187): "make the right angle hold the sword at a proper
  natural angle ... make the left hand fist look like a hand ... right now it looks like a weird stump". Two option
  rounds were turned down (sword: a relaxed trail, a low sweep, both still pointing back; hand: an open hand and a
  loose fist with jointed fingers). They gave a reference film (a knight sprinting with a straight sword; its name
  stays out of the game) and asked for its arms mirrored. Measured on the carry before: the blade pointed behind
  him (azimuth -144 … -161°) on a wrist bent 62 - 87° off the forearm, and barely moved over a stride (3° of
  elevation on the run, none at a sprint).
- **Decision:**
  1. **The sword carry `hip`** (`player/runSword.js`, `?runSword=hip|old`, the Lab's `run sword` row, default):
     the blade forward, low at the right hip, rocking with the forearm. Joint angles posed by forward kinematics
     against the torso's own line, then turned by its lean (`runSword(OUT, ph, armF, s, tilt)`); the blade is the
     forearm's line plus a grip angle on the thumb side (a hammer grip), floored 34° below level. `RUN_SWORDS.hip`:
     run `{ phi: [-9, 17], ab: 11, el: [108, 134], grip: [56, 64], out: 6 }`, sprint `{ phi: [-10, 27], ab: 13,
     el: [98, 126], grip: [58, 77], out: 5 }`. The blade's flat is rolled 40° toward the game camera: edge-down (as
     in the reference) printed as a one-cell line at 720p. `loco()` keeps its blends over it (backpedal, the fight
     carry FIGHT_RUN, the sprint). The relaxed trail and the low sweep are removed.
  2. **The free-arm carry `d`, the full pump** (`player/runArms.js` `RUN_ARMS.pump`, default): the fist forward
     before the belly (upper arm +21°, elbow 85° at a sprint), the elbow high behind the back (upper arm -57°,
     elbow 100°), turned by the lean; the walk as `a`. `a`, `b`, `c` and `old` stay.
  3. **The free hand as a closed fist** (`gear/handShape.js` `fistHand`, `?handLook=g`, default): the back of the
     hand and the knuckle line as wide as the bracer, the curled fingers a roll under the palm, the thumb a bump over
     the front; no finger detail (the owner: "we don't need to worry about the detail like fingers"). `h` is the
     same as a dark glove with a flared cuff. The sword fingers and the fist on the grip keep their shapes. The fist is
     built from as many geometries as the hand before it (12): each draws a uuid from the seeded Math.random, and a
     hand of 6 pieces shifted the seeded fights (the sheath's pace check fell from x1.05 to x1.01).
- **Consequences:** at a sprint the blade rocks -21 … +23° (reference -20 … +25), the wrist 57 - 76°, the point
  at least 63 cm off the ground, its worst jump 2.2 cm a frame²; the run is the same shape at about 60 % of the
  swing. Seen from the game camera running away (north) the blade is mostly hidden under the cape, as the
  reference's is from behind; the larger `out` yaw is the knob if steel should show there. Still open: the run
  start from standing still jumps the point ~26 cm on loco's first frame (the idle rest's hand-over, any carry);
  the torso leans 24 - 25° at a sprint against the reference's 20°. `?runSword=old`, `?runArm=a` and
  `?handLook=a` give the run before. The owner played the new run and picked hand g of g / h (2026-11-25).

## ADR-205 — Local test runs go easy on the owner's PC: one shared pool of slots, low priority, `--only` (2026-11-25)

- **Context:** the owner's PC (i9-14900KF, 32 threads, 128 GB) sat at 100% CPU: two agents' `npm test`
  ran at once, each starting all 24 tasks side by side (~40 node processes, ~75 GB), and eight preview
  servers from finished worktrees were still running. The owner games on the same machine and asked
  that agents stop straining it, without slowing what it takes to get a PR merged.
- **Decision:** with no `CI` env, `tests/run.mjs` runs every worker at below-normal priority and takes a
  slot from one machine-wide pool (`<tmp>/abyss-test-slots`, `ABYSS_JOBS`, default 8) before starting a
  task; a slot names its run's pid and a dead run's slot is taken over. A stopped run kills its workers.
  `--only <names>` runs a subset of the tasks. CLAUDE.md asks agents to test only what they changed
  while working, never to start a second `npm test`, and to stop their servers before finishing.
- **Why this way:** a per-run cap still lets several agents pile up; a shared pool caps the machine.
  Low priority is what keeps a game smooth beside them: Windows serves the game's threads first.
- **Consequences:** CI is unchanged (it sets `CI`), so a PR's check takes as long as before. A full
  local run alone takes longer (8 at a time, not 24); runs from several agents queue instead of
  slowing each other. `ABYSS_JOBS=2` while gaming lowers it further.

## ADR-206 — Performance is guarded before it ships: a cost budget in `npm test`, `npm run perf` on a real GPU (2026-11-26)

- **Context:** the owner wants 60 fps on every device. ADR-199 found its savings by a review after the cost had
  crept in (a 570 000-triangle shadow pass, a per-pixel ground), and ADR-200's AUTO quality only lowers the
  resolution once a device is already slow. Nothing stopped the next change from making a level heavier.
- **Decision:** two guards, one that runs in CI and one that runs on a machine with a GPU.
  - **The cost budget** (`tests/integration/cost.mjs`, in `npm test`; its numbers in `tests/cost-baseline.json`):
    every level's set is built with the real modules, wired like the world (Destructibles, so the rigid batch
    exists), and counted: visible meshes, main-pass triangles (an instanced mesh by its instances), the moon's
    shadow-caster triangles, rigid-batch bones, breakables, colliders, geometry MB; each for the level whole
    and for the phone's share (`setQuality(0)`). Nothing is timed, so the numbers are the same on every
    machine and a CI runner can hold them: a number over its budget by 3 % + a small slack fails; one under
    by 10 % prints a note to lock the gain in. A new level has no row and fails until `... cost.mjs . update`
    writes one; a level that is gone fails the same way.
  - **`npm run perf`** (`scripts/perf.mjs`, `scripts/perf-probe.js`): starts the dev server and a headless
    Chrome / Edge on this PC's GPU, stages one fixed fight per level, and prints draw calls and triangles by
    pass, the GPU ms by pass and per frame at 1080p and the phone's 2556 x 1179 (`--4k` adds 3840 x 2160), and
    the script ms by module. `--save` keeps a baseline in `.perf/` (a machine's own, not committed: the ms
    depend on the GPU), later runs print the change. Counts repeat exactly between runs, so `--check` exits 1
    on them (over +10 % calls or triangles); milliseconds do not (two runs of one tree differed by up to 30 %
    on the RTX 4090, whose frame is 1 - 2 ms), so they print from 25 % and gate nothing. The scene is
    rendered frozen after 40 settling frames (the still shadow map and the GPU clock).
  - **A rule** in CLAUDE.md: a change that makes a level heavier raises the budget on purpose and says so in
    its PR; a change that draws something runs `npm run perf` before and after and reports the cost.
- **Alternatives:** timing frames in CI (a shared runner's CPU has no GPU and its noise already moved a test's
  p99.9 from 0.3 to 2.5 ms: ADR-153's `world budget` runs alone for that reason); a hard fps gate (the number
  belongs to a device, and the owner's laptop is not in CI); counting triangles in the pipeline's render
  info (needs WebGL: the headless suites mock it).
- **Consequences:** a deliberate increase costs one command and a line in the PR. The static counts cannot see
  a shader's cost (the floors' relief: ADR-199) or a particle count that grows at run time; `npm run perf`
  sees those, on a machine that has a GPU. Counts are of the set's own meshes: the hero, the boss and the
  effects are not in them (their cost shows in `perf`'s script and GPU ms). Not measured: a weak GPU or a
  phone; `perf` runs on whatever PC runs it.

## ADR-207 — The hero's idles and guard after the owner's reference footage (2026-11-25)

- **Context:** the owner gave three sections of their reference footage, "for all the idle animation and poses for
  you to mirror to this game", and one for "the guarding stance and animation". Asked, they answered: the
  two-handed hold is the FIGHT stance (locked on, a boss fight) and at ease he stands one-handed; the put-away and
  draw is an occasional idle moment, and as the hero has no scabbard the sword fades out in its own green flame at
  his left hip and is drawn back out of it; ADR-186's habits, tricks and spells are kept, from the new stand.
- **Decision** (`refStance.js`, `idles.js`, `anim.js`; `?idles=ref|new|old`, default `ref`; `?guard=ref|ward`,
  default `ref`):
  - At ease `REF_STAND` (the numbers start from the steel look set's stand, `?lights=steel` on a branch not yet merged, so the two
    agree): tall, the feet a little over shoulder width with the left a short step ahead, the sword hand at the
    hip, the blade forward, down and out to his right (point ~0.6 m up ahead of the right foot), the free arm
    hanging, the hand open. In the fight `REF_READY`: both hands on the grip before his belly, the blade ~47° up
    and 25° out to his right, the point ~1.9 m up. The free hand takes the grip late in the stance's change
    (`twoHand` = smoothstep(0.35, 0.95, fightW)) and lets go on the move.
  - One rest each; ADR-186's at-ease actions all kept, their forearm-led moves starting from this stand's arm
    (`syncStandArm`: the elbow and forearm aim solved from `REF_STAND`, the blade's own aim); in the fight only the
    habits that keep both hands on the grip (`grip`, `shift`, `loosen`, about the hold's blade).
  - The put-away (`stow`, a trick, 3.6 s): a dip, the hand to the left hip with the blade forward-left and down,
    the sword gone ~1.55 s (both arms hanging, the empty fist on the wrist's line), the same dip, the blade drawn
    up and over forward into the stand. The sword's own meshes (`rig.slots.weapon`) draw into the hilt and hide
    (`HeroAnimator._stowSword`): nothing is added to the rig (a new object draws a three.js uuid off the seeded
    Math.random), and the swept joint, the hit test, never changes. `anim.stow` is 0 every frame but those of an
    uncut put-away in the loco clip, so the sword is whole the very frame any other clip starts, when a move cuts
    it, when the idles switch and on a reset. `swordMystic.js` burns the going / coming steel in its flame
    (`SPELL.stow`); the halo and the gem's glow rest while it is gone.
  - The guard `REF_GUARD`. The plan read it as the blade held upright; the footage's front and back views show
    the side view's upright blade is a slant across his face: both hands raised before his right shoulder, the
    elbows out, the blade rising ~32° across his face to his left, its point past his left shoulder above his head,
    the flat to the foe, in a braced crouch (sunk ~25 cm, the feet ~0.8 m apart, leaning in). It was built from the
    four views: it stands 13° off upright from his side. The hands come up with the block's own 0.08 s
    cross-fade, the body sinks over 0.3 s (`REF_GUARD.sink`); the block's timings, windows and costs are untouched.
    A duelist's animator (no free hand) keeps the cross ward. A parry's snap onto the blow (`deflectPose`) is
    posed from the cross ward's body and eases back into this guard with it (`WARD_BODY`): its blade and hand are
    aimed from that body, and from the braced guard's turned chest half the parried blows ended with the two
    blades 0.2 m apart (duel `clash`).
- **Departures from the footage, and why:** the blade's flat is rolled 40° up off his sides (`FLAT_ROLL`): held
  flat to the sides, edge down, as the footage holds it, it is edge-on to the game camera above and behind him (a
  line one letter wide). The hold's grip sits ~13 cm higher than the footage's belt and the blade ~8° flatter
  (47° up, 30° out to his right): at the belt the sword wrist bent 70-90° off the forearm, past the 60° at which
  the fist (built on the sword's frame) turns off the wrist (ADR-186's last amendment).
  - **The hold's feet** (found by the full `npm test` after the merge with main): the footage stands the LEFT foot
    a short step ahead. The light chain steps the foot further back (anim.js `play`: `stepL`) and comes home to
    the stance, so from the left-ahead hold every light stepped the other foot: the way home lifted the wrong one
    (after hit 2 the left 6.9 cm, the right 0.0; heroweight W7c) and a bearing foot slid 10.6 cm through the rising
    thrust (W7a, ≤ 6). The hold now stands the right foot 18 cm ahead and the left 18 cm back (the feet the chain
    steps from and comes home to, as the fencer's guard did), the hips square: slides ≤ 4.5 cm, the way home lifts
    the foot that stepped (6.9 cm, the other 0.0).
  - **The arms off the ribs** (the kept-for-later looks): the stand's sword elbow points back and a little out
    (`rP`; pulled in, the warden cuirass's belt cut 3.5 cm into the hanging upper arm, now -1.0) and the hold's
    free elbow out (`lP`; across his front the robe's sleeve wing on that arm swung through his chest on 10.5 % of
    the route's frames, now 2.2 %). The moves that swing the blade take the elbow's old pole over their envelope
    (`REF_STAND.leadP`, idles.js `leadArm` / `syncStandArm`): faded in from the elbow out, the salute's and the
    spells' raised fist turned 63-77° off the forearm (≤ 60), now 55° at most.
- **Consequences** (scenario `heroref`, measured in his own frame): the stand's sword wrist 44° max, elbows R 131°
  L 126°; the hold 60° (R 88°), the free hand 0.0 cm off its place on the grip; through the stance's change the free
  hand stays ≥ 8.8 cm out of him; every action within the bars ADR-186 set (wrist ≤ 57° in every action, the
  blade ≥ 20 cm off his body); the put-away hides the sword 224 frames over two plays and never outside it, and in
  every cut of it the sword is whole the frame the move begins; every move from the stand, the hold and inside
  every action within ×1.5 + 10 cm of the bare stance before; the guard's entry jumps ≤ 31.8 cm at the point (the
  cross ward from the stance before: 57 cm). From the game camera the hold's and the guard's blades stand over
  his right shoulder and across his head; the owner has not seen them yet. Every suite written against ADR-186's
  poses and the cross ward runs with them (`heroidles` and, through `pinAdr186`, `herolife`, `heroarms`, `herohand`:
  `setIdles('new')`, `setGuard('ward')`; `herostance` as before `'old'`) rather than loosening its bars. Two more
  measures are tied to the old stances and say so: the moon ribbon sword's swing through a falling cut is
  measured from the fencer's guard (`hero`: from the hold's raised blade the hilt travels less into the coil, 30°
  where the bar is 35; with only the hold's blade lowered to the fencer's 13°, 51°), and the air star of seven
  passes (`chain`) is checked against the widest its complete search finds from where he dodged (the new stance
  moved the seeded fight before it: from that dodge spot the search's best is 14°, from the old one 21°; seeds 1338-
  1340 pass the 17° bar either way).
## ADR-208 — Boss blows measured from reference footage: the mocap clip fitted onto the duelist rig; Tian Lei's try turned down (2026-11-26)

- **Context:** the owner gave a reference film of bare-handed melee attacks and asked for the bare-handed
  bosses' attacks to move like it, starting with one boss to preview, and for what was learned to stay in
  the repo as a melee attack animation engine for future agents. The measuring tool existed on the hero
  remake's branch (`scripts/mocap`: pose tracking on footage, fused into clips on a 24-joint skeleton), but
  the duelist bosses are animated by keyframes on today's hero rig (hand / foot targets, poles, body,
  spine), not joint clips. The owner's answers: Tian Lei first; remap his existing blows (names, tells,
  damage, AI unchanged); the reference motion at OUR windups; behind a switch, held for review.
- **Decision:**
  1. `scripts/mocap` (and the hero2 skeleton / clip contract it writes to) comes onto `main` as a tool.
  2. `scripts/mocap/duelist/fit.mjs` retargets a clip onto the duelist rig by DIRECTION for the arms (our
     shoulder + the reference's upper-arm and forearm directions at our bone lengths: arm angles kept
     exactly), by orientation for the pelvis, spine and head (YXZ Euler, the rig's order), by scaled
     position for the feet; travel taken out (a duelist's root motion is its beat's). The windup is laid
     piecewise on the beat's clock: start → u 0, chamber → the beat's cock, contact → u 1, follow-through
     → u 2. `--check` poses the real animator with every key and prints the error.
  3. `realise.js` takes an optional `keysOf(beat)`: the keys a beat plays this time. Tian Lei's builders
     put the measured keys on each beat as `refKeys` (refBlows.js, generated from `tianlei.json`), played
     while the look switch `fists` is `ref` (Lab LOOKS, PENDING: the owner has not picked).
  4. Six blows are measured: jab (mirrored), cross, hook, uppercut, backfist, hammer. The film has hand
     strikes only, so his kicks, knee, elbow, shoulder and sweep keep their keys.
- **Why this way:** fitting the clip onto the rig the bosses already share keeps every gameplay number and
  every test of theirs; a joint-clip player for bosses would mean a second animator and a second body.
  Keeping arm directions rather than positions is what the owner judges (arm angles, placement).
- **Consequences:** through the real animator the fists land within ~5 cm of the retargeted reference,
  elbows ~11, knees ~6, ankles ~1. The film did not fuse across camera angles (follow cameras, passes that
  differ, 30 - 60 captured frames a second, gaps at impacts): each blow is one take with the striking arm
  hand-keyed through the strike, so the arm paths are the footage as read frame by frame, not tracked.
  The uppercut and the hook are the most hand-made; the jab is very low (the reference's). The reference
  is a wild brawler (same-side lunges, spin-throughs), so with the switch on he fights in that style.
  `asc.mjs . fists` proves timings identical on and off and fights every measured move on the real rig.
- **Outcome (the owner, the same day):** "the new animations look worse than the old ones"; worse were the
  stiff, unnatural arms and the lunges and feet. Tian Lei's wiring (`refKeys`, the `fists` switch, the
  generated keys, the `fists` scenario) was taken out before merging; his blows are as authored. What lands
  is the engine: `scripts/mocap`, `scripts/mocap/duelist` (fit, guide, the map as an example), the recorder
  and the optional `keysOf` hook in `realise.js` (unused until a boss uses it). Next time: a reference of
  clean technique that tracks, the boss's own footwork, and a render for the owner before wiring.
  If the hero remake's branch later lands, its copies of `scripts/mocap` and `src/entities/hero2/*` should
  be taken over these (check `check.mjs`'s film list keeps `fist`).

## ADR-209 — The phone's frame: a readout on the device, and three of its spikes taken out (2026-11-26)

- **Context:** the owner saw the frame rate dip in fights on their iPhone ("pretty powerful"), on the fox,
  bamboo (grove) and code-hall levels; they chose "the on-phone readout plus the spike fixes". Recorded on
  the RTX 4090 / i9 at the phone setup (`?touch`, 1468 x 686), a fight frame is 4 - 5 ms of script and
  2 - 3 ms of GPU, with 0.1 - 0.4 % of frames over 9 ms of script (worst 13 - 16 ms; one 260 ms stall once,
  not reproduced). The spikes come when a blow lands: a trade (4 - 7 ms), a blade clash (3 - 4.6 ms), the
  boss's parry contact (2 - 2.5 ms), a perfect dodge (2.3 - 2.9 ms), each mostly sound voices built, the
  hero's pose evaluated, HUD call-outs, the boss's reaction. The same fight a second time spikes as much
  as the first (not a load). Two spikes were the game's own making: the first break of a floor or of the
  grove's bamboo drew a 38 000 - 130 000-vertex hidden mesh for the first time (its bounds, 1 - 2.5 ms, and
  its buffers' upload), and the still shadow map (ADR-201) copied a big mesh's whole position array on the
  frame it started to move (bamboo: 1.1 ms). None of it is measured on the phone: no profiler reaches it.
- **Decision:**
  1. `?perf`, a readout on the device (`dev/perfReadout.js`): every part of each drawn frame timed, a line
     on screen, a report to share or copy: what the phone spends, from the phone.
  2. The hidden remains (`foldAway` / `autoHide` meshes) are drawn once at load into a 1 x 1 target
     (`warmDraw`): bounds and buffers ready before the fight.
  3. The still shadow map keeps a big mesh's position copy current on every change (only the changed
     ranges), so starting to move costs no whole copy.
  4. The seen-through pass does not walk the hero's ~200 nodes again (his matrices are the frame's).
- **Not taken:** a scan of the contact rings in slices (0.4 ms a frame by an instrumented count; 5 - 15 us
  by a clean one: the count was the instrumentation's); the V8 allocation profile's top items (17.7 MB/s in
  a fight, most of it decimal numbers boxed by V8: Safari's engine does not box them, so it is not the
  iPhone's pause); the hit-time work (sounds, the hero's pose, call-outs, the boss's reaction): each is a
  look or a sound and wants its own measured change, best chosen from the iPhone's report.
- **Consequences:** a break no longer uploads anything in the fight (0 first draws in a fight on the fox,
  grove and code levels, against 2 - 3 before); a big mesh that starts moving costs the still map 0.36 ms
  instead of 1.1 (grove). Whole-fight timings could not tell the builds apart: the machine was 75 - 81 %
  loaded by other sessions and runs varied +-25 %. The load step takes ~1 frame more for the warm draw.
  Next: the owner's `?perf` report from the iPhone in a fight on each of the three levels, then the parts
  it names. Not measured: any phone.

## ADR-211 — The perfect parry earns its own reward: N planted deathblows (2026-11-26)

- **Context:** a parried last blow of a string answered with the perfect dodge's flurry (vanish, flash cuts round
  him, leaping arts), every string, so the parry had no reward of its own. The owner gave reference footage of a
  sword-deflect chain and of a sword-action game's skills, and shaped the answer over five filmed rounds: a planted
  single cut (kept as `planted`), then a posture-break two-beat deathblow ("i dont like this"), then "the parry
  streak ... do # of streak death blows to the boss" with a special effect per hit, then faster / weightier /
  piercing, then a hit-pause per blow, blood, cuts on the sword's contact, then Shatter Web without the big slashes,
  the Flesh sound and no matrix effect ("push this out").
- **Decision:** against a duelist (`?parryRiposte=deathblow`, the default), parries fill posture and `player.parryRun`
  banks perfect parries (not the dodge streak; spent by a combo, reset when he is hurt or the posture empties). A
  string's last blow parried opens the counter-cut window, nothing automatic. A parry that breaks posture, or any
  parry of a blue-tell blow, starts the combo (`player/deathblow.js`, `DEFENSE.deathblow`): N = clamp(parryRun, 1, 7)
  of the hero's own attack clips (13 moves, no repeat in a row, never the last combo's order, the finisher one of
  three big ones), within 0.6 m of where he parried, unhurtable; every contact freezes the world `hold` real
  seconds (0.16 - 0.2 s, the finisher 0.38 s; ~3 s for N = 7) with the dodge flurry's cold cast and a 12 m camera
  lean; damage 22 + 2N a blow, 40 + 15N the finisher. Each hit calls `combat/deathblowFx.js` `deathblowHit` (the
  blade's sampled `path`, `base`, `hold`): one straight cut centred on the contact along the swing (`?dbfx=b` Shatter
  Web, the owner's pick: the cuts cross and snap on the finisher; a, c, d kept), blood (`?blood=0`: a spray, a wound
  along the cut, LetterBatch pools until the fight resets) and the exit burst; the fire-field heat is budgeted (280
  blobs). The hero's own blade line / arc is not drawn for a deathblow swing (`slashFx.owns`). Sound
  `audio/deathblowSfx.js` (`?dbsfx=a` Flesh, the owner's pick; b c d kept, 0 = the flurry's). A matrix look
  (`combat/deathblowMatrix.js`, `?dbmatrix=rain|world`) is built but off.
- **Consequences:** the dodge streak and its flurry are the dodge's alone; the wyrm keeps the flurry riposte. Suites
  whose checks measure something else pin `old` (duel PERFECT / STREAK / FXLOOKS part 3, city win, veil).
  `?parryRiposte=old|planted`, `?parryGrow=0`, `?dbsfx=0` give the earlier behaviour back.

## ADR-210 — The perfect dodge's flurry: smear, floor sparks, aerial cuts and four looks behind `?dodgefx` (2026-11-25)

- **Context:** the owner: the perfect dodge should not have "random like hops over the character and should be
  more epic cooler looking". A first round (`?dash=1`: no blinks, every pass from where he stands, always the Passing
  Cut) was filmed; the owner preferred the old vanish and all three finishers, kept the new smear and floor sparks,
  asked for aerial cuts in a streak, and for four variations that use what the reference footage taught (a dash
  thrust: a low set, one smeared frame, a bloom at the point breaking into floor tendrils, the lunge held; close
  strings: a small bloom per contact, sparks that fall and gather).
- **Decision:** `STREAK_FX.dodgefx` (`?dodgefx=a|b|c|d`, the Lab's `dodgefx`; '' = today), only against a ground foe
  and not a riposte / counter: today's flurry plus smear copies (`_afterimage`'s `smear`), floor kicks
  (`FlurryFx.kick`) and aerial cuts (`Flurry._isAerial`: from 2.2 m down through him), and a) a fourth art, the
  Thunder Thrust; b) `FlurryFx.bloom` + `tendrils` at every contact; c) `FlurryFx.sparks`, a lingering cloud;
  d) a longer coil, a held finish / landing and a camera push. Numbers: `DEFENSE.flurry.dodgefx`. Blows and damage
  unchanged (duel `dodgefx`). `?dash` is gone (git history keeps it). The owner watched the four side by side and picked **a** (the Thunder Thrust) as the default (2026-11-26); `?dodgefx=off` gives the flurry before. The pace sims (duel / lord `pace`, city's win window, duel `pressure`) measure the boss with the dodge looks off: the thrust's held lunge holds the world longer, a gap in his cues that is not his pace.
- **Consequences:** aerial cuts exist only on the chain's paths; d delays the art (its blows' frames move).


## ADR-215 — BENCH: each pipeline step's GPU cost, measured on the owner's phone (2026-11-26)

- **Context:** the owner's `?perf` reports from their iPhone (ADR-209): the script is 3.5 ms of a frame (p99
  7 - 12 ms), yet 6 % (fox, code hall) to 20 % (grove) of fight frames run over 20 ms, the long ones 46 - 69 ms
  with 3 - 4 catch-up steps, and AUTO already sat at the owner's 1x floor on fox and grove. The GPU is the limit,
  and Safari has no GPU timer, so which step costs is unknown. The owner said yes to a BENCH button.
- **Decision:** BENCH in the readout: the frame on screen drawn whole and with each step left out in turn, each
  reading ended by a 1-pixel read (it waits for the GPU); a step's share is the difference. Also the still
  shadow map redrawn every frame, and the frame at ~0.7x the pixels (how much a resolution step gives). ~4 s
  on a phone, the game holding still; everything is put back.
- **Consequences:** the report names the step to cut at AUTO's floor (a smaller shadow map, a cheaper glow,
  fewer effect letters), to be shown to the owner as before / after options. A difference method: steps that
  overlap on the GPU can share time, so the shares need not add up to the frame (the rest line shows the gap).
  On the RTX 4090 the whole frame at the phone's size is ~2 ms; the numbers mean something on the phone only.

## ADR-216 — The lite world: a phone with no resolution step left draws a cheaper world (2026-11-26)

- **Context:** the owner's BENCH on their iPhone (ADR-215), fox in a fight at 669 x 867 and AUTO's 1x floor:
  a frame 13.3 ms, the world pass 11.8 ms of it; ~0.7x the pixels gave only 32 % less. The world's per-pixel
  print is what costs. Three options rendered at the phone's size on fox and grove: A as today, B the four
  upgrades off (ridge strokes, cloud shadows, contact rings, the ripple), C B plus the floors' relief in one
  octave; on the desktop GPU the world pass was 69 - 80 % (B) and 66 - 69 % (C) of A's. The owner picked C.
- **Decision:** `game.liteWorld`: on a touch device, once AUTO is slow with no step down left
  (`autoQ.wantsLess`), for the rest of the page load; `?lite=1|0` to force. groundFx holds the four upgrades
  off and `uDpLite` turns the floors' cheap relief on (a uniform branch: no second program).
- **Consequences:** a phone that holds 60 fps at its floor never sees it; the owner's iPhone on fox and grove
  will. The world pass in one page, lite against full, 4K desktop GPU: fox 2.48 -> 2.16 ms, grove 1.99 -> 1.56
  (the sheets' runs gave 31 - 34 % less; this machine was shared and noisy). The picture with it on matches the
  sheet's C in the same page (474 of 580 000 pixels differ, from the relief alone). The look changes once, when
  it turns on, mid-page (one frame). Not measured on the phone; the next `?perf` BENCH there says how much.

## ADR-223 — Held blue / red windups, released feet and quick blows for Lu Wusheng, Wen Yao and the wyrm (2026-11-26)

- **Context:** the owner asked for every boss's poses and motion to be audited and to look accurate, for each blue
  (parry) and red (perfect-dodge) attack to have a readable held windup pose, and for some much faster normal
  blows that stay fair. This pass took Lu Wusheng, Wen Yao and the Cinder Wyrm (other sessions the rest). The
  audit (`tests/integration/motionAudit.mjs`) stepped every move from the same start and measured, in the boss's
  own frame: the fastest step of each hand, the largest one-frame change of speed of any joint (a pop), the
  planted feet's sliding, the elbows, the facing at the impact and, per blow, the longest still stretch of the
  windup. Found: every blue / red blow that is not a draw, a cast or a long charge moved all the way into its
  strike (held 0.00 - 0.13 s); the wyrm's blue and white windups of a kind looked the same; Wen Yao's planted foot
  jumped 0.41 - 0.53 m in a frame when his clip lifted it after his root had closed in under it (anim.js
  `_feetClip` handed it to the clip's key at once). The facing at the impact was right (within 2°).
- **Decision** (behind switches; the owner's picks, below, the default):
  1. `?sheathMotion=` / `?foxMotion=` `a|b` (duelist/heldTells.js): such a blow holds its cock `HELD.hold` (0.16
     s) more, through the realiser's bait hold (the cocked pose repeated as the hold ends, so the strike leaves it
     from rest). `realise.js` `keysOf` (ADR-236 had removed it while nothing used it; it is back) returns the keys
     or `{ keys, hold }`. The cock is the last key at or before the
     beat's `cock` mark that is not the gather, else the first non-strike key after it (moved onto the mark).
     `a` colours the cock: blue +3.5 cm, leaning back, chin up; red sinks 4 - 10 cm (to -0.6 at most), leans in,
     eyes down, the feet 7 cm wider. A first try played the way to the cock faster to make room for the hold in the
     same windup: the raise snapped at 18 m/s; the authored way and a longer windup it is.
  2. `HeroAnimator` `opts.liftEase` (a function, the boss's kit `animOpts`, passed by duelist.js and the fox's
     selves): a planted foot the clip lifts is eased from its spot to the key over 0.12 s; on with the boss's motion
     switch. The hero passes no option: his feet are untouched.
  3. `?wyrmMotion=` `a|b` (dragon/tellPose.js, tuningMotion.js `WYRM_HELD`): a blue / red hit of a string wound
     up under 0.95 s holds its kind's k = 1 pose 0.18 s more (its windup phase longer: the beats' impactIn follows,
     so the cue stays flashLead before the impact); `a` adds the colour's posture to the pose targets while it
     winds up: blue rears its forequarters for a blow of the head (`rear` 0.32: the rig turns a rise past the
     forelegs' reach into sitting back, so a plain rise read lower), the head high and back, the jaw open, the
     sails lifted; red sinks onto braced forelegs (`lower` 0.42, `elbowsOut`), the head low, the sails folded, the
     tail up.
  4. Quick blows (`?sheathQuick=` `?foxQuick=` `?wyrmQuick=` `a`; weight 0 otherwise): Before the Word, Fox Snap,
     Fox Knee, Snap swipe (COMBAT.md "Held tells and quick blows"). White, a `fixed` windup in [flashLead,
     minFirstWindup) (the wyrm's 0.5 s, 0.35 at phase 3), close range, light; the suites' first-windup floors
     exempt `quick` and check flashLead instead.
- **Why this way:** the hold is the realiser's own bait hold, so the strike's motion, its active frames and every
  window stay as authored and tested; only time at the cock is added, which can only make a blow easier to read.
  Colouring the existing cock by body height (tall / low) reads at the game camera, where arms are a few letters.
  Per-boss data and an opt-in hook keep the other duelists (being audited by other sessions) as they are.
- **Consequences:** `sheath.mjs` / `fox.mjs` `motion` and `integ.mjs` `wyrmheld` hold the rules (the authored keys
  with '0', the windups +hold with 'a' / 'b', the cues unmoved, the held poses coloured, the feet's jumps <= 0.3 m).
  The paces of those bosses with a motion switch on are a little slower (+0.16 / 0.18 s on each such blow); the
  PACE suites run with the switches off. Shen Hui and Varr Nihil likely have the same foot jump (the same
  `_feetClip`): their kits can pass `animOpts`. Open: the owner's picks; Lu Wusheng's scabbard cuts swing the free
  hand forward in one frame (0.32 m a frame), left for a pass on his arms; the wyrm's tail is a spring and never
  quite still while the body pivots.
- **Outcome (the owner, 2026-11-26, from the films before | a | b at the game camera and a side view):** `a` for
  Lu Wusheng, Wen Yao and the wyrm, and every quick blow: `PICKED` sheathMotion / foxMotion / wyrmMotion /
  sheathQuick / foxQuick / wyrmQuick = 'a'. The seeded fights and pace meters of those suites run with them.
  With them on, the wyrm's seeded fights drifted into latent faults: a drakeling's dive released onto a
  string's blow after its longest hold (fixed on `main` the same day by ADR-237, which this branch takes), and
  the sky hunt's crash landing up to its radius off its ground (fixed here: fireAttacks.js `crash` keeps the
  spot `inReach`). A hit with its own bait hold (the Hesitant Maw's rear bite) is not held again. The clearing's
  burn budget (`TUNING.world.meter.burnt`) 9 -> 12: seed 1337 rolls other moves and burns 11 of 184 pieces.

## ADR-227 — The perfect parry gets the perfect dodge's window: 0.20 s (2026-11-26)

- **Context:** the owner: parrying is very hard and the timing feels too tight; make the parry window like
  the perfect dodge's. Asked which window, they picked the PERFECT parry, 0.08 s → 0.20 s
  (`DEFENSE.perfectDodgeWindow`); the plain parry window (`parryWindow`, 0.22 s) stays.
- **Decision:** `DEFENSE.perfectParryWindow` 0.20. It is the one number every perfect parry reads
  (`player.js` sets `deflect.perfect` from it; the duelists' blade lock, the returned bullets, embers, ki
  bolts, the beam clash, the lantern push, Halcyon's glare and the streak's double pip all read
  `deflect.perfect`), so nothing else changes. The Lab's training card reads the number instead of
  spelling 0.08.
- **What a plain parry is now:** a press 0.20 – 0.22 s before the blow, about one frame at 60 fps. In
  practice every parry is perfect: x 1.5 posture, the counter cut, the gold clash and its short slow
  motion, a `lock` blow locks, a bullet comes back. The plain parry stays in the rules (its window, its
  sound and look, the riposte and the blue flare's counter, which any parry earns) rather than being
  removed: if the owner wants a gap between the two again, it is this one number. A held guard (block)
  is now the only defensive answer short of perfect besides the 0.02 s sliver.
- **Consequences:** parrying is easier by 2.5x of window for every perfect reward; the fights get more
  slow-motion beats (one per parried blow of a string in the default `sharp` look) and more blade locks.
  Tests that check a plain parry press on the one plain frame (13/60 s); bots that play like a player keep
  their 0.12 s press (now perfect) and their expectations moved (posture x 1.5, a lock, Halcyon's fight
  137 - 142 s). The wyrm's PRESSURE measurement keeps the old 0.08 s for its guard bot's stray parries: the
  new path met a brood gap that exists on main (`BROOD.busyWait`), a separate task. Not played by a human yet.

## ADR-237 — A brood cue whose wait ran out still keeps the cue spacing (2026-11-26)
- **Context:** the brood's cues wait for a free slot (`BROOD.hold`: while a cue of the other answer is due
  within 0.5 s, or a red one while bullets fly), but at most `hold.max` 1.8 s, and a drakeling dives anyway
  after `busyWait` 2.5 s on a busy wyrm. On a long busy spell the two ran out together and the cue flashed
  wherever it stood: integ PRESSURE seed 4242 with the 0.20 s perfect parry (ADR-227) met it twice, a dive
  beside a fanVolley ember (P2) and beside the breath (P3), both held 1.82 s. Main had it too; the seeds
  just missed it. Bullets, cueing only `flashLead` ahead, could also flash beside a brood cue after it.
- **Decision:** past `hold.max` the cue goes at the first free slot instead of at once: it holds on while
  a cue of the other answer is due within `BROOD.late.clear` 0.36 s of its impact (the spacing rule's
  0.3 s and a frame; the ledger and the running move's beats; bullets in the air no longer hold it), and
  after `late.drop` 4.5 s held in all it gutters out without its blow rather than cue onto one. Every brood
  flash calls `bullets.bar(tell, flashLead)`, a new track the bullets' `cue()` reads for `CLASH`: a bullet
  of the other answer due within `clashSep` comes as a dud, as an ember beside an orb does. The dive still
  starts after `busyWait` (it is the valve that keeps the brood from waiting out a whole flight); only its
  cue moves. Chosen over routing the dive through the brain's own `_hold`: the brood already reads the
  same ledger, and the brain's hold is for the running move's beats.
- **Consequences:** a brood cue never lands within 0.3 s of a wyrm cue of the other answer, whichever is
  first (scenario BROODBUSY: a 4.3 s busy spell of furnace maws, fan volleys and a breath with three
  drakelings out of time; an endless guard stream that makes one gutter out; a dive going 0.38 s after a
  stream ends; a red flash barring an ember). PRESSURE runs the steady bot with the real parry window again
  (its 0.08 s wrapper from ADR-227 is gone) and passes on all three seeds. A drakeling may now hang above
  the hero up to 4.5 s, or burst harmlessly. Not played by a human yet.

## ADR-236 — No reference-footage animation: the mocap tools removed (2026-11-26)
- **Context:** four tries at animating from the owner's reference films (the `?lights=steel` attacks, Tian
  Lei's blows fitted from a bare-handed film (ADR-208), the refstudy kit, and the hero remade on a
  recorded-clip engine behind `?hero=new`) ended with the owner's verdict on the last: "It looks all meh.
  Scrap everything. Lets not use any of the reference video stuff ... we will just go back to how we made
  animations on our own".
- **Decision:** remove the tooling from `main`: `scripts/mocap/` and `src/entities/hero2/`, the realiser's
  `keysOf` hook (unused), the footage `.gitignore` lines. The remade hero (PR 162) and the refstudy kit with
  `docs/MOTION.md` (PR 148) are closed unmerged. Animation is authored by hand as before.
- **Consequences:** ADR-208's engine is gone (its decision record stays as history). No game behaviour
  changes: nothing in the game read these files.

## ADR-225 — Tian Lei's and Halcyon's motion: held blue / red windups, snap blows, Halcyon a flier (2026-11-26)

- **Context:** the owner asked for every boss's poses, animations and motion to be audited and to look
  accurate, for each blue (parry) and red (perfect-dodge) blow to have a readable held windup pose, and for
  some much faster normal blows that are still fair. This pass covers Tian Lei (`?level=ring`) and Halcyon
  (`?level=city`); other sessions did the other bosses. Measured with `asc.mjs . audit` (ADR-162's) and a new
  `city.mjs . audit` (the same measure for a flier: no frame is left out for being off the ground).
- **What the audit found.** Tian Lei: (1) a blue or red blow had no held pose: its coil was keyed at u 0.7 -
  0.78 of the windup, so through most of the windup he stood in his guard and the striking limb was still
  drifting 8 - 50 cm into the coil when the strike began; (2) Eight Gates' low sweep jolts the knee hardest of
  all his moves (709 mm/frame²) and its planted feet slide ~2 m; (3) a palm thrust on a dash (Piercing Palm,
  Hundred Hands' last) skates across 2 - 3 m in its stance; (4) the cross lands ~1 m to his left of the line
  to the hero and the jab ~0.4 m (the body turns past the target; at the game camera the miss is in depth and
  reads as a blow to the head). Halcyon: (1) his feet sat exactly at his root's height in every punch and
  kick, a planted fighting stance at his 0.5 m hover: he stood on air; (2) every punch landed at 1.9 - 2.0 m,
  over the hero's head (Fly-By's fist at 2.55 m); (3) his elbow was ~130° at every contact (the arm fix
  ADR-162 gave Tian Lei never reached him); (4) the Backhand and the slap land beside the hero.
- **Decision** (behind two live look switches; `0` plays each as before):
  1. `?ascMotion=a` (`ascendant/motion.js`, through the realiser's `keysOf`): every blue and red builder blow
     is in a pose of its own by u 0.36 (`HELD_AT`) and holds it to the cock, tightening a few cm (the striking
     limb drawn further, the weight lower); red holds sink deeper and wider than blue ones. The strike from the
     cock is the beat's own. A normal blow keeps its keys. The shared builders are unchanged (the Fox and Xin
     Yi build with them): their beats only carry a `mo` descriptor (what they were built from).
  2. `?halMotion=a` (`halcyon/motion.js`): those held windups, plus the flier's legs on every builder blow
     (his hover's legs into the coil, both trailing back through the strike; a kick's other leg hangs), the
     blow aimed down (the hand `motion.aim.hand` lower, the body pitched over it) while his root dips from the
     hover to `motion.dip` (0.2 m) through the strike (`flight.js _dip`), and `armSoft` as Tian Lei's.
  3. The snap blows: a white blow from the guard, ~0.3 s windup (`TUNING.snap`, unscaled by form or phase),
     8 - 9 damage, at most a short step in: Snap Jab and Snap Hook (Tian Lei), Flick and Tap (Halcyon). Their
     keys move only the striking arm and the hips (`SNAP_KEYS`), so the rest is the stance he stands in: the
     blow reads from the stance itself. Weighed only with the switch (`weigh`). Tests DATA let a snap's first
     windup sit under `minFirstWindup` when it is white, deals at most `snap.maxDamage` and flashes after its tell.
- **Why this way:** poses only, through the hook ADR-208 left (`keysOf`), keep every timing, tell, zone and test
  of the fight; the switch flips live from the next move, so the owner can compare in one fight. Holding the coil
  instead of lengthening the windup keeps the pace the owner set while making the read earlier. Halcyon's dip
  is the one root change: in reach (the flight rule) and only through a strike.
- **Consequences:** `asc.mjs . heldmotion`: 495 realisations identical on and off; the striking end moves 0 - 7 cm
  through the hold (8 - 50 cm before); 35 blue and red blows reworked. `city.mjs . halmotion`: 216 realisations
  identical; fists at 1.29 - 1.67 m (1.74 - 2.10 before), elbows 148 - 160° (~130°), feet 0.35 - 0.48 m behind his
  hips (a planted stance before). The realiser's `keysOf` hook, removed as unused by ADR-236 while this was
  in review, is back for this use (poses only, no footage).
- **Outcome (the owner, 2026-11-26):** "Ship both (a)" from the before / after films: both switches are the
  default (lookSwitch PICKED), so the snap blows are in both bosses' pools. Not changed (for the owner to choose): the sweep's jolt, the dash thrusts'
  skating, the cross's sideways line, Fly-By's pass height. The holds are short in a string's quick beats
  (0.12 - 0.24 s): `HELD_AT` is the lever.
## ADR-220 — The bosses drawn in the hero's style: his shading and his outline, their own colours (2026-11-26)

**Context.** The owner: everything but the Cinder Wyrm and Wen Yao still does not look like the hero's ASCII.
Beside the hero at the game camera, ADR-194's lift prints a boss's cloth as one even, bright field of dense letters,
inside a 1 px line; the hero runs from a near-black core through grey shoulders to a lit edge and the pale hem,
inside a line two pixels wide at 1440p. A first round (the hero's letter size, his dark cloak values in each boss's
hue, the pale hem up to the thigh, skirts flared and torn) was turned down: "i didnt mean make it the same color or
cloth texture as the main character. i meant the style and engine look ... shen hui i like that his original hat
has its own color and detailed ascii look". Asked which part, the owner picked his shading and his outlines and
rim (not his letter size).

**Decision.** One live switch per boss, duelist/heroPrint.js (`HERO_PRINT` level -> switch, `HERO_STYLE`), read every
frame by main.js: `?ashHero=` `?lordHero=` `?ascHero=` `?sheathHero=` `?halHero=` = `0` as shipped, `a` his shading,
`b` his outline, `c` both.
- **Shading** (`U.uBossHero.x`, materials.js, inside the bosses' print, `#ifndef SG_HERO_SELF`): the boss's cloth /
  hair / plate light (`fillC`, never `artFill`: his colours) is scaled by `mix(0.15, 1, k)`, `k` = the key light's
  cel step x a rise toward his shoulders (0.45 at 0.55 m above his feet to 1 at 1.55 m), never below 1 on the hem
  or from 1.45 m up (his head and hat as they are).
- **Outline** (`uBossLike.z`, pipeline.js `cellMain`): a boss's ink-line step `gLine` = max(his, the hero's
  `uSelfPx`): his silhouette, dotted rim and inner lines at the hero's width, his letters on his own cell. On a
  boss whose letters follow his size (Tian Lei, Halcyon) it already is: b changes nothing there.
- **Picks:** c for Shen Hui, Varr Nihil and Lu Wusheng; a for Tian Lei and Halcyon (lookSwitch PICKED; Lab LOOKS
  rows, live). `?looks=old` draws `0`.

**Not changed.** Colours, outfits, letter cells, the hem, the face: ADR-194's print. The wyrm, Wen Yao and Xin Yi
have no switch. Turned down and removed: the dark cloak values, the tall hem, the flared and torn skirts.

**Cost.** A few ALU per boss fragment and a wider tap step for his lines; no texture, pass, draw call or geometry.

## ADR-226 — The sword duelists' motion pass: the sword in the hand, held tell poses, quick blows (2026-11-26)

- **Context:** the owner: Shen Hui's and Varr Nihil's positioning angles look weird and their weapons are held
  awkwardly; every blue and red blow should have its own readable held windup pose; and some much faster normal
  blows ("instant attacks": short windups, read from the stance). The hero's stance and swings were rebuilt from the
  owner's reference footage (ADR-207, ADR-214): the bar a straight sword is held to. Measured first (a new audit,
  `tests/integration/swordAudit.mjs`, opt-in `audit` in `duel.mjs` / `lord.mjs`: every move once, joints in his own
  frame): the blade is keyed on its own and the hand follows a circle round the shoulder, so the angle between the
  forearm and the blade averaged 45° (Shen Hui) / 64° (Varr Nihil) and reached the animator's fold limit, 128°
  (`WRIST_BACK`): the fist turned off the wrist (the hero holds his ≤ 60°). Varr Nihil's form-1 guard sat at 75 - 110°
  all the time, his staff and form 4 at 90 - 128°. The blade passed through their heads in overheads (Shen Hui: Crane,
  Heaven-Splitting Fall, the leaping string, Kick Brand; Varr Nihil: Falling Star, Lightning Verse, Cyclone, Grinding
  Wheel, Thunder Verse); the elbows never opened past 131 - 145° (the bosses' soft reach); Varr Nihil's end-of-string
  roll of the blade round the wrist stopped with a jolt of 1.0 - 2.5 m a frame² at the point, the largest in either
  boss. At the blow itself his chest was square to the hero (within ~20°), so the facing at an impact is not the fault.
- **Decision** (`?ashMotion` / `?lordMotion`, `duelist/lookSwitch.js`, Lab LOOKS rows; 'a' the owner's pick and the
  default since 2026-11-26, from the before / after films: "i like the new timings and changes"; '0' as before):
  - **The grip**: `HeroAnimator.gripMax` (rad; 0 = off, the hero and every other boss): after the sword arm's solve, a
    forearm more than gripMax off the blade's line turns toward it round the elbow (`_gripAlign`), the hand going with
    it, the elbow where the arm put it, folded no tighter than 38°. The blade's direction, its path and every zone are
    untouched: only where the hand holds it. `TUNING.motion.gripMax` 0.7 (~40°) and `armSoft` [0.9, 0.985] (the arms
    open at the end of a blow, as the hero's), read every frame through `kit.motion()` (duelist.js).
  - **The held tell poses** (`duelist/tellPose.js`): every blue or red BLADE blow (not a feint, a cast, a thrown or
    released thing, a somersault or a cartwheel; and Piercing Ash, which the owner kept as it was: "the old animation of
    thrusting the sword instead of bending it") gets `motionKeys`, its keys with a family pose reached at 0.36 of the
    windup (before the flare) and held to 0.8, the strike from there. Two silhouettes to learn, one per answer: blue
    **high** (the blade raised over the sword shoulder, point to the sky, tall on the legs, the free hand out at the
    foe) or **aim** for a thrust (drawn back level by the cheek, the point on the foe); red **coil** (sunk low and
    coiled away, the blade trailing low behind the hip near the floor, the free hand reaching). Played through the
    realiser's `keysOf`: the windups, impacts and ends are the same to the frame on and off.
  - **Varr Nihil's string ends**: `motionRecovery` (the realiser's new `recoveryKeysOf`): the steel shaken off down and
    out and held a beat (both blades in form 2, the staff swept level in form 3; form 4's was already a shake)
    instead of the roll round the wrist.
  - **Quick blows** (`quick` beats, `motionOnly` moves: his `weigh` gives them 0 with the switch off): a normal tell,
    a fixed windup of `TUNING.minQuickWindup` (Shen Hui 0.34 s, Varr Nihil 0.30 s; their openers today 0.42 - 0.6 s),
    each glint 0.04 s into it, thrown from the guard with no draw: Shen Hui's Darting Needle (the jian already
    pointed at the foe, a hand's width back and in) and Flicking Willow (the point flicks up and cuts down across);
    Varr Nihil's Rising Ember (forms 1 - 3, up from the blade hung low at his side) and Vigil's Fall (form 4, down from
    the blade upright before his face). The data rule: a quick blow is a normal one and its windup ≥ minQuickWindup
    (the 0.42 / 0.40 s floor stays for every other first blow). Each links into a string.
- **Why a solver and families, not hand keys**: hand-invented arm choreography failed with this owner again and
  again (stiff sword arms, flailing hands); here the arm is measured into line with the steel the moves already
  swing, and the tell is one learnable silhouette per answer rather than forty separate poses.
- **Consequences** (the audit, switch on): Shen Hui, all 38 moves: the wrist at most 60° (before 58 - 128), the blade
  ≥ 18 cm from his head and 21 cm from his body (before 0), elbows open to 150 - 167°. Varr Nihil, 62 moves: wrist
  ≤ 60° in all but one spell pose (91°, Starless Night's cast), blade ≥ 7 cm from his head (before through it in five
  moves), the worst jolt in a move 776 → 449 mm a frame² on average, the roll's jolts gone. The pace meters (`duel.mjs`
  / `lord.mjs . pace`) pass on and off. Test `swordmotion` in both suites (on and off). Open: the feet still slide a
  little where a planted foot is handed to the clip (another session's `kit.animOpts.liftEase` may serve), the
  crossing legs inside spins and sweeps; a heavy thrust landed on Shen Hui inside Falling Ash's held raised blade
  makes the hit reaction jump 0.077 m in a frame (0.055 over the old pose; `duel.mjs . react` measures the layer
  with the switch off). A held pose's strike keeps the hand as the strike holds it (keyed or blade-driven), and a
  counter out of his guard gets no held pose.
## ADR-221 — Xin Yi rebuilt: printed like the hero on a man's build; held windups, a true aim, fast strings (2026-11-26)

- **Context:** the owner: "the neo boss anatomy and attacks are all weird too ... fix the neo character details
  because right now its a mess and can't tell if its a human". Filmed at the game camera (x4 crops beside the hero,
  three sides, every phase) and without letters from four sides, and measured with his motion audit and an aim
  probe: (1) his print was a bright jade OUTLINE round a near-black fill, the bosses' print (ADR-194) lifting his
  near-grey fill to ~3x the hero's coat, so at 36 m he read as a hollow, high-contrast bottle; (2) the build was a
  bottle: narrow shoulders and a skirt flaring from the chest to a hem wider than them (cone 0.25), the waist and
  legs gone; (3) a head of about three letters with nothing of a face from above; (4) the one-gun aim (yaw -0.9,
  the hand ahead of the chest) pointed the arm 36 degrees off the hero, the forearm across his face; bolts 19 and
  the point-blank shot 25 off; (5) no blue / red blow had a pose of its own: every windup drifted into its coil;
  (6) his fastest normal blows sat at 0.32 - 0.34 s inside strings, nothing quick out of his guard.
- **Decision:** two switches, each awaiting the owner's pick (PENDING; default '0' = as shipped):
  - `?oneBody=a|b|c` (gear.js CUT / look.js BODY_INK): printed the hero's way (HERO_INK's cloth rules in his
    jade-grey: the dim DOTTED rim, no ink over 1.5, far fills at ~0.6 of the hero's so the lift lands near the
    hero's brightness) on a man's build (broader, squarer shoulders and a deeper chest under the coat, a belt at the
    waist, fuller swept-back hair, a lower collar) and a coat that hangs near straight (panelSkirt's new per-panel
    `cone`, 0.1 for his panels; the hero's 0.25 unchanged). a the long coat closed in phase 1, b open in every
    phase (the legs walk in the split), c a duster to mid-shin with the hero's pale hem.
  - `?oneMoves=a` (moves.js MOVES_A, read live per realise): the one-gun aim side-on (AIM_SIDE: the right shoulder
    toward the hero, the arm straight down the line, 2 - 11 degrees off); every blue / red / black blow HOLDS its coil
    (heldTell: the coil reached in 0.75 of its draw, held to 0.84 of the windup at most, the strike keeping 0.7 of
    its time) with the windup, the cue and the impact where they were; two fast white strings, Snapping Hands and
    Quick Foot (0.42 s, then 0.28 s, unscaled by the phase: the floors of his own rules, a glint after its tell and
    impacts 0.36 s apart), never picked on '0' (wokenOne.weigh).
- **Consequences:** the timing of every move is unchanged on the rebuild (the `rebuild` test compares 98
  realisations). The motion audit: the worst jolt 1035 -> 985 mm/f2 (the sweep 872 -> 499 - 819, its tuck's knee
  pop is Tian Lei's builder and pre-existing); the spin kicks' windups jolt ~25 % more (the turn into the held coil
  is quicker). His blows are Tian Lei's builders (ascendant/moves.js X): a change there changes him on both switches.
  Not done: the left hand behind his back in phase 1 (the homage's) still reads one-armed at the game camera from
  some sides; the sweep's tuck.
- **The owner's answer (2026-11-26):** "lets do open coat" (`oneBody: 'b'` in PICKED), and: the kicks "too stiff
  ... should be a straight line when his kick is out" (not a triangle at the knee); the coat's bottom not like the
  hero's cloak, "one big coat put together", no layers; the punches and acrobatics natural. So:
  - **One coat** (gear.js `COAT_MAN`, look.js): five panels overlapping all round, one back panel (no vent), the
    side panels a few mm outside (no flicker), a straight hem (panelSkirt's per-panel `jag` 0), its inside the same
    cloth, and the coat printed as part 5, which the bosses' print never breaks into the hero's pale hem; it swings
    30 degrees out at most (`COAT_SWING_ONE`), so in his flips it no longer fans into boards.
  - **Straight kicks**: anim.js `kickStretch` (a lifted foot asked for far from the hip is carried out along its
    line, continuous in the distance), `legSoftA` [0.95, 0.998], and each kick's contact key (moves.js `longLeg`,
    `T.legReach` 1.05 x the leg from its hip, along the floor for the sweep's whole turn). Knees at contact
    100 - 157 -> 166 - 173 degrees (the sweep 78 -> 118 - 156). The butterflies carry him 0.7 m less (`travelCut`: their
    feet ended 0.3 m inside the hero).
  - **Long punches**: `armSoftA` [0.95, 0.996] and the straight blows' (jab, cross, palm, double, backfist) hit key
    1.16 x further from the shoulder (`longArm`): elbows at contact ~150 -> ~169 degrees.
  - The cost: the legs travel further back from a straight kick: the spin kick that follows one jolts ~40 - 60 %
    more (lesson 336 -> 530 mm/f2), within the audit's range (the sweep's 870, pre-existing).
  - The owner, after the film: "Yes, make default": `oneMoves: 'a'` in PICKED (`?oneMoves=0` the moves he shipped with).
  - Found by the Training catalogue (Two Thunders, send one back): from the side-on aim's forward hand a heavy shot at
    6 m flew 0.216 s and was cued a frame short of the 0.2 s its own rule asks, so it fizzled. A cued shot now flies
    at most so fast that it takes `TUNING.shotCue` 0.26 s from the gun (iron.js `_fire`; 23 m/s at 6 m, the old 24
    from ~6.6 m out; a burst's quiet slug unchanged). MOTIONFIX keeps the shipped moves at 480 mm/f2 and holds the
    rebuild to 700 (its spin kick after a straight kick: 657).
## ADR-241 — Bai Wuji, the Untouched: a barrier opened by perfect answers, weight on every blow, the domain broken or caught, moves routed to three handlers (2026-11-26)

- **Context:** the owner asked for a white-haired, blindfolded sorcerer after a famous character (the reference;
  ADR-160's line holds: his names, the series' and its techniques' appear nowhere), "very hard in terms of skill
  level", blows that throw the hero, "pretty much forcing the player to parry/dodge everything", the terrain part
  of the fight. Their four answers: a ruined city crossing; the blade stops short of him and a perfect parry or a
  perfect dodge opens him; a block holds, costs no health, throws the hero back and takes a big share of the guard,
  and his spells cannot be blocked; at the last phase a closing sphere to perfect-dodge through, or be held and
  struck once, then the last phase inside the void. One boss with melee, spells and terrain was too much for one
  agent: it was to be built by six side by side.
- **Decision:** a duelist on the shared engine (`entities/enemies/untouched/`, kit `untouched`, every new field
  `wj*`), one bar, three phases (66 % THE BLINDFOLD COMES OFF, 30 % THE MEASURELESS).
  1. THE ROUTING CONTRACT (the head of `untouched.js`): the rules are objects on the actor (`d.barrier`,
     `d.pull`, `d.domain`, `d.fx`) and the moves live in three files (`moves/melee.js`, `moves/spells.js`,
     `moves/terrain.js`) merged by `moves.js`. Each file exports `FIELDS` (the beat fields it owns) and
     `create(d)` (its handler); a beat goes to the handler whose `FIELDS` name one of its fields, a move to every
     handler one of its beats goes to; the hooks (`beatMotion`, `onImpact`, `hitPlayer`, `onHit`, `onParried`,
     `reach`, `weigh`, `onActStart`, `frame`, `afterPose`, `stop`, `reset`) are called through `?.`. Poses the
     same way (`ml` / `sp` / `tr` clip prefixes). No agent edited another's file.
  2. THE BARRIER (`barrier.js`): while up his hurt spheres grow by 0.14 m and the hero's blade stops there (no
     health, no posture; a short bounce he may cancel); `exact` hits pass. It opens on a perfect parry or a perfect
     dodge of any blow (4.0 / 3.2 / 2.6 s by phase), on a flash counter, on a posture break, and by cracks (the
     lead's addition: `cracks` ordinary parries open it for 2.4 / 2.0 / 1.6 s; 0 turns it off). Two strikes on
     the shell in a row bring his counter.
  3. WEIGHT: every landed blow throws (2.5 - 12 m); a blocked one slides the hero (`blockPush`, 3.4 m by
     default) and costs a share of the guard (`guardCost`: the third block in a row opens it); a throw of 3 m or
     more goes through the pieces behind him (`wjCrash`: a `world.impact` each, a little damage, never the last
     HP). His spells are never blocked: red ones are rolled, the thrown pieces and the Yank's fist are blue; a held guard is opened (`breaksGuard`), never
     paid in health.
  4. THE DOMAIN (`domain.js`): the hand sign (a feint), then a red ring over the arena; the engine's own answer
     decides: a perfect dodge ESCAPES (inside unharmed, the barrier open twice phase 3's time), anything else is
     CAUGHT (`Player.hold` 0.95 s, one blow of 30 % of max health inside it, never lethal). Either way the scene is
     the void; his death breaks it and the crossing comes back as it was left.
  5. MERCY: no blow, spell or falling piece on a hero who is down; a beat that would keep him out of his own hands
     past 1.2 s in a row becomes a silent feint (`TUNING.melee.mercy.lockCap`); `Player.hold` is capped at 1.2 s.
     Tells no lower than Tian Lei's (`flashLead` 0.26, `minFirstWindup` 0.40, `minHitGap` 0.34; the suite's DATA
     asserts it); the engine's fairness guard, cue ledger and pursuit stay on.
- **Consequences:** a hero who only blocks loses, and so does one who never attacks (his patience, ADR-243). Six agents built it with
  no conflict inside his folder; the merges met only in shared files (`player.js`, `destructibles.js`, `scars.js`).
  Looks behind `?wjLook`, `?wjHair`, `?wjCity`, `?wjVoid`, `?wjShell`, `?wjNull`, the owner's picks in `PICKED`
  (sheets in `docs/looks/veil/`). Events `dragon:barrier`, `dragon:domain`; his sounds ride `dragon:spell
  { name: 'wj...' }`. No reward yet (the owner has not chosen one). The hero's own knockdown (1.3 s, the
  engine's) is longer than the cap his blows keep.

## ADR-242 — Pieces a boss throws can land on the floor; a held piece can be cut; Halcyon's throws land on the road (2026-11-26)

- **Context:** Bai Wuji throws raised pieces (a tower's top, the void's floating slabs). `throwTo` landed a piece
  at its own base height, so a tower top burst about 6 m up in the air (Halcyon's Falling Sky did the same, 6.5
  m). A held piece was out of every blow's reach, so a car hanging over the hero could not be cut.
- **Decision:** `destructibles.throwTo(b, tx, tz, { ground: true })` and `drop(b, { ground: true })`: a raised
  piece (`y0 > 0`) travels down and lands on the floor (its pivot `y0` down); absent, as before.
  `take(b, { chip: true })`: while held, the hero's blade bites it where it passes (the bite taken back to its rest
  frame through the carry's pivot); a cut that would leave it under 1 hp breaks it: let go where it hangs, it
  bursts where it lands. Halcyon's `_throw` (`halcyon/terrain.js`) passes `ground: true`: the owner's word,
  2026-11-25 ("yes, Halcyon too").
- **Consequences:** every option is opt-in: the other bosses' throws and holds are as they were. On the Crossing
  the fallen tower's sections are liftable (`lift` 2) and a felled section leaves a 0.42 m spill, so the Null's
  bore reads as a gap. Tests: veil `down` (a raised tower top comes down to the floor and lands there), `heldbreak`, `orbit` (a held
  piece chipped by a cut it can take).

## ADR-243 — Bai Wuji tuned on a bench of mortal bots, the third block opens the guard, his patience; floor marks thinned per level and hidden in the void; the bonfire out in the void (2026-11-26)

- **Context:** "very hard", fairly: the god-mode fencing bot of the other suites says nothing about how hard a
  fight is. Before the pass a bot that rolled every red and blocked the rest beat him 6 of 6 and the perfect
  answerer won in 176 - 186 s. On the Crossing's black asphalt a whole fight of grit and rubble read as snow
  (3577 of 3600 mark glyphs), the metal wrecks' rubble lay as orange embers, the city's marks showed in the
  void, and the bonfire burned inside it. After round one the owner answered five questions: "3 blocks" (the
  third block in a row opens the guard, not the second); a defender who never attacks must NOT outlast him
  (round one's pace bot lived in every seed); the roller lasting ten minutes was "hard enough"; Halcyon Plaza's
  metal rubble grey "if it looks better grey then yes"; the bonfire goes out in the void: yes.
- **Decision:**
  1. THE BENCH (`tests/integration/bench.mjs`; opt-in scenario `bench` in `veil.mjs`, `city.mjs`, `asc.mjs`):
     five mortal bots (god mode off), whole fights, any duelist: `perfect` (the ceiling), `fencing` (answers 90 %
     of his cues), `roller` (perfect-dodges reds, guards the rest), `blocker`, `pace` (never attacks). Env
     `GCD_BSEEDS`, `GCD_BBOTS`, `GCD_BSECS`, `GCD_BSKILL`, `GCD_BMOVES`, `GCD_BFORM=n` (start and stay in phase
     n), `GCD_BHIT=1` (each hit and the cues before it), `GCD_BTOUCH=1` (what reached him). Reported, not
     asserted. Round two's fix: a bot stays busy until 0.25 s after each answered impact (the perfect bot had cut
     0.07 s after a roll, which turned it into the roll attack and dropped its i-frames: the bot's error).
  2. TARGETS AND NUMBERS: the perfect bot wins in about four minutes untouched; the fencing bot wins some; the
     blocker and the pure defender die. `hp` 20000 -> 26000; `wjBarrier.cracks` 3 -> 4 (the fencing bot opened
     him mostly by cracks); `wjWeight.guardCost` 0.4 -> 0.45 (two blocks in a row leave 10 of the meter, the third
     opens it; it holds for blocks up to about 1 s apart, at 1.3 s the regen puts back 27 between); a block still
     costs no health. The Wrecking Knot strikes only from its impact to +0.15 s (it met the hero before its cue or
     after a perfect roll's i-frames: 46 damage to the perfect bot on one seed). `blockPush` 3.4 -> 2.4 would
     give the roller 4 of 6: measured, not shipped.
  3. PATIENCE (`untouched/patience.js`, `TUNING.wjPatience { after: 30, cue: 1.2, guardCost: 1 }`): if no cut has
     reached him for 30 s (landed, stopped on the shell, or the flurry: `takeHit` calls `patience.touch()`), while
     the fight is on and he is himself, he stops waiting: one cue (his eyes burn 1.2 s through `fx.eyes`, through
     the band in phase 1 too, and the unveiling's sound `dragon:spell` 'wjUnveil'; no new event); until a cut
     reaches him again every blocked blow costs the whole meter (`_weighted`): one block opens the guard. Every
     blow still told, the 1.2 s lock cap and nothing on a downed hero hold. Why the pace bot lived: it never
     damaged him (phase 1 forever); the guard opened ~100 times in 9 minutes, but the blow that emptied it was
     itself blocked and his next came after the 0.55 s opening, mercy spared 1 - 11, and its early rolls
     i-framed every red. Tried: no patience, alive 6 of 6; a one-block cost after 20 s, dead in 102 - 383 s; after
     30 s (chosen) 201 - 525 s; after 40 s 83 - 518 s; a two-block cost (0.7) alive.
  4. FLOOR MARKS: `SCAR.thin[levelId] = { grit, rubble, ground, cool }` (breakTuning): a level keeps that share
     of the grit, the rubble and the crack spokes (the veil 0.35 / 0.25 / 0.4); `cool`: a material whose rubble
     ends in an ember's colour (metal) lies cold grey. Halcyon Plaza: `city { 1, 1, 1, cool: true }` (the lead
     judged from a side-by-side sheet that grey looks better: the orange read as embers that never go out and
     clashed with the plaza's blue). `?coolRubble=0|1` overrides `cool` on any level. `scars.layer` (the tag new
     marks carry: the set's scene) and `scars.shade(x, z, r, hide, except)` (marks hidden or shown in place, no
     rebuild): the city's marks hide as the front to the void passes and come back on the return.
  5. THE BONFIRE: `atmosphere.bonfireLit` / `setBonfireLit(lit)`: the Crossing's scenes put it out as the front
     into the void passes it and light it as the front back passes; a reset relights it. Its flame, embers,
     light and sound (`audio/ambience.js`) follow the flag; the living world's creatures read it too.
- **Consequences** (round two's bench: 6 seeds, 600 s cap; wins of 6): perfect 6, 229 - 241 s, no hit taken;
  fencing 2 (264 - 290 s), 4 dead (since ADR-227 its 0.12 s parries are all perfect); roller 6, 374 - 427 s
  (easier through the third-block rule, not through patience: at 0.5 it won none); blocker dead at 89 s mean;
  pace dead in all six, 203 - 488 s (mean 302). Round one's bench, Halcyon: perfect 133 - 155 s, fencing 6,
  roller 3, blocker dead at 309 s, pace dead at 422 s; Tian Lei: perfect 42 - 60 s, fencing 6, roller 6, blocker
  dead at 78 s, pace alive. A hero who fights never meets his patience. The fencing bot's 2 of 6 moves with the
  seeds; the real renderer lays ~30 % more marks than headless. Tests: veil `patience`, `bonfire`; the suite's
  ordinary parry is pressed 0.25 s ahead (registering 0.20 - 0.22 s before the impact: ADR-227's 0.20 s perfect
  window).

## ADR-240 — Instant slash lines on every attack; the free hand's look to pick, behind `?offhand=` (2026-11-26)

- **Context:** after five rounds of new light combos (ADR-188's weight pass, the instant cuts ADR-233, the steel
  set ADR-234, four instant-cut combos ADR-235) and a joint-posed arm (PR #166), the owner: "lets just do this.
  use the current production auto attack combo and remove the curvy slashes with the instant slashes and make
  the left hand look more natural and not stand out so much as it looks unnatural and off. scrap all the new
  stuff." Asked, they chose: the straight slash on every attack and the flurry; two or three left-hand options
  filmed to pick from; PRs #118 and #166 closed; a held PR with a preview first.
- **Decision:** production's attacks and their motion stay. (1) `slashFx.js`: the instant cuts' straight line
  (their `blinkFx.js` drawing), driven by what every attack is instead of per-clip data: the chord of the
  blade's drawn point over the active window (from the frame before it opens to its last frame), carried on
  past both ends, kept off the floor and under a ceiling; a turning look (`spin`) three chords round him; a
  thrust a streak off the point; a heavy def the thicker violet look with a small camera kick. The crescent
  (`fx.trail`) is not drawn behind it, the plunge's dive keeps only its straight streak, the flurry's swept
  finisher draws its chord. `?slash=arc` gives the crescent back. (2) `offHand.js`: three looks for the free
  hand in a one-handed swing (any clip that never keys `two`), each a rest the body carries with a damped
  pendulum on it (the instant cuts' `side` hand, ported): `side` loose beside the left thigh (what the owner
  described on 2026-11-25), `back` on the small of his back, `quiet` production's gestures pulled to a third of
  their reach from a rest at his side. The default stays production's hand until the owner picks.
- **Consequences:** the glint on the arc's edge stays. Hit test, timing, damage and reach are untouched (the
  line is drawn from the drawn blade, the hit is the swept blade). The pose has one more channel (`P.sd`, `N`
  62). After the pick: the picked hand becomes the default and the other looks go; PRs #118 / #166 stay closed
  (their branches remain on GitHub for reference).
- **Round 2 (same day):** the owner: "the slashes that come out look out of place and a bit lagged. it should
  show as soon as the animation swing ends to match with the swing. also make variations of different combos and
  left hand ... same with the heavy attack on the lagginess and attack variation"; asked, they chose the feel of
  today's moves, three variations, each with its own hand, the heavies faster and weightier. (1) The line is
  drawn on the first frame the blade's point slows under 0.8 of its fastest step (the fastest from the active window
  on; `slashFx.js` SWING), from where the point was as the fast stretch began; it was drawn at the end of the
  active window from the frame before it (the follow-through ran on, so it came late and long). (2)
  `feel.js` (`?feel=snap|weight|flow`): production's clips on another clock inside the same phases (a curve
  per phase), the keyed sink, turn and lean scaled and the body's lead stretched, each with its own hand
  (`?offhand=auto`, the default, wears it: snap back, weight side, flow quiet). Every light hit and heavy
  branch still lands in its active frames (scenario `feel`).
- **Round 3 (same day):** "I didn't mean the instant slash is showing the sword swing, it should show at the end
  like an ending slash feel. If we need to make new animations and swings to make the new instant slash effect
  look good then do it and make 4 new light attack combos"; asked, they wanted all three places and both timings
  shown, and the combos' timing may change. (1) The ending slash (`slashFx.js` `END`, `setPlace` / `setBeat`,
  `?endslash=target|body|enemy|blade`, `?endbeat=beat|0`): the cut's angle from the swing as before, drawn as a
  fixed-length line at a place (default `target`: 1.9 m ahead of him at the cut's height) a beat (0.12 s) after
  the swing has ended. (2) `combos.js` (`?combo=a|b|c|d`): four five-hit combos from production's own swings in a
  new order and on their own timings (a finisher that is not the slam: `kind: 'light', heavy: true`), each with a
  feel and a hand (`feel.js` `setFeelHand`). Damage, posture and reach stay; '0' restores production's defs
  exactly (scenario `combos`). No new swings were keyed: production's are the natural ones the owner kept; a
  combo they like may want one, next.
- **Round 4 (same day):** the owner picked combo A with the slash on the enemy ("lets use this as the
  baseline"), saw "a spark of yellow" (the left hand clipping) and found the slashes still not following the
  swing ("the heavy slash cut to be the opposite ... from top right to bottom left to follow the motion of the
  sword"). Found and fixed: (1) the free hand behind his back slipped in and out through the coat's back panels
  (its bare hand flashing): while a look holds it (`P.sd`) the free wrist joins the coat's sheet test with the
  grip and the blade (anim.js `_bladePts`, `BLADE_PTS[13]`), so the cloth keeps to one side of it. (2) The line
  was decided at the contact: the hit-pause and the bite slow the blade for a few frames and read as the
  swing's end, so the finisher's line came from its raise alone (upward). The end now waits out the bite
  (`SWING.bite`); the direction is the blade's motion near the hand ACROSS THE SCREEN through the camera's own
  projection, each frame's step weighted by its speed² (a chop running away from the camera moves down the
  picture; laid in the screen's plane by its depth it pointed up); the line is laid in the screen's plane and
  drawn in three pieces a frame apart from the swing's start side (`END.reveal`). Measured on every light hit
  and heavy branch: each line's on-screen direction now has its blade's. (3) The baseline is the default:
  `?endslash=enemy`, `?endbeat=0`; combo A in the game (`DEFAULT_COMBO`; the headless sims keep production's
  defs, which their checks are written for; `?combo=0` plays production's).

## ADR-245 — The living world's fast path: the same picture for less (`?lifeFast=`) (2026-11-26)

- **Context:** the owner: "i feel like the ascii atmosphere effects is causing a lot of performance issues. is
  there a way we can improve the performance while still making it look as good and alive?" (target: 60 fps
  on every device; their iPhone and their integrated-graphics laptop are GPU-bound). Measured on origin/main
  in fights on five levels (RTX 4090 / i9, the machine shared): the living world's own letters are nearly free
  on the GPU (about 0.02 - 0.04 ms of the effects pass at the phone's size; hiding them all moved the frame
  within the noise). What did cost: the dragon-printed ground's step flash walked 12 prints with a `cos` and a
  `sin` each on EVERY pixel while any print lived, and the grass wake walked its chunk circles on every pixel
  (together 9 - 21 % of the ground pass at 4K); and every batch re-uploaded its whole instance arrays each
  frame (62 KB to draw 77 mist letters; 115 - 231 KB a frame in all), with empty batches still drawn. The
  life update itself is 0.06 - 0.34 ms of CPU at 1x (1 - 3 ms at a 4 - 6x throttle), spread thinly over litter,
  creatures, weather and wind.
- **Decision:** a fast path, on by default, `?lifeFast=0` today's paths: the batches send only the first n
  instances they draw and an empty one leaves the frame (`life/ship.js`); the step flash and the wake return at
  once outside one circle round all of their prints / chunks, and skip a print out of a foot's reach before
  its trigonometry. BENCH (`?perf`) gains a living-world reading so the phone can report its share.
- **Why this way:** each change leaves the picture identical (frozen frames: 0 of 2 073 600 pixels differ on
  fox, grove, code and ash, 3 px at 1 level on cinderwood, the same as drawing twice; 8 s films drawn both ways
  from one simulation: within the game's own draw-twice noise), so no look had to be chosen. In one page, fast
  against today: the ground pass 0.83 - 0.89 of before with prints live; the effects pass's render CPU and
  buffer uploads 0.7 - 0.97.
- **Not taken:** tighter quads for the leaf lens (saved nothing measurable: that draw is overhead-bound, and it
  moved ~1 000 pixels); thinning the letters on a struggling phone (they are almost free, so it would buy
  nothing); moving the wisps' and mist's motion into the vertex shader (a large rewrite, not pixel-exact, for a
  CPU share of 0.01 - 0.04 ms a layer).
- **Consequences / open:** the wind in the trees' vertex shaders (889k vertices on cinderwood) could not be
  measured cleanly on the shared GPU; the lamps keep the fire field running on fox and grove (the look); none of
  it is measured on a phone: the owner's BENCH "living world" line will say.
## ADR-246 — The flash chain: three flash counters in a row, he strikes back after each (2026-11-26)
- **Context:** research into the combat of three sword games (Sekiro; Phantom Blade Zero; Onimusha: Way of the
  Sword) found that this game already has most of their core (posture and deathblows, the mikiri, blade locks, the
  flash counter, blue / red / black tells). One thing it lacked was the counter-kill CHAIN: a re-timed counter
  after each counter, a beat-by-beat exchange that escalates. Of five proposals the owner chose it first, and picked:
  he strikes back after each counter; 3 links with rising damage; the same window every link; the
  choose-where-to-cut finisher later. They asked to see today's flash counter and the new one side by side on film.
- **Decision:** built behind a switch and filmed on all eight duelists, today's flash counter beside the chain;
  the owner picked "strikes back", so the chain is the game's default (`?counter=0` / the Lab's `counter` row:
  old gives the single counter; the headless sims keep the single counter their checks are written for, duel
  FLASHCHAIN plays the chain). A flash counter before the last
  link throws the duelist back (`clash`) and queues his counter move (the riposte the engine already throws out of a
  guard), tagged with the link (`act.flashLink`); a flash counter of that move is the next link. The last link is
  today's flash counter ending (reel, cinematic, crit window). Numbers in `DEFENSE.counterChain`: 70 / 85 / 100
  damage, 45 / 55 / 70 posture, rising freeze, shake, punch; the steel's ring rises in pitch per link.
- **Why the strike-back is the counter move:** every duelist already has one per phase, built and tuned, and every
  one opens on a melee blow a cut can meet (checked for all eight; Tian Lei's form-3 bolt is the one exception, where
  the chain simply stops). No new boss animation was needed for the prototype.
- **Consequences:** a single flash counter under the chain pays less at once than today (no reel, no crit window)
  and more over the chain (255 damage and 170 posture for three, usually a posture break). `player:counter` gains
  `link`, `links`, `last`.
## ADR-248 — Tian Lei audited: straight limbs, a readable pace, a sun for his ki blasts (2026-11-26)
- **Context:** the owner's motion audit of every boss (2026-11-26: "weird looking arm angles ... kicks aren't
  straight during the attack and still bended ... make sure all their attacks have clear tells ... make all the
  special moves and effects very cool"), one session per fighter, by hand from `docs/ANIMATION.md` (no footage:
  ADR-236). Tian Lei measured on the rig (asc.mjs AUDIT, the striking limb's joint at contact added): every
  straight punch landed with the elbow at 141 - 155° and its fist 0.17 - 0.24 m ACROSS his centre line (the
  cross's "sideways line"); the back-fist 0.6 m off to his right, short of the hero; every roundhouse with the knee
  at ~100°, the front and side kicks at ~150°; the sweep's tuck folded the leg so tight (the foot ~15 cm from the
  hip) that its knee flipped twice (709 mm/f²), its planted foot stood 0.16 m off his pivot and circled a metre of
  floor as he spun, and the close-in slid the root 0.5 m under him through the drop (the planted knee flipped
  again, 869). His pace sat under COMBAT rule 10: a move's first blow 0.4 - 0.5 s, string blows 0.37 - 0.46 s
  apart, the cue 0.26 s before the impact.
- **Decision (three switches; the owner picks from the films):**
  1. `?ascMotion=b` (on top of ADR-225's `a`; `ascendant/motion.js` straightLimbs, his realiser's `keysOf`): a
     straight blow's contact key aims the hand on the line from its shoulder to his centre line, `armReach` x the
     arm out; a kick's puts the foot `legReach` x the leg from its hip; the animator opens the arms and legs
     further and carries a kick's foot out (Xin Yi's ADR-221 kit: `armSoft`, `legSoft`, `kickStretch`, set live
     in ascendant.js). The sweep's windup is a DROP STANCE (sunk on the planted leg, the sweeping leg slid out
     long, wound back), the planted foot at his pivot, the sweeping knee's pole up, and the close-in done by u 0.4
     (`closeBy`, a new opt-in beat field of the duelist brain: a number or a function read live; no other boss
     sets it, so nothing else moves). Hooks, uppercuts, hammers, elbows, knees and the shoulder keep their bend.
     Timings identical to `a`. Measured: punches 170 - 172°, kicks 172 - 173°, the fists within 0.1 m of his
     centre line, Eight Gates' worst jolt 455.
  2. `?ascPace=a` (`ascendant/pace.js`): rule 10's floor, the time added as a held cock (the realiser's `hold`
     hook): a move's first blow >= 0.7 s x the form's windupScale, later blows >= 0.45 s apart (feints count),
     the cue 0.35 s before each impact; a hold never under 0.08 s. Exempt: the snap blows (ADR-225), his
     counters and flurries (the flash chain's answers), hazards, floor pieces, the transformations; a ki beat
     keeps its windup and cue; a blow he dashes in for keeps its windup (a hold inside the run slowed the dash:
     a sprinting hero got away), its cue paced. (The exemptions as the Starless Lord's ADR-251 refined them.)
  3. `?ascShot=a|b` (`ascendant/fxShot.js`): his ki blast (every blast he throws, not Heaven's Lantern) redrawn in
     the Fox's and Bai Wuji's idiom: a THE SUN (a white heart, gold turning round it, a spinning torn ring, the
     air drawn in on spirals, a pool on the floor under it, a two-strand wake; a burst that folds in and breaks
     with a ball front, a floor ring, dust and letters); b THE COMET (a white-hot head on a teardrop, a tail of
     tiny letters left hanging on the wind, a lit streak on the floor, grit kicked up; a splash forward that
     scores the floor). The world's share of a burst (scorch, impact) as today's.
- **Why these and not more:** the owner's words were limbs, tells and effects; the stance, the guard, the
  transformations and his look are theirs from earlier picks and were left. The pace is a gameplay change, so it
  is its own switch, not folded into the motion. Effects: the blast is what he throws most (Spirit Shot, the
  scatter, Blast Dance, Golden Rain, Sky Volley, Raining Suns); the beam and the orb already went through option
  sheets (ADR-150, ADR-155), and the orb's pick is still open.
- **The owner's picks (2026-11-27, from the films):** the straight limbs (`ascMotion` b), the readable pace
  (`ascPace` a) and the sun (`ascShot` a), now the defaults (PICKED); `a` / `0` / `0` play each as before, `b` the
  comet that was not picked.
- **After the picks (the suite on the new defaults):** the sweep's turn re-keyed every 60° (keys 120° apart let the
  spline cut the corners and fold the leg mid-turn), its foot skimming 8 cm up (a foot keyed on the floor is a
  planted one to the feet's planner) and reaching 1.2 x the leg; the straight punches' lunge 0.12 m shorter (the
  long arm put the fist 0.37 m into the hero). The suite's bots read each cue's own lead (`cueLead`); PACE's
  cue-rate floors re-pinned to the paced fight (F1 64, F2 71 a minute); MOTION's slide counts feet on the floor
  only (the old 0.16 m line counted the planner's lifted steps). The blast's cost (asc `shotcost`, opt-in): the
  sun peaks at 867 live fire blobs in Raining Suns (537 today; the field holds 6000), glyphs as today; the comet
  would have cost ~8x the glyphs. `npm run perf` stages a still fight with no blast: not run for this. The
  Lab's Training timed its answers off `T.flashLead`, so on a paced boss (his, the Starless Lord's) it answered
  0.09 s early (the trade landed on him instead of meeting his blow): `Training._lead()` reads the fired cue's own
  lead (its beat's impact - flash), the same number for a boss without a pace.
- **Consequences / open:** tests asc LIMBS and READABLE hold each switch's promise. Some strings' worst jolt rose a little with the
  longer roundhouse leg (Thousand Shadows 275 → 424 mm/f², under the 450 the suite allows). Not done: the
  transformations' kneel-to-stand (jolts ~600), Thousand Hands' last palm (671, as before), the dash thrusts'
  feet (the audit leaves dashes out).

## ADR-249 — Wen Yao's limbs at the contact: straight punches on one line, straight kicks, one cue one meaning (2026-11-26)
- **Context:** the boss motion audit (the owner: weird arm angles, "kicks aren't straight during the attack and
  still bended"; every attack readable; effects at the fox's own bar). Measured on the rig with a new opt-in scenario
  (`fox.mjs . anatomy`: the striking limb at every blow's contact, his paper selves' blows too): his straight punches
  and palms landed with the elbow at 123 - 139° (a boss without `armSoft` opens at most ~145°, `ARM_SOFT`), the fist
  0.25 - 0.36 m off the shoulder → hero line; the roundhouse 107 - 111°, the selves' rising kick 126°, the sweep 82°
  at the contact and 50 - 90° through its turn; the Kite String's heel straight but he landed on the hero, the heel
  0.8 m past. His uppercut was both white (Paper Rain) and the blue flare (Hand to Hand).
- **Decision:** a pass in his own folder (`thousandFox/limbs.js`), behind `?foxLimbs=0|a`; his blows stay Tian Lei's
  builders (`ascendant/moves.js X`, untouched: that session owns them). It rewrites the CONTACT key of his realised
  beats (Xin Yi's ADR-221 method: a straight blow's hand 1.08 x the arm toward a chest-high point before him, a kick's
  foot 1.05 x the leg along its line; bent blows keep a bend) and opens his and his selves' animators (`armSoft`,
  `legSoft`, `kickStretch`: Xin Yi's numbers). The sweep's turn is keyed every 30° with the foot 5 cm off the floor
  (keys a third of a turn apart cut the chord; a foot on the floor was taken by `_feetClip` for a planted one and
  walked after the clip). One shared-engine field, opt-in: a beat's `leap.stop` (brain.js `_leap`; 0 / unset = as
  always) lands a leap short of the hero; his axe heel 0.7 m, his hammer fists 0.45 m. `?foxCues=0|a`: Paper Rain
  ends on a backfist, so the uppercut always means blue. The owner picked `a` for both from the before / after films
  (2026-11-27): they are the default (`PICKED`); `0` plays him as before.
- **Not changed:** every timing, tell, window, number and effect. His windups stay PBZ-fast (first blows from 0.42 s,
  COMBAT.md "The Thousand-Body Fox"), under the audit brief's 0.7 s floor: the owner's earlier call, asked again with
  the films: they kept it fast (2026-11-27). His effects (the Pearl, the foxfire, the Howl) are the bar the other bosses are measured
  against: no options offered.
- **Fixed after the picks (the owner asked, 2026-11-27):** Hand to Hand's opening jab lifted a lead foot the root
  had left behind, and it jumped 0.43 m in a frame (on `main` too). The foot planner was STEPPING it (mode 1) when
  the clip lifted it, and ADR-223's release ease only caught a planted foot. `HeroAnimator` `opts.liftFromStep`
  (opt-in; the fox's kit only, with his `liftEase`): a foot lifted mid-step eases from where it was drawn, its height
  too. The hero and every other boss are unchanged. Every move of his now stays under 0.3 m a frame (Hand to Hand
  0.43 → 0.24, Burning Tail 0.35 → 0.28; `fox.mjs motion` asserts it over all 21).
- **Consequences:** `fox.mjs motion` asserts the limbs (straight blows >= 155°, kicks >= 155°, hooks and uppercuts
  95 - 130°, `0` as before); the pace, win, timing and data scenarios are unchanged.

## ADR-250 — Shen Hui's form: thrusts on the arm's line, a real lunge, diagonal overheads, sweeps that turn on the feet, the step that lands with the blow; looks for Ember Whirl and Heaven-Splitting Fall (2026-11-26)

- **Context:** the owner's motion audit of every boss (2026-11-26): "weird looking arm angles and sword positioning
  and attacks that look unrealistic", every attack readable, the special moves' effects at the bar of Wen Yao's and
  Bai Wuji's. ADR-226 already put his jian in line with his forearm (wrist ≤ 40 - 50°) and held his blue / red
  windups. Measured what was still off (`tests/integration/swordAudit.mjs`, new opt-in `GCD_AUDIT_IMPACT=1`: at each
  blow's impact the sword elbow, the wrist, both knees, the front foot down or not, the blade's elevation, the cut's
  tilt (the point's path off level), a thrust's arm line (shoulder → grip against the blade) and a kick's knee; and
  when the free hand peaks and the elbow folds):
  - **Thrusts** landed on a bent arm (elbow 135 - 150°) with the point 21 - 26° off the line of the arm; the long
    lunges (Plum Thrust, Piercing Ash, the perilous ends) on two locked knees (176° / 176°): the feet set 1.5 - 1.7 m
    apart, wider than his legs reach at that depth.
  - **Overheads** (Falling Ash, the strings' held overhead, the leaping two-handed chops) cut straight down: the
    point's path 75 - 81° off level, one upright bar at the game camera; in the strings the free hand flew from the
    held pose (out at the foe) onto the hilt in the 0.1 s strike: 17 - 19 m/s, the fastest thing he did.
  - **The low sweeps** (Lotus Sweep, Twin Embers' second, Ember Whirl's last, Ash Lotus's, Ash on the Wind) turned
    his hips a full circle over feet that stayed put: the legs crossed (-0.73 m) and the knee popped (630 mm a frame²).
  - **The front foot was still in the air at most impacts** (15 - 18 cm): the foot planner steps a keyed foot only
    once its key has drifted 14 cm, then takes ~0.1 s, so in a 0.34 s string windup it landed after the blade.
  - Fine already: his kicks are straight at contact (176°, the support leg bent), the blade stays off his head and
    body, his chest faces the hero at every impact.
- **Decision** (`?ashForm=a`, the owner's pick, 2026-11-27, `0` = as before; Lab LOOKS `ashForm`): every beat gets
  `formKeys` (and, for the blows ADR-226 holds, `formMotionKeys`), its move a `formRecovery`, played through the
  realiser's `keysOf` / `recoveryKeysOf`: the windups, impacts, zones, cues and root motion are the move's own, only
  the poses change. His data only (moves.js; the shared engine untouched: `keysOf`, `recoveryKeysOf`, `animOpts`
  and `kit.motion` are kit options that already existed).
  - **The thrust**: the sword hand keyed on the blade's own line out of the shoulder, past full reach, with his own
    soft reach `TUNING.formMotion.armSoft` [0.9, 0.99] (ADR-226's 0.985 held a thrust at 145°; 1.0 locked a cut's arm
    at 176°): elbow ~160°, the point 2° off the arm. The lunge's feet set where the legs reach: the front shin
    upright over its foot, the back leg long (`lungeFeet`): knees ~70 - 100° front, ~155 - 176° back.
  - **The overhead** as a ONE-handed steep diagonal (the jian is a one-handed sword): from high over the sword
    shoulder down through the opponent to low at his left hip, the free hand drawn back in opposition; the blue HIGH
    hold for these blows a little further out over the shoulder (world az -1.1, not -0.42) and ended at 0.7 of the
    windup (not 0.8), so the strike comes ACROSS him; the leaping two-handed chops keep both hands, on the same
    diagonal. Tilt 55 - 61° (the other diagonals ~43°: still its own shape).
  - **The low sweep**: the feet go round with him (the right leg sweeping the stones, the left turning on its ball),
    keyed just off the floor so the clip carries them.
  - **The free hand** through a cut gathered by the sternum and split to his left in opposition: half the travel,
    so a string no longer pumps it back and forth; Flicking Willow keeps the raised sword-finger up through the
    flick (it fell 0.66 m in 0.09 s).
  - **The step lands with the blow** (ki-ken-tai-ichi): where a beat steps its front foot in, the foot is keyed off
    the stones halfway through the step and down at 0.86 of the strike, not left to the planner; outside dashes,
    leaps, flits and the courtyard's moves. A planted foot its clip lifts eases off its spot over
    `TUNING.formMotion.liftEase` 0.05 s (the others' 0.12 s dragged his feet 1.2 m through Rain of Ashes).
  - **Effects to pick** (the owner's bar: the fox's and Bai Wuji's spells), `ashDisciple/specialFx.js`, heat in the
    fire field and one-cell embers at the blade, his body or the landing spot, no hit and no cue of their own:
    `?whirlFx=` Ember Whirl (a the wheel: the point leaves a burning ring; b the cyclone: fire whirling up round him,
    embers off the point; c the disc: the swept width burns an instant) and `?fallFx=` Heaven-Splitting Fall (a the
    comet: a tail of fire down, a column where he lands; b the split: a seam of fire down the cut, the floor split in
    fire ahead and behind, out past the burning ring; c fire raining on the locked ring). `0` = as they ship. The
    owner's picks (2026-11-27): `whirlFx=b` the cyclone, `fallFx=b` the split. The Kindling keeps its picked look
    (ADR-118's three, `kindle=a`).
  - **The Fall as a jump** (the owner, picking: it "doesn't look natural in his motion"): ADR-226's held red coil
    spans 0.36 - 0.72 of its windup, which is his whole flight, so he flew 3.6 m up in a ground crouch (feet set in a
    lunge, the blade trailing behind him) and whipped the blade over in the last 0.3 s. In the form it has its own
    keys: he loads (sinks, the blade swung low behind his right hip), drives up off both feet as the arms swing the
    blade up, tucks his knees at the top with the blade raised over his sword shoulder (held through the ring's
    lock, where the red reads), reaches his legs down as the blade starts over, and lands into the cut (the root's
    arc ends at the impact), sinking on through the active frames; his recovery rises where he landed. The arms (the owner: "awkward and
    stiff"): the hands lift the blade up his right side in one rising arc (no swing forward under him and back),
    and it keeps cocking slowly back behind his head through the lock (the arms never freeze), turning over into
    the cut as he drops with the hands leading the steel. Then (the owner: the arms "barely visible" in the air,
    the low backswing "a complete circle", the swing "way too late", "lands on top of the character like
    kamikaze"): no backswing, the arms leave his guard straight up, the hands high in FRONT of his face; the cut
    starts in the air past the top, the blade level in front of him before his feet touch; and he lands 1.6 m
    short of the hero (the leap's new opt-in `short`, duelist/brain.js `_leap`; the form only) so the steel, not
    his body, meets him (the 2.6 m ring still takes the hero in).
- **Kept:** his pace (the owner's PBZ-fast openers ~0.46 s and strings 0.34 s apart, his TUNING floors 0.42 / 0.32 s:
  the brief's 0.7 / 0.45 s floor would slow every move of his, which the owner chose fast; asked, not changed);
  his colours and hat; Piercing Ash's old drawn-back windup (the owner's call in ADR-226; its lunge gets the new legs
  and arm); the riposte's first blow a meetable diagonal cut (the flash chain's strike-back, ADR-246).
- **Consequences** (the audit, every move, the form on): thrust elbows 156 - 161° (from 135 - 150), arm line 2 - 3°
  (from 21 - 26), lunge knees front 69 - 98° / back 140 - 176° (from 176 / 176 on the long ones); overhead tilt
  55 - 61° (from 75 - 81); the free hand's peak 4.5 - 10 m/s in every string (from 17 - 19); the front foot down at
  every cut's impact (from up 15 - 18 cm in most); the sweeps' legs no longer cross (+0.3 m), the knee pop gone. The
  duel suite with the form on: green, two checks read the engine on the poses they were tuned on (`ashForm=0`, as
  `ashMotion=0` already: MOTION's two-handed overhead, REACT's layer under the raised blade). Open: the sweeping
  foot counts as sliding in the audit (it is the sweep); feet still slide 0.15 - 0.5 m over a long string where the
  close-in carries his root under a planted foot.

## ADR-247 — The clash dance: parries in a row pay more posture, the ring rises, his recovery slows with his health (`?clash=dance`) (2026-11-26)

- **Context:** research into Sekiro, Phantom Blade Zero and Onimusha: Way of the Sword proposed five combat additions
  (ROADMAP P4); the owner picked the flash chain first (ADR-246), then "the clash dance". In Sekiro deflects close
  together deal more posture damage than the same deflects spread out, the deflect's ring is the fight's rhythm,
  and a boss's posture recovers more slowly as his health drops, so cutting his health makes a break stick. Here
  every parry paid the same posture, and only the Lord, Tian Lei and Xin Yi scaled their recovery by HP (a curve).
  PR 145 (the deathblow, ADR-211; merged while this was built) counts perfect parries across strings for the deathblow's
  length and answers any parried blue blow with the deathblow; the owner
  asked what the clash dance is and approved building it standing on its own, a small ring and the steps for every
  duelist.
- **Decision:** behind `?clash=dance` (`combat/clashDance.js`, `DEFENSE.clashDance`; the Lab's `clash` row), off by
  default until the owner picks from film. (1) A duelist keeps the run of parries inside one of his moves; the
  run's n-th parry's posture x `mult` [1, 1.25, 1.5, 1.75] (the cap); it starts over on a new move, a blow landing
  on the hero (`player.hurtN`), or a 1.5 s gap. Bodies and blades only, not thrown things. (2) The recorded parry
  rises half a semitone and 0.8 dB a parry of the run (2 semitones / 2.4 dB at most) on top of the deflect chain's
  weight; `player:parry` carries the run as `clash` (the hero asks the duelist's `clashPeek()` as he parries, since
  the sound plays before the duelist counts it). (3) His posture recovery x a step by HP: 1 from 75 %, 0.85 from
  66 %, 0.75 from 33 %, 0.5 from 10 %, 0.25 below; for the three with a curve the steps replace it.
- **Why this way:** the run lives on his move, beside the deflect chain's own count (`act.chain`, the "DEFLECT
  xN" call-out), so "his string ends" needs no extra state and the call-out keeps its meaning; a hurt counter on the
  hero (not an event listener) keeps the duelist free of subscriptions. It never reads PR 145's `parryRun`, so
  either can land first. For the Lord's family the first try kept their x1.5 full-bar rate under the steps, but that
  made them recover FASTER than today at 50 - 70 % HP (x1.28 against x1.2): replacing the curve outright is never
  faster at any HP, and is what the owner approved.
- **Not taken:** a bigger ladder (the owner asked for about x1.25 steps; a 7-blow string from an empty bar already
  breaks Shen Hui through the full deflect, so the dance mostly shortens the 3 - 4 blow strings that make up most
  of a kit); a pitch climb on the bell or a new layer (the owner turned a climbing parry down before: "sounds like
  its for kids").
- **Consequences / open:** the film (a plain-parry bot on all-white strings, the same strings both ways):
  Shen Hui (full HP; Parting Wind and Ember Fan in turn) breaks on the 9th parry instead of the 12th; the Starless Lord (50 % HP; Crushing Verse, Veiled Hand, Push Opening, ...) in his 3rd string instead of his 4th, 2.7 s sooner; Xin Yi (50 % HP, a posture bar of 1100) breaks after about 42 s, where today he stands unbroken at 977 / 1100 after 45 s. The ring is not on the film (no sound): it is the owner's to judge by ear in
  the preview. With PR 145 the break may come before as many perfect parries are banked, so a deathblow may be
  shorter. Tests: duel `clashdance`, lord `clashdance`.
- **Update (2026-11-27):** the owner watched the three films (Shen Hui, the Starless Lord, Xin Yi, today against
  the dance) and said "Make it default". The game plays the dance with no switch (`DEFAULT_CLASH`); `?clash=0`
  and the Lab's `clash` row `old` give the numbers before. As with the flash chain (ADR-246), the headless sims
  keep it off unless a scenario sets it (their posture checks were written for the old numbers); duel and lord
  `clashdance` play it. The ring is still the owner's to judge by ear.

## ADR-250 — Bai Wuji round 3: the glide (his melee motion, the owner's pick of three takes), the barrier opens easier, cuts x2.5 through it; his mercy counted in real time (2026-11-27)

- **Context:** the owner after playing the shipped fight (ADR-241 - 243): "the fight is pretty hard right now
  and takes forever to do damage to him"; his kicks and punches "do not look natural and look off"; "faster and
  cooler", effortless and invincible. Their answers: the barrier opens easier (two ordinary parries crack it
  open, it stays open longer, the hero's cuts hit harder while it is open, hp near 20000, a good player wins in
  about three minutes); effortless and one-handed (hands in his pockets most of phase 1, one out in phase 2,
  both in phase 3; fast snaps, held poses only on blue / red); film 2 - 3 takes, they pick. They picked **b,
  the glide**. Why his melee looked off: his realiser had no `keysOf`, so ADR-225's motion layer (held blue /
  red windups, released feet) never reached him; his knees were 96 - 131 deg at the contact, his fists Tian
  Lei's boxer guard, his strings lunged.
- **Decision:**
  1. THE TAKES (`untouched/motion.js`, `?wjMotion=0|a|b|c`; PICKED `b`; `0` = as first shipped): each melee
     move's `beats` / `recovery` are live getters over the take; a take rebuilds the pose keys (hand-keyed,
     ADR-236), retimes the windups (normal blows cut toward the engine's floors, blue / red keep most of theirs:
     the held pose is the read; the cock moves late, a snap), recoveries x 0.66 (b), a string's later beat out
     of a short blink round the hero (`wjBlink.near`; b blinks every later beat, flank / behind / other flank),
     and `wjHands` (the hands a blow uses). THE HAND LAYER (`poses.js` `wjHandsLayer`, `pilot.wjPin` eased by
     `WjMelee`) keeps the others in his pockets. Tells, zones, damage, knockback and the engine's minimums do
     not move (veil.mjs DATA, MOTION, MOTIONAUDIT).
  2. THE BARRIER OPENS EASIER (`wjBarrier`): `cracks` 4 -> 2; open after a perfect answer 4.0 / 3.2 / 2.6 ->
     6 / 5 / 4.2 s; by cracks 2.4 / 2.0 / 1.6 -> 5 / 4.2 / 3.4 s; `openDamage` 2.5 (new; `barrier.scaled(o)`):
     every cut that is not `exact` deals x2.5 while it is open. No new mark: the open ring and the numbers read
     it. hp 26000 -> 20000. Patience after 30 -> 20 s.
  3. THE BENCH WITH THE GLIDE (six seeds, god mode off): openDamage 2.2 gave the good bot 2 wins in 6, 2.35 4
     in 6, **2.5 6 in 6 in 147 / 166 / 191 s** (2.8 min mean); the perfect bot 6 in 6 in 106 - 119 s, untouched;
     fencing 3 in 6; roller 4 in 6 in 167 - 191 s; blocker dead at 39 s; the pace defender dead in all six at
     patience 20 (95 - 553 s; at 30 and 25 one seed lived out 600 s). Longer openings by cracks changed nothing:
     the good bot opens him by cracks 1 - 3 times a fight (ADR-227's parry windows leave the ordinary-parry band
     about a frame wide).
  4. THE PERFECT BOT'S HITS were the bot's, not his: it rolled out of falling pieces too late for the next red,
     tapped one parry for two cues 0.08 s apart, and rolled away facing off him. The bench's bots now roll out
     of a falling piece as its cue comes (late once to cover a red that follows within 0.3 s), roll the way that
     keeps him in front, and hold the guard for two guard cues within 0.3 s: 0 hits on 12 seeds.
  5. MERCY IN REAL TIME (`WjMelee`): a hit's freeze holds the hero as long as it holds the clock, so the stretch
     out of his own hands is counted in `game.realDt` (three quick Five Sides blows measured 1.19 s of game time
     while the hero was held 1.52 s); a blocked blow that would empty the guard meter adds `GUARD.openDur`, not a
     plain stagger. A falling piece never lands on a hero who is down (`destructibles.js`).
- **Consequences:** a good player beats him in about three minutes; a pure defender still dies. Open: the
  ledger forgets a red once it has landed, so the fairness guard never holds a blow that lands while the hero is
  still in the roll that answered a falling piece (shared duelist code, left); patience is slow against a pure
  defender because his next blow lands in the knocked-open guard about one time in ten.

## ADR-255 — Bai Wuji's motion audit: straight blows on the line to the hero, a kick's return without the snap, phase 1's casting hand out of its pocket (2026-11-27)

- **Context:** the owner's motion audit of every boss (2026-11-26: "weird looking arm angles", "attacks that look
  unrealistic", kicks "still bended", every attack readable; Bai Wuji's spell effects are the bar, kept). His
  melee motion had just been rebuilt and picked (ADR-250, the glide), so this pass audits the glide, built on it
  (PR 176), and changes only what the measures found. A new opt-in scenario `veil.mjs . anatomy` measures every
  move of his in every phase on the rig: the striking limb at each contact, an arm's line to the hero (degrees
  off the line from his shoulder to the hero's chest, flat and up / down, at the contact and at the release),
  the largest one-frame jump and when. Two traps in measuring a line: the duelists' rig root carries a
  world-fixed tilt toward the camera on a non-uniform scale (x -0.24 rad; 1.21 / 1.38 / 1.21), so the hero is
  placed in an UNTILTED frame (his position, yaw and scale), and the hero's place is taken the frame before the
  contact (the blow's own throw moves him inside the hit frame).
- **Found:** the glide's kicks land straight (knee 166 - 175 deg; 107 - 132 before ADR-250) and its straight hand
  blows open (152 - 169 deg); every blow faces the hero at its contact. But (1) the palm, the poke, Dark Spark's
  fist and the Yank's fist crossed past his centreline, 12 - 31 deg off the line to the hero's chest (Dark Spark's
  fist passed him by most of a metre); (2) inside a string a kick's contact pose was held dead still (u 1.0 -
  1.22) and the leg snapped back to the chamber in the last frames of a ~0.15 s follow-through: a 0.4 - 0.57 m
  one-frame jump (Three Count, Four Sides, Too Slow, Everywhere); (3) ADR-250's hand layer pins the right hand in
  its pocket through any phase-1 move whose beat names no `wjHands`, so phase 1's Azure Draw lost its finger and
  the Yank's BLUE fist (a parry cue) glinted inside a pocket (elbow 112 deg, the arm 81 deg down).
- **Decision:**
  1. `?wjPolish=0|a` (PICKED `a`, the owner's pick from the films; `untouched/motion.js` POLISH, built into a second set of takes,
     read live): (1) each straight hand blow's contact hand moved back toward his centreline by AIM (palm -0.12,
     poke -0.1, Dark Spark -0.2 m; the Yank's fist -0.14 through its own `wjKeysP`, played by his realiser's
     `keysOf`): now 1 - 10 deg off; (2) a kick's follow-through is a moving hold (12 % back toward the chamber by
     u 1.14) that eases into the chamber at u 1.7: Three Count's worst jump 0.51 -> 0.34 m, Everywhere's 0.48 ->
     0.25. What is left is the snap of the strike itself (the owner's fast glide). A follow-through past the
     contact was tried and dropped (it drove the axe heel into the road: 0.50 m).
  2. `?wjCastHand=0|a|b` (PICKED `a`, the owner's pick from the films; `WjMelee._motionFrame`): a phase-1 beat of Azure Draw or the
     Yank uses the right hand: `a` for the whole cast, `b` from 0.55 of its windup (the pull and the flick), `0`
     round 3's pocket. Curb Pull keeps both hands in (its own design).
  3. No effect is upgraded: his spells are the owner's bar for the game, and no special of his reads weaker than
     the rest of his set on film.
  4. Tests: `veil.mjs . polish` (default) asserts the lines, the return and the casting hand; `anatomy` (opt-in)
     prints the table. No tell, windup, zone, damage or timing moves.
  5. THE MERCY FOR SPELLS AND PIECES: the full run's DOWNTIME (seed 7, on the fight path these poses gave it) found
     Crimson Cast's burst landing 0.05 s after the hero stood up from Overhead's knockdown: 2.92 s out of his own
     hands (the cap 1.5). His melee beats spare such a blow (`WjMelee._spare`), his spells and thrown pieces only
     spared a hero who was still down. Now `WjMelee.chainsLock(knockdown)` asks the same rule, and the spells'
     `_strike` and terrain's `_heroDown` pass a blow over a hero it would chain (the blow still flies, cued; it
     only does not land).
- **Consequences:** the owner picked `a` and `a` from the films (2026-11-27): the defaults. Left for the hero
  session: one-frame jumps of a SUPPORT foot after a blink (Five Sides 0.47 m, Passing Through 0.55 m) come from
  the hero animator's `_feetClip`.

## ADR-251 — The Starless Lord's form: thrusts on the arm's line, a real lunge, diagonal overheads, sweeps on the feet, the step on the blow; a readable pace and looks for two specials, to pick (`?lordForm` / `?lordPace` / `?boltFx` / `?igniteFx`) (2026-11-27)

- **Context:** the owner's motion audit of every boss ("weird looking arm angles and sword positioning and attacks
  that look unrealistic ... clear tells ... make all the special moves and effects very cool"), one session and one
  draft PR per fighter, judged on films. Batch 1 (ADR-248 Tian Lei, ADR-249 Wen Yao, ADR-250 Shen Hui) set the
  method. The Lord had ADR-226's grip and held tells (`?lordMotion=a`, the default). Measured first, every move in
  every form it is used in (`lord.mjs . formaudit`, new; the shared sword audit's impact table, ADR-250's, plus a
  true slide of the feet on the floor and the off-hand blade's arm), because a move compiled round another form's
  guard is not the move he plays there:
  - thrusts landed on a bent arm (121 - 140°) with the point 18 - 23° off the arm's line; the long lunges (Starless
    Lunge, the Dirge's opener, Push Opening, Hunting Wings, Cyclone, Crimson Eclipse) on two locked knees (176 / 176°);
  - the two-handed overheads (Falling Star, Grasp and Sever's chop, Severance, every string's held chop, Judgment,
    the Void Waltz, Thunder Verse) came straight down: the point's path 71 - 80° off level, one upright bar at the
    game camera;
  - the low sweeps (Reaping Arc, Red Meridian's second blow, every red sweep that ends a string) turned his hips a
    full circle over feet that stayed put: the legs crossed by 0.73 - 0.85 m, the knee popped 630 - 645 mm a frame²;
  - the front foot was still in the air (15 - 25 cm) at about half of all impacts;
  - fine already: the wrist on the blade (≤ 40 - 59°, ADR-226), the blade clear of his body, the form-2 off-hand
    blade at its own blows (elbow 161 - 166°, the blade 25 - 60° off the forearm).
- **Decision** (`?lordForm=a`, `0` = as before; Lab LOOKS `lordForm`; the owner's pick, 2026-11-27, from the before /
  after films, with the readable pace, `?boltFx=c` and `?igniteFx=a`; all four in `PICKED`): ADR-250's recipe
  in his own move data, every beat's `formKeys` / `formMotionKeys` and the moves' `formRecovery`, played through his
  realisers' `keysOf` / `recoveryKeysOf`; the same windups, impacts, zones, cues and root motion (LORDFORM: 187
  realisations to the frame):
  - **thrusts**: the sword hand keyed past full reach on the blade's own line, the arm opening further (his
    `formMotion.armSoft` [0.9, 0.99]), out of a lunge with the front shin upright and the back leg long (forms 3 - 4
    keep both hands on the hilt);
  - **overheads**: still two-handed (his, unlike Shen Hui's jian), raised over the sword shoulder and brought down
    across him to low at his left; the blue HIGH hold widened over the sword shoulder for those blows (az -1.1) and
    ended at 0.7 of the windup; the somersault's landing chop the same, its turn kept;
  - **low sweeps**: the feet go round with him (the right leg sweeping the floor, the left turning on its ball);
  - **the step on the blow**: where a beat steps a foot in (the right, or the left in a string's left-foot cuts) it
    is keyed off the floor halfway through the step and down at 0.86 of the strike (not in a dash, a leap, a flit, a
    blink or a lift); a planted foot the clip lifts eases off its spot over 0.05 s (`animOpts.liftEase`);
  - **the free hand** in one-handed cuts: gathered at the sternum and split in opposition, half the travel.
  - Measured after: thrusts 154 - 157° at the elbow and 2 - 5° off the line; the lunge's front knee 95°; the
    sweeps' feet never cross (+0.38 - 0.48 m); the overheads 43 - 61° off level; the front foot down at all but a
    few cuts.
- **The readable pace** (`?lordPace=a`, `starlessLord/pace.js`, Tian Lei's ADR-248 recipe): his shipped pace is the
  owner's ("faster than Shen Hui and ramping": a string's blows ~0.34 s apart in form 1, ~0.3 s in form 4, first
  blows from 0.4 s), under COMBAT rule 10's floor. Under `a`: a move's first blow >= 0.7 s × the form's windup
  scale, blows >= 0.45 s apart, the cue 0.35 s before, the time added a hold of the cocked pose (a fixed delay); his
  quick blows, counters, flurry and ignitions keep their timings, and so do his spells (a beat that casts, throws,
  releases or reaches out with the Void: rule 10 is the melee's floor, and each cues itself; a hazard or a move of
  the crater's pieces is left alone). Offered, and the owner took it (2026-11-27). Tests that asserted the fast pace
  read it now (lord DATA: the gaps at the floor and the first blows sooner form by form; TIMING: a blow 0.35 s after
  its glint, a spell 0.26 s; FLARE's parry bot). Known: the shared cue ledger's flash-fed entries and the Training
  room's answer time read `TUNING.flashLead` (0.26 s), so they place a paced blade blow 0.09 s early (the ledger also
  reads the running move's beats exactly; Training's 122 situations still pass). Fixing them is shared code.
- **Two specials' looks** (`starlessLord/specialFx.js`; heat in the fire field and one-cell glyph particles at his
  hand, arm, the bolt's line or round his feet, on the looks' own stream; no hit, cue or floor mark of their own):
  - `?boltFx=` Void Lightning: `a` the thread (motes spiral into a white heart at his fingers, the bolt braided with
    two violet strands, a ring punched out at the hand), `b` the tear (arcs crawl up the casting arm, the bolt leaves
    a dark seam with violet lips that comes apart upward), `c` the storm (arcs creep along the floor round his feet,
    the bolt grounds three times along its line); a chosen look draws the windup at his hand in place of the shipped
    gather (the two together were one white flare);
  - `?igniteFx=` a form's ignition, over the shipped `?ignite=a`: `a` the cocoon (a column of letters rises round
    him and bursts out flat), `b` the writ (the new steel written in light where it will stand), `c` the eclipse (a
    ring of dark spreads round him, its red rim stands up as a wall).
  - Cost: at most ~200 blobs over today's peak (the field holds 6000; LORDFORM).
- **Why** the same method as batch 1: it measured and fixed the same faults on Shen Hui, whom the Lord's move data
  was built from; hand-keyed poses judged on film, no footage (ADR-236).
- **Consequences / open:**
  - The owner's picks (2026-11-27): the form `a`, the pace `a`, Void Lightning `c` (the storm), the ignitions `a`
    (the cocoon); in `PICKED`, the losing options behind their switches.
  - Found, not changed: Grasp and Sever's chop closes in with the shared step-in (`close`) over planted feet, so a
    hero who rolls the pull clear watches him skate 3.4 m (every form); the fix (a dash like Severance's) changes the
    beat's root motion, so it waits for the owner. The strings' close-in between blows still slides the feet
    0.5 - 2 m per string (as before); the planner's lag is the hero animator's (`anim.js` `_feetClip`). In form 2
    the off-hand blade points back along the left forearm (up to 157°) through the two-handed chops, where that hand
    also holds the main hilt. The free hand flies 15 - 20 m/s in form 1 where it closes on the hilt for a chop or
    snaps a cast (Grasp's pull, Drawn to the Blade).
  - Shared code: none changed. `swordAudit.mjs` is ADR-250's (fields only); `duelist/*`, `player/*`, `tellPose.js`
    are untouched.
## ADR-253 — Xin Yi's limbs on the line, his guns on the line of fire; two redrawn shots and bolts to pick (`?oneMoves=b`, `?oneGunFx=`, `?oneBoltFx=`) (2026-11-27)

- **Context:** the boss motion audit (the owner: weird arm angles, unrealistic attacks, "kicks aren't straight during
  the attack and still bended"; every attack readable; special effects to pick in the style of the fox and Bai
  Wuji). Xin Yi's rebuild (ADR-221, `?oneMoves=a`, the default) already carried the animator kit the other bosses now
  copy. Measured on `a` (woke.mjs AUDIT, the new GUNS and PROBE scenarios, the hero still in front of him; films at the
  game camera and close from the side):
  1. Straight punches landed 22 - 25 degrees off the line from the shoulder to the hero, the fist 0.17 m across his
     centre line; the back-fist 63 degrees off, 0.6 m to the side and 0.6 m short; the palm 0.33 m short.
  2. Kicks reached straight for two or three frames and folded at once. On Sky Turns' first tornado (phase 1) the leg
     was already folding on the frame the hit-stop froze (118 degrees at the knee); the butterfly 131, the flash kick
     in phase 3 120; a spin kick's leg went from straight to 91 degrees two frames after its contact.
  3. The elbow struck 0.73 m short of the hero, the spin back kick 0.46, the flying knee 0.44, the hook 0.37: the
     zone hit from where the limb never reached (his stand-off is the zone's, brain._ideal).
  4. The low sweep's foot was 94 degrees round from the hero and 1 m short at its impact, the knee at 106 - 134 and
     flailing 46 - 163 through the turn. Two causes: its foot keys were a third of a turn apart, so the foot cut
     across the circle to half its reach between them; and the foot, keyed on the floor, was the feet planner's
     (anim.js _feetClip holds a foot within 3.5 cm of the floor until its key is 14 cm away), a tenth of a second late.
  5. The mirrored palm (deja vu in phase 3) struck with the left hand while its glint, trail and the parry's contact
     stayed on the right, hanging at the hip (41 degrees at the elbow).
  6. The guns: the right gun's barrel runs along the knuckles of the fist joint, and in every aim they faced
     sideways: it pointed 55 - 113 degrees off the line its shots flew (Two Thunders' side-on aim 144), the left 24 -
     36, the other hand's 55 - 90 off the hero; each shot left 0.2 - 0.3 m below the drawn gun (the shots' height is
     held to 0.9 - 1.4 m; in Iron in the Air 0.7 - 0.9 m below it); Turning Wheel's shots were drawn along the floor
     with nothing at the guns; nothing moved when he fired.
  7. The palm bolts (the Source) drew as a ball of soft glowing heat a third of a metre wide with a white heart: a
     glow, where STYLE.md asks for letters.
- **Decision:** a third option of his moves, `?oneMoves=b` = `a` and two passes, the timings identical to `a` (no
  windup, cue or impact moves); `a` stays the default until the owner picks.
  - `limbs.js` (on each beat's keys, before the held tell's re-timing): a straight blow's hand put on the line from its
    shoulder to his centre line 0.95 m ahead, 1.12 x the arm out (the double palms 0.1 m either side; the
    point-blank shot's arm aimed 2.4 m out); a kick's contact pose repeated 0.35 of the follow-through later (the leg
    held long, then drawn back) with the striking foot carried out to the contact's length through it; the sweep
    turned so its leg crosses the hero's line at the impact, its turn keyed every 0.5 rad, its foot skimming 6 cm
    off the floor from the tuck on (out of the planner), the planted foot near his pivot, the knee pole up and out;
    a short blow's zone fitted to its drawn reach (`motion.fit`, measured: he steps in until the limb meets the hero,
    and the hit reaches no further than the limb); the mirrored palm's part the left fist; Iron Rain's aim reached
    by 0.6 of its windup and held (its first slugs leave a flight early).
  - `gunAim.js` (drawn only, after the animator; no gameplay point moves): each gun turned in its hand so its barrel
    runs down its forearm, onto the hero's chest when the forearm is within 0.8 rad of it; a shot kicks its arm (the
    upper arm raised 0.15 rad round the shoulder, the gun climbing 0.3 rad and pulled back 5 cm, halflife 0.05 s;
    worked in his root's own space, as his drawn matrices carry the camera lean's shear), the right gun's joint
    turned with the arm (it is posed in the body's space); `muzzlePoint` gives the drawn muzzle. iron.js fires from
    it on `b`, the shot falling along its way from the muzzle to chest height (the blasts' `yTo`; its flight and hit
    flat, as before); Turning Wheel flashes at both muzzles.
  - Two effect switches for the owner's pick (default '0', as shipped; `fxIron.js`): `?oneGunFx=a` the tracer (a hot
    cone and side vents at the muzzle, a spent casing kicked out; a thin line of strokes behind each slug and small
    rings of stilled air where it passed) or `b` the script (binary digits fanned from the muzzle; each slug leaving
    a curtain of tiny falling digits); `?oneBoltFx=a` the seed (a hot core in three thin turning rings of digits) or
    `b` the fold (a core of four hot cells like a falling column, rings of stilled air across its way).
- **Consequences:** on `b` (woke AUDIT / LINE, the hero still): straight blows 1 - 7 degrees off the line, elbows
  164 - 169, every one meeting the hero (-0.08 to 0.0 m); every kick 173 at contact and held (Sky Turns' first tornado
  170 for six frames); the elbow, spin kick and knee within 0.06 m of the hero; the sweep 14 degrees off and touching
  him at its impact, its knee 121 there and 160 - 170 through the turn; the mirrored palm on the left hand; every gun
  shot from the drawn muzzle (at most 0.28 m from the fist) with its barrel at most 14 degrees off its line, elbows
  164 - 170 through the kick. The jolt total rises 5 % (1.04 M -> 1.10 M mm/f2; the worst 993 -> 871), sliding feet
  107 -> 102 m. The short blows' zones are smaller (the elbow's line 2.2 -> 1.1 m, the spin kick's 2.5 -> 1.76): a
  hero who backs off out of his step-in is no longer hit from where the limb never reached. Not done: the hooks
  still meet the hero from the side (0.17 m off), the drop heel lands 0.68 m short (its ring is the blow), the
  sweep's knee at the very contact (121), Iron Rain's two arms are mirror twins between shots. Shared code
  untouched (no `duelist/*`, `player/*`, `ascendant/*` change).
- **The owner's answer (2026-11-27, from the films):** the motion `b` as his default, the shots `b` (the script) and the
  bolts `a` (the seed): `oneMoves: 'b'`, `oneGunFx: 'b'`, `oneBoltFx: 'a'` in PICKED (`?oneMoves=a` the rebuild before
  this pass, `?oneGunFx=0` / `?oneBoltFx=0` the shots and bolts as before, the other option behind its switch).
  With `b` the default, the pace meter's phase-3 longest gap was re-pinned 3.9 -> 4.7 s: seed 4242 now rolls Pushing
  Hands then Unwriting (its bricks held before the first is thrown), 4.52 s; on five fresh seeds `b`'s worst phase-3
  gap is 2.91 s (`a`'s 2.67), and `a` itself fails the phase-2 cap on one of them (4.02 s).

## ADR-252 — Lu Wusheng audited: the draw's hands and lunge, thrusts in line, a diagonal overhead, the readable pace, three looks for the draw (`?sheathForm=` `?sheathPace=` `?drawFx=`) (2026-11-27)

- **Context:** the owner asked for every boss's motion to be audited against `docs/ANIMATION.md` and the Sekiro /
  Phantom Blade Zero / Onimusha lessons ("weird arm angles and sword positioning", "attacks that look unrealistic"),
  every attack to read, and the special moves' effects at the fox / Bai Wuji bar, as one draft PR per boss with
  films. The audit (`sheath.mjs form`, `tests/integration/sheathAudit.mjs`: the limbs and the weapon at every
  impact, the draw's hands through the windup) measured on Lu Wusheng: thrusts on a bent arm (elbow 121 - 124°)
  with the scabbard 24° off the arm's line; every draw ending in a split with both knees locked (176 / 176°), the
  cut's arm short (129 - 141°), the right fist 11 - 13 cm off the hilt at the cock and the scabbard hand going
  FORWARD 26 - 51 cm as he drew (the hips' turn carrying it; an iai draw pulls the scabbard back, saya-biki); the
  two-handed overhead an upright bar at the game camera (the point's path 75 - 87° off level); Sweeping the Road's
  legs crossed (-0.86 m) and a knee pop; the free hand in the scabbard cuts swung 0.5 m inside the strike (the
  ROADMAP's open item). His blunt blows' windups (0.46 s, strings 0.34 s apart) sit under COMBAT rule 10's floor.
- **Decision:** three switches, `0` (today) the default until the owner picks from the films:
  - `?sheathForm=a` (`sheathed/form.js`, the form's keys built beside the authored ones in `moves.js`, played through
    the realiser's `keysOf` / `recoveryKeysOf`; his arms' soft reach `TUNING.form.armSoft` through `kit.motion`): the
    fist closed on the hilt in the settle and the cock (2 - 3 cm), the scabbard drawn back level behind him as the
    blade leaves, the cut's end a lunge (the front knee ~110°, the back leg ~143°), the arm open (145 - 162°); thrusts
    on the scabbard's line (157°, 2° off) out of a lunge; the overhead raised over his sword shoulder and brought
    down across him (62° off level); the sweep's feet carried round with him; the free hand gathered by the sternum
    and split back in opposition, half the travel (Shen Hui's ADR-250 fragments: the same rig, the same values).
    Poses only: every impact, cue, end and recovery identical (`sheath.mjs formpace`).
  - `?sheathPace=a` (`sheathed/pace.js`, Tian Lei's ADR-248 method): a move's first blow >= 0.7 s (x windupScale),
    blows >= 0.45 s apart, the cue 0.35 s before, the time added as a held cock (the larger of it and the held
    tells' hold); the draws, Before the Word, the transitions and the hanging cuts keep their own timing.
  - `?drawFx=a|b|c` (`sheathed/fx.js`): the draw's look, one idea each, pale steel letters and heat at the cut's line
    (never blue: the blue flare stays the one cue): a the drawn breath (the air drawn into the scabbard's mouth
    through the stillness, thrown out along the cut, a ripple where it ended); b hanging leaves (the blade's arc for
    an instant, letters left hanging along the line that drop on the click); c the late sound (a quiet cut; on the
    re-sheathe's click a white seam along the line, the air split to both sides, two ripples).
- **Why this way:** the kit already had every hook (`keysOf`, `recoveryKeysOf`, `kit.motion`), so no shared engine
  code changed; the form recognises a pose by the fragment it was spread from (shared arrays) instead of copying
  every move; the time a slower pace adds is a still cocked pose, the house pattern for a readable tell (ADR-223).
  One Breath's timing (the hero's technique, ADR-146) and the draw's rule are untouched; the flash chain's answer
  (ADR-246) still opens on a meetable scabbard cut.
- **Not taken:** keying the draw's hand off the blade instead of `arm: 1` (the arm would lose the chest's turn with
  the cut); a coloured draw effect (a second colour at the cue would muddy the blue flare); restyling his look.
- **The owner's picks (2026-11-27, from the films and the preview):** the form `a`, the default; the pace as shipped
  (`sheathPace` 0: his fast openers stay); the draw's look as shipped (`drawFx` 0: the one white line). The other
  options stay behind their switches.
- **Consequences / open:** The planted foot's one-frame jumps live in the hero's animator (`_feetClip`; the hero session's).
  PR 170 (draft) also names an ADR-252 for the hero's slice; the batch's brief reserves 252 for Lu Wusheng.
## ADR-254 — Halcyon audited: a flier's limbs, the readable pace, two looks for his eyes and his shockwaves (`?halMotion=b`, `?halPace=a`, `?halEyes`, `?halShock`) (2026-11-27)

- **Context:** the boss motion audit (the owner: "weird looking arm angles ... kicks aren't straight during the
  attack and still bended"; every attack readable; special effects to the Fox's and Bai Wuji's bar, 2 - 3 looks to
  pick from). Halcyon is a flier on Tian Lei's builders (ADR-160, ADR-225's `a`: a flier's legs, the blow aimed down,
  the held windups, the snap blows). Measured on the rig at each blow's contact (city.mjs `audit`, now with
  `GCD_AUDIT_IMPACT=1`): his straight blows ran 35 - 66° across the line to the hero (the builders' sideways lines,
  made for a fighter on the floor beside him, not one hovering over him); his legs sat folded under him (knees 67 -
  135°: a man kneeling on air); the round kick landed at 105°, the side kick at 130°, the other leg folded at ~92°;
  the pass flew pitched 54° with the knees at 54° and the fist at 2.56 m, over the hero's head. His pace is Tian
  Lei's (first blows from 0.53 s, blows 0.36 - 0.42 s apart, the cue 0.26 s), under COMBAT rule 10.
- **Decision:** four switches, filmed, then the owner's picks (2026-11-27) made the defaults: `halMotion` b, `halPace` 0 (his fast pace kept), `halEyes` a, `halShock` a (lookSwitch.js PICKED):
  1. `?halMotion=b` (`halcyon/limbs.js`, through `motion.js` halKeys, his realiser's `keysOf`): `a`'s keys, then a
     straight blow's hand 1.08 x the arm on the line from its shoulder to the hero's upper chest (his model space at
     the dip, `motion.b.aim`), the keys after it moved with it; a kick's foot 1.05 x the leg along its own line;
     hooks and uppercuts their bend; THE FLIER'S LEGS on every key (each foot 0.9 - 0.985 x the leg from its hip,
     trailing back from straight down by a set angle plus the body's pitch, one a little more bent than the other,
     the knees forward, the toes pointed), the same hung under his hover (`poses.js` hoverLegs); a kick's other leg
     hangs long; his own beats (the eyes, the car, the clap ...) the same legs; THE PASS level (`FLY_B`: the body at 1.35 rad, the lead fist straight out, the legs long behind) and
     his root through it at `motion.b.passY` 0.3 m (`flight.js` go), so the fist meets the hero's chest. His
     animator opened (`armSoft` [0.96, 0.998], `legSoft` [0.95, 0.998]) and Xin Yi's `kickStretch` set only
     through a kick (halcyon.js brainFrame: a flier's trailing feet are off the floor too, and it locked them).
  2. `?halPace=a` (`halcyon/pace.js`): rule 10's floor as Tian Lei's ADR-248 (`ascPace`), his own copy: a move's
     first real blow >= 0.7 s x windupScale, later blows >= 0.45 s apart, the cue 0.35 s before; the time is a
     held cock (the realiser's `hold`); the snap blows and the transitions keep theirs.
  3. `?halEyes=a|b` (`halcyon/fxEyes.js`, HalFx.beam / beamSplash / eyes): a heat vision (two white-hot threads
     out of his eyes meeting into one hard line, a flickering crimson sheath, tiny faint letters shimmering up off
     it, the floor molten where it lands, sparks spat back, smoke; red motes drawn into his eyes through the
     windup); b the crimson pulse (a thicker body, rings racing down it, a scorch ring opening on the beat at its
     foot, ash; a ring tightening round his eyes). '0' Tian Lei's beam in his crimson.
  4. `?halShock=a|b` (`halcyon/fxShock.js`, HalFx.shockwave, Applause and Meteor's landing): a a thunderclap (a
     crisp ring of air racing out at chest / knee height, a fainter twin on the floor, dust shoved ahead); b a dome
     of pressure (rings at five heights, the air in it shimmering, grit lifted; the landing's lower and wider). '0'
     the engine's dust front.
- **Why this way:** his blows are Tian Lei's builders, and Tian Lei's own straight-limb pass (PR 174,
  `ascMotion=b`) is not merged and sits behind that boss's realiser; Halcyon is fixed in `halcyon/` only, his
  numbers in his tuning. The audit measures in his UPRIGHT frame: the duelist draws the body sheared toward the
  camera (`duelist.js` lean), and world points read a straight punch 20 - 40° off the hero (a measuring error,
  not his arm). The legs could not simply hang: the animator keeps a foot over the root's floor (`anim.js`
  FOOT_FLOOR, the hero's code), and he hovers 0.2 - 0.5 m up, so a hip sunk low takes its leg further back instead
  of shorter. Effects are heat in the fire field and one-cell glyph particles (STYLE.md), jitter from the looks'
  stream; nothing of a beam's or a blow's gameplay moves.
- **Not taken:** changing `anim.js` (the hero session's) to let a flier's feet below his root; raising his body
  and lowering his root (it moves gameplay heights the flight tests hold); a pace change without the owner's pick.
- **Consequences / open:** the owner kept his Phantom Blade Zero-fast openers under COMBAT rule 10 (as Tian Lei's and the Fox's); `?halPace=a` stays behind its switch. Under `b` every straight blow lands within 9° of the line (elbow 161 - 171°), the knees
  141 - 156° at every punch, a kick 173° with the other leg at 154°, the pass level (77°) with the fist at 1.55 m;
  a longer limb snaps harder at the contact (the largest frame jolt: Faster Than Sound's kick 282 → 424 mm/f², the
  riposte's palm 174 → 236). His own beats (the eyes, the car, the clap, the grab, the statue's arm, the falling
  sky) keep their arms and take the flier's legs (Applause's knees 77 / 114° → 144 / 154°); the transitions' kneel
  and the meteor's landing stay on the floor, and its tuck is a deliberate ball. Tests: city `limbs`, `readable`,
  `audit` (`GCD_AUDIT_IMPACT=1`).
## ADR-257 — The Cinder Wyrm's bites: the body surges first, the head snaps onto the beat (`?wyrmStrike=`) (2026-11-27)

- **Context:** the owner asked for a motion audit of every boss and the hero with the animation guide
  (`docs/ANIMATION.md`): weird limb angles, unrealistic attacks, everything readable. The wyrm already had its
  held blue / red windups and its quick blow (ADR-223, picked). This pass measured what the wyrm's blows do at
  their contact (`tests/integration/wyrmAnatomy.mjs`, integ `wyrmanatomy`, opt-in): per blow the striking part's
  gap to the hero at the announced impact, a foreleg's elbow and reach, a bite's neck, the order its chain reaches
  top speed (hips, chest, neck base, head; shoulder, elbow, wrist, paw; wing root to tip), the tail's tip against
  its middle, the planted feet's skating and the worst one-frame change of speed (hit-stop frames left out).
  Found:
  - **Every bite moved hips, chest, neck and head on the same frame** (lags 0 - 17 ms: the front of the wyrm one
    block), its jaws 0.8 - 3.1 m short of the hero's chest when the flash's impact came, closest only 0.07 - 0.27 s
    later (the head's exponential chase is fastest on its first frame and slowest as it arrives).
  - The forelegs rake at full reach (elbow 177°: the paw's path lies beyond the leg's reach). The strike at
    extension is right, but the leg stays a locked rod through the whole sweep.
  - The wing blows flap as one rigid wing about its root.
  - Planted feet skate 0.4 - 1.0 m through some strings (the gait's re-step under a turning, lunging body).
  - The tail blows already overlap: the tip trails the tail's middle by 44 - 123° through the turn and runs past
    it as the body stops (a softer tip was tried and changed nothing a film could show: dropped).
- **Decision** (behind `?wyrmStrike=0|a`, `dragon/strike.js`, `tuningMotion.js` `WYRM_STRIKE.bite`; `a` the default,
  the owner's pick from the before / after films, 2026-11-27; '0' as shipped; the Lab's LOOKS row `wyrmStrike`), for every bite (the bite, a string's
  bite, the lunge bite, the rear bite): over the windup's last 0.1 s the chest drops and pitches into the strike off
  the locked hind feet, a little past the strike's own body, and the whole body surges 0.4 model units toward the
  hero (not when it is already within 4 units: a lunge reads from the high camera where a neck reaching at the
  lens does not), while the head HANGS where it was (its goal frozen in the world: the neck compresses under it).
  The snap then runs the head from there to the bite's goal on a fast-in path (0.35 linear + 0.65 quadratic) that
  arrives ON the impact, and the body settles back over 0.12 s. It replaces `strikeLead` (the shown head easing in
  over the last three frames) while on. The hit spheres, the goals, the windups, the cue and the impacts are the
  same code; the surge brings the jaws 0.75 m nearer.
- **Not taken (yet):** the forelegs' rod-straight sweep (bringing the sweep's end within reach would bend the elbow
  but move the paw's hit spheres: the AI's ranges are sim-measured coverage); the wing blows' fingers trailing the
  arm (the wing's hit spheres ride the finger tips); the feet's skating (the gait's re-step). Listed in the ROADMAP.
- **Consequences:** measured with `a` (wyrmanatomy), every bite: the body (hips, chest) reaches top speed 50 - 117 ms
  before the head (was 0 - 17 ms); the jaws' gap at the impact 0.17 - 2.07 m (was 0.79 - 3.10; the single bite 1.77
  -> 0.99, the claw combo's lunge bite 3.10 -> 2.07, the Hesitant Maw's rear bite 2.33 -> 1.16, the sky hammer's
  bite 1.38 -> 0.45). The bite's hit sphere (1.05 x SCALE) still meets the hero a frame before the drawn jaws touch.
  At the game camera the change reads mostly as the surge; the head's hang and snap show best from the side.

## ADR-258 — The meteors' roar with the head held naturally (`?wyrmHead=`) (2026-11-27)

- **Context:** the owner: "The dragon's head twists too far back and looks unnatural when it raises its head up
  to shoot fire." That is Meteor Rain's rear-up (the apocalypse, look a): its neck was keyed to swing back past
  upright as it rose (the head goal 0.9 units ahead of the root, behind the neck's base at 1.7) and the head looked
  at a point 40 m up just ahead of the root. Measured (integ `wyrmhead`, opt-in: every fire move's snout against
  the body): the snout 90° up in the chest's frame and **15° past vertical toward the tail**, the head 0.43 units
  **behind** the neck's base, the brow rolled 149° about the snout (the head over on its back). Every other
  ground fire move stays under 56° up and never past vertical.
- **Decision** (`?wyrmHead=a`, the default; `0` as before; the Lab's LOOKS row `wyrmHead`): through the rear-up and
  the cast the head rises up and forward over the forelegs (root frame (0, 7.6, 2.3): ahead of the neck's base),
  and the roar's look point is 40 m straight above it. The rig's head limits do the rest: the snout ends 66° up
  in the chest's frame (the reared body leans back, so it is near vertical in the world), never past upright, the
  head 0.81 units ahead of the neck's base. The sky fire, the bolts, the timing and the tell are unchanged.
- **Consequences:** at the game camera the fire column now rises from a head held over the forelegs and leans a
  little toward the hero instead of over the wyrm's own back. The flights' head (skyStrafe's recovery, the
  cataclysm's wheel) also measures past vertical in a banked body; not changed here (the owner named the head
  raised to shoot fire).

## ADR-259 — Blows land on what they strike: the bite and follow-through, the guard met, the struck part answering, an optional reach (`?contact=0|a|b`) (2026-11-27)
- **Context:** the owner: "make every hit, deflect, guard, parry, deadly blow etc any hit against a bosses's weapon,
  fist, body, etc look like its actually hitting that part and clean. There are some moments it looks like the
  weapon is just going through the boss or player unrealistically. We don't need to be perfect but make sure every
  hit or clash looks good from the players camera perspective. The player or boss should also have a flinch or
  reaction on how they're hit." Their picks before the work: the blade bites then follows through (heavies hold
  longer), both ways; reactions by where and how hard; shared code only (the boss motion sessions own every move's
  data and the hero's swings); a draft PR with before / after films, behind a switch with a Lab row.
- **Measured first** (an in-page audit at every contact of every duelist: his every move on the hero standing,
  blocking and parrying, and the hero's cuts on him staggered and on his guard; the drawn striker (steel guard → tip,
  or the striking limb's end as a ball) against capsules on the struck rig's joints, in every frozen frame):
  the drawn striker was as often 10 - 75 cm SHORT of what it struck as 10 - 40 cm
  THROUGH it, the hit-stop holding that frame: a boss's blow through the hero in 20 % of hits and through his guard
  into his body in 24 % of blocks (the blades 0.38 m apart), the hero's cut through the boss in 50 % (short in 18 %)
  and through his ward in 58 %; the hurt sparks 0.56 m from the meeting (on the hero's chest), the block's 0.61 m
  (mid-blade). 56 % of the bosses' hits were 10 cm+ short (the fist bosses 60 - 86 %). Parries met (ADR-079: 1 cm).
- **Decision** (`combat/contact.js`, `CONTACT`; behind `?contact=`; `b` the default, the owner's pick from the
  before | a | b films of every boss, 2026-11-27; `0` as before, `a` without the reach):
  - `a`: the striker is posed where it meets the struck surface for the frame the freeze holds, found along its own
    clip (back ≤ 0.16 s where it went through, on ≤ 0.075 s where it fell short; steps of 1/120 s and three
    halvings): a blade's edge 3.5 cm in (a thin part at most 0.4 of its radius), a fist or foot on the surface. The
    pose shown is pinned there (a duelist's `brain.pin`, the hero's `atk.pin` / `atk.show`) through the freeze, a
    heavy blow 0.06 - 0.07 s longer, then catches up with its clock over 0.06 - 0.07 s. A duelist's gameplay points
    (his hurt spheres) are taken on the clip's own time before the pinned pose is drawn. A block stops on the
    hero's blade or 12 cm before his body, the guard nudged onto the blow (`guardNudge`, the animator's
    `gripNudge`, ≤ 0.3 m, 0.3 s); a cut on a boss's guard the same way on his steel (`_wardOnto`). The hurt, block
    and cut effects are drawn at the meeting; a blow that never comes within 0.16 m has its hurt drawn on the hero
    where it points (the wyrm's snout, toe or tail tip the same: `takeHit({ point })`). The hero wears the duelists'
    `HitReact` (×1.2, drawn after his sweep is read); a boss's reaction is told the capsule the steel met (`limb`), and
    the layer gains the arm (that shoulder knocked back).
  - `b`: `a`, and a boss's blow that would fall short of the hero in its zone is reached into: 0.14 s before its
    impact his drawn body eases toward the hero along the gap (≤ 0.3 m, feet planted, legs solved again), held through
    the bite, eased back over 0.22 s.
  - Presentation only, proven: duel / asc `contact` play one scripted exchange with `0`, `a` and `b` and compare every
    result, damage, health, guard, posture and the clip time each blow landed on.
- **After** (the same audit): with `a`, hits through the hero 6 %, blocks through the guard 4 % (blades 0.12 m
  apart), the hero's cut short 3 %, through his ward 3 %; the sparks 0.02 - 0.11 m from the meeting. With `b`, short
  hits 56 → 47 % (Tian Lei 71 → 37, Halcyon 58 → 15), blocks short 43 → 26 %. Headless (duel / asc `contact`):
  through the hero 41 / 33 % → 0 %, Tian Lei's short hits 64 → 32 % with `b`; every result identical.
- **The second round** (2026-11-27, the owner: "work on not covered stuff next"): the execution's and the plunge's
  bursts at the steel's entry (`player._plungeEntry`); the wyrm's short bite drawn onto the hero (`dragon.strikeContact`,
  `pose.headContact`, eased in on real time, its neck's reach the limit: 1.27 → 1.06 m); `?contact=c` (a drawn step past
  the reach, `CONTACT.step`), measured as closing little and kept as an option. What stays short is move data: a
  string's later blows hitting a hero knocked a metre back, the wyrm's bite sphere 1 - 1.8 m past its jaws.
- **Not taken (yet):** the wyrm's poses (its own clock; its jaws are still 0.3 - 1.5 m short when its hit spheres
  connect, ADR-257's finding); the execution's thrust, the plunge and the flurry's cuts (each its own drawing, filmed
  for the owner); blows whose hit zone reaches past the drawn limb by more than the reach (kicks such as Tian Lei's
  Comet Heel, 0.8 - 1.3 m): their move data, the boss sessions'.
- **Consequences:** a hit costs a few extra animator poses on its frame (the search: ≤ ~14 for a duelist, ≤ ~12 for
  the hero), and a pinned duelist one more pose a frame for ~10 frames; `b` one probe pose a frame for the last
  0.14 s of each blow's windup. Nothing per frame allocates; nothing new is drawn.
## ADR-261 — AUTO BENCH: the readout benches by itself in a fight (2026-11-27)

- **Context:** the owner asked not to have to tap BENCH at the laggy moment: "make it so i can just press a
  button or it captures the required data moment i load the link and press it to give the results".
- **Decision:** with `?perf`, BENCH runs by itself in a fight: once 8 s in (a typical frame), then on each
  slow burst (6 of the last 30 frames over 20 ms: the heavy moment, measured as it is on screen), 10 s apart,
  4 in all, each a lighter bench (~1 - 2 s of hold on a phone). The owner loads the link, plays, and taps
  REPORT. `?perf=manual` leaves it to the button. Each bench says why it ran, AUTO's step and the lite world.
- **Consequences:** the game holds still for a moment up to 4 times in a fight with `?perf` (only then); the
  frame after a bench is left out of the frame statistics. Not tried on the phone yet.

## ADR-229 — The run from the owner's sketch: the blade trailing in the forearm's line, the free arm opened out (2026-11-26)

- **Context:** the owner (2026-11-25): "modify the running animation. from the back the left arm seems way too
  pressed in and makes it seem like he has no left arm during the run. also have the sword be in this angle when
  he's running instead of it being held in the front", with a sketch: an arm coming down to the fist, a long
  straight blade going on in the forearm's line, slanting down ~35-40° below level, the point well past the hand.
  Measured on the drawn frame from behind at the game camera's pitch (the hero alone rendered as is, without the
  free forearm, without the arm, without him: image masks, so the camera lean's shear is what is measured): the
  default free arm (`d`, ADR-204) stood clear of the coat's outline on 10-40 % of a stride's rows, its median gap
  to the coat -0.5 … 0.4 cm (it hugged the coat's edge). The sketch does not say which way the point faces nor how
  far the arm hangs back; "instead of it being held in the front" says the point is not ahead.
- **Decision (options; the defaults unchanged until the owner picks):**
  1. **The free arm `e`, open** (`runArms.js` `RUN_ARMS.open`, `?runArm=e`): `d`'s pump with the upper arm ~20°
     off his side (+6° more on the back swing), the forearm hardly crossing in front (10 - 16°), keeping most of
     the stand-off (`side` 0.95). From behind its forearm is clear of the coat on 90-100 % of the stride (a 9 - 12
     cm median gap); in the body frame the hand stands 32 - 39 cm out from his centre line (d: 13 - 26), the
     elbow flares 0.48 - 0.54 (d: 0.26 - 0.30) and still works 31° a stride. **`f`, wider** (`RUN_ARMS.wide`): a
     step further (28 - 30°, no cross): clear on all of the stride (15 - 18 cm), flare 0.63 - 0.68.
  2. **Three trailing sword carries** (`runSword.js`, `?runSword=trail|swept|side`): the arm by forward
     kinematics as in `hip`, the blade going on from the forearm's line behind him (lifted `tilt` off it, turned
     `yaw` out to his right, its slant held in `down`), rocking with the arm's swing. `trail`: the arm hanging a
     little back, the blade 27-45° below level on the run (22-36° at a sprint); `swept`: the arm swept back, 13-30°;
     `side`: out to his right and back (azimuth ~128°), 15-41°: from the game camera behind him, the sketch's
     diagonal. The wrist (forearm vs blade) 15-40° (`old` 57-84°, `hip` 54-77°: a hammer grip). The steel at
     least 20 cm off the legs, never through the coat's skirt, the point at least 24 cm over the grass.
  3. **Out of a trailing blade into a block, a parry, the flask or a charge** (`HeroAnimator._idleLife`): the
     clip's entry takes `IDLES.cutFade` (0.24 s) at least, as out of the old trailing rest: in the block's 0.08 s
     the blade turned 75° in a frame, the point 1.2 m a frame² (`old` did the same). Now 15-23 cm (hip: 26).
- **Not changed:** the fight carry (`FIGHT_RUN`), the backpedal's guard, the sprint's blend over the carry.
- **Consequences:** HERORUN measures every arm and sword carry (the wrist, the steel vs the legs and the coat
  newly) and bounds `e` / `f` both ways (out past the coat, never a wing) and the trailing carries (behind him, the
  slant, in line, clear); HEROARMS's elbow-in check skips an opened free arm, HERORUN holds it. Known: setting
  off from a rest that holds the blade up (an idle action mid-draw) turns a trailing blade up to 11° a frame (the
  point 8.6 cm a frame²; hip 5.4); with the aim swung behind him the backpedal guard swings it round at 12-15 cm a
  frame² (hip 8, `old` 13); out of the opened arm into a block the free wrist jolts 2.7 (e) / 4.2 (f) cm more than
  `old`.
- **Amended (2026-11-26), the owner's pick and the straight arm:** "Arm e and trail but the right arm needs to be
  straight during the trail running animation instead of having an angle. Right now it looks unnatural with the
  angle." Why it bent: `trail` asked for a 166-170° elbow, but the solver's soft reach (ADR-044, `HERO_SOFT`
  0.93-0.99 of the arm's length) compresses any near-full reach, so it drew 151° (at most ~163° whatever is
  asked), and the blade, aimed off the asked forearm, sat 23-36° off the drawn one. Now: `RUN_SWORDS.trail.open`
  asks the solver for the sword arm's full reach (`OUT.open` → `A.reachT` from the loco clip's own pose, scaled by
  the carry's share: the sword's lag, the backpedal, the fight carry, a held guard; `_swordOpen()` cross-fades it
  from where the last clip left it, like a pose channel, without one: the light chain's open PR adds channels;
  `_arm` takes `max(lock, open)` in the soft reach only). The arm: 36° back (30° at a sprint) ±9-11° with the
  stride, 22-24° off his side, straight: the hand asked 3 % past the arm's length (`over` 1.03; the solver stops it at
  176°). Asked at exactly its length it drew 168° (the hand is aimed from the grip shoulder, 8 mm in from the arm's
  own, and near a full stretch 3 mm of reach is 11° of elbow), a kink the owner still saw from the game camera:
  "Make the right arm have a smoother angle during the run". The blade 2-3° off the line, 22-24° out: 1-5° off the
  drawn forearm. Slant 25-45° below level (21-35° at
  a sprint), the steel 30+ cm off the legs, 13 cm off the coat, 25+ cm over the grass. Setting off, the arm opens
  out of the stand's 84° elbow over the sword's lag (~0.8 s). **Defaults now `?runArm=e` and `?runSword=trail`**,
  the variants the owner chose from the films and the preview; `d` / `hip` give the run before. Against main's
  `d` / `hip`: the block entry gentler (the point 20 cm a frame² vs 26), the run, the sprint, the light, the roll
  and the flask as smooth; rougher: the aim swung behind him (15 vs 8 cm a frame²) and the stop (4 vs 2); the sword elbow letting go of the
  straight arm jolts 2.6 cm a frame² at a stop (0.7) and 6.5 into a roll (4.2).
- **Amended (2026-11-26), out along the owner's arrow, a relaxed arm:** the owner on the preview, with a
  screenshot from the game camera and a red arrow from his hand down and out to his right at ~45°: "no the right
  hand now is too straight back. the new angle is too much. the arm angle also looks unnatural too. i want the
  sword and arm to be more on the red angle direction and ensure the look of his arm, motion, and animation
  looks good and natural". Measured on the drawn frame at the game camera (the screen angle below the
  horizontal, toward the screen's right): the straight-back arm 74°, its blade 74-75° (nearly straight down the
  screen, over his back). Searched live against that: `trail` now hangs the arm out from his side (40-42°
  off it, the forearm kept out, `side` 1.3), the shoulder 16° back ±10° with the stride, the elbow soft
  (asked 154-166°, drawn 154-161°; `open` keeps the asked elbow, `over` 1), the blade lifted 44-46° off the
  forearm's line and turned 62-64° out: azimuth 114-121° (90 is his right, 180 behind), 23-35° below level
  (13-26° at a sprint). At the game camera: the arm ~57°, the blade ~48° (rocking 45-50°; 42° at a sprint),
  the owner's arrow. The blade 21-28° off the drawn forearm (a light wrist turn). The steel 47 cm off the legs,
  31 cm off the coat, 40 cm over the grass. `trailing()` now floors the blade's angle AFTER the lift (floored
  before it, a forearm swinging past vertical froze the blade). Against main's `d` / `hip` it is smoother than
  either version before it: the run, the sprint, the start and the strafe at or under main; the block entry 12.5
  cm a frame² (26); rougher only the aim swung behind him (11.5 vs 8).
- **Amended (2026-11-26), redone, then the natural hold (`nat`, the default):** after the arrow carry the owner
  asked for the run redone "with the sword flailing out" (`flail`: the blade hangs from the hand and swings a beat
  after the arm, `pendulum()`; "looking better but ... the sword angle being too far out"), then for "4 different
  variations of different sword angles ... a solid back angle running animation" (`b15` / `b25` / `b35` / `b45`:
  the blade held 15-45° out from straight back, swaying 2-3°), liked A (`b15`) but not its arm ("extending out and
  above the back"), then four arms brought in (`a1`-`a4`), then: "all of them look unnatural from the user camera
  perspective. figure it out and make it look good, natural, and anatomy wise correct". **What was wrong with every
  carry since the sketch:** they put the blade in (or near) the forearm's line. A fist holds a sword's grip across
  the palm, so the blade leaves the hand at about a right angle to the forearm and the wrist tips it at most ~30-40°
  toward the forearm's line: a blade 15-40° off a hanging forearm is a grip no hand makes, and from the game camera
  it read as a pole hanging from his fist. **`nat`:** the arm relaxed at his side (8° back ±8° with the stride, 16°
  off his side), the elbow soft (asked 156-142°, drawn 138-155°), the fist by his hip, the blade 45-82° off the
  forearm (a hammer grip; `old` 57-84°), behind him and a little out (azimuth 143-149°), 9-22° below level,
  swaying ±2-3° (`pendulum()`). At the game camera the blade is a diagonal ~61° down the screen (58-64°). Clear:
  the legs 22 cm, the coat (no crossing), the grass 46 cm. Against main's `d` / `hip`: the run and the sprint
  steadier (the blade turns ≤ 1.1° a frame), the block entry gentler (15.5 cm a frame² vs 26); rougher: the aim
  swung behind him (12.6 vs 8.4) and setting off (the blade turns 5.8° a frame while the stand hands over).
  Every carry tried stays behind `?runSword=`.
- **Amended (2026-11-26), the natural hold's arm:** the owner: "something about the arm joint angle looks unnatural
  from the player view. also the side view doesnt look good". Measured in his body frame: the arm's angles are
  against the leaning torso (17° running, 31° sprinting), so `phi` -8 hung the upper arm ~30° behind plumb while
  the forearm hung straight down: the elbow jutted back in a V. Now `phi` is ahead of the torso's line by about the
  lean: `nat` hangs the upper arm ~3-14° behind plumb (the elbow 151-162°, bending forward about a lateral axis,
  its tip straight back), the fist at the hip, the blade 67-89° off the forearm; `n1` plumb, the fist ahead of the
  hip (elbow ~150°); `n3` ~10-24° back, the fist behind it (elbow ~165°).
- **Amended (2026-11-26), rebuilt from the hand's grip; the owner picked G2:** "all look bad. try again", ticking
  the sword pointing back, the fist / wrist / grip, a stiff arm and the whole run, "you decide". `fistBlade()`: the
  blade set in the fist, not in the world: the thumb faces `thumb` degrees round the forearm, the blade leaves the
  fist on the thumb side `grip` degrees off the forearm's line, the flat lies across the knuckles (square to the
  forearm and the blade: the fist never twists); the arm swings as a runner's (`RUNNER`: the shoulder 10-13° each
  way, the elbow 162 → 142°) and the blade rides with the hand; `top` the wrist's cap on the point's rise. A relaxed
  hammer grip's thumb faces forward, so it carries the blade forward and down; pointing it back needs the forearm
  wrung round (what every trailing carry read as), or a reverse grip. Three concepts: `g1` low ahead, `g2` the
  point down, `g3` a reverse grip. The owner: "g2 but make sure the arm and sword doesn't clip with the cloak
  fabric" (the films showed the steel against the cloth: measured on every coat panel and cape streamer, densely,
  it passed within 0.3 cm). **`g2`, the default:** the hand 18° off his side, the thumb 55° out, the grip 46-48°,
  the point held 11-30° below level, azimuth 39-63° (ahead and out): the steel ≥ 12.6 cm off every cloth sheet
  on every stretch, ≥ 22 cm off the legs, ≥ 33 cm over the grass, the wrist 30-48° (a dropped wrist), the elbow
  133-159°. The block / parry / flask / charge entry's 0.24 s now also covers a blade pointing down (`swD.y` <
  −0.15): from `g2` the block swung the point 47 cm a frame² (now 6; main 26). HERORUN measures the cloth gap
  (`clothGap`) for every carry and bounds `g2`. Against main: the run's point moves more (it rides the arm: 3.8 vs
  0.8 cm a frame²); the aim swung behind him 13.8 vs 8.4.
- **Amended (2026-11-26), the free hand on guard (`?runArm=g`, the default):** the owner, of `g2` with the opened free
  arm: "looking better but i want to make him look cooler when he runs"; four run styles over the posture
  (`player/runStyle.js`, `?runStyle=hunter|dash|coiled|ghost`: more lean and sink, the free arm swept back, a
  bladed chest turn, a low glide; the default stays `base`) were turned down; with a photo of a swordsman running,
  his free fist at his hip: "his left hand is moving around too much, lets make his hand like this pose" (`h`: the
  fist pinned to the pelvis at the belt, moving ~1 cm against it), turned down ("the angle looks really unnatural
  and weird"); then "make his left in a pose like hes guarding his face and chest with his left hand and make it
  look natural during the movement run". **`g`:** the fist placed before his chin, a little left of centre (chest
  frame (0.07, 0.34, 0.29) m from the chest joint), the elbow's pole down before the ribs, the solver bending the
  arm; both turned by the spine's and the pelvis's rotation as posed (it leans and twists with the torso); a little
  give with each landing (1.2 cm) and the stride (1 cm). It moves 0.3 cm a frame² on the run (the swinging arm
  1.2); into a light, a roll, a block or the flask no rougher than before. From straight behind the guard sits in
  front of his body, under the cape. HERORUN bounds it (the fist ahead, inside the shoulder line, up, held).
- **Amended (2026-11-26), the guard turned down:** "lets revert back. i dont like the new guarding pose as it looks
  really bad from the other angles. lets go back to the left hand variations". The default free arm is `e` again
  (the opened pump the owner picked); `g` (the guard) and `h` (the fist at the hip) stay behind `?runArm=`.
- **Amended (2026-11-26), the free arm `a`; the sword hand's grip:** of the free arm's variations the owner picked
  `a` (natural), "but the right hand and sword looks off and unnatural. review it and figure out the right anatomy
  to hold the sword on that right hand while running". The sword hand is drawn in two pieces: the back of the hand
  on the forearm, the curled fingers, the thumb and the knuckle ridge on the sword (`gripFist`: the thumb on the
  +Y flat, the ridge on the +X edge). Measured where the forearm (elbow → wrist) comes into the fist, in the
  sword's frame: his stand at ease (−0.27, −0.24, 0.93) and his fight guard (−0.20, −0.62, 0.76), both approved, come
  in opposite the thumb, a little toward the −X edge, the blade 20-40° off the forearm; `g2` came in at (−0.60,
  +0.32, 0.73), ON the thumb's side (the thumb wedged between the wrist and the grip: a fist wrung round), `old`
  from the knuckles' side. `fistBlade()` now rolls the fist so the forearm comes in opposite the thumb, turned
  `twist` 30° toward −X: (−0.32, −0.60, 0.74), between the two approved poses; the flat shows to the game camera
  (|n·cam| ≥ 0.63; edge-on under ~0.3 vanishes). `g2`'s wrist cap is 26° (the point 8-35° below level).

## ADR-264 — The parry → deathblow exchange read by a watcher: a break beat, space, a clean contact (`?dbread=0|a|b|c|all`) (2026-11-27)

- **Context:** the owner watched a bot parry Shen Hui's Riposte (a diagonal cut, then a blue thrust) into a deathblow
  and could not tell what happened between the parry and the deathblow: "i never want the game to have certain
  animation/actions that is not understandable to the player watching the action". They like the deathblow itself
  (ADR-211: Shatter Web, Flesh). Measured in that exchange: the combo starts 0.11 s after the parry, and his parried
  recoil (the readable "he is open" pose) is replaced by a flinch 0.15 s later, so no beat or pose says he is broken;
  the centres stay ~1.0 m apart through the whole combo (he dashed in for the thrust, the deathblow never steps nearer
  than 1.0 m, nothing pushes him back), so at the game camera the two bodies stack into one shape; each contact's
  heat flash runs on the hit-pause's slowed clock (0.08 s of life lasts ~0.5 s real), his white hurt flash (0.8)
  lights his whole body, and on the finisher the hero's own thrust streak and impact burst bloom into a white blot
  (hiding each scene object in turn and counting the bright pixels: his body and the shared glyph particles, then
  the particles' spawns by caller), so the contact is covered. (The white star at the blades before the thrust is his blue tell
  glint, a gameplay cue: kept.) The effect switches barely changed it: the look is built in.
- **Decision:** three ideas, one each, behind `?dbread=` (the Lab's `dbread`; `DEFENSE.deathblow.read`,
  `DBFX_TUNE.clean`), read at the parry, damage never changed:
  - **a, the break:** on the parry that starts the combo he is thrown into his `reeling` (jian flung wide, arms out,
    stumbling back; recoil / stagger for a kit without it; a posture-broken foe stays on his knee) and the hero holds,
    unhurt, `beat` 0.35 s after the parry; the first blow's wind-up is at least 0.2 s and steps in up to 1.0 m. The
    blows land on him while he reels (duelist `takeHit` `keepOpen`: no flinch while 75 % of the reel is still to run).
  - **b, space:** every blow steps in after him to 1.3 m centre to centre (at most 0.55 m; nearer, a non-final blow
    steps back up to 0.3 m for room, as against a foe broken on one knee, who is never shoved), and every non-final
    blow drives him back 0.3 m (`takeHit` `shove`: his flinch's travel).
  - **c, a clean contact:** each contact's heat flash 0.45 x as wide, moved 0.7 m out of his far side along the blow
    and aged on the real clock (gone in the hit-pause's first frames instead of held through it); the exit burst's
    spray 0.4 x, its tip streak 0.6 x as long and held half as long; his hurt flash 0.3 instead of 0.8; the finisher's
    thrust draws no white `thrustStreak` (measured: the brightest thing on screen at the finisher, by far) and every
    blow's impact burst (`PlayerFx.contact`) is the low quality's lighter one (`lite`). Shatter Web's cut line, the
    blood and the parry's own sparks at the blades stay.
  - `all`: the three, **the owner's pick from the films and the default** ("all is fine"). `0`: as before.
  - **The strike gap** (`?strikeGap=0|a|b`, `duelist/strikeGap.js`, the Lab's `strikeGap`), asked for next: "during
    the parries you cant see the swords parrying and clashing with each other because the characters are clumped
    up". Shen Hui's step-in aims at 0.66 - 0.72 x a blow's reach and his Riposte thrust's dash stops 1.0 m from the
    hero: the cut was parried at 1.42 m, the thrust at 1.01 m. A floor on how near a duelist's own root motion (the
    windup's step-in, a dash, authored travel) brings him for a BLADE blow (`_part` marks a bare-handed kit's limb:
    left as authored), capped at 0.85 x the blow's reach so every blow lands where it did: a 1.5 m, b 1.8 m (the
    parries at 1.5 / 1.5 m and 1.8 / 1.7 m). The owner picked b; **as a default it broke Shen Hui's authored lunges**
    (duel `ashform`, ADR-250: a dash stopped short leaves his back knee bent at impact, at 1.5 m as at 1.8) and Lu
    Wusheng's Thousand Li (a dash THROUGH the hero, stop -3: now never floored). So it is left to dashes only (not the
    windup's step-in nor authored travel, which footwork is keyed to) and **off by default** until that trade is
    decided with the owner (re-key his lunges for the room, or keep the spacing as authored). Seen zoomed: the spacing shows
    the bodies apart up to the contact, but on a perfect parry the gold clash, its mark and its spark spit (ADR-181)
    cover the hero's chest, where the blades meet, at any gap.
  - **The clash's size** (`?parryClash=0|a|b`, `combat/perfectFx.js`, the Lab's `parryClash`), the owner's "Yes,
    film it": the perfect parry's mark (its gold X opening into rings up to 0.52 m) and its gold clash burst drawn
    smaller, one idea in two steps: a the mark 0.55 x with its rings, the burst 0.6 x; b the X alone at 0.4 x, the
    burst 0.4 x. The spit of orange sparks off the steel (ADR-181) is left as it is. The owner picked b, then on a
    closer look turned the whole gold parry burst down ("doesnt look good, doesnt feel like a parry effect, and
    covering too much of the action. replace this with something better") and with it the big white star with a
    ring, which is the BLUE TELL (his parry cue, not the parry). Replacements: **c** no gold burst and no rings, a
    pinpoint where the blades cross (the mark's X at 0.12 x, a cell or two) and the spark spit carries the parry;
    **`?blueTell=a`** (duelist/fx.js `TELL_GLINT.blueSmall`, the Lab's `blueTell`) a small cross on his blade (4 x 2
    cells, no rays, no ring, held as long), dyed blue by a fire-field tint zone as the flares are, with a blue sparkle
    and light. **Both the owner's pick from the films ("Yes, new look") and the defaults** (`?parryClash=0` /
    `?blueTell=0` as before); filmed
    with the 1.8 m gap beside today. Seen in the same zoom: the largest thing on screen before his thrust is his blue
    tell glint (a star and ring) right over the hero where the blades will meet; a gameplay cue, left as it is.
- **Consequences:** a adds 0.35 s between the parry and the combo and 0.08 s to the first blow (the combo's own
  tempo after that is unchanged); b and a let the hero leave ADR-211's 0.6 m disc round where he parried. The duel
  suite's `deathblow` (f) plays every mode on a posture break and a blue parry: the same blows and damage, the beat,
  the reel kept, the spacing, the dim flash; (g) the strike gap's floor with every blue blow still parried. The
  older parts (a) - (e) pin `?dbread=0` (they measure ADR-211's combo as built).

## ADR-266 — Bai Wuji round 4: a cut on the barrier chips him, his health 16000, the barrier shows a patch of itself where each cut lands (`?wjStrike`); no floor ring (2026-11-28)

- **Context:** the owner after the glide (ADR-250): "it takes too much time to chip at him", "balance it to be bit
  easier to do damage on him"; and "when the player hits him and the sword is hitting the barrier, show a cool ascii
  effect of the sword hitting the barrier and it showing its silhouette briefly". A stop dealt nothing and drew a
  small ripple of rings (ADR-241).
- **Decision:**
  1. THE CHIP (`wjBarrier.chip` 0.25, `barrier._chip`): a cut stopped on the shell still takes a quarter of its
     damage off his bar: no stagger, no posture, never his last HP (the shell is no way to kill him), his phase
     gates hold. The stop's event `dragon:barrier { state 'stop' }` carries `damage, x, y, z` when it chipped; the
     HUD prints the number there. Bots seldom cut the shell (they cut in his openings), so the bench barely sees it
     (good bot 163 - 211 s -> 160 - 187 s); a person cuts it often, which is what the owner felt.
  2. HP 20000 -> 16000: the good bot 4 of 6 in 120 - 150 s (2.3 min; 2.8 before), its two deaths with 5 % of his
     bar left; fencing 5 of 6 in 87 - 115 s. The blocker and pace bots still die (they never cut).
  3. THE PATCH (`untouched/fxStrike.js`, `?wjStrike=a`, PICKED; `0` the ripple as first shipped). Three tries the
     owner turned down: three looks, each a wave of light (the shell's oval, his outline, rippling outlines); then
     his body's whole outline for the hit ("this looks bad"). Their words: "it should always show up on every hit
     that [the barrier] is blocking ... doesn't have to be a perfect outline of the boss character and should be
     like a cool subtle ascii invisible shield briefly showing per hit on the hit location". So every cut stopped on
     the shell shows a PATCH of it where it landed: a faint net of crossing strokes on the shell's surface, opening
     from 0.3 to 0.8 m round the point (x1.25 heavy), brightest there (heat 0.55), soft to its edge, cut off at the
     shell's outline, gone in 0.22 s (0.29 heavy). Six can show at once (every hit has its own). Nothing else of the
     stop is drawn. One stroke per letter cell a frame. Sheet: `docs/looks/veil/wjStrike-patch.jpg`.
  4. NO RING ON THE FLOOR: the ring that counted an opening down round his feet (ADR-241's open sign) is off, the
     owner's call ("get rid of the circle below [him]"); `?wjSign=1` draws it.
- **Consequences:** the fight is about a fifth shorter, and cutting his barrier is no longer wasted: it chips
  him and shows the barrier where it struck. The opening has no floor sign now: its burst, and his cuts landing,
  show it. Open: whether the chip wants its own sound.

  3. THE SILHOUETTE (`untouched/fxStrike.js`, `?wjStrike=0|a|b|c`, PENDING: the owner picks from
     `docs/looks/veil/wjStrike-options.jpg` and the preview): a, the shell's whole oval lit round from the point;
     b, his outline, the shell as it hugs him a hand off his body (his mesh points on the camera's plane, a distance
     field, marching squares; every segment runs with his body on its left so the strokes never print twice); c,
     that outline and two wider ones, a beat apart, rippling outward. A wave runs out of the point at 8.5 m/s, a
     crest at heat 0.8 cooling to 0.45 of it, gone in about half a second. All heat in the fire field on the letter
     grid (`fx._ink`), as the house style asks; the stop's white point, its push of air and its shards stay; '0'
     keeps the ripple.
- **Consequences:** the fight is about a fifth shorter, and cutting his barrier is no longer wasted. Open: the
  owner's pick of the look; whether the chip wants its own sound.

## ADR-270 — The finish: one tap to begin, game-menu buttons, a new pad, controls that fit the screen and move (2026-11-28)

- **Context:** the owner: "i dont like you have to press it 2 times to start the boss. just one time click on the
  line bar or begin here needs to start it. boss rush and begin here buttons look really bad. make the buttons and
  menus look more polished professional like a real game." On the phone: "replace dodge with block and put dodge
  right below the attack button. put the flask button where the block button was. make the game auto lock on the
  boss in the beginning of the fight", the phase call ran over the HUD, and on a small passport-shaped phone the
  controls were all too big; "place the right controls a little more to the left", and let them be moved with
  "a small unlock/lock button" that keeps the place.
- **Decision:**
  1. ONE TAP: the title's entries selected the world on `mouseenter` / `focus`, which re-draws the detail
     panel. iOS Safari takes a tap whose hover changes the page as a hover only and wants a second tap for the
     click. Selection now follows a MOUSE's `pointerenter` and a keyboard's `:focus-visible` only; a tap acts at
     once (travel, begin, the rush).
  2. THE FINISH (`titleMenuStyle.js`, `hudStyle.js`): two corners cut off every button and panel, a hairline
     frame, an ember rule along a panel's top. BEGIN HERE is an ember-filled button (a sheen on hover, the chevron
     steps out, a small press); TRAVEL the same shape, cooler, so BEGIN stays the hottest thing; BOSS RUSH (first a
     gold card under the panel; the owner: it "looks out of place" and left "a lot of empty space on the right")
     is one panel with the world: the world's lines on the left, BEGIN HERE / TRAVEL and BOSS RUSH stacked on the
     right (side by side under it, upright), BOSS RUSH an ember outline on the dark, its line and its best; WHAT'S NEW / CONTROLS / CLOSE quiet cut frames that
     light ember. The pause menu's buttons and panel take the same cut and an ember edge on hover / the pad's
     focus. Held upright, the open world's panel sticks to the bottom of the list (BEGIN always on screen).
  3. THE PAD (`CONFIG.touch.pad`): FLASK | HEAVY over BLOCK | ATTACK, DODGE under ATTACK; ATTACK touches the
     other three tiles (the slide still runs between them). PAD POSITION's places are 30 - 36 px further in.
  4. THE FIT (`pad.fit`): the whole touch layer scales with the screen (short side / 390 and long side / 760,
     the smaller, 0.62 - 1.25), the stick included; it replaces `pad.tall` (x 1.14 above 560 px).
  5. THE PADLOCK: a small padlock over the pad; open, the pad drags (nothing presses), RESET puts it back;
     shut, the place is kept in `gcd.touchPad` (`off`).
  6. LOCKED ON AT THE START: on touch the fight begins locked on (`touch.autoLock` 4 s of tries while the boss is
     out of range); the gamepad and the mouse unchanged.
  7. THE PHASE CALL (`banner.js _clearHud`): its middle goes below the lowest of the player's frame and the boss
     bar (half its height and 10 px under them), never above 21 % nor below 42 % of the screen.
- **Consequences:** a player who learned the 2 x 2 square finds DODGE and BLOCK moved (the owner's call). The
  look options (2) were not offered as variants: the owner asked for the finish itself; `?menu=0` still shows
  the oldest title. Open: the owner's verdict on an iPhone and on the small phone (the fit's floor 0.62 may want
  to be higher for thumbs), and whether the mouse and pad want the start lock-on too.

## ADR-271 — The blackout for a black blow, red trails for a red string: options behind switches (2026-11-27)

- **Context:** the owner sent a Phantom Blade Zero boss fight as the reference for combat feel and approved two of
  its looks. At 0:17 a charged attack: over about 0.3 s the whole picture drains to dark grey, only the boss stays
  readable with a white glint on her blade, colour snaps back on the strike. At 0:34 and 1:17 a red string: every
  cut leaves a long thin red crescent. Today a black blow is drawn violet (an eclipse with violet strokes on the
  striking part, the body darkened violet, the flare dyed violet, the screen's edges dimming), and a red blow's cut
  is the same white steel as any other. Owner rules: no background colour change on a parry or dodge (the blackout
  is their explicit exception for BLACK blows only); for red "the flare stays the timing cue, nothing before it"
  (ADR-118); a look change is shown as films and the owner picks; the default is what the owner approved.
- **Decision:**
  1. THE BLACKOUT (`?black=0|a|b|c`, `combat/blackout.js`, default `0` = today). A grade in the final pass
     (`uBlack`): the world's colour drains and its light drops; the boss is kept whole and the hero partly, found
     on the scene's ASCII flag (sceneRT alpha), spread by part of a letter cell; a letter above a light keeps its
     light (the flare, the glint). The HUD is DOM and untouched. The violet goes in it (`TELL_STYLE.black.pale`):
     the flare undyed (a white-hot streak), the charge a white point with pale motes drawn in, no darkened body,
     no dark screen edges. Variants, one dimension apart: a the film (dark over the last 0.3 s before the cue), b
     the dark built through the whole charge, c as a, darker. It holds 0.3 s past the cue (the strike) and comes
     back in 0.08 s of REAL time (a hit-stop must not hold it).
  2. DRIVEN BY WHAT EXISTS: `combat:charge` starts it, the black `combat:flash` holds it to the strike, and a
     `beat()` every frame from what draws the charge keeps it (DuelFx.charge: every duelist and the wyrm; the Fox's
     Howl in `beam.js`): a charge whose beats stop for 0.15 s is cancelled and lets go in 0.25 s, so every path
     that stops drawing the charge (stagger, posture break, parry recoil, a Lab interrupt, death) clears it with
     no list to keep; a retry or a change of state clears it at once (`ui/tells.js`, which owns it as
     `game.blackout`). No new event. `answer.js` and `audio.js` hear the same events as before.
  3. THE RED TRAIL (`?redTrail=0|a|b`, `combat/redTrail.js`, default `0` = off). A red cue opens a window to its
     impact + 0.14 s (`DuelFx.tellFlash`); inside it `DuelFx.sweep` lays one line of fire at a low heat (red
     strokes) just outside the tip's path. a ~0.2 s, b ~0.45 s and a little hotter. Blades only; the bare-handed
     bosses and the wyrm are left out: a fist's or a claw's path is short and lies on the contact, where a red
     wake would hide the blow, and the flare already marks it.
  4. Numbers in `TELL_STYLE` (`rules.js`): `black.out`, `black.pale`, `red.trail`. Lab: `black`, `redTrail` in the
     streak grid. `npm run perf -- --black` measures a frame with the blackout pinned on.
  5. THE OWNER'S PICKS (2026-11-27, from the films): the blackout **b** and the red trail **a**, the defaults.
  6. THE BLACK IMPACT (`?blackImpact=0|a`, default `a`; the owner: "we need all blackout attacks to end with a
     devasting impact even if it misses the player ... the dragon blackout attack looks like it does nothing when
     it misses"). Hit or miss, a black blow lands as the fight's biggest blow: a crater and broken pieces round
     its point, a shock front of dust, a light, a hard shake and punch, a short held frame on a miss, an
     explosion's sound. One module for every boss (`combat/blackImpact.js`), armed by the black cue, fired by the
     beat's own impact clock read off the boss (`brain.act` / `brain.action`), so it lands on the frame the blow
     does and never after a cancel. No extra damage: the black blows already deal the most of each boss's moves
     (38 - 44) with a knock-down; the impact is what the player and the world feel.
- **Consequences:** the black flare in the blackout is white, the colour of a parryable glint; it is a streak, not
  the cross, and the whole frame is dark around it, but the owner should judge it. The mask is the scene's flag,
  so what is drawn only in the fire field near the boss (his spell, the Fox's spirit) dims with the world unless
  it is bright. Open: the phone; a red wake for fists and claws if the owner wants one; on the bare-handed bosses and the Fox's
  Howl (a beam) the impact lands a stride in front of the body, not along the beam.

## ADR-275 — The hero's fight stance: the middle guard (2026-11-28)

- **Context:** the owner found ADR-207's two-handed hold (the grip before the right of the belly, the blade ~47° up
  and out to his right, the point above his head) a poor fighting stance and asked for four new ones to pick from,
  filmed close and far in one clip.
- **Decision:** four holds were built as data (`refStance.js` `HOLDS`: hands, elbows, blade, free hand and its
  shape, body, knees, feet, the flat's roll, one or two hands) behind `?hold=`, filmed (a close orbit, the game
  camera at true size and x2, all four together) and the owner picked **A, the middle guard**, now the default:
  both hands on the grip before the navel on his centre line, the elbows down and a little in, the blade forward
  at the foe's face (4° to his right, 36° up), the knees bent (body 7.5 cm down), the chest a touch forward, the
  right foot 24 cm ahead and the left 22 back (the feet the light chain steps from, as ADR-207's hold), the hips
  turned 0.12 with the right foot. `setHold` copies the hold into `REF_READY`, so every reader of the hold (the
  fight's habits through `syncStandArm`) follows it. `?hold=ref` keeps ADR-207's hold; `b` (high guard, the blade
  upright by the right of his head), `c` (sword fingers, one hand), `d` (low trailing, one hand) are kept,
  turned down. A one-handed hold plays no fight habit (they keep both hands on the grip) and the stance blend
  scales `twoHand` by the hold's `two`.
- **Departure from what was filmed:** the sword elbow's pole is tucked in (0.45, -0.88, -0.15; filmed 0.25, -0.95,
  -0.15): with the filmed pole `heroref` measured the sword wrist 69-73° off the forearm (bar 60), now ≤ 54°. The
  toes keep ADR-207's turn (right -0.35, left 0.6; filmed -0.2 / 0.55): from -0.2 the right foot turned 0.07 rad in
  the draw cut's 0.3 pivot (`heroweight`: at least half). The free elbow points out to his left (0.7, -0.7, -0.15;
  filmed down and in): across his front the robe look's sleeve wing on that arm stood in his chest on 23 % of the
  route's frames (`looks`, bar 3 %), now 2.4 % (main 2.5), ADR-207's finding again. The blade rises 36° (filmed
  30°) and the hands 3 cm higher: standing in the hold 1.5 m from a duelist the filmed point was 5.4 cm inside
  him, and a deathblow whose last cut lands as he is back in the hold was drawn through him (duel `contact`,
  bar 8 cm); now -0.1 cm at 1.5 m (9 cm at 1.3 m: a blade aimed at the foe meets him that close), the wrist
  54°. The body is as filmed.
- **Consequences:** the block, the parry and every attack are unchanged and start from the new hold (`heroref`'s
  transition bars hold: every move within ×1.5 + 10 cm of the stance before). From straight behind at the game
  camera the blade runs up the screen, over his head: the hold reads best side-on or at an angle, as a duel mostly
  is. Open: the owner's playtest.

## ADR-274 — The wyrm's death neck, the white spark always seen, the paw blows told apart: the scythe and the leap (`?deathNeck`, `?glintSeen`, `?pawBlue`, `?pawRed`) (2026-11-28)
- **Context:** the owner: "when the dragon dies and flies up, the head and neck looks unnatural with weird angles and
  motions that are not possible and looks like the neck is broken"; "make sure every normal attack shows the white
  spark hit to help the player parry"; "the blue and red warning paw attacks from the dragon need to be completely
  different ... it kinda uses the same animation. think of multiple different animations that stand out".
- **Measured first:** the death's head goal ran in a straight line from a throe point 8 m off a 6 m neck (the
  chain pulled straight up, a pole) to the ground, and the limp head was laid level whatever the neck did: the head
  sat 60 - 62° off the neck's last segment from 0.2 s to 1.3 s (the clamp's limit), the neck kinked 35° at its top,
  then buckled into a zig-zag as the goal passed inside its reach. The glints: rendered twice at each cue (the scene
  depth vs nothing in front), the wyrm's claw glints showed 0 - 8 % of their heat (the paw, the foreleg and the
  wings in front of them), a wing blow's glint fell outside the frame. The fight camera looks down at 58°: a paw
  raised and brought down is foreshortened, so the blue overhead and the red stomp read as the same growing blob.
- **Decision:**
  1. THE DEATH (`ai.js` deathPose, `?deathNeck=0` as before): the head's goal turns round the neck's base (the
     direction slerped from the throe to the ground, the distance eased and kept inside 0.86 x the neck's length in
     the throe), the throe's head up and FORWARD (0, 5.4, 3.2) so the neck keeps its arch; it looks along its neck
     until it lands; dying, the head hangs at most ~31° off the neck (`DEAD_HINGE`, rig/anim.js). Measured: off the
     neck 62° → 33° (at the landing bounce only), the sharpest bend 36° → 32°, the head up 1.49 → 0.82 m.
  2. THE GLINT SEEN (`duelist/fx.js`, every boss; `?glintSeen=0` as before): a glint's letters carry
     `FIRE_SEEN` (firePalettes.js, added to a blob's kind; the blob shader skips the soft depth fade for them); its
     sparkle is set 3.5 m (x k) toward the camera along the ray through the part (the same place on screen); its
     heart is kept inside the frame like the flare's (`_keepOnScreen`); its light stays at the part. Measured on
     every wyrm melee move: claw glints 0 - 8 % → 90 - 100 % seen, wing glints off-screen → 100 %.
  3. THE PAW BLOWS (`pawTells.js`, data `WYRM_PAW` in tuningMotion.js; look switches; the owner's picks from the
     films, "the leap and the scythe look good": `pawBlue=a`, `pawRed=a`, the defaults, '0' as before): blue (only a BLUE overhead; a white one keeps today's) `a` the scythe, `b` the jab,
     `c` the uppercut; red (every stomp) `a` the leap (the body leaves the ground: `stompAim` keeps the altitude and
     the slam brings it down on the impact), `b` the quake. The split: blue is one paw with the body twisted or
     coiled to one side; red is the whole body. A variant draws its colour itself (the held tell's colour pose,
     ADR-223, is skipped for it). Every option lands on its cue (integ `pawtells`: 0.00 - 0.03 s off).
- **Consequences:** a cue's letters now show over the hero too where they cross him (a cue must be seen). The paw
  options b / c (the jab, the uppercut, the quake) stay behind their switches. (The films' first half second showed
  the wyrm's sleep curl on a standing body: the film rig's `debug.reset()` put it to sleep beside the hero, a state
  the game never shows; re-filmed from its combat stance.)

## ADR-276 — Agents check what their branch changed before a PR (`npm test -- --changed`); CI runs the full set (2026-11-28)

- **Context:** ADR-205 asked every agent to run the full `npm test` once before opening its PR. A full run
  is about 40 tasks and ~75 minutes of work. Locally it gets 8 shared slots, so it takes at least ~10
  minutes, and the slowest task alone takes ~5. With several agents near a PR at once they queued for
  the same 8 slots, and the owner saw the later chats take much longer to open their PRs. CI already runs
  every task on every PR (four shares, ADR-153), and auto-merge (ADR-185) merges only when that is green,
  so the local full run was a second copy of the gate, paid for on the owner's PC.
- **Decision:** before a PR, an agent runs `npm test -- --changed`: `tests/run.mjs` reads the files the
  branch changed since it left `origin/main` (committed, staged, unstaged and new; `--base <ref>` for
  another) and runs the tasks `tests/changed.mjs` maps them to. The first matching rule decides a file:
  a boss's folder, level and set run his suite (and `world` for the level and set); the wyrm and
  Cinderwood run `integ`; the living world runs `life`; the dragon print runs its four suites and
  `world`; a suite file runs its own tasks, and a test helper the suites that import it. Docs and repo
  housekeeping run only `changelogcheck`. Any source file adds `cost` and `glyphcheck`. Anything else
  under `src/` runs everything: core, combat, the hero, the duelist engine, render, ui, audio, game,
  main.js and the level registry. So do the runner and the packages. `--changed --list` prints the pick
  and the files behind each task. When the pick is everything, the agent runs the suites its change is
  about with `--only` and lets CI run the rest. The `changedcheck` task fails when a boss folder or a
  level has no rule of its own, a rule names a task that is gone, or a file `BOSSES` names is gone.
- **Why this way:** it moves the full run to CI's machines, where it already ran, instead of the owner's
  PC. Nothing broken can merge, because the required check is unchanged. Unknown files run everything,
  so a gap in the rules costs time, never coverage. Hand-written rules were chosen over an import graph:
  every suite loads the whole game through `shim.mjs`, so every graph reaches everything.
- **Consequences:** a failure the local full run used to catch now shows up in CI after the PR is open,
  and the agent fixes it on the branch. Replayed over the last 60 merged PRs, the rules narrow 9 of them
  (the docs, the wyrm, the bench). The other 51 touch shared code: `duelist/lookSwitch.js` (the look
  switch table), `combat/`, `player/` or `main.js`. So most of the time saved comes from not running the
  full set locally, not from the narrower pick. A new boss or level needs a line in `BOSSES`.

## ADR-277 — Varr Nihil after the reference pack: his look and his poses behind two switches (`?lordRef`, `?lordRefMove`) (2026-11-28)

- **Context:** the owner generated a reference pack for Varr Nihil (`docs/art/character-packs-v04/varr-nihil`:
  fifteen sheets, a handoff, a coverage table of 70 moves / 256 beat variants / 19 reaction clips; pages 13 - 15
  correct the earlier sheets) and asked for his look and his animation to follow it: the hood, the closed helm, the
  armour, the war-skirt and the whole crimson-lined cape kept in all four forms (this overrides the form-by-form
  wear of `?lordLook=b`, the owner's earlier pick), every blade split into two red-white rails with a dark slit, the
  silhouette readable at the game camera, and every move, reaction, step, transition and spell posed after the
  strips, with no change to balance (damage, reach, hitboxes, active windows, tells, travel, cooldowns, AI weights,
  phase eligibility, cue scheduling). Final art approval stays with the owner.
- **Decision:**
  1. TWO SWITCHES, '0' (as shipped) until the owner picks (CLAUDE.md: a change to how something looks is shown as
     options first; both are in `lookSwitch.js` PENDING and the Lab's LOOKS rows marked awaiting).
     `?lordRef=a` (read when his rig is built) is the look; `?lordRefMove=a` (live, from his next move) the poses.
     `starlessLord/refLook.js` holds both readers and the look's pieces.
  2. THE LOOK. No dressing while `lordRef` is on, whatever `lordLook` says (`look.js lordLookNow`). Every blade (the
     main, the staff's back blade, the off-hand blade, the cross-hilt's side blades) is built as two rails of the
     blade's light meeting at the point, with a dark slit (`armor`) between them, a short dark cross-guard on the
     hilt; the slits are kept shown and scaled with their blades (`blades.cores`, `_showForm`), so a thrown blade
     leaves an empty hand and its slit with it. The blade is drawn in the field as two rails of steel half a cell
     to each side and no stroke down the middle, its sheath of heat pushed out and lower; the rails' bloom halved
     (a blade is thinner than a letter cell: at 720p it is the field that shows the split). The thrown blade is
     two rails too. The crimson sash and its clasp across the chest (00 / 01 / 03), in `piping` (the `lining`
     material draws only the inside of a sheet). The cape's two side sheets turned out and standing off him so the
     lining frames him from the front; every sheet lags and overshoots further (lag 0.55 -> 0.72, swing 1.4 -> 1.6
     rad). The crimson inks stronger (the same hue).
  3. THE POSES, never the timing. A pose layer over whatever keys the shipped switches pick (ADR-226's held tells,
     ADR-251's form, ADR-251's pace): the same key times and eases, so the realiser (which times a beat from its
     windup, hold, active and the key times, never from a pose) lands every impact, flash, end and recovery where
     it did; no root-motion field is touched. Each form's guard lower on wider feet (`GUARDS_REF`); form 1's free
     hand a fist at his side; form 3's hands wide on the staff (the off hand down the joined hilt, `offAt`); form 4
     upright with the hands under the guard and the point over his head (13 H1). The load before a blow sinks a
     little, the strike and its follow-through sink and lean into the cut, feet on the floor a little wider (not in
     a flight or a leap); the free fist out behind in opposition through a one-handed cut. Two corrections that name
     a move: Vigil's Fall ends low over its point (13 H2 replaces 08 M3; the body drops, the blade keeps its path: a
     steeper one bent his wrist past the sword audit's 62°), Starfall lands with the staff pointed down ahead of his
     feet (13 H3 replaces 07 A6; straight down, the animator swings a blade out of his legs, so it reads only a little
     steeper than today's landing). The reactions read bigger (recoils further back,
     the stagger lower) and the carried backstep / sidestep lean further; the glide leans further in with the legs
     trailing further (02 L2 - L5).
  4. KEPT AS THEY ARE: the owner's earlier motion picks that the strips draw differently stay (the two-handed chops
     on a diagonal, ADR-251: 05 C6 draws one straight down the middle, which reads as one upright bar at the game
     camera); the spells' looks (the owner's picks, ADR-122 / ADR-251) and every origin, lifetime and trajectory.
  5. CHECKED: `lord.mjs . lordref`: every move / form / branch / flurry count realised on and off times every beat
     the same; the same seeded fight against the defender lands the same blows at the same times; the sword audit's
     limits hold with the new poses; the split blades and no dressing under `?lordRef`.
- **Consequences:** the default game is unchanged until the owner picks. The pose layer is broad (every beat at
  once), not a hand-keyed redo of 256 variants: it moves the whole set toward the strips' bearing, and the few
  strips that differ from today's paths in kind (13 H2, 13 H3) are keyed by name; a per-move pass is open if the
  owner wants one. At 720p the blade is about two pixels wide: the split reads in close views, at 1440p and up,
  and as two rails of letters in the field.

## ADR-280 — The deathblow is not cut short: a guard press waits, and it takes a perfect blue parry from the blade lock (`?dbLock=combo|lock`) (2026-11-28)

- **Context:** the owner: "if i spam an attack during deathblow, the deathblow gets cancelled?". A sim parried into a
  combo while mashing each button. Attack, heavy and dodge presses were already dropped (`tickDeathblow` clears the
  buffer). Two holes remained. (1) A guard press (the middle click) raised the guard out of the combo's swing:
  `tickDeathblow` saw the attack state left and ended the combo at once, its event saying N strikes and 0 damage.
  (2) A PERFECT parry of a blue blow marked `lock` (Falling Ash, Vanishing Step, the Lord's flips ...) armed the
  combo and crossed the blades in the same call; the lock won, the hero mashed attack to push it, and no deathblow came,
  although a plain parry of the same blow gave one. The owner said their case was the guard press and asked for the
  deathblow to win over the lock.
- **Decision:** (1) `player.update` raises no guard while `db.phase === 'combo'`; the press waits while the button is
  held and the guard comes up in the finisher's tail, as after any swing. (2) `duelist.onParried` asks
  `player.deathblowClaims(this)` before `brain.startLock()`: true when the parry armed the combo on a blue blow from
  this duelist (`deathblow.js` `deathblowClaims`). He then recoils as from any blue parry and the combo follows.
  `?dbLock=lock` (the Lab's `dbLock`) gives the lock back. Tian Lei's beam and lantern locks call `startLock` directly
  and are unchanged.
- **Consequences:** with the deathblow on (the default), a duelist's melee blade lock is reached only with
  `?dbLock=lock`, or `?parryRiposte=old|planted`, or `debug.noRiposte` (every `lock` blow is blue). The suites whose
  checks are about the lock pin `?dbLock=lock` (duel `moments` and `clash`'s lock, asc `bare`); the Training's
  "Blade lock" situation sets `dbLock: 'lock'` for itself (a Training situation's own `dbLock`, put back when it
  ends; the old riposte there fed the dodge streak and shifted the situations after it). Lord `training` also
  reseeds the hero flurry's figure stream per situation, as it does `Math.random`. New checks are duel `deathblow` (g), the
  guard mashed through a combo, and (h), a perfect parry of Falling Ash under both modes. Not filmed: the visible
  change is a combo where a lock was.

## ADR-285 — Xin Yi after the reference pack: his look and his poses behind two switches (`?oneRef`, `?oneRefMove`) (2026-11-28)

- **Context:** the owner generated a reference pack for Xin Yi (`docs/art/character-packs-v04/xin-yi`, not in the
  repo: an original anchor, ten sheets T1 - T2, A1 - A5, S1 - S3, a handoff, a coverage table of 42 moves / 122 beat
  alternatives / 21 clips) and asked for his appearance and his character animation to follow it, with one override
  above everything in the pack: **every existing spell, weapon and special effect stays exactly as it is** (look,
  timing, trajectory, attachment, trigger); the sheets inform the character's body, pose, clothing and equipment
  only. Balance (damage, reach, zones, windows, windups, holds, cues, root motion, cooldowns, weights) unchanged.
- **Source drift:** the pack was inventoried before PR 184 (ADR-253) landed; its `oneMoves=a` baseline is now `b`
  (the owner's pick). The pose layer runs over whichever `?oneMoves` set is picked, so it applies to 0, a and b alike.
- **Decision:** ADR-277's pattern (Varr Nihil). Two switches, `0` (as shipped) until the owner picks (PENDING):
  - `?oneRef=a`, the look (gear.js / look.js, read when his rig is built): on `?oneBody`'s figure, the coat's torso
    open in every phase (the shirt in its V), the skirt to the floor (hem ~9 cm up standing) falling in a wider A, a
    taller collar split in front over a pale inner band, the offset jade-grey seam (a strip down his left side of the
    V, and piping down his left front panel's inner edge), jade cuff bands, short jade temples on the glasses, a
    faint grey streak lying on his crown, squarer guns. The jade-grey pieces are the rig's `facing` / `piping`
    materials, parts 7 and 9, inked by look.js (REF_JADE: no ink gain over 1.5, printed as his cloth). The guns'
    muzzle cells are untouched (gunAim.js leaves the shots from their centres).
  - `?oneRefMove=a`, the poses (refMoves.js, poses.js; live from his next move): the turnaround's guards (T1.9 - 12:
    the right arm out in the offer, the left hand behind his back; gear 2's lead hand high; the guns low at his sides;
    the open hands of the Source), so every clip and move starts and ends in them; a key layer through the
    realiser's `keysOf` (the same key times, eases and cock: the realiser times a beat from its windup, never its
    poses): grounded hand blows land into a lunge (lower, leaning in, the rear foot back), the beckon further out,
    the reload's arms thrown wide, Unwriting's lifted palms, the Dive Within long and low, the rise off the floor
    hands-low, the Falling Fist landing low; reaction clips (refClipKey): leans, recoils and the Bend bigger, the
    Stop's palm out straight; phase 1 gear 1's left hand behind his back through every key and clip. No root field
    is written (bX / bZ, travel, lift, dash). Not touched: the guns' aims, the bolts' and shots' release poses, the
    transitions' kneel and rising, the hover and the pass.
- **Verification:** `woke.mjs . oneref`: 1944 realisations (every move, phase, gear, branch, hold draw, mirror,
  flurry count, under `?oneMoves=0|a|b`) time every beat identically on and off; seeded 20 s fights in phase 1 (both
  gears), 2 and 3 land the same blows at the same times AND make the same calls into his effects at the same times
  (every fx entry point, by name) and the same shots / bolts (time, kind, speed, heading, first point within 0 cm);
  the look builds and fights in every phase. The mechanic scenarios pass with both switches on.
- **Consequences:** the default is unchanged until the owner picks from the films and the preview. Drawn-follow
  effects (a limb's trail, the palms' cue point) follow the new poses as they always followed the limbs. Known
  limits are in the DEVLOG entry; per-move corrections wait for the owner's notes.
- **Redo (the same day, after the owner: "im not really seeing much was changed"):** the first pass kept his
  rebuild's silhouette and only added details; the sheets differ most in the figure and the hands. `?oneRef=a` now
  builds the pack's figure on `?oneBody`'s rig: the torso slimmer (SHELL_REF), slim sleeves with a flared cuff, no
  padded shoulder; the coat open from the collar to the hem (V_GAP_REF; no coat belt, the trousers' belt in the
  opening), its fronts turned open in every phase with their inner edges drifting out (skew 1.5) and a wider A hem
  (cone 0.2); the jade seam wider and inked brighter (REF_JADE); fourteen hair locks swept back (refLocks). The
  right hand: a second, open hand on the right forearm and a palm bent back at the wrist; look.js `handNow` shows
  the open hand, the palm (palm / double blows, the palms' beats) or the fist (fist blows, elbows, the Falling Fist,
  the Still Hand, the guns) for the beat in progress. The fist stays on the sword joint: his blade segment
  (ONE_FIST) and every hit are unchanged. `?oneRefMove=a` adds per-primitive contact poses from A1 / A2: palm
  blows upright and straight-armed at chest height from a long stance (A1.5 / A1.6), the front kick to head
  height (A2.1), round and side kicks to chest height (A2.2 / A2.3), the low sweep in a deep crouch with the leg
  along the floor (A2.5). Still no root field is written; `woke.mjs . oneref` passes unchanged.
- **Third pass (A3, A4, S1 - S2, the left hand; same day, the owner: "Yes, continue"):** refMoves.js keys the
  acrobatic kicks' anticipation deeper (tornado, butterfly, aerial) and every take-off kick's landing low and long
  (`leanTo` keeps a flip's whole turns in the pitch), the flying knee's fist up by the head, the drop heel upright
  on a near heel (A2.6), the rise's crouch with a hand on the floor (S2.1), the Falling Fist's chamber (S2.2), the
  Still Hand upright and narrow (S1.6). **The firing poses change only the legs and the free hand** (A4.1 / A4.2 /
  A4.4: a wider stance; S1.1 / S1.3: a shorter one, the free hand down): a heavy shot's speed is set from where it
  leaves, and the pushing arm is at full stretch, so a body raised or sunk round a "fixed" hand target still moved
  the release 3.7 - 4.4 cm and the speed 1.5 % (tried, measured, dropped). The left hand: an open hand and a palm
  on the left wrist (gear.js), swapped in by dressOne after the animator (which shows the free hand's fist every
  frame); `handNow` returns both hands (a mirrored blow closes the left, the chain punches both). The `oneref` shot
  check now names the first shot that differs.
