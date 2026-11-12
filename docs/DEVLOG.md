# Dev log

Chronological session notes — newest first. Each entry: date, goal, what changed, decisions,
verification, open issues / next steps. Keep entries short; link commits/PRs when available.

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
