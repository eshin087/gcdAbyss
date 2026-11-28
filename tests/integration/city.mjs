// Halcyon Plaza and Halcyon, the Last Saviour, headless (ADR-159 - ADR-161): the REAL Player, Halcyon,
// Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, FireField, CameraRig, Events)
// wired like src/main.js for `?level=city`; the world is a light mock on the real Colliders, filled by
// the level's set (world/halcyonPlaza.js), or the real set with its breakables and its ambience (the
// cars' fuses, setPhase). A bot drives the input. The harness is fox.mjs's (its build, bots, helpers).
// usage: node city.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: levels | data | timing | flight | glare | pass | car | tower | statue | grab | phase | flow | pace | win | training | looks | herolike | all
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ui, AUDIO, resetWindow } from './shim.mjs';
import { attachMarks, marksCheck } from './marks.mjs';

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
const { FireField } = await imp('src/render/fireField.js');
const { Colliders } = await imp('src/world/colliders.js');
const { TELL, RESULT, POSTURE } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createHalcyonPlaza, PLAZA, CITY } = await imp('src/world/halcyonPlaza.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
const { Halcyon } = await imp('src/entities/enemies/halcyon/halcyon.js');
const { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, realise } = await imp('src/entities/enemies/halcyon/moves.js');
const { TUNING } = await imp('src/entities/enemies/halcyon/tuning.js');
const { Hud } = await imp('src/ui/hud.js');
const { setRiposteMode, riposteMode } = await imp('src/entities/player/riposteCut.js');
const { deathblowTotal } = await imp('src/entities/player/deathblow.js');
const { Bindings, installActions } = await imp('src/core/bindings.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');

// (the tuning pass: GCD_TUNE='{"hp":3000,"posture":{"max":[1,2,3]}}' deep-merges into TUNING before
// anything is built: a setting tried without editing tuning.js; arrays are replaced whole)
if (process.env.GCD_TUNE) {
  const merge = (o, v) => { for (const [k, x] of Object.entries(v)) { if (x && typeof x === 'object' && !Array.isArray(x) && o[k] && typeof o[k] === 'object') merge(o[k], x); else o[k] = x; } };
  merge(TUNING, JSON.parse(process.env.GCD_TUNE));
}
const LVL = getLevel('city');
const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.GCD_SEED ?? 4242);
const DT = 1 / 60;
const PHASES = TUNING.phaseAt.length;
const weightIn = (def, f) => (Array.isArray(def.weight) ? def.weight[f - 1] ?? 0 : def.weight ?? 0);
/** The phases a move is used in (its weight; a counter or a hidden move: every phase; a transition: its own). */
const phasesOf = (name) => {
  const def = MOVES[name];
  if (def.transition) return [def.phase];
  if (def.counter || def.hidden) return [1, 2, 3];
  return [1, 2, 3].filter((f) => weightIn(def, f) > 0);
};

// the event catalogue (docs/ARCHITECTURE.md → "Event catalogue"): what this level emits must be in it
const CATALOGUE = (() => {
  const md = fs.readFileSync(`${ROOT}/docs/ARCHITECTURE.md`, 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Event catalogue')) ?? '';
  const names = new Set();
  for (const m of sec.matchAll(/`([a-zA-Z]+(?::[a-zA-Z0-9]+)?)[ `]/g)) names.add(m[1]);
  return names;
})();
const EMITTED = new Set();

applyLevel(LVL);
// the set's colliders, built once (the set is the world agent's: whatever it is, its circles)
const SET = (() => {
  const c = new Colliders();
  const set = createHalcyonPlaza(createSharedUniforms(), c);
  return { set, circles: c.circles.map((k) => ({ ...k })) };
})();

/** `real`: the set built anew with its breakables (world.destructibles, the scars, the ambience); without
 *  it the world is a mock on the set's colliders. */
function build(seed = SEED, real = false) {
  resetWindow();
  Math.random = mulberry32(seed);
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
    press(b) { if (btn[b]) return; btn[b] = true; pb[b] = true; this.anyPressed = true; },
    click(b = 0) { if (btn[b]) return; btn[b] = true; pb[b] = true; tapBtn[b] = true; this.anyPressed = true; },
    up(b) { if (!btn[b]) return; btn[b] = false; rb[b] = true; },
    endFrame() {
      pk.clear(); rk.clear(); pb.fill(false); rb.fill(false);
      for (const c of tapKeys) { keys.delete(c); rk.add(c); }
      tapKeys.clear();
      for (let b = 0; b < 3; b++) if (tapBtn[b]) { tapBtn[b] = false; btn[b] = false; rb[b] = true; }
      this.anyPressed = false; this.wheel = 0;
    },
  };
  installActions(input, new Bindings(null));
  const colliders = new Colliders();
  const set = real ? createHalcyonPlaza(U, colliders) : null;
  if (!set) for (const k of SET.circles) colliders.add(k.x, k.z, k.r, k.tag);
  const counters = { spawns: 0, flares: 0, burns: 0 };
  const world = {
    colliders, bonfire: { ...CONFIG.world.bonfire }, nest: { x: 0, z: 0 },
    forest: { treeSpots: [], bonfire: { ...CONFIG.world.bonfire }, ambience: { update() {}, flare() { counters.flares++; } } },
    setGrassQuality() {}, resolve: (pos, r, b) => colliders.resolve(pos, r, b),
    setPusher(slot, x, y, z, r) { if (![x, y, z, r].every(Number.isFinite)) throw new Error(`NaN pusher ${slot}`); },
    clearPushers() {}, gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); },
    scorch: { burnCircle(x, z, r) { if (![x, z, r].every(Number.isFinite)) throw new Error('NaN scorch'); counters.burns++; }, reset() {}, heatAt: () => 0, burnAt: () => 0 },
    atmosphere: { bonfireLit: true, setBonfireLit(v) { this.bonfireLit = !!v; } }, update() {},
  };
  const mkParticles = (opts) => {
    const p = new GlyphParticles(U, opts);
    const spawn = p.spawn.bind(p);
    p.spawn = (o) => {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size', 'rot', 'stretch']) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`NaN particle ${k}`);
      counters.spawns++;
      return spawn(o);
    };
    return p;
  };
  const mkFire = () => {
    const p = new FireField(U, { max: 6000 });
    const spawn = p.spawn.bind(p);
    p.spawn = (o) => {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size', 'sizeEnd', 'heat', 'heatEnd']) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`NaN fire blob ${k}`);
      counters.spawns++;
      return spawn(o);
    };
    return p;
  };
  const game = {
    THREE, CONFIG, level: LVL, levels: LEVELS.map((L) => ({ id: L.id, name: L.name })), pickLevel() {},
    renderer: null, scene, fxScene: new THREE.Scene(), camera, pipeline: { finalMat: { uniforms: { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } } } }, U,
    events: new Events(), input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }), fire: mkFire() },
    time: 0, realTime: 0, timeScale: 1, debugTimeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
    punch(m) { if (!Number.isFinite(m)) throw new Error('NaN punch'); this.cameraRig.punch(m); },
    kick(x, y, z, m) { if (!Number.isFinite(x + y + z + m)) throw new Error('NaN kick'); this.cameraRig.kick(x, y, z, m); },
  };
  const G = { game, input, counts: {}, counters, watch: null, hits: [], payload: new Set(), peakAdd: 0 };
  const emit = game.events.emit.bind(game.events);
  game.events.emit = (n, d) => {
    G.counts[n] = (G.counts[n] || 0) + 1;
    EMITTED.add(n);
    if (n.startsWith('combat:') || n.startsWith('dragon:')) for (const [k, v] of Object.entries(d ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) G.payload.add(`${n}.${k}`);
    G.watch?.(n, d);
    G.defend?.onEvent(n, d);
    emit(n, d);
  };
  game.world = world;
  if (set) {
    world.forest = set;
    world.scars = new Scars(game, set.scarInk);
    world.destructibles = new Destructibles(game, world, set);
    world.impact = (x, z, r, power, o) => world.destructibles.strike(x, z, r, power, { kind: 'blunt', by: 'world', ...(o ?? {}) });
    // (world.js's: fire lands; the grass of this mock does not burn, the wood does)
    world.ignite = (x, z, r, k = 1) => world.destructibles.ignite(x, z, r, k);
    world.restore = () => { world.destructibles.reset(); world.scars.reset(); };
    world.update = (dt) => { world.destructibles.update(dt); world.scars.update?.(dt); set.ambience?.update?.(dt, game); };
    set.ambience?.setup?.(game);
  }
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  // (his rig is built on a stream of its own: three's uuids draw Math.random, and the body agent's gear
  // must not shift the AI's seeded stream: lord.mjs's note)
  const R0 = Math.random;
  Math.random = mulberry32(seed + 0x5eed);
  game.dragon = LVL.createBoss(game);
  Math.random = R0;
  game.boss = game.dragon;
  game.hud = new Hud(game);
  game.touch = new TouchControls(game);
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);
  game.applyQuality = () => {};
  const takeHit = game.player.takeHit.bind(game.player);
  game.player.takeHit = (h) => {
    const r = takeHit(h);
    G.hits.push({ t: game.time, r, attack: h?.attack, tell: h?.tell, damage: h?.damage, kind: h?.kind, around: !!h?.around });
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
    game.world.update(dt);
    game.cameraRig.update(realDt, game.player.position);
    game.lights.update(dt, game.player.position);
    game.fx.alpha.update(dt, game.time);
    game.fx.add.update(dt, game.time);
    game.fx.fire.update(dt);
    G.peakAdd = Math.max(G.peakAdd, game.fx.add.count);
    game.hud.update(realDt);
    game.audio.update(realDt);
    game.input.endFrame();
    const p = game.player, d = game.dragon;
    if (![p.position.x, p.position.z, p.hp, p.yaw].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('halcyon NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('halcyon blade NaN');
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

/** Title → the duel (the Lab's flow jump), in phase `form` (through its real transitions), the hero
 *  `dist` m in front of him, facing him. */
function duel(G, { dist = 4, ang = 0, ai = false, form = 1 } = {}) {
  const { game } = G;
  run(G, 0.2);
  game.flow.debug.toState('boss');
  const d = game.dragon;
  d.debug.setAI(ai);
  for (let n = 2; n <= form; n++) {
    d.brain.forcePhase(n);
    run(G, 5, null, () => d.phase === n && d.mode !== 'act');
  }
  d.debug.tidy();
  d.position.set(0, d.T.fly.hover, -2);
  d.yaw = 0;
  run(G, 0.4);
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

const settle = (G, max = 8) => run(G, max, null, () => G.game.dragon.mode === 'foot' && ['idle', 'run'].includes(G.game.player.state) && G.game.hitstopTimer <= 0);
const quiet = (d) => d.mode === 'foot' && !d.glare.busy && !d.terrain.busy && !d.flight.cr.on && !d.flight.carry.on;

// ---- the defender bot: answers his tells from the flash (parry normal / blue, roll through red)
function makeDefender(G, { skill = 1, early = 0.12, style = 'mixed', rng = null, world = false } = {}) {
  const pend = [];
  const stats = { flashes: 0, parryTry: 0, dodgeTry: 0, skipped: [] };
  return {
    stats,
    onEvent(n, d) {
      if (n === 'combat:flash' && (d?.source === 'dragon' || (world && d?.source === 'world'))) {
        stats.flashes++;
        if (skill < 1 && (rng ?? Math.random)() > skill) { stats.skipped?.push([G.game.time, d.attack]); return; }
        pend.push({ tell: d.tell, at: G.game.time + (d.source === 'world' ? 0.3 : TUNING.flashLead), x: d.x, z: d.z, hazard: !!d.hazard && !d.bullet, done: false });
      }
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.4) pend.splice(i, 1);
      for (const e of pend) {
        const left = e.at - t - DT;
        if (e.tell === TELL.RED || e.tell === TELL.BLACK || style === 'dodge') {
          if (left <= (style === 'parry' ? 0.3 : 0.1)) {
            e.done = true;
            const d = e.hazard ? { x: e.x, z: e.z } : g.dragon.position, p = g.player.position;
            const dx = p.x - d.x, dz = p.z - d.z, l = Math.hypot(dx, dz) || 1;
            input.axis = e.hazard ? { x: dx / l, y: -dz / l } : { x: dz / l, y: dx / l };
            input.tap('Space');
            stats.dodgeTry++;
          }
        } else if (left <= early) {
          e.done = true;
          input.up(1);
          input.click(1);
          stats.parryTry++;
        }
      }
      return pend.some((e) => !e.done && e.at - t < 0.7);
    },
    /** Is a cue it means to answer due within `s` seconds? */
    dueWithin(s) {
      const t = G.game.time;
      return pend.some((e) => !e.done && e.at - t < s);
    },
  };
}

/** Fence: keep close, answer every tell, cut in his openings, give the deathblow to a broken boss. */
function fencer(G) {
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  input.axis = { x: 0, y: 0 };
  if (!p.alive || game.state !== 'boss') return;
  p.hp = p.maxHp; // god mode for the win run
  const tgt = new THREE.Vector3();
  d.lockPoint(tgt);
  game.mouseGround.set(tgt.x, 0, tgt.z);
  const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z, dist = Math.hypot(dx, dz);
  if (p.state === 'lock') {
    if (((game.realTime * 60) | 0) % 5 === 0) input.click(0);
    return;
  }
  const busy = G.defend.act();
  if (dist > 2.6 && !busy) input.axis = { x: dx / dist, y: -dz / dist };
  const a = d.brain.act;
  const open = d.broken || (d.mode === 'react' && ['recoil', 'stagger', 'flinch', 'reeling', 'trampled'].includes(d.brain.react?.kind)) || (a && a.t > a.recoveryStart) || p.critTimer > 0;
  const tick = (game.realTime * 60) | 0;
  if (!busy && dist < 3.2 && (open ? tick % 20 === 0 : tick % 70 === 0)) input.click(0);
}

// ================================================================== scenario: smoke (opt-in)
async function scenarioSmoke() {
  out('\n== scenario SMOKE (he fights a defender for 60 s in each phase) ==');
  for (let ph = 1; ph <= 3; ph++) {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true, form: ph });
    game.player.debug.god = true;
    G.defend = makeDefender(G, { world: true });
    const moves = {};
    G.watch = (n, e) => { if (n === 'dragon:windup') moves[e.name] = (moves[e.name] || 0) + 1; };
    run(G, Number(process.env.GCD_SMOKE ?? 60), () => { G.defend.act(); game.mouseGround.set(d.position.x, 0, d.position.z); });
    out(`   P${d.phase}: ${JSON.stringify(moves)} · flashes ${G.defend.stats.flashes} · hits ${G.hits.length} · out of reach max ${d.flight.stats.outMax.toFixed(2)} s · crashes ${d.flight.stats.crashes}/${d.flight.stats.skids}`);
  }
}

// ================================================================== helpers of this suite
const P_OF = (name) => MOVES[name]?.phase ?? 1;
const pieces = (G, kind) => G.game.world.destructibles.list.filter((b) => b.kind === kind);

// ================================================================== scenario: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (the registry, the URL, the lines, no reward, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'city', `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(['?level=city', '?lab&level=CITY', '?level=halcyon', '?level=plaza', '?level=neon', '?level=saviour', '?level=tomorrow'].every((q) => levelFromSearch(q) === LVL), '?level=city / halcyon / plaza / neon / saviour / tomorrow pick the level (case-insensitive)');
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'victory', 'fallen', 'restReset', 'again', 'rise']) assert(!!LVL.text[k], `the level has its ${k} line`);
  assert(LVL.name === 'Halcyon Plaza' && LVL.text.victory === 'THE SAVIOUR FALLS' && LVL.text.phase2 === 'THE SMILE DROPS' && LVL.text.phase3 === 'NO ONE IS WATCHING', `${LVL.name}: ${LVL.sub}`);
  assert(LVL.reward === undefined, 'no reward ships (the owner has not chosen one: ADR-161)');
  assert(CONFIG.world.dragonBound === 13.5 && CONFIG.world.arenaRadius === PLAZA.r && CONFIG.world.bossTriggerZ === PLAZA.entryZ, 'applyLevel merged the plaza layout into CONFIG.world');
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof Halcyon && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'halcyon', `the boss is his own duelist: ${d.name}`);
  assert(d.maxHp === TUNING.hp && TUNING.phaseAt.length === 3 && !d.lives, 'one health bar, three phases');
  run(G, 0.6);
  assert(d.mode === 'sleep' && d.position.y > 4, `asleep he hovers high over the plaza (${d.position.y.toFixed(1)} m)`);
  d.startIntro();
  run(G, 4, null, () => d.mode === 'foot');
  run(G, 1.2);
  assert(G.counts['dragon:wake'] === 1 && G.counts['dragon:introDone'] === 1 && d.mode !== 'sleep' && d.position.y < 1.2, `woken: he comes down to his hover (${d.position.y.toFixed(2)} m) and the duel starts`);
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every phase a move is used in, both ends of every roll) ==');
  let checked = 0;
  const CAP = { [TELL.NORMAL]: 26, [TELL.BLUE]: 26, [TELL.RED]: 30, [TELL.BLACK]: 45 };
  const phasesOf = (name) => {
    const def = MOVES[name];
    if (def.transition) return [def.phase];
    if (def.counter || def.hidden) return [1, 2, 3];
    return [1, 2, 3].filter((f) => (Array.isArray(def.weight) ? def.weight[f - 1] ?? 0 : def.weight) > 0);
  };
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    const phases = phasesOf(name);
    if (!phases.length) assert(false, `${name}: used in at least one phase`);
    for (const f of phases) {
      for (const r of [0, 0.5, 0.999]) {
        const A = realise(name, f, () => r);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${f} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        if (!A.beats.filter((b) => b.feint && !b.def.stance).every((b) => b.def.tell === undefined && !b.def.zone && !b.def.damage)) assert(false, `${tag}: a feint says nothing (no tell, no zone, no damage)`);
        const first = real[0];
        // (a snap, ADR-225: a white blow from the guard may wind up shorter: >= snap.min, little damage, its flash after its tell)
        const snapOk = (b) => b?.def.snap && b.def.tell === TELL.NORMAL && b.impact - b.tellAt >= TUNING.snap.min - 1e-6 && b.def.damage <= TUNING.snap.maxDamage && b.flash > b.tellAt;
        if (!def.transition && first && !(first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6 || snapOk(first))) assert(false, `${tag}: first real windup ${(first.impact - first.tellAt).toFixed(3)} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring has its ring`);
        for (const b of real) if (!def.transition && b.def.damage > CAP[b.def.tell]) assert(false, `${tag}: hit ${b.hit} ${b.def.damage} damage over the cap`);
        // a red cue at least 0.36 s after a white or blue one
        for (let i = 1; i < real.length; i++) if ((real[i].def.tell === TELL.RED || real[i].def.tell === TELL.BLACK) && !(real[i - 1].def.tell === TELL.RED || real[i - 1].def.tell === TELL.BLACK) && !(real[i].flash - real[i - 1].flash >= 0.36 - 1e-6)) assert(false, `${tag}: a red cue ${(real[i].flash - real[i - 1].flash).toFixed(2)} s after a guard cue`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        checked++;
      }
    }
  }
  assert(checked > 50, `${checked} realisations obey the rules (a tell per hit, feints silent, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart, a red cue >= 0.36 s after a guard cue, the damage caps)`);
  const W = (n, i = 0) => MOVES[n].beats.filter((b) => !b.feint)[i];
  assert(W('stare').tell === TELL.BLUE && W('stare').halGlare === 'stare' && W('stare').selfHit && W('stare').sustain && W('stare').part === 'eyes', 'The Stare: blue, his eyes, a lit beam (selfHit, sustain)');
  assert(W('redGlare').tell === TELL.RED && W('redGlare').halGlare === 'sweep', 'Red Glare: red, a sweep');
  assert(MOVES.flyBy.beats.filter((b) => b.halPass === 'go').length === 1 && MOVES.flyBy2.beats.filter((b) => b.halPass === 'go').length === 2 && MOVES.flyBy3.beats.filter((b) => b.halPass === 'go').length === 3 && MOVES.flyBy3.beats.filter((b) => b.halPass === 'go')[2].tell === TELL.RED, 'Fly-By: one pass, two in phase 2, three in phase 3 (the last red)');
  assert(W('throughTower').tell === TELL.RED && MOVES.throughTower.once === 'tower' && W('fallingSky').tell === TELL.BLACK && W('fallingSky').damage === 45, 'Through the Tower (red, a standing top), The Falling Sky (black, 45)');
  assert(W('seeTheWorld').tell === TELL.RED && W('seeTheWorld').halGrab, 'See the World: red, a grab');
  assert(MOVES.monument.beats.some((b) => b.halArm === 'tear') && W('monument', 2).cast && W('crossedGlare', 1).tell === TELL.RED, 'Monument: the arm torn off, swung, thrown; Crossed Glare: red, red');
  assert(MOVE_NAMES.every((n) => MOVES[n].beats.every((b) => b.feint || ['fistR', 'fistL', 'palms', 'footR', 'footL', 'kneeR', 'kneeL', 'eyes', 'feet'].includes(b.part ?? 'fistR'))), 'bare-handed: every blow names the limb (or his eyes)');
  for (const [ph, mv] of Object.entries(TRANSITIONS)) {
    const b = MOVES[mv].beats[0];
    assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph) && b.tell === TELL.RED && b.damage === 10 && b.zone.r === 6, `phase ${ph} begins with ${mv} (red ring 6, 10)`);
  }
  // the homage line: none of the source names appears in his data or the level's strings
  const words = JSON.stringify([MOVES, LVL.text, LVL.name, LVL.sub, TUNING.name]).toLowerCase();
  const bad = ['super' + 'man', 'home' + 'lander', 'kryp' + 'ton', 'vou' + 'ght', 'metro' + 'polis', 'cla' + 'rk', 'ke' + 'nt '].filter((w) => words.includes(w));
  assert(bad.length === 0, `no source name in his moves or the level's lines (${bad.join(', ')})`);
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  const only = process.env.GCD_TMOVE;
  const skip = new Set(['monument', 'curbside', 'smile']); // (thrown things are cued on the piece: CAR / STATUE; the stance needs a cut)
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition || def.hidden || skip.has(name)) continue;
    if (only && name !== only) continue;
    const f = Math.max(P_OF(name), 1);
    const G = build(SEED, true);
    const d = G.game.dragon;
    const [lo, hi] = def.band;
    const at = def.counter ? 2.2 : Math.max(2, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
    duel(G, { dist: at, form: f });
    G.game.player.debug.god = true;
    const flashes = [], contacts = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push(G.game.time); };
    const h0 = G.hits.length;
    if (!d.debug.trigger(name)) { assert(false, `${name} P${f}: starts`); continue; }
    run(G, 12, null, () => quiet(d) && d.mode === 'foot');
    for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED && h.attack === name && h.damage >= 6) { contacts.push(h.t); if (only) out(`       ${h.t.toFixed(3)} contact ${h.attack} ${h.r} ${h.damage}`); }
    // (every flash: the first contact after it lands flashLead later; a beam's ticks and the carry's
    // slam come later still and are not cues)
    let w = 0;
    for (const f of flashes) {
      const c = contacts.find((t) => t >= f - 1e-6);
      if (c === undefined) continue;
      w = Math.max(w, Math.abs(c - f - TUNING.flashLead));
    }
    worst = Math.max(worst, Number.isFinite(w) ? w : 9);
    moves++;
    if (!(contacts.length >= 1) || !(w <= 0.09) || !flashes.length) assert(false, `${name} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    else out(`     ${name.padEnd(15)} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
  }
  if (only) return;
  assert(moves >= 14 && worst <= 0.09, `${moves} moves: every first contact within ${(worst * 1000).toFixed(0)} ms of its flash + ${TUNING.flashLead} s, and every move lands`);
}

// ================================================================== scenario: flight (the rule that keeps a sword fight fair)
async function scenarioFlight() {
  out('\n== scenario FLIGHT (he hovers in reach between moves; out of reach only inside a move, never long) ==');
  const F = TUNING.fly;
  for (let ph = 1; ph <= 3; ph++) {
    const G = build(SEED + ph, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true, form: ph });
    game.player.debug.god = true;
    G.defend = makeDefender(G, { world: true });
    d.flight.stats.outPhase.fill(0);
    d.flight.stats.outFoot = 0;
    let footHigh = 0, footT = 0, longestFoot = 0;
    run(G, Number(process.env.GCD_FSECS ?? 60), () => {
      G.defend.act();
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (d.mode === 'foot' && !d.brain.falling) {
        footT += DT;
        if (footT > 1.2 && d.position.y > F.hover + 0.35) footHigh++;
      } else footT = 0;
      longestFoot = Math.max(longestFoot, footT);
    });
    const outMax = d.flight.stats.outPhase[ph - 1];
    out(`     P${ph}: longest out of reach ${outMax.toFixed(2)} s (cap ${F.maxOut[ph - 1]}), in footwork ${d.flight.stats.outFoot.toFixed(2)} s, crashes ${d.flight.stats.crashes}, skids ${d.flight.stats.skids}, passes ${d.flight.stats.passes}`);
    assert(outMax <= F.maxOut[ph - 1] + 0.05, `P${ph}: no stretch out of reach longer than ${F.maxOut[ph - 1]} s (${outMax.toFixed(2)})`);
    assert(d.flight.stats.outFoot === 0, `P${ph}: never out of reach outside a move (${d.flight.stats.outFoot.toFixed(2)} s in footwork)`);
    assert(footHigh === 0, `P${ph}: in footwork he settles at his hover, ${F.hover} m (${footHigh} frames over it)`);
  }
}

// ================================================================== scenario: glare (his eyes)
function parryAt(G, name, perfect = true, hold = false) {
  const { game, input } = G;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && e.attack === name) G.answerAt = game.time + TUNING.flashLead - (perfect ? 0.04 : 0.12); };
  return () => {
    game.mouseGround.set(game.dragon.position.x, 0, game.dragon.position.z);
    if (hold) input.press(1);
    if (G.answerAt && game.time >= G.answerAt) {
      G.answerAt = 0;
      if (!hold) { input.up(1); input.click(1); }
    }
  };
}
async function scenarioGlare() {
  out('\n== scenario GLARE (The Stare: blue, guard pays guard, a perfect parry returns it; Red Glare: lit at the cue, cover, the world at its height) ==');
  // the Stare on a held guard: no health lost
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 6 });
    const hp0 = p.hp;
    const step = parryAt(G, 'stare', false, true);
    d.debug.trigger('stare');
    run(G, 4, step, () => d.mode === 'foot' && !d.glare.busy);
    G.input.up(1);
    const blocked = G.hits.filter((h) => h.attack === 'stare' && h.r === RESULT.BLOCKED).length;
    assert(blocked >= 1 && p.hp === hp0, `The Stare on a held guard: blocked ${blocked}, no health lost (${p.hp} / ${hp0})`);
  }
  // a perfect parry sends it back into his eyes
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 6 });
    game.player.debug.god = true;
    const hp0 = d.hp;
    const step = parryAt(G, 'stare', true);
    let ret = 0;
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'dragon:returned') ret++; };
    d.debug.trigger('stare');
    run(G, 4, step, () => ret > 0 && d.mode === 'react');
    assert(ret === 1 && hp0 - d.hp >= TUNING.glare.returned.damage - 1 && d.brain.react?.kind === 'blinded', `a perfect parry: it goes back into his eyes (dragon:returned, ${hp0 - d.hp} damage, he reels: ${d.brain.react?.kind})`);
  }
  // Red Glare: never before its cue, one hit, a roll clears it, cover stops it
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 6 });
    game.player.debug.god = true;
    let flash = -1;
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'redGlare') flash = game.time; };
    const h0 = G.hits.length;
    d.debug.trigger('redGlare');
    run(G, 4, null, () => d.mode === 'foot' && !d.glare.busy);
    const hs = G.hits.slice(h0).filter((h) => h.attack === 'redGlare');
    assert(flash > 0 && hs.length === 1 && hs[0].r === RESULT.HIT && hs[0].t >= flash + TUNING.flashLead - 0.09, `Red Glare: one hit, never before its cue (${hs.length}, ${hs.length ? (hs[0].t - flash).toFixed(2) : '-'} s after it)`);
    const G2 = build(SEED, true);
    const d2 = G2.game.dragon;
    duel(G2, { dist: 6 });
    G2.game.player.debug.god = true;
    G2.defend = makeDefender(G2, { style: 'dodge' });
    const h1 = G2.hits.length;
    d2.debug.trigger('redGlare');
    run(G2, 4, () => G2.defend.act(), () => d2.mode === 'foot' && !d2.glare.busy);
    const rs = G2.hits.slice(h1).filter((h) => h.attack === 'redGlare').map((h) => h.r);
    assert(!rs.includes(RESULT.HIT), `rolled through: no hit (${rs.join(', ') || 'none reached him'})`);
  }
  // cover: a car between him and the hero takes the beam; the hero behind it is untouched
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 6 });
    p.debug.god = true;
    const car = pieces(G, 'car').find((b) => b.state === 0);
    // him on one side of the car, the hero right behind it
    d.position.set(car.x, TUNING.fly.hover, car.z - 5);
    d.yaw = 0;
    p.debug.teleport(car.x, car.z + 2.2);
    const hp0 = car.hp, h0 = G.hits.length;
    run(G, 0.2);
    d.debug.trigger('stare');
    run(G, 4, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode === 'foot' && !d.glare.busy);
    const hit = G.hits.slice(h0).filter((h) => h.attack === 'stare' && h.r === RESULT.HIT).length;
    assert(car.hp < hp0 && hit === 0 && d.glare.stats.covered > 0, `a car between them takes the beam (${hp0.toFixed(2)} → ${car.hp.toFixed(2)}), the hero behind it untouched (${hit})`);
  }
  // the world at the beam's height: the sweep at 1.15 m cuts what stands in it, a sign board at 3.2 m is spared
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 6 });
    p.debug.god = true;
    const lamp = pieces(G, 'lamp')[0], sign = pieces(G, 'shopSign')[0];
    const lh = lamp.hp, sh = sign.hp;
    // he stands so the sweep crosses the lamp and the sign's tower front
    d.position.set(lamp.x * 0.55, TUNING.fly.hover, lamp.z * 0.55);
    p.debug.teleport(lamp.x * 0.75, lamp.z * 0.75);
    d.yaw = Math.atan2(lamp.x - d.position.x, lamp.z - d.position.z);
    run(G, 0.1);
    d.debug.trigger('redGlare');
    run(G, 4, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode === 'foot' && !d.glare.busy);
    assert(lamp.hp < lh, `the sweep at ${TUNING.glare.sweep.y} m cuts a lamp post in its strip (${lh.toFixed(2)} → ${lamp.hp.toFixed(2)})`);
    assert(sign.hp === sh, 'a shop sign hung at 3.2 m (out of its strip) is untouched');
  }
}

// ================================================================== scenario: pass (Fly-By, the crash)
async function scenarioPass() {
  out('\n== scenario PASS (Fly-By is blue: a parry beats him out of the air and the deathblow lands; with ?parryRiposte=old the crash into the first cover on his line, nothing there the skid) ==');
  {
    // ADR-294: every blue blow of a body takes the deathblow, his flying ones too: he drops in front of the hero, no crash
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 5 });
    p.debug.god = true;
    const step = parryAt(G, 'flyBy', false);
    let crash = null, db = null, firstY = NaN, hits = 0;
    const w = G.watch;
    G.watch = (n, e) => {
      w(n, e);
      if (n === 'dragon:crash') crash = { ...e };
      if (n === 'player:flurry' && e?.art === 'deathblow') db = { ...e };
      if (n === 'player:flurryHit' && e?.planted) { if (!hits) firstY = d.position.y; hits++; }
    };
    const hp0 = d.hp;
    d.debug.trigger('flyBy');
    run(G, 6, step, () => db && p.db.phase === '' && hits > 0);
    out(`     deathblow: ${JSON.stringify(db && { strikes: db.strikes })}, ${hits} blows, him at ${firstY.toFixed(2)} m at the first, ${hp0 - d.hp} damage, crash ${JSON.stringify(crash)}`);
    assert(db && hits >= 1 && !crash && d.flight.stats.crashes === 0, 'a parried blue pass: the deathblow, no crash');
    assert(hp0 - d.hp >= deathblowTotal(1) - 1, `the combo's damage lands on him (${hp0 - d.hp})`);
    assert(firstY < 1.0, `he is out of the air when the first blow lands (${firstY.toFixed(2)} m)`);
  }
  const was = riposteMode();
  setRiposteMode('old');
  for (const withCover of [true, false]) {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 5 });
    p.debug.god = true;
    if (!withCover) {
      // the city cleared of cover round the plaza
      for (const b of game.world.destructibles.list) if (b.cover && !b.floor) { b.cover = false; b._wasCover = true; }
    }
    const step = parryAt(G, 'flyBy', false);
    let crash = null;
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'dragon:crash') crash = { ...e }; };
    const hp0 = d.hp;
    d.debug.trigger('flyBy');
    run(G, 6, step, () => crash && d.mode === 'foot');
    out(`     ${withCover ? 'with cover' : 'no cover'}: ${JSON.stringify(crash)}, ${hp0 - d.hp} damage, crashes ${d.flight.stats.crashes}, skids ${d.flight.stats.skids}`);
    if (withCover) assert(crash && crash.why === 'parry' && crash.cover && hp0 - d.hp >= TUNING.crash.damage - 1, `a parried pass: THE CRASH into a ${crash?.cover} (${hp0 - d.hp} damage)`);
    else assert(crash && crash.cover === null && d.flight.stats.skids === 1, 'nothing on his line: he skids');
  }
  setRiposteMode(was);
}

// ================================================================== scenario: car (Curbside, the fuses)
async function scenarioCar() {
  out('\n== scenario CAR (Curbside: found, lifted, thrown; a parry splits it; the fuse; the boss hurt by a bang the hero caused) ==');
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 7 });
    p.debug.god = true;
    const step = parryAt(G, 'curbside', false);
    let split = 0, blast = 0;
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'dragon:split') split++; if (n === 'world:blast') blast++; };
    const ok = d.debug.trigger('curbside');
    run(G, 7, step, () => d.mode === 'foot' && !d.terrain.busy);
    run(G, 1.5);
    const T = d.terrain.stats;
    assert(ok && T.lifted === 1 && T.thrown === 1, `Curbside: a car found, lifted and thrown (${T.lifted}, ${T.thrown})`);
    assert(split === 1 && blast >= 2, `parried: cut in two (dragon:split), its halves go up behind the hero (${blast} blasts)`);
  }
  {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 5 });
    p.debug.god = true;
    d.debug.setAI(false);
    const car = pieces(G, 'car').find((b) => b.state === 0);
    d.position.set(car.x + 1.8, TUNING.fly.hover, car.z);
    p.debug.teleport(car.x + 6, car.z + 4);
    const hp0 = d.hp;
    let flash = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'carBomb') flash++; };
    game.world.destructibles.strike(car.x, car.z, 0.4, 50, { kind: 'blunt', by: 'player', y: 0.8, src: game.world.destructibles.swing() });
    run(G, CITY.car.fuse + 0.4, () => { d.position.set(car.x + 1.8, TUNING.fly.hover, car.z); });
    assert(flash === 1 && hp0 - d.hp >= CITY.car.boss.damage - 1, `a car the hero broke beside him: cued, then it goes up and he takes ${hp0 - d.hp}`);
  }
  {
    // a reset in phase 1 mid-fuse (a rest, a retry: the flow's order, his reset then the world's): no bang
    // follows, and the restored car can burn and blow up again (the review of 22b049b: setPhase(1) in phase 1
    // returned before forgetting the fuses)
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 6 });
    p.debug.god = true;
    d.debug.setAI(false);
    const car = pieces(G, 'car').find((b) => b.state === 0);
    p.debug.teleport(car.x + 6, car.z + 4);
    let blast = 0;
    G.watch = (n) => { if (n === 'world:blast') blast++; };
    const fuseOf = () => game.world.forest.ambience.fuses.find((f) => f.piece === car);
    game.world.destructibles.strike(car.x, car.z, 0.4, 50, { kind: 'blunt', by: 'player', y: 0.8, src: game.world.destructibles.swing() });
    run(G, CITY.car.fuse * 0.5);
    const mid = fuseOf()?.state;
    d.reset();
    game.world.restore();
    run(G, CITY.car.fuse + 1);
    assert(mid === 'fuse' && blast === 0 && car.state === 0 && fuseOf()?.state === 'idle', `a reset mid-fuse in phase 1: no bang after it (${blast}), the car whole (${car.state}), its fuse idle (${mid} -> ${fuseOf()?.state})`);
    const b0 = blast;
    game.world.destructibles.strike(car.x, car.z, 0.4, 50, { kind: 'blunt', by: 'player', y: 0.8, src: game.world.destructibles.swing() });
    run(G, CITY.car.fuse + 0.6);
    assert(blast > b0, `... and the restored car, broken again, goes up again (${blast - b0} blast)`);
  }
}

// ================================================================== scenario: tower (Through the Tower)
async function scenarioTower() {
  out('\n== scenario TOWER (Through the Tower: the top topples on his line with the red tell; reset restores it) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 5, form: 2 });
  p.debug.god = true;
  const tops0 = d.terrain.tops().length;
  let worldTell = 0, tower = 0;
  G.watch = (n, e) => { if (n === 'combat:tell' && e.source === 'world' && e.attack === 'fallingDebris') worldTell++; if (n === 'dragon:tower') tower++; };
  const h0 = G.hits.length;
  const ok = d.debug.tower();
  run(G, 6, null, () => d.mode === 'foot');
  run(G, 2);
  const hit = G.hits.slice(h0).filter((h) => h.attack === 'throughTower').length;
  assert(ok && tower === 1 && d.terrain.tops().length === tops0 - 1 && worldTell >= 1 && hit >= 1, `a tower's top comes down (${tops0} → ${d.terrain.tops().length} standing), told red as a falling piece (${worldTell}), his blow reaches the hero (${hit})`);
  game.world.restore();
  assert(d.terrain.tops().length === tops0, 'the reset: every tower stands again');
  // a perfect dodge: he overshoots into the building opposite (the crash)
  const G2 = build(SEED, true);
  const d2 = G2.game.dragon;
  duel(G2, { dist: 5, form: 2 });
  G2.game.player.debug.god = true;
  G2.defend = makeDefender(G2, { style: 'dodge', early: 0.05 });
  let crash = null;
  G2.watch = (n, e) => { if (n === 'dragon:crash') crash = { ...e }; };
  d2.debug.tower();
  run(G2, 7, () => { G2.defend.act(); G2.game.mouseGround.set(d2.position.x, 0, d2.position.z); }, () => crash && d2.mode === 'foot');
  const pd = G2.counts['player:perfectDodge'] ?? 0;
  assert(pd === 0 || (crash && crash.why === 'dodge'), `a perfect dodge of it: he overshoots (${pd} perfect dodges, crash ${JSON.stringify(crash)})`);
}

// ================================================================== scenario: statue (the head, the arm)
async function scenarioStatue() {
  out('\n== scenario STATUE (his first Stare takes his own statue\'s head; Monument tears its arm off and swings it) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 6 });
  p.debug.god = true;
  const head = pieces(G, 'statueHead')[0], body = pieces(G, 'statue')[0], arm = pieces(G, 'statueArm')[0];
  let heads = 0;
  G.watch = (n, e) => { if (n === 'dragon:statue' && e.part === 'head') heads++; };
  d.debug.trigger('stare');
  run(G, 5, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode === 'foot' && !d.glare.busy);
  run(G, 1.5);
  assert(heads === 1 && head.state !== 0 && body.state === 0, `the first Stare's tail takes the statue's head (${heads}), the body stands`);
  d.debug.trigger('stare');
  run(G, 5, null, () => d.mode === 'foot' && !d.glare.busy);
  assert(heads === 1, 'once a fight');
  // Monument (phase 3): the arm torn off and swung
  const G2 = build(SEED, true);
  const d2 = G2.game.dragon;
  duel(G2, { dist: 4, form: 3 });
  G2.game.player.debug.god = true;
  const arm2 = pieces(G2, 'statueArm')[0];
  const h0 = G2.hits.length;
  d2.debug.statue();
  run(G2, 7, () => G2.game.mouseGround.set(d2.position.x, 0, d2.position.z), () => d2.mode === 'foot' && !d2.terrain.busy);
  const hits = G2.hits.slice(h0).filter((h) => h.attack === 'monument').length;
  assert(d2.terrain.stats.arms === 1 && arm2.state !== 0 && hits >= 2, `Monument: the arm torn off (${d2.terrain.stats.arms}), swung and thrown (${hits} blows reach the hero)`);
  void arm;
}

// ================================================================== scenario: grab (See the World)
async function scenarioGrab() {
  out('\n== scenario GRAB (caught: carried up and thrown down; control back within the cap; a perfect dodge whiffs; never on a downed hero) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 2, form: 2 });
  p.debug.god = true;
  let grabT = -1, topY = 0;
  G.watch = (n) => { if (n === 'dragon:grab') grabT = game.time; };
  d.debug.carry();
  let freeAt = -1;
  run(G, 6, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    topY = Math.max(topY, p.position.y);
    if (grabT > 0 && freeAt < 0 && game.time > grabT + 0.1 && p.state !== 'knockdown') freeAt = game.time;
  }, () => freeAt > 0 && d.mode === 'foot');
  const slam = G.hits.filter((h) => h.attack === 'seeTheWorld' && h.damage >= 20).length;
  assert(grabT > 0 && topY > TUNING.grab.height * 0.8 && slam === 1 && p.position.y === 0, `caught: carried up to ${topY.toFixed(1)} m and thrown down (${slam})`);
  assert(freeAt > 0 && freeAt - grabT <= TUNING.grab.cap + 0.2, `control is back ${(freeAt - grabT).toFixed(2)} s after the catch (cap ${TUNING.grab.cap})`);
  // the slam lands (the review of 22b049b: the get-up time was set before the hit, inside its i-frames, so
  // the slam came back DODGED): a mortal hero loses the slam's damage, control still back within the cap
  {
    const G4 = build(SEED, true);
    const d4 = G4.game.dragon, p4 = G4.game.player;
    duel(G4, { dist: 2, form: 2 });
    p4.debug.god = false;
    p4.hp = p4.maxHp ?? p4.hp;
    let g4 = -1, f4 = -1, hpPre = p4.hp;
    G4.watch = (n) => { if (n === 'dragon:grab') g4 = G4.game.time; };
    d4.debug.carry();
    run(G4, 6, () => {
      G4.game.mouseGround.set(d4.position.x, 0, d4.position.z);
      if (!G4.hits.some((h) => h.attack === 'seeTheWorld' && h.damage >= 20)) hpPre = p4.hp;
      if (g4 > 0 && f4 < 0 && G4.game.time > g4 + 0.1 && p4.state !== 'knockdown') f4 = G4.game.time;
    }, () => f4 > 0 && d4.mode === 'foot');
    const sl = G4.hits.find((h) => h.attack === 'seeTheWorld' && h.damage >= 20);
    assert(sl?.r === RESULT.HIT && hpPre - p4.hp >= TUNING.grab.damage - 0.5, `the slam lands: ${sl?.r}, the hero ${hpPre.toFixed(0)} -> ${p4.hp.toFixed(0)} (the slam ${TUNING.grab.damage})`);
    assert(f4 > 0 && f4 - g4 <= TUNING.grab.cap + 0.2, `... and control is back ${(f4 - g4).toFixed(2)} s after the catch (cap ${TUNING.grab.cap})`);
  }
  // never on a hero who is down
  const G2 = build(SEED, true);
  const d2 = G2.game.dragon, p2 = G2.game.player;
  duel(G2, { dist: 2, form: 2 });
  p2.debug.god = true;
  p2.takeHit({ damage: 1, knockdown: true, kind: 'test', tell: TELL.RED, from: { x: d2.position.x, z: d2.position.z } });
  assert(p2.state === 'knockdown' && d2.weigh('seeTheWorld', MOVES.seeTheWorld, 1) === 0, 'a hero who is down: See the World is not picked');
  // a perfect dodge: he closes on air (the crash)
  const G3 = build(SEED, true);
  const d3 = G3.game.dragon;
  duel(G3, { dist: 2, form: 2 });
  G3.game.player.debug.god = true;
  G3.defend = makeDefender(G3, { style: 'dodge', early: 0.05 });
  let crash = null;
  G3.watch = (n, e) => { if (n === 'dragon:crash') crash = { ...e }; };
  d3.debug.carry();
  run(G3, 5, () => { G3.defend.act(); G3.game.mouseGround.set(d3.position.x, 0, d3.position.z); }, () => d3.mode === 'foot');
  const pd = G3.counts['player:perfectDodge'] ?? 0;
  assert(d3.flight.stats.carries === 0 && (pd === 0 || crash?.why === 'dodge'), `rolled through: no carry (${pd} perfect dodges, crash ${crash?.why ?? '-'})`);
}

// ================================================================== scenario: phase
async function scenarioPhase() {
  out('\n== scenario PHASE (the gates, both transitions, the city\'s light, what starts after each) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, set = game.world.forest;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  const gate = d.maxHp * TUNING.phaseAt[1];
  d.hp = gate + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  assert(d.hp === gate && d.brain.pendingPhase === 2, `damage stops at the gate (${d.hp} = ${gate})`);
  let p2 = 0, p3 = 0, after = [];
  G.watch = (n, e) => { if (n === 'dragon:phase2') p2++; if (n === 'dragon:phase3') p3++; if (n === 'dragon:windup') after.push(e.name); };
  run(G, 1, null, () => d.brain.act?.name === 'smileDrops');
  assert(d.brain.act?.name === 'smileDrops' && d.phase === 2 && p2 === 1 && set.ambience.state.phase === 2, 'The Smile Drops: phase 2, dragon:phase2, the screens turn (setPhase 2)');
  after = [];
  run(G, 4, null, () => d.brain.act && d.brain.act.name !== 'smileDrops');
  assert(after[0] === 'throughTower', `then Through the Tower at once (${after[0]})`);
  assert(game.flow._text('phase2') === 'THE SMILE DROPS', 'the level\'s phase-2 banner');
  run(G, 6, null, () => d.mode === 'foot');
  const gate3 = d.maxHp * TUNING.phaseAt[2];
  d.hp = gate3 + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  run(G, 1, null, () => d.brain.act?.name === 'noOneWatching');
  assert(d.brain.act?.name === 'noOneWatching' && d.phase === 3 && p3 === 1, 'No One Is Watching: phase 3, dragon:phase3');
  after = [];
  run(G, 4, null, () => d.brain.act && d.brain.act.name !== 'noOneWatching');
  assert(set.ambience.state.phase === 3 && after[0] === 'fallingSky' && d.dressPhase === 3, `the city goes dark (setPhase 3), the cape in tatters, then The Falling Sky (${after[0]})`);
  assert(game.flow._text('phase3') === 'NO ONE IS WATCHING', 'the level\'s phase-3 banner');
  d.reset();
  assert(set.ambience.state.phase === 1, 'his reset: the city\'s light back (setPhase 1)');
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the plaza → he comes down → the duel → victory; a death and a reset) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.3);
  input.tap('Enter');
  run(G, 0.5);
  if (game.state !== 'explore') game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(game.state === 'explore' && d.mode === 'sleep', 'exploring; he hovers asleep');
  p.debug.teleport(0, CONFIG.world.bossTriggerZ + 2.5);
  run(G, 0.2);
  run(G, 4, () => { input.axis = { x: 0, y: 1 }; }, () => d.mode !== 'sleep');
  input.axis = { x: 0, y: 0 };
  assert(d.mode === 'intro' && game.state === 'bossIntro', `onto the plaza: he stirs (${game.state})`);
  run(G, 8, null, () => d.mode === 'foot' || d.mode === 'act');
  run(G, 0.2);
  assert(G.counts['dragon:introDone'] === 1 && game.state === 'boss', `the intro ends in the duel (${game.state})`);
  p.debug.god = false;
  p.hp = 1;
  d.debug.setAI(true);
  run(G, 25, null, () => game.state === 'dead');
  assert(game.state === 'dead', 'he can kill the hero');
  run(G, 12, () => { if (((game.realTime * 60) | 0) % 30 === 0) input.tap('Enter'); }, () => game.state === 'explore');
  assert(game.state === 'explore' && d.mode === 'sleep' && d.phase === 1, `after the death he hovers asleep again (${game.state}, ${d.mode})`);
  game.flow.debug.toState('boss');
  run(G, 0.5);
  d.debug.kill();
  run(G, 8, null, () => game.state === 'victory');
  assert(game.state === 'victory' && game.flow._text('victory') === 'THE SAVIOUR FALLS', `killed: victory (${game.state})`);
}

// ================================================================== scenario: pace (copied from duel.mjs PACE)
// ================================================================== scenario: pace (the director's meter)
// A god-mode defender that never attacks, driven by combat:flash (his thrown things send no tell):
// the guard held through a normal / blue blow, a roll 0.28 s before a red / black one (out of a
// hazard's ring: away from its centre). The hero roams between standoffs (2.5 / 5 / 9 m, a new one
// every 4 s), on the REAL plaza. Per seed and per phase (every phase
// the kit has), GCD_PSECS s each (default 120), seeds GCD_PSEEDS (default 4242,7,99): cues a
// minute (combat:flash from 'dragon' or 'world'), the longest gap between cues (a black blow's charge
// counts as activity), the mix by category, the moves chained (started straight out of another, no
// footwork between) and the longest chain, conflicts (two flashes under 0.3 s apart needing
// different answers, from different attacks; same attack: "inner"), the share of time something of
// his is live on the floor, the blade holds and strike delays the fairness guard made. With a
// `pressure` block in tuning.js it asserts pressure.meter; without one it only measures.
function paceDefender(G) {
  const pend = [];
  const stats = { flashes: 0, rolls: 0, guards: 0 };
  let guardUntil = -1;
  const leadOf = (src) => (src === 'world' ? 0.3 : TUNING.flashLead);
  return {
    stats,
    onEvent(n, e) {
      if (n !== 'combat:flash' || (e?.source !== 'dragon' && e?.source !== 'world')) return;
      stats.flashes++;
      pend.push({ tell: e.tell, at: G.game.time + leadOf(e.source), x: e.x, z: e.z, hazard: !!e.hazard && !e.bullet, done: false });
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.5) pend.splice(i, 1);
      let rolled = false;
      for (const e of pend) {
        if (e.done) continue;
        const left = e.at - t - DT;
        if (e.tell === TELL.RED || e.tell === TELL.BLACK) {
          if (left <= 0.28) {
            e.done = true;
            input.up(1);
            guardUntil = -1;
            const c = e.hazard ? { x: e.x, z: e.z } : g.dragon.position, p = g.player.position;
            const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
            input.axis = e.hazard ? { x: dx / l, y: -dz / l } : { x: -dz / l, y: -dx / l };
            input.tap('Space');
            rolled = true;
            stats.rolls++;
          }
        } else {
          e.done = true;
          guardUntil = Math.max(guardUntil, e.at + 0.2);
          stats.guards++;
        }
      }
      if (guardUntil > t) input.press(1);
      else if (guardUntil > 0) { guardUntil = -1; input.up(1); }
      return rolled;
    },
  };
}

async function scenarioPace() {
  out('\n== scenario PACE (a steady defender in god mode vs his AI, per phase: cues, gaps, mix, chains, conflicts) ==');
  const DIR = await imp('src/entities/enemies/duelist/director.js');
  const P = TUNING.pressure ?? null;
  const SECS = Number(process.env.GCD_PSECS ?? 120);
  const SEEDS = (process.env.GCD_PSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph)) - 1] : v);
  const CATS = DIR.CATEGORIES;
  const answer = (tell) => (tell === TELL.RED || tell === TELL.BLACK ? 'dodge' : 'guard');
  const skip = (name) => !MOVES[name] || MOVES[name].transition || MOVES[name].counter;
  const rows = [];
  let lastG = null, NPH = 0;
  for (const seed of SEEDS) {
    for (let ph = 1; ; ph++) {
      const G = (lastG = build(seed, true));
      const { game } = G;
      const d = game.dragon, p = game.player;
      NPH = d.kit.maxPhase ?? TUNING.phaseAt.length;
      if (ph > NPH) break;
      duel(G, { dist: 3, ai: true });
      p.debug.god = true;
      p.debug.noRiposte = true;
      G.defend = paceDefender(G);
      // into the phase through its real transition(s)
      for (let n = 2; n <= ph; n++) {
        d.brain.forcePhase(n);
        run(G, 8, (GG) => { GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); }, () => d.phase === n && d.mode !== 'act');
      }
      Math.random = mulberry32(seed * 7 + ph);
      const flashes = [], acts = [], cats = {}, busyT = [];
      const modeT = {}, spent = {};
      let hurt = 0, frames = 0, busy = 0, burnF = 0, chained = 0, chainLen = 0, chainMax = 0, prevAct = null, prevMode = d.mode;
      const s0 = { ...(d.brain.stats ?? {}) };
      const dbg = [];
      G.watch = (n, e) => {
        if ((process.env.GCD_PDBG || process.env.GCD_PGAP) && /dragon:windup|combat:flash|combat:tell|dragon:parried|dragon:guard/.test(n)) dbg.push([game.time, `${n.split(':')[1]} ${e?.name ?? e?.attack ?? ''} ${e?.tell ?? ''}${n === 'combat:tell' ? ` in ${e.impactIn?.toFixed(2)}` : ''} [${d.mode} ${d.brain.act?.name ?? ''} h${d.brain.stats?.holds} d${d.brain.stats?.delays}]`]);
        if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashes.push([game.time, e.tell, e.attack, e.source]);
        if (n === 'combat:charge' && Number.isFinite(e?.dur)) for (let k = 0; k < e.dur; k += 0.1) busyT.push(game.time + k);
        if (n === 'dragon:windup' && !skip(e?.name)) { acts.push([game.time, e.name]); const c = DIR.categoryOf(MOVES[e.name]); cats[c] = (cats[c] || 0) + 1; }
      };
      const roam = mulberry32(seed * 31 + ph), goal = { r: 2.5, a: 0, until: -1 };
      const t0 = game.time;
      for (let i = 0; i < Math.round(SECS / DT); i++) {
        const rolled = G.defend.act();
        if (game.time > goal.until) {
          goal.r = [2.5, 5, 9][Math.floor(roam() * 3)];
          goal.a = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z) + (roam() - 0.5) * 1.6;
          goal.until = game.time + 4;
        }
        if (!rolled && p.state !== 'roll') {
          const gx = d.position.x + Math.sin(goal.a) * goal.r, gz = d.position.z + Math.cos(goal.a) * goal.r;
          const k = Math.hypot(gx, gz) > 12 ? 12 / Math.hypot(gx, gz) : 1;
          const dx = gx * k - p.position.x, dz = gz * k - p.position.z, l = Math.hypot(dx, dz);
          G.input.axis = l > 0.6 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        }
        game.mouseGround.set(d.position.x, 0, d.position.z);
        G.tick(DT);
        if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
        frames++;
        { const k = d.mode === 'react' ? `react:${d.brain.react?.kind}` : d.mode === 'act' ? (d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart ? 'act:recovery' : 'act') : d.mode === 'foot' ? (d.brain.seek ? 'foot:seek' : Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) > TUNING.move.band[1] + 0.3 ? 'foot:closing' : 'foot') : d.mode; modeT[k] = (modeT[k] || 0) + game.dt; if (d.mode === 'act' && d.brain.act) spent[d.brain.act.name] = (spent[d.brain.act.name] || 0) + game.dt; }
        // chained: a move that starts straight out of another (no footwork, no reaction between)
        const a = d.brain.act;
        if (d.mode === 'act' && a && a !== prevAct && !a.def.transition && !a.def.counter) {
          if (prevMode === 'act' && prevAct) { chained++; chainLen++; chainMax = Math.max(chainMax, chainLen); } else chainLen = 0;
        }
        if (d.mode !== 'act') chainLen = 0;
        prevAct = d.mode === 'act' ? a : null;
        prevMode = d.mode;
        if (d.glare?.busy || d.terrain?.busy) busy++;
        if (d.moveFx?.alive) burnF++;
      }
      G.watch = null;
      G.defend = null;
      const T = game.time - t0;
      hurt = G.hits.filter((h) => h.t > t0 && h.r === RESULT.HIT).length;
      const ts = [t0, ...flashes.map((f) => f[0]), ...busyT.filter((x) => x > t0 && x < t0 + T), t0 + T].sort((x, y) => x - y);
      let gapMax = 0, gapAt = '';
      for (let i = 1; i < ts.length; i++) {
        const g = ts[i] - ts[i - 1];
        if (g > gapMax) { gapMax = g; gapAt = `${(ts[i - 1] - t0).toFixed(0)} s: ${acts.filter((w) => w[0] > ts[i - 1] - 0.5 && w[0] < ts[i]).map((w) => w[1]).join(', ') || 'no move'}`; }
        // GCD_PGAP=1: the event log through each gap over 2.8 s
        if (process.env.GCD_PGAP && g > 2.8) out(`      GAP P${ph} seed ${seed} ${g.toFixed(2)} s at ${(ts[i - 1] - t0).toFixed(2)}: ${dbg.filter((x) => x[0] > ts[i - 1] - 0.3 && x[0] < ts[i] + 0.1).map((x) => `${(x[0] - t0).toFixed(2)} ${x[1]}`).join(' | ')}`);
      }
      let conflicts = 0, inner = 0;
      const conflictAt = [], innerAt = new Set();
      for (let i = 0; i < flashes.length; i++) {
        for (let j = i + 1; j < flashes.length && flashes[j][0] - flashes[i][0] < 0.3; j++) {
          if (answer(flashes[i][1]) === answer(flashes[j][1])) continue;
          if (flashes[i][2] === flashes[j][2]) { inner++; innerAt.add(flashes[i][2]); } else {
            conflicts++;
            conflictAt.push(`${flashes[i][2]}/${flashes[j][2]} @${(flashes[i][0] - t0).toFixed(1)}`);
            // GCD_PDBG=1: what happened round each conflict
            if (process.env.GCD_PDBG) out(`      CONFLICT P${ph} ${(flashes[i][0] - t0).toFixed(2)}: ${dbg.filter((x) => x[0] > flashes[i][0] - 2.5 && x[0] < flashes[j][0] + 0.4).map((x) => `${(x[0] - t0).toFixed(2)} ${x[1]}`).join(' | ')}`);
          }
        }
      }
      // the answers asked: the share that asks a dodge, the longest run of one answer in a row
      let dodges = 0, run1 = 0, runMax = 0;
      for (let i = 0; i < flashes.length; i++) {
        const a1 = answer(flashes[i][1]);
        if (a1 === 'dodge') dodges++;
        run1 = i && answer(flashes[i - 1][1]) === a1 ? run1 + 1 : 1;
        runMax = Math.max(runMax, run1);
      }
      const st = d.brain.stats ?? {};
      const dlt = (k) => (st[k] ?? 0) - (s0[k] ?? 0);
      rows.push({ seed, ph, T, cues: flashes.length, perMin: (flashes.length * 60) / T, gapMax, gapAt, cats, picks: acts.length, chained, chainMax, conflicts, conflictAt, inner, innerAt: [...innerAt], busy: busy / frames, burn: burnF / frames, dodge: dodges / (flashes.length || 1), runMax, holds: dlt('holds'), feints: dlt('feints'), told: dlt('toldFeints'), delays: dlt('delays'), links: dlt('links'), cuts: dlt('cuts'), rests: dlt('rests'), hurt, modeT });
      // GCD_PGUARD=1: what the fairness guard would not let through (feints, faded marks, strikes
      // not called), each with the impact it collided with (brain.guardLog)
      if (process.env.GCD_PGUARD) {
        const tally = {};
        for (const e of d.brain.guardLog ?? []) if (e.t >= t0) tally[`${e.kind} ${e.what} x ${e.with}`] = (tally[`${e.kind} ${e.what} x ${e.with}`] || 0) + 1;
        out(`      P${ph} seed ${seed} guard: ${Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'}`);
      }
      // GCD_PATT=1: where the phase's time went, move by move (s in it, picks, its cues, cues a second)
      if (process.env.GCD_PATT) {
        const fl = {}, pk = {};
        for (const f of flashes) fl[f[2]] = (fl[f[2]] || 0) + 1;
        for (const w of acts) pk[w[1]] = (pk[w[1]] || 0) + 1;
        out(`      P${ph} seed ${seed}: ${Object.entries(spent).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(0)}s/${pk[k] ?? 0}x/${fl[k] ?? 0}c (${((fl[k] ?? 0) / v).toFixed(2)})`).join(' · ')}`);
      }
    }
  }
  out(`   ${SECS} s per phase, seeds ${SEEDS.join(', ')} · cues/min · longest gap (s) · moves · chained · longest chain · links · cuts · rests · conflicts · inner · field busy % · holds / feints (!n: told before the guard turned them) · delays · hits taken · category shares %`);
  out(`   seed ph cue/min gapMax moves chain cMax links cuts rest clash inner busy% hold/f delay hurt  ${CATS.map((c) => c.slice(0, 7).padStart(8)).join('')}`);
  for (const r of rows) {
    out(`   ${String(r.seed).padStart(4)}  ${r.ph} ${r.perMin.toFixed(1).padStart(7)} ${r.gapMax.toFixed(2).padStart(6)} ${String(r.picks).padStart(5)} ${String(r.chained).padStart(5)} ${String(r.chainMax).padStart(4)} ${String(r.links).padStart(5)} ${String(r.cuts).padStart(4)} ${String(r.rests).padStart(4)} ${String(r.conflicts).padStart(5)} ${String(r.inner).padStart(5)} ${(r.busy * 100).toFixed(0).padStart(5)} ${`${r.holds}/${r.feints}${r.told ? `!${r.told}` : ''}`.padStart(5)} ${String(r.delays).padStart(5)} ${String(r.hurt).padStart(4)}  ${CATS.map((c) => (((r.cats[c] || 0) * 100) / (r.picks || 1)).toFixed(0).padStart(8)).join('')}`);
    out(`         answers: dodge ${(r.dodge * 100).toFixed(0)} % of cues, longest run of one answer ${r.runMax} · burning ground alive ${(r.burn * 100).toFixed(0)} % of the time
         time: ${Object.entries(r.modeT).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${((v * 100) / r.T).toFixed(0)}%`).join(' · ')}`);
    out(`         longest gap at ${r.gapAt}${r.conflicts ? ` · CONFLICTS ${r.conflictAt.slice(0, 6).join(' · ')}` : ''}${r.inner ? ` · inner: ${r.innerAt.join(', ')}` : ''}`);
  }
  const mean = (ph, k) => { const rs = rows.filter((r) => r.ph === ph); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
  for (let ph = 1; ph <= NPH; ph++) out(`   mean P${ph}: ${mean(ph, 'perMin').toFixed(1)} cues/min · longest gap ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.gapMax)).toFixed(2)} s (mean ${mean(ph, 'gapMax').toFixed(2)}) · ${mean(ph, 'chained').toFixed(1)} chained of ${mean(ph, 'picks').toFixed(1)} moves · conflicts ${rows.filter((r) => r.ph === ph).reduce((a, r) => a + r.conflicts, 0)} · dodge ${(mean(ph, 'dodge') * 100).toFixed(0)} % · one-answer run max ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.runMax))} · burning ground ${(mean(ph, 'burn') * 100).toFixed(0)} %`);
  if (!P?.meter) { out('   (no TUNING.pressure.meter: measured only, nothing asserted)'); return lastG; }
  const A = P.meter;
  // (the tuning pass: `rampMean`, the ramp of the seeds' mean; per seed the floor is lower: phase 3 runs
  // at the 0.42 s / 0.32 s floors (~100 cues a minute) and one seed's phase 2 swings +-4 % about its
  // mean, so ten seeds held P3 / P2 at 1.04 - 1.15 per seed, 1.10 - 1.11 in the mean)
  if (A.rampMean) {
    for (let ph = 2; ph <= NPH; ph++) {
      const a0 = mean(ph - 1, 'perMin'), a1 = mean(ph, 'perMin');
      assert(a1 >= a0 * pp(A.rampMean, ph), `the seeds' mean: P${ph} at least x${pp(A.rampMean, ph)} P${ph - 1}'s cues a minute (${a0.toFixed(1)} → ${a1.toFixed(1)}, x${(a1 / a0).toFixed(3)})`);
    }
  }
  for (const seed of SEEDS) {
    const r = rows.filter((x) => x.seed === seed).sort((x, y) => x.ph - y.ph);
    for (let i = 1; i < r.length; i++) assert(r[i].perMin >= r[i - 1].perMin * pp(A.ramp, r[i].ph), `seed ${seed}: P${r[i].ph} at least x${pp(A.ramp, r[i].ph)} P${r[i - 1].ph}'s cues a minute (${r[i - 1].perMin.toFixed(1)} → ${r[i].perMin.toFixed(1)} cues/min)`);
    for (const x of r) {
      assert(x.perMin >= pp(A.minRate, x.ph), `seed ${seed} P${x.ph}: ${x.perMin.toFixed(1)} cues a minute >= ${pp(A.minRate, x.ph)}`);
      assert(x.gapMax <= pp(A.maxGap, x.ph), `seed ${seed} P${x.ph}: longest gap between cues ${x.gapMax.toFixed(2)} s <= ${pp(A.maxGap, x.ph)} s (${x.gapAt})`);
      assert(x.conflicts === 0, `seed ${seed} P${x.ph}: no two cues of different sources needing different answers within 0.3 s (${x.conflicts}: ${x.conflictAt.slice(0, 4).join(' · ')})`);
    }
  }
  return lastG;
}


// ================================================================== scenario: win
async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode, three seeds: parries, rolls, cuts him in his openings) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242,7,99').split(',').map(Number);
  // (the seeded fights replay with the flurry's passes as they were before the chain (2026-11-24,
  // STREAK_FX.chain): the chain ends each flurry somewhere else, the bot's fight then runs another way
  // and seeds 7 / 99 finished in 134 / 136 s, under the 140 s floor, with the same damage a flurry. The
  // window measures his fight, not where the hero's flurry ends; it already sat on its floor at 140 - 145 s)
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const chain0 = STREAK_FX.chain, dodge0 = STREAK_FX.dodgefx;
  STREAK_FX.chain = false;
  // (and the old riposte: the fight's length was set with the flurry answering each parry; the default deathblow, ADR-211, is a different pace)
  const RC = await imp('src/entities/player/riposteCut.js');
  RC.setRiposteMode('old');
  STREAK_FX.dodgefx = ''; // (likewise the dodge looks, 2026-11-25: the window measures his fight)
  try {
  for (const seed of SEEDS) {
    const G = build(seed, true);
    const MK = attachMarks(G.game); // (the floor marks the fight leaves: they change nothing in it)
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true });
    G.defend = makeDefender(G, { world: true });
    const phAt = [0];
    G.watch = (n) => { if (/^dragon:phase[23]$/.test(n)) phAt.push(game.time); };
    const t0 = game.time;
    const won = run(G, 480, () => fencer(G), () => d.mode === 'dead' || d.state === 'dead' || game.state === 'victory');
    const T = game.time - t0;
    const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
    out(`     seed ${seed}: ${won ? 'won' : 'NOT won'} in ${T.toFixed(0)} s: phases at ${phAt.map((t) => (t - t0 > 0 ? (t - t0).toFixed(0) : '0')).join(' / ')} s, ${taken} hits taken (god mode), crashes ${d.flight.stats.crashes} + skids ${d.flight.stats.skids}, returned ${d.glare.stats.returned}; phase ${d.phase}, hp ${Math.round(d.hp)}`);
    marksCheck(MK, 'city', out, assert);
    assert(won && d.phase === 3, `seed ${seed}: the fencing bot wins through all three phases`);
    // (130 since ADR-227: the bot's parries, pressed 0.12 s early, are perfect now (x 1.5 posture, the
    // counter cut, his glare returned): the three seeds won in 140 / 137 / 142 s instead of 140 - 145;
    // 120 since ADR-242: his thrown pieces land on the road, and from phase 2 the seeds part: 145 / 125 / 149 s,
    // the same mean as main's 149 / 137 / 141)
    const [lo, hi] = (process.env.GCD_WRANGE ?? '120,250').split(',').map(Number);
    assert(T > lo && T < hi, `seed ${seed}: the fight takes ${T.toFixed(0)} s (${lo} - ${hi})`);
  }
  } finally {
    STREAK_FX.chain = chain0;
    RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
    STREAK_FX.dodgefx = dodge0;
  }
}

// ================================================================== scenario: training
async function scenarioTraining() {
  out('\n== scenario TRAINING (every situation of the Training catalogue for this boss plays out and shows what it promises) ==');
  const G = build(SEED, true);
  const { game } = G;
  duel(G, { dist: 4 });
  const T = game.lab.training;
  const { bossKinds } = await imp('src/dev/training.js');
  const kinds = bossKinds(game);
  assert(kinds.has('halcyon') && !kinds.has('ash') && !kinds.has('lord') && !kinds.has('asc') && !kinds.has('fox') && kinds.has('duel'), `his own boss kind (${[...kinds].join(', ')})`);
  const only = process.env.GCD_TONLY?.split(',');
  const L = only ? only.map((id) => T.find(id)).filter(Boolean) : T.list();
  const bad = [];
  for (const s of L) {
    T.run(s.id);
    let frames = 0;
    while (T.ph !== 'done' && frames < Math.round(40 / DT)) { G.tick(DT); frames++; }
    const r = T.lastResult;
    const ok = T.ph === 'done' && r?.id === s.id && r.ok;
    if (!ok || process.env.GCD_TRACE) out(`   ${ok ? 'ok ' : 'BAD'} ${s.cat} · ${s.name}: ${T.ph} in ${(frames * DT).toFixed(1)} s · missing ${JSON.stringify(r?.missing ?? '?')} · hero ${game.player.state} · boss ${game.dragon.state}`);
    if (!ok) bad.push(s.id);
  }
  T.stop();
  assert((only || L.length >= 20) && !bad.length, `every situation plays out and shows what it promises (${L.length - bad.length} of ${L.length}${bad.length ? `; not: ${bad.join(', ')}` : ''})`);
  const G2 = build(SEED, true);
  duel(G2, { dist: 5 });
  const d2 = G2.game.dragon;
  const ok2 = d2.debug.phase2();
  run(G2, 8, null, () => d2.mode === 'foot');
  const ok3 = d2.debug.phase3();
  run(G2, 8, null, () => d2.mode === 'foot');
  assert(ok2 && ok3 && d2.phase === 3 && G2.counts['dragon:phase2'] === 1 && G2.counts['dragon:phase3'] === 1, 'the Lab phase buttons: Phase 2, then Phase 3, each its transition');
  // the Lab's own buttons for him
  const G3 = build(SEED, true);
  duel(G3, { dist: 5, form: 3 });
  const d3 = G3.game.dragon;
  G3.game.player.debug.god = true;
  const b = { pass: d3.debug.pass() };
  run(G3, 4, null, () => d3.mode === 'foot');
  b.cityPhase = d3.debug.cityPhase(2) === 2 && G3.game.world.forest.ambience.state.phase === 2;
  b.explode = d3.debug.explode(1) === 1;
  run(G3, 1.5);
  b.sky = d3.debug.fallingSky();
  run(G3, 5, null, () => d3.mode === 'foot');
  assert(Object.values(b).every(Boolean) && (G3.counts['world:blast'] ?? 0) >= 1, `the Lab: Pass, City phase, Explode, The Falling Sky (${JSON.stringify(b)})`);
}

// ================================================================== scenario: herolike (ADR-166)
async function scenarioHeroLike() {
  out("\n== scenario HEROLIKE (?halLetters= / ?halPrint= / ?halCapeSize=: printed like the hero, a smaller cape) ==");
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const LOOK = await imp('src/entities/enemies/halcyon/look.js');
  const { capeShape } = await imp('src/entities/enemies/halcyon/gear.js');
  const { Pipeline } = await imp('src/render/pipeline.js');
  const picks = { halLetters: 'a', halPrint: 'a', halCapeSize: 'b' };
  for (const [k, v] of Object.entries(picks)) assert(LS.PICKED?.[k] === v && !LS.PENDING.includes(k), `?${k}= is the owner's pick, ${v} (PICKED, not PENDING; 2026-11-23)`);
  const G = build();
  const d = G.game.dragon, kit = d.kit, on = {};
  for (const o of ['0', 'a']) { LS.setLook('halLetters', o); on[o] = !!kit.letters; }
  LS.setLook('halLetters', null);
  assert(kit.letters === LOOK.halLettersOn() && on.a === true && on['0'] === false, `his kit asks for letters that follow his size (default ${kit.letters}); ?halLetters=0 the fixed cell; live`);
  // the pipeline (a mock renderer), as asc.mjs herolike: his cell beside the hero's at the same depth
  const U = G.game.U, cam = G.game.camera;
  const renderer = {
    extensions: { has: () => true }, autoClear: true, _dpr: 1,
    setRenderTarget() {}, setClearColor() {}, getClearColor() {}, getClearAlpha: () => 0, clear() {}, render() {},
    setPixelRatio(x) { this._dpr = x; }, getPixelRatio() { return this._dpr; }, setSize() {},
  };
  const pipe = new Pipeline(renderer, G.game.scene, G.game.fxScene, cam, U);
  cam.fov = CONFIG.camera.fov;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const u = pipe.asciiMat.uniforms, ps = new THREE.Vector4();
  const cellsAt = (H, D, letters) => {
    pipe.setSize(Math.round((H * 16) / 9), H, 1);
    pipe.bossLetters = letters;
    U.uBossScreen.value.set(0.4, 0.5, D + cam.matrixWorld.elements[9], 1);
    ps.set(0.6, 0.5, D, 0);
    for (let i = 0; i < 3; i++) { pipe._updateHeroLetters(ps); pipe._updateBossLetters(U.uBossScreen.value); }
    return [u.uHeroCell.value.x, pipe.selfCell.x];
  };
  const rows = [];
  for (const [name, H, D] of [['phone', 393, 20], ['720p', 720, 36], ['1080p', 1080, 36], ['1440p', 1440, 36], ['4K', 2160, 36]]) {
    const [b, h] = cellsAt(H, D, true);
    const [b0] = cellsAt(H, D, false);
    rows.push(`${name} ${b0} -> ${b} / ${h}`);
    assert(b === h && b0 === pipe.heroCell.x, `${name} at ${D} m: his cell ${b} px is the hero's ${h} px (with ?halLetters=0 the fixed ${b0} px)`);
  }
  out("   his cell (fixed -> following) / the hero's: " + rows.join('; '));
  // the print: quieter fills, a softer edge on the suit; the cape's red and the gold kept bright enough
  const tint = (p) => {
    LS.setLook('halPrint', p);
    const g = build();
    LS.setLook('halPrint', null);
    const M = g.game.dragon.rig.materials;
    return { skin: M.skin.uniforms.uArtFill.value.r, suit: M.armor.uniforms.uArtFill.value.b, rim: M.armor.uniforms.uArtRim.value, red: M.lining.uniforms.uArtFill.value.r, gold: M.hair.uniforms.uArtFill.value.r };
  };
  const p0 = tint('0'), pa = tint('a'), pb = tint('b');
  assert(pa.skin < p0.skin * 0.7 && pa.suit < p0.suit && pa.rim < p0.rim * 0.6 && pb.skin > pa.skin && pb.skin < p0.skin && pb.rim > pa.rim && pb.rim < p0.rim,
    `the quieter print: skin ${p0.skin.toFixed(2)} / a ${pa.skin.toFixed(2)} / b ${pb.skin.toFixed(2)}, suit blue ${p0.suit.toFixed(2)} / ${pa.suit.toFixed(2)} / ${pb.suit.toFixed(2)}, rim ${p0.rim.toFixed(2)} / ${pa.rim.toFixed(2)} / ${pb.rim.toFixed(2)}`);
  assert(pa.red > 1.5 && pa.gold === p0.gold, `the cape's red (${pa.red.toFixed(2)}) and the gold (${pa.gold.toFixed(2)}) still lit in print a`);
  // the cape's size: shorter and narrower by its factor, the billow kept, the same five sheets
  const full = capeShape(3, 1), len = (C) => Math.max(...C.sheets.map((s) => s.len[0] + s.len[1])), wid = (C) => Math.max(...C.sheets.map((s) => s.w[2]));
  for (const [o, k] of Object.entries(LOOK.HAL_CAPE_SIZE)) {
    const C = capeShape(3, k);
    assert(C.sheets.length === 5 && Math.abs(len(C) - k * len(full)) < 1e-9 && Math.abs(wid(C) - k * wid(full)) < 1e-9 && C.breeze === full.breeze,
      `?halCapeSize=${o}: the cape ${(len(C)).toFixed(2)} m long, its widest hem ${wid(C).toFixed(2)} m (x${k}), the billow kept`);
  }
  for (const o of ['0', 'c']) {
    LS.setLook('halCapeSize', o);
    let meshes = 0, ok = true;
    try {
      const g = build();
      g.game.dragon.rig.root.traverse((m) => { if (m.isMesh) meshes++; });
      run(g, 0.5);
    } catch (e) { ok = false; out(`     ${o}: ${e.message}`); }
    assert(ok && meshes === 90, `?halCapeSize=${o} builds, the same ${meshes} meshes (no new object on his rig)`);
  }
  LS.setLook('halCapeSize', null);
}

// ================================================================== scenario: looks
async function scenarioLooks() {
  out('\n== scenario LOOKS (each ?halLook= / ?halCape= / ?glare= / ?city= builds; all four are the owner\'s picks, in PICKED) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const PICK = LS.PICKED ?? {};
  assert(PICK.halLook === 'a' && !LS.PENDING.includes('halLook'), '?halLook= is the owner\'s pick, a (PICKED, not PENDING; 2026-11-23)');
  assert(PICK.city === 'a' && !LS.PENDING.includes('city'), '?city= is the owner\'s pick, a, Neon Rain (PICKED, not PENDING; 2026-11-23)');
  assert(PICK.glare === 'a' && !LS.PENDING.includes('glare'), '?glare= is the owner\'s pick, a, crimson with a white-hot core (PICKED, not PENDING; 2026-11-23)');
  const { isDragonLook } = await imp('src/entities/enemies/ashDisciple/bodyArt.js');
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('halLook', v);
    let ok = true, meshes = 0, ink = false;
    try {
      const G = build();
      const d = G.game.dragon;
      d.rig.root.traverse((o) => { if (o.isMesh) meshes++; });
      ink = !isDragonLook(d.rig.materials);
      run(G, 0.3);
    } catch (e) { ok = false; out(`     ${v}: ${e.message}`); }
    assert(ok && meshes > 20 && ink, `?halLook=${v} builds in the ink-line art (${meshes} meshes)`);
  }
  LS.setLook('halLook', null);
  // ?halCape= (ADR-164): every step builds the same five sheets (no new object on his rig: the seeded
  // fights stay put); 1 and up brighten the cape, 2 and up widen it, 3 alone billows
  {
    const { HAL_CAPE_STEP } = await imp('src/entities/enemies/halcyon/look.js');
    const { HAL_CAPE } = await imp('src/entities/enemies/halcyon/gear.js');
    assert(PICK.halCape === '3' && !LS.PENDING.includes('halCape'), '?halCape= is the owner\'s pick, 3 (PICKED, not PENDING; 2026-11-23)');
    const seen = {};
    LS.setLook('halCapeSize', '0'); // (the cape at the size the steps were built at)
    for (const v of ['0', '1', '2', '3']) {
      LS.setLook('halCape', v);
      let ok = true, meshes = 0, S = [], red = 0;
      try {
        const G = build();
        const d = G.game.dragon;
        d.rig.root.traverse((o) => { if (o.isMesh) meshes++; });
        S = d.rig.streamers ?? [];
        red = d.rig.materials.lining.uniforms.uArtFill.value.r;
        run(G, 0.5);
        ok = Number.isFinite(d.position.x) && S.every((st) => st.segs.every((j) => Number.isFinite(j.rotation.x + j.rotation.z)));
      } catch (e) { ok = false; out(`     halCape ${v}: ${e.message}`); }
      const w = Math.max(...S.map((st) => st.w?.[2] ?? 0));
      seen[v] = { meshes, w, red };
      const shape = v < '2' ? w === Math.max(...HAL_CAPE.map((d) => d.w[2])) : w > Math.max(...HAL_CAPE.map((d) => d.w[2]));
      const breeze = v === '3' ? S.every((st) => Array.isArray(st.breeze)) : S.every((st) => !st.breeze);
      assert(ok && S.length === 5 && shape && breeze, `?halCape=${v} builds five sheets (widest hem ${w.toFixed(2)} m, lining red ${red.toFixed(2)}, ${meshes} meshes, billow ${v === '3'})`);
    }
    assert(seen['0'].meshes === seen['3'].meshes && seen['1'].red > seen['0'].red, `the steps keep his mesh count (${seen['0'].meshes} / ${seen['3'].meshes}) and from 1 on light the cape's inside`);
    LS.setLook('halCape', null);
    LS.setLook('halCapeSize', null);
    assert(String(HAL_CAPE_STEP) === LS.lookOf('halCape', HAL_CAPE_STEP), `no ?halCape= draws step ${HAL_CAPE_STEP}`);
  }
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('glare', v);
    const G = build();
    assert(G.game.dragon.fx.glareLook === v, `?glare=${v}`);
  }
  LS.setLook('glare', null);
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('city', v);
    let ok = true;
    try {
      const G = build(SEED, true);
      ok = G.game.world.forest.option === v;
      run(G, 0.5);
    } catch (e) { ok = false; out(`     ${v}: ${e.message}`); }
    assert(ok, `?city=${v} builds`);
  }
  LS.setLook('city', null);
}

// ================================================================== scenario: audit (opt-in)
/**
 * AUDIT (opt-in, asc.mjs AUDIT's measure for him): every move run once (AI off, the hero still in front
 * of him at the middle of its band, then circling him at 3.5 m/s), his joints tracked frame by frame in
 * his own frame and round his root: the largest one-frame jolts (second difference, mm a frame²) and where
 * they fall, the fastest turn of his facing, his facing off the hero at each blow (deg), how far his feet
 * hang below his root at each blow (a planted stance in the air reads ~0.85 m: his legs standing on
 * nothing) and his root's height, the joints' range, and how far each blow's limb stops from the hero.
 * He flies: a frame is left out only where his root jumps (a blink) or a pass carries him (> 9 m/s).
 * GCD_AUDIT=name,name runs only those; GCD_AUDIT_TOP=n lists the n worst frames of each move;
 * GCD_AUDIT_JSON=file writes the rows.
 */
function auditMoves(names, orbits = [false, true], TOP = 0) {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const DEG = 180 / Math.PI;
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ang3 = (a, b, c) => {
    const u = new THREE.Vector3().subVectors(a, b).normalize(), w = new THREE.Vector3().subVectors(c, b).normalize();
    return Math.acos(clamp(u.dot(w), -1, 1)) * DEG;
  };
  const PTS = ['fistR', 'fistL', 'elbowR', 'elbowL', 'kneeR', 'kneeL', 'footR', 'footL', 'head', 'chest', 'pelvis'];
  // (ADR-254, the anatomy at a blow's contact: the striking arm's reach (shoulder → fist over the arm's
  // length) and its line against the line from the shoulder to the hero's chest, both knees, a kick's
  // reach, each foot's trail behind the hip (his own frame: + ahead) and the body line (pelvis → chest
  // from vertical, + leaning in))
  // (ADR-254, the anatomy at a blow's contact, in his UPRIGHT frame: the drawn body is sheared toward the
  // camera (duelist.js lean), so world points read a straight punch 20 - 40° off the hero. The striking
  // arm's reach (shoulder → fist over the arm's length) and its line against the line from the shoulder to
  // the hero's chest (`offAz` across, + his left; `offEl` up), both knees, a kick's reach, each foot's
  // trail behind its hip (+ ahead), the body line (pelvis → chest from vertical, + leaning in), the fist's
  // height (upright, world m))
  const limbsAt = (sm, D, pp) => {
    const B = sm.B, part = D.part ?? 'fistR';
    const kick = /^foot/.test(part), L = part === 'fistL' || part === 'footL';
    const sh = B[L ? 'shL' : 'shR'], el = B[L ? 'elbowL' : 'elbowR'], fi = B[L ? 'fistL' : 'fistR'];
    const armLen = sh.distanceTo(el) + el.distanceTo(fi);
    // (the hero's chest into his root frame, upright: the root's place, its yaw, its scale)
    const sc = sm.W.hipR.distanceTo(sm.W.hipL) / Math.max(1e-6, B.hipR.distanceTo(B.hipL));
    const rp = new THREE.Vector3().setFromMatrixPosition(sm.rootM), dx = pp.x - rp.x, dz = pp.z - rp.z, cy = Math.cos(sm.yaw), sy = Math.sin(sm.yaw);
    const hero = new THREE.Vector3((dx * cy - dz * sy) / sc, (1.4 - rp.y) / sc, (dx * sy + dz * cy) / sc);
    const toFist = new THREE.Vector3().subVectors(fi, sh), toHero = hero.sub(sh);
    const hip = B[L ? 'hipL' : 'hipR'], kn = B[L ? 'kneeL' : 'kneeR'], ft = B[L ? 'footL' : 'footR'];
    const legLen = hip.distanceTo(kn) + kn.distanceTo(ft);
    const bodyLine = Math.atan2(B.chest.z - B.pelvis.z, B.chest.y - B.pelvis.y) * DEG;
    const az = (v) => Math.atan2(v.x, v.z), el2 = (v) => Math.atan2(v.y, Math.hypot(v.x, v.z));
    return {
      reach: +(kick ? hip.distanceTo(ft) / legLen : sh.distanceTo(fi) / armLen).toFixed(2),
      offLine: kick ? null : Math.round(toFist.angleTo(toHero) * DEG),
      offAz: kick ? null : Math.round(wrapA(az(toFist) - az(toHero)) * DEG),
      offEl: kick ? null : Math.round((el2(toFist) - el2(toHero)) * DEG),
      kneeR: Math.round(ang3(B.hipR, B.kneeR, B.footR)), kneeL: Math.round(ang3(B.hipL, B.kneeL, B.footL)),
      trailR: +(B.footR.z - B.hipR.z).toFixed(2), trailL: +(B.footL.z - B.hipL.z).toFixed(2),
      bodyLine: Math.round(bodyLine), fistY: +(rp.y + fi.y * sc).toFixed(2),
    };
  };
  const sample = (d) => {
    const R = d.rig;
    R.root.updateMatrixWorld(true);
    inv.copy(R.root.matrixWorld).invert();
    const at = (o, x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
    const W = {
      fistR: at(R.sword), fistL: at(R.arms.L.wrist ?? R.arms.L.fore), elbowR: at(R.arms.R.fore), elbowL: at(R.arms.L.fore),
      shR: at(R.arms.R.upper), shL: at(R.arms.L.upper), hipR: at(R.legs.R.thigh), hipL: at(R.legs.L.thigh),
      kneeR: at(R.legs.R.shin), kneeL: at(R.legs.L.shin), footR: at(R.legs.R.foot), footL: at(R.legs.L.foot),
      head: at(R.head, 0, 0.1, 0), chest: at(R.chest, 0, 0.12, 0), pelvis: at(R.pelvis),
    };
    const B = {}, Wr = {};
    const root = new THREE.Vector3().setFromMatrixPosition(R.root.matrixWorld);
    for (const k in W) {
      B[k] = W[k].clone().applyMatrix4(inv);
      Wr[k] = W[k].clone().sub(root);
    }
    return { W, B, Wr, inv: inv.clone(), rootM: R.root.matrixWorld.clone(), yaw: d.yaw, x: d.position.x, z: d.position.z, y: d.position.y };
  };
  const phaseOf = (a, t) => {
    for (const b of a.beats) {
      if (t < b.start) continue;
      if (t < b.impact - 0.12) return `b${b.index ?? a.beats.indexOf(b)} windup`;
      if (t <= b.impact + 0.06) return `b${b.index ?? a.beats.indexOf(b)} strike`;
      if (t <= b.end + 1e-6) return `b${b.index ?? a.beats.indexOf(b)} active`;
    }
    return t < (a.recoveryStart ?? a.end) ? 'follow' : 'recovery';
  };
  const rows = [], worst = [];
  for (const orbit of orbits) {
    for (const name of names) {
      const def = MOVES[name];
      if (def.transition) continue;
      const f = phasesOf(name)[0] ?? def.phase ?? 1;
      const G = build();
      const band = def.band ?? [0, 4];
      const dist = clamp((band[0] + Math.min(band[1], 8)) / 2, 1.6, 7);
      duel(G, { dist, form: Math.max(1, f) });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      settle(G, 2);
      d.position.set(0, d.T.fly.hover, 0);
      d.yaw = Math.PI / 2;
      p.debug.teleport(dist, 0);
      run(G, 0.7);
      if (!d.debug.trigger(name)) { rows.push({ name, orbit, fail: 'trigger' }); continue; }
      const A = d.brain.act;
      const F = [];
      let after = -1, th = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z), px = d.position.x, pz = d.position.z, py = d.position.y;
      const contact = [];
      for (let i = 0; i < 1500; i++) {
        if (orbit) {
          th += (3.5 / Math.max(1.5, dist)) * DT;
          p.debug.teleport(d.position.x + Math.sin(th) * dist, d.position.z + Math.cos(th) * dist);
        }
        p.hp = p.maxHp;
        const inAct = d.brain.act === A;
        if (!inAct && after < 0) after = 0;
        if (after >= 0 && after++ > 14) break;
        const s = sample(d);
        s.t = inAct ? A.t : A.end + after * DT;
        s.ph = inAct ? phaseOf(A, A.t) : 'blend out';
        const sp = Math.hypot(d.position.x - px, d.position.z - pz, d.position.y - py) / DT;
        s.jump = sp * DT > 0.4;
        s.air = s.jump || sp > 9;
        px = d.position.x;
        pz = d.position.z;
        py = d.position.y;
        F.push(s);
        if (inAct) for (const b of A.beats) {
          if (b.feint || b._aud || A.t < b.impact || !b.def.zone || b.def.cast || b.def.halGlare) continue;
          b._aud = true;
          const tp = d._tip, pp = p.position, pr = p.radius ?? 0.45;
          const flat = Math.hypot(tp.x - pp.x, tp.z - pp.z) - pr;
          const face = Math.abs(wrapA(d.yaw - Math.atan2(pp.x - d.position.x, pp.z - d.position.z))) * DEG;
          const sm = sample(d), arm = b.def.part === 'fistL' ? ['shL', 'elbowL', 'fistL'] : ['shR', 'elbowR', 'fistR'];
          const hang = d.position.y - Math.min(sm.W.footR.y, sm.W.footL.y);
          contact.push({ i: b.index ?? A.beats.indexOf(b), part: b.def.part, tell: b.def.tell, gap: flat, y: tp.y, sep: +Math.hypot(pp.x - d.position.x, pp.z - d.position.z).toFixed(2), reachX: +Math.hypot(tp.x - d.position.x, tp.z - d.position.z).toFixed(2), feetZ: +(Math.max(sm.B.footR.z, sm.B.footL.z) - sm.B.pelvis.z).toFixed(2), side: +(((tp.x - d.position.x) * (pp.z - d.position.z) - (tp.z - d.position.z) * (pp.x - d.position.x)) / Math.max(0.01, Math.hypot(pp.x - d.position.x, pp.z - d.position.z))).toFixed(2), face: Math.round(face), root: +d.position.y.toFixed(2),
            hang: +hang.toFixed(2), feetLow: +Math.min(sm.W.footR.y, sm.W.footL.y).toFixed(2), elbow: Math.round(ang3(sm.B[arm[0]], sm.B[arm[1]], sm.B[arm[2]])), ...limbsAt(sm, b.def, pp) });
        }
        G.tick(DT);
      }
      let pb = { v: 0 }, pw = { v: 0 }, out1 = { v: 0 }, in1 = { v: 0 };
      const jolts = [];
      for (let i = 2; i < F.length; i++) {
        if (F[i].air || F[i - 1].air || F[i - 2].air) continue;
        for (const k of PTS) {
          const jb = v.copy(F[i].B[k]).addScaledVector(F[i - 1].B[k], -2).add(F[i - 2].B[k]).length() * 1000;
          const jw = v.copy(F[i].Wr[k]).addScaledVector(F[i - 1].Wr[k], -2).add(F[i - 2].Wr[k]).length() * 1000;
          const j = Math.max(jb, jw);
          jolts.push({ j, k, t: F[i].t, ph: F[i].ph, w: jw > jb });
          if (jb > pb.v) pb = { v: jb, k, t: F[i].t, ph: F[i].ph };
          if (jw > pw.v) pw = { v: jw, k, t: F[i].t, ph: F[i].ph };
          if (F[i].ph === 'blend out' && j > out1.v) out1 = { v: j, k };
          if (i < 12 && j > in1.v) in1 = { v: j, k };
        }
      }
      jolts.sort((a, b) => b.j - a.j);
      let yawR = 0, yawAt = '';
      for (let i = 1; i < F.length; i++) {
        if (F[i].jump) continue;
        const r = Math.abs(wrapA(F[i].yaw - F[i - 1].yaw)) / DT * DEG;
        if (r > yawR) { yawR = r; yawAt = F[i].ph; }
      }
      let elbow = 180, knee = 180, yMin = 9, yMax = -9, hangMin = 9, hangMax = -9;
      for (const s of F) {
        elbow = Math.min(elbow, ang3(s.B.shR, s.B.elbowR, s.B.fistR), ang3(s.B.shL, s.B.elbowL, s.B.fistL));
        knee = Math.min(knee, ang3(s.B.hipR, s.B.kneeR, s.B.footR), ang3(s.B.hipL, s.B.kneeL, s.B.footL));
        yMin = Math.min(yMin, s.y);
        yMax = Math.max(yMax, s.y);
        const h = -Math.min(s.Wr.footR.y, s.Wr.footL.y);
        hangMin = Math.min(hangMin, h);
        hangMax = Math.max(hangMax, h);
      }
      // (ADR-254: in flight, frames over 9 m/s: the knees' least angle and the body line's range)
      let flyKnee = 180, flyLine = [99, -99], nFly = 0;
      for (const s of F) {
        if (!s.air || s.jump) continue;
        nFly++;
        flyKnee = Math.min(flyKnee, ang3(s.B.hipR, s.B.kneeR, s.B.footR), ang3(s.B.hipL, s.B.kneeL, s.B.footL));
        const bl = Math.atan2(s.B.chest.z - s.B.pelvis.z, s.B.chest.y - s.B.pelvis.y) * DEG;
        flyLine = [Math.min(flyLine[0], bl), Math.max(flyLine[1], bl)];
      }
      rows.push({ name, orbit, f, dist: +dist.toFixed(1), frames: F.length, fly: nFly ? { n: nFly, knee: Math.round(flyKnee), line: flyLine.map(Math.round) } : null, pb, pw, out: out1, in: in1, yawR: Math.round(yawR), yawAt, elbow: Math.round(elbow), knee: Math.round(knee),
        yMin: +yMin.toFixed(2), yMax: +yMax.toFixed(2), hangMin: +hangMin.toFixed(2), hangMax: +hangMax.toFixed(2), contact });
      if (TOP) worst.push(`   ${name}${orbit ? ' (orbit)' : ''}: ` + jolts.filter((x, i, L) => L.findIndex((y) => y.k === x.k && Math.abs(y.t - x.t) < 0.05) === i).slice(0, TOP).map((x) => `${x.k} ${Math.round(x.j)}${x.w ? 'w' : ''} @${x.t.toFixed(2)} ${x.ph}`).join(' · '));
    }
  }
  return { rows, worst };
}

async function scenarioAudit() {
  out('\n== scenario AUDIT (every move: jolts, turns, his facing and legs at each blow, joints, the blow against the hero) ==');
  // (GCD_LOOK='ascMotion=a,halMotion=a': the looks the audit plays, live)
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const kv of (process.env.GCD_LOOK ?? '').split(',').filter(Boolean)) LS.setLook(...kv.split('='));
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const TOP = Number(process.env.GCD_AUDIT_TOP ?? 0);
  const { rows, worst } = auditMoves(MOVE_NAMES.filter((n) => !only.length || only.includes(n)), [false, true], TOP);
  const fmt = (o) => (o.v ? `${Math.round(o.v)} ${o.k} ${o.ph ?? ''}`.trim() : '-');
  out('   move             f orbit jolt(own frame)                 jolt(world)                     blend-in    blend-out    turn°/s (when)        elbow knee  root y     feet below root  per blow: part tell gap-m face° hang-m');
  for (const r of rows) {
    if (r.fail) { out(`   ${r.name} FAIL ${r.fail}`); continue; }
    const c = r.contact.map((x) => `${x.part}/${x.tell}:${x.gap.toFixed(2)}/${x.face}°/${x.hang.toFixed(2)}`).join(' ');
    out(`   ${r.name.padEnd(16)} ${r.f} ${r.orbit ? 'yes' : '   '}   ${fmt(r.pb).padEnd(31)} ${fmt(r.pw).padEnd(31)} ${fmt(r.in).padEnd(11)} ${fmt(r.out).padEnd(12)} ${String(r.yawR).padStart(5)} (${r.yawAt})`.padEnd(150) + ` ${String(r.elbow).padStart(4)} ${String(r.knee).padStart(4)}  ${r.yMin.toFixed(2)}-${r.yMax.toFixed(2)}  ${r.hangMin.toFixed(2)}-${r.hangMax.toFixed(2)}   ${c}`);
  }
  if (TOP) for (const w of worst) out(w);
  // (GCD_AUDIT_IMPACT=1, ADR-254: the anatomy at every blow's contact, and in flight)
  if (process.env.GCD_AUDIT_IMPACT) {
    out('   at the contact: move #blow part/tell  elbow reach offLine°  knees R/L  feet trail R/L (m, + ahead)  body line°  fist y');
    for (const r of rows) {
      if (r.fail || r.orbit) continue;
      for (const c of r.contact) out(`     ${r.name.padEnd(15)} #${c.i} ${String(c.part).padEnd(6)} ${String(c.tell).padEnd(6)} ${String(c.elbow).padStart(4)} ${c.reach.toFixed(2)} ${String(c.offLine ?? '-').padStart(4)} (${c.offAz ?? '-'}/${c.offEl ?? '-'})  ${c.kneeR}/${c.kneeL}   ${c.trailR}/${c.trailL}   ${c.bodyLine}   ${c.fistY}`);
      if (r.fly) out(`     ${r.name.padEnd(15)} in flight (${r.fly.n} frames): least knee ${r.fly.knee}°, body line ${r.fly.line[0]}..${r.fly.line[1]}°`);
    }
  }
  const J = process.env.GCD_AUDIT_JSON;
  if (J) fs.writeFileSync(J, JSON.stringify(rows, null, 1));
}

/**
 * HALMOTION (ADR-225, `?halMotion=a`): the switch moves poses and his height only: every move realises
 * with the same beats, windups, impacts and flashes on and off. On (AUDIT's measure), a builder's blow
 * meets the hero's chest and head instead of the air over him (the fist under 1.75 m, it was 1.9 - 2.0),
 * with the arm open (>= 145°, it was ~130°), his root dipped toward the hero, and his feet trailing behind
 * his hips (a flier's), never a planted stance; the snap blows are weighed only with the switch.
 */
async function scenarioHalMotion() {
  out('\n== scenario HALMOTION (?halMotion=a: the same timings; blows at the hero\'s height, open arms, a flier\'s legs; the snap blows) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  let n = 0;
  const diff = [];
  for (const name of MOVE_NAMES) for (let ph = 1; ph <= 3; ph++) for (const r of [0.001, 0.5, 0.999]) {
    LS.setLook('halMotion', '0');
    const a = realise(name, ph, () => r);
    LS.setLook('halMotion', 'a');
    const b = realise(name, ph, () => r);
    if (!a || !b) continue;
    n++;
    const sig = (m) => m.beats.map((x) => [x.start, x.impact, x.end, x.flash, x.W, x.H].map((v) => v.toFixed(5)).join(',')).join(';') + `|${m.end.toFixed(5)}`;
    if (sig(a) !== sig(b)) diff.push(`${name}/${ph}`);
  }
  assert(n > 150 && !diff.length, `${n} realisations: the same beats, windups, impacts, flashes and ends with the switch on and off (${diff.slice(0, 6).join(', ') || 'all'})`);
  const names = ['meetAndGreet', 'backhand', 'riposte', 'flick', 'tap'];
  const res = {};
  for (const opt of ['0', 'a']) {
    LS.setLook('halMotion', opt);
    res[opt] = auditMoves(names, [false]).rows.flatMap((r) => r.contact.filter((c) => c.part !== 'palms' || true).map((c) => ({ ...c, name: r.name })));
  }
  LS.setLook('halMotion', null);
  const fmt = (L, k) => L.map((c) => (typeof c[k] === 'number' ? +c[k].toFixed(2) : c[k])).join(', ');
  out(`   fist height at the blow:  before ${fmt(res['0'], 'y')}  after ${fmt(res.a, 'y')}`);
  out(`   elbow at the blow (deg):  before ${fmt(res['0'], 'elbow')}  after ${fmt(res.a, 'elbow')}`);
  out(`   his root at the blow (m): before ${fmt(res['0'], 'root')}  after ${fmt(res.a, 'root')}`);
  out(`   feet ahead of his hips:   before ${fmt(res['0'], 'feetZ')}  after ${fmt(res.a, 'feetZ')}`);
  const A = res.a, fists = A.filter((c) => c.part !== 'palms');
  assert(A.length >= 7 && A.every((c) => c.y < 1.75), `with the switch every blow meets the hero under 1.75 m (${fmt(A, 'y')}; before ${fmt(res['0'], 'y')})`);
  assert(fists.every((c) => c.elbow >= 145), `... the punching arm open at the blow, >= 145° (${fmt(fists, 'elbow')}; before ${fmt(res['0'].filter((c) => c.part !== 'palms'), 'elbow')})`);
  assert(A.every((c) => c.root <= 0.35), `... his root dipped from the hover toward the hero (${fmt(A, 'root')} m)`);
  assert(A.every((c) => c.feetZ < -0.05) && res['0'].some((c) => c.feetZ > -0.05), `... both feet trailing behind his hips, a flier's legs (${fmt(A, 'feetZ')} m; before a planted stance: ${fmt(res['0'], 'feetZ')})`);
  // the snap blows
  const snaps = MOVE_NAMES.filter((k) => MOVES[k].snap);
  const G = build();
  duel(G, { dist: 1.8 });
  const d = G.game.dragon;
  LS.setLook('halMotion', '0');
  const w0 = snaps.map((k) => d.weigh(k, MOVES[k], 1));
  LS.setLook('halMotion', 'a');
  const w1 = snaps.map((k) => d.weigh(k, MOVES[k], 1));
  LS.setLook('halMotion', null);
  assert(snaps.length === 2 && w0.every((w) => w === 0) && w1.every((w) => w > 0), `the snap blows (${snaps.join(', ')}) weigh 0 without the switch, ${w1.join(', ')} with it`);
}

/**
 * LIMBS (ADR-254, `?halMotion=b`): the flier's limbs only move poses: every move realises with `a`'s beats,
 * windups, impacts and flashes. On the rig (AUDIT's measure, in his upright frame): every straight blow
 * lands within 12° of the line from its shoulder to the hero's upper chest (`a`: 35 - 66° across) with the
 * elbow >= 160°; a kick lands with the striking knee >= 165° and the other leg hanging long (>= 140°); at
 * every punch both knees >= 130° (`a`: 67 - 135°, folded under him); the pass flies level (the body line
 * >= 65°) with the fist under 1.8 m (`a`: 2.56 m, over the hero's head); the animator's reach opened, a
 * kick's stretch only through a kick.
 */
async function scenarioLimbs() {
  out("\n== scenario LIMBS (?halMotion=b: the same timings; straight blows on the line, straight kicks, a flier's long legs, a level pass) ==");
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  let n = 0;
  const diff = [];
  for (const name of MOVE_NAMES) for (let ph = 1; ph <= 3; ph++) for (const r of [0.001, 0.5, 0.999]) {
    LS.setLook('halMotion', 'a');
    const a = realise(name, ph, () => r);
    LS.setLook('halMotion', 'b');
    const b = realise(name, ph, () => r);
    if (!a || !b) continue;
    n++;
    const sig = (m) => m.beats.map((x) => [x.start, x.impact, x.end, x.flash, x.W, x.H].map((v) => v.toFixed(5)).join(',')).join(';') + `|${m.end.toFixed(5)}`;
    if (sig(a) !== sig(b)) diff.push(`${name}/${ph}`);
  }
  assert(n > 150 && !diff.length, `${n} realisations: the same beats, windups, impacts, flashes and ends as a (${diff.slice(0, 6).join(', ') || 'all'})`);
  LS.setLook('halMotion', 'b');
  const rows = auditMoves(['meetAndGreet', 'backhand', 'tap', 'riposte', 'streakFlurry', 'flyBy', 'blink'], [false]).rows;
  LS.setLook('halMotion', null);
  const C = rows.flatMap((r) => r.contact.map((c) => ({ ...c, name: r.name })));
  const STRAIGHT = new Set(['meetAndGreet', 'backhand', 'tap', 'riposte']);
  const straight = C.filter((c) => STRAIGHT.has(c.name) || (c.name === 'blink' && c.i !== 1 && c.i !== 3) || (c.name === 'streakFlurry' && c.i === 0));
  const kicks = C.filter((c) => /^foot/.test(c.part));
  const punches = C.filter((c) => !/^foot/.test(c.part) && !/^flyBy/.test(c.name));
  const passes = C.filter((c) => /^flyBy/.test(c.name));
  const fmt = (L, f) => L.map(f).join(', ');
  assert(straight.length >= 9 && straight.every((c) => c.offLine <= 12 && c.elbow >= 160), `every straight blow on the line to the hero, <= 12°, the elbow >= 160° (${fmt(straight, (c) => `${c.offLine}°/${c.elbow}°`)})`);
  assert(kicks.length >= 2 && kicks.every((c) => (c.part === 'footR' ? c.kneeR : c.kneeL) >= 165 && (c.part === 'footR' ? c.kneeL : c.kneeR) >= 140), `a kick lands straight, the other leg hanging long (${fmt(kicks, (c) => `${c.kneeR}/${c.kneeL}`)})`);
  assert(punches.every((c) => c.kneeR >= 130 && c.kneeL >= 130), `at every punch the legs long, both knees >= 130° (${fmt(punches, (c) => `${c.kneeR}/${c.kneeL}`)})`);
  assert(passes.length >= 1 && passes.every((c) => c.bodyLine >= 65 && c.fistY < 1.8), `the pass flies level through the hero's chest (body line ${fmt(passes, (c) => `${c.bodyLine}°`)}, fist ${fmt(passes, (c) => c.fistY)} m)`);
  // the animator: opened under b, a kick's stretch only in a kick
  const G = build();
  duel(G, { dist: 1.8 });
  const d = G.game.dragon;
  LS.setLook('halMotion', 'b');
  d.debug.setAI(false);
  d.brain.trigger('meetAndGreet');
  run(G, 0.3);
  const k0 = d.anim.kickStretch, s0 = d.anim.armSoft?.[1];
  LS.setLook('halMotion', 'a');
  run(G, 0.05);
  const s1 = d.anim.armSoft?.[1];
  LS.setLook('halMotion', null);
  assert(k0 === null && s0 === TUNING.motion.b.armSoft[1] && s1 === TUNING.motion.armSoft[1], `the animator: b's reach (${s0}), a's back live (${s1}); no kick stretch in a punch (${k0})`);
}

/**
 * READABLE (ADR-254, `?halPace=a`): COMBAT.md rule 10's floor: a move's first real blow winds up >= 0.7 s
 * x the phase's windupScale, every later one lands >= 0.45 s after the one before, the cue 0.35 s before
 * the impact; the snap blows and the transitions as they were; only holds grow (a blow's own windup, its
 * active frames never change). Off ('0'), every realisation is as before.
 */
async function scenarioReadable() {
  out("\n== scenario READABLE (?halPace=a: rule 10's floor; off as before) ==");
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const P = TUNING.pace, bad = [], grew = [];
  let n = 0;
  for (const name of MOVE_NAMES) for (let ph = 1; ph <= 3; ph++) {
    const r = () => 0.5;
    LS.setLook('halPace', '0');
    const a = realise(name, ph, r);
    LS.setLook('halPace', 'a');
    const b = realise(name, ph, r);
    if (!a || !b) continue;
    n++;
    if (b.def.snap || b.def.transition) {
      if (b.end !== a.end) bad.push(`${name}/${ph} moved`);
      continue;
    }
    const ws = Array.isArray(TUNING.windupScale) ? TUNING.windupScale[ph - 1] : TUNING.windupScale;
    let last = null;
    b.beats.forEach((x, i) => {
      const y = a.beats[i];
      if (Math.abs(x.W - y.W) > 1e-6 || Math.abs(x.A - y.A) > 1e-6 || x.H < y.H - 1e-6) bad.push(`${name}/${ph} #${i} windup/active changed`);
      if (x.H > y.H + 1e-6) grew.push(`${name}/${ph}#${i}`);
      if (x.feint || !(x.def.damage > 0)) return;
      if (last === null && x.impact - x.start < P.first * ws - 1e-4) bad.push(`${name}/${ph} first ${(x.impact - x.start).toFixed(2)}`);
      if (last !== null && x.impact - last < P.gap - 1e-4) bad.push(`${name}/${ph} #${i} gap ${(x.impact - last).toFixed(2)}`);
      if (Math.abs(x.impact - x.flash - Math.min(P.flashLead, x.impact - x.tellAt)) > 1e-4) bad.push(`${name}/${ph} #${i} cue ${(x.impact - x.flash).toFixed(2)}`);
      last = x.impact;
    });
  }
  LS.setLook('halPace', null);
  assert(n > 60 && !bad.length, `${n} realisations under the pace: first blows >= ${P.first} s x windupScale, blows >= ${P.gap} s apart, the cue ${P.flashLead} s before (${bad.slice(0, 6).join('; ') || 'all'})`);
  out(`   held longer: ${grew.length} beats (${grew.slice(0, 10).join(', ')} ...)`);
  assert(grew.length > 5, 'the pace holds some blows longer (a held cock)');
}

const S = {
  smoke: scenarioSmoke,
  audit: scenarioAudit,
  halmotion: scenarioHalMotion,
  limbs: scenarioLimbs,
  readable: scenarioReadable,
  levels: scenarioLevels,
  data: scenarioData,
  timing: scenarioTiming,
  flight: scenarioFlight,
  glare: scenarioGlare,
  pass: scenarioPass,
  car: scenarioCar,
  tower: scenarioTower,
  statue: scenarioStatue,
  grab: scenarioGrab,
  phase: scenarioPhase,
  flow: scenarioFlow,
  pace: scenarioPace,
  win: scenarioWin,
  training: scenarioTraining,
  looks: scenarioLooks,
  herolike: scenarioHeroLike,
};
// (the bench, tests/integration/bench.mjs: the same mortal bots as veil.mjs, opt-in)
S.bench = async () => { const { benchScenario } = await import('./bench.mjs'); return benchScenario({ build, duel, run, TUNING, TELL, DT, THREE, out, mulberry32 }, 'city'); };
const OPT_IN = new Set(['smoke', 'audit', 'bench']);
// GCD_SKIP (a comma list) leaves scenarios out of `all` (tests/run.mjs runs pace and win as processes of their own)
const SKIP = new Set((process.env.GCD_SKIP ?? '').split(',').map((x) => x.trim()).filter(Boolean));
const list = SCEN === 'all' ? Object.keys(S).filter((k) => !OPT_IN.has(k) && !SKIP.has(k)) : SCEN.split(',');
for (const k of list) {
  if (!S[k]) { out(`unknown scenario ${k}`); process.exit(2); }
  await S[k]();
}
const notCat = [...EMITTED].filter((n) => !CATALOGUE.has(n) && n !== 'state');
assert(!notCat.length, `every event this level emits is in the catalogue ${JSON.stringify(notCat)}`);
out(`\n\nconsole errors/warnings: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : ''}`);
if (errors.length) fails++;
out(fails ? `\nCITY: ${fails} FAILED` : '\nCITY: ALL PASSED');
process.exit(fails ? 1 : 0);
