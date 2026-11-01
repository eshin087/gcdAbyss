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
- [~] Repo, CI, Vercel deploy, agent docs & history
- [~] Remove stamina; block (hold RMB), parry (tap RMB on impact), perfect dodge → Ghostep
- [~] Attack tell system: normal / blue (parry) / red (perfect dodge only) with clear indicators
- [~] Enemy posture bar, parry/posture break → open window
- [~] Approachable balance
- [~] Lab / debug mode (trigger abilities, phases, god mode, slow-mo, hitboxes)
- [~] Anime-style (SAO-inspired) black-coat swordsman protagonist
- [~] ASCII-ify creatures and grass; more detailed stone ASCII; bigger dragon

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
- [ ] Merge static dragon parts (spikes/horns/claws) to cut draw calls (~100 meshes today)
- [ ] Dissolve-aware shadow material for dying creatures
- [ ] TypeScript or JSDoc types for the contracts once the API stabilises
