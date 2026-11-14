import { createThroneHall, HALL } from '../world/throneHall.js';
import { StarlessLord } from '../entities/enemies/starlessLord/lord.js';

// The Obsidian Throne: a black hall lit red, and the Starless Lord who fell out of the night sky and
// took its throne (COMBAT.md → "The Starless Lord"). The seal inlaid in the floor is the origin: the
// duel's centre. The bonfire waits outside, at the foot of the path to the door in the south wall.
const H = HALL;

export const STARLESS = Object.freeze({
  id: 'starless',
  aliases: ['lord', 'throne', 'hall', 'void'],
  name: 'The Obsidian Throne',
  sub: 'where the starless lord waits',
  world: Object.freeze({
    arenaRadius: 16,
    playerBound: 40, // round the seal: the hall, the path and the bonfire landing
    dragonBound: 20, // (the lord keeps to the hall's rectangle himself: tuning.js `hall`)
    bonfire: { x: H.bonfire.x, z: H.bonfire.z },
    playerSpawn: { x: H.bonfire.x + 0.6, z: H.bonfire.z - 1.7 },
    dragonSleep: { x: H.throne.x, z: H.throne.z + 0.5, yaw: 0 }, // on the throne, facing the door
    bossTriggerZ: H.zS - 0.8, // through the door
    wakeRadius: 10,
  }),
  buildSet: createThroneHall,
  createBoss: (game) => new StarlessLord(game),
  text: Object.freeze({
    arrive: ['A black hall stands where a star fell. Red light bleeds from its door.', 'Rest at the bonfire to restore your flasks.'],
    stir: 'On the throne, a helm lifts…',
    phase2: 'A SECOND BLADE IGNITES',
    phase3: 'THE BLADES JOIN',
    phase4: 'THE VOID ANSWERS HIM',
    victory: 'THE STARLESS LORD FALLS',
    fallen: 'The red light gutters out. The throne is empty.',
    restReset: 'The lord returns to his throne.',
    again: 'The lord sits once more. The hall waits.',
    rise: 'You rise again at the bonfire.',
  }),
});
