# Roadmap

Vision (owner, 2026-11-11, ADR-059): a **wuxia skill boss rush** in the vein of Phantom Blade Zero,
with some exploring and RPG elements, presented entirely in a crafted ASCII look. Boss duels, each
testing one skill, reached from a bonfire through short approaches; wuxia combat and fiction (sects,
robes, wandering swordsmen), the Cinder Wyrm as the spectacle fight. **Fixed rewards**: each boss gives
a technique, weapon, ability or element that changes how the hero fights (no XP levels, no random
loot tables). Combat is readable and fair (clear tells; block / parry / perfect dodge), not a
stamina-gated pure soulslike. Built as browser vertical slices that are always playable. (The
earlier vision, an open-world RPG with MMO-style systems, survives as the online milestone, not next.)

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
  - [x] The right thumb's pad: three tiles that touch, slide between them, placed and sized by the player (ADR-096)
  - [x] FLASK | HEAVY over BLOCK | ATTACK, DODGE under ATTACK; the layer fits the screen; a padlock to drag it (kept); the fight starts locked on (ADR-270)
  - [ ] Owner's verdict on the iPhone and the small phone: the new pad, the fit's floor, the padlock's place
- [x] The title and the menus with a finish; one tap begins on a phone (ADR-270)
  - [x] The guard meter: blocks cost guard, not HP; parries and hits restore it (ADR-095)
  - [x] Played upright (portrait) as well as in landscape; see-through controls; a 70 px minimap on phones (ADR-097)
  - [x] An ASCII HUD: text meters, block-letter banners, no panels in play, a 40 – 72 px minimap (ADR-098)
  - [ ] Owner's verdict on the phone: the pad's default place and size, the slide's stick (10 px), the guard meter's numbers,
        how faint the controls are, the upright camera against the wyrm
  - [x] The hero's meters and the boss's never overlap: the top row is fitted to the screen (ADR-131)
  - [x] Two pad switches to try: PAD LAYOUT "guard on left" (one thumb cuts, the other parries) and HOLD ATTACK (ADR-131)
  - [ ] Owner's pick on the phone: which of the two becomes the default, where GUARD stands
  - [x] SWIPE DODGE: a flick on the right half dodges that way (ADR-278)
  - [x] Owner's verdict on SWIPE DODGE: liked, on by default; GUARD against the stick with its own padlock (ADR-278)
  - [x] A second guard under ATTACK, quieter GUARD and padlocks, LEFT / RIGHT GUARD switches, PAD LAYOUT picks BLOCK's place (ADR-278)
  - [ ] The swipe's numbers on the phone; a touch timing allowance if parries are still late
  - [ ] Phone ideas not built yet (ADR-131 lists them): the game drawn under the notch (viewport-fit=cover), a
        drag-to-place layout editor, a left-handed mirror, an "add to home screen" hint for full screen on iOS
- [x] Owner approval; released as v0.4.0

## M1.6 — Reference match (2026-11-08, PR #4, `look/reference-match`)
- [x] Wyrm as the owner's red-black ASCII dragon: thin pixel font, letter sets, art source, shape (ADR-018)
- [x] Wyrm letters: fine digits in 5x8 px cells at 720p, calm tone, grid anchored to it (ADR-092, ADR-093)
- [x] Background objects in the dragon's look (prop art); the house style written down (ADR-100)
- [x] Landmarks: big set pieces per level, in the same look (ADR-100)
- [x] A second pass on the landmarks at the game camera: rebuilt as a few flat masses, moved to where
      the duel's camera looks (ADR-113)
- [x] Effects in the dragon's letters: the fire field (fire, void, steel, smoke), every boss's fire and
      spells on it, one set of timing cues, heat haze, letting go, shed digits (ADR-113)
  - [ ] The owner's look at it: the calm palette was built without their pick (C, hotter, is one number);
        the Lord's spells went from red to white and violet; the landmarks moved
  - [ ] The phone: the look at 4x6 cells and the frame rate (the bonfire and the braziers keep the
        field's passes running all the time)
  - [ ] The hero's effects (slash trails, parry sparks, `combat/clashFx.js`, `cutFx.js`) on the field,
        once the open work on those files has landed
  - [ ] A crisp red kind (a second heat target): the red cue, the red rings, the Lord's blade; and a
        blue-white kind if the wisps should join
  - [ ] Fire that hugs the ground (a per-blob switch for the 0.9 m depth fade) and a per-kind tongue
        height (bullets grow nine-cell tongues whatever their direction)
  - [ ] The throne hall's landmarks: pillars cover the wardens' lower halves, the great swords are
        small from the seal; the Lord's intro shot without the wardens beside the throne
  - [ ] The eroding edge of the dying wyrm: a cell is black for ~0.3 s before the ground shows
  - [ ] Headless checks for the text effects (the sims compile no shader): `uWyrmLetGo` follows
        `dragon.dissolve`; `uGlowRise` through the breath's windup; `fx.shed` on a landed cut
- [ ] The hero and the human bosses in the house style: only when the owner asks (ADR-100: "not touch")
- [x] Hero as ink-line art: per-pixel lines, a dark figure + halo at the game camera, longer drawn
      blade with a depth pull (ADR-019 … ADR-022)
- [x] Wyrm motion: flip-free rig, planted feet, the painting's resting display, idle life, strike
      lead, parry arc, weighted death (ADR-025)
- [x] Wyrm wakes without the neck twist; the drake head drawn for the view from above (ADR-189)
- [x] The wyrm's neck and head reviewed move by move: level head, no flips, no detached head (ADR-203)
- [x] Every wyrm fire travels from it; roar-cast spells and a brood of fire; a walk-out forest (ADR-197)
- [x] The owner's picks for ADR-197's looks (incant, drakeling, serpent, vortex, forestEnd, meteorSource, wallSource): the defaults kept (2026-11-25)
- [x] The wyrm's death: the neck falls as one curve, the head in line (ADR-274)
- [x] Every white / blue timing glint seen through the body and inside the frame (ADR-274)
- [x] The wyrm's blue and red paw blows told apart: the scythe and the leap, the owner's picks (ADR-274)
- [x] The wyrm's motion audit: wings, teleports, the head on its neck, the tail, turns, landings fixed (ADR-277)
- [ ] The wyrm's tail sweeps and whips: an aimed spin instead of ~700°/s (ADR-277)
- [ ] The wyrm's feet pinned in the death and the wake (ADR-277)
- [ ] The wyrm presses in when the hero stands out among the trees (it fights at range there)
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
  - [x] A red windup glow for the meteor cast (Armageddon's rear-up glows red, ADR-053)
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

## M1.100 — The blackout and the red trail (2026-11-27, `claude/combat-blackout-red-trails-892472`, ADR-271)
- [x] `?black=a|b|c`: a black blow drains the picture to dark grey, the boss lit, the violet gone; clears on every cancel
- [x] `?redTrail=a|b`: a red string's blade cuts leave a red crescent from the flare on
- [x] Films of today and every variant at the game camera (Shen Hui, the wyrm, the Lord); `npm run perf -- --black`
- [x] The owner's picks made the defaults: blackout b, red trail a
- [x] Every black blow lands a devastating impact, hit or miss (`?blackImpact=`), filmed on Shen Hui and the wyrm
- [ ] A red wake for fists and claws if wanted; the impact along the Fox's Howl beam
## M1.93 — Boss motion: Lu Wusheng, Wen Yao, the wyrm (2026-11-26, `claude/enemies-grove-fox-wyrm-motion-59bc46`, ADR-223)
- [x] The audit tool (`tests/integration/motionAudit.mjs`): hands, pops, sliding feet, facing, the held windup per tell
- [x] Held blue / red windups, coloured (blue tall, red low), behind `?sheathMotion=` `?foxMotion=` `?wyrmMotion=`
- [x] Wen Yao's lifted feet no longer jump (the release ease)
- [x] A quick white blow each behind `?sheathQuick=` `?foxQuick=` `?wyrmQuick=`
- [x] The owner's picks made the defaults (a for all three, every quick blow)
- [x] Lu Wusheng's free hand in the scabbard cuts (the form, ADR-252); the foot ease for Shen Hui and Varr Nihil
## M1.96 — The living world's fast path (2026-11-26, `world/life-perf`, ADR-245)
- [x] Measured per layer on five levels (GPU at 4K and phone size, CPU at 1x / 4x / 6x)
- [x] Only the drawn letters uploaded, empty batches out of the frame; the step flash and the wake return outside their reach (`?lifeFast=0` = before)
- [x] BENCH (`?perf`) reads the living world's share
- [ ] The owner's BENCH on the iPhone and the laptop; the trees' wind vertex cost on a quiet GPU
## M1.103 — A tenth level: the Last Foundry and the False Saint (2026-11-28, `enemies/false-saint`, ADR-285 – ADR-288)
- [x] `?level=foundry`: a steel mill at night, the casting floor's 400 plates, the pour, four ladles on jib cranes,
      the press, the line of unfinished frames, the furnace, gas tanks that burst; 492 breakables; the hazard surface
      (`game.world.forest.foundry`: ladles, molten pools, tanks); the light by his phase; the `foundry` palette; the
      living world's blocks; a cost row
- [x] Anselm, the False Saint, on the duelist engine: one bar, four phases, 32 moves in four handlers (melee, boost,
      arsenal, terrain) routed by `moves.js`, `footwork` / `takeHit` / `onMoment` hooks; COMBAT.md's floors; cyan
      cosmetic; every projectile in the ledger (`fx.fly`); the pools burn him too
- [x] His body: one rig, the disguise over the frame, the shell chipped where cuts land and never regrowing; the v04
      pass (the face, the hair, the colours, open hands by the beat); his effects in the fire field (`saint`), 35 sounds
- [x] The Lab (LOOKS `fsLook`, `fsLetters`, `fsMark`; his FIGHT buttons), the Training's roles, `saint.mjs`, the
      tuning pass (whole fights against four mortal bots, the pace meter)
- [ ] The owner's picks: `?fsLook`, `?fsLetters`, `?fsMark` (sheets in `docs/looks/foundry/`)
- [ ] The owner's playtest, on the iPhone too
- [ ] His reward: the owner has not chosen one; his own music (the Obsidian Throne's for now)
- [ ] The arsenal's and the terrain's poses audited at the game camera; the press's ram stroke; Anathema's and
      Thurible's pops
- [ ] Verdict's ring after a perfect dodge of the pillar; a `fixed` Passing Bell the guard cannot clear; the tanks' and
      the columns' damage through `d.hitPlayer`

## M1.102 — A new fight stance: the middle guard (2026-11-28, `player/stance-four`, ADR-275)
- [x] Four fight holds as data behind `?hold=` (middle, high, sword fingers, low trailing), filmed close and far in one clip
- [x] The owner's pick, A the middle guard, the default; ADR-207's hold `?hold=ref`; the Lab's `hold` row
- [ ] The owner's playtest on the preview
## M1.99 — Bai Wuji's barrier shows where your blade hits it, and he goes down quicker (2026-11-28, `enemies/untouched`, ADR-266)
- [x] A cut on the barrier chips a quarter of its damage (never his last HP), its number where the blade stopped
- [x] His health 16000 (20000); the bench: the good bot in about 2.3 min
- [x] Every cut on the barrier shows a faint patch of it where it landed (`?wjStrike=a`, the owner's description; `fxStrike.js`; sheet `docs/looks/veil/wjStrike-patch.jpg`); no ring on the floor (`?wjSign=1`)

## M1.98 — Bai Wuji glides: quicker, one-handed, and his barrier opens easier (2026-11-27, `enemies/untouched`, ADR-250)
- [x] Three motion takes behind `?wjMotion=0|a|b|c` (`untouched/motion.js`; the hand layer keeps his hands in his pockets); the owner picked b, the glide
- [x] The barrier opens easier: two cracks, longer openings, cuts x2.5 through it; hp 20000; patience after 20 s
- [x] The bench's bots answer falling pieces and paired cues as a person would; the perfect bot untouched on 12 seeds
- [x] His mercy counts the lock in real time; no falling piece on a downed hero
- [ ] The ledger forgets a landed red (shared duelist code); patience against a pure defender is slow

## M1.94 — A ninth level: the Veiled Crossing and Bai Wuji, the Untouched (2026-11-26, `enemies/untouched`, ADR-241 – ADR-243)
- [x] `?level=veil`: a levelled city crossing at night, every piece breakable, tower tops that come down, the
      fallen tower in sections, two scenes (`crossing`, `void`: the city's pieces let go, the void's float),
      `setPhase`, the living world's blocks; `?wjCity=a|b|c`, `?wjVoid=a|b|c`
- [x] Bai Wuji on the duelist engine: the barrier (perfect parry / perfect dodge / cracks / a break open it), weight
      on every blow (`blockPush`, `wjCrash`), the pull, the domain (escape or caught, `Player.hold`), the mercy
      rules; his moves in three handlers routed by `moves.js` (melee, spells, terrain)
- [x] His body in the hero's ink-line art, the blindfold off and the hair down at phase 2; his effects in the fire
      field (`azure`, `crimson`), his sounds; `?wjLook`, `?wjHair`, `?wjShell`, `?wjNull`
- [x] The owner's picks: `wjLook` c, `wjHair` b, `wjCity` a, `wjVoid` b, `wjShell` a, `wjNull` a (2026-11-25;
      sheets in `docs/looks/veil/`)
- [x] Lab, Training, `tests/integration/veil.mjs`, the cost budget; the bench (`bench.mjs`) and the tuning:
      `hp` 26000, a block 45 % of the guard (the third in a row opens it), four cracks; his patience (30 s
      untouched: one block opens the guard), so a defender who never attacks dies
- [x] `throwTo` / `drop` `{ ground }`, `take` `{ chip }`, a held piece breaks under 1 hp; Halcyon's throws land on
      the road; `SCAR.thin`, `scars.layer` / `shade`; Halcyon Plaza's metal rubble cold grey (`SCAR.thin.city`,
      `?coolRubble=0|1`)
- [x] The bonfire out in the void, lit again on the way back (`atmosphere.bonfireLit`)
- [x] The owner's answers (2026-11-26): "3 blocks"; a defender who never attacks must not outlast him; the
      roller's ten minutes "hard enough"; Halcyon's rubble grey; the bonfire out in the void
- [ ] The owner's playtest, on the iPhone too (the phone's eyes merge into one point)
- [ ] His reward: the owner has not chosen one
- [ ] The roller now wins in six to seven minutes (`blockPush` 2.4 is the measured lever); the fencing bot's 2 of
      6 rides on the seeds
- [ ] The real renderer lays ~30 % more floor marks than headless

## M1.94 — Instant slashes, the left hand to pick (2026-11-26, `claude/hero-instant-slash`, ADR-240)
- [x] PRs #118 and #166 closed on the owner's call: production's combo stays
- [x] Every attack and the flurry's finishers: one straight slash line instead of the crescent (`slashFx.js`, `?slash=arc` the crescent)
- [x] Three left-hand looks to compare, `?offhand=side|back|quiet` (`offHand.js`); scenarios `instantslash`, `offhand`
- [x] Round 2: the line comes as the swing ends; three feels of the same moves, lights and heavies, each with its hand (`?feel=`, `feel.js`); scenario `feel`
- [x] Round 3: the ending slash (`?endslash=`, `?endbeat=`) and four light combos built for it (`?combo=a|b|c|d`, `combos.js`); scenario `combos`
- [x] Round 4: the owner's baseline (combo A, the slash on the enemy as the swing ends) is the default; the hand's coat clipping fixed; each line follows its sword's on-screen motion
- [ ] The owner's verdict on the revised baseline; then the other combos, feels and hands go

## M1.93 — Tian Lei's and Halcyon's motion (2026-11-26, `claude/enemies-tian-halcyon-motion-efe595`, ADR-225)
- [x] Audited (asc.mjs / city.mjs AUDIT); held blue / red windups, the snap blows, Halcyon's flier's legs, aim and dip,
  behind `?ascMotion=a` / `?halMotion=a`
- [x] The owner's pick of both switches: a, the default (2026-11-26)
- [x] Tian Lei: the sweep's knee jolt and sliding feet, the cross's sideways line (ADR-248, `?ascMotion=b`)
- [ ] Tian Lei: the dash thrusts' skating (the audit leaves dashes out; not judged on film yet)
## M1.94 — Tian Lei audited: straight limbs, a readable pace, two ki blasts (2026-11-26, `claude/tian-lei-motion-32bb13`, ADR-248)
- [x] Measured every move on the rig (asc.mjs AUDIT, the striking limb's joint at contact); before / after films, three forms, game camera and close
- [x] `?ascMotion=b`: long straight punches down his centre, straight kicks, the sweep from a drop stance on a planted foot (asc LIMBS)
- [x] `?ascPace=a`: rule 10's floor as held cocks (asc READABLE)
- [x] `?ascShot=a|b`: the ki blast as a sun or a comet, in the Fox's and Bai Wuji's idiom
- [x] The owner's picks (2026-11-27): straight limbs, the readable pace, the sun; the defaults
- [ ] Not done: the transformations' kneel-to-stand jolts (~600 mm/f²), Thousand Hands' last palm (671), the beam and Raining Suns' gather as effect options
## M1.93 — The perfect parry gets the perfect dodge's window (2026-11-26, `claude/combat-perfect-parry-window-d6503b`, ADR-227)
- [x] `DEFENSE.perfectParryWindow` 0.08 → 0.20 s (the owner's pick); the plain parry window 0.22 s unchanged
- [x] Every perfect reward (posture, counter cut, blade lock, returned bullets, clashes) follows the one number; tests timed for a plain parry moved to 0.21 s
- [ ] Played by the owner; their call on the slow-motion beat now that most parries are perfect
- [x] The brood's busyWait dive (`BROOD.busyWait` 2.5 s) never cues within 0.3 s of a wyrm cue needing another answer (integ PRESSURE seed 4242: fanVolley / drakelings P2, breath / drakelings P3; on main too): `BROOD.late`, `bullets.bar`, scenario BROODBUSY (ADR-237); PRESSURE's steady bot back on the real parry window

## M1.92 — The melee animation engine: boss blows from reference footage (2026-11-26, `enemies/fists-ref`, ADR-208)
- [x] `scripts/mocap` on `main` as a tool; `scripts/mocap/duelist/fit.mjs` fits a clip onto a duelist's blows (`--check` through the real animator); the guide
- [x] Tian Lei from the bare-handed film, shown behind `?fists=ref`: turned down by the owner (stiff arms; the lunges and feet); not merged
- [x] Removed again (2026-11-26, ADR-236): the owner scrapped every reference-footage approach; `scripts/mocap`, `src/entities/hero2` and the `keysOf` hook are gone
- [ ] A reference of clean technique that tracks (boxing / kung-fu sets, fixed cameras), rendered for the owner before any wiring

## M1.91 — The hero's idles and guard after the owner's reference footage (2026-11-25, `claude/idles-reference`, ADR-207)
- [x] At ease the reference's one-handed stand; in the fight its two-handed hold; ADR-186's habits, tricks and spells from the new stand (`?idles=new|old`: the looks before)
- [x] The put-away and the draw (`stow`): the sword burns out in its green flame at his left hip and is drawn back out of it; whole the frame anything else starts
- [x] The guard: the braced crouch, the hands before the chin, the blade across his face (`?guard=ward`: the cross ward); the block's timings untouched
- [x] Scenario `heroref`; the Lab's `idles` (ref / new / old), `guard` and `idle ▸` (`stow`) rows; pair sheets against the footage
- [ ] The owner's look at the films (the hold's hands sit higher than the footage's, the guard from the game camera)
- [ ] Played on the iPhone
## M1.94 — The run from the owner's sketch (2026-11-26, `claude/hero-run-sketch-6baa40`, ADR-229)
- [x] `player/runArms.js` `e` (open) / `f` (wider): the free arm off his side, drawn past the coat from behind (measured on the drawn frame)
- [x] `player/runSword.js` `trail` / `swept` / `side`: the blade in the forearm's line, behind him and down, rocking with the arm
- [x] A block / parry / flask / charge out of a trailing blade enters over 0.24 s (no one-frame flip)
- [x] `herorun` bounds the opened arms and the trailing carries (the wrist, the legs, the coat, the grass, pops)
- [x] The owner picks a sword carry and an arm width: `trail` and `e` (2026-11-26), now the defaults
- [x] `trail`'s sword arm: the solver draws the asked elbow (`_swordOpen`); out along the owner's arrow from the game camera, a relaxed elbow
- [x] `flail`, `b15`-`b45`, `a1`-`a4` tried; `nat` (a real grip: the blade ~right-angled to the forearm, the fist by his hip) the default
- [x] Rebuilt from the hand's grip (`fistBlade`); `g2` the owner's pick, clear of every cloth sheet (≥ 12.6 cm), the default
- [x] `runStyle.js` (four postures, behind `?runStyle=`); the free fist at the hip (`h`) and the guard (`g`), both turned down: the free arm stays `e`
- [ ] The whole run (legs, lean, torso): its own pass
- [ ] Played on the iPhone

## M1.90 — The run carried like the owner's reference (2026-11-25, `claude/run-sword-hand`, ADR-204)
- [x] `player/runSword.js`: the sword carried forward at the hip, rocking with the forearm (`?runSword=hip|old`, the Lab's `run sword` row)
- [x] `player/runArms.js` `d`: the full pump (the default)
- [x] `gear/handShape.js` `fistHand`: the free hand a closed fist (`?handLook=g`, the default; `h` a dark glove)
- [x] `herorun` checks the carry: the blade always ahead, its elevation in range, the point off the grass, no pops

## M1.90 — Xin Yi rebuilt: a man in a coat, readable windups, faster hands (2026-11-26, `claude/enemies-xinyi-rebuild-1bbc62`, ADR-221)
- [x] Diagnosis: filmed at the game camera beside the hero and from four sides, measured (the audit, an aim probe); report to the owner
- [x] His figure printed the hero's way on a man's build, three cuts (`?oneBody=a|b|c`): option sheets to the owner
- [x] His moves (`?oneMoves=a`): the side-on aim, held blue / red windups, two fast strings; before / after films; the `rebuild` test
- [x] The owner's pick of the figure: b, the open coat (PICKED); one coat, not the hero's cloak
- [x] Straight kicks and long punches on the rebuild (the owner's ask); the coat held to 30 degrees through flips
- [x] The owner's pick of the moves: the rebuild (`oneMoves` a in PICKED)
- [ ] Phase 1's left hand behind his back reads one-armed from some sides; the sweep's tuck pops at the knee (Tian Lei's builder)

## M1.89 — 60 fps on every device: the frame's cost (2026-11-25, `render/perf-ground-steps`, ADR-199)
- [x] A measured review: every level and the phone preset, GPU by pass and by object, script by function, the loop under a throttled CPU
- [x] The ground drawn last; its relief baked once per cell (the same picture: at most 9 pixels of 2 million differ)
- [x] The world, the lights and the particles on their own step: a catch-up step runs the fighters only
- [x] Automatic quality: the render resolution follows the measured frame time (`render/autoQuality.js`, ADR-200, `render/auto-quality`); AUTO in the F2 cycle and the pause menu; a 60 fps cap on touch
- [x] The owner picks AUTO's floor from the rendered steps (`.claude/autoq-review/`): 1x (2026-11-25)
- [ ] AUTO on a real weak GPU and a phone: how often it steps, whether a step's hitch is felt
- [x] The shadow map: what does not move is drawn only when it changes; the shadows' edges no longer crawl as the hero walks (ADR-201)
- [ ] Lighter trees on LOW (the presets' grass counts do nothing now)
- [ ] The floors' shader (its relief is most of its cost; not bakeable as it is drawn)
- [ ] Script: the shared uniforms' upload (about 0.5 ms a frame), the worst frames' hitches
  - [x] The fight's spikes found (ADR-209): a blow landing (sounds, the hero's pose, call-outs, the boss's reaction), the first break's remains, the still map's big copy
  - [x] The first break's remains drawn at load; the still map's big copy kept current; the seen pass's matrix walk gone (ADR-209)
  - [ ] The hit-time work (sound voices, the hero's pose, call-outs), chosen from the iPhone's report
- [x] Guards so the cost cannot creep back: a cost budget per level in `npm test` (`cost.mjs`) and `npm run perf` on a real GPU (ADR-206, `perf/cost-budget`)
- [ ] Measured on the owner's laptop (Intel Core Ultra 7 255U, integrated graphics) and on a phone (`npm run perf --save` there gives the first baseline)
- [x] An in-game readout for the owner's devices: `?perf` (ADR-209: frame and script ms by part, missed frames, AUTO's step, a report to share)
- [x] The owner's `?perf` reports from the iPhone: a fight on fox, grove and code (GPU-bound: script 3.5 ms, 6 - 20 % of frames over 20 ms, AUTO at its floor)
- [x] BENCH in `?perf`: each pipeline step's GPU cost on the device (ADR-215)
- [x] The owner's BENCH from a busy moment on fox and grove; the step it names cut at AUTO's floor (options shown first): the world pass; the lite world, the owner's pick C (ADR-216)
- [ ] BENCH on the iPhone with the lite world on: fox and grove
- [x] AUTO BENCH: the readout benches by itself in a fight, the owner only taps REPORT (ADR-261)
- [ ] AUTO's own step hitch on the phone (17 - 32 ms: the letter atlases rebuilt)
- [ ] A starting step per level for a heavy level (so AUTO does not find it by a slow stretch)

## M1.88 — The dragon print: the world printed in the wyrm's digits (2026-11-25, `render/ground-looks`, ADR-198)
- [x] Four ground looks rendered; the owner picked b, the dragon ground (a lit relief in the wyrm's digits on a world-anchored lattice)
- [x] The core (`render/dragonPrint.js`) and the default in every level (`?dragon=0` the world before)
- [x] Floors of every level, props and trees, four upgrades (cloud, contact, ripple, ridge), flash footprints on every surface
- [x] Grass printed as tufts (a) over standing digit blades (b: lost)
- [x] A cut that shows in the printed grass (dgCut b); fallen leaves as lit lenses (leafLook a)
- [x] The owner kept grass a (the depth steps stay behind `?dgGrass=a3d1..3`); the cut's chips made smaller
- [ ] The phone's frame cost; remove the first round's looks a / c / d

## M1.88 — The bosses drawn in the hero's style (2026-11-26, `claude/render-boss-hero-look-631f37`, ADR-220)
- [x] The audit: the five human bosses beside the hero at 720p, 1440p and the phone (a report and sheets)
- [x] Round 1 turned down (his letter size, his dark cloak values, the tall hem, flared torn skirts): not his colours or cloth
- [x] `?<boss>Hero=0|a|b|c` (his shading, his outline, both); picks c Shen Hui / Varr Nihil / Lu Wusheng, a Tian Lei / Halcyon
- [ ] Seen by the owner in play and on the iPhone

## M1.87 — The front: the sword's path and a loading screen (2026-11-25, `ui/gcd-front`, ADR-196)
- [x] A loading screen from the first paint, an honest bar of the boot's steps (`?loader=a|b`; b the owner's pick)
- [x] Three title layouts (`?menu=a|b|c`; c the owner's pick, `0` the title before), CONTROLS behind a button
- [x] The hero's tag reads gcd and rides his head; the HUD name off (`?heroName=a|b`)
- [ ] Seen on the iPhone (notch, home bar, upright and landscape) and with a real pad
- [ ] The path past ten worlds (scroll or shrink)

## M1.86 — The bosses printed the hero's way (2026-11-24, `render/boss-hero-ink`, ADR-194)
- [x] Why they looked apart: same letters, but flat dark / flat bright fills, a hairline outline, no hem
- [x] `?bossPrint=0|a|b` (the shader: lit letter bodies, the hem below the knee; the art pass: his strokes and rims); b the owner's pick
- [x] Lu Wusheng in the hero's letters by default (`sheathArt` a)
- [ ] Seen by the owner in play and on the iPhone
- [ ] The Cinder Wyrm, the props and the animals in this direction (their own art paths)
- [ ] Outfits nearer the hero's mass (a cloak or long cloth per boss) if the owner wants more letters across
## M1.85 — The grass bends round the hero's wake (2026-11-25, `world/grass-bend`, ADR-193)
- [x] The hero's wake as a path in the shader: blades bend along his way and spring back, no dark trail (`?bend=b`)
- [x] The steps' trample only with `?bend=0`; a sprint or landing presses a wider wake
- [ ] The boss's footsteps leave a wake too; measured on the phone

## M1.84 — The sword's cut throws green code (2026-11-25, `world/grass-spray`, ADR-192)
- [x] Code glyphs off the drawn arc's cut, the Hall of Falling Script's set, calm and small (`?grassSpray=m`)
- [x] The looks met on the way behind `?grassSpray=` (grass letters, the blade's own chips, code with trails)
- [ ] Seen on the phone's own screen; should the boss marks' tears throw code too?

## M1.83 — The hero's idles: rests, habits with both arms, sword tricks (2026-11-24, `claude/hero-idles-2776d8`, ADR-186)
- [x] At ease: four rests, six habits with both arms, five tricks every 3 - 4 actions; in the fight: the free hand off the belt (four guard hands), five small habits, no tricks (`?idles=old`: the belt)
- [x] Measured in his own frame (joints, the blade's gaps, the coat, pops) and every move from every rest and every action against the stance before; scenario `heroidles`; the Lab's `idles` / `idle ▸` rows
- [x] Films before | after sent to the owner (exploring, the fight, the cuts; and the in-game view)
- [x] Round 2 at the owner's call: the sword arm as picked in every rest (hilt, trail and the flip dropped); three sword spells in the green flame (rite, sigil, breath)
- [x] The sword hand in the tricks and spells: the forearm leads the blade (≤ 60° off it, was up to 129°)
- [ ] The owner's picks (which rests / tricks to keep, their pace); played on the iPhone
- [ ] The pass behind his back into the left hand (the sword must be able to change hands: a rig change)
- [ ] The block's / roll's / charge's own short entries out of a far blade (the whips left are theirs)
## M1.82 — The run's free arm: three carries (2026-11-24, `claude/hero-run-arms-2e2cb5`, ADR-187)
- [x] `player/runArms.js`: A natural (a runner's swing, a sprint's pump), B the swordsman's dash, C by speed, `?runArm=a|b|c|old`, the Lab's `run arm` row
- [x] The `herorun` scenario: every carry through one course (strafe, backpedal, turn, every transition) against the swing before
- [x] Review films: the four side by side, game camera over the side view, the front, half speed
- [x] The owner's pick of the run arm: A, natural, the default (2026-11-25; C shipped first by mistake, reverted in #122)
- [x] The free hand smaller (× 0.8), the owner's pick of five looks (`?handLook=0|a|b|c|d`, the Lab's `hand` row)
- [ ] The roll's and the block's entries out of the dash: the free arm comes forward inside a short cross-fade (about twice the old jolt)
## M1.82 — The streak's answer: a heavy first cut, a path that flows, cuts that tear the picture (2026-11-25, `combat/streak-pace`, ADR-190, ADR-191)
- [x] The tempo: a heavy first cut, each later one a share of the one before, the storm by pace (`?tempo=0`)
- [x] The chain: each pass from where the last ended, every slash on his path, the stray crescents gone, letter dust for the `A` shards (`?chain=0`)
- [x] Five figures, one a flurry, never twice running (`?figure=`)
- [x] The time rip: four looks filmed side by side; the owner picked the torn strip (`?rip=`)
- [x] Four dodge looks: smear, floor sparks, aerial cuts, and a / b / c / d (`?dodgefx=`, ADR-210)
- [x] The owner's pick: a, the Thunder Thrust, is the default (`?dodgefx=off` the flurry before)
- [ ] Played, and seen on the iPhone (the dodge looks)
- [ ] Played, and seen on the iPhone
- [ ] Judged in play: the step into the storm round the head, the riposte's last freeze (0.198 s), the figures' size at the duel camera
- [ ] The wyrm's `pounce` past its share of a gap in the tree wall (integ `breach` replays at the old pace until then)

## M1.81 — Smaller combat text (2026-11-24, `claude/combat-text-smaller`, ADR-184)
- [x] Call-outs and damage numbers at fixed, smaller sizes (the owner's option B); no growth with the window
- [ ] Seen on the owner's desktop and iPhone
## M1.80 — The sword burns with a tight green flame (2026-11-24, `player/sword-green-flame`, ADR-182)
- [x] A tight envelope of Matrix-green marks round the steel, in the hero's own micro letters, there with no streak and denser and hotter by tier (`?mystic=0` off)
- [x] Picked by the owner over a day of filmed rounds (wisps, red flames, green, enveloping, smaller); scenario `swordmystic`; the Lab's `mystic` row
- [ ] Played and seen on the iPhone (frame rate unverified)
- [ ] The streak aura's red rim in green to match the sword? (owner to decide)
## M1.79 — Three more: grass the sword mows, lamps that light with the fight, the living world heard (2026-11-23, `world/alive-three`, ADR-180)
- [x] Torn grass (the scorch map's A): the sword mows, every floor mark tears its shape (`?mow=0`)
- [x] Lanterns and braziers that kindle by phase and fire, gutter under blows, go out when broken; low lights in the pool
- [x] The living world's sounds (`LIFE_SFX`, `lifeSay`), per level, rate-limited, an audition page
- [x] The cut redone at the owner's call (2026-11-24): under the sword's drawn arc, blade by blade, the tops thrown quietly (`?mowLook=`)
- [ ] The lying tops in the wind; a stub that springs; the cut texture's upload on the phone
- [ ] The owner hears the sounds; their call on a lantern flame's size
- [ ] The flurry mows; the Ashfall grass's cut colour; the gutter's lean
- [ ] On the phone

## M1.78 — Grades, saved bests and a boss rush (2026-11-23, `claude/game-records-boss-rush-2d742b`, ADR-179)
- [x] A grade for clean play (deaths and the winning attempt's damage; time only orders a grade), marks beside it
- [x] The store (localStorage, versioned, survives broken storage), the run record shaped for a leaderboard, `game:record`
- [x] What voids a run: the Lab, cheats, `__tick`, `debug.toState`, `?stage=lab`, `?tech=`, the gameplay URL switches
- [x] The record screen's grade, the title's bests, BOSS RUSH; the rush across page loads, its timer under the minimap
- [x] The owner's picks: the grade's look `a`, the title's `b` (2026-11-24)
- [x] The record panel keeps every row inside its border on every screen (the owner's report, 2026-11-24)
- [ ] Played on a real phone (the title with nine buttons, both ways up); a full rush played by a human

## M1.77 — The perfect parry throws a few orange sparks (2026-11-24, `combat/perfect-sparks`, ADR-181)
- [x] A calm spit of orange spark letters off the crossed blades on a perfect parry (`?parryFx=a`, the default; `0` as before)
- [x] The shipped mark, freeze, slow motion, sound and the perfect dodge's afterimage unchanged (the owner's call after three rejected passes)
- [ ] Played and seen on the iPhone
- [x] The perfect parry's own reward from the owner's reference: posture break -> deathblow, the chain's sparks grow (ADR-211)
- [ ] The deathblow played on the iPhone; the wyrm's parry answer (it keeps the flurry riposte)
- [x] The parry → deathblow exchange readable to a watcher: a break beat, space, a clean contact, filmed (`?dbread=`, ADR-264)
- [x] The deathblow not cut short: a guard press waits, it takes a perfect blue parry from the blade lock (`?dbLock=`, ADR-280)
- [x] One kind of parry: every parry is perfect (`?parry=one`, ADR-279)
- [ ] The parry's look: the spark spit is small next to the boss's guard; options for the owner
- [ ] The flurry's opening blink after a perfect dodge reads as a teleport with no cue: film it, options for the owner
- [x] The owner's pick of `?dbread=` made the default (`all`)
- [x] The parry's look: `?parryClash=c` (a pinpoint and sparks) and `?blueTell=a` (a small blue cross): the owner's pick, the defaults
- [ ] The strike gap (`?strikeGap=b`, off): re-key Shen Hui's lunges for the room, or keep the spacing as authored
- [ ] A next round on the perfect dodge, if any: from a concrete reference and one narrow prototype; never the background

## M1.76 — Every sound effect back to its first synth version (2026-11-23, `audio/swing-choices`, ADR-178)
- [x] The recorded / designed sounds off by default (`?sfx=new` turns them on; no files fetched while off)
- [x] The new swing and warning options of the session set aside (a git stash, not in the repo)
- [x] The music (ADR-117) kept
- [ ] The next sound round, from the baseline: the owner says what they want first (a reference, a game, a word) rather than picking from options they then reject

## M1.75 — A fight the world feels (2026-11-23, `world/fight-alive`, ADR-177)
- [x] The hero's blade goes clean through what it does not fell (`?cutStop=1`: the stop of ADR-132)
- [x] A mark of its kind for every boss blow that meets the ground, on all eight bosses, until the reset (`?marks=0`)
- [x] Flocks that flee fire, blows and falling trees; rabbits, deer, rats, lizards, one fox
- [x] The set shakes (leaves, dust, what hangs, pebbles, the bonfire); smoke, embers and haze after
- [ ] Played by the owner; their calls on the sparks, the marks' brightness, the flock, the deer and the fox
- [ ] The kinds of mark at the game camera; marks on grass (a "torn" floor channel the grass reads)
- [ ] The faint ones: dust sift, pebbles, smoke, crater haze, the tree's shudder; Ashfall's crows
- [ ] Films with real boss moves for every level; the phone; Halcyon Plaza's pigeons looked at

## M1.73 — Xin Yi reworked: drawn like the hero, kicks and flurries, a wall kick, bullets that never lock (2026-11-23, `claude/xinyi-rework-4b1d8a`, ADR-168 – ADR-170)
- [x] Printed like the hero: his letters follow his size (`?oneLetters`), the quiet print and simpler shapes (`?onePrint` a / b / 0), the coat moving in every phase and clamped for flips
- [x] ADR-162's kit for him: soft arms and legs, the shared feet planner (`duelist/feetPlan.js`), palms that stop at the hero, no swings at air; the audit before and after
- [x] Phase 1 in two gears (one hand, then both at 83 %: an opening); the flurry burst (one cue, one result); spin, tornado, butterfly, flash, cartwheel, bicycle, drop heel and flying-knee strikes; eight new strings
- [x] Borrowed Wall off the upright at the hero's side (or the floor): a flying side kick or a drop heel, used often
- [x] The bullets' rule: Iron Rain in bursts of three, one cue and one result each; a hit is a 0.18 s flinch; Iron in the Air
- [x] The owner's pick from the sheets: `?oneLetters=a`, `?onePrint=a` ("Print a", 2026-11-23)
- [ ] Still to pick: `?oneLook`, `?hall`, `?script`
- [ ] On the iPhone: how he reads in letters, the bursts and the wall kick at the phone camera, the frame rate
- [ ] Cut, for later: phase 3's Falling Leaves, the pillar run inside Iron Rain, `doubleWall`
## M1.72 — The living world (2026-11-23, `world/living-world`, ADR-163)
- [x] One shared wind per level (`world/life/wind.js`): fronts through the grass, the canopy, smoke, flames
- [x] Litter that falls, lies and lifts; footsteps by surface, prints, trodden grass
- [x] Weather in slow spells per level; small creatures that mind the hero
- [x] The sound of the air; the arrival shot; the world's answers to the fight; cloth and paper that hang
- [x] `?life=` / `?lifeK=`, the Lab's rows, `tests/integration/life.mjs`
- [x] Round 2, the owner's verdict: the air as clumps of many tiny faint letters (`LetterBatch`, the house letter); the grass band and the streaks gone, wisps instead
- [x] Mist banks and dust devils a second look (soft heaps of 160 - 220 tiny letters that roll; columns of 150 grains); the weather's letters in its own batches
- [x] The owner sees round 2 on the preview ("Looks right")
- [x] The default goes on: every piece at strength 1 (the owner: "Turn it on"); `?life=off` turns it off
- [ ] The drizzle may be too faint; the Ring's devils seldom in view; the Foxfire Terrace's calm shows little
- [ ] Ash drifts, the obsidian glint, moths do not read yet
- [ ] A banner's moon shadow leans with it; the far Throne banners
- [ ] Tuning blocks for the Hall of Falling Script and Halcyon Plaza (today: no arrival, no weather, no litter, no creatures, their own sound bed; the wind's quiet default)
## M1.71 — An eighth level: Halcyon Plaza and Halcyon, the Last Saviour (2026-11-22, `claude/level-future-tyrant-afdefc`, ADR-159 – ADR-161)
- [x] `?level=city`: a crossroads read from its streets, every piece breakable, two-stage towers, cars that
      explode (the set polls them), the city's light as heat (`setPhase`), `?city=a|b|c`; the `y0` fix
- [x] Halcyon: flight in reach, the crash, his eyes (The Stare, Red Glare, Scorched Avenue, Crossed Glare),
      Fly-By, Curbside, Through the Tower, Blink of an Eye, Applause, See the World, Meteor, The Falling
      Sky, Monument, the moments; `?halLook=a|b|c`, `?glare=a|b|c`
- [x] Lab, Training, `tests/integration/city.mjs`; the look sheets in `docs/looks/halcyon/`
- [x] His cape and colours read at game size: `?halCape=0|1|2|3` (ADR-164; default 3), `halCape.png`
- [x] The owner's picks of his body, cape and city: `halLook` a, the blue suit and red cape; `halCape` 3, billowing; `city` a, Neon Rain (2026-11-23)
- [x] The owner's pick of his eyes' heat: `glare` a, crimson with a white-hot core (2026-11-23)
- [x] Printed like the hero, a smaller cape: `?halLetters`, `?halPrint`, `?halCapeSize` (ADR-166; defaults a / a / b), `halAscii.png`, `halCapeSize.png`, `halRecommend.png`
- [x] The owner's picks of his letters, print and cape size: `halLetters` a, `halPrint` a, `halCapeSize` b (2026-11-23, "Yes, keep it")
- [ ] Cut, for later: Last Word (and its beam clash), the hydrants' spouts, his own SFX, his own score
- [ ] A human playtest on the phone (the frame rate on the device is not measured)

## M1.70 — The streak pass: an accelerating flurry, the streak on the hero, in the HUD and in the sound, a sharper perfect parry (2026-11-23, `combat/streak-epic`, ADR-167)
- [x] The core: `combat/streak.js` switches (`?streakfx=`, the Lab's 'streak' row), the tiers 3 / 5 / 7 / 10 / 15
- [x] The storm: a long flurry's later cuts each faster, every blow in its own frame (seven against the wyrm 1.52 -> 1.18 s)
- [x] The tiers, looks only: echo lines on the hanging cuts at 10 / 15, HUNDREDFOLD / THOUSANDFOLD FLASH
- [x] The burst as lines, four levels (`?burst=`; the owner's level 2)
- [x] A single perfect parry / dodge in three looks (`?perfect=`; the owner's sharp), the rules unchanged (game time measured)
- [x] The aura: the steel remembers (round 1), the fire rim (round 3); the world answers from tier 2
- [x] The counter beside the hero and the tier words (`?streakCount=`; the owner's lines)
- [x] The sound: the climb in the track's key, the loss, the drone (the owner's guqin on a minor pentatonic)
- [x] Tests: integ `storm`, `streakfx`, `streakhud`, `streaksound`; duel `perfectfx`; the wyrm's pace meter per seed and in the mean
- [ ] The tier rings on the burst read
- [ ] Cinderwood's fire field near the hero (barely prints in headless captures; check the real page)
- [ ] The aura through the Ghostep's cold cast (it blinks off after a perfect dodge)
- [ ] Played
- [ ] On the phone
- [ ] The sound heard in the game

## M1.68 — Tian Lei's blows audited; he stops attacking the air (2026-11-23, `enemies/ascendant-ascii`, ADR-162)
- [x] A motion audit of every move and of a real fight (opt-in `asc.mjs audit` / `auditfight`)
- [x] Feet that stay planted, arms that open, palms that stop at the hero, a steady roundhouse knee
- [x] He breaks off a blow you ran out of and chases you (`pressure.pursue`): 0 swings at air
- [x] His tracking turn kept as it is (the owner: "Leave it"); the still charges left too
- [ ] Played, and on the phone

## M1.66 — Tian Lei printed like the hero (2026-11-23, `enemies/ascendant-ascii`, ADR-155)
- [x] His letters follow his size on screen as the hero's do (`?ascLetters=a`)
- [x] The hero's quieter print (`?ascLift=b`)
- [x] The gold hair of forms 2 - 3 his own hair risen, not a tall crown (`?ascHair=b`)
- [x] A gi in ember with wraps, not the orange and blue (`?ascLook=e`; r, w kept)
- [ ] Checked on the owner's phone
## M1.65 — A seventh level: the Hall of Falling Script and Xin Yi, the One Who Woke (2026-11-22, `claude/level-code-one-784481`, ADR-156 – ADR-158)
- [x] `?level=code`: one hall, three scenes on the same ten slots that morph behind a front (`scenes`,
      destructibles `present`), the watchers, the falling script, the script wave in the prop and floor letters
- [x] Xin Yi: two bars, three phases (one hand, two guns, the Source), the fall and the rising, the Lean,
      the Bend, the stop and Return to Sender, flight and the Falling Fist's front, deja vu, skipped frames
- [x] The Long Second, the second learned technique (guard, then dodge with no direction)
- [x] Lab, Training (five lessons), `tests/integration/woke.mjs` (and an opt-in LEAN check on the Sheathed)
- [ ] The owner's picks from the sheets: his body (`?oneLook=`), the hall (`?hall=`), the script wave (`?script=`)
- [ ] On the iPhone: the frame rate, how the black coat reads, how the shots read at the phone camera
- [ ] His own score (borrowed tracks until an audition page); the phase banners that decode (cut)
## M1.64 — Wen Yao reworked: drawn like the hero, packs out of the air, the big Pearl, the Nine-Tailed Fox's beam (2026-11-22, `claude/fox-rework-ca0b58`, ADR-154)
- [x] He is drawn in the hero's ink-line art: `?foxLook=h1` the default (russet crest, amber jacket, vermilion scarf), h2 / h3 rendered; his letters follow his size (`?foxLetters`, `kit.letters`)
- [x] The selves only fight in packs: no ambient mode (no scatter, no token); `pack` on a beat, `FoxClones.pack`, booked with the cue ledger; `together` (one cue, one result) and `sequence`
- [x] Pack moves: Two Leaves Fall, the Thousand-Body Round reworked, A Thousand at Once, the Burial, the Kite String, the Pearl's harrying pack (strikers feed it); Changing Places drops its self in
- [x] The signature moves: the big spiral Pearl (pale blue-white, 0.9 m), the Twin Pearls, the giant Moon-Swallowing Pearl lifted by two selves, "It was a copy"
- [x] Heaven-Devouring Howl (phase 3): the Nine-Tailed Fox (a creature body in the art path), the dark sun, a beam that rakes the terrace and breaks the world, the kneel; the camera holds both
- [x] Phase 3's fire its own kind (`?foxFire3`); the pool 5 → 6 rigs; Training (three new situations), the Lab's pack and Howl buttons; `fox.mjs` data / clones / beam / pace
- [ ] Follow-ups:
  - [ ] The owner's picks: `?foxLook=` (h1 h2 h3), `?foxLetters=`, `?foxfire=`, `?foxFire3=`, `?foxSpirit=`, `?clones=` (sheets in `docs/looks/fox/`)
  - [ ] The Nine-Tailed Fox at the game camera reads only when looked for (its head sits at the frame's corner, ~100 px): a bigger head, fewer tails or a pale throat if the owner wants it scarier
  - [ ] The phone: the Howl pulls the camera back to ~55 m to hold the hero and the fox's head; the frame rate with a pack of five out; both on the owner's iPhone
  - [ ] The Moon Wheel (phase 3, a thrown Pearl that opens into a dome of cutting wind): cut first by the plan's order, not built
## M1.63 — The grove's bamboo sliced in one stroke, in clumps (2026-11-22, `world/bamboo-slice`, ADR-151)
- [x] One blade or blow slices a stalk where it bit; the top slides off the cut at once and goes over
- [x] Five kinds of cane, three thicknesses, fanning clumps with shoots (`?bamboo=a|b`; `0` the old grove)
- [x] The back filled: clumps behind him, a denser belt behind him, the wall out to 50 m
- [x] World test `slice`
- [x] The owner picks: `a`, mixed clumps (2026-11-22)
- [ ] Follow-ups: frame cost on the phone; the cut tops lying a while; a slice sound

## M1.62 — A sixth level: the Windless Grove and the Sheathed (2026-11-22, `level/the-sheathed`, ADR-144 – ADR-146)
- [x] `?level=grove`: the bamboo grove (light pieces), the Sword Grave, the paving; `?grove=a|b|c`
- [x] Lu Wusheng, the Sheathed: three phases, the sheath on the rig, the draw's rule (parry or die, a held
      guard never hurt, the honor gate), the grove falling on the click, the hanging cuts
- [x] One Breath, the first fixed reward (`game/unlocks.js`): guard + hold heavy, the draw counter
- [x] Lab, Training, `tests/integration/sheath.mjs`
- [x] The owner's picks from the sheets: his body (d, the Wanderer), the cut, the grove's light
- [x] Readable (ADR-152): the hero's ink-line print (the owner's pick), lifted; his silhouette, motion, lines and names
- [x] The palette: a, indigo and sand (the owner's pick)
- [x] The print: step 2, the digits in his colours, lit and outlined (the owner's pick of five, `?sheathArt=`)
- [ ] The owner's pick of the mark from the ADR-152 sheet (`?sheathMark=`)
- [ ] His own score (borrowed tracks until an audition page)
- [ ] A human playtest of the draw on the phone; One Breath's balance bot on Shen Hui
## M1.61 — A fifth level: the Foxfire Terrace and Wen Yao, the Thousand-Body Fox (2026-11-21, `claude/thousand-body-fox-33750d`, ADR-147, ADR-148)
- [x] An original in the spirit of a ninja-clone hero: his own name, mask, outfit and move names, none of that series' look
- [x] The level (`?level=fox`) and its set: a round paved terrace, lanterns, stone foxes, charm posts that burn, a great stone fox and a spirit gate
- [x] Wen Yao on the duelist engine (no engine change): three phases, nineteen moves as data, links, the seated intro
- [x] The owner's turn (2026-11-22): a bare-handed fist fighter (Tian Lei's strike builders), the homage pushed through what nobody owns (the pack, the palm-driven Pearl, the nine-tailed fox)
- [x] The paper selves: his own bodies (a pool of five built with him), pop in one hit, the cleave, one cut at a time under the fairness guard
- [x] The Pearl: shaped in his palm with a self's help, fed by the selves, starved by popping them, interrupted by two blows, driven home on a dash; Pearl Rain throws three from phase 2; Fox Descending off a self's hands
- [x] The Nine-Tailed Fox (phase 3): one tail to nine as his bar runs out, fire on the world, the tail, the pounce, the black pearl
- [x] Foxfire as a palette of the fire field; the rigid batch's bone texture grows when a level needs it
- [x] The look options rendered (body a - d, foxfire a - c, selves a / b); the fight built with each one's a
- [x] `tests/integration/fox.mjs` in `npm test`; the Lab (FIGHT buttons, LOOKS rows) and Training know him (two situations of his own)
- [ ] Follow-ups:
  - [x] The owner's picks: superseded by the rework (M1.62): he is redrawn, and the picks wait there
  - [ ] The owner plays the preview on the phone: the selves' readability at 852 x 393, the frame rate with five out
  - [ ] The level's own score (it borrows three tracks)
  - [ ] Phase 3 asks more (twice the dodges) but is not busier than phase 2 (79.3 against 80.2 cues a minute, bare-handed; after the rework 68.3 against 79.5: the Howl)

## M1.60 — Tian Lei as a recognizable homage (2026-11-22, `enemies/ascendant-homage`, ADR-150)
- [x] Three homage bodies behind `?ascLook=`; the owner picked the orange gi (`h`)
- [x] Instant Wave (form 3): the sign, beside the hero, a cupped-hands beam
- [x] Options: every beam out of cupped hands (`?ascBeamPose=cup`), the pale gathered sphere (`?ascOrb=c`)
- [ ] The owner picks the beam pose and the orb
- [ ] The wink names for his techniques (proposed: Crane Wave, Spirit Lantern, Instant Step ...)
- [ ] The gold hair apart from the gold aura in forms 2 - 3 (an aura option)
- [ ] One line for lookalike requests across sessions

## M1.59 — Bites: the letters come off where the blow lands (2026-11-21, `world/chip-where-hit`, ADR-132)
- [x] Every breakable as bricks (its triangles; the halves of a flat face pair up), taken where a blow struck
- [x] The share of structure a blow took = the share of the bricks under it; a blast eats the facing side
- [x] A solid piece keeps a skin, set back; foliage, boughs and thin bones are holed
- [x] Faces cut to brick size when the level is built with bites on (`refine`); the same picture
- [x] Each brick falls as its own letter; some stay lying
- [x] Range pieces (the forest, the landmarks) and rigid-batch pieces (stones, pillars, statues)
- [x] The hero's blade strikes at its own height (`ya` / `yb`)
- [x] `?chip=a`, the Lab's WORLD -> Bites; world test `bite`
- [x] The blade stops on what it cannot cut through: freeze, shake, sparks, sticks in wood, thrown back; integ `bladestop` (the owner: "Keep it")
- [x] Chips knocked out of the struck face toward the striker
- [x] The owner picks: on (2026-11-21); `?chip=0` turns it off
- [ ] Follow-ups:
  - [ ] Frame cost of the extra vertices on the phone (Cinderwood 0.92 M -> 1.07 M)
  - [ ] The ground breaks: pits and torn earth where a hard blow lands
  - [ ] The landmarks that stay whole (bonfires, gate, bell, throne, fallen star): the owner's call, one by one
  - [ ] A second layer and a support rule: what hangs over nothing falls
  - [ ] Wreckage that can be cut up (logs, rubble)
## M1.58 — A landed cut has weight: the impact pass (2026-11-22, `combat/impact-weight`, ADR-149)
- [x] Nine ideas proposed; the owner built the first batch (the stamp, the ripple, the reaction by
      where it lands, the sound's weight)
- [x] The core: `combat/impact.js` switches (`?impact=`, the Lab's 'impact' row), one hit record at
      the drawn contact; every piece off = the game as before
- [x] The stamp: the hit printed in the letter grid, stepped, a shape per tier, ink on black, never
      over the hero
- [x] The ripple: a pressure wave through the struck boss's letters (round 2; round 1 did not read)
- [x] The reaction, drawn only: the human bosses (head, body, leg; a thrust folds) and the wyrm
      (head, neck, body, leg, wing, tail)
- [x] The thump: a sub under heavy blows, a short dip of the music (never the cue bus)
- [x] Same-take clips for the owner; the picks: the stamp on the human bosses only, a human boss's
      reaction x1.5, the wyrm's x1, the ripple and the thump x1
- [x] Tests: integ `stamp`, `ripple`, `wyrmreact`, `thump`; duel `react`
- [ ] Follow-ups:
  - [x] Calm at the contact: today's flare toned down in graded levels (`?calm=0..3`); the owner
        picked level 1, now the default (`combat/impactCalm.js`; integ `calm`)
  - [ ] Calm at the contact on the phone, on crits, the execution, the Lord and Tian Lei
  - [ ] C: wounds that stay
  - [ ] E: a spray along the blade
  - [ ] F: the ground answers heavy blows
  - [ ] G: the same care when the hero is hit
  - [ ] I: an impact frame
  - [ ] A real phone: the ripple's second version on the LOW / touch path, the frame rate
  - [ ] A human plays it; the thump heard on speakers and on a phone
  - [ ] Not filmed yet: the execution and crits (stamp, ripple), a flurry and Tian Lei (reactions)
## M1.57 — Round the Obsidian Throne, what the challengers left (2026-11-22, `level/throne-props`, ADR-133)
- [x] The felled forest's identical logs in a starburst replaced: 13 kinds of piece in the prop art
      path, each built afresh, faced to the camera, lying along the blast's way out
- [x] Four options rendered in game for the owner (a shrine / the star's debris / the challengers /
      all); the owner picked the challengers (`?outskirts=c`), the rest behind the switch
- [x] Within 43 m they break where they stand (stone leaves rubble; banners and carts burn; none
      topples, so the Lord's fight is as tuned); nothing tall on the near side
- [x] The fairness guard: a felled piece that would land near a blow of his already cued, needing
      the other answer, lands uncued and harmless (`brain.worldClash`; a gap main had too)
- [ ] The owner plays it
- [ ] Their own break / burn tuning (today the material defaults)

## M1.56 — Tian Lei's third wave: the sign, the counter stances, the great orb, the barrage (2026-11-22, `enemies/ascendant-moves`, ADR-135)
- [x] The engine: a counter stance as a beat (`stance`), the sign before a vanish, several counters a form
- [x] The sign: Sign Step, Three Signs; the first vanish of Vanishing Step, Storm Waltz, Mirage and the thunder Riposte
- [x] Three counter stances (Still Water, Golden Mirror, Thunder Mirror) and three more ripostes
- [x] Heaven's Lantern and THE PUSH; Raining Suns and its returnable finisher
- [x] Training situations, Lab row, test scenarios; the move tables regenerated; PACE green over ten seeds, 0 conflicts
- [ ] Follow-ups:
  - [ ] The owner plays it: the stances' hold (0.2 - 0.4 s) and the open window, the orb's speed, the barrage's spread
  - [ ] The owner picks the orb's look (`?ascOrb=a|b`)
  - [ ] The sign's hand at the game camera (a few cells under the aura): a brighter hand, or the camera closer for the sign
  - [ ] The orb drawn as large as its hit; the push's crater and camera tuned
  - [ ] A real phone: the push's touch block, the barrage's cues

## M1.55 — The hero looks the same on every screen (2026-11-21, `player/hero-look-everywhere`, ADR-130)
- [x] His letter cell follows his size: 0.115 m at his depth on every screen and camera distance
      (the owner's reference picture: 9 letters across the cloak); the lines step with the letters
- [x] His own pixel tag and part tables: the human bosses are drawn exactly as before
- [x] From the front and the side one dark figure: the plate takes the cloak's dim dotted rim
- [x] A dark blade that lights when it cuts (the owner's pick of three); the arc kept
- [ ] The owner plays it on the phone and on the large screen
- [ ] The human bosses on the same letters, if the owner wants it after seeing the hero live
- [ ] The swing's arc and the hero's other effects are still full-resolution glyph sprites beside
      his larger letters on a large screen (the fire field would print them in letters)

## M1.54 — A fourth level: the Skybreak Ring and Tian Lei, the Last Ascendant (2026-11-21, `enemies/ascendant-boss`, ADR-129)
- [x] The moveset agreed with the owner before the build; an original fighter and arena
- [x] The level (`?level=ring`), the set in three arenas, breakable tiles, buttes whose tops come off, the light by form
- [x] Tian Lei on the duelist engine: bare hands (the striking limb is the blade), three forms, a deathblow and a transformation each
- [x] The engine's new beat fields: a zone off the root, hits from the air, a sustained beat, the blade lock at range
- [x] His body (hair by form) and his effects (gold in the fire field, the aura, blasts, the disc, the beam, the vanish, the transformation)
- [x] About forty moves: melee strings, shots, the beams and THE CLASH, the terrain moves; links; the weather
- [x] Integration with ADR-126; a tuning pass over ten seeds (0 conflicts; the dodge share 13 / 23 / 40 %)
- [x] `tests/integration/asc.mjs` (26 scenarios) in `npm test`; Training (94 situations) and the Lab's LOOKS rows
- [x] The owner's picks: arena a, body a, aura a, beam a, the calmer floor and the lighter figure
- [ ] Follow-ups:
  - [ ] The owner plays the preview: the fight's length (2000 a bar is the lead's middle of four measured settings), the difficulty for a player who misses answers
  - [ ] Should an answered flurry break a whole bar? (`TUNING.flurry.posture`, built, off; it changes a rule Training teaches)
  - [ ] The level's own score: an audition page, a track per form (it borrows three tracks today)
  - [ ] Polish that needs eyes: the beam technique's pose at the game camera, the transformation's body under the gather, Stone Storm's tiles against the aura, Heavenfall's landing, the lost clash's surge, the disc and the cage's orbs (small)
  - [ ] His strikes re-filmed on the merged engine in forms 2 and 3 and from every side
  - [ ] A real phone: frame rate, the touch block in the clash, the figures' size
  - [ ] One foot planner for the three human bosses (a per-kit step setting in `player/anim.js`)
  - [ ] Thunderfall at its intended rate (every 4.0 s today against 3.2 → 1.8 s): a second strike in a pair
  - [ ] Decide what stays behind the switches (arenas b / c, outfits c / d, auras b / c, the braid beam)

## M1.53 — A felled tree lies as the blow left it (2026-11-21, `world/crumbling-border`, ADR-128)
- [x] The stump cut by the blow: height, a slanted top, splinters, a push toward the fall; burnt: low and black
- [x] The fall turns off the blow's line and rolls about its trunk
- [x] The trunk turns as it lands, rests raised, breaks in two with a kink; crooked log shapes
- [x] Some trees that burn through stand as black snags
- [x] Tests: world `lie`; `spread` starts from a known stream
- [ ] Follow-ups:
  - [ ] The owner plays it and picks how far to take it (more splits, taller snags, fewer)
  - [ ] A trunk split down its length (two halves on the stump)

## M1.52 — The drake's glare from every side (2026-11-21, `dragon/drake-eyes`, ADR-127)
- [x] Four anime faces rendered and turned down by the owner; not kept
- [x] The drake's eye a slanted almond turned out, up and forward; a steeper brow, an orbit rim, a dark hollow
- [x] The sims reseed at each model's build (`game.onModelBuilt`): a model's object count no longer moves a seeded fight
- [x] The eyes a quarter smaller (owner)
- [x] The resting neck no longer looks broken: it arches into the head, the head held level at rest (owner)
- [ ] Follow-ups:
  - [ ] On the iPhone: the glare at the phone camera
  - [ ] The eyes from straight above (the game camera's high angle): still small points

## M1.51 — The human bosses' attacks as motion (2026-11-21, `enemies/duelist-motion`, ADR-126)
- [x] Every move of both bosses audited on the rig (hand speed, jumps, sliding feet, blade against the head) and filmed
- [x] The follow-through's own clock; a cubic through the keys; `gather` / `settle`; a bait hold that holds
- [x] A beat owns its channels (`completeBeat`); the blade-driven arm on the keyed angles, and with two hands
- [x] Feet that hold their ground and step under root motion (`_feetClip`)
- [x] The spare arm, the overhead, the thrust, Shen Hui's whirl, the Lord's flourish
- [x] `duel.mjs . motion`; before / after films of seven strings
- [ ] Follow-ups:
  - [ ] The owner's look at the clips and the preview; what still reads wrong, move by move
  - [ ] The Lord's left arm in the staff's spins and the keyed two-handed poses
  - [ ] Reaction clips (hits, staggers, the guard, the deaths) audited the same way
  - [ ] The casting hand and the kicks posed anew
## M1.50 — The tree wall opens: the fight leaves the clearing (2026-11-21, `world/crumbling-border`, ADR-125)
- [x] The edge of the open ground follows what stands of the wall (120 lanes; sealed until a tree is down)
- [x] The hero walks out where it has come down; the wyrm's root follows through a gap wide enough for it
- [x] Meteors, pillars and the barrage follow him out; a tree falling onto opened ground tells red
- [x] The minimap shows the opened ground; the feed says it once; the Lab's Open wall
- [x] Tests: world `edge`, integ `breach`, the open ground in WRECKAGE's report
- [ ] Follow-ups:
  - [ ] The owner plays it: the rate the wall opens at, fighting among the stumps, the 62 m limit
  - [ ] On the iPhone: the frame rate with the wall open
  - [ ] The landmarks' pieces closing their own lanes (the ground behind the skeleton opens rib by rib)
  - [ ] The same for a level with a wall of its own, if one is built

## M1.49 — The Cinder Wyrm's face: the drake (2026-11-20, `dragon/wyrm-face`, ADR-124)
- [x] The shipped face photographed at the game camera and close up; what made it unreadable named
- [x] Four faces on one kit (planes, dark sockets, a dark mouth, a cleared nape): drake, tyrant, viper, revenant
- [x] The owner's pick, the drake, is the face; the gameplay joints unchanged (`integ.mjs . wyrmface`)
- [ ] Follow-ups:
  - [ ] On the iPhone: the face at the phone camera
  - [ ] The intro's close shots framed for the new head
  - [ ] Remove the heads that were turned down (`skull`, `loong`, `demon`, `tyrant`, `viper`, `revenant`) once the drake has been played

## M1.48 — The Cinder Wyrm on a leaner build (2026-11-20, `dragon/wyrm-look`, ADR-123)
- [x] Three full redraws rendered and turned down by the owner; three builds of the shipped wyrm rendered instead
- [x] Build c (the owner's pick) is the wyrm: lean trunk and limbs, a fierce head carried high, a mane of quills
- [x] Drawn only: skeleton, hit volumes, reach and timings as before (`integ.mjs . wyrmlook`); `?wyrmLook=0|a|b` kept
- [ ] Follow-ups:
  - [ ] On the iPhone: how the build reads at the phone camera
  - [ ] Longer bones (neck, tail, legs) if the owner wants the picture's proportions: a retune of reach, volumes and timings
  - [ ] The intro's close shots and the Lab's model viewer framed for the higher head
  - [ ] The body's hurt spheres against the tucked belly

## M1.47 — The duelists' second pass: a director and a fairness guard, Shen Hui's third phase, the Lord's spells in his strings, two arenas that break (2026-11-16, `enemies/duelist-second-pass`, ADR-122)
- [x] A director over a duelist's pick, combo links from half the recovery, chain depth and rest, the openings kept
- [x] A cue ledger and a fairness guard: no two cues needing different answers within 0.3 s (132 before, 0 now); the `pace` meter
- [x] Shen Hui: three phases, sixteen new blade moves, three on the floor, burning ground, a red blow in eight strings
- [x] The Starless Lord: nineteen new moves, the wheeling blade, orbit stones, the Sky as weather, Starless Night, Rupture, the Falling Halo
- [x] Thrown pieces show the flare only (supersedes the landing marks of ADR-109 and ADR-111)
- [x] Both arenas break: courtyard 456 breakables, crater 222; floors whole / cracked / broken; two-stage colossi; pieces outside the scene graph
- [x] Effects with bodies (the shock front, the Kindling, ash on the wind, afterimages, the qi, the Lord's spells, each ignition); look-only random streams
- [x] The owner's picks of every look (2026-11-16): the authors' picks for the effects, the bodies dressed by phase, rubble on earth; the Lab's LOOKS section
- [ ] Follow-ups:
  - [ ] A human playtest of both fights; whether they should be longer or deadlier (posture per parry, health: untouched here)
  - [ ] The cheese spot behind the Obsidian Throne (nothing of the Lord's reaches it)
  - [ ] A missed blow in a long string costing most of the string; two guard cues from different sources 0.1 - 0.25 s apart
  - [ ] The guard stepping in 1 - 4 times a minute in the Lord's fourth form (world pieces his own blows fell)
  - [ ] Music for Shen Hui's third phase (picked by ear); sounds for the new moves and spells
  - [ ] A joint-by-joint audit of the new poses (done for the sword: ADR-226, `audit`); a palm strike for Shen Hui's free hand
  - [ ] On the iPhone: frame rate in the Lord's fourth form with the weather and Starless Night
  - [ ] Remove the looks that were turned down and their switches, once the picks have been played
  - [x] Varr Nihil after the reference pack (ADR-277): his body whole in every form, split blades, the sash, the cape;
        the poses after the strips over the same timing (`?lordRef=a`, `?lordRefMove=a`)
  - [ ] The owner picks `?lordRef` / `?lordRefMove` from the films; a per-move pass on what they name

## M1.45 — The wyrm ablaze, a forest that breaks, letters that follow the zoom (2026-11-16, `dragon/menace-and-ruin`, ADR-120)
- [x] Every tree of Cinderwood is a breakable that wears down in stages (664 breakables on 228 bones)
- [x] The Elder Wyrm's skeleton, the Cinder Tree and the bone nest break in pieces; bone heaps; the bonfire stays
- [x] The wyrm reaches the tree wall: wind from roars, rings, wings and landings; fire that carries on into the trees
- [x] Phase 3: the ignition in the roar, wing tips, claws and tail ablaze, trailing fire, harmless footprints
- [x] The letters follow the player's zoom past the default distance (the owner's pick: b)
- [x] Three sculpted heads behind `?wyrmFace=`: shown, and passed on for now by the owner
- [ ] Follow-ups:
  - [ ] A human playtest: how fast the wall goes, the fire's strength in a real fight, the zoom on the owner's monitor
  - [ ] Frame cost: 16 - 22 % more render time than before at 1080p, mostly the trees' mesh; measure on the iPhone
  - [ ] The wall's damage in more, shorter stretches (it clumps into one to three); a dead tree's stages seen in the canopy
  - [x] A head for the wyrm, when the owner comes back to it: separate fangs, deeper sockets, calmer scales on the face (M1.49, the drake)
  - [ ] The same destruction for the Ashfall Courtyard's and the Obsidian Throne's backgrounds

## M1.44 — The Cinder Wyrm's second pass: pressure, whole-body combos, flying combos, a clearing that breaks (2026-11-15, `dragon/wyrm-second-pass`, ADR-119)
- [x] A director over the wyrm's pick; combo links for every attack; fairness guards; the pressure meter
- [x] Six whole-body attack kinds, seven new strings; the breath's body braced
- [x] Flying combos of two, three and four parts; more fire from the spells; the apocalypse reworked
- [x] The wisp swarm removed; no spinning while breathing; ground tongues, ember rain, cinder spit, fire lanes
- [x] Shock fronts, the fire breath and the small effects redrawn (three looks each for the ring and the breath)
- [x] Terrain moves in 1.3 - 1.8 s with a whole-body grab and no landing mark
- [x] 183 breakables; the wyrm's body wrecks what it meets; wreckage stays; fire spreads within limits
- [ ] Follow-ups:
  - [x] The owner picks the look of the shock ring, the fire breath and the apocalypse: `a` for all three, 2026-11-16 (the rolling front of fire, the torrent, the salvo; b and c stay behind `?ring=`, `?breath=`, `?apoc=`)
  - [ ] A human playtest: the pace per phase, the fairness of layered fire, how fast the clearing wrecks
  - [ ] Phase 1 and phase 3 under their cue-rate targets on some seeds; the wing sweep's misses in three strings
  - [ ] The grabbed tree read from the side; white knots in shell and fireball impacts and in the torrent breath
  - [ ] On the iPhone: frame rate in a phase-3 fight, the sky deck, the flare
  - [x] The same pass for the Ash Disciple and the Starless Lord (M1.47, ADR-122)

## M1.43 — The flare: red, blue and black flashes; the counter; the charged blow (2026-11-15, `combat/flash-tells`, ADR-118)
- [x] The flare replaces the red windup glow and a boss's own red floor ring (hazards keep their ground mark)
- [x] A blue flare marks a parry moment: any parry of it ends the string and the hero counters by himself
- [x] `TELL.BLACK`, the charged blow: a guard or a parry in its way is emptied and knocked open, no damage
- [x] One charged blow per boss (Black maw, Black Tide, Nightfall); Severing Wind, Twin Embers, Severance, Red Meridian
- [x] Twelve existing heavy blows marked as parry moments
- [ ] Follow-ups:
  - [x] The owner picks the flare's look: the streak (shown beside the star and the lance; those stay behind `?flare=`)
  - [ ] The owner judges the black charge and the black flare on screen
  - [ ] A human playtest: how the three fights' length and difficulty moved (the ADR-102 bots not re-run)
  - [ ] The flare on the phone: readable at 852 x 393? Its frame cost?
  - [ ] More moments in the long strings (a marked blow mid-string ends it: tune which)
  - [ ] Training catalogue entries and Lab chips for the new moves

## M1.74 — Combat sounds, round two: the combat core picked by ear (2026-11-23, `audio/sound-round2`, ADR-172)
- [x] The originals rendered through the real engine; eleven fight moments timed from the tuning
- [x] Two designed and up to two recorded options per slot; a picker with WHEN lines and moments
- [x] The owner's picks in the game at matched loudness; `?sfx=old` the originals
- [ ] Follow-ups:
  - [x] The owner's pick of the deflect chain: `a`, weight that builds
  - [x] The other parry uses on the new parry; the streak note quieter on parries; the combo pitch fixed
  - [ ] The next rounds: the Cinder Wyrm, the boss specials, the world and menus

## M1.69 — Attack sounds: cues only for blue / red, blows that sound like their weapon (2026-11-22, `audio/attack-sounds`, ADR-165)
- [x] No cue on a white blow; a recorded warning and timing sound for blue and red
- [x] A blow sound per weapon (sword cut / heavy / thrust / draw, fist light / heavy), timed to the impact
- [x] The wyrm's claws and tail, the hero's sword on the same takes
- [x] An audition page; the owner's picks ship; `?sfx=old` and a Lab row
- [ ] Follow-ups:
  - [x] The blue timing sound: three rounds of recordings heard, the synth ping kept
  - [ ] The owner's listen in a fight and on the phone: the mix against the music
  - [ ] A real punch / kick and creature swipe if a CC0 recording turns up

## M1.42 — Dark music per level and per boss phase (2026-11-15, `audio/dark-score`, ADR-117)
- [x] Recorded CC0 sound effects tried and dropped (too noisy: PR #55 closed); the effects stay synthesised
- [x] An audition page: three dark candidates for each of 14 slots; the owner's picks ship
- [x] Each level's exploring track; a track per boss phase (3 + 2 + 4); victory and death
- [x] The synth score stays the fallback; `?music=synth` and a Lab A/B switch
- [ ] Follow-ups:
  - [ ] The owner's listen in play, on the phone: levels, loop seams, the phase changes
  - [ ] On the phone: decode time and memory with three decoded tracks

## M1.41 — WHAT'S NEW; the phone camera in a duel's moment; a game of its own (2026-11-15, `ui/changelog-own-identity`, ADR-116)
- [x] WHAT'S NEW: every version's notes from the title (corner button) and the pause menu, with an unread badge
- [x] `tests/changelogcheck.mjs`: every CHANGELOG headline has an in-game entry
- [x] A cinematic's zoom scaled for the phone's closer camera (it took the camera to 9 m)
- [x] The page can no longer be double-tap zoomed from the controls or the game screen (iOS)
- [x] The inspiration's name removed from the game, the docs and the source
- [ ] Follow-ups:
  - [ ] The owner's check on the iPhone: does lock-on still zoom in? (if yes: a screen recording)
  - [ ] Cut 0.5.0: the LATEST release has carried forty-five entries since 0.4.0

## M1.39 — The hero's stance: at ease, and a fencer's guard (2026-11-15, `player/idle-stance`, ADR-114)
- [x] Three stances rendered for the owner's pick (A "At ease", B "Coiled", C "Hidden blade"); A picked
- [x] At ease: the blade on the arm's own line, a hand on the belt; alive at the game camera
- [x] A fencer's guard while locked on or in a boss fight, kept up on the move
- [x] The transitions audited against `main`: the run, a roll, a backstep, taking the guard and letting it down
- [ ] Follow-ups:
  - [ ] The owner's look at it in play and on the phone
  - [ ] The idle actions re-posed from the hand on the belt, if they read wrong
  - [ ] The other outfits (`?heroLook=`) looked at in both stances

## M1.38 — The world breaks (2026-11-15, `world/destruction`, ADR-107; staged PRs by parallel sessions)
- [x] Breakables in a rigid batch, ground fire that burns where it lands, cover, marks, the reset;
      every fighter's blows hit the world (`world/destruction`, ADR-107)
- [x] Cinderwood and Ashfall list their breakables; things to break inside Cinderwood's clearing
- [x] The owner's pick of the debris look: digits (chunks and shards turned down; the switch removed)
- [x] The hero seen behind the wyrm (its own session, PR #41, ADR-106; merged)
- [~] The Obsidian Throne rebuilt open, listing its breakables (its own session and PR, ADR-108)
- [ ] The Starless Lord's terrain moves: pillars and rubble lifted by the Void and thrown (ADR-109)
- [x] The wyrm's terrain moves: Uproot and hurl, Tail bat, Firebrand (its own session and PR, ADR-110)
  - [x] The owner's pick of how it holds a tree: over the shoulder (upright turned down; the switch removed)
  - [ ] A played fight: how often the moves come up on the real clearing, and the phone
  - [ ] The lab stage has no breakables: there the three moves find nothing to take
- [x] The Obsidian Throne rebuilt open (ADR-112, Session 48): three open arenas rendered for the
      owner (Starfall, the Grave of Blades, the Broken Hall), "A Starfall" picked and built: a crater
      with no walls, the star as his throne, 36 breakables (shards, rim slabs, stones in the air)
  - [ ] Owner review of the PR preview on the phone (frame rate there is unverified)
  - [ ] The stones in the air hang still: a slow bob needs the destruction system to carry them
  - [ ] The first hall's wardens and great swords are no longer placed (builders kept in landmarks.js)
- [x] The Starless Lord's terrain moves (ADR-109, Session 49): Void Hurl, Glass Rain, Crown Fall on
      the crater's shards, slabs and hanging stones; Torn Stone scars the floor
  - [x] The owner's look at the film strips ("Keep and tune"); tuned against answering bots
  - [ ] A played fight: his weights for them, whether 0.9 s of flight is too generous
  - [ ] Sounds of their own (the lift reuses the crash, the flight is silent)
  - [x] The hanging stones drift while they wait
- [ ] The wyrm's terrain moves: a tree or a boulder taken up and thrown
- [x] The Ash Disciple's terrain moves: Severed Pillar, Flying Lantern, Three Tolls, Swallow's Return
      (its own session and PR, ADR-111)
- [ ] A human playtest and a bot measurement of the difficulty with breakables and grass fire
- Follow-ups:
  - [x] A broken piece leaves the minimap (it re-bakes when the colliders change)
  - [ ] The phone: the look and the frame rate with fire and debris on screen
  - [ ] Sounds of their own for fire catching and a tree burning (the sizzle and ember hiss are reused)
  - [ ] Training places the hero without checking what stands there
  - [x] The owner's pick of the look of the bell's ring of sound: arc (the wave look turned down and removed)
  - [ ] A toll sound of its own for the bell (the world's metal chip plays)
  - [ ] The courtyard's ring builds two pillars on the same spot at three corners

## M1.37 — The hero seen through what covers him (2026-11-15, `claude/render-hero-seen-125813`, ADR-106)
- [x] The covered parts of the hero print through the wyrm (and any object) as a cyan ink ghost
- [x] Three looks built (ink ghost / window / rim only); the owner picked the ink ghost
- [x] Only while covered; pixel-identical in the open; the duels unchanged
- [x] A probe gates the pass: one draw call in the open, the second draw of the hero only under cover
- [ ] The owner's phone test: the look in a played fight, the frame rate, Safari's occlusion queries
- [ ] Thrown trees and lifted pillars (the terrain work) checked as cover when they exist

## M1.35 — The rewards ordered by risk (2026-11-15, `combat/reward-order`, ADR-102)
The first of the changes from the genre review (owner: "lets implement your suggestions").
- [x] Strategy bots (mixed / parry-only / dodge-only) in all three suites; measured before and after
- [x] The flurry and the plunge on a red blow's perfect dodge only; a white one: a pip and slow-mo
- [x] The flash counter: a trade clash at the last instant goes through him
- [x] A perfect parry pays: × 1.5 posture, the counter cut
- [ ] A human plays it; then the counter's window (0.03 s), its 70 damage, the counter cut's 0.9 s
- [ ] Film the flash counter and the in-place perfect dodge; a Lab switch for `flurryAny`
- [ ] The rest of the review, each its own PR:
  - [x] A frame simulated in steps of about 1 / 60 s (`core/sim-step`, ADR-103: no step longer than
        20.8 ms at any frame rate; not a fixed step with interpolation: see the ADR)
  - [ ] A performance budget (a target machine, a frame-time ceiling); event-timestamped presses
        (the cost of two to six steps a frame on a slow machine: measured and lowered, ADR-199, M1.89)
  - [x] Per-move telemetry; the killing move on the death screen (`game/move-telemetry`, ADR-108)
  - [ ] Read the table after the owner's sessions and tune from it; a way to read it on the phone
  - [x] A heavy button: five heavy branches off the chain, the charge on the heavy, a 2 x 2 phone pad
        (`player/heavy-branches`, ADR-115; the owner picked branches over direction-chosen swings)
  - [ ] The owner's look at the heavies in motion; tune their numbers from play
  - [ ] The rising backhand's first frame flings the free hand ~64° (from the falling cut's finish to
        the sword wrist; on `main` too, unmeasured there: that frame was 'pending'). integ HEROLIFE
        measures from a swing's second frame
  - [ ] HP-linked posture (the Lord's rule) for every boss
  - [ ] Save file, a hub at the bonfire, a boss order that starts on Shen Hui, ranks, difficulty tiers,
        a reduce-flashes option
  - [ ] The single boss slot as an actor list (before mobs or a duo fight)
  - [ ] Designed sound for the core combat hits
  - [x] A theme per boss, and per phase (recorded CC0 music, ADR-117)
## M1.34 — The flurry on a man; the afterimage (2026-11-15, `player/flurry-duel-read`, ADR-101)
- [x] A pacing of its own against a duelist: wound up, past his side, a held finish
- [x] A flurry's blows do not shove a duelist; the last staggers him away from the hero
- [x] Effects and camera sized for a man
- [x] The afterimage printed in digits from his own body, on every blink; digits fly to where he reappears
- [x] Three afterimage looks built; the owner picked digits
- [ ] Phones: the particle count of a long flurry

## M1.33 — Training and the lab stage (2026-11-15, `dev/training-lab`, ADR-099)
- [x] A catalogue of situations by category, one click each, played through the game's own input
- [x] The panel: banner, ✓ / ✗, speed, loop, the answer for boss moves, the stage, the boss
- [x] The training room (`?stage=lab`): three looks built, the owner picked Holo
- [x] Every situation is a test (integ / duel / lord TRAINING)
- [ ] Phones: the panel and the stage
- [ ] More situations as they are asked for (a whole phase played out, a boss bot vs the hero bot)

## M1.32 — Weight on the flurry; one streak; a foe's streak (2026-11-15, `combat/streak-everywhere`, ADR-094)
- [x] Flash cuts that land: the hero's freeze, the target's reel, clones, ground shock, the last blow's impact frame
- [x] Parries, deflects, clashes and the mikiri count in the streak
- [x] The riposte: a parried last blow answered with as many flash cuts as the streak counts
- [x] Duelists: a streak of guards (pips on the boss bar) and a flurry of that many blows from every side
- [x] Answer every blow of it (parry or block) and his posture breaks
- [ ] A human plays it; then the riposte's damage, the foe's thresholds
- [ ] Follow-ups:
  - [ ] Film the riposte, the Lord's flurries, the screen cuts; the phone
  - [ ] Sounds of its own for his flurry (it borrows the gong and the tells)
  - [ ] An afterimage of the foe where he stood (the Lord has one for his blink)

## M1.30 — The streak and the flurry (2026-11-14, `player/ghostep-flurry`, ADR-091)
- [x] A streak of perfect dodges (it ends when a blow hurts); pips, "GHOSTEP ×N", the victory record
- [x] The flurry: N blows for a streak of N (7 at most): flash cuts whose lines hang, then an art
- [x] Six arts: Skyfall (the plunge), Severing Line, Heaven Splitter; Passing Cut, Falling Leaf, Rising Moon
- [x] The world held at 7 % while the hero cuts in real time; the camera leans in
- [x] Its look (afterimages, hanging lines, crescents, the burst), its sounds, the cut counter and the banner
- [x] Lab: flurry x1 … x7, an art picker; tests (integ FLURRY, duel GHOSTEP)
- [ ] A human plays it, and on the phone; then pace, the cap, whether a streak should run out
- [ ] Follow-ups:
  - [ ] Hear the sounds (written, not heard)
  - [ ] The hero's pass and vault poses in close-up
  - [ ] Balance: a duelist's fight is shorter for a player who dodges well
  - [ ] More arts (a whirl; one that uses the free hand); an art per equipped technique (ADR-059)

## M1.29 — The free hand in sword fingers; weight and footwork; a cut that lands; outfits to pick from (2026-11-14, `player/free-hand`, ADR-086 – ADR-090)
- [x] A wrist for the free hand, stable at any frame rate; the sword-fingers hand; a choreography per cut; no fist pops; the free elbow bent on the grip (ADR-086)
- [x] The shaped step; the hips and chest lead the cut; bow stances; the edge bites; planted feet pivot and follow; the whirl hops (ADR-087)
- [x] A cut drawn where it lands: the slash line, sparks along the cut, the flare and glint, the kick, the punch, the cut sound, the shudder (ADR-088)
- [x] Three outfits (and their faces in shadow) and three sword looks behind `?heroLook=` / `?sword=`, with sheets for the owner (ADR-089)
- [x] Fixed: a hero rebuild wiped a boss's own part ink
- [x] The owner's call on the looks: today's look and sword stay the default; the three outfits and three sword looks are kept behind their switches for later (ADR-090)
- [x] After the first preview: a fist that reads as a hand; the charged blade clear of his hood; arms that open at contact, elbows in on the run, arms that swing in a strafe (ADR-090)
- [x] After an independent review of that round: the arms swing in a pure strafe and no longer jump on a direction flip; the guard breathes; swings come home softly; the Ash Disciple's arms left as they were
- [ ] The owner's look at round 2; the whirl's feet (hop or carry)
  - [ ] Coil → charge: the blade still turns 52° in one frame; the roll's exit opens the free elbow to 155-160°
- [ ] Follow-ups:
  - [ ] On the phone: the longer lunge on a short click, the kick's feel, fps with the new effects
  - [ ] The wrist on its limit through the falling backhand, the falling cut and the whirl: tune the keys in the Lab close-up if it reads stiff
  - [ ] Hems, cloak tips and the arm drape under the grass in the death's collapse (`_hemY` checks only the hem's centre)
  - [ ] A plate hit sound for the Starless Lord (he takes 'cloth')

## M1.28 — The Starless Lord: black plate, motion, three more spells (2026-11-14, `enemies/starless-lord-armour`, ADR-084, ADR-085)
- [x] A harness of his own (hood and faceplate, cuirass, yoke and pauldrons, plate limbs, war-skirt, cape), drawn at 1.32
- [x] Three heads rendered for the owner's pick (sallet, crown, hood): the owner picked the hood
- [x] New guards, the glide, strings that walk, hop spins, a cartwheel and a backflip, flourishes
- [x] Six new moves (37): Starless Dirge, Crushing Dark, Pinwheel, The Rift, Parting Light, Dark Star
- [x] Every Void effect redrawn; the glide's wake, the blink's afterimage
- [x] Fixed: a waiting duelist stood in his guard (he sits; Shen Hui kneels)
- [x] The hood is his head: the two helms and the `?lordLook=` switch removed; the hood finished (a
      round crown, the brow over the faceplate, an ember rim, the drape on the yoke); the standing
      collar removed (it poked through the hood)
- [ ] A human fight, and on the phone; re-tune for the new moves
- [ ] Follow-ups:
  - [ ] Watch the glide, the cartwheel and the flourishes in motion at 60 fps (reviewed as strips)
  - [ ] His hurt spheres against his drawn size (32 % larger than they are)
  - [ ] Sounds of his own (still none): the blade's hum, thunder, the grip, the star
## M1.27 — Hit reactions and the death fall, audited (2026-11-14, `player/natural-reactions`, ADR-083)
- [x] A knee / elbow floor in the solver (the death's collapse sank both knees 15 cm)
- [x] The knockdown falls away from the blow: onto his front from behind, his facing eased (it spun him 180° in a frame)
- [x] Killed while knocked down he dies where he lies (`deadDown`; he stood up to die again)
- [x] The flinch follows the blow; reactions from mid-swing fade in, an interrupted whirl finishes its turn
- [x] The fall and the corpse: knees buckle, a knee up, a knee out; the cloth lies flat on a lying body
- [ ] Follow-ups:
  - [ ] The owner's look at the preview
  - [ ] Not audited: the plunge's poses

## M1.26 — Steel on steel: blades that meet, a guard you can read, cancels (2026-11-14, `combat/epic-clash`, ADR-079 – ADR-082)
- [x] The clash: one effect of lines on the crossing of the blades; sparks fly through the freeze; a camera punch (ADR-079)
- [x] A parried blow is held where it met the guard and rebounds; the hero's deflect goes to its side and height (ADR-079)
- [x] A short freeze inside a string, a long one where the exchange turns (ADR-079)
- [x] His guard: raised as you swing, a ward on the strike's side, the deflect that bounces the hero and brings the Riposte (ADR-080)
- [x] Cancels: the hero's guard or dodge out of any point of a swing; his guard or step out of a late recovery (ADR-080)
- [x] The blade lock: the two close, the blades cross, the pair slides with the push (ADR-081)
- [x] Duel framing: the camera 6 m closer within a duelist's reach (ADR-081)
- [x] The trade clash (the owner's pick): the hero's cut and his blow at the same moment meet; a string goes on, no punish window, a full cleave wins it, no two in a row (ADR-082)
- [ ] Follow-ups:
  - [ ] The owner's play on the preview (both duelists, the phone): the closer camera, the deflect's odds, the 45 % step out of heavy blows
  - [ ] Ideas not built (the owner's pick): a **counter cut** (the first light after a deflect comes out in half the time); a deathblow camera that orbits; the posture bar glowing as it nears the break; the wyrm's claws met by the same contact pose
  - [ ] A thrust set aside still shows the blades ~0.4 m apart; his hilt is at the hero's chest at the impact (his dash stops 1 m short)

## M1.25 — A faster chain, the finisher as a clip, a recovery that flows (2026-11-14, `player/faster-flow`, ADR-075, ADR-076)
- [x] The pace: a light every ~0.32 s (was 0.42), a 0.12 s cut; the lights' damage back to 30 / 32 / 36 / 30 (ADR-075)
- [x] The Lab's attack-speed slider (`player.debug.attackSpeed`) for trying other paces on the preview (ADR-075)
- [x] The slam as a swings.js clip: a gather, a leap, one two-handed diagonal into the ground, a held landing (ADR-076)
- [x] The way home starts while the follow-through is still moving: no stop, no snap (ADR-076)
- [x] The whirl drops and leans into its turn, the head spots (ADR-076)
- [x] After the first look: both thrusts rise (the level poke read as planted in the ground); the sword arc a fine line off the steel, a thin crescent picked by the owner from three looks (ADR-077)
- [x] Anatomy: joint limits in the solver (elbows, knees, the sword wrist, hands outside the chest); the charge held out from the body (ADR-078)
- [ ] Follow-ups:
  - [ ] The owner's look at the preview: the pace (a number from the Lab's slider if it is still off)
  - [x] Anatomy not yet covered: the off hand's wrist in two-handed cuts (a wrist of its own and the fist on the grip only once it is there: M1.29), the free arm's elbow behind the back in two backhands' recoveries (the free-hand choreography: M1.29; hit reactions and the death fall: M1.27)
  - [ ] Ideas not built (the owner's pick): an afterimage on the sprint slash and the cleave's dash; a strafing guard-up stance while locked on; a second finisher (a spinning smash); a flick of the blade as a chain ends
  - [ ] The roll out of a swing and the guard's raise move the point 0.4–0.8 m in a frame (left: both must be instant)

## M1.24 — Wuxia-flow swings, the dashing cleave, the cross ward, a narrow cape (2026-11-13, `player/wuxia-flow-swings`, ADR-071 – ADR-074)
- [x] Swings as keyframed clips (`swings.js`): a one-handed chain, 13 looks, no two hits in a row in the same plane (ADR-071)
- [x] The charged attack: a two-handed charge beside the head, the dashing cleave, a heavier hit (ADR-072)
- [x] The guard: a deeper, side-on cross ward, the hands before the chest; the cloak: a narrow cape (kept by the owner); the sword 12 % shorter (ADR-073)
- [x] After the first preview: a slower chain (a hit every ~0.42 s), he walks through it (the lead foot alternates), no elbow snaps, a composed free hand, no stop between hits (ADR-071)
- [x] After the second preview: every cut a diagonal, the blade whipping after the hand; the sword arc a line and a veil (ADR-071, ADR-074)
- [ ] Follow-ups:
  - [x] The owner's third look at the preview (merged; then "its too slow right now": M1.25)
  - [x] The finisher (the slam) on the clip system (M1.25)
  - [ ] The whirl: its feet turn on the ground with the spin (a pivot on one foot instead)
  - [ ] Cross-steps and retreating steps; the lunge's elbow still turns 42° in a frame
  - [ ] The cloak's arm drapes flick up when the arm whips home out of a swing
  - [ ] docs/art/hero.md still describes the two-handed swings and the thrust
## M1.23 — The Starless Lord: a third level (2026-11-13, `level/starless-lord`, ADR-068 – ADR-070)
- [x] Three arenas prototyped and rendered for the owner's pick; the Obsidian Throne Hall built
- [x] A shared duelist engine (`enemies/duelist/`); the Ash Disciple moved onto it, tests unchanged
- [x] The Starless Lord: four blade forms, four bars and deathblows, 31 moves, the Void spells, the
      throne intro; HUD pips, DEATHBLOW, a fourth phase in flow / feed / audio / Lab
- [x] `tests/integration/lord.mjs` (level, data, timing, forms, spells, bounds, flow, win)
- [ ] Owner review of the PR preview (`?level=starless`, and on the phone); merge
- [ ] A human playtest: is form 4's 0.36 s rhythm readable, is the blink fair, is he too long?
- [ ] Follow-ups:
  - [ ] Look at every move frame by frame up close (the somersault, the off-hand cuts, the staff)
  - [x] His look as options for the owner (M1.28: three heads on one harness; the owner picked the hood)
  - [ ] Sounds of his own: a blade hum and swing, thunder for the lightning, the ignition
  - [ ] The Void grip (lifted and held: mash to break free), designed and left out (M1.28 ships the
        Crushing Dark instead: a pin, no new hero state)
  - [ ] The crater on a phone (the hall is gone, ADR-112): on-device frame rate with the inlay batch,
        four vent lights and 36 breakables in one batch (desktop numbers: ADR-112)
  - [ ] A reward for beating him (ADR-059), once the technique system lands

## M1.22 — Controller support and remappable controls (2026-11-13, `input/gamepad`, ADR-066, ADR-067)
- [x] Gamepad as a third input source (`core/input.js`), the pad layer (`ui/gamepad.js`): souls-like
      layout, right-stick aim + auto-aim, title / pause menus, pad hints and PlayStation labels, rumble
- [x] Headless PAD scenario (fake standard pad → real Input); checked in the dev server with a faked pad
- [ ] The owner's check with a real controller (feel of the dead zone, the triggers, the rumble)
- [x] Remappable controls, keyboard + mouse and pad: the action layer, the CONTROLS panel, saved
      per browser, every on-screen key follows the bindings (ADR-067)
- [ ] Sound on a pad-only session (browsers need a key / click / tap for audio)
- [ ] A second key per action in the CONTROLS panel; mouse side buttons

## M1.21 — The hero at Shen Hui's size, a trimmed cloak (2026-11-12, `player/hero-size-cloak`)
- [x] The player drawn at 90 % (three sizes previewed beside Shen Hui; the owner picked one) (ADR-064)
- [x] The same cloak trimmed, the coat tails a little shorter (three cloaks previewed) (ADR-065)
- [ ] Follow-ups:
  - [ ] The owner's phone check of the preview
  - [ ] The owner's next asks, one at a time with previews: the face, a hood toggle, the swings

## M1.19 — The Ash Disciple: a second level, a human duelist (2026-11-11, `level/ash-disciple`)
Spec: `docs/specs/ash-disciple.md`.
- [x] Levels: `?level=ash`, a stage picker on the title, a LEVEL row in the Lab; the boss slot (ADR-058)
- [x] The Ashfall Courtyard: bonfire, a path and broken steps, a gate, a paved courtyard in a ring of
      pillars and lanterns, a fallen bell, burned trees, falling ash, thin grey grass
- [x] The Ash Disciple on the hero's skeleton: douli hat, grey robe, bracer and bell sleeve, a jian
      with a tassel; his own stance and keyframe moves (ADR-060)
- [x] Nine moves and a counter in P1, three more in P2, the Kindling transition; feints that never
      glint; Ash Crescent projectiles
- [x] His guard and counters, the Ghostep behind him, the execution thrust (ADR-061)
- [x] Owner rework: a small hat, a long slender jian in a high guard (pick C of three sheets), four
      new moves (Falling Star, Piercing Ash, Rain of Ashes, Hundred Petals), a PBZ-fast pace
- [x] The duel's moments (ADR-062): the full deflect, the blade lock, the mikiri, `flow.cinematic`;
      MOMENTS tests; film strips of each with real input
- [x] Owner rework 2 (ADR-063): the classic jian guard (pick A of three), the hand driven by the blade,
      PBZ-boss speed, step-ins that lead the hero, sprints, strings that stop, flask punish; hit stun
      both ways, the layered parry (freeze, shockwave, flash, clang, perfect slow-mo), his sweep trail;
      PRESSURE + IMPACT tests
- [x] Duel tests (`tests/integration/duel.mjs`: levels, data rules, timing, guard, deflect, Ghostep,
      execution, phases, flow, a bot win; `probe` opt-in); `npm test` + build green
- [ ] Owner review of the PR preview (`?level=ash`, and on the phone); merge
- [ ] A human playtest: is the guard readable, are the feints fair, is he too easy (bots: ~1 min)?
- Follow-ups:
  - [ ] **The reward** (the next PR, ADR-059): the technique system (slots, a meter filled by parries
        and perfect dodges, an equip screen) and his technique as the first one
  - [ ] Look at every move and reaction frame by frame (filmed: Plum Thrust, Swallow Flicks, Crane
        Spins, Rain of Ashes, Falling Star, Piercing Ash, Hundred Petals; the rest by the tests only)
  - [ ] The blade lock's mash rate on a phone (tap ATTACK): is 8 taps / s to win in ~1.5 s fair?
  - [ ] Sounds of his own: a jian whoosh per swing, a step / glide, the Kindling (today: the cues,
        the parry and block clangs, no creature voice)
  - [ ] His hit zones are not his blade: check the zones against the poses in the Lab hitbox overlay
  - [ ] The courtyard: a walled edge so the duel cannot drift out through the gaps between pillars
        (he is bounded; the hero is not), and the approach's own encounters (mobs: M2)
  - [ ] Rename `game.dragon` / `dragon:*` to `game.boss` / `boss:*` once the wyrm work has landed

## M1.18 — Attack variants, hair that reads, a fuller cloak (2026-11-12, `player/hair-depth-attack-variety`)
- [x] 2–3 looks per chain hit, picked at random; hips lead, weight shifts through every sweep (ADR-055)
- [x] Gold strands out of the hood, the face in its shadow (three previews; the owner picked one) (ADR-056)
- [x] The cloak stands off his back: depth in profile, the same width from behind (ADR-057)
- [ ] Follow-ups:
  - [ ] The owner's phone check of the chain and the look
  - [ ] Variants for the sprint slash, the roll cut and the charged attack (now the cleave, ADR-072)

## M1.16 — Breath-born bullets, perfect-parry returns, Armageddon (2026-11-11, `dragon/breath-armageddon`)
- [x] Ground warnings heat the ground (glyph glow + scorch heat, the edge late): no red rings,
      `!` marks or chevrons anywhere (ADR-052)
- [x] A perfect parry (0.08 s) returns embers / wisps as damaging shots; a 120 HP budget per
      pattern (ADR-051)
- [x] Every bullet is breathed from the jaws along the head's aim; Ember torrent, Cinder burst,
      denser Wisp swarm, Scouring breath; "Hard" numbers (ADR-050)
- [x] Armageddon replaces the Meteor rain: a salvo into the sky, waves over the whole clearing with
      safe ground kept, burning P3 craters, a great meteor (ADR-053)
- [ ] Follow-ups:
  - [ ] The owner's phone test of the preview (frame rate, bullet and heat-glow readability)
  - [ ] A human playtest of the Hard patterns, the 0.08 s return window and the return budget
  - [ ] Watch the P3 crater ticks (a hero who never steps out takes many) and the Scouring breath's
        single crossing of a standing hero
  - [ ] Melee perfect parries (out of scope here: the flag is computed for every parry)
  - [ ] Re-run the `win` / `probe` bots and the AI pick shares with the new patterns
  - [ ] Bullet sounds of their own (a cough, the stream) beyond the breath loop

## M1.15 — Two hands, a raised guard, idle life, gold hair (2026-11-12, `player/two-hands-idle-life`)
- [x] Both hands on every swing and the stab; the off hand closes round the grip (ADR-046)
- [x] A two-handed guard, the blade raised ~50° across the body
- [x] Idle actions: look, stretch, inspect, twirl, shoulder rest, lean on the sword (ADR-047)
- [x] Cloak sheets keep out of the blade; the charge's blade clears the cloak (ADR-048)
- [x] A rounder hood worn back, gold hair, a warmer face (ADR-049)
- [ ] Follow-ups:
  - [ ] The owner's phone test of the look and the motion
  - [ ] The arms through the cloak at the sheets' roots; the twirl through the cloak
  - [ ] The left arm locks at the end of the two-handed stab and the slam

## M1.14 — A hooded cloak, arms that bend, fewer draw calls (2026-11-11, `player/natural-arms-mobile-perf`)
- [x] The Shrouded set as the default outfit: hood, wrap tunic, bound sleeves, tattered cloak (ADR-043)
- [x] Swings with a bent elbow and a trailing blade; no pose locks an arm straight (ADR-044)
- [x] Rigid batching: the hero and the wyrm draw one mesh per material and one shadow mesh each;
      509 → 56 draw calls in the fight on the phone preset (ADR-045)
- [x] One scene matrix update per frame; LOW quality uses a 1024 shadow map; `?nobatch` for an A/B
- [ ] Follow-ups:
  - [ ] The owner's phone test: frame rate with and without `?nobatch`, and how the motion reads
  - [ ] Cloak collision (legs, ground, coat tails) and a calmer cloak in the roll
  - [ ] The slam's windup still bends the wrist 145° for ~3 frames
  - [ ] Idle, block, heal, roll, thrust, stagger, knockdown, death and plunge with the new outfit
  - [ ] Re-measure damage per second and the bot win time after the arm changes
  - [ ] docs/art/hero.md: the Shrouded set and the new arm

## M1.13 — Hands, the five-hit chain, equipment slots (2026-11-11, `look/hero-hands-combo-slots`)
- [x] Real hands: a fist round the grip, a left hand with fingers (ADR-041)
- [x] Idle: the blade low at his side, edge down; a slim side profile (cape, coat)
- [x] LMB chain of five (falling cut, rising backhand, whirl, stab, slam); sprint slash; roll cut
- [x] Gear slots as data, `player.equip` / `setLoadout`, the undersuit (ADR-042)
- [ ] Follow-ups:
  - [ ] A human playtest of the new chain (pacing, the whirl's exposed back, the sprint slash's aim)
  - [ ] Weapons of other lengths: the animator, the hit segment and the blade FX read `DIM`
  - [ ] A per-slot swap that keeps the pose; per-item materials and stats (a hood that hides the
        hair: done, ADR-043)
  - [ ] An inventory / equip menu (a second gear set exists: the Shrouded set, ADR-043)
  - [ ] Heal, stagger, knockdown, death and plunge poses were not re-checked with the new hands
  - [ ] docs/art/hero.md still describes the lean build, ADR-038's idle and the three-hit chain

## M1.12 — Hero review: athletic build, idle sword hold (2026-11-09)
- [x] Athletic build: broader chest and shoulders, thicker limbs, head ×1.08 (ADR-040)
- [x] Idle: shoulder-width stance, the blade out to his right side, visible from the game camera
- [x] Light-attack recovery comes home round the front; tip streak on the point
- [ ] Follow-ups:
  - [ ] Facing west / north-west the idle blade is still hidden behind him at the game camera
  - [ ] Heal, stagger, knockdown, death and plunge poses were not re-checked with the new build
  - [ ] docs/art/hero.md still describes the lean build and ADR-038's idle

## M1.11 — Bullet hell and the moonlit sword (2026-11-09, `combat/wyrm-bullet-hell`)
- [x] A 1.25 m blue-white sword; the idle holds it at his right side, clear of the coat (ADR-038)
- [x] The bullet field: embers and homing wisps to deflect / block / roll / cut, red orbs to dodge;
      every bullet cues before it lands (ADR-039)
- [x] Four patterns: ember storm (spirals), cinder fan (wing volleys), wisp swarm (homing), fire
      wheel (sweeping beams)
- [x] Two more strings (Storm flurry, Cinder flurry with scattered embers); shorter idle gaps;
      `damageScale` 0.85
- [x] Fire look: breath, fireball, claw wakes, slam bursts, the parry clash
- [ ] Follow-ups:
  - [ ] A human playtest of the difficulty (bots only so far) and of bullet readability on a phone
  - [ ] Re-measure the AI pick shares with the six new attacks in the pool
  - [ ] Bullet sounds of their own (the patterns reuse the fire casts; a deflect reuses the parry)
  - [ ] Look at `slamBurst`, the Storm flurry and the frame cost of a phase-3 storm on a low-end device
  - [ ] The drawn steel is 0.44 m shorter than the hit segment: decide whether to shorten the reach

## Polish — the bosses, their moves and the arenas, before ship (planned 2026-11-26)
The owner's three asks for the game as it will be sold. Each look is the owner's pick from rendered
options (the project rule); each pass is shown as zoomed sheets and film strips, not stills alone.

### P1 — Every boss in the house ASCII look
- [ ] An audit sheet: every boss beside the hero at the game camera, at 720p and on the phone preset,
      each scored against STYLE.md "The house style" (small fine digits, a dark body lit only where
      light catches, a stroke outline, no blank cell inside a shape); the ones that do not match named
- [x] The human bosses printed the hero's way (ADR-194) checked boss by boss; the ones it missed or
      only recoloured brought over in their own colours (ADR-220: his shading and outline, their colours)
- [ ] The non-human bosses and the summons (the wyrm, the fox's paper copies, spells and bolts in the
      fire field) checked the same way
- [ ] The fixes in order of how far each is from the look; options rendered per boss for the owner
- [ ] A test or sheet script so a new boss is checked against the look before it ships
- [ ] Done alongside S2: a boss whose look changes for the legal review is redrawn once, not twice

### P2 — Every boss's swings and motion, natural and polished
- [ ] An audit per boss and per move: windup, swing, follow-through, recovery and footwork, measured
      (arm snaps, hand speed, pops) and filmed at the game camera from four sides
- [ ] Hit reactions, staggers, phase changes and deaths audited the same way
- [ ] Tells kept readable: a move's windup and its blue / red timing do not change unless the owner
      asks (COMBAT.md); the pace meters and the duel suites stay green
- [ ] Each boss's polish as its own PR, the before / after strips shown to the owner
- [x] Shen Hui and Varr Nihil (ADR-226): the sword audit (`audit`), the blade in line with the forearm, the arms
      opening, held blue / red tell poses, the Lord's end-of-string shake, two quick blows each, behind
      `?ashMotion` / `?lordMotion`, films sent
  - [x] The owner's pick from the films: both, as the default (Piercing Ash keeps its old thrust)
  - [ ] Their feet (a planted foot handed to a clip slides; legs cross in spins), the Starless Night cast's wrist
- [x] Wen Yao (ADR-249): the anatomy audit (`fox.mjs . anatomy`), straight punches on one line and straight kicks
      at the contact (his paper selves too), the sweep straight through its turn, leaps that land the heel / fists
      on the hero, one cue one meaning (Paper Rain's backfist), behind `?foxLimbs` / `?foxCues`; films sent
  - [x] The owner's pick from the films: both, as the default; his pace kept fast (2026-11-27)
  - [x] Hand to Hand's opening jab: a lead foot the root left behind jumped 0.43 m in a frame; fixed (anim.js `liftFromStep`, the fox only; every move under 0.3 m)
- [x] Shen Hui's form (ADR-250, `?ashForm`): thrusts on the arm's line in a real lunge, diagonal overheads, sweeps
      on the feet, a quiet free hand, the step landing with the blow; measured (`GCD_AUDIT_IMPACT`) and filmed
  - [x] The owner's pick from the films: the form, Ember Whirl b (the cyclone), Heaven-Splitting Fall b (the split)
  - [x] Heaven-Splitting Fall as a jump (the held coil covered his flight)
- [x] Bai Wuji (ADR-255, on the glide of ADR-250): the anatomy audit (`veil.mjs . anatomy`), straight blows on the
      line to the hero, a kick's return without the snap, phase 1's casting hand out of its pocket, behind
      `?wjPolish` / `?wjCastHand`; films sent
  - [x] The owner's pick from the films: both `a`, as the default
  - [ ] A support foot jumps after a blink (Five Sides, Passing Through: anim.js `_feetClip`)
- [x] The Starless Lord's form (ADR-251, `?lordForm`): thrusts on the arm's line in a real lunge, diagonal
      two-handed overheads, sweeps on the feet, a quieter free hand, the step landing with the blow, all four forms;
      measured per form (`lord.mjs . formaudit`) and filmed
  - [x] The owner's picks from the films (2026-11-27): the form, the readable pace (`?lordPace=a`), Void Lightning
        `?boltFx=c` (the storm), the ignitions `?igniteFx=a` (the cocoon)
  - [ ] Grasp and Sever's chop skates 3.4 m over planted feet when the pull is rolled (a dash, as Severance's?)
- [x] Xin Yi (ADR-253): the audit (`audit`, `guns`, `probe`); straight blows on the line, kicks held straight, blows
      that reach, the sweep crossing the hero, the guns on the line of fire with a kick, behind `?oneMoves=b`; two
      redrawn shots and bolts (`?oneGunFx`, `?oneBoltFx`); the `line` test; films sent
  - [x] The owner's picks from the films: motion `b`, the shots `b` (the script), the bolts `a` (the seed), the default
  - [ ] The hooks meeting the hero from the side, the sweep's knee at its very contact, Iron Rain's twin arms
- [x] Lu Wusheng (ADR-252): the form audit (`sheath.mjs form`), the draw's hands (the fist on the hilt, the scabbard
      drawn back) and its lunge, thrusts in line, the overhead on a diagonal, the sweep's feet, the free hand in the
      scabbard cuts, behind `?sheathForm`; the readable pace `?sheathPace`; three looks for the draw `?drawFx`; films sent
  - [x] The owner's picks from the films, made the defaults (the form a; the pace and the draw's look as shipped)
- [x] The Cinder Wyrm (ADR-257): the anatomy audit at each blow's contact (`wyrmanatomy`), every bite led by the
      body and snapped onto the beat, behind `?wyrmStrike=a`
  - [x] The owner's pick from the films (2026-11-27): `a`, the default
  - [x] The head in the meteors' roar no longer tips back past upright (ADR-258, `?wyrmHead=`)
  - [ ] The flights' head in a banked body (skyStrafe's recovery, skyCataclysm's wheel) past vertical
  - [ ] Next: the forelegs straight through the whole rake, the wing blows flapping as one rigid wing, the feet
        skating up to ~1 m in some strings
- [x] Halcyon (ADR-254): measured at every blow's contact in his upright frame (city `audit`, `GCD_AUDIT_IMPACT=1`);
      straight punches on the line to the hero, straight kicks, a flier's long legs, a level pass (`?halMotion=b`),
      rule 10's pace (`?halPace=a`), two looks each for his eye beams and his shockwaves; draft PR, films sent
  - [x] The owner's picks made the default (2026-11-27: `halMotion` b, his fast pace kept, `halEyes` a, `halShock` a)

- [x] Contact (ADR-259): every hit, block, guard and clash drawn ON what it strikes (the bite and follow-through),
      the sparks at the meeting, the struck part answering (the hero's HitReact, arms), an optional reach for a boss's
      short blows; behind `?contact=a|b`, the contact audit, draft PR, films sent
  - [x] The owner's pick from the films (2026-11-27): `b`, the default
  - [x] Second round: the execution's and plunge's bursts at the wound, the wyrm's bite drawn onto the hero, `?contact=c`
  - [ ] Next: the wyrm's poses on its blows (its jaws still short when its hit spheres connect), the execution's
        thrust and the plunge, blows whose hit zone outreaches the drawn limb (move data, the boss sessions')

### P3 — Arenas that are part of the fight, better backgrounds, cooler destruction
- [ ] Arenas the fight uses: cover a boss's shot breaks, pillars a blow brings down, ledges and
      height, hazards that change by phase, a boss that throws or cuts through the set
- [ ] Each arena changes with the fight: phase by phase it breaks further, so the last phase is
      fought in what the first left (an arena's states, not only scattered chips)
- [ ] Better backgrounds: far sets and skylines per level (big ASCII landmarks, through the prop
      art path), depth and silhouettes behind the arena, each level its own read at a glance
- [ ] Cooler destruction: bigger falls (a tower, a statue, a wall coming down in pieces), debris
      that lands and stays, dust and fire that follow (the fire field, LetterBatch), the hit's weight
      in sound and camera; all through the destruction path (ADR-107, ADR-132, ADR-177)
- [ ] Every new piece measured against the cost budget (ADR-206) and on the phone preset: the
      destruction must hold 60 fps on the S1 target devices
- [ ] Options rendered per level for the owner before anything is built

### P4 — Combat additions from research into three sword games (2026-11-26)
Research into Sekiro, Phantom Blade Zero and Onimusha: Way of the Sword found most of their core already here;
five additions proposed to the owner, who picked the order:
- [x] The flash chain: three flash counters in a row, he strikes back after each (ADR-246): the default, picked by
      the owner from films of every duelist (`?counter=0` for the single counter)
- [ ] The owner's playtest of the flash chain (and on the iPhone)
- [ ] The Break finisher: on a posture-broken boss, choose where to cut (head for damage, legs for guard back)
- [ ] Cuts that split the letters: hits spray the boss's own letters along the blade, a killing cut splits him
      along the swing (looks to pick on film first)
- [x] The clash dance: parries in a row inside one string pay more posture each, the ring rises; his posture
      recovers slower as his health falls (ADR-247): the default, picked by the owner from the film (`?clash=0` off)
- [ ] The owner's playtest of the clash dance's ring by ear (and on the iPhone)
- [ ] One answer per unblockable: jump a sweep (and kick off his head), grabs dodge-only, thrusts keep the mikiri
- [ ] A sub-weapon and a swap strike (boss rewards: a few uses per fight; the swap strikes and refills the guard)

## Ship — Steam (Windows / Mac) and the app stores (iOS / Android) (planned 2026-11-25)
The owner's goal: sell gcd on Steam and in the App Store / Google Play. The game stays a web game
(Three.js, WebGL2) and ships inside a wrapper; no engine rewrite. Order: performance first (it shapes
how every later effect is built), the legal review before any store page, the polish above (bosses,
their moves, the arenas), the wrappers when the content is closer to done. Sizes today: ~1.35 MB of code gzipped, ~15 MB of music fetched per level.

### S1 — Performance on the devices we sell to
The frame's cost is M1.89's work (ADR-199, ADR-200, ADR-201, ADR-206: AUTO quality, the still shadow
map, the cost budget, `npm run perf`); its open items stay there. This list is only what shipping adds.
- [ ] Name the target devices and the floor: 60 fps on an iPhone of the last ~4 years, a mid-range
      Android (a Snapdragon 7 / Galaxy A class phone), the Steam Deck, an integrated-graphics laptop,
      an M1 MacBook Air; a stated minimum below which the store page says "not supported"
- [ ] A first baseline on a real mid-range Android phone (`npm run perf --save`); today only an
      RTX 4090 and the owner's iPhone Pro have been measured
- [ ] Heat and battery on a phone: frame time after 15 minutes of play (phones throttle when hot);
      AUTO must settle, not hunt; a 30 fps battery mode if the floor device needs one
- [ ] Memory on a phone: the page's peak GPU and JS memory per level, and through a boss rush (levels
      are page loads today; a wrapper keeps one process alive); iOS kills a web view that grows too far
- [ ] A lost WebGL context, tested in the wrappers and on phones sent to the background: three.js handles
      the loss and the restore, and the pipeline's own GPU state is made again on `webglcontextrestored`
      (the seen-through probe, the still shadow map, the ground's baked relief); a loss and restore checked
      on the desktop (ADR-199 session), not yet on a phone or in a wrapper
- [ ] 120 Hz screens (iPad / iPhone ProMotion, gaming monitors, the Deck's 90 Hz): the sim's step and
      the touch cap behave at every refresh rate
- [ ] First-load time on a phone inside the wrapper (shader compile is ~5 s on desktop, ADR-196's
      loading screen); a shader warm-up or cache if the phone is much slower (the set's hidden remains are
      drawn once at load since ADR-209; effects first drawn mid-fight are not yet)
- [ ] Each target device's `?perf` report (ADR-209) in a fight on three levels, kept with the release notes
- [ ] Each level's code as its own chunk once the bundle passes ~5 MB gzipped (one file today)
- [ ] The Safari / WebKit path kept green: iOS and a Tauri Mac build both run on it; a WebKit pass
      in the release checklist

### S2 — Legal review before a paid release
- [x] A review of every boss, move, name, sound and track that nods at an existing work: what carries
      the reference, the risk, the smallest changes that keep the nod readable (report in
      `.claude/legal-review/REPORT.md`, untracked, 2026-11-25)
- [ ] Rework the four high-risk bosses from one character's signature marks to the archetype (keep the
      fighting style, mood and colour temperature; drop the silhouette, costume and signature technique
      shapes): Halcyon, Xin Yi (and his hall), Tian Lei, Wen Yao; the owner picks per boss from the
      report's three options, rendered
- [ ] Varr Nihil: blades that do not read as light blades, no ribbed breather (medium risk)
- [ ] The owner decides: all eight levels at launch, or launch with the low-risk ones first
- [ ] The homage looks stripped from the release build (a build flag; the dev build may keep them)
- [ ] The GitHub repo made private before a store page goes live (its docs record the intent)
- [ ] Third-party notices shipped: Three.js's MIT text (stripped today by `legalComments: 'none'`), the
      fonts' OFL text with the font files bundled in the store builds
- [ ] The few move names that translate a source's technique renamed with each reworked boss
- [ ] A trademark search for "gcd" (classes 9 / 41) before buying a store page
- [ ] Sound files from a second-hand uploader replaced or traced (see the report)
- [ ] A games / IP lawyer reads the result before the paid release
- [ ] Licences on file for every shipped asset (music, sounds, font, libraries) and a credits screen

### S3 — Saves and settings that survive a wrapper
- [ ] One save module in front of `localStorage` (records, unlocks, bindings, settings read it today
      from several files); a versioned save format with migration
- [ ] Saves written to real files in the wrappers; Steam Cloud; iCloud / Google Play saves decided
- [ ] Settings menu complete: volume, quality, keybinds, touch layout, language (M2's item)

### S4 — Desktop: Steam
- [ ] The wrapper chosen (Electron: the same Chromium everywhere, ~150 MB; Tauri: small, WebKit on
      Mac) from a measured trial of both on Windows and Mac
- [ ] Steamworks: achievements, cloud saves, the overlay, rich presence; controller glyphs
- [ ] Steam Deck verified: 1280x800, the controller only, text sizes, suspend / resume
- [ ] Fullscreen / windowed / resolution options; Alt-Tab and focus loss pause the game
- [ ] Signed and notarised builds (Windows code signing, Apple notarisation); an auto-built release in CI
- [ ] Store page: capsule art, trailer, screenshots, a demo (the web build can stay the free demo)

### S5 — Mobile: App Store and Google Play
- [ ] A Capacitor wrapper; the app behaves as an app, not a page (no page zoom, no pull-to-refresh,
      no text selection, safe areas for the notch and the home bar, landscape lock or both
      orientations decided); Apple rejects apps that feel like a wrapped website
- [ ] Pause and audio stop when the app goes to the background; resume without a reload
- [ ] Bluetooth controllers on iOS / Android; haptics on hits, parries and perfect dodges
- [ ] Touch controls reviewed on small phones and tablets; the tutorial teaches touch
- [ ] Icons, splash screens, store listings, age ratings, privacy labels (telemetry declared or off)
- [ ] The business model decided (paid once, or free with the full game as one purchase); the stores'
      purchase APIs only if the second

### S6 — For everyone
- [ ] Text out of the code into a string table; Simplified Chinese first (the genre's audience),
      then Japanese / Korean; a font and atlas check for the HUD in each
- [ ] Accessibility: colour-blind safe tells (blue / red carry a shape or sound too), a hold-to-guard
      toggle, screen shake and flash strength, subtitles for spoken lines
- [ ] Crash and error reporting from the wrappers (opt-in), so a frozen frame on a player's device is seen
- [ ] A release checklist: every level on every target device, the cost budget, the WebKit pass

## M2 — The boss rush's foundations (revised 2026-11-12, ADR-059)
- [ ] Techniques: a slot system, a meter filled by parries and perfect dodges, an equip screen; the
      Ash Disciple's technique first (the next PR). The store it can read exists: `game/unlocks.js` (ADR-146)
- [~] Fixed rewards per boss: the first, One Breath (the Sheathed's draw-slash, ADR-146), and the second, the Long Second (Xin Yi's lean, ADR-158), ship; the rest (techniques, weapons, abilities, elements); weapons of other lengths
  - [ ] Halcyon's reward: the owner has not chosen one yet (ADR-161)
  - [ ] Bai Wuji's reward: the owner has not chosen one yet (ADR-241)
  - [ ] The False Saint's reward: the owner has not chosen one yet (ADR-285)
  - [ ] The Thousand-Body Fox's Paper Double (a decoy the foe strikes instead of the hero): recorded on the level, not usable (ADR-148); needs the technique slot, a button on every input, a target indirection in every boss's AI
      (the animator, the hit segment and the blade FX read `DIM`)
- [ ] A hub that links the levels (the bonfire)
- [x] A boss-rush mode: every level back to back, a timer, deaths retried with the clock running, a saved rush time and grade (ADR-179)
- [x] Saved records and grades: per level and the rush, best time and best grade, the last 24 run records (ADR-179)
- [ ] Online leaderboards: a server that takes the run records as they are stored (docs/ARCHITECTURE.md "Records"); the seam is `game:record` (or draining `records.recent()` at boot); the server validates (client times can be forged); a player name / account, chosen by the owner
- [ ] The grade's thresholds tuned once the owner has played them (rankTuning.js)
- [ ] More duelists from the roster (The Moth, The Bell-Warden, The Calligrapher, The Iron Abbot)
- [ ] Regular mobs (2–3 types) on the approaches, using the shared combat system and tell rules
- [ ] Save / load (localStorage), settings menu (keybinds, volume, quality)
- ~~Character stats, levels, XP; loot rarity~~ (dropped: fixed rewards, ADR-059)

## M3 — World (v0.4)
- [ ] Zone streaming: multiple connected areas, transitions, minimap per zone
- [ ] Data-driven zone layout (sketch → procedural props)
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
- [x] Merge static dragon parts (spikes/horns/claws) to cut draw calls (rigid batching, ADR-045:
      181 parts in 14 world draws and 1 shadow draw)
- [ ] Fewer hero materials (18 world draws today), e.g. per-part parameters in a texture; grass is
      about 600k of the ~690k triangles a frame
- [ ] Dissolve-aware shadow material for dying creatures
- [ ] TypeScript or JSDoc types for the contracts once the API stabilises
