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
lab.update(realDt) → flow.update(dt, realDt) → player.update(dt) → dragon.update(dt) → camera
→ shared uniforms → world.update(dt) → lights.update → fx.update → hud.update(realDt)
→ audio.update(realDt) → render
```
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
| `lights` | `add({x,y,z,color:[r,g,b],intensity,radius,life,fade,fadeIn,flicker})` → light (mutable `x,y,z`, `.set()`, `.kill()`) |
| `fx.add` / `fx.alpha` | glyph particles, additive-HDR / alpha-blended. `spawn({x,y,z,vx,vy,vz,life,size,sizeEnd,glyph,color,colorEnd,alpha,alphaEnd,gravity,drag,spin,rot,flicker,stretch})`. `glyph`: char, string of chars (random pick) or atlas index. |
| `world` | `resolve(pos, radius, bound)` circle collision; `setPusher(slot, x, y, z, r)` grass trample (slot 0 = player, 1–9 = dragon; y > 1.5 = airborne, ignored); `clearPushers(from, to)`; `gust(x, z, strength 0..2, radius)`; `scorch.burnCircle(x, z, r, burn 0..1, heat 0..1)`, `scorch.reset()`; `colliders.blocked(ax,az,bx,bz)`; `meadow.density(x, z)` (grass cover 0..1; the grass itself is drawn by the ASCII pass); `bonfire {x,z}`; `nest {x,z}`; `atmosphere.setBonfireLit(bool)` |
| `player`, `dragon`, `hud`, `audio`, `flow`, `lab` | the modules below |
| `state` | owned by flow: `'title' | 'explore' | 'bossIntro' | 'boss' | 'dead' | 'victory' | 'paused'` |
| `time`, `realTime`, `dt`, `realDt`, `timeScale`, `fps` | clocks |
| `settings` | `{ quality: 0..2, showFps: bool }`; `applyQuality()` re-applies |

Shared combat rules: `src/combat/rules.js` — `TELL`, `RESULT`, `TELL_STYLE`, `DEFENSE`, `POSTURE`,
`tellDefaults(tell)`, `facingDelta(...)`. Never hard-code these windows in actor code.

Render helpers for creature modules:
- `createSurfaceGlyphMaterial(U, opts)` (`render/materials.js`). **v0.2: pass `ascii: <set>`** so the
  part renders through the screen character grid with glyphs that follow the surface direction
  (aGUV +y = "glyph up"). Sets: `'scales'` (chevrons along the flow), `'strands'` (line strokes along
  the flow: hair, cloth folds, membrane veins, blades), `'plates'` (`= #` bands across the flow:
  belly, armour), `'smooth'` (density ramp `. : o O 0 @`: skin, eyes, gems). In ascii mode the cell
  colour is the lit `ink` (per-cell `inkAlt` variation via `altChance`); `base`/`glyphs`/`cell` are
  ignored. Runtime uniforms: `uGlow` (emissive seams/brightness), `uInkGlow`, `uFlash`, `uDissolve`, `uTint`.
- `limbGeometry`, `ellipsoidGeometry`, `hornGeometry`, `cylindricalGUV`, `planarGUV` (`render/glyphGeometry.js`).
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
light combo, LMB hold ≥ 0.3 s then release = charged heavy · RMB hold = block, RMB tap before impact =
parry · Space = dodge roll · Shift = sprint · F = flask · Tab / MMB = lock-on. (E is flow's.)
Deals damage via `game.dragon.takeHit(...)` using `game.dragon.hurtSpheres`; pushes itself out of
`game.dragon.bodyCircles` and resolves vs `game.world.resolve(pos, radius, CONFIG.world.playerBound)`.
On `perfectDodge` it performs Ghostep using `attacker.position`/`attacker.yaw` (teleport behind,
`game.hitstop(slowmoTime, slowmoScale)`, opens `critTimer`). A harsher freeze already running defers the
slow-mo until it ends; actors skip a short freeze while a longer, gentler slow-mo runs, so impact
freezes never swallow a Ghostep.
RMB cancels a charge (the LMB press is consumed); an RMB press during one's own swing is queued and
raises the guard when recovery starts. Streams (breath) only Ghostep when the roll starts into them.

### Dragon — `src/entities/dragon/dragon.js` exports `class Dragon`
```
constructor(game)                      // builds wyvern, sleeping at CONFIG.world.dragonSleep
object3d, position (Vector3, root on ground), yaw
name = 'VAELGRIM, THE CINDER WYRM';  hp, maxHp;  phase: 1|2
posture, maxPosture: number;  broken: boolean   // posture break = staggered + broken
state: 'sleeping'|'waking'|'combat'|'staggered'|'airborne'|'dying'|'dead'
hurtSpheres: Array<{x,y,z,r,part,mult}>  // world space, refreshed every update; part ∈ head|neck|body|tail|wing|leg
bodyCircles: Array<{x,z,r}>              // ground footprint for player push-out (empty while airborne)
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
Damages the player only via `game.player.takeHit(...)` with tell data; announces tells with
`combat:tell` / `combat:flash` and shows an in-world glyph flash in the tell colour.

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
Also renders combat tells (world-anchored ◆ PARRY / ! DODGE marks on `combat:tell`, a pulse on
`combat:flash`), parry / Ghostep / guard-break call-outs, the posture bar, and the crit-window cue.

### Flow — `src/game/flow.js` exports `class GameFlow`
```
constructor(game);  update(dt, realDt)
cameraOverride: null | { focus: Vector3, weight: 0..1, zoom: meters }   // read by main.js
debug: { toState(name) }               // Lab: 'explore'|'boss'|'dead'|'victory' with consistent side effects
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

### Lab — `src/dev/lab.js` exports `class Lab`
```
constructor(game)          // hidden unless URL has ?lab or the user presses F1 / backquote
update(realDt)             // panel refresh + hitbox overlay (runs before flow)
postUpdate()               // main.js calls it after the actors update so the overlay matches this frame
open: boolean
```
Debug panel to test the fight without playing it: trigger any `dragon.debug.abilities()`, phase /
stagger / posture break / kill / reset, jump flow states, god mode, infinite flasks, time scale,
AI on/off, hitbox overlay, teleport. Talks only to the `debug` APIs above.

## Event catalogue (exact names — producers → consumers)
Player → hud/audio/fx/flow:
- `player:attack {kind:'light'|'heavy', combo, charge}` (swing starts), `player:charge {t}` (heavy charge start; t = seconds to full charge),
  `player:hitDragon {damage, part, point, heavy, crit}`, `player:hurt {damage, kind, hp}`,
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
