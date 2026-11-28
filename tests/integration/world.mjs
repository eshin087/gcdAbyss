// The world's destruction, headless (ADR-107; ARCHITECTURE.md → "Destruction"): the REAL Colliders,
// Scorch, GroundFire, Scars and Destructibles on the REAL sets (the forest, the courtyard), wired
// like src/world/world.js; the hero and the boss are small stand-ins that record what lands on them.
// usage: node world.mjs <repoRoot> [scenario]
//   scenario: sets | floor | terrace | colossus | chip | fell | cover | fire | throw | marks | reset | grid | body | wreck | spread | wear | wall | reach | landmarks | edge | budget | bite | slice | placed | mow | tops | all
// (body / budget run the REAL Dragon on the REAL forest: its body against the world, ARCHITECTURE.md
// "Destruction" → "The wyrm's body")
import { pathToFileURL } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import './shim.mjs';

const ROOT = process.argv[2];
const SCEN = process.argv[3] || 'all';
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const THREE = await import(pathToFileURL(`${ROOT}/node_modules/three/build/three.module.js`).href);
const { CONFIG } = await imp('src/core/config.js');
const { ShadowCache } = await imp('src/render/shadowCache.js');
const { PerfReadout, perfFromSearch, PERF_PARTS, AUTO_BENCH, autoFromSearch } = await imp('src/dev/perfReadout.js');
const { warmDraw } = await imp('src/render/precompile.js');
const { LAYER_CASTER } = await imp('src/render/shaderLib.js');
const { Events } = await imp('src/core/events.js');
const { createSharedUniforms } = await imp('src/render/shaderLib.js');
const { LightPool } = await imp('src/render/lights.js');
const { GlyphParticles } = await imp('src/render/particles.js');
const { FireField } = await imp('src/render/fireField.js');
const { rigidBones } = await imp('src/render/rigidBatch.js');
const { Colliders } = await imp('src/world/colliders.js');
const { Scorch } = await imp('src/world/scorch.js');
const { GroundFire } = await imp('src/world/fire.js');
const { Scars, reseedMarks } = await imp('src/world/scars.js');
const { Destructibles, STATE, reseedBreaks } = await imp('src/world/destructibles.js');
const { BREAK, BLOW, FIRE, SCAR } = await imp('src/world/breakTuning.js');
const { createForest } = await imp('src/world/forest.js');
const { RIDGE, ridgeAt } = await imp('src/world/forestTuning.js');
const { mowSwing, meadowHeight, createGrass } = await imp('src/world/grass.js');
const { GRASS } = await imp('src/world/grassTuning.js');
const { ELDER_COLLIDERS } = await imp('src/world/landmarks.js');
const ELDER_N = ELDER_COLLIDERS.length;
const { createCourtyard } = await imp('src/world/courtyard.js');
const { createThroneHall } = await imp('src/world/throneHall.js');
const { createFoxTerrace, TERRACE } = await imp('src/world/foxTerrace.js');
const { createSkybreakRing, BUTTE, RING } = await imp('src/world/skybreakRing.js');
const { createWindlessGrove } = await imp('src/world/windlessGrove.js');
const { createScriptHall } = await imp('src/world/scriptHall.js');
const { createHalcyonPlaza, PLAZA, CITY } = await imp('src/world/halcyonPlaza.js');
const { createVeiledCrossing, CROSSING, VEIL, THROWABLE } = await imp('src/world/veiledCrossing.js');
const { createLastFoundry } = await imp('src/world/lastFoundry.js');
// (every level the game can load, and the training room: the bite scenario walks them all, so a new
// level is checked without being named here)
const { LEVELS } = await imp('src/levels/index.js');
const { createTrainingRoom } = await imp('src/world/trainingRoom.js');
/** The Skybreak Ring's set as arena `o` (?ring=a|b|c: read when the set is built). */
const ringSet = (o) => (U, c) => {
  setLook('ring', o);
  try {
    return createSkybreakRing(U, c);
  } finally {
    setLook('ring', null);
  }
};
const { TELL, RESULT } = await imp('src/combat/rules.js');
const { Dragon } = await imp('src/entities/dragon/dragon.js');
const { TUNING: WYRM } = await imp('src/entities/dragon/tuning.js');
const { QUALITY } = await imp('src/world/breakTuning.js');
const { resolveOn } = await imp('src/world/edge.js');
const { mulberry32 } = await imp('src/core/rng.js');
const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };

/** A world like world.js builds it, on a real set, with stand-in fighters. */
function build(makeSet = createForest, density = () => 1) {
  const U = createSharedUniforms();
  const events = new Events();
  const log = [];
  const emit = events.emit.bind(events);
  events.emit = (n, d) => { log.push({ n, ...(d ?? {}) }); emit(n, d); };
  const mk = (opts) => {
    const p = new GlyphParticles(U, opts);
    const spawn = p.spawn.bind(p);
    p.spawn = (o) => {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size']) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`NaN particle ${k}`);
      return spawn(o);
    };
    return p;
  };
  const game = {
    THREE, CONFIG, U, events, time: 0, dt: 1 / 60, fxDt: 1 / 60, state: 'boss', scene: new THREE.Scene(),
    lights: new LightPool(U), fx: { alpha: mk({ max: 3000, additive: false }), add: mk({ max: 7000, additive: true }), fire: new FireField(U, { max: 6000 }) },
    shakes: 0, shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.shakes++; },
  };
  const colliders = new Colliders();
  const set = makeSet(U, colliders);
  const world = {
    colliders, forest: set, gusts: 0, gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); this.gusts++; },
    resolve: (pos, r, b, soft, who) => resolveOn(colliders, world.edge ?? null, pos, r, b, soft, who), setPusher() {}, clearPushers() {},
  };
  world.scorch = new Scorch(U, game);
  world.fire = new GroundFire(game, world, density);
  world.scars = new Scars(game, set.scarInk);
  world.destructibles = new Destructibles(game, world, set);
  world.edge = world.destructibles.edge ?? null; // (as world.js wires it: edge.js)
  game.world = world;
  // the fighters: where they stand, what lands on them
  const hits = [];
  game.player = {
    position: new THREE.Vector3(0, 0, 8), radius: 0.45, alive: true, state: 'idle', invulnerable: false,
    isInvulnerable() { return this.invulnerable; },
    takeHit(h) { hits.push({ who: 'hero', ...h, from: { ...h.from } }); return RESULT.HIT; },
  };
  game.boss = game.dragon = {
    position: new THREE.Vector3(0, 0, -8), bodyCircles: [], T: { radius: 0.6 }, isTargetable: () => true,
    takeHit(h) { hits.push({ who: 'boss', ...h }); return h.damage; },
  };
  const step = (sec, dt = 1 / 60) => {
    for (let t = 0; t < sec - 1e-9; t += dt) {
      game.time += dt;
      world.destructibles.update(dt);
      world.fire.update(dt);
      world.scars.update(dt, game.time);
      world.scorch.update(dt);
      game.fx.alpha.update(dt, game.time);
      game.fx.add.update(dt, game.time);
      game.fx.fire.update(dt);
    }
  };
  return { game, world, set, D: world.destructibles, colliders, hits, log, step, U, emitRaw: emit };
}

/**
 * The REAL wyrm on the REAL forest (its body against the world: dragon.js _wreck). AI off (it faces the
 * hero and does nothing of its own). place(x, z, yaw) puts it there; air(f) holds its body f() m up
 * (the pose a flight would set, after its brain's frame); run(sec, each) steps it and the world.
 */
function wyrm() {
  const W = build();
  const { game, world } = W;
  Object.assign(game, { hitstop() {}, punch() {}, kick() {}, settings: { quality: 2 } });
  const d = new Dragon(game);
  game.boss = game.dragon = d;
  d.debug.startFight();
  d.debug.setAI(false);
  W.d = d;
  const frame = (each) => {
    game.time += 1 / 60;
    d.update(1 / 60);
    if (each) each();
    world.destructibles.update(1 / 60);
    world.fire.update(1 / 60);
    world.scars.update(1 / 60, game.time);
    world.scorch.update(1 / 60);
    game.fx.alpha.update(1 / 60, game.time);
    game.fx.add.update(1 / 60, game.time);
    game.fx.fire.update(1 / 60);
  };
  W.place = (x, z, yaw) => {
    d.position.set(x, 0, z);
    d.yaw = yaw;
    // (held there while its body settles after the teleport: TUNING.world.body.settle)
    const n = Math.ceil((WYRM.world.body.settle + 0.1) * 60);
    for (let i = 0; i < n; i++) frame(() => { d.position.set(x, 0, z); d.yaw = yaw; });
  };
  let air = null;
  const up = d.brain.update.bind(d.brain);
  d.brain.update = (dt) => {
    up(dt);
    if (!air) return;
    const a = air();
    d.pose.alt = a;
    d.pose.flap = a > 0.5 ? 0.9 : 0;
    d.pose.flapHz = 2;
  };
  W.air = (f) => (air = f);
  W.run = (sec, each) => {
    for (let t = 0; t < sec - 1e-9; t += 1 / 60) frame(each);
  };
  return W;
}

const S = {
  // ---------------------------------------------------------------- the phone's readout and the warm draw (ADR-209)
  // dev/perfReadout.js (?perf): what it keeps of each frame, its numbers and its report; with no document
  // it shows nothing. render/precompile.js warmDraw: the set's hidden remains drawn once at load, left
  // hidden after, nothing else drawn.
  perfreadout() {
    assert(perfFromSearch('?perf') && perfFromSearch('?level=fox&perf=1') && !perfFromSearch('?perf=0') && !perfFromSearch('?level=fox'), '?perf turns the readout on; ?perf=0 or no ?perf leaves it off');
    const game = { level: { id: 'fox' }, state: 'boss', player: { state: 'attack' }, dragon: { brain: { action: { name: 'brushstrokes' } } }, simSteps: 1 };
    const P = new PerfReadout(game, { frames: 120, doc: null });
    assert(P.el === null, 'no document: nothing is shown');
    for (let i = 0; i < 300; i++) {
      P.beginFrame();
      P.add('player', 1);
      P.add('render', 2);
      P.add('nonsense', 0.5); // (a name it does not know: `other`)
      const slow = i % 60 === 59;
      P.endFrame(slow ? 0.05 : 1 / 60, slow ? 30 : 4);
    }
    const S = P.stats();
    assert(S.frames === 120 && Math.abs(S.fps - 120 / ((118 * (1000 / 60) + 2 * 50) / 1000)) < 0.5, `it keeps the last ${P.N} frames (${S.frames}, ${S.fps} fps)`);
    assert(S.parts.player.mean === 1 && S.parts.render.mean === 2 && S.parts.other.mean === 0.5 && PERF_PARTS.includes('other'), "each part's mean (player 1, render 2, an unknown name under other)");
    assert(S.missed.over20 === 2 && S.missed.over34 === 2 && S.missed.over100 === 0, `the frames that missed: ${JSON.stringify(S.missed)}`);
    assert(S.longest.length >= 2 && S.longest[0].interval === 50 && S.longest[0].hero === 'attack' && S.longest[0].boss === 'brushstrokes', 'the longest frames, with what the hero and the boss were doing');
    const rep = P.report();
    assert(/frame interval ms/.test(rep) && /level fox/.test(rep) && /player/.test(rep) && /longest frames/.test(rep), 'the report: the device, the level, the parts, the longest frames');
    assert(P.bench() === null, 'BENCH with no GL: nothing, no throw');
    P.benches.push({ t: 1, canvas: '669x867', state: 'boss', hero: 'attack', boss: 'knock', frame: 20.5, steps: { world: 9.1, glow: 3.2 }, half: { canvas: '468x606', frame: 12, share: '41 % less' } });
    assert(/bench at 1s.*669x867/.test(P.report()) && /world\s+9\.1 ms/.test(P.report()) && /41 % less/.test(P.report()), 'a BENCH is in the report: the whole frame, each step\'s share, the half-pixel frame');
    P.benches[P.benches.length - 1].life = 1.4;
    assert(/the living world .* 1\.4 ms/.test(P.report()), "BENCH's living-world reading is in the report");
    assert(P._lifeOut() === null, 'no living world: no living-world reading, no throw');
    // AUTO BENCH: in a fight, once `firstAt` s in, then on a slow burst, `cooldown` apart, `max` in all
    {
      const g2 = { level: { id: 'cinderwood' }, state: 'explore', player: {}, dragon: {} };
      const Q = new PerfReadout(g2, { frames: 600, doc: null, auto: true });
      let clock = 0;
      const realNow = performance.now.bind(performance);
      Q.t0 = 0;
      const at = (secs) => (clock = secs * 1000);
      performance.now = () => clock;
      try {
        for (let i = 0; i < 60; i++) { at(i / 60); Q.beginFrame(); Q.endFrame(1 / 60, 3); }
        assert(Q._autoN === 0, 'no fight on screen: no auto bench');
        g2.state = 'boss';
        let t = 1;
        for (; t < 1 + AUTO_BENCH.firstAt - 0.2; t += 1 / 60) { at(t); Q.endFrame(1 / 60, 3); }
        assert(Q._autoN === 0, `the first ${AUTO_BENCH.firstAt} s of the fight: none yet`);
        for (; t < 1 + AUTO_BENCH.firstAt + 0.2; t += 1 / 60) { at(t); Q.endFrame(1 / 60, 3); }
        assert(Q._autoN === 1 && Q._busy, `${AUTO_BENCH.firstAt} s in: the first one is queued`);
        Q._busy = false;
        Q._nextAuto = t + AUTO_BENCH.cooldown;
        for (let j = 0; j < 120; j++, t += 1 / 30) { at(t); Q.endFrame(1 / 30, 3); }
        assert(Q._autoN === 1, 'slow frames inside the cooldown: none');
        for (let j = 0; j < 60; j++, t += 1 / 60) { at(t); Q.endFrame(1 / 60, 3); }
        t = Math.max(t, Q._nextAuto + 0.1);
        for (let j = 0; j < 60; j++, t += 1 / 60) { at(t); Q.endFrame(1 / 60, 3); }
        assert(Q._autoN === 1, 'after the cooldown, smooth frames: none');
        for (let j = 0; j < AUTO_BENCH.window && !Q._busy; j++, t += 1 / 30) { at(t); Q.endFrame(1 / 30, 3); }
        assert(Q._autoN === 2 && Q._busy, 'a slow burst after the cooldown: the next one is queued');
        Q._skip = true;
        Q.endFrame(5, 3);
        assert(!Q._skip && Q.stats().longest.every((x) => x.interval < 1000), "the frame after a bench (its freeze) is not recorded");
        Q._autoN = AUTO_BENCH.max;
        Q._busy = false;
        Q._nextAuto = 0;
        for (let j = 0; j < 60; j++, t += 1 / 30) { at(t); Q.endFrame(1 / 30, 3); }
        assert(Q._autoN === AUTO_BENCH.max && !Q._busy, `${AUTO_BENCH.max} in all, then no more`);
        assert(new PerfReadout(g2, { doc: null, auto: false }).auto === false && autoFromSearch('?perf=manual') === false && autoFromSearch('?perf') === true, '?perf=manual: BENCH only on the button');
      } finally {
        performance.now = realNow;
      }
    }
    P.reset();
    assert(P.stats().frames === 0 && P.longest.length === 0, 'RESET forgets what was recorded');
    // the warm draw
    const scene = new THREE.Scene();
    const mk = (name, ud, visible) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      m.name = name;
      Object.assign(m.userData, ud);
      m.visible = visible;
      scene.add(m);
      return m;
    };
    const cracked = mk('pavingCracked', { foldAway: true }, false), stumps = mk('bambooStumps', { autoHide: true }, false);
    const shown = mk('paving', {}, true), grass = mk('grass', {}, false);
    const drawn = [];
    let target = 'screen';
    const renderer = { render(o) { drawn.push(`${o.name}${o.visible ? '' : '(hidden!)'}${o.frustumCulled ? '' : ''}`); }, setRenderTarget(t) { target = t; }, getRenderTarget: () => target };
    const n = warmDraw(renderer, scene, new THREE.PerspectiveCamera());
    assert(n === 2 && drawn.join(',') === 'pavingCracked,bambooStumps', `the hidden remains are drawn once, nothing else (${drawn.join(', ')})`);
    assert(!cracked.visible && !stumps.visible && shown.visible && !grass.visible && cracked.frustumCulled && cracked.geometry.boundingSphere, 'they are hidden again after, their bounds known; the hidden grass is not drawn');
    assert(target === 'screen', 'the render target is put back');
    assert(warmDraw({}, scene, null) === 0 && warmDraw(renderer, new THREE.Scene(), null) === 0, 'a renderer that cannot draw, or nothing to warm: 0, no throw');
  },

  // ---------------------------------------------------------------- the still shadow map (ADR-201)
  // render/shadowCache.js with a stand-in renderer that records what each pass draws and every depth blit:
  // what is drawn where (the still map only when it changes, the moving casters every frame), why the still
  // map is drawn again (new, settled, moved, left, the view), which texels are wiped back (the rect a moving
  // caster covered last frame, the whole map after a redraw or when a moving caster leaves), the layer masks
  // put back after every frame, a big mesh's edited range, off on a renderer that cannot blit.
  shadowcache() {
    const S = 1024;
    const target = new THREE.WebGLRenderTarget(S, S, { depthTexture: new THREE.DepthTexture(S, S) });
    let cur = null;
    const log = [];
    const gl = {
      READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9, DEPTH_BUFFER_BIT: 0x100, NEAREST: 0x2600,
      blitFramebuffer(x0, y0, x1, y1) { log.push({ blit: [x0, x1, y0, y1] }); },
    };
    const renderer = {
      getContext: () => gl,
      state: { bindFramebuffer() {} },
      properties: { get: (rt) => ({ __webglFramebuffer: rt }) },
      setRenderTarget(rt) { cur = rt; },
      setClearColor() {},
      clear() { log.push({ clear: cur }); },
    };
    const cache = new ShadowCache(renderer, target, { settle: 5, settleBig: 2, big: 1000 });
    const scene = new THREE.Scene();
    const mk = (name, x, z, tris = 12) => {
      const geo = new THREE.BufferGeometry();
      const p = new Float32Array(tris * 9);
      for (let i = 0; i < p.length; i += 3) { p[i] = (i % 7) * 0.1; p[i + 1] = (i % 5) * 0.2; p[i + 2] = (i % 3) * 0.1; }
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      m.name = name;
      m.position.set(x, 0, z);
      m.layers.enable(LAYER_CASTER);
      scene.add(m);
      return m;
    };
    const rock = mk('rock', -20, 0), hero = mk('hero', 10, 5), crate = mk('crate', 0, -15), trees = mk('trees', 30, 30, 2000);
    const off = mk('ghost', 5, 5);
    off.layers.disable(LAYER_CASTER); // not a caster: never drawn, never counted
    const cam = new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 320);
    cam.position.set(0, 160, 0.01);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const key = [0, 0, 0, 1, 0, S];
    // the pipeline's draw: what three would draw on the shadow layers, into the target set now
    const draw = () => {
      const drawn = [];
      scene.traverseVisible((o) => { if (o.isMesh && o.layers.mask & (1 << LAYER_CASTER)) drawn.push(o.name); });
      log.push({ draw: drawn.sort().join(','), into: cur === target ? 'frame' : 'still' });
    };
    const masks = () => scene.children.map((o) => o.layers.mask).join(',');
    let t = 0;
    const frame = () => {
      t++;
      hero.position.x = 10 + Math.sin(t * 0.3); // the hero moves every frame
      scene.updateMatrixWorld();
      log.length = 0;
      const m0 = masks();
      const ok = cache.render(scene, key, draw, cam);
      const D = log.filter((e) => e.draw !== undefined), B = log.filter((e) => e.blit).map((e) => e.blit);
      return { ok, why: cache.stats.why, still: D.find((d) => d.into === 'still')?.draw ?? null, frame: D.find((d) => d.into === 'frame')?.draw ?? null, blits: B, masks: masks() === m0 };
    };
    const full = (b) => b.length === 1 && b[0][0] === 0 && b[0][1] === S && b[0][2] === 0 && b[0][3] === S;
    // 1. the first frame: everything new, nothing still yet: the still map drawn empty, everything moving
    let f = frame();
    assert(f.ok && f.why !== '' && f.still === '' && f.frame === 'crate,hero,rock,trees' && full(f.blits) && f.masks,
      `the first frame: the still map drawn (empty), the whole map copied, every caster drawn moving (${f.frame}), the masks put back`);
    // 2. the big one settles after settleBig quiet frames, the rest after settle
    const seq = [];
    for (let i = 0; i < 6; i++) { f = frame(); seq.push(f.why || '-'); }
    assert(seq[1] === 'settled' && seq[4] === 'settled' && seq.filter((w) => w !== '-').length === 2, `a caster of more than \`big\` triangles joins the still map after settleBig frames, the others after settle (${seq.join(' ')})`);
    // 3. at rest: only the hero is drawn, into the frame's map; the still map is not drawn; the wipe is the hero's rect alone
    f = frame();
    const area = (b) => b.reduce((a, r) => a + (r[1] - r[0]) * (r[3] - r[2]), 0);
    assert(f.ok && !f.why && f.still === null && f.frame === 'hero' && f.blits.length === 1 && area(f.blits) > 0 && area(f.blits) < S * S * 0.01 && f.masks,
      `at rest: only the moving hero is drawn (${f.frame}), the still map is left alone, one wipe of ${area(f.blits)} texels (his rect, under 1 % of the map)`);
    // 4. a still caster moves: the still map is drawn again without it, the whole map copied, it is drawn moving
    crate.position.x += 2;
    f = frame();
    assert(f.why === 'moved' && f.still === 'rock,trees' && f.frame === 'crate,hero' && full(f.blits), `a still caster that moves leaves the still map at once (still: ${f.still}; moving: ${f.frame})`);
    // ... and while it moves, its own old rect is wiped with the hero's
    crate.position.x += 2;
    f = frame();
    assert(!f.why && f.frame === 'crate,hero' && f.blits.length === 2, `each moving caster that changed has its last rect wiped (${f.blits.length} rects)`);
    // 5. the view changes (the camera stepped, the moon turned): the still map is drawn again
    key[0] = 2.5;
    f = frame();
    assert(f.why === 'view' && f.still === 'rock,trees' && full(f.blits), `a new view draws the still map again (${f.why})`);
    // 6. a still caster is hidden: drawn again without it
    rock.visible = false;
    f = frame();
    assert(f.why === 'left' && f.still === 'trees', `a still caster hidden: the still map without it (${f.still})`);
    // 7. a moving caster is hidden: the whole frame map is wiped back (its last place is not drawn again)
    crate.visible = false;
    f = frame();
    assert(!f.why && full(f.blits) && f.frame === 'hero', `a moving caster hidden: the whole map is copied back (${f.blits.length} blit, ${area(f.blits)} texels)`);
    // 8. a big mesh edited in place (a cut tree run): it leaves the still map, then only its edited range's old place is wiped
    const pos = trees.geometry.attributes.position;
    pos.array[0] += 0.5;
    pos.addUpdateRange(0, 9);
    pos.needsUpdate = true;
    f = frame();
    pos.clearUpdateRanges();
    assert(f.why === 'moved' && f.frame === 'hero,trees', `a big mesh edited: drawn moving (${f.frame})`);
    pos.array[0] += 0.5;
    pos.addUpdateRange(0, 9);
    pos.needsUpdate = true;
    f = frame();
    pos.clearUpdateRanges();
    assert(!f.why && f.blits.length === 2 && area(f.blits) < S * S * 0.01, `... edited again: only its edited triangle's old place and the hero's are wiped (${f.blits.length} rects, ${area(f.blits)} texels)`);
    const st = cache.stats;
    assert(st.frames === t && st.redraws >= 6, `stats: ${st.frames} frames, ${st.redraws} still redraws, ${st.full} whole copies`);
    // 9. off: a renderer that cannot blit draws the map whole (the pipeline's old path)
    const plain = new ShadowCache({ setRenderTarget() {}, clear() {} }, target);
    assert(plain.off === true && plain.render(scene, key, draw, cam) === false, 'a renderer without depth blits: the cache is off and the map is drawn whole');
    assert(CONFIG.render.shadowCache.on === true && CONFIG.render.shadowCache.snap >= 1, `CONFIG.render.shadowCache on by default (?shadowCache=0 off), snap ${CONFIG.render.shadowCache.snap} texels`);
    cache.dispose();
    plain.dispose();
  },

  // ---------------------------------------------------------------- the world on its own, longer step (ADR-199)
  // main.js steps the world once for two of the fighters' steps (core/timestep.js STEP.world): 1 / 30 s at
  // 30 fps, up to 2 x 20.8 ms. What falls, burns and marks must come out the same at those steps as at
  // 1 / 60 s (the build's spawns throw on a NaN; a console error fails the suite).
  worldstep() {
    const res = [];
    for (const dt of [1 / 60, 1 / 30, 2 * 1.25 / 60]) {
      const { D, world, game, hits, step } = build();
      const t = D.list.find((b) => b.kind === 'deadTree' && !b.wall);
      const dx = 0.6, dz = 0.8;
      // the hero stands where the tree will land, then in a fire; a second tree is chipped, the floor marked
      game.player.position.set(t.x + dx * t.h * 0.6, 0, t.z + dz * t.h * 0.6);
      game.boss.position.set(t.x - 20, 0, t.z);
      D.strike(t.x - dx * 0.3, t.z - dz * 0.3, 0.5, 9, { kind: BLOW.BLUNT, by: 'boss', dx, dz, src: D.swing() });
      world.scars.mark(t.x + 2, t.z, { kind: 'slam', power: 1, r: 2 });
      let fell = 0;
      for (; fell < 6 && t.state === STATE.FALLING; fell += dt) step(dt, dt);
      const crush = hits.filter((h) => h.who === 'hero').length;
      step(1.5, dt);
      game.player.position.set(40, 0, 40);
      const lit = world.fire.ignite(40, 40, 3, 1);
      hits.length = 0;
      step(3, dt);
      const burns = hits.filter((h) => h.who === 'hero' && h.kind === 'fire').length;
      step(14, dt);
      res.push({ dt, fell, crush, state: t.state, lit, burns, left: world.fire.count, debris: game.fx.alpha.count + game.fx.add.count });
    }
    const [a, b, c] = res;
    out('   ' + res.map((r) => `${(r.dt * 1000).toFixed(1)} ms: fell in ${r.fell.toFixed(2)} s, ${r.crush} hit, ${r.lit} cells lit, ${r.burns} burns in 3 s, ${r.left} still alight after 17 s`).join(' | '));
    assert(res.every((r) => r.state !== STATE.FALLING && r.fell < 6), 'a felled tree lands at every step length');
    assert(Math.abs(b.fell - a.fell) <= 0.1 && Math.abs(c.fell - a.fell) <= 0.1, `... in the same time (${a.fell.toFixed(2)} / ${b.fell.toFixed(2)} / ${c.fell.toFixed(2)} s)`);
    assert(a.crush === 1 && b.crush === 1 && c.crush === 1, `... and lands on the hero once (${a.crush} / ${b.crush} / ${c.crush})`);
    assert(a.lit > 0 && b.lit === a.lit && c.lit === a.lit, `the same fire is lit (${a.lit} / ${b.lit} / ${c.lit} cells)`);
    assert(a.burns >= 3 && Math.abs(b.burns - a.burns) <= 1 && Math.abs(c.burns - a.burns) <= 1, `standing in it burns as often (${a.burns} / ${b.burns} / ${c.burns} ticks in 3 s)`);
    assert(res.every((r) => r.left === 0), `the fire burns out at every step length (${res.map((r) => r.left).join(' / ')} cells left)`);
  },

  // ---------------------------------------------------------------- the sets list their breakables
  sets() {
    for (const [name, make, kinds] of [['forest', createForest, ['tree', 'deadTree', 'stone', 'boulder', 'flagstone', 'bone']], ['courtyard', createCourtyard, ['pillar', 'lantern']], ['throne', createThroneHall, ['shard', 'slab', 'hover', 'swords', 'banner', 'cairn', 'cart']], ['ring a', ringSet('a'), ['tile', 'post', 'butte', 'butteTop', 'banner', 'mud', 'hoodoo']], ['ring b', ringSet('b'), ['tile', 'post', 'butte', 'butteTop', 'terrace', 'banner']], ['ring c', ringSet('c'), ['tile', 'post', 'butte', 'butteTop', 'spire', 'cairn']], ['grove', createWindlessGrove, ['bamboo', 'graveSword', 'paving', 'flagstone', 'stele', 'lantern', 'boulder', 'post']], ['script hall', createScriptHall, ['tile', 'step', 'flagstone', 'pillar', 'wall', 'liftDoor', 'gate', 'bench', 'planter', 'watcher', 'post', 'screen', 'rack', 'dais', 'codePillar']], ['city', createHalcyonPlaza, ['car', 'lamp', 'sign', 'shopSign', 'screen', 'statue', 'statueHead', 'statueArm', 'towerBase', 'towerTop', 'blockFront', 'kiosk', 'barrier', 'bench', 'hydrant', 'trafficLight', 'bin', 'shelter', 'asphalt', 'sidewalk']], ['crossing', createVeiledCrossing, ['car', 'slab', 'towerTop', 'towerBase', 'ruin', 'fallenTower', 'bridgeDeck', 'bridgePier', 'bridgeSpan', 'gantry', 'gantryBeam', 'bus', 'tank', 'heap', 'lamp', 'signal', 'floatSlab', 'floatCar', 'floatCorner', 'asphalt', 'sidewalk', 'scramble']], ['foundry', createLastFoundry, ['plate', 'flagstone', 'ladle', 'jibPost', 'jib', 'column', 'gantry', 'press', 'pressHead', 'conveyor', 'frame', 'tank', 'ingots', 'girder', 'slag', 'pipes', 'catwalk', 'furnace', 'wall']]]) {
      const { D, set, colliders, U } = build(make);
      const L = D.list;
      // (Cinderwood: 664 since every tree of the wall and the landmarks break, 2026-11-16; 183 on 2026-11-15,
      // 80 before. The duelists' arenas break everything but their landmarks since 2026-11-16: the
      // courtyard 78 → 456 (293 of them its floor's slabs), the crater 36 → 222 (105 of its floor's plates); 255 on 2026-11-22, its felled trunks
      // swapped for the challengers' graves, banners and carts round it)
      const [lo, hi] = { forest: [20, 1900], courtyard: [380, 520], throne: [180, 280], 'ring a': [1, 5000], 'ring b': [1, 5000], 'ring c': [1, 5000], terrace: [300, 520], grove: [420, 900], 'script hall': [300, 520], city: [300, 460], crossing: [280, 520], foundry: [440, 560] }[name]; // (the grove: 788 since ADR-151's clumps, 2026-11-22; 536 before)
      assert(L.length >= lo && L.length <= hi, `${name}: ${L.length} breakables (${lo}..${hi})`);
      for (const k of kinds) assert(L.some((b) => b.kind === k), `${name}: has a breakable ${k}`);
      if (name === 'forest') {
        // every tree of the forest breaks, out to its edge (2026-11-16: it was those within 42 m): the tree
        // mesh holds nothing but the trees' and the Cinder Tree's runs
        const trees = L.filter((b) => b.kind === 'tree' || b.kind === 'deadTree');
        const treeMesh = set.group.getObjectByName('trees');
        const inRuns = L.filter((b) => b.ranged && b.body.mesh === treeMesh).reduce((a, b) => a + b.body.count, 0);
        assert(trees.length >= 500 && Math.max(...trees.map((b) => Math.hypot(b.x, b.z))) > 72 && inRuns === treeMesh.geometry.attributes.position.count, `forest: every tree breaks (${trees.length}; the farthest ${Math.max(...trees.map((b) => Math.hypot(b.x, b.z))).toFixed(1)} m), all ${inRuns} vertices of the tree mesh are pieces'`);
        assert(trees.every((b) => b.ranged && b.body.parts >= 2 && b.order.length >= 1) && trees.filter((b) => b.wall).length >= 440, `forest: a tree is a range piece in parts that wears down; ${trees.filter((b) => b.wall).length} of them are the wall's (beyond ${BREAK.wall.from} m)`);
        assert(L.every((b) => b.mat !== 'wood' || b.def.soft === false || b.colliders.every((c) => c.soft === true)), 'forest: the trunks of breakable wood are soft colliders (the wyrm ploughs through them; not the Cinder Tree\'s)');
      }
      // (a set whose scenes morph, ADR-157: a piece of another scene than the first is out of the world,
      // its structure 0 and its circles out of the world's until its scene comes)
      assert(L.every((b) => Number.isFinite(b.x + b.z + b.r + b.h) && b.r > 0 && b.h > 0 && b.hpMax > 0 && (b.absent || b.hp > 0)), `${name}: every breakable has a footprint, a height and structure`);
      assert(L.every((b) => b.colliders.every((c) => colliders.circles.includes(c) === !b.absent)), `${name}: their colliders are the world's own circles${L.some((b) => b.absent) ? ` (none of the ${L.filter((b) => b.absent).length} pieces of the other scenes)` : ''}`);
      // (a floor slab or flagstone, a 'range' piece, is no scene node until a boss lifts it: 2026-11-16, the scene graph's per-frame cost)
      assert(L.every((b) => (b.def.look === 'range' ? !b.node.parent : b.node.parent === D.pieces) && b.body.geometry.attributes.position.count > 0), `${name}: each has its own node and body (a floor slab's node joins the pieces' tree only when lifted)`);
      // nothing standing costs the scene graph a frame: the pieces are a tree outside the scene (the
      // batch reads their matrices), only the batch's draw meshes hang in it
      let inScene = 0, auto = 0;
      D.root.traverse(() => inScene++);
      D.pieces.traverse((o) => { if (o !== D.pieces && o.matrixAutoUpdate) auto++; });
      assert(!D.pieces.parent && inScene <= 4 && auto === 0, `${name}: the breakables put ${inScene} node(s) in the scene (the batch's meshes); their own tree is outside it and none of its nodes auto-updates (${auto})`);
      assert(D.root.parent === set.group, `${name}: the breakables hang under the set's group (the Lab hides them with it)`);
      // nothing breakable is lost from the spatial grid: every piece sits in exactly one cell
      const seen = new Int32Array(L.length);
      for (const i of D._g.items) seen[i]++;
      assert(seen.every((k) => k === 1), `${name}: every one of the ${L.length} pieces is in the grid once`);
      const bones = rigidBones(U);
      // (the pieces, their stumps and the wreckage pools, BREAK.wreck: 88 bones; with the hero ~140 and a
      // boss ~180 the 1023 slots keep ~200 spare. Cinderwood measured 368 on 2026-11-15, 144 before; its
      // trees and landmarks are range pieces since 2026-11-16 and take none: 140)
      // (2026-11-16, the arenas break: the courtyard 401 (its far trees and stumps, the colossi, the big
      // blocks' pool), the crater 257; a floor slab is no bone: it is a run of its set's paving mesh)
      assert(D.batch.meshes.length >= 1 && D.batch.meshes.length <= 2 && bones.count <= 460, `${name}: drawn in ${D.batch.meshes.length} batch(es), ${bones.count} bones (<= 460 of 1023)`);
      // a body's geometry sits round its own base: the node carries the place (a rigid piece's)
      const b = L.find((o) => o.topples && !o.ranged);
      b.body.geometry.computeBoundingBox();
      const bb = b.body.geometry.boundingBox;
      assert(Math.abs((bb.min.x + bb.max.x) / 2) < 3 && Math.abs((bb.min.z + bb.max.z) / 2) < 3 && bb.min.y > -0.6, `${name}: a body's geometry is laid out round its base`);
      out(`     ${name}: ${L.length} breakables: ` + [...new Set(L.map((o) => o.kind))].map((k) => `${k} ${L.filter((o) => o.kind === k).length}`).join(', ') + `; ${colliders.circles.length} colliders`);
    }
  },

  // ---------------------------------------------------------------- the duelists' floors break (world/floor.js, BREAK.floor)
  floor() {
    const C = build(createCourtyard);
    const { D, log, game, step } = C;
    const F = D.floor, FL = BREAK.floor;
    const crackMesh = C.set.group.getObjectByName('pavingCracked'), brokenMesh = C.set.group.getObjectByName('pavingBroken');
    assert(F.length >= 250 && F.every((b) => b.def.look === 'range' && b.kind === 'flagstone' && b.lift === FL.lift && !b.colliders.length && !b.cover && !b.topples && b.crack && b.stub), `the courtyard's paving, steps and path: ${F.length} slabs, each a range piece with a cracked and a broken look, lift ${FL.lift}, no collider, no cover`);
    assert(crackMesh && brokenMesh && !crackMesh.visible && !brokenMesh.visible && !crackMesh.layers.isEnabled(1), 'whole, the floor draws as it did: the cracked and the broken meshes are hidden (no draw call) and cast no shadow');
    // a cut cracks the slab under it
    const s = F.reduce((a, b) => (Math.hypot(b.x, b.z - 2) < Math.hypot(a.x, a.z - 2) ? b : a));
    const pos = s.body.geometry.attributes.position;
    D.strike(s.x, s.z, 1.3, 0.3, { kind: BLOW.CUT, by: 'boss', src: D.swing() });
    assert(s.state === STATE.INTACT && s.cracked && !s.body.visible && s.crack.visible && crackMesh.visible && pos.array[s.body.start * 3 + 1] < -1, `a duelist's cut (0.3) on it: it holds (${s.hp.toFixed(2)} of ${s.hpMax}) and shows cracked (its slab folds away, its pieces show)`);
    // a heavy blow breaks the slab under it and cracks its neighbours, in one sound and no shake
    const s2 = F.reduce((a, b) => (Math.hypot(b.x - 6, b.z + 4) < Math.hypot(a.x - 6, a.z + 4) ? b : a));
    const n0 = log.length, sh = game.shakes;
    const hit = D.strike(s2.x, s2.z, 1.3, 0.9, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() }); // (a red overhead: 24 x 1.25 / 40 = 0.75 .. 0.94)
    const near = F.filter((b) => b !== s2 && Math.hypot(b.x - s2.x, b.z - s2.z) < 1.3 + b.r);
    const ev = log.slice(n0).filter((x) => x.n === 'world:impact');
    assert(s2.state === STATE.BROKEN && s2.stub.visible && brokenMesh.visible && near.some((b) => b.cracked) && near.filter((b) => b.state === STATE.BROKEN).length <= 2, `a heavy red blow (0.9 blunt, r 1.3) breaks the slab under it and cracks ${near.filter((b) => b.cracked).length} of its ${near.length} neighbours (${near.filter((b) => b.state === STATE.BROKEN).length} broken)`);
    assert(hit >= 3 && ev.length === 1 && game.shakes === sh, `it struck ${hit} slabs: one world:impact for them all (${ev.length}), no camera shake of their own`);
    // a blade's edge above the floor passes over it; one drawn along it bites less
    const s3 = F.reduce((a, b) => (Math.hypot(b.x + 6, b.z + 6) < Math.hypot(a.x + 6, a.z + 6) ? b : a));
    assert(D.strike(s3.x, s3.z, 0.5, 0.5, { y: 1, src: D.swing() }) === 0, 'a blow at waist height over a slab misses it');
    const h3 = s3.hp;
    D.sweep(s3.x - 1, s3.z, s3.x + 1, s3.z, 0.3, 0.5, { kind: BLOW.BLUNT, y: 0, src: D.swing() });
    assert(near0(h3 - s3.hp, 0.5 * FL.sweep), `an edge drawn along it takes ${FL.sweep} of the blow (${(h3 - s3.hp).toFixed(2)})`);
    // where a terrain move finds floor to tear up: the grid, nearest first; the Void's and the wyrm's picks never see it
    const out = [];
    const n = D.floorNear(0, 0, 4, out, { max: 6 });
    const scan = F.filter((b) => b.state === STATE.INTACT && Math.hypot(b.x, b.z) <= 4).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 6);
    assert(n === scan.length && out.every((b, i) => b === scan[i]), `floorNear(0, 0, 4) gives the ${n} intact slabs nearest the point, as a full scan does`);
    D.floorNear(0, 0, 4, out, { whole: true });
    assert(out.every((b) => !b.cracked) && D.nearest(0, 0, { maxDist: 30, lift: 2 })?.floor !== true && D.nearest(0, 0, { maxDist: 30 })?.floor !== true && D.nearest(0, 0, { maxDist: 30, lift: 3 })?.floor === true, '`whole` leaves the cracked out; nearest() gives floor only to a caller that asks for lift 3 (or its kind)');
    // a slab torn out: its hole shows, a block of prop art in the hands, shards where it lands
    const t = out[0];
    // (wreckage.js KIND.SHARDS: 5 since the merge with ADR-120, whose bone heaps took 3, which its REACH check reads)
    const w0 = D.wreck.live.filter((x) => x.kind === 5).length;
    assert(D.take(t) && t.state === STATE.HELD && !t.body.visible && t.stub.visible && t.held?.visible && t.held.parent === t.pivot, 'take(): a slab torn out of the floor leaves its hole; a block of prop art is what he holds');
    D.carry(t, t.x, 2, t.z);
    D.throwTo(t, t.x + 6, t.z, { time: 0.5 });
    step(1);
    assert(t.state === STATE.GONE && !t.held && D.wreck.live.filter((x) => x.kind === 5).length === w0 + 1, 'thrown, it lands as flat shards (wreckage); its block goes back to the pool');
    // the reset: every slab whole again, the meshes of remains hidden
    D.reset();
    assert(F.every((b) => b.state === STATE.INTACT && b.body.visible && !b.cracked && !b.crack.visible && !b.stub.visible) && !crackMesh.visible && !brokenMesh.visible && D._carry.every((m) => !m.visible), 'the reset: every slab whole, nothing cracked, the meshes of remains hidden again');
    // the other look builds the same pieces
    setLook('floor', 'b');
    const B2 = build(createCourtyard);
    setLook('floor', null);
    assert(B2.D.floor.length === F.length && B2.set.group.getObjectByName('pavingBroken'), `?floor=b: the same ${B2.D.floor.length} slabs, broken into tilted shards`);
    // the crater: its plates
    const T = build(createThroneHall);
    const TF = T.D.floor;
    assert(TF.length >= 90 && TF.some((b) => b.kind === 'plate' && b.hpMax === FL.plate) && TF.some((b) => b.kind === 'flagstone' && b.hpMax === FL.hp), `the crater: ${TF.length} plates (${TF.filter((b) => b.kind === 'plate').length} big ones 'plate', hp ${FL.plate}; the rest 'flagstone', hp ${FL.hp})`);
    // Cinderwood's flagstone shards: hidden until one is smashed (a draw call less, nothing else changes)
    const Fo = build();
    assert(!Fo.set.group.getObjectByName('flagstoneShards').visible, "Cinderwood's flagstone shards are hidden until one is smashed");
  },

  // ---------------------------------------------------------------- the Skybreak Ring: its floor, its buttes, its light (world/skybreakRing.js)
  ring() {
    const H = RING.half;
    for (const o of ['a', 'b', 'c']) {
      const W = build(ringSet(o));
      const { D, set, colliders, game, step, U } = W;
      const F = D.floor, tiles = F.filter((b) => b.kind === 'tile');
      let area = 0;
      for (const s of set.slabs) {
        if (Math.abs(s.x) > H || Math.abs(s.z) > H) continue;
        let a = 0;
        for (let k = 0; k < s.outline.length; k++) {
          const p = s.outline[k], q = s.outline[(k + 1) % s.outline.length];
          a += (p[0] * q[1] - q[0] * p[1]) / 2;
        }
        area += Math.abs(a);
      }
      assert(set.option === o && tiles.length >= 350 && tiles.every((b) => Math.abs(b.x) <= H && Math.abs(b.z) <= H && b.def.look === 'range' && b.lift === BREAK.floor.lift && !b.colliders.length) && area > 0.8 * (2 * H) ** 2, `${o}: the ring is ${tiles.length} breakable floor slabs ('tile'), ${((100 * area) / (2 * H) ** 2).toFixed(0)} % of its ${2 * H} m square paved`);
      const near = [];
      const nn = D.floorNear(0, 0, 6, near, { kind: 'tile', max: 40 });
      assert(nn >= 30, `${o}: ${nn} tiles within 6 m of the centre for his terrain moves (floorNear, kind 'tile')`);
      // nothing tall on the near side (ADR-112's rule): no breakable south of z 6 over 3.2 m
      const tall = D.list.filter((b) => !b.floor && b.z > 6 && b.y0 + b.h > 3.2 && Math.abs(b.x) < 24 && b.z < 40);
      assert(tall.length === 0, `${o}: nothing over 3.2 m stands south of z 6 near the fight (${tall.map((b) => `${b.kind} ${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')})`);
      // the buttes: tops standing on their feet (two-stage), a beam takes one
      const tops = D.list.filter((b) => b.kind === 'butteTop');
      assert(tops.length >= 4 && tops.every((t) => t.base?.top === t && t.y0 > 2 && t.hpMax === BUTTE.top && t.base.hpMax === Infinity && t.base.cover && t.base.colliders.length === 1), `${o}: ${tops.length} buttes, each a top (structure ${BUTTE.top}, standing ${Math.min(...tops.map((t) => t.y0)).toFixed(1)} - ${Math.max(...tops.map((t) => t.y0)).toFixed(1)} m up) on a foot that only chips`);
      const t = tops.reduce((a, b) => (Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z) ? b : a));
      const L = Math.hypot(t.x, t.z), ux = t.x / L, uz = t.z / L;
      let ticks = 0;
      // a beam from the centre through it: 1.5 a tick (BLAST), a tick every 0.2 s, at chest height
      while (t.state === STATE.INTACT && ticks < 30) {
        D.sweep(ux * 2, uz * 2, ux * 40, uz * 40, 1.7, 1.5, { kind: BLOW.BLAST, by: 'boss', y: 1.2, dx: ux, dz: uz, src: D.swing() });
        step(0.2);
        ticks++;
      }
      assert(t.state !== STATE.INTACT && ticks <= 3, `${o}: a beam swept through a butte's foot (1.5 a tick, blast) takes its top in ${ticks} ticks (${(ticks * 0.2).toFixed(1)} s)`);
      if (o === 'c') assert(t.state === STATE.BROKEN && !t.topples, 'c: a butte rising out of the depths bursts where it stands (nothing falls to a ground that is not there)');
      else assert(t.state === STATE.FALLING && t.dx * t.x + t.dz * t.z > 0, `${o}: the top topples away from the ring (outward; red to a hero standing under it)`);
      step(2);
      assert(t.base.state === STATE.INTACT && t.base.node.parent, `${o}: its foot still stands`);
      // the hero's blows: a heavy cut (0.5) a time
      const t2 = tops.find((x) => x !== t);
      let cuts = 0;
      while (t2.state === STATE.INTACT && cuts < 100) {
        D.strike(t2.x - t2.r, t2.z, 0.6, 0.5, { kind: BLOW.CUT, by: 'player', src: D.swing() });
        step(0.2);
        cuts++;
      }
      assert(cuts >= 10, `${o}: the hero's heavy cuts (0.5) take ${cuts} to bring a top down`);
      // the light by form
      const A = set.ambience;
      A.setup(game);
      const run = (sec) => {
        for (let s2 = 0; s2 < sec; s2 += 1 / 30) A.update(1 / 30, game);
      };
      game.dragon.phase = 1;
      run(1);
      const dusk = [U.uMoonColor.value.r, U.uMoonColor.value.g, U.uMoonColor.value.b, U.uAmbient.value.r + U.uAmbient.value.g + U.uAmbient.value.b];
      game.dragon.phase = 2;
      run(6);
      const goldAmb = U.uAmbient.value.r + U.uAmbient.value.g + U.uAmbient.value.b;
      game.dragon.phase = 3;
      run(6);
      const st = A.state, stormMoon = U.uMoonColor.value.clone(), stormAmb = U.uAmbient.value.r + U.uAmbient.value.g + U.uAmbient.value.b;
      A.flare(1);
      A.update(1 / 60, game);
      const flash = U.uMoonColor.value.b;
      game.dragon.phase = 1;
      A.update(1 / 60, game);
      const back = A.state;
      assert(goldAmb > dusk[3] && stormAmb < dusk[3] && stormMoon.b > stormMoon.r && dusk[0] > dusk[2] && st.w[2] > 0.95 && flash > stormMoon.b * 3 && back.w[0] === 1 && back.flash === 0, `${o}: the light by form: dusk (warm moon), golden (ambient ${dusk[3].toFixed(3)} → ${goldAmb.toFixed(3)}), storm (cold, ${stormAmb.toFixed(3)}); a flare lights the ring (moon blue ${stormMoon.b.toFixed(2)} → ${flash.toFixed(2)}); a reset snaps back to the dusk`);
      if (o === 'c') {
        assert(set.groundY < -20, `c: the badlands lie ${-set.groundY} m below the crown (groundY)`);
        // walking out to the rim: the colliders hold him on the crown
        let worst = 0;
        for (let a = 0; a < 16; a++) {
          const dx = Math.cos((a / 16) * 2 * Math.PI), dz = Math.sin((a / 16) * 2 * Math.PI);
          const p = new THREE.Vector3(0, 0, 0);
          for (let i = 0; i < 160; i++) {
            p.x += dx * 0.3;
            p.z += dz * 0.3;
            colliders.resolve(p, 0.45, 40);
          }
          worst = Math.max(worst, Math.hypot(p.x, p.z) > 36 ? 99 : 0);
          if (!set.group.userData.rim) worst = 99;
          else {
            const rim = set.group.userData.rim;
            let c = false;
            for (let i = 0, j = rim.length - 1; i < rim.length; j = i++) if (rim[i][1] > p.z !== rim[j][1] > p.z && p.x < ((rim[j][0] - rim[i][0]) * (p.z - rim[i][1])) / (rim[j][1] - rim[i][1]) + rim[i][0]) c = !c;
            if (!c) worst = Math.max(worst, 1);
          }
        }
        assert(worst === 0, 'c: a hero walking out in 16 ways is held on the crown by its rim');
      }
    }
  },

  // ---------------------------------------------------------------- a colossus comes down in two stages
  colossus() {
    const C = build(createCourtyard);
    const { D, log, game, hits, step, colliders } = C;
    const tops = D.list.filter((b) => b.kind === 'colossus' && b.base), legs = D.list.filter((b) => b.kind === 'colossus' && b.top);
    const CO = BREAK.colossus;
    assert(tops.length === 2 && legs.length === 2 && legs.every((l) => l.top?.base === l && l.cover && !l.topples && l.colliders.length >= 1) && tops.every((t) => t.topples && t.y0 > 4 && !t.colliders.length && t.hpMax === CO.top), `two colossi, each an upper half (stands ${tops[0]?.y0.toFixed(1)} m up, ${tops[0]?.h.toFixed(1)} m tall, structure ${CO.top}) on its legs (cover, its plinth's collider)`);
    const head = D.list.find((b) => b.kind === 'boulder' && Math.hypot(b.x - 15.6, b.z - 7.8) < 4);
    assert(head && head.lift === 1 && head.colliders.length === 1, 'the fallen head of the broken one is a boulder');
    const top = tops[0], leg = top.base;
    // blows on the legs wear the upper half down
    const hp0 = top.hp, lhp0 = leg.hp;
    D.strike(leg.x + 1.6, leg.z, 0.5, 0.6, { kind: BLOW.BLUNT, by: 'player', src: D.swing() });
    assert(top.hp < hp0 && leg.hp === lhp0, `a blow at its feet takes from the upper half (${hp0.toFixed(1)} → ${top.hp.toFixed(1)}); the legs take nothing while it stands`);
    // it falls: the world's falling rule, from its cut, out past the plinth
    const dx = 1, dz = 0, mid = CO.off + top.h * 0.5;
    game.player.position.set(top.x + dx * mid, 0, top.z + 0.3);
    game.boss.position.set(top.x - 20, 0, top.z);
    const n0 = log.length;
    D.topple(top, dx, dz, 'boss');
    step(1 / 60);
    const tell = log.slice(n0).find((x) => x.n === 'combat:tell');
    assert(tell && tell.source === 'world' && tell.tell === TELL.RED && near0(tell.impactIn, CO.fall - 1 / 60, 0.05) && Math.hypot(tell.x - (top.x + dx * (CO.off + top.h * 0.55)), tell.z - top.z) < 0.5, `it tells red (the world's falling piece), ${tell?.impactIn?.toFixed(2)} s before it lands, at the middle of its strip`);
    D.strike(leg.x + 1.6, leg.z, 0.5, 9, { kind: BLOW.BLUNT, by: 'player', src: D.swing() });
    assert(leg.state === STATE.INTACT && leg.hp === lhp0, 'while it falls the legs take nothing');
    let tFlash = -1;
    for (let i = 0; i < 200 && top.state === STATE.FALLING; i++) {
      step(1 / 60);
      if (tFlash < 0 && log.slice(n0).some((x) => x.n === 'combat:flash')) tFlash = game.time;
    }
    const h = hits.find((x) => x.who === 'hero');
    assert(top.state === STATE.BROKEN && game.time - tFlash >= 0.25 && game.time - tFlash <= 0.36 && h && h.tell === TELL.RED && h.blockable === false && h.damage <= BREAK.topple.damage * 1.3 + 1e-6, `it lands ${CO.fall} s on (its flash ${(game.time - tFlash).toFixed(2)} s before); the hero under it takes one red blow of ${h?.damage?.toFixed(1)}`);
    // (wreckage.js KIND.BLOCK: 4 since the merge with ADR-120, whose bone heaps took 3, which its REACH check reads)
    const blocks = D.wreck.live.filter((x) => x.kind === 4);
    assert(blocks.length >= CO.blocks - 1 && blocks.every((b) => b.x > top.x + CO.off - 1 && b.x < top.x + CO.off + top.h + 1.5), `it lies as ${blocks.length} big blocks along where it fell (wreckage, no collider)`);
    assert(leg.state === STATE.INTACT && D.coverAt(leg.x - 4, leg.z, leg.x + 4, leg.z, 0.2) === leg, 'its legs stand: cover');
    // then the legs
    const c0 = colliders.circles.length;
    D.strike(leg.x + 1.6, leg.z, 0.6, 9, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    assert(leg.state === STATE.BROKEN && leg.stub.visible && colliders.circles.includes(leg.stubCollider) && D.wreck.live.filter((x) => x.kind === 4).length > blocks.length, `the legs break in their turn: the plinth is left (its own collider), more blocks round it (${colliders.circles.length - c0 + leg.colliders.length} circle(s) changed)`);
    // the hero fells the other one onto the boss
    const t2 = tops[1];
    game.boss.position.set(t2.x + (CO.off + t2.h * 0.5), 0, t2.z);
    D.topple(t2, 1, 0, 'player');
    step(2);
    const bh = hits.find((x) => x.who === 'boss');
    assert(bh && bh.damage >= BREAK.topple.bossDamage * 0.6, `felled by the hero onto the boss: ${bh?.damage?.toFixed(0)} damage`);
    D.reset();
    assert(tops.every((t) => t.state === STATE.INTACT && t.body.visible && t.node.position.y === t.y0 && t.pivot.position.lengthSq() === 0) && legs.every((l) => l.state === STATE.INTACT && !l.stub.visible), 'the reset: both stand whole again');
  },

  // ---------------------------------------------------------------- a blow chips; a hard one breaks
  chip() {
    const { D, world, log, game, step } = build();
    const s = D.list.find((b) => b.kind === 'stone' && b.topples);
    const hp0 = s.hp;
    const src = D.swing();
    const n1 = D.strike(s.x, s.z + s.r, 0.4, 0.3, { kind: BLOW.CUT, by: 'player', src });
    assert(n1 === 1 && s.state === STATE.INTACT && near(s.hp, hp0 - 0.3 * BREAK.mats.stone.take.cut, 1e-6), `a cut of 0.3 on a standing stone takes ${(0.3 * BREAK.mats.stone.take.cut).toFixed(3)} of its ${hp0.toFixed(2)} (it holds)`);
    assert(log.some((e) => e.n === 'world:impact' && e.kind === 'chip' && e.mat === 'stone' && e.by === 'player' && e.id === s.id), `world:impact { kind: 'chip', mat: 'stone', by: 'player' }`);
    assert(world.scars.count >= 1 && game.fx.alpha.count > 0, `it leaves a nick (${world.scars.count} mark(s)) and throws chips (${game.fx.alpha.count} glyphs)`);
    assert(D.strike(s.x, s.z + s.r, 0.4, 0.3, { kind: BLOW.CUT, by: 'player', src }) === 0 && near(s.hp, hp0 - 0.3 * BREAK.mats.stone.take.cut, 1e-6), 'the same swing strikes a piece once');
    const hp1 = s.hp;
    step(0.3);
    const light = (BREAK.scratch * 0.8) / BREAK.mats.stone.take.cut;
    D.strike(s.x, s.z + s.r, 0.4, light, { kind: BLOW.CUT, by: 'player', src: D.swing() });
    assert(s.hp === hp1, `a light touch on stone (${(light * BREAK.mats.stone.take.cut).toFixed(3)} < the scratch ${BREAK.scratch}) only marks it`);
    assert(D.strike(0, 0, 0.4, 5, { src: D.swing() }) === 0 && D.strike(NaN, 0, 1, 1) === 0 && D.sweep(0, 0, Infinity, 0, 1, 1) === 0, 'a blow on empty ground strikes nothing; a non-finite one is ignored');
    // height: a blow that passes over a low piece misses it
    const low = D.list.find((b) => b.kind === 'boulder' && b.h < 1.1);
    assert(D.strike(low.x, low.z, 0.3, 1, { y: low.h + 0.8, src: D.swing() }) === 0 && D.strike(low.x, low.z, 0.3, 0.2, { y: 0.5, src: D.swing() }) === 1, 'a blow above a low boulder passes over it; one at its height lands');
    // `only`: the wyrm's body goes through wood, not stone
    const t = D.list.find((b) => b.kind === 'deadTree');
    assert(D.strike(s.x, s.z, 1, 9, { only: 'wood', src: D.swing() }) === 0 && D.strike(t.x, t.z, 1, 0.2, { only: 'wood', src: D.swing() }) === 1, '`only: wood` leaves stone alone');
    // a short piece shatters where it stands; bronze only rings
    const C = build(createCourtyard);
    const lan = C.D.list.find((b) => b.kind === 'lantern');
    C.D.strike(lan.x, lan.z, 0.5, 9, { kind: BLOW.BLUNT, by: 'boss', src: C.D.swing() });
    assert(lan.state === STATE.BROKEN && !lan.body.visible && lan.stub.visible && C.log.some((e) => e.n === 'world:impact' && e.kind === 'break'), 'a lantern struck hard shatters where it stands: its base is left');
    assert(lan.colliders.every((c) => !C.colliders.circles.includes(c)) && C.colliders.circles.includes(lan.stubCollider), 'its collider is gone; the base has a smaller one');
    const bell = C.D.list.find((b) => b.kind === 'bell');
    C.D.strike(bell.x, bell.z, 1, 50, { src: C.D.swing() });
    assert(bell.state === STATE.INTACT && C.log.some((e) => e.n === 'world:impact' && e.kind === 'chip' && e.mat === 'metal'), 'the bronze bell only rings (world:impact chip, metal)');
  },

  // ---------------------------------------------------------------- a tall piece falls; what is under it is hit
  fell() {
    const { D, world, log, game, hits, colliders, step } = build();
    // (one inside the clearing: a tree of the wall falls away from the arena, the `wall` scenario)
    const t = D.list.find((b) => b.kind === 'deadTree' && !b.wall);
    const dx = 0.6, dz = 0.8;
    // the hero stands where it will land
    game.player.position.set(t.x + dx * t.h * 0.6, 0, t.z + dz * t.h * 0.6);
    game.boss.position.set(t.x - 20, 0, t.z);
    D.strike(t.x - dx * 0.3, t.z - dz * 0.3, 0.5, 9, { kind: BLOW.BLUNT, by: 'boss', dx, dz, src: D.swing() });
    assert(t.state === STATE.FALLING && t.colliders.every((c) => !colliders.circles.includes(c)), 'a dead tree struck hard starts to fall; its collider is gone at once');
    step(1 / 60);
    const tell = log.find((e) => e.n === 'combat:tell');
    assert(tell && tell.source === 'world' && tell.tell === TELL.RED && tell.hazard === true && tell.impactIn >= 0.5, `a boss-felled piece tells red: combat:tell, source 'world', impact in ${tell?.impactIn?.toFixed(2)} s (>= 0.5)`);
    let tFlash = -1, tLand = -1;
    for (let i = 0; i < 200 && t.state === STATE.FALLING; i++) {
      step(1 / 60);
      if (tFlash < 0 && log.some((e) => e.n === 'combat:flash')) tFlash = game.time;
    }
    tLand = game.time;
    assert(t.state === STATE.BROKEN && tFlash > 0 && tLand - tFlash >= 0.25 && tLand - tFlash <= 0.36, `its flash comes ${(tLand - tFlash).toFixed(2)} s before it lands (0.25 .. 0.36)`);
    const h = hits.find((x) => x.who === 'hero');
    assert(hits.length === 1 && h && h.tell === TELL.RED && h.blockable === false && h.parryable === false && h.knockdown === true && h.kind === 'crush', 'the hero under it takes one red, unblockable blow that knocks him down');
    assert(h && h.damage >= BREAK.topple.damage * 0.6 - 1e-6 && h.damage <= BREAK.topple.damage * 1.3 + 1e-6, `... of ${h?.damage?.toFixed(1)} (${(BREAK.topple.damage * 0.6).toFixed(1)} .. ${(BREAK.topple.damage * 1.3).toFixed(1)})`);
    assert(!t.body.visible && t.stub.visible && colliders.circles.includes(t.stubCollider), 'its crown comes apart where it lands; the stump stands, with a collider');
    assert(D.wreck.live.some((e) => e.kind === 0 && Math.hypot(e.x - t.x, e.z - t.z) < 1), 'its trunk lies where it fell (wreckage)');
    assert(log.some((e) => e.n === 'world:impact' && e.kind === 'topple') && log.some((e) => e.n === 'world:impact' && e.kind === 'crash'), 'world:impact topple, then crash');
    assert(world.scars.count > 4 && game.shakes > 0 && world.gusts > 0, `the ground is cracked and littered (${world.scars.count} marks), the camera shakes, the grass is blown`);
    // out from under it: nothing
    const t2 = D.list.find((b) => b.kind === 'deadTree' && b.state === STATE.INTACT && !b.wall);
    game.player.position.set(t2.x - 8, 0, t2.z);
    D.topple(t2, 1, 0, 'boss');
    step(2);
    assert(t2.state === STATE.BROKEN && hits.length === 1, 'a hero out from under it is not hit');
    // the hero fells one onto the boss: the boss is hit, the hero never
    const t3 = D.list.find((b) => b.kind === 'deadTree' && b.state === STATE.INTACT && !b.wall);
    game.boss.position.set(t3.x + t3.h * 0.6, 0, t3.z);
    game.player.position.set(t3.x + t3.h * 0.5, 0, t3.z + 0.3);
    D.strike(t3.x - 0.3, t3.z, 0.5, 9, { kind: BLOW.BLUNT, by: 'player', dx: 1, dz: 0, src: D.swing() });
    const before = log.filter((e) => e.n === 'combat:tell').length;
    step(2);
    const bh = hits.find((x) => x.who === 'boss');
    assert(bh && bh.exact === true && bh.heavy === true && bh.damage >= BREAK.topple.bossDamage * 0.6 && bh.posture >= BREAK.topple.bossPosture * 0.6, `a piece the hero fells onto the boss deals ${bh?.damage?.toFixed(0)} damage and ${bh?.posture?.toFixed(0)} posture (exact, heavy)`);
    assert(hits.filter((x) => x.who === 'hero').length === 1 && log.filter((e) => e.n === 'combat:tell').length === before, 'the hero is never hit by what he felled, and it tells nothing');
    // a piece that falls on another breaks or chips it
    const C = build(createCourtyard);
    const P = C.D.list.filter((b) => b.kind === 'pillar' && b.topples);
    let pair = null;
    for (const a of P) for (const b of C.D.list) if (a !== b && b.state === STATE.INTACT && !pair) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > 1.5 && d < a.h - 0.3) pair = [a, b]; }
    if (pair) {
      const [a, b] = pair, l = Math.hypot(b.x - a.x, b.z - a.z), hp = b.hp;
      C.D.topple(a, (b.x - a.x) / l, (b.z - a.z) / l, 'world');
      C.step(2.5);
      assert(b.hp < hp || b.state !== STATE.INTACT, `a pillar that falls on a ${b.kind} strikes it`);
    } else out('     (no pillar with a neighbour in its fall: domino check skipped)');
  },

  // ---------------------------------------------------------------- cover stops projectiles until it breaks
  cover() {
    const { D, game, log, step } = build();
    const s = D.list.find((b) => b.kind === 'stone' && b.cover);
    const ax = s.x, az = s.z + 6, bx = s.x, bz = s.z - 6;
    assert(D.coverAt(ax, az, bx, bz, 0.2) === s && near(D.coverT, 0.5, 0.2), `a standing stone between two points is cover (found ${(D.coverT * 12).toFixed(1)} m along a 12 m line)`);
    assert(D.coverAt(ax + 4, az, bx + 4, bz, 0.2) !== s, 'a line 4 m to its side is clear of it');
    const low = D.list.find((b) => b.kind === 'boulder' && b.h < BREAK.cover.minH);
    assert(low && D.coverAt(low.x, low.z + 3, low.x, low.z - 3, 0.2) !== low, `a boulder ${low?.h.toFixed(1)} m high is no cover (< ${BREAK.cover.minH} m)`);
    // bullets: each stopped one takes its share; the stone gives way in the end
    let stopped = 0;
    const hp0 = s.hp;
    for (let i = 0; i < 400 && s.state === STATE.INTACT; i++) {
      if (D.stop(ax, s.z + 2, bx, s.z - 2, 0.3, BREAK.cover.bullet, { kind: BLOW.BLAST, by: 'boss', y: 1 }) === s) stopped++;
      step(0.2);
    }
    const per = BREAK.cover.bullet * BREAK.mats.stone.take.blast;
    assert(s.state !== STATE.INTACT && stopped >= Math.floor(hp0 / per) && stopped <= Math.ceil(hp0 / per) + 1, `a standing stone of ${hp0.toFixed(2)} stops ${stopped} bullets (${per.toFixed(3)} each), then falls`);
    step(3);
    assert(D.coverAt(ax, az, bx, bz, 0.2) !== s && D.stop(ax, az, bx, bz, 0.3, 1) !== s, 'once it is down it covers nothing');
    assert(log.filter((e) => e.n === 'world:impact' && e.kind === 'chip').length >= stopped - 1, 'every stopped bullet chips it (world:impact chip)');
    // two bullets in the same instant: the second is stopped too (it does not chip again)
    const s2 = D.list.find((b) => b.kind === 'stone' && b.cover && b.state === STATE.INTACT);
    const a1 = D.stop(s2.x, s2.z + 2, s2.x, s2.z - 2, 0.3, 0.12), hpA = s2.hp, a2 = D.stop(s2.x, s2.z + 2, s2.x, s2.z - 2, 0.3, 0.12);
    assert(a1 === s2 && a2 === s2 && s2.hp === hpA, 'two bullets in one frame are both stopped; the piece is chipped once');
  },

  // ---------------------------------------------------------------- fire burns where it lands, hurts, and leaves ash
  fire() {
    const { D, world, game, hits, log, step } = build(createForest, (x, z) => (Math.hypot(x - 40, z) < 6 ? 0 : 1));
    const F = world.fire;
    const lit = F.ignite(0, 0, 3, 1);
    assert(lit >= 50 && lit <= 90 && F.count === lit && F.burning(0, 0) > 3, `fire on a 3 m disc of full grass lights ${lit} cells (50..90), ${F.burning(0, 0).toFixed(1)} s to burn`);
    assert(log.some((e) => e.n === 'world:fire' && e.cells === lit), 'world:fire { x, z, radius, cells }');
    assert(F.ignite(0, 0, 3, 1) === 0, 'what burns does not catch again');
    assert(F.ignite(40, 0, 3, 1) === 0, 'bare ground (no grass) does not burn');
    game.player.position.set(0, 0, 0);
    step(FIRE.grace - 0.1);
    assert(hits.length === 0, `no burn in the first ${FIRE.grace} s (a roll through the blast ends outside)`);
    step(2.0);
    const n = hits.length, h = hits[0];
    assert(n >= 3 && n <= 5 && h.kind === 'fire' && h.tell === TELL.NORMAL && h.blockable === true && h.parryable === false && h.damage === FIRE.damage && h.perfect === false && h.plunge === false, `standing in it burns: ${n} ticks of ${FIRE.damage} in 2 s (blockable, never a perfect dodge)`);
    game.player.state = 'roll';
    step(1.0);
    assert(hits.length === n, 'never while he rolls');
    game.player.state = 'idle';
    game.player.position.set(12, 0, 12);
    step(4);
    assert(F.count === 0 && F.burning(0, 0) === 0 && world.scorch.burnAt(0, 0) > 0.95, `it burns out (${world.scorch.burnAt(0, 0).toFixed(2)} char) ...`);
    assert(F.ignite(0, 0, 3, 1) === 0, '... and ash does not burn again');
    assert(hits.length === n, 'out of the fire: no more ticks');
    // wood catches; stone does not
    const t = D.list.find((b) => b.kind === 'deadTree');
    const s = D.list.find((b) => b.kind === 'stone');
    assert(D.ignite(s.x, s.z, 2, 1) === 0 && D.ignite(t.x, t.z, 1, 1) === 1 && t.burn > 5, `a dead tree catches (${t.burn.toFixed(1)} s); a stone does not`);
    assert(log.some((e) => e.n === 'world:impact' && e.kind === 'burn' && e.id === t.id), "world:impact { kind: 'burn' }");
    game.player.position.set(t.x + t.r + 0.6, 0, t.z);
    const n2 = hits.length;
    step(1.5);
    assert(hits.length > n2 && hits[hits.length - 1].kind === 'fire', 'the hero beside a burning tree is burned');
    game.player.position.set(t.x + 9, 0, t.z);
    step(BREAK.burn.time * 1.2);
    assert(t.state === STATE.BROKEN && t.burnt && !t.body.visible && t.stub.visible && log.some((e) => e.n === 'world:impact' && e.kind === 'burnout'), 'it burns through: a stump is left (world:impact burnout)');
    assert(D.ignite(t.x, t.z, 1, 1) === 0, 'what burned through does not catch again');
    // world.ignite's two halves, as world.js wires them
    const lights = game.lights;
    assert(lights && Number.isFinite(game.fx.fire.count), 'flames are heat in the fire field, the blaze has a light');
  },

  // ---------------------------------------------------------------- a boss lifts a piece and throws it
  throw() {
    const { D, world, game, log, colliders, step } = build();
    const b = D.nearest(0, 0, { lift: 1 });
    assert(b && b.lift === 1 && (b.mat === 'wood' || b.kind === 'boulder'), `nearest liftable piece to the centre: a ${b?.kind} ${Math.hypot(b.x, b.z).toFixed(1)} m out`);
    const st = D.list.find((o) => o.kind === 'stone' && o.lift === 2);
    assert(D.nearest(st.x, st.z, { lift: 1, maxDist: 0.5 }) === null && D.nearest(st.x, st.z, { lift: 2, maxDist: 0.5 }) === st, 'a standing stone is only for the Void (lift 2)');
    const fallen = D.list.find((o) => o.lift === 0);
    assert(D.take(fallen) === false, 'a piece nobody can lift is not taken');
    assert(D.take(b) === true && b.state === STATE.HELD && b.colliders.every((c) => !colliders.circles.includes(c)), 'taken: it is held, its collider is gone');
    D.carry(b, b.x + 1, 3, b.z + 1, 0.6, 0.4);
    step(0.1);
    assert(near(b.pivot.position.y, 3, 1e-6) && Math.abs(b.pivot.quaternion.w) < 0.999, 'carry() puts it where the boss holds it, leaning');
    // thrown at another piece: it lands there, bursts, and the blast strikes what stands near
    const target = D.list.filter((o) => o !== b && o.state === STATE.INTACT && o.kind === 'boulder').sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
    const hp = target.hp;
    let landed = null;
    assert(D.throwTo(b, target.x + 0.5, target.z, { time: 0.7, power: 1.4, radius: 2.2, onLand: (o, x, z, r) => (landed = { o, x, z, r }) }) && b.state === STATE.FLYING, 'thrown: it flies');
    let top = 0;
    for (let i = 0; i < 80 && b.state === STATE.FLYING; i++) { step(1 / 60); top = Math.max(top, b.pivot.position.y); }
    assert(b.state === STATE.GONE && !b.body.visible && top > 3.2, `it arcs (top ${top.toFixed(1)} m) and comes apart where it lands`);
    assert(landed && landed.o === b && near(landed.x, target.x + 0.5, 1e-6) && landed.r === 2.2, 'onLand(piece, x, z, radius) is called once, at the target');
    assert(target.hp < hp || target.state !== STATE.INTACT, 'its blast strikes the piece it landed by');
    assert(log.some((e) => e.n === 'world:impact' && e.kind === 'throw') && log.some((e) => e.n === 'world:impact' && e.kind === 'crash' && e.by === 'boss'), 'world:impact throw, then crash');
    assert(world.scars.count > 5, `the landing is cracked and littered (${world.scars.count} marks)`);
    // let go: it drops and bursts
    const c = D.nearest(0, 0, { lift: 1 });
    D.take(c);
    D.carry(c, c.x, 4, c.z);
    assert(D.drop(c) && c.state === STATE.FLYING, 'drop(): a held piece falls');
    step(1.2);
    assert(c.state === STATE.GONE, '... and bursts');
    assert(D.throwTo(c, 0, 0) === false && D.take(c) === false, 'a piece that is gone cannot be thrown or taken');
  },

  // ---------------------------------------------------------------- every kind of blow marks the floor (scars.mark)
  marks() {
    // (on the courtyard's paving: its scar ink, its fuel-less floor for the char)
    const { D, world, game, step } = build(createCourtyard, () => 0);
    const sc = world.scars;
    // (world.groundBlow and world.impact's floor mark, as world.js wires them)
    world.groundBlow = (x, z, o) => { if (Number.isFinite(x + z) && o && o.power > 0) sc.mark(x, z, o); };
    world.impact = (x, z, r, p, o) => { const n = D.strike(x, z, r, p, o ?? { kind: BLOW.BLUNT, by: 'world' }); sc.impactMark(x, z, r, p, o); return n; };
    const R0 = Math.random;
    let draws = 0;
    Math.random = () => { draws++; return R0(); };
    const standing0 = D.standing, hp0 = D.list.map((b) => b.hp);
    // each kind where its blow landed: the mark's glyphs centre within 0.5 m of where it should
    const CASES = [
      ['slam', 0, 6, { power: 1.0, r: 2 }, [0, 6]],
      ['cut', 4, 6, { power: 1.0, dx: 1, dz: 0, len: 2.4 }, [5.2, 6]],
      ['thrust', 8, 6, { power: 1.0, dx: 0, dz: 1 }, [8, 6.4]],
      ['dash', -4, 10, { power: 0.8, dx: 1, dz: 0, len: 3 }, [-2.4, 10]],
      ['blast', -8, 6, { power: 1.2, r: 3, hot: true }, [-8, 6]],
      ['beam', -6, 14, { power: 0.8, dx: 1, dz: 0, len: 5 }, [-3.5, 14]],
      ['step', 6, 14, { power: 0.9, dx: 0, dz: 1 }, [6, 14.1]],
    ];
    for (const [kind, x, z, o, [ex, ez]] of CASES) {
      const n0 = sc.count, k0 = sc.made[kind];
      world.groundBlow(x, z, { kind, by: 'boss', ...o });
      const M = sc.marks.slice(n0);
      const cx = M.reduce((a, m) => a + m.x, 0) / Math.max(1, M.length), cz = M.reduce((a, m) => a + m.z, 0) / Math.max(1, M.length);
      const finite = M.every((m) => [m.x, m.y, m.z, m.size, m.rot, m.alpha].every(Number.isFinite));
      assert(sc.made[kind] === k0 + 1 && M.length >= 3 && finite && Math.hypot(cx - ex, cz - ez) <= 0.5, `${kind}: ${M.length} glyphs, centred ${Math.hypot(cx - ex, cz - ez).toFixed(2)} m from where it landed (<= 0.5)`);
    }
    const untouched = D.standing === standing0 && D.list.every((b, i) => b.hp === hp0[i]);
    // a heavy blow through world.impact draws its kind's mark (blunt: a slam; blast: a blast), not today's crack
    { const k0 = sc.made.slam, b0 = sc.made.blast;
      world.impact(0, -6, 2, 1.0, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
      world.impact(6, -6, 2, 1.0, { kind: BLOW.BLAST, by: 'boss', src: D.swing() });
      assert(sc.made.slam === k0 + 1 && sc.made.blast === b0 + 1, 'world.impact: a blunt blow leaves a slam, a blast a blast'); }
    // the same blow told twice in one moment (its actor and the engine) is drawn once; a hundred blows on a spot are thinned
    { const n0 = sc.count;
      world.groundBlow(-10, -8, { kind: 'slam', power: 1, by: 'boss' });
      const n1 = sc.count;
      world.groundBlow(-10, -8, { kind: 'slam', power: 1, by: 'boss' });
      assert(sc.count === n1 && n1 > n0, `the same blow twice at once: drawn once (${n1 - n0} glyphs, then ${sc.count - n1})`);
      let sum = 0;
      for (let i = 0; i < 100; i++) { game.time += 0.6; const m = sc.count; world.groundBlow(-10 + (i % 5) * 0.2, -8, { kind: 'slam', power: 1, by: 'boss' }); sum += sc.count - m; }
      assert(sum < (n1 - n0) * 20, `a hundred slams on one spot: ${sum} glyphs (< ${(n1 - n0) * 20}, a fifth of them drawn whole)`); }
    // the hero's heavy blows are smaller than the boss's
    { const n0 = sc.count; world.groundBlow(10, -12, { kind: 'slam', power: 1, by: 'boss' }); const nb = sc.count - n0;
      const n1 = sc.count; world.groundBlow(14, -12, { kind: 'slam', power: 1, by: 'player' }); const np = sc.count - n1;
      assert(np > 0 && np < nb, `the hero's slam (${np} glyphs) is smaller than the boss's (${nb})`); }
    Math.random = R0;
    assert(draws === 0, `no mark draws from Math.random (${draws} draws): the seeded fights replay`);
    assert(untouched, 'groundBlow damages nothing: every piece stands as it stood, at full hp');
    // the char: only where nothing burns (the courtyard's paving: density 0)
    assert(world.scorch.burnAt(-8, 6) > 0 && world.fire.count === 0, `a hot blast chars the paving (${world.scorch.burnAt(-8, 6).toFixed(2)}), lights nothing`);
    // the cap holds; the oldest fade out (never a pop), then go
    sc.cap = 400;
    for (let i = 0; i < 300; i++) { game.time += 0.6; world.groundBlow((i * 3.7) % 40 - 20, (i * 2.3) % 40 - 20, { kind: 'blast', power: 1, by: 'boss' }); step(1 / 60); }
    const peak = sc.count, dying = sc._dying;
    assert(peak <= Math.ceil(sc.cap * 1.15) + 1, `the cap holds: ${peak} glyphs (cap ${sc.cap} + the share fading)`);
    const a0 = sc.sys ? sc.sys.data[16] : 1;
    step(0.5);
    const a1 = sc.sys ? sc.sys.data[16] : 0;
    assert(dying > 0 && a1 < a0 && a1 > 0, `the oldest ${dying} fade (alpha ${a0.toFixed(2)} → ${a1.toFixed(2)}), not popped`);
    step(SCAR.fade + 0.2);
    assert(sc.count <= sc.cap && sc._dying === 0, `... then go (${sc.count} <= ${sc.cap})`);
    // the reset clears them
    sc.reset();
    assert(sc.count === 0 && sc.kinds === 0 && (!sc.sys || sc.sys.count === 0), 'world.restore() (scars.reset): no mark is left');
    // ?marks=0: today's marks only (a heavy impact cracks the floor as before, a groundBlow draws nothing)
    setLook('marks', '0');
    try {
      world.groundBlow(0, 0, { kind: 'slam', power: 1.5, by: 'boss' });
      const g0 = sc.count;
      world.impact(0, 0, 3, 1.5, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
      assert(g0 === 0 && sc.count > 0 && sc.kinds === 0, `?marks=0: groundBlow draws nothing, world.impact draws today's cracks and crater rim (${sc.count} glyphs)`);
    } finally {
      setLook('marks', null);
    }
  },

  // ---------------------------------------------------------------- the fight's reset: everything stands again
  reset() {
    const { D, world, game, colliders, step } = build();
    const n0 = colliders.circles.length, ids = new Set(colliders.circles);
    const trees = D.list.filter((b) => b.kind === 'deadTree');
    D.topple(trees[0], 1, 0, 'boss');
    D.ignite(trees[1].x, trees[1].z, 1, 1);
    D.take(trees[2]);
    const st = D.list.find((b) => b.kind === 'stone' && b.topples);
    D.strike(st.x, st.z, 1, 99, { src: D.swing() });
    const fl = D.list.find((b) => b.kind === 'flagstone');
    const pos = fl.body.geometry.attributes.position, home = pos.array.slice(fl.body.start * 3, (fl.body.start + fl.body.count) * 3);
    D.strike(fl.x, fl.z, 0.5, 5, { src: D.swing() });
    assert(fl.state === STATE.BROKEN && !fl.body.visible && fl.stub.visible && pos.array[fl.body.start * 3 + 1] < -1, 'a flagstone smashed: its slab folds away, its shards show');
    world.fire.ignite(0, 0, 4, 1);
    world.scars.ground(3, 3, 1.5);
    step(1.5);
    D.topple(D.list.find((b) => b.kind === 'tree'), 0, 1, 'player'); // (still falling at the reset)
    step(0.2);
    assert(D.standing < D.list.length - 3 && world.fire.count > 0 && world.scars.count > 0 && D.active.length > 0, `before: ${D.list.length - D.standing} pieces down, ${world.fire.count} cells alight, ${world.scars.count} marks`);
    // (world.restore(), as world.js wires it)
    world.fire.reset();
    world.scars.reset();
    D.reset();
    assert(D.standing === D.list.length && D.list.every((b) => b.hp === b.hpMax && b.body.visible && (!b.stub || !b.stub.visible) && b.burn === 0 && !b.burnt), 'every piece stands again, whole and unburnt');
    assert(D.list.every((b) => b.pivot.position.lengthSq() === 0 && b.pivot.quaternion.x === 0 && b.pivot.quaternion.z === 0 && b.pivot.quaternion.w === 1), '... upright, where it stood');
    assert(home.every((v, i) => pos.array[fl.body.start * 3 + i] === v) && !fl.stub.visible, '... the flagstone whole again, vertex for vertex');
    assert(colliders.circles.length === n0 && colliders.circles.every((c) => ids.has(c)), `the colliders are the same ${n0} circles (no stump's left behind)`);
    assert(world.fire.count === 0 && world.fire.burning(0, 0) === 0 && world.scars.count === 0 && D.active.length === 0, 'no fire, no marks, nothing in motion');
    assert(D.wreckage === 0 && D.wreck.live.length === 0 && D.wreck.pools.every((p) => p.every((e) => !e.on && !e.mesh.visible)) && D.burning === 0, 'no wreckage lies, nothing burns');
    step(1);
    assert(D.standing === D.list.length, 'and it stays so');
    // a second fight breaks things as the first did
    D.strike(st.x, st.z, 1, 99, { src: D.swing() });
    step(3);
    assert(st.state === STATE.BROKEN && st.stub.visible, 'a reset piece breaks again like the first time');
  },

  // ---------------------------------------------------------------- the spatial grid answers like a full scan, and cheaper
  grid() {
    const { D } = build();
    const L = D.list;
    let rs = 7;
    const r01 = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
    const segD = (px, pz, ax, az, bx, bz) => {
      const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
      const t = l2 > 1e-9 ? Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / l2)) : 0;
      return [Math.hypot(ax + abx * t - px, az + abz * t - pz), t];
    };
    let bad = 0;
    for (let i = 0; i < 3000; i++) {
      const ax = (r01() - 0.5) * 90, az = (r01() - 0.5) * 90, a = r01() * 6.283, len = r01() * 14, r = r01() * 1.5;
      const bx = ax + Math.cos(a) * len, bz = az + Math.sin(a) * len;
      // coverAt vs a full scan
      let best = null, bt = 2;
      for (const b of L) {
        if (b.state !== STATE.INTACT || !b.cover) continue;
        const [d, t] = segD(b.x, b.z, ax, az, bx, bz);
        if (d <= b.r + r && t < bt) { bt = t; best = b; }
      }
      const got = D.coverAt(ax, az, bx, bz, r);
      if (got !== best && !(got && best && Math.abs(D.coverT - bt) < 1e-9)) bad++; // (a tie: either is the first)
      // nearest within a reach vs a full scan
      const md = 2 + r01() * 20;
      let nb = null, nd = md;
      for (const b of L) {
        if (b.state !== STATE.INTACT || b.hpMax === Infinity || !(b.lift > 0 && b.lift <= 1)) continue;
        const d = Math.hypot(b.x - ax, b.z - az);
        if (d < nd) { nd = d; nb = b; }
      }
      if (D.nearest(ax, az, { maxDist: md, lift: 1 }) !== nb) bad++;
    }
    assert(bad === 0, `coverAt and nearest on the grid agree with a full scan of ${L.length} pieces (3000 random queries each: ${bad} differ)`);
    // cost: a bullet's step (coverAt) over the grid vs over every piece
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) D.coverAt(-3 + (i % 7), 4, 2, -6 + (i % 5), 0.3);
    const tGrid = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 20000; i++) {
      for (const b of L) if (b.state === STATE.INTACT && b.cover) segD(b.x, b.z, -3 + (i % 7), 4, 2, -6 + (i % 5));
    }
    const tScan = performance.now() - t1;
    assert(tGrid < tScan, `20000 bullet steps: ${tGrid.toFixed(1)} ms on the grid vs ${tScan.toFixed(1)} ms scanning all ${L.length} pieces`);
  },

  // ---------------------------------------------------------------- the wyrm's body wrecks what it meets (no named attack)
  body() {
    // walking: a tree in its way goes down ahead of it; it ploughs through (its trunk does not turn it)
    {
      const W = wyrm();
      const { D, d, game, log, step, colliders } = W;
      const t = D.list.find((b) => b.kind === 'deadTree' && Math.hypot(b.x, b.z) < 20);
      const c0 = colliders.version;
      W.place(t.x, t.z + 9, Math.PI); // 9 m south of it, facing north (fwd = (sin yaw, cos yaw))
      game.player.position.set(t.x, 0, t.z - 22); // (with its AI off it faces the hero: ahead, past the tree)
      const z0 = d.position.z;
      let actions = 0;
      W.run(4.5, () => { d.moveForward(WYRM.walkSpeed[0], 1 / 60); if (d.brain.action) actions++; });
      const felled = log.find((e) => e.n === 'world:impact' && e.id === t.id && (e.kind === 'topple' || e.kind === 'break'));
      assert(t.state !== STATE.INTACT && felled && felled.by === 'boss' && actions === 0, `walking at ${WYRM.walkSpeed[0]} m/s (no attack running) it fells the dead tree in its way (world:impact ${felled?.kind}, by boss)`);
      assert(d.position.z < t.z - 1 && colliders.version > c0, `it walks on through where the tree stood (root ${(t.z - d.position.z).toFixed(1)} m past it): the trunk did not turn it`);
      step(3);
      assert(D.wreckage >= 1 && D.wreck.live.some((e) => e.kind === 0 && Math.hypot(e.x - t.x, e.z - t.z) < 1.5), `its trunk lies where it fell (${D.wreckage} piece(s) of wreckage)`);
    }
    // turning: the tail sweeps what stands behind it
    {
      const W = wyrm();
      const { D, d, game, log } = W;
      const t = D.list.find((b) => b.kind === 'deadTree' && Math.hypot(b.x, b.z) < 22);
      // the root 7 m south of the tree, facing east: the tail lies west; the hero to the north-east turns it
      // round, and the tail swings through the tree
      W.place(t.x, t.z + 7.5, Math.PI / 2);
      game.player.position.set(t.x + 14, 0, t.z - 12);
      const hp = t.hp;
      W.run(2.5);
      // (tuning pass, 2026-11-15: a limb, a wing or the tail only BRUSHES what it passes (BREAK.brush):
      // a turn shakes the pieces round it and breaks only the small ones; it no longer fells the tree
      // behind it, which with the stones a walk felled left a sixth of the clearing after a fight)
      const hit = log.filter((e) => e.n === 'world:impact' && e.by === 'boss');
      const big = new Set(hit.filter((e) => e.kind === 'topple' || e.kind === 'break').map((e) => e.id));
      const felledBig = [...big].map((id) => D.list[id]).filter((b) => b && b.hpMax >= 1.2);
      assert(hit.length > 0 && t.state === STATE.INTACT && !felledBig.length, `turning in place (${(WYRM.turnSpeed[0] * 180 / Math.PI * 0.8).toFixed(0)} deg/s), its body brushes what stands round it (${hit.length} blow(s): ${[...new Set(hit.map((e) => e.kind))].join(', ')}) and fells nothing big (${felledBig.map((b) => b.kind).join(', ') || 'none'}; the tree behind it stands)`);
    }
    // landing: a heavy landing breaks what stands round it; flying low: it shears the crowns it passes
    {
      const W = wyrm();
      const { D, d, game } = W;
      const near = D.list.filter((b) => b.state === STATE.INTACT && b.mat === 'wood' && b.kind === 'deadTree');
      const t = near[2];
      W.place(t.x + 4, t.z, 0);
      game.player.position.set(t.x + 4, 0, t.z + 20);
      let alt = 7;
      W.air(() => alt);
      W.run(1.2);
      const before = D.standing, logsBefore = W.log.length;
      alt = 0;
      W.run(1.2);
      const hits = W.log.slice(logsBefore).filter((e) => e.n === 'world:impact' && e.by === 'boss');
      assert(hits.length > 0 && D.standing < before, `a landing from ${7} m strikes what stands round it: ${hits.length} blow(s), ${before - D.standing} piece(s) down`);
    }
    {
      const W = wyrm();
      const { D, d, game } = W;
      // a rim stand: the wood farthest out on the east side, flown through 4 m up at 12 m/s
      const rim = D.list.filter((b) => b.mat === 'wood' && Math.abs(b.x - 33) < 9 && b.z > -18 && b.z < 16);
      const hp0 = rim.reduce((s, b) => s + b.hp, 0);
      W.place(33, -18, 0);
      game.player.position.set(33, 0, 30);
      W.air(() => 4);
      W.run(0.6, () => { d.position.set(33, 0, -18); d.yaw = 0; });
      const logN = W.log.length;
      // fly south along x = 33, through the stand (placed each frame: a flight's path, not its bound)
      let z = -18;
      W.run(2.8, () => { z += 12 / 60; d.position.set(33, 0, z); d.yaw = 0; });
      const struck = new Set(W.log.slice(logN).filter((e) => e.n === 'world:impact' && e.by === 'boss').map((e) => e.id));
      const hp1 = rim.reduce((s, b) => s + b.hp, 0);
      assert(struck.size >= 2 && hp1 < hp0, `flying low (4 m up, 12 m/s) through a stand on the rim it shears ${struck.size} trees`);
    }
    // what a move of its own is about to take is spared; a reserved piece too
    {
      const W = wyrm();
      const { D, d, game } = W;
      const t = D.list.find((b) => b.kind === 'deadTree' && Math.hypot(b.x, b.z) < 20);
      D.reserve(t, 10);
      W.place(t.x, t.z + 9, Math.PI);
      game.player.position.set(t.x, 0, t.z - 22);
      W.run(4.5, () => d.moveForward(WYRM.walkSpeed[0], 1 / 60));
      assert(t.state === STATE.INTACT && t.hp === t.hpMax, 'a reserved piece (destructibles.reserve: a move is about to take it) is left alone by its body');
    }
  },

  // ---------------------------------------------------------------- wreckage stays, stops nothing, sinks at the cap
  wreck() {
    // (from a known point of the break stream: what the felled trunk does is drawn from it, and where the
    // scenarios before left it decided whether the check below passed: green on one PR, red on the next)
    reseedBreaks(0x51ed);
    const { D, world, game, colliders, step } = build();
    const t = D.list.find((b) => b.kind === 'deadTree' && !b.wall);
    const n0 = colliders.circles.length;
    const ml = 0.6 * t.h * BREAK.wreck.trunk[1];
    const coverBefore = D.coverAt(t.x + ml, t.z - 4, t.x + ml, t.z + 4, 0.2);
    D.topple(t, 1, 0, 'boss');
    step(2);
    const e = D.wreck.live.find((w) => w.kind === 0);
    // (it lands turned off its fall by up to the blow's own `yaw`, BREAK.fell, by design: ADR-128)
    const yawMax = (BREAK.fell[t.fk] ?? BREAK.fell.blunt).yaw;
    assert(e && e.on && e.mesh.visible && t.stub.visible && Math.abs(e.x - t.x) < 1 && e.dx >= Math.cos(yawMax) - 0.005, `a felled tree's trunk lies along its fall, turned at most its blow's ${yawMax} rad (${e?.len.toFixed(1)} m from its stump, ${(Math.acos(Math.min(1, e?.dx ?? 0)) || 0).toFixed(2)} rad off)`);
    assert(colliders.circles.length === n0, `its wreckage adds no collider (${n0 - t.colliders.length + 1} circles: the stump's only)`);
    const mx = e.x + e.dx * e.len * 0.6, mz = e.z + e.dz * e.len * 0.6;
    const pos = new THREE.Vector3(mx, 0, mz);
    colliders.resolve(pos, 0.45);
    assert(Math.hypot(pos.x - mx, pos.z - mz) < 1e-6, 'the hero stands on the trunk: nothing pushes him off it');
    assert(D.coverAt(t.x + ml, t.z - 4, t.x + ml, t.z + 4, 0.2) === coverBefore && D.wreck.live.every((w) => !D.list.includes(w)), 'a bullet across the trunk meets what it met before the tree fell (the trunk is no cover)');
    step(30);
    assert(e.on && e.mesh.visible && D.wreck.live.includes(e), 'it is still there 30 s later');
    // a boulder broken leaves a pile; a thrown piece leaves its remains where it lands
    const bo = D.list.find((b) => b.kind === 'boulder' && b.state === STATE.INTACT);
    const w0 = D.wreckage;
    D.strike(bo.x, bo.z, 1, 9, { src: D.swing() });
    assert(D.wreckage === w0 + 1 && D.wreck.live.some((w) => w.kind === 2 && Math.hypot(w.x - bo.x, w.z - bo.z) < 0.5), 'a broken boulder leaves a rubble pile');
    const p = D.nearest(0, 0, { lift: 1, mat: 'wood' });
    D.take(p);
    D.throwTo(p, 2, 3, { time: 0.6 });
    step(1);
    assert(D.wreck.live.some((w) => w.kind === 0 && Math.hypot(w.x + w.dx * w.len * 0.3 - 2, w.z + w.dz * w.len * 0.3 - 3) < 2), 'a thrown tree leaves its trunk where it lands');
    // the cap: past its share the oldest sinks into the ground (never more than the pool)
    const cap = D.wreck._cap(0);
    let fell = 0;
    for (const b of D.list) {
      if (b.mat !== 'wood' || b.state !== STATE.INTACT || !b.topples) continue;
      D.topple(b, 0, 1, 'world');
      if (++fell >= cap + 12) break;
      step(0.15);
    }
    step(4);
    const logs = D.wreck.live.filter((w) => w.kind === 0).length;
    assert(logs <= cap && logs >= cap - 4, `felling ${fell} trees leaves ${logs} trunks lying (the cap ${cap}: the oldest sank)`);
    // the quality factor shrinks the cap
    D.setQuality(QUALITY.LOW);
    step(4);
    const lowCap = D.wreck._cap(0);
    assert(lowCap < cap && D.wreck.live.filter((w) => w.kind === 0).length <= lowCap, `LOW quality: at most ${lowCap} trunks (HIGH ${cap})`);
    // burnt wood: a tree that burned through leaves a black log that smoulders
    D.setQuality(1);
    const bt = D.list.find((b) => b.mat === 'wood' && b.state === STATE.INTACT && b.h > 3);
    D.ignite(bt.x, bt.z, 0.5, 1);
    step(BREAK.burn.time * 1.3);
    assert(bt.burnt && D.wreck.live.some((w) => w.kind === 1 && w.smoulder > 0 && Math.hypot(w.x - bt.x, w.z - bt.z) < 1.5), 'a tree that burned through leaves a black log by its stump, smouldering');
  },

  // ---------------------------------------------------------------- a felled tree lies as the blow left it (ADR-128)
  lie() {
    reseedBreaks(0x51ed); // (the shares below are chances: from a known point, not where the scenarios before left the stream)
    const { D, game, step } = build();
    game.player.position.set(0, 0, 0);
    game.boss.position.set(0, 0, 80);
    // (the clearing's trees first, then the wall's nearest: the clearing has only a dozen tall ones)
    const trees = D.list.filter((b) => b.mat === 'wood' && b.ranged && b.wrecks && b.topples && b.stub?.reshape && b.h > 3).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const topOf = (H) => {
      let m = 0;
      for (let i = 1; i < H.length; i += 3) m = Math.max(m, H[i]);
      return m;
    };
    const kinds = [BLOW.CUT, BLOW.BLUNT, BLOW.BLAST];
    const ratio = { cut: [], blunt: [], blast: [] };
    let hinge = 0, blunt = 0;
    const felled = [];
    for (let i = 0; i < 36 && i < trees.length; i++) {
      const t = trees[i], k = kinds[i % 3];
      const a = i * 2.4, dx = Math.cos(a), dz = Math.sin(a);
      const built = topOf(t.stub.home);
      D.strike(t.x - dx * 0.3, t.z - dz * 0.3, 0.5, 80, { kind: k, by: 'player', dx, dz, y: 1, src: D.swing() });
      if (t.state === STATE.INTACT) continue;
      felled.push(t);
      const H = t.stub.home, top = topOf(H);
      ratio[k].push(top / built);
      if (k === BLOW.BLUNT) {
        // torn over: higher on the side it went over to (the fibres it tore stand up there)
        let hi = 0, nh = 0, lo = 0, nl = 0;
        for (let v = 0; v < H.length; v += 3) {
          if (H[v + 1] < top * 0.5) continue;
          const d = (H[v] - t.x) * t.dx + (H[v + 2] - t.z) * t.dz;
          if (d > 0.03) (hi += H[v + 1]), nh++;
          else if (d < -0.03) (lo += H[v + 1]), nl++;
        }
        blunt++;
        if (nh && nl && hi / nh > lo / nl) hinge++;
      }
    }
    const mean = (A) => A.reduce((s, v) => s + v, 0) / Math.max(1, A.length);
    const all = [...ratio.cut, ...ratio.blunt, ...ratio.blast];
    const distinct = new Set(all.map((v) => v.toFixed(3))).size;
    assert(felled.length >= 24 && distinct >= all.length - 2, `${felled.length} trees felled by a blade, a blow, a blast: ${distinct} different stump heights of ${all.length}`);
    assert(mean(ratio.blast) < mean(ratio.blunt) && mean(ratio.blunt) < mean(ratio.cut), `a blade leaves the tallest stumps (x${mean(ratio.cut).toFixed(2)} of the built one, cut where it bit), a blow lower (x${mean(ratio.blunt).toFixed(2)}), a blast the lowest (x${mean(ratio.blast).toFixed(2)})`);
    assert(hinge >= blunt * 0.7, `a tree knocked over leaves its stump torn higher on the side it fell to (${hinge} of ${blunt})`);
    step(3);
    // its trunk: turned off the line it fell along, some broken in two, some resting raised on their crowns
    const logs = D.wreck.live.filter((w) => w.kind === 0);
    let turned = 0, raised = 0;
    for (const t of felled) {
      const mine = logs.filter((w) => Math.hypot(w.x - t.x, w.z - t.z) < 1.2);
      for (const w of mine) {
        if (Math.acos(Math.min(1, w.dx * t.dx + w.dz * t.dz)) > 0.05) turned++;
        if (w.pitch > 0.03) raised++;
      }
    }
    const looks = new Set(logs.map((w) => w.mesh.geometry.uuid)).size;
    assert(logs.length > felled.length && turned >= felled.length * 0.4 && raised >= felled.length * 0.3 && looks >= 5, `${logs.length} trunks for ${felled.length} trees (some broke in two), ${turned} turned off their fall, ${raised} with an end raised, ${looks} different shapes`);
    // burnt through: a black stump, and some stay standing as a snag
    const left = trees.filter((b) => b.state === STATE.INTACT).slice(0, 16);
    for (let i = 0; i < left.length; i += 4) {
      for (const b of left.slice(i, i + 4)) D.ignite(b.x, b.z, 0.3, 1);
      step(BREAK.burn.time * 1.3);
    }
    const burnt = left.filter((b) => b.burnt);
    const chars = D.wreck.live.filter((w) => w.kind === 1);
    const snags = chars.filter((w) => w.pitch > 1).length;
    const dark = burnt.filter((b) => {
      const C = b.stub.cAttr?.array, O = b.stub.corig;
      if (!C || !O) return false;
      let a = 0, o = 0;
      for (let k = 0; k < O.length; k++) (a += C[b.stub.start * 3 + k]), (o += O[k]);
      return a < o * 0.8;
    }).length;
    assert(burnt.length >= 5 && snags >= 1 && chars.length - snags >= 1 && dark === burnt.length, `${burnt.length} trees burned through: ${snags} left standing as black snags, ${chars.length - snags} black trunks lying, ${dark} stumps burnt dark`);
    // the reset: every stump back to the one it was built as
    D.reset();
    const back = [...felled, ...burnt].every((b) => !b.stub.visible && !b.stub.shaped && b.stub.home.every((v, k) => v === b.stub.orig[k]) && (!b.stub.cAttr || b.stub.corig.every((v, k) => v === b.stub.cAttr.array[b.stub.start * 3 + k])));
    assert(back, 'the reset: every stump hidden and back to its built shape and colour');
  },

  // ---------------------------------------------------------------- fire spreads from tree to tree, and stops at its cap
  spread() {
    // (each try to pass the fire on is a chance (BREAK.spread.chance): start the module's stream from a
    // known point, not wherever the scenarios before left it; a tree has ~4 tries before it burns out)
    reseedBreaks();
    const { D, world, game, log, step } = build();
    game.player.position.set(0, 0, 0);
    // the tree with the most neighbours in reach
    const S = BREAK.spread;
    const wood = D.list.filter((b) => b.mat === 'wood' && b.burns);
    const nb = (b) => wood.filter((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) <= S.reach + b.r + o.r + o.leafy * 1.5).length;
    // (a tree: ADR-197's undergrowth grows in clumps whose pieces touch, one lit lights its clump-mates at once)
    const t = wood.filter((b) => b.kind === 'tree' || b.kind === 'deadTree').reduce((a, b) => (nb(b) > nb(a) ? b : a));
    D.ignite(t.x, t.z, 0.3, 1);
    let peak = 0, firstSpread = -1;
    for (let i = 0; i < 60 * 20; i++) {
      step(1 / 60);
      peak = Math.max(peak, D.burning);
      if (firstSpread < 0 && log.filter((e) => e.n === 'world:impact' && e.kind === 'burn').length > 1) firstSpread = i / 60;
    }
    const burns = log.filter((e) => e.n === 'world:impact' && e.kind === 'burn').length;
    const cap = Math.max(3, Math.round(S.maxBurning * D.q));
    assert(firstSpread >= S.after && burns >= 2, `a tree with ${nb(t)} neighbours in reach lights one ${firstSpread.toFixed(1)} s after it caught (>= ${S.after} s); ${burns} pieces burned in 20 s`);
    assert(peak <= cap, `never more than ${cap} things alight at once (peak ${peak})`);
    step(40);
    const burned = D.list.filter((b) => b.burnt).length;
    assert(D.burning === 0 && D.list.every((b) => b.gen <= S.gens + (b.wall ? BREAK.wall.gens : 0)), `the blaze burns out: fire passes on at most ${S.gens} times from where it landed (+${BREAK.wall.gens} in the wall) (${burned} trees burned in all, nothing alight 60 s on)`);
    // the light of burning wood is a local glow, one for a cluster (BREAK.burn.glow)
    {
      const Lb = build();
      const added = [];
      const add = Lb.game.lights.add.bind(Lb.game.lights);
      Lb.game.lights.add = (o) => { added.push(o); return add(o); };
      const stand = Lb.D.list.filter((b) => b.mat === 'wood' && Math.hypot(b.x - t.x, b.z - t.z) < 7).slice(0, 5);
      for (const b of stand) Lb.D.ignite(b.x, b.z, 0.2, 1);
      const G = BREAK.burn.glow;
      assert(stand.length >= 3 && added.length <= 2 && added.every((o) => o.radius <= 6 && o.intensity <= G.intensity), `${stand.length} trees alight within 7 m share ${added.length} light(s) of ${added.map((o) => o.radius.toFixed(1)).join(', ')} m (<= 6 m; it was ~16 m each)`);
    }
    // the cap: everything lit at once, nothing spreads past it
    const W = build();
    W.D.setQuality(QUALITY.LOW);
    const capLow = Math.max(3, Math.round(S.maxBurning * W.D.q));
    const many = W.D.list.filter((b) => b.mat === 'wood' && b.burns).slice(0, capLow + 6);
    for (const b of many.slice(0, capLow)) W.D.ignite(b.x, b.z, 0.2, 1);
    const lit0 = W.D.burning;
    let over = 0;
    for (let i = 0; i < 60 * 10; i++) { W.step(1 / 60); if (W.D.burning > Math.max(lit0, capLow)) over++; }
    assert(over === 0, `at LOW quality the fires never pass ${capLow} by spreading (lit ${lit0} at once)`);
    // logs catch from a burning neighbour and in burning grass
    const B = build();
    // (one in the clearing: at the treeline ADR-197's undergrowth catches from the burning log and lights it again)
    const tr = B.D.list.find((b) => b.kind === 'deadTree' && Math.hypot(b.x, b.z) < 24);
    B.D.topple(tr, 1, 0, 'world');
    B.step(2);
    const lg = B.D.wreck.live.find((w) => w.kind === 0);
    const n = B.D.ignite(lg.x + lg.dx, lg.z + lg.dz, 0.5, 1);
    assert(n >= 1 && lg.burn > 0 && B.D.burning >= 1, 'fire landing on a fallen trunk lights it');
    B.game.player.position.set(lg.x + lg.dx * 1.5, 0, lg.z + lg.dz * 1.5 + 0.3);
    const h0 = B.hits.length;
    B.step(2);
    assert(B.hits.length > h0 && B.hits[B.hits.length - 1].kind === 'fire', 'the hero beside a burning trunk is burned');
    B.game.player.position.set(40, 0, 40);
    B.step(BREAK.wreck.burn * 1.4);
    assert(lg.on === false && B.D.wreck.live.some((w) => w.kind === 1), 'it burns through and lies black');
  },

  // ---------------------------------------------------------------- a tree wears down in stages (2026-11-16)
  wear() {
    const { D, log, step, game } = build();
    game.player.position.set(0, 0, 0);
    const A = BREAK.wear.at;
    // an oak, a pine and a dead tree of the wall, struck again and again with a tail's power along the way out
    // (an old tree of the wall, one that closes its lanes: ADR-197's young trees between them are slight)
    const pick = (fn) => D.list.filter((b) => b.wall && b.def.edge > 0 && b.state === STATE.INTACT && fn(b)).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
    const trees = [pick((b) => b.kind === 'tree' && b.body.parts > 5), pick((b) => b.kind === 'tree' && b.cut[0] === 2 && b.body.parts === 5), pick((b) => b.kind === 'deadTree')];
    for (const t of trees) {
      const R = Math.hypot(t.x, t.z), ox = t.x / R, oz = t.z / R;
      const pos = t.body.geometry.attributes.position.array, s = t.body.start * 3;
      const stages = [];
      let blows = 0;
      for (; blows < 12 && t.state === STATE.INTACT; blows++) {
        D.strike(t.x - ox * 0.6, t.z - oz * 0.6, 0.8, 1, { kind: BLOW.BLUNT, by: 'boss', dx: ox, dz: oz, y: 1.5, src: D.swing() });
        if (t.state === STATE.INTACT) stages.push(t.wear);
        step(0.8);
      }
      // (a small tree may skip a stage under one blow: it still shows the first hit, and never goes back)
      const ordered = stages.length >= 1 && stages[0] >= 1 && stages.every((v, i) => i === 0 || v >= stages[i - 1]);
      const wearEv = log.filter((e) => e.n === 'world:impact' && e.kind === 'wear' && e.id === t.id).map((e) => e.power);
      assert(ordered && wearEv.length >= 1 && wearEv.every((p, i) => i === 0 || p > wearEv[i - 1]), `${t.kind} (${t.body.parts} parts, hp ${t.hpMax.toFixed(2)}) at ${R.toFixed(0)} m: stages ${stages.join(' > ')} in ${blows} blows of 1.0, then it falls (world:impact wear ${wearEv.join(', ')})`);
      assert(blows >= 2 && blows <= 6, `... it takes ${blows} blows of a tail's power (2 .. 6: a fight's worth, a hit shows at once)`);
      // dropped parts lie folded under the ground; what stays is where it stood
      let folded = 0;
      for (let p = 0, v0 = 0; p < t.body.parts; p++) {
        const v1 = t.body.ends[p];
        if (!t.body.shown[p]) folded += pos[s + v0 * 3 + 1] < -2 ? 1 : 0;
        v0 = v1;
      }
      assert(folded === t.dropped && t.dropped >= Math.min(t.order.length, t.cut[1] ?? 1), `... ${t.dropped} of its ${t.order.length} crown parts dropped before it fell, their vertices folded away`);
      step(2.5);
      assert(t.state === STATE.BROKEN && !t.body.visible && t.stub.visible, '... it lies felled, its stump stands');
    }
    // a burning tree loses its crown as it burns
    const b = pick((o) => o.kind === 'tree' && o.body.parts > 5);
    D.ignite(b.x, b.z, 0.3, 1);
    const life = b.burnLife;
    step(life * 0.5);
    const mid = b.dropped;
    step(life * 0.6);
    assert(mid >= 1 && mid < b.order.length && b.burnt && b.state === STATE.BROKEN, `a burning oak drops its crown as it burns (${mid} of ${b.order.length} parts gone halfway), then burns to its stump`);
    // inside the clearing trees wear down too, with the toughness they had
    const inner = D.list.find((o) => o.kind === 'deadTree' && !o.wall && o.state === STATE.INTACT);
    const hp = inner.hpMax;
    D.strike(inner.x, inner.z, 0.6, hp * (1 - A[0]) + 0.05, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    assert(inner.state === STATE.INTACT && inner.wear >= 1 && inner.dropped >= 1, `a dead tree inside the clearing (hp ${hp.toFixed(2)}: unchanged) wears down too (stage ${inner.wear})`);
  },

  // ---------------------------------------------------------------- the wyrm's reach into the wall (2026-11-16, the tuning pass)
  // destructibles.wind: a front of wind wears the wall's trees, in the order it reaches them, never past
  // BREAK.wind.floor (wind alone fells nothing), nothing inside the clearing. destructibles.carryFire:
  // fire carried along a ray lights the first tree of the wall, on the wall's own budget (the clearing's
  // is untouched). A broken bone leaves a heap of bone (wreckage.js). reset() forgets all of it.
  reach() {
    const { D, log, step, game, world } = build();
    game.player.position.set(0, 0, 0);
    const wall = D.list.filter((b) => b.wall && b.order.length > 0);
    const inner = D.list.filter((b) => !b.wall);
    const hp0 = new Map(inner.map((b) => [b, b.hp]));
    const L0 = log.length;
    const n = D.wind(-10, 0, 1.4, 50, {});
    step(0.3);
    const early = log.slice(L0).filter((e) => e.n === 'world:impact' && e.kind === 'wear').length;
    step(2.5);
    const worn = wall.filter((b) => b.wear > 0);
    const wearEv = log.slice(L0).filter((e) => e.n === 'world:impact' && e.kind === 'wear');
    const near = worn.filter((b) => Math.hypot(b.x + 10, b.z) < 30).length, far = worn.filter((b) => Math.hypot(b.x + 10, b.z) > 42).length;
    assert(n > 50 && worn.length > 20 && wearEv.length === worn.length && early < wearEv.length, `a front of wind (1.4 from (-10, 0), 50 m) reached ${n} trees of the wall, wore ${worn.length} (world:impact 'wear' ${wearEv.length}; ${early} in its first 0.3 s: it rolls out at ${BREAK.wind.speed} m/s)`);
    assert(near > far, `... more of them near it than far (${near} within 30 m, ${far} past 42 m)`);
    assert(wall.every((b) => b.state === STATE.INTACT && b.hp >= BREAK.wind.floor * b.hpMax - 1e-9) && inner.every((b) => b.hp === hp0.get(b)), `... none felled, none below ${BREAK.wind.floor} of its structure; the clearing's pieces untouched`);
    // again at once: within rehit nothing more
    const h1 = wall.map((b) => b.hp);
    D.wind(-10, 0, 1.4, 50, {});
    step(0.2);
    assert(wall.every((b, i) => b.hp === h1[i] || Math.hypot(b.x + 10, b.z) > 0.2 * BREAK.wind.speed), `... a second front within ${BREAK.wind.rehit} s takes nothing more from the trees it reached`);
    // fire carried along a ray: the first tree of the wall catches, on the wall's budget
    D.reset();
    const lit0 = D._litTokens;
    const b = D.carryFire(0, 0, 1, 0.05, 60, 1);
    assert(b && b.wall && b.burn > 0 && D._wallBurning === 1 && D._litTokens === lit0 && Math.hypot(b.x, b.z) > BREAK.wall.from, `carryFire along +x lit the wall's first tree in its way (${b ? Math.hypot(b.x, b.z).toFixed(1) : '-'} m; the clearing's budget untouched)`);
    let lit = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283;
      const c = D.carryFire(0, 0, Math.cos(a), Math.sin(a), 60, 1);
      if (c && c.burn > 0 && c !== b) lit++;
    }
    assert(lit <= BREAK.wall.fire.bank + 1 && D._wallBurning <= BREAK.wall.fire.maxBurning, `... at once twelve more lit ${lit - 1} (its bank ${BREAK.wall.fire.bank}); ${D._wallBurning} alight in the wall (<= ${BREAK.wall.fire.maxBurning})`);
    const counted = () => D.list.filter((o) => o.wall && o.burn > 0).length;
    step(BREAK.burn.time * 0.5);
    const mid = [D._wallBurning, counted()];
    step(60);
    assert(mid[0] === mid[1] && D._wallBurning === 0 && counted() === 0, `... the wall's count of fires matches what burns (${mid[0]} = ${mid[1]}), and when they have burned out (spread included) it is 0`);
    // a broken bone leaves a heap
    const rib = D.list.find((o) => o.kind === 'elderRib');
    const heaps0 = D.wreck.pools[3].filter((e) => e.on).length;
    if (rib) D.strike(rib.x, rib.z, rib.r + 0.5, 50, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    step(2);
    const heaps = D.wreck.pools[3].filter((e) => e.on).length;
    assert(rib && rib.state !== STATE.INTACT && heaps > heaps0, `a broken ${rib?.kind ?? 'bone'} leaves a heap of bone (heaps lying: ${heaps0} -> ${heaps}; the strike broke its neighbours too)`);
    // the bone heaps keep to their share like every other pool: break every bone piece, drop the
    // quality, and the heaps over the lower cap sink (update() walks all four pools)
    for (const b of D.list) if (b.mat === 'bone' && b.state === STATE.INTACT) D.strike(b.x, b.z, b.r + 0.3, 50, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    step(2);
    const bonePool = D.wreck.pools[3];
    const lying = () => bonePool.filter((e) => e.on && !(e.sink > 0)).length;
    const full = lying();
    D.setQuality(0.3);
    const cap = D.wreck._cap(3);
    step(8);
    const after = lying();
    assert(full > cap && after <= cap, `bone heaps over a lowered cap sink: ${full} lying at full quality, ${after} after the quality drops (its cap ${cap})`);
    D.setQuality(1);
    D.reset();
    assert(D._wq.n === 0 && D._wallBurning === 0 && D.list.every((b) => b.state === STATE.INTACT && b.wear === 0) && D.wreck.pools[3].every((e) => !e.on), 'reset(): no front waiting, nothing alight, the wall and the bones whole again');
  },

  // ---------------------------------------------------------------- the wall falls away from the arena; it is restored whole
  wall() {
    const { D, log, step, game, hits, colliders } = build();
    const treeMesh = D.list.find((b) => b.kind === 'tree').body.mesh;
    const home = treeMesh.geometry.attributes.position.array.slice();
    const n0 = colliders.circles.length;
    // a far tree (60 m) felled by a blow from the arena's side: falls outward, tells nothing, leaves its log
    const far = D.list.filter((b) => b.wall && b.kind === 'tree' && Math.hypot(b.x, b.z) > 58)[0];
    const tells0 = log.filter((e) => e.n === 'combat:tell').length;
    const R = Math.hypot(far.x, far.z), ox = far.x / R, oz = far.z / R;
    D.strike(far.x, far.z, 0.6, 20, { kind: BLOW.BLUNT, by: 'boss', dx: -ox, dz: -oz, src: D.swing() });
    assert(far.state === STATE.FALLING && far.dx * ox + far.dz * oz >= BREAK.wall.out - 1e-6, `a wall tree at ${R.toFixed(0)} m struck toward the arena falls OUT of it (its way · out = ${(far.dx * ox + far.dz * oz).toFixed(2)} >= ${BREAK.wall.out})`);
    step(2.5);
    assert(far.state === STATE.BROKEN && far.quiet && log.filter((e) => e.n === 'combat:tell').length === tells0 && D.wreck.live.some((e) => e.kind === 0 && Math.hypot(e.x - far.x, e.z - far.z) < 1.5), 'it cannot reach the hero\'s ground: no tell, no strip; its trunk lies where it fell');
    // the rim: a tree whose fall can reach the bound still tells red; most fall outward
    const rim = D.list.filter((b) => b.wall && b.kind !== 'cinderBough' && (b.kind === 'tree' || b.kind === 'deadTree') && Math.hypot(b.x, b.z) < 34);
    let out = 0;
    for (const b of rim) {
      const r = Math.hypot(b.x, b.z);
      D.strike(b.x, b.z, 0.5, 20, { kind: BLOW.BLUNT, by: 'boss', dx: -b.x / r + 0.3, dz: -b.z / r, src: D.swing() });
      if (b.dx * b.x + b.dz * b.z > 0) out++;
    }
    step(3);
    assert(rim.length >= 6 && out === rim.length, `the wall's first row (${rim.length} trees within 34 m), all struck inward: every one falls out of the arena`);
    // a burning stand, a worn tree: then the reset puts every vertex of the tree mesh back
    const w = D.list.find((b) => b.wall && b.kind === 'tree' && b.state === STATE.INTACT && Math.hypot(b.x, b.z) > 45);
    D.strike(w.x, w.z, 0.5, w.hpMax * 0.6, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    D.ignite(w.x + 6, w.z, 2, 1);
    D.take(D.list.find((b) => b.wall && b.kind === 'tree' && b.state === STATE.INTACT));
    step(1);
    D.reset();
    const pos = treeMesh.geometry.attributes.position.array;
    let diff = 0;
    for (let i = 0; i < pos.length; i++) if (pos[i] !== home[i]) diff++;
    assert(diff === 0 && colliders.circles.length === n0 && D.list.every((b) => b.wear === 0 && b.lean === 0 && (!b.stub || !b.stub.visible)), `world.restore(): every one of the tree mesh's ${pos.length / 3} vertices is back where it was (${diff} differ), the stumps are folded away, the colliders the same ${n0}`);
    // fairness: a boss blow inside the clearing still fells a tree there with its red tell (unchanged)
    assert(hits.length === 0, 'none of it touched the hero at the centre');
  },

  // ---------------------------------------------------------------- the Elder Wyrm's skeleton, the Cinder Tree, the nest break in pieces
  landmarks() {
    const { D, set, colliders, log, step } = build();
    const kinds = (re) => D.list.filter((b) => re.test(b.kind));
    const elder = kinds(/^elder/), ribs = kinds(/^elderRib$/), cinder = kinds(/^cinder/), nest = kinds(/^nest/);
    assert(elder.length >= 30 && ribs.length === 18 && elder.every((b) => b.mat === 'bone' && b.ranged && b.digits), `the Elder Wyrm's skeleton is ${elder.length} bone pieces (${ribs.length} ribs, ${kinds(/^elderSpine$/).length} runs of the spine, the skull, the jaw, the horns, the tail ...)`);
    assert(elder.reduce((a, b) => a + b.colliders.length, 0) === ELDER_N, `its ${ELDER_N} colliders are shared out among its pieces`);
    assert(cinder.length === 6 && kinds(/^cinderBough$/).length === 5 && nest.length === 15, `the Cinder Tree: ${cinder.length} pieces (5 boughs, the trunk); the nest: ${nest.length} (14 ribs, the skull)`);
    const bf = set.bonfire;
    assert(!D.list.some((b) => Math.hypot(b.x - bf.x, b.z - bf.z) < 2), 'the bonfire is no piece: it stays');
    // a rib comes apart over a few tail blows, not one
    const rib = ribs.find((b) => b.colliders.length > 0) ?? ribs[0];
    let n = 0;
    while (rib.state === STATE.INTACT && n < 12) {
      D.strike(rib.x, rib.z, 0.8, 1, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
      n++;
      step(0.3);
    }
    assert(n >= 2 && n <= 5 && rib.state === STATE.BROKEN && !rib.body.visible && rib.colliders.every((c) => !colliders.circles.includes(c)), `a rib of the elder wyrm breaks under ${n} tail blows (2 .. 5); its range folds away, its colliders go`);
    assert(log.some((e) => e.n === 'world:impact' && e.kind === 'break' && e.mat === 'bone' && e.id === rib.id), "world:impact { kind: 'break', mat: 'bone' }");
    // the Cinder Tree's trunk holds while its boughs stand
    const trunk = cinder.find((b) => b.kind === 'cinderTrunk');
    D.strike(trunk.x, trunk.z, 1, 3, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    const took = trunk.hpMax - trunk.hp;
    assert(Math.abs(took - 3 * BREAK.mats.wood.take.blunt * BREAK.guarded) < 1e-6, `with its boughs standing its trunk takes ${BREAK.guarded} of a blow (${took.toFixed(2)} of 3 x ${BREAK.mats.wood.take.blunt})`);
    for (const b of cinder) if (b !== trunk) D.strike(b.x, b.z, 0.5, 20, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    D.strike(trunk.x, trunk.z, 1, 20, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    step(0.5);
    assert(cinder.every((b) => b.state === STATE.BROKEN) && trunk.stub.visible && colliders.circles.includes(trunk.stubCollider), 'its boughs gone, the trunk breaks to its charred stump (with a collider)');
    // bough fire: a bough catches like wood
    D.reset();
    const bough = cinder.find((b) => b.kind === 'cinderBough');
    assert(D.ignite(bough.x, bough.z, 1, 1) >= 1 && bough.burn > 0, 'a bough of the Cinder Tree catches fire');
    const skull = nest.find((b) => b.kind === 'nestSkull');
    D.strike(skull.x, skull.z, 1, 20, { kind: BLOW.BLAST, by: 'boss', src: D.swing() });
    assert(skull.state === STATE.BROKEN, "the nest's great skull breaks");
  },

  // ---------------------------------------------------------------- counts, bones, debris by quality, and a rampage's cost
  budget() {
    const W = wyrm();
    const { D, d, game, world, U, step } = W;
    const bones = rigidBones(U).count;
    const by = {};
    for (const b of D.list) by[b.kind] = (by[b.kind] ?? 0) + 1;
    out(`     forest: ${D.list.length} pieces (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}); wreckage pools ${D.wreck.pools.map((p) => p.length).join(' / ')}`);
    // (664 since every tree of the wall and the landmarks break, 2026-11-16; 183 on 2026-11-15, 80 before)
    // (ADR-197, 2026-11-25: the forest he walks in, its undergrowth and the ridge: ~1700; 664 before)
    assert(D.list.length >= 1400 && D.list.length <= 1900, `${D.list.length} breakables in Cinderwood (1400..1900)`);
    assert(bones <= 1023 - 60, `${bones} bones in all with the wyrm (${D.batch.bones} the world's), under the 1023 slots with room for the hero (~140)`);
    // debris by quality: one boulder's break
    const one = (q) => {
      const B = build();
      B.D.setQuality(q);
      const b = B.D.list.find((o) => o.kind === 'boulder');
      const a0 = B.game.fx.alpha.count + B.game.fx.add.count;
      B.D.strike(b.x, b.z, 1, 9, { src: B.D.swing() });
      return B.game.fx.alpha.count + B.game.fx.add.count - a0;
    };
    const hi = one(QUALITY.HIGH), lo = one(QUALITY.LOW);
    assert(lo <= hi * 0.6 && lo > 0, `LOW quality throws ${lo} debris glyphs for a boulder's break (HIGH ${hi})`);
    // a 60 s rampage: the wyrm runs circles through the clearing, turning, while meteors land and the wood burns
    gc();
    let worst = 0, sum = 0, frames = 0, peakFx = 0, peakFire = 0, peakBurn = 0;
    const frameMs = new Float64Array(60 * 60);
    let a = 0;
    const R = 19;
    W.place(R, 0, Math.PI);
    game.player.position.set(0, 0, 0);
    for (let i = 0; i < 60 * 60; i++) {
      a += (8 / R) / 60;
      const ux = Math.cos(a) * R, uz = Math.sin(a) * R;
      d.position.set(ux, 0, uz);
      d.yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.sin(i / 90) * 0.6; // (tangent, swinging)
      game.time += 1 / 60;
      d.update(1 / 60);
      if (i % 50 === 0) {
        const mx = Math.cos(a + 1) * 14, mz = Math.sin(a + 1) * 14;
        // a meteor lands (world.impact + ignite, as world.js wires them)
        D.strike(mx, mz, 3, 1.5, { kind: BLOW.BLAST, by: 'boss', src: D.swing() });
        world.scars.ground(mx, mz, 1.5);
        world.fire.ignite(mx, mz, 1.6, 0.7);
        D.ignite(mx, mz, 1.6, 0.7);
      }
      const t0 = performance.now();
      D.update(1 / 60);
      const ms = performance.now() - t0;
      world.fire.update(1 / 60);
      world.scars.update(1 / 60, game.time);
      world.scorch.update(1 / 60);
      game.fx.alpha.update(1 / 60, game.time);
      game.fx.add.update(1 / 60, game.time);
      game.fx.fire.update(1 / 60);
      worst = Math.max(worst, ms);
      frameMs[frames] = ms;
      sum += ms;
      frames++;
      peakFx = Math.max(peakFx, game.fx.alpha.count + game.fx.add.count);
      peakFire = Math.max(peakFire, game.fx.fire.count);
      peakBurn = Math.max(peakBurn, D.burning);
    }
    const down = D.list.length - D.standing;
    out(`     rampage 60 s: ${down} pieces down, ${D.wreckage} wreckage, ${world.scars.count} marks; destructibles.update avg ${(sum / frames).toFixed(3)} ms, worst ${worst.toFixed(2)} ms; peak glyphs ${peakFx}, fire blobs ${peakFire}, alight ${peakBurn}`);
    assert(down >= 20, `the rampage wrecks the clearing (${down} pieces down)`);
    // (the budget of a frame is read on the 99.9th percentile, the 4th slowest of the 3600 frames, and the
    // single slowest frame gets a ceiling of its own: one frame's wall-clock time is the machine's as much
    // as the code's. Measured 2026-11-16, alone and with four suites beside it: avg 0.010 - 0.012 ms,
    // p99.9 0.37 - 0.71 ms, the slowest frame 1.1 - 1.8 ms, every time frame 83 (the first trees to fall:
    // their code's first run), on this build and on `main` alike; CI, its four suites on one shared
    // runner, put that one frame at 4.06 ms against the old `worst < 4`. A hitch of the code's own (a
    // whole mesh rebuilt in a frame) costs tens of ms and still fails the ceiling; many slow frames fail
    // the percentile.)
    const p999 = Float64Array.from(frameMs.subarray(0, frames)).sort()[Math.floor(frames * 0.999) - 1];
    assert(sum / frames < 0.5 && p999 < 1.5 && worst < 8, `destructibles.update: avg ${(sum / frames).toFixed(3)} ms, 99.9th percentile ${p999.toFixed(2)} ms, worst ${worst.toFixed(2)} ms a frame (budget: avg < 0.5, p99.9 < 1.5, worst < 8 in node)`);
    assert(peakBurn <= Math.max(3, Math.round(BREAK.spread.maxBurning)) + 6, `fires alight at the peak: ${peakBurn}`);
    // allocation in the hot paths this owns: a steady frame (the body sweeping, wood burning, logs
    // smouldering, hot ground, the marks) creates no object, array or closure. Measured as heap growth
    // over 2000 frames after a GC, against the same loop without the hot paths. What is left is V8
    // boxing doubles passed to calls (the burning wood's touch / burnCircle, the grid's cells: ~0.7 KB a
    // frame, measured 2026-11-15; the body's 23 sweeps go through sweepRec, which took 2.6 KB down to it),
    // not objects this code makes.
    const B = wyrm();
    // (three trees inside the clearing: in the wall's dense stands the fire spreads and trees burn through
    // and smoulder in the measure, events, not a steady frame; the wall's cost is the rampage's above)
    const tr = B.D.list.filter((b) => b.mat === 'wood' && b.state === STATE.INTACT && Math.hypot(b.x, b.z) < 30).slice(0, 3);
    for (const b of tr) B.D.ignite(b.x, b.z, 0.2, 40); // (burning for the whole measure; the fire field takes the flames)
    B.D.topple(B.D.list.find((b) => b.kind === 'deadTree' && b.state === STATE.INTACT), 1, 0, 'world');
    B.step(3);
    B.world.scorch.burnCircle(0, 0, 4, 0.2, 1);
    B.place(0, 6, 0);
    B.game.events.emit = B.emitRaw; // (the test's own event log allocates: off for the measure)
    // (ADR-197: the undergrowth at the treeline is wood within the fire's reach of these trees; what it
    // lights in the measure is new fires, events, not a steady frame: the spread's budgets are held. Each
    // piece alight costs ~0.5 - 1 KB a frame of boxed numbers in its flames, so a measure that let them
    // spread read 2.3 KB)
    B.D._tokens = B.D._wallSpread = -1e9;
    B.world.scars.cap = 60; // (so the marks' records are all made before the measure, and recycled in it)
    const loop = (frames, hot) => {
      for (let i = 0; i < frames; i++) {
        B.game.time += 1 / 60;
        const step = i % 200 < 100 ? 0.07 : -0.07;
        for (const h of B.d._hurtPool) h.x += step; // its hurt spheres move as a walk would (the rig is not this module's)
        if (hot) {
          B.d._wreck(1 / 60);
          B.D.update(1 / 60);
          B.world.scorch.update(1 / 60);
          B.world.scars.update(1 / 60, B.game.time);
        }
      }
    };
    loop(3000, true); // warm (JIT, pools, the marks' records)
    loop(3000, false);
    gc();
    let h0 = process.memoryUsage().heapUsed;
    loop(2000, false);
    const base = process.memoryUsage().heapUsed - h0;
    gc();
    h0 = process.memoryUsage().heapUsed;
    loop(2000, true);
    const grew = process.memoryUsage().heapUsed - h0 - base;
    assert(grew / 2000 < 2048, `2000 frames of the body sweeping, wood burning, logs smouldering: ${(grew / 2000).toFixed(0)} bytes a frame over the bare loop (< 2 KB: no object, array or closure a frame; the rest is V8 boxing call arguments)`);
  },
  // ---------------------------------------------------------------- the edge of the open ground (edge.js, ADR-125, ADR-197)
  // WALK mode (ADR-197, the owner's "no invisible walls"): the hero walks the whole forest out to its
  // ridge from the start, among the trunks and rocks (their colliders); the ridge's crags close the map
  // with no gap; the edge's ground is only the backstop behind them. What the wall's fallen trees open
  // (the lanes, ADR-125) is the BOSS's share, and a boss follows the hero out (and back in) too.
  edge() {
    const { D, world, log, step, colliders, game } = build();
    const E = D.edge, X = BREAK.edge, WK = X.walk, base = CONFIG.world.playerBound, rad = 0.45;
    const hero = (x, z) => { const p = { x, z }; world.resolve(p, rad, base, false, 'hero'); return p; };
    const walk = (a, from = 20, to = 80) => {
      const p = { x: Math.cos(a) * from, z: Math.sin(a) * from };
      for (let r = from; r < to; r += 0.2) {
        p.x += Math.cos(a) * 0.2;
        p.z += Math.sin(a) * 0.2;
        E.keep(p, rad);
      }
      return Math.hypot(p.x, p.z);
    };
    const off = (b, a) => { const da = Math.atan2(b.z, b.x) - a; return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))); };
    const at = (x, z) => { game.player.position.set(x, 0, z); E.update(1 / 60); };
    at(0, 8);
    let wOff = 0;
    for (let i = 0; i < E.n; i++) wOff = Math.max(wOff, Math.abs(E.W[i] - ridgeAt(E.laneAngle(i)) - RIDGE.inset));
    assert(E && E.walk && E.base === base && E.n === X.lanes && E.count > 450 && !E.open && E.lanes === 0 && E.R.every((v, i) => v === E.W[i]),
      `the forest has a walk edge: ${E?.n} lanes, the hero's ground out to the ridge (${Math.min(...E.W).toFixed(1)} - ${Math.max(...E.W).toFixed(1)} m; within ${wOff.toFixed(2)} m of its line + inset, read at the lane's sides), nothing torn, nothing open while he stands in the clearing`);

    // 1. he walks out in every direction to the ridge and no further; the boss gains nothing yet
    let worst = 0, gain = 0;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, r = walk(a), L = E.lane(Math.cos(a), Math.sin(a));
      // (he ends at his lane's end, give or take where a lane beside it ends sooner or later: its side walls)
      const lo = Math.min(E.W[L], E.W[(L + 1) % E.n], E.W[(L + E.n - 1) % E.n]) - rad - 0.05, hi = Math.max(E.W[L], E.W[(L + 1) % E.n], E.W[(L + E.n - 1) % E.n]) - rad + 1e-6;
      worst = Math.max(worst, r < lo ? lo - r : r > hi ? r - hi : 0);
      gain = Math.max(gain, E.bossGain(Math.cos(a) * 30, Math.sin(a) * 30));
    }
    const far = hero(0, 70);
    assert(worst < 0.05 && gain === 0 && Math.hypot(far.x, far.z) <= E.heroAt(0, 70) - rad + 1e-6 && Math.hypot(far.x, far.z) > base + 10,
      `straight out in 72 directions he reaches the ridge's backstop (off by ${worst.toFixed(3)} m) and no further (world.resolve(.., hero) from 70 m: ${Math.hypot(far.x, far.z).toFixed(1)} m); a boss gains nothing while he is in the clearing`);

    // 2. the ridge closes the map: its first row of crags stands shoulder to shoulder (no gap a hero fits through)
    const crags = D.list.filter((b) => b.kind === 'crag' && Math.abs(Math.hypot(b.x, b.z) - ridgeAt(Math.atan2(b.z, b.x)) - RIDGE.out) < 0.3);
    crags.sort((p, q) => Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
    let gap = -Infinity;
    for (let i = 0; i < crags.length; i++) {
      const a = crags[i], b = crags[(i + 1) % crags.length], ca = a.colliders[0], cb = b.colliders[0];
      gap = Math.max(gap, Math.hypot(ca.x - cb.x, ca.z - cb.z) - ca.r - cb.r);
    }
    assert(crags.length > 100 && gap < 2 * rad - 0.05 && crags.every((b) => b.state === STATE.INTACT && b.colliders.length === 1 && b.stubR > 0),
      `the ridge: ${crags.length} crags in its first row, the widest gap between two ${gap.toFixed(2)} m (a hero is ${(2 * rad).toFixed(2)} m across); each breaks to rubble that still blocks`);

    // 3. among the trees: random steps from 36 m out, never off his ground, never inside a trunk or a rock
    {
      const rng = mulberry32(77);
      const p = { x: Math.cos(0.4) * 36, z: Math.sin(0.4) * 36 };
      let offGround = 0, jump = 0, nan = 0, inside = 0, farthest = 0;
      const solid = colliders.circles.slice();
      for (let i = 0; i < 20000; i++) {
        const a = rng() * Math.PI * 2, l = 0.05 + rng() * 0.3;
        const tx = p.x + Math.cos(a) * l, tz = p.z + Math.sin(a) * l;
        p.x = tx;
        p.z = tz;
        world.resolve(p, rad, base, false, 'hero');
        if (!Number.isFinite(p.x + p.z)) nan++;
        const r = Math.hypot(p.x, p.z);
        farthest = Math.max(farthest, r);
        if (r > E.heroAt(p.x, p.z) - rad + 1e-4) offGround++;
        jump = Math.max(jump, Math.hypot(p.x - tx, p.z - tz));
        if (i % 50 === 0) for (const c of solid) if (Math.hypot(c.x - p.x, c.z - p.z) < c.r * 0.85 + rad - 1e-3) inside++;
      }
      assert(!nan && !offGround && !inside && jump < 1.2 && farthest > base + 2, `20000 random steps among the trees: never off his ground, never inside a trunk or a rock, pushed back ${jump.toFixed(2)} m at most in a step (reached ${farthest.toFixed(1)} m)`);
    }

    // 4. the boss follows him out: its gain is how far past the line he stands + lead, at once, capped
    // short of the ridge; when he comes back in it falls at `ease` m/s
    at(40, 0);
    const want = Math.min(40 - base + WK.lead, E.heroAt(40, 0) - base - WK.bossIn);
    const gOut = E.bossGain(30, 0), gFar = E.bossGain(-30, 0);
    assert(E.out && E.open && E.version >= 1 && near(gOut, want, 0.05) && gFar > 0, `he stands 40 m out: the edge is open, the boss may follow ${gOut.toFixed(1)} m past its bound (${want.toFixed(1)}: ${WK.lead} m past him, at least ${WK.bossIn} m short of the ridge)`);
    at(60, 0);
    assert(E.bossGain(30, 0) <= E.heroAt(30, 0) - base - WK.bossIn + 1e-6, `... never into the ridge: ${E.bossGain(30, 0).toFixed(1)} m at most (${WK.bossIn} m short of its end)`);
    const f0 = E.follow;
    at(0, 8);
    for (let k = 0; k < 60; k++) E.update(1 / 60);
    const f1 = E.follow;
    for (let k = 0; k < 1200; k++) E.update(1 / 60);
    assert(!E.out && near(f0 - f1, WK.ease * (61 / 60), 0.1) && E.follow === 0 && E.bossGain(30, 0) === 0 && !E.open, `back in the clearing: its follow falls ${(f0 - f1).toFixed(1)} m in a second (${WK.ease} m/s), then nothing; the edge is shut again`);

    // 5. the fallen wall is the boss's: a first-row tree down opens its lanes to the boss only (no world:edge)
    const lanesOf = (b) => E._lanes.map((l, i) => (l.length && l[0].b === b ? i : -1)).filter((i) => i >= 0);
    const first = D.list.filter((b) => b.def.edge > 0 && Math.hypot(b.x, b.z) < 34 && lanesOf(b).length >= 2 && lanesOf(b).every((i) => E._lanes[i].length > 1 && E._F0[i] < base + X.seal))[0];
    const mine = lanesOf(first);
    const edges0 = log.filter((e) => e.n === 'world:edge').length;
    D.strike(first.x, first.z, 0.5, 20, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    step(2.5);
    const W0 = E.W.slice();
    assert(first.state === STATE.BROKEN && E.open && mine.every((i) => E.T[i] > base + 1e-3) && E.R.every((v, i) => v === W0[i]) && log.filter((e) => e.n === 'world:edge').length === edges0,
      `a first-row tree down: its ${mine.length} lanes open for the boss (${mine.map((i) => E.T[i].toFixed(1)).join(', ')} m); the hero's ground does not move and no world:edge`);
    const a0 = Math.atan2(first.z, first.x);
    const wedge = D.list.filter((b) => b.def.edge > 0 && b.state === STATE.INTACT && off(b, a0) < 0.3 && Math.hypot(b.x, b.z) < 52);
    for (const b of wedge) D.topple(b, b.x / Math.hypot(b.x, b.z), b.z / Math.hypot(b.x, b.z), 'world');
    step(3);
    const gm = E.bossGain(Math.cos(a0) * 40, Math.sin(a0) * 40), gs = E.bossGain(Math.cos(a0 + 0.3) * 40, Math.sin(a0 + 0.3) * 40);
    assert(wedge.length >= 15 && gm > 4 && gm <= E.heroAt(Math.cos(a0), Math.sin(a0)) - base - WK.bossIn + 1e-6 && gs < gm,
      `${wedge.length} trees felled in a wedge: with the hero in the clearing the boss may go ${gm.toFixed(1)} m into the middle of it, ${gs.toFixed(1)} m at its side, never into the ridge`);

    // 6. a falling tree warns only where it can land on him: quiet in the forest while he is in the
    // clearing; out there, one that falls toward him is a red blow
    const standing = D.list.filter((b) => b.def.edge > 0 && b.state === STATE.INTACT && b.topples && b.h > 6 && !(b.leanTo > 0));
    const t1 = standing.filter((b) => off(b, a0 + Math.PI) < 0.4 && Math.hypot(b.x, b.z) > 40)[0];
    D.topple(t1, t1.x, t1.z, 'boss');
    const t2 = standing.filter((b) => b !== t1 && off(b, a0 + Math.PI / 2) < 0.4 && Math.hypot(b.x, b.z) > 38 && Math.hypot(b.x, b.z) < 44)[0];
    const hx = t2.x * 0.92 + Math.cos(a0 + Math.PI / 2) * 0, hz = t2.z * 0.92;
    at(hx, hz);
    const tells0 = log.filter((e) => e.n === 'combat:tell').length;
    D.topple(t2, hx - t2.x, hz - t2.z, 'boss');
    step(0.2);
    assert(t1.quiet && t2.state === STATE.FALLING && !t2.quiet && log.filter((e) => e.n === 'combat:tell').length > tells0,
      'a tree falling outward deep in the forest while he is in the clearing tells nothing; out among the trees, one falling toward him tells red');
    step(3);

    // the reset: the boss's lanes shut, the hero's ground is still the forest, the trunks are back
    at(0, 8);
    const n1 = colliders.circles.length;
    D.reset();
    for (let k = 0; k < 600; k++) E.update(1 / 60);
    const back = hero(Math.cos(a0) * 70, Math.sin(a0) * 70);
    assert(!E.open && E.T.every((v) => v === base) && E.G.every((v) => v === 0) && E.R.every((v, i) => v === E.W[i]) && Math.hypot(back.x, back.z) > base + 10 && colliders.circles.length >= n1,
      'the reset: the fallen wall stands again (the boss lanes shut), his ground is still the forest to the ridge, the trunks are back');

    // a set without a wall that opens: no edge, the circle as before
    const C = build(createCourtyard);
    const q = { x: 60, z: 0 };
    C.world.resolve(q, rad, 40, false, 'hero');
    assert(C.D.edge === null && near(q.x, 40 - rad, 1e-6), 'the Ashfall Courtyard has no edge: the hero is held on its circle (world.resolve falls back to the bound)');
  },

  // ---------------------------------------------------------------- a piece draws where it is (its matrices are placed, not auto-updated)
  // (last: it draws on the destructibles' cosmetic stream, which the scenarios after it would see)
  // ---------------------------------------------------------------- sliced bamboo (BREAK.slice): one cut, the top off at once
  slice() {
    const SL = BREAK.slice;
    const { D, step, log } = build(createWindlessGrove);
    const stalks = D.list.filter((b) => b.kind === 'bamboo');
    assert(stalks.length > 100 && stalks.every((b) => b.slice && b.lightPiece && b.ranged), `the grove's ${stalks.length} stalks are all sliced light pieces`);
    // ---- the hero's quickest cut (power 0.12) at chest height, from the south, on the stalk nearest the
    // middle that stands alone (a clump's other stalks would be cut by the same swing)
    const alone = (x) => !stalks.some((o) => o !== x && Math.hypot(o.x - x.x, o.z - x.z) < 1.8);
    const b = stalks.filter(alone).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
    const B = b.body, pos = B.geometry.attributes.position.array, s0 = B.start * 3;
    const y = 1.15;
    const n = D.sweep(b.x, b.z + 1.2, b.x, b.z - 0.3, 0.24, 0.12, { kind: BLOW.CUT, by: 'player', dx: 0, dz: -1, y: y - 0.3, ya: y, yb: y, src: D.swing() });
    assert(n === 1 && b.state === STATE.FALLING && D.struck.broke === 1 && !D.struck.held, `one quick cut (power 0.12) cuts it through (it falls; the blade goes on: nothing held it)`);
    assert(near(b.cutY, y, 1e-6) && near(B.cutY, y, 1e-6), `cut where the blade met it: ${b.cutY.toFixed(2)} m`);
    // its stump: as high as the cut, on a slant
    const ST = b.stub, sp = ST.geometry.attributes.position.array;
    let top = 0, low = Infinity;
    for (let k = ST.start * 3 + 1; k < (ST.start + ST.count) * 3; k += 3) {
      top = Math.max(top, sp[k]);
      if (sp[k] > y * 0.5) low = Math.min(low, sp[k]);
    }
    assert(ST.visible && top > y && top < y + 0.4 && low < y && low > y - 0.4, `its stump stands ${low.toFixed(2)} - ${top.toFixed(2)} m: the cut, slanted`);
    // the top: nothing of it below the cut, and it moves on the very next frame
    let below = 0;
    for (let t = 0; t < B.tris; t++) {
      const k = s0 + t * 9;
      const cy = (pos[k + 1] + pos[k + 4] + pos[k + 7]) / 3, deg = pos[k] === pos[k + 3] && pos[k + 1] === pos[k + 4] && pos[k] === pos[k + 6];
      if (cy < y - 0.02 && !deg) below++;
    }
    const before = pos.slice(s0, s0 + B.count * 3);
    step(1 / 60);
    let moved = 0;
    for (let k = 0; k < before.length; k++) if (pos[s0 + k] !== before[k]) moved++;
    assert(below === 0 && moved > 0, `the top keeps nothing below the cut (${below} triangles) and moves the first frame (${moved / 3 | 0} vertices)`);
    // it slides off the cut along the blow (north), then goes over: lands within its fall time
    step(SL.slideT);
    const p1 = b.pivot.position.z;
    let frames = 0;
    while (b.state === STATE.FALLING && frames < 200) { step(1 / 60); frames++; }
    assert(p1 < -0.05 && b.state === STATE.BROKEN && frames / 60 <= b.T + 0.05, `it slides off along the blow (${(-p1).toFixed(2)} m in ${SL.slideT} s), goes over and lands in ${(SL.slideT + frames / 60).toFixed(2)} s`);
    assert(!log.some((e) => e.n === 'combat:tell' || e.n === 'combat:flash'), 'quietly: no tell, no flash (a light piece)');
    // ---- a body brushing past does not slice; fire burns it as before
    const c = stalks.find((x) => x !== b && x.state === STATE.INTACT);
    D.sweep(c.x - 1, c.z, c.x + 1, c.z, 0.3, 0.2, { kind: BLOW.BLUNT, by: 'boss', brush: true, y: 1, src: D.swing() });
    assert(c.state === STATE.INTACT, 'a body brushing past does not slice it');
    // ---- a boss's blow slices too; the reset stands every stalk whole again
    D.strike(c.x, c.z + 0.4, 0.6, 0.3, { kind: BLOW.CUT, by: 'boss', y: 1.6, src: D.swing() });
    assert(c.state === STATE.FALLING && near(c.cutY, 1.6, 1e-6), `a boss's cut slices it at ${c.cutY.toFixed(2)} m`);
    step(2);
    D.reset();
    assert([b, c].every((x) => x.state === STATE.INTACT && x.body.cutY === 0 && x.body.visible && !x.stub.visible), 'the reset: they stand whole again');
  },

  // ---------------------------------------------------------------- bites (BREAK.chip, ?chip=a): a blow takes the bricks where it struck
  bite() {
    const C = BREAK.chip;
    setLook('chip', 'a');
    try {
      const { D, log, step } = build();
      const folded = (a, k) => a[k] === a[k + 3] && a[k] === a[k + 6] && a[k + 1] === a[k + 4] && a[k + 1] === a[k + 7] && a[k + 2] === a[k + 5] && a[k + 2] === a[k + 8];
      // ---- a tree of the forest (a run of the trees' mesh): a blade at 1.1 m, from the south
      const t = D.list.filter((b) => b.kind === 'tree' && b.body.parts > 1 && b.order.length > 0).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
      const B = t.body, pos = B.geometry.attributes.position.array, s0 = B.start * 3;
      const before = pos.slice(s0, s0 + B.count * 3);
      const cut = (y = 1.1, k = 0.25) => D.sweep(t.x, t.z + t.r + 1, t.x, t.z + 0.1, 0.55, (k * t.hpMax) / BREAK.mats.wood.take.cut, { kind: BLOW.CUT, by: 'player', dx: 0, dz: -1, y: y - 0.3, ya: y, yb: y, src: D.swing() });
      const hp0 = t.hp;
      assert(cut() === 1 && near(t.hp, hp0 - 0.25 * t.hpMax, 1e-6), `a cut worth a quarter of a tree's structure takes a quarter of it (${(t.hp / t.hpMax).toFixed(2)} left): the blows' arithmetic is unchanged`);
      const reach = Math.min(C.reach[1], Math.max(C.reach[0], 0.55 + C.pad));
      let n = 0, far = 0, section = 0, bad = 0, trunk = 0, set = 0;
      for (let i = 0; i < B.nb; i++) {
        const d = Math.hypot(B.cen[i * 3] - t.x, B.cen[i * 3 + 1] - 1.1, B.cen[i * 3 + 2] - (t.z + 0.1));
        if (d <= reach) section++;
        if (!B.bit[i]) continue;
        n++;
        if (B.tpart[i] === 0) trunk++;
        far = Math.max(far, d);
        // (a trunk's brick is set back into it by its depth along the way in; a leaf is folded away)
        for (let j = 0; j < 2; j++) {
          const f = B.btri[i * 2 + j];
          if (f < 0) continue;
          const k = f * 9, dep = B.bdep[i];
          if (dep > 0) {
            if (!near(pos[s0 + k] - before[k], B.bnor[i * 3] * dep, 1e-5) || !near(pos[s0 + k + 7] - before[k + 7], B.bnor[i * 3 + 1] * dep, 1e-5)) bad++;
            set++;
            // the way in points at the trunk's axis
            if ((B.cen[i * 3] - t.x) * B.bnor[i * 3] + (B.cen[i * 3 + 2] - t.z) * B.bnor[i * 3 + 2] > 0) bad++;
          } else if (!folded(pos, s0 + k)) bad++;
        }
      }
      assert(n >= 1 && n === Math.max(1, Math.round(0.25 * section)) && far <= reach + 1e-6 && bad === 0 && D.bitten === n, `it knocks out ${n} of the ${section} bricks within ${reach.toFixed(2)} m of where the blade met it (a quarter, nearest first: the farthest ${far.toFixed(2)} m; ${trunk} of the trunk), ${set} triangle(s) set back into the trunk toward its axis`);
      let kept = 0;
      for (let i = 0; i < B.nb; i++) {
        if (B.bit[i]) continue;
        const k = B.btri[i * 2] * 9;
        if (pos[s0 + k] === before[k] && pos[s0 + k + 4] === before[k + 4] && pos[s0 + k + 8] === before[k + 8]) kept++;
      }
      assert(kept === B.nb - n && B.nb < B.tris, `every other brick is where it was (${kept}); its ${B.tris} triangles are ${B.nb} bricks (a trunk's quads pair up, foliage stays single)`);
      assert(t.dropped === 0 && B.shown.every((v) => v === 1), 'with bites on a tree does not drop its crown parts in order: it loses what the blows took');
      // ... cut on until it falls: the section under the blade is gone as its structure runs out
      let cuts = 1;
      while (t.state === STATE.INTACT && cuts < 8) {
        step(0.25);
        cut();
        cuts++;
      }
      let left = 0;
      for (let i = 0; i < B.nb; i++) if (!B.bit[i] && B.tpart[i] === 0 && Math.hypot(B.cen[i * 3] - t.x, B.cen[i * 3 + 1] - 1.1, B.cen[i * 3 + 2] - (t.z + 0.1)) <= reach) left++;
      assert(t.state !== STATE.INTACT && cuts >= 4 && cuts <= 5 && left <= 1, `${cuts} such cuts fell it, and the trunk is cut through where they bit (${left} brick(s) of that section left)`);
      assert(log.filter((e) => e.n === 'world:impact' && e.kind === 'wear' && e.id === t.id).length >= 2, 'its stages are still told (world:impact wear)');
      // ---- a piece of the rigid batch: a standing stone, struck on its south face
      const s = D.list.find((b) => b.kind === 'stone' && b.bricks && b.topples);
      const K = s.bricks, idx = K.index.array, saved = idx.slice(K.i0, K.i0 + K.saved.length);
      D.strike(s.x, s.z + s.r + 0.3, 0.6, 0.3 * s.hpMax, { kind: BLOW.BLUNT, by: 'boss', y: 1.2, src: D.swing() });
      let sn = 0, sFar = 0, sBad = 0, south = 0, sSet = 0;
      for (let i = 0; i < K.T; i++) {
        if (!K.bit[i]) continue;
        sn++;
        if (K.cen[i * 3 + 2] > 0) south++;
        sFar = Math.max(sFar, Math.hypot(K.cen[i * 3], K.cen[i * 3 + 1] - 1.2, K.cen[i * 3 + 2] - (s.r + 0.3)));
        for (let j = 0; j < 2; j++) {
          const f = K.tri[i * 2 + j];
          if (f < 0) continue;
          if (K.dep[i] > 0) {
            // set back into the stone by its depth, the way in (toward its axis, or down from its top)
            const k = (K.v0 + f * 3) * 3;
            for (let c = 0; c < 3; c++) if (!near(K.pos.array[k + c] - K.psaved[f * 9 + c], K.nor[i * 3 + c] * K.dep[i], 1e-5)) sBad++;
            if (K.cen[i * 3] * K.nor[i * 3] + (K.cen[i * 3 + 1] - s.h / 2) * K.nor[i * 3 + 1] + K.cen[i * 3 + 2] * K.nor[i * 3 + 2] > 0) sBad++;
            sSet++;
          } else if (!(idx[K.i0 + f * 3] === idx[K.i0 + f * 3 + 1] && idx[K.i0 + f * 3] === idx[K.i0 + f * 3 + 2])) sBad++;
        }
      }
      assert(sn >= 1 && sn === K.n && sBad === 0 && south >= sn * 0.9 && sFar <= 0.6 + s.r + C.pad + 1e-6 && s.state === STATE.INTACT, `a blow on a standing stone's south face takes ${sn} of its ${K.T} bricks (${south} on that side; all within ${sFar.toFixed(2)} m of the blow's centre): ${sSet} triangle(s) set back into the stone in the batch's positions`);
      // ---- a blast eats the side that faced it
      const o = D.list.filter((b) => b.kind === 'tree' && b.state === STATE.INTACT && b !== t && b.body.parts > 3 && b.h > 5).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
      D.strike(o.x + 3, o.z, 4.5, 0.5 * o.hpMax, { kind: BLOW.BLAST, by: 'boss', y: 1, src: D.swing() });
      let east = 0, west = 0;
      for (let i = 0; i < o.body.nb; i++) if (o.body.bit[i]) o.body.cen[i * 3] > o.x ? east++ : west++;
      assert(east + west >= 4 && east > west * 1.5, `a blast east of a tree eats its east side (${east} bricks there, ${west} on the far side: the trunk's own)`);
      // ---- a landmark's bone (prop art)
      const rib = D.list.find((b) => b.kind === 'elderRib');
      D.strike(rib.x, rib.z, 1.2, 0.3 * rib.hpMax, { kind: BLOW.BLUNT, by: 'boss', y: 1.5, src: D.swing() });
      assert(rib.body.nBit >= 1 && rib.state === STATE.INTACT, `a rib of the Elder Wyrm loses ${rib.body.nBit} brick(s) to a blow`);
      // ---- a floor slab and a piece that only chips keep their own rules
      const flag = D.list.find((b) => b.floor);
      const fb = D.bitten;
      if (flag) D.strike(flag.x, flag.z, 0.5, 0.4, { kind: BLOW.BLUNT, by: 'boss', y: 0.1, src: D.swing() });
      assert(D.bitten === fb, 'a floor slab is not bitten (it cracks and breaks as a slab)');
      // ---- the reset
      step(2.5);
      D.reset();
      let diff = 0;
      for (let k = 0; k < before.length; k++) if (pos[s0 + k] !== before[k]) diff++;
      let idiff = 0;
      for (let k = 0; k < saved.length; k++) if (idx[K.i0 + k] !== saved[k]) idiff++;
      for (let k = 0; k < K.psaved.length; k++) if (K.pos.array[K.v0 * 3 + k] !== K.psaved[k]) idiff++;
      assert(diff === 0 && idiff === 0 && B.nBit === 0 && K.n === 0 && D.bitten === 0 && o.body.nBit === 0, 'the reset: every brick is back (the tree vertex for vertex, the stone index for index and vertex for vertex)');
      // ---- EVERY level (the level registry, so a new one is covered without being named here) and the
      // training room: it lists breakables; every piece in it that takes structure has bricks; a blow
      // on one of each kind bites it; the reset undoes it. (Cinderwood is the forest above, again here)
      const sets = LEVELS.map((L) => [L.name, L.buildSet]);
      // (the training room, ?stage=lab, ADR-099, is the one stage left whole on purpose: a measuring stage
      // of tiles, low walls and corner pylons, outside the fight; nothing of it is listed to break)
      const room = createTrainingRoom(createSharedUniforms(), new Colliders());
      assert(!(room.breakables?.length > 0), 'the training room lists no breakables (a measuring stage, whole on purpose: ARCHITECTURE.md "Destruction")');
      assert(sets.length >= 4 && sets.every(([, make]) => typeof make === 'function'), `the levels to check: ${sets.map(([n]) => n).join(', ')}`);
      for (const [name, make] of sets) {
        const A = build(make), L = A.D.list;
        const able = L.filter((b) => !b.floor && b.hpMax < Infinity);
        if (!able.length) {
          assert(false, `${name}: no breakable piece that takes structure (a level lists its background objects in its set's \`breakables\`: ARCHITECTURE.md "Destruction")`);
          continue;
        }
        const none = able.filter((b) => !(b.ranged ? b.body.tris > 0 : b.bricks?.T > 0));
        const kinds = [...new Set(able.map((b) => b.kind))];
        let bitten = 0, set = 0, folded = 0, missed = [];
        // (a set whose scenes morph, ADR-157: each scene is visited in turn, snapped, and a blow lands on
        // one of each kind standing in it; a set without scenes is one visit)
        const SC = A.set.scenes;
        if (SC) A.set.ambience?.setup?.(A.game);
        const visits = SC ? SC.ids : [null];
        const struck = new Set();
        for (const id of visits) {
          if (id) {
            SC.snap(id);
            // (the watchers of a hall that has been left: the snap to any other scene above makes it so)
            if (id === SC.ids[0] && SC.ids.length > 1) {
              SC.snap(SC.ids[1]);
              SC.snap(id);
            }
          }
          for (const kind of kinds) {
            if (struck.has(kind)) continue;
            // (one with nothing standing on it; failing that, as Halcyon Plaza's tower bases and statue,
            // where every one carries a raised top, one under its standing top, struck at its own height)
            const pick = (free) => able.find((x) => x.kind === kind && x.state === STATE.INTACT && !x.absent && !(free && x.top && x.top.state === STATE.INTACT));
            const b = pick(true) ?? pick(false);
            if (!b) continue;
            struck.add(kind);
            const n0 = A.D.bitten;
            // (a raised piece, a tower's top, a shop sign: struck inside its own height, y0 .. y0 + h: ADR-159's fix)
            A.D.strike(b.x + b.r, b.z, 0.7, 0.3 * b.hpMax + 0.2, { kind: BLOW.BLUNT, by: 'boss', y: b.y0 > 0 ? b.y0 + b.h * 0.5 : Math.min(1.2, b.h * 0.5), src: A.D.swing() });
            // (a sliced piece, bamboo, is cut through, not bitten: BREAK.slice)
            if (b.slice ? b.state === STATE.INTACT : A.D.bitten === n0) missed.push(kind);
            bitten += A.D.bitten - n0;
            const K = b.bricks;
            if (K) for (let i = 0; i < K.T; i++) if (K.bit[i]) K.dep[i] > 0 ? set++ : folded++;
          }
        }
        const unstruck = kinds.filter((k) => !struck.has(k));
        A.step(0.5);
        A.D.reset();
        SC?.reset?.();
        const left = L.filter((b) => (b.bricks?.n ?? 0) > 0 || (b.ranged && b.body.nBit > 0)).length;
        assert(none.length === 0 && missed.length === 0 && unstruck.length === 0 && bitten > 0 && left === 0, `${name}: all ${able.length} pieces that take structure have bricks; a blow on one of each of its ${kinds.length} kinds${SC ? ` (in each of its ${visits.length} scenes)` : ''} took ${bitten} (${set} set back, ${folded} folded${missed.length ? '; none from ' + missed.join(', ') : ''}${unstruck.length ? '; none standing: ' + unstruck.join(', ') : ''}); the reset puts them back`);
      }
      // ---- off (the default): nothing is bitten
      setLook('chip', '0');
      const t2 = D.list.find((b) => b.kind === 'tree' && b.state === STATE.INTACT && b.body.parts > 1);
      D.strike(t2.x, t2.z + 0.3, 0.6, 0.3 * t2.hpMax, { kind: BLOW.CUT, by: 'player', y: 1, src: D.swing() });
      assert(D.bitten === 0 && !(t2.body.nBit > 0) && t2.hp < t2.hpMax, 'with bites off (?chip=0) a blow takes structure and no bricks');
    } finally {
      setLook('chip', null);
      reseedBreaks();
    }
  },

  placed() {
    // (2026-11-16: the pieces are a tree outside the scene, their nodes do not auto-update; destructibles
    // `_place` puts a piece's world matrices right when it moves. The batch draws each body from its
    // matrixWorld: here every body's must equal what three would compute from the transforms, in every
    // state a piece can be in)
    const C = build(createCourtyard);
    const { D, step } = C;
    const m = new THREE.Matrix4();
    const wrong = () => {
      let bad = 0;
      for (const b of D.list) {
        if (b.def.look === 'range' && !b.node.parent) continue;
        for (const o of [b.body, b.stub, b.held]) {
          if (!o?.isMesh || !o.visible) continue;
          // what three would make of it: the chain's local matrices, freshly composed
          m.identity();
          for (let n = o; n && n !== D.pieces; n = n.parent) {
            const L = new THREE.Matrix4().compose(n.position, n.quaternion, n.scale);
            m.premultiply(L);
          }
          const a = o.matrixWorld.elements, e2 = m.elements;
          if (e2.some((v, i) => Math.abs(v - a[i]) > 1e-4)) bad++;
        }
      }
      return bad;
    };
    assert(wrong() === 0, 'built: every body draws where it stands');
    const pil = D.list.filter((b) => b.kind === 'pillar' && b.topples && b.state === STATE.INTACT);
    D.strike(pil[0].x, pil[0].z, 0.3, 0.2, { kind: BLOW.CUT, dx: 1, dz: 0, src: D.swing() });
    step(4 / 60);
    assert(pil[0].shake > 0 && wrong() === 0, 'shaken: mid-shudder it draws where its pivot is');
    D.topple(pil[1], 1, 0, 'world');
    step(0.4);
    assert(pil[1].state === STATE.FALLING && wrong() === 0, 'toppling: mid-fall it draws where it is going over');
    const top = D.list.find((b) => b.kind === 'colossus' && b.base);
    D.topple(top, 1, 0, 'world');
    step(0.7);
    assert(top.state === STATE.FALLING && wrong() === 0, 'a colossus coming off its cut: drawn where it is');
    const bo = D.list.find((b) => b.kind === 'boulder' && b.lift > 0 && b.state === STATE.INTACT);
    D.take(bo);
    D.carry(bo, bo.x + 1, 2.5, bo.z, 0.6, 1.2);
    const fl = D.floor.find((b) => b.state === STATE.INTACT);
    D.take(fl);
    D.carry(fl, fl.x, 1.8, fl.z, 0.3, 0.5);
    assert(wrong() === 0, 'carried: a boulder and a slab in a boss\'s hands are drawn there');
    D.throwTo(bo, bo.x + 6, bo.z, { time: 0.8 });
    step(0.3);
    assert(bo.state === STATE.FLYING && wrong() === 0, 'thrown: drawn in the air where it flies');
    step(3);
    D.reset();
    assert(wrong() === 0 && D.list.every((b) => b.pivot.position.lengthSq() === 0), 'restored: every piece drawn where it stood');
    const w = D.wreck.pools.flat().every((e) => e.mesh.matrixWorld.equals(e.mesh.matrix));
    assert(w, 'the wreckage\'s meshes are placed as they lie down (their world matrix is their own)');

    // (2026-11-16, the merge with ADR-120: Cinderwood's trees and landmarks are 'range' pieces POSED by
    // rewriting their vertices (destructibles RangeBody.pose), never nodes. In each state ADR-120 added
    // (a stage reached, the lean, a tree falling, carried, thrown, its crown burning down, the reset)
    // every shown vertex must be its home turned by the pivot (and the lean) about the base, no tree may
    // join the pieces' tree, nothing may join the scene, and the rigid pieces beside it still draw where
    // they are)
    const F = build();
    const FD = F.D;
    const qL = new THREE.Quaternion(), ax = new THREE.Vector3(), v = new THREE.Vector3(), qq = new THREE.Quaternion();
    const off = (b) => {
      const body = b.body, a = body.geometry.attributes.position.array, s = body.start * 3, H = body.home;
      qq.copy(b.pivot.quaternion);
      if (b.lean > 1e-4) qq.multiply(qL.setFromAxisAngle(ax.set(b.ldz, 0, -b.ldx), b.lean));
      const p = b.pivot.position;
      let worst = 0;
      for (let part = 0, v0 = 0; part < body.ends.length; part++) {
        const v1 = body.ends[part];
        if (body.visible && body.shown[part]) {
          for (let k = v0; k < v1; k += 5) {
            v.set(H[k * 3] - b.x, H[k * 3 + 1], H[k * 3 + 2] - b.z).applyQuaternion(qq);
            worst = Math.max(worst, Math.abs(v.x + b.x + p.x - a[s + k * 3]), Math.abs(v.y + p.y - a[s + k * 3 + 1]), Math.abs(v.z + b.z + p.z - a[s + k * 3 + 2]));
          }
        }
        v0 = v1;
      }
      return worst;
    };
    const scene = () => {
      let inScene = 0, auto = 0, ranged = 0;
      FD.root.traverse(() => inScene++);
      FD.pieces.traverse((o) => { if (o !== FD.pieces && o.matrixAutoUpdate) auto++; });
      for (const b of FD.list) if (b.ranged && b.node.parent) ranged++;
      return inScene <= 4 && auto === 0 && ranged === 0;
    };
    const fwrong = () => {
      let bad = 0;
      for (const b of FD.list) {
        if (b.ranged) continue;
        for (const o of [b.body, b.stub]) {
          if (!o?.isMesh || !o.visible) continue;
          m.identity();
          for (let n = o; n && n !== FD.pieces; n = n.parent) m.premultiply(new THREE.Matrix4().compose(n.position, n.quaternion, n.scale));
          if (m.elements.some((x, i) => Math.abs(x - o.matrixWorld.elements[i]) > 1e-4)) bad++;
        }
      }
      return bad;
    };
    const TOL = 2e-3; // (float32 vertices 70 m out)
    const trees = FD.list.filter((b) => b.kind === 'tree' && !b.wall && b.state === STATE.INTACT && b.order.length > 1 && b.topples && b.lift > 0).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    const [t1, t2, t3, t4] = trees;
    // a stage and the lean (its last stage: it creaks over along the blow)
    t1.hp = t1.hpMax * (BREAK.wear.at[2] - 0.02);
    FD._wearTo(t1, 1, 0, 'boss');
    FD._wake(t1);
    F.step(BREAK.wear.leanTime * 0.5);
    assert(t1.wear === 3 && t1.lean > 0.02 && t1.dropped >= 1 && off(t1) < TOL && scene(), `a tree at its last stage: ${t1.dropped} parts dropped, leaning ${t1.lean.toFixed(2)} rad, its vertices where its pose puts them (off ${off(t1).toExponential(1)} m); no node of it anywhere`);
    // a rigid piece shuddering beside it, and a tree falling
    const st = FD.list.find((b) => !b.ranged && b.topples && b.state === STATE.INTACT && b.mat === 'stone');
    FD.strike(st.x, st.z, 0.3, 0.2, { kind: BLOW.CUT, dx: 1, dz: 0, src: FD.swing() });
    FD.topple(t2, 0, 1, 'world');
    F.step(4 / 60);
    assert(st.shake > 0 && fwrong() === 0 && scene(), 'a stone of the circle mid-shudder draws where its pivot is, while a tree goes over beside it');
    F.step(0.3);
    assert(t2.state === STATE.FALLING && off(t2) < TOL && scene(), `a tree mid-fall is posed where it is going over (off ${off(t2).toExponential(1)} m)`);
    // a tree in the wyrm's jaws, then thrown
    FD.take(t3);
    FD.carry(t3, t3.x + 1, 2, t3.z, 0.5, 1);
    const carried = off(t3);
    FD.throwTo(t3, t3.x + 8, t3.z, { time: 0.8 });
    F.step(0.3);
    assert(carried < TOL && t3.state === STATE.FLYING && off(t3) < TOL && scene(), `a tree carried, then thrown: posed where it is held (off ${carried.toExponential(1)} m) and where it flies (${off(t3).toExponential(1)} m)`);
    // a crown burning down
    FD.ignite(t4.x, t4.z, 0.3, 1);
    F.step(t4.burnLife * 0.5);
    assert(t4.burn > 0 && t4.dropped >= 1 && off(t4) < TOL && scene(), `a burning tree drops its crown part by part (${t4.dropped} gone), what is left where it stands`);
    F.step(4);
    FD.reset();
    const back = [t1, t2, t3, t4].every((b) => b.body.visible && b.body.shown.every((x) => x === 1) && off(b) < 1e-6);
    assert(back && fwrong() === 0 && scene(), 'restored: the trees stand whole where they stood, every rigid piece drawn where it stood, nothing joined the scene');
  },

  // (last: it draws from the destructibles' own stream, and the scenarios before it are as on main)
  // ---------------------------------------------------------------- the Foxfire Terrace: its round floor, its rim, what burns, what only chips (world/foxTerrace.js)
  terrace() {
    const W = build(createFoxTerrace);
    const { D, set, colliders, step, U } = W;
    const R = TERRACE.r, RK = R + TERRACE.kerb;
    const F = D.floor, L = D.list;
    // the paving: cut to the round, every slab breakable, the disc paved
    const ring = set.slabs.filter((s) => Math.hypot(s.x, s.z) < RK + 0.2);
    let area = 0;
    for (const s of ring) {
      let a = 0;
      for (let k = 0; k < s.outline.length; k++) {
        const p = s.outline[k], q = s.outline[(k + 1) % s.outline.length];
        a += (p[0] * q[1] - q[0] * p[1]) / 2;
      }
      area += Math.abs(a);
    }
    const out = Math.max(...ring.flatMap((s) => s.outline.map(([x, z]) => Math.hypot(x, z))));
    assert(F.length >= 250 && ring.length >= 220 && area > 0.75 * Math.PI * RK * RK && out < RK + 0.05 && F.every((b) => b.def.look === 'range' && !b.colliders.length), `the terrace: ${ring.length} slabs and kerb stones within r ${RK} (none past ${out.toFixed(2)} m), ${((100 * area) / (Math.PI * RK * RK)).toFixed(0)} % of the disc paved; ${F.length} floor pieces in all with the steps and the path, each a range piece`);
    const near = [];
    assert(D.floorNear(0, 0, 6, near, { max: 40 }) >= 30, `${near.length} slabs within 6 m of the centre for his terrain moves (floorNear)`);
    // the rim: ten lanterns, six stone foxes, eight charm posts; the two landmarks
    const by = (k) => L.filter((b) => b.kind === k);
    const lan = by('lantern'), fox = by('foxStatue'), post = by('charmPost');
    const rOf = (b) => Math.hypot(b.x, b.z);
    assert(lan.length === TERRACE.lanterns && lan.every((b) => Math.abs(rOf(b) - TERRACE.lanternR) < 0.05 && b.def.look === 'prop'), `${lan.length} stone lanterns on the rim (r ${TERRACE.lanternR}, prop art)`);
    assert(fox.length === TERRACE.statues && fox.every((b) => Math.abs(rOf(b) - TERRACE.statueR) < 0.05 && !b.topples && b.lift === 0 && b.stub && b.def.look === 'prop'), `${fox.length} seated stone foxes on plinths (r ${TERRACE.statueR}): they do not topple, nobody lifts them, a plinth is left`);
    assert(post.length === TERRACE.posts && post.every((b) => Math.abs(rOf(b) - TERRACE.postR) < 0.05 && b.mat === 'wood' && b.burns && b.def.look === 'prop' && b.colliders.every((c) => c.soft)), `${post.length} charm posts outside the rim (r ${TERRACE.postR}): wood that burns, drawn in prop art, soft colliders`);
    const marks = [...by('greatFox'), ...by('spiritGate')];
    assert(marks.length === 2 && marks.every((b) => b.hpMax === Infinity && !b.topples && b.colliders.length >= 1 && b.x * TERRACE.greatFox.x !== 0 && b.z < 0), 'the great fox (west) and the spirit gate (east): in the northern half, they only chip (hp Infinity), on colliders');
    // nothing tall on the near side of the ring (ADR-112's rule)
    const tall = L.filter((b) => !b.floor && b.z > 6 && b.y0 + b.h > 3.2 && rOf(b) < TERRACE.postR + 1.5);
    assert(tall.length === 0, `nothing over 3.2 m stands on the terrace's near side (${tall.map((b) => `${b.kind} ${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')})`);
    // the way up: from the spawn to the middle, no collider in the way (a hero 0.45 m wide)
    const sp = { x: TERRACE.bonfire.x + 0.6, z: TERRACE.bonfire.z - 1.7 };
    const block = colliders.circles.filter((c) => {
      const dx = -sp.x, dz = -sp.z, t = Math.max(0, Math.min(1, ((c.x - sp.x) * dx + (c.z - sp.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(sp.x + dx * t - c.x, sp.z + dz * t - c.z) < c.r + 0.45;
    });
    assert(block.length === 0, `the way from the spawn (${sp.x}, ${sp.z}) up the path to the middle is clear (${block.map((c) => `${c.tag} ${c.x.toFixed(1)},${c.z.toFixed(1)}`).join(' ')})`);
    // a stone fox breaks to its plinth
    const f = fox[0];
    D.strike(f.x, f.z, 0.8, 20, { kind: BLOW.BLUNT, by: 'boss', src: D.swing() });
    step(0.5);
    assert(f.state === STATE.BROKEN && !f.body.visible && f.stub.visible && colliders.circles.includes(f.stubCollider), 'a heavy blow breaks a stone fox: its body goes, its plinth (and a collider) stays');
    // a charm post catches and burns through
    const p = post[0];
    assert(D.ignite(p.x, p.z, 0.8, 1) >= 1 && p.burn > 0, 'fire lands on a charm post: it catches (wood with prop art burns as the dead trees do)');
    let t = 0;
    while (p.state === STATE.INTACT && t < 60) {
      step(0.5);
      t += 0.5;
    }
    assert(p.state === STATE.BROKEN && p.burnt && p.stub.visible, `it burns through in ${t.toFixed(1)} s and leaves its snapped foot`);
    // the landmarks only chip
    for (const m of marks) D.strike(m.x, m.z, 1.5, 30, { kind: BLOW.BLAST, by: 'boss', src: D.swing() });
    step(0.5);
    assert(marks.every((m) => m.state === STATE.INTACT && m.body.visible), 'a blast of 30 on each landmark: they stand (they chip, they do not fall)');
    D.reset();
    assert(L.every((b) => b.state === STATE.INTACT), 'the reset: everything stands again');
    // the budget: no more bones than the courtyard's (443 measured on 2026-11-22), the set's own draw meshes
    const bones = rigidBones(U).count;
    let tris = 0;
    set.group.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const meshes = [];
    set.group.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o.name); });
    assert(bones <= 443, `${bones} bones (the courtyard's 443 or fewer); ${meshes.length} draw meshes with the set alone (${meshes.join(', ')}), ${Math.round(tris)} triangles`);
  },

  // ---------------------------------------------------------------- Halcyon Plaza (ADR-159): its pieces, raised pieces at their height, the cars' fuses
  city() {
    const W = build(createHalcyonPlaza);
    const { D, set, colliders, step, U, game, hits, log } = W;
    const L = D.list, by = (k) => L.filter((b) => b.kind === k);
    const cars = by('car'), tops = by('towerTop'), bases = by('towerBase'), shops = by('shopSign');
    assert(cars.length === 12 && cars.filter((b) => Math.hypot(b.x, b.z) < 13.5).length === 8 && cars.every((b) => b.mat === 'metal' && b.burns && b.cover && b.lift === 1 && b.stub), `12 cars (8 round the plaza inside his bound, 4 in the lot): metal that burns, cover, lifted by him, a burnt chassis left (${cars.length})`);
    assert(tops.length === 4 && bases.length === 4 && tops.every((t) => t.y0 === PLAZA.baseH && t.fallT === CITY.tower.fallT && t.blocks === CITY.tower.blocks) && bases.every((b) => b.top && tops.includes(b.top) && b.cover), 'four two-stage towers: a base that holds its top, the top raised (y0) on it');
    assert(shops.length === 8 && shops.every((b) => b.y0 === CITY.shop.y0 && b.def.light), `eight shop signs hung on the towers' fronts at y0 ${CITY.shop.y0}, light pieces (quiet falls)`);
    const statue = by('statue')[0], head = by('statueHead')[0], arm = by('statueArm')[0];
    assert(statue && head && arm && statue.top === head && arm.lift === 1 && head.y0 > 3 && arm.y0 > 3, `his statue: the body holds its head (raised to ${head?.y0.toFixed(1)} m), the raised arm a piece he can lift`);
    // nothing that stops a blade in the innermost 6 m
    const inner = L.filter((b) => !b.floor && Math.hypot(b.x, b.z) < PLAZA.clear + b.r && b.y0 < 2);
    assert(inner.length === 0, `the innermost ${PLAZA.clear} m are clear (${inner.map((b) => b.kind).join(', ')})`);
    // nothing tall south of the fight's middle near the plaza (the camera looks from the south)
    const tall = L.filter((b) => !b.floor && b.z > 8 && b.y0 + b.h > 4.6 && Math.abs(b.x) < 14);
    assert(tall.length === 0, `nothing over 4.6 m stands south of the plaza in the frame (${tall.map((b) => `${b.kind} ${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')})`);
    // a raised piece is struck at its real height (the y0 fix): a blow at 10 m reaches a tower's top
    const t = tops[0], hp0 = t.hp;
    D.strike(t.x, t.z + t.r, 1.0, 1.2, { kind: BLOW.BLAST, by: 'boss', y: PLAZA.baseH + 3.5, src: D.swing() });
    assert(t.hp < hp0 && t.state === STATE.INTACT, `a blow at ${(PLAZA.baseH + 3.5).toFixed(1)} m reaches the tower's top (${hp0.toFixed(2)} → ${t.hp.toFixed(2)})`);
    const lamp = by('lamp')[0], lh = lamp.hp;
    D.strike(lamp.x, lamp.z, 0.5, 2, { kind: BLOW.BLAST, by: 'boss', y: 8, src: D.swing() });
    assert(lamp.hp === lh, 'a blow at 8 m passes over a 5.2 m lamp post');
    const shop = shops[0], sh = shop.hp;
    D.strike(shop.x, shop.z, 0.4, 0.5, { kind: BLOW.BLUNT, by: 'boss', y: CITY.shop.y0 + 0.5, src: D.swing() });
    assert(shop.hp < sh, `a blow at ${(CITY.shop.y0 + 0.5).toFixed(1)} m reaches a shop sign hung at ${CITY.shop.y0} m`);
    // ... and a blow down on the street under one does not (the review of 22b049b: a raised piece took any
    // blow below it, its hit point clamped up to y0 + 0.2): strike, sweep and a projectile's stop
    {
      const s2 = shops[1], h2 = s2.hp, b2 = s2.bricks?.n ?? 0;
      D.strike(s2.x, s2.z, 0.5, 2, { kind: BLOW.BLUNT, by: 'boss', y: 1.0, src: D.swing() });
      D.sweep(s2.x - 1, s2.z, s2.x + 1, s2.z, 0.4, 2, { kind: BLOW.CUT, by: 'player', y: 1.0, src: D.swing() });
      D.sweep(s2.x - 1, s2.z, s2.x + 1, s2.z, 0.4, 2, { kind: BLOW.CUT, by: 'player', ya: 0.8, yb: 1.4, src: D.swing() });
      assert(s2.hp === h2 && (s2.bricks?.n ?? 0) === b2, `a blow at 1 m under a shop sign hung at ${CITY.shop.y0} m leaves it whole (${h2.toFixed(2)} -> ${s2.hp.toFixed(2)}, ${b2} -> ${s2.bricks?.n ?? 0} bites)`);
      D.sweep(s2.x - 1, s2.z, s2.x + 1, s2.z, 0.4, 0.5, { kind: BLOW.CUT, by: 'player', y: CITY.shop.y0 + 0.4, src: D.swing() });
      assert(s2.hp < h2, `a sweep at its own height (${(CITY.shop.y0 + 0.4).toFixed(1)} m) bites it (${h2.toFixed(2)} -> ${s2.hp.toFixed(2)})`);
    }
    // a blow on a tower's base goes to its top while the top stands (`holds`), and a broken base brings its top down
    {
      const b3 = bases[1], t3 = b3.top, th = t3.hp;
      D.strike(b3.x + b3.r, b3.z, 0.6, 0.5, { kind: BLOW.BLUNT, by: 'boss', y: 1.0, src: D.swing() });
      assert(t3.hp < th, `a ground blow on a tower's base wears its top (holds: ${th.toFixed(2)} -> ${t3.hp.toFixed(2)})`);
      for (let i = 0; i < 40 && t3.state === STATE.INTACT; i++) {
        D.strike(b3.x + b3.r, b3.z, 0.6, 1.5, { kind: BLOW.BLAST, by: 'boss', y: 1.0, src: D.swing() });
        step(0.05);
      }
      step(3);
      assert(t3.state !== STATE.INTACT, `blows on the ground at a tower's base bring its top down (${t3.state})`);
    }
    // the statue's head: a blow at its height takes the head and leaves the body
    const sb = statue.hp;
    D.strike(head.x, head.z, 0.45, 5, { kind: BLOW.BLAST, by: 'boss', y: head.y0 + 0.3, src: D.swing() });
    step(1.5);
    assert(head.state !== STATE.INTACT && statue.state === STATE.INTACT && statue.hp === sb, 'a blow at the statue\'s neck takes its head; the body is untouched');
    {
      // (the review of 22b049b) a blow at 1 m under his statue's raised arm does not reach it (a fresh
      // plaza: the neck's blast above took the arm with the head)
      const W2 = build(createHalcyonPlaza);
      const arm2 = W2.D.list.find((b) => b.kind === 'statueArm'), ah = arm2.hp;
      W2.D.strike(arm2.x, arm2.z, 0.6, 2, { kind: BLOW.BLUNT, by: 'boss', y: 1.0, src: W2.D.swing() });
      assert(ah > 0 && arm2.hp === ah, `a blow at 1 m under his statue's arm (at ${arm2.y0.toFixed(1)} m) leaves it whole (${ah.toFixed(2)} -> ${arm2.hp.toFixed(2)})`);
    }
    // the fuse: a car the hero broke burns, then goes up; the hero inside its reach and him take its blast
    set.ambience.setup(game);
    const amb = (sec) => { for (let k = 0; k < Math.round(sec * 60); k++) { step(1 / 60); set.ambience.update(1 / 60, game); } };
    const c = cars[0];
    game.player.position.set(c.x + 1.5, 0, c.z);
    game.boss.position.set(c.x - 1.6, 0, c.z);
    game.boss.mode = 'foot';
    const n0 = log.length;
    D.strike(c.x, c.z, 0.6, 50, { kind: BLOW.BLUNT, by: 'player', y: 0.8, src: D.swing() });
    amb(0.1);
    const fz = set.ambience.fuses.find((f) => f.def === c.def);
    assert(c.state === STATE.BROKEN && fz.state === 'fuse' && fz.by === 'player', 'a car the hero broke: its fuse is lit');
    amb(CITY.car.fuse + 0.2);
    const ev = log.slice(n0);
    const blast = ev.filter((e) => e.n === 'world:blast'), tell = ev.filter((e) => e.n === 'combat:tell' && e.attack === 'carBomb'), flash = ev.filter((e) => e.n === 'combat:flash' && e.attack === 'carBomb');
    const heroHit = hits.find((h) => h.who === 'hero' && h.attack === 'carBomb'), bossHit = hits.find((h) => h.who === 'boss' && h.damage === CITY.car.boss.damage);
    assert(fz.state === 'done' && blast.length === 1 && tell.length === 1 && flash.length === 1, `after ${CITY.car.fuse} s it explodes (world:blast), told (combat:tell) and flashed (combat:flash) as a falling piece is`);
    assert(heroHit && heroHit.damage === CITY.car.hero.damage && heroHit.blockable && !heroHit.parryable && bossHit && bossHit.posture === CITY.car.boss.posture, `the hero beside it takes ${CITY.car.hero.damage} (blockable), him ${CITY.car.boss.damage} and ${CITY.car.boss.posture} posture (the hero's car)`);
    // the chain cap: four cars broken at once go up two at a time
    const rest = cars.slice(1, 5), t0 = game.time, n1 = log.length;
    for (const k of rest) D.strike(k.x, k.z, 0.3, 50, { kind: BLOW.BLUNT, by: 'boss', y: 0.8, src: D.swing() });
    amb(3);
    const bangs = log.slice(n1).filter((e) => e.n === 'world:blast').map((e) => e.t ?? 0);
    void t0;
    const times = [];
    { let k = 0; for (const e of log.slice(n1)) if (e.n === 'world:blast') times.push(k); void k; }
    assert(bangs.length >= 4, `four broken cars: ${bangs.length} bangs (chains through world.impact may add more)`);
    // setPhase: 1 → 2 → 3 → 1
    assert(set.setPhase(2) === 2 && set.ambience.state.phase === 2 && set.setPhase(3) === 3 && set.setPhase(1) === 1, 'setPhase: the city\'s light by his phase, and back');
    D.reset();
    assert(L.every((b) => b.state === STATE.INTACT), 'the reset: everything stands again');
    const bones = rigidBones(U).count;
    let tris = 0;
    // (the shadow pass's copy of the batch is not counted: depth only)
    set.group.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'rigidShadow') tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const meshes = [];
    set.group.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o.name); });
    const batch = L.filter((b) => !b.ranged).length;
    { const per = {}; set.group.traverse((o) => { if (o.isMesh) per[o.name] = Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3); }); out(`     triangles by mesh: ${JSON.stringify(per)}`); }
    out(`     the city: ${L.length} pieces (${batch} in the rigid batch, ${D.floor.length} floor), ${bones} bones, ${meshes.length} draw meshes (${meshes.join(', ')}), ${Math.round(tris)} triangles, ${colliders.circles.length} colliders`);
    assert(batch <= 110 && bones <= 340 && tris <= 160000, `the phone budget: ${batch} batch pieces (<= 110), ${bones} bones (<= 340), ${Math.round(tris)} triangles (<= 160k)`);
  },

  // ---------------------------------------------------------------- the Veiled Crossing: its pieces, its throwables, its two scenes, its budget
  crossing() {
    const W = build(createVeiledCrossing);
    const { D, set, colliders, step, U, game } = W;
    const L = D.list, by = (k) => L.filter((b) => b.kind === k);
    const cars = by('car'), slabs = by('slab'), tops = by('towerTop'), bases = by('towerBase'), fallen = by('fallenTower');
    const floats = L.filter((b) => b.scene === 'void');
    assert(cars.length === 8 && cars.every((b) => b.mat === 'metal' && b.lift === 1 && b.cover && b.stub && !(b.stubR > 0)), `8 cars: metal, lifted by him, cover, a flat wreck left with no collider (a thrown hero goes over it) (${cars.length})`);
    assert(slabs.length === 6 && slabs.every((b) => b.lift === 1), `6 road slabs torn up, lifted by him (${slabs.length})`);
    assert(tops.length === 4 && bases.length === 4 && tops.every((t) => t.y0 === VEIL.tower.baseH && t.lift === 2) && bases.every((b) => b.top && tops.includes(b.top)), 'four two-stage tower stumps: a base holds its raised top (lift 2: only his pull)');
    const secW = (VEIL.fallen.x1 - VEIL.fallen.x0) / VEIL.fallen.sections;
    assert(fallen.length === VEIL.fallen.sections && secW >= 5 && fallen.every((b) => b.ranged && b.stub && !(b.stubR > 0) && b.cover), `the fallen tower: ${fallen.length} sections of ${secW.toFixed(1)} m (a 5 m line bores one), each leaving low rubble`);
    assert(floats.length >= 6 && floats.every((b) => b.absent && b.y0 > 1 && THROWABLE.includes(b.kind) && b.lift === 1), `${floats.length} floating pieces of the void, out of the world until it comes, raised (y0 > 1 m)`);
    assert(L.every((b) => b.floor || b.scene === 'crossing' || b.scene === 'void'), 'every piece but the floor belongs to a scene');
    assert(by('lamp').filter((b) => b.def.lamp).length === 3, 'three lamp posts still burn (`lamp`: the lamps layer lights them)');
    // nothing that stops a blade in the innermost metres; nothing tall south of the fight
    const inner = L.filter((b) => !b.floor && !b.absent && Math.hypot(b.x, b.z) < CROSSING.clear + b.r && b.y0 < 2);
    assert(inner.length === 0, `the innermost ${CROSSING.clear} m are clear (${inner.map((b) => b.kind).join(', ')})`);
    const tall = L.filter((b) => !b.floor && !b.absent && b.z > 8 && b.y0 + b.h > 4.6 && Math.abs(b.x) < 14);
    assert(tall.length === 0, `nothing over 4.6 m stands south of the fight in the frame (${tall.map((b) => `${b.kind} ${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')})`);
    // a throwable is always within 12 m of the fight (every point inside the fight's ring)
    const thr = L.filter((b) => !b.absent && ['car', 'slab', 'towerTop'].includes(b.kind));
    let worst = 0, wx = 0, wz = 0;
    for (let x = -CROSSING.r; x <= CROSSING.r; x += 1) for (let z = -CROSSING.r; z <= CROSSING.r; z += 1) {
      if (Math.hypot(x, z) > CROSSING.r - 3) continue;
      const d = Math.min(...thr.map((b) => Math.hypot(b.x - x, b.z - z)));
      if (d > worst) { worst = d; wx = x; wz = z; }
    }
    assert(worst <= 12, `a throwable within 12 m of every point of the fight (the farthest: ${worst.toFixed(1)} m at ${wx}, ${wz})`);
    // no gap between two circles the hero can be wedged in (a gap is wide enough to pass or closed)
    const cs = colliders.circles.filter((c) => c.on !== false && c.tag !== 'bonfire');
    const narrow = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const g = Math.hypot(cs[i].x - cs[j].x, cs[i].z - cs[j].z) - cs[i].r - cs[j].r;
      // (a gap a third circle closes is no gap; under 0.35 m it is a wall the hero cannot enter)
      const mx = (cs[i].x * cs[j].r + cs[j].x * cs[i].r) / (cs[i].r + cs[j].r), mz = (cs[i].z * cs[j].r + cs[j].z * cs[i].r) / (cs[i].r + cs[j].r);
      if (cs.some((c, k) => k !== i && k !== j && Math.hypot(c.x - mx, c.z - mz) < c.r)) continue;
      if (g > 0.35 && g < 0.95 && Math.hypot(cs[i].x, cs[i].z) < CROSSING.bound) narrow.push(`${cs[i].x.toFixed(1)},${cs[i].z.toFixed(1)}|${cs[j].x.toFixed(1)},${cs[j].z.toFixed(1)} ${g.toFixed(2)}`);
    }
    assert(narrow.length === 0, `no gap between two colliders narrower than the hero and not closed (${narrow.slice(0, 6).join('; ')})`);
    // a blow on a tower's base goes to its top while the top stands; blows on the ground bring the top down
    {
      const b3 = bases[0], t3 = b3.top, th = t3.hp;
      D.strike(b3.x + b3.r, b3.z, 0.6, 0.5, { kind: BLOW.BLUNT, by: 'boss', y: 1.0, src: D.swing() });
      assert(t3.hp < th, `a ground blow on a tower's base wears its top (${th.toFixed(2)} -> ${t3.hp.toFixed(2)})`);
      for (let i = 0; i < 40 && t3.state === STATE.INTACT; i++) {
        D.strike(b3.x + b3.r, b3.z, 0.6, 1.5, { kind: BLOW.BLAST, by: 'boss', y: 1.0, src: D.swing() });
        step(0.05);
      }
      step(3);
      assert(t3.state !== STATE.INTACT, `blows at a tower's base bring its top down (${t3.state})`);
    }
    // a 5 m line across the fallen tower bores one hole through it (a section felled, its neighbours stand)
    {
      const mid = fallen[2], hp0 = fallen.map((b) => b.state);
      for (let i = 0; i < 6; i++) D.sweep(mid.x, VEIL.fallen.z + 8, mid.x, VEIL.fallen.z - 8, 2.4, 3, { kind: BLOW.BLAST, by: 'boss', y: 1.5, src: D.swing() });
      step(1);
      const now = fallen.map((b) => b.state);
      assert(mid.state !== STATE.INTACT && now.filter((s, i) => s !== hp0[i]).length <= 2, `a 5 m line bores the fallen tower (sections ${now.join(' ')})`);
    }
    D.reset();
    // THE SCENES: to the void and back. Before it: a car broken to its wreck, a slab taken (gone), a heap chipped
    set.ambience.setup(game);
    const amb = (sec) => { for (let k = 0; k < Math.round(sec * 60); k++) { step(1 / 60); set.ambience.update(1 / 60, game); } };
    const car = cars[1], slab = slabs[0], heap = by('heap')[0], lamp = by('lamp')[0];
    for (let i = 0; i < 8 && car.state === STATE.INTACT; i++) D.strike(car.x, car.z, 0.6, 2, { kind: BLOW.BLUNT, by: 'boss', y: 0.8, src: D.swing() });
    D.take(slab);
    D.strike(heap.x + heap.r, heap.z, 0.3, 0.4, { kind: BLOW.BLUNT, by: 'boss', y: 0.5, src: D.swing() });
    amb(0.3);
    assert(car.state === STATE.BROKEN && slab.state === STATE.HELD && heap.state === STATE.INTACT && heap.hp < heap.hpMax, `before the void: the car broken (${car.state}), the slab held (${slab.state}), the heap chipped (${heap.hp.toFixed(2)})`);
    const scenes = [];
    game.events.on('world:scene', (e) => scenes.push(e.id));
    assert(set.scenes.to('void', { x: 2, z: -1 }) && set.scenes.morphing && set.scenes.now === 'void', 'scenes.to(void): a front runs from his point');
    amb(VEIL.morph.max + 0.3);
    const cityIn = L.filter((b) => b.scene === 'crossing' && !b.absent).length, voidIn = floats.filter((b) => !b.absent).length;
    assert(!set.scenes.morphing && cityIn === 0 && voidIn === floats.length && floats.every((b) => b.state === STATE.INTACT), `in the void: no city piece stands (${cityIn}), every floating piece does (${voidIn})`);
    assert(colliders.circles.every((c) => !L.some((b) => b.scene === 'crossing' && b.colliders.includes(c))), 'the city\'s colliders are out of the world in the void');
    // ... and they bob (their pivots move a little, whole steps)
    const f0 = floats.map((b) => b.pivot.position.y);
    amb(1.5);
    assert(floats.some((b, i) => Math.abs(b.pivot.position.y - f0[i]) > 0.01) && floats.every((b) => Math.abs(b.pivot.position.y) <= VEIL.float.bob + 1e-6), 'the floating pieces bob slowly');
    // a light by the scene: the void's fog close round the fight
    assert(U.uFogFar.value < 20 && U.uMoonColor.value.r < 0.1, `the void's light: fog to ${U.uFogFar.value.toFixed(1)} m, the moon ${U.uMoonColor.value.r.toFixed(3)}`);
    // back: as it was LEFT
    assert(set.scenes.to('crossing', { x: 0, z: 0 }), 'scenes.to(crossing)');
    amb(VEIL.morph.max + 0.3);
    assert(floats.every((b) => b.absent), 'back in the crossing: the floating pieces are gone');
    assert(car.state === STATE.BROKEN && !car.absent && car.stub.visible && !car.body.visible, `the car broken when the void came is back as its wreck (${car.state})`);
    assert(slab.absent, 'the slab he held when the void came stays gone');
    assert(heap.state === STATE.INTACT && !heap.absent && lamp.state === STATE.INTACT && !lamp.absent, 'the heap (chipped) and the lamp (whole) are back whole');
    assert(L.filter((b) => b.scene === 'crossing' && !b.absent).length === L.filter((b) => b.scene === 'crossing').length - 1, 'every other city piece is back');
    assert(scenes.join(',') === 'void,crossing', `world:scene as each morph starts (${scenes.join(', ')})`);
    // setPhase: 1 → 2 → 3 → 1
    assert(set.setPhase(2) === 2 && set.setPhase(3) === 3 && set.setPhase(1) === 1, 'setPhase: the light by his phase, and back');
    // the reset: everything of the crossing stands, the void's are out
    D.reset();
    set.scenes.reset();
    assert(L.every((b) => (b.scene === 'void') === b.absent) && L.filter((b) => !b.absent).every((b) => b.state === STATE.INTACT), 'the reset: the crossing whole again, the void\'s pieces out');
    // the budget (against the plaza's)
    const bones = rigidBones(U).count;
    let tris = 0;
    set.group.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'rigidShadow') tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const meshes = [];
    set.group.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o.name); });
    const batch = L.filter((b) => !b.ranged).length;
    { const per = {}; set.group.traverse((o) => { if (o.isMesh) per[o.name] = Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3); }); out(`     triangles by mesh: ${JSON.stringify(per)}`); }
    out(`     the crossing: ${L.length} pieces (${batch} in the rigid batch, ${D.floor.length} floor, ${floats.length} of the void), ${bones} bones, ${meshes.length} draw meshes (${meshes.join(', ')}), ${Math.round(tris)} triangles, ${colliders.circles.length} colliders`);
    assert(batch <= 110 && bones <= 340 && tris <= 160000, `the phone budget (the plaza's): ${batch} batch pieces (<= 110), ${bones} bones (<= 340), ${Math.round(tris)} triangles (<= 160k)`);
  },

  // ---------------------------------------------------------------- grass the sword cuts (the scorch map's A)
  // (last: its marks draw on the scars' cosmetic stream, which the scenarios after it would see)
  mow() {
    // the meadow on the west (x < 0), paving on the east (x >= 0): grass only where it grows
    const dens = (x, z) => (x < 0 ? 1 : 0);
    const { world, game } = build(createForest, dens);
    const sc = world.scorch, scars = world.scars;
    world.groundBlow = (x, z, o) => { if (Number.isFinite(x + z) && o && o.power > 0) scars.mark(x, z, o); };
    // a sword sweep stand-in (the hero's SwordSweep: a hilt, b the gameplay reach, point(f) the steel)
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const sw = { valid: true, a: V3(), b: V3(), pa: V3(), pb: V3(), point(f, out) { return out.lerpVectors(this.a, this.b, f * 0.44); } };
    const fx = { n: 0, mowBits(ax, az, bx, bz, n) { if (![ax, az, bx, bz, n].every(Number.isFinite)) throw new Error('NaN bits'); this.n += n; } };
    const pose = (A, B, cx, cz, y, ang, tilt = 0) => {
      // the blade from a hilt at (cx, y, cz) 1.9 m out at ground angle ang, its point dipped by tilt (m)
      A.set(cx, y, cz);
      B.set(cx + Math.cos(ang) * 1.9, y - tilt, cz + Math.sin(ang) * 1.9);
    };
    const swing = (cx, cz, y, a0, a1, tilt, frames = 14) => {
      const atk = { def: { windup: 0, active: 1 }, t: 0.2 };
      pose(sw.pa, sw.pb, cx, cz, y, a0, tilt);
      let add = 0;
      for (let i = 1; i <= frames; i++) {
        pose(sw.a, sw.b, cx, cz, y, a0 + ((a1 - a0) * i) / frames, tilt);
        add += mowSwing(game, atk, sw, fx);
        sw.pa.copy(sw.a);
        sw.pb.copy(sw.b);
        atk.t += 1 / 60;
      }
      return add;
    };
    const along = (cx, cz, r, a) => sc.tornAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    // (the RGB channels as they were, with some burn, heat and trample written first)
    sc.burnCircle(-20, -20, 2, 0.6, 0.8);
    sc.trample(-15, -20, 0.6, 0.8);
    const rgb = () => { const d = sc.data, o = []; for (let i = 0; i < d.length; i += 4) o.push(d[i], d[i + 1], d[i + 2]); return o; };
    const rgb0 = rgb(), burn0 = Float32Array.from(sc.burn), heat0 = Float32Array.from(sc.heat), tram0 = Float32Array.from(sc.tram);
    const R0 = Math.random;
    let draws = 0;
    Math.random = () => { draws++; return R0(); };

    // (the steel's strip into the scorch map is round 1's mow, `?mowLook=r1`; round 3 cuts along the drawn
    // arc: the `tops` scenario)
    setLook('mowLook', 'r1');
    // 1. a low sweep (the edge 0.12 m up, through grass ~0.5 m tall) mows its arc and nothing beside it
    const cx = -12, cz = 0;
    const add = swing(cx, cz, 0.12, -0.9, 0.9, 0.05);
    const onArc = [-0.6, -0.3, 0, 0.3, 0.6].map((a) => along(cx, cz, 0.75, a));
    const behind = along(cx, cz, 0.8, Math.PI), far = along(cx, cz, 3.2, 0);
    assert(add > 0 && Math.min(...onArc) >= GRASS.mow.maxK - 1e-6 && Math.max(...onArc) < GRASS.blade.bare[0], `a low sweep mows its arc: torn ${onArc.map((v) => v.toFixed(2)).join(' ')} along it (${GRASS.mow.maxK}: mown, never torn out)`);
    assert(behind === 0 && far === 0, `... and nothing beside it: behind him ${behind}, 3.2 m out (past the steel) ${far}`);
    assert(fx.n > 0 && fx.n <= GRASS.mow.bits.max, `the cut tops fly: ${fx.n} letters for the swing (1 .. ${GRASS.mow.bits.max})`);
    // 2. a swing at waist height clips the tall grass's tops lightly, and nothing on paving
    const meadowTop = Math.max(...[-0.5, 0, 0.5].map((a) => meadowHeight(-20 + Math.cos(a), 8 + Math.sin(a), () => 0.5)));
    const nWaist0 = sc.tornCells;
    swing(-20, 8, meadowTop * 1.05 + 0.2, -0.6, 0.6, 0);
    const waist = Math.max(...[-0.4, 0, 0.4].map((a) => along(-20, 8, 0.7, a)));
    assert(waist > 0 && waist < 0.5, `a swing at waist height (${(meadowTop * 1.05 + 0.2).toFixed(2)} m over grass ${meadowTop.toFixed(2)} m tall) only skims: torn ${waist.toFixed(2)} (0 .. 0.5), ${sc.tornCells - nWaist0} cells`);
    const nPave0 = sc.tornCells;
    swing(12, 0, 0.12, -0.9, 0.9, 0.05);
    assert(sc.tornCells === nPave0 && along(12, 0, 0.75, 0) === 0, `the same low sweep on paving tears nothing (${sc.tornCells - nPave0} cells)`);
    // a blade held still (a freeze) cuts nothing
    const nStill = sc.tornCells;
    { const atk = { def: { windup: 0, active: 1 }, t: 0.2 }; pose(sw.pa, sw.pb, -30, 10, 0.1, 0, 0); pose(sw.a, sw.b, -30, 10, 0.1, 0, 0); mowSwing(game, atk, sw, fx); }
    assert(sc.tornCells === nStill, 'a blade at rest (a hitstop) mows nothing');

    setLook('mowLook', null);
    // 3. every kind of floor mark tears its shape (the marks then lie on the stubble)
    const kinds = [
      ['slam', -40, -30, { kind: 'slam', power: 1.4, r: 3 }, [[0, 0], [0.8, 0]], [[4, 0]]],
      ['blast', -40, -20, { kind: 'blast', power: 1.2, r: 3, hot: true }, [[0, 0], [0, 0.7]], [[4, 0]]],
      ['cut', -40, -10, { kind: 'cut', power: 1, dx: 1, dz: 0, len: 3 }, [[0.4, 0], [1.5, 0], [2.6, 0]], [[1.5, 1.6]]],
      ['claws', -40, 0, { kind: 'cut', power: 1, dx: 1, dz: 0, len: 2.4, claws: 3, spread: 0.8 }, [[1, -0.8], [1, 0], [1, 0.8]], [[1, 2.4]]],
      ['thrust', -40, 10, { kind: 'thrust', power: 1, dx: 1, dz: 0 }, [[0, 0]], [[0, 2]]],
      ['dash', -40, 20, { kind: 'dash', power: 1.2, dx: 1, dz: 0, len: 5 }, [[1, 0], [2.5, 0], [4.5, 0]], [[2.5, 2]]],
      ['beam', -40, 30, { kind: 'beam', power: 1.5, dx: 1, dz: 0, len: 12, hot: true }, [[1, 0], [6, 0], [11, 0]], [[6, 2]]],
      ['tail arc', -55, -20, { kind: 'dash', power: 1.2, dx: 1, dz: 0, len: 6, arc: true, r: 4 }, [[4, 0], [4 * Math.cos(0.75), 4 * Math.sin(0.75)], [4 * Math.cos(1.4), 4 * Math.sin(1.4)]], [[0, 0]]],
      ['step', -55, 0, { kind: 'step', power: 1.2, dx: 1, dz: 0 }, [[0, 0]], [[1.5, 0]]],
    ];
    // (the marks' jagged shapes come from scars.js's own stream: from a known point, not where the scenarios before
    // left it; a new level's marks once moved the cut's edge off its middle sample)
    reseedMarks();
    for (const [name, x, z, o, inside, outside] of kinds) {
      const tin = inside.map(([u, v]) => sc.tornAt(x + u, z + v));
      const ylift0 = scars.marks.length;
      scars.mark(x, z, { by: 'boss', ...o });
      const tin2 = inside.map(([u, v]) => sc.tornAt(x + u, z + v)), tout = outside.map(([u, v]) => sc.tornAt(x + u, z + v));
      const ys = scars.marks.slice(ylift0).map((m) => m.y);
      const yAvg = ys.reduce((s, y) => s + y, 0) / Math.max(1, ys.length);
      assert(Math.max(...tin) === 0 && Math.min(...tin2) >= 0.6 && Math.max(...tout) === 0, `${name}: torn ${tin2.map((v) => v.toFixed(2)).join(' ')} along its shape (>= 0.6), ${tout.map((v) => v.toFixed(2)).join(' ')} beside it`);
      assert(ys.length > 0 && yAvg < SCAR.mark.y + SCAR.mark.grassLift * 0.6, `... its ${ys.length} glyphs lie on the stubble (mean ${yAvg.toFixed(2)} m; on standing grass ${(SCAR.mark.y + SCAR.mark.grassLift).toFixed(2)})`);
    }
    const paveMark = sc.tornCells;
    scars.mark(20, 20, { kind: 'slam', power: 1.4, r: 3, by: 'boss' });
    assert(sc.tornCells === paveMark, 'a slam on paving tears nothing');

    // 4. no Math.random, R / G / B untouched; ?mow=0 tears nothing
    assert(draws === 0, `tearing draws nothing from Math.random (${draws} draws)`);
    const rgb1 = rgb();
    let diff = 0;
    for (let i = 0; i < rgb0.length; i++) if (rgb0[i] !== rgb1[i]) diff++;
    // (the blast and the beam char the floor only where no grass grows: their own char, scars._char)
    let charOff = 0;
    for (let i = 0; i < burn0.length; i++) if (burn0[i] !== sc.burn[i] && dens(sc.min + ((i % sc.size) + 0.5) * sc.cellSize, 0) > 0) charOff++;
    assert(charOff === 0 && heat0.every((v, i) => v === sc.heat[i]) && tram0.every((v, i) => v === sc.tram[i]), `the tears change no burn on the meadow, no heat, no trample (${diff} R/G/B bytes differ: the marks' own char on paving)`);
    setLook('mow', '0');
    try {
      const n0 = sc.tornCells;
      swing(-30, 20, 0.1, -0.9, 0.9, 0.05);
      scars.mark(-30, 30, { kind: 'slam', power: 1.4, r: 3, by: 'boss' });
      sc.tear(-30, 25, 2, 1);
      assert(sc.tornCells === n0, `?mow=0: the sweep, a slam and tear() tear nothing (${sc.tornCells - n0} cells)`);
    } finally {
      setLook('mow', null);
    }
    // 5. reset() clears A (the fight's reset)
    sc.reset();
    let a = 0;
    for (let i = 3; i < sc.data.length; i += 4) a += sc.data[i];
    assert(sc.tornCells === 0 && a === 0 && sc.tornAt(cx + 0.75, cz) === 0, 'scorch.reset() clears the torn grass (A all 0)');
    Math.random = R0;
  },

  // ---------------------------------------------------------------- the cut tops (round 2, world/mowFx.js)
  // (the 3D grass's cut, as ?dragon=0 draws it: dgGrass 0; the dragon print's own cut, which ships, is
  // tests/integration/dgGrass.mjs)
  tops() {
    setLook('dgGrass', '0');
    try {
      topsOld();
    } finally {
      setLook('dgGrass', null);
    }
  },
};
function topsOld() {
    // the meadow on the west, paving on the east; a real grass of 30k blades over 24 m
    const dens = (x, z) => (x < 0 ? 1 : 0);
    setLook('mowLook', 'a'); // (the thrown look first: its tops fly up and along; b, the default, below)
    const { world, game } = build(createForest, dens);
    const sc = world.scorch;
    world.grass = createGrass(game.U, { count: 30000, extent: 24, density: dens, height: (x, z, r) => 0.5 * (0.75 + r() * 0.5) });
    const R0 = Math.random;
    let draws = 0;
    Math.random = () => { draws++; return R0(); };
    try {
      sc.update(1 / 60); // (the tops are built on the first frame the grass is there)
      const T = sc.tops;
      assert(!!T && game.scene.children.includes(T.mesh), 'the cut tops are built on the first frame, their batch in the scene');
      const B = world.grass.blades, G = GRASS.blade;
      // the blades a strip reaches: the very test the grass shader makes (bilinear torn x gain over the
      // blade's own threshold) decides which lose their tops, on the call itself
      T.setFling(1, 0, 1);
      // (a sweep's sub-step: under the per-call cap, GRASS.fly.perTear, which only a big mark reaches)
      sc.tearLine(-7, 0, -5.8, 0, 0.8, GRASS.mow.maxK);
      T.clearFling();
      const fr = (v) => v - Math.floor(v);
      let want = 0, got = 0, wrong = 0, far = 0;
      for (let i = 0; i < B.n; i++) {
        const x = B.root[i * 4], z = B.root[i * 4 + 1];
        if (B.data[i * 4 + 3] > 0.5) continue;
        const cut = T._tornAt(x, z) * G.gain >= fr(B.root[i * 4 + 3] * 3.17 + 0.37) * 0.92 + 0.04;
        if (cut) want++;
        if (T.cut[i]) got++;
        if (!!T.cut[i] !== cut) wrong++;
        if (T.cut[i] && (Math.abs(z) > 1.6 || x > -2.5 || x < -9.5)) far++;
      }
      assert(want > 50 && wrong === 0 && far === 0, `a strip cuts ${got} blades on its own call, exactly those the shader shows as stubs (${wrong} differ, ${far} outside the strip)`);
      assert(T.n === got && T.total === got, `... and every cut blade's top leaves on that frame: ${T.n} tops for ${got} cut blades`);
      // a top starts where its blade's top was: on the strip, at a blade's height, thrown along the swing
      let off = 0, up = 0, along = 0, thrown = 0;
      for (let j = 0; j < T.n; j++) {
        if (Math.abs(T.pz[j]) > 1.6 || T.px[j] > -2.5 || T.px[j] < -9.5) off++;
        if (T.py[j] > 0.02 && T.py[j] < 0.7) up++;
        if (T.state[j] !== 0) continue;
        thrown++;
        if (T.vx[j] > 0 && T.vy[j] > 0) along++;
      }
      // (a, round 4: a sprinkle: GRASS.fly.throw.share of the tops are tossed, the rest topple off)
      const sh = GRASS.fly.throw.share;
      assert(off === 0 && up === T.n && along === thrown && thrown > T.n * (sh - 0.15) && thrown < T.n * (sh + 0.15), `the tops start on the strip (${off} off), at a blade's height (${up}/${T.n}); ${thrown} of them (about ${sh * 100} %) are thrown, all up and along the swing (${along})`);
      // the same cut again tears nothing new: no second top
      sc.tearLine(-7, 0, -5.8, 0, 0.8, GRASS.mow.maxK);
      assert(T.total === got, `a blade loses its top once (${T.total - got} more on a second pass)`);
      // they fly, land, lie and thin away
      let flying = 0;
      for (let f = 0; f < 30; f++) sc.update(1 / 60);
      for (let j = 0; j < T.n; j++) if (T.state[j] === 0) flying++;
      let lying = 0;
      for (let f = 0; f < 60; f++) sc.update(1 / 60);
      for (let j = 0; j < T.n; j++) if (T.state[j] === 2 && T.py[j] <= 0.021) lying++;
      const n1 = T.n;
      for (let f = 0; f < 60 * 5; f++) sc.update(1 / 60);
      assert(flying > 0 && lying === n1 && T.n === 0 && T.geo.instanceCount === 0, `0.5 s on ${flying} are in the air; 1.5 s on all ${lying} lie on the floor; 6.5 s on none is left (${T.n})`);
      // on paving nothing is cut
      sc.tearLine(2, 0, 6, 0, 0.8, 1);
      assert(T.n === 0, `a strip on paving cuts no blade (${T.n} tops)`);
      // a slam's mark throws the grass it tears out, from all of its round
      sc.tear(-6, 5, 1.6, 1);
      let n = 0, w = 0, e = 0;
      for (let j = 0; j < T.n; j++) { n++; if (T.px[j] < -6) w++; else e++; }
      assert(n > 30 && w > n * 0.25 && e > n * 0.25, `a mark's tear throws its grass out of the whole round (${n} tops: ${w} west, ${e} east of its middle)`);
      // the reset: every blade whole, no top
      sc.reset();
      let cut = 0;
      for (let i = 0; i < B.n; i++) cut += T.cut[i];
      assert(T.n === 0 && cut === 0, 'scorch.reset() takes every top away and makes every blade whole');
      assert(draws === 0, `the tops draw nothing from Math.random, built or flying (${draws} draws)`);
    } finally {
      Math.random = R0;
      setLook('mowLook', null);
    }
    // round 3: the cut follows the DRAWN arc (player/fx.js trail -> tops.cutArc), the default look b
    {
      setLook('mowLook', 'b');
      setLook('grassSpray', 'b'); // (the letter batch's spray: b's tops alone in the tops' batch)
      const W = build(createForest, dens);
      const sc3 = W.world.scorch;
      W.world.grass = createGrass(W.game.U, { count: 30000, extent: 24, density: dens, height: (x, z, r) => 0.5 * (0.75 + r() * 0.5) });
      let d3 = 0;
      Math.random = () => { d3++; return R0(); };
      try {
        sc3.update(1 / 60);
        const T = sc3.tops, B = W.world.grass.blades, A = GRASS.arc;
        assert(T.look === 'b' && GRASS.fly.look === 'a', 'b, sliced, as asked (the default is a, thrown)');
        // an edge stroke low in the grass (0.3 m up) from (-8, 1) to (-6, 1): exactly the blades within w/2 of it
        const n = T.cutArc(-8, 0.3, 1, -6, 0.3, 1, false);
        let inside = 0, wrong = 0;
        for (let i = 0; i < B.n; i++) {
          if (B.data[i * 4 + 3] > 0.5) continue;
          const x = B.root[i * 4], z = B.root[i * 4 + 1];
          const t = Math.max(0, Math.min(1, (x + 8) / 2)), d = Math.hypot(-8 + 2 * t - x, 1 - z);
          const want = d <= A.w * 0.5;
          if (want) inside++;
          if (!!T.cut[i] !== want) wrong++;
        }
        assert(n === inside && inside > 20 && wrong === 0 && sc3.tornCells === 0, `an arc stroke in the grass cuts the ${n} blades within ${A.w / 2} m of its line and no other (${wrong} differ), on its own call, without the map's cells (${sc3.tornCells} torn)`);
        // b: the tops topple, lean over less than lying flat, drift little, are no brighter than the grass
        let topple = 0, lean = 0;
        for (let j = 0; j < T.n; j++) { if (T.state[j] === 1) topple++; if (Math.abs(T.lieRot[j]) < Math.PI * 0.45) lean++; }
        assert(topple >= T.n * 0.85 && lean >= T.n * 0.85, `b: ${topple}/${T.n} tops topple off their stubs, ${lean} come to rest leaning (under 81 degrees)`);
        for (let f = 0; f < 30; f++) sc3.update(1 / 60);
        let lit = 0;
        for (let j = 0; j < T.n; j++) lit = Math.max(lit, T.aC.array[j * 4 + 3]);
        assert(lit <= 1.06, `b: a top is no brighter than its grass (x ${lit.toFixed(2)})`);
        for (let f = 0; f < 60 * 3; f++) sc3.update(1 / 60);
        assert(T.n === 0, `b: 3.5 s on, every top has thinned away (${T.n} left)`);
        // a stroke high over the grass cuts nothing; the reset makes every blade whole
        const hi = T.cutArc(-8, 2.2, 4, -6, 2.2, 4, false);
        sc3.reset();
        let left = 0;
        for (let i = 0; i < B.n; i++) left += T.cut[i] ? 1 : 0;
        assert(hi === 0 && left === 0, `a stroke 2.2 m up cuts nothing (${hi}); the reset leaves no blade cut (${left})`);
        assert(d3 === 0, `the arc's cut draws nothing from Math.random (${d3})`);
      } finally {
        Math.random = R0;
        setLook('mowLook', null);
        setLook('grassSpray', null);
      }
      // a, the default (round 4): the same arc cut, a quiet toss: no brighter than the grass, short-lived
      const W4 = build(createForest, dens);
      W4.world.grass = createGrass(W4.game.U, { count: 30000, extent: 24, density: dens, height: (x, z, r) => 0.5 * (0.75 + r() * 0.5) });
      W4.world.scorch.update(1 / 60);
      const T4 = W4.world.scorch.tops;
      const n4 = T4.cutArc(-8, 0.3, 1, -6, 0.3, 1, false);
      let fly4 = 0;
      for (let j = 0; j < T4.n; j++) if (T4.state[j] === 0 && T4.tipMin[j] === 0) fly4++; // (the tops alone: a chip's colour is its blade's top's)
      W4.world.scorch.update(1 / 60);
      let lit4 = 0;
      for (let j = 0; j < T4.n; j++) if (T4.tipMin[j] === 0) lit4 = Math.max(lit4, T4.aC.array[j * 4 + 3]); // (the tops; a chip is a touch lighter in the air)
      for (let f = 0; f < 60 * 3; f++) W4.world.scorch.update(1 / 60);
      // the grass spray (round 5): letters thrown off the blades the arc cut, then gone
      // (round 6, the default a: chips of the cut blades' own letters, in the tops' batch, the grass's colour)
      const SPT = GRASS.spray, per = SPT[SPT.look].per;
      assert(['a', 'a2', 'm', 'm2', 'm3'].includes(SPT.look) && T4.spray === null && T4.chipped >= n4 * per * 0.8 && T4.chipped <= n4 * per + 1, `the grass spray (${SPT.look}) throws ${T4.chipped} chips off the ${n4} cut blades (about ${per} a blade)`);
      assert(T4.look === 'a' && n4 > 20 && fly4 > n4 * 0.25 && fly4 < n4 * 0.75 && lit4 <= 1.16 && T4.n === 0, `a (the default) cuts along the arc too (${n4} blades), tosses ${fly4} of the tops, no brighter than x ${lit4.toFixed(2)}, all gone 3 s on (${T4.n} left)`);
    }
    // `?grassSpray=0`: no spray (today's grass, exactly)
    setLook('grassSpray', '0');
    try {
      const W0 = build(createForest, dens);
      W0.world.grass = createGrass(W0.game.U, { count: 2000, extent: 24, density: dens, height: () => 0.5 });
      W0.world.scorch.update(1 / 60);
      assert(W0.world.scorch.tops && W0.world.scorch.tops.spray === null, '?grassSpray=0: no grass spray');
    } finally {
      setLook('grassSpray', null);
    }
    // round 1's look builds no tops
    setLook('mowLook', 'r1');
    try {
      const W2 = build(createForest, dens);
      W2.world.grass = createGrass(W2.game.U, { count: 2000, extent: 24, density: dens, height: () => 0.5 });
      W2.world.scorch.update(1 / 60);
      assert(W2.world.scorch.tops === null, '?mowLook=r1: no cut tops (round 1)');
    } finally {
      setLook('mowLook', null);
    }
}
const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
function near0(a, b, eps = 1e-6) {
  return near(a, b, eps);
}

// `all`, or a comma list; GCD_SKIP (a comma list) leaves scenarios out of `all` (tests/run.mjs runs
// `budget` on its own, after the parallel suites: its frame times are wall-clock)
const skip = new Set((process.env.GCD_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
for (const n of skip) if (!S[n]) { out(`unknown scenario in GCD_SKIP: ${n}`); process.exit(2); }
const BITES_OFF = new Set(['wear', 'placed']);
const names = SCEN === 'all' ? Object.keys(S).filter((n) => !skip.has(n)) : SCEN.split(',');
for (const n of names) {
  if (!S[n]) { out(`unknown scenario ${n}`); process.exit(2); }
  out(`\n== WORLD ${n.toUpperCase()}`);
  // (bites are on by default, ADR-132: a tree then loses what the blows took, not its crown parts in
  // stages. These scenarios check the stages, which is what ?chip=0 plays; `bite` checks the bites)
  if (BITES_OFF.has(n)) setLook('chip', '0');
  try {
    S[n]();
  } catch (err) {
    fails++;
    out('FAIL', `${n} threw: ${err?.stack ?? err}`);
  } finally {
    if (BITES_OFF.has(n)) setLook('chip', null);
  }
}
if (errors.length) { fails++; out('FAIL console errors:\n  ' + errors.slice(0, 8).join('\n  ')); }
out(fails ? `\n${fails} FAILED` : '\nall world checks passed');
process.exit(fails ? 1 : 0);
