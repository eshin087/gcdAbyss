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
- **v0.3 (ADR-011)** therefore uses a hybrid:

| Thing | Technique | Where |
|---|---|---|
| Rocks, ruins, trunks, bones, bonfire | screen-grid `STONE` 1.0: symbol ramp `. : - = + * % # 8 & @ M W` + **outline glyphs** (`\| - / \`) on silhouettes / depth steps of raised stones | `createAsciiObjectMaterial` → `render/pipeline.js` |
| Canopies | screen-grid `LEAF` 0.6: blobby ramp `. : o 0 O 8 @` | same |
| Grass | ~260k instanced quads, each ONE glyph stroke (`\| / \ ' Y V v l i`) **anchored in the world** (no shimmer when the camera moves); gentle slow wind, trample pushers, wing gusts, burnt to ash glyphs; dim world-space soil glyphs between | `world/grass.js`, `world/ground.js` |
| Hero, wyrm | **crisp surface glyphs**: one glyph per aGUV cell printed on the body, picked by local light, on near-black gaps, plus a moonlit silhouette line on the hero | `createSurfaceGlyphMaterial({ ascii })` |
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
  colour × 0.1–0.16; creatures: base 0.01–0.15 by material). Never fill every cell.
- **Contrast drives glyph density.** Lit faces climb to dense glyphs; shadow sides drop to dots.
- **Glyph size beats glyph count.** A surface glyph must stay ≥ ~6 screen px at the default camera
  (~35–50 px/m). Smaller cells blur into a solid grey texture: that was v0.1's "too solid" hero
  (0.06 m cells ≈ 2–3 px). `glyphZoom` (0.72) draws each glyph larger inside its cell.
- **Avoid lowercase words.** Ramps favour symbols and blocky capitals so areas read as texture.
- **Silhouette first.** Hero hair spikes, coat flare and wing outlines carry identity at ~50 px.
  The hero's moonlit outline (`outline`) keeps the black coat readable. Large bodies use no
  outline: on them it reads as plastic shading.

### Colour rules (all shader colours are LINEAR; final pass applies ACES + gamma)
- Dark skin/base between glyphs: 0.01–0.03. Glyph ink: 0.3–0.7 (lighting multiplies it).
- HDR emissive fire: 2–5 (blooms). Embers 1.5–3. Moonlit white sparks: 1.5–2.5.
- Keep saturation low except fire. Steel = cold blue-grey `[0.55,0.6,0.68]`. Cloth = deep crimson
  `[0.28,0.05,0.04]`. Dragon ink = bone/ash `[0.42,0.34,0.3]` with ember-red alt `[0.75,0.16,0.05]`.

### Glyph choice rules
- Creatures: pick the `ascii` set per part. It sets the default ramp and cell (`SURFACE_SETS` in
  `materials.js`):
  - `scales`: `. v ^ A` chevrons
  - `strands`: `. : | I` strokes for hair, folds, veins and blades
  - `plates`: `. - = #` bands
  - `smooth`: `. : o 0` for skin and eyes

  Override per part with `glyphs` / `cell`. Make aGUV +y run along the limb toward the tip or head,
  so chevrons point "forward" and strokes follow folds and hair.
- Wyrm cells are 0.23–0.42 model units (×1.25 in the world) with `lumScale` 3.3–3.5, so the lit side
  shows dense chevron rows. Hero cells are 0.045–0.12 m, the smallest that still read.
- Colour carries material; glyph carries form. Keep inks desaturated except glow/fire.
- Red dodge-only tells drive `uWarn` on every wyrm material (a red glow on glyphs + rim). Hit flashes
  use `uFlash`.
- New grid ramps go into `glyphs.js` `RAMP_ROWS` + `GRID_ROW`, and the pass must index them.

### Available glyphs (world atlas)
```
 .,'`:;-~_=+*^<>/\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?"1234567890ACDEFGHJKLPRSTUZ·•°×
```
`gi(ch)` throws if a glyph is missing — stick to this set.
