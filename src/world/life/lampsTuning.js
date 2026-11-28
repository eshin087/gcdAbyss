// THE LAMPS' numbers (lamps.js): the levels' stone lanterns kindle as the fight heats up, gutter under a
// blow's shock, go dark when the piece that holds them breaks or falls. One block per level id; a level
// without one gets DEFAULT (a level with no lanterns has nothing to light: Cinderwood, the Hall of
// Falling Script, Halcyon Plaza's lamp posts are electric neon, not lamps). Radii in m, times in s,
// counts at life.quality 1.
//
//   kind      the flame's kind in the fire field ('fire' orange; 'void' prints in the level's own swap of
//             that slot: the Foxfire Terrace's pale foxfire)
//   start     how many burn when the visit starts (the place is inhabited), the nearest the way in
//             (the hero's spawn) first
//   fight     how many more catch as the fight starts (game state 'boss')
//   phase     [n]: how many more catch as the boss's phase n starts (dragon:phase / phase2..4); 99 = all
//             that still stand. The nearest the boss catch first, one after another (`stagger` s apart:
//             the fight's heat reaching them)
//   ignite    fire landing within `r` m (of the fire's own disc) lights a dark one at once, catching in
//             `kindle` s (life.ignite)
//   kindle    s for a flicker to catch into a steady flame (its glow stutters on the way: `stutter`)
//   flame     the steady flame in the lamp's window: heat blobs a second (x quality), their size, heat,
//             life, rise (m/s) and spread (x the window's half width); `toCam`: m toward the camera they
//             are drawn (the fire field's soft depth test: inside the stone box they would not print; moved
//             along the view ray they print on the same spot)
//   light     the warm light round a lit lamp (game.lights, a LOW light: it takes only the slots the
//             fight leaves free and fades in and out of them): at most `max` lamps hold one at once, the
//             nearest the camera's focus within `reach` m; `fade` s to come and go (`out`: s it dies in
//             when its flame goes out); colour, intensity,
//             radius, flicker (`colorVoid`: the colour when the flame burns in the 'void' slot)
//   gutter    a blow's shock (life.impact): its strength at a lamp d m off is power x (1 - d / reach)^fall,
//             reach = r_blow x r + k x power^pow (at most max). From `min` the flame dips and leans away
//             (`lean` m/s at full), shrinks, its light dims by `dim`; it settles (x e^(-t / tau), less `drop` a
//             second: a full gutter in ~0.8 s).
//             `sound`: s between two gutter sounds of one lamp
//   out       the piece broke, fell or was taken: the flame dies in a puff of smoke (fire-field smoke
//             blobs: `puff`, their life and size) and a last lick of `flare` small fire blobs; it never
//             relights in that fight
//   brazier   the Skybreak Ring's braziers (their flames and lights are the Ring's own ambience): the
//             gutter's strength there x `k`

const DEFAULT = {
  kind: 'fire',
  start: 1,
  fight: 1,
  phase: [0, 0, 2, 2, 99],
  stagger: [0.35, 1.0],
  ignite: { r: 3, kindle: 0.45 },
  kindle: { sec: 1.1, stutter: 0.55 },
  flame: { rate: 14, size: [0.42, 0.52], heat: [0.78, 0.98], life: [0.28, 0.4], rise: [0.04, 0.14], spread: 0.55, toCam: 0.9 },
  light: { max: 3, reach: 26, fade: 0.5, out: 0.35, color: [1.0, 0.52, 0.2], colorVoid: [0.42, 0.6, 1.0], intensity: 2, radius: 5, flicker: 0.45 },
  gutter: { min: 0.15, power: 0.25, reach: { r: 1, k: 3, pow: 2, max: 16, fall: 1.2 }, k: 0.85, lean: 1.4, dim: 0.6, tau: 0.25, drop: 0.12, sound: 0.5 },
  out: { puff: 4, puffLife: [1.1, 1.7], puffSize: [0.35, 1.1], flare: 2 },
  brazier: { k: 0.8 },
};

const level = (o = {}) => Object.freeze({ ...DEFAULT, ...o });

export const LAMPS_TUNING = Object.freeze({
  DEFAULT: level(),
  // the burned sect: one lantern still burns by the gate as he waits; one more as the duel begins, one
  // at his second phase, the last at his third (the courtyard's pool holds only the bonfire's light:
  // all four can hold a light)
  ash: level({ start: 1, fight: 1, phase: [0, 0, 1, 99], light: { ...DEFAULT.light, max: 4 } }),
  // the hill shrine: the two by the steps burn as he climbs; two more as the fight starts, three at the
  // second phase, the whole ring at the third. Ten lanterns: three lights (his third phase's Pearls and
  // foxfire fill the pool: the lanterns' lights give way and fade)
  fox: level({ start: 2, fight: 2, phase: [0, 0, 3, 99], light: { ...DEFAULT.light, max: 3 } }),
  // the Windless Grove: stillness. Nothing burns until the fight is half done: both catch at once at his
  // second phase (or when fire reaches them)
  grove: level({ start: 0, fight: 0, phase: [0, 0, 99], light: { ...DEFAULT.light, max: 2 } }),
  // the Obsidian Throne (lanterns only round the crater under ?outskirts=a | m): dark until he rises;
  // the pool already holds six lights of the hall's, so two at most
  starless: level({ start: 0, fight: 1, phase: [0, 0, 2, 2, 99], light: { ...DEFAULT.light, max: 2 } }),
  // the Skybreak Ring: no lanterns; its four braziers burn from the start (the ambience's): they gutter
  ring: level({ start: 0, fight: 0, phase: [0, 0, 0, 0, 0] }),
  // the Veiled Crossing: the three lamp posts that still stand straight burn from the start, a cold
  // white (steel: the fire slot is his Crimson Cast's in this fight); nothing else to light. Their
  // lights are cold and small
  veil: level({ kind: 'steel', start: 3, fight: 0, phase: [0, 0, 0, 0], flame: { ...DEFAULT.flame, rate: 10, heat: [0.6, 0.78] }, light: { ...DEFAULT.light, max: 2, color: [0.6, 0.66, 0.8], colorVoid: [0.6, 0.66, 0.8], intensity: 1.4, radius: 6 } }),
  // the Last Foundry: no lanterns; its light is the furnace's, the pour's and his phase's (the set's ambience)
  foundry: level({ start: 0, fight: 0, phase: [0, 0, 0, 0, 0] }),
});

export const lampsTuning = (id) => LAMPS_TUNING[id] ?? LAMPS_TUNING.DEFAULT;
