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
- [x] Merged to `main` (PR #4, `8ce6aef`)
- [ ] Release (version bump, changelog heading, tag)
- Follow-ups:
  - [ ] Find the time / random leak that makes deterministic captures differ run to run
  - [ ] Stray `"` glyph particles left of the hero in a back view
  - [ ] Hero coat as one wide ragged drape with burn holes and blotches
  - [ ] Hero proportions, curved hair strands and wisps, face lines (nose, mouth, eye shadow)
        (proportions: the broad build in M1.7, then the lean build in M1.8; spiky pointed locks in
        M1.8; face lines open)
  - [~] Hero at the game camera: tone down the armour column and glow (still brighter than the
        reference), capitals that read as text; the halo over the wyrm's letters (M1.8: armour and
        blade glow toned down; still brighter than the reference)
  - [ ] Stronger strike key poses (needs a hit-volume decision, ADR-024); light 2 choreography;
        the knockdown's wide blade swing; re-run hero foot metrics on the wide idle
  - [ ] Wyrm sails at the reference angle and the far wing with the hero straight ahead
  - [ ] Boss camera in melee: the wyrm's head and wings sit off the top of the screen
  - [ ] Wyrm letter boil (temporal buffer), close-up scale LOD, fast single-frame jumps
  - [ ] Move the capture / per-frame compare tools from the scratchpad into the repo

## M1.7 — Epic wyrm fight (2026-11-09, `combat/epic-wyrm`)
- [x] Combo strings with a deflect chain: seven strings, a parry deflects a hit without ending the
      string, the last one recoils (ADR-026)
- [x] The plunge: a perfect dodge in range stabs down into the wyrm's head; slow-mo + crits in place
      otherwise; the execution on a posture break (ADR-027)
- [x] Three phases behind HP gates, staggered unlocks, a white-hot phase 3 that opens with the nova
      (ADR-028)
- [x] Fire spells on a pooled hazard system: meteor rain, eruptions, flame ring, flame wall, inferno
      nova (ADR-029)
- [x] Short flights: the burning pass, the sky dive, the hover barrage (ADR-030)
- [x] Broad hero build on the same bones; the blade depth-tested again; the coat yields to the steel
      (ADR-031)
- [x] Keep-in-view camera for the plunge and a flying wyrm
- [x] A deflect re-arms the parry at once (ADR-032); difficulty measured with bots, HP 4500 (ADR-033)
- [x] `npm test` + build green; merged captures at the game camera
- [ ] Owner approval of the PR preview; merge
- [ ] Human playtest of the difficulty (target 3–5 min for a player who knows the moves; a
      near-perfect bot wins in ~2.5 min)
- Follow-ups:
  - [x] Hero mass at the game camera (the skirt dominates); the low idle guard from behind shows
        only the point (M1.8: the lean build, the tails, the sword hung at his right side)
  - [ ] Coat-crossing frames near the hilt; the torn strips and streamers vs the blade; the block's
        free hand on the flat
  - [ ] A real tail thrust for the tail lash (a tail-raise control in the rig)
  - [ ] Widen the wing buffet's band; later string hits whiff a hero who stands still
  - [ ] A readable overhead claw at the game camera; a stronger deflect knock-back
  - [ ] A red windup glow for the meteor cast
  - [ ] Teach the probe bot to heal (its death rates are pessimistic)
  - [ ] Capture the phase-3 eruption chase

## M1.8 — Lean reference match (2026-11-09, `look/lean-hero`)
- [x] Look-dev: every reference angle at once (a live sheet incl. the gameplay camera), a
      turntable, a solid render through the ASCII pass, source and line looks (ADR-035)
- [x] Lean swordsman proportions measured on the six-view sheet (ADR-034, supersedes ADR-031's
      broad build); no bone, grip target or hit segment changed
- [x] Spiky hair of distinct pointed locks (crown, back layers, nape, sides, a jagged fringe)
- [x] Flared collar with a turned rim; layered spiked right pauldron; shaped upper back (yoke,
      four-point star, centre seam), baldric, two belts; banded calves
- [x] Coat as two tails split by a vent + narrow side panels + front panels (`skew`, `slant`,
      piping); the legs show from every side
- [x] The single-figure image's sword (barbs, notches, a guard swept up round a violet star gem)
- [x] The idle hangs the sword at his right side; near half-turns of the blade go round the front
- [x] Game-camera shading: a tight blade glow, quieter armour, readable lavender tails
- [x] `npm test` + build green; captures from every angle and the gameplay camera, every move
- [ ] Owner review of the PR preview; merge
- Follow-ups:
  - [ ] At the game camera he is still brighter than the scaled reference (mean luma 74 vs 55),
        mostly the one-pixel silhouette line
  - [ ] Fuller hair volume (the reference's mop is bigger); the dotted lavender rag along the
        tails' outer edges; face lines (nose, mouth)
  - [ ] Decide on the sleeve streamers (not in the new references)
  - [ ] Cosmetic FX draw on the shared `Math.random` (the seeded wyrm AI rolls on it): give FX
        their own stream
  - [ ] Move the headless capture harness (DevTools + `__tick`) into the repo

## M1.9 — Single-figure reference, round 2 (2026-11-09, `look/hero-reference-round-2`, partial)
- [x] Idle in the single-figure stance; the blade a low diagonal across his front (ADR-036)
- [x] Dot-matrix fill (3x3 micro-font, square cells), cel light, per-part silhouette ink
- [x] Pleated six-panel coat with drawn fold lines; four-ribbon torn cape
- [ ] Still unlike the reference (the session was stopped here):
  - [ ] Open, flared long coat with a few broad folds; the legs visible again from behind
  - [x] Cape as a wide torn sheet, not stiff ribbons (M1.10)
  - [x] Big hair mop, a tall winged collar (M1.10); [ ] face lines
  - [x] A jagged glowing blade, a layered pauldron with short blades (M1.10); [ ] dark legs with knee guards
  - [x] Darker masses (M1.10); [ ] sparse bright edge detail; blade angle ~44° (now ~37°)
  - [ ] Check the 36 m game camera in the grass, a phone, and the frame cost

## M1.10 — Blender-built hero parts (2026-11-09, `look/hero-blender-parts`, partial)
- [x] Headless Blender part pipeline: `npm run hero-parts` → `heroParts.js` (ADR-037)
- [x] Hair, collar, lapels, blade, cape and pauldron sculpted in Blender
- [ ] Still unlike the reference:
  - [ ] Coat as Blender-built panels: broad folds, long tattered tails
  - [ ] Face: brow, nose and jaw lines under the fringe
  - [ ] Arm and leg armour, belts and buckles as sculpted parts
  - [ ] The reference's density of small bright detail

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
