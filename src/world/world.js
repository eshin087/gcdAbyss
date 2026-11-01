import { CONFIG } from '../core/config.js';
import { MAX_PUSH } from '../render/shaderLib.js';
import { Colliders } from './colliders.js';
import { createGround } from './ground.js';
import { createForest } from './forest.js';
import { createGrass, meadowDensity, meadowHeight } from './grass.js';
import { Scorch } from './scorch.js';
import { Atmosphere } from './atmosphere.js';

// Owns the static environment and the shared environment-interaction APIs:
//   world.resolve(pos, radius, bound)       circle collision vs stones/trunks + arena bound
//   world.setPusher(slot, x, y, z, radius)  grass trample (slot 0 = player, 1..9 = dragon)
//   world.gust(x, z, strength, radius)      radial wind impulse (wing beats, landings)
//   world.scorch.burnCircle(x, z, r, burn, heat)
export const PUSHER_SLOTS = MAX_PUSH;

export class World {
  constructor(game) {
    this.game = game;
    const U = game.U;
    this.colliders = new Colliders();
    this.ground = createGround(U);
    game.scene.add(this.ground);
    this.forest = createForest(U, this.colliders);
    game.scene.add(this.forest.group);
    this.scorch = new Scorch(U, game);
    const extent = 150;
    const density = meadowDensity(this.colliders, this.forest.treeSpots, this.forest.bare, extent);
    const q = CONFIG.quality[CONFIG.quality.length - 1];
    this.grass = createGrass(U, { count: q.grass, extent, density, height: meadowHeight });
    game.scene.add(this.grass.mesh);
    this.atmosphere = new Atmosphere(game, this.forest);
    this.bonfire = this.forest.bonfire;
    this.nest = this.forest.nest;
    this._gust = { x: 0, z: 0, strength: 0, radius: 1 };
  }

  resolve(pos, radius, bound = Infinity) {
    return this.colliders.resolve(pos, radius, bound);
  }

  setPusher(slot, x, y, z, radius) {
    const p = this.game.U.uPushers.value[slot];
    if (p) p.set(x, y, z, radius);
  }

  clearPushers(from = 0, to = PUSHER_SLOTS) {
    for (let i = from; i < to; i++) this.game.U.uPushers.value[i].set(0, 0, 0, 0);
  }

  gust(x, z, strength = 1, radius = 12) {
    // keep the strongest recent gust
    if (strength >= this._gust.strength * 0.6) Object.assign(this._gust, { x, z, strength, radius });
  }

  setGrassQuality(count) {
    this.grass.setCount(count);
  }

  update(dt) {
    const g = this._gust;
    g.strength *= Math.exp(-dt * 2.2);
    if (g.strength < 0.01) g.strength = 0;
    this.game.U.uGust.value.set(g.x, g.z, g.strength, g.radius);
    this.scorch.update(dt);
    this.atmosphere.update(dt);
  }
}
