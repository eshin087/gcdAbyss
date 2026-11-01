# gcdAbyss — instructions for Claude agents

ABYSS is a long-term browser RPG: an Elden-Ring-scale action RPG with MMO-style systems, rendered
in an ASCII look inspired by @Ansenjeo's ASCII MMORPG. Today it is a single-zone vertical slice
(one boss: the Cinder Wyrm). Read this file first, every session.

- Repo: https://github.com/eshin087/gcdAbyss · Live: https://gcdabyss.vercel.app (auto-deploys `main`)
- Stack: Three.js 0.180 (WebGL2), plain ES modules, no framework, esbuild only for the release bundle.

## Start-of-session checklist
1. Read `docs/DEVLOG.md` (latest entries first) and `CHANGELOG.md` → `[Unreleased]` to see where work stands.
2. Read the docs relevant to your task:
   - `docs/ARCHITECTURE.md` — module contracts, `game` context, event catalogue, frame order. **Source of truth for cross-module APIs.**
   - `docs/STYLE.md` — the ASCII art direction (what makes it look right; how each technique works).
   - `docs/COMBAT.md` — combat rules: attack tells, block / parry / perfect dodge, balance numbers.
   - `docs/ROADMAP.md` — where the project is going; pick work from here when unsure.
   - `docs/DECISIONS.md` — architecture decision records (why things are the way they are).
3. `npm install` if `node_modules/` is missing.

## Commands
```bash
npm run dev      # http://localhost:5173 (zero-dependency static server, no build step)
npm test         # headless integration sims (real game modules, mocked DOM/WebGL) + glyph check
npm run build    # single-file dist/index.html (what Vercel serves)
```
In the dev server: append `?lab` to the URL (or press **F1**) for the **Lab** — trigger any boss
ability / phase / transition, god mode, time scale, hitbox overlay. Console: `__game` (everything),
`__tick(dt, frames)` (step the sim even when the tab is hidden), `__inspect(x, y, w, h)` (magnify).
In Claude Code the preview config is `.claude/launch.json` (`abyss-dev`).

## Rules
- **Contracts first.** Cross-module APIs and event names live in `docs/ARCHITECTURE.md`. If you
  change one, update that doc in the same commit and grep every producer/consumer.
- **Content is data.** Attack definitions (timings, damage, tell type), tuning numbers and enemy
  stats live in `tuning.js` / data files, not buried in logic. New enemies reuse the shared combat
  system (`src/combat/`) and the actor contract.
- **ASCII look is a feature.** Anything visible must go through the glyph systems described in
  `docs/STYLE.md` (screen-grid ASCII, surface glyphs, glyph particles). No plain shaded meshes.
  Only glyphs in the world atlas may be passed to `gi()` / materials / particles — `npm test` checks.
- **Combat must be readable.** Every enemy attack declares a tell type (`normal` / `blue` parry /
  `red` perfect-dodge) and a windup long enough to react to. See `docs/COMBAT.md`.
- **Never freeze the frame.** Per-frame code must not throw; `main.js` isolates module errors, but
  guard optional references and avoid NaN. No heavy per-frame allocations.
- **Verify visually.** Rendering/feel changes need a browser check (dev server + screenshots, the
  Lab, `__tick`). Logic changes need `npm test` green. Add/extend tests in `tests/` for new systems.
- **Keep history.** Every working session ends by:
  1. adding a dated entry to `docs/DEVLOG.md` (what changed, why, what's next, open issues),
  2. updating `CHANGELOG.md` `[Unreleased]` (Added / Changed / Fixed / Removed),
  3. recording any significant design choice as a new ADR in `docs/DECISIONS.md`,
  4. updating `docs/ROADMAP.md` checkboxes.
- **Commits**: small, imperative subject (`combat: add parry window`), body explains why. Area
  prefixes: `render`, `world`, `player`, `dragon`, `combat`, `ui`, `flow`, `audio`, `lab`, `docs`,
  `build`, `test`. `main` must always build and pass `npm test` (CI enforces it) because Vercel
  deploys every push to `main`. Use feature branches + PRs for multi-session work.
- **Releases**: bump `version` in `package.json`, move `[Unreleased]` to a version heading in the
  changelog, tag `vX.Y.Z`.

## Layout
```
src/core       config, input, camera rig, math, rng, events
src/render     glyph atlases, shared shader lib, materials, particles, lights, frame pipeline
src/world      ground, grass, forest/stones/bones/bonfire, scorch map, atmosphere, colliders
src/combat     shared combat rules: hit resolution, guard/parry/dodge, attack tells
src/entities   player/  dragon/   (future: enemies/<name>/, npcs/)
src/ui         HUD, menus           src/game   flow (title, boss intro, death, victory)
src/audio      procedural WebAudio  src/dev    Lab / debug tools
tests/         headless integration sims + static checks
docs/          ARCHITECTURE, STYLE, COMBAT, ROADMAP, DECISIONS, DEVLOG
```
