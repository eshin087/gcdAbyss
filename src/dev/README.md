# The Lab (`src/dev/`)

A debug panel for testing a boss fight without playing it: force any ability, jump phases and
flow states, cheat the player, slow time down, see hitboxes, and measure your parry / dodge timing.
Contract: `docs/ARCHITECTURE.md` → **Lab**. The Lab only talks to the actors' `debug` APIs and
writes only `game.debugTimeScale`. Every call is optional-chained, and a missing API shows `n/a`
in the status line instead of throwing.

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
  of active cheats (god mode, infinite flasks, time scale, loop, AI off). Click it to reopen.
- Section collapse state, the hitbox toggle and the loop period persist in `localStorage`
  (`abyss.lab.v1`). Storage is optional, so private mode works.

## Sections
| Section | What it does |
|---|---|
| **FIGHT** | Wake (plays the intro; from a menu screen the flow returns to `explore` first) · Start fight (skips the intro: `flow.debug.toState('boss')`, which calls `dragon.debug.startFight()`; also used over a downed dragon, since the flow resets it) · Reset (dragon to the nest; mid-fight, after it or from the pause menu the flow returns to `explore` and the player respawns at the bonfire) · Phase 2 · Stagger · Posture break · Kill · HP slider 0–100 % (`dragon.debug.setHp`). |
| **ABILITIES** | One button per `dragon.debug.abilities()` entry, with its number key, a tell chip (white = normal, blue = parry it, red = perfect-dodge it) and a phase tag. Clicking triggers the ability and selects it. **Loop** re-triggers the selected ability every N game-seconds (slider 2–8 s) for parry / dodge practice. The AI is paused while looping and restored afterwards. A busy dragon (`trigger` returned `false`) is retried 0.25 s later. Loop holds while paused / dead / on the victory screen. **AI** toggles `dragon.debug.setAI`. **reload** re-reads the list (it is also polled every second while open). |

Fight actions (abilities, Loop, Phase 2, Stagger, Posture break, Kill) started from the title, pause,
death, victory or intro screen first jump the flow to `boss` (`flow.debug.toState('boss')`, which
starts the fight), so the HUD, music and arena match the forced fight. The jump always happens
**before** the action: a later `startFight` could cancel the ability just forced. From `explore`
nothing is needed, as the flow follows the dragon into `boss` on its own.
| **PLAYER** | God mode · Infinite flasks (toggle `player.debug.god` / `.infiniteFlasks`) · Full heal · Teleport 8 m in front of the dragon or 8 m behind it (facing it, clamped inside the clearing), or to the bonfire spawn. |
| **TIME** | `game.debugTimeScale` = 0 (freeze) / 0.1 / 0.25 / 0.5 / 1 / 2. Game time only: the panel, camera and HUD keep running on real time. |
| **STATE** | Explore · Boss · Dead · Victory via `flow.debug.toState(name)`. Jumping anywhere but Boss ends Loop. |
| **VIEW** | Hitbox overlay: `dragon.debug.hitboxes()` as wireframe spheres (cyan = hurt, red = active attack, falling back to `hurtSpheres`), plus the player's radius ring, facing line and parry arc. The ring turns blue when blocking, gold in the crit window and violet during i-frames. The overlay is one `THREE.LineSegments` in `game.fxScene` with `depthTest: false`. Its fixed buffers are rewritten in place each frame, and it is removed from the scene when toggled off or when the Lab closes. |
| **READOUT** | Dragon state / current action (name · phase · t/dur) / hp / posture / phase / broken / AI. Player state / hp / flasks / crit window / blocking / cheats. Game state and clock. Then the **timing trainer** and the **event list** (below). |

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
| `lab.js` | `class Lab`: the contract surface (`constructor(game)`, `update(realDt)`, `open`), keys, actions, panel build + refresh. Optional extras: `postUpdate()` (see below), `dispose()`. |
| `timingTrainer.js` | `class TimingTrainer`: event + input bookkeeping, pure data (no DOM), testable headless. |
| `hitboxOverlay.js` | `class HitboxOverlay`: the wireframe overlay in `fxScene`. |
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
