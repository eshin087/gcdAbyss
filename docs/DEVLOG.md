# Dev log

Chronological session notes — newest first. Each entry: date, goal, what changed, decisions,
verification, open issues / next steps. Keep entries short; link commits/PRs when available.

---

## 2026-11-01 — Session 2: combat & presentation pass (v0.2.0)
**Goal:** the owner's v0.2 feedback (see Session 1) plus a long-term repo/deploy setup.

**Done**
- GitHub repo `eshin087/gcdAbyss` (public) + Vercel project `gcdabyss` (Git integration, `main` =
  production, PR previews, 30-day retention). `main` is protected: PR + green `test-and-build`
  required, even for admins (ADR-006).
- Rendering: one screen-space ASCII grid for everything (ADR-007) — procedural grass meadow, stone
  outlines, creature glyph sets with flow angles.
- A parallel agent workflow (builders → reviewers → integration) built the dragon (tells, posture,
  ×1.25 size, roar ring), the black-coat hero (block / parry / Ghostep / charged heavy), HUD / audio
  / flow tell presentation and the Lab. Reviewers fixed ~30 issues (flash timing vs moving players,
  AI picking attacks that can't land, Ghostep slow-mo turning into a freeze, Lab keys leaking into
  the game, ...). Integration rewrote the tests: 195 asserts, AI seeds 1–40 all green.
- Browser playtest (Lab): blue PARRY and red DODGE marks read clearly; perfect dodges at 0.2 /
  0.15 / 0.1 s before impact all Ghostep; posture break + phase-2 roar work; no console errors.
  Tuned creature cells: dark backing (`uCreatureBg` 0.04) and `uCreatureLum` 4.2 → 3.0 so the dragon
  reads as glyphs instead of white tiles; ink-independent moon rim for the black coat; grass gain
  2.3 → 1.9 so creatures pop.
- `main.js` calls `lab.postUpdate()` after the actors so the hitbox overlay isn't a frame late.

**Decisions:** ADR-007 (single ASCII grid), ADR-008 (tell-driven combat, no stamina), ADR-009
(phase gate).

**Open issues / next**
- Human playtest of balance: the god-mode bot kills the wyrm in ~20 s of combat (crits stack).
- From straight ahead only the overhead combo hit reaches the bigger wyrm's chest.
- The hero is small at default zoom; consider a stronger rim / ground ring.
- Breath can't hit a hero standing under the head (< ~7 m); the AI never picks it there.
- Not yet heard in a browser: tell audio levels, charge hum, Ghostep low-pass.

---

## 2026-11-01 — Session 1: from reference study to playable slice (v0.1.0)
**Goal:** a demo matching @Ansenjeo's ASCII MMORPG look (camera, art style) with a dragon in a forest.

**Done**
- Studied the reference (X banner + 4 clips): steep top-down perspective camera, three glyph
  techniques (arranged strokes, screen-grid ASCII, glyph FX), night palette, fire light spill.
  Findings in `docs/STYLE.md`.
- Built the rendering foundation + world myself; validated against the reference via screenshots.
- Parallel agent workflow built the dragon, player, HUD/flow and audio modules against
  `docs/ARCHITECTURE.md`, each independently reviewed, then an integration check (35 events wired,
  headless sims for win / death / retry / pause / breath).
- Playtest fixes: opening breath killed a standing player in ~2 s (tick 9→5, range 13→11.5,
  opening cooldowns); sword hitbox more forgiving (blade radius 0.05→0.22); phase-2 molten glow
  reduced to thin seams; shadow lookups use `textureLod`.

**Feedback from the owner (drives v0.2)**
- Loves the overall look; trees are the reference for "perfect ASCII feel".
- Wants: anime (SAO-like) characters; more detailed stone ASCII; creatures less "solid" / more
  ASCII; grass more ASCII; bigger dragon; much easier fight, no stamina (RPG/MMO not pure souls);
  block + parry + perfect dodge with Phantom-Blade-Zero-style tells; a Lab/debug mode;
  long-term repo + docs structure.

**Next:** v0.2 combat & presentation pass (see ROADMAP M1).
