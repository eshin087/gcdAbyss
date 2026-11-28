// The in-game changelog (WHAT'S NEW: title screen and pause menu; ui/changelogPanel.js; ADR-115).
// Content is data: one release per version, newest first; each entry is a short, player-facing
// version of a CHANGELOG.md entry. `npm test` (tests/changelogcheck.mjs) checks that every headline
// in CHANGELOG.md → [Unreleased] has an entry here with the same title, so a session that adds a
// CHANGELOG entry adds one here too. Notes are plain text: no markup, no ADR numbers, no URLs.

/** The version the game calls itself (package.json `version`). */
export const GAME_VERSION = '0.4.0';

/**
 * Releases, newest first. `version`: null for the work since the last release (it ships to the
 * site as it lands). Entries: { date 'YYYY-MM-DD', title, notes: [string] }.
 */
export const RELEASES = [
  {
    version: null,
    label: 'LATEST',
    summary: 'Everything since 0.4.0. It reaches the site as each piece lands.',
    entries: [
      {
        date: '2026-11-28',
        title: 'Halcyon after the reference pack, to try',
        notes: [
          'Halcyon rebuilt after his reference sheets, to try before it becomes his own: a tall build in navy armour plates edged in gold, blond hair, bare hands, gold-capped boots and a crimson cape to his heels.',
          'And new poses: a knee drawn up as he hovers, strikes and takes blows in the air instead of standing on nothing, leans into his stops and turns, Meteor landed on one knee, the car carried on one palm. His timing and damage are exactly as before.',
          'Add halRef=a and halRefMove=a to the address to try them.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'The Cinder Wyrm moves like a living animal',
        notes: [
          "The Cinder Wyrm's wings no longer pass through the ground, and its claws, feet and head no longer jump from one place to the next between blows.",
          'Its head stays in line with its neck when it bites or dives, its tail curves smoothly along the ground, and it eases into its turns instead of snapping round.',
          'The circle of burning script it draws for a spell now always stays on the ground under it.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'One kind of parry',
        notes: [
          'Every parry is now a perfect parry: the same sparks, freeze and rewards every time you parry on time.',
          'A parry pressed a touch early no longer counts as a weaker, different-looking parry.',
          "So Bai Wuji's barrier now opens on every parry, and every bullet you parry flies back at whoever fired it.",
        ],
      },
      {
        date: '2026-11-28',
        title: 'A tenth level: the Last Foundry and the False Saint',
        notes: [
          'A new level, the Last Foundry: a steel mill at the end of a war with the machines, at night, still running with no one left to feed it. Pick it on the title screen.',
          'Its boss is Anselm, the False Saint: a calm man in a charcoal jacket, kneeling at the edge of the molten pour as if in prayer. His skin is a shell over a machine. Your cuts chip it away where they land, and each phase bares more of the frame under it.',
          'He is the fastest and hardest-hitting boss in the game, and every blow is still told: open-hand strings, a grab that throws you through the scenery, booster punches that cross the floor in a blink, lasers, cannons, missiles and an artillery barrage with safe lanes between its rows.',
          'Everything in the mill breaks, and he uses it: he kicks gas tanks at you, shoots a ladle down so molten steel pours where you stand, throws girders and slams the forging press into a shock across the whole floor.',
          'Molten steel burns him too: bring a ladle down on him.',
          'At 74 % his skin breaks, at 46 % his weapons come free, at 20 % he shows his true frame. Below 8 % he tries one last embrace: dodge it and he stands wide open.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'Swipe to dodge on touch',
        notes: [
          'Touch: flick your thumb on the right half of the screen and the hero dodges that way at once (SWIPE DODGE in the pause menu turns it off).',
          'With LEFT BLOCK on, a BLOCK button sits right by the stick, and its own padlock lets you drag it where your left thumb wants it. A second BLOCK can sit under ATTACK for the right thumb.',
          'The left GUARD and the padlocks are drawn fainter so the controls stay out of your way.',
          'Both guard buttons are now called BLOCK, without the line under them, and the ATTACK dagger points down. The stick and the left BLOCK are drawn as plain symbols, no frames.',
          'New in the pause menu on touch: LEFT BLOCK and RIGHT BLOCK switches (hide either one), and PAD LAYOUT picks whether BLOCK sits beside or under ATTACK.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'Varr Nihil after the reference pack, to try',
        notes: [
          'A new look for Varr Nihil to try before it becomes his own: his hood, helm, armour and whole cape kept in every form, and every blade split into two red-white rails with a dark slit between them.',
          'And a new way for him to move: lower, wider guards, blows that sink into the cut, bigger reactions and a deeper glide. His timing and damage are exactly as before.',
          'Add lordRef=a and lordRefMove=a to the address to try them.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'A black blow can darken the whole picture, a red string can cut in red',
        notes: [
          'A charged (black) blow now drains the whole picture to dark grey while the boss charges, his weapon lit by a white point, the colour snapping back as he strikes.',
          'And it always lands like the heaviest blow of the fight, even when it misses you: the ground craters, what stands near breaks, dust tears out across the floor and the screen shakes.',
          'A red string leaves a thin red crescent on every cut of a sword boss, from the red flash on.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'A new fight stance: the middle guard',
        notes: [
          'In a fight gcd now holds his sword in a middle guard: both hands on the grip before him, the blade pointed at the boss, the knees bent.',
          'At the game camera it reads as a sword aimed at your foe, not one raised up and out to the side.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'The deathblow is not cut short',
        notes: [
          'Pressing guard during a deathblow no longer stops it. The guard comes up once the finisher lands.',
          'A perfect parry of a blue blow now always earns the deathblow. It no longer turns into a blade lock.',
        ],
      },
      {
        date: '2026-11-28',
        title: 'The Cinder Wyrm dies whole, every white spark shows, and its blue and red paws look apart',
        notes: [
          "When the Cinder Wyrm falls, its neck now comes down in one natural curve with its head in line, instead of snapping up and bending at odd angles.",
          'Every ordinary blow of a boss now shows its white spark, even when the claw or wing it comes from is hidden behind the body or past the edge of the screen.',
          "The Cinder Wyrm's blue and red paw blows no longer look alike: the blue one winds its paw out wide and sweeps it across you (parry it), the red one leaps clear of the ground and crashes down on both paws (roll away).",
        ],
      },
      {
        date: '2026-11-28',
        title: 'One tap to begin, menus with a finish, and touch controls that fit and move',
        notes: [
          'On a phone, one tap on a world, BEGIN HERE or BOSS RUSH now starts it: no more second tap.',
          'The title and the pause menu have new buttons and panels: the world and its two buttons, BEGIN HERE and BOSS RUSH, share one panel.',
          'Touch: BLOCK now sits beside ATTACK, DODGE right under it, and the FLASK where BLOCK was. The buttons sit a little further in from the edge and size themselves to your screen.',
          'Tap the small padlock above the buttons to drag them where your thumb likes them; tap it again to keep them there.',
          'On touch the fight now starts locked on to the boss, and the phase call no longer covers your health.',
        ],
      },
      {
        date: '2026-11-28',
        title: "Bai Wuji's barrier shows where your blade hits it, and he goes down quicker",
        notes: [
          "A cut that stops on Bai Wuji's barrier now still takes a little off his health, and he has less health to begin with: the fight is about a fifth shorter.",
          'Every cut his barrier stops now shows it for a moment: a faint net of the invisible shield, right where your blade landed.',
          'The ring on the floor that counted down his opened barrier is gone.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'The parry and the deathblow, readable',
        notes: [
          'The parry that starts a deathblow now throws the boss open, arms wide and stumbling back, and you hold a beat before you step in and cut him while he reels.',
          'You strike from further away and every blow drives him back, so the two of you never merge into one shape, and the flash at each cut no longer covers the wound. The blows and their damage are unchanged; ?dbread=0 plays it as before.',
          "A perfect parry is now a pinpoint where the two blades cross and its sparks, with no gold burst over the fighters, so you can see the swords meet.",
          "A boss's blue parry cue is a small blue cross on his blade instead of a big white star, so it no longer covers you. ?parryClash=0 and ?blueTell=0 show them as before.",
        ],
      },
      {
        date: '2026-11-27',
        title: 'The clash dance: parries in a row break him faster',
        notes: [
          'Against the human bosses, every parry in a row inside one of his strings breaks his posture faster than the last, and the clash of steel rings a little higher with each one.',
          'His posture also recovers more slowly the more you have cut his health, so a near break stays near.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'Blows land on what they strike',
        notes: [
          'Every hit, block and guard now lands on what it strikes: the blade bites in, a fist lands on the body, held through the freeze, then the swing carries on, with the sparks where the two met and the struck part flinching by where it was hit.',
          'A boss leans into a blow that would have fallen short of you. No change to any timing or damage; ?contact=0 shows it as before.',
        ],
      },
      {
        date: '2026-11-27',
        title: "Bai Wuji's blows land where they aim",
        notes: [
          "Bai Wuji's palm, his straight poke, Dark Spark and the fist he pulls you onto now land on the line to your chest instead of crossing past you.",
          'His kicks ease back after they land instead of snapping back off a dead stop.',
          'In his first phase his right hand comes out of its pocket to cast Azure Draw and the Yank, so the blue fist he pulls you onto is a fist you can see.',
          'Fixed: a spell or a thrown piece of his no longer knocks you down again the moment you stand up from a knockdown.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'The performance readout measures by itself',
        notes: ['With ?perf in the address, BENCH now runs on its own during a fight, at the slow moments too. Just play, then tap REPORT.'],
      },
      {
        date: '2026-11-27',
        title: 'The Starless Lord fights with better form',
        notes: [
          'Varr Nihil thrusts on a long straight arm out of a real lunge, brings his two-handed overheads down on a diagonal across you, turns his low sweeps on his feet, keeps his free hand quieter and lands his front foot with the blade, in all four forms.',
          'He is easier to read: every attack holds its windup longer before it lands, and the glint comes earlier.',
          'His Void Lightning now grounds along its line with the floor crackling round his feet, and each new form rises out of a column of violet letters.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'The Cinder Wyrm raises its head naturally to rain fire',
        notes: [
          'When the wyrm rears up to roar its meteors into the sky, its head now rises up and forward instead of twisting back over its own neck.',
        ],
      },
      {
        date: '2026-11-27',
        title: "Xin Yi's limbs on the line",
        notes: [
          'Xin Yi moves more cleanly: his punches land straight at you, his kicks stay straight through the hit, his elbows and spinning kicks reach you instead of striking short, and his low sweep passes right through you. The timing of every attack is unchanged.',
          'His guns now point where they fire, each shot leaving the muzzle with a kick of his arm and a curtain of falling code behind it. His palm bolts in the last phase are a hot core in turning rings of digits.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'Lu Wusheng draws like a swordsman',
        notes: [
          'In the Windless Grove his hand closes on the hilt before the draw, the scabbard pulls back as the blade leaves, and the cut ends in a deep lunge; his thrusts and his overhead read as real blows.',
          'To try: ?sheathPace=a (his scabbard blows wind up longer) and ?drawFx=a, b or c (three looks for the draw).',
        ],
      },
      {
        date: '2026-11-27',
        title: 'Bai Wuji glides: quicker, one-handed, and his barrier opens easier',
        notes: [
          "Bai Wuji fights with his hands in his pockets now: short, sharp kicks that land straight, a hand coming out in his second phase and both in his last. His blue and red blows hold a pose you can read; every later blow of a string comes out of a short blink around you.",
          'His barrier opens easier: two ordinary parries crack it open, a perfect parry or dodge opens it for longer, and your cuts hit two and a half times as hard while it is open. He has less health, and he loses patience after 20 seconds instead of 30.',
          'Fixed: a falling piece no longer lands on you while you are down, and a quick string of his can no longer hold you longer than it should.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'The Cinder Wyrm bites with its whole body',
        notes: [
          'The wyrm drives its body into a bite first, the head hanging back, then snaps onto the beat of its warning, its jaws reaching you as the hit lands.',
          'No change to any warning, timing or damage.',
        ],
      },
      {
        date: '2026-11-27',
        title: 'Halcyon fights like a flier: straight blows, long legs, heat vision and a thunderclap',
        notes: [
          'Halcyon fights like a flier now: his punches go straight at you with the arm long, his kicks land straight, his legs trail long behind him instead of folding under him, and Fly-By comes through your chest instead of over your head.',
          'His eye beams are heat vision: two threads meeting in one hard crimson line, a shimmer rising off it, the ground molten and spitting sparks where it lands.',
          'His clap and his meteor landing send a ring of air racing out across the plaza, shoving the dust ahead of it.',
          'Being tried out: add ?halPace=a to the address for a slower, easier-to-read pace.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'Shen Hui fights with better form',
        notes: [
          'The Ash Disciple thrusts on a straight arm out of a real lunge, brings his overheads down one-handed on a diagonal across you, turns his low sweeps on his feet, keeps his free hand quiet and lands his front foot with the blade. Same timings, same cues.',
          'Heaven-Splitting Fall is a real jump now: he tucks high with the blade raised, reaches his legs down and lands into the cut.',
          'Ember Whirl raises a cyclone of fire round him, and Heaven-Splitting Fall splits the floor in fire ahead of and behind him.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'Tian Lei audited: straight limbs, a readable pace, a sun for his ki blasts',
        notes: ['Tian Lei moves cleaner: his punches land with the arm straight down his centre, his kicks with the leg straight, and his low sweep comes from a drop stance. Every blow has a longer, held windup and the glint comes earlier, so each is easier to read. His ki blasts fly as small golden suns. Add ?ascMotion=a, ?ascPace=0 or ?ascShot=0 for each as before.'],
      },
      {
        date: '2026-11-26',
        title: 'The perfect parry earns its own reward: the deathblow',
        notes: [
          'Parrying the human bosses now builds toward a reward of its own: every parry fills his gold posture bar, and every perfect parry is banked.',
          'Break his posture with a parry, or parry one of his blue warning blows, and the hero answers with a DEATHBLOW for every perfect parry banked: up to seven blows where he stands, each a different cut, each freezing for a beat in him.',
          'Every deathblow leaves a cut across him that shatters on the last, sprays blood that pools on the floor, and sounds like a blade through flesh.',
          'Parry the last blow of a string and he recoils: strike back in that moment with your own counter cut. Parries no longer count toward the perfect-dodge streak.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'The hero runs with his sword held low, its point down beside his leg, gripped as a hand grips it',
        notes: [
          'On the run he grips his sword the way a hand does: its point hangs down beside his right leg, a little ahead, and rides with his arm as it swings, clear of his coat. His fist sits on the handle the way a hand grips one, and his free arm swings naturally with his stride. ?runSword=hip and ?runArm=d give the run before.',
          'Out of a run with the blade trailing behind him, blocking no longer flips the sword round in one frame.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'Wen Yao punches and kicks with straight limbs',
        notes: ['The Thousand-Body Fox now throws his punches and palms with a straight arm along one line to you, and lands his kicks and ankle sweeps with a straight leg. His heel and fists come down on you when he leaps. Paper Rain ends on a backfist, so his uppercut always means blue. Add ?foxLimbs=0 or ?foxCues=0 to see him as before.'],
      },
      {
        date: '2026-11-26',
        title: 'The flash chain: counter him three times in a row',
        notes: ['A flash counter (attack just before his blow lands) no longer ends his combo. He is knocked back and strikes back at once; counter that too, and once more. The third counter in a row hits hardest and leaves him reeling. Add ?counter=0 for the old single counter.'],
      },
      {
        date: '2026-11-26',
        title: 'The living world draws for less',
        notes: [
          'The wind, the weather, the footprints and the grass look exactly the same but take less work to draw, so fights run smoother.',
          'With ?perf in the address, BENCH now shows how much the living world costs on your device.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'Instant slashes, and a quieter left hand to choose',
        notes: [
          'Every sword attack now leaves one straight slash line where the blade passed, instead of the curved arc: a turning cut leaves three straight cuts around you, a thrust a short streak, a heavy blow a thicker violet line. Add ?slash=arc to the address for the arc as before.',
          'Being tried out: add ?offhand=side, ?offhand=back or ?offhand=quiet and your free hand hangs loose at your side, rests behind your back, or keeps its moves close to your body during one-handed attacks.',
          'Also being tried out: add ?feel=snap, ?feel=weight or ?feel=flow for the same attacks with a crisper, heavier or more fluid feel, light and heavy alike.',
          'The slash is now an ending slash: as each swing ends a straight cut flashes across your foe, running the way your sword went. Your light combo is now a new one built for it (add ?combo=0 for the old one, or ?combo=b, c or d for three more).',
        ],
      },
      {
        date: '2026-11-26',
        title: 'Blue and red blows you can read, and quick blows',
        notes: ['Lu Wusheng, Wen Yao and the Cinder Wyrm now hold still for a moment before every blue or red blow: tall for blue, low for red. The blow lands that moment later; its cue and timing are as before.', 'Each of them has a new quick white blow, straight from the stance with no wind-up: block it or parry it on the glint.', "Wen Yao's feet no longer jump as he steps into a blow."],
      },
      {
        date: '2026-11-26',
        title: 'A ninth level: the Veiled Crossing and Bai Wuji, the Untouched',
        notes: [
          'A new level, the Veiled Crossing: a city crossing levelled before you came, at night under a black veil. Pick it on the title screen.',
          'Its boss is Bai Wuji, the Untouched: a tall man in a white coat, his eyes covered, his hands in his pockets. Your blade stops short of him. A perfect parry or a perfect dodge opens his barrier for a few seconds.',
          'Every blow of his throws you, through whatever stands behind you. A block costs no health but slides you back and takes a big share of your guard: the third in a row knocks it open. His spells cannot be blocked at all.',
          'He waits for you to come to him: if your blade has not reached him for 30 seconds, his eyes burn and every block costs your whole guard until it does.',
          'At two thirds the blindfold comes off. At one third he makes a hand sign and a dark sphere closes on the arena: dodge through its wall at the last moment, or be caught. The last phase is fought inside the void, and the bonfire goes out until the city comes back.',
          "Halcyon's thrown pieces now land on the road instead of bursting in mid-air, and the metal rubble in his city lies grey instead of glowing orange.",
        ],
      },
      {
        date: '2026-11-26',
        title: 'Xin Yi rebuilt: a man in a coat, readable windups, faster hands',
        notes: ['Xin Yi now looks like a man in one long open coat, drawn like the hero.', 'His kicks land with the leg straight and his punches with the arm long, every blue or red blow has a windup pose you can read, his gun is aimed down his arm, and he has two new quick strings.'],
      },
      {
        date: '2026-11-26',
        title: 'Shen Hui and Varr Nihil hold their swords like swordsmen',
        notes: [
          'Shen Hui and Varr Nihil hold their blades in line with the hand and arm, and their arms open at the end of a blow.',
          'A blow to parry is wound up with the blade raised high and held; a blow to dodge, sunk low with the blade trailing near the floor. The timings are the same.',
          'Varr Nihil ends a string with a shake of the steel instead of a twirl. Each has two quick blows thrown straight out of the guard: block or parry them.',
        ],
      },
      {
        date: '2026-11-26',
        title: 'The bosses shaded and outlined like the hero',
        notes: ['Shen Hui, Varr Nihil, Tian Lei, Lu Wusheng and Halcyon keep their own colours and clothes but are lit the way the hero is: bright where the light catches them, falling off into dark letters on the shadow side. Three of them also get the hero\'s thicker outline on large screens.'],
      },
      {
        date: '2026-11-26',
        title: 'Tian Lei and Halcyon: held windups, quick jabs, and Halcyon fights like a flier',
        notes: ['Every parry or perfect-dodge blow of Tian Lei and Halcyon now winds up into a held pose of its own, so you can read it before the flash. Each has two quick jabs thrown straight from his guard. Halcyon flies into his blows instead of standing on air, and his fists meet you, not the air over your head.'],
      },
      {
        date: '2026-11-26',
        title: 'The drakelings never dive on top of the wyrm\'s blows',
        notes: ['In a long flurry of the Cinder Wyrm\'s, a drakeling could dive in the same instant as a blow that needed the other answer. It now waits for a clear moment, or burns out harmlessly, and the wyrm\'s embers never come due beside its dive.'],
      },
      {
        date: '2026-11-26',
        title: "Parrying is easier: the perfect parry's timing widened",
        notes: ['A parry pressed up to 0.2 s before the blow lands is now perfect, the same window as the perfect dodge (it was 0.08 s). Its extra posture damage, the fast critical counter cut, the blade lock and returned shots come far more easily.'],
      },
      {
        date: '2026-11-26',
        title: 'A lighter world on phones that need it',
        notes: ['On a phone that still drops frames at the lowest resolution, the ground\'s extra details turn off and the stone floors are drawn more simply, so fights stay smooth. Add ?lite=0 to the address to keep the full look.'],
      },
      {
        date: '2026-11-26',
        title: 'BENCH in the performance readout',
        notes: ['With ?perf in the address, BENCH holds the game still for a few seconds and measures what each drawing step costs your device. REPORT then includes it.'],
      },
      {
        date: '2026-11-26',
        title: 'A performance readout on your phone, and smoother first breaks',
        notes: [
          'Add ?perf to the address to see the frame rate and what each frame costs at the foot of the screen. REPORT shares or copies a summary you can send.',
          'The cracked floors and cut bamboo are now prepared while the level loads, so the first break in a fight no longer causes a hitch.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'Four looks for the perfect dodge flurry',
        notes: [
          'The Thunder Thrust look is on: the other looks are ?dodgefx=b, c or d, and ?dodgefx=off is the flurry before.',
          'Every look: a smear of the hero along each cut, sparks off the floor, and in a long streak a cut from above.',
          'A fourth finisher, the Thunder Thrust: a low set, one smeared lunge, the lunge held, letter trails over the floor.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The hero stands, holds and guards like the reference',
        notes: [
          'At ease the hero stands tall with his sword in one hand, its point forward and down by his right foot.',
          'In a fight he takes the sword in both hands before him, the point raised above his head.',
          'Now and then he puts the sword away at his hip, where it burns out in its green flame, and draws it back out of the flame.',
          'His guard is a braced crouch, both hands up before his chin and the blade across his face. Blocking and parrying work exactly as before.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The resolution follows the frame rate',
        notes: [
          'A new quality setting, AUTO, is on by default: when your device cannot hold 60 frames a second the game draws at a lower resolution, and climbs back when there is room (never in the middle of a fight).',
          'F2 or the pause menu cycles AUTO, LOW, MEDIUM and HIGH. A new 60 FPS CAP in the pause menu is on by default on phones and tablets, to keep them cooler.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The hero runs like a swordsman: the blade carried forward at his hip',
        notes: [
          'On the run the hero now carries his sword forward, low at his hip, its point rocking with his arm, instead of trailing it behind him on a bent wrist.',
          "His free arm pumps like a runner's, and his free hand is a closed fist instead of a small knob.",
        ],
      },
      {
        date: '2026-11-25',
        title: "The dragon's neck and head move naturally: no upside-down head, no flips",
        notes: [
          'The Cinder Wyrm no longer turns its head upside down when it flies, climbs or wheels round, and no longer looks straight back over its own spine.',
          'Its neck no longer snaps round in a single frame as you get behind it, its last bite in the storm flurry no longer bends its neck sideways away from its head, and its bites no longer flick the head round at the start.',
          'Its head stays upright with its body in every move, with the neck twisting naturally to keep it there.',
          'Through your flurry it loses you: its head no longer chases each blink.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The sword hand looks natural in the idle tricks',
        notes: [
          "In the wrist spin, the figure-eight, the salute and the sword spells, the hero's forearm now leads the blade, so his sword fist no longer twists off his wrist.",
          'In the salute and the spells the fist rises before his chest, so his raised arm no longer looks jagged from the game camera.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'Shadows cost less, and their edges stop crawling',
        notes: [
          'The moon\'s shadows look the same, but the trees, rocks and walls that do not move are no longer drawn into them again every frame: the game does far less work for them.',
          'The edges of the shadows, and the letters along them, no longer shimmer while you walk.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The game runs faster on weaker machines',
        notes: [
          'The picture is the same, and it costs less to draw: the ground is drawn after the things that cover it, and its relief is worked out once when a level loads instead of for every pixel of every frame.',
          'A machine that cannot hold 50 frames a second no longer does all the extra work it used to: only the hero and the boss take the extra steps that keep parries fair.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The world is printed like the dragon',
        notes: [
          "Every level is now printed in the dragon's own fine digits: the ground, the floors, the grass, the rocks and the trees. Dark where they turn from the moon, bright where the light catches them, so the ground has depth and shadows fall across it.",
          'The grass lies down as you run through it and rises again, and your sword cuts it where it passes: the tufts fly and a dark swath stays. Fallen leaves lie as small lit leaves.',
          'Cloud shadows drift with the wind, heavy blows send a ring of digits through the ground, and your footsteps flash in green code for a moment.',
          'To see the world as it was, add ?dragon=0 to the address.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The first load is faster',
        notes: [
          'The loading screen now prepares all the graphics the first frame needs at once, so a first visit reaches the game in about two thirds of the time.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'Your clicks reach the fight again',
        notes: [
          'After the title faded, its invisible panels sat over the game and caught your clicks: attacks and blocks did nothing, and a click could send you to another world and back to the loading screen. Fixed.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'Every fire comes from the wyrm; it roars up spells and a brood of fire; a forest you can walk into',
        notes: [
          'The Cinder Wyrm\'s fire always comes from the wyrm now: the chasing lava pillars follow a glowing crack that runs out of its feet, its second wall of fire is laid out from the first, and its meteors pour out of a burning vortex above it.',
          'It roars up new spells over a ring of burning dragon script: fire drakelings that circle and bite (cut them down), wisps that tear off its body and dive at you, a fire serpent that burns a path through the forest, and a firestorm that drifts at you and bursts.',
          'No more invisible walls in Cinderwood: walk out among the trees to the forest\'s real end. The forest is thicker and more alive, and it all breaks and burns.',
        ],
      },
      {
        date: '2026-11-25',
        title: "A loading screen, and the worlds picked along the sword's path",
        notes: [
          'A loading screen shows from the first moment: the gcd logo, each step of the start, a progress bar and a line of lore.',
          'The title shows the worlds as fires along the path the sword travels. Pick one to see its keeper and your best, then travel there.',
          "The full controls list is behind CONTROLS on the title. The name over the hero's head is gcd, and it stays close to him.",
        ],
      },
      {
        date: '2026-11-25',
        title: 'The game is called gcd',
        notes: [
          'The game has a new name, gcd, written in lower case: on the title screen, in the browser tab and here.',
          'gcd is the hero too: a mysterious being who wields the most powerful sword in all universes. The sword lets him defeat these legendary bosses, and it carries him between campfires in different worlds and universes.',
          'The game moves to a new address with its name, so your key bindings, records and learned techniques start fresh.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'The bosses look built from letters, like the hero',
        notes: [
          'Every human boss is drawn the way your hero is: a body of lit letters in his own colours, the same outline, and below the knee his clothes break into a pale, ragged hem that flows like your cape.',
          'Lu Wusheng now prints in those letters too, not in big digits.',
          'To compare: ?bossPrint=a draws them in the hero\'s greys, ?bossPrint=0 as before.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The grass bends as you run through it and springs back',
        notes: [
          'Running through the grass no longer leaves a dark trail behind you. The blades bend out of your way and rise again a moment after you pass.',
          'To see the old trail, add ?bend=0 to the address.',
        ],
      },
      {
        date: '2026-11-25',
        title: "The sword's cut throws green code",
        notes: [
          'Where your sword cuts the grass, small green code glyphs burst off the cut, flicker as they fly and settle into the grass.',
          'To turn it off, add ?grassSpray=0 to the address.',
        ],
      },
      {
        date: '2026-11-25',
        title: 'The resting blade no longer glows',
        notes: [
          'A bright white halo no longer blooms round your sword while you stand still at some angles.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'The hero comes alive standing still',
        notes: [
          'Standing still, the hero no longer keeps his hand on his hip. He shifts between rests, re-grips his sword, rolls his shoulders, brushes his coat, and every few moments shows a sword trick (a wrist spin, a figure-eight, a salute, a flick of the blade) or quietly works a spell in the sword\'s green flame: a ring of marks round him, the flame climbing the blade under his fingers, a thread of light circling him.',
          'In a boss fight his free hand comes off the belt into a guard that changes as he waits, with small shifts of the blade, and no tricks. Add ?idles=old to the address for the stance before.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'A natural running arm, three ways to carry it',
        notes: [
          "Your free hand swings like a runner's now: the elbow bent and working with the stride, the hand open and loose. At a sprint it pumps harder. Strafing round a boss it keeps swinging.",
          'His free hand is smaller too, so it no longer stands out against his dark coat.',
          "Other ways to carry it: add ?runArm=b (a swordsman's dash, swept back behind him) or ?runArm=c (natural, then the dash at a sprint) to the address; ?runArm=old is the swing before.",
        ],
      },
      {
        date: '2026-11-24',
        title: 'Smaller combat text',
        notes: [
          'The words over your hero (PARRY, DEFLECT, COUNTER and the rest) and the damage numbers are smaller, closer to the HUD\'s own text.',
          'They no longer grow with a bigger window: the same size on any screen.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'The Cinder Wyrm wakes without a neck twist, and its head reads from above',
        notes: [
          'When the fight starts the wyrm now lifts its head, rises and turns to you in one motion: no more neck snapping round and the head flipping over.',
          'Seen from above, its head is a dark blade with burning slits for eyes: dark horns swept back, no glowing dots, a crest down the skull. From the side it looks as before.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'A green flame on the sword',
        notes: [
          'A tight flame of tiny green marks now burns round your sword, licking up off the blade. It is there even with no streak and burns denser and hotter as your streak climbs. Add ?mystic=0 to the address to turn it off.',
        ],
      },
      {
        date: '2026-11-25',
        title: "The streak's answer: a heavy first cut, a path that flows, cuts that tear the picture",
        notes: [
          'The cuts that answer a perfect dodge or a parry no longer flick by at low streaks: the first one is a beat you can read, and each cut after it comes faster, so a streak of 7 still ends in a storm.',
          'He flows from cut to cut: each pass starts where the last one ended, and every white slash is exactly where he ran. The stray curved slashes at the end are gone, and the last blow bursts into fine letter dust.',
          'Every streak draws a different figure round the boss (a star, a zigzag, a cage, a spiral, a cross), and each cut tears the picture: the letters on either side of it slide apart for an instant.',
          'Damage and rules are the same.',
        ],
      },
      {
        date: '2026-11-24',
        title: 'A perfect parry throws a few orange sparks',
        notes: [
          'Parry perfectly and a quick spit of orange sparks flies off the crossed blades, the way real steel sparks: short streaks that shrink to dots and die in under half a second.',
          'Nothing else changes: the gold flash, the freeze and the sound are as before, and normal parries and the perfect dodge look the same.',
          'Prefer the parry without them? Add ?parryFx=0 to the address.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Every sound effect is back to its first synth version',
        notes: [
          'Parries, hits, warnings and swings are back to their first synthesized sounds, as at the start.',
          'The recorded music for each level and boss is unchanged.',
          'Want the recorded and designed sounds back? Add ?sfx=new to the address (or use the Lab).',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Grades, saved bests and a boss rush',
        notes: [
          'Every won fight now gets a grade, S, A, B or C, for clean play: how many times you died and how much health the winning attempt cost you. Time never changes the grade; it only decides which of two equal runs is better.',
          'Blocking, parrying and dodging can all earn an S: a blow met on your guard costs guard, not health.',
          'Beside the grade: UNTOUCHED (no damage at all), DEATHLESS and NO FLASK. The record shows your time to the hundredth, NEW BEST, and the best you had before.',
          'The title shows each level\'s best grade and best time under its name.',
          'BOSS RUSH on the title: all eight bosses back to back for one time. Health and flasks are full before every fight. A death retries the same boss and the clock keeps running; a reload mid-fight counts as a death. A small timer and "3 / 8" sit under the map.',
          'Runs with the Lab open, a cheat or a gameplay switch in the address are not recorded, and the record says why.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'The sword mows the grass; lanterns light with the fight; the living world is heard',
        notes: [
          'Your sword cuts the grass under its swing the moment it passes, tossing the cut tops lightly into the air. The stubble stays until the fight resets.',
          "Boss attacks tear the grass out where they land, so their marks now show in the meadow. The dragon's claws leave three raked furrows.",
          'The stone lanterns at Ashfall, Foxfire and the Windless Grove light as the fight goes on, flicker when a heavy blow lands near, and go out when broken.',
          'You now hear the world around the fight: birds taking off, animals bolting, trees shaking and creaking, lanterns catching. All of it quiet, under the fight.',
          'To see the grass as it was, add ?mow=0 to the address.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'The sword cuts clean through; the fight marks the ground; birds and animals flee',
        notes: [
          'Your sword no longer stops when it meets a rock, a tree or a pillar. The swing goes through at full speed, chips fly along the cut, stone sparks and wood splinters.',
          'Every boss attack that hits the ground now leaves its own mark: a crater for a slam, a long gash for a sword cut, a furrow for a dash, a scorched round for a blast, a trench for a beam. The marks stay until the fight resets, so the arena shows the fight.',
          'Birds burst out of the trees and cross the sky when fire, a heavy blow or a falling tree reaches them.',
          'Small animals bolt as you or the fight come near: rabbits and deer in Cinderwood, rats in the Ashfall ruins, lizards at the Skybreak Ring, one fox at the Foxfire shrine.',
          'Heavy blows shake the set: leaves fall from a struck tree, dust sifts off pillars, banners and paper charms swing. Afterwards thin smoke rises where fire burned out.',
          'None of this changes how the fight plays.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Combat sounds, round two: real steel on the parry, picked by ear',
        notes: [
          'Parries now ring with real swords: a sword on a katana, and a spear on a katana for a blue or perfect parry.',
          'Getting hit, two blades clashing, the slam and the plunge have new recorded sounds; your cuts landing, the flurry and a boss holding your strike have new sounds made for the game.',
          'A string of parries no longer climbs like a xylophone: the chain gets heavier instead.',
          'The blue warning and your heavy cut and finishing thrust are back to their first sounds.',
          'Prefer the old sounds? Add ?sfx=old to the address.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'An eighth level: Halcyon Plaza and Halcyon, the Last Saviour',
        notes: [
          'A new level, Halcyon Plaza: a city of rain and neon that has not been built yet. Pick it on the title screen.',
          'Its boss is Halcyon, the Last Saviour: a flying strongman in a caped suit, with red light for eyes. He hovers within reach of your sword.',
          'Parry his pass and he crashes through the nearest storefront or car. Perfectly parry his stare and it goes back into his eyes. Parry a thrown car and you cut it in two.',
          'Everything in the city breaks, and the cars explode: one you broke hurts him too.',
          'At two thirds the smile drops and every screen turns red. At one third he puts the city out and starts dropping buildings.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Xin Yi reworked: drawn like the hero, kicks and flurries, a wall kick, bullets that never lock you',
        notes: [
          'Xin Yi is drawn in letters like the hero: quieter, simpler, his coat moving in every phase.',
          'Phase 1 is faster and full of kicks: spinning kicks, tornado and butterfly kicks, kicks in the air, and flurries of blows.',
          'A flurry is one glint: one parry turns it all, a held guard costs a little guard and no health, one roll passes it.',
          'He runs up the pillar or screen at your side and springs at you: parry the flying kick, roll the drop heel.',
          'About a third into the fight his second hand comes out: watch for the opening as it does.',
          'His bullets come in bursts of three, each with one glint. A hit is a short flinch: you can always guard, parry or roll before the next burst.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'The living world',
        notes: [
          'The levels are now alive before the fight: faint wisps of tiny letters drift across on the wind, leaves and ash fall and lie, banners and paper charms stream, mist and drizzle pass, birds lift off as you run near.',
          'Your footsteps answer the ground: prints in the ash, trodden grass, a different sound on stone, earth and grass.',
          'Each level has its own weather and its own air. The Windless Grove is dead still. The Obsidian Throne only breathes.',
          'It all steps back once the boss is up, and a roar sends a gust across the whole arena.',
          'To see the levels as they were, add ?life=off to the address.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Streaks that build: the flurry speeds up, the hero smoulders, the notes climb; a sharper perfect parry',
        notes: [
          'A long flurry speeds up: the first cuts come as before, then each one faster, until the last land almost at once. A long streak no longer means a long wait.',
          'Past seven, a streak cannot add blows or damage, but it looks grander: at 10 and at 15 every cut left hanging gets fine echo lines, and the flurry is named HUNDREDFOLD FLASH or THOUSANDFOLD FLASH.',
          "The flurry's last blow no longer blooms into a white blot: the hanging cuts flare out as long thin lines, so you can still see both fighters.",
          'From a streak of 3 a faint rim of fire letters clings to your outline and grows with the streak; your blade edge lights further up and your swings leave echo lines. Lose the streak and it all goes out at once.',
          'From a streak of 5 the ground answers each perfect defence: the grass leans and the dust lifts at your feet.',
          'A small number beside you counts each perfect defence of a streak and fades, with a word at 3, 5, 7, 10 and 15. A broken streak shows its number struck through as it falls.',
          'Each perfect defence in a streak rings a soft note one step higher, in the key of the music; a quiet drone joins on long streaks, and a broken streak ends on a falling note.',
          'A perfect parry is quicker and cleaner: a gold mark where the blades cross, less slow motion, a softer flash. A perfect dodge leaves your afterimage standing for a moment before it tears away. The timing of parries and dodges is unchanged.',
        ],
      },
      {
        date: '2026-11-23',
        title: "Tian Lei's attacks move naturally, and he stops punching the air",
        notes: [
          "Tian Lei's feet stay planted while he strikes: they no longer jump or slide.",
          'His punches land with the arm extended, and his palm thrusts stop at your body instead of going through it.',
          "Step or run out of his reach while he winds up and he stops the blow before it flashes and comes after you, instead of punching the air.",
        ],
      },
      {
        date: '2026-11-23',
        title: 'Tian Lei drawn like the hero, with shorter gold hair and a new gi',
        notes: [
          'Tian Lei is drawn in the same size of letters as you are, and in darker, quieter letters: on a large screen he no longer looks like a detailed 3D model beside you.',
          'His gold hair in his second and third forms is his own spiky hair standing up, not a tall crown.',
          'He wears a burnt-red gi with black, and cloth wraps on his arms and legs.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'A seventh level: the Hall of Falling Script and the One Who Woke',
        notes: [
          'A new level, the Hall of Falling Script: a pillared hall written in falling green letters. Pick it on the title screen.',
          'Its boss is Xin Yi, the One Who Woke, a man in a long black coat and small dark glasses. He fights with one hand behind his back, then with two guns, then with nothing at all.',
          'He beckons, and the hall rewrites itself around him: a wooden sparring hall, the pillared hall again, and in the end a black void of falling code. Every pillar, post and screen breaks.',
          'In the pillared hall, stand behind a pillar: it takes his shots and loses its letters where they hit. A held guard against his stream of shots costs guard, never health.',
          'Parry a big shot perfectly and it flies back: he bends under it, time slows, and for a second he is open. He cannot do it twice in a row.',
          'Empty his first bar and he falls. He rises in the void with a second bar, stops what you send back in the air, tears bricks out of the code and drops on you from above: roll through the shockwave.',
          'Sometimes the hall stutters, as if a moment repeated: he is about to throw the same string again, exactly as before.',
          'Beat him and you learn the Long Second: hold guard and dodge with no direction to lean back under a blow and stay in reach.',
        ],
      },
      {
        date: '2026-11-23',
        title: 'Wen Yao reworked: copies out of the air, the big Pearl, the Nine-Tailed Fox',
        notes: [
          'Wen Yao, the Thousand-Body Fox, is now drawn as brightly as you are: a russet crest, an amber jacket and a long red scarf.',
          'His copies no longer stand about. They appear in the air already striking, all at once or one after another from every side. When they come together it is one cue: one parry bursts them all.',
          'The Pearl in his palm is big now, a spinning blue-white orb. Pop the copies that harry you while he shapes it, or they feed it.',
          'In his last phase he summons the Nine-Tailed Fox. When the red flash shows at its jaws, roll; the beam sweeps toward you one way only, so roll back through it. Then he kneels, open.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'Attack sounds: cues only for blue and red, every blow sounds like its weapon',
        notes: [
          'White attacks no longer make a warning sound: watch the glint, and listen to the weapon.',
          'A blue attack (parry it) rings like a sword left ringing as the windup starts.',
          'A red attack (dodge it) opens on a deep log drum, and the same drum, short, marks the moment to dodge.',
          'Every boss blow now sounds as it travels: a sword cutting the air, a fist or a kick, the wyrm\'s claws and tail. Your own sword too.',
          'Prefer the old sounds? Add ?sfx=old to the address.',
        ],
      },
      {
        date: '2026-11-22',
        title: "The grove's bamboo falls to every stroke",
        notes: [
          'In the Windless Grove one swing cuts a bamboo stalk clean through where your blade passes, and the top slides off and crashes down in a burst of leaves. Swing through a clump and the whole clump comes down.',
          'The grove is fuller and more varied: green, jade, golden, black and dry canes, in clumps and lone stalks, and it runs on far behind the duel.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'The Sheathed, easy to see',
        notes: [
          'Lu Wusheng is now printed in digits of his own colours, lit and outlined so he stands out from the grove floor: an indigo robe, grey trousers and a sand scarf.',
          'He looks more like a wanderer: a long loose robe over wide trousers, a long scarf, a high tail, and a torn strip of cloth tied to his scabbard that trails as he moves and snaps when he draws.',
          'He moves like one: a quiet stance with his hand at his sash, a low run with the sword held back, and a sudden turn into the draw.',
          'New lines and move names for a man who has sworn not to draw.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'A sixth level: the Windless Grove and the Sheathed',
        notes: [
          'A new level, the Windless Grove: a bamboo grove at night, a clearing, and a mound of planted swords. Pick it on the title screen.',
          'Its boss is Lu Wusheng, the Sheathed. His sword stays in its scabbard: everything else he does is blunt. Then he goes still, there is a click and a blue flash at the scabbard, and he draws.',
          'Parry the draw or roll through it. A held guard keeps you alive but is knocked open. Anything else is death.',
          'He never draws on you while you are down or your guard is broken.',
          'Beat him and you learn One Breath: guard, then hold heavy, and release to cut five metres in a blink. Released just before a blow lands, it beats the blow aside.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'Tian Lei in the orange gi, and the instant beam',
        notes: [
          'Tian Lei now fights in an orange gi with spiky black hair that turns gold when he transforms.',
          'In his third form he can touch two fingers to his brow, appear right beside you and fire a beam point-blank. Watch for the red flash and roll out of the line.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'Cuts land with weight: the hit printed where it lands, the boss\'s body answers',
        notes: [
          'When your cut lands on a human boss, the hit prints itself into his letters for a moment: a slit that opens for a cut, rings round a thrust, a star for the slam.',
          'A wave runs out through the boss\'s letters from where the blade struck. A light cut sends a small one; a slam, a charged cleave or the execution sends one across the whole body.',
          'The boss\'s body answers where you hit it: a head cut snaps the head aside, a body cut twists him, a leg cut buckles the knee. The Cinder Wyrm\'s head, neck, body, wings and tail each answer their own way.',
          'Heavy blows land with a deeper thump, and the music ducks for a moment under them.',
          'The white glare where your blade meets the boss is a little softer, so you can see all of this happen.',
          'None of it changes the fight: hits, timing and the bosses\' moves are as they were.',
        ],
      },
      {
        date: '2026-11-22',
        title: "Tian Lei's third wave: the sign, the counter stances, the great orb and the barrage",
        notes: [
          'In the Skybreak Ring, Tian Lei now raises two fingers to his brow before he vanishes: a snap of light, and he is behind you with the blow still coming. When the hand goes up, turn.',
          'He has a counter stance in every form: open palms with light drawn into them. Cut into it and he catches your blade and punishes at once. Wait it out and he is left open.',
          "Heaven's Lantern: he rises and gathers a great golden orb, then throws it at where you will be. Parry or block it and you are safe, roll and it passes. Parry it perfectly and it stops on your blade: mash attack to push it back into him.",
          'Raining Suns: he leaps and pours sixteen small blasts down around you, then a bigger one you can parry back.',
          'Three more counters out of his guard, so his answers vary.',
        ],
      },
      {
        date: '2026-11-22',
        title: 'Round the Obsidian Throne, what the challengers left',
        notes: [
          'The fallen trees round the Obsidian Throne are gone. In their place lies what earlier challengers left behind: swords planted as graves, spears with a torn banner, cairns with a straw hat, wrecked carts, old steles and split boulders.',
          'Every piece is different, and they lie the way the star\'s fall threw them, not in a neat ring.',
          'Most of them break when the fight reaches them, and the wooden ones burn.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'The letters come off where the blow lands',
        notes: [
          'Trees, stones, pillars, statues and bones lose their letters exactly where a blow lands, yours or the boss\'s.',
          'A blade cuts a notch into a trunk, a heavy blow knocks the face of a stone in, a blast eats the side that faced it. The pieces fly out of the cut.',
          'Your sword stops on what it cannot cut through: it bites into wood and rings off stone with sparks, then is thrown back. A blow that fells the thing goes through.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'A fifth level: the Foxfire Terrace and Wen Yao, the Thousand-Body Fox',
        notes: [
          'A new level, the Foxfire Terrace: a round terrace on a moonlit hill shrine, ringed by stone lanterns, stone foxes and paper charms. Pick it on the title screen.',
          'Its boss is Wen Yao, the Thousand-Body Fox, a masked bare-handed fighter who tears paper copies of himself off his body. They strike as a pack with the same white cue as his blows, and one cut pops a copy.',
          'The real one is always the one you are locked on to: the only one with a shadow, a steel blade and, later, the fire.',
          'He shapes a spinning pearl in his open palm, a copy holding it with him and every other copy feeding it, then dashes in and drives it into you. Pop copies to make it weaker, hit him twice while he shapes it to burst it in his hand, or roll.',
          'In his second phase he trades places with his copies, springs off their hands at you, and they all strike in turn around you. In the last a nine-tailed fox of fire wakes around him, one more tail as his health runs out.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'On a phone: the health bars no longer overlap, and two new ways to hold the controls',
        notes: [
          'Your health and the boss\'s no longer run into each other on a phone. Your meters are shorter there and the boss\'s bar takes the room that is left.',
          'New in the pause menu, PAD LAYOUT: "guard on left" moves the guard to a button beside the stick, so your right thumb can keep cutting while your left one parries.',
          'New in the pause menu, HOLD ATTACK: rest your thumb on ATTACK and the wanderer keeps cutting, no tapping. Both are off until you turn them on.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'The hero looks the same on every screen',
        notes: [
          'The wanderer is drawn with the same bold letters on a phone, a laptop and a large monitor, and when the camera pulls in or out. On large screens he used to turn into a mesh of tiny ones.',
          'From the front and the side he is one dark figure now, and his sword is plain dark steel that lights up white only while it cuts.',
          'The bosses and the fight are unchanged.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'A fourth level: the Skybreak Ring and Tian Lei, the Last Ascendant',
        notes: [
          'A new level, the Skybreak Ring: a tournament ring of stone tiles out on the badlands. Pick it on the title screen.',
          'Its boss is Tian Lei, the Last Ascendant, who fights bare-handed and has three health bars. Empty a bar and land the deathblow, and he transforms instead of dying.',
          'First he is a martial artist: punches, kicks, a kicked floor tile, a blast you can parry back at him, and one beam.',
          'Then a golden flame stands round him. He vanishes and strikes from behind, throws volleys and a disc that returns, and drags a beam across the ring.',
          'Last comes the storm: lightning falls all through the form, and he fires his great beam. Parry its head at the blue flash to start a struggle, and mash attack to cut the beam in two.',
          'Any beam can be stepped off, rolled through or held on your guard. A guard loses guard, never health.',
          'The ring breaks as you fight: tiles shatter, beams cut trenches and knock the tops off the rocks around you.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'Felled trees lie as the blow left them',
        notes: [
          'No two felled trees look alike now. A blade leaves a tall stump cut on a slant, a heavy blow tears it lower, a blast shatters it close to the ground, and fire leaves it low and black.',
          'Trunks land at their own angle, often snapped in two, and some trees that burn down stay standing as black snags.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'The Cinder Wyrm glares from every side',
        notes: [
          'The wyrm\'s eyes are slanted slits of fire under a heavy brow, so it glares at you from the side, from the front and from below, not only from one angle.',
          'Its neck no longer looks broken while it stands: the neck arches over into the head, and the head stays level as it watches you.',
          'The fight is unchanged.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'The Ash Disciple and the Starless Lord move like swordsmen',
        notes: [
          'Shen Hui and the Starless Lord swing their blades now: a cut speeds up into the blow, follows through and flows into the next one. Before, they jumped from one held pose to the next.',
          'Their feet hold the ground and take steps as a string carries them toward you, instead of sliding.',
          'Shen Hui raises his overhead clear of his hat and keeps his eyes on you through the chop; his whirl turns on a hop. The Lord rolls his blade in front of him, not through his hood.',
          'Nothing about the timing changed: every flash, every windup and every reach is what it was.',
        ],
      },
      {
        date: '2026-11-21',
        title: 'The wall of trees comes down and the fight goes out through it',
        notes: [
          'In Cinderwood the ring of trees round the clearing no longer holds you once it starts to fall. Where a tree has burnt through or been felled, the ground behind it is open, out to the next tree still standing.',
          'The wyrm follows you through any gap wide enough for its body, and its fire and meteors follow you everywhere. A tree that falls where you can now stand must be dodged.',
          'The fight starts as it always did: nothing opens until the first tree of the wall is down. The wall stands again when you die or rest.',
        ],
      },
      {
        date: '2026-11-20',
        title: 'The Cinder Wyrm has a new face',
        notes: [
          'The Cinder Wyrm has a new head: a long hooked snout, a heavy brow over each eye, long horns swept back over its neck and fins off its cheeks.',
          'Its eyes burn in dark sockets, and when it roars its mouth is a black cavern with a red tongue, long fangs and fire at the back of the throat.',
          'The fight is unchanged: its bite, its breath and where you can hit its head are the same.',
        ],
      },
      {
        date: '2026-11-20',
        title: 'The Cinder Wyrm is leaner and carries its head high',
        notes: [
          'The Cinder Wyrm has a leaner build: a tucked waist, a shallower chest, thinner neck, legs and tail, and longer talons. Its letters, colours and wings are the ones it had.',
          'Between attacks it holds its head high on a rising neck. The head is narrower, with longer fangs, horns and frills, and a mane of quills runs down its neck, back and tail.',
          'The fight itself is unchanged: its reach, its timings and its attacks are the same.',
        ],
      },
      {
        date: '2026-11-16',
        title: 'The Ash Disciple and the Starless Lord fight harder, in arenas that break',
        notes: [
          'Both human bosses give far fewer pauses and chain their moves by where you stand, busier in every phase. Each hit hurts as much as before, and two attacks that need different answers never land at the same moment.',
          'Shen Hui has a third phase: he vanishes into ash and strikes from another side. Sixteen new moves, and from phase 2 his cuts leave lines of fire on the stones. Step off them: fire drains your guard, never your health.',
          'The Starless Lord casts inside his strings and has nineteen new moves. In his last form strikes keep falling from the sky, and Starless Night sends three waves across the whole crater.',
          'Both arenas break: floors crack and shatter, statues come down, and both bosses throw the floor at you. Thrown pieces show no mark on the ground: answer the flash on the flying piece.',
        ],
      },
      {
        date: '2026-11-16',
        title: 'The wyrm burns in phase 3, the forest breaks, the letters follow the zoom',
        notes: [
          'In its third phase the Cinder Wyrm sets itself on fire: wing tips, claws and tail burn, and fast moves leave arcs and ribbons of flame. Its attacks hurt as much as before, and its burning footprints do not hurt at all.',
          'Every tree in Cinderwood can break now, and wears down first: leaves burst off, the crown thins, it leans, it falls. The wyrm tears into the tree wall with wind and stray fire. The great skeleton and the Cinder Tree come apart too.',
          'Zooming out on a desktop keeps the detail: the small letters shrink with the picture instead of getting scarce.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The Cinder Wyrm fights harder, with its whole body',
        notes: [
          'The wyrm gives far fewer pauses and chains its attacks: claws, jaws, wings, tail, fire and flight in one flow, busier in every phase. Each hit hurts as much as before.',
          'New attacks: wing sweeps and slams, tail whips and slams, a bite that ends in fire, flying combos of up to four attacks, and fire that crawls along the ground. The blue homing wisps are gone.',
          'Thrown trees and boulders come twice as fast with no mark on the ground: roll at the red flash. The whole clearing now breaks, and the wreckage stays.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Red, blue and black flashes: dodge, parry, and a charged blow',
        notes: [
          'A red flash across the screen is now the only sign of an attack you must dodge: no red glow, no red ring on the floor. Dodge at the flash and the hero answers with his flurry.',
          'A blue flash marks a blow to parry. Parry it and the boss\'s combo ends and the hero counters by himself.',
          'Every boss has a black charged attack: darkness gathers on the weapon, then a black flash. Dodge it. Blocking it costs no health but empties the whole guard meter.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Dark music for every level and every boss phase',
        notes: [
          'Each level has its own dark music while you explore, and every boss phase has its own track that takes over when the phase changes: three for the Cinder Wyrm, two for the Ash Disciple, four for the Starless Lord.',
          'A short victory fanfare and a game-over theme. All 14 tracks are free (CC0) recordings from OpenGameArt, picked by ear.',
          'Sound effects are unchanged. The old synthesised music still plays while a track loads.',
        ],
      },
      {
        date: '2026-11-15',
        title: "What's new in the menu; the phone camera stays back",
        notes: [
          "WHAT'S NEW on the title screen and in the pause menu lists every version and what changed. A badge counts what you have not read yet.",
          'Phones: a duel\'s slow-motion moments (parry, blade lock, counter, execution) no longer pull the camera in to the knees. They come in as far as on a computer, for the phone\'s closer camera.',
          'iPhone: a quick double tap (mashing ATTACK, LOCK twice) zoomed the whole page in and it stayed stuck. Double taps are blocked now, and a page that gets zoomed anyway snaps back.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'A heavy attack, and five heavies to choose from',
        notes: [
          'A HEAVY button (right click, R2, a fourth tile on the phone): on its own a dashing two-handed thrust.',
          "After the first to fourth light of the combo it is that point's own heavy: a rising cut that staggers, a spinning sweep, a guard-breaking falling cut, a bigger slam.",
          'Hold HEAVY to charge the cleave, so a light attack comes out the instant you press it. Block moved to the middle click, lock-on to Tab.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The hero stands like a swordsman',
        notes: [
          'Exploring, he stands at ease: a hand on his belt, the blade carried down his arm.',
          "Locked on or in a boss fight, he holds a fencer's guard with the point on the enemy, and keeps it while he moves.",
          'He breathes, shifts his weight and looks around.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Fire, spells and effects made of the same small letters',
        notes: [
          'All fire is one body of small digits: a white-hot heart, an orange body, red tongues and grey smoke.',
          "The duelists' lightning, crescents and Void spells are drawn the same way. The Lord's spells are white and violet now.",
          'One set of timing cues for every boss: a white cross to parry, an eight-point star for a heavy blow, a red blaze to dodge.',
          'The landmarks are rebuilt and moved to where the fight\'s camera looks.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The Ash Disciple uses the courtyard',
        notes: [
          'Severed Pillar: he cuts through the pillar you stand under. Leave the red strip.',
          'Flying Lantern: he kicks a stone lantern at you. Parry it or leave the ring.',
          'Three Tolls: three rings of sound from the bell. Parry them in rhythm, roll through, or run in.',
          'Swallow\'s Return: he leaps onto a pillar and dives at you from another side.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The Cinder Wyrm uses the ground',
        notes: [
          'Uproot and hurl: it tears out a tree or boulder and throws it. Get out of the glow.',
          'Tail bat: a boulder skims along a glowing line. Parry, block, step aside or take cover.',
          'Firebrand (phase 2): it throws a burning tree that sets the grass alight.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The Starless Lord uses the crater',
        notes: [
          'Void Hurl: a hanging stone or a shard is thrown at a ringed spot. The ring gives you time to run out of it.',
          'Glass Rain (forms 3 and 4): three throws in a row.',
          'Crown Fall (forms 2 to 4): stand by something tall and he pulls it down on you.',
          'Stagger him in the windup and the stone drops.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The Obsidian Throne is open',
        notes: [
          "The Lord's level is now the crater where he fell: cracked black plates, glass shards, stones hanging in the air and a broken crown of slabs.",
          'No walls stand between the camera and the duel. He wakes when you step onto the floor.',
          'The shards and slabs break and are cover.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The death screen names what killed you',
        notes: [
          'Under YOU DIED: the move that dealt the last blow, and which moves hit you and how often.',
          'The victory record shows what struck you most.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The world breaks',
        notes: [
          'Trees, stones, boulders, pillars and lanterns chip, break and fall, by your blows and the bosses\'.',
          'Fell a piece onto a boss to hurt it badly. Under one a boss fells, take the red blow or roll out.',
          'Anything tall is cover against bullets, crescents, thrown stones and the Void, until it breaks.',
          'Fire burns where it lands for a few seconds, then leaves ash. It never spreads.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'You can see yourself behind the dragon',
        notes: [
          'When the wyrm, a tree or a pillar covers the hero, he shows through it as a cyan ghost of his own outline.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The same fight at any frame rate',
        notes: [
          'On a slow device the timing windows are as fair as on a fast one, and the game no longer runs in slow motion under 20 fps.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The riskier the answer, the more it pays',
        notes: [
          'The flurry now answers a perfect dodge of a red blow only. White and heavy dodges still build your streak.',
          'Flash counter: attack at the last instant before a duelist\'s blow and cut straight through it.',
          'A perfect parry deals more posture and makes your next light cut fast and critical.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'The flurry reads against the human bosses, and every blink leaves an ASCII afterimage',
        notes: [
          'Each flash cut against a duelist winds up, runs past his side and ends in a finish you can see.',
          'Every blink leaves your outline behind in cold blue digits that fall apart.',
        ],
      },
      {
        date: '2026-11-15',
        title: "The boss's bar at the top; QUIT TO TITLE",
        notes: [
          "The boss's name, HP and posture sit at the top centre.",
          'The pause menu has QUIT TO TITLE (press it twice).',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Background objects drawn like the dragon, and landmarks',
        notes: [
          'Pillars, stones, lanterns, the throne, bones and the bonfire are made of the wyrm\'s small digits.',
          'Each level has big set pieces: an elder wyrm\'s skeleton, colossal stone swordsmen, a sect gate and more.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Training mode and a lab stage',
        notes: [
          'F4 opens Training: every situation worth practising, one click each, with the game playing your side.',
          'A training room stage: a dark dojo with a measuring grid.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'An ASCII HUD',
        notes: [
          'HP, guard and the boss\'s bars are rows of characters drawn on the game.',
          'YOU DIED, victory and area names are block letters like the title logo.',
          'The minimap is a small faint disc.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'Phone controls you can hold, and a guard meter',
        notes: [
          'ATTACK, BLOCK and DODGE are three tiles that touch: slide your thumb between them. Move and size them in the pause menu.',
          'A guard meter: a blocked blow costs guard, not HP. Run it dry and your guard is knocked open.',
          'Play upright: holding the phone in portrait works.',
        ],
      },
      {
        date: '2026-11-15',
        title: 'Weight on the flurry; one streak; the riposte; bosses with a streak of their own',
        notes: [
          'Flash cuts land with a freeze, the boss reels and the last blow staggers a duelist.',
          'Parries count in your streak. Parry the last blow of a string for a riposte.',
          'Duelists keep a streak too and answer with their own flurry. Parry or block it all to break them.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'The Cinder Wyrm in large, readable letters',
        notes: ['The wyrm was printed in large bold symbols for a day. The next entry replaced it.'],
      },
      {
        date: '2026-11-14',
        title: 'The Cinder Wyrm in finer, steadier letters',
        notes: ['The wyrm is drawn in fine, calm digits that travel with its body instead of sliding under a fixed grid.'],
      },
      {
        date: '2026-11-14',
        title: 'The free hand in sword fingers; weight and footwork; a cut that lands; outfits to pick from',
        notes: [
          'The free hand forms sword fingers and moves against each cut.',
          'The body carries the cuts, the feet plant and pivot, and a landed edge bites before it tears through.',
          'A landed cut shows a slash line, sparks and a camera kick.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'The streak and the flurry',
        notes: [
          'Perfect dodges in a row build a streak. Each one is answered with that many flash cuts and an art.',
          'Arts against the wyrm: Skyfall, Severing Line, Heaven Splitter. Against a duelist: Passing Cut, Falling Leaf, Rising Moon.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'The Starless Lord in black plate, and how he moves',
        notes: [
          'He wears a hooded black harness with a slit of red light, and glides instead of running.',
          'New moves, among them three spells: the Crushing Dark, the Rift and the Dark Star.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'Hit reactions and the death, made natural',
        notes: ['The hero falls the way a blow drives him, buckles at the knees and lies naturally.'],
      },
      {
        date: '2026-11-14',
        title: 'Steel on steel',
        notes: [
          'Parries show the two blades crossed, with sparks.',
          'A duelist guards and deflects your strikes. A guard press or dodge cancels any swing.',
          'Blade lock, and the trade clash: swing as he swings and the cuts meet.',
          'The camera eases closer within a duelist\'s reach.',
        ],
      },
      {
        date: '2026-11-14',
        title: 'A faster chain, a new finisher, swings that flow home',
        notes: [
          'A hit about every 0.32 s, and a new leaping two-handed finisher.',
          'After each cut the blade eases home instead of snapping back. A finer sword trail.',
        ],
      },
      {
        date: '2026-11-13',
        title: 'Wuxia-flow swings, a dashing cleave, a deeper guard, a narrower cloak, a new sword arc',
        notes: [
          'Every swing is a whole-body cut with several looks per hit.',
          'The charged attack is a dashing diagonal cleave. The guard is a deeper, side-on stance.',
        ],
      },
      {
        date: '2026-11-13',
        title: 'The Starless Lord, a third level',
        notes: [
          'The Obsidian Throne: a dark lord with a blade of red light, in four forms with four health bars.',
          'Empty a bar or break his posture, then strike the DEATHBLOW. Between strings he works the Void.',
        ],
      },
      {
        date: '2026-11-13',
        title: 'Controller support',
        notes: ['Play with an Xbox, PlayStation or any standard gamepad, with rumble and on-screen pad hints.'],
      },
      {
        date: '2026-11-13',
        title: 'Remappable controls',
        notes: ['Pause → CONTROLS: rebind any action on the keyboard, mouse or controller.'],
      },
      {
        date: '2026-11-12',
        title: "The hero at Shen Hui's size, a trimmed cloak",
        notes: ['The hero is drawn a little smaller and his cloak is trimmed, so his back and arms show.'],
      },
      {
        date: '2026-11-12',
        title: 'The Ash Disciple, a second level',
        notes: [
          'The Ashfall Courtyard and Shen Hui, a fast swordsman with a long jian.',
          'Perfect deflects, blade locks and the mikiri, each in slow motion.',
          'Pick a level on the title screen.',
        ],
      },
      {
        date: '2026-11-12',
        title: 'Attack variants, hair that reads, a fuller cloak',
        notes: ['Every hit of the chain has two or three looks, so the combo does not repeat.'],
      },
      {
        date: '2026-11-11',
        title: 'Breath-born bullets, perfect-parry returns, Armageddon, heat-glow warnings',
        notes: [
          'Bullets pour from the wyrm\'s jaws. A perfect parry sends one back.',
          'Armageddon: a sky full of meteors. Ground warnings glow with heat.',
        ],
      },
      {
        date: '2026-11-12',
        title: 'Two hands, a raised guard, idle life, gold hair',
        notes: ['Two-handed swings, a raised guard, and idle moves when you stand still.'],
      },
      {
        date: '2026-11-11',
        title: 'A hooded cloak, arms that bend, fewer draw calls',
        notes: ['A hooded, tattered cloak, a sword arm that bends, and a lighter load for phones.'],
      },
      {
        date: '2026-11-11',
        title: 'Hands, a longer combo and equipment slots',
        notes: ['Real hands on the grip and a five-hit chain with a sprint slash and a roll cut.'],
      },
      {
        date: '2026-11-09',
        title: 'The hero filled out',
        notes: ['Broader chest and shoulders, and the sword held where you can see it.'],
      },
      {
        date: '2026-11-09',
        title: 'Bullet hell and the moonlit sword',
        notes: ['The wyrm throws spirals and swarms of fire bullets you can deflect. The sword glows blue-white.'],
      },
      {
        date: '2026-11-09',
        title: 'Blender-built hero parts',
        notes: ['Hair, collar, cape and blade sculpted in Blender.'],
      },
      {
        date: '2026-11-09',
        title: 'Single-figure reference, round 2',
        notes: ['A new stance, a fine dot-matrix look and a fuller coat.'],
      },
      {
        date: '2026-11-09',
        title: 'The lean reference match',
        notes: ['A lean swordsman with spiky hair, a flared collar and split coat tails.'],
      },
      {
        date: '2026-11-09',
        title: 'The epic wyrm fight',
        notes: ['A longer, harder battle in three phases, with combos to parry blow by blow, fire spells and short flights.'],
      },
      {
        date: '2026-11-08',
        title: 'The reference match',
        notes: ['The wyrm and the hero look like the reference images and move better.'],
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-02',
    summary: 'Classic ASCII art, and the game is playable on phones.',
    entries: [
      {
        date: '2026-11-02',
        title: 'Touch controls',
        notes: [
          'A floating stick, ATTACK, BLOCK, DODGE, FLASK, LOCK and pause on phones.',
          'Auto-aim at the boss, pinch zoom, and a closer phone camera.',
        ],
      },
      {
        date: '2026-11-02',
        title: 'The hero shows his details',
        notes: ['The hero is drawn bigger in finer letters, so he reads at the game camera.'],
      },
      {
        date: '2026-11-02',
        title: 'A fine ASCII-art grid',
        notes: ['The hero and the wyrm print through a fine grid of letters coloured per cell.'],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-01',
    summary: 'A look pass from the concept sheets.',
    entries: [
      {
        date: '2026-11-01',
        title: 'A four-legged drake',
        notes: ['The wyrm became a bigger, four-legged drake with sail wings and a molten underside.'],
      },
      {
        date: '2026-11-01',
        title: 'The Shadow Swordsman',
        notes: ['The hero became a black-coated swordsman with a big sword and new poses.'],
      },
      {
        date: '2026-11-01',
        title: 'New moves and clearer tells',
        notes: [
          'An overhead slam and a lunging thrust.',
          'Attack tells are read from the boss itself: a red glow to dodge, a white glint to parry.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-01',
    summary: 'Combat and presentation.',
    entries: [
      {
        date: '2026-11-01',
        title: 'Block, parry and the perfect dodge',
        notes: [
          'Hold to block, tap just before impact to parry, and a perfect dodge blinks you behind the boss.',
          'A posture meter: break it for big critical hits. A charged heavy attack.',
        ],
      },
      {
        date: '2026-11-01',
        title: 'Every attack tells you how to answer it',
        notes: ['White for a normal blow, blue to parry, red to dodge.'],
      },
      {
        date: '2026-11-01',
        title: 'A gentler start',
        notes: ['More HP, five flasks and no stamina bar.'],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-01',
    summary: 'The first playable fight: the Cinder Wyrm.',
    entries: [
      {
        date: '2026-11-01',
        title: 'The Cinder Wyrm',
        notes: [
          'A moonlit forest drawn in ASCII, with grass, stones, bones and a bonfire.',
          'A knight with a light combo, a heavy attack, a roll and flasks against a wyvern in two phases.',
          'Procedural sound and music.',
        ],
      },
    ],
  },
];

/** A stable id for an entry: its date and title (not its release, so cutting a version keeps it read). */
export function entryId(entry) {
  return `${entry?.date ?? ''}|${entry?.title ?? ''}`;
}
