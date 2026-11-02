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

| Thing | Technique | Where |
|---|---|---|
| Standing stones, boulders, flagstones | **carved glyphs**: one crisp glyph per world-fixed lattice cell (0.22 × 0.28 m on a plane facing the default camera, rows randomly offset), picked by light on flat facets (lit `% # 8 @ &`, shadow `. : ;`), mid-lit flanks hatched along their contour (`/ \| \`), world-fixed cracks, dim green moss tufts (`, ; " *`), near-black gaps. Flagstones: dimmer, irregular 5–7-sided slabs, half-sunk and tilted, a chipped moonlit chamfer, grass leaning over and growing through the rim | `createCarvedGlyphMaterial` (`render/materials.js`), looks `STONE_LOOK` / `SLAB_LOOK` in `world/forest.js` |
| Trunks, bones, bonfire | screen-grid `STONE` 1.0: symbol ramp `. : - = + * % # 8 & @ M W` + **outline glyphs** (`\| - / \`) on silhouettes / depth steps of raised props | `createAsciiObjectMaterial` → `render/pipeline.js` |
| Canopies | screen-grid `LEAF` 0.6: blobby ramp `. : o 0 O 8 @` | same |
| Grass | ~260k instanced quads, each ONE glyph stroke (`\| / \ ' Y V v l i`) **anchored in the world** (no shimmer when the camera moves); gentle slow wind, trample pushers, wing gusts, burnt to ash glyphs; dim world-space soil glyphs between | `world/grass.js`, `world/ground.js` |
| Hero, wyrm | **v0.4: classic ASCII art** (the owner's reference images).
- The creature material renders a smooth shaded SOURCE image tagged `FLAG.ART`.
- The ASCII pass converts it on a fine screen grid (~2/3 of the world cell, about 5x8 px at 1080p).
- Each cell averages 4 samples, picks a letter from the density-sorted `ART_CHARS` ramp (`. : ; i r s X 2 3 5 h A H S G M 9 # & B @`) by brightness with a little per-cell jitter, and keeps the source hue (white scales, orange lava, red wings, cyan blade) on black.
- Per-material `artGain` sets the source brightness (wyrm 0.28, hero 1.1).
- The hero tags `FLAG.ART_HERO` (0.48) and gets his own treatment:
  - a finer grid of 3x5 pixel-font letters in 4x6 px cells (a browser font fills cells that small)
  - drawn 1.2x and leaned away from the camera (feet planted), so he stands up on screen like the reference: ~25 letter rows at the 36 m camera instead of ~9
  - a fixed key light and darkening toward his silhouette, so letters run dim at the edges and dense in the light, the same in moonlight and firelight
  - depth-edge gaps tuned for the game camera (`uArtEdge.x` 0.004): cells spanning a part boundary go black, the reference's dark separations | `createSurfaceGlyphMaterial` (flag defaults to `FLAG.ART`) → `render/pipeline.js` `artCell` |
| FX | camera-facing glyph particles, additive HDR (bloom) or alpha, drawn after the grid pass | `render/particles.js` |
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
  The hero's moonlit outline (`outline`) keeps the black coat readable. Large bodies use no
  outline: on them it reads as plastic shading.

### Colour rules (all shader colours are LINEAR; final pass applies ACES + gamma)
- Dark skin/base between glyphs: 0.01–0.03. Glyph ink: 0.3–0.7 (lighting multiplies it).
- HDR emissive fire: 2–5 (blooms). Embers 1.5–3. Moonlit white sparks: 1.5–2.5.
- Keep saturation low except fire. Steel = cold blue-grey `[0.55,0.6,0.68]`. Cloth = deep crimson
  `[0.28,0.05,0.04]`. Dragon ("Obsidian Drake", v0.3): obsidian gaps `[0.02,0.019,0.024]`, silver
  ink `[0.36,0.375,0.42]` with a few ember alt scales; molten parts (chest, belly, throat, inner
  thighs, tail underside) self-lit orange `[1,0.42,0.09]` (`inkGlow` 0.5); wing membrane deep red
  `[0.5,0.06,0.035]` on `[0.13,0.013,0.01]` with orange vein glyphs; bones / horns / spikes
  white-grey strokes; claws ivory; teeth + maw self-lit.

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

### Creature ASCII art (v0.4)
- **Look:** the reference is classic image-to-text art. It is a fixed grid of upright characters,
  their density following brightness, coloured per character, with a black backing and the
  silhouette defined only by where characters stop. The surface-glyph detail (levels, cracks, ink
  axes) still shapes the source image, so it shows up as light, colour and letter choice.
- **Brightness:** keep the source in the ramp's mid-range. Too bright saturates to `@B&` and blooms
  into a white blur; too dark leaves faint `: ; i r` dust. Tune with per-material `artGain`, then
  the pass's `uArtLum` / `uArtMin` / `uArtMax`.
- **Glow:** only saturated colours (lava, blade, eyes) keep HDR glow. Bright colourless parts
  (claws, teeth) are capped, or they swell into orbs under bloom.
- **Scale:** at the 36 m game camera the hero is ~25 rows of 4x6 px pixel letters (~15 on a phone
  at LOW). Close-ups (Lab model viewer) show the full reference look.
- **Hero contrast:** his source sits around luma 0.15–0.45 thanks to the key light; the pass maps
  it with a black point (`uArtBlack.x` 0.04) and `uArtLum.x` 3, so the whole ramp is used: `: ; i r`
  at the edges, `X 2 3 5 h A` in the body, `# & B @ M` in the light.
