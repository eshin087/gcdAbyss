# ABYSS — Architecture & Module Contracts

Browser game, Three.js 0.180 (WebGL2), plain ES modules, no framework. `npm run dev` serves the
repo at http://localhost:5173 ; `npm run build` emits a single-file `dist/index.html`.
This file is the **source of truth for cross-module APIs and event names** (contract version: v0.2).

## Conventions
- Units: meters, seconds, radians. **Y up**, ground plane y = 0 (flat).
- Camera looks north: **screen-up = world −Z**, screen-right = +X. Fixed yaw, ~58° pitch.
- Models face local **+Z**. `yaw` rotates about Y; facing vector = `(sin yaw, 0, cos yaw)`;
  `yawTo(fx, fz, tx, tz)` in `core/math.js`.
- All shader colours are linear HDR. See `docs/STYLE.md` for the look, `docs/COMBAT.md` for combat.
- Arena: clearing of radius 30 around the origin. Player clamp 31, dragon clamp 26.
  Bonfire (spawn) at (0, 25.5) south; stone circle r≈19.5; bone pile around (−3, −15.5);
  dragon sleeps at `CONFIG.world.dragonSleep` (3, −10).

## Frame order (src/main.js)
```
wheel zoom → mouse ray (mouseGround) → touch.update(realDt) → lab.update(realDt)
→ flow.update(dt, realDt) → player.update(dt) → dragon.update(dt)
→ lab.postUpdate() → camera (rig) → view override → shared uniforms → world.update(dt)
→ lights.update → fx.update → hud.update(realDt) → audio.update(realDt) → render
```
**View override** (`game.viewOverride`, Lab model viewer only): when it is
`{ pos, target, focus? }` (Vector3-likes, world metres), main.js places the camera at `pos` looking
at `target` right after the rig update, and the fog centre (`U.uFocus`), the light-pool selection
and the shadow box follow `focus` (default `target`) instead of the player / rig focus.
`uCamPos`, `uCamRight/Up`, `uPlayerScreen` and the ASCII pass are all derived from the overridden
camera, so lighting, rim / outline, particles and the glyph grid work from any angle. The rig keeps
updating underneath; `null` snaps back to the game camera. A missing, non-finite or degenerate
override is skipped for that frame (never throws, never feeds NaN).
`dt = realDt × game.timeScale × game.debugTimeScale × hit-stop`. `realDt` is unscaled. Input edges
(`pressed`) are valid for exactly one frame. Construction order: world, audio, player, dragon, hud,
touch, flow, lab — constructors must not dereference modules built later.

## The `game` context (passed to every constructor)
| field | what |
|---|---|
| `THREE`, `CONFIG` | three.js namespace, `core/config.js` |
| `renderer, scene, fxScene, camera, pipeline, U` | rendering. `U` = shared uniforms (`render/shaderLib.js`) |
| `events` | pub/sub: `on(name, fn)` → unsubscribe fn, `emit(name, data)` |
| `input` | `down(code)`, `pressed(code)`, `released(code)`, `mouseDown(b)`, `mousePressed(b)`, `mouseReleased(b)`, `moveAxis()` → `{x, y}` (y = up/north; keys give a unit vector, a deflected virtual stick wins with its analog length ≤ 1), `anyPressed`, `wheel`. Codes are `KeyboardEvent.code`. **Virtual sources** (touch): `setVirtual(code, down)` (code = a `KeyboardEvent.code` or `'Mouse0'`/`'Mouse1'`/`'Mouse2'`; same one-frame `pressed` / `released` edges as the real device, only on a change), `setVirtualAxis(x, y)`, `releaseVirtual()` (everything up, stick centred). Virtual holds are tracked apart from the real keys / buttons. Mouse events within 1 s of a touch pointer event (browser compatibility mousedown / mouseup / mousemove) are ignored. |
| `mouseGround` | `Vector3` — mouse ray ∩ ground plane, updated each frame; with touch controls on, the touch aim point (see Touch controls) |
| `cameraRig` | `addTrauma(0..1)`, `extraZoom`, `focus`, `zoom(steps)` (2.5 m per step, clamped to the profile), `targetDistance`; distance profile `setMobile(bool)` / `mobile`, `defaultDistance`, `minDistance`, `maxDistance`, `maxExtraZoom` (desktop: `CONFIG.camera.distance/min/max`, unlimited extra zoom; phone: `mobileDistance` 20 / `mobileMinDistance` 14 / `mobileMaxDistance` 34, extra zoom (lock-on, boss framing, title / intro shots) capped at `mobileMaxExtraZoom` 3 m). `setMobile` resets the zoom to the profile default. |
| `touch` | touch controls (`ui/touch.js`, below): `active`, `phone`, `portrait`, `autoAim`, `setActive(bool)`, `update(realDt)` |
| `shake(a)` | camera trauma (0.15 light hit … 0.7 huge slam) |
| `hitstop(sec, scale=0.04)` | brief time-scale dip measured in real seconds (also used for Ghostep slow-mo: `hitstop(0.6, 0.3)`) |
| `debugTimeScale` | Lab multiplier on game time (1 = normal). Only the Lab writes it. |
| `viewOverride` | `null` or `{ pos, target, focus? }` — camera override applied by main.js after the rig (see Frame order). Only the Lab model viewer writes it. |
| `lights` | `add({x,y,z,color:[r,g,b],intensity,radius,life,fade,fadeIn,flicker})` → light (mutable `x,y,z`, `.set()`, `.kill()`) |
| `fx.add` / `fx.alpha` | glyph particles, additive-HDR / alpha-blended. `spawn({x,y,z,vx,vy,vz,life,size,sizeEnd,glyph,color,colorEnd,alpha,alphaEnd,gravity,drag,spin,rot,flicker,stretch})`. `glyph`: char, string of chars (random pick) or atlas index. |
| `world` | `resolve(pos, radius, bound)` circle collision; `setPusher(slot, x, y, z, r)` grass trample (slot 0 = player, 1–9 = dragon; y > 1.5 = airborne, ignored); `clearPushers(from, to)`; `gust(x, z, strength 0..2, radius)`; `scorch.burnCircle(x, z, r, burn 0..1, heat 0..1)`, `scorch.reset()`; `colliders.blocked(ax,az,bx,bz)`; `setGrassQuality(count)` (instanced grass blades drawn; main.js applies the quality preset); `bonfire {x,z}`; `nest {x,z}`; `atmosphere.setBonfireLit(bool)`; Lab only: `debug.setVisible(bool)` hides / restores the environment (ground, grass, forest group = trees, stones, flagstones, nest bones, bonfire; atmosphere paused and in-flight particles in `fx.*` dropped; the exact previous `visible` flags come back; lights, scorch and colliders untouched), `debug.visible` |
| `player`, `dragon`, `hud`, `audio`, `flow`, `lab` | the modules below |
| `state` | owned by flow: `'title' | 'explore' | 'bossIntro' | 'boss' | 'dead' | 'victory' | 'paused'` |
| `time`, `realTime`, `dt`, `realDt`, `timeScale`, `fps` | clocks |
| `settings` | `{ quality: 0..2, showFps: bool }`; `applyQuality()` re-applies. Touch devices start on `CONFIG.defaultQualityTouch` (LOW) unless the player picked one. |

Shared combat rules: `src/combat/rules.js` — `TELL`, `RESULT`, `TELL_STYLE`, `DEFENSE`, `POSTURE`,
`tellDefaults(tell)`, `facingDelta(...)`. Never hard-code these windows in actor code.

Render helpers for creature modules:
- **Creature ASCII art** (v0.4, reworked by the reference match of 2026-11-08: ADR-018 … ADR-022).
  Creature materials render a SOURCE image into the scene target and the ASCII pass
  (`pipeline.js`) turns it into letters. `createSurfaceGlyphMaterial` defaults `flag` to `FLAG.ART`
  (0.5); with the shared `U.uArtSolid` = 1 the material writes its art source (0 = the patterned
  surface render, a look-dev A/B). `artGain` (default 1) scales the generic smooth source. The pass
  tests the hero's grid first, then the wyrm's, then the world grid. Two creature paths, told
  apart by the **alpha contract** (no other material may write alpha in 0.46–0.55):

  | alpha written | by | meaning |
  |---|---|---|
  | `0.5 + 0.01 × code` (0.50 … 0.54) | the wyrm (materials with `wyrm`) | `FLAG.ART` plus a **stroke code** from `wyrmMain`: 0 none, 1 `-`, 2 `/`, 3 `\|`, 4 `\` (the screen direction of a thin part's outline or a scale rim at that pixel). The pass decodes `floor((a − 0.5) × 100 + 0.5)` |
  | `HERO_ART.a0 + (part × 2 + aPart) × HERO_ART.step` (0.4632 … 0.4866) | the hero (materials with `heroArt`) | a **part id** inside the hero window (0.46, 0.49) that `isHero` tests (`FLAG.ART_HERO` 0.48 marks the window): `part` 0..19 from the material, `aPart` 0 / 1 the geometry's sub-id |

  `HERO_ART = { a0: 0.4632, step: 0.0006, parts: 20 }` is exported from `materials.js` (`HERO_PARTS`
  20 from `shaderLib.js`). The step is ≥ 2 half-float ulps there, so part ids need the half-float
  scene target; on the 8-bit fallback they collapse to ~7 levels (silhouette and depth lines still
  draw, part tints and fill gains come out wrong). Every hero material must pass `heroArt`
  (`createHeroMaterials` throws without a `HERO_INK` entry).
- **The wyrm's source** (`wyrm: {...}` option; dragon materials only, one `WYRM_ART` entry per
  material in `dragon/model.js`). Compiles `SG_WYRM` (plus `SG_WYRM_MEMBRANE` when `membrane` is
  given); without the option the shader is unchanged. In art mode `wyrmMain` replaces the smooth lit
  ink and writes the stroke code above. All fields optional (defaults in `wyrmFeatures`; arrays of
  the wrong size fall back to them):
  - shape: `scale [w, h]` (shingle scales in aGUV units; omit for spikes, bones, membranes),
    `scaleDir 'along' | 'down'` (roof tiles round a barrel), `strokes 'rim' | 'axis' | 'none'`
    (default `'rim'` with `scale`; `'axis'` = along a thin part's length where the fresnel term
    reaches `strokeEdge`), `tip [y0, y1, root, glow]` (horns, spikes, claws)
  - tone and light: `tone [gap, body, rim, rimWidth]`, `gap [rows, px]`, `vary` (per-scale
    brightness spread, default 0.8), `ink`, `rimInk`, `light [gain, key, fresnel, floor]`,
    `key [right, up, toward]` (a key light fixed in camera space), `envSat` (moon / ambient
    saturation; fire light keeps its colour), `under [r, g, b, k]` (lava light from below)
  - molten: `emit`, `glow [gaps, all]`, `vein [strength, share, width, plate]` (a broken voronoi
    net), `crack [strength, share, lo, hi]` (cracks along the scale gaps, faded in on down-facing
    surfaces by `smoothstep(lo, hi, −n.y)`); all × the material's `uGlow` (`model.glow`)
  - membranes: `membrane [mottle, specks, tears, edgeTears]`, `boneGlow [width, base, hot]` (the
    orange streak along the finger bones, default [0.3, 0.05, 0.9])

  Uniforms `uWScale, uWShape, uWTip, uWTone, uWGap, uWInk, uWRimInk, uWLight, uWKey, uWEnvSat,
  uWVein, uWCrack, uWVary, uWEmit, uWGlow, uWUnder` (+ `uWMem, uWMemBone`), plus the shared
  `U.uCamRight` / `U.uCamUp` (added only to `wyrm` materials). Today the hide materials (`scales`,
  `limbs`, `neck`, `head`, `belly`, `throat`, `lava`) use `strokes: 'none'` (scale outlines by letter
  brightness only); `wingBone`, `spine`, `bone`, `claw` and `teeth` use `'axis'`.
  `SG_WYRM_MEMBRANE` reads two static vertex attributes of `WingMembrane` (`membrane.js`, laid out
  once on `WING_KEYS.HALF`): `aEdge` (0 inside → 1 on the free trailing edge: holes and the ragged
  edge) and `aBone` (model units to the panel's nearer bone: `boneGlow`).
- **The wyrm's letters** (pass; `wyrmGlyphs.js`, tested by the wyrm branch for `FLAG.ART` pixels):
  - `createWyrmArtAtlas(s, small)` → `{ texture, sets: [mid start, bright start, stroke start],
    total }`: one row, column 0 blank, then `WYRM_SETS.dim / mid / bright`, then `WYRM_STROKES`
    (`- / | \`). Thin one-pixel 4x6 letters with a 0.24 soft halo in 5s x 8s cells
    (`wyrmArtCell(s, small)`); `small` = 3x5 letters in 4x6 cells. `wyrmArtScale(H)` → `{ s, small }`:
    small under 900 px tall, else s = round(H / 1080). `setSize` rebuilds it (`tArt`, `uArtCell`,
    `uWyrmAtlas`).
  - Per cell (4 samples; 2 must hit, 1 if the cell draws a stroke): the cell value picks a letter
    SET, the cell's hash the letter inside it, so letters only change when a cell changes tier;
    ≥ `uWyrmGlyph.w` stroke-code votes print that stroke glyph in the brightest coded sample's
    colour; silhouette cells (1–3 hits) print a marching-squares edge stroke (`uWyrmOutline`; a
    horizontal edge keeps its letter); each stroke pixel takes brightness and hue from its own source
    pixel (`uWyrmTone.w`).
  - Uniforms: `uWyrmTone` (x brightest letter 0.95, y gamma 1.3, z value below which a cell prints
    nothing 0.022, w own-pixel share 0.85), `uWyrmGlyph` (x / y set steps dim → mid → bright 0.12 /
    0.42, z per-cell dither 0.08, w stroke votes 1), `uWyrmAtlas` (vec4: the atlas `sets` and
    `total`), `uWyrmOutline` (1). The pass's `.y` uniforms are the wyrm's: `uArtLum.y` 2.2,
    `uArtBlack.y` 0.004, `uArtMin.y` 0.012, `uArtEdge.y` 0 (the depth-gap blackout is off). `uArtMax`
    (0.8) is shared.
- **The hero's source** (`heroArt: {...}` option, built from `HERO_INK` by `createHeroMaterials`):
  `part` (0..19, required; throws outside), `fill [r, g, b]`, `spec`, `specPow`, `rim`, `glow` (share
  of the animated `uInkGlow`: blade, gem, flask), `pull` (bool), `folds [freq, depth, wander]` (throws
  if not finite). Defines `SG_HERO_ART` (with `HERO_A0`, `HERO_AS`), `SG_HERO_PULL`,
  `SG_HERO_FOLDS`; uniforms `uArtFill`, `uArtSpec`, `uArtRim`, `uArtGlowK`, `uArtPart` (= part × 2),
  `uArtPull` (m, set per frame), `uArtFold`; shared `U.uCamRight`, `U.uCamUp`, `U.uArtHeroLight`
  (vec4: flat fill, camera key light from the upper left, scene-light share, glint gain; (0.2, 0.95,
  0.2, 1.4)) and `U.uArtHeroRim` (the cool screen-left rim colour). The fill is flat per part (no
  glyph gaps); glints only where the surface curves.
  - `aPart` (float vertex attribute, 0 / 1): `sub(geometry, k)` in `player/model.js`, carried through
    the static merge; a geometry without it reads 0 (`defaultAttributeValues`). It splits one part
    into pieces the pass outlines up close (coat panels, hair locks, the blade's two halves).
  - `pull`: each vertex moves `uArtPull` m toward the camera along its own view ray (at most half the
    distance): the same pixels on screen, a nearer depth. Visual only (ADR-022).
  - `folds`: dark fold bands in the fill up close (gone between 8 and 16 m).
- **Per-part pass data** (`U.uHeroPartInk[20]`, `U.uHeroPartFill[20]`, vec4, shared; filled once by
  `createHeroMaterials` from `HERO_INK`): ink = line tint rgb × gain (`line`; > 1 blooms: the cyan
  blade edges, the violet gem); fill = x `fillGain`, y line style (0 one stroke per letter cell,
  1 dotted (`dotted`), 2 unbroken (`solid`), + 4 when `open`: no dark channel or depth-step gap, the
  face), z `farLine` (share of inner-line light kept at the game camera: 0 a dark seam (cloth) … 1
  bright (armour, blade)), w `farFill` (fill gain there). Materials that share a `part` must share
  these fields.
- **The hero's letters and lines** (pass, hero branch):
  - Grid: `createPixelArtAtlas(hs)` (`glyphs.js`; hs = max(1, floor(H / 1080))) → `{ texture, count,
    lines, cols }`: row 1 = `ART_CHARS` in a 3x5 pixel font, sorted sparse → dense (`uHeroCount`,
    `uHeroCols`); row 2 = `PIXEL_LINES` (`| - / \` and a dot), no longer sampled. Cells `uHeroCell`
    = `pixelArtCell(hs)` (4hs x 6hs).
  - Fill: a cell whose centre is on him (or ≥ 2 of its 4 samples) prints one letter. Its part's
    light (`uArtLum.x` 3, `uArtBlack.x` 0.06) picks it along the ramp `uHeroFill.zw` (near) /
    `uHeroFar.xy` (far), jittered by `uArtDither.x` 2.6 / `uHeroFar.z`; brightness `uHeroFill.xy` ×
    `fillGain`. Cell-level edge classes (`heroEdge`, threshold `uArtEdge.x` 0.004 × depth, creases by
    `uHeroCrease`) only darken the cell: an edge cell prints a dim letter up close (`uHeroPx.z`, the
    dark channel), the far side of a depth step a gap (`uHeroInk.w`). `uArtMin.x` is unused.
  - Ink lines, per PIXEL (`heroPxEdge` against the neighbours `uHeroPx.x` = hs px away): 1
    silhouette, 0.8 depth step (drawn by the nearer side; a slope predictor skips curved and grazing
    surfaces; threshold `uHeroPx.y` 0.0015 × depth), 0.6 part edge (drawn by the higher part id), 0.4
    piece edge (sub-id; up close only). One font pixel wide, plus a dimmer second pixel up close
    (`uHeroPx.w` 0.45). Line light `uHeroInk.xy` (dark / lit source), `.z` hue share, × `uHeroLine`
    (depth step / part edge / piece), × the part's ink; the stroke style (part fill .y) gaps it per
    letter cell.
  - Distance LOD by view depth: `uHeroLod` (x / y far look starts / complete 6 / 20 m, z far fill
    gain 1.3, w the silhouette's light floor 0.25) and `uHeroFar` (x / y far letter ramp 0.45 / 0.85,
    z far jitter 1, w HDR cap 1.8 for the blade and gem). Far away piece edges drop out (dithered per
    cell), inner lines keep `farLine`, the fill takes `farFill`.
  - `uHeroDebug` (look-dev): 1 the raw source, 2 lines only, 3 lines coloured by class.
  - Halo: `uHeroHalo` (xy his screen uv, z radius px, w strength), set per frame in
    `_updateAsciiCamera` from `U.uPlayerScreen` (radius `HERO_HALO_R` 2.1 m; strength fades in from
    0.4 × to 1 × `uHeroHaloShape.w` = 20 m view depth, so none in close-ups), and `uHeroHaloShape`
    (x / y tap radii 2 / 4 px × hs, z darkening 0.72). Two rings of 8 taps darken **world-grid**
    pixels round him (grass, stones, trees, bonfire); the wyrm's letters are not darkened.
- **Leftovers** (declared, no longer effective): `U.uArtHeroKey` / `U.uArtHeroEdge` are still in
  `SURFACE_SHARED` and computed by the generic source, but the `SG_HERO_ART` fill replaces that
  colour on every hero material. `createArtAtlas` (`glyphs.js`) is no longer imported; the generic
  `artCell()` pass function and its `uArtCount` uniform were removed.
- `createSurfaceGlyphMaterial(U, opts)` (`render/materials.js`). **v0.3: crisp surface glyphs.** One
  glyph per aGUV cell is printed on the body (aGUV +y = "glyph up"), picked by local light, over
  near-black gaps (`base`). Pass `ascii: <set>` to pick the default ramp + cell (`SURFACE_SETS`):
  - `'scales'`: `. v ^ A` chevrons along the flow
  - `'strands'`: `. : | I` strokes for hair, cloth folds, membrane veins and blades
  - `'plates'`: `. - = #` bands for belly and armour
  - `'smooth'`: `. : o 0` for skin, eyes and gems

  Override per part with `glyphs`, `cell` (meters; keep glyphs ≥ ~6 screen px), `rowShift`,
  `lumScale`, `glyphZoom` (default 0.72) and `outline` (moonlit silhouette line, default 1.1; use 0
  on large bodies; falloff pow 6). `grid: true` keeps the v0.2 screen-grid rendering (unused). Runtime uniforms: `uGlow` (emissive seams/brightness), `uInkGlow`, `uFlash`, `uDissolve`, `uTint`,
  `uWarn` (vec4: rgb + strength in `.w`; glow on glyphs and the silhouette rim). Actors drive `uWarn`
  on all their materials for the red (dodge-only) tell — colour and ramp numbers in
  `TELL_STYLE.red.warn`, timing in COMBAT.md "Tell presentation".

  **Optional features** (for the concept-sheet rebuilds; `docs/art/hero.md` §3, `docs/art/dragon.md`
  §3). Each compiles in through `material.defines` only when its option is given; without them the
  shader, uniforms and pixels are exactly the pre-existing ones. They apply to the crisp path, not
  `grid: true`. Defaults live in `SURFACE_FEATURE_DEFAULTS`; bad values throw at construction.
  - `levels: ['', ".'", ':;', 'AV', 'A8BD', '80B@']`: 1–6 strings, dark → bright, each up to 8 glyph
    **variants** for that light level (`SURFACE_LEVELS`), one picked per cell by hash; a space (or
    `''`) is an empty cell. Overrides `glyphs`. Level = `floor(clamp(light × lumScale + jitter) ×
    count)` like the 4-glyph ramp, but the light is extrapolated to the **cell centre**, so every
    glyph is drawn whole (the 4-glyph ramp picks per pixel and can cut a glyph at a light step).
    Every glyph goes through `gi()` (throws if missing from the world atlas), and `npm test`'s glyph
    check scans `levels: [...]` keys and `*_LEVELS` / `*_GLYPHS` / `*_RAMP` array constants.
    Uploaded once as `uLvGlyph` (vec4[12]), `uLvCount` (float[6]), `uLvN`.
  - `levelInk: [[r,g,b], ...]`: ink per light level (dark → bright, last repeats), replacing `ink`
    (`inkAlt` still mixes in by chance). E.g. dim grey shadow glyphs, near-white lit tops.
  - `glowAxis: [x,y,z]` (OBJECT space, so it follows the part as it animates), `glowBias` 0..1
    (default 1; 0 = even), `glowRange [lo, hi]` (cosine band, default `[0, 0.75]`): `uGlow` (seams,
    warm tint) and `uInkGlow` concentrate on the side whose normal faces the axis, e.g. `[0,-1,0]`
    for a molten throat / chest / belly underside on a single mesh.
  - `inkAxis: [x,y,z]` (alias `inkAltAxis`, OBJECT space), `inkAxisChance` (default 0.6),
    `inkRange` (default `[0, 0.75]`): cells facing the axis pick `inkAlt` with up to that chance,
    fading to `altChance` elsewhere (e.g. more orange alt glyphs on the lower flanks). Decided per
    cell from the cell-centre normal, so a glyph is never half alt.
  - `crack: 'grid' | 'voronoi'`: `'grid'` (default) = seams on the glyph cell borders; `'voronoi'` =
    irregular fissures from a 3×3 cellular noise on aGUV, width jittered and pulse phased per plate.
    `crackScale` = plate size in glyph cells (default 2.5), `crackWidth` multiplier (default 1).
  - `seamAxis: 'both' | 'y' | 'x'`: `'y'` = seams run along aGUV y only (between columns, e.g.
    radiating wing veins; use `rowShift: 0` so they stay continuous), `'x'` = along x only (between
    rows). With `crack: 'voronoi'` it stretches the plates 3× along that axis instead.
- `limbGeometry`, `ellipsoidGeometry`, `hornGeometry`, `cylindricalGUV`, `planarGUV` (`render/glyphGeometry.js`).
- `createCarvedGlyphMaterial(U, opts)` (`render/materials.js`) — **carved glyphs for static rock**
  (standing stones, boulders, flagstones; future ruins). Glyph cells sit on a world-fixed lattice in
  a plane facing the default camera (`viewPitch`), so they are upright, equal-sized and never
  re-pick as the camera moves; one glyph per cell, picked by light on flat facets, contour strokes on
  mid-lit flanks, world-fixed cracks and moss. Renders directly (alpha `FLAG.NONE`, the grid pass
  ignores it). Geometry must be baked in world space with `aCol` (vec3), `aAO`, `aMoss`, `aInk`,
  `aEdge` (floats); see `carve()` in `world/forest.js`. Options and defaults: `CARVED_DEFAULTS`
  and the doc comment (`sideGlyphs`, `topGlyphs`, `mossGlyphs`, `crackGlyphs`, `strokeGlyphs`,
  `strokeLevels`, `cell`, `gain`, `lumScale`, `jitter`, `inkFloor`, `base`, `mossInk`,
  `crackAmount`, `edge`, `glyphZoom`, `fadeNearPlayer`, `side`).
- `markCaster(object)` (`render/pipeline.js`) — casts moon shadows.
- `gi(ch)`, `gis(str)` (`render/glyphs.js`).
- `game.pipeline.finalMat.uniforms` — `uHurt` (red edge 0..1), `uFade` (black 0..1), `uDesat` (0..1), `uWarm` (boss grade 0..1), `uExposure`, `uBloom`. **Owned by the HUD/flow module.**

## Module contracts

### Player — `src/entities/player/player.js` exports `class Player`
```
constructor(game)                      // builds model, adds object3d to game.scene, spawns at CONFIG.world.playerSpawn
object3d: THREE.Object3D;  position: THREE.Vector3 (=== object3d.position);  yaw: number;  radius = 0.45
name = 'Wanderer'
hp, maxHp, flasks, maxFlasks: number   // (v0.2: NO stamina)
state: string   // 'idle'|'run'|'sprint'|'roll'|'attack'|'charge'|'heavy'|'block'|'parry'|'ghostep'|'heal'|'stagger'|'guardBreak'|'knockdown'|'dead'
                //  ('attack' = light sweeps + the slam finisher, 'heavy' = the released charge thrust)
blocking: boolean                      // RMB held and able to block
critTimer: number                      // > 0 while the post-Ghostep crit window is open
lockOn: boolean                        // toggled by Tab / middle mouse; facing tracks dragon.lockPoint
get alive(): boolean
isInvulnerable(): boolean              // roll i-frames, Ghostep, get-up, dead
takeHit({ damage, from:{x,z}, knockback=0, knockdown=false, kind='hit', burn=0,
          tell='normal', parryable, blockable, attack, attacker }): RESULT   // see COMBAT.md
getChestPos(out: Vector3, visual = false): Vector3   // upright gameplay body; visual = the drawn one (FX)
unlean(v: Vector3): Vector3            // drawn (leaned, HERO_SCALE) world point → upright gameplay body
leanPoint(v: Vector3): Vector3         // upright gameplay point → where it is drawn (name tag)
respawn(x, z)                          // full restore, idle, facing north, clears burn/lock/crit
restAtBonfire()                        // refill hp/flasks (no teleport)
update(dt)
debug: { god: boolean, infiniteFlasks: boolean, heal(), teleport(x, z), kill() }   // used by the Lab
```
Controls (only while `game.state` ∈ {`explore`,`bossIntro`,`boss`}): WASD move · mouse aim · LMB tap =
light combo (sweep → backhand sweep → two-handed slam finisher), LMB hold ≥ 0.3 s then release =
charged lunging thrust · RMB hold = block, RMB tap before impact =
parry · Space = dodge roll · Shift = sprint · F = flask · Tab / MMB = lock-on. (E is flow's.)
Drawn body vs gameplay body (ADR-017): the root draws the hero `HERO_SCALE` (1.2) tall and leaned
away from the camera (`model.js` `LEAN`, `installLean`). The animator runs with `lean.on = false`
(plain upright 1.85 m body, so IK and ground clamps work in metres); the drawn transform is applied
after it. FX read the drawn joints; the sword sweep's hit test, `getChestPos()` (the dragon's aim)
and the hurt cylinder use the upright body (`SwordSweep(sword, unlean)`).
Deals damage via `game.dragon.takeHit(...)` using `game.dragon.hurtSpheres`, tested through a
vertical reach band (`REACH` in `player/combat.js`: a sphere overlapping the blade's swept wall
extended `up` m above / `down` m below it counts, so the giant wyrm's chest is in reach from the
front); swings step in toward a hurt surface ahead (`REACH.assist`); the slam's ground shards hit
if the blade missed. Pushes itself out of
`game.dragon.bodyCircles` and resolves vs `game.world.resolve(pos, radius, CONFIG.world.playerBound)`.
On `perfectDodge` it performs Ghostep using `attacker.position`/`attacker.yaw` (teleport behind,
`game.hitstop(slowmoTime, slowmoScale)`, opens `critTimer`). A harsher freeze already running defers the
slow-mo until it ends; actors skip a short freeze while a longer, gentler slow-mo runs, so impact
freezes never swallow a Ghostep.
RMB cancels a charge (the LMB press is consumed); an RMB press during one's own swing is queued and
raises the guard when recovery starts. Streams (breath) only Ghostep when the roll starts into them.

Model (`player/model.js`, built to `docs/art/hero.md`, the Shadow Swordsman): private to the player
module (nothing outside reads the rig). It is drawn as ink-line ASCII art (ADR-019): every material
carries a `HERO_INK` entry (the `heroArt` source and its per-part pass data, see Render helpers).
Three sword lengths (sword space, m from the grip centre):
- `DIM.bladeBase → DIM.bladeTip` (0.16 → 1.5, + `REACH.tipExt`): the **hit segment** (gameplay).
- `DIM.steelTip` 1.17: the point the **animator** poses with. `anim.js` keeps it on the grass and out
  of the legs, and the `hero` integration scenario checks it. Unchanged, so every attack's hit
  segment is unchanged.
- `DIM.drawnTip` 1.45: the **drawn** point (1.64 m of drawn steel with the pommel; visual only, still
  inside the hit segment). FX that sit on the point use `DIM.drawnTip ?? DIM.steelTip`
  (`PlayerFx.bladeHalo`'s dots and tip streak); the cyan dot halo past the point carries the rest of
  the reach.

The animator (`player/anim.js`) drives: `coat` = 7 skirt panels (`COAT_PANELS`: six + the front
flap, each with a resting `flare` and optional `folds`), each two spring segments (the lower one is
two meshes: `coat` above, the lavender torn zone `hem` over its last 55 %) plus `strips` (22 torn
strips, one spring each, kept above the grass); `streamers` (two two-segment sleeve strips on the
arms); `hair` = 5 spring clusters (`HAIR_CLUSTERS`: fringe, left, right, crown, nape), each with a
dark-root mesh (`hair`) and a sheened-tip mesh (`hairTip`). Static meshes that share a joint and a
material are merged at build time (fewer draw calls; 127 meshes, ~20k triangles); only the flask
stays separate.
**Glyph scale** (`model.js` exports `setHeroGlyphScale(mats, dist) → k` and `GLYPH_SCALE`): every
frame `Player._updateMaterials` measures the camera → hero distance (`player.viewDist`) and rescales
the hero materials' glyph cells, k = clamp(dist / 12, 0.15, 1): in-game cells at the 36 m camera
(and anywhere beyond 12 m), finer in Lab / showroom close-ups (≈30 rows for the figure at 4 m).
Per material `userData.cell` (in-game cell), `userData.cellMax` (cap for small parts: hair, collar,
plates), `userData.lockX` (the blade's two columns), `userData.zoom / zoomNear` (glyph zoom at the
game camera, default `GLYPH_SCALE.farZoom` 0.45 so the glyphs fill their cells / in close-ups);
materials without `userData.cell` (gem, eye, skin, flask) keep fixed
cells. (The ink-line source is flat per part, so these cells no longer show in game; they still set
the per-cell dissolve and the `U.uArtSolid` = 0 render.) The same call sets `uArtPull` on the `pull`
materials (blade, point, gem) from `BLADE_PULL` `{ m: 0.65, near: 10, far: 24 }`: 0 under 10 m of
view distance, 0.65 m from 24 m (ADR-022). `player.bladeFar` (0 close-up … 1 at ≥ 28 m) makes the
blade self-light with distance (dark steel with glowing edges up close, a solid cyan line at the
game camera). It touches only the hero's own materials (no shared uniform, no allocation).
FX helpers that changed shape: `PlayerFx.gemTick(dt, x, y, z, k, vx, vz, vy)` and
`gemGlint(x, y, z, s, vx, vz, vy)` take the gem's own velocity (`player.gemVel`, measured from the
gem joint each frame) so glints ride the hilt; `gemTick` also keeps an always-on 0.22–0.26 m violet
glow point at the gem; `bladeHalo(dt, k, far)` grows its dots with distance and lays a short bright
`|` streak 0.06–0.26 m past the drawn point. `trail(pa, pb, a, b, kind, crit)` keeps its signature
but sub-steps by the outer point's travel (one per 0.24 m, up to 8) and slerps the blade round the
hilt between frames, so a sweep reads as one curved crescent. New: `skid(dt, slot, x, z, dx, dz, sp,
k)` (dust and torn grass off a sliding contact; `slot` 0 / 1 keeps a rate accumulator each) and
`scrape(dt, x, y, z, dx, dz, sp)` (cold sparks off the dragging point). Glyph strokes are laid
along the rendering camera's axes (`game.camera.matrixWorld`, read in `get add()`; the fixed 58°
basis is the fallback), so they stay right in Lab views.

Animator ↔ player hooks (`anim.js` is private to the player module):
- `anim.onFootstep(side, dust?)` → `player._footstep(side, dust = 0)`: emits `player:footstep`;
  `dust` > 0 kicks up a puff of that size (the thrust dash's two touchdowns).
- `ROLL_SLIDE` (exported, `[0.42, 0.58]` s of the forward roll's `stateT`): the sliding kneel. In it
  `_updateFx` calls `fx.skid` for the right shin (slot 0) and the planted left foot (slot 1), and
  `fx.scrape` while the blade point is below 0.14 m. The root speed is unchanged.
- `anim.kickCoat(power, rnd = Math.random)` throws the coat panels and strips out. `anim.noise()` is
  the animator's own LCG (0..1): cosmetic kicks in code the integration sims run pass `anim.noise`,
  never `Math.random` (the sims seed it and the wyrm's AI rolls on it). The light sweeps kick 0.32 on
  their first active frame (`player.atk.flared`, a new flag on the attack record), the slam's impact
  0.6.
- Internal animator state worth knowing: `pathCh` (channels a windup path drives this frame, copied
  past the cross-fade), `updraft` 0..1 (the charge lifts the coat and hair), `dashStep` (bits: dash
  touchdowns taken), `marks` (4 per-clip ground marks), `feet` (the world-space foot planner),
  `visYaw` (the drawn heading: a critically damped spring, `TURN_K` 650, at most `TURN_LAG_MAX` 1.4 rad
  behind the gameplay yaw; visual only).
- **Active frames stay bit-identical** (ADR-024): a pose path that reshapes an attack windup reaches
  the clip's own pose by windup − 1/30 s and hands its channels back; recovery shaping starts at
  windup + active + 0.035 s (the frame after the active window is still hit-tested); active-frame
  shaping only touches non-blade channels (free arm, feet, head, coat). The proof is a per-frame
  compare of `sword.matrixWorld` and the hit points against the previous build.
- Blade directions blend by azimuth / elevation round the outside of the body (`dirLerp` /
  `dirTo`), a cross-fade keeps last frame's way round, and outside attacks the blade is pushed out of
  the leg capsules before the ground clamp (ADR-023).

### Dragon — `src/entities/dragon/dragon.js` exports `class Dragon`
```
constructor(game)                      // builds the four-legged drake, sleeping at CONFIG.world.dragonSleep
object3d, position (Vector3, root on ground), yaw
bound: number                           // radius around the arena centre the root stays inside:
                                        // min(CONFIG.world.dragonBound, TUNING.bound = 24) (move, charge, leap target)
name = 'VAELGRIM, THE CINDER WYRM';  hp, maxHp;  phase: 1|2|3
phaseAt: number[]                       // HP fractions where each phase starts (TUNING.phaseAt [1, 0.66, 0.33])
nextPhaseHp: number                     // HP of the next phase's gate (0 in phase 3)
posture, maxPosture: number;  broken: boolean   // posture break = staggered + broken
state: 'sleeping'|'waking'|'combat'|'staggered'|'airborne'|'dying'|'dead'
hurtSpheres: Array<{x,y,z,r,part,mult}>  // world space, refreshed every update; part ∈ head|neck|body|tail|wing|leg
                                        // (leg = the four legs; wing = the wing wrists + finger knuckles)
bodyCircles: Array<{x,z,r}>              // ground footprint for player push-out (empty while airborne):
                                        // chest, hips, neck base, loins, then each PLANTED foot (0..4 more)
isTargetable(): boolean                 // false while sleeping/dying/dead
lockPoint(out): Vector3                  // chest/neck base, for lock-on + camera
startIntro()                            // wake → rise → roar; emits 'dragon:introDone' when the fight starts
takeHit({ damage, part, point:{x,y,z}, dir:{x,z}, poise, heavy, crit }): number   // returns damage dealt; adds posture
                                        // phase gate: with the AI on, damage stops at the next phase's
                                        // threshold until its transition starts (no skipping a phase)
onParried({ attack, tell }): void       // the dragon calls this itself when player.takeHit returns 'parried'.
                                        // Deflect chain (contract 1): a string's non-final hit is only
                                        // deflected (posture + a 0.14 s visual knock-back, the string goes
                                        // on); its last hit / a single melee attack recoils. Emits
                                        // dragon:parried {attack, tell, hit, last} (+ combat:deflectChain)
plungePoint(out): Vector3               // contract 2: the top of the drawn head (+0.6 x SCALE), valid in flight
onPlunge({ damage, posture, point, execution }): number   // contract 2: final damage to the head (phase
                                        // gate kept), posture; cancels the action (not intro / phase2 /
                                        // phase3 / death) and plays 'plunged' (head slammed down, thrash,
                                        // rise ~1.35 s; airborne: a fall + crash landing first; an execution
                                        // on a broken wyrm ~2 s and it consumes the break); emits
                                        // dragon:plunged {execution}; returns the damage dealt (0 = ignored)
enterPhase(n)                           // the transition roars call it: phase n's posture meter, emptied
crashing: boolean                       // true while a plunge cancels a flight: its end() must not land it
hitstop(sec, scale)                     // game.hitstop that won't crush a running Ghostep slow-mo
reset()                                 // back to sleeping at the nest, full HP/posture, phase 1, all FX/lights cleared
update(dt)
debug: {                                // used by the Lab (generic shape every future enemy implements)
  abilities(): Array<{ name, label, tell, phase }>,   // includes 'roar' (the phase-2 shock ring)
  trigger(name): boolean,               // force an ability now (wakes/starts the fight if needed); false while busy
  setAI(enabled: boolean), aiEnabled: boolean,
  wake(), startFight(),                 // startFight skips the intro straight into combat (no-op if fighting)
  phase2(), phase3(), stagger(), postureBreak(), kill(), reset(), setHp(fraction 0..1),
  hitboxes(): Array<{ x, y, z, r, kind: 'hurt'|'attack' }>,  // for the Lab overlay
  currentAction?(): object|string|null  // optional, Lab readout (the running action)
}
```
Attacks (`attacks.js` `ATTACKS`): the AI picks any entry generically (`ai.js` `attackWeight`) by
`phase` (first phase, on the def or `TUNING.attacks[name]`), `weight` (a number, `[P1, P2, P3]` or a
function of `(dragon, sense)` returning either), `cooldown` and `air` (usable while airborne; ground
attacks never are). **Strings** (contract 1, `makeString(name)`): `TUNING.attacks[name].hits` = N
hits, each `{ kind, side?, tell, windup, hold?: [min, max], active, impact, damage, knockback,
chance?, ...kind extras }`, plus the string's `recovery`, `cooldown`, `weight`, `phase`, AI band
`range` [min, max] (model units x SCALE), `maxAng` / `minAng`. Every hit gets a beat (combat:tell at
its windup start, combat:flash `flashLead` before its impact); the kinds (`KINDS`: claw, overhead,
bite, rearBite, lungeBite, wing, tailJab, tailSweep, hop, stomp) perform them through pose fields.
A string def carries `string: true`, `melee: true` and `noBreak(a)`.
Size: the model is authored in model units and the root is scaled by `SCALE` (tuning.js, 1.875
since v0.3); every world-space number (reaches, radii, hurt spheres, body circles, AI ranges, FX,
pushers, pose targets via `rootPt`) is multiplied by it. The hero does not scale, so 3D hit volumes
/ AI ranges are re-checked against him (integration sims) when `SCALE` or the anatomy changes.
Body plan (v0.4, "four-legged rebuild", docs/art/dragon.md): a quadruped drake, withers 4.0 model
units (7.5 m), columnar forelegs (elbow back) + digitigrade hind legs, a short thick upright S-neck
(7 × 0.46 chain), a 16-segment tail lying in a sideways hook, and a separate pair of wings rooted on
top of the back (humerus → forearm → wrist + thumb hook → 4 two-joint fingers, 4 membrane panels).
Anatomy numbers live in tuning.js `ANATOMY`. Since the reference match the finger bones are
`[6.2, 6.9, 5.5, 3.9]` with knuckle fractions chosen so the proximal bones (wrist → knuckle, where
the wing hurt spheres sit) are v0.4's; only the distal bones are ~1.35× longer (visual only).
Look ("Obsidian Drake", model.js): materials in `model.mats` (scales, limbs, neck, head, belly,
throat, lava, membrane, wingBone, spine, bone, claw, teeth, maw, eye; `limbs` = the hide on legs,
tail and the wing arm; `head` = skull, brow and jaw with finer scales). What the player sees is each
material's `WYRM_ART` source (the `wyrm` option, see Render helpers); the surface-glyph `levels` /
fissure options only shape the `U.uArtSolid` = 0 render. Crack glow per material from `model.glow`
(`[phase-1 ember, × glow (phase 2 / death), × throat charge]`, applied in `_applyMaterials`; every
`model.mats` key needs a `model.glow` row except `eye`, which follows `rig.s.eyes`); the art
source's veins, cracks and gap glow scale with it.
Visual-only geometry on gameplay joints: every head mesh hangs on `model.headVis`, scaled
`HEAD_VIS` (1.3) about the mouth point, while the gameplay joints `head` and `mouth` (the bite /
charge spheres, the breath / fireball origin) are unscaled; `rig.pt.eyes`, `pt.nostrils` and
`pt.jawTip` follow the drawn head. The drawn tail radius (`tailRV`) is thicker than
`model.tailRadii`, which stays the chain's ground clearance (read by the rig and the tail sweep).
Wing membrane (membrane.js): `new WingMembrane(material, side, restKey)` — 4 Coons panels rebuilt
from the bones every frame (allocation-free); `aGUV` is laid out once from `restKey`
(`WING_KEYS.HALF`, so changing that key re-lays the membrane's texture), so the grid is even in the
resting pose. Two static per-vertex attributes feed the `wyrm` membrane source: `aEdge` (0 inside →
1 on the free trailing edge) and `aBone` (model units to the panel's nearer bone). Trailing-edge
scallops `SAG` [0.3, 0.28, 0.24, 0.16] plus torn `RAG` notches. Resting body language
(`TUNING.rest`): wings `spread` 0.5 (HALF) in both phases, ≤ 0.3 while walking; jaw 0.65 (phase 1) /
0.85 (phase 2), the painting's snarl (visual only); attacks return to `TUNING.rest.spread`.
Rig (rig/anim.js, internal to the dragon module; attacks.js / ai.js are its only writers): each
frame the brain writes a `pose` (head / look goals, `lookDown` = max nose-down head pitch, jaw 0..1
→ 0.7 rad, pitch / roll / lower / twist, `spread[2]` per wing: 0 FOLD · 0.5 HALF (the painting's
mantled sails) · 1 SPREAD, `mantle` 0..1 (breath display key: wrists held high in the hips frame,
so the front crouch doesn't drag them down) / `droop` 0..1 (stunned: tips on the ground), flap (fingers fold on the upstroke), `pawOv[2]` front-paw override targets (rakes,
slams, the charge's ground-pawing) + `pawPlant[2]` (one frame: that paw lands at its target, clamped
into the leg's reach by `rig.clampPaw`, and becomes a ground contact the gait steps home), `rear`
0..1 (front feet off the ground), stance (`stanceF` / `stanceH` wider, `strideF` / `strideH`
forward, model units; `restep` 0..1 lowers the stride threshold so the feet re-plant there; in
place they take quick overlapping steps, all four within ~0.7 s, so the stance ends symmetric),
`hindLock` (hind feet stay planted: a lunge's push), `elbowsOut` 0..1 (braced / buckled forelegs),
`swell` 0..1 (chest swell), `airReach` 0..1 (airborne legs reach down for the landing), airborne,
sleep / dead / stagger, tail curl / wave / stiffness, gait speed + velocity) and the rig solves the
body — a nose-up pitch / rise the planted forelegs can't follow sits the hips back onto the haunches
— and refreshes `rig.pt` (world space): head, snout,
mouth, jawTip, headFwd, eyes, nostrils, chest (ribcage joint), chestC (deep-chest centre), hips,
neckBase, `legs[2]` (hind: hip, knee, ankle, toe), `arms[2]` (front: shoulder, elbow, wrist, toe),
`wings[2]` (root, elbow, wrist, knuckles[4], tips[4], mids[4] = knuckles, attachH). Index 0 = the
model-left (+X) side. Gait contacts (`rig.gait.limbs`): footL, footR, handL, handR; 4-beat lateral
walk (LH → LF → RH → RF) up to 5 m/s, diagonal trot to 8, bound above.
Striking-part names for tells (`partPos`): 'snout', 'head', 'mouth', 'claw' (a front paw, `b.wi`),
'forefeet' (front-paw midpoint; flashes at both paws; 'wrists' is the v0.3 alias), 'tailTip',
'shell', default chest. The stomp's red ground ring is centred between the two forefeet's landing
spots (root frame (±1.2, 0, 2.9) model units); the slam presses the paws there (dust + a heavy
`dragon:step` at each), holds them for 0.3 of the recovery, then plants them and steps home.

Rig additions from the reference match (2026-11-08). New `pose` fields (reset every frame; the
brain writes them):
- `idle` 0..1: no attack running (`Brain._combat` sets 1). The rig's idle life plays: breathing
  sails, weight shifts, gaze drift, a wing rouse every 8–11 s on fixed gaps while standing still
  (deterministic: it never draws on the AI's random stream), and the stalking stance.
- `tailLift` 0..1 (default 1): 1 = the arched resting tail (`REST_POSE.tail`), 0 = dragged low (the
  tail sweep, the stomp's tripod).
- `tailLegacy` (bool): the tail runs the exact v0.4 chain solve. The tail sweep (and its turn-away
  prelude) sets it, because its hit spheres and swept arc ride on the chain; otherwise the
  round-2 limits apply (rest shape at most `TAIL_SINK` 0.55 segments under the ground, segments at
  most `TAIL_DEV` [0.6 soft, 1.2] rad from their rest direction), easing back in after a sweep.
- `headExact` (bool): the head aims exactly, with no `HEAD_AIM_RATE` (11 rad/s) turn limit. Set on
  the frames whose hit spheres ride on the snout / mouth: bite and combo-lunge active, charge
  active, breath active, fireball.
- `headLead` (Vector3, world): an offset of the SHOWN head only. `strikeLead` (attacks.js) sets it
  over the last three windup frames of the bite and the claw combo's lunging bite (12 / 30 / 55 % of
  the strike's first step), so the head accelerates into the snap. No hit test runs in a windup;
  active frames are untouched (ADR-025).
- `drape[2]` 0..1 per wing: the wing collapses onto the ground beside the body, in world space
  (dying; the chest frame rolls with the body).

Two neck solves (ADR-025): `rig._neckSim` is the measured solve every attack's head path and hit
spheres were tuned on; `rig.neck` is the shown chain (applied to the joints, read by the neck hurt
spheres), blended toward the resting S by `s.rest`. While an attack drives the head (`s.rest` <
0.03) the shown chain swings toward the measured head (the head's step spread down its length,
`NECK_FOLLOW` 0.45 toward the measured shape) and the head joint is pinned to the measured solve
(`Chain.endQuat`), so the snout / head / mouth points are the measured ones (≤ 9 mm, float noise).
The pin is released only while `headLead` is non-zero.

`REST_POSE` (exported from rig/anim.js, tunable live from the console): `neck` (the resting S:
head low and forward), `lookDown` 0.45 / `headDip` 0.22, `stance` (`frontOut`, `frontFwd`,
`hindOut`, `hindBack`, `stalk { frontL, frontR, hindL, hindR }`, `crouch` 0.12), `sweep` (the
resting wings turn with the head toward a foe aside: `bias`, `look` 0.7, `max` 0.85, `maxBack` 0.35,
`arm` 0.4), `tail` (`pitch0`, `pitchStep`, `pitchCurve` + the dip `dipAmp`, `dipAt`, `dipWidth`).
`WING_KEYS.HALF` is a re-fitted cambered sail (wrist (±2.1, 7.5, −0.78) root frame, the leading
finger held ≥ 14° below the wrist) that keeps ≥ 0.42 of each wing's area visible from every 58°
game-camera yaw and the reference / front views. Death (`SEQ.death` → `deathPose` in ai.js) is a
timed collapse (`DEATH`: a throe, the legs give way from 0.3 s, the chest hits the ground at 1.1 s,
the head at 1.22 s, a last heave); every foot is locked while dying. The parry recoil throws the
head on an eased arc and plants any foot caught mid-step (`gait.plantAt`).

Rig helpers (internal to the dragon module):
- `Gait`: `plantAt(i, pos)` (plant contact `i` now; it steps home later), `settle` 0..1 (set by the
  rig from the stalk weight: standing still, a foot more than 0.24 × scale from its spot steps back,
  one 0.42 s step every 0.75 s), `turnRate` / `dYaw` / `pivot` (turning in place trots the feet
  round; the tail sweep's spin pivots planted feet with the body), per-limb `reach` (a planted foot
  past 0.92 of its leg's reach wants to step) and `off` / `posRef` (a swinging foot absorbs a jump of
  its home into `off`, which fades out by the landing; `posRef` is the contact without it, read by
  the scapula glide so the offset never feeds back into the body). Free contacts ease to their home
  (`FREE_RATE` 10/s) instead of snapping.
- `Chain` (rig/chain.js): constructor options `groundGlide` and `stableTwist` (the tail uses both,
  the neck keeps v0.4's), fields `devSoft` / `devMax` (swing limit from the rest direction;
  Infinity = off), `buildRest({ ..., dipAmp, dipAt, dipWidth, sinkMax })` (a dip that bends a
  stretch of segments down, and a cap on how deep the rest shape may dive under the ground),
  `endQuat(parentQ, out)` (the last joint's world rotation without touching the joints).
  `aimJointStable` keeps a joint's twist continuous near the −Z singularity (no 180° wing flips).
- `solveTwoBone(A, T, l1, l2, pole, outMid, outEnd, bend = null, soft = 0)` (rig/ik.js): `bend`
  (per limb, persistent) keeps last frame's bend direction when the pole runs along the limb; `soft`
  (the wing arms: 0.05) eases the last stretch toward full extension.
- Hurt spheres follow the arched resting tail: its first spheres sit ~3–4.5 m up, so a hero behind
  the wyrm hits hips and legs more and the tail less.

Damages the player only via `game.player.takeHit(...)` with tell data; announces tells with
`combat:tell` / `combat:flash` and shows them on its own body (no HUD marks):
- red (dodge-only) hits: `uWarn` on every material (`model.mats`), driven in `_updateWarn` from the
  running action's beats — strength ramps 0.1 → 0.38 from the hit's `combat:tell` to its
  `combat:flash`, spikes to 1.6 on the flash, decays to 0 in 0.25 s (game time). A replaced action
  (stagger, posture break, parry recoil, death, Lab interrupt) drops it at once; `reset()` and death
  zero it. Plus a red glyph burst + red light at the striking part on the flash (`fx.tellFlash`).
- parryable (normal / blue) hits: nothing during the windup; on the flash a white glint (star core,
  four-point sparkle, short rays, small white light) at the striking part, ×1.5 for blue.
- parries throw white/gold sparks (bigger for blue).

### HUD — `src/ui/hud.js` exports `class Hud`
```
constructor(game)          // builds DOM under #ui (inject its own <style>; do not edit style.css)
update(realDt)
log(text, channel='system')          // channel: 'system'|'combat'|'warn'|'lore'
showBossBar(name) / hideBossBar()    // boss HP + posture bar
banner(text, kind, opts)             // kind: 'death'|'victory'|'area'|'bonfire'|'phase'
bannerHint(text) / clearBanner(instant)   // sub-line under the current banner; flow uses both
showStats(rows)                      // victory / death run stats
prompt(text|null)                    // interaction prompt, e.g. "[E] Rest at bonfire"
promptText                           // getter: the prompt shown now (raw "[E] ..." text) or null
promptEl                             // the prompt's element (touch controls make it a tap target)
showTitle() / hideTitle();  showPause(bool);  toggleHelp()
```
**Touch layout:** the touch controls add `.ab-touch` to the HUD root (`.ab-root`). Elements with
`kb-only` are hidden then, `tp-only` ones only show then (title "PRESS ANY KEY" ↔ "TAP TO BEGIN",
the keyboard ↔ touch control lists in the title and pause menu, the pause menu's FULLSCREEN item
where the Fullscreen API exists). With `.ab-touch` the log, the key hint and the help panel are
hidden, the prompt becomes a tap target ("TAP › Rest at bonfire"), the pause panel scrolls; below
560 px of height (phones in landscape) the player frame (×0.8) and minimap (×0.6) shrink, the boss
bar narrows to the bottom centre between the thumbs, and the title / banners / record compact.
Desktop (no `.ab-touch`) is unchanged.
Renders no attack tells of its own: no text, icons, rings or arrows (tells are read from the
attacker — COMBAT.md). Its only tell cue is a brief red screen-edge flash (~0.25 s, game time,
stronger on the attacker's side) on a red `combat:flash`, dropped by a stagger / posture break /
death / retry (`ui/tells.js`). Also renders parry / Ghostep / guard-break call-outs, the cyan
Ghostep edge pulse, the posture bar, and the crit-window cue.

### Flow — `src/game/flow.js` exports `class GameFlow`
```
constructor(game);  update(dt, realDt)
cameraOverride: null | { focus: Vector3, weight: 0..1, zoom: meters }   // read by main.js
debug: { toState(name) }               // Lab: 'explore'|'boss'|'dead'|'victory' with consistent side effects
```
Owns `game.state`, title → explore → bossIntro → boss → dead/victory, pause (Esc), bonfire rest (E),
retry after death (respawn at bonfire, `dragon.reset()`, `world.scorch.reset()`), F2 quality,
M mute, H help, F3 fps. Boss framing (`boss` state, `TUNE.bossCam`): the override focuses on the
box of the hero + `dragon.hurtSpheres` (tall parts leaned up-screen) and adds at most 5 m of zoom
(`maxZoom`; kept small so the hero stays readable, which is the owner's priority). The hero is
always kept inside the view, and the far end of the wyrm crops first. It fades out when the hero is > 16–36 m from the body or has wheel-zoomed in
(Lab Showroom; "zoomed in" is measured against the rig's own profile, `rig.minDistance` →
`rig.defaultDistance`). On a phone (`cameraRig.mobile`) `TUNE.bossCamMobile` overrides it: weight
0.85, at most 2 m of zoom (the rig caps extra zoom at 3 m anyway), a wider landscape view to the
sides, and the hero may sit lower (`marginSouth` 1.6 m) so more of the wyrm shows above it.
Touch: with `game.touch.active` the death hint reads "tap to rise again" and the "H: controls ·
Esc: pause" log line is skipped. Screen taps reach `_dismissPressed` as a virtual LMB press.

### Audio — `src/audio/audio.js` exports `class AudioEngine`
```
constructor(game)          // subscribes to events; AudioContext created lazily
unlock()                   // call on first user gesture (flow does this on title dismiss)
update(realDt)
play(name, opts)           // one-shot SFX by name
setMusic(mode)             // 'none'|'ambient'|'boss'|'boss2'|'victory'|'death'
toggleMute(); muted: boolean;  setVolume(0..1)
```

### Lab — `src/dev/lab.js` exports `class Lab`
```
constructor(game)          // hidden unless URL has ?lab or the user presses F1 / backquote / the LAB button
update(realDt)             // panel refresh + hitbox overlay (runs before flow)
postUpdate()               // main.js calls it after the actors update so the overlay matches this frame
open: boolean
showroom()                 // look-dev preset: fight on, AI off, god mode, hero 7 m in front, camera close
modelView(opts | null)     // model viewer (below)
```
**Floating toggle** (`.lab-badge.lab-toggle`, top centre, clear of the player frame): shown whenever
the Lab exists in the page (`?lab`, or opened once) or a Lab cheat is active; a tap / click opens or
closes the panel (phones have no F1). Closed it reads `LAB` (+ `· god · x0.25 …` while cheats run),
open `× LAB`. The panel's own `×` and the toggle are 36 px touch targets on coarse pointers / touch.
Small screens (≤ 560 px tall or ≤ 700 px wide): a compact panel with a max-height that always fits
and scrolls inside (`touch-action: pan-y`). VIEW → **Touch UI** switches the touch controls on / off
(desktop testing of the phone layout, camera and quality).

Debug panel to test the fight without playing it: trigger any `dragon.debug.abilities()`, phase /
stagger / posture break / kill / reset, jump flow states, god mode, infinite flasks, time scale,
AI on/off, hitbox overlay, teleport. Talks only to the `debug` APIs above, plus the
`game.viewOverride` and `world.debug.setVisible` hooks for the model viewer.

**Model viewer** (`src/dev/modelView.js`, Lab → VIEW → MODEL VIEW) renders an actor from the angles
of a character sheet (the game camera is a fixed 58° top-down view):
```
__game.lab.modelView({
  target: 'hero' | 'dragon',   // default: the current one, else 'hero'
  yaw,      // deg around ITS facing: 0 = its front faces the camera, 90 = its left side, 180 = back, 270 = right
  pitch,    // deg elevation: 8 ≈ character-sheet eye level (default), 58 = the game camera; clamped −30..89
  dist,     // m from the look point; omit = auto-fit (whole actor incl. wings / tail / sword, ~10 % margin)
  height,   // m above its root for the look point; omit = auto (centre of its projected silhouette)
  dark,     // true: hide the world (world.debug.setVisible(false)); lights, shadows-on-self and glow stay
  // extras
  solo,     // hide the other actor in the render (default = dark)
  forward,  // m along its facing for the look point (omit = auto); with `height`, aims e.g. at a head
  lockYaw,  // true: sample its facing once at the call; default: the camera follows its facing every frame
  game,     // true: `yaw` is world-fixed like the gameplay camera (0 = from the south) — the Game button
})          // → { target, yaw, pitch, dist, height, forward, dark, solo, game, lockYaw, auto: {dist, height} }
__game.lab.modelView(null)   // → 'off': game camera, HUD, world, AI and god mode restored
```
While viewing: dragon AI off and player god mode on (each restored on exit only if the viewer
changed it), every HUD layer in `#ui` is faded out (class `lab-mv`; the Lab panel stays), the hero's
mouse aim is pinned along its facing (it never chases the cursor through a side camera), and the
camera follows the actor each frame (`lab.postUpdate`, before main.js applies the override). The
auto-fit is measured at the call (and again on resize / Lab panel open-close) from the per-mesh
bounding boxes of the current pose; with the panel open the actor is centred in the free area to its
right. `solo` hides the other actor only between `lab.postUpdate` and the next `lab.update` (the
actors never see their `visible` flag change). Poses are driven as usual — `dragon.debug.trigger(name)`,
player inputs / methods — and stepped with `__tick(dt, frames)`.

### Touch controls — `src/ui/touch.js` exports `class TouchControls`
```
constructor(game)          // inert (no DOM, no state) until activated: `pointer: coarse` at boot, ?touch, or the first touch
active: boolean;  phone: boolean   // phone = active and the short screen side ≤ CONFIG.camera.mobileMaxSide (600 px)
portrait: boolean;  autoAim: boolean
setActive(on)              // Lab "Touch UI", tests; off restores the desktop camera + quality + HUD
update(realDt)             // main.js, after the mouse ray, before the Lab / flow / player
```
A layer on top of `core/input.js`: nothing else reads it, the player and flow keep reading
`game.input`. Mapping (all through `input.setVirtual` / `setVirtualAxis`, so edges and tap vs hold
timings are the real device's):

| control | feeds | behaviour |
|---|---|---|
| stick (left thumb, floats under the thumb in the left 42 % × lower 74 %) | `setVirtualAxis` | analog: dead zone 0.16, full run at 0.62 of the 52 px travel; ≥ 0.94 (rim) holds `ShiftLeft` = sprint (off below 0.86) |
| ATTACK | `Mouse0` | tap = light combo, hold ≥ 0.3 s = charge, release = thrust; shows an ASCII charge meter `[###...]` |
| BLOCK | `Mouse2` | hold = block, tap just before impact = parry |
| DODGE | `Space` | roll / perfect dodge |
| FLASK · LOCK · PAUSE (glyph `\|\|`) | `KeyF` · `Tab` · `Escape` | flask count, LOCK lit while locked on |
| the HUD prompt | `Key<letter>` from its `[E]` / `[R]` token | rest at the bonfire / fight again |
| a bare-screen tap on title / death | `Mouse0` | "press any key" |
| two bare-screen fingers in play | `cameraRig.zoom` | pinch (distance × start / now) |

**Aim** (`game.mouseGround`, each frame in `explore` / `bossIntro` / `boss`): with the dragon
targetable and within `CONFIG.touch.autoAimRange` (32 m) it is the dragon's lock point (attacks,
facing and the camera look-ahead go to it, like a cursor parked on it); otherwise it sits
`CONFIG.touch.aimDistance` (6 m) ahead of the hero along the last stick direction. LOCK still toggles
the real lock-on. Controls show only in play states (hidden on title / pause / death / victory /
model viewer); hiding releases every held control. **Portrait** (`innerHeight > innerWidth`): a
"rotate your phone" overlay (z 60, on `<body>`), controls released, play states pause. Activation
also: `html.abyss-touch` (touch-action none, no callouts, crisp `image-rendering: pixelated`),
`.ab-touch` on the HUD, the phone camera profile, and `CONFIG.defaultQualityTouch` when the
quality is still the default. Pointer Events with multi-touch (each control captures its own
pointer); long-press menus, iOS gesture zoom and page panning are blocked while active (the Lab
panel and the pause panel still scroll). Tuning: `CONFIG.touch`, sizes / look in `ui/touchStyle.js`.

## Event catalogue (exact names — producers → consumers)
Player → hud/audio/fx/flow:
- `player:attack {kind:'light'|'slam'|'thrust', combo, charge}` (swing starts; slam = combo hit 3, thrust = charge release),
  `player:charge {t}` (charge start; t = seconds to full charge), `player:slam {x, z}` (the slam meets the ground: shard burst),
  `player:hitDragon {damage, part, point, heavy, crit, kind}` (heavy = slam / thrust), `player:hurt {damage, kind, hp}`,
  `player:block {damage, tell}`, `player:parry {tell, attack}`, `player:guardBreak {attack}`,
  `player:dodge {kind}` (an attack passed through i-frames), `player:perfectDodge {attack, tell}`,
  `player:ghostep {x, z}`, `player:roll {backstep}`, `player:heal {amount, flasks}`, `player:noFlask`, `player:died`,
  `player:footstep {x, z, sprint}` (a planted foot's touchdown while moving, and the thrust dash's
  two bounding steps), `player:lockOn {on}`
Dragon (any attacker) → hud/audio/flow:
- `combat:tell {source:'dragon', attack, tell, impactIn, x, z}` (windup start, per hit; x/z = the
  striking part; impactIn is a first estimate in game seconds),
  `combat:flash {source:'dragon', attack, tell, x, y, z}` (~0.35 s before impact — the **authoritative**
  timing cue: moving targets (charge, fireball) re-time it after the tell),
  `combat:deflectChain {count}` (the 2nd, 3rd ... parry in a row within one string; contract 1)
- `dragon:wake`, `dragon:roar {strength}`, `dragon:introDone`, `dragon:windup {name}`, `dragon:attack {name}`,
  `dragon:step {x, z, heavy}`, `dragon:wingFlap {strength}`, `dragon:takeoff`, `dragon:land {x, z}`,
  `dragon:breathStart`, `dragon:breathEnd`, `dragon:fireball {x, y, z}`, `dragon:explosion {x, z, radius}`,
  `dragon:bite`, `dragon:hurt {damage, part, hp, crit}`, `dragon:parried {attack, tell, hit, last}` (hit = 0-based
  index in its string, last = the string's last hit or a single attack: only then a recoil),
  `dragon:posture {posture, max}`, `dragon:postureBreak`, `dragon:stagger` (ordinary stagger only), `dragon:phase2`,
  `dragon:phase3`, `dragon:phase {n}` (with each of the two above), `dragon:plunged {execution}` (contract 2),
  `dragon:death`, `dragon:dead`,
  `dragon:spell {name, x, z}` (a fire attack's signature moment: the strafe's pass, the dive, the barrage's
  rise, a spell's cast / the nova's charge start), `dragon:hazard {kind, stage, x, z, radius}` (a fire hazard:
  stage 'fall' = a meteor starts its visible fall, 'hit' = a meteor / pillar / the dive's crash / the nova goes off)
- Hazard tells: a self-announcing hazard (meteors, chase pillars) emits combat:tell / combat:flash with
  source 'dragon', its spell as the attack, tell 'red' and hazard: true (audio plays a lighter cue)
Flow → hud/audio:
- `state {from, to}`, `bonfire:rest`, `game:retry`, `game:victory`, `area {name}`

## Ownership (parallel work)
Foundation (read-only for module authors unless their brief says otherwise): `src/core/**`,
`src/render/**`, `src/world/**`, `src/combat/**`, `src/main.js`, `index.html`, `src/style.css`.
Each module owns only its directory. If a module needs a foundation change, it reports it instead of editing.
