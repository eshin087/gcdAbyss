// The Ashfall level and the Ash Disciple, headless (docs/specs/ash-disciple.md): the REAL Player,
// AshDisciple, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, CameraRig,
// Events) wired like src/main.js for `?level=ash`; the world is a light mock on the real Colliders
// with the courtyard's ring of pillars. A bot drives the input.
// usage: node duel.mjs <repoRoot> [scenario]   (env: ABYSS_SEED=n reseeds the AI)
//   scenario: levels | data | timing | guard | clash | trade | deflect | ghostep | execute | phase | flow | win | all
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ui, AUDIO, resetWindow } from './shim.mjs';

const ROOT = process.argv[2];
const SCEN = process.argv[3] || 'all';
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const THREE = await import(pathToFileURL(`${ROOT}/node_modules/three/build/three.module.js`).href);
const { CONFIG } = await imp('src/core/config.js');
const { Events } = await imp('src/core/events.js');
const { CameraRig } = await imp('src/core/cameraRig.js');
const { createSharedUniforms } = await imp('src/render/shaderLib.js');
const { LightPool } = await imp('src/render/lights.js');
const { GlyphParticles } = await imp('src/render/particles.js');
const { Colliders } = await imp('src/world/colliders.js');
const { TELL, RESULT, DEFENSE, POSTURE } = await imp('src/combat/rules.js');
const { LEVELS, DEFAULT_LEVEL, getLevel, levelFromSearch, applyLevel, levelUrl } = await imp('src/levels/index.js');
const { COURTYARD } = await imp('src/world/courtyard.js');
const { Player } = await imp('src/entities/player/player.js');
const { AshDisciple } = await imp('src/entities/enemies/ashDisciple/disciple.js');
const { MOVES, MOVE_NAMES, CLIP, realise } = await imp('src/entities/enemies/ashDisciple/moves.js');
const { TUNING } = await imp('src/entities/enemies/ashDisciple/tuning.js');
const { Hud } = await imp('src/ui/hud.js');
const { Bindings, installActions } = await imp('src/core/bindings.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');

const ASH = getLevel('ash');
const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.ABYSS_SEED ?? 4242);
const DT = 1 / 60;

// the event catalogue (docs/ARCHITECTURE.md → "Event catalogue"): what this level emits must be in it
const CATALOGUE = (() => {
  const md = fs.readFileSync(`${ROOT}/docs/ARCHITECTURE.md`, 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Event catalogue')) ?? '';
  const names = new Set();
  for (const m of sec.matchAll(/`([a-zA-Z]+(?::[a-zA-Z0-9]+)?)[ `]/g)) names.add(m[1]);
  return names;
})();

applyLevel(ASH);

function build() {
  resetWindow();
  Math.random = mulberry32(SEED);
  ui.children.forEach((c) => (c.parentNode = null));
  ui.children.length = 0;
  const U = createSharedUniforms();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far);
  const keys = new Set(), pk = new Set(), rk = new Set(), tapKeys = new Set();
  const btn = [false, false, false], pb = [false, false, false], rb = [false, false, false], tapBtn = [false, false, false];
  const input = {
    enabled: true, anyPressed: false, wheel: 0, mouse: { ndcX: 0, ndcY: 0 },
    keys, pressedKeys: pk, releasedKeys: rk, buttons: btn, pressedButtons: pb, releasedButtons: rb, axis: { x: 0, y: 0 },
    down(c) { return this.enabled && keys.has(c); }, pressed(c) { return this.enabled && pk.has(c); }, released(c) { return this.enabled && rk.has(c); },
    mouseDown(b) { return this.enabled && btn[b]; }, mousePressed(b) { return this.enabled && pb[b]; }, mouseReleased(b) { return this.enabled && rb[b]; },
    moveAxis() { return this.enabled ? this.axis : { x: 0, y: 0 }; },
    tap(code) { if (keys.has(code)) return; keys.add(code); pk.add(code); tapKeys.add(code); this.anyPressed = true; },
    hold(code) { if (keys.has(code)) return; keys.add(code); pk.add(code); this.anyPressed = true; },
    release(code) { if (!keys.delete(code)) return; rk.add(code); },
    click(b = 0) { if (btn[b]) return; btn[b] = true; pb[b] = true; tapBtn[b] = true; this.anyPressed = true; },
    press(b) { if (btn[b]) return; btn[b] = true; pb[b] = true; this.anyPressed = true; },
    up(b) { if (!btn[b]) return; btn[b] = false; rb[b] = true; },
    endFrame() {
      pk.clear(); rk.clear(); pb.fill(false); rb.fill(false);
      for (const c of tapKeys) { keys.delete(c); rk.add(c); }
      tapKeys.clear();
      for (let b = 0; b < 3; b++) if (tapBtn[b]) { tapBtn[b] = false; btn[b] = false; rb[b] = true; }
      this.anyPressed = false; this.wheel = 0;
    },
  };
  installActions(input, new Bindings(null)); // act / actPressed / actReleased (core/bindings.js), default bindings
  // the courtyard's colliders: the ring of pillars, the gate, the lanterns (world/courtyard.js layout)
  const colliders = new Colliders();
  const P = COURTYARD.pillarAt;
  for (let k = -3; k <= 3; k++) {
    const t = k * 5.2;
    colliders.add(t, -P, 0.62, 'stone');
    colliders.add(-P, t, 0.62, 'stone');
    colliders.add(P, t, 0.62, 'stone');
    if (Math.abs(t) > 5) colliders.add(t, P, 0.62, 'stone');
  }
  for (const s of [-1, 1]) colliders.add(s * COURTYARD.gateX, COURTYARD.gateZ, 0.7, 'stone');
  const counters = { spawns: 0 };
  const world = {
    colliders, bonfire: { ...CONFIG.world.bonfire }, nest: { x: 0, z: -3 },
    forest: { treeSpots: [], bonfire: { ...CONFIG.world.bonfire }, ash: true },
    setGrassQuality() {}, resolve: (pos, r, b) => colliders.resolve(pos, r, b),
    setPusher(slot, x, y, z, r) { if (![x, y, z, r].every(Number.isFinite)) throw new Error(`NaN pusher ${slot}`); },
    clearPushers() {}, gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); },
    scorch: { burnCircle() {}, reset() {}, heatAt: () => 0, burnAt: () => 0 },
    atmosphere: { bonfireLit: true, setBonfireLit(v) { this.bonfireLit = !!v; } }, update() {},
  };
  const mkParticles = (opts) => {
    const p = new GlyphParticles(U, opts);
    const spawn = p.spawn.bind(p);
    p.spawn = (o) => {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size']) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`NaN particle ${k}`);
      counters.spawns++;
      return spawn(o);
    };
    return p;
  };
  const game = {
    THREE, CONFIG, level: ASH, levels: LEVELS.map((L) => ({ id: L.id, name: L.name })), pickLevel() {},
    renderer: null, scene, fxScene: new THREE.Scene(), camera, pipeline: { finalMat: { uniforms: { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } } } }, U,
    events: new Events(), input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }) },
    time: 0, realTime: 0, timeScale: 1, debugTimeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
  };
  const G = { game, input, counts: {}, watch: null, hits: [], payload: new Set() };
  const emit = game.events.emit.bind(game.events);
  game.events.emit = (n, d) => {
    G.counts[n] = (G.counts[n] || 0) + 1;
    if (n.startsWith('combat:') || n.startsWith('dragon:')) for (const [k, v] of Object.entries(d ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) G.payload.add(`${n}.${k}`);
    G.watch?.(n, d);
    G.defend?.onEvent(n, d);
    emit(n, d);
  };
  game.world = world;
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  game.dragon = ASH.createBoss(game);
  game.boss = game.dragon;
  game.hud = new Hud(game);
  game.touch = new TouchControls(game);
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);
  game.applyQuality = () => {};
  const takeHit = game.player.takeHit.bind(game.player);
  game.player.takeHit = (h) => {
    const r = takeHit(h);
    G.hits.push({ t: game.time, r, attack: h?.attack, tell: h?.tell, damage: h?.damage, stop: game.hitstopTimer, flash: game.flow?.grade?.flash ?? 0 });
    return r;
  };
  game.cameraRig.snap(game.player.position);
  G.tick = (realDt) => {
    let scale = game.timeScale;
    if (game.hitstopTimer > 0) { game.hitstopTimer -= realDt; scale *= game.hitstopScale; if (game.hitstopTimer <= 0) game.hitstopScale = 1; }
    const dt = realDt * scale * (game.debugTimeScale ?? 1);
    game.realTime += realDt;
    game.time += dt;
    game.dt = dt;
    game.realDt = realDt;
    if (AUDIO.ctx) AUDIO.ctx.currentTime += realDt;
    game.touch.update(realDt);
    game.lab.update(realDt);
    game.flow.update(dt, realDt);
    game.player.update(dt);
    game.dragon.update(dt);
    game.cameraRig.update(realDt, game.player.position);
    game.lights.update(dt, game.player.position);
    game.fx.alpha.update(dt, game.time);
    game.fx.add.update(dt, game.time);
    game.hud.update(realDt);
    game.audio.update(realDt);
    game.input.endFrame();
    const p = game.player, d = game.dragon;
    if (![p.position.x, p.position.z, p.hp, p.yaw].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('disciple NaN');
    for (const h of d.hurtSpheres) if (![h.x, h.y, h.z, h.r].every(Number.isFinite)) throw new Error('hurtSphere NaN');
  };
  return G;
}

const run = (G, seconds, step = null, until = null) => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    step?.(G);
    G.tick(DT);
    if (until?.()) return true;
  }
  return false;
};

/** Title → the duel (the Lab's flow jump), the hero `dist` m in front of him, facing him. */
function duel(G, { dist = 4, ang = 0, ai = false } = {}) {
  const { game } = G;
  run(G, 0.2);
  game.flow.debug.toState('boss');
  const d = game.dragon;
  d.debug.setAI(ai);
  run(G, 0.3);
  place(G, dist, ang);
  run(G, 0.3);
}

function place(G, dist, ang = 0) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  const a = d.yaw + ang;
  p.debug.teleport(d.position.x + Math.sin(a) * dist, d.position.z + Math.cos(a) * dist);
  p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  p.debug.heal();
  game.mouseGround.set(d.position.x, 0, d.position.z);
}

/** Wait until he is back in footwork and the hero is free. */
function settle(G, max = 6) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  return run(G, max, null, () => d.mode === 'foot' && (p.state === 'idle' || p.state === 'run') && game.hitstopTimer <= 0);
}

// ---- the defender bot: answers his tells from the flash (parry normal / blue, roll through red)
function makeDefender(G, { skill = 1 } = {}) {
  const pend = [];
  const stats = { flashes: 0, parryTry: 0, dodgeTry: 0 };
  return {
    stats,
    onEvent(n, d) {
      if (n === 'combat:flash' && d?.source === 'dragon') {
        stats.flashes++;
        if (skill < 1 && Math.random() > skill) return;
        pend.push({ tell: d.tell, at: G.game.time + TUNING.flashLead, done: false });
      }
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.4) pend.splice(i, 1);
      for (const e of pend) {
        const left = e.at - t - DT;
        if (e.tell === TELL.RED) {
          if (left <= 0.1) {
            e.done = true;
            const d = g.dragon.position, p = g.player.position;
            const dx = p.x - d.x, dz = p.z - d.z, l = Math.hypot(dx, dz) || 1;
            input.axis = { x: dz / l, y: dx / l }; // roll across his blade
            input.tap('Space');
            stats.dodgeTry++;
          }
        } else if (left <= 0.12) {
          e.done = true;
          input.up(2);
          input.click(2);
          stats.parryTry++;
        }
      }
      return pend.some((e) => !e.done && e.at - t < 0.7);
    },
  };
}

/** Fence: keep ~2.6 m off him, answer every tell, cut in his openings, execute a broken one.
 *  mortal (the probe): no god mode; drinks a flask when low and free. */
function fencer(G, mortal = false) {
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  input.axis = { x: 0, y: 0 };
  if (!p.alive || game.state !== 'boss') return;
  if (!mortal) p.hp = p.maxHp; // god mode for the win run
  else if (p.hp < 70 && p.flasks > 0 && !G.defend.act() && ((game.realTime * 60) | 0) % 30 === 0) input.tap('KeyF');
  const tgt = new THREE.Vector3();
  d.lockPoint(tgt);
  game.mouseGround.set(tgt.x, 0, tgt.z);
  const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z, dist = Math.hypot(dx, dz);
  // locked blades: push (a press every few frames: a player mashing)
  if (p.state === 'lock') {
    if (((game.realTime * 60) | 0) % 5 === 0) input.click(0);
    return;
  }
  const busy = G.defend.act();
  if (dist > 2.6) input.axis = { x: dx / dist, y: -dz / dist };
  const a = d.brain.act;
  const open = d.broken || (d.mode === 'react' && ['recoil', 'stagger', 'flinch', 'executed'].includes(d.brain.react?.kind)) || (a && a.t > a.recoveryStart) || p.critTimer > 0;
  const tick = (game.realTime * 60) | 0;
  if (!busy && dist < 3.2 && (open ? tick % 20 === 0 : tick % 70 === 0)) input.click(0);
}

// ================================================================== scenario: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (registry, URL, world overrides) ==');
  assert(LEVELS.length >= 2 && DEFAULT_LEVEL.id === 'cinderwood', `levels: ${LEVELS.map((l) => l.id).join(', ')}; default cinderwood`);
  assert(levelFromSearch('?level=ash') === ASH && levelFromSearch('?lab&level=ASHFALL') === ASH && levelFromSearch('?level=disciple') === ASH, '?level=ash / ashfall / disciple pick the Ashfall level (case-insensitive)');
  assert(levelFromSearch('') === DEFAULT_LEVEL && levelFromSearch('?level=nope') === DEFAULT_LEVEL && levelFromSearch(null) === DEFAULT_LEVEL, 'no / unknown level → Cinderwood');
  assert(levelUrl('ash', 'http://x/?lab') === 'http://x/?lab=&level=ash' || levelUrl('ash', 'http://x/?lab').includes('level=ash'), `levelUrl keeps ?lab and sets level (${levelUrl('ash', 'http://x/?lab')})`);
  assert(!levelUrl('cinderwood', 'http://x/?level=ash&lab').includes('level='), 'levelUrl to the default level drops the parameter');
  assert(CONFIG.world.bonfire.z === COURTYARD.bonfire.z && CONFIG.world.dragonSleep.z === -3 && CONFIG.world.bossTriggerZ < COURTYARD.gateZ, 'applyLevel merged the courtyard layout into CONFIG.world');
  for (const L of LEVELS) assert(typeof L.buildSet === 'function' && typeof L.createBoss === 'function' && L.text && typeof L.text.victory === 'string', `level ${L.id} has a set, a boss and its flow lines`);
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof AshDisciple && G.game.boss === d && d.state === 'sleeping' && d.mode === 'sleep', 'the boss slot holds the Ash Disciple, kneeling');
  assert(Math.hypot(d.position.x - CONFIG.world.dragonSleep.x, d.position.z - CONFIG.world.dragonSleep.z) < 1e-6, 'he kneels at the level\'s resting spot');
  let bad = 0;
  d.object3d.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  assert(bad === 0, `his gear has no NaN vertices (${bad})`);
  assert(d.batch.meshes.length > 0 && d.batch.meshes.length < 24, `he draws through rigid batches (${d.batch.meshes.length} meshes)`);
  const labLevel = ui.find?.((e) => e.textContent === 'LEVEL') ?? null;
  assert(G.game.lab && typeof G.game.pickLevel === 'function', 'the Lab and the title get the level list and pickLevel');
  return G;
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules, every phase, both ends of every random roll) ==');
  const G = build();
  let checked = 0;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const phase of [1, 2]) {
      if (def.phase > phase) continue;
      for (const r of [0, 0.999]) {
        const A = realise(name, phase, () => r);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${phase} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        const first = real[0];
        if (!(first && first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6)) assert(false, `${tag}: first real windup ${first ? (first.impact - first.tellAt).toFixed(2) : '-'} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(2)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.flash > b.tellAt)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        if (!A.beats.every((b) => b.feint ? !b.def.tell : true)) assert(false, `${tag}: feints carry no tell`);
        if (!(A.end > A.recoveryStart && A.clip.dur === A.end)) assert(false, `${tag}: clip spans the move`);
        for (const tr of A.clip.tracks) for (const v of tr.V) for (const x of [].concat(v)) if (!Number.isFinite(x)) assert(false, `${tag}: NaN key in ${tr.f}`);
        for (const b of real) if (!b.def.release && !b.def.zone) assert(false, `${tag}: hit ${b.hit} has a zone`);
        checked++;
      }
    }
  }
  assert(checked > 40, `every move realised in every phase it runs, both ends of its rolls (${checked}); the rules held where no FAIL is printed above`);
  assert(MOVES.hesitate.beats[0].feint && MOVES.hesitate.beats[1].hold, 'the Hesitating Blade opens with a feint and baits with a hold');
  for (const [k, c] of Object.entries(CLIP)) if (!(c.dur > 0 && c.tracks.length)) assert(false, `reaction clip ${k} compiles`);
  // feints never flash: run the Hesitating Blade and count its flashes against its real hits
  duel(G, { dist: 4 });
  const flashes = [];
  G.watch = (n, d) => { if (n === 'combat:flash' && d?.attack === 'hesitate') flashes.push(G.game.time); };
  const d = G.game.dragon;
  d.debug.trigger('hesitate');
  const realHits = d.brain.act.hits;
  run(G, 4, null, () => d.mode === 'foot');
  G.watch = null;
  assert(flashes.length === realHits, `Hesitating Blade: ${flashes.length} flashes for ${realHits} real hits (the feint never glints)`);
  return G;
}

// ================================================================== scenario: timing
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from the middle of its AI band: contact vs flash + lead) ==');
  const G = build();
  duel(G, { dist: 4 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  let worst = 0, firstMiss = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition || def.counter) continue;
    if (def.phase > d.phase) {
      d.debug.phase2();
      run(G, 3.5, null, () => d.mode === 'foot');
    }
    settle(G);
    d.yaw = 0;
    const mid = (def.band[0] + Math.min(def.band[1], 9)) / 2;
    d.position.set(0, 0, -2);
    place(G, mid);
    run(G, 0.1);
    const flashes = [], contacts = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === name) flashes.push(game.time); };
    const h0 = G.hits.length;
    const ok = d.debug.trigger(name);
    run(G, 9, (GG) => { GG.game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode === 'foot' && !d.fx.crescentsAlive);
    G.watch = null;
    for (const h of G.hits.slice(h0)) if (h.attack === name) contacts.push(h.t);
    // each contact against the nearest flash before it
    const errs = contacts.map((t) => {
      const f = flashes.filter((x) => x <= t + 1e-6).pop();
      return f === undefined ? Infinity : t - (f + TUNING.flashLead);
    });
    const w = errs.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
    worst = Math.max(worst, w);
    if (!contacts.length) firstMiss.push(name);
    out(`     ${name.padEnd(12)} from ${mid.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${Number.isFinite(w) ? (w * 1000).toFixed(0) : '∞'} ms`);
    assert(ok && w <= 0.085, `${name}: every contact within ±85 ms of its flash + ${TUNING.flashLead} s (worst ${Number.isFinite(w) ? (w * 1000).toFixed(0) : '∞'} ms)`);
  }
  assert(!firstMiss.length, `every move lands from the middle of its band ${JSON.stringify(firstMiss)}`);
  return G;
}

// ================================================================== scenario: guard
async function scenarioGuard() {
  out('\n== scenario GUARD (front strikes guarded, the back open, counters, the crush) ==');
  const G = build();
  duel(G, { dist: 1.8 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  run(G, 0.5);
  const hp0 = d.hp, post0 = d.posture;
  const c0 = G.counts['dragon:guard'] ?? 0;
  // a light swing into his front while he stands guard
  input.click(0);
  run(G, 0.7);
  assert((G.counts['dragon:guard'] ?? 0) > c0 && d.hp === hp0 && d.posture > post0, `a light swing into his guard: dragon:guard, no damage (hp ${d.hp}), posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)}`);
  // the same from behind lands
  settle(G);
  place(G, 1.6, Math.PI);
  run(G, 0.05);
  d.yaw = Math.atan2(-(p.position.x - d.position.x), -(p.position.z - d.position.z)); // facing away
  const hp1 = d.hp;
  input.click(0);
  // (his back stays turned through the swing: in footwork he faces the hero again within ~0.2 s, and
  // a light now lands 0.25-0.34 s after the click. The rule under test is the guard's, not his turn)
  run(G, 0.6, () => { d.yaw = Math.atan2(-(p.position.x - d.position.x), -(p.position.z - d.position.z)); });
  assert(d.hp < hp1, `a swing at his back lands (hp ${hp1} → ${d.hp})`);
  // counters: guarded strikes in a row raise the chance to 100 % by the 4th
  settle(G);
  place(G, 1.8);
  d.debug.setAI(true); // counters are the AI's (it is held from starting a move of its own: gapT)
  d.brain.gapT = 99;
  d.brain.raiseT = 0;
  let countered = false;
  for (let i = 0; i < 4 && !countered; i++) {
    d.takeHit({ damage: 30, part: 'body', heavy: false, poise: 5, point: { x: d.position.x, y: 1.2, z: d.position.z } });
    // (he beats the strike away, the deflect, and the Riposte comes straight out of it)
    countered = d.brain.react?.kind === 'deflect' || d.brain.act?.name === 'riposte';
    run(G, 0.05);
  }
  run(G, 0.6, null, () => d.brain.act?.name === 'riposte');
  assert(countered && d.brain.act?.name === 'riposte', `strikes into his guard bring the Riposte (counter chance ${TUNING.guard.counterChance.join(' / ')})`);
  d.debug.setAI(false);
  run(G, 3, null, () => d.mode === 'foot');
  // the crush: a heavy strike with a full thrust's posture
  settle(G);
  place(G, 1.8);
  d.brain.raiseT = 0;
  const hp2 = d.hp;
  const slam = d.takeHit({ damage: 58, part: 'body', heavy: true, poise: 40, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(slam === 0 && d.hp === hp2, 'the chain\'s slam (posture 40) is turned aside like any strike');
  settle(G);
  d.brain.raiseT = 0;
  const r = d.takeHit({ damage: 110, part: 'body', heavy: true, poise: 50, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(r > 0 && d.hp < hp2 && d.brain.react?.kind === 'stagger', `a full-charge thrust (posture 50) crushes his guard: it lands (${r}) and he staggers`);
  // the real thrust: hold LMB to full charge and release into his guard
  settle(G);
  place(G, 2.6);
  run(G, 0.3);
  d.brain.raiseT = 0;
  const hp3 = d.hp;
  input.press(0);
  run(G, 1.4);
  input.up(0);
  run(G, 0.6);
  assert(d.hp < hp3, `the hero's own full thrust breaks through the guard (hp ${hp3} → ${d.hp})`);
  return G;
}

// ================================================================== scenario: clash
// (2026-11-14) Steel on steel: his guard read from him (raised as the hero swings, a ward on the
// strike's side, the deflect that throws the hero's blade back and brings the Riposte), the hero's
// cancels (a guard or a dodge out of any point of a swing), the blades meeting in a parry, the lock.
async function scenarioClash() {
  out('\n== scenario CLASH (the guard read from him, the deflect and the bounce, cancels, blades that meet) ==');
  const G = build();
  duel(G, { dist: 1.9 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  run(G, 0.5);
  const rise = () => d._tip.y - d._hilt.y; // how far the point stands over the grip
  const en = rise();
  // (1) the guard comes up as the hero swings, before the strike lands
  let upAt = -1, guardAt = -1, riseUp = 0;
  const c0 = G.counts['dragon:guard'] ?? 0;
  input.click(0);
  const t0 = game.time;
  run(G, 0.6, () => {
    if (upAt < 0 && d.brain.wardK > 0.6) { upAt = game.time - t0; riseUp = rise(); }
    if (guardAt < 0 && (G.counts['dragon:guard'] ?? 0) > c0) guardAt = game.time - t0;
  }, () => guardAt >= 0);
  assert(upAt >= 0 && guardAt > upAt, `his guard is up ${upAt.toFixed(2)} s into the hero's swing, before the strike is on it (${guardAt.toFixed(2)} s)`);
  assert(riseUp > en + 0.3, `the raised guard is a different picture from his stance: the point stands ${riseUp.toFixed(2)} m over the grip (en garde ${en.toFixed(2)} m)`);
  assert(['ward', 'wardR', 'wardHigh'].includes(d.brain.react?.kind) && d.mode === 'react', `the strike is met by a ward (${d.brain.react?.kind})`);
  assert(p.state === 'attack', `a held strike does not stop the hero's chain (${p.state})`);
  // the ward's contact pose is on screen in the freeze: his blade stands up in the frame of the hit
  assert(rise() > en + 0.3 && game.hitstopTimer > 0, `the ward's contact pose is the frozen frame (point ${rise().toFixed(2)} m up, freeze ${game.hitstopTimer.toFixed(3)} s)`);
  settle(G);
  // (2) the deflect: his guard beats the strike away, the hero bounces, the Riposte follows; a guard cancels the bounce
  home(G);
  place(G, 1.9);
  run(G, 0.3);
  d.debug.setAI(true);
  d.brain.gapT = 99;
  d.brain.counter.n = 3; // (the 4th guarded strike in a row: he deflects for certain)
  d.brain.counter.t = d.time;
  const seen = [];
  G.watch = (n, e) => { if (n === 'dragon:guard') seen.push(e?.deflect ? 'deflect' : 'ward'); if (n === 'player:bounced') seen.push('bounced'); if (n === 'dragon:windup') seen.push(e?.name); };
  input.click(0);
  run(G, 0.7, () => { d.brain.gapT = 99; }, () => p.state === 'bounce');
  assert(seen.includes('deflect') && seen.includes('bounced') && p.state === 'bounce', `his guard deflects the strike and the hero's blade is thrown back (${seen.join(', ')}; hero ${p.state})`);
  assert(d.brain.react?.kind === 'deflect', `he beats it away (${d.brain.react?.kind})`);
  // an attack does not come out of the bounce at once; a guard does
  input.click(0);
  run(G, 0.05);
  assert(p.state === 'bounce', `an attack press does not cancel the bounce (${p.state})`);
  input.press(2);
  run(G, 0.04);
  assert(p.state === 'block', `a guard press cancels the bounce at once (${p.state})`);
  const h0 = G.hits.length;
  run(G, 1.6, () => { d.brain.gapT = 99; }, () => G.hits.length > h0);
  assert(seen.includes('riposte'), `the Riposte comes out of the deflect (${seen.join(', ')})`);
  assert(G.hits.length > h0 && G.hits[h0].r !== RESULT.HIT, `the guard raised out of the bounce answers its first cut (${G.hits[h0]?.r})`);
  input.up(2);
  G.watch = null;
  d.debug.setAI(false);
  settle(G, 8);
  // (3) the hero's cancels: a dodge out of a windup and out of the cut itself, a guard out of the cut
  home(G);
  place(G, 6);
  run(G, 0.3);
  input.click(0);
  run(G, 0.05);
  const w = p.atk?.t ?? -1, W = p.atk?.def?.windup ?? 0;
  input.tap('Space');
  run(G, 0.04);
  assert(w >= 0 && w < W && p.state === 'roll', `a dodge cancels a swing in its windup (${w.toFixed(2)} of ${W} s → ${p.state})`);
  settle(G);
  input.click(0);
  run(G, 0.4, null, () => p.state === 'attack' && p.atk && p.atk.t >= p.atk.def.windup + 0.02);
  const inCut = p.state === 'attack' && p.atk.t >= p.atk.def.windup && p.atk.t < p.atk.def.windup + p.atk.def.active;
  input.tap('Space');
  run(G, 0.04);
  assert(inCut && p.state === 'roll', `... and in the cut itself (${p.state})`);
  settle(G);
  input.click(0);
  run(G, 0.4, null, () => p.state === 'attack' && p.atk && p.atk.t >= p.atk.def.windup + 0.02);
  const inCut2 = p.state === 'attack' && p.atk.t >= p.atk.def.windup && p.atk.t < p.atk.def.windup + p.atk.def.active;
  input.press(2);
  run(G, 0.04);
  assert(inCut2 && p.state === 'block', `a guard cancels the cut itself (${p.state})`);
  input.up(2);
  settle(G);
  // (4) the blades meet: every blow of two strings parried, the hero's blade lies on his
  const gaps = [], backs = [], stops = [];
  for (const mv of ['swallow', 'ashRain']) {
    home(G);
    place(G, 2.2);
    run(G, 0.3);
    G.watch = (n) => { if (n === 'player:parry') { gaps.push(p.deflect.gap); backs.push(d.brain.back.off); stops.push(game.hitstopTimer); } };
    G.defend = makeDefender(G);
    d.brain.trigger(mv);
    run(G, 5, (GG) => { GG.game.mouseGround.set(d.position.x, 0, d.position.z); GG.defend.act(); }, () => d.mode !== 'act');
    G.defend = null;
    G.watch = null;
    settle(G, 8);
  }
  const met = gaps.filter((g) => g <= 0.2).length;
  assert(gaps.length === 10 && met >= 7, `the blades meet: ${met} of ${gaps.length} parried blows end with the two blades within 0.2 m (${gaps.map((g) => g.toFixed(2)).join(', ')})`);
  assert(backs.filter((b) => b > 0).length >= 6, `his blade is held where it met the guard, not through the hero (stepped back on ${backs.filter((b) => b > 0).length} of ${backs.length} blows)`);
  // (a string's blows freeze the frame briefly; its last, the one that recoils him, for longer)
  assert(Math.max(...stops.slice(0, 2)) <= 0.08 && stops[2] >= 0.1, `the freeze is short inside a string and long on its last blow (${stops.slice(0, 3).map((x) => x.toFixed(3)).join(', ')} s)`);
  // (5) his recovery: open at first, then he breaks it off into his guard
  home(G);
  place(G, 2.2);
  run(G, 0.3);
  d.brain.trigger('fallingAsh');
  run(G, 3, null, () => d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart + 0.02);
  const A = d.brain.act, hpA = d.hp;
  const early = d.takeHit({ damage: 30, part: 'body', heavy: false, poise: 5, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(!!A && early > 0 && d.hp < hpA, `a strike early in his recovery lands (${early})`);
  settle(G, 8);
  home(G);
  place(G, 2.2);
  run(G, 0.3);
  d.brain.trigger('fallingAsh');
  run(G, 3, null, () => d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart + (d.brain.act.end - d.brain.act.recoveryStart) * (TUNING.guard.recoverOpen + 0.1));
  const hpB = d.hp, wasAct = d.mode === 'act';
  const late = d.takeHit({ damage: 30, part: 'body', heavy: false, poise: 5, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(wasAct && late === 0 && d.hp === hpB && d.mode === 'react' && ['ward', 'wardR', 'wardHigh'].includes(d.brain.react?.kind), `late in it he breaks the recovery off into his guard (${late} damage; ${d.brain.react?.kind})`);
  settle(G, 8);
  // (6) the blade lock: the two close to the lock's distance and the blades cross
  home(G);
  place(G, 2.2);
  run(G, 0.3);
  answerMove(G, 'fallingAsh', (left) => {
    if (left > 0.05) return false;
    input.up(2);
    input.click(2);
    return true;
  }, 2);
  const locked = p.state === 'lock';
  let n = 0, far = 0;
  run(G, 0.7, () => { if (n++ % 8 === 0) input.click(0); });
  const dist = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
  far = p.deflect.gap;
  assert(locked && p.state === 'lock' && Math.abs(dist - 1.3) < 0.25 && far < 0.2, `blades locked: the two stand ${dist.toFixed(2)} m apart and the blades cross (${far.toFixed(2)} m between them)`);
  run(G, 4, () => { if (n++ % 4 === 0) input.click(0); }, () => p.state !== 'lock');
  settle(G, 8);
  return G;
}

// ================================================================== scenario: trade
// (2026-11-14, ADR-082) The trade clash: the hero's cut and his blow at the same moment. Neither lands.
async function scenarioTrade() {
  out('\n== scenario TRADE (two cuts at the same moment meet: neither lands) ==');
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.4);
  const blow = (o = {}) => p.takeHit({ damage: 20, knockback: 1, tell: TELL.NORMAL, steel: true, last: true, attacker: d, from: { x: d.position.x, z: d.position.z }, attack: 'test', ...o });
  /** Start a light and run to move time `at` of it (s). */
  const cutTo = (at) => {
    settle(G);
    home(G);
    place(G, 6); // (out of his reach: the cut is in the air, it meets nothing of its own)
    run(G, 0.3);
    input.click(0);
    run(G, 0.6, null, () => p.state === 'attack' && p.atk && !p.atk.pending && p.atk.t >= at);
    return p.atk;
  };
  // (1) the rule, on the hero: a blade's blow that arrives in his cut meets it
  let a = cutTo(0.15);
  let seen = [];
  G.watch = (n, e) => { if (n === 'combat:clash') seen.push(e); };
  const hp0 = p.hp;
  let r = blow();
  assert(a && r === RESULT.CLASHED && p.hp === hp0 && p.state === 'bounce' && seen.length === 1, `a blow in the hero's cut (${a?.t.toFixed(2)} s into a ${a?.def.windup} + ${a?.def.active} s swing): ${r}, no damage, his blade thrown back (${p.state}), combat:clash`);
  assert(game.hitstopTimer >= 0.1, `the frame freezes on it (${game.hitstopTimer.toFixed(3)} s)`);
  // in the windup, in the recovery, from a red blow, from behind: no trade
  a = cutTo(0.03);
  r = blow();
  assert(r === RESULT.HIT, `a blow in his windup (${a?.t.toFixed(2)} s) just lands (${r})`);
  a = cutTo(0.3);
  r = blow();
  assert(r === RESULT.HIT, `... and in his recovery (${a?.t.toFixed(2)} s: ${r})`);
  a = cutTo(0.15);
  r = blow({ tell: TELL.RED });
  assert(r === RESULT.HIT, `a red blow is not met (${r})`);
  a = cutTo(0.15);
  r = blow({ steel: false });
  assert(r === RESULT.HIT, `nor a blow that is not a blade's (${r})`);
  a = cutTo(0.15);
  r = blow({ from: { x: p.position.x - Math.sin(p.yaw) * 2, z: p.position.z - Math.cos(p.yaw) * 2 }, attacker: { position: { x: p.position.x - Math.sin(p.yaw) * 2, z: p.position.z - Math.cos(p.yaw) * 2 } } });
  assert(r === RESULT.HIT, `nor one from behind him (${r})`);
  G.watch = null;
  p.debug.heal();
  // (2) in the duel: a cut timed into the first blow of a string
  const tradeInto = (mv, lead, after = null) => {
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    p.debug.heal();
    const ev = [];
    G.watch = (n, e) => { if (n === 'combat:clash') ev.push('clash'); if (n === 'player:hurt') ev.push('hurt'); if (n === 'dragon:hurt') ev.push('cut'); if (n === 'player:parry') ev.push('parry'); };
    d.brain.trigger(mv);
    let clicked = false;
    run(G, 4, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      const A = d.brain.act, b = A?.beats.find((x) => !x.feint);
      if (!clicked && b && b.impact - A.t <= lead) { clicked = true; input.click(0); }
      after?.(ev);
    }, () => d.mode !== 'act' || ev.includes('clash'));
    return ev;
  };
  const post0 = d.posture, hpH = p.hp, hpD = d.hp;
  let ev = tradeInto('swallow', 0.19);
  const striking = d.brain.act?.name;
  assert(ev.includes('clash') && !ev.includes('hurt') && !ev.includes('cut') && p.hp === hpH && d.hp === hpD, `a cut timed into the first blow of Swallow Flicks: the blades clash, neither is hurt (${ev.join(', ')})`);
  assert(Math.abs(d.posture - post0 - TUNING.posture.guard.light * TUNING.trade.posture) < 0.5, `it wears his posture by ${TUNING.posture.guard.light * TUNING.trade.posture} (${post0.toFixed(0)} → ${d.posture.toFixed(0)})`);
  assert(d.mode === 'act' && striking === 'swallow' && p.state === 'bounce', `the string goes on and the hero's blade is thrown back (${d.mode} ${striking}; hero ${p.state})`);
  // mashing attack does not trade the next blow: the bounce holds the blade
  const h0 = G.hits.length;
  G.watch = null;
  run(G, 1.2, () => { game.mouseGround.set(d.position.x, 0, d.position.z); if (((game.realTime * 60) | 0) % 6 === 0) input.click(0); }, () => G.hits.length > h0);
  assert(G.hits.length > h0 && G.hits[h0].r === RESULT.HIT, `mashing attack does not trade the blow that follows: it lands (${G.hits[h0]?.r})`);
  // ... a guard press out of the bounce does answer it
  ev = tradeInto('swallow', 0.19);
  const h1 = G.hits.length;
  let pressed = false;
  G.watch = (n) => { if (n === 'combat:flash' && !pressed) pressed = 'due'; };
  let due = -1;
  run(G, 1.2, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (pressed === 'due') { pressed = true; due = game.time + TUNING.flashLead - 0.12; }
    if (due > 0 && game.time >= due) { due = -1; input.up(2); input.click(2); }
  }, () => G.hits.length > h1);
  G.watch = null;
  assert(ev.includes('clash') && G.hits.length > h1 && G.hits[h1].r === RESULT.PARRIED, `a guard press out of the bounce parries the blow that follows (${G.hits[h1]?.r})`);
  // (3) a single strike traded ends in the short 'clash' reaction: no punish window
  ev = tradeInto('plumThrust', 0.19);
  assert(ev.includes('clash') && d.mode === 'react' && d.brain.react?.kind === 'clash' && d.state === 'combat', `a single strike traded: he is thrown back into his guard, not opened (${d.brain.react?.kind}, state ${d.state})`);
  // (4) a cut that lands well before his blow is a plain trade of blows, as before
  ev = tradeInto('fallingAsh', 0.42);
  run(G, 1.5, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode !== 'act');
  assert(!ev.includes('clash') && ev.includes('cut'), `a cut that lands 0.2 s before his blow is not a clash: it bites (${ev.join(', ')})`);
  G.watch = null;
  // (5) a full cleave is not thrown back: it beats his blow aside
  settle(G, 8);
  home(G);
  place(G, 6);
  run(G, 0.3);
  p.debug.heal();
  input.press(0);
  run(G, 1.4);
  input.up(0);
  run(G, 0.6, null, () => p.state === 'heavy' && p.atk && p.atk.t >= p.atk.def.windup + 0.02);
  const inDash = p.state === 'heavy' && p.atk.poise >= TUNING.guard.crushPoise;
  let crushEv = null;
  G.watch = (n, e) => { if (n === 'combat:clash') crushEv = e; };
  r = blow();
  G.watch = null;
  assert(inDash && r === RESULT.CLASHED && crushEv?.crush === true && p.state === 'heavy', `a full cleave (posture ${p.atk?.poise ?? '?'}) beats his blow aside and carries on (${r}, crush ${crushEv?.crush}, hero ${p.state})`);
  settle(G, 8);
  home(G);
  place(G, 2.2);
  run(G, 0.3);
  d.brain.trigger('fallingAsh');
  run(G, 0.3);
  d.onClashed({ tell: TELL.BLUE, heavy: true, crush: true });
  assert(d.brain.react?.kind === 'stagger', `... and staggers him (${d.brain.react?.kind})`);
  settle(G, 8);
  return G;
}

// ================================================================== scenario: deflect
async function scenarioDeflect() {
  out('\n== scenario DEFLECT (a string parried hit by hit, the last recoils him) ==');
  const G = build();
  duel(G, { dist: 3 });
  const { game } = G;
  const d = game.dragon;
  G.defend = makeDefender(G);
  const parried = [], chain = [];
  G.watch = (n, e) => {
    if (n === 'dragon:parried' && e?.attack === 'swallow') parried.push([e.hit, e.last]);
    if (n === 'combat:deflectChain') chain.push(e.count);
  };
  const post0 = d.posture;
  d.debug.trigger('swallow');
  let sawRecoil = false;
  run(G, 4, (GG) => { GG.game.mouseGround.set(d.position.x, 0, d.position.z); GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); if (d.brain.react?.kind === 'recoil') sawRecoil = true; }, () => sawRecoil && d.mode === 'foot');
  G.watch = null;
  G.defend = null;
  assert(JSON.stringify(parried) === '[[0,false],[1,false],[2,true]]', `Swallow Flicks parried hit by hit: dragon:parried ${JSON.stringify(parried)}`);
  assert(chain.join() === '2,3', `the deflect chain counts up (${chain.join(',')})`);
  assert(sawRecoil, 'parrying the last hit recoils him (the punish window)');
  assert(d.posture >= post0 + POSTURE.parry.normal * 2 + POSTURE.parry.blue - 1 || d.broken, `three parries fill his posture (${post0.toFixed(0)} → ${d.posture.toFixed(0)})`);
  return G;
}

// ================================================================== scenario: ghostep
async function scenarioGhostep() {
  out('\n== scenario GHOSTEP (a perfect dodge blinks behind him: no plunge, his back open) ==');
  const G = build();
  duel(G, { dist: 5 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  let flashT = null;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'plumThrust') flashT = game.time; };
  d.debug.trigger('plumThrust');
  let rolled = false;
  run(G, 2, () => {
    input.axis = { x: 0, y: 0 };
    if (flashT !== null && !rolled && game.time >= flashT + TUNING.flashLead - 0.1) {
      rolled = true;
      input.axis = { x: 1, y: 0 };
      input.tap('Space');
    }
  }, () => (G.counts['player:ghostep'] ?? 0) > 0);
  G.watch = null;
  const behind = -((p.position.x - d.position.x) * Math.sin(d.yaw) + (p.position.z - d.position.z) * Math.cos(d.yaw));
  assert((G.counts['player:ghostep'] ?? 0) === 1 && p.state !== 'plunge', 'a perfect dodge of his thrust is the Ghostep (he offers no plunge)');
  assert(Math.abs(behind - TUNING.ghostepBehind) < 0.5 && p.critTimer > 0, `the hero reappears ${behind.toFixed(2)} m behind him (his ghostepBehind ${TUNING.ghostepBehind}: within sword reach) with the crit window`);
  // the back is open: his guard never covers it
  run(G, 0.2);
  d.brain.raiseT = 0;
  const hp0 = d.hp;
  const back0 = -((p.position.x - d.position.x) * Math.sin(d.yaw) + (p.position.z - d.position.z) * Math.cos(d.yaw));
  const trace = [];
  input.click(0);
  // (the Ghostep's slow motion is still running: 0.9 s of real time is ~0.35 s of the swing's own)
  run(G, 0.9, () => trace.push(`${p.state}${p.atk?.hit ? '!' : ''}`));
  if (process.env.ABYSS_TRACE) out('     trace', back0.toFixed(2), d.mode, d.brain.act?.name ?? '-', trace.filter((s, i, a) => s !== a[i - 1]).join(' '));
  assert(d.hp < hp0, `a cut at his back after the Ghostep lands (hp ${hp0} → ${d.hp}; ${back0.toFixed(2)} m behind him, ${d.mode})`);
  return G;
}

// ================================================================== scenario: execute
async function scenarioExecute() {
  out('\n== scenario EXECUTE (posture break → the execution thrust → he rises) ==');
  const G = build();
  duel(G, { dist: 2.4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  d.addPosture(d.maxPosture);
  assert(d.broken && d.mode === 'broken' && d.state === 'staggered', 'a full posture meter breaks him (on one knee, state staggered)');
  const hp0 = d.hp;
  let exec = 0;
  G.watch = (n, e) => { if (n === 'player:plungeHit' && e?.execution) exec++; };
  run(G, 0.2);
  input.click(0);
  run(G, 0.8);
  G.watch = null;
  assert(exec === 1 && hp0 - d.hp === DEFENSE.plunge.execDamage, `an attack within ${TUNING.execRange} m executes him: ${hp0 - d.hp} damage (EXECUTION call-out)`);
  assert(!d.broken && d.posture === 0 && d.brain.react?.kind === 'executed', 'the break is spent; he plays the executed reaction');
  run(G, 2.5, null, () => d.mode === 'foot');
  assert(d.mode === 'foot', 'he rises back into his guard');
  // out of range: no execution
  d.addPosture(d.maxPosture);
  place(G, 6);
  const hp1 = d.hp;
  input.click(0);
  run(G, 0.6);
  assert(d.hp === hp1, 'no execution from 6 m away');
  return G;
}

// ================================================================== scenario: phase
async function scenarioPhase() {
  out('\n== scenario PHASE (the 50 % gate, the kindling, phase-2 moves) ==');
  const G = build();
  duel(G, { dist: 4, ai: true });
  const { game } = G;
  const d = game.dragon;
  const gate = d.maxHp * TUNING.phaseAt[1];
  d.hp = gate + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  assert(d.hp === gate && d.brain.pendingPhase === 2, `damage stops at the gate (${d.hp} = ${gate}) until the transition`);
  let p2 = 0;
  G.watch = (n) => { if (n === 'dragon:phase2') p2++; };
  run(G, 1, null, () => d.brain.act?.name === 'kindle');
  assert(d.brain.act?.name === 'kindle' && d.phase === 2 && p2 === 1, 'the kindling starts: phase 2, dragon:phase2 (banner, music)');
  run(G, 4, null, () => d.mode === 'foot');
  G.watch = null;
  assert(d.kindle > 0.2, 'the blade is kindled');
  const picks = new Set();
  for (let i = 0; i < 200; i++) {
    d.brain.cooldowns = {};
    d.brain.last = [null, null];
    const n = d.brain._choose(3);
    if (n) picks.add(n);
  }
  assert(picks.has('needles') && picks.has('emberWhirl'), `phase-2 moves join the pool at 3 m (${[...picks].join(', ')})`);
  assert(game.flow._text('phase2') === 'THE ASH KINDLES', 'the flow shows the level\'s phase-2 banner');
  return G;
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the gate → intro → duel → death → victory) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.6);
  input.tap('KeyW');
  run(G, 0.2);
  assert(game.state === 'explore', `the title dismissed into explore (${game.state})`);
  let area = null;
  // he kneels until the hero walks through the gate
  p.debug.teleport(0, COURTYARD.gateZ + 2);
  run(G, 0.5);
  assert(d.mode === 'sleep' && game.state === 'explore', 'still kneeling while the hero stands outside the gate');
  p.debug.teleport(0, COURTYARD.gateZ - 1.5);
  run(G, 0.3);
  assert(game.state === 'bossIntro' && d.mode === 'intro', `through the gate: the intro (${game.state}, ${d.mode})`);
  run(G, 4, null, () => game.state === 'boss');
  assert(game.state === 'boss' && d.mode === 'foot' && (G.counts['dragon:introDone'] ?? 0) === 1, 'the salute ends in the duel (dragon:introDone → boss)');
  d.debug.kill();
  run(G, 6, null, () => game.state === 'victory');
  assert(d.state === 'dead' && game.state === 'victory', `defeated, he turns to ash: victory (${game.state})`);
  assert(game.flow._text('victory') === 'DISCIPLE DEFEATED', 'the level\'s victory banner');
  return G;
}

// ================================================================== scenario: win
async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings) ==');
  const G = build();
  const { game } = G;
  duel(G, { dist: 4, ai: true });
  G.defend = makeDefender(G);
  const d = game.dragon;
  const stats = { parries: 0, guards: 0, execs: 0, breaks: 0, hits: 0, ghosteps: 0 };
  const dmgBy = {};
  G.watch = (n, e) => {
    if (n === 'dragon:hurt') {
      const a = d.brain.act, b = a?.beats.find((x) => a.t < x.end + 1e-6);
      const foot = d.mode === 'foot' ? (d.brain.raiseT > 0 ? 'foot:raising' : !d._fromFront() ? 'foot:flank' : 'foot:guardUp?') : null;
      const k = d.mode === 'act' ? (a.t > a.recoveryStart ? 'act:recovery' : b && a.t < b.impact ? 'act:windup' : 'act:active') : d.mode === 'react' ? `react:${d.brain.react?.kind}` : foot ?? d.mode;
      dmgBy[k] = (dmgBy[k] ?? 0) + e.damage;
    }
    if (n === 'player:parry') stats.parries++;
    if (n === 'dragon:guard') stats.guards++;
    if (n === 'player:plungeHit' && e?.execution) stats.execs++;
    if (n === 'dragon:postureBreak') stats.breaks++;
    if (n === 'player:ghostep') stats.ghosteps++;
  };
  const t0 = game.time;
  const won = run(G, 360, fencer, () => d.state === 'dead' || game.state === 'victory');
  G.watch = null;
  const secs = game.time - t0;
  const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
  out(`     ${won ? 'won' : 'not won'} in ${secs.toFixed(0)} s: ${stats.parries} parries, ${stats.guards} guarded swings, ${stats.ghosteps} Ghosteps, ${stats.breaks} breaks, ${stats.execs} executions, ${taken} hits taken, ${G.defend.stats.flashes} flashes; phase ${d.phase}`);
  out(`     damage by his state: ${JSON.stringify(dmgBy)}`);
  assert(won, 'the fencing bot defeats the Ash Disciple within 6 minutes');
  assert(d.phase === 2, 'the fight went through phase 2');
  G.defend = null;
  return G;
}

// ================================================================== scenario: pressure
async function scenarioPressure() {
  out('\n== scenario PRESSURE (he never cuts at air; he runs a kiting hero down; strings stop; a flask is punished) ==');
  const G = build();
  duel(G, { dist: 3, ai: true });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  // (1) a hero who stands his ground and answers every tell: every glint is a blow that reaches him
  //     (the reds the bot rolls across leave the zone by design: only the others count)
  G.defend = makeDefender(G);
  let flashes = 0;
  const h0 = G.hits.length;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && e.tell !== TELL.RED && e.attack !== 'ashCrescent' && !e.hazard) flashes++; };
  run(G, 40, (GG) => {
    input.axis = { x: 0, y: 0 };
    game.mouseGround.set(d.position.x, 0, d.position.z);
    GG.defend.act();
  });
  G.watch = null;
  G.defend = null;
  const met = G.hits.slice(h0).filter((h) => h.attack !== 'ashCrescent' && h.tell !== TELL.RED).length;
  assert(flashes >= 25 && met >= flashes - 1, `standing his ground, every glint is a blow that reaches the hero: ${met} met of ${flashes} non-red flashes`);
  settle(G);
  // (2) a kiting hero, sprinting round the courtyard: he runs him down (his sprint beats the hero's)
  home(G);
  place(G, 6);
  run(G, 0.1);
  let minD = 99, topSpeed = 0, win = null;
  const k0 = G.hits.length;
  // his speed over 0.25 s windows of game time (a hit-stop frame's displacement / dt means nothing)
  const speedWin = () => {
    if (!win) win = { t: game.time, x: d.position.x, z: d.position.z };
    else if (game.time - win.t >= 0.25) {
      topSpeed = Math.max(topSpeed, Math.hypot(d.position.x - win.x, d.position.z - win.z) / (game.time - win.t));
      win = { t: game.time, x: d.position.x, z: d.position.z };
    }
  };
  input.hold('ShiftLeft');
  const ktrace = [];
  run(G, 9, () => {
    speedWin();
    if (process.env.ABYSS_TRACE) ktrace.push(`${d.mode === 'act' ? d.brain.act.name : d.mode === 'react' ? d.brain.react.kind : d.mode}`);
    const R = Math.hypot(p.position.x, p.position.z) || 1;
    const tx = -p.position.z / R, tz = p.position.x / R; // the tangent of a circle round the middle
    const rr = (8 - R) * 0.6; // and back toward radius 8
    const vx = tx + (p.position.x / R) * rr, vz = tz + (p.position.z / R) * rr, l = Math.hypot(vx, vz) || 1;
    input.axis = { x: vx / l, y: -vz / l };
    minD = Math.min(minD, Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z));
  });
  input.release('ShiftLeft');
  input.axis = { x: 0, y: 0 };
  const caught = G.hits.length - k0;
  if (process.env.ABYSS_TRACE) out('     kite', ktrace.filter((x, i, A) => x !== A[i - 1]).join(' '));
  // (a hero sprinting sideways at full speed beats a thrust's line now and then: seeds land 1–7 blows)
  assert(topSpeed > 7.4 && minD < 1.5 && caught >= 1, `a hero sprinting circles is run down: his top speed ${topSpeed.toFixed(1)} m/s (the hero's sprint 7.2), closest ${minD.toFixed(2)} m, ${caught} blows reached him in 9 s`);
  settle(G);
  // (3) a string whose next hit can no longer reach: it stops, and he gives chase
  home(G);
  place(G, 2.2);
  d.brain.gapT = 99;
  run(G, 0.2);
  let lastFlash = -1, firstImpact = -1;
  G.watch = (n, e) => {
    if (n === 'combat:flash' && e?.attack === 'ashRain') {
      lastFlash = game.time;
      if (firstImpact < 0) firstImpact = game.time + TUNING.flashLead;
    }
  };
  d.debug.trigger('ashRain');
  run(G, 2, null, () => firstImpact > 0 && game.time > firstImpact + 0.02);
  // the hero is suddenly far away (a long roll, a Ghostep elsewhere)
  const away = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z);
  p.debug.teleport(d.position.x + Math.sin(away) * 11, d.position.z + Math.cos(away) * 11);
  const tAway = game.time;
  topSpeed = 0;
  win = null;
  let next = null;
  run(G, 1.2, () => {
    speedWin();
    if (!next && d.mode === 'act' && d.brain.act?.name !== 'ashRain') next = { name: d.brain.act.name, dist: Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z) };
  });
  const sprint = topSpeed;
  G.watch = null;
  assert(lastFlash < tAway + 0.05 && d.brain.act?.name !== 'ashRain', `the Rain of Ashes stops when the hero is out of its reach (no flash after; he is ${d.mode}${d.brain.act ? ' ' + d.brain.act.name : ''})`);
  const reaches = next && MOVES[next.name].band[0] <= next.dist && next.dist <= MOVES[next.name].band[1];
  assert(sprint > 7.4 || reaches, `and he goes after him: ${next ? `${next.name} from ${next.dist.toFixed(1)} m (its band ${MOVES[next.name].band.join('–')})` : `a sprint at ${sprint.toFixed(1)} m/s`}`);
  settle(G);
  // (4) a hero drinking a flask from 7 m: he comes at once (a move that covers ground, or a sprint into one)
  home(G);
  place(G, 7);
  d.brain.gapT = 4;
  run(G, 0.3);
  p.hp = 60;
  input.tap('KeyF');
  let punished = null;
  const tF = game.time;
  run(G, 1.6, null, () => {
    if (d.mode === 'act' && d.brain.act && !punished) punished = { name: d.brain.act.name, t: game.time - tF };
    return !!punished;
  });
  assert(!!punished && punished.t < 1.4, `a flask drunk 7 m away is punished: ${punished ? `${punished.name} after ${punished.t.toFixed(2)} s` : 'nothing'} (his breather was 4 s)`);
  return G;
}

// ================================================================== scenario: impact
async function scenarioImpact() {
  out('\n== scenario IMPACT (hit stun both ways, the parry layered) ==');
  const G = build();
  duel(G, { dist: 2.4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const strike = (heavy = false) => d.takeHit({ damage: heavy ? 40 : 20, part: 'body', heavy, poise: heavy ? 30 : 10, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  // (1) a blow landed in his windup: a freeze and a jolt, the move goes on
  d.debug.trigger('fallingAsh');
  const A = d.brain.act;
  run(G, A.beats[0].impact - 0.12);
  game.hitstopTimer = 0;
  const r1 = strike(false);
  assert(r1 > 0 && d.brain.act === A && d.mode === 'act', `a cut that lands in his windup does not cancel it (${r1} damage, still ${d.brain.act?.name})`);
  assert(game.hitstopTimer >= TUNING.hitStun.light.stop - 1e-6 && d.jolt > 0.5, `it freezes the frame (${game.hitstopTimer.toFixed(3)} s) and jolts him (${d.jolt.toFixed(2)})`);
  settle(G);
  // (2) caught in his recovery: knocked out of it (a heavy blow staggers)
  for (const [heavy, want] of [[false, 'flinch'], [true, 'stagger']]) {
    home(G);
    place(G, 2.2);
    run(G, 0.1);
    d.debug.trigger('fallingStar');
    const B = d.brain.act;
    run(G, 3, null, () => B.t > B.recoveryStart + 0.05 || d.brain.act !== B);
    strike(heavy);
    assert(d.brain.react?.kind === want, `a ${heavy ? 'heavy' : 'light'} blow in his recovery: he ${want}s (${d.brain.react?.kind ?? d.mode})`);
    settle(G);
  }
  // (3) his blow lands on the hero: a freeze too
  home(G);
  place(G, 2.2);
  run(G, 0.2);
  const j0 = G.hits.length;
  game.hitstopTimer = 0;
  d.debug.trigger('fallingStar');
  run(G, 2, null, () => G.hits.slice(j0).some((h) => h.r === RESULT.HIT));
  const hurtStop = G.hits.slice(j0).find((h) => h.r === RESULT.HIT)?.stop ?? 0;
  assert(hurtStop >= 0.08, `a blow that lands on the hero freezes the frame (${hurtStop.toFixed(3)} s)`);
  settle(G);
  // (4) the parry, layered: a freeze, a flash; a perfect one adds its slow motion
  for (const perfect of [false, true]) {
    home(G);
    place(G, 2.2);
    run(G, 0.3);
    const seen = [];
    const q0 = G.hits.length;
    G.watch = (n, e) => { if (n === 'game:cinematic') seen.push(e?.kind); };
    answerMove(G, 'swallow', (left) => {
      if (left > (perfect ? 0.05 : 0.12)) return false;
      input.up(2);
      input.click(2);
      return true;
    }, 0.9);
    G.watch = null;
    const ph = G.hits.slice(q0).find((h) => h.r === RESULT.PARRIED);
    const stop = ph?.stop ?? 0, flash = ph?.flash ?? 0;
    // (inside a string the freeze is short and the flash a flicker: the exchange keeps its rhythm)
    if (perfect) assert(seen.includes('perfectParry') && stop >= 0.13 && flash > 0.4, `a perfect parry: freeze ${stop.toFixed(3)} s, flash ${flash.toFixed(2)}, slow motion (${seen.join(', ')})`);
    else assert(stop >= 0.045 && stop <= 0.09 && flash > 0.1 && !seen.includes('perfectParry'), `a parry inside a string: a short freeze ${stop.toFixed(3)} s, a flash ${flash.toFixed(2)}, no slow motion`);
    settle(G);
  }
  return G;
}

// ================================================================== scenario: moments
/** Force `name` and answer each of its hits: onFlash(seconds to impact, flash) every frame from
 *  the hit's flash until it returns true. Keeps any watcher already set (it still sees events). */
function answerMove(G, name, onFlash, max = 9) {
  const { game } = G, d = game.dragon;
  const due = [];
  const prev = G.watch;
  G.watch = (n, e) => {
    prev?.(n, e);
    if (n === 'combat:flash' && e?.attack === name) due.push({ at: game.time + TUNING.flashLead, e, done: false });
  };
  const ok = d.debug.trigger(name);
  run(G, max, () => {
    G.input.axis = { x: 0, y: 0 };
    game.mouseGround.set(d.position.x, 0, d.position.z);
    for (const x of due) if (!x.done) x.done = onFlash(x.at - game.time - DT, x.e) === true;
  }, () => game.player.state === 'lock' || d.mode === 'foot'); // a lock hands over to the caller at once
  G.watch = prev;
  return ok;
}

/** Him back on his mark mid-courtyard, facing the gate (+z): each moment starts from the same spot,
 *  clear of the pillars, whatever the last one left behind. */
function home(G) {
  const d = G.game.dragon, S = CONFIG.world.dragonSleep;
  d.position.set(S.x, 0, S.z);
  d.yaw = 0;
}

async function scenarioMoments() {
  out('\n== scenario MOMENTS (the blade lock, the mikiri, the full deflect, the cinematic) ==');
  const G = build();
  duel(G, { dist: 2.4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const seen = [];
  let postAtCine = 0; // his posture when the moment's cinematic starts (its posture is already added)
  const log = (n, e) => {
    if (!/player:lock|player:mikiri|dragon:deflected|game:cinematic/.test(n)) return;
    seen.push(`${n}${e?.phase ? ':' + e.phase : ''}${e?.kind ? ':' + e.kind : ''}`);
    if (n === 'game:cinematic') postAtCine = d.posture;
  };
  // ---- the blade lock: a PERFECT parry of Falling Star, then mash
  const post0 = d.posture;
  let parried = false;
  const ok1 = answerMove(G, 'fallingStar', (left) => {
    if (left > 0.05) return false; // inside the perfect window (0.08 s)
    input.up(2);
    input.click(2);
    parried = true;
    return true;
  }, 1.6);
  const wasLock = p.state === 'lock' && d.brain.react?.kind === 'lock';
  assert(ok1 && parried && wasLock, `a perfect parry of Falling Star locks the blades (hero ${p.state}, him ${d.brain.react?.kind})`);
  const w0 = G.watch;
  G.watch = log;
  let won = null;
  run(G, 3, () => { if (((game.realTime * 60) | 0) % 4 === 0) input.click(0); }, () => p.state !== 'lock');
  won = seen.includes('player:lock:won');
  assert(won && d.brain.react?.kind === 'reeling' && d.posture > post0 + TUNING.lock.posture * 0.8, `mashing wins the lock: he reels, posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)}`);
  assert(seen.includes('game:cinematic:bladeLock'), 'a won lock plays a cinematic moment');
  assert(game.flow.cine?.slowmo < 1, 'its slow motion replaces the camera push-in of the lock itself');
  G.watch = w0;
  settle(G);
  // a lock not pushed is lost: he shoves the hero and counters (his AI on, no move of his own)
  home(G);
  place(G, 2.4);
  d.debug.setAI(true);
  d.brain.gapT = 99;
  run(G, 0.2);
  answerMove(G, 'fallingStar', (left) => {
    if (left > 0.05) return false;
    input.up(2);
    input.click(2);
    return true;
  }, 1.6);
  const hp0 = p.hp;
  seen.length = 0;
  G.watch = log;
  p.debug.god = false;
  run(G, 3.5, null, () => p.state !== 'lock');
  p.debug.god = true;
  G.watch = null;
  assert(seen.includes('player:lock:lost') && p.hp < hp0, `a lock left alone is lost: he shoves the hero (hp ${hp0} → ${p.hp})`);
  run(G, 1.2, null, () => d.brain.act?.name === 'riposte');
  assert(d.brain.act?.name === 'riposte', 'he follows the shove with the Riposte');
  run(G, 3, null, () => d.mode === 'foot');
  d.debug.setAI(false);
  settle(G);
  // slow, steady presses (5 a second) never fill it but hold it: when time runs out the hero wins
  home(G);
  place(G, 2.4);
  run(G, 0.2);
  answerMove(G, 'fallingStar', (left) => {
    if (left > 0.05) return false;
    input.up(2);
    input.click(2);
    return true;
  }, 1.6);
  seen.length = 0;
  G.watch = log;
  const lockT0 = game.time;
  run(G, 4, () => { if (((game.realTime * 60) | 0) % 12 === 0) input.click(0); }, () => p.state !== 'lock');
  G.watch = null;
  assert(seen.includes('player:lock:won') && game.time - lockT0 >= TUNING.lock.dur - 0.1, `5 presses a second hold the lock to the end of its ${TUNING.lock.dur} s and win it (${(game.time - lockT0).toFixed(2)} s; ${seen.filter((s) => !s.endsWith(":push")).join(", ")}; pushes ${seen.filter((s) => s.endsWith(":push")).length})`);
  settle(G);
  // ---- the mikiri: roll INTO Piercing Ash
  home(G);
  place(G, 6);
  d.posture = 0;
  run(G, 0.2);
  seen.length = 0;
  G.watch = log;
  const post1 = d.posture;
  answerMove(G, 'piercingAsh', (left) => {
    if (left > 0.12) return false;
    const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    input.axis = { x: dx / l, y: -dz / l };
    input.tap('Space');
    return true;
  }, 3);
  G.watch = null;
  assert(seen.includes('player:mikiri') && postAtCine >= post1 + TUNING.mikiri.posture - 1, `rolling into the perilous thrust is the mikiri: posture ${post1.toFixed(0)} → ${postAtCine.toFixed(0)} (${seen.join(', ')})`);
  settle(G);
  // off his line (he turns to the hero as he comes): the roll into his blade still reads as the mikiri
  home(G);
  place(G, 6, 0.5);
  d.posture = 0;
  run(G, 0.2);
  seen.length = 0;
  G.watch = log;
  answerMove(G, 'piercingAsh', (left) => {
    if (left > 0.12) return false;
    input.axis = { x: -Math.sin(d.yaw), y: Math.cos(d.yaw) }; // against the way he faces
    input.tap('Space');
    return true;
  }, 3);
  G.watch = null;
  assert(seen.includes('player:mikiri'), `from off his line (0.5 rad) the roll against his blade is the mikiri too (${seen.join(', ')})`);
  settle(G);
  // a roll ACROSS the same thrust is no mikiri (a plain or perfect dodge)
  home(G);
  place(G, 6);
  run(G, 0.2);
  seen.length = 0;
  G.watch = log;
  answerMove(G, 'piercingAsh', (left) => {
    if (left > 0.1) return false;
    const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    input.axis = { x: dz / l, y: dx / l };
    input.tap('Space');
    return true;
  }, 3);
  G.watch = null;
  assert(!seen.includes('player:mikiri'), 'a roll across it is no mikiri');
  settle(G);
  // ---- the full deflect: parry every hit of the Rain of Ashes (7)
  home(G);
  place(G, 2.6);
  d.posture = 0;
  run(G, 0.2);
  seen.length = 0;
  G.watch = log;
  let reeled = false;
  const ok3 = answerMove(G, 'ashRain', (left) => {
    if (left > 0.12) return false;
    input.up(2);
    input.click(2);
    return true;
  }, 9);
  reeled = seen.includes('dragon:deflected') || d.brain.react?.kind === 'reeling';
  G.watch = null;
  assert(ok3 && seen.includes('dragon:deflected'), `parrying all seven hits of the Rain of Ashes is the full deflect (${seen.join(', ')}${ok3 ? '' : '; not triggered: ' + d.mode + ' ' + (d.brain.react?.kind ?? '')})`);
  assert(reeled && seen.some((s) => s.startsWith('game:cinematic')), 'he reels and the moment plays in slow motion');
  // the slow motion is the flow's own: a parry's short freeze doesn't stretch over the moment
  settle(G);
  const C = TUNING.cinematic;
  game.hitstop(0.06, 0.04);
  game.flow.cinematic({ x: d.position.x, z: d.position.z, zoom: C.zoom, weight: C.weight, slowmo: C.slowmo, dur: C.dur, kind: 'test' });
  const t0 = game.time;
  run(G, 0.3);
  const mid = game.timeScale;
  run(G, C.dur);
  const sim = game.time - t0;
  assert(Math.abs(mid - C.slowmo) < 0.01 && game.timeScale === 1, `the moment runs at ${C.slowmo}× then returns to 1× (mid ${mid.toFixed(2)}, after ${game.timeScale})`);
  assert(sim > (0.3 + C.dur) * C.slowmo && sim < (0.3 + C.dur) * 0.75, `${(0.3 + C.dur).toFixed(2)} real s of it are ${sim.toFixed(2)} s of play: slowed, not frozen`);
  assert(game.cameraRig.cine.w === 0 && game.cameraRig.cine.zoom === 0 && !game.flow.cine, 'the camera is back from the pull-in');
  return G;
}

// ================================================================== scenario: probe (opt-in)
/** A mortal fencer that reads only a share of the tells (ABYSS_SKILL, default 0.85). Not a pass /
 *  fail check: it measures how dangerous he is. node duel.mjs . probe */
async function scenarioProbe() {
  const skill = Number(process.env.ABYSS_SKILL ?? 0.85);
  out(`\n== scenario PROBE (a mortal fencer reading ${Math.round(skill * 100)} % of the tells) ==`);
  const G = build();
  const { game } = G;
  duel(G, { dist: 4, ai: true });
  G.defend = makeDefender(G, { skill });
  const d = game.dragon, p = game.player;
  const t0 = game.time;
  run(G, 360, (GG) => fencer(GG, true), () => d.state === 'dead' || !p.alive);
  const taken = G.hits.filter((h) => h.r === RESULT.HIT);
  out(`     ${d.state === 'dead' ? 'WON' : p.alive ? 'timed out' : 'DIED'} after ${(game.time - t0).toFixed(0)} s: his HP ${Math.round(d.hp)} / ${d.maxHp} (phase ${d.phase}), ${taken.length} hits taken (worst ${Math.max(0, ...taken.map((h) => h.damage)).toFixed(0)}), flasks left ${p.flasks}`);
  G.defend = null;
  return G;
}

const SCENARIOS = { probe: scenarioProbe, moments: scenarioMoments, pressure: scenarioPressure, impact: scenarioImpact, levels: scenarioLevels, data: scenarioData, timing: scenarioTiming, guard: scenarioGuard, clash: scenarioClash, trade: scenarioTrade, deflect: scenarioDeflect, ghostep: scenarioGhostep, execute: scenarioExecute, phase: scenarioPhase, flow: scenarioFlow, win: scenarioWin };
const runs = [];
const OPT_IN = new Set(['probe']); // run only when named
for (const [name, fn] of Object.entries(SCENARIOS)) if (SCEN === name || (SCEN === 'all' && !OPT_IN.has(name))) runs.push(await fn());
if (!runs.length) { out(`unknown scenario '${SCEN}' (${Object.keys(SCENARIOS).join(' | ')} | all)`); process.exit(2); }

out('');
{
  const emitted = new Set();
  for (const G of runs) Object.keys(G.counts).forEach((k) => emitted.add(k));
  const notCat = [...emitted].filter((k) => !CATALOGUE.has(k));
  assert(!notCat.length, `every event the duel emits is in the catalogue ${JSON.stringify(notCat)}`);
  const pay = new Set();
  for (const G of runs) G.payload.forEach((k) => pay.add(k));
  assert(!pay.size, `no non-finite numbers in combat / boss event payloads ${JSON.stringify([...pay])}`);
}
assert(errors.length === 0, `no console errors or warnings (${errors.length})${errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''}`);
out(fails ? `\nDUEL: ${fails} FAILED` : '\nDUEL: ALL PASSED');
process.exit(fails ? 1 : 0);
