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

## How this codebase does it

| Thing | Technique | Where |
|---|---|---|
| Grass | instanced glyph quads, wind, trample pushers, gusts, scorch | `src/world/grass.js` |
| Rocks / trees / bones | lit mesh writes alpha FLAG → post pass converts to char grid | `render/materials.js` (AsciiObject), `render/pipeline.js` |
| Dragon / player | SurfaceGlyph material: glyph cells in surface (aGUV) space, glyph picked by local light | `render/materials.js`, `render/glyphGeometry.js` |
| FX | camera-facing glyph particles, additive HDR (bloom) or alpha | `render/particles.js` |
| Fire light | pooled point lights (8 visible) lighting every shader | `render/lights.js` |
| Shadows | moon orthographic shadow map, casters on layer 1 (`markCaster`) | `render/pipeline.js` |

### Colour rules (all shader colours are LINEAR; final pass applies ACES + gamma)
- Dark skin/base between glyphs: 0.01–0.03. Glyph ink: 0.3–0.7 (lighting multiplies it).
- HDR emissive fire: 2–5 (blooms). Embers 1.5–3. Moonlit white sparks: 1.5–2.5.
- Keep saturation low except fire. Steel = cold blue-grey `[0.55,0.6,0.68]`. Cloth = deep crimson
  `[0.28,0.05,0.04]`. Dragon ink = bone/ash `[0.42,0.34,0.3]` with ember-red alt `[0.75,0.16,0.05]`.

### Glyph choice rules
- Pick 4 glyphs ordered dark → bright for each SurfaceGlyph part (shadowed cells show the first).
  Scales `'.v^A'`, belly plates `'.-=≡'`→ use `'.-=#'`, membranes `'.,/\\'` → `'.:/|'`,
  armour `'.:=#'`, mail `'.oO0'`, horns/claws `'.:|I'`.
- Cell sizes: dragon 0.18–0.28 m, player 0.06–0.1 m (the player is small on screen).
- Rotate meaning with geometry: aGUV +y should run along the limb toward the tip/head so chevrons
  point "forward".

### Available glyphs (world atlas)
```
 .,'`:;-~_=+*^<>/\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?"1234567890ACDEFGHJKLPRSTUZ·•°×
```
`gi(ch)` throws if a glyph is missing — stick to this set.
