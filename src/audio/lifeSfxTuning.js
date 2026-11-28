// THE LIVING WORLD'S SOUNDS: their numbers (audio/lifeSfx.js plays them; the layers in world/life/ call
// them through `lifeSay`, lifeSfx.js). Content is data: every gain, length, band and per-level choice is
// here. Taste: synthesized only, quiet, never pretty, far under the fight. When unsure: quieter, shorter.
//
// Gains are linear peaks of a recipe's layers BEFORE the voice's gain (`gain` below x the call's own) and
// the sfx bus. For scale, the hero's footstep is a 0.1 noise burst plus a 0.14 rumble (sfx.js footstep)
// and the light swing a 0.6 band of white noise: tests/integration/life/air.mjs and the audition page
// (scratchpad auditions/life.html) measure them side by side. Nothing here may be louder than a footstep at
// the same distance, except a flock's burst and a tree's creak, which may reach it.
//
//   sound      { gain (the voice's), gap (s between two of that name anywhere: audio.play), falloff
//              (<1 carries further), rev (reverb send), prio (0 the lowest: voices stolen first), and the
//              recipe's own numbers }
//   say        the callers' limits (lifeSay): { gap: s between two of that name on one level, most: at
//              most this many in one call site's burst (a blow that shakes twelve trees) }
//   fight      a sound while the boss is up: gain x (1 - fight x (1 - life.calm) / (1 - LIFE_TUNE.fightCalm))
//   levels     per level id: { off: [names never heard there], gain: { name: x }, birds: the flock's
//              kind, ground: the pebbles' kind, tree: the shudder's kind }. A level without a block: DEFAULT.

const DEFAULT_LEVEL = Object.freeze({ off: Object.freeze([]), gain: Object.freeze({}), birds: 'small', ground: 'stone', tree: 'leaf' });
const lv = (o) => Object.freeze({ ...DEFAULT_LEVEL, ...o, off: Object.freeze(o.off ?? []), gain: Object.freeze(o.gain ?? {}) });

export const LIFE_SFX_TUNE = Object.freeze({
  /** a sound while the boss is up is this much quieter at the fight's full calm (life.calm 0.4) */
  fight: 0.3,

  sound: Object.freeze({
    /** twenty to forty birds taking off: a rising flutter of soft wing claps over ~1.2 s, by o.n and
     *  o.kind. band: the claps' two noise bands (Hz); beat: wing beats a second; beats: claps a bird
     *  makes leaving; clap: [attack, decay] time constants (s); amp: a clap's peak at n 20; body: the low
     *  swell of all of them; wash: the air they move (a band that rises); spread: s over which they go */
    flockBurst: Object.freeze({
      gain: 1, gap: 0.6, falloff: 0.65, rev: 0.16, prio: 1,
      kinds: Object.freeze({
        small: Object.freeze({ noise: 'pink', band: Object.freeze([620, 1350]), q: 0.9, beat: 7, beats: Object.freeze([2, 4]), clap: Object.freeze([0.0025, 0.016]), amp: 0.06, body: 0.034, bodyHz: 380, wash: 0.021, washHz: Object.freeze([500, 1500]), spread: 1.1 }),
        crow: Object.freeze({ noise: 'brown', band: Object.freeze([330, 700]), q: 0.8, beat: 4.4, beats: Object.freeze([2, 3]), clap: Object.freeze([0.004, 0.035]), amp: 0.1, body: 0.035, bodyHz: 260, wash: 0.012, washHz: Object.freeze([320, 900]), spread: 1.3 }),
        pigeon: Object.freeze({ noise: 'white', band: Object.freeze([900, 2100]), q: 1.1, beat: 8.5, beats: Object.freeze([3, 6]), clap: Object.freeze([0.0012, 0.01]), amp: 0.07, body: 0.035, bodyHz: 420, wash: 0.025, washHz: Object.freeze([650, 1800]), spread: 1 }),
      }),
    }),
    /** an animal bolting, by o.kind (FAUNA_TUNE.kinds): a rabbit's quick grass rustle (hops), a deer's
     *  few hoof thuds (bounds), a rat's scratch-skitter, a lizard's ticks on stone, the fox's one soft rustle */
    animalBolt: Object.freeze({
      gain: 1, gap: 0.12, falloff: 0.9, rev: 0.06, prio: 0,
      rabbit: Object.freeze({ hops: Object.freeze([2, 3]), every: Object.freeze([0.3, 0.42]), band: Object.freeze([1300, 2300]), amp: 0.06, decay: Object.freeze([0.05, 0.08]), thump: 0.035 }),
      deer: Object.freeze({ bounds: Object.freeze([2, 3]), every: Object.freeze([0.52, 0.64]), pair: Object.freeze([0.05, 0.09]), hoof: 0.034, hoofHz: Object.freeze([85, 110]), brush: 0.02 }),
      rat: Object.freeze({ len: Object.freeze([0.32, 0.48]), rate: Object.freeze([26, 40]), band: Object.freeze([3200, 5200]), amp: 0.05, scrape: 0.012 }),
      lizard: Object.freeze({ bursts: Object.freeze([2, 3]), len: Object.freeze([0.12, 0.24]), rest: Object.freeze([0.16, 0.34]), rate: Object.freeze([14, 20]), band: Object.freeze([4200, 6200]), amp: 0.06 }),
      fox: Object.freeze({ band: Object.freeze([950, 1400]), amp: 0.05, decay: Object.freeze([0.16, 0.22]) }),
    }),
    /** a tree shudders under a blow that does not break it (o.k: the shake's strength there, 0..2; o.kind):
     *  leaf: its leaves shake (a band that flutters); dead: dry twigs rattle; cane: the bamboo's faintest
     *  shiver */
    treeShudder: Object.freeze({
      gain: 1, gap: 0, falloff: 0.85, rev: 0.1, prio: 0,
      leaf: Object.freeze({ band: 2900, q: 0.6, amp: 0.036, len: Object.freeze([0.32, 0.6]), rate: Object.freeze([13, 21]), tick: 0.012, knock: 0.025 }),
      dead: Object.freeze({ band: 2100, q: 2.6, amp: 0.04, len: Object.freeze([0.22, 0.4]), rate: Object.freeze([11, 17]), tick: 0, knock: 0.03 }),
      cane: Object.freeze({ band: 5200, q: 0.8, amp: 0.035, len: Object.freeze([0.18, 0.3]), rate: Object.freeze([16, 24]), tick: 0, knock: 0 }),
    }),
    /** a tree leans to its fall (the last stage of its wear): a slow wooden groan, stick-slip pulses
     *  (`rate` a second, sliding) through two wood formants, a crackle of fibres at the end. o.k 0.5..1.5 */
    treeCreak: Object.freeze({
      gain: 1, gap: 0.5, falloff: 0.7, rev: 0.2, prio: 1,
      len: Object.freeze([0.95, 1.35]), rate: Object.freeze([30, 46]), f1: Object.freeze([300, 440]), f2: Object.freeze([850, 1150]), amp: 0.058, body: 0.026, fibres: 0.01,
    }),
    /** dust sifting off stone: a faint fine patter of grains, thinning (o.k 0..2) */
    dustSift: Object.freeze({
      gain: 1, gap: 0.35, falloff: 0.9, rev: 0.08, prio: 0,
      len: Object.freeze([0.6, 1]), grains: Object.freeze([26, 46]), hp: 4800, amp: 0.035, hiss: 0.004,
    }),
    /** pebbles hopping off the floor: a few small clicks scattering, each a second smaller bounce (o.k
     *  0..2). By the level's ground: stone (a tick), glass (obsidian: higher, a faint ring), sand (softer, no
     *  ring), earth (duller) */
    pebbles: Object.freeze({
      gain: 1, gap: 0.2, falloff: 0.9, rev: 0.06, prio: 0,
      count: Object.freeze([4, 10]), first: Object.freeze([0.1, 0.34]), bounce: Object.freeze([0.07, 0.15]), amp: 0.05,
      stone: Object.freeze({ band: Object.freeze([2600, 4600]), q: 4, ring: 0.008, ringHz: 0.85, noise: 'white' }),
      glass: Object.freeze({ band: Object.freeze([4200, 6600]), q: 6, ring: 0.014, ringHz: 0.9, noise: 'white' }),
      sand: Object.freeze({ band: Object.freeze([1800, 3200]), q: 1.6, ring: 0, ringHz: 1, noise: 'pink' }),
      earth: Object.freeze({ band: Object.freeze([1200, 2200]), q: 2, ring: 0, ringHz: 1, noise: 'pink' }),
    }),
    /** leaves lying on the ground thrown by a blow (litter.scatter): a few dry ticks and a brush */
    leafSkitter: Object.freeze({
      gain: 1, gap: 0.5, falloff: 0.9, rev: 0.05, prio: 0,
      ticks: Object.freeze([4, 8]), len: 0.26, band: Object.freeze([3800, 6000]), amp: 0.022, brush: 0.022,
    }),
    /** a lantern / brazier catches (the LAMPS agent calls it): a soft whump and a short crackle (o.k 0..1) */
    lampCatch: Object.freeze({
      gain: 1, gap: 0.15, falloff: 0.85, rev: 0.12, prio: 0,
      whump: 0.036, sub: 0.012, crackle: 0.02, crackles: Object.freeze([6, 10]),
    }),
    /** a flame fluttering under a shockwave (o.k 0..1) */
    lampGutter: Object.freeze({
      gain: 1, gap: 0.25, falloff: 0.85, rev: 0.08, prio: 0,
      len: Object.freeze([0.45, 0.75]), amp: 0.033, every: Object.freeze([0.035, 0.08]),
    }),
    /** a flame dying (knocked over, blown out): a short dying hiss and a click of cooling stone */
    lampOut: Object.freeze({
      gain: 1, gap: 0.2, falloff: 0.85, rev: 0.1, prio: 0,
      hiss: 0.035, puff: 0.03, click: 0.025, ring: 0.006,
    }),
  }),

  say: Object.freeze({
    flockBurst: Object.freeze({ gap: 1, most: 1 }),
    animalBolt: Object.freeze({ gap: 0.15, most: 1 }),
    treeShudder: Object.freeze({ gap: 0.3, most: 2 }),
    treeCreak: Object.freeze({ gap: 0.8, most: 1 }),
    dustSift: Object.freeze({ gap: 0.5, most: 1 }),
    pebbles: Object.freeze({ gap: 0.25, most: 1 }),
    leafSkitter: Object.freeze({ gap: 0.6, most: 1 }),
    lampCatch: Object.freeze({ gap: 0.15, most: 2 }),
    lampGutter: Object.freeze({ gap: 0.25, most: 2 }),
    lampOut: Object.freeze({ gap: 0.2, most: 2 }),
  }),

  /** the tremor's calls: a shudder needs this strength at the tree; the second one this many trees
   *  shaking, and plays `second` s later, `k2` as strong; the creak: a tree that leans (wear 3); the
   *  stone's dust: the strongest stone that sifted; pebbles: the floor's hop (power >= floor.min) */
  tremor: Object.freeze({ shudderMin: 0.2, secondAt: 3, second: Object.freeze([0.05, 0.14]), k2: 0.7, creakK: 1 }),
  /** the litter's skitter: only when at least this many leaves were thrown */
  skitterMin: 6,

  levels: Object.freeze({
    DEFAULT: DEFAULT_LEVEL,
    cinderwood: lv({ birds: 'small', ground: 'earth', tree: 'leaf' }),
    // the burned sect: crows off the ruins, rats on the stones, dead trees (twigs), stone grit
    ash: lv({ off: ['leafSkitter'], birds: 'crow', ground: 'stone', tree: 'dead' }),
    // the crater: nothing alive; obsidian grit rings faintly
    starless: lv({ off: ['flockBurst', 'animalBolt', 'treeShudder', 'leafSkitter'], ground: 'glass', tree: 'dead' }),
    // the badlands: lizards on clay, sand-grit
    ring: lv({ off: ['flockBurst', 'leafSkitter'], ground: 'sand', tree: 'dead' }),
    // the hill shrine: small birds on the dead trees, the fox
    fox: lv({ birds: 'small', ground: 'stone', tree: 'dead' }),
    // the grove holds its breath: the bamboo's faintest shiver and the lanterns, nothing else
    grove: lv({ off: ['flockBurst', 'animalBolt', 'treeCreak', 'dustSift', 'pebbles', 'leafSkitter'], tree: 'cane', gain: { lampCatch: 0.6, lampGutter: 0.6, lampOut: 0.6 } }),
    // Halcyon Plaza: pigeons, stone
    city: lv({ birds: 'pigeon', ground: 'stone', tree: 'dead' }),
    // the Veiled Crossing: no birds, no animals, no leaves, no trees; stone, metal and grit
    veil: lv({ off: ['flockBurst', 'animalBolt', 'leafSkitter', 'treeCreak', 'treeShudder'], ground: 'stone', tree: 'dead' }),
    // the Last Foundry: no birds, no animals, no leaves, no trees; steel plate and slag grit
    foundry: lv({ off: ['flockBurst', 'animalBolt', 'leafSkitter', 'treeCreak', 'treeShudder'], ground: 'stone', tree: 'dead' }),
    // the Hall of Falling Script: indoors, nothing alive
    code: lv({ off: ['flockBurst', 'animalBolt', 'leafSkitter'], ground: 'stone', tree: 'dead' }),
  }),
});

/** A level's sound block. */
export const lifeSfxLevel = (id) => LIFE_SFX_TUNE.levels[id] ?? LIFE_SFX_TUNE.levels.DEFAULT;

/** How loud `name` is heard on level `id` (0: never there). */
export function lifeHeard(id, name) {
  const L = lifeSfxLevel(id);
  if (L.off.includes(name)) return 0;
  const g = L.gain[name];
  return typeof g === 'number' && Number.isFinite(g) ? Math.max(0, g) : 1;
}
