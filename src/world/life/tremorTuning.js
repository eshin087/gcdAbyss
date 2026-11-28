// THE TREMOR's numbers (tremor.js): what stands near a heavy blow shakes. One block per level id; a
// level without one gets DEFAULT. Powers are on the POWER scale (0.3 a light blow, 1 a heavy one, 2 the
// biggest); radii in metres; counts at life.quality 1 (x quality on the phone) and life.k 1.
//
//   min       a blow under this power shakes nothing (a light cut, a step)
//   reach     how far the shake goes: r_blow x r + k x power^pow, at most max (m). At the distance d the
//             shake's strength is power x (1 - d / reach)^fall
//   merge     a blow within `r` m and `t` s of a shake at least `k` as strong is the same blow (a heavy
//             move calls world.impact AND world.groundBlow; a beam calls impact every 0.2 s)
//   gap       s: the least time between two shakes anywhere (a rain of blows is one long tremor)
//   tree      what has leaves / boughs: { min strength to answer, amp: its shudder (rad per strength,
//             at most cap; destructibles.shudder), leaves per strength (litter.showerAt; 0: none),
//             most a tree drops, most a blow drops in all, kind: the litter kind that falls (index) }
//   bamboo    the Grove's canes: the same, a quicker, smaller shiver
//   stone     what stands of stone and is tall (h >= minH): a sift of dust off its top (letters per
//             strength, most per piece / per blow; each its own start speed `fall` and pull `gravity`
//             (m/s, m/s2: a trickle, not a sheet), at most `life` s), and a faint puff
//             of letters at its foot (per strength); colour and alpha (faint)
//   hang      what hangs (banners, charms, a rope): a swing kick (rad per power, at most cap) through
//             hang.js hangKick, out to `reach` x the shake's reach (at least `min` m; it falls off as
//             (1 - d / that)^2: cloth is lighter than a tree); it rings down over HANG.kick
//   floor     pebbles hop: grit letters jumping off the floor near the blow (per strength at its centre,
//             most per blow, in a ring from `in` x r_blow to `out` x reach; up m/s; colour, alpha)
//   gust      a blow this strong flattens the grass outward (world.gust) when no gust of its own was made
//             there (the dragon's moves make one; most duelists' blows do not): strength per power, radius x reach
//   fire      the bonfire gutters: strength at least `min` within the reach (atmosphere.gutter)
//   glyph     the letters (house letter: LetterBatch)

const DEFAULT = {
  min: 0.7,
  reach: { r: 1, k: 3, pow: 2, max: 30, fall: 1.2 },
  merge: { r: 2.5, t: 0.25, k: 0.9 },
  gap: 0.08,
  tree: { min: 0.15, amp: 0.05, cap: 0.06, leaves: 14, most: 20, total: 50, kind: 0, crown: [0.55, 1] },
  bamboo: { min: 0.15, amp: 0.07, cap: 0.08, leaves: 2, most: 3, total: 14, kind: 0, crown: [0.6, 1] },
  stone: {
    minH: 1.4, min: 0.15, per: 18, most: 30, total: 110, fall: [0.02, 0.5], gravity: [0.7, 3.6], life: [1.6, 3], spread: 0.9,
    puff: 12, puffLife: [1.0, 1.7], puffOut: [0.25, 0.6],
    color: [0.52, 0.5, 0.46], alpha: 0.46, puffAlpha: 0.32,
  },
  hang: { amp: 0.4, cap: 0.55, reach: 2, min: 8 },
  floor: { min: 0.95, per: 22, most: 34, in: 0.7, out: 0.55, up: [1.2, 2.1], color: [0.46, 0.42, 0.37], alpha: 0.62, rest: [0.25, 0.6] },
  gust: { min: 1, k: 0.9, cap: 1.6, rK: 0.9 },
  fire: { min: 0.25 },
  glyph: { dust: ".,'`.:.", grit: ".,:o'.;" },
};

const level = (o = {}) => Object.freeze({ ...DEFAULT, ...o });

export const TREMOR_TUNING = Object.freeze({
  DEFAULT: level(),
  // oaks and pines: green leaves rain off the crowns
  cinderwood: level(),
  // the burned sect: dead trees (no leaves: ash would fall), pale ash-grey dust off the pillars, grey grit
  ash: level({
    tree: { ...DEFAULT.tree, leaves: 0 },
    stone: { ...DEFAULT.stone, color: [0.5, 0.49, 0.47] },
    floor: { ...DEFAULT.floor, color: [0.42, 0.41, 0.39] },
  }),
  // obsidian: dark red-black dust, the cinders' grit
  starless: level({
    tree: { ...DEFAULT.tree, leaves: 0 },
    stone: { ...DEFAULT.stone, color: [0.32, 0.22, 0.2], alpha: 0.3 },
    floor: { ...DEFAULT.floor, color: [0.34, 0.16, 0.1] },
  }),
  // the badlands: ochre dust, the dead trees drop nothing
  ring: level({
    tree: { ...DEFAULT.tree, leaves: 0 },
    stone: { ...DEFAULT.stone, color: [0.52, 0.45, 0.34] },
    floor: { ...DEFAULT.floor, color: [0.5, 0.42, 0.3] },
  }),
  // the hill shrine: dead trees, a few dry leaves (litter kind 0) off them
  fox: level({
    tree: { ...DEFAULT.tree, leaves: 4, most: 6, total: 18 },
    stone: { ...DEFAULT.stone, color: [0.44, 0.42, 0.4] },
  }),
  // the grove: the canes shiver and a few leaves drop straight down
  // (no gust of the tremor's own: the leaves the canes drop fall straight, and the clearing is earth)
  veil: level({
    tree: { ...DEFAULT.tree, leaves: 0 },
    stone: { ...DEFAULT.stone, color: [0.46, 0.46, 0.47] },
    floor: { ...DEFAULT.floor, color: [0.4, 0.4, 0.41] },
  }),
  // the Last Foundry: no trees; scale and rust dust shaken off the steel, slag grit on the plates
  foundry: level({
    tree: { ...DEFAULT.tree, leaves: 0 },
    stone: { ...DEFAULT.stone, color: [0.45, 0.4, 0.36] },
    floor: { ...DEFAULT.floor, color: [0.42, 0.38, 0.35] },
  }),
  grove: level({
    gust: { ...DEFAULT.gust, min: 99 },
    stone: { ...DEFAULT.stone, color: [0.4, 0.42, 0.38] },
    floor: { ...DEFAULT.floor, color: [0.34, 0.33, 0.27] },
  }),
  // (code, city: the defaults; no living-world tuning of their own yet)
});

export const tremorTuning = (id) => TREMOR_TUNING[id] ?? TREMOR_TUNING.DEFAULT;
