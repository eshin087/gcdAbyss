import { lookOf, setLook, allOld, pickedOf } from '../entities/enemies/duelist/lookSwitch.js';
import { el, button, setClass } from './labDom.js';

// The Lab's LOOKS section: every look switch of the duelists' second pass (duelist/lookSwitch.js),
// so the owner can flip each option on a phone and judge it in the fight. A switch read at draw time
// changes live (setLook); one read when the level or his rig is built (`build`) reloads the page with
// its URL parameter. "as shipped" = no look parameter at all = the owner's picks (lookSwitch PICKED);
// "before this pass" = `?looks=old` (every redraw as `main` drew it before the second pass; a new
// thing keeps its pick). The option each switch ships with is marked `*`.
//
// [name, options, the call site's default (`def`: '0' = a redraw), pick (what ?looks=new showed),
//  build-time, levels, what it is, 'awaiting' (no pick yet: the default draws; duel.mjs knows)]
export const LOOK_SWITCHES = Object.freeze([
  ['kindle', ['a', 'b', 'c'], 'a', 'a', false, ['ash'], 'the Kindling (phase 2)'],
  ['ashp3', ['a', 'b', 'c'], 'a', 'a', false, ['ash'], 'the third phase\'s change'],
  ['qi', ['0', 'a', 'b', 'c'], '0', 'a', false, ['ash', 'starless'], 'sword qi / crescents'],
  ['flit', ['0', 'a'], '0', 'a', false, ['ash'], 'the flit'],
  ['burn', ['a', 'b'], 'a', 'a', false, ['ash'], 'burning ground'],
  ['toll', ['0', 'a', 'b'], '0', 'a', false, ['ash'], 'the bell\'s rings'],
  ['ashLook', ['0', 'a', 'b', 'c'], '0', 'b', true, ['ash'], 'Shen Hui\'s body (a reload)'],
  ['star', ['0', 'a', 'b'], '0', 'a', false, ['starless'], 'the Dark Star'],
  ['sky', ['0', 'a', 'b'], '0', 'a', false, ['starless'], 'a strike of the Starless Sky'],
  ['ignite', ['0', 'a', 'b'], '0', 'a', false, ['starless'], 'a form\'s ignition'],
  ['void', ['0', 'a'], '0', 'a', false, ['starless'], 'the smaller spells'],
  ['presence', ['0', 'a'], 'a', 'a', false, ['starless'], 'forms 2 and 3: a quiet presence'],
  ['great', ['a', 'b', 'c'], 'a', 'a', false, ['starless'], 'Starless Night\'s waves'],
  ['lordLook', ['0', 'a', 'b', 'c'], '0', 'b', true, ['starless'], 'Varr Nihil\'s body (a reload)'],
  ['outskirts', ['0', 'a', 'b', 'c', 'm'], '0', 'c', true, ['starless'], 'round the crater: 0 felled trees, a shrine, b star debris, c challengers, m all (a reload)'],
  ['floor', ['a', 'b'], 'a', 'a', true, ['ash', 'starless'], 'a broken floor slab (a reload)'],
  // The Skybreak Ring's switches. Each group's rows go directly under its own heading line.
  // --- ring: the set (the arena, its buttes, its light)
  ['ring', ['a', 'b', 'c'], 'a', 'a', true, ['ring'], 'the arena: flats, quarry, crown (a reload)'],
  //
  //
  // --- ring: Tian Lei's body (his outfit, his hair by form)
  ['ascLook', ['a', 'c', 'd', 'h', 'g', 'v', 'e', 'r', 'w'], 'a', 'e', true, ['ring'], 'Tian Lei\'s body: a tunic, c monk, d = a in the dragon look; homages h orange gi, g purple gi, v blue suit; the gi with wraps e ember, r crimson, w bone (a reload)'],
  ['ascLetters', ['0', 'a'], '0', 'a', false, ['ring'], 'Tian Lei\'s letters: 0 the bosses\' fine cell, a they follow his size as the hero\'s do'],
  ['ascHair', ['0', 'a', 'b'], '0', 'b', true, ['ring'], 'Tian Lei\'s gold hair (forms 2 - 3): 0 the tall crown, a a short crown, b his own hair risen (a reload)'],
  ['ascLift', ['0', 'a', 'b'], 'a', 'b', true, ['ring'], 'Tian Lei\'s print: 0 as the body shipped, a lifted off the floor, b the hero\'s quieter print (a reload)'],
  //
  // --- ring: Tian Lei's effects (the aura, the beam, the blasts, the transformation)
  ['ascAura', ['a', 'b', 'c'], 'a', 'a', false, ['ring'], 'Tian Lei\'s aura (forms 2 and 3)'],
  ['ascBeam', ['a', 'b'], 'a', 'a', false, ['ring'], 'Tian Lei\'s beam'],
  ['ascOrb', ['a', 'b', 'c'], 'a', 'a', false, ['ring'], 'Heaven\'s Lantern, the great orb: a a sun, b a lantern, c the pale gathered sphere (its arms-up gather on a reload)'],
  ['ascBeamPose', ['0', 'cup'], '0', '0', true, ['ring'], 'Tian Lei\'s beams: 0 the palm thrust, cup both hands cupped at the hip (a reload)'],
  ['ascMotion', ['0', 'a', 'b'], '0', 'b', false, ['ring'], 'Tian Lei\'s motion (ADR-225): a every blue and red blow out of a held windup pose of its own, and his snap blows (Snap Jab, Snap Hook); b a, and straight limbs (the default) (ADR-248): punches long and in one line down his centre, kicks landing with the leg straight, the sweep from a drop stance turning on a planted foot; 0 as before (live, from his next move)'],
  // --- Tian Lei's audit (ADR-248; the owner's picks, 2026-11-27: motion b, pace a, the sun)
  ['ascPace', ['0', 'a'], '0', 'a', false, ['ring'], 'Tian Lei\'s pace: 0 as shipped; a COMBAT rule 10\'s floor: a move\'s first blow >= 0.7 s (form 1), blows >= 0.45 s apart, the cue 0.35 s before, the time a held cock (the default; live, from his next move)'],
  ['ascShot', ['0', 'a', 'b'], '0', 'a', false, ['ring'], 'Tian Lei\'s ki blasts: 0 as shipped; a the sun (a white heart, gold turning round it, a spinning ring, the air drawn in, a pool on the floor, a burst that folds in and breaks); b the comet (a white head on a teardrop, a tail of letters left hanging, a lit streak on the floor, a splash forward) (a the default; live)'],
  // --- the sword motion pass (ADR-226; live from his next move; the owner's pick: a)
  ['ashMotion', ['0', 'a'], '0', 'a', false, ['ash'], 'Shen Hui\'s sword motion: 0 as before; a the jian held in line with his forearm, his arms opening, blue / red blows held in their tell poses, two quick blows'],
  ['ashForm', ['0', 'a'], '0', 'a', false, ['ash'], 'Shen Hui\'s form (ADR-250; live from his next move): a thrusts on a straight arm along the blade in a real lunge, overheads one-handed on a diagonal, the low sweeps turning on his feet, the free hand quieter, the front foot down as the blow lands; 0 as before'],
  ['whirlFx', ['0', 'a', 'b', 'c'], '0', 'b', false, ['ash'], 'Ember Whirl\'s look (ADR-250): a the wheel (a ring of fire left by the point), b the cyclone (fire whirling up round him, embers off the point), c the disc (the swept width burns an instant); 0 as before'],
  ['fallFx', ['0', 'a', 'b', 'c'], '0', 'b', false, ['ash'], 'Heaven-Splitting Fall\'s look (ADR-250): a the comet (a tail of fire down, a column where he lands), b the split (a seam of fire down the cut, the floor split in fire ahead and behind), c fire rain (fire falling on the locked ring, embers thrown out as he lands); 0 as before'],
  ['lordMotion', ['0', 'a'], '0', 'a', false, ['starless'], 'Varr Nihil\'s sword motion: 0 as before; a the blades held in line with his forearms, his arms opening, blue / red blows held in their tell poses, a shake of the steel for the end twirl, two quick blows'],
  ['lordForm', ['0', 'a'], '0', 'a', false, ['starless'], 'Varr Nihil\'s form (ADR-251; live from his next move): a thrusts on a long arm along the blade out of a real lunge, the two-handed overheads down on a diagonal, the low sweeps turning on his feet, the free hand quieter, the front foot down as the blow lands; 0 as before'],
  ['lordPace', ['0', 'a'], '0', 'a', false, ['starless'], 'Varr Nihil\'s pace (ADR-251; live from his next move): 0 as shipped; a COMBAT rule 10\'s floor: a move\'s first blow >= 0.7 s (x the form\'s windup scale), blows >= 0.45 s apart, the cue 0.35 s before, the time a held cock (his quick blows, counters, flurry and ignitions keep theirs)'],
  // --- Varr Nihil after the reference pack (ADR-277; awaiting: the owner picks from the films)
  ['lordRef', ['0', 'a'], '0', 'a', true, ['starless'], 'Varr Nihil after the reference pack (a reload): a every blade split (two red-white rails, a dark slit), a cross-guard, the crimson sash and clasp, the hood, helm, plate and the whole cape kept in every form, the cape standing off him and lagging further; 0 as shipped', 'awaiting'],
  ['lordRefMove', ['0', 'a'], '0', 'a', false, ['starless'], 'Varr Nihil\'s motion after the reference pack (live from his next move): a lower, wider stances, deeper strikes, the free fist out in opposition, the staff held wide, form 4 upright with the hands under the guard, a deeper glide; the same timing, zones and root motion; 0 as shipped', 'awaiting'],
  ['boltFx', ['0', 'a', 'b', 'c'], '0', 'c', false, ['starless'], 'Void Lightning\'s look (ADR-251): a the thread (motes wound into his fingers, the bolt braided); b the tear (arcs up his arm, a tear left in the air); c the storm (the floor answers, the bolt grounds three times); 0 as shipped'],
  ['igniteFx', ['0', 'a', 'b', 'c'], '0', 'a', false, ['starless'], 'a form\'s ignition, over the shipped look (ADR-251): a the cocoon (letters rise round him, burst out flat); b the writ (the new steel written in light where it will stand); c the eclipse (a ring of dark spreads, its red rim stands up as a wall); 0 as shipped'],
  //
  //
  // --- fox: Wen Yao (ADR-147; every one read when his rigs or his effects are built: a reload)
  ['foxLook', ['a', 'b', 'c', 'd', 'h1', 'h2', 'h3'], 'h1', 'h1', true, ['fox'], 'Wen Yao\'s body: ink-line like the hero, h1 the wild fox (the default: amber jacket, vermilion scarf), h2 vermilion jacket and black scarf, h3 a long pale coat; through the art path a shrine fox, b wild fox, c pelt brawler; d = a in ink-line (a reload)'],
  ['foxLetters', ['a', 'b'], 'b', 'b', false, ['fox'], 'Wen Yao\'s letters: a a fixed cell (as the other bosses), b they follow his size on screen as the hero\'s do (the default; read every frame: live)'],
  ['foxfire', ['a', 'b', 'c'], 'c', 'c', true, ['fox'], "the Pearl's colour: a jade, b the wyrm's orange, c pale blue-white (the default; a reload)"],
  ['clones', ['a', 'b'], 'a', 'a', true, ['fox'], 'the paper selves: a as him, b a step paler (a reload)'],
  ['foxFire3', ['a', 'b'], 'a', 'a', true, ['fox'], 'phase 3\'s fire (the mantle, the Nine-Tailed Fox, its beam): a the wyrm\'s orange-red, b jade (a reload)'],
  ['foxSpirit', ['a', 'b'], 'a', 'a', true, ['fox'], 'the Nine-Tailed Fox: a a body in the wyrm\'s letters wreathed in fire, b fire and ink lines only (a reload)'],
  // --- grove: the Windless Grove and the Sheathed (ADR-145; the owner's picks, 2026-11-22: a / a / a)
  ['grove', ['a', 'b', 'c'], 'a', 'a', true, ['grove'], 'the grove: a moonlit mist, b grey dawn, c first snow (a reload)'],
  ['sheathLook', ['a', 'b', 'c', 'd'], 'a', 'a', true, ['grove'], 'Lu Wusheng\'s body: a mourning white, b reed cloak, c one sleeve, d the wanderer (a reload)'],
  ['drawCut', ['a', 'b'], 'a', 'a', false, ['grove'], 'the draw\'s cut: a one white line, b with an afterimage'],
  ['drawFx', ['0', 'a', 'b', 'c'], '0', '0', false, ['grove'], 'the draw\'s look (ADR-252): 0 as shipped; a the drawn breath (the air drawn into the scabbard\'s mouth, thrown out along the cut); b hanging leaves (the blade\'s arc, letters left hanging on the line, dropped on the click); c the late sound (a quiet cut; the line bursts open on the click) (0 the owner\'s pick, the default; live)'],
  // --- code: the Hall of Falling Script and Xin Yi (ADR-156, ADR-157; pending: the owner picks from the sheets)
  ['oneLook', ['a', 'b', 'c'], 'a', 'a', true, ['code'], 'Xin Yi\'s body: a the long coat, b the cassock, c the grey coat (a reload)'],
  ['hall', ['a', 'b'], 'a', 'a', true, ['code'], 'the hall: a pale marble, green-black inlay; b dark basalt, jade-lit edges (a reload)'],
  ['script', ['a', 'b', 'c'], 'a', 'a', true, ['code'], 'the script wave: a a shimmer and the full turn, b nothing until the Source, c strong from the start (a reload)'],
  // --- code: Xin Yi more like the hero (ADR-170; pending: the owner picks from the sheets)
  ['oneLetters', ['0', 'a'], '0', 'a', false, ['code'], 'Xin Yi\'s letters: 0 the bosses\' fine cell, a they follow his size as the hero\'s do (the default; live)'],
  ['onePrint', ['0', 'a', 'b'], '0', 'a', true, ['code'], 'Xin Yi\'s print: 0 the lifted print and the shapes he shipped with; a the hero\'s quiet print, simpler shapes, a coat that stirs from phase 1 (the default); b a, and one letter size bolder on a small screen (a reload)'],
  // --- code: Xin Yi rebuilt (ADR-221; awaiting: the owner picks from the sheets and films)
  ['oneBody', ['0', 'a', 'b', 'c'], '0', 'b', true, ['code'], 'Xin Yi\'s figure: 0 as shipped; printed like the hero on a man\'s build: a the long coat closed in phase 1, b the coat open in every phase (the owner\'s pick, the default), c a duster to mid-shin (a reload)'],
  ['oneMoves', ['0', 'a', 'b'], '0', 'b', false, ['code'], "Xin Yi's moves: 0 as shipped; a the guns aimed down the arm, every blue / red blow held in its windup pose before the snap, two fast strings, straight kicks, long punches (ADR-221; live); b a, and the limbs on the line (ADR-253; the owner's pick, the default): punches down his centre, kicks held straight through the contact, the sweep crossing you, short blows that reach, the guns pointed down the line of fire with a kick"],
  ['oneGunFx', ['0', 'a', 'b'], '0', 'b', false, ['code'], "Xin Yi's gun shots (ADR-253): 0 as shipped; a the tracer: a hot cone and a spent casing at the muzzle, a thin line of strokes behind each slug with small rings of stilled air where it passed; b the script: binary digits fanned from the muzzle, each slug leaving a curtain of tiny digits falling along its way (live)"],
  ['oneBoltFx', ['0', 'a', 'b'], '0', 'a', false, ['code'], "Xin Yi's palm bolts in the Source (ADR-253): 0 as shipped; a the seed: a hot core in three thin turning rings of digits, digits falling behind it; b the fold: a core of four hot cells like a falling column, a ring of stilled air left across its way every few steps (live)"],
  // --- grove: Lu Wusheng readable (ADR-152): the palette picked; the print's five steps and the mark wait for the owner
  ['sheathArt', ['0', '1', '2', '3', 'a'], '0', 'a', true, ['grove'], 'Lu Wusheng\'s print, five steps: 0 the wyrm\'s digits as shipped, 1 digits in his colours, 2 digits lit and outlined, 3 ink-line flattened, a the hero\'s ink-line art (the default since ADR-194; a reload)'],
  ['sheathTone', ['a', 'b', 'c'], 'a', 'a', true, ['grove'], 'the Wanderer\'s palette: a indigo and sand, b pale and cold, c moss and rust (a reload)'],
  ['sheathMark', ['a', 'b', '0'], 'a', 'a', true, ['grove'], 'his mark: a a torn strip on the scabbard, b a white streak in the hair, 0 none (a reload)', 'awaiting'],
  // --- the motion pass (ADR-223; live; the owner picked a for all, 2026-11-26): held blue / red windups, the quick blows
  ['sheathMotion', ['0', 'a', 'b'], '0', 'a', false, ['grove'], "Lu Wusheng's blue / red blows: 0 as shipped; a held at the cock, blue tall, red sunk; b held only"],
  ['sheathQuick', ['0', 'a'], '0', 'a', false, ['grove'], 'Before the Word: a quick white pommel snap from his carry (a: in his moves)'],
  // --- Lu Wusheng's audit (ADR-252; the owner's picks, 2026-11-27: the form a, the pace and the draw's look as shipped)
  ['sheathForm', ['0', 'a'], '0', 'a', false, ['grove'], 'Lu Wusheng\'s form: 0 as shipped; a the fist on the hilt, the scabbard pulled back as he draws, a real lunge at the cut\'s end, thrusts on a long arm in line, the overhead on a diagonal, the sweep turning on his feet, the free hand half the travel (the owner\'s pick, the default; live, from his next move)'],
  ['sheathPace', ['0', 'a'], '0', '0', false, ['grove'], 'Lu Wusheng\'s pace: 0 as shipped; a COMBAT rule 10\'s floor: a move\'s first blow >= 0.7 s, blows >= 0.45 s apart, the cue 0.35 s before, the time a held cock; the draws as before (0 the owner\'s pick, the default; live, from his next move)'],
  ['foxMotion', ['0', 'a', 'b'], '0', 'a', false, ['fox'], "Wen Yao's blue / red blows: 0 as shipped; a held at the cock, blue tall, red sunk, the feet no longer jump; b held only"],
  ['foxQuick', ['0', 'a'], '0', 'a', false, ['fox'], 'Fox Snap and Fox Knee: quick white blows from his guard (a: in his moves)'],
  // --- the boss motion audit (ADR-249; the owner picked a for both from the films, 2026-11-27)
  ['foxLimbs', ['0', 'a'], '0', 'a', true, ['fox'], "Wen Yao's limbs at the contact: 0 as shipped; a straight punches on one line, straight kicks and sweeps, leaps that land the heel / fists on you (his paper selves too; the owner's pick, the default; a reload)"],
  ['foxCues', ['0', 'a'], '0', 'a', false, ['fox'], "Paper Rain's last blow: 0 an uppercut (white); a a backfist, so the uppercut is only ever the blue flare (the owner's pick, the default)"],
  ['wyrmMotion', ['0', 'a', 'b'], '0', 'a', false, ['cinderwood'], "the wyrm's blue / red blows in its strings: 0 as shipped; a held at the cock, blue rears its head up, red sinks low, tail up; b held only"],
  ['wyrmQuick', ['0', 'a'], '0', 'a', false, ['cinderwood'], 'Snap swipe: a quick white paw from its stance (a: in its moves)'],
  ['wyrmStrike', ['0', 'a'], '0', 'a', false, ['cinderwood'], "the wyrm's strikes (ADR-257): a in every bite its body surges first and the head snaps onto the beat (the owner's pick); 0 as shipped"],
  ['wyrmFix', ['0', 'a'], '0', 'a', false, ['cinderwood'], "the wyrm's motion audit fixes (motionFix.js, ADR-277): a the wings out of the ground, no teleporting paws / feet / head, the head on its neck, turns that speed up, a smooth tail, planted landings (the owner asked for them all, the default); 0 the wyrm before them"],
  ['pawBlue', ['0', 'a', 'b', 'c'], '0', 'a', false, ['cinderwood'], "the wyrm's BLUE paw blow (pawTells.js; the owner, 2026-11-27: the blue and red paw blows must be completely different): 0 the overhead as shipped; a the scythe (wound out wide and back, swept across; the owner's pick, the default); b the jab (crouched, the paw tucked under, a straight punch); c the uppercut (claws dragged low, swept up)"],
  ['pawRed', ['0', 'a', 'b'], '0', 'a', false, ['cinderwood'], "the wyrm's RED stomp (pawTells.js): 0 the rear-up as shipped; a the leap (crouch, the whole body jumps up with a wing beat, falls on both paws; the owner's pick, the default); b the quake (sunk low, wings flat, paws pressed wide, a shudder, then the heave and the slam)"],
  ['wyrmHead', ['0', 'a'], '0', 'a', false, ['cinderwood'], "the meteors' roar (ADR-258): a the neck rises up and forward, the snout to the sky ahead of it; 0 the head tipped back past upright"],
  // --- city: Halcyon Plaza and Halcyon (ADR-161; every one waits for the owner, read when built: a reload)
  ['halLook', ['a', 'b', 'c'], 'a', 'a', true, ['city'], 'Halcyon\'s body: a blue suit and red cape, b the idol, c tomorrow\'s tyrant (a reload)'],
  ['halCape', ['0', '1', '2', '3'], '3', '3', true, ['city'], 'his cape and colours at game size: 0 as first built, 1 brighter, 2 + a wide flared cape, 3 + its billow and a long trail (a reload)'],
  ['halLetters', ['0', 'a'], 'a', 'a', false, ['city'], 'his letters: a follow his size as the hero\'s do, 0 the bosses\' fixed fine cell'],
  ['halPrint', ['0', 'a', 'b'], 'a', 'a', true, ['city'], 'his print: 0 the lit step-3 figure, a the hero\'s quieter print, b between (a reload)'],
  ['halCapeSize', ['0', 'a', 'b', 'c'], 'b', 'b', true, ['city'], 'his cape\'s size: 0 as picked, a ~80 %, b ~65 %, c ~50 % (to the back of his knees) (a reload)'],
  ['glare', ['a', 'b', 'c'], 'a', 'a', true, ['city'], 'his eyes\' heat: a crimson, white core; b crimson alone; c orange fire (a reload)'],
  ['city', ['a', 'b', 'c'], 'a', 'a', true, ['city'], 'the city: a neon rain, b golden hour, c lockdown (a reload)'],
  // --- veil: the Veiled Crossing and Bai Wuji (the owner's picks, 2026-11-25)
  // Bai Wuji: body rows
  ['wjLook', ['a', 'b', 'c'], 'c', 'c', true, ['veil'], 'Bai Wuji\'s body: a the black high-collared coat and a black band, b a long indigo-black robe and a white cloth band, c a bone-white coat with a dark collar and band (a reload)'],
  ['wjHair', ['a', 'b'], 'b', 'b', true, ['veil'], 'his white hair: a a tall swept crown over the band (phase 1), long soft locks once it falls; b a shorter spikier burst, a choppier fringe (a reload)'],

  // Bai Wuji: motion rows (round 3; awaiting: the owner picks from the sheets and films)
  ['wjMotion', ['0', 'a', 'b', 'c'], 'b', 'b', false, ['veil'], 'his melee motion: 0 as shipped; a pocket kicks (upright, planted, the leg straight at the contact, a blink when the hero slid away); b glide (the same blows, every later beat of a string out of a blink round the hero); c turned away (back kicks, spinning heels, backhand flicks, looking over his shoulder). Every take: blue / red held, snap blows, short recoveries, the hands in his pockets in phase 1, one out in phase 2, both in phase 3 (live, from his next move)'],

  ['wjPolish', ['0', 'a'], 'a', 'a', false, ['veil'], 'his motion audit (ADR-255): a the kicks ease back to the chamber (no snap off a dead stop), the palm, the poke, Dark Spark and the fist of the Yank land on the line to your chest; 0 round 3 as built (live, from his next move)'],
  ['wjCastHand', ['0', 'a', 'b'], 'a', 'a', false, ['veil'], 'in phase 1, Azure Draw and the Yank: a his right hand out of its pocket for the whole cast (the finger raised, the reach); b out only for the pull and the flick at the end; 0 kept in the pocket (live)'],

  // Bai Wuji: fx rows
  ['wjShell', ['a', 'b', 'c'], 'a', 'a', false, ['veil'], 'his barrier while up: a all but invisible, it shows where the blade comes at it; b a faint standing shell of sparse strokes; c two faint rings that breathe (live)'],
  ['wjStrike', ['0', 'a'], 'a', 'a', false, ['veil'], 'a cut stopped on his barrier: a a faint patch of the shell where it landed, a net of strokes gone in 0.22 s (the owner); 0 the ripple of rings as first shipped (live)'],
  ['wjNull', ['a', 'b'], 'a', 'a', false, ['veil'], 'the Violet Null\'s body: a a hard-edged slab, crisp strokes along both edges; b a round bore, brightest at its core, rings running down it (live)'],

  // Bai Wuji: world rows
  ['wjCity', ['a', 'b', 'c'], 'a', 'a', true, ['veil'], 'the crossing: a ash moon (cold moonlit ash-grey), b last lamps (sodium amber, dead screens), c black wet (wet black asphalt, pale bars) (a reload)'],
  ['wjVoid', ['a', 'b', 'c'], 'b', 'b', true, ['veil'], 'the void: a drifts (star clumps only), b the ring (a great pale ring on the floor round the fight), c the fall (stars falling as streaks, a line of light where the floor ends) (a reload)'],
  // --- foundry: the Last Foundry and the False Saint (ADR-286; awaiting the owner's picks: each draws its call
  // site's default until then)
  ['fsLook', ['a', 'b'], 'a', 'a', true, ['foundry'], 'the False Saint\'s third milestone: a both legs plated (the second sheet\'s 03), b the right leg plated, the left trouser whole until phase 4 (the first sheet\'s 03) (a reload)', 'awaiting'],
  ['fsLetters', ['0', 'a'], 'a', 'a', false, ['foundry'], 'his letters: a they follow his size on screen as the hero\'s do, 0 the bosses\' fixed fine cell (live)', 'awaiting'],
  ['fsMark', ['disc', 'ring'], 'disc', 'disc', false, ['foundry'], 'the marks of his missiles and shells on the floor: disc a dim red disc under the ring that fills as it comes, ring a ring of red blobs and a ring closing in (live)', 'awaiting'],

  ['halMotion', ['0', 'a', 'b'], '0', 'a', false, ['city'], 'Halcyon\'s motion: b (ADR-254, the default) a plus straight punches on the line to the hero, straight kicks, long trailing legs, a level fly-by at chest height; a (ADR-225) a flier\'s legs in his blows, each blow aimed down at the hero (he dips into it), his arms open at the end, the held windups, his snap blows (Flick, Tap); 0 as before (live, from his next move)'],
  ['halEyes', ['0', 'a', 'b'], '0', 'a', false, ['city'], 'Halcyon\'s eye beams (ADR-254): a heat vision (the default), twin threads meeting in one hard crimson line, a shimmer rising, a molten spot spitting sparks; b the crimson pulse, rings racing down it, a scorch ring on the beat; 0 Tian Lei\'s beam in crimson (live)'],
  ['halShock', ['0', 'a', 'b'], '0', 'a', false, ['city'], 'Halcyon\'s shockwaves, Applause and Meteor (ADR-254): a a thunderclap ring of air, dust shoved ahead of it (the default); b a dome of pressure swelling out, grit lifted; 0 the dust front (live)'],
  ['halPace', ['0', 'a'], '0', 'a', false, ['city'], 'Halcyon\'s pace (ADR-254): 0 the pace he shipped with (the default, the owner\'s pick); a COMBAT rule 10\'s floor, a first blow >= 0.7 s, blows >= 0.45 s apart, the cue 0.35 s before (a held cock) (live)'],
  // --- every human boss (ADR-194)
  ['bossPrint', ['0', 'a', 'b'], '0', 'b', false, ['ash', 'starless', 'ring', 'fox', 'grove', 'code', 'city', 'veil'], 'the bosses printed the hero\'s way: b in their own colours (the default), a in the hero\'s greys, 0 as before (lit letter bodies, his strokes and dotted rims, the pale hem below the knee)'],
  // --- drawn in the hero's style (ADR-220): per boss, 0 as he shipped, a shaded as the hero is, b outlined as the
  // hero is (his line width), c both; his colours, outfit and letters kept (live). The owner's picks: c for
  // Shen Hui, Varr Nihil and Lu Wusheng, a for Tian Lei and Halcyon (whose lines are the hero's already)
  ['ashHero', ['0', 'a', 'b', 'c'], '0', 'c', false, ['ash'], 'Shen Hui in the style of the hero: a his shading, b his outline, c both (his colours and outfit kept)'],
  ['lordHero', ['0', 'a', 'b', 'c'], '0', 'c', false, ['starless'], 'Varr Nihil in the style of the hero: a his shading, b his outline, c both (his colours and outfit kept)'],
  ['ascHero', ['0', 'a', 'b', 'c'], '0', 'a', false, ['ring'], 'Tian Lei in the style of the hero: a his shading, b his outline, c both (his colours and outfit kept)'],
  ['sheathHero', ['0', 'a', 'b', 'c'], '0', 'c', false, ['grove'], 'Lu Wusheng in the style of the hero: a his shading, b his outline, c both (his colours and outfit kept)'],
  ['halHero', ['0', 'a', 'b', 'c'], '0', 'a', false, ['city'], 'Halcyon in the style of the hero: a his shading, b his outline, c both (his colours and outfit kept)'],
  // --- the title (ADR-196)
  ['menu', ['0', 'a', 'b', 'c'], '0', 'c', true, ['cinderwood', 'ash', 'starless', 'ring', 'fox', 'grove', 'code', 'city', 'veil', 'foundry'], 'the title: c the sword\'s path (the default), a the world list, b the campfire grid, 0 the title before (a reload)'],
]);

const NAMES = LOOK_SWITCHES.map((s) => s[0]);

/** The option drawn now for switch row `s`. */
const now = (s) => lookOf(s[0], s[2], s[3]);

/** Reload with the look parameters changed (`set`: name → value, null removes). */
function reloadWith(set, clearAll = false) {
  try {
    const u = new URL(globalThis.location.href);
    if (clearAll) {
      u.searchParams.delete('looks');
      for (const n of NAMES) u.searchParams.delete(n);
    }
    for (const [k, v] of Object.entries(set)) {
      if (v == null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    u.searchParams.set('lab', ''); // (the Lab opens again after the reload)
    globalThis.location.assign(u.toString());
  } catch (err) {
    console.error('[lab] looks reload failed', err);
  }
}

/** Build the section's rows into `body` for level `levelId`; returns a sync() that marks the options drawn now. */
export function buildLooks(body, levelId, status) {
  const rows = LOOK_SWITCHES.filter((s) => s[5].includes(levelId));
  if (!rows.length) return null;
  const btns = [];
  const top = el('div', 'lab-grid c2', null, body);
  button(top, 'as shipped', () => reloadWith({}, true)).title = 'every look as it ships: the owner\'s picks (no look parameter; a reload)';
  button(top, 'before this pass', () => reloadWith({ looks: 'old' }, true)).title = 'every redraw as it was before the duelists\' second pass (?looks=old; a new thing keeps its pick; a reload)';
  for (const s of rows) {
    const [name, opts, , , build, , what] = s;
    const shipped = pickedOf(name);
    const row = el('div', 'lab-row', null, body);
    const lbl = el('span', 'lab-lbl', name, row);
    lbl.title = `${what} (?${name}=)`;
    if (lbl.style) lbl.style.minWidth = '50px';
    const grid = el('div', `lab-grid c${Math.max(2, opts.length)}`, null, row);
    if (grid.style) grid.style.flex = '1';
    for (const v of opts) {
      const b = button(grid, `${v === '0' ? 'old' : v}${v === shipped ? '*' : ''}`, () => {
        if (build) {
          reloadWith({ [name]: v });
          return;
        }
        setLook(name, v);
        status?.(`look ${name} = ${v}`);
        sync();
      });
      b.title = `${what}: ${v === '0' ? 'as it was before this pass' : `option ${v}`}${v === shipped ? ' (as shipped: the owner\'s pick)' : ''}${build ? ' (a reload)' : ''}`;
      btns.push({ s, v, el: b });
    }
  }
  el('div', 'lab-note', `${allOld() ? 'showing the looks before this pass (?looks=old) · ' : ''}* = as shipped (the owner's pick) · old = before this pass · body / floor: a reload`, body);
  const sync = () => {
    for (const B of btns) setClass(B.el, 'on', now(B.s) === B.v);
  };
  sync();
  return sync;
}
