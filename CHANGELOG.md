# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [SemVer](https://semver.org/) (0.x = pre-alpha, anything may change).

## [Unreleased]
One hundred and fifty-one pieces of work since 0.4.0:
- **Every blue blow ends in a deathblow, with weight** (2026-11-28, ADR-294). *Changed (the owner: "every blue attack
  except the dragon to do a deathblow", "get rid of the deflect", the deathblow "weighty, impactful and going through"):*
  a parry of any BLUE blow of a body or a blade, from every boss but the wyrm and wherever in a string it comes, is
  answered by the deathblow (a ring of force parried at its edge: the first blow runs in, up to 10 m); blue projectiles,
  beams and casts are not (they fly back as before; a new hit field `ranged`). Halcyon's parried blue flying blows beat
  him out of the air in front of the hero instead of the crash into cover (the crash stays for a perfect dodge of a red
  one, and with `?parryRiposte=old`). The word DEFLECT is gone from the hero's side: a blue parry reads PARRY, parries in
  a row PARRY ×N, the full deflect PERFECT PARRY ×N (the rules are unchanged: a white blow mid-string is parried and
  the string goes on). The deathblow's new default look, `?dbfx=e` (WEIGHT): a hit-pause that grows 0.10 → 0.24 s, a
  0.55 s hold on the finisher, wound up 0.34 s and followed through slowly; every blow drives him back further (0.28 →
  0.55 m) and kicks the camera harder; at the contact only a short bite of letters where the blade crosses him, a small
  flash, the tip out of his back and his blood thrown out of it to land as pools; no contact burst, edge flash or cleave
  ring, no cold cast on the screen. `?dbfx=b` gives back Shatter Web and the timing before.
- **The Cinder Wyrm's feet stay planted as it dies and as it wakes** (2026-11-28, ADR-293). *Fixed (the owner: "fix the death and wake foot sliding next"):* while
  the body sank to lie down in the death or rose in the wake, its hind toes slid up to 0.3 m forward and back over
  the ground (0.6 m in all in the death, 0.4 m in the wake) and a forepaw settled 0.1 m off where it stood. The
  hock and the wrist are now always a bone's length from the toe, so the toe drawn at the end of that bone lands on
  its planted spot: the death's feet slide 0.05 m, the wake's 0.06 m. `?wyrmFix=0` as before.
- **The Cinder Wyrm moves like a living animal** (2026-11-28, ADR-281). *Fixed (the owner: "fix them all", from a frame-by-frame audit of all
  59 of its moves and states, `integ wyrmmotion`):* its wings no longer go through the ground (finger tips went up
  to 3.2 m under it in the wing buffet, the sweeps, the slams, stagger and the posture break; 17 moves → 0); its
  paws, hind feet and head no longer jump metres in one frame between blows (the feet's lead along a lunge was
  eased; bites start their snap as the body surges, swung round the neck's base, still on the beat); the head
  stays on its neck's line (75 - 104° off it in bites and the pivot lash → at most ~70°) and out of the ground and
  its own chest in the dives; turns speed up instead of jumping to full speed; the tail no longer folds 70 - 90°
  where it meets the ground (37 moves → 2); the resting neck has no kink; wing sweeps pivot at 170°/s, not 260;
  the feet plant where they land instead of skating; a foreleg lying on the ground bends up, not through it; the
  sky strafe's landing brakes from its pass speed. A bite connects no sooner than 0.06 s before its cue's impact
  (as it already could not land later than 0.07 s after). The incantation of the kamikaze wisps is a circle on the
  ground under the wyrm like every cast (it hung beside it before its jaws and followed the head about like a thing
  of its own), and a circle cast round its feet stays under it while it burns. `?wyrmFix=0` moves it as before (the
  Lab's `wyrmFix` row). Still to do: the tail sweeps and whips spin the body ~700°/s (a slower spin needs to be
  aimed at the hero to keep its hit on the beat), and the feet still skate in the death and the wake (since fixed: ADR-293).
- **One kind of parry** (2026-11-28, ADR-279). *Changed:* every parry is now a perfect parry, anywhere in the
  parry window: the same look, freeze and rewards every time (more posture damage, the counter cut, a bullet sent
  back, a count toward the deathblow). Before, a press 0.20 - 0.22 s early was a plain parry with a different look.
  So Bai Wuji's barrier now opens on every parry, and every parried shot flies back at the one who fired it.
  `?parry=two` gives the two kinds back (the Lab's `parry`).
- **A tenth level: the Last Foundry and the False Saint** (2026-11-28, ADR-285 – ADR-288). *Added:* a tenth level,
  `?level=foundry` (also `saint`, `falsesaint`, `anselm`, `mill`, `machine`; the title screen lists it and the boss
  rush ends there). **The Last Foundry**: a steel mill at the end of a war with the machines, at night, still running
  with no one left to feed it. A casting floor of 400 riveted steel plates, 30 m across; the pour, an open channel of
  molten steel, along its north edge; four ladles of molten steel hung from jib cranes; a forging press; a conveyor
  line carrying unfinished plated frames; the blast furnace beyond the pour; columns, pipe racks venting steam, gas
  tanks, ingots, girders, slag heaps, a catwalk, broken walls and a wreck field past them. Everything breaks (492
  pieces) but the bonfire, the furnace's body (it chips) and the pour's kerb. A ladle cut down or broken spills a
  molten pool that burns whoever stands in it, him too; a broken gas tank burns 0.9 s (a red cue) and bursts. The
  light follows his phase: a quiet furnace glow; cold, with warning lamps; red alarm light and a turning beacon; the
  furnace roaring, sparks raining. **Anselm, the False Saint**: a calm man in a charcoal jacket who kneels at the edge
  of the pour as if in prayer; his skin is a shell over a machine's frame. One bar (18000), four phases: at 74 % THE
  SKIN BREAKS, at 46 % WEAPONS FREE, at 20 % TRUE FRAME. The hardest hitter in the game (x1.6) and the fastest, on
  COMBAT.md's floors (a first windup of 0.7 s or more in phase 1, hits 0.45 s apart, the cue 0.35 s before the
  impact): his speed is links, short recoveries and his boosters. 32 moves in four families: open-hand strings, a
  sweep and a knee, a red grab that throws you through the nearest piece, the Long Walk that light cuts do not stop,
  a counter for each phase and his flurry (melee); the booster punch (up to 10 m in a blink), Rosary (7 - 10 piston
  blows, the last blue), the dive knee, two jet strings, Vespers (four jet passes and a dive), Last Rite under 8 %
  (the boosters); the eye's cutting laser, the palm cannon, three bolts (a perfect parry sends one back into his
  chest), a missile swarm, a strafing pass, a creeping barrage with safe lanes, a lance from the sky, the full burst
  (the arsenal); a gas tank kicked at you, a ladle's chain shot, a girder or a frame thrown, a column cut down onto
  you, the press slammed into a shock across the whole floor (the terrain). Every blow, shot and beam breaks what it
  meets and marks the floor. From phase 2 a jet step closes on you. Nothing lands on him through a phase's change.
  His shell chips where your cuts land and stays chipped; each phase bares more (the right cheek and forearm; half
  the head, the chest, the arm and the legs; the faceted head with three sensors); a rest at the bonfire makes him
  whole. Cyan on him is only looks: no tell of his is blue or cyan. He dies on one knee, his three sensors going out
  one by one. No reward yet. 35 sounds of his own; the music borrows the Obsidian Throne's for now. His look switches
  await the owner's picks (`?fsLook=a|b`, `?fsLetters=a|0`, `?fsMark=disc|ring`; the Lab's LOOKS rows); the Lab's
  FIGHT buttons for him (a pool at your feet, the shell whole / half / bare, into each phase, every effect alone).
  *Changed:* `audio.js` plays the `fs…` sounds as it plays Bai Wuji's `wj…`; the fire field gains the `saint` and
  `foundry` palettes; `SCAR.thin.foundry`; the Training's roles for the foundry (and `saint` among the boss kinds);
  every living-world tuning file, the air, the world's sounds and the arrival shot have a foundry block; a cost row.
- **The deathblow is not cut short** (2026-11-28, ADR-280). *Fixed:* pressing guard during a deathblow ended it at
  once with nothing dealt; the press now waits and the guard comes up as the finisher ends. A perfect parry of a
  boss's blue blow that would cross the blades now gives the deathblow (he recoils, the combo follows) instead of
  the blade lock (`?dbLock=lock` as before; the Lab's `dbLock`). Tian Lei's beam locks are unchanged. The
  Training's "Blade lock" plays with `?dbLock=lock` so the lock still happens there.
- **Varr Nihil after the reference pack, to try** (2026-11-28, ADR-277). *Added (options, off by default: the owner
  picks):* `?lordRef=a` draws Varr Nihil after the owner's reference pack (`docs/art/character-packs-v04/varr-nihil`):
  his hood, closed helm, plate, war-skirt and the whole crimson-lined cape kept in all four forms (no form-by-form
  wear), every blade split into two red-white rails with a dark slit between them (the one sword, the twin blades,
  the staff's two ends, the cross sword and its side blades, the thrown blade too), a short cross-guard, a crimson
  sash and clasp across his chest, the cape's sides standing off him so its lining frames him, cloth that lags and
  overshoots further, a stronger crimson. `?lordRefMove=a` poses him after the strips: lower, wider guards (form 4
  upright with the hands under the guard, form 3's hands wide on the staff), blows that load and sink into the
  cut, the free fist out behind, Vigil's Fall to the floor, Starfall landing on the upright staff, bigger
  reactions, a deeper glide; the same timing, zones, damage and travel (`lord.mjs . lordref` checks every move,
  form and branch). The Lab's `lordRef` and `lordRefMove` rows.
- **The Cinder Wyrm dies whole, every white spark shows, and its blue and red paws look apart** (2026-11-28, ADR-274). *Fixed:* the wyrm's
  death no longer breaks its neck: its head swings down on the neck (round the neck's base, always in its reach) and
  looks along it, so the neck falls as one curve; before, the throe flung the head 1.5 m up into a straight pole with
  the head bent ~60 - 90° off its end, then the neck buckled into a zig-zag as it landed (`?deathNeck=0` as before).
  Every white (and blue) timing glint of a boss is now seen: its letters are drawn over the scene (a new blob flag
  in the fire field, `FIRE_SEEN`) and kept inside the frame like the flares; the wyrm's own paw, foreleg and wings
  hid 92 - 100 % of its claw glints and a wing blow's glint fell off the screen (`?glintSeen=0` as before).
  *Changed (the owner's picks from the films, the defaults):* the wyrm's blue and red paw blows no longer share a
  motion: the blue one is **the scythe** (the paw wound out wide and back, the chest twisted away, then swept across
  and down on you), the red stomp is **the leap** (it crouches, jumps clear of the ground with a beat of its wings and
  falls on both paws); `?pawBlue=0` / `?pawRed=0` as before. *Added (options):* `?pawBlue=b` the jab (crouched, the
  paw tucked under the chest, a straight punch), `c` the uppercut (claws dragged low, swept up); `?pawRed=b` the
  quake (sunk low, wings flat, a shudder, then the heave and the slam). The Lab's LOOKS rows `pawBlue` / `pawRed`.
- **A new fight stance: the middle guard** (2026-11-28, ADR-275). *Changed (the owner's pick of four filmed stances):* in a fight gcd
  now stands in a middle guard: both hands on the grip before his navel, the blade pointed forward at the boss's
  eyes (~36° up), the knees bent, the right foot ahead. It was the blade raised up and out to his right
  (`?hold=ref` stands him as before). *Added (turned down, kept behind the switch):* `?hold=b` a high guard (the
  blade upright beside his head), `?hold=c` the sword fingers (one hand, the blade level at the boss, the free
  hand raised behind his head), `?hold=d` a low trailing guard (one hand, the blade trailing behind his right
  leg); the Lab's `hold` row. Attacks, the block, rolls and the fight's small habits start from it as before.
- **A black blow can darken the whole picture, a red string can cut in red** (2026-11-27, ADR-271). *Changed (the owner's picks, the defaults: blackout b, red trail a):* `?black=a|b|c` replaces the
  violet look of a charged (black) blow with a blackout, after the owner's reference film: as the boss charges, the
  whole picture drains to dark grey, the boss stays lit with a white point on his weapon, the black flare is a
  white-hot streak, and colour snaps back on the strike (a: the dark drops in over the last 0.3 s before the cue,
  b: it builds through the whole charge, c: as a, darker); every boss with a charged blow has it, and it clears on
  a stagger, a posture break, a Lab interrupt, a retry or his death. `?redTrail=a|b`: from a red blow's flare on,
  a blade's cut leaves a thin red crescent just outside its edge, so every cut of a red string reads red (a short,
  b longer); the sword bosses only. *Added:* every black blow, hit or miss, lands with a devastating impact
  (`?blackImpact=a`, the default; `0` as before): a crater and what stands near broken, a shock front of dust,
  a light, a hard shake, a held frame, an explosion's sound. The Lab's `black`, `redTrail` and `blackImpact`;
  `npm run perf -- --black`.
- **The parry and the deathblow, readable** (2026-11-27, ADR-264). *Changed (the owner's pick from the films, `all`,
  the default):* `?dbread=` makes the moment between a parry and the deathblow it starts readable to someone watching,
  three ways: `a` the break (the parry throws a boss open, arms wide and stumbling back, and you hold a beat of 0.35 s
  before stepping in to cut him while he reels), `b` space (you strike from 1.3 m and every blow drives him back, so
  the two bodies never merge), `c` a clean contact (the flash at each cut smaller, beside the wound on his far side
  and gone at once instead of held through the freeze; the burst out of his back thinner; no white streak on the
  finishing thrust; his body's white flash dim), `all` the three (the default), `0` as before. The blows and their damage never change. The Lab's `dbread`
  row. *Added (options, off by default):* `?strikeGap=a|b` keeps a sword boss's dashes from bringing him nearer than
  1.5 / 1.8 m (off: it bends Shen Hui's lunges), so the blades meet in the open between you at a parry (never past what the blow reaches; fists and
  feet as before; the Lab's `strikeGap`); `?parryClash=a|b` draws the perfect parry's gold clash and its mark smaller
  (b: the X alone, no rings; c: no gold at all, a pinpoint where the blades cross and the sparks) so the crossing
  blades show (the Lab's `parryClash`); `?blueTell=a` draws a boss's blue parry cue as a small blue cross on his
  blade instead of the big white star and ring (the Lab's `blueTell`). *Changed (the owner's pick, the defaults):*
  the perfect parry is `c`, a pinpoint where the blades cross and its sparks, no gold burst; the blue cue is `a`
  (`?parryClash=0` / `?blueTell=0` as before).
- **Swipe to dodge on touch** (2026-11-28, ADR-278). *Added (a pause-menu switch, on by default; `?swipe=0`):*
  SWIPE DODGE: a quick flick on the bare right half of the screen dodges the way it flicked, the moment it moves
  (no need to find the DODGE tile, which stays). *Changed:* with PAD LAYOUT → GUARD ON LEFT (`?pad=split`) the
  GUARD button stands right against the stick and has its own padlock: unlock it to drag GUARD where your left
  thumb wants it (kept), a second GUARD stands under ATTACK, and GUARD and the padlocks are drawn quieter so the
  controls do not pull the eye. *Added (pause menu):* LEFT GUARD and RIGHT GUARD switches to show or hide either
  guard button (one always stays), and PAD LAYOUT now picks where BLOCK sits in the right cluster (beside or
  under ATTACK). Both guard buttons are named BLOCK, the gauge line under them is gone, and ATTACK's dagger points
  down; the stick and the left BLOCK are drawn as glyphs only, no frames (`?leftLook=a|b` the other two looks);
  on the right, BLOCK beside ATTACK and DODGE under it.
- **One tap to begin, menus with a finish, and touch controls that fit and move** (2026-11-28, ADR-270). *Fixed:* on
  a phone, a tap on a world, BEGIN HERE or BOSS RUSH on the title acts at once (iOS took the first tap as a hover).
  *Changed:* the title's and the pause menu's buttons and panels in a finished look (cut corners, the world and its
  buttons in one panel, an ember BEGIN HERE beside BOSS RUSH); held upright, the open world's panel stays on screen. Touch: FLASK | HEAVY over
  BLOCK | ATTACK with DODGE right under ATTACK; the pad sits further in from the right edge; every control scales
  with the screen (smaller on a small near-square phone, larger on a tablet); the phase call keeps below the HUD.
  *Added:* a padlock over the pad: open it and drag the right-hand controls anywhere (kept; RESET puts them
  back); on touch the boss fight starts locked on.
- **Wen Yao punches and kicks with straight limbs** (2026-11-26, ADR-249). *Changed (the boss motion audit; the owner's pick from the films):* the
  Thousand-Body Fox's straight punches and palms now land on an open arm along one line to you (the elbow 162 - 167°,
  was 123 - 139°), his roundhouse, his paper selves' rising kick and both ankle sweeps land on a straight leg (the
  sweep stays straight through its whole turn), his hooks and uppercuts keep a real bend, and his leaps with the heel
  or both fists come down short so the heel and fists land on you, not him. Paper Rain ends on a backfist, so the
  uppercut is only ever the blue flare. Timings, tells and numbers unchanged. `?foxLimbs=0` / `?foxCues=0` play him as
  before.
- **Bai Wuji's barrier shows where your blade hits it, and he goes down quicker** (2026-11-28, ADR-266). *Changed:* a cut that stops on Bai
  Wuji's barrier still takes a quarter of its damage off his bar (no stagger, never his last HP), its number shown
  where the blade stopped; his health is 16000 (was 20000); every cut on the barrier shows a faint patch of it where
  it landed, gone in a moment (`?wjStrike=0`: the ripple as before). *Removed:* the ring on the floor that counted
  his barrier's opening down (`?wjSign=1` brings it back).
- **The clash dance: parries in a row break him faster** (2026-11-27, ADR-247). *Changed (the owner's pick from the
  film):* against the human bosses, parries in a row inside one of his strings pay more posture each (x1, x1.25,
  x1.5, then x1.75); the run starts over when his string ends, when a blow lands on you, or after a pause. The
  parry's ring rises a little with the run, and his posture recovers more slowly as his health drops (full speed
  above 75 % HP, then x0.85, x0.75, x0.5 and x0.25 below 10 %; for the Starless Lord, Tian Lei and Xin Yi this
  replaces their own curve, never faster than before). `?clash=0` (the Lab's `clash` row) plays as before.
- **Tian Lei audited: straight limbs, a readable pace, a sun for his ki blasts** (2026-11-26, ADR-248). *Changed (the owner's picks from the films):* Tian Lei's
  straight punches land with the arm long and in one line down his centre (they crossed it, elbows at ~150°), his
  kicks with the leg straight (the roundhouses at ~100°), and his sweep comes from a drop stance, turning on a
  planted foot (the tuck's knee flipped and the planted foot slid a metre). Every blow sits at the fairness floor:
  a move's first blow 0.7 s, its blows 0.45 s apart, the glint 0.35 s before, the extra time a held windup pose
  (the snap jabs stay quick). His ki blasts fly as suns: a white heart, gold turning round it, a spinning ring, a
  pool of light under it, a burst that folds in and breaks. `?ascMotion=a`, `?ascPace=0`, `?ascShot=0` (the Lab's
  LOOKS) give each back as before; `?ascShot=b` is the comet that was not picked.
- **Shen Hui fights with better form** (2026-11-26, ADR-250). *Changed (the owner's pick; `?ashForm=0` as before):* his thrusts
  land on a straight arm with the point on its line, out of a real lunge (front knee bent, back leg long); his
  overheads come down one-handed on a diagonal across you instead of straight down; his low sweeps turn on his feet
  instead of winding his legs round each other; his free hand stays quiet through a string; and the front foot comes
  down as the blade lands; Heaven-Splitting Fall is a real jump (he tucks with the blade raised, reaches his legs
  down and lands into the cut) instead of flying in a crouch. The same timings and cues. *Added:* Ember Whirl
  raises a cyclone of fire round him, and Heaven-Splitting Fall splits the floor in fire ahead and behind
  (the owner's picks; `?whirlFx=` / `?fallFx=` a, c or 0 for the others).
- **Blows land on what they strike** (2026-11-27, ADR-259). *Changed (the owner's pick from the films, `b`, the
  default):* every hit, block and guard is drawn ON what it strikes in the frozen frame (a blade's edge bites a
  few cm in, a fist lands on the body; it used to stop 10 - 75 cm short or show 10 - 40 cm through), held there
  through the freeze, a heavy blow a beat longer, then the swing carries on; a blocked blow stops on your blade with
  your guard nudged onto it, a cut on a boss's guard stops on his steel; the sparks sit where the two met; and the
  struck part answers (your head snaps away, your body twists or folds, a shoulder knocked back, a leg buckles;
  a boss's reaction now knows the arm too), and a boss's blow that would fall short of you is reached into (his
  body eases into it, feet planted). The execution's and the plunge's bursts sit where your blade enters, and the
  wyrm's bite lunges its head onto you as it lands. `?contact=0` as before, `?contact=a` without the reach,
  `?contact=c` with a longer step-in reach. Nothing of any result, damage, window or timing moves
  (the duel and asc `contact` scenarios play one exchange three ways and compare every result). The Lab's
  `contact` row. *Added:* the contact audit (the duel / asc `contact` scenarios).
- **The hero runs with his sword held low, its point down beside his leg, gripped as a hand grips it** (2026-11-26, ADR-229).
  *Changed:* on the run and the sprint he holds his sword the way a hand grips one, the thumb ahead: its point
  hangs down beside his right leg, a little ahead and out, and it rides with his arm as it swings with his stride,
  clear of his legs and his coat (before: the blade forward at his hip, level). His fist sits on his forearm as a hand closes on a grip (the thumb
  away from the wrist), and his free arm swings naturally with his stride. *Added:* the other carries tried on the way stay behind switches: `?runSword=g1|g3|nat|n1|n3|flail|b15|b25|b35|b45|a1|a2|a3|a4|trail|swept|side|hip|old`, `?runArm=e|f|g|h|d` (the Lab's
  `run sword` and `run arm` rows). *Fixed:* out of a run with the blade trailing behind him, a block, a parry, the
  flask or a charge no longer flips the sword round in one frame (nor whips it up from a blade held low).
- **The performance readout measures by itself** (2026-11-27, ADR-261). *Changed:* with `?perf`, BENCH now runs on its own
  during a fight (once early, then at the slow moments, four times at most); play, then tap REPORT. `?perf=manual`
  keeps it to the button.
- **The Starless Lord fights with better form** (2026-11-27, ADR-251). *Changed (the owner's picks from the films;
  `?lordForm=0` / `?lordPace=0` / `?boltFx=0` / `?igniteFx=0` as before):* in all four forms his thrusts land on a
  long arm with the point on its line, out of a real lunge (front knee bent, back leg long; before, both knees
  locked); his two-handed overheads (Falling Star, Grasp and Sever, Severance, every string's held chop) come down on
  a diagonal across you instead of straight down; his low sweeps (Reaping Arc, Red Meridian, every red sweep) turn
  on his feet instead of crossing his legs; his free hand stays quieter through a string; the front foot comes down
  as the blade lands. He also fights at a readable pace (COMBAT rule 10): every move's first blow at least 0.7 s (a
  little less each form), his blows at least 0.45 s apart, the glint 0.35 s before, the extra time a held windup.
  Void Lightning grounds three times along its line, the floor crackling round his feet through the cast
  (`?boltFx=c`); each form's ignition raises a column of violet letters round him that bursts out flat
  (`?igniteFx=a`). The other options stay behind their switches.
- **The Cinder Wyrm raises its head naturally to rain fire** (2026-11-27, ADR-258). *Fixed:* rearing up to roar
  the meteors into the sky, the wyrm's head no longer tips back past upright and rolls over on its neck: the neck
  rises up and forward over its forelegs and the head points up at the sky. `?wyrmHead=0` (the Lab's LOOKS row) as
  before. *Added:* integ `wyrmhead` (opt-in): every fire move's head angle.
- **Xin Yi's limbs on the line** (2026-11-27, ADR-253). *Changed (the owner's picks, the default):* his punches land straight down the line to you with the arm long, his kicks stay
  straight through the hit instead of folding as it lands, his elbow, knee and spin kick reach you instead of
  striking short, the low sweep passes through you, and his guns point down the line of fire, each shot leaving
  the muzzle with a kick of the arm (`?oneMoves=a`: as before). Every timing is as before. His gun shots now leave a
  curtain of falling code (`?oneGunFx=b`; `a` a tracer, `0` as before) and his palm bolts in the Source are a hot core
  in turning rings of digits (`?oneBoltFx=a`; `b` a folding column, `0` as before).
- **Bai Wuji's blows land where they aim** (2026-11-27, ADR-255). *Changed:* his palm, his straight poke, Dark
  Spark's fist and the fist he pulls you onto now land on the line to your chest (they crossed past you by up to
  30 degrees); his kicks ease back after the contact instead of snapping off a dead stop; in his first phase his
  right hand comes out of its pocket to cast Azure Draw and the Yank, so the Yank's blue fist is a fist you can
  see (`?wjPolish=0` and `?wjCastHand=0` as before; `?wjCastHand=b` the hand out only at the end of the cast).
  *Fixed:* a spell or a thrown piece of his no longer knocks you down again the moment you stand up from a
  knockdown (his kicks and punches already held back there).
- **Lu Wusheng draws like a swordsman** (2026-11-27, ADR-252). *Changed (the owner's pick from the films):* his fist closes on the hilt as he settles, the scabbard is pulled back
  level behind him as the blade leaves, and the draw ends in a real lunge (the front knee bent, the back leg long,
  the arm open) instead of a straight-legged split; his thrusts land on a long arm in line with the scabbard; the
  two-handed overhead comes down across him on a diagonal; Sweeping the Road turns on his feet; the free hand in the
  scabbard cuts moves half as far. Poses only: every windup, cue and window is as before; `?sheathForm=0` gives
  the old poses. *Added, kept as options (the owner kept today's):* `?sheathPace=a`: COMBAT rule 10's slower floor for his scabbard blows (first blows 0.7 s, blows 0.45 s apart, the cue 0.35 s before, the
  draws unchanged). `?drawFx=a|b|c`: three looks for the draw (the drawn breath, hanging leaves, the late sound).
- **The Cinder Wyrm bites with its whole body** (2026-11-27, ADR-257). *Changed (the owner's pick from the films):*
  in every bite the wyrm's body surges first (the chest drops
  and pitches in off the hind feet, the body lunging a little toward you) while the head hangs back, then the head
  snaps onto the impact the flash promised, its jaws now reaching you on the beat. Every windup, cue, impact, hit
  sphere and number is as before; `?wyrmStrike=0` (the Lab's LOOKS row `wyrmStrike`) bites as before. *Added:* the wyrm's anatomy audit (integ `wyrmanatomy`, opt-in: each blow's gap
  to the hero at the impact, a foreleg's elbow and reach, the chain's order, the tail's tip, skating feet, pops).
- **Halcyon fights like a flier: straight blows, long legs, heat vision and a thunderclap** (2026-11-27, ADR-254).
  *Changed (the owner's picks from the films):* his straight punches go along the line to you (they ran 35 - 66° off
  to the side), the arm long (elbow 161 - 171°); his kicks land straight (173°) with the other leg hanging long; his
  legs trail long behind him in every blow and hang long under his hover, the toes pointed (they sat folded under him,
  knees 67 - 135°, as if kneeling on air); Fly-By and Through the Tower fly level, the fist out, through your chest
  instead of over your head (every timing unchanged; `?halMotion=a` plays the motion before). His eye beams are heat
  vision (twin threads meeting in one hard crimson line, a shimmer rising off it, a molten spot spitting sparks where it
  lands, red motes drawn into his eyes as he charges; `?halEyes=0` the beam before, `b` a crimson pulse); his clap and
  his meteor's landing send a crisp ring of air racing out with the dust shoved ahead of it (`?halShock=0` the dust
  front before, `b` a dome of pressure). *Added, not the default:* `?halPace=a`, COMBAT rule 10's slower pace (the owner
  kept his fast one). The Lab's LOOKS rows for all four.
- **Bai Wuji glides: quicker, one-handed, and his barrier opens easier** (2026-11-27, ADR-250). *Changed:* Bai Wuji's kicks and punches are
  rebuilt by hand: his legs land straight, his hands stay in his pockets for most of phase 1 (one comes out in
  phase 2, both in phase 3), normal blows snap out of the stance, blue and red ones hold a pose you can read, and
  every later blow of a string comes out of a short blink round you (`?wjMotion=0` as before; `a`, `c` the other
  takes). His barrier opens easier: two ordinary parries crack it open, it stays open longer (6 / 5 / 4.2 s after a
  perfect answer), your cuts deal x2.5 through it, and his health is 20000 (was 26000); his patience runs out
  after 20 s. *Fixed:* a falling piece no longer lands on you while you are down, and his mercy counts the time
  you are held in real time, so a quick string cannot hold you past the cap through hit freezes.
- **The perfect parry earns its own reward: the deathblow** (2026-11-26, ADR-211). *Changed:* a perfect parry no
  longer answers with the perfect dodge's flurry. Against the human bosses, parries fill the gold posture bar and
  bank PERFECT parries (they no longer count in the dodge streak); a string's last blow parried makes him recoil and
  opens a short window for your own counter cut. When a parry breaks his posture, or you parry a blue warning blow,
  the hero answers with N DEATHBLOWS where he stands (N = the perfect parries banked, 1 to 7): a combo of his own
  cuts in a new order every time, each freezing for a beat at the contact with the blade in him, under the dodge
  flurry's cold cast and a camera lean; ~3 s for seven. *Added:* every deathblow leaves a straight cut on his body
  that crosses the last and shatters on the finisher (Shatter Web), blood (a spray, a wound along the cut, pools on
  the floor until the fight resets), and its own sound, a blade through flesh; a chain of perfect parries throws
  more sparks and embers. Switches: `?dbfx=a|b|c|d`, `?dbsfx=0|a|b|c|d`, `?blood=0`, `?dbmatrix=rain|world`
  (off by default), `?parryRiposte=deathblow|planted|old`, `?parryGrow=a|0`; Lab streak row; TRAINING: Deathblow
  x3 / x7, Deathblow on a blue blow.
- **The flash chain: counter him three times in a row** (2026-11-26, ADR-246). *Changed (the owner's pick from films of every duelist):* a flash
  counter no longer ends his string at once: he is thrown back and strikes back straight
  away, and a flash counter of that blow is the next link. Three in a row (70, 85, then 100 damage, each freeze
  and ring a little bigger) and he reels with the crit window open, as a single flash counter does today. Every
  duelist; the timing window is the same for every link. `?counter=0` (the Lab's `counter` row: old) gives the
  flash counter as it was.
- **The living world draws for less** (2026-11-26, ADR-245). *Changed:* the atmosphere looks exactly the same but costs
  less: its letters hand the graphics card only what is drawn, empty layers are skipped, and the ground's
  footprint flash and the grass's wake stop working on pixels they cannot reach (the ground pass about 11 - 17 %
  cheaper while you leave prints). `?perf`'s BENCH now reports the living world's own share. `?lifeFast=0` runs
  the old paths.
- **Instant slashes, and a quieter left hand to choose** (2026-11-26, ADR-240). *Changed:* every sword attack, the
  perfect-dodge flurry's finishers included, leaves one straight slash line where the blade passed instead of the
  curved crescent: thin, sharp at both ends, white-hot in the middle; a turning cut leaves three straight cuts round
  him, a thrust a short streak off the point, a heavy blow a thicker violet line with a small kick of the camera.
  `?slash=arc` (the Lab's `slash` row) draws the crescent as before. The light combo's motion is production's.
  *Added, to compare (not the default):* `?offhand=side`, `back` or `quiet` (the Lab's `offhand` row) for the free
  hand in a one-handed swing: loose at his side, behind his back, or today's gestures pulled in close to the body;
  two-handed blows keep it on the grip. Every number of every attack is the same.
  The slash line now appears the moment the visible swing ends (the blade slows after its fastest frame), from
  where the swing began, instead of at the end of the attack's hit window from where it opened.
  *Added, to compare (not the default):* `?feel=snap`, `weight` or `flow` (the Lab's `feel` row) plays every sword
  attack, the light combo and the heavies alike, with the same moves on another clock and its own free hand: snap
  reaches the coil early, holds it and cuts fast and clean (the hand behind his back); weight loads slowly,
  accelerates into the blow, sinks and turns deeper and holds the finish (the hand loose at his side); flow runs
  without holds (today's hand moves pulled in). Every hit lands in its same frames.
  The slash is now an ENDING slash: once the swing is over, a beat later, a fixed-length straight line flashes at
  the cut's angle through the space ahead of him where the foe stands (`?endslash=body` across him, `enemy` across
  what it hit, `blade` along the blade's path; `?endbeat=0` with no beat; the Lab's `endslash` / `endbeat` rows).
  *Added, to compare (not the default):* four light combos built for it, `?combo=a`, `b`, `c` or `d` (the Lab's
  `combo` row): a Iai (draw cuts into still poses, a two-handed falling finisher, the hand behind his back), b
  Tempest (quick strokes back and forth, a full turn to finish), c Mountain (slow, heavy, the leaping slam), d
  Dancer (a skip, a turn, a lunge, a rising two-handed finisher), each from today's swings in a new order on its
  own timing, feel and hand. Their timings differ from today's; damage and reach do not.
  The baseline (the owner's pick): combo A with the ending slash on the enemy as the swing ends, the game's
  default on the site (`?combo=0` plays today's chain). Each ending slash now runs the way the sword crossed the
  screen, drawn from where the swing began to where it ended over three frames, once the swing is over (a landed
  blow's bite no longer reads as its end). The free hand no longer flickers through the coat behind his back.
- **Blue and red blows you can read, and quick blows** (2026-11-26, ADR-223). *Changed:* Lu Wusheng, Wen Yao and the
  Cinder Wyrm stop and hold their pose for a moment before every blue or red blow, standing tall for blue and sinking
  low for red (the wyrm rears its head for blue, crouches with its tail up for red); the blow lands that moment later,
  its cue and timing windows as before. Wen Yao's feet no longer jump as he steps into a blow. *Added:* a quick white
  blow each, straight from the stance with no wind-up: Lu Wusheng's Before the Word, Wen Yao's Fox Snap and Fox Knee,
  the wyrm's Snap swipe; block it or parry it on the glint. `?sheathMotion=0`, `?foxMotion=0`, `?wyrmMotion=0` and
  `?sheathQuick=0`, `?foxQuick=0`, `?wyrmQuick=0` give the fights before.
- **A ninth level: the Veiled Crossing and Bai Wuji, the Untouched** (2026-11-26, ADR-241 – ADR-243). *Added:* a ninth
  level, `?level=veil` (the title screen lists it). **The Veiled Crossing**: a city crossing at night after the fight
  has already levelled it, under a black veil: cracked asphalt with a great diagonal crossing's white bars, craters,
  an old wide trench, tower stumps with their tops still standing, a fallen tower lying across the north, a broken
  overpass, wrecked cars and a bus, bent lamps; everything in it breaks. **Bai Wuji, the Untouched**: a tall, relaxed
  man in a bone-white high-collared coat, white hair standing up over a band across his eyes, hands in his pockets.
  Your blade stops short of him on a barrier you cannot see until it nears him: a perfect parry or a perfect dodge
  of any of his blows opens it for a few seconds (four ordinary parries close together crack it open for less; a posture
  break opens it too). Every blow of his that lands throws you, through whatever stands behind you; a block costs
  no health but slides you back and costs a big share of your guard (the third in a row knocks it open); his spells
  cannot be blocked at all. He waits for you to come to him: if your blade has not reached him for 30 s, his eyes
  burn and every block costs your whole guard until it does.
  Azure Draw (a blue knot that drags you, then collapses), the Yank (pulled onto his fist), Crimson
  Cast (a red point flicked to your place, a burst), the Wrecking Knot, the Violet Null (a line across the whole
  crossing that erases what it crosses and leaves a wide trench), wreckage lifted and thrown, a tower's top brought
  down on you, the road itself burst up in a line. At 66 % THE BLINDFOLD COMES OFF: his hair falls and his eyes
  burn blue. At 30 % THE MEASURELESS: the hand sign, and a dark sphere closes on the arena: perfectly dodge through
  its wall and you are inside unharmed with his barrier open, or you are caught, held a moment and struck once
  (never lethally). The last phase is fought inside the void: the city gone, its pieces floating past, his blows
  out of nowhere, the Last Null below 12 %. He never strikes a hero who is down and never holds you longer than
  1.2 s. The bonfire goes out while the void stands and burns again when the city comes back. No reward yet. His look is the owner's picks: the bone-white coat, the short spiky hair, an ash moon over
  the crossing, the void's ring, the barrier all but invisible until a blade nears, the Null a hard-edged slab
  (`?wjLook=a|b`, `?wjHair=a`, `?wjCity=b|c`, `?wjVoid=a|c`, `?wjShell=b|c`, `?wjNull=b` the others). *Changed:* a
  thrown or dropped raised piece can land on the floor (`ground`), a held piece can be chipped by the hero's blade
  and breaks when cut under 1 hp; floor marks are thinner on the crossing and its metal rubble lies grey, not
  ember-orange; the crossing's marks hide inside the void and come back with the city. Halcyon Plaza's metal rubble
  lies cold grey too (the owner's call; `?coolRubble=0|1` turns the grey rubble off or on in any level). *Fixed:* Halcyon's thrown
  pieces land on the road (the Falling Sky's tower top burst about 6.5 m up in the air), the owner's call.
- **Xin Yi rebuilt: a man in a coat, readable windups, faster hands** (2026-11-26, ADR-221). *Changed:* Xin Yi is
  drawn like the hero on a man's build: square shoulders, a belted waist, fuller hair, and one long open coat that
  hangs instead of flaring, with a straight hem (the owner's pick; `?oneBody=0` as before, `a` closed, `c` a duster).
  His kicks land with the leg straight and his punches with the arm long, his single gun is aimed down a straight
  arm, every blue and red blow is held in a windup pose you can read before the snap (the same timing). *Added:* two
  fast strings, Snapping Hands and Quick Foot (`?oneMoves=0`: his moves as before).
- **Shen Hui and Varr Nihil hold their swords like swordsmen** (2026-11-26, ADR-226). *Changed (the owner's pick; `?ashMotion=0` /
  `?lordMotion=0` give back the motion before):* the second and third
  bosses hold their blades in line with the forearm (it bent up to 128° off it) and their arms open at the end of a
  blow; every blue blow is wound up in a held pose with the blade raised high (or drawn back level for a thrust), every
  red one sunk low with the blade trailing near the floor (Piercing Ash keeps its drawn-back thrust), the timings unchanged; Varr Nihil ends his strings with a
  shake of the steel instead of a twirl that snapped; two quick blows each, thrown straight out of the guard
  (Darting Needle, Flicking Willow; Rising Ember, Vigil's Fall). A sword motion audit for both (`audit`).
- **The bosses shaded and outlined like the hero** (2026-11-26, ADR-220). *Changed:* Shen Hui, Varr Nihil, Tian Lei,
  Lu Wusheng and Halcyon keep their own colours, clothes and letters, but are now lit the way the hero is: bright
  where the light catches them and on their shoulders, falling off into dark letters on the shadow side and down
  the body. Shen Hui, Varr Nihil and Lu Wusheng also get the hero's thicker, blockier outline on large screens.
  Each boss's switch (`?ashHero=`, `?lordHero=`, `?ascHero=`, `?sheathHero=`, `?halHero=`: 0 as before, a the
  shading, b the outline, c both) is in the Lab's LOOKS.
- **Tian Lei and Halcyon: held windups, quick jabs, and Halcyon fights like a flier** (2026-11-26, ADR-225; the owner's pick: `?ascMotion=0` / `?halMotion=0` play them as before). *Added:* every
  blue (parry) and red (perfect-dodge) blow of Tian Lei's and Halcyon's now winds up into a pose of its own, held
  while it tightens, so you can read which blow is coming and how to answer it; red ones sink deeper. Two quick
  white blows each, thrown straight out of the guard with a short windup: Snap Jab and Snap Hook (Tian Lei), Flick
  and Tap (Halcyon). *Fixed:* Halcyon no longer stands on air in a fighting stance when he strikes: his legs trail
  like a flier's, he dips into each blow and his fists meet your chest and head instead of passing over it, with
  his arm opening at the end. The timings of every blow are unchanged.
- **The drakelings never dive on top of the wyrm's blows** (2026-11-26, ADR-237). *Fixed:* in a long flurry of the
  Cinder Wyrm's, a drakeling that had waited out its turn could dive in the same instant as one of the wyrm's
  blows that needed the other answer (a roll against a parry). Now it waits for a clear moment however long the
  flurry runs, or burns out harmlessly, and the wyrm's embers never come due beside a drakeling's dive.
- **Four looks for the perfect dodge flurry** (2026-11-25, ADR-210). *Added, behind `?dodgefx=a|b|c|d` (the Lab's
  `dodgefx` button; the owner picked a, the Thunder Thrust, as the default; `?dodgefx=off` is the flurry before):* against a man the flurry keeps its vanish and all three
  finishers, and adds faint smeared copies of him along each cut, tiny sparks kicked off the floor, and an aerial cut
  from above in a streak of 5 or more. Each look adds one lesson from the owner's reference footage: a) the Thunder
  Thrust, a fourth finisher (a low set, one smeared lunge, the lunge held, letter tendrils over the floor); b) a bloom
  at the blade's point breaking into floor tendrils on every contact; c) a cloud of slow falling sparks that builds
  through the streak; d) a heavier wind-up and a held landing for every finisher. Same blows and damage.
- **Parrying is easier: the perfect parry's timing widened** (2026-11-26, ADR-227). *Changed:* a parry pressed up to
  0.2 s before the blow lands is now perfect (it was 0.08 s), the same window as the perfect dodge: its extra posture,
  the fast critical counter cut, the blade lock and the returned shots come far more easily. A parry pressed earlier
  than that still works, as before, up to 0.22 s.
- **A lighter world on phones that need it** (2026-11-26, ADR-216). *Changed:* on a phone that still drops frames at the
  lowest resolution, the ground's extras (ridge strokes, drifting cloud shadows, contact shadows, the floor ripple)
  turn off and the stone floors' relief is drawn more simply, for the rest of the visit. `?lite=0` keeps the full
  look, `?lite=1` forces the light one.
- **BENCH in the performance readout** (2026-11-26, ADR-215). *Added:* with `?perf`, BENCH holds the game still for a
  few seconds and measures what each drawing step (shadows, world, letters, fire, glow, effects) costs your
  device's graphics chip; REPORT then includes it.
- **A performance readout on your phone, and smoother first breaks** (2026-11-26, ADR-209). *Added:* `?perf` in the
  address shows the frame rate and the frame's cost at the foot of the screen, with a REPORT button that shares
  or copies what each part of the game spent and the slowest frames. *Changed:* the cracked and broken floors
  and the cut bamboo are prepared while the level loads, so the first break in a fight no longer stalls a
  frame; two smaller costs in the shadows and the hero's see-through outline are gone.
- **The hero stands, holds and guards like the reference** (2026-11-25, ADR-207). *Changed:* after the owner's
  reference footage, at ease the hero now stands tall with the sword in one hand, its point forward and down by his
  right foot, the free arm hanging; in a fight (locked on, a boss) he takes the sword in both hands before him, the
  point up above his head. Now and then at ease he puts the sword away at his left hip, where it burns out in its
  green flame, stands empty-handed for a breath and draws it back out of the flame. His habits, tricks and spells
  start from and come back to the new stand. His guard is a braced crouch, both hands up before his chin and the
  blade across his face; the block and the parry work exactly as before (`?idles=new|old`, `?guard=ward`: the
  looks before).
- **The resolution follows the frame rate** (2026-11-25, ADR-200). *Added:* a new quality setting, AUTO, on by
  default: the game times its frames and, when the graphics chip cannot hold 60 fps, draws the picture at a lower
  resolution (2x, 1.5x, 1.25x, down to 1x of the window's pixels; never lower, so the letters stay as many as today), and climbs back when there is room, only outside a
  fight. A first guess is timed on the title screen. A slow processor is told apart and left alone (a lower
  resolution would not help it). F2 and the pause menu cycle AUTO, LOW, MEDIUM, HIGH; a preset turns AUTO off.
  *Added:* a 60 FPS CAP in the pause menu, on by default on touch devices (heat, battery): a 120 Hz screen draws every
  second refresh. `?autoq=0` starts with AUTO off, `?autoqFloor=` sets its lowest step, `?fpscap=0|1` the cap.
- **The hero runs like a swordsman: the blade carried forward at his hip** (2026-11-25, ADR-204). *Changed:*
  on the run and the sprint the hero now carries his sword forward, low at his right hip, its point rocking down
  as the arm swings back and up as it swings forward, the steel moving with his forearm; before, the blade trailed
  behind him on a wrist bent nearly at a right angle and hardly moved. His free arm pumps like a runner's: the fist
  up before his belly, the elbow high behind his back. His free hand is now a closed fist as wide as his forearm,
  no longer a small knob with spiky fingers. `?runSword=old`, `?runArm=a` and `?handLook=a` give the run before.
- **The dragon's neck and head move naturally: no upside-down head, no flips** (2026-11-25, ADR-203). *Fixed:* every one of the
  Cinder Wyrm's 50 moves was measured frame by frame (how fast each neck joint and the head turn, how far the
  head rolls off level, where it looks). Its head no longer rolls upside down in flight (the sky dive's climb,
  the hunting flights' wheels, the hover barrage's rise), it no longer looks straight back over its own spine
  (the meteors' roar now goes up at the sky facing forward), its neck no longer snaps 60 - 150° in a frame as a
  foe crosses behind it (the tail lash, the tail sweep, the rakes), the last bite of the storm flurry no longer
  buckles the neck sideways and draws the head apart from it, and a bite's first frame no longer flicks the
  head 75° in one go. The head stays upright against its own body in every move, the neck twisting with it, and through the hero's flurry it no longer chases his blinks (`?neck=c|b|0`).
- **The sword hand looks natural in the idle tricks** (2026-11-25, ADR-186). *Fixed:* in the wrist spin, the
  figure-eight, the salute and the rite and breath spells, the hero's sword fist no longer twists off his wrist:
  his forearm now leads the blade, which stays close to its line, as it does in his stances; in the salute and the
  spells the fist rises before his chest, so the raised forearm no longer shows as a jagged stick from the game camera.
- **Shadows cost less, and their edges stop crawling** (2026-11-25, ADR-201). *Changed:* the moon's shadows are the
  same, but what does not move (trees, rocks, walls, the broken pieces at rest) is no longer drawn into them
  again every frame, only when something in it changes: the shadow pass draws 15 - 79 % fewer triangles a
  frame, depending on the level. The shadows' edges, and the letters along them, no longer shimmer as you
  walk. `?shadowCache=0` as before.
- **The game runs faster on weaker machines** (2026-11-25, ADR-199). *Changed:* the picture is the same and costs
  less to draw: the ground is drawn after everything that covers it, and its relief is worked out once when the
  level loads instead of for every pixel of every frame (a frame at 4K costs a fifth to two fifths less on the
  desktop GPU, at 1080p a tenth to a quarter). A machine that falls under 50 fps no longer re-runs the whole world
  for each catch-up step, only the hero and the boss (a catch-up frame's simulation costs about a quarter less).
  `?bake=0` leaves the ground's relief worked out per pixel, as before.
- **The world is printed like the dragon** (2026-11-25, ADR-198). *Changed:* every level's ground, floors, grass,
  rocks, pillars, walls and trees are printed in the wyrm's own fine digits: a lit relief, dark where it turns
  from the moon and bright where the light catches it, in letters fixed to the world, so the ground looks
  three-dimensional and shadows fall across it. The grass is printed tufts that lie down as you run through
  and rise again; slabs have a lit lip; cloud shadows drift with the wind, things sit in soft contact
  shadows, heavy blows send a ring of digits through the ground, lit crests carry outline strokes.
  Footprints are a quick flash of green code under each step on every surface, gone in under a second.
  Your sword cuts the grass you can see: the tufts along the blade's path are shorn and fly, the line
  glows a moment and a dark swath stays. Fallen leaves lie as small lit leaves, not letters.
  `?dragon=0` gives the world before; one piece: `?dgGrass=0`, `?dpFloor=0`, `?dpProps=0`, `?dpTrees=0`,
  `?dpCloud=0`, `?dpContact=0`, `?dpRipple=0`, `?dpRidge=0`, `?prints=0`.
- **The first load is faster** (2026-11-25). *Changed:* the loading screen's last step compiles every shader the first
  frame needs side by side before it is drawn, instead of one after another as each first draws; a first visit (no
  shaders cached yet) reached the game in ~8 s and now in ~5 s on a desktop GPU. `?precompile=0` as before.
- **Your clicks reach the fight again** (2026-11-25). *Fixed:* after the title (the sword's path) faded, its panels
  stayed on the page, invisible, over the game: a left or right click landed on them instead of the fight, and a
  click on an unseen world's fire travelled there, reloading the page into the loading screen again and again.
  The faded title now takes no click and leaves the page.
- **Every fire comes from the wyrm; it roars up spells and a brood of fire; a forest you can walk into** (2026-11-25, ADR-197).
  *Changed:* no fire of the wyrm's appears out of nowhere: the phase-3 lava pillars chase the hero along a glowing
  crack that runs out of its forefeet (the crack's arrival is part of their tell), the phase-3 second flame wall is
  laid out from the first, and Armageddon's meteors leave a burning vortex over the wyrm (`?meteorSource=a|b`,
  `?wallSource=a|b`; `?fireTrail=off` the fire as before). *Added:* four roar-cast moves, each opening with a ring
  of burning dragon script on the ground or before its jaws (`?incant=a|b`): **fire drakelings** (3 - 5 small
  winged drakes that circle the hero and bite, normal or blue, die to a cut or two and dive in red when their time
  runs out; `?drakeling=a|b`), **kamikaze wisps** (they tear off its body and home in, each bursting red on
  arrival; one cut each), the **fire serpent** (it slithers out of the circle, burns and fells a lane through the
  forest, rears and strikes red; `?serpent=a|b`) and the **firestorm** (a spinning column that drifts at the hero,
  tears trees up into its spin and bursts red; `?vortex=a|b`). The wyrm fights lighter while its brood lives; the
  brood's cues never land within 0.3 s of a cue that needs another answer. *Changed:* Cinderwood has no invisible
  wall: the hero walks out among the trees wherever there is room, to the map's true end (`?forestEnd=a|b|c`: a
  rock ridge, a thicket wall, a deadfall), and the wyrm follows him in. The forest is denser and layered (young
  trees and snags in front of the old crowns, undergrowth, logs, stumps, mossy rocks, hanging moss), every piece
  breakable and burnable; the phone draws the far wood and the thicket thinner. The owner kept the default looks.
- **A loading screen, and the worlds picked along the sword's path** (2026-11-25, ADR-196). *Added:* a loading
  screen from the very first paint: the gcd logo, each step of the start with its real time, a progress bar and a
  line of lore; picking a world says where the sword takes you. *Changed:* the title shows the worlds as fires
  along the path the sword travels; the one in focus opens with its keeper, your best and the way there (keys,
  mouse, pad and touch). The full controls list moved behind CONTROLS. The name over the hero's head is gcd and
  stays just over his head, even in a roll. `?menu=0` gives back the old title, `?loader=a` the centred loader.
- **The game is called gcd** (2026-11-25, ADR-195). *Changed:* the game has a new name, gcd, written lowercase
  everywhere you see it: the title logo (a small lowercase "gcd" in the same block letters), the browser tab, the
  WHAT'S NEW header. gcd is also the hero: a mysterious being who wields the most powerful sword in all universes,
  the sword that lets him defeat these legendary bosses and carries him between campfires in different worlds and
  universes. The game moves with the name to https://thegcd.vercel.app (repo `eshin087/gcd`). The browser keys
  now start `gcd.` (`gcd.bindings.v2`, `gcd.records.v1`, `gcd.unlocks.v1`, ...): with no migration, saved
  bindings, records, learned techniques, the touch pad's size and WHAT'S NEW's read marks start fresh (the new
  address could not read them anyway). For developers: the tests' env vars are `GCD_*`, the touch / pad classes
  `html.gcd-touch` / `html.gcd-pad`, the preview config `gcd-dev`.
- **The bosses look built from letters, like the hero** (2026-11-24, ADR-194). *Changed:* every human boss is printed
  the way the hero is: a body of lit letters in his own colours (no more dark fill inside a thin outline, or flat
  bright colour), the hero's blocky outline strokes and dotted rim, and below the knee his clothes break into the
  hero's pale, ragged, dotted hem. Lu Wusheng now prints in the hero's letters instead of the big digits.
  `?bossPrint=a` the hero's greys, `?bossPrint=0` as before (the Lab's LOOKS row `bossPrint`); `?sheathArt=2` gives
  Lu Wusheng his digits back.
- **The grass bends as you run through it and springs back** (2026-11-25, ADR-193). *Changed:* running through the
  grass no longer leaves a dark trail that appears at once and lingers for ten seconds. The blades bend along
  your way and out from your path, lie down a moment and rise again over two or three seconds; a sprint or a
  landing presses a wider wake. `?bend=0` gives the trail before.
- **The sword's cut throws green code** (2026-11-25, ADR-192). *Added:* where your swing's arc cuts the grass,
  small green code glyphs (the Hall of Falling Script's digits and letters) burst off the cut, flicker as they
  fly, fall and settle into the grass; calm, about half a blade tall, so you see the meadow answer the sword
  at the normal camera. `?grassSpray=0` throws none; the other looks shown on the way stay behind `?grassSpray=`.
- **The hero comes alive standing still** (2026-11-24, ADR-186). *Changed:* the hero no longer stands with his free
  hand on his hip all the time. At ease he moves between several rests (the free arm hanging loose, the sword
  fingers low by his hip, a hand holding his cloak at the chest, the hand on the belt now and then; the sword always
  held as before), does small things with both arms (re-grips the sword, rolls his shoulders, flexes the free hand,
  brushes his coat, looks round, checks the edge) and every few actions a sword trick (a wrist spin, a figure-eight,
  a salute with the blade upright before his face, a flick of the blade clean) or a quiet SPELL in the sword's green
  flame: his fingers drawn up the blade with the flame climbing behind them, a ring of green marks written round
  him, a thread of them circling him and returning into the steel. In a fight his free hand comes off the belt into a
  guard (sword fingers at the foe, beside his face, an open guard hand, or floating low) that changes as he waits,
  with small guard shifts and grip adjustments and never a trick. `?idles=old` brings back the hand on the belt
  (the Lab's PLAYER rows `idles` and `idle ▸`).
- **A natural running arm, three ways to carry it** (2026-11-24, ADR-187). *Changed:* the hero's free (left) hand
  no longer swings a stiff fist on the run. It swings like a runner's, the elbow bent near a right angle and working
  with the stride, the hand open and loose, pumping harder at a sprint; strafing and backing away (lock-on play) it
  keeps swinging. That is `?runArm=a`, the owner's pick and the default (2026-11-25: the first merge shipped `c` as
  the default, the owner had approved `a`; it was reverted and re-shipped). `b` the swordsman's dash (swept back
  behind him whenever he runs forward), `c` natural then the dash at a sprint, `old` the swing before; the Lab's PLAYER row `run arm` switches them live. The free hand is smaller
  (× 0.8; the owner's pick of five looks, "the left hand size and color is standing out too much"):
  `?handLook=0` is the hand before, `b` / `c` darker skin, `d` a leather glove (the Lab's `hand` row).
- **The streak's answer: a heavy first cut, a path that flows, cuts that tear the picture** (2026-11-25, ADR-190, ADR-191). *Changed:*
  the flash cuts that answer a perfect dodge of a red blow, a parry's riposte and the counter. The first cut is a beat
  you can read (he is seen wound up, crosses as fast as before, is held on the contact), each later one comes faster,
  gently for a short streak and steeply for a long one, so a 7 still ends in the storm in the same time. Each pass now
  starts where the last one ended (no jump back toward where he dodged), every white slash lies on the path he ran,
  the two curved slashes that appeared from nowhere at the end are gone, and the last blow's big `A` shards are a fine
  spray of white-steel letter dust. *Added:* the passes draw a different figure each time (star, zigzag, cage, spiral,
  cross), and each cut tears the picture: for three frames the letters on either side of it slide apart like a torn
  page (the owner's pick of four looks). Damage and rules are unchanged. `?tempo=0`, `?chain=0`, `?figure=`, `?rip=`
  (`tear`, `ghosts`, `negative`, `off`) and the Lab's streak row compare.
- **The Cinder Wyrm wakes without a neck twist, and its head reads from above** (2026-11-24, ADR-189).
  *Fixed:* as the wyrm got up, the resting neck shape was blended point by point into a neck still curled
  back along its flank, and the head spun through ~330 degrees in half a second and turned upside down;
  the resting shape now waits until the curl is nearly out, and the head stays upright and on the hero
  (within ~30 degrees) all the way up. *Changed:* the drake head from the game camera (the owner: "from the
  top center view, the dragon head looks goofy"): no round eye glints (they read as two cartoon pupils; the
  burning slits are the eyes), the horns, brow and cheek fins dark obsidian lit at the edges and tips instead
  of one big pale V, the horns slimmer and swept tighter to the neck, a dark crest down the skull. The side
  view keeps its look. Picked by the owner from three options; `?wyrmTop=0|a|b` keep the head before and the
  other two (the Lab's `top` row). *Fixed:* the pounce's hop no longer lands the wyrm past the standing tree wall
  beside a gap it has torn.
- **The resting blade no longer glows** (2026-11-25, ADR-183). *Fixed:* a white halo the size of his head bloomed
  round the hero's sword at some poses and facings while he stood still, and the point left a pale block where it
  rested in the grass. A world letter centred on his blade printed the steel's raw brightness; it now shows the pixel
  underneath, as it always did for every boss.
- **Smaller combat text** (2026-11-24, ADR-184). *Changed:* the call-outs over the hero (PARRY, DEFLECT, COUNTER,
  GHOSTEP ...) and the damage numbers are smaller and keep one size at every window width. They grew with the
  window before, so a 1920-wide window drew DEFLECT at 22 px and the flurry's cut counter at 34 px. Now: call-outs
  11 - 12 px (BLOCK 9 px), damage numbers 10 / 11 / 12 px (plain / heavy / crit), the cut counter 15 px. The owner
  picked this size from three rendered options. Colours, glow and motion are unchanged.
- **A green flame on the sword** (2026-11-24, ADR-182). *Added:* a tight flame of tiny green marks burns round the
  hero's steel, in his own small letters: it licks up off the blade, boils, and climbs away in tongues. It is there
  with no streak and burns denser and hotter as the streak climbs (tiers 0 to 5), the point paling to green-white at
  the top. On by default; `?mystic=0` turns it off (the Lab's PLAYER row `mystic`: off / flame).
- **Grades, saved bests and a boss rush** (2026-11-23, ADR-179). *Added:* a won fight is graded for
  CLEAN PLAY (the owner's rule): S = no deaths and at most 15 % of max HP lost in the winning attempt,
  A = no deaths or one death and at most half, B = up to three deaths, C = any other win; time only
  orders runs of one grade. Blows met on the guard cost no HP, so blocking, parrying and dodging grade
  the same. Marks beside it: UNTOUCHED, DEATHLESS, NO FLASK. The victory RECORD shows the grade in block
  letters, the time to the hundredth, NEW BEST and the best before; the title shows each level's best
  grade and time and a **BOSS RUSH** entry: all eight levels in order, each its own page, health and
  flasks full at every fight, a death retries the boss with the clock running, a reload mid-fight is a
  death, a `3 / 8` timer under the minimap, and a rush record with every split. Saved per browser
  (`gcd.records.v1`: per level and the rush, best time and best grade, the last 24 run records in full,
  shaped for a later online leaderboard; `game:record` is the seam an uploader subscribes to). Runs with
  the Lab, a cheat, `__tick`, `?stage=lab`, `?tech=` or a gameplay URL switch are not recorded.
  The grade's and the title's looks were picked by the owner from three options each: the grade in block
  letters over its lines, the title's grade inside each level's button (the others stay behind
  `?gradeLook=` / `?recLook=`).
- **A perfect parry throws a few orange sparks** (2026-11-24, ADR-181). *Added:* on a perfect parry of a blow, a
  quick spit of 12 - 16 orange spark letters leaves the crossed blades along the blade that glanced off: short
  streaks that shrink to dots, cool to dark red and are gone in under half a second, a couple falling to the floor.
  No white, no glow; the gold mark, the freeze, the slow motion and the sound are as before, and a normal parry and
  the perfect dodge are unchanged. `?parryFx=0` (the Lab's `parryFx` button) draws the parry without them.
- **The sword mows the grass; lanterns light with the fight; the living world is heard** (2026-11-23, ADR-180).
  *Added:* **the sword cuts the grass** under its swing's arc, blade by blade, the moment the arc passes:
  each blade keeps the stub of its own letter and its top is tossed off quietly along the swing
  (`?mowLook=b|c|r1`: other looks; the stubble stays until the fight resets; `?mow=0`: today's grass); **every boss mark tears the
  grass out** under it, so the marks show in the meadow (the wyrm's claws leave three raked furrows).
  **The lanterns light**: Ashfall's, Foxfire's and the Windless Grove's stone lanterns kindle as the fight
  goes on (a few when you arrive, more at each of the boss's phases, any that fire reaches), gutter when a
  heavy blow lands near and go out when broken; the Skybreak Ring's braziers gutter and die the same
  way. **The new life is heard**: a flock's wings as it leaves, a rustle as an animal bolts, a tree's
  shudder and its creak before it falls, dust and pebbles, a lantern catching and dying; quiet,
  synthesized, one sound per moment. None of it changes how the fight plays.
- **Every sound effect is back to its first synth version** (2026-11-23, ADR-178). *Changed:* the owner turned down a new light-cut
  swing, plucked-string warnings and two rounds of variations of the blue and red warnings, and asked to "start
  from baseline and undo all the sound changes". The recorded and designed sounds of the attack-sound pass
  (ADR-165) and the combat-core round (ADR-172) are now OFF by default: a tick on every tell, the flash's ping on
  every blow, the original blue and red warnings (the red log drum is gone), the synth parry with its climbing
  chain, hurt, clash, slam, flurry, plunge and swing, and no sound of a boss's blade. *Added:* `?sfx=new` (and the
  Lab's `sfx` row, `old` / `new`) turns the recordings and designed sounds back on; their files are not downloaded
  unless it is on (the default fetches none of its 35). The recorded music per level and boss phase (ADR-117) is
  unchanged. Not undone: the sounds that came with later features (the streak's climb note, the impact sub, the
  living world's air) and two small fixes from the round-two sign-off (the hero's combo swing rising on every cut,
  the streak's note half as loud on a parry).
- **The sword cuts clean through; the fight marks the ground; birds and animals flee** (2026-11-23, ADR-177).
  *Changed:* the hero's blade no longer stops on a rock, a tree or a pillar it cannot fell: the swing
  goes through at full speed, the piece still takes the blow, its letters fly on along the cut, stone
  sparks and wood splinters (`?cutStop=1`, or the Lab's Blade button, keeps the blade that stops).
  *Added:* **every boss attack that meets the ground leaves a mark of its kind** (a crater for a slam,
  one long gash for a sword cut, three for claws, a furrow for a dash, a scorched round for a blast, a
  trench for a beam), on all eight bosses, and the marks stay until the fight resets (`?marks=0`: the
  floor as it was). **Birds flee the fight:** a flock bursts out of the trees when the wyrm's fire, a
  heavy blow or a falling tree reaches it, and crosses the sky. **Animals run:** rabbits and deer in
  Cinderwood, rats in the Ashfall ruins, lizards at the Skybreak Ring, one fox at the Foxfire shrine,
  a few small letters each, bolting into cover as you or the fight come near. **The set shakes** under
  heavy blows: leaves rain off a struck tree, dust sifts off pillars, banners and paper charms swing,
  pebbles hop, the bonfire gutters. **After:** thin smoke rises where fire burned out and leans with
  the wind, embers drift, dust hangs over a crater. The marks change nothing in the fight.
- **Combat sounds, round two: real steel on the parry, picked by ear** (2026-11-23, ADR-172). *Changed:* the owner compared 37 combat sounds on a picker
  page (the original synth, what played then, two sounds designed from scratch and up to two CC0
  recordings each, every sound placed in eleven scripted fight moments) and picked. Now recorded: the
  parry (a Norse sword on a katana), the blue / perfect parry (a spear on a katana), getting hurt (a body
  punch), two blades clashing (a sword meeting a katana), the slam (a distant boom), the plunge's dive and
  landing (a slowed swoosh, a heavy punch). Designed for gcd: your cut landing on the wyrm (a scale clack),
  the blade layer of a light and of a heavy cut (a dry slice, a deep cleaving bite), the flurry's flash cut
  and coil (a razor flick, a held breath fitted to the coil), the boss holding your strike (a lacquered
  wood guard). Back to the original synth: the blue warning, the hero's heavy cut and execution thrust.
  Kept: block, guard break, dodge, Ghostep, roll, a cut on a human boss, the flurry burst, his deflect, the
  red cues, the bosses' blows, the wyrm's sweeps. The deflect chain no longer climbs with a bell: three
  heavier versions behind `?chain=a|b|c` (the Lab's chain row); the owner picked `a`, weight that builds. From
  their sign-off: the counter, mikiri, a blade lock won, a boss deflected, the blue flare's timing ring and the
  flare counter play one strike of the blue parry recording instead of the climbing synth; the streak's climb
  note is half as loud on a parry; the hero's combo swing now rises on every cut (it fell back at the whirl).
  Every new sound matches the loudness of the one it replaces (measured through the real engine);
  `?sfx=old` still plays the originals. Credits: `assets/audio/CREDITS.md` "Combat sounds".
- **Xin Yi reworked: drawn like the hero, kicks and flurries, a wall kick, bullets that never lock you** (2026-11-23, ADR-168 – ADR-170). *Changed:* Xin Yi, the One Who Woke, is printed
  like the hero: his letters follow his size on screen, a quieter edge that fades with distance, simpler
  glasses, collar and shirt, a coat that moves in every phase (`?oneLetters=a|0`, `?onePrint=a|b|0`, b one
  letter size bolder on a phone; the owner picked a). Phase 1 runs in two gears: one hand, then both once his bar
  is at 83 % (he flips back and the second hand comes out, an opening). *Added:* the flurry burst: a blur of 6 -
  8 blows under ONE glint that one parry, one held guard (a little guard, no health) or one roll answers whole;
  spin back kicks, tornado and butterfly kicks, a flash kick, a no-hand cartwheel kick, bicycle kicks hanging in
  the air, drop heels, flying knees; new strings (Three Steps on Air, The Sky Turns Twice, Crane Crossing Water,
  Moon Over the Shoulder, Rain on One Roof; with both hands A Hundred Hands, The Long Lesson, Storm Step) and
  Iron in the Air; Borrowed Wall reworked and used often: he runs up the upright at your side and springs at you
  with a flying side kick (parry) or a drop heel (roll). *Fixed:* his bullets no longer stun-lock: Iron Rain
  fires three bursts of three, each under one glint and one result; a hit is a short flinch that keeps your
  input, and you always have time to guard, parry or roll before the next.
- **The living world** (2026-11-23, ADR-163). *Added:* every level is alive before the fight (`?life=off` turns
  it off; `?life=wind,litter,...` picks pieces, `?lifeK=0.25..2` its strength; the Lab's `life` rows). **One wind per level**: gusts drift across as faint wisps of tiny letters and stir
  the grass in loose patches, and the canopy, the smoke, the flames, the leaves, the rain and the
  banners all lean the same way. **Things fall and lie**: leaves in Cinderwood, ash in the
  Ashfall Courtyard, paper slips at the Foxfire Terrace, grit at the Skybreak Ring, cinders at the
  Obsidian Throne, one bamboo leaf at a time in the Windless Grove; a gust or a foot lifts them.
  **Footsteps answer the ground**: a puff, a print, trodden grass, and a sound per surface. **Weather
  that comes and goes**, drawn as soft clumps of many tiny faint letters: mist banks and a passing drizzle, an ember squall, the fallen star's slow breath,
  dust devils and far lightning, a cloud over the moon, still mist. **Small creatures**: fireflies
  that part from the hero, birds and crows that lift off, moths, a hawk. **The sound of the air**: a
  bed per level that follows the wind. **An arrival**: from the title the camera opens over the arena.
  **The world answers the fight**: a roar is a gust front, a great blow winding up is a held breath;
  in the fight all of it thins. **What hangs moves**: banners, paper charms. *Changed (with the wind
  on):* the Windless Grove's bamboo no longer sways. The Hall of Falling Script and Halcyon Plaza (added
  meanwhile) get the wind and the footsteps but no arrival, weather, litter or creatures yet, and keep
  their own sound. `tests/integration/life.mjs`.
- **An eighth level: Halcyon Plaza and Halcyon, the Last Saviour** (2026-11-22, ADR-159 – ADR-161). *Added:* an eighth
  level, `?level=city` (the title screen lists it). **Halcyon Plaza**: a city that has not been built yet, at
  night in the rain, read from its streets: a plaza where an avenue meets a street, four towers, cars, lamp
  posts, signs, screens that show his face, a statue of him; everything in it breaks, and the cars explode.
  **Halcyon, the Last Saviour**: a flying strongman in a caped armoured suit with red light for eyes. He
  hovers within sword reach and leaves it only inside a move that brings him back. Parry a pass and he goes
  through a storefront and lies in the rubble; send his Stare back with a perfect parry and it burns his
  eyes; parry a thrown car and it is cut in two. Fly-By, Curbside, Red Glare, Through the Tower, See the World
  (carried up over the city and thrown down), Meteor, The Falling Sky, Monument (his own statue's arm). At 66 %
  the smile drops and every screen turns crimson; at 33 % no one is watching and the city goes dark. No
  reward yet. His body, his eyes' heat and the city are the owner's picks: the blue suit and red cape, a crimson beam with a white-hot core, Neon Rain (`?halLook=b|c`, `?glare=b|c`, `?city=b|c` the others). *Changed (ADR-164):*
  his cape and colours read at game size: from the front a wide red cape frames him (it hung hidden behind
  him), a clean red inside and out, a brighter blue suit, a gold belt that prints gold; it billows while he
  hovers and trails long in a pass (the owner's pick of four steps); `?halCape=0|1|2|3` steps back to how he
  was first built. *Changed (ADR-166):* he is printed like the hero: his letters follow his size on screen
  as yours do (fewer, bigger letters from 1080p up), a quieter print, and a smaller cape (two thirds of its
  length, past his knees), the owner's picks; `?halLetters=0`, `?halPrint=0|b`, `?halCapeSize=0|a|c` the other options. *Fixed:* a blow at
  a raised piece's own height reaches it (a tower's top, a sign hung on a wall), and a blow down on the street no
  longer bites one metres above it; a rest or a retry while a broken car burns no longer leaves it to blow up
  after, or unable to blow up again; See the World's slam lands (it was dodged by the get-up's grace).
- **Streaks that build: the flurry speeds up, the hero smoulders, the notes climb; a sharper perfect parry** (2026-11-23, ADR-167).
  *Added:* a long streak of perfect defences now builds, in looks and sound only ("the longer the
  streak, the faster the attacks and way cooler animation and effects"). **The flurry accelerates:**
  its first cuts are as before, then each one comes faster until the last land a few frames apart
  (seven blows' cuts against the wyrm 1.52 -> 1.18 s; on Shen Hui the whole flurry 2.9 -> 2.1 s), every
  blow still in its own frame, the hero drawn on each. **Past seven,** the flurry still strikes seven
  blows for the same damage, but at a streak of 10 each hanging cut gets a fine echo line (two at 15)
  that splits away on the last blow, and the banner says HUNDREDFOLD FLASH / THOUSANDFOLD FLASH. **On
  the hero,** from a streak of 3: a faint rim of fire letters just outside his figure that covers more
  of him at each tier, his blade's edge lit further up, echo lines in his swings, a wake of his letters
  when he rolls or runs; a lost streak puts it all out in one frame. **In the world,** from a streak of
  5: the grass leans and the floor's grit lifts at his feet on every perfect defence. **A counter:** a
  small number beside the hero ticks up on every perfect defence from 2 and fades, with a word the
  first time a streak reaches 3, 5, 7, 10 and 15 (TRIPLE ... THOUSANDFOLD); a lost streak's number is
  struck through and falls. **The sound:** every perfect defence in a streak rings a soft note one step
  higher in the key of the playing music, a quiet drone joins from a streak of 5, a lost streak's last
  note falls. *Changed:* **a single perfect parry** is short and clean (the owner's pick of three
  looks): a gold mark printed in the letters where the blades cross, less slow motion (x0.6 for 0.18 s,
  was x0.35 for 0.36 s), a frame flash at a quarter of before; **a perfect dodge** leaves the afterimage
  standing a moment before it tears away along the way he left, with less slow motion (0.36 s, was
  0.6 s). The parry window, the i-frames, the crit window and the punish window in game time are
  unchanged. *Changed:* **the flurry's last blow** no longer blooms into a white blot over both
  fighters: the lights and the flash are turned down and the hanging cuts flare out as long thin lines
  (level 2 of four, the owner's pick). With the GHOSTEP / RIPOSTE call-outs the streak's number now
  lives beside the hero (DEFLECT xN keeps its count). The old looks: `?perfect=today`, `?burst=0`,
  `?streakfx=off` (or a list: `?streakfx=storm,counter`), `?streakCount=brackets|ticks`,
  `?auraFire=b`; the Lab's 'streak' row switches the pieces live.
- **Attack sounds: cues only for blue and red, every blow sounds like its weapon** (2026-11-22, ADR-165). *Changed:* a normal (white) attack makes no cue sound any more:
  no tick as its windup starts and no ping before it lands (the white glint stays). A **blue** attack
  rings a sword left ringing as its windup starts; a **red** (or black) one opens on a log drum and its
  distant boom, and the same drum, cut short, marks the moment to dodge. The blue timing sound stays
  today's synth ping (the owner heard three rounds of recordings and kept it). *Added:* every
  human boss's blow now sounds as it travels, timed so its loudest moment lands on the hit: a sword
  boss's cut, heavy cut, thrust or draw, a bare-handed boss's jab or full-body blow (a kick counts as
  heavy); the Cinder Wyrm's claws and tail sweeps; the hero's own sword uses the same takes, pitched a
  little higher. Three takes per slot rotate with a small pitch change so a string does not repeat one
  sound, and two boss blows never start within 0.09 s. All recorded, CC0 from OpenGameArt, picked by the
  owner by ear on an audition page (credits in `assets/audio/CREDITS.md`). `?sfx=old` (and the Lab's sfx
  row) brings back the sounds before, exactly. The duelist engine announces each real blow with
  `dragon:attack {name, weapon, weight, shape, tell, impactIn, x, z}`.
  *Fixed* (found when the sounds stopped drawing from the fights' random numbers): the Cinder Wyrm could
  pick a tree at its very feet for a throw, back off too slowly, then call the throw off after its red
  warning (a warning with no blow); the lunge now waits for the back-off.
- **Tian Lei's attacks move naturally, and he stops punching the air** (2026-11-23, ADR-162). *Fixed:* his feet no longer jump or slide while he
  strikes (a planted foot snapped up to 0.7 m in a frame at the blows of his strings, and swivelled when he
  turned); his punches land with the arm extended (every one landed with the elbow bent at ~130°); his
  palm thrusts stop at your body instead of passing through it; his roundhouse knee no longer flickers.
  *Changed:* when you step or run out of reach while he winds up a blow, he breaks it off before its flash and comes after you instead of punching the air (a fleeing hero drew up to 18 swings at air a minute).
- **Tian Lei drawn like the hero, with shorter gold hair and a new gi** (2026-11-23, ADR-155). *Changed:* on larger screens Tian Lei is drawn in the
  same size of letters as the hero (they follow his size on screen; before, he had twice the hero's
  letters across him from 1080p up), in the hero's quieter print: darker letters, the skin held down, a
  softer edge of light. *Changed:* his gold hair in forms 2 and 3 is his own spiky hair risen, about as
  tall as his black hair, not a tall crown; form 3 is sharper with one lock over the brow, no taller.
  *Changed:* he wears a burnt-red gi with black where the blue was, cloth wraps on his forearms and shins
  and soft boots. `?ascLetters=0`, `?ascLift=a`, `?ascHair=0` / `a`, `?ascLook=h` / `r` / `w` keep the
  other looks.
- **A seventh level: the Hall of Falling Script and the One Who Woke** (2026-11-22, ADR-156 – ADR-158).
  *Added:* `?level=code` (the title screen lists it). **The Hall of Falling Script**: one hall on ten slots
  whose scenes rewrite themselves into one another behind a front that runs out from him (`scenes`): the
  Pillared Hall (stone pillars, walls, lift doors), the Sparring Hall (wooden posts, paper screens, racks), the
  Source (columns of code in the dark); identical men in dark suits stand along the walls and watch (struck,
  one bursts into digits). Everything breaks but the bonfire. "More extra ASCII" inside the game's letter
  systems: his effects in a green code palette (cues keep their colours), the falling script down the walls,
  the script wave in every prop's and the floor's own letters (`?script=`). **Xin Yi, the One Who Woke**: a
  homage to the hero of a famous film under his own name: a long black coat, small dark glasses. Two bars,
  three phases: one hand behind his back (The First Lesson's beckon is its sign), then two guns (Iron Rain
  strafing round you: a pillar takes the shots, a held guard pays guard only; Two Thunders, Close Iron, the
  reload), then THE FALL (his first bar empty and the deathblow: he lies, time slows) and THE RISING into the
  Source (the Still Hand, Pushing Hands, Return to Sender, Unwriting, A Thousand Hands with skipped frames,
  Leaving the Floor and the Falling Fist's front, the Low Pass, the Dive Within). THE BEND: a heavy shot sent
  back bends him under it, time slowed, open a second with a crit, never twice in a row. THE STOP: in the
  Source he holds what you send back in the air and sends three back as one blow. DEJA VU: the hall stutters
  and he replays a string exactly. **The Long Second**, the second learned technique: guard, then dodge with
  no direction: a lean in place under the blow (`?tech=lean`). *Changed:* optional engine fields (a beat's
  `noWorld`, a hit's `guardCost`, a boss's `cameraPull`), destructibles' `present` and a set's `scenes`;
  the other levels play and draw as before. Kept behind switches for the owner's pick: his body
  (`?oneLook=a|b|c`), the hall (`?hall=a|b`), the wave (`?script=a|b|c`). The level borrows music.
  `tests/integration/woke.mjs`.
- **Wen Yao reworked: copies out of the air, the big Pearl, the Nine-Tailed Fox** (2026-11-22, ADR-154). *Changed:* Wen Yao,
  the Thousand-Body Fox, is drawn as the hero is, in dense bright letters: a big russet crest with pale tips,
  a short open amber jacket, dark trousers, pale wraps, a long vermilion scarf; his letters follow his size
  on screen as the hero's do. His paper copies no longer stand about waiting their turn: a copy only exists
  inside an attack. They appear in the air in a puff, already striking, and burst after their blow: all at
  once (one cue: one parry bursts them all; a held guard takes one blow; a roll out of the ring clears it)
  or one after another from every side. New: Two Leaves Fall, A Thousand at Once, the Burial (they bury
  your spot, then he springs off the pile), the Kite String, the Round reworked, copies that harry you while
  he shapes the Pearl (each that strikes feeds it). The Pearl is big: a pale blue-white orb with turning
  spiral arms, a copy at his side shaping it, a quiet rising whirr; the Twin Pearls (a copy drives a second
  from your other side, one red cue); the Moon-Swallowing Pearl giant, lifted by two copies; sometimes the
  body you struck was a copy and he is behind you. *Added:* phase 3's **Heaven-Devouring Howl**: he leaves
  for the rim and summons the Nine-Tailed Fox, a dark sun gathers at its jaws, the red cue, and a beam rakes
  the terrace, sweeping toward you one way only (roll back through it), breaking what stands in it; then he
  kneels open. Phase 3's fire is orange-red. Training: three situations of his own; the Lab: pack and Howl
  buttons. Every look waits for the owner's pick behind a switch (`?foxLook=h1|h2|h3`, `?foxLetters=`,
  `?foxfire=`, `?foxFire3=`, `?foxSpirit=`, `?clones=`). *Removed:* Scattered Leaves, the copies' cutting
  turn, Fox Descending's springboard off a standing copy.
- **The grove's bamboo falls to every stroke** (2026-11-22, ADR-151). *Changed:* in the Windless
  Grove one swing of the sword (or one blow of his) cuts a bamboo stalk clean through where the blade
  passed, and its top slides off the cut at once and crashes over in a burst of leaves (it took two
  cuts, and fell whole from its foot). A swing through a clump cuts the whole clump. *Changed:* the
  bamboo is five kinds of cane (green, jade, golden, black, dry) in clumps and lone stalks of
  different thicknesses, with young shoots, and far more of it behind the duel; the grove runs on
  into the fog. `?bamboo=0` is the grove as it was, `b` one kind of cane per clump.
- **The Sheathed, easy to see** (2026-11-22, ADR-152). *Changed:* Lu Wusheng is printed in the hero's
  ink-line art (the owner's pick; `?sheathArt=0` keeps the wyrm's digits he shipped in), lifted to read on
  the grove's floor: at 1280 x 720 the mean of his pixels is 31.9 against the floor's 16.1 (the hero 25.2
  against 20.1), and robe, trousers, scarf, hair and skin are shapes of their own. His silhouette is
  sharpened for the outline: a loose robe to mid-thigh over the wide pleated trousers, a longer high tail
  with a pale tie, a deeper scarf whose tails hang close when he is still, pale wrist bindings. He moves as
  a wanderer: a quiet carry with his thumb in the sash and a slow breath, a low run with the sheathed sword
  held back at the hip, a settle that turns sharp (poses only: no timing, tell or damage changed). New lines
  for the grove and eight move names (ids unchanged). *Added:* three palettes, `?sheathTone=a|b|c`, and a
  mark of his own, `?sheathMark=a|b|0` (a torn strip on the scabbard that snaps on the draw; a white streak
  in the hair); the owner picked palette a. The owner then found the ink-line print too detailed at fight
  distance: `?sheathArt=0|1|2|3|a` renders five graded steps from the digits to the ink-line art (1 and 2
  the digits in his colours with a stroke outline, 3 the ink-line art flattened), and prints 1 - a wear
  a reworked body that hides the mesh at his size (full sleeves, one roll of scarf, plain gaiters). The
  owner picked step 2 (the digits in his colours, lit and outlined), which is what the game now draws. `sheath.mjs` LOOK.
- **A sixth level: the Windless Grove and the Sheathed** (2026-11-22, ADR-144 – ADR-146). *Added:* a fifth
  level, `?level=grove` (the title screen lists it). **The Windless Grove**: a bamboo grove at night, a
  round clearing with a worn ring of paving, a mound planted with forty swords. **Lu Wusheng, the
  Sheathed**: a wandering swordsman whose blade stays in its scabbard. Everything he does with it sheathed
  is blunt (the scabbard, the pommel, a shoulder, a foot); his draw is one blink-fast cut. He settles, goes
  still, a click and the blue flare at the scabbard's mouth: parry it, or roll through it; a held guard
  keeps you alive but is knocked open; nothing else lives. He never draws on a hero who is down or whose
  guard is broken, and a chain of draws goes on only past a dodge. Three phases: the Sheath (one draw),
  A Thumb's Width (draws from three stances, a draw that crosses the whole ground), the Held Breath (three
  draws in a row from three sides, cuts that hang in the air and land on the click). The bamboo falls on the
  click of the sword going home, never on anyone. **The first fixed reward: One Breath.** Beat him and the
  hero learns a draw-slash: guard, then hold heavy (on touch: slide from block onto heavy); release to cut
  five metres in a blink; released just before a foe's white or heavy blow lands, it beats the blow aside.
  The engine gains optional beat fields (`draw`, `stopOn`, a move's `recoverOpen`) and takeHit's
  `breaksGuard`; the world's `light` pieces. He ships as the Wanderer (a slighter man in a faded indigo
  robe, a long sand scarf, dark hair in a high tail), the owner's pick of four bodies; the other options stay behind `?sheathLook=`, `?drawCut=`, `?grove=`. `tests/integration/sheath.mjs`.
- **A fifth level: the Foxfire Terrace and Wen Yao, the Thousand-Body Fox** (2026-11-21, ADR-147, ADR-148).
  *Added:* a fifth level, `?level=fox` (the title screen lists it). **The Foxfire Terrace**: a round
  terrace on a moonlit hill shrine, stone lanterns and seated stone foxes on its rim, wooden charm posts
  hung with paper round it, a great stone fox and a spirit gate. **Wen Yao, the Thousand-Body Fox**: a
  masked bare-handed fighter who tears paper copies of himself off his body. They walk at you and strike
  as a pack, one at a time, with the same white cue as his own blows; a single cut pops one (a heavy cut
  pops the one beside it too; a parry pops it). The real one is always the one you are locked on to, the
  only one with a shadow, the one who holds the Pearl. He shapes the Pearl of the Hollow Moon in his open
  palm, a copy holding it with him and every other copy feeding it a thread, then dashes in and drives it
  into you: red, stronger for every copy still standing. Pop copies to starve it, hit him twice while he
  shapes it to burst it in his hand, or roll. Phase 2 (four copies): he trades places with a copy
  mid-string, springs off a copy's hands at you, every copy strikes in turn round you before his own
  blow, three pearls thrown at once. Phase 3: the copies burn up into him and a nine-tailed fox of fire
  wakes round him, one more tail as his health runs out; a tail sweep, a long pounce, a black pearl he
  leaps down with; the charm posts and the hill's grass catch. Asleep he sits among four copies that tear
  into paper as he rises. His own test suite; the Lab and Training know him. *Changed:* the bone texture
  of the batched bodies grows when a level has more bodies than it holds; the other levels are drawn as
  before. Kept behind switches for the owner's pick: his looks (`?foxLook=`), the foxfire's colour
  (`?foxfire=`), paler copies (`?clones=b`). Recorded, not yet usable: his reward, the Paper Double. The
  level borrows music for now. Nobody has played it yet: his numbers are first guesses from bots.
- **Tian Lei in the orange gi, and the instant beam** (2026-11-22, ADR-150). *Changed:* Tian Lei, the
  Last Ascendant, now fights in an orange gi over blue with black spiky hair that stands up gold when
  he transforms: a homage to a famous fighter, under his own name. *Added:* **Instant Wave** in his
  third form: two fingers to his brow, he appears right beside you, hands cupped at his hip, and fires
  a beam point-blank (a red cue; roll or run off the line). Kept behind switches: his old tunic and two
  more homage outfits (`?ascLook=a|g|v`), every beam out of cupped hands (`?ascBeamPose=cup`), the
  great orb as a pale gathered sphere (`?ascOrb=c`).
- **The letters come off where the blow lands** (2026-11-21, ADR-132; on by default, the owner's
  pick; `?chip=0` turns it off). *Added:* bites. Every tree, stone, boulder, pillar, statue, bone and landmark piece is
  made of bricks, the blocks of letters it is drawn with, and a blow takes the ones nearest where it
  struck (the owner: "have the ascii pieces fall of exactly where the player or enemy boss is
  hitting ... like minecraft/lego"): a blade cuts a notch into a trunk at the height it bit; a heavy
  blow knocks the face of a standing stone back; a blast eats the side of a tree that faced it, where
  before it took the tree's top. Each brick falls as its own letter from where it sat and some stay
  lying. How much a piece takes, when it falls and what it deals are unchanged. *Changed:* the
  hero's blade marks a piece at the blade's own height (about 0.3 m higher than before). With bites
  on, the blade STOPS on what it does not cut through (the owner: "the sword should stop when it hits
  it instead of going straight through it"): a freeze, a shake, sparks off stone, a moment stuck in
  wood, then it is thrown back; a cut that fells the thing goes through. The chips fly out of the
  struck face. On by default (the owner tried it behind `?chip=a` first); `?chip=0` or the Lab's
  WORLD -> Bites turns it off.
- **Cuts land with weight: the hit printed where it lands, the boss's body answers** (2026-11-22, ADR-149).
  *Added:* four new pieces on every cut that lands, each behind its own switch ("i want the hits to
  look realistic where it lands and show some kind of ascii animation to show the impact"). On a
  human boss the hit is printed into his letters where the blade meets him: a short stepped
  animation (about a sixth of a second) shaped by the attack, a slit that opens and splits for a cut,
  rings round a thrust, a star for the slam, on black so it reads over him, never over the hero. A
  pressure wave runs out through the struck boss's letters from the contact: a thin bright front with
  a darker trough behind it, the letters pushed outward as it passes; small for a light cut, across
  the wyrm or a man head to feet for a slam, a cleave or the execution. The struck body answers where
  it was hit: a duelist's head snaps along the blade, his torso twists with the cut (a thrust folds
  him), a struck leg buckles; the wyrm's snout snaps away and the neck carries it, a body cut shoves
  the trunk and lashes the tail, a wing jerks and folds. A heavy blow (the slam, the cleave, the
  execution, a heavy branch's cut, the flurry's last blow, a crit) adds a low sub under the hit, and
  the music (never the tells) dips for a moment. *Changed:* nothing else: the reactions are drawn
  only (no hurt sphere, hit stun, shove, guard or timing moved), and with every piece off the game
  draws, sounds and plays as before. The owner's picks: the stamp on the human bosses only, a human
  boss's reaction drawn at x1.5, the wyrm's at x1. `?impact=off` (or a list: `?impact=stamp,react`)
  and the Lab's 'impact' row switch the pieces; `?stamp=instead` draws the stamp in place of the
  slash line (an option). *Changed:* the light at the moment a cut lands is a little calmer (the
  owner's pick of three levels): the struck boss's white flash, the blade's lit steel, the sparks and
  the swing arc where it crosses the contact are dimmed, so the new pieces show; `?calm=0` draws it
  as before, `?calm=2` / `3` calmer.
- **Round the Obsidian Throne, what the challengers left** (2026-11-22, ADR-133). *Changed:* the
- **Tian Lei's third wave: the sign, the counter stances, the great orb and the barrage** (2026-11-22,
  ADR-135). *Added:* in the Skybreak Ring, **the sign**: from his second form, Tian Lei raises two
  fingers to his brow, a snap of light, and he is gone and behind you (or at your left, your right and
  then behind you in Thunder Ascension's Three Signs), the blow still to come: when the hand goes up,
  turn. **Counter stances**, one a form: he stands with his palms open and light drawn into them. Cut
  into it and he CATCHES your blade, throws it back and punishes at once; wait, and the stance ends on
  nothing with his guard down. **Heaven's Lantern** (forms 2 and 3): he rises and gathers a great orb
  of gold over his hands, the ring's light draining to it, and throws it at where you will be. A parry
  or a block is safe and a roll passes it; a PERFECT parry stops it on your blade and starts THE PUSH:
  mash attack to throw it back into him for a huge blow that leaves him reeling, or lose and be thrown.
  **Raining Suns** (forms 2 and 3): he leaps and pours sixteen small blasts down round you, then a
  bigger one a perfect parry returns. Three more ripostes out of his guard. *Changed (the engine, for
  him):* a boss's beat can be a counter stance and a vanish can wait for its sign; the other bosses are
  unchanged. Kept behind a switch for the owner's pick: the orb's look (`?ascOrb=a` a sun, `b` a
  lantern). Nobody has played it yet.
  felled forest round the Obsidian Throne's crater (the same straight log again and again, laid in a
  starburst) is gone. In its place lies what those who came for the Starless Lord left behind: graves
  of swords stuck in the earth, spears with a torn red banner, wanderers' cairns with a straw hat and
  a sword, wrecked carts on their sides, a few steles on stone turtles and split boulders, each one
  built differently, all in the dragon look. Faces turn toward the camera, what fell lies the way the
  blast threw it, and nothing tall stands between the camera and the duel. About 70 of them within
  reach break where they stand and the wooden ones burn (stone leaves rubble). The owner's pick of three rendered options
  (`?outskirts=a` a shrine, `b` the star's debris, `m` all of them, `0` the felled forest).
- **On a phone: the health bars no longer overlap, and two new ways to hold the controls** (2026-11-21, ADR-131).
  *Fixed:* on a phone in landscape the hero's HP row ran into the boss's bar (Safari gives an iPhone
  about 734 px of width: the hero's row ended at 242 px, the boss's began at 217). The top row is now
  fitted to the screen: on a narrow touch screen the hero's meters are 16 cells and the HP reads as
  one number, and the boss's bar takes the room between them and the corner buttons, shorter when it
  must be (it also no longer runs into the hero's rows in a narrow desktop window). *Added:* two
  switches in the pause menu, both off by default. PAD LAYOUT "guard on left": GUARD is a button
  beside the stick, so the right thumb cuts while the left one parries; the right pad keeps ATTACK,
  HEAVY and DODGE. HOLD ATTACK: a thumb that rests on ATTACK keeps cutting (it stops while the guard
  is up). `?pad=split` and `?hold=1` open the game with them on.
- **The hero looks the same on every screen** (2026-11-21, ADR-130). *Changed:* the hero is drawn with
  the same letters on every screen and at every camera distance: about 9 across his cloak, the look
  of the owner's reference picture ("the exact type of feel and look i want ... make the character
  have this feel on every angle, movement, attack"). His letters were a fixed 4 pixels, so only a
  720p frame and the phone showed that figure; at 1440p he had twice the letters at half the size.
  His outline steps with the letters. From the front and the side he is one dark figure: the plate
  on his legs, arms and boots takes the cloak's dim dotted rim (white outlines drew two hollow
  legs). The blade is dark steel at rest and lights white only while it cuts, charges, or in the
  flurry and the plunge; its halo of dots at rest is gone; the swing's arc is unchanged. The human
  bosses are drawn exactly as before. No hit, tell or timing changed.
- **A fourth level: the Skybreak Ring and Tian Lei, the Last Ascendant** (2026-11-21, ADR-129). *Added:* a fourth level, `?level=ring`
  (the title screen lists it). **The Skybreak Ring**: a tournament ring of stone tiles on the badlands,
  buttes standing round it, braziers at its corners. **Tian Lei, the Last Ascendant**: a bare-handed
  fighter with three health bars. Empty a bar and strike the deathblow, and he does not die: he
  transforms. *The Challenger* fights with fists, feet, elbows and knees, a kicked floor tile, a thrown
  blast (a perfect parry sends it back) and one beam. *Golden Ascension*: a golden flame stands round
  him and his hair rises; he vanishes and strikes from behind, launches you and is waiting where you
  land, pours out volleys, throws a disc that comes back, drags a beam across the ring, rises into the
  air and rains strikes, and breaks the floor under you. *Thunder Ascension*: lightning in the flame, a
  storm over the ring that drops bolts all form long, strings where every blow comes out of a vanish,
  a cage of orbs, and his great beam: stand your ground and parry its head at the blue flash and you
  enter a struggle (mash attack) to cut the beam in two and leave him reeling. Every beam can be
  stepped off, rolled through or held on a guard (a guard pays guard, never health). The ring is wrecked
  as you fight: tiles crack and break under heavy blows, beams cut trenches and take the tops off the
  buttes, and by the end about half the floor is rubble. The light changes with his form: dusk, gold,
  storm. About forty moves; his own test suite. *Changed (the engine, for him):* a boss's blow can be
  placed on a limb, can hit from the air, can stay lit (a beam), and the blade lock can be fought at
  range. The other bosses are unchanged. Kept behind switches for later: two more arenas (`?ring=b|c`),
  two more outfits (`?ascLook=c|d`), two more auras (`?ascAura=b|c`), a second beam (`?ascBeam=b`). The
  level borrows music from the other levels for now. Nobody has played it yet: his health (2000 a bar)
  and the fight's length are first guesses from bots.
- **Felled trees lie as the blow left them** (2026-11-21, ADR-128). *Changed:* a felled tree no longer
  leaves the same stump and the same straight log as every other ("make the cleared trees not look
  the same and have it broken in different angles based on how it was hit"). A blade cuts the stump
  high and on a clean slant, a blow knocking a tree over tears it lower and higher on the side it
  fell to, a blast shatters it low; a tree burnt through leaves a low black stump. The fall turns off
  the blow's line and rolls; the trunk turns as it lands, rests with its far end raised, and often
  breaks in two with a kink (more often for a blast than a blade). *Added:* crooked trunks with a
  snapped bough; some trees that burn through stay standing as black snags. No hit, tell or timing
  changed.
- **The Cinder Wyrm glares from every side** (2026-11-21, ADR-127). *Changed:* the drake's eyes
  are slanted almonds with a point at each corner, the outer corner high, turned out, up and
  forward, under a brow that drops low over the snout and rises steeper than the eye: an angry
  glare from the side, the front, three-quarter and below (the owner liked it in the standing view
  only, where the old sideways oval happened to tilt). A bony rim behind each eye and a slanted
  dark hollow around it seat the eye in a socket; the owner then had the eyes made a quarter
  smaller. *Fixed:* the resting neck looked broken: the lean build's neck rose almost straight up
  and the head hung ~56° nose-down off its top. The neck now arches over into the head (a hinge of
  ~10-35°), and the resting head is held level about its snout (it rolled up to ~40° watching a foe
  far to one side). Nothing about the fight moved. Four anime faces were shown first and turned
  down; they are not kept.
- **The Ash Disciple and the Starless Lord move like swordsmen** (2026-11-21, ADR-126). *Fixed:* the human bosses' attacks read as a
  row of held poses with a snap between them (the owner: "weird attack animations and unnatural
  poses"). Measured on both, every move: the sword hand crossed up to 0.6 m in ONE frame on a blow
  (the whole follow-through had 0.05 s), their feet never left the floor while the body slid metres
  through a string, an overhead left him bowed and two-handed for the rest of a string, and the
  Lord's blade went through his own hood as each string ended. Now a cut swings: it speeds up into
  the blow and slows through a follow-through of its own length, which runs straight into the next
  cut's wind-up; a baited pause holds still and then strikes at full speed. Their feet hold their
  ground and step as a string carries them forward. Shen Hui's spare arm guards his chest and sweeps
  back in a cut (it stood out sideways at shoulder height), his overhead is raised clear of his hat
  and ends with his eyes on you, his thrust drives through, and his whirl turns on a hop instead of
  winding his legs. The Lord's end-of-string roll of the blade turns before him, clear of his hood,
  and in his two-handed forms the hilt stays where both hands reach it. *Unchanged:* every tell,
  windup, flash, impact time, reach and damage number; `npm test` is green without a changed
  threshold. *Added:* the `motion` scenario of `tests/integration/duel.mjs`.
- **The wall of trees comes down and the fight goes out through it** (2026-11-21, ADR-125). *Changed:* in Cinderwood the
  hero is no longer held on a fixed circle once the forest's wall starts to fall ("the outer tree
  border ring should slowly crumble and allow the dragon and player to move outside"). Where a tree
  of the wall has burnt through or been felled, the ground behind it is open, out to the next tree
  still standing; the wall is about seven trees deep, so it opens tree by tree, up to 62 m from the
  centre. The wyrm follows through any gap wide enough for its body (a narrow one lets only the hero
  in; its fire, its shots and its tail still reach, and what its body brushes at the mouth comes
  down). Meteors, pillars and the barrage follow the hero out there, and a tree falling onto ground
  he can now stand on is a red blow again. A death, a rest or the Lab's Restore stands the wall up
  again. Nothing moves until the first tree is down: a fight starts as it always did, and no attack
  changed. *Added:* the feed says once a fight that the wall is torn open; the minimap shows the
  opened ground and draws back to keep the hero on it; stumps stand in the way out to the forest's
  depth; the Lab's WORLD section has **Open wall**. Measured over a 4-minute headless fight (three
  seeds): 86 - 90 of 120 directions open at the end, the furthest 51 - 54 m out, the hero's ground
  about half as large again.
- **The Cinder Wyrm has a new face** (2026-11-20, ADR-124). *Changed:* the wyrm wears the
  drake, the owner's pick of four faces rendered side by side ("It doesnt look realistic or scary"):
  a sculpted skull with a long hooked snout, a heavy brow over each eye, cheekbones and a stop before
  the brow; two long horns swept back over the neck, a shorter pair under them, a horn over each eye
  and three cheek fins. The face is drawn in finer scales under a harder light, so brow, snout, cheek
  and jaw read as planes; the eyes are burning slits in black sockets; the mouth is a black cavern
  with a red tongue, fangs of different sizes and the fire at the back of the throat (it still flares
  as the breath charges); the neck's quills are shorter just behind the skull, so its outline stands
  free. Nothing about the fight moved: the head, the mouth, the jaw's hinge and every hit volume are
  where they were, and so are the breath's and the bite's origins. The face before is kept behind
  `?wyrmFace=old`; the three turned down with the drake (`tyrant`, `viper`, `revenant`) and the
  three of ADR-120 stay behind the same switch and the Lab's head row. *Fixed:* in a string, the
  wyrm's bite no longer lands after its flash promised it: a hero standing right under the snout
  (Cataclysm's held bite at 3 m) was caught by the lunge a tenth of a second late; the bite now
  connects at most 0.07 s after its impact and otherwise misses (`TUNING.biteLate`).
- **The Cinder Wyrm is leaner and carries its head high** (2026-11-20, ADR-123). *Changed:* the wyrm has a
  leaner build, picked by the owner from rendered sheets ("more menacing, a bit more slender"): a
  tucked waist and a shallower chest (the back's line stays, the belly rises), thinner neck, legs
  and tail, longer talons; a narrower head with longer fangs, horns and frills; a mane of quills
  down the neck and longer thin spines down the back and tail. While it stands it carries its head
  about 2.5 m higher, on a neck that rises in one curve instead of coiling back. Its letters,
  colours, scales and wings are the ones it had. Nothing about the fight moved: the skeleton, the
  hit volumes, the reach and the timing of every attack are the same, and an attack's head is on
  its measured path as before. The wyrm before is kept behind `?wyrmLook=0` (`a` and `b`: the two
  steps between; the Lab's build row). *Fixed:* the fire on the horns of the unshipped phase-3
  look (`?ablaze=c`) stood half a metre under the horn's tip; it is measured off the built horn now.
- **The Ash Disciple and the Starless Lord fight harder, in arenas that break** (2026-11-16, ADR-122). *Changed:* both human bosses give far fewer pauses and
  their moves flow into each other, at the same damage per hit: against a hero who only defends,
  Shen Hui gives about 78 / 92 / 99 tells a minute by phase (60 / 76 before, in two
  phases) and the Starless Lord 83 / 91 / 98 / 109 by form (71 / 80 / 75 / 85). A move now follows the last
  one by where you are standing, and starts while he would have been walking back to his guard;
  your own openings (after a parried last blow, a stagger, a break) are as long as before. Two
  attacks that need different answers never land within a third of a second of each other: a blow
  waits at its cock, or a strike comes late, instead (the Lord had about three such overlaps a
  minute before). Thrown pieces (the kicked lantern, Void Hurl, Glass Rain) show no mark on the
  ground: the flash on the flying piece is the cue. A white or blue blow out of the Lord's blink
  can be guarded from any side. *Added:* **Shen Hui has a third phase**, from 36 % health: ash on
  the wind. He vanishes into ash between blows and strikes from another side, leaves afterimages,
  has an eleven-blow flurry and a storm of sword qi. Sixteen new moves across his phases: strings
  with a glide, a kick or a spin that travels, a feint from the other side, a nine-blow string that
  catches a hero who steps back, and in phase 2 cuts that leave lines of fire on the stones (step
  off them: a held guard holds for about a second and a half, then opens; it never costs health).
  **The Starless Lord casts inside his strings:** bolts between cuts, a pull into the string, the
  off blade thrown as a wheel and caught, stones that orbit him and fire in the string's pauses,
  blink strings, and in his last form strikes of the Starless Sky that keep falling in ones and twos
  and Starless Night, three waves across the whole crater. Nineteen new moves across his forms.
  Both bosses use the floor: flagstones levered up and kicked, plates torn up in a line, a ring of
  plates lifted and dropped. **Both arenas break:** the paving and the crater's plates crack and
  shatter under heavy blows, the courtyard's two colossi can be cut down (onto either fighter), and
  the wreckage stays for the rest of the fight. Effects with bodies: the Kindling, ground shocks,
  sword qi, the Dark Star, each form's ignition. The bosses' bodies show the fight: Shen Hui's hem
  smoulders in phase 2 and he loses his hat in phase 3; the Lord's cape tears form by form and his
  faceplate splits in the last. The Lab has a LOOKS section. *Fixed:* the Lord's flurry was always
  four blows whatever its count; one bite of the wyrm (Furnace Maw) was cued up to a tenth of a
  second early on one side. Every look is the owner's pick from rendered options; `?looks=old`
  shows the effects and floors as they were, and each switch (`?qi=`, `?star=`, `?ashLook=` and the
  others in docs/STYLE.md) shows a look that was turned down.
- **The wyrm burns in phase 3, the forest breaks, the letters follow the zoom** (2026-11-16, ADR-120).
  *Added:* in its third phase the Cinder Wyrm sets itself on fire. The phase 3 roar ends with fire
  running out along its wings, legs and tail; from then on its wing tips, claws and tail burn, and
  the flames trail behind fast moves: a wing sweep leaves an arc of fire, a tail whip a ribbon. Trees
  it passes can catch. Its footprints smoulder with small flames that do not hurt; its attacks, their
  damage and their cues are unchanged, and the fire dims round every flash. Every tree of Cinderwood
  can now break, out to the edge of the forest (664 breakable things instead of 183), and a tree
  wears down in stages: leaves burst off, the crown thins, it leans, it falls and leaves a log and a
  stump. The Elder Wyrm's skeleton comes apart bone by bone, the Cinder Tree bough by bough, and the
  bone nest breaks; broken bones leave heaps. The bonfire stays. The wyrm reaches the tree wall from
  inside the clearing: its roars, shock rings, wing beats, take-offs and landings send wind that
  strips the wall's crowns, and fire that misses the hero carries on into the trees; after a full
  fight about two fifths of the wall's front rows are worn, felled or burnt. Trees of the wall fall
  outward, away from the fight. A sound for a tree wearing down. *Changed:* when you zoom out on a
  desktop, the small letters of the wyrm, the stones and the trees get smaller with the picture, so
  things keep their detail at the furthest zoom (they lost about a third of their letters before).
  Nothing changes at the default zoom or on a phone. The owner's pick of three options each for the
  zoom and for the fire (b for both); `?zoomArt=a|c` and `?ablaze=off|a|c` show the others. Three
  new heads for the wyrm were built and shown (a predator skull, an Eastern loong, a horned demon);
  the owner passed on them for now, so the head is unchanged and they wait behind `?wyrmFace=`.
- **The Cinder Wyrm fights harder, with its whole body** (2026-11-15, ADR-119). *Changed:* the wyrm
  gives far fewer pauses and its attacks flow into each other: about 34 tells a minute in phase 1,
  59 in phase 2 and 78 in phase 3 (26, 42 and 45 before), with the same damage per hit. It now picks
  from a mix of claws, jaws, wings, tail, fire, flight and terrain, meets a hero who rolls behind it
  with its tail, and drops small fire of its own from phase 2. The fire breath comes from a braced
  stance and is redrawn as a widening torrent; the shock rings are rolling fronts of fire and dust
  that slow and tear instead of thin circles; the apocalypse has columns of fire, a burning sky and
  meteors with bodies. Thrown trees and boulders take about 1.5 s instead of 3, are torn out with the
  whole body, and show no landing mark: the red flash on the flying piece is the cue. *Added:* six
  attack types (wing sweep, wing slam, tail whip, tail slam, a bite that ends in fire, a burning claw
  rake) in seven new combos, the longest nine hits in phase 3; three flying combos of two, three and
  four attacks in one flight; Cinder spit, Ember rain and Fire lanes; more flame rings and a second
  flame wall in later phases. The whole clearing breaks: 183 objects instead of 80, the wyrm fells
  trees by charging, sweeping its tail, landing and flying low, wreckage stays on the ground for the
  rest of the fight, and fire spreads from tree to tree. *Removed:* the blue homing wisps, and the
  spinning in the Scouring breath (now fire that crawls along the ground in tongues) and the Ember
  torrent. The shock ring, the fire breath and the apocalypse are the owner's pick of three looks
  each (a for all three); `?ring=`, `?breath=` and `?apoc=` (b or c) show the two turned down.
- **Red, blue and black flashes: dodge, parry, and a charged blow** (2026-11-15, ADR-118). *Changed:*
  a boss's dodge-only attack no longer glows red while it winds up and no longer draws a red ring on
  the floor. Its only sign is **a red flash**: a wide streak of light through the weapon, across the
  screen, at the moment to dodge. Dodge in time and the hero answers with his flurry, as before.
  Things that land away from the boss (meteors, sky bolts, a falling pillar, thrown stones) keep
  their mark on the ground. *Added:* **a blue flash** marks a blow to parry. Parry it and the boss's
  combo ends there and the hero counters by himself: the streak's flash cuts, the last a counter
  blow (64 damage). Twelve existing heavy blows are parry moments now (the wyrm's bite, Falling Ash,
  Falling Star and others). **A black charged attack** for every boss: darkness gathers on the
  weapon for about a second and a half, then a black flash and a long cleave (the wyrm: Black maw;
  Shen Hui: Black Tide; the Starless Lord: Nightfall). Dodge it. Block or parry it and it deals no
  damage, but the whole guard meter is gone and the guard is knocked open. New moves: Shen Hui's
  Severing Wind (parry) and Twin Embers (dodge, dodge), the Lord's Severance and Red Meridian.
  *Fixed:* about one perfect dodge in four of a duelist's red blow was answered with no blow at all
  (the riposte's entry had got into the list of finishing arts). `?flare=star` and `?flare=lance`
  show two other looks for the flash; `?flare=blaze` the old red burst.
- **Dark music for every level and every boss phase** (2026-11-15, ADR-117). *Changed:* the music is
  no longer synthesised. Each level has its own dark exploring track, and every boss phase has its
  own track that takes over when the phase changes: the Cinder Wyrm's three phases, the Ash
  Disciple's two and the Starless Lord's four forms, plus a short victory fanfare and a game-over
  theme. All 14 tracks are CC0 from OpenGameArt, picked by ear on an audition page (credits in
  `assets/audio/CREDITS.md`). The synthesised music remains the fallback while a track loads, and
  with `?music=synth`; the Lab's VIEW section can switch between the two. Sound effects are
  unchanged.
- **What's new in the menu; the phone camera stays back** (2026-11-15, ADR-116). *Added:* **WHAT'S
  NEW**, a button in the title screen's top-right corner and an item in the pause menu: every
  version and what changed in it, newest first, in short notes. A badge counts the entries you have
  not read yet ("3 NEW"); they are tagged NEW in the list, and closing it marks them read (this
  browser remembers). *Fixed:* on a phone, a duel's slow-motion moments (perfect deflect, blade lock,
  counter, mikiri, execution) took the camera in to about 9 m, knees only: their zoom is now scaled
  for the phone's closer camera like every other camera move (about 12.6 m). On an iPhone, a quick
  double tap (mashing ATTACK, LOCK twice) zoomed the whole page in about 2x and it stayed stuck
  (pinching back out is blocked in play): double taps are now blocked everywhere in the game, and a
  page that gets zoomed anyway is put back at once. `?camdebug` shows a one-line readout (page zoom,
  camera distance, canvas size) for a report from a phone. *Changed:* the title's credit line reads "prototype v0.4.0"; the docs and the
  code no longer name the game that first inspired the look.
- **A heavy attack, and five heavies to choose from** (2026-11-15, ADR-115). *Added:* a HEAVY button (right
  click, R2, and a fourth tile on the phone). Pressed on its own it is a dashing two-handed thrust;
  pressed after the first, second, third or fourth light of the combo it is that point's own heavy:
  a rising cut that staggers a duelist, a full spinning sweep, a falling cut that breaks through a
  raised guard, and a bigger slam. *Changed:* holding HEAVY charges the dashing cleave (it was
  holding attack), so a light attack now comes out the instant you press it. Block / parry moved to
  the middle click and lock-on to Tab; saved key bindings start over on the new defaults. The phone
  pad is a 2 x 2 square: BLOCK and HEAVY on top, DODGE and ATTACK below.
- **The hero stands like a swordsman** (2026-11-15, ADR-114). *Changed:* when he is not attacking he no
  longer holds the sword out sideways with both hands hanging. Exploring, he stands at ease: one
  hand on his belt, the blade carried down the line of his arm. Locked on, or anywhere in a boss
  fight, he takes a fencer's guard with the point on the enemy, and keeps it up while he moves
  (only a sprint trails the blade). He breathes, shifts his weight and looks around, and the
  blade's point drifts: five times more movement than before, so it shows at the game camera. The
  idle actions (the stretch, the twirl, ...) now play only at ease. *Fixed:* the sword wrist was
  bent 27°; it is about 6° now. The Lab's PLAYER section can hold either stance (`stance`).
- **Fire, spells and effects made of the same small letters** (2026-11-15, ADR-113). *Changed:* fire
  is no longer loose glowing symbols. Every fire of the Cinder Wyrm (the breath, fireballs and their
  blasts, meteors, eruptions, the flame ring and wall, the burning pass, the nova, ember bullets, the
  Scouring breath), the bonfire, the crater's vents, burning grass and burning trees is now one body of
  small digits: a white-hot heart, an orange body, red tongues that climb and tear off, grey smoke.
  The Ash Disciple's and the Starless Lord's effects are drawn the same way: lightning is a jagged
  path of bright strokes in a violet sheath, crescents and blade trails are arcs of strokes, the
  Void burns violet. The Lord's spells are white and violet now instead of red; his blade is still
  red. *Changed:* one set of timing cues for all three bosses: a white cross for a blow you can
  parry, a larger eight-point star with a ring for a heavy one, a ragged red blaze for one you must
  dodge. Ground warnings are as before. *Added:* letters beside a flame boil in the heat; the dying
  wyrm comes apart letter by letter; a cut knocks a few of its digits loose; the glow of a breath
  rises from its belly to its maw before the fire comes. *Changed:* the landmarks are rebuilt to
  read at a glance and stand where the fight's camera looks: the sect gate is beyond the east
  pillars (it was to the north), the stone swordsmen stand in the pillar ring, the cauldron on the
  paving, the elder wyrm's skeleton along Cinderwood's east rim. *Not changed:* the hero's own effects, and the wyrm's blue and red wisps.
- **The Ash Disciple uses the courtyard** (2026-11-15, ADR-111). *Added:* four moves on the pieces of
  the Ashfall Courtyard. **Severed Pillar:** he is suddenly behind the pillar you stand under and cuts
  it through; it falls on you along a strip marked in red (walk out of it, or roll as it lands).
  **Flying Lantern:** he kicks a stone lantern at you; a pale ring shows where it comes down and it
  glints before it lands: parry it and it bursts on your blade, or leave the ring. **Three Tolls:** he
  leaps to the fallen bell and strikes it three times; each blow sends a ring of sound across the
  courtyard: parry the three in rhythm or roll through them, or run in, since close to the bell they
  pass you by and his back is open. **Swallow's Return:** when you press him he leaps back onto a
  pillar and dives off it at you from another side (parry the dive, or step aside). He only does these
  with a piece in reach, and each lantern and pillar is used up for the fight. *Dev:* a TERRAIN
  category in Training stages each one.
- **The Cinder Wyrm uses the ground** (2026-11-15, ADR-110). *Added:* three moves that take what
  stands in the clearing. **Uproot and hurl**: it bites into the nearest tree or boulder, tears it
  out and throws it; the ground glows where it will land and follows you until the throw (red:
  be out of the glow or roll through it). **Tail bat**: its back to a boulder, one lash of the
  tail, and the boulder skims the ground at you along a glowing line (blue: parry it and you cut
  it out of the air, or take it on the guard, step off the line, or stand behind a tree or a
  standing stone, which stops it). **Firebrand** (from phase 2): a tree in its jaws, lit with a
  breath and thrown burning; its wreck burns on for 3.4 s and the grass round it catches. The
  wyrm only does these with a piece in reach, and what it throws is gone until the fight resets.
  *Dev:* the three are in the Lab's ABILITIES and Training's BOSS MOVES.
- **The Starless Lord uses the crater** (2026-11-15, ADR-109). *Added:* three moves on the pieces of
  his level. **Void Hurl** (every form): a stone that hung in the air, or a shard torn out of the
  floor, comes to hang beside him and is thrown at you; the place it lands is ringed in red as it
  leaves his grip, with time to run out of it, and glints just before. **Glass Rain** (forms 3 and 4): three at once, one after another.
  **Crown Fall** (forms 2 to 4): when you stand beside something tall, he wrenches it down on you; the
  strip it falls on is marked. All three are red: run out of the ring or the strip, keep moving, or roll. The stones in the air
  drift slowly while they wait. Stagger
  him in the windup and the stone drops. He only does them while there is a piece for them, and every
  piece stands again when the fight resets. Torn Stone now leaves the floor cracked where it tore.
  *Dev:* a TERRAIN category in Training for him.
- **The Obsidian Throne is open** (2026-11-15, ADR-112). *Changed:* the Starless Lord's level is no
  longer a walled hall. It is the crater where he fell: a round floor of cracked black plates round
  the red seal, the star itself split open behind his seat, shards of its glass standing in the
  floor, stones hanging in the air, a broken crown of slabs round the rim (low to the south, tall
  behind him), and the forest outside thrown flat with every trunk pointing away. There are no
  walls: nothing tall stands between the camera and the duel, and you can walk out between the
  slabs (he keeps to the floor, a circle of 13.6 m round the seal). He wakes when you step over the
  south lip onto the floor. The shards and the rim's slabs can be chipped, broken and felled and are
  cover; the stones in the air only chip. *Fixed:* a duelist's flurry against a hero at the edge of
  his floor: its blows came from spots he could not stand on and missed. *Removed:* the hall's walls,
  door, pillars, braziers, stone wardens and great swords.
- **The death screen names what killed you** (2026-11-15, ADR-108): under YOU DIED, small lines say
  which move dealt the last blow ("SLAIN BY LOTUS SWEEP") and which moves struck you in that
  attempt, with how many of their blows landed ("Swallow Flicks 3 of 3 blows landed"). The victory
  record gains "Struck most by". *Added:* the game now keeps a table of what every boss move did
  to you (blows seen, landed, blocked, parried, dodged, damage, deaths), added up over every
  attempt in this browser; `__telemetry()` in the console prints it for the level, the deadliest
  move first. Nothing leaves your machine.
- **The world breaks** (2026-11-15, ADR-107). *Added:* trees, standing stones, boulders, pillars and
  lanterns can be chipped, broken and felled, by every boss and by the hero; each blow leaves a mark
  as big as it was hard. A tall piece falls the way it was struck: under one a boss felled you take a
  red blow (its landing strip is marked, roll or step out); one you fell onto a boss hurts it badly
  and never hurts you. Anything 1.1 m or taller is cover: it stops the wyrm's bullets, a duelist's
  crescents and torn stones, and takes the Void's bolt, pull or grip in your place, until it breaks.
  Fire burns where it lands: grass under the wyrm's breath, fireballs, meteors, lava pillars, the
  burning pass and the dive catches, burns about 4 seconds (5 HP every half second if you stand in
  it), then is ash for the rest of the fight; a tree that catches burns about 7 seconds and falls to
  embers. Fire never spreads. The wyrm walks through trees. Everything stands again when the fight
  resets. *Changed:* Cinderwood has 7 dead trees, 4 young pines and 6 boulders inside the clearing.
  A broken piece comes apart into the characters it is drawn in. *Dev:* a WORLD section in the Lab
  (Burn ahead, Fell on me, Blast ahead, Restore).
- **You can see yourself behind the dragon** (2026-11-15, ADR-106). *Fixed:* the hero vanished
  whenever the Cinder Wyrm stood between him and the camera: north of its body, under a wing,
  behind it while it rears, under it while it flies low. *Added:* the parts of him that are
  covered now print through whatever covers them as a cyan ghost of his own line art (the colour
  of his blade), so you can follow where he is and what he is doing. It shows only where he is
  covered and only while he is; in the open he looks as before. It works through trees, pillars,
  standing stones and landmarks too. Duels are unchanged: a human boss in front of you is not
  drawn over. `?noseen` in the address turns it off (for comparing).
- **The same fight at any frame rate** (2026-11-15, ADR-103): the game used to simulate each drawn
  frame in one step of its real length, so on a machine at 30 frames a second a perfect parry's
  0.08 s window was looked at only two or three times, and under 20 frames a second the game ran in
  slow motion. *Changed:* a slow frame is now simulated in several short steps (two at 30 frames a
  second, up to six), each about a sixtieth of a second: the step every automated test of the
  combat runs. At 50 frames a second and above nothing changes. The game runs slow only under 10.
- **The riskier the answer, the more it pays** (2026-11-15, ADR-102): measured with bots, a player
  who only perfect-dodged beat every boss fastest and never had to learn a string. *Changed:* the
  flurry (and the plunge) now answer a perfect dodge of a **red** blow only. A perfect dodge of a
  white or heavy blow still dodges, counts in your streak and slows time where you stand, but his
  string goes on: build the streak on white blows, cash it on a red one or with a parried last
  blow. *Added:* the **flash counter**: attack at the last instant before a duelist's blow lands
  and your cut goes through his and through him (70 damage, he reels, the crit window opens); a
  moment too late and his blow lands. *Added:* a **perfect parry** now deals half again the
  posture and makes your next light cut twice as fast and a crit. *Fixed:* a blow of a boss's own
  flurry that fell short of you settled nothing, so blocking all of it did not always break him.
- **The flurry reads against the human bosses, and every blink leaves an ASCII afterimage**
  (2026-11-15, ADR-101). *Changed:* against Shen Hui and the Starless Lord each flash cut now shows
  the hero wound up for a moment, runs past the boss's side instead of through him, and slows into a
  finish you can see; the hanging cuts and flares are sized to a man; the camera no longer lurches.
  *Fixed:* the boss was thrown 0.3 m by every cut (he seemed to jump about), kept his own attack's
  pose while he was cut, and after the last blow stumbled back into the hero. *Added:* every blink
  (the Ghostep, the plunge, each cut of a flurry) leaves the hero behind as he stood, printed in
  rows of cold blue digits that fall apart from the feet up, while some of them fly to where he
  reappears.
- **The boss's bar at the top; QUIT TO TITLE** (2026-11-15): the boss's name, HP and posture moved
  from the bottom of the screen to the top centre. The pause menu has **QUIT TO TITLE** (press it
  twice: the first press asks), and RESUME is laid out like the other items.
- **Background objects drawn like the dragon, and landmarks** (2026-11-15, ADR-100): pillars, walls,
  standing stones, boulders, lanterns, the throne and its dais, bones, braziers, the bonfire and the
  fallen bell are now made of the wyrm's small digits: a dark body, brighter digits where light
  catches, an outline of stroke characters, no blank spots. *Fixed:* wall and pillar faces turned
  sideways printed solid bars instead of characters. *Added:* big set pieces in each level: the
  skeleton of an elder wyrm along Cinderwood's north rim and a great burned tree on its west; two
  colossal stone swordsmen, the sect's gate and an incense cauldron round the Ashfall Courtyard; two
  hooded wardens beside the Obsidian Throne and six great swords in its aisles. Floors, the hero,
  the human bosses and the trees look as before.
- **Training mode and a lab stage** (2026-11-15, ADR-099): press **F4** (or open the Lab and click
  TRAINING, or load with `?training`) for a fighting-game training menu: every situation worth
  seeing, by category, one click each: perfect dodges at every streak, each art, parries and
  ripostes, the blade lock, the trade clash, the mikiri, a boss's own flurry parried, blocked or
  let through, the chain, the cleave, the execution, getting hit, his phases, and every move he has
  answered the way you choose. The game plays your side for you, on the real timing windows, and
  says whether the situation showed what it should. Speed, loop and replay. Add `?stage=lab` (or
  the STAGE buttons) to fight any boss in a **training room**: a dark dojo with a cyan measuring
  grid and rings marked at 3, 6, 9 and 12 m. *Changed:* the Ash Disciple's streak flurry is called Scattering Ash.
- **An ASCII HUD** (2026-11-14, ADR-098): the overlay is now made of characters like the rest of
  the game.
  - **Meters are text.** HP, guard, the crit window, the boss's HP and its posture are rows of
    characters (`HP [################........] 104 / 160`), drawn straight on the game with no
    panel behind them. The piece you just lost shows pale for a moment before it drains.
  - **Big words are block letters.** YOU DIED, the victory line, area names and phase calls are
    built from characters in the style of the gcd title logo, and stack word by word on a narrow
    screen. The serif font is gone from the HUD.
  - *Removed:* the name / "Lv 12" / class lines of the player frame (they were decoration).
  - **The minimap barely exists:** a small faint disc (72 px on desktop, 40 px on phones) with no
    frame, title or coordinates.
- **Phone controls you can hold, and a guard meter** (2026-11-14, ADR-095, ADR-096):
  - **The right thumb's pad.** ATTACK, BLOCK and DODGE are now three large tiles that touch each
    other, moved up and in from the corner. Slide your thumb from one onto another without lifting:
    the first lets go and the second presses. A touch that lands a little off still counts for the
    nearest tile. In the pause menu, PAD POSITION (low / mid / high) and PAD SIZE (small / medium /
    large) move and size the cluster while you watch it; the choice is remembered. FLASK sits above
    DODGE, LOCK moved up beside pause.
  - **The guard meter.** A steel bar under your HP (and a gauge on the BLOCK tile). *Changed:* a
    blocked blow now costs guard instead of HP (it used to let 20 % or 50 % of the damage through).
    If the meter runs out on a blocked blow, that blow is still blocked but your guard is knocked
    open for half a second (GUARD DOWN). It refills by itself in under two seconds whatever you are
    doing, every parry gives a large piece back at once, and every hit you land gives a little.
    Fire breath and bullets met on the guard chip HP as before and do not touch the meter.
  - **The lock-on marker** is a small, dim diamond that shows when you lock on and fades away
    within three seconds.
  - **Play upright** (ADR-097). Holding the phone in portrait no longer asks you to rotate it: the
    game plays on with the stick lower left, the pad lower right, your frame and the boss bar on
    top, and a wider view so the fight still fits the narrow screen.
  - **Controls that stay out of the way.** The stick and the buttons lost their dark panels: faint
    outlines and glyphs with the fight showing through them, lighting up only under your thumb.
  - **A minimap the size of a coin** on phones: a small see-through disc in the corner, without its
    frame, title and coordinates.
- **Weight on the flurry; one streak; the riposte; bosses with a streak of their own** (2026-11-15,
  ADR-094): the teleport cuts now **land**: you freeze on each contact, the boss reels under every
  cut before time holds him again, the ground cracks under him, and the last blow hits with speed
  lines across the screen, a dark blink and a flash, and staggers a duelist. **Parries, deflects
  and clashes count in the same streak** as perfect dodges, and parrying the **last blow** of a
  string is answered with a **riposte**: as many flash cuts as your streak counts, after which you
  are back where you parried. **Duelists keep a streak too**: every strike of yours their guard
  turns adds a pip to their bar, and from three they may answer with a flurry of that many blows
  (Scattering Ash, Starless Storm), each from another side of you. Your guard meets them from any
  side: **parry or block every blow and their posture breaks**.
- **The Cinder Wyrm in large, readable letters** (2026-11-14, ADR-092): the wyrm is printed in bold
  symbols four times the area of the old thin digits (8x13 px at 720p, the owner's pick of three
  sizes), about 25 characters across its body: you can read every one. Its letter grid now travels
  with it, so the body no longer slides under a fixed grid when the camera moves. *Changed:* the fine
  scale outlines of the thin-digit look are gone at the game camera.
- **The Cinder Wyrm in finer, steadier letters** (2026-11-14 – 15, ADR-092, ADR-093): the wyrm's
  digits are one size up at 720p (5x8 px cells, the owner's pick of three sizes) with the calm
  charcoal tone that shows every scale, and they now travel with it: the body no longer slides under
  a fixed grid of letters when the camera moves. (For a day it was printed in large bright symbols;
  that read as "way too flashy" and is gone.)
- **The free hand in sword fingers; weight and footwork; a cut that lands; outfits to pick from**
  (2026-11-14, ADR-086 – ADR-090): the hero's free hand has a wrist now and forms **sword fingers**
  (two fingers out, the others folded under the thumb). It gathers at the sword wrist and is thrown
  opposite each cut instead of hanging stiff off the forearm, and it no longer pops off the grip or
  locks the elbow straight on two-handed blows. The body carries the cuts: a light's step pushes off
  and brakes on the planted foot, the hips lead the cut, the thrusts and falling cuts sink into
  deeper stances, and on a landed hit the edge **bites** (the blade holds where it struck through the
  freeze, then tears on through). Planted feet pivot instead of skating, and the whirl hops round its
  turn. A landed cut is drawn where the blade meets the body, with a slash line along the cut, sparks
  thrown the way the blade travels, a flare and a glint on the steel, the camera kicked along the cut
  and a new cut sound; the struck duelist shudders through the freeze. The white star that hid both
  fighters on a hit is gone.
  His arms open now: a cut and a thrust reach out with the elbow nearly straight instead of every
  swing being made with the same crooked arm; on the run the elbows stay in beside the ribs, the free
  arm swings from the elbow, and the arms keep swinging when he strafes. The guard breathes and
  rides his steps instead of standing rigid, and a swing's arms come home softly instead of
  stopping dead. The charged blade stands out
  to his right, clear of his hood (it crossed his face). The sword hand's fist is a closed hand with
  finger grooves (up close it was a stack of discs), on the bosses too.
  Kept for later use (today's look and sword are the default): three outfits, `?heroLook=robe`,
  `swallow` or `warden` (`-shade` puts the face in shadow), and three swords, `?sword=sheet`,
  `ribbon` or `crescent`; both are rows in the Lab.
  *Fixed:* rebuilding the hero's gear wiped a boss's own part colours (the Starless Lord's red line).
- **The streak and the flurry** (2026-11-14, ADR-091): perfect dodges in a row are a **streak**
  (pips under your HP bar, "GHOSTEP ×N" over your head), and it lasts until a blow hurts you. Every
  perfect dodge is answered with as many blows as the streak counts, seven at most: **flash cuts**
  first (you vanish, cross the boss along a new line every time and are gone again, each cut
  leaving a line of light hanging on him) and then one of six **arts**, on which every hanging cut
  bursts at once. Against the wyrm: Skyfall (the plunge, as it was), Severing Line (one level cut
  across the head whose hit lands a beat later) and Heaven Splitter (a falling cleave through the
  head to the ground). Against a duelist: Passing Cut, Falling Leaf and Rising Moon (a rising cut
  and a somersault over him); all three leave you at his back. The art changes every time. While
  you cut, the world stands nearly still and you move in real time. Each cut rings a tone higher
  than the last, a counter runs over the boss, and a banner names the flurry (TWIN FLASH …
  SEVENFOLD FLASH) with its damage. A flash cut deals 28, the last blow 90 on the wyrm and 60 on a
  duelist. *Changed:* a perfect dodge of a duelist now deals damage by itself; the first perfect
  dodge against the wyrm is the plunge one time in three. Lab: PLAYER → flurry x1 … x7 and an art
  picker.
- **The Starless Lord in black plate, and how he moves** (2026-11-14, ADR-084, ADR-085): he wears a
  harness of his own now: a deep hood over a faceplate with a slit of red light (the owner's pick of
  three heads), a cuirass with a ring of red light on the breastbone, a plate yoke and pauldrons,
  plate arms and legs, hip plates over a war-skirt and a cape to his ankles, and he stands a head
  taller. Each form has a new guard. He no longer runs: out
  of reach he glides over the floor with his cape streaming. His strings walk forward on alternating
  feet, his spins leave the floor, he cartwheels over your guard and backflips away throwing red
  crescents, and each form ends its strings with a flourish (your opening). Six new moves, among them
  three spells: the **Crushing Dark** (red: talons of the Void close on you; caught, you are thrown
  down and crushed), **The Rift** (fissures of red light race along the floor: parry yours or step
  between them) and the **Dark Star** (it follows you over a violet ring, then bursts). Lightning, the
  push, the pull, the thrown stones, the storm, the blink and the ignitions are redrawn.
  *Fixed:* he sat on the throne only in name (he stood on its seat in his guard until woken), and
  Shen Hui stood where he should kneel: both wait in their own pose now.
- **Hit reactions and the death, made natural** (2026-11-14, ADR-083): a blow from behind now
  knocks him forward onto his hands (he used to spin round in one frame to fall on his back) and a
  flinch folds him the way the blow drives him. He no longer falls like a board: the knees buckle,
  the arms fling, he lies with a knee up. Killed while knocked down he dies where he lies (he used
  to stand up first to kneel and fall again). The death's collapse no longer sinks his knees into
  the ground, and the corpse lies sprawled with its cloak flat instead of a sheet standing in the
  air. Getting hit in the middle of a swing no longer teleports the blade. Timings and i-frames
  are unchanged.
- **Steel on steel** (2026-11-14, ADR-079 – ADR-082; both duelists):
  - **Parries where the blades meet.** A parried blow is now shown stopped on your guard, your blade
    snapped to the side and height it came from, the two edges crossed, and it is that picture the
    freeze holds while the sparks keep flying: thin streaks thrown the way the blade was going, a
    cross of light on the edges, falling embers. The white glare that used to cover both fighters is
    gone. The freeze is short inside a string (a seven-cut exchange keeps its rhythm) and long only
    on the blow that ends it; the camera punches in on every clash; a deflected blade rebounds.
  - **A guard you can read.** The boss raises his blade across his body as you swing at him. A
    strike he holds: dull steel sparks, a dry clack, GUARDED, and your chain goes on (it wears his
    posture). A strike he beats away: an orange burst, a harsh clang, DEFLECTED in red, your blade
    thrown back, and his Riposte is coming. He also breaks off the late half of his recoveries to
    guard, and sometimes steps out of a charged cleave or the finisher.
  - **Cancel anything.** A guard press or a dodge now ends your swing at any point: its windup, the
    cut itself, the recovery. Bounced off a deflect, guard or roll at once.
  - **Blade lock.** The two step in, the blades cross between you, sparks grind at the crossing and
    every press shoves him back a little.
  - **A closer camera in a duel:** within a duelist's reach it eases 6 m closer.
  - **Trade clash** (ADR-082). Swing as he swings and the two cuts meet: CLASH, neither of you is
    hurt, both blades are thrown back. His string goes on, so guard or dodge the blow that follows
    (two in a row cannot be traded). A fully charged cleave is not thrown back: it beats his blow
    aside and lands.
  - Added: `combat/clashFx.js`, `enemies/duelist/guard.js`, `game.fxDt`, `game.punch` /
    `cameraRig.punch`, `player:bounced`, `dragon:guard {deflect}`, the sounds `guard` and
    `deflected`, the DEFLECTED call-out, the test scenario CLASH (`duel.mjs`); for the trade clash
    `RESULT.CLASHED`, `combat:clash`, the sound `trade`, the CLASH call-out, the scenario TRADE.
- **A faster chain, a new finisher, swings that flow home** (2026-11-14, ADR-075, ADR-076): the
  attack chain is quicker: a hit every ~0.32 s when you mash (it was 0.42 s), each cut over in 0.12
  s. The light hits deal 30 / 32 / 36 / 30 again (the ×1.4 that paid for the slow chain is gone),
  so the damage per second is about what it was. The **finisher** is new: he gathers at the hip,
  leaps as the blade sweeps up his right side, and brings it down two-handed in one diagonal into
  the ground, landing folded over the planted blade; mashing no longer cuts that landing off, and
  the blow deals 66 (was 58). After every cut the blade now carries on round and eases home (it
  used to stop dead for a moment and then snap back as fast as it had cut). The whirl drops into
  its turn and his head stays on the target through it. For tuning: the Lab (`?lab`, the LAB
  button) has an **atk** slider that runs the hero's swings at ×0.6 to ×1.6 of this pace.
  The **4th hit** (the poke) now drives upward: level, it looked from the game camera as if he
  planted the sword in the ground at his feet. The **sword trail** is finer (ADR-077): one thin
  unbroken line just past the blade's point, white-hot and cooling to indigo as it tapers away,
  with a faint veil inside it, instead of a wide band a metre past the steel.
  **Anatomy** (ADR-078): the charge is now a guard he can actually hold, the grip out in front of
  the right shoulder with the sword elbow lifted and the wrist square to the blade (the hands were
  jammed against the shoulder, the forearm in one line with the sword). The body now has joint
  limits everywhere: elbows and knees never fold flat, the sword never bends back along the
  forearm, a hand never passes through the chest.
- **Wuxia-flow swings, a dashing cleave, a deeper guard, a narrower cloak, a new sword arc**
  (2026-11-13, ADR-071 – ADR-074): the hero's attack chain is new. Every swing is now a one-handed cut driven by the whole
  body: the hips turn through it, the sword arm opens to full reach as the blade crosses his front,
  and he walks through the chain, the lead foot changing with every hit. Each hit has two or three
  looks (falling, flat and rising cuts; rising, flat and falling backhands; a whirl, a rising
  whirl and a crouching low sweep; a long lunge and a rising thrust), picked at random, and two
  hits in a row are never in the same plane. The chain is slower and each hit heavier: a hit every
  ~0.42 s instead of 0.25 s, each light dealing ×1.4, so you can see the swings; the crit window
  after a perfect dodge is 2.2 s (was 1.6). The **charged attack** is no longer a poke: he holds
  the sword upright beside his head in both hands, bursts forward and carves one big diagonal
  through the target as the dash arrives, with a longer freeze on the hit, a wide crescent that
  hangs in the air and a low finish he holds; same damage and reach as before. The **guard** is a
  deeper, side-on stance with the hands before the chest and the blade slanted across his whole
  body, so it reads from behind as well as from the front. The **cloak** is a narrow cape down the
  middle of his back: his arms, waist and legs show beside it. The **sword** is 12 % shorter.
  Every cut is a **diagonal** now (none straight up and down: the finisher comes down from over
  the right shoulder) and the blade whips through after the hand. The **sword arc** is one bright
  line along the point's path with a faint veil of streaks inside it, instead of a glowing band;
  it tapers with the cut and hangs in the air for a moment.
- **The Starless Lord, a third level** (2026-11-13, ADR-068 – ADR-070; `?level=starless`, or pick
  The Obsidian Throne on the title screen): a black hall lit red, and on its throne a dark lord from
  the stars with a blade of red light. He fights in four forms, each with its own health bar: one
  blade, twin blades, the two joined into a long staff, and a cross-hilted blade wreathed in the
  Void. Empty a bar (or break his posture) and he drops to one knee: strike then for the DEATHBLOW
  that ends the form. He is faster than Shen Hui and gets faster with each form, somersaults and
  leaps into his cuts, and works the Void in between: lightning you can deflect (a perfect parry
  sends it back at him), a wall of force to cut or roll through, a pull that drags you onto his
  blade, a thrown blade that comes back, stones torn out of the floor, lightning called down on
  marked ground, and in the last form he vanishes and is behind you.
- **Controller support** (2026-11-13, ADR-066): play with a gamepad (Xbox, PlayStation or any
  "standard" pad in the browser). Left stick moves (analog), right stick aims (let go and attacks
  aim at the boss), RB / RT attack (hold to charge), LB / LT block (tap to parry), A dodges, B or
  L3 sprints, X drinks a flask, Y rests at the bonfire / fights again, R3 locks on, Menu pauses,
  View shows the controls, the D-pad zooms. Any button starts from the title (the D-pad picks a
  stage); the pause menu is walked with the D-pad and A, B resumes. The on-screen hints switch to
  pad buttons (PlayStation symbols on a PlayStation pad) while the pad is in use and back on the
  first key or click. Rumble on hits, guards, parries and perfect dodges. Unplugging the pad
  mid-fight pauses the game.
- **Remappable controls** (2026-11-13, ADR-067): pause → CONTROLS. Rebind any action on the keyboard
  and mouse (move, attack, block, dodge, sprint, flask, lock-on, rest, help, mute) and on the
  controller (attack, block, dodge, sprint, flask, lock-on, rest, help, zoom): pick an action, press
  the new key, mouse button or pad button. A key already in use swaps over. Works from the keyboard
  and mouse or entirely from the pad, with a reset per tab, and is remembered in this browser.
  Every key shown on screen (prompts, hints, the title, the controls lists) follows your bindings.
  Esc / the pad's Menu always pause and cannot be remapped.
- **The hero at Shen Hui's size, a trimmed cloak** (2026-11-12, ADR-064, ADR-065): the hero is drawn
  10 % smaller, so in a fight he reads about the same size as Shen Hui (he was the nearer of the two
  to the camera and looked a size bigger); his reach and hitboxes are unchanged. His cloak is the
  same cloak trimmed about 30 % narrower and 15 % shorter, and the coat tails under it are a little
  shorter, so his back, arms and legs show from behind.
- **The Ash Disciple, a second level** (2026-11-12, ADR-058 – ADR-063): a new boss and a new place,
  loaded on their own with `?level=ash` or from the stage picker on the title screen (and the Lab's
  LEVEL row). The Ashfall Courtyard: a ruined sword sect under falling ash, a bonfire at the foot of a
  path, broken steps and a gate, a paved courtyard ringed by broken pillars. In it kneels the Ash
  Disciple, Shen Hui, a grey-robed swordsman in a small straw hat with a long slender jian held in
  the classic jian guard, the sword-finger raised over his head. He fights at Phantom Blade Zero
  boss speed, whips his whole body into every cut, steps in so his blows always reach, sprints down a
  hero who runs, punishes a flask, and often flows from one move straight into the next,
  with moves of his own (thrusts, flicks, spins, overhead chops, a feint that never glints, a low
  sweep, a gliding cut, sword qi thrown along the ground, a seven-cut Rain of Ashes, and in his second
  phase a flurry of thrusts, a ten-cut Hundred Petals, a burning whirl and a great leap). He guards and
  turns aside strikes into his front and counters after a few, and a broken guard ends in an
  execution. **Sekiro / Phantom Blade Zero moments:** parry every cut of a long string and he reels
  (PERFECT DEFLECT); parry an overhead blow perfectly and the blades lock: mash attack to win
  (BREAKTHROUGH) or be shoved back; roll into his perilous red thrust to step on his blade (MIKIRI);
  each plays in slow motion with the camera pulled in. The game's direction is now a wuxia skill
  boss rush with fixed rewards; his reward comes next.
  - Added: `src/levels/` (level registry), `world/courtyard.js`, `entities/enemies/ashDisciple/`,
    `ui/bossName.js`, `tests/integration/duel.mjs` (in `npm test`), `docs/specs/ash-disciple.md`;
    the `dragon:guard` event and a GUARDED call-out; the execution thrust against a broken duelist;
    the blade lock (`player.startBladeLock`, `player:lock`), the mikiri (`player:mikiri`), the full
    deflect (`dragon:deflected`), `flow.cinematic` + `cameraRig.cine` (`game:cinematic`, a gong).
    Impact: a parry freezes the frame and throws a shockwave ring, a white flash and a heavier clang (a
    perfect one adds a short slow motion); a blow that lands on either fighter freezes it too, and his
    body jolts back from yours; his blade leaves a sweep trail.
  - Changed: `HeroAnimator` takes an optional per-instance pose table; flow banners and lore, the
    minimap zone, the combat log and the name tag come from the level and the boss's name; audio
    gives a duelist no creature voice; grass can be thinned and greyed by a level, the atmosphere can
    fall ash; the hero's parry flash sits in front of his guard (it sat at the blade's pre-parry point,
    often by the hip, and its light blew the floor out).
- **Attack variants, hair that reads, a fuller cloak** (2026-11-12, ADR-055 to ADR-057): every hit
  of the left-click chain has two or three different looks (a draw cut, a leaping cut, a level or
  falling backhand, a rising whirl, a skipping cross-cut, a low rising stab, a leaping slam), picked
  at random so the combo doesn't repeat, and every swing turns the hips first and shifts the weight
  through the cut. Same damage and timing. The hood now hides his face in shadow with gold strands
  falling out of it, and the cloak stands off his back so he has depth from the side.
- **Breath-born bullets, perfect-parry returns, Armageddon, heat-glow warnings** (2026-11-11,
  ADR-050, ADR-051, ADR-052, ADR-053): every bullet now leaves the wyrm's jaws along the way its
  head points (a sweeping stream of embers, coughed cones, a breath that scours the ground in
  tongues of fire), and the patterns are much harder. A perfectly timed parry sends an ember or a
  wisp back as a shot that hurts the dragon. A new set-piece, Armageddon, replaces the Meteor rain:
  the wyrm rears up and fires a salvo into the sky, which answers with waves of meteors over the
  whole clearing and one great meteor at the end. Ground warnings are now the ground heating up
  instead of red rings with `!` marks.
- **Two hands, a raised guard, idle life, gold hair** (2026-11-12, ADR-046 to ADR-049): the hero
  swings with both hands, blocks with the sword raised across his body, and when you stop for a few
  seconds he looks around, stretches, inspects or twirls his sword, rests it on his shoulder or leans
  on it. His hood is rounder and pushed back, with gold hair showing and a warmer face. Charging no
  longer drives the sword through the cloak, and the cloak hangs as it did before.
- **A hooded cloak, arms that bend, fewer draw calls** (2026-11-11, ADR-043, ADR-044, ADR-045): the hero
  wears a pointed hood and a huge tattered cloak, like the reference image; the old coat-and-pauldron
  outfit is still there as a loadout. His sword arm no longer swings as one straight stick: the
  elbow stays bent, the arm cocks back before a cut and opens through it, and the blade trails the
  hand and whips through. The hero and the wyrm are each drawn in a few batches instead of hundreds of
  small parts: about 56 draw calls a frame in the fight on the phone preset instead of about 509.
  That is aimed at the slowdown on phones and has not been measured on one yet; add `?nobatch` to
  the URL to compare.
- **Hands, a longer combo and equipment slots** (2026-11-11, ADR-041, ADR-042): the hero has real
  hands (a gauntlet fist closed round the grip, a left hand with fingers), holds the sword low at his
  side like the reference image, and is slim in profile. Left-click now chains five different hits
  (falling cut, rising backhand, whirl, stab, slam), with a sprint slash and a roll cut. His outfit
  and weapon are items in eight equipment slots that can be swapped while the game runs.
- **The hero filled out** (2026-11-09, ADR-040): he was "a bit too lanky". Broader chest and
  shoulders, thicker arms and legs, a slightly bigger head and hands. He stands in a shoulder-width
  stance with the sword held out to his right side, where it shows from the game camera, instead of
  pointing ahead behind his own body.
- **Bullet hell and the moonlit sword** (2026-11-09): the wyrm throws spirals, fans and homing swarms
  of small fire bullets that you deflect back at it one by one (or block, roll through, or cut out
  of the air), plus red orbs and a turning wheel of fire walls that you must dodge. Two more combos,
  less waiting between attacks, each hit a little lighter. The hero's sword is shorter (1.25 m),
  glows blue-white, and no longer runs through the front of his coat.
- **Blender-built hero parts** (2026-11-09, partial): the hero's hair, collar, lapels, sword blade,
  cape and pauldron are sculpted by a headless Blender script and shipped as packed geometry. He has
  a rounder hair mop, a winged collar, one wide torn cape off the armoured shoulder and a narrower
  jagged blade. Closer to the single-figure reference, still not a match (face, coat, armour detail).
- **Single-figure reference, round 2** (2026-11-09, partial): the hero stands in the single-figure
  image's stance with the sword in a low diagonal across his front, is drawn as a fine dot matrix
  instead of small letters, and wears a fuller pleated coat and a four-ribbon torn cape. It is closer
  to the reference but not yet a match (coat, cape, hair, face, legs and sword are still to do).
- **The lean reference match** (2026-11-09): the hero matches the owner's six-view ASCII turnaround
  and single-figure image, from the back and rear three-quarter views as much as the front: a lean
  swordsman with spiky pointed hair, a flared collar, a shaped back, a spiked shoulder stack, two
  coat tails split by a vent instead of a skirt, and the sword hanging at his right side. The Lab's
  model viewer gained every reference angle at once, a turntable and a solid (no-ASCII) render.
- **The epic wyrm fight** (2026-11-09): a longer, harder battle in three phases, with combos you
  parry blow by blow, fire spells, short flights, and a perfect dodge that drives the hero's blade
  into the wyrm's head. The hero is broad-shouldered, and his sword no longer shows through his body.
- **The reference match** (2026-11-08, PR #4): the wyrm and the hero look like the owner's two
  reference images (a red-black ASCII dragon and the "Shadow Swordsman" line art) and move better.
  That work left gameplay as it was (attack timings, hitboxes, damage and parry windows).

### Added
- **Swing clips** (ADR-071, `player/swings.js`): the hero's swings as key poses over each attack's
  windup, active frames and recovery (the sword hand, the blade's direction, the free hand, hips and
  chest), played by `swingPose` with splines through the keys. 13 clips: three looks each for hits
  1–3, two for hit 4, the sprint slash, the roll cut; plus the cleave. Each clip has a `line`, and
  the animator never follows a swing with another along the same line.
- **The dashing cleave** (ADR-072, `CLEAVE`): the charged attack's release. Event kind `cleave` on
  `player:attack` / `player:hitDragon`; `fx.cleaveImpact` (a ring and a fan of streaks), a crescent
  that hangs twice as long, a 0.15–0.2 s freeze on the hit.
- Pose channel `offAt`: with `twoHand`, how far up the blade the off hand sits (a palm braced on the
  flat). Built for the guard options; not used by the guard that was kept.
- **The Obsidian Throne** (`?level=starless`, ADR-069, ADR-070): the throne hall set
  (`world/throneHall.js`), the Starless Lord (`enemies/starlessLord/`: 31 moves across four forms, eight
  Void spells, four stances), four health bars with pips on the boss bar, the DEATHBLOW call-out,
  `dragon:phase4`, a Phase 4 button in the Lab, `tests/integration/lord.mjs` in `npm test`.
- **Sets with their own night and weather** (ADR-070): a level's set may return `sky` and `ambience`.
- **Perfect parry → return** (ADR-051): RMB ≤ 0.08 s before a bullet lands returns an ember (30 HP,
  14 posture) or a wisp (70 HP, 30 posture) to the wyrm's head; RETURN call-out, gold burst, a
  brighter clang; `player:parry.perfect`, `dragon:parried.perfect`, `dragon:returned`. At most 120 HP
  of returns per pattern.
- **Armageddon** (ADR-053, key `meteorRain`): rear-up, a salvo of 12 / 16 bolts into the sky, the sky
  glowing orange, 3 x 8 / 4 x 10 meteors in waves over the whole clearing (an even spread, safe
  ground kept round you), burning craters in phase 3, a great meteor to finish.
  `hazards.barrage`, `placeWave`, `leadInto`; `world.atmosphere.skyGlow`; `dragon:hazard` stages
  `launch` and `sky`; `dragon.bodyWarn`.
- **Scouring breath** (key `fireWheel`): tongues of fire run out of a breath on the ground and are
  swept round by the wyrm's turn (pausing once, reversing).
- **Light chain of five** (ADR-041): falling cut → rising backhand → whirl → stab → slam (was sweep,
  backhand, slam). **Sprint slash** (LMB while sprinting) and **roll cut** (LMB out of a forward
  roll); both count as hit 1.
- **Equipment slots** (ADR-042): `player/gear/` items in head / chest / shoulders / arms / legs /
  waist / back / weapon; `player.equip(slot, id | null)`, `player.setLoadout(loadout)`,
  `player.loadout`. Today's look is the default loadout; an undersuit covers empty body slots.
- **Hands:** a fist round the sword grip in every pose and a left hand with fingers and a thumb.
- **Bullets** (ADR-039): orange **embers** and blue homing **wisps** can be parried (the bullet flies
  back to the wyrm's head and adds posture), blocked, rolled through or cut with a swing; red
  **orbs** are dodge-only. Every bullet glints and pings 0.35 s before it lands, one parry answers
  a clump, and a pattern can only hit you a few times.
- **Four bullet patterns:** **Ember storm** (spiral arms round the wyrm; orb rings from phase 2,
  counter-rotating arms in phase 3), **Cinder fan** (wing-beat volleys; a red orb wave from phase
  2), **Wisp swarm** (phase 2+, homing) and **Fire wheel** (phase 2+, turning walls of fire to roll
  through). All four are in the Lab.
- **Two combos:** **Storm flurry** (five hits to parry in rhythm) and **Cinder flurry** (phase 2+;
  its last slam scatters four embers that drop on you one by one).
- **Fire effects:** burning wakes behind the claws, a fire and dust burst under a slam, a sparking
  shower on a parried blow.
- `npm test` → **BULLETS** scenario; `Player.isSwinging()`; `dragon.bullets`.
- **`npm run hero-parts`** (ADR-037): rebuilds `src/entities/player/heroParts.js` from
  `scripts/blender/hero_parts.py` in a headless Blender (needs Blender 4.2+; the generated file is
  committed, so playing, testing and deploying need no Blender).
- **Lab model viewer, look-dev tools:** the reference sheet's angles (3/4 and rear 3/4 on the hero's
  right, both sides), a **Spin** turntable, a live **Sheet** of ten tiles (six reference angles, the
  left side, and the gameplay camera on his back, front and right side at ×2), and the hero looks
  **ASCII / Solid / Source / Lines**: Solid draws the bare geometry plain-lit without the ASCII pass,
  so a shape problem can be told from a renderer one. Console: `__game.lab.modelView({ target:
  'hero', dark: true, sheet: true, look: 'solid' })`.
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
- **Agents no longer run the full test set before a PR; `npm test -- --changed`** (2026-11-28, ADR-276):
  before opening a PR, an agent runs the tasks that cover what its branch changed (`--changed`;
  `--changed --list` shows the pick and why, `--base <ref>` compares with another ref) and leaves the
  full set to CI, which still runs every task on every PR before it can merge. The rules are in
  `tests/changed.mjs`; a file they don't know, or shared code (combat, the hero, the duelist engine,
  core, render, main.js), runs everything. `changedcheck` fails when a boss or a level has no rule.
- **Local test runs go easy on the PC** (2026-11-25, ADR-205): off CI, `npm test` runs its workers at
  low priority and every run on the machine shares 8 slots (`ABYSS_JOBS`); `--only <names>` runs a subset.
- **CI's long checks split; every PR auto-merges when green** (2026-11-24, ADR-185): the Starless Lord's
  look check and the living world's suite each run in parallel processes (`GCD_FX`, `GCD_SKIP` in
  life.mjs) and the shares are re-dealt on measured times: a PR's check should take ~5-6 minutes (was 8-10).
  `.github/workflows/automerge.yml` sets squash auto-merge on every PR (not drafts, not `hold`).
- **CI runs the tests as four parallel jobs** (2026-11-23, ADR-153, PR #92): `tests/run.mjs --shard I/N`
  deals the tasks to N shares; the Starless Lord suite runs in three parts; a PR's check takes ~4
  minutes (was 12-15). A PR that only changes docs/, *.md or .claude/ skips the tests and the build.
  lord.mjs, duel.mjs and asc.mjs take a comma list of scenarios and `GCD_SKIP`.
- **`npm test` runs its suites side by side** (2026-11-15): `tests/run.mjs` starts the four
  integration suites and the two static checks as separate processes, with `integ` in five parts
  (its TIMING scenario in three), and prints each task's output whole and a summary of times. The
  same checks run. `integ.mjs` takes a comma list of scenarios, `GCD_SKIP` and `GCD_TM_SHARD`.
  CI cancels a PR's superseded run.
- **The sword arc** (ADR-074): `PlayerFx.trail` draws an edge line, a faint veil and motes, gated
  by how far the blade turned in the frame (was 4–5 rows of bright strokes under `A` / `8` letters
  with a `+` halftone, drawn for any blade movement); `arcGlint` once a swing.
- **Diagonal cuts** (ADR-071): every clip's blade stays under ~45° of elevation and crosses his
  front near chest height, and hangs back behind the hand until mid-cut; the slam takes `tilt`.
- **The light chain is one-handed** (ADR-071; it was two hands on every swing, ADR-046): the hips
  lead each cut, the sword arm opens to full reach across his front, the free hand moves against it.
  Hit 4 is a long lunge (was a two-handed stab); the low sweep replaces hit 3's cross-cut. Reach and
  lunges are unchanged.
- **The chain's pace** (ADR-071): lights 0.16 / 0.18 / 0.26 s of windup / active / recovery (were
  0.14 / 0.11 / 0.22), the next light after 30 % of the recovery (`chain`), damage 42 / 45 / 50 / 42
  (were 30 / 32 / 36 / 30) and posture ×1.4; `DEFENSE.ghostep.critWindow` 1.6 → 2.2 s.
- **Footwork** (ADR-071): `lungeFeet` steps whichever foot is behind, so the lead foot alternates
  down a chain; `_elbow` limits how fast an elbow swings round its shoulder → hand line (all clips).
- **The sword is 12 % shorter** (ADR-073): `DIM.drawnTip` 0.93, `steelTip` 1.04; the hit segment is
  unchanged.
- **The charge stance** (ADR-072): both hands beside the right ear, the blade standing nearly upright
  beside his head (was both hands at the right hip, the blade out to his side).
- **The guard is the cross ward** (ADR-073): sunk and side-on, the hands before the chest, the blade
  ~38° up across the whole body (was upright, the blade ~50° up).
- **The cloak is a narrow cape** (ADR-073): five sheets (was seven): three down the middle of his
  back, 0.24 m at the hem, and the drapes on the arms.
- `thrustStats` is `chargeStats(holdT, def)`; `THRUST` is only the execution's lunge now; dashing
  heavies carry `dash: true`. On-screen control hints say "cleave".
- **One duelist engine** (ADR-068): `enemies/duelist/` (`Duelist`, `DuelBrain`, `createDuelPoses`,
  `makeRealise`, `DuelFx`); the Ash Disciple is a kit on it and plays exactly as before.
- **Bullets are breathed** (ADR-050): every bullet spawns at the wyrm's mouth along its head's aim
  (`spit()`); Ember storm → Ember torrent (a swept stream, orbs at the extremes, a P3 pirouette),
  Cinder fan → Cinder burst (coughed cones, P3 double taps, a P3 chain into a torrent), a denser
  Wisp swarm. "Hard": ~1.6–2x the bullets, ~20 % faster, shorter cooldowns, higher hit caps; a
  parry's clump pop 2.2 → 1.5 m; bullet damage unchanged.
- **Ground warnings** (ADR-052): every hazard and red area attack heats the ground it will hit
  (a glyph glow and scorch heat, its edge only in the last 0.35 s) instead of red dot rings, `!`
  marks and chevrons; the roar's shock ring is fire orange.
- **Idle sword hold** (ADR-041): the blade hangs ~52° below level at his right side with the edge
  down, the arm relaxed by the ribs (was ~43°, flat up).
- **Side profile** (ADR-041): the cape's outer sheets spread to his right, not behind him; the
  front coat panels hang nearly straight.
- `model.js` is split: geometry builders in `heroGeo.js`, measurements in `heroDims.js`, the outfit
  in `gear/wanderer.js`.
- **Hero build** (ADR-040): chest 0.34 → 0.39 m, waist 0.23 → 0.27 m, shoulder joints ±0.16 → ±0.178,
  upper arms, forearms, thighs and boots ~20 % thicker, head ×1.08, hands ×1.12; collar, pauldron,
  lapels, coat panels and cape fitted to it (hero parts rebuilt). Gameplay sizes unchanged.
- **Idle stance and sword hold** (ADR-040): the blade points out to his right and down (~43°) from a
  bent arm; narrower stance; the cape hangs a little closer.
- **The sword** is 1.25 m (was 1.64 m) and lit blue with white-blue edges (was dark steel with cyan
  seams). Its reach in combat is unchanged (ADR-038).
- **The idle** holds the sword in a low ready at his right side instead of across his front.
- **Pace and damage:** the wyrm waits less between attacks (idle gaps 1.0–1.7 / 0.7–1.2 / 0.35–0.7
  s per phase), and every blow it lands deals 85 % of its listed damage (`TUNING.damageScale`;
  bullets and the fire wheel list final damage).
- **Fire look:** the breath is a dim orange stream with a yellow vein instead of a white bar; the
  fireball's flash no longer hides its blast.
- `player:parry` carries `light`, `dragon:parried` and the bullet tells carry `bullet` (contract
  v0.6, ARCHITECTURE.md).
- **The hero, Blender-built parts** (partial; ADR-037):
  - hair: a rounder mop of layered locks; collar: taller, winged, with a turned rim
  - cape: four wide torn sheets with holes and a clawed hem behind the right shoulder (was: ribbons)
  - pauldron: a cap and a pointed lame with bevelled edges and short blades (was: a dome with needles)
  - sword: a narrower blade with a dark faceted core between barbed cyan edges
  - darker cloth and cape lining, brighter skin, both eyes visible, fewer shirt buttons, plain arms,
    wider and more flared coat panels
- **The hero, single-figure reference round 2** (partial; ADR-036):
  - idle: weight on the left leg, the right leg out, the sword arm at the right hip and the blade in
    a low diagonal across his front, head bowed along it (was: the blade hung at his right side)
  - shading: a 3x3 dot-matrix micro-font in square cells, cel-stepped light, dimmer non-glowing ink
    lines, a per-part silhouette colour (dotted lavender round cloth, white round armour)
  - coat: six wider, longer panels with drawn fold lines; cape: four torn ribbons from under the
    pauldron replace the two sleeve streamers
- **The hero, after the owner's six-view turnaround and single-figure image** (lean reference match):
  - a lean anime swordsman: a V from the shoulders (0.46 m across) to a narrow belted waist, slim
    arms and long legs (the broad build's 0.50 m chest is gone)
  - spiky hair of distinct, asymmetric pointed locks: crown spikes, layered back locks hanging
    toward the nape with their points lifting, nape flicks, a jagged fringe over the eyes
  - a flared stand collar with a turned-over rim, rising to points beside the jaw in front
  - a shaped upper back: a yoke whose seams dip to a four-point star, a centre seam, the baldric
    from the right shoulder to the left hip, two belts
  - a stack of spiked plates on the right shoulder and down the upper arm; banded calves
  - the coat: two tails split by a vent from just under the belts, each flaring to a ragged hem that
    slopes down to its outer point, narrow side panels and two front panels; the legs show between
    them from every side (the closed A-line skirt is gone)
  - the sword after the single-figure image: broad at the guard, one long taper to a sharp point,
    hooked barbs at the base, lightning notches, a guard swept up round a violet four-point star gem
  - the idle hangs the sword at his right side, angled out and down, so it reads from behind
  - at the game camera the blade is a crisp cyan line with a tight glow (its halo used to cover his
    body), the armour is less glaring and the lavender coat tails read against the black coat
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
- The charge pose's arms: the sword elbow stuck out level and the free arm folded across the belly.
- Tests: the Armageddon timing check assumed a standing hero is hit on a blast's first frame; a blow
  chained within 0.3 s of another now may land inside the blast's 0.12 s.
- The blade's tip streak stops at the point (its far end still reached past it).
- No blade halo or gem glow when no weapon is equipped.
- A light attack's recovery no longer swings the blade home behind his head.
- The blade's tip streak no longer floats off the point (most visible in rolls).
- Bullets (PR #9 review): the phase-2 Cinder fan (8 embers) opened with the hero in a gap, so its
  opening flash came about a second before anything landed; the first fan now has an ember dead on
  him at every count. A homing wisp that missed after its cue could come round and hit without a
  second cue; it announces every pass now (or fizzles). A wisp swarm roared at a hero 25–30 m away
  flashed when the wyrm finished the move, up to 0.7 s before the first wisp landed; the flash now
  waits for the lead wisp.
- The front coat panels no longer hang through the sword when the hero stands idle.
- Hero: returning from the light combo's finish to the idle, the blade cut through the sword arm's
  shoulder for a frame (a near half-turn now goes round the front).
- The hero's sword no longer shows through his back or legs, and his coat rarely passes through the
  blade any more (it drapes over it or hangs inside it).
- Wyrm: wings and limbs flipping round in one frame, feet sliding or floating, the stomp's paws
  landing before the slam, toes under the ground when lying down, the tail folding over itself.
- The wyrm's tail sweep can no longer land before its red warning flash.
- Hero: feet skating, the blade whipping through the legs and the ground, the blade spinning round
  him between light 1 and light 2, the front foot skidding in the thrust, guard taps shuffling the
  feet, the blade's glow sitting short of its point.

### Removed
- The leaping cut straight down the middle (a rising slash takes its place); the arc's letter rim
  and halftone lattice.
- The lunging thrust as the charged attack (it stays as the execution against a broken duelist).
- The old swing model: `slashH`, `stabPose`, light 1's windup loop, `FLOW`, the `h` and `stab` kinds.
- The cloak's wing over his left side and the sheet behind the sword shoulder.
- The Meteor rain (replaced by Armageddon under the same key); the old spiral storm, wing fans and
  evenly spaced fire wheel; the red ground rings, `!` marks, closing inner rings and `>` chevrons.
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
- HUD: player frame, boss bar, tabbed log, minimap, name tags, lock-on
  reticle, banners (YOU DIED, WYRM VANQUISHED), title, pause, help.
- Game flow: title → explore → boss intro → boss → death/retry or victory; bonfire rest.
- Procedural audio: ambience, SFX for every combat event, boss music with phase-2 layer.
- Single-file build (`npm run build`), dev server, headless integration tests.
