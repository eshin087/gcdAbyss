import { createForest } from '../world/forest.js';
import { Dragon } from '../entities/dragon/dragon.js';

// Cinderwood Hollow: the moonlit forest clearing and the Cinder Wyrm (the v0.1 vertical slice).
// CONFIG.world's defaults are this level's layout, so it overrides nothing.
export const CINDERWOOD = Object.freeze({
  id: 'cinderwood',
  aliases: ['wyrm', 'forest', 'hollow'],
  name: 'Cinderwood Hollow',
  sub: 'where the cinder wyrm sleeps',
  world: null,
  buildSet: createForest,
  createBoss: (game) => new Dragon(game),
  text: Object.freeze({
    arrive: ['Ash drifts through the hollow. Something vast sleeps among the bones to the north.', 'Rest at the bonfire to restore your flasks.'],
    stir: 'The ground trembles…',
    phase2: "THE CINDER WYRM'S FURY IGNITES",
    phase3: 'ITS HEART BURNS WHITE-HOT',
    victory: 'WYRM VANQUISHED',
    fallen: 'The cinders cool. Cinderwood Hollow falls silent.',
    restReset: 'The wyrm returns to its slumber.',
    again: 'The wyrm sleeps once more. The hollow waits.',
    rise: 'You rise again at the bonfire.',
  }),
});
