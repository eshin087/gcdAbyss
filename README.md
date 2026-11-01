# ABYSS — ASCII Soulslike Demo: *The Cinder Wyrm*

A playable vertical slice: a lone knight, a moonlit forest clearing, a ring of broken standing stones,
and a sleeping wyvern curled in the bones of the last ones who tried. The art style is modelled on
**@Ansenjeo's ASCII MMORPG** — see [docs/STYLE.md](docs/STYLE.md) for what was studied and how each
technique is reproduced.

## Play it

**Online:** https://gcdabyss.vercel.app

**Offline:** open `dist/index.html` in Chrome or Edge (double-click; it's one self-contained file).

**From source (live reload while tweaking):**
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # rebuilds dist/index.html
```

## Controls
| | |
|---|---|
| **WASD** | move (screen-relative) |
| **Mouse** | aim / facing |
| **Left click** | light attack (3-hit combo) |
| **Right click** | heavy attack |
| **Space** | dodge roll (i-frames) |
| **Shift** | sprint |
| **F** | drink flask (heal) |
| **Tab / middle click** | lock on |
| **E** | rest at bonfire |
| **Esc** | pause · **H** help · **M** mute · **F2** quality · **F3** FPS · **wheel** zoom |

## The fight
Walk north from the bonfire into the stone circle and the wyrm wakes. It bites, swipes with its
wing-claws, sweeps its tail, stomps, breathes a sweeping cone of fire that scorches the grass, spits
fireballs and charges. Below half health it ignites (molten seams between its scales), gets faster,
and starts leaping into the air to slam down on you. Hit its head while it's staggered for crits.

## How the look works (short version)
- **Camera:** fixed-yaw, steep (58°) top-down perspective like Ansenjeo's.
- **Grass:** ~260k instanced quads, each a single glyph stroke (`| / \ ' Y V`), swaying, trampled,
  flattened by wing gusts and burnt to ash glyphs by fire.
- **Rocks, ruins, trees:** rendered normally, then a post pass replaces them with a screen-space
  character grid whose glyph density follows brightness (stone uses letters, foliage uses `o 0 @ 8`).
- **Dragon & knight:** glyphs are laid out *on the surface*, oriented along the body, picked by
  local lighting — scales are rows of `^ A v` chevrons; armour is `. : = #`.
- **Fire:** glyph particles in HDR + pooled point lights that light every glyph around them.

## Tweaking
- Wyrm HP, attack timings/damage, poise, opening cooldowns: `src/entities/dragon/tuning.js`
- Knight speed, stamina, roll i-frames, flasks: `TUNE` in `src/entities/player/player.js`;
  swing damage/timings in `src/entities/player/combat.js`
- Camera pitch/distance, arena size, quality presets: `src/core/config.js`
- Glyph ramps for the ASCII grid: `src/render/glyphs.js`; moon/fog colours: `src/render/shaderLib.js`

Dev console aids (dev server): `__game` (everything), `__tick(dt, frames)` (step the sim),
`__inspect(x, y, w, h)` (magnify a region of the frame).

## Known limits of this demo
- Audio is fully procedural and has not been tuned by ear yet — levels may need adjusting (M mutes).
- Characters are procedurally rigged primitives, not hand-made models; animations are code-driven.
- Needs WebGL2 (any modern desktop browser). Fonts load from Google Fonts when online; offline it
  falls back to the system monospace font.

## Project layout
```
src/core      config, input, camera rig, math, rng, events
src/render    glyph atlases, shared shader library, materials, particles, lights, frame pipeline
src/world     ground, grass, forest/stones/bones/bonfire, scorch map, atmosphere, colliders
src/entities  player/  dragon/
src/ui        HUD          src/game   game flow (title, boss intro, death, victory)
src/audio     procedural WebAudio (no sound files)
docs          STYLE.md (art direction), ARCHITECTURE.md (module contracts)
```
