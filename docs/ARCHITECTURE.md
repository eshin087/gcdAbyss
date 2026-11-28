# gcd — Architecture & Module Contracts

Browser game, Three.js 0.180 (WebGL2), plain ES modules, no framework. `npm run dev` serves the
repo at http://localhost:5173 ; `npm run build` emits a single-file `dist/index.html`.
This file is the **source of truth for cross-module APIs and event names** (contract version: v0.6,
the bullet-hell round of 2026-11-09 on top of v0.5's epic wyrm fight: strings and the deflect chain,
the plunge, three phases, fire hazards, keep-in-view camera, and now the bullet field).

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
wheel zoom → mouse ray (mouseGround) → gamepad.update(realDt) → touch.update(realDt)
→ 1 – 6 simulation steps (core/timestep.js), each of stepDt real seconds:
    clocks → lab.update(stepDt) → flow.update(dt, stepDt) → player.update(dt) → dragon.update(dt)
  and after every SECOND step, and after the last (the world's step, ADR-199), with the time of the
  steps since its last run:
    world.update(dt) → fx.rip → lights.update → fx.update (alpha, add, fire, shed, ripple, streak, stamp)
      (world.update: … scorch.update → life.update → atmosphere.update: the living world first, so
       the atmosphere's smoke and embers read this frame's wind; neither while the Lab hides the world)
    (input.endFrame() after the FIRST step: the frame's presses and releases are seen once)
→ lab.postUpdate() → camera (rig, realDt) → view override → shared uniforms
→ hud.update(realDt) → audio.update(realDt) → render
→ lab.postRender()   (same task: the Lab model viewer's sheet reads the drawn frame back)
→ AUTO quality (main.js autoStep, ADR-200: the frame's interval, script ms and GPU ms into
  game.autoQ; a step changes the size through applyQuality, for the next frame)
```
Before all of it the frame-rate cap (`game.pacer.tick(now)`, a touch device by default) may skip a
refresh; a skipped refresh runs nothing and its time joins the next drawn frame's `realDt`.
**Simulation steps** (ADR-103, `core/timestep.js`): a frame of `realDt` s (at most `FRAME_MAX` 0.1 s) is
simulated in `simSteps(realDt)` equal steps, none longer than `STEP.max` 1 / 60 s × (1 + `slack` 0.25)
= 20.8 ms: one step at 50 Hz and above (as before), two steps of 1 / 60 s at 30 fps, three at 20 fps,
six at most (below 10 fps the game runs slow). `runFrame(realDt, simulate, afterFirst, out, one)` runs
them. So no machine simulates a longer step than the headless tests do (they step at 1 / 60 s), and a
0.08 s perfect-parry window is sampled five times at 30 fps instead of three. Inside a step
`game.realDt` is the STEP's real time; `game.frameDt` is the frame's and `game.simSteps` how many
steps it took. `window.__tick(dt, frames)` runs one exact step of `dt` per frame (film strips);
`window.__tick(dt, frames, true)` runs each as a rendered frame of `dt`, cut as the real loop cuts it.
**The world's step** (ADR-199, `STEP.world` 2): only what the timing windows hang on is stepped at
1 / 60 s: the Lab, the flow, the hero, the boss. The world (what breaks and burns, scars, the scorch map,
the grass's wake, the living world, the atmosphere), the time rip, the light pool, both particle pools,
the fire field, the shed digits, the ripple, the streak and the stamp run once for every two of those
steps and once more after the last: `runFrame(…, world)` calls `world()` there, and main.js hands it
the game time, FX time and real time of the steps since its last run (`game.dt`, `game.fxDt`,
`game.realDt` read that while it runs). A frame of one step runs exactly as before (the fighters, then
the world, on the same time); at 30 fps the world steps once with 33 ms, at 20 fps twice; its longest
step is 41.7 ms. A slow machine so pays twice for the fighters only (the world and the effects were
about 40 % of a step). New per-frame code that is not part of the duel's timing goes in the world's
step, not in `simulate`; anything in it must be stable at a 42 ms step (world test `worldstep`).
**View override** (`game.viewOverride`, Lab model viewer only): when it is
`{ pos, target, focus? }` (Vector3-likes, world metres), main.js places the camera at `pos` looking
at `target` right after the rig update, and the fog centre (`U.uFocus`), the light-pool selection
and the shadow box follow `focus` (default `target`) instead of the player / rig focus.
`uCamPos`, `uCamRight/Up`, `uPlayerScreen`, `uBossScreen` and the ASCII pass are all derived from the overridden
camera, so lighting, rim / outline, particles and the glyph grid work from any angle. The rig keeps
updating underneath; `null` snaps back to the game camera. A missing, non-finite or degenerate
override is skipped for that frame (never throws, never feeds NaN).
`dt = realDt × game.timeScale × game.debugTimeScale × hit-stop`. `realDt` is unscaled.
**`fxDt`** (`game.fxDt`): what the particles and the light pool advance by. Equal to `dt`, except
through a hit-stop, where it is `realDt × timeScale × debugTimeScale × max(hit-stop, CONFIG.render.fxLive
0.6)`: a freeze-frame holds the fighters on the impact's pose while its sparks fly on (never faster
than the game, never while the game stands still: a pause). Glyphs re-drawn every frame size their
life from `game.fxDt ?? game.dt` (one set is alive at each render however many steps a frame takes:
a set dies in the step after it was drawn). Input edges
(`pressed`) are valid for exactly one simulation step: the first of their frame. Construction order: world, audio, player, dragon, hud,
gamepad, touch, flow, lab — constructors must not dereference modules built later.
**`render`** = `pipeline.updateShadowCamera(focus)` then `pipeline.render()` (`render/pipeline.js`):
```
scene.updateMatrixWorld()            once for both scene passes (scene.matrixWorldAutoUpdate is off while they draw)
→ rigid bone sync                    every batched mesh's matrixWorld → U.uBoneTex (render/rigidBatch.js)
→ moon shadow map                    LAYER_CASTER with the depth material, then LAYER_CASTER_RIGID (one shadow
                                     mesh per batched actor) with the bone-reading depth material, same map;
                                     through the still shadow map (below) only what moves is drawn each frame
→ world → sceneRT
→ the hero where something covers him   a probe, then (only while it finds cover) the hero alone → seenRT,
                                     minus what the scene shows of him, the rest back into sceneRT (ADR-106)
→ the fire field                    heat blobs → a heat buffer → a flame texture, one texel per art cell
                                     (render/fireField.js, ADR-113; skipped while it holds no blob)
→ the impact ripple                `ripple.write(pipeline)` in `_updateAsciiCamera`: its live hits
                                     projected with the final camera into `uRip*` (ADR-149)
→ ASCII pass → FX pass (fxScene: the fire field's letters first, then the glyph particles) → bloom → final grade
→ updateZoomArt()                    picks the zoom ladder step the NEXT frame draws at (?zoomArt; ADR-120)
```
World matrices are therefore final when `render` starts: anything that moves an object after the
actors' updates must do so before `pipeline.render()` (a transform changed between the two scene
passes was never supported; now neither pass re-walks the graph). The cameras still update
themselves (`shadowCam` in `updateShadowCamera`, the main camera by the rig / view override).
**Keep-in-view:** during their update, flow (a flying or rearing wyrm) and the player (the plunge)
may call `cameraRig.keep(...)` for world spheres that must stay on screen; the rig consumes the
requests in its update the same frame (requests last one frame). `dragon.update` also runs the fire
hazards and the bullet field (`dragon.hazards.update`, `dragon.bullets.update`, both guarded), then
the thrown piece (`dragon.terrain.update`) and the phase-3 fire on its body (`dragon.ablaze.update`,
ADR-120).

## The `game` context (passed to every constructor)
| field | what |
|---|---|
| `THREE`, `CONFIG` | three.js namespace, `core/config.js` |
| `renderer, scene, fxScene, camera, pipeline, U` | rendering. `U` = shared uniforms (`render/shaderLib.js`), including `U.uBoneTex` (the rigid batches' bone matrices, see Rigid batching below) and the living world's wind, `U.uWind` (vec4) and `U.uWindFronts` (vec4[12]; written by `world/life/wind.js`, all zero while its piece is off: "The living world" → The wind). `pipeline.setShadowSize(texels)` resizes the moon shadow map (`pipeline.shadowSize`; main.js `applyQuality` passes the preset's `shadow`) |
| `events` | pub/sub: `on(name, fn)` → unsubscribe fn, `emit(name, data)` |
| `input` | **Actions** (ADR-067, `core/bindings.js`): `act(a)`, `actPressed(a)`, `actReleased(a)` — true when any code bound to action `a` (or its virtual code `'@a'`) is down / pressed / released; `bindings` (the `Bindings` instance); the player, flow and timing trainer read only actions. Raw: `down(code)`, `pressed(code)`, `released(code)`, `mouseDown(b)`, `mousePressed(b)`, `mouseReleased(b)`, `moveAxis()` → `{x, y}` (y = up/north, from the up / down / left / right actions; keys give a unit vector, a deflected virtual stick wins with its analog length ≤ 1), `anyPressed`, `wheel`. Codes are `KeyboardEvent.code`. **Virtual sources** (touch): `setVirtual(code, down)` (code = a `KeyboardEvent.code` or `'Mouse0'`/`'Mouse1'`/`'Mouse2'`; same one-frame `pressed` / `released` edges as the real device, only on a change), `setVirtualAxis(x, y)`, `releaseVirtual()` (everything up, stick centred). Virtual holds are tracked apart from the real keys / buttons. **Gamepad source** (ADR-066): `setPad(code, down)`, `setPadAxis(x, y)`, `releasePad()` — the same semantics with their own holds (a release on one source never drops a hold on another); a deflected pad stick wins over the touch stick and the keys in `moveAxis()`. `pulse(code)`: a one-frame `pressed` edge with no hold. `dodgeToward(x, y)` (ADR-278, the touch swipe): a dodge press (`pulse('@dodge')`) with its own direction in `moveAxis()`'s space, in `dodgeAim` `{x, y, set}` for that frame only; the player takes it with the buffered press (`rollAim`) and rolls that way instead of along the stick. `kbmT`: `performance.now()` of the last real keyboard / mouse event (a mousemove only with movement). Mouse events within 1 s of a touch pointer event (browser compatibility mousedown / mouseup / mousemove) are ignored. |
| `mouseGround` | `Vector3` — mouse ray ∩ ground plane, updated each frame (the ray from the camera without the kick's translation, `cameraRig.kickOff`); with a gamepad in use or touch controls on, their aim point (see Gamepad controls, Touch controls; shared helper `ui/aim.js` `aimWithoutCursor`) |
| `cameraRig` | `addTrauma(0..1)`, `extraZoom`, `focus`, `zoom(steps)` (2.5 m per step, clamped to the profile), `targetDistance`; `wheelDistance` (2026-11-16, ADR-120: the player's own zoom, `targetDistance` eased at 4/s without the framing, the cinematics and the punches the game adds; every update writes `camera.userData.zoomRatio` = `wheelDistance / defaultDistance` and `camera.userData.zoomArtOff` = `mobile`: what the letters follow, see "The letters follow the zoom"); distance profile `setMobile(bool, portrait = false)` / `mobile` / `portrait` / `lead`, `defaultDistance`, `minDistance`, `maxDistance`, `maxExtraZoom` (desktop: `CONFIG.camera.distance/min/max`, unlimited extra zoom; phone: `mobileDistance` 20 / `mobileMinDistance` 14 / `mobileMaxDistance` 34, extra zoom (lock-on, boss framing, title / intro shots) capped at `mobileMaxExtraZoom` 3 m). `setMobile` resets the zoom to the profile default; a phone held upright (`portrait`) stands `CONFIG.camera.portraitDistance` (1.2) × further back and looks `portraitLead` (1.5 m) south of the focus, so the hero stands above the middle of the screen (ADR-097). `fovFor(aspect)` (exported by `core/cameraRig.js`, applied by main.js on every resize): the vertical field of view, `CONFIG.camera.fov` in landscape, opened in a window taller than wide until the view is as wide as a square window's (`portraitMaxFov` 68 at most). `punch(m)`: the zoom punch (`game.punch`). `kick(dx, dy, dz, m)`: the directional kick (`game.kick`): `kickX` / `kickY` (m along the screen's right / up axes; the camera and its look point move together, so the view direction and the figures' lean are unchanged) and their velocities `kickVX` / `kickVY`, a damped spring (`KICK`: ω 30, ζ 0.55, ≤ 0.5 m per axis) stepped in real time after the frame's offset is drawn (the kick's frame shows the whole throw); `kickOff` (Vector3): the world translation the kick put on the camera this frame (0 without one; main.js takes it off the mouse ray, so `mouseGround` and the aim never wobble with a landed cut); `snap()` zeroes it and the punch. `cine = { zoom, x, z, w }`: flow.cinematic's pull-in (zoom m added to the distance at the desktop distance, scaled by `defaultDistance / CONFIG.camera.distance` on the phone like the punch; negative = closer; the follow focus leans toward (x, z) by w; all 0 when no moment runs). **Keep-in-view** (`FIT` in `core/cameraRig.js`): `keep(x, y, z, r = 1, must = false)` asks for a world sphere to stay on screen this frame (≤ 16 per frame; non-finite input is ignored). After the usual follow / distance damping the rig projects the subjects with the real camera and eases a ground-plane pan (`fitX` / `fitZ`, ≤ 30 m) and extra distance (`fitZoom`: ≤ 6 m to fit every subject, ≤ 12 m for `must` ones; phone 1.5 / 3 m) until they sit inside the NDC box (\|x\| 0.9, top 0.86, bottom 0.78). `must` subjects (the hero) are never cropped to fit the others. Damped (5/s, 12/s while a must subject is off the box), eased back to 0 with no requests, reset by `snap()`. `focus` = the damped follow focus + the pan. **Hold** (ADR-154, the fox's Howl): `hold(m, x, z, w)` asks for `m` desktop metres of pull-back this frame (scaled for the phone like a cinematic; eased in at 4/s, out at 2.5/s; `held` the eased value) and, with a finite (x, z) and w > 0, leans the follow focus w toward that point (`holdLean`; the strongest ask of the frame wins); inert unless called, so it can hold a framing longer than `flow.cinematic` (3 s) and past the phone's `maxExtraZoom`. |
| `touch` | touch controls (`ui/touch.js`, below): `active`, `phone`, `portrait`, `autoAim`, `setActive(bool)`, `update(realDt)` |
| `gamepad` | gamepad controls (`ui/gamepad.js`, below): `active`, `connected`, `layout` (`'xbox'`/`'ps'`), `autoAim`, `focus`, `label(token)`, `rumble([ms, strong, weak])`, `update(realDt)` |
| `shake(a)` | camera trauma (0.15 light hit … 0.7 huge slam) |
| `punch(m)` | a zoom punch: the camera jumps `m` metres closer and springs back in ~0.25 s (`cameraRig.punch`: stacks to 6 m, eased at 11/s, scaled for the phone's closer camera). A blade's clash (1.5 – 3.6), a guard (0.7 – 2.4), every landed cut (lights 0.35 – 0.6, the slam 1.6, the cleave 1.2 – 2.0, the execution 2.0; a crit + 0.6). Optional: callers use `game.punch?.()` |
| `kick(x, y, z, m)` | a directional kick: the picture is thrown `m` metres (≤ 0.5; at the desktop distance, scaled for the phone like the punch) along world direction (x, y, z) as seen on screen and springs back with one ~12 % overshoot in ~0.25 s, in real time (it plays through a freeze). A landed cut throws it along the blade's travel (lights 0.08 ≈ 4 px at 36 m … the full cleave 0.24). Optional: callers use `game.kick?.()` |
| `fxDt` | the running step's FX time (see Frame order): particles and lights run on through a hit-stop. In the world's step it is the FX time of every fighters' step since the last one, as `dt` and `realDt` are |
| `hitstop(sec, scale=0.04)` | brief time-scale dip measured in real seconds (also the perfect-dodge slow-mo, the plunge's included: `hitstop(0.6, 0.3)`) |
| `debugTimeScale` | Lab multiplier on game time (1 = normal). Only the Lab writes it. |
| `viewOverride` | `null` or `{ pos, target, focus? }` — camera override applied by main.js after the rig (see Frame order). Only the Lab model viewer writes it. |
| `lights` | `add({x,y,z,color:[r,g,b],intensity,radius,life,fade,fadeIn,flicker,low,slotFade})` → light (mutable `x,y,z`, `.set()`, `.kill()`). The pool (`render/lights.js` `LightPool`) fills the shader's `MAX_PL` slots with the best-scoring lights (intensity × radius over distance to the focus). A **low** light (`low: true`, 2026-11-23, ADR-180: the living world's lanterns, the Skybreak Ring's braziers) takes only the slots the others leave free: its rank among the low lights (without the flicker; one holding a slot keeps it against a light only up to 1.25 × better) picks which; it fades INTO a slot it is given and OUT of one it must give up over `slotFade` s (default 0.3; it holds the slot while fading, so for that moment the least of the others waits), never a pop. With no low light alive the pool picks exactly as before. `pool.used` / `pool.usedLow`: slots the last update wrote, all and low (tests, the Lab) |
| `fx.add` / `fx.alpha` | glyph particles, additive-HDR / alpha-blended. `spawn({x,y,z,vx,vy,vz,life,size,sizeEnd,glyph,color,colorEnd,alpha,alphaEnd,gravity,drag,spin,rot,flicker,stretch})`. `glyph`: char, string of chars (random pick) or atlas index. |
| `fx.ripple` / `fx.stamp` | the impact pass (ADR-149): `fx.ripple` = `ImpactRipple` (`render/impactRipple.js`: `hit(x, y, z, o, k)`, `update(dt)`, `clear()`, `write(pipeline)`; `n`, `live`), `fx.stamp` = `{ clear }` (`combat/impactStamp.js`: `stampHit`, `stampUpdate`, `stampClear`). Both run on fx time and are cleared on a level reset (flow, `world.debug.setVisible`) |
| `world` | `resolve(pos, radius, bound, soft = false, who = null)` circle collision (`who` 'hero': on a set with an edge the hero's ground replaces the `bound` circle; `edge` is that edge or null and `heroBound(x, z)` how far out he may stand that way: Destruction → "The edge of the open ground", ADR-125; `soft`: pass through the circles marked `soft`, the trunks and stumps of breakable wood: the wyrm's body, ADR-119); `setQuality(k)` (the destruction's phone budget 0.3 .. 1; `setGrassQuality` sets it from the preset, `QUALITY` in breakTuning.js); `setPusher(slot, x, y, z, r)` grass trample (slot 0 = player, 1–9 = dragon; y > 1.5 = airborne, ignored); `clearPushers(from, to)`; `gust(x, z, strength 0..2, radius)` (also `life.gust`: the living world's air takes the same push); `scorch.burnCircle(x, z, r, burn 0..1, heat 0..1)`, `scorch.reset()`; the scorch map's channels: R burn, G heat, B **trample** (`scorch.trample(x, z, r, k)` max-blended, `scorch.trampleAt(x, z)`; the living world's steps write it with `?bend=0` only, the grass lies flatter and darker by it, it stands up over `STEPS.trample.decay` s; with the wake on (ADR-193) `world.trail` bends the grass instead: `update(dt, P)`, `press(x, z, r)`, `clear()`, `bendAt`, `count`; GLSL `scorch3At(xz)`, `trampleAt(xz)` in COMMON_GLSL), A **torn** (2026-11-23, ADR-180: grass the sword mowed or a blow's mark tore out, 0..1, kept until `scorch.reset()`; `scorch.tear(x, z, r, k)`, `scorch.tearLine(ax, az, bx, bz, w, k, k2)`, `scorch.tornAt(x, z)`, `scorch.tornCells`; `?mow=0` none (`mowOn()` in scorch.js); GLSL `scorch4At(xz)` (all four channels, the same single fetch) and `tornAt(xz)`; see Destruction → "Grass the sword cuts"); `grass` (`createGrass`'s record: `mesh`, `total`, `setCount(c)`, and since ADR-180 `densityAt(x, z)` 0..1 and `heightAt(x, z)` the meadow's typical blade height there, m: the mow reads them); **`life`** (`world/life/life.js` `LivingWorld`, `?life=`; null if it failed to build: see "The living world"); `colliders.blocked(ax,az,bx,bz)`; `setGrassQuality(count)` (instanced grass blades drawn; main.js applies the quality preset); **destruction** (ADR-107, see Destruction): `impact(x, z, r, power, o)`, `ignite(x, z, r, k, grass = true)` (both also reach the living world: `life.impact` / `life.ignite`, ADR-177), `groundBlow(x, z, o)` (a blow met the floor: a mark of its kind, `scars.mark`, and `life.impact`; it damages nothing; ADR-177), `restore()`, `destructibles`, `fire`, `scars` (the tests' world mocks lack them: every caller outside `src/world` guards with `?.`); `bonfire {x,z}`; `nest {x,z}`; `atmosphere` (the bonfire's flames, smoke and embers; the default night's fireflies, low mist and falling leaves, or a set's `ash` / `ambience`: with the living world on, it skips the leaves, fireflies, mist or ash a layer draws itself, `life.takes(what)`, and while the wind piece is on its smoke, embers, mist, leaves and ash drift on `life.wind.at` instead of their fixed drift; their Math.random draws are unchanged); `atmosphere.setBonfireLit(bool)`; `atmosphere.skyGlow(k 0..1)` (the sky over the clearing glows orange: warms the shared ambient and fog colours; call every frame while it should show, it eases in and out and lets go 0.2 s after the last call; Armageddon, ADR-053); Lab only: `debug.setVisible(bool)` hides / restores the environment (ground, grass, forest group = trees, stones, flagstones, nest bones, bonfire; atmosphere paused and in-flight particles in `fx.*` dropped; the exact previous `visible` flags come back; lights, scorch and colliders untouched), `debug.visible` |
| `player`, `dragon`, `hud`, `audio`, `flow`, `lab` | the modules below. `dragon` is **the boss slot** (the wyrm in Cinderwood, the Ash Disciple in Ashfall; see Levels and the boss slot); `boss` is the same object |
| `level`, `levels`, `pickLevel(id)` | the level this page load built (`levels/index.js` definition), every level as `{ id, name }` (the title's stage picker, the Lab's LEVEL row), and a reload into another one (`?level=<id>`, other parameters kept). Tests may leave them out: flow falls back to Cinderwood's lines |
| `heroLook`, `heroLooks`, `pickHeroLook(id)` | the hero's outfit option (kept for later use: the owner, 2026-11-14, keeps today's look as the default; `player/gear/looks.js`): the id main.js read from `?heroLook=` (the Player wears it), every option as `{ id, name }` (the Lab's OUTFIT row), and a live switch (`player.setLook(id)`, the URL updated in place; `pickLevel` keeps the parameter). Tests may leave them out: the Player wears the default look |
| `state` | owned by flow: `'title' | 'explore' | 'bossIntro' | 'boss' | 'dead' | 'victory' | 'paused'` |
| `time`, `realTime`, `dt`, `realDt`, `timeScale`, `fps` | clocks (`dt` / `realDt` / `fxDt`: of the running simulation step) |
| `frameDt`, `simSteps` | the rendered frame's real time and the number of simulation steps it was cut into (Frame order) |
| `settings` | `{ quality: 0..2, showFps: bool, autoQuality: bool, fpsCap: true / false / null }`; `applyQuality()` re-applies. With `autoQuality` (default `CONFIG.autoQuality.on`; `?autoq=0|1`) the render scale, shadow map and grass are `game.autoQ.step` (`render/autoQuality.js`, ADR-200: `AutoQuality` decides from each drawn frame's interval, script ms and GPU ms where `EXT_disjoint_timer_query_webgl2` exists; steps up only in a calm state: title, explore, paused, dead, victory) instead of a preset; F2 cycles AUTO → LOW → MEDIUM → HIGH → AUTO (`flow.cycleQuality`). `fpsCap` null = capped on a touch device (`CONFIG.fpsCap`; `game.pacer`, a `FramePacer`: every n-th refresh). `game.autoBench` = the title's first-guess reading. A preset (`CONFIG.quality[i]`) is `{ name, grass, dpr, shadow }`: grass blades drawn, max device pixel ratio, moon shadow map size in texels (LOW 1024, MEDIUM / HIGH 2048; `CONFIG.render.shadowSize` 2048 is only the size before the first `applyQuality`). Touch devices start on `CONFIG.defaultQualityTouch` (LOW) unless the player picked one. |

Shared combat rules: `src/combat/rules.js` — `TELL`, `RESULT`, `TELL_STYLE`, `DEFENSE`, `POSTURE`,
`tellDefaults(tell)`, `facingDelta(...)`. Never hard-code these windows in actor code. `DEFENSE.plunge`
holds the plunge's range, damage and timeline (contract 2, COMBAT.md "The plunge");
`RESULT.PERFECT` now means "plunge or Ghostep".

Render helpers for creature modules:
- **Creature ASCII art** (v0.4, reworked by the reference match of 2026-11-08: ADR-018 … ADR-022).
  Creature materials render a SOURCE image into the scene target and the ASCII pass
  (`pipeline.js`) turns it into letters. `createSurfaceGlyphMaterial` defaults `flag` to `FLAG.ART`
  (0.5); with the shared `U.uArtSolid` = 1 the material writes its art source (0 = the patterned
  surface render, a look-dev A/B). `artGain` (default 1) scales the generic smooth source. The pass
  tests the hero's grid first, then the wyrm's, then the background props' (`FLAG.ART_PROP` 0.57,
  window 0.555–0.585, ADR-100), then the world grid. Two creature paths, told
  apart by the **alpha contract** (no other material may write alpha in 0.46–0.55, and none but
  prop art in 0.555–0.585):

  | alpha written | by | meaning |
  |---|---|---|
  | `0.5 + 0.01 × code` (0.50 … 0.54) | the wyrm (materials with `wyrm`) | `FLAG.ART` plus a **stroke code** from `wyrmMain`: 0 none, 1 `-`, 2 `/`, 3 `\|`, 4 `\` (the screen direction of a thin part's outline or a scale rim at that pixel). The pass decodes `floor((a − 0.5) × 100 + 0.5)` |
  | `HERO_ART.a0 + (part × 2 + aPart) × HERO_ART.step` (0.4632 … 0.4866) | the hero (materials with `heroArt`) | a **part id** inside the hero window (0.46, 0.49) that `isHero` tests (`FLAG.ART_HERO` 0.48 marks the window): `part` 0..19 from the material, `aPart` 0 / 1 the geometry's sub-id |

  The PLAYER's own rig (`buildHero(U, loadout, { self: true })` → `createHeroMaterials(U, { self })` →
  the material option `heroSelf`) writes the same ids `HERO_ART.self` (0.04) lower: 0.4232 … 0.4466,
  inside a window of its own (0.42, 0.45) that `isSelf` tests (ADR-130). `isHero` is true in both
  windows, `isArt` too. The pass tells his pixels from a human boss's by it: his letter cell
  (`uSelfCell`) and his part tables (`uSelfPart*`) are his alone. Nothing else may write alpha in
  (0.42, 0.45) (the unused v0.2 creature grid's codes, `CREATURE_FLAG` 0.04 + 0.37 = up to 0.41, were narrowed from 0.4 wide to stay below it).

  `HERO_ART = { a0: 0.4632, step: 0.0006, parts: 20, self: 0.04 }` is exported from `materials.js` (`HERO_PARTS`
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
- **The wyrm's letters** (pass; `wyrmGlyphs.js`, tested by the wyrm branch for `FLAG.ART` pixels and
  by `tests/glyphcheck.mjs`; fine pixel-font digits, ADR-093):
  - `WYRM_FONTS` (`f3x5`, `f4x6`, `f5x7`: glyph w x h px, `top` offset, cell cw x ch, bitmaps) and
    `wyrmArtFont(H)` → `{ font, s, cell: [cw, ch] }`: the font and integer scale whose cell height is
    nearest H / 90, ties to the smaller (4x6 cells on a 393 px phone, 5x8 at 720p, 6x9 at 1080p,
    10x16 at 1440p, 15x24 at 2160p). `wyrmArtCell(H)` is its `cell`. `createWyrmArtAtlas(font, s)` →
    `{ texture, sets: [mid start, bright start, stroke start], total, ink }`: one row, column 0 blank, then
    `WYRM_SETS.dim / mid / bright`, then `WYRM_STROKES` (`- / | \`), each glyph with a soft 0.24
    halo; `ink` = the set letters' mean coverage of their cell (0..1). `setSize` rebuilds it when the
    font or scale changes (`tArt`, `uArtCell`, `uWyrmAtlas`).
  - **The letters follow the zoom** (2026-11-16, ADR-120; `?zoomArt=a|b|c`, read once into
    `pipeline.js` `ZOOM_ART`, default `b`, the owner's pick; `a` the fixed letters of before, `c` half
    way): past the player's default zoom the art cell (the wyrm, prop art, the fire field) and the
    screen grid (the trees) step down a **ladder** of fonts so an object keeps about the letters it has
    at the default distance; zooming in never grows them. `wyrmArtLadder(H)` → `[{ font, s, cell }]`:
    `wyrmArtFont(H)` first, then every smaller cell of the font / scale pairs (plus the 3x5 font
    doubled, 8 x 12), largest first, one per cell height. `zoomArtStep(hs, r, p, cur, hyst)` → the
    step for a zoom `r` times the default (r ≤ 1: step 0) at strength `p` (log terms: 1 the letters
    shrink as the picture does, 0.5 half of that), moving off the current step only once the wanted
    cell height is `hyst` (log) nearer the new one. `CONFIG.camera.zoomArt = { strength: { a: 0, b: 1,
    c: 0.5 }, hyst: 0.1, minPitch: 0.35 }`. The pipeline: `zoomArt`, `zoomLadder` (per step `{ key,
    cell, atlas, gridCell, grid }`; built in `setSize`, every step's atlases uploaded at once, option a
    builds step 0 only; a grid step is scaled like the art cell and never under 9 px tall),
    `zoomStep`, `_applyZoomStep(i, resized)` (swaps `tArt`, `uWyrmAtlas`, `artCell`, `tGrid`, `cell`
    and calls the fire field's `setCell`; no allocation), `setZoomArt(mode)` (live: the Lab),
    `zoomDistance(cam)` (the camera's distance to the ground along its view; 0 when it looks down less
    steeply than `minPitch`) and `updateZoomArt()`, run at the end of `render()` so every reader of the
    cell (the pass, shed digits, the let-go, the fire field, `artCell` read by dragon.js and the
    duelists' flare) sees a step from the same frame on. The zoom it follows is the player's own:
    `camera.userData.zoomRatio` (`cameraRig.wheelDistance / defaultDistance`, written by the rig), not
    the measured camera distance (the boss framing adds 5 – 9 m and would have changed the default
    look); a camera without a rig falls back to `zoomDistance() / CONFIG.camera.distance`. A phone
    (`camera.userData.zoomArtOff`, from `cameraRig.mobile`) stays on step 0. `uArtInk` (ASCII pass)
    multiplies the art letters by the step-0 font's `ink` over this font's (clamped 0.75 – 1.25), so an
    object keeps its tone as its letters shrink. Cell heights at wheel 24 / 36 / 54 m, option b: 1080p
    9 / 9 / 6 px, 1440p 16 / 16 / 12, 2160p 24 / 24 / 16; 1080p steps out at a wheel distance of
    40.15 m and back at 36.30 m.
  - The grid is anchored to the boss (ADR-092): `main.js` writes his root's screen position into
    `U.uBossScreen` (uv x, uv y, view depth, 1 while there is a boss) every frame, the pass rounds it
    to whole px (`uWyrmAnchor`) and counts cells from there, so the letters travel with the wyrm.
  - Per cell (4 samples find it; 2 must hit, 1 if the cell draws a stroke; then, with `uWyrmTaps` 1,
    a 4x4 grid of 16 more samples averages its tone): the cell value picks a letter SET, the cell's
    hash the letter inside it, so letters only change when a cell changes tier; ≥ `uWyrmGlyph.w`
    stroke-code votes print that stroke glyph in the brightest coded sample's colour; silhouette
    cells (1–3 hits) print a marching-squares edge stroke (`uWyrmOutline`; a horizontal edge keeps
    its letter); each letter pixel takes `uWyrmTone.w` of its brightness and hue from its own source
    pixel (the scale edges cut through the digits).
  - Uniforms: `uWyrmTone` (x brightest letter 0.95, y gamma 1.3, z value below which a cell prints
    nothing 0.022, w own-pixel share 0.85), `uWyrmGlyph` (x / y set steps dim → mid → bright 0.12 /
    0.42, z per-cell dither 0.08, w stroke votes 1), `uWyrmAtlas` (vec4: the atlas `sets` and
    `total`), `uWyrmOutline` (1), `uWyrmAnchor` (vec2 px), `uWyrmTaps` (1). The pass's `.y` uniforms
    are the wyrm's: `uArtLum.y` 2.2, `uArtBlack.y` 0.004, `uArtMin.y` 0.012, `uArtEdge.y` 0 (the
    depth-gap blackout is off). `uArtMax` (0.8) is shared.
- **The hero's source** (`heroArt: {...}` option, built from `HERO_INK` by `createHeroMaterials`):
  `part` (0..19, required; throws outside), `fill [r, g, b]`, `spec`, `specPow`, `rim`, `glow` (share
  of the animated `uInkGlow`: blade, gem, flask), `folds [freq, depth, wander]` (throws if not
  finite). Defines `SG_HERO_ART` (with `HERO_A0`, `HERO_AS`), `SG_HERO_FOLDS`; uniforms `uArtFill`,
  `uArtSpec`, `uArtRim`, `uArtGlowK`, `uArtPart` (= part × 2), `uArtFold`; shared `U.uCamRight`,
  `U.uCamUp`, `U.uArtHeroLight` (vec4: flat fill, camera key light from the upper left, scene-light
  share, glint gain; (0.2, 0.95, 0.2, 1.4)), `U.uArtHeroRim` (the cool screen-left rim colour) and
  `U.uHeroSolid` (look-dev: 1 = a plain-lit clay render with alpha 0, passed through by the ASCII
  pass; ADR-035). The fill is flat per part (no glyph gaps); glints only where the surface curves. Every hero
  material, the blade included, is depth-tested like any mesh: the depth pull (`heroArt.pull`,
  `SG_HERO_PULL`, `uArtPull`, ADR-022) was removed on 2026-11-09 (ADR-031).
  - `aPart` (float vertex attribute, 0 / 1): `sub(geometry, k)` in `player/heroGeo.js`, carried through
    the static merge; a geometry without it reads 0 (`defaultAttributeValues`). It splits one part
    into pieces the pass outlines up close (coat panels, hair locks, the blade's two halves).
    `foldLines(geometry, fn)` (ADR-036) writes a smooth 0..0.9 field instead: the pass prints its
    0.5 contour as a drawn crease and `sub` (`HERO_INK`, `uArtSub`) darkens the side above 0.5.
  - `folds`: dark fold bands in the fill up close (gone between 8 and 16 m).
- **Per-part pass data** (`U.uHeroPartInk[20]`, `U.uHeroPartFill[20]`, vec4, shared; filled once by
  `createHeroMaterials` from `HERO_INK`): ink = line tint rgb × gain (`line`; > 1 blooms: the cyan
  blade edges, the violet gem); fill = x `fillGain`, y line style (0 one stroke per letter cell,
  1 dotted (`dotted`), 2 unbroken (`solid`), + 4 when `open`: no dark channel or depth-step gap, the
  face), z `farLine` (share of inner-line light kept at the game camera: 0 a dark seam (cloth) … 1
  bright (armour, blade)), w `farFill` (fill gain there). Materials that share a `part` must share
  these fields. Part 17 = the player's blade (`HERO_INK.blade` / `bladeTip`, only gear/wanderer.js's
  sword uses `M.blade` / `M.bladeTip`): `player.js` rewrites its fill .x, ink .w and rim .w every
  frame (`TUNE.bladeFlare`: the strike and contact flare; absolute values, the `HERO_INK` base at
  rest). Nothing else may use part 17 (a boss blade on `M.blade` would flare with the hero's: give it
  a new part).
  *Since ADR-130* the player has his own three tables, `U.uSelfPartInk / uSelfPartFill /
  uSelfPartRim[20]`, which the pass reads for HIS pixels (`gSelf`): `HERO_INK` with `HERO_SELF`
  (model.js) on top, written by a `self` build only (`heroPartValues(h)` gives a part's three
  rows). `HERO_SELF` today: the plate parts (armor, spike, bevel, welt, trim) take the cloth's dim
  dotted lavender rim. The blade's per-frame write goes to HIS part 17: base × `TUNE.bladeLook`
  (`line` 0.32, `fill` 0.6, `far` 0.5, `halo` 0: dark steel at rest) × the flare, where the flare is
  1 + `TUNE.bladeFlare.strike` ([light 4.2, heavy 4.6]) × `player.bladeHot` + `player.bladeFlare`.
  The shared part 17 is no longer written per frame.
- **The hero's letters and lines** (pass, hero branch):
  - Grid (ADR-036): `createPixelArtAtlas(hs)` (`glyphs.js`; hs = max(1, floor(H / 1080))) →
    `{ texture, count, cols }`: one row, the 3x3 micro-font `PIXEL_3X3` (29 marks) sorted sparse →
    dense (`uHeroCount`, `uHeroCols`). Cells `uHeroCell` = `pixelArtCell(hs)` (4hs x 4hs, square):
    the human bosses' grid.
  - **The player's grid follows his size** (ADR-130; `Pipeline._updateHeroLetters`, each frame from
    `U.uPlayerScreen`): one letter cell is `pipeline.heroLetter` metres at his view depth
    (`CONFIG.render.heroLetters = { size: 0.115, near: 20, close: 6, hyst: 0.06 }`; 0 = the fixed
    cell), so cell px = px-per-metre at max(depth, `near`) × size, blended in log size back to
    `uHeroCell` between `near` and `close` m (= `uHeroLod`'s far look .. close-up: a close-up is
    drawn as it always was), snapped to `HERO_CELLS` (4 6 8 10 12 16 20 24 32, exported) with
    `hyst` of slack in log size, never below `uHeroCell`: 4 px at 720p and on
    the phone at its 20 m camera, 6 at 1080p, 8 at 1440p, 12 at 4K, about 9 letters across the
    cloak on each. `createPixelArtAtlas(s)` takes any scale (cell = round(4s) px; between whole
    scales a font pixel is shaded by the share of the screen pixel it covers). Uniforms: `tSelfArt`,
    `uSelfCell` (px; `pipeline.selfCell`), `uSelfPx` (one font pixel in whole screen px: the ink
    lines' width, found per FONT pixel for him, and the halo's tap scale), `uSelfBox` (xy his
    screen point px, z half-size px of the box that holds him (`HERO_BOX_R` 5 m), w 1 when known:
    only inside it does the pass look for his pixels). The hero branch is one GLSL function,
    `heroArtCell(px)`, run for him (`gSelf`, `gCell` = `uSelfCell`, `gLine` = `uSelfPx`), then for
    the bosses (`uHeroCell`, `uHeroPx.x`); `isWho` is the window of the one being drawn. The whole
    pass reads its textures at level 0 by name (`textureLod`; none has mip levels).
  - **A boss's arms and legs** (ADR-162): `HeroAnimator.armSoft` / `legSoft` (`[where the reach starts
    to give, the most it opens]` as fractions of the limb's length; null = as always: `ARM_SOFT`, an elbow of
    ~130° at a full stretch, and a leg that reaches straight). Tian Lei sets both in `_setup` from
    `TUNING.armSoft` (the hero's `HERO_SOFT`) and `TUNING.legSoft`. `HeroAnimator.kickStretch` (ADR-221; null by
    default): `[from, to, add, lift0, lift1]`: a foot off the ground (lift0 .. lift1 m) asked for past `from` of
    the leg's length is carried out along its line by up to `add` of it at `to`, so a kick lands with the leg
    straight; Xin Yi sets it, `legSoft` and `armSoft` every frame from his `?oneMoves=` switch. Wen Yao sets all
    three (Xin Yi's numbers, `thousandFox/limbs.js` `LIMBS`) on his animator in his kit's `dress` and on every paper
    self's in `FoxClones.pose`, while `?foxLimbs=` is on (ADR-249).
  - **A foot lifted mid-step** (ADR-249): `HeroAnimator` `opts.liftFromStep` (bool; off = as before), read with
    `opts.liftEase` in `_feetClip`: a foot the clip lifts while the foot planner is still stepping it (mode 1)
    eases from where it was drawn last frame (`F.ox / oy / oz / oyaw`, model space), not only a planted one. Wen
    Yao's kit sets it (his paper selves share his kit's options).
  - **A leap that comes down short** (ADR-249): a duelist beat's `leap: { from, lock, apex, stop }`: `stop` (m,
    optional; 0 / unset = on the hero, as always) brings the landing spot that much short of the hero along his
    line (`brain.js` `_leap`), so a heel or fists that strike ahead of him land on the hero. Wen Yao's limbs pass
    sets it on his axe-heel and hammer-fist leaps; no other boss uses it.
  - **A sword boss's grip** (ADR-226): `HeroAnimator.gripMax` (rad; 0 / unset = off, the hero and every other boss):
    after the sword arm's solve, a forearm more than gripMax off the blade turns toward it round the elbow
    (`_gripAlign`; the hand and `rig.sword.position` move, the blade's direction never). A duelist kit's optional
    `motion()` → `{ gripMax, armSoft } | null` is read every frame by `duelist.js` `_animate` (Shen Hui and Varr
    Nihil: their `TUNING.motion` while `?ashMotion` / `?lordMotion` is on, else null: the animator as before).
    Their moves marked `motionOnly` are weighed 0 by the actor's `weigh` while the switch is off; a beat marked
    `quick` (a normal tell) may wind up `TUNING.minQuickWindup` instead of `minFirstWindup` (the data rule).
  - **The bosses' letters** (ADR-154, ADR-155, ADR-170): a boss whose kit sets `letters` (today Wen Yao's `FOX_KIT`, behind
    `?foxLetters=b`, Tian Lei's `ASC_KIT`, a getter behind `?ascLetters=a`, the owner's pick; `0` the fixed cell; Halcyon's
    `HALCYON_KIT`, a getter behind `?halLetters=a`, the owner's pick, ADR-166; and Xin Yi's `WOKEN_KIT`, the same getter
    behind `?oneLetters=a`; a kit's optional `letterBias` (Xin Yi's `?onePrint=b`) steps his cell that many `HERO_CELLS`
    bolder on a frame under `BOSS_BIAS_H` (540) px tall: main.js `pipeline.bossLetterBias`, `_updateBossLetters` keeps
    the rule's own cell in `_bossBase`; undefined = 0) has the bosses' cell `uHeroCell`, its atlas `tHeroArt` and its line width `uHeroPx.x`
    set each frame from HIS depth by the hero's rule: main.js sets `pipeline.bossLetters`
    (`!!game.dragon?.kit?.letters && lookOf('foxLetters', 'b') === 'b'`), `Pipeline._updateBossLetters(U.uBossScreen)`
    takes the depth 1 m above his feet and picks the cell with `_letterCell(z, cur)` (the cell choice
    `_updateHeroLetters` uses, pulled out of it: `CONFIG.render.heroLetters`, `HERO_CELLS`, the slack, the
    near / close fade back to the fixed cell), reusing the hero's atlas cache. Off, those uniforms are
    exactly what `setSize` gives (it records `_heroPx`), so a boss without the flag is drawn as before; one
    grid serves every boss pixel, so his paper selves share his cell. (`foxLetters` is read for every boss that sets `letters`: it
    stays 'b' on Tian Lei's level, which never sets it.)
    **The bosses printed the hero's way** (ADR-194): main.js writes `U.uBossPrint` (x on, y own colours 1 / the
    hero's greys 0, z the boss's feet in world y, w the hem's height above them) and the pass's `uBossLike` (x his
    ink lines per font pixel, y the player's part tables for plates 12 - 16) every frame from
    `lookOf('bossPrint', '0', 'b')`. Every ink-line material reads `uBossPrint` (`HERO_ART_SHARED`) except the
    player's (`heroSelf` compiles `SG_HERO_SELF`): the fill is lifted in the shader, so whoever writes `uArtFill`
    needs no change.
    **The bosses drawn in the hero's style** (ADR-220): main.js also writes `U.uBossHero.x` (his shading: the boss's
    cloth light falls off away from the key light and down his body; `HERO_ART_SHARED`, read inside the print's
    `#ifndef SG_HERO_SELF`, scaling `fillC` only) and `uBossLike.z` (his ink lines at the hero's line width:
    `gLine = max(uHeroPx.x, uSelfPx)` in `cellMain`) from `heroPrint(level.id)` (`duelist/heroPrint.js`: `HERO_PRINT`
    level -> switch, `HERO_STYLE` a / b / c, frozen records, no allocation), both 0 with `?bossPrint=0`.
    Ink lines are drawn per pixel by the pass, not from glyphs. `U.uArtHeroCel` (vec3: step from
    shadow to lit between x and y, z = share of the step) cel-shades the art source;
    `U.uHeroPartRim[20]` (vec4: tint × gain) is each part's silhouette ink; fill style + 8 = a
    dotted silhouette.
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
    z far jitter 1, w HDR cap 1.3 for the blade and gem; 1.8 until ADR-034). Far away piece edges drop out (dithered per
    cell), inner lines keep `farLine`, the fill takes `farFill`.
  - `uHeroDebug` (look-dev): 1 the raw source, 2 lines only, 3 lines coloured by class.
  - `U.uHeroSolid` (look-dev, shared, hero materials only; ADR-035): 1 = the hero's materials write
    a plain-lit clay render of the geometry (tinted per part, the two sub-pieces of a part shaded
    apart) with alpha 0, so this pass passes it through untouched; 0 in play. The Lab model viewer's
    `look` sets it (and `uHeroDebug`) and restores both on exit.
  - Halo: `uHeroHalo` (xy his screen uv, z radius px, w strength), set per frame in
    `_updateAsciiCamera` from `U.uPlayerScreen` (radius `HERO_HALO_R` 2.1 m; strength fades in from
    0.4 × to 1 × `uHeroHaloShape.w` = 20 m view depth, so none in close-ups), and `uHeroHaloShape`
    (x / y tap radii 2 / 4 px × hs, z darkening 0.72). Two rings of 8 taps darken **world-grid**
    pixels round him (grass, stones, trees, bonfire); the wyrm's letters are not darkened, except
    round the parts of him it covers (`seenHalo`, next item).
- **The hero seen through what covers him** (ADR-106; `pipeline.js`). When something stands
  between the camera and the hero (the wyrm's body or a wing, a tree, a pillar, a landmark), the
  covered parts of him are printed through it: his own ink-line art in the blade's cyan, with a
  thin dark gap round it. In the open nothing changes (the frame is pixel-identical).
  - **API:** `pipeline.setSeenThrough(object3d | null)` names the object (main.js: the player's
    `object3d`; a loadout rebuild keeps that root). `CONFIG.render.seenThrough` = `{ on, reach,
    margin, bareMargin, probe, hold }`: `on` is read every frame (`false` when the page URL has
    `?noseen`, read once in `core/config.js`: an A/B switch like `?nobatch`); `reach` 2.8 m is the
    half-size of the box round his screen point (`U.uPlayerScreen`) that is drawn; `margin` 0.6 m
    / `bareMargin` 1.5 m are how far in front of him a tagged / an untagged (alpha < 0.03) pixel
    must be to count as cover; `probe` `[half-width, from, to]` m is the slab through his body the
    gate tests; `hold` 20 frames the pass keeps running after the gate last found cover.
  - **What counts as cover** needs nothing from the covering object's material: anything drawn
    in the scene pass that writes depth, at least the margin in front of his surface. Never
    cover: a pixel in the hero's alpha window (a human boss is built by `buildHero` and writes
    it; the duels are unchanged), grass and ground within `bareMargin`, and anything in the FX
    scene (glyph particles are composited after the ASCII pass and do not write the scene depth).
    A new big object (a thrown tree, a lifted pillar, a wall) gets it for free; to keep a small
    thing from ever triggering it, leave it untagged or keep it within the margin of him.
  - **The pass** (`_renderSeen`, render step 2b, right after the world pass; no allocation; it
    returns whether it ran): (1) the **gate** `_seenProbe`: one quad (`seenProbeMat`, no colour or
    depth write, `GreaterDepth`) over the screen rect of the probe slab, at his centre line's
    depth less `margin − 0.1`, inside an `ANY_SAMPLES_PASSED` occlusion query on the scene
    target. Its answer is read on a later frame; a yes (or no answer for more than 3 frames: a
    hidden tab, frames stepped in one task with `__tick`) keeps the pass on for `hold` frames.
    Without usable queries (they throw, or the renderer has no GL context as in the headless
    tests) `seenGate.off` is set and the pass runs every frame. (2) the object alone, with its
    own materials, into `seenRT` (the size of the scene target, half-float + depth texture,
    scissored to the box: outside it the target is stale and never read). (3) `seenMaskMat`: a
    quad into `seenRT` whose depth is the scene's pushed back by the margin, `GreaterEqualDepth`,
    writing alpha 0: it erases every pixel of him the scene shows. (4) `seenPatchMat`: what is
    left goes into `sceneRT` over its cover (colour, part id, his own depth; `AlwaysDepth`), so
    the ASCII pass draws him there like anywhere else. The scene target's depth at those pixels
    is then the hero's (the FX particles' soft depth test sees him, not his cover).
  - **The ASCII pass:** `tSeen` (= `seenRT`), `uSeen` (xy his screen uv, z the box's half-size in
    px less 2, w 1 while the pass ran this frame, else 0 and `tSeen` is not read), `uSeenInk`
    (0.3, 0.86, 1.0: the blade's cyan), `uSeenTone` (x silhouette line 1.15, y inner-line gain
    1.6, z fill gain 1.2, both capped at 1.3; w the dark gap 0.85). At the end of the hero's
    branch a pixel (or its cell centre) that `tSeen` marks takes `uSeenInk` × that brightness;
    the wyrm's letters are multiplied by `1 − seenHalo(px)` (the halo's two rings looking for
    `tSeen` pixels); over props and the world grid the existing halo finds the patched pixels.
    `IS_HERO_GLSL` is the one definition of the hero's alpha window, shared by the ASCII pass and
    both quads.
  - **Cost** (Edge, RTX 4090, 1280x720, one task per frame): in the open one more draw call (the
    probe: 57 → 58) and no measurable time; while covered 21 more (78: the hero's 18 material
    batches, the probe, two quads) and 0.3–0.5 ms a frame.
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
- `createPropArtMaterial(U, opts)` (`render/materials.js`) — **prop art: background objects in the
  dragon's look** (ADR-100; the rule for every new object: STYLE.md "The house style"). Writes the
  smooth lit source of a static object with alpha `FLAG.ART_PROP`; the art pass prints it. Geometry
  baked in world space with the carved attribute set (`aCol`, `aAO`, `aEdge`; `aMoss` / `aInk` may be
  present, ignored), so a set's `stones` geometries need no change. Options: `gain` (1), `key`
  (camera-fixed key light, 0.5), `edge` (1), `fadeNearPlayer`, `side`. A prop in a set's screen-grid
  `props` mesh (`createAsciiObjectMaterial`) joins the same look with `flag: FLAG.ART_PROP` in
  `paint()`.
  - **The pass's prop branch** (`pipeline.js`): the wyrm's atlas and cell (`tArt`, `uArtCell`), cells
    counted from `uPropAnchor`; 4 samples find a cell (2 must hit, 1 if it draws a stroke) and are
    its tone; `artLetters()` (shared with `wyrmCell`) prints it; `edgeDir()` gives the stroke along
    a silhouette (1–3 hits) or along a depth step inside the object.
  - Uniforms: `uPropTone` (x brightest letter 0.9, y gamma 1.3, z cutoff 0 = every cell prints, w
    own-pixel share 0.7), `uPropGlyph` (x / y set steps 0.16 / 0.48, z dither 0.08), `uPropLum` (x
    black point 0, y curve 9, z dimmest letter 0.085), `uPropOutline` (x silhouette stroke gain 1.9,
    y inner depth step 0.012, z its gain 1.35), `uPropAnchor` (vec2 px, set per frame in
    `_updateAsciiCamera` from `U.uFocus`: the screen position of the focus minus its world offset
    times the px-per-metre there, wrapped to one cell).
- **Landmarks** (`world/landmarks.js`; second pass ADR-113): builders that return painted geometries in world space:
  `buildElderWyrm`, `buildCinderTree` (Cinderwood), `buildSectGate`, `buildCauldron`, `buildColossus`
  (Ashfall; opts `{ col, head, blade, tall, lo, hi }`), `buildWarden`, `buildGreatSword` (opts `{ lean,
  tilt, col, steel, edge }`; built for the Obsidian Throne's first hall; not placed since ADR-113),
  all `(rng, x, z, yaw, s, opts?)`.
  `buildElderWyrm` and `buildCinderTree` tag every part with the piece it breaks with
  (`userData.piece`, 2026-11-16, ADR-120; no draw on the random stream, the look is unchanged): the
  skeleton `spine0` … (`ELDER_PIECES.spineRun` 5 vertebrae a run), `rib<i>L` / `rib<i>R`, `hip`,
  `mast`, `fingers`, `wing`, `skull`, `jaw`, `hornL` / `hornR`; the tree `trunk` (roots, hollow,
  stub) and `bough0` … `bough4` (each with its forks, twigs and leaves). `buildCinderStump(rng, x, z,
  yaw, s)`: the charred foot left when its trunk breaks. `forest.js` turns each tag into a breakable
  (see Destruction).
  `carved(parts)` converts painted parts to the carved attribute set for a set's `stones` mesh;
  For the Obsidian Throne's crater (ADR-112): `buildFallenStar(rng, x, z)` (the split star behind the
  seat and its crown of splinters), `buildSpike(rng, x, y, z, { h, w, d, tip, lean, yaw, roll, col,
  lump })` (a tapering slab: the rim's plates, the crown), `starCleft(rng, x, z)` (inlay glyphs for
  the set's glow batch), `facetCol(col, k)` (a `carve()` colour: one tone a facet), `STAR_GLASS`,
  `STAR_COLLIDERS`. These are built with `carve()` attributes already and need no `carved()`.
  `world/starfallProps.js` (ADR-133): what lies round the crater. `buildOutskirt(kind, rng, x, z, oy,
  s)` -> `{ kind, geos, r, cr, mat, h, lift? }` (carved parts in world space; `oy` the yaw pointing out
  of the crater) for 13 kinds (`lantern`, `stele`, `pillar`, `roof`, `jars`, `boulder`, `ejecta`,
  `heave`, `splinters`, `swords`, `banner`, `cairn`, `cart`); `OUTSKIRTS` (option -> kind weights,
  `?outskirts=`), `kindBag(rng, weights, n)` (a shuffled bag of kinds in their shares).
  `landmarkPoint(x, z, yaw, s, lx, lz)` maps a builder's local point to the world;
  `ELDER_COLLIDERS`, `GATE_COLLIDERS`, `COLOSSUS_COLLIDERS`, `CAULDRON_COLLIDERS` are `[lx, lz, r]`
  lists the set adds; `COLOSSUS_FALLEN_HEAD` and `GATE_FOOTPRINT` (the gate's own space: it stands
  turned) describe what a set keeps clear. Where they stand: `FOREST_LANDMARKS` (`forest.js`: the
  skeleton along the EAST rim, the tree on the west), `COURTYARD.greatGate / cauldron / guardians`
  (`courtyard.js`: the gate beyond the east pillars, the swordsmen in the pillar ring, the cauldron
  on the paving), `THRONE.star` (`throneHall.js`). They stand where the duel's camera looks: the east / west sides, turned to face it. Trees,
  boulders and breakables in a landmark's footprint are built, then dropped (or never placed), so
  the rest of a level's random layout does not move. Each set uses its own seeded rng for them.
- **The fire field** (`render/fireField.js` exports `class FireField`; `game.fx.fire`; ADR-113):
  fire, void fire, sparks and smoke as one body of heat printed in the wyrm's small letters.
  - `spawn({ x, y, z, vx, vy, vz, life, size, sizeEnd, heat, heatEnd, kind, drag, gravity })`: one
    soft blob. `size` / `sizeEnd` metres across; `heat` / `heatEnd` what it adds at its centre
    (overlaps ADD UP: ~0.4 a cool rim, ~1 the body, 2+ the white heart; default `heatEnd` 0.35 x
    `heat`; the last sixth of its life it fades out); `kind` `'fire'` (default) | `'void'` |
    `'steel'` | `'smoke'` or a `FIRE_KIND` number; `gravity` > 0 rises. NaN positions are dropped.
    A number kind plus `FIRE_SEEN` (4) is drawn SEEN: past the soft depth test, over the scene (a
    timing cue only: DuelFx's white / blue glint, ADR-274).
    `clear()`, `update(dt)` (main.js, with `fxDt`), `count`, `max` (6000), `active`.
  - Pipeline side: `init(type, depthTexture)`, `setSize(W, H, cell, art, minCell = cell)`,
    `setCell(cell, art)`, `render(renderer, camera,
    fs)` (blobs, soft depth-tested against the scene, into `heatRT`: r fire, g smoke, b void, a
    steel, all x 0.4; then the flame pass into `flameRT`: r heat x 0.4, g smoke, b the letter's
    roll, a (kind + (stroke + 1) / 8) / 4), `mesh` (the print quad, `renderOrder` -10 in the FX
    scene), `alloc` (the buffers' size: the frame in cells of `minCell`, the zoom ladder's finest
    step) and `cells` (the part of them drawn this frame, in cells of `cell`). Since 2026-11-16
    (ADR-120) `setSize` allocates the targets once for `minCell` and `setCell` (a zoom ladder step)
    only moves their viewport to `ceil(W / cell)` x `ceil(H / cell)` texels: no re-allocation; the
    flame pass (`uAlloc`, `uCells`) clamps its look-ups to `cells`. Spawn and tint are unchanged.
    `Pipeline.registerFire(field)` wires it. The ASCII pass has `tFlame`, `uFlame` (alloc x, alloc y,
    1 while something burns) and `uFlameCells` (`cells`): the heat haze reads them, clamped to the
    cells drawn.
  - Looks are data: `render/firePalettes.js` exports `FIRE_PALETTES` (`fire`, `void`, `steel`: five
    colour stops, `hdr`, `fill`, `back`, `lick`, `erode`, `boil`, `warp`, and optionally `haze`: the
    colour the world's letters take beside that heat, read for the void slot only), `FIRE_SMOKE`,
    `FIRE_KIND`. Since 2026-11-21 (ADR-129) also `FIRE_PALETTES.gold`: NOT a kind of its own (the field
    keeps its four kinds); a level that needs a colour the field has no kind for borrows a slot.
    `setPalette(kind, palette)` (kind `'fire'` | `'void'` | `'steel'`; a palette block with five stops)
    rewrites that slot's stops, fill / back and turbulence uniforms, and for the void slot its `haze`
    into `fireField.hazeVoid` (a `Vector3`); false for a kind without a slot or a palette that is not
    one. The Skybreak Ring's `AscFx` constructor calls `setPalette('void', FIRE_PALETTES.gold)`: on that
    level `K_VOID` / `'void'` prints GOLD for every spawner (the Lord's inherited draws too). A level
    is its own page load: nothing swaps it back.
  - Who spawns: `DragonFx` (`_blob`, `_wave`, `_fireBlast`), `BulletFx`, `DuelFx` / `LordFx` (`_blob`,
    `_dot` and `_frame`: heat re-drawn every frame shows exactly one copy; `_line`; `_ink`: a line
    written on the letter grid, one steel blob per cell it crosses), `Atmosphere` (the bonfire),
    `Scorch`, the throne hall's braziers, `GroundFire`, `Destructibles` (a burning tree), `Ablaze`
    (the wyrm's phase-3 fire) and `wallReach.js` `carryFire` (its streak). All read
    `game.fx?.fire` guarded. The test harnesses carry a `FireField` with the glyph pools' NaN guard.
  - `tint(id, px, py, rx, ry, rgb, k = 1, dark = 0, ttl = 0.05)` (ADR-118): for `ttl` s, steel
    printed inside that ellipse of the frame (frame pixels, origin bottom-left) is dyed `rgb` (its
    white-hot heart stays white); `dark` 0..1 also blacks out the cell behind each letter. Two zones
    at most; the same `id` set again moves its zone. Set every frame while it is wanted.
  - **Timing cues:** `DuelFx.tellFlash(tell, x, y, z, k = 1, flare = false)` draws them for every boss
    (`k` = scale, 1 a human): the flare for a moment (red, black, a blue blow with `flare`; data
    `TELL_FLARE`, three looks, `flareLook()` / `setFlareLook(k)`, `?flare=`), else the white glint
    (`TELL_GLINT`). `hazardFlash(tell, x, y, z, k)` is the cue of a thing that lands away from its
    thrower: never the flare (red: the ragged blaze, `TELL_BLAZE`). `charge(x, y, z, u, dt, k)`: a
    black blow's windup, called every frame of it (`TELL_CHARGE`). `DragonFx.tellFlash` / `charge`
    forward to a `DuelFx` it owns (`this.tells`, k 1.5) and age its glints and flares in `update`.
- **Text effects** (ADR-113):
  - *Heat haze*: ASCII pass uniforms `uHaze`, `uHazeRoll`, `uTime`; `hazeCell()` runs for wyrm and
    prop cells only while `uFlame.z > 0.5` (six nearest reads of the flame texture, then). The colour
    letters take beside void heat is the uniform `uHazeVoid` (violet by default; ADR-129):
    `Pipeline.registerFire(field)` shares the field's `hazeVoid` vector into it, so a level that swaps
    the void slot's palette (`setPalette`) swaps the haze's colour with it.
  - *Letting go* (`render/letGo.js`: `LET_GO`, `LET_GO_GLSL` with `letGoAt(cell)`, `letGoRow`,
    `letGoUniforms(U)`): the dying wyrm's cells let go top row down, one rule in the wyrm's
    materials (the dissolve discard) and in the pass (`letGoFall()`: the letter falling, `uLetGoInk`).
    Shared uniforms, created lazily: `U.uWyrmGrid` (xy the art cell px, zw the wyrm's grid anchor px;
    `Pipeline._updateWyrmGrid()` writes it at the TOP of `render()`, before the scene pass) and
    `U.uWyrmLetGo` (x dissolve 0..1, y top row, z rows, w half width in cells; the dragon writes it).
  - *Shed digits* (`render/shedDigits.js` exports `class ShedDigits`; `game.fx.shed`): its own small
    instanced pool of single art cells, pixel-snapped. `burst(x, y, z, dx, dz, n, look)`,
    `stream(dt, x, y, z, r, rate, look)`, `update(dt)`, `clear()`. It consumes `player:hitDragon`
    (not guarded) for a boss with a `shed` look `{ ink, rim, ember, embers, rims, stream }` (the
    wyrm: `SHED` in `dragon/model.js`; the human bosses have none).
  - *The breath's charge rises*: wyrm materials have `uGlowRise` (the throat charge's share, formerly
    inside `uGlow`), `U.uWyrmHeat` (xyz the front, w the rule's weight) and `U.uWyrmHeatFrom` (xyz the
    origin, w the front's strength); data `HEAT_RISE` (`dragon.js`), `WYRM_HEAT` (`materials.js`).
    Anything that reads a wyrm material's `uGlow` expecting the charge must add `uGlowRise`.
  - *The impact stamp* (`combat/impactStamp.js`, ADR-149): a landed cut written into the fire field
    in `steel` (`STAMP_LOOK`, the last stamp's counts in `STAMP_LAST`, `STAMP_GLYPHS` empty: no
    particles). `stampHit(game, x, y, z, o, k)` (from `PlayerFx.contact`), `stampUpdate(game, dt)`
    (main.js, fx time, after the shed digits), `stampClear(game)`; `setStampMode('over' | 'instead')`
    / `stampMode()` (`?stamp=instead`), `setStampInk(bool)` (`?stampInk=0`); `takeStampReplace()`
    (cutFx asks once per cut whether to drop its slash line). 4 stamps pooled, one copy of the blobs
    alive per frame; its ink is the fire-field tint zone id 800001 (`FireField.tint`, `dark` 1).
  - *Calm at the contact* (`combat/impactCalm.js` exports `CALM_LOOK`, `CALM_DEFAULT` 1, `setCalm`,
    `calmLevel`, `calmLook`, `calmA`, `calmS`, `calmBossFlash`; ADR-149): `PlayerFx.contact`
    snapshots the level (`_calmAt`) and opens the arc's calm zone; `player._updateMaterials` reads
    `fx.calmBlade(w)` / `fx.calmFlare(v)` for the steel's gain; cutFx, `fx.edgeFlash`,
    `fx.cleaveImpact` and `fx.trail` read `calmA` / `calmS`; `dragon.takeHit` and `duelist.takeHit`
    take their hurt flash through `calmBossFlash`. Level 0 draws exactly what it did before.
  - *The impact ripple* (`render/impactRipple.js` exports `RIPPLE`, `class ImpactRipple`; `game.fx.ripple`;
    ADR-149): `RIPPLE.slots` 4 live hits kept in world space (an offset from `o.target.position`),
    presets `wave` (drawn) and `subtle`. `Pipeline.setRipple(r)` (the constructor calls it; null
    zeroes `uRipN`); `write(pipeline)` runs in `update` and again in `_updateAsciiCamera`, right
    before the ASCII pass. Uniforms: `uRipN` (live hits; 0 = the pass reads nothing), per hit
    `uRipA[i]` (contact px x, y, the front's radius in cells, its weight), `uRipB[i]` (the shove px
    along the cut x, y, the front's half-width in cells, the contact's view depth m), `uRipC[i]` (the
    outward push px, the quiet hole and its ramp in cells); `uRip` (roll, bright, depth window m,
    lift), `uRip2` (trough, its lag, stroke share). The pass's `rippleCell(cpx, dz, cw)` sets
    `gRip` / `gRipS` per boss cell: the wyrm's art grid and the hero-art path's boss half only (never
    `gSelf`, props, floor, grass); a write that throws zeroes `uRipN` and drops the ripple.
- `createCarvedGlyphMaterial(U, opts)` (`render/materials.js`) — **carved glyphs, for FLOORS only**
  since ADR-100 (flagstones, paving, the crater's plates; upright objects use prop art above). Glyph cells sit on a world-fixed lattice in
  a plane facing the default camera (`viewPitch`), so they are upright, equal-sized and never
  re-pick as the camera moves; one glyph per cell, picked by light on flat facets, contour strokes on
  mid-lit flanks, world-fixed cracks and moss. Renders directly (alpha `FLAG.NONE`, the grid pass
  ignores it). Geometry must be baked in world space with `aCol` (vec3), `aAO`, `aMoss`, `aInk`,
  `aEdge` (floats); see `carve()` in `world/forest.js`. Options and defaults: `CARVED_DEFAULTS`
  and the doc comment (`sideGlyphs`, `topGlyphs`, `mossGlyphs`, `crackGlyphs`, `strokeGlyphs`,
  `strokeLevels`, `cell`, `gain`, `lumScale`, `jitter`, `inkFloor`, `base`, `mossInk`,
  `crackAmount`, `edge`, `glyphZoom`, `fadeNearPlayer`, `side`).
- `markCaster(object)` (`render/pipeline.js`) — casts moon shadows: enables `LAYER_CASTER` (1) on
  the object and its descendants. Works before or after rigid batching (below); `LAYER_CASTER` and
  `LAYER_CASTER_RIGID` (2, reserved for the batch meshes: never set it yourself) are exported from
  `pipeline.js` (defined in `shaderLib.js`).
- **The performance readout** (`dev/perfReadout.js`, ADR-209; `?perf`): `game.perf` (null without it). main.js
  times every `safe(name, …)` call, the effects' block (`fx`), the shared uniforms (`uniforms`) and the
  render (`render`) into `perf.add(part, ms)`, between `perf.beginFrame()` and `perf.endFrame(interval s,
  script ms)` for each drawn frame; without `?perf` nothing is timed. It keeps the last 1800 frames
  (typed rings), shows one line at the foot of the screen (fps, frame ms, script ms, missed frames, AUTO's
  scale) with REPORT (the phone's share sheet, else the clipboard, else a text box to copy) and RESET.
  `perf.report()` / `window.__perfReport()`: the device (user agent, GPU string, DPR, screen, window,
  canvas), the level, AUTO's step and the cap, the frame intervals' percentiles, the missed frames (over
  20 / 34 / 100 ms), the script's, each part's mean / p95 / max, and the 16 longest frames with their parts,
  the hero's state and the boss's move. A new per-frame module run through `safe` is timed with no change;
  one outside it should add its own `perf?.add`. BENCH (`perf.bench()`, ADR-215): the frame on screen drawn
  again and again in one task, each reading ended by a 1-pixel `readPixels` (it waits for the GPU), whole and
  with each pipeline step left out (shadows, world, hero see-through, fire field, letters, effects, glow: the
  step's draws skipped by wrapping `renderer.render`), the still shadow map redrawn every frame, then at ~0.7x
  the device pixels and back through `applyQuality`; the results go in the report. A new pipeline pass gets a
  line in its `is` table. AUTO BENCH (ADR-261,
  `AUTO_BENCH`; `?perf=manual` turns it off): in a fight (`game.state === 'boss'`) BENCH runs by itself
  `firstAt` (8) s in, then on a slow burst (6 of the last 30 frames over 20 ms), 10 s apart, 4 in all, a
  lighter one (k 3, 2 readings); each bench records why it ran, AUTO's step and whether the lite world is
  on, and the frame after it (its freeze) is not recorded.
  BENCH also reads the LIVING WORLD in one extra reading (ADR-245): every batch `ship` has marked
  `userData.lifeBatch`, the wind (`uWind` 0), the step flash and the wake left out together; the report
  prints it as its own line (it overlaps the steps above) and everything is put back. The lamps' flames
  stay (they are heat in a fire field that already burns).
- **The lite world** (ADR-216, the owner's pick C of three rendered options): `game.liteWorld` (main.js, each
  frame) is true on a touch device with AUTO on once `game.autoQ.wantsLess` (render/autoQuality.js: a slow
  window came while AUTO had no step down left; kept for the page load, so the look does not flicker), or
  always with `?lite=1` (never with `?lite=0`). world/groundFx.js then holds the dragon print's four upgrades
  off (cloud, contact, ripple, ridge: `uDpFxOn` all 0) and sets `DP_FX_U.uDpLite` = 1, which makes the floors'
  relief (render/dragonFloor.js `floorRelief`) one value-noise octave a layer instead of a three-octave fbm.
  Desktop never turns it on by itself. A new per-pixel extra of the world should read `game.liteWorld` /
  `uDpLite` the same way.
- **The warm draw** (`render/precompile.js` `warmDraw`, ADR-209): after the shaders' precompile, every mesh
  of the scene that is hidden with `userData.foldAway` or `userData.autoHide` (a set's remains:
  destructibles.js shows them when a piece first cracks or breaks) gets its bounding sphere and is drawn
  once into a 1 x 1 target, then hidden again: its buffers are on the GPU before the fight. `?warm=0` off.
  A new hidden-until-broken mesh needs one of those two flags to be warmed.
- **The still shadow map** (`render/shadowCache.js`, ADR-201; `CONFIG.render.shadowCache`, `?shadowCache=0`
  off). Every caster the shadow passes would draw (visible, on `LAYER_CASTER` or `LAYER_CASTER_RIGID`, not
  a rigid source) is STILL once its state has not changed for `settle` frames (20; `settleBig` 3 for one
  of more than `big` triangles) and is then drawn into `stillRT` only when that map must change: a still
  caster changes or leaves, one settles, the view's key changes (the camera's place, the moon's way, the
  map's size), or a reset (a restored context, a resize). Each frame the moving casters are drawn into
  `shadowRT`, which keeps last frame's picture: first the texels the casters that changed since covered
  are copied back from `stillRT` (a depth blit): a batched actor's moved bones at their OLD matrices
  (`rigidBatch.js` sync: the set's `vacated` spheres), a plain mesh's last bounding sphere, a big mesh's
  edited ranges at their old positions (its position copy, made once at its first sight and kept up to
  date with the attribute's `updateRanges` on every change, still or moving, ADR-209), the whole
  map after a redraw or when a moving caster leaves. The map is the one a whole draw gives, texel for
  texel. A caster's STATE: `matrixWorld`, `material.visible`, the geometry's id, position and index
  versions, draw range and groups, an instanced mesh's count and matrices, a rigid shadow mesh's
  `userData.rigidStamp` (sync bumps it when a bone moves or is shown / hidden, or the actor starts or stops
  casting). So: something that changes a caster's shape without any of these (a vertex shader's sway: the
  depth pass draws with an override material and never sees one) is not supported, as before. With the
  cache on, `updateShadowCamera` moves the shadow camera only in its own plane, in steps of `snap` (32)
  of its own texels: every texel keeps its place and depth in the world, so a step changes nothing in the
  picture (the world-axis snap before moved every texel at each 8 cm of a walk: the shadows' edges
  crawled). `pipeline.shadowCache.stats`: frames, redraws, why, moving / still counts, texels copied.
- **Rigid batching** (`render/rigidBatch.js`) — an actor made of many small rigid meshes is drawn
  with one draw call per material in the world pass and ONE in the shadow pass, instead of one per
  mesh in each (the hero: 138 meshes → 23 + 1 draws, the wyrm: 181 → 14 + 1, plus its 2 wing
  membranes in each pass).
  - `batchRigid(U, root, opts?)` → `{ meshes, shadow, sources, bones, dispose() }`. Call it once
    the actor is built (and marked a caster), and again after `dispose()` whenever its meshes are
    rebuilt (`player.setLoadout` does). It collects the meshes under `root` that can be batched,
    groups them by material (+ `renderOrder`) and builds one merged geometry per group: every
    source geometry's attributes (missing ones zero-filled, indexed or not) with the vertices still
    in their mesh's local space, plus a per-vertex float `aRigid` = the mesh's **bone slot**. The
    batch meshes (`meshes`: `name 'rigidBatch'`, layer 0 only) and the actor's one shadow mesh
    (`shadow`: `name 'rigidShadow'`, positions + `aRigid` of every caster, on `LAYER_CASTER_RIGID`
    only) are tagged `userData.rigidBatch = true`, have `frustumCulled = false`,
    `matrixAutoUpdate = false` and no raycast, and are added under `root`, so hiding the root
    hides them.
  - Every batched mesh is its own bone and **stays in the scene graph** with its transform,
    `visible` flag and layer mask: gameplay, FX, the Lab and the tests keep traversing the source
    meshes and reading their `matrixWorld`. Only its `layers` object is swapped for one no camera
    (or raycaster) can see, so three never draws it; `isRigidSource(mesh)` tells. Anything that
    walks an actor's meshes for geometry (bounds, picking) must skip `userData.rigidBatch` meshes:
    their merged geometry is not in one space (the Lab model viewer's auto-fit does).
  - Bones: `rigidBones(U)` → the registry behind `U.uBoneTex`, a 64 × 64 RGBA32F `DataTexture`
    (NEAREST), 4 texels per matrix (a texel = a column), 1024 slots (`RIGID_TEX`, `RIGID_MAX` in
    `shaderLib.js`); slot 0 is reserved and means "not batched: use `modelMatrix`". `sync()` (called
    by `pipeline.render()` right after the scene's matrix update, no allocation) writes each
    source's `matrixWorld`, or an all-zero matrix when the source or any ancestor below the actor
    root is not `visible` (its triangles collapse); a hidden actor root is skipped. `count`, `room`,
    `sets`, `batches`, `casting` (a visible actor casts this frame: the pipeline then draws the
    rigid shadow pass). `dispose()` on a set removes its meshes, frees geometry and slots (reused
    by the next build) and gives the sources their plain layers back.
  - Shaders: `RIGID_VERT_GLSL` (`shaderLib.js`) declares `attribute float aRigid`,
    `uniform highp sampler2D uBoneTex` and `mat4 rigidMatrix()` (`aRigid < 0.5` → `modelMatrix`,
    else the slot's matrix by `texelFetch`). `createSurfaceGlyphMaterial` uses it for the world
    position and the normal in ONE program for batched and unbatched meshes (materials are never
    cloned: their uniform objects are the shared ones the actors write every frame); a geometry
    without `aRigid` reads 0 (`defaultAttributeValues`), and the material is tagged
    `userData.rigid = true`. A new material family that wants batching must do the same. The
    pipeline's `rigidShadowMat` uses it for the shadow depth.
  - Shadows: the shadow mesh holds the sources that were casters at the build (all of them when
    none was yet), and casts while one visible source has `LAYER_CASTER` in its mask (read every
    sync, so `markCaster` and `dragon.setShadowCasting` work at any time): batched parts of an
    actor cast together. The sync owns the layers of the batch and shadow meshes (never set them).
  - Not batched (ordinary meshes, as before): materials without `userData.rigid`, instanced /
    skinned meshes, geometry rewritten at runtime (an attribute that is not `StaticDrawUsage`: the
    wing membranes), morph targets, a partial `drawRange`, a mesh with `onBeforeRender` /
    `onAfterRender`, `userData.noBatch = true`, and meshes added to an actor after its
    `batchRigid` call. A source's geometry and material must not be swapped or edited after the
    build (rebuild the set instead); mirroring (a negative scale above a source) is baked into the
    batch's winding at build time. Each batched source gets `userData.batchRun` `{ mesh, i0, ic, v0, n }`:
    its run of its batch's index and of its vertices (the breakables move and fold single triangles
    there: "Bites", below; nothing else may write there).
  - `CONFIG.render.batch` (default `true`; `false` when the page URL has `?nobatch`, read once in
    `core/config.js`): with it off `batchRigid` returns an empty set and every mesh is drawn as
    before — an A/B switch for frame rate and image checks.
  - `CONFIG.render.seenThrough.on` (`false` with `?noseen`): the same kind of switch for the hero
    printed through his cover (see "The hero seen through what covers him" above).
- `gi(ch)`, `gis(str)` (`render/glyphs.js`).
- `game.pipeline.finalMat.uniforms` — `uHurt` (red edge 0..1), `uFade` (black 0..1), `uDesat` (0..1), `uWarm` (boss grade 0..1), `uExposure`, `uBloom`. **Owned by the HUD/flow module** (game/grade.js `ScreenGrade`: `hurtPulse`, `ghostPulse`, `dip`, `fadeTo`, `desatTo`, and `flashPulse(k)`: a white flash, `uExposure` × (1 + 0.9 k) over its base, gone in ~0.2 s; flow fires it on every `player:parry` of a blade).
- The blackout's uniforms (ADR-271, `?black=`): `uBlack` (0..1), `uBlackK` (vec4: the world's light left,
  its grey, the hero kept, the actor mask's reach in letter cells), `uBlackKeep` (vec2: the light a letter keeps
  from), `uBlackCell` (the art cell), `tFlag` (`sceneRT`'s texture: its alpha is the ASCII flag the mask reads).
  **Owned by `combat/blackout.js` `Blackout`** (`game.blackout`, built and stepped by `ui/tells.js` `TellEdges`
  every HUD frame; `start(dur)` on `combat:charge`, `cue()` on a black `combat:flash`, `beat()` every frame of a
  charge from what draws it, `release(over)`, `clear()`, `step()` → `k`, `update()` writes the uniforms). A charge
  with no beat for 0.15 s of game time is cancelled: **whatever draws a black charge calls
  `game.blackout?.beat()` every frame of it** (`DuelFx.charge` does, so every duelist and the wyrm get it; the Fox's
  Howl calls it in `thousandFox/beam.js`). Its numbers: `TELL_STYLE.black.out` / `.pale` (`rules.js`);
  `flareStyle(tell)` and `blackBody()` give the black flare's colours and the body's darkening for the switch.
- The black impact (ADR-271, `?blackImpact=`): **`combat/blackImpact.js` `BlackImpact`** (`game.blackImpact`, built
  and stepped by `ui/tells.js` with the blackout). A black `combat:flash` arms it with the boss in the slot: a
  duelist's black beat in `brain.act` (it fires when `act.t` passes the beat's `impact`; the point
  `tellPoint(part)`), the wyrm's `brain.action.cur` (when `a.T` passes `b.at + b.impactIn`; the point
  `rig.pt.mouth`), else `impact.lead` s after the cue. An act / action gone before then (a cancel) lands nothing;
  a retry or a new title / dead / victory state disarms it. `fire()` calls `world.groundBlow` (kind `blast`),
  `world.impact` (marked), `world.gust`, `fx.shock` or `fx.groundShock`, `lights.add`, `game.shake` / `punch` /
  `hitstop` (not when the hero was hurt: `player:hurt`), `audio.play('explosion')`, `play('sub')`,
  `thump.dip`. No damage, no new event; `stats.fired` / `stats.last` for tests.
- `game/grade.js` `ScreenGrade.dimPulse(k = 0.4, hold = 0.4)` (ADR-167): the world dims to k (`uExposure` × (1 − 0.6 k)) over ~4 frames, holds `hold` s, comes back over ~0.25 s; the perfect parry's cinema beat uses it in place of the white flash (lines printed hotter than the scene still stand out). `resetInstant` clears it.

## Module contracts

### Player — `src/entities/player/player.js` exports `class Player`
```
constructor(game)                      // builds model, adds object3d to game.scene, spawns at CONFIG.world.playerSpawn
object3d: THREE.Object3D;  position: THREE.Vector3 (=== object3d.position);  yaw: number;  radius = 0.45
                                       // position.y is 0 except in the plunge, where it carries the visual
                                       // lift (x / z stay the ground point under him)
batch                                  // his rigid batches (render/rigidBatch.js batchRigid; empty with ?nobatch)
name = 'Wanderer'
hp, maxHp, flasks, maxFlasks: number   // (v0.2: NO stamina) TUNE: 160 HP, 5 flasks of +70 HP
guard, maxGuard: number                // the guard meter (combat/rules.js GUARD, ADR-095): a blocked blow costs guard, not HP;
                                       // refills by itself; at 0 on a blocked blow the guard is knocked open (state 'stagger'
                                       // for GUARD.openDur with the guard break's pose, `player:guardOpen`); read by the HUD
                                       // and the touch BLOCK tile
state: string   // 'idle'|'run'|'sprint'|'roll'|'attack'|'charge'|'heavy'|'block'|'parry'|'ghostep'|'plunge'|'heal'|'stagger'|'guardBreak'|'knockdown'|'lock'|'mikiri'|'dead'
                //  ('attack' = the light chain + the slam finisher + the heavy branches (combat.js HEAVY, ADR-115),
                //   'heavy' = the released charge's cleave (and the execution's thrust),
                //   'ghostep' = a perfect dodge without the plunge, 'plunge' = the head-stab, contract 2,
                //   'lock' = blades crossed with a duelist, 'mikiri' = stepping on a perilous thrust)
blocking: boolean                      // RMB held and able to block
hitPush: { x, z }                      // the way the last blow drove him, in his own axes (z − = back, x + = his left): the flinch
kdProne: boolean                       // the knockdown fell him on his FRONT (the blow came from behind; ADR-083)
deadDown: boolean; downFrom: number    // killed in the knockdown, `downFrom` s into it: he dies where he lies (clip 'deadDown')
critTimer: number                      // > 0 while the crit window is open (after a perfect dodge / the plunge's landing)
bladeHot: number                       // 0..1: how lit the dark steel is by what he does (ADR-130): 1 through a strike's window,
                                       // the flurry and the plunge's hang .. ride, the charge's chargeK, 0.5 in a crit window;
                                       // up at once, down by TUNE.bladeFlare.cool (30) per s. Scales TUNE.bladeFlare.strike
bladeFlare: number                     // 0..0.75: the steel's flare at a landed cut (TUNE.bladeFlare.hit: 0.5, heavy / crit 0.75;
                                       // not a slam's shards-only hit). Any area may raise it (Math.max), never lower it; it
                                       // decays by 1 / TUNE.bladeFlare.fall per s of GAME time (held through the freeze) and
                                       // drives part 17's fill / lines and the blade halo
lockOn: boolean                        // toggled by Tab (the middle click is the guard since ADR-115); facing tracks dragon.lockPoint
get alive(): boolean
isInvulnerable(): boolean              // roll i-frames, the whole plunge, Ghostep / plunge-landing i-frames, get-up, the blade lock, dead
// impact (ADR-063, ADR-079; TUNE.parryStop / parryPunch / perfectParry / hurtStop): a blade's parry
// freezes the frame (inside a string 0.05 – 0.075 s, a heavy blow 0.095, a string's last blow or a
// single one 0.11, a perfect parry 0.14), punches the camera in and kicks it; a perfect one calls
// game.flow.cinematic({ kind: 'perfectParry' }). A blow that lands freezes it 0.085 s (big 0.13 s).
// The blades MEET (ADR-079): for a hit marked `steel` the attacker's parryContact(chest, last) poses
// him where his blade met the guard and returns it; the deflect pose is taken on that side
// (deflect.side), raised for a blow from above or hung for a low cut (deflect.high), posed in the
// same call (_poseNow: the freeze holds it) and the grip nudged (deflect.nx / ny / nz) onto his
// steel; fx.parry (combat/clashFx.js) draws one clash on the crossing. deflect.gap0 / gap = how far
// apart the blades were before / after the nudge.
canTrade(): boolean                    // swinging (not the execution) and DEFENSE.trade.rearm s past the last trade
onTrade(att, { tell, attack, last }): { heavy, crush } | null
                                       // the trade clash, resolved by the attacker (ADR-082: the hero's cut connected
                                       // when its blow was <= DEFENSE.trade.window from landing). takeHit resolves the
                                       // other half itself: a hit marked `steel` that arrives in the hero's cut returns
                                       // RESULT.CLASHED. Both run _trade: the attacker held at the contact, the hero's
                                       // cut stopped on his blade (_meetBlade, shared with the parry), the burst,
                                       // 'combat:clash', the bounce. crush (a cleave whose poise reaches the attacker's
                                       // TUNING.guard.crushPoise): no bounce, the cut carries on.
                                       // The flash counter (ADR-102, DEFENSE.counter): in takeHit's half only, when the
                                       // cut is at most counter.window s into its active frames and the attacker offers
                                       // onCounter({ point, dir, attack }) -> damage dealt: no bounce, the attacker deals
                                       // itself counter.damage (final) + counter.posture and reels, 'player:counter',
                                       // the crit window opens. Returns { heavy, crush, counter }.
                                       // The flash chain (the default; ?counter=0 off; combat/flashChain.js, ADR-246): onCounter
                                       // writes the link into its argument (o.link / o.links); before the last link
                                       // the attacker strikes back (Duelist: brain.counter.pending + .link, the
                                       // counter move's act carries act.flashLink) and no crit window opens.
onGuarded({ deflect, heavy, attacker })
                                       // a duelist's guard met the hero's strike (he calls it from takeHit). A plain
                                       // ward: the chain goes on. deflect: the blade is thrown back, state 'bounce'
                                       // (TUNE.bounceDur 0.42 s; a guard or a dodge cancels it at once, an attack after
                                       // 0.28 s), 'player:bounced'.
// cancels (ADR-080): a guard press or a dodge cancels a swing at ANY point (windup, the cut, the
// recovery; not the execution's thrust). A flask still waits for 35 % of the recovery.
deathblowClaims(att): boolean            // a duelist asks it before it crosses the blades on a perfect parry of a
                                       // `lock` blow (duelist.onParried): true when the deathblow combo that parry
                                       // armed takes it instead (a blue blow, ?dbLock=combo, the default; ADR-280)
startBladeLock(att, { start, push, decay, dur, hold, dist }): boolean
                                       // a duelist's perfectly parried `lock` blow (ADR-062): state 'lock', every press
                                       // of attack / guard pushes the meter +push, it falls decay / s; 1 wins, 0 loses,
                                       // at dur s it wins if >= hold. HUD prompt + ASCII meter; 'player:lock' start /
                                       // push / won / lost; then att.onLockEnd(won). Won: crit window, 0.3 s i-frames.
                                       // False while down / plunging / already locked. The two close to TUNE.lockDist
                                       // 1.3 m (half each), the blades cross between them (the grip follows
                                       // att.bladeSegment(): _lockCross), sparks grind at the crossing, and the pair
                                       // slides TUNE.lockSlide 0.9 m with the meter (ADR-081).
                                       // `dist` (ADR-129; optional, at least 0.5): the distance the pair closes to
                                       // instead of TUNE.lockDist, kept on `bladeLock.dist`: a lock at range (Tian
                                       // Lei's beam clash passes the distance they stand at; brain.startLock(o))
streamBlock(cost, push, dx, dz): boolean
                                       // (ADR-129) a held guard under a stream the attacker keeps on it (a beam's
                                       // ticks: ascendant/kiBeam.js): `cost` off the guard meter, no health, the
                                       // guard's regen delay restarted, the knock-back topped up to a slide of `push`
                                       // m along the unit (dx, dz), a short recoil. False and nothing changed when
                                       // the cost would empty the meter (the caller then lands the tick as a blow,
                                       // which the player's own block answers: the guard opens). God mode pays nothing.
isSwinging(): boolean                  // a light / heavy swing's active frames (the dragon's bullets are cut on it)
takeHit({ damage, from:{x,z}, knockback=0, knockdown=false, kind='hit', burn=0,
          tell='normal', parryable, blockable, attack, attacker, plunge, perfect, light, flare, point }): RESULT   // see COMBAT.md
                                       // CONTACT (ADR-259, combat/contact.js, ?contact=a|b): a hit from an attacker
                                       // with strikeContact (every duelist) is posed where it meets his drawn body,
                                       // a block where it meets his blade (the guard nudged onto it: guardNudge), the
                                       // hurt / block drawn there and his body's HitReact answering by the part
                                       // (player.hitReact, player.struck); `point` (the wyrm's snout / toe / tail
                                       // tip, with melee) puts the hurt on him nearest it. Nothing of the result,
                                       // the damage or the windows moves
                                       // tell 'black' (a charged blow, ADR-118): a held guard or a parry press in
                                       // its way returns 'blocked' with no damage, the guard meter emptied and the
                                       // guard knocked open (GUARD.black; player:guardOpen {black})
                                       // flare: true on a blue blow = a parry moment: a parry of it readies the
                                       // counter (the riposte with a counter blow; player:parry {flare})
                                       // perfect: false = a roll through this hit is a plain dodge, never a
                                       // perfect dodge (small bullets); light: true = a parry of it is a light
                                       // clash (short hit-stop, a quarter of the push; player:parry {light})
                                       // plunge: false = a perfect dodge of this hit never becomes the plunge
                                       // (fire hazards); while the plunge runs every hit returns 'ignored'
getChestPos(out: Vector3, visual = false): Vector3   // upright gameplay body; visual = the drawn one (FX)
unlean(v: Vector3): Vector3            // drawn (leaned, drawScale) world point → upright gameplay body
drawScale: number                      // his drawn size, PLAYER_SCALE (1.08; ADR-064)
leanPoint(v: Vector3): Vector3         // upright gameplay point → where it is drawn (name tag)
respawn(x, z)                          // full restore, idle, facing north, clears burn/lock/crit/plunge/deflect chain
restAtBonfire()                        // refill hp/flasks (no teleport)
update(dt)
debug: { god: boolean, infiniteFlasks: boolean, heal(), teleport(x, z), kill(),   // used by the Lab
         attackSpeed: number,          // × the attack clock (1 in play): every swing's windup, cut and recovery run this
                                       //   much faster, its step covering the same ground (the Lab's "atk" slider)
         fightStance: boolean | null,  // the stance he stands in (ADR-114): true holds the fight stance, false at ease;
                                       //   null = the game decides (the Lab's "stance" row)
         plunge(execution = false) }   // Lab / captures: start the plunge on the dragon now (any range, in the air too)
```
Module-private state the animator reads (anim.js): `plungeAnim { phase, u, t, exec, h }` (the plunge
phase from the exported `PL` enum `{ VANISH, HANG, DIVE, RIDE, FLIP, LAND }`, progress through it,
the lift), `deflect { n, t, side, perfect }` (the parry chain; `perfect` = the last parry was pressed
within `DEFENSE.perfectParryWindow`, read by an attacker that answers a perfect parry: bullets.js), `guardHold` 0..1 (the guard lingering between
parries), `rmb { held, upT, parryT, edge, chain }`.
Controls (only while `game.state` ∈ {`explore`,`bossIntro`,`boss`}): WASD move · mouse aim · LMB tap =
light chain of five (a cut from the right → a backhand → a whirl → a lunge → the two-handed slam finisher,
each with other looks; ADR-041, ADR-071),
LMB while sprinting = the sprint slash, LMB out of a forward roll = the roll cut (`SPRINT_ATK`,
`ROLL_ATK`; both count as hit 1), LMB hold ≥ 0.3 s then release = the charged dashing cleave (`CLEAVE`, ADR-072) · LMB tap with a posture-broken wyrm's head within 9 m = the execution
(a broken **duelist** within its `execRange`: the execution thrust, `_startExecuteThrust`: a full
thrust that lunges to him; its first active frame calls `onExecute({ damage: DEFENSE.plunge.execDamage })`
instead of the sweep test and emits `player:plunge` / `player:plungeHit {execution: true}` and
`player:hitDragon {kind: 'execute'}`) ·
RMB hold = block, RMB tap before impact = parry · Space = dodge roll · Shift = sprint · F = flask ·
Tab / MMB = lock-on. (E is flow's.)
Drawn body vs gameplay body (ADR-017): the root draws the hero `player.drawScale` tall (model.js
`PLAYER_SCALE` = 0.9 × `HERO_SCALE` = 1.08 since ADR-064; the Ash Disciple, on the same skeleton,
is drawn at `HERO_SCALE` 1.2) and leaned away from the camera (`model.js` `LEAN`,
`installLean(root, scale = HERO_SCALE)`; the returned lean carries its `scale`, and `ox` / `oz`: a
drawn-only offset in metres, 0 for the hero; a struck duelist's shudder). The animator reads
the figure's scale as `anim.drawScale` (its owner's `drawScale`, else `HERO_SCALE`) for the drawn
ground speed of the gait and the foot planner's world spots. The animator runs with `lean.on = false`
(plain upright 1.85 m body, so IK and ground clamps work in metres); the drawn transform is applied
after it. FX read the drawn joints; the sword sweep's hit test, `getChestPos()` (the dragon's aim)
and the hurt cylinder use the upright body (`SwordSweep(sword, unlean)`).
**The drawn contact** (`_contactPoint(dr, kind, out)`): the hit test runs on the upright
gameplay bodies, so its point floats off both drawn figures; a landed cut is DRAWN where the drawn
blade (`CUT_LOOK.from` … `fx.arcAt(kind)` of the hit segment) meets the boss's drawn hurt spheres
(`dr.drawnPoint`, radius × `dr.drawScale`). `player._cut` holds it: the point, f along the hit
segment, the blade's travel there (`cx, cy, cz`; unit ground-plane `gx, gz`) and its direction
(`ex, ey, ez`). That point goes to `takeHit` (with `cut: {x: gx, z: gz}`); whatever `takeHit` moved
the boss's root by (a duelist's shove is instant, and the freeze holds the frame he is drawn in
after it) moves the point and `_cut` with him (≤ 1 m, else ignored); then it goes to
`player:hitDragon` and to `fx.contact`; `game.kick` throws the camera along the travel. Each attack def's `contact`
(the cutFx tier), `hitstop`, `shake`, `punch` and `kick` (a number or [k0, k1] lerped by the charge;
`combat.js` `HIT_FEEL` holds the crit factors, `feel(v, k)` reads one; `THRUST.exec` the execution's)
set the weight of the cut. `atk.hitAt` (the attack clock at the contact, -1 none) and `atk.cutDir`
({x, y, z} unit world travel of the blade there, or null) are set before the freeze starts, for the
animator and other areas. The slam's ground-shard hit draws no cut (the shards are its contact).
Deals damage via `game.dragon.takeHit(...)` using `game.dragon.hurtSpheres`, tested through a
vertical reach band (`REACH` in `player/combat.js`: a sphere overlapping the blade's swept wall
extended `up` m above / `down` m below it counts, so the giant wyrm's chest is in reach from the
front); swings step in toward a hurt surface ahead (`REACH.assist`); the slam's ground shards hit
if the blade missed. Pushes itself out of
`game.dragon.bodyCircles` and resolves vs `game.world.resolve(pos, radius, CONFIG.world.playerBound, false, 'hero')` (the circle, or on
Cinderwood the ground the tree wall leaves open: ADR-125).
**Perfect dodge** (`takeHit` returns `RESULT.PERFECT`; `_perfectDodge(attacker, attack, tell,
hit.plunge !== false)`). The **streak** counts one more (`player.streak`, `player:streak`; it ends
when a blow hurts him, `_streakEnd`), and by attacker:
- it offers the plunge (`plungePoint(out)` + `onPlunge(o)`, and it is not sleeping / dying / dead),
  the hit allows it, and its head (`plungePoint`) is within `DEFENSE.plunge.range` (30 m, ground
  distance) → **the flurry** in the air round its head (state `flurry`, below); with a streak of one
  and the plunge as its art, the plunge alone (state `plunge`);
- it offers the plunge but is out of range or the hit says `plunge: false` → state `ghostep`
  without a teleport: the slow-mo and the crit window where the hero dodged;
- it has no plunge API but a body to cut (`takeHit`, a `position`: a duelist) within
  `TUNE.ghostepMaxRange` 12 m → **the flurry** on the ground, which leaves the hero
  `attacker.ghostepBehind` behind it;
- anything else (no `takeHit`, or farther) → the v0.2 **Ghostep**: a blink `attacker.ghostepBehind`
  (default `DEFENSE.ghostep.distanceBehind` 3.2 m) behind it within 12 m, slow-mo, crit window.
The slow-mo is `game.hitstop(slowmoTime, slowmoScale)`; a harsher freeze already running defers it
until it ends, and actors skip a short freeze while a longer, gentler slow-mo runs, so impact freezes
never swallow it. `player:perfectDodge` + `player:ghostep` fire in every case (for the plunge, x / z =
the hang point).
**The plunge** (contract 2, player side; numbers `DEFENSE.plunge`, timeline in COMBAT.md "The
plunge"): `_tickPlunge` runs the `PL` phases VANISH (the afterimage at the dodge spot) → HANG
(`appearUp` 5 m above `plungePoint`, `appearBack` 0.3 m toward the landing side, drifting after a
moving head at ≤ 7 m/s) → DIVE (accelerating onto the head) → impact: `attacker.onPlunge({ damage,
posture, point, execution })` exactly once (its return = the damage dealt), a hitstop, the burst →
RIDE (keeps his offset to `plungePoint` each frame, easing through a jump of the head at ≤ 40 m/s) →
FLIP (a backflip to a clear landing in front of the head, toward where he came from: `landMin` …
`landMax` from the head, `landClear` past the attacker's `bodyCircles`, inside the arena,
`world.resolve`d; turned off the body when it is in the way) → LAND (crouch; free after
`landCancel`; the crit window and `landIframes` open on touchdown). Hits are ignored and body circles
skipped until the landing; if the head point disappears he springs off from where he is. Every frame
he asks `cameraRig.keep` for himself and the head (`must`), plus the landing point during the flip.
Events: `player:plunge {execution}` as the dive starts, `player:plungeHit {damage, execution}` and a
`player:hitDragon` (kind 'plunge', part 'head', heavy, crit = execution) at the impact.
**The flurry** (`player/flurry.js` `Flurry`, its particles `player/flurryFx.js`; numbers
`DEFENSE.flurry`, the arts `ARTS`; rules in COMBAT.md "The streak and the flurry"; ADR-091):
`flurry.reach(attacker, allowPlunge)` → 'air' | 'ground' | null, `flurry.start(attacker, air,
strikes, attack, tell)`. `strikes` = the streak, at most `DEFENSE.flurry.max`. All but the last are
flash cuts (phases `FP.BLINK` hidden → `DASH` from one side of the target point through it to the
other, the hit half way → `HOLD`), each along a new line (turned from the far end of the last, clear
of the lines already hanging and of the wyrm's neck; with the chain, `STREAK_FX.chain`, each pass
starts where the last ended: below); the last is an art (`COIL` → `STRIKE` →
`AFTER`), picked at random with the animator's noise, never the same twice running
(`player.debug.flurryArt` pins one). Kinds: `plunge` (the plunge itself: `_startPlunge(..., chain)`
takes over in its own state), `iai`, `split`, `vault`. Target point: the head's middle
(`plungePoint` − 0.55 m) in the air, the foe's chest over his `position` on the ground.
Time: while state `flurry` runs, the world is held by `game.hitstop(0.05, DEFENSE.flurry.world)`
re-armed every frame, and the flurry, the animator and the cloth step on `game.realDt` (×
`debugTimeScale`; 0 while paused): `flurry.animDt`. A blow freezes the hero too (`flurry.freeze`).
What it asks of an attacker: in the air the plunge API (the last blow is `onPlunge`, the cuts
`takeHit({ part: 'head', exact, posture, flash })`); on the ground `takeHit` with `exact` (final
damage, past a guard), `posture` and `flash`, and optionally `lockPoint`, `yaw`, `ghostepBehind`.
He ends through the plunge's own FLIP / LAND in the air (`_plungeFlip(rMin)`, `_plungeLand`), or in
state `ghostep` behind the foe on the ground; the crit window opens either way. The whole move is
invulnerable (`takeHit` → `RESULT.IGNORED`), places him itself (no collision until it ends) and asks
`cameraRig.keep` for him and the target; `flow.cinematic({ slowmo: 1, kind: 'flurry' })` leans the
camera in. If the target dies or disappears he comes down where he is (`_bail`). The cuts hang as
`flurry.lines` (drawn every frame from `_updateFx`) until the last blow lands: `flurry.burst`,
called by the art or by the plunge's impact. (A planted answer, ADR-211: `player/riposteCut.js` and
`player/deathblow.js` emit the same events with the field planted true and the art riposte, counter or
deathblow, no flash cuts; flow.js leaves the grade alone for them.) Events: `player:flurry`, `player:flurryHit` per blow,
`player:flurryArt` as the art's coil starts, `player:flurryEnd`; the air arts also emit
`player:plunge` / `player:plungeHit`. The animator's clip `flurry` reads `player.flurryAnim`
({ pose: 'cut' | 'coil' | 'raise' | 'crouch' | 'flip', clip, u, air, k }): a flash cut plays one of
the hero's own swing clips through its active frames. Lab / tests: `player.debug.flurry(strikes,
art)`, `.streak(n)`, `.flurryArt`, `.noRiposte`.
**The shared streak, the riposte, weight** (ADR-094). `_streakUp()` is also called by `_parry` (not
a bullet's), `_trade` and `_mikiri`. A parry whose hit says `last !== false` and `melee === true`
(the attacker's word: the wyrm's `hitPlayer` and a duelist's both give them) arms `player.riposte`;
`_tickRiposte` starts it once `game.hitstopTimer` has run out, from the parry, a guard or standing
free, if the target is within `DEFENSE.flurry.riposteRange`: `flurry.start(att, air, streak, attack,
tell, { riposte: true })`. A riposte is `ARTS.riposte` (kind `return`): every blow a flash cut
(`flurry.cuts` = all of them), the last one calls `burst`, then `_return` puts him back where he
parried in state `ghostep` without the crit window; it emits no `player:perfectDodge`.
`startBladeLock` refuses during a flurry and drops a waiting riposte. Weight: `_hold` SETS
`game.hitstopScale` every frame (`DEFENSE.flurry.world`, or `reelWorld` for `cut.reel` s after a
cut, `flurry.reelT`); a cut passes `reel: 1` to `takeHit`, the last blow `reel: 2`.
`takeHit({ around: true })`: the parry and block arcs are not checked (a foe's flurry).
`takeHit({ breaksGuard: true })` (ADR-144, the Sheathed's draw): a blockable blow met on a HELD guard runs
`_guardOpen(attack, nx, nz, true)` (no health, the whole guard meter, the guard knocked open, thrown back, as a black
blow does to a guard) and returns BLOCKED; a parry press still parries; god mode is untouched.
**One Breath** (ADR-146; combat.js `ONE_BREATH`): `game.unlocks` (`game/unlocks.js` `Unlocks`: `has(id)`,
`grant(id)` → true when new, `toggle(id, on)`, `all()`, `clear()`; localStorage `gcd.unlocks.v1`; `?tech=draw|none`;
absent in the tests' worlds = nothing learned). A HEAVY press begun with the guard up or within 0.2 s of lowering it
(`hb.guard`) and held past CHARGE.hold: `_startCharge` takes the draw stance instead (state `iai`, the animator's
`flurry` clip with `flurryAnim.pose = 'coil'`) while `oneBreath` is learned, else the charge as before. In the stance he
cannot move or guard; a roll leaves it; releasing HEAVY is `_startHeavy(ONE_BREATH)` (a 5 m dash, 46 damage). In `_trade`
a blade blow met by that cut (`def.drawCounter`, on either path, the late one or the attacker's `onTrade`) is the
counter with `attacker.onCounter({ ..., damage, posture })` (`Duelist.onCounter` takes the two overrides) and no crit
window. Emits `player:draw {phase}`.
**A duelist's streak and flurry** (`enemies/duelist/`, `DEFENSE.foeStreak`; ADR-094): `d.streak`
counts up in `_guardClash` and is zeroed by a `takeHit` that deals damage (`_streakSet`). In
`brain.onGuarded`, from `foeStreak.min` a roll (`launch`) makes the guard a deflect for certain and
marks its reaction `flurry`; as the deflect ends `brain.startStreak()` plays the kit's
`streakMove(phase)` (default `streakFlurry`), a move with `streak: true` realised with `{ count }`
(`realise.js`: its first beat, then the others in turn). A beat with `flit: { r }` puts him at
another side of the hero as it starts (`duelist.flit`: the side he turns to, or the nearest one that
is `standable(x, z)`: inside his bound and clear of colliders; the Lord's also on his floor; ADR-112)
and its hit carries `around: true`. `brain._act`
reports every blow's result to `duelist.onStreakBlow(a, b, r)` (`a.streak` = { need, got, failed }):
parried or blocked counts (a perfect parry two) and takes one off `d.streak`; `got >= need` with
none missed calls `_break()`. Lab / tests: `dragon.debug.streak(n)`, `.flurry(n)`.
**Execution:** while `game.dragon.broken`, a light-attack press (from neutral or buffered from a
recovery, `_tryExecution`) with the head within `DEFENSE.plunge.execRange` 9 m starts the same move
at HANG with `execution: true` (`execDamage`, no slow-mo, no perfect-dodge events); the press is
spent.
**Parry and the deflect chain** (player side): an RMB press counts as a parry attempt only once RMB
has been up `DEFENSE.parryRearm` (anti-mash), except right after a successful parry: `_parry` sets
`rmb.chain`, so the next press counts as soon as RMB was released; every press clears it, so a whiffed
press needs the full re-arm again (ADR-032). Parries ≤ `TUNE.deflectChainGap` (1.1 s) apart count up
`deflect.n` (the blade snaps to alternating sides, the clash grows, `player:parry {chain}` raises
the clang); each parry slides him `TUNE.deflectPush` 0.16 m back (×1.6 for blue); between parries
the guard lingers (`guardHold` eases 1 → 0 over `TUNE.guardLinger` [0.32, 0.6] s after the last one).
`player:parry.chain` is the hero's own rhythm count and can run across two strings; the HUD's
"DEFLECT ×N" uses the attacker's `combat:deflectChain` (one string).
**The clash dance** (`combat/clashDance.js`, ADR-247; the game's default, `?clash=0` off; the headless sims keep it off unless a scenario sets it): a duelist keeps the run of
parries inside one of his moves on `_clash {act, n, t, hurt}`. `clashPeek()` gives the run a parry would make now
(0: off) and the hero reads it in `_parry` for `player:parry {clash}` (audio.js rings it a little higher and
louder: `clashRing`); `onParried` (and Halcyon's crash) counts it in `_clashMult()` and multiplies the parry's
posture by `DEFENSE.clashDance.mult[n - 1]`. The run starts over on a new move (`brain.act`), when
`player.hurtN` moved (every blow that lands on the hero or breaks his guard; not a contact stream's chip), or
after `gap` s. Thrown things are no part of it. `_updatePosture` multiplies the recovery by `clashRegenK(hp
fraction)`; the Lord, Tian Lei and Xin Yi use it in place of their `posture.regenByHp` curve.
**Perfect parry** (ADR-051; the window read through `rules.js` `perfectParryWindow()`: the whole `DEFENSE.parryWindow` with
`?parry=one`, the default, ADR-279; `DEFENSE.perfectParryWindow` with `two`): a parry whose RMB press came ≤ `DEFENSE.perfectParryWindow` (0.08 s)
before the impact is perfect: `_parry(tell, attack, sx, sz, light, perfect)` stores it on
`deflect.perfect` and adds `perfect` to `player:parry`. It is computed for every parry; only bullets
consume it today (a light perfect parry: hit-stop `TUNE.returnStop` 0.05 s, a gold burst
`fx.perfectParry`, the RETURN call-out, a brighter clang). Melee perfect parries change nothing yet.
RMB cancels a charge (the LMB press is consumed); an RMB press during one's own swing is queued and
raises the guard when recovery starts. Streams (breath) only count as a perfect dodge when the roll
starts into them.

Model (`player/model.js`, built to `docs/art/hero.md`, the Shadow Swordsman): private to the player
module (nothing outside reads the rig). It is drawn as ink-line ASCII art (ADR-019): every material
carries a `HERO_INK` entry (the `heroArt` source and its per-part pass data, see Render helpers).
Three sword lengths (sword space, m from the grip centre):
- `DIM.bladeBase → DIM.bladeTip` (0.16 → 1.5, + `REACH.tipExt`): the **hit segment** (gameplay).
- `DIM.steelTip` 1.04: the point the **animator** poses with. `anim.js` keeps it off the grass and out
  of the legs, and the `hero` integration scenario checks it. It lies a little past the drawn point
  and moves with it; the hit segment does not.
- `DIM.drawnTip` 0.93: the **drawn** point (a 1.12 m sword with the pommel, ADR-073; was 1.25 m,
  ADR-038, and 1.45 / 1.64 m before; visual only, inside the hit segment). FX that sit on the point use `DIM.drawnTip ??
  DIM.steelTip` (`PlayerFx.bladeHalo`'s dots and tip streak); the swing crescent and the dot halo
  past the point carry the rest of the reach. The blade parts in `heroParts.js` are built to this
  length (`npm run hero-parts`). `BLADE_BASE` (exported) is the blade core's unlit colour;
  `player.js` lifts it with camera distance.

**Build (the lean reference match, 2026-11-09, ADR-034; supersedes round 3's broad build, ADR-031):**
the lean anime swordsman of the owner's six-view sheet on the same bones. `model.js` exports `BODY`,
the girth table (metres): `shell` (torso rings: height `y`, half-width `rx`, half-depth `rz`, forward
offset `cz`, the open coat front's `gap`; chest 0.34 m over a 0.23 m waist), `hips` and `head`
ellipsoids, `deltoid`, `upperArm`, `foreArm`, `thigh`, `shin` (radii along the limb + bulge) and
`foot`. The meshes are built from it; `anim.js` sizes the blade's leg clearance (`BLADE_CLEAR`), the
coat's leg push (`LEG_R`) and the ground-clamp spheres from it; the `herolook` test checks the lean
proportions and measures blade-in-body against it. No bone length changed (IK, the foot planner and
the hit segment run on bones). Joints: `DIM.shoulder` ±0.16 (round 3 ±0.21), `DIM.hip` ±0.1,
`DIM.coatR` 0.132 (round 3 0.163). The sword hand's pose targets are offsets from `DIM.gripShoulder`
[0.17, 0.215, 0] (`rig.arms.R.anchor`; `_handTarget` uses `arm.anchor ?? arm.upper.position`), so
every grip the arm reaches is unchanged by the narrower frame. The sword: `DIM.gem` 0.116 (the
violet star gem at the guard's heart), `DIM.forte` 0.2 (the cyan glyph blade from here; the coat-vs-
steel test and the blade halo start here); the three lengths above are unchanged.
**Coat** (`COAT_PANELS`, six panels; no front flap since ADR-034): two back tails split by a vent
(az ±2.5), narrow side panels (±1.66), two front panels (±0.86). Per panel: `az`, widths `w` [top,
join, tear line], segment lengths `len`, torn `strips` (lengths; 12 in all), `fork`, `out`, the
resting `flare`, `folds`, and optionally `edge` (±1: piping down its +X / −X edge), `skew` (the width
it gains below `w[0]` goes to one side, so the vent / front edge hangs straight or drifts out:
`skew` ±1 … ±1.35) and `slant` (m: the hem runs that much longer at the outer edge). `model.js`
exports `sheetOffset(w, w0, skew)` (where a skewed sheet of width w is centred along its tangent);
the animator's cloth-vs-steel coverage treats a skewed sheet as covering `|x| ≤ w/2 + |offset|`
(`coatHW`), and `herolook` uses the same offset. Coat records carry `r0` (the sheet's radius round
the hips at the anchor) and `len[1]` includes the slant.

The animator (`player/anim.js`) drives: `coat` = 6 panels (`COAT_PANELS`, above), each two spring
segments (the lower one is two meshes: `coat` above, the lavender torn zone `hem` over its last
60 %) plus `strips` (12 torn strips, one spring each, kept above the grass; per-panel `BREEZE` /
`IDLE_FLARE` follow the panel order, unless a panel carries its own `breeze?` / `idleFlare?`);
`streamers` (two-segment spring sheets: the Shrouded set's
cloak, five sheets on the chest and the upper arms (a narrow cape, ADR-073), `SHROUD_SHEETS` in `gear/shroud.js`, ADR-043;
or the Wanderer's torn cape, four sheets behind the right shoulder, `CAPE_SHEETS`, ADR-037; any
slot's item may return them (a head ribbon, a sleeve wing, a sash tail); each record
`{ segs, len, out, lag?, max?, w?, arm?, wrap?, inMax?, floor? }`, `out` = its own outward flare, `lag` = how much
it trails the motion (default 1 = a light ribbon, the cloak 0.5), `max` = how far it may swing from
hanging (rad; default 2.6, the cloak 1.45), `w` = its widths [root, seam, hem] (default 0.3 m
across), `arm` = 1 / 2 when it hangs on the right / left upper arm (0: the chest), `wrap` = the
radius the sheet curves round at its root (read by the tests' sheet model, not by the animator),
`inMax` = [root, tip] how far each segment may swing IN toward its wearer (rad, + = in; negative =
always at least that far out; default its `max`; not applied lying, ADR-083) so a head ribbon or a
scarf off the back never swings into the body, `floor` = while he rolls or falls (not lying: there
`_layFlat` rules) the segments' ends stay `STREAM_FLOOR` (2 cm) over the grass: the target swings to
the nearest angle that clears it and a lagging spring is eased out toward the least swing that clears
it, at most `STREAM_PUSH` (6 rad/s, so it never pops) (a head ribbon in the forward roll, where his
crown meets the grass; default off, today's cloak and every boss's cape go without)).
**Cloth vs steel**
(ADR-048): every frame `_colliders` places spheres along the blade (`COL_BLADE`; the arm lists
`COL_FORE` / `COL_UPPER` are empty: holding the sheets out round the arms widened his back), and
`_sheetBound` keeps each streamer segment on the side of each sphere it came in from
(`streamState[i].side`), by the sphere's radius: from the body side it holds the cloth out (the
cloth drapes over a drawn-back sword), from outside it holds it in; the inside wins a conflict; a
sheet ignores the arm it hangs on (`arm`, for arm spheres). `UPDRAFT_STREAM` (a charge's lift of the
sheets) is 0. Coat panels and strips have their own steel rules (below); hair has none;
`hair` = 5 spring clusters (`HAIR_CLUSTERS`: fringe, left, right, crown, nape), each with a dark-root
mesh (`hair`) and a sheened-tip mesh (`hairTip`); since ADR-034 the locks are layered pointed
blades (crown spikes, top, two back layers, nape, sides, a jagged fringe, cowlicks). Static meshes
that share a joint and a material are merged at build time (fewer draw calls; 123 meshes, ~19.7k
triangles since the lean build); only the flask stays separate.
**Blender-built parts** (ADR-037): the hair (scalp cap + per-cluster `mass` / `tip`), the collar and
its rim, the lapels, the blade (`forte`, `core`, `edge`), the cape sheets (`cape.N.a` / `.b` / `.c`)
and the pauldron (`plate`, `bevel`, `spike`) are not built in JS. `scripts/blender/hero_parts.py`
sculpts them in a headless Blender, fitted to `DIM` / `BODY` / `REST` / `HAIR_CLUSTERS` /
`CAPE_SHEETS` dumped from `model.js`, and `npm run hero-parts` writes them to the generated,
committed `player/heroParts.js` (`HERO_PARTS[name] = { n, p, nrm, uv, k, i }`, base64: positions and
`aGUV` Int16 / 8192, normals Int8 / 127, `aPart` Uint8 / 200, Uint16 indices). `partGeometry(key)` in
`heroGeo.js` decodes one into a BufferGeometry with the usual hero attributes; a part is in the space
of the joint it hangs on, and the body (`model.js`) or the gear item that uses it picks that joint
and the material. Never edit `heroParts.js`
by hand; rerun the script after changing a dimension the parts are fitted to. `CAPE_SHEETS` (per
sheet: `at` on the chest, `ry`, widths `w`, segment lengths `len`, `out`, `cup`, `seed`) must stay
four entries (the streamer springs and the `herolook` test).
**Gear slots** (ADR-042, `player/gear/`, contract in `gear/README.md`): `model.js` builds the
skeleton and the body (neck, head, face, hair, the flask); everything worn or held is an item
`{ id, slot, name, build(ctx) }` in one of `SLOTS` = head, chest, shoulders, arms, legs, waist, back,
weapon. `DEFAULT_LOADOUT` is the Shrouded set (ADR-043: `shroud.hood`, `shroud.tunic`,
`shroud.arms`, `shroud.cloak` over `wanderer.legs`, `wanderer.skirt`, `wanderer.sword`; no shoulder
item); `WANDERER_LOADOUT` is the outfit before it. A head item may keep only part of the hair:
`hair: [...]` lists the pieces built under it (`'cap'` and `HAIR_CLUSTERS` names; the hood keeps
only the cap and builds its own gold strands, `HOOD_HAIR` in `gear/shroud.js`: a spiky fringe, cheek
locks and a strand a side onto the collarbone), `hidesHair: true` builds none; the five hair joints
stay either way. `shadowsFace: true` on a head item (the hood, ADR-056) builds the face, ears and neck
in the shirt's near-black and leaves the eyes out. The hair is gold (ADR-049). `buildHero(U, loadout = DEFAULT_LOADOUT, { self = false } = {})`
(`self`: the player's own rig, see "Scene alpha" and ADR-130; a boss never passes it)
builds each slot's item (an empty chest / arms /
legs slot gets the `base.*` undersuit), merges static meshes per joint + material + slot, and
returns the usual rig plus `rig.loadout` (slot → id or null) and `rig.slots` (slot → the objects it
hung on the skeleton). Geometry builders live in `player/heroGeo.js`, the body's measurements in
`player/heroDims.js` (`model.js` re-exports them). `player.loadout`, `player.equip(slot, id | null)`
and `player.setLoadout(loadout)` swap gear at runtime: the rig is rebuilt under the same root
(`object3d` and `position` stay the same objects), the animator is recreated (the pose restarts from
the ready stance), old geometries and materials are disposed, and the rig's rigid batches
(`player.batch`, `render/rigidBatch.js`) are disposed and rebuilt, reusing their bone slots; an
unknown id throws before anything changes. No event is emitted. Shared builders (`gear/`):
`hands.js` `buildFreeHand(ctx, mat = M.skin)` is the free hand every `arms` item that draws hands
calls (the skin wrist on the forearm, the open hand and the sword fingers on `arms.L.wrist ??
arms.L.fore`, the grip hand on the `sword` joint; returns `{ offHand, keep }`: every outfit gets the
sword fingers); `sheet.js` `hangSheet(ctx, parent, d, mats)`
builds one streamer sheet (or a ribbon) from data and returns its record, `panelSkirt(ctx, PANELS,
{ seed })` a skirt of coat panels (returns `{ coat }`; a panel's `hemFrom` puts the pale `hem` over
the end of its lower sheet; `cone` (default 0.25) how fast it widens down its length, `jag` (default
0.006) its hem's raggedness). `heroGeo.js` `shellGeometry(rings, { arc: [a0, a1] })` builds one arc
of a shell (rad: 0 = his front, + = his left). `model.js` `tintHero(M, tint)` recolours ONE rig's
material instances (`{ <HERO_INK name>: { fill?, ink?, emissive?, spec?, rim?, sub?, inkGlow?,
glowK? } }`), never the shared `U.*`. `player.setLoadout` puts the shared per-part ink
(`U.uHeroPartInk` / `uHeroPartFill` / `uHeroPartRim`, rewritten by every `buildHero`) back as it was
after the build, also when the build throws: a boss's own part ink (the Starless Lord's red part 19)
survives a hero rebuild. **Outfit options** (kept for later use: the owner, 2026-11-14, keeps today's look as the default; the URL switch
`?heroLook=`; the old head switch `?lordLook=` of ADR-084 is gone, and since ADR-122 that name switches
the Starless Lord's body: STYLE.md "The look switches"): `player/gear/looks.js` `HERO_LOOKS` = id → `{ id, name, loadout, tint, of? }` (`shroud`
"Wanderer (today)" = `DEFAULT_LOADOUT`, no tint, the default; `robe` "Moonlit Robe", `swallow`
"Swallow", `warden` "Moon Warden": `gear/moon.js`, `gear/swallow.js`, `gear/warden.js`; each of the
three also as `<id>-shade`, "<look> (shaded)": the same loadout and tint with the head item's
`shadowsFace` twin, `of` = the lit look's id, so the owner picks the face from renders), `LOOK_IDS`,
`DEFAULT_LOOK`, `getLook(id)`, `heroLookFromSearch(search)`, `heroLookUrl(id, href)`. The Player wears
`game.heroLook` (`player.look`; unknown or absent: the default) and tints its rig with the look's
`tint`; `player.setLook(id)` wears another one live (its loadout with the equipped weapon kept, through
`setLoadout`; throws on an unknown id and changes nothing), and every later `setLoadout` keeps the
look's tint. Nothing in `gear/` imports `looks.js`. Limits: the animator, `combat.js` and `fx.js` read the sword's
numbers from `DIM`, not from the weapon item's `dims`; `IDLE_FLARE` has six per-panel values (unless
a panel overrides it with `idleFlare`); the pauldron joint is the right shoulder only.
**The sword looks** (for the owner's pick, 2026-11-14;
`gear/moonblade.js`): weapon items `moon.sheet`, `moon.ribbon`, `moon.crescent` (the longsword's
`dims` and materials; `wanderer.js` exports `SWORD_DIMS` and `swordHilt(D, opts)`, the longsword's
own hilt unchanged without options). `gear/index.js` exports `SWORD_PARAM` (today, sheet, ribbon,
crescent → item id) and `swordFromUrl()`: the Player's constructor wears `?sword=`'s weapon over
the outfit's loadout (none, or no `location`: the outfit's sword); the Lab's 'sword' row equips one. A
weapon's own streamer (the ribbon) carries `weapon: true`. Kept as options like the outfits (the owner, 2026-11-14): today's sword is the
default. If one is picked later it becomes `wanderer.sword` and the switch can go.
**Hands** (ADR-041, `heroGeo.js`): the sword hand is `gripFist`, four finger rolls, a thumb and a
knuckle ridge round the grip, hung on the `sword` joint by the `arms` item so it closes round the
grip in every pose (with no weapon it is a closed fist); the free hand is `looseHand` on the left
forearm (palm, four curled fingers, thumb), built with the sword fingers and the grip hand by
`gear/hands.js` `buildFreeHand` for every outfit that draws hands. The skeleton gives the free arm a WRIST:
`rig.arms.L.wrist` (a joint on `arms.L.fore` at y −(`DIM.foreArm` − 0.03)) and `rig.arms.L.point`
(on the wrist: the sword fingers' tip, `swordTip(BODY.hand, BODY.fingerEx)`; tests, FX). An `arms`
item may return `offHand: { open, grip, fingers? }` (`rig.offHand`, else null; all three in `keep`):
the free hand open, the same hand closed round the grip `DIM.offGrip` (0.08 m) below the sword hand
on the `sword` joint, and (optional) the sword fingers (jian jue, `swordFingers`: index and middle
straight, `BODY.fingerEx` 1.15 long); `open` and `fingers` hang on `arms.L.wrist` in wrist space (the
Shrouded set's bare hands do; the Wanderer's arms return no `offHand`). For a duelist `apply()` shows
`grip` while the pose's `twoHand` > 0.6 and `open` otherwise. For the hero (`HeroAnimator` with
`opts.freeHand`) `grip` shows only once the hand is THERE: `twoHand` > 0.6 and `anim.gripGap` (the IK
end to its place on the grip, chest local, model metres) under `OFF_SNAP[0]` 3.5 cm, kept until it
passes `OFF_SNAP[1]` 5 cm (`OFF_SNAP[2]` 8 cm while `twoHand` ≥ 0.95: a free arm that cannot quite
reach the hilt, the plunge's raised fists, keeps its fist); off the grip `fingers` shows while the pose's `hs` > 0.6 (kept to 0.4),
else `open` (`anim.handFX { fingers, fist }`). **The free hand** (the hero only, `opts.freeHand`):
`_wristL` turns `arms.L.wrist` so the fingers point along the pose's `lD` and the palm faces `lN`
(body axes; each vector's LENGTH is its weight: 0 = the hand rigid on the forearm, today's look),
clamped to `WRIST_L` (radial −20° / ulnar 30°, pronation −85° / supination 85°, flex −70° / extension
60°) through a spring (`anim.wristL { x, y, z, vx, vy, vz, tx, ty, tz, ok, clamped }`: Euler YXZ =
deviation, twist, flex; sub-stepped at ≤ 1/120 s, so it is stable at any frame rate, the frame's
turn capped at `WRIST_L.cap`). `lk` (0..1) pulls the IK end onto the sword wrist (the fingers along the
sword forearm; `anim.lkEff`, let go as the sword hand passes 4-8 m/s); on the grip (`twoHand`) the
wrist goes rigid. `LOCK_REACH` (0.98 × the arm's length) keeps the free elbow ≥ 23° bent on the grip
(the soft reach for every other arm is unchanged). **The hero's reach** (ADR-090, `opts.freeHand`):
`_arm` compresses a far hand target with `HERO_SOFT` [0.93, 0.99] instead of `ARM_SOFT` [0.78, 0.955]
(every other animator's), so his elbows open to ~145-160° at a cut's contact and a thrust's end and
never lock (163° at most); his sword arm blends back to `ARM_SOFT` by the pose's `twoHand`, so the
free hand can follow the grip. `loco()` swings the hero's arms by `armF` = `anim.armSign` × max(|mz|,
0.65): `armSign` is the fore-aft direction he last moved in (`anim.armDir`, latched while |mz| >
0.15) eased at 12/s in `update()`, so they swing in a pure strafe and do not jump as the direction
flips; it opens the free hand on the move (`hs` → 0). `loco()` and `guard()` also feed the
**The instant slash** (ADR-240, `player/slashFx.js` `SlashFx`, `player.slashFx`; `setSlash` / `slashMode`,
`?slash=arc`, the Lab's `slash` row): updated from `player._combat` once the sweep is sampled; per attack record it
keeps the blade's drawn point on the frame before the active window and on its last frame and draws one straight
line through both (a picked look with `spin`: the chords between the point at a third of the window apart; a
`thrust` def or a clip whose `line` is 'point': a streak off the point), in the arc's strokes (fx.js `add`), the
heavy look (`def.heavy`) with `game.kick` / `game.shake`. `owns(at)` tells `_combat` to draw no crescent
(`fx.trail`); flurryFx's swept finisher draws its chord under it. Tests: `onLine`, `lines`, `kicks`.
**The free hand's look** (ADR-240, `player/offHand.js`: `OFFHAND`, `setOffHand` / `offHandMode` / `offHandLook`,
`?offhand=side|back|quiet`, the Lab's `offhand` row): `attackPose` hangs it for a clip that never keys `two`
(`swingClip().two`) through `sideHand(p, b, D, L)`, which sets the pose channel `P.sd` (61; `N` 62; cleared before
each pose) and the hand's elbow, fingers, palm and shape where the look gives them; `HeroAnimator._sideHand`
(in `apply`, after the free hand's target) moves the free wrist's target onto the look's rest with a damped
pendulum on it, `_sideLinger` keeps it there a moment after the attack. '0' leaves production's free hand; 'auto' (the default) wears the feel's own.
**The swings' feel** (ADR-240, `player/feel.js`: `FEELS`, `setFeel` / `feelMode` / `feelLook`, `warpPhase`; `?feel=`, the
Lab's `feel` row): `swingPose` plays the clip at `warpPhase(swingPhase(t))` (each phase's 0..1 through the feel's curve,
the phases' ends kept), the hips' and chest's lead × `lead`, and scales the keyed `by`, `hip`, `sy`, `sx` by `gain`
(eased in over the windup's first half). Every clip attack; the hit test reads the drawn blade, so the contact moves
inside the active window (scenario `feel`).
**The ending slash** (ADR-240, `slashFx.js` `END`, `setPlace` / `placeMode`, `setBeat` / `beatMode`, `?endslash=`,
`?endbeat=`): `_end` moves the cut's line to its place (`target` ahead of him, `body` his chest, `enemy` the last
`player:hitDragon` point of this attack, `blade` the chord itself) and queues it `END.beat` s on (`game.time`);
`_flush` draws what is due each frame. The direction (every place but `blade`): the blade's point `END.at` along
it, projected by the camera each buffered frame, its steps weighted by the point's speed² (`_swing`), laid in the
screen's plane (`_screen`); the line is queued in `END.reveal` pieces `END.step` apart from the swing's start
side. The swing's end waits out a landed blow's bite (`SWING.bite`). Defaults: `enemy`, `0`. While a free-hand
look holds the hand (`P.sd`), the free wrist is `BLADE_PTS[13]` in the coat's sheet test (`_bladePts`). **The light combos** (ADR-240, `combos.js` `COMBOS`, `setCombo` /
`comboMode`, `?combo=`, the Lab's `combo` row): `setCombo` writes a combo's `anim`, `variants`, timings and a
finisher's `kind` / `heavy` / `contact` onto `LIGHT` (production's kept in `BASE` and restored by '0'), and sets
its feel and hand (`feel.js` `setFeel`, `setFeelHand`). Imported by player.js for the URL.
duelists' footwork: the hero's free-arm numbers in them are gated on `A.freeHand`. **Swing clips** (ADR-071, `player/swings.js`): every light swing (the chain's hits 1–4 and
their looks, the sprint slash, the roll cut) and the charged cleave is a keyframed clip. An attack's
`anim: { kind: 'clip', clip: '<name>' }` names a `SWINGS` entry: a list of keys over the attack's own
phases (`u` 0–1 the windup, 1–2 the active frames, 2–3 the recovery, so a clip follows its def's
timing; a held attack button freezes it at `u` = 1, the coil). A key holds the sword hand (`h`, an
offset from the right shoulder), the blade's direction (`a`: [azimuth, elevation] in degrees), the
free hand (`l`), the hips and the chest (`by bx bz hip sy sx sz`), the head, `two` / `offAt`, elbow
poles and the flat's normal; the free hand's fingers (`ld`: [azimuth, elevation] in degrees × `lw`,
0..1, default 1), its palm (`pn`, a vector), its shape (`hs`: 0 open, 1 sword fingers) and its rest
on the sword wrist (`lk` 0..1); `fh: '<name>'` lays a free-hand place from `FH` (swings.js: `aim`,
`aimLo`, `chest`, `wrist`, `highWing`, `wing`, `wingLo`, `tail`, `high`, each `{ l, lp, ld, pn, lk }`)
under the key's own fields. A field missing from a key is interpolated (Catmull-Rom through the
keys that have it). `swingPose` (anim.js) plays it over the fighting stance: the attack's time maps
to the phase through `swingPhase` (a monotone cubic through the three parts, so the rate does not
kink where the cut ends); key 0 is the pose he was in (`A.from`), so a cut runs straight on out of
the last one; the blade turns from there to the first key (the coil, one key at `u` = 1) round his
front and is still moving as it gets there (`swingDir`); elbow poles follow the hands
(`swingPoles`), the head stays on the target, the flat turns into the plane the blade is swinging
in; and the clip hands its channels to `update()` (`A.pathCh`), so the cross-fade leaves them
alone. **The body leads the blade:** the hips' channels (`bx by bz hip`) play `lead[0]` s and the
chest's (`sx sy sz`) `lead[1]` s ahead of the hand (a clip's `lead`, default `SW_LEAD` [0.033,
0.017]; the cleave [0.033, 0]), ramped in from 0.35 of the windup (0.6 when the entry's hips stand
over 0.5 rad from the coil key's turn: they would whip round). While a held light waits at the coil
the lead fades out (`anim.leadK`, 18/s, damped once a frame in `update()`) and runs ahead again on
the release. `bx` is across toward the foot that steps (`anim.stepL`, set by `play()`: the foot
further back along his facing; the keys are mirrored when it is the right one); a clip's `fy`
[front, rear] gives the stance's foot yaws (rad, for a left-front stance, mirrored by
`lungeFeet`). Every light clip keys a body-only anticipation (u 0.5-0.8) and overshoot (u 2.1-2.15)
round its coil and finish (swings.js header). Feet: `lungeFeet`: the foot that is behind as the swing starts steps through to the front
(so the lead foot alternates down a chain) and stays on the spot it planted on, while the other
stays planted where it stood, its heel peeling (it no longer settles sideways onto the stance line);
once stretched `drag` m past the stance's rear spot, or past its leg's reach from the hips the clip
keys (`HOLD_REACH` 0.97 × the leg), its TOE drags after the body and it stays where it was dragged
to (`anim.holdOff`; `anim.footDrag`: bit 1 the right toe, 2 the left; its heel settles back after
a drag over a few frames, `anim.toeK`), and just after the front foot takes the weight (as soon as
it is down if the foot is being dragged already) a foot dragged > 3 cm takes ONE lifted follow step
up onto the stance line (`anim.follow { on, x, z, t0, t1 }`, `FOLLOW`); the clip drives the feet itself (`C.chFeet` in
`A.pathCh`: the cross-fade slid them while the root still drifted out of a roll). While a held
light waits at the coil the stepping foot is set down on the grass, without weight (`anim.coilHold`,
`COIL_HOLD`). `turn`
pivots the feet on their balls where they stand (`pivotYaw`: their yaw turns, the heels lift);
the way home steps the foot that stepped (the left for a dash or the thrust); or `dashFeet` with
`feet: 'dash'` (`dashW: true` starts the dash at the windup's end; its landing times follow the
attack's own `charge`). In `apply()`,
`_elbow` limits how fast either elbow swings round its shoulder → hand line (`ELBOW_RATE`, 14 rad/s:
the hand still reaches its target), for every clip. **Joint limits** (ADR-078), also in `apply()`
and so for every pose and every cross-fade: `_arm` / `_leg` hold a hand / a foot at least
`ARM_NEAR` / `LEG_NEAR` from its shoulder / hip (an elbow never closes past 40°, a knee past 32°)
and move a hand out of the ribs' outline (`TORSO_R`); `_wristLimit` keeps the blade within
`WRIST_BACK` (128°) of the sword forearm's line. The off hand on the grip keeps the grip.
`_hingeFloor` (ADR-083) keeps a knee / an elbow above the grass (`KNEE_FLOOR`, `ELBOW_FLOOR`): one
solved under it is swung round its limb's line up to it. **Hit reactions** (ADR-083) read three
things off the player: `hitPush` (the flinch gives that way), `kdProne` (the knockdown clip's
on-his-front variant) and `downFrom` (the `deadDown` clip: killed in the knockdown he dies where
he lies); a reaction entered mid-turn unwinds the turn (`yaw0`, `carryYaw`), and while a lying
clip plays (`LYING_KEYS`) the cloth sheets obey gravity (`_layFlat`). A light def's `chain` (0..1) is the fraction of
its recovery after which the next light may start (`player.js` `_tickAttack`). A light's root step
(its `lunge`, stretched by the step-in assist) is a push-off and a brake (`TUNE.lungeShape`
`{ pre, end, min }`: a smoothstep from `pre` s before the coil to `end` of the active frames, so
~90 % of it is done as the front foot plants), each frame moving exactly its share; nothing while a
held light waits at the coil, and one released late steps from its release (`atk.relT`), over at
least `min` s. In an attack the root's velocity follows `want` through a `TUNE.attackDamp` (30/s)
filter (`_integrate`); for the shaped step it lands ON the shape each frame instead (only momentum
carried in, a run's, dies out through the filter), so `want` stays the step's own speed. Options on the
anim block: `spin` (±1, a full turn through the active frames: `spinTurn`), `turn` (rad, a partial
pivot from mid-strike through the follow-through, turning back late in the recovery: `pivotYaw`),
`hop` (m, a skip off the ground from the windup into the strike; `tuck`: how far the feet lift
with it, × the hop: over 1 the knees draw up, a leap). The finisher (def kind `slam`) is a clip too
(`slam`, ADR-076: a gather, a leap, one two-handed diagonal into the ground); the only other anim
kind is `thrust` (the execution's lunge). **The way home:** from a clip's `home` (default
`SW_HOME` 0.3 of the recovery; the slam and the cleave 0.55, they hold their finish) `attackPose`
blends the pose toward the ready stance while the clip's last keys are still moving, so the
follow-through runs into the return without a stop. `spinTurn` (the whirl) also drops and leans
him into the turn and turns his head back toward the target, then ahead of the body (`SPIN_SPOT`);
the hips run ahead of the turn and the chest trails it (`SPIN_LEAD`), and its momentum carries him
~14° past the full turn before he settles back (`SPIN_OV`, a damped spring let go at the turn's last
speed; the feet pivot on their balls). The anim block's `spinFeet` picks the feet: `'carry'` (the
default: the stance spots carried round the root in two quick pivot steps) or `'hop'` (the whirls:
each foot leaves the grass from where lungeFeet has it over `SPIN_HOP.up` of the turn and is
carried round with the body, moving across it round its own side from the spot it left (`anim.hop
{ set, yaw, a, r }`: caught as the feet lift) to the stance spot lungeFeet left in `anim.spots`,
drawn in to `SPIN_HOP.tuck` × the stance's spread at the top; over `SPIN_HOP.down` it runs on round
with the turn onto that spot, planted from there. Blended in angle and radius about the root, never
in straight lines through the middle; no follow step; the hips rise `SPIN_HOP.rise`).
**Attack variants** (ADR-055): a `LIGHT` def may carry `variants` (more `anim` blocks for the same
hit: same timing, damage, reach and lunge). `HeroAnimator.play('attack')` calls `_pickVariant()`:
`anim` or one of `variants` at random with the animator's own noise, never the same one twice in a
row for one def (`varLast`) and never a clip along the `line` the swing before it cut (`SWINGS`
entries carry `line`; `anim.lastLine`; a chain's first hit follows nothing), so two hits in a row
are never in the same plane. The result is `anim.atkDef` / `anim.atkAnim` / `anim.atkVar` (0 =
`anim`), and `attackPose` reads `atkAnim` for its def. `anim.forceVariant` (an index, or null) pins
the pick (tests). The blade is still the hit test, so each look is swung at the wyrm in REACH.
**One hand, two hands** (ADR-071; it was two hands on every swing, ADR-046): the chain, the sprint
slash and the roll cut are one-handed, the free hand keyed against the sword hand; the slam, the
charge and the cleave hold the grip with both (`twoHand` 1, the off hand IK'd to the grip point;
the cleave lets go in its follow-through). The fight stance (ADR-275): `refStance.js` `refReady` draws the hold `HOLDS[holdMode()]` (`?hold=`, default `a` the middle guard; `setHold(id)` copies it into `REF_READY`, then idles.js `syncStandArm()`; `holdHabits()`: the fight's habits only in a two-handed hold). The block is two-handed. The hero's (ADR-207, `refStance.js` `refGuard`,
`guardMode()` / `setGuard(id)`, `?guard=ward`): a braced crouch (`REF_GUARD.sink` 0.3 s into it on `A.t`), the feet
settling to `REF_GUARD.feet`, both hands on the grip before the right shoulder with the elbows out, the blade rising
~32° across his face to his left (upright seen from his side), the flat to the enemy. `?guard=ward` and every
duelist (no `freeHand`): the cross ward (ADR-073), sunk and side-on, the grip low outside the right hip, the blade
slanting ~38° up across the body to past the left shoulder. `deflectPose`, `lockPose` and `locoGuard` build on
`blockPose` either way (a deflect's snap takes the ward's body, `WARD_BODY`, easing back with it); `locoGuard` carries `twoHand` and `offAt` in `GUARD_CH`.
Pose channel `offAt` (m): with `twoHand`, how far up the blade from the grip the off hand sits (0 =
on the grip; above 0.04 the hand stays open: a palm braced on the flat; no clip uses it yet). At
rest and on the move he carries the sword in one hand. The free-hand channels (`P.lD` 53, `P.lN` 56:
vec3 body axes, length = weight; `P.hs` 59; `P.lk` 60; the pose has `N` = 61 channels, exported, and
a duelist's scratch poses are sized from it) are read only with `opts.freeHand`: `guard()` writes
the hero's rest (sword fingers low by the left hip, pointing ahead and down), so every other
animator carries the hero's values in them too and ignores them; `locoGuard` carries them in
`GUARD_CH`. A hit, a fall, the drink and the lean on the pommel open the hand and make the wrist
rigid (`freeLimp`); the charge, the block and the plunge (`plBase`) open it to the grip (`hs` 0).
**The two stances** (ADR-114, `stances.js`): where the hero stands. `stand(pose, A)` (anim.js) is
`guard()`'s ready stance, and for the hero's animator (`A.freeHand`) the stance written over it:
`atEase` (the blade on the forearm's line down at his front-right, the free hand open on the belt)
and `fencerGuard` (the sword side to the foe, the arm half extended, the point on the foe), blended
by `anim.fightW` (0 at ease … 1 the guard). `HeroAnimator.update` drives `fightW` toward 1 while
`player.lockOn` or the flow state is `bossIntro` / `boss` (`player.debug.fightStance` true / false
overrides): up at `FIGHT_EASE[0]` (0.38 s), down at `FIGHT_EASE[1]` (0.88 s). `loco()` builds on
`stand()` and an attack's recovery comes home to it; `guard()` stays the base of every other clip
and of a duelist's footwork. Its life is `STAND_LIFE` (periods of the breath, the weight, a look
around and the blade's point; none a multiple of another). In a fight the sword arm keeps the guard
on the move (`FIGHT_RUN`; a sprint trails the blade); a roll and a backstep ease the sword arm out
of the pose they began in (`swordFromEntry`, `SWORD_ENTRY` 0.16 s) and the loco clip settles the
blade into the stance over `LOCO_SETTLE` (0.24 s).
**The run's free arm** (ADR-187, `runArms.js`): in the hero's `loco()` the free (left) arm is
`runArm(p, P, A, phase, armF, sprint, runK, moveW, mz)`'s: one of its carries (`?runArm=a|b|c|d|e|f|old`,
`runArmMode()` / `setRunArm(id)`, default `e`, the owner's pick, ADR-229; `d` the full pump, ADR-204; `e` / `f` the pump
opened out from his side), written as joint angles (`RUN_ARMS`: the shoulder's swing, how
far the arm stands off his side, the elbow, the forearm's cross) and posed by forward kinematics into `lH`, `lP`,
`lD`, `lN` and `hs`, with weight `moveW`. `a` swings like a runner (a pump at a sprint), `b` holds the dash (swept
back behind him; forward only: a strafe or a backpedal swings as `a`), `c` is `a` on the run blending into `b` as
the sprint builds. The dash's weight eases on `A.time` (`A.runArmS`), so `loco()` may run more than once a frame.
`old` returns false and `loco()` writes the swing before ADR-187. A duelist's footwork never calls it.
**The run's sword arm** (ADR-204, `runSword.js`): `runSword(OUT, phase, armF, sprint, tilt)` fills the sword
hand's targets on the run (`OUT.h` → `rH`, `OUT.p` → `rP`, `OUT.d` the blade, `OUT.f` its flat → `swF`) from joint
angles (`RUN_SWORDS`) posed by forward kinematics against the torso's line, turned by its lean `tilt`;
`?runSword=hip|trail|swept|side|old`, `runSwordMode()` / `setRunSword(id)`, default `trail` (the owner's pick, ADR-229; `hip` the blade forward at the
hip, ADR-204); `trail`, `swept`, `side` carry the blade on from the forearm's line behind him and down (`trailing()`:
lifted `tilt` off the line, turned `yaw` out, its slant held in `down`). `old` returns false and `loco()` keeps the
carry before. `loco()` blends the backpedal, the fight carry and the sprint over it. A block, a parry, the flask or a
charge entered from loco with the blade pointing behind him (`from[swD].z < -0.35`) cross-fades over `IDLES.cutFade`
at least (`_idleLife`, as out of the old trailing rest). `OUT.open` (0..1, `trail`: 1) asks the solver for the sword
arm's full reach: `loco()` sets `A.reachT` (only for the clip's own pose, `p === A.target`; × the carry's share;
`locoGuard` × (1 − guardHold)), `HeroAnimator._swordOpen()` cross-fades it across clip changes (`reachFrom`), and
`_arm` reaches `max(lock, open)` of the way past the soft reach for the hero's sword arm.
**Idle life** (ADR-047): in the loco clip, standing still in the `idle` state, at ease (not locked
on, not in the fight stance: `fightW` ≤ 0.05), with no guard held, for `IDLE_LIFE.after` (2.5 s), `HeroAnimator._idleLife` starts an action from `FIDGETS`
every `IDLE_LIFE.gap` (2–4.5 s after the last one ends), picked with the animator's own noise (never
`Math.random`), never the same twice in a row: `look`, `stretch`, `inspect`, `twirl`, `shoulder`,
`lean` (1.7–4.2 s each). Each is a layer over the at-ease stance (`idleLife` in `locoGuard`) with a
0.45 s fade in and 0.55 s out; anything else (a move, a lock-on, a guard, another clip) cuts it within
`IDLE_LIFE.cancel` (0.16 s). State: `anim.fidget = { k, t, w, cut, still, wait, last, count, name }`.
Visual only: no hit test runs outside attacks.
**The idles** (ADR-186, `idles.js`; `?idles=old` = the paragraph above as it was, live through `setIdles`): `stand()`
writes a REST's arms over each stance (`easeArms` over `atEase`, `guardArms` over `fencerGuard`): at ease one of
`EASE_RESTS` (`loose`, `fingers`, `cloak`, `belt`: the free arm only, the sword arm stays `atEase`'s), in the guard one of `FIGHT_RESTS` (`point`, `eye`, `hand`, `low`: the
free hand off the belt). The state is `anim.rests = { ease, fight }`, each `{ a, b, u, hold, mem }` (from rest a to
b, `u` 0..1 of the change, smootherstep, the blade by `dirLerp` with its own memory); `tickRests` (in `_idleLife`)
runs a stance's hold down while he stands still in it and starts a change only between actions (`IDLES.restHold`
7-12 s / `restMove` 1.3 s at ease, `guardHold` 4-7 s / `guardMove` 0.75 s in the guard). The actions: `F.pool` 0 =
`FIDGETS` (old), 1 = `EASE_LIST` (`EASE_HABITS`, `look`, `inspect`, `EASE_TRICKS`), 2 = `FIGHT_LIST` (`FIGHT_ACTS`);
at ease a trick every `IDLES.trickEvery` (3-4) actions (`pickEase`), and one marked `blade` starts only from a `low`
rest (a trick due in the trail first moves him to `loose`); in the guard (`fightW` > 0.95, also locked on) only
`FIGHT_ACTS`, never a trick; during the stance's change, none. A cut lets a `blade` action go over
`IDLES.cancelBlade` (0.26 s), and at ease a block / parry / drink / charge out of a `blade` action or the trail rest
enters over at least `IDLES.cutFade` (0.24 s). Lab / tests: `anim.playIdle(name)` (a `blade` one from a high rest
queues behind a move to `loose`), `anim.setRest(name, atOnce?, hold?)`, `anim.idleNames(fight)`. The trick pool's
three SPELLS (`rite`, `sigil`, `breath`; `spell: true`) publish `anim.spell = { kind, u, w }` (in `_idleLife`, w 0
otherwise); `swordMystic.js` reads it: the flame swells toward the top tier (`SPELL.surge`, every cell lit, hotter,
longer tongues), the rite's flame waits above the fingers' front, and each writes the flame's marks through the same
batch (`SPELL`: the rite's embers, the sigil's ring at knee height, the breath's thread). The idles draw on
`anim.idleNoise`, never `anim.noise` (which picks an attack's look).
**The reference's idles** (ADR-207, `refStance.js`, the default: `idlesMode()` `'ref'`; `?idles=new` is the paragraph
above, `?idles=old` the belt; `setIdles` takes the three): `stand()` writes `refStand` (the one-handed stand,
`REF_STAND`) at ease and `refReady` (the two-handed hold, `REF_READY`: `twoHand` 1) in the fight, blended by `fightW`
(the free hand takes the grip late: `twoHand` = smoothstep(0.35, 0.95, fightW); on the move it lets go by
`moveW`). One rest each (`easeRests()` / `fightRests()`: `stand`, `hold`; `tickRests` keeps a one-entry list).
`actList` is the mode's: `EASE_LIST_REF` = `EASE_LIST` + `EASE_REF_EXTRA` (`stow`), `FIGHT_LIST_REF` =
`FIGHT_ACTS_REF` (`grip`, `shift`, `loosen`, about the hold's blade); an action under way is cut when the mode
changes. The forearm-led moves start from the mode's standing arm (`syncStandArm`: `EASE_ELBOW`, `EASE_AIM`, the
blade's `EASE_BLADE`; the fight's `FIGHT_AIM` / `FIGHT_FLAT`; the blade-swinging moves take
`REF_STAND.leadP`'s elbow pole over their envelope, `leadArm`). **The put-away** (`stow`, `STOW`, a trick): the hand
to the left hip, the sword gone (~1.5 s), drawn and swung up into the stand. `_idleLife` publishes `anim.stow`
(0..1, `stowHidden(u)`) only while it plays uncut in the loco clip: 0 every other frame, so the sword is whole the
frame any other clip starts. `HeroAnimator._stowSword` (in `apply`, the hero only) draws the weapon slot's own
meshes (`rig.slots.weapon`) into the hilt by it and hides them at 1, restoring them exactly at 0 (no object is
added to the rig; the hit test is the swept joint). `swordMystic.js` reads `anim.stow`: the flame envelopes the
steel still there and bursts along the part that goes or comes (`SPELL.stow`); player.js skips the blade halo and
the gem's glow while it is > 0.5 (the gem's timer runs on: it draws on `anim.noise`).
**Idle** (`guard`, ADR-041; ADR-040 put the blade out to his side, where the game camera sees it):
weight on the left leg, the right foot a shoulder's width out and forward with the knee soft, the
upper arm hanging by the ribs with the elbow a little back, the grip beside the right hip and
outside the coat, the blade (`IDLE_SW`) low at his right side: ~52° below level, 79° off his front,
the EDGE down (the flat faces forward), the point just off the grass; the head bowed a little,
looking ahead. An attack's recovery brings a blade that finished
over his left shoulder home round the front (`HOME_WAY` in `attackPose`). Blade blending (`dirLerp`): besides the back-left rule (ADR-023), a near half-turn
(`DIR_FLIP` 2.75 rad, below `DIR_FLIP_HIGH` 0.9 rad of elevation) goes round the front, never behind
the shoulders (the light combo's finish → this idle).
**Glyph scale** (`model.js` exports `setHeroGlyphScale(mats, dist) → k` and `GLYPH_SCALE`): every
frame `Player._updateMaterials` measures the camera → hero distance (`player.viewDist`) and rescales
the hero materials' glyph cells, k = clamp(dist / 12, 0.15, 1): in-game cells at the 36 m camera
(and anywhere beyond 12 m), finer in Lab / showroom close-ups (≈30 rows for the figure at 4 m).
Per material `userData.cell` (in-game cell), `userData.cellMax` (cap for small parts: hair, collar,
plates), `userData.lockX` (the blade's two columns), `userData.zoom / zoomNear` (glyph zoom at the
game camera, default `GLYPH_SCALE.farZoom` 0.45 so the glyphs fill their cells / in close-ups);
materials without `userData.cell` (gem, eye, skin, flask) keep fixed
cells. (The ink-line source is flat per part, so these cells no longer show in game; they still set
the per-cell dissolve and the `U.uArtSolid` = 0 render.) Until 2026-11-09 the same call also set the
blade's depth pull (`BLADE_PULL` → `uArtPull`, ADR-022); it is gone (ADR-031). `player.bladeFar`
(0 close-up … 1 at ≥ 28 m) makes the blade self-light with distance (dark steel with glowing edges
up close, a solid cyan line at the game camera). It touches only the hero's own materials (no shared
uniform, no allocation).
FX helpers that changed shape: `PlayerFx.gemTick(dt, x, y, z, k, vx, vz, vy)` and
`gemGlint(x, y, z, s, vx, vz, vy)` take the gem's own velocity (`player.gemVel`, measured from the
gem joint each frame) so glints ride the hilt; `gemTick` also keeps an always-on 0.22–0.26 m violet
glow point at the gem; `bladeHalo(dt, k, far)` grows its dots with distance (beside both edges,
`HALO_X` m off the blade's axis) and lays a short bright
`|` streak 0.06–0.26 m past the drawn point. `trail(pa, pb, a, b, kind, crit, gate = true, bite = false)`
sub-steps by the edge's travel (one per 0.11 m, up to 14) and slerps the blade round the hilt
between frames, so a sweep reads as one curved arc. Since ADR-077 the arc hugs the STEEL: its EDGE
is one fine line of overlapping `|` strokes laid along the path of a point just past the steel's
point (`arcAt(kind)`: 0.64 of the hit segment, × 1.22 for the slam and the cleave; the steel
ends at 0.44, the reach at 1), white-hot when drawn and cooling to indigo as it thins to nothing
(the heavy blows, the thrusts and the plunge's dive cool to the gem's violet: the exported
`ARC_TONE`; `bite`, the 0.06 s after a cut lands: the edge white-hot and 15 % thicker).
A VEIL of four faint rows runs close inside it (a thin crescent; the numbers are the exported
`ARC_LOOK`). Its strength follows how far the blade TURNED this frame, so a blade only carried
along (a dash) leaves none (`gate: false` for the plunge's dive). `arcGlint(x, y, z, dx, dy, dz,
heavy, crit)`: a small star and sparks on the arc's edge, once a swing as the cut comes through
(`player.js` `_combat`), only on a whiff (a landed cut's core is the beat's one star).
`contact(p, tier, C, crit, k, lite)`: (lite: the low quality's lighter burst, the deathblow's clean contact ADR-264) a cut that LANDS, drawn at p (the drawn contact) by
`combat/cutFx.js` `cutBurst(game, x, y, z, o)` (o = { tier, cut, edge, hilt, crit, power, low }):
a tapered slash line across the body along the cut's screen direction (a second line and a tick
along the blade on heavy blows, a cross on a crit), thin sparks thrown along the cut, falling motes,
a 0.22-0.3 m two-frame core, a ring on heavy blows, one small light; per-tier numbers in the exported
`CUT_LOOK`, the last burst's counts in `CUT_LAST`, the look switch `setCutStyle('gash' | 'fan')` /
`cutStyle()` (the Lab's 'cut' row; `?cutfx=fan`). `cleaveImpact(..., bare)`: bare = the fan only
(contact draws the ring and the light). `sparks()` stays for the plunge.

**The impact pass** (`combat/impact.js`, ADR-149): `IMPACT = { pieces: ['stamp', 'ripple', 'react',
'thump'], on, k, by }`; `impactOn(piece)`; `impactK(piece, who)` = `k` × `by[piece][who]` (`who`
'duelist' | 'wyrm', omitted: no `by`), 0 while the piece is off. `on` comes from `?impact=` (absent,
empty or 'all': every piece; any list: only the pieces named; 'off': none) and the Lab's 'impact'
row flips it live. With it, `contact`'s record also carries `target` (`game.dragon`), and before
`cutBurst` it calls `stampHit(game, x, y, z, o, impactK('stamp', target.kind === 'duelist' ?
'duelist' : 'wyrm'))` and `game.fx.ripple.hit(x, y, z, o, impactK('ripple'))`, inside one try /
catch (a throw is logged, the cut still draws). `cutBurst` calls `takeStampReplace()` once and drops
its slash line and cross when the stamp just drew in 'instead' mode.

**The streak pass** (`combat/streak.js`, ADR-167). `STREAK_FX = { pieces: ['storm', 'tiers', 'aura',
'counter', 'sound', 'world'], on, k, perfectModes, perfect, tempo, chain, figure, figures }` (`tempo`: the storm's tempo, a
live boolean, `?tempo=0` false; the Lab's `tempo` button; `chain`: the flurry's chained paths, a live
boolean, `?chain=0` false; the Lab's `chain` button; `figure`: 'any' or a figure's name, `?figure=`,
`figures` the list the Lab cycles); `streakK(piece)` = `k[piece]` while on,
else 0 (`?streakfx=` absent, empty or 'all': every piece; a list: those named; 'off': none; the Lab's
'streak' row flips `on` live). `STREAK_TIERS` [3, 5, 7, 10, 15], `streakTier(n)` 0 - 5, `streakHeat(n)`
0..1. `PERFECT_DEFAULT` 'sharp', `perfectMode()` / `setPerfectMode(m)` (`?perfect=today | sharp |
cinema`). Nothing stores a tier: each piece reads it at the moment.
- *The storm* (`DEFENSE.flurry.storm`; `flurry.js`): `start` reads `streakN` (the streak, past the cap of
  blows), `tier`, `stormK` = `streakK('storm')` once. `_stormStep(i)` (0 a shown cut, then 1, 2, ...),
  `_pace(i)`, `_stop(i)`, `_cutTime(i)`, `_plannedHits()`. With the tempo (`DEFENSE.flurry.tempo`;
  `tempo` = `stormK > 0 && STREAK_FX.tempo`, read once at `start`, with its ratio `_r`): `_beat()` the
  heavy beat's numbers (ground / air), `_paced()` the cuts it paces, `_final(i)` a riposte's last cut,
  `_pace(i)` = max(floor, r^(k i)) (1 for `_final`), `_stormStep(i)` counts the cuts up to i whose pace
  is under `stormAt`, `_weight(i)` 0..1 (the camera's and the flare's share), `hang` > 0 in the air too;
  `FlurryFx.cut(..., st, wk)` scales the flare and the sparks by `wk`. A storm cut's beats may be shorter than a
  frame: `update` runs on through them (at most 8 steps) until a blow lands or a cut's finish is
  reached, so each blow lands in a frame of its own; `_cloneAt` prints its speed clone in `draw` once
  he is posed on the contact; `_stormAngle` picks its line (24 candidates); `camera()` keeps the target
  and the ring of the cuts, not him. `FlurryFx.setTier(tier, k)` sets `echo` (`TIER_LOOK.echoes`);
  `steel(game, lines, n)` draws the echoes and, on the burst, their split and rings in the fire field;
  `streak(a, b, up, dx, dz)` lays a storm cut's run; `cut`, `appear`, `vanish` take `st` (0..1, how deep
  into the storm). `flurryFx.js` draws on its own seeded stream (`fxSeed()`, `setFxSeed(v)`), never
  `Math.random`.
- *The chain* (`DEFENSE.flurry.chain`; `flurry.js`; `chain` = `STREAK_FX.chain`, read once at `start`,
  also set on `flurry.fx.chain`): `_planFigure()` at `start` picks the FIGURE (`flurry.figure`;
  `player/flurryFigures.js`: `FIGURE_NAMES` star / zigzag / cage / spiral / cross, `figureSteps(name, n,
  air, figures, R, mirror, out)` → each pass's signed offset `o` and end radius `e`, `tracePass(ax, az,
  o, e, out)` one pass with the target at the origin; pure, no three.js). `STREAK_FX.figure` pins one
  ('any': this module's own seeded stream, `setFigureSeed(v)` for the tests, orders the figures offered
  at this many cuts, never the last one first; `lastFigure`). `_layFigure` tries it at every
  `chain.turns` x both hands, costed by `_figureCost` (the dodge spot along every pass, a wall, the
  neck, the art's end); one costing `chain.fit` or more is passed over; the star is `_planChain()` (a
  depth-first search, at most `chain.nodes` steps: `_planS[i]` / `_planOff[i]`, `planGap` its spread).
  Either fills `_planA0` (where round the target the first cut starts), `_planO[i]` / `_planE[i]`
  (`figureFit` the cost, the tests read it). `_beginCut` → `_chainPath()` (A = where he is, or for the first cut `reach` out at
  `_planA0`; B = `_chainExit(A, B, R)`; its hanging line `_line(A, B, CHEST)`: the path his chest
  runs) → `_cutStarts()` (the shared tail). `_onPath(out)`: the point of the pass nearest the target
  (where `fx.cut` and `fx.pass` draw). An art after cuts (`_artChain`) starts where the last cut ended
  (`C0`): `_chainArt(D)` sets A / B / X / d from there; `_tickCoil` carries him from `C0` to A; a split /
  vault samples its blade point every strike step into `_sw` (`_swN` points) and `fx.artHit(..., sw,
  swN)` draws its crescent along them (`_swept`). Skyfall: `_startPlunge(..., chain)` gets `_from`
  ({ ox, oz } = where he is) instead of the flurry, so the plunge hangs over his side of the head.
  `FlurryFx.chain`: no crescent in `cut` / `_stormCut`, no lens in `artHit`, the burst's thin lines
  at `ext` 1, and `dust(x, y, z, dx, dz, k)` (`DUST`, the alpha pool, `dustStat` for the tests) in
  place of `PlayerFx.slamShards` on the ground's last blow and of `artHit`'s 'A' shards (round the
  head, and the Heaven Splitter's landing). The `lines` entries keep their shape (`ax ay az bx by bz k
  last`) and `player:flurryHit` fires as before.
- *The burst* (`player/flurryBurst.js`): `BURST_LOOK.levels` (null = today, then 1 - 3), `BURST_DEFAULT`
  2, `setBurst(n)` (0..3, or a custom level object: `burstLevel()` -1), `burstLevel()`, `burstLook()`
  (null at 0), `burstScreen()` ({ cut, last, dip }; all 1 at 0), `pair(L, key)`. Read at the blow by
  `FlurryFx` (lights, flares, sparks, stars, halo, speed lines, crescent, veil, the thin long lines,
  `pfx`: the hero's own spark star and shockwave) and `flurry.js` (the boss's hurt flash on the last
  blow, x `boss`); `game/flow.js` multiplies the flurry's `flashPulse` and `dip` by `burstScreen()`.
- *The perfect parry's sparks* (`combat/parrySparks.js`, ADR-181): `PARRY_FX` (`?parryFx=0|a`), `PARRY_FX_DEFAULT`
  'a', `parryFxMode()` / `setParryFx(m)`, `parryFxSpec(m)`, `PARRY_SPARK_GLYPHS`, `PARRY_SPARKS_LAST` (tests);
  `parrySparks(game, x, y, z, o)` (from `PlayerFx.parry`'s perfect branch: the crossing, the edges `e1` / `e2`,
  `met`, the push way), `parrySparksUpdate(game, realDt)` (from `perfectUpdate`), `parrySparksClear()` (from
  `perfectClear`), `parrySparksBusy()`. Its own `LetterBatch`, built on the first spit; its own seeded stream.
**The sword's green flame** (ADR-182). `player/swordMystic.js` `class SwordMystic` (`player.mystic`, built in the Player's
constructor; `update(dt)` at the end of `Player._updateFx`, returning at once with `?mystic=0`). `mysticMode()` is `'c'` (the
flame) or `'0'` (off; `setMystic(id)`; `MYSTIC_IDS` = `0,c`, `MYSTIC_NAMES`). `FLAME` holds the tuning, one entry per
`streakTier(player.streak)` 0 – 5 (read from the hero's own streak, not `streakK`: `?streakfx=off` leaves it on); `GREEN` the
colours and the heat bands; `MYSTIC` the budgets, lift and soft depth; `MYSTIC_GLYPHS` the marks it may print. Every mark is the
hero's own micro letter (`render/glyphs.js` PIXEL_3X3, its atlas column from `pixelArtOrder()`) in a `LetterBatch` of its own
(`world/life/letterBatch.js`, snapped, its `_sync` replaced so it takes `pipeline.heroArt` / `pipeline.heroCell` and never
disposes them; registered with `pipeline.registerParticles`), built the first time the layer is on, on the module's own LCG
stream (`setMysticSeed(v)`; never `Math.random`). The flame needs `pipeline.width` / `height` (nothing without them). Budgets a
frame: `MYSTIC.budget` (6) licks, `MYSTIC.cells` (110) flame marks; `onEmit` (tests) sees every one ('spawn' | 'flame'); `n`,
`w`, `heat`, `total` count them. Nothing on a dead, hidden or unarmed hero, none over his torso's column; none of it writes a
uniform. The Lab's PLAYER row `mystic` (off / flame) sits after `sword`.
- *A single perfect parry / dodge* (`combat/perfectFx.js`): `PERFECT_FEEL` (today null; sharp; cinema,
  with `full` / `short` beats, `gap` 0.9 s, `echoTier` 3), `perfectFeel(mode)`, `perfectBeat(mode, last,
  realTime)`, `MARK_LOOK` (tint zone id 800101), `PERFECT_LAST` (tests), `PERFECT_GLYPHS`;
  `perfectParryMark(game, x, y, z, o)`, `perfectDodgeLine(game, x0, y0, z0, x1, y1, z1, mode)`,
  `perfectArrive(game, x, y, z, mode)`, `perfectGhost(...)`; `perfectUpdate(game, dt, realDt)` (from
  `flow.update`, before the fire field's update), `perfectClear()` (the flow's fx clear),
  `perfectBusy()`. `PlayerFx.perfectMoment(kind, last, streak, mode)` returns the moment's record
  ({ mode, F, T, beat, streak }); `player._parry` takes the freeze, shake, punch and the cinematic from
  `T` (null = today's numbers) and passes it to `fx.parry(..., { feel })`, which calls `clashBurst` with
  `o.cross === false` (`clashFx.js`: no glyph cross; the mark draws it) and prints the mark;
  `player._ghostep` passes `{ feel, wx, wz }` to `fx.ghostep` (`_ghostepFeel`: the standing afterimage,
  its tear, the line) and calls `_slowmo(sec, mode)`: sharp a hitstop slow motion of its own scale,
  cinema `flow.cinematic({ ..., quiet: true })`.
- *The aura and the world* (`player/streakFx.js` `class StreakFx`, `game.fx.streak`, built in main.js
  after the player, `update(fxDt)` after the ripple, `clear()` with the other fx): listens to
  `player:streak`; exposes per frame `edge`, `edgeA`, `bladeLine`, `echoes`, `echoA` (0 = today).
  `player._updateMaterials` lifts the blade's ink / rim lines by `bladeLine`; `fx.trail` draws `echoes`
  echo lines inside a swing's arc; `fx.bladeHalo(dt, k, far, edge, edgeA, top)` draws the edge line.
  The fire rim writes `fire` blobs into `game.fx.fire` (`STREAK_FIRE`: heat 0.17, `cover`, `minH`,
  `back`, `blade`, `tongue`, `trail` per tier; thinned from 3800 field blobs); `?auraFire=b` dyes the
  `steel` kind in tint zone 735101. `STREAK_AURA`, `STREAK_FIRE`, `STREAK_WORLD` (gust, ring, rise per
  tier; `floor` by level id) are exported. It steps aside while the hero is in `flurry` or `plunge`,
  dead, or while `player.ghostFx` > 0.5. Its own seeded stream.
- *The time rip* (`player/timeRip.js` `class TimeRip`, `game.fx.rip`, built in main.js after the
  streak fx; `?rip=off|tear|strip|ghosts|negative`, default `strip`, the owner's pick):
  `TIME_RIP.mode` is live (read at every cut; `ripMode()` / `setRipMode(m)`, the Lab's `rip` button in
  the streak row), `RIP_LOOK` holds every number per mode, `RIP_STAT` counts (tests), `RIP_GLYPHS` the
  ghosts' digits. It listens to the flurry's start, blow and end events (no new event): on a blow it
  reads the newest hanging line `player.flurry.lines[nLines - 1]` (once per line: an art's last blow
  draws none and marks nothing new), and the blow's `storm` / `gap` / `last`; a line is re-read live
  (its `k`) while its flurry runs, then kept as copied. `update(fxDt, realDt)` runs in main.js's
  simulation step after the world and BEFORE the lights, the particle pools and the fire field age (what
  it draws shows this frame); its marks step in real time, its blobs and particles live on fx time with
  one copy alive a frame. Steel (`game.fx.fire`, kind `steel`) for the tear's hairline and split and
  the strip's seam; glyph digits (`game.fx.add`) for the ghosts, from `player._sampleBody()` /
  `player._ghostPts` (the afterimage's points; no randomness). The strip and the negative are the ASCII
  pass's `cutBand` (render/pipeline.js): `uCutN` (0 = the pass reads nothing; set to 0 once when the last
  cut ends, nothing written while idle), `uCutA[2]` = a cut's two ends in frame px (y up), `uCutB[2]` =
  (1 strip | 2 negative, half-width in art cells, shift in cells, the negative's weight), `uCutTone` (the
  negative's pale cell rgb, w: a pixel brighter than the scene x uBg x w is a letter's stroke and prints dark); the strip and the negative run along the WHOLE line (k = 1), and their first frame is the contact's (a cut ages from the next step). `TimeRip.write(pipeline)` fills them, from `update` and
  again from the pipeline right before the pass (`pipeline.setTimeRip(rip)`, as the impact ripple).
  `clear()` with the other fx (flow `_resetWorld`, world `setVisible`). `busy`, `ghostAnchors` /
  `ghostAnchorN` (the newest copies' chests) for the tests (`timerip` in integ.mjs and duel.mjs,
  `tests/integration/timerip.mjs`).
- *Payload fields added* (no new event): the flurry's start event gains `figure` (the chain's figure,
  `flurry.figure`; '' with the chain off), `streak`, `tier`, `storm`
  (true when its later cuts are a storm) and `at` (the real s from now each flash cut is planned to
  land); each flurry blow's event gains `gap` (real s since the blow before) and `storm` (0 a shown
  cut, else how deep into the storm); the parry event gains `feel` (the perfect look's mode, 'today'
  when not perfect or a bullet) and `beat` (cinema's 'full' | 'short', else ''); the perfect dodge
  event gains `feel`. `player.debug.flurry(strikes)` takes a streak up to 99 (7 blows still).

`edgeGlint(sw, z0, z1, far, crit, realDt, ridge)`: a small cold '+' (and '|' strokes behind it)
running up the LEADING edge of the steel from sword-space height z0 to z1 this frame (`leadSide(sw,
e)`: the blade's mid travel against its X axis; the ridge under `EDGE_GLINT.ridge`, or always with
`ridge`); `player.js` `_combat` drives it from `EDGE_GLINT.lead` s before the active frames to the
arc's glint (`at`, `atCleave`; z eased up `EDGE_GLINT.z`), on the steel every frame (no velocity),
stopped by a landed cut (`atk.glintZ` = how far it ran); never for the thrust kind. An attack def's
`glint: 'ridge'` (the stab) runs it up the ridge. `edgeFlash(sw, zc, heavy, crit, ridge, hold)`: the
contact's mark on the steel, `EDGE_GLINT.flash.n` '|' strokes along the leading edge from the
contact's height up to the point (`player._edgeFlash`, after `contact`); no velocity, so it lives
`hold` fx s (the frames the freeze holds: this frame at the full rate + the freeze at `fxLive` +
one frame; clamped to `flash.lifeMin` … `life`, fading to `holdEnd` × alpha) and is gone as the
blade swings on (no `hold`: `flash.life`). Exported: `EDGE_GLINT`,
`hwAt(z)` (the drawn blade's half width), `leadSide(sw, e)`. New: `skid(dt, slot, x, z, dx, dz, sp,
k)` (dust and torn grass off a sliding contact; `slot` 0 / 1 keeps a rate accumulator each) and
`scrape(dt, x, y, z, dx, dz, sp)` (cold sparks off the dragging point). 2026-11-09: `parry(x, y, z,
blue, chain = 1, dx = 0, dz = 0)` (the clash grows with the deflect chain, crossed streaks from the
2nd; (dx, dz) = toward the blow) and the plunge's `plungeBlink(segs, nSegs, ox, oz, nx, ny, nz)`,
`plungeHang`, `plungeImpact(x, y, z, dx, dz, exec)`, `plungeRide`, `plungeRip`, `plungeLand(x, z,
dx, dz)` (cold afterimage and streak, crystal shards and molten blood at the wound, landing dust;
world-atlas glyphs only). Glyph strokes are laid
along the rendering camera's axes (`game.camera.matrixWorld`, read in `get add()`; the fixed 58°
basis is the fallback), so they stay right in Lab views.

Animator ↔ player hooks (`anim.js` is private to the player module):
- `anim.onFootstep(side, dust?)` → `player._footstep(side, dust = 0)`: emits `player:footstep`;
  `dust` > 0 kicks up a puff of that size (a dash's two touchdowns: the cleave, the execution's thrust).
- `ROLL_SLIDE` (exported, `[0.42, 0.58]` s of the forward roll's `stateT`): the sliding kneel. In it
  `_updateFx` calls `fx.skid` for the right shin (slot 0) and the planted left foot (slot 1), and
  `fx.scrape` while the blade point is below 0.14 m. The root speed is unchanged.
- `anim.kickCoat(power, rnd = Math.random)` throws the coat panels and strips out. `anim.noise()` is
  the animator's own LCG (0..1): cosmetic kicks in code the integration sims run pass `anim.noise`,
  never `Math.random` (the sims seed it and the wyrm's AI rolls on it). The light sweeps kick 0.32 on
  their first active frame (`player.atk.flared`, a new flag on the attack record), the slam's impact
  0.6.
- The attack record also carries `atk.relT` (the attack clock at a held light's release; 0 = never
  held: the root's step in starts there) and `atk.hitAt` (the attack clock at a landed, unguarded
  hit, set in `_applyHit` before the hit-stop starts; −1 = none: test `hitAt >= 0`, never
  `Number.isFinite`). `anim.js` reads `pending` (the held coil: `anim.leadK`) and `hitAt` (the
  bite, below). Internal to `player.js`: `atk.shaped` (this frame's `want` is a light's shaped
  step) and `atk.svx` / `svz` (the step's velocity `_integrate` landed the root on last frame): the
  step's filter pre-compensation (`TUNE.attackDamp`, above). A roll's first frame (before
  `_tickRoll` sets `want`) keeps only the part of the frame before's `want` along the roll
  (`_startRoll`): out of a swing it no longer runs on along the swing's facing.
- **The bite** (`attackPose`, clips only): from a landed hit (`atk.hitAt`) the edge catches in what
  it cut: the blade holds where the contact frame drew it (`anim.bite { rec, at, dir }`, keyed on the
  record and the time), the grip pulls in along it, the hips drop, the chest folds and the head
  nods (`BITE`, × the def's `bite`, combat.js; the fold and the nod also × the clip's `fold`,
  swings.js: the cleave's upright two-handed blade stands before his face, 0), full through the
  hit-pause (whose frozen clock keeps `t − hitAt` ≈ 0) and let go over `BITE.dur` (0.08 s) of the
  attack's clock after it. **Inertia**:
  outside a dash, the chest pitches against the root's acceleration (`ATK_INERTIA` × `anim.leanF`,
  the loco's lean spring): behind the hips on the push-off, over the planted foot on the brake.
- Internal animator state worth knowing: `pathCh` (channels a windup path drives this frame, copied
  past the cross-fade), `updraft` 0..1 (the charge lifts the coat and hair), `dashStep` (bits: dash
  touchdowns taken), `marks` (4 per-clip ground marks), `feet` (the world-space foot planner; for a clip whose `def.steps` is set, a duelist's move, `_feetClip` holds the same feet on their spots and steps them under the root motion: `CLIP_STEP`, ADR-126),
  `visYaw` (the drawn heading: a critically damped spring, `TURN_K` 650, at most `TURN_LAG_MAX` 1.4 rad
  behind the gameplay yaw; visual only).
- **Active frames stay bit-identical** (ADR-024): a pose path that reshapes an attack windup reaches
  the clip's own pose by windup − 1/30 s and hands its channels back; recovery shaping starts at
  windup + active + 0.035 s (the frame after the active window is still hit-tested); active-frame
  shaping only touches non-blade channels (free arm, feet, head, coat). The proof is a per-frame
  compare of `sword.matrixWorld` and the hit points against the previous build. The rule has been
  relaxed for the hero's own clips since ADR-031 / 071 / 076, and the weight work moves his active
  frames again (the hips' lead, the root's step shape, the bite after contact): for those the REACH
  table (every look connecting from contact out to 3.5 m) is the gate.
- Blade directions blend by azimuth / elevation round the outside of the body (`dirLerp` /
  `dirTo`), a cross-fade keeps last frame's way round, and outside attacks the blade is pushed out of
  the leg capsules before the ground clamp (ADR-023). Since the broad build (ADR-031) the clearances
  come from `BODY`. The build is not bit-identical on active frames (ADR-024): the hit segment moved
  by ≤ 2.5 cm on some of them (light 1 on 57 of 73 frames, light 2 on 9 of 29, the slam on 15 of 36;
  the thrust is identical), and the REACH table is unchanged. (ADR-071 / ADR-072 replaced the light
  swings and the charged attack outright, ADR-076 the slam: none of these clips remains.)
- **Coat vs blade** (round 3): every frame the grip and 12 points along the drawn blade are tested
  against each coat panel segment in that segment's frame. With the sword hand outside the cloth the
  panel hangs inside the hand and the blade (they cap its flare; the legs still win); with the hand
  under it, or steel running in under it inside the pivot, the panel drapes over the blade. The side
  is latched per panel (`coatSide`: 1 outside, 2 under) while any steel is over it; the steel moves a
  segment at most 0.12 rad per 60 fps frame; off while down or tumbling (the floor contact rules).
  The torn strips and the sleeve streamers ignore the blade. The run / sprint pose trails the sword
  hand outside the coat.
- **Plunge and deflect clips** (the "PLUNGE + DEFLECT" block): `plunge` (`plungePose`: hang, dive,
  ride, flip, land poses by `player.plungeAnim.phase`; `player._plungePhase` re-enters the clip with a
  short cross-fade at each phase), `parry` = `deflectPose` (the blade snaps into the blow on
  alternating sides by `player.deflect.side`, back in the guard by ~0.17 s; it replaced `parryPose`),
  `loco` = `locoGuard` (the walking clips blend in the block's upper body by `player.guardHold`). The
  plunge's root is the ground point carried up by `position.y`: foot targets stay root-relative, the
  ground clamps are world-space.

### Dragon — `src/entities/dragon/dragon.js` exports `class Dragon`
```
constructor(game)                      // builds the four-legged drake, sleeping at CONFIG.world.dragonSleep
object3d, position (Vector3, root on ground), yaw
batch                                   // its rigid batches (render/rigidBatch.js batchRigid; empty with ?nobatch)
bound: number                           // radius around the arena centre the root stays inside:
                                        // min(CONFIG.world.dragonBound, TUNING.bound = 24) (move, charge, leap target)
boundAt(x, z): number                   // ... in that direction: bound + world.edge.bossGain(x, z) (ADR-125: the root
                                        // follows the hero out through a gap in the tree wall; = bound until one opens).
                                        // What moves the root reads this: _collide, the charge, the leap / hop targets,
                                        // the flights (fireAttacks.js inReach, runIn), the terrain moves' stand
arenaAt(x, z, base): number             // a radius sized for the clearing (where a meteor may land: hazards.js ARENA_R 27)
                                        // carried out with the hero's ground that way: base + (edge.heroAt - edge.base).
                                        // A barrage wave laid over the clearing moves with a hero who has left it
                                        // (he stands 7 m inside its rim)
name = 'VAELGRIM, THE CINDER WYRM';  hp, maxHp;  phase: 1|2|3
phaseAt: number[]                       // HP fractions where each phase starts (TUNING.phaseAt [1, 0.66, 0.33]);
                                        // the HUD draws its boss-bar ticks from it
nextPhaseHp: number                     // HP of the next phase's gate (maxHp × phaseAt[phase]; 0 in phase 3)
posture, maxPosture: number;  broken: boolean   // posture break = staggered + broken; maxPosture per phase
state: 'sleeping'|'waking'|'combat'|'staggered'|'airborne'|'dying'|'dead'   // 'airborne': the leap, the flights
hurtSpheres: Array<{x,y,z,r,part,mult}>  // world space, refreshed every update; part ∈ head|neck|body|tail|wing|leg
                                        // (leg = the four legs; wing = the wing wrists + finger knuckles)
bodyCircles: Array<{x,z,r}>              // ground footprint for player push-out (empty while airborne):
                                        // chest, hips, neck base, loins, then each PLANTED foot (0..4 more)
hazards: Hazards                        // the fire hazards (hazards.js, contract 3): see "Hazards" below
bullets: Bullets                        // the bullet field + the ground tongues (bullets.js, ADR-039): see "Bullets" below
terrain: Terrain                        // the piece in its jaws or in the air (terrain.js, ADR-110): see "Terrain moves" below
ablaze: Ablaze                          // phase 3: it sets itself on fire (ablaze.js, ADR-120): see "The wyrm ablaze" below
incantation: Incantation                // the seals of burning script a roar-cast move draws (incantation.js, ADR-197):
                                        // see "The incantation" below
brood: Brood                            // the drakelings and wisps it calls up (brood.js, ADR-197): see "The brood" below
react: WyrmReact                        // the impact pass (react.js, tuningReact.js, ADR-149): the drawn body
                                        // answers where it was hit; see "The drawn reaction" below
crashing: boolean                       // true while a plunge stops a flight: that action's end() must not land it elsewhere
isTargetable(): boolean                 // false while sleeping/dying/dead
lockPoint(out): Vector3                  // chest/neck base, for lock-on + camera
startIntro()                            // wake → rise → roar; emits 'dragon:introDone' when the fight starts
takeHit({ damage, part, point:{x,y,z}, dir:{x,z}, cut:{x,z}, poise, heavy, crit, exact, posture, flash }): number
                                        // returns the damage dealt (before the gate clamp); adds posture.
                                        // point = where the cut is DRAWN (the hero's drawn blade on the
                                        // boss's drawn body, Player._contactPoint): FX and the damage
                                        // number only, never gameplay. cut (optional): the unit
                                        // ground-plane travel of the blade at the contact: the hit
                                        // spray flies along it (absent: along dir / the flinch)
                                        // Phase gate: with the AI on, damage stops at the next phase's
                                        // threshold until its transition starts (no skipping a phase).
                                        // exact: the damage is final (no part / broken multipliers); posture:
                                        // add exactly this much instead of the weapon gain (onPlunge);
                                        // flash: the most the hurt flash may be (the flurry's cuts);
                                        // reel (a duelist): 1 thrown as by a heavy blow, 2 staggered;
                                        // with reel 1, keepOpen (the deathblow's read a, ADR-264) leaves him
                                        // in a reeling / recoil / stagger with most of it still to run, and
                                        // shove m is his flinch's travel back (read b; absent: 0)
                                        // (?strikeGap, ADR-264: duelist/strikeGap.js strikeGapFloor(d, zone),
                                        // read by brain._motion: a blade blow's dash stops at the floor (never a
                                        // dash through him), capped at 0.85 x the blow's reach; off by default)
onParried({ attack, tell }): void       // the dragon calls this itself when player.takeHit returns 'parried'.
                                        // Deflect chain (contract 1): a string's non-final hit is only
                                        // deflected (posture + a 0.14 s visual knock-back, the string goes
                                        // on); its last hit / a single melee attack recoils. Emits
                                        // dragon:parried {attack, tell, hit, last} (+ combat:deflectChain)
                                        // once per parried blow: a second call for the SAME attack within
                                        // 0.1 s is ignored; another attack (a drakeling's bite beside a
                                        // claw) is answered too, so player:parry = dragon:parried
attackLabel(id): string | null          // a move's name for the player (the death screen, the move telemetry): its tuning
                                        // label without the note in brackets; null for an id it does not know. Every boss
                                        // offers it (a duelist: kit.MOVES[id].label)
plungePoint(out): Vector3               // contract 2: the top of the head (rig.pt.head + 0.6 × SCALE up), valid in flight
onPlunge({ damage, posture, point, execution }): number   // contract 2 (below): final damage to the head
                                        // (phase gate kept), posture, the 'plunged' reaction; emits
                                        // dragon:plunged {execution}; returns the damage dealt (0 = ignored:
                                        // not targetable, or a repeat within 0.25 s)
enterPhase(n)                           // the transition roars call it at their start: phase n's posture meter
                                        // (emptied, a waiting break dropped), the staggered unlock of phase n's
                                        // abilities (TUNING.unlockStagger); enterPhase2() = the v0.4 name
hitstop(sec, scale)                     // game.hitstop that won't crush a running Ghostep slow-mo
reset()                                 // back to sleeping at the nest, full HP/posture, phase 1, FX/lights/hazards cleared
update(dt)
drawnPoint(v): Vector3                  // a hurt sphere's exact point → where it is drawn, in place
                                        // (identity unless a reaction is drawn: react.drawnPoint)
debug: {                                // used by the Lab (generic shape every future enemy implements)
  abilities(): Array<{ name, label, tell, phase }>,   // every ATTACKS entry (50: 8 singles, 17 strings, 11 fire
                                        // attacks and flights, 6 bullet patterns, 3 terrain moves, 2 brood moves,
                                        // 2 roar-cast spells (ADR-197) and 'roar', the transition shock ring)
  trigger(name): boolean,               // force an ability now (wakes/starts the fight if needed); false while busy
  setAI(enabled: boolean), aiEnabled: boolean,
  wake(), startFight(),                 // startFight skips the intro straight into combat (no-op if fighting)
  phase2(), phase3(), stagger(), postureBreak(), kill(), reset(), setHp(fraction 0..1),
                                        // phase3: straight into the phase-3 transition (from phase 1 or 2)
  hitboxes(): Array<{ x, y, z, r, kind: 'hurt'|'attack' }>,  // for the Lab overlay
  currentAction?(): object|string|null, // optional, Lab readout (the running action)
  ablaze(look?): string                 // the wyrm only: phase 3's fire 'off'|'a'|'b'|'c' (sets it when given; returns the one in use)
}
```
**The drawn reaction (ADR-149, `dragon/react.js` `WyrmReact`, numbers `tuningReact.js` `REACT`).**
`takeHit` calls `react.hit(o, part)` (guarded) after the hit spark; nothing happens while sleeping,
dying or dead, or at `impactK('react', 'wyrm')` 0. `_step` order: `react.restore()` first (last
step's rotations off the joints), the whole step (AI, rig, hurt spheres, attacks, the eye glints read
`react.eyes(rig.pt.eyes)`), `react.apply(dt)` last. So what reads the joints inside the step sees the
plain body; the renderer and the rigid batch's bone texture see the reaction. `react.clear()` on
`reset()`. Up to `pool` 6 reactions at once; no Object3D, no random numbers, no allocation per frame.
While one is drawn the hurt spheres can sit up to about 1 m off the drawn body for 0.2 - 0.5 s.

**Attacks and selection** (`attacks.js` `ATTACKS`: the singles, the strings, `roar` and, spread in,
`FIRE` from `fireAttacks.js`, `BULLET_HELL` from `bulletAttacks.js`, `TERRAIN_MOVES` from
`terrainAttacks.js` and, since ADR-197, `BROOD_MOVES` from `broodAttacks.js` and `FIRE_SPELLS` from
`spellsFire.js`; their numbers are `TUNING.attacks`, into which `tuningFire.js` `FIRE_ATTACKS`,
`tuningBullets.js` `BULLET_ATTACKS`, `tuningTerrain.js` `TERRAIN_ATTACKS`, `tuningSpells.js` `SPELLS`
and `tuningBrood.js` `BROOD.moves` are merged (`spellsFire.js` also fills `TUNING.attacks[k] ??=` itself,
for a test that loads it without `tuning.js`'s merge), and onto
which `tuning.js` copies each move's combo links from `tuningLinks.js` `LINKS` as
`TUNING.attacks[name].links`). `dragon.hitPlayer` multiplies every blow's damage by
`TUNING.damageScale` (0.85), except hits flagged `bullet: true`. The AI weighs any entry generically:
`ai.js` `attackWeight(def, name, d, sense)` reads `phase` (first phase, on the def or
`TUNING.attacks[name]`), `weight` (a number, `[P1, P2, P3]` or a function of `(dragon, sense)`
returning either; per-phase arrays go through `perPhase(v, phase)`) and `air` (usable while
airborne; no entry sets it today, as every flight, the flying combos included, runs inside one
action). String and single attacks gate their weight on an AI band (`bandWeight`: `range` in model
units × SCALE, `maxAng` / `minAng`); fire attacks, bullet patterns and terrain moves gate on
world-metre distances (`minDist` / `maxDist`) in their own `weight(d, s)`. `TUNING.openingCooldowns`
hold the ranged singles back after the intro. `TUNING.unlockStagger` [first, step, jitter] ([1.5,
1.6, 1.5] s) staggers the abilities a new phase unlocks: in a random order, the i-th gets an opening
cooldown of first + step × i + a random share of jitter (`enterPhase`). Not staggered: the names in
`TUNING.pressure.unlockSkip` (`['nova', 'roar']`: the phase-3 roar queues the nova itself) and any
attack tuned `unlock: false`.

**The director** (2026-11-15, ADR-119; `ai.js`, numbers `TUNING.pressure`): `Brain._choose` is a
weighted pick over every `ATTACKS` entry off cooldown, steered by the director. A designer adding a
move needs to know:
- **Categories.** `ai.js` exports `CATEGORIES` (`melee`, `wing`, `tail`, `fire`, `flight`, `spell`,
  `terrain`) and `categoryOf(name)` (cached): the tuning's or the def's own `category` wins, then
  `TUNING.pressure.category` (tail → tail, stomp → melee, breath / fireball → fire, leap → flight,
  roar → spell), then where it is tuned (a terrain move → terrain; a bullet pattern → fire; a fire
  attack → flight when it has an `alt`, a flying combo's `parts` or `air`, else spell) and, for a
  string, what its hits are: its tail (`tail*` kinds), wing (`wing*`) or fire (`fireSnap`,
  `emberRake`, and any hit with a `burst`) hits make it that category when they are two or more or
  a third of the string (most wins; a tie goes tail, wing, fire), else melee. Today: melee 13, wing 2
  (the Wing buffet, the Sky hammer), tail 4, fire 11, flight 7, spell 10 (the four roar-cast moves of
  ADR-197 among them: `drakelings`, `wisps`, `fireSerpent`, `firestorm`, tuned `category: 'spell'`),
  terrain 3.
- **The pick's weight:** × `repeat` [0.3, 0.65] for the last two picks; × `bias[cat]` per phase
  (melee, wing and tail 1.25 – 1.3); the last pick's category × `sameCat` 0.7, × `overRun` 0.03 once
  `maxRun` (2) picks of it ran in a row; a category absent past `floorAfter` [32, 15, 12] s ×
  `floorBoost` 2.5 × min(3, absent / floorAfter); gap closers (`closers`: charge, pounce, leap,
  skyStrafe, diveBomb, or a tuning `closer: true`) × `closerBoost` 2.2 past `farDist` 15 m; tail
  moves × `behindBoost` 2.5 when the hero is behind it (beyond `behind` 1.75 rad off the nose);
  flights × 0.05 once `maxAir` [0.18, 0.24, 0.3] of the last ~20 s was spent airborne
  (`brain.airShare`); spells × 0.05 while `maxCast` [3, 5, 7] hazards burn. A category absent past
  `floorAfter` × `floorForce` (3) that can be used from here becomes `brain.forceCat`: every other
  category × 0.02 until one of its moves is picked. A category absent past its floor that nothing
  can use from here makes the wyrm move for it (`_startSeek` / `_seeking`, `pressure.seek`: it only
  closes in and turns; the backward bound was removed).
- **Layering rules** (enforced, not weights you tune per move): a spell or a bullet pattern while
  another spell's emitter or any bullet is live × `layer` (0); a move that asks for a guard (any
  normal or blue blow) while a meteor / chase emitter or an ambient cinder is still to land, or a
  move that asks for a dodge (any red or black blow, every flight and spell, a pattern's red orbs)
  while bullets fly × `mixed` (0). What a move asks for is read from its data (each hit's tell, the
  headline tell, `orbs` / `orbWave` / `barkOrbs`) and learned from the cues it really sends.
  **The brood** (ADR-197): live kamikaze wisps count as a sky emitter (`sky` = `_emitterLive()` or
  `brood.count('wisp')` > 0, in `_choose` and in `_link`: they are red blows at times nobody knows yet,
  like meteors), and while any of the brood lives (`brood.count()` > 0) every spell, every flight and
  every move tuned `heavy` × `layer` (0): the wyrm fights lighter beside it. The brood moves and the
  roar-cast spells also gate themselves in their own `weight` (0 while a brood lives; the two spells 0
  while a barrage or a meteor is up, or while the other spell's cooldown has more than half of this
  one's still to run).
- **Combo links.** `TUNING.attacks[name].links = [{ to, when, chance, band? }]` (all of them live in
  `tuningLinks.js`, one table). When a move ends **on its own** (`stopAction(false)`, not
  `aborted`), `Brain._link` takes the first link whose `when` holds for where the hero is now
  (`linkWhen(when, sense)`, exported: `front` ≤ 0.9 rad off the nose, `side` 0.9 – 1.75, `behind`
  beyond, `near` < 9 m from the root, `mid` 9 – 18, `far` > 18, `any`), whose `chance` (a number or
  `[P1, P2, P3]`) rolls, and whose target is usable now (exists, off cooldown, weight > 0 from where
  he stands; `band: false` clamps the hero into the target's own band first) and passes the
  layering rules. It goes into `brain.queued` and starts with no pause, booked like a pick. At most
  `chainDepth` [3, 3, 5] links in a row, then a breather of `chainRest` [0.7 – 1.0, 0.8 – 1.1, 0.4 –
  0.65] s. A move that ended interrupted (parried into a recoil, staggered, broken, plunged) or one
  the hero answered with his own art (`player:flurry`, `player:flareCounter`, `player:counter` set
  `action.answered`) never links: the pause is `pressure.openingGap` (the old idle gap: [1.0 – 1.7,
  0.7 – 1.2, 0.35 – 0.7] s). Otherwise the pause is `TUNING.idleGap` ([0.25 – 0.5, 0.25 – 0.5, 0.05
  – 0.25] s). `brain.queued` is also how a P3 Cinder burst runs into an Ember torrent.
- **The fairness guard** (`pressure.guard`: `sep` 0.3, `margin` 0.05, `maxHold` 0.5, `safeMin` 6,
  `horizon` 1.4, `roll` 4.2). The brain subscribes to `combat:tell` and `combat:flash` (sources
  'dragon' and 'world') and keeps a ring of 32 upcoming impacts with the answer each asks for (the
  cue ledger: a tell's `impactIn`, re-timed by its flash; `_forget(name)` drops a move's own when it
  ends cut short). `Brain._hold(a, dt)`: a melee blow (the strings, bite, swipe, tail, stomp) whose
  flash is due this frame waits, its windup clock held (the pose keeps tracking), while an impact of
  another source that asks for the other answer is due within `sep` + `margin` of its own, at most
  `maxHold` s per blow and only when the wait clears it (`stats.holds`). Live hazard circles are read
  directly too (a blast the hero cannot reach in a roll is no clash).
- **Ambient cinders** (`pressure.ambient`, from phase 2): `_ambient(dt)` drops small red blasts
  (hazard circles, kind 'shell', attack name `'cinders'`, which has no `TUNING.attacks` entry: it
  appears in cues and in `player.takeHit`'s `attack`) from a wing's wrist or the jaws while a ground
  move runs with time left: every `every` [0, 1.4, 0.7] s, `n` [1 – 2, 2 – 3] at a time, `warn`
  [1.2, 1.2, 1.05] s of heated ground, 1.5 – 4.8 m round the hero (`onHero` [0, 0.25, 0.4] of them on
  his led spot), radius [1.6, 1.6, 1.9] m, 14 damage, burn 1, kb 2, at most `alive` [0, 3, 6] near
  him. A cinder never lands within `sep` of a known blow (the ledger, a hazard, the running move's
  beats), never after the running move ends, never during a guard-tell bullet pattern, the breath,
  a string that scatters embers, or while bullets fly, and only where at least `safeMin` of 17 spots
  (his and 16 a roll away) stay clear of every blast due within `horizon` s (`_freeSpots`). When none
  may fall near him they fall `far` (8 – 13 m + their radius) from him with `noBlow`: fire on the
  field, no cue, no blow.
- **Between moves** (`_combat`): it walks at the hero's spot `lead` 0.6 s ahead when he is farther
  than `approach` [12, 11, 10] m, turns at `turnSpeed` × `pressure.turn` [1.15, 1.1, 1.05], and
  through a longer pause near him sidesteps at `strafe` [1.2, 1.5, 1.7] m/s.
- `brain.stats` = `{ links, ambient, holds, picks, floors, seeks?, ambientFar? }` (the PRESSURE
  scenario's meter reads them; its bounds are `pressure.meter`: `ramp` 1.12, `maxGap`, `minRate`).

**Strings** (contract 1, `makeString(name)`): `TUNING.attacks[name].hits` = N hits, each `{ kind,
side?, tell, flare?, windup, hold?: [min, max], active, impact, damage, knockback, knockdown?,
chance?, parryable?, blockable?, burst?, ground?, ...kind extras }` (`side` ±1 = the limb on the
hero's side at the string's start / the other one, **`side: 0`** = the side he is on as THIS hit's
windup starts (a string that spun round with a tail blow strikes from where he is now); `hold` = a
random extra windup hold that baits an early parry; `chance` < 1 = rolled at the string's start;
`burst: { phase?, n, wait, stagger, speed }` = embers scattered where the hit lands
(`bullets.burst`, from `phase` on); `ground: { phase?, w, linger, tick, tickDamage, burn, delay }` =
the burning ground a fire blow leaves: a hazards strip of kind `'meleeFire'` with `noBlow: true`,
contact ticks only), plus the string's `recovery`, `cooldown`, `weight`, `phase`, AI band `range`
[min, max] and `maxAng` / `minAng`. The phase list is per hit `windup{N}` (windup × `tScale` + hold)
and `active{N}`, then `recovery`. Every realised hit gets a beat (`combat:tell` at its windup start,
`combat:flash` `flashLead` before its impact, holds included) carrying `{ hit, wi }`. **The KIND
contract** (`KINDS`, attacks.js): a kind is an object with `part` (the striking part for the flash,
`Dragon.partPos`; `wi` picks a paw or a wing) and optional hooks: `init(d, a, h)` once at the
string's start (per-hit scratch on `h`), `enterWindup(d, a, h)` at the hit's windup start, before its
`combat:tell` (it may re-time `a.beats[h.idx]`; `side: 0` is resolved here), `windup(d, a, h, k, dt)`
(k over the base windup, held at 1 through the hold; `h.holdK` through the hold), `aim(d, a, h)` as
its active starts, `active(d, a, h, k, dt)`, `endActive(d, a, h)` (slams that land at the end: stomp,
hop), `recover(d, a, h, k, dt)` (blended into the next hit's windup, or the recovery), `hit(d, a, h,
stage, k, dt)` after the rig every frame of the hit, `zone(d, a, h, out)`, `noBreakActive`, `end(d,
a, h, interrupted)`. The kinds: claw, overhead, bite, rearBite, lungeBite, wing, tailJab, tailSweep,
hop, stomp and, since ADR-119, `wingSweep` (a wing scythed down and across the front while the body
pivots: `face`, `sweep`, `amp`, `spread`, `room`, `backSpeed`; part 'wing'), `wingSlam` (both wings
brought down in front: `radius` round the slam point, locked `near` .. `far` model units ahead;
part 'wings'), `tailWhip` (a pivot puts the hero `at` rad off the nose, then a short `spin`;
`pivotRate`, `minReach`, `reach`), `tailSlam` (the tail raised `lift` × its arch and brought down
along a line `width` model units either side), `fireSnap` (jaws open into a gout of fire: ticks of
`tickDamage` every `tick` from `impact` over a cone of `range` / `halfAngle`, tracked at `track`
rad/s after a `turn` rad/s whirl in its windup; set `parryable: false, blockable: true`) and
`emberRake` (a claw whose raked arc burns from `ground.phase`). The string's `hit()` skips a hit
whose beat is not the current one (the next hit's beat may arm a float hair early on the last frame
of this active). A string def carries `string: true`, `melee: true` and `noBreak(a)` (a break waits
out the pounce's hop). Their effects are `meleeFx.js` (`snapFire` and the slams' dust and fire, plain
functions over `d.fx`). Data rules (STRINGS / TIMING scenarios): a tell per hit, the first windup ≥
0.7 s, ≥ `TUNING.minHitGap` 0.45 s from one impact to the next, each contact within ±85 ms of its
flash + lead (the TIMING verifier probes 20 attacks: 16 strings, every one but the Cinder flurry,
and the bite, swipe, tail and stomp; MELEE checks the six new kinds).
**Deflect chain** (contract 1, `onParried`): a parry of the running action's own hit (`attack` null
or the action's name) reads `hit` from the current beat; `last` = not a string, or its last realised
hit. It emits `dragon:parried {attack, tell, hit, last}`; in a string it counts `action.chain` and
emits `combat:deflectChain {count}` from 2. A non-final hit is deflected: `POSTURE.parry` posture and
a knock-back of the struck part (`_startKnock` → `applyDeflectKnock(dt)` at the end of
`Brain.update`: the paw override / head offset thrown out and back over `TUNING.deflectKnock.time`
0.14 s; visual only, no timing change); the last hit (or a single melee attack) recoils
(`brain.recoil()`). `strike()` resets `action.chain` when a hit lands or is blocked (dodges keep it).
**The plunge, dragon side** (contract 2, `onPlunge`): only while targetable; a repeat within 0.25 s
is ignored. `takeHit({ damage, part: 'head', heavy, crit, exact: true, posture: 0 })` (the damage is
final; the phase gate holds). Unless the running action is in `NO_PLUNGE` (intro, phase2, phase3,
death: the damage lands, no reaction), the red glow drops and `brain.plunged({ air, alt, heavy })`
cancels the action and starts `SEQ.plunged` (air = `state === 'airborne'` or the rig's altitude >
1 m; heavy = an execution on a broken wyrm). While it stops a flight `d.crashing` is true, so the
flight's `end()` does not land the wyrm elsewhere (the leap honours it; the fire flights only drop to
'combat') and the wyrm falls from where it was hit. `SEQ.plunged`: [`fall` (~0.6 s, longer from
higher up) + the crash landing (dust ring, shake, `dragon:land`)] → `slam` 0.3 → `thrash` 0.6 →
`rise` 0.45 s (an execution 0.35 / 1.15 / 0.5); the head stays on its joints, so `plungePoint` keeps
tracking it for the rider. The hurt flash is capped at `TUNING.plunged.flash` 0.45 (the impact's
hitstop freezes its decay). A plain plunge then adds its posture (a full meter breaks once the
reaction is over: `NO_BREAK` holds `plunged`); an execution interrupts the posture break, whose end
consumes it (`broken` false, meter 0). A pending phase transition waits for the reaction
(`NO_TRANSITION`).
**Three phases** (contract 4): phase n starts at `phaseAt[n − 1]` of max HP. `takeHit` clamps the HP
at `nextPhaseHp` while the AI runs and sets `brain.pendingPhase` (the phase to enter, 0 = none) once
the gate is reached; `Brain.update` starts `SEQ.phase2` / `SEQ.phase3` when the wyrm is in combat or
staggered, not broken, the AI is on and the running action is not in `NO_TRANSITION` (intro, the
transitions, death, plunged). The transitions are `makeRoar(name, toPhase)` (attacks.js; always P1
timings): `start` calls `enterPhase(toPhase)` and `hazards.clear()`, the roar announces
`dragon:phase2` / `dragon:phase3` + `dragon:phase {n}` and sets the crack glow (`TUNING.phaseGlow`);
the shock ring is red (the phase-3 roar's `shockRing(x, z, r, calm = true)`: its front's fire and the
glow it leaves on the ground held low so the ignition reads) and the phase-3 roar calls
`d.ablaze?.ignite()`; `end` queues `ATTACKS.nova` after the phase-3 roar when the AI runs.
`enterPhase(n)` queues the next transition at once if the HP is already past its gate (Lab, AI off).
Per-phase tuning (`[P1, P2, P3]`, read with `perPhase`): `turnSpeed`, `walkSpeed` [3.6, 4.6, 5.3],
`phaseTimeScale` [1, 0.82, 0.7] (windups and recoveries; `tScale`), `idleGap`, `phaseGlow`,
`phaseEmbers` (body embers / s), `posture.max`, `rest.jaw`, attack weights and link chances, and most
of `TUNING.pressure` (the director above). Phase-2 values of the singles (`activeP2`, `sweepP2`, the
3-shell volley, the leap) apply from phase 2 on. `phase2At` / `phase3At` / `phase2TimeScale` are kept
for older readers.
**Flights** (contract 3, short flights inside one action, ADR-030): `takeOff` sets `state =
'airborne'` (`dragon:takeoff`; body circles empty, a stagger or break waits), `touchDown` returns to
'combat' (`dragon:land`). Flights stay ≤ 16 m up (the tests see ≤ 13.5 m) and inside the bound; the
hurt spheres ride the drawn body, so a flying wyrm is out of sword reach (lowest sphere 5.3–10.1 m in
the tests) and only the plunge reaches its head.
**The body against the world** (2026-11-15, ADR-119; it replaced ADR-107's trample round the root,
which never reached a trunk): `dragon._wreck(dt)` runs every frame after `_refreshHurt`. Each hurt
sphere that moved faster than `TUNING.world.body.minSpeed` (1.6 m/s) sweeps the pieces it passed
through (`destructibles.sweepRec`, a segment from where it was to where it is, at its height:
a sphere whose bottom is above `maxY` 12 m, or above a low piece, passes over), with power (speed −
minSpeed) × `perSpeed` 0.17 × its part's `mass` (head 0.7, neck 0.8, body 1.9, tail 1.1, wing 0.8,
leg 0.9), at most `max` 2.2. Every such sweep is a **brush** (`o.brush`, `BREAK.brush`) and
**incidental** (`o.incidental`: a piece reserved with `destructibles.reserve`, or the running
action's own `action.piece`, passed as `o.spare`, is left alone). On top: the wings' blast as it
leaves the ground (`takeoff`: wood only), each downbeat under `downbeat.maxAlt` 11 m (wood only,
weaker the higher), and the landing after a flight at least `landing.minFall` 2.5 m high (its weight:
stone too). A frame that moved a sphere more than `body.jump` 6 m is a teleport; after the root is
teleported the body settles `body.settle` 0.6 s first. `_collide` resolves the root with `soft:
true`, so breakable wood never turns it (it is felled as the body goes); stone still does. No
per-frame allocation (one reused record per kind of blow; world.mjs BUDGET checks it).
**Its reach into the tree wall** (2026-11-16, ADR-120; `wallReach.js`, numbers `TUNING.world.wind` /
`TUNING.world.carry`): the wyrm fights inside the clearing; two calls carry what it does out to the
trees round it, through the world's own API, guarded and allocation-free. Neither touches the hero (no
blow, no fire on his ground, no tell; every attack's hit, damage, timing and tell is unchanged).
- `wallWind(d, x, z, key, k = 1)` → `destructibles.wind(x, z, power × k, reach, { from, fall })` from
  `TUNING.world.wind[key]` = [power, reach m, from m, falloff (0: `BREAK.wind.fall`)]: `roar` [0.3, 32,
  0] (`roarFx(d, strength, wind = 'roar')`, × its strength), `phaseRoar` [0.22, 58, 0, 1.0] (the
  transition roars), `shock` [0.35, 26, 0] (`fx.shockRing`), `takeoff` [0.4, 26, 0], `landing` [0.5,
  28, 0], `downbeat` [0.16, 20, 26] (`dragon._wreck`, × the beat's strength), `buffet` [0.4, 26, 0]
  (the wing buffet's downstroke; the wing sweep × 0.75), `ground` [0.22, 22, 0] (`fx.groundShock`, × its k).
- `carryFire(d, x, z, dx, dz, key, y = 1.2)` → the piece or null: `destructibles.carryFire(x, z, dx,
  dz, len, k)` from `TUNING.world.carry[key]` = [length m, at most every s (per key, `d._carryT`), burn
  k, streak blobs]: `breath` [24, 0.35, 0.9, 10] (past the end of the breath's cone), `strip` [20, 0.3,
  0.9, 6] (the burning pass's front), `wall` [18, 0.25, 0.8, 6] (a flame wall, forward), `ring` [16,
  0.3, 0.8, 4] (a flame ring, outward), `shot` [22, 0.2, 0.7, 4] (a launched bullet that times out or
  leaves the bound, `bullets.js`), `meteor` [0, 0, 0, 0] (none). When a tree is reached, a streak of
  heat runs to it in the fire field.
**The wyrm ablaze** (phase 3; 2026-11-16, ADR-120; `ablaze.js` `class Ablaze`, `dragon.ablaze`,
numbers `tuningAblaze.js` `ABLAZE`; COMBAT.md "Three phases"): the phase-3 roar's beat runs fire out
from the chest along the wing arms, the legs and the tail, it flares at every end, and from then on
flames stand on its wing tips (8), the trailing edge between them (6), its four claws and the last
third of its tail (`tailFrom` 0.66) with a larger flame at its tip; look c adds both horns (read
from `heads.js` `HORN_TIPS` through `headVis.matrixWorld`) and the spine's crest. Every flame is heat
in the fire field (`game.fx.fire.spawn`, keeping `inherit` 0.18 of the part's velocity, so a fast
move leaves fire along its path); embers are glyph particles.
- Looks: `?ablaze=off|a|b|c` (read once; default `b`, the owner's pick), `ablazeLook()`,
  `setAblazeLook(k)`, `dragon.debug.ablaze(look)`, the Lab's "Ablaze" button (FIGHT section). `ABLAZE.looks[k]` holds
  `k`, `rate`, `size`, `life`, `rise`, `trail` (b, c: extra fire along a part moving faster than 7 /
  6 m/s), `prints` (b, c: burning footprints and the tail's drag), `horns`, `crest`, `embers`, `light`.
- Life cycle (`mode`: 'off' | 'igniting' | 'burning' | 'dousing'): `ignite(fast = false)` (the roar:
  `ignite.delay` 0.45 s after the ring, a run of `time` 1.1 s, then the flare: 70 embers, shake 0.32,
  punch 0.6, a pooled light); a phase 3 entered any other way lights by itself in `fast` 0.45 s; it
  gutters to `gutter.level` 0.28 through a stagger, a posture break and the plunge's reaction;
  `douse()` on dying (1.5 s, the ends first); `reset()` puts it out (`dragon.reset()` and
  `finishDeath()` call it).
- The world: wood a burning part passes below `wood.maxY` 6.5 m while moving at least 3 m/s catches
  (`world.ignite(x, z, 0.9, 0.7, false)`: wood only, 6 sites tried a frame, each at most every 0.12
  s, at most `perMin` 5 a minute, inside the world's caps); `dragon.onStep` → `ablaze.step(x, z,
  hind)`: in looks b and c a planted claw alight chars the scorch map (`burnCircle`, r 0.6 / 0.8 m)
  and a few small low flames flicker there 1.6 s (10 slots). It never calls `world.fire`.
- Readable: it subscribes to `combat:flash` (source dragon): for 0.55 s the fire within 3.5 m of the
  cue burns at 8 %, rising to 65 % at 8 m, and the dim starts 0.15 s before each told beat; a red / black body glow dims all of it by
  up to 50 %; a flame within 3 m of the hero burns at 40 %.
- Budget: at most `cap.perFrame` 90 blobs a frame (180 while it ignites); past 3300 blobs in the field
  the body's fire scales down, to none at 4200. Its own random stream (a seeded fight is the same
  with it off or on); no allocation per frame.
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
(`[phase-1 ember, × glow (later phases / death), × throat charge]`, the glow target per phase
`TUNING.phaseGlow` [0, 0.5, 0.8], applied in `_applyMaterials`; every
`model.mats` key needs a `model.glow` row except `eye`, which follows `rig.s.eyes`); the art
source's veins, cracks and gap glow scale with it.
Visual-only geometry on gameplay joints: every head mesh hangs on `model.headVis`, scaled
`HEAD_VIS` (1.3) about the mouth point, while the gameplay joints `head` and `mouth` (the bite /
charge spheres, the breath / fireball origin) are unscaled; `rig.pt.eyes`, `pt.nostrils` and
`pt.jawTip` follow the drawn head. The drawn tail radius (`tailRV`) is thicker than
`model.tailRadii`, which stays the chain's ground clearance (read by the rig and the tail sweep).
**The build** (2026-11-20, ADR-123; `looks.js`): `?wyrmLook=0|a|b|c` (read once; default `c`, the
owner's pick: lean, a fierce head carried high, a mane of quills; `0` = the wyrm before, `a` / `b`
the steps between). Exports: `WYRM_LOOKS`, `WYRM_LOOK_SHIPPED`, `wyrmLookId()`, `wyrmLook()` (the
build's numbers or null for `0`), `setWyrmLook(k)` (the NEXT built wyrm; tests, `GCD_WYRMLOOK`).
A build changes what is drawn and nothing else: `buildDrake` bakes the trunk's and limbs' meshes
into their joint's frame and scales them there (`slim`, `slimBone`), scales the neck's and tail's
drawn radii, spine, quill and talon lengths, `headVis` (its size and width) and the old head's
horns, fangs and frills (`buildOldHead(headVis, mats, build.head)`). No joint moves and no draw is
added. `buildDrake` returns `build` and `hornTip` (the built main horn's tip in headVis's frame,
null for a sculpted head; `ablaze.js` reads it before `HORN_TIPS`). The one thing a build has
outside the model is `rest` (`{ neck: { pitch0, pitchStep, pitchCurve }, headDip }`): `rig/anim.js`
reads it where it read `REST_POSE.neck` / `REST_POSE.headDip`, weighted by the resting weight, so
attacks keep their measured head.
**The glare** (2026-11-21, ADR-127): a head's `eye` may be `{ c, rot, leaf: { len, h, slant, peak,
thick } }` (an almond swept along a slanted line, `heads.js` `eyeMesh`) in place of `r` (an
ellipsoid); the drake's is. **Model built** (ADR-127): `Dragon` and `Player` call
`game.onModelBuilt?.('dragon' | 'player')` right after building their model; nothing in the game sets
it, the headless sims (`integ.mjs`) reseed their random stream there.
**The face** (2026-11-20, ADR-124; `heads.js` + `faces.js`): `?wyrmFace=` (read once; default `drake`,
`WYRM_FACE_SHIPPED`, the owner's pick; `old` = the head before, `model.js` `buildOldHead`; `skull`,
`loong`, `demon` (ADR-120) and `tyrant`, `viper`, `revenant` were shown and passed on). `faces.js`
holds the four faces of 2026-11-20 and registers them into `heads.js` `HEADS` / `FACE_ART` at import
(`model.js` imports it). A sculpted head's data may carry `paint` / `paintJaw` (rules that move loft
triangles to another material: `{ key, from?, z?, y?, c?, r?, except? }`), `teethOpt`, `nape` (the
crest's and mane's lengths over the last neck segments, nearest the head first; `faceNape()`, read by
`buildDrake`) and extras that return `hornTip`. `createDragonMaterials` adds `pit` (the hollows) and
`mask` (bare bone) only when the face's `FACE_ART` has them. `buildHead` returns
`{ eyes, nostrils, jaw, whiskers, hornTip }`.
**Heads kept for later** (2026-11-16, ADR-120; `heads.js`): before ADR-124 `?wyrmFace=old|skull|loong|demon`
defaulted to `old`. The owner passed on those three sculpted heads; they stay behind the switch, like
the hero's looks (ADR-089). Exports: `WYRM_FACES`, `wyrmFace()`, `setWyrmFace(k)` (the NEXT built wyrm; tests, the
Lab's "head" row, which reloads the page), `FACE_ART` (per head, art entries merged over `WYRM_ART`
for its parts), `JAW_PIVOT` [0, -0.15, 0.05], `HORN_TIPS` (per head, the main horn's tip in
headVis's frame: ablaze look c's horn fire), `sculptLoft`, `bentPath`, `sweepTube` and
`buildHead(face, headVis, mats)` → `{ eyes, nostrils, jaw, whiskers }`. `buildDrake` returns `face`
and `whiskers`; the loong's two whiskers are `Chain`s sprung by `rig/anim.js` `_updateWhiskers`
(`WHISKER`), none for the other heads. The gameplay joints `head`, `mouth`, `snout` and `jawTip` sit
where the old head's are for every head; the drawn eyes and nostrils follow each head's anatomy.
Wing membrane (membrane.js): `new WingMembrane(material, side, restKey)` — 4 Coons panels rebuilt
from the bones every frame (allocation-free); `aGUV` is laid out once from `restKey`
(`WING_KEYS.HALF`, so changing that key re-lays the membrane's texture), so the grid is even in the
resting pose. Two static per-vertex attributes feed the `wyrm` membrane source: `aEdge` (0 inside →
1 on the free trailing edge) and `aBone` (model units to the panel's nearer bone). Trailing-edge
scallops `SAG` [0.3, 0.28, 0.24, 0.16] plus torn `RAG` notches. Resting body language
(`TUNING.rest`): wings `spread` 0.5 (HALF) in every phase, ≤ 0.3 while walking; jaw [0.65, 0.85,
0.95] per phase, the painting's snarl (visual only); attacks return to `TUNING.rest.spread`.
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
'forefeet' (front-paw midpoint; flashes at both paws; 'wrists' is the v0.3 alias), 'wing' (a wing's
middle knuckle, `b.wi`: the wing buffet, the wing scythe), 'wings' (between both wings' middle
knuckles: the wing slam), 'tailTip', 'shell', 'bullet', 'piece' (the tree or boulder a terrain move
holds or has thrown), 'point' (ADR-197: a beat that carries its own place, `b.px` / `b.py` / `b.pz`, the
serpent's head, the firestorm's foot; the chest when they are not finite), default chest. `flashTell` spikes the body's red / black `uWarn` for a dodge-only
blow except when the part is 'piece': a thrown piece's flare is on the piece, the body that threw it is
not the blow. The stomp's red ground ring is centred between the two forefeet's landing
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
- `headExact` (bool): the head aims without the `HEAD_AIM_RATE` (11 rad/s) turn limit, at most
  `HEAD_EXACT_RATE` (45 rad/s: a bite's first frame turned the head alone 75°; ADR-203). Set on
  the frames whose hit spheres ride on the snout / mouth: bite and combo-lunge active, charge
  active, breath active, fireball.
- `headLead` (Vector3, world): an offset of the SHOWN head only. `strikeLead` (attacks.js) sets it
  over the last three windup frames of the bite and the claw combo's lunging bite (12 / 30 / 55 % of
  the strike's first step), so the head accelerates into the snap. No hit test runs in a windup;
  active frames are untouched (ADR-025).
- `drape[2]` 0..1 per wing: the wing collapses onto the ground beside the body, in world space
  (dying; the chest frame rolls with the body).

Rig additions for the flights (2026-11-09; used with `alt` / `airborne` / `flap` / `flapHz`):
- `hover` 0..1: hind legs hang straight down (swaying), forelegs reach down with the claws ready, the
  tail hangs from the tilted body and curls back up toward the tip, and the wingbeat sweeps fore and
  aft (the wrists come forward on the downstroke).
- `glide` 0..1: the wings blend toward `WING_KEYS.GLIDE` (arms nearly level, a ~27° dihedral, the
  fingers fanning the sail out flat, so from the 58° camera the membrane faces up; span ~34 m).
- `dive` 0..1: the wings blend toward `WING_KEYS.DIVE` (the stoop: arms tucked back and up, fingers
  swept back along the body), the tail streams straight.
- `altRate` (default 12/s): the smoothing rate of `alt`; a dive sets it high so the body meets the
  ground on the impact frame.
- In the air every downstroke heaves the body up, and the tail streams back as a rudder a little
  below level (held at 34° down, the 15.6 m tail reached the sword band from a 7–8 m flight).
- The deflect knock-back (`applyDeflectKnock`) adds to `pawOv[i].pos` (claw / forefeet hits) or
  `headOffset` + `pitch` (bites, wings, tail) after the action wrote the pose.

Two neck solves (ADR-025): `rig._neckSim` is the measured solve every attack's head path and hit
spheres were tuned on; `rig.neck` is the shown chain (applied to the joints, read by the neck hurt
spheres), blended toward the resting S by `s.rest`. While an attack drives the head (`s.rest` <
0.03) the shown chain swings toward the measured head (the head's step spread down its length,
`NECK_FOLLOW` 0.45 toward the measured shape) and the head joint is pinned to the measured solve
(`Chain.endQuat`), so the snout / head / mouth points are the measured ones (≤ 9 mm, float noise).
The pin is released only while `headLead` is non-zero. A shown chain that misses the measured head by more
than `SWING_MISS[0]` × scale takes the measured shape, all of it from `SWING_MISS[1]` (a strike's
first frame moves the head metres: FABRIK under the bend limits buckled the shown neck 2 m to one side
and left the pinned head 3 m from its end; ADR-203).

Where the head looks and how it is held (ADR-203, `_updateNeck`; `?neck=c|b|0`, default c):
- c: it looks where its move points it, over a shoulder at most `HEAD_YAW_MAX` (2.35 rad, in the
  chest's frame); a foe straight behind is watched over the shoulder it was on until he is
  `HEAD_SIDE_SWAP` past straight back on the other side; a look point nearly straight overhead
  (`HEAD_STEEP`) takes the chest's heading. Nose-up it stops at 0.6 rad unless the look point itself is
  set high (`HEAD_LOOK_UP`: the meteors' roar to the sky).
- c: it is held upright about its own snout against its own body (the chest's up; the sky's at rest)
  in every move while awake. The correction is unwrapped against the last frame, moves at most
  `HEAD_LEVEL_RATE`, and holds where 'up' lines up with the snout (`HEAD_LEVEL_CONF`). Driven, the
  shown neck takes the same roll spread down its joints (`Chain.apply(parentQ, out, twist)`: each joint
  turns about its own bone, no point moves); resting, only what passes `HEAD_ROLL_REST`.
- b (the first pass): upright against the sky, the heading held while the look point is under or
  over it. 0: as before ADR-203 (level at rest only, against the sky).
- c and b: while the hero's flurry runs (`player.state === 'flurry'`: the perfect dodge's answer and
  the riposte) the wyrm loses him: `Dragon._sensePlayer` keeps `sense.pos / chest` where it last saw
  him (`vel` 0; `dist / yawTo / ang` from that point), so neither its head nor its body chases each
  blink; once he stops it finds him at its own turn rates. 0: it tracked every blink.

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
  `apply(parentQ, out, twist = 0)`: `twist` rad of roll spread evenly down the chain (ADR-203).
  `aimJointStable` keeps a joint's twist continuous near the −Z singularity (no 180° wing flips).
- `solveTwoBone(A, T, l1, l2, pole, outMid, outEnd, bend = null, soft = 0)` (rig/ik.js): `bend`
  (per limb, persistent) keeps last frame's bend direction when the pole runs along the limb; `soft`
  (the wing arms: 0.05) eases the last stretch toward full extension.
- Hurt spheres follow the arched resting tail: its first spheres sit ~3–4.5 m up, so a hero behind
  the wyrm hits hips and legs more and the tail less.

Damages the player only via `game.player.takeHit(...)` with tell data; announces tells with
`combat:tell` / `combat:flash` and shows them on its own body (no HUD marks):
- **moments are cued by the flare (ADR-118; COMBAT.md "Tell presentation")**: `fx.tellFlash(tell, x,
  y, z, flare)` → `DuelFx.tellFlash(tell, x, y, z, k, flare)` draws the flare for a red or black
  blow and for a blue one whose beat says `flare` (`rules.js` `isFlare`), else the white glint. One
  flare per cue (a blow of both forefeet is one streak), kept inside the frame.
- **the red trail (`?redTrail=a|b`, ADR-271; `combat/redTrail.js`, numbers `TELL_STYLE.red.trail`)**:
  `DuelFx.tellFlash` of a red cue opens a window to the cue's `flashLead` + `follow` s (any other cue
  closes it); inside it `DuelFx.sweep` lays one line of fire at a low heat just outside the tip's path.
  Every blade that cuts through `sweep` (Shen Hui, the Lord, Lu Wusheng) gets it with no code of its own.
- red (dodge-only) hits: nothing through the windup (`TELL_STYLE.red.warn` from = to = 0; until
  ADR-118 `uWarn` ramped 0.1 → 0.38) and no heat on the ground under its own area
  (`TELL_STYLE.red.floor` false: `Brain._warnZone` returns at once). On the cue `uWarn` on every
  material (`model.mats`, driven in `_updateWarn`) spikes to 1.6 and decays to 0 in 0.25 s (game
  time). A replaced action (stagger, posture break, parry recoil, plunge reaction, death, Lab
  interrupt) drops it at once; `reset()` and death zero it. An action with a red glow but no blow of
  its own (Armageddon's rear-up and salvo) sets `dragon.bodyWarn` 0..1 every frame: a 0.1 → 0.38
  ramp of its own (`BODY_WARN`), read and zeroed by `_updateWarn`.
- black (charged) hits: through the windup `Brain._charge` draws the charge on the striking part
  (`fx.charge` → `DuelFx.charge`, which beats the blackout) and emits `combat:charge` once; `_updateWarn` ramps
  `TELL_STYLE.black.warn` (x `BLACK_BODY` 0.16 on a body this size; `dragon.warnRGB` is the colour
  written to `uWarn`).
- a blue hit marked `flare` (a parry moment): `hitPlayer` passes `flare` and holds the blow as a
  last one; `onParried` recoils the wyrm wherever in the string it came (`dragon:parried { last,
  flare }`).
- parryable (normal / blue) hits: nothing during the windup; on the flash a white glint (star core,
  four-point sparkle, short rays, small white light) at the striking part, ×1.5 for blue.
- parries throw white/gold sparks (bigger for blue).
- fire hazards draw a red glyph ground warning from spawn to impact (see Hazards); the
  self-announcing ones (meteors, chase pillars) send their own `combat:tell` / `combat:flash` with
  `hazard: true`.

**Hazards** (contract 3; `src/entities/dragon/hazards.js` `class Hazards`, internal to the dragon
module: `dragon.hazards`): pooled world-space fire threats (48 records, 8 hit-cap groups) that live
on their own, independent of the wyrm's current action, so it can fight while meteors fall.
`dragon.update` calls `hazards.update(dt)` every frame (guarded: an error clears the field, never
throws); the field is cleared on `reset()` (`fx.reset()`), on every phase change, when dying / dead
/ asleep, and by the transition roars. No per-frame allocations (pooled records, reused hit /
event scratch).
- Spawns return `{ slot, id }` (a reference; `get(ref)` → the live record or null) or `null` when the
  pool is full (the hazard is dropped). Common options: `kind`, `attack` (the name the tells and
  `takeHit` carry), `delay` (s to impact), `damage`, `burn`, `knockback`, `knockdown`, `announce`
  (default true), `group` (a hit cap from `group(maxHits)`).
- Shapes (`SHAPE`): `circle({ x, z, r, active, fall, from, drawShell })` (a meteor falling from
  `from` over its last `fall` s, a lava pillar, a barrage shell: one blast at impact, hitting for
  `active` s); `strip({ ax, az, bx, bz, w, speed, linger, tick, tickDamage, tickBurn })` (a fire
  front runs A → B; the ground it passed burns `linger` s); `ring({ x, z, r0, r1, speed, w })`
  (ignites at r0, expands to r1); `wall({ x, z, dx, dz, len, w, speed, dist })` (sweeps along its
  normal); `line({ ax, az, dx, dz, n, step, r, stagger, active })` (lava pillars erupting one after
  another); emitters `rain({ count, first, span, warn, warnLed, ledEvery, lo, hi, r, fall })`
  (meteors round the hero, every `ledEvery`-th on his led position), `chase({ every, until, warn,
  lead, r, active, linkFirst })` (pillars under the led hero) and `barrage({ waves, perWave,
  waveGap, stagger, first, glowAt, warn, warnLed, ledEvery, ledGap, lead, r, fall, fallY, size,
  damage, burn, knockback, group, crater, tickDamage, tickBurn, safeR, cover, finale })`
  (Armageddon, ADR-053: waves of meteors over the whole clearing falling from the sky above the
  wyrm, then `finale` { delay, radius, warn, damage, burn, knockback, fall, size }: one great
  meteor on the hero, outside the hit cap; from `glowAt` it drives `world.atmosphere.skyGlow`).
  The wave placement is pure and exported for the tests: `placeWave(n, r, rng, hx, hz, pts, safeR,
  cover)` (jittered-stratified over `ARENA_R`, no two footprints overlapping by more than `OVERLAP`
  = 1/3 of one, at most `cover` of the hero's `safeR` disc covered), `leadInto(pts, k, n, r, cx,
  cz, hx, hz, safeR, cover)` (a led meteor takes the hero's led position only if both rules
  still hold), `coverage()`, `overlapShare()`, `ARENA_R`.
- `circle()` also takes `size` (drawn scale), `great` (the biggest impact), `dark` (no light of
  its own) and, for meteors and lava pillars, `craterBurn` s + `tickDamage` / `tickBurn`: the crater
  or the pillar's ground burns on with contact ticks like a burning strip (blockable, never while
  rolling). A circle of kind **`'pool'`** is only that: burning ground with no blow of its own
  (eruption pools). The pool holds 64 hazards.
- **`noBlow: true`** (circle, strip; 2026-11-15): the hazard deals no blow and sends no cue
  (`announce` is forced off), its fire is drawn as ever and a strip still deals its contact ticks.
  Used for the ground a fire blow of a string leaves burning (kind `'meleeFire'`, from the hit's
  `ground` data: the blow was the string's own) and for ambient cinders that fall out of the hero's
  reach. A `noBlow` strip lights one low light instead of two. `Brain._clash` and `_freeSpots` skip
  `noBlow` hazards.
- `line()` and `chase()` take `pool` (s each pillar's ground burns on; `line` also `poolR`, its
  radius, default 0.8 × r), `tickDamage`, `tickBurn`: the eruptions' burning pools from phase 2.
- `barrage()` also takes `deckAt` (s after the cast when the sky deck starts; default `glowAt`),
  `deckGrow` (s to spread over the frame) and `cx`, `cz` (where it spreads from: over the wyrm's
  cast): it calls `skyFx.skyDeck` every frame from `deckAt`.
- **Every fire comes from the wyrm** (2026-11-25, ADR-197; `fireTrails.js`, numbers `tuningFire.js`
  `TRAILS`): options that make a hazard visibly travel from the wyrm to where it burns.
  - `line({ ..., crack: true, cx, cz })` and `chase({ ..., crack: true, cx, cz })`: a glowing crack
    opens from (cx, cz) (the eruptions pass the forefeet's slam point). On a line its head reaches each
    pillar as it bursts. On a chase its head runs out at `TRAILS.crack.speed` 18 m/s to the led hero
    (inside `arenaAt`), and the first pillar is laid where it catches him (within `arrive` 0.3 m, or
    wherever the head is after `maxRun` 1.6 s); from there it follows him at `follow` 9 m/s and every
    pillar (`every` s) bursts at the head; `until` counts from the catch. The crack's run is part of
    the chase's tell: the first pillar waits for it, and **`timeTo(ref, ...)` on a CHASE** returns the
    run still to go (from the hero's led spot, capped by `maxRun`) plus the pillar's `warn`, then the
    first pillar's own time once it is laid (without a crack: `warn` less the time run).
  - `wall({ ..., lay: { s, at, speed, run? { x, z, at, speed } } })`: the wall's line is laid from the
    wyrm's fire: its warning (`fx.heatBand`) shows only over the stretch laid so far, growing both ways
    from `s` (m along it from its centre) from `at` s at `speed` m/s (raised so it is laid whole by its
    ignition), with a flame at each end of the laid stretch (`layFront`). `run`: a runner first carries
    the fire over the ground from (x, z) to the line's point `s` (from `at`, at `speed`).
  - `circle({ ..., lob })`: a meteor's fall arcs `lob` m over the straight line from its `from`.
  - The barrage asks `skyFx.skyFeed(fx, k, d)` every frame from half its `glowAt` (the wyrm's fire in
    the sky: `?meteorSource=a` seeds along the top of the frame, `b` a vortex over its back fed by a
    column of heat; `off` nothing), and lays each meteor `from` `skyFx.skyFrom(fx, tx, tz, great, out)`
    (true: out is the seed nearest the spot or the vortex's rim toward it, its heart for the great one;
    the fall is then `TRAILS.meteor.fall` 1.35 s at most (× 1.15 the great one) on a `lob` 2.5 m arc;
    false: the old slant from the sky over the wyrm). `METEOR_SOURCE` (skyFx.js) is the switch in use.
  - `fireTrails.js` (plain functions over the wyrm's `DragonFx`, state on `fx._trails`, 8 trails of 96
    points, its own LCG, never `Math.random`): `trailStart(fx, x, z, kind 'crack' | 'runner', power)` →
    a handle or null, `trailHead(fx, ref, x, z)` (the crack opens behind the head, a point every `step`
    0.7 m jagged `jag` 0.32 m aside, a floor mark `world.groundBlow` kind `cut` every `markEvery` 2 m),
    `trailRelease(fx, ref)` (it cools out over `glow` s; its marks stay), `trailInfo(fx, ref)` (tests),
    `trailUpdate(fx, dt)` (from `hazards.update`), `trailReset(fx)` (from `hazards.clear`), `layFront`,
    `trailRand` (skyFx's sources share it). Switches read once: `WALL_SOURCE` (`?wallSource=a|b|off`),
    `CRACK_ON` (`?crack=off`), `TRAILS_OFF` (`?fireTrail=off`: all of them, the meteors' source too).
    A hazard's trail is released when it is killed. Phones draw `phoneK` 0.6 of a crack's blobs.
- Also: `cutStrip(ref)` (a knocked-out pass stops its front; the burnt part lingers), **`cancel(ref)`**
  (takes back a hazard that has not gone off: a strip not yet started, a circle not yet fired; a
  flying combo knocked out of the air drops its unbreathed strip and its unspat shells; a burning
  strip or a fired circle stays), `timeTo(ref, px, pz, vx, vz, pr)` (s until the hazard reaches a
  moving point: the spawning attack re-times its own flash with it), `count(kind?)`, `clear()`
  (also `skyFx.skyReset`).
- `hazards.update(dt)` first calls `skyFx.skyUpdate(d.fx, dt)` (the salvo's columns and the sky deck;
  guarded on its own). Meteors are drawn by `skyFx` (`skyMeteor`, `skyImpact`, `skyCrater`); barrage
  shells and the ambient cinders still by `fx.meteor` / `fx.shellImpact`, pillars' pools and `'pool'`
  circles by `fx.crater`.
- Every hazard heats the ground under it until it goes off (ADR-052: `fx.heatDisc` / `heatBand`,
  no red rings; the edge shows in the last `flashLead` s), then deals its one blow through
  `dragon.hitPlayer({ ..., tell: 'red', parryable: false, blockable: false, plunge })`: i-frames or
  leaving the area avoid it. `plunge` is the spawn option `plunge` (default false: a perfect dodge
  gives the slow-mo in place). Fire the wyrm breathes or spits from the air spawns with `plunge: true`
  (the burning pass's strip front, the hover barrage's shells): a perfect dodge of it sends the hero
  onto the flying wyrm's head, and it crashes. Spells from the sky or the ground never plunge.
  A strip's lingering fire deals contact ticks instead (tell normal, blockable, not parryable,
  skipped while the hero rolls or is invulnerable). A group stops dealing blows at its cap.
- Tells: a self-announcing circle (`announce`; meteors, chase pillars except a first one the attack's
  beat covers) emits `combat:tell` once the hero is within 3 m of its ring and `combat:flash`
  `flashLead` before impact (both `hazard: true`, `source: 'dragon'`, `attack` = its spell). Other
  hazards (`announce: false`) are covered by the spawning attack's own beat, re-timed with `timeTo`.
- Events: `dragon:hazard {kind, stage, x, z, radius}` (stage 'fall' when a meteor starts its visible
  fall; 'hit' when a meteor or pillar goes off; the dive's crash and the nova emit it too from
  fireAttacks.js; Armageddon: 'launch' for each bolt of the salvo, from fireAttacks.js, radius 0,
  and 'sky' once when the sky answers, from the barrage, radius = ARENA_R).
`dragon.hitPlayer(o, action)` forwards `plunge` (`o.plunge ?? the current beat's plunge`) to
`player.takeHit`; without it `plunge: false` never reaches the hero.

**Fire attacks** (`fireAttacks.js` `FIRE`, numbers `tuningFire.js` `FIRE_ATTACKS` and `FLIGHT`; the
same action shape as attacks.js: phases / beats / zone / weight / start / enter / update / hit /
end): single flights `skyStrafe`, `diveBomb`, `hoverBarrage`; flying combos `skyHunt`, `skyFurnace`,
`skyCataclysm`; spells `meteorRain`, `eruptions`, `flameRing`, `flameWall`, `nova`. Every blow is
red; each attack has one tell beat per blow unless its hazards announce themselves (the meteor cast
has no beat: each meteor rings and flashes). Hazard-dealt blows pass `plunge: false`, except fire
breathed or spat from the air (the strafe's and a combo pass's strip front, the barrage's shells:
spawned with `plunge: true`, the airborne plunge); the dive's crash and the nova pass the default (a
perfect dodge may plunge). The flame ring lays `rings` [1, 2, 3] rings `ringGap` s apart, the flame
wall `walls` [1, 1, 2] (the second from the hero's side, square to the first), each its own beat.
Since ADR-197 the fire that burns away from it travels there from it (hazards' options above): the
eruptions' line and chase run on a crack from the slam (`CRACK_ON`; the chase's channel and its beat
grow by `crackRun(d)`, the run from the slam to the hero now, at most `maxRun`; through the chase the
head watches the crack's head), and phase 3's second flame wall is laid (`wallLay`: `a` from where the
first wall crosses its line, as the first springs up; `b` the head swings round and breathes at that
point for `TRAILS.wall.breath` 0.6 s, the fire striking the ground where the first wall stands (or
0.8 of the way there, if nearer) `strikeDelay` 0.15 s after the first wall's cast, and a runner
carrying it at `runSpeed` 32 m/s to the line); Armageddon's meteors
fall out of `skyFrom`.
- **Flying combos** (2026-11-15, ADR-119; `makeFlightCombo(key)`): one take-off, then the parts of
  `TUNING.attacks[key].parts` in order (`'pass'`, `'barrage'`, `'dive'`), joined by a `wheel`
  (a banking turn) or a `swoop` (a drop onto the next pass's line), ending in a dive whose crash
  landing (entering `recovery`) is the last blow. Each phase entry carries its part's index as a
  third element (`[name, s, part]`; the runner reads only the first two). The parts' numbers are
  `FLIGHT` (`takeoff`, `rise`, `swoop`, `wheel`, `pass`, `barrage`, `dive`); the combo's own tuning
  only chooses the parts, the windup / recovery and the AI data. One beat per blow at the start of
  the move that leads into it, re-timed from the strip / the shells. A perfect dodge of a pass or a
  shell plunges, the wyrm crashes, and `hazards.cancel` takes back what that combo had not breathed
  or spat yet. Each part emits `dragon:spell {name: key, part, x, z}`.
- **Armageddon** (`meteorRain`; 2026-11-15 rework): the performance and the sky come in three looks,
  `skyFx.APOC_LOOK` from `?apoc=a|b|c` (read once at load; default `a`, the look the owner kept, 2026-11-16):
  `a` the salvo of columns from the ground, `b` one sustained pillar roared up, `c` cast from the air
  (its own `windup`, `rise`, `descend`, `recovery`, `alt`). `meteorRain.looks[k]` holds `deckAt`,
  `deckGrow`, `menace`, `drop`, `cone` per look. Through the cast it asks `game.cameraRig.keep(...)`
  for a sphere `skyRoom` 9 m above the jaws, so the fire going up stays in view. It arms
  `hazards.barrage` with `waves` [3, 3, 5] × `perWave` [8, 8, 10] (phase 1: the Lab only) and the deck
  data. `dragon:hazard` 'launch' per bolt (look b: per pulse). `fx.launchBolt`, `fx.meteor`,
  `fx.meteorImpact` and `fx.crater` are no longer used by it (`skyFx` draws its sky and its meteors).
- **`skyFx.js`** (new, 2026-11-15): plain functions over the wyrm's `DragonFx` (`fx`), the pattern
  `bulletFx.js` uses, with state made once on `fx._sky`: `skyBolt` (one column of the salvo),
  `skyPillar` (look b), `skyThroat` (the chest and throat filling before a cast), `skyDeck(fx, k, cx,
  cz, grow)`, `skyMeteor`, `skyImpact`, `skyCrater`, `skyUpdate(fx, dt)` (ticked from
  `hazards.update`) and `skyReset(fx)` (from `hazards.clear`). It calls the fx internals `_blob`,
  `_rec`, `_col`, `_spawn`, `_hold`, `_light` and `dustRing`: keep their signatures.
Each emits `dragon:spell {name, x, z}` at its signature moment. `meteorRain` is not picked while a
rain or meteors are still falling. The nova keeps its 2.5 s charge in every phase (it is the tell)
and is the phase-3 opener. Numbers and gates: COMBAT.md "Current numbers".

**Effects engine** (`fx.js` `DragonFx`; STYLE.md "Fire, hazards and the plunge"): two engines draw
most of what the wyrm does, and a new effect should go through them.
- **Shock fronts:** `_shock(x, z, r0, r1, T, k = 1, fk = 1, delay = 0, look)` rolls a ragged front out
  from r0 to r1 in about T s, slowing (drag), with rows behind it, dust and grit, scorch, rocks, a
  light and (k ≥ 0.9) an echo ripple; k = strength (1 a meteor, 2 the nova), fk = how much of it is
  fire (0.2 = a landing: dust and a little heat). Its numbers per look are the `SHOCK` table. Behind
  every ring: the roar's `shockRing`, `groundShock(x, z, r, k)` (a heavy body meets the ground:
  landings, the stomp, the leap, the hop, the tail slam, a thrown piece; draws only, plus its wind on
  the tree wall, `wallWind` 'ground', ADR-120), the crash
  (`crashWave`), the nova, fireball and meteor blasts. `_ripple(x, z, y, r0, r1, T, heat, size, ...)`
  is a thin crisp ripple (steel; r1 < r0 draws it in: a charge); `roarWave` is ripples plus a dust
  front in look b.
- **The breath:** `breathBody(dt, mouth, yaw, pitch, R, HA, k = 1)` is the one body of fire for
  every stream the wyrm breathes (the breath, the fire snap through `meleeFx.snapFire`, the strafe and
  the combos' passes), shaped to reach R m within ±HA rad, at k × the breath's rate; the caller adds
  its own lights, smoke, sparks and scorch (`breathEmit` = `breathBody` + the breath's own).
- **Looks the owner picked from** (read once from the URL; headless runs have no location): `?ring=a|b|c`
  (`ringLook()` / `setRingLook(k)`) and `?breath=a|b|c` (`breathLook()` / `setBreathLook(k)`),
  plus `?apoc=` above. `a` is the default of each and the look the owner kept for all three
  (2026-11-16, ADR-119); `b` and `c` stay behind the switches and in the FXLOOKS scenario.

**Bullets** (ADR-039; `src/entities/dragon/bullets.js` `class Bullets`, internal to the dragon
module: `dragon.bullets`; rules in COMBAT.md "Bullets"): the pooled bullet field (360 records, 8
hit-cap groups) and the ground tongues (48 alive at once, a plan of up to 64). `dragon.update` calls
`bullets.update(dt)` after the hazards every frame (guarded: an error logs once and clears the field,
never throws); cleared on `reset()`, on every phase change, when dying / dead, and fizzled by a
posture break. No per-frame allocations. `bullets.js` must not import `attacks.js` (`attacks.js` →
`bulletAttacks.js` → `bullets.js`).
- Kinds `BULLET { EMBER: 0, ORB: 2 }` (specs `TUNING.bullets.ember | orb`; kind 1 was the homing wisp,
  removed 2026-11-15, and stays unused). `spawn(kind, attack, x, y, z, yaw, speed, group = -1, life =
  0)` → the record or null (pool full, NaN or an unknown kind); `lob(attack, x, y, z, tx, tz, T, group
  = -1, life = 0, yAt = 0.5)` → an ember lobbed onto the ground point (tx, tz) in T s under
  `TUNING.bullets.lobG` (the Ember rain; it bursts where it lands, its spot glowing as it falls);
  `burst(attack, x, y, z, n, wait, stagger, speed, group)` (embers that hang and drop on the hero one
  by one: a string hit's `burst`); `group(max, retMax = TUNING.bullets.returnBudget)` → a group id:
  the pattern's hit cap and the HP its returned shots may deal in all (past it a perfect parry is a
  plain deflect); `count(kind)`, `live`, `clear()`.
- A pattern's headline beat follows its lead bullet: `setLead(b)`, `leadAlive()`, `leadPos(out)`,
  `leadTti()`; the beat part `'bullet'` in `dragon.partPos` resolves to it (the mouth when none).
  `headlined(kind, tti)`: the brain has flashed the headline, so the lead's impact is announced
  (it covers the clump and stamps the lead's `cueAt`). `holdFlash(a, beat, kind)` → true when the
  field takes over a headline flash that the ending action could not send yet (the lead is still
  flying): the field then calls `dragon.flashTell(a, beat)` `flashLead` before the lead's impact,
  at once if the lead dies or is deflected, and never after a clear / fizzle / the wyrm's death
  (the same as an interrupted pattern: a tell without a flash). One held flash at a time.
- The cue: `cue(kind, attack, tell, tti, x, y, z)` → `CUE.NEW` (glint + `combat:tell` +
  `combat:flash` sent), `COVERED` (an announced impact of the same class within `cueGap` answers it),
  `LATE` (too late to react to: the caller makes it a dud or lets it hit) or **`CLASH`** (an announced
  impact of the other answer, an ember beside an orb, is within `clashSep` 0.35 s: not announced, the
  caller makes the bullet a dud). `cover(kind, tti)` registers an impact something else announces.
  `bar(tell, tti)` registers an impact announced outside the field (the brood's cues): a bullet of the
  other answer due within `clashSep` of it is a `CLASH` (a dud); it covers nothing (ADR-237).
  A bullet cue stands for one predicted impact (`cueAt`, in the bullet's own time).
- **The ground tongues** (2026-11-15; they replaced the fire wheel's `startWheel` / `stopWheel` /
  `aimWheel` / `wheel`): `scour({ attack, x, z, times, angs, r0, r1, speed, hold, width, damage,
  burn, knockback, grp, headline })` lays a plan: each tongue is released from the pivot (x, z) at its
  time (s from now, ascending) along its world yaw, its front crawling out from r0 to r1 at `speed`
  m/s, every spot it passed burning `hold` s; a new plan replaces the old (burning tongues burn on).
  `movePlan(x, z)` shifts the pivot (the breath's body moved before the first tongue), `stopScour()`
  drops the tongues still to come, `scourHeadlined()` (the attack's headline flash went out: from here
  the field announces its own touches), `scouring` (getter: a plan or a tongue live), `planNext()`
  (s to the next planned tongue), `tonguesLive`, `ttT` (s until a tongue, burning or still planned,
  next touches the hero on his sensed velocity; Infinity: none within 2 s). A tongue is red
  (`plunge: false`), only hurts a hero it announced within `tongue.cueHold` s, and after a hit the
  field's tongues pause `tongue.cd` s (`cdDodge` after a roll through one). Its cue is `combat:tell`
  / `combat:flash` with `{ hazard: true, bullet: true, tell: 'red' }` and the pattern's name as the
  attack (`fireWheel` or `fireLanes`).
- Hits go through `dragon.hitPlayer({ ..., bullet: true, perfect, plunge: false })`: the damage is
  final (no `TUNING.damageScale`), `player.takeHit` receives `light: true` and `perfect` (false for
  embers: a roll is a plain dodge), and a parry does not call `dragon.onParried`.
- Perfect parry → the return (ADR-051): on `RESULT.PARRIED` the field reads
  `game.player.deflect.perfect`. Normal: the bullet ricochets to `rig.pt.head` (`ricochet` m/s) and
  the kind's `posture` applies at once. Perfect (embers; orbs are never parried): the bullet is
  `returned`, flies at `returnSpeed` m/s drawn ×`returnSize` (`BFX.drawReturned`) and, on reaching
  the head, deals the kind's `returnDamage` through `dragon.takeHit({ part: 'head', exact: true,
  posture: returnPosture })` (the phase gate holds, it may kill; the action is never interrupted;
  posture breaks are allowed), flinches the head and emits `dragon:returned {kind, damage, x, y,
  z}` (kind is 0 today). Only the struck bullet returns (the clump it pops does not); returned shots
  in flight die silently on a clear and fizzle on a posture break like any bullet.
- Tells: a bullet about to hit emits a paired `combat:tell` + `combat:flash` with `hazard: true,
  bullet: true` `flashLead` before impact. A deflect emits `dragon:parried {attack, tell, hit: 0,
  last: false, bullet: true, perfect}` and adds the kind's `posture` (a perfect one: its
  `returnPosture` when it lands).
- What the fire does to the world (`TUNING.bullets.world`): a landing ember strikes the pieces it
  lands on (`land` 0.08: under `BREAK.scratch`, it marks and sets alight), a stopped bullet takes
  `TUNING.world.bullet` 0.12 out of the cover (an orb × 3), and a tongue's front sets wood alight
  (`world.ignite(..., grass = false)`: grass fire would bury the lines).
- Reads the hero through `game.player`: `isSwinging()` + `sweep` (cutting), `radius`, the sensed
  velocity (`dragon.sense.vel`).
- Look: `bulletFx.js` (STYLE.md "Bullets"): the embers and the tongues are heat in the fire field, the
  orb a glyph mark.

**Bullet patterns** (`bulletAttacks.js` `BULLET_HELL`, numbers `tuningBullets.js` `BULLET_ATTACKS`,
spread into `ATTACKS` like `FIRE`; the same action shape): `emberStorm` (the Ember torrent),
`fanVolley` (the Cinder burst), `cinderSpit` (the Cinder spit), `emberRain` (the Ember rain),
`fireWheel` (the Scouring breath) and `fireLanes` (the Fire lanes); the keys are the contract (audio,
Lab, tests), the labels are display names. Each emits `dragon:spell {name, x, z}` at its cast; the
torrent, the Scouring breath and the Fire lanes also emit `dragon:breathStart` / `dragon:breathEnd`
(the breath loop). **Every bullet is breathed (ADR-050):** `spit(d, kind, attack, dyaw, speed, grp,
life)` spawns it at `rig.pt.mouth` along the head's actual aim (`pt.headFwd`) + `dyaw`, with a
`drop` scaled to the mouth-to-hero distance (`TUNING.bullets.dropK / dropMin / dropMax`: a close hero
is not flown over); patterns emit from their `hit()` hook (after the rig, so from the jaws as drawn)
and aim the head first (`aimHead`: reach out of the neck base, `headExact`, a look down the line).
No pattern spawns from the body or the wings, and nothing homes. **No spinning** (2026-11-15): while a
pattern breathes, the neck and the head do the aiming and the body never turns faster than its
walking turn rate (`d.turnRate`; asserted per pattern and phase by the integration suite). The
Scouring breath and the Fire lanes drive the breath into a strike point ahead of the jaws
(`bulletFx.breathBeam`) and lay their tongues with `scour`. A P3 Cinder burst may queue an Ember
torrent (`brain.queued`, `fanVolley.chain`).

**Terrain moves** (ADR-110; second pass 2026-11-15, ADR-119; `terrainAttacks.js` `TERRAIN_MOVES`,
numbers `tuningTerrain.js` `TERRAIN_ATTACKS` + `TERRAIN`, spread into `ATTACKS` like `FIRE`; the same
action shape): `hurl` (Uproot and hurl), `tailBat`, `fireBrand`. The pieces are the world's
("Destruction" below); the wyrm's side is `terrain.js`. **Nothing is drawn on the ground before a
piece arrives** (the owner's choice; it supersedes ADR-110 and ADR-118 for thrown pieces): one
`combat:tell` at the start of the move, and the flare drawn on the flying piece `flashLead` s before
it lands (the beat's part is `'piece'`). The aim is fixed at the release, on where the hero is
heading then (`lead`). `mark(...)` / `lane(...)` (the landing glow before the throw) are gone.
- `jawsPiece(d, wood, out, any)` → the liftable piece (lift 1) that costs the least to reach (a turn
  at `TERRAIN.jaws.turn`, one lunge at up to `fetchSpeed` to stand `stand` m from it, within
  `fetchTime` s: there is no trot), never one within `clear` m of the hero; `wood` = a tree only.
  `tailPiece(d, out, any)` → a boulder in the tail's ring whose line to the hero is clear of the body,
  with the lash's travel pointing the hero's way and the hero out of the lash's arc; it writes which
  way the pivot turns. `any` (a forced move) relaxes the gates. Each move's `weight` is 0 when its
  picker finds nothing, so the AI never starts one without a piece; `phases()` picks again, and with
  nothing at all the action is one `search` phase (no beat, no blow).
- The chosen piece is **reserved** for the whole move (`reservePiece`: `destructibles.reserve(piece,
  the move's length + 0.5 s)`; it is also the action's `a.piece`): the wyrm's own body walking and
  lunging (`_wreck`, incidental blows) leaves it alone.
- `dragon.terrain` (`class Terrain`; `dragon.update` calls `terrain.update(dt)` after the bullets,
  guarded; `reset()` drops a held piece and forgets what flies): `grab(piece, x, y, z)` (the jaws
  close on it: `destructibles.take`, but it stays ROOTED and shudders as they tug), `strain(dt, k)`
  (the tug: grit jumps round its foot), `tear(dx, dz)` (it comes free: roots and dirt burst, a scar,
  and it is yanked up into the jaws without a jump), `carry(dt, x, y, z, tilt, yaw, stiff = 1)` every
  frame after the rig (the grip point at the jaws; free, the piece hangs as a stiff pendulum,
  `TERRAIN.jaws.sway`, driven by the jaws' own acceleration; `stiff` tightens it for the whip),
  `blaze(dt, k)`, `drop()`, `lob(tx, tz, spec, attack, a, b, burning)` → the flight time,
  `bat(piece, dx, dz, len, hitS, speed, spec, attack, a, b)` → true, `stir(dt, piece)`,
  `piecePos(out)`, `smashed` (pieces the flying ones have smashed: tests, the Lab).
- **In the air the piece stays HELD** in the world: `Terrain` flies it frame by frame (`_place` →
  `destructibles.carry`) on a flat, fast arc (`flight` [0.4, 0.68] s for the hurl), tumbling on with
  the whip's swing (at least `spin` rad/s, a boulder × 1.4). On its way it sweeps what stands in its
  path (`destructibles.sweep`, power `smash`; a tree in the way goes down and it flies on; a burning
  brand lights what it smashes, `trailIgnite`). Where it lands the blow at the hero is dealt here (red,
  `plunge: false`, the move's tell), the world takes a blast of `power`, then the piece is handed to
  `destructibles.throwTo` only for the skid (`skid` m in `skidTime` s, tumbling) and comes apart. A
  burning piece also bursts, calls `world.ignite` and leaves a pyre (contact ticks like a burning
  strip, put out by a phase change). A batted boulder (`bat`) is carried along its line here too, so
  `destructibles.stop` ends it at the first cover; it tests the hero as it passes, with the spec's
  tell, and is let go with a short `throwTo` where it ends.
- A thrown piece carries its action's beat: if the action ends or is cut short after the release,
  `Terrain` sends the beat's flash (`dragon.flashTell`) `flashLead` before the piece arrives, once.
  An action cut short BEFORE the release drops the piece and sends no flash.
- A throw at a hero far round its side is slower: past `whipArc` off its nose the neck's coil is
  drawn out into a pivot of up to `pivotMax` s (his opening). A held piece is swung back and out
  toward the camera's side by up to `showArc` so it stays seen.
- Events: `dragon:spell {name}` at the throw / the kindling / the bat; `dragon:bite` at the bite;
  `dragon:breathStart` / `dragon:breathEnd` round the kindling; `dragon:explosion` where a firebrand
  lands; the world's own `world:impact` (`throw`, `crash`).
- Effects: `terrainFx.js` (new; plain functions over `d.fx`: `strain`, `tearOut`, `pin`, `burnTrunk`,
  `trail`, `smashOn`, `landing`, `batBurst`, `pyre`). Fire and smoke in the fire field; grit, clods,
  roots, splinters and leaves are glyph particles.

**Melee FX hooks** (`DragonFx`, called by `attacks.js` through optional calls): `clawTrail(wi, toe,
heavy)` (a claw's burning wake, every active frame of a claw / overhead hit) and `slamBurst(x, z, r)`
(the ground burst under a slam). The whole-body kinds' effects are `meleeFx.js` (2026-11-15; plain
functions over `d.fx`, the bulletFx pattern): `snapFire` (the fire snap's gout, through
`fx.breathBody`) and the dust, fire and embers of the wing slam, the tail slam, the wing scythe and
the ember rake. Their burning ground is the hazards' `'meleeFire'` strip.

**The roar-cast moves** (2026-11-25, ADR-197, the fire-and-forest pass). Four moves open with a roar
over a seal of burning script and call up fire that fights on its own: the brood moves `drakelings` and
`wisps` (`broodAttacks.js` `BROOD_MOVES`, numbers `tuningBrood.js` `BROOD`) and the spells
`fireSerpent` and `firestorm` (`spellsFire.js` `FIRE_SPELLS`, numbers `tuningSpells.js` `SPELLS`,
drawing `spellsFx.js`). The same action shape as `fireAttacks.js`; category `spell`. The phase roar
(`makeRoar`) clears the brood and resets the incantation with the hazards and the bullets.

**The incantation** (`incantation.js` `class Incantation`, `dragon.incantation`; numbers
`BROOD.incant`): the seal a roar-cast move draws, its lines written ON THE LETTER GRID in the fire
field through the wyrm's `DuelFx` (`d.fx.tells`: `_ink`, one blob per cell, on the one frame clock).
Up to 4 at once (the oldest gives way). `Dragon.update` calls `update(dt)` after the hazards, guarded
with the brood (an error logs; a seal whose drawing throws is dropped); `reset()` on the wyrm's reset,
its death and the phase roar.
- `cast({ x, y, z, r, dur, kind, color, under })` → an id (`under`: a ground circle round the wyrm's feet that
  follows its root while it burns: the drakelings' and the wisps' casts, ADR-277; the wisps' seal no longer hangs before the jaws): kind `'ground'` (flat round x, z; its lines stand
  `groundY` 0.55 m up and `groundGain` × hotter, the field's soft depth fades lower heat) or `'jaws'`
  (hanging in the air facing the camera; with x unset it hangs `jawOffset` before the mouth and follows
  it); `r` m (default 6 / 2.4); `dur` s, after which it burns out by itself; `color` the ink
  (`'script'` | `'fire'` | `'blood'`; default the `?incantInk=` switch).
- `flare(id, k)` its power 0..1 (it brightens as the spell charges; a rise to 1 is the release: a
  white-hot flash, `heatFlare` for `flash` 0.22 s); `end(id)` (it burns out over `tail` 0.55 s, its
  lines tearing up into tongues); `at(id, out)` → false when gone, else fills `out.{x, y, z, r}`;
  `point(id, i, n, out)` the i-th of n points round its sigil ring (where things burst out of it).
- **The borrowed void slot.** The fire field's `fire` kind tears a thin line into tongues, so the
  script inks (`script`, `blood`) are written in the field's VOID slot, which nothing else uses on the
  wyrm's level, dressed once per page through `fire.setPalette('void', ...)` (`_dress`: `script` the
  fire's own palette with its turbulence turned down, `BROOD.incant.ink`; `blood` `FIRE_PALETTES.glareDeep`).
  `fire` writes in the plain fire kind. The two spells pass `color: 'fire'`; the brood's seals take
  the switch, and the drakelings' bodies are always written in the void slot (`script`, or `blood`
  under `?incantInk=blood`). A level that puts the void slot to its own use must not cast a seal.
- Looks: `incantLook()` / `setIncantLook(k)` (`?incant=a|b`), `incantInk()` / `setIncantInk(k)`; look
  jitter from a hash, never `Math.random`; nothing drawn while no seal burns.

**The brood** (`brood.js` `class Brood`, `dragon.brood`; numbers `BROOD.drakeling`, `BROOD.wisp`,
`BROOD.hold`, `BROOD.late`, `BROOD.busyWait`): pooled fire creatures (6 drakelings, 8 wisps) that fight beside the
wyrm on their own, like the hazards.
- `spawn(kind, o)` → an id (0 when the pool is full): kind `'drakeling'` (`o`: `x, y, z` where it
  bursts out, `slot` its place on the ring round the hero, `hp`, `life`) or `'wisp'` (`o.src` the body
  point it rides, 0..7 along the spine, the wing wrists and tips, the tail; `o.delay` s before it swells);
  `count(kind?)` live ones (no kind: both); `update(dt)` (every frame, never throws: an error drops that
  creature); `clear()` (all burst harmlessly: the phase roar; also when the wyrm is dying, dead or
  asleep); `reset()` (nothing left: the wyrm's reset and death). `stats` {spawned, cut, burst, hits,
  lunges, dives, late (cues that waited past `hold.max`), dropped (creatures that guttered out holding)}; `nextLunge` (the drakelings' move sets the first lunge `firstLunge` 1.4 s after it ends).
- **Their blows** go through `dragon.hitPlayer(o, null)` with a tell and the move's name as `attack`
  (`'drakelings'`, `'wisps'`): a drakeling's lunge normal or blue (block / parry; a parry kills it and,
  as any parried non-bullet blow, calls `dragon.onParried`), its dive and every wisp's burst red. Each
  cue is `combat:tell` (at the lunge's windup, the dive's climb, the wisp's commit) and `combat:flash`
  `flashLead` before it can land, both with `hazard: true` and `brood: true`, plus the shared cue
  design at the creature (`fx.tells.hazardFlash`; for a red one, the red blaze where it will burst).
  A burst calls `world.impact`, `world.ignite` and `world.groundBlow` (kind `blast`) where it lands.
- **Fairness.** One lunge at a time; never two dives within `dive.gap` 0.8 s; one wisp commits at a time,
  `sep` 0.75 s apart. A lunge is not started while the brain's cue ledger (`brain._clash`) holds a cue
  that asks for a dodge near its impact. A cue whose flash is due waits, its creature's clock held
  (`_hold`), while a cue of the other answer is due within `hold.sep` 0.5 s of it (the ledger, the
  wyrm's running move's beats told or not, `_beatNear`; for a red one also any bullet in the air), at
  most `hold.max` 1.8 s per cue. No lunge or dive starts while the wyrm is airborne or its running move
  has a beat not yet flashed (`_wyrmBusy`), for at most `busyWait` 2.5 s. **Past `hold.max`** (a long
  busy spell: a dive that went after `busyWait`; ADR-237) the cue goes at the first free slot: it holds
  on only while a cue of the other answer is due within `late.clear` 0.36 s of its impact (the ledger,
  `_beatNear`; the bullets in the air no longer hold it), and after `late.drop` 4.5 s held in all it
  gutters out without its blow (`_die`, no cue). Every brood flash calls `bullets.bar(tell, flashLead)`,
  so a bullet of the other answer due beside it is a dud (`CUE.CLASH`): a brood cue never shares 0.3 s
  with a cue that asks for the other answer, whichever comes first.
- **The blade seam.** The brood reads the hero's swing as `bullets.js` does: while
  `player.isSwinging()` and `player.sweep.valid`, the blade's swept quad (`sweep.a`, `b` this frame,
  `pa`, `pb` the last) is tested against each creature (its radius + `cut`), **once per swing**
  (`player.atk` is the swing's identity). A cut costs 1 hp (a swing whose `atk.def.heavy`: 2), and the
  hero feels it through **`player.feelCut(x, y, z, dx, dz, heavy)`** (new on the Player: a short
  hit-stop, 0.05 s or 0.075 heavy, sparks along the cut, a camera shake; it deals nothing and counts no
  streak). A drakeling bursting out of the circle and a wisp still on the wyrm's body cannot be cut.
- Drawn as heat in the fire field through `fx.tells` (`_dot` / `_ink` / `_blob`); embers and sparks are
  glyph particles; look noise from its own LCG. `drakelingLook()` / `setDrakelingLook(k)`
  (`?drakeling=a|b`). Phones (quality 0) draw less.

**The roar-cast spells** (`spellsFire.js`): both are CHANNELS: phases `windup` (the roar over the
circle, × `tScale`), `channel` (40 s at most: the spell runs, the wyrm stands over it, its head
following it; the channel is cut to its time, `a.dur = a.t`, when the spell is done) and `recovery`.
Anything that ends the action early (a stagger, a posture break, a phase roar, the reset, death) ends
the spell: it dies harmlessly (`end()`). Their beats are made at the start with a placeholder time
(1e4 s: never told) and **re-timed when the blow starts** (`tellNow`: the next untold beat's `at` = now,
its `impactIn` = the blow's time): one red beat per serpent strike (at the rear) and one for the
firestorm's burst (as it starts to gather). A beat's part is `'point'` with its own `px, py, pz`
(`Dragon.partPos` 'point'; `cueAt` draws the in-world cue itself only if `partPos` does not resolve
there). Contact with the serpent's body or the column's wall deals ticks of normal, blockable fire
(never while the hero rolls or is untouchable). What they do to the world: `destructibles.sweep` along
the way, `world.ignite` (the serpent's lane catches `igniteDelay` 2.2 s after its head passed),
`world.groundBlow` (kind `beam` along the serpent's trench, `blast` at the emerge and the bursts), the
column lifts light trees (`destructibles.nearest` / `take` / `carry`) and flings them at its burst
(`throwTo`); under both,
`world.fire.hush` keeps the grass's flames low. `spellState(d)` → `{ serpent, vortex }` (the running
spells' state or null; the tests and the Lab). Looks `SERPENT_LOOK` (`?serpent=a|b`) and `VORTEX_LOOK`
(`?vortex=a|b`), table `SPELL_LOOKS`. `spellsFx.js` `spellFx(d)` draws both: heat in the fire field, a
rate-based emitter per piece (the same density at any frame rate), embers as glyph particles, the
dust and splinters the column draws in as one `LetterBatch` (320 + 220 letters), all on the one wind
(`life.wind.at`), noise from its own `mulberry32`; phones draw `phone` 0.55 / 0.5 of it.

### HUD — `src/ui/hud.js` exports `class Hud`
```
constructor(game)          // builds DOM under #ui (inject its own <style>; do not edit style.css)
update(realDt)
log(text, channel='system')          // channel: 'system'|'combat'|'warn'|'lore'
showBossBar(name) / hideBossBar()    // boss HP + posture bar
banner(text, kind, opts)             // kind: 'death'|'victory'|'area'|'bonfire'|'phase'
bannerHint(text) / clearBanner(instant)   // sub-line under the current banner; flow uses both
bannerRecap(lines | null)                 // small lines under the hint (the death screen: the killing move, then what
                                          // struck him); the first is drawn brighter; cleared by a new banner and by
                                          // clearBanner(true)
showStats(rows, head?)               // the victory record; head = the run's grade, marks, time, NEW BEST, the best before (ADR-179)
prompt(text|null)                    // interaction prompt, e.g. "[@interact] Rest at bonfire" (the chip shows the bound key)
promptText                           // getter: the prompt shown now (raw "[@interact] ..." text) or null
promptEl                             // the prompt's element (touch controls make it a tap target)
pauseUi.buttons; titleUi.stageButtons  // the menu buttons in order, for the gamepad's focus
remapUi                              // the CONTROLS panel (ui/remap.js; see Bindings)
newsUi                               // the WHAT'S NEW panel (ui/changelogPanel.js; below)
titleUi.newsButton                   // the title's WHAT'S NEW button (the gamepad walks it after the stage buttons)
showTitle() / hideTitle();  showPause(bool);  toggleHelp()
// the pause menu (ui/screens.js PauseMenu): RESUME · QUALITY · SOUND · CONTROLS · FULLSCREEN /
// PAD POSITION / PAD SIZE (touch) · WHAT'S NEW · QUIT TO TITLE (pressed twice within 3 s → flow.quitToTitle())
```
**WHAT'S NEW** (ADR-116): `ui/changelog.js` exports `GAME_VERSION` (= package.json `version`),
`RELEASES` (newest first: `{ version | null, label?, date?, summary, entries: [{ date, title, notes:
[string] }] }`; `version: null` is the LATEST release, the work since the last version) and
`entryId(entry)` (`date|title`). `ui/changelogPanel.js` `ChangelogPanel` (`hud.newsUi`): `open()`,
`close()` (marks every entry read), `toggle()`, `on`, `unseenCount()`, `onChange(fn)` (after a read),
`markAllSeen()`, `scroll(px)`. Read ids live in localStorage `gcd.whatsnew.seen`; with none, only the
newest day's entries are unread. Esc (capture phase, swallowed), the pad's B / Menu / A and BACK close it;
while it is open `flow._title` does not start the game and the gamepad drives only the panel (the stick /
D-pad scroll). Badges: the title button's `.ab-news-badge` ("N NEW") and the pause item's value
("N NEW ›"). `tests/changelogcheck.mjs` (in `npm test`) checks every CHANGELOG.md → [Unreleased]
headline has a LATEST entry with the same title, the entries' form, and the version.
**Touch layout:** the touch controls add `.ab-touch` to the HUD root (`.ab-root`). Elements with
`kb-only` are hidden then, `tp-only` ones only show then (title "PRESS ANY KEY" ↔ "TAP TO BEGIN",
the keyboard ↔ touch control lists in the title and pause menu, the pause menu's FULLSCREEN item
where the Fullscreen API exists). With `.ab-touch` the log, the key hint and the help panel are
hidden, the prompt becomes a tap target ("TAP › Rest at bonfire"), the pause panel scrolls; below
560 px of height (phones in landscape) the player's rows and the boss's are set in 10 px type, the boss
sits at the bottom centre between the thumbs, and the title / record compact.
The **minimap** is a bare disc in the top right corner on every device: 72 px at 60 % opacity, on a
phone (a side ≤ 560 px) 40 px at 50 %; no panel, no zone title, no coordinates (the FPS line stays
when on).
**Held upright** (`(max-width: 560px) and (orientation: portrait)`; ADR-097): the frame top left,
the boss's rows under them, the prompt and banners above the thumbs, the pause panel in the upper half so the pad shows below it, the title's logo and
lists to the screen's width.
Desktop (no `.ab-touch`) is unchanged.
**Gamepad layout:** while a pad is the device in use, `html.gcd-pad` (and `.ab-pad` on the HUD root)
hides `kb-only` and `tp-only` elements and shows `pad-only` ones (title "PRESS ANY BUTTON", the
pause / help pad grid); `ab-nontouch` elements (the title's controls line, the corner hint, the
CONTROLS item) hide on touch unless a pad is in use. Action chips relabel to the pad's buttons (and
PlayStation symbols). `.pad-focus` marks the focused menu button.
Renders no attack tells of its own: no text, icons, rings or arrows (tells are read from the
attacker — COMBAT.md). Its only tell cue is a brief screen-edge flash (~0.25 s, game time,
stronger on the attacker's side) in the flare's colour on the `combat:flash` of a moment (red; blue
with `flare`; black: the edges go dark, and they dim slowly through a black blow's charge, from
`combat:charge`), dropped by a stagger / posture break /
death / retry (`ui/tells.js`); flashes with `hazard: true` (meteors, chase pillars) are skipped,
their red ground rings already warn. Also renders parry / Ghostep / guard-break call-outs, the cyan
Ghostep edge pulse (a plunge's perfect dodge included), the posture bar, and the crit-window cue.
**Look (ADR-098): an ASCII overlay with no panels in play.** The player's rows (top left: HP, guard,
the crit window, the streak, the flasks and the lock label; no name plate) and the boss's (top
centre: its name in spaced capitals, HP with a `|` at each phase gate, posture) are text on the game. Every meter is a
`GlyphBar` (`ui/glyphBar.js`: `set(0..1)` / `snap` / `update(dt)`, `root` takes the state classes,
`mark(f)`): a run of fill characters, the piece just lost (held `hold` s, then drained) and the empty
rest, between brackets, written to the DOM only when a run's length changes; anything above zero
shows at least one cell and only a full meter shows them all. `GlyphPosture` grows from the middle.
HP 24 cells of `#`, guard 24 of `=`, crit 16 of `>`, the boss 48, posture 32: the lengths on a screen
with room. **The top row is fitted** (ADR-131; `hud._fit()`, first of the HUD's steps, runs when the
window, the touch layer or the boss's name changes; `FIT` in `ui/hud.js`; both meters have
`resize(cells)`): on a touch screen with a short side ≤ 560 px or narrower than 900 px the hero's
meters are 16 cells and the HP reads as one number (`.ab-compact`, `hud.compact`). The boss's meter
takes what is left between the hero's rows and the corner (LOCK on touch, else the minimap; measured
where there is a layout, estimated at 0.6 em a letter headless), never more than 48 cells nor fewer
than 18: on the screen's middle while that leaves 36 cells, else in the middle of the free stretch
(`bossEl.style.left`). Posture is two thirds of it. A name too long for the stretch gets `.tight`
(closer letters). `hud.fit` = `{ compact, stacked, cells, left, right, mid }` (`stacked`: a phone held
upright, where the boss's rows have a line of their own).
The banners' big words are block letters (`ui/blockText.js`: `blockLines(text)` → six rows in the
title logo's letterforms, `blockText(text, { maxCols })` stacks words to fit): `ui/banner.js` sizes
them to the window's width (`BLOCK_MAX` px a character by kind) and lays them out again when the
window is resized or turned; the plain text stays in the DOM, unseen. A phase call, which comes in
the middle of a fight, is the smallest (6 px) and sits above the fighters (21 % of the height, no
dark band). No serif font is used.
The player's rows carry the **guard meter** under HP (`player.guard / maxGuard`, polled: steel
`=`, warm under `GUARD.low`, a flash and "GUARD DOWN" on `player:guardOpen`). The **lock-on
marker** (`ui/nameTags.js`, `LOCK_MARK`) is a hint, not a fixture: taking the lock shows a small
dim diamond on the target (opacity 0.55) for 0.5 s, it fades over 2.4 s and stays gone until the
lock is taken again (real seconds; the frame's "LOCKED ON" label and the touch LOCK button say the rest).
`ui/callouts.js` subscribes itself to `combat:deflectChain {count}` ("DEFLECT ×N" over the hero's
head: one counter per string that counts up in place and absorbs the PARRY / DEFLECT pop of the same
blow; the GHOSTEP call-out counts the same way from the second perfect dodge of a streak,
"GHOSTEP ×N"), `player:plungeHit {execution}` ("EXECUTION") and the duel's moments: `player:lock {phase}`
("BLADE LOCK" / "BREAKTHROUGH"), `player:mikiri` ("MIKIRI"), `dragon:deflected` ("PERFECT DEFLECT"),
`dragon:guard` ("GUARDED", or "DEFLECTED" in red when `deflect`). The boss bar draws a thin tick at each
phase gate (`dragon.phaseAt` after the first, read at construction: 66 % and 33 %) and takes the
`p2` (orange) / `p3` (white-hot) style from `dragon.phase`; the minimap's wyrm dot follows the same
three colours.

**The streak counter** (`ui/streakCounter.js` `class StreakCounter`, `COUNTER`, `TIER_WORDS`, `COUNTER_LOOKS`; ADR-167): `hud.streakUi`, built in the call-outs' layer; `onStreak(d)` (from `player:streak`: a rise to 2 or more shows the number, a loss of 2 or more shows it struck), `handoff()` (on `player:flurry`), `clear()` (with the call-outs: title, death, retry), `update(realDt)`; `shown` ({ n, tier, word, lost }; tests). Its DOM is built on the first number. `?streakCount=lines | brackets | ticks` (default lines). With `streakK('counter')` > 0 `Callouts.ghostep` / `riposte` drop their ×N, and `Callouts.count` ticks a live count in place while its pop is younger than 0.2 s. `Callouts.banner(text, sub, tier)` passes `tier` to `MiniBanner.show(text, sub, tier)`: 4 and 5 add thin rules (classes `t4` / `t5`, `long` for a long name), never size. `hud.js` exports `FLURRY_TIER_NAMES` ({ 4: 'HUNDREDFOLD FLASH', 5: 'THOUSANDFOLD FLASH' }): a full flurry's banner takes it from the streak's tier (read on `player:flurry`) while `streakK('tiers')` > 0.

### The loading screen and the title's layouts (ADR-196)
**The loading screen** is plain HTML, CSS and a small classic script at the top of `<body>` in `index.html`
(`#gcd-load`, its style `#gcd-load-css`), so it paints before the bundle has arrived; `scripts/build.mjs`
carries it into `dist/index.html` as is. Until the boot reports, its bar is a CSS-only waiting run (the main
thread is busy parsing). `src/main.js` breaks its boot into named steps with fixed shares of the bar
(`BOOT`: fonts, renderer, world, hero, boss, interface, shaders; measured on a 4x-slowed CPU, the world is
most of it) and yields one frame between them, only while a loader is on the page and the tab is visible.
`ui/bootLoader.js`: `bootStep(word, frac, to)`, `bootDone()`, `bootFail()` drive the page's
`window.__gcdLoad.step / done / fail` (all no-ops with no loader: the headless tests);
`fontSheetReady(ms = 3000)` waits for the web fonts' sheet, which `index.html` loads without blocking the
first paint, so the glyph atlas is drawn with the same fonts as before; `travelNote(id, name)` writes
sessionStorage `gcd.travel` on a stage pick and the next page's loader names the world it travels to.
`?loader=b` (default, the console: the finished steps with their real times) or `a` (centred); `-hold`
(or `hold`) keeps it on screen at the world step. Nothing in it calls `Math.random`.

**The title's layouts** (`ui/titleMenu.js` `class TitleMenu`, `menuNow()`; styles `ui/titleMenuStyle.js`,
scoped under `.ab-title.gm`; the logo `ui/gcdLogo.js` `GCD_LOGO`, the same rows as the loader's, kept in
step by hand): `?menu=c` (default, the sword's path), `a` (the world list), `b` (the campfire grid), `0`
the title before (`TitleScreen` builds it as it was). The picker reads each level's `name`, `sub` and
`boss` (levels/*.js: the boss's full name, "NAME, THE EPITHET") from `game.levels`. One selection serves
every device: hover, the arrow keys, the pad's focus select; a click, a tap, Enter or A acts at once (travel: `stage.pick(id)`, a page load; begin: `stage.begin()` → `flow.beginFromTitle()`).
`TitleScreen.eatsKey(code)` (a key the menu used this frame: the flow's "press any key" skips it),
`holdsStart()` (the CONTROLS panel is open: neither the flow nor the pad starts), `navigate(el, dx, dy)`
(the pad's 2D walk: the nearest entry by its place on screen, `ui/gamepad.js`). CONTROLS opens the full
keyboard / pad / touch grids and the tell legend. The title's shimmer and its pinned `Math.random` draws
(`STREAM_COLS`, ADR-195) run for every layout.

**The hero's name**: the tag over his head (`ui/nameTags.js`) reads `player.name` ('gcd') and rides his
head bone (`HERO_TAG`: `over` m above it, eased at `follow` /s; `fallback` m over his feet without a rig).
`?heroName=a|b` puts the name by his meters too (a: a line over the HP row; b: at the head of the flask
row); off by default.

### Flow — `src/game/flow.js` exports `class GameFlow`
**Move telemetry** (ADR-108, `game/telemetry.js` `MoveLog`): `flow.moves` logs every `combat:answer` per boss move:
`attempt` (a Map id → { seen, hit, blocked, parried, perfectParry, clashed, dodged, perfectDodge, damage, kills },
counted in BLOWS; a contact stream is one blow per 1.5 s), `killedBy` ({ attack, tell }; 'burn' when no blow dealt
the death), `worst(n)`, `commit('death' | 'victory')` (adds the attempt to the level's totals in localStorage
`gcd.telemetry.v1`: { [level]: { attempts, deaths, wins, killedBy, moves } }), `reset()` on every respawn,
`table(level, label)` and `totals()` / `clear()`. `flow.moveLabel(id)` names a move (the boss's `attackLabel`, else the
id spelled out); `flow.deathRecap()` is the death screen's lines ("SLAIN BY …", then up to three moves with "n of m
blows landed"), shown with `hud.bannerRecap`. The victory record gains "Struck most by". Console:
`__telemetry()` (this level's table, the deadliest move first), `__telemetry('all')`, `__telemetry('clear')`.
```
constructor(game);  update(dt, realDt)
quitToTitle()              // the pause menu's QUIT TO TITLE: reload the level (game.pickLevel), which opens on the title;
                           // headless (no location.assign) the state goes to 'title' and the title shows
cameraOverride: null | { focus: Vector3, weight: 0..1, zoom: meters }   // read by main.js
debug: { toState(name) }               // Lab: 'explore'|'boss'|'dead'|'victory' with consistent side effects
cinematic({ x, z, zoom = -9, weight = 0.6, slowmo = 0.3, dur = 0.8, kind }): boolean
                                       // a duel's big moment (ADR-062): the flow's time scale × slowmo for dur real s
                                       // (cineScale: drops in at once, eases back over the last third; min-merged with
                                       // the death / victory slow-mo, NOT a hitstop), the camera zoom m closer leaning
                                       // weight toward (x, z) (cameraRig.cine; eases in over 1/5, out over 2/5). A newer
                                       // moment replaces a running one. Emits 'game:cinematic {kind}'. False outside play.
cine, cineScale                        // the running moment (null) and its time scale this frame (1)
```
**The streak pass** (ADR-167): `cinematic` also takes `ease` ([in, out]: the shares of `dur` the camera eases in / out over; default [0.2, 0.4]), `back` (the share the slow motion eases back over; default 0.34) and `quiet` (no `game:cinematic`: the perfect dodge's cinema look, which must not ring the moment's gong). A perfect parry of a blade in the sharp / cinema look takes its own flash (`PERFECT_FEEL[feel].parry.flash`) and cinema's `grade.dimPulse` instead of the 0.55 flash; a perfect dodge's cool grade holds `PERFECT_FEEL[feel].dodge.pulse`. `update` calls `perfectUpdate(game, dt, realDt)` each frame; the fx clear calls `perfectClear()` and `game.fx.streak.clear()`. The flurry's screen flashes and its dip are scaled by `burstScreen()` (above).

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
**Flying framing:** the box above can't see 10–20 m up, so while the override is on (weight > 0.05)
and the wyrm is airborne, or a head / body hurt sphere is above `bossCam.highY` (13 m), `_bossFrame`
also asks `cameraRig.keep` for every head and body sphere and for the hero (`must`, never cropped).
Phases: `dragon:phase2` and `dragon:phase3` (queued like the other dragon events) show the phase
banner ("THE CINDER WYRM'S FURY IGNITES" / "ITS HEART BURNS WHITE-HOT") and switch the music to
'boss2'; `flow.phase2` means phase ≥ 2.
Touch: with `game.touch.active` the death hint reads "tap to rise again" and the "H: controls ·
Esc: pause" log line is skipped. Screen taps reach `_dismissPressed` as a virtual LMB press.
**The arrival** (2026-11-23, ADR-163; `flow.arrival`, `game/arrival.js`, `?life=arrival`): as the title is
dismissed (`_startGame`, after its camera lines) the camera opens wide over the level for a few seconds
through the flow's own eased override, then settles behind the hero; once per page load, never on a
respawn; any move or action that is a CHANGE from the input at its start skips it. `arrival.update` runs
after `_updateCinematic`; `_enterBossIntro`, `_resetWorld` and `_debugPrelude` call `arrival.cancel()`
first. Off (the default): `begin()` does nothing. "The living world" → The arrival.

### Audio — `src/audio/audio.js` exports `class AudioEngine`
```
constructor(game)          // subscribes to events; AudioContext created lazily
unlock()                   // call on first user gesture (flow does this on title dismiss)
update(realDt)
play(name, opts)           // one-shot SFX by name (sfx.js SFX, then fire.js FIRE_SFX, then thump.js THUMP_SFX, then lifeSfx.js LIFE_SFX)
setMusic(mode)             // 'none'|'ambient'|'boss'|'boss2'|'victory'|'death'
toggleMute(); muted: boolean;  setVolume(0..1)
thump: Thump;  thumpDip: GainNode|null // the impact pass (thump.js): the sub voice + the music's dip node
```
**The attack sounds (2026-11-22; `audio/samples.js`, `audio/sampleList.js`, `audio/sampleFiles.js`).** *Off by default since ADR-178:
the default is the original synth (a tick on every tell, the flash's ping on every blow, no sound of a boss's blade);
`?sfx=new` turns on what this section and "The combat core" below describe.*
Only a blue or a red / black blow has cues: `combat:tell` plays the warning `cue-blue` / `cue-red` (+ the
music dip for red), `combat:flash` the timing sound `time-blue` / `time-red` (+ the dip); a normal tell and a
normal flash play nothing (the white glint is visual). Hazards and bullets keep their cues as before
(`hazardTell`; a bullet's tell silent, its flash the synth ping without the dip; a hazard's flash the synth
ping with it). Every boss blow sounds like what it is: `dragon:attack` from a duelist → `sword-light /
-heavy / -thrust / -draw` or `fist-light / -heavy` (`blowSlot`; a kick is `fist-heavy`; a heavy blow on a slot
that is not a heavy one × `HEAVY`), on the sfx bus (Ghostep muffles it), spatialised, its clip's
`peak_ms` lined up with the impact (`impactIn` / the game's time scale), two blows never within
`BLOWS.gap`; the wyrm's swipe → `beast-claw` / `beast-tail` by name (`BEAST`), names in neither and
`RX_OWN_SOUND` as before; the hero's LIGHT swing → `sword-light` at `HERO.rate` (above the bosses), each
combo step higher (`HERO_SLOT`: his heavy cut and the execution's thrust play the synth `swing`, the
owner's pick of 2026-11-23). `cue-blue` and `time-blue` have no file: the synth `tellBlue` / `flash`.
- `engine.samples` (a `SampleBank`, built with the graph) fetches + decodes every file of
  `SAMPLE_FILES` (generated by `scripts/audio/build-sfx.py` from the owner's picks,
  `scripts/audio/sfx-picks.json`: files in `assets/audio/sfx/<slot>-<n>.mp3`, credits in
  `assets/audio/CREDITS.md` "Combat sounds"). `pick(slot)`
  never gives the same file twice in a row; picks and the ± `jitter` on the rate come from its own
  stream, never Math.random. `engine._sample(slot, o, gainMul, rateMul, who, layer)` → false when the slot
  has nothing ready (no file, not loaded, failed, no fetch: file:// and the headless tests): the caller
  plays the synth recipe (`tellBlue`, `tellRed`, `flash`, `bladeWhoosh {weapon, weight, shape}`,
  `swing`, `dragonSwipe`, and the combat core's below), so nothing is ever silent. `bladeWhoosh` draws
  its noise from its own stream too. An `align` slot with `skip` whose peak would land late starts into
  its file (`fadeIn`); one with `cut` fades out `cut` s after its peak; `layer(v, t, r, rate)` adds more
  to the same voice (`SampleBank.start(v, t, r, gain, rate, { from, fadeIn, cut, fadeOut, dest })`). Its
  gap keys are `smp:<slot>` (never a `play()` recipe's name).
- **The combat core (round 2, 2026-11-23).** Recorded / designed over the synth recipe, which stays the
  fallback (`sampleList.js` per-slot gains: each plays at its synth's in-game level, less what the
  owner's picker played it quieter for clipping):
  `player:parry` of a blade → `parry`, or `parry-blue` for a blue blow or a perfect parry (+ `parryPerfect`:
  the perfect layer, its crack and high bell rung per `perfectSound().ring`, pitched as a single parry; the
  streak's climb note as before); a bullet's (`light`) → the synth. The deflect chain (chain ≥ 2) on the
  recording builds per `chainMode()` (`samples.js`, `?chain=a|b|c`, default a; the Lab's `chain` row;
  `parryChain.js` `PARRY_CHAIN`, `chainK` / `chainRate` / `chainGain` / `chainLayers`): a = weight (the clang an
  octave under itself and a sub), b = doubled strike (a second / third strike, a driven band, +½ semitone a
  step to 2), c = long ring (a low ring on the streak's tonic, more hall); no bell, no sparkle.
  The parry's other uses (`player:mikiri`, `player:counter`, `player:lock` won, `dragon:deflected`, a blue
  flare's `combat:flash`, `player:flareCounter`) → `_parryAlso`: one strike of `parry-blue`, no climb (the synth
  `parry` with its old chain value as the fallback and with `?sfx=old`). The streak's climb note on a parry is
  × `STREAK_SOUND.parryGain` (0.5). The hero's swing pitch steps with `combo` 1..5 (step `combo - 1`, 0..4),
  the recorded light cut by `HERO.combo` and the synth `swing` by 0.035 a step.
  `player:hurt` (end of frame) → `hurt`, gain × `(clamp(damage / 40, 0.6, 1.4) / 0.6) ^ HURT.exp`, + `hurtFire`
  for a fire kind. `player:hitDragon` on a beast (not a wing) → `hit-scale` (heavy × `HIT_HEAVY`, + `hitCrit` on
  a crit; a duelist's cloth and a wing: the synth `hit`); its blade layer → `cut-light` (light / sweep /
  point) or `cut-heavy` (slam / cleave / execute) by `CUT_SLOT`, at `cutPitch(o)` (the synth's step up the
  chain, ±2 % alternate) and the weight's level (`CUT_SND`); the sub (thump.js) as before. `player:slam` →
  `slam`. `player:flurryHit` → `flurry-cut` (cue bus) at `f / base` of `streakSound.flurryCut` (or a whole
  tone a cut), at most `FLURRY.maxRate`, × `fastGain` in the storm's merged run. `player:flurryArt {dur}` →
  `flurry-coil` (align + skip + cut: its peak on the strike `dur` s on, cut there). `player:plunge` →
  `plunge-dive` (its peak `DEFENSE.plunge.dive` s on: the landing), `player:plungeHit` → `plunge-hit` (× `EXEC`
  on an execution). `combat:clash` → `clash` (heavy × 1.25). `dragon:guard` not a deflect → `boss-guard`
  (heavy × `GUARD_HEAVY`); a deflect → the synth `deflected`.
- `?sfx=old` (the default since ADR-178) / `?sfx=new` (`samples.js` `sfxMode()` / `setSfxMode()`, `DEFAULT_SFX`;
  the Lab's `sfx` row flips it live): `old` is exactly the sounds before: a tick on every tell, the flash's ping on
  every blow, all synth, no sound of a duelist's blade; `new` the recorded / designed sounds. The bank fetches
  nothing while the mode is `old` and loads when `setSfxMode('new')` runs.

**Recorded music (ADR-117).** The sound effects stay synthesised. The background music is recorded:
each level's exploring track and one track per boss phase, all CC0 from OpenGameArt, picked by the
owner (`audio/trackList.js` `SCORE`; files in `assets/audio/music/`, credits in
`assets/audio/CREDITS.md`). `audio/tracks.js` plays them; the synthesised score in `music.js` stays
the fallback.
- `_build()` makes `engine.tracks` (a `TrackBank`) and prefetches the compressed bytes of the
  level's tracks (`game.level.id`), plus victory and death. Nothing loads outside http(s) (a file://
  build, the headless tests) or with `?music=synth`: the synth score plays as before.
- `_setMusic(mode)`: 'ambient' plays the level's `explore` track; 'boss' / 'boss2' play
  `phases[n - 1]` for the boss's current phase `n` (`_bossPhase`: the higher of `game.dragon.phase` and
  `_phaseHint`, the latest phase a `dragon:phase2/3/4` event announced: the wyrm announces a phase at
  its transition roar and sets its number later; 'boss2' is at least phase 2; past the last listed
  phase the last one plays on; `_tick` follows a phase number that moves without a music call), so a phase change (flow's `setMusic('boss2')` on
  `dragon:phase2/3/4`) crossfades to the next phase's track (1.5 s); 'victory' / 'death' play the
  shared tracks (the death gong still tolls). The music state is the mode and the phase
  (`musicMode`, `_musicPhase`). A mode with no track (or a level with none) gets the synth layer,
  and the synth's boss ↔ boss2 intensity change still applies to it.
- A `TrackLoop` has the MusicLayer contract (`fadeIn`, `fadeOut`, `schedule`, `dispose`, `kind`
  'track', `fading`, `deadAt`); it starts when its track has decoded, loops from `loopFrom` with an
  `xfade` overlap (a few ms for loops written to repeat), and a track that fails to load sets
  `failed`, after which the engine swaps in the synth layer. At most 3 tracks stay decoded.
- The Lab's VIEW → "Recorded music" switches `tracks.enabled` and restarts the current mode.
  `scripts/build.mjs` copies `assets/` into `dist/assets/`; `scripts/audio/build-music.py` rebuilds
  the tracks from their OpenGameArt sources.

2026-11-09 additions:
- `sfx.js`: `parry {tell, chain}` (each deflect in a chain rings 2 semitones higher, up to 8 steps,
  with a bell 'ting' from the 2nd; the synth only: the recorded parry's chain is `parryChain.js`), `plungeDive {exec}` (on `player:plunge`), `plungeHit {exec}` (on
  `player:plungeHit`; a `player:hitDragon` of kind 'plunge' plays no ordinary hit sound). The flurry:
  `flurryCut {n}` per flash cut (a ring a whole tone higher each cut), `flurryCoil {dur}`, `flurryBurst {n}` as the
  hanging cuts open (all on the cue bus: crisp while the held world is muffled, `_slowDuck` for its length).
- A landed cut (`player:hitDragon`, not guarded: a guarded strike plays only its clash on
  `dragon:guard`): `hit {heavy, crit, part, damage, body}` (body 'cloth' against a duelist: a muffled
  slap, no scaly clack; its metallic ring only on a crit) and the blade's own layer `cut {weight,
  combo, crit, alt}` (not for a `shards` hit: the slam's blade is in the ground) (a slice through a
  falling band and a steel ring per weight, `CUT_SND`; a
  semitone up each hit of the chain, the finisher a step down, `CUT_STEP`; alt detunes alternate
  cuts; its noise offset from its own stream: `Voice.noise(kind, t0, t1, rate, off)` takes an
  optional 0..1 offset instead of Math.random).
- `audio/fire.js` (`FIRE_SFX`, `subscribeFire(on, engine)`): `dragon:spell` → skyStrafe `skyRoar`,
  diveBomb `diveScream`, meteorRain `meteorCast`, eruptions `rumble`, flameRing / flameWall
  `flameIgnite`, nova `novaCharge`; the whole body's blows reuse sounds: wingSlam `land`, tailSlam
  `crash`, tailWhip `takeoff`; a flying combo (`skyHunt`, `skyFurnace`, `skyCataclysm`) is played by
  its `part`: pass `skyRoar`, barrage `meteorCast`, dive `diveScream` (`SPELL_PART`); `dragon:hazard` →
  meteor fall `meteorFall`, hit `meteorHit`, `pillar`, `crash`, `novaBlast`; a `combat:tell` with
  `hazard: true` → `hazardTell` (lighter than the red brass sting, no music dip). Spatialised at the
  event's x / z. Bullet patterns reuse the casts: emberStorm / fanVolley / cinderSpit / fireWheel /
  fireLanes `flameIgnite`, emberRain `meteorCast`. A `combat:tell`
  with `bullet: true` plays nothing, its `combat:flash` plays the ping without the music dip, and a
  `dragon:parried` with `bullet: true` plays no yelp (the clash is `player:parry`).
- `dragon:phase3` replays the phase-2 sting and keeps 'boss2'; `dragon:plunged` → `dragonPain`
  (an execution: the `postureBreak` roar).
- `world:impact` by kind: 'chip' `chip`, 'wear' `wear` (2026-11-16, ADR-120: a quiet leaf hiss, a dry
  crack from stage 2, a low creak for the lean; gain 0.45, `gap` 0.14 s so a roar's front sets off a
  few, not hundreds; since ADR-180 the lean's creak only unless the living world's `air` and `answer` pieces are both on:
  then the tremor's `treeCreak` is the one creak), 'burn' `sizzle`, 'burnout' `emberHiss`, any
  other `crash`.

**The sound of the air (2026-11-23, ADR-163; `audio/air.js`, `?life=air`).** `engine.air` (`class Air`,
built in `_build` beside `engine.ambience`, updated after it): no node until the living world's `air`
piece is on; then a synthesized bed per level that follows the wind, the weather and the hush, taking
over today's bed's wind and voices through `ForestAmbience.windDuck` / `voiceDuck` (two unity gains: at
1, always with the piece off, the bed is exactly as before; the bonfire is on neither). Contract and
numbers: "The living world" → The sound of the air. `sfx.js` `footstep` plays the ground's own sound
when the payload carries a surface (the steps piece on), today's burst without one. **The living world's
one-shot sounds** (2026-11-23, ADR-180; `audio/lifeSfx.js` `LIFE_SFX`, looked up last by `play`; the
layers call them through `lifeSay` → `life.sound` → `play`, only with the `air` piece on): "The living
world" → The living world's sounds.

**The thump (ADR-149, `audio/thump.js`: `THUMP`, `THUMP_SFX`, `class Thump`).** `engine.thump`
(a `Thump`, no nodes of its own) runs on `player:hitDragon` after the engine's early returns (a
guarded strike, the plunge, a shards-only slam, a flurry's flash cuts): `onHit(d)` plays `sub`
(`play('sub', { k })`, the sfx bus; `THUMP_SFX` is looked up after `SFX` and `FIRE_SFX`) at
`strength(d) × impactK('thump')`, and on a `heavy` blow `dip(k)` on `engine.thumpDip`. The graph:
`musicBus → thumpDip → musicDip → mix` (`thumpDip` is 1 when idle; never on the cue bus). One dip per
`dipGap` 0.5 s; a blow inside a holding dip extends it to at most `dipMax` 0.45 s after it began.
Counters `subs`, `dips`, `extends` (tests).

**The streak, heard (ADR-167, `audio/streakSound.js`: `STREAK_SOUND`, `SCALES`, `TIMBRES`, `TRACK_KEYS`, `degreeSemis`, `perfectSound`, `tuneParry`, `class StreakSound`).** `engine.streakSound` builds nothing until it plays, and nothing at `streakK('sound')` 0. `onStreak(d)` (`player:streak`) holds a raise until `onDefence(kind)` (from `player:parry` of a blade, `player:perfectDodge`, `combat:clash`, `player:mikiri`) plays its climb note in the same call stack; `onTell()` (every `combat:tell` but a bullet's, every `combat:flash` but a bullet's) ducks its bus; `tick(now)` from `update`. Its own bus to the pause duck, at most 3 voices; the drone on `musicBus`. `flurryCut(d)` / `burst(d)` return the opts of `play('flurryCut' | 'flurryBurst')` (null when off); `parryTune()` gives `sfx.js` `parry` a `tune` (the chain on the scale); `perfectSound()` gives the perfect parry's `ring` and the Ghostep's `slow` factor for `perfectMode()`. The recipes it changes draw the same random numbers as before.

**A flurry's blow on a duelist (ADR-101).** `takeHit({ ..., exact, reel, away })`: `reel` 1 (a flash
cut) flinches him where he stands whatever he was doing (`brain.startReact('flinch')`, travel 0) and
does not shove him; `reel` 2 (the last blow) staggers him and `away` ({ x, z }: where the hero is
when the blow is over) picks the way he stumbles: away from that point. Any actor that takes the
flurry's hits may ignore both. **The afterimage** (`PlayerFx._afterimage(fx, segs, n, { dx, dz,
light })`, `blinkStream(fx, x, y, z)`, `blinkIn(fx, x, y, z)`) reads `PlayerFx.body` / `bodyN`:
world points of the hero's body, written by `player._sampleGhost()` (which calls `_sampleBody()`)
every time a pose is sampled.

### Lab — `src/dev/lab.js` exports `class Lab`
```
constructor(game)          // hidden unless URL has ?lab or the user presses F1 / backquote / the LAB button
update(realDt)             // panel refresh + hitbox overlay (runs before flow)
postUpdate()               // main.js calls it after the actors update so the overlay matches this frame
postRender()               // main.js calls it right after the frame is drawn (same task): the model viewer's sheet reads it back
open: boolean
showroom()                 // look-dev preset: fight on, AI off, god mode, hero 7 m in front, camera close
modelView(opts | null)     // model viewer (below)
```
**Floating toggle** (`.lab-badge.lab-toggle`, bottom centre: the boss's rows hold the top centre): shown whenever
the Lab exists in the page (`?lab`, or opened once) or a Lab cheat is active; a tap / click opens or
closes the panel (phones have no F1). Closed it reads `LAB` (+ `· god · x0.25 …` while cheats run),
open `× LAB`. The panel's own `×` and the toggle are 36 px touch targets on coarse pointers / touch.
Small screens (≤ 560 px tall or ≤ 700 px wide): a compact panel with a max-height that always fits
and scrolls inside (`touch-action: pan-y`). VIEW → **Touch UI** switches the touch controls on / off
(desktop testing of the phone layout, camera and quality).

Debug panel to test the fight without playing it: trigger any `dragon.debug.abilities()` (the
strings and fire attacks show up on their own), Phase 2 / Phase 3 (`dragon.debug.phase3()`: the
transition roar; with the AI on it opens with the nova) / stagger / posture break / kill / reset,
jump flow states, god mode, infinite flasks, time scale, AI on/off, hitbox overlay, teleport. Talks
only to the `debug` APIs above, plus the `game.viewOverride` and `world.debug.setVisible` hooks for
the model viewer. The timing trainer also logs `combat:deflectChain`, `dragon:phase3`,
`dragon:phase` and `dragon:plunged`. Captures start the plunge with `player.debug.plunge(execution)`.
Since 2026-11-16 (ADR-120): FIGHT → **Ablaze** cycles the phase-3 fire off / a / b / c
(`dragon.debug.ablaze`); WORLD → **Wear wall** (a tail's blow, power 1, on the nearest standing wall
tree or landmark piece: watch its stages) and **Wreck wall** (blasts and fire in the wall straight
out behind the hero) and, since 2026-11-21 (ADR-125), **Open wall** (every tree of the wall in a wedge
straight out from the hero falls, out to 52 m: the ground opens there, the minimap redraws, the wyrm
can follow); PLAYER → a **head** row (`?wyrmFace=`, reloads the page), since 2026-11-20 a
**build** row (`?wyrmLook=`: before / a / b / c, reloads the page; ADR-123) and a **zoom art**
row (`pipeline.setZoomArt('a' | 'b' | 'c')`, live).
**LOOKS** (ADR-122; `dev/labLooks.js`, only in `ash` / `starless` / `ring`, collapsed until opened): a row per look
switch of the duelists' second pass (`LOOK_SWITCHES`: name, options, default, pick, build-time, levels,
label). A switch read at draw time flips live through `setLook`; one read at build time (`ashLook`,
`lordLook`, `floor`) reloads the page with its parameter. The Skybreak Ring's rows (ADR-129), each group
under its own heading comment: `ring` a / b / c (the arena; a reload), `ascLook` a / c / d (his body; a
reload), `ascLift` 0 / a (his figure lifted off the floor; a reload), `ascAura` a / b / c, `ascBeam`
a / b and `ascOrb` a / b (the great orb, the third wave; live); all picked 'a' (STYLE.md "The look
switches"). "as shipped" clears every look parameter (the
owner's picks), "before this pass" reloads with `?looks=old` ("all proposals" is gone: `?looks=new` now
equals the default). A later phase's or form's move, and the
phase / form buttons, play from any phase (the Lab skips there first, without playing the change).

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
  spin,     // true: turntable, the yaw turns 36°/s of real time (one fit for the whole turn)
  sheet,    // true: every SHEET_VIEWS angle at once in live tiles (below)
  look,     // hero look-dev render: 'ascii' (play) | 'solid' (U.uHeroSolid) | 'source' | 'lines' (uHeroDebug 1 / 2)
})          // → { target, yaw, pitch, dist, height, forward, dark, solo, game, lockYaw, spin, sheet, look, auto: {dist, height} }
__game.lab.modelView(null)   // → 'off': game camera, HUD, world, AI, god mode and the ascii look restored
```
Angles (`VIEW_ANGLES`, the Lab buttons): Front 0, 3/4 L 35, 3/4 R 325, Left 90, Right 270, Back 180,
Rear R 215, Rear L 145, Game (the gameplay camera at the rig's distance: normal play size), plus Spin,
Sheet and the four looks (ADR-035). **Sheet** (`SHEET_VIEWS`): ten tiles on a full-window 2D canvas
(`canvas.lab-sheet`, z 1: over the game canvas, under `#ui`, so the Lab panel stays usable), laid out
right of the panel: the reference sheet's front, front 3/4, right side, back, rear 3/4 and the left
side and rear-left 3/4 at eye level (one auto-fit for the whole turn, the body centred on its root),
and the gameplay camera's pitch and distance on his back, front and right side (yaw around his
facing: the same picture as the real camera with him turned so), drawn ×2 nearest-neighbour. Each
angle is held for two frames and copied out of the WebGL canvas in `postRender` on the second (the
hero's materials read the camera one frame late), so a tile refreshes every 20 frames.
While viewing: dragon AI off and player god mode on (each restored on exit only if the viewer
changed it), every HUD layer in `#ui` is faded out (class `lab-mv`; the Lab panel stays), the hero's
mouse aim is pinned along its facing (it never chases the cursor through a side camera), and the
camera follows the actor each frame (`lab.postUpdate`, before main.js applies the override). The
auto-fit is measured at the call (and again on resize / Lab panel open-close) from the per-mesh
bounding boxes of the current pose (the source meshes; rigid batch meshes, `userData.rigidBatch`,
are skipped); with the panel open the actor is centred in the free area to its
right. `solo` hides the other actor only between `lab.postUpdate` and the next `lab.update` (the
actors never see their `visible` flag change). Poses are driven as usual — `dragon.debug.trigger(name)`,
player inputs / methods — and stepped with `__tick(dt, frames)`.

**Training** (`dev/training.js` `class Training`, `lab.training`; panel `dev/trainingPanel.js`,
`lab.trainingPanel`; ADR-099). `SITUATIONS` is data: `{ id, cat, name, desc, boss (kinds: 'wyrm' |
'duel' | 'ash' | 'lord' | 'asc' | 'any'; `bossKinds` gives Tian Lei 'duel' + 'asc', from `kit.id ===
'ascendant'`, not 'lord', whose situations need the crater), role (a boss move by role: single / string / long / red / lock /
mikiri, per level in `ROLES`), dist / wyrmDist / ang, streak, foe, art, hp, god, ai, answer (an
`ANSWERS` key, or (i, T) → key per glint), go(T), tick(T, dt), after(T), until(T), tail, max, expect
[events] }`. `list()` filters them for the boss loaded (`bossKinds(game)`) and appends one BOSS
MOVES situation per `dragon.debug.abilities()` entry. `run(id)` → phases prep (flow to `boss`, AI,
god, pins) → settle (boss and hero free; else the flow's boss jump) → place (teleport, heal, the
streaks via `player.debug.streak` / `dragon.debug.streak`) → run (go; every `combat:flash` from the
boss schedules its answer `lead` s before the impact; `until`) → tail → done (`lastResult` = { id,
ok, missing, secs }). It drives the hero only through `game.input.setVirtual` /
`setVirtualAxis` (the sims' mock: press / up / hold / release / axis) and aims with
`game.mouseGround`. `lab.update` calls `training.update(realDt)` every frame; it uses game time.
Tian Lei's (ADR-129; `ROLES.ring`: single `meteorStep`, string `gates`, long and lock `hundred`, red
`cometHeel`, mikiri `piercingPalm`): `mikiriAsc` (a roll into Piercing Palm), `form2a` / `form3a` (the
two transformations), `ascClash` (the great beam's head parried perfectly: the clash, mashed), `ascTide`
(Rising Tide rolled out of at its cue), `ascTideHit` (Rising Tide stood in), `ascTile` (Tile Kick taken);
the ki / terrain ones start their move in its own form (`debug.setForm`, then `debug.trigger`) and act on
the beat's own clock, not on the flash (a beam's and a thrown slab's cues are hazards: the runner's
answers skip them). The runner's watch list gained `dragon:phase2`.

**The 'impact' row** (ADR-149): one on / off toggle per piece of `IMPACT.pieces` (stamp, ripple, react,
thump); a click flips `IMPACT.on[piece]`, read at the next hit. `_syncCutBtns` lights them.

**The 'life' rows** (2026-11-23, ADR-163; WORLD, at its foot, `_buildLife`; not built where
`world.life.enabled` is false: the training room): `life` one toggle per piece of `LIFE.pieces` (wind,
litter, steps, weather, creatures, air, arrival, answer; a click flips `LIFE.on[piece]`, live); `life x`
all / off (`setLife`) and quiet / natural / strong (`setLifeK` 0.6 / 1 / 1.5); then one button per
`world.life.actions` entry, in the order the layers registered them: the wind's gust front, burst at
hero, lull; the weather's '<spell> now' per spell of the level; the litter's leaf shower, scatter at hero;
the steps' surface here, stamp; the creatures' startle at hero, birds return, and since ADR-177 flock
flees (the roost nearest the camera's focus with birds bursts out, away from the hero, past the gap),
animals bolt (every animal within 60 m of the hero), life returns (the roosts full again, a few birds
flying in to one, the animals back, the birds on their perches); the answer's roar's answer, hush 2 s; the
tremor's tremor at hero (a 1.4 blow beside him); the aftermath's smoke at hero, crater dust at hero;
since ADR-180 the lamps' light lamps (every standing lantern catches, the nearest the hero first), gutter
at hero (a heavy shock at him: the lamps near him gutter, the nearest lit one at least), lamps out (every
burning lantern dark in a puff; they can be lit again); arrival (replay). (No button for the mow: swing
in the grass.) A button's status line is what its `run` returned. `_syncLifeBtns` lights them.
**Blade** (ADR-177; WORLD, beside Bites): `Blade: through` / `Blade: stops` flips `?cutStop` live
(`setLook('cutStop', ...)`; read at each swing).
**The 'streak' row** (ADR-167): one on / off toggle per piece of `STREAK_FX.pieces` (storm, tiers, aura,
counter, sound, world), `tempo` (flips `STREAK_FX.tempo`: the storm's tempo, read as a flurry starts), `chain` (flips
`STREAK_FX.chain`: the flurry's chained paths, read as a flurry starts), `figure: any` (cycles
`STREAK_FX.figure` through 'any' and the figures),
a `perfect: <mode>` button that cycles today / sharp / cinema
(`setPerfectMode`), and `burst N` that cycles the burst level 0 - 3 (`setBurst`). `_syncCutBtns` lights
and labels them.

### Bindings — `src/core/bindings.js` (ADR-067)
```
ACTIONS                     // [{ id, label, kb: [codes] | null, pad: [buttons] | null, fixed? }] — the defaults
new Bindings(storage = localStorage)   // loads 'gcd.bindings.v2' (ADR-115: a v1 save is not read); storage null = defaults, nothing saved
codes(a) / buttons(a)       // the keyboard-mouse codes / pad button indices bound to action a
bindKey(a, code) / bindPad(a, i)   // replace a's binding; false when refused (reserved, fixed, wrong device)
reset(save, 'kb' | 'pad' | null);  isDefault(which);  onChange(fn) → unsubscribe;  version
keyText(a, all) / padText(a, layout, all) / moveText()   // on-screen names ('E', 'Tab / MMB', '△', 'WASD')
keyLabel(code) / padLabel(i, layout);  installActions(input, bindings)   // the act* API (Input, test mocks)
```
Actions: up, down, left, right (keyboard only), attack (the light), heavy, block, dodge, sprint, flask, lockOn,
interact (rest / fight again), help, mute (keyboard only), zoomIn, zoomOut (pad only), pause
(fixed: Esc / the pad's Menu). Defaults (ADR-115): attack LMB / R1, heavy RMB / R2, block MMB / L1 L2, lockOn Tab /
R3, dodge Space / A. Keyboard codes are `KeyboardEvent.code` or `Mouse0`-`Mouse2`; pad
buttons are standard-mapping indices. **Every action also answers to its virtual code `'@<id>'`**:
the touch and gamepad layers press those (so a keyboard remap never moves a touch or pad button).
A rebind removes the code / button from every other action; an action left with nothing takes the
rebound action's old ones (a swap), so no action is ever unbound. Reserved, never bound: Esc, F1,
F2, F3, Backquote; the pad's Menu (9). Saved on every change; on load, junk and unknown actions are
dropped, a key stored twice keeps its first action, and a device left with an unbound action goes
back to its defaults. Defaults = the controls before ADR-067 (plus R as a second interact key).
**Key chips** (`ui/dom.js`): a `[@action]` token in `fillKeyText` (prompts, hints, title, menus)
becomes a chip showing the bound key, or the pad button while a pad is in use (`@move`, `@aim`,
`@zoom` are pseudo actions: WASD / LS, Mouse / RS, Wheel / the D-pad); `controlsGrid(parent, 'kb' |
'pad')` builds a device's grid from the same chips. `setChipSource({ bindings, padActive(), layout() })`
(the HUD) and `relabelChips()` (on a remap, a device switch, a pad layout change) keep them current.
**The CONTROLS panel** (`ui/remap.js` `RemapPanel`, `hud.remapUi`; the pause menu's CONTROLS item,
hidden on touch unless a pad is in use): tabs KEYBOARD · MOUSE / CONTROLLER (opens on the device in
use), one row per remappable action; pick a row, then press the key / mouse button / pad button.
`open()`, `close()`, `setTab(t)`, `begin(id)`, `cancel()`, `resetTab()`, `capturePad(i)`, `on`, `tab`,
`waiting`, `rows`, `navButtons`. Its window capture listeners (keydown, mousedown, click) swallow
the key being bound (`stopImmediatePropagation`: the game and the Lab never see it), Esc cancels a
pick or closes the panel (not the pause menu), the click that ends a binding mousedown is eaten.

### Gamepad controls — `src/ui/gamepad.js` exports `class GamepadControls` (ADR-066, ADR-067)
```
constructor(game)          // inert until navigator.getGamepads() reports a pad and it is used
active: boolean            // the pad is the device in use: its last input is newer than input.kbmT and input.lastTouch
connected; layout ('xbox' | 'ps', from the id: Sony's vendor id 054c); autoAim; focus (menu index)
actionText(a)              // the pad button bound to action a ('△'), or null when the pad is not in use
rumble([ms, strong, weak]) // dual-rumble on the pad; nothing where vibrationActuator is missing
update(realDt)             // main.js, after the mouse ray, before the touch layer / Lab / flow / player
```
Polls once a frame (the `standard` mapping preferred) and, for every action with pad buttons
(`input.bindings`), holds `'@<action>'` with `input.setPad` while one of its buttons is down, so tap vs
hold timings are the real device's. Play states (everything but `title` and `paused`):

| button (standard index), default binding | feeds | behaviour |
|---|---|---|
| LS (axes 0, 1), fixed | `setPadAxis` | radial dead zone `CONFIG.gamepad.deadZone` 0.2, full run at `runAt` 0.9; stick up = north |
| RB 5 / RT 7 | `@attack` | tap = light combo, hold = charge, release = the cleave (triggers 6 / 7: on ≥ 0.5, off < 0.3, whatever they are bound to) |
| LB 4 / LT 6 | `@block` | hold = block, tap = parry |
| A 0 · B 1 · X 2 · R3 11 | `@dodge` · `@sprint` · `@flask` · `@lockOn` | dodge · hold to sprint · flask · lock-on |
| L3 10 | `@sprint` | a stick click (10 / 11) bound to sprint latches it until the stick returns to centre |
| Y 3 · View 8 | `@interact` · `@help` | rest / fight again · help |
| Menu 9, fixed | `@pause` | pause (never remappable) |
| D-pad up 12 / down 13 | `cameraRig.zoom(∓1)` | the zoomIn / zoomOut bindings (pad-only actions) |

**Aim** (`explore` / `bossIntro` / `boss`, unless the touch controls are on): the right stick past
`aimDeadZone` 0.35 steers `game.mouseGround` `aimDistance` m ahead along it; idle, it auto-aims on the
boss's lock point within `autoAimRange` (32 m), else ahead along the last move direction.
**Menus:** `title` — any face / shoulder / trigger / Menu / stick-click button `input.pulse('Gamepad')`
(dismisses "press any key"); D-pad left / right walks `titleUi.stageButtons`, A on another stage
clicks it. `paused` — focus opens on RESUME, D-pad / LS up-down move it (repeat every `menuRepeat`
0.22 s while held), A clicks, B or Menu = `@pause` (resume). With the CONTROLS panel open: LB / RB
switch its tabs, the focus walks its rows + RESET + BACK, A picks a row (on the CONTROLLER tab the
next pad press is the new binding: `capturePad`; Menu cancels), B / Menu close the panel only.
Menu-screen buttons (A, B, D-pad, LB / RB, Menu) are fixed: a remap never changes them. **A button held across a menu ↔ play
change counts only after it is let go** (the title's A never rolls, the resuming B never sprints; likewise after any CONTROLS panel press);
the press that makes the pad active counts. Inactive (keyboard / mouse / touch used since): every
pad hold is released. A pad unplugged while active in a play state pauses the game.
`gamepadconnected` / `gamepaddisconnected` log a system line. **Rumble** (`CONFIG.gamepad.rumble`)
on `player:hurt`, `player:guardBreak`, `player:guardOpen`, `player:block`, `player:parry` (perfect stronger, a bullet
lighter), `player:perfectDodge`, `player:hitDragon` (not guarded: `hitHeavy`, else `hitLight`); only while active.

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
| stick (left thumb, floats under the thumb in the left 42 % × lower 74 %) | `setVirtualAxis` | analog: dead zone 0.16, full run at 0.62 of the 52 px travel; ≥ 0.94 (rim) holds `@sprint` (off below 0.86) |
| ATTACK (pad tile) | `@attack` | tap = light combo, hold ≥ 0.3 s = charge, release = the cleave; shows an ASCII charge meter `[###...]` |
| the padlock (`.tc-padlock`, over the pad's top-left corner) | — | open (`setEditing(true)`): a drag on the pad moves it and presses nothing; shut: kept there |
| BLOCK (pad tile) | `@block` | hold = block, tap just before impact = parry; a gauge along its foot is the guard meter |
| DODGE (pad tile) | `@dodge` | roll / perfect dodge |
| FLASK (rides with the pad) · LOCK · PAUSE (glyph `\|\|`, both top right) | `@flask` · `@lockOn` · `@pause` | flask count, LOCK lit while locked on |
| the HUD prompt | `@<action>` from its `[@interact]` chip | rest at the bonfire / fight again |
| a bare-screen tap on title / death | `Mouse0` | "press any key" |
| two bare-screen fingers in play | `cameraRig.zoom` | pinch (distance × start / now) |
| a quick flick on the bare right half in play (SWIPE DODGE on; ADR-278) | `input.dodgeToward(dx, -dy)` | fires once the finger has gone `swipe.dist` px (× fit) within `swipe.time` s of touching down; a second bare finger cancels it |

**The pad** (ADR-096; `CONFIG.touch.pad`; four tiles since ADR-115, laid out again in ADR-270): HEAVY
over ATTACK, BLOCK beside ATTACK (where DODGE stood) and DODGE right under ATTACK, so ATTACK shares an
edge with each of the other three; the FLASK button stands where BLOCK stood (top left, its own
button: the slide never drinks). Raised and inset from the corner, further in than before (the thumbs
of a hand holding the phone rest left of the edge). HEAVY carries the charge meter while it is held. The pad is one pointer surface (`.tc-pad`; the tiles
take no pointers themselves): a touch on it, or up to `reach` (26 px) outside the cluster, presses
the nearest tile, and a thumb that **slides** onto another tile releases the first and presses the
second without lifting (release edge first; it must leave its tile by `stick`, 10 px; a slide that
wanders further than `reach` from every tile keeps what it holds). Each finger holds its own tile.
The player places the cluster in the pause menu: PAD POSITION (low / mid / high: `pad.pos`) and
PAD SIZE (small / medium / large: `pad.size`), kept in `localStorage` (`gcd.touchPad`); the
controls show through the pause screen, inert, while they are stepped (`.tc-root.peek`).
**The padlock** (ADR-270): a small button over the pad's top-left corner. Tapped open
(`setEditing(true)`, `.tc-root.editing`: the pad dashed, DRAG TO MOVE and a RESET button over it) a
drag anywhere on the pad moves the whole cluster (its flask and padlock with it) and presses nothing;
tapped shut it stays there. The drag is `padOff` (px at fit 1, + left / + up from PAD POSITION's
place), clamped on screen and kept in the same `localStorage` entry (`off: [x, y]`);
`resetPadOffset()` puts it back. The padlock shuts itself when the controls go away (pause, the end of
a fight). **The fit** (ADR-270, `pad.fit`): the whole layer scales with the screen, `fit = clamp(min(short
side / base[0], long side / base[1]), min, max)` (390 / 760, 0.62 - 1.25): an iPhone on its side is 1, a
small near-square screen (a fold's cover screen) 0.62 - 0.7, a tablet up to 1.25. The tiles, the
flask, the stick (its ring, knob and travel: `stickRadius` × fit), LOCK and PAUSE all follow it
(`--tc-f` on `.tc-root`; `--tc-k` = fit × PAD SIZE for the pad). API: `padPos`, `padSize`, `padOff`,
`fit`, `editing`, `cyclePad('pos' | 'size')`, `setEditing(on)`, `resetPadOffset()`, `padPoint(id)`
(the screen point at a tile's middle), `padGeo`.

**The fight starts locked on** (ADR-270, `CONFIG.touch.autoLock` s): on touch (not with a pad in use)
`flow._enterBoss` arms `autoLockT`; each boss frame until it runs out `flow` calls `player.takeLock()`
(the LOCK button's toggle, taken only when off and in range), so the hero locks on as soon as the boss
can be locked. LOCK still drops it.

**Two more pad switches** (ADR-131; pause menu, kept in the same `localStorage` entry, both off by
default; `?pad=split|classic` and `?hold=1|0` set them for one page load):
- PAD LAYOUT (`layout`: `'classic'` | `'split'`, `cyclePad('layout')`). In `split` the guard is the
  left hand's: the cluster keeps ATTACK, HEAVY and DODGE (`pad.split.tiles`; the flask stands where
  BLOCK stood) and GUARD is a button of its own (`.tc-guard`, feeds `@block`, carries the guard
  gauge) `pad.split.guard.gap` px right of the stick's ring on the cluster's bottom line; held upright
  it stands above the ring (`pad.split.guardPortrait`). `.tc-root.split` shows it and hides the
  BLOCK tile; `padPoint('guard')` / `guardGeo` give its place (null in `classic`). Changing the layout
  releases every held control. ADR-278: GUARD stands against the ring (`gap` -6 px, its edge just over the
  ring's glyphs; upright `lift` 4 px) and has a padlock of its own (`.tc-guardlock`, over its top-right corner,
  shown in `split` only). The two padlocks are one lock (`editing`): open, a drag on GUARD moves it
  (`guardOff`, px at fit 1, + right / + up, kept on the left half, saved as `goff`) and raises no guard;
  RESET (`resetPadOffset()`) puts GUARD back too. Also in `split` (ADR-278, the owner): a second guard, the
  BLOCK tile (`@block`, the guard gauge too), stands right under ATTACK in the cluster (`split.tiles.block`;
  ATTACK, HEAVY, DODGE and the flask moved up by its height), so either thumb can guard and a slide from ATTACK
  raises it. The left GUARD is drawn like the tiles (their corner brackets, a fainter frame, resting opacity
  0.4) and the padlocks are bare icons at 0.34 (0.9 open), with no disc or frame: nothing of the layer should
  pull the eye in play.
  **The guard switches** (ADR-278, the owner: "options in settings to remove either left or right guard button ...
  change the button layout"): three pause-menu entries, kept in `gcd.touchPad`. PAD LAYOUT (`layout`) is only the
  right cluster's arrangement now: `classic` BLOCK beside ATTACK and DODGE under it, `split` DODGE beside and BLOCK
  under (`pad.tiles` / `pad.split.tiles`, both with a `block`). LEFT GUARD (`leftGuard`, `lg`, off by default)
  draws the GUARD beside the stick (`.tc-root.lguard`); RIGHT GUARD (`rightGuard`, `rg`, on) keeps the BLOCK
  tile in the cluster (off: it is left out of `padGeo.tiles` and hidden). One guard always stays: turning the
  last one off turns the other on. `cyclePad('layout' | 'lguard' | 'rguard')`; `?pad=split|classic` sets the
  arrangement (split also shows the left GUARD, as before), `?lguard=1|0` and `?rguard=1|0` the guards. A pad
  saved before these (`layout: 'split'`, no `lg`) reads as the left GUARD on.
  Then (the owner): both are named BLOCK (the left button's label; LEFT BLOCK / RIGHT BLOCK in the menu); no
  gauge line under either (the HUD's GD meter shows the guard; a low guard warms the glyph, `.low`); ATTACK's
  dagger points down (`scaleY(-1)`); in landscape the left BLOCK is centred on the stick. The left side's look
  is a switch for the owner to pick (`?leftLook=a|b|c`, `touch.leftLook`, `.tc-root.look-*`): `a` quiet (a faint
  ring, a bare knob, BLOCK in corner brackets only), `b` a pair of tiles (the stick in a square tile of the pad's
  brackets, the ring dotted, BLOCK the same height against its edge), `c` glyphs only (the ring's four arrows at
  rest, no frames). The owner picked `c`, the default. `?pad=split` now only turns the left BLOCK on (the owner
  swapped DODGE and BLOCK back: BLOCK beside ATTACK, DODGE under it, the default arrangement); `?pad=under` is
  the BLOCK UNDER arrangement, `?pad=classic` the left BLOCK off. The saved pad carries `v: 2`; an older save's
  `layout` is ignored (it was `split` for the left guard), so it takes BLOCK beside ATTACK.
- SWIPE DODGE (ADR-278; `swipeDodge`, `cyclePad('swipe')`, `?swipe=1|0`; `CONFIG.touch.swipe`): a finger that
  touches the bare screen right of `swipe.from` (half the width) during play and travels `dist` px (30, × the
  fit) within `time` s (0.2) dodges the way it went (`input.dodgeToward`), once per touch, at that moment (not
  on the lift); a slower drag and a second bare finger (a pinch) are no swipe. A short ASCII streak (`.tc-swipe`)
  fades where it went. The DODGE tile stays. On by default (the owner's pick); kept as `sw` in `gcd.touchPad`
  (a new key, so the default reaches a player who saved the pad before).
- HOLD ATTACK (`holdAttack`, `cyclePad('hold')`; `CONFIG.touch.hold`). While a finger rests on ATTACK
  the layer sends one press edge of the attack action (`input.pulse('@attack')`) `after` s into the
  hold and then every `every` s: the player reads each as a tap. No repeat while BLOCK / GUARD is
  held (the guard has the hero) nor for `quiet` s after DODGE, HEAVY or FLASK was pressed (the
  repeat must not write over that press in the input buffer).

**The page never zooms** (ADR-116): iOS Safari ignores `user-scalable=no`. While the layer is on it
cancels `gesturestart` / `gesturechange`, `dblclick`, `touchmove` (outside the Lab, the pause panel and
the WHAT'S NEW list, which scroll) and `touchend` on the canvas and inside `.tc-root` (non-passive): the
canvas and the controls run on pointer events only. Anywhere else (the menus) the second of two
touchends within `DOUBLE_TAP_MS` (350 ms) is cancelled too and a `button` / `.ab-btn` under it gets its
`click()` by hand. If the page is zoomed anyway (`visualViewport.scale` > 1.01), `_unzoom()` rewrites
the viewport meta (Safari lays the page out at scale 1 again; counted in `unzooms`). `?camdebug`: a
fixed one-line readout (`.tc-camdebug`): page scale, fixes, camera distance and base, canvas vs window size.

**Aim** (`game.mouseGround`, each frame in `explore` / `bossIntro` / `boss`): with the dragon
targetable and within `CONFIG.touch.autoAimRange` (32 m) it is the dragon's lock point (attacks,
facing and the camera look-ahead go to it, like a cursor parked on it); otherwise it sits
`CONFIG.touch.aimDistance` (6 m) ahead of the hero along the last stick direction. LOCK still toggles
the real lock-on. Controls show only in play states (hidden on title / pause / death / victory /
model viewer); hiding releases every held control. **Portrait** (`innerHeight > innerWidth`;
ADR-097): the game plays on. `portrait` is true, the stick's zone is the lower left (50 % × 46 %),
the pad takes its place from `pad.posPortrait` (low / mid / high, lifted from the bottom edge),
the stick rests level with it, and the camera takes the upright profile
(`cameraRig.setMobile(phone, portrait)`). Turning the phone releases every held control.
**Look** (ADR-097): the controls are drawn on the game, not over it: no filled panels, faint
outlines and glyphs at rest (stick 40 %, buttons 62 %), full strength under a thumb. Activation
also: `html.gcd-touch` (touch-action none, no callouts, crisp `image-rendering: pixelated`),
`.ab-touch` on the HUD, the phone camera profile, and `CONFIG.defaultQualityTouch` when the
quality is still the default. Pointer Events with multi-touch (each control captures its own
pointer); long-press menus, iOS gesture zoom and page panning are blocked while active (the Lab
panel and the pause panel still scroll). Tuning: `CONFIG.touch`, sizes / look in `ui/touchStyle.js`.

## Destruction (2026-11-14, ADR-107; the clearing breaks: 2026-11-15, ADR-119; the whole forest wears down: 2026-11-16, ADR-120; the duel arenas and their floors: 2026-11-16, ADR-122): the world breaks
Files: `src/world/destructibles.js`, `wreckage.js`, `fire.js`, `scars.js`, `floor.js`, `breakTuning.js`. Every boss
and the hero chip, break, fell and burn what stands in a level; cover stops projectiles until it gives
way; a boss can lift a piece and throw it; what falls lies as wreckage until the fight resets. The rules
as the player meets them: COMBAT.md "The world breaks". Numbers: `world/breakTuning.js` (`BREAK`,
`FIRE`, `SCAR`, `BLOW`, `QUALITY`; `BREAK.floor` and `BREAK.colossus` since ADR-122).

**POWER** is the one scale every blow is put on (0 a touch … 1 fells a tree): 0.12 a quick cut, 0.3 a
duelist's cut, 0.5 a heavy cut, 0.8 a claw or the hero's charged cleave, 1.0 a tail / slam / thrown
stone, 1.5 a meteor or a bolt of the Void, 2.5 the dive's crash. A piece loses power x its material's
factor for that kind of blow (`BREAK.mats[mat].take[kind]`: a cut bites stone at 0.7, a blunt blow or a
blast in full); below `BREAK.scratch` it only takes a mark. A **brush** (`o.brush`: a boss's body
walking, turning, shouldering into a piece) only bites with what it has over `BREAK.brush` 0.55 x the
piece's structure, but at least `brushMin` 0.4 of itself (a body that keeps pushing still fells a tree
in a couple of seconds; a turn only shakes it), once per `brushRehit` 0.3 s, and a flat stone (a
flagstone, lower than `brushFlat` 0.3 m) takes nothing from it.

**Making a new object destructible** (the rule for every level, ADR-107 / ADR-132; CLAUDE.md "The
world breaks"). Every background object in a level breaks, and since ADR-132 a hit takes its letters
off where it lands. For a new object, a new set or a new level:
1. **List it.** Push a definition into the set's `breakables` (the table below) instead of merging it
   into the static meshes. Give it `kind` (free; AI and tests read it), `mat` ('wood' | 'stone' |
   'metal' | 'bone': what bites it, its debris, its sound), its base `x, z`, a footprint `r` that
   matches what is drawn (the circle the hero's blade crosses and marks; with `?cutStop=1` it stops
   there, `BREAK.chip.stop.touch`), `h`
   (`geosHeight(geos)`) and colliders if it blocks. Leave `hp` to the default (material x size) or give
   a finite number; `hp: Infinity` means it only chips and is never bitten (the bronze bell).
2. **Draw it on one of the two breakable paths.** `look: 'range'`: its body is a run of a set's merged
   mesh (`forest.js` `Runs.add(geos, leaf?, fine?)`; the trees, the landmarks), cheapest for many
   pieces. `look: 'prop'` (prop art, the house style) or `'grid'`: its `geos` go through the
   breakables' rigid batch (stones, pillars, statues, arena props). Either way it is NON-INDEXED
   triangle geometry (`prep()`), in world space, with the material's attributes (`carve()` / `paint()`).
   Its bricks are made from those triangles: no cube grids, no hand-made fragments. With bites on, the
   level is cut to brick size when it is built (`refine`, `BREAK.chip.brick` 0.8 m), parts that are
   already thin are left alone, and every piece's bricks are made at load (a piece of 4000 triangles
   costs ~10 ms there, nothing in play).
3. **Say which parts are foliage.** For a range piece, `Runs.add(geos, leaf)` marks foliage parts:
   foliage is holed brick by brick; a solid part (trunk, stone, bone) keeps a skin, set back where it
   was struck. A closed solid needs nothing more; an open sheet (a wing membrane, a cloth) is holed.
4. **Give it a stump or rubble if it falls.** `broken` (what is left standing), `topples`, `wreck`, as
   the table below. A tall piece the hero fells lands on whoever is under it (red tell from a boss).
5. **Hit the world from anything new that hits**, with the blow's real height (`o.y`; a blade's
   segment: `o.ya` / `o.yb`), its way (`dx, dz`), its kind (`BLOW.CUT / BLUNT / BLAST / FIRE`) and one
   `src` per swing. `strike` (a disc: it eats the side that faces the blast), `sweep` (a segment: it
   bites where the segment met the piece), `stop` (a projectile). `destructibles.struck` says what the
   last call met. A blow that meets the FLOOR (a slam, a blade in the ground, a landing, a beam's
   trench) also calls `world.groundBlow(x, z, o)` with its kind (or, in the duelist engine, its beat
   gets a `groundMark`): the floor keeps the mark until the reset ("Floor marks" below; ADR-177).
6. **Test it.** The world test `bite` walks the level registry (`src/levels/index.js` `LEVELS`): a new
   level is checked with no change (it lists breakables, every piece that takes structure has bricks,
   a blow on one of each kind bites it, the reset puts them back). Run `node
   tests/integration/world.mjs . bite`; look at it in the browser (`?level=<id>`; `?chip=0` is the
   game without bites, for a before / after).
   A set whose scenes morph (ADR-157: `scenes`, the Hall of Falling Script) tags each piece of a scene
   `scene: '<id>'`; `bite` visits every scene of such a set.
7. **Leaving something whole is a decision**, the owner's, written in DECISIONS.md: the bonfires (a
   checkpoint), the sect gate, the bell (it only rings: `hp: Infinity`), the throne and its dais, the
   fallen star and the seal, the Hall of Falling Script's bonfire, the Last Foundry's bonfire, its blast
   furnace's body (listed with `hp: Infinity`: it chips, never breaks), the pour's kerb and crust (not listed: the
   channel is the level's hazard) and its wreck field past `FOUNDRY.staticR` 30 m (a static mesh where no blow
   reaches; ADR-285), and the training room (`?stage=lab`, ADR-099: a measuring stage, its tiles,
   walls and pylons stand outside the fight; the test checks it lists nothing). Floor slabs break as
   slabs (`floor: true`: whole, cracked, broken; never bitten), the ground itself does not break yet
   (ADR-132 "Not done"; since ADR-177 it keeps a mark of each blow's kind: "Floor marks").

**A set's `breakables`** (built in the set builder; `forest.js` and `courtyard.js` are the examples). One entry:
| field | what |
|---|---|
| `kind` | 'tree', 'deadTree', 'stone', 'boulder', 'pillar', 'lantern', 'stele', 'bell', 'flagstone', 'bone', 'helm', 'sword', 'elderRib', 'elderSpine', 'cinderBough', 'cinderTrunk', 'nestRib', 'nestSkull', … (free; boss AI and tests read it) |
| `mat` | 'wood', 'stone', 'metal' or 'bone' (structure, what bites it, its debris and sound) |
| `scene` | (a set with `scenes`, ADR-157) the scene it stands in; out of the world in the others (`present`) |
| `look` | 'grid' (geometries with `paint()` attributes: the screen grid), 'prop' (`carve()` attributes: prop art) or 'range' (its body is a run of vertices in a static mesh of the set, drawn by the set's own material: the flagstones; since 2026-11-16 every tree of Cinderwood, the Cinder Tree's boughs and trunk, the Elder Wyrm's bones and the nest's ribcage and skull) |
| `x, z, r, h` | its base (world), footprint radius, height (`geosHeight(geos)`) |
| `geos` | its geometries in WORLD space, as the builders return them (the system moves them to the base) |
| `range` | look 'range' only: `{ mesh, start, count, parts?, leaf? }`, the vertices (non-indexed, world space) of its body in the set's merged mesh; hidden by folding them under the ground. `parts`: the vertex counts of its parts in order (a tree's trunk, then each crown blob or bough), the pieces it drops as it wears down; `leaf`: per part, 1 = foliage (its debris is leaves). `forest.js` `Runs.add(geos, leaf?)` hands these out and `finish(extra, material, name)` merges the mesh (positions and normals `DynamicDrawUsage`) |
| `colliders` | the `Colliders` circles it stands on (`colliders.add` returns them): taken out when it goes, put back on reset. The circles of breakable wood are marked `soft` (the wyrm's body passes through them) unless `soft: false` |
| `soft` | false: its wood colliders stay hard (the Cinder Tree's trunk turns the wyrm like stone) |
| `broken` | `{ geos \| range, look?, r? }` or absent: what is left standing (`buildStump`, `buildRubble` in forest.js, `buildCinderStump`); r = its own smaller collider |
| `hp` | structure in POWER units (default: the material's x its size x `hpK`); `Infinity` = it only chips (the bronze bell) |
| `hpK` | multiplies the default structure (a tree of the wall: `BREAK.wall.hp` 1.15) |
| `wear` | `{ order, cut }`: it wears down in stages (a 'range' piece with parts; see "Wearing down"): `order` the parts it drops (never 0, the trunk), `cut[k]` how many of them are gone by stage k + 1. `forest.js` `wearOf(type, n)`: a pine [2, 3] (its top two tiers, then all but its skirt), a dead tree a third and two thirds of its boughs, an oak 0.4 and 0.8 of its crown |
| `wall` | true: a tree of the wall round the clearing (beyond `BREAK.wall.from` 32 m; below) |
| `edge` | m (> 0): while it stands it closes the ground behind it, this far either side of its base ("The edge of the open ground" below; the forest's wall trees: 0.6 x the crown's radius, 1.1 m at least) |
| `guard` | the definitions of the pieces that must go first: while one of them stands it takes `BREAK.guarded` 0.2 of a blow (the Cinder Tree's boughs guard its trunk) |
| `digits` | true: its debris and marks print in prop art's digits (a landmark's bones and boughs; default for look 'prop') |
| `topples` | it falls over when it breaks (default: h >= `BREAK.topple.minH` 2.2 m); otherwise it shatters where it stands |
| `burns` | fire lights it (default: the material's; wood) |
| `cover` | it stops projectiles (default: h >= `BREAK.cover.minH` 1.1 m) |
| `lift` | 0 nobody can lift it, 1 a boss's body can (the wyrm: trees, boulders), 2 only the Void (stones, pillars, lanterns), 3 a floor slab: only a move that asks for floor takes it (`nearest` / `floorNear` with lift 3; the wyrm's and the Void's choices never see it) |
| `leafy` | 0..1 share of its debris that is leaves |
| `wreck` | false: it leaves no wreckage (default: a felled tree leaves its trunk, a stone its rubble) |
| `floor` | true: a slab of a floor (ADR-122; `BREAK.floor`; look 'range'): a blow's power falls off from its centre (full within `core` 0.8 m, `rim` 0.35 of it at the edge; a blow drawn ALONG the floor bites at `sweep` 0.6), one sound per blow for all the slabs it strikes, no camera shake, no nicks, fewer chips (`debris` 0.45); structure `hp` 0.85, a big plate (over `big` 5 m²) `plate` 1.3; `lift` 3. `world/floor.js` `breakableFloor({ slabs, slabGeos, slabMesh, mat, rng, group, earth, look })` makes a set's paving into such pieces |
| `cracked` | `{ range }`: a floor slab's cracked look (two to four pieces over a dark seam), shown once its structure is under `BREAK.floor.crack` 0.8 of itself (`piece.cracked` true); `broken.range` is its broken look (`?floor=a` rubble on printed earth, `b` heaved shards: `floor.js`). Each look is one more merged mesh of the set's carved material, hidden until its first slab shows (an intact floor costs no draw call more) |
| `holds` | a two-stage piece (a colossus's legs): the def of the piece standing on it. While that one stands, every blow on this one goes to it (`piece.top`; the upper half's `piece.base`); while it falls this one takes nothing (`BREAK.colossus`: top 6, legs 4.5, weight 2.2, fall 1.4 s, off 1.6 m, blocks 4) |
| `y0` | the height its node stands at (a colossus's upper half: it falls from its cut, coming down to the ground as it goes over) |
| `fallOff`, `fallT` | m out from its base where a felled piece starts to land (its strip starts there), s it falls |
| `blocks` | how many big carved blocks of wreckage it leaves (a statue's) instead of a rubble pile |
| `cy` | (a crater's hanging stone) its height in the air, exact (ADR-122; the Lord's effects read it) |
| `lamp` | `{ y, r }` (2026-11-23, ADR-180): it holds a flame, the living world's lamps light it ("The living world" → The lamps): `y` the window's centre height over its base, `r` the window's half width (m). Read only by `life.lamps`; a piece that breaks, falls or is taken puts its flame out |
| `slice` | true: one blade or blow cuts it through at the height it bit (ADR-151, `BREAK.slice`; the grove's bamboo): its body loses what is below the cut in the frame of the blow (`RangeBody.cutY`), its stump is cut to that height on a slant, its top slides off the cut and goes over about its lower end (`_sliceFall`). Not by fire or a body brushing past. A range piece only |

A set draws its stumps, rubble and any breakables it adds from an rng stream of its own, so the rest of
its layout does not move. Budget: each breakable that is not a 'range' piece is 1–2 bones of the rigid
batch (1023 in all), plus the wreckage pools' bones; a 'range' piece takes none. Today (world.mjs SETS /
BUDGET, 2026-11-16, after the merge of ADR-120 and ADR-122): the forest lists 664 (tree 502, dead tree 37,
stone 10, boulder 20, flagstone 26, bone 4, helm 5, sword 3, the nest's 14 ribs and skull, the Elder
Wyrm's 36 bones: 18 ribs, 10 runs of the spine, the hip, the mast, the fingers, the fallen wing, the
skull, the jaw, 2 horns; the Cinder Tree's 5 boughs and trunk; it was 183 on 2026-11-15) and takes 228
bones, 409 with the wyrm; the courtyard 456 (it was 78: flagstone 293, pillar 30, lintel 1, lantern 4,
stele 1, bell 1, stump 32, deadTree 80, boulder 9, cauldron 1, colossus 4: two colossi of two pieces) in
443 bones; the throne 255 (it was 36, then 222 with 35 logs: plate 81, flagstone 24, shard 25, slab 27,
rubble 20, vent 4, hover 6, and since 2026-11-22 (ADR-133) what lies round the crater within 43 m of the
seal: cairn 21, swords 16, boulder 10, cart 9, banner 7, stele 5) in 365 (ADR-120's bigger log and char
pools are built in every set: +42 bones in each arena). `throneHall.js` places them on a stream of its
own (`CONFIG.seed + 14312`): 125 spots 3.8 m apart off the path and the dais, a bag of kinds by
weight; beyond 43 m they merge into the set's stones. Stone (cairn, boulder, stele) leaves rubble;
`swords` are `mat: 'metal'`, the banner and the cart wood (they burn); none topples (`topples: false`).
**Every tree of Cinderwood breaks**, out to the forest's edge (74 m; it was those within 42 m), and the
Elder Wyrm's skeleton, the Cinder Tree and the nest break in pieces (ADR-120 reverses ADR-119's "they
stay whole"); the bonfire stays whole. In `forest.js` the trees and the Cinder Tree are runs of the
`trees` mesh, their stumps runs of a `stumps` mesh (drawn only while one shows: `userData.autoHide`),
the landmarks' bones runs of the `props` mesh; each landmark tag group (`userData.piece`) is one piece,
and each of `ELDER_COLLIDERS` goes with the piece whose footprint is nearest. Their structure is
`BREAK.landmark` (rib 2.8, spine 3.2, skull 6, jaw 3, horn 2, hip 3, mast 2.6, fingers 1.6, wing 2.2,
bough 2.6, trunk 7, nestRib 2.6, nestSkull 5); none of them topples, lifts, stops a projectile (but the
Cinder Tree's trunk) or leaves logs and rubble (`wreck: false`). The Cinder Tree's boughs go first
(they burn too; `leafy` 0.25); its trunk (collider 3.0 m, `soft: false`, `guard`: the boughs, weight
2.2) breaks where it stands and leaves `buildCinderStump` (collider 2.3 m). Cinderwood's flagstone shard
mesh is hidden until a flagstone breaks (`userData.foldAway`: one draw call fewer). **Everything but the
landmarks breaks in the two duel arenas** (ADR-122): the courtyard keeps the sect gate, the bell (it only
rings) and the bonfire whole, the crater the throne and its dais, the fallen star, the seal and the
bonfire. The colossi's, the cauldron's and the lintel's geometry moved out of the set's static mesh into
the breakables. `THRONE.vents` is exported (the Lord's effects read the vents' places); a vent's ring of
stones is a breakable 'vent' and the vent flares as it breaks.

**`world.destructibles`** (`class Destructibles`; `STATE` = INTACT 0, FALLING 1, BROKEN 2, HELD 3, FLYING 4, GONE 5):
- `list` (every breakable: `{ id, kind, mat, x, z, r, h, hp, hpMax, state, weight, burn, lift, cover, topples, floor,
  cracked, top, base, … }`), `floor` (the floor's slabs: pieces with `floor`), `standing`, `wreckage` (pieces of
  wreckage lying now), `burning` (pieces and logs alight now), `active`, `root` (under the set's group: only the
  rigid batch's draw meshes), `pieces`, `batch`, `wreck` (the `Wreckage`).
- **The pieces live outside the scene graph** (2026-11-16: the arenas' 456 / 222 pieces cost a phone about
  0.7 ms a frame in three.js's matrix walk): their nodes, pivots and meshes hang in `pieces`, a tree that is not
  in the scene and does not auto-update; only the batch's draw meshes hang in `root`. `_place(b)` recomputes a
  piece's world matrices whenever it moves (a break, a shudder, a fall, a carry, a throw, the reset). A 'range'
  piece (a floor slab, a tree of Cinderwood, a landmark's bone or bough) has no node in that tree: it moves by
  rewriting its vertices (`_pose`, "Range pieces" below); a floor slab joins the tree only when a boss lifts it, and in his hands it shows as one of
  `BREAK.floor.carry` 6 blocks of prop art, a chunk about 0.85 m across (a crater plate's 1.2 x), never the
  whole slab.
- Every query walks a **spatial grid** (`BREAK.grid.cell` 4 m), not the whole list.
- `strike(x, z, r, power, o)` → how many it struck: a blow or blast over a disc.
  `sweep(ax, az, bx, bz, r, power, o)`: along a segment (a blade's edge, a dash, a body part's step).
  `sweepRec(w, o)`: the same with the segment in a reused record `{ ax, az, bx, bz, r, power }` (no
  numbers boxed per call: the wyrm's body sweeps a dozen spheres a frame).
  `o = { kind, by, dx, dz, y, ya, yb, src, only, falloff, brush, spare, incidental, down }`: kind = `BLOW.CUT / BLUNT /
  BLAST / FIRE`; by = 'player', 'boss' or 'world'; dx, dz = the blow's way (a piece falls along it;
  default: out from the disc's centre, or along the segment); y = its height (a blow above a low piece
  passes over, and one below a raised piece, `y + r < y0`, passes under it); ya, yb = a `sweep`'s heights at its two ends (a blade's hilt and point: a piece is
  struck at the blade's own height there: its bite, its chips, its nick, a felled tree's stump; without
  them, at `y`); src = one id per swing from `swing()` (a piece takes a blow once per id; without it,
  once per `BREAK.rehit` 0.18 s); only = just that material ('wood': the wings' wind); falloff 0..1 =
  `strike` is weaker toward its rim (× 1 − falloff there; `TUNING.world.falloff` 0.6 for the wyrm's
  ground blows); brush = a body walking (above); spare = one piece to leave alone; incidental = skip
  reserved pieces; down = a sweep that comes DOWN on the floor (a falling piece's strip): a floor slab takes it in
  full, not at `BREAK.floor.sweep`. A blade's blow struck at y = 1 passes over a 0.08 m slab; arcs, landings,
  spells and falling pieces reach it. `tx, tz` (ADR-177) = a blade's own travel on the ground (unit;
  the hero's swing passing through, `_cutWorld`): what the blow knocks off (`_chips`, the bitten
  bricks of `_drop`) flies on ALONG it (`BREAK.chip.pass.along` 1.1 × the travel + `face` 0.45 × out of
  the face it struck) instead of back toward the one who struck; held in `_tx / _tz` only while `_hit`
  deals that blow, with the same number of draws from the module's stream, so the seeded fights replay.
  Without them (every other blow, and the hero's with `?cutStop=1`) the debris flies back off the face
  as before.
- `struck` `{ held, x, y, z, broke, n, list }`: what the last `strike` / `sweep` / `stop` met, reset at
  each call: the first piece that held the blow (null: none) and where, how many it broke, and since
  ADR-177 `n` / `list`, every piece the call struck (at most `PASS_MAX` 6 reused records `{ b, x, y, z,
  broke }`: the piece, where it was struck, whether this blow broke it), so a blade passing through can
  mark its passage on each.
- `reserve(piece, sec = 1)`: incidental blows leave it alone for `sec` s (a terrain move's chosen piece).
- `stop(ax, az, bx, bz, r, power, o)` → the piece or null: a projectile's step; the first cover on it takes
  `power` and is returned (the caller ends its projectile). `coverAt(ax, az, bx, bz, r, y?)` → the first cover
  on a segment, no damage (`coverT` 0..1: where; `y` the shot's height: a raised piece above `y + r` is not
  in its way; `stop` passes `o.y`).
- `around(x, z, reach, out, max = 64)` → how many (ADR-177): the intact pieces (no floor slab, none out
  of the world) whose footprint reaches within `reach` m of (x, z), written into `out` (its length set;
  at most `max`). No damage, no state: the living world's tremor reads what stands near a blow.
- `shudder(b, amp, dx = 0, dz = 1)` → true when it shudders (ADR-177): a shake WITHOUT damage (a blow
  landed near, not on it): the piece (its upper half if one stands on it) shakes along (dx, dz) by at
  most min(0.09, amp) / max(0.6, weight) rad and settles in the same 0.28 s as a struck one; its
  structure, bricks, marks and sounds are untouched. A range piece counts against `BREAK.wear.shakeMax`
  × quality (at least 2) shaking at once; a piece already shaking harder keeps its shake.
- `ignite(x, z, r, k)` → wood in the disc catches (and logs lying there), within the cap on fire that
  lands (`BREAK.light`: at most `perSec` 0.12 new fires a second banking `bank` 3, and only while fewer
  than `maxBurning` 6 × the quality factor burn; past it the grass still burns and the wood is only
  scorched). Alight it burns `BREAK.burn.time` × k, then falls to embers and its stump; its light is a
  local glow (`burn.glow`: 5 m, shared by a piece that catches within `share` 8 m of one already lit,
  at most `burn.lights` 4). **Fire spreads** (`BREAK.spread`; it reverses ADR-107's "it never
  spreads"): a piece alight `after` 2.2 s tries every `every` 1.1 s to light one unburnt wood piece or
  log within `reach` 5.2 m (+ both radii), with `chance` 0.45; at most `maxBurning` 7 × quality alight
  at once, a level-wide budget of `perSec` 0.25 spreads a second (banking 2), and a fire passes on at
  most `gens` 2 times from where fire landed. These caps count only the fires inside the clearing:
  **the wall burns on budgets of its own** (`BREAK.wall.fire`, 2026-11-16, ADR-120): fire that lands
  on a wall tree `perSec` 0.15 a second (banking `bank` 2), at most `maxBurning` 6 × quality alight in
  the wall at once; a wall fire spreads only into wall trees, `spreadPerSec` 0.08 × quality a second
  (banking `spreadBank` 2) with `chance` 0.45, and `BREAK.wall.gens` 0 more generations than the
  clearing's. A tree that burns through chars the ground `BREAK.burn.char` 2.2 m round its trunk.
- `wind(x, z, power, reach, o = { from, fall })` → how many trees the front will reach (2026-11-16,
  ADR-120): a front of wind rolls out at `BREAK.wind.speed` 30 m/s (a queue of up to `queue` 1400 trees
  in preallocated typed arrays); each standing WALL tree it reaches (beyond `o.from` m of the centre)
  takes power × (1 − d / reach)^fall (`o.fall`, else `BREAK.wind.fall` 1.3) × the blast factor, × 1 ±
  `vary` 0.45 at random, nothing under `min` 0.04, at most once each `rehit` 0.35 s, never below
  `floor` 0.3 of its structure (wind takes a tree to its second stage at most, never to its lean or its
  fall), shudders and loses a few leaves (`leaves` 5 × the power). The clearing's pieces are untouched.
- `carryFire(ax, az, dx, dz, len, k = 1)` → the piece or null (2026-11-16, ADR-120): along the ray the
  first standing wall tree that burns, 1.5 m or taller, within `BREAK.wall.fire.width` 1.2 m (+ its
  radius and leaves) catches for `BREAK.burn.time` × k on the wall's budget (past it: a scorched disc);
  it passes over the clearing's pieces. `_carryHit` `{ x, z, piece }` holds where it met it.
- `stat` `{ wind, windTrees, carry, reached, lit }`: counts since the reset (the tests' wall report).
- `nearest(x, z, { maxDist, minDist, lift, kind, mat, from: { x, z, min } })` → the nearest intact
  piece or null (lift: at most that class; floor slabs only with lift 3).
  `floorNear(x, z, r, out, { kind, whole, max })` → how many intact floor slabs lie within r of (x, z), nearest
  first, written into `out` (cleared first; kind 'flagstone' | 'plate'; whole: not cracked): what a floor move
  can tear up there.
- Lifting and throwing (a boss's move): `take(piece, { chip })` → true: it is HELD (no collider; `chip`
  (ADR-242): the hero's blade bites it where it passes while held, and a cut that would leave it under 1 hp
  breaks it: let go where it hangs, it bursts where it lands; without it a held piece is out of every blow's reach);
  `carry(piece, x, y, z, tilt, yaw)` every frame while held (the wyrm flies its thrown pieces this way);
  `throwTo(piece, tx, tz, { time, power, radius, by, onLand(piece, x, z, radius) })` → it flies there
  end over end, smashing what stands in its way while it flies under `BREAK.flight.y` 7 m (power
  `BREAK.flight.power` x its weight), and bursts: a blast on the other pieces, a scar, its wreckage,
  and `onLand` for the thrower's own blow at the hero (the move's tell is the thrower's: the world
  deals nothing to the hero for a thrown piece); `drop(piece, { ground })`. `throwTo` / `drop` `{ ground: true }`
  (ADR-242): a raised piece (`y0` > 0) comes down and lands on the FLOOR (its pivot `y0` down), not at its own base
  height (Bai Wuji's throws and drops; Halcyon's `_throw`). `topple(piece, dx, dz, by)`: fell it
  that way.
- `setQuality(k)`, `reset()`, `update(dt)` (world.js calls it).
- A felled piece falls for `BREAK.topple.time` x sqrt(h / 5) s and lands on a strip h long: other pieces
  under it are struck. Under a piece a boss (or the world) felled, the HERO takes one red blow
  (`BREAK.topple.damage` x weight, unblockable, knockdown; i-frames dodge it; never a perfect dodge), with
  combat:tell at the start, combat:flash 0.3 s before it lands and the strip marked in red glyphs. Under a
  piece the HERO felled, the BOSS takes `boss.takeHit({ damage: BREAK.topple.bossDamage x weight, exact,
  heavy, posture })` (tested against `boss.bodyCircles`), and the hero is never hit by his own. A fall
  whose strip cannot reach the hero's bound (`CONFIG.world.playerBound`) is **quiet** (2026-11-16,
  ADR-120): no tell, no flash, no strip, no hero test.

**Wearing down** (2026-11-16, ADR-120; `BREAK.wear`): a piece with stages (`def.wear`) drops its parts
as its structure falls: at each share in `at` [0.82, 0.5, 0.22] it reaches the next stage (1 outer
crown parts gone, 2 half the crown, 3 it leans `lean` 0.32 rad × 0.75 – 1.25 along the blow over
`leanTime` 0.6 s), then it falls from its lean. A dropped part bursts into the glyphs it is drawn in
(leaves, splinters, a landmark's digits; `debris` 14 glyphs per metre of its size × quality, 8 – 44)
from a level-wide debris budget (`BREAK.debris` 1500 glyphs / s, banking 900, × quality). A stage
reached emits `world:impact` kind 'wear' (power = the stage, 1 – 3; audio's quiet `wear` sound). A
burning tree drops its crown with charred leaves and a few sparks, all of it gone by `burn` 0.85 of its
burn. At most `shakeMax` 10 × quality range pieces shudder at once (their vertices are rewritten every
frame); the rest only chip. **The wall** (`BREAK.wall`): a tree beyond `from` 32 m has `hp` 1.15 × the
structure of a tree its size, falls with at least `out` 0.55 of its way pointing out of the arena (a
leaning one the way it leans, which was turned outward when it leaned), and where it lands strikes the
trees behind at `domino` 1.4 × its weight (0.7 elsewhere).

**Bites** (2026-11-21, ADR-132; `BREAK.chip`; the look switch `?chip=`, `chipLook()`: on (`a`) by
default since the owner's pick the same day, `?chip=0` turns them off). A piece is the BRICKS it is drawn with: its triangles, two that
share their longest edge and lie flat together (cosine >= 0.9: the halves of a face of a trunk, a
pillar, a stone) being one brick; foliage stays single triangles. A blow that takes structure from a
piece (`_hit` -> `_bite`) takes bricks from it where it struck: of the bricks within the blow's reach
of the point (a `sweep` / `stop`: where the segment met the piece, reach = the blow's radius + `pad`
0.25, between 0.55 and 3.2 m; a `strike`: the disc's own centre at `o.y`, reach = its radius + the
piece's + `pad`, so a blast eats the side that faced it) the share of the piece's structure the blow
took, nearest first, at least one, at most `max` 96. The blows' arithmetic is untouched: structure,
stages (`wear` events), the lean, the fall. So a notch grows where a blade keeps biting and its
section is used up as the piece's structure runs out.
- **Set back, or holed** (`brickSink`, `BREAK.chip.sink`). A brick of a solid part is not removed: it
  is moved INTO the piece along its own normal, 0.42 of the part's thickness there (the nearest brick
  of the same part whose face looks back at it), at most 0.3 m, so the piece keeps a skin and never
  opens onto its hollow inside. Foliage, a face with no wall behind it and a part too thin for a dent
  to show (set back under 0.07 m: a bough, a thin bone) lose the brick outright (its triangles
  folded to a point).
- **Finer bricks, built in** (`forest.js` `refine(geo, L)`, `brickEdge()`): a level built with bites
  on cuts every bitten piece's faces until no edge is over `brick` 0.8 m (longest-edge bisection, in
  place, every attribute carried to the new corners: the same shape and the same picture, more
  triangles). Not cut: foliage, stumps, a part whose triangles are already narrower than `thin` 0.12
  m on average; the forest's trees beyond `near` 48 m are cut `far` 2.5 x as coarse. Cinderwood: 0.92
  M vertices drawn -> 1.07 M (the trees' mesh 524 k -> 648 k). So the switch is read when the level is
  built (the Lab's Bites button reloads the page), and at each blow.
- Every piece's bricks are made when the level is built (Cinderwood's ~620 range pieces: ~0.2 s in
  Node; the depth search walks a dense grid of the bricks' centres, `brickSink`, ~O(n): the Cinder
  Tree's trunk, 3000 bricks, in ~9 ms). Made in play they cost a frame a piece, and a roar's front
  reaches the whole wall in half a second.
- A 'range' piece: `RangeBody.bite(x, y, z, reach, share, cap, out)` (world, at home; its bricks are
  made at the build, or at its first bite: `nb`, `btri`, `cen`, `tpart`,
  `bit`, `pBit`, `pN`, `nBit`, `bnor` the way in, `bdep` how far), then `write()` sets back or folds
  each taken brick after the parts are written (so it stays so while the piece shudders, leans,
  falls, is carried); `home0()` clears them. `partGone(i)` -> share. With bites on a tree no longer
  drops its crown parts in order; a crown part that has lost `shed` 0.72 of its bricks drops whole
  (`_shed`). A wind front's wear (`_windHit`) bites the windward crown at `windY` 0.7 of the height.
- A piece of the rigid batch: `MeshBricks` (`piece.bricks`, built with the pieces from the source's
  `userData.batchRun` and the vertex counts of the geometries it was merged from, its parts): a
  set-back brick's corners are moved in the batch's positions, a folded one's three indices set to
  the first (both buffers `DynamicDrawUsage`, uploaded by range); `reset()` copies its runs back. Only
  made in a level built with bites on (without them the batch's buffers stay static, as before), and
  not with `?nobatch` (those pieces then only chip). The shadow mesh keeps the whole shape.
- Each brick falls as one letter of what it was drawn in (`_drop`: a leaf, a splinter, a digit for
  prop art; the leaves' and wood's dim hues) from its own centre, from the debris budget; every
  `litter` 3rd leaves a mark lying under it (`scars.rubble`) until the reset; the splinter spray of
  `_chips` is cut to 0.3 and the nick (`scars.object`) is left out (the bite is the mark).
- Not bitten: floor slabs (their own cracked and broken looks), pieces that only chip (`hp`
  Infinity), wreckage. A blow that took structure but has no brick within reach (a ground blow under a
  bough, a blow on a landmark's footprint) takes the share from the bricks nearest it, however far. `destructibles.bitten`: bricks taken since the reset. World test `bite`.
- The bricks a bite takes are knocked OUT of their face (`_drop`: away from the piece's axis and back
  against the blow, harder for a blow that took more; a blade passing through, `o.tx / tz`: on along
  its cut), then fall.
- **The blade goes clean through** (2026-11-23, ADR-177, the owner: "allow the player to swing their
  attack animation through it"; `BREAK.chip.pass`; player.js `_cutWorld` / `_cutPasses`, fx.js
  `cutPass`; it supersedes ADR-132's stop). The hero's swing never rewinds, freezes or bounces on a
  piece: its clock, its pose and its reach run exactly as in open air, frame for frame (the integration
  scenario `bladestop` / `cut`: the light cut, Piercing Gale and the cleave end on the same frame with
  and without a boulder or a tree in the way), so the same swing still lands on a boss behind the
  piece. The piece takes the blow as before, once per swing (`src`): its structure, its bite, its fall.
  `_cutWorld` sets `o.tx, o.tz` to the blade's travel this frame (the middle of its segment, on the
  ground), so what it knocks off flies on along the cut. For each piece of `struck.list` (not a floor
  slab, not a sliced piece: the bamboo falls at the cut) `fx.cutPass(x, y, z, bx, bz, r, tx, ty, tz,
  mat, M, heavy, P, q)` shows where the steel crossed it: stone and metal a short spray of `+ ' .`
  sparks (`sparks` [5, 9] light / heavy, × quality, at least 2; additive) off the face along the cut
  (a heavy one a 0.08 s flash of light), wood and bone `splinters` [6, 10] `/ \ | - '` and a backtick
  in the piece's dim hue and three motes of bark dust; `line` (false: off) would lay faint pale
  strokes across the face (`lineLife` 0.2 s, `lineStep` 0.16 m, at most `lineMax` 9). The hand feels
  it: one camera `jolt` a swing, 0.05 light / 0.12 heavy (under a landed cut's 0.12 / 0.3). The sparks
  and splinters show only with bites on (`chipLook()`); the debris along the cut and the jolt always.
- **The blade that stops** (`?cutStop=1`, `cutStops()` in destructibles.js: true when bites are on and
  `cutStop` is not '0'; read at each swing; the Lab's WORLD → **Blade: through / stops**, live, beside
  Bites; `BREAK.chip.stop`; player.js `_bladeStops`). The feel before ADR-177, kept behind the switch.
  A cut of the hero's (not the execution) that meets a piece it does not cut through, `minH` 0.6 m or
  taller, stops there:
  the attack clock goes back to the middle of that frame's travel, the frame freezes (`freeze` wood
  0.075 s, stone / metal / bone 0.095), the camera shakes (`shake` 0.14 / 0.2, x 1.3 for a heavy),
  steel on stone or metal throws sparks (`fx.sparks`); only on contact (`_bladeTouches`: the steel
  within `touch` 0.25 m of the piece's footprint, the blade's own hit radius); `_tickAttack` holds the pose through the freeze
  and `stick` (wood 0.11 s, the blade in the cut; stone 0) and then throws the blade back (`_bounce`,
  `push` 0.25 / 0.45 m away from the piece; an attack again after `TUNE.bounceAttack`). No
  `player:bounced` (that is a duelist's deflection: the feed and the pad read it). A cut that breaks or
  fells what it meets goes through, with a `through` 0.05 s freeze. Integration scenario `bladestop`.
  Training: a situation marked `clear` (built on the hero's own strikes: `foeBuild`) puts him where no
  standing piece is within his sword's reach (`_crowded`: 2.6 m), turning round the boss, else
  bringing the boss in toward the arena's middle (`CLEAR_SPOTS`).

**The edge of the open ground** (`world/edge.js` `class Edge`, numbers `BREAK.edge`; 2026-11-21, ADR-125).
Where the hero and the boss may go follows what still stands of a set's wall. A set asks for it by
returning `edge: { base, outer?, walk? }` (`walk`: "The walk edge" below; base: the circle the level always had, the forest's is
`CONFIG.world.playerBound` 31 m) and marking the pieces that close its ground with `edge` (m) in their
breakables entry; `Destructibles` builds it (`destructibles.edge`, `world.edge`; null on a set without
one: the courtyard, the crater, the training room).
- The ring round the centre is cut into `lanes` 120 (3 degrees each). A piece closes every lane its
  `edge` radius overlaps. In a lane the hero's ground ends `margin` 1 m short of the nearest piece
  still standing in it, at `outer` 62 m once none stands (the forest ends at 74 m, the grass and the
  scorch map at 80).
- A lane is SEALED at `base` until its nearest piece has come down, so a fight starts on the circle it
  always started on. A sealed lane with no tree near the line (a natural gap, the path south, the
  ground behind a landmark) gives way sideways beside open ground: as far as the more open of its
  neighbours, never past its own trees, and only if that frees more than `seal` 2 m of it (the whole
  ring does not shift at the first breach).
- Standing: INTACT, FALLING (a tree opens the ground once it is down) and HELD. The pieces are read
  every `every` 0.2 s and at once on `reset()`; in a fight the ground only grows.
- `heroAt(x, z)` → m from the centre his ground goes in that direction. `keep(pos, radius)` → pushes a
  circle back onto it: the lane's end, and the side walls of the lanes that end sooner (a step
  sideways out of a deep lane is put back in the lane, not dragged in to the old circle).
  `reaches(ax, az, bx, bz, pad)` → does a segment touch his ground (a falling tree's strip: the wall's
  quiet-fall rule reads it, so a tree that falls into an opened gap tells red again).
- `bossGain(x, z)` → m a boss may stand past its own bound in that direction: the hero's gain, less
  `body` 3 m at either side of a gap (a slot a few metres wide does not let its root in), and from
  there no steeper than `slope` 2 m out per m along the ring (a radial clamp never drags it hard
  sideways). It is 0 until something is open.
- `open`, `version` (counts every change: the minimap re-bakes on it and draws back so the hero stays
  on it), `lanes`, `R` (the hero's ground per lane), `n`, `base`, `outer`, `laneAngle(i)`.
- `resolveOn(colliders, edge, pos, radius, bound, soft, who)` (exported) is `world.resolve`'s rule; the
  tests' mock worlds call it too.
The ground is star-shaped round the centre: whoever stands on it can walk straight back in. When
ground opens, `Destructibles.update` emits the edge event of the catalogue (the HUD feed says it once a
fight). Who reads it: the hero (`player.js` `_collide` and the plunge's landing, `flurry.js`), the
wyrm (`dragon.boundAt` / `arenaAt`, below), the wall's quiet-fall rule, the minimap, the Lab's Open wall.
Every trunk out to `outer` + 3 m has a collider now (it was 42 m), so the stumps of the opened ground
stand in the hero's way as the clearing's do.

**The walk edge** (2026-11-25, ADR-197, the owner: "no invisible walls: if it looks like the player is
able to walk there"; Cinderwood's set today). A set's `edge: { base, walk: { at(angle) } }` (angle =
`atan2(z, x)`; Cinderwood: `ridgeAt(a) + RIDGE.inset`, the rock ridge's line ~48.5 m, `forestTuning.js`)
puts the Edge in WALK mode: the hero's ground is the whole forest out to the set's end from the start,
the trunks, logs, stumps and rocks that stand in it are his walls (their colliders), the ridge's crags
the last one, and the edge only the backstop behind them.
- `new Edge(list, cfg, game)`: the third argument (optional; `Destructibles` passes its `game`) is
  where walk mode reads the hero (`game.player.position`) and the boss (`game.boss ?? game.dragon`).
- `walk` (bool); `W` (Float32Array per lane: the end, the least of `at` read at the lane's sides and
  middle, never under `base`; `R` holds it too, so the minimap and `heroAt` read the forest's end);
  `T` (per lane: what the fallen wall has torn open, the BOSS's ground alone in walk mode; in the
  classic mode `T` is `R`); `out` (the hero stands past `base`); `follow` (m: the boss's follow gain).
- `heroAt(x, z)` → `W` of that lane. `keep` never pulls him back to the base circle.
- `bossGain(x, z)` → the torn lanes' gain (as before) or `follow`, whichever is more, capped at
  `min(W) - base - BREAK.edge.walk.bossIn` (7 m short of the end). **The boss follows the hero out**:
  `follow` rises at once to how far past `base` he stands + `walk.lead` 2 m, and when he comes back it
  falls at `walk.ease` 3 m/s, never below how far past its own bound the boss stands now (its ground is
  not pulled from under it; it walks back in after him). `_follow(dt)` runs from `update(dt)` every frame.
- `open` is now a getter (a setter remains): a lane torn open (`_open`) OR, in walk mode, the hero out
  past `base`; what reads an arena's radius off the edge (`dragon.arenaAt`, the barrage) follows him out.
  `reaches(...)` reads the hero's ground as it counts for a falling tree's warning: the forest while he
  stands out in it, the base circle and the torn lanes while he stands inside it.
- `version` counts his stepping out and back in (the minimap's zoom); `refresh()` returns false and
  sends **no `world:edge`** in walk mode (his ground never changes; the feed's line is said only where a
  wall still closes the ground).
- The minimap (`ui/minimap.js`): with a walk edge it draws back to the ridge while he stands out in the
  forest, keeps the clearing's scale (and no dashed line round it) while he is in the clearing, and
  never fills torn lanes. The Lab's **Restore** first sends a hero who is out among the trees back to
  the bonfire (`flow._respawnPlayer`), as the level's own reset does; **Open wall** on a walk edge opens
  ground for the wyrm only.
- A set may also give **`setQuality(k)`**: `destructibles.setQuality(k)` calls it with the budget
  (0.3 .. 1). Cinderwood's hides the deep mesh (the thicket beyond the ridge, all wood past
  `GROWTH.phoneFar` 60 m) below `GROWTH.phoneDeep` 0.7, and stops the undergrowth casting shadows.
- Cinderwood's forest (`forest.js` `growForest`, its own stream `CONFIG.seed + 5023`; numbers
  `forestTuning.js`, its undergrowth `undergrowth.js`): the ridge's crags (two rows, `RIDGE`, stone
  breakables whose rubble keeps blocking) or the other ends of `?forestEnd=` (`THICKET`, `DEADFALL`),
  young trees, the treeline's young trees and snags, tall old pines, snags, dead trunks leaning on the
  living, a thicket beyond the ridge, fallen logs, stumps, mossy rocks (colliders), bushes, ferns and
  brambles (no collider: he pushes through; they burn and tear), roots and hanging moss on the old oaks
  (`GROWTH`; merged into the oak's own piece). Every piece that stands on its own is a breakable; the
  new trees have `edge: 0` (they do not close the boss's lanes).

**Range pieces** (`RangeBody`, internal): its `visible` folds or restores its whole run; `show(i, on)`
drops or restores part i; `pose(q, px, py, pz)` turns it by a quaternion about its base and moves it,
rewriting positions (and normals) from a home copy, so a tree shudders, leans, falls, is carried and
flies without a bone of the rigid batch. Writes are queued and uploaded once a frame, one update range
per body: `flushRanges()` (exported; `Destructibles.update` and `reset` call it). `reset()` rewrites only
the pieces that were touched. No allocation after the build. `reshape(fn)` (ADR-128) gives an unposed
run another shape once: `fn(home, nhome, col, orig)` rewrites its home copy, normals and colours
(`aCol`) from the shape it was built with (its spare copies are made on the first call); `unshape()`
puts that back, and `shaped` says whether it is reshaped.

**How a felled tree lies** (ADR-128, `BREAK.fell` per kind of blow, on a stream of its own: the fire's
spread and the leans draw what they drew before). For a forest tree (wood, a range, `wreck` not false):
its fall turns up to `spread` off the blow's line (the wall's outward rule still applies after it) and
it rolls up to `spin` about its own trunk on the way down; its stump is reshaped (`_shapeStub`): as high
as the blow leaves it (`h`; a blade: about the height it bit at, `b.hy`, the `y` of its blow), its top on
a plane slanted along the blow (`slant`; a blow knocking it over: higher on the side it fell to),
splintered (`jag`), pushed over toward the fall (`lean`); burnt through, low and black (`char`). Its
trunk (`_logs`) is turned up to `yaw` as it lands, 0.85 - 1.15 of its length, its far end raised up to
`pitch`, and broken in two with a `kink` and a `gap` for a `split` share. A tree that burns through
leaves its black trunk the same way, or for a `snag` share stands as a black snag on its stump. The
reset puts every stump back as built. `reseedBreaks(s)` (exported, for tests) restarts the module's
streams.

**`world.destructibles.wreck`** (`class Wreckage`, `wreckage.js`, 2026-11-15; it reverses ADR-107's "a
felled trunk comes apart where it lands"): what the fight leaves lying until it resets. A felled tree's
trunk lies where it fell (`BREAK.wreck.trunk` [0.5, 0.85] of its height, a crowned tree / a bare one),
a broken stone or boulder leaves a rubble pile, burnt wood lies black and smoulders (`smoulder` 30 s, at
most `smoulderMax` 8 × quality at once), a thrown piece leaves its remains where it lands. **Scenery: no
collider, it stops nothing, the hero walks over it.** Pools of prop-art meshes built once and batched
with the breakables (no draw call of its own): `logs` 64, `chars` 36, `rubble` 30, `bones` 48 (2026-11-16,
ADR-120: heaps of bone shards in the bone's own hue; every broken bone piece 0.4 m or taller leaves one
where the most of it came down, even a landmark's with `wreck: false`; `rubble(x, z, r, M)` with
`M = BREAK.mats.bone` takes a heap); past a pool's share
(× quality) the oldest sinks into the ground in `sink` 1.4 s, past its size the oldest crumbles at once.
A log can burn (`burn` 6 s; it fell burning, fire landed on it, or the spread reached it) and burns the
hero beside it like a burning tree; a burnt-through log emits `world:impact` 'burnout' with `id` -1.
Two more kinds since ADR-122 (`KIND` LOG, CHAR, RUBBLE, BONES, BLOCK, SHARDS; the bones, blocks and shards pools
are only built for a set that needs them: bone pieces, a statue, a floor that can be thrown): `blocks` 12, big carved blocks (a colossus's stages, where its upper half lands and its legs),
and `shards` 16, flat shards (a floor slab torn out, where it is thrown).
The logs come in 6 shapes and the black ones in 4 (ADR-128: 3 / 2 crooked ones with a snapped bough
among the plain ones, from a stream of their own). A log's `pitch` raises its far end (near PI / 2 it
stands: a snag); `e.len` is how far it reaches over the ground (its fire, smoke, the grass it flattens),
`e.size` its own length.
API (internal to destructibles): `log(x, z, dx, dz, len, r, burn, charred, pitch)`, `rubble(x, z, r, M)`,
`block(x, z, r, M)`, `shards(x, z, r, M)`, `ignite(x, z, r, k)`, `count`, `burning`, `live`, `update(dt)`,
`reset()`.

**`world.fire`** (`class GroundFire`, on the scorch map's grid): `ignite(x, z, r, k)` → cells lit (grass
density >= `FIRE.minFuel`, not ash, not alight), `burning(x, z)` → s left, `touch(x, z, r)` (a burning piece
burns the hero beside it), `hush(x, z, r, sec = 0.3)` (a live fire body covers the disc: the grass's
flames under it burn at `FIRE.hush.k` 0.45 of their heat, smaller and lower, for `sec` s; the wyrm's
breath calls it every frame along its cone, so the two fires do not add up into white knots; at most
`FIRE.hush.slots` 8 discs), `count`, `reset()`. A grass cell burns `FIRE.life` s and is ash after: grass
fire never spreads and nothing catches twice (wood spreads: above). One local light per blaze
(`FIRE.glow`: radius min(6, its radius + 2) m, intensity 1.5; it was r + 6 m at 2.2). The hero in it
takes `FIRE.damage` every `FIRE.tick` s after `FIRE.grace` (blockable contact ticks, skipped while he
rolls or is invulnerable, like a burning crater).

**`world.scars`** (`class Scars`: glyphs that stay until the reset, one batch): `mark(x, z, o)` (a floor
mark of a kind, below; → glyphs laid), `impactMark(x, z, r, power, o)` (world.impact's own mark),
`ground(x, z, power, dx, dz)` (a star of cracks; power >= `SCAR.ground.min`), `crater(x, z, r, power,
keep = 1, color = null)` (a rim of thrown-up earth), `object(owner, x, y, z, power, M)`, `rubble(x, z, r,
M, n, glyphs)`, `drop(owner)`, `setQuality(k)` (at most `SCAR.max` 3600 × k glyphs, never under 60; it
was 520 before ADR-177), `reset()`, `count` (glyphs), `on` (the kinds on: `marksOn()`), `made` (kind
marks laid by kind since the reset), `kinds` (their sum), `layer` (a tag the marks made from now on carry: a
set's scene; null by default) and `shade(x, z, r, hide, except)` (the marks within r not tagged `except` hidden
or shown again, their alpha in place, no rebuild; → how many changed: the Veiled Crossing's void hides the
city's marks as its front passes; ADR-243). `SCAR.thin[levelId] = { grit, rubble, ground, cool }` (ADR-243):
a level keeps that share of the grit, the rubble and the crack spokes (the strokes that shape a mark stay);
`cool`: rubble whose material ends in an ember's colour (metal) lies cold grey; absent, all (the veil: 0.35 /
0.25 / 0.4, cool; Halcyon Plaza `city`: 1 / 1 / 1, cool). `?coolRubble=0|1` (`lookOf`) turns `cool` off or on in
any level, over the table. At the cap the oldest `SCAR.evict` 0.15 of the
glyphs FADE out over `SCAR.fade` 1.4 s (their alpha written down in the batch; never a pop in view) and
then go in one rebuild; new marks still come meanwhile, and only a flood past that headroom drops the
fading share at once. The batch's buffers are written only when a mark comes or fades: a floor full of
marks costs nothing per frame. No allocation once the records exist (they are recycled).

**Floor marks** (2026-11-23, ADR-177; `scars.mark`, numbers `SCAR.mark`; the switch `?marks=`,
`marksOn()` in scars.js, read per blow: `?marks=0` is the floor as before, today's cracks and crater rims
only). Every boss attack that meets the ground leaves a mark of its KIND, and the marks stay until the
fight's reset (the owner's pick): after a fight the arena shows what was fought there. `mark(x, z, o)`,
`o` `{ kind, power, r, dx, dz, len, by, hot, claws, spread, arc }`:
| kind | the blow | the mark (`SCAR.mark[kind]`) |
|---|---|---|
| `slam` | a fist, a tail, a foot, a landing | a shallow crater: a ring of grit (`grit` 6 – 15 of `. , : ;`), a crushed middle (`x + *`) and `spokes` 3 – 6 short radial cracks; radius `r` 0.55 – 2.3 m (0.55 + (power − 0.3) × `rk` 0.75, at most 0.6 × the blow's `r`); from `SCAR.crater.min` 1.2 the ring is today's crater rim, in the lip's pale grit |
| `cut` | a blade's edge in the floor | one long thin gash (`len` 0.8 – 3.4 m, default by power) along (dx, dz) from (x, z), a gentle `bow`, tapered at both ends, strokes every `step` 0.2 m of `size` 0.3 – 0.5, `grit` 2 – 5 thrown to one side; `claws` n (at most 4): n parallel gashes `spread` m apart (default `claws` 0.42: a beast's); `arc`: round (x, z) at r, len m of arc |
| `thrust` | a point driven in | a short deep nick (`len` 0.4 – 0.8 m) ending in a `v` / `x`, a `spray` of 4 – 8 grit ahead of it out to `reach` 0.5 – 1.5 m |
| `dash` | a body or a blade dragged along the floor | a shallow furrow `len` 0.8 – 6 m (default 1.5): two scuffed edges of `- ~` (`w` 0.2 m out, every `step` 0.36 m, deeper toward its end; alpha 0.62) and a heap of `. , : o` where it stopped; `arc`: an ankle sweep's scuffed arc |
| `blast` | ki, a spell, an explosion | a scorched round (`dots` 7 – 18 of `. : ; ,`, denser at the heart; radius `r` 0.6 – 2.4, `rk` 0.8) and a star of `spokes` 5 – 8 thin cracks; `hot`: the dots in `char` ink and the scorch map charred |
| `beam` | a beam | a long trench along its path (`len` 0.5 – 30 m, default 1.4; edges `w` 0.32 m out every `step` 0.32 m) with a glassy middle (`= ~` in `glass` at `glassAlpha` 0.45, every other cell); charred unless `hot` is false. A caller may give the trench's half-width, `w` (m, 0.32 – `wMax` 4; Bai Wuji's Violet Null: 2.5, the Last Null 3.5): its edges that far out every `wideStep` 0.45 m with rubble on `rubble` 0.25 of them, the glass in rows `rows` 1 m apart across the floor between, the grass torn `2 w + GRASS.mark.beam.pad` wide; without `w` it is drawn exactly as before |
| `step` | a heavy footfall | a faint print: a pad and three toes fanned ahead (alpha 0.5); only at `min` 0.5 power or more, and none within `gap` 2.6 m of the last print |
- **How it is drawn.** Each line is a dark stroke `-` turned to its way on screen plus a dim **lit lip**:
  the same stroke `lipOff` 0.11 m to the north (the far edge, where the light catches it) in
  `lip.color` (0.42, 0.4, 0.37) at `lip.alpha` 0.66 of the mark's alpha (per level by `game.level.id`,
  else `lip.default`); the grit, the thrown-up earth and the heaps print in the lip's colour too. The
  dark ink is the set's crack ink (`scarInk`) kept only `inkSat` 0.3 of its colour (the rest grey) and
  capped at `lineInk` 0.42 in its brightest channel: the throne hall's ember-red ink would draw gashes
  as red strips, and a danger marker is red strokes (today's cracks keep the set's own ink). Alpha
  `alpha` 0.85, at `y` 0.07 m; on grass the mark lies on the blade tips (lifted `grassLift` 0.3 m × the
  grass's density there, `world.fire.density`: under them the meadow hid it). Since ADR-180 a mark first
  TEARS the grass out in its own shape (below, "Grass the sword cuts"; `?mow=0` none) and each glyph then
  lies by what is under it: on the stubble (`GRASS.mark.lift` 0.08 m × density) where the grass is torn,
  on the tips where it still stands (`_liftAt`). With the kinds on the
  batch's soft depth is a floor's, `soft` 0.08 m (the particles' 0.6 faded a mark lying 0.07 m up to a
  tenth of itself).
- **Power.** A mark lighter than `min` 0.12 is not drawn; the hero's marks are `by.player` 0.6 the size.
- **The merge.** A mark of the same kind landing within `merge.near` 0.8 × its size of an older one (a
  ring of `merge.slots` 192 places) keeps `merge.keep` 0.45^n of its glyphs per such mark already there
  (at least `floor` 0.2; past 6 none), so a hundred blows on one spot do not turn it to noise; the same
  blow told twice (by its actor and by the engine) within `merge.twice` 0.35 s and a quarter of that
  reach is drawn once. Beams are not merged.
- **No Math.random.** The marks' cosmetic noise is the module's own LCG: a mark never moves the seeded
  fights (world test `marks` counts the draws: 0). They damage nothing and set nothing alight.
- **The char** (`_char`, `char.blast` 0.5, `char.beam` 0.75): a hot blast or a beam chars the scorch map
  ONLY where no grass grows (the cells' fuel is under `FIRE.minFuel`: the paving, bare earth), so no fire
  burns differently; deterministic, no heat, no random draw.
- **`impactMark(x, z, r, power, o)`**: world.impact's floor mark (a blow of `SCAR.ground.min` 0.45 or
  more, unless `o.scar === false`): one of its kind, `o.mark` naming it (a `KINDS` name), else by the
  blow's kind (a blunt blow a slam, a blast or fire a blast, a cut a gash); `o.marked`: none (the caller
  lays its own with `groundBlow`); `o.hot` or `o.fire` > 0 or kind fire: charred. Its radius is the
  crater's (min(r, 1.2 + 1.1 power)) from `SCAR.crater.min`, else min(r, 0.6 + 0.9 power). With the
  kinds off, or `o.mark === false`, today's cracks (`ground`) and crater rim (`crater`). One reused
  record, no allocation.
- **The cap.** `SCAR.max` 3600 glyphs × the world's quality hold a whole fight (the bot's wyrm fight
  leaves ~2700; the wyrm reaches the cap in about three minutes of fire blasts in the browser).

**Who marks the floor** (each through `world.groundBlow?.` or a blow record's `mark`):
| who | where | what |
|---|---|---|
| a duelist (every human boss) | `brain.js` `_groundOf(b)` at each beat's impact → `world.groundBlow`; `_worldBlow(b, marked)` then lays no crack of its own | a beat's own **`groundMark`** wins: `{ kind, power, len, r, fwd, side, arc, claws, hot }` (any field; `fwd` / `side` m from his root, as a zone's), `groundMark: false` none. Else read from the beat's SHAPE (`DUEL_MARK` in `duelist/worldTuning.js`; an actor's `T.marks` overrides fields): a ring of `bigRing` 4 m or more a blast (r = 0.35 × the ring, at most 2.4); a landing (a leap, a dive, a blink's land, a `lift` that comes down at the impact: `_landsAt`) a slam, or a gash when the blade ends low; a heavy ring a slam half a metre ahead of him, or with `part: 'feet'` an ankle sweep (a `dash` arc round him, `sweepArc` 0.7 of a turn); a blade that ends low (its pose's blade elevation `sw[1]` at or after the impact ≤ `low` −0.55 rad: `_bladeLow`) a gash ahead of him (`cutLen` 1.1 – 2.4 m by its reach); a dash of `dash` 3.5 m or more a furrow up to where he stands (`skidLen` 1 – 2.4 m); anything else nothing. Power = the blow's world power (damage / `DUEL_WORLD.per`, × `red` for a red or black tell) × the kind's factor (`slam` 1.7, `cut` 1.6, `sweep` 1.2, `blast` 1.2, `skid` 0.7, `thrust` 1.6). No mark for a feint, a beat still in the air (above 0.6 m), or a release, cast, draw, selfHit, bolt, pull, grip or `noWorld` beat unless it has its own `groundMark` (the actor marks where its thing lands). Own today: the Lord's rift (`groundMark: { kind: 'thrust', power: 0.9, fwd: 0.9 }`) |
| the duelists' effects | `duelist/fx.js` `_riftMark` (a fissure's crack behind it, a `cut` every `RIFT_MARK.seg` 1.3 m, power 0.7); `sheathed.js` the draw's cut (one `cut` gash the length of the cut, `TUNING.mark` 1.1; with `?marks=0` today's three cracks); the beams' `world.impact` stations (`kiBeam.js`, `thousandFox/beam.js`, `halcyon/glare.js`: `mark: 'beam', hot: true`); the Lord's blasts (`starlessLord/fx.js` `BLAST_BLOW`: `hot: true`); `halcyon/flight.js` the skid (`mark: 'dash'`, len 1.1) | |
| the wyrm | `attacks.js` `wyrmMark(d, x, z, kind, power, dx, dz, len, claws, r)` (`TUNING.world.marks`, a POWER each: a swipe's plant `rake` 0.55, three gashes 0.7 × `clawLen` 1.5 m; the overhead's claws in the ground `claws` 1.0, three gashes `clawLen`, dragged back toward it; the charge's skid `skid` 0.8, two furrows `skidLen` 2.6 m up to the forefeet; the tail slapped down `tail` 1.2, one furrow root to tip (its stations' world.impact `marked`); `dragon.js` a charging hind foot `step` 0.7, a landing `land` 1.6 a slam (r 0.4 × the landing's radius); claw `spread` 0.55 × scale); phase 3: hot (but a step). `GROUND_BLOW` (the stomp, leap, hop, slams) `mark: 'slam'`; `NOVA_BLOW` `mark: 'blast', hot`; the fire's `FIRE_BLOW` (`fx.js`, `skyFx.js`) hot; `terrain.js` a thrown piece's landing `mark: 'slam'` | |
| the hero | player.js `_groundMark(x, z, kind, power, len)` → `world.groundBlow` (`by: 'player'`; `SCAR.mark.hero`): the charged cleave's end in the floor a `cut` of power `cleave` 0.45 – 1.25 by charge, `cleaveLen` 1.3 m along his facing; the plunge's landing a `slam` of `plunge` 0.75; the slam finisher through its `world.impact` (a blunt blow: a slam). Light cuts leave nothing | |

**Grass the sword cuts** (2026-11-23, ADR-180; `world/scorch.js`, `world/grass.js`, `world/grassTuning.js`
`GRASS`, `world/scars.js`; the switch `?mow=`, `mowOn()` in scorch.js, a look switch read per tear:
`?mow=0` tears nothing and the grass is exactly as before; `?looks=old` keeps it on, it is a new thing).
The hero's blade MOWS the grass it passes through low, and every floor mark TEARS the grass out in its
shape, so the marks read on a meadow too. Cosmetic only: no hit, no clock, no damage, no fire changes.
- **The scorch map's A channel = torn** (0..1: 1 cut to stubble). `scorch.tear(x, z, r, k = 1)` a disc,
  `scorch.tearLine(ax, az, bx, bz, w, k = 1, k2 = k)` a strip w m wide, k deep at a and k2 at b (a blade's
  arc, a gash, a furrow: cheaper than many discs); each full out to its radius and `GRASS.full` 0.25 of a
  map cell more (0.625 m cells: a line narrower than a cell still mows the cells it crosses), its edge
  soft over `GRASS.soft` 0.3 m; MAX-blended (a lighter tear never undoes a deeper one), and only where
  grass grows (`world.fire.density` ≥ `GRASS.mow.minDensity` 0.12; with no density function every cell):
  paving and bare earth are never torn. Both return the tear they added (the sum over their cells).
  `scorch.tornAt(x, z)`, `scorch.torn` (Float32Array), `scorch.tornCells` (cells with any tear). It stays
  until `scorch.reset()` (which zeroes A with the rest); nothing decays it. It writes A only: never R, G
  or B, and nothing in fire.js reads A (the fire burns exactly as before). No random draw. (Not to be
  confused with world.impact's "torn ground" below: that is a charred disc in R.)
- **The grass shader** (`grass.js`, `scorch4At(root.xz)`: burn, heat, trample and torn in one fetch;
  uniforms from `GRASS.blade`: `uMow` (stub, jitter, low), `uMowInk`, `uMowGain`, `uMowFresh`, `uMowBare`,
  `uMowLie`, `uFresh`, `uFreshAsh`). torn × `gain` 1.25 is the SHARE of the blades there that are cut
  (each blade is cut or stands, by its own hash: a light tear is a scatter of stubs, a swath's edge a ragged
  line of them). A cut blade keeps the lower `stub` 0.42 (± `jitter` 0.12; `low` 0.15 of them to the root)
  of its letter's INK (`ink` [0.2, 0.8]: the share of the quad the atlas cell's ink spans): the quad and
  its uv are clipped at the same height, so the stub is the letter's own stroke, not a squashed one; it
  sways as the lower part of a blade does. `lie[0]` 0.4 of the mown blades are instead a cut TOP lying
  where it fell (the whole letter at `lie[1]` 0.55 × the size, laid over ±72 – 100°, 0.03 m up, no wind).
  A stub is paler at its cut (`fresh`, `freshAsh` on Ashfall's dried grass, `freshK` 0.9 of the way,
  never over burnt grass: a mown blade that burnt stays dark). Torn past `bare` [0.84, 0.97] the grass is
  torn OUT: the stubs go to the root, nothing lies, the floor shows bare (only a mark reaches that: the
  sword stops at `mow.maxK` 0.8). A flower over torn 0.4 is gone. Burn still wins over all of it.
- **`mowSwing(game, a, sw, fx = null)`** (grass.js; `mowStats` = `{ atk, acc, bits, torn, swings }` for the
  tests): player.js `_combat` calls it every frame of a swing (state attack / heavy), right after the
  hit test, `_cutWorld`, the trail and the glint, with the attack `a`, the SwordSweep `sw` and `this.fx`.
  It acts from the active window (`def.windup`) to `GRASS.mow.after` 0.14 s past it (the follow-through
  still cuts), never on an execution (`a.exec`), only while the steel's point moves at `speed` 2.5 m/s or
  more (a blade at rest or held in a hitstop cuts nothing), and reads only the swing: its clock, its hit
  and the seeded stream are untouched. The drawn steel, out to `reach` 1.45 × its length (to the arc's
  edge the player sees), is swept from last frame's pose to this one in sub-steps of at most `sub` 0.2 m
  of the point's travel (`maxSub` 8). Wherever it passes under `above` 0.45 m over the grass's top (`top`
  1.05 × `world.grass.heightAt`, else `meadowHeight`) it tears a strip `w` 0.8 m wide along the steel:
  `skim` 0.45 deep at the tops (fading to 0 `above` over them), 1 at `stubY` 0.55 × the top and under, ×
  `maxK` 0.8 (a tear under `min` 0.08 × maxK none). So a low sweep mows its arc, a waist-high swing only
  skims the tops, a vertical chop leaves a lane (~1 × 3 m), and a stab, the piercing gale and the tempest
  pass over the grass. The cut tops fly: `fx.mowBits(ax, az, bx, bz, n, ux, uz, top, B)` (player/fx.js),
  `bits.per` 2.2 letters per unit of new tear, at most `bits.max` 14 a swing × `world.quality`, tiny
  (`size` 0.1 – 0.16) letters `/ \ ' , |` in `COL.grassBit`, thrown along the blade's travel and up, falling
  fast, from the fx module's own stream. The flurry's cuts do not mow (state 'flurry' is not a swing
  of `_combat`'s; open). **All of this bullet is the first round's cut, kept only for `?mowLook=r1`:**
  with any other look `mowSwing` writes no A (the owner turned it down: a blotch round the steel, and
  most of the drawn arc cut nothing). The sword's cut today is the next two bullets.
- **The cut follows the drawn arc** (`world/mowFx.js` `MowFx`, built by `scorch.js` as `scorch.tops` where
  grass grows and `mowOn()` and the look is not `r1`). `player/fx.js` `trail()` hands every stroke of the
  arc's EDGE, the same slerped sub-steps it draws, to `tops.cutArc(ax, ay, az, bx, by, bz, heavy)`: so the
  grass is cut where and on the frame the arc is drawn, and never when none is (headless: no trail, no
  cut). A stroke cuts only the part of it lower than `GRASS.arc.above` 0.85 m over the grass's top (`top`
  1.05 × `heightAt`); its ends are carried along the camera's view ray down to `mid` 0.5 × the top (the
  cut sits under the arc as the player sees it); every blade whose root lies within `w` / 2 (0.55 m;
  `wHeavy` 0.7 for the heavy blows) of that footprint is cut. The blades are found through a bucket grid
  of the grass's instances on the scorch map's cells (built once, ~3 ms). The cut is ONE BYTE PER BLADE
  (`tops.cut`, an R8 `DataTexture` `tops.cutTex` `arc.tex` 512 wide), uploaded only on a frame something
  was cut, cleared by `scorch.reset()`; the grass shader reads it by `texelFetch(gl_InstanceID)` (uniform
  `uCutTex`) and draws a cut blade as its stub, exactly like a mown one. So the sword's cut is exact to
  the blade, not a map cell's share, and A stays for the marks.
- **The cut tops** (`MowFx`, one instanced batch of up to `GRASS.fly.max` 1400 × quality pieces, fixed
  typed arrays, its own seeded stream): a cut blade's TOP, the upper part of its own letter in its own
  colour, is spawned on the frame its stub shows, where the top was, so no blade pops from whole to
  stub. It then goes by the look, `?mowLook=` (read once; `GRASS.fly.look`): **`a` thrown, the default**
  (`fly.throw`: `share` 0.5 of the tops tossed along the stroke's way, `fling` 0.9 – 2 m/s, `up` 1.7 –
  2.7 m/s, `spin` 2 – 6 rad/s, no brighter than × 1.15 the grass; the rest topple off as in b; they lie
  0.7 – 1.3 s and thin over 0.45 s), `b` sliced (`fly.slice`: the tops lean off their stubs, a little
  drift, 5 % thrown), `c` shred (`fly.shred`: a burst of the grass's strokes), `r1` the first round (no
  tops). A mark's tear hands its blades over the same way (`scorch.tear` → `tops`), at most `perTear` a
  call. Cost at quality 1: `cutArc` ≈ 0.03 ms a frame of a swing, the batch ≈ 0.03 ms; about 130 tops a
  swing (65 thrown), half that at quality 0.5.
- **The code spray** (`?grassSpray=`, `GRASS.spray`, ADR-192; read once): on the frame `cutArc` cuts a
  blade it also throws CHIPS into the cut tops' batch (`MowFx._chip`; the pool is `fly.max` 2000 x quality),
  `per` 0.5 a cut blade (x (1 / q)^`lowQ` 0.8 on a lower quality: the phone draws a third of the blades).
  Today's default `m`: each chip is ONE CODE GLYPH from `GRASS.spray.code.glyphs` (the Hall of Falling
  Script's digits plus `ZTHKEX<>=:+*`, all world-atlas glyphs), `size` 0.4 - 0.55 x the blade, unlit and
  fogged (attribute `aK`), fresh `col.head` green cooling to `col.tail` over `cool` 0.18 s, settling to
  `col.deep` (the grass's own darkness) within `darken` 0.35 s of landing, re-rolling to another code glyph
  every `flip` 0.09 - 0.24 s while it flies, near upright; thrown, falling, lying and thinning as the cut
  tops do. Under quality 0.75 it takes `m4`'s greens and a size 0.5 - 0.66 (it vanished on the phone).
  The others: `m4` a step more visible, `m0` / `m2` (each glyph trailing two fading ones) / `m3` (the cut
  tops turn to code too) the earlier code looks, `a` / `a2` chips of the blade's own letter in its own
  colour, `a0` / `b` / `c` letters in the house letter (`world/grassSpray.js`, a `LetterBatch`), `0` none.
  No allocation per frame, no `Math.random` (the tops' own stream). Cost at quality 1: the tops and chips
  about 0.05 ms a frame; `cutArc` with the spawning about 2.4 ms over a whole four-swing string.
- **The marks tear first** (`scars.mark` with `world.scorch.tearLine`, a density function and `mowOn()`):
  before its glyphs are laid, each kind tears its shape (`GRASS.mark`, depth `k` from a light blow to the
  hardest by its power, (power − 0.3) / 1.5): a `slam` a disc `r` 1.05 × its round (the crater's radius
  from `SCAR.crater.min`); a `blast` a round 0.95 × its radius; a `cut` each gash along its own path (its
  bow, each claw's offset, or its arc), `w` 0.5 wide, tapered toward both ends as the gash is (`_tearCut`);
  a `thrust` a short strip `w` 0.34 and a disc `r` 0.45 at its point; a `dash` a furrow `w` 0.62 (wider for
  a harder blow; an arc's along the arc, `_tearArc`); a `beam` a strip `w` 0.8 along its length; a `step`
  (power ≥ `SCAR.mark.step.min`) a paw's disc `r` 0.5 at `k` 0.6 – 0.85 (a step MOWS rather than tears
  out: under `bare[0]`). Every other kind's `k` is 0.9 – 1: torn out. The tearing draws no random number,
  so the marks' own stream is the same with the mow on or off.
- **Cost** (measured 2026-11-23): about 4.8 µs a frame at worst; a minute of fight tears 600 –
  900 of the map's 65 536 cells. The world test **`mow`** (below, Tests).

**`world.impact(x, z, r, power, o)`** = `destructibles.strike` + for a hard blow (`SCAR.ground.min` 0.45
or more; `o.scar: false` skips it) its floor mark (`scars.impactMark`: a mark of its kind, or today's
cracks and crater rim with `?marks=0`; since ADR-180 the mark tears the grass out in its shape, A) and
its "torn ground" (`burnCircle` 0.5 burn, no heat, radius min(r, 0.6 + 0.9 power): char in R, which the
grass draws as burnt and which wins over the mown look), and for a blow of `SCAR.crater.min` 1.2 or more
a charred disc of radius min(r, 1.2 + power × 1.1) m + `ignite` when `o.fire` is set + **`life.impact(x,
z, r, power, o)`** (ADR-177: what stands near shakes, what lives near flees, dust hangs after). `o`
gained `mark` (a `scars.mark` kind; false: today's cracks), `marked` (the caller lays its own mark with
groundBlow) and `hot` (the mark is charred).
**`world.groundBlow(x, z, o)`** (ADR-177): a blow met the GROUND at (x, z), whether or not anything
stands there: `scars.mark(x, z, o)` (inside a try: an error is logged, never thrown) + `life.impact(x, z,
o.r or 2, o.power, o)`. `o` `{ kind: 'slam' | 'cut' | 'thrust' | 'dash' | 'blast' | 'step' | 'beam',
power (POWER), r, dx, dz, len, by: 'boss' | 'player', hot, claws, spread, arc }`; nothing without a finite
(x, z) and `o.power` > 0. It damages nothing and lights nothing: a blow that also breaks things calls
`impact` too (with `marked: true` so the floor is not marked twice).
**`world.ignite(x, z, r, k, grass = true)`** = `fire.ignite` (unless grass is false: sweeping fire and
the ground tongues light wood only) + `life.ignite(x, z, r, k)` (ADR-177: birds leave, smoke rises after)
+ `destructibles.ignite`. **`world.resolve(pos, radius, bound,
soft = false, who = null)`** → `Colliders.resolve(pos, radius, bound, soft)`: `soft` passes through the circles
marked `soft` (the wyrm's body); with `who` 'hero' on a set with an edge, the colliders and then
`edge.keep` instead of the circle (`resolveOn`). **`world.heroBound(x, z)`** → `edge.heroAt` or the level's circle. **`world.setQuality(k)`** (0.3 .. 1; `setGrassQuality` sets it from the
quality preset: `QUALITY` LOW 0.5, MEDIUM 0.75, HIGH 1) scales the debris glyphs a break throws, the
flames of burning wood, the wreckage lying at once, the fires and smouldering logs and the marks that
stay (`destructibles.setQuality`, `scars.setQuality`). `Colliders` has `remove(c)`, `restore(c)` and a
`version` that counts every change of the set (the minimap re-bakes its layer on it, so a felled tree
leaves the map). **`world.restore()`** resets all of it (the pieces, the wreckage, the fire, the
scars and the floor marks with them): flow calls it wherever it resets the scorch map; the Lab's Reset and its WORLD section (Burn
ahead, Fell on me, Blast ahead, Restore) too.

**Who hits the world** (each through `?.`; one `src` per swing or action):
| who | where | numbers |
|---|---|---|
| the hero | `player.js` `_cutWorld` (the blade's segment, every active frame; it goes clean through, `o.tx / tz` its travel, ADR-177), `_slamImpact` | power = the attack's damage / 110; a heavy cut is a BLUNT blow; a felled piece falls away from him |
| the wyrm | `attacks.js` `sweepHit` (every striking part), stomp / leap / hop / the slams (`GROUND_BLOW`, with falloff); `fireAttacks.js` dive and nova; `fx.js` `_landed` (fireball, meteor, lava pillar) and the breath / strip / ring / wall igniting; `skyFx.js` the meteors' impacts; `bullets.js` (cover; a landing ember; the tongues lighting wood); `terrain.js` (a flying piece's `sweep` on its path, its blast where it lands, `throwTo` for the skid; a batted one: `stop` on the cover in its way; a firebrand: `world.ignite`); `dragon.js` `_wreck` (its body's spheres, the wings' blasts, the landing); `wallReach.js` (`wallWind` → `destructibles.wind` from the roars, the shock ring, `groundShock`, the wing buffet and sweep, the take-off, the landing, low downbeats; `carryFire` → `destructibles.carryFire` from the breath, the strip, flame rings and walls, missed shots; ADR-120); `ablaze.js` (phase 3: `world.ignite(..., false)` from a burning part, the scorch map under its feet) | `TUNING.world` (`melee`, `stomp`, `leap`, `hop`, `dive`, `nova`, `falloff`, `explosion`, `meteor`, `pillar`, `body`, `takeoff`, `landing`, `downbeat`, `ignite`, `bullet`, `wind`, `carry`; `meter`: the WRECKAGE scenario's bounds, with `wall` [0.3, 0.75] and `wallP1` 0.03: the share of the wall's front rows, 32 – 46 m, worn or down at the end and by phase 1's end); `tuningAblaze.js` `ABLAZE.wood` |
| a duelist | `brain.js` `_worldBlow` (a beat's zone at its impact) and `_coverFor` (a bolt, the pull, the grip meet the cover the hero stands behind: `beat.cover`); `duelist/fx.js` crescents and the push; `starlessLord/fx.js` thrown stones, the blade, strikes, the crush; `starlessLord/spells.js` the wheeling blade, the weather's strikes, Starless Night's waves; `ashDisciple/moveFx.js` burning ground (`world.ignite`); Tian Lei's (ADR-129): `ascendant/fx.js` blasts (`stop`: cover takes them; a burst's `world.impact`) and the disc (`sweep`, out and home), `kiBeam.js` the beams (`sweep` along the strip and carried on to 45 m, a trench of `world.impact` stations, `world.ignite` off the ring), `kiShots.js` the volley's dive and the corner bolts (`world.impact`), `ascendant/terrain.js` (`take` / `carry` / `throwTo` / `strike` on the tiles, `floorNear`, `wreck.rubble`); the other two bosses' `terrain.js` (`take` / `carry` / `throwTo` / `topple`, `floorNear` for the floor moves) | `duelist/worldTuning.js` `DUEL_WORLD` (an actor's `T.world` overrides fields) |

**Drawing.** `createAsciiObjectMaterial` and `createPropArtMaterial` place each vertex with
`rigidMatrix()`; built with `rigid: true` they are tagged for `batchRigid` (a set's static materials are
not, so an actor's batch never picks them up). The breakables' two materials are twins of the set's (the
prop twin takes the set's `uGain`): one draw call each however many pieces there are, plus one in the
shadow pass; the wreckage's pools ride the same batch. A 'range' piece (a flagstone, a tree of
Cinderwood, a landmark's bone or bough) stays in the set's own mesh: it is hidden by folding its
vertices under the ground and moved by rewriting them ("Range pieces" above). Debris, dust, the danger
strip and the scars are glyph particles (a wearing crown's in the canopy's dim hue, a bone's in its own
dull hue; destructibles.js `SHED_LEAF`, `SHED_WOOD`, `SHED_BONE`); the flames of burning wood and logs
are heat in the fire field.
**What hangs** (2026-11-23, ADR-163; "The living world" → What hangs): a builder's `hangFrom` mark rides in
`geometry.userData.hang` (a static merge never sees it); `_mesh` turns it into the attribute `aHang` for a
'prop' piece before `refine` cuts the piece to brick size (the cutting interpolates it), the rigid batch
copies it with the other attributes, and the breakables' prop material is built with the `hang` option
when any piece carries it. `piece.hang` (`{ top, give }`, or null); `_take` bites a leaning cloth where it is
drawn (`_hangAt`: the lean now, null unless the piece is INTACT, upright and at home). **The hang kick**
(ADR-177; the living world's tremor): a heavy blow swings what hangs away from it, on top of the wind's
lean, through `hang.js` `hangKick(U, x, z, amp, reach)` into the shared uniform `uHangKick` (`HANG_KICKS`
2 slots × 2 vec4: (x, z, t0, amp rad), (reach m, decay 1/s, rate rad/s, speed m/s); materials.js), so
`hangLean` (and so a bite on a swinging cloth) includes it; `hangKickAt(U, x, z, out)` its swing at a
piece, `hangKickSettle(U)` frees spent slots. Under "The living world" → The tremor.

## The living world (2026-11-23, ADR-163): one wind, and what lives in it
Files: `src/world/life/` (`life.js` the hub, THE CONTRACT in its header; `lifeSwitch.js` the switch; one
`<layer>.js` + `<layer>Tuning.js` per layer: wind, weather, litter, steps, creatures, answer, and since
ADR-177 tremor and aftermath, since ADR-180 lamps; the fauna: `flock.js`, `animals.js`, `faunaTuning.js`,
owned by creatures), `src/world/hang.js` + `hangTuning.js` (what hangs), `src/audio/air.js` + `airTuning.js`
(the sound of the air), `src/audio/lifeSfx.js` + `lifeSfxTuning.js` (its one-shot sounds, ADR-180),
`src/game/arrival.js` + `arrivalTuning.js` (the arrival). The ambient life of a level before and
round the fight: one shared wind per level that the grass, the trees, smoke, letters in the air, hanging
cloth and the hero's hair all read; things that fall and lie; footsteps that answer the ground; slow
weather; small creatures; the sound of the air; a camera beat as the player arrives; the world answering
the fight. It adds no event and draws nothing outside the glyph systems. Looks: STYLE.md "The living
world"; the fight's side: COMBAT.md "Tell presentation".

**The switch** (`lifeSwitch.js`, read once from the URL at load). `?life=off | all | <pieces>` (a comma
list of `wind, litter, steps, weather, creatures, air, arrival, answer`; an unknown word counts as off),
`?lifeK=0.25..2` the strength of all of it (`LIFE.k`, clamped; 1 = as tuned). A page with no `?life=` gets
**every piece on** (the owner's pick, 2026-11-23; `lifeFromSearch(search)` is the parser); headless (no
`location`) it is **off**, and so is `setLife()` with no spec, so the seeded suites are untouched (the
`life` suite turns pieces on with `setLife(spec)` / `setLifeK(k)`). `LIFE = { pieces, on, k }` (the Lab
flips `LIFE.on[piece]` live), `lifeOn(piece)`, `lifeAny()`. The training room (`?stage=lab`, level id
'lab') has no living world: `life.enabled` is false there and every piece reads off. **The Lab**: WORLD →
a `life` row (one toggle per piece), a `life x` row (all / off, quiet 0.6, natural 1, strong 1.5), then one
button per `life.action` the layers registered (below); not built where `life.enabled` is false.

**`game.world.life`** (`class LivingWorld`, built by world.js after the atmosphere inside a try: `null` if
it failed). THE CONTRACT every layer and outside reader may rely on:
| field | what |
|---|---|
| `on(piece)` | is the piece running in this level now: the switch, the level (`enabled`), and fewer than 3 throws from that layer |
| `k` | the strength, `LIFE.k` (0.25..2): rates and amplitudes scale by it |
| `quality` | `world.quality` (0.3..1, 1 when unset): COUNTS and RATES scale by it |
| `levelId`, `set`, `t` | 'cinderwood' / 'ash' / 'starless' / 'ring' / 'fox' / 'grove' / 'lab'; the level's set (`world.forest`); seconds of living world this page load (the layers' clock) |
| `calm` | 1 before the fight; eases to `LIFE_TUNE.fightCalm` 0.4 while `game.state` is 'bossIntro' or 'boss' (time constant `calmDown` 1.2 s; back up over `calmUp` 4 s, and only once `hush` is under `calmHush` 0.5, so the victory's lull holds first). Every ambient RATE multiplies by it |
| `hush`, `hushFor(sec, k)` | 0..1, the world holds its breath (a great blow winds up): held for `sec` s at depth `k` (rising with a 0.25 s time constant), then let go over `hushRelease` 1.5 s. The wind, the creatures and the air go quiet by it |
| `rand()`, `range(a, b)` | the living world's own random stream (an LCG). Never `Math.random`: the seeded sims replay it |
| `build(fn)` | make GPU objects through this: while `fn` runs `Math.random` is swapped for `life.rand` (three.js draws a uuid for every geometry / material / mesh), so a pool built mid-fight never moves the seeded fights |
| `focus`, `hero` | the camera's focus on the ground (`U.uFocus.value`: spawn round it); `{ x, z, vx, vz, speed, moving }` the hero this frame (`moving` above 0.8 m/s; a jump over 40 m/s counts as a teleport: velocity 0) |
| `takes(what)` | true when a running layer draws `what` itself, so atmosphere.js skips its own: 'leaves' / 'fireflies' / 'mist' / 'ash' |
| `gust(x, z, strength, radius)` | `world.gust()` calls it: `wind.burst` and `answer.gust` (both only while their piece is on) |
| `impact(x, z, r, power, o)` | (ADR-177) `world.impact()` and `world.groundBlow()` call it: a blow landed at (x, z), reach r m, `power` on the POWER scale (0.3 light, 1 heavy, 2 the biggest), `o` the blow's record (kind, by, dx, dz, len, hot; may be undefined). Every layer with an `impact(x, z, r, power, o)` method whose piece is on gets it: the creatures (flocks, animals), the tremor, the aftermath. Nothing when `enabled` is false or a number is not finite |
| `ignite(x, z, r, k)` | (ADR-177) `world.ignite()` calls it: fire landed. Likewise every layer with an `ignite(x, z, r, k)` method whose piece is on: the creatures, the aftermath |
| `sound(name, x, z, o)` | (ADR-180) a one-shot sound of the living world (a `LIFE_SFX` name, `audio/lifeSfx.js`): `audio.play(name, r)` with `o`'s fields copied into one reused record, plus `x` / `z` when both are finite (placed and falling off with distance like the fight's sounds). Only while `enabled`, the piece **`air`** is on (the sound of the air is the living world's sound) and `hush` is not above `LIFE_TUNE.soundHush` 0.6. → whether a voice started (`audio.play` returned true); a throw is caught and logged (`_fail('sound')`: the first three; nothing is switched off by it). The layers do not call it directly: they call `lifeSay` (below, "The living world's sounds"), which calls it |
| `action(label, run, title)` | a button on the Lab's life rows (`run` may return a status string) |
| `wind`, `weather`, `litter`, `steps`, `creatures`, `answer`, `tremor`, `aftermath`, `lamps` | the layers (below). A layer's piece is its own name, but for those in `PIECE` (life.js): `tremor`, `aftermath` and (ADR-180) `lamps` belong to the piece **`answer`** (no new word in `?life=`; `on(PIECE[name] ?? name)`). One is always there, also with its piece off (its methods then do nothing and its values are the still-air defaults); one that failed to build is a frozen no-op stand-in. Outside readers still write `game.world?.life?.wind?.at(...)`: the tests' world mocks have no life |

`update(dt)` (world.js, each frame the world is drawn), `clear(why)` ('reset': `world.restore()`; 'hide':
the Lab hides the world), `setVisible(on)` (`world.debug.setVisible`; hiding also clears with 'hide').
`LIFE_TUNE` (life.js) `{ fightCalm 0.4, calmDown 1.2, calmUp 4, hushRelease 1.5, soundHush 0.6, calmHush 0.5 }`.

**A layer** is a class `{ constructor(life), update(dt), clear(why), setVisible(on), takes(what) }` (and, if
it answers blows or fire, `impact(x, z, r, power, o)` / `ignite(x, z, r, k)`), built in the order wind,
weather, litter, steps, creatures, answer, tremor, aftermath, lamps, updated in that order (`ORDER`). `_call` passes
up to five arguments. The rules:
- `update(dt)` runs every frame, piece on or off: off, it returns at once and leaves NOTHING on screen
  (a layer that was on wipes its letters, its pool and its uniforms the first frame it is off).
- GPU objects (an own pool) are made on the first update with the piece on, never at build, and through
  `life.build`: a level with life off builds exactly what it built before. An own pool is registered
  with `game.pipeline.registerParticles` and updated by its owner, not by the pipeline.
- `clear('reset')`: what is in the air goes; what lies may stay. No allocation per frame, no NaN, no throw
  (a layer is wrapped: three throws switch it off and log it).
- No `Math.random` (`life.rand`, or a stream seeded once from it); no new event (layers listen to the
  catalogue's and call each other only through `life`).
- **Off is free**: with `?life=off` nothing spawns, no uniform is written, no pixel changes (the grass and
  tree shaders' `windOn()` is false and they run their old sway; atmosphere.js draws as before).

**Per level, and a level with no block.** Each layer's tuning file has one block per level id. A level
with no block of its own (a new one) gets: the wind `WIND_DEFAULT` (a quiet breeze, prevailing 0.8 m/s
toward +x, breathing, no scheduled fronts and no wisps; a front sent by the arrival or the answer still
crosses, on `WIND_DEFAULT_FRONTS`), no weather, no litter, no creatures (so `takes()` is false and the
atmosphere keeps its own leaves, mist and fireflies), the steps' `fallback` map (slabs stone, grass, else
earth), the answer's `DEFAULT` (Cinderwood's numbers), the air's `quiet` recipe (a low breeze; note it
turns today's bed's wind AND voices down to 0), the arrival's `DEFAULT` shot (it looks at (0, 0) and drifts
to (0, 10): give a new level a block with its own `look` / `end`), and nothing hangs until its builder
marks a part with `hangFrom`. Since ADR-177: no fauna (no roosts, no animals: `FAUNA_TUNE.levels`), the
tremor's and the aftermath's `DEFAULT` (Cinderwood's numbers). Since ADR-180: the lamps' `DEFAULT` (one
lantern lit at the start, one more at the fight, 2 / 2 / all at phases 2 / 3 / 4: only for breakables
that carry `lamp`, so a level without lanterns lights nothing) and the sounds' `DEFAULT` level block
(every sound heard, small birds, stone grit, leafy trees).

### The wind — `life.wind` (`wind.js`, `windTuning.js`)
- `at(x, z, out)` → `out` `{ x, z, k, alarm }`: the air's velocity there (m/s), `k` 0..1 how much gust is
  passing, `alarm` 0..1 the share of it that alarms what perches (a `quiet` front adds to `k`, not to
  `alarm`). Pass your own record (with none a shared one comes back: read it at once). No allocation.
  Off: all zero.
- `front(o)` → its slot or -1: a gust front across the level. `o` `{ strength (1 = an ordinary gust, ≤ 3),
  speed (m/s), width (its tail, m), dirX, dirZ (default: the prevailing way ± spread), from (m upwind of
  the focus where it is born), x, z (born AT that point: the fight's own; it swells in over 0.15 s instead
  of 0.8, its patches peak on the line through the point), quiet }`. A missing number is drawn from the
  level's `fronts` ranges. Refused with the piece off, and in a still level (the grove) unless it is born at
  a point. 4 slots (`WIND_SLOTS`); all busy, the one furthest along gives way.
- `burst(x, z, strength, radius)`: a radial push from a point, an expanding ring (`WIND_BURST`: grows at
  `grow` 1.1 × radius a second, `width` 0.45 × radius, lives `life` 1.6 s, pushes `air` 4 m/s at strength 1;
  ≤ 4 at once, strength ≤ 3, radius ≤ 40). `life.gust` lands here. It also moves the still grove's air.
- `lull(sec)` the air falls still (`WIND_LULL` hold 6, ease 1.2 s); `dirX`, `dirZ` (unit), `speed` (m/s),
  `level` 0..1 (prevailing + the front at the focus, over the level's `loud` m/s: the air's sound), `gust`
  0..1 the front passing the focus, `still` (true in the grove), `fronts`, `bursts`, `wisped` (wisps
  born this visit: the tests).
- **The field.** The prevailing direction wanders (`dir` ± `wander` deg on two slow sines); the speed
  breathes between `floor` and 1 × `speed` on two sines (`periods`), held still at the bottom by `pause`
  (the fox's sighs), made restless by `fit` (the ash). The strength `_k` = `life.k` × `weather.windK`.
  `life.hush` takes `WIND_HUSH.speed` 0.85 × hush off the prevailing speed and stops new fronts while it
  holds; an ambient front dies down by it, a front born at a point (a roar's) goes on. Fronts are born every
  `fronts.every` s, the clock running at `life.calm` (fewer in the fight). A front: a line moving along its
  direction; ahead of its edge the air rises over `lead` m, behind it decays over `tail` m; the edge bows
  (2.4 and 1.1 m sines along it) and its strength comes in patches (0.62 – 1 along its length); born `from`
  m upwind of the focus, gone `to` m downwind, easing in and out. The Throne has a `sink` instead: the air is
  drawn toward (0, -21.4), fading inside 4 m of it and out to its `radius` 60 m; no fronts.
- **The uniforms** (written once a frame while the piece is on; all zero again the frame it goes off):
  `U.uWind` vec4 (dirX, dirZ, speed, level); `U.uWindFronts` vec4[`WIND_FRONTS_LEN` 12]: `[2i]` front i
  (nx, nz, edge position along n, strength × env × `_k`; 0 = none), `[2i + 1]` (tail, lead, phase, 0), `[8]`
  the sink (x, z, 1 when on, 0), `[9]` the field's travel (x, z: the grass's patches ride it downwind), `[10]`
  the grass's answer (lean, wave, front × (0.5 + 0.5 calm): a gust's stir steps back in the fight, patch:
  how far that stir is broken into loose local patches), `[11]` the trees' (lean, rock, front, stir). A still level still writes its direction (dir (0, 0) means
  "off"). `shaderLib.js` exports `WIND_SLOTS` 4, `WIND_FRONTS_LEN`, and **`WIND_GLSL`** (vertex):
  `windOn()` (false while uWind's direction is zero: the reader keeps its old motion exactly),
  `windDirAt(xz)` (toward the sink where there is one), `windFronts(xz, out dir, out edge)` → how much front
  passes there (0..~1.2), its direction, how much of it is the leading edge. wind.js `_frontK` is the same
  formula on the CPU (keep the two in step; `hang.js` `hangLean` is a third copy).
- **Who reads it.** The grass (`grass.js`, WIND_GLSL): with the wind on the blade leans along the
  prevailing air (`lean`), in patches travelling downwind (`wave`), and is bent by a passing front
  (`front`; the bend clamped at 0.9 of its height) and fluttered in it, the front's strength there
  multiplied by mix(1, smoothstep(0.25, 0.75, pattern), `patch`): an uneven pattern riding the field's
  travel, so a gust stirs loose local patches, never a band across the view. Its colour never changes
  with the wind (the old `lift`, a lighter band behind a front's edge, is gone). The trees and anything with `aSway`
  (`createAsciiObjectMaterial`): lean and rock along it, a front bends the bough (`front`) and stirs it
  crosswise (`stir`). The fire field (`fire.wind`, `fire.windK` = the level's `fire` `{ smoke, flame }`;
  set while the piece is on, null when off): each smoke puff takes the air where it is, the flames the
  air at the focus once a frame. The atmosphere: the bonfire's smoke and embers take the air at the
  bonfire, its mist, leaves, ash and embers the air at the focus (each still drawn from Math.random as
  before: the count is unchanged). The weather, the litter, the creatures, hanging cloth, the hero's hair
  (`anim.js` `HAIR_WIND` 0.06 per m/s), the Ring's dust and rain (turned to the wind's way), the air's
  sound. The Windless Grove's bamboo (`aSway`) no longer sways while the piece is on: its speed is 0.
- **The wisps** (`_wisps`, the wind's only letters; STYLE.md "The living world"): clumps of many tiny
  faint letters in the house letter, printed by the wind's own `LetterBatch` (below), nothing in the
  shared pools. The batch is made on the first update with the piece on in a level with a `wisps` block:
  `round(max × quality)` clumps (quality clamped 0.3 – 1, at least 1) of up to `per[1]` letters each
  (at quality 1 `max` 10 × 96 = 960 letters), its letters the tuning's `glyph` plus the four strokes
  `- / | \`. It is built on the wisps' OWN stream (an LCG seeded from a hash of the level id; Math.random
  is swapped for it while three.js draws the batch's uuids), not through `life.build`: building through
  it moved `life.rand`, which the creatures and the fronts draw from, and how many wisps there are
  must never move what the other layers draw. Births: in the breeze `rate` a second × quality × calm ×
  min(1.5, k) × min(1.5, speed / the level's `speed`), at a point of the `view` round the focus (x ±19,
  z -13 .. +9 m), with `calmPer` 0.65 of the letters; where a front passes (its edge within 30 m of the
  focus, env ≥ 0.05) `gust` a second × quality × calm × min(1.5, k) × min(1.5, strength) × env, along its
  edge and up to 1.4 tails behind it, kept with the front's patch² (fewer between its patches), `len` ×
  `gustLen`; none within a 2 m square round the hero. A wisp: velocity eased toward `wind.at` × `carry`
  (time constant `ease`), its axis turning to its way over 1.5 s; in over the first 0.18 of its `life`,
  out from 0.6, × calm; `len` × (1 + `stretch` × age) along, `width` × (1 + `spread` × age) across, its axis
  bent by a `curl` (× 0.4 – 1.2) sine of `wave` rad/m running along it. A letter: its place along
  (triangular: dense in the middle) and across, its own `flow` m/s along the clump, its own fade in and
  out (born at 0 – 0.3 of the wisp's life, gone at 0.5 – 1), alpha `alpha` × 0.4 – 1 × (1 - 4u²) toward
  the ends × a slow shimmer, faded inside `heroClear` 0.6 – 1.8 m of the hero; 0.45 – 1.3 m (`y`) over
  the ground ± `rise`. A `-` of the glyph list prints as whichever of `- / | \` runs along the wisp on
  screen there (`uCamRight`, `uCamUp`). Off, hidden, or the level's `wisps` null: the clumps go at once.
- **`WIND_TUNE[level]`** (`BASE` merged under each): `dir`, `wander`, `speed`, `breath { floor, periods,
  pause, fit }`, `fronts { every, strength, speed, tail, lead, air, spread, from, to }` (null: none),
  `sink { x, z, radius }`, `wisps { max, per, calmPer, rate, gust, life, len, gustLen, width, stretch,
  spread, flow, curl, wave, y, rise, carry, ease, view, size, alpha, color, glyph, heroClear, snap? }`
  (null: none; `snap` 1 puts a letter's cell on the art grid instead of the nearest pixel, unset today),
  `grass { lean, wave, front, patch }`, `trees { lean, rock, front, stir }`, `loud`, `fire { smoke, flame }`.
  BASE: dir 0, speed 1.4, fronts every 9 – 15 s at 7 – 8.5 m/s, tail 4.5 – 6.5, lead 0.9, air 2.2, from 40,
  to 50; wisps max 10, per 64 – 96, rate 0.6, gust 3.2, life 5 – 8 s, len 1.8 – 3 m (gustLen 1.35), width
  0.16 – 0.34 m, stretch 0.9, spread 0.8, flow 0.28, curl 0.3, wave 0.9, y 0.45 – 1.3, rise 0.12, carry
  1, ease 0.9, size 0.34, alpha 0.4, color (0.62, 0.7, 0.68), glyph `-~.,'` plus a backtick and `:`; grass
  lean 0.16, wave 0.2, front 0.24, patch 1; trees lean 0.3, rock 0.25, front 0.28, stir 0.08.
  Cinderwood: dir -18, 1.5 m/s, a front every 8 – 14 s. Ash: dir -8, 1.6 m/s, fitful (`fit` 0.45,
  floor 0.35), a front every 6 – 11 s at 8 – 9.5 m/s, wisps grey (rate 0.7, gust 3.4), grass front 0.22.
  Starless: the sink, 0.45 m/s, breathing on 9 s, no fronts, no wisps, grass front 0. Ring: dir 0 (toward
  +x), 3.2 m/s, floor 0.78, a front every 5 – 9 s at 9 – 10.5 m/s, `loud` 6, wisps dust-coloured (rate
  0.8), grass front 0.22. Fox: dir -25, 1.3 m/s, floor 0.05 with `pause` 0.38 (sighs), a front every 11 –
  18 s, wisps bluer (rate 0.45). Grove: `still`, speed 0, no fronts, no wisps.

### The weather — `life.weather` (`weather.js`, `weatherTuning.js`)
- `name` (the spell now: it switches half way through a cross-fade), `spell` (the one it is heading
  for), `wet` 0..1 (rain falling), `mist` 0..1, `windK` (× the wind's strength; 1 = none), `light` (the
  moon factor), `flash` (the Ring's far lightning, 0..about 1 × k), `bolt` 0..1 (flash against the
  brightest a bolt reaches: the air's far thunder), `breath` 0..1 (the Throne's breath), `val` (every
  value), `spells`, `tune`, `force(name, fade)` (start a spell now; the Lab's '<spell> now' buttons ease in
  over `labFade` 8 s). Off: 'clear', 0, 0, 1 (flash, breath, bolt 0, light 1).
- **The director.** Per level a list of spells, each `{ hold [s, s], fade [s, s], next [[name, weight]],
  option?, values }`; values (`mist`, `foot`, `wet`, `windK`, `moon`, `ambient`, `fogNear`, `fogFar`,
  `fogColor`, `embers`, `grey`, `breath`, `devils`, `bolts`, `snow`) default to 0, the factors to 1. A visit
  starts in the level's `calm` spell at once (its first hold `firstHold` if the level has one); the next
  is picked by weight, a spell unseen for `longing` 90 s weighing twice; values cross-fade on a smoothstep
  over the new spell's `fade`. Its own two streams (the director's, the drawing's), each seeded once from
  `life.rand`: the same level gives the same sequence, and the phone's counts never move it. In the fight
  (`life.calm` under `fightCalm` 0.995, or bossIntro / boss) no new spell starts and the director heads back
  to the calm spell over at most `fightFade` 10 s. A spell with an `option` exists only on a set built with
  that option (the grove's snow: `?grove=c`).
- **The light and the fog** (`moon`, `ambient`, `fogNear`, `fogFar`, `fogColor` are factors). It never
  sets a uniform to a value of its own: each frame it takes last frame's factor off (only where the uniform
  still holds exactly what it wrote: a value another system wrote meanwhile is that system's new base),
  then multiplies the current base. It stands aside while `atmosphere.skyGlow` is on (that one saves and
  restores the colours itself), in a level with `sky: false` (the Ring, whose ambience writes the light
  every frame: it adds `weather.flash` itself, `write(U, far, bolts)`), while every factor is 1 (within
  `idle` 1e-4), and with the piece off. Test `weather.uniforms`: off, the uniforms are bit-identical.
- **Per level** (spells; `calm` first): Cinderwood clear (mist 0.3) ↔ mist (fog in, `fogColor` 4) →
  drizzle (wet 0.5, windK 1.25, tiny strokes at the wind's slant). Ash ashfall → squall (windK 1.6, a
  stream of tiny ember dots in an additive batch) or greyout (grey ash hanging, fog pulled in to 0.55 / 0.66). Starless still (20 – 36 s; the
  first 4 – 7 s) ↔ breath (2 – 3.5 s): `set.ambience.breathe(k)` each frame (throneHall.js: the seal swells,
  a pulse runs out along the inlay, red motes rise over the seal and round the camera, the ambient and fog
  warm). Ring dusk ↔ gathering (windK 1.3): dust devils and far dry lightning, before the fight only
  (`_pre` eases out over 0.6 s once the boss is up or past form 1). Fox moonlit ↔ cloud (moon 0.75,
  ambient 0.82) ↔ groundmist (the terrace's foot, r 17 – 24). Grove still ↔ mist (pools low, no drift) ↔
  snow (option c).
- **What it draws.** Nothing in the shared pools any more: every letter of the weather prints in the
  house letter in its **own batches** (`LetterBatch`, below; each made on first use through `life.build`
  with the drawing's stream standing in for the atlas's later uuids, registered with the pipeline,
  written by the weather each frame). The main batch (`_batch`) holds, written each frame: the mist
  **banks** (`BANK`: at most `max` 6 × quality, each `per` 160 – 220 letters (`. , ' - : ~` and a backtick, the Grove
  110 – 150), `rate` 1.2 banks a second in view at full mist; born in a band of the level wherever its
  value is above the band's `veil`, now 0 everywhere: from the first breath of mist), and the Ring's
  **dust devils** (at most 2, `letters` 150 each, a 5 – 7 m column with a 0.55 – 0.9 m funnel at the top
  leaning downwind, alpha 0.32, the first 3 – 6 s in; its whole path kept off the ring (|x|, |z| ≥ 18) and
  6 m from the hero); and, spawned (moving and fading by themselves, aged by the batch's `flow`), what
  falls: the drizzle (`rate` 70; a drop is `|`, or `\` / `/` past `slant` 0.45 of its fall's on-screen
  speed across, `ticks` 0.3 of them a `'` or `,`; alpha 0.22 → 0.1), the grey-out's ash (alpha 0.42) and
  the snow (`. ' *`, alpha 0.36), at most `fallMax` 700 (rate × the longest life × quality × 1.15, capped).
  The ember squall has its own ADDITIVE batch (`_emberBatch`: rate × life × quality × 1.15 letters, 26 a
  second of `. '` dots in a dim ember red, `bright` 0.15 of them in `brightColor`). **A bank**: a soft heap,
  each letter placed by three uniforms summed (`spread` 4.6 m along the air, 1.8 m across, × `scale` 0.75 –
  1.15, lengthening by `grow` 0.35 over its life, its heart `rise` 0.5 m higher), a thin mist's bank
  `thin` 0.3 of the letters at half the brightness; each letter comes and goes on its own `cycle` 4 – 9 s
  beat (then is placed anew elsewhere in the bank) and streams `stream` 0.7 m along the air and rises
  `lift` 0.12 m while it is there, so the bank rolls; the bank is carried by the air (eased over 2 s, its
  axis turning over 4 s), lives 18 – 28 s, in over `fadeIn` 5 s, out over `fadeOut` 6 s, × calm, faded inside
  `heroClear` 0.5 – 1.7 m of the hero. The old VEIL (the atmosphere's wide faint `~ -` strokes, drawn by
  the weather while it took the mist) is gone: with the weather on, the banks are the mist. The air it
  drifts on: `wind.at` × the level's `carry` while the wind blows, else its own `drift` × windK, nothing
  in a still level. Every rate × quality × k × calm; spawns 2.5 m (mist) / 0.8 m (what falls, where it
  lands) off the hero. `takes('mist')` where the level has `mist` (Cinderwood, Fox, Grove).

### The air's letters — `LetterBatch` (`world/life/letterBatch.js`)
**The fast path** (`?lifeFast=0` turns it off: today's paths exactly; `LIFE.fast`, `setLifeFast(on)` in
`life/lifeSwitch.js`, read every frame so it can be flipped live; ADR-245). Every living-world batch
(`LetterBatch.end()` / `empty()`, the litter's pool and its leaf print, the steps' pool) hands its letters
over through `life/ship.js`: `ship(mesh, n, a, b, c, d)` after the owner wrote n instances (always the
first n) uploads ONE range [0, n) per attribute (a kept range record: no allocation) instead of every
slot the batch could hold, and an empty batch leaves the frame by its layer mask (`mesh.layers.mask` 0,
restored by `unship` or the next n > 0; an owner's `visible` is never touched and still wins). Off the
fast path `ship` marks the whole arrays as before. The ground's step flash and the grass's wake return at
once outside one circle round all their prints / chunks (`uDpStepB`, `uTrailAll`: x, z, radius, w 1 =
the circle is meant; w 0 = no circle, the loops walk everything as before), and a print farther than the
foot's longer half is skipped before its `cos` / `sin`: exact, since those loops find nothing out there.
How the wind's wisps and the weather print (STYLE.md "The living world": the air is clumps of many tiny
faint letters). Each letter is a world point projected to the screen and printed as ONE cell of the
house letter, the wyrm's pixel font (`render/wyrmGlyphs.js`; 5 x 8 px with the 720p font, 4 x 6 with the
small one, 6 x 9 with the large), whatever its distance: pixel-exact, nearest-filtered, its cell's corner
on a whole pixel (`snap` 1: on the art grid). It follows the art pass's font (`pipeline.artFont`,
`artCell`) and rebuilds its atlas when that changes. A soft depth test against the scene (`uSoft` 0.6
m), normal or additive blending, drawn in the FX pass (registered with `pipeline.registerParticles`;
its `update()` is a no-op: its owner writes it).
- `new LetterBatch(game, max, chars, { additive, spawned, snap, rand })`: `max` letters at most, `chars`
  the letters it can print (atlas columns 1.., 0 blank), `spawned` the share of `max` kept for spawned
  letters, `rand` the stream three.js's uuids draw from when the atlas is rebuilt (never Math.random;
  build the batch itself through `life.build` or with Math.random swapped for an own stream).
- `col(ch)` → the atlas column of a letter (0: blank, one it lacks).
- Each frame: `begin()`, then `flow(dt, t)` (ages, moves and writes the SPAWNED letters), `put(x, y, z,
  size, col, rot, color, alpha)` (one WRITTEN letter, placed by its owner this frame: how a clump
  stretches, curls and thins as one shape; `size` and `rot` are kept for the callers' shape, the house
  letter has one size and stands upright), `end()`. `spawn({ x, y, z, vx, vy, vz, life, col, color,
  colorEnd, alpha, alphaEnd, drag, gravity, flicker })` → false when the spawned store is full (a
  spawned letter fades in over the first tenth of its life). `empty()` drops everything; `count` the
  letters drawn. No allocation per frame, no Math.random; a NaN position is skipped.
- `wyrmGlyphs.js` `createWyrmLetterAtlas(key, s, chars)` → `{ texture, total }`: an atlas of any letters of
  a wyrm font at integer scale, drawn as the wyrm's own (the same cell, the same soft halo). The fonts
  gained `, ~ = * +` and a backtick for the air; the wyrm's own atlas and sets are unchanged.

### The litter — `life.litter` (`litter.js`, `litterTuning.js`)
- `scatter(x, z, r, k)` → how many letters it moved: what lies (or flies) within r is thrown outward and
  up (`LITTER.scatter` out 5.5, up 3.2 m/s at k 1 at the centre); `count`, `lying`, `shower(n)` (the Lab's
  'leaf shower': 60 start falling round the camera). Off: 0, no pool.
- **Records → its own batch.** One pool (`LitterBatch`, `GlyphParticles` with a no-op update, `max` 500,
  `uSoft` 0.2, made on the first update through `life.build`); `LITTER.max` records in a stable array (a
  letter keeps its record from falling to lying to lifting); at most 500 × quality live. Each frame the
  records are written straight into the instance buffers: one draw call, no spawn churn, no allocation.
- **A letter's life**: AIR (it falls at its own speed, `fall`, carried by `wind.at` × `carry`, swings by
  `slip` and turns) → LYING (0.16 m over the floor, or on the blade tips where the meadow is thick:
  `grass` × the mean blade) → AIR again when the air over it is faster than its own `lift` (checked
  round-robin every 4th frame; × (1 + `shelter` × 2) where it piles), when the hero runs through it (2.2 m/s
  or more, within 1.05 m), or when a blow scatters it → FADE when it is recycled (it lay its `last` out, or
  more than `lying` × quality lie: the oldest out of view first). A lying letter fades out within 0.32 –
  0.7 m of the hero. A kind with a `ground` block lies as other letters (`ground.glyphs`, `ground.size`).
- **The window** round the focus: x ± 22, z -19 .. +15 m. A lying letter the window leaves behind is moved to
  the band (3 m) at its other edge, out of view; a jump of the focus over 12 m lays the ground anew; a
  moving camera lays some ahead of it. At the start the window is laid with `lying` letters and the air
  holds what would already be falling.
- **`LITTER.levels[id]`**: `takes`, `rate` (letters a second × calm × quality × k), `lying`, `last`,
  `grass`, `shelter`, `kerb`, `kinds [{ share, glyphs, ground, color, color2, size, fall, slip, flutter,
  spin, tau, lift, carry, hop, lie, alpha, from, flat, where, source }]` (`where.at` 'rim' | 'near' | 'ash' |
  'kerb' | 'flat'; `source` 'sky' or 'edge': tumbles in along the ground from upwind). Cinderwood leaves
  4.5 / s, 170 lying, rim-weighted (r 8 – 28); Ash ash 18 / s lying as flat strokes in the lee of stones
  (`where.tags`), 240 lying, 14 – 28 s; Starless ember-edged cinders 0.35 / s, 26 lying; Ring grit and seed
  3 / s tumbling in from upwind and piling at the kerb (|x|, |z| 14.8); Fox dry leaves and paper slips
  (`=[]` round the charm posts at r 16.5) 3 / s; Grove single leaves 0.3 / s, straight down.
- `takes`: 'leaves' on Cinderwood, Starless, Ring, Fox, Grove (only Cinderwood, Fox and the Grove draw
  the atmosphere's leaves: the other two run a set ambience instead); 'ash' on Ash (the ashfall's grey
  flakes move into the litter; the embers stay with the atmosphere).

### The steps — `life.steps` (`steps.js`, `stepsTuning.js`)
- `surfaceAt(x, z)` → one of `SURFACES` 'grass' | 'earth' | 'stone' | 'ash' | 'obsidian' | 'sand' |
  'leaf' (works with the piece off: the audio asks it), `grassAt(x, z)`, `step(x, z, o)` (`o` `{ sprint,
  heavy, side, vx, vz, kick }`), **`footfall(x, z, o)`** (the hero's hooks: draws the step and returns the
  surface while the piece is on, else undefined), `prints` (marks lying now). Off: nothing drawn.
- **The map** (`STEPS.levels[id]`, else `fallback`), first answer wins: `over` shapes (Ash: ash over the
  courtyard's square, `COURTYARD.half`; Starless: obsidian in `THRONE.R`; Ring: stone in `RING.half`), a slab
  (inside one of the set's `slabs` outlines, joints within `joint` 0.18 m included: `slab`), `areas` (the
  grove's earth in `GROVE.clearR`), grass (`world.fire.density` ≥ `grassMin` 0.3: `grass`), `ground`.
  Cinderwood: stone / grass / earth; Ash: stone steps and path, ash everywhere else; Starless: obsidian,
  the path stone, grass, earth; Ring: stone, the lake bed's plates and the badlands sand; Fox: stone /
  grass / earth; Grove: stone, earth to the clearing's edge, leaf beyond. Classified once per 0.5 m cell
  over 160 m (one byte, cached as asked; off the map worked out each time).
- **A step** (`surfaces[surface]`, with `perLevel` changes; counts per step at a run / sprint / heavy
  landing × quality × (0.5 + 0.5 calm)): grass torn blade bits on a sprint and the trample; earth a small
  puff and a print (5 s); stone a grit puff on a sprint or landing only; sand a puff the wind carries
  (0.8 of the air); ash a hanging puff and a print (14 s); obsidian a dim red glint (0.75 s; before the fight only: `life.calm` > 0.99); leaf a flick;
  the grove's earth no puff. Every step also calls `litter.scatter` (r 0.5, k 0.25 × k; heavy 1.4 / 0.7),
  and on wet ground (`weather.wet` > 0.3) a tiny splash. Puffs go to fx.alpha; prints and glints lie in
  the steps' **own pool** (made on the first mark through `life.build`; `prints.max` 120 × quality, at
  least 30, `uSoft` 0.08), refreshed every 0.1 s from the steps' own records (a glint every frame).
- **The trample = the scorch map's blue channel** (`scorch.trample(x, z, r, k)` max-blended, a disc with a
  soft edge, at most `maxCells` 2048 cells; `scorch.trampleAt(x, z)`; it stands up linearly over
  `trample.decay` 10 s; `scorch.reset()` clears it; no random draw). A run treads r 0.7, a sprint 0.85, a
  heavy landing 1.2 m. The grass shader reads it (`scorch4At(xz).z` since ADR-180, which reads the torn
  grass in the same fetch; `trampleAt`): a trodden blade lies
  flatter every way and is drawn darker (up to 0.7 × darker). scorch.js imports `STEPS` for the decay and
  the cap.
  **Since ADR-193 all of this is `?bend=0` only.** With the wake on (the default), the steps write no B:
  a sprint step or a heavy landing calls `world.trail.press(x, z, r)` to widen the wake for 0.3 s.
- **The hero's wake** (`world/grassTrail.js` `GrassTrail`, `world.trail`; ADR-193; `?bend=0|a|b|c`, default
  `b`, `GRASS.bend` in grassTuning.js; read once, `bendLook()`): `world.update` calls `trail.update(dt, P)`
  after the player with pusher slot 0. It keeps the hero's last `TRAIL_N` 32 points (x, z, age, r): a new
  one every 0.35 m and 0.08 s (at once past 1 m; a jump over 3 m starts afresh; standing keeps the point
  under him pressed; airborne, y > 1.5, radius 0; full, the straightest older point goes). It writes the
  shared uniforms `uTrail[32]`, `uTrailBox[4]` (a bounding circle per `TRAIL_CH` chunk of `TRAIL_SEG` 8, so
  the shader skips what is far), `uBend`, `uBendT`, `uBendS`, `uBendE` (shaderLib.js). The grass shader's
  `trailBend` finds each blade's nearest stretch of the path and bends it ALONG his way and OUT from the
  path with a smooth (1 - s²)² falloff (no map cells; ± 10° per blade), holds, then springs back by a
  per-blade damped spring (blades at the edge sooner); a bent blade is at most 5 - 10 % darker by how bent
  it is. With the wake on it replaces pusher slot 0; the boss's pushers (1 - 9) are unchanged. b (default):
  hold 0.35 s, critically damped, rises over 2 - 2.6 s; a: a quick spring with a 10 % overshoot, back in
  about 1 s; c: combed along his way, closing from the edges in, 0.8 - 2 s. `trail.clear()` on
  `world.restore()`; `trail.bendAt()` is the shader's maths on the CPU (the tests'; keep the two in step by
  hand). With `?life=off` the wake still bends (it belongs to the world, like the pusher). No random draw,
  no event, about 1.4 µs a frame on the CPU; the grass draw 0.27 → 0.31 - 0.53 ms at quality 1 (desktop).
- **The hooks**: player.js `_footstep` (the payload gains `surface` and today's dust is skipped while the
  piece is on), the plunge's landing and flurry.js's touchdown (heavy), the roll's landing (heavy; today's
  dust when footfall says nothing). sfx.js `footstep` plays a recipe per surface when `o.surface` is set
  (on its own stream, `seed`), today's sound without it, and a wet tick on wet ground.

### The creatures — `life.creatures` (`creatures.js`, `creaturesTuning.js`)
- `startle(x, z, r, k)` → how many fled: fireflies pushed out, moths scatter, perched birds take off;
  read-only `fireflies`, `moths`, `birds` (`state` 'perched' | 'flying' | 'away'), `sparks`, `hawk`, `drawn
  { alpha, add }` (letters this frame), `returnBirds()`. Off: nothing.
- **Records, re-drawn each frame** as one-frame particles (as atmosphere.js drew its fireflies):
  fireflies and sparks in fx.add, birds, moths and the hawk in fx.alpha; no own pool. Built on the first
  update with the piece on. A record draws while its share `q` < quality × calm^1.5 (birds and the hawk
  are not thinned). Perches come from the set's `breakables` (by `kind`, radius and height: Cinderwood
  'tree' r 29 – 37, 8 groups of 2 – 4; Ash 'pillar', 6 groups of 1 – 3; Fox 'deadTree', 4 groups of 2 – 3);
  a perch whose piece is no longer INTACT (`world.destructibles.list`) is left. A perched letter is drawn 3
  m toward the camera (the particles are depth-tested: it would sit inside the crown). Moths round the
  bonfire (and on the Ring 2 round each 'post' brazier); they scatter while the hero stands within 1.4 m
  of the flame or the fire is out.
- **Alarm** (`TUNE.alarm`): a hero running over 3.4 m/s within 8.5 m, any hero within 3.5 m, or
  `wind.at(perch).alarm` over 0.85 (a quiet front never alarms). The others within 4.5 m go with it. A bird
  flies up and out of the arena, is gone after 7 s, may come back after 30 – 60 s only to a standing perch
  out of view, never in the fight. `clear('reset')` refills perches out of view.
- **The hawk** (Ring only, before the fight): `-v-` (a body and two wing letters along the camera's
  right, banked), circling r 9 m at 6.5 m, a lap in 25 s, centred 2 m south of the focus; the boss wakes:
  it climbs away and is gone in 4 s. Its shadow is dropped (`shadowAlpha` 0).
- `life.hush` dims fireflies by 0.85 × hush, moths and sparks 0.8, perched birds 0.6.
- `takes('fireflies')` where the level has fireflies (Cinderwood 60, Fox 50 paler and bluer, Grove 30
  near-still); Ash crows and 3 moths; Starless nothing (`sparks.perVent` 0); Ring the hawk and moths.
- `CREATURES_TUNE`: `firefly`, `moth`, `birds { small, crow }`, `alarm`, `view`, `hawk`, `spark`, `levels[id]
  { fireflies { n, r, inner, innerR, color?, hr?, runR?, wander?, windK? }, moths { n, braziers? }, birds {
  kind, kinds, r, minH?, groups, perGroup, yK, inK, look? }, sparks { perVent }, hawk }`.
- **The fauna** (2026-11-23, ADR-177; `flock.js` `Flocks`, `animals.js` `Animals`, numbers
  `faunaTuning.js` `FAUNA_TUNE`; part of the piece `creatures`): flocks hidden in a level's canopy that
  burst out and wheel away when fire, a heavy blow, a falling or burning tree or a roar reaches them,
  and small ground animals that bolt into cover when the hero or the fight comes near. Added to the
  creatures: `impact(x, z, r, power, o)` / `ignite(x, z, r, k)` (from `life.impact` / `life.ignite`),
  `fell(x, z, kind)` (from the answer: `world:impact`), read-only `flocks`, `animals`, `drawn.letters`,
  and `flockFlees()` / `lifeReturns()` (the Lab). Built once on the first update with the piece on
  (`_buildFauna`), on the fauna's OWN stream (an LCG seeded from a hash of the level id: never
  `life.rand`, never Math.random, so how many there are never moves what the other layers draw); both
  print in ONE `LetterBatch` of the creatures' own (`FAUNA_TUNE.max` 260 letters, `letters`
  `v - ~ ' 0 = | / \ c x + .`, normal blending; Math.random swapped for the fauna's stream while three.js
  draws its uuids). Nothing is drawn within `FLOCK.clear` 2.2 m of where it would print over a fighter
  (the hero on the ground, the boss's hurt spheres), nothing to hit, nothing that hits.
- **Roosts** (`levels[id].roosts { kinds, r, minH, n, birds, yK, inK, look }`): n stretches of canopy,
  one in each of n sectors round the level, chosen among the set's breakables of those kinds between
  r[0] and r[1] m out and at least `minH` tall, at `yK` of the piece's height and `inK` m toward the
  clearing, each holding `birds` of them. Cinderwood 11 roosts of 30 – 44 small birds on the tree wall
  (r 29 – 42, minH 7); Ashfall 5 of 9 – 15 crows on the pillars and dead trees (r 16 – 32; darker,
  heavier, slower: `look`); the Foxfire Terrace 5 of 12 – 22 on the dead trees (r 20 – 34); Halcyon Plaza
  5 of 14 – 24 pigeons on the tower tops and the blocks' fronts (r 20 – 36; not seen on film). None on the
  Ring, the Throne, the Grove or the Hall of Falling Script.
- **What sends a roost up** (`FAUNA_TUNE.flush`; `flocks.fire / blow / fell / startle`, the roost
  nearest the cause that still has birds): fire within `fire` 10 m (+ its radius); a blow of `power` 0.9
  or more within `blow` 8 m (+ its reach); a tree falling, crashing, catching or (wood) breaking within
  `fell` 14 m; a startle of k ≥ `startleK` 0.6 within min(r, `startleR` 45 m); a roost whose own tree
  comes down (once). Limits: `gap` 5 s between two flocks anywhere on the level, at most `max` 3 in the
  air, and a roost that went stays EMPTY until the fight is over (a level has a finite number of
  birds). A flock takes `round(birds × quality)` birds (at least 4, at most 48).
- **The way through the camera's sky.** The game camera looks down 58° through a 32° lens: from the middle
  of an arena the tree wall is out of the frame, and a bird high up shows farther up the screen than the
  ground under it. So a roost not behind the camera (on screen above `way.behind` −1.15) is ROUTED: the
  flock climbs out of the crown (`out` 6 m, `rise` 2.5 m), banks to `high` 9 – 12 m into the TOP BAND of
  the frame (screen height `band` 0.6 – 0.74, `near` 0.15 – 0.45 of the half screen out on the roost's
  side), then across and out of the frame on the far side (`far` 1.45, `top` 0.82, climbing `climbOut`
  3 m more); its knots are placed where they SHOW (on the camera's line of sight, `camera.unproject`; the
  game camera's numbers headless), along a Catmull-Rom spline. A roost behind the camera just climbs out
  and away. Each bird keeps its own drifting place round the way's point (a spring `spring` 6 / `damp`
  3.4 coming in over `gather` 1.1 s; the shape `along` 1.1 × `across` 0.55 × `up` 0.4 m, loosening to
  `loose` 2.4 × over its `life` 10 s; each place drifting at `drift` 0.12 – 0.35 Hz); the birds leave over
  `burst` 1.1 s (`launchUp` 4.5 – 7 m/s, `launchOut` 1.5 – 3), fly at `speed` 5 → 8.5 m/s (`accel` 1.1 s),
  and each drops out at its own share `quit` 0.4 – 1 of the life, fading over `fade` 1.4 s, so the flock
  thins instead of ending. A bird is one letter: `wings` `v` / `-` with its beat (`beat` 7 → 3.6 a second),
  `-` gliding; moon-grey (0.46, 0.48, 0.56) at `alpha` 0.72.
- **Animals** (`levels[id].animals [{ kind, n, r, square?, near?, nearR?, group?, cover, along?, at?,
  once? }]`, `FAUNA_TUNE.kinds`): placed outside the level's `keepOut` (the fighting ground: Cinderwood 22
  m round, Ashfall 14.5 square, the Ring 16 square, the Terrace 14.5, the Plaza 15), never within 14 m of
  the hero's spawn, never under what stands. They sit nearly invisible; a hero within `r` (`runR` while
  he runs), a blow (`r` + 6 + 6 × min(2, power) m round it), fire (r + 8), a tree falling (10 m), a startle
  or a gust's alarm (one sitting animal checked a frame) puts them up after `react` s, and each BOLTS by
  its gait to its cover (`cover` m out) and is gone. Cinderwood 6 rabbits (`hop`, r 7, 5.5 m/s) and a herd
  of 3 deer (`bound`, r 13, 7.5 m/s); Ashfall 6 rats by the pillars, the colossi and the lanterns
  (`dart` along the wall); the Ring 5 lizards (`scuttle`); the Terrace ONE fox by the great fox's
  statue (`trot`, a look back at the hero `look` 1.1 s, `lookAt` 0.9 s into its run, a foxfire glint
  where its tail slipped into the dark; `once`: gone for the visit). `animals.list` (`state` 'sit' |
  'wait' | 'run' | 'hid' | 'gone'), `alarm(x, z, r, why)` → how many bolted, `returnAll()`.
- **After the fight** (`FAUNA_TUNE.back`; the game state 'explore' or 'victory'; `back` = s since the boss
  was last up): each empty roost fills again after `roost` 20 – 80 s, an inbound flock of `inbound` 5 – 9
  birds flying in across the top band to its crown over `inT` 5 s; an animal is back at its place after
  `animal` 25 – 90 s (fading in over `fadeIn` 3 s, only with the hero more than `far` 1.6 × its alarm
  radius away). Nothing returns in the fight. The reset (`clear('reset')`) ends the flocks in the air and
  sends the running animals to cover; the empty roosts then refill on the same clock.

### The answer — `life.answer` (`answer.js`, `answerTuning.js`)
The world answers the fight from the catalogue's events, adding none, reaching the others through `life`
(`wind.front`, `creatures.startle`, `litter.scatter`, `life.hushFor`). It subscribes while its piece is on
and unsubscribes when it goes off (`_sync` each update: the Lab can flip it live).
| event | answer (DEFAULT numbers; strengths × `life.k`, applied once by the layer that draws: the wind's fronts, `creatures.startle`; the answer applies it itself only for `litter.scatter`) |
|---|---|
| `dragon:roar` {strength} | a front from the boss toward the hero (strength 2.4 × s, 15 m/s, width 11; s clamped 0.3 – 2), a startle over 70 m, scatter within 12 m of the boss |
| `dragon:wake` | a smaller front (0.8, 9 m/s, width 7), a startle over 40 m (k 0.5) |
| `dragon:land`, `dragon:explosion`, `player:slam`, `player:plungeHit` | scatter round the point (r 4 – 12 by the event's radius), a startle (at least 12 m); the radial air comes through `world.gust` → `life.gust` → `wind.burst`, not doubled |
| `combat:tell` red / black (not a bullet's), `combat:charge` | `hushFor` until the blow lands (`impactIn` / `dur`, clamped 0.3 – 2.5 s; depth 0.85, a charge 0.7). Normal and blue tells do nothing |
| `dragon:phase`, `dragon:phase2` – `phase4` | a hush of 1 s, then one long front (1.3, 7 m/s, width 22) and a startle |
| `dragon:dead`, `game:victory` | a lull: `hushFor(4, 1)` (the grove 6) |
| `player:died` | `hushFor(2.5, 0.8)` |
| `life.gust` ≥ 1.2 | `answer.gust`: a startle within its radius |
| `world:impact` kind 'topple' / 'crash' / 'burn', or 'break' with `mat` 'wood' (ADR-177) | `answerWorld`: `creatures.fell(x, z, kind)`: the roost there bursts out, the animals within 10 m bolt (the flocks' own limits keep a fire fight from emptying the sky); counted in `counts.world` |

Rate limits (`gap`, s): roar 1.5, wake 4, blow 0.25, hush 2.5, phase 4, lull 6, died 3, gust 0.3. Per level:
Ash's roar 2.2 / 16 m/s / width 8 (scatter 11 m), Starless 1.2 / 10 / 14 (wake 0.6), Ring 1.8 / 17 / 9, Grove
1.4 / 12 / 8 (the fight is the only air there; the lull 6 s). `answer.counts` (answers by kind), and the
Lab's "roar's answer" and "hush 2 s".

### The tremor — `life.tremor` (`tremor.js`, `tremorTuning.js`; piece `answer`; 2026-11-23, ADR-177)
What stands near a heavy blow shakes, by what it is, and settles in under a second. Fed by
`life.impact` (every `world.impact` and `world.groundBlow`).
- `impact(x, z, r, power, o)` → the shake's reach (m) or 0; `shake(x, z, r = 2, power = 1.2)` the same
  forced past the merge and the gap (the Lab's **tremor at hero**: power 1.4 beside him, a test); `stat`
  `{ shakes, merged, trees, canes, leaves, stones, dust, pebbles, kicks, gusts, gutters, reach }` (this
  page load); `off` (true: nothing, a film's "today"). Off (the piece): nothing; its letters go.
- **The shake.** A blow under `min` 0.7 (power × `life.k`) shakes nothing (a light cut, a step). Its reach
  is r × `reach.r` 1 + `reach.k` 3 × power^`pow` 2, at most `max` 30 m; at d m its strength is power × (1 −
  d / reach)^`fall` 1.2 (d from a piece's footprint). One blow that arrives twice (a heavy move calls
  `world.impact` AND `world.groundBlow`; a beam calls impact every 0.2 s) shakes once: a blow within
  `merge.r` 2.5 m and `merge.t` 0.25 s of a shake at least `merge.k` 0.9 as strong is merged (the last 8
  kept), and no weaker shake comes within `gap` 0.08 s of the last.
- **What answers** (`destructibles.around(x, z, reach, out, 80)`): a tree (wood of kind tree, deadTree,
  cinderBough, or with leaves) of strength ≥ `tree.min` 0.15 shudders (`destructibles.shudder`, `amp` 0.05
  rad per strength, at most `cap` 0.06) and drops leaves from its crown (`leaves` 14 per strength × its
  leafy share, at most `most` 20 a tree, `total` 50 a blow; `litter.showerAt(x, z, r, n, y0, y1, kind)`,
  which the litter then carries on the wind and lays); bamboo shivers quicker and smaller (`bamboo`
  0.07 / 0.08, 2 leaves, at most 3, 14); stone that stands `minH` 1.4 m or taller (no boulder, nothing of
  infinite structure) sifts a thin trickle of dust off its top (`per` 18 letters per strength, at most
  `most` 30 a piece and `total` 110 a blow, each its own start speed `fall` 0.02 – 0.5 m/s and pull
  `gravity` 0.7 – 3.6 m/s², at most `life` 1.6 – 3 s) and a faint puff at its foot (`puff` 12 per
  strength); a post, a lamp, a rack (other wood or metal) a half shudder. What hangs swings away from the
  blow (`hangKick`: `amp` 0.4 rad per power, at most `cap` 0.55, out to max(`min` 8 m, `reach` 2 × the
  shake's reach), falling off as (1 − d / that)² and running out at `HANG.kick.speed` 40 m/s, ringing
  down over `HANG.kick` (`decay` 1.7, `rate` 7.4 rad/s, `life` 2.6 s; paper × up to `paper` 1.35)). Pebbles
  hop (`floor`, power ≥ 0.95): `per` 22 × min(1.6, power) grit letters (at most `most` 34) in a ring from
  `in` 0.7 × r to `out` 0.55 × the reach, never on the hero or inside a collider, a beat after the blow
  (d / 40 m/s), `up` 1.2 – 2.1 m/s, one small bounce, lying `rest` 0.25 – 0.6 s, gone. The grass flattens
  outward through `world.gust` (`gust`: strength `k` 0.9 × power, at most `cap` 1.6, radius `rK` 0.9 × the
  reach) for a blow of `gust.min` 1 or more where no gust of over 0.4 was made within half the reach (the
  dragon's moves make their own; most duelists' blows do not; it then reaches `life.gust`: the wind's
  burst and the answer's startle). The bonfire gutters (`atmosphere.gutter(k, dx, dz)`, strength ≥
  `fire.min` 0.25 there: its flames dip and lean away, its light dims to 0.45 at most, more embers, back in
  ~0.6 s).
- Per level (`TREMOR_TUNING`, else `DEFAULT`): Cinderwood the defaults (green leaves); Ashfall, the
  Throne and the Ring dead trees that drop nothing and their own dust and grit colours; the Terrace a few
  dry leaves (4, at most 6, 18); the Grove no gust of the tremor's own (`gust.min` 99: the clearing is
  earth, the canes' leaves fall straight). Hall of Falling Script and the Plaza: the defaults.
- Its letters (dust, grit: `glyph`) print in the house letter in an own `LetterBatch` made at the first
  shake through `life.build` (`uSoft` 0.12: they lie low); its noise from its own LCG, no Math.random
  (`litter.showerAt` draws from `life.rand`). No allocation per frame.
- The sound (ADR-180; "The living world's sounds"): a shake is ONE `treeShudder` at its strongest tree
  (a second one only when three or more shook), a `treeCreak` at a leaning tree it shakes, `dustSift` at
  the strongest stone that sifted, `pebbles` where the floor hopped; and while the piece is on it listens
  to `world:impact` 'wear' (wood, the last stage: the lean) for a `treeCreak`. A blow also gutters the
  lamps (`life.lamps`, the same `life.impact`).

### The aftermath — `life.aftermath` (`aftermath.js`, `aftermathTuning.js`; piece `answer`; 2026-11-23, ADR-177)
What a fight leaves in the air after the flames and the blows; it thins by TIME, not by `life.calm` (the
fight is when it is made), lingers after a victory and is gone at the fight's reset (`clear('reset')`).
- `impact(x, z, r, power, o)` (a blow: dust may hang there), `ignite(x, z, r, k)` (fire: smoke may rise
  there after), `smoking` / `hazes` (columns smoking, hazes hanging now), `sources` / `haze` (the records:
  the tests), `stat` `{ sources, fed, smoked, dropped, hazes, embers }`, `off`. The Lab: **smoke at hero**,
  **crater dust at hero**.
- **Smoke** (`smoke`): where fire landed and has burned out (it waits `wait` 1.6 s after the last fire
  there, for the ground to stop burning, and only where the scorch map's char is at least `minBurn` 0.05:
  the flames' own smoke comes first), a thin slow column of tiny faint letters (`per` 130) rises `height`
  2.4 – 3.4 m at `rise` 0.4 – 0.6 m/s for `life` 20 – 40 s, `spread` 0.28 m at its foot and `grow` 0.6 more
  at the top, leaning with the wind (`carry` 0.35 of its speed, at most `lean` 1.8 m) and curling (`curl`
  0.3 m), thinning as it goes (fewer letters, fainter); colour (0.44, 0.44, 0.47), alpha 0.72, in over
  `fadeIn` 3 s. Fire landing within `merge` 3 m of a column feeds it (a breath along its cone makes a few
  columns, not hundreds). At most `max` 5 × quality columns at once (at least 2: 3 on the phone; the
  newest win).
- **Embers** (`embers`): a few sparks lifting off the first `hot` 0.35 of a column's life (`rate` 1.4 a
  second a column, `life` 1.8 – 3.4 s, carried `carry` 0.7 on the wind, at most `max` 48), in an additive
  batch of their own.
- **Crater dust** (`dust`): after a blow of `min` 1.2 or more, a low haze of pale letters (`per` 90 ×
  min(2, power / 1.2)) over the crater (`r` 1.1 × its radius, 1.2 + 1.1 power, at most the blow's reach),
  densest low (`y` 0.12 – 1.1 m), for `life` 6 – 10 s, drifting off downwind (`carry` 0.32) and spreading
  (`grow` 0.7), each letter coming and going on its own `cycle` 2.2 – 4.5 s; at most `max` 3, merged within
  3 m.
- Never on the hero: its letters fade out within `heroClear` 0.5 – 1.4 m of him. Per level
  (`AFTERMATH_TUNING`): Ashfall grey ash-dust; the Throne a dark red-grey haze; the Ring ochre dust and a
  shorter, leaning smoke (16 – 28 s, 2 – 2.8 m, lean 2.4); the Terrace and the Grove their own dust colours.
- Two own `LetterBatch`es (smoke and dust; the embers additive), made at the first fire or blow, sized for
  quality 1 (the phone preset comes after the world is built: quality limits what is used); no
  allocation per frame, no Math.random (its own LCG). Cost: ~0.13 ms a frame on a desktop with 5 columns
  and 3 hazes (885 letters).
- The sound (ADR-180): a new crater haze is heard as a faint sift of grit (`dustSift`, k 0.4 + 0.4 × its
  strength, at most 1.4, 0.12 s after the blow); the smoke and the embers are silent.

### The lamps — `life.lamps` (`lamps.js`, `lampsTuning.js`; piece `answer`; 2026-11-23, ADR-180)
The levels' stone lanterns and the Skybreak Ring's braziers: a lantern stands dark or burns as the visit
starts, more KINDLE as the fight heats up, a lit one GUTTERS under a blow's shock and burns up again, and
it goes OUT when the piece that holds it breaks, falls or is taken (never relit in that fight).
- **Where a lamp is.** A breakable whose def carries **`lamp: { y, r }`** (the window's centre height and
  half width, m): `courtyard.js` exports `LANTERN_LAMP` `{ y 1.22, r 0.15 }` for its `buildLantern` (the
  Ashfall Courtyard's four corner lanterns; the Foxfire Terrace's ten use it too), `windlessGrove.js` its
  own `{ 1.07, 0.13 }` (the two lanterns on the path), `starfallProps.js` `buildLantern` returns `lamp`
  for a STANDING lantern only (`{ y 1.62 × 1.15 s, r 0.2 s }`; a fallen or thrown one has none) and
  `throneHall.js` copies it onto the outskirts' breakable (so the Obsidian Throne has lanterns only under
  `?outskirts=a | m`; the default `c` has none). And the Ring's braziers: `set.ambience.braziers` (the four
  posts' `{ x, y, z, def, light, piece, gut, gx, gz, lit }`; the ambience draws their flames and lights)
  with **`ambience.gutter(b, k, dx, dz)`** (→ whether it took: a stronger shock than the one settling;
  never called, a brazier burns as before). A new level's lantern needs only the `lamp` field (and a
  block in `LAMPS_TUNING` for its kindling). Found once `world.destructibles.list` exists (looked for
  again every second until then).
- **States** (`LAMP` `{ DARK 0, KINDLE 1, LIT 2, OUT 3 }`); a gutter is a level `gut` (0..1) on a burning
  lamp, not a state. **The start** (and every `clear('reset')`): the `start` lanterns nearest the hero's
  spawn (`CONFIG.world.playerSpawn`) burn, the rest stand dark, every brazier burns. **The fight**: when
  `game.state` becomes 'boss', `fight` more catch, the nearest the boss first (0.6 s before the first).
  **The phases**: `dragon:phase {n}` and `dragon:phase2` … `phase4` (subscribed only while the piece is
  on; a phase counts once) → `phaseUp(n)`: `phase[n]` more (99 = all that still stand), the nearest the
  boss first, one after another `stagger` 0.35 – 1 s apart. **Fire** (`ignite`, from `life.ignite`) within
  `ignite.r` 3 m of its disc lights a dark standing lantern at once, catching in `ignite.kindle` 0.45 s.
  A catch eases in over `kindle.sec` 1.1 s with a stutter (`stutter` 0.55), then burns steady.
- **The gutter** (`impact`, from `life.impact`): p = power × `life.k`; under `gutter.power` 0.25 nothing.
  Reach = min(`max` 16, r × `r` 1 + `k` 3 × p^`pow` 2) m; at d m (from the lamp's window) the strength is
  p × (1 − d / reach)^`fall` 1.2 (× `brazier.k` 0.8 on a brazier); from `min` 0.15 the lamp gutters to
  min(1, s × `k` 0.85) (a weaker shock never lowers a stronger one): its blobs lean away from the blow at
  `lean` 1.4 m/s × gut, rise slower, shrink, cool a little; its light dims by `dim` 0.6 × gut; it settles
  as gut × e^(−t / `tau` 0.25) less `drop` 0.12 a second (a full gutter in ~0.8 s). A brazier's gutter is
  the ambience's (`gutLean` 2.2, `gutDim` 0.55, `gutTau` 0.3: back in ~0.6 s).
- **Out.** A lamp whose piece is no longer INTACT goes OUT (each frame's check): a puff of `out.puff` 4
  fire-field smoke blobs and `flare` 2 last licks of fire where the flame was, its light fading over
  `light.out` 0.35 s (never a pop). It stays out through phases and fire until the reset. A brazier's post
  down: the ambience stops its flame and fades its light over `WEATHER.brazier.out` 0.35 s (this applies
  with the living world off too); the layer puffs it out.
- **The flame** is heat in the fire field (STYLE "The fire field"): `flame.rate` 14 blobs a second (× 0.6
  + 0.4 × quality, so a phone keeps 0.8 of them; × 0.35 + 0.65 × the glow while it catches), `size` 0.42 –
  0.52, `heat` 0.78 – 0.98, `life` 0.28 – 0.4 s, `rise` 0.04 – 0.14 m/s, spread over `spread` 0.55 × the
  window's half width, kind `kind` ('fire' on every level). It is drawn **`toCam` 0.9 m along the view ray
  toward the camera** (the fire field's soft depth test would not print it inside the stone box; moved
  along the ray it prints on the same spot; headless: the game camera's way, 58° down) and follows the
  piece's pivot (a shuddering lantern leans its flame).
- **The light** is a LOW light of the pool (above, `lights`): at most `light.max` lanterns hold one, the
  nearest the camera's focus within `reach` 26 m (a holder keeps its place against one up to 15 % nearer),
  each fading in and out of its share over `fade` 0.5 s; colour (1, 0.52, 0.2) (`colorVoid` for a 'void'
  flame), `intensity` 2 × share × glow × (1 − dim × gut), `radius` 5 m, `flicker` 0.45, `slotFade` 0.3,
  made through `life.build`. The fight's own lights win the slots; the lamps take what is left. The Ring's
  braziers' lights (the ambience's) are low lights too since ADR-180, with the living world off as well.
- **Per level** (`LAMPS_TUNING`, else `DEFAULT`: start 1, fight 1, phases [0, 0, 2, 2, 99], 3 lights):
  `ash` 1 at the gate, 1 at the fight, 1 at phase 2, the rest at phase 3, 4 lights (the courtyard's pool
  holds only the bonfire's); `fox` 2, 2, 3 at phase 2, all ten at phase 3, 3 lights; `grove` none until
  both catch at phase 2 (or when fire reaches them), 2 lights; `starless` none, 1 at the fight, 2, 2, all
  at phase 4, 2 lights (the hall's own six hold the pool); `ring` no lanterns, its braziers burn from the
  start. Cinderwood, the Hall of Falling Script and Halcyon Plaza have no lamp (the Plaza's lamp posts are
  electric neon).
- **API.** `impact(x, z, r, power)`, `ignite(x, z, r, k)` (→ how many caught), `kindle(n, x, z, first =
  0.15)` (n more, the nearest (x, z) first; → how many will), `phaseUp(n)`, `shock(x, z, r = 2.5, power =
  1.4)` (a gutter forced past the power floor; → how many guttered), `gutterAtHero()`, `douse()` (every
  burning lantern dark in a puff; they may be lit again; the braziers untouched), `lit` (how many burn,
  catching or lit, braziers too), `list` (the records `{ kind 'lantern' | 'brazier', state, x, y, z, r,
  glow, gut, gx, gz, w (its light's share), b (the piece), br (the brazier), light }`), `lights` (lamp
  lights shining now), `stat` `{ kindled, guttered, out, ignited, blobs, puffs }` (this page load), `kind`
  (the flame's fire-field kind; the films tried 'void' on the Terrace), `off` (true: nothing, a film's
  "today"). `clear('reset')` the level's start again; any other `clear` or `setVisible(false)` dark at
  once. **The Lab**: **light lamps** (every standing lantern catches, the nearest the hero first, 0.2 s
  in), **gutter at hero** (a 1.4 shock at the hero; with no lamp in reach, the nearest lit one gutters
  anyway), **lamps out** (`douse`).
- **The sounds** (through `lifeSay`, so only with the piece `air` on too): `lampCatch` as a lantern
  catches, `lampGutter { k }` once a blow at the lamp it shook hardest (not within `gutter.sound` 0.5 s of
  that lamp's last), `lampOut` as a burning one goes out (`douse` is silent).
- Off (the piece, or `off`): nothing burns, no light is asked of the pool (a light already made is held at
  0). No allocation per frame; no Math.random (its own LCG; the lights through `life.build`).

### What hangs — `world/hang.js`, `hangTuning.js`
- A builder marks a hanging part while its geometry is still upright in its own frame: `hangFrom(geo, top,
  kind)` (`kind` 'cloth' give 1, 'paper' 2, 'rope' -0.35: a negative give swings as one piece on its line,
  no ripple) writes `geometry.userData.hang` (per vertex: m below the line at height `top`, its give);
  `mergeHang(parts, merged)` after a `mergeGeometries`. The mark rides in `userData`, so a set's static
  merges never see it (an extra attribute would break them).
- `destructibles.js` `_mesh` turns it into the attribute **`aHang`** vec2 for a 'prop' piece (`hangAttr`,
  zeros on the piece's other geometries) BEFORE `refine` cuts it to brick size (the cutting interpolates
  it); the rigid batch copies it (every attribute any source has, zeros for the others); a bite folds or
  sets back a triangle without touching it. The breakables' prop material is built with `hang:
  HANG.shader` when any prop piece hangs (`createPropArtMaterial(U, { hang })`: `HANG_VERT_GLSL` with
  WIND_GLSL, uniforms `uHang` (lean, half, ripple, rate) and `uHang2` (along, down, front, wobble); without
  the option the program is the old one).
- **The shader**: the air there (the prevailing wind and the fronts, `front` 2.4 m/s per strength) leans
  the cloth downwind about its line, by `lean` 0.5 rad × drag² / (drag² + `half`² 2.2²) (drag = air × give;
  breathing ± `wobble` 0.22), the drop swung so it keeps its length, and runs a crosswise ripple (`ripple`
  0.07 m at the free edge) downwind across it, the ripple's slope turning the facets. **The upright gate**:
  only a piece standing at home moves (its bone's up axis within smoothstep(0.985, 0.998) of vertical, its
  base within 0.03 – 0.12 m of the ground); felled, carried or thrown it is still. Wind off: nothing added.
- **Bites on a leaning cloth**: `piece.hang` = `hangOf(geometry)` `{ top, give }`; `_take` moves a blow
  back to the cloth's resting shape by `hangLean` (the shader's lean on the CPU, without the ripple and
  the wobble; null unless INTACT and upright) and moves the bricks it took back out to where they were
  drawn, so they fall from there.
- What hangs today: the Ring's 4 banners in each arena (cloth) and, in `?ring=b`, the derrick's rope and
  block (rope);
  the Foxfire Terrace's charm-post paper strips (paper); the crater's banners within 43 m (cloth:
  starfallProps.js `buildBanner`; those merged into the static stones beyond stay still); the Last
  Foundry's four ladles (rope: each crucible on its chain from a jib crane's arm, swinging on the level's wind;
  cut down or broken it falls and spills, ADR-285). Nothing in
  Ashfall, Cinderwood or the Grove. The moon's shadow of a banner keeps its rigid shape (the depth
  material has no `aHang`).

### The sound of the air — `audio/air.js` (`airTuning.js`)
`new Air(audio)` (audio.js `_build`, beside `ForestAmbience`), `air.update(now, dt, game)` (each frame after
the ambience), `air.mix` (what plays, numbers: `out, wind, bright, gust, leaves, whistle, grit, rain, spell,
drone, voices, oldWind, oldVoices`), `air.built`. With the piece off it makes no node and draws from no
stream, and today's bed plays as before. On: a synthesized bed per level from `airRecipe(levelId)`
(`AIR_TUNE.levels[id]`, else `quiet`): `wind` (brown noise through a lowpass that opens with the gusts:
`life.wind.level` and `wind.at(hero).k`, or `idle` with the wind piece off), `leaves`, `whistle`, `grit`,
`rain` (`weather.wet`), `drone` (the Throne, 34 Hz and a fifth), `spells` (by `weather.name`: the ash's
'squall' a hiss of embers; or a `read` field: the Throne's `weather.breath` swells the drone), `crickets`,
`crow` (Ash), `thunder` (the Ring: far thunder 1.5 – 5 s after a `weather.bolt` over 0.35). It takes over
today's bed through **`ForestAmbience.windDuck` / `voiceDuck`** (two unity gains the old wind and the
voices now pass through: the owl and the crickets on `voiceDuck`; the bonfire on neither; at 1, always
with the piece off, the bed is exactly as before): the recipe's `old { wind, voices }` is where they settle
(Cinderwood keeps its crickets and owl, voices 1). `life.hush` takes the voices away (and `hushWind` of the
wind); the whole bed thins by (1 - calm) × 0.5; the tense states silence its voices. Cross-fades on
switching (`fadeIn` 1.2, `fadeOut` 0.8 s); nodes dropped once silent. Its own LCG. `ambience.js` exports
`follow`.

### The living world's sounds — `audio/lifeSfx.js` (`lifeSfxTuning.js`; 2026-11-23, ADR-180)
One-shot sounds for the new life: a flock's wings, an animal bolting, a tree's shudder and creak, dust
and pebbles, leaves skittering, a lantern catching, guttering, dying. Synthesized only (the owner turned
recorded ambience down as noisy), short, quiet, under the fight; heard only with the piece **`air`** on
(`life.sound`), whichever piece makes the event.
- **`LIFE_SFX`** (the recipes; the format of sfx.js: `{ prio, rev, gap, falloff, gain, play(v, t, o, E) }`,
  every number in `LIFE_SFX_TUNE.sound`); `audio.play(name, o)` looks a name up in `SFX`, then `FIRE_SFX`,
  `THUMP_SFX`, then `LIFE_SFX` (then the aliases). `LIFE_SOUNDS` lists the names:
  | name | `o` | what |
  |---|---|---|
  | `flockBurst` | `n` (birds, 4 – 48), `kind` 'small' / 'crow' / 'pigeon' | a roost leaving: soft wing claps over ~1.2 s (more birds, more claps, each one quieter as n^-0.25), a low swell and a rising wash of air |
  | `animalBolt` | `kind` 'rabbit' / 'deer' / 'rat' / 'lizard' / 'fox' | a rabbit's hops in the grass, a deer's few bounds of hooves, a rat's scratch-skitter, a lizard's ticks on stone, the fox's one soft rustle |
  | `treeShudder` | `k` 0..2, `kind` 'leaf' / 'dead' / 'cane' | leaves fluttering and settling (dead: dry twigs; cane: the bamboo's faint shiver), a dull knock of the trunk |
  | `treeCreak` | `k` 0.5 – 1.5 | a tree leaning to its fall: a slow wooden groan (stick-slip pulses through two wood formants) and a crackle of fibres |
  | `dustSift` | `k` | a faint fine patter of grains, thinning |
  | `pebbles` | `k`, `mat` 'stone' / 'glass' / 'sand' / 'earth' | a few small clicks scattering, each with a smaller bounce; stone and glass (obsidian) ring faintly |
  | `leafSkitter` | `k` | a few dry ticks and a brush |
  | `lampCatch` / `lampGutter` / `lampOut` | `k` 0..1 | a soft whump and a crackle; the flame fluttering; a short dying hiss and a click of cooling stone |
  Every call varies (pitch, timing, band, count) from this module's OWN stream (an LCG; the noise offsets
  too): never Math.random and never the audio's shared `dsp.arand` (the fight's sounds keep their
  sequence). Every sound ends within 2.5 s. `o.delay` (s) starts it later (audio.play), `o.x / o.z` place it.
- **`lifeSay(life, name, x, z, o, i = 0)`** — how a layer asks (never `life.sound` directly): nothing for
  an unknown name or a level that never hears it (`lifeHeard(levelId, name)`: 0 when the level's block
  has it in `off`, else its `gain[name]` or 1); the callers' rate limit `LIFE_SFX_TUNE.say[name]` (`gap` s
  between two of that name on one living world, on `life.t`; `i` > 0, the i-th of one burst, passes only
  in the same `life.t` as the first one that played, and only while i < `most`); the level's kind when `o`
  gives none (`flockBurst.kind` ← `birds`, `treeShudder.kind` ← `tree`, `pebbles.mat` ← `ground`); gain =
  `o.gain` × heard × (1 − `fight` 0.3 × clamp((1 − calm) / 0.6, 0, 1)), so ×0.7 at the fight's full calm;
  then `life.sound(name, x, z, rec)`. → whether it played (only a played first one stamps the time). `o` is
  read, never kept (one reused record). The engine adds its own `gap` per name on top (`audio.play`).
- **Who says what** (each a reused options record, no allocation):
  | caller | sound |
  |---|---|
  | `flock.js` (a roost flushed) | ONE `flockBurst { n }` at the roost; a flock flying in is silent |
  | `animals.js` (an animal starts to run) | `animalBolt { kind }` (its kind) |
  | `tremor.js` `_say` (after a shake) | `treeShudder { k, kind }` at the strongest tree shaken (k ≥ `tremor.shudderMin` 0.2; kind 'cane' for bamboo, 'leaf' for a leafy tree that is not a deadTree, else 'dead'); a second one at the next strongest only when `secondAt` 3 or more shook, `second` 0.05 – 0.14 s later, `k2` 0.7 as strong (i = 1): never one per tree. `treeCreak { k ≤ 1.5 }` at a shaken tree that already leans (it topples and its wear is at stage 3). `dustSift { k ≤ 1.6 }` 0.05 s on at the strongest stone that sifted |
  | `tremor.js` `_floor` (pebbles hopped) | `pebbles { k = min(2, power) }` |
  | `tremor.js` `_world` (`world:impact` kind 'wear', mat 'wood', power ≥ 3: the lean; not on a piece with `topples: false`; listened to while the piece `answer` is on) | `treeCreak { k: creakK 1 }` |
  | `aftermath.js` (a new crater haze) | `dustSift` (the tremor's dust in the same blow is the same name: the rate limit keeps one) |
  | `litter.js` `scatter` (a blow throws what lies) | `leafSkitter { k ≤ 1.5 }`, once, when at least `skitterMin` 6 were thrown |
  | `lamps.js` | `lampCatch`, `lampGutter { k }`, `lampOut` (see "The lamps") |
- **Rate limits.** `say` (`gap` s / `most` a burst): flockBurst 1 / 1, animalBolt 0.15 / 1, treeShudder
  0.3 / 2, treeCreak 0.8 / 1, dustSift 0.5 / 1, pebbles 0.25 / 1, leafSkitter 0.6 / 1, lampCatch 0.15 / 2,
  lampGutter 0.25 / 2, lampOut 0.2 / 2. The engine's own `gap`: 0.6, 0.12, 0, 0.5, 0.35, 0.2, 0.5, 0.15,
  0.25, 0.2 in the same order.
- **Per level** (`LIFE_SFX_TUNE.levels`, `lifeSfxLevel(id)`; birds / ground / tree; what is never heard):
  Cinderwood small / earth / leaf; Ashfall crow / stone / dead, no leafSkitter; the Obsidian Throne glass /
  dead, no flock, animal, shudder or skitter (only creaks, dust, pebbles and the lamps); the Skybreak Ring
  sand / dead, no flock or skitter; the Foxfire Terrace small / stone / dead; the Windless Grove the canes'
  shudder and the lanterns only (their three × 0.6); Halcyon Plaza pigeon / stone / dead; the Hall of
  Falling Script stone / dead, no flock, animal or skitter. A level without a block: everything, small /
  stone / leaf.
- **Loudness** (the taste, `lifeSfxTuning.js` header): the gains are peaks before the voice's and the bus's;
  nothing may be louder than the hero's footstep at the same distance, except a flock's burst and a
  tree's creak, which may reach it. Judged on the audition page beside the footstep and the light swing;
  the suite checks the ranges, not the loudness.
- **The `wear` creak gives way** (sfx.js `wear`, `world:impact` 'wear'): its stage-3 creak of wood plays
  unless `life.on('air')` and `life.on('answer')` are both true (the tremor, piece `answer`, makes the
  new one; with only one of them on, the old creak stays, so a lean is never silent); with both on the tremor's `treeCreak` plays it (its
  leaf hiss and the snap of stage 2 as before). One creak for one lean.

### The arrival — `game/arrival.js` (`arrivalTuning.js`)
`flow.arrival` (`new Arrival(game, flow)`): `begin()` (flow `_startGame`, after its camera lines: the
title was dismissed; once per page load, `used`; nothing with the piece off), `update(dt)` (flow, real dt,
after `_updateCinematic`; true while it holds), `cancel()` (first thing in `_enterBossIntro`,
`_resetWorld`, `_debugPrelude`: let go at once), `replay()` (the Lab's 'arrival (replay)', explore only),
`active`, `phase` ('idle' | 'hold' | 'release'), `ended` ('time' | 'input' | 'cancel'), `t`. It drives the
flow's own eased override (`_ov.focus`, `_ovW`, `_ovZ`, `_ovLambda`): the focus eases from where the camera
looks (the title's framing) to `look`, drifts to `end` over the `hold`, then the weight and zoom go to 0
at `outLambda` (or `skipLambda` on a skip), never a snap. A pause holds it; any other state lets go. **The
skip** is a CHANGE from the input at `begin()`: the move stick past 0.2 and 0.2 away from where it rested
then (a drifting pad or a stick already held does not end it), or a press of attack, heavy, block, dodge,
flask, lockOn, interact. `front` (`delay` s in): a QUIET `wind.front` across the shot (moves the air, does
not alarm the birds; nothing in the grove). Numbers: Cinderwood looks at (0.8, 11.8) → (0.7, 14.8), zoom
+26 m, hold 3 s; the others alike north of their spawn; the Grove +17 m, 3.4 s, no front; the phone (`cameraRig.mobile`)
zoom 3, weight 1.

### Tests — the cost budget, and `npm run perf` (ADR-206)

`tests/integration/cost.mjs` builds every level's set (`LEVELS[i].buildSet`, wired like `world.js`: colliders,
`Destructibles`, so the rigid batch exists) and counts what the renderer would draw, never a time: visible meshes,
main-pass triangles (`rigidShadow` excluded; an instanced mesh by its instances), shadow-caster triangles (meshes on
`LAYER_CASTER` / `LAYER_CASTER_RIGID`), rigid bones, breakables, colliders and geometry MB, for the level whole and
for `setQuality(0)` (`<id>@phone`). `tests/cost-baseline.json` is the budget: a metric over it by 3 % + its slack
fails; `node tests/integration/cost.mjs . update` rewrites the file (the budget moves on purpose, said in the PR).
A level with no row fails (a new level adds one). The hero, the boss and the effects are not in these counts.
`scripts/perf.mjs` + `scripts/perf-probe.js` (`npm run perf`) measure the rest on a PC with a GPU: the probe stages a
fixed fight in the page (`__game`, `__tick`) and returns draw calls / triangles by pass, GPU ms by pass and frame
(`EXT_disjoint_timer_query_webgl2`) per size, and script ms by module; `.perf/baseline.json` (git-ignored) is the
machine's own.

### Tests — the `life` suite (`tests/integration/life.mjs` + `tests/integration/life/<piece>.mjs`)
`node tests/integration/life.mjs . <scenario>` (`all`, a file name, or `<file>.<name>`; in `npm test` as
`life`). The REAL LivingWorld and Atmosphere on every level's REAL set, with the real particle pools,
fire field, scorch map and grass density, wired as world.js does; the hero a stand-in. **`T.build(levelId,
spec, o)`** → `{ game, world, life, set, U, level, step(sec, dt), walk(vx, vz), place(x, z), counts(), emit, own
}` (`o` `{ k, quality, state, feet, seed }`: `feet` brings the stand-in's feet down through `steps.footfall` every
0.32 s while he walks); `step` runs the frame as World.update and main.js do (the living world's own pools
are left to their owners); `counts()` → live particles per shared pool, the own pools', spawns
(`spawned`: everyone's; `lifeSpawned`: those made inside `life.update` / `life.gust` / the feet), and
`random` (Math.random calls made inside `life.update` / `life.gust` / the feet: Math.random is counted for
the whole run). Math.random is SEEDED: every `build` restarts it from the level's seed (`o.seed` overrides),
so a set's ambience (the fireflies, embers, ash: they draw from Math.random) is the same on every run and
in two builds of one level; unseeded, the fireflies alone moved the shared pools' spawns by ~1000 in 73 000
run to run (the `phone` check failed about one run in a hundred). One file per piece (`FILES`: core, wind, weather, litter, steps, creatures, answer, air,
arrival, hang, and since ADR-177 tremor, aftermath, since ADR-180 lamps; a missing or broken file fails the suite); after each scenario the switch goes back to off.
The suite's world mock forwards `impact`, `groundBlow` and `ignite` to `life.impact` / `life.ignite` as
world.js does (`world.impacts` counts them).
**`core`** enforces the contract on every level: `off` (no own pool, takes nothing, still air, clear
weather, nothing lying), `all` (every piece on for a minute with the hero running: no throw, no
Math.random, Math.random handed back after the pools are built, inside the budget of +700 fx.alpha, +500
fx.add, +400 fire, 1400 own letters; calm 1 then 0.4 in the fight; the hush holds and lets go), `alone`
(each piece alone: no throw, no Math.random; litter without wind falls straight down; what a layer takes
the atmosphere no longer draws), `phone` (quality 0.5 draws no more than 1: the creatures' letters and
the living world's own pools' letters, each summed over 45 samples; its spawns into the shared pools; all
spawns, the set's ambience with them; no tolerance, the numbers are seeded), `switches` (all off mid-run:
nothing left). The pieces' own budgets: the wind's wisps in their own batch only, at most `max` × quality ×
`per[1]` letters (960 at quality 1), at most +25 fx.alpha over life off and fx.add untouched, one own pool,
fewer wisps born at quality 0.5 (`wind.budget`; `wind.wisps`: a few in the breeze, more in a front, every
letter within its clump, none on the hero, none in the grove, none off); the weather +250 alpha, +190 add,
+150 fire, 1600 own in every spell (`weather.budget`; `weather.bank`: a bank densest at its heart and
rolling; `weather.groveStill`: the grove's banks do not drift); the litter 500 at quality 1, 250 at 0.5; the steps 60 fx.alpha and 120 prints in a 30 s sprint;
the creatures 60 alpha and 120 add a frame × quality.
Since ADR-177: **`core.fonts`** (every letter the air and the fauna print, `FAUNA_TUNE.letters` and a
fixed list, is in all three of the wyrm's fonts: a letter a font lacks prints BLANK; `wyrmGlyphs.js`
gained `^ o` in every font and `c x s` in the 5 x 7 one, where a flock printed blank); `creatures.flockFire`,
`flockTree`, `animals`, `keepOut`, `returns`, `fauna`, `lab` (the flocks and animals: what sends them,
the limits, the way through the camera's top band, nothing on the fighting ground, the return after the
fight, the letters' budget, the Lab buttons); `answer.world` (`world:impact` topple / crash / burn and a
wood break reach `creatures.fell`); `tremor.tree`,
`light`, `merge`, `banner`, `dust`, `floor`, `grove`, `clear`; `aftermath.smoke`, `budget`, `dust`,
`grove`, `clear`.
Since ADR-180: **`lamps`** (the breakables built on the toolbox's world as world.js builds them): `find`
(every level's lamps: Ashfall's four lanterns, the Terrace's ten, the Grove's two, Cinderwood none, the
Ring's four braziers; a flame in its window; as many burn at the start as the tuning says), `phases` (the
fight's start and each phase light their counts, the nearest the boss first, one after another),
`ignite` (fire 1.9 m off a dark lantern lights it at once, steady in 0.45 s; the other does not catch),
`gutter` (a light cut 13 m off: nothing; a heavy blow 2 m off: it gutters, its light dims, it leans away,
and is back within a second), `out` (struck down: out in a puff, its light fading, never a pop; phases
and fire leave it out; the reset lights the start's again), `budget` (all ten on the Terrace burn, at most
`light.max` lamp lights at once, also walking the rim; eight of the fight's own lights take the slots
back, each low light fading out over 0.3 s; they return when those go), `brazier` (a Ring brazier gutters
and burns up again; its post down: out, its light fading), `off` (the piece off: nothing burns, no low
light in the pool; on: zero Math.random inside the living world, the flames are fire-field heat). **`air`**'s
sound scenarios (the REAL AudioEngine on the shim's strict WebAudio mock): `sounds` (every `LIFE_SFX`
recipe plays with every gain it sets finite and in [0, 1], no Math.random, each ends within 2.5 s, ten
calls of one sound are ten different sounds; the lamps' three exist), `shudders` (a blow that shakes
three or more trees plays one or two shudders, one patter of pebbles and one sift of dust at most; ten
blows in a second at most eight; the Grove's are the canes'), `creatures` (a flock that flees is ONE
burst of its level's kind and size, Cinderwood small birds, Ashfall crows; fire and a blow at one roost
together one burst; bolting animals one sound each at most, a rabbit's or a deer's), `creak` (a lean,
`world:impact` 'wear' 3 on wood, creaks once; a stage 2 and a second lean within 0.8 s none), `quiet`
(the `air` piece off: a flock and a heavy shake play nothing; under a hush past 0.6 nothing; once the
breath is let go the next flock is heard).

### Tests — floor marks, the blade and the mow (ADR-177, ADR-180)
- World test **`marks`** (`node tests/integration/world.mjs . marks`, on the courtyard): each of the seven
  kinds lands where its blow did (its glyphs centred within 0.5 m); `world.impact` lays a blunt blow's
  slam and a blast's blast, not today's crack; the same blow twice at once is drawn once and a hundred on
  one spot are thinned; the hero's slam is smaller than the boss's; NO draw from Math.random; groundBlow
  damages nothing; a hot blast chars the paving and lights nothing; the cap holds and the oldest fade
  (never a pop) and go; the reset clears them; `?marks=0` gives today's cracks only.
- World test **`mow`** (ADR-180; `node tests/integration/world.mjs . mow`, on the forest with a meadow to
  the west and paving to the east; run LAST of `all`: its marks draw on the scars' cosmetic stream):
  `mowSwing` with a stand-in SwordSweep. A low sweep mows its arc to `GRASS.mow.maxK` (mown, never torn
  out) and nothing behind him or past the steel; the cut tops fly (1 .. `bits.max`); a waist-high swing
  only skims (torn 0 – 0.5); the same sweep on paving tears nothing; a blade at rest (a hitstop) mows
  nothing; every kind of mark tears its shape (≥ 0.6 along it, 0 beside it) and its glyphs lie on the
  stubble; a slam on paving tears nothing; tearing draws nothing from Math.random and changes no burn on
  the meadow, no heat, no trample; `?mow=0` (the sweep, a slam and `tear()`) tears nothing;
  `scorch.reset()` clears A.
- **`tests/integration/marks.mjs`** (a helper, not a suite of `run.mjs`): `attachMarks(game)` wires a REAL
  `Scars` (built on its own Math.random stream) into a fight sim's mock world as world.js wires
  `groundBlow` and world.impact's mark; `marksLine(sc)`, `marksCheck(sc, tag, out, assert)`. The WIN
  scenarios of `integ`, `duel`, `lord`, `asc`, `fox`, `city`, `sheath`, `woke` check that a whole bot
  fight leaves its range of marks (duel 5 – 60, lord 10 – 90, asc 5 – 60, fox 3 – 400, city 12 – 150,
  integ 50 – 400, sheath 4 – 40, woke 5 – 60) with the glyphs under the cap, and the seeded fights replay
  exactly as without them.
- Integration scenario **`bladestop`** (alias `cut`; `integ.mjs`): by default the blade goes clean
  through (the attack clock frame for frame as in open air, no bounce, no freeze, the piece bitten, its
  debris along the cut over twice what flies back, one jolt within `BREAK.chip.pass.jolt`; a cut through
  a tree lands on a boss behind it in the same swing); `?cutStop=1` stops and bounces as before;
  `?chip=0` bites off.

### Halcyon Plaza: explosions, raised pieces, the city's light (2026-11-22, ADR-159)
- **A raised piece is struck at its real height.** `destructibles.js` skipped a piece when a blow passed
  over it with `o.y - r > h`: a piece standing on another (`y0` > 0: a tower's top, a shop sign hung on a
  front, the Skybreak Ring's butte tops) was missed by a blow at its own height. The bound is now
  `y0 + h`, and the hit point is clamped into `y0 .. y0 + h`. The world test `bite` strikes a raised piece
  inside its own height. A blow below it (`y + r < y0`) passes under it, in `strike`, `sweep` and `stop`
  (the PR's review: the first build had no lower bound, and a blow down on the street bit a shop sign or the
  statue's arm metres above it); a blow on a base still reaches its top through `holds` (`_hit`), and a
  broken base still brings its top down (world test `city`).
- **Explosions are the set's, polled.** The destruction system has no on-break callback and nothing in it
  explodes. `world/halcyonPlaza.js` (its `ambience`, which atmosphere.js runs every frame) watches each car:
  broken, it burns for `CITY.car.fuse` s (told and cued as a falling piece is, `combat:tell` /
  `combat:flash` source world, attack carBomb; the boss's `brain.worldClash` may quiet it), then
  `world.impact(x, z, 3.2, 1.6, { kind: 'blast', fire: true, by })`, fire, debris, a shake and
  `world:blast`. The hero inside 2.6 m takes 16 (blockable; a roll clears it); the boss inside 3 m takes 90
  and 24 posture (`boss.onBlast`) when the hero broke the car. At most two bangs in 0.5 s (the rest wait).
  The set also exposes `boom(x, z, by)` (a thrown car landing) and `setPhase(n)` (below).
- **The city's light is heat.** Neon tubes and screen faces are `steel` blobs re-drawn every frame (one
  frame's life), a budget scaled by `destructibles.q` (at most `CITY.neon.cap` on LOW); a screen is a pale
  rectangle with his head and shoulders left dark. `setPhase(1 | 2 | 3)`: neon and his face; static then
  crimson (`void`, which his fx re-palettes); dead. A piece's neon goes out when the piece breaks.

### The Veiled Crossing: two scenes, throwables, the light (2026-11-26, ADR-241)
`world/veiledCrossing.js` (its head is the set's contract): `CROSSING { r 20, bound 28, dragonBound 17, bonfire,
wait, entryZ 17, road, clear, half, cell, outer, outerCell }` (levels/veil.js copies it into `CONFIG.world`),
`createVeiledCrossing(U, colliders)` → createForest's shape + `breakables`, `sky`, `ambience`, `grass`, `scarInk`,
`floorCarry`, and:
- **`set.scenes`** on the Hall's contract ("Scenes: a set that morphs"): ids `['crossing', 'void']`, `to(id, { x,
  z, speed })` runs a front out at 18 m/s (1.8 s at most): each piece it crosses lets go as dim digits, the other
  scene's pieces print in, the light eases with it; `world:scene` as a morph starts. A piece with `scene:
  'crossing'` stands only in the city, `scene: 'void'` only in the void (the floating pieces, `y0` > 0, `def.float`:
  they bob), none in both (the floor). Back to the crossing the city returns AS IT WAS LEFT: whole or chipped
  pieces whole, a stump as its stump (quietly), felled / thrown / taken / gone stay gone; the floor's cracks stay.
  Its marks are the scene's: `scars.shade` hides the city's as the front to the void passes and shows them on the
  way back; `scars.layer` tags what is fought in the void.
- **`set.setPhase(1 | 2 | 3)`**: cold and dim; his eyes' blue in the air; the void's light (near-black, fog 5 - 14
  m round the focus; inside the void its light wins). `set.air`: the void's stars (`{ count, budget, on }`), a
  `LetterBatch` drawn by the ambience while the void stands.
- **Throwables, found by kind** (`THROWABLE`; `destructibles.nearest(x, z, { kind })`, never by place): `car`
  (lift 1, 8), `slab` (lift 1, 6 loose road slabs round the middle), `towerTop` (lift 2, raised `y0` 6, held by a
  `towerBase`, 4); in the void `floatSlab` x5, `floatCar` x2, `floatCorner` x1. Breakable, not thrown: six
  `fallenTower` sections (5.3 m wide: a 5 m line bores one), `bridgeDeck` (`y0` 3.4), ruins, piers, the span, the
  gantry, the bus, the tank, heaps, signals, lamps (`lamp`, steel). The wrecks have no collider (`broken.r: 0`):
  a thrown hero goes over them. No piece that stops a blade within 5.5 m of the middle.
- **The bonfire** (ADR-243): `world.atmosphere.bonfireLit` (true by default on every level) and
  `setBonfireLit(lit)`: the Crossing's scenes put it out as the front into the void passes it and light it as
  the front back passes it; a reset relights it. The flame, the embers and the light (atmosphere.js), its sound
  (`audio/ambience.js`) and the creatures (`life/creatures.js`) read the flag.
- **Budget**: 299 breakables, 67 rigid pieces, 268 bones, 129k triangles; the void's letters ~1300. Its blocks in
  every `world/life/*Tuning.js`, `airTuning.js`, `lifeSfxTuning.js`, `arrivalTuning.js`; `SCAR.thin.veil`.

### The Last Foundry: the pour, the ladles, the tanks, the light (2026-11-28, ADR-285)
`world/lastFoundry.js` (its head is the set's contract; the builders are `world/foundryProps.js`): `FOUNDRY { half
15, cell 1.5, entryZ 15.4, bonfire (0, 33), floor { r 13.8 }, wait { 0, -11, yaw π }, bound 40, ladles (four { x, z,
h 3, top 6.3 } at (±12.5, -6.5) and (±12.5, 5.5)), pour { x0 -12, x1 12, z0 -21, z1 -17 }, press (20.5, -9), line
{ x -19.5, z0 -12, z1 10 }, tanks (five), columns (six), furnace { 0, -30, r 5 }, jibPostX 17, staticR 30 }`
(levels/foundry.js copies it into `CONFIG.world`), `FOUNDRY_TUNING` (every piece's hp, the pools, the tanks, the pour,
the steam, the sparks), `createLastFoundry(U, colliders)` → createForest's shape + `breakables`, `ambience`,
`setPhase(n)`, `boom`, and `foundry`:
- **The hazard surface**, `game.world.forest.foundry` (world.js keeps the set as `world.forest`): `ladles` (the four:
  `{ x, z, h, def, piece, full, jib, post, skip, pourT, pourAcc }`; `full` false once it has spilled), `ladleNear(x,
  z, r = 4)` (the nearest FULL ladle), `drop(ladle, why)` (its chain cut: a blunt blow of power 2 at its height, a pool
  under it at once (r 2.6, life 16 s), a 0.9 s stream of steel; false when it was not full; `why` 'hero' / 'player' =
  the player's), `molten.add(x, z, { r, life, why })` → `{ alive, x, z, r, t, life, why, id, acc }` (a fixed pool of 8,
  the oldest reused), `molten.pools`, `molten.at(x, z)`, `tanks` (read only: `{ def, state 'idle' | 'fuse' | 'done', t,
  by }`), `boom(x, z, by)` (a tank's blast now: a thrown tank landing), `reset()` (every ladle full and hung, no pool,
  the fuses out, the light back to phase 1; the boss's reset calls it), `update(dt, game)`. A ladle whose piece breaks
  by ANY blow spills by itself, and one whose jib comes down drops (the set's update sees both). The SET draws the
  pools and the ladles, sets the world alight round a pool and leaves a hot 'blast' floor mark; the BOSS's terrain
  handler deals a pool's damage (COMBAT.md → "The False Saint").
- **Two-stage pieces** (`holds`): a jib post holds its jib, the jib carries the ladle on a 'rope' chain (`hangFrom`);
  each column holds a run of the crane runway (`gantry`); the press's base holds its head (`pressHead`). A felled
  holder brings down what it holds.
- **The tanks**: five, hp 0.9, at the floor's corners ((±11.8, -11.8), (±11.8, 11.6)) and one by the press (18.4,
  -14.8). Broken, a tank burns `FOUNDRY_TUNING.tank.fuse` 0.9 s, cued as Halcyon's cars are (`combat:tell` /
  `combat:flash`, source world, attack `tankBurst`, hazard; `brain.worldClash` may quiet it), then bursts:
  `world.impact` r 3.2 at power 1.6 (blast, fire), `world:blast`; the hero within 2.6 m takes 16 (blockable; a roll
  clears it), knockback 4; a tank the HERO broke calls `boss.onBlast(90, 24, x, z)` within 3.6 m. At most two bursts in
  0.5 s. His shocks spare them (terrain.js `SPARED`); his barrage, his beams and the hero's blade burst them.
- **Throwables** (`lift: 1`, found by kind: `destructibles.nearest(x, z, { kind, lift: 1 })`): eight `frame`s (six on
  the line's conveyors, two fallen at the floor's west edge), four `girder`s, four `ingots` stacks and the five
  `tank`s (a thrown tank calls `boom` where it lands).
- **The pieces** (492 breakables): 400 floor plates (`world/floor.js`, a few gratings) and the path's plates south to
  the bonfire; 4 jib posts, jibs and ladles; 6 columns and their runway runs; the press and its head; 6 conveyors and
  8 frames; 5 tanks; 4 ingot stacks, 4 girders, 4 slag heaps; 4 pipe racks; 4 catwalk runs over the pour's north
  kerb; the blast furnace (`hp: Infinity`: it chips); 12 wall sections at x ±25. The pour's kerb and crust are not
  listed (colliders: nobody walks in the channel); past `staticR` 30 m the wreck field (machine husks, a tracked hulk,
  mounds) is a static mesh.
- **The light** (`ambience`; the Skybreak Ring's precedent), by the boss's phase (eased; `setPhase(n)` drives it
  without a boss): 1 a quiet furnace glow; 2 colder, warning lamps blinking on the jib posts; 3 red alarm light and a
  red beacon turning round the hall; 4 the furnace roaring, `sparks` 34 a second round the fight, far flashes in the
  sky every 2.4 - 5.5 s. `ambience.flare(k)`, `ambience.dim(k)` (his cannons' charge), `ambience.state { w, flash,
  dim, phase, heat, steam }`. The moon always from the south-west (from the north the furnace's shadow blacked the
  floor). Its own LCG streams, never Math.random.
- **The steam and the heat**: the pipe racks' vents, the furnace's smoke and the pour's fumes are a `LetterBatch` (at
  most 700 tiny faint letters on the level's wind); the pour's surface and the pools are one-frame heat blobs in the
  fire field (a budget scaled by quality; `molten.cap` 120 a pool). The set swaps the FIRE slot to the **`foundry`
  palette** at its ambience's first update (`render/firePalettes.js`: the cues' red rim kept, an orange body, a heavy
  yellow-white heart; molten metal lies and churns). `SCAR.thin.foundry { grit 0.5, rubble 0.45, ground 0.6, cool:
  false }`: the grit and rubble thinned on the dark plates, the metal rubble left glowing (a steel mill: hot scrap is
  the place).
- **Budget** (`tests/cost-baseline.json` `foundry`): 5 meshes, 109,518 triangles, 296 bones, 492 breakables, 123
  colliders, 40.33 MB of geometry (the Skybreak Ring 64k / 218 bones / 46 colliders; the Crossing 129k / 268 / 101).
  Idle, about 140 - 160 heat blobs a frame (+120 a pool) and 80 - 260 steam letters (the world agent's measure). Its
  blocks in every `world/life/*Tuning.js` (nothing alive; soot and mill scale; the furnace's draw from the south),
  `airTuning.js` (a 38 Hz drone and its fifth), `lifeSfxTuning.js`, `arrivalTuning.js` (the shot opens on the pour and
  the kneeling man), `trackList.js` (the Obsidian Throne's score until the owner picks one).

## The dragon print (2026-11-25, ADR-198): the ground, floors, grass, props and trees printed in the wyrm's digits

The default in every level (`?dragon=0`: the game before it). STYLE.md "The dragon print" has the look; this is
the code. Every piece reads its switch through `dragonLook(name)` (`render/dragonPrint.js`): `lookOf(name)`
with default `'a'`, `'0'` under `?dragon=0`; switches: `ground` (world/ground.js: `b` the dragon ground, `0`
today's; `a` / `c` / `d` the first round's other looks), `dgGrass`, `dpFloor`, `dpProps`, `dpTrees`,
`dpCloud`, `dpContact`, `dpRipple`, `dpRidge`, `prints`.

- **The core — `render/dragonPrint.js`.** `DRAGON_PRINT_GLSL` (needs COMMON_GLSL): `dpLattice(xz, size, f, g)`
  (the cell of a world point, x right / -z up on screen; `f` the uv in the cell, pass `dFdx(g)` / `dFdy(g)` to
  `glyphGrad`), `dpCellCenter(cell, size)`, `dpVnoise` / `dpFbm`, `dpGlyph(tone, hash)` (the ramp `DP_RAMP`
  `.:-=17402#%8@`). `DP_CELL` = [0.135, 0.25] m. `dragonPrintUniforms()` per material. A cell is lit ONCE, at
  its centre.
- **The ground — `world/ground.js` look b (`GROUND_LOOK == 2`).** Drawn LAST of the solid things
  (`renderOrder` `GROUND_ORDER` 100, a strict depth test; ADR-199): the floors, trees and fighters that
  cover it are drawn first, so the depth test drops its pixels there unshaded. An opaque thing that writes
  no depth and must show over the ground would need a higher `renderOrder`; there is none today (every
  solid material writes depth). **The baked relief** (`bakeRelief`, `DP_BAKE` 1; ADR-199): the relief is
  fixed in the world and a cell is lit once, at its centre, so world.js has the GPU work it out once per
  cell at load, with the shader's own noise, into two float textures the ground reads with `texelFetch`
  (`uReliefN`: the two parts' steps to +x and +z, for the normal; `uReliefR`: the four neighbours less
  the cell, for the ridge; `uReliefBox`: the first cell and the cell counts, 1779 x 961; 27 MB each as
  32-bit floats, half floats where the renderer can only draw into those). `groundRelief(p, d)` = `reliefA`
  + `reliefB` x (0.3 + d): the meadow's share `d` stays live. `?bake=0`, a renderer with no float targets
  and the headless tests keep the shader working it out per pixel (`DP_BAKE` 0: the same picture). A change
  to the relief's GLSL (`RELIEF_GLSL`) changes both at once; a new use of the relief at another offset
  needs its own baked value. The floors' relief is NOT baked: a floor cell is lit on its facet, whose
  height varies from slab to slab, so its sample point is not a function of the cell alone. Per cell: the
  meadow's density
  (`setMeadow`: the grass's density baked into a texture by world.js), the relief `groundRelief(p, d)` and
  its normal, then in this order: `[grass]` `dgGrass(...)` (world/dragonGrass.js), `[fx]` `dpCloud` on the
  moon's term, the tone, `dpContact`, `dpRipple` (another digit, brighter), `dpRidge` (a stroke on a lit
  crest, from the broad relief), burn → ash letters, `[prints]` `dpStep` (a footprint's code letters). A new
  hook goes at its own marked site.
- **The grass — `world/dragonGrass.js`.** `dgGrassOpt()` (`0 | a | a2 | b | c`), `dgGrassLook()` (`'a'`
  printed in the ground, no 3D blades; `'b'` the 3D blades stay, printed as digits: `DG_PRINT` in grass.js),
  `DG` (its numbers), `DG_GRASS_GLSL` (the option baked in). The hero's wake is ONE GLSL chunk,
  `TRAIL_BEND_GLSL` (world/grassTrail.js; `GrassTrail.bendAt` its CPU copy), used by grass.js and the tufts.
  With a printed option the sword's arc (`mowFx.cutArc`) also mows the scorch map's A along its clipped
  stroke (the tufts read A), and no cut tops fly (the green chips do).
- **The cut in the print (`dgCut`, default `b`):** `mowFx.cutArc` stamps the arc's exact strip into a fine cut
  map (`uDgCut`, 1024² over the scorch map's extent, ~0.16 m; re-uploaded on the frames it changes); the
  ground (and `world/dragonTufts.js`, the standing tufts of `a3d3`) reads it on the same frame: shorn tufts,
  chips of their glyphs, the swath; `b` adds the line's glow (the map stores each texel's frame). Its uniforms
  ride in `DP_FX_U` (`DG_U`). A reset empties it.
- **Fallen leaves — `render/dragonLeaf.js` `LeafPrint`** (`leafLook`, default `a`), built by `life.litter`: one
  instanced draw, a small quad per lying leaf at y 0.11 m whose fragment casts the camera ray to y = 0 (any
  dragon-printed floor under it; b finds the ground's own cell there), transparent queue, no depth write,
  never the scene's alpha flag, hidden with nothing to draw. Its numbers come from each piece's existing draws
  (the litter's own stream): the look never moves the world.
- **The floors — `render/dragonFloor.js`**, inside `createCarvedGlyphMaterial` (`DP_FLOOR` define; `0` the carved
  glyphs of before, shader for shader). The lattice is the ground's seen along the camera (z - y cot(pitch)).
  `aRim` (per vertex: the distance to the edge of a slab's top; `addSlabRim(geo, crack)`, `addSlabRims(group,
  mat)` at a set's build; `lazySlabRim` on the first draw for Cinderwood's flagstones) prints the lit lip;
  `CRACK_RIM` marks a cracked piece's edges as seams. A set passes its palette in `dp: { k, sat, top, sky, wet,
  rimW }`. Calls the four fx hooks and `dpStep`.
- **Props and trees — `render/dragonProps.js`** + the art pass's prop branch (`render/pipeline.js`
  `propKind` / `dpSample`). A dragon-printed source writes its relief's tone into alpha inside the props'
  window (`DP_TONE`: props 0.556 + t x 0.0105, leaves 0.62 + t x 0.16), clear of every `FLAG`; the art pass
  prints it with the props' own pixel-font digits and strokes. `createPropArtMaterial` (its `dp` path),
  `createDragonObjectMaterial(U, o)` (= `createAsciiObjectMaterial` with the switches off: every set's
  props / trees and `destructibles.js`'s rigid batch use it). A dp crown's debris bursts into digits.
- **The upgrades — `render/dragonPrintFx.js` + `world/groundFx.js` (`world.groundFx`).** `DP_FX_U`: ONE shared
  uniforms object every dragon-printed material spreads in (`uDpFxOn[4]`, the cloud's drift, the contact
  texture and its box, `uDpFighters[DP_FIGHTERS]`, `uDpRip[DP_RIP_N]`, the ridge's numbers and glyphs).
  `GroundFx`: `update(dt)` once a frame after the wake (the switches, the cloud on `world.life.wind`, the
  fighters' rings from `game.player` and `game.boss.bodyCircles`, the rings' ages, the contact texture
  re-baked round a piece whose state changed), `blow(x, z, power, o)` (from `world.groundBlow`; a ring from
  power ≥ 0.45, none beside a young one), `clear()` (the reset), `on`, `rings`, `bakes`, `contactAt(x, z)`.
  Tuning: `world/groundFxTuning.js`.
- **The footprints — `render/dragonStep.js`** + `world/life/steps.js`. Every step on every surface records a
  flash print (`STEPS.flash`). With the dragon ground (`world.ground.userData.look === 'b'`) steps.js writes the
  newest `DP_STEPS` of them into `DP_STEP_U` once a frame (x, z, age, heading; `uDpStepK.w` 0 when none) and
  the floor's cells print them (`dpStep(cellCentre, hash)` → strength, heat, the code letter); otherwise a few
  code letters flash as the prints' particles. `?prints=0` the surfaces' prints before.
- **Tests:** `groundfx` (rings live and expire, contact bakes, no NaN, no allocation, every level),
  `dragonProps` (switched off = the materials before; tone windows; every level builds; bites), `dggrass`,
  `dpfloor` (the rim; every set; switched off = before), `life` `steps.flash`. A check of a look BEFORE the
  dragon print runs under `?dragon=0` / the piece's `'0'` (`setLook`).

## Levels and the boss slot (2026-11-12, ADR-058, ADR-060; the Starless level: ADR-068 – ADR-070; the Skybreak Ring: 2026-11-21, ADR-129; the Foxfire Terrace: ADR-147)
`src/levels/index.js`: `LEVELS` (Cinderwood `cinderwood`, Ashfall `ash`, the Obsidian Throne
`starless`, the Skybreak Ring `ring`, the Foxfire Terrace `fox`, the Windless Grove `grove`, the Hall of Falling Script `code`, Halcyon Plaza `city`, the Veiled Crossing `veil`, the Last Foundry `foundry`), `DEFAULT_LEVEL`,
`withStage(level, search)` (`?stage=lab`: the same level on the training
room, `world/trainingRoom.js` `createTrainingRoom` / `ROOM_WORLD`; main.js wraps the level with it
before `applyLevel`; ADR-099), `getLevel(id)` (id or alias, case-insensitive), `levelFromSearch(search)` (`?level=`; unknown → the
default), `applyLevel(level)` (merges `level.world` into `CONFIG.world`: main.js calls it once,
before building any module), `levelUrl(id, href)`. One level per page load; switching reloads.
A level: `{ id, aliases, name, sub, world, buildSet(U, colliders), createBoss(game), text, reward? }`.
`reward` (optional; ADR-148): the level's fixed reward as data, `{ id, name, line }` (the shape of the
shared rewards store being built beside this for another level), plus `usable: false` while it does
nothing yet (the Foxfire Terrace's `paperDouble`).
- `buildSet` returns createForest's shape (`group, treeSpots, bare, slabs, nest, bonfire, material,
  stoneMaterial, slabMaterial`) plus, optionally, `breakables` (what can be chipped, felled, burned and
  thrown: see Destruction above; a set lists those pieces there INSTEAD of merging them into its static
  meshes), `edge: { base, outer? }` (the hero's ground follows what stands of the pieces marked `edge`: Destruction → "The edge of the open ground"; the forest's set), `scarInk [r, g, b]` (the colour of cracks in its floor), `ash: true` (atmosphere: falling ash flakes and a
  few embers instead of fireflies, mist and leaves) and `grass: { density(x, z) → 0..1 factor,
  height (×), ash 0..1 }` (world.js thins / shortens / greys the meadow; grass.js `uAsh`), and
  `groundY` (m; ADR-129): world.js puts its ground plane there, right after the set is built, when it is
  a finite number other than 0 (the Skybreak Ring's `?ring=c`, the butte's crown, lowers the badlands
  40 m and draws its own walkable top; everything that stands on the play surface is still at y = 0).
  A set may also bring its own night and weather (ADR-070; the Obsidian Throne's set does):
  - `sky: { moonColor, moonDir, ambient, fogColor, fogNear, fogFar }` (all optional): world.js writes
    it into the shared uniforms once, right after the set is built.
  - `ambience: { setup(game), update(dt, game), ... }`: atmosphere.js calls `setup` once (lights,
    its own particle batch: `game.pipeline.registerParticles`) and `update` every frame INSTEAD of
    the fireflies / mist / leaves / ash (the bonfire's flames stay; so on such a set the living world's
    `takes('leaves')` changes nothing). The Obsidian Throne's also has `breathe(k)` (the living world's
    weather, held each frame: the star's breath; 0 without it is today's inlay exactly). The Obsidian Throne's also has
    `flare(k)`: its floor seal brightens and settles (the boss calls it; optional for callers). The
    Skybreak Ring's has `flare(k)`, `dim(k)` and `state` (below).
- **The Obsidian Throne's set** (`world/throneHall.js`: `createThroneHall`, layout `THRONE`; ADR-112;
  the names are from the hall it replaced). An open crater: a disc of plates `THRONE.R` 15 m round the
  seal (the origin), the dais from `daisZ`, the seat at `throne`, the fallen star at `star`, the south
  lip at `entryZ`, the bonfire at `bonfire`. `THRONE.floor = { r, zN }` is where the boss may stand:
  the level puts `r` into `world.dragonBound` (the duelist's circle; the Lord's `TUNING.bound` is the
  same number) and `zN` into `world.bossFloor = { zN }` (the dais's line: `StarlessLord.clampTarget`
  reads it; a level or stage without `bossFloor` has no such line). Its breakables: 'shard' (the
  star's glass in the floor and on the rim), 'slab' (the rim's tall plates) and 'hover' (six stones
  hanging in the air: no collider, `cover: false`, `hp: Infinity`: they only chip); all `lift: 2`.
  A hanging stone's geometry is built ON THE FLOOR and its entry carries `hover` (m): the set's
  ambience lifts the piece's `body` by it while the piece is INTACT, and whoever takes the stone
  sets `body.position.y = 0` and carries it from `hover` up (a piece lands where its pivot meets the
  ground: ADR-109).
  Three rng streams: the layout (the picked render's sequence: add nothing to it), the rubble broken
  pieces leave, and anything added later.
- **The Skybreak Ring** (ADR-129; `src/levels/skybreak.js` `SKYBREAK`: id `ring`, aliases `skybreak`,
  `ascendant`, `tianlei`; boss `new Ascendant(game)`, below). `world`: `arenaRadius` `RING.half` 15,
  `playerBound` `RING.bound` 40 (round the origin: the ring, the path and the bonfire's landing),
  `dragonBound` `RING.floor.r` 13.8 (no `bossFloor`), the bonfire and the hero's spawn 0.6 m east and
  1.7 m north of it, `dragonSleep` `RING.wait`, `bossTriggerZ` `RING.entryZ - 0.6` (onto the platform),
  `wakeRadius` 9. `text` has `phase2` GOLDEN ASCENSION and `phase3` THUNDER ASCENSION (no `phase4`).
  **Its set** (`world/skybreakRing.js`: `createSkybreakRing(U, colliders)`, `RING`, `ringOption()`,
  `RING_LOOKS`, `BUTTE`): a square platform of stone tiles 30 m across centred on the origin, a kerb of
  long dark stones round it, an octagon of wedge plates at its middle, a bronze brazier on a stone post
  at each corner (the south two low), a path of flagstones south to the bonfire, wind-carved buttes in
  banded red strata east, west and just past the north edge. `RING` (the fields of the arena this page
  built) `= { option, half: 15, cell: 1.5, entryZ: 15.4, bonfire: { x: 0, z: 33 (c: 29.5) }, floor:
  { r: 13.8 } (the circle the boss keeps to, inside the kerb), wait: { x: 0, z: -3, yaw: 0 }, bound: 40,
  groundY: 0 (c: -40), corners: [[±15, ±15]] (four, frozen: ascend3's bolts), buttes: [{ x, z, r, h,
  cut }] }` (the beam's line ends at one, kiBeam.js). The set returns createForest's shape plus
  `option`, `groundY`, `tops` (the buttes' top pieces; the tests and the beam's measures read them),
  `scarInk`, a dry `grass`, `floorCarry` (a torn-up tile's colour), `sky` (the dusk palette) and
  `ambience`. Four rng streams (the ring and floor layout, the props, the badlands, the floor's
  remains); the ambience has its own.
  - **Three arenas behind a build-time switch**, `?ring=a|b|c` (`lookOf('ring', 'a')`; a reload; the
    owner's pick a, 2026-11-21): a the flats (a dry lake bed of cracked clay plates, banners east and
    west, a war drum, a gong, a judges' dais to the north, boulders, buttes and hoodoos), b the quarry
    (three terraces of cut stone east, west and north, drawn as props with colliders: the play surface
    stays y = 0; cut-block stacks, a derrick), c the crown (the ring on a butte's top, the ground plane
    lowered 40 m through `groundY`, the crown's soil a copy of the ground on its outline, cliffs, rim
    colliders, rock spires, a rock neck carrying the path south).
  - **Its breakables by kind** (counted by `world.mjs` `sets`): a 579 (tile 361, mud 162, flagstone 14,
    boulder 12, butteTop 6, butte 6, post 4, hoodoo 4, banner 4, deadTree 3, drum 1, gong 1, dais 1;
    46 colliders), b 602 (tile 361, flagstone 168, terrace 50, post 4, butteTop 4, butte 4, blocks 4,
    banner 4, hoodoo 2, derrick 1), c 409 (tile 361, spire 17, flagstone 11, post 4, butteTop 4, butte
    4, cairn 4, banner 4). Every tile, kerb stone and octagon plate is a floor slab of kind 'tile'
    (`world/floor.js` `breakableFloor`, ADR-122; the earth under a broken one a warm pale dust, `EARTH`);
    the lake bed's clay plates are 'mud' slabs within 24 m (scenery past it); the gong is `hp: Infinity`.
    Worth in POWER units (`BUTTE`): a butte's top 4.2, a hoodoo 2.6, a banner 0.7, the drum 1.2, the
    dais 5, a terrace 2.4.
  - **The buttes are two-stage pieces** (BREAK.colossus's precedent): a 'butteTop' (no collider, hp
    `BUTTE.top`, weight 2.2, `fallOff` r × 0.4, `fallT` 1.6, `blocks` 4; it topples outward from its cut,
    or bursts where it stands on c, whose buttes rise out of the depths) stands on a 'butte' foot (hp
    Infinity: it only chips; `holds` the top, `cover: true`, a collider r × 0.88). Blows on either wear
    the top; a beam's sweep at power 1.5 takes it in 3 ticks (0.6 s).
  - **Its `ambience`** (atmosphere.js runs it instead of the fireflies): the light BY THE BOSS'S FORM
    (`update` reads `game.dragon.phase` / `state`; three palettes, eased at 0.9 / s): a clear dusk, then
    golden (warmer, brighter, a light round him that follows him, golden motes), then a thunderstorm
    (cold and dark, wind-blown dust, rain as glyph particles, lightning every 2.4 – 6.5 s that lights the
    whole ring for a frame or two, sometimes twice). It writes the shared light uniforms (moon, ambient,
    fog) itself every frame: nobody else should. `flare(k)` (k 0..1.5; a transformation, a great blow, a
    won clash): a flash of the form's light, gold before the storm, cold white in it (only raises a
    running flash). `dim(k)` (k 0..1; call it every frame it should hold: the great beam's charge): the
    light pulled down by up to 75 % at k 1, the braziers' lights too; it lets go 0.2 s after the last
    call. `state` → `{ w: [dusk, gold, storm], flash, dim, phase }` (a copy: the Lab, the tests). A
    reset (his form back to 1) snaps the light to the dusk and clears the dim; his death eases it ("the
    storm breaks"). The braziers burn in the fire field while their post stands.
  - `landmarks.js` gained the badlands' builders (prop art, carved): `buildButte(rng, x, z, { h, r,
    cut, col, below, sides, k })` → `{ lower: [geo], upper: [geo], cut, r }` (banded strata, split at
    the band nearest `cut`; `below`: its foot from y = -below), `buildHoodoo(rng, x, z, { h, r, col,
    below, lean, yaw })`, `buildRingPost(rng, x, z, { h, w, yaw, col })` → `{ stone, bronze, fireY }`,
    and the colours `BADLAND`, `RING_BRONZE`.
- **The Foxfire Terrace** (ADR-147; `src/levels/foxfire.js` `FOXFIRE`: id `fox`, aliases `foxfire`,
  `terrace`, `shrine`, `thousand`, `wenyao`; boss `new ThousandFox(game)`, below; `reward` the Paper
  Double, ADR-148). `world`: `arenaRadius` 14.5, `playerBound` 40, `dragonBound` 12.2, the bonfire at
  `TERRACE.bonfire` and the spawn 0.6 m east and 1.7 m north of it, `dragonSleep` (0, -2, yaw 0),
  `bossTriggerZ` 14.6, `wakeRadius` 9. `text` has `phase2` ONE BECOMES A THOUSAND and `phase3` THE FOX
  WEARS ITS FIRE. **Its set** (`world/foxTerrace.js`: `createFoxTerrace(U, colliders)`, `TERRACE`): see
  "The Foxfire Terrace's set" below. Music: borrowed tracks (`trackList.js` `fox`) until the owner
  auditions a score.
  **Its set** (`world/foxTerrace.js`: `createFoxTerrace(U, colliders)`, `TERRACE`; ADR-147): the
  courtyard's return shape without `ash` and without `sky` (the default night, the fireflies read as
  foxfire). A round paved terrace, r 14 m on the origin, the courtyard's slab bond with the slabs that
  cross the rim clipped to the circle (`slabCorners` / `outlineSlab`), a lighter kerb of curved stones
  (r 14.03 – 14.55), three rows of steps (z 14.98 / 15.82 / 16.66) and a flagstone path to z 32 (the
  bonfire at (0, 34)): every one a floor piece (`breakableFloor`). Ten stone lanterns at r 14.8 (kind
  'lantern', the courtyard's `buildLantern`, `topples: false`), six seated stone foxes on plinths at r
  13.2 turned to show their profile to the camera ('foxStatue', `topples: false`, `lift: 0`; broken: the
  plinth and rubble, the plinth keeps a collider), eight wooden charm posts at r 16.5, none east or west
  ('charmPost', `mat: 'wood'`, `look: 'prop'`, `cover: false`: they burn through in about 7 s from one
  ignite to a snapped foot; whether a piece burns is its material's, not its look's), two landmarks
  (`landmarks.js` `buildGreatFox` (-18.0, -1.6), ~8.4 m, in profile, and `buildSpiritGate` (17.3, -1.4,
  yaw -0.62), ~6.3 m: kinds 'greatFox' / 'spiritGate', `hp: Infinity`, they chip; the gate does not stop
  projectiles), dead trees and boulders round the hill (the courtyard's `open()`; clear inside r 19.5,
  on the path, round the bonfire and the landmarks). 445 breakables, 192 colliders, 380 bones (the
  courtyard's 443). Streams: layout seed + 131, rubble + 5131, spare + 6131, landmarks + 1931, floor +
  7131; and the set is built on a QUIET `Math.random` of its own (three.js draws a uuid per object: a set
  that grows would reshuffle the seeded fights). `TERRACE`: `r, cell, kerb, lanternR, lanterns,
  lanternAt, statueR, statues, statueAt, postR, posts, postAt, steps, stepHalf, pathFrom, pathTo,
  bonfire, greatFox, spiritGate`.
- `text`: `arrive[]`, `stir`, `phase2`, `phase3`, `phase4` (null / absent: no banner), `victory`,
  `fallen`, `restReset`, `again`, `rise` (GameFlow `_text(key)`; Cinderwood's lines when the game has
  no level).
- **The boss slot.** `game.dragon` (=== `game.boss`) is the level's boss. Every consumer (player,
  HUD, flow, camera, audio, name tags, minimap, touch aim, Lab) reads the Dragon contract's surface
  below and listens for the `dragon:*` events, so a boss offers: `name` (the HUD splits it at the
  comma: ui/bossName.js), `state` (`sleeping|waking|combat|staggered|airborne|dying|dead`), `hp,
  maxHp, phase, phaseAt, nextPhaseHp, posture, maxPosture, broken`, `hurtSpheres`, `bodyCircles`,
  `position, yaw, object3d, batch`, `isTargetable()`, `lockPoint(out)`, `startIntro()`, `takeHit(o)`,
  `onParried(info)`, `reset()`, `update(dt)`, `debug` (the Lab's generic shape). Optional
  `drawnPoint(v)` (+ `drawScale`): maps an upright gameplay point (a hurt sphere's centre) to where it
  is drawn (the lean, the drawn size, a drawn-only offset), in place; the hero's landed cut is drawn
  where his drawn blade meets those drawn spheres (absent: identity; the wyrm offers one since ADR-149: its drawn reaction). A plunge target adds
  `plungePoint` / `onPlunge` (the wyrm); a **duelist** (`kind: 'duelist'`) instead offers
  `onExecute({ damage })` and `execRange` (the execution thrust, Player below) and gets no creature
  voice (audio.js gates roars, pain and recoil yelps on `kind`). A boss with **several health bars**
  offers `lives: { total, left }` (the Starless Lord's blade forms): `hp` / `maxHp` are then the
  CURRENT bar, the HUD draws one pip per bar, and the execution's call-out reads DEATHBLOW.

### Duelists — `src/entities/enemies/duelist/` (ADR-068; the second pass: ADR-122)
The engine every human boss runs on (the Ash Disciple, the Starless Lord, Tian Lei); a boss is a KIT of
data and a subclass with a few hooks.
- `duelist.js` `class Duelist(game, kit)`: the boss slot's surface, the guard, posture, the break and
  the execution, the deflect chain, the blade lock, the mikiri, the full deflect, hit stun, `hitPlayer`.
  `kit = { id, TUNING, MOVES, MOVE_NAMES, CLIP, realise, transitions {phase: move}, counterMove(phase),
  maxPhase, loadout, poses, blade {guard, tip}, scale, REACT, OPEN, dress }` (`dress(d, dt)`: ADR-122, the
  body's look by phase, called once a frame from `_materials` after `_bladeMaterials`; `scale`: his drawn size, model
  metres → world, default `HERO_SCALE`; visual only, as the hero's: it is `d.drawScale` and the
  pilot's `drawScale`, so the animator's gait matches it). `reset()` resets the animator before the
  brain, then poses one short step: he waits in his waiting clip (kneeling, enthroned), not in the
  walking clip's guard. Subclass hooks: `_tint(M)`, `_setup()`
  (extra meshes, before batching), `_makeFx()`, `_makeBrain()`, `_bladeMaterials(dt, M)`, `_onHpZero()`
  (default: he dies), `brainFrame(dt)`, `afterPose(dt, act)`, `onImpact(beat, sense, act)`,
  `onRelease(beat, sense, act)`, `onCast(beat, sense, act)`, `beatMotion(beat, u, sense, dt)`,
  `onTransitionEnd(act)`, `clampTarget(point)`, and two for moves that depend on the level (ADR-111):
  `weigh(name, def, w, dist)` → the weight his AI gives the move right now (`brain._choose` calls it for
  every move it could pick; 0 = not now: no piece in reach) and `onActStart(act, opts)` → `false` when the
  move cannot start (`brain.startAct` then returns false and nothing has changed; the Lab's trigger
  included): the actor picks the piece of the level the move will use there. `d.T` = `kit.TUNING`. `drawnPoint(v)`: an upright
  gameplay point → where it is drawn (lean, `drawScale`, the lean's `ox` / `oz`). Hit stun
  (`TUNING.hitStun.light / heavy`): `stop`, `jolt`, `push` and `shudder` (m: through the freeze his
  drawn figure flickers ± this far along the cut, fading, in real time, through `lean.ox` / `oz`;
  only for a sword cut, `takeHit`'s `swing`; `d.shudderK` 0 turns it off, the Lab's 'shudder'
  toggle; `d.shuddering` is true while it runs, and the blades' sweep trails pause then: the
  flicker is no swing). His hit spray flies along `takeHit`'s `cut` (the shove keeps `dir`) and
  starts at `point` moved by his own shove (the shove is instant: the hero moves the drawn cut the
  same way, so both sit on the body the freeze holds).
  **The body answers where it was hit** (ADR-149; `react.js` `class HitReact`, numbers `reactTuning.js`
  `REACT`): `d.hitReact.hit(R)` from `takeHit` for a sword cut only (`o.swing || reel > 0`, at
  `impactK('react', 'duelist')` > 0; R = { k, part, point, cut, dir, thrust, heavy, crit, reel, skid,
  moved, limb }) and from `onExecute` (a heavy thrust fold). `limb` (CONTACT, ADR-259: the capsule the hero's steel
  met) overrides the part read from the height, and adds the arm: a body hit on the chest with `REACT.arm`'s
  stronger twist, that shoulder dropped and back, the head turned from it. The HERO wears the same layer
  (`player.hitReact`, ×`CONTACT.react.hero` 1.2): restored before his animator, applied after `_combat` (his
  sweep never sees it), from `_reactTo` on a hit that met him. `_animate` order: `hitReact.restore()` →
  jolt, pilot → `anim.update` → `_gameplayPoints()` → `hitReact.apply(dt)` → lean on →
  `updateMatrixWorld` → `_drawnPoints()`; `reset()` calls `hitReact.reset()`, `_poseAt` restores it
  before posing. Gameplay points never see it; up to 3 slots add.
- `brain.js` `class DuelBrain(d)`: the mind and timeline (modes sleep, intro, foot, act, react, broken,
  dying), all data from `d.kit`. Phases are generic: when a gate is hit it starts
  `kit.transitions[phase]` and emits `dragon:phase<n>`; `forcePhase(n)` for the Lab. Beats: a zone hit
  (`sector` / `line` / `ring`; `hitPlayer` gets `beat`), a `release` or a `cast` (the actor's, at the
  impact; a string never stops for want of reach on one). `def.manual` / `def.counter` / a weight of
  0 keep a move out of the AI's pick; `def.gapCloser` is favoured against a hero who drinks.
  **The pursuit** (ADR-162; opt-in, `TUNING.pressure.pursue`, today Tian Lei's; a kit without it
  behaves exactly as before; the full field list is brain.js's header): through each real melee beat's
  windup, from `after` s up to its glint, the hero is led to the impact (`_lead`) and set against what
  the beat can still reach (`_reachLeft`: the zone, the step-in left, the dash not yet spent); beyond it
  by `margin` m (`_outOfReach`) the move breaks off with no glint and no hit (a glint is always a blow;
  its `combat:tell` may already have been announced, as a fairness-guard feint's) and he chases: a
  `far` / `away` link, else footwork after `gap` s. `brain.stats.stops` counts them, `brain.runner` (the
  hero's habit of running) weighs the moves that reach anywhere; `forecast(s)` = the hero's speed away.
  While the hero backs away (> `away` m/s) a beat's step-in is x `closeK` and a dash's cap x `dashK`
  (per phase); a leap lands `leapLead` s and an actor's blink `blinkLead` s ahead of where the hero is
  going (`blinkKeep`: never in front of him); director.js weighs a move whose first blow cannot reach
  where the hero will be x `miss`. Not a counter, a flurry, a stance, a draw or a transformation.
- `realise.js`: `makeRealise({ TUNING, MOVES, compileClip, completeBeat, keysOf, recoveryKeysOf })` → `realise(name, phase, rnd, opts)` (`opts.count`:
  a `streak` move, his flurry, plays that many beats); `perPhase`. `keysOf(beat)` (optional; ADR-225, ADR-226) gives the pose keys a beat plays this time (null: `beat.keys`): a beat's `motionKeys` (its held
  tell pose, `duelist/tellPose.js` `tellKeys` / `motionize`: Shen Hui and Varr Nihil, `?ashMotion` / `?lordMotion`, on by
  default). `recoveryKeysOf(move)` (optional) does the same for a move's `recoveryKeys` (the Lord's `motionRecovery`).
  Timings never depend on either. The POSE keys of a beat past its
  impact (u 1..2) run on the beat's follow, `b.F` s (ADR-126: 72 % of the time to the next beat's
  first pose, 0.24 s at most, 0.3 s for a ring zone, `def.follow` to set it), not on the active
  frames; gameplay (`uAt`, `travel`, `lift`, the zone) keeps the active frames' clock. A key marked
  `gather: true` is left out of a beat that follows another, `settle: true` out of a beat another
  follows; a bait hold repeats the cocked pose at its end. The clip of a realised move has
  `steps: true` (the animator's `_feetClip`, below).
  Beat extras: `{ pick: [beat, ...] }` (one alternative drawn as the move starts), `fixed: true` (its
  windup is not scaled by the phase), `chance` (the beat is played on that roll only), `sustain: { dur,
  tick }` (ADR-129: the beat stays lit `dur` s past its active frames; the realised beat carries `S`, its
  `end` is `impact + A + S` and everything after it waits; its keys past the impact span the whole lit
  time, `b.F = A + S`, instead of the follow clock: a held beam's pose lasts while it is lit).
  `TUNING.flashLead` may be per phase.
- `poses.js`: `createDuelPoses(GUARD, opt)` → `{ duelStance, duelLoco, compileClip, completeBeat, evalClip,
  duelClip, POSES }` round one guard stance (a compiled clip remembers its set: `clip.kit`); `opt.run` (how the
  blade is carried at a run), `opt.breath { k, period }` (the idle breath's size and pace); `setSw(p,
  az, el)` is exported for a boss's own pose functions. A clip's fields run on a cubic through their
  keys (a key is passed through unless the field turns back there; ADR-126); `completeBeat(keys)`
  gives one beat's keys the guard's value for every field none of them sets (a beat owns its
  channels; the blades' directions carry); the blade-driven arm takes the blade's angles as keyed. Besides the Ash
  Disciple's channels: `lsw` ([az, el] of an off-hand blade, left on the animator as `A.off` for the
  actor to pose a second blade) and `larm` / `lext` / `llead` (the left hand driven by it).
- `guard.js` (ADR-080): the guard's reaction clips every duelist shares (`GUARD_CLIPS`, spread into a
  kit's CLIPS and compiled round its stance): `wardHold` (the guard raised over his footwork), `ward` /
  `wardR` / `wardHigh` (a strike met on his left / right / from above; the contact pose is the clip's
  first frame, it ends raised), `deflect` (he beats the strike away), `clash` (the old name);
  `GUARD_TRAVEL`, `GUARD_KINDS`.
- The guard, read from him (ADR-080): `brain.wardK` 0..1 raises the ward over his footwork while
  `brain.threatened()` (the hero swinging at him from his front within 4.4 m) or for
  `TUNING.guard.wardLinger` s after a strike was met (the pilot's `ward` / `wardClip`, `poses.js`
  `raiseWard`). `brain.onGuarded(heavy, clip)` → `'armor'` (mid-windup: turned in passing), `'ward'`
  (held; also breaking off a recovery past `TUNING.guard.recoverOpen` of it) or `'deflect'` (beaten
  away: `player.onGuarded({ deflect })` bounces the hero, and the counter move starts as the 0.24 s
  beat ends). `brain._evade(s)`: once per 3 s he may step out of a heavy blow (`TUNING.guard.evade`),
  from footwork or a late recovery.
- **CONTACT** (ADR-259, `combat/contact.js`, `?contact=0|a|b`, the Lab's `contact` row): `d.strikeContact(meet,
  heavy, biteAt?)` → the meeting point (drawn, world) or null. `meet(a, b, r, out)` is the struck thing's signed gap
  (m, − inside) to a striker a → b of radius r (the hero's `ContactBody` for a hit; his blade, then the shell 0.12 m
  before his body, for a block). The strike is searched along his clip from the frame the blow was decided
  (`findContact`: back ≤ 0.16 s where it had gone through, on ≤ 0.075 s where it fell short, steps of 1/120 s and
  three halvings) to where the edge bites `CONTACT.bite` 0.035 m in (a thin part at most 0.4 of its radius) or a
  fist / foot (`_part`) touches; `brain.pinAt(tc, hold, follow)` holds the DRAWN pose at that clip time
  (`brain.pin`, `pinStep`: through the freeze, `hold` s more (a heavy blow `holdHeavy` 0.06), then it catches up
  with the clip over `follow` 0.07 s). `_animate` poses the clip's own time first (`_gameplayPoints`: his hurt
  spheres never see the pin), then the pinned time with `anim.update(0)` for the frame drawn. `setBack` and a new
  clip clear the pin. `d._wardOnto(p)`: his guard nudged onto the hero's stopped blade (`pilot.guardNudge`, the
  animator's `gripNudge`, eased off over 0.3 s). `d._reachStep(dt)` (`b` only, top of `_animate`): a blow coming
  within `CONTACT.reach.lead` 0.14 s with the hero in its zone is probed at its impact pose once a frame and his
  drawn body eased toward the hero to close the gap (`hitReact.setReach`, ≤ 0.3 m, the legs solved to the planted
  feet), held through the pin, eased back over 0.22 s. The hero's side: `player._cutContact(dr, dx, dy, dz, heavy,
  guard)` searches his swing's clock the same way (`atk.pin`, `atk.show`: `animT` = `atk.t − atk.show`), from
  `_applyHit` (his drawn steel on the boss's drawn body: `ContactBody.fromRig` on a duelist, `fromSpheres` on the
  wyrm) and from `d._guardClash` (on the boss's blade, before the crossing is read); `player._limbNear(dr)`
  names the part for the boss's HitReact (`takeHit({ limb })`: 'head' | 'body' | 'armR' | 'armL' | 'legR' | 'legL').
- A parried blow is HELD at the contact (ADR-079): `d.parryContact(chest, last, blade?)` steps his pose back
  along the strike (≤ 0.06 s of clip time) to the last pose before the blade crossed the hero's
  centre line in which it is still 0.34 m clear, or sets a thrust 0.4 m aside; `brain.back.off` keeps
  the shown pose that far behind the timeline (the timeline itself is untouched); a blow that is only
  deflected then rebounds for 0.07 s before the clip takes over again. `d.bladeSegment()` → `{ a, b }`.
- `fx.js` `class DuelFx(d)` (also exported as `DiscipleFx`): tells, `guard(x, y, z, { heavy, deflect,
  e1, e2, spray })` (his guard's clash: dull steel, or hot orange for a deflect; `clash` / `parrySpark`
  are the old names), sparks, the sweep trail
  (`sweep(.., ember)`: false steel, true ember, or a colour key such as 'red'), the Ash Crescent's
  projectiles (each may carry its own `speed`, `radius`, `half`, `life`, `style`), `update(dt, d)`. The
  second pass (ADR-122; STYLE.md "The duelists' effects"): `shock(x, z, r, { k, fire, kind: 'dust' | 'fire' |
  'ash' | 'void', T, delay, echo, r0 })` (a ragged ground shock; the Lord's big shocks too),
  `groundShock(x, z, r, k, delay)`, `phaseBurst(n, x, z)` (the Kindling for n 2, the third phase's change for
  n 3), `ghost(d, { dx, dz, life, light, ox, oz, ember, rise, spread })` (an afterimage), `dust(x, z, k)`,
  `onBlow(b, s, a)` (the impact hook: a phase-2 transition → the Kindling; a red / black or knockdown ring
  beat → a shock; in phase 3 an afterimage per blade beat), `kindleCharge`, `ashWind(d, dt, k)`, `ashLook()`.
  The fields the fairness guard writes keep their meaning: `strikes[].at`, `shots[].delay` / `.done`,
  `crescents[].alive`. **Look code draws from its own seeded stream** (`lr()` or a hash), never from `rnd()` /
  `rand()` (game code reads that stream) nor `Math.random` (the seeded suites replay it). Two more
  guards of the seeded fights (ADR-122): `render/lights.js` seeds a light's flicker from a stream of
  its own, and `duel.mjs` / `lord.mjs` `build()` build the boss on a stream of its own (`seed + 0x5eed`,
  then `Math.random` is put back): three.js draws `Math.random` for every object's uuid, so a body look
  with more pieces would otherwise replay every fight with another seed.
- **The second pass (ADR-122): the director, the links, the cue ledger and the fairness guard.** A kit
  whose `TUNING` has a `pressure` block gets them (without one a duelist picks, links and paces as
  before; the ledger only listens). The rules as the player meets them: COMBAT.md "The duelists' pressure
  and the fairness guard". The API, all on `d.brain` (documented again at the top of `brain.js`):
  - `expect(timeFromNow, tell, source)` → a handle `{ retime(timeFromNow), cancel(), alive, left }`, or null
    when the pool of 24 is full: something of his that flies, falls or lingers will land on the hero then,
    needing the answer `tell` asks (normal / blue: a guard; red / black: a dodge). Call it as the thing is
    made, retime it if its arrival changes, cancel it on a parry or a fizzle; it expires 0.3 s after its
    impact. What flies in the existing pools (`fx.crescents`, `fx.shots`, `fx.strikes`, the Starless Sky,
    both terrain objects' pieces, rings and marks) and the world's felled pieces are seen without it.
  - `fairDelay(timeFromNow, tell, max = pressure.guard.maxDelay, source = '')` → s to wait so a strike he
    CALLS lands at least `guard.sep + margin` from every known impact needing the other answer (the running
    move's beats included): 0 now is clear, -1 nothing up to `max` clears it (do not call it). Count a
    delay with `stats.delays++`.
  - `worldClash(landsIn, tell)` → true when a blow of his already cued needs the other answer within
    `guard.sep` of a falling piece's landing (`landsIn` s from now): `world/destructibles.js` asks it at
    the felled piece's flash, and on true the piece lands uncued and harmless (`quiet`; a fizzle;
    ADR-133: a blow told before the piece began to fall and that no hold could clear).
  - `stats` `{ picks, links, chains, cuts, rests, holds, holdTime, feints, toldFeints, delays, fizzles, floors,
    seeks }`; `guardLog`: a ring of 64 `{ t, kind: 'feint' | 'toldFeint' | 'fade' | 'uncalled', what, with }`
    (what the guard stepped in for; `GCD_PGUARD=1` prints the tally); `ledger` (the `CueLedger`).
  - Internals the tests and the Lab read: `_announce` / `_tellRisk` (a blow at risk keeps its
    `combat:tell` until the guard clears it at its cue, then tell and flash go out together; a blow that
    becomes a feint sends neither), `_worldCue(at, ans)` (a world warning grounds his uncued things in
    flight: a crescent fizzles, a stone shatters, the blade passes uncued, Shen Hui's kicked pieces are
    grounded `quiet`; for a returning blade still flying OUT it estimates the homeward crossing too, with
    `ledger.js` `glaiveHome(s, p, reach, H)` (s from now, or -1), keeps its verdict on the blade
    (`_homeWarn`) and gives it at the turn: `_glaiveTurn()` the frame after the blade turns brings it home
    uncued and harmless if its way home still lands too near the warning).
  - **The guard** (`pressure.guard { sep, margin, maxHold, maxDelay, horizon, pad }`): a blade blow is
    checked the frame its cue is due; within `sep + margin` of a fixed impact of the other answer it waits
    at the cock like an authored bait hold (the beat's `hf` / `hl`: flash, impact, later beats and the
    recovery move with it), at most `maxHold` 0.5 s; no hold clears it → a FEINT (no glint, no hit; never in
    his flurry; a `fixed` beat is never held, only feinted). A release / the thrown blade: the same at its
    arrival with `pad` more room. A called strike: its `at` moves later before its cue, up to `maxDelay`,
    else it fades. Shen Hui `sep` 0.3, the Lord 0.4.
  - **Links** (`<boss>/links.js` `LINKS`, read as `d.LINKS`): `{ from: [{ to, when, chance, force, band, cut },
    ...] }`; `when` 'any' | 'near' | 'mid' | 'far' | 'front' | 'side' | 'behind' | 'away' | 'guarding'
    (`director.js` `whenHolds`, the distances and angles in `pressure`); `chance` a number or one per phase;
    `force` ignores the target's cooldown, `band: false` its band; `cut` the fraction of the recovery it
    starts at (default `pressure.linkCut`). The first entry whose `when` holds, whose roll passes and whose
    target is usable wins. Decided once, as the recovery starts; only a move that ended on its own links;
    held while the AI is off, a phase change waits, `gapT > pressure.holdGap` (a test or the Lab holding
    him) or the hero drinks.
  - **Categories** (`director.js` `CATEGORIES`, `categoryOf`): 'string' | 'single' | 'closer' | 'area' |
    'ranged' | 'spell' | 'terrain' | 'hazard'; a move's `cat` overrides the derivation (terrain → hazard (a
    cast storm / star, a beat marked `hazard` or `burn`) → string (3+ blade hits) → spell → ranged → area →
    closer → single). Also `answerOf(tell)`, `directWeight`, `linkFor`, `linkUsable`, `densityOf`.
  - **Tuning keys** (both bosses' `tuning.js`, per phase where an array): `idleGap`, `chain` (the old flow
    roll), `openingGap` (the footwork after a recoil, stagger, reeling, trampled, executed and a break,
    whatever `idleGap` is), and `pressure.{ chainDepth, chainRest, linkCut, chainCut, near, far, front,
    behind, away, maxRun, overRun, sameCat, bias, density, floorAfter, floorBoost, floorForce, seek { max,
    every }, farDist, closerBoost, maxLive, mixed, holdGap, guard {...}, meter { ramp, rampMean, minRate,
    maxGap } }` (`meter`: what the PACE scenario asserts).
  - **New beat fields** (any duelist): `cat` (on a move), `hazard` (a beat that leaves something lingering),
    `release.speed` (its crescents' own speed), `flit` inside a string (he comes apart and strikes from
    another side, as in his flurry). A `release` beat that carries a `zone` is decided once, as its cue
    comes due: with the hero inside the zone it is a cut (`b.cut` true: cued, flashed, held by the guard,
    timed and answered as a blade blow of its tell, its zone struck, nothing thrown), else a release as
    any other (`ledger.js` `throwsAt(b)`: a release, or the thrown blade, that is not a cut). Each boss's
    own: below.
- **Tian Lei's engine additions (ADR-129; documented again at the top of `brain.js`).** All optional: a
  beat or a kit without them behaves exactly as before.
  - `zone.fwd` / `zone.side` (m): the zone's centre is `fwd` m ahead of him and `side` m to his LEFT (his
    body +x), not his root: a blow whose reach is round a limb (a side kick's heel, a knee). Read by
    `_inZone`, `zoneDebug`, `_worldBlow` (it bites the world round that centre), `_ideal` (+ `fwd`) and
    `_reach` (+ `max(0, fwd)`).
  - `air: true`: the beat is tested whatever his height (a flying kick, a dive; without it nothing hits
    while he is above 0.6 m, and `_worldBlow` skips it). A move holds him up between beats with each
    beat's `lift` (its last value stays).
  - `sustain: { dur, tick }` (realise.js above): the zone gives its ONE result in the active frames as
    any beat's; then the actor's `d.onSustain(beat, sense, act, k)` is called every `tick` s (0.2 by
    default, at least 0.02) until the beat's end, k 0..1 through the lit window. `uAt` runs u 1..2 over
    `A + S`. The cue ledger counts the whole window, impact → end, as one interval (`conflict`): nothing
    asking the other answer is cued inside it.
  - `selfHit: true` (with a zone, usually with `sustain`): the ACTOR tests the zone and deals the hits
    itself (Tian Lei's beams: a first contact, then ticks while lit). The brain cues, flashes, holds and
    ledgers the beat as any blow and calls `d.onImpact`, but gives no zone result and no `_worldBlow`; the
    beat is done at its end.
  - `TUNING.airFall { g }`: a reaction, a break or the death that starts in the air drops him to the floor
    at `g` m/s² (`brain._ground()` sets `falling`; `_fall(dt)` each frame; a beat that flies takes over)
    instead of snapping the root to y = 0.
  - `brain.startLock(o = null)`: `o` overrides `TUNING.lock` for this lock, and its `dist` is passed on to
    `player.startBladeLock` (the lock at range: the beam clash, which also passes `camera`).
- **Floor marks (ADR-177).** At each beat's impact `brain._groundOf(b)` reads the mark the beat leaves
  on the floor (a beat's optional **`groundMark`** `{ kind, power, len, r, fwd, side, arc, claws, hot }`
  or `false`; else from its shape, `DUEL_MARK`, an actor's `T.marks` overriding fields) and calls
  `world.groundBlow`; `_worldBlow(b, marked)` then sets `o.marked` so its heavy blow's crack is not
  doubled. It changes nothing in the fight: no damage, no fire, no draw from Math.random. The rules and
  numbers: Destruction → "Who marks the floor".
  - `_tradeNow` (the trade clash from `takeHit`) ignores a beat marked `selfHit` or `sustain` (a beam's head,
    a stream held lit is no blow of his body to trade with).
  - `stance: { from = 0.3, open = 0.6 }` (the third wave, 2026-11-22) on a FEINT beat with a bait `hold`:
    THE COUNTER STANCE. From `from` of the windup to the impact `brain.catching()` returns the beat;
    `duelist.takeHit` (before the guard, for any cut that is not `exact`) then CATCHES the cut:
    `duelist._catch` deals no damage and no posture, draws the deflect's sparks on the crossing, emits
    `dragon:guard { heavy, deflect: true, caught: true }` (HUD "CAUGHT"), bounces the hero
    (`player.onGuarded({ deflect, caught })`) and calls `brain.onCaught(beat)`, which marks it and
    `skipTo(beat.end)`: the beats after it (the punish) start at once. A stance nothing was cut into by
    its impact ends the move there (`_stanceMiss`: `_toFoot(open)`, `raiseT` held at `open`, so his
    guard stays down: the reward for waiting). `brain.stats.caught` / `stanceMiss`. The actor draws the
    stance (Tian Lei: `fx.stanceGlow` from `afterPose` while catching).
  - `ledger.js` `discPath(s, p, reach, H, out)`: a thrown disc still going out (`s.kind 'disc'`, `phase
    'fly'`) flies on a curve (`curve` rad/s) to `range` m of path, hangs `hang` s, then comes home
    THROUGH where the hero stands at the turn (`through`, the default) or to the hand `H`; writes into
    `out.out` / `out.home` the seconds from now at which its way out / home crosses the hero (-1: it does
    not). The predictor reads it for every live disc (home toward `d._hand`, else `d._hilt`).
  - **His feet.** Two planners live together. The engine's (the animator's `_feetClip` for a clip with
    `steps: true`, ADR-126) pins the feet a clip leaves on the floor; his kit's own (`Ascendant._planFeet`
    + its `POSES.duel` wrapper, `pilot.feetOff`) holds a planted foot where it stands while his root
    moves, steps it back under him past 0.24 m, and LIFTS a moving foot above the engine's "in the air"
    line (`CLIP_STEP.air` 0.035 m), so the engine leaves that foot alone. Together the drawn-foot slide is 0.00 – 0.78 m a string
    (the engine's alone 0.06 – 3.72 m, his alone 0.23 – 4.14 m: the integration agent's measures). One
    planner would need a per-kit `CLIP_STEP` hook in `player/anim.js`.
- **The Sheathed's engine additions (ADR-144; documented again at the top of `brain.js`).** All optional. A beat's
  `draw: true` (its combat:tell is held to its cue; at the cue `d.mayCue(beat, act)` false holds it at the cock a frame
  at a time, `T.draw.wait` s at most (`brain._honor`, the shift `brain._delay` the fairness guard's hold also uses),
  then it is a feint and `d.onHonorFeint` is called; no `_worldBlow` at its impact); a beat's `stopOn: ['blocked', 'hit']`
  (`brain._stopOn`: `d.onStopOn(act, beat, r)`, the later beats spent, the timeline to the recovery, `act.stopped`); a
  move's `recoverOpen` (`guardUp`: its recovery's open fraction instead of `T.guard.recoverOpen`); a move's
  `cooldown` per phase.
- `director.js`: the pure helpers the brain, the PACE meter and the Lab share (above).
- `ledger.js` `class CueLedger(brain)`: the impacts he knows are coming and what each asks. Fed from (a) the
  running move's beats (exact), (b) `combat:flash` from any source and `combat:tell` from 'world' or a
  hazard, (c) a predictor every frame over the effect pools and the terrain objects (read only; the thrown
  blade's way home is predicted while it still flies out), (d) `expect`. Queries: `conflict(at, ans, sep,
  ...)`, `clearShift(at, ans, sep, max, ...)`, `pending(ans, horizon)`, `liveHazards()`, `travel(b)`. Fixed
  pools; nothing allocated per frame.
- `lookSwitch.js` (ADR-122): the look options behind URL switches (STYLE.md "The look switches").
  `PICKED` (the owner's picks, 2026-11-16: name → option; the Skybreak Ring's of 2026-11-21: `ring`,
  `ascLook`, `ascAura`, `ascBeam`, `ascLift`, all 'a'). `lookOf(name, def = '0', pick = 'a')` → the
  option to draw, in this order: a look forced by `setLook(name, v)` (the Lab, the tests, the film rig;
  null gives it back); the URL's own parameter; `'0'` under `?looks=old` when the call site's `def` is
  `'0'` (a REDRAW: the look before this pass; a thing new in this pass keeps its pick, even one with a
  `'0'` option such as `presence`); the pick from `PICKED`; under `?looks=new` `pick` for a redraw no one
  has picked (none today); else `def`. Also `pickedOf(name)` (the pick or null), `allOld()`,
  `allProposals()`, `readLookUrl(search)` (read once at load; the tests call it to play a URL, `''` to
  go back), `looksNow(names)`. Read at draw time (a Map lookup); a switch read when the rig or the
  level is built (`ashLook`, `lordLook`, `floor`, `ring`, `ascLook`, `ascLift`) needs a reload. The Lab's LOOKS section
  (`dev/labLooks.js` `LOOK_SWITCHES`) lists them.

### Ash Disciple — `src/entities/enemies/ashDisciple/disciple.js` exports `class AshDisciple`
A `Duelist` with `ASH_KIT` (moves.js, tuning.js, gear.js, poses.js; `transitions { 2: 'kindle', 3: 'ashWind' }`,
`dress` from look.js): his colours, the kindled blade of phase 2 and the Ash Crescent are his own. Three
phases since ADR-122 (`TUNING.phaseAt` [1, 0.64, 0.36]). The boss slot's surface above (no plunge), plus:
```
kind = 'duelist';  name = 'SHEN HUI, THE ASH DISCIPLE';  execRange = 3.2;  ghostepBehind = 1.5
mode: 'sleep'|'intro'|'foot'|'act'|'react'|'broken'|'dying'|'dead'   // brain.js (state follows it)
guarding: boolean        // his guard covers his front (±TUNING.guard.arc): footwork after the raise
                         // delay, a ward or a deflect, the first TUNING.guard.windupOpen of each windup,
                         // and a recovery past TUNING.guard.recoverOpen of it
takeHit(o): number       // a strike into his guarded front: 0 damage, guard posture, 'dragon:guard
                         // {heavy, deflect}', player.onGuarded; held on the strike's side, or (likelier with
                         // each one in a row) deflected; heavy with poise >= TUNING.guard.crushPoise
                         // (a ~full charged cleave) crushes it: lands + stagger. Otherwise as the wyrm's
                         // (part multipliers, ×breakCritMult while broken, the 50 % phase gate)
onExecute({ damage })    // a broken disciple: final damage, the break spent, 'dragon:plunged {execution: true}'
onParried({ attack, tell })   // the deflect chain (as the wyrm's): a move's non-final hit deflected, the
                         // last recoils him (react 'recoil'); 'dragon:parried', 'combat:deflectChain'.
                         // ADR-062: a PERFECT parry (player.deflect.perfect) of a beat marked `lock` →
                         // brain.startLock() (react 'lock', player.startBladeLock, a camera push-in);
                         // every real hit of a string of >= TUNING.fullDeflect.minHits parried →
                         // 'dragon:deflected', posture, a cinematic, react 'reeling'
onClashed({ tell, beat, heavy, crush })
                         // a trade clash (ADR-082; hitPlayer on RESULT.CLASHED, or _tradeNow from takeHit
                         // with o.swing: a blade's beat <= DEFENSE.trade.window from its impact is spent and
                         // brain.skipTo(impact) jumps the timeline to it): guard posture × TUNING.trade.posture;
                         // a string goes on (the blade rebounds); a single strike / a last blow → react 'clash',
                         // TUNING.trade.push m back, no punish window; crush → 'dragon:stagger', react 'stagger'
onLockEnd(won)           // the lock decided (player._endLock): won → posture, a cinematic, react 'reeling';
                         // lost → a red unblockable shove (player.takeHit kind 'shove'), the Riposte next
onMikiri({ attack })     // the hero rolled into a beat marked `mikiri` (player.takeHit sees hit.mikiri):
                         // posture, 'dragon:stagger', a cinematic, react 'trampled'
hitPlayer(o): RESULT     // his blows (and the Ash Crescents) through player.takeHit
debug: the Dragon shape (abilities, trigger, setAI, wake, startFight, phase2, stagger, postureBreak,
       kill, reset, setHp, hitboxes, currentAction, phase3)   // phase3(): brain.forcePhase(3)
```
Built by `buildHero(U, ASH_LOADOUT)` (gear.js: `ash.*` items registered into the hero's gear registry)
and driven by `HeroAnimator(rig, pilot, DUEL_POSES)` (poses.js: `loco` = his guard on the hero's gait,
`duel` = a keyframe clip). `pilot` is his view for the animator (`position, yaw, state 'duel', stateT,
animT, atk.def = the clip, groundVel, kb, chargeK, releaseK, recoil, lockOn, guardHold`); `recoil` is
his **hit jolt** (`jolt` 0..1, set when a blow lands, decaying over ~0.2 s: poses.js layers a snap of
the chest and head on any pose, so a blow shows without cancelling the move). Clip keys may drive the
sword arm from the blade (ADR-063): the non-pose channels `arm` (0..1 blend from the keyed hand),
`ext` (0 folded … 1 full reach) and `lead` (rad the fist runs ahead of the blade): the hand rides a
circle round the shoulder at the blade's azimuth, as the hero's swings do, and the chest and hips turn
with it; a cut is authored as the blade's path (moves.js `slashKeys`). Moves are data (moves.js
`MOVES`; `realise(name, phase, rnd)` → beats with absolute times, each beat's `close` budget, and the
compiled clip); reactions are `CLIP` (clash, flinch, backstep, sidestep, stagger, recoil, reeling,
trampled, lock, broken, executed, death, meditate, intro). (The engine files named here, brain.js
and the clip / pose code, now live in `enemies/duelist/`, above; his poses.js holds only his guard.)
Beat flags: `lock` (a perfect parry crosses
the blades), `mikiri` (a perilous red thrust: its hitPlayer passes `mikiri: true`, its flash
`perilous: true`), `close` (m he may step in through the windup; default TUNING.close), `closeBy` (opt-in, a number or a
function read live: the u of the windup the close-in is done by; default the impact; Tian Lei's sweep, ADR-248). Hits are zones
tested from his position and facing through each beat's active frames (`sector`, `line`, `ring`), one
result per beat. The brain (brain.js) **leads** the hero: `_sense()` carries his velocity (`vel`,
capped 9 m/s) and every step-in, windup track and dash aims at where he will be at the impact; a
string whose next hit can't reach (`_reach`) ends there. Footwork circles only inside
`TUNING.move.band`, runs beyond it, sprints past `sprintAt`; a hero in state 'heal' is punished (no
breather, ground-covering moves × `TUNING.punish.weight`). Numbers: tuning.js.
**The courtyard's moves (ADR-111, `ashDisciple/terrain.js` `class TerrainMoves`, `d.terrain`).** A move
marked `terrain: 'fell' | 'kick' | 'toll' | 'spring'` (moves.js: `pillarFall`, `lanternKick`,
`bellToll`, `swallowReturn`) uses a piece of `world.destructibles` (every call guarded: a world
without it has no such move). `terrain.find(kind, forced)` → the piece or null (`forced`: the nearest
however far, for the Lab and Training); the engine's hooks route to it: `weigh` → `terrain.weigh(def, w)`
(0 with no piece in reach; it remembers the piece for that brain frame), `onActStart` →
`terrain.begin(act)` (false with no piece at all), `beatMotion` → `terrain.motion` (his own root
motion: a beat's `go: [from, to, arc]`, the windup fractions between which he crosses to the piece and
the leap's height, or `spring: { up: [from, to], off }`; such a beat has `track: 0, close: 0`),
`onImpact` → `terrain.impact` (the pillar is felled: `destructibles.topple(piece, dx, dz, 'boss')`, so
the fall's tell, strip and blow are the world's), `onCast` → `terrain.cast` (a `cast: { kind: 'lantern'
| 'toll', selfCue: true }` beat: `take` / `carry` / `throwTo` with his own blow in `onLand`, or a ring
of sound), `brainFrame` → `terrain.frame(dt)` (the piece in the air and the rings: each emits its own
`combat:flash` { source: 'dragon', attack, tell } `flashLead` before it reaches the hero and deals
through `hitPlayer({ projectile: true })`). `terrain.busy`: something of his is still in the air.
Since ADR-122 also `terrain: 'flag'` (`flagKick`, `flagVolley`: a flagstone levered out of the paving with
`destructibles.floorNear` and kicked, one a beat) and `'fan'` (`flagFan`: three at once, cut through in the
air); a kicked piece's flash carries `flare: true`, nothing is drawn where it lands, each is told to the
ledger (`brain.expect`) and its flight lengthened by `brain.fairDelay` (at most `maxDelay` 0.4 s; -1: it
lands uncued and harmless); `terrain.shot` / `terrain.kicks` carry `quiet` when a world warning grounds
them. `pillarFall` takes a colossus's upper half too (its strip starts `fallOff` out). Two random streams
of its own (`_g` gameplay, `_l` looks), never `fx.rnd`.
**His second pass (ADR-122).** `links.js` `LINKS` (read through the `LINKS` getter; shared lists `PURSUE`,
`THROWN`, `YARD`). `moveFx.js` `class AshMoveFx(d)` (`d.moveFx`): BURNING GROUND. A beat's `burn: { kind:
'across' | 'along' | 'path' | 'ring', at, from, len, w, life, r, arcs }` (moves.js) lays a line of fire
from phase `TUNING.burn.from` (`onImpact` → `moveFx.burn(b, act)`; `brainFrame` → `moveFx.frame(dt)`): a
pool of 12 `lines` (at most `burn.cap` alive per phase), `alive`, `add()`, `burn(b, act)`, `reset()`,
`stats { lines, burns, capped }`. A tick on a hero standing in it is a contact blow (`attack`
'burningGround', blockable, never parryable): through `player._block` on a raised guard (no health,
`burn.guard` 34 off the guard meter), else `burn.damage`. Drawn as fire-field heat (`?burn=`). Other beat
fields of his: `zig` (m: before its dash he steps this far aside, + his left), `flit` inside strings,
`release.speed`, `TUNING.crescent.minLead` (a crescent that would reach the hero sooner is not thrown).
`look.js` `dressFrame(d, dt)` (the kit's `dress`: `?ashLook=b`, the body dressed by phase) and `bodyArt.js`
(the converter to the wyrm's art path that `?ashLook=a|c` and `?lordLook=a|c` use) are look modules: built
only when their option is chosen at build time; the default rig is as before.
`d.baseBound` is the level's bound; `d.bound` adds `terrain.slack` (he may stand out past his bound
for a piece; it shrinks at `TUNING.terrain.leash` m/s once the move is over). A beat's `noSweep` keeps
the blade's sweep trail off a blow that is not the blade's (the kick). `reset()` clears it all.
**HeroAnimator** (anim.js): `new HeroAnimator(rig, player, poses = null, opts = {})` — `poses` merges extra clips
over the hero's table for that instance (a key it shares replaces the hero's clip for that instance
only; a key of its own that is not a walking clip gets no foot planning: the Starless Lord's
`glide`). `opts.freeHand` (the player only, never a duelist): the free hand's wrist, the sword
fingers, the gap-gated fist and the free elbow's `LOCK_REACH` (see Hands, above); `anim.freeHand`
says which. Exported for other pose tables: `P, N, v3, to3, dirLerp, kf, guard, loco, turnTwist`
(and, for the tests, `WRIST_L`, `OFF_SNAP`). A pilot
may set `updraft` (0..1): a wind under its cloth outside the hero's charge (a duelist's casts).

### Starless Lord — `src/entities/enemies/starlessLord/lord.js` exports `class StarlessLord` (ADR-069)
A `Duelist` with `LORD_KIT`; COMBAT.md → "The Starless Lord" has the fight. The boss slot's surface, plus:
```
kind = 'duelist';  name = 'VARR NIHIL, THE STARLESS LORD';  phase 1..4 = his blade FORM
lives: { total: 4, left }      // the forms still to beat (this one included); hp / maxHp = this form's bar
lit: 0..1                      // how far the blades are lit (they extend from the hilt)
blades: { A, B, hiltB, Q, off, L, cores }   // main blade, the staff's second blade + joined hilt, the cross-hilt's
                               // side blades, the off-hand saber's joint and its blade (gear.js names them);
                               // cores: [[blade, slit]] the split blades' dark slits (`?lordRef=a`, ADR-277;
                               // empty otherwise), kept shown and scaled with their blades by _showForm
_onHpZero()                    // an empty bar BREAKS him (no death): on one knee for posture.breakTime
onExecute({ damage })          // the DEATHBLOW: the form ends ('dragon:plunged {execution, deathblow, form}');
                               // forms 1-3: react 'executed', then kit.transitions[form + 1] (enterPhase: a
                               // full bar, the new stance and blades; nothing lands on him until the
                               // ignition's ring goes out); form 4: he dies
endBreak()                     // a break nobody answered: posture.spared of the bar back, half the meter
addPosture(n)                  // × lerp(posture.gainByHp) by the bar's missing fraction (hard to move on a
                               // full bar); regen × posture.regenByHp
moveBy / clampTarget(p, pad) / onFloor(x, z)
                               // he keeps to the crater's floor: his circle round the seal (`bound`:
                               // TUNING.bound = THRONE.floor.r) and south of the dais
                               // (CONFIG.world.bossFloor.zN, the level's; absent on the lab stage)
_glide(dt)                     // in footwork past TUNING.glide.on m/s: the animator's 'glide' clip, the root
                               // lifted TUNING.glide.hover m, a wake under him; a backstep / sidestep likewise
weigh(name, def, w) / onActStart(A)
                               // a move marked `terrain` (ADR-109): his AI gives it weight only while the
                               // crater has a piece for it; it takes its pieces as it starts (false: none)
terrain                        // LordTerrain (terrain.js): begin(A), onCast(b, s, a), frame(dt), drop(),
                               // reset(), busy; the pieces held (`held`), the rings where thrown ones land
                               // (`marks`), Crown Fall's pick (`fall`). Uses world.destructibles: take,
                               // carry, throwTo (his blow in onLand), drop, topple
debug.phase4(), debug.setForm(n), debug.form
spells                         // LordSpells (spells.js, ADR-122): busy, nightLive, clear(), recall(), catch(),
                               // onForm(n), stats, rand() (its gameplay stream), lr() (its look stream)
```
**His second pass (ADR-122).** `links.js` `LINKS` (shared lists for the strings' pursuits, `AFTER_RED`
after a red spell or a thrown piece, `AFTER_SPELL` after Rupture and the Halo). `spells.js` `class
LordSpells(d)` (`d.spells`, stepped from `brainFrame`): what flies, waits or falls while he fights on, each
reported to the ledger (`expect` / `fairDelay`): the WHEELING BLADE (form 2; `cast.kind 'wheel'`; while
it flies `d.glaiveOut` and he starts no blade move; its cues carry `bullet`), the ORBIT (form 3), the
STARLESS SKY as weather (form 4, `TUNING.weather`: called in his moves' pauses, never in the hero's
opening), STARLESS NIGHT (form 4's great spell, `cast.kind 'night'`, `TUNING.night`; `nightLive`: while
its waves run `weigh` gives 0 to every move that asks a guard). Attack names (`SPELL_ATTACK`):
'wheelingBlade', 'starlessSky', 'starlessNight' (the last two are hazards). Two streams of its own
(`rand` gameplay, `lr` looks). `terrain.js` (`LordTerrain`) gains `rupture` (`plateRupture`: plates burst
up along a line; `_ruptDelay` clears every plate that may cue in one go) and `halo` (`plateHalo`: a ring
of plates dropped on the hero), both on `destructibles.floorNear`; Void Hurl and Glass Rain take floor
plates once the hanging stones are spent; a thrown piece shows nothing where it lands. `fx.js`
(`LordFx`) gains `gather(kind, hand, k, dt)`, `presence(form, dt)`, `igniteGather(x, z, k, dt, form)`,
`deathBurst(x, y, z)`, `unravel(segs, n, k, dt)`, `look(name)`, `igniteNova(x, z, r, form = 2)`; its big
shocks go through `DuelFx.shock` (`kind: 'void'`), its vents from `THRONE.vents`, and every drawing
method is wrapped onto its own stream (`DRAW_METHODS`) so `fx.rand` stays the gameplay stream. On its
way home the returning blade asks `brain.fairDelay(home, tell, TUNING.glaive.homeWait, 'glaive')` at its
turn: a positive delay hangs it longer, -1 brings it home uncued and harmless. A white or blue blow out
of a blink meets a guard from any side. `look.js` `dressFrame` (`dress`: `?lordLook=b`, dressed by
form), `bodyArt.js` (`?lordLook=a|c`).

**His gear** (gear.js, ADR-084): `lord.*` items registered into the hero's gear registry: `lord.hood`
(a deep hood over a faceplate with one slit of red light: `HOOD_RINGS`; `hidesHair`, `shadowsFace`;
the owner's pick of three heads), `lord.plate` (cuirass, gorget, the sigil), `lord.yoke` (a plate yoke on the chest
joint, a pauldron on each upper arm), `lord.arms`, `lord.legs` (the Wanderer's boots under cuisses),
`lord.skirt` (hip plates; `LORD_PANELS` on the coat springs), `lord.cape` (`LORD_CAPE`: five sheets
on the streamer springs), `lord.saber`. `LORD_LOADOUT` is what he wears; `TUNING.scale` 1.32.
Four stances (poses.js `GUARDS`, one pose set each; the animator's pilot carries `form`) and
`glidePose` (the animator key `glide`); reaction clips are compiled per form (`CLIPS_BY_FORM`, the
brain's `C`). Moves (moves.js): `weight` is per FORM `[1, 2, 3, 4]`; a string's cuts alternate the
driving foot (`cut(.., { step: 'L' })`), a spin carries the feet round with the body (`spinFeet`),
`cut('aerial')` is a cartwheel, `parting()` a backflip, and a main string ends in its form's
`FLOURISH` (`recoveryKeys`). His own beat fields: `bolt` (Void lightning: a long line zone from the
casting hand; a perfect parry returns it: `dragon:returned`, damage + posture to him), `pull` (the
hit's `from` is put on the hero's far side: he is dragged in), `grip` (the Crushing Dark: a red line
from his hand; a hit is `kind: 'grip'`, a knockdown, and `fx.gripCrush` where the hero lies), `blink:
{ behind }` (he reappears behind the hero as the windup starts), `left` (the off-hand blade cuts),
`release: { style: 'push' | 'crescent' | 'rift', count, spread, speed, from }`, `cast: { kind:
'glaive' | 'debris' | 'storm' | 'star' | 'wheel' | 'night', orbit, after }` (ADR-122: `wheel` the wheeling
blade, `night` Starless Night, `orbit: true` torn stones that turn round him and fly into the string's
gaps, `after` s before what is cast goes), `catch` (ADR-122: the beat his thrown blade comes home on: no
hit). fx.js `LordFx extends DuelFx`: the blades' glow and red
light, lightning (`lightning`, `arc`, `crackle`), the push's wall and burst, the pull's vortex, the
grip (`gripClaw`, `gripSnap`, `gripCrush`), thrown things (`throwShot`: the blade that returns, torn
stone that turns round him until thrown; each cues itself flashLead before it reaches the hero, or
fizzles; the Rift's fissures are crescents with `style: 'rift'`), marked ground (`callStrike(x, z,
r, warn, { style: 'bolt' | 'star', drift })`: a red ground ring, then called lightning or the Dark
Star's burst; a star follows the hero until its cue), `glideWake`, the aura, `afterimage` and the
blink, the ignition. The intro: seated at
`CONFIG.world.dragonSleep` with the root raised to the seat (`TUNING.intro`), he rises, the blade
ignites and he leaps to the seal; a skipped intro puts him where the leap lands.

### Tian Lei, the Last Ascendant — `src/entities/enemies/ascendant/ascendant.js` exports `class Ascendant` (ADR-129)
A `Duelist` with `ASC_KIT`; COMBAT.md → "Tian Lei, the Last Ascendant" has the fight. Bare-handed: no
weapon, three forms with a bar each (the Lord's `lives` structure), ki (blasts, a disc, bolts, called
strikes, beams) and moves on the ring's tiles. The kit: `{ id: 'ascendant', TUNING, MOVES, MOVE_NAMES,
CLIP, realise, transitions: { 2: 'ascend2', 3: 'ascend3' }, counterMove(form) → one of the form's
`COUNTER_LISTS` (moves.js; riposte / riposte2 / riposte3 and the third wave's, drawn on the AI's stream),
streakMove(form) → streakFlurry / 2 / 3, maxPhase: 3, loadout: ASC_LOADOUT, poses, blade: FIST,
scale: TUNING.scale, dress: dressAscendant, letters }` (`letters`: a getter, `?ascLetters=a`: his ink-line
letters follow his size, "The bosses' letters"; ADR-155) (`poses`: `loco` = his form's footwork plus the dash's lean
by `pilot.dashK`; `duel` = his form's clip plus the feet planner's offsets). The boss slot's surface, plus:
```
kind = 'duelist';  name = 'TIAN LEI, THE LAST ASCENDANT';  phase 1..3 = his FORM;  execRange = 3.4
lives: { total: 3, left }        // the forms still to beat (this one included); hp / maxHp = this form's bar (2000)
dressPhase: 1..3                 // the form his body SHOWS (hair, light, aura): the old form through a
                                 // transformation's windup, the new one from its nova (onImpact); dressAscendant
                                 // and fx.formAura read it
_changing                        // from a deathblow until the transformation's ring goes out: takeHit returns 0
_onHpZero()                      // an empty bar BREAKS him (no death)
onExecute({ damage })            // the DEATHBLOW: 'dragon:plunged {execution, deathblow, form}', fx.deathblowBurst;
                                 // forms 1-2: react 'executed', then pendingPhase: kit.transitions[form + 1]
                                 // (enterPhase: a full bar); form 3: he dies
endBreak()                       // a break nobody answered: posture.spared of the bar back (if empty), half the meter
addPosture(n)                    // × lerp(posture.gainByHp) by the bar's missing fraction; regen × posture.regenByHp
_strikePart()                    // the limb his "blade" is now: the running beat's `part` (fistR when it has
                                 // none; not in a transformation), the blocking forearm of a guard (fistL; fistR
                                 // for wardR; fistL in footwork with the ward raised past 0.5), else fistR
_limbSeg(part, a, b)             // limb `part` as drawn now, root a → end b (world): fistR / palms (forearm →
                                 // knuckles), fistL, footR / footL (shin → foot), kneeR / kneeL (thigh → knee),
                                 // elbowR / elbowL (upper arm → elbow), shoulder (chest → left upper arm), feet
tellPoint(part, out)             // where a beat's glint pops: that limb's end (palms: between both fists)
_drawnPoints() / _poseAt(t)      // the engine's hilt → tip ARE the striking limb (what the parry, the trade, the
                                 // lock and the trails read); a new limb starts its trail fresh
_hand                            // the right palm as drawn, every frame (a disc homes to it; the ledger reads it)
blinkTo(x, z, face)              // gone from where he stands, at (x, z) facing the point `face`: fx.vanish,
                                 // anim.teleported()
onShotReturned(s)                // a returnable blast came back off a perfect parry and reached him (fx.js) →
                                 // ki.shots.returned(s)
onShotBack(s)                    // his disc is home in his hand (fx.js) → ki.shots.discBack(s)
_beamBars(def)                   // a beam of his is lit (busy, phase not 'fade') and the move has a blow that asks
                                 // a GUARD: weigh → 0 and onActStart → false (a transformation is exempt)
zoneCentre(z, out)               // the centre of a zone (its fwd / side)
ki                               // KiMoves (ki.js): shots (ShotMoves), beams (BeamMoves); made at the first reset
terrain                          // TerrainMoves (terrain.js); made at the first reset
debug.setForm(n)                 // the Lab: straight to form n (a full bar, nothing changing, 'dragon:phase<n>' for
                                 // n > 1); debug.form (getter). The rest: the Dragon shape, as the Lord's
```
**His brain** (`AscBrain extends DuelBrain`, in ascendant.js): reaction clips per form (`C` reads
`CLIPS_BY_FORM[phase - 1]`), a blow out of a `blink` reaches wherever the hero is (`_reach` Infinity),
and two kinds of footwork before the engine's: **the dash** (`TUNING.dash { from: 2, at: 5.5, speed: 16,
stop: 2.4, every: 2.2, max: 9 }`: from form 2, past `at` m, straight at the hero at `speed` until `stop` m
short, `fx.dashGhost` where he started, `pilot.dashK` for the pose) and **the closing blink**
(`TUNING.closeBlink { form: 3, far: 9, r: 2.4, chance: 0.5, every: 4 }`: `blinkTo` `r` m from the hero; the
roll is the AI's `Math.random`). Neither while a phase change waits, a counter is pending or the hero drinks.
His feet: `_planFeet(dt)` (Duelists above, "His feet").

**THE ROUTING CONTRACT** (the comment at the top of ascendant.js). A beat is ROUTED to `d.ki` when it, or
its move, is marked `ki: '<kind>'`, and to `d.terrain` when it or its move is marked `terrain: '<kind>'`
(the beat's own mark first, then the move's; `terrain` before `ki` at the same level: `_route(b, a)`).
Every engine hook of a routed beat goes to that object:
```
onActStart(act, opts)    → X.begin(act, opts)       false: the move does not start (nothing changed)
weigh(name, def, w, d)   → X.weigh(def, w, dist)    (a move marked at the MOVE level only)
onImpact(b, s, act)      → X.onImpact(b, s, act)    the impact's first frame, before the zone test
onRelease(b, s, act)     → X.onRelease(b, s, act)   (an unmarked `release` beat goes to d.ki)
onCast(b, s, act)        → X.onCast(b, s, act)      (an unmarked `cast` beat goes to d.ki)
beatMotion(b, u, s, dt)  → X.motion(b, u, s, dt)    every frame of the beat, after his own blink
onSustain(b, s, act, k)  → X.onSustain(...)         a `sustain` beat's ticks (an unmarked one → d.ki)
hitPlayer(o) → r         → X.onHit(o, r)            after the hero answered a routed beat's blow
```
and, for both objects whatever the beat: `reset()` at each of his resets, `frame(dt)` every frame after
the brain (`brainFrame`), `busy` (something still in the air or lit), `lockEnd(won)` → true when it
handled a lock it started (else the duelist's own `onLockEnd` runs). **`ki.js` `KiMoves`** hands each hook
on by the KIND's name: a kind that starts with `'beam'` (`beam`, `beamSweep`, `beamTwin`, `beamGreat`) →
`kiBeam.js` `BeamMoves` (`ki.beams`); every other kind (`blast`, `rain`, `disc`, `bolt`, `volley`,
`cage`) → `kiShots.js` `ShotMoves` (`ki.shots`); an unmarked `release` / `cast` beat → the shots, an
unmarked `sustain` beat → the beams; `reset`, `frame`, `busy` and `lockEnd` reach both. A `terrain:`
kind (`tileKick`, `ringBreaker`, `stoneStorm`) → `terrain.js` `TerrainMoves`. His melee beats are not
routed: their hooks are handled in the class (the blink; a red or knockdown ring beat → `fx.crater` +
`terrain.crater`; a `burst` beat → `fx.auraBurst`; a beat's `quake` → `terrain.quake(x, z, quake)`; a
transformation's impact → `fx.transformNova`, `terrain.nova`, form 3 `ki.shots.corners()`, shake,
`ambience.flare(1)`). `hitPlayer` also gives a blow out of a blink `extra.around` (a guard meets it from
any side) and a bolt (`ki: 'bolt'` or `bolt`) `kind: 'lightning'`. `afterPose`: `fx.formAura` (from
`dressPhase`), `fx.limbTrail` off the striking limb through an unrouted blow, `fx.transformGather` through a
transformation's windup, the stars of a break. `brainFrame` also counts how long the hero has hugged him
(within 2.6 m): past 4 s a `burst` move (Aura Burst) weighs × 3.

**The moves are data** (`moves.js`: `MOVES = { ...meleeMoves(X), ...kiMoves(X), ...terrainMoves(X) }`,
`MOVE_NAMES`, `STREAKS`, `TRANSITIONS`, `COUNTERS` (each form's first counter) and `COUNTER_LISTS` (every
counter of each form, the third wave: `[['riposte', 'riposteKnee'], ['riposte2', 'riposteVanish'],
['riposte3', 'riposteBolt']]`), `CLIPS` / `CLIPS_BY_FORM` / `CLIP`, `realise`). **The third wave's data**
(2026-11-22; `moves/melee.js`): `signKeys(X, { coil, hit, after, keys, cock = 0.76, left })` prepends the
SIGN (the hand rising at u 0.18, two fingers at the brow at u 0.5) to a strike's keys, for a beat with
`blink: { ..., sign: true }`; a sign beat carries `close: 0` and a short `dash` into reach after the
arrival (`TUNING.sign`: behind 2 m, a side at 1.5 rad / 2.2 m, a step of 1.6 m from u 0.55, a riposte's
hop back 1.5 m). A counter stance is a feint beat `{ tell N, windup 0.45 fixed, hold [0.2, 0.4], stance:
{ from 0.3, open 0.6 }, part 'palms' }` (`TUNING.stance`) followed by its punish beats (Still Water,
Golden Mirror, Thunder Mirror; `cat 'single'`). Thunder Mirror's and riposteBolt's bolt is a `ki: 'bolt'`
line beat built in melee.js. A move
file is a function `(X) => ({ name: move })` of the frozen builders object `X` (no import of moves.js: no
cycle): `moves/melee.js`, `moves/ki.js` (joins `moves/kiShots.js` and `moves/kiBeam.js`),
`moves/terrain.js`. `X = { TELL: { N, B, R, K }, TUNING, W, F, mirror, strikeKeys, follow, rotXZ, punch,
kick, elbow, shoulder, transform, feet: { OR, OR_IN, PIVOT, LOW, LUNGE, SOUTH }, HANDS, FIST_UP, FIST_FLAT,
ANK, TAU }`. The builders (each returns one beat, its keys a coil, the strike and a follow-through:
`strikeKeys({ coil, hit, after, pre, cock, left })`):
- `punch(kind, tell, windup, damage, o)`: `jab` (fistL) · `cross` · `hook` · `uppercut` · `backfist` ·
  `palm` · `double` · `hammer` (active 0.12; the others 0.08); a fist sector 1.7 m; knock-back 0.7 m a
  white blow, else 1.5.
- `kick(kind, tell, windup, damage, o)`: `front` · `side` (a sector round the heel: `fwd` 0.95) · `round` ·
  `sweep` (a ring 2.2 m, active 0.22, `sweep: true`) · `axe` (a ring 2.6 m, `fwd` 0.6) · `flying` (a line
  2.2 m, `air: true`, `lift` up through the windup) · `knee` (kneeR, `fwd` 0.4); a kick 2.1 m.
- `elbow(tell, windup, damage, o)` (the dash elbow: a line 2.2 × 0.8 m), `shoulder(tell, windup, damage,
  o)` (a line 2.2 × 1.0 m), `transform(form)` (ascend2 / ascend3: a `transition`, R 2.3 s `fixed`, a ring
  6.5 m, 12, knockback 7, `part: 'feet'`; compiled round the NEW form's stance).
- `o`: `left` (the mirror image: the other limb and its `part`), `cock`, `step: 'L'` (the strike drives off
  the left foot: a string walks), and any beat field (overrides).
`realise(name, phase, rnd, opts)` compiles a move round the stance of the form it is used in (one
realiser per form, `FORM_POSES`; ADR-126's `completeBeat`). His beat fields besides the engine's:
`part` (fistR, fistL, footR, footL, kneeR, kneeL, elbowR, elbowL, palms, shoulder, feet), `blink` (below),
`ki`, `terrain`, `burst` (his aura's ring: `fx.auraBurst`), `quake` (`{ from, to, speed, damage }` →
`terrain.quake` at the impact), `beam: { kind, side, cup }` (kiBeam.js; `cup` (ADR-150): the charge, the sighting thread and the beam's origin at `palms`, the light between them `fx.cupCharge(x, y, z, u, dt, form)`; every beam under `?ascBeamPose=cup`, read once in `moves/kiBeam.js` as `BEAM_POSE`, and always Instant Wave's: kind `instant`, a beam beat out of a signed blink to the hero's side, `blink: { at, r, sign, signAt }`, the charge from the arrival), `bolt`-kind beats (`ki: 'bolt'`),
`dive` (the volley's landing, kiShots.js); `sweep`, `launch` and `rush` are labels no code reads (a test
reads `sweep`). **The blink** (`beatMotion`, once at u 0.1 of the windup; then a routed beat's motion):
`{ behind: m }` (behind the hero by his facing, else to one side, then the other), `{ land: true, side }`
(beside where the hero's knock-back will end, on the side he came from: `_slideEnd`), `{ edge: true, pad }`
(at the ring's edge farthest from the hero, `pad` 1.2 m inside his bound: the great beam), `{ at: rad, r }`
(at a side of the hero: `at` rad round from his facing, 0 before him, PI behind; Mirage). **The sign**
(the third wave): `sign: true` on any of them delays the vanish to u 0.5 of the windup (`signAt`); the
beat's keys up to there show two fingers raised to his brow (`moves/melee.js` `signKeys`), and the moment
he goes `fx.signSnap` flashes at the right hand (`tellPoint('fistR')`), then the usual `vanish`.

**`ShotMoves`** (`kiShots.js`, `d.ki.shots`; numbers `TUNING.shots`, `tuningShots.js`): `begin` (false for
a second disc, rain or volley while one runs), `weigh`, `onRelease` (the blasts leave the striking palm:
`release { count, spread, speed, size, radius, returnable, from }` → `fx.throwShot({ kind: 'blast', ... })`),
`onCast` (`cast.kind` 'rain' Golden Rain, 'disc' Sun Wheel, 'volley' Heaven's Volley, 'cage' Storm Cage),
`onImpact` (a bolt's lightning, `dragon:explosion`; the volley's dive: crater, burst, `world.impact`,
`ambience.flare(0.6)`, `dragon:land`), `motion` (the dive steered to the hero, fixed at u 0.7), `onHit`
(a bolt perfectly parried: 50 damage, 34 posture to him, `dragon:returned` kind 1), `frame` (the rain, the
volley's strikes, the weather Thunderfall in form 3 (at most 2 live; never while a beam is lit, in his
reactions, a break or a transformation), the corner bolts), `busy`, `reset`, `stats`. Public:
`returned(s)` (a returned blast reached him: 50 damage, 34 posture, `dragon:returned` kind 2), `discBack(s)`
(the disc caught), `corners()` (ascend3's four bolts on `RING.corners`, 0.12 s apart: a called strike with
its cue on a hero standing within 2.4 m of one, else a harmless bolt). **The third wave** (2026-11-22):
`cast.kind` 'lantern' (Heaven's Lantern: `begin` tells the ledger the orb's arrival and retimes it through
the gather, `motion` draws `fx.lanternGather` over his palms and dims the ring, `onCast` throws one
'blast' record with `lantern: true` (size 4.5, radius 2, speed 10, `y` 3.6 falling to `yTo` 1.3 at the
hero: `fx._flyBlast`'s linear fall), aimed `lead` s ahead of the hero, never homing; `lanternMet(s, r)`
(fx.js calls it with the hero's RESULT): a block or a plain parry bursts it on the guard (`lanternBurst`
'guard', a crater), a roll lets it pass to burst on the floor, a PERFECT parry starts THE PUSH
(`_startPush`: `brain.startLock` at range with `T.lantern.push`, the orb held on the blade and drawn by
`fx.lanternClash`); `lockEnd(won)`: won = `s.returned = true` (fx.js's return path flies it into his
chest: `returned(s)` deals `returnDamage` 120 / `returnPosture` 220 and he reels `reel` 3 s), lost = 40,
knockdown, thrown 10 m, a crater; `lanternOut` (the class weighs every other move 0 while it is out, and
the weather stands down) and 'barrage' (Raining Suns: `_startRain` generalised with options `aim 'hero'`,
`air`, `yTo`, `lead`, `scatter`, `direct`, `side`: sixteen blasts poured from the alternating palms 3 m
up, falling onto the hero, every `direct`-th on him; then a `release` with `air` / `yTo`, the finisher).
Blast records gained `yTo` / `y0` / `yLen` (a fall over the flight) and `lantern`; every old blast flies
as before. Its game rolls come from its own
seeded stream (`rand`, reseeded at each reset). What is planned but not yet thrown or called is told to
the ledger (`brain.expect`), and each throw or call asks `brain.fairDelay` first.

**`BeamMoves`** (`kiBeam.js`, `d.ki.beams`; numbers `TUNING.beam`, `tuningBeam.js`; the moves
`moves/kiBeam.js`). A beam beat: a `line` zone the beam's size, `sustain { dur: lit - active, tick }`,
`selfHit`, `fixed`, `track: 0`, `close: 0`, `hazard`, `cock` 0.9, `beam: { kind: 'rising' | 'sweep' |
'twin' | 'great', side: 'R' | 'L' | 'both' }`. `motion` through the windup: he aims (the twin's second palm
leads the hero by `twin.lead` s) until `fix` of it, then the line is FIXED and `fxBeam.js` `drawSight`
runs a thread from the lead hand along it; `fx.beamCharge` in the drawn-back palm; the great beam also
`fx.transformGather`, `ambience.dim(k)`, `cameraRig.keep` and `flow.cinematic({ kind: 'greatBeam' })`.
`onImpact` lights the beam: its state `B` lives on its own (it survives the move ending into the clash),
`dragon:spell`, `fx.muzzle`, the great one `ambience.flare(1)`. `frame` (lit): the strip from the palm
along his facing (the drawn line ends at a butte on it within `reach`, or at the hero's raised guard:
`fx.beamSplash`); the FIRST CONTACT in the 0.1 s active window (`d.hitPlayer({ projectile: true, kind:
'beam', knockdown, parryable: great, flare: great })`), then a TICK every `tick` 0.18 s on a hero still in
it and not knocked down (dealt in parts under the player's stagger floor); a held guard facing him pays
guard only (`player.streamBlock`; `player:block` at most every 0.4 s); the sweep / great beam turns his
facing toward the hero's side (`turn` deg/s up to `arc`, one way); the world every 0.2 s
(`destructibles.sweep` power 1.5 along it and carried on to `world.carry` 45 m, `world.impact` trench
stations every 1.4 m, `world.ignite` off the ring). Then the fade. **THE CLASH**: a perfect parry of the
great beam's head → `brain.startLock({ start, push, decay, dur, hold, dist (where they stand), camera:
{ zoom (framing both), weight: 1 } })` and the held two-palm clip (`MOVES.heavenTide.clashPose`, compiled
per form); each frame `fx.beam` to the hero's blade and `fx.beamClash` with the lock's meter. `lockEnd(won)`:
won → `fx.beamSplit`, `addPosture(TUNING.lock.posture × clash.posture)`, hitstop, the 'bladeLock'
cinematic, `ambience.flare(1)`, `dragon:stagger`, react 'reeling' held `clash.reel` s; lost → 40 damage,
knockdown, thrown 12 m along it (unblockable). A plain parry of the head is held as a block. Surface:
`busy` (lit, held in the clash or fading), `phase` ('off' | 'lit' | 'clash' | 'split' | 'surge' | 'fade'),
`stats`, `B`. `weigh`: the great beam gets 0 before `great.from` 14 s into form 3 and within `great.every`
35 s of the last, then × 2. `begin` refuses while a beam is lit or clashing. The sweep's side: toward the
hero; on the line, the way he is moving across it; standing still on it, the AI's `Math.random`.

**`TerrainMoves`** (`terrain.js`, `d.terrain`; numbers `TUNING.terrain`, `tuningTerrain.js`; the moves
`moves/terrain.js`: every beat a `cast` with `selfCue`). `weigh` / `begin` find the tiles
(`destructibles.floorNear(.., { kind: 'tile' })`: 0 / false with none), `motion` (the stamp, the aura
lifting tiles), `onImpact` (Ring Breaker's fists into the floor), `onCast` (`tileKick`, `ringBreaker`,
`stormThrow`, `stormGreat`: `take` / `carry` / `throwTo` with his own blow on landing), `frame`, `busy`,
`reset`. Three hooks the class calls: `quake(x, z, { from, to, speed, damage, knockback, attack })` → true
when a front left (Heavenfall's landing: the tiles within `quake.shatter` 6 m break, a crater, a front runs
out from `from` to `to` m at `speed`, cracking each tile it crosses and striking the hero ONCE as it
reaches him, red, its cue `flashLead` before; a hero inside `from` at the landing is the leap's own blow),
`nova(x, z, r)` → tiles hit (a transformation's ring: tiles within r crack, within `nova.breakR` 2.2 m
break), `crater(x, z, r, k = 1)` → rubble piles (a heavy blow's crater: `world.wreck.rubble` round it, by
weight; none under `crater.minK` 0.8). Its cues: `combat:tell` / `combat:flash` with hazard (the quake,
Ring Breaker's tiles) and a thrown tile's flash on the tile (`flare: true`). Two streams of its own (`_g`
gameplay, `_l` looks); its record names keep clear of the cue ledger's courtyard / crater readers.

**The tuning files.** `tuning.js` `TUNING` (forms 3, hp 2000 a form, `phaseAt` [1], radius 0.42, `scale`
PLAYER_SCALE × 1.12, bound 16, `flashLead` 0.26, `windupScale` [1, 0.93, 0.86], `recoveryScale` [0.9,
0.82, 0.74], `reach { fist: 1.7, kick: 2.1, line: 2.2, lineW: 0.8 }`, `posture`, `guard`, `lock`,
`mikiri`, `move`, `dash`, `closeBlink`, `idleGap`, `openingGap`, `chain`, `pressure`, `airFall { g: 30 }`,
`transform { windup: 2.3, ringRadius: 6.5, damage: 12, knockback: 7 }`, `crescent` (LordFx's pools need
one), `world { blast: 0.8, bigBlast: 1.4, disc: 0.6 }` (what his blasts and disc do to the world: fx.js
reads them first, `ASC_WORLD` the fallback), `damageScale` 1.1, `execution`, `wakeRadius` 9) spreads in
`shots` (`tuningShots.js` `SHOTS_TUNING`: `blast`, `spirit`, `scatter`, `dance`, `rain`, `disc`, `bolt`,
`volley`, `cage`, `weather`, `corners`, `world`), `beam` (`tuningBeam.js` `BEAM_TUNING`: `tick`, `active`,
`rising`, `sweep`, `twin`, `great`, `clash`, `world`, `look`) and `terrain` (`tuningTerrain.js`
`TERRAIN_TUNING`: `tileKick`, `ringBreaker`, `stoneStorm`, `quake`, `nova`, `crater`). `links.js` `LINKS`
(read through the `LINKS` getter; shared lists `PURSUE`, `CLOSE`, `AFTER_RED` after a red thing of his,
`AFTER_VOLLEY` after his volleys at range, `AFTER_BEAM` after a beam; COMBAT.md).

**His gear and look.** `gear.js` registers `asc.head` (`hidesHair`; the hair of every form), `asc.chest`,
`asc.arms`, `asc.legs`, `asc.waist` into the hero's gear registry (`ASC_ITEMS`); `ASC_LOADOUT` (no
`weapon`: the right fist hangs on the sword joint), `FIST = { guard: -0.06, tip: 0.075 }` (the kit's blade
before his limbs take over). Built by `buildHero(U, ASC_LOADOUT)`, the hero's skeleton, the hero's ink-line
art. Every piece that changes with his form is kept out of the static merge and registered with the forms
it shows in (`look.js` `at(D, m, from, to)` on the rig's `userData.dress`). `look.js`: `ascLookNow()` →
`{ base: 'a' | 'c' | 'h' | 'g' | 'v' | 'k', tint, art, id, homage }` (`?ascLook=`, read when the rig is
built; d = outfit a through the wyrm's art path, `bodyArt.js` `ASC_ART`; `KUNG_LOOKS` e / r / w = base `k`,
the gi with wraps, tinted e / r / w, ADR-155), `ASC_TINT` (per `tint`, his material instances' fills),
`ASC_LIFT` (`fill` multipliers per part and `rim` × 3.2 on `rimOn`: his figure lifted off the floor;
`?ascLift=0` = as the body shipped) and `ASC_QUIET` (`?ascLift=b`, the owner's pick: the hero's quieter
print, the skin × 0.62, rim × 1.5), `ascLettersOn()` (the kit's `letters`), `tintAscendant(M)` (the
class's `_tint`: the fills, the lift, the light's ink),
`dressAscendant(d, dt)` (the kit's `dress`: on a change of `d.dressPhase` it flips the pieces' `visible`
flags and writes the gold hair's, the wraps' and the light's colours; then the gold breathes, a few
uniforms a frame; no allocation). His materials: `coat` / `lining` the tunic, `leather` the sash, `hem` the
wraps, `pants`, `collar` the boots, `skin`, `shirt` his DARK hair (form 1), `hair` / `hairTip` his GOLD hair
(forms 2 – 3), `flask` the light at his edges, fists and eyes. Three stances (`poses.js` `GUARDS`,
`FORM_POSES`, `formPoses(form)`, `FIST_UP`, `FIST_FLAT`; the animator's pilot carries `form`).

**His effects** (`fx.js` `class AscFx extends LordFx`; STYLE.md "Tian Lei's effects"). The constructor
swaps the fire field's void slot for `FIRE_PALETTES.gold` (here `K_VOID` IS GOLD), grows the pools
(`shots` 24, `strikes` 12), and hands its draws a game whose `world.scorch.burnCircle` keeps 12 % of the
heat (his energy chars, it leaves no glow). Every drawing method runs on LordFx's private drawing stream
(`ASC_DRAW`); the inherited draws' violet lights and glyphs are turned gold (storm white while lightning
draws). Exports `ASC_LOOKS` (`ascAura`, `ascBeam`), `ASC_WORLD`, `hash`. Positions are world metres,
`form` 1..3; a method with `dt` is called every frame while its thing lasts, the others once:
```
formAura(d, dt, form)                       forms 2-3: gold heat standing round him, spawned BEHIND him as the
                                            camera sees him (?ascAura=a|b|c); form 3 lightning crawling over him
limbTrail(ax, ay, az, bx, by, bz, form, heavy)   a blow's trail off the limb's point (form 1 a pale smear)
muzzle(x, y, z, dx, dz, k = 1, form = 1)    a palm's flash as a blast leaves it (a disc of light, strokes, sparks)
beamCharge(x, y, z, u, dt, form = 1)        light gathering in the drawn-back palm through a beam's windup
beam(ax, ay, az, bx, by, bz, w, k, dt, form = 1)  the lit beam a → b, `w` m wide, k 0..1 (?ascBeam=a|b)
beamSplash(x, y, z, k, dt, form = 1)        where the beam ends on something (the floor, a butte, a guard)
beamClash(x, y, z, dx, dz, k, dt, form = 3) the head grinding on the hero's blade; k the lock's meter
beamSplit(x, y, z, dx, dz, len, form = 3)   the clash won: the beam split round the blade (once, or every frame)
vanish(d, x0, z0, x1, z1, form = 1)         the blink: the shape he leaves, the streak, a puff at each end
signSnap(x, y, z, form = 1)                 the sign's snap at the fingers on his brow as he goes (once)
stanceGlow(d, dt, form = 1)                 a counter stance: light drawn into both open palms (every frame catching)
dashGhost(d, form = 1)                      the afterimage a dash leaves
auraBurst(x, z, r, form = 2)                a shock ring out of his body to r m (Aura Burst, a landing)
crater(x, z, r, k = 1)                      a heavy blow on the floor: dust, chips, lit cracks (draws only)
transformGather(x, z, u, dt, form = 2)      a transformation's windup (u 0..1): energy drawn in, stones lifting
transformNova(x, z, r, form = 2)            the new form: a pillar of light 9 m (form 3: 12 m) ~0.9 s, a shock ring
throwShot(o)                                LordFx's pool; his kinds 'blast' and 'disc' (below)
callStrike(x, z, r, warn, { style: 'bolt', damage, knockback, attack })   called lightning (LordFx's)
lightning(ax, ay, az, bx, by, bz, k, lit, gold)   LordFx's, its light and sparks storm white
```
`fxBeam.js` draws the beam (`drawBeam`, `drawBeamCharge`, `drawBeamSplash`, `drawBeamClash`, `drawSplit`,
`drawSight`). **His thrown kinds** (the record's ledger fields keep their meaning: `alive, done, flashed,
phase, x, z, dx, dz, speed, back, wait, radius, delay, age, tell, attack`; dx / dz are the way it flies
NOW): `'blast'` `{ x, y = 1.1, z, dx, dz, speed, radius = 0.5, life = 2.5, range = 22 (then it drops and
bursts), size (1; the Spirit Shot 1.4, Golden Rain 0.8), tell, damage, knockback, attack, delay (s it hangs
charging, then flies at the hero), returnable, returned, hitKind }`: it cues itself `flashLead` before
contact (`combat:flash` hazard + bullet) or fizzles under 0.2 s; cover stops it (`destructibles.stop`); a
parry bursts it; a PERFECT parry of a `returnable` one flies it back at his chest and calls
`d.onShotReturned?.(s)`. `'disc'` `{ speed, back, range = 12, curve (rad/s, + left), hang = 0.3, through =
true, radius = 0.7, life = 6, ... }`: out on its curve, a hang at the turn, home THROUGH where the hero was,
then to `d._hand`, `d.onShotBack?.(s)`; it cuts what it crosses (`destructibles.sweep`, `T.world.disc`); a
parry on the way out turns it home at once; at its turn it asks `brain.fairDelay(home, tell,
T.shots.disc.homeWait, 'disc')` (a longer hang, or home uncued and harmless). Added fields: `size,
returnable, returned, curve, hang, through, tx, tz, leg, path, form, seed, hitKind`.

### The Thousand-Body Fox — `src/entities/enemies/thousandFox/fox.js` exports `class ThousandFox` (ADR-147, ADR-154)
Wen Yao, a BARE-HANDED fighter on the duelist engine (2026-11-22: the owner's "a fist fighter, no
sword"): one health bar, three phases (`phaseAt` [1, 0.66,
0.33]); `FOX_KIT` (`id` 'thousandFox', `transitions` { 2: 'thousandBodies', 3: 'foxMantle' },
`counterMove` 'riposte', `streakMove` 'streakFlurry', `letters: true`: his ink-line letters follow his
size, see "The bosses' letters" below). No change to `duelist/*.js`: everything is a hook.
- **Files:** `fox.js` (the class, `FoxBrain`), `moves.js` (the moves as data in the Ash format; his own beat
  fields `swap`, `pack`, `spring: 'pile'`, `twin`, `lift`, `pearl: 'drive' | 'charge' | 'great'`, `mantle:
  'tail' | 'pounce'`, `verdict` and move fields `densityAs`, `hidden`, `copy`, `verdict`: its header;
  `ROUND_PACK`, `PEARL_PACK`, `roundBeats(n)`), `tuning.js` (Shen Hui's blocks plus `clones`, `pearl`,
  `mantle`, `world`, `crescent`, `verdict`), `tuningBeam.js` (`VERDICT`: the Howl), `poses.js` (`GUARD`,
  `FOX_POSES`), `links.js`, `clones.js` (`FoxClones`), `pearl.js` (`FoxPearl`), `beam.js` (`FoxHowl`),
  `spirit.js` (`FoxSpirit`: the Nine-Tailed Fox), `fx.js` (`FoxFx extends DuelFx`), `fxBeam.js` (the
  Howl's draw helpers), `gear.js` (`FOX_LOADOUT`: no weapon; `FOX_FIST` = kit.blade, the right fist on
  the sword joint), `bodyArt.js` (`FOX_ART` for the art-path outfits a - c, `FOX_INK` / `FOX_INK_RIM` per
  ink-line outfit d, h1 - h3), `look.js` (`FOX_LOOKS`, `foxLook(name)`, `foxLookNow()`, `tintFox(M, {
  pale })`, `dressFox`).
- **Bare hands (Tian Lei's way, ascendant.js, copied in fox.js):** his blows are Tian Lei's exported strike
  builders (`ascendant/moves.js` `X.punch / kick / elbow / strikeKeys`, authored round the same left-lead
  stance) and his reaction clips Tian Lei's `CLIPS`, compiled round his own `GUARD` (Tian Lei's loose
  second guard, the lead hand open, palm up). The engine's "blade" (hilt → tip: the parry, the trade, the
  lock, the trails) is the STRIKING LIMB of the moment: `_strikePart()` (the beat's `part`: fistR, fistL,
  palms, footR / L, kneeR / L, elbowR / L, feet), `_limbSeg(part, a, b)`, `tellPoint(part)` (during the
  Howl: the fox's jaws, `howl.cuePoint`), `_drawnPoints()`, `_poseAt(t)`; `palmPoint(out)` (over the open
  lead palm: the Pearl's spot).
- **The class:** `d.clones` (FoxClones), `d.pearl` (FoxPearl), `d.howl` (FoxHowl), `d.mantleK` (0..1,
  the mantle grown in), `d.tails` (phase 3's fox spirit: 1 as it wakes, `T.mantle.tails` 9 as his bar
  runs out; 3 when the Lab forces the mantle), `debug.pack(spec | moveName, o)` (a pack called now, out of
  any move: a move's pack by its name, or a spec), `debug.popAll()`, `debug.pearl()` (the Pearl now),
  `debug.mantle(on)` (on / off / null = by phase), `debug.liveClones()`, `debug.howl()` /
  `debug.howlState()` (beam.js). Hooks used: `_setup` (the pool, the Howl and its fox, the Lab's API,
  inside the base constructor), `_tint` / `_tintSelf`, `_makeFx`, `_makeBrain`, `reset` (he sits among
  four seated selves), `guarding` (down through the Pearl's charge), `weigh` (a pack move with no pack
  this phase: 0; another pack still out: x 0.15; the Howl by `howl.weigh`; `densityAs`), `onActStart` (a
  transition pops the selves, phase 3's burns them into him; the Pearl begins; the counter rolls "It was a
  copy" (`def.copy` per phase); the Howl's `onActStart`), `beatMotion` (a beat's `pack` called at its
  `at`, the Pearl's harrying pack capped clear of the drive; the copy's burst and drop behind the hero;
  the run to the Burial's pile and the spring off it; the helper shaping the drive; the twin; the lifters;
  the swap; a `verdict` beat → `howl.beatMotion`), `onImpact` (the drive's burst; the tail, the pounce and
  the black pearl on the world; a `verdict` beat → `howl.onImpact`), `onSustain` (the Howl's ticks),
  `onCast` (Pearl Rain's throw), `hitPlayer` (the drive's blow grows with the selves that fed it; a copy's
  counter is met by a guard from any side), `brainFrame` (the intro's tearing, the selves, the pearls, the
  Howl, the mantle's `world.ignite`), `afterPose` (the Pearl, the black pearl, the mantle, the selves'
  poses and spheres, the Howl's drawing), `takeHit` (a 'cloneN' part pops; a cut while he charges counts
  toward the interrupt), `_break` (every self pops, every pack is called off), `drawnPoint` (about the
  nearest body's root, a self's height included).
- **`FoxBrain extends DuelBrain`:** `_reach(b)` is Infinity for a `swap` beat; `_choose` takes
  `howl.forced()` first (the Howl forced once under `verdict.forceAt`); `startAct('foxRing')` passes
  `opts.selves` (the phase's `ROUND_PACK.n`) to the kit's `realise`, which realises the Round for that n
  (`roundBeats(n)`: the call, then his palm `gap` after the pack's last blow).
- **`FoxClones`** (`d.clones`; ADR-154): a self exists only inside a PACK or helping him. `list` (the
  pool, `T.clones.pool` 6 rigs: `{ i, rig, root, pilot, anim, lean, hs: [2 spheres], alive, state 'pack' |
  'assist' | 'lifting' | 'twin' | 'swapped' | 'seated' | 'dead', x, y, z, yaw, pack, blow, W, at, impact,
  until, handle }`), `packs` (three records), `pack(spec, { attack, phase, act, cap, shift })` → the pack
  or null (books every body: its mark round the hero by `form`, its appearing time = impact − its blow's
  windup, its impact; tells every cue to the ledger up front, `brain.expect`: one per body for
  `sequence`, ONE for `together`; shifted as a whole by `brain.fairDelay`, or refused; a `sequence` of
  `fullDeflect.minHits - 1` or more inside a move adds its blows to the move's `hits`), `packLive`, `live`,
  `alive(i)`, `free`, `feeding` (the selves feeding the Pearl: the helper + `fed`, the harrying bodies that
  struck and burst into it), `popAt(i, x, y, z, heavy, by)`, `popWithin(x, z, r, by)`, `popAll(by)` (also
  calls off the bodies not yet out), `burnAll()`, `nearest(x, z)`, `swapIn()` (a self dropped beside the
  hero, he trades places with it), `assist()`, `lift(until)`, `twin({ impactIn, damage, knockback, w,
  dash })`, `pile()` / `springOff(by)` (the Burial), `seat(n)` / `tearSeated(t)` / `seated` (the intro),
  `handPoint(i, out)` (the Pearl's thread; none from the twin), `setBlows({ dive, cross, upkick, slam })`
  (the hidden self-moves `paperDive` / `paperCross` / `paperUpkick` / `paperSlam`, realised once),
  `frame(dt)`, `pose(dt)` (a pack body every frame: it is out under a second; a helper every other),
  `stats`. A body's blow goes through `d.hitPlayer({ projectile: true, extra: { around: true } })`. Its
  rigs are plain hero rigs (`buildHero(U, FOX_LOADOUT)`, their own `HeroAnimator`, `installLean`,
  `batchRigid`), not shadow casters; a hero-side double can take one (ADR-148).
- **`FoxPearl`** (`d.pearl`): `kind` ('drive' | 'charge': the volley), `charging`, `flying`, `u` (the charge
  0..1), `selves` (`clones.feeding`), `shots` (three), `begin(act)`, `charge(b, u, dt)`, `struck(heavy)`
  → burst in his hand?, `interrupt()`, `cancel()`, `drive(b, s, act)` (the drive's burst), `bat(b, s, act)`
  (Pearl Rain's throw), `frame(dt)`; counts `landed`, `interrupts` (tests).
- **`FoxHowl`** (`d.howl`, beam.js; ADR-154): Heaven-Devouring Howl. Routed from fox.js for every beat or
  move with `verdict` (the contract in its header): `weigh`, `forced`, `onActStart`, `beatMotion`,
  `onImpact`, `onSustain`, `frame(dt)`, `pose(dt)`, `reset()`; `busy`, `phase` ('off' | the move's stage),
  `B` (the beam: origin, direction, lit), `stats`, `cuePoint(out)`. The move: a feint `flit` beat, then ONE
  red `beam` beat (`selfHit`, `sustain`) whose windup is the summoning and the charge; its recovery is the
  kneel (`recoverOpen: 1`). Its fox: `spirit.js` `FoxSpirit` (built in his constructor on a quiet
  Math.random, hidden; six art-path materials, batched; `place`, `show`, `frame(dt, state)`, `jawPoint`,
  `P` the points fxBeam.js draws from). The terrace's light: `world/foxTerrace.js` the set's `light`
  (`dim(k)`, `update(dt, game)`, `reset(game)`, `state`; stepped by the Howl). The camera: `cameraRig.hold(m, x, z, w)`
  (see the table above) and `cameraRig.keep` for the hero and the fox's head.
- **`FoxFx`** (`d.fx`): the surface in its header (`pearlCharge`, `pearlThread`, `pearlFly`,
  `pearlMark`, `pearlBurst`, `pearlFizzle`, `greatPearl`, `greatBurst`, `cloneSpawn`, `packPuff`,
  `clonePop`, `cloneBurn`, `mantle`, `tailSweep`, `pounceLand`), `sweep()` overridden (a bare-handed blow's
  short trail), and `phaseBurst(3, x, z)` (the mantle's change: a front of phase 3's fire and a column);
  `look` (`?foxfire=`, the orb's colour), `FOX` (the kind the orb is drawn as: K_VOID with
  `FIRE_PALETTES.pearl` / `foxfire` swapped in, K_FIRE for b, K_STEEL when phase 3 takes the void slot),
  `L` (the orb's non-heat colours), `look3` / `FIRE3` / `_front3` / `L3` (`?foxFire3=`: phase 3's fire,
  K_FIRE orange-red by default, b jade on the void slot). Audio: `audio.js` plays `sfx.js` `paperTear` on
  `dragon:clone` (softer for a spawn or `by: 'mantle'`) and `pearlWhirr` on `dragon:windup` of `foxPearl` /
  `twinPearl`. FoxFx reads `d._part`, `d.tails`, `d.mantleK`, `d.pearl.kind` / `flying`.
- **Look switches waiting for the owner:** `duelist/lookSwitch.js` `PENDING` (`foxLook`, `foxfire`,
  `clones`, `foxLetters`, `foxFire3`, `foxSpirit`): Lab LOOKS rows, deliberately not in `PICKED` (each
  draws its call site's default: `FOX_LOOKS`); duel.mjs FXLOOKS leaves them out of the picks' checks. A
  pick moves a switch from `PENDING` to `PICKED`.
- **The world** (`TUNING.world`, POWER): the blade's blows through the engine's `_worldBlow`; a pearl's
  burst 1.4, the black pearl 2.0, the pounce 1.0 (+ `world.ignite` 0.8), the tail 0.9; the mantle
  `world.ignite(x, z, 1.5, 0.5)` every 0.6 s; the tail's sweep `world.ignite` out to its ring + 1 m (0.8),
  the pounce at its landing and at the far end of its line. Fire never spreads (fire.js): the charm posts
  at 16.5 m only catch from the tail or the pounce when he fights at his bound (12.2). Every call
  guarded with `?.`.

### Lu Wusheng, the Sheathed — `src/entities/enemies/sheathed/sheathed.js` exports `class Sheathed` (ADR-144, ADR-145)
A `Duelist` with `SHEATHED_KIT`; COMBAT.md → "The Sheathed" has the fight. The kit: `{ id: 'sheathed', TUNING,
MOVES, MOVE_NAMES, CLIP, realise, transitions { 2: 'thumbWidth', 3: 'heldBreath' }, counterMove (phase < 3
'answer', else 'answerDraw'), streakMove () => 'leaves', loadout SHEATH_LOADOUT, poses SHEATH_POSES, blade
(MUTABLE: the live span by sheath state, gear.js BLADE_SPAN), OPEN ['caught'], REACT { caught } }`. Files:
tuning.js, moves.js, poses.js (his stance: the sheathed sword hanging low in his right hand, the left thumb in
the sash; `lsw` the scabbard at his left hip; `SHEATH_RUN` / `SHEATH_BREATH` (createDuelPoses opt.run /
opt.breath) and his own `duelLoco`, the duelist's sunk and pitched forward at a run; ADR-152), gear.js
(`sheath.*` items, `SHEATH_ART` per body (the wyrm's digits, `?sheathArt=0`), `buildOffSheath` → `{ root, hilt,
streamers }`, `SWORD_DIMS`, `STRIP` (mark a), `ROBE_TAILS`), look.js (ADR-152: `sheathLookNow`, `sheathArtNow` ('0' | '1' | '2' | '3' | 'a'), `sheathDigits`, `sheathTuned`,
`SHEATH_STEP`, `wandererDigits(base)` (the art sources of prints 1 and 2), `SHEATH_FLAT` (print 3 folds those
materials' aPart to 0 in `_setup`),
`sheathToneNow`, `sheathMarkNow` (all read when his rig is built), `SHEATH_TONE`, `SHEATH_MARK`, `SHEATH_LIFT`,
`tintWanderer(M)`: the Wanderer's fills and rim in the ink-line art, called by `_tint`), links.js, fx.js
(`SheathFx extends DuelFx`), lateCuts.js (`LateCuts`). Mark a's strip on the left-wrist piece: `_setup` appends
its two springs to `rig.streamers` and the animator's `streamState` (`_offStrip`); a change to 'drawn' kicks
them (the snap). Drawn only: no gameplay reads them.
```
name = 'LU WUSHENG, THE SHEATHED';  kind = 'duelist'
sheath: 'carry' | 'settled' | 'drawn'   // the sheath on the rig (below); 'dragon:sheath {state}' on a change
sheathParts { carry, drawn, blade, off, offHilt }   // the meshes it shows / hides (gear.js names them)
lethal                         // TUNING.draw.lethal at build; debug.lethal(on)
lastBlockedDraw                // his time of the last draw met on a held guard (the honor gate)
stats { draws, honorFeints, blocked, parried, landed, clicks, wakes }
late                           // LateCuts: cast(), frame(dt), busy, lines[], reset()
mayCue(beat) → bool            // the honor gate (brain.js `_honor`): a `draw` beat waits for a hero who can answer
onHonorFeint(act, beat)        // the gate gave up: the hand leaves the hilt (footwork)
onStopOn(act, beat, r)         // a draw blocked (lastBlockedDraw) or landed ended the move
hitPlayer(o)                   // a `draw` beat: damage maxHp x 1.5 (lethal) or draw.damage, unscaled, + breaksGuard
onParried(info)                // a parried draw: react 'caught' (draw.caught s) instead of 'recoil'
tellPoint('hilt')              // the scabbard's mouth (the draw's flare)
victoryNote()                  // 'YOU LEARNED ONE BREATH' after the fight that granted it (flow.js logs it)
debug.lethal(on), debug.sheath()
```
**The sheath.** `carry`: the sword item's `sheathCarry` meshes (the scabbard in the hand, the hilt behind
it); kit.blade = BLADE_SPAN.carry, so wards, sweeps, `bladeSegment` and the blunt blows work as for any
weapon. `settled`: a piece built by `buildOffSheath` hangs on `rig.body`, posed every frame at the left wrist
along the animator's `off` (the clip's `lsw`; eased); it shows the scabbard with its hilt; the right hand is
keyed onto the hilt (`arm` 0). `drawn`: `sheathDrawn` + `sheathBlade` show in the right hand, kit.blade =
BLADE_SPAN.drawn; the off piece shows the empty scabbard. `brainFrame` drives it from the beat
(`_sheathWant`: a `draw` / `bare` beat settled from `draw.grip` of its windup, drawn from its impact, a
chain's next draw re-sheathed a fifth into its windup; the recovery of a move that drew: drawn until
`draw.home`, settled until `draw.handOff`, then carry; a `settle` beat settled, never drawn; broken: drawn);
in footwork with the blade out it starts the manual move `resheathe` (a feint beat, the re-sheathe as its
recovery). The draw's cut: one key marked 'h' at u 1 (the cubic holds the cock, the next frame is the
follow-through), a dash from u 0.99 (the blink). His AFTERPOSE: a scabbard blow's trail is `woodSweep`
(dull wood), a bare blow's the steel sweep, the cock's `mouthGlint`, the wake's `hairline` until the click.
**The cut and the grove.** `onImpact` of a draw lays `_wake { ax..cz }` (the blade's part from his position
along the zone, the wake `T.world.wakeLen` beyond; A Thousand Li's from where his dash began, `pathHit`) and
draws `fx.drawLine`; The Held Breath lays `_ring`. `_onClick` (the sheath going drawn → settled, or the act
interrupted) sweeps `world.destructibles` along the blade's part (`T.world.draw`) and the wake (`wake`),
`kind 'cut'`, at `cutY`, leaves floor marks (`world.scars.ground`), and strikes every stalk within `ringR`
for the ring; all guarded with `?.`. A Thousand Li is `selfHit` + `pathHit`: `_pathHit` tests the hero
against the segment he crossed and calls `brain._stopOn` itself.
**The hanging cuts** (lateCuts.js): `cast()` marks 3 (4 under 18 % HP) lines `T.late.len` m across the hero
at spread angles, each placed by `brain.fairDelay` (or dropped) and told with `brain.expect` and a
`combat:tell` (hazard); `frame(dt)` draws them, flashes each `T.late.lead` before it cuts (`combat:flash`
hazard, red, at the point nearest the hero), cuts (`hitPlayer({ projectile: true })`, a world sweep).
Its gameplay stream is its own. **The set** (world/windlessGrove.js, ADR-145): `createWindlessGrove`,
`GROVE` (layout), `GROVE_LOOKS`, `groveOption()` (`?grove=a|b|c`, a reload); breakables: bamboo (range
pieces of the `bamboo` mesh, stumps in `bambooStumps`, all `light`), graveSword (light, prop), paving and
flagstone (world/floor.js), stele, lantern, boulder, post (light). Returns createForest's shape + `sky`,
`grass`, `scarInk`, `option`.
**Destruction's `light` def field** (ADR-145; destructibles.js): the record's `lightPiece`; its topple is
`quiet` whoever felled it and its landing does only the crumble and a soft `crash` (weight x 0.25): no ground
marks, gust, shake, domino sweep or blow on anyone. (The record's own `light` is a burning piece's point light.)
### Xin Yi, the One Who Woke — `src/entities/enemies/wokenOne/wokenOne.js` exports `class WokenOne` (ADR-156 – ADR-158)
A `Duelist` with `WOKEN_KIT`; COMBAT.md → "The One Who Woke" has the fight. The kit: `{ id: 'wokenOne', TUNING,
MOVES, MOVE_NAMES, CLIP, realise, transitions { 2: 'ironSeeds', 3: 'rising' }, counterMove (answer / answer2 /
answer3 by phase), streakMove (streakHands / 2 / 3), maxPhase 3, loadout ONE_LOADOUT, poses (per phase, and
phase 1's gear 2: poses.js posesOf(pilot.pset)), blade ONE_FIST, REACT { bend, stop }, OPEN ['bend'] }`. Files: tuning.js, moves.js
(Tian Lei's exported strike builders; MOVES_P1, the phase-1 copy with the left hand behind his back in every
key; CLIPS_BY_PHASE; `realise` with deja vu's REPLAY), poses.js (three guards), links.js, iron.js (`IronMoves`,
phase 2's guns), source.js (`SourceMoves`, phase 3), fx.js (`WokenFx extends AscFx`: LordFx's pool of thrown
things, the code palette in the void slot), gear.js, look.js (the body's).
```
name = 'XIN YI, THE ONE WHO WOKE';  kind = 'duelist'
lives { total: 2, left }           // bar 1 = phases 1 - 2 (TUNING.hp, the gate at phaseAt[1]); bar 2 = phase 3 (hp2)
cameraPull                         // m the camera eases back (main.js updateCameraFocus): flight keeps both in frame
iron                               // IronMoves: weigh (the reload after reload.after ranged moves), begin, onImpact,
                                   //   onCast ('shot'), onSustain (Iron Rain's ticks), motion (the strafe, the wheel)
source                             // SourceMoves: held[] (the stop), sent(r), canUnwrite(), front { live, r, ... },
                                   //   fist { x, z } (the Falling Fist's spot), draw(dt)
bend(why, force) → bool            // THE BEND (phase 2): 'shot' | 'cut'; false: he cannot (bent already, cooling)
onShotReturned(s)                  // AscFx: a returned shot reached him (phase 2: the Bend, else it lands: bend.returned)
handPoint(left, out)               // the hand as drawn (a muzzle, a bolt's start)
victoryNote()                      // 'YOU LEARNED THE LONG SECOND' after the fight that granted it
gear                               // phase 1's gear: 1 one hand, 2 both (ADR-168; tuning.js GEARED.now follows it)
flurry                             // FlurryMoves (flurry.js): the burst now { b, a, i, n, res, cost, cap }, stats
debug.setPhase(n) / setForm(n), phase3() (the fall and the rising), bendNow(why), fallAndRise(), scene(id),
  dejavu(name), hold(n), held(), flight('fist' | 'pass'), setGear(g, snap) (gear 2 through its opening unless
  snap), wall('kick' | 'heel') (Borrowed Wall with its blow chosen)
```
**Two bars, three phases.** `phaseAt` [1, 0.5, 0]: the engine's gate stops bar 1 at half (phase 2's
transition `ironSeeds`); phase 2 has no gate, so bar 1 empty calls `_onHpZero`, which BREAKS him (Tian Lei's
way). `onExecute` on bar 1 is THE FALL: `_changing` (takeHit returns 0), `_fall`, `startReact('executed')`
(the clip: flat on his back for fall.lie s), `pendingPhase` 3, flow.cinematic slowmo, scenes.hold,
`dragon:fall`. The rising (`rising`, a transition) starts the morph to the Source from his body and the script
wave to 1 (onActStart); `enterPhase(3)` makes bar 2 full; at its ring `_palmT` = rising.palm s: a cut is
caught on the raised palm (`_palmCatch`: `dragon:guard {caught}`, the blade thrown back). The deathblow on bar
2 kills him (`_die`: the Long Second granted, the hall's `hall` scene back).
**The Lean** is his ward clips (moves.js CLIPS ward / wardR / wardHigh: slips) and one `fx.afterimages` each.
**Deja vu**: a LINKS entry with `dejavu` (links.js: the first of each replayable string, `force`, phase 2 to
itself, phase 3 to its mirrored copy `<name>M`, `mirrorOf`, `manual`). `WokenBrain._startNext` sets `REPLAY`
(moves.js) to the first pass's draws (`A.draws`), so the realiser draws the same holds and picks, and
`_dejavuNext`; `onActStart` stutters the set (`scenes.stutter`, `scenes.script(1, pulse)`) and emits
`dragon:dejavu`.
**Optional engine fields this boss added** (other kits unchanged): a beat's `noWorld` (brain.js `_worldBlow`:
no world blow of the brain's own: Iron Rain's lit line, Return to Sender's ring); a hit's `guardCost`
(player.js `_block`: what a block costs the meter instead of GUARD.cost; Iron Rain's shots); a boss's
`cameraPull` (main.js).
**The rework (ADR-168 – ADR-170).** New files: `strikes.js` (his acrobatic strike builders: spinBack,
spinFist, tornado, butterfly, flash, aerial, bicycle, dropHeel, flyKnee, and `burstKeys`; a flying foot is keyed
in BODY space, `rFb` / `lFb`, and turned into model space through the key's own body rotation, so a turn or a flip
carries the legs), `flurry.js` (`FlurryMoves`). His own beat / move fields (the brain ignores them):
- `flurry: { n, dur, cap, kind }` (on a beat with `sustain` + `selfHit`): THE FLURRY BURST. One cue, one windup,
  one glint, one lit interval in the ledger; `n` blows drawn over `dur` s (`dragon:burst` each); the first blow
  that finds the hero decides the ONE result (flurry.js header): parried (the burst turned, + `burst.parryPosture`),
  blocked (at most `cap` guard, never health: `player.streamBlock`), dodged, or hit (one stagger, then chip under
  minStaggerDamage with no knock-back, a push out of reach). A burst in his streak flurry settles the streak
  (`onStreakBlow`). At most one burst a move; `cat: 'flurry'` is its own category in the director.
- `wall: true` + `wallBlow: 'kick' | 'heel'` (Borrowed Wall, a `pick` of the two): `_wallPick` (onActStart, from the
  REALISED beats) chooses the upright (`destructibles.list`: standing, h > 1.6, within `wall.seek` m, reached by
  `wall.runTo` of the windup at `wall.speed`) whose line of flight crosses the hero's facing most, else a floor
  spot 3.2 m to the hero's side; `_wallRun` (beatMotion) drives his root through the whole beat (the run, up the
  face, THE SPRING: a bite on the upright, `dragon:wallKick`, the target fixed; the arc; the landing); its reach is
  wherever the hero is (`WokenBrain._reach` Infinity). The long hang: `flow.cinematic` slowmo `wall.slow` for
  `wall.slowDur` s, at most once in `wall.slowEvery` s, only with the hero in the kick's line.
- `bursts` (on an `iron: 'rain'` beat: how many bursts; Iron in the Air's 1), `gear: 2` (a move only in gear 2),
  `twoHand` (a phase-1 move realised two-handed even in gear 1: `secondHand`), `secondHand` (gear 2's opening beat).
**The gears** (phase 1): `d.gear` 1 → 2 when bar 1 is at or under `gear2.at` and he is between two moves
(`_betweenMoves`: his footwork, or a move's recovery; `_gearUp`: the move `secondHand`, `gear2.open` s, `recoverOpen` 1 and `guarding` false through it;
`dragon:gear {gear}`; the level's `text.gear2` as a banner). Gear 2 realises phase 1 with `MOVES` (two-handed)
round `GEAR2_GUARD` (moves.js REALISE_G2, CLIPS_GEAR2, poses.js GEAR2_POSES: `pilot.pset` 4). The per-gear
pressure: tuning.js `GEARED.now` and getters on `TUNING.idleGap`, `TUNING.chain`, `pressure.chainDepth`,
`pressure.chainRest` (phase 1's element per gear; the arrays stay three long, so the brain reads them as ever).
**The bullets' rule** (ADR-169; iron.js header): Iron Rain fires `ironRain.bursts` bursts of `per` slugs on its own
clock (`_rainStep`), a glint at the muzzle `glint` s before each later burst (`combat:flash {bullet, burst}`), the
aim fixed there (`_aimNow`); the slugs are `quiet` (no cue of their own) and `keepAim` (ascendant/fx.js: a hang does
not re-aim them). `hitPlayer` routes a slug to `iron.slugHit` (the burst's ONE result: the first slug that finds
the hero decides it; every slug carries `stun` / `mercy`, so a burst staggers at most once; after a parry they spark off for `parryKeep` s) and
any other projectile to `iron.shotHit` (harmless inside `shotMercy` s of a bullet that hit him).
**Optional engine fields the rework added** (inert for every other attacker): a hit's `stun` and `mercy`
(player.js `_takeHit`: a stagger of `stun` s that keeps the input buffer; while `shotStunT` runs (stun + mercy) a
hit carrying `stun` hurts but never staggers again); a thrown shot's `quiet` and `keepAim` (ascendant/fx.js
`_shotMeets` / `_flyBlast`).
**The set** (world/scriptHall.js, ADR-157): `createScriptHall`, `HALL` (layout), `SCENES`, `SLOTS`; returns
createForest's shape + `scenes` (below) + `ambience` (the falling script: atmosphere.js runs it).

**Scenes: a set that morphs** (ADR-157; world/scriptHall.js is the only one). A set may return
`scenes { ids, now, k, to(id, { x, z, speed }), snap(id), reset(), update(dt), hold(sec), stutter(sec),
script(k, sec) }`; `ids[0]` is the home scene. A breakable def with `scene: '<id>'` stands only in that scene
(destructibles.js: the record's `scene`, `absent`); a def without one is in every scene. `Destructibles`
reads `set.scenes.ids[0]` as `sceneHome`; at its build and at every `reset()` the pieces of the other scenes
are put out of the world. `present(b, on)`: off, the piece is hidden with its stub and cracks, its colliders
out, its fire out, its state GONE (so every query skips it: strike, sweep, stop, coverAt, nearest, floorNear,
ignite, bites); on, it is back whole (`_restore`, the per-piece half of the reset). `sceneNow` is the scene
shown (the set's scenes set it). `world.restore()` calls `scenes.reset()` after the destructibles' reset. A set
without `scenes` behaves exactly as before. `world:scene {id, x, z}` as a morph starts.
The Hall's own surface (world/scriptHall.js; nothing else reads it): a piece's `scene` is its HOME tag for the
destructibles' reset; membership is the set's, `scenes.member(b, id)`, with two optional def fields: `within:
[ids]` (the scenes a piece stands in: the first four watchers stand in the hall and the dojo) and `later: true`
(only once the hall has been left since the reset, `scenes.left`: the four more watchers, tagged `scene:
'hall2'` so the reset puts them out). `scenes.morphing`, `base`, `light` (SCENE_LIGHT eased over a morph),
`burst(b)` (a piece's letting go: digits sampled from its own triangles at build, `def.shed`). Exports:
`HALL` (+ `wall`, `panel`, `morph.width`), `SCENES`, `SLOTS`, `SCRIPT_LOOKS`, `WATCHERS`, `SCENE_LIGHT`,
`RAIN`. A morph also sinks the wreckage inside its front (wreckage.js `e.sink`) and mends cracked or broken
slabs under it (`present` off and on). materials.js: `SCRIPT_GLSL`, `SCRIPT_GRID` (the art pass's letter
cell and anchor, pointed at by the ambience: the prop wave runs down its columns), `scriptUniforms(U)`;
prop-art and carved materials read `uScript` / `uScriptF` behind a strength test.

### Halcyon, the Last Saviour — `src/entities/enemies/halcyon/halcyon.js` exports `class Halcyon` (ADR-160)
A `Duelist` with `HALCYON_KIT` and his own `HalcyonBrain` (`_reach` Infinity for a beat that flies to the
hero; `_toFoot` and a standing reaction never fall: he hovers); COMBAT.md → "Halcyon" has the fight. The kit:
`{ id: 'halcyon', TUNING, MOVES, MOVE_NAMES, CLIP, realise, transitions { 2: 'smileDrops', 3: 'noOneWatching' },
counterMove () => 'riposte', streakMove () => 'streakFlurry', loadout HAL_LOADOUT, poses HAL_POSES, blade
HAL_FIST, scale, REACT { crashed, blinded }, OPEN ['crashed', 'blinded'] }`. Files: tuning.js, moves.js (the
data; his beat fields are listed in its header, all prefixed `hal`), poses.js (`hoverLoco`: his footwork is
flight), gear.js (`hal.*` items: the suit, the cape), look.js (`?halLook=`, `?glare=`, the dressing by
phase), fx.js (`HalFx extends AscFx`: the void slot re-paletted to his glare), glare.js (`Glare`: his eyes'
beams), flight.js (`Flight`: the hover, the pass, the crash, the carry), terrain.js (`Terrain`: Curbside,
the towers, the falling sky, Monument), links.js.
```
name = 'HALCYON, THE LAST SAVIOUR';  kind = 'duelist'
glare / flight / terrain                // his three systems (each has reset(), frame(dt), stats)
eyesK                                   // 0..1 his eyes' kindle (look.js dresses the `flask` part's glow by it)
hurt(damage, posture, why) → dealt      // damage no blade dealt (a returned beam, a crash, a blast)
onBlast(damage, posture, x, z)          // a car's blast the hero caused, beside him (the set calls it)
terrainOwns() → bool                    // a terrain beat moves him (flight.js keeps its hover off)
debug: pass(), tower(), fallingSky(), statue(), carry(), explode(n), cityPhase(n), crash(), tidy()
```
The flight rule (flight.js `frame`, after the brain): unless a beat of his flight moves him (`owns()`: a
`lift`, a leap, a pass, the crash, the carry, a terrain beat) he eases to the height his mode asks for:
6 m asleep, down through the intro, `fly.hover` 0.5 m in footwork and in a move's beats, 0 on one knee (a
transition's first part, a grounded move's recovery, an open reaction). `stats.out` / `outPhase` /
`outFoot`: the stretches above `fly.reach` (tests FLIGHT). The crash: `crash(dx, dz, why)` takes the first
cover on his deflected line (`destructibles.coverAt`), the react 'crashed' held for the stun, `hurt` 60 /
30, `dragon:crash`. The carry: `grab()` (See the World's hit), the hero held in his own knockdown and
carried by `position.y`; the slam ends it, the get-up timed so control is gone at most `grab.cap` s.

### Bai Wuji, the Untouched — `src/entities/enemies/untouched/untouched.js` exports `class Untouched` (ADR-241)
A `Duelist` with `UNTOUCHED_KIT` and his own `UntouchedBrain` (`_reach` unbounded for a blow out of a blink, and a
routed beat's own reach; `startReact('surprised')` once a fight); COMBAT.md → "Bai Wuji" has the fight. The kit:
`{ id: 'untouched', TUNING, MOVES, MOVE_NAMES, CLIP, realise, transitions { 2: 'unveil', 3: 'measureless' },
counterMove () => COUNTER, streakMove () => STREAK, loadout WJ_LOADOUT, poses WJ_POSES, blade WJ_FIST, scale,
REACT, OPEN, dress dressUntouched, letters }`. Every new beat or move field is prefixed `wj`.
- **Files.** `untouched.js` (the class, the brain; THE ROUTING CONTRACT is the comment at its head), `tuning.js`
  (+ `tuningMelee.js`, `tuningSpells.js`, `tuningTerrain.js`, merged as `TUNING.melee` / `spells` / `terrain`),
  `links.js`, `barrier.js`, `pull.js`, `domain.js`; `moves.js` (the ROUTER and the two transitions) over
  `moves/melee.js`, `moves/spells.js`, `moves/terrain.js`; the handlers `spells.js` (`WjSpells`) and
  `terrain.js` (`WjTerrain`; melee's is `WjMelee` in `moves/melee.js`); `poses.js` (the pose router over
  `posesMelee.js` `ml*`, `posesSpells.js` `sp*`, `posesTerrain.js` `tr*`), `gear.js`, `look.js`, `bodyArt.js`;
  `fx.js` (`WjFx extends AscFx`), `fxSpells.js`, `fxDomain.js`, `fxDebug.js`.
- **The rules are objects on the actor**, stepped from `brainFrame`:
  `d.barrier` (THE UNREACHED: `takeHit` asks `barrier.stops(o)` first, every result of `d.hitPlayer` goes to
  `barrier.answer(r, o)`, a posture break and `onCounter` open it; its hurt spheres grow by `wjBarrier.shell`
  while up; surface `up`, `cracks`, `openT`, `openDur`, `why`, `stats`, `open(why, dur)`, `close()`, `crack()`,
  `scaled(o)`: the hero's cut with `wjBarrier.openDamage` on it while open, `takeHit` after the stops; ADR-250),
  `d.pull` (Draw's knots: `add({ x, z, strength, r, life, falloff })` → a knot record the caller may move or end,
  `drift(x, z, out)`, `live`, `knots`; the drift is added to `player.kb`; nothing drags a hero who is down, rolling,
  held or in a move of his own), `d.domain` (the P2 → P3 transition: `state` 'off' | 'sign' | 'closing' | 'held' |
  'inside', `inVoid`, `holding`, `escape()`, `caught()`, `toVoid()`, `breakVoid()`), `d.patience` (patience.js,
  ADR-243: `idle` s since a cut of the hero's reached him, `impatient`, `cueK`, `stats { turns, touches }`;
  `takeHit` calls `touch()`; after `TUNING.wjPatience.after` 20 s it turns once (his eyes through `fx.eyes` for
  `cue` s, the sound `dragon:spell` 'wjUnveil'; no event of its own) and `_weighted` makes every blocked blow cost
  at least `guardCost` of the meter until a cut reaches him; the clock stops in a transition, a break, the
  domain's hold, or with the hero down), `d.fx` (`WjFx`; its head lists every method, per frame or once).
- **THE ROUTING.** `d.parts` holds one handler per move file that exports `create(d)` (`moves.js` `HANDLERS`). A
  BEAT is routed to the handler whose file's `FIELDS` list one of the beat's own fields (melee `wjWeight`,
  `wjSpark`, `wjGhost`, `wjQuake`; spells `wjDraw`, `wjYank`, `wjCast`, `wjNull`, `wjMoment`; terrain `wjLift`,
  `wjDown`, `wjOrbit`, `wjRoad`, `wjFloat`); a MOVE to every handler one of its beats goes to. Hooks, all optional
  and called through `?.`: per beat `beatMotion(b, u, s, dt)`, `onImpact(b, s, a)` (replaces core's own world
  blow for it), `onRelease`, `onCast`, `onSustain(b, s, a, k)`, `hitPlayer(o) → o` (before the blow),
  `onHit(o, r)` (after), `onParried(info, b) → true` (handled), `reach(b)` → metres, unbounded or undefined; per move
  `weigh(name, def, w, dist) → w`, `onActStart(A) → false` (refused); every handler `frame(dt)`,
  `afterPose(dt, a)`, `stop()` (a reaction, a break, his death), `reset()`. A new move goes in its file, never in
  `moves.js`.
- **THE STRIKE ON THE SHELL** (`fxStrike.js`, ADR-266; `?wjStrike=0|a`, PICKED a): `WjFx.barrierStop` calls
  `strikeStart(fx, fx._strikes, d, point, heavy)` (true: a patch took the stop and nothing else of it is drawn;
  six at once, the oldest reused) and `_wjUpdate` calls `strikeUpdate` (a net of strokes on the shell's plane round
  the point, one per letter cell through `fx._screen`). The open sign (`_openSign`) draws only with `?wjSign=1`. `barrier._chip(o)` takes
  `wjBarrier.chip` x a stopped cut off his bar through the engine's `_applyDamage` (never his last HP).
- **THE MOTION TAKES** (`motion.js`, ADR-250; `?wjMotion=0|a|b|c`, PICKED b): `moves/melee.js` makes every melee
  move's `beats` / `recovery` live getters over `liveTakes(name, def)`; the take's beats carry `wjHands` ('R' /
  'L' / 'RL': the hands the blow uses) and `wjBlink.near` (a later beat blinks only when the hero is further). `WjMelee`
  eases `pilot.wjPin { R, L }` (0..1, the hands kept in his pockets) and `poses.js` `wjHandsLayer` puts them there
  over the duel clip. `wjMotionNow()` reads the switch. `WjMelee` also counts THE MERCY's stretch in `game.realDt`.
- **Core's beat fields** (untouched.js): `wjBlink` (`{ behind: m } | { at: rad, r } | { side: ±1, r }` [, `u`]:
  he vanishes and is there late in the windup; a blow out of a blink holds from any side, `around`), `wjCrash`
  (`false | power`: by default every throw of `wjCrash.minKb` 3 m or more crashes), `wjMoment` ('unveil': the
  transition's scripted beat; `afterPose` is the only caller of `fx.unveil`), `wjDomain` ('sign' | 'close').
  The engine fields `blockPush` / `guardCost` default from `TUNING.wjWeight` (3.4 m, 45 % of the guard: the third block in
  a row opens it).
- **The hero's side** (player.js, generic, absent on every other boss): a hit's `blockPush` (m, clamped 0 - 14:
  `_block` slides him), `wjCrash` + `wjCrashDamage` (a throw through the world: one `world.impact` per piece, at
  most six, each keeps 0.6 of the slide's speed, it stops under 3 m/s or after 1.5 s; never the last HP; `fx.crash`),
  `Player.hold(sec)` (a stagger nothing cancels, at most 1.2 s, never on a hero who is down), `onGuarded({ push })`
  (the barrier's stop: `deflect`, push 0.9).
- **The actor's look fields**: `dressPhase` (1..3, set at each transition's impact), `eyesK` (0..1),
  `eyePoint(out)`, `handPoint(side, out)` (as drawn, the camera's lean included).
- **Debug** (the Lab, the film rig): `debug.fx(name, opts)` → `fxDebug.run`, `setPhase(n)`,
  `barrier('open' | 'up' | 'crack')`, `domain('escape' | 'caught' | 'break')`, `pull(x, z, o)`,
  `blink('behind' | 'side')`, `tidy()`, and the engine's.
- **Events**: `dragon:barrier`, `dragon:domain` (the catalogue); his sounds ride `dragon:spell { name: 'wj…', x,
  z, dur }` emitted by the effects (18 recipes in `audio/sfx.js`). Tests: `tests/integration/veil.mjs`
  (`node tests/integration/veil.mjs . <scenario>`; `pace` runs in its own process in `npm test`), the opt-in
  `bench`.

### Anselm, the False Saint — `src/entities/enemies/falseSaint/saint.js` exports `class FalseSaint` (ADR-285)
A `Duelist` with `SAINT_KIT` and his own `FsBrain`; COMBAT.md → "The False Saint" has the fight. The kit: `{ id:
'saint', TUNING, MOVES, MOVE_NAMES, CLIP, realise, maxPhase 4, transitions { 2: 'skinBreaks', 3: 'weaponsFree', 4:
'trueFrame' }, counterMove (phase) => COUNTERS[phase - 1], streakMove (phase) => STREAKS[phase - 1], loadout
FS_LOADOUT, poses SAINT_POSES (the body's FS_POSES, the jets' layers on his footwork), blade FS_FIST, scale, REACT,
OPEN, animOpts { liftEase () => FS_FEET.ease (0.2 s), liftFromStep: true }, dress dressSaint, letters }`. Every new
beat, move or tuning field is prefixed `fs` (`saint.mjs . data` checks it against the engine's own names).
- **Files.** `saint.js` (the class, the brain; THE ROUTING CONTRACT is the comment at its head), `tuning.js` (+
  `tuningMelee.js`, `tuningBoost.js`, `tuningArsenal.js`, `tuningTerrain.js`, merged as `TUNING.melee` / `boost` /
  `arsenal` / `terrain`), `links.js`, `shell.js`; `moves.js` (the ROUTER and the three transitions) over
  `moves/melee.js`, `moves/boost.js`, `moves/arsenal.js`, `moves/terrain.js`; the handlers `FsMelee` (in
  `moves/melee.js`), `FsBoost` (`boost.js`), `FsArsenal` (`arsenal.js`), `FsTerrain` (`terrain.js`); `poses.js` (the
  stand, the guard, the run, the reactions; the router over `posesMelee.js` `ml*`, `posesBoost.js` `bo*`,
  `posesArsenal.js` `ar*`, `posesTerrain.js` `tr*`, partial channels over `FRAGS.STAND`), `gear.js`, `look.js`,
  `bodyArt.js`; `fx.js` (`FsFx extends AscFx`), `fxArsenal.js` (the arsenal's drawings, the flights' pool),
  `fxDebug.js`.
- **THE ROUTING** (Bai Wuji's, ADR-241, with four handlers). `d.parts` holds one handler per move file that exports
  `create(d)` (`moves.js` `HANDLERS`, in file order: `melee`, `boost`, `arsenal`, `terrain`). A BEAT goes to the
  handler whose file's `FIELDS` list one of its own fields: melee `fsBlow`; boost `fsJet`, `fsDash`, `fsDive`,
  `fsBlitz`; arsenal `fsLaser`, `fsCannon`, `fsBolt`, `fsMissile`, `fsMortar`, `fsLance`; terrain `fsLadle`, `fsRelic`,
  `fsPillar`, `fsPress`. A MOVE goes to every handler one of its beats goes to. Core's own beat field: `fsMoment: 2 |
  3 | 4` (a transition's impact: the shell's phase and a burn, `d.dressPhase`, the set's `setPhase` and flare, the
  world blow). The move fields the router reads: `fsFlurry: [phases]` / `fsCounter: [phases]` (his flurry / his counter
  in those phases; a later file's claim wins: melee, boost, arsenal, terrain), so STREAKS are Litany, Rosary, Rosary,
  Rosary and COUNTERS Rebuke, Penance, Anathema, Requiem; `fsNoCount` (FsBrain plays the flurry as authored). Hooks,
  all optional and called through `?.` (`arsenal.js`'s head lists them with their arguments): per beat
  `beatMotion(b, u, s, dt)`, `onImpact(b, s, a)`, `onRelease`, `onCast`, `onSustain(b, s, a, k)`, `hitPlayer(o) → o`,
  `onHit(o, r)`, `onParried(info, b) → true` (handled), `reach(b)` → metres, Infinity or undefined; per move
  `weigh(name, def, w, dist) → w`, `onActStart(A) → false` (refused); every handler `frame(dt)`, `afterPose(dt, a)`,
  `stop()`, `reset()`, and two more than Bai Wuji's: **`footwork(dt, s) → true`** (it moved him this frame; asked in
  file order before the engine's footwork, never while a phase change waits, a counter is pending, the hero drinks or
  his AI is off) and **`takeHit(o) → o | false | undefined`** (a cut of the hero's, asked first: `false` it does
  nothing, an object the cut as changed). The terrain handler's **`onMoment(n) → true`**: `_moment` asks it for the
  change's world blow (P2 a small shock, P3 the lift's ring and plates thrown, P4 the core's nova); without it, core's
  one push ring. A new move goes in its file, never in `moves.js`.
- **FsBrain** (`DuelBrain`): `_reach` (a transition reaches anywhere; a routed beat's handler's `reach`),
  `_outOfReach` (never breaks off a beat whose handler reaches Infinity: the dive, the passes, Last Rite),
  `startStreak` (a `fsNoCount` flurry as authored), `_stepFirst` / `_startNext` (the jet step in place of a share
  `TUNING.boost.step.pick` of the picks and links made with the hero past its range), `_foot` (the handlers'
  footwork first), `startReact` (every handler stops).
- **The actor.** Through a phase's change (`_inChange`: the transition's act until its impact's active frames end)
  `takeHit` turns every cut aside (`_turned`: a spark, a jolt, no damage, no posture). A landed cut chips the shell
  (`_chip`: `shell.chip(o.point, perCut x heavyK)`, then `fx.shellFlake`). Damage that is no blade's: `hurt(damage,
  posture, why)`, `onMolten(damage, posture, x, z)` (a pool: + a shell strip, a stagger at most every
  `TUNING.terrain.molten.staggerEvery` 2.5 s, never mid-act), `onBlast(damage, posture, x, z)` (a tank the hero
  burst beside him). His reset resets the shell, every handler and the set's hazards.
- **The shell**, `d.shell` (`FsShell`; LOOK ONLY, ADR-286): `exposure`, `part(name)`, `order(name, i)`, `chip(point,
  k) → took`, `strip(k, point?) → took`, `setPhase(n)`, `reset()`, `version`, `phase`, `limit`, `last { part, x, y, z,
  k, version }`, `force(k)` (debug), `state()`. Parts `headR, headL, chestR, chestL, armR, foreR, handR, armL, foreL,
  handL, hip, legR, shinR, legL, shinL`; `FLOORS` by phase, limits `TUNING.fsShell.limit` [0.08, 0.3, 0.68, 0.97];
  `perCut` 0.12, `heavyK` 1.6, `spill` 0.35.
- **The body's fields on `d`** (`gear.js` head: the body contract; `look.js` reads them): `d.dressPhase` 1..4; the
  weapons' values 0..1 (`FS_WEAPON_KEYS`): `fsJetK` (both elbow boosters), `fsJetR` / `fsJetL`, `fsPalmK` (the palm's
  iris), `fsGunK` (the forearm gun), `fsPetalK` (the shoulder cells), `fsThrustK` (the back and calf thrusters),
  `fsCoreK` (the core slit), `fsTubeK` (the mortar tubes), `eyesK` (the sensors), `fsFistR` (> 0.5 a fist); the boost
  handler's `d.fsJets { elbowR, elbowL, back, calfR, calfL, palmR, core }` (bridged onto those in `FsBoost._hover`) and
  `d.pilot.fsDashK / fsHoverK / fsBrakeK` (the footwork's pose layers). The hand shapes `d.fsHandR` / `d.fsHandL`:
  'open' | 'reach' (drawn open) | 'relax' | 'guard' (the default) | 'clench'; `d.fsHandBy` the handler that set them (a
  handler clears only its own, 0.24 s after its beat). `eyePoint(out)`, `handPoint(side, out)`, `partPoint(name, out)`
  (as drawn, world): `palmR palmL handR handL elbowR elbowL shoulderR shoulderL back backR backL calfR calfL core
  mortar gunR eye head chest`; `tellPoint` also takes `core`, `mortar`, `back`, `shoulderR`, `shoulderL`, `palms`,
  `eyes`, `feet`. `?fsLook=a|b` (build time), `?fsLetters=a|0` (live).
- **The effects**, `d.fx` (`FsFx`; its head lists every method, per frame (C) or once (1)): the body (`jet`, `jetBurst`,
  `afterimage`, `dashTrail`, `sensor`, `sensorOut`, `shellFlake`, `palmHit`, `footPlant`, `shellStrip`, `coreVent`,
  `transition`, `transitionBurst`), the lasers (`sightLine`, `laser`, `scar`, `passLine`), the cannons
  (`cannonCharge`, `cannonBeam`, `cannonEnd`), the bolts (`gunFlash`, `bolt`, `boltHit`), the missiles
  (`missileLaunch`, `missile`, `missileMark`, `blast`, `missileCut`), the artillery (`mortarFlash`, `shellMark`,
  `shellFall`, `shellBurst`), the lance (`reticle`, `skyLance`, `ringShock`), the foundry (`pour`, `sparks`);
  `FS_FX_METHODS` lists them (`saint.mjs . fx` checks each). **THE FLIGHTS**: `fx.fly(o) → record | null` (a fixed
  pool of 32; kinds missile / shell / bolt; `o` the start, the target, its time or speed, an apex, a mark, tracking,
  its tell, `expect` (true: its own `brain.expect` handle, false, or a shared handle), `onCue(rec)`, `onLand(rec)` (the
  caller's damage)); the record `{ at, left, x, y, z, tx, tz, cue, id, retime(s), cancel() }`, valid while alive and
  its id matches; `fx.cancelFlights()`, `fx.pools()`. The `saint` palette is swapped into the void slot as FsFx is
  built; `hitSpark` rings as metal where the part struck is half bare or more; his servo steps from phase 3 every
  1.05 m. Sounds: `dragon:spell { name: 'fs…', x, z, dur }` from the effects (`FS_SOUNDS`: 35 recipes in
  `audio/sfx.js`).
- **The handlers' surfaces**: `d.parts.melee` `{ stats, grip, lastThrow }`; `d.parts.boost` `{ stats, step,
  riteUsed }`; `d.parts.arsenal` `{ stats, B (the lit beam), L (the lance), K (the barrage), live() }`;
  `d.parts.terrain` `{ stats, busy, front (Dies Irae's), held, paced, lastPlan, onMoment(n) }`.
- **Debug** (the Lab, the film rig): `debug.fx(name, opts)` → `fxDebug.run` (30 drivers, `debug.fxNames`; nothing
  dealt, nothing broken), `setPhase(n)` (the next change on the way, through its real transition), `shell(k)` (every
  part to at least k; none: the shell's state), `pool(x, z, r)` (the set's `molten.add`), `tidy()`, and the
  engine's.
- **Events**: none new. He emits `dragon:dash`, `dragon:takeoff`, `dragon:land` (the jet step, the passes, the dive),
  `dragon:returned` (a bolt sent home), `dragon:hurt`, and `combat:tell` / `combat:flash` for his pools and thrown
  pieces; his set `world:blast`. Tests: `tests/integration/saint.mjs` (`node tests/integration/saint.mjs .
  <scenario>`): core `levels`, `data`, `fight`, `phases`, `shell`, `molten`, `death`, `events`; `world`; `bodyReveal`,
  `bodyMilestones`, `bodyWeapons`, `bodyDeath`; `fx`, `fxFlights`, `fxSounds`, `fxCost`; `mlreach`, `mlgrab`,
  `mlwalk`, `mlworld`, `mllinks`; `boostStep`, `boostVotive`, `boostRosary`, `boostDescent`, `boostStrings`,
  `boostVespers`, `boostRite`, `boostChange`, `boostPace`; `arData`, `arVigil`, `arAbsolution`, `arTriptych`,
  `arChoir`, `arBell`, `arKyrie`, `arVerdict`, `arRevelation`, `arWorld`, `arFair`; `trData`, `trRefuse`, `trPools`,
  `trCrucible`, `trRelic`, `trOffertory`, `trProstration`, `trDiesIrae`, `trChange`, `trUse`; `tunePace`,
  `tuneTraining`; `v04Timing`, `v04Shell`, `v04Hands`, `v04Alloc`, `v04Motion`; opt-in `tuneFight`, `tuneWreck`,
  `tuneFeet`. `npm test`'s task `saint` runs `all`.

## Records, grades and the boss rush (2026-11-23, ADR-179)
Saved records shaped for an online leaderboard later: what is stored now is what a server will take,
so the shapes and rules here are its contract. Modules (all `src/game/`): `rank.js` + `rankTuning.js`
(the grade), `records.js` (the run record and the store), `eligibility.js` (whether a run counts),
`rush.js` (the boss rush's state across page loads), `recorder.js` (`flow.recorder`: between GameFlow
and the three). The screens: `ui/recordLooks.js` (the grade and the bests, behind `?gradeLook=` /
`?recLook=`; the owner's picks ship: `a` / `b`), `ui/screens.js` (`TitleScreen` records argument, `StatsPanel.show(rows, head)`),
`ui/minimap.js` (the rush's line under the disc).

**The run record** (`buildRecord(o)` is the one function that writes one; version `v: 1`):
```
{ v: 1, id,                       // id: unique per run (crypto.randomUUID; never Math.random)
  kind: 'boss' | 'rush',
  level,                          // a boss: its level id; a rush: the ordered level ids
  gameVersion, at,                // GAME_VERSION; ISO time the record was written
  timeMs,                         // see "Timing"
  deaths, damageTaken, maxHp, flasksUsed,   // the clean-play inputs (below)
  grade: 'S'|'A'|'B'|'C', marks: ['UNTOUCHED'|'DEATHLESS'|'NO FLASK', ...],
  stats,                          // RunStats.snapshot() (a boss; {} for a rush)
  device: 'keyboard'|'pad'|'touch',         // the device in use at the win
  techniques: [ids],              // Unlocks.all() at the win
  style: string | null,           // the hero's move style (null until that system is on main)
  rush: id | null,                // a boss fought inside a rush: the rush's id
  splits: [{ level, timeMs, fightMs, deaths, damageTaken, maxHp, flasksUsed, grade, eligible }]  // a rush only
}
```
No player name, no network code. Plain JSON: `JSON.parse(JSON.stringify(r))` is the same record.

**Timing** (real time, ms, rounded):
- a boss: the WINNING attempt's fight time: real time in the flow's `boss` state (`stats.attemptTime`).
  A pause (`paused`, also the automatic one when the tab is hidden), the intro (`bossIntro`), the walk
  (`explore`), the death screen and the record screen never count. The time a step adds is the frame's
  real time clamped to 0.1 s, so a stalled frame adds at most that.
- a rush: the sum of ALL boss-state time over every fight, failed attempts included (the clock keeps
  running through deaths; loads, walks, intros and record screens never count, so a slow device or
  connection costs nothing). A split's `timeMs` is that level's share (every attempt), `fightMs` its
  winning attempt.
- Game time scales (slow motion, hit-stop) do not slow the clock: it reads real time.

**The clean-play inputs**: `deaths` (a boss: deaths before the win on this page; in a rush the
level's deaths, a reload mid-fight included), `damageTaken` (HP lost to blows that LANDED in the winning
attempt: `player:hurt`; a blow met on the guard costs guard, not HP, so blocking, parrying and dodging
weigh the same; only a contact stream's chip through a held guard is not counted either), `maxHp`
(`player.maxHp`), `flasksUsed` (every attempt). A rush's record sums its splits.

**The grade** (`rankRun({ deaths, damageTaken, maxHp, flasksUsed })` → `{ grade, marks, hurt }`;
thresholds in `rankTuning.js` `RANK`): S = no deaths and at most 15 % of max HP lost in the winning
attempt; A = no deaths, or one death and at most 50 %; B = up to three deaths; C = any other win. Time
never changes a grade; `compareRank(a, b)` orders runs: the better grade, then the faster `timeMs`. A
rush is graded by the same rule on its totals (deaths summed, damage summed over max HP summed).
Marks: UNTOUCHED (no death, no damage), DEATHLESS (no death), NO FLASK (no flask in any attempt).

**Eligibility** (`game.eligibility`, one per page; `eligible`, `reason`, `note()` the record screen's
line, `void(reason, detail)`, `watch(game)` per flow frame). Not eligible (nothing is stored, the record
screen says `NOT RECORDED: ...`): the Lab opened (`lab.open` on any frame; its controls need it open),
god mode, endless flasks, the attack-speed slider, `game.debugTimeScale` other than 1, a boss's AI
switched off (`dragon.debug.aiEnabled === false`), `window.__tick`, `flow.debug.toState`, a level on the
training room (`level.stage === 'lab'`), and the URL switches in `GAMEPLAY_SWITCHES` away from their
shipped value (`stage`, `tech`, `lab`, `training`, `cutStop`, `apoc`, `ring`, `bamboo`, `outskirts`,
`looks`, `wyrmLook`, `ablaze`, `perfect`, `streakfx`). Every other switch is a look and does not void
(ADR-179 lists them). Once void a run stays void for the page; a rush stays void for all its pages.
**Client-side times can be forged** (the console, a patched build, a replayed request): nothing here
proves a run was played. Validating a submitted record (plausible times per boss, the record's version
against the game's, rate limits, replays if ever) is the server's job when there is one.

**The store** (`game.records`, `Records(storage)`; localStorage `gcd.records.v1`, injectable):
`{ v: 1, levels: { [id]: { clears, bestTime, bestGrade } }, rush: { clears, bestTime, bestGrade } | null,
recent: [record, ...] }` (a best: `{ timeMs, grade, marks, id, at }`). `best(id)`, `rushBest()`,
`recent()` (the last `RECENT` = 24 records, oldest first: the queue a later uploader drains),
`add(record)` → `{ newBestTime, newBestGrade, prevTime, prevGrade }`, `clear()`. A best time and a best
grade are separate bests and may come from different runs. A rush's fight also counts as that boss's
clear. Corrupt or another version's data in the key reads as empty (a later version reads this key
and carries it forward); a full storage drops the queue to its newest six and tries again; blocked or
missing storage keeps everything for the page load. Nothing throws.

**The boss rush** (`game.rush`, `Rush(sessionStorage, search)`; sessionStorage `gcd.rush.v1`, this tab):
`{ v, id, order, index, levelMs, deaths, flasks, live, splits, void, startedAt, done }`. The title's BOSS
RUSH calls `game.startRush()` → `Rush.start(session, order, id)` and loads `rushUrl(order[0], href)`
(`?level=<id>&rush=1`, the other parameters kept; `levelUrl` drops `?rush`). Every level in `LEVELS`
order: a new level joins the rush with no other change. A rush page (main.js: the rush's level,
whatever `?level` says) shows no title and starts at once (`_title` → `_startGame`). Each fight is a
fresh page or a respawn: health and flasks are full. `rush.tick(dt, fighting)` runs the clock in the
boss state and banks it about once a second and on `pagehide` / a hidden tab with `live` set while
fighting: a reload or a reopened tab mid-fight resumes that boss with the time kept and counts a death
(`arrive()`); a crash loses at most a second of the clock. A death is the normal retry (`death()`).
A win (`win(split)`) banks the split and moves on; the record screen shows the fight's record with
the rush's place and time, and `[interact] Next boss` loads the next page (`recorder.next()`); after
the last, the rush record (each split, the totals, the overall grade, NEW BEST) and `[interact] Back to
the title`. QUIT TO TITLE ends the rush with no record (`recorder.quit()`); so does any page of the
game without `?rush`. The HUD: `recorder.rushClock()` → `{ index, count, ms }` drawn as `3 / 8  4:12.3`
under the minimap (no panel; none on the record screen).

**The seam**: `game:record {kind, record, newBestTime, newBestGrade}` is emitted once per stored record
(an eligible won fight; after a rush's last fight, the rush's record too). A future uploader subscribes to
it, or drains `records.recent()` at boot; neither changes what is stored.

## Event catalogue (exact names — producers → consumers)
Player → hud/audio/fx/flow:
- `player:attack {kind:'light'|'heavy'|'slam'|'cleave'|'thrust', combo, charge, name}` (swing starts; combo 1–5 = the chain hit, slam = hit 5, the sprint slash and the roll cut report 1; heavy = a heavy branch, combo 0–4 = the light it followed (ADR-115; the Earthbreaker after the fourth is kind slam); cleave = the charge's release, thrust = the execution against a duelist; name = the attack's data name, combat.js),
  `player:charge {t}` (charge start; t = seconds to full charge), `player:slam {x, z}` (the slam meets the ground: shard burst),
  `player:hitDragon {damage, part, point, heavy, crit, kind, guarded, combo, weight, shards}` (heavy = slam / cleave / thrust / plunge; kind 'plunge' = the
  head-stab, crit on an execution; guarded = a duelist's guard turned it: damage 0; point = where the cut is drawn
  (on a duelist: after his shove, where he is drawn in the held frame);
  combo = the chain hit 1-5 (1 outside the chain); weight = the cut's look and sound tier, the attack's contact:
  light, sweep, point, slam, cleave or execute; the plunge's has neither; shards = true when only the slam's ground
  shards hit (the blade is in the ground: weight null, no cut drawn, no blade sound)), `player:hurt {damage, kind, hp}`,
  `player:bounced {heavy}` (a duelist's guard deflected the hero's strike: his blade is thrown back),
  `player:block {damage, tell}`, `player:parry {tell, attack, chain, clash, light, perfect, last, flare}` (clash = the clash dance's run this parry makes on a duelist, 0 with the dance off (`?clash=0`) or no duelist's blade / body, ADR-247; flare = the blow was a parry moment, a blue flare blow: the counter follows; last = false for a string's non-final blow; chain = the hero's parries in rhythm, ≤ 1.1 s
  apart, 1 = single; it can run across two strings; light = a deflected bullet: a lighter clash; perfect = pressed within
  `DEFENSE.perfectParryWindow`: with light, the bullet is returned), `player:guardBreak {attack}`,
  `player:guardOpen {attack, black}` (black = a black, charged, blow met on the guard or a parry: the whole meter at once, ADR-118; else the guard meter ran out on a blocked blow: the blow was blocked, the guard is knocked open for a
  short stagger; ADR-095; HUD "GUARD DOWN", audio the guard break's crack, the pad rumbles),
  `player:dodge {kind}` (an attack passed through i-frames), `player:perfectDodge {attack, tell, streak}` (every perfect dodge:
  flurry, plunge, in place or Ghostep; not on an execution; streak = perfect dodges in a row, this one included),
  `player:ghostep {x, z}` (with every perfect dodge; for the plunge x/z = the hang point above the head, for a flurry where he dodged),
  `player:streak {count, lost}` (the streak changed: counted up, or count 0 and how many were lost when a blow hurt him),
  `player:flurry {strikes, art, air, dur}` (a perfect dodge is answered: blows in all, the art's name, in the air round a head or on
  the ground, real seconds it takes, about), `player:flurryHit {n, of, last, damage}` (a blow of it landed; last = the art's),
  `player:flurryArt {art, air, dur}` (the art's coil starts; not for the plunge), `player:flurryEnd {strikes, damage, art, label}`
  (the last blow landed and the hanging cuts burst: the damage of all of them, the art's display name; a parried last blow's
  riposte emits these too, with art 'riposte', and no perfect-dodge events),
  `player:plunge {execution}` (the dive starts; also an execution), `player:plungeHit {damage, execution}` (the blade
  meets the head, once per plunge; damage = what onPlunge returned; also a `player:hitDragon` with kind 'plunge' when
  it dealt damage), `player:roll {backstep}`, `player:heal {amount, flasks}`, `player:noFlask`, `player:died`,
  `player:footstep {x, z, sprint}` (a planted foot's touchdown while moving, and a dash's
  two bounding steps; also the plunge's and the flurry's touchdowns. With the living world's steps piece on
  the payload carries surface too (string, optional: grass, earth, stone, ash, obsidian, sand or leaf, what
  the ground is under the foot); sfx plays that ground's sound by it), `player:lockOn {on}`,
  `player:lock {phase}` (the blade lock with a duelist: phase start / push / won / lost),
  `player:mikiri {attack}` (a roll into a perilous thrust stepped on the blade),
  `player:counter {attack, damage, draw, link, links, last}` (the flash counter, ADR-102: a trade clash in the instant the hero's cut became
  a cut; it went through the blow and through the attacker; HUD "FLASH COUNTER"; draw = One Breath's draw counter, ADR-146;
  link / links: the flash chain's link and length (the game's default; 0 / 0 under `?counter=0`), last = no strike-back follows
  (the crit window opened), ADR-246; HUD "FLASH COUNTER ×2", "THREE FLASHES" on the last),
  `player:draw {phase}` (One Breath, ADR-146: phase stance = the draw stance taken, cut = released),
  `player:flareCounter {attack, damage, strikes}` (the counter, ADR-118: a blue flare blow was parried and the hero
  answered by himself; fired as its last cut, the counter blow, lands: damage = that blow's, strikes = the
  cuts in all; HUD "COUNTER"),
  `combat:answer {attack, tell, result, damage, dead, stream, perfect}` (every blow the hero answers, from
  the player's takeHit, whatever the answer: result = the RESULT it returned (never 'ignored'), damage = the HP it cost,
  dead = it killed him, stream = a contact tick (breath, burning ground), perfect = a perfect parry; the move
  telemetry reads it, ADR-108)
Dragon (any attacker; the BOSS SLOT: the wyrm or the level's boss, e.g. the Ash Disciple, emits the same
`dragon:*` names, see "Levels and the boss slot") → hud/audio/flow:
- `combat:tell {source:'dragon', attack, tell, impactIn, x, z, flare}` (windup start, per hit, so once per hit of a
  string; x/z = the striking part; impactIn is a first estimate in game seconds; tell: normal / blue / red /
  black; flare: the blow is a moment, cued by the flare: every red and black blow, a blue one marked so in its
  data, ADR-118),
  `combat:flash {source:'dragon', attack, tell, x, y, z, perilous, flare}` (~0.35 s before impact — the **authoritative**
  timing cue: moving targets (charge, fireball) and hazard-dealt blows re-time it after the tell; perilous:
  a duelist's mikiri thrust, roll into it; flare as above: the HUD flashes the screen edge in the flare's colour;
  since ADR-122 a duelist's thrown terrain piece, kicked or hurled, cues itself with flare too, drawn on the piece,
  nothing drawn where it lands; a blow the duelists' fairness guard may still feint sends its tell only together
  with its flash, and a blow it turns into a feint sends neither; the wyrm's phase-3 fire, ablaze.js, dims round it, ADR-120),
  `combat:charge {source:'dragon', attack, dur, x, z}` (a black blow begins to charge: darkness gathers on the
  striking part for dur game seconds, until its cue; the HUD darkens the screen edge through it, audio plays
  the charge's swell; with ?black=a|b|c the blackout darkens the whole picture instead of the edge, ADR-271),
  `combat:clash {heavy, crush, counter, x, y, z}` (the trade clash: the hero's cut met a duelist's blow at the same moment and
  neither landed; heavy = the hero's cut was a heavy one, crush = a full cleave that was not thrown back, counter = the
  flash counter (it is followed by player:counter and the HUD shows that instead); HUD "CLASH",
  audio two steels ringing, a flicker of the frame),
  `combat:deflectChain {count}` (the attacker's count: the 2nd, 3rd ... parry in a row within one string;
  a hit that lands or is blocked resets it, dodges keep it; contract 1; the HUD shows "DEFLECT ×N")
- `dragon:wake`, `dragon:roar {strength}`, `dragon:introDone`, `dragon:windup {name}`,
  `dragon:attack {name, weapon, weight, shape, tell, impactIn, x, z}` (the wyrm: {name} alone, as an attack's active
  phase begins: audio its swipe, a claw or a tail; a duelist, duelist/brain.js: once per real
  blow, ATTACK_SOUND.lead s before its impact and never before its glint; a body of Wen Yao's packs, clones.js: at its glint, a fist, heavy for a dive / up-kick or a red blow, not for a feint, a cast, a pure throw, a
  burst or a phase change; weapon sword / fist from the boss's TUNING.weapon, weight light / heavy, shape cut /
  thrust / kick / draw, impactIn game seconds to the impact, x/z where he stands; audio the blade or fist through
  the air, its loudest moment on the impact; the payload object is reused: read it at once),
  `dragon:step {x, z, heavy}`, `dragon:wingFlap {strength}`, `dragon:takeoff`, `dragon:land {x, z}` (the leap,
  every flight, and the crash of a plunged flier),
  `dragon:breathStart`, `dragon:breathEnd` (the breath, the sky strafe's pass, the fire snap's gout, the breathed patterns and the firebrand's kindling), `dragon:fireball {x, y, z}`,
  `dragon:explosion {x, z, radius}`,
  `dragon:bite`, `dragon:hurt {damage, part, hp, crit}`, `dragon:parried {attack, tell, hit, last, bullet, perfect}` (hit = 0-based
  index in its string, last = the string's last hit or a single attack: only then a recoil; bullet: true = a
  deflected bullet, hit 0, last false: posture only, the wyrm is not interrupted and audio stays silent; perfect:
  true = the bullet is returned), `dragon:returned {kind, damage, x, y, z, lantern}` (a perfectly parried bullet's return; lantern true = Heaven's Lantern's orb pushed back into him
  lands on the head: kind 0 ember (1 was the wisp, removed in ADR-119), damage dealt, x/y/z the head; audio plays its hit, the HUD its number,
  flow counts it in the run stats like a sword hit),
  `dragon:streak {count, ready}` (a duelist's streak of guards changed; ready = his flurry may come), `dragon:flurry {count}`
  (his flurry starts: that many blows), `dragon:flurryEnd {count, answered}` (decided: every blow parried or blocked, or one missed),
  `dragon:clone {kind, x, z, by}` (the Thousand-Body Fox: a paper self tears free, kind 'spawn', or pops, kind 'pop'; by =
  what did it: a pack's move name, assist / lift / twin / swap, or cut / parry / burst / pearl / beam / spring / copy / break / phase / mantle / death; audio a paper tear),
  `dragon:sheath {state}` (the Sheathed's sheath changed, ADR-145: settle = the hand on the hilt, draw = the blade out,
  click = it went home (the grove falls), carry; audio: the breath, the click),
  Xin Yi, the One Who Woke (ADR-156; audio plays each, the HUD feed none): `dragon:shot {attack, heavy}` (a gun fires),
  `dragon:reload` (both guns thrown away), `dragon:bend {why}` (THE BEND: why 'shot' or 'cut'), `dragon:stop {held}` (a
  returned bolt hangs before his palm; held = how many now), `dragon:sent {count, result}` (Return to Sender answered),
  `dragon:unwrite {count}` (bricks torn out of the code pillars), `dragon:dejavu {name}` (the hall stutters: the string
  replays), `dragon:fall {x, z, lie}` (THE FALL: bar 1 empty and the deathblow; he lies lie s), `dragon:stillHand {dur}`
  (the rising's ring went out: the Still Hand held dur s), `dragon:burst {i, n, kind, x, z}` (a blow of a flurry burst
  is drawn, ADR-168; audio a soft patter), `dragon:gear {gear}` (phase 1's second hand comes out; audio a short hum;
  the banner is the level's text.gear2), `dragon:wallKick {x, z, wall, blow}` (Borrowed Wall's spring: off an
  upright, or the floor; audio a landing thump),
  `dragon:posture {posture, max}`, `dragon:postureBreak`, `dragon:stagger` (ordinary stagger only), `dragon:phase2`,
  `dragon:phase3`, `dragon:phase4` (a duelist's later phases: the Starless Lord's blade forms), `dragon:phase {n}` (the wyrm: with phase 2 and 3, on the transition roar), `dragon:plunged {execution}`
  (contract 2: every plunge that lands, even during a transition or the killing one),
  `dragon:death`, `dragon:dead`,
  `dragon:guard {heavy, deflect, caught}` (a duelist's guard turned the hero's strike: no damage, guard posture; HUD
  "GUARDED", audio a dry clack; deflect = he beat it away and the hero bounces: HUD "DEFLECTED", a harsh falling
  clang, a flicker of the frame; caught = the cut was caught in a counter stance (a beat marked stance): no
  posture either, HUD "CAUGHT", his punish follows at once), `dragon:deflected {count}` (every real hit of a long string parried:
  the full deflect; HUD "PERFECT DEFLECT"),
  `dragon:spell {name, x, z, part}` (a fire attack's signature moment: the strafe's pass, the dive, the barrage's
  rise, a spell's cast / the nova's charge start, a bullet pattern's cast (cinderSpit, emberRain, fireLanes among
  them), a terrain move's throw / kindling / bat; the whole body's blows that have a sound of their own: wingSlam,
  tailSlam, tailWhip; a flying combo (skyHunt, skyFurnace, skyCataclysm) once per part, with the optional field
  part = 'pass' | 'barrage' | 'dive', ADR-119), `dragon:hazard {kind, stage, x, z, radius}` (a fire hazard:
  stage 'fall' = a meteor starts its visible fall, 'hit' = a meteor / pillar / the dive's crash / the nova goes off,
  'launch' = a bolt of Armageddon's salvo leaves the jaws, 'sky' = the sky answers it: the barrage begins)
- Hazard tells: a self-announcing hazard (meteors, chase pillars) emits combat:tell / combat:flash with
  source 'dragon', its spell as the attack, tell 'red' and hazard: true (audio plays a lighter cue)
- Bullet tells: a bullet about to hit, or a ground tongue about to reach the hero, emits combat:tell /
  combat:flash with source 'dragon', its pattern as the attack (a tongue's: fireWheel or fireLanes), the
  bullet's tell (normal for an ember, red for an orb or a tongue), hazard: true and bullet: true (audio: the
  flash ping alone, no tell sting, no music dip)
- Ambient cinders (ADR-119) are hazard circles: their cues carry the attack name cinders (no tuning entry)
- The roar-cast moves (ADR-197) add no event name. The brood's cues (a drakeling's lunge and dive, a
  wisp's commit) are combat:tell / combat:flash with source 'dragon', the move that called it as the
  attack (drakelings or wisps), the creature's tell (normal or blue for a lunge, red for a dive or a
  wisp), hazard: true and brood: true. The serpent's strikes and the firestorm's burst are ordinary beats
  of their action (one red combat:tell and combat:flash each, re-timed as the blow starts). Each of the
  four emits dragon:spell with its name (drakelings, wisps, fireSerpent, firestorm) at its cast or its
  emergence, its roar dragon:roar (roarFx); a serpent strike and the firestorm's burst emit
  dragon:explosion where they land. The eruptions' crack and the second wall's laying send nothing new.
- A duelist's things that fly, wait or fall while he fights (ADR-122) cue themselves with source 'dragon':
  the Starless Sky's strikes (attack starlessSky) and Starless Night's waves (starlessNight) with hazard: true,
  the wheeling blade (wheelingBlade) with bullet: true; Shen Hui's burning ground has no cue (ground to step
  off, not a blow). No event and no payload field was added by the duelists' second pass.
- Tian Lei, the Skybreak Ring's boss (ADR-129), added NO event name and no payload field; new producers
  and payload values of existing ones: his transformations emit `dragon:phase2` / `dragon:phase3` (also
  the Lab's setForm); his deathblow `dragon:plunged` with execution, deathblow and form (as the Lord's);
  `dragon:returned` kind 1 = a bolt of his struck back by a perfect parry, kind 2 = a returned blast
  reached him (damage 50); a bolt's lightning emits `dragon:explosion` (radius 2, at his hand); the
  volley's dive lands with `dragon:land`; a beam emits `dragon:spell` (name = the move) as it lights; a
  won beam clash emits `dragon:stagger`; a held guard under a lit beam emits `player:block` (damage 0,
  at most every 0.4 s; the beam emits it, not the player). His blasts and the disc cue themselves with
  `combat:flash` (source dragon, hazard: true, bullet: true); a thrown floor tile's flash carries flare
  (drawn on the tile); the quake's front and Ring Breaker's tiles send `combat:tell` and `combat:flash`
  with hazard: true and flare; his called lightning (Thunderfall, the volley, the corner bolts) cues as
  the Lord's called strikes do.
- Halcyon, Halcyon Plaza's boss (ADR-160), added these names: `dragon:crash {why, cover, x, z}` (THE CRASH: a
  parried flying blow or a perfectly dodged red one threw him off his line; why = parry / dodge / debug, cover =
  the kind of the piece he went through, or null for a skid), `dragon:grab {x, z}` (See the World caught the
  hero: the carry starts), `dragon:dash {x, z}` (a pass leaves, at its sonic crack), `dragon:tower {x, z}` (he
  bursts through a tower's top), `dragon:clap {x, z, r}` (Applause's ring of force), `dragon:split {attack, x, z}`
  (a thrown car parried: cut in two, its halves go up behind the hero), `dragon:statue {part}` (his own statue
  loses its head, part head, or its arm, part arm); and `dragon:returned` gets his Stare back in his eyes (attack,
  damage). His beams emit `dragon:spell` as they light; a held guard under The Stare emits `player:block` as Tian
  Lei's beam does. The set, Halcyon Plaza (ADR-159), emits `world:blast {x, z, r, by}` (a car goes up: its fuse
  ran out, or a thrown car landed; by = who broke it) and cues each fuse as a falling piece is cued
  (`combat:tell` / `combat:flash`, source world, attack carBomb, hazard: true).
- Bai Wuji, the Veiled Crossing's boss, added these names: `dragon:barrier {state, why, cracks, dur}` (his
  barrier, untouched/barrier.js: state stop = the hero's blade stopped on it (with damage, x, y, z when the stop
  chipped him, ADR-266: the HUD prints the number there), crack = an ordinary parry cracked
  it, open = it opened (why parry / dodge / cracks / break / counter / domain / debug; dur its seconds), close
  = it stands again) and `dragon:domain {state, x, z}` (the phase-3 transition, untouched/domain.js: state sign
  = the hand sign, escape = the hero dodged through the closing wall, caught = he is held, void = the scene is
  the void, break = his death broke it). His set's scenes emit `world:scene` as the Hall's do.
Flow → hud/audio:
- `state {from, to}`, `bonfire:rest`, `game:retry`, `game:victory`, `area {name}`,
  `game:record {kind, record, newBestTime, newBestGrade}` (a run record was stored: an eligible won fight, or a finished boss rush, ADR-179; record = the run record of "Records" below; HUD: the title's bests; the seam a future uploader subscribes to),
  `game:cinematic {kind}` (flow.cinematic: slow motion and a close camera on a duel's big moment; kind
  fullDeflect / bladeLock / mikiri / execution / perfectParry (the hero's perfect parry of a blade: a short
  slow motion, no gong), or lock = the blade lock's camera push-in: no slow motion,
  audio plays no gong; greatBeam = Tian Lei's great beam begins to charge: a short close look at him,
  no slow motion, audio plays the gong, ADR-129)
World → audio (destruction, ADR-107; see "Destruction" above):
- `world:impact {kind, mat, x, y, z, power, by, id}` (a blow on a breakable. kind: 'chip' = it held, 'break' = it
  shattered where it stood, 'topple' = it starts to fall, 'crash' = it lands (or a thrown piece does), 'burn' = wood
  catches, 'burnout' = it burned through (also for a log of wreckage, with id -1), 'throw' = a boss tears it from
  the ground, 'wear' = it reached a stage of wearing down (power = the stage, 1 – 3; ADR-120). mat: 'wood' / 'stone' / 'metal' / 'bone'. power: on the POWER scale. by: 'player' / 'boss' / 'world'.
  id: its index in the breakables' list.
  One reused payload: a subscriber must not keep it), `world:fire {x, z, radius, cells}` (grass catches)
- `world:edge {x, z, reach, lanes, first}` (ADR-125, the edge of the open ground: a tree of the forest's wall is
  down and ground behind it has opened. x, z: the end of the lane that opened furthest; reach: how far from the
  centre the hero's ground goes there, m; lanes: lanes open in all; first: nothing was open before. One reused
  payload. The HUD feed says it once a fight, on first. A walk edge, Cinderwood's since ADR-197, never
  sends it: the hero's ground there is the whole forest from the start)
- `world:scene {id, x, z}` (ADR-157, the Hall of Falling Script: the set's scenes.to began a morph to scene id
  from x, z; audio a falling run of ticks)
- A piece a boss felled emits combat:tell / combat:flash with source 'world', attack 'fallingDebris', tell 'red'
  and hazard: true (be out from under it; audio plays the hazard cue)

## Ownership (parallel work)
Foundation (read-only for module authors unless their brief says otherwise): `src/core/**`,
`src/render/**`, `src/world/**`, `src/combat/**`, `src/main.js`, `index.html`, `src/style.css`.
Each module owns only its directory. If a module needs a foundation change, it reports it instead of editing.
