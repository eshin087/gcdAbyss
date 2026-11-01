# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [SemVer](https://semver.org/) (0.x = pre-alpha, anything may change).

## [Unreleased]

## [0.2.0] - 2026-11-01
Combat & presentation pass.

### Added
- Phantom-Blade-Zero-style combat: hold RMB to block, tap RMB just before impact to parry, perfect
  dodge (≤ 0.2 s before impact) → **Ghostep** (blink behind, ×0.3 slow-mo, 1.6 s crit window).
- Attack tells on every dragon attack: white (normal), blue ◆ PARRY, red ! DODGE (unblockable,
  unparryable) with world-anchored marks, off-screen arrows, red screen-edge pulse, a timing flash
  0.35 s before impact, in-world glyph flashes, ground rings for red AoEs and matching audio cues.
- Boss posture meter (gold bar): parries and hits fill it; a posture break opens ×2.2 crits.
- Charged heavy attack (hold LMB, release) with a charge hum and blade glow.
- Roar ring ability (phase-2 transition shock wave, also triggerable in the Lab).
- **Lab** debug mode (`?lab`, F1 or backquote): trigger any ability (keys 1–9), loop abilities,
  phase 2 / stagger / posture break / kill / reset, HP slider, flow state jumps, god mode, infinite
  flasks, time scale and frame stepping, AI toggle, hitbox overlay, teleport, parry/dodge timing
  trainer.
- Shared combat rules module (`src/combat/rules.js`) and contracts for future enemies.
- Branch protection on `main` (PR + green `test-and-build` required), Vercel `ignoreCommand` for
  docs-only commits.
- Headless tests for parry, block, red tells / Ghostep, the Lab and event-contract payloads.

### Changed
- Hero is now an anime-style black-coat swordsman (long coat panels, spiky hair, glowing blade).
- Everything visible renders through one screen-space ASCII grid: procedural ASCII grass meadow,
  stones with outline glyphs, creatures drawn with directional scale / strand / plate glyphs.
- Dragon is 25 % bigger; attack ranges, hitboxes and FX scale with it.
- Approachable balance: player HP 160, 5 flasks, gentler dragon damage and opening cooldowns.
- AI only picks attacks from ranges where they can actually land; charge and fireball timing flashes
  re-time against a moving player.

### Fixed
- Impact freezes no longer swallow a Ghostep slow-mo.
- Phase 2 can no longer be skipped by burst damage (phase gate).

### Removed
- Stamina (and the stamina bar).
- Instanced 3D grass (replaced by the ASCII meadow).

## [0.1.0] - 2026-11-01
First playable vertical slice: *The Cinder Wyrm*.

### Added
- Rendering foundation: glyph atlases, shared shader library (moonlight, pooled fire lights, moon
  shadow map, radial fog, scorch map), screen-space ASCII grid pass for props (stone / leaf ramps),
  surface-glyph material for creatures, glyph particles (additive HDR + alpha), bloom + ACES grade.
- World: glyph-stroke grass (~260k instances) with wind, trample pushers, wing gusts and burn;
  procedural forest ring (oaks, pines, dead trees), broken standing-stone circle, flagstones, bone
  pile with a giant ribcage, bonfire, fireflies, falling leaves, low mist.
- Player knight: procedural model and animation, light combo, heavy attack, roll with i-frames,
  sprint, flasks, lock-on, stamina.
- Wyvern boss *Vaelgrim, the Cinder Wyrm*: procedural rig (IK legs, spring tail, folding membrane
  wings), sleep → wake intro, bite / wing-claw swipe / tail sweep / stomp / fire breath / fireball
  volley / charge, phase 2 at 50% (molten seams, faster, leap slam), stagger, death dissolve.
- HUD in Ansenjeo's MMO style: player frame, boss bar, tabbed log, minimap, name tags, lock-on
  reticle, banners (YOU DIED, WYRM VANQUISHED), title, pause, help.
- Game flow: title → explore → boss intro → boss → death/retry or victory; bonfire rest.
- Procedural audio: ambience, SFX for every combat event, boss music with phase-2 layer.
- Single-file build (`npm run build`), dev server, headless integration tests.
