// What hangs answers the wind (world/hang.js, the prop art material's PA_HANG): banners, paper charm
// strips, a rope. Its scenarios (tests/integration/life.mjs runs them; T is its toolbox).
// Run: node tests/integration/life.mjs . hang
// The breakables are built here on the toolbox's world (its world mock has none), as world.js builds them.

const HANGERS = { ring: 'banner', fox: 'charmPost', starless: 'banner', foundry: 'ladle' };

/** A level with its breakables, the living world `spec` on. */
async function level(T, id, spec = 'wind') {
  const { Destructibles, STATE } = await T.imp('src/world/destructibles.js');
  const { Scars } = await T.imp('src/world/scars.js');
  const w = T.build(id, spec);
  w.world.scars = new Scars(w.game, w.set.scarInk);
  const D = new Destructibles(w.game, w.world, w.set);
  w.world.destructibles = D;
  w.D = D;
  w.STATE = STATE;
  w.hanging = D.list.filter((b) => b.hang);
  w.stepAll = (sec, dt = 1 / 60) => {
    for (let t = 0; t < sec - 1e-9; t += dt) {
      w.step(dt, dt);
      D.update(dt);
    }
  };
  return w;
}

/** The lean of a piece now (rad), from the CPU mirror of the shader. */
async function leanOf(T, w, b) {
  const { hangLean } = await T.imp('src/world/hang.js');
  const v = hangLean(w.U, b.x, b.z, b.hang.give, { x: 0, y: 0, z: 0 });
  return { a: Math.asin(Math.min(1, Math.hypot(v.x, v.z))), v };
}

export default {
  /** The mark rides from the builder through the brick cutting into the rigid batch, unchanged, on every hanging piece; nothing else carries it. */
  async rides(T) {
    for (const id of T.LEVEL_IDS) {
      const w = await level(T, id, 'off');
      const D = w.D, kind = HANGERS[id];
      const batch = D.batch?.meshes?.find((m) => m.material === D.propMat);
      if (!kind) {
        T.assert(w.hanging.length === 0 && !batch?.geometry?.attributes?.aHang && !D.propMat?.vertexShader?.includes('hangOffset'), `${id}: nothing hangs, no aHang in its batch, its prop art compiles no hang code`);
        continue;
      }
      let match = 0, hangVerts = 0, bricks = 0;
      for (const b of w.hanging) {
        const run = b.body.userData.batchRun, A = run.mesh.geometry.attributes.aHang, S = b.body.geometry.attributes.aHang;
        let same = !!A && !!S && S.count === run.n;
        for (let i = 0; same && i < run.n * 2; i++) if (A.array[run.v0 * 2 + i] !== S.array[i]) same = false;
        if (same) match++;
        for (let i = 0; i < S.count; i++) if (S.getX(i) > 0) hangVerts++;
        if (b.bricks?.T > 0) bricks++;
      }
      const kinds = [...new Set(w.hanging.map((b) => b.kind))];
      T.assert(w.hanging.length > 0 && kinds.length === 1 && kinds[0] === kind, `${id}: the ${kind}s hang (${w.hanging.length} pieces)`);
      T.assert(match === w.hanging.length, `${id}: each one's aHang is in the batch, vertex for vertex (${match} / ${w.hanging.length}; ${hangVerts} hanging vertices)`);
      T.assert(bricks === w.hanging.length, `${id}: each one still has its bricks (${bricks} / ${w.hanging.length})`);
    }
  },

  /** The lean follows the level's air: the Ring streams steadily, the Terrace's paper sighs and falls still, the Throne's cloth barely stirs, the Grove nothing. */
  async moods(T) {
    const out = {};
    for (const id of ['ring', 'fox', 'starless', 'grove']) {
      const w = await level(T, id, 'wind');
      w.stepAll(2);
      // (the grove hangs nothing: a probe at the centre with cloth's give)
      const b = w.hanging[0] ?? { x: 0, z: 0, hang: { give: 1 } };
      const deg = [];
      for (let t = 0; t < 60; t += 0.25) {
        w.step(0.25, 1 / 20);
        deg.push(((await leanOf(T, w, b)).a * 180) / Math.PI);
      }
      deg.sort((p, q) => p - q);
      out[id] = { min: deg[0], p10: deg[Math.floor(deg.length * 0.1)], max: deg[deg.length - 1], mean: deg.reduce((s, v) => s + v, 0) / deg.length };
      T.out(`     ${id}: lean over 60 s min ${out[id].min.toFixed(1)} p10 ${out[id].p10.toFixed(1)} mean ${out[id].mean.toFixed(1)} max ${out[id].max.toFixed(1)} deg`);
    }
    T.assert(out.ring.p10 > 9 && out.ring.max < 26, `the Ring's banners stream: at least ${out.ring.p10.toFixed(1)} deg nine tenths of the time, at most ${out.ring.max.toFixed(1)}`);
    T.assert(out.fox.min < 1 && out.fox.max > 6, `the Terrace's paper falls still in a pause (${out.fox.min.toFixed(2)} deg) and lifts in a sigh (${out.fox.max.toFixed(1)} deg)`);
    T.assert(out.starless.max < 3, `the Throne's cloth barely stirs (at most ${out.starless.max.toFixed(2)} deg of lean)`);
    T.assert(out.grove.max === 0, `the Grove: nothing leans (${out.grove.max} deg)`);
  },

  /** A blow on a leaning banner bites the cloth where it is drawn, and its letters fall from there. */
  async bite(T) {
    const w = await level(T, 'ring', 'wind');
    w.stepAll(3);
    const b = w.hanging.find((p) => p.x > 0) ?? w.hanging[0];
    const { v } = await leanOf(T, w, b);
    // a point on the cloth as it is drawn: 1.6 m under its bar, on its middle line (rest: the cloth hangs 0.12 m in front of the pole)
    const drop = 1.6, ry = b.hang.top - drop, rx = b.x, rz = b.z + 0.12;
    const px = rx + v.x * drop, py = ry + v.y * drop, pz = rz + v.z * drop;
    const off = Math.hypot(px - rx, pz - rz);
    T.assert(off > 0.25, `the cloth there is drawn ${off.toFixed(2)} m downwind of its rest`);
    const n0 = b.bricks.n;
    w.D.strike(px, pz, 0.3, 0.25, { by: 'player', dx: 0, dz: -1, y: py, src: 1 });
    const took = b.bricks.n - n0;
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < b.bricks.T; i++) {
      if (!b.bricks.bit[i]) continue;
      cx += b.bricks.cen[i * 3] + b.x;
      cy += b.bricks.cen[i * 3 + 1] + b.y0;
      cz += b.bricks.cen[i * 3 + 2] + b.z;
      k++;
    }
    cx /= k || 1;
    cy /= k || 1;
    cz /= k || 1;
    const toRest = Math.hypot(cx - rx, cy - ry, cz - rz), toBlow = Math.hypot(cx - px, cy - py, cz - pz);
    T.assert(took > 0 && toRest < 0.45, `the blow took ${took} brick(s) from the cloth's rest under the drawn point (${toRest.toFixed(2)} m from it; ${toBlow.toFixed(2)} m from the blow's own point)`);
    // with the wind off the same blow is taken where it lands, as before
    const w0 = await level(T, 'ring', 'off');
    const b0 = w0.hanging.find((p) => p.x > 0) ?? w0.hanging[0];
    T.assert(w0.D._hangAt(b0) === null, 'with the wind off a hanging piece is taken as it stands (no lean)');
  },

  /** Felled, a banner lies still: its bone is no longer upright, the lean is gone, and a bite on it is taken where it lies. */
  async still(T) {
    const w = await level(T, 'ring', 'wind');
    w.stepAll(2);
    const b = w.hanging[0];
    T.assert(w.D._hangAt(b) !== null, 'standing in the wind it leans');
    w.D.topple(b, 1, 0, 'player');
    w.stepAll(4);
    const e = b.body.matrixWorld.elements, up = e[5] / Math.hypot(e[4], e[5], e[6]);
    T.assert(b.state !== w.STATE.INTACT && up < 0.5, `it has fallen (state ${b.state}, its up axis ${up.toFixed(2)} of vertical)`);
    // the shader's gate: smoothstep(0.985, 0.998, up) x (base on the ground)
    T.assert(up < 0.985 && w.D._hangAt(b) === null, 'lying, it does not sway (the shader\'s gate is shut, the bite takes it where it lies)');
    w.D.reset();
    w.stepAll(0.5);
    T.assert(w.D._hangAt(b) !== null, 'stood up again by the reset, it leans again');
  },
};
