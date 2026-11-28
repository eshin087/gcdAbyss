// The living world's 'litter' piece: its scenarios (tests/integration/life.mjs runs them; T is its toolbox).
// One scenario per rule the piece must keep. Run: node tests/integration/life.mjs . litter

const AIR = 1, LYING = 2;

/** The levels with a litter block (litterTuning.js): a level without one has no litter (the layer stands
 *  down, `takes` nothing, makes no pool) and is checked by `noBlock` instead. */
const { LITTER } = await import(new URL('../../../src/world/life/litterTuning.js', import.meta.url).href);
const WITH = (T) => T.LEVEL_IDS.filter((id) => !!LITTER.levels[id]);

/** A level with the litter on, nothing falling (rate 0) and nothing lying yet: a clean floor to test on. */
function bare(T, id, spec = 'litter', o = {}) {
  const w = T.build(id, spec, o);
  const L = w.life.litter;
  // (nothing falls, nothing is laid, and nothing is recycled for being too many)
  L.T = { ...L.T, rate: 0, lying: 0 };
  w.place(o.x ?? 2, o.z ?? 14);
  w.step(1 / 60); // (the first update builds the pool)
  L.T = { ...L.T, lying: 1e6 };
  return w;
}

/** A letter of kind 0 put down at (x, z) (or into the air at height y), that never times out. */
function put(w, x, z, y) {
  const L = w.life.litter;
  const f = L._free();
  L._dress(f, 0);
  L._lie(f, x, z);
  f.last = 1e9;
  f.a = 1;
  f.fa = 0;
  L.count++;
  if (Number.isFinite(y)) {
    f.s = AIR;
    f.y = y;
    f.vx = f.vz = 0;
    f.vy = -f.fall;
  }
  return f;
}

/** The air everywhere: (vx, vz) m/s (a faked gust: the real wind is not in this worktree's tests). */
function fakeWind(w, vx, vz, k = 1) {
  w.life.wind.at = (x, z, out = { x: 0, z: 0, k: 0 }) => {
    out.x = vx;
    out.z = vz;
    out.k = k;
    return out;
  };
}

export default {
  /** Against the REAL wind (not a faked gust): the level's own wind lifts a few letters as a front
   *  passes (not a carpet), a roar's front lifts most of what lies in its path, the ring's grit keeps
   *  tumbling, and nothing moves in the Windless Grove until the fight moves its air. */
  realWind(T) {
    for (const id of WITH(T)) {
      // the air: its fastest without a front, inside one, and a roar's
      const w = T.build(id, 'wind');
      const W = w.life.wind, p = { x: 0, z: 0, k: 0 };
      let calm = 0, front = 0;
      for (let i = 0; i < 240; i++) {
        w.step(0.25);
        const f = w.game.player.position;
        W.at(f.x, f.z, p);
        if (p.k < 0.02) calm = Math.max(calm, Math.hypot(p.x, p.z));
        for (let x = -20; x <= 20; x += 2) for (let z = -16; z <= 12; z += 2) {
          W.at(f.x + x, f.z + z, p);
          if (p.k > 0.3) front = Math.max(front, Math.hypot(p.x, p.z));
        }
      }
      // what the level's own wind lifts in 60 s (the hero stands still)
      const l = T.build(id, 'wind,litter');
      const L = l.life.litter;
      l.step(1);
      const prev = new Map();
      let lifts = 0, lying = 0, air = 0, n = 0;
      for (let i = 0; i < 60 * 30; i++) {
        l.step(1 / 30);
        for (const f of L.leaves ?? []) {
          if (prev.get(f) === LYING && f.s === AIR) lifts++;
          prev.set(f, f.s);
        }
        lying += L.lying;
        air += L.count - L.lying;
        n++;
      }
      lying /= n;
      air /= n;
      // a roar's front (the answer's, from the boss toward the hero) over what lies in its path, past
      // the roar's own scatter at the boss
      const q = T.build(id, 'wind,litter,answer');
      const Q = q.life.litter;
      q.step(3);
      const b = q.game.dragon.position, h = q.game.player.position;
      const dx = h.x - b.x, dz = h.z - b.z, len = Math.hypot(dx, dz) || 1;
      const inPath = (f) => {
        const s = ((f.x - b.x) * dx + (f.z - b.z) * dz) / len, c = Math.abs(((f.x - b.x) * dz - (f.z - b.z) * dx) / len);
        return s > 0 && s < len && c < 8 && Math.hypot(f.x - b.x, f.z - b.z) > 12;
      };
      const path = Q.leaves.filter((f) => f.s === LYING && inPath(f));
      q.life.answer.answerRoar(1, true);
      let roar = 0;
      const lifted = new Set();
      for (let i = 0; i < 120; i++) {
        q.step(1 / 30);
        for (let u = 0; u <= 1; u += 0.05) { q.life.wind.at(b.x + dx * u, b.z + dz * u, p); roar = Math.max(roar, Math.hypot(p.x, p.z)); }
        for (const f of path) if (f.s === AIR) lifted.add(f);
      }
      const share = lifted.size / Math.max(1, path.length);
      T.out(`  ${id}: air ${calm.toFixed(2)} m/s without a front, ${front.toFixed(2)} inside one, ${roar.toFixed(2)} in a roar's; ${lifts} lifts in 60 s (mean ${lying.toFixed(0)} lying, ${air.toFixed(0)} in the air); a roar lifts ${lifted.size} / ${path.length} in its path`);
      if (id === 'cinderwood' || id === 'fox') {
        T.assert(lifts >= 15 && lifts <= lying * 3, `${id}: the fronts lift leaves that stream with the band (${lifts} lifts in 60 s against ${lying.toFixed(0)} lying: not none, not a carpet)`);
      }
      if (id === 'ash') T.assert(lifts >= 60, `${id}: the fitful gusts drag the ash (${lifts} lifts in 60 s)`);
      if (id === 'ring') T.assert(air >= 40 && lying < 60, `${id}: the grit keeps tumbling (${air.toFixed(0)} in the air, ${lying.toFixed(0)} lying)`);
      if (id === 'starless' || id === 'grove') T.assert(lifts === 0, `${id}: nothing lifts by itself (${lifts})`);
      if (path.length >= 5) T.assert(share >= (id === 'starless' ? 0.4 : 0.6), `${id}: a roar's front lifts most of what lies in its path (${lifted.size} / ${path.length})`);
    }
  },

  /** A letter dropped from h lands in about h / its fall speed, then lies still for 20 s of still air. */
  landsAndStays(T) {
    for (const id of ['cinderwood', 'ash', 'fox']) {
      const w = bare(T, id);
      const h = 6;
      const f = put(w, 5, 12, h);
      const expect = h / f.fall;
      let t = 0;
      while (f.s === AIR && t < 60) { w.step(0.05); t += 0.05; }
      T.assert(f.s === LYING, `${id}: the letter landed (after ${t.toFixed(1)} s)`);
      T.assert(t > expect * 0.6 && t < expect * 1.5 + 1, `${id}: it fell in ${t.toFixed(1)} s (its fall speed says ~${expect.toFixed(1)} s)`);
      T.assert(f.y < 0.9 && f.y >= 0.04, `${id}: it lies on the floor or the grass (y ${f.y.toFixed(2)})`);
      const x = f.x, z = f.z;
      f.last = 1e9; // (ash melts into the floor in 10 - 22 s by design: this is about the air)
      w.step(20);
      T.assert(f.s === LYING && f.x === x && f.z === z, `${id}: it stays put for 20 s of still air (moved ${Math.hypot(f.x - x, f.z - z).toFixed(3)} m)`);
    }
  },

  /** Air faster than a letter's own threshold lifts it; slower air leaves it; a gust takes some, not all. */
  liftByAir(T) {
    const w = bare(T, 'cinderwood');
    w.place(0, 20);
    const f = put(w, 6, 14);
    f.lift = 3;
    fakeWind(w, 2.6, 0);
    w.step(2);
    T.assert(f.s === LYING, `air at 2.6 m/s leaves a letter whose threshold is 3 m/s lying`);
    fakeWind(w, 3.4, 0, 1);
    w.step(0.2);
    T.assert(f.s === AIR, `air at 3.4 m/s lifts it within 0.2 s`);
    w.step(0.6);
    T.assert(f.x > 6.05, `it is carried downwind (x ${f.x.toFixed(2)})`);
    // a gust in the middle of the kind's range takes some of a patch and leaves the others
    const g = bare(T, 'cinderwood');
    g.place(0, 20);
    const K = g.life.litter.kinds[0].K;
    const patch = [];
    for (let i = 0; i < 60; i++) patch.push(put(g, -6 + (i % 10) * 1.2, 10 + Math.floor(i / 10) * 1.2));
    fakeWind(g, (K.lift[0] + K.lift[1]) / 2, 0, 1);
    g.step(0.3);
    const lifted = patch.filter((f) => f.s === AIR).length;
    T.assert(lifted > 10 && lifted < 50, `a mid-range gust lifts some of a patch, not all (${lifted} of 60)`);
    // and once the air is still again, what it lifted comes to rest
    fakeWind(g, 0, 0, 0);
    g.step(12);
    T.assert(patch.every((f) => f.s !== AIR), `after the gust everything lies again (${patch.filter((f) => f.s === AIR).length} still in the air)`);
  },

  /** The hero running through moves the letters near his path and not those 6 m away; they settle again. */
  kickedByFeet(T) {
    for (const id of ['cinderwood', 'fox']) {
      const w = bare(T, id);
      w.place(-8, 10);
      w.step(0.1);
      const near = [], far = [];
      for (let x = -5; x <= 5; x += 0.7) {
        near.push(put(w, x, 10 + 0.3 * Math.sin(x * 3)));
        far.push(put(w, x, 16));
      }
      const at = (A) => A.map((f) => [f.x, f.z]);
      const n0 = at(near), f0 = at(far);
      w.walk(7.2, 0);
      w.step(2.2);
      w.walk(0, 0);
      w.step(8);
      const moved = (A, P) => A.filter((f, i) => Math.hypot(f.x - P[i][0], f.z - P[i][1]) > 0.25).length;
      const mn = moved(near, n0), mf = moved(far, f0);
      T.assert(mn >= near.length * 0.7, `${id}: a sprint through moves the letters on its path (${mn} of ${near.length})`);
      T.assert(mf === 0, `${id}: and none 6 m away (${mf} of ${far.length})`);
      T.assert(near.every((f) => f.s !== AIR), `${id}: what it kicked lies again 8 s later`);
      const dz = near.map((f) => Math.abs(f.z - 10)).reduce((a, b) => Math.max(a, b), 0);
      const top = Math.max(...near.map((f) => f.y));
      T.assert(dz < 3.5, `${id}: kicked low and aside, not flung (furthest ${dz.toFixed(2)} m off the path)`);
      T.assert(top < 1, `${id}: (they came down: highest now ${top.toFixed(2)} m)`);
    }
  },

  /** scatter returns how many it moved; they come to rest again; off, it does nothing. */
  scatter(T) {
    const w = T.build('cinderwood', 'litter');
    w.place(14, 18);
    w.step(3);
    const L = w.life.litter;
    const lying = L.leaves.filter((f) => f.s === LYING);
    T.assert(lying.length > 40, `cinderwood: litter lies round the hero at the rim from the start (${lying.length})`);
    const c = lying[0];
    const inR = L.leaves.filter((f) => (f.s === LYING || f.s === AIR) && Math.hypot(f.x - c.x, f.z - c.z) <= 4);
    const n = L.scatter(c.x, c.z, 4, 1);
    T.assert(n === inR.length && n > 0, `scatter moved ${n} letters (${inR.length} were within 4 m)`);
    T.assert(inR.every((f) => f.s === AIR), `each of them is in the air`);
    const top = Math.max(...inR.map((f) => f.vy));
    T.assert(top > 1.5, `thrown up (fastest ${top.toFixed(1)} m/s)`);
    // (a record that has come to rest may be reused at once for a new letter falling from the sky: mark those)
    const spawn0 = L._spawn.bind(L);
    L._spawn = (...a) => {
      const ok = spawn0(...a);
      if (ok) L._lastSpawn._fresh = true;
      return ok;
    };
    w.step(18);
    const flying = inR.filter((f) => f.s === AIR && !f._fresh);
    T.assert(flying.length === 0, `18 s later they have all come to rest (${flying.length} still flying)`);
    const out = inR.filter((f) => Math.hypot(f.x - c.x, f.z - c.z) > 1).length;
    T.assert(out >= inR.length * 0.6, `outward: ${out} of ${inR.length} lie more than 1 m from the blow`);
    T.assert(L.scatter(NaN, 0, 4, 1) === 0 && L.scatter(0, 0, -1, 1) === 0, `a bad scatter moves nothing`);
    const off = T.build('cinderwood', 'wind');
    off.step(1);
    T.assert(off.life.litter.scatter(0, 0, 10, 1) === 0, `with the piece off scatter returns 0`);
  },

  /** The pool never exceeds its cap on any level at quality 1, holds fewer at 0.5; the budget. */
  budget(T) {
    for (const id of WITH(T)) {
      const peak = { 1: 0, 0.5: 0 };
      for (const q of [1, 0.5]) {
        const w = T.build(id, 'wind,litter', { quality: q });
        w.walk(2, -1.5);
        for (let s = 0; s < 40; s++) {
          w.step(1);
          if (s === 20) w.walk(-2.5, 1);
          // (the litter's own pool: the wind's wisps have one of their own beside it)
          peak[q] = Math.max(peak[q], w.counts().litter);
        }
        const c = w.counts();
        const pools = c.pools - (w.life.wind._wb ? 1 : 0);
        T.assert(pools === 1, `${id} q ${q}: one pool of its own (${pools}, besides the wind's)`);
        T.assert(c.alpha === w.counts().alpha && c.random === 0, `${id} q ${q}: no Math.random`);
      }
      T.assert(peak[1] <= 500 && peak[1] > 0, `${id}: at most 500 letters at quality 1 (peak ${peak[1]})`);
      T.assert(peak[0.5] <= 250 && peak[0.5] < peak[1], `${id}: fewer at quality 0.5 (peak ${peak[0.5]} <= 250)`);
    }
    // the shared pools: the litter spawns nothing there
    const w = T.build('ash', 'off');
    w.step(10);
    const a = w.counts();
    const l = T.build('ash', 'litter');
    l.step(10);
    const b = l.counts();
    T.assert(b.spawned.alpha < a.spawned.alpha, `ash: the ashfall moves from the shared pool into the litter's (${b.spawned.alpha} alpha spawns, ${a.spawned.alpha} without)`);
  },

  /** The window follows a 60 m walk; the count stays steady and nothing lies outside it. */
  window(T) {
    for (const id of ['cinderwood', 'ash', 'fox']) {
      const w = T.build(id, 'litter');
      w.place(-30, 20);
      w.step(4);
      const L = w.life.litter;
      const n0 = L.lying;
      w.walk(6, 0);
      w.step(10);
      w.walk(0, 0);
      w.step(0.5);
      const n1 = L.lying;
      const F = w.U.uFocus.value;
      const outside = L.leaves.filter((f) => f.s === LYING && (Math.abs(f.x - F.x) > 22.01 || f.z < F.z - 19.01 || f.z > F.z + 15.01)).length;
      // (the ash lies in drifts against what stands: its count follows the stones the window holds)
      const tol = id === 'ash' ? 0.35 : 0.25;
      T.assert(n0 > 0 && Math.abs(n1 - n0) <= Math.max(12, n0 * tol), `${id}: walking 60 m keeps the lying count steady (${n0} → ${n1})`);
      T.assert(outside === 0, `${id}: nothing lies outside the window (${outside})`);
    }
  },

  /** Off leaves the pool empty; switching it off mid-run takes every letter away. */
  off(T) {
    for (const id of WITH(T)) {
      const w = T.build(id, 'wind,steps');
      w.step(5);
      const c = w.counts();
      // (the wind's wisps have a pool of their own: not the litter's)
      const pools = c.pools - (w.life.wind._wb ? 1 : 0);
      T.assert(pools === 0 && w.life.litter.count === 0 && !w.life.litter.pool, `${id}: litter off makes no pool and holds nothing (${pools} pools, ${w.life.litter.count})`);
      T.assert(w.life.takes('leaves') === false && w.life.takes('ash') === false, `${id}: litter off takes nothing from the atmosphere`);
    }
    const w = T.build('cinderwood', 'litter');
    w.step(5);
    T.assert(w.life.litter.count > 0, `cinderwood: on, letters lie (${w.life.litter.count})`);
    T.setLife('off');
    w.step(0.1);
    T.assert(w.life.litter.count === 0 && w.counts().own === 0, `switched off: none left, none drawn (${w.life.litter.count}, ${w.counts().own})`);
    T.setLife('litter');
    w.step(1);
    T.assert(w.life.litter.lying > 0, `switched on again: the ground is laid again (${w.life.litter.lying})`);
  },

  /** What each level takes from the atmosphere. */
  takes(T) {
    const want = { cinderwood: 'leaves', ash: 'ash', starless: 'leaves', ring: 'leaves', fox: 'leaves', grove: 'leaves', veil: 'ash', foundry: 'ash' };
    for (const id of WITH(T)) {
      const w = T.build(id, 'litter');
      w.step(0.1);
      T.assert(w.life.takes(want[id]) === true, `${id}: the litter takes '${want[id]}'`);
    }
    const w = T.build('ash', 'litter');
    T.assert(w.life.takes('leaves') === false, `ash: the embers' leaf slot is left to the atmosphere`);
  },

  /** The grove: a leaf comes straight down (no drift), one at a time. */
  grove(T) {
    const w = bare(T, 'grove', 'wind,litter');
    const f = put(w, 3, 4, 8);
    const x = f.x, z = f.z;
    let t = 0, maxD = 0;
    while (f.s === AIR && t < 60) {
      w.step(0.1);
      t += 0.1;
      maxD = Math.max(maxD, Math.hypot(f.x - x, f.z - z));
    }
    T.assert(f.s === LYING, `grove: the leaf landed after ${t.toFixed(1)} s`);
    T.assert(maxD < 1e-6, `grove: it came straight down (drift ${maxD.toExponential(1)} m)`);
    const g = T.build('grove', 'wind,litter');
    g.step(4);
    const L = g.life.litter;
    let peak = 0;
    for (let s = 0; s < 60; s++) {
      g.step(1);
      peak = Math.max(peak, L.leaves.filter((r) => r.s === AIR).length);
    }
    T.assert(peak >= 1 && peak <= 8, `grove: few leaves in the air at once (peak ${peak})`);
  },

  /** The ring: grit tumbles across with the wind and piles against the downwind kerb. */
  ring(T) {
    const w = T.build('ring', 'wind,litter');
    w.place(0, 5);
    w.step(90);
    const L = w.life.litter;
    const lie = L.leaves.filter((f) => f.s === LYING);
    const kerb = lie.filter((f) => f.x > 13.4 && f.x < 15 && Math.abs(f.z) < 13).length / (1.6 * 26);
    const mid = lie.filter((f) => Math.abs(f.x) < 8 && Math.abs(f.z) < 8).length / (16 * 16);
    T.assert(kerb > mid * 3, `ring: grit lies thicker against the east kerb (${kerb.toFixed(2)}/m2) than mid-ring (${mid.toFixed(2)}/m2)`);
    const moving = L.leaves.filter((f) => f.s === AIR && f.y < 0.6).length;
    T.assert(moving > 3, `ring: some grit is tumbling along the ground (${moving})`);
  },

  /** A level with no litter block (one added after the layer was tuned) gets no litter: no pool, no
   *  letters, nothing taken from the atmosphere, and nothing throws. */
  noBlock(T) {
    const ids = T.LEVEL_IDS.filter((id) => !LITTER.levels[id]);
    if (!ids.length) {
      T.out('ok   every level has a litter block');
      return;
    }
    for (const id of ids) {
      const w = T.build(id, 'all');
      w.walk(2, -2);
      w.step(20);
      const L = w.life.litter;
      T.assert(L.count === 0 && !L.pool && L.takes('leaves') === false && L.takes('ash') === false && L.scatter(0, 0, 5, 1) === 0, `${id}: no litter block → no litter, no pool, nothing taken (count ${L.count})`);
    }
  },
};
