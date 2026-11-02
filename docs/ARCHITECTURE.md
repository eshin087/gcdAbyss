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
lab.update(realDt) → flow.update(dt, realDt) → player.update(dt) → dragon.update(dt)
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
flow, lab — constructors must not dereference modules built later.

## The `game` context (passed to every constructor)
| field | what |
|---|---|
| `THREE`, `CONFIG` | three.js namespace, `core/config.js` |
| `renderer, scene, fxScene, camera, pipeline, U` | rendering. `U` = shared uniforms (`render/shaderLib.js`) |
| `events` | pub/sub: `on(name, fn)` → unsubscribe fn, `emit(name, data)` |
| `input` | `down(code)`, `pressed(code)`, `released(code)`, `mouseDown(b)`, `mousePressed(b)`, `mouseReleased(b)`, `moveAxis()` → `{x, y}` (y = up/north), `anyPressed`, `wheel`. Codes are `KeyboardEvent.code`. |
| `mouseGround` | `Vector3` — mouse ray ∩ ground plane, updated each frame |
| `cameraRig` | `addTrauma(0..1)`, `extraZoom`, `focus` |
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
| `settings` | `{ quality: 0..2, showFps: bool }`; `applyQuality()` re-applies |

Shared combat rules: `src/combat/rules.js` — `TELL`, `RESULT`, `TELL_STYLE`, `DEFENSE`, `POSTURE`,
`tellDefaults(tell)`, `facingDelta(...)`. Never hard-code these windows in actor code.

Render helpers for creature modules:
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
getChestPos(out: Vector3): Vector3
respawn(x, z)                          // full restore, idle, facing north, clears burn/lock/crit
restAtBonfire()                        // refill hp/flasks (no teleport)
update(dt)
debug: { god: boolean, infiniteFlasks: boolean, heal(), teleport(x, z), kill() }   // used by the Lab
```
Controls (only while `game.state` ∈ {`explore`,`bossIntro`,`boss`}): WASD move · mouse aim · LMB tap =
light combo (sweep → backhand sweep → two-handed slam finisher), LMB hold ≥ 0.3 s then release =
charged lunging thrust · RMB hold = block, RMB tap before impact =
parry · Space = dodge roll · Shift = sprint · F = flask · Tab / MMB = lock-on. (E is flow's.)
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
module (nothing outside reads the rig). `DIM.bladeBase → DIM.bladeTip` (0.16 → 1.5 m along the
sword, + `REACH.tipExt`) is the **hit segment**; the visible steel ends at `DIM.steelTip` (1.17 m:
1.36 m of steel with the pommel) and the cyan dot halo past the point (`PlayerFx.bladeHalo`) carries
the rest of the reach. The animator (`player/anim.js`) drives: `coat` = 7 skirt panels
(`COAT_PANELS`: six + the front flap), each two spring segments plus `strips` (22 torn strips, one
spring each, kept above the grass); `streamers` (two two-segment sleeve strips on the arms); `hair`
= 5 spring clusters (`HAIR_CLUSTERS`: fringe, left, right, crown, nape), each with a dark-root mesh
(`hair`) and a sheened-tip mesh (`hairTip`). Static meshes that share a joint and a material are
merged at build time (fewer draw calls); only the flask stays separate.
**Glyph scale** (`model.js` exports `setHeroGlyphScale(mats, dist) → k` and `GLYPH_SCALE`): every
frame `Player._updateMaterials` measures the camera → hero distance (`player.viewDist`) and rescales
the hero materials' glyph cells, k = clamp(dist / 12, 0.15, 1): in-game cells at the 36 m camera
(and anywhere beyond 12 m), finer in Lab / showroom close-ups (≈30 rows for the figure at 4 m).
Per material `userData.cell` (in-game cell), `userData.cellMax` (cap for small parts: hair, collar,
plates), `userData.lockX` (the blade's two columns), `userData.zoom / zoomNear` (glyph zoom at the
game camera, default `GLYPH_SCALE.farZoom` 0.45 so the glyphs fill their cells / in close-ups);
materials without `userData.cell` (gem, eye, skin, flask) keep fixed
cells. `player.bladeFar` (0 close-up … 1 at ≥ 28 m) makes the blade self-light with distance (dark
steel with glowing edges up close, a solid cyan line at the game camera). It touches only the
hero's own materials (no shared uniform, no allocation).
FX helpers that changed shape: `PlayerFx.gemTick(dt, x, y, z, k, vx, vz, vy)` and
`gemGlint(x, y, z, s, vx, vz, vy)` take the gem's own velocity (`player.gemVel`, measured from the
gem joint each frame) so glints ride the hilt; `gemTick` also keeps an always-on 0.22–0.26 m violet
glow point at the gem; `bladeHalo(dt, k, far)` grows its dots with distance and lays a short bright
`|` streak 0.06–0.26 m past the point.

### Dragon — `src/entities/dragon/dragon.js` exports `class Dragon`
```
constructor(game)                      // builds the four-legged drake, sleeping at CONFIG.world.dragonSleep
object3d, position (Vector3, root on ground), yaw
bound: number                           // radius around the arena centre the root stays inside:
                                        // min(CONFIG.world.dragonBound, TUNING.bound = 24) (move, charge, leap target)
name = 'VAELGRIM, THE CINDER WYRM';  hp, maxHp;  phase: 1|2
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
                                        // phase gate: with the AI on, phase-1 damage stops at the phase-2
                                        // threshold until the transition starts (no skipping phase 2)
onParried({ attack, tell }): void       // the dragon calls this itself when player.takeHit returns 'parried'
hitstop(sec, scale)                     // game.hitstop that won't crush a running Ghostep slow-mo
reset()                                 // back to sleeping at the nest, full HP/posture, phase 1, all FX/lights cleared
update(dt)
debug: {                                // used by the Lab (generic shape every future enemy implements)
  abilities(): Array<{ name, label, tell, phase }>,   // includes 'roar' (the phase-2 shock ring)
  trigger(name): boolean,               // force an ability now (wakes/starts the fight if needed); false while busy
  setAI(enabled: boolean), aiEnabled: boolean,
  wake(), startFight(),                 // startFight skips the intro straight into combat (no-op if fighting)
  phase2(), stagger(), postureBreak(), kill(), reset(), setHp(fraction 0..1),
  hitboxes(): Array<{ x, y, z, r, kind: 'hurt'|'attack' }>,  // for the Lab overlay
  currentAction?(): string|null         // optional, Lab readout
}
```
Size: the model is authored in model units and the root is scaled by `SCALE` (tuning.js, 1.875
since v0.3); every world-space number (reaches, radii, hurt spheres, body circles, AI ranges, FX,
pushers, pose targets via `rootPt`) is multiplied by it. The hero does not scale, so 3D hit volumes
/ AI ranges are re-checked against him (integration sims) when `SCALE` or the anatomy changes.
Body plan (v0.4, "four-legged rebuild", docs/art/dragon.md): a quadruped drake, withers 4.0 model
units (7.5 m), columnar forelegs (elbow back) + digitigrade hind legs, a short thick upright S-neck
(7 × 0.46 chain), a 16-segment tail lying in a sideways hook, and a separate pair of wings rooted on
top of the back (humerus → forearm → wrist + thumb hook → 4 two-joint fingers, 4 membrane panels).
Anatomy numbers live in tuning.js `ANATOMY`.
Look ("Obsidian Drake", model.js): materials in `model.mats` (scales, limbs, neck, belly, throat,
lava, membrane, wingBone, spine, bone, claw, teeth, maw, eye; `limbs` = the hide on legs, tail and
the wing arm, its fissures running along the limb; the hide / membrane / bones use per-cell glyph
`levels`, the hide's `inkGlow` is its shading floor); crack glow per material from `model.glow`
(`[phase-1 ember, × glow (phase 2 / death), × throat charge]`, applied in `_applyMaterials`; every
`model.mats` key needs a `model.glow` row except `eye`, which follows `rig.s.eyes`).
Wing membrane (membrane.js): `new WingMembrane(material, side, restKey)` — 4 Coons panels rebuilt
from the bones every frame (allocation-free); `aGUV` is laid out once from `restKey`
(`WING_KEYS.HALF`), so the glyph grid is even in the resting pose; `aEdge` (0 inside → 1 on the free
trailing edge) is a static per-vertex attribute for a ragged-edge discard (not read by the material
yet). Resting body language (`TUNING.rest`): wings `spread` 0.5 (HALF) in both phases, ≤ 0.3 while
walking; jaw 0.4 (phase 1) / 0.65 (phase 2); attacks return to `TUNING.rest.spread`.
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
showTitle() / hideTitle();  showPause(bool);  toggleHelp()
```
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
(Lab Showroom).

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
constructor(game)          // hidden unless URL has ?lab or the user presses F1 / backquote
update(realDt)             // panel refresh + hitbox overlay (runs before flow)
postUpdate()               // main.js calls it after the actors update so the overlay matches this frame
open: boolean
showroom()                 // look-dev preset: fight on, AI off, god mode, hero 7 m in front, camera close
modelView(opts | null)     // model viewer (below)
```
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

## Event catalogue (exact names — producers → consumers)
Player → hud/audio/fx/flow:
- `player:attack {kind:'light'|'slam'|'thrust', combo, charge}` (swing starts; slam = combo hit 3, thrust = charge release),
  `player:charge {t}` (charge start; t = seconds to full charge), `player:slam {x, z}` (the slam meets the ground: shard burst),
  `player:hitDragon {damage, part, point, heavy, crit, kind}` (heavy = slam / thrust), `player:hurt {damage, kind, hp}`,
  `player:block {damage, tell}`, `player:parry {tell, attack}`, `player:guardBreak {attack}`,
  `player:dodge {kind}` (an attack passed through i-frames), `player:perfectDodge {attack, tell}`,
  `player:ghostep {x, z}`, `player:roll {backstep}`, `player:heal {amount, flasks}`, `player:noFlask`, `player:died`,
  `player:footstep {x, z, sprint}`, `player:lockOn {on}`
Dragon (any attacker) → hud/audio/flow:
- `combat:tell {source:'dragon', attack, tell, impactIn, x, z}` (windup start, per hit; x/z = the
  striking part; impactIn is a first estimate in game seconds),
  `combat:flash {source:'dragon', attack, tell, x, y, z}` (~0.35 s before impact — the **authoritative**
  timing cue: moving targets (charge, fireball) re-time it after the tell)
- `dragon:wake`, `dragon:roar {strength}`, `dragon:introDone`, `dragon:windup {name}`, `dragon:attack {name}`,
  `dragon:step {x, z, heavy}`, `dragon:wingFlap {strength}`, `dragon:takeoff`, `dragon:land {x, z}`,
  `dragon:breathStart`, `dragon:breathEnd`, `dragon:fireball {x, y, z}`, `dragon:explosion {x, z, radius}`,
  `dragon:bite`, `dragon:hurt {damage, part, hp, crit}`, `dragon:parried {attack, tell}`,
  `dragon:posture {posture, max}`, `dragon:postureBreak`, `dragon:stagger` (ordinary stagger only), `dragon:phase2`,
  `dragon:death`, `dragon:dead`
Flow → hud/audio:
- `state {from, to}`, `bonfire:rest`, `game:retry`, `game:victory`, `area {name}`

## Ownership (parallel work)
Foundation (read-only for module authors unless their brief says otherwise): `src/core/**`,
`src/render/**`, `src/world/**`, `src/combat/**`, `src/main.js`, `index.html`, `src/style.css`.
Each module owns only its directory. If a module needs a foundation change, it reports it instead of editing.
