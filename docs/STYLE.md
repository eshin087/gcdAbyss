# ABYSS — Visual Style Bible (Ansenjeo-inspired ASCII)

Reference: @Ansenjeo's "ASCII MMORPG" (X / TikTok, Oct 2026). Studied from his banner and four
gameplay clips. This document describes what we observed and how this codebase reproduces it.

## Observed in the reference

**Camera.** Steep top-down *perspective* (≈55–65° pitch), fixed yaw (north up), fairly high.
Characters are tiny (≈3–5 % of screen height) with small white monospace name tags above them.
Large creatures (a wyvern) fill a third of the screen. Strong cast shadows from characters and the
dragon fall up/right.

**Palette.** Night. Near-black navy background (#05070c → #0b1018). Grass is desaturated sage /
teal-green; rocks blue-grey; fire is the only warm light and it *spills* orange over the grass
glyphs around it. White dots (flowers/dew) are sprinkled through the grass.

**Three kinds of glyph rendering** (the creator's own words: "instead of just putting symbols on a
grid, I arrange them to create those patterns… our brains recognize shapes and patterns"):

1. **Arranged stroke glyphs** for organic surfaces. Grass = millions of single glyph strokes
   (`| / \ ' Y V v l i`) standing in the world. Dragon skin = chevrons (`^ < v A`) laid *along the
   body flow* in offset rows so they read as scales, in white / ember-red / orange on a near-black
   skin. Hair/cloth use strokes the same way.
2. **Screen-grid ASCII** for hard props: rocks, standing stones, ruins, tree canopies. A terminal
   character grid where glyph density follows luminance (`. : - = + c o a 0 Q & 8 # B N W M @`),
   coloured by the object's lit colour, on a dark slab of the same hue. Canopies use blobby glyphs
   (`o 0 O 8 @ &`), stone uses letters.
3. **Glyph particles** for FX: fire `* # % @ & ^ ~`, embers `. ' \``, sparks `+ x *`.

**UI.** Monospace everything; thin bars; translucent dark panels with 1px light borders; a chat/log
panel bottom-left with tabs; minimap top-right with a zone name; FPS readout; hotbar bottom-centre.

## How this codebase does it (v0.3)

History matters here:
- **v0.1:** the owner loved the trees ("perfect ASCII feel"). The 3D-quad grass looked great but
  "not ASCII", and the creatures looked "too solid".
- **v0.2** pushed everything through one screen-space character grid. The verdict was that the
  grass was **too** ASCII: noisy, distracting, and the ground seemed to swim as the camera moved,
  which is dizzying. The hero and wyrm were also blurry.
- **v0.3 (ADR-011)** therefore uses a hybrid. Later in v0.3 the owner disliked the grid stones too
  (flagstones were bright blue-grey slabs of `+=+=` rows that read as text and stood out from the
  calm ground), so stones moved to **carved glyphs**, drawn like the creatures. Trunks, canopies,
  bones and the bonfire stay on the grid (the owner loves the trees).
- **v0.4 (ADR-015, ADR-017)** turned the hero and wyrm into classic ASCII art of a shaded source,
  on their own finer grids; the hero is drawn bigger and leaned toward the camera.
- **Reference match (2026-11-08, ADR-018 … ADR-022):** the owner asked for the two creatures to
  look "as identical and good as" his two reference images. The wyrm became thin digits whose
  brightness draws the dragon; the hero became ink-line art.
- **Epic wyrm fight (2026-11-09, ADR-031):** the hero is broad-shouldered, and his blade is
  depth-tested again (the 2026-11-08 depth pull drew the sword through his back and legs). The wyrm
  flies (glide and dive wing keys, a hover pose), burns white-hot in phase 3 and casts fire spells
  whose FX are glyph particles from the world atlas, like every other effect.

| Thing | Technique | Where |
|---|---|---|
| Standing stones, boulders, flagstones | **carved glyphs**: one crisp glyph per world-fixed lattice cell (0.22 × 0.28 m on a plane facing the default camera, rows randomly offset), picked by light on flat facets (lit `% # 8 @ &`, shadow `. : ;`), mid-lit flanks hatched along their contour (`/ \| \`), world-fixed cracks, dim green moss tufts (`, ; " *`), near-black gaps. Flagstones: dimmer, irregular 5–7-sided slabs, half-sunk and tilted, a chipped moonlit chamfer, grass leaning over and growing through the rim | `createCarvedGlyphMaterial` (`render/materials.js`), looks `STONE_LOOK` / `SLAB_LOOK` in `world/forest.js` |
| Trunks, bones, bonfire | screen-grid `STONE` 1.0: symbol ramp `. : - = + * % # 8 & @ M W` + **outline glyphs** (`\| - / \`) on silhouettes / depth steps of raised props | `createAsciiObjectMaterial` → `render/pipeline.js` |
| Canopies | screen-grid `LEAF` 0.6: blobby ramp `. : o 0 O 8 @` | same |
| Grass | ~260k instanced quads, each ONE glyph stroke (`\| / \ ' Y V v l i`) **anchored in the world** (no shimmer when the camera moves); gentle slow wind, trample pushers, wing gusts, burnt to ash glyphs; dim world-space soil glyphs between | `world/grass.js`, `world/ground.js` |
| Hero, wyrm | **classic ASCII art** of a shaded SOURCE image (v0.4), matched to the owner's two reference images on 2026-11-08: the **wyrm** as thin one-pixel digits on black whose brightness draws charcoal scales, molten cracks and crimson torn sails; the **hero** as ink-line art, dim dense letters inside bright one-pixel ink lines. Rules and numbers: "Creature ASCII art" below | `createSurfaceGlyphMaterial` (`wyrm` / `heroArt` sources) → `render/pipeline.js` (hero branch, `wyrmCell`), `render/wyrmGlyphs.js`, `createPixelArtAtlas` |
| FX | camera-facing glyph particles, additive HDR (bloom) or alpha, drawn after the grid pass; the fire spells' ground warnings, meteors, lava, flame walls and the plunge's bursts are made of them too ("Fire, hazards and the plunge" below) | `render/particles.js`, `dragon/fx.js`, `player/fx.js` |
| Fire light | pooled point lights (8 visible) lighting every shader | `render/lights.js` |
| Shadows | moon orthographic shadow map, casters on layer 1 (`markCaster`) | `render/pipeline.js` |

The v0.2 creature grid (`CREATURE` 0.04–0.44, `grid: true` on a material) still works but is unused.
The v0.2 grass row in the grid atlas is unused too.

Rules of thumb:
- **The ground must be calm.** It is the largest area on screen. Keep grass darker than the
  characters, wind slow and small, and glyphs fixed in the world. Anything that re-picks glyphs
  per screen cell as the camera moves reads as swimming.
- **Gaps matter.** Dark gaps between glyphs make shapes legible (grid props: slab colour ≈ cell
  colour × 0.1–0.16; creatures: base 0.01–0.15 by material; carved stones: albedo × (light × 0.12
  + 0.006)). Never fill every cell.
- **Contrast drives glyph density.** Lit faces climb to dense glyphs; shadow sides drop to dots.
- **Glyph size beats glyph count.** A surface glyph must stay ≥ ~6 screen px at the default camera
  (~35–50 px/m). Smaller cells blur into a solid grey texture: that was v0.1's "too solid" hero
  (0.06 m cells ≈ 2–3 px). `glyphZoom` (0.72) draws each glyph larger inside its cell.
- **Avoid lowercase words.** Ramps favour symbols and blocky capitals so areas read as texture.
- **No typeset rows.** Never fill a lit area with one or two alternating glyphs (`+=+=` reads as
  text). Mix 4 variants per level, offset rows randomly, nudge glyphs sideways a little, and leave
  some cells empty.
- **Stones carry their glyphs.** The carved lattice is anchored in the world, so stones never
  shimmer when the camera moves or zooms; it faces the default camera, so glyphs stay upright and
  the same size on every facet. Use flat facets: each one is a carved plane with its own light
  level, and on low-poly boulders that is what makes them read as rock, not a ball of text.
- **Silhouette first.** Hero hair spikes, coat flare and wing outlines carry identity at ~50 px.
  At the game camera the hero is a dark figure cut out of the grass by a dark halo, with a dim cool
  rim (since 2026-11-08; the moonlit `outline` only matters for the `uArtSolid` 0 render). Large
  bodies use no outline: on them it reads as plastic shading.
- **Shapes survive the text.** In creature art a bright edge (a scale rim, an ink line) must cut
  through the letters at pixel precision, not be averaged into the cell: the wyrm's strokes take
  their own source pixel's brightness, the hero's ink lines are traced per pixel.
- **Letters hold still.** A creature letter should only change when its cell changes brightness
  tier, never with every small shift of the source (the wyrm's letter sets, the hero's per-cell
  jitter). A per-frame boil of 40–60 % of the cells reads as noise.

### Colour rules (all shader colours are LINEAR; final pass applies ACES + gamma)
- Dark skin/base between glyphs: 0.01–0.03. Glyph ink: 0.3–0.7 (lighting multiplies it).
- HDR emissive fire: 2–5 (blooms). Embers 1.5–3. Moonlit white sparks: 1.5–2.5.
- Keep saturation low except fire. Steel = cold blue-grey `[0.55,0.6,0.68]`. Cloth = deep crimson
  `[0.28,0.05,0.04]`. Dragon ("Obsidian Drake", v0.3; *superseded for what the player sees by the
  art source below*): obsidian gaps `[0.02,0.019,0.024]`, silver
  ink `[0.36,0.375,0.42]` with a few ember alt scales; molten parts (chest, belly, throat, inner
  thighs, tail underside) self-lit orange `[1,0.42,0.09]` (`inkGlow` 0.5); wing membrane deep red
  `[0.5,0.06,0.035]` on `[0.13,0.013,0.01]` with orange vein glyphs; bones / horns / spikes
  white-grey strokes; claws ivory; teeth + maw self-lit.
- **Wyrm art source (2026-11-08, `WYRM_ART` in `dragon/model.js`):** charcoal hide ink
  `[0.34,0.31,0.29]` with bright free scale edges (tone rim 2.0 over a body of 0.11) and an even
  charcoal (`vary` 0.35); molten emit red-orange `[1.0,0.17,0.03]` (ACES turns it to lava); chest and
  throat grey-orange scales with gold / amber rims lit from below, not a lamp; membrane crimson
  `[0.5,0.045,0.03]`, mottled, with orange `[1.0,0.45,0.1]` embers and bone streaks; horns, bones,
  claws neutral to warm grey with bright tips. The moonlight is greyed on the wyrm (`envSat` 0.3) and
  a key light fixed to the camera lights the upper-left faces, so it reads the same from every view.
  Target mix at the reference view: white ≈ 41 %, orange ≈ 22 %, red ≈ 37 % of lit ink.
- **Hero art source (2026-11-08, `HERO_INK` in `player/model.js`):** flat dark fills (coat
  `[0.175,0.165,0.155]`, pants `[0.12,0.12,0.14]`, hair `[0.085,0.08,0.12]` with violet tips), a
  lavender torn zone (`hem` `[0.3,0.28,0.42]`), dark steel armour with white edges and glints, a pale
  face; white ink lines tinted per part (violet-white on hair, lavender on the tails, cyan × 1.7 on
  the blade edges, violet × 2 on the gem). Cyan stays on the blade and its FX, violet on the gem and
  the hair tips.

### Glyph choice rules
- Creatures: pick the `ascii` set per part. It sets the default ramp and cell (`SURFACE_SETS` in
  `materials.js`):
  - `scales`: `. v ^ A` chevrons
  - `strands`: `. : | I` strokes for hair, folds, veins and blades
  - `plates`: `. - = #` bands
  - `smooth`: `. : o 0` for skin and eyes

  Override per part with `glyphs` / `cell`. Make aGUV +y run along the limb toward the tip or head,
  so chevrons point "forward" and strokes follow folds and hair.
- **Panel-style variant tables (`levels`).** The owner's ASCII GAMEPLAY panels put a *different*
  blocky glyph in every cell, with density and brightness following light. Reproduce that with
  `levels`: up to 6 light levels (dark → bright), each a string of up to 8 variants picked per cell
  by hash, e.g. `['', ".'", ':;', 'AV', 'A8BD', '80B@']`. Rules:
  - The darkest level is empty (`''`) or sparse strokes (`' .:,'`, a space = empty cell), so shadow
    sides break up into dots and gaps; 10–25 % empty interior cells carry the form.
  - Mid levels hold the directional glyphs (`A V ^ v`) that follow aGUV; the top levels hold the
    dense blocks (`8 B 0 D @`). Give each level 3–4 variants: one or two glyphs per level reads as
    typeset text again.
  - The level is taken from the light at the cell centre, so glyphs are always whole. The 4-glyph
    `glyphs` ramp still picks per pixel; `levels: ['.', 'v', '^', 'A']` is that ramp with whole
    glyphs.
  - Pair it with `levelInk` for the panels' tonal ramp (grey flanks, near-white lit tops), e.g.
    `[[0.2,0.2,0.22], ..., [0.8,0.8,0.84]]`. Keep inks desaturated; accents stay on `inkAlt`.
- **Where the molten / accent colour sits.** On a single mesh, `glowAxis` (object space) puts the
  `uGlow` seams and `uInkGlow` on the side facing it (`[0,-1,0]`: throat, chest keel, belly) and
  `inkAxis` raises the `inkAlt` chance there (orange glyphs on the lower flanks), instead of
  splitting the part into separate lava meshes.
- **Seams.** `crack: 'voronoi'` draws molten seams as irregular fissures between plates (`crackScale`
  plates of ~2.5 cells), not the glyph grid; use it on hide and lava plates. `seamAxis: 'y'` keeps
  only the seams along aGUV y (radiating wing-membrane veins, no cross-hatching; `rowShift: 0`).
- *Surface-glyph creature cells (the two items below) only show in the `U.uArtSolid` = 0 look-dev
  render since v0.4; in game the wyrm and the hero are ASCII art of their source (last section).*
- Wyrm cells are 0.17–0.27 model units on the body (×1.875 in the world: ~12 px at the default
  camera, ~9 px at the boss framing's pull-back) with `lumScale` 3.0–3.5. Scales are `.vVV`: aGUV
  +y runs toward the head on body / neck and toward the body on tail and limbs (`flip`), so each
  `V` tip points back / down the limb like an overlapping scale (a clean `^` head-on). Bones and
  horns use dashed strokes `.'|!` (`I` read as a letter). Hero cells are 0.10–0.20 m with `glyphZoom` 0.62, light-grey self-lit
  ink and a steep ramp (`lumScale` 4–5) whose darkest glyph is a stroke, not a lone `.`. The hero
  reads as a bright glyph figure, with a violet gem and cyan blade edges as accents (the owner's
  "Shadow Swordsman" sheet).
- Stones (`CARVED_DEFAULTS` in `materials.js`, per-look overrides in `world/forest.js`): 6 light
  levels × 4 variants, `topGlyphs` on up-facing facets (caps, slab tops, fallen faces) and
  `sideGlyphs` elsewhere; levels 2–3 on side facets become contour strokes (`/` left flank, `|`
  vertical side, `\` right flank; flat contours keep the ramp so no dash rows appear). Light maps to
  a level through a soft knee `1 − exp(−light × lumScale)` (stones 4.0, flagstones 2.3) so moonlit
  tops and dim flanks both land on the ramp. Flagstones stay the dimmest stones (`gain` 2.1 vs
  2.9): the ground must stay calm. Moss ink ≈ grass tips; never brighter.
- Colour carries material; glyph carries form. Keep inks desaturated except glow/fire.
- Red dodge-only tells drive `uWarn` on every wyrm material (a red glow on glyphs + rim). Hit flashes
  use `uFlash`.
- New grid ramps go into `glyphs.js` `RAMP_ROWS` + `GRID_ROW`, and the pass must index them.

### Available glyphs (world atlas)
```
 .,'`:;-~_=+*^<>/\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?"1234567890ACDEFGHJKLPRSTUZ·•°×
```
`gi(ch)` throws if a glyph is missing — stick to this set.

### Creature ASCII art (v0.4; reference match 2026-11-08)
- **Look:** the owner's references are classic image-to-text art. They are a fixed grid of upright
  characters, coloured per character, with a black backing and the silhouette defined only by where
  characters stop. The creature material renders a SOURCE image (its own art source: `wyrm` /
  `heroArt`), and the ASCII pass prints it. The two references differ, so the two creatures use
  different rules (ADR-018 … ADR-021). Contracts: ARCHITECTURE.md "Creature ASCII art".
- **Glow:** only saturated colours (lava, blade, gem, eyes) keep HDR glow. Bright colourless parts
  (claws, teeth) are capped, or they swell into orbs under bloom.
- *Superseded:* the single density-sorted `ART_CHARS` ramp for both creatures (`createArtAtlas`,
  `artCell`), the hero's edge darkening (`uArtHeroEdge`) and black depth gaps, `uArtBlack.x` 0.04.

**The wyrm (the red-black dragon reference).**
- **Letters:** thin one-pixel 4x6 glyphs in 5x8 px cells (×2 from 1620 px tall; 3x5 glyphs in 4x6
  cells under 900 px tall, so 720p keeps the density next to the hero), each with a soft 0.24 halo
  and a black gap round it. Mostly digits, like the reference. Never a bold browser font: at 4x7 it
  fills the cell and lit areas print as solid bars (the v0.4 "silver blob").
- **Brightness draws the dragon, not letter density.** A cell's brightness picks one of three letter
  sets (`WYRM_SETS`: dim `17iv!;r27`, mid `2345968017`, bright `96805A@3`), the cell's own hash picks
  the letter inside it, so letters stay put as the wyrm breathes (a 22-step ramp re-lettered ~60 %
  of the lit cells per frame at idle; the sets ~39 % when measured in round 1, v0.4 34 %). Dark
  cells print nothing (the scale gaps).
- **Strokes:** each letter's pixels take brightness and hue from their own source pixel, so a scale
  edge or a spike cuts through the text. Thin parts (spikes, horns, claws, wing bones, teeth) and the
  silhouette print stroke glyphs (`/ | \`) along their edge; a horizontal edge keeps its letter
  (long `-` runs read as ruled lines). The hide's scale outlines come from letter brightness only:
  rim strokes on every scale printed a field of `\ / |` chevrons at the game camera.
- **Source:** dark charcoal shingle scales (≈3–4 letters across at the reference view; smaller ones
  print as letter noise) whose free edges catch a camera-fixed key light from the upper left;
  molten cracks along the scale gaps only on down-facing surfaces (chest, throat, belly, inner legs,
  tail underside: the back stays charcoal from the game camera), glowing ~2.5 gap widths wide so
  they light the letters over them; orange-lit chest and throat scales with gold rims; crimson
  mottled sails with torn edges, holes, orange bone streaks and ember specks; spikes dark at the root,
  bright at the tip.
- **Targets at the reference view (1080p):** the reference's body region has mean brightness ≈ 29,
  ≈ 22 % ink pixels and ≈ 9 % bright ones (round 1 measured 30 / 23 / 11); its lit ink is white 41 /
  orange 22 / red 37 % (round 2 measured 43 / 23 / 35).

**The hero (the "Shadow Swordsman" line-art reference).**
- **Ink lines, traced per pixel:** bright one-pixel lines on his silhouette, on the nearer side of
  every depth step and on part edges (the higher part draws), plus piece edges up close; a dimmer
  second pixel up close gives the reference's ~2 px anti-aliased ink. A line breaks at the letter
  spacing, so a contour reads as a chain of stroke glyphs (style 0); the torn tails and the hair are
  dotted (style 1); the blade and gem are unbroken (style 2). Never one stroke glyph per cell: it
  stair-steps every curve ("boxy, robotic").
- **Fill:** dim, dense letters (3x5 pixel font in 4x6 px cells) from a flat per-part source: a fill
  colour, a key light from the camera's upper left, a share of the scene light, white glints only
  where metal curves, a cool blue-lavender rim on the screen's left, fold streaks on the coat up
  close. A cell an edge runs through prints a dim letter up close, so the line sits in a dark
  channel; the face (`open`) keeps its letters.
- **Close-up targets (reference view):** the reference figure's mean luma is 108, with 38 % of its
  pixels above 120 and 29 % below 50 (round 2 measured 106 / 37 % / 28 %).
- **Game camera (36 m, 6–20 m LOD band): a dark figure, not a wireframe.** The reference scaled to
  his ~150 px is dark (mean luma 56, 56 % below 50) with silver armour, pale lavender tails, a pale
  face and the cyan blade. Far away piece edges drop out, cloth inner lines turn into dark seams
  (`farLine` 0), armour keeps bright edges, the fill takes a per-part gain (`farFill`: cloth 0.35,
  armour ~1.1–1.2, blade 2), the silhouette is a dim cool rim, and the blade's glow is capped to a
  tight line. A dark halo (two rings round his screen position, fading in from 8 to 20 m) darkens
  the world grid next to him, so he cuts out of the grass. The outline is one letter thick: a
  two-cell band turned the ~12-letter-wide figure into a wireframe.
- **Blade:** drawn 1.64 m (gem to point ≈ 70 % of his height, the portrait) with a ridge line and
  serrations. It is depth-tested like the rest of him (2026-11-09, ADR-031): from behind only the
  steel beside his silhouette shows (the low idle guard shows just its point), it no longer shows
  through his back or legs, and the coat hangs inside or drapes over it instead of passing through
  (a few run frames still cross a panel). *Superseded:* the 2026-11-08 depth pull that drew it up to
  0.65 m nearer the camera (ADR-022) put the sword through his back from behind.
- **Build:** broad-shouldered and athletic (2026-11-09): a deep chest over a V to a fuller waist
  (chest 0.50 × 0.27 m, waist 0.31, hips 0.34), thick arms and legs, bigger boots, on the same
  skeleton (`BODY` in `player/model.js`). At the game camera the mass reads only modestly; the wide
  coat skirt still dominates his outline.
- **Scale:** at the 36 m game camera ~25 rows of 4x6 px letters (~15 on a phone at LOW); drawn 1.2×
  and leaned toward the camera (ADR-017). Close-ups (Lab model viewer) show the full reference look.

### Fire, hazards and the plunge (2026-11-09)
Every effect below is glyph particles (`fx.add`, additive HDR, for fire and light; `fx.alpha` for
smoke and dust) using world-atlas glyphs only (`gi()` throws on others; `npm test`'s glyph check).
Fire stays the only saturated warm light: white-yellow HDR cores `[4.6,3.5,1.5]` cooling through
orange `[3.4,1.4,0.28]` to a dying red `[0.8,0.08,0.012]`; lava `[3.3,1.9,0.55]` → `[2.5,0.8,0.13]`;
smoke `[0.045,0.04,0.036]` in alpha. Code: `dragon/fx.js` (the "fire hazards, spells and flight"
section), `player/fx.js` (the plunge).
- **Red ground warnings** (`hzRing`, `stripWarn`, `ringWarn`, `wallWarn`): a ring of red `•` dots
  with a `!` every fourth, an inner ring closing in on the centre as a countdown (a lava pillar's
  rises as `^`), a `+` at the centre; `>` chevrons down the path of a fire strip or wall; a hot ring
  where a flame ring will ignite and a dim dotted limit at its outer radius. Past their timing flash
  they brighten and pulse faster (`hazardFlash`: the ring flares, red glyphs fly up, a red light).
  The dots are bullets: a middle dot `·` is ~1 px at the 36 m camera (the stomp, leap and roar
  rings switched to `•` too).
- **Meteors:** a white-hot `@` core in a `*` halo with `|` strokes laid along its screen motion, a
  fire trail, smoke and its own light over a 0.75 s visible fall; the impact is a white flash, a
  fire burst, flung rocks (`. , : ; o`), a ring of `)` shock strokes, dust, scorch and a smouldering
  crater.
- **Lava pillars:** before the eruption the ground cracks glow and spit sparks (`~ ^ ,`), faster as
  it nears; then a column of molten `# % @ & ! |`, droplets (`. o •`) and a `~` splash ring.
- **Flames** on strips, rings and walls: tall `^ * # % &` and low `^ ~ *` fire behind a red leading
  edge; the fresh front burns tallest, and the ground scorches as it passes.
- **Casts and flight:** the meteor cast spits a fireball straight up; fire swirls in round the wyrm
  before a flame ring; the nova's 2.5 s charge sucks embers onto the chest with contracting `)`
  rings and glowing cracks round its feet, then shock rings race out with a white flash and a fire
  storm; the sky strafe streams fire from the mouth onto the ground ahead; low wingbeats blast dust
  rings and flatten the grass; the dive's crash throws `)` shock strokes, fire, rocks and dust.
- **Phase 3** burns white-hot: crack glow 0.8 and 50 body embers / s (phase 2: 0.5 and 22), a
  white-hot boss bar.
- **The plunge** speaks the hero's cold language: a blue-white afterimage of his pose at the dodge
  spot and a cold streak up to the hang point; cold motes drawn in at the apex; on impact a
  white-cyan flash, cold crystal shards fanned out, molten blood thrown up from the wound and a shock
  ring round the skull (an execution: bigger, gold-white); embers spurting round the buried blade
  while he rides; a gout of embers as he rips it out; a dust ring and a low cold ring where he lands.
  Its glyphs: `* ° | - ~ ^ ' · + x × A V . , : =`.
- **The deflect chain:** each parry in rhythm clashes bigger and brighter, with a crossed pair of
  sparking streaks from the second one.
