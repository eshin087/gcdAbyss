# Roadmap

Vision: an Elden-Ring-like open-world action RPG with MMO-style systems (party, chat, classes,
loot, shared world), presented entirely in a crafted ASCII look. Combat is readable and fair
(clear tells; block / parry / perfect dodge inspired by Phantom Blade Zero), not a stamina-gated
pure soulslike. Built incrementally as browser vertical slices that are always playable.

Legend: `[x]` done · `[~]` in progress · `[ ]` planned

## M0 — Vertical slice: the Cinder Wyrm (v0.1)
- [x] ASCII rendering foundation (grid props, surface glyph creatures, glyph particles, fire light)
- [x] Forest clearing zone, bonfire, boss arena
- [x] Knight + wyvern boss fight, HUD, flow, procedural audio
- [x] Single-file build, headless tests

## M1 — Combat & presentation pass (v0.2)
- [x] Repo, CI, Vercel deploy, agent docs & history; protected `main`, PR-only workflow
- [x] Remove stamina; block (hold RMB), parry (tap RMB on impact), perfect dodge → Ghostep
- [x] Attack tell system: normal / blue (parry) / red (perfect dodge only) with clear indicators
- [x] Enemy posture bar, parry/posture break → open window
- [~] Approachable balance (needs human playtests; bot kills the wyrm in ~20 s of combat)
- [x] Lab / debug mode (trigger abilities, phases, god mode, slow-mo, hitboxes, timing trainer)
- [x] Anime-style (SAO-inspired) black-coat swordsman protagonist
- [x] ASCII-ify creatures and grass; more detailed stone ASCII; bigger dragon (×1.25)

## M1.5 — Look pass from the v0.2 review
- [x] Calm, world-anchored v0.1-style grass (no swimming ground)
- [x] Crisp surface-glyph hero and wyrm; moonlit outline on the hero
- [x] Visual-only tells: red glow + flash for dodge-only, white glint for parry timing
- [x] Lab Showroom preset for look-dev review
- [x] Hero after the Shadow Swordsman sheet (model, poses, slam finisher, lunge thrust, cyan FX)
- [x] Wyrm after the Obsidian Drake sheet, 1.5× bigger; player reach band; hero-first boss camera
- [x] Carved-glyph stones and half-sunk flagstones
- [x] Lab model viewer + builder specs from the sheets (docs/art)
- [x] Four-legged drake rebuild (art score 2 → 6) and closer hero (2.5 → 4.5)
- [x] Next look round: hero hair mass, the blade read from behind at the game camera, small
      details (straps, boots) — done in the reference match below (fuller mop, the blade drawn
      nearer from behind, kite greaves); straps unchanged
- [x] Owner approval; released as v0.3.0
- [x] Classic ASCII-art creatures (screen-grid conversion, owner's references); hero drawn bigger and leaned (ADR-017)
- [~] Phone support: touch controls, phone camera, Lab toggle (released; needs a real-device check)
- [x] Owner approval; released as v0.4.0

## M1.6 — Reference match (2026-11-08, PR #4, `look/reference-match`)
- [x] Wyrm as the owner's red-black ASCII dragon: thin pixel font, letter sets, art source, shape (ADR-018)
- [x] Hero as ink-line art: per-pixel lines, a dark figure + halo at the game camera, longer drawn
      blade with a depth pull (ADR-019 … ADR-022)
- [x] Wyrm motion: flip-free rig, planted feet, the painting's resting display, idle life, strike
      lead, parry arc, weighted death (ADR-025)
- [x] Hero motion: world-planted feet, blade paths, portrait idle, new windups, two-step dash,
      sliding kneel, crescent trails (ADR-023)
- [x] Gameplay unchanged: hit-tested frames identical / within cm (ADR-024); `npm test` + build green
- [ ] Independent review pass on round 2 (stopped early; the dragon branches have no self-report)
- [ ] Owner approval of the PR preview; merge and release
- Follow-ups:
  - [ ] Find the time / random leak that makes deterministic captures differ run to run
  - [ ] Stray `"` glyph particles left of the hero in a back view
  - [ ] Hero coat as one wide ragged drape with burn holes and blotches
  - [ ] Hero proportions, curved hair strands and wisps, face lines (nose, mouth, eye shadow)
  - [ ] Hero at the game camera: tone down the armour column and glow (still brighter than the
        reference), capitals that read as text; the halo over the wyrm's letters
  - [ ] Stronger strike key poses (needs a hit-volume decision, ADR-024); light 2 choreography;
        the knockdown's wide blade swing; re-run hero foot metrics on the wide idle
  - [ ] Wyrm sails at the reference angle and the far wing with the hero straight ahead
  - [ ] Boss camera in melee: the wyrm's head and wings sit off the top of the screen
  - [ ] Wyrm letter boil (temporal buffer), close-up scale LOD, fast single-frame jumps
  - [ ] Move the capture / per-frame compare tools from the scratchpad into the repo

## M2 — RPG foundations (v0.3)
- [ ] Actor base class shared by player / enemies / NPCs; data-driven enemy definitions
- [ ] Regular mobs (2–3 types) using the shared combat system and tell rules
- [ ] Character stats, levels, XP; equipment slots; inventory UI
- [ ] Loot drops, item rarity, consumables
- [ ] Save / load (localStorage), settings menu (keybinds, volume, quality)
- [ ] Skill hotbar (MMO-style abilities with cooldowns) bound to 1–9

## M3 — World (v0.4)
- [ ] Zone streaming: multiple connected areas, transitions, minimap per zone
- [ ] Data-driven zone layout (sketch → procedural props, like Ansenjeo's pipeline)
- [ ] NPCs, dialogue, quests; bonfire/shrine fast travel
- [ ] Day/night + weather (rain glyphs)

## M4 — Online (v0.5+)
- [ ] Netcode prototype (authoritative server, WebSocket), other players visible with name tags
- [ ] Party, chat panel (the log tabs become real channels), co-op boss fights
- [ ] Accounts, persistence

## Tech debt / ideas
- [ ] Front-on reach: at ×1.25 the wyrm's chest sits above sword height, so only the overhead
      combo hit lands from straight ahead (flanks/behind are fine) — consider a lunge or hitbox lift
- [x] Hero readability at default zoom (~4 cells wide): consider a stronger rim or a ground ring
      (drawn bigger and leaned, ADR-017; a dark figure with a rim and a halo, ADR-021)
- [ ] Separate freeze vs slow-mo timers in `game.hitstop` (today actors guard against it)
- [ ] Merge static dragon parts (spikes/horns/claws) to cut draw calls (~100 meshes today)
- [ ] Dissolve-aware shadow material for dying creatures
- [ ] TypeScript or JSDoc types for the contracts once the API stabilises
