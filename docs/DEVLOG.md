# Dev log

Chronological session notes — newest first. Each entry: date, goal, what changed, decisions,
verification, open issues / next steps. Keep entries short; link commits/PRs when available.

---

## 2026-11-28 — Xin Yi after the reference pack, third pass: the aerials, the guns, the Source (ADR-285)

**Owner:** "Yes, continue" (after the redo below). Still behind `?oneRefMove=a` (and `?oneRef=a` for the hands):
- A3: deeper anticipation before the tornado, butterfly and aerial; every take-off kick lands low and long; the
  flying knee's fist drawn up by the head, the other hand reaching ahead. A2.6: the drop heel lands upright on a
  heel planted just ahead (it split his legs a metre).
- A4: the guns fired from a wider stance. S1.1 / S1.3: the bolt and the send from a shorter stance, the free hand
  down. S1.6: the Still Hand upright and narrow. S2.1: the rise from a deep crouch, a hand on the floor. S2.2: the
  Falling Fist chambered by the ear.
- The left hand: open in phase 3 and gear 2's guard, palm-out for both-palm blows, a fist for mirrored punches and
  the chain punches, closed behind his back in phase 1 gear 1.
**Constraint found:** sinking or raising the body round a compensated hand target moved the shots and bolts 3.7 -
4.4 cm (the arm is at full stretch) and a heavy shot's speed 1.5 %; so at the release only the legs and the free
hand change. `woke.mjs . oneref`: shots and bolts 0.0 cm apart, same speeds, same fx calls; the whole `woke` suite
passes. Stills: `docs/art/character-packs-v04/xin-yi/films/pass3-*.png` (local, not in the repo).
**Open:** the gun aims and the bolt push are not upright as on the sheets (the release must not move); the
turning wheel's handstand and the butterfly's arms are the first pass's; the owner's notes from the preview.

## 2026-11-28 — Xin Yi after the reference pack, redone closer to the sheets (ADR-285)

**Owner:** "im not really seeing much was changed to look like the reference image": the first pass (below) kept
the rebuild's silhouette and poses and only added details. Redone, still behind `?oneRef=a` / `?oneRefMove=a`:
- the figure: a slimmer torso and sleeves (flared cuffs, no padded shoulders), the coat open from the collar to the
  floor with no belt (the fronts part the whole way down; the trousers' belt shows), a wider hem, the jade seam and
  cuffs bright enough to read at the game camera, swept-back uneven hair instead of a cap;
- the right hand: open in his guard (T1.9's offer), a palm turned out through palm blows, a fist only through fist
  blows and with the guns (look.js handNow; the fist stays on the sword joint, so his blade is unchanged);
- the attacks: palm blows upright and straight-armed at chest height (they were a deep crouch at belly height), the
  front kick head high, round / side kicks chest high, the low sweep in a deep crouch.
Checked with stills (guards from four sides, anticipation / contact frames per primitive, hand close-ups) instead
of films; `woke.mjs . oneref` and the whole `woke` suite pass. **Open:** the aerial kicks (A3), the gun poses (A4)
and the Source's spells (S1 - S3) are still the first pass's; the drop heel's contact differs from A2.6 (his
legs split, the sheet's heel planted); mirrored moves throw with the left hand open.


**Owner:** implement Xin Yi's selected appearance and character animation from the reference pack
(`docs/art/character-packs-v04/xin-yi`) on the existing rig; keep every spell, weapon and special effect exactly
as it is (the sheets inform the body only); balance untouched; the candidate behind a switch for comparison, a
preview to test.

**Done:** two switches, off by default (PENDING; the Lab's `oneRef` / `oneRefMove` rows):
- `?oneRef=a` (gear.js, look.js): the coat open in every phase down to the floor in a wider A, a taller collar
  split in front over a pale inner band, the offset jade-grey seam (his left side of the V, his left front panel's
  inner edge), jade cuffs, the glasses' jade temples, a faint grey streak lying on the crown, squarer guns (muzzle
  cells untouched). Parts 7 / 9 inked jade-grey (REF_JADE).
- `?oneRefMove=a` (refMoves.js, poses.js, moves.js): the turnaround's four guards; a key layer through the
  realiser's `keysOf` (same key times): hand blows into a lunge, the beckon out further, the reload's arms wide,
  Unwriting's palms lifted, a long low Dive Within, a hands-low rise, a low Falling Fist landing; reaction clips
  bigger (leans, recoils, stagger, reeling, the Bend) and the Stop's palm straight; phase 1 gear 1's left hand
  behind his back everywhere. Runs over whichever `?oneMoves` is picked.
- Source drift reconciled: the pack's `oneMoves=a` baseline predates ADR-253; today's pick is `b`, so the films
  compare against `b` (the shipped default) and the layer covers 0 / a / b.

**Verification:** `woke.mjs . oneref` all passed (1944 realisations timed identically; phase 1 g1 / g2, 2, 3 fights: same blows, same fx triggers, same shots and bolts). With both switches on: data, timing, wall, flight, gear, bend, stop, dejavu, flurry, stance, rising, herolike all passed. Motion audit off / on: total jolt +1.4 %, foot slide 101.7 / 107.5 m. Films: current vs candidate at the game camera, the same seed per move.

**Open / next:** the owner picks from the films and the preview; per-move corrections on what they name. Known
limits: the grey streak reads faintly; the gear-2 opening and the wall-step take-off jolt a little more out of the new guards; Long Lesson slides its feet a little more; the right hand is a fist mesh (the open offer reads as a forward fist at 720p); the pose layer is broad, not a per-move re-key of all 122 beats.

## 2026-11-28 — The world suite's felled-trunk check made deterministic (branch `test/wreck-trunk-flake`)

**Owner:** "fix the thing thats blocking every pr": `world wreck` ("a felled tree's trunk lies along its fall")
failed CI on #206 and on a clean copy of main, while it had passed #202's CI hours before.

**Cause:** not the game. A felled trunk lands turned off its fall by up to its blow's `yaw` (BREAK.fell, ADR-128;
0.22 rad for the boss's blunt topple) and may snap in two, drawn from the break stream; the scenario did not reseed
it, so the scenarios before it decided the draw, and it asked for `dx > 0.99` (~8°). The same code went green or
red with what ran first.

**Fix (test only):** `wreck` reseeds the break stream (`reseedBreaks(0x51ed)`) and accepts the blow's own turn
(`dx >= cos(BREAK.fell[t.fk].yaw)`). Full `world` suite: green (its wall-clock `budget` check spiked once under
the machine's load and passed alone).

## 2026-11-28 — The deathblow is not cut short: the guard press, the blade lock (ADR-280; `fix/deathblow-guard-lock`)

**Owner:** on the wyrm a perfect parry shows the perfect-dodge streak's effect; mashing attack during the deathblow seems
to cancel it; the streak's flurry teleports gcd with no cue.

- **The wyrm:** by design (ADR-211: the wyrm keeps the flurry riposte; its parries count in the dodge streak). The
  owner: leave it.
- **The cancel:** sims mashing each button through a combo on the Ash Disciple. Attack, heavy and dodge were already
  ignored. Guard (the middle click) ended it at once with 0 damage, and a perfect parry of a blue `lock` blow became
  the blade lock instead of the combo. Both fixed (ADR-280): no guard inside the combo; `player.deathblowClaims`
  keeps the lock away from a combo the parry armed (`?dbLock=lock` as before; Lab `dbLock`).
- **Training:** its "Blade lock" situation sets `dbLock: 'lock'` for itself (a new per-situation field). A first
  try with `riposte: 'old'` fed the dodge streak and failed CI's Lord `foeBlock` (his flurry blocked, no posture
  break): traced situation by situation against main, the Training diverged at "His flurry x7"; the cause was the
  hero flurry's figure stream (`flurry.js` `fseed`), left wherever earlier scenarios' flurries put it. Lord
  `training` now reseeds it per situation, beside `Math.random`.
- **Also on main, fixed here:** duel `parryfx`'s "ten in a row: at most 48 sparks" failed on main too (51): it
  reads the live hero's streak through `?parryGrow=a` (cap 104 from tier 1). It now asks for the base spit (`grow: '0'`).
- **The parry press and the parry sparks:** a second PR (`fix/parry-press`, ADR-275).
- **Checked:** duel `deathblow` (new (g), (h)), `moments`, `clash`, `training`; fox `training`; asc `bare`; the full
  `npm test`.
- **Open / next:** the flurry's opening blink. The owner means the START: right after the perfect dodge he vanishes
  and pops up by the boss. In the sims the jump is small (0.2 - 1.2 m, 3 - 4 frames hidden); it needs filming at the
  game camera, then options to pick from. The riposte's end also snaps 2.4 - 3.5 m back to where he parried.

---
## 2026-11-28 — Varr Nihil after the reference pack (ADR-277; `enemies/varr-ref-anim`)

**Goal:** the owner's reference pack for Varr Nihil (`docs/art/character-packs-v04/varr-nihil`, kept out of the repo:
CLAUDE-HANDOFF.md, COVERAGE.md, inventory.json, fifteen sheets; pages 13 - 15 correct the earlier ones) turned into
his look and his motion, in stages, with no change to balance, and filmed before / after at the game camera. The
owner approves the art; both pieces sit behind switches until then.

- **Stage 1, the look (`?lordRef=a`, read when his rig is built; `starlessLord/refLook.js`):** no form-by-form
  dressing (the hood, helm, plate, skirt and whole cape in all four forms, over `?lordLook=b`); every blade split:
  two rails of the blade's light meeting at the point with a dark slit (`armor`) between them, for the main blade,
  the staff's back blade, the off-hand blade and the cross-hilt's side blades (`blades.cores`, kept shown and scaled
  with their blades in `_showForm`); a short dark cross-guard; the blade field draws two rails of steel half a cell
  each side and no middle stroke, its heat sheath pushed out and lower, the mesh's bloom halved (without those the
  slit filled with glow even at 2 m); the thrown blade two rails; the crimson sash and clasp (`piping`: `lining` is a
  back-face material and never showed from the front); the cape's side sheets turned out and standing off him, every
  sheet lagging further; the crimson inks stronger.
- **Stages 2 - 3, the poses (`?lordRefMove=a`, live):** a pose layer over whatever keys the shipped switches pick,
  the same key times and eases (moves.js `refKey` / `refKeysOf`, `REALISERS_REF`, `CLIPS_BY_FORM_REF`, `clipsOf`;
  poses.js `GUARDS_REF`, `FORM_POSES_REF`, `GLIDE_REF`; lord.js `staffHands`). Guards 9 cm lower on feet 12 cm wider
  and a longer stride; form 1's free fist at his side; form 3's hands wide on the staff (`offAt` -0.14, reset to 0
  every frame outside form 3: the duelist's poses never write it, and -0.24 leaked into form 4 and left the hand off
  the staff); form 4 nearer upright, the hands under the guard (13 H1). Loads sink 0.05, strikes and follow-throughs
  sink 0.09 and lean 0.1 rad, never below -0.4 (a crouch is not pushed deeper: the knees folded shut), feet 3 cm
  wider, not in a flight; the free fist out behind through a one-handed cut. Vigil's Fall lower in its follow-through
  (13 H2; its blade path kept: a steeper path bent his wrist to 70 - 73°), Starfall landing on the staff pointed down
  ahead of his feet (13 H3; straight down, the animator swings a blade out of his legs). Reactions bigger, the carried
  steps and the glide leaning further.
- **Stage 4, the spells:** their looks, origins, lifetimes and paths are the owner's earlier picks and stay; what
  changed is what they are cast with (the split blade in the thrown blade and the blade field). Rupture's floor
  plates (14 Q1) are already floor pieces; nothing of his armour detaches.
- **Kept on purpose:** the two-handed chops on a diagonal (ADR-251, the owner's pick; 05 C6 draws one straight down).
- **Verified:** `lord.mjs . lordref` (2710 realisations time every beat the same on / off; the same seeded 24 s fight
  lands 16 blows at the same times either way; wrist <= 61°, blade >= 0.10 m from the head; four split blades, no
  dressing), `data,timing,forms,spells,swordmotion,lordform` green; an in-browser audit of all 67 moves before /
  after (foot slide, knees, pops, the blade's distance to the hero at each impact, the staff grip); films of 16 moves
  at the game camera (720p) and a close three-quarter view, before / after, impacts at the same times in every take.
- **Open:** the owner's pick of both switches from the films; a per-move pass on what they name; the split at 720p is
  two rails of letters (the blade mesh is ~2 px wide there); the crimson still reads faint at the game camera; the
  form-3 off hand sits further from the staff's line (the audit's wrist-to-line 0.12 -> 0.26 - 0.3 m in the staff's
  long moves); a little more foot slide in Lightning Verse and Wheel of Stones (+0.15 - 0.2 m) and the staff's
  flurry (its flits); harder pops (the second difference of a joint's path) in Severance, Starfall, Void Waltz and
  Vigil's Fall (+30 - 65 %); the phone.


## 2026-11-28 — Agents check what their branch changed before a PR; CI runs the full set (ADR-276; `test/changed-suites`)

**Goal:** the owner saw the later chats take longer to open PRs. Each agent ran the full `npm test` before
its PR (ADR-205), about 75 minutes of work on 8 shared slots, so agents near a PR at once queued for them.

- **The rule (CLAUDE.md, "Go easy on the owner's PC"):** before a PR, run `npm test -- --changed`, not the
  full set. CI runs every task on every PR and auto-merge waits for it, so the gate is unchanged.
- **`--changed` (`tests/run.mjs`, rules in `tests/changed.mjs`):** the files changed since the branch left
  `origin/main` (committed, staged, unstaged, new), mapped to tasks by first-match rules: a boss (folder,
  level, set) to his suite, the wyrm to `integ`, the living world to `life`, the dragon print to its
  suites, a suite or test helper to the suites that use it, docs to `changelogcheck`, and any other
  `src/` file to everything. `--list` prints the pick and why; `--base <ref>` compares with another ref.
- **`changedcheck` (a new task, ~1 s):** every boss folder and level has a rule, every task a rule names
  exists, the files `BOSSES` names exist, and a handful of example picks.

**Verification:** `changedcheck` passes; `--changed --list` on this branch picks everything (it changes
the runner); the rules replayed over the last 60 merged PRs narrow 9. The other 51 touch shared code,
mostly `duelist/lookSwitch.js`. The full `npm test` was not run locally, on purpose: CI runs it on the PR.

**Open:** narrowing `duelist/lookSwitch.js` would need its diff read by section (each boss's switches
sit in its own block); left for later, if the owner wants more out of `--changed`.

---

## 2026-11-28 — The wyrm's death neck, every white spark seen, the scythe and the leap (ADR-274; branch `dragon/death-neck-tells`)

**Owner:** "when the dragon dies and flies up, the head and neck looks unnatural ... like the neck is broken";
"make sure every normal attack shows the white spark hit"; "the blue and red warning paw attacks ... need to be
completely different ... think of multiple different animations that stand out".

**Measured first** (headless Edge, `__tick`, the neck's joints per frame and stick figures of the chain; each cue
rendered twice, with the scene's depth and with nothing in front):
- The death: the throe's head goal lay 8 m off a 6 m neck (the neck pulled straight up, a pole), the limp head was
  laid level whatever the neck did (60 - 62° off the neck's end from 0.2 to 1.3 s), the goal's straight line to the
  ground buckled the neck into a zig-zag as it landed.
- The glints: the wyrm's own paw, foreleg and wings hid 92 - 100 % of its claw glints; a wing blow's glint fell
  off the screen. The fight camera looks down at 58°, so a paw raised and brought down (the blue overhead, the red
  stomp) is foreshortened into the same growing blob.

**Changed:** the death's head swings round the neck's base inside its reach, the throe's head up and forward,
it looks along its neck, the dying head hangs at most ~31° off it (`?deathNeck=0` before). A glint's letters
are drawn over the scene (`FIRE_SEEN`, a blob flag in the fire field) and kept inside the frame, every boss
(`?glintSeen=0` before). The paw blows: `?pawBlue=a|b|c` (scythe, jab, uppercut) and `?pawRed=a|b` (leap, quake),
`pawTells.js` + `WYRM_PAW`, the Lab's LOOKS rows; the owner picked from the films ("the leap and the scythe look
good"): the scythe and the leap are the defaults. The owner also saw the head and neck "all weird" at the films'
start: the film rig's `debug.reset()` left the wyrm in its sleep curl standing beside the hero (a state the game
never shows: it wakes as you come near); re-filmed from its combat stance.

**Verification:** integ `pawtells` (the glint's seen flag and shader; every paw option lands on its cue,
0.00 - 0.03 s off; the death: off the neck 62° → 33°, the sharpest bend 36° → 32°, the head's fling 1.49 → 0.82 m);
the glint audit over every wyrm melee move (claws 90 - 100 % seen); films at the fight camera (sent to the owner).
Full `npm test` before the PR.

**Open / next:** the owner's playtest of the scythe and the leap in the fight (and on the iPhone); the leap's
height and hang may want tuning by feel.
## 2026-11-28 — A new fight stance: the middle guard (ADR-275; `player/stance-four`)

**Owner:** "lets change gcds combat default pose. the way he holds the sword and the angle of the sword doesn't
look like a good fighting stance. give me 4 new combat stance for me to review and approve. show me the video clip
of close and far all in one clip." Picked from the clip: **A, the middle guard**.

- **The switch** (`refStance.js` `HOLDS`, `setHold` / `holdMode`, `?hold=`): a hold is the whole fight stance
  (hands, blade, elbows, free hand, body, knees, feet). `setHold` copies the chosen one into `REF_READY`, so the
  fight's habits (idles.js, `syncStandArm`) aim about its blade. Default `a`; `ref` the ADR-207 hold; `b` high
  guard, `c` sword fingers (one hand), `d` low trailing (one hand). One-handed holds play no fight habits
  (`holdHabits`: they keep both hands on the grip) and the stance's blend never puts the free hand on the grip.
- **The film** (headless Edge, 1080p): per hold a close orbit beside the game camera at true size and x2 (the
  duel's own framing pushed him to the bottom edge, so the far view is the game camera's pitch, distance and
  FOV centred on him), then the four side by side. From straight behind at the game camera A, B and C read alike
  (a blade up the screen); side-on they are four different shapes.
- **Anatomy:** my in-page wrist measure said 42°; `heroref`'s said 73° (bar 60). A sweep in the harness found the
  elbow's pole: tucked a little in (`rP` 0.45, -0.88, -0.15) the wrist is 54° at most over four facings with the
  blade the owner saw (-4°, 30° up; raised to 36° later, below). The toes went back to ADR-207's turn (`heroweight`: the draw cut's
  pivot turned the right foot 0.07 rad from the filmed -0.2, under half the pivot), and the free elbow points out
  to his left (the full run's `looks`: the robe's sleeve wing in his chest on 23 % of frames with it down and in;
  now 2.4 %, main 2.5; ADR-207 met the same). The full run's duel `contact`: a deathblow's last cut lands as he
  is back in the hold, and the filmed blade (30° up) stood 10.5 cm in the duelist at 1.5 m (bar 8). Probed at
  1.3 / 1.5 / 1.7 / 2 m: 36° up with the hands 3 cm higher clears him at 1.5 m (-0.1 cm), wrist 54°. B and D were tuned under 60 for the film (55°, 54° in-page).
- **Checked:** `heroref` green (the hold, the blend, the three habits, every move out of it within ×1.5 + 10 cm of
  the stance before, the guard from the hold); the hero suites; a film strip of a light chain, a block and a roll
  out of the hold.
- **Open:** the owner on the preview (lock-on duels, strafing); whether the turned-down holds b-d stay.## 2026-11-27 — The blackout for a black blow, red trails for a red string, the black impact (ADR-271; `claude/combat-blackout-red-trails-892472`)

**Goal:** two looks from the owner's Phantom Blade Zero reference (a boss fight they sent): a charged (black) attack
drains the whole picture to dark grey, the boss alone readable with a white glint, colour back on the strike; a red
string leaves a long thin red crescent on every cut. Options behind switches, filmed, a draft PR for the owner to pick.

- **The blackout (`?black=0|a|b|c`, default `0`):** `combat/blackout.js` `Blackout` (`game.blackout`, owned and
  stepped by `ui/tells.js`) drives the final pass's new `uBlack` grade: the world drains and dims, the actors are read
  off the scene's ASCII flag (sceneRT alpha, five taps spread by 0.7 of a letter cell): the boss kept whole, the hero
  60 %, a letter brighter than 0.5 - 0.85 keeps its light. The violet goes in it (`TELL_STYLE.black.pale`): the flare
  undyed (white-hot), the charge a white point with pale motes, no violet body, no dark edges. a = dark over the last
  0.3 s before the cue (the film), b = built through the whole charge, c = a darker. Hold 0.3 s past the cue, back
  in 0.08 s of real time (a first version on game time stayed half dark through the strike's hit-stop).
- **Cancels with no list:** whatever draws a charge calls `blackout.beat()` each frame (`DuelFx.charge`, so every
  duelist and the wyrm; one line in the Fox's Howl); 0.15 s without a beat = cancelled, gone in 0.25 s. A retry /
  a state change clears it at once. Checked: stagger, posture break, a Lab interrupt, a retry, his death (duel
  `blackout`), the wyrm's stagger (integ `flare`).
- **The red trail (`?redTrail=0|a|b`, default `0`):** a red cue opens a window to its impact + 0.14 s
  (`DuelFx.tellFlash`), inside which `DuelFx.sweep` lays a line of low-heat fire just outside the tip's path. Blades
  only (Shen Hui, the Lord, Lu Wusheng); fists and the wyrm's claws left out (their path lies on the contact).
- **Films** (game camera, full frame, real speed, 60 fps, beats captioned; the hero holds his guard for the black
  blow, no red hurt edge drawn): `films/adr-271/` in the worktree (not committed) and the shared notes folder's
  `blackout-films/`: `black-ash-compare.mp4` / `black-wyrm-compare.mp4` (today | a / b | c), `red-ash-compare.mp4`
  / `red-lord-compare.mp4` (today | a / b), and each take on its own.
- **Perf:** `npm run perf` (RTX 4090; main saved first, then this branch, then `--black`, which pins the blackout
  full on): the final pass 0.01 / 0.02 ms (1080p / the phone's size) on main and with the blackout off, 0.02 / 0.03 ms
  pinned on (+0.01 ms GPU, the five flag taps); the whole frame 0.85 / 1.01 ms (Cinderwood) and 0.97 - 1.05 / 1.05 -
  1.10 ms (Ashfall) in all three runs. Script: the blackout's step is a few multiplies; the frame's 2.6 - 2.9 ms moved
  within run-to-run noise. No triangles or draws added (`cost.mjs` unchanged).
- **The owner's picks:** blackout **b**, red trail **a**, made the defaults. Then: "we need all blackout attacks to end
  with a devasting impact even if it misses the player ... the dragon blackout attack looks like it does nothing when
  it misses". Added `combat/blackImpact.js` (`?blackImpact=a`, default): the black cue arms it, the beat's own
  impact clock fires it (a duelist's `brain.act`, the wyrm's `brain.action`), hit or miss: a crater + breakables
  struck at power 1.8 in 3.2 m, a shock front of dust 6.5 m (wyrm x 1.8), light, shake 0.45 - 0.85 + punch, a 0.07 s
  held frame on a miss, an explosion + sub + music dip. No extra damage. A cancel before the impact lands nothing.
  Checked: duel `blackout` (one blast at the impact on a guard and on a miss 12 m off, none with `0`, none after a
  stagger), integ `flare` (Black maw missing a hero 16 m off). Films: `impact-ash-compare.mp4`,
  `impact-wyrm-compare.mp4` (before | after on a miss, and on a guard). The pale charge now draws the fight's stream
  (rnd) exactly as the violet one did and the red trail uses the look stream, so the looks never move a seeded fight.
- **Open:** the black flare is white, the colour of a parryable glint (a streak in a dark frame, not the cross);
  things drawn only in the fire field near the boss dim with the world unless bright; a red wake for fists and claws;
  on the bare-handed bosses and the Fox's Howl the impact lands a stride in front of the body; the phone.

## 2026-11-28 — The finish: one tap to begin, game-menu buttons, a new touch pad that fits and moves (ADR-270; `ui/polish-touch`)

**Owner:** one tap on the path or BEGIN HERE must start; BOSS RUSH and BEGIN HERE looked bad, the menus should look
like a real game's. On the phone: BLOCK where DODGE was, DODGE under ATTACK, the FLASK where BLOCK was, lock on at the
fight's start, the phase call ran over the HUD, the controls too big on a small passport-shaped phone, the right
controls further left, and a lock / unlock button to move them (kept).

- **Two taps, found:** the entries selected on `mouseenter` / `focus` and re-drew the detail; iOS takes that first
  tap as a hover. Now only a mouse's hover / a keyboard's focus selects (`titleMenu.js`). The desktop always worked
  with one click (checked).
- **The finish:** cut-corner buttons and panels, an ember BEGIN HERE with a sheen, a cooler TRAVEL, then (the owner:
  the gold rush card looked out of place, empty space on the right) one panel: the world on the left, BEGIN HERE and
  an ember-outline BOSS RUSH stacked on the right; quiet corner buttons; the pause menu in the same look; upright, the open world's panel sticks to the bottom.
- **The pad:** FLASK | HEAVY / BLOCK | ATTACK / DODGE under ATTACK; PAD POSITION's places further in; the whole
  layer scales with the screen (`pad.fit`, replaces `pad.tall`); the padlock drags it (`padOff`, kept, RESET).
- **Lock-on:** `flow._enterBoss` → `player.takeLock()` each frame for up to 4 s, on touch only.
- **The phase call:** `banner.js _clearHud` puts it under the player's frame and the boss bar.
- **Checked:** the browser at 852 x 393 (title, the pad, the padlock drag and its saved place, the lock-on as the
  fight starts, the phase call below the HUD) and 420 x 500 (fit 0.66, the sticky panel); `integ.mjs . touch` green
  with new checks (the layout, the padlock, the fit).
- **Open:** the owner on a real iPhone and the small phone; the fit's floor (0.62); start lock-on for mouse / pad?
## 2026-11-27 — The parry → deathblow exchange, readable (ADR-264; branch `claude/sweet-morse-33ddad`)

**Goal:** the owner could not follow the moment between a parry and the deathblow it starts (a bot parrying Shen
Hui's Riposte): no beat saying he is broken, the two bodies stacked, flashes over the contact. Their rule: nothing a
watcher can't follow. Prototype 2-3 options behind a switch, film them at the game camera, ship none as the default.

**Measured** (the exchange replayed in headless Edge, frame by frame): the combo starts 0.11 s after the parry and
his recoil is replaced by a flinch 0.15 s later; the centres stay ~1.0 m apart for the whole combo; each contact's
heat flash is aged on the hit-pause's slowed clock (~0.5 s real), his hurt flash lights his whole body, and the
brightest thing at the finisher is the hero's own white thrust streak (scene objects hidden in turn, bright pixels
counted; then `fx.add`'s spawns by caller). The white star before the thrust is his blue tell glint: kept.

**Changed** (`?dbread=0|a|b|c|all`, default `0`; the Lab's `dbread`; `DEFENSE.deathblow.read`, `DBFX_TUNE.clean`):
a) the break: he is thrown into his reeling, the hero holds 0.35 s, then steps in (the blows land while he reels:
duelist `takeHit` `keepOpen`); b) space: the hero strikes from 1.3 m (follows, or a short step back) and every blow
drives him back 0.3 m (`takeHit` `shove`); c) a clean contact: the heat flash smaller, on his far side, on the real
clock; a thinner exit burst; no thrust streak on a deathblow; the lighter impact burst (`PlayerFx.contact` `lite`);
his hurt flash 0.3.

**Verified:** duel `deathblow` (f): every mode, a posture break and a blue parry: the same 3 blows and 141 damage, the
beat 0.35 s, he reels and stays open (a broken foe stays on his knee), b's gaps 1.3 - 1.6 m, the dim flash. Films
(today beside each option, real and half speed, Shen Hui's Riposte, 3 blows): the shared notes folder's
`dbread-films/`; gaps today 1.08 m, a 1.6 m, b 1.3 - 1.75 m, all 1.4 m.

**The owner's pick:** `all`, made the default. Then: "during the parries you cant see the swords parrying and clashing
with each other because the characters are clumped up". Measured: the cut parried at 1.42 m, the blue thrust at 1.01 m
(his step-in aims at ~0.7 x a blow's reach, the thrust's dash stops at 1.0 m). Added `?strikeGap=a|b` (a floor of
1.5 / 1.8 m on a duelist's own root motion for blade blows, capped by the blow's reach; off until picked), filmed
beside today. Zoomed, the bodies stand apart up to the contact, but the perfect parry's gold clash, mark and sparks
cover the hero's chest where the blades cross at any gap. The owner said film a smaller one: `?parryClash=a|b` (the mark
0.55 x with rings and the burst 0.6 x / the X alone at 0.4 x and the burst 0.4 x; the sparks as they are), filmed with
the 1.8 m gap beside today, plus a zoom sheet of the first parry in four rows. The blue tell glint before the thrust is
the largest thing over the crossing: a gameplay cue, left alone. The owner picked "Gap b + clash b". As defaults the
full suites failed: any strike-gap floor bends Shen Hui's authored lunges (`ashform`, at 1.5 m too), Thousand Li (a
dash through the hero) stopped short, the pace sims drifted. The floor is now dashes only, never a dash through him,
and off by default. Then the owner turned the gold parry burst down and the white star with a ring (his BLUE TELL,
not the parry): `?parryClash=c` (no gold, a pinpoint and the sparks) and `?blueTell=a` (a small cross dyed blue),
filmed beside today (`newparry-vs-today`). **The owner's pick:** "Yes, new look": both the defaults.

---

## 2026-11-26 — Wen Yao's motion audit: straight limbs at the contact, one cue one meaning (ADR-249; `claude/wen-yao-motion-674ba7`)

**Owner:** a motion audit of every boss (one session each; this is the fox's): weird arm angles, kicks bent at the
strike, unrealistic attacks; every attack readable; his spell effects are the bar for the others.

- **Measured, not eyeballed:** a new opt-in scenario `fox.mjs . anatomy` (every blow's striking limb at its contact
  in his own frame: kick knee, support knee, elbow, the wrist off the shoulder → hero line; `GCD_ANAT_TRACE` per
  frame). Straight punches 123 - 139° at the elbow (bosses without `armSoft` cap at ~145°), the roundhouse 107°, the
  sweep 82° (50 - 90° through its turn), the selves' rising kick 126°; the Kite String's heel landed 0.8 m past the
  hero (he landed on him).
- **Changed** (`thousandFox/limbs.js`, `?foxLimbs=0|a`; Tian Lei's builders untouched): contact keys rewritten (Xin
  Yi's ADR-221 method), his and his selves' animators opened (`armSoft` / `legSoft` / `kickStretch`), the sweep keyed
  every 30° with the foot skimming 5 cm (on the floor `_feetClip` walked it as a planted foot), `leap.stop` (opt-in
  in brain.js) for the heel and hammer leaps. `?foxCues=0|a`: Paper Rain's last blow a backfist (the uppercut is blue
  only). After: straight blows 162 - 167°, kicks 161 - 173°, hooks / uppercuts 111 - 116°.
- **Kept:** his held blue / red windups (ADR-223), every timing and number, every effect (no options: they are the bar).
- **Tests:** `fox.mjs motion` asserts the limbs both ways; the whole fox suite green.
- **Films:** before / after of 15 moves across the three phases, at the game camera (a close crop with the frame as an
  inset) and from the side, real and half speed.

**Picked** (2026-11-27, from the films): both switches `a`, the default; his windups stay PBZ-fast (0.42 s first
blows, under the audit brief's 0.7 s floor: the owner kept them).
**Then fixed** (the owner asked): Hand to Hand's opening jab's lead foot jumped 0.43 m in a frame (on main too): the
planner was stepping it when the clip lifted it, and the ADR-223 ease only caught a planted foot. `anim.js`
`liftFromStep` (opt-in, the fox's kit): every move of his now under 0.3 m a frame, asserted in `fox.mjs motion`.

---

## 2026-11-28 — Bai Wuji round 4: the chip, 16000, the barrier shown where each cut lands (branch `wj3/barrier-playtest`; ADR-266)

**Owner:** "right now it takes too much time to chip at [him] so balance it to be bit easier to do damage on him.
when the player hits him and the sword is hitting the [barrier], show a cool ascii effect of the sword hitting the
barrier and it showing its silhouette briefly."

**What changed.** A cut stopped on the shell chips x0.25 of its damage (`wjBarrier.chip`, `barrier._chip`; never
his last HP; the number rides `dragon:barrier` stop to the HUD). hp 20000 -> 16000. `untouched/fxStrike.js`, after four filmed tries the owner turned down (three waves of light
round the shell; his body's whole outline for the hit: "this looks bad"): "always show up on every hit that [the
barrier] is blocking ... a cool subtle ascii invisible shield briefly showing per hit on the hit location". Now every
stop shows a patch of the shell where it landed: a faint net of crossing strokes opening 0.3 -> 0.8 m round the point,
gone in 0.22 s, nothing else drawn; six at once. `?wjStrike=a` PICKED, `0` the ripple. The ring on the floor counting
an opening down is off (`?wjSign=1`), the owner's call.

**Verification.** Bench (6 seeds): today's main, the good bot 4/6 in 163 - 211 s; the chip alone 4/6 in 160 - 187 s;
16000 + chip 4/6 in 120 - 150 s (deaths with 5 % of his bar left), fencing 5/6; blocker and pace still die.
`veil.mjs . strike` (the chip, its event, every look draws and is gone in a second); filmed on headless Edge
(`docs/looks/veil/wjStrike-patch.jpg`); full `npm test` before the PR.

**Next.** The owner plays it; a sound for the chip if they want one.

---

## 2026-11-27 — The clash dance is the default (ADR-247; branch `claude/combat-clash-dance-default`)

**Owner:** watched the three films of PR 175 (today against the dance: Shen Hui, the Starless Lord, Xin Yi) and said
"Make it default".

**What changed:** `DEFAULT_CLASH` is 'dance' (combat/clashDance.js): the game plays the clash dance with no switch;
`?clash=0` and the Lab's `clash` row `old` give the numbers before. As the flash chain does, the headless sims keep it
off unless a scenario sets it (their posture checks were written for the old numbers); duel `clashdance` now also
checks the default. CHANGELOG / WHAT'S NEW: the entry moved to the top as a change; COMBAT, ARCHITECTURE, ROADMAP,
ADR-247 (an update) say so.

**Open:** the ring by ear on the owner's devices (the films had no sound).

## 2026-11-26 — Tian Lei audited: straight limbs, a readable pace, two ki blasts (ADR-248; branch `claude/tian-lei-motion-32bb13`)

**Owner (the boss motion audit, one session a fighter):** weird arm angles, unrealistic attacks, kicks that stay bent
at the strike; every attack with a clear tell; the special effects as cool as the Fox's and Bai Wuji's, 2-3 options.

**Measured** (asc.mjs AUDIT, now with the striking elbow / knee and the standing knee at contact, and the fist in his
own frame): punches at 141 - 155° crossing his centre line by 0.17 - 0.24 m, the back-fist 0.6 m off to his right;
roundhouses at ~100°, front / side kicks ~150°; the sweep's tuck flipping its knee (709 mm/f²), its planted foot
circling a metre of floor, the close-in sliding the root under the drop (the planted knee flipped, 869); his pace
under rule 10 (first blows 0.4 - 0.5 s, string blows 0.37 - 0.46 s apart, the cue 0.26 s).

**What.** `?ascMotion=b` (`motion.js` straightLimbs / dropStance; `ascendant.js` sets the animator's armSoft /
legSoft / kickStretch live; `brain.js` gains the opt-in beat field `closeBy`, set only by his sweep); `?ascPace=a`
(`pace.js`: the extra held cock through the realiser's `hold`, the cue in his realise wrapper); `?ascShot=a|b`
(`fxShot.js`, hooked from fx.js `_drawBlast` / `_blastBurst`; `_blastWorld` split out). Lab LOOKS rows (pace and
shot `awaiting`). Tests: asc LIMBS, READABLE.

**Result** (b): punches 170 - 172°, fists within 0.1 m of his centre line; kicks 172 - 173°; Eight Gates' worst jolt
455, its slide 2.19 → 1.23 m (the rest is the sweeping foot on the floor, by design). Films: before / after per
form, game camera and close side, half speed; the blast and pace options.

**Picks (2026-11-27).** The owner took all three: the straight limbs, the readable pace, the sun (PICKED; the PR marked
ready). On the new defaults the suite found: the sweep's spin keyed 120° apart folded the leg (now every 60°, the foot
skimming 8 cm, reach 1.2), the long punches went 0.37 m into the hero (the lunge 0.12 m shorter), the pace's hold
inside a dash run (dash blows keep their windup) and its moved cue on ki beats (the Lord's ADR-251 exemptions
adopted); the bots read each cue's lead (`cueLead`); PACE floors re-pinned (F1 64, F2 71); MOTION's slide line
counted lifted steps (0.16 → 0.11 m); the Lab's Training answered paced bosses early (`_lead()` reads the fired
cue). Blast cost: asc `shotcost` (opt-in). Open: the
dash thrusts' feet, the transformations' kneel-to-stand, Thousand Hands' last palm; the beam and the orb as effect
options if the owner wants them.
## 2026-11-27 — Blows land on what they strike (ADR-259; branch `claude/contact-motion-246eeb`)

**Goal:** the owner's contact pass: every hit, deflect, guard, parry and deadly blow should look like it strikes the
part it hits, from the game camera, and the struck one should flinch by where and how hard. Their picks: the blade
bites then follows through (heavies hold longer); reactions by where and how hard; shared code only (the motion
sessions own every move's data); a draft PR with films, behind a switch.

**Measured** (an in-page audit, scratch only: at every contact of every duelist, the drawn striker against capsules
on the struck rig, through the freeze; see the PR's table): the striker was 10 - 75 cm short as often as 10 - 40 cm
through; blocks went through the guard into the body with the blades 0.2 - 0.9 m apart; the hurt sparks sat on the
hero's chest 0.5 m from the meeting; parries already met.

**Changed** (`?contact=a|b`, default `0` until the owner picks; the Lab's `contact` row): `combat/contact.js` (the
search along a striker's clock, the pin, capsule bodies); the duelists' `strikeContact`, the pinned pose drawn over
gameplay points on the clip's own time, the ward nudged onto the hero's blade, the reach (`b`); the hero's
`_cutContact` (his swing's shown clock), his guard nudged onto a blocked blow, his own HitReact, the wyrm's hurt drawn
where its snout / toe / tail struck; react.js gains the arm and the struck limb.

**Verified:** duel / asc `contact` (new): one scripted exchange with 0, a and b, every result identical; hits and
blocks drawn through the hero 41 / 33 % → 0 %; Tian Lei's short hits 64 → 32 % with b. The page audit's before /
after table and the films (all nine bosses, 0 | a | b, half speed) in the PR.

**The owner's pick:** `b` (a + the reach), made the default.

**Second round** (the owner: the not-covered list, with before / after): the execution's burst at the wound (0.23 →
0.01 m), the plunge's at the steel's entry, the wyrm's short bite lunging its head onto the hero (limited by its
neck: 1.27 → 1.06 m), `?contact=c` (a drawn step past the reach: closes little, kept as an option). What stays short
is move data (a string's later blows on a hero knocked back; the wyrm's bite sphere past its jaws).

**Open:** the wyrm's poses; the execution's thrust, the plunge and the flurry's cuts; blows whose
zone outreaches the drawn limb (the motion sessions' data, listed in the notes folder).
## 2026-11-26 — The run from the owner's sketch: trailing sword carries, the free arm opened out (ADR-229; branch `claude/hero-run-sketch-6baa40`)

**Owner (2026-11-25):** "from the back the left arm seems way too pressed in and makes it seem like he has no left
arm during the run. also have the sword be in this angle when he's running instead of it being held in the front",
with a sketch of a blade going on from the forearm, ~35-40° below level. **Measured** the free arm on the drawn
frame (headless Edge, the hero rendered alone four ways: image masks, the camera lean's shear included): today's
forearm clear of the coat on 10-40 % of a stride (gap ~0). **Built (options, defaults unchanged):** `?runArm=e`
(open: 90-100 % clear, 9-12 cm) and `f` (wider: 100 %, 15-18 cm); `?runSword=trail|swept|side` (the blade in the
forearm's line behind him, the wrist 15-40° against `old`'s 57-84°, the steel ≥ 20 cm off the legs, never through
the coat). A block / parry / flask / charge out of a trailing blade now enters over 0.24 s (it flipped 75° in a
frame, `old` too). **Verified:** `herorun` (new bounds for e / f and the trailing carries; the wrist, legs and coat
newly measured), an in-page audit against today's `d` / `hip` (start, stop, sprint, strafe, turn, light, roll,
block, heal). **Sent the owner** close-up films (today | A trail | B swept | C side; today | e | f; the game camera,
behind, his side, the front; half-speed copies). **The owner picked** `e` + `trail`, "but the right arm needs to be straight ... instead of having an angle": the
solver's soft reach had bent the asked 170° elbow to 151°; the trail carry now asks for the arm's full reach
(`_swordOpen`) a hair past the arm's length (`over` 1.03: at exactly its length it still drew 168°, a kink the
owner saw from the game camera), so the arm hangs straight back (176°), the blade 1-5° off it. **Then** the owner, with a game-camera
screenshot and a red arrow down and out to his right: "too straight back ... the arm angle also looks unnatural".
Measured screen angles at the game camera (arm and blade 74-75° down the screen) and searched live: the arm now
hangs out from his side with a soft elbow (154-161°), the blade out along the arrow (~48° down the screen,
azimuth ~117°, 23-35° below level), rocking with the stride; smoother than both versions before. **Then**,
through the owner's asks: `flail` (the blade swinging loose, `pendulum()`), four solid back angles (`b15`-`b45`),
four arms for A (`a1`-`a4`), and "all of them look unnatural ... make it ... anatomy wise correct". The cause:
every carry put the blade near the forearm's line, a grip no fist makes (the blade leaves a fist at ~90° to the
forearm). **`nat`** (the default): the arm relaxed at his side, the fist by his hip, the blade 45-82° off the
forearm, behind him and a little out, steady; ~61° down the screen at the game camera. Films sent. **Then**
the arm's joint (the elbow jutting back as he leans), then "all look bad" (the pointing back, the grip, a stiff arm,
the whole run). Rebuilt from the hand (`fistBlade`: the blade set in the fist, a real grip, the arm a runner's);
three concepts; the owner picked **`g2`** (the point down beside his leg) "but make sure the arm and sword doesn't
clip with the cloak fabric": measured against every coat panel and cape streamer it passed within 0.3 cm; the hand
further off his side and the thumb out, now ≥ 12.6 cm. The default; films sent. **Open:** the owner also ticked
"the whole run" (legs, lean, torso): a separate pass (the loco lean is shared with the duelists' footwork).
**Then** four run styles (`?runStyle=`, turned down), the fist at the hip from the owner's photo (`h`, turned down),
and the guard (`?runArm=g`, the fist held before his chin and chest, posed in the chest's frame), turned down
("looks really bad from the other angles"): the free arm is `e` again, then `a` (the owner's pick of the
variations). **The sword hand's grip:** measured where the forearm enters the fist in the sword's frame; `g2`'s
came in on the thumb's side (a fist wrung round); now opposite the thumb, as in his stand and his guard (`twist`). Both are the defaults now; films
before | after sent. **Open:** setting
off from an idle action that holds the blade up turns a trailing blade 11° a frame; the backpedal guard swings a
trailing blade round at 12-15 cm a frame² (hip 8, old 13).

## 2026-11-27 — Bai Wuji's motion audit (ADR-255; branch `claude/bai-wuji-motion-bd1653`, built on PR 176)

**Owner:** the boss motion audit (2026-11-26): weird arm angles, unrealistic attacks, bent kicks; every attack
readable; his spell effects (and the fox's) are the bar. His melee had just been rebuilt (ADR-250, the glide, PR
176, open): this pass audits the glide and builds on that branch.

**Measured** (`veil.mjs . anatomy`, new, opt-in): every move in every phase, the limb at each contact, an arm's line
to the hero, the worst one-frame jump. The glide's kicks land straight (166 - 175 deg) and its straight blows
open (152 - 169 deg). Found: straight hand blows 12 - 31 deg off the line to the hero's chest (Dark Spark's fist
passed him by most of a metre); a string's kick snapping back off a dead hold (0.4 - 0.57 m in a frame); phase 1's
Azure Draw and Yank cast from a pocket (the Yank's blue fist cue glinting in it). Measuring a line needs an
untilted frame (the rig root leans toward the camera) and the hero's place the frame before the contact.

**Changed:** `?wjPolish=a` (straight blows on the line: 1 - 10 deg; the kick's return a moving hold that eases into
the chamber: Three Count 0.51 -> 0.34 m), `?wjCastHand=a|b` (the casting hand out). `veil.mjs . polish` asserts
them. Films: before / after at the game camera and close, half speed, and the three casting hands.

**Picked:** the owner kept the polish (`a`) and the casting hand out for the whole cast (`a`): the defaults.
**Open:** a support foot jumps after a
blink (Five Sides, Passing Through: anim.js `_feetClip`, the hero session's); PR 176 and Shen Hui's PR both use
ADR-250.

---

## 2026-11-27 — AUTO BENCH: `?perf` benches by itself in a fight (ADR-261; branch `perf/auto-bench`)

**Owner:** "Is there no way we can capture the benchmarks without me having to press it at the laggy moment?"
**What:** `dev/perfReadout.js` `AUTO_BENCH` / `_autoBench`: in a fight, a bench 8 s in and on slow bursts (4 at
most, 10 s apart); the frame after a bench is skipped; each bench records why, AUTO's step, the lite world; the
line shows `bench n/4`; `?perf=manual` turns it off. Test: world `perfreadout`. **Checked:** a 25 s wyrm fight
at the phone's size benched itself 8.9 s in (the desktop GPU never had a slow burst). **Next:** the owner's
REPORT from Cinderwood on the iPhone.

---

## 2026-11-27 — The Starless Lord's form, a readable pace, looks for two specials (ADR-251; branch `claude/lord-motion`)

**Owner:** the motion audit of every boss (weird arm angles and sword positions, unrealistic attacks, readable
tells, special effects at the fox's and Bai Wuji's bar), one session and one draft PR per fighter; batch 2.

**Measured first**, every move in every form it is used in (`lord.mjs . formaudit`, new: the shared sword audit's
impact table, the feet's true slide on the floor, the form-2 off-hand blade's arm): thrusts on a bent arm (121 -
140°) 18 - 23° off the arm's line, the long lunges on two locked knees, the two-handed overheads straight down (71 -
80° off level), the low sweeps' legs crossing (-0.73 m, a knee pop), the front foot still up at half the impacts.
Fine already: the wrist on the blade, the blade clear of his body, the off-hand blade at its own blows.

**Changed** behind `?lordForm=a` (moves.js: each key helper pairs its keys with the form's; a post-pass makes
`formKeys` / `formMotionKeys` / `formRecovery`, picks included; the realisers pick them; ADR-250's recipe, the
overheads kept two-handed): after, thrusts 154 - 157° and 2 - 5° off the line, the lunge's front knee 95°, the
sweeps' feet never cross, the overheads 43 - 61° off level, the front foot down at nearly every cut; timings
identical (LORDFORM). `?lordPace=a` (pace.js, Tian Lei's recipe: rule 10 as a held cock). Effects to pick:
`?boltFx=a|b|c`, `?igniteFx=a|b|c` (specialFx.js). Lab LOOKS rows.

**Film.** Forms 1 - 4, before / after, at the game camera (cropped round the pair) and close from his side, real and
half speed; the effect options as 2 × 2 grids. Rig: the batch's film server and `move.js`, my ports 5284 / 9484.

**Picked** (the owner, from the films): the form, the readable pace, Void Lightning `c` (the storm), the ignitions
`a` (the cocoon); all four in `PICKED`. Open: Grasp and Sever's chop skates 3.4 m when its pull is rolled (needs a root-motion change: asked); the
strings' close-in slides the feet (the hero animator's planner); the off-hand blade points back along the forearm
through form 2's two-handed chops.
## 2026-11-27 — The wyrm's head in the meteors' roar (ADR-258; branch `claude/wyrm-head-motion`)

**Owner:** "The dragons head twists too far back and looks unnatural when it raises its head up to shoot fire."

**What changed:** Meteor Rain's rear-up and cast hold the head up and forward over the forelegs and look straight
up above it (`fireAttacks.js` `HEAD_UP`, `?wyrmHead=a` the default, `0` as before). New opt-in integ `wyrmhead`
measures every fire move's head: Meteor Rain was 90° up and 15° past vertical toward the tail, the head behind the
neck's base, the brow rolled 149°; now 66° up in the chest's frame, never past upright, the head ahead of the
neck's base. Films before / after sent.

**Open:** the flights' head in a banked body (skyStrafe's recovery, skyCataclysm's wheel) also measures past
vertical; not touched.

## 2026-11-27 — Xin Yi's motion audit: limbs on the line, guns on the line of fire (ADR-253; branch `claude/xin-yi-motion`)

**Owner (through the boss motion audit's lead session):** audit every boss with docs/ANIMATION.md, Sekiro, Phantom
Blade Zero and Onimusha in mind: weird arm angles, unrealistic attacks, kicks bent at the strike, readable tells;
special effects as 2-3 options in the fox's and Bai Wuji's style. One draft PR per boss, films, the owner picks.

**Measured** (woke.mjs `audit` with each blow's line (`off`, `lat`), the new opt-in `guns` (the drawn barrel against
the line of fire, the arm, the muzzle, the other hand) and `probe` (one move frame by frame round its contacts)):
punches 22 - 63 degrees off the line (the back-fist 0.6 m short and wide); kicks straight two or three frames then
folded (Sky Turns' first tornado 118 on its hit-stop frame); the elbow / spin kick / knee 0.44 - 0.73 m short; the
sweep 94 degrees round and 1 m short, its leg flailing (keys a third of a turn apart; the foot the planner's); the
mirrored palm on the wrong hand; the right gun's barrel 55 - 113 degrees off its shots, shots under the gun, no kick.

**What changed** (all behind `?oneMoves=b`, now the default): `wokenOne/limbs.js` (onLine, holdKick, sweepOn,
fitZone, aimEarly; `TUNING.motion`), `wokenOne/gunAim.js` (each gun on its line, the kick, the muzzle point;
`muzzlePoint`), iron.js fires from the muzzle on `b`. Effect options (`fxIron.js`, default '0'): `?oneGunFx=a|b`,
`?oneBoltFx=a|b`. Lab LOOKS rows. Tests: woke `line` (in the suite); `guns`, `probe` opt-in.

**Verification:** woke `line` and the full woke suite; the audit before / after (ADR-253's numbers); films before
(main) and after (`b`) at the game camera and from the side, every move of every phase; the effect options close and
at the game camera.

**The owner's picks** (from the films): motion `b`, the shots `b` (the script), the bolts `a` (the seed): PICKED.

**Open / next:** the hooks from the side, the
sweep's knee at its very contact, Iron Rain's twin arms; the feet jump in `anim.js _feetClip` belongs to the hero
session.

---

## 2026-11-27 — Lu Wusheng audited: the form, the pace, three looks for the draw (ADR-252; branch `claude/lu-wusheng-motion`)

**Goal:** the owner's motion audit of every boss (one session and one draft PR each, batch 2), for Lu Wusheng:
measure every move against `docs/ANIMATION.md`, fix the anatomy and the strikes, keep every tell readable, and
offer 2-3 looks for his special move.

**Measured** (new opt-in `sheath.mjs form`, `tests/integration/sheathAudit.mjs`: the limbs and the weapon at every
impact, the draw's hands through the windup; plus the sword audit's table): thrusts on a bent arm (121 - 124°) 24°
off the scabbard's line; every draw ending in a locked split (176 / 176°) with a short arm, the fist 11 - 13 cm off
the hilt at the cock, the scabbard hand going forward 26 - 51 cm through the draw; the overhead an upright bar
(75 - 87° off level); the sweep's legs crossed; the free hand's 0.5 m swing in the scabbard cuts.

**Changed** (behind switches; the owner's picks below):
- `?sheathForm=a` (`sheathed/form.js`; the form's keys beside the authored ones; `kit.motion` opens his arms): the
  numbers in COMBAT.md "The Sheathed" → "The audit". Poses only (FORMPACE: every timing identical).
- `?sheathPace=a` (`sheathed/pace.js`, Tian Lei's method): rule 10's floor as held cocks, the draws untouched.
- `?drawFx=a|b|c` (`sheathed/fx.js`; the click hook in `sheathed.js _onClick`): the drawn breath, hanging leaves,
  the late sound.
- Tests: `sheath.mjs formpace` (in the default run), `form` (opt-in table); `GCD_LOOKS` now applies to the whole run.

**Verification:** `sheath.mjs` green with the defaults and with `GCD_LOOKS=sheathForm=a,drawFx=c`; films of every
move before / after at the game camera and side-on, the draw looks at both cameras (sent to the owner).

**The owner's picks** (from the films and the preview): the form `a` (now the default), the pace and the draw's
look as shipped (their options stay behind `?sheathPace` / `?drawFx`).

**Open:** a planted foot's one-frame jumps (the hero's `_feetClip`, the hero session's). PR 170
(draft) also uses ADR-252.
## 2026-11-27 — The Cinder Wyrm's motion audit: the bites (ADR-257; branch `claude/wyrm-motion-ccc88f`)

**Owner:** the boss motion audit (one session and one draft PR per fighter, the shared brief): weird limb angles,
unrealistic attacks, every attack readable; for the wyrm, keep its look (the owner's "perfect ascii look") and
change motion and tells only, in small steps.

**What changed:**
- `tests/integration/wyrmAnatomy.mjs` + integ `wyrmanatomy` (opt-in): each blow measured at its contact: the gap
  to the hero at the announced impact, a foreleg's elbow and reach, a bite's neck, the order the chain reaches top
  speed, the tail's tip against its middle, the planted feet's skating, pops (hit-stop frames left out).
- `dragon/strike.js` behind `?wyrmStrike=a` (the owner's pick from the films, the default; `0` as before; the Lab's LOOKS row): every bite's
  body surges first (the chest drops and pitches in, the body lunges 0.4 units) while the head hangs, then the head
  snaps onto the impact. Measured: the body 50 - 117 ms ahead of the head (was on one frame); the jaws 0.17 - 2.07 m
  from the hero at the impact (was 0.79 - 3.10).
- Films (before / after, the game camera and a close front three-quarter view, all three phases, real and half
  speed) sent to the owner; the before set covers every melee move and the flights.

**Found and left (ROADMAP):** the forelegs straight through the whole rake (the paw's path is beyond reach); the
wing blows flap as one rigid wing; feet skate up to ~1 m in some strings. A tail with a softer tip was tried and
dropped: the shipped tail already trails its middle by 44 - 123° and the film showed no difference. The first
reading ("the tail swings as one rod") came from comparing top-speed times in a spin, where every point peaks
together: measure the tip's bearing against the middle's instead.

**Verification:** integ green with the switch off and forced on (`GCD_STRIKE_DEF`, a temporary hook, removed).

**Owner's pick:** `a` ("AFTER, make it default"), 2026-11-27.

**Next:** the forelegs and the wings, each with its hit spheres measured before and after.
## 2026-11-27 — Halcyon's motion audit: a flier's limbs, the readable pace, eye-beam and shockwave looks (ADR-254; branch `claude/halcyon-motion-7d73eb`)

**Owner (through the audit's lead session):** every boss audited with docs/ANIMATION.md; "weird looking arm angles
... kicks aren't straight"; every attack readable; special effects to the Fox's and Bai Wuji's bar with 2 - 3 looks
to pick; a draft PR and films each.

**Measured** (city `audit`, `GCD_AUDIT_IMPACT=1`: the striking arm's reach and its line to the hero, both knees,
the feet's trail, the body line, the fist's height, in his UPRIGHT frame: the drawn body is sheared toward the
camera, duelist.js lean, which read a straight punch 20 - 40° off in world points): see ADR-254 and COMBAT.md
"Halcyon" for the before / after numbers.

**What changed** (all behind switches; the defaults are today's): `halcyon/limbs.js` (`?halMotion=b`: the
straight blows on the line, the kicks long, the flier's legs on every key of his blows and his own beats, a level
pass `FLY_B` / `LAUNCH_B`), `motion.js` (halKeys routes `b`; `halLimbsOn`), `poses.js` (hoverLegs), `flight.js`
(the pass's root at `motion.b.passY` under `b`), `halcyon.js` (the animator's armSoft / legSoft, kickStretch only
in a kick; the clap / landing ask HalFx.shockwave first), `pace.js` + `moves.js` (`?halPace=a`: a held cock through
the realiser's `hold`, the cue 0.35 s), `fxEyes.js` / `fxShock.js` + `fx.js` (`?halEyes=a|b`, `?halShock=a|b`),
`tuning.js` (`motion.b`, `pace`), the Lab's LOOKS rows. Tests: city `limbs`, `readable`; `audit` prints the
contact anatomy.

**Decisions:** fixed in `halcyon/` only (Tian Lei's PR 174 keeps its own pass behind his realiser); the legs trail
further back rather than shorter where the hip is low (the animator keeps a foot over his root's floor, anim.js,
the hero session's); `kickStretch` only through a kick (it locked his trailing legs straight).

**The owner's picks** (from the films, 2026-11-27): `halMotion` b, his fast pace kept (`halPace` 0), `halEyes` a
(heat vision), `halShock` a (the thunderclap): in PICKED, the Lab rows out of `awaiting`. The first cut of both
effect options printed a white core the whole time (they read as white beams, his crimson lost): redrawn as crimson
strokes, white only at the first peak, before the films were sent.

**Open:** the kick and the palm snap harder at the contact (largest frame jolt 282 → 424, 174 → 236 mm/f²); the
lead foot's step lives in the hero's animator (anim.js) and was left alone.

## 2026-11-26 — Shen Hui's form, and looks for two of his specials (ADR-250; branch `claude/shen-hui-motion-d768f0`)

**Owner:** the motion audit of every boss (weird arm angles and sword positions, unrealistic attacks, readable
tells, special effects at the fox's and Bai Wuji's bar), one session and one draft PR per fighter.

**Measured first** (the sword audit with a new impact table, `GCD_AUDIT_IMPACT=1`): thrusts on a bent arm with the
point off the arm's line, the long lunges on two locked knees, overheads straight down (a bar at the game camera)
with the free hand thrown onto the hilt at 17 - 19 m/s, the low sweeps' legs crossing, the front foot still up at
most impacts. His kicks were already straight.

**Changed** behind `?ashForm=a` (moves.js: each key helper pairs its keys with the form's; a post-pass makes
`formKeys` / `formMotionKeys` / `formRecovery`; the realiser picks them): the lunge, the diagonal overhead, the
sweep on the feet, the quieter free hand, the keyed step that lands with the blow; his own `formMotion` (the soft
reach, a short foot ease). Effects to pick: `?whirlFx=a|b|c`, `?fallFx=a|b|c` (specialFx.js). Lab LOOKS rows.

**Film.** Every move, before / after, at the game camera (cropped round him) and side-on, phases 1 - 3, real and
half speed; the effect options at the game camera. Rig: `take.js` (a film per move, beat marks), `compose.sh`
(2 x 2 grids), `keys.py` (key-frame sheets).

**Picked** (2026-11-27, from one comparison video per decision): the form (`ashForm=a`), Ember Whirl b the cyclone,
Heaven-Splitting Fall b the split; all three the default now (PICKED). The owner added that the Fall did not look
natural in his body: ADR-226's held red coil covered his whole flight (a ground crouch 3.6 m up, the blade trailing
behind, whipped over in 0.3 s). The form gives it its own keys, a jump: load, drive, tuck with the blade raised
through the lock, legs reaching down, landing into the cut; filmed before / now side-on (a camera that follows his
height) and at the game camera. Then the arms (the owner: "awkward and stiff"): one rising arc up his right side,
the blade still cocking back behind his head through the lock instead of frozen, the hands leading into the cut. Then no backswing (the arms rise straight from his guard, in front of his face),
the cut starting in the air, and a landing 1.6 m short of the hero (leap `short`, opt-in) so the blade meets him.

**Open.** His pace unchanged (the owner chose it fast). Feet still slide 0.15 - 0.5 m over a long string where the
close-in carries his root under a planted foot.

---

## 2026-11-26 — The clash dance, behind `?clash=dance` (ADR-247; branch `claude/combat-clash-dance-470971`)

**Owner:** picked "the clash dance" as the second of the five P4 combat additions (after the flash chain), in its
own session; then, on how it fits the deathblow (PR 145): "help me understand what the clash dance is", and after
the explanation, "Yes, build it" (on its own, a small rise in the ring, the recovery steps for every duelist).

**What changed** (all behind `?clash=dance`, the Lab's `clash` row; off by default):
- `combat/clashDance.js` (the switch, `clashNext`, `clashMult`, `clashRing`, `clashRegenK`) and
  `DEFENSE.clashDance` (rules.js: `mult`, `gap`, `ring`, `regenByHp`).
- `duelist.js`: the run on `_clash {act, n, t, hurt}`, `clashPeek()` and `_clashMult()`; `onParried` (and
  Halcyon's crash) multiply the parry's posture; `_updatePosture` x the HP step. The Lord, Tian Lei and Xin Yi
  swap their `regenByHp` curve for the steps.
- `player.js`: `hurtN` (blows that landed or broke the guard; not a stream's chip) and `player:parry {clash}`
  (read from the duelist's `clashPeek` as he parries). `audio.js` `_parry`: the recorded clang x `clashRing(run)`.
- Tests: duel `clashdance` (the table, the ring, off = today's posture, the x1 / x1.25 / x1.5 ladder, the three
  resets, the recovery steps), lord `clashdance` (the steps replace his curve, never faster).

**Decisions:** the run lives on his move beside the deflect chain's count and never reads the deathblow's
`parryRun`. The first try kept the Lord family's x1.5 full-bar rate under the steps; that made them recover faster
than today at 50 - 70 % HP, so the steps replace the curve outright (ADR-247).

**Film** (a plain-parry bot, all-white strings so a parried blue blow's deathblow does not decide it, red blows
rolled; the same strings both ways, game camera, close crop, a posture readout burnt in): Shen Hui (full HP; Parting Wind and Ember Fan in turn) breaks on the 9th parry instead of the 12th; the Starless Lord (50 % HP; Crushing Verse, Veiled Hand, Push Opening, ...) in his 3rd string instead of his 4th, 2.7 s sooner; Xin Yi (50 % HP, a posture bar of 1100) breaks after about 42 s, where today he stands unbroken at 977 / 1100 after 45 s. The first takes went through a stopped take's leftover in a second tab (two films interleaved); re-shot clean.

**Verification:** duel `clashdance`, lord `clashdance`, changelogcheck, glyphcheck; full `npm test` before the PR;
`npm run build`.

**Open / next:** the owner's pick from the film (the default stays off until then) and the ring by ear in the
preview (the film has no sound). With the deathblow merged, a dance-made break may come with fewer perfect parries
banked, so the deathblow can be shorter. Next in P4: the Break finisher, cuts that split the letters, one answer per
unblockable, a sub-weapon.

---

## 2026-11-27 — Bai Wuji round 3: the glide, a barrier that opens easier (branch `wj2/lead`; ADR-250)

**Owner:** "the fight is pretty hard right now and takes forever to do damage to him. his animations and attacks
also need to be much more improved. like his kicks and punches do not look natural and look off. he needs to be
faster and cooler." Their answers: the barrier opens easier (hp near 20000, a good player in ~3 min);
effortless, one-handed; film takes and they pick. They picked **b, the glide**.

**What changed.**
- `untouched/motion.js`: three hand-keyed takes behind `?wjMotion=0|a|b|c` (PICKED b; Lab LOOKS row). Why he
  looked off: his realiser had no `keysOf`, so ADR-225's motion layer never reached him (bent knees at the
  contact, Tian Lei's boxer fists, lunging strings). The hand layer (`poses.js` `wjHandsLayer`, `pilot.wjPin`)
  keeps his hands in his pockets by phase.
- `wjBarrier`: cracks 2, open 6 / 5 / 4.2 s (by cracks 5 / 4.2 / 3.4), cuts x2.5 while open
  (`barrier.scaled`); hp 20000; patience after 20 s.
- `bench.mjs`: the bots roll out of falling pieces as their cue comes, keep him in front, hold the guard for two
  cues 0.3 s apart (the perfect bot's three hits under the glide were its own).
- `WjMelee` counts the mercy stretch in real time (`game.realDt`; hit freezes held the hero 1.52 s in
  `downtime` seed 7 while game time said 1.19 s) and counts a guard-emptying block as the open stagger;
  `destructibles.js`: no falling piece on a downed hero.

**Verification.** The bench (six seeds, take b): good 6 / 6 in 147 - 191 s, perfect 6 / 6 in 106 - 119 s
untouched (12 seeds), blocker and pace dead. `veil.mjs . all` green; the full `npm test` before the PR.

**Open.** The ordinary-parry band is about a frame since ADR-227, so cracks rarely open him (a wider window
would touch every level: the owner's call). The ledger forgets a landed red (shared duelist code). Patience
is slow on a pure defender (his blow lands in the opened guard ~1 in 10). Should x2.5 have its own hit mark?

---

## 2026-11-26 — The flash chain, the new default (ADR-246; branch `player/issen-chain`)

**Owner:** asked for research into the combat of three sword games and five additions; picked the counter-kill
chain first ("Issen chain first"), then: he strikes back after each counter, 3 links rising, the same window every
link, the choose-where-to-cut finisher later, and "show me current and ... he strikes back ... video comparison".

**What.** `combat/flashChain.js` (the switch), `DEFENSE.counterChain` (the numbers), `Duelist.onCounter` (the link
from the act he is throwing; before the last link a `clash` throw-back and his counter move queued with the link),
`DuelBrain._foot` (the queued move carries `act.flashLink`), the hero's `_trade` (each link's freeze / shake /
punch; the crit window on the last link only; `player:counter` gains `link / links / last`), the call-outs
("FLASH COUNTER ×2", "THREE FLASHES"), the ring rising per link (audio), the Lab's `counter` row. Test: duel
FLASHCHAIN (off: he reels; on: links 1-3 with their damage, the strike-back's first blow 0.75 s after the counter,
the crit window only on the last, a new chain starting at 1).

**Film.** Every duelist, today beside the chain, at the game camera with a close crop (a bot pressing for the flash
counter; all eight chained three links: 70 / 85 / 100). The owner picked "strikes back": the chain is the game's
default (`?counter=0` for the single counter); the headless sims keep the single counter unless a scenario sets it.

**Next.** The owner's playtest of the chain (and on the iPhone); then the "Break" finisher (choose where to cut
a broken boss).
Not measured: how much the chain shortens fights for a human (the strategy bots do not flash-counter).
## 2026-11-26 — The living world's fast path: the same picture for less (ADR-245; Opus agent; `world/life-perf`)

**Owner:** "i feel like the ascii atmosphere effects is causing a lot of performance issues. is there a way we
can improve the performance while still making it look as good and alive?"

- **Measured first** (five levels, fights, GPU at 4K and the phone's size, CPU at 1x / 4x / 6x throttle): the
  air's letters themselves are nearly free on the GPU; the cost was the ground's step flash and the grass
  wake looping on every pixel (9 - 21 % of the ground pass at 4K), whole-array uploads every frame (115 - 231 KB)
  and empty batches still drawn; the life update 0.06 - 0.34 ms of CPU at 1x.
- **Changed** (`?lifeFast=0` = before): only the drawn letters are uploaded, empty batches leave the frame
  (`life/ship.js`); the step flash and the wake return at once outside their reach; BENCH reads the living
  world's share.
- **Result** (one page, fast vs before): the ground pass 0.83 - 0.89; the effects pass's render CPU and uploads
  0.7 - 0.97; the picture identical (pixel counts and side-by-side films per level).

**Verified.** `life.mjs . all` (new `fast`: same letters, ranges, bounds, off-is-free), `world.mjs . all`
(the allocation `budget` check failed once under machine load, passed alone on the branch and on main),
`world.mjs . perfreadout`, the glyph check; the seeded wyrm fight's trace byte-identical.

**Open.** Not measured on a phone (the owner's BENCH "living world" line); the trees' wind vertex cost on a
quiet GPU; the wisps' and mist's motion on the GPU if the phone's CPU turns out to be the limit.

---

## 2026-11-26 — The animation guide (`docs/ANIMATION.md`; branch `docs/animation-guide`)

**Owner:** "can you research online and find the material that will be helpful for future agents to follow
to make accurate good looking animation, poses, and combat for our game?" (after scrapping the
reference-footage approach, ADR-236).

**What.** Four research passes, published talks and articles only, no footage:
- animation fundamentals (Cooper, Williams, Cartwright, AnimSchool);
- readability at small size and a high camera (Riot, Dead Cells, Slynyrd, Valve);
- combat feel (the DS3 attack anatomy, GD Keys, God of War cancels, Sakurai's hit-stop, Eiserloh's
  trauma shake, kendo and Silver);
- code-driven animation (Rosen, Holden's springs and IK, t3ssel8r, Little Polygon).

They are folded into `docs/ANIMATION.md`, mapped onto this engine's fields (`swings.js`' coil, `lead`, the
whip, `flat`, `step`; `feel.js`; `anim.js`' springs) and the owner's taste. The guide closes with a
checklist and a source list. CLAUDE.md's start-of-session docs list now points to it. Docs only, no game
change.

**Next.** Use it on the next animation pass (ROADMAP P2, the bosses' swings): one narrow change at a time,
filmed at the game camera. Several numbers are the researchers' starting values, marked as such: tune them
by film.

## 2026-11-26 — Instant slashes on every attack, and four left-hand looks to pick from (ADR-240; branch `claude/hero-instant-slash`, held)

**Owner:** "lets just do this. use the current production auto attack combo and remove the curvy slashes with the
instant slashes and make the left hand look more natural and not stand out so much as it looks unnatural and off.
scrap all the new stuff." Asked: the slash on everything incl. the flurry; film 2-3 left-hand options; close
PRs #118 and #166; a held PR with a preview first.

**What changed:** PRs #118 (instant cuts, steel, four combos) and #166 (the joint-posed arm) closed unmerged.
`slashFx.js`: the straight line of the closed instant cuts' `blinkFx.js`, driven by every attack's active
window (a chord; a turn's three chords; a thrust's streak; the heavy look with a kick); `player.js` draws no
crescent behind it (`?slash=arc` does); the plunge keeps only its straight streak; the flurry's split / vault
finisher draws its swept path's chord. `offHand.js` + anim.js `_sideHand` / `_sideLinger` / `sideHand` (ported from
#118's `side` hand): `?offhand=side|back|quiet`, a rest the body carries with a pendulum on it, worn by every
clip that never keys `two`; '0' (production) stays the default until the owner picks. The pose gains `P.sd`
(N 62). Lab rows `slash`, `offhand`. Scenarios `instantslash`, `offhand`.

**Verification:** the scenarios; `herolife`, `herohand`; films: crescent vs line (the combo; light-light-heavy)
from the game camera, and the four left hands close and from the game camera.

**Round 2:** the owner found the lines "out of place and a bit lagged" and asked for variations of the combo's and
the heavies' feel with their own left hands. The line now comes as the visible swing ends (`SWING`); `feel.js`
`?feel=snap|weight|flow` (+ `?offhand=auto` pairs each with its hand); scenario `feel`; films of the four (the
combo from the game camera and close, Piercing Gale, light-light-Whirling Tempest).

**Round 3:** the owner meant an ENDING slash, not a trace of the swing, and asked for four new light combos built
for it (timing may change). `slashFx.js` places a fixed-length line a beat after the swing (`?endslash=`,
`?endbeat=`); `combos.js` `?combo=a|b|c|d` (Iai, Tempest, Mountain, Dancer) from production's swings, each with
its timing, feel and hand; scenario `combos`. Films: the four combos beside production, and the 3 places × 2
timings at the wyrm.

**Round 4:** baseline combo A + the slash on the enemy as the swing ends (now the defaults; the sims keep
production's chain). The yellow flicker was the free hand behind his back passing through the coat's back
panels: the free wrist joins the coat's sheet test. The slash came at the contact from the windup's motion (the
bite read as the swing's end): it now waits out the bite and follows the blade's on-screen motion (camera
projection, speed-weighted), revealed from the swing's start side; measured per light hit and heavy branch.

**Open / next:** the owner's verdict on the revised baseline.

## 2026-11-26 — Lu Wusheng, Wen Yao and the wyrm audited; held blue / red windups, released feet, quick blows (ADR-223; branch `claude/enemies-grove-fox-wyrm-motion-59bc46`)

**Task** (from the session coordinating the boss motion pass): audit and fix Lu Wusheng's, Wen Yao's and the Cinder
Wyrm's poses and motion; give their blue / red attacks readable held windup poses; add a few much faster normal
blows; films before / after, the owner picks; behind switches.

**Measured** (`tests/integration/motionAudit.mjs`; `sheath.mjs . audit`, `fox.mjs . audit`, `integ.mjs . wyrmaudit`,
env `GCD_MOVES`, `GCD_LOOKS`, `GCD_TRACE`, `GCD_AUDIT_OUT`): the blue / red blows that are not draws / casts / long
charges held 0.00 - 0.13 s; Wen Yao's planted foot jumped up to 0.53 m in a frame (his clip lifting a foot his root
had left behind); Lu Wusheng's scabbard cuts fling the free hand 0.32 m in a frame; facing at the impact fine.

**What.** `duelist/heldTells.js` (+ `realise.js` `keysOf` → `{ keys, hold }`); `anim.js` `opts.liftEase` (bosses
only, `kit.animOpts`); `dragon/tellPose.js`, `tuningMotion.js`, attacks.js makeString; the quick blows in each boss's
moves / tuning; Lab LOOKS rows (awaiting). Tests: sheath / fox `motion`, integ `wyrmheld`, the data floors.

**Verified.** The suites' scenarios; films at the game camera and a side view (headless Edge, `__tick`): before
| a | b for four blows a boss, the quick blows, sent to the owner.

**The owner's picks** (from the films): `a` for all three bosses, every quick blow: the defaults (PICKED).
With them on, `npm test` found latent wyrm faults through the seeded fights' drift: a drakeling's dive released
onto a blow (fixed on `main` by ADR-237 meanwhile; my own fix for it dropped in the merge) and the sky hunt
landing up to its radius off its ground (fixed here). The attack table's hash re-pinned (the Snap swipe); the
clearing's burn budget 9 -> 12.

**Open.** Lu Wusheng's free hand in the scabbard cuts; the same foot ease for Shen Hui and Varr Nihil (their
session).
## 2026-11-26 — A ninth level: the Veiled Crossing and Bai Wuji, the Untouched (ADR-241 – ADR-243; branch `enemies/untouched`; planned by the lead, built by Opus agents)

**Owner:** a boss after a famous white-haired, blindfolded sorcerer (named as the reference; nowhere in the game):
"his iconic white hair with eyes covered. during the phases he will reveal his eyes and his hair will go down";
"utilize the terrain and background to be part of the fight and be epic"; "one of those ultimate beings, we need
to make this fight very hard in terms of skill level ... make his blows feel powerful and knocks the players back
a bit if they get hit ... pretty much forcing the player to parry/dodge everything". Their four answers: the arena
a ruined city crossing at night; his barrier stops the blade and opens on a perfect parry or a perfect dodge; a
block holds and costs no health but throws the hero back and takes a big share of the guard, and his spells
cannot be blocked; at the last phase the hand sign and a closing sphere: perfect-dodge through it or be held and
struck once, and either way the last phase is fought inside the void. Picks from the rendered sheets
(2026-11-25, `docs/looks/veil/`): coat c (bone-white), hair b (short spiky burst, then a choppy mop), the
crossing a (ash moon), the void b (the ring), the barrier a (all but invisible until a blade nears), the Null a
(a hard-edged slab). Halcyon's thrown pieces landing on the road: "yes, Halcyon too".

**How it was built.** A brief and a core first (the level on a stand-in set, the boss folder with its rules and
a routing contract, `veil.mjs`), then three waves of Opus agents each in its own worktree on the core: body, fx
and world; melee, spells and terrain (each its own move file and handler); an integration pass; a tuning pass
with a bench of five mortal bots. The lead merged and wrote the docs.

**What.**
- `?level=veil` (`levels/veil.js`, aliases `crossing`, `veiled`, `wuji`, `untouched`), the set
  `world/veiledCrossing.js`: a rubble plain where two 21 m roads cross, the scramble's bars in the slabs, a
  crater field, an old wide trench, a fallen tower in six sections across the north, four tower stumps whose tops
  can come down, a broken footbridge and gantry, eight cars, a bus, six loose road slabs; 299 breakables, 67 rigid
  pieces, 268 bones, 129k triangles (under Halcyon Plaza's budget). Two scenes, `crossing` and `void` (the
  Hall's contract), the void's stars a `LetterBatch`, floating pieces he can drop and cast. Its blocks in every
  living-world tuning file.
- `entities/enemies/untouched/`: the duelist engine plus the barrier (`barrier.js`), the pull (`pull.js`), the
  domain (`domain.js`) and three move files routed by `moves.js` (melee, spells, terrain; 33 moves and two
  transitions). His body in the hero's ink-line art, printed the bossPrint way; his effects in the fire field
  (`azure` and `crimson` palettes); 18 sounds of his own.
- Player: three generic hit fields (`blockPush`, `wjCrash`, `Player.hold`, capped 1.2 s).
- Destruction: `throwTo` / `drop` `{ ground }`, `take` `{ chip }`, a held piece cut under 1 hp breaks; scars:
  `SCAR.thin` per level (veil: grit 0.35, rubble 0.25, ground 0.4, `cool`), `scars.layer`, `scars.shade`, a wide
  `beam` trench. Halcyon's `_throw` lands on the floor.
- The bench: `tests/integration/bench.mjs`, opt-in scenario `bench` in `veil.mjs`, `city.mjs`, `asc.mjs`.

**After round one, the owner's answers** (five questions): "3 blocks" (the third block in a row opens the guard,
not the second); a defender who never attacks must not outlast him; the roller lasting ten minutes was "hard
enough"; Halcyon Plaza's metal rubble grey "if it looks better grey then yes" (the lead judged from a
side-by-side sheet that it does: the orange read as embers that never go out and clashed with the plaza's blue);
the bonfire goes out in the void: yes. Round two built them: `wjWeight.guardCost` 0.45 (two blocks leave 10 of
the meter, the third opens it, for blocks up to about 1 s apart); his PATIENCE (`untouched/patience.js`: no cut
has reached him for 30 s, his eyes burn 1.2 s and the unveiling's sound plays, then every blocked blow costs the
whole meter until a cut reaches him again); the bonfire out as the front into the void passes it, lit again on
the way back and on a reset (`atmosphere.bonfireLit`); `SCAR.thin.city` cool and `?coolRubble=0|1` on any level;
the bench's bots stay busy until 0.25 s after each answered impact (the perfect bot had cut out of its own roll
and lost the i-frames) and `GCD_BFORM`, `GCD_BHIT`, `GCD_BTOUCH`; the suite's ordinary parry pressed 0.25 s ahead
after ADR-227 (main: the perfect parry window 0.20 s).

**Decisions.** ADR-241 (the boss and his rules), ADR-242 (what changed in the destruction), ADR-243 (the tuning,
the bench, patience, the floor marks, the bonfire). The lead's one addition to the owner's barrier rule: cracks
(ordinary parries; four open it for less time). Why patience: the pace bot never damaged him (phase 1 forever);
its guard opened ~100 times in 9 minutes, but the blow that emptied it was itself blocked, his next came after
the 0.55 s opening, the mercy rules spared 1 - 11 more and its early rolls i-framed every red. Settings tried:
none, alive 6 of 6; a one-block cost after 20 s, dead in 102 - 383 s; after 30 s (shipped) 201 - 525 s; after
40 s 83 - 518 s; a two-block cost (0.7), alive.

**Verified.** `veil.mjs` all (levels, data, barrier, weight, crash, pull, domain, phases, fight, pace, events,
downtime, strings, sides, spark, mix, chase, the spells', the terrain moves', letgo, into, heldbreak, floor,
patience, bonfire, body, fx); `world.mjs`, `city.mjs`, groundfx quick runs; `npm test` by the lead. The bench (6
seeds, god mode off, 600 s cap; wins of 6; Halcyon and Tian Lei from round one):

| Bot | before the tuning | round one | round two (shipped) | Halcyon | Tian Lei |
|---|---|---|---|---|---|
| perfect | 6, 176 – 186 s | 6, 235 – 241 s, 0 hits | 6, 229 – 241 s, 0 hits | 6, 133 – 155 s | 6, 42 – 60 s |
| fencing (90 %) | 3 | 2 (260 – 272 s), 4 dead | 2 (264 – 290 s), 4 dead | 6 | 6 |
| roller | 6 | 1 won, 1 dead, 4 alive at 600 s | 6, 374 – 427 s | 3 | 6 |
| blocker | 0 | 0, dead at 83 s mean | 0, dead at 89 s mean | 0, dead at 309 s | 0, dead at 78 s |
| pace (never attacks) | alive | alive, his bar at 92 % | dead in all six, 203 – 488 s (mean 302) | dead at 422 s | alive |

Set: `hp` 20000 → 26000, `wjWeight.guardCost` 0.4 → 0.5 (round one) → 0.45 (round two), `wjBarrier.cracks` 3 → 4,
`wjPatience { after 30, cue 1.2, guardCost 1 }`; the Wrecking Knot strikes only from its impact to +0.15 s (the
perfect bot took 46 from it on seed 4242 before). The roller's win comes from the third-block rule, not from
patience (at 0.5 it won none); `blockPush` 3.4 → 2.4 would give it 4 of 6 (measured, not shipped). The fencing
bot's 0.12 s parries are all perfect since ADR-227. A filmed god-mode fight before the tuning: won in 187 s,
phases at 64.5 / 131.8 s, 80 parries, 30 dodges, no error; after round one, the perfect bot's fight and the
domain filmed in the real renderer.

**Open.**
- The roller now wins in six to seven minutes (the owner called ten "hard enough"; a shorter `blockPush` is
  the lever). The fencing bot's 2 of 6 depends on the seeds.
- The real renderer lays ~30 % more floor marks than headless. On the phone his two eyes merge into one point.
  The hero's knockdown (1.3 s) is the engine's, over the 1.2 s cap his own blows keep.
- No reward yet. Not playtested by a human; not checked on the owner's iPhone.

---
## 2026-11-26 — Xin Yi rebuilt: a man in a coat, readable windups, faster hands (ADR-221; branch `claude/enemies-xinyi-rebuild-1bbc62`)

**Owner:** "the neo boss anatomy and attacks are all weird too ... fix the neo character details because right now
its a mess and can't tell if its a human". (A side session of the bosses' motion round.)

**Diagnosis** (headless Edge + CDP rig, x4 game-camera crops beside the hero from three sides in every phase, solid
views from four sides, film strips of 11 moves, `woke.mjs . audit`, an aim probe at each shot's impact): a bright jade
outline round a near-black fill (the bosses' print lifts his near-grey fill to ~3x the hero's coat); a bottle build
(narrow shoulders, the skirt flaring from the chest past them); a head of three letters; one-armed in phase 1 (the
left hand behind his back); the one-gun aim 36 degrees off the hero, the forearm across his face; no windup pose of
its own for any blue / red blow; nothing quick out of his guard. Sent to the owner as a sheet.

**What:** `?oneBody=a|b|c` (gear.js `SHELL_MAN`, `COAT_MAN`, belt, hair; look.js `BODY_INK`; sheet.js panelSkirt's
optional `cone`), `?oneMoves=a` (moves.js `MOVES_A`: `AIM_SIDE`, `heldTell`, `fast`; `snapHands`, `quickFoot`;
tuning.js `held`, `fast`; wokenOne.weigh), Lab LOOKS rows (awaiting), PENDING. Tests: woke `rebuild` (each figure
builds, prints the hero's way, the coat's hem height; the rebuild keeps every move's timing; 37 blows hold their
coil; the fast strings' floors and weights; the aim within 12 degrees), env `GCD_LOOKS` for any suite run.

**Numbers:** aim 36 -> 2 - 11 degrees; audit worst jolt 1035 -> 985 mm/f2, the sweep 872 -> 499 - 819 (its tuck is
pre-existing); the held spin kicks' windups ~25 % more jolt (first try held from 0.46 of the windup: up to +75 %;
the draw now keeps 0.75 of its time).

**The owner's answer:** "lets do open coat" (`oneBody` b in PICKED), the kicks straight ("a straight line when his
kick is out"), the coat one piece and not like the hero's cloak, the punches and acrobatics natural. Done: one coat
(five overlapping panels, one back panel, a straight hem, no pale hem: printed as part 5; 30 degrees of swing at
most), straight kicks (anim.js `kickStretch`, `legSoftA`, `longLeg`: knees 166 - 173 at contact), long punches
(`armSoftA`, `longArm`: elbows ~169), the butterflies' travel cut (feet no longer inside the hero). The audit:
the spin kick after a straight kick jolts ~40 - 60 % more (the leg comes back further). Tests: REBUILD grew the
kicks' reach, the punches' reach, the animator switch, a front kick's knee (173), the coat's swing in a flip.

**Then:** "Yes, make default": the rebuilt moves are his default (`oneMoves` a in PICKED).

**Open:** phase 1's hand behind the back; the sweep's tuck (Tian
Lei's builder: the motion-tian-halcyon session owns it).
## 2026-11-26 — Shen Hui and Varr Nihil: the sword in the hand, held tell poses, quick blows (ADR-226; branch `claude/enemies-ash-lord-motion-0f152b`)

**Task** (from the owner via the lead session): their positioning angles look weird and the weapons are held
awkwardly; every blue / red blow its own readable held windup; some much faster normal blows; audit first, fix,
film before / after, the owner picks, behind a switch.

**Measured** (new `tests/integration/swordAudit.mjs`, opt-in `audit` in duel.mjs / lord.mjs): the forearm-to-blade
angle 45° / 64° on average, up to the animator's 128° limit (the hero ≤ 60); the blade through their heads in nine
overheads; elbows never past 145°; Varr Nihil's end-of-string twirl jolting the point 1.0 - 2.5 m a frame². The
chest is square to the hero at every impact (≤ ~20°), so "angles" at the blow itself measured fine: the angle
that reads wrong is the steel against the arm (sent to the owner as five clips and a findings note).

**What.** `anim.js` `gripMax` / `_gripAlign` (opt-in: the forearm turned toward the blade round the elbow);
`duelist.js` applies `kit.motion()` (gripMax, armSoft) each frame; `duelist/tellPose.js` (held tell families: blue high
/ aim, red coil; `motionize`); `realise.js` `recoveryKeysOf`; per-boss `motionKeys`, `motionRecovery` (the Lord's
shake), `quick` / `motionOnly` moves (Darting Needle, Flicking Willow; Rising Ember, Vigil's Fall) and
`TUNING.motion` / `minQuickWindup`; `?ashMotion` / `?lordMotion` (PENDING, Lab LOOKS rows); links out of the quick
blows; tests `swordmotion` (both suites), the data rule for quick blows, `GCD_LOOKS` env for any scenario.

**Verification.** Audit on: Shen Hui's wrist ≤ 60° in every move, the blade ≥ 18 cm off his head; the Lord ≤ 60° bar
one spell pose, the worst jolt per move 776 → 449 mm/f² on average. The pace meters pass with the switches on.
Before / after films (game camera + a close side view, half speed) rendered with the scratch rig.

**The owner's pick** (from the films): "i like the new timings and changes", Piercing Ash keeping its old
thrust; both switches are the default (`?ashMotion=0` / `?lordMotion=0` give back the motion before).

**Open.** Feet: a planted foot still slides where a clip takes it over (the grove session's
`liftEase` may serve); legs cross inside the spins. Varr Nihil's Starless Night cast keeps a 91° wrist.

---
## 2026-11-26 — The bosses drawn in the hero's style: his shading and his outline (ADR-220; branch `claude/render-boss-hero-look-631f37`)

**Ask.** Make Shen Hui, Varr Nihil, Tian Lei, Lu Wusheng and Halcyon look like the hero's ASCII art (the Cinder
Wyrm, Wen Yao and Xin Yi out of scope).

**Analysis** (the hero beside each boss at the game camera, 720p / 1440p / the phone, x4 crops): the bosses
printed almost every cell as an equally bright dense letter (ADR-194's lift saturates the ramp), inside a 1 px
line; the hero runs from a near-black core through grey shoulders to a lit lavender edge and the pale hem,
inside a 2 px (1440p) chunky dotted line. Three bosses also use letters half his size from 1080p up; their
skirts are slim.

**Round 1, turned down.** Options a (his letter size, his dark cloak values in each boss's hue, the pale hem to
the thigh) and b (a + skirts flared and torn): "i dont like any of these new bosses. i didnt mean make it the
same color or cloth texture as the main character. i meant the style and engine look. for example, shen hui i
like that his original hat has its own color and detailed ascii look". Asked which part of his look, they
picked **his shading** and **his outlines and rim** (not his letter size).

**Round 2, picked.** `?ashHero= / lordHero / ascHero / sheathHero / halHero = 0 | a | b | c`: a his shading
(`U.uBossHero.x`: a boss's cloth light falls off away from the key light and down his body; colours, head and
hat, face, hem kept), b his outline (`uBossLike.z`: the boss's ink lines at the hero's line width `uSelfPx`, the
letters his own), c both. **Picks:** c for Shen Hui, Varr Nihil and Lu Wusheng; a for Tian Lei and Halcyon
(their letters follow their size already, so their lines are the hero's width: b does nothing on them).

**Tests.** `bosshero` (new, in run.mjs): the table, the Lab rows, the picks as defaults, no allocation per
frame, the shader levers only on a boss and only on his light (never `artFill`, never his head), every boss's rig
builds sharing the uniform. duel `fxlooks` (PICKED against the Lab) green.

**Cost.** A few ALU per boss fragment; the outline taps the same pixels at a wider step. No new texture, pass or
draw call; no geometry (the cost budget is unchanged).

**Next.** The owner sees them in play and on the iPhone (the outline only shows from 1080p up; the phone and 720p
get the shading alone).
## 2026-11-26 — A brood cue whose wait ran out keeps the cue spacing (ADR-237; branch `claude/vigorous-wilbur-3c128e`)

**Task** (the follow-up from ADR-227): the brood's dive after `busyWait` landed within 0.3 s of a wyrm cue of
the other answer. **Reproduced** on main: PRESSURE seed 4242 with the steady bot's stray parries perfect (the
ADR-227 wrapper off): fanVolley / drakelings P2, breath / drakelings P3, 2 FAILED. A trace of each brood flash
showed both were dives held the full `hold.max` 1.8 s (fanVolley's bullets in the air, then the breath's tell
in the ledger 0.27 s from it), flashing at the cap. **What:** past `hold.max` a brood cue holds on only while a
cue of the other answer is due within `BROOD.late.clear` 0.36 s, and gutters out after `late.drop` 4.5 s held;
its flash bars the bullets of the other answer (`bullets.bar`: duds). **Tests:** new integ scenario BROODBUSY
(fails on main with drakelings / furnaceMaw at 0.02 s, passes now); PRESSURE without the 0.08 s wrapper passes on
1337, 7 and 4242. **Open:** how often a drakeling now gutters out in a real fight (none in the scenario's busy spell;
PRESSURE does not print it yet); played by the owner.

## 2026-11-26 — The reference-footage tools removed (ADR-236; branch `build/remove-mocap`)

**Owner**, after reviewing the hero remade from two reference films (`?hero=new`, PR 162, closed): "It looks all
meh. Scrap everything. Lets not use any of the reference video stuff ... we will just go back to how we made
animations on our own", then to remove the tool on main and the motion guide too.

**What.** Deleted `scripts/mocap/` (the footage tracker, the duelist fitter, the recorder, the specs) and
`src/entities/hero2/` (the skeleton / clip contract and the two bare-hand clip sets it carried); the
duelist realiser's unused `keysOf` hook (no boss used it: behaviour unchanged); the `.gitignore` lines for
footage frames. PR 162 (the remade hero) and PR 148 (the refstudy kit and `docs/MOTION.md`) closed. The
game's animation stays hand-authored (`player/anim.js`, `swings.js`, the bosses' move data).

**Verification.** `npm run build`; the duel suite (the realiser's main user) all passed; the rest on CI.

## 2026-11-26 — The perfect parry widened to the perfect dodge's window (ADR-227; branch `claude/combat-perfect-parry-window-d6503b`)

**Owner:** parrying is very hard, the timing too tight; make it like the perfect dodge's window. They picked
the PERFECT parry 0.08 → 0.20 s; the plain parry (0.22 s) stays. **What:** `DEFENSE.perfectParryWindow` 0.20
(`combat/rules.js`); every perfect reward reads `deflect.perfect`, set from that one number, so nothing else in
the rules moved; the Lab training card reads the number. A plain parry is now a 0.20 - 0.22 s press only:
one frame at 60 fps (13/60 s). A blow that is both a blue flare and a `lock`
(Severance, Hundred Hands' palm, Rain of Ashes' last) now nearly always locks the blades instead of the flare
counter (the rule as it was; a perfect parry is simply the norm now). **Tests:** a `PLAIN_LEAD` per suite for
the checks of a plain parry (that one frame; checked with a per-parry gap print), duel's `makeDefender` a
`lead`; bots that play like a player keep 0.12 s (now perfect): integ STRINGS posture x 1.5, asc Hundred Hands
may end in the lock, city WIN floor 140 → 130 s (137 - 142 s now). **Finding (a separate task):** integ
PRESSURE seed 4242 met a director gap once the steady bot's stray parries turned perfect: the brood's
busyWait dive (`brood.js`, `BROOD.busyWait` 2.5 s: a drakeling dives anyway after waiting that long on a busy
wyrm) landed within 0.3 s of a wyrm cue needing another answer: fanVolley / drakelings in P2 (at 60.6 s) and,
with 4242 run alone, breath / drakelings in P3 (63.5 s). It exists on main (the seeds just miss it); the
scenario keeps the old 0.08 s perfect window for the steady bot's stray parries, so it measures the director
on its old path. **Open:** played by the owner; whether the slow-motion beat on every parried blow of a string
is too much now (the `short` beat, `combat/perfectFx.js`); the brood fix.
## 2026-11-26 — Tian Lei's and Halcyon's motion: held windups, snap blows, Halcyon a flier (ADR-225; branch `claude/enemies-tian-halcyon-motion-efe595`)

**Task** (the motion pass the owner asked for: every boss audited; readable held blue / red windups; a few much
faster normal blows; options rendered and picked). This session: Tian Lei and Halcyon.

**Measured.** `asc.mjs . audit` and a new opt-in `city.mjs . audit` (the same measure for a flier). Findings in
ADR-225: no held pose on blue / red blows (the coil at u 0.7 - 0.78); Halcyon stood on air in every blow and
punched over the hero's head with a crooked arm; the sweep's knee jolt and sliding feet; the dash thrusts skate;
the cross lands to the side.

**What.** `ascendant/motion.js` (held windups, `SNAP_KEYS`), `halcyon/motion.js` (the flier's legs, the aim, the
dip in `flight.js`, `armSoft`), `mo` descriptors on the builders' beats, the snap moves (`snapJab`, `snapHook`,
`flick`, `tap`), `TUNING.snap`, Lab LOOKS `ascMotion` / `halMotion` (PENDING). Tests: asc.mjs `heldmotion`,
city.mjs `halmotion`, DATA's snap rule, GCD_LOOK in both audits. Films: before | after at the game camera and a
close side view (scratchpad rig, not committed).

**The owner's pick:** "Ship both (a)": both switches are the default (PICKED). Main had dropped the realiser's
`keysOf` hook meanwhile (ADR-236, unused then): restored for this use.

**Open.** Not fixed yet: the sweep's jolt, the dash thrusts' skating, the cross's sideways line, Fly-By's pass height.

---

## 2026-11-26 — The lite world on a phone at AUTO's floor (ADR-216; branch `render/phone-lite`)

**Owner:** the BENCH from their iPhone (fox: the world pass 11.8 of 13.3 ms; half the pixels only 32 % less);
of three rendered options (A today, B the four upgrades off, C B plus a one-octave floor relief) they picked "C".
**What:** `autoQ.wantsLess` (slow with no step down left, kept for the page), `game.liteWorld` (touch + AUTO +
wantsLess, `?lite=1|0`), groundFx holds the upgrades off and writes `uDpLite`, the floors' relief branches on it.
Tests: autoq `wantsless`, groundfx `lite`. **Checked:** lite equals the sheet's C in one page (474 px differ:
the relief); the world pass 13 - 22 % cheaper in this run on the desktop GPU (31 - 34 % in the sheets' run).
The sheets' grove A / C differed in the bamboo too: that was the frame, not the option (one page shows the
same bamboo). **Next:** the owner's BENCH on fox and grove with it on.

## 2026-11-26 — BENCH in `?perf`: each pipeline step's GPU cost on the phone (ADR-215; branch `perf/phone-bench`)

**Owner's iPhone reports** (fox, grove, code; Safari 27.3, iOS 18.7, screen 414 x 896 at 3x, the page at 669 x
867): 52 - 59 fps; script mean 3.5 ms, p99 7 - 12 ms; 6 - 20 % of frames over 20 ms, the long ones 46 - 69 ms in
the fight's busiest moments (the flurry on a staggered boss, the fox's twin fall, perfect dodges); AUTO at its
1x floor on fox and grove (1.25x on code); an AUTO step's own hitch 17 - 32 ms. So the GPU is the limit, not the
script. **What:** BENCH (`perf.bench()`, a button): each step's share of the frame, the still map redrawn, the
frame at ~0.7x pixels. Test: world `perfreadout`. **Next:** the owner's BENCH from a busy moment on fox and grove;
then the step it names, cut at AUTO's floor, shown as options; AUTO's step hitch (the letter atlases rebuilt).

## 2026-11-26 — The perfect parry's own streak: the deathblow (ADR-211; branch `claude/parry-riposte`, PR #145)

**Owner:** "have perfect parry have its own streak animation/effect instead of using the perfect dodge one", with a
reference clip of a sword-deflect chain; after the planted riposte: "riposte x3 / x7 ... doesn't seem as rewarding
as the perfect dodge streak ... i also want the character to have to parry multiple sequences to get the reward".
Picks (asked): posture break as the trigger, recoil + your own cut per string, a deathblow, separate counts; the
chain grows "gently"; then "Yes, make it default".

**Reference study.** Frames of the owner's clip at 30 fps through a headless Edge (CDP), a timing card of one
deflect: an orange bloom at the contact 0.03 - 0.07 s, sparks spread and fall 0.2 - 0.3 s, stragglers to 0.5 s;
contacts 0.30 - 0.35 s apart in a chain; the defender stays planted; the last deflect bigger, then the posture
breaks. Our translation is smaller and calmer.

**What.** `player/riposteCut.js` (`?parryRiposte=deathblow|planted|old`, default deathblow), `player/deathblow.js`
(the finisher), `DEFENSE.riposteCut` / `DEFENSE.deathblow` (rules.js), `player.parryRun`, `combat/parrySparks.js`
`?parryGrow=a|0` (default a: more sparks per tier, embers from tier 2 on the wind, a fire-field heat flash),
flow.js skips the grade dip / flash / cold cast for a planted answer, the HUD's DEATHBLOW banner, the Lab's streak
row (`riposte`, `parryGrow`), TRAINING: Deathblow x3 / x7 and the counter cut after a parried string. Built by
three Sonnet subagents in worktrees (riposte, sparks, deathblow), merged and wired by the lead. Tests: duel
`riposteplanted`, `parrygrow`, `deathblow`.

**Verification.** Filmed at the game camera (headless Edge, `__tick`, ffmpeg; full frame + 3x inset): planted at
streak 1 / 7, the deathblow at 3 and 7 (160 / 240 damage), the hero within 0.01 m of where he parried. The
deathblow's thrust was a fully charged one and printed a large white blot at the tip: now uncharged (the tip's own
small streak stays, as the shipped thrust has it).

**Later rounds (same day).** The two-beat deathblow was turned down; the owner asked for "# of streak death
blows" with a special effect per hit. Built by Sonnet subagents, filmed each round: N planted blows (13 moves) on a
posture break or a blue-blow parry, a hit-pause per blow (~3 s for 7), the blade's real path into one straight cut
on the body, blood (spray, wound, pools), four hit looks (`?dbfx`; Shatter Web picked), four sounds on an audition
page (https://claude.ai/artifact/AiJ7MzqvymQrvzLZryLEfH; Flesh picked), a matrix look (`?dbmatrix`, skipped:
off). The hero's own blade line is hidden during a combo (the owner: "huge slashes ... distracting"). The
deathblow's fire-field heat was budgeted after it blew the phase-3 cap (4959 blobs).

**Open.** The wyrm keeps today's flurry riposte. Played on the iPhone. `?dbmatrix` and the other looks / sounds
can go if they stay unused.

## 2026-11-26 — The phone's frame: `?perf` on the device; the first break's upload and two spikes out (ADR-209; branch `perf/phone-spikes`)

**Owner:** "i tried playing a few levels like the neo, bamboo, and fox level and the fps does dip during the
fight. what else can [we do] to ensure performance is good?", then "this was on my iphone ... pretty powerful",
then "Yes, both" (the on-phone readout and the spike fixes).

**Measured** (headless Edge on the RTX 4090 / i9, the phone setup `?touch` at 1468 x 686, real-time fights with
a bot, the rig's `timeline.js` / `j_methods.js` / `prof2.mjs` / `prof4.mjs` / `heap.mjs`): a fight frame is 4 - 5
ms of script, 2 - 3 ms GPU; 0.1 - 0.4 % of frames over 9 ms of script, worst 13 - 16 ms; the second fight in a
page as spiky as the first. Spikes ride on a blow landing (trade 4 - 7 ms, clash 3 - 4.6, parry contact 2 - 2.5,
perfect dodge 2.3 - 2.9; inside: sound voices, the hero's pose, call-outs, the boss's reaction), plus the first
draw of a floor's or the bamboo's hidden remains (bounds 1 - 2.5 ms + buffers) and the still shadow map's
whole copy of a big mesh (bamboo 1.1 ms). Allocation 17.7 MB/s, mostly V8's boxed numbers (not Safari's).

**What.** `dev/perfReadout.js` + main.js hooks (`?perf`, `__perfReport()`); `render/precompile.js` `warmDraw`
(main.js after the precompile; `?warm=0`); `render/shadowCache.js` `_bigSync` (the copy kept on every change);
`pipeline.js` `_renderSeen` leaves the hero's matrices alone. Tests: world `perfreadout`.

**Dropped:** slicing the contact rings' scan (its cost was my instrumentation's, 5 - 15 us really).

**Open.** The owner's `?perf` report from the iPhone in a fight on fox, grove and code; then the parts it
names (the hit-time work, draw calls, the hero's animation). A shader / pipeline warm-up for effects first
drawn mid-fight on iOS, if the report shows first-time stalls.

## 2026-11-26 — The melee animation engine; Tian Lei's blows from a bare-handed film, turned down (ADR-208; branch `enemies/fists-ref`)

**Task** (the owner): review a bare-handed melee reference film with the "0 - Game Engine" session's tool, learn the
animations, put them on a bare-handed boss to preview, and save what was learned in the repo for future agents.
Owner's answers: Tian Lei first; remap his existing blows; reference motion at our windups; behind a switch, held PR.

**What changed.**
- `scripts/mocap/` (the hero remake branch's pose-tracking tool) and the hero2 skeleton / clip contract it needs.
- `scripts/mocap/duelist/`: `fit.mjs` (clip → duelist keys, `--check` through the real animator), `examples/tianlei.json`
  (the map), `README.md` (the engine's guide and lessons). `scripts/mocap/armkeys.py` (arm hand keys).
- `scripts/mocap/specs/fistA.json`, `fistB.json` → `src/entities/hero2/clips/fistA.js`, `fistB.js` (six clips).
- `duelist/realise.js`: optional `keysOf`. `ascendant/moves.js`: `refKeys` on every punch / kick / elbow / shoulder
  beat, `fistKeys`; `ascendant/refBlows.js` (generated). Lab LOOKS `fists`; PENDING. `asc.mjs . fists`. (All of this
  Tian Lei wiring was removed again after the owner's verdict, below; only `keysOf` stays.)

**How it went.** The film (15:15) was recorded frame by frame in a headless Edge, catalogued by a subagent (41
strikes, hand strikes only: a wild brawler), and two author subagents built six clips. Nothing fused across camera
angles (follow cameras, differing passes, a capture of 30 - 60 frames a second with gaps at impacts): every blow is
one take with the striking arm hand-keyed frame by frame. YouTube autoplayed the next video after the capture and a
still-attached recorder wrote ~18 000 of its frames under 0 - 389 s; they were found by write time, deleted, and the
light chapter re-tracked. The fit lands fists within ~5 cm of the reference, elbows ~11.

**Verified.** `asc.mjs . fists` (timings identical on and off, the clips change, a fight through every measured move:
no NaN, no error); film strips in the browser (today vs `?fists=ref`: the lunging straight, the overhead hammer).

**The owner's verdict.** "the new animations look worse than the old ones": the stiff, unnatural arms and the
lunges and feet. Tian Lei's wiring was removed from the branch before merging (his blows are as authored);
the engine, its guide (with why this try failed), the recorder and the realiser's `keysOf` hook land.
Frames, caches and sheets stay in this session's scratchpad (never committed).

---

## 2026-11-25 — Four looks for the perfect dodge flurry (ADR-210; branch `claude/dodge-rework-fc5eae`)
- **Why:** the owner: no "random hops over the character", "more epic cooler looking". Split off the parry
  streak's session (PR 145) so both run in parallel.
- **Reference:** the owner's animation compilation has no labelled perfect-dodge section; its dash thrust (a low set,
  one smeared frame, a bloom at the point breaking into floor tendrils, the lunge held) and its close strings (a small
  bloom per contact, sparks that fall and gather) were carded.
- **Round 1:** `?dash=1` (no blinks, every pass from where he stands, always the Passing Cut, smear + floor kicks).
  The owner preferred the old vanish and all three finishers (filmed one by one to check; none dropped), kept the
  new effects, wanted aerial cuts in a streak and four variations built on what the footage taught.
- **Round 2 (this):** `?dodgefx=a|b|c|d` replaces `?dash`: the old flurry + smear + kicks + an aerial cut (2nd from
  4 flash cuts, the 1st too from 6, never a storm cut), and a) the Thunder Thrust, b) point bloom + tendrils,
  c) spark cloud, d) heavy finish. Built by Sonnet subagents from the lead's briefs; filmed side by side.
- **Tests:** duel `dodgefx` (every variant x streaks 2 / 5 / 7: blows, damage = off, feet down at the end, the aerial
  cut's height, the thrust's pick), duel `chain` / `tempo`, integ `chain` / `storm`, cost, glyphcheck.
- **The pick (2026-11-26):** the owner chose **a**, the Thunder Thrust, as the default. Fallout: the aerial cut's
  hanging line was drawn through the foe's chest; it now runs along his own path (the chain's rule), and the chain
  test measures from his real height. The pace sims (duel / lord `pace`, city's win window, duel `pressure`) measure
  the boss with the looks off: the held lunge holds the world longer, a gap in his cues that is not his pace.
- **Next / open:** played on the iPhone; aerial cuts only on the chain's paths (`?chain=0` has none).

## 2026-11-25 — A roadmap to Steam and the app stores (docs only; branch `docs/ship-roadmap`)

**Owner:** plans to sell the game on Steam (Windows / Mac) and the iOS / Android stores; asked whether the
engine is good enough, then for a roadmap with performance first and a separate legal review of the homages.

**What changed.** `docs/ROADMAP.md`: a new section "Ship" (S1 performance on the target devices, S2 the legal
review, S3 saves, S4 Steam, S5 mobile, S6 localisation / accessibility / release). And a section "Polish" from the
owner's asks: P1 every boss in the house ASCII look (some still are not), P2 every boss's swings and motion
polished from the reference footage, P3 arenas that are part of the fight, better backgrounds, cooler destruction. The engine stays: the web
build ships inside a wrapper (Electron or Tauri on desktop, Capacitor on mobile). Measured sizes: 1.35 MB of
code gzipped, ~15 MB of music fetched per level.

**Not redone.** The frame's cost is the performance session's (M1.89: AUTO quality, the still shadow map, the
cost budget). S1 lists only what shipping adds: named target devices and a floor, a mid-range Android baseline,
heat and memory on a phone, a lost WebGL context (`webglcontextlost` is not handled), 120 Hz, the WebKit path.
Those items were sent to that session.

**Next.** The legal review runs in its own session (report in `.claude/legal-review/REPORT.md`, untracked); the
owner's picks per boss follow it. The wrapper trials wait for the content.

---

## 2026-11-25 — The hero's idles and guard after the owner's reference footage (ADR-207; branch `claude/idles-reference`)

**Owner:** "review these sections on the videos for all the idle animation and poses for you to mirror to this
game ... i also want you to adjust the guarding stance and animation from the reference video". Their three
answers: the two-handed hold is the fight stance, at ease one-handed; the put-away / draw is an occasional idle
moment, the sword fading out in its green flame at his left hip (no scabbard); ADR-186's habits, tricks and spells
stay, from the new stand. Planned by the idle session, built by an agent from the plan.

**What changed.** `refStance.js` (new): `REF_STAND` (at ease), `REF_READY` (the fight's two-handed hold),
`REF_GUARD` (the block) and their writers; `?guard=ward` keeps the cross ward. `idles.js`: a third mode `ref`, the
default (`?idles=new|old` the looks before): one rest per stance, the standing arm the forearm-led moves start from
follows the mode (`syncStandArm`), the fight's habits about the hold's blade (`grip`, `shift`, `loosen`), and the
put-away `stow` (a trick: dip, the hand to the left hip, the sword gone ~1.5 s, drawn up and over into the stand).
`anim.js`: `stand()` writes the reference's stand / hold under `ref` (the free hand takes the grip late in the
stance's change, lets go on the move); `blockPose` writes `refGuard` for the hero under `guard=ref`;
`_idleLife` publishes `anim.stow` only while an uncut put-away plays in the loco clip; `_stowSword` draws the
weapon slot's own meshes into the hilt and hides them (no object added to the rig). `swordMystic.js` burns the
going / coming steel in the flame; player.js rests the halo and the gem's glow while it is gone. Lab: `idles`
ref / new / old, a `guard` row, `stow` in `idle ▸`.

**The guard, read again from the frames.** The plan read it as the blade held upright (the right-side view). The
front and back views show the upright blade is a slant across his face seen edge-on from the side: the hands
before his right shoulder, the elbows out, the blade rising ~32° to his left over his head. Built that way: 13°
off upright from his side, 32° up across from the front.

**Verified** (by running): scenario `heroref` (new; ALL PASSED, 100 checks): the stand (wrist ≤ 44°, elbows R 131°
L 126°), the hold (wrist ≤ 60°, the free hand on its place on the grip), the stance's change (the free hand ≥ 8.8
cm out of him), every action (wrist ≤ 57°, the blade ≥ 20 cm off him, pops ≤ 7 cm), the put-away (the sword gone
224 frames over two plays, never outside it, whole the frame any of six moves cuts it, and when the idles switch),
every move from the stand, the hold and inside every action against the bare stance before, the guard (sunk
~24 cm, feet 0.8 m apart, the hands 23 cm over the chest joint, the entry ≤ 31.8 cm a frame at the point; the cross ward's from the stance before: 57).
Pair sheets against the footage and films at the game camera (scratch, not the repo). `heroidles`, `herolife`,
`heroarms` and `herohand` run with `?idles=new&guard=ward` (their bars measure ADR-186's poses and the cross ward).

**Departures from the footage** (ADR-207): the blade's flat rolled 40° up off his sides (edge-on from the game
camera otherwise); the hold's grip ~13 cm higher and its blade flatter than the footage's (the 60° sword-wrist bar);
the guard's crouch less deep than the footage's; the coat hides the stand's blade from straight behind.

**After the merge with main** (the full `npm test`: six FAILs, all ours, each green with `?idles=new&guard=ward`).
The hold stood the footage's left foot ahead, but the light chain steps the rear foot and comes home to the
stance: every light stepped the other foot and the way home drew back the wrong one (heroweight). The hold now
keeps the feet the chain comes home to (the right 18 cm ahead), the hips square, the blade 30° out. The robe's
sleeve wing and the warden's belt cut into the arms (looks): the stand's sword elbow and the hold's free elbow
stand off the ribs; the blade-swinging moves take the old elbow pole over their envelope so the raised fist stays
within 60°. The ribbon sword's swing (hero) and the air star of seven (chain, seeded drift: the plan's own best
was 14° from the new dodge spot, the search complete) are measured as ADR-207 says. Films re-taken.

**Next / open.** The owner's look at the films (the hold's and the guard's blades from the game camera). The
steel look set (`?lights=steel`, unmerged) has its own stand: when it lands it keeps it (its own hook in `stand()`).

---

## 2026-11-26 — Performance guards: a cost budget in `npm test`, `npm run perf` (ADR-206; branch `perf/cost-budget`)

**Task** (the owner, after AUTO quality merged): "is there anything else we can do to ensure performance is good no
matter what we change moving forward?" Two guards, the first two of five the answer listed.

- `tests/integration/cost.mjs` (in `npm test`, ~8 s): every level's set built with the real modules and the world's
  wiring, counted: meshes, main-pass triangles, shadow-caster triangles, rigid-batch bones, breakables, colliders,
  geometry MB, each for the whole level and the phone's share. Budgets in `tests/cost-baseline.json`: over by 3 % +
  slack fails; under by 10 % prints a note; a new level without a row fails. Nothing is timed (the numbers are the
  same on every machine; two runs wrote the same file). Checked it bites: a budget cut by 20 % failed with the
  metric named.
- `npm run perf` (`scripts/perf.mjs`, `scripts/perf-probe.js`): the dev server and a headless Chrome / Edge on the
  PC's GPU, one fixed fight per level (a seed, the hero 5 m from the boss); draw calls and triangles by pass, GPU
  ms by pass and per frame at 1080p and 2556 x 1179 (`--4k`), script ms by module; `--save` a machine's baseline
  (`.perf/`, git-ignored), later runs print the change, `--check` exits 1 over +10 %. On the RTX 4090 / i9:
  Cinderwood 1.5 - 1.7 ms GPU at 1080p, 1.5 - 1.6 ms at the phone's size, script 4.7 - 5.1 ms; Ashfall 1.5 - 2.0 / 1.6 ms, script 4.5 ms; the ms moved up to 30 % between two runs, the counts not at all (so `--check` gates only the counts)
  (a 24 s run for two levels).
- CLAUDE.md: a rule that a heavier level raises its budget on purpose and says why in the PR, and a change that
  draws something runs `npm run perf` before and after; the command listed.
- Not done (the other three of the five): an in-game readout of AUTO's step and times, a starting step per
  level, and the owner's devices' own baselines. Not measured: any weak GPU or phone.

---
## 2026-11-25 — AUTO quality: the resolution follows the frame time; a 60 fps cap on touch (ADR-200; branch `render/auto-quality`)

**Task** (the next item of M1.89, from the perf review's session): automatic quality so "60 fps on every device" is
reachable; the owner picks the floor from rendered steps.

**What changed.**
- `render/autoQuality.js`: `AutoQuality` (the decision, pure), `gpuTimer(gl)`, `FramePacer` (the cap), the URL
  switches, `qualityLabel`, `fpsCapOn`; numbers in `CONFIG.autoQuality` / `CONFIG.fpsCap`.
- `main.js`: `applyQuality` takes the AUTO step's scale / shadow / grass; the loop times each drawn frame's script and
  GPU, feeds the controller (`autoStep`), and first times 11 title frames (after 20 warm ones) for a guess; the cap
  skips refreshes before anything runs.
- `flow.cycleQuality`: AUTO → LOW → MEDIUM → HIGH → AUTO; `flow.toggleFpsCap`; the pause menu's 60 FPS CAP; the fps
  readout and the menu show `AUTO 1.25x`; touch keeps its LOW default only with AUTO off.
- Tests: new suite `autoq` (in `npm test`).

**Measured** (RTX 4090 / i9, headless Edge): a step costs 2 - 9 ms in `setSize` + 5 - 19 ms on the next frame. The
first guess read 10 ms on the 4090 with 2 warm frames (the first frames after the load are slow), 3.0 ms with 20
(steady state 3.1). Live: a GPU load in proportion to the pixels at 2x (30 fps) → 1.5x → 1.25x (68 - 77 fps) in 7 s,
back up on the title once removed, no step up in a fight; CPU throttled 8x: no step. The trace tests caught a
vsync trap (33 and 23 ms of GPU both read 30 fps) that undid good steps: fixed (ADR-200).

**Decided.** The owner picked the 1x floor from the sheets of every step (the wyrm fight, Ashfall's paving, the phone;
`.claude/autoq-review/`): below 1x the letters get fewer and bigger, so AUTO trades only crispness.

**Open.** Not measured: any weak GPU or phone, a step's
hitch there, the GPU timer's presence on the owner's laptop and on iOS (Safari has none: the probe path).

## 2026-11-25 — Local test runs go easy on the PC (ADR-205; branch `test/local-load-cap`)

**Owner:** the PC ran at 100% CPU from agents' test runs; make future gcdAbyss agents close what they no
longer need and stop straining the machine, so it can game beside them.

- `tests/run.mjs`, locally only (no `CI` env): workers at below-normal priority; one machine-wide pool of
  8 slots (`ABYSS_JOBS`) shared by every run, so two agents' `npm test` queue instead of doubling the load;
  a stopped run kills its workers; `--only <names>` runs a subset. CI unchanged.
- CLAUDE.md: a "Go easy on the owner's PC" rule (test only what changed, one `npm test` at a time, check a
  timed-out run before rerunning, stop servers before finishing).
- Found: two full runs at once (~40 processes, ~75 GB) and eight idle preview servers from finished
  worktrees (stopped by hand).
- Next: re-measure a full local run's wall time at 8 slots; raise the default if it hurts.

---
## 2026-11-25 — The run carried like the owner's reference: the blade forward at the hip, a full pump, a fist (ADR-204; PR 138)

**Owner:** "make the right angle hold the sword at a proper natural angle. make the left hand fist look like a hand";
two rounds of options (a relaxed trail, a low sweep; an open hand, a loose fist) were turned down: "the running and
sword placement still looks off. use this video ... as reference from 2:48 - 3:51". The reference: a knight sprinting
with a straight sword.

**What the reference showed.** Frames grabbed from the video in the user's Chrome (a canvas sheet of seeked frames,
side and back views). The blade is carried FORWARD, low at the right hip, rocking -20° (arm back) to +25° (arm
forward) with the forearm, the wrist quiet (a hammer grip, 60 - 70° between forearm and blade); every carry we had,
`old` included, pointed it back (azimuth -150°) on a wrist cocked 62 - 87°. The free arm pumps fully (fist before the
belly; elbow high behind the back); the free hand is a compact closed fist as wide as the forearm.

**Changed.** `runSword.js`: the carry `hip` (planned by Fable, built and measured by an Opus subagent): forward
kinematics against the torso's line turned by its lean, the blade the forearm's line plus a grip angle; at a sprint
it rocks -21 … +23°, never behind him, its flat rolled 40° toward the game camera (edge-down printed as a one-cell
line). `runArms.js`: the carry `d`, the full pump. `gear/handShape.js` `fistHand`: the free hand as a closed fist by
its overall shape (`?handLook=g`, skin; `h` a dark glove with a cuff). The owner played the new run ("the new run
looks great but the hand still needs work"), then picked hand g. Defaults: `hip`, `d`, `g`; the sword carries `a` /
`b` removed.

**Verified.** `herorun` checks `hip` (blade ahead, elevation -30 … +32°, point off the grass, grip on his right, no
pops) and `d`; a side-by-side sheet against the reference stride, films at the game camera from four sides; `npm test`.

**Open.** Running away from the camera the forward blade is mostly hidden under the cape (so is the reference's); a
larger `out` yaw is the knob. The run start from standing still jumps the point ~26 cm in one frame (the idle rest's
hand-over to `loco()`'s base, any carry). The torso leans 24 - 25° at a sprint against the reference's 20°.

## 2026-11-25 — The wyrm's neck and head reviewed move by move (ADR-203; branch `dragon/neck-motion`)

**Owner:** "the dragon does weird neck movements when hes flying as well. in general review all the dragon neck
movements and make sure it looks natural and accurate and not buggy".

**How.** An audit in headless Edge (a scratch module stepping each of the 50 moves, the stagger and both phase
roars from a fresh page, frame by frame) against an untouched main checkout served side by side; the numbers
first, then films of the flagged moves (the wings hidden for a clean view of the neck, then the real look). Four
faults (ADR-203): the head leveled only at rest (upside down in flight), look points under / behind / over it
swinging it round, the driven shown neck buckling away from its pinned head on a strike's first frame, and
`headExact` with no turn limit. Fixed in `_updateNeck` and `Chain.apply` (a twist spread down the chain).

**Owner, round 2** (played the first pass, now `?neck=b`): "the head got worse when flying and when it does a
ground perfect parry attack": it rolled oddly and looked the wrong way. The default (`?neck=c`) holds the head
upright against its own body, not the sky, and lets it look where its move points it (a shoulder limit, the side
swapped once a foe is clearly round the other side); `?neck=0` is the wyrm before.

**Owner, round 3** (played c): "c is almost all good but ... during a perfect dodge/parry slow time effect the
dragon seems to home into the players teleporting movement and makes it do a bad angle". Its sense of the hero
read his chest every frame, so through his flurry its look point chased each blink round and over its head
(12 - 28 m of travel, its body turning up to 46° after him). Now it keeps where it last saw him until the flurry
ends (`Dragon._sensePlayer`, c and b; 0 as before): 0 m, 0°. The head still flinches at each cut, as on main. The owner: "Ship c": c is the default, b and 0 stay behind `?neck=`.

**Lessons.** Leveling needs an unwrapped, rate-limited correction: the plain shortest angle swapped between +180
and -180 and spun the neck 50° a frame; fading it out near vertical brought the flips back. 'Up' for a head
pointing down must lean along the heading the head holds, not the chest's forward (that leaned a head glancing
back against the sky) nor the snout's own heading (it spins as a wheeling flight's snout points past its foe).
Runs must start from a fresh page: one move after another left each starting where the last ended.

**Verified.** The audit before / after (every move), films before / after, `npm test`. The pressure scenario's
seeded fights drift (the mouth sits a little differently); a 20-seed sweep on main and the branch compared the
gaps between cues.

**Open.** The tail lash's windup level lags up to ~60° for a few frames as the head swings over the top; the
leap's and pounce's neck strikes stay fast (the measured solve's own steps).

---

## 2026-11-25 — The idles' sword hand: the forearm leads the blade (ADR-186 amended)

**Owner:** "something about the idle animations on the right hand looks weird in terms of angle and unnatural feel.
show me close angles", then, on the four-angle review films: "Fix the big angles".

**Cause.** The sword fist is built on the SWORD's frame (gear/wanderer.js, so the fingers wrap the grip in every
pose) while the back of the hand and the cuff are the forearm's. The owner's stances keep the blade within ~7° of
the forearm's line; the spin, the figure-eight, the salute, the rite and the breath turned it 66-129° off it, so the
fist twisted off the wrist.

**Fix.** `idles.js armAlong / armPath`: those moves place the elbow and aim the forearm where the blade goes, the hand
a forearm's length on along that aim (from the at-ease arm, `EASE_ELBOW` / `EASE_AIM`); the blade leans only a little
off it. The spin is a quick swirl of the point round the forearm (±28° / ±24°), the figure-eight an 8 round its line
(±26° / ±19°); the salute, the rite and the breath raise the forearm with the blade, the elbow forward of the ribs.
Worst blade-to-forearm angle: spin 129 → 45°, figure-eight 101 → 52°, salute 82 → 31°, rite 66 → 33°, breath 80 →
39° (the rests 16-17°, as before). `heroidles` now holds every action to 60°.

**Then, at the game camera** (the owner: "something about the right hand from normal camera angle makes it look
very jagged and weird looking"): stood upright beside his head, the raised forearm showed from behind and above as a
ragged column of the vambrace's tan letters (hiding the forearm in a render took it away). The salute, the rite and
the breath now bring the fist up before his chest near his middle (`RAISE`, `armRaise`), the forearm rising at ~32°
toward it and the wrist cocked the rest of the way, where his head and shoulder cover the forearm as they did before
the forearm led. Wrist 54 / 40 / 49° (under the 60° bar), elbows ≥ 61°. `armPath` no longer allocates per frame.
Film: the three moves at the game camera, main | the forearm upright | now.

**Measured.** heroidles passes: elbows R ≥ 62°, the blade ≥ 22 cm off his body; every move from every rest and from
inside every action within the stance before. Films: four close angles of every idle (camera lean off), and the five
moves before | after.

---

## 2026-11-25 — The still shadow map (ADR-201; branch `render/shadow-cache`)

**Owner:** "is there anything we can change to ensure that laptop has 60 fps without sacrificing much?";
of the options given, "ok lets do #2 and show me #1 previews for me to review" (#2: the shadow map's static
world not redrawn every frame; #1: AUTO quality, PR 137, whose previews were sent from its session's sheets).

**What.** `render/shadowCache.js`: what has not moved is drawn into a still map only when it changes; each
frame the texels that changed casters covered last frame are copied back from it (depth blits) and only the
moving casters are drawn. `rigidBatch.js` sync stamps a shadow mesh when its bones move and keeps the moved
bones' old spheres (`vacated`). `pipeline.js`: `_renderShadowCached`, and the shadow camera, with the cache
on, moves in its own plane by 32 of its texels. `CONFIG.render.shadowCache` (`?shadowCache=0` off). World
test `shadowcache` (a stand-in renderer: what is drawn where, when the still map is redrawn and why, the
rects copied back, the masks put back, a big mesh's edited range, off without blits).

**Steps that did not work.** Copying the whole still map each frame: 32 MB moved a frame, too much for an
integrated GPU; three's `copyTextureToTexture` cost 0.7 ms of CPU a frame (it reads GL state back). The old
world-axis snap made coarser: the shadows' letters jumped at each step (most of the frame's pixels changed);
the old snap already changed about 93 % of them at each 8 cm of a walk.

**Measured** (headless Edge, RTX 4090, every level, a scripted fight at 1080p): the shadow map equals a
whole draw texel for texel (480 samples, 0 differ); shadow triangles a frame -15 % (the throne) to -79 %
(Cinderwood); shadow draws about halved; 4 - 8 % of the map copied a frame; 70 - 115 us of CPU. The frame
time on the 4090 does not change (its shadow pass was under 0.1 ms).

**Open.** Not measured on the owner's laptop or any integrated GPU. A frame that redraws the still map
(2 - 7 % of frames in a fight) costs what every frame cost before. Lighter trees on LOW, the floors'
shader, the uniforms' upload and the hitches are still open (M1.89).

## 2026-11-25 — Frame cost: a measured review, then three fixes that leave the picture alone (ADR-199; branch `render/perf-ground-steps`)

**Owner:** "the game runs pretty slow on less powerful machines. review the game and code to see how we can
improve performance. i want this to be at least 60 fps on every device"; then "yes do the 3 fixes and it was a
laptop with intel core ultra 7 255u with onboard 128 mb intel graphics".

**The review** (latest main, all eight levels and `?touch`; headless Edge on the RTX 4090, so GPU numbers are
shares, taken at 4K / 5K where the fill cost shows; script by the CDP profiler and CPU throttle):
- Nothing lowers the load: a desktop starts on HIGH at up to 2x device pixels, and GPU cost is linear in pixels
  (0.22 - 0.39 ms per megapixel on the 4090). The presets differ only by resolution and shadow size now.
- The scene pass is 75 - 80 % of the GPU frame; the ground 1.1 - 1.45 ms and the paving 0.3 - 1.1 ms of a
  2.4 - 3.9 ms frame at 4K. The dragon print costs about 1.7x the look before per pixel on Cinderwood, for
  520 000 fewer grass triangles.
- Script: about 2.2 ms a frame on the i9; half is three.js draw submission (about 0.5 ms re-uploading the shared
  uniforms to 34 programs). CPU throttled 4x / 6x / 10x: 84 / 42 / 10 fps, the catch-up steps at 1 / 1.7 / 5.8.
- The phone preset still draws about 930 000 triangles a frame, half of them into the shadow map.

**What changed.**
- `world/ground.js`: the ground is drawn last (`GROUND_ORDER`, a strict depth test); `bakeRelief` bakes the
  relief once per cell on the GPU into two float textures (`DP_BAKE`), called by `world.js` (again on a restored
  context; `?bake=0` off). The relief's GLSL is one chunk (`RELIEF_GLSL`) both read.
- `core/timestep.js` `STEP.world`, `runFrame(…, world)`; `main.js` `simulateWorld`: the world, the lights and the
  particles step once for two of the fighters' steps.
- Tests: integ `timestep` (the world's place in a frame of 1, 2, 3, 6 steps), world `worldstep` (a felled tree,
  the ground fire and its burns at 16.7 / 33.3 / 41.7 ms).

**Measured** (old against new alternating in one page; other sessions were on the GPU and CPU, so ratios):
the picture differs in at most 9 of 2 073 600 pixels by at most 2 / 255 in every level; the frame at 4K costs
17 - 45 % less, at 1080p 10 - 25 %; a two-step frame's simulation 19 - 28 % less. A context lost and restored
comes back with the ground as it was.

**Not done / open.** The floors' relief cannot be baked without changing the picture (a cell is lit on its
facet; the slabs lie at many heights), and drawing the floors later would risk ties with what stands on them:
the floors' shader is as it was. The CPU cliff is lower, not gone. No weak GPU, no phone and not the owner's
laptop were measured. Next, in the review's order: automatic quality (resolution following frame time: the
one that makes "every device" reachable; its floor is a look choice for the owner), the shadow map and the
trees' triangles, the uniforms' upload, the hitches.

## 2026-11-25 — One click travels (ADR-196)

**Owner:** the title made you click a world twice (select, then go). `TitleMenu._click` now selects and acts in one click or tap; hover, arrows and pad focus still only select. The records `menus` test is updated.

## 2026-11-25 — The hero's name tag much higher (ADR-196)

**Owner:** the tag was "still way too close" at 0.75 m. `HERO_TAG.over` (ui/nameTags.js) is now 1.25 m over
the head bone: about 18 px clear of his hair at the default camera (it was about 7), 11 px zoomed far out,
29 px zoomed in. The title's old address (the project's first domain) was removed from Vercel at the
owner's word; the site is https://thegcd.vercel.app (project `thegcd`, repo `eshin087/gcd`).

## 2026-11-25 — The dragon print: the world printed in the wyrm's digits, now the default (ADR-198; branch `render/ground-looks`, PR #125; planned by the lead, Opus agents built)

**Owner** (picked look B of the four): "i really like the dragon ground look ... it allows the ground to look 3d, can
help with background shadows. can we try this art style on not just the ground and things like the stone and other
textures? ... 3d looking grass with this style and still incorporate the player walking around and the grass
bending ... and the player cutting" (with PR #124's wake); Ashfall's footprints "very ugly ... last too long ...
cool subtle matrix flash footprints"; "ways to make the dragon ground art look even cooler ... show me". Asked:
both grass builds; floors, props, trees and every level's ground; matrix green; all four upgrades.

**What** (every piece behind its own switch, default off; `?dragon=1` = all at 'a'):
- The core `render/dragonPrint.js` (lattice, ramp `.:-=17402#%8@`, `DP_CELL` 0.135 x 0.25 m, `dragonLook`); look b of
  `world/ground.js` rewired onto it with hooks. The branch merges #124 (the wake) for the grass.
- Grass `?dgGrass=a|a2|b|c` (`world/dragonGrass.js`; the wake's GLSL shared once as `TRAIL_BEND_GLSL`): a printed
  tufts (`\|/` over digit roots, laid `= ~`, mown `. :`), b standing digit blades (the 3D blades on a lattice, each a
  column of lit digits, bend and cut as today), a2 / c extras. With any option the cut tops no longer fly (the green
  chips do); a / a2 / c also mow the scorch map's A from the arc.
- Floors `?dpFloor=a|b` (`render/dragonFloor.js` in `createCarvedGlyphMaterial`): every level, a lattice seen along the
  camera so slab walls sit on the ground's lattice, a lit lip one cell wide (`aRim`, `addSlabRims`), crack seams.
- Props / trees `?dpProps=a|b` `?dpTrees=a|b` (`render/dragonProps.js`, the art pass's prop branch): the ground's
  digits and light law in the art pass, relief (chisel, cracks, bark, leaf clumps), no camera key light.
- Upgrades `?dpCloud= ?dpContact= ?dpRipple= ?dpRidge=` (a | b; `render/dragonPrintFx.js`, `world/groundFx.js`,
  `groundFxTuning.js`): cloud shadows on the one wind, contact rings (baked from colliders and pieces, fighters as
  uniforms), a re-print ring from `world.groundBlow`, ridge strokes on lit crests.
- Footprints `?prints=a` (`render/dragonStep.js`, STEPS.flash): on a dragon-printed floor the cells under the foot turn
  to code, flash white-green heel to toe and are gone in 0.75 s; elsewhere code letters as particles.

**Tests.** New suites `groundfx`, `dragonProps`, `dggrass`, `dpfloor` (in `npm test`); each piece's agent ran world /
life / glyphcheck. Frame cost (shared, noisy machine): ground b ~+0.15 ms over today at 1440p, upgrades all on +0.43
there, floors ~+0.2, grass a ~+0.1 / b ~+0.2, props up to +0.3 where crowns fill the frame.

**Round 3** (the owner: "i like 'everything on' (grass A) much better than grass b ... make grass A be more 3d
while still feeling the same and the grass cuts actually look like the ground is cutting ... have the footprints
show in every stage ... make all the maps use the dragon ground style ... i don't want the leaves on the ground to
actually look like normal letters (C, S)"). Every piece at 'a' is now the default in every level (`?dragon=0` the
world before); the flash print lands on every surface; the sword's cut shows in the printed grass (`dgCut` b: a
fine cut map stamped from the arc, shorn tufts throwing their glyphs, a glow, a dark swath; tuned by the lead so
the swath reads at the game camera); three steps of more depth for grass a (`a3d1`-`a3d3`, a3d3 standing
billboards in `world/dragonTufts.js`) for the owner to pick; fallen leaves as a lit lens (`leafLook` a,
`render/dragonLeaf.js`; b in the ground's cells, c tiny letters). Tests of the looks before run under `?dragon=0` /
the piece's '0'; new `life` `steps.flash`, `leaves`. Main moved four PRs meanwhile (#124, #126, #119, #128-#129:
the game is now gcd); the ADR became 197.

**Round 4** (the owner: "lets go with the new default and make the grass ascii particles more smaller. its too
big right now"). Grass a stays the default; the chips a cut throws in the printed grass are scaled down (the code
chips 0.6 x, sized from the hidden blades they came from; the tufts' tips 0.7 x a print cell; `DG.cut.chipK` /
`tipK`; 0.5 / 0.6 was filmed too and the chips nearly vanished: small letters lose their ink). `?dragon=0` keeps
the 3D grass's chips as they were. Before that turn: the click / loop bug (#130: the faded title caught every
click) and the slow first load (#131: shaders compiled side by side, ~11 s → ~5 s cold here) were fixed on main.

**Open (round 2).** Weak by their builders' own account: the grass's wake and stubble read quietly;
Cinderwood's flagstones lose their crisp outline; the props / trees print darker than today (a second round is on it:
Ashfall's boulders and dead trees printed as outlines only); ridge strokes are faint. Docs (STYLE, ARCHITECTURE),
CHANGELOG and an ADR follow the picks.

---

## 2026-11-24 — Four ground looks to pick from (prototype; branch `render/ground-looks`)

**Owner:** "i dont like this ground artstyle/design as it doesn't seem like ascii ground ... think of 4 variations".

**What.** `?ground=a|b|c|d` (no parameter: today's ground, unchanged). `world/ground.js` gains the four looks in
the ground shader; the meadow's density is baked into a texture for them (`setMeadow`). A the letter meadow (grass
printed in the ground, one small upright letter per world cell, ~6 x 9 px at 720p; no 3D blades); B the dragon
ground (a lit bumpy source in fine digits, every cell filled); C tidy tufts (the 3D grass kept, one blade per
0.24 x 0.27 m lattice cell, one size, upright, even tone: `createGrass({ lattice })`); D wind-combed strokes
(`- / | \ ~` in long swathes along a slow flow field; no 3D blades). Today's soil letters measured ~13 x 16 px,
bigger than the hero's 5 x 8.

**Open.** The owner's pick. A, B and D hide the 3D grass, so the wind, trample, mowing and the cut tops do not show
there yet (burn and tears do, through the scorch map): the picked look needs those wired before it can ship. B is
busy near firelight on Ashfall.
## 2026-11-25 — The hero's name tag a little higher (ADR-196)

**Owner:** "make the font a bit higher as it's literally on the edge of the character": the "gcd" over his
head touched his hair. `HERO_TAG.over` (ui/nameTags.js) went from 0.55 m to 0.75 m over the head bone: the
gap above his hair is now about 11 px at the normal camera (it was 6) and about 5 px zoomed far out, still
riding his head bone, so it stays close in a roll. Checked in the browser at 1280 x 720.

## 2026-11-25 — The first frame's shaders compiled side by side (`render/precompile.js`; branch `render/precompile`)

**Owner** (testing a preview): "the preview links take a really long time on shaders to load the game for the first
time. is this normal?" **Measured** (headless Edge on the RTX 4090, the GPU's shader disk cache off: a first visit):
the boot reached `gcd:shaders` in ~2 s and the first frame ~6 s later; each program compiled as it first drew, one
after another, the art pass alone ~2.5 s in D3D's compiler. **Change:** the loading screen's last step starts every
program of the visible scene, the fx scene and the pipeline's passes at once (`WebGLRenderer.compile` per visible
object, a full-screen quad per pass; KHR_parallel_shader_compile), waits for them (30 s at most), then draws.
Hidden objects are left out. Cold load ~8 s → ~5.3 s (two runs each). `?precompile=0` as before; `game.precompiled`
{ programs, ms }. Safari without the extension: compiles queued as before, no wait.
## 2026-11-25 — The faded title caught every click (hotfix; branch `ui/title-clicks`)

**Owner** (testing a preview): "i cant press left or right click in the preview and it keeps looping me".
**Cause.** The new title (ADR-196, `?menu=c` default) fades with `.ab-title.off` (opacity 0) and should leave with
`.gone` (display none), but `.ab-title.gm { display: flex }` (titleMenuStyle.js, injected after hudStyle.js, the
same specificity) outranked `.ab-title.gone`, and its panels set `pointer-events: auto`: the invisible body
(`.gm-body`, `.gm-detail`, the worlds' buttons) stayed over the canvas, so mouse buttons never reached the game and
a click on an unseen world's fire travelled (a reload into the loader: the loop). Keys worked.
**Fix.** `.ab-title.gm.off` and everything in it take no pointer; `.ab-title.gm.gone` is display none. Checked with
real CDP mouse events on headless Edge: after Enter the point under the cursor is the canvas, a left click starts an
attack, a right click reaches the game, the page does not reload.

---

## 2026-11-25 — Every wyrm fire travels from it; roar-cast spells and a brood of fire; a forest you can walk into (ADR-197; planned by the lead, built by Opus agents)

**Owner:** fire "out of nowhere" must come from the dragon; new roar spells with "dragon incantation symbols" (mini
dragons, kamikaze ...); no invisible walls; more forest to rip and burn; good performance. Their picks (asked first):
visible trails, all four spells, walk into the forest, smooth on the iPhone. Branch `dragon/fire-forest`.

**How.** Stubs with the interfaces fixed, then four agents (fire, brood, spells, forest) in their own worktrees; the
lead merged them (no conflicts), made their seams (partPos 'point', the tuning merges, the director's brood rule) and
sent three back for a second round judged at the game camera (the serpent read as a band of fire, the firestorm as a
blob, the drakelings as winged flames, the forest's rim barely changed). Then a docs agent and an integration agent.
Lessons for the next pass: the stubs' ADR number was already taken on the base (renumbered to 195, then to 197 when main took 195 and 196 for the rename and the loading screen);
fire under ~1.5 m sinks into the meadow, a shape in the fire field needs many big cool blobs; seeded fight checks that
count cues a minute stop measuring once a long channel is in the mix.

**Verified.** Every agent's scenarios (firesource, brood, spells, forestedge, pressure, lab, breach, wreckage,
terrain), world and life suites, and the whole `npm test` on the final merge with `origin/main`; films of every move
at the game camera, before and after; perf A/B on headless Edge (desktop GPU).

**Picked.** The owner kept every default (incant a, drakeling a, serpent a, vortex a, forestEnd a, meteorSource
b, wallSource a).

**Open.** The phone's
fps on the device; the wyrm fighting at range in the forest; the drakelings' heads; grass fire knots after the
serpent; `world.restore()` alone leaves a hero out in the forest (the level's resets and the Lab's Restore respawn him).
## 2026-11-25 — The front: the sword's path, a loading screen, the hero's tag (ADR-196)

**Owner:** an ASCII loading progress with the gcd branding, a title where the stages are easy to pick; plan
it with Fable, Opus builds it. Three title layouts, two loaders and two HUD-name places were built behind
switches (an Opus agent) and shown as screenshots; the owner picked menu c (the sword's path), loader b (the
console) and no HUD name, and asked that the "gcd" over the hero's head not sit too far from him.

**What changed.** `index.html`: the loading screen, inline, first in `<body>`; the web fonts' sheet no longer
blocks the first paint. `main.js` boots in named steps (`BOOT` shares) that drive the bar through
`ui/bootLoader.js`. `ui/titleMenu.js` + `titleMenuStyle.js` + `gcdLogo.js`: the three layouts (`?menu=`,
default c), a CONTROLS panel for the long controls list, a 2D pad walk (`gamepad.js`), `flow.beginFromTitle()`.
Each level names its boss (`boss`). The hero is `player.name = 'gcd'`; his tag rides his head bone
(`HERO_TAG`): measured 3 px over his hair at the far camera, 6 px at the nearest, and it drops with him in a
roll (it lags the fast dip by up to 17 px for a moment, then sits close again).

**Verified.** The records suite's new `menus` scenario (every layout: keeper, best, select then travel, begin,
rush, news, CONTROLS, keys; no parameter → c, `?menu=0` → the title before); `npm run build`, and the built page
from disk shows the loader and boots; in the browser pane: the title comes up as the path, the loader as the
console, the tag reads gcd at both camera distances.

**Open.** Not seen on a real iPhone (notch, home bar) or with a real pad. The path will need to scroll or
shrink past about ten worlds. A background tab throttles the loader's timers (the fonts step can read long
there). The old title's `LOGO` (`?menu=0`) and `GCD_LOGO` are two drawings of the name.

## 2026-11-25 — The game is called gcd (ADR-195; Opus agent)

**Owner:** the game and its hero are now **gcd**, lowercase wherever a player sees it; the lore: a
mysterious being with the most powerful sword in all universes, the sword that beats the bosses and carries
him between campfires in different worlds and universes. New repo `eshin087/gcd`, new site
https://thegcd.vercel.app (the owner renames GitHub and Vercel after this merges; no redirect).

- **Renamed (text only, no behaviour):** the tab title (`gcd`, the stale "Ember Wyrm Demo" dropped), the
  start-failure text, WHAT'S NEW's header (`gcd v0.4.0`), the dev server's log line; the title `LOGO`
  redrawn as a small lowercase "gcd" in the same block / box-drawing face, six rows, every row 26 columns
  (the shimmer still finds its '█'); env vars `GCD_*` (suites, `tests/run.mjs`, docs); classes
  `gcd-touch` / `gcd-pad`, style ids `gcd-lab-style` / `gcd-training-style`, the hero-parts temp file,
  `.claude/launch.json` `gcd-dev`; storage keys `gcd.*` (no migration: the new address cannot read the old
  site's storage); `package.json` name / repo / homepage / description, the lock file's name; every doc,
  the credits and their generator (`build-sfx.py`: "made for gcd"). The Hall's and the Plaza's comments
  now describe worlds and universes gcd's sword carries him to. No player-visible boss or level line named
  the old world.
- **Kept:** the music track "Ambience of a Fallen Age (The Abyss)" by Umplix (its credit, its `trackList.js`
  comment, its source file `the_abyss.wav` in `build-music.py`, the ADR-117 track list): a credit stays
  accurate. The banners' block letterforms are unchanged (the logo's comment no longer claims them); the
  block-letter test now checks the face on GCD.

**Verified.** `npm run build`; a repo-wide `grep -ri` for the old name (only the track); the glyph
check (three storage / style consts lost their UPPER_CASE names: the check reads those as glyph strings and
'g' is not in the atlas); `npm test` ALL 27 PASSED. The title shimmer drew `Math.random()` once per '█'
a tick, and the seeded sims share that stream: the new logo (55 blocks, 118 before) moved every seeded fight
and five jobs failed on their margins (`city win`, `city pace`, `sheath`, `woke`, `duel`). Now the sparkle has
its own xorshift, and the title still draws the first logo's count from `Math.random` (its blocks per column,
`STREAM_COLS`), so no logo or title layout can move a fight; the sims replay as on main.

**Open.** After the merge the live site's saved data resets (new keys) until the address moves; the title
screen's layout is being redesigned on another branch, which will meet this LOGO change.

---

## 2026-11-25 — The grass bends round the hero's wake and springs back (ADR-193; Opus agent; PR #124)

**Owner:** "when the player runs through the grass, the ground/grass around it becomes too dark too
quickly and doesn't look natural and bad transition. make the grass bend and come back to normal after
the player moves through it"; three options filmed; "Ship both".

- **Found:** every footfall wrote a full trample into the scorch map's blue (0.625 m cells, blades every
  way, up to 0.7 darker at once, 10 s linear); a dark band still plain 3 s after he passed.
- **Built:** `world/grassTrail.js`, the hero's wake as 32 points in a uniform array; the grass shader's
  `trailBend` bends each blade along his way and out from the path and springs it back (b: hold 0.35 s,
  rising over 2 - 2.6 s, at most 10 % darker); the steps write no blue while it is on, a sprint or a
  landing presses a wider wake. `?bend=a|b|c|0`.

**Verified.** `world.mjs . all`, `life.mjs . core,steps` (new `steps.wake` / `steps.noTrample`: bends
along and outward, recovers by its time, darkens no more than its limit, no per-frame pops, a reset leaves
nothing bent, `?bend=0` writes no wake), the glyph check; the seeded wyrm fight's trace byte-identical;
films at the game camera, close and on the phone view.

**Open.** The boss's pushers have no wake; the phone's frame cost on the device.

---

## 2026-11-25 — The sword's cut throws green code (ADR-192; Opus agent; PR #120)

**Owner:** "Im playing the live game but not seeing the grass cut"; then "make the grass show ascii like
grass particles when its swung at"; four rounds of previews; "Ship both".

- **Found:** the cut worked on the live site (632 blades in a short fight) but read only zoomed 4x.
- **Rounds:** a spray of house-letter grass strokes in three strengths (the owner: a); chips of each
  blade's own letter in its own colour (liked); "the matrix ascii art instead of actual grass": code
  glyphs from the Hall of Falling Script's set, with and without trails and dissolving tops (the owner:
  m); m tinier and calmer (0.4 - 0.55 of a blade, a green a step toward the grass's, a 0.18 s bright
  phase, a slower flicker, settling to the grass's darkness within 0.35 s), with a brighter, larger
  version on the phone. All looks kept behind `?grassSpray=`.
- **Numbers:** about 45 - 85 glyphs a swing at quality 1; about 0.05 ms a frame.

**Verified.** `world.mjs . all` (the `tops` scenario: the default throws about 0.5 chips per cut blade,
none left 3 s later, `grassSpray=0` builds none), `life.mjs . core`, the glyph check, the seeded wyrm
fight's trace byte-identical to main; films at 1x on desktop and the phone view.

**Open.** Not judged on the phone's own screen; the boss marks throw no code.

---

## 2026-11-24 — The idles, round 2: the sword arm as picked in every rest; three sword spells (ADR-186 amended)

**Owner** (on a still of the `hilt` rest beside the belt): "some of the new idle animations have worse unnatural
poses or angles ... the old one was holding the sword correctly in both angles. analyze all the new idle animations
and ensure it all looks good and natural. also add more dynamic interesting cool idle moments like the main character
casting some kind of cool subtle spell with his swords, to make the player curious about the true power of the sword".

**Audit** (every rest, habit and trick at the game camera and from the side and front, strips and full frames):
- `hilt` (both hands on the hilt before him): from the game camera behind him the blade vanished behind his body, and
  the wrist turned the steel out of the fist. Dropped.
- `trail` (the blade low behind him): the sword wrist bent 50-60° off the forearm. Dropped.
- `flip` (the reverse-grip flip): the wrist folded to 143°. Dropped.
- `regrip` brought the blade before him with both hands (hidden from behind): now the grip eases and closes where the
  blade hangs, the blade turning a quarter and dipping through the fingers, the free hand shaking out.
- Rule kept from now on: every rest keeps the at-ease sword arm the owner picked (ADR-114: the blade on the forearm's
  line, out at his front-right); the rests change only the free arm, the weight and the head. New: `fingers` (sword
  fingers low by the hip, guard()'s old rest) and `cloak` (the hand at the cloak's edge on his breast).

**Spells** (idles.js SPELLS, drawn by `swordMystic.js` from `anim.spell`; motion alone with `?mystic=0`), in the
trick pool: the **rite** (the blade raised beside his shoulder, his sword fingers drawn up the flat, the flame burning
up behind them and embers lifting off the point), the **sigil** (the point lowered, a ring of the flame's marks written
round him at knee height, fading together), the **breath** (the blade upright, head bowed, the flame swells and a
thread of marks circles him once and a half and returns into the steel). In the flame's own tiny green letters: a
ring of 52 read as specks at the game camera, 150 (a mark every ~3.5 cm) reads as a line; on the ground or at the
shin the grass hid it.

**Measured.** Rests: the sword wrist ≤ 17° in all four (was 28-64° in hilt / trail), elbows R ≥ 128°. Actions: the
blade ≥ 16 cm off his body; the rite's free forearm lies 5 cm from the flat (its fingers are on it, as the inspect's).
Every move from every rest and from inside every action within the stance before (at ease: run 9.0, light 80, roll
41, block 53, drink 6, charge 13 cm a frame²). Left alone 90 s: 17 actions, 4 of them tricks or spells, all four rests.
Suites: heroidles, swordmystic, herolife, herohand, heroarms, herostance, hero, herolook, lord `moves`.

**Films:** the close review (before | after, game camera over the close side view) and the in-game one (the whole
720p frame at the real game camera), both re-shot.

---

## 2026-11-24 — The run's free arm: three carries (ADR-187; branch `claude/hero-run-arms-2e2cb5`)

**Owner** (the hero motion pass, three sessions: idle, the run's arm, the light chain): "when he runs i want him to
have his left hand in a natural running pose"; asked which, "show me all 3 variations".

**What.** `player/runArms.js` (new): the free arm on the run as joint angles posed by forward kinematics (the
shoulder's swing, how far it stands off his side, the elbow, the forearm's cross), so blends travel round the
shoulder instead of through the ribs. A natural (a runner's swing, a pump at a sprint, the hand open and loose),
B the swordsman's dash (swept back and out behind him, riding the stride; forward only, a strafe swings as A),
C by speed (A, sweeping into B as the sprint builds: the default). `?runArm=a|b|c|old`, the Lab's PLAYER row
`run arm`. Four lines in `loco()`; the sword arm, the legs and `stand()` untouched (the dash adds 0.05 rad of chest
lean).

**Measured** (`herorun`, every carry through one course against `old`). The free elbow on the run 75 – 119° (old
85 – 141°), working 44° a stride, flare 0.27 (0.35); a strafe 83 – 112° with the hand 30 cm fore and aft; A's
sprint pump 63 – 111°, the hand 42 cm up and down. The dash: the hand 11 cm behind and 38 cm out (past the cape),
riding ~10 cm. C's sweep into and out of the dash: wrist jolt 2.6 / 1.5 cm a frame², the hand ≤ 4.6 m/s. Out of
the run into a light, a roll, a block, the flask, a turn: within 3 cm of the old jolts (a light and a roll less).
How B was found: stills from three sides of five sweeps; straight back the cape hid the arm, shallower read as a
hand hanging at the hip.

**The free hand's look** (2026-11-25, owner after trying A: "the animation looks fine but the left hand size and
color is standing out too much"). The hand was the face's skin ink (gain 2.2) at the gauntlet's 1.12 size beside a
near-black sleeve. Five looks rendered live, then built behind `?handLook=0|a|b|c|d` (`gear/handLook.js`; the Lab's
`hand` row reloads): today, × 0.8, × 0.8 with the skin fill at ~half (`handShade`) or ~a third (`handDark`), a
× 0.85 leather glove. The owner tried them on the preview and picked **a, smaller** (now the default; `0` the
hand before). The two darker materials are built only for their look, so seeded fights do not move.

**Reverted and re-shipped with A** (2026-11-25). #117 merged with `c` (by speed) as the run arm's default; the
owner had approved `?runArm=a` on the preview, and in production: "the new one looks really bad. it doesnt seem to
be the one i chose". #122 reverted it; this PR brings it back with `a` (natural, the pump at a sprint) as the
default and the smaller hand. My error: I kept my own recommendation as the default after the owner tried another.

**Open.** Out of the dash into a roll or a block the arm comes forward inside that clip's short cross-fade: the
free elbow jolts 24 cm a frame² (old 13). The roll's and the block's entries are outside this pass. The owner's pick
of the four (films in this session's scratchpad `rig/out/`).

---
## 2026-11-25 — The streak's answer: a heavy first cut, a path that flows, a figure each time, cuts that tear the picture (ADR-190, ADR-191; planned by Fable, built by Opus agents)

**Owner, round 1:** "the new perfect dodge/parry streak effect right now looks too fast in the early streaks. something about it just looks not epic/stunning. review it and make it look and fell good. plan it out with fable and have opus agents do the work". Asked which part and where: "All of it, you judge"; "Both" (men and the wyrm). **Round 2**, after the clips: "make sure all the white slashes that show up is accurate to how the character moved. theres a random 2 curved slashes at the end of the combo that appears out of nowhere. also the streak animation and movement shouldnt have to go back to the original place ... A - B - C ... also replace the explosion "A" effect with something more cooler ascii smaller character detailed explosion. i also want the slashes to look like its ripping time in a cool flash instant. make different variations". Asked: all four rip ideas built to compare, "White-steel letter dust", no reference clip ("you decide"). **Round 3:** "make the streak not always form some kind of star ... always be dynamic with different figures". **Pick:** from one comparison film, "strip". Branch `combat/streak-pace` (+ `combat/streak-rip`, merged in).

**The review** (film strips and hit frames at 60 fps before any change). A flash cut on a man was 0.35 s with its wind-up on screen for two frames (0.25 s round the wyrm's head, none seen); the first cut landed 0.12 s after the dodge; ADR-167's storm began at a fixed cut (the third on a man) whatever the streak, so a streak of 4 or 5 was two full cuts, one or two blips and the art. Every cut teleported him to a fresh point on a ring round the target, and the art began at the foe's front, which faces the dodge spot: A, B, back near A, C. On the ground the hanging line ran through the foe while he ran 0.55 m beside it; the iai art spawned two 5 m crescents to either side of the target; the last blow reused the heavy slam's big `A ^ V` kite shards.

**What was built.**
- **The tempo** (ADR-190; `DEFENSE.flurry.tempo`, `?tempo=0`): the first flash cut is a heavy beat (seen wound up 0.11 s, 0.08 round the head, which now has a seen wind-up; the dash at its old speed; the contact held 0.11 s; the finish held 0.15 s); each later cut takes a share `r` of the one before, 0.78 for two flash cuts down to 0.52 for six; a storm cut is one whose pace is under 0.4; weight falls with the pace; a riposte's last cut is the heavy beat again.
- **The chain** (ADR-191; `DEFENSE.flurry.chain`, `?chain=0`): each pass starts where the last ended and the art starts where the last pass ended (pass-to-pass jumps 0.00 m on the ground; the old art jump was 4.2 - 5.5 m in one frame on film). Every hanging line is the segment his chest ran (1.2 m over his root); the cut's stroke, star and sparks sit on his path; the two iai crescents and the cuts' crescents are gone; the split / vault crescent follows his blade tip. The last blow's shards are **white-steel letter dust** (about 104 letters, none over 0.09 m, under the bloom).
- **The figures** (ADR-191; `player/flurryFigures.js`, `DEFENSE.flurry.chain.figures`, `?figure=`): star, zigzag (from 3 blows), cage and spiral (from 4, men only: round the head a side always crosses the neck), cross (from 4). One a flurry from the flurry's seeded stream, never the same twice running; a figure that does not fit (walls, the neck, the dodge spot nearer than 1.6 m) falls back to the star. On a man no pass runs nearer than 0.55 m to his middle (ADR-101's rule). A fan was tried and dropped (it cannot stay chained).
- **The time rip** (ADR-191; `player/timeRip.js` `TimeRip`, `game.fx.rip`, `?rip=`; a cut band in the ASCII pass: `uCutN / uCutA / uCutB / uCutTone`): four looks of a flash cut, each on the line the blade ran: **strip** (the owner's pick, the default: for three frames the letters 3 cells either side of the cut print shifted 4 / 3 / 1 cells along it, each side the other way, a steel seam on the line; displacement only), **tear** (a hairline, then the cut splits open a beat later; the flurry's own line is held back meanwhile, `L.hold`), **ghosts** (2 - 3 sparse still copies of him along the pass, never over the boss, torn after 0.12 s), **negative** (a 1 - 2 cell strip prints its letters dark on pale for two frames).

**How it was built.** Fable reviewed from film and hit frames, asked the owner, wrote each brief. Opus agents: the tempo; the chain, true lines and dust, then the figures; the four rips (in their own worktree, hooked in through events so the two merged cleanly), then a fix round from film (negative printed flat white blocks: its tone read the whole cell, not the letter's mask; ghosts were a wall of digit columns; strip was a 100 px piece for two frames); a filming agent built `filmall*.sh` in the scratchpad (headless Edge on the GPU, every tick at the game camera, before / after and 2x2 grids at native letter size, true / half / quarter speed). The lead merged, fixed the tear's held line, pinned the seeded tests, wrote the history.

**Measured** (frames at 60 fps from the flurry's start, Ash Disciple, Passing Cut): streak 2: first cut 8 -> 14, last blow 62 -> 73; streak 4: 8 -> 14, 95 -> 116; streak 7: 8 -> 14, 112 -> 113; riposte of 3: 8 -> 14, 51 -> 76. Round the head, streak 7: last blow 105 -> 101. Damage, posture and blows unchanged everywhere (asserted).

**Verification.** New scenarios: integ `chain`, `timerip`; duel `tempo`, `chain`, `timerip`; `tests/integration/figures.mjs` (each figure's shape at every offered N, chained, clear of the dodge spot, past a man's side; 20 seeded flurries of five pick 4 figures, none twice running; `?figure=star` keeps the frames). Every switch off reproduces the frames before it (pinned). The full `npm test` passed (21 of 21) after the rips' fixes and again after the figures, on the branch before main was merged; after the merge: see the PR. Seeded fights that hold a flurry replay differently with each change, so four scenarios now replay theirs with the old paths and are commented why: integ `breach` (tempo off), city `win` (chain off), integ `pressure` and `storm` (the star).

**Found and left.**
- integ `breach` on the tempo's seed path showed the wyrm's `pounce` 0.5 m past its share of a gap in the tree wall (not clamped to `boundAt`, not in `BREACH_AIR`). Open.
- The main checkout's `node_modules` was emptied twice during the session (once by an agent removing a comparison worktree through the junction; once by something outside this session's work); reinstalled with `npm install` both times.
- On film the figures are 100 - 200 px across at the duel's game camera; round the wyrm the first two passes are the same in every figure. The step into the storm round the head (24 -> 11 frames at a streak of 7) and a riposte's last freeze (0.198 s) are still to be judged in play.
- Nobody has played it; the clips show the canvas only (no HUD), at 1280 x 720, not on the iPhone.

## 2026-11-25 — The resting blade no longer glows (ADR-183; branch `render/sword-neon-wisps`)

A white halo the size of the hero's head bloomed round his sword at some poses and facings while he stood still (and a
pale block where the point rested in the grass). Cause: the world grid's creature-grid branch (alpha < 0.46) ran before
the art / prop test, and the player's own pixel window (0.42 – 0.45) sits under that bound, so a world cell centred on
his blade printed the steel's raw HDR colour. The art / prop test now comes first (`render/pipeline.js`). Found while
filming the sword options for ADR-182 (closed PR #105); PR #114 shipped the flame without it. Measured before / after at
the game camera: 17 – 49 px over the bloom threshold round the resting blade, then none. Verified: the whole
`npm test` and `npm run build`.

---

## 2026-11-24 — The hero's idles: rests, habits with both arms, sword tricks; the guard hand off the belt (ADR-186; branch `claude/hero-idles-2776d8`)

**Owner:** "make the main character and several idle positions instead of having the same holding his left hand on his
hip all the time. i want him to move both his arms around naturally and doing cool sword tricks during idle". Asked by
the lead: a MIX (mostly natural habits with both arms, a flashy trick every few cycles); BOTH stances, the fight
tighter with the hand off the belt and no big tricks. One of three parallel sessions (idle, run arm ADR-187, lights
ADR-188), each in its own region of `anim.js`.

**What.** `player/idles.js` (new) layers three things over the two stances (`stances.js`, `stand()`):
- **Rests** at ease (`loose`: the free arm hanging, the hand open and heavy; `hilt`: both hands low on the hilt, the
  point to the grass; `trail`: the blade low behind his right side; `belt`: the hand on the belt as before), one held
  7 - 12 s and changed over 1.3 s. In the guard the free hand leaves the belt for one of four (`point`: sword
  fingers at the foe; `eye`: beside his face; `hand`: an open guard hand; `low`: floating by the hip), 4 - 7 s each.
- **Habits** with both arms at ease (re-grip, the shoulders, flex the free hand, brush the coat, plus the old look
  and inspect), and in the guard small ones (grip, guard shift, loosen, beckon, a flick of the point), locked on too.
- **Tricks** every 3 - 4 actions at ease, never in a fight: the wrist spin, the figure-eight, the salute (the blade
  upright before his face, palm over fist, a bow), the chiburi flick, the reverse-grip flip.
`?idles=old` (and the Lab's PLAYER `idles` row) is the belt with the six old actions; the `idle ▸` row plays any
rest or action now. Scenario `heroidles`.

**How it got here (measured, not judged from stills).** Every rest and action measured in his own frame: elbows,
the sword wrist, the drawn blade's gap to body and arms, the coat sheets, the point over the grass, the free hand,
the pop audit; and every move (run, light, roll, block, drink, charge) from every rest and from a third and two
thirds into every action, against the stance before. What the numbers threw out:
- A fifth rest, the blade carried on the shoulder: the elbow at the fold limit (43°), the blade 1 cm in the torso,
  and leaving it for a run / roll / charge swung the point 0.7 - 1.4 m a frame. Dropped.
- The guard hand raised over his head: the free elbow whipped down 0.4 m a frame into a block or a charge. Now
  beside his face.
- Actions that swing the blade started from the trail rest crossed his body: they start only from a low rest (a
  trick due in the trail first moves him to the loose rest). The blade keeps its way round through an action
  (`dirLerp`'s memory): a spin's target past the far side flipped the sweep.
- A block's own 0.08 s entry from a blade far round him (the trail, the spin's high back quarter) took the way
  behind his head through the wrist's limit: 1.0 - 1.8 m a frame. At ease only, out of a trick or the trail, a
  block, a drink or a charge now enters over 0.24 s, and the spin's plane leans out 46° (its high back quarter now
  goes round the front).
- The pass behind his back to the left hand: the sword is the right hand's alone (`apply()` poses it from the sword
  arm), and from behind his back a block's entry turned the blade past the wrist's limit (1.5 m a frame). Replaced
  by the salute; a true hand-off needs a rig change (follow-up).
- The old lean on the pommel whipped a light from it by 1.4 m a frame (as before this pass): kept for `?idles=old`.

**Measured (worst, cm a frame²; the stance before: bare / with its old actions).** At ease into a run 9.6 (1.2 /
12.4), light 80 (61-80 / 195), roll 38 (29 / 201), block 54 (53 / 98), drink 10 (4 / 24), charge 14 (9 / 22). In
the guard every move within the bare guard's own (light 80 / 72-80, roll 25 / 25, block 23 / 21). Rests: elbows
R ≥ 95°, L ≥ 53°, the blade 19 - 54 cm off his body; actions: the blade ≥ 11 cm off his body (the salute's upright
blade before his cheek), never through the coat, pops ≤ 8 cm. Left alone 90 s at ease: 17 actions, 4 of them
tricks, all four rests; 40 s in the guard: 9 habits, all four guard hands, no trick.

**Films** (sent to the owner, before | after, the game camera over a close side view, half-speed copies): the
scratchpad's `rig/out/idle_explore`, `idle_fight`, `idle_cuts` (.mp4, -half.mp4).

**Open.** The owner's taste on each rest / trick (the films); the behind-the-back pass needs the sword to change
hands (a rig change); the block's / roll's / charge's own short entries out of a far blade (outside this session's
files; the run session saw the same with the free arm); on-device feel unverified.

---

## 2026-11-24 — The bosses printed the hero's way (ADR-194; branch `render/boss-hero-ink`)

**Owner:** sent the hero at the game camera: "the bosses need to look more like my character look where my character
looks like its all built with ascii ... i especially love the gray colored details to make the bottom of the cape look
flowing and to show different shades on the upper top ... show me what the bosses would look like". After the first
sheet: "im not really seeing the difference besides a reshade". After the second: "Yes, own colours".

**Finding.** Six of the seven human bosses already print in the hero's ink-line art, same letters and cells. Apart
were their fills (flat dark: the Lord and Xin Yi a faint `+` mass in a thin bright outline; flat bright: Wen Yao,
Halcyon), the outline (a 1 px hairline; the hero's steps with his font pixels), the plate rims (white; his dotted
lavender) and the hem (none). Lu Wusheng printed in the wyrm's digits.

**What shipped.** `?bossPrint=0|a|b` (b default). materials.js: the shared `uBossPrint` lifts every boss part's fill
(3 - 16) to the hero's lit body in the shader (so forms, phases, clones and the Lab all go through it) and prints the
cloth below the knee as the hem part along a ragged line; `SG_HERO_SELF` keeps the player out. pipeline.js
`uBossLike`: his lines per font pixel and the player's tables for plates 12 - 16 (not the blade, which the hero's
cuts light). main.js writes both every frame (the feet followed). `sheathArt` default a. Lab LOOKS row.

**How.** Prototyped live (a scratch module patching each boss's `uArtFill` + a per-material hem uniform), rendered
at 1920x1080 in headless Edge, the game's 58 degree camera from 36 m, crops x4; then moved into the shaders and
rendered again against `?bossPrint=0`: the same as the prototype for all seven.

**Open:** the owner has not seen it in play or on the phone. The wyrm, the props and the animals are next in this
direction (their own art paths). The bosses' slimmer outfits still show fewer letters across than the hero's cloak.

## 2026-11-24 — Session 92: smaller combat text

**Owner:** "the combat text that shows up next to the character (counter, deflect, dmg numbers, etc) size and font
changed. make it look small like the original version before it got much larger." Branch `claude/combat-text-smaller`.
ADR-184 / M1.81.

**Finding.** No commit had changed the call-out CSS since v0.2.0, and the live site drew the same font (JetBrains
Mono, loaded) at the same sizes as the dev server. The owner plays on desktop; the sizes were `clamp(.., vw, ..)`,
so a wide window grew them (1920 wide: DEFLECT 22 px, CRIT 19 px, the cut counter 34 px). Three options were
rendered at 1920x1080 in headless Edge (A today, B about two thirds, C HUD size and lighter); the owner picked B.

**What shipped.** `src/ui/hudStyle.js` only: fixed sizes, call-outs 11 / 12 px (BLOCK 9), numbers 10 / 11 / 12 px,
the cut counter 15 px, letter spacing 0.2em. Measured after: identical at 1280x720 and 1920x1080.

**Note.** This checkout had no `node_modules/` (the dev server answered 404 for three, so `__game` never appeared):
`npm install` fixed it.

**Open:** not yet seen by the owner on their own screen or the iPhone.
## 2026-11-24 — Faster PRs: CI's long checks split, auto-merge on every PR (ADR-185; branch `build/ci-faster`)

**Owner:** "it takes a while for new changes to get pushed through. is there anyway to speed up the prs to be
merged faster without sacrificing anything important?" → "yes split it and also have every pr set to auto merge
automatically".

- **Where the time went:** CI 8 - 10 min, set by one task (`lord fxlooks`, 539 s; the other shares 3.7 - 7
  min), then `life` (430 s). One run took 42 min because a share waited 33 min for a runner (GitHub's
  concurrent-job limit with several PRs open). Most of a PR's life (0.2 - 17 h) was waiting for the merge.
- **Split:** lord.mjs `GCD_FX` parts; fxlooks' TERRAIN-under-every-look check (about 90 % of it) runs one
  look per process; life.mjs `GCD_SKIP`, its files in three processes; every est in run.mjs re-measured.
  Locally (32 cores) fxlooks went from 248 s to its longest part 84 s; every part passed on its own.
- **Auto-merge:** `.github/workflows/automerge.yml` runs `gh pr merge --auto --squash` on opened / reopened /
  ready PRs (same repo, not draft, no `hold` label). CLAUDE.md's PR rule now says so.
- **Next / open:** confirm the CI wall on this PR's run (expected ~5-6 min). A PR behind `main` still needs
  `gh pr update-branch` (a bot push starts no CI). The open PRs before this one (#112, #113) were opened
  before the workflow and have no auto-merge unless set by hand.

---

## 2026-11-24 — The Cinder Wyrm's wake without the neck twist; its head from above (ADR-189)

**Owner:** "when the fight starts the dragon does an unnatural neck twist as it wakes up. make it look natural and
good transition when its waking up. also i really like how the dragons face looks like from the side ... but from
the top center view, the dragon head looks goofy." Branch `dragon/wake-and-face`.

**The twist.** Filmed the intro from fixed cameras with per-frame numbers: in `rise` the head's heading went round
~330 degrees in half a second and turned upside down. The combat stance's resting S (`s.rest`) faded in on the pose's
sleep target while the neck was still curled back along the flank, and the two chains were blended point by point.
Now the resting S waits for the curl (`WAKE_REST_SLEEP`): heading within +-30 degrees, head upright, all the way up.

**The head from above.** Hiding materials one by one showed the cause: the pale bone (brow, horns, cheek fins) makes
one big V from above, and the eye glints sit as two round dots. Three tops rendered (`docs/looks/wyrm/`); the owner
picked C: no glints, dark obsidian horns / fins / brow (a `horn` material of its own), horns slimmer and swept
tighter, a dark crest. `?wyrmTop=0|a|b` and the Lab's `top` row keep the rest.

**Verified.** Films and numbers in headless Edge (a before / after clip went to the owner); the default build
checked in the page (top c, glints off, the Lab row); `npm test` and the build.

**Found by the tests.** The dark horns add a material, and three.js draws its ids from `Math.random`, so the seeded
fights ran differently (the memory note on seeded RNG). Two old edges came up: (1) the pounce's hop could land its
root 2.4 m past its ground beside a gap in the tree wall and stand there through the next blow; the landing now
settles the root on its ground (`d._collide()`, attacks.js), and the breach check counts the hop's active phase as
in the air, like a leap; (2) the terrain fight's world reset (every 30 s) takes back a piece still in flight, so
its flash never comes: the check now excuses a tell open at a reset. The draw budget for the drake is old + 2.

**Open.** The owner has not played it. The eyes without the glint are smaller at the game camera: if they read too
little, brighten the slits rather than bring the dots back. The phone view is not checked.

---

## 2026-11-24 — The sword's green flame (ADR-182; branch `player/sword-green-flame`)

**Owner, over a day of rounds:** "i also want his sword to look a bit more mystical in a subtle way" → of four readings,
the wisps "but with neon matrix color effect" → "not wisps but like a fiery subtle flame cool ascii effect on the
sword" → "make the sword color matrix green" → "more cooler flame enveloping the sword ascii looking" → "the glow is way
too big, make the ascii characters much more smaller" → "A: tight" → "lets move forward and merge it".

**What.** `player/swordMystic.js` (new): every cell touching the steel on screen burns on its own beat (never the
steel's cell, never over his torso), marks boil, tongues climb off the top, strokes lick off the steel and climb cell
by cell; denser, hotter and paler toward the point with the streak. Drawn in the hero's own 3 × 3 micro letters on his
4 × 4 px grid through a `LetterBatch` that takes the pipeline's hero atlas (`glyphs.js` gains `pixelArtOrder()`). Why
not the fire field (the house rule for burning effects): it has no green and prints world-sized letters; in those
letters the flame was as wide as his head. Three hook lines in `player.js`; Lab row `mystic` (off / flame); scenario
`swordmystic` (on by default; off = today's blade frame by frame, nothing built; his marks only; budgets; green; colour
× alpha at most 0.9; growth by tier; nothing after death; its setup gives the harness's pipeline a frame size).

**How it got here.** The flame was built on the hero-styles branch (PR #105, which the owner closed unmerged while this
was being merged into it); this PR carries only the flame: the move styles, the growing arc (`?arc=`) and the
resting-blade halo fix (ADR-176) stay on that branch. Films, one video per round: the scratchpad's `neon/clips/`.

**Measured.** Brightest pixel before the tone map 0.76 (tier 0) / 0.93 (tier 5); about half the flame's pixels are over
the 0.55 bloom threshold, so the marks carry a small halo. The owner approved the video with it; `GREEN` is the knob.

**Open.** The streak aura's rim is red beside a green sword (ask the owner). Phone frame rate unverified.
## 2026-11-24 — The grass cut, redone: cut under the drawn arc, the tops thrown, quietly (ADR-180 amended; Opus agent)

**Owner:** "the grass cut doesn't look good ... redo the grass cutting and show me previews"; then "i
like the sliced look the most but make it more subtle and right now it doesn't do the cut animation
where the sword goes"; then "looks right and i like the thrown effect the most but make the thrown
effect more subtle". Same branch, PR #109.

- **Round 2** (`world/mowFx.js`): each cut blade's top, its own letter in its own colour, leaves on the
  frame its stub shows; three looks behind `?mowLook=a|b|c` (thrown, sliced, shred; `r1` the first round).
- **Round 3, the cut follows the swing.** Measured per frame with a debug overlay: the cut was a map
  cell's share of blades scattered round the steel (30 – 65 a frame), and the height gate let only 3 – 4
  of a light cut's 11 arc frames cut anything, at the ground point under the steel, not under the arc
  the camera shows. Now `player/fx.js` `trail()` hands each edge stroke to `cutArc`: blades within
  0.275 m of its view-ray footprint are cut, one byte per blade in a texture the grass shader reads by
  `gl_InstanceID`. Cut blades sit a mean 4.6 px from the arc's stroke at the game camera; an arc that
  stays high cuts nothing. The sword no longer writes the scorch map's A (only `r1` does); marks still tear.
- **Round 4, thrown and quiet** (`GRASS.fly.throw`): half the tops tossed, `up` 1.7 – 2.7 m/s (was 2.8 –
  4.8), `fling` 0.9 – 2 (1.6 – 3.6), `spin` 2 – 6 rad/s (5 – 13), light × 1.15 (2.3), lie 0.7 – 1.3 s (1.6 –
  3.2); the rest topple off. About 130 tops a swing at quality 1 (65 thrown), 48 at 0.5.

**Verified.** All 21 suites and the build; `world.mjs` `tops` (the arc cuts exactly the blades within
w / 2 and no cell, a high stroke cuts nothing, a throws about its share, no brighter than the grass, gone
in 3 s, reset); the seeded wyrm fight's trace byte-identical to the base; films side by side per round.

**Open.** Lying tops do not move with the wind; a stub does not spring; the 256 KB cut texture's upload
on a phone (only on frames something is cut) is not measured; the `f_stoneCell` shader warning on load
is older than this work.

---

## 2026-11-23 — Three more: grass the sword mows, lamps that light with the fight, the living world heard (ADR-180; planned by Fable, built by Opus agents)

**Owner:** "what else do you recommend to make the world and background more alive and interactable to
make the fight seem cool"; given eight ideas: "Build top three". Branch `world/alive-three`.

**How.** The lead wired `life.sound`, an empty `LIFE_SFX` table and a `lamps` stub; three agents
(GRASS, LAMPS, SOUND) built in their own worktrees and ran only their own suites; the merge had no
conflict; the lead connected the seams (the lamps' sounds through `lifeSay`; the old 'wear' creak gives
way to the new `treeCreak` while the air is on, or both played; the Throne's outskirts keep a
lantern's `lamp` mark) and ran the whole set once.

- **Grass.** The scorch map's A channel is torn grass (`tear`, `tearLine`, `tornAt`; only where grass
  grows; never R / G / B; `?mow=0`). The sword mows along its ground path where the steel passes low
  (lights skim the tops, low chops and the cleave cut lanes about 1 m x 3 m, stabs pass over); cut tops
  fly. Every floor mark tears its own shape out, so marks finally read on grass (the wyrm's three claw
  gashes do). The seeded wyrm fight's trace is byte-identical.
- **Lamps.** Ashfall's four lanterns, Foxfire's ten, the Grove's two (and the Ring's braziers, which
  already burned) kindle by level: a few at the start, more at each phase, nearest the boss first;
  fire near one lights it; a blow nearby makes it gutter; a broken one goes out in a puff until the
  reset. Orange everywhere (foxfire blue vanished into Foxfire's stone and is the boss's colour).
  Low lights in the pool: a lamp takes only a free slot and fades in and out.
- **Sounds.** Ten synthesized one-shots (flock burst, animal bolt, tree shudder and creak, dust,
  pebbles, leaf skitter, lamp catch / gutter / out), per level, rate-limited, quieter in the fight,
  measured offline against a footstep and a swing; an audition page for the owner.

**Verified.** The whole test set (21 suites) and the build on the merged branch; `world.mjs` `mow`,
`life` `lamps` and the air's sound scenarios; films of the mowing, the marks on grass and the lamps.

**Not verified / open.**
- Nobody has heard the sounds; the owner judges on the audition page.
- The mowing reads calm at the game camera; after a fire-heavy fight burnt ground dominates; the flying
  cut tops are barely visible; the flurry does not mow.
- A lantern's flame is a few letters at the game camera; the gutter's lean does not read (its dip does).
- The Ring's braziers are low lights also with the living world off.
- Not looked at on the phone except for page errors.

---

## 2026-11-24 — The record looks picked; the record panel's border holds every row (ADR-179)

**Owner:** picked the grade's look `a` and the title's `b` from the sheets on PR #108, and reported that on
the record screen some rows ("Total time", "Flasks used") sat outside the panel's border.

**What changed**
- `ui/recordLooks.js`: `REC_LOOK_DEFAULT` is `b` (the grade was already `a`); the others stay behind the
  switches. With `b` the phone's title in landscape grew to three rows of stage buttons and pushed the
  logo off the top: on touch in landscape the buttons are tighter now (two rows again, nothing outside).
- `ui/hudStyle.js`: the record panel with a grade is centred by margins at its rows' width (max 94 % of
  the screen) instead of `left: 50%` and a shift (a box there may only grow to half the screen: the
  cause); its columns may shrink; a label that cannot fit ends in an ellipsis.
- `tests/integration/records.mjs` (`screens`): the shipped looks are the picks; the title with no
  parameter draws `b`; the panel's rule is guarded (layout is not measurable headless).

**Verified:** measured in headless Edge (every row's box against the panel's): before, 5 - 31 px out at
1280 x 720 (looks b / c), 1024 x 640 and 852 x 393; after, 0 at those and at 1600 x 900 and 393 x 852, every
look, and the rush's record. The title with no parameter: nothing outside the window at 1280 x 720,
852 x 393 and 393 x 852. Pictures: `docs/looks/records/panel-overflow-before-after.jpg`, `title-shipped.jpg`.
`npm test`, `npm run build`.

**Open:** the owner on a real iPhone (both ways up) and with a pad; a full rush played by a person.

---

## 2026-11-23 — Grades, saved bests and a boss rush, shaped for online leaderboards (ADR-179)

**Goal** (planned with the owner by another session; their three calls are final): saved records,
grades and a boss-rush mode, stored so online leaderboards can come later without changing what is
saved. A grade is CLEAN PLAY (deaths, the winning attempt's damage; time only orders a grade); in the
rush health and flasks refill and a death retries the boss with the clock running.

**What changed**
- `game/rank.js` + `rankTuning.js`: `rankRun` (S / A / B / C, marks UNTOUCHED / DEATHLESS / NO FLASK) and
  `compareRank` (grade, then time). Not `grade.js` (that is the screen's colour grade).
- `game/records.js`: `buildRecord` (the one writer of the run record, `v: 1`) and the `Records` store
  (`gcd.records.v1`: per level and the rush, clears + best time + best grade; the last 24 records).
- `game/eligibility.js`: what voids a run (the Lab, cheats, `__tick`, `debug.toState`, `?stage=lab`,
  `?tech=`, fourteen gameplay URL switches found by a sweep of every parameter the game reads).
- `game/rush.js`: the rush across page loads in sessionStorage; `game/recorder.js` (`flow.recorder`):
  the flow's side, the clock, the record per win, `game:record`.
- `game/stats.js`: per-attempt damage and flasks (`newAttempt`), `bossTime`.
- `game/flow.js`: the recorder wired in (hurt / heal / death / victory / quit / pagehide), a rush page
  skips the title, the record screen's head and the rush's rows and prompts.
- `main.js`: the rush's level on a rush page; `game.records / eligibility / rush / startRush`; `__tick`
  voids. `levels/index.js` `levelUrl` drops `?rush`.
- UI: `ui/recordLooks.js` (three grade looks, three title looks, `?gradeLook=` / `?recLook=`), the title's
  BOSS RUSH button (pad-walked with the stages), `StatsPanel.show(rows, head)`, the rush line under the
  minimap; styles in `hudStyle.js`.
- Tests: `tests/integration/records.mjs` (grade boundaries, the store fresh / corrupt / full / blocked /
  version, the rush across simulated page loads, eligibility, the real GameFlow writing one record and a
  Lab-touched run none, the screens); in `tests/run.mjs`.

**Verified:** `npm test` and `npm run build` green; the title, the record screen and the rush line
captured at 720p and on the phone size both ways up (headless Edge on the GPU); a rush driven through
all eight levels in the browser with Lab jumps: every fight's record said NOT RECORDED and nothing was
stored.

**Open:** the owner picks the two looks; the thresholds are starting numbers; a human on a real phone
and with a pad on the title; a full rush played for real; online leaderboards (ROADMAP M2: the seam is
`game:record`).

---

## 2026-11-24 — Session 91: the perfect parry throws a few orange sparks (and what was turned down to get there)

**Owner:** "what can we improve next in terms of visuals, effects, animations etc. i want to make perfect parry and
dodge effects look more epic cool with subtle effects as a start." Branch `combat/perfect-sparks`. ADR-181 / M1.77.

**What shipped.** `?parryFx=a`, the default (`combat/parrySparks.js`): on a PERFECT parry of a blow, on top of the
shipped `sharp` mark (unchanged), 12 - 16 sparks leave the crossing, about 70 % along the attacker's edge past the
crossing, the rest along the hero's edge (no crossed steel, e.g. the wyrm: the way the blow was pushed aside); 4 - 7
m/s, strong drag, gravity; a stroke (`- / | \`) laid along its screen motion while fast, then `'`, then `.`;
yellow-orange to deep orange to dark red, no channel above the bloom threshold (no halo, never white); light ones live
0.12 - 0.3 s real, two or three heavy ones 0.35 - 0.5 s and die on the floor; real time (they leave the contact in the
0.11 s freeze); at most 48 alive; never over a fighter's head or chest. One house-letter `LetterBatch`, built on the
first spit. `?parryFx=0` (the Lab's `parryFx` button in the streak row) draws the parry as before.

**What was turned down, in order (all filmed at the game camera; the owner's words):**
1. A four-piece pass on one moment record (a ring through the floor's letters, poses, a darkened iris / camera lean /
   sound duck, the world answering), three options each, 19 clips: "i dont like any of this. start over. i dont want
   the background to change color at all."
2. Sparks round 1 (a glint run down the blades and ~46 sparks): read as nothing at the game camera (sent back by the
   lead, never shown). Round 2 (a white-gold fan of ~170 streaks): "too bright / fireworks, too many / too big, wrong
   motion, not the right idea", "calmer".
3. The perfect dodge's afterimage drawn as a second copy of the hero's real body (four options: an ink copy that
   unravels, a pose trail, a cut ghost, a brush smear): "i still the the original is better". The shipped afterimage
   stays.
4. Asked for a reference, the owner: "do your own research and figure out the best thing". The calm spit was
   designed from what real sword sparks and Sekiro's deflect do (few, fast, short-lived, orange; streak to dot).

**Verification.** duel `parryfx` (0 draws no spark; `a` 12 - 16 on a perfect parry, none on a normal one, none white,
90 % within 0.6 m (measured 93.4 % over 60 seeded spits), all gone within 0.55 s (0.483 s at most), a string peaks at
48, no `Math.random`, nothing throws without a fire field, `a` is the default); `perfectfx`, `deflect`, glyph check;
`npm test`: see the PR. Filmed: parry1, parry3, the wyrm, the phone.

**Open.** It is quiet by design: at full speed it reads as a few orange flecks after the gold flash. When the blow
glances toward the hero many sparks land over his lower body; against the wyrm they fly back into its head and sit
under its own white parry star. Not played on the iPhone. The rejected work is on local branches only
(`combat/perfect-epic`, `pfx/*`, `player/dodge-afterimage`), not pushed.

## 2026-11-23 — Session 90: every sound effect back to its first synth version

**Owner:** (after a session of sound picks) "lets just make all the sounds go back to their original. i want to
start from baseline and undo all the sound changes." Asked the scope; they chose all sound effects, music kept.

**The session before it** (kept in a git stash, "swing + warning sound options", and the pickers): the hero's
recorded light-cut swing did not match the animation (its takes peaked at 206 / 77 / 60 ms, the blade lands at
about 150 ms); five designed swings with their top on the blade were built and the owner picked `e`, then asked for
softer ones for mashing; the blue / red warnings ("too cheap", "way too dramatic and long"): the originals back,
four variations of each, a plucked-string pair, seven variations of it, and a spread of families, all turned down.
Rig lessons are in the memory notes (render each event through a fresh `AudioEngine` on an `OfflineAudioContext`;
level-match A-weighted; a deep fundamental is not heard on a phone).

**Changed** (ADR-178). `samples.js`: `DEFAULT_SFX = 'old'`; `?sfx=new` / `setSfxMode('new')` opts in and starts the
download; `load()` does nothing while off. Lab `sfx` row: `old` / `new`. Integ and duel `sfx` scenarios switch the
mode on and restore the default; integ asserts the default is `old`.

**Verified in headless Edge:** default 0 of 35 files requested; `?sfx=new` 35 of 35 loaded; the Lab's switch loads
them live. This found a slip of mine that node could not: a block replacement in `samples.js` had also removed
`headOffset`, which only runs when a file decodes (the tests have no fetch).

**Open.** Nobody has listened to the baseline in play. The next round should start from the owner's words (a
reference, a game, a feeling) rather than options.

---

## 2026-11-23 — A fight the world feels: the blade clean through, a mark for every boss blow, flocks, animals, a set that shakes (ADR-177; planned by Fable, built by Opus agents)

**Owner:** "when the player hits something like a rock or tree, the sword gets stopped and i dont like
this feeling. lets allow the player to swing their attack animation through it while making the terrain
get damaged and show chip damage. make it look natural and good. i also want the background to have more
alive like the ground gets damaged per boss attack to show the damage done from the boss. have more cool
atmospheric moments like animals running away as you get close to them in the fight or a flock of birds
flying away from the dragon blowing fire at it. think of ideas and ask me any questions". Their picks:
clean through; marks stay until the reset; all four moments; animals tiny. Branch `world/fight-alive`.

**How.** The lead wired the hooks first (`world.groundBlow`, blows and fire forwarded to the living
world's layers, two stub layers), then four agents in four worktrees: CUT, GROUND, FAUNA, TREMOR. They
merged with one two-line conflict. Each ran only its own suites (the lesson of the last build: seven
agents running the whole set stalled the machine); the lead ran the whole set once on the merge.

- **The blade goes clean through.** `_cutWorld` no longer rewinds, freezes, sticks or bounces. Measured:
  the attack clock with a boulder or a tree in the path equals the clock with none, frame for frame
  (light 29 frames, Piercing Gale 52, the charged cleave 65). The piece takes the same blow. Debris
  flies along the cut (about 30 bits with the blade against 4 - 7 back at him); sparks on stone and
  metal, splinters on wood; a jolt of 0.05 / 0.12. `?cutStop=1` (the Lab: Blade) is the old stop.
- **Every boss blow marks the floor.** `scars.mark`: seven kinds, each a dark stroke with a dim lit
  lip, grey ink, thinned where they pile up; `SCAR.max` 520 → 3600 (the oldest fade). One hook in the
  duelist engine reads each beat's shape; the wyrm's claws, stomps, dives, tail and fire call it
  themselves. Headless bot wins leave 8 - 157 marks a fight (the wyrm 130). The seeded fights replay
  line for line against the base. `?marks=0` is the floor as it was.
- **Flocks and animals.** Roosts of 30 - 44 birds leave when fire, a blow, a falling tree or a roar
  reaches them (a real breath on the tree wall: the flock went 1.2 s later), routed across the top of
  the frame. Rabbits and deer (Cinderwood), rats (Ashfall), lizards (the Ring), one fox (Foxfire, once
  a visit); nothing in the Throne or the Grove. Some return after the fight.
- **The set shakes; the aftermath.** A blow of power 0.7 or more shakes what stands within
  r + 3 x power^2 m: trees shudder without damage and drop their leaves, tall stone sifts dust, banners
  and charms swing (11.8 degrees at the peak, still again in 2 s), pebbles hop, the bonfire gutters.
  Smoke rises where fire burned out (at most five columns), embers, a haze over a crater.
- **A font gap found at the merge:** the wyrm's large font had no `c x s`, and no font had `^` or `o`:
  a flock printed blank at that size. Added; `core.fonts` checks every letter against every font.

**Verified.** The whole test set and the build on the merged branch (see the PR's checks). The cut's
clock by test; the marks by a world scenario and by the win scenarios compared against an extracted
base; the fauna, tremor and aftermath by their life scenarios. Films of each piece.

**Not verified / open.**
- The owner has seen clips, not played it. Their calls: the sparks' size, the marks' brightness and
  whether a pale trench or arc reads like a tell, the flock's brightness and its routing through the
  top of the frame, the deer's and the fox's sprites.
- Faint at the game camera: the kinds of mark (they read zoomed), marks on grass, the dust sift, the
  pebbles, the smoke, the crater haze, the tree's shudder. Ashfall's crows do not read.
- Films with REAL boss moves exist only for the wyrm's breath and a leap; most tremor films are staged.
- Not looked at: Halcyon Plaza's pigeons; the phone (`&touch`) for any of the four.
- Tian Lei's bolt beats still sweep 17 m of the world (older than this work); the Woken One's crater
  effect is drawn at his root while the mark is at his heel.

**Next.** The owner plays the preview; then a pass on whatever they call too faint or too loud.

---

## 2026-11-23 — Session 88: combat sounds, round two (planned by Fable, built by Opus agents, picked by ear)

**Owner:** "what are the remaining original sounds left ... lets do a new round of selection. i want to make
sure the sounds sound good, fits the moment ... you can also create your own sounds ... some of the original
sounds were good and i might revert back to it, so give me a full comparison and also help me understand when
the sound occurs during the picker." Of ~85 original synth sounds in seven groups they chose the combat core
(37 slots, with last round's 11 for comparison) and a picker with both a "when" line per sound and scripted
moments.

**How.** Four agents: one rendered every slot's original and current sound through the REAL engine
(headless Edge, an OfflineAudioContext swapped in for `unlock()`, the full master chain) and timed 11 fight
moments from the tuning (a blue blow parried, a red one dodged, a string blocked, hit, guard broken, the
combo, the slam, the flurry, the plunge, a deflect chain, a clash); one designed two candidates per slot by
synthesis (modal steel, shaped noise, stick-slip scrapes; deterministic, `scripts-b/design.py`); one cut up
to two CC0 recordings per slot from OpenGameArt (real sword-on-sword takes from StillNorthMedia's Weapon
impacts for the steel); one built the picker (https://claude.ai/artifact/8Bpvu18GCoRcKTiesZHF8m: per sound the original, the
current, d1 / d2, r1 / r2, none; a WHEN line; moments with a timeline and "with my picks" / "as now" /
"original"; every option level-matched to the slot's in-game loudness).

**Picks, built in** (`sampleList.js` slots, `build-sfx.py` with `--designed`, credits "Combat sounds"): see the
CHANGELOG entry. Each new sound measured through the real engine within 0.25 dB of its target loudness. The
plunge dive's loudest point lands on the landing (0.1475 s after the event; the landing at 0.146 s); the
flurry coil starts `406 ms - dur` into its file so its top lands on the strike. A perfect parry is now the
spear-on-katana take plus #100's perfect layer (the high crack and bell, kept as it was) and the streak note.

**The deflect chain.** The owner rejected every option: "make it sound more serious and cool. current sounds
like its for kids". The old chain climbed 2 semitones a parry with a bell. Three versions on the new parry
(`audio/parryChain.js`, `?chain=a|b|c`, Lab row): a (weight: an octave shadow and a sub that grow, no climb),
b (doubled strike, half a semitone a step), c (a low ring that lengthens). Put on the picker for the owner.

**Found and left.** The streak's guqin climb note (#100) still rises under every parry; other parry uses
(mikiri, counter, blade lock won, a boss deflected, the blue flare's timing ring, the flare counter) still
play the old climbing synth parry with its bell; a flaring blue blow rings a parry at its timing cue and at
the parry; the hero's combo swing pitch steps up, up, back down. Each is a small change if the owner wants it.

**Tests.** integ / duel `sfx` extended (every event's slot, the synth fallback, `?sfx=old`, the chain
switch). `npm test`: 21 of 21. No seeded check moved (new code draws only from the audio's own streams).

**Sign-off** (a one-page form, https://claude.ai/artifact/7RNVT5T6iHwPjejtN2finX): chain `a`; the streak note
"quieter" on parries (`STREAK_SOUND.parryGain` 0.5); the other parry uses switched to one strike of the blue parry
recording (`_parryAlso`; the synth with its old chain value is the fallback); the combo swing pitch fixed (step
= combo - 1, 0..4, for the recording and the synth); merge. Owner: prefers one page with links and tap
answers over step-by-step guidance.

**Next.** The next rounds: the Cinder Wyrm, the boss specials, the world and menus.

---

## 2026-11-23 — The life suite's phone check made deterministic (a flaky test, no game change)

**Why.** `life.mjs core.phone` asserted per level "no more spawns on the phone (sum at quality 0.5 <= sum at 1
× 1.01 + 20)" and failed about one run in a hundred: twice in a row on PR #101's CI (Cinderwood 73706 vs 72756,
then Foxfire 73790 vs 73021), on unchanged `main`.

**Cause.** The suite counted Math.random but never seeded it, and the sets' ambience draws from it: the
Atmosphere's 70 fireflies get their places and phases from Math.random at construction and are re-drawn into
fx.add every frame, ~72 000 of the ~73 000 spawns on Cinderwood, Foxfire and the Grove. Which fireflies were in
view moved the count by ~1000 per build, independently at each quality. The living world itself spawned 0
into the shared pools in that check on every level (its letters are in its own pools), so the check
measured only the fireflies' noise.

**Changed (tests and docs only).** `tests/integration/life.mjs`: Math.random is a seeded mulberry32 behind the
same counting wrapper, restarted from the level's seed on every `build` (`o.seed` overrides), so two builds
of one level get the same ambience and every run the same numbers; `counts().lifeSpawned`: the spawns made
inside `life.update` / `life.gust` / the feet. `core.phone` now asserts, with no tolerance: the creatures'
letters (unchanged), the living world's own pools' letters summed over 45 samples (new: what the phone
budget is for; Cinderwood 16 663 vs 31 383, the Grove 6655 vs 12 131), its spawns into the shared pools, and
all spawns (equal at both qualities except the Obsidian Throne, 7057 vs 7062). ARCHITECTURE's life-suite
section says so.

**Verified.** `core.phone` gives the same output (md5) on every run; `life.mjs . all` 5 runs in a row, all
passing, identical but for one wall-clock line (`steps`: "100000 surfaceAt calls in 17 / 20 ms"); `npm test` green.

**Open.** None from this. A single-instant snapshot of the own pools is not a phone check (the Grove's pools
held 202 letters at 0.5 vs 187 at 1 at the 45 s mark, while the 45-sample sum halves): sum over time.

---

## 2026-11-23 — Session 87: Xin Yi reworked: drawn like the hero, kicks and flurries, a wall kick, bullets that never lock (planned by Fable, built by Opus: a lead and three agents)

**What.** The owner played the merged fight (Session 82) and asked for more ASCII, faster combos, acrobatic
kicks, air attacks, a wall kick, flurries (phase 1 above all) and bullets that never stun-lock. Fable planned it
with four questions (the owner took each recommended answer); this session built it (ADR-168 – ADR-170):
- **The look** (a helper; `?oneLetters`, `?onePrint` a / b / 0; the owner picked a, "Print a"): his letters follow his size,
  the hero's quiet print, simpler glasses / collar / shirt, a coat that moves from phase 1 and is clamped for
  flips; b is one letter size bolder on a phone (`kit.letterBias`).
- **Motion** (a helper): ADR-162's kit for him: soft arms and legs, the feet planner lifted into
  `duelist/feetPlan.js` (Tian Lei byte-identical in his audit), the pursuit (0 swings at air); `woke.mjs audit`
  (opt-in) with main's numbers first, `motionfix`, `pursuit`. The audit then caught the spin back kick's knee
  flipping and the sweep jolting after a spin (both fixed) and palm dashes ending inside the hero (1.35 m stop).
- **Phase 1** in two gears (one hand; both at 83 % through a 0.9 s opening); THE FLURRY BURST (one cue, one
  result); nine new strike builders (`strikes.js`: spins, tornado, butterfly, flash kick, cartwheel kick,
  bicycle, drop heel, flying knee, the burst's keys); eight new strings; Borrowed Wall off the upright at the
  hero's side (or the floor), a flying side kick or a drop heel, used often.
- **Phase 2**: THE BULLETS' RULE: Iron Rain in three bursts of three, each one cue (its glint `flashLead` before
  it lands, the aim fixed there) and one result; a hit is a 0.18 s flinch that keeps the input buffer
  (`hit.stun` / `hit.mercy` in player.js, inert for everything else); `shotMercy` 0.45 s for his other shots;
  Iron in the Air; Close Iron's spin kick.
- **Phase 3**: A Thousand Hands with a burst in its middle.

**Numbers.** PACE cues a minute by STAGE: phase 1 gear 1 85.2, gear 2 87.3, phase 2 74.9, phase 3 76.7 (seed means) (main: phase 1 65.1 - 71.1, mean 67.2); the longest gap 2.42 / 2.39 / 2.23 / 3.32 s (main's phase 1: 3.29); dodges 13 / 10 / 7 / 21 % of cues (main's phase 1: 7 %); 0 conflicting cues; phases 2 - 3 at 0.86 - 0.88 of gear 2. Pinned from the worst seed with a margin (`pressure.meter`: minRate 70 / 78 / 65 / 62, maxGap 3.3 / 3.0 / 3.5 / 3.9). Short of the plan's targets, said plainly: gear 2's 95 - 105 (a burst counts one cue), 15 - 25 % dodges in phase 1 (13 % / 10 %). STRATEGY (god mode, seeds 4242 and 7): mixed 72 s, parry 106, block-only 75, lean 112, dodge-only 111: dodging and leaning are not the fastest. The mortal block-only bot survives and wins (61 - 89 s): no health through a block. WIN: the fencing bot wins through both bars in 66 s (84 before). The motion audit: elbows at contact 130 -> 152 deg (mean), feet sliding 198.5 -> 64.7 m, 0 swings at air (was 2 - 7 a minute), every string's worst jolt 310 - 473 mm/f2 (main 353 - 653). NOLOCK: `woke.mjs nolock`: a hero who stands unguarded through Iron Rain takes 3 flinches (one a burst) and the heavy shot, never a second stagger from a bullet; the least free time between two of his hits after a bullet 0.32 s (>= 0.25); hit by burst 1, then guard / parry / roll: burst 2 blocked / parried / dodged. Each burst lands 7 - 10 ms from its glint + 0.26 s (`timing`). A held guard through a whole volley pays 45 guard, no health (`cover`). Before: one slug locked the hero through all eleven and the heavy shot.

**Open.** The owner's picks still open: `oneLook`, `hall`, `script` (`oneLetters` and `onePrint`: a, picked); the iPhone (how he
reads in letters, the bursts at the phone camera, fps). Gear 2 measures under the plan's 95 - 105 cues a minute:
a burst of 7 - 8 blows is ONE cue by the owner's choice. Cut (the plan's cut order): phase 3's Falling Leaves,
the pillar run inside Iron Rain, `doubleWall`, the footwork clips (back handspring, cartwheel side-switch,
kick-up). Left from the audit: Low Wind's sweep (Tian Lei's builder) still jolts in its tuck (pre-existing, a
little worse with the planner), the rising's first keys, hooks and backfists that end 0.4 - 0.6 m short; 3 - 6 cm
of hanging coat meets the legs in strides (a shin push needs anim.js). From the film review (every new move at the game camera,
four sides): the cartwheel kick's heel meets the hero's sword hand, 0.8 m short of his body (its zone hits; the
picture does not); on the upright he stands beside its face instead of leaning out from it; the flare's streak is
centred where its glint went out (behind him as he flies); in flips the coat's panels still read as a star at
the game camera (clamped to 50 deg); the tornado from the south reads as sitting in the air; the flit of A
Thousand Hands lands south of the hero and covers him (as before).

**Lessons.** Two of three helpers could not write into their own worktrees (a hook: "belongs to another
session's worktree") and worked in scratch clones; cherry-picking their commits onto the lead branch worked,
the conflicts all in the suite's scenario block (keep both, mind the closing brace). The timing test caught
what no other did: a burst's glint 0.26 s before its slugs LEFT put them 0.5 s after it.
## 2026-11-23 — The living world, round 2: the air as clumps of tiny faint letters (the owner's verdict; ADR-163 addendum)

**Owner** (on the preview): "wind effects need to be way subtle and not like this random wave taking over
a full screen, the ascii characters should also not be so big and be tiny feint and clearly many ascii
characters clumped up. same with the other weather effect. make it very subtle and more ascii like and
natural realistic." And: "sound looks good" (the air's sound stays). Rebuilt by an agent on `life/wisp`
(d09ae0f, e2c1735), merged into `world/living-world` (eab68e1).

**Then:** on the round-2 preview the owner said "Looks right", then "Turn it on": every piece is now on
by default (`?life=off` turns it off; headless stays off). The Hall of Falling Script and Halcyon Plaza
(merged from `main` meanwhile) have no tuning blocks: the arrival and the air stand down there, the wind
and the steps run on defaults (`core.newLevels`, `air.newBed`).

**What changed.**
- **The house letter for the air.** New `world/life/letterBatch.js` (`LetterBatch`): each letter a world
  point projected to the screen and printed as one cell of the wyrm's pixel font (5 x 8 px at 720p,
  following `pipeline.artFont`), pixel-exact, nearest-filtered, soft depth test, FX pass; written letters
  (placed by their clump each frame) and spawned ones (move and fade by themselves). `wyrmGlyphs.js` gained
  `createWyrmLetterAtlas(key, s, chars)` and bitmaps for `, ~ = * +` and a backtick; the wyrm's atlas is
  unchanged.
- **Wind.** The front's lit band is gone (`grass.lift` removed; `uWindFronts[10].w` is now `patch`: a gust
  stirs loose local patches). Grass `front` 0.24 (Ashfall and the Ring 0.22; was 0.8 - 0.9), the canopy's
  0.28 / stir 0.08 (was 0.75 / 0.16). The streaks became **wisps** (`wisps` replaces `streaks`): clumps of
  64 - 96 tiny letters, 1.8 - 3 m along the air and 0.16 - 0.34 m across, alpha 0.4 at most, riding
  `wind.at`, stretching, curling and coming apart over 5 - 8 s; a few in the breeze, more in a front; none
  on the Throne or in the Grove. At most 10 clumps x 96 = 960 letters. Built on their own seeded stream,
  not `life.build` (that moved `life.rand` and so the birds' and the fronts' draws). New `wind.wisped`.
- **Weather.** Mist banks are soft heaps of 160 - 220 tiny pale letters (the Grove 110 - 150), densest at
  the heart, each letter cycling 4 - 9 s and streaming 0.7 m along the air, so the bank rolls; at most 6
  banks (was 12 of 36 - 46 big letters). The veil is removed. The drizzle `| \ /` by the wind's slant and
  `' ,` (70 a second, alpha 0.22; was 160 of `|` at 0.42); the squall's embers tiny dim dots, 15 % of
  them brighter, in an additive batch; the grey-out's ash alpha 0.42; the snow `. ' *` alpha 0.36; the
  devils columns of 150 grains (was 64 big letters). Everything the weather draws left the shared pools
  for its own batches (falling letters at most 700). The Throne's breath motes 0.5 → 0.3 m. The Ring's far
  lightning unchanged.
- **Litter** (tuning only): leaves and paper in the air 0.28 - 0.36 m (was 0.38 - 0.5), alpha 0.72; the
  Ring's grit 0.20 - 0.26, seed 0.24 - 0.30, alpha 0.62. What lies keeps its body.
- Tried and cut for the air: world-atlas glyph particles (below ~0.4 m they blur to specks); the fire
  field (its smoke is the bonfire's, any heat hazes the world, mist printed as dark-backed slabs).

**The lesson.** The first round's "ten-second test" (would a player told nothing notice?) pushed the air
bigger and brighter; this owner reads the air as alive from MANY tiny faint letters in a clump, not from
one thing that is easy to see. STYLE.md "The living world" carries it as the first rule.

**Verified.** `life` suite: `wind.wisps` (9 wisps in 20 s of breeze, 10 in 5 s of a front, every letter
in its clump, none on the hero, none in the grove, none off), `wind.budget` (at most 640 of 960 letters,
fx.alpha +13 at most, 11 wisps at quality 0.5 against 24), `weather.bank` (197 letters, 75 in the inner
third against 27 in the outer, all 197 back elsewhere in 9.5 s), `weather.budget` (own letters 847 at
most, Cinderwood's mist, against 1600).

**Open.** The drizzle may be too faint; the Ring's devils need luck to be in view (none on screen in the
budget runs); the Foxfire Terrace's calm shows little; off-is-free is argued by construction (the wind-off
branch, nothing built with the piece off), not re-filmed against `main`; `snap: 1` (letters on the art
grid) is not filmed; the owner has not seen round 2 yet.

## 2026-11-23 — The living world: one wind, nine layers, behind `?life=` (planned by Fable, built by Opus agents; ADR-163)

**Owner:** "make the ascii world feel more alive. have natural looking ascii wind, subtle falling leaves,
subtle different weather effects. before we fight the boss, the player should be awed at the background
living ascii world. things like players footstep as you run etc. ask me any questions and offer
suggestions for me to review. use fable to plan and opus agents to build". Asked four questions, they
took: a fresh build (the guest agent's uncommitted `?worldLife=` prototype in `.worktrees/` left
untouched), all four core layers, all four extras, one mood per level with slow changes.
Branch `world/living-world`.

**How it was built.** Three read-only mapping agents (render / levels / hooks). The lead wrote the core:
the switch, `world/life/life.js` with THE CONTRACT in its header, a stub per layer with its interface
fixed, the hooks in `world.js` / `atmosphere.js` / the Lab, and a new suite (`tests/integration/life.mjs`,
the real LivingWorld on every level's real set). Then seven Opus agents in seven worktrees, one layer
each, against the stubs: wind, litter, steps, weather, creatures, air (sound), moments (arrival +
answer). All seven merged with zero conflicts and 7 failing checks, every one where two agents' pieces
met. An integration agent connected the seams; a ninth agent made what hangs answer the wind; two of
the first agents were resumed for a visibility pass; a docs agent wrote the reference docs.

**What exists** (all off by default; `?life=all`, or the Lab's `life` rows):
- **Wind**: per level a direction and a breathing speed; gust fronts that cross the grass as a band of
  laid-over, lighter blades with runs of `~ = -` strokes along it; the canopy, the bonfire's flame and
  smoke, every fire's smoke lean with it. The Windless Grove is still.
- **Litter**: leaves, ash, paper slips, grit, cinders by level, in an own batch: they fall on the wind,
  lie, lift in a front, under a foot, in a blow.
- **Steps**: a surface map per level; each footfall's puff, print, sound by surface; trodden grass (the
  scorch map's blue channel).
- **Weather**: a director of slow spells per level (mist and drizzle, an ember squall and a grey-out,
  the star's breath, dust devils and far lightning before the Ring's fight, a cloud over the moon,
  still mist and snow).
- **Creatures**: fireflies that part from the hero, birds and crows that lift off, moths, one hawk.
- **Air**: a synthesized bed per level that follows the wind, the rain and the hush.
- **Arrival**: from the title the camera opens over the arena (the hero in the lower third), ~3 s.
- **Answer**: a roar is a gust front from the boss; red and black tells are a held breath; a kill is a
  lull.
- **Hang**: banners, paper charms and a rope lean and ripple in the same wind, and still break.

**What went wrong on the way.** The first wave was built to "subtle" and could not be seen: standing at
the spawn, everything on was nearly indistinguishable from today on every level (a thin stroke under
~0.3 m is one pixel at the game camera). The lead's brief was the cause. The tuning pass used a
ten-second test instead. Smaller ones: the lead's harness updated every own pool twice a frame; a roar
was weaker than an ordinary gust until a front could be born at a point; the far thunder could never
fire (the flash peaked at 0.13 against a 0.35 threshold); the arrival's skip would have ended at once
on a pad that rests off-centre (the owner's machine has had one feeding input).

**Verified.** `tests/integration/life.mjs`: the contract on every level (off spawns nothing, no
`Math.random`, budgets, the phone's share, each piece alone) and a file of scenarios per piece. The
seeded suites are untouched with life off. Films of every layer per level, checked with frame-to-frame
motion maps (a front must show as a travelling band). Frame cost: no measurable render cost; the
update adds ~0.2 - 0.35 ms with everything on. With the wind off the frame matches `main` to 1/255.

**Not verified / open.**
- **The owner has not picked yet**: the wind band's brightness, the overall strength (`?lifeK=`), the
  sound's level (it sits ~10 dB under today's bed; nobody has heard it: an audition page exists in the
  build session's scratchpad), whether the arrival's hold is wanted. Default stays off until then.
- Does not read yet: ash drifts as piles (the paving is itself drawn in strokes), the obsidian glint,
  moths. The mist banks and dust devils read as clusters of pale dashes: a second look is due.
- A banner's moon shadow is still the rigid shape; the far Throne banners (static mesh) stay rigid.
- No phone films of the weather or creatures (`&touch` left the capture helper without `__game`); no
  film of a real wyrm roar (only the emitted event); on-device fps is the owner's to confirm.
- Two levels in open PRs (Halcyon Plaza, the Hall of Falling Script) have no tuning blocks: they get
  the quiet defaults.
- The `life` suite is long (hundreds of checks on six levels); if CI's share with it runs long, split
  it by piece as integ and lord are split.

**Next.** The owner's picks from the films and the preview → the default; a second look at mist and
devils; the sound by ear.
## 2026-11-23 — Session 79d: the PR review's three findings fixed (Halcyon Plaza)

**What changed.** The Codex review of PR 97 (at 22b049b) found three real bugs; each got a failing test first:
1. `halcyonPlaza.js` setPhase(1) returned early when the phase was already 1, so a reset in phase 1 (a rest, a
   retry) kept a burning car's fuse: it blew up after the reset, and the fuse left `done` never lit again. The
   fuses are now forgotten on every setPhase(1). Test: `city.mjs car` (a reset mid-fuse: no bang, the car whole,
   its fuse idle; broken again, it goes up again).
2. `halcyon/flight.js` See the World set the hero's get-up time before the slam, inside the get-up's i-frames:
   the 30-damage slam came back DODGED. The slam lands first now; the 1.6 s control cap is kept. Test: `city.mjs
   grab` (a mortal hero loses the slam's damage; control back within the cap).
3. `destructibles.js` had no lower bound for a raised piece: a blow on the street bit a shop sign, the statue's
   arm or a tower's top metres above it (its hit point clamped up). `strike`, `sweep` and `stop` (`coverAt`'s
   new `y`) now skip a raised piece the blow passes under; a blow on a base still reaches its top through
   `holds`, and a broken base still drops its top. Test: `world.mjs city`.

**The owner's picks.** "Yes, keep it" to the recommended look: `halLetters` a, `halPrint` a, `halCapeSize` b
move from `PENDING` into `PICKED` (ADR-166); nothing visible changes (they were the defaults). None of Halcyon's
switches waits now.

**Why the fights moved.** The seeded fights moved with the fixes (the win 166 / 165 / 157 s -> 164 / 160 / 157;
pace seed 7's phase 1 had a 4.65 s gap against the 4.6 s bound), so his phase-1 rest between chains came down a
little (`chainRest` P1 0.45 - 0.75 -> 0.4 - 0.7 s): PACE 49.1 / 59.6 / 63.1, longest gaps 3.78 / 3.37 / 2.92 s.

---

## 2026-11-23 — Session 79c: Halcyon printed like the hero, a smaller cape (ADR-166)

**What changed.** The owner picked his look (halLook a, halCape 3, glare a, city a), then: "make his cape smaller,
make him look more ascii like to look like the main character ascii look more ascii made up". Tian Lei's answer
(ADR-155) as the model, three switches in PENDING: `?halLetters=a` (his kit's `letters`: the hero's cell, so from
1080p up his letters are as big as the hero's: 9.2 letters down him at 1080p and 1440p where he had 13.8 / 18.4,
the hero 8.6), `?halPrint=a` (Tian Lei's quieter print numbers; the cape's red and the gold keep their light;
b halfway), `?halCapeSize=b` (the cape x 0.65: 1.00 m long, the hem 0.52 m wide; a x 0.8, c x 0.5).

**Why.** The bosses' fixed 4 px cell drew him in twice the hero's letters on a large screen (a shaded 3D model),
and the step-3 cape was the biggest shape on screen from the front. The flare's angle is kept: its spread from the
front shrinks with the cape's length.

**Verified.** `city.mjs` pace and win give the same numbers as before (no object added), `looks` and the new
`herolike`; the whole `npm test` and `npm run build` (see the PR). Headless Edge at 1280 x 720, 1920 x 1080,
2560 x 1440 and the phone preset: `docs/looks/halcyon/halAscii.png`, `halCapeSize.png`, `halRecommend.png`.
Red / blue / gold facing the camera at 1280 x 720 (letters a, cape b): print 0 123 / 471 / 30, a 112 / 474 / 35.

**Open / next.** The owner picks the three. On the phone and at 720p the cell does not change (both 4 px).

---

## 2026-11-23 — Session 79b: Halcyon's cape and colours read at game size (`?halCape=`, ADR-164)

**What changed.** The owner looked at the sheets and said "Yes, fix the look": at true size (~40 px tall at
1280 x 720) Halcyon did not read as a blue suit, a big red cape and a gold belt. Measured first (pixels
round him that print red / blue / gold, look a, facing the camera): 24 / 494 / 0. Causes: from the front the
cape hung hidden behind him, its outer sheets edge-on, and what showed was its inside, the `lining` part,
which prints near black at a 0.24 fill; the moonlit rim (x3) and the cloth parts' lavender ink turned the
red pink; the gold's white ink lines printed a 5 cm belt cream. Now `?halCape=0|1|2|3`, graded steps of one
idea: 1 the colours (the lining lit past 1, no rim on the red, a brighter blue, the gold drawn in the `hair`
part with its gold lines, and bigger), 2 the cape wider and spread off the shoulders' tops so it frames him
from the front, 3 a billow while he hovers (a new optional streamer field, `breeze`, in `player/anim.js`)
and a longer trail in a pass. Default 3. b: navy and gold with the cape's gold lining lit; c: black and
chrome, a crimson cape.

**Why.** It is the only step where the cape reads from every side at true size, the phone included; the
same five sheets and meshes, so no seeded fight moved.

**Verified.** After (step 3, a): camera 237 / 463 / 23, side 339 / 415 / 37, behind 1262 / 163 / 0, pass
368 / 993 / 12 (before: 24 / 494 / 0, 115 / 432 / 2, 199 / 164 / 0, 332 / 603 / 2). `city.mjs` pace, win and
looks (each step builds five sheets, the same 90 meshes) green; the whole `npm test` and `npm run build`
(see the PR). Headless Edge at 1280 x 720 and the phone preset (852 x 393, touch): `docs/looks/halcyon/halCape.png`,
the `halLook_*` sheets re-rendered with step 3 (the old ones kept as `halLook_*_before`).

**The owner's picks (2026-11-23).** The cape, step 3, "billowing"; the body, `halLook` a (the deep blue
suit and red cape); the city, `city` a, Neon Rain; his eyes' heat, `glare` a: `halCape: '3'`, `halLook: 'a'`, `city: 'a'` and `glare: 'a'` are in `lookSwitch` PICKED and out of PENDING (the
defaults they already drew; nothing visible changes).

**Open / next.** Every look is picked. The lining's ink lines still
tint pink at a grazing angle (the per-part ink is shared by every rig). The beam was not touched.

---

## 2026-11-22 — Session 79: an eighth level, Halcyon Plaza and Halcyon, the Last Saviour (planned in its own chat, built by one Opus agent)

**What changed.** The owner asked for an evil caped strongman from the future, two well-known characters named as the reference
("laser eyes, flying around a lot with super speed and power" in an ASCII city his moves tear down. Built from
the planning session's plan (ADR-159 – ADR-161): `?level=city`, a crossroads read from its streets (every
piece breakable, two-stage towers, cars that burn and explode, screens with his face, his own statue), and
Halcyon, a bare-handed duelist who hovers in sword reach between moves and leaves it only inside a move.
His answers' reward: a parried flying blow (or a perfectly dodged red one) throws him off his line into the
first cover on it (the crash); his Stare perfectly parried goes back into his eyes; a thrown car parried is
cut in two and goes up behind the hero. Three phases on one bar (the smile drops: the screens turn crimson;
no one is watching: the city goes dark), the moments (the entrance, the statue's head, the two changes, the
kill). `destructibles.js`: a raised piece is struck at its real height (`y0 + h`).

**Why.** The owner's four answers: recognizable (a blue suit, a red cape, gold, red eyes, no emblem); all
four set pieces (through the tower, carried into the sky, his own statue, the falling sky); everything PR #78
got wrong avoided (the look, the gimmick rule, the dark vault, the slowness); no reward yet.

**Verified.** `city.mjs` all (levels, data, timing, flight, glare, pass, car, tower, statue, grab, phase, flow,
pace, win, training, looks) passes; `world.mjs` (the city scenario, `sets`, `bite` with a raised piece) and
`asc.mjs` (the butte tops after the y0 fix) pass; `npm test` and `npm run build` (see the PR). Stills at the
game camera in headless Edge (the sheets in `docs/looks/halcyon/`). The phone preset (852 x 393, touch): 76
draw calls against the Skybreak Ring's 73.

**Open / next.** The owner picks `halLook`, `glare`, `city` from the sheets. Cut for time: Last Word, the
hydrants' spouts, his own SFX (the existing synth sounds play his events), a score of his own (the Obsidian
Throne's is borrowed). The screens' "face" reads as a pale rectangle at the game camera, not yet as a head
and shoulders. Not checked: the frame rate on the owner's iPhone, a human playtest of the flight rule and
the crash's timing, the carry's look up close. The bar (14000) was sized for the fencing bot; a human may
find it long.

---

## 2026-11-23 — Session 86: the streak pass: a flurry that accelerates, the streak on the hero, in the HUD and in the sound, a sharper perfect parry (planned by Fable, built by Opus agents)

**Owner:** "i want to enhance the perfect parry / dodge effects and especially the streak combo hits. right now when the streak is really long, the animation to show the full streak is a bit long and doesn't look epic and cool. the longer the streak, the faster the attacks and way cooler animation and effects. think of cool subtle and epic stunning effects for players to love having a streak and seeing the longer and longer combos. use fable to plan it out and have opus do the work. ask me any questions". Branch `combat/streak-epic`. ADR-167 / Session 86 / M1.70.

**Asked and answered.** Four questions. The flurry: "Accelerating storm". Past seven: "Looks only, in tiers" (the flurry's blows and damage stay capped at seven). Between flurries, all four: "Hero and blade change", "Streak counter moment", "Sound climbs", "World reacts". A single perfect parry / dodge: "show me both 2 options to compare" (sharp and cinema). After the first round of the aura: "heros streak look also looks almost not visible? i want like a cool faint fiery aura very subtle but cool". And: "i'm not understanding the parry and dodge changes" (answered with one comparison picture).

**How it was built.** Fable led. A read-only mapping agent first, then the lead's core (32a66cd): `combat/streak.js` (the switches, the tiers, the perfect look's mode), stubs for `player/streakFx.js` and `combat/perfectFx.js`, the wiring in main.js, the resets, the Lab's 'streak' row. Then five Opus agents, each in its own worktree on that core: the flurry (storm + tiers), the perfect looks, the aura (aura + world), the HUD (counter + tier names), the sound. A session restart stopped all five mid-work; each was resumed in its worktree. Two pieces were sent back: the flurry once (round 2: its last blow bloomed into a white blot over both fighters), the aura twice (round 2: the owner's fiery aura; round 3: that fire as a rim, because round 2's loose blobs read as stacks floating near him). The clips went to the owner on a picks page (an Artifact); the owner pasted the picks back. The merges: no code conflicts between the pieces; one with main, in `player.js` `_ghostep` (main's Long Second `lean` kept beside the new look's path).

**What was built.** Every piece is behind `?streakfx=off | all | a comma list` (storm, tiers, aura, counter, sound, world; default all) and the Lab's 'streak' row; with a piece off it draws, sounds and times as before (each scenario checks it). The tiers: `STREAK_TIERS` [3, 5, 7, 10, 15] give tier 1 - 5; tier 3 is the full flurry.
- **The storm** (`player/flurry.js`, `DEFENSE.flurry.storm`): the first 3 flash cuts round the wyrm's head (2 on a man) are paced as before; each later cut takes 0.56 of the time of the one before (`fall`), never under 0.12 of a shown cut (`floor`). A storm cut has no wind-up seen, a contact freeze of at least 0.018 s (`stopMin`: he is drawn on the target as it lands), the camera's kick and shake x0.35, its flare and sparks x0.45; the last shown cut, the art and a riposte's last cut keep their whole weight. When a beat is shorter than a frame the frame runs on through it, so every blow still lands in a frame of its own, in order. A storm cut's line is the widest gap of 24 candidates (the star stays); its speed clone is printed on the contact; the camera holds the target instead of chasing him.
- **The tiers** (`player/flurryFx.js` `TIER_LOOK`, `ui/hud.js` `FLURRY_TIER_NAMES`): looks only. At tier 4 every hanging cut has one fine echo line beside it in the fire field's `steel`, at tier 5 two; on the last blow they split away in stepped frames and rings open where they cross. The banner says HUNDREDFOLD FLASH (tier 4) / THOUSANDFOLD FLASH (tier 5) with a thin rule more, never bigger. A streak of 15 strikes the same 7 blows for the same 258 damage in the same time as a streak of 7 (asserted).
- **The burst as lines** (round 2, `player/flurryBurst.js`, `?burst=0..3`): each level turns down together the burst's and the art's pooled lights, the fat flare strokes, sparks and shards, the stars, the art's halo and crescent, the speed lines, the hero's spark star and shockwave, the struck boss's white flash on the last blow, the veil and the storm cuts' centre; and every hanging cut flares out as a thin long line (1.35 / 1.6 / 1.85 x the cut). `flow.js` scales the flurry's screen flashes and dip by `burstScreen()`. Level 0 is today; every level makes the same random draws (`flurryFx.js` has its own seeded stream now, `fxSeed` / `setFxSeed`, no `Math.random`).
- **A single perfect parry / dodge** (`combat/perfectFx.js` `PERFECT_FEEL`, `?perfect=today | sharp | cinema`): sharp is short and clean (less slow motion, the flash at a quarter, a gold mark printed in the letter grid where the blades cross, the dodge's afterimage standing a moment then tearing along the way he left, one line where he went); cinema is a longer beat for a single blow or a string's last (deeper slow motion, the camera closer, the world dims instead of a white flash; a short beat inside a string). Read at the moment; no rule moves.
- **The aura and the world** (`player/streakFx.js` `StreakFx`, `game.fx.streak`): round 1, "the steel remembers" (kept, under the fire): a line of light up the blade's edge by tier (34 - 100 %), 1 - 3 echo lines inside each swing's arc, a wake of his letters on a roll / sprint / dash, coat letters lifting at tiers 4 - 5. Round 3, the fire: a rim of faint heat (0.17) one blob a letter cell just outside his silhouette, so the fire field prints a thin line of dim red strokes that hugs him; the tiers change only how much of the rim is lit (0.36 - 0.92), from how high (55 % of his height at tier 1, his back side only at tiers 1 - 2, the whole figure at tier 5), the tongues (1 - 2 cells) and a burning trail on the swings at tiers 4 - 5. Nothing on the boss's side, never over him. The loss: the edge snaps dark and breaks into falling strokes, letters drop off him, every live blob turns to smoke in the same frame. The world, from tier 2: a gust of the grass (0.34 - 0.62, under the wyrm's weakest), 7 - 13 bits of the floor's own kind at his feet, letters rising at tiers 4 - 5; at most 20 spawns a defence. `?auraFire=b` (a cold steel-blue rim) is kept, not picked.
- **The counter** (`ui/streakCounter.js`, `hud.streakUi`): a small number at the hero's chest, on his side clear of the boss, on every rise of the streak from 2: it pops over 0.066 s, holds, fades (about 0.9 s; up to about 1.4 s at tier 5 with a word). Its style steps up by tier (an underline at tiers 2 - 3, strokes either side at 4, pale gold at 5). The first time a streak reaches a tier it carries a word: TRIPLE, FIVEFOLD, SEVENFOLD, HUNDREDFOLD, THOUSANDFOLD. A lost streak (2+) shows its number struck through in red, falling apart. It hands over to the flurry's own cut count. With the counter on, GHOSTEP and RIPOSTE drop their xN (DEFLECT xN keeps its string count), and the flurry's count ticks in place while cuts come within 0.2 s.
- **The sound** (`audio/streakSound.js` `StreakSound`, `engine.streakSound`): each perfect defence that raises the streak plays a guqin-harmonic note one step up a minor pentatonic in the key of the playing track (`TRACK_KEYS`, measured from each track's chroma), two octaves by streak 11, then held and brighter; a tier reached doubles the note once. Its own bus, at most 3 voices, ducked to x0.4 (about -8 dB) for 0.22 s under every tell and timing flash. A lost streak of 2+: its last note falls a fourth, a muted pluck. From tier 2 a quiet drone on the track's tonic and fifth joins the music bus (0.03 - 0.06 by tier) and fades in about a second on the loss. The parry's deflect chain and the flurry's cuts move onto the same scale; cuts closer than 0.1 s merge into one rising sweep. A perfect parry's ring and the Ghostep's slow sound follow the perfect look (sharp x0.55 / x0.45, cinema x1.6 / x1.35).

**The owner's picks** (pasted from the picks page; the defaults since 78286ac): perfect parry / dodge: sharp; counter look: A lines; counter at low streaks: no pick (kept as built, shown from 2); names at 10 / 15: HUNDREDFOLD / THOUSANDFOLD FLASH (of three sets); sound: B, the guqin harmonic on a minor pentatonic (A a singing bowl on a natural minor and C dry steel were the others); the flurry's last blow: level 2; the fiery aura: as built.

**What the work found.**
- *What made the burst a blot.* The flurry agent took one effect away at a time on the last blow (bright pixels in a box over 11 frames, Shen Hui / the wyrm): the screen flash -29.9k / -30.2k, the pooled lights -27.1k / -1.8k, sparks and shards -20.0k / -21.8k, the fat flare strokes -13.4k / -53.9k, the art's crescent -10.7k / -12.3k. Totals: today 144.9k / 192.1k; levels 1 / 2 / 3 79.9k / 37.4k / 28.3k and 122.2k / 70.4k / 52.3k. Not re-measured by the docs pass.
- *The aura did not read, then it scattered.* Round 1 (lines on the steel and a wake of letters) was "almost not visible" at the game camera. Round 2's fire (loose rising blobs) read as stacks of letters floating near him, not as him burning. Round 3 hugs the outline: the rim is found each frame by projecting his body points into the fire field's letter cells, closing the gaps and flood-filling the outside. Its heat sits at 0.17 because the field's erosion tears heat under about 0.15 away.
- *The storm.* Against the wyrm (integ `storm`), the flash cuts of N = 5 / 6 / 7 take 1.02 / 1.25 / 1.52 s before and 0.97 / 1.08 / 1.18 s now; the seven's blows land 6, 17, 16, 14, 8, 4 frames apart (were 6, 17, 16, 16, 14, 12); N = 4 or fewer is unchanged round the head (3 or fewer on a man). Against Shen Hui the flurry agent measured N = 4 / 5 / 6 / 7 1.08 / 1.42 / 1.77 / 2.10 s before, 0.98 / 1.10 / 1.18 / 1.27 s now (the whole flurry of seven 2.88 -> 2.05 s).
- *The perfect looks leave the rules alone.* On the Ash Disciple (duel `perfectfx`): his recovery after a perfect parry lasts 1.016 / 1.002 / 1.014 s of game time (today / sharp / cinema), 1.27 / 1.13 / 1.53 s of real time; seven perfect parries of Ash Rain take 6.85 / 6.20 / 6.23 s real. The crit window and the i-frames are the same in every mode.
- *The sound.* Offline renders only: a climb note about -30 dBFS RMS (12 dB under a parry); a run of 16 parries moves the mix RMS by +0.2 dB at most; the blue / red tells unchanged with a climb note on top; the tier-5 drone adds +0.3 to +0.8 dB.
- *The wyrm's pace meter and seed luck.* A test fight replays its seed's Math.random, and a seed replays a different fight when the scenarios before it change: seed 1337 read 66.5 -> 70.7 cues a minute inside `all` (x1.06, under the x1.12 the meter asked per seed) and 60.0 -> 77.0 alone; over ten seeds alone every one ramps at least x1.21 (main x1.31). `TUNING.pressure.meter` now asks x1.12 of the seeds' mean and x1.05 of each seed (`rampSeed`), the duelists' rule (ADR-122). No pressure number changed.

**Verification.** New scenarios: integ `storm`, `streakfx`, `streakhud`, `streaksound`; duel `perfectfx`. Duel `impact` measures the parry at `?perfect=today` (the look it was written for). The docs pass re-ran integ `storm,streakfx,streakhud,streaksound` and duel `perfectfx,impact`: all passed, and the numbers above marked as test numbers are from those runs. The lead's last `npm test` on the branch with main merged: all 17 suites passed. The picks were made from clips and stills (headless captures), not from play.

**Not checked / open.**
- Nobody has played it. The sound has never been heard in the game (offline renders and an audition page only). The phone was not checked on a device (the counter was captured at phone sizes, landscape and upright).
- The tier rings on the burst do not read under what is left of its glow; the echo strokes do.
- On Cinderwood the fire field barely prints near the hero in headless captures (a plain test blob at heat 0.6 printed about one frame in two): field-wide, cause not found, outside the aura's files. To check on the real page.
- The aura steps aside while the hero's cold cast after a Ghostep is above half (`ghostFx` > 0.5, about 0.16 s of game time, longer in real time under the slow motion), so it blinks off after every perfect dodge; a one-line change would keep it.
- The counter at streaks 2 - 4 is small and easy to miss on a busy floor (the owner made no pick: kept).
- On the wyrm's bite every perfect look whites out for about 0.2 s: today's blue light of a parry moment (`flareParry`), not changed by this pass (the perfect agent's finding).

---
## 2026-11-23 — Session 85: attack sounds (planned by Fable, built by Opus agents, picked by ear)

**What changed.** The owner: the blue / red attack sounds were tacky, and the warning should be more
natural instead of making the player rely on sound for everything: a cue only for red and blue attacks,
and every other attack the natural sound of the weapon (a sword boss's blade, a fist fighter's fist).
Their answers before the work: keep both blue / red sounds (the warning at the windup and the timing
sound), in-world sounds, new sounds for the sword bosses, the bare-handed bosses, the wyrm and the hero's
own sword, an audition page first and then a listen in a real fight.
- Cues (audio.js): `combat:tell` plays `cue-blue` / `cue-red` (+ the music dip) only for blue / red /
  black; `combat:flash` plays `time-blue` / `time-red` only for those; a normal tell or flash is silent.
  Hazards and bullets keep their cues exactly. Until a recording loads the synth recipes play, so a blue
  or red blow is never silent.
- Blows: the duelist engine emits `dragon:attack` once per real blow (no feint, cast, pure throw, burst
  or phase change), 0.3 s before its impact and never before its glint (`duelist/attackSound.js`
  classifies weapon / weight / shape from the beat data; `weapon` declared once in each boss's tuning; a
  fox's paper self sends the same at its glint). The audio plays `sword-light / -heavy / -thrust / -draw`
  or `fist-light / -heavy` with the clip's `peak_ms` lined up on the impact, spatialised on the sfx bus;
  the wyrm's swipe plays `beast-claw` / `beast-tail` by name; the hero's swing the sword slots pitched up.
- `samples.js` / `sampleList.js` (slots as data) / `sampleFiles.js` (generated): the one-shot runtime cut
  down from the closed PR #55 (its own LCG: no Math.random draws, the seeded sims stay put).
- `scripts/audio/build-sfx.py`: the picks + the sourcing manifest -> `assets/audio/sfx/*.mp3`
  (23 files, about 90 KB), `sampleFiles.js` and the credits table. `?sfx=old` and a Lab row: as before.
- Sourcing: 98 CC0 candidates from 25 OpenGameArt pages, licences checked per page and per pack; an
  audition page (https://claude.ai/artifact/VYVdpfmycGiZeTecunB2Gb) with today's synth as a reference row
  and a "hear it in a fight" sequence. The owner picked 11 of 12 slots; for the blue timing sound they
  said none of these twice (round 2: six short strikes from the same sword recordings as their blue
  warning; round 3: a blade shing, a wood tak, a muted bell, a choked gong, a glass tick) and then kept
  today's synth ping: `time-blue` has no recording, so `combat:flash` plays the synth recipe for blue.

**Measured / verified.** In the dev server (Ash Disciple, AI on, 20 s): 12 normal tells and flashes
played no cue; 4 blue and 7 red tells played the recordings; 22 blows played 22 blow sounds (sword light
12, heavy 5, thrust 3, a kick on fist-heavy 2); the hero's cuts drew sword-light. All 23 files load.
Nobody but the owner can hear them: levels in the mix are not checked by ear.

**Tests.** duel `sfx` and integ `sfx` scenarios added. Untouched main plus only the random-stream commit
failed three seeded checks with the same numbers (no fighter had changed: the fights rolled a different
sequence): fox PHASE (five selves), integ LAB (fireBrand: one flash per tell) and integ PRESSURE (seed 1337
phase 2 at 46.8 cues a minute, under 48). One was a real edge case the new sequence exposed, fixed in the
game: the wyrm's throw lunge (`terrainAttacks.js`: a tree at its feet, it backed off at 6 m/s while the
plan reckoned 24, came to the bite too close and aborted after its red tell; the lunge now waits up to
`jaws.backMax` 0.8 s). The fox's selves were reworked on main meanwhile (packs): the fox check moved with
them. Two were test bands: PRESSURE's per-phase cue-rate floor holds over the mean of its three seeds;
BREACH's standoff band counts where the wyrm's share of the gap ends (main itself failed the old +6 m
band on 2 of 5 seeds) and its reset check reads the wall at `world.restore()`. Open: BREACH's 60 %
cue-rate condition would fail on seed 2026 (and on main's 1337); only 4242 runs.
After the rebase onto the reworked Wen Yao and Tian Lei, two more single-sample checks moved the same way
(main plus only the random-stream commit fails them too): fox PHASE's "phase-3 moves join the pool" took
300 rounds and missed the Moon-Swallowing Pearl (about 1 % of a pick at 6 m): now 3000 rounds; asc
PURSUIT's Aura Burst chase asked for 1.5 m closer, but the move he rolls after breaking off sets the gap
(Tiger Descends runs into the hero, Golden Gates stops at a fist's reach): now he closes in and that
move's blows reach the hero. Neither was a game bug.

**Next.** The owner's listen in a fight on the PR's preview (and on
the phone); the mix (cue and blow levels against the music) by their ear.

## 2026-11-23 — Session 84: Tian Lei's blows audited; he stops attacking the air

**Owner:** "ok looks good but i noticed a lot of the attack animations and attacks look unnatural. audit it and fix it to improve it. make the boss also stop attacking empty air if the player moves out of the distance". Branch `enemies/ascendant-ascii` (on PR #96's look pass). ADR-162 / Session 84 / M1.68.

**How.** Measured before touching anything: `asc.mjs audit` (opt-in; every move, the hero still and
circling, joints frame by frame: jolts, the facing's turn, sliding feet, joints, the blow against the
hero) and `auditfight` (opt-in; his AI against a defending bot, 30 s a form). Filmed the worst moves
(close side view, solid and ASCII) against the committed build. The whiff fix went to a helper agent in
its own worktree (`enemies/ascendant-reach`), porting the unfinished pursuit from the stale epic pass
(`asc5/ai`, never committed), merged here.

**What changed.** Feet that stay planted (`_planFeet` + the pose hook), arms that open (anim.js `armSoft`,
the hero's numbers), legs that keep a bend (`legSoft`), palm dashes that stop at the palm's reach (`PALM`),
a roundhouse knee that points up. The pursuit (`pressure.pursue`, duelist brain.js / director.js, opt-in; Tian Lei's tuning): a blow the hero has run out of is broken off before its glint and he chases; form 1 chases no harder than before; PACE's floors re-pinned (a swing at air was a cue).

**Measured.** A real fight against a defender: frames with a visible pop 87 -> 23, the worst 1966 -> 715.
Every move: total jolt 47 316 -> 23 677. Punches land at 149 - 155° (was ~130°). Swings at air a minute (whiff meter, 3 seeds x 90 s, forms 1 / 2 / 3): flee 18.2 / 18.1 / 9.5 -> 0 / 0 / 0, retreat 1.9 / 4.3 / 2.7 -> 0, kite 1.9 / 0 / 0.5 -> 0, roam 0 / 0.2 / 0.2 -> 0. PACE on ten seeds: F1 75.3 / 79.3 / 85.0, F2 78.5 / 84.6 / 91.3, F3 81.4 / 93.2 / 101.2 (min / mean / max; form 3's mean was ~96).

**Found on the way.** Two audit artifacts that looked like defects: the drawn figure leans toward the
camera along z (measure reach with the hero EAST of him, as MOTION does), and hit-stops are freeze-frames
(a window that spans one reports the whole freeze as one frame's jolt: "strike -> stagger" was not real).

**Not checked / open.** Nobody has played it; not on the phone. His tracking turn (up to ~900°/s at a
circling hero) was offered as a choice and the owner kept it ("Leave it"); the still charges of the
beams were left too (see ADR-162). The stale epic pass on
`enemies/ascendant-epic` / `asc5/*` (new moves, blue beams, the champion's ring, its own letter grid) is
still unmerged and now conflicts with PR #96 and this work.

---

## 2026-11-23 — Session 83: Tian Lei printed like the hero; the hair risen, not tall; a gi in ember

**Owner:** "the skybreak ring, the character is too detailed and is showing its flaws in 3d. make it more
ascii like, like the main character, to hide its flaws. also make the phase 2 and 3 golden hair not be so
long and more natural iconic looking. also change the character's color and cloth a bit to not make it
look too obvious its goku". Branch `enemies/ascendant-ascii`. ADR-155 / Session 83 / M1.66.

**How.** Each ask built as options behind switches, rendered (1440p game camera with the hero beside
him, close-ups from four sides, the phone) on three sheets; the owner picked the recommended option of
each: letters B (the hero's letter size + the hero's quieter print), hair B (his own hair risen), outfit E
(ember).

**What changed.**
- **His letters follow his size** (`?ascLetters=a`): the kit's `letters`; at 1080p / 1440p / 4K he is on
  the hero's 6 / 8 / 12 px cells, not the bosses' 4 / 4 / 8. The renderer code (`_letterCell`,
  `_updateBossLetters`, `pipeline.bossLetters` in main.js) is PR #94's (Wen Yao's rework, open), taken
  word for word: I had written my own version first, found #94 doing the same, and swapped mine out so
  the two PRs agree (mine also snapped his ink lines to the font pixel; dropped, see ADR-155).
- **The hero's quieter print** (`?ascLift=b`, `ASC_QUIET`).
- **The gold hair** (`?ascHair=b`, `goldRisen`; `a` a short crown kept): about his dark hair's height,
  form 3 no taller than form 2, one lock over the brow in form 3.
- **The gi with wraps** (`?ascLook=e | r | w`, base `k`): e ember ships; r crimson over charcoal, w bone
  kept. A storm-blue gi was dropped: it read as the hero's own colour.
- Lab LOOKS: the new rows, `ascLook`'s new options.

**Verification.** `asc.mjs . body,herolike` green (his cell = the hero's at phone / 720p / 1080p / 1440p /
4K / 24 m / 54 m; the fixed cell with the switch off; the gold's height; the gis). Rendered with no URL
parameters at 1440p beside the shipped look (sheet `AFTER` in the session's scratchpad). `npm test`: see
the PR.

**Not checked / open.** Not on a real phone (there the letters were already the hero's size: only the
print, hair and gi change). The orange gi and the tall crown stay behind their switches. When PR #94
merges, `pipeline.js` / `main.js` should merge clean (the same lines); the docs' "The bosses' letters"
paragraph will need one pass to name both bosses.

---

## 2026-11-23 — Session 82: a seventh level, the Hall of Falling Script and Xin Yi, the One Who Woke (planned by Fable, built by Opus: a lead and three agents)

**Owner** (to the planning session): two more homage bosses, planned by Fable and built by Opus, "lets do
neo ... come up with iconic moves, effects, moments to make this a cool battle". The planning session asked
four questions (the look recognizable; a pillared hall whose stage morphs 2 - 3 times; the four moments not to
cut; the suited men watchers only); its plan (`code-one-plan.md` in the shared notes) was built as written
(ADR-156 – ADR-158; the session numbers 80 and 81 were taken by open PRs).

**How it was built.** The lead landed the contracts and a working core first (af4ed3b: the level, the scenes
contract and `destructibles.present`, `uScript`, the code palette, the boss on the duelist engine with every
mechanic, a stub set and stub body/effects), then three Opus agents in their own worktrees at once: the set
(`scriptHall.js` rewritten keeping the contract, the watchers, the falling script, the script wave in
materials.js, world.mjs `bite` per scene), the body (`gear.js`, `look.js`, the oneLook sheets), the effects
(`fx.js`, the synth sounds, the borrowed score). Meanwhile the lead did the reward, the Lab, Training, the
suite's scenarios, pace and strategy, the docs; then merged, re-measured and re-shot the body's sheets in the
real light. (The effects agent could not write into its worktree: the harness kept it to the lead's; it worked
in a clone in the scratchpad and the lead fetched its branch from there.)

**What exists.** `?level=code` (`levels/scripthall.js`; aliases one / script / scripthall / woke / xinyi:
the plan's `hall` was already the Obsidian Throne's), `world/scriptHall.js` (rung 1 of the plan's ladder: the
full swap; three scenes, 397 breakables, morphs of 1.25 - 1.63 s), `enemies/wokenOne/` (wokenOne.js, moves.js,
tuning.js, poses.js, links.js, iron.js, source.js, fx.js, gear.js, look.js), the Long Second (player.js
`TUNE.lean`, anim.js `leanPose`, unlocks `longSecond` / `?tech=lean`), `tests/integration/woke.mjs` (21
scenarios in `npm test`; opt-in smoke, strategy) and sheath.mjs's opt-in `lean`.

**Decisions where the plan was open** (ADRs and COMBAT have the rest): `WokenFx extends AscFx` rather than
LordFx (AscFx is LordFx's pool plus the blasts that cover stops and the perfect parry returns); phase 1's left
hand behind his back is a realiser of its own over a one-handed copy of the moves; Iron Rain is one sustained
beat (one cue for the stream, the ledger sees one guard window) whose ticks fire the shots; Return to Sender is
one blow of the brain's over a 30 m ring (one cue, one result) with `noWorld`; the stop catches a returned bolt
by parking AscFx's blast in its `push` phase; Unwriting's bricks are the Lord's torn stones (they hang clear
of their own pillar: cover stopped them at once); the fall's rising starts as the fall's clip ends (no stand-up
between); every thrown thing asks `brain.fairDelay` (`fairThrow`); deja vu replays through the realiser's
recorded draws. The watchers' 4 / 8 / 12 is the set's `within` / `later`, not a fourth scene. The trade
clash in Training now stands clear of the pieces (`clear: true`): the hall's posts could stop the hero's blade.

**Measured.** PACE (real set, three seeds x 60 s): 67 / 106 / 83 cues a minute, 0 conflicts, dodge 7 / 5 / 21 %
(phase 2 counts each of Iron Rain's eleven shots). WIN: 84 s (seed 4242). STRATEGY: mixed 75 – 84, parry 95 –
96, block-only 89 – 122 (mortal: alive and wins), the Long Second bot 138, dodge-only 142 – 164 s; on the
Sheathed with the Long Second: mixed 33, parry 42, dodge 64, lean 82 s. TIMING: every contact within 43 ms of
its flash + 0.26 s. Draw calls 68 - 73 in every scene and moment at 1280x720 and 852x393 (the Foxfire Terrace:
76 on the phone); the fire field's peak about 1030 of 6000 (phase 3); the falling script 320 (140 on LOW).
Frame times on the RTX 4090 headless only; on-device fps is the owner's.

**Not done / cut.** The phase banners do not decode (the plan's first cut). The morph prints in with the front's
ring only (no print-in effect). The bit-identical frame at strength 0 is by construction, not a GPU readback.

**Next / open.** The owner's picks from the sheets (`?oneLook=`, `?hall=`, `?script=`); the iPhone: the frame
rate, the black coat, the shots at the phone camera; his own score.

---
## 2026-11-23 — Session 81: Wen Yao reworked: drawn like the hero, packs out of the air, the big Pearl, the Nine-Tailed Fox's beam (planned by Fable, built by Opus: a lead and two agents)

**What changed.** The owner played the Thousand-Body Fox and asked for four things (ADR-154 quotes them):
he is hard to see; the clones are boring sponges that stand about; the moves should be signature moves
(the palm orb); and he should summon a fox for an ultimate beam. Built from the planning session's plan,
the lead landing the contracts first (af30eab) and two agents in their own worktrees:
- **The body (agent):** `?foxLook=h1` (the default) in the hero's ink-line art: a big russet crest with
  pale tips, a short open amber jacket, dark trousers, pale wraps, a long vermilion scarf; h2 / h3
  rendered; his letters follow his size (`kit.letters`, `pipeline._updateBossLetters`, `?foxLetters`).
- **The packs (lead):** clones.js rewritten: no ambient selves; `pack` on a beat; FoxClones.pack books the
  bodies and the ledger; together / sequence; Two Leaves Fall, the Round, A Thousand at Once, the Burial,
  the Kite String, the Pearl's harrying pack; the pool 5 → 6.
- **The signature moves (lead):** the big spiral Pearl (pale blue-white `FIRE_PALETTES.pearl`, spiral arms,
  a drilling drive, a spiral burst, a synth whirr), the Twin Pearls, the giant Moon-Swallowing Pearl lifted
  by two selves, "It was a copy"; phase 3's fire its own kind (`?foxFire3`).
- **The Howl (agent):** beam.js / spirit.js / fxBeam.js / tuningBeam.js: the Nine-Tailed Fox as a body in
  the art path, the dark sun, the beam, the world along it, the kneel; `cameraRig.hold`, the terrace's
  `light.dim`.
- Training: "A Thousand at Once · one parry", "The Round · parry the chain", "Heaven-Devouring Howl · roll
  through it" (Pop the copies is gone); the Lab: pack buttons, Twin Pearls, Howl, LOOKS rows.

**Decisions.** ADR-154. Where the plan was open: the Pearl's harrying pack is 1 / 2 / 2 (three do not fit
before the drive with the red cue 0.36 s clear); a pack riding on a blow of his is named `<move>Pack`; the
Howl is one red beat whose windup is the summoning (the "black" of the summoning is a charge's darkness,
not a second blow); the fox's head is drawn at 2x and the body always side-on to the camera; the h
outfits' crest uses `welt` (the hair parts' gold outline read as blond). The Moon Wheel was cut.

**Verification.** `npm test` green (every suite); `fox.mjs` `data` checks every pack's schedule, `clones`
is rewritten for packs, `beam` is new, `pace` re-measured on five seeds x 120 s (70.9 / 79.5 / 68.3 cues a
minute, 0 conflicts), `win` and `training` pass. Rendered at the game camera in headless Edge: the sheets in
`docs/looks/fox/` (body-720 / -1440 / -phone, letters, packs, packs-phone, clones-ab, pearl, mantle, howl,
howl-phone, howl-fox-720). Measured: a full pack 73 → 118 draw calls (1280x720), the Howl 75 → 84 and a fire
field peak of ~1300 - 1500 blobs.

**Second pass on the Howl** (the owner: "yes, fix the fox"; the reviewer: the fox read as a fan of
feathers, the beam as a thin streak). The head is the subject (drawn 2.3x, a clean profile wedge, broad
ears, a jaw that opens wide over a white-hot maw, a pale throat; the body charcoal so the head separates);
nine separate S-curved tails with bright tips; he summons it `away` 10 m from the hero through the middle
(not the far rim) and `cameraRig.hold(m, x, z, w)` leans toward it: the desktop camera stays at 36 - 41 m
(was ~60) with the head well inside the frame from every side. The beam fills its 3.6 m strip (a bulb at
the jaws, a five-line core, a boiling body, the floor lit and charred, a scar that lingers). The dark sun
is ~2.3 m with motes from the whole arena and the light dropping further. On the phone the pull-back is
capped: the hero is 51 % of his duel-camera height during the Howl (was 24 %), short of the 70 % asked;
the head crops at the top when the hero stands north or south of it. 72 → 81 draw calls, the fire field's
peak ~1600 (2350 headless). Sheets: howl.png / howl-phone.png (before / after), howl-fox-720.png.

**Open / next.** The owner's picks (six switches in PENDING). The fox at the game camera reads only when
looked for; on the phone the Howl pulls the camera back to ~55 m. Neither checked on the owner's iPhone.
Phase 3 is now less busy than phase 2 (by design of the Howl; the meter says so). The Moon Wheel.
## 2026-11-23 — Session 80, round 2: the Sheathed between the digits and the ink-line art (ADR-152 addendum)

**Why.** The owner picked palette a, then looked at the ink-line Sheathed in the game: "too detailed and his flaws
from the non ascii look is hurting. find a right balance". At fight distance he read as a 3D model (smooth shaded
cloth, clean outlines) and body flaws showed that the digits had hidden. They asked for three steps between the
two prints, to pick from.

**What changed.**
- `?sheathArt=0|1|2|3|a` (look.js `SHEATH_STEP`, `wandererDigits`, `sheathTuned`, `sheathDigits`): 1 and 2 are the
  wyrm's digits with the palette's inks (x 0.42 / 0.5; trousers x 0.72 and wraps x 0.8, since neutral greys print
  near white), the art source's light floor 0.03 / 0.1 and a stroke outline reaching in to fresnel 0.3 / 0.12 in a
  paler ink; 3 is the ink-line art with the cloth's aPart folded to 0 in `_setup` (no fold or crease lines), no
  glints, no fold shading, half the rim. 0 is the digits and his body as on main (no mark, the old tail and scarf).
- His body in prints 1 - a: full sleeves (no thin stiff arm, no gap at the side), one deep roll of scarf instead of
  two turns, plain gaiters instead of six shin bands, no wrist bands. Gameplay untouched.
- `sheathTone: 'a'` in `PICKED` (the owner's pick); `sheathArt` stays `a`, its Lab row `awaiting` again; duel.mjs's
  picks check lets a picked switch wait for a new pick. `sheath.mjs` LOOK covers every print.

**The pick.** The owner picked step 2 from the sheet (2026-11-23): `sheathArt: '2'` in `PICKED`, the Lab row not
`awaiting`, `sheath.mjs` LOOK checks 2 as the default and `a` as an option (the palettes by the digits' ink). Open:
the mark (`?sheathMark=`), a real phone, his digits larger than the hero's letters.

**Measured** on main's grove with its new bamboo (rebased; the camera pinned at its default distance; his pixels /
the floor under him; the hero about 25 / 16): 720p 0 37.0 / 20.3, 1 26.5 / 20.2, 2 36.1 / 20.3, 3 31.2 / 20.1, a
35.1 / 20.2; phone 0 34.1, 1 26.9, 2 39.5, 3 26.8, a 27.9 (the floor about 19.7; the hero about 27 / 16.3).

**Sheet:** `sheets-owner/sheet_balance.png` (five rows; carry, run, settle, 0.25 s after the cut at 2 - 3x and the whole
frame, 720p then phone; the hero in every tile).

**The author's pick: 2.** It reads as letters first (digits on a dark body, a stroke outline), it is brighter than the
hero, and the robe (blue), the trousers (grey) and the scarf (sand) stay apart. Where each fails: 0 thin and colourless;
1 barely above the floor (26.5 against 20.2: weaker than the hero), and the digits cover only his lit side, so he is narrower than the hero; 2 still narrow, the
face does not read, the strip is one pale stroke; 3 at fight distance hardly differs from a (the interior lines were
few letters wide already), so it still reads as a drawn figure; a the owner's complaint.

**Not checked.** A real phone. The close look for clipping was done in films at a 7 m camera for the draw and the run
only; nothing clipped there that shows at fight distance.

---

## 2026-11-23 — CI in four parallel jobs; docs-only PRs skip the tests (ADR-153)

**Owner**, after asking why every PR's check takes ~12 minutes when their other games deployed at once:
"lets go with your previous recommended changes" (the parallel jobs and the docs-only skip; the
up-to-date rule kept, no paid runners). Branch `build/ci-parallel`, PR #92.

**Why it was slow.** Setup and build take ~10 s; `npm test` is ~50 minutes of headless boss fights (the
Starless Lord alone ~640 s), run four at a time on one 4-core runner: 12-15 minutes a run. The repo is
now **public** (the 2026-11-22 CI entry below says private), so standard runners cost nothing.

- `tests/run.mjs --shard I/N` runs one of N shares, dealt from each task's `est` (its seconds in a CI
  share), longest first, each to the lightest share: every task in exactly one share, a new task dealt
  by itself. `--list` prints the shares.
- lord runs as three tasks: `fxlooks` (it replays SPELLS and TERRAIN under four looks: about half the
  suite), `pace`, and the rest. lord.mjs, duel.mjs and asc.mjs take a comma list and `GCD_SKIP`.
- ci.yml: `changes` (is anything outside docs/, *.md, .claude/ changed?), four `tests I/4` jobs
  (fail-fast off), `build`, and `test-and-build`, which waits for them and is still the one required
  check (no protection change). Docs only: tests and build skip, `test-and-build` passes in seconds.

**Measured** (PR #92's first run): 4 min 19 s from push to green, was 12-15 min. Longest tasks: lord
fxlooks 228 s, integ 214 s, duel 174 s. The same checks run; none is dropped.

**Next, if it is wanted faster:** fxlooks's four replays could run as separate processes (each against
the '0' replay), and integ's rest could move more scenarios out; the floor today is ~4 minutes.

---

## 2026-11-22 — Session 79: the grove's bamboo sliced in one stroke, in clumps, the back filled

**Owner:** "make the bamboo in windless grove all sliceable in 1 swoop and make sure it falls the moment the sword is going through. have the bamboos more varied, beautiful and some clumped up. i want the bamboo falling to be a cool spectable as the fight happens. have way more in the back empty area as well". Branch `world/bamboo-slice`. ADR-151 / Session 79 / M1.63.

**What changed.**
- Sliced pieces (`slice: true`, `BREAK.slice`, destructibles.js `_sliceFall`, `RangeBody.cutY`):
  any blade or blow cuts a stalk through where it bit, the cut shown in the frame of the blow, the top
  sliding off the cut then going over and bursting into leaves where it lands; the stump on that
  slant. Not a body brushing past, not fire.
- The grove's bamboo (`?bamboo=0|a|b`, `windlessGrove.js` `groveBamboo`, `bambooStalkOf`, `SPECIES`,
  `BAMBOO`): five kinds of cane, three thicknesses, fanning clumps with shoots, fuller crowns; 11 clumps
  behind him in the clearing, a denser belt behind him, the wall out to 50 m. `a` ships.

**Found on the way.**
- The cut showed a frame late (the top's run was only rewritten at the next pose): it is written in
  the frame of the blow now (the test `slice` checked it).
- The belt's back bias was inverted: the first build had 158 stalks toward the camera, 127 behind.
- Filming with real-time captures dropped frames under load (identical frames, a clip that ended
  before the canes landed): the clips are stepped one game frame per picture.

**Verification.** World test `slice` (one quick cut, power 0.12, fells a stalk; cut at the blade's
1.15 m; the stump 1.02 - 1.27 m on a slant; nothing of the top below the cut; it moves the first
frame, slides 0.27 m along the blow, lands in 0.79 s; quiet; a brush does not slice; a boss's cut
does, at 1.6 m; the reset). `bite` across every level. Rendered `?bamboo=0|a|b` from four views and
filmed the hero's light and heavy swings through a clump (9 and 6 stalks cut; MP4s). `npm test`:
see the PR.

**Not checked / open.** Nobody has played it; not on the phone (0.56 M -> 0.89 M vertices drawn);
the owner picked `a`, mixed clumps, from the sheet.

## 2026-11-22 — Session 80: the Sheathed, easy to see (ADR-152; one Opus agent from the planning session's brief)

**Goal.** The owner on the live grove: "its hard to see the new boss character. make it look detailed like the
main character". Their answers: the hero's ink-line art (not bigger letters), the homage carried by the
silhouette, a mark of his own, his motion and his lines; three palettes to pick from.

**What changed.**
- The print (`sheathed/look.js`, new): `?sheathArt=a` in `PICKED` (the prototype's `?sheathArt=a`, from the
  local branch `enemies/sheathed-letters`, is the base), `0` the wyrm's digits. `SHEATH_TONE` a / b / c,
  `SHEATH_LIFT` (rim × 3, scarf and mark × 3.6), `tintWanderer`. His hair on `shirt`: the `hair` part's
  shared ink lines are the hero's gold, and they drew an orange outline round his dark hair.
- The silhouette (`gear.js`): `ROBE_TAILS` (a loose robe to mid-thigh, open at both sides, over the
  trousers), the high tail 0.46 → 0.60 m and thicker with a pale tie, the scarf's turns 7 / 4.5 → 8.5 / 6 cm
  and its ends 6 → 8 cm, its tails `out` 0.14 → 0.03 (they stood off his back), pale wrist
  bindings. Mark a: `STRIP` on both scabbard pieces (the left-wrist piece's springs appended to the rig's in
  `_setup`; the draw kicks them). Mark b: a white streak on `facing`.
- Motion (`poses.js`, `moves.js` draw()): the carry (head bowed 0.12, left thumb in the sash), the breath
  (k 0.8 → 0.65, period 3.4 → 4.6 s), `SHEATH_RUN` and his own `duelLoco` (sink 8 cm, pitch 0.16 at a run),
  the settle: a head-only key at 0.4 × grip, then the settle key eased in. Timings untouched.
- Lines (`levels/grove.js`) and eight labels (`moves.js`); Training's mikiri text, COMBAT.md's table.
- `sheath.mjs` LOOK: the default print and palette, the scabbard darkest, the hair off the gold part, the
  mark's springs, ADR-126's hand audit through One Breath (0.166 m worst outside the cut), every option.

**Measured** (headless Edge on the GPU; the mean luma 0 - 255 of his pixels / of the floor behind him; p90):
1280 x 720: digits (as live) 40.0 / 16.3, p90 128; the prototype 22.2 / 16.3, p90 88; now 31.9 / 16.1, p90
116 (b 33.4, c 31.9); the hero 25.2 / 20.1, p90 105. Phone camera (17 m): now 45.4 / 16.5 (digits 49.1), the
hero 39.7 / 21.6. The digits are brighter on average but read as a column of numbers; the ink-line print reads as a
figure with its parts. The drawn blade's pixels: mean 105, p90 185, against his figure's mean 32, p90 108 -
114. ADR-126 audit (filmed): One Breath's worst hand step outside the cut 0.183 m, the same as main (0.183), the
cut's one frame 1.0 m on both; the run 0.112 m (main 0.08), no planted foot sliding. `sheath.mjs` LOOK: 0.166 m.
The scarf's tails: at rest 0.04 rad off hanging, at a run 0.87 rad (they trail; an `inMax` tried first held
them against his back and was dropped).

**Sheets for the owner** (not committed): `sheets-owner/` in the worktree: the print before / after, the
palettes, the mark, the draw and run film strips (before = main).

**ADR number.** 152, not the next free number on `main` (151): a parallel session's grove bamboo work
claims 151 (`?bamboo=`), so this skips it to avoid a clash at merge.

**Open.** The owner's picks of the palette and the mark. Not checked on a real phone. The model viewer draws
him alone, so its tiles have no hero beside him (the game-camera tiles do). The mark at the game camera is a
couple of letters at rest; it reads when it trails.

## 2026-11-22 — Session 78: a sixth level, the Windless Grove and the Sheathed (planned in its own chat, built by one Opus agent)

**What changed.** The owner asked for new level bosses on the power fantasy of famous characters, as
originals; this one is a swordsman whose blade stays in its scabbard until one draw the hero must parry or
die, with a draw-slash as his fixed reward. Built from the planning session's plan (ADR-144 – ADR-146):
- `?level=grove`, the Windless Grove (`levels/grove.js`, `world/windlessGrove.js`): 366 bamboo stalks as
  light range pieces, 108 paving slabs, the Sword Grave (40 light planted swords, the great sword), a
  stele, lanterns, boulders, a ruined pavilion; `?grove=a|b|c`.
- Lu Wusheng, the Sheathed (`enemies/sheathed/`): three phases of moves as data, the sheath on the rig
  (carry / settled / drawn, a left-wrist piece posed by `lsw`), the draw's rule (lethal unanswered, a held
  guard knocked open and never hurt, the honor gate, `stopOn`, no draw within 1.1 s of a blocked one), the
  cut as one white line and a wake, the grove falling on the re-sheathe's click, phase 3's hanging cuts
  (`lateCuts.js`), links, the scabbard's dull trail, the sheath's sounds (a breath, the click; synthesised).
- Engine (optional fields, other kits unchanged): brain.js `draw` / `stopOn` / a move's `recoverOpen` / a
  per-phase `cooldown`, `_honor` and `_delay`; player.js takeHit's `breaksGuard`; destructibles.js `light`;
  duelist.js `onCounter` overrides.
- One Breath (`game/unlocks.js`, `ONE_BREATH`): guard + hold HEAVY takes the iai's coil stance once learned;
  release a 5 m blink cut; the draw counter (46 / 40, no crit). The help, the victory line, the Lab toggle.
- Lab (lethal draw, the sheath, One Breath, LOOKS rows), Training (his own kind, three draw situations),
  `tests/integration/sheath.mjs` (LEVEL, RULES, DRAW, HONOR, SHEATH, WORLD, TIMING, PHASES, LATE, PACE,
  TRAINING, REWARD, WIN; STRATEGY opt-in).

**Measured.** PACE 56 / 71 / 77 cues a minute by phase (the mean of five seeds, 60 s each; one seed's phase 3 under its phase 2), 0 conflicts;
STRATEGY (god mode) mixed 32 - 39 s, parry 41 - 43 s, dodge 66 - 76 s, block-only 49 - 57 s and never killed
by a draw; TIMING 0 ms worst.

**What changed from the plan, and why.** Three Autumns' later draws wind up 0.78 s as the move table says,
so the rule "every draw >= 0.9 s" became ">= 0.9 s, or 0.78 s for a draw that follows another in the same
move". The record's `light` field was taken (a burning piece's point light): the def field is `light`, the
record's `lightPiece`. Shutting the Door 16 → 18 and The Blade Goes Home's second cut blue (18) to sit in
his damage bands. No `look.js` (nothing is dressed by phase). The PACE defender rolls the draws (parrying
them made every phase as slow as the caught recoils). One Breath reuses the hero's iai coil (the right
hip), as the planning session's addendum asked.

**The owner's picks (2026-11-22, from the sheets):** the recommended option of each: `?sheathLook=a`,
`?drawCut=a`, `?grove=a`; the others stay behind their switches. The same day the owner asked for a body
nearer the genre's wandering swordsman: `?sheathLook=d`, the Wanderer (a slighter man in a faded indigo
robe over wide charcoal trousers, a long sand scarf, dark hair in a high tail), added as a fourth option
and rendered beside `a`; the owner then picked it: he ships as the Wanderer. It stays an original: none of the marks of any existing character.

**Next / open.** The bamboo crowds the frame at the game camera (the owner's eye); the score
(borrowed tracks); a human on the phone through the draw; One Breath's balance bot on Shen Hui (not run).
## 2026-11-21 — Session 77: a fifth level, the Foxfire Terrace and Wen Yao, the Thousand-Body Fox (planned by Fable, built by Opus agents)

**Owner** (to the session that planned it): new level bosses built on the power fantasy of famous
characters, as ORIGINALS; two picked to make now, "plan out #1, #2 in separate chats with fable and
instruct opus 5.5 high to build it out". This is #1: a duelist who fills the arena with clones that pop
in one hit while the real one charges a spiralling orb; a last phase in a fox-spirit cloak of fire; a
fixed reward, a decoy clone. In the spirit of a famous ninja-clone hero, an original: his own name,
mask, outfit and move names, none of that series' look. Branch `claude/thousand-body-fox-33750d` from
`origin/main` 9333ce7, `main` merged in three times (#76; #77, #81, #83, #86, #87; #88). ADR-147, ADR-148 /
Session 77 / M1.61: the plan's ADR-131 and ADR-135 were taken meanwhile (by #76 and #81; the parallel
builds' plans claim 132 – 146), so this work took the next numbers no one had claimed.

**How it was built.** The plan (Fable's, in the shared notes) was built as written; the lead wrote the
core first (the level, the boss on the duelist engine, the paper selves, the Pearl, the mantle's
gameplay, a first suite) with stubs for the set, the body and the effects whose surfaces were fixed,
then three Opus agents in their own worktrees at once: the set (`world/foxTerrace.js`, two landmarks),
the body and its look options (`thousandFox/gear.js`, `look.js`, `poses.js`), the effects
(`thousandFox/fx.js`, the foxfire palettes, the paper tear). Meanwhile the lead did the Lab, Training,
the suite's scenarios, the pace and the cost; then merged, measured and wrote this.

**What exists** (ARCHITECTURE "The Thousand-Body Fox", COMBAT "The Thousand-Body Fox", STYLE "The look
switches" and "The fox's effects"): `src/levels/foxfire.js` (`?level=fox`), `src/world/foxTerrace.js`,
`src/entities/enemies/thousandFox/` (`fox.js`, `moves.js`, `tuning.js`, `poses.js`, `links.js`,
`clones.js`, `pearl.js`, `fx.js`, `gear.js`, `look.js`, `bodyArt.js`), nineteen moves, `tests/integration/fox.mjs`
(12 scenarios in `npm test`, two opt-in: `smoke`, `cost`).

**The owner's turn (2026-11-22), after the PR was opened:** "make the boss look as recognizable [as] the
referenced character and use its signature moves ... with different names", then "as similar without
causing copyright issue ... a fist fighter". The lead said once that a recognisable copy of a
character's design is a copy whatever it is called (ADR-116, and the plan's own rule), and pushed the
homage through what nobody owns. The change, built the same day (the lead the moves and the class, the
body and the effects agents again):
- He fights BARE-HANDED: Tian Lei's exported strike builders (`ascendant/moves.js` X: punch, kick,
  elbow; authored round the same left-lead stance), Tian Lei's bare-handed reaction clips compiled round
  his own guard, the striking limb as the engine's blade (Tian Lei's way, copied into fox.js). The dao
  is gone; the right fist is wrapped on the sword joint.
- The selves fight as a PACK: the Round, a self holding the Pearl with him, a self throwing him (Fox
  Descending: he springs off its cupped hands into a leap).
- The orb is shaped in his OPEN PALM and DRIVEN into the hero on a dash (the thrown volley kept as Pearl
  Rain, phase 2).
- Phase 3 is the NINE-TAILED FOX of the old tales: one tail as it wakes, nine as his bar runs out.
- The look: b, the Wild Fox (an amber sleeveless jacket, a streaming vermilion scarf, a wild crest of
  dark red-brown hair, a kitsune half-mask at the temple), now the default the fight draws; the pick is
  still the owner's. None of the character's protected signature: no orange jumpsuit with black
  shoulders, no forehead plate, no whisker marks, no emblem, no blond spikes, no hand seals, no names.

**The fight.** One bar, three phases (66 % / 33 %): P1 The Fox Plays (2 selves at most), P2 A
Thousand Bodies (4: the trade of places mid-string, Fox Descending, the Round, Pearl Rain), P3 The
Nine-Tailed Fox (5: the tail, the pounce, the black pearl). The selves are his own bodies, a pool of
five hero rigs built with him (ADR-147): they tear free round the hero, walk in, cut one at a time
under the fairness guard (told to the ledger, cued as his blows, parryable), pop in one hit (the cleave
pops the one beside it), have no body circle and no shadow; his posture break pops them all. The
Pearl: fed by a thread from each self, starved by popping them, interrupted by two cuts on him while
he charges, dodged by a roll. Asleep he sits among four selves that tear away as he rises. His reward,
the Paper Double, is recorded on the level and not usable (ADR-148), in the shape of the shared
rewards store a parallel build adds (the planning session's change).

**The agents' parts.**
- The set (world agent): the round terrace with clipped rim slabs and a lighter kerb, lanterns, stone
  foxes in profile, charm posts of wood, the great fox (west) and the spirit gate (east) in
  `landmarks.js`, 445 breakables, 380 bones (the courtyard's 443), 11 draw calls alone, built on a quiet
  `Math.random`; a `terrace` scenario in `world.mjs` (run last: it draws from the destructibles' stream).
- The body (body agent, twice): one `fox.*` item per slot; bare-handed, four outfits (`?foxLook=a|b|c|d`:
  49 / 37 / 50 / 49 meshes, Shen Hui 82): a the Shrine Fox, b the Wild Fox, c the Pelt Brawler, d = a in
  ink-line; low-gain dark cloth, `loud()` for the bright colours; `?clones=b` 30 % toward paper. The art
  path still reads as a small figure of digits at 720p; b survives it by its colour, d reads clearest.
- The effects (effects agent, twice): foxfire in jade (the void slot), the spinning palm orb and the
  drive's blast, the threads, the volley's mark and bursts, the pops (paper slips; the springboard's
  thrown up), the nine-tailed fox spirit (tails fanned in the camera's plane, one budget), the roar,
  a bare-handed blow's trail, the paper tear; the field's phase-3 worst case 1596 of 6000, mostly the
  engine's black cue.

**Decisions where the plan was open.**
- The scatter is a feint beat (no tell, no glint: a cast with no blow must not announce one) that the
  fox's `beatMotion` acts on at its impact; so is the Round's call. The director weighs moves by their
  cues a second, which puts a cast with no blow near zero: `densityAs` makes it weigh as a move of
  about one cue a second.
- The Round is realised for the selves alive as it starts (`FoxBrain.startAct` passes the count; four
  realisers, n = 2 .. 5): his blow's windup is `0.42 n + 0.68` s, the slots filled from the last back.
- A Round self's cut is its one cut; the token rests through the Round.
- The selves may fight on through the scatter and the black pearl too (`clonesFight`), not only the
  Pearl's charge, and phase 3's token rests 1.2 s (the plan's 1.4): phase 3 was otherwise quieter
  than phase 2.
- Training: `debug.tidy()` (a generic optional hook: `training.js` `_prep` calls it) puts his selves and
  pearls away between situations; it listens to `dragon:stagger` and `dragon:clone` too. ROLES.fox
  `long` is his flurry (Hand to Hand is phase 2: a phase-1 situation could not start it). Two
  situations of his own: Pop the copies, The Pearl burst in his hand.
- A self that only walks is posed every other frame (the hero's animator is about 1 ms a rig): the
  plan's first fallback, taken at once.

**Found on the way.**
- The rigid batcher's 1024 bone slots: the hero, the fox, five selves and the set did not fit (Shen
  Hui's rig is 82 meshes, each a bone). The bone texture now grows to 128 rows (2048) the first time a
  batch would not fit; the shader only reads its width; a level that fits never grows.
- A Round self kept `round` after its cut and cut again at once; the scatter could tear selves off a
  dead boss in a long test. Both fixed.
- Subagents share the lead's scratchpad: two of them filmed from the same `rig/` folder. Give each its
  own subfolder in the brief next time.

**Verification.** `npm test` (13 tasks with fox) green on the merged branch; `npm run build`. The fox suite: 12
scenarios (levels, data, timing, clones, pearl, mantle, phase, flow, pace, win, training, looks; 2 m 23 s
alone): every move's contact within 0 ms of its flash + 0.3 s; a reset mid-charge and with pearls in
the air and with five selves out leaves nothing; 65 Training situations (two of his own). In headless
Edge on the RTX 4090: the level from the Lab and from `?level=fox`, five selves in phase 3 at 1280 x
720 and 852 x 393 (`?touch`); with five selves out the draw calls go 79 -> 149, the render pass 1.1 ->
1.6 ms (720p) / 1.1 -> 1.5 ms (852 x 393), a whole frame step 2.3 -> 3.6 ms. The selves' animators
headless: 1.3 ms a rig, halved by posing a walking self every other frame (measured with the dao
gear; the bare-handed rigs are lighter: 37 - 50 meshes against 82). Pace, bare-handed, five seeds x
120 s: 68.3 / 80.2 / 79.3 cues a minute, 0 conflicts; the fencing bot wins in 34 - 45 s. The sheets:
`docs/looks/fox/` (body, clones, foxfire, mantle, pearl, springboard, pop, arena).

**Not checked / open.** Nobody has played it. Not measured on a phone (frame rate with five selves out: six hero rigs,
149 draw calls). The art-path outfits read as small figures of digits at 720p; the mantle reads as a
jade wreath more than a fox's head at the game camera; the bat's red flare hides the Pearl in flight;
the black pearl reads mostly as the engine's dark dye; the charm posts' paper strips are faint at 30 m.
The audio's paper tear was not heard. The seated intro is untested by eye beyond a still. The selves
strike while his AI is off (the Lab, Training's "Pop the copies" uses it). Music is borrowed. The palm
orb is a few letters at the game camera; the nine tails read as a fan of jade flame more than nine
separate tails; amber prints near orange (a vermilion jacket is a one-line swap). `pop.png` still
shows the dao-armed selves. The numbers were rechecked against origin/main (167f429).

---

## 2026-11-22 — Session 76: Tian Lei as a recognizable homage (the orange gi, the instant beam)

**Owner:** "make the boss look as recognizable its the referenced character and use its signature moves
that people will easily recognize ... ascii looking versions of these iconic characters with different
names to avoid copyright issue and to show its a homage". Branch `enemies/ascendant-homage` (on PR
#81's tip). ADR-150 / Session 76 / M1.60. The lead said once that a new name does not cover a
character's design and the game is public; the owner's call.

**How.** `BRIEF4.md` (the scratchpad), two Opus agents in their own worktrees: **look** (three bodies
behind `?ascLook=`) and **moves** (the cupped-hands beam, the instant beam, the pale gathered sphere,
wink names proposed). Every look an option; the owner picked from rendered sheets.

**What changed.**
- **The body: the orange gi** (`h`, the owner's pick): an orange gi over a blue undershirt, blue
  wristbands, sash and boots, black spikes; gold spikes standing up in form 2, longer and sharper in
  form 3; the eyes teal in forms 2 - 3. `g` (a purple gi; form 3 the swept-up gold hair with one lock
  over the brow) and `v` (a blue bodysuit, white armour, a flame of hair) stay behind the switch with
  `a` (the tunic, the old default), `c` and `d`.
- **Instant Wave** (form 3, new, the default game): the sign, he is 4 m to the hero's side, both hands
  cupped at his hip, a red point-blank beam 0.94 s after the arrival (12 x 1.6 m, lit 0.5 s, 24).
- **Options, not picked yet:** `?ascBeamPose=cup` (every beam out of cupped hands at the hip) and
  `?ascOrb=c` (Heaven's Lantern as a pale sphere as large as its hit, gathered arms straight up).

**Verification.** `asc.mjs . all` green (the `body`, `instant`, `orbc` scenarios new); PACE over ten
seeds F1 80.6 / F2 84.2 / F3 96.3 cues a minute (means), longest gaps 2.53 / 3.25 / 2.75 s, 0
conflicts; `duel.mjs . fxlooks`; glyphcheck. Filmed at 1280 x 720 in the real level (sheets
`look4-*`, `moves4-*` in the scratchpad's rig).

**Not checked / open.** Nobody has played it. At the game camera the gi's colours carry the body; in
forms 2 - 3 the gold hair melts into the gold aura (all bodies alike there). The cupped hands are a few
letters at 40 px: the light at the hip is what reads. The sphere is near white (the field has no blue).
The wink names (Crane Wave, Spirit Lantern, Instant Step ...) are proposed, not applied. Two sessions
answered the lookalike request differently on 2026-11-22 (the Sheathed's declined it): the owner to say
which line holds.

---

## 2026-11-22 — CI: one run a change, a time limit, a read-only token

**Owner**, after asking how the `test-and-build` check works and what it costs (the repo is private:
Actions minutes come out of a monthly allowance): "do the 3 worth doing edits". Branch
`build/ci-tidy`; `.github/workflows/ci.yml` only.

- **No run on a push to `main`.** The protection requires this check on a branch that is up to date
  with `main`, and merges are squash or rebase (admins included), so a merge puts on `main` the tree
  the PR's run already tested. The second run doubled every merge's minutes (~12 each) for no new
  information. The concurrency group is now the PR's number alone.
- **`timeout-minutes: 25`** on the job (a run takes ~12): a hung test no longer runs to GitHub's 6 h.
- **`permissions: contents: read`**: the job's token can no longer write to the repo.

**Not changed, and why:** docs-only commits still run the whole set (skipping a required check
leaves it unreported and blocks the merge; it would need a job that passes early). The npm cache was
filled by `main`'s runs; a PR now fills its own on its first run (three packages: seconds).

---

## 2026-11-21 / 22 — Session 75: bites, the letters come off where the blow lands

**Owner:** "i want the player to be able to destory the terrain and have the ascii pieces fall of
exactly where the player or enemy boss is hitting. can we do this to make every background object
destrutcible like minecraft/lego?" Branch `world/chip-where-hit`. ADR-132 / Session 75 / M1.59.

**What was there.** Nearly everything that stands breaks already (ADR-107, ADR-120, ADR-122), but as
whole pieces: a blow takes structure, a tree drops its crown parts in a fixed order at three stages
(a blast at a pine's foot took its top two tiers), a stone takes a nick, and the chips fly from one
point. Nothing came off where the blow landed.

**What changed** (`BREAK.chip`; behind `?chip=a`, the Lab's WORLD -> Bites; off ships until the owner
picks):
- every breakable is the BRICKS it is drawn with: its triangles, the two halves of a flat face being
  one brick (foliage stays single). With bites on the level is built with the bitten pieces' faces
  cut to 0.8 m (`forest.js` `refine`: the same shape and picture);
- a blow takes the bricks nearest where it struck, as many as the share of the piece's structure it
  took (`_hit` -> `_bite`): a blade from where its segment met the piece at the blade's own height
  (`o.ya` / `o.yb`, new; the hero passes his blade's two ends), a blast from its own centre, so it
  eats the side that faced it. The structure arithmetic is untouched;
- a brick of a solid part is set back into the piece (0.42 of its thickness there, at most 0.3 m); a
  leaf, a bough, a thin bone is folded away;
- each brick falls as its own letter from where it sat; every third leaves a letter lying until the
  reset; where a bite shows, the nick mark is left out and the splinter spray cut to 0.3;
- 'range' pieces (the forest's trees, the landmarks) rewrite the triangle when their run is written
  (`RangeBody.bite` / `_writeBits`); rigid-batch pieces (stones, boulders, pillars, statues) move it
  in the batch's positions or fold it in its index (`MeshBricks`; `rigidBatch.js` records each
  source's `userData.batchRun`);
- with bites on a tree does not drop its crown parts in order; a crown part 72 % eaten drops whole; a
  wind front's wear bites the windward crown. The range pieces' bricks are made four a frame after
  the load (not five hundred inside a roar's half second).

**Found on the way** (each from a rendered sheet or a failing check, not from reading the code):
- The first bites were triangle-shaped (diagonals across a stone's face): the halves of a flat face
  are one brick now.
- A blast beside a tree ate it evenly (23 bricks on the near side, 22 on the far): the bricks were
  counted from the point of the footprint the disc touched. Counted from the blast's own centre:
  80 against 16, the 16 being the trunk's own.
- Trunks and boulders were far coarser than "a letter cell": a pine's trunk is two rings of 1.3 - 2.6
  m faces, a boulder 20 triangles, so a cut took a 1.4 m slab. Hence `refine`. Its first form
  (every long edge cut, 0.6 m) took Cinderwood from 0.92 M drawn vertices to 1.52 M; longest-edge
  bisection at 0.8 m, stumps and thin parts left alone, the deep forest 2.5 x coarser: 1.07 M.
- Plain holes were wrong for solid things: the meshes are hollow, so a holed boulder opened onto
  black ground and a trunk cut half through looked as if the tree floated; a second option that took
  a wider patch left a standing stone's top hanging over a gap (dropped). Hence the set-back.
- My first set-back wrote each brick's way in over its normal while the loop was still reading the
  normals: half a stone's bricks found no wall behind them (111 of 210). The test's count showed it.
- A patch script of mine cut three accessors out of `RangeBody` (`parts`, `visible`); the next test
  run failed on the first line that read them, and they were put back.

**The blade stops** (the owner, after the sheet: "this looks good but theres no impact or animation
hitting the background object. it looks like im just hitting through it. it should chip at it
realistically and the sword should stop when it hits it instead of going straight through it").
With bites on, a cut that meets a piece it does not cut through stops on it (`player.js`
`_bladeStops`, `BREAK.chip.stop`, `destructibles.struck`): the attack clock goes back to about where
the edge met it, the frame freezes (wood 0.075 s, stone 0.095), the camera shakes, steel on stone
sparks, the blade sticks in wood 0.11 s, then the duelists' bounce throws it back (0.25 / 0.45 m). A
cut that fells or breaks the thing goes through with a 0.05 s freeze. The bitten chips are knocked
out of the struck face toward him. Filmed (12 frames, 50 ms apart, the real swing, bites off and on):
off, the blade sweeps through a standing stone and a dead tree to the ground; on, it stops at the
face (a flash and sparks off the stone, splinters off the tree) and is flung back. Integration
scenario `bladestop`: on, a light cut into a boulder and a dead tree chips each, freezes, stops the
cut at 0.142 / 0.158 s of its 0.230 and bounces; a felling cut goes through; off, the same cuts run
through to 0.467 s as before. The owner, on the sheet: "Keep it": the stop stays as tuned.

**On by default** (the owner: "Yes, turn it on"). The call sites' default is now `a`; `?chip=0` turns
bites off. Every test now runs with bites on; the first whole run found three things:
- `world budget`: destructibles.update worst 73 ms. `brickSink` compared every brick with every other
  (the Cinder Tree's trunk: 74 ms). Now a dense grid of the centres, the search capped at the depth
  that matters (max / k), a part with no wall that near set back the most if it is closed (its
  area-weighted normals cancel) and holed if open: the trunk 9 ms, all of Cinderwood 221 ms. A warm-up
  a few pieces a frame still broke p99.9 (1.9 ms against 1.5: a tree costs 1 - 2 ms), so every piece's
  bricks are made at the level's build. Then: avg 0.02 ms, p99.9 0.86, worst 1.2 - 2.1.
- `lord` TRAINING, "Build his streak, he answers": done in 2.2 s with no flurry. Traced: the hero's
  cuts stopped on the crater's rim slabs and a shard (2 m away, real contact within the blade's 0.24 m).
  Moving every situation's hero clear of pieces broke four flurry situations, so it is opt-in:
  `clear: true` on that one situation (Training `_crowded`, `CLEAR_SPOTS`).
- `world` WEAR / PLACED: the crown parts no longer drop in stages with bites on (by design); those two
  scenarios run with `?chip=0`, the path that still has them.
A contact check (`touch`) first set to 0.15 m made the blade pass a dead tree it had chipped; it is
0.25 m, the blade's own hit radius.

**Every level, and the rule written down** (the owner, 2026-11-22: "is the destructible terrain
applied to all stages as well? make sure instructions are documented for future agents to make all
background objects destructible and follow the same rules"). Merged `main` again (#83 the throne's
props, Tian Lei's third wave: they took Sessions 72 / 73 and M1.56 / 57, and then the impact pass took
Session 74 / M1.58, so this is Session 75 / M1.59; ADR-132 stays). The world test `bite` now walks the level registry instead of a list of
arenas, so a new level is checked with no change. It found two things: in Cinderwood a blow on the
Cinder Tree's high boughs and the Elder Wyrm's fingers took structure and showed no bite (no brick
within reach): such a blow now takes the bricks nearest it however far; and the training room
(`?stage=lab`) lists nothing that breaks, which is kept on purpose (a measuring stage; the test
checks it). Results: Cinderwood 664 pieces, the courtyard 162, the crater 144 (with #83's props),
the Skybreak Ring 35, every piece with bricks and a blow on each kind biting it. The rule for future
agents: CLAUDE.md "The world breaks, letter by letter" and ARCHITECTURE.md "Making a new object
destructible" (a 7-step checklist).

**Merged with `main`** (the same evening: PR #73 - #75 had landed, the Skybreak Ring and the hero's
look; they took ADR-129 / 130, Sessions 69 / 70, M1.54 / 55; then PR #76, the phone, took ADR-131 / Session
71; on 2026-11-22 Tian Lei's third wave and the throne's props took Sessions 72 / 73 and M1.56 /
57, so this is ADR-132 / Session 75 / M1.59).
The new level's pieces go through the same batch path: the test covers it.

**Verification.** World test `bite` (15 checks: a quarter-cut takes a quarter of a tree's structure
and 11 of the 42 bricks within 0.8 m of the blade, all of the trunk, set back toward its axis; every
other brick where it was; 5 such cuts fell it with none of that section left; a blow on a stone's
south face takes 32 of its 210 bricks, all on that side, set back in the batch's positions; a blast
east of a tree: 80 bricks east, 16 west; a rib loses bricks; a floor slab does not; the reset puts
every vertex and index back; the courtyard's 162, the crater's 111 and the Skybreak Ring's 35 pieces that
take structure all have bricks, a blow on one of each kind bites it and the reset undoes it; off: no
bricks). In the browser (headless Edge, the real GPU, 1280 x
720), the same blows with bites off and on: a stone, a boulder, a dead tree, the lone pine, the Elder
Wyrm's ribs, and the hero's own cuts at the game camera (3 cuts: 3 bricks off the stone; 6 cuts fell
the pine, away from him). A piece before any blow looks the same built either way (the stone, the
boulder, the dead tree side by side). `npm test` here, on a machine other sessions were loading with their own suites (93 node processes at
the end): the first whole run, before the finer bricks and the set-back, passed (all nine tasks). The
run on the finished code: `integ` (all five tasks), `duel` and the static checks passed, `lord` never
reported, and `world` passed 333 checks and failed one, its wall-clock budget for
destructibles.update. That check is the machine, not this change: alone on a quieter machine it read
avg 0.013 ms, p99.9 0.5, worst 1.46 (budget 0.5 / 1.5 / 8), and at the end an untouched `main` failed
it with the branch's numbers (avg 0.29 - 0.33 ms, p99.9 28 - 30 against the branch's 0.23 - 0.25, 24 -
30). `npm run build` passes. The whole suite on a clean runner is the PR's check.

**Not checked / open.** Nobody has played it. The duel arenas are checked by the test (and the courtyard
loaded and struck once in the browser), not studied on a sheet. Not on the phone,
and the frame cost of the extra vertices is not measured. The ground itself does not break (ADR-132
"Not done"), nor the landmarks that were decided to stay whole. A set-back brick cannot be struck
again (one layer), and nothing falls for want of support.
## 2026-11-22 — Session 74: a landed cut has weight (the impact pass)

**Owner:** "how can we make the games combat more impactful and feel weight? i want the hits to look
realistic where it lands and show some kind of ascii animation to show the impact. think of ideas to
suggest using fable and once we approve, use opus to implement it". Branch `combat/impact-weight`.
ADR-149 / Session 74 / M1.58.

**Proposed and picked.** Nine ideas: A the hit stamped in the letters, B a ripple through the struck
body, C wounds that stay, D the body reacts by where it is hit, E a spray along the blade, F the
ground answers heavy blows, G the same care when the hero is hit, H the sound's weight, I an impact
frame. The owner: "Build first batch" (A, B, D, H). After the side-by-side clips and the lead's
recommendation: "Your recommendation".

**How it was built.** The lead (Fable) wrote the plan and a core of switches and stubs; five Opus
agents built the pieces in parallel worktrees on it (the stamp, the ripple, the duelists' reaction,
the wyrm's reaction, the thump). The ripple was sent back for a second round: round one read only
when two frames were diffed. A sixth Opus agent filmed same-take before / after clips and sheets for
the owner (12). The merge had one conflict class: two scenarios inserted at the same spot of
`integ.mjs`.

**What changed.**
- The core, `combat/impact.js`: `IMPACT` (`pieces`, `on`, `k`, and `by`, the owner's scale per kind
  of struck body), `impactOn(piece)`, `impactK(piece, who)`. `?impact=off | all | stamp,ripple,...`;
  the Lab's 'impact' row (four toggles). `PlayerFx.contact` hands the stamp and the ripple one
  record at the drawn contact (tier, cut, edge, hilt, crit, power, low, target); the reactions read
  `takeHit`'s own record, the thump `player:hitDragon`. With every piece off the game draws, sounds
  and plays as before (each piece's scenario checks it).
- **The stamp** (`combat/impactStamp.js`, a branch in `cutFx.js`): the hit as a stepped animation
  written into the letter grid in the fire field's `steel`. One 12 px blob per letter cell, snapped
  to cell centres; each frame held 0.04 s of fx time (it runs through the freeze); 4 frames, about
  0.16 s (the execution 5, 0.2 s). Shapes by tier: a slit that opens and splits (light, sweep,
  cleave; the cleave adds a cross and grows with the charge), a pierce with rings (point), a star
  (slam), a puncture with two rings (execute). Rings are flat hexagons cell by cell. The anchor is
  the contact pulled 2.5 m toward the camera (at 1 m the wyrm's contact sat inside its body and
  nothing printed). Its cells print on black (one fire-field tint zone); no cell over the hero.
  `?stamp=instead` draws it in place of today's slash line (an option).
- **The ripple** (`render/impactRipple.js`, the ASCII pass): a pressure wave from the contact through
  the struck boss's letters, up to 4 at once, riding with the boss, projected each frame with the
  final camera. Round 2 (`wave`): nothing in the first 2.5 cells; a thin bright front, a trough up
  to 60 % darker behind it; letters pushed outward 3.6 - 5.5 px and back; strokes along the front on
  the wyrm. Reach 9 - 12 cells for a light cut, 36 - 45 on the wyrm and 17 - 19 on a man for a slam,
  a cleave or the execution. Boss cells only.
- **The reaction, the human bosses** (`duelist/react.js`, `reactTuning.js`): a drawn layer over the
  pose, like the shudder. The head tips along the blade (back for a thrust), the torso twists (a
  thrust folds him), a struck leg buckles and he drops 6.5 cm with the feet planted. Heavy x1.55,
  crit x1.12, a flurry's cuts x0.7, the Starless Lord x0.82; a heavy blow that shoves him kicks up a
  little dust at his feet. Hurt spheres, hit stun, shove, guard, AI and the move's clock never see
  it (the test: on and off identical).
- **The reaction, the Cinder Wyrm** (`dragon/react.js`, `tuningReact.js`): the head snaps away and the
  neck carries it, a neck cut whips, a body cut shoves the trunk and lashes the tail, a leg buckles,
  a wing jerks and folds, a tail lashes to the tip. Light x0.4, heavy x1, crit x1.25. Put on after
  `_step` and taken off before the next one: AI, rig, hurt spheres and attacks run on the plain joints
  (the test: identical over 90 ticks). `dragon.drawnPoint(v)` puts the cut's effects on the drawn,
  reacting body. The old flinch stays under it.
- **The thump** (`audio/thump.js`): a sub voice (a sine and its octave gliding 70 -> 38 Hz, a soft
  clip, a 420 Hz low-pass) under the slam, the cleave, the execution, a heavy sweep or point, the
  flurry's last blow and any crit; a light cut gets none. A heavy blow dips the music only
  (`thumpDip`, never the cue bus) by 4.5 dB for about a fifth of a second; one dip per 0.5 s, a blow
  inside a holding dip extends it, so a chain cannot pump.

**What the work found.**
- *Today's effects hide the new pieces.* The white blade flare covers frames 0 to +4 of every hit (a
  charged cleave about 6 frames of the whole crop); the swing arc sweeps through the contact at about
  +6 to +11, when the stamp shows its split lines and ring; the slash streaks stack on its first
  frames; the jolt, the camera punch and the wyrm's flinch move the picture more than the reactions
  do at the game camera.
- *The stamp does not read on the wyrm.* A light cut shows 2 - 3 cells; slam and cleave are nearly
  invisible under its bright digits and the hero standing in front of the contact.
- *The reactions are small at the game camera.* A duelist at x1: 3 - 4 px for a light body cut, about
  9 px for a heavy head cut, 2 - 5 px for a leg, on a figure about 40 px tall ("barely reads", the
  filming agent). The wyrm at x1: 4 px for a light chest cut, about 13 px heavy, about 11 px for a
  side cut to the head.
- *The thump adds little.* Heavy blows already carry almost all their energy below 100 Hz, and the
  master compressor (threshold -14 dB, ratio 4) pulls the whole mix down 8 - 12 dB on each, the cue
  bus too. On offline renders at x1 the sub adds +0.2 dB below 100 Hz on the slam, about 0 on the
  cleave, +0.7 on the execution; what changes is +2 dB (cleave) / +4.5 dB (crit) between 160 and
  400 Hz, which a phone plays. Nobody has listened to it in the game yet; an audition page went to
  the owner.

**The owner's picks** (the lead's recommendation, taken): the stamp at medium, over today's slash
line, on the human bosses only (`IMPACT.by.stamp.wyrm` 0); the ripple at its default; the reactions
x1.5 on the human bosses, x1 on the wyrm; the thump at x1. Next, a before / after with today's
contact flare and swing arc toned down (accepted, and done in the same PR: below).

**Calm at the contact** (the follow-up, in this PR). An Opus agent measured what hides the new
pieces by switching today's effects off one at a time on a frozen take: the struck boss's white
hurt flash (the wyrm's whole struck body goes white) and the hero's steel lit by the strike are
the big ones; the hit's own blade flare (+0.5 / +0.75) and the cut's core are negligible, so
COMBAT.md's "x1.62 / x1.95" was not what you see. `combat/impactCalm.js` dims those together in
levels 0 - 3 (0 = as before), read at the hit, the same random draws at every level, the slash
line kept, a missed swing and steel on steel untouched; one line each in `dragon.js` and
`duelist.js` takes the hurt flash through `calmBossFlash`. Clips: today / 1 / 2 / 3 on the Ash
Disciple and the wyrm with every piece on, and today vs 2 at the play framing. The lead
recommended 2; the owner, given the clips and the two preview links: "lets go with calmer 1". Level 1 is the
default (`CALM_DEFAULT`; `?calm=0` draws the contact as before; the Lab's 'impact' row has a
`calm N` button that cycles it). Level 1 is the gentlest: the halo round the contact shrinks, the
stamp's first frames show a little more, nothing is lost. The stamp still does not read on the
wyrm at 2 or 3, so it stays off there.

**Verification.** New scenarios: integ `stamp`, `ripple`, `wyrmreact`, `thump`; duel `react`. The
stamp's and the duelists' react scenarios pin their piece at strength 1. `npm test`: all 12 suites passed on the final branch (with `origin/main` #76 merged in and the picks applied; 312 s), and `npm run build` built. The `world budget` timing check failed in every agent's run while six suites ran at once, and fails the same way on the base commit under that load. The pieces
were filmed in the browser side by side at the game camera (the agents' and the filming agent's
captures).

**Not checked / open.**
- Nobody has played it. Not looked at on a phone: the ripple's first version compiled and drew on the
  LOW / touch path, the second was not checked there.
- Not filmed: the execution and crits for the stamp and the ripple, a flurry and Tian Lei for the
  reactions.
- At x1.5 a heavy thrust's reaction moves a point 0.085 m between two frames once (the duel test's
  0.06 m bound is for x1).
- While the wyrm's reaction is drawn its hurt spheres stay where the simulation has them, up to about
  1 m off the drawn body for 0.2 - 0.5 s; phase 3's fire comes off the simulated points.
- For the owner: the game's existing low end is pure sine (silent on small speakers), and the
  compressor flattens every heavy hit, tells included.
- Rig lesson for captures: with the AI off a duelist keeps his guard up and turns every cut (a guarded
  hit returns before `PlayerFx.contact`); on a fresh duelist level the flow sat in 'title'. Enter the
  fight and drop his guard first.

**Next.** The second batch if the owner wants it: C, E, F, G, I. Calm at the contact on the phone and
on crits, the execution, the Lord and Tian Lei.

## 2026-11-22 — Session 73: round the Obsidian Throne, what the challengers left

**Owner:** "the trees and background stuff on the obsidian throne is all incorrect and not realistic.
replace the trees with more unique random breakable stuff and make sure it looks good and in the
right angles". Branch `level/throne-props`. ADR-133 / Session 73 / M1.57 (#76 and the open #77
both took ADR-131 and Session 71; this skips past them).

**What was wrong.** Round the crater the forest lay felled: every trunk the same straight log, laid
exactly radial in a starburst, in the screen grid's tree letters (not the dragon look the crater's
own plates and shards are drawn in). From the game camera it read as a ring of matching sticks.

**What changed.**
- `world/starfallProps.js` (new): 13 builders in the prop art path (`carve()`, a tone per facet),
  each piece built afresh from the rng (size, lean, state, parts): stone lanterns (standing, leaning,
  thrown), steles on turtles (some snapped), broken pillars with their drums, a thrown shrine roof,
  wine jars, split boulders, the star's rock in its furrows, heaved earth, glass splinters, graves of
  swords, spears with a torn banner, wanderers' cairns, wrecked carts. Faces turn to the camera;
  what fell lies along the blast's way out, turned off it; everything rests on a face.
- `world/throneHall.js`: the felled-forest loop is behind `?outskirts=0`; otherwise 125 spots on a
  stream of their own (the layout's `rng` is untouched: the trees were its last user), a bag of kinds
  by the option's weights. Within 43 m of the seal each piece is a breakable (stone leaves rubble),
  beyond it merges into the static stones; none topples. Nothing over 3 m on the near side of the path (a banner
  there becomes a cairn): the duel stays in view. The `add()` helper skips an empty mesh.
- `lookSwitch.js` `PICKED.outskirts = 'c'`, a Lab LOOKS row (build time: a reload).
- Tests: `world.mjs` sets (the throne lists swords, banner, cairn, cart), `lord.mjs` level (`metal`
  is a material of the crater's pieces; the counts).
- **The fairness guard, a gap it had on main** (`brain.worldClash`, asked by `destructibles.js` at a
  felled piece's flash): the new objects shifted the seeded sims (three.js uuids come from the seeded
  `Math.random`) and `lord.mjs` pace seed 4242 form 2 met a void push told at 109.68 s and a rim shard
  his crescent felled at 110.07 s, their flashes 0.25 s apart (main passes the seed on its own
  sequence). The push's hold could not clear it, so now the piece lands uncued and harmless when a
  blow of his already cued needs the other answer near its landing. `GCD_PDBG=1` showed the order.

**Options, rendered for the owner** (in-game sheets, kept locally and not committed: on the
path, both sides of the crater and pulled back, and a close-up of each piece): A the shrine the star
fell on, B the star's own debris, C those who came for him, MIX. **The owner picked C.** The others stay
behind the switch.

**Verification.** `npm test` (all suites), `npm run build`. Headless Edge captures of the default
(no parameter) at the game camera: C drawn, the near side low. The throne: 255 breakables (222
before), 365 bones of 1023.

**Open / next.**
- The owner plays it. The pieces never topple (`topples: false`): with them toppling, the Lord's
  crescents felled banners onto the hero mid-move (`lord.mjs` pace, seed 4242: a void push and a
  falling banner within 0.3 s). His terrain moves use the rim's pieces as before.
- The jars, lanterns and roof (options a / m) were not tuned for burning or lifting beyond defaults.

---

## 2026-11-22 — Session 72: Tian Lei's third wave: the sign, the counter stances, the great orb, the barrage

**Owner:** "implement more iconic dbfz moves like spirit bomb, teleport attacks with the dragon ball
teleportation animation, flurry of projectiles like vegeta, etc. i want more counter moves as well".
Branch `enemies/ascendant-moves` (from main 9333ce7, after #73 and #75). ADR-135 / Session 72 / M1.56.
As with the level (ADR-129): the FEEL of each, built as originals; nothing of the franchise's names or
look.

**How.** The lead read the merged kit, wrote `BRIEF3.md` (the scratchpad), added the engine contracts
first (one commit: the counter stance, the sign, several counters a form), then ran two Opus agents in
their own worktrees from that commit: **ki** (`kiShots.js`, `moves/kiShots.js`, `tuningShots.js`, fx:
the orb and the barrage) and **sign** (`moves/melee.js`, `links.js`, `tuning.js`: the sign and its
moves, the three counter stances, the ripostes). Each filmed its moves in the real level and ran the
suite; the lead merged both, applied their "needs" lists, tuned the pace meter, regenerated the move
tables and wrote the history.

**What changed.**
- **The engine** (`duelist/brain.js`, `duelist.js`; optional, the other bosses unchanged): a beat
  marked `stance` on a feint with a bait hold is a **counter stance**: from 30 % of its windup a sword
  cut that reaches him is CAUGHT (no damage, no posture, the hero's blade thrown back as by a deflect,
  `dragon:guard { caught }`, the HUD's "CAUGHT") and the move jumps to the beat's end, so the punish
  after it starts at once; a stance nobody cut into ends the move at its impact and leaves him open
  0.6 s with his guard down. `brain.catching()`, `onCaught`, `_stanceMiss`, stats `caught` /
  `stanceMiss`. A blink marked `sign` vanishes at u 0.5 of the windup, not 0.1, and a close-in waits
  for the vanish. The kit's `counterMove(form)` draws from `COUNTER_LISTS`.
- **Tian Lei's moves** (`moves/melee.js`, `moves/kiShots.js`; the tables in COMBAT.md are generated):
  - **THE SIGN**: two fingers to the brow, the snap of light at the hand (`fx.signSnap`), the vanish,
    the blow from behind. **Sign Step** (form 2: a hook from behind, a knee, a palm that locks) and
    **Three Signs** (form 3: a cross from the left, a round kick from the right, the red axe kick from
    behind, each out of its own sign); the sign retrofitted onto the first vanish of Vanishing Step,
    Storm Waltz, Mirage and the thunder Riposte (their first windups raised to 0.72 s).
  - **Three counter stances**, one a form, light drawn into the open palms (`fx.stanceGlow`): **Still
    Water** (a cross, then a palm on a dash that locks), **Golden Mirror** (a vanish behind, the
    launching uppercut, the hammer where the hero lands), **Thunder Mirror** (a bolt point-blank, a
    signed vanish and the axe kick).
  - **Three more ripostes** out of a deflect (a knee and a round kick; a vanish behind, a hook and a
    palm; a hop back and a bolt a perfect parry returns), drawn with the old three.
  - **Heaven's Lantern** (forms 2 - 3): he rises 2.5 m and gathers the great orb for 1.8 s (the ring's
    light dims to it), then throws it, 10 m/s, 2 m round, falling onto where the hero will be (no
    homing); blue: a parry or a block is safe, a roll passes it, and a PERFECT parry starts **THE PUSH**
    (the lock at range: won, it flies back into him for 120 and 220 posture and he reels 3 s; lost, 40,
    knockdown, thrown 10 m). Two looks for the owner: `?ascOrb=a` a sun (the default), `b` a lantern.
  - **Raining Suns** (forms 2 - 3): he leaps 3 m and pours sixteen small blasts down in 2.2 s (every
    third one on the hero, the rest to his sides, pocking the floor; a held guard is not worn through),
    then a returnable finisher from the air.
- Links, weights and cooldowns for all of it; Training 'ascSign', 'ascCatch', 'ascCatchWait',
  'ascLantern', 'ascSuns' (105 situations); the Lab's LOOKS row `ascOrb`; scenarios `sign`, `catch`,
  `ripostes`, `lantern`, `suns` and the engine scenario's catch (a synthetic stance) in `asc.mjs`; the
  timing scenario cuts into a stance; the pace meter counts a stance while it is catching and the
  orb's gather as busy (as a black blow's charge).

**Decisions on the way.** The sign agent shortened the stance's hold from the brief's 0.7 - 1.0 s to
0.2 - 0.4 s and lowered the stances' weights for the pace meter's gaps; the lead then made the meter
count the catching window as busy (it is a decision for the hero, as a charge is) rather than push
the weights further down. The ki agent put only every third blast of the barrage on the hero: all
sixteen on a held guard wore it through (GUARD.costMin 8 x 16 and the finisher), and the owner's rule
is that a block is always an answer.

**Verification.** `asc.mjs . all` green on the merged branch (DATA 292 realisations, forms 13 / 25 /
28 moves); PACE over ten seeds: see the figures in COMBAT.md's Tian Lei section and the PR; 0
conflicts throughout. `glyphcheck`, `changelogcheck`, `duel.mjs` (the engine changed). Filmed in the
real level at 1280 x 720 (the agents' sheets: `ki3-lantern.jpg`, `ki3-suns.jpg`, `sign3-sign.jpg`,
`sign3-catch.jpg` in the scratchpad's rig), the push on the phone preset.

**Not checked / open.** Nobody has played it. The owner has not picked the orb's look. At the game
camera the hand at the brow is a few cells under the aura: the snap and the streak carry the sign. The
orb is drawn smaller (about 3.2 m) than its hit (2 m round, 2.5 m reach across). The push's crater and
camera are not tuned. Not filmed on a real phone.

## 2026-11-21 — Session 71: the phone: bars that do not overlap, and two ways to free the right thumb

**Owner**, playing on the iPhone: "the boss hp and main character hp ui is overlapping. i'm also
having a much harder time playing it on mobile because of having to constantly use the same finger to
hit different parry and block while attacking at the same time ... think of ways to improve the
controls, ui, and design as well". Branch `ui/mobile-play`. ADR-131 / Session 71.

**The overlap, reproduced.** Not at the 852 x 393 preset the phone work was checked at: Safari gives
an iPhone 15 Pro about 734 x 343 in landscape (the notch sides and the address bar are not the
page's). There the hero's HP row ended at x = 242 and the boss's bar began at x = 217, same line.
Headless Edge at that size showed it in every level.

**What changed.**
- `ui/hud.js` `_fit()`: the top row is fitted to the screen (ADR-131). Narrow touch screens: the
  hero's meters 16 cells, HP as one number; the boss's bar takes the room between the hero's rows and
  LOCK, shorter when it must be. Checked at 734 x 343 (all four levels), 667 x 320, 568 x 320,
  852 x 393, 393 x 700 upright, 744 x 1000 (a tablet upright): no overlap in any.
- `ui/touch.js`: PAD LAYOUT (classic / split) and HOLD ATTACK, two pause-menu switches, off by
  default, kept with the pad's place and size. Split: GUARD beside the stick (above it upright), the
  right cluster keeps ATTACK / HEAVY / DODGE. Hold: `input.pulse('@attack')` 0.22 s into the hold and
  every 0.1 s after, paused under the guard and for 0.32 s after DODGE / HEAVY / FLASK.
- `tests/integration/integ.mjs` (touch scenario): two thumbs hold ATTACK and GUARD at once and the
  guard cuts the swing short; a held ATTACK is 1 cut with the switch off and a string with it on,
  none while GUARD is held, a dodge from a second finger still rolls; the top row is clear at 844 px
  and at 560 px (the boss's bar cut to 37 cells).

**Not verified.** Everything above is the emulator and the headless sims. Where GUARD stands (178 px
in, level with the stick) is my guess from thumb reach on a 6.1 inch phone; how the two switches feel
is the owner's to judge on the device.

**Next.** The owner tries `?pad=split&hold=1` on the phone and picks the default (and GUARD's place).
Then the ideas ADR-131 lists: the game under the notch, a drag-to-place layout editor, an "add to
home screen" hint.

## 2026-11-21 — Session 70: the hero looks the same on every screen

**Owner**, with a picture of the hero at the game camera: "this picture of the character is the exact
type of feel and look i want. its not too detailed but has enough ascii features and style. make the
character have this feel on every angle, movement, attack etc. ask me any questions to help you
out". Branch `player/hero-look-everywhere`. ADR-130 / Session 70 / M1.55.

**What the picture was.** The live game: the hero from behind at the 36 m camera on a 720p frame,
enlarged three times. Rendered again on other screens (the same moment, scaled to the same size), the
cause showed at once: his letter cell was a fixed 4 px, so he was 9 letters across the cloak at 720p
and on the phone, 13 at 1080p, 18 at 1440p. On a large screen he was a different figure.

**Questions, two rounds, each with rendered sheets.** Where does he not look like the picture: "on my
screen in general", "from the front or side", "in attacks and dodges" (not "when the camera is
close"). Bosses: "hero only for now". Then the picks from three sheets (1440p, one option per row):
letter size **B, the picture** (of finer 12 across / the picture 9 / bolder 7); the sword **B's blade,
today's arc** (dark until it cuts; of today's glowing blade / cold steel / dark until it cuts, the
arc dimmed or kept); the front view **A, legs like the cloak** (of today's white outlines / the
cloak's dotted rim / a lavender line).

**What changed.**
- `render/pipeline.js`: `_updateHeroLetters` sets his cell each frame from his view depth: 0.115 m a
  cell (`CONFIG.render.heroLetters`), snapped to `HERO_CELLS` with hysteresis, never below the bosses'
  cell; from 20 m in to 6 m back to the fixed cell. 4 / 6 / 8 / 12 px at 720p / 1080p / 1440p / 4K,
  4 px on the phone.
  The hero branch of the art pass is one function, run for him on his cell (inside the box round his
  screen point) and then for the bosses on theirs. His ink lines are found per font pixel.
- `render/materials.js`, `player/model.js`: the player's rig (`buildHero(.., { self: true })`) writes
  its part ids in an alpha window of its own (0.42, 0.45), so the pass tells him from a boss per
  pixel. His own part tables `uSelfPart*` = `HERO_INK` + `HERO_SELF` (the plate's dim dotted rim).
- `render/glyphs.js`: the micro-font atlas at any cell size.
- `player/player.js`: `TUNE.bladeLook` (dark steel at rest, no dot halo), `TUNE.bladeFlare.strike`
  4.2 / 4.6 scaled by `bladeHot` (a strike's window, the charge, the flurry, the plunge, a crit
  window; up at once, gone in ~0.1 s). The flare is written to HIS part 17.

**Found on the way.**
- With the hero branch called twice the HLSL compiler warned ("gradient instruction used in a loop")
  on a FRESH compile only: the browser caches compiled programs, so a reload showed nothing. Changing
  one comment in the shader forces a recompile and shows the log. The pass now reads every texture at
  level 0 by name. One warning is left and was there before (`stoneCell`, a possibly uninitialised
  variable).
- A white block at the sword's point at rest is not the blade: the point rests in the grass and the
  "seen through cover" pass (ADR-106) prints it. It was hidden by the white blade before. Left as is.
- From one side at rest the blade points at the camera and its lines pile into a small pale mark next
  to the gem's glow. Smaller than before; left.

- Review (Codex, on the PR): his alpha window (0.42, 0.45) overlapped the top of the unused v0.2
  creature grid's codes (`grid: true` wrote up to 0.44), so such a surface would have been drawn as
  the player. The creature grid's span is now 0.37 (codes end at 0.41), written and read with the
  same constant; a test pins it.

**Verification.** In the browser (headless Edge, the RTX 4090): the hero on 720p / 1080p / 1440p / 4K
/ the phone's 852 x 393 at 20 m before and after; 18 poses at 1440p (six sides, run, roll, cuts,
heavy, block, charge, heal); the camera at 36 / 24 / 14 / 7 m. Both human bosses rendered on this
branch and on the code before it, side by side at 1440p: the same letters. Frame cost at 1440p and at
852 x 393, 31 x 12 frames a reading, alternating the two builds: 0.82 - 0.87 ms against 0.89 - 0.94 ms
before, the same within the noise. New test scenario `heroletters` (his cell per screen and distance,
the hysteresis, the box, the two windows, his part tables against a boss's, the dark blade at rest);
the blade flare checks in `hero` and `cutfx` now read his own part 17 and expect dark steel at rest.
`npm test` / `npm run build`: see the PR.

- The first build held the large cell in close-ups too. At 8 m on a 1440p frame the close-up's ink
  lines (one font pixel wide) came out five pixels thick and white: a different close-up, which the
  owner had not ticked. Now the cell goes back to the fixed one as the pass fades to its close-up
  look (20 m .. 6 m), so the title, an intro and the Lab are pixel for pixel what they were.

**Not checked / open.** Nobody has played it. Not measured on a phone (the phone draws the same 4 px
cell as before through its whole camera range, 11 .. 34 m). Closer than 20 m the old close-up look
(bright ink lines) still fades in: the owner did not ask for that to change. The
swing's arc and his other effects are full-resolution glyph sprites next to 8 - 12 px letters on a
large screen: the fire field would print them in letters. The human bosses keep the fixed cell: the
owner decides after seeing the hero live.

---

## 2026-11-21 — Session 69: a fourth level, the Skybreak Ring and Tian Lei (planned by the lead, built by Opus agents)

**Owner:** "lets build a saiyan level boss where phase 1 starts from normal saiyan, phase 2 is super
saiyan, phase 3 is super saiyan 2. make the background the cell tournament arena and make it feel like
an anime epic battle. help me come up with the moves, combos, specials from the boss and use opus to
build this out". The lead said first that it would be an original fighter and arena in that spirit, not
that series' characters, names or place; proposed the moveset; the owner: "Build it". Branch
`enemies/ascendant-boss` from `main` (91f17d4), `main` merged in once (66ff1fa, ADR-126). ADR-129 /
Session 69 / M1.54.

**How it was built.** Three read-only mapping agents (the duelist engine, the level and world code, the
effects and the body) → the moveset and four facts of the engine that changed it (ADR) → stubs for the
level, the boss, his gear and his effects with the effect surface fixed, so the level loaded on day one
→ **wave 1**, four agents in parallel, a worktree each: core (his class, three forms, bare hands, his
melee, the engine's new beat fields, his suite), world (the set in three arenas), body (three outfits
with hair by form, and the dragon-look twin), effects (gold, the aura, blasts, the disc, the beam, the
vanish, the transformation) → the owner's picks from the sheets → **wave 2** on the merged core: shots,
beams, strings, terrain (the ki was split in two owners by the kind's name so no two agents shared a
file) → an integration agent (the merge of `main`'s ADR-126, the asks between agents, the checks that
need everything together) → a tuning agent and a docs agent in parallel. Twelve agent runs; the lead
wrote the briefs, looked at every sheet, merged, and wrote this history.

**What exists** (ARCHITECTURE "Tian Lei, the Last Ascendant", COMBAT "Tian Lei", STYLE "The Skybreak
Ring"): `src/levels/skybreak.js` (`?level=ring`); `src/world/skybreakRing.js` (a 30 m ring of 361
breakable tiles, corner posts with braziers, buttes whose tops come off, the light by form: dusk, gold,
a storm with lightning and rain; arenas b and c behind `?ring=`); `src/entities/enemies/ascendant/`
(`ascendant.js`, `moves.js` + `moves/melee.js, kiShots.js, kiBeam.js, terrain.js`, `ki.js` → `kiShots.js`,
`kiBeam.js`, `terrain.js`, `poses.js`, `links.js`, `tuning*.js`, `gear.js`, `look.js`, `bodyArt.js`,
`fx.js`, `fxBeam.js`); about forty moves; `tests/integration/asc.mjs` (26 scenarios; `npm test` runs it).

**Found on the way.**
- The first merged build was not readable: the tiles' gold strokes were as bright and busy as the
  fighters. The paving was calmed and the dusk lifted (figures against floor 2.0x → 3.3x in form 1); the
  owner kept it.
- A sword cut landing in the last 0.1 s before the great beam fired spent its blue head (`_tradeNow`).
- The beam agent could not get a clash on the phone: its capture rig's one-frame virtual press never
  registers as a parry. The game was fine; the clash runs at 852 x 393.
- The tuning pass found why bot fights are short at any bar: an answered flurry breaks him outright.
- `main` moved under the work (ADR-126 reworked how a duelist's move becomes a clip): one conflict
  (`realise.js`), no clip of his needed a change, and the feet question was settled by measuring.
- CI failed twice on the PR in world's `budget` (the forest's `destructibles.update` read at the 99.9th
  percentile of 3600 frames: 1.65 and 2.53 ms against 1.5), with `destructibles.js` unchanged and every
  suite of that run 1.5 - 1.8x slower than `main`'s. Measured here: the same 0.3 - 0.6 ms on `main` and on
  this branch, alone, beside four suites, and with the whole run pinned to 4 cores. His suite made the
  4-core runner's pool heavier, so `tests/run.mjs` now runs that one wall-clock scenario ALONE after the
  parallel tasks (`ALONE`; world.mjs takes `GCD_SKIP` and a comma list). The budget itself is unchanged.

**Verification:** `npm test` (11 suites: integ x5, lord, asc, duel, world, glyph check, changelog check)
and `npm run build`: see the PR. Browser (headless Edge on the real GPU, 1280 x 720 and 852 x 393): every
option sheet the owner picked from, each move filmed in the real level, a whole fight through three
deathblows with every system on (0 errors, 0 NaN), resets in the middle of seven moves, the clash on
the phone preset.

**Not checked / open:** nobody has played it. Fight length (COMBAT "Measured": the table of four bar
settings; shipped 2000 a form) and whether an answered flurry should break a whole bar are the owner's
to judge on the preview. The visual polish list in the ADR's last point. The level's own music. A real
phone.

**Next:** the owner plays the Vercel preview; then the bars, the flurry rule and the polish list from
what they report; the score's audition page.

---

## 2026-11-21 — Session 68: a felled tree lies as the blow left it

**Owner** (after the picture of the wall opening): "make the cleared trees not look the same and have
it broken in different angles based on how it was hit". Same branch, `world/crumbling-border`
(PR #70). ADR-128 / Session 68 / M1.53.

**Rebased onto #71 and #72** (2026-11-22, the owner: merge the open PRs). This part was ADR-126 /
Session 66 / M1.51 before #71 took those numbers. `TUNING.world.meter.wall` stays at #72's 0.25. On
the new `main` the Lord's pressure check failed on the default three seeds: the F3 step of the seeds'
mean x1.043 < 1.05 (93.7 -> 97.7 cues a minute; `main` x1.084). Cause, bisected: this part's felling
(`destructibles.js` / `wreckage.js` / `breakTuning.js`; the crater's wood falls off the blow's line
now). Over nine seeds (4242, 7, 99, 1, 2, 3, 5, 11, 13) the step is x1.082, `main` x1.089: the default
seeds' luck, not a slower form. The Lord's `meter.rampMean` F3 1.05 -> 1.035.

**What was there.** One squat stump per tree, built at load; a fall straight along the blow; one
straight log from the stump in one of 3 shapes; a burnt tree's black log at a random angle. From
above a cleared stretch was rows of the same log pointing out.

**What changed** (`BREAK.fell`, per kind of blow; a stream of its own in `destructibles.js`):
- the stump's run is reshaped when it shows (`RangeBody.reshape` / `unshape`): its height by the blow
  (a blade where it bit), its top on a plane slanted along the blow, splinters, a push toward the fall;
  burnt through, low and black (its `aCol` darkened);
- the fall turns off the blow's line (`spread`) and rolls about its trunk (`spin`);
- the trunk (`_logs`) turns as it lands, varies in length, rests with its far end raised, and for a
  share of falls breaks in two with a kink; `wreckage.js` has 3 crooked log shapes with a snapped
  bough (2 black ones), and `log()` takes a `pitch` (a log has `size` and `len`, its reach over the
  ground);
- 40 % of the trees that burn through stand as a black snag on their stump.

**Found on the way.** The world `spread` check failed in the full suite and passed alone: it hangs on
a ~9 % chance (a burning tree's four tries to pass the fire on) drawn from a module stream that every
scenario before it moves. It now starts that stream from a known point (`reseedBreaks`).

**Verification.** New world `lie` (36 trees by a blade, a blow, a blast: 35 different stump heights;
a blade's stumps x1.55 of the built height, a blow's x1.33, a blast's x0.90; 12 of 12 knocked-over
stumps torn higher on the fall side; 64 trunks for 36 trees, 24 turned, 20 raised, 6 shapes; 8 burnt
through: 4 snags, every burnt stump dark; the reset puts every stump back). In the browser (headless
Edge, the real GPU, 1280 x 720), the same stretch felled the same way on the code before and after:
before, straight logs and alike stumps; after, kinked and broken trunks, a standing snag, stumps of
different heights and slants. `npm test` / `npm run build`: see the PR.

**Not checked / open.** Nobody has played it; not looked at on the phone (it adds no per-frame work).
The stump is one cut plane, not a split trunk; the Cinder Tree and the landmarks keep their remains.

---

## 2026-11-21 — Session 67: the drake's glare from every side

**Owner:** first "i'm not liking the dragons face at all. can you make it look very anime evil and
scary looking? give me 4 variations"; four anime faces were built and rendered (fiend, oni, wraith,
blade: leaf eyes with slit pupils, zigzag grins, black skin, lines of fire) and turned down: "i dont
like any of these, the eyes look very weird. i like the drake standing view where the eyes look
angled and angry. make that look in all angles. i want it to look realistic and scary". Then "Yes,
finish it" on the result. Branch `dragon/drake-eyes`. ADR-127 / Session 67 / M1.52 (125, 65 and M1.50
are PR #70's).

**Why it only worked standing.** The drake's eye was an ellipsoid lying in the head's side wall: in
the standing three-quarter view the head's pitch tilted it into a slant; from the side it was a level
oval, from the front a blob, from above a dot.

**What changed** (drake only). `heads.js` `eyeMesh` takes `leaf` (an almond swept along a slanted
line, a point at each corner, tallest at `peak`); the drake's eye is one, turned out, up and forward
(`rot` [0, -0.68, 0.6]) so the slant shows from every side. `DRAKE_BROW` drops low over the snout and
rises steeper than the eye, set inboard so the eye shows from above; a bony rear rim of the orbit
and a slanted two-part dark hollow seat it. The eye glow is a touch softer (`emit` 1.3).

**The tests' random stream, again.** Two more geometries on the brow turned the seeded `pressure`
check red (seed 7: 40.5 < 67.8 < 75.4 cues a minute, not x1.12 a phase). Bisect copies of `main` in
the scratchpad proved the cause: `main` + 8 unused `Math.random()` draws at build gave exactly the
numbers of `main` + 2 unused geometries. The end-of-build reseed (ADR-124) came too late: the wyrm
rolls its starting state inside its constructor, right after `buildDrake` has drawn the ids. Now
`Dragon` and `Player` call `game.onModelBuilt?.(who)` right after their model is built, and
`integ.mjs` reseeds there; with it `main`, `main` + extra draws and the new eyes give the identical
fight. The new stream put the wreckage check's wall share at 29 % inside the whole suite (44 % run
alone): `TUNING.world.meter.wall` 0.3 -> 0.25, as `endShare` beside it already notes for the same
effect.

**Verification.** Rendered before / after from nine angles standing and four roaring, and the new
eyes through phase 2 and its roar, the ignition, phase 3 ablaze, a hover barrage, a breath and the
death. `npm test` ALL 10 PASSED on `main` with #71, `npm run build` OK.

**Second round, same PR.** The owner: "make the eyes a bit smaller, also the dragon does a weird
twist angle that looks like his neck is broken. fix that". Eyes: `leaf` len 0.28 -> 0.21 (h, slant
scaled with it). The neck, measured (scratch probe: the head's roll about its snout and the angle
between the neck's last segment and the head): at rest the hinge was 42-63° from every side, since
ADR-123's `HIGH` neck rose near vertical and still pointed ~16° up at the skull while the resting head
looked ~37° down; with the hero far to the front-left of a wyrm that hadn't turned, the head also
rolled 40°. In a 90 s fight the roll stayed under 6° and the hinge peaked at rest, so the fix is rest
only: `HIGH` arches over at the top (head ~1 m lower, still carried high; shape "e" of four tried),
the resting head may sit at most ~34° off the neck's end (`1.1 - 0.5 * s.rest`), and is levelled about
its snout by `s.rest`. After: roll 0 from every side, hinge 10-34°. Sheets in
`.claude/preview/drake-eyes/` (`eyes-smaller`, `neck-arch-*`).

**Open.** From straight above and at the game camera the eyes are small points; the scowl reads in
close and mid shots. Not seen on the iPhone. PR #70 changes the wall too; whichever
merges second reconciles `meter.wall`.

## 2026-11-21 — Session 66: the human bosses' attacks move like a swordsman's

**Owner:** "the humanoid bosses have weird attack animations and unnatural poses. analyze it and fix
it". Branch `enemies/duelist-motion` from `main` (91f17d4). ADR-126 / Session 66 / M1.51 (125 / 65 /
M1.50 are PR #70's, a session running beside this one).

**Analysis first.** Every move of both bosses was run in the browser (headless Edge, the real GPU)
with an audit that samples the rig each frame in his own frame: wrists, elbows, blade, head, pelvis,
ankles. 43 moves of Shen Hui, 63 of the Lord (each in its own blade form). What it found, on `main`:

| | Shen Hui | the Lord |
|---|---|---|
| sword hand's top speed, median over the moves with a blade blow | 19.4 m/s | 22.5 m/s |
| ... worst move | 38.0 m/s (0.63 m in one frame) | 37.9 m/s |
| moves over 20 m/s | 19 of 42 | 32 of 53 |
| feet sliding on the ground through a string (median / worst) | 3.7 m / 12.9 m | 9.9 m / 19.5 m |
| moves with the blade under 0.15 m from the head's centre | 3 | 20 |

Film strips (solid look, from his side and front) showed the rest: a cut was a held cock, one or two
frames of travel and a held follow-through; the spare arm stood straight out sideways with a fist
through every wind-up; the overhead ended with his hat's crown pointed at the hero.

**Causes, all in the shared engine** (`enemies/duelist/`):
1. `realise.js` laid a beat's follow-through keys (u 1..2) on the ACTIVE frames: 0.08 s for the
   whole follow-through, then nothing until the next beat's keys.
2. `poses.js` eased every segment to a stop (smoothstep per segment), and a chained cut began with a
   "gather" key authored for a cut from the guard: the blade went back toward the front and out again.
3. A field a beat did not key was interpolated from the last beat that did: `two`, `spX`, `hdX`,
   `arm` ran on. In a string an overhead's keyed hands were overridden by the blade-driven arm of the
   cuts round it.
4. `bladeArm` read the blade's azimuth back from its direction: a blade keyed past the vertical
   (el > 90 deg) reads back turned half a circle, and the fist jumped across him.
5. Clips pose the feet in model space and the brain moves the root (`close`, up to 2.4 m a blow):
   the feet went with it.
6. The Lord's flourish rolled his blade in a fore-and-aft plane through his hood and through the
   line of his forearm, where the wrist limit throws the blade from one side to the other.

**What changed** (ADR-126 has the decisions):
- `poses.js`: a clip's fields run on a cubic through their keys (`tangents`): a key is passed
  through unless the field turns back there; `i` still arrives at speed. `completeBeat` gives each
  beat every field it does not key (the guard's value on its first and last key). `bladeArm` takes
  the keyed [az, el]; past the vertical the fist rises a little and comes in over the shoulder; with
  both hands on the hilt its circle is smaller, nearer his middle and never far out at his sword
  side (the chest turns further instead).
- `realise.js`: a beat's follow (`b.F`, 0.24 s at most, 0.3 s for a spin, 72 % of the time to the
  next beat's first pose); `gather` keys left out of a chained beat and `settle` keys out of a beat
  another follows; a bait hold repeats the cocked pose at its end; `clip.steps`.
- `player/anim.js`: `_feetClip` (`CLIP_STEP`): for a clip with `steps` the feet stay on their world
  spots and step, one at a time; a lifted foot, a body off the ground or a dash is the clip's own.
  The hero's clips do not set `steps`: nothing of his changed.
- Both `moves.js`: the spare hand through a cut; `RAISED` (hands higher, the blade steeper) and
  `CHOP` (less bow, the head up); the thrust arrives a hand short and is driven through; Shen Hui's
  whirl on a hop with the feet going round (the Lord's already did); the Lord's flourishes 1 and 2
  as wheels across him.

**After**, the same audit:

| | Shen Hui | the Lord |
|---|---|---|
| sword hand's top speed, median | 14.6 m/s | 14.8 m/s |
| ... worst move | 22.9 m/s | 27.4 m/s |
| moves over 20 m/s | 4 of 41 | 11 of 52 |
| feet sliding through a string (median / worst) | 0.09 m / 1.15 m | 0.82 m / 3.18 m |
| blade under 0.15 m from the head's centre | 0 | 5 |

(What still slides is a dash or a blink inside a string: those frames are left to the clip.)

**Verification:** `node tests/run.mjs .` ALL 10 PASSED, no threshold changed; `npm run build`
passes. New: `duel.mjs . motion` (the three strings on the rig: hand travel a frame, sliding, a step
taken; every beat's follow in every phase; a beat owns its channels; the hand's target through Rain
of Ashes at 120 Hz). Filmed before / after on both builds side by side, at the game camera and close,
at half speed: three of Shen Hui's strings, four of the Lord's (one per form).

**Not checked / open:**
- Nobody has played it. The owner judges the clips and the preview.
- The Lord's left elbow still locks straight (over 170 deg) in 15 moves, down from 23: the staff's
  spins and the keyed two-handed poses. The five moves where his blade still passes near his head
  are his flips, cartwheels and the two leaps with the blade raised.
- Reaction clips (hits, staggers, the guard's clips, the intro, the deaths) run on the same cubic
  now and were looked at only in the fights filmed; they keep their feet as they were.
- The casting hand, the kicks and the courtyard's moves were audited by the numbers, not posed anew.
- Frame cost was not measured (the stepper is a few dozen arithmetic operations a frame per boss).

**Next:** the owner's look at the clips; then whatever still reads wrong, move by move.
## 2026-11-21 — Session 65: the tree wall opens; the fight leaves the clearing

**Owner:** "the terrain still isnt as destructible as i'd like. like the 1st dragon level, the outer
tree border ring should slowly crumble and allow the dragon and player to move outside as the dragon
destroys the trees with its attacks and fire". Branch `world/crumbling-border` from `main` (91f17d4).
ADR-125 / Session 65 / M1.50.

**What was there.** Since ADR-120 every tree of the wall breaks, but it changed nothing about where
anyone could go: the hero was held on a circle of 31 m, the wyrm's root on one of 24 m. Measured on
`main` first (WRECKAGE, seed 1337): 27 of the 153 front-row trees down after four minutes, all burnt.

**The edge** (`world/edge.js`, `BREAK.edge`): the ring is cut into 120 lanes; in each the hero's
ground ends 1 m short of the nearest wall tree still standing in it (62 m once none stands). A lane
is sealed at the old circle until its nearest tree is down, so a fight starts as it always did; a
sealed lane with no tree near the line (behind a landmark, the path south) gives way beside open
ground. The hero is kept by the lanes' ends and their side walls (`edge.keep`, through
`world.resolve(.., 'hero')`); the wyrm's bound is `dragon.boundAt(x, z)` = its 24 m + its share of
the opened ground in that direction (3 m narrower at each side of a gap, no steeper than 2 m per m
along the ring). `Destructibles` builds the edge from the pieces a set marks with `edge`, reads them
every 0.2 s and emits `world:edge` when ground opens.

**What had to follow.** The wyrm's collision, charge, leap and hop targets, flights and the terrain
moves' stand read `boundAt`; meteors and pillars land on the hero's ground instead of inside 27 m of
the centre, and a barrage's wave moves with a hero who has left the clearing; the wall's quiet-fall
rule asks whether a fall can reach his ground; every trunk out to 65 m has a collider (stumps out
there stand in his way); the minimap draws the opened ground and draws back; the feed says once that
the wall is torn open; the Lab's WORLD section has Open wall.

**Found on the way.** The first share for the wyrm (slope 1) let its root 13 m into a 28 m wide gap:
it stood 21 m from the hero and fought at range. An inset for its body plus slope 2 brought it to
11.5 m. My fight test picked its stretch of wall with a loop that found nothing and silently used
lane -1 (the Cinder Tree's side); it now asserts the pick. With a real stretch two of its checks
were wrong, not the game: the fight's own fire had already opened ground before the gap was torn,
and after `world.restore()` a wyrm in the air comes back inside on its next step on the ground.

**Verification.** `npm test` ALL 10 PASSED (215.5 s) and `npm run build` OK on the final tree. New: world `edge` (13 checks: the circle while the wall stands, one
tree down, a wedge, 20 000 random steps, the side walls, the red fall, the reset, a set without an
edge), integ `breach` (the hero walks out to 59.9 m, the wyrm's root follows to 50.8 m, 35 cues a
minute against 45, the reset). WRECKAGE reports the open ground: three seeds, 80 s a phase: lanes
open 33 / 21 / 52 by the end of phase 1 and 88 / 86 / 90 of 120 at the end, the furthest 51 / 54 / 51 m,
1664 / 1828 / 1415 m2 gained on a circle of 3019; front rows down 46 / 51 / 44 of 153; falling trees
on the hero 0. In the browser (headless Edge on the real GPU, 1280 x 720): the wall before, a gap
falling and open, the hero among the trunks at 42 m and at 61 m, the wyrm flying out after him and
fighting him there, the feed's line, the reset; no console errors.

**Not checked / open.** Nobody has played it. On the phone: not looked at (the edge itself costs a
read of 528 trees five times a second). A real player's use of narrow gaps is not measured. The
minimap is small: the opened ground reads on it as a notch, no more. After the Lab's Restore a wyrm
standing outside is pulled back in one step.

**Next:** the owner plays the Vercel preview: how fast the wall opens, how it feels to fight among
the stumps, whether the 62 m limit is ever reached.

---

## 2026-11-20 — Session 64: the Cinder Wyrm's face (the drake)

**Owner:** "I really dont like how the dragon face looks. It doesnt look realistic or scary. Give me 4
different variations to review", right after build C merged (#68). Then: "Go with the drake". Branch
`dragon/wyrm-face` from `main` (af00b12). ADR-124 / Session 64 / M1.49.

**What was wrong, photographed first.** At the game camera the face could not be found: a dark mass
under the neck's pale quills (build C lengthened them), the eyes one letter wide. Close up it was a
tube under the body's big white-rimmed scales, a fence of identical teeth printed as `|` strokes (the
teeth art has `strokeEdge: 0`), and a flat orange board for the inside of the mouth. The three
sculpted heads of ADR-120, re-shot on build C, had the same surface problems.

**Four faces, one kit** (`entities/dragon/faces.js`). The kit: fine face scales (`scale` [0.1, 0.075],
rim 1.1) under a hard key light (`light` key 1.55), so brow, snout and jaw print as planes; eyes about
0.11 long in sockets repainted with a near-black `pit` material (model.js, only when a face asks for
it); the lofts' mouth lining repainted `pit` too, with a red tongue (the `maw` material) and the
`throat` material at the back of the palate and on the jaw's floor, so the breath's charge lights the
gullet; teeth with an outline (`strokeEdge` 0.3) and big and small in turn; the neck's crest and mane
shortened over the last four segments (`nape`, read through `heads.js` `faceNape()`). The skulls:
**drake** (the predator loft of ADR-120 with new horns, fins and teeth), **tyrant** (the demon's loft
with an overbite and a crown), **viper** (a new flat, wide loft, sabre fangs outside the lip),
**revenant** (the predator loft with its front repainted as bare bone, a `mask` material). Six rounds
of renders; what moved the game-camera read most was the dark sockets and the cleared nape.

**The pick.** The drake is the default (`WYRM_FACE_SHIPPED`), first in the Lab's head row; `?wyrmFace=old`
is the face before. The other six stay behind the switch. Plumbing on the way: `heads.js` exports its
helpers and the `HEADS` table (faces.js registers into it), a face can repaint regions of a loft into
another material (`paint` / `paintJaw`: ellipsoids, z ranges, a `from` band, `except`), its extras can
return `hornTip` (the phase-3 horn fire, ablaze.js, reads `model.hornTip` first), and `buildSculpted`
passes a face's `teethOpt`.

**Verification.** `integ.mjs . wyrmface`: every head builds, keeps the head, mouth, snout and jaw tip
where the old head has them at rest and mid-roar (0.0 m), its eyes within 0.5 m, its lower teeth under
the hide with the jaw shut (drake -88 mm), at most one draw more (the hollows; the revenant two); the
drake is what ships; each face's measured horn tip reaches the fire. `wyrmlook` now compares the builds
on the old head (a build grows the old head's horns). The drake: 7170 head triangles (old 4192),
15 draws (14), 183 bones (181). Seen in the browser beside the old head: phase 2 and its roar, the
ignition, phase 3 ablaze, a hover barrage, a breath, the death, the phone frame.

**The tests' random stream (and what it turned up).** With the drake as default, two seeded checks
went red that both pass on the old face: a Cataclysm bite 85 ms off its flash and a 5.64 s gap
in a pressure seed. Nothing about the fight had changed: three.js draws a uuid from `Math.random`
for every object, and the drake builds more of them, so every later AI roll moved (the same thing
happened with the hero's shield, 2026-11-16). `integ.mjs` `build()` now reseeds `Math.random` once
everything is built (the play stream), so a fight's rolls no longer depend on how many objects the
build made: the old face and the drake now fail or pass together. The new stream turned up two
things. (1) A real one: Cataclysm's held bite on a hero 3 m away connected 102 ms after its flash,
the lunge carrying the head into him at the end of the active window; a string's bite now connects
at most `TUNING.biteLate` 0.07 s after its impact and otherwise misses. (2) The terrain fight check
allowed at most 2 tells without a flash in 300 s; the new stream had 3, each a move called off
(the piece out of reach) or cut by a plunge. It now checks the reason for each instead of a count.
`npm test` ALL 10 PASSED (178.9 s), `npm run build` OK.

**Open.** At the game camera the gain is real but modest: a wedge with two burning eyes instead of a
dark mass; the four faces differ far more up close than in play. The breath frame differs between the
two runs (the extra objects shift the seeded random stream, so the wyrm turned another way); the
mouth joint is the same. Not seen on the iPhone. The intro's close shots were not re-framed.

## 2026-11-20 — Session 63: the Cinder Wyrm on a leaner build

**Owner:** "lets work on improving the dragons graphics, details, look more realistic, scarier,
epic, and mystical ... the best part of the current dragon is the wings ... give me 3 different
variations". Four questions first (all parts weak; reshape freely; one of each kind of mystical;
free colours). Branch `dragon/wyrm-look`. ADR-123 / Session 63 / M1.48.

**Round 1, turned down.** Three full redraws (living fire, arcane, ancient horror: new palettes,
plates, a halo, recoloured fire, the sculpted heads) rendered as sheets and clips. The owner: "i
dont like any of the remakes. i want the dragon to look more menacing, a bit more slender", with
a picture of a lean, long-necked dragon roaring with its head high. Read as: keep the shipped
surface, change the build, the pose and the menace. The redraws are off the branch.

**Round 2, picked.** Three builds of the same wyrm, each adding to the one before (`looks.js`): `a`
lean; `b` lean + a fierce head carried high; `c` b + a mane of quills. Sheets from four cameras,
the phone frame, four clips. The owner picked **C**. It is the default now; `?wyrmLook=0` is the
wyrm before, `a` and `b` stay as the steps between (they are subsets of c's numbers).

**How it is built.** A build is numbers, applied in `model.js` `buildDrake` to what is DRAWN: the
trunk's meshes are baked into their joint's frame and scaled there (`slim`: the back's line stays,
the belly rises), a limb's meshes about the bone, the neck's and tail's radii, spine and talon
lengths, the head's drawn frame (`headVis`) and the old head's horns, fangs and frills. Breathing
sets the trunk meshes' scale every frame, so the slimming had to go into the geometry. The one
thing that is not only drawn is `rest`: the visible neck's resting shape, read by `rig/anim.js`
where it read `REST_POSE.neck`; attacks solve the head on their measured path as before.

**Verification.** New scenario `integ.mjs . wyrmlook`: for a, b and c the 82 joints sit at the
offsets of '0' bit for bit, the 23 hurt volumes keep parts and radii, 14 draws and 181 bones as
before, 127 704 triangles for c against 125 400 (+1.8 %), a bite's head and mouth at its snap
0.000 m from '0', the head 2.50 m higher while it stands in b and c. Frame time at 1280 x 720 on
the desktop GPU: 1.76 - 1.88 ms for c and for '0' alike (inside the noise). Seen in the browser,
c beside '0': phase 2 and its roar, the ignition, phase 3 ablaze, a hover barrage, a breath, the
death. At rest the head's and neck's hurt volumes were above a standing hero's reach before
(lowest point 6.0 m) and still are (6.5 m). `npm test` ALL 10 PASSED (345.5 s) with c as the default build: the timing suites too, though the extra quills shift the seeded random stream; `npm run build` OK.

**Open.** From the game's steep camera the leaner trunk reads only a little; the raised head and
the mane carry the change. The neck is drawn thinner and held higher, not longer: longer bones
(neck, tail, legs) would mean retuning reach, hit volumes and timings, and were offered and not
asked for. The body's hurt spheres are the old barrel's, so a blow just under the tucked belly
still counts (in the hero's favour). Not seen on the iPhone. The Lab's model viewer and the
intro's close shots were not re-framed for the higher head.

## 2026-11-16 — Session 62: the duelists' second pass (planned by the lead, built by Opus agents)

**Owner:** the request made for all boss fights ("more harder, more epic, more crazy combos and
flurries ... each phase needs to ramp up the difficulty and chaos ... constantly being forced to
dodge, parry, move ... plan all the new stuff out with fable and have opus agents do the work"); the
wyrm went first (Session 59). Four questions asked before planning and six after the sheets
(ADR-122 lists the answers). Branch `enemies/duelist-second-pass` from `main` (ba9a838), `main`'s #63 merged in at
the end. ADR-122 / Session 62 / M1.47 (121, 61 and M1.46 left free for a session that was
running beside this one).

**How it ran.** Three read-only agents mapped the duelist engine against the wyrm's director, the
Ash Disciple and the Starless Lord (the maps gave every later agent `file:line`). Wave 1, five at
once: **core** (`duelist/brain.js`, new `director.js` and `ledger.js`, the links files, the
`pressure` blocks, the `pace` scenario, measured first on the untouched engine), **world**
(`src/world/**`), **fxash** (`duelist/fx.js`), **fxlord** (`starlessLord/fx.js`), **looks** (both
`gear.js`). Wave 2 on the merged core: **ashmoves**, **lordmoves** (new `moveFx.js`, `spells.js`),
**terrain** (both `terrain.js`). Then **integration** (the seams, the Lab's LOOKS section, the
frame cost against `main`, a walk through both levels), **tune-ash** and **tune-lord** (each the
first to see a whole fight: films, weights, links, the meters, mortal bots), and at the end
**picks**, **engine** and **docs**, plus a second tuning round for the Lord's third form after the
final ten-seed measurement showed it no busier than his second on three seeds. Twenty-odd merges
of the agents' branches with no conflict (the scenario registries had been split one key per line
first; each agent inserted after a different key). Then `main` gained the wyrm's third pass (#63,
ADR-120) while the last full run was going: it had reworked the same destruction code, so a
**merge** agent merged `main` in (thirteen conflicted files) and the lead re-applied this history
on top.

**What went wrong on the way.** The lead session entered its own worktree with `EnterWorktree`,
which pinned every agent's write access to that worktree: four of five wave-1 agents stopped after
ten minutes (one worked round it with a mirror folder). Leaving the worktree and resuming each
agent fixed it. The first +30 % target for cues a minute was written before the baseline existed:
the duelists were already at 60 - 85 a minute, inside a move 95 % of the time, so the gain had to
come from denser moves, not shorter pauses.

**Sent back by the lead** (from the sheets): the third phase's change (three options too faint and
too alike: redone on the real transition), the broken floor (blank holes, invisible cracks, an
option b nobody could tell from whole), the Lord's shocks (never seen with the shared front), the
phone's frame cost (+21 % / +23 % from breakables in the scene graph: the pieces now live outside
it), the slab in a boss's hands (it hid him: now a chunk).

**What changed** (ADR-122 has the decisions; COMBAT.md the numbers):
- **Engine:** a director over the pick, combo links from half the recovery, chain depth and rest,
  `openingGap`, the cue ledger and the fairness guard (holds, feints, delays, fades), `brain.expect`
  / `fairDelay`, the `pace` meter; a string that ends in sword qi cuts a hero who stayed close; the
  Lord's flurry is as long as its count (it was always four).
- **Shen Hui:** three phases (64 % / 36 %), the transition `ashWind`, sixteen new blade moves and
  three on the floor, a red blow in eight strings, burning ground (it drains a held guard's meter,
  never health), the Kindling and "ash on the wind" drawn, afterimages, the qi with a body.
- **The Lord:** nineteen new moves, the wheeling blade, orbit stones, the Starless Sky as weather,
  Starless Night, Rupture and the Falling Halo; a blow out of a blink meets a guard from any side;
  his spells and blades redrawn in the fire field; each form's ignition its own.
- **Both:** thrown pieces show the flare only; bodies dressed by phase / form.
- **World:** courtyard 456 breakables (78), crater 222 (36); floors whole / cracked / broken at no
  draw cost while whole; two-stage colossi; BLOCK and SHARDS wreckage; pieces outside the scene
  graph; `floorNear`, lift class 3.
- **Lab:** a LOOKS section; later phases and their moves from any phase; Shen Hui's phase 3 in
  Training.

**The owner's picks (2026-11-16):** every author's pick for both bosses' effects (option a), the
bodies "b: dressed by phase", the broken floor "a: rubble on earth", "Guard meter, no health" for
burning ground, "Keep three phases". The picks are a table in `duelist/lookSwitch.js`;
`?looks=old` shows every redraw as it was.

**Verification:** `node tests/run.mjs .` ALL 10 PASSED and `npm run build` passes on the final
commit, run by the lead. New scenarios: `pace`, `fxlooks`, `moves`, `floor`, `worldcue` and the
opt-in `bots`, `answer`, `ranged` in `duel.mjs`; `pace`, `fxlooks`, `moves`, `floor` and the opt-in
`probe`, `defend` in `lord.mjs`; `floor`, `colossus`, `placed` in `world.mjs`. Measured: cues a
minute (ten seeds on the final build) Shen Hui 60 / 76 → 78 / 92 / 99, the Lord
71 / 80 / 75 / 85 → 83 / 91 / 98 / 109; conflicts 132 → 0; a 95 % bot wins every fight, a pure defender
survives every phase and form.
Filmed on headless Edge with the real GPU: every new move from two sides, every look option on one
sheet per switch, a 20 s stretch of each phase and form with the picks on, both levels from the
title to the victory with a death and a reset.

**Not checked / open** (the agents' own lists, kept; ADR-122 "Not measured or not right"):
- Nobody has played it. For a bot with a fixed answer rate the fights are busier and fairer but
  hardly deadlier than on `main` (the 85 % bot now dies on one seed of three against the Lord), and
  both last about a minute for a bot that plays well.
- The cheese spot behind the throne; a missed blow in a long string costing most of it (the Lord's
  worst second is 59.4, 57.2 before); two guard cues from different sources 0.1 - 0.25 s apart.
- The guard steps in 1 - 4 times a minute in the Lord's fourth form.
- New poses measured inside today's envelope but not audited joint by joint; no palm strike.
- No music for phase 3, no new sounds. The iPhone itself.
- One wyrm number changed (Furnace Maw's bite cued 28 ms later: a fault that was on `main`).

**Next:** the owner plays the preview (the Lab's LOOKS section flips every option on the phone).
If the fights should be longer or deadlier: posture gained per parry and health are the levers.

---

## 2026-11-16 — Session 60: the wyrm ablaze, a forest that breaks, letters that follow the zoom (planned by the lead, built by Opus agents)

**Owner:** "lets improve the dragon's face to look more menacing and realistic. right now it seems like
a lego block dragon face. i also want to make the dragon be able to destroy more of the terrain in
the background, especially the tree walls surrounding the map. the dragons melee and fire attacks
that happens to hit the trees should slowly crumble and break them. every background object needs to
be destructible, not just the objects in the ground. i also noticed as you zoom out more, the ascii
detail and graphics of the objects gets less quality? ... on the 3rd phase of the dragon, i want the
dragon to also set himself on fire like its wing tips, claws, and tail ... use fable to do the
planning and use opus subagents to do the work." Four questions first; the answers: render all
three faces (a predator skull, an Eastern loong, a horned demon); all of Cinderwood breaks, the two
landmarks and the nest included, the bonfire stays; the zoom is noticed on desktop; the phase 3 fire
burns the world and adds no damage to the hero. Branch `dragon/menace-and-ruin` from `main`
(ba9a838). ADR-120 / Session 60 / M1.45.

**How it was run:** the lead (Fable) mapped the code, wrote a shared brief and a task file per agent,
and tested a capture rig first (a scratch server per worktree, headless Edge on the real GPU, a CDP
client, a helper that freezes the page and posts contact sheets). Four `general-purpose` agents on
Opus, one hand-made worktree and branch each (`w3/face`, `w3/break`, `w3/zoom`, `w3/ablaze`), file
lists that do not overlap. The suites' one-line `SCENARIOS` registries were split one entry per line
first, and each agent was told where to insert its scenario: the four branches merged with no
conflict and the merge was green at once. A fifth agent (`w3/tune`) then owned the merged build, and
a sixth wrote the reference docs. The lead looked at every sheet before it went to the owner.

**The forest breaks** (`w3/break`, then `w3/tune`): every tree of Cinderwood (539, out to 74 m) is a
'range' piece of one static tree mesh. `RangeBody` has parts (the trunk, each crown blob or bough is
a run of vertices) and can be posed by rewriting its vertices from a home copy, so a tree shudders,
leans, falls, is carried and resets with no bone of the rigid batch (the forest went from 368 bones
to 228 (the wreckage pools included) while its breakables went from 183 to 664). A tree wears down in stages at 0.82 / 0.5 / 0.22
of its structure: its outer crown bursts off, half the crown goes, it leans, it falls. Trees past
32 m are the wall: they fall outward, and a fall that cannot reach the hero's ground gives no tell.
The Elder Wyrm's skeleton is 36 bone pieces, the Cinder Tree five boughs and a trunk that is guarded
while a bough stands, the nest 14 ribs and a skull; each broken bone leaves a heap. The bonfire stays.

**The wyrm reaches the wall** (`w3/tune`): the first pass left the wall mostly standing (28 % of its
front rows damaged after a fight) because the wyrm fights inside the clearing and its fire never
landed past 32 m. Two means, both with numbers in tuning and neither touching an attack: wind
(`destructibles.wind`: the roars, the shock rings, the wing buffets, take-off and landing send a
front that wears wall trees to their second stage at most, never felling one) and carried fire
(`carryFire`: a breath, a strafing pass, a flame ring or wall, a missed shot carries on and lights
the first wall tree in its way), on a fire budget of the wall's own.

**The wyrm ablaze** (`w3/ablaze`): `entities/dragon/ablaze.js`. The phase 3 roar ends in an ignition
that runs out along the wings, the legs and the tail and flares at the ends; then the wing tips,
the claws and the last third of the tail burn for the rest of the fight as heat in the fire field,
keeping 18 % of their part's speed so a sweep leaves an arc and a tail whip a ribbon. Wood a
burning part passes catches (5 a minute at most); footprints are a harmless scorch with small
flames, never `world.fire`. The fire dims round every flash, under the body's warning glow and near
the hero. It gutters in a stagger, goes out along the body on death, and uses its own random
numbers, so a seeded fight is identical with it off or on.

**The letters follow the zoom** (`w3/zoom`): the diagnosis first. Only what is drawn in screen-fixed
cells loses detail when the camera pulls back (the art pass, prop art, the trees' screen grid, the
fire field: 5.8 letter rows a metre at 36 m, 3.9 at 54 m, at 1080p); the grass and the floors are
world-anchored and do not. Past the default wheel distance the art cell now steps down a ladder of
the existing pixel fonts, the screen grid with it. The font follows the player's wheel, not the
measured camera distance (the boss framing sits 5 - 9 m further out and would have changed the
default look). All atlases are built ahead, a step swaps uniforms, the fire field draws into a
sub-viewport of targets sized for the finest step, and the letters' tone is held by ink coverage.

**Three heads, not taken up** (`w3/face`): `entities/dragon/heads.js` sculpts a predator skull, a
loong and a horned demon as lofts with real sockets, cheekbones, gums and varied teeth; gameplay
joints are identical to the old head's to the millimetre.

**The owner's picks** (from rendered sheets and clips, 2026-11-16): the face: "lets pass on the
remake of the dragon head for now"; the zoom: b (the letters fully follow); the fire: b (trailing
fire). So the head is unchanged and the three stay behind `?wyrmFace=` for later; `?zoomArt=b` and
`?ablaze=b` are the defaults.

**Verification:** `npm test` and `npm run build`: see the PR. New scenarios: world `wear`, `wall`,
`landmarks`, `reach`; integ `zoomart`, `wyrmface`, `ablaze`; WRECKAGE reports and bounds the wall's
front rows. Measured over five seeds, 80 s a phase: the wall's front rows (153 trees, 32 - 46 m)
worn or down at the end 43 / 41 / 37 / 45 / 57 %, phase 1 alone 8 - 18 %; falling trees on the hero
0 on every seed. On screen (headless Edge on the real GPU, 1280 x 720): the stages of the three
tree types, the landmarks coming apart, the ignition, the three fire strengths, the flares on the
burning wyrm, the zoom options at four distances and three resolutions, and by the lead on the
merged build: phase 3 burning, a roar's wind reaching 212 wall trees, the cell stepping 5x8 to 4x6
at the furthest wheel.

**Not checked / open:**
- **Frame cost.** Paired against the base at 1080p the merged build renders 16 - 22 % slower with
  the wall intact and 14 - 21 % in phase 3 (7 - 10 % wrecked and burning); at the phone preset's
  size on the desktop GPU 15 - 26 %. Most of it is the trees' new representation, not the fire or
  the zoom. Nobody has run it on the iPhone.
- The wall's damage clumps into one to three long stretches (the fight stays on one side); the
  target of four separate stretches was not met. From above it reads as thinned and burnt more than
  torn open. Fights in the browser ran harsher than the headless meter (61 - 74 %).
- A dead tree's stages cannot be seen inside the canopy until it falls; many ribs breaking in one
  frame are still a pale mass; the wind's leaves are faint at the game camera.
- With zoom b the trees' letters step too (the trees were the owner's look), and stone pillars at
  the furthest zoom print denser and flatter (seen in the Ashfall Courtyard).
- The new `wear` sound has not been heard by anyone. Nobody has played any of it.
- The unsharded TIMING run fails one placement (furnaceMaw P3, hit 3 at 0.6: 100 ms) on the base
  too; the sharded run in `npm test` does not show it.

**Next:** the owner plays the Vercel preview (the wall's rate of ruin, the fire's strength in a real
fight, the zoom on their monitor, the frame rate on the phone). If the phone suffers, the tree mesh
is the place to look. The heads wait behind `?wyrmFace=`.

---

## 2026-11-15 — Session 59: the Cinder Wyrm's second pass (planned by the lead, built by Opus agents)

**Owner:** "i want to make the boss fights a bit more harder, more epic, more crazy combos and
flurries of attacks from them. remove the dragons blue fire homing attacks as it looks bad. improve
the visuals, animations, and effects overall ... his shock wave rings ... need to look realistic ...
him breathing out a cone of fire and circling looks bad ... more cooler melee attacks mixed with wing
attack, tail, and fire attacks ... each phase needs to ramp up the difficulty and chaos ... more
flying attacks that are combos ... the terrain attack animations and speed need to be better ... don't
show exactly where the terrain will land ... the terrain itself is barely destructible ... plan all
the new stuff out with fable and have opus agents do the work." Six questions asked first (ADR-119
lists the answers). Branch `dragon/wyrm-second-pass` from `main` (857611a), main's #60 merged in.
ADR-119 / Session 59 / M1.44.

**How it ran.** Three read-only agents mapped the attacks and AI, the effects, and the terrain moves
and destruction. Seven agents then built at once, each in its own worktree on its own files, from one
shared brief and a task each: **melee** (`attacks.js`, the attacks' tuning, `meleeFx.js`), **flight**
(`fireAttacks.js`, `tuningFire.js`, `hazards.js`, `skyFx.js`), **fx** (`fx.js`), **bullets**
(`bulletAttacks.js`, `bullets.js`, `bulletFx.js`, `tuningBullets.js`), **terrain** (`terrain.js`,
`terrainAttacks.js`, `tuningTerrain.js`, `terrainFx.js`), **world** (`src/world/**`, the body against
the world in `dragon.js`), **ai** (`ai.js`, the pacing keys). The lead looked at every film sheet and
sent three back: the breath's option sheet could not be judged (the frame cut the cone), the ground
tongues read as patches of fire and not as lines, the tree in the jaws could not be seen. Seven
merges with one expected conflict each (the one-line scenario list in `integ.mjs`). On the merged
code 7 checks failed, all where two pieces met; an **integration** agent fixed those and the edits
each agent had left for another's file; a **tuning** agent then set the links, the pace, the
wreckage and the motion on the whole fight.

**What changed** (ADR-119 has the decisions; COMBAT.md the numbers):
- **AI:** a director over the weighted pick (categories, floors, run limits), combo links for all 45
  attacks in `tuningLinks.js`, shorter pauses, ambient cinders from phase 2, fairness guards (0.3 s
  between cues that need different answers), the PRESSURE meter.
- **Melee:** kinds `wingSweep`, `wingSlam`, `tailWhip`, `tailSlam`, `fireSnap`, `emberRake`; strings
  `wingRend`, `pivotLash`, `rearGuard`, `skyHammer` (phase 1), `furnaceMaw`, `cinderRake` (phase 2),
  `cataclysm` (phase 3, 7 - 9 hits); the breath's body is braced (a spring aim, the neck leads).
- **Flight:** `skyHunt`, `skyFurnace`, `skyCataclysm` (2 / 3 / 4 parts); flame rings 1 / 2 / 3 and a
  second flame wall in phase 3; eruption pools; the apocalypse reworked (`skyFx.js`: column bolts, a
  burning deck in the sky, meteors with bodies), five waves in phase 3.
- **Fire patterns:** the wisp swarm removed; the Scouring breath as ground tongues; the Ember torrent
  in gusts with barks; `cinderSpit`, `emberRain`, `fireLanes`.
- **Effects:** `_shock` behind every ring, `breathBody` behind every breath, `groundShock` at
  landings, the stomp and the tail slam; dust, flares, rims, fireball heads redrawn.
- **Terrain:** hurl 1.28 - 1.58 s, firebrand 1.80 s, tail bat 1.25 - 1.33 s from tell to blow; a
  whole-body grab; no mark on the ground; the flare on the flying piece; the tail bat is a parry
  moment.
- **World:** 183 breakables with a spatial grid; `dragon._wreck` (the body brushes, shoves and
  fells); wreckage pools (logs, burnt logs, rubble) with no collider; fire spreads within limits;
  burning-wood lights 5 m instead of about 16 m; a quality factor for the LOW preset.

**Look options for the owner:** `?ring=a|b|c`, `?breath=a|b|c`, `?apoc=a|b|c` (`a` is each agent's own
pick and the default). Sheets: the scratch folder's `tune-OPTIONS-ring.png`, `tune-OPTIONS-breath.png`
(with the grass catching) and the fx agent's `fx-SHEET2-breath-options.png` (the breath alone),
`tune-OPTIONS-apoc.png` and the flight agent's `flight-apoc-compare.png`.

**Verification:** `node tests/run.mjs .` ALL 10 PASSED and `npm run build` passes on the final
commit, run by the lead. New scenarios: MELEE, FLIGHT, TONGUES, FXLOOKS, PRESSURE, BUDGET, WRECKAGE
in `integ.mjs`; GRID, BODY, WRECK, SPREAD, BUDGET in `world.mjs`; TERRAIN and BULLETS rewritten for
the new rules; 20 attacks in the TIMING verifier (16 strings and the four single blows). Filmed on headless Edge with the real GPU:
every new string, flight, pattern and terrain move, the roar, the apocalypse, before / after of the
effects and of a rampage through the clearing. Numbers: ADR-119 "Measured".

**Not checked / open** (the agents' own lists, kept):
- Nobody has played it. The pace, the fairness guards and the bots are measurements, not a fight.
- Phase 1 is under its 34 cues-a-minute target on two of five seeds; phase 3 under 78 on three of
  five (the same tuning gave 70 - 96 between runs).
- The wing sweep misses on 25 - 60 % of placements in stormFlurry, cataclysm and frenzy (cause not
  found); pivotLash's claw lands on 124 of 174.
- The grabbed tree reads from in front of the wyrm, partly from behind, poorly from beside it.
- Bright white-yellow knots remain in shell and fireball impacts and in the torrent look of the
  breath.
- The AI's slower turn and sidestep were measured alone, not judged over a whole fight; the tail
  slam's raised arch barely reads; the flying combos' banking was not filmed from two sides.
- The wreckage left after a fight depends on the fight (47 - 60 % alone, 24 % on one seed inside the
  suite); late in a long fight few liftable pieces are left and terrain moves get rare.
- The phone: render time measured on a desktop GPU at 852 x 393 (0.60 ms against main's 0.57 ms);
  the iPhone itself is the owner's to check.

**The owner's pick (2026-11-16, on the pull request's sheets):** "Keep a for all": the rolling front of
fire for the shock ring, the torrent for the breath, the salvo for the apocalypse. They were the
defaults, so the game did not change; b and c stay behind the switches (ADR-119 has the note).

**Next:** the owner plays the preview; then the same pass for the Ash Disciple and the Starless Lord.

---

## 2026-11-15 — Session 58: `npm test` runs its suites side by side; repo merge settings

**Owner:** asked why every PR here is a squash merge, then whether any GitHub settings would make
things smoother, and said yes to all three proposals. No game code changed.

**Repo settings (GitHub, not in the tree):** auto-merge is allowed now (a PR can be set to merge by
itself when the check passes), and a squash commit defaults to the PR's title and description
(was: the branch's commit messages). Unchanged: squash / rebase only, linear history, up-to-date
branches, the rules apply to admins. A merge queue would remove the "update branch, wait, merge"
round, but GitHub only offers it on repos owned by an organisation.

**Why CI took 5 minutes:** `npm test` was 4.5 of them, six commands one after another. Measured here:
`integ` 226 s, `lord` 40 s, `duel` 20 s, `world` 3 s. Inside `integ`, TIMING (a grid of placements
per wyrm attack) is about 85 s and the other 37 scenarios about 140 s.

**`tests/run.mjs`** (what `npm test` runs now): one process per task, as many at a time as the
machine has cores (`--jobs N`, `--serial`), each task's output printed whole when it ends, a summary
with every task's time, exit 1 if any failed. Ten tasks: `integ` (`all` without the scenarios
below), `integ hero + world` (11 scenarios as a comma list), TIMING in three parts, `lord`, `duel`,
`world`, the glyph check, the changelog check. `integ.mjs` gained three options for it: a comma
list of scenarios, `GCD_SKIP` (left out of `all`) and `GCD_TM_SHARD=k/n` (every n-th attack of
TIMING's own list). A new scenario or a new attack is covered without touching the runner; a name
the runner lists that no longer exists fails the run.

**CI** (`.github/workflows/ci.yml`): a new push to a PR cancels that PR's run still in progress.

**Verification:** the split run passes the same number of checks per scenario as the single run
(compared scenario by scenario; TIMING's four and the five end-of-run checks repeat per process).
`npm test` green four at a time, `npm run build` green. Bad values (`GCD_TM_SHARD=4/3`, an unknown
name in a list or in `GCD_SKIP`) fail.

**Open:** the check across scenarios (the event catalogue's "every event has a consumer") runs in
the `integ` task only; if a new event's only consumer lives in a scenario of the second
part, that check fails and the scenario moves back (drop it from `INTEG_2` in `tests/run.mjs`).

---

## 2026-11-15 — Session 55: the flare (red, blue, black); the counter; a charged blow for every boss

**Owner:** "lets add more perfect parry / perfect dodge moments into the game from the bosses. instead
of giving a red circular area of where the attack will land, i want it to be exactly like phantom
blade zero where there's a red flash to give you a tell/sign to dodge at that exact moment and if you
do dodge it in time, it will do a cool animation of the dodge/parry and do a counter attack. also i
want to add a black charged up attack ... the player needs to dodge it, if they block it they lose
all guard", with two clips (a perfect dodge of a red flash, a perfect parry of a blue flash). Four
questions asked first; the owner took the recommended answer to each: flash only (what lands away
from the boss keeps a ground mark), the counters automatic for both, a black blow on the guard
empties it and deals nothing, all three bosses. Branch `combat/flash-tells` from `main` (46e2c98).
ADR-118 / Session 55 / M1.43.

**The flare** (`enemies/duelist/fx.js` `TELL_FLARE`, `_flare`, `_drawFlare`): the cue of a moment is a
streak of `-` strokes through the striking part across the whole frame, three rows thick near a
white-hot heart, written cell by cell on the letter grid in the fire field's steel. The field has no
free heat channel for a new colour, so `FireField.tint` dyes the steel inside an ellipse of the frame
for as long as it is set (two zones; a `dark` zone also blacks out the cell behind each letter). Red
= dodge, blue = parry, black = dodge. A part outside the frame (the wyrm's tail) has its flare drawn
at the nearest point inside it. The HUD's screen edge flashes in the flare's colour; black dims it
through the charge. Three looks behind `?flare=streak|star|lance` for the owner to choose from.

**Nothing before the cue:** `TELL_STYLE.red.warn` from / to are 0 and `TELL_STYLE.red.floor` is false:
the duelists' red ring and the heat under the wyrm's own area blows are off (code kept behind the
flag). Thrown and falling things call the new `hazardFlash` and keep the red blaze where they land.

**The counter** (`DEFENSE.flareCounter`): a blue beat / hit marked `flare: true` is a parry moment.
`player._parry` readies the riposte for it wherever in a string it came, the attacker treats the
parry as a last blow (`dragon:parried { last, flare }`), and `Flurry.start({ riposte, counter })`
makes the last flash cut the counter blow (64 / 30 posture, `player:flareCounter`, COUNTER).

**The charged blow** (`TELL.BLACK`, `GUARD.black`): `_takeHit` (c2) answers a held guard or a parry
press with `_guardOpen(…, black)`: no damage, the meter to 0, 0.8 s open, thrown back. A perfect
dodge is answered as a red blow's (`dodgeOnly`). Through its windup `DuelFx.charge` draws an eclipse
on the striking part (a disc of blacked-out cells, a pale corona, motes pulled in), the body takes
`TELL_STYLE.black.warn` (the wyrm at 16 % of it: at a duelist's strength the whole screen went
violet) and `combat:charge` dims the screen edge.

**Moves:** the wyrm's Black maw; Shen Hui's Severing Wind, Twin Embers, Black Tide; the Lord's
Severance, Red Meridian, Nightfall (every form). Twelve existing heavy blows marked as parry moments.
All composed from existing key poses: no new animation.

**Found on the way:** `GROUND_ARTS` was filtered with `!ARTS[k].air`, and the riposte's entry has
`air: null`: a perfect dodge of a duelist's red blow could draw the riposte as its art, which with a
streak of one cut nothing. Fixed (`=== false`).

**Verification:** `npm test` and `npm run build`: see the PR. New scenarios: duel FLARE (22 checks),
lord FLARE (9), integ FLARE (10), and Black maw added to the wyrm's TIMING verifier (66 of 66 AI
placements land, within 50 ms of the cue). Changed checks, with the reason in each: the wyrm's RED
(the bite's screen edge is blue now) and RIPOSTE (the bite's answer is the counter), duel PRESSURE
(>= 20 white / blue cues in 60 s, was 25 in 40 s: a parried moment ends his string; seeds 4242 / 7 /
99 gave 31, 40, 44) and TERRAIN (the courtyard's share
<= 35 %, was 30: seeds 4242 / 7 / 99 gave 32, 17, 18 %). On screen (headless Edge on the real GPU,
1280 x 720 and 852 x 393): the three flares on all three bosses, the three looks, the charge.

**Not checked / open:** nobody has played it: the timing of a flare-only red blow for a human, the
fights' length (the ADR-102 strategy bots were not re-run), the feel of the counter. Black reads as a
dark violet bar with a white thread rather than as pure black: on these dark levels a black shape
cannot be seen, so it is drawn by its rim; the owner should judge it. The flare's frame cost on the
phone is not measured. The Training catalogue has no entries for the new moves.

**Follow-up:** shown the three looks side by side (red and blue, the cue frame on the Ashfall
Courtyard), the owner picked "A, the streak": the default as merged. The star and the lance stay
behind `?flare=` (kept for later use, as the hero's looks are).

**Next:** the owner plays the Vercel preview (the black charge above all); tune from that.

---

## 2026-11-15 — Session 54: dark music per level and per boss phase

**Owner:** "Lets update all the sound effects and music to the game. Browse and pick the best cc0
sounds from opengameart." Then, after hearing the first pass on the preview: "the new sounds is way
too much right now and feels noisy everywhere. lets just focus on changing the background music with
something very dark, grim, and good to hear in the background for each level where the music changes
per phase. give me a simple audition page with the music for me to preview and choose which one goes
to prod". Branch `audio/dark-score` from `main` (the first pass, `audio/oga-samples` / PR #55, was
closed unmerged). ADR-117 / Session 54 / M1.42.

**Done** (ADR-117):
- First pass (dropped): 129 recorded sound effects and three ambience beds over the synth, level-matched
  by offline renders. Too noisy for the owner; none of it ships.
- Music: OGA's CC0 music searched for dark / grim / horror / ominous / drone / choir pieces (500
  results, 85 pages read, 49 downloaded), measured (centroid, onset density, loudness range) and
  shortlisted: three per slot for 14 slots, 75 s clips at -18 LUFS on an audition page
  (https://claude.ai/artifact/2m5awirsURxL9SrSh2wdbN) whose picks are saved in its database and read back.
- `audio/tracks.js` (`TrackBank`, `TrackLoop`) and `audio/trackList.js` (`SCORE`: explore + phases per
  level, victory, death); `audio.js` picks the phase track from `game.dragon.phase` (`_bossPhase`,
  `_musicPhase`). `scripts/audio/build-music.py`; `build.mjs` copies `assets/`; Lab VIEW → "Recorded
  music".

**Verified:** integ MUSIC (every listed track exists and nothing unlisted ships; exploring, phases
1 - 3 and a phase past the last; the same phase plays on; a loop restarts at its loop point; a failed
track and a mode without one play the synth; `?music=synth`). Browser on all three levels: the
level's exploring track, then the phase tracks as the boss's phase changes. `npm test`, `npm run build`.

Found in the browser: the wyrm's phase 2 kept phase 1's track (it emits `dragon:phase2` at the
transition roar and sets `phase` later): the engine now keeps the announced phase (`_phaseHint`) and
follows a phase number that moves on its own.

**Open:** the owner's listen in play and on the iPhone (loop seams, the phase crossfades, memory).

## 2026-11-15 — Session 53: WHAT'S NEW in the game; the phone camera in a duel's moment; a game of its own

**Owner:** "On mobile theres a bug where after i lock onto the dragon target, the camera zooms in
really close. Fix that. Also add a changelog in the game menu with an indicator showing whats new
with all the version changes with notes on what changed. Also remove all text within the game, repo
documentation, and source files on all references to [the game that inspired the look] as i want
this to be my own thing now". Branch `ui/changelog-own-identity` from `main` (14cb0b2). Numbers:
PR #53 (heavy branches, open) holds ADR-115 and Session 52, so this is ADR-116 / Session 53 / M1.41.

**The lock-on zoom.** Not reproduced as described: on the phone preset (`?touch`, landscape and
upright) locking on (the real toggle and `_setLock`) at 6, 12 and 20 m from the wyrm, asleep,
waking and fighting, never brought the camera in: lock-on adds a pull-out capped at 3 m on a phone,
and the distance stayed 20 - 27 m. Two causes found that fit "zooms in really close": (1) a duel's
cinematic moments add `cine.zoom` (-9 / -7 m) unscaled, so on the phone the camera went from 16.7 m
(the duel camera, already in) to 9.3 m; scaled now like the punch (16.7 → 12.6 m, the desktop's share);
(2) iOS ignores `user-scalable=no` and nothing stopped a double-tap zoom of the page on LOCK (a
38 px button tapped twice to switch or drop the target); the touch layer now cancels `touchend` on
the canvas and its own controls, plus `gesturechange` and `dblclick`. Which one the owner saw is not
known: the second cannot be shown in the browser pane.

**WHAT'S NEW** (ADR-116): `ui/changelog.js` (releases as data: LATEST, 0.4.0 ... 0.1.0, 55 entries of
two or three player-facing notes each, rewritten from CHANGELOG.md), `ui/changelogPanel.js` (the
panel, read ids in localStorage), a corner button with an "N NEW" badge on the title, an item with
"N NEW ›" in the pause menu, the gamepad (walk to it on the title, B / Menu / A close, the stick
scrolls), Esc closes it without pausing or starting the game. `tests/changelogcheck.mjs` added to
`npm test`. CHANGELOG.md had three "N pieces of work since 0.4.0" lines from merges: one now.

**The inspiration's name** is gone from CLAUDE.md, README, STYLE (its first section is "The founding
look (v0.1)" now, the creator's quote paraphrased), DECISIONS (ADR-001, ADR-098's context), DEVLOG
(Session 1), ROADMAP, CHANGELOG (0.1.0), `cameraRig.js` and the title's credit line, which now reads
"prototype v0.4.0". Git history still has it (rewriting `main` is not possible under its protection).

**Verification:** `npm test` (all suites + the glyph and changelog checks) and `npm run build` pass. Browser pane, phone
preset 852 x 393: the title's badge (17 NEW on a first visit), the panel over the title (the game
does not start, Esc closes it, the badge clears and stays cleared after a reload), the pause item
("1 NEW ›") and the panel over the pause menu, above the touch controls' peek (it was under them).
The cinematic re-measured on the Ashfall Courtyard.

**Not checked / open:** the owner's iPhone (the lock-on report, the `touchend` guard, the panel's
scrolling); a gamepad on the panel (code path only); portrait title layout with the corner button.

**Follow-up:** the owner: it happens without lock-on, every time. A scripted walk from the title to the
waking wyrm and a 12 s fight on the phone preset: the camera never under 20 m. So the page zoom: every
double tap is guarded now (menus get the click by hand), a zoomed page is reset through the viewport
meta, and `?camdebug` prints page scale / camera distance / canvas size on screen for a phone report.

**Next:** the owner tries the Vercel preview on the phone (with `?camdebug` if it still happens); cut
0.5.0 when they want a version line.

---

## 2026-11-15 — Session 52: a heavy button; five heavy branches off the chain; the charge on the heavy

**Owner:** "Yes, ask me first" (the genre review's heavy button). Asked, answered: heavy branches off
the chain, hold heavy to charge, a fourth tile on the phone (2 x 2), heavy on the right click (then:
the guard on the middle click). Branch `player/heavy-branches` from `main`, own worktree. ADR-115 /
Session 52 / M1.40 (PR #49 took ADR-114 and Session 51 while this was open; #50 took 113).

**Done** (ADR-115):
- `combat.js` `HEAVY` and `heavyAfter`; four two-handed clips in `swings.js`; the Earthbreaker on
  the slam clip with a higher leap.
- `player.js`: the heavy press (`this.hb`, was `lmb`) buffers 'heavy'; from a light's recovery it is
  that light's branch; held 0.3 s it is the charge. A light never waits at its coil.
- Bindings v2; the 2 x 2 touch pad with the charge meter on HEAVY; help, title and pad texts.
- Training: the five heavies; every situation starts on a restored set.
- **Tests:** the guard on button 1 and the charge on button 2 everywhere (main's new tests too);
  REACH swings every heavy at 0 - 3.5 m; duel HEAVY; TOUCH (the HEAVY tile, its charge, a held ATTACK
  is a light, the 2 x 2 edges); REMAP (the new defaults, a v1 save not read); the held-light test
  rewritten (a held light cuts at once).

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server: the phone pad at
852 x 393 (`?touch`) and a film sheet of the five heavies at the game camera beside Shen Hui.

**Not checked / open:** no human has played them; the clips were looked at as a sheet of stills, not
in motion, and not from four sides; the phone pad's feel under a thumb; the wyrm and the Lord with
the heavies by eye.

**Next:** the owner's look at the sheet and the preview; then HP-linked posture for every boss.

---

## 2026-11-15 — Session 51: the hero's stance: at ease, and a fencer's guard in a fight

**Owner:** "review the current character posture, angle of the right hand sword when the character
is not attacking. i want the characters hands to have some kind of cool looking idle motion/stance
where it looks natural and cool. something about the current idle animation is bothering me. ask me
questions to help you and come up with 3 different variations for me to review and approve on a
final one". Branch `player/idle-stance` from `main`, in its own worktree.

**Measured first** (the stance as it shipped, filmed at the game camera from four sides and close
up): the blade 52° down and 79° out from his front, 27° out of line with the forearm, from an elbow
tucked at the ribs; both hands beside the hips at 0.95 and 0.92 m; over a 2.4 s breath the hands
travelled 1-3 cm, under half a pixel at the game camera; no idle action ever while locked on.

**Asked, answered:** what is off (ticked: the stiff bent wrist, arms that hang like a mannequin's,
a statue; not ticked: "the sword sticks out sideways"); the three options to span three attitudes;
two stances (exploring / locked on); "alive, not busy".

**Rendered for the pick:** three styles behind a temporary `?idle=a|b|c` switch and a Lab row, each
an explore pose, a fight pose and its motion: A "At ease" (a hand on the belt, the blade down the
arm's line; a fencer's guard), B "Coiled" (both hands on the grip, low; a deep middle guard), C
"Hidden blade" (the sword reversed behind the arm, a sword-finger seal; the fingers at the foe).
Sent: one overview sheet, and per style a detail sheet and a 6 s loop (close up and at the game
camera). The owner picked **A**, the motion "about right", and the fight stance for "lock-on or
boss fight". B, C, the switch and the reversed grip's wrist range are gone.

**Done** (ADR-114):
- `stances.js`: `atEase` and `fencerGuard`, the free hand on the belt in both (`BELT`), the life in
  them (`STAND_LIFE`). `anim.js stand()` writes them over `guard()` for the hero's animator only;
  `loco()` and an attack's way home use it. `guard()` stays the base of every other clip and of a
  duelist's footwork.
- `HeroAnimator.fightW`: the guard while locked on or in `bossIntro` / `boss`; up in 0.38 s, down
  over 0.88 s. Idle actions play at ease only.
- A transition audit against `main` (13 transitions, the fastest frame of six points) found and
  fixed: in a fight he now keeps the guard up on the move (trailed, the point swung 16-18 cm a frame
  at every start and stop; 2.6-3.1 now, under the old stance's 4.6-11.4); a roll and a backstep
  ease the sword arm out of the guard (the point moved 173 / 118 cm a frame inside the cross-fade;
  46 / 22 now); the blade settles into the stance over 0.24 s on the way back.
- Found at the game camera: two fight blades stood edge-on to the camera behind him and vanished
  (the flat is up now), and pointed straight ahead they stood behind his own head (they point a
  little out to the sword side).
- Found by the tests: the fingertips of the hand on the belt 2.7-3.8 cm in the hip, and the palm
  hovering 9 cm off the waist (it is 2.7-3.2 cm off it now and turns with each stance's chest); the
  hips whipped 16.8° in a light's first frame out of the guard (half of the turn moved to the
  waist); the guard's sword elbow 0.52 out to the side (0.23); the front foot did not turn with a
  light's pivot (its toes are out like the swings' own stance).
- The Lab: PLAYER → stance (auto / at ease / fight; `player.debug.fightStance`).
- Tests: `herostance` (16 checks: the rule, the wrist, the hand on the waist, the flat to the
  camera, the life, the transitions, `guard()` untouched for a duelist). Seven checks that
  described the old stance rewritten (the free hand at rest, the arms at rest, the idle breath, the
  idle actions' count, three outfits' hem heights). Two relaxed, with the reason beside them: the
  ribbon landing in a knockdown (5 → 10 cm: the hilt falls from higher) and the fighting bot's
  guard breaks (0 → at most 1: the default seed's fight is reshuffled; seeds 1-6 give 0 on both
  stances).

**Verification:** `npm test` (integ, duel, lord, world, the glyph check) and `npm run build` pass
on the branch merged with `main` (10891c3). Filmed in headless Edge at 1376 x 768 on the dev
server: both stances at the game camera with him turned four ways and close up from four sides
(the game's look and the bare body); the hand on the belt close up from five sides; the standing
loop; a played sequence (at ease, a lock-on, a strafe and a stop in the guard, two lights, the
fight ending). The Lab's stance row was driven in the Browser pane. The numbers above are
`herostance`'s output and the audit's.

**Not checked / open:** a fight played by a human with it; the phone (look and feel); the Ashfall
Courtyard and the Obsidian Throne in the browser (headless tests only); the outfits other than
today's in the new stances; the idle actions were not re-tuned for the new base (each fades in from
it: looked at, not measured). The free hand's fingers lie straight along the hip (the hand has no
finger joints): 7-9 cm of them stand off the belly's curve.

**Next:** the owner's look at it in play (the Lab's stance row holds either stance); then the idle
actions re-posed from the hand on the belt if they read wrong.
## 2026-11-15 — Session 50: effects in the dragon's letters (the fire field), text effects, landmarks second pass

**Owner:** "is there anything existing we should update? ... i want people to be stunned at the ascii
style and amazed how text can make such detailed 3d objects that look great in animation and effect
wise", and "all the spells, effects, etc need to look as realistic and cool as possible. for example,
the dragon fire attacks look meh". Sent a sheet: the breath as it was (A), a prototype of fire as one
body of small digits, calm (B) and hot (C), and a list of four things to update. Answer: "Do all 4
and create parallel subagents to work on each task". They did not choose between B and C: B is built
(my pick: closer to the wyrm's calm tone; `hdr` in `firePalettes.js` is the one number for C).
Branch `fx/real-fire`. (Numbers: open PRs hold ADR-108 – 111 and Sessions 45 – 47, so this is ADR-113
/ Session 48; the Obsidian Throne's rebuild then merged first as ADR-112 / Session 48, so this is
ADR-113 / Session 49.)

**How it was run.** The lead built the core first (`render/fireField.js`, the breath on it, the test
harnesses), because three of the four tasks stand on it, then four agents worked in parallel, each
in its own worktree and branch with a file list of its own, filming on a headless Edge on the real
GPU: the landmarks; the wyrm's fire; the human bosses' effects and the timing cues; the text effects.
The four branches merged without a conflict. `main` had moved by four PRs meanwhile (ADR-101, 102,
106, 107): merged in, four conflicts, both sides kept.

**Done** (ADR-112):
- **The fire field** (`game.fx.fire`): blobs of heat that add up in a buffer with one texel per
  letter cell; a flame pass per cell; a print pass in the wyrm's letters. Kinds: fire, void, steel,
  smoke. Looks in `render/firePalettes.js`.
- **On it:** every fire of the wyrm (`dragon/fx.js`, `bulletFx.js`), the bonfire, scorched ground's
  smoke, the braziers, and, after the merge of `main`, ADR-107's ground fire and burning trees; the
  Ash Disciple's and the Starless Lord's effects (`duelist/fx.js`, `starlessLord/fx.js`).
- **One set of timing cues** drawn by `DuelFx.tellFlash` for all three bosses (the wyrm at 1.5x).
- **Text effects:** heat haze, letting go (`render/letGo.js`), shed digits (`render/shedDigits.js`),
  the breath's charge rising from the belly.
- **Landmarks rebuilt and moved** to where the duel's camera looks (see the ADR for the list).
  The forest's new breakables (ADR-107) keep off the landmarks' footprints.

**Checked.** `npm test` (integ, duel, lord, world, the glyph check) and `npm run build` pass on the
branch with `main` merged in. On film (headless Edge, RTX 4090, 1280x720): every converted effect
before and after (sheets by each agent), the three levels loading and every boss ability triggered
once with no console error, the wyrm's death, the breath setting the grass alight, the wyrm's blue
cue. No breakable overlaps a moved landmark's collider (checked in the page for the three levels).
Frame cost against a clean copy of `main`, render + a 1 px read-back, medians, twice each:
1080p 2.1 – 2.4 ms on both, calm and mid-breath; 2160p 3.2 ms calm on both, 3.5 against 3.2 – 3.3
mid-breath. Equal within noise on that GPU.

**Not checked.** A phone (look and frame rate); anything in motion at real speed by eye (stills and
strips only); low frame rates; the Lord's intro camera now that the wardens left the throne; the
haze beside the human bosses' new effects; the wyrm's red cue on film (the frame fell between
tiles); 1080p / 1440p cell sizes for the text effects; a hero standing in front of the dissolving
body. The sims compile no shader and build no `ShedDigits`: the text effects are covered by film only.

**Known weak spots** (each agent's own list, in the ADR and the roadmap): fire cannot hug the ground
(blobs under 0.7 m fade into it); tongues always climb up the screen; the flame wall is a band, not
tall, from the steep camera; the bonfire and braziers are redder and dimmer than before; red cues
and red rings are fire at a low heat, not a crisp red; the Lord's spells changed colour (red to white
and violet); the throne hall's landmarks are the weakest; the dying wyrm's eroding edge has a black
fringe; the throat tell is a modest gain.

**Left out on purpose.** The hero's effects: PR #39 and the branch `player/sword-fx` were changing
`player/fx.js` and `combat/*`. The wyrm's blue and red wisps and orbs: colour signals.

**After the Obsidian Throne's rebuild merged (ADR-112).** The hall is gone: its wardens, great swords
and braziers are no longer placed, so this session's moved bronze wardens and brazier flames are not
in the game (the builders stay in `landmarks.js`). The crater's vents burn in the fire field instead.
Not filmed: the new crater with the Lord's effects on the field.

**Next.** The owner's look at the sheets and the preview (palette B or C, the Lord's colours, the
moved landmarks); the phone; then the hero's effects and a crisp red kind.
## 2026-11-15 — Session 47: the Ash Disciple uses the courtyard (four terrain moves)

**Task** (from the session that built the destruction system, ADR-107): give Shen Hui moves that use
the Ashfall Courtyard's pieces. Branch `claude/ash-terrain-moves-12f7d8`, cut from `world/destruction`
and rebased onto `main` once PR #44 had merged. Numbers reserved for it: ADR-111, Session 47.

**Found first:** he is bound to 12.5 m and only the bell and the stele stand inside that; the pillars
ring the paving at 15.6 m, the lanterns at 17.4 m. So each move takes him out to its piece and his
bound stretches for it (ADR-111).

**Done** (ADR-111; COMBAT.md → "He uses the courtyard"):
- `ashDisciple/terrain.js` (`TerrainMoves`): which piece, how he gets to it, what the piece does.
  Four moves as data in `moves.js`, numbers in `TUNING.terrain`: Severed Pillar (white cut, the fall is
  the world's red), Flying Lantern (blue, cued on the piece), Three Tolls (white, white, blue rings of
  sound), Swallow's Return (blue, off a pillar; wanted 2.4 x as much when he is pressed).
- Two generic hooks in `duelist/brain.js`: `weigh(name, def, w, dist)` in `_choose`, `onActStart(act)`
  in `startAct`. Nothing else in the engine changed; no `src/world` file changed.
- Training: a TERRAIN category (six situations that stage each move and put the courtyard back).
- Tests: `duel.mjs` `build({ real: true })` (the real courtyard and its breakables), scenario TERRAIN
  (50 checks), TRAINING on the real set (70 situations), DATA / TIMING know a `cast` and skip the
  terrain moves on the mock.

**Filmed** in headless Edge at 1280 x 720 at the game camera (a wrapper page stepping the game with
`__tick`): one strip per move, and Three Tolls at 852 x 393 with the phone camera. Sent to the owner
with one line per move on what it asks, and two looks for the ring of sound ("arc": one crisp line of
strokes; "wave": three thin ripples). The owner picked **"A: arc"**; the wave look and the
`TUNING.terrain.toll.look` switch that held it are removed. Nothing was said about the moves themselves.

**Changed after the first film:** the kick drew the blade's sweep trail (it read as a cut: `noSweep`);
the lantern's landing mark was a dark ring nobody could see on the night paving (now pale motes); the
glide's streak was too bright.

**Verified:** `duel.mjs` all, `lord.mjs` all, `world.mjs` all, `integ.mjs` all, the glyph check and the
build (see the PR). **Not verified:** a human duel with them, a phone's frame rate with three rings on
screen, the Lab panel by hand (the abilities list is read from `debug.abilities()`, which the tests
check).

**Open / next:**
- The bell has no toll sound of its own (the world's metal `chip` plays): `src/audio`.
- `courtyard.js` builds two pillars on the same spot at three corners of the ring (the loop adds
  `[t, -P]` and `[P, t]` for the same corner): seen while listing the pieces, not touched (not this
  session's file).
- Phase 2 only shortens the windups; a kindled variant (a burning lantern, ember rings) would fit.
- Training's BOSS MOVES trigger a terrain move from where he stands (the nearest piece however far);
  the TERRAIN category is the staged version.

---

## 2026-11-15 — Session 46: the Cinder Wyrm uses the ground (three terrain moves)

**Owner:** "the dragon will pick up a tree or item on the ground and throw it at the player ...
think of fun cool epic different terrain interactions the bosses and players". One of the staged
sessions after the destruction system (ADR-107). Branch `claude/dragon-terrain-moves-97933f`, cut
from `world/destruction` and rebased onto `main` once PR #44 had merged.

**Done** (ADR-110):
- `tuningTerrain.js` (numbers), `terrain.js` (`dragon.terrain`: the piece in the jaws and in the air,
  the mark, the blow, the burning wreck; the pickers `jawsPiece` / `tailPiece`), `terrainAttacks.js`
  (`hurl`, `tailBat`, `fireBrand`), wired into `ATTACKS`, `TUNING.attacks`, `dragon.js` (update,
  reset, the tell part `'piece'`).
- Uproot and hurl (red, P1), Tail bat (blue, P1; cover stops the boulder), Firebrand (red, P2+; the
  wreck burns 3.4 s). A move is picked only with a piece in reach; forced with none it casts about.
- They are in the Lab's ABILITIES and Training's BOSS MOVES (both read `debug.abilities()`).
- Tests: `integ.mjs` scenario TERRAIN (56 checks) on real `Destructibles` over a hand-built set
  (`build({ terrain })`); LAB runs on a grid of pieces and restores them before each ability.

**Shown to the owner:** a sheet of film strips (headless Edge, 1280 x 720, the game camera, lock on):
the three moves with one line each on what they ask, the hurl at 852 x 393 (`?touch`), and one pick:
how it holds a tree (A over the shoulder; B upright). **The owner picked "A: over shoulder"**: the
upright hold and its temporary `?hold=` switch were removed.

**Decided on the way:** the pale dust mark was dropped after filming (invisible on the night grass);
the hold "across the jaws" is not offered (the world's flight would snap it upright at the release);
the weights were raised from ~1.6 to ~3 after a bot fight picked a terrain move once in 25 attacks.

**Verification:** scenarios TERRAIN, LAB and TRAINING pass after the rebase; the full `npm test` and
`npm run build`: see the PR's check. Filmed: each move from the Lab trigger with the hero 16 – 20 m
off, on the real forest.

**Not checked / open:** a fight played by a human (how often the moves come up on the real clearing:
its pieces stand 14 – 28 m out; the difficulty); the phone on a device (look, frame rate); frame time;
the moves with the hero SOUTH of the wyrm at 18 m+, where the game camera cuts the wyrm's head off
the top of the screen (the mark and the piece's flight are on screen, the bite is not); the lab
stage has nothing to take; no sounds of their own.

**For the world's side (not edited here):** `throwTo` starts every flight upright with one spin axis,
and nothing bursts a held piece at once (`drop` and `throwTo` take at least 0.25 s): a `burst(piece)`
and a start angle would allow a flat-spinning trunk and a boulder that stops dead on cover. The
falling-tree strip is drawn in tell red on the ground, which ADR-052 ruled out for footprints.

**Next:** a played fight on the PR's preview.

---

## 2026-11-15 — Session 49: the Starless Lord uses the crater (three terrain moves)

**Owner:** "the 3rd sith boss will use the force to pick up rubble or the pillars to throw as examples.
think of fun cool epic different terrain interactions". Branch `claude/lord-terrain-moves`, stacked on
the open crater (PR #47, ADR-112).

**Done** (ADR-109):
- `starlessLord/terrain.js`: Void Hurl (one piece lifted and thrown), Glass Rain (three, one after
  another), Crown Fall (a tall piece beside the hero wrenched down on him). Data in `moves.js`
  (`terrain: kind`), numbers in `TUNING.terrain`; hooks in `lord.js` (`weigh`, `onActStart`, the cast,
  the frame).
- The duelist engine's `weigh` / `onActStart` hooks, copied from PR #46 (ADR-111) so both merge.
- The hanging stones are built on the floor and hung by their bodies' offset (`def.hover`), so a
  thrown one comes down to the floor. Torn Stone scars the floor where each stone is torn out.
- Training: a TERRAIN category for him (three situations), shown only on a level with pieces.
- Tests: `lord.mjs` TERRAIN (21 checks: no pieces → no move; each move's piece, ring, glint and blow;
  out of the ring; a stagger drops the stone; shards once the stones are gone; the reset; 90 s with
  the AI on; every answer escapes each move, standing still does not), and the TRAINING scenario now
  runs on the real crater.

**Filmed for the owner** (headless Edge, the real GPU): one sheet of film strips, the three moves at
1280 x 720 and Void Hurl at 852 x 393. Sent; no answer yet.

**Verification:** `npm test` (five suites) and `npm run build` pass.

**Found on the way:** a piece lands where its PIVOT meets the ground (`destructibles._fly`), so
geometry built in the air bursts in the air: build it on the floor and lift the body. A held piece
3.6 m over his head is off the top of a phone's screen. Training's runner records a fixed list of
events and does not answer a flash marked `hazard`: its situations for thrown pieces can only stand
and take it. `debug.setForm(1)` emits an uncatalogued event: a staged situation must not step him
back a form.

**Not checked / open:** a fight played by a human; whether the moves make him easier or harder (a
bot stood still for them); the phone in the hand; how the crater looks after a long fight when most
shards are thrown; sounds (the throw reuses the world's crash).

**Tuned** (the owner: "Keep and tune"): bots that answer each move (roll at the glint, roll or run
as the ring appears, keep running one way). With the first numbers only rolls escaped; now (flight
0.9 – 1.2 s, ring 2.1 m, aimed 0.15 s ahead, the rain's spread 1 m) every answer escapes and standing
still is hit; TERRAIN asserts it (ADR-109). The hanging stones drift slowly up and down. Found: a roll
tapped with no direction is a backstep, whose i-frames end before a red glint's blow lands.

**Next:** a played fight: his weights for the three moves, and whether 0.9 s is too generous.

---

## 2026-11-15 — Session 48: the Obsidian Throne rebuilt open (Starfall)

**Owner:** "i want you to redo the sith lord level as the levels in general should not be so confined
... the walls are also adding a visibility issue so make it more open, cool interesting
objects/structures/terrain etc that will make the gme look stunning in ascii theme and also for the
player bosses to interact with." One of the staged pieces of M1.38 (Session 44 built the destruction
system beside it). Branch `claude/level-open-throne-d3eabd`, on top of `world/destruction`.

**Rendered for the pick:** three open arenas behind a temporary `?arena=a|b|c` switch (Starfall, the
Grave of Blades, the Broken Hall), each at the fight camera (1280 x 720), walking up to the throne,
pulled back to show the whole arena, and at 852 x 393 with the touch preset; one sheet of all three
and one per arena, with a line on what each gives the fight. The owner: **"A Starfall"**.

**Done** (ADR-112):
- `world/throneHall.js` is the crater: rings of plates round the seal, the star as his throne
  (`landmarks.js` `buildFallenStar`, `buildSpike`, `starCleft`, `facetCol`), twelve shard clusters,
  six stones hanging in the air, four vents, a broken crown of rim slabs (low south, tall north), the
  forest outside thrown flat. Layout `THRONE`. The switch, the two other concepts and the hall's
  walls, pillars, braziers, wardens and great swords are gone from the level.
- 36 breakables in ADR-107's shape (shard 19, slab 11, hover 6), an ember `scarInk`.
- `levels/starless.js`: the lip at z 14.8 is where he wakes; `dragonBound` 13.6 and `bossFloor.zN`
  (the dais's line); two lines of text. The Lord's `TUNING.hall` rectangle is gone: `bound` 13.6 and
  `clampTarget(p, pad)` / `onFloor(x, z)`.
- `duelist.js`: `standable(x, z)`; a flurry's blow comes from a side of the hero he can stand on
  (at the rim his flits were pushed back onto his floor and whiffed).
- Tests: `lord.mjs` LEVEL (the layout, the breakables' shape, "open" as three checks, the vents),
  BOUNDS (a hero at the rim), FLOW (the lip); `world.mjs` `sets` lists the throne.

**Verification:** `npm test` (five suites) and `npm run build` pass. The final build rendered in
headless Edge with the real GPU and compared with the frames the owner picked from: 0.07 – 0.21 % of
pixels differ (particles). The walk in from the bonfire looked at too. Frame cost against the hall:
ADR-112 (fewer triangles and lights, one more draw call, render time 0.85 – 1.03 of the hall's).

**Found on the way:** separate timing runs are useless while other sessions use the GPU (the hall
itself read 2 ms, then 19 ms): put both builds in one page (a second checkout served under a path of
the same origin) and alternate the renders. A single render is shorter than a display refresh and
reads as a multiple of it: time 12 – 20 passes, then wait for the GPU once. 60 % of the hall's
triangles were sparse grass out to 75 m that the fog hides. `Colliders.resolve` does nothing for a
point exactly on a circle's centre (a test probe has to stand beside it). A scar ink of 0.5 in the
red channel was invisible on the black floor at the game camera (the marks are alpha glyphs): the
crater's is 1.4, checked there.

**Not checked / open:** a fight played by a human in the crater; his difficulty there (thin cover,
no corners; nothing was retuned); the phone (frame rate on the device, the look in the hand); the
Training situations on the real level (they run on the lab stage); how long a shard cluster lasts
as cover in a real fight (one blast of power 2.5 broke a 3.1 m cluster and only chipped a 3.6 m one).

**Next:** the Lord's terrain moves on this floor (ADR-109): shards and hanging stones lifted and
thrown, a rim slab pulled down across the hero's path, a storm of rubble, Torn Stone tearing up real
plates.

---
## 2026-11-15 — Session 45: per-move telemetry; the death screen names the killing move

**Owner:** "Yes, telemetry" (the genre review's third piece). Branch `game/move-telemetry`, stacked on
`core/sim-step` (PR #43), own worktree. Session 45 / ADR-108: PR #41 and #44, open beside it, hold
Sessions 43 / 44 and ADR-106 / 107.

**Done** (ADR-108):
- `player.takeHit` announces every blow it resolves: `combat:answer`.
- `game/telemetry.js` `MoveLog`: a row per boss move (blows seen, hit, blocked, parried, clashed,
  dodged, damage, kills) for the attempt; totals per level in localStorage; a contact stream is one
  blow per 1.5 s.
- The death screen: "SLAIN BY <MOVE>" and up to three moves with "n of m blows landed", small and
  dim under the hint (`hud.bannerRecap`). The victory record: "Struck most by".
- `boss.attackLabel(id)` on the wyrm and the duelists; `flow.moveLabel`, `flow.deathRecap`.
- Console: `__telemetry()`, `__telemetry('all')`, `__telemetry('clear')`.
- **Tests:** duel TELEMETRY (the table by itself with a fake storage; in the duel: a string taken, a
  parry, a death, the recap in the banner, a new attempt after rising).

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server on `?level=ash`: Swallow
Flicks taken, then killed by Lotus Sweep: the death screen at 800 x 600 and at the phone's 852 x 393
(`?touch`): three lines under the hint, clear of the banner, inside the screen.

**Not checked / open:** the wyrm's and the Lord's labels only by the tests' lookups (no death filmed
there); upright on a phone; nothing read back from a real play session yet. The phone has no way
to read the stored table.

**Next:** the owner plays; then tune from `__telemetry()`. The heavy button needs their answers.

---

## 2026-11-15 — Session 44: the world breaks (breakables, ground fire, cover, marks)

**Owner:** "i want all the bosses to be able to cause destruction to the background ... the dragon
fire that hits the background (trees, grass) get on fire and are a temporarily hazard ... the
humanoid bosses will chip and damage the structures and leave impact based on the power of the
attack. the players can also do this as well. i want the bosses to also use the terrain ... you can
also redo the backgrounds of the levels. i want you to redo the sith lord level ... ask me any
questions". Branch `world/destruction` from `main`. (Numbers: other PRs open at the same time took ADR-101 – 103 and Sessions 40 – 42, so this is
ADR-107 / Session 44; the hero seen behind the wyrm is ADR-106 / Session 43, the open Obsidian Throne
ADR-112 / Session 48 (renumbered when PR #45 took ADR-108 / Session 45) and the Lord's terrain moves ADR-109.)

**Asked, answered:** fire burns where it lands (no spreading); the terrain is a real tactic for the
hero (cover, pieces felled onto a boss); Cinderwood and Ashfall keep their layouts and get things to
break; "staged PRs and separate agents doing parallel tasks".

**Split:** two sessions were started on their own branches: the hero seen behind the wyrm (PR #41,
ADR-106) and the open Obsidian Throne with the Lord's terrain moves (ADR-112, ADR-109; it was sent
this API). This session built the system the rest stands on.

**Done** (ADR-107):
- `world/destructibles.js`, `fire.js`, `scars.js`, `breakTuning.js`; `world.impact / ignite / restore`;
  `Colliders.remove / restore`; the two set materials can be rigid-batched.
- Cinderwood lists 81 breakables (17 of them new, inside the clearing), Ashfall 72.
- The hero's blade and slam, the wyrm's striking parts, slams, meteors, fire and body, the duelists'
  zones, crescents, thrown stones and the Void's lines all hit the world; cover stops bullets,
  crescents, torn stones and stands in for the hero against the bolt, the pull and the grip.
- Sounds `chip` and `crash`; events world:impact and world:fire; the Lab's WORLD section (Burn ahead,
  Fell on me, Blast ahead, Restore) and its Reset restores the world.
- Tests: `tests/integration/world.mjs` (87 checks), added to `npm test`.

**Rendered for the pick:** three ways a broken piece comes apart (digits, chunks, shards; a
temporary `?debris=` switch) and the fire on grass and a tree, sent as two sheets. The owner picked
**"A: digits"**; the switch and the two other looks are removed. Nothing was said about the fire.

**Verification:** `npm test` (five suites) and `npm run build` pass. Filmed in headless Edge at 1280 x 720
on the dev server: a tree and grass set alight and burning out, a tree felled onto the hero (the red
strip, the hit), a stone chipped then broken, the hero felling a dead tree with two charged cleaves,
the wyrm's breath lighting the grass, and a 16 s fight with the AI on. Draw calls and triangles
against `main`: ADR-107.

**Found on the way:** `node_modules` in the main checkout was emptied while this session ran
(reinstalled; cause not found, the parallel worktrees are the likely one). The Browser pane was
hidden for the whole session and throttles timers: captures were made with headless Edge and a
wrapper page instead. A debris glyph under ~0.4 m is a dot at the game camera, and debris in the
material's lit colour bloomed white.

**Not checked / open:** a fight played by a human; the difficulty with breakables and fire; the
phone (look and frame rate); frame time; Ashfall and its duelist's blows in the browser (headless
tests only); Training places the hero without a look at what
stands there.

**Next:** the owner's review of PR #44; the wyrm's and the Ash Disciple's terrain moves and the open
Obsidian Throne run as their own sessions (started; the throne waits on the owner's pick of an arena).

---

## 2026-11-15 — Session 43: the hero seen through the wyrm (an ink ghost in the blade's cyan)

**Owner:** "i noticed while fighting the dragon the player disappears and cant see whats going on
if its behind the dragon. think of a good way to still let the player be seen somehow for these
situations." Branch `claude/render-hero-seen-125813` (PR #41), one of several sessions working in parallel
(destructible terrain, the open Obsidian Throne). ADR-101 / Session 40, set aside for this, went to
a PR that merged first; ADR-102 to ADR-105 and Sessions 41 / 42 belong to PRs open at the same
time (the terrain and throne work of this group, and #42 / #43).

**Reproduced** (dev server on its own port, the wyrm frozen in a pose, the hero placed round it):
north of its body, under a wing, behind it while it rears for Armageddon, under it while it flies
low; at 1280x720 and at a phone's 852x393 (`?touch`). In all four he is fully gone.

**Options rendered for the pick** (a temporary `?seen=a|b|c` switch; the same frozen frame in every
column; five situations on desktop, four on the phone, a film strip of him walking in under a wing,
whole frames): A ink ghost, B window, C rim only. The owner picked **A**. A draft PR carried the
switch so the three could be tried on the phone's preview.

**Done** (ADR-106):
- `pipeline.js`: `seenRT`, `setSeenThrough`, `_renderSeen` (the hero alone, the erasing quad, the
  patch into the scene target), `_seenProbe` (the occlusion-query gate), the ASCII pass's `tSeen` /
  `uSeen` / `uSeenInk` / `uSeenTone`, `seenHalo` over the wyrm's letters, one shared definition of
  the hero's alpha window. `main.js`: one line. `config.js`: `CONFIG.render.seenThrough`, `?noseen`.
- A human boss in front of him is never cover (he is drawn through the hero's materials); grass
  at his feet never counts.
- Tests: integ SEEN (51 checks, the real `Pipeline` on a recording renderer): when the pass runs
  and when not, its box, what it tells the ASCII pass, the state it leaves (also when a draw
  throws), its place in the frame, the probe (on from the first frame, off 20 frames after the
  last yes, on while no answer comes, off for good when queries fail), `?noseen`.
- Docs: ARCHITECTURE (the contract, the frame order), STYLE (the look; cyan is the hero's).

**Numbers:** in the open the frame is pixel-identical with the pass on or off (0 of 921,600
pixels differ); under a wing ~6,200 differ (the ghost and its glow, ~800 covered hero pixels).
Frame cost, Edge headless on the RTX 4090, 1280x720, medians of 12 x 60 frames, one task a frame:
in the open 5.24 → 5.22 ms (58 draw calls, 57 before); under a wing 3.85 → 4.37 ms; north of the
body 3.82 → 4.10 ms (78 draw calls). Without the gate: +0.44 ms and 77 draw calls everywhere.

**Verification:** `npm test`, `npm run build` (see the PR). Browser: the four situations and the
open at 1280x720, a wing at 852x393, the Ashfall duel (unchanged with the boss in front of him).

**Found on the way:** a `javascript_tool` call that runs too long is killed without its `finally`
blocks: a per-frame flag my first version flipped on the hero's root stayed flipped and he was
drawn at a stale place for the rest of the page load (the pass no longer touches that flag). An
occlusion query's answer never arrives inside one task, so frames stepped with `__tick` would have
switched the pass off: no answer for more than 3 frames counts as a yes.

**Not checked / open:** a real phone (look, frame rate, Safari's occlusion queries: if they throw
the pass runs every frame; if they never answer, too); the look in a played fight rather than
posed frames and one strip; 1080p and 4K by eye; the Obsidian Throne (being rebuilt in another
session). A cover closer than 0.6 m in front of him hides him without a ghost.

**Next:** the owner's phone test on the preview; then the terrain work's thrown trees and lifted
pillars should need nothing more than being drawn in the scene pass.

## 2026-11-15 — Session 42: a frame is simulated in steps of about 1 / 60 s

**Owner:** "lets implement your suggestions" (the genre review; this is its second piece). Branch
`core/sim-step`, stacked on `combat/reward-order` (PR #42), own worktree.

**Done** (ADR-103):
- `core/timestep.js`: `simSteps(realDt)` cuts a frame into equal steps none longer than 20.8 ms (one
  at 50 Hz and above, two of 1 / 60 s at 30 fps, six at most); `runFrame` runs them and clears the
  input's edges after the first.
- `main.js`: the loop is `simulate(stepDt)` (clocks, Lab, flow, fighters, world, lights, particles)
  one or more times, then the camera, the HUD, the audio and the render once. The frame clamp went
  from 50 ms to 100 ms: the game runs slow under 10 fps, not under 20.
- `window.__tick(dt, frames, asFrame)`: `asFrame` runs each as a rendered frame cut into steps.
- **Tests:** integ TIMESTEP (the split at 240 – 2 fps, the longest step, runFrame's order, a second
  at 30 fps, a tap in a two-step frame is one press, how often the 0.08 s window is sampled).

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server on `?level=ash`,
through the real loop's own tick (`__tick(1 / 30, n, true)`): two steps of 16.7 ms a frame, a second
of real time in 30 frames, a tap of lock-on toggles once, a Plum Thrust parried at 30 fps frames.

**Not checked / open:** the pane was hidden, so `requestAnimationFrame` itself never drove it: the
loop was driven through `__tick`'s frame path. Nothing was run on a machine that is really slow, and
the cost of two to six steps a frame was not measured. A press is still read once a frame.

**Next:** per-move telemetry and the killing move on the death screen; a heavy button.

---

## 2026-11-15 — Session 41: the rewards ordered by risk: the flurry on red only, the flash counter, a perfect parry that pays

**Owner:** "what updates, combat engine changes, etc can we do to make this game to be one of the most
soulslike/onimusha/phantom blade genre type of game? i plan to sell this on steam", then, on the
write-up: "yes measure and lets implement your suggestions". Branch `combat/reward-order`, own
worktree (the main checkout held another session's work). Session 41 / ADR-102 / M1.35: PR #39, open
beside it, holds 40, ADR-101 and M1.34.

**Measured first** (the `strategy` scenario, new in all three suites, opt-in): three god-mode bots
that differ only in how they answer a tell. The bot that only perfect-dodged beat every boss fastest
with a third of the inputs. The table is in COMBAT.md "The reward order".

**Done** (ADR-102):
- **The flurry on red only.** A perfect dodge of a white or heavy blow counts in the streak and slows
  time where the hero stands; no flurry, no plunge, no crit window, the string goes on.
- **The flash counter.** A trade clash in the instant the cut became a cut goes through him: 70 damage,
  60 posture, he reels, the crit window, FLASH COUNTER (`player:counter`, `attacker.onCounter`).
- **A perfect parry pays:** × 1.5 posture and the counter cut (the next light twice as fast, a crit).
- **Fixed:** a blow of a foe's flurry that reached nobody settled nothing (the flurry never ended).
- **Tests:** duel GHOSTEP (white: in place; red: the flurry; the switch), TRADE (the flash counter),
  PERFECT (new), integ RED (the bite's perfect dodge is no plunge); PLUNGE / FLURRY test the move
  itself under `debug.flurryAny`; `strategy` in integ / duel / lord.

**Found on the way:** a 1.2 s crit window on a white perfect dodge left the dodge bot the fastest on
the wyrm (63 s): the window is 0. The Lord's training run failed on "block his flurry" once the
random stream shifted: two of five blows fell short of a standing hero and nothing ended the flurry.

**Verification:** `npm test`, `npm run build` (see the PR). The strategy runs before and after.

**Not checked / open:** no human has played it. The flash counter and the in-place perfect dodge
were not filmed. The wyrm cannot be flash-countered (its claws are not steel). One seed per bot on
the wyrm before the change.

**Next** (the owner's go-ahead covers them, each its own PR): a fixed-timestep simulation; per-move
telemetry and the killing move on the death screen; a heavy button and chosen swings; HP-linked
posture for every boss; then saves, a hub and ranks.
## 2026-11-15 — Session 40: the flurry on a man, paced to be followed; an afterimage in digits

**Owner:** "the animation looks great vs the dragon but against the humanoid bosses, the
teleportation attacks are a bit hard to follow and doesnt seem fluid and buggy. lets also leave a
cool after image that fades always in a stunning transition effect per teleport and use ascii for
the effects where you can as well". Branch `player/flurry-duel-read`.

**Measured first** (a probe that logs every frame of a flurry: positions, the camera, the boss's
mode; the Training situations and `debug.flurry` on Shen Hui). What made it read as buggy: the hero
froze on top of the duelist on every hit; a metre a frame, three readable frames a cut; the duelist
shoved 0.32 m in a frame by every cut and left in his own attack's pose; after the last blow he
staggered back into the hero; the camera jumped ~1.2 m a cut and ~5 m on the last; effects sized for
the wyrm's head covered both men.

**Done** (ADR-101):
- `DEFENSE.flurry.ground`: the cuts against a duelist (hang, past his side, the strike before he is
  abeam, a held finish, a short hanging line, effects at 62 %, a gentler camera). The Passing Cut
  and the Falling Leaf pass his side too.
- duelist `takeHit`: a flurry's cut flinches him in place (no shove, out of his move); the last blow
  staggers him away from where the hero lands (`away`).
- The afterimage: his own body printed in digits on a screen grid (`player._sampleBody`,
  `PlayerFx._afterimage`), digits flying to where he reappears (`blinkStream`) and in onto him
  (`blinkIn`). On every blink: Ghostep, plunge, flurry, riposte. Three looks were filmed for the
  owner (digits / echo / shatter); the owner picked **digits** and the others were removed.
- Tests (duel GHOSTEP): the cuts never nearer than the side offset, no step of his over 0.12 m in a
  frame, he ends farther from the hero than he began and does not push him, the first cut throws him
  out of his move, the afterimage has its points.

**Numbers, before → after** (five blows, the Passing Cut, AI off): the duelist moved 1.97 → 0.13 m
in all, 0.32 → 0.02 m at most in a frame; the camera's biggest step 4.62 → 2.78 m, its whole travel
28.6 → 19.9 m; the flurry 105 → 131 frames. In the real situation (Training `pd5`): the hero pushed
0.36 → 0 m after the last blow; the duelist ends 2.07 m from him (was walking into him).

**Verification:** `npm test`, `npm run build` (see the PR). Browser: frame sheets before / after on
Shen Hui, close-ups of the afterimage, the three looks (sent to the owner).

**Not checked / open:** the Starless Lord and the wyrm only through their test suites (the wyrm's
pacing is untouched; its blinks have the new afterimage); a phone.

**Next:** the particle count of a long flurry on a phone.

---

## 2026-11-15 — Session 39: the boss's rows at the top; QUIT TO TITLE; RESUME like the other items

**Owner:** "move the boss hp ui from bottom to top", then "also when you press esc in a level, give
an option to go back to the title screen. align the resume button to be on the left like the other
buttons." Branch `ui/boss-bar-top` from `main`.

**Done:**
- The boss's rows (name, HP, posture, BROKEN) sit at the top centre on every screen (desktop 14 px
  down, a phone held sideways 6 px; upright they were already under the player's rows). The
  camera's keep-in-view box trades room accordingly (top 0.78, bottom 0.86 of the frame).
- The Lab's floating toggle moved to the bottom centre (it covered the boss's name); a phone's
  pause panel now hangs from the top.
- Pause menu: **QUIT TO TITLE** as the last item (`flow.quitToTitle()`: the level is reloaded, which
  opens on the title with the fight reset). It asks once: the first press turns it into "SURE? PRESS
  AGAIN" for 3 s, reopening the menu disarms it. The pad's menu focus reaches it.
- **RESUME** reads like the other items: the label on the left, its key on the right.
- Tests: ASCIIHUD checks RESUME's layout, QUIT TO TITLE's place, its arming and disarming, and the
  title after the second press (headless: no reload, the flow goes to 'title').

**Verification:** `npm test`, `npm run build`; in a browser, QUIT TO TITLE pressed twice in the pause
menu reloaded `?level=ash` onto the title screen. Screenshots of the boss's rows on desktop, a phone
held sideways and upright, and of the pause menu on desktop and phone.

**Not checked / open:** Over the wyrm's bright red body at the top of the frame the boss's rows are harder
to read: they rely on their halo.

---

## 2026-11-15 — Session 38: one art design: objects in the dragon's look; landmarks

**Owner:** "all 3 levels need all the background objects like the pillars and structures to look
completely made of ascii characters. Right now it looks like a normal object with random ascii
pattern stickers put on top of it." Then: "Lets not touch the floor character and bosses ... The
prod build is the perfect ascii look im aiming for. Apply this design to all the background objects
as well." Then, after a gcdAtlas-style preview they asked for: "dragon look and update any md file
to ensure all future background and characters are following the same art design". Branch
`render/prop-art` from `main` (PR #34). (ADR-098 / 099 and sessions 36 / 37 are left to the two PRs
open at the same time, #35 and #36, which both use 098 and 36.)

**Done** (ADR-100):
- **Prop art:** `FLAG.ART_PROP`, `createPropArtMaterial`, the art pass's prop branch (`artLetters`,
  `edgeDir`, `uProp*`), the ground anchor. The three sets' `stones` meshes and the small grid props
  (bones, bonfire, bell, braziers) moved to it. Floors stay carved.
- **Landmarks** (`world/landmarks.js`): seven builders, hooked into the three sets with their
  colliders; trees and boulders in their footprints are built, then dropped.
- **The rule, written down:** CLAUDE.md ("One art design: the dragon look"), STYLE.md's new first
  section "The house style" (what the look is, which path draws what, what is exempt and why, a
  checklist, what the owner turned down), ARCHITECTURE.md (the contracts).

**On the way (kept out of the repo):**
- A first answer, carved glyphs filled to every cell on objects and floors, was built, shown and
  turned down. It did find why the old objects read as stickers (see STYLE.md "Background objects").
- A whole-frame character grid ported from the owner's gcdAtlas project, as a scratch module:
  rendered in all three levels and measured. Feasible; the owner chose the dragon look.

**Verification:** in the dev server at 1280x720: two views per level beside the live game, close-ups.
Frame cost in Chrome on an RTX 4090 (ADR-100 has the numbers): about equal to the live game at
1080p. `npm test` (all four suites, no console errors) and `npm run build` pass; the static check
now guards the prop flag's alpha window, each set's prop art material and the written rule.

**Found on the way:** the built-in Browser pane renders with a software driver (frame timings there
are meaningless); a visible Chrome tab keeps the fight running, so timings need a frozen, calm scene.
The throne hall costs ~10 ms a frame at 1080p on a 4090 before this change: the heaviest view.

**Not checked / open:** the look in motion (the letters' drift toward the screen edges, the
fade-near-player dither); a fight played round the new colliders; the phone (look and frame rate);
1080p and 4K by eye. The stone swordsmen read as a mass of digits with inner outlines, not yet as a
clear figure; the gate is mostly off the top of the frame; the old bone pile is mostly strokes.

**Next:** the owner's look at the Vercel preview; then a second pass on the landmarks.

---
## 2026-11-15 — Session 37: Training (every situation, one click) and the lab stage

**Owner:** "Make a lab mode to easily tell every situation with a simple click. For example i want to
see every streak animation and effect between the character and bosses. Think of every situation i
would want to test in a list by category like a fighting game lab mode in a cool lab
background/stage". Branch `dev/training-lab`, own worktree.

**Done** (ADR-099):
- **Training** (`dev/training.js`, `dev/trainingPanel.js`): 8 categories, 42 situations on the wyrm,
  60 on the Ash Disciple, 82 on the Starless Lord (BOSS MOVES grows with his moves). One click plays
  each: the runner sets it up and plays the hero through the input's virtual keys, answering the
  boss's glints. A banner names it and gives ✓ / ✗. Speed, loop, the answer for boss moves, the
  stage and the boss in the panel. F4 / the Lab's TRAINING button / `?training`.
- **The lab stage** (`world/trainingRoom.js`, `?stage=lab`): a training room for any boss. Three
  looks were filmed for the owner (Grid, Holo, Void); the owner picked **Holo** and the others were
  removed.
- **Found on the way:** the Ash Disciple's streak flurry had the same name as his phase-2 string
  (both "Hundred Petals"): it is **Scattering Ash** now.
- **Tests:** integ / duel / lord TRAINING run every situation for their boss (all pass).

**Verification:** `npm test`, `npm run build` (see the PR). In the browser: the panel and a riposte
×3 on Shen Hui on the Holo stage (screenshot); a flurry on Shen Hui on each of the three looks (a
sheet sent to the owner).

**Not checked / open:** the wyrm and the Lord on the lab stage only headless (their sims run on their
own sets); phones (the panel is narrower there but not tried).

**Next:** situations the owner asks for.
## 2026-11-14 — Session 36: an ASCII HUD (text meters, block-letter banners), a minimap that barely exists

**Owner:** "Make the minimal much smaller and opaque on mobile. Theres no need for mini map in
general for this game so lets make it small overall on both desktop and mobile to not take screen
space. Also think of ways to improve the ui design and layout and to also incorporate the ascii art
style as well to fit the ascii theme. Ask me any questions". Branch `ui/ascii-hud` from `main`.

**Asked, answered:** the minimap tiny and faint; keep the desktop log, the name tags and the key
hints, drop the name / level / class lines; for the HUD's look and for the big words: "render all
three first" and "show me what the ascii block letters would look like first".

**Rendered for the pick** (desktop 1280 x 720 and phone 852 x 393, in the Ashfall Courtyard fight):
three HUD looks behind a `?hud=` switch (bare glyph lines / terminal frames / a roguelike status
line) and three big-word styles behind `?words=` (logo-style blocks / # only / spaced capitals).
The owner picked **bare glyph lines** and **logo-style blocks**. The switches and the two looks not
picked are removed again.

**Done** (ADR-098):
- `ui/glyphBar.js`: `GlyphBar` and `GlyphPosture`, meters made of characters, with the old bars'
  contract. `ui/bars.js` deleted.
- The player's rows and the boss's have no panel; the name plate is gone; the boss's name is
  spaced monospace capitals; phase gates are a `|` over the meter.
- `ui/blockText.js`: block letters A – Z in the logo's letterforms; `ui/banner.js` draws every
  banner with them, fitted to the window and refitted on resize.
- The minimap: 72 px at 60 % on desktop, 40 px at 50 % on phones, no frame / title / coordinates.
  LOCK and pause moved beside the smaller disc.
- No serif font in the HUD (the mini banner and the pause title are monospace).
- The flask key chip is hidden on touch (a phone has the FLASK button).
- **Tests:** integ.mjs ASCIIHUD (the meters' runs, the lost piece, the smallest and the fullest
  cell, the posture from its middle, the block font's rows, the stacking, the HUD's own meters and
  banner, no name plate, no minimap panel).

**Found on the way:** the empty cells were invisible at 50 % and the meters had no visible end:
brighter dots and brackets. "104 / 160" wrapped under the meter. The phase tick sat a bracket's
width off: it is placed inside the brackets. In '#' only, the font's sixth row (shadow strokes)
was blank. The new test found a meter held just short of full drawing a
"lost" cell. A phase call in block letters lay across the fighters in the middle of the fight: it is
smaller (6 px a character at most) and sits at 21 % of the height, without the dark band.

**Not checked / open:** see the PR. Nobody but me has seen the meters move. Only the Ashfall
Courtyard was captured; the wyrm's three-phase bar and the Starless Lord's life pips were not
looked at with the new rows. Tablets not looked at.

---

## 2026-11-14 — Session 35: the phone's right thumb, a lock marker that fades, the guard meter

**Owner:** "Lets improve mobile ui / user experience. The right side controls are too far bottom in
the right corner ... Im having a hard time shuffling between attack dodge and block. Think of a way
to make it easy and intuitive to switch between the different options. Make the target lock icon be
subtle and slowly fades away ... add a guard meter and any parry will restore guard meter ... let it
replenish quickly ... I don't want to punish the player for playing defensive." Four questions
first; the answers: slide between the buttons; at empty the guard is knocked open; no HP chip while
there is guard; landing hits restore it too. Branch `ui/mobile-guard` from `main`. (PR #32 and
PR #34 merged while it was open and took Sessions 33 – 34 and ADR-093 – 094: this is 35 and ADR-095 – 097.)

**Done:**
- **The pad** (ADR-096, `ui/touch.js`, `CONFIG.touch.pad`): ATTACK, BLOCK and DODGE are three
  tiles that all touch, raised and inset from the corner; a touch near the cluster goes to the
  nearest tile; a thumb slides from tile to tile without lifting. FLASK rides with it, LOCK moved
  to the top right. Pause menu: PAD POSITION (low / mid / high) and PAD SIZE (small / medium /
  large), kept in localStorage; the controls show through the pause screen while they are stepped.
- **The lock-on marker** (`ui/nameTags.js` `LOCK_MARK`): a small dim diamond when the lock is taken,
  gone after 3 s.
- **The guard meter** (ADR-095, `GUARD` in `combat/rules.js`): a blocked blow costs guard and no
  HP; empty knocks the guard open for 0.55 s (`player:guardOpen`, GUARD DOWN); it refills at 60 / s
  in every state; parries and landed cuts give some back. A steel bar under the HP bar, a gauge on
  the BLOCK tile.
- **Tests:** integ.mjs GUARD (new: cost, the refill behind a held guard and in a swing, the
  opening, parry and hit restore, streams, the HUD bar); TOUCH drives the tiles through the pad and
  checks nearest-tile, the slide (ATTACK → BLOCK → DODGE on one finger), the stick, two fingers,
  the BLOCK gauge, position and size; BLOCK now expects no HP loss.

**Second request, same session:** "Allow the game to be played in non landscape as well and adjust
the ui to allow that. Make the joystick and right buttons to blend in with the game so the buttons
aren't covering the game screen. The mini map is also covering a lot of the screen on mobile."
- **Upright play** (ADR-097): the "rotate your phone" overlay and its pause are removed. The camera's
  field of view opens in a window taller than wide (`fovFor`, 32° → ~64° on a phone), the upright
  phone profile stands 1.2 × back and leads 1.5 m south; the stick's zone, the pad's three places
  (`pad.posPortrait`) and the stick's rest follow; the HUD has an upright layout (frame and boss bar
  on top, prompt and banners above the thumbs, the pause panel in the upper half, the title to the
  screen's width).
- **See-through controls:** no filled panels; hairline tiles, brackets and haloed glyphs at 62 %,
  the stick at 40 % with no disc; full strength under a thumb.
- **Minimap on phones:** a bare 70 px disc at 72 %, no panel, title or coordinates; LOCK and pause
  beside it.
- **Tests:** TOUCH's portrait block rewritten: no overlay and no pause, controls live, a held stick
  let go when the phone turns, the camera profile and `fovFor`, the pad and the stick inside the
  upright screen, a press at the portrait place, PAD POSITION upright, landscape restored.

**Found on the way:** the first lead of 3 m put the hero at a third of the screen's height with
the boss pressed against the HUD: 1.5 m. Faint tiles vanished over a lit pillar: a dark halo on
the glyphs and 62 % instead of 55 %. The pause panel covered the pad it is meant to show while
PAD POSITION is stepped: upright it keeps to the upper half.

**Decisions:** ADR-095, ADR-096, ADR-097.

**Not checked / open:** see the PR. Nothing was tried on a real phone: where the thumb rests (PAD
POSITION is for that), whether the faint controls are findable in a fight, the upright camera
against the wyrm (the view is ~14 m wide; only the Ashfall Courtyard was looked at upright), iOS
Safari's bars in portrait. The bosses were not re-tuned for blocks that cost no HP.
## 2026-11-15 — Session 34: weight on the flurry; one streak for parries too; a foe's streak and flurry

**Owner:** "Lets add some weight, hitstun impact to the teleport attacks and make it visually and
animation effect wise way more epic ... add this streak system to parries clash deflects as well.
Also give the streak system and attacks to bosses as well. Lets allow the player the opportunity to
block perfect parry a boss's special attack from its defensive option and if the boss is on a high
streak, the player needs to parry / block the total # of attacks. Ask me any questions". Four
questions asked; the owner took the recommended answer to each (one shared streak; a counter flurry
on the last blow of a string; duelists build theirs by guarding; answering every blow breaks his
posture). Branch `combat/streak-everywhere`, in its own worktree (the main checkout held another
session's uncommitted work). Session 34 / ADR-094: PR #32, open beside it, holds 33 and ADR-093.

**Done** (ADR-094):
- **Weight:** every flash cut freezes the hero on the contact and is followed by a beat in which
  the world runs at 60 %, so the target reels (a duelist thrown and shoved, the wyrm's head
  flinching); a speed clone mid-pass; a shock ring and dust under a foe on the ground; the last
  blow's impact frame (speed lines across the screen, a dark blink, a flash, the HUD's screen
  cuts), broken ground, and a duelist staggered.
- **One streak:** parries, deflects, trade clashes and the mikiri count in it.
- **The riposte:** a parried last blow is answered with as many flash cuts as the streak counts;
  the hero ends where he parried.
- **A foe's streak:** a duelist counts the strikes his guard turns (pips on the boss bar) and from
  three may answer with his flurry (Hundred Petals; Starless Storm, one per form): the first blow
  from where he stands, each later one from another side; a guard meets them from any side; all of
  them answered breaks his posture.
- **Tests:** duel.mjs STREAK (his streak; his flurry parried, blocked, let through; the riposte),
  integ.mjs RIPOSTE (on the wyrm); STRINGS and the guard's counter test isolate what they measure.

**Found on the way:** the wyrm never said which blow of a string was its last, so every parry of
one was a "last blow" to the hero (the riposte would have cut every string off at its first blow;
the parry's freeze was the long one): `hitPlayer` now passes `last` and `melee`.

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server, as strips at 60 fps:
a flurry of four on Shen Hui with the new weight (the reel beats, the clones, the impact frame);
his own flurry of four against an idle hero.

**Not checked / open:** no human has played it. Not filmed: the riposte (tested headless on both
bosses), the Starless Lord's flurries (his data tests pass), the HUD's screen cuts and the boss
pips (DOM, exercised by the tests' shim only), anything on the phone preset. The sounds were not
heard. Nothing was re-tuned: a riposte of seven after two parried strings is a lot of damage, and
his flurry comes about every third guarded strike.

**Next:** the owner plays it; then the riposte's damage and the foe's streak thresholds.

---

## 2026-11-15 — Session 33: the wyrm in fine digits again, one size up

**Owner** (after PR #31 went live): "the dragon is way too flashy right now and the ascii text is too
big. use more smaller and make the ascii graphics detailed instead of huge flashy like this". Then,
on three rendered sizes: "B, medium". Branch `render/wyrm-detail` from `main` (PR #31 merged).

**Done** (ADR-093):
- **An option sheet**, rendered in game at 720p with the old calm tone: 4x6, 5x8 and 6x9 px cells
  beside the live 8x13; the owner picked 5x8.
- **`wyrmGlyphs.js` back to pixel fonts:** the 3x5 and 4x6 fonts of ADR-018 and a new 5x7 one,
  picked per screen height by `wyrmArtFont(H)` (cell ≈ H / 90: 5x8 at 720p, 6x9 at 1080p, 4x6 on a
  phone); the old digit sets. The pass rebuilds the atlas when the font changes.
- **The calm tone back** in the pass (`uWyrmTone`, `uWyrmGlyph`, `uArtLum.y`, `uArtMin.y`). Kept: the
  anchored grid and the 4x4 averaged tier.
- **The glyph check** now imports `wyrmGlyphs.js`: every set letter has a bitmap in each font, each
  bitmap is the font's size, and the cell per screen height (393 / 720 / 1080 / 1440 / 2160 px).

**Verification:** in the dev server: the built look beside the picked preview at 720p (the same), the
camera pulled back to 50 m, phase 3 with the fire breath, 852x393 (4x6 cells) and 1920x1080 (6x9
cells); no console errors. `npm test` (all four suites) and `npm run build` pass.

**Not checked / open:** the frame rate on a phone; the wyrm in flight and in motion at 60 fps
(stills only). The human bosses' letter size and the landmarks (a first pass parked on the local
branch `wip/landmarks`) still wait on the owner.

---
## 2026-11-14 — Session 32: the ASCII look; the wyrm in large letters; landmarks, first pass

**Owner:** "how can we improve the ascii visuals and graphics of this game? im not feeling the ascii
art style to the fullest". Then, on three rendered options: "scrap everything. i want you to make the
dragon, bosses, look more ascii like. also add bigger cooler detailed appropriate background objects
that can also be made full of ASCII". Then, on the wyrm's three letter sizes: "B, large". Worktree
`.claude/worktrees/ascii-bosses`, branch `render/ascii-bosses` from `main` (PR #27). (Sessions 30 and
31 and ADR-086 – 091 belong to branches open at the same time.)

**Done:**
- **A diagnosis**, from captures of the three levels at the game camera: what reads as ASCII is big
  glyphs on black (the throne hall, the canopies); what does not is the grass carpet, the fighters'
  4 px dot marks and five different letter sizes on one screen.
- **Three options rendered and scrapped by the owner** (live patches, no code kept): a typed lattice
  ground, the hero in the wyrm's letters, a terminal finish.
- **The wyrm in large letters** (ADR-092): `wyrmGlyphs.js` rewritten (bold font, cells 1/55 of the
  height, three symbol sets); the pass averages 16 more taps per wyrm cell and anchors the grid to
  the boss (`U.uBossScreen`, `uWyrmAnchor`, `uWyrmTaps`); tone set to the picked preview's.
- **Landmarks, a first pass** (`src/world/landmarks.js`, hooked into the three sets; NOT in this PR:
  uncommitted in the worktree until the owner picks which stay): the elder wyrm's skeleton and the Cinder Tree (Cinderwood), two stone
  swordsmen, the sect gate and an incense cauldron (Ashfall), two throne wardens and six great swords
  (the Obsidian Throne). Trees and boulders in their footprints are built, then dropped, so every
  other tree and stone stays where it was.

**Found on the way:** a big smooth form lit evenly lands on one level of the grid's glyph ramp and
prints as rows of `====` (thin forms like bones read at once): landmarks get per-facet tones and a
dark albedo. The camera's 58 degrees squash anything upright and hide the north rim: statues are
drawn 1.3x taller than built and stand east and west. The hall's night needs a prop albedo twice the
other levels'. The gate's roof profile hit `pow(negative, 1.7)` at the eaves (NaN positions; clamped).
A connected gamepad walked the hero between captures.

**Verification:** in the dev server at 1280x720: the wyrm at the fight camera and pulled back to 50 m
(beside the picked preview), phase 3, the breath, a red tell (the glow still tints the letters), and
at 852x393 (6x10 px letters). The anchor, measured in the wyrm's own frame over 0.1 / 0.2 / 0.4 m of
camera travel: 13 / 15 / 21 % of its lit pixels change, 63 / 62 / 60 % with a screen-fixed grid.
`npm test` and `npm run build` pass (run with the landmark files also in the tree; CI runs the PR's own tree).

**Not checked / open:** 1080p and above (the pane timed out; the cell would be 12x20). The frame rate,
on any device. The wyrm in flight and in motion at 60 fps (stills only). The human bosses' letters
(no pick). Of the landmarks only the skeleton is at a finished standard; the tree's crown does not
read, the gate sits mostly off the top of the frame, the wardens read as red-lit monoliths; none was
played around (new colliders on the arena rims), none is in ARCHITECTURE or STYLE yet.

**Next:** the owner's picks: the duelists' letter size (and whether the hero follows), which
landmarks to keep; then a second pass on those.

---
## 2026-11-14 — Session 31: the streak and the flurry (perfect dodges answered blow for blow)

**Owner:** "lets have more different perfect dodge animations instead of the same one of just
teleporting on top and stabbing the head or behind the enemy. add different types of teleport
attacks. if the player keeps doing more succesful perfect dodges in a streak, make the attack also
hit the # of attacks the player is on a streak ... make it epic anime with good visuals, animation,
and impact". Branch `player/ghostep-flurry` from `main` (PR #29, the free hand, is open beside it and
holds Session 30 and ADR-086 – 090: this is 31 and ADR-091).

**Done:**
- **The streak** (`player.streak`): perfect dodges in a row; a blow that hurts ends it (not a block,
  a parry, a plain dodge or time). A STREAK row of pips under the HP bar, "GHOSTEP ×N" over the
  hero, the longest streak in the victory record.
- **The flurry** (`player/flurry.js`, state `flurry`, ADR-091): a perfect dodge is answered with as
  many blows as the streak counts, 7 at most. Flash cuts (blink, cross the target, blink away, each
  along a new line that then hangs on it) and then an art, on which the hanging cuts burst.
- **Six arts:** the wyrm's Skyfall (the plunge, unchanged), Severing Line, Heaven Splitter; a
  duelist's Passing Cut, Falling Leaf, Rising Moon. At random, never the same twice running.
- **Time:** the world held at 7 % while he cuts, the hero, his pose and his cloth on real time.
- **Look** (`player/flurryFx.js`): afterimages that pile up round the target, the hanging lines, a
  crescent on every cut, the art's crescent or lens, the burst. **Sound:** a ring a whole tone
  higher for every cut, the coil's rise, a run of rings as the cuts open. **HUD:** a cut counter
  over the target, a banner that names the flurry with its damage. The camera leans in.
- **Lab:** PLAYER → flurry x1 … x7 and an art picker (`player.debug.flurry`, `.flurryArt`,
  `.streak`).
- **Tests:** integ.mjs FLURRY (the streak, each of the wyrm's arts, the cap, a kill in the middle),
  duel.mjs GHOSTEP rewritten (each of a duelist's arts, a flurry of five); RED and PLUNGE pin the
  plunge's art and reset the streak.

**Found on the way** (all on film, in the browser): the sword's own sweep trail drew a wide curl on
every pass (the blade is carried a metre a frame): the flurry draws its cuts itself. Round the
wyrm's head the hanging lines were inside the head and showed only where they left it: they are
drawn 3.5 m toward the camera. A falling cut seen along its own plane was one fat white bar: its
crescent is tipped toward the camera. Every first size of a star, a flash or a light bloomed into
a white ball over the target: all cut down. A duelist's `takeHit` flashed him white for the whole
hold (the world stands still, so the flash does too): `takeHit` takes a cap for it (`flash`).

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server, as film strips at 60
fps cropped round the target: flurries of 2, 3 and 4 on Shen Hui with each of his three arts, from
the south and from the east; flurries of 2, 3 and 4 on the wyrm with each of its three; a flurry of
five at the game camera with the HUD on (the STREAK row in a screenshot; the cut counter and the
FIVEFOLD FLASH banner read from the page); one flurry in the phone preset (852 x 393, touch UI),
where the camera's lean was far too close: it is scaled to the phone's camera now.

**Not checked / open:** no human has played it, and it was not tried on a real phone (frame rate
with seven lines hanging; the STREAK row on the small player frame; the scaled lean was not filmed
again). The sounds were written and wired
but not heard. The hero's poses in a pass were judged at the game camera, where he is small; not in
close-up, and the vault's somersault only as a strip. The Starless Lord was not filmed (he shares
the duelist's path, and his tests pass). Balance: a duelist's fight is shorter for a good dodger;
nothing was re-tuned. A streak never runs out: to be judged in play.

**Next:** the owner plays it; then pace (`DEFENSE.flurry.cut`), the cap, and whether a streak should
run out.

---

## 2026-11-14 — Session 30: the free hand in sword fingers; weight and footwork; a cut that lands; outfits to pick from

**Owner:** "The character left hand pose and animation looks unnatural and weird during the attack
animations. Lets focus on making the characters motions attack animation and overall design and look
be better." Asked first: the free hand reads "stiff, like a mannequin" and "the hand itself" is wrong;
the style is **sword fingers** (jian jue); also improve weight and impact, footwork and body, the hero's
design (as options: "new look, show options") and the sword and its effects. Kept distinct from the
Ash Disciple: no douli, no red tassel, the moonlit cyan/violet longsword. Branch `player/free-hand`
from `main` (7855769), with `player/sword-fx` and `player/outfits` merged in; built as three tracks,
each with an independent review and a fix round.

**Measured first** (the old free hand, through the chain): rigid on the forearm (no wrist), a binary
open/fist swap at `twoHand` 0.6 that popped the fist 9-21 cm, the off elbow locked at 152-176° on the
grip, the elbow ping-ponging 47-75° to 116-126° between keys, and no counterbalance (the hand's travel
against the blade's: cos −0.29..+0.55).

**Done:**
- **The free hand** (ADR-086): a wrist joint (`arms.L.wrist`, `arms.L.point`), turned by a spring inside
  human limits (sub-stepped: stable from 144 to 15 fps); the sword-fingers hand (index and middle
  straight and pressed together, ring and little folded under the thumb, 1.3× long so the point
  survives the glyph pass); a choreography for every cut: it gathers at the sword wrist and is thrown
  opposite the cut, overhead only rarely; the fist on the grip only once the hand is there (no pops);
  the free elbow keeps ≥ 23° of bend on the grip. Every outfit's arms build it (`gear/hands.js`).
- **Weight and footwork** (ADR-087): a light's step pushes off and brakes at the plant; the hips lead
  the hand by 0.033 s, the chest by 0.017 s; anticipation and overshoot keys; deeper bow stances on
  the thrusts and the falling cuts; the edge **bites** on a landed hit (the blade holds where it bit
  through the freeze, the hips drop 4-6 cm, then it tears on through); planted feet pivot and follow
  instead of skating (worst slide 2 cm, was 7-30); the whirl hops round its turn and overshoots.
- **A cut that lands** (ADR-088): drawn where the drawn blade meets the drawn body (it sat 13-65 px
  off); a slash line along the cut with a tick across it, sparks thrown along the blade's travel, a
  flare on the steel and a glint up the edge, the camera kicked along the cut, a punch on every landed
  cut, a `cut` sound layer, the struck duelist shudders through the freeze; the white star that hid
  both fighters is gone. Per-attack weights are data (`combat.js` `contact`, `punch`, `kick`).
- **Options for the owner** (ADR-089): three outfits behind `?heroLook=` (Moonlit Robe, Swallow, Moon
  Warden; each also with its face in shadow, `-shade`) and three sword looks behind `?sword=` (sheet,
  ribbon, crescent); today's look and sword stay the default. Lab rows OUTFIT and sword. Sheets:
  outfits (four sides solid + the game camera), faces, duels, swords.
- After the merge, from the close-ups: the two straight fingers splayed into a V (a peace sign) and
  the curled two stood out as knobs; the pair is now two touching tapered capsules, the curled two lie
  on the palm, the palm is flatter.

**Found on the way:** `setLoadout` let a hero rebuild wipe the shared part ink (the Lord's red part
19); the wrist spring was unstable at ≤ 35 fps (period-2 flip of ~30° a frame at rest; sub-stepped);
the fist popped to sword fingers on the plunge's hang; the cleave's bite put the blade 2.5 cm into his
head (the cleave's bite folds no chest or head now); the first hop whirl scissored the feet (now each
foot is carried round from where it stands); a duelist's drawn cut floated off his body after his
shove (moved with the shove); a slam's shards-only hit played the blade's cut.

**Round 2, the owner on the preview (ADR-090):** "keep the new skins for now to be used in the
future. we will use the current todays look for now as the default. the right hand looks very
disfigured. when charging, the sword is piercing the characters face, make it have more distance
away from the face. somethign about the arms still feel unnatural and stiff".
- **The outfits and sword looks stay** behind `?heroLook=` / `?sword=` and the Lab rows as options
  for later; today's look and sword are the default. Nothing is removed.
- **The sword hand:** the fist was four thin discs and a plank (since ADR-041, on every rig): now
  finger rolls that close into one hand with shallow grooves and a rounded back of the hand.
- **The charge:** the blade stood 10 cm from the head's axis, inside the hood. The hands sit lower
  and out to his right and the blade leans out: 25 cm through the hold, 21 cm through the release.
- **The arms**, measured in the chest's frame: no swing opened an elbow past 124-130° (the soft
  reach crumpled every full-reach key); both elbows flared out on the run; the free arm ran as one
  87° crook; strafing, the arms did not swing at all. Now: 143-159° at contact (`HERO_SOFT`, hero
  only, never locked), elbows back beside the ribs, the free arm opens and folds 56° a stride, the
  arms swing in a strafe (`armF`), an open hand on the run, sword fingers 1.15×, the flung "wing"
  sloped down from the shoulder.
- **Tests:** a new HEROARMS scenario (rest, run, strafe, sprint, every swing's opening, the lock
  bound, the charged blade's clearance). HERO's "never locks" bound is 15° (was 23°).
- **An independent review of round 2** (three reviewers, headless probes against the parent
  commit) confirmed the gains (frozen-elbow stretches 55 → 17 over one script; the charge 6.8 →
  26.1 cm by their probe) and found: the arms still froze in an exactly sideways strafe, and
  HEROARMS' strafe check passed only because he slid round a stone of the harness; a fast
  direction flip threw the free hand 20 cm in one frame; the Ash Disciple's running arm had changed
  with the hero's (his sleeve into his ribs); the cleave's new wind-back key made a hitch. Fixed:
  the swing's sign is latched and eased (a pure strafe swings 27 cm; a flick moves the hand 7.4 cm
  a frame, the parent's 8.2), the hero's loco numbers are gated on `A.freeHand` (the Disciple is
  bit-identical again), the key moved to u 1.3, the scenario runs in a clear lane and asserts the
  strafe is one. Also from their ranked list of what still read stiff: the guard breathes and rides
  the walk; the way home from a swing starts earlier and lands softly; the sword arm rides the
  stride backing away. LOOKS' budget is 27k triangles (the new fist is 624, was 460).
- Left from the review: coming up from a held light's coil into the charge the blade still turns
  52° in one frame (87° before this session); the roll's exit opens the free elbow to 155-160°.
- Found on the way: the owner's gamepad drives any visible page, the filming page too (its
  `navigator.getGamepads` has to be stubbed while they play).

**Verification:** `npm test` (integ incl. HEROHAND, HEROWEIGHT, LOOKS, CUTFX; DUEL; LORD) green after
the merge; `npm run build` OK. Filmed in the pane: the chain (solid and the game camera), contact and
follow-through stills, the hand close-up, the outfit and sword sheets, the cut's contact on the Ash
Disciple, the whirl's hop against carry and the base.

**Open / next:**
- The owner's look at round 2 on the preview (the arms, the charge, the fist); the whirl's feet
  (`hop`, shipped, or `carry`) are still theirs to pick. The outfits and sword looks stay as options.
- On the phone: the lunge is ~35 % longer on a short click (the shaped step), the kick's feel, fps.
- The wrist sits on a limit for much of the falling backhand, the falling cut and the whirl (by
  design of the keys; tune in the Lab close-up if it reads stiff).
- Hems and cloak tips dip under the grass in the death's collapse, and today's arm drape 17 cm while a
  knockdown death settles (printed, not asserted; `_hemY` checks only the hem's centre).
- The Lord's black plate still takes the 'cloth' hit sound.

## 2026-11-14 — Session 29: the Starless Lord in black plate; how he moves; three more spells

**Owner:** "improve the new bosses animation, movesets, spell effects, force effects, character detail
and motion. make him look like a darth vader look alike". Branch `enemies/starless-lord-armour` from
`main` (PR #24 merged the day before; rebased over PR #23 and PR #25, the hero's new swings and his
faster chain, then main's clash rework, PR #26, and its hit reactions, PR #28, merged in).

**Done:**
- **His look** (ADR-084): a harness of his own in gear.js (a hood over a faceplate, cuirass and
  gorget, plate yoke and pauldrons, plate arms and thighs, hip plates over a war-skirt, a cape to the
  ankles), drawn at 1.32. Three heads rendered in game as one sheet for the owner (A sallet, B crown,
  C hood); built with A. An original design in that archetype: a film character's own look was not
  copied, and the owner was told so.
- **The owner's pick: "the hood".** The two helms and the `?lordLook=` switch are gone (`lord.hood`
  is his one head item, `LORD_LOADOUT` a constant). Up close the hood as first rendered read from
  the side as a flat-topped box, and the standing collar behind the head poked through its sides.
  It is now given as a front and a back edge per ring: a round crown, the brow hanging forward over
  the faceplate and closing just above it, a rim in the cloth's ember red round the opening, the
  drape pooled on the yoke. The collar is removed.
- **How he moves** (ADR-085): four new guards (the blade hung at his side, twin blades as wings, the
  staff level across him, the cross-hilt upright before his face); he glides instead of running; cuts
  alternate feet; spins hop and carry the feet round; a cartwheel cut and a backflip; a flourish per
  form; the cape lifts through a cast.
- **Moves:** 37 (was 31): Starless Dirge, Crushing Dark, Pinwheel, The Rift, Parting Light, Dark Star;
  more alternatives in Crimson Litany, Bladed Gale and Judgment.
- **Effects** (fx.js): lightning (core, sheath, strands, forks, a burst and arcs along the floor), the
  push's burst, the pull's vortex, the grip's talons and crush, the Rift, the Dark Star, called
  lightning's wheel in the sky, stones that turn round him, the glide's wake, form 4's wheel of marks,
  the blink's afterimage, the ignition's pillar.
- **Tests:** lord.mjs LEVEL (the harness, one head item: the hood, seated) and SPELLS (the grip, the Rift,
  the Dark Star, Parting Light, the glide); duel.mjs (Shen Hui waits in his meditation clip).

**Found on the way:** both duelists stood in their guard while they waited (on the throne's seat, in
the courtyard): the animator's reset ran after the brain's and went back to the walking clip. Fixed
in duelist.js: he sits, Shen Hui kneels. Parting Light's crescents fizzled from close in (thrown too
near to cue): they fly from 4 m off at 12 m/s. The Dark Star's red ring was lost on the hall's red
inlay: it draws its reach in violet too.

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server: the look sheet (three
helms, four angles and a close-up each), the four guards from two sides, film strips of the dirge,
the backflip, the pinwheel, the gale, the grip, the Rift, the Dark Star, lightning, the push, the
glide, the intro from the door, him seated, Shen Hui kneeling; 88 s of the AI across the four forms
against an idle hero: no console errors, 1879 particles at most. After the pick: the hood from six
sides close up (ASCII and solid), a turnaround, him seated, the backflip and the grip with it on.
Bots (seed 4242, on main's faster chain, guard and hit reactions): every tell answered 93 s; 85 %
19 hits / 315 damage; 70 % 36 hits / 692.

**Fitted to the clash rework (PR #26, merged into main while this was open):** the code merged
without a conflict. His new effects that are re-drawn every frame (the aura's wheel, the pull's
line, the grip's talons and crush, the marks, the Dark Star) take their one-frame life from the
effects clock (`game.fxDt`) as the engine's now do: on the game's dt a frame longer than the 0.02 s
floor (a hit-stop or slow motion under ~50 fps) outlived them, and they would blink.
Checked in the browser on the merged tree: the hero cutting at his raised guard in each of the four
forms (the ward stands across the new guards, the sparks sit on his blade), a parried Crimson Litany
(the contact frames), 10 s of the AI per form with the hero mashing: no console errors.

**Not checked / open:** no human has fought him; not tried on a phone. The hood was checked in the
model view and in strips, not in a whole fight at the game camera. His new moves were not looked at
one by one under the clash rework (the blade lock, the trade clash and the deflect against the
cartwheel, the hop spins and the staff). The glide, the cartwheel and the
flourishes were reviewed as strips, not in motion at
60 fps. The hop spin's legs are hidden by the war-skirt and the cape: not checked bare. The numbers
were not re-tuned for the six new moves. No sounds of their own. His drawn body is now 32 % larger
than his hurt spheres.

**Next:** a first human fight; then tuning.

---
## 2026-11-14 — Session 28: hit reactions and the death fall, audited

**Owner** (after Session 26's anatomy round, asked whether to audit these too): "Yes, audit them".
Branch `player/natural-reactions`, from `main` after PR #25 and PR #26 (ADR-083).
- A scratch audit: the flinch, the block, the parry, the guard break, the knockdown and the death,
  each entered from 20–30 states, measuring joints, body parts under the ground, the blade in the
  body, and the fastest frames in the WORLD (measured in his own frame, a 180° snap of his facing
  is invisible).
- Found and fixed: killed while lying he stood up to die again (now the `deadDown` clip); the
  death's collapse sank the knees 15 cm (a knee / elbow floor in the solver); a knockdown from
  behind spun him round in one frame (now he falls onto his front, his facing eased); every flinch
  went backwards (it follows the blow); struck mid-swing the blade jumped up to 1.8 m in a frame
  (longer fades, the whirl's turn carried on); he fell and lay like a board (knees buckle, a knee
  up, arms flung); a cloth sheet stood 0.45 m up off the corpse (elbows laid flat; cloth obeys
  gravity while he lies).
- In range and left alone: the guard break, the block and the parry; every joint angle.
- Process: the two commits were first made on `player/faster-flow`, which had been MERGED and
  deleted an hour before (PR #25): the push re-created the branch and `gh pr edit` rewrote the
  merged PR's title. Both undone; the work was moved here. Check `gh pr view` before pushing to a
  branch a PR was opened from.
- The Browser pane lost WebGL on `localhost` and `127.0.0.1` ("Web page caused context loss and
  was blocked"); the same server under another host name (`film.localhost:5191`) rendered again.
- Verified: `npm test` ALL PASSED (995 checks, DUEL and LORD too), build ok; the reactions filmed from the side and at the game camera.
- Not covered: the plunge's poses. Nobody has played it; nothing ran on a phone.

**Next:** the owner's look at the preview.

## 2026-11-14 — Session 27: steel on steel (the clash, his guard, cancels, the blade lock)

**Owner:** "improve the combat mechanics of enemy guarding, being able to animation cancel from a
swing to a guard or dodge instantly. right now i cant tell animation or feel wise that the enemy is
guarding. Make the parries and deflect more epic. the clash is buggy and doesnt feel like a sword
clash. what other combat improvements can you think of? i still feel like the combat is a bit slow
and dont feel the sekiro phantom blade zero epic moments."
Branch `combat/epic-clash`, stacked on `player/faster-flow` (PR #25, still open: its faster chain is
half of "the combat is a bit slow", and the preview should carry both).

**Diagnosis first (filmed frame by frame, side on, the Ash Disciple):**
- A parry's freeze-frame showed two white blots and no blades (two bursts with 0.6 m HDR cores, a
  body-width apart); the hero's deflect snap ran in game time, so the freeze (time × 0.02) held the
  guard he started from; at the impact frame the boss's blade was already 0.25 – 0.55 m past the
  hero (a cut moves ~0.4 m a frame), a thrust ran down his centre line.
- A strike into the boss's guard: a white blot over both; his block pose arrived 0.06 s into a clip
  that a 0.07 s freeze held at its start; his raised guard was his ordinary stance; the hero's swing
  passed through with no reaction; the counter came unannounced.
- The blade lock: the two 1.5 m apart, nothing crossed, a bloom per press.
- The hero could not leave a swing: no guard in the cut, no dodge before 35 % of the recovery.
- Seven hit-stops of 0.1 s in a seven-cut string: 0.7 s of standstill. At the default camera the two
  are ~60 px tall.

**Done:**
- **The clash (ADR-079):** `combat/clashFx.js` (one effect of lines for every blade on blade);
  `game.fxDt` (particles and lights run on through a hit-stop); `duelist.parryContact` holds a
  parried blow where it met the guard and lets a deflected one rebound; the hero's deflect goes to
  the blow's side and height, is posed in the parry's own frame and nudged onto the steel; a short
  freeze inside a string, a long one on its last blow; `cameraRig.punch`; the tell glint without its
  disc; a riposte 0.07 s into a parry.
- **His guard and the cancels (ADR-080):** `duelist/guard.js` (raised, three wards, the deflect);
  `brain.wardK`, `onGuarded` → armor / ward / deflect, the counter out of the deflect's beat; the
  hero's bounce (`player.onGuarded`, state `bounce`, `player:bounced`); the recovery's late half
  cancels into a guard or a step out of a heavy blow; the hero's guard / dodge out of any point of a
  swing; sounds `guard` and `deflected`, the DEFLECTED call-out.
- **The lock and the camera (ADR-081):** the lock pose, the servo onto the crossing, the grind, the
  slide; duel framing (−6 m in his reach).
- **Tests:** `duel.mjs` CLASH (20 checks); IMPACT's parry numbers; GUARD's counter check.

**Found on the way:** the first contact search stopped at the impact frame because the blade was
already "clear" of the hero, on the far side: it now finds the crossing first and takes the last
clear pose before it. The duel framing was cancelled by the flow's boss camera (`max(zoomOut,
o.zoom)`): it is applied after it. The first lock tile I grabbed showed the hero at ease with a
glowing blade: the lock had been won a moment before (the crit window), not a bug.

**Verification:** `npm test` and `npm run build` (see the PR). In the dev server: film strips of a
parry, a seven-cut string, a guarded chain, the deflect → bounce → guard → Riposte, the lock, at
60 fps side on; one sheet of six moments at the game camera; the Starless Lord's four forms (a ward
and a parry each: the blades 0 – 3 cm apart). No console errors.

**Not checked / open:**
- No human has played it and nothing ran on a phone (frame rate with the closer camera, the punch on
  a small screen, the cancels on touch).
- No sound was heard: the two new sounds are written to the house recipe and unverified by ear.
- The closer duel camera, the deflect's odds and the 45 % step out of heavy blows are taste calls
  made without options put to the owner.
- A thrust set aside still shows the blades ~0.4 m apart. The hero's cut still passes through a
  ward that only holds it. The wyrm's claws get the new sparks and freeze, not a contact pose.
- Proposed, not built: a counter cut after a deflect (ROADMAP M1.26).

**Round 2, the owner's pick: "Trade clash" (ADR-082).** The hero's cut and a duelist's blow at the
same moment now meet instead of both landing: `RESULT.CLASHED` from `player.takeHit` (his blow
arrives in the cut) and `duelist._tradeNow` (the cut connects ≤ 0.1 s before his blow would land,
which spends the beat and skips his timeline to its impact). Neither is hurt; the hero bounces; a
string goes on; a single strike ends in the short `clash` reaction (no punish window); a cleave that
would crush his guard wins it. `combat:clash`, the sound `trade`, the CLASH call-out.
- **Found by the test:** mashing attack traded the second blow of a string too. I had counted on
  the bounce's 0.28 s, with blows "0.34 s apart": that is their windup; impact to impact is 0.42 s.
  A re-arm of 0.6 s (`DEFENSE.trade.rearm`) now keeps two in a row from being traded.
- **Found on film:** left in their swing poses the two blades were 0.7 m apart in the freeze (his
  rising cut low, the hero's falling cut high), and the bigger burst stacked into a white blot for
  three frames. The hero's cut is now stopped on his blade with the parry's own contact code
  (`_meetBlade`, extracted from `_parry`): 0.01 – 0.22 m for cuts, 0.4 – 0.6 m for a thrust or a
  spin. A big burst spreads its streaks wider instead of brighter. The duelist's tell glint lost
  the rest of its disc (rays at 0.62×, the eight short strokes born off the centre).
- Rebased three more times onto `player/faster-flow` (it took ADR-078: this branch's are 079 – 082).
- Tests: `duel.mjs` TRADE (16 checks). Verification: see the PR. Not checked: as above, and whether
  a player finds the trade without being told.

---

## 2026-11-14 — Session 26: a faster chain, the finisher as a clip, a recovery that flows

**Owner (on the merged build of Session 25):** "speed up the attack speed on the character. its too
slow right now. think of ways to make the character, animation, and motion better".

**The pace (ADR-075).** 0.25 s a hit was "too fast to follow" (Session 25), 0.42 s is "too slow". A
light is now a 0.11 s gather, a 0.12 s cut and a held finish; mashed, a hit every ~0.32 s (measured
0.32, 0.32, 0.37). The cut is as quick as the old one: the pose at each end and the arc behind the
blade carry the readability. The lights' damage is 30 / 32 / 36 / 30 again (the ×1.4 of the slow
chain is gone), the slam 66. The sprint slash and the roll cut speed up with them. For the next
round of "faster / slower" there is a number to give: the Lab's **atk** slider
(`player.debug.attackSpeed`, ×0.6 – ×1.6; it works on the phone through the LAB button).

**Ways to make the motion better: measured first.** A scratch scenario ran the hero through every
state with nine points tracked in his own frame and listed the most abrupt frames (the second
difference of each point's position). What it found, and what was done (ADR-076):
- **The slam** was the worst motion in the set: hands 0.54 m in one frame of the blow, the point
  reversing in a single frame at the top, the last swing still on its own code. It is a swings.js
  clip now: a gather at the right hip, a leap (the knees drawn up) as the blade sweeps up his right
  side and cocks over the shoulder, one two-handed diagonal into the ground ahead, a landing folded
  over the planted blade that he holds. Hands at most 0.33 m a frame. A mashed button used to cut
  the landing off the frame the blade met the ground (the slam had no `chain`); it has one now.
  `slamPose` / `slamWindup` / `slamSwing` / `slamTilt` and their splines are deleted (~190 lines):
  every swing of the hero is clip data.
- **Every recovery** went cut → two frames standing still → home in 0.12 s at 60 cm a frame at the
  point (as fast as the cut). The way home now starts 30 % into the recovery, while the
  follow-through is still moving: the blade turns round without stopping and comes home at 43 cm a
  frame.
- **The whirl**, filmed close up, turned bolt upright like a figure on a turntable: it drops 7 cm
  into the turn and leans to the inside of it, and the head spots (stays on the target, then comes
  round ahead of the body).
- Left alone on purpose: the roll out of a swing and the guard's raise (the point moves 0.4–0.8 m
  in a frame, but both must be instant). Run, sprint, stops, turns, heal and idle measured smooth.

**Verification:** `npm test` ALL PASSED (945 checks; the DUEL and LORD suites too), glyph check
clean, `npm run build` ok. New checks (HEROLIFE 1f): one cut's follow-through runs into the way
home (no two still frames; the point home at under 0.62 of the cut's speed), the finisher's hands
under 36 cm a frame and its landing left ≥ 0.1 s by a mashed button, `debug.attackSpeed` 1.5 makes
a swing take 1/1.5 as long over the same ground. Changed: the mashed pace 0.26–0.40 s (was
0.36–0.52), the arm-step limit 60° a frame (was 45°: a 0.12 s cut throws the upper arm ~55° in its
fastest frame; the flips it guards against were 50–135°), `CHAIN_EVERY` 0.36 s. REACH: all five
hits, the cleave and 24 variant trials connect from contact to 3.5 m. In the dev server: the chain
at the game camera (every second frame), the slam from behind, the front, the side and the game
camera, the whirl from the front; the Lab slider set to ×1.25 (label, `debug.attackSpeed` and the
badge follow) and back.

**Not checked / open:**
- No human has played it; nothing ran on a phone. Whether ~0.32 s is the right pace is the owner's
  to say (the slider is there for that).
- Ideas not built, for the owner to pick from: an afterimage on the sprint slash and the cleave's
  dash; a strafing guard-up stance while locked on; a second finisher (a spinning smash); a flick
  of the blade as a chain ends. The whirl's feet still turn on the ground with the spin.

**Round 2, the owner on the preview:** "the 4th poke on the sword combo is like clipping through
the ground. make the sword trail effect look way cooler and more subtle" (ADR-077).
- **The poke:** its steel never came within 0.8 m of the ground; filmed at the game camera with the
  hero FACING it, the level blade is drawn straight down the screen to the grass at his feet, and
  the swing's glint flashed on the ground a metre past the point (it sat at the end of the 1.9 m
  reach). Both thrusts now rise (35° and 45°); the glint sits on the arc's edge.
- **The trail:** drawn off the steel now (its edge just past the point, not at the end of the
  reach), as one fine unbroken line of overlapping `|` strokes that cools to indigo and tapers to a
  hair. Three looks behind `player.debug.arcStyle` and the Lab's **arc** buttons: Line, Crescent
  (the default), Ghost. Rendered as a sheet for the owner (game camera and close up) to pick from.
- Found on the way: port 5187 was another session's server (the `epic-clash` worktree): the first
  page I loaded was not this branch. Served this one on 5191.
- Verified: `npm test` ALL PASSED (947 checks, DUEL and LORD too), build ok. REACH passes at every distance with the rising thrusts. The Lab's arc buttons
  switch the look and light up.

- **The owner's pick: "Crescent".** The other two looks, the Lab's arc buttons and
  `debug.arcStyle` are deleted; `ARC_LOOK` holds the crescent's numbers.

**Round 3, the owner with a screenshot of the charge:** "while charging the right hand makes an
unnatural angle. review all the characters animation and make sure the anatomy and motion is all
natural and legit" (ADR-078).
- A second scratch audit, joint ANGLES this time, through every state, in the hero's own frame (the
  first pass measured the drawn hero, sheared toward the camera: its angles were off by up to 15°).
- The charge: sword elbow 18°, the forearm in line with the blade, the off hand inside the chest.
  Now a guard held out from the body: wrist 103°, elbows 58° / 49°.
- Limits in the solver for every pose and blend: elbows ≥ 40°, knees ≥ 32° (the roll's tuck asked
  for 10°), the blade ≤ 128° back on the sword forearm (170° for three frames entering the charge),
  hands outside the ribs. The slam's and the cleave's cocked grips come forward of the shoulder
  line; the whirl's head turn is capped (76° → 54°).
- Verified: `npm test` ALL PASSED (950 checks, DUEL and LORD too), build ok; REACH at every distance; the charge filmed from the front, the side and bare.
- Not covered: the off hand's wrist in two-handed cuts, the free arm's elbow behind the back in two
  backhands' recoveries, hit reactions and the death fall.

**Next:** the owner's word on the pace.

## 2026-11-13 — Session 25: wuxia-flow swings, the dashing cleave, the cross ward, a narrow cape, a shorter sword, a new sword arc

**Owner:** "we need to improve the characters animations. something about the way he swings the
sword looks unnatural and not good. focus on making his animations look natural, fluid, awesome,
dynamic, and varied different patterns instead of being the same pattern over and over. when he
charges the sword the arm bend is all messed up and make his charged attack be an impactful slash
with a cool weightful hit instead of a poke. make his guard stance have a deeper angle. i want his
cloak to be thinner in the back." Answers: the charged attack a **dashing cleave**; the chain
**wuxia flow** (one-handed cuts linked by steps, pivots and spins, each hit in a different plane,
two hands only on the heavy hits); the guard "blade and stance"; the cloak "narrower from behind".
Branch `player/wuxia-flow-swings` from `main`, rebased onto #21 / #22.

**Diagnosis (the old chain filmed frame by frame, solid look):** in every light swing both fists
stayed at the sternum while only the blade turned (the two-handed `slashH` circle), the body stood
upright, and each hit was the same flat arc one way or the other. The charge held both hands at the
right hip: the sword elbow out level, the free arm folded across the belly.

**Done:**
- **Swing clips (ADR-071):** `player/swings.js` (data) + `swingPose` in `anim.js`. 13 one-handed
  clips: falling cut / draw cut / leaping cut; rising / flat / falling backhand; whirl / rising whirl
  / low sweep; lunge / rising thrust; sprint slash; roll cut. A clip starts from the pose he was in;
  the picker never repeats a line. `slashH`, `stabPose`, the windup loop and `FLOW` are removed.
- **The cleave (ADR-072):** a new charge stance (both hands by the right shoulder, the blade up and
  back) and `CLEAVE`: the thrust's dash, then one two-handed diagonal as it arrives, a held low
  finish; `fx.cleaveImpact`, a longer freeze, a lingering crescent. The thrust stays as the
  execution's. Event kind `cleave`; audio, feed, control hints and README follow.
- **Guard and cloak (ADR-073):** the cross ward; `SHROUD_SHEETS` 7 → 5 (a narrow cape). Three guards
  and three cloaks were rendered and sent to the owner; no pick came back during the session, so the
  ones I recommended (guard A, cloak B) are in as defaults.
- **Tests:** HEROLIFE (one hand through every look of the chain, the arm opening, two hands on the
  slam and the cleave, the line rule over 40 chains, the cross ward's angle and stance); HEROLOOK
  swings every look; REACH / BLOCK / TOUCH / PAD say `cleave`; HERO counts 5 sheets.

**Found on the way:**
- A windup sent the blade the long way round behind him (through the torso for a frame) when a
  backhand started out of the last cut's recovery: `dirLerp`'s rules are for the carry at the hip.
  A clip's blade now turns round his front to its coil.
- The low sweep missed at 3.5 m: a low blade's reach band tops out lower, so it reaches less far
  under the wyrm's chest. It crosses his front at ~65 % of the active frames now, when the step in
  is nearly done.
- Fewer cloak sheets = fewer `Math.random` draws in a coat kick = a different seeded meteor layout
  in FIRE's Armageddon run: two meteors came down on the standing hero 0.19 s apart and the second
  hit registered 69 ms into its blast. The test assumed the first frame; it now allows that for a
  blow chained within 0.3 s of another (the blast is active 0.12 s). Not a change to the wyrm.

**Round 2, the owner on the first preview:** "when the character is charging, it looks like the
sword is piercing through him. make the sword a little bit shorter as the longness doesnt seem
right. have the character raise its hand up more during the block angle. the new cape seems fine.
something still seems off during the attack animations". Asked what is off (too fast to follow /
the body looks stiff / the arms look wrong / the hits don't flow), the owner ticked all four.
- **Charge:** the blade leaned 34–44° back over the shoulder; from the camera behind him a blade
  leaning toward the camera is drawn DOWN across his back. It now stands nearly upright beside his
  head (hands beside the right ear), clear of his body from all four sides.
- **Sword:** `DIM.drawnTip` 1.06 → 0.93 (12 % shorter), the blade rebuilt in Blender
  (`npm run hero-parts`: only the three blade parts changed). The hit segment is untouched.
- **Guard:** the hands before the chest (13 cm under the shoulder; they were at the hip).
- **Too fast:** lights 0.16 / 0.18 / 0.26 s, the next light after 30 % of the recovery (`chain`):
  a hit every ~0.42 s mashed (was 0.25 s). Lights' damage and posture ×1.4; crit window 2.2 s.
- **Stiff body:** `lungeFeet` steps the foot that is behind, so the lead foot alternates down a
  chain and the holding heel peels; the keys shift the weight back, then into the front foot.
- **Arms:** a motion audit (a scratch scenario: per-frame turn of each arm segment in the body's
  frame, wrist angle, hand speeds) found elbows flipping 50–135° in ONE frame (the lunge's free
  forearm 135°, the leaping cut's sword arm 113°) and the free hand thrown ~0.7 m front to back
  every hit at up to 15 m/s. `_elbow` limits an elbow's swing round its shoulder → hand line
  (14 rad/s, every clip); the free hand's keys stay before the chest and beside the hip.
- **Flow:** one coil key instead of two (a dead stop before every cut), the blade still moving
  into it; `swingPhase` (the straight time → phase map halved the rate in one frame as a cut
  ended); the cut carries through before the next windup starts from it.

**Found on the way (round 2):**
- With every look forced, a hit 1 started out of the last chain's finish ran the sword hand
  straight through the chest (left hip → right ear) and the blade with it (17.5 cm deep for a
  frame). The hand's way to a coil now bulges forward round the chest, and the blade turns to its
  coil round the side away from his spine (not "always round his front": out of a roll, with the
  hand behind the hip, that ran it through his hips).
- The slower chain no longer reached the wyrm inside the 1.6 s crit window after a plunge (the
  PLUNGE test): 2.2 s holds about the five swings it used to.
- The idle-life test asks for three different idle actions; the picks are random and the animator's
  noise is shared with the variant picks, so more picks earlier moved it to two in 25 s. It watches
  45 s now.

**Round 3, the owner on the second preview:** "this is looking better but i want the angles not to
be so perfectly like top to bottom and more diagonals and more natural fluid. also make the sword
arc glow effect be more subtle and way more epic cooler looking". Rebased onto `main` first (#24,
the Starless Lord, took ADR-068 – 070 and Session 24: this branch is ADR-071 – 074 and Session 25).
- **Found (the chain and the cleave filmed at the game camera, from behind him):** the "falling"
  cuts, the leaping cut, the cleave and the slam ran in upright planes, the blade passing over the
  top of his head at 66–78° of elevation; from a camera looking down behind him an upright plane is
  one straight bar up the screen. The cleave's arc was a wall of light as tall as the sword through
  the whole dash, because the arc was drawn wherever the blade MOVED, turning or not.
- **Diagonals (ADR-071):** every cut's keys keep the blade under ~45° of elevation and cross his
  front near chest height. The leaping cut is replaced by a rising slash (the falling cut's other
  diagonal, with the skip); the slam takes `tilt` 0.42 rad (`slamTilt`): it comes down from over the
  right shoulder to the ground ahead and a little left.
- **The whip (ADR-071):** in every cut the hand runs ahead through the first half and the blade
  hangs back (still ~30° short of pointing ahead at mid-cut), then comes through.
- **The sword arc (ADR-074):** `PlayerFx.trail` rewritten: an edge line (stretched `•` strokes along
  the point's path, thinning as it fades), a veil of 4–5 rows of faint `|` streaks, a mote or two,
  and `arcGlint` once a swing. All of it scaled by how far the blade turned in the frame, so it
  tapers with the cut and the dash leaves nothing. The letter rim (`A` / `8`) and the `+` halftone
  are gone.

**Verification:** `npm test` ALL PASSED (941 checks; the DUEL and LORD suites too), glyph check clean, `npm run build` ok. In the dev server (a scratch film
helper saving frame strips): every clip every frame from the front three-quarter (solid look), the
chain's flow with each look and with the animator's own picks, the charge and the guard from four
sides close up and four at the game camera, the cleave front and back, the cloak from behind; at
the phone preset (852 x 393, LOW, touch) the chain, the cleave and the guard at the real game
camera (round 1's build). Round 3: the chain and the cleave at the game camera before and after
(the planes, the arc), the chain close up, the tilted slam from the front and at the game camera.

**Measured (round 2's build):** an arm segment turns at most 42° in a frame through any light swing
(the lunge; 20–34° for the others; before the limiter up to 135°); the lead foot changed on 12 of 12
consecutive hits; a mashed chain's hits start 0.43, 0.43, 0.47 s apart; the sword hand reaches
0.45–0.56 m from its shoulder in every look; 0 of 120 consecutive pairs on the same line, all 13
looks seen; the drawn blade ≤ 1.3 cm into his body over 1563 frames of every look (the limit is 2;
the charge's first frames against the sword arm); the guard's blade 38° up and 72 % across him, hips
0.17 m down, turned 28°, the grip 13 cm under the shoulder; REACH: the five hits, the cleave and all
24 variant trials connect from contact to 3.5 m. Round 1's build at the phone preset: 57 draw calls
a frame. The duel's fencing bot wins in 46 s (41 s with round 1's faster chain).

**Not checked / open:**
- No human has played round 3; nothing ran on a phone (the arc's line is ~2 px wide at the desktop
  camera's distance: whether it reads on the phone is the owner's to say). I judged poses from stills and motion from
  numbers, not from watching it move.
- The pace changed the balance on purpose: a mashed chain deals ~15 % less per second than before
  (each light ×1.4, ~1.7× later). The wyrm `win` bot and the duel's bots still win; fight lengths
  were not compared one to one.
- The finisher is still the old slam code (its elbows turn up to 54° in a frame). The whirl's feet
  turn on the ground with the spin. The lunge's elbow still turns 42° in a frame.
- The cloak's arm drapes flick up for a few frames when the arm whips home out of a swing.
- The cleave's blade is behind him for the first 55 % of its active frames: something that only
  crosses his path early in the dash is not cut (the thrust's point was out the whole way).
- `docs/art/hero.md` still describes the two-handed swings and the thrust.

**Next:** the owner's third look at the preview; then the finisher and the whirl's footwork.
## 2026-11-13 — Session 24: the Starless Lord, a third level

**Owner:** "lets do a new level but this time its a master sith jedi with a red lightsaber and evil
force powers ... multiple phases where he goes from 1 lightsaber, dual wield, combined long lighsaber,
and the last phase is back to 1 lightsaber but with cross handle and a powered up aura ... very
acrobatic, fluid, uses different force spells such as lighting, push ... combos to be like 6 in a row
with different variations ... ask me any questions". Asked four: identity (picked: a dark lord from
the stars), arena ("show me a preview of the stages to select from"), health (four bars, a deathblow
each), speed (faster than Shen Hui, ramping up). Branch `level/starless-lord` from `main`.

**Done:**
- **Arena previews:** three sets built and rendered in game (throne hall, storm peak, crater); the
  owner picked the hall. `world/throneHall.js`; sets may now bring `sky` and `ambience` (ADR-070).
- **A shared duelist engine** (ADR-068): `enemies/duelist/` (duelist, brain, realise, poses, fx); the
  Ash Disciple is a kit on it. His tests pass unchanged.
- **The Starless Lord** (ADR-069; `?level=starless`): four forms with their own stances, blades,
  movesets and pace; four bars and deathblows; the Void (lightning, push, pull, the returning blade,
  torn stone, called lightning, red crescents, the blink); the throne intro; `lives` pips on the boss
  bar, DEATHBLOW call-out, a fourth phase in flow / feed / audio, a Phase 4 Lab button.
- **Tests:** `tests/integration/lord.mjs` (LEVEL, DATA, TIMING, FORMS, SPELLS, BOUNDS, FLOW, WIN), in
  `npm test`.

**Found on the way:** the hero could stand by the door outside the boss's circle bound, out of sword
reach (the hall is a rectangle): the lord clamps to the floor's rectangle instead. A skipped intro
left the blades dark and him on the dais. The returning blade's second pass could only cue 0.1 s
ahead near its turning point: it now hangs 0.32 s there. The blades read gold, not red (the `flask`
part's shared amber ink): tinted red for this level's page load.

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server: the three arena sheets;
the lord's look; film strips of each form's guard and strings, the somersault, lightning, the thrown
blade, torn stone, the storm, the intro from the door; 40 s of the AI against an idle hero, no
console errors. Bots (seed 4242): every tell answered 75 s; 85 % 18 hits / 325 damage; 70 % 44 hits.

**Not checked / open:** no human has fought him; not tried on a phone (frame rate in the hall, the
0.26 s cue on touch). Poses were reviewed as strips at the game camera, not frame by frame up close:
the somersault, the off-hand blade's cuts and the staff's spins want a closer look. His look was not
put to the owner as options (it reuses the Wanderer's pieces under a new helm). No sounds of his own.
The grip was left out. The hero gets no reward yet (ADR-059; PR #18 is still open).

**Next:** the owner's look at the PR preview (`?level=starless`, `?lab` for the Phase buttons), on the
phone too; then tuning from a human fight.

---

## 2026-11-13 — Session 23: remappable controls (keyboard, mouse and pad)

**Owner:** "are we able to remap buttons as well?" → "do both pad and keyboard mapping". Same branch /
PR (#21).

**Done (ADR-067):**
- `core/bindings.js` (new): the actions, their keyboard / pad defaults, rebind with swap, reserved
  keys, labels, localStorage with repair. `Input` gets `act` / `actPressed` / `actReleased`;
  `moveAxis()` reads the move actions.
- The player, flow (pause, help, mute, rest, fight again, "press any key") and timing trainer read
  actions. Touch and pad press `'@<action>'` codes; the pad's mapping is now the bindings.
- `ui/remap.js` (new): the pause menu's CONTROLS panel, two tabs, mouse / keyboard / pad capture,
  reset per tab; the pad walks it (LB / RB tabs, A pick, B back).
- `ui/dom.js`: `[@action]` key chips and `controlsGrid(parent, dev)` from one list; they relabel on
  every remap / device switch / pad layout. The HUD prompt, hint, title line, help and pause grids use them.
- Tests: scenario REMAP (the rules, persistence, the panel by key, mouse and pad, the game obeying);
  mocks get `installActions`; touch / pad assertions read actions. The shim's `fireWin` honours
  `stopImmediatePropagation`.

**Found on the way:** a 300 ms wall-clock guard against the click that ends a mouse bind broke the
headless run (no wall time passes); replaced by eating exactly that click. The panel's key capture
must use `stopImmediatePropagation`, or the Lab's own capture listener also saw F1.

**Verification:** `npm test`, `npm run build` (see the PR). In the dev server with real clicks and
keys: CONTROLS opened, DODGE → Q, LOCK-ON → right click (block swapped onto Tab / MMB), saved across
a reload, Q rolls and Space does not; with a faked DualSense: Options → CONTROLS → the controller tab
→ DODGE → △ (rest swapped onto ✕), PlayStation labels throughout.

**Not checked / open:** no real controller, no phone (the CONTROLS item is hidden on touch unless a
pad is in use). One key per action after a remap; no side mouse buttons.

**Next:** the owner tries the remapping on the preview.

---

## 2026-11-13 — Session 22: controller support

**Owner:** "add controller support". Branch `input/gamepad` from `main`.

**Done (ADR-066):**
- `core/input.js`: a gamepad source beside the touch one (`setPad`, `setPadAxis`, `releasePad`,
  `pulse`, `kbmT`); `setVirtual` and the pad share one `_setSource`; the pad stick wins in `moveAxis()`.
- `ui/gamepad.js` (new): polls the standard mapping and feeds the real codes. LS move, RS aim, RB / RT
  attack, LB / LT guard + parry (trigger hysteresis 0.5 / 0.3), A dodge, B / L3 sprint, X flask,
  Y the prompt's key, R3 lock-on, Menu pause, View help, D-pad zoom. Menus: title any button / stage
  picker; pause menu focus (D-pad, A, B resumes). Buttons held across a menu ↔ play change are
  ignored until let go. Device in use by last input; a disconnect mid-fight pauses. Rumble.
- `ui/aim.js` (new): the touch layer's no-cursor aim, shared with the pad.
- UI: `pad-only` hints (title, pause and help grids, the corner hint, the arrival log line, the death
  line), the prompt drawn as "[Y] Rest", PlayStation relabel through `data-pad`, `.pad-focus`.
- Tests: scenario PAD (fake pad through `navigator.getGamepads` → the real Input); the shim's `El`
  gains `click()`.

**Found on the way:** an Xbox pad's id is "Xbox Wireless Controller", so a "wireless controller"
PlayStation match labelled it △: the PlayStation test is now Sony's vendor id (054c) or the names.

**Verification:** `npm test` (see the PR), `npm run build`. In the dev server with a faked standard
pad: title → explore on A, "[Y] Rest at bonfire", the VIEW / MENU hint, the pause menu's focus on
QUALITY and the pad grid, the PlayStation relabel; no console errors (the Vercel insights 404 is
local only).

**Not checked / open:** no real controller has been used (the pane has none): the dead zone, trigger
thresholds and rumble strengths want the owner's hands. Sound does not start from a pad press alone
(browser autoplay rules). No rebinding.

**Next:** the owner tries it with a controller on the preview; tune `CONFIG.gamepad`.

---

## 2026-11-12 — Session 21: the hero at Shen Hui's size, a trimmed cloak

**Owner:** "i dont like the new look and animations. lets start over. lets first focus on making the
size the same as the new boss and reduce the back cloak from covering too much" (about PR #19, which
changed the outfit, the face, the hood and the swings). Started over from `main` (now with #16) on
`player/hero-size-cloak`. Previews first: the hero at 100 / 90 / 80 % beside Shen Hui (side by side
and facing him at the fight camera); three cloaks from `main`'s (trimmed, back only, short). Picks:
90 %, "A trimmed", and the coat tails a little shorter.

**Done:**
- **Size (ADR-064):** `PLAYER_SCALE` 1.08 (0.9 × `HERO_SCALE`); `installLean(root, scale)`,
  `player.drawScale`, `anim.drawScale` (gait, foot planner), `unlean` / `leanPoint`. Shen Hui stays
  at 1.2. Visual only.
- **Cloak and tails (ADR-065):** `SHROUD_SHEETS` ~30 % narrower, 15 % shorter, standing off less;
  `COAT_PANELS` 15 % shorter and narrower at the join and the hem.
- **Tests:** HEROLIFE's off-hand gap divides by the player's own scale.

**Verification:** `npm test` ALL PASSED (777 checks; the DUEL suite too), glyph check clean, `npm run build`
ok. In the dev server: the hero beside Shen Hui side by side, at
the fight camera and from behind; a straight run and sprint: planted feet slide < 2 mm a frame.

**Not checked / open:** not played by a human, not tried on the phone. PR #19 (the first attempt)
is superseded. The face, the hair and the swings are untouched here: the owner's next asks.

**Next:** the owner's look at the preview; then the next item they pick (the face, the hood, the
swings), one at a time with previews.

---

## 2026-11-12 — Session 20: Shen Hui at PBZ speed — the blade-driven arm, pressure, impact

**Owner:** "his animation, motions, and weapon stance and attacks look bad. speed up his attacks as it
seems slow. the ai on the boss seems stupid. it shouldn't be attacking if its not near the player or
able to hit them. the boss should be able to sprint and catch up to the player to add pressure instead
of the player able to kite it out easily. i want this to be an epic fast paced game with epic sword
clashes, parry/dodge moments. make the parry effect also epic and impactful. we need to make the hit
from both player and enemy show more impactful hit stun to not feel weightless." Answers: PBZ-boss
speed; hits jolt him without interrupting (footwork and recovery excepted); the parry "everything,
layered"; sprint in and punish a flask. From three rendered stance sheets: **A, the classic jian
guard**. Same branch / PR (#16).

**Diagnosis (filmed side-on next to the hero's chain):** his hand and blade were keyed apart and
interpolated in angle space, so mid-swing the blade pointed up or behind him while the arm did
something else; the body barely moved; his trail was a grey wisp at the tip; the AI picked moves from
bands wider than their reach and swung at air.

**Done (ADR-063):**
- poses.js: stance A; the blade-driven arm (`arm` / `ext` / `lead`), the chest and hips turning with
  the blade; the hit jolt (pilot `recoil`) layered on every pose; walking keeps the side-on guard.
- moves.js: every move rewritten at PBZ speed; cuts as blade paths (`slashKeys`: gather, cock, snap,
  follow-through, a step in), spins and the low spin on the arm, thrusts with a follow-through.
- brain.js: the step-in (`close`) through every windup, leading the hero's velocity (step, track,
  dash); strings stop when the next hit can't reach; footwork: circle in range, run, sprint 8.6 m/s;
  a flask punished; a blow in his recovery flinches / staggers him.
- Impact: his hit stun (freeze, jolt, shove); the hero's (a freeze on every blow that lands); the
  parry layered (freeze 0.1–0.15 s, sparks born mid-burst, a shockwave ring born open, a camera kick,
  `grade.flashPulse`, a heavier clang; perfect: `game:cinematic` 'perfectParry' slow motion); heavier
  guard clashes; his sweep trail (fx.js `sweep`).
- Tests: PRESSURE (every non-red glint reaches a standing hero, a kiting hero is caught, strings stop,
  a flask is punished) and IMPACT (no windup cancelled, recovery interrupts, the hero's freeze, the
  parry's freeze / flash / perfect slow motion); DATA / TIMING at the new rules.

**Found while filming:** the parry bloomed into white blots that hid both fighters for the whole
freeze: every layer was born at the contact and held there by the hitstop. Elimination by single
frames (particles, lights, the screen flash toggled one by one) led to: sparks now born mid-burst, the
ring born open and cooler, the stacked cores trimmed.

**Measured (seeds 4242 / 7 / 99):** god-mode bot ~45 s; 85 % bots win 3 / 3 in 48–52 s; 70 % die
3 / 3 with him at 8–10 % (at his old × 1.35 damage the 85 % bot won 1 / 3: now × 1.15).

**Not checked / open:**
- No human has played it; nothing ran on a phone. PBZ speed is a big step: the owner should say if it
  is too fast to read.
- The kiting check lands 1–7 blows depending on the seed: a hero sprinting sideways beats a thrust's
  narrow line now and then.
- The hero's parry FX changed for the wyrm fight too (freeze, ring, flash, slow motion on a perfect
  parry): looked at in the duel only.
- Reaction clips (stagger, recoil, reeling, …) still use keyed hands.

**Next:** the owner plays the preview; the reward (PR #18) merges this.

---

## 2026-11-12 — Session 19: Shen Hui reworked — a long jian, a high guard, the duel's moments

**Owner:** "make shen hui's hat a bit smaller, its way too big right now. it looks like hes holding
some weird flute instead of a weapon. make his weapon look way more epic, longer, and more natural.
the way hes holding it right now looks really bad. make him have more dynamic and cooler attacks and
animation and combos as i want to have sekiro/phantom blade zero parries opportunities for epic combat
and moments." Answers: a long jian held one-handed; all four moments (long deflect strings, the
blade lock, perilous counters, cinematic finishers); the pace relentless, PBZ-fast. From three
rendered look sheets the owner picked **C: slender jian, high guard**. Same branch / PR (#16).

**Done:**
- **The look:** the hat 0.235 m in radius (was a wide douli); a 1.28 m slender jian with a tapered
  blade, bevelled edges and a ridge, a disc guard and pommel, a banded grip and a red tassel streamer
  (`gear.js` `LOOK`, `JIAN`); a slimmer bell sleeve; the **high guard** (`poses.js` `GUARD_HIGH`:
  the sword hand by the temple, the blade slanting down at the hero, the free hand's two fingers up).
- **New moves:** Falling Star (B, lock), Piercing Ash (R, perilous, a 5.5 m dash), Rain of Ashes (a
  7-hit string with an over-the-top lock cut), Hundred Petals (P2, 10 hits, ending on a perilous
  thrust); the cut library in `moves.js` (`CUTS`, `cut()`, `perilKeys()`). Reactions: reeling,
  trampled, lock.
- **The pace (PBZ-fast):** idle gaps 0.25–0.6 / 0.15–0.42 s, recoveries × 0.88 / 0.75, and 35 / 55 %
  of moves flow straight into the next (`TUNING.chain`).
- **The moments (ADR-062):** the full deflect (all hits of a ≥ 5-hit string parried: he reels), the
  blade lock (a perfect parry of a `lock` blow: mash to push, `player.startBladeLock`, a camera
  push-in, won = he reels, lost = a shove and the Riposte), the mikiri (roll into a `mikiri` thrust:
  he is trampled), and `flow.cinematic` (slow motion + `cameraRig.cine` pull-in, a gong) on each of
  them and on the execution. Call-outs BLADE LOCK / BREAKTHROUGH / MIKIRI / PERFECT DEFLECT; audio.
- **Tests:** a MOMENTS scenario (lock won / lost → the Riposte / held to time-out, the mikiri head-on
  and off his line, a roll across is no mikiri, the full deflect, the slow motion is not a freeze,
  the camera returns); the WIN fencer mashes in a lock.

**Found and fixed while filming (browser, real synthetic input):**
- The cinematic's slow motion went through `game.hitstop`, which min-merges the scale: the parry's
  0.04 freeze stretched over the whole 0.9 s moment (a freeze, not slow motion). It is now the flow's
  own time scale (`cineScale`).
- Parry flashes bloomed into two white blots a body-width apart: the hero's burst sat at his blade's
  pre-parry point (the idle blade at the hip, ~0.3 m up, its light blowing out the paving) and his at
  his own blade. The hero's clash now sits in front of his guard toward the blow; his is the point of
  his blade nearest the hero's chest, and smaller; the hero's parry light stays ≥ 1 m up.
- The blade lock was over in 0.25 s at a bot's mash rate and every push fired a full parry flare:
  retuned to a ~1.5 s tug (push 0.085, decay 0.32 / 0.38, 2.6 s, won at the bell if ≥ 0.6), pushes
  throw the block's grinding sparks.
- The mikiri read "toward him" from positions: a dashing thrust is often alongside at the impact,
  so the roll became a Ghostep. It now reads the roll against his facing (his blade's line).

**Verification:** `npm test` ALL PASSED (wyrm suite, DUEL ALL PASSED incl. MOMENTS, glyph check),
`npm run build` ok. Film strips (desktop 1200 × 800, synthetic mouse / keys through the real input):
Rain of Ashes parried ×7 → the full deflect; Falling Star → perfect parry → lock at 8 presses / s →
breakthrough; Piercing Ash → mikiri from off his line; Hundred Petals (P2) ×9 parried + the mikiri →
posture break. Phone landscape (812 × 375) boots into the duel.

**Measured (seeds 4242 / 7 / 99):** WIN 52–61 s (3–5 breaks). Probes: 85 % wins 3 / 3 in 55–64 s
with 2–4 flasks left; 70 % dies 3 / 3; 60 % dies 2 / 3. Before the rework 70 % won in 70–75 s: the
faster pace is harder, as asked, and the bots use neither the lock nor the mikiri.

**Not checked / open:**
- No human has played it; nothing ran on a phone (the owner's iPhone: fps unverified).
- The lock's mash rate is a guess at a person's (8 / s wins in ~1.5 s, 5 / s holds).
- Hits are still zones, not the blade; the new cuts were checked by TIMING (every hit lands within
  ±85 ms of its flash + lead), not against the drawn blade.
- The hero's parry FX point moved (all parries, the wyrm's too): looked at in the duel only.

**Next:** the owner tries the preview; the reward (PR #18, `player/techniques`) rebases on this.

---

## 2026-11-12 — Session 18: the Ash Disciple, a second level

**Owner:** "help me think of making content for this game. i want this to be kinda like phantom blade
zero wuxia combat, boss rush, with some exploring and rpg elements." After a pitch (a bonfire hub,
short approaches, a roster of duelist bosses each handing over a technique): "lets do the ash
disciple as a separate level and allow me to load it separately to test it"; setting: both the wuxia
combat and the fiction; progression: fixed rewards, loot that adds elements, skills and abilities to
change the combat style. Four answers: a grey-robed jian swordsman whose moves "should not mirror the
main character and have its own many different movesets"; guards and counters; the fight first, the
reward in the next PR; a ruined sect courtyard. Branch `level/ash-disciple` (a worktree off
`origin/main`: the main checkout had another session's uncommitted hero work). Spec:
`docs/specs/ash-disciple.md`.

**Done:**
- **Levels (ADR-058):** `src/levels/` (Cinderwood, Ashfall), `?level=ash`, `applyLevel` into
  `CONFIG.world` at boot, a stage picker on the title, a LEVEL row in the Lab. The boss slot keeps
  `game.dragon` (+ `game.boss`) and the `dragon:*` events. Wyrm text moved into the level (flow banners
  and lore, the minimap zone, the log, the name tag); audio gives a duelist no creature voice.
- **The courtyard** (`world/courtyard.js`, the forest's prop builders exported): a staggered paving of
  carved slabs with a calmer glyph ramp, a ring of broken pillars and lanterns, a gate with its lintel
  fallen, a bronze bell, a stele, steps and a flagstone path down to the bonfire, ~340 charred trees
  and stumps. Atmosphere `ash` mode (falling flakes, drifting embers); grass thinned, shortened and
  greyed through a set's `grass` hook (`uAsh` in grass.js).
- **The Ash Disciple (ADR-060):** gear items on the hero's skeleton (a wide douli, a robe with a
  crossed collar and sash, a skirt on the coat springs, a bracer and a bell sleeve, wrapped shins, a
  jian with a red tassel on a streamer spring), recoloured on his own materials. `HeroAnimator` takes a
  per-instance pose table; his `loco` is a jian guard on the hero's gait, his `duel` clips are keyframe
  data (`moves.js`): twelve moves, the Riposte counter, the Kindling, eleven reaction clips.
- **His rules (ADR-061):** the guard and the counter, the windup guard up to the commit point, feints
  without a tell or a glint, Ash Crescents that cue themselves, the Ghostep behind him, the execution
  thrust (player.js `_startExecuteThrust`, `onExecute`). `dragon:guard` + a GUARDED call-out.
- **Tests:** `tests/integration/duel.mjs` (own file: the main suite was being edited elsewhere),
  in `npm test`: LEVELS, DATA (every move, both phases, both ends of every roll), TIMING, GUARD,
  DEFLECT, GHOSTEP, EXECUTE, PHASE, FLOW, WIN; `probe` opt-in.
- **Direction (ADR-059):** CLAUDE.md, ROADMAP vision and M2 rewritten for the skill boss rush.

**Found and fixed on the way:** `limb()` with `capSegs: 0` makes NaN vertices (the bell sleeve drew
as a black slab through the art pass: now a lofted shell); the douli's veil drew as a solid black
panel (removed); the jian on the `flask` material glowed gold (now `armor` + `bevel`, pale steel);
his raised sword-finger hid under the hat's brim (now forward beside the jian). The DATA rules caught
two P2 first windups under 0.7 s (Swallow, Riposte → 0.78); TIMING caught the spins landing 150 ms
late (their step moved into the windup). The WIN bot found three leaks: no guard while winding up,
a 0.25 s re-raise after a flinch that let a chain flinch-lock him, and a crush threshold (18) the
slam and every charged thrust passed; then a break was worth ~1250 of his 2000 HP (break crit 2.2 →
1.5, HP 3000, the executed reaction 2.0 → 1.3 s and he gives ground).

**Verification:** `npm test` ALL PASSED (the wyrm suite unchanged, DUEL ALL PASSED, glyph check),
`npm run build` ok (1748 KB). In the browser: both levels boot with no new console errors; the title
picker, the Lab row, the courtyard from above and at the game camera, the disciple from eight angles
(ASCII), film strips of Plum Thrust, Swallow Flicks and Crane Spins; the phone preset (852 x 393, LOW).

**Rebased onto #13 / #14** (the two-handed hero): my ADRs became 050–053. The new swings missed his
back after a Ghostep from the wyrm's 3.2 m, so an attacker may now set the distance (`ghostepBehind`,
his 1.5 m), and the probes showed him too soft (70 % kept 4 flasks): his blows × 1.35, idle gaps a
little shorter.

**Measured:** phone preset, Ashfall: 51 draw calls a frame in the duel (the wyrm fight: 56), ~360k
triangles (Cinderwood ~690k: the thinner grass). WIN: 50–54 s on three seeds; probe 85 %: wins in
54 s (1 hit); 70 %: wins in 70–75 s with 1 / 0 flasks left; 60 %: dies with him at 10 %.

**Not checked / open:**
- No human has played it; nothing ran on a phone. Is the guard readable? Are the feints fair?
- Only three moves were looked at frame by frame; the other moves and the reactions (stagger, recoil,
  broken, executed, death, the intro's salute, the Kindling) were checked by the tests, not by eye.
- His hits are zones, not his blade: a pose edit can drift from them unseen.
- No sounds of his own beyond the cues and the clangs. The reward is the next PR.
- The duel suite copies the main suite's harness (`build`, the input mock): share it once the
  parallel edits to `integ.mjs` have landed.

**Next:** the owner tries `?level=ash` on the Vercel preview (desktop and phone); then the technique
system and his reward.

---

## 2026-11-12 — Session 17: attack variants, a flowing chain, hair that reads, a fuller cloak

**Owner** (with a phone screenshot): "i can't tell the yellow color in front of his face is his
hair ... the side angle/view also seems like the character is way too skinny ... something about
his left clicks is meh to me so lets try to make his attack animations and motions cooler and
natural looking. i also dont want him to show the same pattern over and over". Answers: locks out of
the hood, not too long, with three previews to approve first (picked "A"); a fuller cloak; fast and
flowing; random variants per hit. Branch `player/hair-depth-attack-variety` (session and ADR numbers
skip 16 / 054: the parallel techniques branch holds them).

**Done:**
- **Attacks (ADR-055):** `variants` for hits 1–5 (12 looks in all), picked at random, never the same
  twice in a row; `turn`, `hop`, stab `rise` / `low`, slam `hop`; `FLOW` on every light sweep.
- **Hair (ADR-056):** three hair prototypes rendered and sent; "A" kept: `HOOD_HAIR` strands, the
  face and neck in shadow (`shadowsFace`).
- **Cloak (ADR-057):** back sheets further back and standing off; a deeper mantle.
- **Tests:** REACH swings every variant at contact, 2 m and 3.5 m; HERO checks the hood's strands
  and the shadowed face; HEROLIFE waits for a freshly started idle action before cutting it.

**Verification:** `npm test` ALL PASSED, `npm run build` ok. In the Lab: every variant frame by
frame (solid) and at mid-strike (ASCII); the cloak from both sides and behind, standing and running;
three hair styles close up and at the phone camera.

**Measured:** cloak depth behind at rest 0.55 m (0.44), running 0.89 m (0.81); width 1.28 m / 1.17 m
(1.23 / 1.15). Variants: 24 reach trials, no miss. One bot `win` run 167 s (the wyrm changed in #15
since the last measure).

**Not checked / open:**
- Not played by a human, not tried on a phone.
- PR #16 (the Ash Disciple) and the techniques work in progress also edit `anim.js` / `player.js`;
  whoever merges second rebases (the variant pick lives in the animator, `player.js` is untouched).
- The sprint slash, the roll cut and the thrust have one look each.

**Next:** the owner's look at the preview; more variants if the chain still repeats.

---

## 2026-11-11 — Session 15: breath-born bullets, perfect-parry returns, Armageddon, heat-glow warnings

**Owner** (through a planning session, spec `docs/specs/wyrm-breath-armageddon.md`, owner decisions
final): the bullet hell should look natural (all fire from the mouth, nothing out of nowhere) and be
much harder; a perfect parry should send fire back and hurt the dragon; a new Armageddon attack fires
meteors into the sky that crash down across the arena; the red ground indicators should be subtle,
not break immersion. Branch `dragon/breath-armageddon`, four code commits in work-package order.
The spec named its ADRs 046-049; PR #14 (Session 14) took those numbers first, so they are
ADR-050 to ADR-053 here.

**Done:**
- **WP1 — ground warnings heat the ground (ADR-052):** `fx.heatDisc` / `heatBand` / `heatFlare` replace
  `hzRing`, the strip / ring / wall warnings, the hazard flash, the melee slam zones (`warnRing`,
  `ringPulse`) and the wheel's lines: a stable fill of `. , : '` glyphs coloured by heat (ember →
  orange → white-orange with k), sparks from k 0.6, scorch-map heat stamped under it (no char), the
  true edge as a `·` rim only in the last `flashLead` s. No red, no `!`, no chevrons, no r1 reach
  ring. `shockRing` and the live fire's edges are fire orange.
- **WP2 — perfect parry returns (ADR-051):** `DEFENSE.perfectParryWindow` 0.08 s; `deflect.perfect`,
  `player:parry.perfect`, `dragon:parried.perfect`, the new `dragon:returned`. A returned ember / wisp
  flies back at 34 m/s, 1.8x, white-gold, and hits the head for 30 / 70 HP + 14 / 30 posture through
  `dragon.takeHit` (gate and death like a sword hit). RETURN call-out, gold burst, 0.05 s stop, a
  brighter clang, a hit sound. Afterwards: a per-pattern return budget (120 HP, see below).
- **WP3 — breathed bullets + Hard (ADR-050):** `spit()` spawns every bullet at `pt.mouth` along the
  head's real aim from the `hit()` hook (after the rig); `aimHead` / `reachFor` aim and draw in the
  head; a drop scaled to the hero's distance. Ember torrent, Cinder burst (P3 double taps, a 35 %
  chain into a torrent through `brain.queued`, which existed), denser Wisp swarm (≤ 3 alive gate),
  Scouring breath (tongues off the head's aim rooted at the mouth's ground projection; the wheel
  gained `offs` / `aimWheel` and a stepped cue). `pop` 2.2 → 1.5. The flurry's embers rise out of a
  puff of flame.
- **WP4 — Armageddon (ADR-053):** rear-up with a red body glow (`dragon.bodyWarn`), a salvo of bolts
  out of the jaws (`fx.launchBolt`, stage `launch`), the sky answering (`atmosphere.skyGlow`, stage
  `sky`), `hazards.barrage` (waves over the whole clearing from `placeWave` / `leadInto`, P3 burning
  craters, a great meteor to finish). Hazard pool 64.

**Decisions / deviations from the spec's starting numbers (tuning, the owner table untouched):**
- Return budget 120 HP per pattern: the spec's 70 per wisp with 13 P3 wisps let a perfect parrier
  deal ~910 HP a swarm (~3x the sword), against its own target "≤ ~8 % of a phase's HP".
- Scouring breath turns at 2.15 rad/s, not 1.5: at 1.5 the 4.6 s cast (with the ramps, the pause and
  the reversal) sweeps ~0.9 turns, short of the spec's "≥ 1.25 turns"; measured 1.08 turns at 1.9.
- Wisp swarm count [7, 10, 13], not [0, …]: P1 is never picked by the AI (weight 0); 7 keeps the
  Lab's P1 trigger meaningful.
- Armageddon fits all 16 P3 bolts inside the 1.6 s salvo (0.09 s apart instead of 0.11).
- The P3 burst → torrent chain needs the torrent off cooldown and the hero within its 26 m.
- The sky glow is subtle on purpose: at the phone's close LOW camera the fog fills most of the
  frame; the first, stronger tint read as a brown wash (with the hurt vignette of a god-mode hero
  standing in craters on top of it).

**Verification:** `npm test` ALL PASSED (688 checks on the tree rebased onto #14, 635 before this session; BULLETS and FIRE grew),
`npm run build` ok (1695 KB). Film strips in the dev server (`__tick` + an overlay canvas): a
meteor's heat at k 0.2 / 0.6 / hot, a stomp zone, the burning pass, the flame ring and wall; a
perfect parry's shot flying back and landing (−30 HP); the torrent, the burst and the Scouring breath
emitting from the jaws; the whole Armageddon (rear-up, salvo, hush, three waves, the great meteor)
on desktop and on the phone preset (852 x 393, LOW). Phone preset, P3 peaks: additive glyph
particles torrent 634, burst 449, Scouring breath 1013, Armageddon 1805 (pool 7000); bullets 124
(pool 360, so `MAX` stays); hazards 25 (pool 64); 56 draw calls throughout (particles are one draw).

**Hits taken by the scripted heroes** (standing / answering every cue; before → after):

| Pattern | P1 | P2 | P3 |
|---|---|---|---|
| Ember storm → torrent | 2 / 1 → 4 / 0 | 4 / 1 → 6 / 0 | 4 / 2 → 6 / 0 |
| Cinder fan → burst | 2 / 1 → 4 / 1 | 3 / 1 → 5 / 1 | 3 / 1 → 5 / 1 |
| Wisp swarm | – | 4 / 1 → 6 / 1 | 4 / 0 → 6 / 0 |
| Fire wheel → Scouring breath | – | 2 / 0 → 1 / 0 | 2 / 0 → 1 / 0 |
| Meteor rain → Armageddon | 3 (standing) | → 5 / 0 | → 5 / 0, + 31 crater ticks |

Peak bullets in the air, before → after: storm / torrent 123 / 138 / 274 → 43 / 73 / 125 (the old
storm sprayed all round the body; the torrent's bullets all go the hero's way), fan / burst 20 / 35
/ 43 → 33 / 51 / 80, wisps 7 / 9 → 10 / 13. The answering bot parries 0.12 s before impact (outside
the perfect window) and rolls 0.1 s before a red one, in a frame: it says the patterns stay fair to
perfect reads, not that a person can read them.

**Not checked / open:**
- No human has played it; on-device frame rate on the iPhone is the owner's to confirm (the Vercel
  preview). The heat-glow readability at k 0.3 rests on my screenshots, not a fresh pair of eyes.
- A Scouring breath hits a standing hero once per cast (it sweeps past him and reverses before it
  comes round again); the P3 craters ticked the never-moving defender 31 times (4 each, blockable):
  a human walks out, but watch it.
- Close to the jaws the burst's gaps are narrower than the hero (from ~14 m off the mouth they
  clear him): close in every cough must be parried.
- Returns were only checked with scripted presses; the 0.08 s window and the 120 HP budget want a
  human feel test. AI pick shares, the `win` / `probe` bot times and the old ROADMAP items
  (bullet sounds of their own) were not re-run / done.
- `.claude/launch.json` gained a local config on port 5183 for this worktree; not committed.

**Next:** the owner's phone test of the preview; then tune from play (heat-glow strength, torrent
sweep speed, the budget, the crater ticks).

---

## 2026-11-12 — Session 14: two hands, a raised guard, idle life, gold hair, a clear charge

**Owner:** "make the character use both hands when he's swinging ... add some idle animations of the
character doing random stuff while not moving ... i like the new hooded look but the front details
and visuals makes him look like death. have his hair show a bit and make his hair colored gold to
stand out. also his hood is too pointy at the top. when he guards, make him hold the sword up in a
higher angle ... when he's charging the sword, the sword and arm are clipping through the cape."
Answers: both hands on every swing, one-handed carry at rest; all four idle kinds; the hood pushed
back a little; a two-handed guard raised across the body. Branch `player/two-hands-idle-life`.

**Done:**
- **Two hands (ADR-046):** every light swing and the stab are two-handed; `slashH` moves the grip to
  the chest's centre line and turns the chest less to the left; `DIM.offGrip` 0.08; the off hand
  closes round the grip (`rig.offHand`). The block is two-handed, the blade ~50° up across the body.
- **Idle life (ADR-047):** `FIDGETS` (look, stretch, inspect, twirl, shoulder, lean) after 2.5 s of
  standing still, cut by any input.
- **Cloak vs steel (ADR-048):** streamer sheets collide with spheres on the blade, keeping the side
  they came from; the charge pose's hands before the hip, the blade out to the side.
- **Follow-up, the owner: "the back cape is too floaty now and makes the character look wider from
  the back view. make it look similar to the original look."** The first version also held the
  sheets out round both arms, moved the sheet behind the sword shoulder onto the shoulder blade and
  lifted the cloak in the charge. All three are reverted; only the blade collides. Compared side by
  side with `main` (a second dev server on the old commit): the same back view at rest, running and
  stopping; hem width 1.29 m vs 1.23 m at rest, 1.15 m vs 1.15 m running.
- **Hood and hair (ADR-049):** a rounder hood worn further back; gold fringe and cheek locks; a
  warmer face and smaller brown eyes.
- **Tests:** a new HEROLIFE scenario (two hands in every swing's active frames, the guard's angle,
  the charged blade vs the cloak, idle actions and their cut, none while locked on); HERO checks the
  hair kept under the hood.

**Verification:** `npm test` ALL PASSED, `npm run build` ok. In the Lab model viewer (solid and
ASCII): the head from six angles, the chain frame by frame from the front three-quarter, the block
and the charge from the front, back and sides, every idle action. At the phone camera (852 x 393):
the block and the charge facing four ways, the first three hits. A probe of blade and arm points
against the cloak sheets over idle, run, block, the chain and the charge.

**Measured:** off hand to grip ≤ 2.5 cm in every swing (was up to 8 cm before the chest-turn fix);
charged blade inside the cloak in 0 of 96 test frames (was 94 of 150); bot `win` 139 s; REACH
unchanged.

**Not checked / open:**
- No human has played it; not tried on the phone.
- The arms still pass through the cloak near the sheets' roots (as before this session).
- The left arm still locks straight at the end of the two-handed stab and the slam.
- The twirl passes the blade through the cloak region behind him for ~0.3 s.
- Gold hair applies to the Wanderer's set too; `docs/art/hero.md` is still out of date.

**Next:** the owner's phone test of the preview.

---

## 2026-11-11 — Session 13: a hooded cloak, arms that bend, fewer draw calls

**Owner** (with the reference again: a hooded swordsman in a huge ragged cloak, the sword low at his
side): "The main character hand motion and animation looks very unnatural and can be improved. Also
the game performance seem to have slowed down while testing it on my iphone ... If you think
recreating the character from scratch will help to make this easier and look similar to the
reference image, let me know." Answers to four questions: a new outfit on the same skeleton (not a
full rebuild); every motion looks wrong (standing, running, attacks, block / roll / heal); slow all
the time, not only in the fight; an iPhone 15 / 16 / 17 Pro, Low Power Mode off. Branch
`player/natural-arms-mobile-perf`.

**Found:**
- Frame cost: about 510 draw calls in the fight on the phone preset (852 x 393, LOW), 575 in a
  1024 x 768 window. The hero is 138 meshes and the wyrm 183, and nearly all of them are drawn
  twice (the shadow pass alone was 324 of the 575). GPU timer
  queries on a desktop: the hero or the wyrm alone costs the same into a 4 x 4 target as at full
  size, so it is per-draw overhead, not fill; grass, forest and the ASCII pass are small next to it.
  About 2,500 GL calls a frame.
- The arms: over the five-hit chain the sword arm reached 4 deg of elbow bend in four of the five
  hits, and the forearm-to-blade angle stayed within 24-40 deg through the whole rising cut and
  whirl. `slashH` held the hand at or past full reach with the blade exactly radial to it.

**Done:**
- **Outfit (ADR-043):** `gear/shroud.js`, the Shrouded set, is `DEFAULT_LOADOUT`: hood (`hidesHair`),
  wrap tunic, bound sleeves with bare hands, a mantle and seven cloak sheets on the streamer springs
  (`lag` 0.5, `max` 1.45; wrapped along the body while tumbling). The cloak covers his back and left
  side; the sword arm is clear. The old outfit is `WANDERER_LOADOUT`. Cloth far fill raised.
- **Arms (ADR-044):** `slashH` `ext` / `lead` driven by `SWING`: a cocked arm in the coil, the fist
  leading the blade, the arm opening through the cut and folding in the finish; the blade's own
  direction unchanged. `_arm` soft reach (`ARM_SOFT`). Light 1's free hand guards before the chest.
  The slam's hands go behind the head at the apex. The run's sword hand swings with the stride.
- **Draw calls (ADR-045; built by a background agent in its own worktree, cherry-picked here):**
  `render/rigidBatch.js`: every rigid part of the hero and the wyrm is a bone in one shared float
  texture (`U.uBoneTex`); each actor draws one merged mesh per material and one shadow mesh
  (`LAYER_CASTER_RIGID`). The source meshes stay in the scene graph, hidden from the cameras. One
  scene matrix update per frame instead of two. Quality presets carry a shadow map size (LOW 1024).
  `?nobatch` in the URL turns the batching off.
- **Tests:** HERO checks the cloak's sheets, the hood hiding the hair, the Wanderer's set still
  building, and both elbows keeping more than 23 deg (measured 40 and 46). A new BATCH scenario (22 checks): the
  batches, the bones, hidden parts, shadows, loadout rebuilds, dispose, `?nobatch`.

**Verification:** `npm test` ALL PASSED (635 checks), `npm run build` ok (1675 KB). In the browser on
the merged tree: no console or GL errors, 23 programs link. Looked at in the Lab model viewer (solid and ASCII): the idle from six
angles, the five-hit chain frame by frame, the run from the side, block, heal, roll, the slam and
the thrust. At the phone-size game camera: the idle facing four ways and the first three hits.

**Measured:** sword-arm elbow bend over the chain 46-146 deg (was 4-146); the slam's apex wrist 99
deg (was 147). Draw calls per frame at 852 x 393, LOW, with the new outfit
(`renderer.info`, 30-frame averages): title 432 → 55, fight 509 → 56 (`?nobatch` against batched).
The agent's pixel comparison of batched against unbatched on the same frozen frame, made with the
OLD outfit: 0 of 334,836 pixels differ in the fight and model views at phone size, up to 25 of
786,432 at 1024 x 768, a median of 3 per frame over 120 action frames, and one frame with 717 that
it could not reproduce (it puts the residue down to shadow depth rounding at the bias threshold).
`pipeline.render()` CPU time on a desktop RTX 4090: about 0.92 → 0.39 ms.

**Not checked / open:**
- No human has played it, and nothing here was run on a phone: the frame-rate gain on the iPhone is
  not measured. `?nobatch` in the URL turns the batching off for an A/B on the device.
- The pixel comparison was not repeated with the new outfit; batched, it was only looked at (model
  viewer and the phone-size game camera).
- Batched parts are not frustum-culled one by one (about 30k more triangles a frame; an off-screen
  wyrm still costs 14 draws), and LOW's 1024 shadow map softens shadow edges on desktop too.
- Damage per second and the bot win time were not re-measured after the arm changes (the grip sits
  up to ~5 cm nearer the shoulder at a full stretch; REACH passes).
- The cloak has no collision: it passes through the legs, the coat tails and the ground, and fans
  out wide in a roll. A 145 deg wrist remains for ~3 frames in the slam's windup.
- Idle, block, heal, roll and thrust poses were looked at and left as they were (soft reach only).
  Stagger, knockdown, death and the plunge were not looked at with the new outfit.
- `docs/art/hero.md` describes the Wanderer's set and the old arm.

**Next:** the owner's phone test of the Vercel preview; then whatever still reads wrong in motion.

---

## 2026-11-11 — Session 12: hands, the five-hit chain, a slim profile, equipment slots

**Owner** (with a reference image: a cloaked swordsman, the sword low at his side): "The character
right now has no right hand, the way he's holding the sword is a bit awkward and not natural. His
first 2 arc swings can also be improved. Add a few more animations ... He looks weird when viewed
from the side ... I also plan to make this a rpg where you can equip new armor and weapons so make
sure the characters outfit can be replaced easily." Answers to four questions: idle = low at his
side; attacks = a longer varied chain + sprint attack + roll attack; equipment = the structure
only; side view = cape and coat shape, the rest left to judgement. Branch
`look/hero-hands-combo-slots`.

**Done:**
- **Moveset (ADR-041):** `LIGHT` is five hits (falling cut, rising backhand, whirl, stab, slam);
  `SPRINT_ATK`, `ROLL_ATK`. `anim.js`: `spinTurn`, `stabPose`, the `sink` and `feet: 'dash'` options;
  the windup loop and the free hand's reach key on `anim.loop`, not on `combo === 1`.
- **Hands (ADR-041):** `gripFist` on the sword joint, `looseHand` on the left forearm
  (`heroGeo.js`); the undersuit has bare versions.
- **Idle (ADR-041):** `IDLE_SW` [-0.6, -0.79, 0.12], edge down, the upper arm by the ribs.
- **Profile (ADR-041):** `CAPE_SHEETS` (`ry`, `out`) and `COAT_PANELS` (`flare`, hem widths).
- **Gear slots (ADR-042):** a subagent split `model.js` (1490 → 562 lines) into `heroDims.js`,
  `heroGeo.js` and `gear/` as a pure refactor in its own worktree; it compared the default
  loadout mesh by mesh with the old build (136 of 136 byte-identical) and ran the suite with
  reduced loadouts. On top: `player.equip` / `setLoadout` / `loadout`, and no sword glow unarmed.
- **Tests:** REACH covers five hits; HERO checks the chain order and wrap, the whirl's whole turn,
  the sprint slash (name, 1.8–3.4 m, heading kept), the roll cut, the backstep, the gear slots, the
  fist's owner, three loadout swaps and a bad id; HEROLOOK walks the new moves.

**Verification:** `npm test` ALL PASSED, `npm run build` ok (1660 KB). Looked at
in the Lab model viewer: every new move frame by frame, the idle from eight angles (ASCII and
solid), both hands close up, both side views, four loadouts. At the game camera: the idle facing
eight ways.

**Measured:** sustained chain damage 63 /s (was 62 /s). Two `win` bot runs: 154 s and 144 s (177 s
in Session 10). Two runs; not enough to say the fight is easier.

**Not checked / open:**
- No human has played the new chain. The whirl turns his back for ~0.1 s; the sprint slash ignores
  the aim and the step-in assist.
- The new moves at the game camera in a real fight; a phone; frame cost.
- Heal, stagger, knockdown, death and plunge with the new hands (the fist rides the sword joint, so
  it follows wherever the sword goes).
- The undersuit was only looked at standing still.
- Weapons of other lengths are not supported (ADR-042). `docs/art/hero.md` is out of date.
- Facing west / north-west at the game camera the idle blade is still behind him.

**Next:** playtest; the M1.13 follow-ups; a second gear set and an equip menu when the look is
settled.

---

## 2026-11-09 — Session 11: hero review, athletic build and the idle sword hold

**Owner:** "review the main character and fix any details and features to make sure he looks good.
make sure his animations and sword posture looks natural and good. right now he is a bit too lanky".
Worked in the `combat/wyrm-bullet-hell` checkout while another session was committing to it; this
session's files are the hero's only (model, anim, fx, parts, the `herolook` test, docs).

**Done (ADR-040):**
- **Build:** chest 0.34 → 0.39 m, waist 0.23 → 0.27, shoulder joints ±0.16 → ±0.178, hips ±0.105,
  arms / thighs / boots ~20 % thicker, head joint ×1.08, hands ×1.12. Collar and pauldron now follow
  the body in `hero_parts.py` (`COL_K`, `PAUL_K`); parts rebuilt with `npm run hero-parts`. Coat
  panel tops and cape roots widened; cape flare down about a fifth.
- **Idle:** blade out to his right (`IDLE_SW` [-0.725, -0.68, 0.1]) from a bent arm, shoulder-width
  stance. Before, it pointed ahead from a straight arm and was hidden at the game camera when he
  faced away.
- **Light 1 recovery** comes home round the front (`HOME_WAY`); the short way to the new idle went
  behind his head (the `herolook` test caught it as 4.3 cm of blade in the sword arm).
- **Tip streak** moved onto the drawn point.

**Verification:** `npm test` ALL PASSED, `npm run build` ok (1652 KB). Looked at in the Lab model
viewer (ASCII and solid, eight angles): idle, run, light 1 and its recovery, light 2, slam, block and
release, charge, roll, run start / stop. At the game camera: idle facing eight ways.

**Not checked / open:**
- Heal, stagger, knockdown, death, plunge, sprint and strafes with the new build (only the test's
  blade-in-body check covers part of them).
- Facing west / north-west the idle blade is behind him at the game camera; facing north half shows.
- A phone, frame cost, and a real fight were not looked at.
- `docs/art/hero.md` still describes the lean build and the old idle.

**Next:** playtest; the M1.12 follow-ups.

---

## 2026-11-09 — Session 10: bullet hell, two more strings, the moonlit sword

**Owner:** "the pants fabric in the front keeps clipping through the sword. make the sword a little
shorter and make it glow more blue/white ... the dragon needs to do more bullet hell moments that
requires the player to dodge and react ... make the fire animations and overall attacks look way
more epic and cooler." Answers to the design questions: a sword of about 1.25 m; bullets you can
deflect or dodge; all four pattern families; about as hard as now. Branch `combat/wyrm-bullet-hell`
(started on top of `look/hero-blender-parts`; rebased onto `main` after PR #8 merged).

**Done:**
- **Sword** (ADR-038): drawn length 1.64 → 1.25 m (`DIM.drawnTip` 1.06; blade parts rebuilt with
  `npm run hero-parts`), lit blue with white-blue edges (`BLADE_BASE`, inks, emissive, rest glow
  1.45). Combat reach unchanged.
- **Idle:** the blade is held in a low ready at his right side, outside the coat, instead of across
  his front between the coat panels. That was the clipping.
- **Bullets** (ADR-039): `dragon/bullets.js` (pooled field + the fire wheel), `bulletAttacks.js`
  (four patterns), `bulletFx.js`, `tuningBullets.js`. Embers / wisps: parry (flies back, adds
  posture), block, roll, cut. Orbs and the wheel: dodge. A cue 0.35 s before every hit, one parry per
  clump, duds for bullets that could not be announced, a grace after a hit, a hit cap per pattern.
- **Strings:** Storm flurry (5 hits, phase 1+), Cinder flurry (4 hits + 4 scattered embers, phase
  2+). Idle gaps shortened; `TUNING.damageScale` 0.85.
- **Player:** `isSwinging()`, light parries (`hit.light`), plain-dodge-only hits (`hit.perfect ===
  false`).
- **FX:** claw wakes, slam bursts, reworked breath / fireball / parry sparks; audio and the death
  feed know the bullets.
- **Tests:** BULLETS scenario in `tests/integration/integ.mjs`. `npm test` ALL PASSED, `npm run
  build` ok (1651 KB).
- **Docs:** COMBAT.md "Bullets" + numbers v0.6, ARCHITECTURE.md contract v0.6, STYLE.md "Bullets",
  ADR-038, ADR-039, ROADMAP M1.11, CHANGELOG.

**Measured** (COMBAT.md "Difficulty", one run each): probe 95 % wins in 134 s (was 145–150 s); probe
85 % dies at 122 s with the wyrm at 4 % (was: wins 1 of 3); `win` 177 s with 77 parries and 39
deflect chains (was 157.5 s, 44 and 26).

**Looked at in the browser** (Lab-triggered, game camera, screenshots): the idle and the sword;
ember storm in phases 1 and 3; cinder fan; wisp swarm; fire wheel; breath; fireball; a bullet deflect.
Two looks were wrong on first sight and fixed: the wheel's spokes and the deflect clash were white
blobs (the additive rule in STYLE.md).

**Not checked / open:**
- No human has played it. Difficulty and readability rest on the bots.
- `slamBurst`, the Storm flurry as a whole and the parry slash's new colour were not looked at one
  by one; claw wakes were seen only in an early Cinder flurry sheet.
- The scripted defender still takes up to 2 hits in a phase-3 ember storm.
- Run and attack frames were not re-audited for coat / blade crossings; only the idle was.
- The drawn blade is 0.44 m shorter than the hit segment.
- Frame cost of ~200 live bullets on a phone: not measured.
- The AI pick-share paragraph in COMBAT.md is v0.5's.

**Review fixes (PR #9, same day):** three cue bugs found by the automated review, each reproduced
by a new BULLETS check that fails on the old code and passes now.
- Even-count fan (phase 2, 8 embers): the centring was inverted, so the first fan had no ember on
  the hero and no lead bullet; the headline flash came 1.03 s before the first hit. Now 0.33 s
  (`fanOnHero` / `fanOffset` in `bulletAttacks.js`).
- A homing wisp's cue was for life: sidestepped after its cue, it came round and hit 1.23 s after
  its only cue. A cue now stands for one impact (`cueAt`, `TUNING.bullets.recue` 0.12 s); the
  second pass is cued 0.35 s ahead, or the wisp is a dud.
- Wisp swarm at 28 m: the lead wisp lands after the action ends, and the end-of-action flush
  flashed 0.72 s early. The field now holds that flash for the lead (`bullets.holdFlash`); 0.33 s.
  The window is narrower than the review said: the lead outruns the action only beyond about
  24.5 m (the AI roars the swarm up to 30 m).
- Not looked at in the browser: these change when a cue fires, not what is drawn.

**Next:** playtest; then the follow-ups in ROADMAP M1.11.

---

## 2026-11-09 — Session 9: Blender-built hero parts (single-figure reference, round 3)
**Owner:** "use blender headless to help you out" with the single-figure reference match that
Session 8 left part-way. Branch `look/hero-blender-parts`.

**Done:**
- **Blender part pipeline (ADR-037):** `npm run hero-parts` (`scripts/blender/build-hero-parts.mjs`)
  dumps `DIM`, `BODY`, `REST`, `HAIR_CLUSTERS` and `CAPE_SHEETS` from `model.js` to JSON, runs
  `scripts/blender/hero_parts.py` in a headless Blender (5.2 here; `BLENDER` env var or PATH) and
  writes `src/entities/player/heroParts.js`: 33 parts, 7.2k vertices, 9.6k triangles, packed base64
  (positions and `aGUV` Int16 / 8192, normals Int8, `aPart` Uint8 / 200, Uint16 indices), ~210 KB.
  `partGeometry(key)` in `model.js` decodes a part; JS still picks the joint and the material. The
  generated file is committed, so the game, the tests and the Vercel build need no Blender.
- **Sculpted in Blender:** the hair (a rounder mop of ~60 locks over a scalp cap, per spring cluster,
  dark mass + sheened tips), the winged stand collar and its rim, the lapels and their piping, the
  blade (forte, faceted core, barbed cyan edges), the cape (four wide torn sheets with holes and a
  clawed hem, `CAPE_SHEETS`) and the pauldron (a cap and a pointed lame with bevelled edges and four
  short blades).
- **In `model.js`:** darker cloth and lining, brighter skin, both eyes on the skull's surface (the one
  eye sat 6 mm under it), the arm strap rings and the left bracer's bands removed, three shirt
  buttons instead of seven, wider and more flared coat panels, a narrower blade. The JS builders the
  parts replaced are deleted (`hairGeometries`, `hairCap`, `collarGeometry`, `collarRimGeometry`,
  `bladeGeometry`, `domeShell`, `domeRim`).
- The interactive Blender MCP link timed out on every call, so Blender is driven from its command
  line (`--background --python`); nothing depends on a running Blender.

**Verification:** `npm test` green, `npm run build` OK (1615 KB). Captures (session scratchpad): the
reference angle next to the reference image, front / back / right, the head close-up in ASCII and
solid, the gameplay camera from behind, and every move from the back and the right side: the cape
streams behind in the run, the grip stays in the right hand, no gross clipping. Not checked: a phone,
frame cost, the far gameplay camera in a real fight.

**Honest state:** closer again in silhouette (hair mass, collar, one big torn cape off the armoured
shoulder, a narrower jagged blade, darker masses), still clearly NOT a match. The face is a pale
oval with dot eyes; the coat is a pleated bell of straight fold lines, not the reference's long
ragged tails; the pauldron is two plates with fins, not a stack of ornate spiked lames; the arms and
legs are plain tubes and plates without the reference's belts, buckles and layered armour; the
reference's density of small bright detail is not there.

**Next:** the coat as Blender-built panels (broad folds, long tattered tails), the face (brow, nose
and jaw lines), arm and leg armour as sculpted parts, the belts and buckles. See ROADMAP M1.10.

---

## 2026-11-09 — Session 8: single-figure reference, round 2 (stopped part-way)
**Owner:** the hero "still does not look like the attached reference image on terms of detail and
feel"; mirror the single-figure image as closely as possible; the sword hold and its angle are
awkward. Branch `look/hero-reference-round-2`. The owner stopped the session before the geometry
rebuild was finished, so this entry records a PARTIAL result.

**Done:**
- **Idle and sword hold (ADR-036):** the single-figure stance. Weight on the left leg, the right leg
  straight out to his right and forward, the sword arm hanging beside the right hip, the blade in a
  low diagonal across his front (`IDLE_SW` [0.75, -0.58, 0.26], ~37° below level; the reference is
  ~44°), the head bowed and turned along the blade. Reverses ADR-034's blade hung at his right side.
- **Dot-matrix shading (ADR-036):** the hero's fill is a 3x3 micro-font (29 marks, `PIXEL_3X3`) in
  square 4x4 px cells instead of 3x5 letters in 4x6 cells; fill brightness linear in the light
  value, a little greyer; cel-stepped key light (`U.uArtHeroCel`); per-part silhouette ink
  (`U.uHeroPartRim`; fill style + 8 = a dotted silhouette); plain ink lines kept under the bloom
  threshold. `PIXEL_3X5` and `PIXEL_LINES` are gone.
- **Coat:** six wider, longer panels with drawn fold lines (`foldLines`: a smooth `aPart` field whose
  0.5 contour the ink pass prints as a crease; `HERO_INK.*.sub` / `uArtSub` shades the valley side).
- **Cape:** the two sleeve streamers became four torn ribbons from under the pauldron on the same
  streamer springs, each with its own outward flare (`out`).

**Verification:** `npm test` green, `npm run build` OK. Captures (session scratchpad): the reference
angle, front / sides / back / rear 3/4, and every move from the back, right and front after the coat
and cape change: grip in the right hand, no gross clipping, moves read as before. Not checked: the
real 36 m gameplay camera in the grass, a phone, frame cost of the wider coat.

**Honest state:** closer to the reference in stance, sword hold, mass and tone; still clearly NOT a
match. The coat reads as a closed pleated skirt covered in straight lines (from behind it hides the
legs that ADR-034 opened up); the cape is stiff shards, not a wide torn sheet; hair too narrow; no
face; collar not winged; legs are wireframe plates; one smooth pauldron with long claws; plain
straight sword; overall grey where the reference is near-black with sparse bright edges.

**Next (planned, not started):** open flared coat (fewer, broader folds), a face-on cape sheet, hair
mop, face lines, winged collar, dark legs with knee guards, layered pauldron, jagged blade, darker
tones. See ROADMAP M1.9.

---

## 2026-11-09 — Session 7: the lean reference match (the hero from every side)
**Owner:** improve the hero to closely match two new ASCII references (a single-figure image for
appearance, detail and the sword; a six-view turnaround for construction), "especially from the back
and rear three-quarter gameplay views". Priorities: a lean anime swordsman silhouette; distinct,
asymmetric pointed hair with crown and nape layers; a raised collar and a layered right pauldron with
depth; an intentional back (shaped upper panels, a diagonal strap, restrained seams, a narrow belted
waist); two tapered coat tails and narrow side panels instead of the broad skirt, legs visible; the
reference's sword; ASCII shading with dark planes, readable midtones, selective bright edges and
restrained bloom. Plus an inspection view (dark background, front / both sides / back / rear 3/4, the
real gameplay camera at play size, a turntable, solid and ASCII toggles). Branch `look/lean-hero`.

**How:**
- Measured the references first: the six views' silhouettes per height (closed masks), in fractions
  of his height H: shoulders ≈ 0.24 H, chest ≈ 0.18 H, belted waist ≈ 0.12 H, thighs ≈ 0.06 H, the
  coat tails to ≈ 0.8 H, flaring to ≈ ±0.24 H. Diagnosis of the baseline: round 3's broad build and
  closed A-line skirt (from behind at the game camera a lettered trapezoid with no legs), a round mop,
  a tall tube of a collar, the portrait idle's blade across his front (hidden from behind), a blade
  halo over his body.
- Built the look-dev tools before touching geometry (ADR-035), then iterated: geometry first in the
  Solid look, then the ASCII shading; each round compared side by side with the reference panels at
  matched height (headless Chrome on the RTX 4090 over DevTools, the sim stepped with `__tick`).

**Done — look-dev (ADR-035):** model viewer angles 3/4 R, Right, Rear R / L; Spin (a turntable);
Sheet (ten live tiles: front, front 3/4, right, left, back, rear 3/4 ×2 at eye level and the gameplay
camera on his back / front / right side at ×2, read back in the new `lab.postRender` hook); looks
ASCII / Solid / Source / Lines (`U.uHeroSolid`: a clay render with alpha 0 that the ASCII pass passes
through).

**Done — the hero (ADR-034):**
- Lean `BODY` (chest 0.34 over a 0.23 m waist, shoulders ±0.16, slim limbs) on the same bones.
- Hair: layered pointed locks (crown spikes, top, two back layers hanging down with lifted points,
  nape flicks, side locks, a jagged fringe; the scalp cap's hairline under the fringe roots).
- Collar: lower and flared behind, points beside the jaw in front, a turned-over rim.
- Back: a yoke whose seams dip to a four-point star, a centre seam, the baldric (a strap round the
  torso in a tilted plane, right shoulder → left hip, buckle and ring), two belts.
- Pauldron: a ×1.3 stack (cap, band, two arm lames standing off the sleeve, claw blades).
- Coat: six panels: two back tails split by a vent, narrow side panels, front panels; `skew` keeps
  the vent / front edges straight while the outer edges flare, `slant` slopes the hems, piping on the
  vent and front edges, 12 strips (outer longest). Banded calves; slimmer boots and knee guards.
- Sword: the single-figure image's (broad base, long taper, hooked barbs, lightning notches, a guard
  swept up round a violet four-point star gem).
- Idle: the sword hung at his right side, out and forward-down; `dirLerp` sends near half-turns round
  the front (the light combo's finish → idle cut the sword arm's shoulder for one frame).
- Game-camera shading: blade far self-light 2.3 → 1.25 × far and HDR cap 1.8 → 1.3 (a tight glow),
  armour far fill / lines −25 %, the lavender torn zone's far fill 0.4 → 0.8.

**Decisions:** ADR-034 (lean hero, coat tails, idle at the right side), ADR-035 (look-dev tools).
The idle follows the turnaround, not the single-figure image's dynamic portrait stance: the user
gave the rear views equal priority, and from behind the portrait's diagonal blade was hidden.

**Verification:**
- Captures (session scratchpad `cap/`): every angle in Solid and ASCII at inspection scale, the
  gameplay camera at 36 m from the back / front / side / rear 3/4 (dark and in the grass), the sword
  face-on, reference-vs-ours side by side (back, rear 3/4, front, right), and every move (idle, walk,
  run, sprint, light 1, light 2, slam, charge + thrust, dodge) at key moments from the back, right
  side and front: the grip stays in the right hand, nothing passes through his body.
- Game camera, facing away: his lit area now matches the reference's at the same height (4357 vs
  4374 px; the broad build covered 6462); mean luma 74 (reference 55; baseline 79), dark share 49 %
  (reference 56 %, baseline 40 %).
- `herolook`: lean proportions asserted; the drawn blade never enters his body over 831 frames
  (closest 2.9 cm; the baseline let it sink ≤ 2 cm); it crosses a coat panel on 1 of 509 locomotion
  frames. `hero`: 6 panels / 12 strips, strip tips ≥ 0.1 m above the grass, the steel point ≥ 0.014 m.
- New Lab checks: the rear 3/4 + solid look, the turntable, the sheet overlay, a clean exit.
- `npm test`: ALL PASSED; `npm run build`: OK (see the PR).
- The DIE scenario's "dragon frozen while paused" failed once: the blade halo now spawns fewer
  particles, which shifts the shared `Math.random` stream the seeded wyrm AI rolls on, and the wyrm
  happened to walk on the Esc frame (which still runs on the pre-pause dt). The check now snapshots
  the wyrm after that frame.

**Open issues / next:**
- At the game camera he is still brighter than the scaled reference (the one-pixel silhouette line,
  kept for legibility on the grass); the hair has less volume than the reference's mop; the tails'
  dotted lavender rag along the outer edges is fainter; the face has no nose / mouth lines.
- The sleeve streamers are not in the new references (kept for now).
- The slash / slam FX look huge in close-ups (sized for the 36 m camera, known).
- Cosmetic FX share `Math.random` with the wyrm AI: give FX their own stream.
- Move the capture harness into the repo (carried over).
- **Next:** the owner reviews the PR preview (Lab → MODEL VIEW → Hero, Dark, Sheet / Spin / Solid).

---

## 2026-11-09 — Session 6: the epic wyrm fight (combos, the plunge, flights and fire, three phases)
**Owner:** the hero is "too lanky / skinny", and his sword always shows and clips through him, even
through his back from behind. The dragon needs far more attacks, epic fire spells, flying attacks and
fire from the air. A perfect dodge should put the hero on top of the dragon for a flying stab into
its head (the teleport behind it confused players). Enemy combos should be parried hit after hit,
like Sekiro / Phantom Blade Zero. The fight should be longer and harder.
**Owner's answers:** the head-stab is automatic on every perfect dodge in range; the fight lasts
3–5 min, is hard and has three phases; flying means short flying attacks; all four spells (meteor
rain, eruptions, flame walls / rings, an inferno nova).

**How:** a shared spec with four contracts (1 strings and the deflect chain, 2 the plunge, 3 hazards
and fire attacks, 4 three phases) and four worktree agents in parallel, each owning its files:
hero-look (`c3/hero-look`), plunge (`c3/plunge`), dragon-melee (`c3/dragon-melee`) and dragon-fire
(`c3/dragon-fire`). Base: `main` @ `8ce6aef` (PR #4, the reference match, merged). The lead merged
them into `combat/epic-wyrm` (`cbc3056`, `b528723`, `4020ad6`, `c6f4411`; the dragon-side plunge
scenario renamed `plungeReact`) and tuned the result (`64543ac`, `b3a69b3`, `1fe7f42`, `9fbf9fd`).

**Done — the hero:**
- **Broad build (ADR-031):** a `BODY` girth table on the same bones: chest 0.40 × 0.21 → 0.50 ×
  0.27 m, waist 0.27 → 0.31, hips 0.30 → 0.34, thick arms and legs, bigger boots, shoulders ±0.21.
  The sword hand aims from the old shoulder spot, so the grips are unchanged.
- **The blade is depth-tested again:** the depth pull (ADR-022) is gone, so the sword no longer shows
  through his back or legs. The coat yields to the steel (hangs inside the sword hand or drapes over
  it, latched per panel): blade-through-coat frames 156 → 25 over 23 clips.
- **The plunge (ADR-027):** a perfect dodge of the wyrm within 30 m of its head: vanish, hang 5 m
  above the head, dive, a reverse-grip stab (90 final damage, 40 posture), ride the head down,
  backflip to a visible landing in front of it toward where he came from, then the crit window.
  Out of range or against a fire hazard: slow-mo + crits in place. On a posture break, attack near
  the head for the **execution** (260). Plunge poses (hang, dive, ride, flip, three-point landing),
  cold FX, a dive whoosh and a skull-crunch impact.
- **Deflect chain feel:** parries in rhythm snap the blade to alternating sides, push him back a
  little, grow the clash and raise the clang a step each; the guard lingers between taps; "DEFLECT
  ×N" and "EXECUTION" call-outs.
- **Camera keep-in-view:** `cameraRig.keep` pans (and pulls back a little) so the hero and the head
  stay on screen through the plunge; the flow uses it to frame a flying wyrm.

**Done — the wyrm:**
- **Strings (ADR-026):** a data-driven string framework with ten hit kinds and seven strings: claw
  combo, rending flurry, hesitant maw (a held bite that baits an early parry), wing buffet, tail
  lash, pounce, frenzy (6–7 hits). A parried non-final hit is deflected (posture + a 0.14 s
  knock-back), the string goes on; the last hit's parry recoils it.
- **Plunge reaction:** `plungePoint` / `onPlunge`, the `plunged` reaction (the head slammed down, a
  thrash, the rise; in the air a fall and a crash landing first; an execution heavier, spending the
  break).
- **Three phases (ADR-028):** gates at 66 % and 33 %, transition roars that clear the hazards, a
  white-hot phase 3 that opens with the nova, per-phase tuning arrays, a generic weight-based AI
  selection, the Lab's Phase 3 button, boss-bar phase ticks, the phase-3 banner and music.
- **Short flights (ADR-030):** the burning pass, the sky dive, the hover barrage, with hover, glide
  and dive poses and the GLIDE / DIVE wing keys.
- **Fire spells and hazards (ADR-029):** meteor rain, fire eruptions (a phase-3 chase), flame ring,
  flame wall, inferno nova; a pooled hazard system with red ground warnings; 12 procedural fire
  sounds; all FX from world-atlas glyphs.

**Lead, after the merge:**
- A successful deflect re-arms the parry at once (ADR-032): a player holding the guard a moment
  between blows could not re-arm in time for the next blow of a string.
- Fire hazards no longer flash the red screen edge (a meteor rain pulsed the whole HUD).
- AI weights retuned: up close the stomp and the bite were ~2/3 of the picks. The dive and the hover
  barrage have no minimum distance, the strafe's is 7 m, the eruptions' 6 m, the breath works from
  4.5 × S. Close-range pick shares now: P1 strings ~60 %, bite / stomp ~40 %; P2 strings ~39 %, fire
  and flights ~35 %, singles ~25 %; P3 strings ~42 %, fire ~41 %.
- A new phase's abilities unlock one by one (`unlockStagger` [2, 2.5, 2] s); the nova opener is not
  delayed.
- HP 4200 → 4500; the plunge's hurt flash is capped at 0.45 (the hitstop froze its decay and washed
  the wyrm white).
- The airborne plunge in play: fire the wyrm breathes or spits from the air (the burning pass's
  strip front, the hover barrage's shells) spawns its hazard with `plunge: true`, so perfect-dodging
  it sends the hero onto the flying wyrm's head and it crashes (before, every blow dealt in flight
  was a no-plunge hazard and the crash was only reachable from the Lab). Spells from the sky or the
  ground (meteors, pillars, rings, walls) still never plunge. A deflect's instant re-arm is cleared
  on respawn.
- Tests: the opt-in `probe` scenario (ADR-033), the plunge's head damage exact, the eruption chase
  judged against each pillar's live window, the deflect re-arm assert, a perfect dodge of the burning
  pass plunging onto the flying wyrm (it crashes and fights on); the win scenario's pre-merge plunge
  emulation is gone.

**Decisions:** ADR-026 … ADR-033.

**Verification:**
- Per-agent headless GPU captures (deterministic boot, the game camera plus side / back / close
  views): `scratchpad/combat3/<agent>/` (hero-look `sheet_*`, plunge `plunge_*` and
  `deflect_chain_*`, dragon-melee `sheet_<string>_side/game`, dragon-fire
  `sheet_game_<ability>`).
- Merged captures at the game camera (`scratchpad/combat3/final/`): a live fight with the AI on, the
  plunge from in front, the sky dive with the flying framing, the dive and the barrage from the air,
  the phase-3 roar and the nova opener, and the hero's back / reference / side views.
- `npm test`: ALL PASSED on the tuned merge (0 console errors; 54 catalogued events, payloads match;
  glyph check 218 literals, bad = 0). New scenarios: `plunge`, `deflect`, `strings`, `plungeReact`,
  `timing`, `fire`, `herolook`; `win` now runs three phases. Highlights: every string contact
  within ±85 ms of its flash + lead (worst 67 ms, 661 placements); every fire blow within 17 ms; the
  plunge deals exactly 90, lands in front of the head and keeps both on screen (also onto a flying
  wyrm and through the leap); the blade never sinks > 2 cm into the body (831 frames).
- `npm run build`: OK (1402 KB).
- Difficulty (integration bots; the probe ran at 4200 HP, 4500 adds ~7 %): a 95 % probe bot wins in
  145–150 s, 85 % wins 1 of 3 (129 s) and dies 2 of 3, 70 % always dies; the god-mode `win` bot at
  4500 HP wins in 157.5 s (P2 at 51 s, P3 at 91 s; 44 of 46 parries, 26 deflect chains, 24 plunges,
  posture breaks at 25 s and 87 s).

**Open issues / next:**
- **Playtest:** a human playtest is needed. The bots heal poorly, so the probe's death rates are
  pessimistic; the 3–5 min target is inferred from the bots.
- **Hero:**
  - his mass reads only modestly at the game camera (the wide skirt dominates the outline)
  - from behind, the low idle guard now shows only the point
  - 25 coat-crossing frames remain (near the hilt; the torn strips and sleeve streamers ignore the
    blade), the coat swings more in runs, the block's free hand doesn't brace the flat
  - over the wyrm at the game camera the plunging hero reads mainly through his cold tint and the
    cyan blade
- **Wyrm:**
  - the tail "jab" is a lash, not a thrust (needs a tail-raise control in the rig)
  - the wing buffet's range band is narrow (6.8–8.3 model units)
  - later string hits can whiff a hero who doesn't move (the frenzy's 4th–6th hits land on 13–17 of
    33 placements)
  - the overhead claw is hard to read at the game camera; the deflect knock-back is a small 0.14 s
    offset
  - the meteor cast has no red windup glow of its own; the dive hovers at 13 m and the barrage at
    9 m (spec 14 / 8)
  - the phase-3 eruption chase is verified in the sim only
- **FX:** the clash bloom is large in synthetic captures (the wyrm's parry spark can land on the
  hero's chest; in real fights it is at the claw).
- **Carried over from session 5:** the capture determinism leak, the stray `"` glyph particles, the
  hero's coat drape and face, the boss camera in melee, the wyrm's letter boil.
- **Next:** open the PR from `combat/epic-wyrm`; the owner plays its preview and approves; tune from
  the playtest; then cut the release (the reference match is merged but not released yet).

---

## 2026-11-08 — Session 5: the reference match (wyrm and hero look and motion)
**Owner:** "i want you to focus on making the dragon and character look as identical and good as
the attached reference images and make sure the animations and movement look great." Attached: a
red-black ASCII dragon and the "Shadow Swordsman" ASCII line-art hero.

**How:** two rounds, each with four worktree agents (dragon look, hero look, dragon motion, hero
motion), merged into `look/reference-match` (draft PR #4).
- **Round 1** (`main..f66017b`): each build agent was followed by an independent reviewer that scored
  it and added a polish pass. Scores after polish: dragon look 6, dragon motion 7, hero look 6, hero
  motion 7.5 (out of 10).
- **Round 2** (merges `ca69453`, `fc44cf4`, `c8f61c9`, `419a6ca`, from the lead's review of round 1)
  was **stopped early** because the owner wanted to wrap up:
  - hero look (self-score 6) and hero motion (7) finished and reported, tests passing
  - dragon look and dragon motion were stopped near the end, before their final self-report; their
    commits are merged (the commit messages are the record) and the full suite passes on the merge
  - none of round 2's review / polish passes completed; the hero ones were stopped mid-way and their
    unfinished edits discarded (saved as `scratchpad/look/hero-look-polish-unfinished.patch`)
- **Lead fixes after the merge:** the blade's halo dots and tip streak sit on the drawn point
  (`DIM.drawnTip ?? DIM.steelTip` in `player/fx.js`); the dead generic `artCell()` pass function,
  its `uArtCount` uniform and the unused `createArtAtlas` import are gone from `pipeline.js`.

**Done — the wyrm:**
- **Letters (ADR-018):** a thin one-pixel 4x6 font in 5x8 cells (`wyrmGlyphs.js`; 3x5 in 4x6 cells
  under 900 px tall). The v0.4 bold browser font filled its cells and printed a "silver blob".
  Letter sets by brightness tier with a per-cell letter, so letters hold still; stroke pixels take
  their own source pixel; structure codes in alpha (`0.5 + 0.01 × code`) and marching-squares
  silhouette strokes keep spikes, claws and torn edges.
- **Art source** (`wyrm` material option): charcoal shingle scales with bright free edges lit by a
  camera-fixed key light, greyed moonlight, molten cracks along the scale gaps on the undersides only
  (round 2; round 1's voronoi net drew red worms over the back), gold-rimmed orange chest and throat
  scales, crimson mottled sails with holes, torn edges, hot bone streaks and ember specks (`aEdge`,
  new `aBone`). Round 2: hide outlines by letter brightness only (rim strokes printed chevron noise),
  cooler cracks on the legs and tail.
- **Shape:** a 1.3× head (visual only, about the mouth) held low with the jaw open in a snarl, eagle
  feet with hooked talons, legs ~15 % thicker, a heavier tail, spiky crest / frills / saw tail,
  longer distal finger bones and fuller sails.
- **Motion:** flip-free joints and IK, feet planted through turns, the tail sweep's spin, the roar
  and the walk (turning in place 1.41 → 0.01 m of foot slide; roar / intro 0.7–2.6 → 0–0.33 m), the
  stomp's paws on the impact frame, the
  painting's resting display (HALF sails fitted to read broad from every game-camera yaw, an S-neck
  with the head low, a stalking stance, the arched tail, idle life). Round 2 (ADR-025): the shown
  neck spreads a strike down its length with the head pinned to the measured solve, the bite eases
  into its strike over the last windup frames (`headLead`), a head-aim turn limit except where
  spheres ride on the head (`headExact`), a parry recoil on an arc, swinging feet that absorb home
  jumps, a tail that can't fold over, and a death that falls with weight (feet planted, wings
  crumpling onto the ground).

**Done — the hero:**
- **Ink-line art (ADR-019):** part ids in alpha (`HERO_ART`, `HERO_INK`), bright lines on
  silhouettes, depth steps and part edges over dim, dense letters. Round 2 traces the lines per
  pixel (ADR-020: no letter-grid staircase), and at the game camera he is a dark figure with a dim
  cool rim, bright armour and a crisp cyan blade, cut out of the grass by a dark halo (ADR-021).
- **Blade (ADR-022):** drawn 1.64 m (`DIM.drawnTip` 1.45; the animator keeps `DIM.steelTip` 1.17)
  with a ridge line and serrations; drawn up to 0.65 m nearer the camera at the game camera, so the
  low guard reads from behind.
- **Model:** coat drapes with folds and a lavender torn zone, wider hems, kite greaves, a bigger
  spiky pauldron, a fuller mop, the face shows, more key light and contrast.
- **Motion:** speed-matched gait and a world-space foot planner, blade blending round the outside
  of the body (ADR-023), the portrait's wide contrapposto idle, light 1 cocking over the right
  shoulder, the slam's gather-and-raise windup, finish holds, the charge's coil with a coat updraft,
  a two-step thrust dash, the roll's intended sliding kneel with dust and sparks, one continuous
  slash crescent, a snappier turn, sprint hair blow-back, quiet guard taps, a shorter stagger jolt, a
  flask swig that reads from behind.

**Decisions:** ADR-018 … ADR-025. The common rule (ADR-024): look and motion polish never moves a
hit-tested frame. Hero attack active frames are bit-identical; the wyrm's attack spheres stay
within a few cm; visual size changes hang off the gameplay joints.

**Verification:**
- Deterministic headless captures on a real GPU (the real-time loop frozen, `Math.random` seeded,
  audio off), compared with the references by pixel statistics (luma shares, ink / bright %,
  white / orange / red mix) and by eye: the reference angles, side, front, back and head views, the
  1080p game camera, a live fight, and per-action strips. The owner got before / after images for
  both rounds.
  - wyrm, reference view: lit-ink colour mix white 43 / orange 23 / red 35 % (painting 41 / 22 / 37)
  - hero, reference view: mean luma 106 (reference 108), 37 % of pixels above 120 (38 %)
  - hero at the game camera, facing away: mean 113 → 80 (the scaled reference is 56)
- Gameplay, per frame in seeded Lab runs: the hero's blade matrix and hit points on 192 hit-tested
  frames, 0 differ; the wyrm's attack spheres within a few cm (round 2: ≤ 4 mm, the rake 2.3 cm);
  first contact unchanged except three swipe placements that now land, and the tail sweep no longer
  lands before its red flash (0 of 24 probes; v0.4: 5). COMBAT.md has the numbers.
- `npm test`: ALL PASSED (glyph check bad=0) on the merged code; `npm run build`: OK (1293 KB).

**Open issues / next:**
- **Process:** no round-2 review pass ran; the round-2 dragon work has no self-report. Review it (or
  have the owner play the PR preview) before merging.
- **Determinism:** captures of the merged code are no longer bit-identical run to run (two runs of
  `scratchpad/look/steps_final.mjs` differ by small pose and timing amounts), so a time or random
  source leaks into the sim. Find it before trusting before / after compares again.
- **FX:** stray `"` glyph particles show left of the hero in a back view; source unknown.
- **Hero:**
  - the coat still reads as separate flat panels with outlines, not one ragged drape with holes
  - proportions are round 1's; the hair is straight clumps; the face has no nose, mouth or shadow
  - at the game camera he is still brighter than the scaled reference (80–97 vs 56: blade glow,
    rim, the armour column), and the capital fill letters can read as text
  - the halo does not darken the wyrm's letters; the reference-angle idle is near frontal
  - strike key poses are limited by the bit-identical rule; light 1's loop is fast (a longer
    windup would be a tuning call); light 2 has no free-arm choreography; the knockdown's blade
    swings wide; the thrust's legs hide under the coat at 36 m
  - the foot-slide metrics were not re-run on the merged wide idle
- **Wyrm:**
  - at the reference angle the sails sit lower than the painting's, and with the hero straight
    ahead the far wing is a sliver behind the neck
  - in melee at 16:9 the head, neck and wings are mostly off the top of the screen (boss camera)
  - some fast motions still jump far per frame (charge thigh, bite neck); close-ups show large
    flat scales; letters change on ~39 % of lit cells per frame at idle
- **Tooling:** the capture and per-frame compare tools (deterministic boot, blade compare, hitbox
  compare) live in the session scratchpad; move them into the repo.
- **Next:** the owner reviews PR #4's preview; on approval, merge and release.

---

## 2026-11-02 — Session 4b: the hero shows his details in game
**Owner:** "everything is perfect but the main character isn't showing the details like it does in
your preview pictures", with a screenshot (~13 rows of dense `MMBM` letters) and the reference again.
"Do we need to make the character a little bigger?"

**Measured:** the hero was ~9 visible rows at the 36 m camera (1038 px tall) and ~5 on a phone (20 m,
390 px, 4x7 cells). The reference is ~90 rows. Tuned by the bonfire, his source was too bright (all
dense letters); in the arena it was 40 % darker.

**Done:**
- **Bigger on screen, gameplay unchanged (ADR-017):** `HERO_SCALE` 1.2 + a camera lean (half the
  camera pitch, feet planted), applied after the animator. `unlean()` for the sweep's hit test and
  the dragon's aim; `leanPoint()` for the name tag; the run cycle slows by `HERO_SCALE`.
- **Hero letter grid:** `createPixelArtAtlas` (3x5 pixel font, 4x6 px cells); the pass tests the
  hero grid first. Browser fonts at 5–6 px filled whole cells (tried: solid blocks).
- **Shading:** `U.uArtHeroKey` 1.15 (fixed key light), `U.uArtHeroEdge` 0.7 (darker toward the
  silhouette, no moonlit outline on the hero), `uArtBlack.x` 0.04, `uArtLum.x` 3, `uArtMin.x` 0.14,
  `uArtDither.x` 1.1, `uArtEdge.x` 0.004 (0.018 never fired at 36 m).
- **Phones:** an upscaled canvas uses `image-rendering: pixelated`.
- Result: ~25 rows at the desktop camera (front, back and running all read as the swordsman), ~15
  on a phone; the Lab close-up keeps the reference look. `npm test` green.

**Released:** owner: "push out all the changes to production including the mobile controls".
PR #3 squash-merged as v0.4.0 (classic ASCII-art creatures, touch controls, phone camera, Lab
toggle, hero detail).

**Open issues / next:**
- Real-phone check of the pixelated upscale (non-integer DPRs such as 2.625 give uneven strokes).
- The lean follows the camera: cut-in cameras get half their pitch.

---

## 2026-11-02 — Session 4: classic ASCII-art creatures
**Owner:** "Make the character and dragon look more ASCII like. Right now it doesn't have the ASCII
art style." They attached two reference images (a dragon and a hooded figure as coloured
image-to-text art) and chose smaller letters over zooming the camera in.

**Done:**
- New `FLAG.ART` class and creature ASCII-art path in the pipeline:
  - a finer grid than the world's (H/135 px cells: 4x7 at 720p, 5x8 at 1080p)
  - 4-sample cell average
  - a density-sorted `ART_CHARS` atlas built at runtime
  - brightness → letter with per-cell jitter, colour = source hue, HDR only for saturated parts
- Creature materials default to `FLAG.ART` with a smooth shaded source (`U.uArtSolid`). Per-material
  `artGain`: wyrm 0.28, hero 0.62.
- Tuned in the Lab model viewer (close-ups) and at the game camera (`uArtLum` 4.5, `uArtMin` 0.3).
  Red tells and the stomp ring read in ASCII.

**Follow-up (same day):** the owner said the dragon looks good but the hero "looks like a bunch of
random text". They also couldn't close the Lab on their phone, and asked for touch controls.
- **Hero:** own pass settings via `FLAG.ART_HERO`:
  - `artGain` 1.1
  - jitter 0.5
  - ramp floor 0.42
  - depth-edge gaps (`uArtEdge` 0.018)
  - `uArtMax` 0.8, so white letters don't bloom

  It now reads like the reference figure.
- **Phone (agent):**
  - touch layer on `core/input.js`
  - an ASCII stick and buttons with auto-aim
  - a phone camera profile (20 m), LOW quality on phones, a compact HUD
  - a rotate overlay
  - the Lab `LAB` / `× LAB` toggle
  - a `touch` test scenario
- **Decisions:** ADR-016.

**Open issues / next:**
- Real-phone check:
  - native multi-touch
  - iOS long-press and scroll blocking
  - audio unlock on the first tap
  - LOW quality look and frame rate
  - whether rim-sprint triggers by accident
- At the desktop game camera the hero is still a small letter cluster.
- Characters re-pick as creatures move (inherent to the style).

---

## 2026-11-01 — Session 3c: match the concept sheets (four-legged drake)
**Owner:** "The character hair and outfit doesn't look like the images. The dragon as well. Try to
get it accurately as close as possible." They chose to rebuild the dragon as four-legged.

**How (ultracode workflows):**
1. **Prep workflow:**
   - a Lab model viewer (side views, dark backdrop)
   - specs measured from the sheets (`docs/art/hero.md`, `docs/art/dragon.md`)
   - baseline art-director review: hero 2.5/10, dragon 2/10
2. **Build workflow:**
   - a material upgrade (`levels`, `glowAxis`/`inkAxis`, voronoi cracks, `seamAxis`)
   - parallel hero and dragon chains: the dragon in two stages (anatomy/gait, then the
     four-legged moveset), each followed by independent critic → fix rounds
   - the owner asked to finish sooner, so the loop was capped at one fix round plus a final review
   - integration verify, then side-by-side review boards
   - two usage-limit interruptions were resumed from the workflow journal with no work lost

**Results:**
- **Dragon: 6/10.** Silhouette 7, proportions 7, game read 6; no P0 left.
- **Hero: 4.5/10.** Glyph rendering 6, poses 6.5. Remaining P0s: the hair mass, and the blade
  hidden from behind at the game camera.
- **Verify fixed:**
  - the tail sweep landing 0.2 s early from straight behind (fairness)
  - membrane per-frame garbage
  - hero glyph zoom at the game camera
- **Verify flagged:**
  - clawCombo hits 2/3 tell→impact is 0.65 s, below the 0.7 s rule (pre-existing)
  - the AI rarely picks swipe/fireball/charge against a stationary hero

**Boards:** `scratchpad/art/final/*.png` (sent to the owner).

**Next:** the owner reviews the boards. A focused hero round (hair, blade read, details) is the
obvious follow-up.

---

## 2026-11-01 — Session 3b: copy the concept sheets; carved stones
**Owner feedback:** "much better". They then shared concept art (Shadow Swordsman sheet,
movement and combat key poses, Obsidian Drake sheet) and asked to make the hero and dragon look
like it. They also want better ground stones.

**Their choices:**
- restyle the wyvern (don't rebuild it as four-legged)
- make it 1.5× bigger
- the heavy slam becomes the 3rd hit of the combo
- carved crisp glyphs for stones

**Done:** three parallel agents (hero, dragon, stones) did the work, then I integrated it.
- **Hero:**
  - new model, a 1.34 m sword with a violet gem and cyan edges, and poses from the sheets
  - slam finisher and lunge thrust
  - cyan arc trails, thrust streak and crystal shards
  - reach band + step-in assist (REACH test)
- **Wyrm:**
  - obsidian / silver chevrons, lava belly, throat and inner legs, red ragged wings
  - horns, frill and spikes (merged per joint, 109 meshes)
  - upright S-neck
  - `SCALE` 1.875, with an audit of bound, bite floor, swipe reach, FX and test distances
- **Stones:** `createCarvedGlyphMaterial` (world lattice perpendicular to the camera view). Flagstones
  are irregular half-sunk slabs with grass up to their edges. Fixed the fallen stones' colliders.
- **Me:** capped the agent's boss framing zoom from +16 m to +5 m. At ~50 m the hero was lost
  again; it now sits at 39–41 m and the wyrm crops at the edges.

**Decisions:** ADR-012 (concept sheets + carved stones), ADR-013 (reach band, hero-first camera).

**Open issues / next**
- **Lava underside:** mostly visible when the wyrm faces the camera or rears. A normal-driven
  underside glow mask in the material would put it on a single mesh.
- **Cracks:** a regular grid; an irregular (Voronoi) crack pattern would read more like fissures.
- **Hero coat:** tail strips move as panels, not individually. The dodge is a forward roll, not the
  sheet's sideways dive.
- **Carved marks:** some digits (`1`, `7`) can read as text on the stones; consider symbol-only ramps.

---

## 2026-11-01 — Session 3: look pass from the v0.2 review
**Owner feedback on v0.2 (live):**
- The grass is TOO ascii: noisy, distracting, and the ground seems to move, which makes the game dizzy.
- The main character is barely visible, and the hero and dragon are blurry.
- No PARRY / DODGE text notices: dodge-only attacks should be a red warning flash from the boss,
  and parryable attacks should be read from animation.

They want previews to approve. Their answers to my questions: v0.1 grass but calmer; crisp surface
glyphs for the creatures; a brighter outline to find the hero; red flash + white glint tells.

**Done**
- Grass: restored v0.1 `world/grass.js` / `ground.js` / world wiring / quality presets; tips ~20 %
  darker; wind amplitude 0.07 → 0.04 and slower. Removed the grass path from the ASCII pass.
- Creatures: `createSurfaceGlyphMaterial` is surface-glyph by default again. It uses `SURFACE_SETS`
  defaults per `ascii` set, `glyphZoom` 0.72, sharpened coverage, darker gaps and an `outline` term
  (pow 6 falloff; a wide falloff shaded the coat flare like plastic).
  - Wyrm: cells = v0.1 × 1.3, `lumScale` 3.3–3.5, lit gaps, no outline.
  - Hero: cells 0.045–0.12 m, coat ink brighter, outline 0.8–1.7.

  Tuned live against v0.1 (scratch worktree at `v0.1.0`) and v0.2 (production).
- Tells (sub-agent): text/icon marks and log tips removed. The wyrm drives `uWarn`: red glow through
  a red attack's windup and a hard red flash at the timing cue. Parryable attacks get a white glint
  (bigger for blue). See ADR-010 and COMBAT.md.
- Lab: Showroom + Camera default buttons.

**Decisions:** ADR-010 (tells on the attacker), ADR-011 (hybrid rendering).

**Open issues / next**
- Owner approval of the previews; then merge and release v0.3.0.
- The hero is still small at the default zoom (the owner chose outline only, not a closer camera).
- Not yet done: wind-up animations exaggerated for parry reads, if the glint alone isn't enough.

---

## 2026-11-01 — Session 2: combat & presentation pass (v0.2.0)
**Goal:** the owner's v0.2 feedback (see Session 1) plus a long-term repo/deploy setup.

**Done**
- GitHub repo `eshin087/gcd` (public) + Vercel project `thegcd` (Git integration, `main` =
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
**Goal:** a first demo of the ASCII look (camera, art style) with a dragon in a forest.

**Done**
- Set the look: steep top-down perspective camera, three glyph
  techniques (arranged strokes, screen-grid ASCII, glyph FX), night palette, fire light spill.
  Findings in `docs/STYLE.md`.
- Built the rendering foundation + world; checked via screenshots.
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
