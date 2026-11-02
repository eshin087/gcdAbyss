# ABYSS — ASCII action RPG demo: *The Cinder Wyrm*

A playable vertical slice of a long-term browser action RPG: a black-coat swordsman, a moonlit forest
clearing, a ring of broken standing stones, and a sleeping wyvern curled in the bones of the last ones
who tried. The art style is modelled on **@Ansenjeo's ASCII MMORPG** — see [docs/STYLE.md](docs/STYLE.md)
for what was studied and how each technique is reproduced. Combat reads tells instead of managing
stamina — see [docs/COMBAT.md](docs/COMBAT.md).

## Play it

**Online:** https://gcdabyss.vercel.app

**Offline:** open `dist/index.html` in Chrome or Edge (double-click; it's one self-contained file).

**From source (live reload while tweaking):**
```bash
npm install
npm run dev        # http://localhost:5173  (add ?lab for the debug Lab)
npm test           # headless integration sims + glyph check
npm run build      # rebuilds dist/index.html
```

## Controls
| | |
|---|---|
| **WASD** | move (screen-relative) |
| **Mouse** | aim / facing |
| **Left click** | light attack (3-hit combo) · **hold & release** = charged heavy |
| **Right click** | **hold** = block · **tap just before impact** = parry |
| **Space** | dodge roll (i-frames) · just before impact = perfect dodge → **Ghostep** |
| **Shift** | sprint |
| **F** | drink flask (heal) |
| **Tab / middle click** | lock on |
| **E** | rest at bonfire |
| **Esc** | pause · **H** help · **M** mute · **F1** Lab · **F2** quality · **F3** FPS · **wheel** zoom |

### On a phone (touch, landscape)
Touch controls appear on touch devices (first touch, or `?touch` in the URL; `?touch=0` keeps them off).
Portrait shows a "rotate your phone" screen and pauses.

| | |
|---|---|
| **Left thumb: stick** | move (floats under your thumb) · push to the rim = sprint |
| **ATTACK** (big) | tap = light combo · **hold & release** = charged thrust |
| **BLOCK** | **hold** = block · **tap just before impact** = parry |
| **DODGE** | dodge roll · just before impact = Ghostep |
| **FLASK · LOCK · \|\|** | drink flask · lock on · pause |
| **Tap the prompt** | rest at the bonfire / fight again |
| **Tap the screen** | start / rise again after death |
| **Pinch** | zoom |

Attacks and facing auto-aim at the wyrm in the fight; otherwise the hero faces where the stick points.
Phones get a closer camera (20 m, pinch 14–34 m) and start on LOW quality (pause menu → QUALITY).

## The fight
Walk north from the bonfire into the stone circle and the wyrm wakes. Every attack shows a tell:
- **white** — normal: block it, parry it or dodge it;
- **blue ◆ PARRY** — tap RMB just before impact for a big posture hit;
- **red ! DODGE** — can't be blocked or parried: dodge right before impact to Ghostep behind it.

Every tell flashes ~0.35 s before impact. Parries and hits fill the wyrm's gold posture bar; when it
breaks, crits land. Below half health it ignites, roars a shock ring, gets faster and starts leaping.

## The Lab (debug mode)
`?lab` in the URL or **F1** (or the floating **LAB** button at the top, on phones) opens the Lab: trigger any ability (1–9), loop abilities, jump to phase 2,
stagger / posture break / kill / reset, god mode, infinite flasks, slow-mo and frame stepping, hitbox
overlay and a parry/dodge timing trainer. See [src/dev/README.md](src/dev/README.md).

## How the look works (short version)
- **Camera:** fixed-yaw, steep (58°) top-down perspective like Ansenjeo's.
- **One character grid:** the scene renders to an HDR target whose alpha tags each pixel's class;
  a post pass turns the whole frame into a pixel-exact ASCII grid — grass (`| / \ ' Y V` strokes
  from a procedural meadow, trampled, gusted and burnt), stone (outlined), foliage, and creatures,
  whose glyphs (`> ^ < v`, `- / | \`, `= H #`) follow the body's flow on screen.
- **Fire:** glyph particles in HDR + pooled point lights that light every glyph around them.

## Tweaking
- Wyrm HP, attack tells/timings/damage, posture, opening cooldowns: `src/entities/dragon/tuning.js`
- Parry / block / dodge windows, posture rules: `src/combat/rules.js`
- Hero speed, roll i-frames, flasks: `TUNE` in `src/entities/player/player.js`;
  swing damage/timings in `src/entities/player/combat.js`
- Camera pitch/distance, arena size, quality presets: `src/core/config.js`
- Glyph ramps for the ASCII grid: `src/render/glyphs.js`; grid pass: `src/render/pipeline.js`

Dev console aids (dev server): `__game` (everything), `__tick(dt, frames)` (step the sim),
`__inspect(x, y, w, h)` (magnify a region of the frame).

## Contributing
`main` is protected: every change goes through a PR that must pass `test-and-build`; merging
deploys to Vercel. Agents start with [CLAUDE.md](CLAUDE.md); history lives in
[docs/DEVLOG.md](docs/DEVLOG.md) and [CHANGELOG.md](CHANGELOG.md).

## Known limits of this demo
- Audio is fully procedural and has not been tuned by ear yet — levels may need adjusting (M mutes).
- Characters are procedurally rigged primitives, not hand-made models; animations are code-driven.
- Needs WebGL2 (any modern desktop browser). Fonts load from Google Fonts when online; offline it
  falls back to the system monospace font.

## Project layout
```
src/core      config, input, camera rig, math, rng, events
src/render    glyph atlases, shared shader library, materials, particles, lights, frame pipeline
src/world     ground, grass meadow, forest/stones/bones/bonfire, scorch map, atmosphere, colliders
src/combat    shared combat rules (tells, block / parry / dodge windows, posture)
src/entities  player/  dragon/
src/ui        HUD, tells, call-outs   src/game   game flow (title, boss intro, death, victory)
src/audio     procedural WebAudio (no sound files)
src/dev       the Lab (debug mode)
tests/        headless integration sims + glyph check
docs/         ARCHITECTURE, STYLE, COMBAT, ROADMAP, DECISIONS, DEVLOG
```
