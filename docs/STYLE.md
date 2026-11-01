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

## How this codebase does it (v0.2)

The owner's verdict after v0.1: **the trees are the gold standard** ("perfect ASCII feel"), while
the 3D-quad grass and surface-glyph creatures looked "too solid / not ASCII". So in v0.2 *everything
except FX* goes through ONE screen-space character grid (pixel-exact terminal glyphs). Materials
write their lit colour + an alpha **class code**; the ASCII pass (`render/pipeline.js`) draws one
glyph per cell from the class's ramp in the grid atlas (`render/glyphs.js`, `GRID_ROW`).

| Class (alpha) | Glyph logic | Used by |
|---|---|---|
| `LEAF` 0.6 | blobby density ramp `. : o 0 O 8 @` by luminance | canopies |
| `STONE` 1.0 | symbol ramp `. : - = + * % # 8 & @ M W` + **outline glyphs** (`| - / \`) on silhouettes / depth steps of raised stones | rocks, ruins, trunks, bones, bonfire |
| `GRASS` 0.5 | per cell: meadow density + clumping noise decide presence; wind waves, trample pushers and wing gusts tip glyphs between `| ¦ !`, `/`, `\`, flatten to `_ - ~`; tufts `, ' "`, `v w V Y`; flowers `* o ° ·`; scorch → ash `. , \``, embers `*` | the ground plane (`world/ground.js`, field baked in `world/grass.js`) |
| `CREATURE` 0.04–0.44 | value packs a glyph **set** + the **screen-space flow angle** (direction in which the surface's aGUV +y grows). `scales`: chevrons `> ^ < v` / bold `» A « V` pointing along the body; `strands`: strokes `- / | \` (hair, cloth folds, membranes, blades); `plates`: bands across the flow `= | H #`; `smooth`: `. : o O 0 @` (skin, eyes) | dragon, hero (`createSurfaceGlyphMaterial({ ascii })`) |

Rules of thumb that make it read like the trees:
- **Gaps matter.** Dark background cells (the slab colour is the cell colour × ~0.1–0.16) are what
  make shapes legible; clump density, use AO/hollows, never fill every cell.
- **Contrast drives glyph density.** Lit faces should climb to dense glyphs, shadow sides drop to
  dots. Flat lighting = a wall of mid-level text.
- **Avoid lowercase words.** Ramps favour symbols and blocky capitals so areas read as texture.
- **Silhouette first.** Hero hair spikes, coat flare, wing outlines carry identity at ~60 px.
- Wind/trample animate *which glyph* is shown, not geometry — the meadow ripples as text.

Other techniques:
| Thing | Technique | Where |
|---|---|---|
| FX | camera-facing glyph particles, additive HDR (bloom) or alpha, drawn after the grid pass | `render/particles.js` |
| Fire light | pooled point lights (8 visible) lighting every shader | `render/lights.js` |
| Shadows | moon orthographic shadow map, casters on layer 1 (`markCaster`) | `render/pipeline.js` |
| Legacy surface glyphs | `createSurfaceGlyphMaterial` without `ascii` still draws glyphs on the surface (kept for special props) | `render/materials.js` |

### Colour rules (all shader colours are LINEAR; final pass applies ACES + gamma)
- Dark skin/base between glyphs: 0.01–0.03. Glyph ink: 0.3–0.7 (lighting multiplies it).
- HDR emissive fire: 2–5 (blooms). Embers 1.5–3. Moonlit white sparks: 1.5–2.5.
- Keep saturation low except fire. Steel = cold blue-grey `[0.55,0.6,0.68]`. Cloth = deep crimson
  `[0.28,0.05,0.04]`. Dragon ink = bone/ash `[0.42,0.34,0.3]` with ember-red alt `[0.75,0.16,0.05]`.

### Glyph choice rules
- Creatures: pick the `ascii` set per part (scales / strands / plates / smooth) and make aGUV +y run
  along the limb toward the tip/head so chevrons point "forward" and strokes follow folds/hair.
- Colour carries material; glyph carries form. Keep inks desaturated except glow/fire.
- Creature cells sit on a near-black backing (`uCreatureBg` 0.04, not the props' `uBg`): bright inks
  otherwise fill their cells and read as solid tiles. Brightness -> glyph level uses `uCreatureLum`
  (3.0); higher saturates every cell to the boldest glyph (flat "VVVV" bodies).
- Near-black materials (the hero's coat) still get an ink-independent moon rim
  (`rim * uMoonColor * 0.12` in `asciiMain`) so their silhouette reads on dark grass.
- New ramps go into `glyphs.js` `RAMP_ROWS` + `GRID_ROW`, and the pass must index them.

### Available glyphs (world atlas)
```
 .,'`:;-~_=+*^<>/\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?"1234567890ACDEFGHJKLPRSTUZ·•°×
```
`gi(ch)` throws if a glyph is missing — stick to this set.
