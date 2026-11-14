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
  - [ ] Anatomy not yet covered: the off hand's wrist in two-handed cuts, the free arm's elbow behind the back in two backhands' recoveries (hit reactions and the death fall: M1.27)
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
  - [ ] The hall on a phone: frame cost of the inlay batch and six brazier lights
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

## M2 — The boss rush's foundations (revised 2026-11-12, ADR-059)
- [ ] Techniques: a slot system, a meter filled by parries and perfect dodges, an equip screen; the
      Ash Disciple's technique first (the next PR)
- [ ] Fixed rewards per boss (techniques, weapons, abilities, elements); weapons of other lengths
      (the animator, the hit segment and the blade FX read `DIM`)
- [ ] A hub that links the levels (the bonfire), and a boss-rush mode (refights back to back, a timer)
- [ ] More duelists from the roster (The Moth, The Bell-Warden, The Calligrapher, The Iron Abbot)
- [ ] Regular mobs (2–3 types) on the approaches, using the shared combat system and tell rules
- [ ] Save / load (localStorage), settings menu (keybinds, volume, quality)
- ~~Character stats, levels, XP; loot rarity~~ (dropped: fixed rewards, ADR-059)

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
- [x] Merge static dragon parts (spikes/horns/claws) to cut draw calls (rigid batching, ADR-045:
      181 parts in 14 world draws and 1 shadow draw)
- [ ] Fewer hero materials (18 world draws today), e.g. per-part parameters in a texture; grass is
      about 600k of the ~690k triangles a frame
- [ ] Dissolve-aware shadow material for dying creatures
- [ ] TypeScript or JSDoc types for the contracts once the API stabilises
