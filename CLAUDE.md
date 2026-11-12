# gcdAbyss — instructions for Claude agents

ABYSS is a long-term browser game: a **wuxia skill boss rush** in the vein of Phantom Blade Zero,
with some exploring and RPG elements and fixed rewards (techniques, weapons, abilities; ADR-051),
rendered in an ASCII look inspired by @Ansenjeo's ASCII MMORPG. Today: two levels, each its own page
load (`?level=`): Cinderwood Hollow (the Cinder Wyrm) and the Ashfall Courtyard (the Ash Disciple,
a human duelist). Read this file first, every session.

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
npm run hero-parts  # regenerate src/entities/player/heroParts.js (needs Blender 4.2+; ADR-037)
```
Levels: `?level=ash` loads the Ashfall Courtyard (default: Cinderwood); the title screen and the Lab
pick one too. In the dev server: append `?lab` to the URL (or press **F1**) for the **Lab** — trigger any boss
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
  prefixes: `render`, `world`, `player`, `dragon`, `enemies`, `level`, `combat`, `ui`, `flow`, `audio`,
  `lab`, `docs`, `build`, `test`.
- **Every change goes through a PR — `main` is protected** (no direct pushes, even for admins;
  required check `test-and-build` = `npm test` + `npm run build` on an up-to-date branch; linear
  history, squash/rebase merge, branches auto-delete). Flow: branch → push → `gh pr create` → CI +
  Vercel preview deployment on the PR → squash-merge → Vercel deploys `main` to production
  (gcdabyss.vercel.app). Never bypass the protection.
- **Deployment hygiene (Vercel storage):** the project keeps deployments 30 days (preview,
  production, canceled, errored). `vercel.json` `ignoreCommand` skips deployments for commits that
  only touch docs / *.md / tests / .github / .claude — keep doc-only work in its own commits.
  It only diffs the pushed tip against its parent (HEAD^..HEAD), so on a PR branch make the LAST
  pushed commit a code commit when you need a fresh preview. Don't create manual CLI deployments (`vercel deploy`); let the Git integration deploy.
- **Releases**: bump `version` in `package.json`, move `[Unreleased]` to a version heading in the
  changelog, tag `vX.Y.Z`.

## Layout
```
src/core       config, input, camera rig, math, rng, events
src/render     glyph atlases, shared shader lib, materials, particles, lights, frame pipeline
src/world      ground, grass, forest/stones/bones/bonfire, scorch map, atmosphere, colliders
src/combat     shared combat rules: hit resolution, guard/parry/dodge, attack tells
src/entities   player/ (gear/ = equipment slot items)  dragon/  enemies/ashDisciple/  (future: npcs/)
src/levels     level registry (?level=): the set, the boss, the flow's lines per level
src/ui         HUD, menus           src/game   flow (title, boss intro, death, victory)
src/audio      procedural WebAudio  src/dev    Lab / debug tools
tests/         headless integration sims + static checks
docs/          ARCHITECTURE, STYLE, COMBAT, ROADMAP, DECISIONS, DEVLOG
```
