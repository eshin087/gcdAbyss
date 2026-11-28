import { createLastFoundry, FOUNDRY } from '../world/lastFoundry.js';
import { FalseSaint } from '../entities/enemies/falseSaint/saint.js';
import { TUNING as BOSS_TUNING } from '../entities/enemies/falseSaint/tuning.js';

// The Last Foundry: a steel mill at the end of a war with the machines, at night, still running with no
// one left to feed it, and Anselm, the False Saint, who kneels at the edge of the pour as if in prayer.
// The casting floor is centred on the origin; the bonfire waits in the south. No reward yet (the owner has
// not chosen one).
const F = FOUNDRY;

export const FOUNDRY_LEVEL = Object.freeze({
  id: 'foundry',
  aliases: ['saint', 'falsesaint', 'anselm', 'mill', 'machine'],
  name: 'The Last Foundry',
  sub: 'a mill that outlived the war, and the patient thing that tends it',
  boss: BOSS_TUNING.name, // the boss's full name (the title's world list; the HUD reads the boss's own)
  world: Object.freeze({
    arenaRadius: F.half,
    playerBound: F.bound,
    dragonBound: F.floor.r,
    bonfire: { x: F.bonfire.x, z: F.bonfire.z },
    playerSpawn: { x: F.bonfire.x + 0.6, z: F.bonfire.z - 1.7 },
    dragonSleep: { x: F.wait.x, z: F.wait.z, yaw: F.wait.yaw },
    bossTriggerZ: F.entryZ - 0.6, // onto the casting floor
    wakeRadius: 9,
  }),
  buildSet: createLastFoundry,
  createBoss: (game) => new FalseSaint(game),
  text: Object.freeze({
    arrive: ['The stair ends on a casting floor. The furnaces are still lit; no one is left to feed them. A man kneels at the edge of the pour, as if in prayer.', 'Rest at the bonfire to restore your flasks.'],
    stir: 'The kneeling man stands, and turns a calm face toward you…',
    phase2: 'THE SKIN BREAKS',
    phase3: 'WEAPONS FREE',
    phase4: 'TRUE FRAME',
    victory: 'THE FALSE SAINT FALLS',
    fallen: 'The sensors go out, one by one. The furnaces burn on.',
    restReset: 'He kneels at the edge of the pour again, whole, as if nothing had touched him.',
    again: 'He was built to be patient.',
    rise: 'You rise again at the bonfire.',
  }),
});
