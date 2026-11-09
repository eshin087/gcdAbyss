# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [SemVer](https://semver.org/) (0.x = pre-alpha, anything may change).

## [Unreleased]
Two pieces of work since 0.4.0:
- **The epic wyrm fight** (2026-11-09): a longer, harder battle in three phases, with combos you
  parry blow by blow, fire spells, short flights, and a perfect dodge that drives the hero's blade
  into the wyrm's head. The hero is broad-shouldered, and his sword no longer shows through his body.
- **The reference match** (2026-11-08, PR #4): the wyrm and the hero look like the owner's two
  reference images (a red-black ASCII dragon and the "Shadow Swordsman" line art) and move better.
  That work left gameplay as it was (attack timings, hitboxes, damage and parry windows).

### Added
- **A three-phase wyrm fight:** the wyrm changes at 66 % and 33 % of its health with a roar that
  clears the field; phase 3 burns white-hot and opens with the Inferno nova. The boss bar shows where
  the phases begin.
- **Combo strings** you can parry blow by blow (Sekiro style): the claw combo, the rending flurry,
  the hesitant maw (a held bite that baits an early parry), the wing buffet, the tail lash, the
  pounce and a 6–7-hit frenzy. Each parry deflects the blow and the combo goes on; parry the last
  one to stagger the wyrm. Red blows inside a combo must be dodged. A "DEFLECT ×N" counter and a
  clang that climbs with every deflect.
- **The plunge:** a perfect dodge near the wyrm puts you above its head for a reverse-grip stab; you
  ride the head down, backflip off to a landing you can see, and get the crit window. When the wyrm
  is posture-broken, attack near its head for an **EXECUTION**.
- **Flying attacks:** the burning pass (a low pass breathing fire, leaving a burning strip), the sky
  dive (it climbs, tracks you and crashes down) and the hover barrage (fireballs from the air).
  Perfect-dodge its fire from the air and you plunge onto the flying wyrm: it crashes out of the sky.
- **Fire spells:** meteor rain (meteors keep falling while the wyrm fights on), fire eruptions (lava
  pillars toward you; in phase 3 they chase you), a flame ring, a flame wall and the Inferno nova
  (flee its blast or perfect-dodge it). Every one warns with a red ring on the ground.
- **Lab:** a Phase 3 button; every new ability can be triggered.
- **Tests:** scenarios for the strings, the deflect chain, the plunge, the wyrm's plunge reaction,
  hit timing, the fire attacks and the hero's build, plus an opt-in difficulty probe bot.
- **Hero moves:** the roll ends in a sliding kneel with dust, torn grass and sparks off the dragging
  blade; the charged thrust dashes in two real steps; the charge's updraft lifts the coat and hair;
  light 1 cocks the blade over the shoulder; finishes hold for a beat.
- **Wyrm life:** breathing sails, weight shifts, a wing rouse and a stalking stance while it waits;
  wings that turn toward you when you circle it; a death that falls with weight (it rears, buckles,
  thuds onto its side, the head slaps down last and the wings crumple).

### Changed
- **A longer, harder fight:** the wyrm has 4500 HP (was 1500) and hits harder (most blows 15–24,
  heavy ones 26–40, the nova 70; you have 160 HP); its posture meter is larger; each phase is faster,
  with shorter pauses. It favours its combos and fire attacks, and a new phase's abilities arrive one
  by one.
- **Parrying in rhythm:** a parry no longer ends a combo, only its last blow; right after a deflect
  the next tap counts at once, so you can keep the guard up between blows (mashing still fails).
- **Perfect dodges** against the wyrm no longer teleport you behind it: you plunge onto its head,
  or (out of range, or against a fire hazard) time slows and your hits crit where you dodged.
- **The hero is broad-shouldered:** a deeper chest, thicker arms and legs, bigger boots, on the same
  skeleton (his reach is unchanged).
- **The camera** keeps the hero and a flying or rearing wyrm on screen, panning and pulling back a
  little.
- The red warning rings use bigger dots, so they read at the game camera.
- **The wyrm looks like the reference dragon:**
  - thin pixel digits on black instead of bold letters (finer letters on screens under 900 px tall)
  - a charcoal scaled hide, molten cracks glowing on the undersides, an orange-lit chest and throat
  - crimson torn sails with glowing bones and embers, fuller and readable from every side
  - a bigger, fierce head held low with the jaws open, eagle feet, heavier legs and tail, a crest,
    frills and a saw tail
- **The hero looks like the line-art reference:**
  - bright ink outlines that follow every curve over dim, dense letters
  - at the game camera a dark figure with a cool rim and a crisp cyan blade, cut out of the grass
  - a longer blade (gem to point ~70 % of his height)
  - a coat that drapes with folds and a lavender torn hem, kite greaves, a spiky pauldron, fuller
    hair, and his face shows
- **Hero motion:** the portrait's wide idle with the blade low; feet stay planted while moving and
  turning; the blade swings round his body instead of through his legs; the slam's windup reads from
  behind; slash trails are one smooth crescent; a snappier turn, hair that blows back in a sprint,
  and a flask swig you can see from behind.
- **Wyrm motion:** feet stay planted through turns, the tail sweep and the roar; the bite eases into
  its strike; a parry throws the head back on an arc; the tail is carried in the painting's arch.

### Fixed
- The hero's sword no longer shows through his back or legs, and his coat rarely passes through the
  blade any more (it drapes over it or hangs inside it).
- Wyrm: wings and limbs flipping round in one frame, feet sliding or floating, the stomp's paws
  landing before the slam, toes under the ground when lying down, the tail folding over itself.
- The wyrm's tail sweep can no longer land before its red warning flash.
- Hero: feet skating, the blade whipping through the legs and the ground, the blade spinning round
  him between light 1 and light 2, the front foot skidding in the thrust, guard taps shuffling the
  feet, the blade's glow sitting short of its point.

### Removed
- The blink behind the wyrm on a perfect dodge (enemies without a head to stab keep it).
- The blade's depth pull, which drew the sword in front of the hero's body.
- The red crack "worms" over the wyrm's back and the dash outlines along its wings and tail.
- Dead code in the ASCII pass (the generic `artCell` letter path and `uArtCount`).

## [0.4.0] - 2026-11-02
The hero and the wyrm are drawn as classic ASCII art (the owner's reference images). The game is
playable on phones.

### Added
- **Touch controls**, shown on phones (or with `?touch`):
  - a floating ASCII stick (push to the rim to sprint)
  - ATTACK (tap = combo, hold = charged thrust), BLOCK (hold = block, tap = parry), DODGE, FLASK,
    LOCK and pause
  - auto-aim at the dragon, pinch zoom, tap prompts and "tap to begin"
  - landscape only, with a rotate overlay
  - a closer phone camera (20 m), LOW quality and a compact HUD
- **Lab show/hide on touch:** a floating `LAB` / `× LAB` toggle and a 36 px close button. The
  compact panel scrolls inside itself on small screens. VIEW → Touch UI tests the layer on desktop.

### Changed
- **The hero shows his details in game** (owner: "isn't showing the details like in your preview
  pictures"). He went from ~9 to ~25 letter rows at the desktop camera (~5 → ~15 on a phone):
  - drawn 1.2x bigger and leaned away from the camera, feet planted, so he stands up on screen
    instead of being seen from above (visual only: hits, hurt box and the dragon's aim unchanged)
  - his own finer letters: a 3x5 pixel font in 4x6 px cells, with the reference's 1 px gaps
  - shading like the reference: a fixed key light, dim letters toward the silhouette, black gaps
    between overlapping parts at the game camera too
  - phones upscale the 1x render crisply (pixelated) instead of blurring the letters
- The hero's ASCII art follows the owner's reference more closely: steadier, brighter letters and
  black gaps at part boundaries instead of 'random text'. White letters no longer bloom.
- The hero and the wyrm render through a fine screen-space ASCII-art grid:
  - letters `. : ; i r s X 2 3 5 h A H S G M 9 # & B @` picked by brightness and coloured per cell
    (white scales, orange lava, red wings, cyan blade, violet gem), on black
  - letters are ~2/3 the size of the world grid's (owner's choice), so the hero still gets rows at
    the game camera
  - red tells, hit flashes and the death dissolve carry through, because they are colour in the
    source

## [0.3.0] - 2026-11-01
Look pass from the owner's v0.2 review and concept sheets.

### Added
- Lab **model viewer** (`lab.modelView`): Front / 3-4 / Side / Back / Game views on a dark
  backdrop, for comparing the hero and wyrm against the concept sheets.
- `docs/art/hero.md` and `docs/art/dragon.md`: builder specs measured from the owner's sheets.
- Surface-glyph material options:
  - `levels`: per-cell glyph variants per light level
  - `levelInk`
  - `glowAxis` / `inkAxis`: object-space underside glow and alt ink
  - `crack: 'voronoi'` fissures
  - `seamAxis`
- Hero moveset from the owner's combat sheet: the 3rd light hit is a two-handed **overhead slam**
  (blue crystal shards). Hold-and-release LMB is a **lunging thrust** (2.2–3.6 m travel). Light
  sweeps leave cyan arc trails.
- Player reach band + step-in assist, so every attack connects with the much bigger wyrm from the
  front (new REACH test scenario).
- Lab **Showroom** button (VIEW): fight on, AI off, god mode, hero 7 m in front of the wyrm,
  camera zoomed in — for reviewing the hero, the wyrm and the grass up close. "Camera default" resets.

### Changed
- **The wyrm is a four-legged drake** (owner's choice), rebuilt from the Obsidian Drake spec:
  - columnar forelegs and digitigrade hind legs on a deep barrel chest
  - separate wings resting half-raised like sails
  - a short thick S-neck
  - a hide of mixed blocky glyphs with a molten underside
  - round red membrane glyphs with white bone lines

  A new quadruped gait. Every ability is re-authored for four legs with the same names, tells,
  windups, timings and damage. Art-director score vs the sheet: 2 → 6 / 10.
- Hero matched more closely to the Shadow Swordsman sheet:
  - one tapered torso with a small head and a fringed mop
  - a tall stand collar
  - an open A-line coat with ~22 tatters
  - belts, the stepped right pauldron, armoured boots
  - a bright 'A'-glyph field like the sheet's ASCII panel, with no neon outline

  Glyphs shrink in close-ups and grow at the game camera. Score: 2.5 → 4.5 / 10.
- Hero rebuilt after the owner's "Shadow Swordsman" sheet:
  - messy violet-sheen hair and a high collar
  - long black coat with torn purple tails
  - spiked pauldron, gauntlets, straps and armoured boots
  - a big sword (1.34 m) with a violet gem and icy cyan edges
  - new idle / walk / sprint / dodge / attack poses
  - reads as a bright glyph figure on the dark ground
- Wyrm restyled after the owner's "Obsidian Drake" sheet:
  - silver chevron scales on obsidian, with a molten orange throat, belly and inner legs
  - deep-red ragged wings with lava veins
  - swept horns, a frill, and spikes along the spine and tail
  - an upright S-neck and glowing maw
- Wyrm 1.5× bigger (`SCALE` 1.875). Arena bound, bite floor, swipe reach and FX are re-measured.
  The boss camera adds at most 5 m of zoom, so the hero stays readable.
- Stones, boulders and flagstones are drawn as crisp carved glyphs fixed to the stone
  (`createCarvedGlyphMaterial`), with cracks and moss. Flagstones are half-sunk with grass growing
  over their edges. Trees are unchanged.
- Grass is the v0.1 world-anchored glyph-stroke field again (no shimmer when the camera moves),
  about 20 % darker with slower, smaller wind so the ground stays calm and the characters pop.
- Hero and wyrm render as crisp glyphs printed on the body (sized to stay legible, drawn larger
  inside each cell, sharp edges) over near-black gaps, instead of the blurry v0.2 screen grid.
- The hero's black coat gets a thin moonlit outline and brighter silver / blade accents.
- Attack tells are visual only (see COMBAT.md): dodge-only attacks make the wyrm glow and flash red
  (plus red ground danger zones for area attacks); parryable attacks are read from the wind-up and
  marked by a brief white glint at the timing moment.

### Fixed
- The tail sweep could land up to 0.2 s before its timing flash for a hero right behind the wyrm.
- The wing membrane allocated ~100 KB per frame (`Math.hypot` boxing).
- The two fallen standing stones' colliders sat off their bodies (walk-through half, blocked
  empty ground).

### Removed
- PARRY / DODGE text marks, ◆ / ! icons, closing rings and off-screen arrows over the enemy, and the
  tell tips in the log.
- The ASCII-pass grass path (`GRASS` class, meadow texture).

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
