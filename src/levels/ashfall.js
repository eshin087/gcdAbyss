import { createCourtyard, COURTYARD } from '../world/courtyard.js';
import { AshDisciple } from '../entities/enemies/ashDisciple/disciple.js';

// The Ashfall Courtyard: the ruins of a sword sect, and the Ash Disciple who still keeps its vigil
// (docs/specs/ash-disciple.md). The courtyard's paving is centred on the origin; the bonfire waits
// at the foot of the path to the south.
const C = COURTYARD;

export const ASHFALL = Object.freeze({
  id: 'ash',
  aliases: ['ashfall', 'disciple', 'courtyard'],
  name: 'Ashfall Courtyard',
  sub: 'where the last disciple keeps his vigil',
  world: Object.freeze({
    arenaRadius: C.half,
    playerBound: 40, // round the origin: the courtyard, the path and the bonfire landing
    dragonBound: C.half - 1.8, // the disciple stays inside the ring of pillars
    bonfire: { x: C.bonfire.x, z: C.bonfire.z },
    playerSpawn: { x: C.bonfire.x + 0.6, z: C.bonfire.z - 1.7 },
    dragonSleep: { x: 0, z: -3, yaw: 0 }, // kneeling in the courtyard, facing the gate
    bossTriggerZ: C.gateZ - 0.6, // through the gate
    wakeRadius: 9,
  }),
  buildSet: createCourtyard,
  createBoss: (game) => new AshDisciple(game),
  text: Object.freeze({
    arrive: ['Ash falls without end on the ruined sect. Above the steps, someone kneels in the courtyard.', 'Rest at the bonfire to restore your flasks.'],
    stir: 'The kneeling figure lifts his head…',
    phase2: 'THE ASH KINDLES',
    phase3: null,
    victory: 'DISCIPLE DEFEATED',
    fallen: 'The ash settles. The courtyard is silent.',
    restReset: 'The disciple returns to his vigil.',
    again: 'The disciple kneels once more. The courtyard waits.',
    rise: 'You rise again at the bonfire.',
  }),
});
