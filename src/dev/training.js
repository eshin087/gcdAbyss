import { CONFIG } from '../core/config.js';
import { riposteMode, setRiposteMode } from '../entities/player/riposteCut.js';
import { dbLockMode, setDbLock } from '../entities/player/deathblow.js';
import { ARTS } from '../entities/player/flurry.js';
import { TUNING as WYRM, SCALE as WYRM_SCALE } from '../entities/dragon/tuning.js';

// Training (ADR-099; usage: src/dev/README.md → Training): a fighting game's training mode for the
// boss of the level loaded. A catalogue of SITUATIONS by category, each one click: the runner puts
// the fight in place (the flow in 'boss', the boss's AI off, god mode, the hero placed, the streaks
// set), starts it (a boss move, a hero action, a debug call) and plays the hero's side itself: an
// auto-answer to every one of the boss's glints (parry, perfect parry, block, dodge, perfect dodge,
// mikiri, trade, nothing), clicks, holds and mashing, all through the input's virtual keys, so the
// game runs exactly as when a player does it. Then it waits for the situation to play out, holds a
// beat, and is done (or loops).
//
// Headless: nothing here needs the DOM. The panel (trainingPanel.js) is a view of it; the sims run
// every situation through `run(id)` (tests: integ / duel / lord TRAINING).
//
// A situation: { id, cat, name, desc, boss (kinds it applies to: 'wyrm' | 'duel' | 'ash' | 'lord' |
//   'asc' (Tian Lei) | 'fox' (Wen Yao) | 'woke' (Xin Yi) | 'halcyon' (Halcyon) | 'untouched' (Bai Wuji) | 'any'), dist (m from the boss; omit = the boss's default), ang (rad off his facing), side (put the
//   hero beside him, for the camera), streak (the hero's, set before), foe (his streak), art (pin the
//   flurry's art), riposte (the parry's answer, 'old' | 'planted' | 'deathblow': set for the situation, the
//   Lab's own restored after), parryRun (the deathblow's count, set before), posture (his posture, so a parryRun is kept), postureNear (his posture set to
//   just under what ONE perfect parry of his next blow breaks), hp (the hero's), god (default true), answer (mode, or (i, T) → mode for blow i),
//   go(T) (start it), tick(T, dt) (every frame while it runs), until(T) (done; default: the boss's
//   move is over and the hero is free), tail (s held after), max (s at most), expect [events]
//   (what must have happened: the sims check), pieces (it needs the level's breakables), clear (it is
//   built on the hero's own strikes: he stands where no piece is in his sword's reach, ADR-132) }

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DOWN = new Set(['dying', 'dead']);
const HERO_FREE = new Set(['idle', 'run', 'sprint']);
/** Where a `clear` situation brings the boss when no spot round him is free of the level's pieces. */
const CLEAR_SPOTS = Object.freeze([[0, 0], [0, 6], [0, -6], [6, 0], [-6, 0]]);

/** Answer modes: when to act before the impact (s), and what (Training._answer). */
export const ANSWERS = Object.freeze({
  parry: { label: 'Parry', lead: 0.12 },
  perfect: { label: 'Perfect parry', lead: 0.05 },
  plain: { label: 'Plain parry', lead: 0.2185 }, // (pressed just outside the perfect window: a parry that is not perfect)
  block: { label: 'Block', lead: 0.6 },
  dodge: { label: 'Perfect dodge', lead: 0.1 },
  roll: { label: 'Dodge (early)', lead: 0.34 },
  mikiri: { label: 'Mikiri', lead: 0.15 },
  trade: { label: 'Trade', lead: 0.15 },
  none: { label: 'Take it', lead: 0 },
});

/** The boss of the level loaded: its kind and the moves the situations ask for by role. */
const ROLES = {
  cinderwood: { single: 'bite', string: 'clawCombo', long: 'stormFlurry', red: 'tail', area: 'stomp' },
  ash: { single: 'plumThrust', string: 'swallow', long: 'ashRain', red: 'lotus', lock: 'fallingStar', blue: 'fallingAsh', mikiri: 'piercingAsh' },
  starless: { single: 'lunge', string: 'litany', long: 'litany', red: 'reap', lock: 'skyfall' },
  // Tian Lei (the Skybreak Ring): his form-1 lock is Hundred Hands' last blow (Vanishing Step's is form 2's)
  ring: { single: 'meteorStep', string: 'gates', long: 'hundred', red: 'cometHeel', lock: 'hundred', mikiri: 'piercingPalm' },
  // the Sheathed (the Windless Grove): no blade lock (a scabbard does not lock)
  grove: { single: 'knock', string: 'refusals', long: 'fordSteps', red: 'reedCutter', mikiri: 'tapStone' },
  // Wen Yao (the Foxfire Terrace): no perilous thrust (no mikiri situation for him)
  fox: { single: 'foxBite', string: 'brushstrokes', long: 'streakFlurry', red: 'sweepingBrush', lock: 'moonLadder' },
  // Xin Yi (the Hall of Falling Script): no perilous thrust; his lock is the Still Hand's push, which
  // only comes out of a caught cut (no lock situation for him)
  code: { single: 'brushOff', string: 'stairKick', long: 'lesson', red: 'lowWind' },
  // Halcyon (Halcyon Plaza): no blade lock, no perilous thrust; his red is Meteor (a beam is no fixed
  // contact for a perfect dodge), his ranged role The Stare (ADR-160)
  city: { single: 'backhand', string: 'meetAndGreet', long: 'streakFlurry', red: 'meteor', ranged: 'stare' },
  // Bai Wuji (the Veiled Crossing): no blade lock, no perilous thrust (core's working set; the melee agent
  // brings the roles up to date with his moves)
  veil: { single: 'palm', string: 'threeCount', long: 'tooSlow', red: 'longStep' },
  // the False Saint (the Last Foundry; the tuning pass): his phase-1 moves (a role's move is not put in its
  // phase): the counter's elbow (blue), Benediction, his flurry; red Laying On of Hands (the grab: a hit is
  // the catch, then the throw)
  foundry: { single: 'rebuke', blue: 'rebuke', string: 'benediction', long: 'litany', red: 'layHands' },
};

export function bossKinds(game) {
  const d = game.dragon;
  const k = new Set(['any']);
  if (typeof d?.onPlunge === 'function') k.add('wyrm');
  if (typeof d?.debug?.flurry === 'function') {
    k.add('duel');
    // (a three-bar boss is not the Lord: Tian Lei has his own kind, the Lord's situations need the crater)
    k.add(d?.kit?.id === 'ascendant' ? 'asc' : d?.kit?.id === 'sheathed' ? 'sheathed' : d?.kit?.id === 'thousandFox' ? 'fox' : d?.kit?.id === 'wokenOne' ? 'woke' : d?.kit?.id === 'halcyon' ? 'halcyon' : d?.kit?.id === 'untouched' ? 'untouched' : d?.kit?.id === 'saint' ? 'saint' : d?.lives ? 'lord' : 'ash');
  }
  return k;
}

// ------------------------------------------------------------------ the catalogue
const S = [];
const add = (cat, list) => {
  for (const s of list) S.push({ cat, god: true, tail: 0.8, max: 12, ...s });
};
const N = (n) => `×${n}`;

add('HERO STREAK', [
  ...[1, 2, 3, 5, 7].map((n) => ({
    id: `pd${n}`, name: `Perfect dodge · streak ${N(n)}`, boss: 'any', streak: n - 1, role: 'red', answer: 'dodge',
    desc: n === 1 ? 'The first perfect dodge of a streak: the art alone (against the wyrm, sometimes the plunge).' : `${n} perfect dodges in a row: ${n - 1} flash cut${n > 2 ? 's' : ''}, then an art. The hanging cuts burst on the last blow.`,
    // (a streak of one against the wyrm may be the plain plunge: no hanging cuts to burst)
    expect: n === 1 ? ['player:perfectDodge'] : ['player:perfectDodge', 'player:flurryEnd'],
  })),
  { id: 'pdString', name: 'Perfect-dodge a whole string', boss: 'any', streak: 0, role: 'long', answer: 'dodge', desc: 'Every blow of a long string perfect-dodged: the streak climbs blow by blow. White blows give slow motion and a short crit window where you stand; only a red one is answered with the flurry.', expect: ['player:perfectDodge'] },
  { id: 'streakLost', name: 'Streak lost (hit at ×5)', boss: 'any', streak: 5, role: 'single', answer: 'none', desc: 'A blow that hurts ends the streak: the pips break and the log says so.', expect: ['player:streak'] },
  { id: 'streakKept', name: 'Streak kept (block at ×5)', boss: 'any', streak: 5, role: 'single', answer: 'block', desc: 'A blocked blow leaves the streak alone.', expect: ['player:block'] },
]);

add('HERO ARTS', [
  ...['skyfall', 'severing', 'heavensplit'].map((a) => ({
    id: `art-${a}`, name: `${ARTS[a].label} ${N(4)}`, boss: 'wyrm', art: a, desc: `Three flash cuts round the head, then ${ARTS[a].label}.`,
    go: (T) => T.p.debug.flurry(4, a), expect: ['player:flurryEnd'],
  })),
  ...['passing', 'falling', 'rising'].map((a) => ({
    id: `art-${a}`, name: `${ARTS[a].label} ${N(4)}`, boss: 'duel', art: a, desc: `Three flash cuts through him, then ${ARTS[a].label}; it ends at his back.`,
    go: (T) => T.p.debug.flurry(4, a), expect: ['player:flurryEnd'],
  })),
  { id: 'art-max', name: `The longest flurry ${N(7)}`, boss: 'any', desc: 'Six flash cuts and an art: the cap. The later cuts come faster and spark gold.', go: (T) => T.p.debug.flurry(7), expect: ['player:flurryEnd'] },
]);

add('PARRY & RIPOSTE', [
  { id: 'parry', name: 'Parry a single blow', boss: 'any', streak: 0, role: 'single', answer: 'parry', riposte: 'old', desc: 'A single blow parried with the old riposte (?parryRiposte=old): the clash, then one flash cut and back where you stood. Today a duelist recoils instead and your own counter cut is open (see Parry a string).', expect: ['player:parry', 'player:flurryEnd'] },
  { id: 'perfectParry', name: 'Perfect parry', boss: 'any', streak: 0, role: 'single', answer: 'perfect', desc: 'Every parry is perfect (?parry=one): the clash at the blades and a beat of slow motion. With ?parry=two only a press within 0.2 s of the impact.', expect: ['player:parry'] },
  ...[3, 7].map((n) => ({ id: `riposte${n}`, name: `Riposte ${N(n)} (old)`, boss: 'any', streak: n - 1, role: 'single', answer: 'parry', riposte: 'old', desc: `A parry at a streak of ${n}: ${n} flash cuts.`, expect: ['player:flurryEnd'] })),
  // the deathblow combo (?parryRiposte=deathblow): a parry that breaks his posture, or one of a blue blow, is answered by N blows
  ...[3, 7].map((n) => ({ id: `deathblow${n}`, name: `Deathblow ${N(n)}`, boss: 'duel', streak: 0, role: 'single', answer: 'perfect', riposte: 'deathblow', parryRun: n - 1, postureNear: true, desc: `${n - 1} perfect parries behind him, his posture one parry from breaking: the perfect parry breaks it and a planted combo of ${n} blows follows, every one another clip of your own, the last the heaviest (${(22 + 2 * n) * (n - 1) + 40 + 15 * n} damage).`, expect: ['player:parry', 'player:flurryEnd'] })),
  { id: 'deathblowBlue', name: 'Deathblow on a blue blow', boss: 'duel', streak: 0, role: 'blue', answer: 'plain', riposte: 'deathblow', parryRun: 4, posture: 30, desc: 'Four perfect parries behind you, then a single BLUE blow parried (a plain parry: a perfect one of this blow locks the blades instead): no posture break needed, a planted combo of four blows answers it and he reels.', expect: ['player:parry', 'player:flurryEnd'] },
  {
    id: 'parryCounter', name: 'Parry a string: recoil + counter cut', boss: 'duel', streak: 0, role: 'string', answer: 'parry', riposte: 'deathblow',
    desc: 'A string parried blow for blow: no automatic riposte. The last parry recoils him and opens a short window; the training presses attack in it for your own quick counter cut.',
    go: (T) => { T._ctr = false; T.d.debug?.trigger?.(T._roles().string); },
    tick: (T) => { if (!T._ctr && T.p.quickUntil > T.game.time) { T._ctr = true; T.tap('@attack'); } },
    expect: ['player:parry'],
  },
  { id: 'deflect', name: 'Deflect a string', boss: 'any', streak: 0, role: 'string', answer: 'parry', desc: 'Every blow of a string parried in rhythm: each counts in the streak, the last is answered by the riposte.', expect: ['player:parry'] },
  { id: 'deflectLong', name: 'Deflect a long string', boss: 'any', streak: 0, role: 'long', answer: 'parry', desc: 'A long string parried blow for blow: watch the streak climb and the riposte at the end.', expect: ['player:parry'] },
  { id: 'blockString', name: 'Block a string', boss: 'any', role: 'string', answer: 'block', desc: 'The guard held through a string: chip damage, pushback, no riposte.', expect: ['player:block'] },
  { id: 'lock', name: 'Blade lock', boss: 'duel', role: 'lock', answer: 'perfect', mash: true, dbLock: 'lock', desc: 'A perfect parry of his heavy blow locks the blades: mash attack to win the push. Played with ?dbLock=lock: in a fight the deathblow takes that parry.', expect: ['player:lock'] },
  { id: 'trade', name: 'Trade clash', boss: 'duel', role: 'single', answer: 'trade', dist: 2.2, clear: true, desc: 'Your cut meets his blow in the air: both blades thrown back, nobody hurt. Pressed at the last instant it is the flash counter: the cut goes through him.', expect: ['combat:clash'] },
  { id: 'mikiri', name: 'Mikiri', boss: 'ash', role: 'mikiri', answer: 'mikiri', dist: 3.2, desc: 'A roll INTO his perilous thrust: you step on his blade.', expect: ['player:mikiri'] },
  { id: 'mikiriSheath', name: 'Mikiri', boss: 'sheathed', role: 'mikiri', answer: 'mikiri', dist: 4.0, desc: 'A roll INTO The Walking Staff: you step on the scabbard.', expect: ['player:mikiri'] },
  // the Sheathed's draw (ADR-144): parry it, or a held guard is knocked open, or roll through it
  { id: 'drawParry', name: 'One Breath · parry the draw', boss: 'sheathed', move: 'oneBreath', answer: 'parry', dist: 4.5, desc: 'The settle, the stillness, the click (the blue flare at the scabbard), the cut: parry on the click. He is caught with the blade out.', expect: ['player:parry'] },
  { id: 'drawGuard', name: 'One Breath · hold the guard', boss: 'sheathed', move: 'oneBreath', answer: 'block', dist: 4.5, desc: 'A held guard keeps you alive: no health lost, but the whole guard meter is gone and the guard is knocked open.', expect: ['player:guardOpen'] },
  { id: 'drawRoll', name: 'One Breath · roll through it', boss: 'sheathed', move: 'oneBreath', answer: 'dodge', dist: 4.5, desc: 'A roll on the click: clean, and his re-sheathe is the opening.', expect: ['player:perfectDodge'] },
  { id: 'mikiriAsc', name: 'Mikiri', boss: 'asc', role: 'mikiri', answer: 'mikiri', dist: 3.6, desc: 'A roll INTO his Piercing Palm: you step on his arm.', expect: ['player:mikiri'] },
]);

add('BOSS STREAK', [
  { id: 'foeBuild', name: 'Build his streak, he answers', boss: 'duel', foe: 4, dist: 2.0, riposte: 'planted', answer: 'parry', ai: true, clear: true, desc: 'Strike into his guard: his streak climbs and his guard answers with his flurry. Parry every blow.', go: (T) => T.tap('@attack'), until: (T) => T.t > 1 && !T.moving() && T.heroFree(), max: 14, expect: ['dragon:flurry'] },
  ...[3, 5, 7].map((n) => ({ id: `foe${n}`, name: `His flurry ${N(n)} · parry all`, boss: 'duel', foe: n, dist: 2.6, riposte: 'planted', answer: 'parry', desc: `${n} blows, each from another side. Parry every one and his posture breaks.`, go: (T) => T.d.debug.flurry(n), expect: ['dragon:flurryEnd', 'dragon:postureBreak'] })),
  { id: 'foePerfect', name: `His flurry ${N(5)} · perfect parries`, boss: 'duel', foe: 5, dist: 2.6, riposte: 'planted', answer: 'perfect', desc: 'Every blow perfect-parried (each counts two toward the total).', go: (T) => T.d.debug.flurry(5), expect: ['dragon:flurryEnd'] },
  { id: 'foeBlock', name: `His flurry ${N(5)} · block all`, boss: 'duel', foe: 5, dist: 2.6, riposte: 'planted', answer: 'block', desc: 'A held guard meets them from any side: he breaks too.', go: (T) => T.d.debug.flurry(5), expect: ['dragon:flurryEnd', 'dragon:postureBreak'] },
  { id: 'foeMiss', name: `His flurry ${N(5)} · one let through`, boss: 'duel', foe: 5, dist: 2.6, riposte: 'planted', answer: (i) => (i === 2 ? 'none' : 'parry'), desc: 'The third blow lands: nothing breaks, and your streak is lost.', go: (T) => T.d.debug.flurry(5), expect: ['dragon:flurryEnd'] },
  { id: 'foeDodge', name: `His flurry ${N(4)} · perfect-dodge it`, boss: 'duel', foe: 4, dist: 2.6, answer: 'dodge', desc: 'Perfect dodges of his blows count in your streak (white blows: no flurry) and break nothing of his.', go: (T) => T.d.debug.flurry(4), expect: ['player:perfectDodge'] },
]);

add('OFFENCE', [
  { id: 'chain', name: 'Light chain (5 hits)', boss: 'any', desc: 'The five-hit chain into the slam.', dist: 2.4, wyrmDist: 3.2, go: () => {}, tick: (T) => T.every(0.36, 5, () => T.tap('@attack')), until: (T) => T.t > 2.4 && T.heroFree(), expect: ['player:attack'] },
  // the heavy branches (ADR-115): n lights, then HEAVY (combat.js HEAVY)
  ...[
    ['Piercing Gale', 'Heavy on its own: a dashing two-handed thrust that closes the gap.'],
    ['Rising Crescent', 'Light, then heavy: a two-handed rising cut that staggers a duelist.'],
    ['Whirling Tempest', 'Two lights, then heavy: a full two-handed turn, the blade all round him.'],
    ['Mountain Splitter', 'Three lights, then heavy: a falling cut from over the left shoulder that crushes a raised guard.'],
    ['Earthbreaker', 'Four lights, then heavy: the slam with a higher leap and a wider ring of shards.'],
  ].map(([name, desc], n) => ({
    id: `heavy${n}`, name: `${'L-'.repeat(n)}H · ${name}`, boss: 'any', desc, dist: 2.4, wyrmDist: 3.2, go: () => {},
    tick: (T) => { if (n) T.every(0.36, n, () => T.tap('@attack')); T.at(0.36 * n + 0.02, () => T.tap('@heavy')); },
    until: (T) => T.t > 0.36 * n + 1.6 && T.heroFree(), max: 8, expect: ['player:attack'],
  })),
  { id: 'cleave', name: 'Charged cleave', boss: 'any', desc: 'Hold heavy to full charge, release: the dashing cleave.', dist: 4.5, wyrmDist: 5, go: (T) => T.hold('@heavy', 1.3), until: (T) => T.t > 1.9 && T.heroFree(), expect: ['player:charge'] },
  { id: 'critChain', name: 'Crit window after a Ghostep', boss: 'any', streak: 0, role: 'red', answer: 'dodge', desc: 'A perfect dodge, then the chain inside the crit window.', after: (T) => T.everyFrom(T.afterT, 0.36, 5, () => T.tap('@attack'), 'crit'), until: (T) => T.afterT >= 0 && T.t - T.afterT > 2.2 && T.heroFree(), expect: ['player:perfectDodge'] },
  { id: 'execute', name: 'Posture break → execution', boss: 'any', desc: 'His posture broken, an attack near him executes him (the deathblow on the Starless Lord ends a form).', dist: 2.6, wyrmDist: 4, go: (T) => T.d.debug.postureBreak(), tick: (T) => T.at(0.6, () => T.tap('@attack')), until: (T) => T.t > 1 && T.heroFree() && !T.moving(), max: 9, expect: ['player:plungeHit'] },
  { id: 'crush', name: 'Guard crush (full charge)', boss: 'duel', dist: 3.6, desc: 'A full-charge cleave into his raised guard crushes it: he staggers.', go: (T) => T.hold('@heavy', 1.3), until: (T) => T.t > 2 && T.heroFree(), expect: ['player:charge'] },
]);

add('GETTING HIT', [
  { id: 'hit', name: 'Hit (stagger)', boss: 'any', role: 'single', answer: 'none', desc: 'A blow taken: the flinch, the freeze, the red edge.', expect: ['player:hurt'] },
  { id: 'knockdown', name: 'Knocked down (red blow)', boss: 'any', role: 'red', answer: 'none', desc: 'A red blow taken: down, and back up.', until: (T) => T.t > 1 && T.heroFree() && !T.moving(), expect: ['player:hurt'] },
  { id: 'guardBreak', name: 'Guard broken (blocking red)', boss: 'any', role: 'red', answer: 'block', desc: 'A red blow cannot be blocked: the guard shatters.', until: (T) => T.t > 1 && T.heroFree() && !T.moving(), expect: ['player:guardBreak'] },
  { id: 'death', name: 'Death', boss: 'any', role: 'red', answer: 'none', god: false, hp: 1, desc: 'The killing blow and the fall (the next situation brings you back).', until: (T) => T.t > 3.5, expect: ['player:died'] },
]);

// The Starless Lord's moves on the crater's pieces (ADR-109): each staged where it works, on a crater
// put back whole. The same moves under BOSS MOVES start from where he stands and take what there is.
const crater = (T, form, bx, bz, hx, hz, move) => {
  T.game.world?.restore?.();
  if (T.d.phase < form) T.d.debug.setForm?.(form); // (the move's first form, or the one he is in)
  T.d.position.set(bx, 0, bz);
  T.d.yaw = Math.atan2(hx - bx, hz - bz);
  T.p.debug.teleport(hx, hz);
  T.p.yaw = Math.atan2(bx - hx, bz - hz);
  T.d.debug.trigger(move);
};
const craterDone = (T) => T.t > 1.5 && !T.moving() && T.heroFree() && !T.d.terrain?.busy;
add('TERRAIN', [
  { id: 'lord-hurl', name: 'Void Hurl · under it', boss: 'lord', pieces: true, answer: 'none', desc: 'A stone that hung in the air comes to hang beside him and is thrown: the ring where it lands is drawn as it leaves his grip, the glint comes just before it lands. You stay, and it lands on you (red: no guard holds it; be out of the ring, or roll).', go: (T) => crater(T, 1, 0, -4, 0, 4.5, 'voidHurl'), until: craterDone, max: 9, expect: ['combat:flash', 'player:hurt'] },
  { id: 'lord-rain', name: 'Glass Rain · three in a row', boss: 'lord', pieces: true, answer: 'none', desc: 'Three pieces gather round him and leave one after another, each for where you are going: a ring and a glint for each. You stay.', go: (T) => crater(T, 3, 0, -4, 0, 4.5, 'glassRain'), until: craterDone, max: 11, expect: ['combat:flash', 'player:hurt'] },
  { id: 'lord-fall', name: 'Crown Fall · under the shard', boss: 'lord', pieces: true, answer: 'none', desc: 'You stand beside a tall shard. His hand closes on it and wrenches it down: the strip it falls on is marked red from the moment it goes. You stay, and it lands on you.', go: (T) => crater(T, 2, 2, -2, 8.6, 4.4, 'crownFall'), until: craterDone, max: 9, expect: ['combat:flash'] },
]);

// A duelist's change to phase / form n plays only from n - 1 (brain.forcePhase): from anywhere else
// he is put into n - 1 first, that change not played, as the Lab's `_skipToPhase` does (the Lord's
// setForm dresses the form; Shen Hui's enterPhase sets the phase), then the change to n plays.
const duelChange = (T, n) => {
  const d = T.d;
  if ((d.phase ?? 1) !== n - 1) {
    if (typeof d.debug?.setForm === 'function') d.debug.setForm(n - 1);
    else d.enterPhase?.(n - 1);
  }
  return d.debug[`phase${n}`]?.();
};

// The Thousand-Body Fox (ADR-147, ADR-154): his packs of paper selves, the Pearl
/** Walk the hero at him while he is further than `near` m (the Pearl's backstep takes him out of reach). */
const foxClose = (T, near = 2.2) => {
  const d = T.d, p = T.p;
  if (!d || !p) return;
  const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
  if (l > near) T._axis(dx / l, -dz / l);
  else T._axis(0, 0);
};
add('THE THOUSAND-BODY FOX', [
  { id: 'foxAll', name: 'A Thousand at Once · one parry', boss: 'fox', dist: 4, answer: 'parry', desc: 'Selves appear in the air on every side and dive at the same instant: one blue cue. One parry bursts them all (his posture takes it).', go: (T) => T.d.debug.pack({ n: 4, mode: 'together', form: 'ring', blow: 'dive', tell: 'blue', flare: true, from: 1.0 }, { attack: 'allAtOnce' }), until: (T) => T.t > 1 && !T.d.clones?.packLive && T.heroFree(), max: 10, expect: ['dragon:clone', 'player:parry'] },
  { id: 'foxRound', name: 'The Round · parry the chain', boss: 'fox', dist: 3, answer: 'parry', desc: 'Selves drop into a ring round you and strike in turn, then his own palm from above. Parry every blow: the whole Round parried is the full deflect, he reels.', go: (T) => { if (T.d.phase < 2) T.d.enterPhase?.(2); T.d.debug.trigger('foxRing'); }, until: (T) => T.t > 1.5 && !T.d.clones?.packLive && !T.moving() && T.heroFree(), max: 12, expect: ['dragon:clone', 'player:parry'] },
  { id: 'foxHowl', name: 'Heaven-Devouring Howl · roll through it', boss: 'fox', dist: 6, answer: 'dodge', god: true, desc: 'He leaves for the rim and summons the Nine-Tailed Fox; a dark sun gathers at its jaws and the red cue flashes there: roll through the beam as it fires (it sweeps toward your side, one way only). Then he kneels open.', go: (T) => T.d.debug.howl?.(), until: (T) => T.t > 2 && !T.d.howl?.busy && !T.moving() && T.heroFree(), max: 16, expect: ['combat:flash'] },
  { id: 'foxPearlBurst', name: 'The Pearl · burst it in his hand', boss: 'fox', dist: 2.6, answer: 'none', desc: 'He steps back and shapes the Pearl in his palm: his guard is down (the selves that drop in to harry you are popped here). Close in and cut him twice while it charges: it bursts in his hand and he reels.', go: (T) => T.d.debug.trigger('foxPearl'), tick: (T) => { for (const c of T.d.clones?.list ?? []) if (c.alive && c.state === 'pack') T.d.clones.popAt(c.i, NaN, 0, NaN, false, 'cut'); if (T.d.pearl?.charging) { foxClose(T); if (T.d.pearl.u > 0.15 && T.d.pearl.u < 0.92) T.every(0.3, 99, () => T.tap('@attack'), 'foxCut'); } else T._axis(0, 0); }, until: (T) => T.t > 1 && !T.moving() && T.heroFree(), max: 10, expect: ['dragon:stagger'] },
]);

// Xin Yi, the One Who Woke (ADR-156): his five lessons. His shots and the front cue themselves (bullet /
// hazard flashes, which the toolbar's answer leaves alone): those two lessons answer them here.
/** A perfect parry as each heavy shot of his is about to meet the hero (its own flight). */
const wokeShot = (T) => {
  const p = T.p;
  if (!p) return;
  for (const s of T.d.fx?.shots ?? []) {
    if (!s.alive || s.done || s.returned || !s.heavy || s._tp) continue;
    const dist = Math.hypot(p.position.x - s.x, p.position.z - s.z) - (s.radius ?? 0.4) - (p.radius ?? 0.45);
    if (dist / Math.max(1, s.speed) <= 0.05) {
      s._tp = true;
      T.tap('@block', 0.05);
    }
  }
};
/** A roll at the Falling Fist's cue, and again as its front is cued on the hero. */
const wokeFront = (T) => {
  const a = T.d.brain?.act, F = T.d.source?.front;
  const b = a?.beats?.find((x) => x.def.fist);
  if (b && !b._tr && a.t >= b.flash + 0.14) {
    b._tr = true;
    T._answer('dodge');
  }
  if (F?.live && F.flashed && !F._tr) {
    F._tr = true;
    T.later(0.12, () => T._answer('dodge'));
  }
};
// Xin Yi, the One Who Woke (ADR-156): his five lessons
add('THE ONE WHO WOKE', [
  { id: 'wokeLesson', name: 'The First Lesson · parry all five', boss: 'woke', move: 'lesson', phase: 1, answer: 'parry', dist: 2.4, desc: 'The beckon is its sign: the long string comes. One hand, feet planted, five blows; the last is the blue flare. Parry all five: the full deflect.', expect: ['player:parry'] },
  { id: 'wokeRain', name: 'Iron Rain · use the pillar', boss: 'woke', move: 'ironRain', phase: 2, answer: 'none', dist: 8, pieces: true, desc: 'He strafes round you firing from both hands. A pillar between you takes the shots (each takes its letters off); a held guard pays guard, never health.', go: (T) => { const W = T.game.world?.destructibles, pl = W?.list?.find((b) => b.kind === 'pillar' && !b.absent && b.state === 0); if (pl) { T.p.debug.teleport(pl.x - 1.2, pl.z); T.d.position.set(pl.x + 7, 0, pl.z); } T.d.debug.trigger('ironRain'); }, expect: [] },
  { id: 'wokeThunder', name: 'Two Thunders · send one back', boss: 'woke', answer: 'none', go: (T) => { if (T.d.phase !== 2) T.d.debug.setPhase(2); T.d.position.set(0, 0, -7); T.d.yaw = 0; T.p.debug.teleport(0, -1); T.d.debug.trigger('twoThunders'); }, tick: wokeShot, desc: 'Two heavy shots. A perfect parry sends one back: he bends under it (time slows), open for a second; the first cut crits. Send both: he cannot bend twice.', expect: ['player:parry'] },
  { id: 'wokeStill', name: 'The Still Hand · wait it out', boss: 'woke', move: 'stillHand', phase: 3, answer: 'none', dist: 2.2, desc: 'The raised flat palm: a cut into it is caught and answered by a one-inch push. Wait it out instead: his guard stays down.', expect: [] },
  // the rework (ADR-168, ADR-169): the burst, the wall kick, a bullet burst
  { id: 'wokeBurst', name: 'Rain on One Roof · one parry', boss: 'woke', move: 'oneRoof', phase: 1, answer: 'parry', dist: 1.8, desc: 'A blur of blows under ONE glint: a flurry burst. Parry its first blow and the whole burst is turned; a held guard pays a little guard and no health; one roll passes it all.', expect: ['player:parry'] },
  { id: 'wokeWall', name: 'Borrowed Wall · parry the kick', boss: 'woke', phase: 1, answer: 'parry', dist: 5, desc: 'He runs up the upright at your side and springs at you: the flying side kick (blue flare: parry) or, if he goes higher, the drop heel (red: roll).', go: (T) => T.d.debug.wall?.('kick'), expect: ['player:parry'] },
  { id: 'wokeBullets', name: 'Iron Rain · answer a burst', boss: 'woke', move: 'ironRain', phase: 2, answer: 'parry', dist: 8, desc: 'Three bursts of three, each under ONE glint at the muzzle. One parry turns a burst; a hit is a short flinch, then you have time to guard, parry or roll before the next.', expect: ['player:parry'] },
  { id: 'wokeFist', name: 'The Falling Fist · roll the front', boss: 'woke', phase: 3, answer: 'none', dist: 5, desc: 'He leaves the floor and dives on where you stood: roll out of the crater, then roll through the front as it reaches you.', go: (T) => { if (T.d.source) T.d.source.front._tr = false; T.d.debug.flight?.('fist'); }, tick: wokeFront, until: (T) => T.t > 4 && !T.moving() && T.heroFree() && !T.d.source?.front?.live, max: 12, expect: ['player:perfectDodge'] },
]);

add('BOSS STATES', [
  { id: 'stagger', name: 'Stagger', boss: 'any', desc: 'His stagger.', go: (T) => T.d.debug.stagger(), until: (T) => T.t > 1.2 && !T.moving(), expect: [] },
  { id: 'break', name: 'Posture break', boss: 'any', desc: 'His posture breaks: open to crits.', go: (T) => T.d.debug.postureBreak(), until: (T) => T.t > 3.6, expect: ['dragon:postureBreak'] },
  { id: 'phase2', name: 'Phase 2', boss: 'any', desc: 'The second phase begins (its transition).', go: (T) => T.d.debug.phase2(), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: [] },
  { id: 'phase3', name: 'Phase 3', boss: 'wyrm', desc: 'The third phase: the wyrm burns white-hot.', go: (T) => T.d.debug.phase3(), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: [] },
  { id: 'phase3a', name: 'Phase 3', boss: 'ash', desc: 'His third phase: ash on the wind (its change).', go: (T) => duelChange(T, 3), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase3'] },
  { id: 'phase3h', name: 'No One Is Watching', boss: 'halcyon', desc: 'His third phase: he burns out every screen; the city goes dark.', go: (T) => duelChange(T, 3), until: (T) => T.t > 1 && !T.moving(), max: 14, expect: ['dragon:phase3'] },
  { id: 'phase3f', name: 'The Fox-Fire Mantle', boss: 'fox', desc: 'His third phase: his selves burn up into him and the mantle lights.', go: (T) => duelChange(T, 3), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase3'] },
  { id: 'phase3l', name: 'Form 3', boss: 'lord', desc: 'His third blade form ignites.', go: (T) => duelChange(T, 3), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase3'] },
  { id: 'form2a', name: 'Golden Ascension', boss: 'asc', desc: 'His second form: the transformation.', go: (T) => duelChange(T, 2), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase2'] },
  { id: 'form3a', name: 'Thunder Ascension', boss: 'asc', desc: 'His third form: the transformation.', go: (T) => duelChange(T, 3), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase3'] },
  { id: 'phase4', name: 'Form 4', boss: 'lord', desc: 'His fourth form: the Void answers him.', go: (T) => duelChange(T, 4), until: (T) => T.t > 1 && !T.moving(), max: 10, expect: ['dragon:phase4'] },
  { id: 'bossDeath', name: 'His death', boss: 'any', desc: 'The killing blow (the next situation wakes him again).', go: (T) => T.d.debug.kill(), until: (T) => T.t > 4, expect: [] },
]);

// The Ash Disciple's moves on the courtyard's pieces (ADR-111): each staged where it works (the hero
// under a pillar, a lantern or the bell in reach), on a courtyard put back whole.
const stage = (T, bx, bz, hx, hz, move) => {
  T.game.world?.restore?.();
  T.d.position.set(bx, 0, bz);
  T.d.yaw = Math.atan2(hx - bx, hz - bz);
  T.p.debug.teleport(hx, hz);
  T.p.yaw = Math.atan2(bx - hx, bz - hz);
  T.d.debug.trigger(move);
};
const settled = (T) => T.t > 1 && !T.moving() && T.heroFree() && !T.pending.length && !T.d.terrain?.busy;
add('TERRAIN', [
  { id: 'terr-fell', name: 'Severed Pillar · step out of the strip', boss: 'ash', pieces: true, answer: 'none', desc: 'He is behind the pillar you stand under and cuts it down on you: the strip it lands on is marked red. Walk out of it.', go: (T) => stage(T, -6, 2, -12.4, 0.4, 'pillarFall'), tick: (T) => { T.at(0.8, () => T._axis(0, 1)); T.at(1.5, () => T._axis(0, 0)); }, until: (T) => T.t > 2.4 && settled(T), expect: ['combat:flash'] },
  { id: 'terr-fell-hit', name: 'Severed Pillar · under it', boss: 'ash', pieces: true, answer: 'none', desc: 'The same, and you stay: the pillar lands on you (red: no guard holds it).', go: (T) => stage(T, -6, 2, -12.4, 0.4, 'pillarFall'), until: (T) => T.t > 2.4 && settled(T), expect: ['player:hurt'] },
  { id: 'terr-kick', name: 'Flying Lantern · parry it', boss: 'ash', pieces: true, answer: 'parry', desc: 'He kicks a stone lantern at you. It glints as it comes down: the parry bursts it on your blade.', go: (T) => stage(T, 8, 6, 2, 1, 'lanternKick'), until: settled, expect: ['player:parry'] },
  { id: 'terr-toll', name: 'Three Tolls · parry the rings', boss: 'ash', pieces: true, answer: 'parry', desc: 'Three blows on the fallen bell, three rings of sound: parry each as it reaches you (the last is the heavy one).', go: (T) => stage(T, -4, -5, 1.5, -1, 'bellToll'), until: settled, max: 14, expect: ['player:parry'] },
  { id: 'terr-toll-roll', name: 'Three Tolls · roll through', boss: 'ash', pieces: true, answer: 'dodge', desc: 'The same, rolled: each ring is passed through as it arrives.', go: (T) => stage(T, -4, -5, 1.5, -1, 'bellToll'), until: settled, max: 14, expect: ['player:perfectDodge'] },
  { id: 'terr-spring', name: "Swallow's Return · parry the dive", boss: 'ash', pieces: true, answer: 'parry', desc: 'He leaps back onto the pillar behind him and dives off it at you: the glint comes as he leaves the stone.', go: (T) => stage(T, -10.5, 0.6, -7.4, 0, 'swallowReturn'), until: settled, expect: ['player:parry'] },
]);

// Tian Lei's ki and floor (the Skybreak Ring): each from his beat's own clock (a beam's cue and a thrown
// slab's are hazards: the runner's answers skip them), in the form the move belongs to
const ascGo = (form, name) => (T) => {
  if (T.d.phase !== form) T.d.debug.setForm?.(form);
  T.d.debug.trigger(name);
};
/** Once, `lead` s before the impact of his next blow (the beat's own clock). */
const ascHead = (T, lead, fn) => {
  const a = T.d?.brain?.act, b = a?.beats?.find((x) => !x.feint && !x.done && a.t < x.impact);
  if (b && b.impact - a.t <= lead) T.at(0, fn, 'ascHead');
};
const ascRoll = (T) => {
  const p = T.p, d = T.d, dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
  T._axis(-dz / l, -dx / l);
  T.tap('Space');
  T.later(0.4, () => T._axis(0, 0));
};
/** Once, when his counter stance is catching (a beat marked `stance`, duelist/brain.js): a cut into it. */
const ascCut = (T) => {
  if (T.d?.brain?.catching?.()) T.at(0, () => T.tap('@attack'), 'ascCut');
};
/** Once his stance has ended on nothing (he stands open, the guard down): the cut that punishes it. */
const ascOpen = (T) => {
  if ((T.d?.brain?.stats?.stanceMiss ?? 0) > fin(T._ascMiss)) T.at(0, () => T.tap('@attack'), 'ascOpen');
};
add('PARRY & RIPOSTE', [
  { id: 'ascSign', name: 'The sign · turn and parry', boss: 'asc', dist: 4, answer: 'parry', desc: 'Two fingers to his brow (form 2, Sign Step): he is gone, and the hook comes from BEHIND you. Its glint shows where: turn and parry the three blows.', go: ascGo(2, 'signStep'), expect: ['player:parry'] },
  { id: 'ascCatch', name: 'Counter stance · cut into it', boss: 'asc', dist: 1.9, answer: 'parry', desc: 'Still Water (form 1): he sinks, the palms open, light drawn into them. Cut into it and he CATCHES the blade (thrown back, no damage) and punishes at once: parry the cross and the palm.', go: ascGo(1, 'stillWater'), tick: ascCut, expect: ['player:attack', 'dragon:guard', 'player:parry'] },
  { id: 'ascCatchWait', name: 'Counter stance · wait it out', boss: 'asc', dist: 1.9, answer: 'none', desc: 'The patient answer: do not cut into the open palms. The stance ends on nothing, his guard is down a moment: cut him then.', go: (T) => { T._ascMiss = T.d.brain?.stats?.stanceMiss ?? 0; ascGo(1, 'stillWater')(T); }, tick: ascOpen, until: (T) => T.t > 2.4 && !T.moving() && T.heroFree(), max: 6, expect: ['player:attack'] },
  { id: 'ascClash', name: 'The beam clash', boss: 'asc', dist: 6, answer: 'none', mash: true, desc: 'His great beam (form 3): a perfect parry of its head starts THE CLASH at range. Mash attack to split the beam: he reels.', go: ascGo(3, 'heavenTide'), tick: (T) => ascHead(T, 0.04, () => T.tap('@block', 0.05)), until: (T) => T.t > 3 && !T.moving() && T.heroFree() && !T.d.ki?.busy, max: 16, expect: ['player:lock'] },
]);
add('GETTING HIT', [
  { id: 'ascTide', name: 'Rising Tide · roll out of the line', boss: 'asc', dist: 9, answer: 'none', desc: 'His beam: a red cue at the drawn-back palm, then the line is lit. Roll off it at the cue.', go: ascGo(1, 'risingTide'), tick: (T) => ascHead(T, 0.24, () => ascRoll(T)), until: (T) => T.t > 1.5 && !T.moving() && T.heroFree() && !T.d.ki?.busy, max: 9, expect: ['combat:flash'] },
  { id: 'ascTideHit', name: 'Rising Tide · stand in it', boss: 'asc', dist: 9, answer: 'none', desc: 'The same, and you stay: the first contact throws you down along the line.', go: ascGo(1, 'risingTide'), until: (T) => T.t > 1.5 && !T.moving() && T.heroFree() && !T.d.ki?.busy, max: 9, expect: ['player:hurt'] },
]);
// (the third wave, ki: the great orb's push, the barrage from the air)
/** Once, `lead` s before Heaven's Lantern's orb would meet the hero (its own flight). */
const ascOrb = (T, lead, fn) => {
  const s = T.d?.ki?.shots?.lantern?.s, p = T.p;
  if (!s?.alive || s.done || !p) return;
  const along = (p.position.x - s.x) * s.dx + (p.position.z - s.z) * s.dz;
  if ((along - s.radius - (p.radius ?? 0.45)) / Math.max(0.1, s.speed) <= lead) T.at(0, fn, 'ascOrb');
};
add('PARRY & RIPOSTE', [
  { id: 'ascLantern', name: "Heaven's Lantern · push it back", boss: 'asc', dist: 9, answer: 'none', mash: true, desc: 'His great orb (forms 2 - 3): a perfect parry as it reaches you starts THE PUSH. Mash attack to throw it back into him: he reels.', go: ascGo(2, 'skyLantern'), tick: (T) => ascOrb(T, 0.04, () => T.tap('@block', 0.05)), until: (T) => T.t > 3 && !T.moving() && T.heroFree() && !T.d.ki?.busy, max: 16, expect: ['player:lock'] },
]);
add('GETTING HIT', [
  { id: 'ascSuns', name: 'Raining Suns · block the barrage', boss: 'asc', dist: 9, answer: 'block', desc: 'He leaps and pours sixteen small blasts down at you, then a bigger one: hold your guard through it (each glints as it comes).', go: ascGo(2, 'rainingSuns'), until: (T) => T.t > 2 && !T.moving() && T.heroFree() && !T.d.ki?.busy, max: 12, expect: ['player:block'] },
]);
add('TERRAIN', [
  { id: 'ascTile', name: 'Tile Kick · under it', boss: 'asc', dist: 7, answer: 'none', desc: 'He stamps a floor slab up and punches it at you: it glints as it comes. You stay, and it hits you (a parry would cut it).', go: ascGo(1, 'tileKick'), until: (T) => T.t > 1.5 && !T.moving() && T.heroFree() && !T.d.terrain?.busy, max: 9, expect: ['combat:flash'] },
]);

export const SITUATIONS = Object.freeze(S);
export const CATEGORIES = Object.freeze([...new Set(S.map((s) => s.cat)), 'BOSS MOVES']);

// ------------------------------------------------------------------ the runner
export class Training {
  constructor(game) {
    this.game = game;
    this.cur = null; // the situation running
    this.ph = 'idle'; // idle | prep | settle | place | run | tail | done
    this.t = 0; // game s in this phase
    this.t0 = 0; // game time the situation's go() ran
    this.loop = false;
    this.moveAnswer = 'parry'; // the answer to a BOSS MOVES situation
    this.events = new Map(); // what happened since go(): name → count
    this.blow = 0; // the boss's glints since go()
    this.pending = []; // answers due: { at, mode, i }
    this.holds = new Map(); // virtual codes held: code → release time (game s)
    this.marks = new Set(); // at() / every() bookkeeping
    this.timers = []; // later(): { at (game s), fn }
    this.afterT = -1; // phase time `after` began (critChain: the chain once the dodge is over)
    this.lastResult = null; // { id, ok, missing, secs }
    this.onChange = null; // the panel's refresh hook
    this._listening = false;
  }

  get p() {
    return this.game.player;
  }
  get d() {
    return this.game.dragon;
  }
  get running() {
    return !!this.cur && this.ph !== 'idle' && this.ph !== 'done';
  }

  /** The situations that apply to the boss loaded, the BOSS MOVES category included (one per move). */
  list() {
    const kinds = bossKinds(this.game);
    // (`pieces`: a situation that needs the level's breakables: not on a stage without any)
    const pieces = (this.game.world?.destructibles?.list?.length ?? 0) > 0;
    const out = SITUATIONS.filter((s) => kinds.has(s.boss) && this._roleOk(s) && (!s.pieces || pieces));
    let ab = [];
    try {
      ab = this.d?.debug?.abilities?.() ?? [];
    } catch {
      ab = [];
    }
    for (const a of ab) {
      if (!a?.name) continue;
      out.push({
        id: `move-${a.name}`, cat: 'BOSS MOVES', name: a.label ?? a.name, boss: 'any', move: a.name, tell: a.tell, phase: a.phase,
        desc: `${a.label ?? a.name}, answered with the toolbar's answer.`, god: true, tail: 0.6, max: 16, answer: () => this.moveAnswer, expect: [],
      });
    }
    return out;
  }

  _roleOk(s) {
    return !s.role || !!this._roles()[s.role];
  }

  /** The boss's moves by role: the level's, else by his kind (the sims build no level). */
  _roles() {
    const id = this.game.level?.id;
    if (ROLES[id]) return ROLES[id];
    const k = bossKinds(this.game);
    return (k.has('wyrm') ? ROLES.cinderwood : k.has('asc') ? ROLES.ring : k.has('fox') ? ROLES.fox : k.has('halcyon') ? ROLES.city : k.has('untouched') ? ROLES.veil : k.has('saint') ? ROLES.foundry : k.has('lord') ? ROLES.starless : k.has('ash') ? ROLES.ash : null) ?? {};
  }

  find(id) {
    return this.list().find((s) => s.id === id) ?? null;
  }

  /** Start situation `id` (or the object). False when it does not apply to this boss. */
  run(id) {
    const s = typeof id === 'string' ? this.find(id) : id;
    if (!s) return false;
    this.stop(false);
    this._listen();
    this.cur = s;
    this._phase('prep');
    this._changed();
    return true;
  }

  /** Stop the situation running (inputs released; it stays selected for a replay). */
  stop(changed = true) {
    this._release();
    this._restoreRiposte();
    this._restoreDbLock();
    this.ph = 'idle';
    if (changed) this._changed();
  }

  replay() {
    if (this.cur) this.run(this.cur);
  }

  /** The next / previous situation in the list (wraps). */
  step(dir = 1) {
    const L = this.list();
    if (!L.length) return false;
    const i = this.cur ? L.findIndex((s) => s.id === this.cur.id) : -1;
    return this.run(L[(i + dir + L.length) % L.length]);
  }

  // ---------------------------------------------------------------- the frame (lab.update)
  update(realDt) {
    const s = this.cur;
    if (!s || this.ph === 'idle') return;
    const g = this.game, dt = fin(g.dt, 0);
    try {
      this.t += dt;
      this._releaseDue();
      for (let i = this.timers.length - 1; i >= 0; i--) {
        if (g.time < this.timers[i].at) continue;
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
      // aim at him: the swings and the facing follow the mouse ray
      const dp = this.d?.position;
      if (dp && g.mouseGround?.set) g.mouseGround.set(dp.x, 0, dp.z);
      switch (this.ph) {
        case 'prep':
          this._prep();
          break;
        case 'settle':
          if (this._bossFree() && this._heroFree()) this._place();
          else if (this.t > 5) {
            // something holds him (a transition, a reaction): start the fight over
            g.flow?.debug?.toState?.('boss');
            this.d?.debug?.setAI?.(!!s.ai);
            this._phase('settle2');
          }
          break;
        case 'settle2':
          if ((this._bossFree() && this._heroFree()) || this.t > 4) this._place();
          break;
        case 'place':
          this._pin();
          // (never starts with the hero down: a knockdown from the last situation's tail is still getting up here)
          if (this.t >= 0.3 && (this._heroFree() || this.t > 2.5)) this._go();
          break;
        case 'run':
          this._run(dt);
          break;
        case 'tail':
          if (this.t >= fin(s.tail, 0.8)) this._finish();
          break;
        case 'done':
          if (this.loop && this.t > 0.4) this.run(s);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[training] situation failed', s?.id, err);
      this._release();
      this._restoreRiposte();
      this._restoreDbLock();
      this.ph = 'done';
      this.lastResult = { id: s?.id, ok: false, missing: ['(error)'], secs: this.t };
      this._changed();
    }
  }

  _phase(ph) {
    this.ph = ph;
    this.t = 0;
    if (ph === 'done') {
      this._restoreRiposte();
      this._restoreDbLock();
    }
  }

  /** A situation's own `?dbLock=` (`s.dbLock`; ADR-280) ends with it, as its riposte mode does. */
  _restoreDbLock() {
    if (this._dbLockSaved == null) return;
    setDbLock(this._dbLockSaved);
    this._dbLockSaved = null;
  }

  /** A situation's own riposte mode (`s.riposte`) ends with it: the mode before it comes back. */
  _restoreRiposte() {
    if (this._riposteSaved == null) return;
    setRiposteMode(this._riposteSaved);
    this._riposteSaved = null;
  }

  _changed() {
    try {
      this.onChange?.();
    } catch (err) {
      console.error('[training] panel refresh failed', err);
    }
  }

  // ---------------------------------------------------------------- the steps
  _prep() {
    const g = this.game, s = this.cur, d = this.d, p = this.p;
    this._release();
    this.pending.length = 0;
    if (g.state !== 'boss' || DOWN.has(d?.state) || p?.alive === false) g.flow?.debug?.toState?.('boss');
    // every situation on a whole set: what an earlier one broke stands again and nothing is still
    // falling (a pillar toppled by the last situation fell on the hero in the next one's flurry)
    try {
      g.world?.restore?.();
    } catch (err) {
      console.error('[training] world.restore failed', err);
    }
    // (a boss's own things left in the field by the last situation: the fox's paper selves, his pearls)
    d?.debug?.tidy?.();
    d?.debug?.setAI?.(!!s.ai);
    if (p?.debug) {
      p.debug.god = s.god !== false;
      p.debug.flurryArt = s.art ?? null;
      p.debug.noRiposte = false;
    }
    // (a situation names the parry's answer; the Lab's own comes back with the next one that does not)
    if (s.riposte) {
      if (this._riposteSaved == null) this._riposteSaved = riposteMode();
      setRiposteMode(s.riposte);
    } else this._restoreRiposte();
    if (s.dbLock) {
      if (this._dbLockSaved == null) this._dbLockSaved = dbLockMode();
      setDbLock(s.dbLock);
    } else this._restoreDbLock();
    if (p) {
      p.parryRun = 0;
      if (p.db) p.db.phase = '';
    }
    this._phase('settle');
  }

  _bossFree() {
    const d = this.d;
    if (!d || DOWN.has(d.state) || d.broken) return false;
    if (typeof d.mode === 'string') return d.mode === 'foot';
    return d.state === 'combat' && !d.brain?.action;
  }

  _heroFree() {
    const p = this.p;
    return !!p && p.alive !== false && HERO_FREE.has(p.state) && !(fin(this.game.hitstopTimer) > 0);
  }

  heroFree() {
    return this._heroFree();
  }

  /** Is his move (or reaction) still running? */
  moving() {
    const d = this.d;
    if (!d || DOWN.has(d.state)) return false;
    if (typeof d.mode === 'string') return d.mode === 'act' || d.mode === 'react' || d.mode === 'broken' || d.mode === 'intro';
    return !!d.brain?.action || d.state !== 'combat';
  }

  /** How far from him the hero stands: `dist` (a duelist) / `wyrmDist` (× the wyrm's size). */
  _dist() {
    const s = this.cur;
    if (bossKinds(this.game).has('wyrm')) return fin(s.wyrmDist, 6) * (WYRM_SCALE / 1.25);
    return fin(s.dist, 2.6);
  }

  _place() {
    const s = this.cur, d = this.d, p = this.p;
    const dist = this._dist(), a0 = fin(d.yaw) + fin(s.ang, 0);
    const lim = fin(CONFIG.world.arenaRadius, 30) - 1.5;
    const spot = (a) => {
      let x = d.position.x + Math.sin(a) * dist, z = d.position.z + Math.cos(a) * dist;
      const r = Math.hypot(x, z);
      if (r > lim) {
        x *= lim / r;
        z *= lim / r;
      }
      return [x, z];
    };
    // `clear`: a situation built on the hero's own strikes stands where his blade swings free (a piece
    // within his sword's reach would stop his cuts: bites, ADR-132): the spot turns round the boss until
    // none is (the first clear one, else as asked). Others keep the spot as asked
    let [x, z] = spot(a0);
    const around = () => {
      for (let k = 1; k <= 12; k++) {
        const c = spot(a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6));
        if (!this._crowded(c[0], c[1])) return c;
      }
      return null;
    };
    if (s.clear && this._crowded(x, z)) {
      let c = around();
      // (nowhere round him: he is brought in toward the middle of the arena first)
      for (const [bx, bz] of CLEAR_SPOTS) {
        if (c) break;
        d.position.x = bx;
        d.position.z = bz;
        c = this._crowded(...spot(a0)) ? around() : spot(a0);
      }
      if (c) [x, z] = c;
    }
    p.debug.teleport(x, z);
    p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
    p.debug.heal?.();
    if (Number.isFinite(s.hp)) p.hp = clamp(s.hp, 1, p.maxHp);
    if (Number.isFinite(s.streak)) p.debug.streak(s.streak);
    if (Number.isFinite(s.parryRun)) p.parryRun = s.parryRun;
    if (typeof d.debug?.streak === 'function') d.debug.streak(fin(s.foe, 0));
    // fresh enough to take the situation: half his bar at least, no posture
    if (d.hp < d.maxHp * 0.5) d.hp = d.maxHp;
    if (Number.isFinite(d.posture) && !d.broken) {
      d.posture = 0;
      d.emitPosture?.(true);
    }
    // one parry of his next blow breaks it (a boss that scales the posture a parry costs, Xin Yi at full health, needs the bar nearly full)
    if (s.postureNear && Number.isFinite(d.posture) && !d.broken) {
      d.posture = Math.max(0, d.maxPosture - 2);
      d.postureTimer = 0;
      d.emitPosture?.(true);
    }
    // a posture that is not empty (the deathblow's parries behind it: parryRun is dropped when his posture is back to 0)
    if (Number.isFinite(s.posture) && Number.isFinite(d.posture) && !d.broken) {
      d.posture = clamp(s.posture, 0, d.maxPosture - 2);
      d.postureTimer = 0;
      d.emitPosture?.(true);
    }
    if (s.ai && d.brain) {
      d.brain.gapT = 99; // (his own moves held: only his answers to the hero)
      d.brain.raiseT = 0;
    }
    this._phase('place');
  }

  /** Does a piece of the world stand within the hero's sword's reach of (x, z) (BREAK.chip.stop's height and up)? */
  _crowded(x, z) {
    const L = this.game.world?.destructibles?.list;
    if (!L) return false;
    for (const b of L) {
      if (b.state !== 0 || b.floor || !(b.h >= 0.6)) continue;
      if (Math.hypot(b.x - x, b.z - z) - b.r < 2.6) return true;
    }
    return false;
  }

  /** Hold the hero still and facing him (before go). */
  _pin() {
    const p = this.p, d = this.d;
    this._axis(0, 0);
    if (p && d) p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  }

  _go() {
    const s = this.cur, d = this.d;
    this.events.clear();
    this.blow = 0;
    this.marks.clear();
    this.timers.length = 0;
    this.afterT = -1;
    this.t0 = this.game.time;
    this._phase('run');
    if (typeof s.go === 'function') s.go(this);
    else {
      const name = s.move ?? this._roles()[s.role];
      // (a later phase's move: a duelist is put into that phase at once, without its transition)
      if (s.move && fin(s.phase, 1) > fin(d.phase, 1) && typeof d.enterPhase === 'function') d.enterPhase(s.phase);
      if (name) d.debug?.trigger?.(name);
    }
    if (s.answer === 'block' || (typeof s.answer === 'function' && s.answer(0, this) === 'block')) this.hold('@block', 99);
    this._changed();
  }

  _run(dt) {
    const s = this.cur, g = this.game, p = this.p;
    // answers due
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const A = this.pending[i];
      if (g.time < A.at) continue;
      this.pending.splice(i, 1);
      this._answer(A.mode);
    }
    if (s.mash && p?.state === 'lock') this.every(0.08, 999, () => this.tap('@attack'), 'mash');
    s.tick?.(this, dt);
    if (this.holds.has('@block') && this.holds.get('@block') > g.time + 1 && this.t > 0.6 && !this.moving()) {
      this.holds.delete('@block');
      this._key('@block', false);
    }
    if (s.after && this.events.has('player:perfectDodge') && (this.afterT >= 0 || HERO_FREE.has(p?.state))) {
      if (this.afterT < 0) this.afterT = this.t;
      s.after(this, dt);
    }
    const done = typeof s.until === 'function' ? s.until(this) : this.t > 0.6 && !this.moving() && this._heroFree() && !this.pending.length;
    if (done || this.t > fin(s.max, 12)) {
      this._release();
      this._phase('tail');
    }
  }

  _finish() {
    const s = this.cur;
    const missing = (s.expect ?? []).filter((n) => !this.events.has(n));
    this.lastResult = { id: s.id, ok: !missing.length, missing, secs: +(this.game.time - this.t0).toFixed(2) };
    this._release();
    this._phase('done');
    this._changed();
  }

  // ---------------------------------------------------------------- the hero's side
  _listen() {
    if (this._listening || typeof this.game.events?.on !== 'function') return;
    this._listening = true;
    const ev = this.game.events;
    const watch = (n) => ev.on(n, (e) => this._event(n, e));
    for (const n of ['player:parry', 'player:block', 'player:perfectDodge', 'player:flurry', 'player:flurryEnd', 'player:hurt', 'player:streak',
      'player:guardBreak', 'player:guardOpen', 'player:lock', 'player:mikiri', 'player:died', 'player:attack', 'player:charge', 'player:plungeHit', 'combat:clash',
      'dragon:flurry', 'dragon:flurryEnd', 'dragon:postureBreak', 'dragon:phase2', 'dragon:phase3', 'dragon:phase4', 'dragon:guard', 'dragon:stagger', 'dragon:clone', 'combat:flash']) watch(n);
  }

  _event(n, e) {
    if (!this.cur || this.ph !== 'run') return;
    this.events.set(n, (this.events.get(n) ?? 0) + 1);
    if (n !== 'combat:flash' || e?.source !== 'dragon' || e?.bullet || e?.hazard) return;
    const s = this.cur, i = this.blow++;
    const mode = typeof s.answer === 'function' ? s.answer(i, this) : s.answer;
    if (!mode || mode === 'none') return;
    if (mode === 'block') {
      this.hold('@block', 99);
      return;
    }
    const A = ANSWERS[mode];
    if (!A) return;
    this.pending.push({ at: this.game.time + this._lead() - A.lead, mode, i });
  }

  /** The glint's lead on its impact for the boss loaded (s). */
  _lead() {
    const d = this.d, T = d?.T;
    // (a duelist: the cue that just fired, its beat's impact - flash: a readable pace's cue leads further than
    // T.flashLead, ADR-248 / ADR-251; the same number for a boss without one)
    const A = d?.brain?.act, b = Array.isArray(A?.beats) ? A.beats.find((x) => x.flashed && !x.done && !x.feint) : null;
    const l = b ? b.impact - b.flash : NaN;
    if (Number.isFinite(l) && l > 0 && l < 2) return l;
    if (T && T.flashLead !== undefined) {
      const v = T.flashLead;
      return Array.isArray(v) ? fin(v[Math.min(v.length, Math.max(1, fin(d.phase, 1))) - 1], 0.3) : fin(v, 0.3);
    }
    return fin(WYRM.flashLead, 0.35);
  }

  _answer(mode) {
    const p = this.p, d = this.d;
    if (!p || !d) return;
    const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    switch (mode) {
      case 'parry':
      case 'perfect':
      case 'plain':
        this.holds.delete('@block');
        this._key('@block', false);
        this.tap('@block', 0.05);
        break;
      case 'dodge':
      case 'roll':
        // across his line (axis y = north = −z)
        this._axis(-dz / l, -dx / l);
        this.tap('Space');
        this.later(0.3, () => this._axis(0, 0));
        break;
      case 'mikiri':
        this._axis(dx / l, -dz / l);
        this.tap('Space');
        this.later(0.3, () => this._axis(0, 0));
        break;
      case 'trade':
        this.tap('@attack');
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- inputs (the input's virtual keys)
  _key(code, down) {
    const inp = this.game.input;
    if (!inp) return;
    if (typeof inp.setVirtual === 'function') {
      inp.setVirtual(code, down);
      return;
    }
    // (the sims' input mock)
    const b = code === 'Mouse0' ? 0 : code === 'Mouse1' ? 1 : code === 'Mouse2' ? 2 : -1;
    if (b >= 0) {
      if (down) inp.press?.(b);
      else inp.up?.(b);
    } else if (down) inp.hold?.(code);
    else inp.release?.(code);
  }

  _axis(x, y) {
    const inp = this.game.input;
    if (!inp) return;
    if (typeof inp.setVirtualAxis === 'function') inp.setVirtualAxis(x, y);
    else inp.axis = { x, y };
  }

  /** Press `code` for `secs` game s (a tap: about two frames). */
  tap(code, secs = 0.03) {
    this.hold(code, secs);
  }

  hold(code, secs) {
    this._key(code, true);
    this.holds.set(code, this.game.time + Math.max(0.016, fin(secs, 0.03)));
  }

  _releaseDue() {
    const now = this.game.time;
    for (const [code, until] of this.holds) {
      if (now >= until) {
        this.holds.delete(code);
        this._key(code, false);
      }
    }
  }

  _release() {
    for (const code of this.holds.keys()) this._key(code, false);
    this.holds.clear();
    this.pending.length = 0;
    this.timers.length = 0;
    this._axis(0, 0);
  }

  /** Call `fn` in `secs` game s. */
  later(secs, fn) {
    this.timers.push({ at: this.game.time + Math.max(0, fin(secs, 0)), fn });
  }

  /** `n` times, every `gap` s from phase time `from`. */
  everyFrom(from, gap, n, fn, key = 'ef') {
    if (this.t < from) return;
    this.every(gap, n, fn, key, from);
  }

  /** Once, when this phase's clock passes `t` (s). */
  at(t, fn, key = `at${t}`) {
    if (this.t < t || this.marks.has(key)) return;
    this.marks.add(key);
    fn();
  }

  /** `n` times, every `gap` s from the start of the phase (or phase time `from`). */
  every(gap, n, fn, key = 'every', from = 0) {
    const k = Math.floor((this.t - from) / gap);
    if (k >= n) return;
    const mk = `${key}${k}`;
    if (this.marks.has(mk)) return;
    this.marks.add(mk);
    fn();
  }
}
