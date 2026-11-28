// The deathblow's hit effect, headless (combat/deathblowFx.js, ?dbfx=a|b|c|d): the REAL module on a real
// camera, uniforms, FireField and LetterBatch (a stub pipeline hands over the batch). A combo of 7 blows
// 0.4 s apart (the last the finisher) is run for 5.7 s at 60 fps under each look, with a synthetic blade path,
// the blood (?blood), the slash on the path and the hit-pause's slow clock.
// usage: node dbfx.mjs <repoRoot> [scenario]    scenario: combo | switch | edge | blood | slash | hold | all
import { pathToFileURL } from 'node:url';
import './shim.mjs';

const ROOT = process.argv[2];
const SCEN = process.argv[3] || 'all';
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const THREE = await import(pathToFileURL(`${ROOT}/node_modules/three/build/three.module.js`).href);
const { createSharedUniforms } = await imp('src/render/shaderLib.js');
const { FireField } = await imp('src/render/fireField.js');
const FX = await imp('src/combat/deathblowFx.js');
const { DBFX_LAST: L } = FX;

const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const DT = 1 / 60;
const CAP = 700; // letters alive at once, at most

/** The game the effect reads: camera + uniforms + pipeline stub + fire field + the hero. */
function build(withPipeline = true) {
  const U = createSharedUniforms();
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  cam.position.set(0, 9, 12);
  cam.lookAt(0, 1, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  U.uCamRight.value.setFromMatrixColumn(cam.matrixWorld, 0);
  U.uCamUp.value.setFromMatrixColumn(cam.matrixWorld, 1);
  U.uResolution.value.set(1280, 720);
  const batches = [];
  const game = {
    THREE, U, camera: cam, fxDt: DT, time: 0,
    fx: { fire: new FireField(U, { max: 6000 }) },
    player: { position: new THREE.Vector3(0, 0, 3.2) },
  };
  if (withPipeline) game.pipeline = { width: 1280, height: 720, artCell: { x: 5, y: 8 }, registerParticles: (b) => batches.push(b) };
  return { game, batches };
}

/** Run the effect through `fn(game, hit)` for `frames`, with Math.random counted; returns the stats. */
function stats(G, frames, perFrame) {
  const S = { peak: 0, maxCh: 0, nan: 0, heatBad: 0, heatFrames: 0, randCalls: 0, threw: null };
  const real = Math.random;
  const count = () => { S.randCalls++; return real(); };
  for (let f = 0; f < frames; f++) {
    G.game.time += DT;
    G.game.fx.fire.clear();
    try {
      Math.random = count;
      perFrame(f);
      FX.deathblowFxUpdate(G.game, DT);
    } catch (e) {
      S.threw = e;
    } finally {
      Math.random = real;
    }
    const n = G.game.fx.fire.count;
    if (n > 0) {
      S.heatFrames++;
      if (!(L.flash > 0)) S.heatBad++; // heat written with no blow's flash alive
    }
    for (let bi = 0; bi < G.batches.length; bi++) {
      const bb = G.batches[bi];
      if (bi === 0) S.peak = Math.max(S.peak, bb.count);
      for (let i = 0; i < bb.count; i++) {
        const c = bb.iColor.array, p = bb.iPos.array;
        for (let j = 0; j < 3; j++) { if (!Number.isFinite(c[i * 4 + j]) || !Number.isFinite(p[i * 3 + j])) S.nan++; S.maxCh = Math.max(S.maxCh, c[i * 4 + j]); }
        if (!Number.isFinite(c[i * 4 + 3])) S.nan++;
      }
    }
  }
  return S;
}

/** One blow's data: the contact on the boss (x ~ 0, y ~ 1.1), the blow's way alternating; a synthetic `path`: the blade tip's arc
 *  (1.4 m long, on the screen's right / up plane) ending at the contact, its hilt behind the hero. */
const blow = (k, last, n = 7, withPath = true) => {
  const o = {
    x: Math.sin(k * 1.7) * 0.15, y: 1.0 + 0.1 * (k % 3), z: -0.2 + 0.1 * Math.cos(k), dx: k % 2 ? 0.8 : -0.6, dz: k % 2 ? -0.6 : 0.8,
    i: k + 1, n, last, a0: k % 3 === 2 ? NaN : -0.8 + 0.2 * k, a1: k % 3 === 2 ? NaN : 0.7 + 0.1 * k, hold: last ? 0.38 : 0.16,
  };
  if (withPath) {
    const m = 10, p = new Float32Array(3 * m), a0 = 0.5 + 0.35 * k, sgn = k % 2 ? -1 : 1;
    for (let j = 0; j < m; j++) {
      const u = j / (m - 1), a = a0 + sgn * (1 - u) * 1.3; // (the arc comes in to the contact: the last point is the contact)
      p[j * 3] = o.x + sgn * Math.cos(a) * 0.9 - sgn * Math.cos(a0) * 0.9 * 0 + (1 - u) * -0.5 * sgn;
      p[j * 3 + 1] = o.y + (Math.sin(a) - Math.sin(a0)) * 0.9;
      p[j * 3 + 2] = o.z + (1 - u) * 0.3;
    }
    p[(m - 1) * 3] = o.x; p[(m - 1) * 3 + 1] = o.y; p[(m - 1) * 3 + 2] = o.z;
    o.path = p;
    o.base = { x: o.x - o.dx * 0.8, y: o.y, z: o.z - o.dz * 0.8 };
  }
  return o;
};

const SCENARIOS = {
  combo() {
    out('\n== scenario COMBO (7 blows 0.4 s apart, the last the finisher; 5.7 s at 60 fps; each look) ==');
    FX.setDbFx('a');
    for (const mode of FX.DB_FX.opts) {
      FX.setDbFx(mode);
      FX.deathblowFxClear();
      const G = build();
      const S = stats(G, 340, (f) => {
        if (f % 24 === 0 && f / 24 < 7) FX.deathblowHit(G.game, blow(f / 24, f / 24 === 6));
      });
      assert(!S.threw, `${mode}: no throw (${S.threw?.message ?? 'ok'})`);
      assert(S.nan === 0 && L.bad === 0, `${mode}: no NaN in the letters (${S.nan}) or the pool (${L.bad})`);
      assert(!FX.deathblowFxBusy() && L.alive === 0, `${mode}: nothing alive 3 s after the last hit (only the pools stay: ${L.pools})`);
      out(`   ${mode}: ${L.spawned} letters made in all, peak alive ${S.peak} (cap ${CAP}), heat on ${S.heatFrames} frames, brightest channel ${S.maxCh.toFixed(2)}, ${L.white} white, snapped ${L.snapped}`);
      assert(S.peak > 0 && S.peak <= CAP, `${mode}: peak live letters ${S.peak} is within 1..${CAP}`);
      assert(S.heatFrames > 0 && S.heatBad === 0, `${mode}: heat written only while a blow's flash lives (${S.heatBad} stray frames)`);
      assert(S.maxCh <= 0.55 + 1e-6 && L.white === 0, `${mode}: no colour channel above 0.55, none white (${S.maxCh.toFixed(3)})`);
      assert(S.randCalls === 0, `${mode}: Math.random never called (${S.randCalls})`);
      assert(G.game.fx.fire.count === 0, `${mode}: no heat left in the field`);
      // growth: the finisher makes more than the first blow
      FX.deathblowFxClear();
      let s0 = L.spawned;
      FX.deathblowHit(G.game, blow(0, false));
      const first = L.spawned - s0;
      FX.deathblowFxClear();
      s0 = L.spawned;
      FX.deathblowHit(G.game, blow(6, true));
      const fin = L.spawned - s0;
      assert(fin > first, `${mode}: the finisher makes more letters (${fin}) than the first blow (${first})`);
      FX.deathblowFxClear();
    }
    if (FX.DB_FX.mode !== 'a') FX.setDbFx('a');
  },

  switch() {
    out('\n== scenario SWITCH (the look changes at every blow of one combo) ==');
    const G = build();
    FX.deathblowFxClear();
    const seq = ['a', 'b', 'c', 'd', 'a', 'c', 'b'];
    const S = stats(G, 340, (f) => {
      if (f % 24 === 0 && f / 24 < 7) {
        FX.setDbFx(seq[f / 24]);
        FX.deathblowHit(G.game, blow(f / 24, f / 24 === 6));
      }
    });
    assert(!S.threw, `a switch at every blow does not throw (${S.threw?.message ?? 'ok'})`);
    assert(S.nan === 0 && !FX.deathblowFxBusy(), 'it ends clean: nothing alive, no NaN');
    assert(S.maxCh <= 0.55 + 1e-6 && S.randCalls === 0, 'under the bloom threshold, no Math.random');
    FX.setDbFx('zzz');
    assert(FX.getDbFx() === 'e', 'an unknown look falls back to e (the default, Weight)');
    out(`   peak alive ${S.peak}`);
  },

  blood() {
    out('\n== scenario BLOOD (on / off; the pools stay until a clear; dark reds only) ==');
    for (const mode of FX.DB_FX.opts) {
      FX.setDbFx(mode);
      for (const on of [true, false]) {
        FX.setBlood(on);
        FX.deathblowFxClear();
        const G = build();
        const b0 = L.blood;
        const S = stats(G, 340, (f) => {
          if (f % 24 === 0 && f / 24 < 7) FX.deathblowHit(G.game, blow(f / 24, f / 24 === 6));
        });
        const made = L.blood - b0, pools = L.pools;
        if (on) {
          assert(made > 150, `${mode}: blood on: ${made} droplets and wound letters made`);
          assert(pools > 20, `${mode}: blood on: ${pools} pools on the floor, 3 s after the last hit`);
          assert(G.batches.length === 2 && G.batches[1].count === pools, `${mode}: the pools are printed (${G.batches[1]?.count} of ${pools})`);
          // every pool letter dark red, under the threshold
          const c = G.batches[1].iColor.array;
          let bad = 0;
          for (let i = 0; i < G.batches[1].count; i++) if (!(c[i * 4] >= 0.2 && c[i * 4] <= 0.45 && c[i * 4 + 1] < 0.06 && c[i * 4 + 2] < 0.04)) bad++;
          assert(bad === 0, `${mode}: every pool letter is a dark red (${bad} off)`);
          const py = G.batches[1].iPos.array;
          let low = 0;
          for (let i = 0; i < G.batches[1].count; i++) if (py[i * 3 + 1] > 0.3) low++;
          assert(low === 0, `${mode}: the pools lie on the floor`);
          FX.deathblowFxClear();
          assert(L.pools === 0 && G.batches[1].count === 0 && !FX.deathblowFxBusy(), `${mode}: a clear takes the pools away`);
        } else {
          assert(made === 0 && pools === 0, `${mode}: blood off: none (${made} letters, ${pools} pools)`);
        }
        assert(S.maxCh <= 0.55 + 1e-6 && S.randCalls === 0 && S.nan === 0, `${mode} blood ${on}: under the threshold, no Math.random, no NaN`);
      }
    }
    FX.setBlood(true);
    FX.setDbFx('a');
  },

  slash() {
    out('\n== scenario SLASH (the cut starts on the path\'s first point and ends past the contact) ==');
    for (const mode of FX.DB_FX.opts) {
      FX.setDbFx(mode);
      for (const k of [0, 1, 3, 6]) {
        FX.deathblowFxClear();
        const G = build();
        const o = blow(k, k === 6);
        FX.deathblowHit(G.game, o);
        const Rg = G.game.U.uCamRight.value, Up = G.game.U.uCamUp.value;
        const rel = (px, py, pz) => [(px - o.x) * Rg.x + (py - o.y) * Rg.y + (pz - o.z) * Rg.z, (px - o.x) * Up.x + (py - o.y) * Up.y + (pz - o.z) * Up.z];
        const sl = L.slash, len = Math.hypot(sl[2] - sl[0], sl[3] - sl[1]);
        const m = o.path.length / 3, pa = rel(o.path[(m - 4) * 3], o.path[(m - 4) * 3 + 1], o.path[(m - 4) * 3 + 2]);
        const pl = Math.hypot(pa[0], pa[1]) || 1;
        const dot = (-pa[0] / pl) * sl[4] + (-pa[1] / pl) * sl[5]; // (the swing's direction into the contact)
        assert(L.src === 'path', `${mode} blow ${k}: the direction came from the path`);
        assert(Math.hypot(sl[0] + sl[2], sl[1] + sl[3]) < 0.12, `${mode} blow ${k}: the cut is centred on the contact`);
        const want = k === 6 ? 2.2 : mode === 'b' ? 1.6 : 1.3; // (b's lines capped at 1.6 m, 2.2 m the finisher: kept on his body)
        assert(len >= want - 0.1 && len <= want + (mode === 'b' ? 0.05 : 0.7), `${mode} blow ${k}: its length ${len.toFixed(2)} m (${want})`);
        assert(dot > 0.8, `${mode} blow ${k}: it runs along the swing's direction at the contact (${dot.toFixed(2)})`);
      }
      // the fallback: no path, a straight sweep along the bearing
      FX.deathblowFxClear();
      const G = build();
      FX.deathblowHit(G.game, blow(2, false, 7, false));
      assert(L.src === 'fallback' && L.slash[2] * L.slash[4] + L.slash[3] * L.slash[5] > 0.3, `${mode}: without a path a straight sweep through the contact`);
    }
    FX.setDbFx('a');
  },

  hold() {
    out('\n== scenario HOLD (the clock runs at ~15 % while the hit-pause holds, then at full) ==');
    FX.setDbFx('a');
    FX.deathblowFxClear();
    const G = build();
    const o = blow(0, false);
    FX.deathblowHit(G.game, o);
    const ages = [];
    for (let f = 0; f < 30; f++) {
      G.game.time += DT;
      FX.deathblowFxUpdate(G.game, DT);
      ages.push(L.ts);
    }
    assert(ages[0] === 0.15 && ages[8] === 0.15, 'slowed to 15 % through the hold');
    assert(ages[20] === 1 && ages[29] === 1, 'back to full after the hold (0.16 s)');
    const heldTs = ages.filter((v) => v < 1).length;
    assert(heldTs >= 9 && heldTs <= 11, `the hold lasts about 0.16 s of real time (${heldTs} frames)`);
    // a blow with no hold is never slowed
    FX.deathblowFxClear();
    const o2 = blow(1, false);
    delete o2.hold;
    FX.deathblowHit(G.game, o2);
    FX.deathblowFxUpdate(G.game, DT);
    assert(L.ts === 1, 'no hold: the clock stays full');
    FX.deathblowFxClear();
  },

  edge() {
    out('\n== scenario EDGE (bad input, no pipeline, no fire field, a clear mid-flight) ==');
    let threw = null;
    try {
      for (const mode of FX.DB_FX.opts) {
        FX.setDbFx(mode);
        const G = build(false);
        FX.deathblowHit(G.game, blow(0, false));
        FX.deathblowHit(G.game, blow(1, true));
        FX.deathblowHit(G.game, { x: NaN, y: 1, z: 0, i: 1, n: 1, last: true });
        FX.deathblowHit(G.game, { x: 0, y: 1, z: 0, dx: NaN, dz: NaN, i: 1, n: 1, last: true, a0: NaN, a1: NaN });
        FX.deathblowHit(G.game, null);
        FX.deathblowHit(null, blow(0, false));
        FX.deathblowHit(G.game, { ...blow(1, false), path: new Float32Array([NaN, 1, 0, NaN, 2, 0, 0, 0, 0]), base: { x: NaN, y: 0, z: 0 }, hold: NaN });
        FX.deathblowHit(G.game, { ...blow(1, true), path: new Float32Array(3), hold: 5 });
        FX.deathblowHit(G.game, { ...blow(1, true), path: new Float32Array(3 * 40).fill(1) });
        G.game.fx = {};
        for (let f = 0; f < 150; f++) FX.deathblowFxUpdate(G.game, DT);
        FX.deathblowHit(G.game, blow(2, true));
        FX.deathblowFxUpdate(G.game, DT);
        FX.deathblowFxClear(G.game);
        FX.deathblowFxUpdate(G.game, 0);
        FX.deathblowFxUpdate(null, DT);
        FX.deathblowFxUpdate(G.game, NaN);
      }
    } catch (e) {
      threw = e;
    }
    assert(!threw, `bad input, no pipeline, no fire field, a clear mid-flight: nothing throws (${threw?.message ?? 'ok'})`);
    assert(!FX.deathblowFxBusy(), 'a clear leaves nothing alive');
    FX.setDbFx('a');
  },
};

const names = SCEN === 'all' ? Object.keys(SCENARIOS) : SCEN.split(',');
for (const n of names) {
  if (!SCENARIOS[n]) { out('unknown scenario', n); fails++; continue; }
  await SCENARIOS[n]();
}
assert(errors.length === 0, `no console errors (${errors.slice(0, 2).join(' | ')})`);
out(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
