# The Lab (`src/dev/`)

A debug panel for testing a boss fight without playing it: force any ability, jump phases and
flow states, cheat the player, slow time down, see hitboxes, and measure your parry / dodge timing.
Contract: `docs/ARCHITECTURE.md` → **Lab**. The Lab only talks to the actors' `debug` APIs and
writes only `game.debugTimeScale` (plus, for the model viewer, `game.viewOverride` and
`world.debug.setVisible`). Every call is optional-chained, and a missing API shows `n/a` in the
status line instead of throwing.

## Opening it
- **F1** or **`** (backquote) toggles the panel. It also opens at load when the URL has `?lab`
  (`http://localhost:5173/?lab`).
- While open, **1–9** trigger the first nine abilities, and **[** / **]** step the time scale down / up.
  The Lab consumes these keys while open (capture-phase listener), so they never reach the game and
  cannot dismiss the title or death screen through the flow's "any key".
- The panel (left side, below the HUD player frame) takes pointer events only over itself. The game
  canvas still gets clicks everywhere else. Buttons never keep keyboard focus, so Space and WASD
  stay game keys.
- While the panel is closed, an ember badge at the top centre (`LAB · god · x0.25`) reminds you
  of active cheats (god mode, infinite flasks, attack speed, the cut's fan look, the shudder off,
  time scale, loop, AI off). Click it to reopen.
- Section collapse state, the hitbox toggle and the loop period persist in `localStorage`
  (`gcd.lab.v1`). Storage is optional, so private mode works.

## Sections
| Section | What it does |
|---|---|
| **OUTFIT** | (kept for later use; today's look is the default) One button per hero outfit option (`game.heroLooks`, `player/gear/looks.js`), in two columns: Wanderer (today) across the top, then each new look beside its twin with the face in shadow: Moonlit Robe · Robe (shaded), Swallow · Swallow (shaded), Moon Warden · Warden (shaded). A click calls `game.pickHeroLook(id)`: the hero's rig is rebuilt in the new outfit at once (`player.setLook`; the pose restarts from the ready stance) and `?heroLook=<id>` is written into the URL, so a reload keeps it. The worn one is highlighted. Not built without `game.heroLooks` (the tests). |
| **FIGHT** | Wake (plays the intro; from a menu screen the flow returns to `explore` first) · Start fight (skips the intro: `flow.debug.toState('boss')`, which calls `dragon.debug.startFight()`; also used over a downed dragon, since the flow resets it) · Reset (dragon to the nest; mid-fight, after it or from the pause menu the flow returns to `explore` and the player respawns at the bonfire) · Phase 2 · Stagger · Posture break · Kill · HP slider 0–100 % (`dragon.debug.setHp`). |
| **ABILITIES** | One button per `dragon.debug.abilities()` entry, with its number key, a tell chip (white = normal, blue = parry it, red = perfect-dodge it) and a phase tag. Clicking triggers the ability and selects it. **Loop** re-triggers the selected ability every N game-seconds (slider 2–8 s) for parry / dodge practice. The AI is paused while looping and restored afterwards. A busy dragon (`trigger` returned `false`) is retried 0.25 s later. Loop holds while paused / dead / on the victory screen. **AI** toggles `dragon.debug.setAI`. **reload** re-reads the list (it is also polled every second while open). |
| **WORLD → life** | The living world (ADR-163; `world/life/`, `?life=`; at the foot of WORLD, not on the training room). **life**: one toggle per piece (wind · litter · steps · weather · creatures · air · arrival · answer), live (`LIFE.on`). **life x**: all / off, and the strength quiet 0.6 · natural 1 · strong 1.5 (`?lifeK=`). Then the layers' own buttons (`world.life.actions`; a status line says what each did): **gust front**, **burst at hero**, **lull** (the wind); **<spell> now** for each spell of the level, easing in over 8 s (the weather); **leaf shower**, **scatter at hero** (the litter); **surface here** (what the ground is under the hero), **stamp** (a heavy landing) (the steps); **startle at hero**, **birds return**, **flock flees** (the roost nearest the camera bursts out, away from the hero), **animals bolt** (every animal within 60 m), **life returns** (the roosts, the animals and the perched birds back now) (the creatures, ADR-177); **roar's answer**, **hush 2 s** (the answer); **tremor at hero** (a heavy blow beside him: what stands near shakes) (the tremor, ADR-177); **smoke at hero**, **crater dust at hero** (the aftermath, ADR-177); **light lamps** (every standing lantern catches, the nearest the hero first), **gutter at hero** (a heavy shock at the hero: the lamps near him gutter, the nearest lit one at least), **lamps out** (every burning lantern goes dark in a puff; they can be lit again) (the lamps, ADR-180; on a level with no lantern they do nothing; **lamps out** leaves the Ring's braziers burning); **arrival (replay)** (the opening shot again, from explore). What a button moves shows only while that layer's piece is on (the tremor, the aftermath and the lamps are the piece 'answer'; the sounds of any of them need the piece 'air' too; 'surface here' always answers; 'roar's answer' acts through the wind, the creatures and the litter, whichever are on). |
| **WORLD → Blade** | (ADR-177; beside Bites) `Blade: through` / `Blade: stops`: the hero's blade on a rock or a tree it does not fell goes clean through, chipped along the cut (default), or stops there and bounces back as before (`?cutStop=1`, ADR-132). Live: read at each swing; with bites off (`?chip=0`) it never stops. |

Fight actions (abilities, Loop, Phase 2, Stagger, Posture break, Kill) started from the title, pause,
death, victory or intro screen first jump the flow to `boss` (`flow.debug.toState('boss')`, which
starts the fight), so the HUD, music and arena match the forced fight. The jump always happens
**before** the action: a later `startFight` could cancel the ability just forced. From `explore`
nothing is needed, as the flow follows the dragon into `boss` on its own.
| **PLAYER** | God mode · Infinite flasks (toggle `player.debug.god` / `.infiniteFlasks`) · Full heal · **stance** auto / at ease / fight (`player.debug.fightStance`: hold one of the hero's two stances, ADR-114; auto = the game's rule) · **idles** ref / new / old (ADR-207 / ADR-186, `idles.js` `setIdles`, also `?idles=new|old`: the reference's one-handed stand, two-handed fight hold and put-away (the default), ADR-186's rests, habits and tricks, or the hand on the belt as before) · **guard** ref / ward (ADR-207, `refStance.js` `setGuard`, also `?guard=ward`: the braced guard with the blade across his face, or the cross ward before) and **idle ▸** (one button per rest and action of both stances, `stow` the reference's put-away: plays it now, `anim.setRest` / `anim.playIdle`; one of the other stance's or another mode's is refused in the badge) · **atk** slider ×0.6–×1.6 (`player.debug.attackSpeed`: every swing of the hero runs that much faster, 1 = the game's pace; shown in the badge) · Teleport 8 m in front of the dragon or 8 m behind it (facing it, clamped inside the clearing), or to the bonfire spawn. **cut** row: **gash** / **fan** pick the look of a landed cut (`combat/cutFx.js` `setCutStyle`; the slash line, or a wider fan of sparks with no line; also `?cutfx=fan`; the badge shows `cut fan`) and **shudder** toggles a struck duelist's flicker through the freeze (`dragon.shudderK` 1 / 0; only on a duelist; the badge shows `no shudder`). **slash** row (ADR-240, `slashFx.js` `setSlash`, also `?slash=arc`): line / arc, every swing's mark (the instant straight slash, the default; the curved crescent as before) · **combo** row (ADR-240, `combos.js` `setCombo`, also `?combo=a|b|c|d`): prod / a Iai / b Tempest / c Mountain / d Dancer, four light combos for the ending slash, each with its feel and hand · **endslash** / **endbeat** rows (ADR-240, `slashFx.js` `setPlace` / `setBeat`, also `?endslash=target|body|enemy|blade`, `?endbeat=beat|0`): where and when the ending slash is drawn · **feel** row (ADR-240, `feel.js` `setFeel`, also `?feel=snap|weight|flow`): prod / snap / weight / flow, every sword attack's moves on another clock with its own free hand · **offhand** row (ADR-240, `offHand.js` `setOffHand`, also `?offhand=side|back|quiet|out|sign`): auto (the combo's) / prod / side / back / quiet / out / sign, the free hand in a one-handed swing (ADR-292: `out` the counterweight, combo A's now; `sign` sword fingers at the foe) · **cloth** / **bearing** / **flick** rows (ADR-292, `clothCalm.js` `setCloth`, `bearing.js` `setBearing` / `setFlick`, also `?cloth=old`, `?bearing=0`, `?flick=0`): the cloak held calm in the swings, the chest-up bearing, the chiburi after combo A; the **endslash** row's `sweep` (the default) lays the slash on the sword's on-screen path · **mystic** row (ADR-182, `swordMystic.js` `setMystic`, also `?mystic=0` for off): off / flame, the sword's tight green flame in the hero's own micro letters (on by default), right after `sword` · **sword** row: one button per look in `gear/index.js` `SWORD_PARAM` (the owner's pick, `?sword=`): equips it (`player.equip('weapon', id)`, a rebuild: Lab only); the worn one is lit. · **flurry** x1 / x2 / x3 / x4 / x5 / x7 (`player.debug.flurry(n)`: the answer to a perfect dodge at a streak of n, on the boss, from where the hero stands: within 30 m of the wyrm's head or 12 m of a duelist) · **art** (`player.debug.flurryArt`: pins the last blow, flurry.js `ARTS`; "any" = at random). Console: `player.debug.streak(n)` sets the streak. `player.debug.noRiposte = true` switches the parry's riposte off; on a duelist `__game.dragon.debug.streak(n)` sets his streak of guards and `.flurry(n)` starts his flurry of n blows. |
| **TIME** | `game.debugTimeScale` = 0 (freeze) / 0.1 / 0.25 / 0.5 / 1 / 2. Game time only: the panel, camera and HUD keep running on real time. |
| **STATE** | Explore · Boss · Dead · Victory via `flow.debug.toState(name)`. Jumping anywhere but Boss ends Loop. |
| **VIEW** | Hitbox overlay: `dragon.debug.hitboxes()` as wireframe spheres (cyan = hurt, red = active attack, falling back to `hurtSpheres`), plus the player's radius ring, facing line and parry arc. The ring turns blue when blocking, gold in the crit window and violet during i-frames. The overlay is one `THREE.LineSegments` in `game.fxScene` with `depthTest: false`. Its fixed buffers are rewritten in place each frame, and it is removed from the scene when toggled off or when the Lab closes. **Showroom** (look-dev preset) and **Camera default**. **MODEL VIEW** (see below): Hero / Dragon pick the target and enter the viewer, Dark toggles the world, Exit returns to the game camera; Front / 3/4 L / 3/4 R / Left / Right / Back / Rear R / Rear L = yaw 0 / 35 / 325 / 90 / 270 / 180 / 215 / 145 at pitch 8 (R = the hero's right side, his pauldron and sword side: the reference sheet's 3/4 and rear 3/4), Game = the gameplay camera (58°, world-fixed yaw, the rig's current distance: normal play size, centred on the actor's root), **Spin** = a turntable at eye level. **Sheet** = every angle at once (below). Looks: **ASCII** (the game render), **Solid** (the bare geometry plain-lit, no ASCII pass: geometry vs renderer problems), **Source** (the pass input), **Lines** (only the ink lines). The line under the buttons shows the framing. |
| **READOUT** | Dragon state / current action (name · phase · t/dur) / hp / posture / phase / broken / AI. Player state / hp / flasks / crit window / blocking / cheats. Game state and clock. Then the **timing trainer** and the **event list** (below). |

## Training (ADR-099)
A fighting game's training mode: every situation worth seeing, one click each.
- **Open:** **F4**, the **TRAINING** button in the Lab's header, or load with `?training`
  (`http://localhost:5173/?training&stage=lab`). The panel sits on the right, under the minimap.
- **The list** (`dev/training.js` `SITUATIONS`, for the boss loaded): HERO STREAK (perfect dodges
  at a streak of 1, 2, 3, 5, 7; a whole string perfect-dodged; the streak lost / kept), HERO ARTS
  (each art of this boss's three at four blows; the longest flurry), PARRY & RIPOSTE (a parry, a
  perfect parry, ripostes ×3 / ×7, a string deflected, a long string, a string blocked, the blade
  lock, the trade clash, the mikiri), BOSS STREAK (a duelist: his streak built until he answers; his
  flurry of 3 / 5 / 7 parried, perfect-parried, blocked, one let through, perfect-dodged), OFFENCE
  (the chain, the charged cleave, the crit window after a Ghostep, the execution, the guard crush),
  GETTING HIT (a hit, a knockdown, a guard break, death), BOSS STATES (stagger, posture break, each
  phase, his death) and BOSS MOVES (every move he has, answered with the toolbar's ANSWER). A
  situation that needs what this boss lacks is not listed (the wyrm has no guard and no blade).
- **Click a row** (or ↑ ↓ and Enter) and it plays: the runner puts the fight in place (flow in
  `boss`, his AI off, god mode, the hero placed, the streaks set), starts it, and plays the hero's
  side through the input's virtual keys: it parries, blocks, dodges, mashes and swings on the boss's
  own glints. A banner over the fight names the situation, then ✓ (with its time) or ✗ and what was
  not seen; the row keeps the mark. **R** replays, **Esc** stops, **LOOP** repeats it.
- **SPEED** ×1 / ×0.5 / ×0.25 / ×0.1 (`game.debugTimeScale`, as the Lab's TIME).
- **STAGE:** Training room reloads onto the lab stage (`?stage=lab`); Level set goes back to the
  level's own. **BOSS** reloads into another level (the stage is kept).
- Console: `__game.lab.training.run(id)`, `.list()`, `.replay()`, `.step(±1)`, `.loop`,
  `.moveAnswer`, `.lastResult`.
- Tests: integ / duel / lord TRAINING run every situation for their boss and check each one shows
  what it promises (`expect`).
On the Ashfall level a **TERRAIN** category stages each of the Ash Disciple's courtyard moves where it
works (the hero under a pillar, a lantern or the bell in reach) on a courtyard put back whole (ADR-111);
the same moves under BOSS MOVES start from where he stands and go for the nearest piece.

On the Obsidian Throne a **TERRAIN** category stages each of the Starless Lord's moves on the
crater's pieces where it works (ADR-109), on a crater put back whole; the same moves under BOSS MOVES
start from where he stands and take what there is. Not on the lab stage: it has no pieces.

## Model viewer
Renders the hero or the dragon from the angles of a character sheet, for comparing the models with
concept art (the game camera is a fixed 58° top-down view). Console API (exact contract in
`docs/ARCHITECTURE.md` → Lab → Model viewer):
```js
__game.lab.modelView({ target: 'dragon', yaw: 90, pitch: 8, dark: true })  // left side, eye level, world hidden
__game.lab.modelView({ target: 'hero', yaw: 35, dark: true, dist: 4 })     // 3/4, fixed distance
__game.lab.modelView({ target: 'dragon', yaw: 30, dark: true, dist: 9, height: 8.4, forward: 11.5 }) // head study*
__game.lab.modelView({ target: 'hero', yaw: 215, dark: true, look: 'solid' }) // rear 3/4 (his right), bare geometry
__game.lab.modelView({ target: 'hero', dark: true, spin: true })             // turntable
__game.lab.modelView({ target: 'hero', dark: true, sheet: true })            // every angle, live tiles
__game.lab.modelView(null)                                                  // back to the game camera
```
- **Sheet:** ten live tiles right of the Lab panel: front, front 3/4, right side, left side, back,
  rear 3/4, rear-left 3/4 at eye level (one fit for the whole turn, the body centred), and the
  gameplay camera (its 58° pitch and the rig's distance, drawn ×2 nearest-neighbour) on the hero's
  back, front and right side. Each tile refreshes every 20 frames (each angle is held two frames and
  read back after the render, `lab.postRender`). The tiles are crops of the frame's centre, so a long
  reach (the sword) may run past a narrow tile's side.
- **Looks** (`look`): `solid` sets `U.uHeroSolid` (the hero's materials draw a clay render with alpha
  0, passed through by the ASCII pass), `source` / `lines` set the pass's `uHeroDebug` 1 / 2; exit
  restores the ASCII look. Compare the same pose in Solid and ASCII to tell a geometry problem from a
  renderer one.
\* the current wyrm's `head` joint sits ≈ 11.5 m forward, 8.4 m up from its root in the idle pose;
re-measure for a new model (`head.getWorldPosition()` relative to `dragon.position`, rotated by −yaw).
- `yaw` is measured around the actor's own facing (0 = its front faces you, 90 = its left side,
  180 = its back, 270 = its right); `pitch` 8 is sheet eye level, 58 the game camera.
- `dist` / `height` omitted = auto-fit: the whole actor (wings, tail, sword included) fits the frame
  with ~10 % margin at any window size. The fit is measured on the pose at the call; pass `dist` to
  keep the scale fixed across poses. The call returns the fitted numbers.
- The camera follows the actor's position and facing every frame (a turning dragon stays in side
  view). `lockYaw: true` samples the facing once instead (use it for spins / turns).
- `dark: true` hides ground, grass, forest, stones, flagstones, bones, bonfire and the atmosphere
  (mist, fireflies, leaves) and, by default (`solo`), the other actor. Lights, the actor's own
  shadows on itself and its glow stay. Particles already in flight are dropped when dark turns on.
- While viewing: dragon AI off, god mode on, HUD hidden, hero aim pinned straight ahead (mouse
  movement does not turn it). Exit restores all of them (AI / god only if the viewer changed them).
- Poses: `__game.dragon.debug.trigger('tail')`, player inputs (LMB swing, Space roll...) or methods,
  then `__tick(1/60, n)` to step (the tab may be throttled; the game auto-pauses on blur:
  `__game.flow.resume()`).
- Clean renders: close the panel (F1) or capture the canvas: right after a `__tick` in the same JS
  task, `__game.renderer.domElement.toDataURL('image/png')` holds the full-resolution frame without
  any DOM overlay.
- Limits: glyph particle FX (slash streaks, embers) are sized for the 36 m gameplay camera and look
  huge up close; the carved stone material assumes the 58° pitch (hidden in dark mode anyway).

## Timing trainer
Measured on the **game clock** (`game.time`), the same clock as the parry and perfect-dodge
windows, so the numbers stay true at any time scale.
- `combat:tell {impactIn}` registers a predicted impact. The **next:** line counts it down, and
  the bar shows the approach: `.` before the window, `=` inside the parry window (or the
  perfect-dodge window for red tells), and `#` for now.
- RMB and Space presses are read from `game.input` every frame, even while the panel is closed.
- When the result event fires (`player:parry` / `block` / `guardBreak` / `perfectDodge` / `dodge` /
  `hurt`), the trainer reports the press time relative to that impact in ms (negative = before).
  It also says why a press failed: "52 ms early for a parry", "red cannot be blocked, dodge it",
  "late Space +80 ms". A press up to 0.5 s after an unanswered hit counts as late.
- Each press is graded once. Burn damage-over-time ticks (`player:hurt {kind:'burn'}`) are not
  graded, and a block or guard break that also emits `player:hurt` for the same impact is graded
  once. Repeated passive results (breath ticks, hits on a held guard) merge into `xN`. Every hit you
  answered with its own press keeps its own row.
- Forcing an ability drops the predictions of the attack it replaced. Stagger, posture break,
  phase 2, kill, reset and state jumps drop all predictions.
- `Δ` on the right is the actual impact time minus the tell's `impactIn` prediction. If it is
  amber (> 60 ms off), the attack's announced timing does not match its real hit frame, which
  means the tell is unfair and the attack data needs fixing.
- The **EVENTS** list shows the last 8 combat events (every one, including burn ticks) with
  game-time stamps. Repeats within 0.3 s merge into `xN`.

## Files
| File | Role |
|---|---|
| `lab.js` | `class Lab`: the contract surface (`constructor(game)`, `update(realDt)`, `open`), keys, actions, panel build + refresh. Optional extras: `postUpdate()` (see below), `postRender()` (after the frame is drawn: the sheet's read-back), `dispose()`. |
| `timingTrainer.js` | `class TimingTrainer`: event + input bookkeeping, pure data (no DOM), testable headless. |
| `hitboxOverlay.js` | `class HitboxOverlay`: the wireframe overlay in `fxScene`. |
| `modelView.js` | `class ModelViewer` + `VIEW_ANGLES`, `VIEW_LOOKS`, `SHEET_VIEWS`: the model viewer (framing, auto-fit, dark / solo / HUD / AI / god handling, turntable, the live sheet overlay, the hero's look-dev renders). |
| `labDom.js` | Tiny DOM helpers (`el`, `setText`, `setClass`, `button`, `slider`, `section`). |
| `labStyle.js` | The injected `<style>`, matching the HUD (JetBrains Mono 11 px, dark panel, ember / blue / red accents from `TELL_STYLE`). |

## Cost
Closed: two input-edge checks per frame, plus a badge check every 0.5 s. Open: the readout refreshes
12×/s (text nodes are only written when they change), the impact bar updates per frame only when
its cursor moves, and the overlay rewrites a preallocated buffer.

## How a future enemy plugs in
Implement the same `debug` shape as the dragon (ARCHITECTURE.md → Dragon):
```js
debug: {
  abilities(): [{ name, label, tell: 'normal'|'blue'|'red', phase }],
  trigger(name): boolean,          // false = busy / refused (Loop retries); wake / start the fight if needed
  setAI(enabled), aiEnabled,
  wake(), startFight(), phase2(), stagger(), postureBreak(), kill(), reset(), setHp(fraction),
  hitboxes(): [{ x, y, z, r, kind: 'hurt'|'attack' }],
  currentAction?(): string | { name, phase, t, dur },   // optional, for the readout
}
```
plus the usual actor fields the readout reads (`state`, `hp`, `maxHp`, `posture`, `maxPosture`,
`phase`, `broken`, `position`, `yaw`). Then point `Lab#target` at it. Today the getter returns
`game.dragon`. With several enemies, add a target picker that sets it. Every Lab feature goes
through `target` and its `debug` API, so nothing else changes. Attacks must announce
`combat:tell {source, attack, tell, impactIn}` and `combat:flash` for the trainer to grade them.

## Wishlist for the foundation
- `main.js` could call `game.lab.postUpdate?.()` after `dragon.update` (before render). The
  overlay then draws this frame's hitboxes instead of the previous frame's. Without the hook it
  lags one frame, which is harmless.
