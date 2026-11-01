# ABYSS — Architecture & Module Contracts

Browser game, Three.js 0.180 (WebGL2), plain ES modules, no framework. `npm run dev` serves the
repo at http://localhost:5173 ; `npm run build` emits a single-file `dist/index.html`.

## Conventions
- Units: meters, seconds, radians. **Y up**, ground plane y = 0 (flat).
- Camera looks north: **screen-up = world −Z**, screen-right = +X. Fixed yaw, ~58° pitch.
- Models face local **+Z**. `yaw` rotates about Y; facing vector = `(sin yaw, 0, cos yaw)`;
  `yawTo(fx, fz, tx, tz)` in `core/math.js`.
- All shader colours are linear HDR. See `docs/STYLE.md` for the look.
- Arena: clearing of radius 30 around the origin. Player clamp 31, dragon clamp 26.
  Bonfire (spawn) at (0, 25.5) south; stone circle r≈19.5; bone pile around (−3, −15.5);
  dragon sleeps at `CONFIG.world.dragonSleep` (3, −10).

## Frame order (src/main.js)
```
flow.update(dt, realDt) → player.update(dt) → dragon.update(dt) → camera → shared uniforms
→ world.update(dt) → lights.update → fx.update → hud.update(realDt) → audio.update(realDt) → render
```
`dt` is scaled by `game.timeScale` and hit-stop; `realDt` is not. Input edges (`pressed`) are valid
for exactly one frame.

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
| `hitstop(sec, scale=0.04)` | brief freeze-frame (0.05–0.12 s typical) |
| `lights` | `add({x,y,z,color:[r,g,b],intensity,radius,life,fade,fadeIn,flicker})` → light (mutable `x,y,z`, `.set()`, `.kill()`) |
| `fx.add` / `fx.alpha` | glyph particles, additive-HDR / alpha-blended. `spawn({x,y,z,vx,vy,vz,life,size,sizeEnd,glyph,color,colorEnd,alpha,alphaEnd,gravity,drag,spin,rot,flicker,stretch})`. `glyph`: char, string of chars (random pick) or atlas index. |
| `world` | `resolve(pos, radius, bound)` circle collision; `setPusher(slot, x, y, z, r)` grass trample (slot 0 = player, 1–9 = dragon; y > 1.5 = airborne, ignored); `clearPushers(from, to)`; `gust(x, z, strength 0..2, radius)`; `scorch.burnCircle(x, z, r, burn 0..1, heat 0..1)`, `scorch.reset()`; `colliders.blocked(ax,az,bx,bz)`; `bonfire {x,z}`; `nest {x,z}`; `atmosphere.setBonfireLit(bool)` |
| `player`, `dragon`, `hud`, `audio`, `flow` | the modules below |
| `state` | owned by flow: `'title' | 'explore' | 'bossIntro' | 'boss' | 'dead' | 'victory' | 'paused'` |
| `time`, `realTime`, `dt`, `realDt`, `timeScale`, `fps` | clocks |
| `settings` | `{ quality: 0..2, showFps: bool }`; `applyQuality()` re-applies |

Render helpers for creature modules:
- `createSurfaceGlyphMaterial(U, opts)` (`render/materials.js`) — runtime uniforms: `uGlow`, `uInkGlow`, `uFlash`, `uDissolve`, `uTint`.
- `limbGeometry`, `ellipsoidGeometry`, `hornGeometry`, `cylindricalGUV`, `planarGUV` (`render/glyphGeometry.js`).
- `markCaster(object)` (`render/pipeline.js`) — casts moon shadows.
- `gi(ch)`, `gis(str)` (`render/glyphs.js`).
- `game.pipeline.finalMat.uniforms` — `uHurt` (red edge 0..1), `uFade` (black 0..1), `uDesat` (0..1), `uWarm` (boss grade 0..1), `uExposure`, `uBloom`. **Owned by the HUD/flow module.**

## Module contracts

### Player — `src/entities/player/player.js` exports `class Player`
```
constructor(game)                      // builds model, adds object3d to game.scene, spawns at CONFIG.world.playerSpawn
object3d: THREE.Object3D;  position: THREE.Vector3 (=== object3d.position);  yaw: number;  radius = 0.45
hp, maxHp, stamina, maxStamina, flasks, maxFlasks: number
state: string                          // 'idle'|'run'|'sprint'|'roll'|'attack'|'heavy'|'heal'|'stagger'|'knockdown'|'dead'
lockOn: boolean                        // toggled by Tab / middle mouse; facing tracks dragon.lockPoint
get alive(): boolean
isInvulnerable(): boolean              // roll i-frames, get-up, dead
takeHit({ damage, from:{x,z}, knockback=0, knockdown=false, kind='hit', burn=0 }): 'hit'|'dodged'|'ignored'
getChestPos(out: Vector3): Vector3
respawn(x, z)                          // full restore, idle, facing north, clears burn/lock
restAtBonfire()                        // refill hp/stamina/flasks (no teleport)
update(dt)
```
Reads input only while `game.state` ∈ {`explore`,`bossIntro`,`boss`}; otherwise idles (or stays dead).
Deals damage via `game.dragon.takeHit(...)` using `game.dragon.hurtSpheres`; pushes itself out of
`game.dragon.bodyCircles` and resolves vs `game.world.resolve(pos, radius, CONFIG.world.playerBound)`.

### Dragon — `src/entities/dragon/dragon.js` exports `class Dragon`
```
constructor(game)                      // builds wyvern, sleeping at CONFIG.world.dragonSleep
object3d, position (Vector3, root on ground), yaw
name = 'VAELGRIM, THE CINDER WYRM';  hp, maxHp;  phase: 1|2
state: 'sleeping'|'waking'|'combat'|'staggered'|'airborne'|'dying'|'dead'
hurtSpheres: Array<{x,y,z,r,part,mult}>  // world space, refreshed every update; part ∈ head|neck|body|tail|wing|leg
bodyCircles: Array<{x,z,r}>              // ground footprint for player push-out (empty while airborne)
isTargetable(): boolean                 // false while sleeping/dying/dead
lockPoint(out): Vector3                  // chest/neck base, for lock-on + camera
startIntro()                            // wake → rise → roar; emits 'dragon:introDone' when the fight starts
takeHit({ damage, part, point:{x,y,z}, dir:{x,z}, poise, heavy }): number   // returns damage dealt
reset()                                 // back to sleeping at the nest, full HP, phase 1, all FX/lights cleared
update(dt)
```
Damages the player only via `game.player.takeHit(...)`.

### HUD — `src/ui/hud.js` exports `class Hud`
```
constructor(game)          // builds DOM under #ui (inject its own <style>; do not edit style.css)
update(realDt)
log(text, channel='system')          // channel: 'system'|'combat'|'warn'|'lore'
showBossBar(name) / hideBossBar()
banner(text, kind)                   // kind: 'death'|'victory'|'area'|'bonfire'|'phase'
prompt(text|null)                    // interaction prompt, e.g. "[E] Rest at bonfire"
showTitle() / hideTitle();  showPause(bool);  toggleHelp()
```

### Flow — `src/game/flow.js` exports `class GameFlow`
```
constructor(game);  update(dt, realDt)
cameraOverride: null | { focus: Vector3, weight: 0..1, zoom: meters }   // read by main.js
```
Owns `game.state`, title → explore → bossIntro → boss → dead/victory, pause (Esc), bonfire rest (E),
retry after death (respawn at bonfire, `dragon.reset()`, `world.scorch.reset()`), F2 quality,
M mute, H help, F3 fps.

### Audio — `src/audio/audio.js` exports `class AudioEngine`
```
constructor(game)          // subscribes to events; AudioContext created lazily
unlock()                   // call on first user gesture (flow does this on title dismiss)
update(realDt)
play(name, opts)           // one-shot SFX by name
setMusic(mode)             // 'none'|'ambient'|'boss'|'boss2'|'victory'|'death'
toggleMute(); muted: boolean;  setVolume(0..1)
```

## Event catalogue (exact names — producers → consumers)
Player → hud/audio/fx:
- `player:attack {kind:'light'|'heavy', combo}` (swing starts), `player:hitDragon {damage, part, point, heavy, crit}`,
  `player:hurt {damage, kind, hp}`, `player:dodge {kind}` (an attack passed through i-frames),
  `player:roll`, `player:heal {amount, flasks}`, `player:noStamina`, `player:died`,
  `player:footstep {x, z, sprint}`, `player:lockOn {on}`, `player:noFlask`
Dragon → hud/audio/flow:
- `dragon:wake`, `dragon:roar {strength}`, `dragon:introDone`, `dragon:windup {name}`, `dragon:attack {name}`,
  `dragon:step {x, z, heavy}`, `dragon:wingFlap {strength}`, `dragon:takeoff`, `dragon:land {x, z}`,
  `dragon:breathStart`, `dragon:breathEnd`, `dragon:fireball {x, y, z}`, `dragon:explosion {x, z, radius}`,
  `dragon:bite`, `dragon:hurt {damage, part, hp}`, `dragon:stagger`, `dragon:phase2`, `dragon:death`, `dragon:dead`
Flow → hud/audio:
- `state {from, to}`, `bonfire:rest`, `game:retry`, `game:victory`, `area {name}`

## Ownership (parallel work)
Foundation (read-only for module authors): `src/core/**`, `src/render/**`, `src/world/**`, `src/main.js`,
`index.html`, `src/style.css`. Each module owns only its directory. If a module needs a foundation
change, it reports it instead of editing.
