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
//   world.debug.setVisible(bool)            Lab only: hide / restore the environment (see below)
export const PUSHER_SLOTS = MAX_PUSH;

/** A set's own night (`sky: { moonColor, moonDir, ambient, fogColor, fogNear, fogFar }`, all optional):
 *  written into the shared uniforms once, before anything reads them. */
function applySky(U, sky) {
  if (!sky || !U) return;
  const rgb = (u, c) => {
    if (u?.value?.setRGB && Array.isArray(c) && c.length === 3 && c.every(Number.isFinite)) u.value.setRGB(c[0], c[1], c[2]);
  };
  rgb(U.uMoonColor, sky.moonColor);
  rgb(U.uAmbient, sky.ambient);
  rgb(U.uFogColor, sky.fogColor);
  if (Number.isFinite(sky.fogNear) && U.uFogNear) U.uFogNear.value = sky.fogNear;
  if (Number.isFinite(sky.fogFar) && U.uFogFar) U.uFogFar.value = sky.fogFar;
  const d = sky.moonDir;
  if (Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) && U.uMoonDir?.value?.set) U.uMoonDir.value.set(d[0], d[1], d[2]).normalize();
}

export class World {
  constructor(game) {
    this.game = game;
    const U = game.U;
    this.colliders = new Colliders();
    this.ground = createGround(U);
    game.scene.add(this.ground);
    // the level's static set (levels/index.js: createForest by default, createCourtyard for Ashfall);
    // both return the same shape, kept under the name `forest`
    const buildSet = typeof game.level?.buildSet === 'function' ? game.level.buildSet : createForest;
    this.forest = buildSet(U, this.colliders);
    game.scene.add(this.forest.group);
    applySky(U, this.forest.sky);
    this.scorch = new Scorch(U, game);
    const extent = 150;
    const meadow = meadowDensity(this.colliders, this.forest.treeSpots, this.forest.bare, extent, this.forest.slabs);
    // a set may thin and shorten its grass (`grass: { density(x, z) → 0..1 factor, height, ash }`):
    // the Ashfall courtyard's burned hillside
    const G = this.forest.grass ?? null;
    const density = typeof G?.density === 'function' ? (x, z) => meadow(x, z) * G.density(x, z) : meadow;
    const hk = Number.isFinite(G?.height) ? G.height : 1;
    const height = hk === 1 ? meadowHeight : (x, z, rng) => meadowHeight(x, z, rng) * hk;
    const q = CONFIG.quality[CONFIG.quality.length - 1];
    this.grass = createGrass(U, { count: q.grass, extent, density, height, ash: G?.ash ?? 0 });
    game.scene.add(this.grass.mesh);
    this.atmosphere = new Atmosphere(game, this.forest);
    this.bonfire = this.forest.bonfire;
    this.nest = this.forest.nest;
    this._gust = { x: 0, z: 0, strength: 0, radius: 1 };
    this._hidden = null; // saved `visible` flags while world.debug.setVisible(false) holds

    // Lab hooks (ARCHITECTURE.md → game context → `world`): the model viewer's "dark" mode renders actors alone.
    //   setVisible(false) hides ground, grass and the forest group (trees, stones, flagstones, nest
    //   bones, bonfire) and stops the atmosphere (bonfire flames, fireflies, mist, leaves). Particles
    //   already in flight in the shared pools are dropped (mist lives ~10 s; actors re-emit theirs).
    //   setVisible(true) restores the exact previous `visible` flags. Lights, scorch and colliders
    //   are untouched.
    const world = this;
    this.debug = {
      setVisible: (on) => this._setVisible(on),
      get visible() {
        return world._hidden === null;
      },
    };
  }

  _setVisible(on) {
    const parts = [this.ground, this.grass?.mesh, this.forest?.group].filter(Boolean);
    if (!on && this._hidden === null) {
      this._hidden = parts.map((o) => [o, o.visible]);
      for (const o of parts) o.visible = false;
      this.forest?.ambience?.setVisible?.(false); // (a set's own glyph batch, e.g. the throne hall's inlay)
      this.game.fx?.alpha?.clear?.();
      this.game.fx?.add?.clear?.();
    } else if (on && this._hidden !== null) {
      for (const [o, v] of this._hidden) o.visible = v;
      this._hidden = null;
      this.forest?.ambience?.setVisible?.(true);
    }
    return this._hidden === null;
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
    if (this._hidden === null) this.atmosphere.update(dt);
  }
}
