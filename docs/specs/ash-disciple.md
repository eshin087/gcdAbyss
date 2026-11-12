# Spec — The Ash Disciple: a second level, a human duelist boss

Status: **built** (2026-11-11), branch `level/ash-disciple`; the reward is the next PR. The numbers
below were the **starting values**; what was built and measured is in `docs/COMBAT.md` → "The Ash
Disciple" (HP 3000, break crit ×1.5, guard crush at posture 48, a windup guard, first windups 0.78 s).
Tune them in the Lab and keep them in the disciple's `tuning.js`, never in logic.
Read with `docs/COMBAT.md` (the tell rules and the fairness checklist) and `docs/ARCHITECTURE.md`.

## Owner decisions (2026-11-11, do not re-open)
| Topic | Decision |
|---|---|
| Direction | A **skill boss rush** in the Phantom Blade Zero vein: wuxia combat, bosses tested one skill at a time, some exploring and RPG elements. |
| Setting | **Both** the wuxia combat and the fiction (sects, robes, wandering swordsmen). |
| Progression | **Fixed rewards**, no XP levels or random loot tables. Loot adds techniques, abilities and elements so the player can change their combat style. |
| First new boss | **The Ash Disciple**: a grey-robed **jian** swordsman with a straw douli hat. Built on the hero's skeleton, but his moves **do not mirror the hero's**: he has many movesets of his own. |
| His guard | **Guards and counters**: he deflects strikes into his front, they build his posture, and after a few he counterattacks. |
| Reward | **Not in this PR.** This PR is the level, the arena and the duel; the technique system (slots, a meter, an equip screen) with his technique is the next PR. |
| Arena | **A ruined sect courtyard**: start at a bonfire, a short path up through burned trees and broken steps, the duel on a flagstone courtyard under falling ash. He waits kneeling in the middle. |
| Testing | Loadable on its own: `?level=ash` in the URL, a picker on the title screen, a Lab button. |

## 1. Levels
`src/levels/index.js` is a registry of level definitions; one level is built per page load.
- `?level=<id>` picks it (`cinderwood` default, `ash`); an unknown id falls back to the default.
- A level carries: `id`, the area `name` and `sub` line, `world` (overrides merged into
  `CONFIG.world` at boot, before any module is built: spawn, bonfire, the boss's resting spot,
  trigger line, bounds), `buildSet(U, colliders)` (the static environment; returns the forest's
  shape), `createBoss(game)`, the flow's texts (lore lines, phase banners, the victory banner)
  and the atmosphere's look (falling ash on or off).
- Switching level reloads the page (a clean boot; nothing has to be torn down).

**The boss slot.** `game.dragon` stays the name of *the current boss* (the wyrm or the disciple),
and `game.boss` is the same object. The boss events keep their `dragon:*` names. Every module that
reads the boss (player, HUD, flow, camera, audio, name tags, minimap, touch aim, Lab) keeps working
untouched as long as the boss offers the Dragon contract's surface. A rename to `boss:*` is its own
refactor later (it touches ~14 files and collides with the parallel wyrm work).

## 2. The courtyard (`src/world/courtyard.js`)
South to north (the player walks north, −z):
- the bonfire on a scorched landing at the bottom of the slope, burned trees round it;
- a path of half-sunk flagstones climbing between dead trees and toppled stones, then rows of
  broken steps (carved slabs) up to a broken sect gate (two pillars, a fallen lintel);
- the courtyard: a square of flagstones ~30 m across, ringed by broken pillars and stone lanterns
  (colliders), a cracked incense urn; burned trees and stumps beyond;
- falling ash flakes over everything (atmosphere), grass thin and grey, the bonfire's warm light.
Everything goes through the existing glyph materials (carved glyphs for stone, the AsciiObject
material for trees and props). Colliders keep the duel inside the courtyard once it starts.

## 3. The Ash Disciple
**Look.** The hero's skeleton and animator, new gear: a wide straw douli hat with a short veil, an
ash-grey long robe (crossed collar, wide sleeves, a sash, the skirt split front and back on the
coat springs), cloth wraps on the shins, a slim straight jian with a red tassel on the pommel. The
blade is pale steel; in phase 2 it smoulders ember orange. He is drawn the hero's size.
*Revised 2026-11-12 (owner, ADR-062):* the hat smaller and without the veil, the jian long and slender
(a 1.28 m tapered blade, disc guard and pommel, a banded grip), held in a high guard (the sword hand
by the temple, the blade slanting down at the hero); the duel's moments (the full deflect, the blade
lock, the mikiri, the cinematic) and a faster pace: docs/COMBAT.md → "The duel's moments".

**His own animation.** The animator accepts an extra pose table per instance (`HeroAnimator(rig,
pilot, poses)`); the hero's table and behaviour are unchanged. His stance is a jian guard: the
blade forward at chest height, the free hand raised in a sword-finger (since the rework: the high
guard). His moves are **keyframe
data** (`moves.js`: per move, keys over its windup / active / recovery for the body, the sword
hand, the blade direction, the free hand and the feet), so new moves are data, not code.

**Rules** (in `COMBAT.md` once built):
- Every hit has a tell and a glint `flashLead` 0.35 s before impact; first windups ≥ 0.7 s in
  every phase; a string's hits ≥ 0.45 s apart; red hits glow red through their windup.
- **Feints never glint.** A feint is a windup that never lands; only real impacts flash.
- **His guard.** Outside his attacks (footwork, idle, after a 0.25 s raise delay at the end of a
  recovery) his guard covers his front (±75°). A strike into it deals no damage, adds posture
  (light 8, heavy 20) and clashes. Each guarded strike makes a counter likelier (0, 35, 70, 100 %
  on the 1st–4th); the counter is the Riposte string. A fully charged thrust crushes the guard (a
  0.8 s stagger: an opening). Strikes from his flanks or back, or during his attacks, land.
- **The openings**: punish his recoveries, parry a string's last hit (recoil), perfect-dodge him (the
  Ghostep blinks behind him: his back is open), break his posture.
- **Posture break → execution.** Broken (3.2 s, on one knee), an attack within 3.2 m executes him
  (260 final damage, he crumples and rises; the break is spent).
- **Two phases.** P1 100–50 %, P2 50–0 % (the gate holds damage at 50 % until the transition). The
  transition: he kneels, the blade kindles, a red shock ring (dodge it or be out of it).

**Moves** (P1 timings; N normal, B blue, R red; damage before any scale):
| Move | Hits | Notes |
|---|---|---|
| Plum Thrust `plumThrust` | N 0.8 (18) | a lunging thrust from 3.5–7 m |
| Falling Ash `fallingAsh` | B 0.95 (26) | a two-handed overhead chop with a step |
| Swallow Flicks `swallow` | N 0.75 (14) · N 0.48 (14) · B thrust 0.55 (20) | |
| Crane Spins `crane` | N spin 0.8 (15) · N spin 0.5 (15) · B leaping chop 0.65 (24) | |
| Hesitating Blade `hesitate` | feint (no glint) · B thrust 0.6 + hold 0.2–0.7 (22) · 50 %: N flick 0.48 (14) | the hold baits an early parry |
| Lotus Sweep `lotus` | R 0.9 (22, knockdown) | a low spinning sweep, red ring r 3 m |
| Wind Step `windStep` | N 0.85 (18) | a gap closer from 6–12 m: he dashes in and cuts |
| Ash Crescent `ashCrescent` | N 0.8 (14) | sword qi along the ground from 6–16 m (P2: a fan of three) |
| Riposte `riposte` | N 0.7 (16) · B 0.5 (22) | only as a counter from his guard |
| Thousand Needles `needles` (P2) | N 0.8 · N 0.45 · N 0.45 · N 0.45 (10 each) · B 0.55 (18) | |
| Ember Whirl `emberWhirl` (P2) | N spin 0.8 (14) · N spin 0.5 (14) · R burning spin 0.75 (26) | advances with each spin |
| Heaven-Splitting Fall `heavenFall` (P2) | R 0.8 + 0.7 air (30, knockdown) | a leap; the red ring follows you, then locks 0.5 s before he lands |

Footwork between attacks: he circles at 3.5–6 m with his guard up, walks or runs in when you
are far, backsteps after being cut twice in a row, and may sidestep a charged thrust.

**Numbers to start from:** HP 2000, posture max [320, 380], regen after 2.5 s at 20 / s,
P2 windups × 0.92 (first windups authored ≥ 0.78 s), idle gaps P1 0.5–1.1 s, P2 0.3–0.8 s.
Target: 1.5–2.5 min for a player who knows him; the first boss of the rush is easier than the wyrm.

**Intro and death.** He kneels in meditation facing the gate. Crossing into the courtyard, coming
within 9 m or striking him wakes him: he rises, flicks the jian and gives the fist-and-palm salute
(~2.8 s), then the duel starts. Defeated, he sinks to his knees, plants the jian and dissolves
into ash that drifts up.

## 4. Player side
- A perfect dodge against him is the v0.2 **Ghostep** (he offers no plunge): a blink 3.2 m behind
  him, the slow-mo and the crit window.
- **The execution against a duelist**: with a broken boss that offers `onExecute` (no plunge
  API) within its `execRange`, an attack press starts a lunging execution thrust; its impact calls
  `boss.onExecute({ damage })`.

## 5. Tests (`tests/integration/duel.mjs`, its own file; `npm test` runs it)
Level registry and URL parsing · the move data rules (a tell per hit, windups, gaps, feints
without flashes) · timing (every move's contact within ±85 ms of flash + lead from its AI band) ·
the guard (front guarded, back lands, counter after guarded strikes, a full thrust crushes it) ·
the deflect chain and recoil · the Ghostep behind him · break → execution → rise · the phase gate
and the P2 unlocks · a defender bot wins; no NaN, no console errors.

## Out of scope (next PRs)
The technique reward and its system (slots, meter, equip screen); mobs on the approach; a hub that
links the levels; boss-rush mode (back-to-back refights, timer); the rename of `dragon:*` to `boss:*`.
