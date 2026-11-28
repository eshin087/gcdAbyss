// The Veiled Crossing and Bai Wuji, the Untouched, headless: the REAL Player, Untouched, Hud, GameFlow,
// AudioEngine and Lab (+ real LightPool, GlyphParticles, FireField, CameraRig, Events) wired like
// src/main.js for `?level=veil`, on the level's real set (world/veiledCrossing.js: its breakables, its
// scenes, its ambience). A bot drives the input. The harness is city.mjs's (its build, bots, helpers).
// usage: node veil.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: levels | data | barrier | weight | crash | pull | domain | phases | fight | pace | events | opened | all
//   (later agents add theirs at their marked place in `S`, one entry per line)
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
const { TELL, RESULT, POSTURE, PARRY_KIND, setParryKind } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createVeiledCrossing, CROSSING } = await imp('src/world/veiledCrossing.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
// (this suite measures the barrier, the pull and the domain, not the riposte: a parry here answers with the
// old riposte, as the other suites that parry for something else do; the deathblow has its own, `duel deathblow`)
const { setRiposteMode } = await imp('src/entities/player/riposteCut.js');
setRiposteMode('old');
const { Untouched } = await imp('src/entities/enemies/untouched/untouched.js');
const { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, realise, HANDLERS, COUNTER, STREAK } = await imp('src/entities/enemies/untouched/moves.js');
const { TUNING } = await imp('src/entities/enemies/untouched/tuning.js');
const { Hud } = await imp('src/ui/hud.js');
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
const LVL = getLevel('veil');
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
  const set = createVeiledCrossing(createSharedUniforms(), c);
  return { set, circles: c.circles.map((k) => ({ ...k })) };
})();

/** `real`: the set built anew with its breakables (world.destructibles, the scars, the ambience); without
 *  it the world is a mock on the set's colliders. */
function build(seed = SEED, real = true) {
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
  const set = real ? createVeiledCrossing(U, colliders) : null;
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
    // (world.js's restore: the pieces, the marks, the set's scenes back to the first)
    world.restore = () => { world.destructibles.reset(); world.scars.reset(); set.scenes?.reset?.(); };
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
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('untouched NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('untouched blade NaN');
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
  d.position.set(0, 0, -2);
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

// ================================================================== helpers of this suite
const pieces = (G, kind) => G.game.world.destructibles.list.filter((b) => b.kind === kind);
const quiet = (d) => d.mode === 'foot';
/** The hero's answer to the next flash of `name` (or any of his): 'parry' (ordinary), 'perfect' (a
 *  perfect parry), 'dodge' (a perfect dodge: the roll 0.08 s before the impact), 'early' (a roll too
 *  early: no perfect), 'guard' (a held guard), 'none'. Returns the step function for run(). */
function answer(G, how, name = null) {
  const { game, input } = G;
  G.ans = { at: 0, done: false };
  G.watch = (n, e) => {
    if (n !== 'combat:flash' || e?.source !== 'dragon' || (name && e.attack !== name) || G.ans.done || G.ans.at) return;
    const lead = { parry: 0.25, perfect: 0.04, dodge: 0.08, early: 0.45 }[how]; // (ADR-227: an ordinary parry is pressed 0.20 - 0.22 s before the impact; the press registers a frame later, the impact ~0.25 s after the flash)
    if (lead !== undefined) G.ans.at = game.time + TUNING.flashLead - lead;
  };
  return () => {
    const d = game.dragon, p = game.player;
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (how === 'guard') input.press(1);
    if (how === 'early' && G.ans.at && game.time + 0.5 >= G.ans.at + 0.45 && !G.ans.done) {
      // (an early roll: started 0.45 s before the impact)
    }
    if (G.ans.at && game.time >= G.ans.at && !G.ans.done) {
      G.ans.done = true;
      if (how === 'parry' || how === 'perfect') {
        input.up(1);
        input.click(1);
      } else if (how === 'dodge' || how === 'early') {
        const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
        input.axis = { x: -dz / l, y: -dx / l };
        input.tap('Space');
      }
    }
  };
}
/** Trigger `name` with the hero `dist` m before him and answer it `how`; run until he is back in footwork. */
function blowAnd(G, name, how, { dist = 2, god = true, max = 6 } = {}) {
  const d = G.game.dragon;
  place(G, dist);
  G.game.player.debug.god = god;
  const step = answer(G, how, name);
  const ok = d.brain.trigger(name);
  let acted = false;
  run(G, max, step, () => {
    if (d.mode === 'act') acted = true;
    return acted && d.mode === 'foot' && G.game.player.state !== 'roll';
  });
  G.watch = null;
  G.input.up(1);
  G.input.axis = { x: 0, y: 0 };
  return ok;
}
/** One swing of the hero's at him from `dist` m (a light): the damage it dealt. */
function swing(G, dist = 1.6) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  place(G, dist);
  const hp0 = d.hp;
  let stops = 0;
  const w0 = G.watch;
  G.watch = (n, e) => { if (n === 'dragon:barrier' && e?.state === 'stop') stops++; w0?.(n, e); };
  input.click(0);
  run(G, 0.9, () => game.mouseGround.set(d.position.x, 0, d.position.z));
  G.watch = w0;
  return { dealt: hp0 - d.hp, stops, state: p.state };
}

// ================================================================== scenario: strike (round 4)
// (the owner: "it takes too much time to chip at him"; "when the sword is hitting the barrier, show a cool
// ascii effect ... showing its silhouette briefly"): a stop chips wjBarrier.chip of the cut, never his last
// HP, the HUD's number rides the stop's event; every ?wjStrike look draws its silhouette and lets it go
async function scenarioStrike() {
  out('\n== scenario STRIKE (a cut on the shell: the chip, the number, the silhouette in every look) ==');
  const B = TUNING.wjBarrier;
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const STRIKE_T = (await imp('src/entities/enemies/untouched/fxStrike.js')).STRIKE.T;
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 1.6 });
    const ev = [];
    G.watch = (n, e) => { if (n === 'dragon:barrier' && e?.state === 'stop') ev.push(e); };
    const hp0 = d.hp;
    const r = d.takeHit({ damage: 60, part: 'body', point: { x: d.position.x, y: 1.2, z: d.position.z - 0.5 }, dir: { x: 0, z: 1 } });
    const got = hp0 - d.hp;
    assert(r === 0 && d.barrier.up && Math.abs(got - Math.round(60 * B.chip)) <= 1, `a 60 cut on the shell returns 0 and chips ${got} (x${B.chip}); the barrier stands`);
    assert(ev.length === 1 && ev[0].damage === got && Number.isFinite(ev[0].x + ev[0].y + ev[0].z), `the stop's event carries the chip and where (${JSON.stringify(ev[0] ?? null)})`);
    d.hp = 3;
    d.brain.aiEnabled = false; // (no phase gate: the floor is the shell's own)
    for (let i = 0; i < 4; i++) d.takeHit({ damage: 400, part: 'body', point: { x: d.position.x, y: 1.2, z: d.position.z - 0.5 } });
    assert(d.hp === 1 && d.mode !== 'dying' && d.mode !== 'dead', `the shell never takes his last HP (${d.hp}, ${d.mode})`);
    G.watch = null;
  }
  for (const look of ['0', 'a']) {
    setLook('wjStrike', look);
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 1.6 });
    run(G, 0.3);
    const fx = d.fx, st = fx._strikes;
    const f0 = G.game.fx?.fire?.count ?? 0;
    d.takeHit({ damage: 60, part: 'body', point: { x: d.position.x + 0.2, y: 1.4, z: d.position.z - 0.5 }, dir: { x: 0, z: 1 } });
    const live = st.list.filter((r) => r.alive);
    let peak = 0;
    run(G, 0.1, () => { peak = Math.max(peak, G.game.fx?.fire?.count ?? 0); });
    const during = st.list.filter((r) => r.alive).length;
    // (every blocked hit shows: a second, then a third cut while the first patch still shows)
    d.takeHit({ damage: 60, part: 'body', point: { x: d.position.x - 0.2, y: 1.0, z: d.position.z - 0.5 }, dir: { x: 0, z: 1 } });
    d.takeHit({ damage: 60, part: 'body', heavy: true, point: { x: d.position.x, y: 1.6, z: d.position.z - 0.5 }, dir: { x: 0, z: 1 } });
    const three = st.list.filter((r) => r.alive).length;
    run(G, 0.45);
    const after = st.list.filter((r) => r.alive).length;
    if (look === '0') assert(live.length === 0 && fx._ripples.some((r) => r.alive || r.t > 0), `0: the ripple as shipped, no patch (${live.length})`);
    else {
      assert(live.length === 1 && !fx._ripples.some((r) => r.alive), `a: a patch of the shell where it struck, nothing else of the stop (${live.length} live, no ripple)`);
      assert(during === 1 && peak > f0, `a: it shows through the hit (${during} live at 0.1 s; ${f0} -> ${peak} blobs)`);
      assert(three === 3, `a: every blocked hit shows its own (${three} live after three cuts)`);
      assert(after === 0, `a: gone shortly after (${after} live 0.45 s on; ${STRIKE_T} s each)`);
    }
  }
  setLook('wjStrike', null);
}

// ================================================================== scenario: opened (the tuning pass, round 3)
// (the owner: "the barrier opens easier": two ordinary parries crack it open, it stays open longer, and the
// hero's cuts hit harder while it is open: wjBarrier.openDamage on every cut that is not exact)
async function scenarioOpened() {
  out('\n== scenario OPENED (open, his cuts deal wjBarrier.openDamage x; exact hits as they are; up, nothing) ==');
  const B = TUNING.wjBarrier, k = B.openDamage;
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 2 });
  // (the same cut, straight to takeHit, in a reaction that does not guard: open, then up)
  const cut = () => { d.brain.startReact('stagger'); const h0 = d.hp; d.takeHit({ damage: 100, part: 'body' }); run(G, 0.05); return h0 - d.hp; };
  const exact = () => { const h0 = d.hp; d.takeHit({ damage: 100, part: 'body', exact: true }); run(G, 0.05); return h0 - d.hp; };
  d.barrier.open('debug', 30);
  const open = cut(), openExact = exact();
  d.barrier.close();
  const upExact = exact();
  d._wjSurprised = true;
  d.barrier.open('debug', 30);
  const again = cut();
  out(`   a 100 cut on the body: open ${open} (then ${again}), exact open ${openExact} / up ${upExact}; openDamage ${k}`);
  assert(Number.isFinite(k) && k > 1, `openDamage is set above 1 (${k})`);
  assert(Math.abs(open - Math.round(100 * TUNING.parts.body * k)) <= 1 && Math.abs(again - open) <= 1, `open, a cut deals x${k} (${open}, ${again})`);
  assert(openExact === upExact && openExact === 100, `an exact hit deals the same open or up (${openExact} / ${upExact})`);
  assert(B.cracks === 2, `two ordinary parries crack it open (cracks ${B.cracks})`);
}

// ================================================================== scenario: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (the registry, the URL, the lines, no reward, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'veil' && LEVELS.indexOf(LVL) === 8, `levels: ${LEVELS.map((l) => l.id).join(', ')} (the ninth)`);
  assert(['?level=veil', '?lab&level=VEIL', '?level=crossing', '?level=veiled', '?level=wuji', '?level=untouched'].every((q) => levelFromSearch(q) === LVL), '?level=veil / crossing / veiled / wuji / untouched pick the level (case-insensitive)');
  const ids = new Set();
  for (const L of LEVELS) for (const a of [L.id, ...(L.aliases ?? [])]) { assert(!ids.has(a), `the URL id ${a} is one level's only`); ids.add(a); }
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'victory', 'fallen', 'restReset', 'again', 'rise']) assert(!!LVL.text[k], `the level has its ${k} line`);
  assert(LVL.name === 'The Veiled Crossing' && LVL.text.victory === 'THE UNTOUCHED FALLS' && LVL.text.phase2 === 'THE BLINDFOLD COMES OFF' && LVL.text.phase3 === 'THE MEASURELESS', `${LVL.name}: ${LVL.sub}`);
  assert(LVL.reward === undefined, 'no reward ships (the owner has not chosen one)');
  assert(CONFIG.world.arenaRadius === CROSSING.r && CONFIG.world.bossTriggerZ === CROSSING.entryZ && CONFIG.world.dragonBound === CROSSING.dragonBound, 'applyLevel merged the crossing layout into CONFIG.world');
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof Untouched && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'untouched', `the boss is his own duelist: ${d.name}`);
  assert(d.maxHp === TUNING.hp && TUNING.phaseAt.length === 3 && !d.lives, 'one health bar, three phases');
  const set = G.game.world.forest;
  assert(Array.isArray(set.scenes?.ids) && set.scenes.ids[0] === 'crossing' && set.scenes.ids.includes('void') && typeof set.setPhase === 'function', 'the set: scenes [crossing, void], setPhase');
  const kinds = new Set(G.game.world.destructibles.list.map((b) => b.kind));
  assert(['car', 'slab', 'towerTop'].every((k) => kinds.has(k)) && G.game.world.destructibles.list.some((b) => b.kind === 'towerBase' && b.top), `the throwable kinds stand and a tower base holds its top (${[...kinds].join(', ')})`);
  run(G, 0.6);
  assert(d.mode === 'sleep', 'asleep he waits in the middle of the crossing');
  d.startIntro();
  run(G, 4, null, () => d.mode === 'foot');
  assert(G.counts['dragon:wake'] === 1 && G.counts['dragon:introDone'] === 1 && d.mode !== 'sleep', 'woken: the duel starts');
  const { SCORE, allTrackFiles } = await imp('src/audio/trackList.js');
  assert(!!SCORE.levels.veil?.explore && SCORE.levels.veil.phases.length === 3 && allTrackFiles().includes(SCORE.levels.veil.explore.file), 'the level has its score (borrowed files: every file is checked by records / the track test)');
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every phase a move is used in, both ends of every roll; the wj prefix; the homage line) ==');
  let checked = 0;
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
        if (!def.transition && first && !(first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6)) assert(false, `${tag}: first real windup ${(first.impact - first.tellAt).toFixed(3)} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring has its ring`);
        // WEIGHT: every blow that lands throws (2 m and more); the domain's close deals nothing itself
        for (const b of real) if (b.def.damage > 0 && !(b.def.knockback >= 2)) assert(false, `${tag}: hit ${b.hit} throws the hero ${b.def.knockback} m (>= 2)`);
        for (let i = 1; i < real.length; i++) if ((real[i].def.tell === TELL.RED || real[i].def.tell === TELL.BLACK) && !(real[i - 1].def.tell === TELL.RED || real[i - 1].def.tell === TELL.BLACK) && !(real[i].flash - real[i - 1].flash >= 0.36 - 1e-6)) assert(false, `${tag}: a red cue ${(real[i].flash - real[i - 1].flash).toFixed(2)} s after a guard cue`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        checked++;
      }
    }
  }
  assert(checked > 20, `${checked} realisations obey the rules (a tell per hit, feints silent, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart, every landed blow throws >= 2 m)`);
  // the minimums against the hardest duelist's today (Tian Lei: 0.26 / 0.40 / 0.34)
  const { TUNING: ASC_T } = await imp('src/entities/enemies/ascendant/tuning.js');
  assert(TUNING.flashLead >= ASC_T.flashLead && TUNING.minFirstWindup >= ASC_T.minFirstWindup && TUNING.minHitGap >= ASC_T.minHitGap, `his minimums are no lower than Tian Lei's (${TUNING.flashLead} / ${TUNING.minFirstWindup} / ${TUNING.minHitGap})`);
  // every new field is `wj`-prefixed: the beat and move fields in use (MAP-engine's list), the rest must start with wj
  const ENGINE = new Set(('tell flare feint windup hold cock active chance fixed pick damage knockback knockdown zone ring part track close travel dash lift leap air release cast sustain selfHit stance draw stopOn mikiri lock flit follow keys bolt pull grip noWorld groundMark blink dive hazard burn whoosh blockPush guardCost mo '
    + 'label phase weight cooldown band recovery recoveryKeys counter transition manual hidden cat terrain gapCloser streak recoverOpen').split(' '));
  const bad = new Set();
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const k of Object.keys(def)) if (k !== 'beats' && !ENGINE.has(k) && !/^wj[A-Z]/.test(k)) bad.add(`${name}.${k}`);
    for (const raw of def.beats) for (const b of Array.isArray(raw.pick) ? raw.pick : [raw]) for (const k of Object.keys(b)) if (!ENGINE.has(k) && !/^wj[A-Z]/.test(k)) bad.add(`${name}.beat.${k}`);
  }
  assert(bad.size === 0, `every new move / beat field is wj-prefixed (${[...bad].slice(0, 8).join(', ')})`);
  // the moves files' handler FIELDS are wj-prefixed and claimed by one file only
  const own = new Map();
  for (const H of HANDLERS) for (const f of H.fields) { assert(/^wj[A-Z]/.test(f) && !own.has(f), `handler ${H.name}: its field ${f} is wj-prefixed and its own`); own.set(f, H.name); }
  // the poses router: each file's names carry its prefix, none twice
  const { POSE_FILES } = await imp('src/entities/enemies/untouched/poses.js');
  const seen = new Set();
  let dup = 0, pre = 0;
  for (const [who, names] of Object.entries(POSE_FILES)) for (const n of names) { if (seen.has(n)) dup++; seen.add(n); if (who !== 'body' && !n.startsWith(who)) pre++; }
  assert(dup === 0 && pre === 0, `the pose files' names: none twice (${dup}), each moves file's with its prefix ml / sp / tr (${pre} without)`);
  // the transitions
  for (const [ph, mv] of Object.entries(TRANSITIONS)) assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph), `phase ${ph} begins with ${mv}`);
  const close = MOVES.measureless.beats.find((b) => b.wjDomain === 'close');
  assert(close?.tell === TELL.RED && close.zone.r >= 30 && MOVES.measureless.beats.some((b) => b.wjDomain === 'sign'), 'the Measureless: the sign, then the close (red, over the whole arena)');
  // the homage line: none of the source's names in his data, the level's lines or the set's kinds
  const words = JSON.stringify([MOVES, LVL.text, LVL.name, LVL.sub, TUNING.name, Object.keys(MOVES)]).toLowerCase();
  const BAN = [['go', 'jo'], ['sato', 'ru'], ['jujut', 'su'], ['kai', 'sen'], ['infin', 'ity'], ['mu', 'gen'], ['muryo', 'kusho'], ['unlimited ', 'void'], ['hollow ', 'purple'], ['mur', 'asaki'], ['la', 'pse'], ['rev', 'ersal'], ['a', 'ka'], ['a', 'o '], ['domain ', 'expansion'], ['six ', 'eyes'], ['shibu', 'ya'], ['toky', 'o'], ['su', 'kuna'], ['ge', 'to'], ['ryo', 'men'], ['black ', 'flash']].map((p) => p.join(''));
  const hits = BAN.filter((w) => new RegExp(`(^|[^a-z])${w.trim()}([^a-z]|$)`).test(words));
  assert(hits.length === 0, `no source name in his moves, his name or the level's lines (${hits.join(', ')})`);
}

// ================================================================== scenario: barrier (R1)
async function scenarioBarrier() {
  out('\n== scenario BARRIER (the Unreached: stops short, no damage, opens on a perfect parry / a perfect dodge / cracks / a posture break; closes; exact passes) ==');
  const B = TUNING.wjBarrier;
  {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 1.6 });
    p.debug.god = true;
    const r0 = d._hsR[1];
    assert(d.barrier.up && Math.abs(d._hs[1].r - (r0 + B.shell)) < 1e-9, `up at the start; his hurt spheres grown by the shell (${r0} + ${B.shell} m)`);
    const post0 = d.posture;
    const s = swing(G);
    // (round 4: a stop still chips him, wjBarrier.chip x the cut, and nothing else: no posture)
    const chipMax = Math.ceil(80 * (B.chip ?? 0)) + 1;
    assert(s.stops >= 1 && s.dealt <= chipMax * s.stops && (B.chip > 0 ? s.dealt > 0 : s.dealt === 0) && d.posture === post0, `a cut stops on the shell: ${s.stops} stop, ${s.dealt} damage (the chip, x${B.chip}), posture ${post0} -> ${d.posture}`);
    // free at once: a roll out of the bounce
    place(G, 1.6);
    G.input.click(0);
    let st = null;
    run(G, 0.8, null, () => { if (p.state === 'bounce' && st === null) { st = 'bounce'; G.input.axis = { x: 1, y: 0 }; G.input.tap('Space'); } return st && p.state === 'roll'; });
    assert(st === 'bounce' && p.state === 'roll', `the hero is thrown back off it (bounce) and rolls out at once (${p.state})`);
    run(G, 1);
    const hp0 = d.hp;
    d.takeHit({ damage: 40, part: 'body', exact: true });
    assert(d.hp < hp0 && d.barrier.up, `an exact hit passes (${hp0} -> ${d.hp}) and leaves it up`);
  }
  {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 2 });
    blowAnd(G, 'palm', 'perfect');
    assert(!d.barrier.up && d.barrier.why === 'parry' && Math.abs(d.barrier.openDur - B.open[0]) < 1e-9, `a perfect parry opens it for ${B.open[0]} s (${d.barrier.why}, ${d.barrier.openDur})`);
    // (open he is a duelist again: his guard turns a cut from the front as any duelist's; caught off it, he is cut)
    d.brain.startReact('stagger');
    const s = swing(G);
    assert(s.dealt > 0 && s.stops === 0, `open, he is cut like any duelist (${s.dealt}, ${s.stops} stops)`);
    run(G, B.open[0] + 0.5);
    assert(d.barrier.up, 'it closes on the timer');
    void p;
  }
  {
    // the first cut that lands while it is open surprises him (once a fight; the body's `surprised`)
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 2 });
    d.barrier.open('debug');
    const seen = [];
    for (let i = 0; i < 2; i++) {
      d.brain.startReact('flinch');
      const hp0 = d.hp;
      d.takeHit({ damage: 30, part: 'body' });
      seen.push(`${hp0 > d.hp ? 'cut' : 'none'} ${d.brain.react?.kind}`);
      run(G, 1.2);
      d.barrier.open('debug');
    }
    assert(seen[0] === 'cut surprised' && seen[1] !== 'cut surprised' && seen[1].startsWith('cut'), `the first cut through the open barrier: surprised, once (${seen.join(' · ')})`);
  }
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 3 });
    blowAnd(G, 'longStep', 'dodge', { dist: 3.5 });
    assert(!d.barrier.up && d.barrier.why === 'dodge', `a perfect dodge of a blow opens it (${d.barrier.why}; ${JSON.stringify(d.barrier.stats.opens)})`);
  }
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 2 });
    // (one parry, ADR-279, the default: every parry is perfect, so the first one opens it; the cracks are ?parry=two's)
    blowAnd(G, 'flick', 'parry');
    assert(!d.barrier.up && d.barrier.why === 'parry' && d.barrier.cracks === 0, `one parry: the first parry opens it (${d.barrier.why}; cracks ${d.barrier.cracks})`);
    run(G, B.open[0] + 0.5);
    d.barrier.up || d.barrier.close?.();
    const pk0 = PARRY_KIND.mode;
    setParryKind('two');
    const seen = [];
    for (let i = 0; i < B.cracks; i++) {
      blowAnd(G, 'flick', 'parry');
      seen.push(d.barrier.up ? d.barrier.cracks : 'open');
    }
    assert(seen.join(',') === [...Array.from({ length: B.cracks - 1 }, (_, i) => i + 1), 'open'].join(',') && d.barrier.why === 'cracks' && Math.abs(d.barrier.openDur - B.openCracked[0]) < 1e-9, `ordinary parries crack it: ${seen.join(', ')}; open for ${d.barrier.openDur} s (${d.barrier.why}; ${JSON.stringify(d.barrier.stats.opens)})`);
    setParryKind(pk0);
    run(G, B.openCracked[0] + 0.5);
    d.barrier.crack();
    run(G, B.crackFade + 0.5);
    assert(d.barrier.up && d.barrier.cracks === 0, `cracks fade after ${B.crackFade} s without a new one`);
  }
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 3 });
    d.debug.postureBreak();
    run(G, 0.2);
    assert(d.broken && !d.barrier.up && d.barrier.why === 'break', 'a posture break opens it');
    run(G, 2);
    assert(!d.barrier.up || !d.broken, `it stays open through the break (${d.broken ? 'broken' : 'over'}, ${d.barrier.up ? 'up' : 'open'})`);
  }
  {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 1.6, ai: true });
    p.debug.god = true;
    // (his AI moves at once: the two cuts are dealt straight to takeHit while he stands in footwork)
    let counters = 0;
    G.watch = (n, e) => { if (n === 'dragon:windup' && e.name === COUNTER) counters++; };
    for (let i = 0; i < 2; i++) {
      d.brain.act = null;
      d.mode = 'foot';
      d.takeHit({ damage: 30, part: 'body', swing: true, point: { x: d.position.x, y: 1.2, z: d.position.z + 0.4 }, dir: { x: 0, z: -1 } });
      run(G, 0.3);
    }
    G.watch = null;
    assert(counters === 1 && d.barrier.stats.stops >= 2, `two cuts in a row on the shell: his counter (${COUNTER}) answers (${counters})`);
  }
}

// ================================================================== scenario: weight (R2)
async function scenarioWeight() {
  out('\n== scenario WEIGHT (every landed blow throws; a block slides >= 3 m and costs no health; two hold, the third in a row breaks the guard) ==');
  const G = build();
  const d = G.game.dragon, p = G.game.player;
  duel(G, { dist: 2 });
  p.debug.god = false;
  const hp0 = p.hp;
  const x0 = p.position.x, z0 = p.position.z;
  blowAnd(G, 'palm', 'none', { god: false });
  const thrown = Math.hypot(p.position.x - x0, p.position.z - z0);
  assert(p.hp < hp0 && thrown >= 2.5, `a palm that lands: ${hp0 - p.hp} damage, the hero thrown ${thrown.toFixed(2)} m`);
  p.debug.heal();
  p.guard = 100;
  const blocks = [];
  let broke = false;
  const w = (n) => { if (n === 'player:guardOpen' || n === 'player:guardBreak') broke = true; };
  for (let i = 0; i < 3; i++) {
    place(G, 2);
    run(G, 0.3, (GG) => GG.input.press(1));
    const h = p.hp, g = p.guard, bx = p.position.x, bz = p.position.z;
    const step = answer(G, 'guard', 'flick');
    G.watch = (n, e) => w(n, e);
    d.brain.trigger('flick');
    run(G, 3, step, () => d.mode === 'foot' && !d.brain.act);
    blocks.push({ dhp: h - p.hp, slid: Math.hypot(p.position.x - bx, p.position.z - bz), cost: g - p.guard });
    G.watch = null;
  }
  G.input.up(1);
  out(`   blocks: ${blocks.map((b) => `slid ${b.slid.toFixed(2)} m, guard -${b.cost.toFixed(0)}, hp -${b.dhp}`).join(' · ')}`);
  assert(blocks.every((b) => b.dhp === 0), 'a block never costs health');
  assert(blocks.slice(0, 2).every((b) => b.slid >= 3 - 0.05), `a blocked blow slides him >= 3 m (${blocks.map((b) => b.slid.toFixed(2)).join(', ')})`);
  assert(blocks.every((b) => b.cost >= TUNING.wjWeight.guardCost * 100 - 2), `each block takes ${TUNING.wjWeight.guardCost * 100} % of the meter (${blocks.map((b) => b.cost.toFixed(0)).join(', ')})`);
  // a string's blocks (the owner, round 2: the THIRD block in a row knocks the guard open, never the second),
  // with the gap between them up to 1 s (a string's; the meter refills 60 a second from 0.8 s after a block, so
  // blows 1.3 s apart leave 19: no cost can break the third there and spare the second at 0.34 s): 0.45
  const rows = [];
  for (const gap of [0.34, 0.7, 1.0]) {
    p.debug.heal();
    p.guard = 100;
    run(G, 1.2);
    let opened = -1, k = 0;
    G.watch = (n) => { if ((n === 'player:guardOpen' || n === 'player:guardBreak') && opened < 0) opened = k; };
    const gs = [];
    place(G, 2);
    run(G, 0.3, (GG) => GG.input.press(1));
    for (k = 0; k < 3; k++) {
      p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
      d.hitPlayer({ damage: 18, knockback: 3, tell: TELL.NORMAL, attack: 'flick', from: { x: d.position.x, z: d.position.z } });
      gs.push(Math.round(p.guard));
      run(G, gap, (GG) => GG.input.press(1));
    }
    G.watch = null;
    G.input.up(1);
    rows.push({ gap, opened, gs });
  }
  out(`   three blocks in a row: ${rows.map((r) => `${r.gap} s apart: meter ${r.gs.join(' -> ')}, open at block ${r.opened + 1}`).join(' · ')}`);
  assert(rows.every((r) => r.opened === 2), `two blocks in a row hold, the third knocks the guard open (${rows.map((r) => `${r.gap} s: block ${r.opened + 1}`).join(', ')})`);
}

// ================================================================== scenario: crash (R3)
async function scenarioCrash() {
  out('\n== scenario CRASH (a thrown hero goes through the world: thrown 8 m at a piece 3 m behind him) ==');
  const rows = [];
  for (const crash of [true, false]) {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 4 });
    const W = G.game.world.destructibles;
    const car = pieces(G, 'car')[0];
    // the hero 3 m in front of the car (from its middle to his), the blow from the far side
    const ux = 0, uz = 1;
    const px = car.x - ux * (3 + car.r * 0), pz = car.z - uz * 3;
    p.debug.teleport(px, pz);
    p.debug.heal();
    p.debug.god = false;
    d.position.set(px - ux * 2, 0, pz - uz * 2);
    run(G, 0.1);
    const hp0 = p.hp;
    let impacts = 0;
    G.watch = (n, e) => { if (n === 'world:impact' && e?.by === 'boss') impacts++; };
    const imp0 = W.list.filter((b) => b.state !== 0).length;
    p.takeHit({ damage: 10, knockback: 8, from: { x: d.position.x, z: d.position.z }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d, ...(crash ? { wjCrash: TUNING.wjCrash.power, wjCrashDamage: TUNING.wjCrash.damage } : null) });
    run(G, 2);
    const dist = Math.hypot(p.position.x - px, p.position.z - pz);
    const inside = G.game.world.colliders.circles.some((c) => c.on !== false && Math.hypot(p.position.x - c.x, p.position.z - c.z) < c.r + p.radius - 0.05);
    rows.push({ crash, carState: car.state, carHp: car.hp, dist, dmg: hp0 - p.hp, hits: p.crash.hits.length, inside, broke: W.list.filter((b) => b.state !== 0).length - imp0 });
    G.watch = null;
  }
  for (const r of rows) out(`   ${r.crash ? 'wjCrash' : 'plain  '}: the car ${r.carState === 0 ? `holds (hp ${r.carHp.toFixed(2)})` : 'broke'}, the hero stopped ${r.dist.toFixed(2)} m from where he stood, ${r.dmg} damage, ${r.hits} piece(s) hit, inside a collider: ${r.inside}`);
  const [a, b] = rows;
  assert(a.hits >= 1 && a.hits <= 6 && (a.carState !== 0 || a.carHp < b.carHp), `with wjCrash the car takes the throw (one impact per piece: ${a.hits})`);
  assert(b.hits === 0 && b.carHp === pieces(build(), 'car')[0].hp, 'without it (any other boss\'s throw) nothing crashes');
  assert(!a.inside && !b.inside, 'he is never left inside a collider');
  assert(a.dmg - b.dmg <= TUNING.wjCrash.damage * a.hits + 1e-6, `the crash's extra damage is small and fixed (${a.dmg - b.dmg})`);
  // never lethal: a hero on 3 HP thrown through a piece keeps 1
  const G = build();
  const d = G.game.dragon, p = G.game.player;
  duel(G, { dist: 4 });
  const car = pieces(G, 'car')[0];
  p.debug.teleport(car.x, car.z - 3);
  d.position.set(car.x, 0, car.z - 5);
  run(G, 0.1);
  p.hp = 3;
  p.takeHit({ damage: 0, knockback: 8, from: { x: d.position.x, z: d.position.z }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d, wjCrash: 2.2, wjCrashDamage: 50 });
  run(G, 1.5);
  assert(p.alive && p.hp >= 1, `the crash is never lethal (hp ${p.hp})`);
}

// ================================================================== scenario: pull (R5)
async function scenarioPull() {
  out('\n== scenario PULL (a Draw knot drags the hero: his net speed running away at 4 m and 8 m; a roll gets him out) ==');
  const speedAway = (knotAt) => {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 8 });
    d.position.set(-12, 0, -12);
    p.debug.teleport(0, 0);
    p.debug.god = true;
    run(G, 0.3);
    // (the knot kept `knotAt` m behind him: his steady speed at that distance)
    const k = knotAt ? d.pull.add({ x: 0, z: -knotAt, life: 6 }) : null;
    const keep = () => { if (k) { k.x = p.position.x; k.z = p.position.z - knotAt; } };
    G.input.axis = { x: 0, y: -1 }; // (screen down: +z, away from the knot)
    run(G, 0.6, keep);
    const z0 = p.position.z;
    run(G, 1.5, keep);
    G.input.axis = { x: 0, y: 0 };
    return (p.position.z - z0) / 1.5;
  };
  const free = speedAway(0), at4 = speedAway(4), at8 = speedAway(8);
  out(`   running straight away: free ${free.toFixed(2)} m/s, a knot 4 m behind ${at4.toFixed(2)} m/s, 8 m behind ${at8.toFixed(2)} m/s`);
  assert(free > 3 && at4 > 0.25 * free && at4 < 0.75 * free, `at 4 m he still gets away, at about half speed (x${(at4 / free).toFixed(2)})`);
  assert(at8 > at4 && at8 < free, `at 8 m the drag is weaker (x${(at8 / free).toFixed(2)})`);
  {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 8 });
    d.position.set(-12, 0, -12);
    p.debug.teleport(0, 0);
    run(G, 0.3);
    d.pull.add({ x: 0, z: -2, life: 6 });
    G.input.axis = { x: 0, y: -1 };
    G.input.tap('Space');
    run(G, 0.6);
    const rolled = p.position.z;
    assert(rolled > 3, `a roll carries him out of it (${rolled.toFixed(2)} m in one roll)`);
    d.debug.tidy();
    assert(d.pull.live === 0, 'tidy: no knot left');
  }
}

// ================================================================== scenario: domain (P2 -> P3)
async function scenarioDomain() {
  out('\n== scenario DOMAIN (the Measureless: escape and catch; never lethal; never on a hero who is down; the void after; the crossing returns) ==');
  const into = (how, hp = null, down = false) => {
    const G = build();
    const d = G.game.dragon, p = G.game.player, set = G.game.world.forest;
    duel(G, { dist: 4, form: 2 });
    p.debug.god = false;
    p.debug.heal();
    if (hp !== null) p.hp = hp;
    const hp0 = p.hp;
    const step = answer(G, how, 'measureless');
    let lockT = 0, lockMax = 0;
    d.brain.forcePhase(3);
    run(G, 6, () => {
      step();
      if (down && d.domain.state === 'closing' && p.state !== 'knockdown') p.takeHit({ damage: 0, knockback: 1, knockdown: true, from: { x: d.position.x, z: d.position.z }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d });
      const held = p.state === 'stagger' && d.domain.stats.caught > 0;
      lockT = held ? lockT + DT : 0;
      lockMax = Math.max(lockMax, lockT);
    }, () => d.phase === 3 && d.mode !== 'act');
    G.watch = null;
    return { G, d, p, set, hp0, lockMax };
  };
  {
    const { d, p, set, hp0 } = into('dodge');
    assert(d.domain.stats.escapes === 1 && d.domain.stats.caught === 0, `a perfect dodge through the wall: escaped (${JSON.stringify(d.domain.stats)})`);
    assert(p.hp === hp0 && (d.barrier.why === 'domain' || d.barrier.why === 'dodge'), `inside unharmed (${hp0} -> ${p.hp}) and the barrier open (${d.barrier.why}, ${d.barrier.openDur} s)`);
    assert(set.scenes.now === 'void' && d.domain.inVoid && d.phase === 3, `the scene is the void (${set.scenes.now})`);
  }
  {
    const { G, d, p, set, hp0, lockMax } = into('none');
    const blow = TUNING.wjDomain.blow * p.maxHp;
    assert(d.domain.stats.caught === 1 && d.domain.stats.blows === 1 && Math.abs(hp0 - p.hp - blow) < 1.01, `no answer: caught, held and struck once (${hp0} -> ${p.hp}, the blow ${blow})`);
    assert(lockMax <= 1.2 + 0.05, `the hold locks him ${lockMax.toFixed(2)} s at most (<= 1.2)`);
    assert(set.scenes.now === 'void', 'the void either way');
    // his death: the void breaks, the crossing returns
    d.debug.kill();
    run(G, 0.5);
    assert(set.scenes.now === 'crossing' && !d.domain.inVoid && d.domain.stats.breaks === 1, `his death breaks the void (${set.scenes.now})`);
  }
  {
    const { p, d } = into('early');
    assert(d.domain.stats.caught === 1 && d.domain.stats.escapes === 0, `an early roll is no escape: caught (${JSON.stringify(d.domain.stats)})`);
    void p;
  }
  {
    const { p, d } = into('none', 4);
    assert(p.alive && p.hp >= 1 && d.domain.stats.blows === 1, `the blow is never lethal (4 HP -> ${p.hp})`);
  }
  {
    const { p, d } = into('none', null, true);
    assert(d.domain.stats.spared === 1 && d.domain.stats.blows === 0, `a hero who is down at the close is never held or struck (${JSON.stringify(d.domain.stats)})`);
    void p;
  }
  {
    // a reset (a rest, a retry) brings the crossing back
    const { G, d, set } = into('none');
    G.game.world.restore();
    d.reset();
    run(G, 0.3);
    assert(set.scenes.now === 'crossing' && !d.domain.inVoid && d.domain.state === 'off' && d.dressPhase === 1, 'a reset: the crossing again, the domain forgotten');
    const back = G.game.world.destructibles.list.filter((b) => b.scene === 'crossing' && !b.absent).length, gone = G.game.world.destructibles.list.filter((b) => b.scene === 'void' && !b.absent).length;
    assert(back > 0 && gone === 0, `the crossing's pieces stand (${back}), the void's are gone (${gone})`);
  }
}

// ================================================================== scenario: phases
async function scenarioPhases() {
  out('\n== scenario PHASES (the gates, both transitions and their banners, the dress, the phase scales) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, set = game.world.forest;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  const gate = d.maxHp * TUNING.phaseAt[1];
  d.hp = gate + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  assert(d.hp === gate && d.brain.pendingPhase === 2, `damage stops at the 66 % gate (${d.hp} = ${gate})`);
  let p2 = 0, p3 = 0;
  G.watch = (n) => { if (n === 'dragon:phase2') p2++; if (n === 'dragon:phase3') p3++; };
  const unv = { n: 0, k: 0, flareU: NaN };
  { const f0 = d.fx.unveil?.bind(d.fx); d.fx.unveil = (dd, k) => { unv.n++; unv.k = Math.max(unv.k, k); const a = d.brain.act, b = a?.beats[0]; if (k >= 0.98 && !Number.isFinite(unv.flareU) && b) unv.flareU = (a.t - b.start) / b.W; return f0?.(dd, k); }; }
  run(G, 1.5, null, () => d.brain.act?.name === 'unveil');
  assert(d.brain.act?.name === 'unveil' && d.phase === 2 && p2 === 1, 'The Blindfold Comes Off: phase 2, dragon:phase2');
  run(G, 5, null, () => d.mode !== 'act');
  assert(unv.n > 30 && unv.k >= 0.98 && unv.flareU >= 0.88 && unv.flareU < 0.95, `the band's light and the eyes' flare through its windup, the flare just before the impact (${unv.n} frames, flare at u ${unv.flareU.toFixed(3)})`);
  assert(d.dressPhase === 2 && d.eyesK >= 1, `the blindfold off at its impact (dressPhase ${d.dressPhase}, eyes ${d.eyesK})`);
  assert(game.flow._text('phase2') === 'THE BLINDFOLD COMES OFF', 'the level\'s phase-2 banner');
  const gate3 = d.maxHp * TUNING.phaseAt[2];
  d.hp = gate3 + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  run(G, 1.5, null, () => d.brain.act?.name === 'measureless');
  assert(d.brain.act?.name === 'measureless' && d.phase === 3 && p3 === 1, 'The Measureless: phase 3, dragon:phase3');
  run(G, 6, null, () => d.mode !== 'act');
  assert(set.scenes.now === 'void' && d.dressPhase === 3, `inside the void (${set.scenes.now})`);
  assert(game.flow._text('phase3') === 'THE MEASURELESS', 'the level\'s phase-3 banner');
  const A1 = realise('flick', 1, () => 0.5), A3 = realise('flick', 3, () => 0.5);
  assert(A3.beats[0].W < A1.beats[0].W && A3.beats[0].W >= TUNING.minFirstWindup, `phase 3 is faster (windup ${A1.beats[0].W.toFixed(3)} -> ${A3.beats[0].W.toFixed(3)}), never under the minimum`);
  game.world.restore();
  d.reset();
  assert(set.scenes.now === 'crossing' && d.phase === 1, 'his reset: phase 1, the crossing');
}

// ================================================================== scenario: body (the body agent)
async function scenarioBody() {
  out('\n== scenario BODY (his dress by phase: which pieces show; the eye and hand points; every base clip finite) ==');
  const { BODY_CLIP_NAMES, GUARD, evalClip, POCKETS } = await imp('src/entities/enemies/untouched/poses.js');
  const { WJ_LOADOUT } = await imp('src/entities/enemies/untouched/gear.js');
  const { P: PCH, N: NCH } = await imp('src/entities/player/anim.js');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 4, ai: false });
  const D = d.rig?.root?.userData?.dress;
  assert(D?.kind === 'wj' && D.eyes.length === 2 && WJ_LOADOUT.weapon === null, `his dress record (${D?.at?.length} switched pieces, ${D?.eyes?.length} eyes, bare-handed)`);
  const vis = (name) => (D?.at ?? []).filter((e) => e.m.name === name).map((e) => e.m.visible);
  const all = (name) => vis(name).length > 0 && vis(name).every(Boolean), none = (name) => vis(name).length > 0 && !vis(name).some(Boolean);
  const want = { 1: ['wj.hairUp', 'wj.bandEyes'], 2: ['wj.hairDown', 'wj.bandNeck', 'wj.eye'], 3: ['wj.hairDown', 'wj.bandNeck', 'wj.eye'] };
  const names = ['wj.hairUp', 'wj.hairDown', 'wj.bandEyes', 'wj.bandNeck', 'wj.eye'];
  const v = new THREE.Vector3();
  for (const n of [1, 2, 3]) {
    d.dressPhase = n;
    d.eyesK = n >= 2 ? 1 : 0;
    run(G, 0.1);
    const ok = names.every((k) => (want[n].includes(k) ? all(k) : none(k)));
    const glow = d.rig.materials.flask?.uniforms?.uGlow?.value ?? 0;
    assert(ok && (n === 1 ? glow === 0 : glow > 0.4), `phase ${n}: ${names.filter((k) => all(k)).join(', ')} shown; the eyes' glow ${glow.toFixed(2)}`);
    // (as drawn: the camera lean shears his drawn body, so the points are measured from his drawn head)
    d.eyePoint(v);
    const hd = new THREE.Vector3().setFromMatrixPosition(d.rig.head.matrixWorld);
    const dh = v.distanceTo(hd);
    assert(Number.isFinite(v.x + v.y + v.z) && v.y > 1.7 && v.y < 2.8 && dh < 0.35, `phase ${n}: the eye point is at his eyes (${v.y.toFixed(2)} m up, ${dh.toFixed(2)} m from his drawn head)`);
  }
  // the coat's front parts in phase 3 and closes again in phase 1
  const fr = D.fronts.map((F) => F.C.anchor.rotation.y.toFixed(2)).join(' / ');
  d.dressPhase = 1;
  run(G, 0.1);
  const fr1 = D.fronts.map((F) => F.C.anchor.rotation.y.toFixed(2)).join(' / ');
  assert(fr !== fr1 && D.fronts.every((F) => Math.abs(F.C.anchor.rotation.y - F.closed) < 1e-6), `the coat's front: ${fr1} closed, ${fr} parted in phase 3`);
  // phase 1: the hands in his pockets (by his hips, in front), standing
  d.debug.tidy();
  d.pilot.armsK = 1;
  run(G, 1.0);
  const hands = ['R', 'L'].map((s) => d.handPoint(s, new THREE.Vector3()));
  const pv = new THREE.Vector3().setFromMatrixPosition(d.rig.pelvis.matrixWorld);
  const gap = hands.map((h) => h.distanceTo(pv));
  const hipOk = hands.every((h, i) => Number.isFinite(h.x + h.y + h.z) && gap[i] < 0.36);
  assert(hipOk, `phase 1: both hands at his hips (${gap.map((x) => x.toFixed(2)).join(' / ')} m from his drawn pelvis)`);
  // every base clip, sampled: finite every channel
  const p = new Float32Array(NCH), A = { time: 0, recoil: 0, off: null, player: {} };
  let bad = [], total = 0;
  for (const name of BODY_CLIP_NAMES) {
    const c = CLIP[name];
    if (!c) { bad.push(name + ' (missing)'); continue; }
    for (let t = 0; t <= c.dur + 1e-6; t += c.dur / 24) {
      evalClip(p, c, t, A);
      total++;
      if (!p.every(Number.isFinite)) { bad.push(name); break; }
    }
  }
  assert(!bad.length, `${BODY_CLIP_NAMES.length} base clips, ${total} samples: every channel finite (${bad.join(', ') || 'none bad'})`);
  // ... and played on him: every reaction he can be put in, the rig finite through it
  const reacts = ['ward', 'wardR', 'wardHigh', 'clash', 'deflect', 'flinch', 'backstep', 'sidestep', 'stagger', 'surprised', 'recoil', 'reeling', 'trampled'];
  const badR = [];
  for (const k of reacts) {
    d.debug.tidy();
    run(G, 0.3);
    d.brain.startReact(k);
    let fin = true;
    run(G, 1.2, () => {
      for (const j of [d.rig.head, d.rig.arms.R.fore, d.rig.arms.L.fore, d.rig.legs.R.foot, d.rig.legs.L.foot]) {
        v.setFromMatrixPosition(j.matrixWorld);
        if (!Number.isFinite(v.x + v.y + v.z)) fin = false;
      }
    });
    if (!fin) badR.push(k);
  }
  assert(!badR.length, `${reacts.length} reactions played on him: the rig finite (${badR.join(', ') || 'none bad'})`);
  assert(GUARD.rH === POCKETS.rH && GUARD.lH === POCKETS.lH, 'his stance: the hands in the pockets');
  void PCH;
}

// ================================================================== scenario: fight
async function scenarioFight() {
  out('\n== scenario FIGHT (a seeded fencing bot in god mode, start to death: no throw, no NaN) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242').split(',').map(Number);
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const chain0 = STREAK_FX.chain;
  STREAK_FX.chain = false;
  try {
    for (const seed of SEEDS) {
      const G = build(seed, true);
      const { game } = G;
      const d = game.dragon;
      duel(G, { dist: 3, ai: true });
      G.defend = makeDefender(G, { world: true });
      const phAt = [0];
      G.watch = (n) => { if (/^dragon:phase[23]$/.test(n)) phAt.push(game.time); };
      const t0 = game.time;
      const cap = Number(process.env.GCD_FSECS ?? 600);
      const won = run(G, cap, () => fencer(G), () => d.mode === 'dead' || d.state === 'dead' || game.state === 'victory');
      const T = game.time - t0;
      const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
      out(`     seed ${seed}: ${won ? 'won' : 'NOT won'} in ${T.toFixed(0)} s: phases at ${phAt.map((t) => (t - t0 > 0 ? (t - t0).toFixed(0) : '0')).join(' / ')} s, ${taken} hits taken (god mode); barrier ${JSON.stringify(d.barrier.stats)}; domain ${JSON.stringify(d.domain.stats)}; phase ${d.phase}, hp ${Math.round(d.hp)}`);
      assert(won && d.phase === 3, `seed ${seed}: the fencing bot wins through all three phases`);
      assert(G.payload.size === 0, `seed ${seed}: no NaN in any event (${[...G.payload].join(', ')})`);
    }
  } finally {
    STREAK_FX.chain = chain0;
  }
}

// ================================================================== scenario: downtime (integration, item 5)
/** A half-skilled defender (answers half his cues) in god mode, a whole fight per seed: every knockdown
 *  of the hero; nothing lands while he is down; the stretch out of his own hands; down -> his next cue. */
async function scenarioDowntime() {
  out('\n== scenario DOWNTIME (the hero knocked down: nothing lands on him down, no lock chained on a knockdown past the cap, the time to his next cue) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242,7').split(',').map(Number);
  const OUTS = new Set(['stagger', 'knockdown', 'guardBreak', 'held']);
  const rows = [];
  for (const seed of SEEDS) {
    const G = build(seed, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 3, ai: true });
    G.defend = makeDefender(G, { world: true, skill: 0.5, rng: mulberry32(seed * 13) });
    const flashes = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push(game.time); };
    const downs = [], onDown = [];
    let cur = null, outRun = 0, freeRun = 9, outMax = 0, outMaxAt = 0, multi = 0;
    run(G, Number(process.env.GCD_FSECS ?? 420), () => {
      fencer(G);
      const st = p.state;
      if (st === 'knockdown' && !cur) cur = { t0: game.time, h0: G.hits.length };
      if (st !== 'knockdown' && cur) { cur.t1 = game.time; downs.push(cur); cur = null; }
      if (OUTS.has(st)) { outRun = (freeRun < 0.2 ? outRun + freeRun : 0) + DT; freeRun = 0; if (outRun > outMax) { outMax = outRun; outMaxAt = game.time; } }
      else freeRun += DT;
    }, () => d.mode === 'dead' || game.state === 'victory');
    for (const k of downs) {
      for (const h of G.hits.slice(k.h0)) if (h.t > k.t0 + 0.02 && h.t < k.t1 - 1e-3 && h.r === RESULT.HIT) onDown.push(`${h.attack} at ${(h.t - k.t0).toFixed(2)} s down`);
      k.next = (flashes.find((t) => t > k.t1) ?? NaN) - k.t1;
      k.nextFromDown = k.next + (k.t1 - k.t0);
    }
    const nx = downs.map((k) => k.next).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (v, f) => (v.length ? v[Math.min(v.length - 1, Math.floor(v.length * f))] : NaN);
    rows.push({ seed, n: downs.length, onDown, outMax, outMaxAt, nx, len: downs.map((k) => k.t1 - k.t0) });
    out(`   seed ${seed}: ${downs.length} knockdowns (each ${q(downs.map((k) => k.t1 - k.t0).sort(), 0.5)?.toFixed(2)} s); up -> his next cue: min ${nx[0]?.toFixed(2)} / median ${q(nx, 0.5)?.toFixed(2)} / max ${nx[nx.length - 1]?.toFixed(2)} s (down -> next cue median ${(q(nx, 0.5) + 1.3).toFixed(2)} s); longest stretch out of his own hands ${outMax.toFixed(2)} s; hits on him down: ${onDown.length}`);
    if (process.env.GCD_DT_TRACE) out(`     the longest ends at ${outMaxAt.toFixed(2)} s; hits before it: ${G.hits.filter((h) => h.t > outMaxAt - 3.5 && h.t <= outMaxAt + 0.05).map((h) => `${h.attack} ${h.r} @${h.t.toFixed(2)}`).join(' · ')}`);
  }
  assert(rows.every((r) => r.n >= 3), `the half-skilled defender is knocked down in every fight (${rows.map((r) => r.n).join(', ')})`);
  assert(rows.every((r) => r.onDown.length === 0), `nothing of his lands on the hero while he is down (${rows.flatMap((r) => r.onDown).slice(0, 4).join(' · ') || 'none'})`);
  // (the knockdown is the engine's 1.3 s; what must not happen is a lock chained onto it)
  assert(rows.every((r) => r.outMax <= 1.3 + 0.2 + 1e-6), `no lock is chained on a knockdown: the longest stretch out of his own hands is the knockdown itself (${rows.map((r) => r.outMax.toFixed(2)).join(', ')} s <= 1.5)`);
}

// ================================================================== scenario: events
async function scenarioEvents() {
  out('\n== scenario EVENTS (his own events are in the catalogue) ==');
  for (const n of ['dragon:barrier', 'dragon:domain', 'world:scene']) assert(CATALOGUE.has(n), `${n} is in ARCHITECTURE.md's Event catalogue`);
}

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

const S = {
  levels: scenarioLevels,
  data: scenarioData,
  barrier: scenarioBarrier,
  weight: scenarioWeight,
  crash: scenarioCrash,
  pull: scenarioPull,
  domain: scenarioDomain,
  phases: scenarioPhases,
  fight: scenarioFight,
  pace: scenarioPace,
  events: scenarioEvents,
  downtime: scenarioDowntime, // (the integration pass)
  // melee: scenarios
  strings: scenarioStrings,
  sides: scenarioSides,
  spark: scenarioSpark,
  mix: scenarioMix,
  chase: scenarioChase,
  // spells: scenarios
  draw: scenarioDraw,
  yank: scenarioYank,
  cast: scenarioCast,
  wreck: scenarioWreck,
  null: scenarioNull,
  unveil: scenarioUnveil,
  spellfight: scenarioSpellFight,
  // terrain: scenarios
  curb: scenarioCurb,
  down: scenarioDown,
  orbit: scenarioOrbit,
  road: scenarioRoad,
  voidcast: scenarioVoidcast,
  spent: scenarioSpent,
  letgo: scenarioLetgo,
  into: scenarioInto,
  heldbreak: scenarioHeldBreak, // (the tuning pass)
  floor: scenarioFloor, // (the tuning pass)
  bonfire: scenarioBonfire, // (the tuning pass, round 2)
  patience: scenarioPatience, // (the tuning pass, round 2)
  // tune3: scenarios
  opened: scenarioOpened, // (the tuning pass, round 3)
  strike: scenarioStrike, // (round 4: the chip and the silhouette)
  // world: scenarios
  // (the crossing never traps a thrown hero: thrown 10 m from 24 places, four ways each, through whatever
  // stands there; he ends outside every collider, inside his bound, and walks away)
  throws: async () => {
    out('\n== scenario THROWS (the crossing never traps a hero thrown 10 m: 24 places, 4 ways each) ==');
    const G = build();
    const d = G.game.dragon, p = G.game.player, C = G.game.world.colliders;
    duel(G, { dist: 4 });
    const inside = (x, z, pad = 0.05) => C.circles.find((c) => c.on !== false && Math.hypot(x - c.x, z - c.z) < c.r + p.radius - pad) ?? null;
    let n = 0, broke = 0;
    const stuck = [], out0 = [], still = [];
    for (const r of [7, 12, 16]) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + r * 0.1, x = Math.sin(a) * r, z = Math.cos(a) * r;
      for (const [ux, uz] of [[Math.sin(a), Math.cos(a)], [-Math.sin(a), -Math.cos(a)], [Math.cos(a), -Math.sin(a)], [-Math.cos(a), Math.sin(a)]]) {
        if (inside(x, z, -0.2)) continue;
        p.debug.teleport(x, z);
        p.debug.heal();
        p.debug.god = true;
        d.position.set(x - ux * 2, 0, z - uz * 2);
        G.input.axis = { x: 0, y: 0 };
        run(G, 0.05);
        const b0 = G.game.world.destructibles.list.filter((b) => b.state !== 0).length;
        p.takeHit({ damage: 1, knockback: 10, from: { x: d.position.x, z: d.position.z }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d, wjCrash: TUNING.wjCrash.power, wjCrashDamage: TUNING.wjCrash.damage });
        run(G, 1.6);
        n++;
        broke += G.game.world.destructibles.list.filter((b) => b.state !== 0).length - b0;
        const c = inside(p.position.x, p.position.z);
        if (c) stuck.push(`${x.toFixed(0)},${z.toFixed(0)}→${p.position.x.toFixed(1)},${p.position.z.toFixed(1)} in ${c.tag} ${c.x.toFixed(1)},${c.z.toFixed(1)}`);
        if (Math.hypot(p.position.x, p.position.z) > CONFIG.world.playerBound + 0.02) out0.push(`${x.toFixed(0)},${z.toFixed(0)}`);
        // ... and he walks away (one of four ways takes him a metre in 0.6 s)
        const sx = p.position.x, sz = p.position.z;
        let moved = 0;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          p.position.set(sx, 0, sz);
          G.input.axis = { x: ax, y: ay };
          run(G, 0.6);
          moved = Math.max(moved, Math.hypot(p.position.x - sx, p.position.z - sz));
          if (moved > 1) break;
        }
        G.input.axis = { x: 0, y: 0 };
        if (moved <= 1) still.push(`${sx.toFixed(1)},${sz.toFixed(1)} (${moved.toFixed(2)} m)`);
        // (the next throw from the next place: what broke stays broken, as in a fight)
      }
    }
    out(`   ${n} throws, ${broke} pieces broke on the way; stuck ${stuck.length}, out of bound ${out0.length}, could not walk away ${still.length}`);
    assert(n >= 70, `thrown from ${n} places and ways`);
    assert(!stuck.length, `never left inside a collider (${stuck.slice(0, 5).join('; ')})`);
    assert(!out0.length, `never thrown out of his bound (${out0.slice(0, 5).join('; ')})`);
    assert(!still.length, `he always walks away after (${still.slice(0, 5).join('; ')})`);
  },
  // motion: scenarios
  motion: scenarioMotion,
  polish: scenarioPolish,
  // body: scenarios
  body: scenarioBody,
  // fx: scenarios
  fx: scenarioFx,
};
// (run by tests/run.mjs as processes of their own; `all` leaves them out: GCD_SKIP)
// (the tuning pass: the bench, tests/integration/bench.mjs: mortal bots, whole fights, opt-in)
S.bench = async () => { const { benchScenario } = await import('./bench.mjs'); return benchScenario({ build, duel, run, TUNING, TELL, DT, THREE, out, mulberry32 }, 'veil'); };
S.motionaudit = scenarioMotionAudit; // (motion: opt-in, printed)
S.anatomy = scenarioAnatomy; // (ADR-255: opt-in, printed)
// (motion: WJ_MOTION=a|b|c plays every scenario with that take of his melee motion, ?wjMotion)
if (process.env.WJ_MOTION) (await imp('src/entities/enemies/duelist/lookSwitch.js')).setLook('wjMotion', process.env.WJ_MOTION);
const OPT_IN = new Set(['bench', 'motionaudit', 'anatomy']);
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
out(fails ? `\nVEIL: ${fails} FAILED` : '\nVEIL: ALL PASSED');
process.exit(fails ? 1 : 0);

// fx: the fx scenario's body (a function declaration: hoisted, so it can live down here, out of the others' way)
/** Every WjFx method called with the contract's arguments for 120 frames (no throw, no NaN: the harness's
 *  pools throw on a NaN), every debug driver played through, and the slots: crimson fire in the fight,
 *  azure void at rest, violet under the Null, both back on a reset and from his death. */
async function scenarioFx() {
  out('\n== scenario FX (every WjFx method, 120 frames; the drivers; the three slots restored) ==');
  const { FIRE_PALETTES } = await imp('src/render/firePalettes.js');
  const { VIOLET } = await imp('src/entities/enemies/untouched/fx.js');
  const FXD = await imp('src/entities/enemies/untouched/fxDebug.js');
  const G = build();
  const d = G.game.dragon, p = G.game.player, F = d.fx, fire = G.game.fx.fire;
  const PALS = ['fire', 'void', 'steel'];
  /** Does slot `kind` hold palette `pal` (its stops x hdr in the print's uniforms)? */
  const holds = (kind, pal) => {
    const i = PALS.indexOf(kind), S = fire.printMat.uniforms.uStops.value, h = pal.hdr ?? 0.6;
    for (let j = 0; j < 5; j++) {
      const v = S[i * 5 + j], st = pal.stops[j];
      if (Math.abs(v.x - st[0] * h) > 1e-4 || Math.abs(v.y - st[1] * h) > 1e-4 || Math.abs(v.z - st[2] * h) > 1e-4) return false;
    }
    return true;
  };
  assert(holds('void', FIRE_PALETTES.azure) && holds('fire', FIRE_PALETTES.fire), `built: void azure, fire the engine's (${F.slots.void}, ${F.slots.fire})`);
  duel(G, { dist: 4 });
  p.debug.god = true;
  // (round 2) the fire slot is crimson only while a red thing of his lives: at rest in the fight the bonfire burns as fire
  assert(holds('fire', FIRE_PALETTES.fire) && F.slots.fire === 'fire', `in the fight at rest: the fire slot the engine's (${F.slots.fire})`);
  F.castMark(d.position.x, d.position.z + 3, 4.5, 0.5);
  run(G, 0.05);
  assert(holds('fire', FIRE_PALETTES.crimson) && F.slots.fire === 'crimson', `a red cue of his on: the fire slot crimson (${F.slots.fire})`);
  run(G, 1.0);
  assert(F.slots.fire === 'fire', `the red cue gone: the fire slot the engine's again (${F.slots.fire})`);
  const x0 = d.position.x, z0 = d.position.z;
  const knot = { on: true, x: x0, z: z0 + 3, r: 7, strength: 3, falloff: 1, life: 2, t: 0, k: 0, id: 77 };
  const seg = { ax: x0, az: z0 + 0.8, bx: x0, bz: z0 + 40, w: 5 };
  const pt = { x: x0, y: 1.2, z: z0 + 2, k: 1 };
  const once = () => {
    F.barrierStop({ x: x0, y: 1.2, z: z0 + 0.6 }, { x: 0, z: -1 }, false);
    F.barrierStop({ x: x0, y: 1.4, z: z0 + 0.6 }, { x: 0, z: -1 }, true);
    F.barrierCrack(1, 3);
    F.barrierCrack(2, 3);
    F.barrierOpen(d);
    F.barrierClose(d);
    F.blinkOut(d);
    F.afterimage(d, 0.5, 0, 0.4);
    F.vanish(d, x0, z0, x0 + 1, z0);
    F.blinkIn(d);
    F.drawCollapse(knot);
    F.castBurst(x0, z0 + 3, 4.5, 1.5);
    F.nullEnd(seg);
    F.domainBreak(x0, z0 + 2);
    F.shove(p.position.x, p.position.z, 0, 1, 3.6);
    F.crash(p.position.x, p.position.z, 0, 1, 1.5);
    for (const k of ['light', 'heavy', 'huge', 'spell', 'null', 'block', 'nope']) F.weight(k, 0, 1);
  };
  let threw = null, peak = 0, violet = false;
  const err0 = errors.length;
  for (let i = 0; i < 120; i++) {
    const k = i / 119;
    try {
      F.barrierIdle(d, DT);
      F.eyes(d, 1);
      knot.t = k * knot.life;
      knot.k = k;
      F.drawKnot(knot, DT);
      F.castPoint(pt, DT);
      F.nullCharge(d, Math.min(1, k * 1.3), null, i % 2 ? { x: x0 + 0.3, y: 1.6, z: z0 } : null);
      F.nullBeam(seg, k);
      if (holds('void', VIOLET)) violet = true;
      F.domainSign(d, k);
      F.domainWall(x0, z0, 40 * (1 - k) + 1, k);
      F.domainCaught(p, k);
      if (i === 10) once();
      // (the bad arguments a caller might pass: nothing drawn, nothing thrown)
      F.drawKnot(null, DT);
      F.drawKnot({ x: NaN, z: 0 }, DT);
      F.castPoint({ x: 0, y: NaN, z: 0 }, DT);
      F.nullBeam({ ax: 0, az: 0, bx: 0, bz: 0 }, k);
      F.nullBeam(null, k);
      F.domainWall(NaN, 0, 40, k);
      F.domainCaught(null, k);
      F.shove(0, 0, 0, 0, 3);
      F.crash(NaN, 0, 1, 0, 1);
      F.barrierStop(null, null, false);
      F.nullLine(null, k);
      F.nullLine({ ax: 0, az: 0, bx: NaN, bz: 0 }, k);
      F.unveil(null, k);
      F.sparkCharge(null, k);
      F.sparkHit(NaN, 1, 0, 1, 0, true);
      F.sparkHit(0, 1, 0, 0, 0, true);
      F.ghostStrike(NaN, 0, 0, k);
      F.castMark(NaN, 0, 4, k);
      F.drawPath(null, k);
      F.liftGlow(0, NaN, 0, 1, k);
      F.fallMark(0, NaN, 2, k);
      G.tick(DT);
    } catch (e) {
      threw = e;
      break;
    }
    peak = Math.max(peak, fire.count);
  }
  assert(!threw, `120 frames of every method: no throw, no NaN (${threw?.stack?.split('\n').slice(0, 2).join(' | ') ?? ''})`);
  assert(errors.length === err0, `no console errors (${errors.slice(err0, err0 + 3).join(' / ')})`);
  assert(violet, 'the void slot turns violet under the Null');
  out(`     fire blobs alive at the peak, everything at once: ${peak} of ${fire.max}`);
  assert(peak < fire.max, `the pool never fills with everything at once (${peak} < ${fire.max})`);
  // (round 2) the new per-frame methods, 120 frames together (their own pool count: headless, a line on
  // the letter grid falls back to a blob every 0.1 m, so the counts here are far over the game's)
  let peak2 = 0, threw2 = null;
  run(G, 1.2);
  for (let i = 0; i < 120; i++) {
    const k = i / 119;
    try {
      F.nullLine(seg, k);
      F.unveil(d, k);
      F.sparkCharge(d, k, i % 2 ? 'L' : 'R');
      F.ghostStrike(x0 + 2, z0 + 2, 0.5, k);
      F.castMark(x0, z0 + 3, 4.5, k);
      F.drawPath({ ax: x0 - 6, az: z0, bx: x0 + 6, bz: z0 + 4 }, k);
      F.liftGlow(x0 - 3, 3, z0, 1.2, k);
      F.fallMark(x0 + 3, z0 + 3, 2, k);
      if (i === 60) {
        F.sparkHit(x0, 1.3, z0 + 1, 0, 1, true);
        F.sparkHit(x0, 1.3, z0 + 1, 0, 1, false);
      }
      G.tick(DT);
    } catch (e) {
      threw2 = e;
      break;
    }
    peak2 = Math.max(peak2, fire.count);
  }
  assert(!threw2, `120 frames of the round-2 methods: no throw, no NaN (${threw2?.stack?.split('\n').slice(0, 2).join(' | ') ?? ''})`);
  out(`     fire blobs alive at the peak, the round-2 methods at once (headless): ${peak2} of ${fire.max}`);
  assert(peak2 < fire.max, `the pool never fills with the round-2 methods at once (${peak2} < ${fire.max})`);
  // the drivers (dragon.debug.fx): each plays through
  let bad = [];
  for (const n of FXD.NAMES) {
    if (n === 'stopAll') continue;
    const ok = d.debug.fx(n, {});
    let thrown = null;
    try {
      run(G, (F._drive?.T ?? 0.2) + 0.3);
    } catch (e) {
      thrown = e;
    }
    if (!ok || thrown || F._drive) bad.push(`${n}${thrown ? ': ' + thrown.message : ''}`);
    d.barrier.close();
  }
  assert(!bad.length && d.debug.fx('nope') === false, `every driver plays through and ends (${FXD.NAMES.length - 1}); an unknown name is false ${JSON.stringify(bad)}`);
  // the slots come back: a reset, his death
  F.nullBeam(seg, 0.5);
  F.castPoint(pt, DT);
  d.reset();
  assert(holds('void', FIRE_PALETTES.azure) && holds('fire', FIRE_PALETTES.fire), `reset: void azure, fire the engine's again (${F.slots.void}, ${F.slots.fire})`);
  duel(G, { dist: 4 });
  F.nullBeam(seg, 0.5);
  F.castPoint(pt, DT);
  run(G, 0.1);
  assert(F.slots.fire === 'crimson' && F.slots.void === 'violet', `back in the fight: crimson, violet under a Null (${F.slots.fire}, ${F.slots.void})`);
  run(G, 0.6);
  assert(holds('void', FIRE_PALETTES.azure), `the Null over: void azure again (${F.slots.void})`);
  d.debug.kill();
  run(G, 0.3);
  assert(holds('fire', FIRE_PALETTES.fire), `his death: the fire slot the engine's again (${F.slots.fire}, mode ${d.mode})`);
  // the sounds: every name an effect emits has its recipe
  const { SFX } = await imp('src/audio/sfx.js');
  const said = new Set();
  const G2 = build();
  G2.watch = (n, e) => { if (n === 'dragon:spell' && String(e?.name).startsWith('wj')) said.add(e.name); };
  duel(G2, { dist: 4 });
  G2.game.player.debug.god = true;
  for (const n of ['stop', 'barrier', 'blink', 'draw', 'cast', 'null', 'sign', 'wall', 'shove', 'unveil', 'spark']) {
    G2.game.dragon.debug.fx(n, {});
    run(G2, (G2.game.dragon.fx._drive?.T ?? 0.2) + 0.3);
  }
  const missing = [...said].filter((n) => !SFX[n]);
  assert(said.size >= 12 && !missing.length, `every effect's sound has a recipe (${[...said].join(' ')}; missing ${JSON.stringify(missing)})`);
  return G;
}

// melee: the melee agent's scenarios (function declarations: hoisted, out of the others' way)
/** One move of his triggered with the hero `dist` m in front (god mode), answered `how`: 'block' (the guard
 *  held all through, the meter kept full: pure reach), 'hit' (no answer), 'parry' (every guard cue parried,
 *  a roll through every red one). Returns the realised hits, the results, the spared, the longest stretch
 *  the hero was not his own (stagger / knockdown / guard break; gaps under 0.2 s merged). */
function meleeRun(G, name, how, { dist = 2, ang = 0 } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  d.debug.tidy();
  d.brain.act = null;
  d.mode = 'foot';
  d.position.set(0, 0, -2);
  d.yaw = 0;
  run(G, 0.3);
  // (the hero on his feet first: a run before may have left him down)
  run(G, 3, null, () => ['idle', 'run'].includes(p.state));
  place(G, dist, ang);
  p.debug.god = true;
  p.guard = 100;
  input.axis = { x: 0, y: 0 };
  const h0 = G.hits.length, sp0 = d.parts.melee?.stats.spared ?? 0;
  const ok = d.brain.trigger(name);
  const A = d.brain.act;
  const hits = A?.hits ?? 0;
  const flashes = [];
  const w0 = G.watch;
  const pend = [];
  G.watch = (n, e) => {
    if (n === 'combat:flash' && e?.source === 'dragon' && e.attack === name) {
      flashes.push({ t: game.time, tell: e.tell, bx: d.position.x, bz: d.position.z, px: p.position.x, pz: p.position.z, yaw: p.yaw });
      pend.push({ at: game.time + TUNING.flashLead, tell: e.tell, done: false });
    }
  };
  let acted = false, stunT = 0, stunMax = 0, gap = 0;
  run(G, 9, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (how === 'block') { input.press(1); p.guard = 100; }
    if (how === 'parry') {
      for (const e of pend) {
        if (e.done) continue;
        const left = e.at - game.time - DT;
        if (e.tell === TELL.RED && left <= 0.08) {
          e.done = true;
          const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
          input.axis = { x: -dz / l, y: -dx / l };
          input.tap('Space');
        } else if (e.tell !== TELL.RED && left <= 0.12) {
          e.done = true;
          input.up(1);
          input.click(1);
        }
      }
    }
    const stun = ['stagger', 'knockdown', 'guardBreak'].includes(p.state);
    if (stun) { stunT += DT + gap; gap = 0; stunMax = Math.max(stunMax, stunT); } else if (stunT > 0) { gap += DT; if (gap >= 0.2) { stunT = 0; gap = 0; } }
  }, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && p.state !== 'roll'; });
  G.watch = w0;
  input.up(1);
  input.axis = { x: 0, y: 0 };
  const res = G.hits.slice(h0).filter((h) => h.attack === name && h.r !== RESULT.IGNORED);
  return { ok, hits, reached: res.length, res: res.map((h) => h.r), spared: (d.parts.melee?.stats.spared ?? 0) - sp0, stopped: A?.stopped ?? null, stunMax, flashes, A };
}

/** STRINGS (the melee agent's item 4): every string of his reaches a hero who blocks every beat (slid
 *  3 - 5 m each time) and one who is hit by every beat (thrown 2.5 - 7 m): no later beat swings at air;
 *  the hero is never his own for longer than a knockdown. */
async function scenarioStrings() {
  out('\n== scenario STRINGS (his strings follow the slide: beats that reach a hero who blocks every one, and one hit by every one) ==');
  const { MOVE_OWNERS } = await imp('src/entities/enemies/untouched/moves.js');
  const names = MOVE_NAMES.filter((n) => MOVE_OWNERS[n] === 'melee' && !MOVES[n].counter && !MOVES[n].transition && MOVES[n].beats.filter((b) => !b.feint && !b.pick?.every((x) => x.feint)).length >= 2);
  const rows = [];
  for (const ph of [1, 2, 3]) {
    const G = build();
    duel(G, { dist: 3, form: ph });
    for (const name of names) {
      const def = MOVES[name];
      if (def.phase > ph || !(weightIn(def, ph) > 0)) continue;
      for (const how of ['block', 'hit']) {
        const r = meleeRun(G, name, how);
        rows.push({ ph, name, how, ...r });
      }
    }
  }
  out('   phase  move          answer  beats  reached  spared  stopped  results                         longest not-his-own');
  for (const r of rows) out(`   P${r.ph}     ${r.name.padEnd(13)} ${r.how.padEnd(7)} ${String(r.hits).padStart(5)} ${String(r.reached).padStart(8)} ${String(r.spared).padStart(7)}  ${String(r.stopped ?? '-').padEnd(7)}  ${r.res.join(',').padEnd(30)}  ${r.stunMax.toFixed(2)} s`);
  for (const r of rows) {
    // (a beat the hero's knockdown spared, and the doubled Dark Spark's second after a first that landed, are no miss)
    const want = r.stopped ? r.res.length : r.hits - r.spared;
    assert(r.ok && r.reached === want && want >= (r.how === 'hit' || r.stopped ? 1 : r.hits), `P${r.ph} ${r.name} (${r.how}): ${r.reached} of ${r.hits} beats reach him (${r.spared} spared, stopped ${r.stopped ?? 'no'})`);
  }
  const worst = rows.reduce((m, r) => Math.max(m, r.stunMax), 0);
  assert(worst <= TUNING.melee.mercy.lockCap + 0.1 + 1e-6 || worst <= 1.3 + 0.05, `the hero hit by every beat of every string is never out of his own hands longer than ${worst.toFixed(2)} s in a row (gaps under 0.2 s do not end it; the cap ${TUNING.melee.mercy.lockCap} s, a knockdown alone 1.3 s)`);
}

/** SIDES: a blow out of a blink holds from any side (a guard held facing away blocks it); Everywhere's three
 *  cues come one at a time, >= minHitGap apart, each from another side, each after he stands there. */
async function scenarioSides() {
  out('\n== scenario SIDES (a blow out of a blink holds from any side; Everywhere: three cues apart, three sides) ==');
  {
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 3 });
    // the hero guards facing AWAY from him: the blink behind him is still met
    // (Behind You draws a blue back kick or a red heel: the blue one is met by the guard, both come around)
    const got = [];
    for (let i = 0; i < 6 && !got.some((x) => x.tell === TELL.BLUE); i++) {
      const r = meleeRun(G, 'behindYou', 'block', { dist: 3 });
      got.push({ tell: r.A?.beats[0]?.def.tell, res: r.res[0], around: !!G.hits.at(-1)?.around });
    }
    out(`   Behind You, guarded: ${got.map((x) => `(${x.tell}: ${x.res}${x.around ? ', around' : ''})`).join(' ')}`);
    assert(got.every((x) => x.around) && got.some((x) => x.tell === TELL.BLUE) && got.every((x) => (x.tell === TELL.BLUE ? x.res === RESULT.BLOCKED : x.res === RESULT.HIT)), 'Behind You, guarded: out of the blink it comes around; the blue kick is blocked from behind, the red heel is not blockable');
    void d, p;
  }
  const G = build();
  const d = G.game.dragon, p = G.game.player;
  duel(G, { dist: 3, form: 3 });
  let ghosts = 0;
  const g0 = d.fx.ghostStrike;
  d.fx.ghostStrike = (...a) => { ghosts++; return g0?.apply(d.fx, a); };
  for (const how of ['block', 'parry']) {
    const r = meleeRun(G, 'everywhere', how, { dist: 3 });
    const F = r.flashes;
    const gaps = F.slice(1).map((f, i) => f.t - F[i].t);
    // the side each cue came from: his bearing round the hero (world: the hero turns to face each blow)
    const sides = F.map((f) => Math.atan2(f.bx - f.px, f.bz - f.pz));
    const apart = sides.every((a, i) => sides.every((b, j) => i === j || Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.9));
    out(`   Everywhere (${how}): cues ${F.map((f) => f.tell).join(', ')}; ${gaps.map((g) => g.toFixed(2)).join(' / ')} s apart; from ${sides.map((a) => ((a * 180) / Math.PI).toFixed(0)).join(' / ')} deg; results ${r.res.join(',')}`);
    assert(F.length === 3 && F.map((f) => f.tell).join() === [TELL.BLUE, TELL.BLUE, TELL.RED].join(), `Everywhere (${how}): three cues, blue, blue, red`);
    assert(gaps.every((g) => g >= TUNING.minHitGap - 1e-6), `Everywhere (${how}): the cues ${gaps.map((g) => g.toFixed(2)).join(' / ')} s apart (>= ${TUNING.minHitGap})`);
    assert(apart, `Everywhere (${how}): each cue from another side`);
    if (how === 'block') assert(r.res.slice(0, 2).every((x) => x === RESULT.BLOCKED), `Everywhere: the two blue blows met by a guard from any side (${r.res.join(',')})`);
    if (how === 'parry') assert(r.res.length === 3 && r.res[2] === RESULT.PERFECT, `Everywhere: answered, the red one is a perfect dodge (${r.res.join(',')})`);
  }
  out(`   (fx.ghostStrike called ${ghosts} times${g0 ? '' : ': not built yet, the call is guarded'})`);
  void p;
}

/** SPARK: Dark Spark is red; landed it throws 10 m and through the first piece behind the hero; a miss
 *  buries the fist in the piece on its line. */
async function scenarioSpark() {
  out('\n== scenario SPARK (Dark Spark: red; landed: 10 m through the scenery; a miss breaks the piece on its line) ==');
  const def = MOVES.darkSpark;
  assert(def.beats.every((b) => b.tell === TELL.RED) && def.beats[0].knockback >= 9 && def.beats[0].wjCrash > 3, `red, ${def.beats[0].knockback} m, crash power ${def.beats[0].wjCrash}`);
  {
    // landed: a car 3 m behind the hero
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 3, form: 2 });
    const car = pieces(G, 'car')[0];
    d.debug.tidy();
    d.position.set(car.x, 0, car.z - 5);
    d.yaw = 0;
    p.debug.teleport(car.x, car.z - 3);
    p.yaw = Math.PI;
    p.debug.heal();
    p.debug.god = false;
    run(G, 0.1);
    const hp0 = p.hp, car0 = car.hp, x0 = p.position.x, z0 = p.position.z;
    d.brain.trigger('darkSpark');
    let acted = false;
    run(G, 4, () => G.game.mouseGround.set(d.position.x, 0, d.position.z), () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act'; });
    const thrown = Math.hypot(p.position.x - x0, p.position.z - z0);
    out(`   landed: ${(hp0 - p.hp).toFixed(0)} damage, thrown ${thrown.toFixed(2)} m, ${p.crash.hits.length} piece(s) gone through; the car ${car.state === 0 ? `hp ${car0.toFixed(2)} -> ${car.hp.toFixed(2)}` : 'broke'}; sparks ${JSON.stringify(d.parts.melee.stats.sparks)}`);
    assert(hp0 - p.hp > 0 && d.parts.melee.stats.sparks.landed === 1, 'it lands');
    assert(p.crash.hits.length >= 1 && (car.state !== 0 || car.hp < car0), 'the hero goes through the car behind him');
  }
  {
    // a miss: the hero rolls out; the fist is buried in the car on its line
    const G = build();
    const d = G.game.dragon, p = G.game.player;
    duel(G, { dist: 3, form: 2 });
    const car = pieces(G, 'car')[0];
    d.debug.tidy();
    d.position.set(car.x, 0, car.z - 6);
    d.yaw = 0;
    p.debug.teleport(car.x, car.z - 3.8);
    p.debug.heal();
    p.debug.god = true;
    run(G, 0.1);
    const car0 = car.hp;
    const step = answer(G, 'dodge', 'darkSpark');
    d.brain.trigger('darkSpark');
    let acted = false;
    run(G, 4, step, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && p.state !== 'roll'; });
    G.watch = null;
    const S = d.parts.melee.stats.sparks;
    out(`   dodged: sparks ${JSON.stringify(S)}; the car on his line ${car.state === 0 ? `hp ${car0.toFixed(2)} -> ${car.hp.toFixed(2)}` : 'broke'}; barrier ${d.barrier.up ? 'up' : `open (${d.barrier.why})`}`);
    assert(S.missed === 1 && S.buried === 1 && (car.state !== 0 || car.hp < car0), 'a miss buries the fist in the car on its line');
    assert(!d.barrier.up && d.barrier.why === 'dodge', 'the perfect dodge opened his barrier');
  }
}

/** MIX (the melee agent's item 7): the tells his AI throws per phase against the pace defender (god mode,
 *  roaming as PACE does), GCD_MSECS s a phase (default 90), seed GCD_SEED: the share of normal / blue / red
 *  cues and the cues a minute of each; no one answer (a guard, a roll) holds a phase alone. */
async function scenarioMix() {
  out('\n== scenario MIX (his tell mix per phase: normal / blue / red, cues a minute) ==');
  const SECS = Number(process.env.GCD_MSECS ?? 90);
  for (let ph = 1; ph <= 3; ph++) {
    const G = build(SEED + ph, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 3, ai: true, form: ph });
    p.debug.god = true;
    p.debug.noRiposte = true;
    G.defend = paceDefender(G);
    const tells = { [TELL.NORMAL]: 0, [TELL.BLUE]: 0, [TELL.RED]: 0, [TELL.BLACK]: 0 };
    const seq = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && !MOVES[e.attack]?.transition) { tells[e.tell] = (tells[e.tell] ?? 0) + 1; seq.push(e.tell === TELL.RED || e.tell === TELL.BLACK ? 'dodge' : 'guard'); } };
    const roam = mulberry32(SEED * 13 + ph), goal = { r: 2.5, a: 0, until: -1 };
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
    }
    G.watch = null;
    G.defend = null;
    const T = (game.time - t0) / 60, all = Object.values(tells).reduce((a, b) => a + b, 0) || 1;
    let run1 = 0, runMax = 0;
    for (let i = 0; i < seq.length; i++) { run1 = i && seq[i] === seq[i - 1] ? run1 + 1 : 1; runMax = Math.max(runMax, run1); }
    const sh = (t) => tells[t] / all;
    out(`   P${ph}: ${(all / T).toFixed(1)} cues/min · normal ${(sh(TELL.NORMAL) * 100).toFixed(0)} % (${(tells[TELL.NORMAL] / T).toFixed(1)}/min) · blue ${(sh(TELL.BLUE) * 100).toFixed(0)} % (${(tells[TELL.BLUE] / T).toFixed(1)}/min) · red ${(sh(TELL.RED) * 100).toFixed(0)} % (${(tells[TELL.RED] / T).toFixed(1)}/min) · longest run of one answer ${runMax}; melee stats ${JSON.stringify(d.parts.melee?.stats ?? {})}`);
    assert(sh(TELL.NORMAL) >= 0.12 && sh(TELL.BLUE) >= 0.12 && sh(TELL.RED) >= 0.12, `P${ph}: every tell is at least 12 % of his cues (neither holding the guard, nor parrying, nor rolling answers the phase alone)`);
  }
}

/** CHASE: in phase 3 a hero thrown 5 m or more finds him standing where he stops (a reposition: no blow),
 *  once per cooldown; never in phases 1 - 2. */
async function scenarioChase() {
  out('\n== scenario CHASE (phase 3: thrown, the hero finds him where he stops; once per cooldown) ==');
  const C = TUNING.melee.chase, ch0 = C.chance;
  C.chance = 1;
  try {
    for (const ph of [2, 3]) {
      const G = build();
      const d = G.game.dragon, p = G.game.player;
      duel(G, { dist: 3, form: ph });
      const blinks = [];
      G.watch = (n) => { if (n === 'dragon:windup') blinks.push(n); };
      const r = meleeRun(G, 'twoHands', 'hit');
      run(G, 1.2);
      const gap = Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z);
      const S = d.parts.melee.stats;
      out(`   P${ph}: ${r.res.join(',')}; chases ${S.chases}; he stands ${gap.toFixed(2)} m from the hero after; next chase in ${d.parts.melee.chaseT.toFixed(1)} s`);
      if (ph === 2) assert(S.chases === 0, 'phase 2: no chase');
      else {
        assert(S.chases === 1 && gap < C.off + 1.2, `phase 3: thrown 8 m, the hero finds him there (${gap.toFixed(2)} m)`);
        const r2 = meleeRun(G, 'twoHands', 'hit');
        run(G, 1.2);
        assert(d.parts.melee.stats.chases === 1, `once per cooldown (${C.cooldown} s): the next throw is not chased (${r2.res.join(',')})`);
      }
      G.watch = null;
    }
  } finally {
    C.chance = ch0;
  }
}

// ================================================================== terrain: the terrain agent's scenarios
// (function declarations: hoisted, so they live down here, out of the others' way; entries in S at
// `// terrain: scenarios`)
/** His terrain handler (moves/terrain.js, terrain.js), the pace limit off (moves back to back). */
function trOf(G) {
  const t = G.game.dragon.parts.terrain;
  t.paced = false;
  return t;
}
/** The world's floor marks of a run (the harness's world has no groundBlow: recorded here). */
function trMarks(G) {
  const marks = [];
  G.game.world.groundBlow = (x, z, o) => { if (![x, z].every(Number.isFinite)) throw new Error('NaN groundBlow'); marks.push({ x, z, kind: o?.kind, power: o?.power }); };
  return marks;
}
/**
 * Trigger terrain move `name` with the hero `dist` m before him; answer each of its cues by `hows[i]`
 * ('parry' | 'perfect' | 'dodge' | 'guard' | 'none' | 'walk': walk off sideways as the place is fixed);
 * run until he is back in footwork and nothing of his is in the air. Returns its cues, hits, damage.
 */
function trRun(G, name, hows, { dist = 8, max = 10, god = false, ang = 0 } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player, t = trOf(G);
  place(G, dist, ang);
  p.debug.god = god;
  p.debug.heal();
  const flashes = [], tells = [], due = [];
  G.watch = (n, e) => {
    if (e?.attack !== name) return;
    if (n === 'combat:tell') tells.push({ t: game.time, x: e.x, z: e.z, impactIn: e.impactIn });
    if (n !== 'combat:flash') return;
    const i = flashes.length, how = hows[Math.min(i, hows.length - 1)];
    flashes.push({ t: game.time, tell: e.tell, hazard: !!e.hazard, x: e.x, z: e.z });
    const lead = { parry: 0.25, perfect: 0.04, dodge: 0.1 }[how]; // (ADR-227: an ordinary parry 0.20 - 0.22 s before the impact; the press lands a frame later)
    if (lead !== undefined) due.push({ at: game.time + TUNING.flashLead - lead, how, x: e.x, z: e.z, hazard: !!e.hazard });
  };
  const hp0 = p.hp, h0 = G.hits.length, g0 = G.counts['player:guardOpen'] ?? 0;
  const ok = d.brain.trigger(name);
  let acted = false, walked = false;
  run(G, max, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (hows.includes('guard')) input.press(1);
    if (hows[0] === 'walk' && !walked && t.drops.some((D) => D.live && D.fixed)) { walked = true; input.axis = { x: 1, y: 0 }; }
    if (hows[0] === 'walk' && !walked && t.line.live) { walked = true; const L = t.line; input.axis = { x: -L.dz, y: -L.dx }; }
    for (const e of due) {
      if (e.done || game.time < e.at) continue;
      e.done = true;
      if (e.how === 'parry' || e.how === 'perfect') { input.up(1); input.click(1); }
      else if (e.how === 'dodge') {
        const o = e.hazard ? { x: e.x, z: e.z } : d.position, dx = p.position.x - o.x, dz = p.position.z - o.z, l = Math.hypot(dx, dz);
        input.axis = l > 0.3 ? { x: dx / l, y: -dz / l } : { x: 1, y: 0 };
        input.tap('Space');
      }
    }
  }, () => {
    if (d.mode === 'act') acted = true;
    return acted && d.mode === 'foot' && !t.busy && !['roll', 'knockdown', 'stagger'].includes(p.state);
  });
  G.watch = null;
  input.up(1);
  input.axis = { x: 0, y: 0 };
  run(G, 0.2);
  const hits = G.hits.slice(h0).filter((h) => h.attack === name);
  return { ok, flashes, tells, hits, dhp: hp0 - p.hp, opened: (G.counts['player:guardOpen'] ?? 0) - g0 };
}
function trStanding(G, kinds) {
  return G.game.world.destructibles.list.filter((b) => kinds.includes(b.kind) && b.state === 0 && !b.absent);
}
/** Put every standing piece of `kinds` out of the world (the arena spent of them). */
function trSpend(G, kinds) {
  const W = G.game.world.destructibles;
  for (const b of W.list) if (kinds.includes(b.kind) && !b.absent) W.present(b, false);
}

async function scenarioCurb() {
  out('\n== scenario CURB (Curb Pull: a car or a slab found by kind; one blue cue; a parry cuts it, no health; a guard is opened; unanswered it lands; none left: refused) ==');
  const KINDS = TUNING.terrain.curb.kinds;
  for (const how of ['parry', 'none', 'guard']) {
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 8 });
    const marks = trMarks(G);
    let taken = null;
    const W = G.game.world.destructibles, take = W.take.bind(W);
    W.take = (b) => { if (!taken && b && !b.floor) taken = b; return take(b); };
    const r = trRun(G, 'curbPull', [how]);
    const res = r.hits.map((h) => h.r).join(',');
    out(`   ${how}: ${taken?.kind} at ${taken?.x.toFixed(1)}, ${taken?.z.toFixed(1)} (${taken ? Math.hypot(taken.x - d.position.x, taken.z - d.position.z).toFixed(1) : '-'} m from him); cues ${r.flashes.map((f) => f.tell).join(',')}; result ${res}; -${r.dhp} hp; split ${t.stats.split}; marks ${marks.length}`);
    assert(r.ok && taken && KINDS.includes(taken.kind) && taken.state !== 0, `${how}: Curb Pull lifts a ${taken?.kind} (found by kind) and it is spent`);
    assert(r.flashes.length === 1 && r.flashes[0].tell === TELL.BLUE, `${how}: one cue, blue (${r.flashes.map((f) => f.tell).join(',')})`);
    if (how === 'parry') assert(res === RESULT.PARRIED && r.dhp === 0 && t.stats.split === 1 && G.counts['dragon:split'] === 1, 'parried: cut in two, its halves burst behind him, no health');
    if (how === 'none') assert(res === RESULT.HIT && r.dhp > 0 && marks.some((m) => m.kind === 'slam'), `unanswered: it lands on him (-${r.dhp}) and leaves a slam's mark`);
    if (how === 'guard') assert(res === RESULT.BLOCKED && r.dhp === 0 && r.opened === 1, `a held guard is opened, no health (${res}, guardOpen ${r.opened})`);
  }
  {
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 8 });
    trSpend(G, KINDS);
    const w = t.weigh('curbPull', MOVES.curbPull, 1, 8);
    const ok = d.brain.trigger('curbPull');
    run(G, 0.5);
    assert(!ok && w === 0 && t.stats.refused >= 1 && d.mode === 'foot', `no car or slab left: weighed ${w}, refused (${t.stats.refused})`);
  }
}

async function scenarioDown() {
  out('\n== scenario DOWN (Bring It Down: the top nearest the hero; red; the place fixed and told before it lands; a crater mark; walked off the place it misses; no top left: refused) ==');
  const rows = [];
  for (const how of ['none', 'walk', 'dodge']) {
    const G = build();
    const t = trOf(G);
    duel(G, { dist: 6, form: 2 });
    const marks = trMarks(G);
    const tops0 = trStanding(G, ['towerTop']).length;
    let fix = null, landed = null;
    const tl = t._dropLanded.bind(t);
    t._dropLanded = (D, x, z) => { landed = { x, z, t: G.game.time, y: D.piece ? D.piece.y0 + D.piece.pivot.position.y : NaN, y0: D.piece?.y0 }; return tl(D, x, z); };
    const f0 = t.frame.bind(t);
    t.frame = (dt) => { f0(dt); const D = t.drops.find((x) => x.live && x.fixed); if (D && !fix) fix = { x: D.tx, z: D.tz, t: G.game.time }; };
    const r = trRun(G, 'bringDown', [how], { dist: 6, max: 12 });
    const tops = trStanding(G, ['towerTop']).length;
    const crater = marks.some((m) => m.kind === 'slam' && m.power >= 1.2 && landed && Math.hypot(m.x - landed.x, m.z - landed.z) < 0.5);
    rows.push({ how, r, fix, landed, tops0, tops, crater });
  }
  for (const { how, r, fix, landed, tops0, tops, crater } of rows) out(`   ${how}: cues ${r.flashes.map((f) => f.tell + (f.hazard ? '(hazard)' : '')).join(',')}, told ${r.tells.length} (${r.tells[0] ? r.tells[0].impactIn.toFixed(2) : '-'} s ahead); fixed at ${fix?.x.toFixed(1)}, ${fix?.z.toFixed(1)}, landed ${landed?.x.toFixed(1)}, ${landed?.z.toFixed(1)}; hits ${r.hits.map((h) => h.r).join(',') || 'none'}; -${r.dhp} hp; tops ${tops0} -> ${tops}; crater mark ${crater}`);
  const [none, walk, dodge] = rows;
  assert(rows.every((x) => x.r.ok && x.tops === x.tops0 - 1), 'each run tears one tower top down (found by kind)');
  assert(rows.every((x) => x.r.flashes.length === 1 && x.r.flashes[0].tell === TELL.RED && x.r.flashes[0].hazard), 'one cue, red, on the place it lands');
  assert(rows.every((x) => x.fix && x.landed && Math.hypot(x.fix.x - x.landed.x, x.fix.z - x.landed.z) < 0.05 && x.r.tells.length >= 1 && x.r.tells[0].impactIn >= 0.6), 'it lands where the place was fixed, told >= 0.6 s before');
  assert(rows.every((x) => x.crater), 'a crater mark where it lands');
  assert(rows.every((x) => x.landed && x.landed.y0 > 1 && Math.abs(x.landed.y) < 0.05), `the top (raised ${rows[0].landed?.y0} m) comes down to the floor and lands there (at ${rows.map((x) => x.landed?.y?.toFixed(2)).join(' / ')} m: throwTo ground)`);
  assert(none.r.hits.length === 1 && none.r.hits[0].r === RESULT.HIT && none.r.dhp > 0, `standing on the place: struck once (-${none.r.dhp})`);
  assert(walk.r.hits.length === 0 && walk.r.dhp === 0, 'walked off the fixed place: it misses');
  assert(dodge.r.dhp === 0, `rolled out: no health lost (${dodge.r.hits.map((h) => h.r).join(',') || 'not reached'})`);
  {
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 6, form: 2 });
    trSpend(G, ['towerTop']);
    const W = G.game.world.destructibles, take = W.take.bind(W);
    let took = null;
    W.take = (b, o) => { const r = take(b, o); if (r && !took) took = b.kind; return r; };
    const ok0 = d.brain.trigger('bringDown');
    run(G, 4);
    W.take = take;
    assert(ok0 && took === 'fallenTower', `no top left: Bring It Down tears up a section of the fallen tower instead (${took})`);
  }
  {
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 6, form: 2 });
    trSpend(G, ['towerTop', 'fallenTower']);
    const ok = d.brain.trigger('bringDown');
    run(G, 0.5);
    assert(!ok && t.weigh('bringDown', MOVES.bringDown, 1, 6) === 0 && d.mode === 'foot', 'no top and no fallen tower section left: refused');
  }
}

async function scenarioOrbit() {
  out('\n== scenario ORBIT (The Orbit: loose pieces turn round him; three cues blue, blue, red with fair gaps; answered, no health; the pieces are spent) ==');
  const G = build();
  const t = trOf(G);
  duel(G, { dist: 7, form: 2 });
  let held = 0, rMin = Infinity, rMax = 0;
  const d = G.game.dragon;
  const f0 = t.frame.bind(t);
  t.frame = (dt) => {
    f0(dt);
    const H = t.hold.filter((h) => h.piece && h.mode === 'orbit' && h.t > TUNING.terrain.orbit.liftT);
    held = Math.max(held, H.length);
    for (const h of H) { const e = Math.hypot(h.piece.px - d.position.x, h.piece.pz - d.position.z); rMin = Math.min(rMin, e); rMax = Math.max(rMax, e); }
    // the hero's blade through one of them (once): it is bitten where it passes, and stays in his hold
    if (H.length && !chip) {
      const W = G.game.world.destructibles, pc = H[0].piece, b0 = W.bitten, y = pc.y0 + pc.py + pc.h * 0.5;
      // (a cut it can take: one that would leave it under 1 hp breaks it, scenario heldbreak)
      const pw = Math.min(0.9, Math.max(0.12, (pc.hp - 1) * 0.6) / (pc.M.take.blunt ?? 1));
      const n = W.sweep(pc.px - 1.2, pc.pz, pc.px + 1.2, pc.pz, 0.3, pw, { kind: 'blunt', by: 'player', dx: 1, dz: 0, y, ya: y, yb: y, src: W.swing(), tx: 1, tz: 0 });
      chip = { n, bit: W.bitten - b0, piece: pc, state0: pc.state, hp: pc.hp };
    }
  };
  let chip = null;
  const kinds = TUNING.terrain.orbit.kinds;
  const n0 = trStanding(G, kinds).length;
  const r = trRun(G, 'theOrbit', ['parry', 'parry', 'dodge'], { dist: 7, max: 12 });
  const gaps = r.flashes.slice(1).map((f, i) => f.t - r.flashes[i].t);
  out(`   ${held} pieces turned round him at ${rMin.toFixed(2)} - ${rMax.toFixed(2)} m; cues ${r.flashes.map((f) => f.tell).join(',')}, gaps ${gaps.map((g) => g.toFixed(2)).join(' / ')} s; results ${r.hits.map((h) => h.r).join(',')}; -${r.dhp} hp; standing ${n0} -> ${trStanding(G, kinds).length}`);
  assert(r.ok && held === 3 && rMin >= 3.9 && rMax <= 5.1, `three pieces turn round him 4 - 5 m out (${held}, ${rMin.toFixed(2)} - ${rMax.toFixed(2)} m)`);
  assert(r.flashes.map((f) => f.tell).join(',') === [TELL.BLUE, TELL.BLUE, TELL.RED].join(','), 'three cues: blue, blue, red');
  assert(gaps.length === 2 && gaps[0] >= 0.34 && gaps[1] >= 0.36, `the gaps are fair (${gaps.map((g) => g.toFixed(2)).join(' / ')} s: >= 0.34, a red after a guard >= 0.36)`);
  assert(r.dhp === 0, `parried, parried, rolled: no health lost (${r.hits.map((h) => h.r).join(',')})`);
  assert(trStanding(G, kinds).length <= n0 - 3 && !t.busy, `the three pieces are spent (and what they broke landing: ${n0} -> ${trStanding(G, kinds).length})`);
  assert(chip && chip.n === 1 && chip.bit > 0 && chip.state0 === 3 && chip.hp >= 1, `the hero's blade chips a piece he holds, the carry goes on (struck ${chip?.n}, ${chip?.bit} letters off, state ${chip?.state0}, hp ${chip?.hp?.toFixed(2)})`);
}

// (the tuning pass) THE FLOOR AFTER A WHOLE FIGHT (a god-mode fencing bot, the real set, the floor marks as
// world.js lays them): how many mark glyphs are left and of what (the crossing's floor must read as a fought-on
// road, not snow), the crossing's marks hidden in the void and back on the return, and no fire left burning
// (his fight has no fire). GCD_FDBG=1: where the fire-field blobs of kind 'fire' came from.
async function scenarioFloor() {
  out('\n== scenario FLOOR (a whole fight: the marks left, the void hides the crossing\'s marks, no fire left) ==');
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const chain0 = STREAK_FX.chain;
  STREAK_FX.chain = false;
  const G = build(Number(process.env.GCD_SEED ?? 4242), true);
  const { game } = G;
  const d = game.dragon, W = game.world, SC = W.scars, F = game.fx.fire;
  // (the floor marks as world.js lays them: the harness's world has neither)
  const { SCAR } = await imp('src/world/breakTuning.js');
  W.groundBlow = (x, z, o) => { if (Number.isFinite(x + z) && o && o.power > 0) SC.mark(x, z, o); };
  const imp0 = W.impact;
  W.impact = (x, z, r, power, o) => { const n = imp0(x, z, r, power, o); if (o?.scar !== false && power >= SCAR.ground.min) SC.impactMark(x, z, r, power, o); return n; };
  const src = {};
  for (const k of ['mark', 'ground', 'crater', 'object', 'rubble']) {
    const f0 = SC[k].bind(SC);
    SC[k] = (...a) => { const n0 = SC.marks.length; const r = f0(...a); const key = k === 'mark' ? `mark:${a[2]?.kind}` : k; src[key] = (src[key] || 0) + Math.max(0, SC.marks.length - n0); return r; };
  }
  const fireBy = {}, outBy = {};
  let outlive = 0, orangeF = 0, orangeMax = 0;
  const fin0 = (v) => (Number.isFinite(v) ? v : 0);
  const sp = F.spawn.bind(F);
  F.spawn = (o) => {
    if (o?.kind === 'fire' || o?.kind === 0) {
      const at = process.env.GCD_FDBG ? new Error().stack.split('\n').slice(2, 5).map((l) => l.trim().replace(/^at /, '').replace(/\(.*[\\/]/, '(')).join(' < ') : 'fire';
      fireBy[at] = (fireBy[at] || 0) + 1;
      // (one that outlives the crimson the fire slot holds now prints in the fire slot's own orange)
      if (fin0(o.life) > fin0(d.fx?._crimsonT)) { outlive++; outBy[at] = (outBy[at] || 0) + 1; }
    }
    return sp(o);
  };
  duel(G, { dist: 3, ai: true });
  G.defend = makeDefender(G, { world: true });
  let inVoid = null, back = null, voidAt = -1;
  const shown = (n) => { let v = 0; const D = SC.sys?.data; if (!D) return -1; for (let i = 0; i < Math.min(n, SC.sys.count); i++) if (D[i * 26 + 16] > 0.01) v++; return v; };
  let n0 = 0;
  G.watch = (n, e) => { if (n === 'world:scene' && e?.id === 'void') { voidAt = game.time; n0 = SC.marks.length; } };
  const won = run(G, 600, () => {
    fencer(G);
    if (d.fx?.slots?.fire === 'fire') { let k = 0; for (let i = 0; i < F.count; i++) if ((F.data[i * 15 + 12] | 0) === 0) k++; if (k) { orangeF++; orangeMax = Math.max(orangeMax, k); } }
    if (voidAt > 0 && inVoid === null && game.time > voidAt + 3) { W.scars.update(0, game.time); inVoid = { n0, shown: shown(n0), total: SC.marks.length, scene: W.forest.scenes.now }; }
  }, () => d.mode === 'dead' || game.state === 'victory');
  run(G, 4);
  W.scars.update(0, game.time);
  back = { shown: shown(n0), scene: W.forest.scenes.now };
  const lip = SC.lip, ink = SC.lineInk;
  const cls = { lip: 0, ink: 0, other: 0 };
  let bright = 0;
  for (const m of SC.marks) {
    const c = m.color, L = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    if (Math.abs(c[0] - lip[0]) < 1e-3 && Math.abs(c[1] - lip[1]) < 1e-3) cls.lip++;
    else if (Math.abs(c[0] - ink[0]) < 1e-3 && Math.abs(c[1] - ink[1]) < 1e-3) cls.ink++;
    else cls.other++;
    if (L * m.alpha > 0.2) bright++;
  }
  const fires = [0, 0, 0, 0];
  for (let i = 0; i < F.count; i++) fires[F.data[i * 15 + 12] | 0]++;
  STREAK_FX.chain = chain0;
  out(`   won ${won} at ${game.time.toFixed(0)} s; marks left ${SC.marks.length} of ${SC.cap} (lit-lip colour ${cls.lip}, ink ${cls.ink}, other ${cls.other}; bright ${bright})`);
  out(`   laid by: ${Object.entries(src).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  out(`   in the void (3 s in): ${inVoid ? `${inVoid.shown} of the ${inVoid.n0} crossing marks shown (scene ${inVoid.scene}; ${inVoid.total} marks in all)` : 'never'}; back in the crossing: ${back.shown} of them shown (scene ${back.scene})`);
  out(`   fire-field blobs alive after the fight: fire ${fires[0]}, smoke ${fires[1]}, void ${fires[2]}, steel ${fires[3]}; 'fire' blobs spawned: ${Object.entries(fireBy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`);
  out(`   'fire' blobs printed while the fire slot was orange: in ${orangeF} frames, at most ${orangeMax} at once; spawned outliving the crimson: ${outlive}${process.env.GCD_FDBG ? ` (${Object.entries(outBy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
  assert(won, 'the fencing bot wins the fight');
  const ember = SC.marks.filter((m) => m.color[0] > 0.2 && m.color[0] > 1.8 * m.color[1]).length;
  out(`   ember-coloured marks on the floor (metal rubble before the cooling): ${ember}`);
  assert(ember === 0, `nothing on the floor glows like an ember after the fight (${ember} orange marks)`);
  assert(orangeF === 0, `none of his red heat prints orange (${orangeF} frames with 'fire' blobs under the orange slot, at most ${orangeMax})`);
  // (the tuning pass, seed 4242: 3524 glyphs before, 3577 in the filmed fight: the cap; of them 2482 not the
  // Null's trenches; with SCAR.thin.veil 2223, 1139)
  const trench = src['mark:beam'] ?? 0;
  assert(SC.marks.length < SC.cap * 0.75, `a whole fight leaves the floor a fought-on road, not snow: ${SC.marks.length} mark glyphs < 75 % of the ${SC.cap} kept (never at the cap)`);
  assert(SC.marks.length - trench <= SC.cap * 0.4, `its grit, rubble and cracks (all but the Null's trenches) are thinned: ${SC.marks.length - trench} <= 40 % of the cap`);
  assert(inVoid && inVoid.shown === 0, `in the void none of the crossing's marks show (${inVoid?.shown} of ${inVoid?.n0})`);
  assert(back.scene === 'crossing' && back.shown >= Math.min(inVoid?.n0 ?? 0, SC.marks.length) * 0.5, `back in the crossing its marks show again (${back.shown})`);
  assert(fires[0] === 0, `no fire burns after his fight (${fires[0]} 'fire' blobs alive)`);
}

// (the tuning pass, round 2: the owner) HIS PATIENCE (patience.js): a hero whose blade has not reached him for
// wjPatience.after s makes him stop waiting (a cue he sees and hears, once); then a single block knocks the
// guard open; a cut that reaches him (on the shell) ends it. A block still costs no health.
async function scenarioPatience() {
  out('\n== scenario PATIENCE (untouched for 20 s he stops waiting: the cue; one block opens the guard; a cut ends it) ==');
  const P = TUNING.wjPatience;
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 6 });
  p.debug.god = false;
  const cues = [];
  G.watch = (n, e) => { if (n === 'dragon:spell' && e?.name === 'wjUnveil') cues.push(game.time); };
  const t0 = game.time;
  d.patience.reset();
  let eyes = 0;
  const look = () => { eyes = Math.max(eyes, d.patience.cueK); };
  run(G, P.after - 0.5, look);
  const before = d.patience.impatient;
  run(G, 2, look);
  const after = d.patience.impatient, cueAt = cues.map((t) => +(t - t0).toFixed(1));
  // one block while he is impatient knocks the guard open, no health
  p.debug.heal();
  p.guard = 100;
  place(G, 2);
  run(G, 0.3, (GG) => GG.input.press(1));
  let opened = false;
  G.watch = (n) => { if (n === 'player:guardOpen') opened = true; };
  p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  const hp0 = p.hp;
  d.hitPlayer({ damage: 18, knockback: 3, tell: TELL.NORMAL, attack: 'flick', from: { x: d.position.x, z: d.position.z } });
  run(G, 0.1, (GG) => GG.input.press(1));
  G.input.up(1);
  const oneBlock = { opened, dhp: hp0 - p.hp };
  // a cut on the shell (the barrier is up) reaches him: he waits again
  run(G, 1);
  swing(G, 1.6);
  const reset = !d.patience.impatient && d.patience.idle < 1;
  G.watch = null;
  out(`   impatient at ${P.after - 0.5} s: ${before}, at ${P.after + 1.5} s: ${after} (cue at ${cueAt.join(', ')} s, his eyes ${eyes.toFixed(2)}); one block: guard opened ${oneBlock.opened}, hp -${oneBlock.dhp}; after a cut on the shell: impatient ${d.patience.impatient}`);
  assert(!before && after, `untouched for ${P.after} s he stops waiting`);
  assert(cueAt.length === 1 && eyes > 0.9, 'once, with a cue the player sees (his eyes burn) and hears (the unveiling sound)');
  assert(oneBlock.opened && oneBlock.dhp === 0, 'while he presses one block knocks the guard open, and costs no health');
  assert(reset, 'a cut that reaches him (on the shell) ends it');
}

// (the tuning pass, round 2: the owner) The bonfire goes out while the scene is the void (no flame, light,
// embers or sound: atmosphere.bonfireLit, which all four read) and burns again on the way back; a reset
// lights it too.
async function scenarioBonfire() {
  out('\n== scenario BONFIRE (out in the void, lit again in the crossing) ==');
  const G = build();
  const { game } = G;
  duel(G, { dist: 4 });
  const A = game.world.atmosphere, sc = game.world.forest.scenes;
  const lit0 = A.bonfireLit;
  sc.to('void', { x: 0, z: -2 });
  run(G, 0.1);
  const early = A.bonfireLit;
  run(G, 3);
  const inVoid = A.bonfireLit;
  sc.to('crossing', { x: 0, z: -2 });
  run(G, 3);
  const back = A.bonfireLit;
  sc.to('void', { x: 0, z: -2 });
  run(G, 3);
  game.world.restore();
  const reset = A.bonfireLit;
  out(`   lit: at the start ${lit0}, as the front leaves him ${early}, in the void ${inVoid}, back in the crossing ${back}, after a reset from the void ${reset}`);
  assert(lit0 && early, 'the bonfire burns until the front reaches it');
  assert(inVoid === false, 'in the void the bonfire is out (no flame, light, embers or sound)');
  assert(back === true, 'back in the crossing it burns again');
  assert(reset === true, 'a reset from the void lights it');
}

// (the tuning pass) A piece he holds, cut by the hero's blade: bitten while it has hp to spare; the cut that
// would leave it under 1 hp breaks it (let go where it hangs, it bursts where it lands; no longer held)
async function scenarioHeldBreak() {
  out('\n== scenario HELDBREAK (a held piece cut under 1 hp breaks: let go, it bursts where it lands) ==');
  const G = build();
  duel(G, { dist: 7, form: 2 });
  const W = G.game.world.destructibles, d = G.game.dragon;
  const pc = W.list.find((b) => b.state === 0 && !b.absent && b.lift > 0 && b.hpMax < Infinity && b.hpMax >= 2 && !b.floor && b.bricks);
  assert(!!pc && W.take(pc, { chip: true }), `a loose piece is taken, held for the blade (${pc?.kind}, hp ${pc?.hpMax?.toFixed(1)})`);
  if (!pc) return;
  const hx = d.position.x + 3, hz = d.position.z;
  W.carry(pc, hx, 1.2, hz, 0, 0);
  const cut = (power) => {
    const y = pc.y0 + pc.py + pc.h * 0.5;
    return W.sweep(hx - 1.2, hz, hx + 1.2, hz, 0.3, power, { kind: 'blunt', by: 'player', dx: 1, dz: 0, y, ya: y, yb: y, src: W.swing(), tx: 1, tz: 0 });
  };
  const small = Math.max(0.3, (pc.hp - 1) * 0.4) / (pc.M.take.blunt ?? 1);
  cut(small);
  const hp1 = pc.hp, st1 = pc.state;
  run(G, 0.1, () => W.carry(pc, hx, 1.2, hz, 0, 0));
  cut((pc.hp + 1) / (pc.M.take.blunt ?? 1));
  const st2 = pc.state;
  run(G, 2.5);
  out(`   ${pc.kind}: hp ${pc.hpMax.toFixed(1)} -> ${hp1.toFixed(2)} after a small cut (state ${st1}); a cut past its hp: state ${st2}, then ${pc.state}`);
  assert(st1 === 3 && hp1 >= 1 && hp1 < pc.hpMax, 'a cut it can take bites it and the carry goes on (held, hp >= 1)');
  assert(st2 === 4, 'the cut that would leave it under 1 hp breaks it: let go (flying, no longer held)');
  assert(pc.state === 5, 'it bursts where it lands (gone)');
}

async function scenarioRoad() {
  out('\n== scenario ROAD (The Road Itself: a strip fixed at the stomp, red; one blow for the whole line; off the strip it misses; the floor torn up along it) ==');
  for (const how of ['none', 'walk']) {
    const G = build();
    const t = trOf(G);
    duel(G, { dist: 7, form: 2 });
    const F = G.game.world.destructibles.floor;
    const f0 = F.filter((b) => b.state === 0).length;
    const r = trRun(G, 'roadItself', [how], { dist: 7, max: 8 });
    const f1 = F.filter((b) => b.state === 0).length;
    out(`   ${how}: ${t.stats.lines} line, cues ${r.flashes.length} (${[...new Set(r.flashes.map((f) => f.tell))].join(',')}); hits ${r.hits.map((h) => `${h.r} ${h.tell}`).join(',') || 'none'}; -${r.dhp} hp; floor slabs ${f0} -> ${f1}`);
    assert(r.ok && t.stats.lines === 1 && f1 < f0 - 1, `${how}: the floor bursts up along the line (${f0 - f1} slabs)`);
    assert(r.flashes.length >= 1 && r.flashes.every((f) => f.tell === TELL.RED && f.hazard), `${how}: red cues on the strip (${r.flashes.length})`);
    if (how === 'none') assert(r.hits.length === 1 && r.hits[0].r === RESULT.HIT && r.dhp > 0, `standing on it: one blow for the whole line (${r.hits.length})`);
    else assert(r.hits.length === 0 && r.dhp === 0, 'stepped off the strip: it misses');
  }
}

async function scenarioVoidcast() {
  out('\n== scenario VOIDCAST (phase 3, the void: a floating piece dropped on him (red), two cast in turn (blue); the city moves refused there; the floats spent) ==');
  const G = build();
  const t = trOf(G), d = G.game.dragon;
  duel(G, { dist: 6, form: 3 });
  void t;
  const kinds = TUNING.terrain.float.kinds, set = G.game.world.forest;
  run(G, 3, null, () => !set.scenes.morphing);
  const n0 = trStanding(G, kinds).length;
  assert(set.scenes.now === 'void' && n0 >= 3, `inside the void, ${n0} floating pieces stand`);
  const a = trRun(G, 'overhead', ['none'], { dist: 6 });
  out(`   overhead: cues ${a.flashes.map((f) => f.tell).join(',')}, told ${a.tells.length}; hits ${a.hits.map((h) => h.r).join(',')}; -${a.dhp} hp`);
  assert(a.ok && a.flashes.length === 1 && a.flashes[0].tell === TELL.RED && a.flashes[0].hazard && a.hits.length === 1 && a.hits[0].r === RESULT.HIT, 'Overhead: one red cue on his place, and standing there he is struck');
  const b = trRun(G, 'castOff', ['parry', 'parry'], { dist: 8 });
  const gap = b.flashes.length === 2 ? b.flashes[1].t - b.flashes[0].t : 0;
  out(`   castOff: cues ${b.flashes.map((f) => f.tell).join(',')} (${gap.toFixed(2)} s apart); results ${b.hits.map((h) => h.r).join(',')}; -${b.dhp} hp`);
  assert(b.ok && b.flashes.map((f) => f.tell).join(',') === `${TELL.BLUE},${TELL.BLUE}` && gap >= 0.34 && b.dhp === 0 && b.hits.length === 2 && b.hits.every((h) => h.r === RESULT.PARRIED), 'Cast Off: two blue cues, fairly apart, both parried, no health');
  assert(trStanding(G, kinds).length === n0 - 3, `the void pieces are spent (${n0} -> ${trStanding(G, kinds).length})`);
  const c1 = d.brain.trigger('curbPull'), c2 = d.brain.trigger('bringDown');
  run(G, 0.3);
  assert(!c1 && !c2 && d.mode === 'foot', 'no car, slab or tower stands in the void: Curb Pull and Bring It Down are refused');
}

async function scenarioSpent() {
  out('\n== scenario SPENT (every throwable used up by his own moves, then the fight to its end: no throw, no NaN, nothing of his left in the air) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, t = trOf(G);
  duel(G, { dist: 8 });
  const used = {};
  const spend = (name, hows, o = {}) => { let n = 0; for (let i = 0; i < 12; i++) { const r = trRun(G, name, hows, { god: true, ...o }); if (!r.ok) break; n++; } used[name] = (used[name] ?? 0) + n; };
  spend('curbPull', ['parry']);
  d.brain.forcePhase(2);
  run(G, 5, null, () => d.phase === 2 && d.mode !== 'act');
  spend('bringDown', ['dodge'], { max: 12 });
  spend('theOrbit', ['parry', 'parry', 'dodge'], { max: 12 });
  spend('curbPull', ['parry']);
  const left = trStanding(G, ['car', 'slab']), city = left.length + trStanding(G, ['towerTop']).length;
  const far = left.every((b) => Math.hypot(b.x - d.position.x, b.z - d.position.z) > TUNING.terrain.curb.find);
  d.brain.forcePhase(3);
  run(G, 8, null, () => d.phase === 3 && d.mode !== 'act');
  run(G, 3, null, () => !game.world.forest.scenes.morphing);
  spend('castOff', ['parry', 'parry']);
  spend('overhead', ['dodge']);
  spend('theOrbit', ['parry', 'parry', 'dodge'], { max: 12 });
  const floats = trStanding(G, TUNING.terrain.float.kinds).length;
  out(`   used: ${JSON.stringify(used)}; standing after: city ${city}, void ${floats}; ${JSON.stringify(t.stats)}`);
  assert(trStanding(G, ['towerTop']).length === 0 && far && floats === 0, `every throwable in his reach used up (city ${city} left, all farther than ${TUNING.terrain.curb.find} m: ${far}; void ${floats})`);
  // the fight to its end with the arena spent (his AI weighs the terrain moves 0 now, the Road aside)
  t.paced = true;
  G.defend = makeDefender(G, { world: true });
  d.debug.setAI(true);
  const won = run(G, Number(process.env.GCD_FSECS ?? 400), () => fencer(G), () => d.mode === 'dead' || game.state === 'victory');
  run(G, 1);
  out(`   the fight: ${won ? 'won' : 'NOT won'} at phase ${d.phase}; terrain started ${t.stats.started}, refused ${t.stats.refused}`);
  assert(won, 'the fight still ends');
  assert(!t.busy && G.payload.size === 0, `nothing of his left in the air, no NaN in any event (${[...G.payload].join(', ')})`);
}

async function scenarioLetgo() {
  out('\n== scenario LETGO (what hangs or flies when he dies or the fight resets; nothing lands on a hero who is down) ==');
  {
    // his death while a car hangs in the knot: it falls where it is, and nothing strikes the hero
    const G = build();
    const d = G.game.dragon, p = G.game.player, t = trOf(G);
    duel(G, { dist: 8 });
    place(G, 8);
    p.debug.god = false;
    const h0 = G.hits.length;
    d.brain.trigger('curbPull');
    run(G, 2, null, () => t.hold.some((h) => h.piece));
    const held = t.hold.find((h) => h.piece)?.piece;
    d.debug.kill();
    run(G, 3);
    assert(held && held.state !== 3 && !t.busy && G.hits.length === h0, `his death: the held ${held?.kind} falls where it hangs (state ${held?.state}), no blow (${G.hits.length - h0})`);
  }
  {
    // his death with a piece in the air: it lands harmless
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 8 });
    place(G, 8);
    const h0 = G.hits.length;
    d.brain.trigger('curbPull');
    run(G, 4, null, () => t.fly.some((f) => f.live));
    const flying = t.fly.some((f) => f.live);
    d.debug.kill();
    run(G, 3);
    assert(flying && !t.busy && G.hits.filter((h, i) => i >= h0 && h.attack === 'curbPull').length === 0, 'his death: what flies lands harmless');
  }
  {
    // the fight's reset while a tower top is carried: forgotten, the top stands again
    const G = build();
    const d = G.game.dragon, t = trOf(G);
    duel(G, { dist: 6, form: 2 });
    d.brain.trigger('bringDown');
    run(G, 3, null, () => t.drops.some((D) => D.live));
    const top = t.drops.find((D) => D.live)?.piece;
    G.game.world.restore();
    d.reset();
    run(G, 1);
    assert(top && !t.busy && top.state === 0, `a reset: nothing of his in the air, the top back on its base (state ${top?.state})`);
  }
  {
    // the hero is down when the drop's cue comes: no cue, no blow
    const G = build();
    const d = G.game.dragon, p = G.game.player, t = trOf(G);
    duel(G, { dist: 6, form: 2 });
    place(G, 6);
    p.debug.god = false;
    let flashes = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'bringDown') flashes++; };
    const h0 = G.hits.length;
    d.brain.trigger('bringDown');
    let downed = false;
    run(G, 6, () => {
      const D = t.drops.find((x) => x.live);
      if (D && !downed && D.landAt - G.game.time < 0.5) {
        downed = true;
        p.takeHit({ damage: 0, knockback: 1, knockdown: true, from: { x: p.position.x + 1, z: p.position.z }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d });
      }
    }, () => downed && !t.busy);
    G.watch = null;
    const struck = G.hits.slice(h0).filter((h) => h.attack === 'bringDown').length;
    assert(downed && flashes === 0 && struck === 0, `a hero who is down: the drop lands uncued and harmless (cues ${flashes}, blows ${struck})`);
  }
}

async function scenarioInto() {
  out('\n== scenario INTO (terrain.behind / aimThrow: the first piece on a line, the way that puts a thrown hero through one) ==');
  const G = build();
  const d = G.game.dragon, p = G.game.player, t = trOf(G);
  duel(G, { dist: 4 });
  const car = trStanding(G, ['car'])[0];
  // the hero 4 m from the car, the boss beside him a little off the line to it
  p.debug.teleport(car.x - 4, car.z);
  d.position.set(car.x - 6, 0, car.z + 1.2);
  run(G, 0.1);
  const b = t.behind(p, 1, 0, 8);
  assert(b?.piece === car && b.t > 1.5 && b.t < 4, `behind: the car on the line (${b?.piece?.kind}, ${b?.t?.toFixed(2)} m)`);
  const short = t.behind(p, 1, 0, b ? b.t - 0.3 : 1);
  assert(!short || short.t <= b.t - 0.3, 'behind: nothing past its reach (the car is out of a shorter one)');
  const a = t.aimThrow(p);
  const plain = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z), got = Math.atan2(a.dx, a.dz);
  assert(a.piece && Number.isFinite(a.dx + a.dz) && Math.abs(Math.hypot(a.dx, a.dz) - 1) < 1e-6 && Math.abs(got - plain) <= TUNING.terrain.into.spread + 1e-6, `aimThrow: turned ${(got - plain).toFixed(2)} rad onto a ${a.piece?.kind}`);
  // thrown that way he goes through it
  const crash = d.parts.terrain;
  void crash;
  p.takeHit({ damage: 1, knockback: 8, from: { x: p.position.x - a.dx, z: p.position.z - a.dz }, tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', attacker: d, wjCrash: TUNING.wjCrash.power, wjCrashDamage: TUNING.wjCrash.damage });
  run(G, 1.6);
  assert(p.crash.hits.length >= 1, `thrown along it he crashes through ${p.crash.hits.length} piece(s)`);
}

// ================================================================== spells: the spells agent's scenarios
// (function declarations: hoisted, so they live down here, out of the others' way)
/** A fresh duel in phase `form`, Wuji at (wx, wz) facing the hero at (hx, hz), god mode as asked. */
function spellDuel({ form = 1, wx = 0, wz = 0, hx = 0, hz = 6, god = true } = {}) {
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 4, form });
  d.position.set(wx, 0, wz);
  d.yaw = Math.atan2(hx - wx, hz - wz);
  p.debug.teleport(hx, hz);
  p.yaw = Math.atan2(wx - hx, wz - hz);
  p.debug.heal();
  p.debug.god = god;
  game.mouseGround.set(wx, 0, wz);
  run(G, 0.1);
  return G;
}
function sp(G) { return G.game.dragon.parts.spells; }
function hitsOf(G, attack, t0 = 0) { return G.hits.filter((h) => h.attack === attack && h.t >= t0); }
/** Run until his move is over (back out of it) or `max` s. */
function untilFoot(G, max = 6, step = null) {
  let acted = false;
  return run(G, max, step, () => {
    const d = G.game.dragon;
    if (d.mode === 'act') acted = true;
    return acted && d.mode !== 'act';
  });
}
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

async function scenarioDraw() {
  out('\n== scenario DRAW (Azure Draw: the knot opens beyond the hero, drags him, collapses red; a held guard is opened, no health; a hero at its edge walks out) ==');
  const T = TUNING.spells.draw;
  // (1) the knot's place, the drag on a hero who stands, the collapse on him
  {
    const G = spellDuel({ hz: 6, god: false });
    const { game } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    let flash = null;
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'azureDraw') flash = e.tell; };
    const hp0 = p.hp;
    d.brain.trigger('azureDraw');
    run(G, 1, null, () => !!S.rec?.knot);
    const K = S.rec?.knot, kx = K?.x, kz = K?.z;
    const beyond = K ? Math.hypot(kx - d.position.x, kz - d.position.z) - Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) : NaN;
    const z0 = p.position.z;
    run(G, 0.5);
    const drag = (p.position.z - z0) / 0.5;
    out(`     knot at (${kx?.toFixed(2)}, ${kz?.toFixed(2)}): ${beyond.toFixed(2)} m beyond the hero; it drags a hero who stands at ${drag.toFixed(2)} m/s toward it; ${S.stats.carried} loose piece(s) taken in`);
    assert(K && beyond > T.beyond - 0.3, `the knot opens beyond the hero (${beyond.toFixed(2)} m)`);
    assert(drag > 1.2, `it drags him toward it (${drag.toFixed(2)} m/s)`);
    let moved = 0;
    untilFoot(G, 6, () => { if (K?.on) moved = Math.max(moved, Math.hypot(K.x - kx, K.z - kz)); });
    assert(moved < 1e-9, `the knot never moved after it opened (${moved})`);
    const h = hitsOf(G, 'azureDraw');
    assert(flash === TELL.RED && h.some((x) => x.r === RESULT.HIT) && p.hp < hp0 && p.hp > 0, `the collapse is red and lands on a hero who stood (${flash}, ${hp0 - p.hp} HP, ${h.map((x) => x.r).join(',')})`);
    G.watch = null;
  }
  // (2) a held guard in its heart: opened, no health
  {
    const G = spellDuel({ hz: 6, god: false });
    const { game } = G;
    const d = game.dragon, p = game.player;
    let opened = 0;
    G.watch = (n) => { if (n === 'player:guardOpen') opened++; };
    const hp0 = p.hp;
    d.brain.trigger('azureDraw');
    untilFoot(G, 6, (GG) => { GG.input.press(1); });
    G.input.up(1);
    const h = hitsOf(G, 'azureDraw');
    assert(h.length && h.every((x) => x.r === RESULT.BLOCKED) && p.hp === hp0 && opened >= 1, `it cannot be blocked: a held guard is opened (${opened}), no health (${hp0} -> ${p.hp}; ${h.map((x) => x.r).join(',')})`);
    G.watch = null;
  }
  // (3) a hero at its edge walks out against the drag; one in its heart rolls out
  for (const how of ['walk', 'roll']) {
    const G = spellDuel({ hz: 6, god: false });
    const { game, input } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    d.brain.trigger('azureDraw');
    run(G, 1, null, () => !!S.rec?.knot);
    const K = S.rec.knot;
    if (how === 'walk') p.debug.teleport(K.x, K.z - T.crush - 0.3); // (at its edge, on Wuji's side)
    else p.debug.teleport(K.x + 0.3, K.z);
    const t0 = game.time;
    let rolled = false, minD = Infinity;
    untilFoot(G, 6, () => {
      const dx = p.position.x - K.x, dz = p.position.z - K.z, l = Math.hypot(dx, dz) || 1;
      if (K.on) minD = Math.min(minD, l);
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (how === 'walk') input.axis = { x: dx / l, y: -dz / l };
      else if (!rolled && d.brain.act && d.brain.act.beats[0].impact - d.brain.act.t < 0.5) { rolled = true; input.axis = { x: dx / l, y: -dz / l }; input.tap('Space'); }
    });
    input.axis = { x: 0, y: 0 };
    const h = hitsOf(G, 'azureDraw', t0);
    assert(!h.some((x) => x.r === RESULT.HIT), `${how === 'walk' ? 'a hero at its edge walks out against the drag' : 'one in its heart rolls out'} (${h.map((x) => x.r).join(',') || 'not touched'}; closest ${minD.toFixed(2)} m)`);
  }
}

async function scenarioYank() {
  out('\n== scenario YANK (the pull takes a fixed time from any distance; set down before his fist; a parry on arrival is a parry; a held guard is opened) ==');
  const T = TUNING.spells.yank;
  const rows = [];
  for (const dist of [4, 8, 12]) {
    const G = spellDuel({ hz: dist });
    const { game } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    let t0 = NaN, t1 = NaN, at = NaN, impact = NaN;
    d.brain.trigger('azureYank');
    untilFoot(G, 4, () => {
      if (S.yank && !Number.isFinite(t0)) t0 = game.time;
      if (!S.yank && Number.isFinite(t0) && !Number.isFinite(t1)) { t1 = game.time; at = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z); }
      const a = d.brain.act;
      if (a && !Number.isFinite(impact)) impact = game.time + (a.beats[0].impact - a.t);
    });
    rows.push({ dist, travel: t1 - t0, at, lead: impact - t1 });
  }
  out(`     ${rows.map((r) => `from ${r.dist} m: pulled ${r.travel.toFixed(3)} s, set down ${r.at.toFixed(2)} m from him, ${r.lead.toFixed(3)} s before the fist`).join(' · ')}`);
  assert(rows.every((r) => Math.abs(r.travel - T.travel) <= 2 * DT + 1e-6), `the pull lasts ${T.travel} s from every distance (${rows.map((r) => r.travel.toFixed(3)).join(', ')})`);
  assert(rows.every((r) => Math.abs(r.at - T.stop) < 0.45), `he is set down ${T.stop} m in front of him (${rows.map((r) => r.at.toFixed(2)).join(', ')})`);
  for (const how of ['parry', 'guard']) {
    const G = spellDuel({ hz: 9, god: false });
    const d = G.game.dragon, p = G.game.player;
    let opened = 0;
    const step = answer(G, how, 'azureYank');
    const w0 = G.watch;
    G.watch = (n, e) => { if (n === 'player:guardOpen') opened++; w0?.(n, e); };
    const hp0 = p.hp;
    d.brain.trigger('azureYank');
    untilFoot(G, 4, step);
    G.watch = null;
    G.input.up(1);
    const h = hitsOf(G, 'azureYank');
    if (how === 'parry') assert(h.length === 1 && h[0].r === RESULT.PARRIED && p.hp === hp0, `a parry as he arrives is a parry (${h.map((x) => x.r).join(',')})`);
    else assert(h.length === 1 && h[0].r === RESULT.BLOCKED && opened >= 1 && p.hp === hp0, `a held guard is opened, no health (${h.map((x) => x.r).join(',')}, opened ${opened}, ${hp0} -> ${p.hp})`);
  }
}

async function scenarioCast() {
  out('\n== scenario CAST (Crimson Cast: the place fixed at its cue; 9 m of throw; the crater mark; the loose pieces thrown outward; the point-blank form) ==');
  const T = TUNING.spells.cast;
  // (1) the hero who stays: hit and thrown; the place was fixed; a crater mark
  {
    const G = spellDuel({ form: 2, hz: 7, god: false });
    const { game } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    const M = attachMarks(game);
    const b0 = M.made.blast;
    d.brain.trigger('crimsonCast');
    let fx = NaN, fz = NaN, px = NaN, pz = NaN, burst = null;
    untilFoot(G, 5, () => {
      if (S.rec?.kind === 'point' && !Number.isFinite(fx)) { fx = S.rec.x; fz = S.rec.z; px = p.position.x; pz = p.position.z; }
      if (S.rec?.kind === 'point') burst = { x: S.rec.x, z: S.rec.z };
    });
    run(G, 1.5);
    const thrown = Math.hypot(p.position.x - fx, p.position.z - fz);
    const h = hitsOf(G, 'crimsonCast');
    out(`     the place fixed at (${fx.toFixed(2)}, ${fz.toFixed(2)}), the hero was at (${px.toFixed(2)}, ${pz.toFixed(2)}); thrown ${thrown.toFixed(2)} m; marks blast ${b0} -> ${M.made.blast}`);
    assert(Math.hypot(fx - px, fz - pz) < 0.05 && burst && Math.hypot(burst.x - fx, burst.z - fz) < 1e-9, 'the place is the hero’s at the cue, and it does not move after');
    assert(h.some((x) => x.r === RESULT.HIT && x.tell === TELL.RED) && thrown >= 6.5, `the burst lands (red) and throws him ${thrown.toFixed(2)} m (9 m of knockback, less what he crashed through)`);
    assert(M.made.blast > b0, 'the burst leaves its crater mark (a blast)');
  }
  // (2) a hero who steps out after the place is fixed is not touched
  {
    const G = spellDuel({ form: 2, hz: 7, god: false });
    const { game, input } = G;
    const d = game.dragon, S = sp(G);
    d.brain.trigger('crimsonCast');
    untilFoot(G, 5, () => { input.axis = S.rec?.kind === 'point' ? { x: 1, y: 0 } : { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); });
    input.axis = { x: 0, y: 0 };
    const h = hitsOf(G, 'crimsonCast');
    assert(!h.some((x) => x.r === RESULT.HIT), `stepping out after the place is fixed works (${h.map((x) => x.r).join(',') || 'not touched'})`);
  }
  // (3) the loose pieces round it are thrown outward (a car 2.4 m from the hero)
  {
    const G0 = build();
    const car = pieces(G0, 'car').sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    const sx = car.x > 0 ? -1 : 1, hx = car.x + sx * 2.4, hz = car.z;
    const G = spellDuel({ form: 2, wx: hx + sx * 7, wz: hz, hx, hz });
    const d = G.game.dragon, S = sp(G);
    const c = pieces(G, 'car').find((b) => b.id === car.id);
    const d0 = Math.hypot(c.x - hx, c.z - hz);
    d.brain.trigger('crimsonCast');
    untilFoot(G, 5);
    const d1 = Math.hypot(c.tx - hx, c.tz - hz);
    out(`     a car ${d0.toFixed(2)} m from the point: thrown to ${d1.toFixed(2)} m (state ${c.state}); thrown pieces ${S.stats.thrown}`);
    assert(S.stats.thrown >= 1 && d1 > d0 + 3, `the loose pieces within ${T.throwR} m are thrown outward (${d0.toFixed(1)} -> ${d1.toFixed(1)} m)`);
  }
  // (4) Point Blank: out of a blink behind the hero, red; a perfect dodge answers it
  for (const how of ['none', 'dodge']) {
    const G = spellDuel({ form: 2, hz: 6, god: false });
    const d = G.game.dragon, p = G.game.player;
    const step = answer(G, how, 'crimsonPalm');
    let flash = null;
    const w0 = G.watch;
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'crimsonPalm') flash = e.tell; w0?.(n, e); };
    d.brain.trigger('crimsonPalm');
    untilFoot(G, 4, step);
    G.watch = null;
    G.input.axis = { x: 0, y: 0 };
    const h = hitsOf(G, 'crimsonPalm');
    if (how === 'none') assert(flash === TELL.RED && h.some((x) => x.r === RESULT.HIT), `Point Blank: red, out of a blink, it lands on a hero who stands (${h.map((x) => x.r).join(',')}, ${p.maxHp - p.hp} HP)`);
    else assert(h.length && h.every((x) => x.r === RESULT.PERFECT || x.r === RESULT.DODGED), `... a perfect dodge answers it (${h.map((x) => x.r).join(',')})`);
  }
}

async function scenarioWreck() {
  out('\n== scenario WRECK (the Wrecking Knot: the path fixed and shown before it moves, red on its strip, every piece on its way swept) ==');
  const G = spellDuel({ form: 2, hz: 7, god: false });
  const { game } = G;
  const d = game.dragon, p = game.player, S = sp(G);
  const M = attachMarks(game);
  const dash0 = M.made.dash;
  let flash = null, fixedAt = NaN, movedAt = NaN, path = null, moved = false;
  G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'wreckingKnot') flash = e.tell; };
  d.brain.trigger('wreckingKnot');
  untilFoot(G, 5, () => {
    const R = S.rec;
    if (R?.kind === 'wreck' && !path) { path = { ax: R.ax, az: R.az, bx: R.bx, bz: R.bz }; fixedAt = game.time; }
    if (R?.kind === 'wreck' && R.knot && !Number.isFinite(movedAt)) movedAt = game.time;
    if (R?.kind === 'wreck' && path && (R.ax !== path.ax || R.bz !== path.bz)) moved = true;
  });
  G.watch = null;
  const h = hitsOf(G, 'wreckingKnot');
  out(`     path fixed ${(movedAt - fixedAt).toFixed(2)} s before the knot moved; ${S.stats.swept} piece blows on its way; furrows ${M.made.dash - dash0}; ${h.map((x) => x.r).join(',')}`);
  assert(path && movedAt - fixedAt >= 0.5 && !moved, `the path is fixed and shown ${(movedAt - fixedAt).toFixed(2)} s before it moves, and never moves`);
  assert(flash === TELL.RED && h.length === 1 && h[0].r === RESULT.HIT && p.hp > 0, `red on its strip: one hit on a hero who stood (${h.map((x) => x.r).join(',')})`);
  assert(M.made.dash - dash0 >= 3, `it furrows the road along its way (${M.made.dash - dash0})`);
  // (the tuning pass) a roll timed to its cue (a perfect dodge, either way along the path) is never met by the
  // knot after: it strikes only at the impact (the perfect bot was hit 46 by a knot dragged onto it, seed 4242)
  const res = [];
  for (let k = 0; k < 2; k++) {
    p.debug.heal();
    d.debug.tidy();
    run(G, 1);
    p.debug.teleport(d.position.x, d.position.z + 7);
    const t0 = game.time;
    const step = answer(G, 'dodge', 'wreckingKnot');
    d.brain.trigger('wreckingKnot');
    untilFoot(G, 5, step); // (the knot's path flips side every cast: one roll toward it, one away)
    G.watch = null;
    res.push(hitsOf(G, 'wreckingKnot', t0).map((x) => x.r).join(',') || 'none');
  }
  out(`     answered with a perfect dodge (the path one way, then the other): ${res.join(' / ')}`);
  assert(res.every((r) => !r.split(',').includes(RESULT.HIT)), `a perfect dodge of the knot is never hit after it (${res.join(' / ')})`);
}

async function scenarioNull() {
  out('\n== scenario NULL (the line fixed at its cue; never lethal from full health; a held guard costs no health; every piece on the strip felled; a wide trench; not twice inside 20 s) ==');
  const T = TUNING.spells.null, LN = TUNING.spells.lastNull;
  // (1) the line toward the fallen tower: fixed at `fix`, the hero who stays is hit hard and lives; the strip
  {
    const G = spellDuel({ form: 2, wx: 0, wz: 2, hx: 0, hz: -7, god: false });
    const { game } = G;
    const d = game.dragon, p = game.player, S = sp(G), Dl = game.world.destructibles;
    const M = attachMarks(game);
    const beam0 = M.made.beam, glyph0 = M.count;
    let fixedAng = NaN, litAng = NaN, flash = null;
    const angs = new Set();
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'violetNull') flash = e.tell; };
    d.brain.trigger('violetNull');
    let strip = null;
    untilFoot(G, 5, () => {
      if (S.rec?.fixed && !Number.isFinite(fixedAng)) {
        fixedAng = S.rec.ang;
        const ax = S.rec.ox + Math.sin(fixedAng) * 0.8, az = S.rec.oz + Math.cos(fixedAng) * 0.8, bx = S.rec.ox + Math.sin(fixedAng) * T.len, bz = S.rec.oz + Math.cos(fixedAng) * T.len;
        strip = { ax, az, bx, bz, list: Dl.list.filter((b) => b.state === 0 && !b.absent && b.hpMax < Infinity && segDist2(b.x, b.z, ax, az, bx, bz) <= T.w / 2 + b.r) };
      }
      if (S.rec?.fixed) angs.add(S.rec.ang);
      if (S.lit && !Number.isFinite(litAng)) litAng = S.lit.ang;
    });
    run(G, T.after + 0.5);
    G.watch = null;
    const h = hitsOf(G, 'violetNull');
    const left = strip.list.filter((b) => b.state === 0 && !b.absent);
    const towers = strip.list.filter((b) => b.kind === 'fallenTower');
    // the trench's width: its glyphs' distance across the line
    const ux = Math.sin(fixedAng), uz = Math.cos(fixedAng);
    let across = 0, edges = 0;
    for (const m of M.marks.slice(glyph0)) { const a = Math.abs(-(m.x - strip.ax) * uz + (m.z - strip.az) * ux), al = (m.x - strip.ax) * ux + (m.z - strip.az) * uz; if (a <= T.w / 2 + 0.8 && al > 0) { across = Math.max(across, a); if (a >= T.w / 2 - 0.3) edges++; } }
    out(`     the line fixed at ${(fixedAng / Math.PI * 180).toFixed(1)} deg, lit at ${(litAng / Math.PI * 180).toFixed(1)}; the hero ${p.maxHp} -> ${p.hp} HP; ${strip.list.length} pieces on the strip (${towers.length} of the fallen tower), ${left.length} left standing (${left.map((b) => b.kind).join(', ')}); trench marks ${M.made.beam - beam0}, ${M.count - glyph0} glyphs, ${across.toFixed(2)} m across, ${edges} glyphs on its edges`);
    assert(flash === TELL.RED && angs.size === 1 && Math.abs(litAng - fixedAng) < 1e-9, 'the line is fixed at its cue and does not track after (red)');
    assert(h.length === 1 && h[0].r === RESULT.HIT && p.alive && p.hp > 0 && p.maxHp - p.hp >= 80, `a hero in it is hit hard and lives from full health (${p.maxHp - p.hp} HP)`);
    assert(strip.list.length >= 3 && left.length === 0, `every piece on the strip is felled (${strip.list.length - left.length} of ${strip.list.length})`);
    assert(towers.length >= 1 && towers.length <= 2, `the fallen tower is bored through: ${towers.length} section(s) of it on the line`);
    assert(M.made.beam - beam0 >= 1 && across >= T.w / 2 - 0.3 && edges >= 40, `the trench mark stays and is wide (${across.toFixed(2)} m from its middle)`);
  }
  // (2) a hero who steps out after the line is fixed is not touched; a held guard is opened, no health
  for (const how of ['step', 'guard']) {
    const G = spellDuel({ form: 2, hz: 8, god: false });
    const { game, input } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    let opened = 0;
    G.watch = (n) => { if (n === 'player:guardOpen') opened++; };
    const hp0 = p.hp;
    d.brain.trigger('violetNull');
    untilFoot(G, 5, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (how === 'guard') input.press(1);
      else input.axis = S.rec?.fixed ? { x: 1, y: 0 } : { x: 0, y: 0 };
    });
    input.up(1);
    input.axis = { x: 0, y: 0 };
    G.watch = null;
    const h = hitsOf(G, 'violetNull');
    if (how === 'step') assert(!h.some((x) => x.r === RESULT.HIT), `stepping out of the shown line works (${h.map((x) => x.r).join(',') || 'not touched'})`);
    else assert(h.length === 1 && h[0].r === RESULT.BLOCKED && opened >= 1 && p.hp === hp0, `a held guard is opened and costs no health (${h.map((x) => x.r).join(',')}, ${hp0} -> ${p.hp})`);
  }
  // (3) not twice inside 20 s (his choice); never two spells back to back
  {
    const G = spellDuel({ form: 2, hz: 9 });
    const { game } = G;
    const d = game.dragon, S = sp(G);
    d.brain.trigger('violetNull');
    untilFoot(G, 5);
    const t0 = S.lastNullT;
    const w = (name) => { S.lastWasSpell = false; S.since = 9; return S.weigh(name, MOVES[name], 1, 9); };
    const soon = w('violetNull');
    run(G, T.gap - (game.time - t0) - 0.5);
    const before = w('violetNull');
    run(G, 1);
    const after = w('violetNull');
    assert(soon === 0 && before === 0 && after > 0, `his choice: no Null inside ${T.gap} s of the last (${soon}, ${before}, then ${after.toFixed(2)})`);
    S.lastWasSpell = true;
    assert(S.weigh('crimsonCast', MOVES.crimsonCast, 1, 9) === 0, 'never two spells back to back');
  }
  // (4) the Last Null: once, below 12 % in phase 3, turning; never lethal from full health
  {
    const G = spellDuel({ form: 3, hz: 8, god: false });
    const { game } = G;
    const d = game.dragon, p = game.player, S = sp(G);
    const w = () => { S.lastWasSpell = false; return S.weigh('lastNull', MOVES.lastNull, 0.01, 8); };
    S.lastNullT = -Infinity;
    const hi = w();
    d.hp = d.maxHp * (LN.below - 0.01);
    const lo = w();
    const angs = [];
    d.brain.trigger('lastNull');
    untilFoot(G, 6, () => { if (S.lit) angs.push(S.lit.ang); });
    S.lastNullT = -Infinity;
    const again = w();
    const turned = angs.length ? Math.abs(angs[angs.length - 1] - angs[0]) / Math.PI * 180 : 0;
    const h = hitsOf(G, 'lastNull');
    out(`     the Last Null: weight above 12 % ${hi}, below ${lo}; it turned ${turned.toFixed(1)} deg; the hero ${h.map((x) => x.r).join(',')}, ${p.hp} HP left; again ${again}`);
    assert(hi === 0 && lo > 1 && again === 0, 'the Last Null comes once, below 12 % in phase 3');
    assert(Math.abs(turned - LN.turn) < 1.5, `it turns ${LN.turn} deg over its life (${turned.toFixed(1)})`);
    assert(p.alive && p.hp > 0, 'never lethal from full health');
  }
}

/** A seeded fencing fight (god mode, AI on), start to death, the floor's marks attached: his spells are
 *  all used, the Null never twice inside 20 s, and the marks a whole fight leaves are in the suite's range
 *  (marks.mjs RANGE.veil). */
async function scenarioSpellFight() {
  out('\n== scenario SPELLFIGHT (a fencing fight with the marks attached: every spell used, the Nulls 20 s apart, the floor marks in range) ==');
  const LIST = ['azureDraw', 'azureYank', 'crimsonCast', 'crimsonPalm', 'wreckingKnot', 'violetNull', 'lastNull'];
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const chain0 = STREAK_FX.chain;
  STREAK_FX.chain = false;
  // (the spells' share is sampled over a fight as long as before round 3's numbers: the god-mode fencer
  // parries every blow perfectly, so his barrier is always open, and at hp 20000 x openDamage the fight
  // lasts 118 s, too few picks to measure a mix by)
  const hp0 = TUNING.hp, od0 = TUNING.wjBarrier.openDamage;
  TUNING.hp = 26000;
  TUNING.wjBarrier.openDamage = 1;
  try {
    const G = build(Number(process.env.GCD_SEED ?? 4242), true);
    const { game } = G;
    const d = game.dragon;
    const M = attachMarks(game);
    duel(G, { dist: 3, ai: true });
    G.defend = makeDefender(G, { world: true });
    const used = {}, nulls = [];
    const p2 = [];
    G.watch = (n, e) => { if (n === 'dragon:windup' && LIST.includes(e?.name)) { used[e.name] = (used[e.name] || 0) + 1; if (e.name === 'violetNull' || e.name === 'lastNull') nulls.push(game.time); if (e.name === 'violetNull' && d.phase === 2) p2.push(game.time); } };
    const t0 = game.time;
    const won = run(G, Number(process.env.GCD_FSECS ?? 600), () => fencer(G), () => d.mode === 'dead' || game.state === 'victory');
    G.watch = null;
    const gaps = nulls.slice(1).map((t, i) => t - nulls[i]);
    out(`     ${won ? 'won' : 'NOT won'} in ${(game.time - t0).toFixed(0)} s; spells ${JSON.stringify(used)}; Nulls at ${nulls.map((t) => (t - t0).toFixed(0)).join(' / ')} s; stats ${JSON.stringify(sp(G).stats)}`);
    assert(won, 'the fencing bot wins');
    // (a fencer stays inside 2.6 m and is answered mostly by counters: of his free picks the spells take their share)
    const kinds = Object.keys(used).length, picks = d.brain.stats.picks ?? 0, spells = Object.values(used).reduce((a, n) => a + n, 0);
    assert(kinds >= 3 && spells >= 0.1 * picks, `his spells come up in a close fight: ${kinds} kinds, ${spells} of his ${picks} free picks`);
    assert(p2.length >= 1, `the Violet Null is seen in phase 2 (${p2.length}; seed ${process.env.GCD_SEED ?? 4242})`);
    assert(gaps.every((g) => g >= TUNING.spells.null.gap - 1e-6), `the Nulls are never inside ${TUNING.spells.null.gap} s of each other (${gaps.map((g) => g.toFixed(1)).join(', ')})`);
    marksCheck(M, 'veil', out, assert);
    assert(G.payload.size === 0, `no NaN in any event (${[...G.payload].join(', ')})`);
  } finally {
    STREAK_FX.chain = chain0;
    TUNING.hp = hp0;
    TUNING.wjBarrier.openDamage = od0;
  }
}

async function scenarioUnveil() {
  out('\n== scenario UNVEIL (the transition burst: a push with no damage, the loose pieces near him thrown outward, the ruins near toppled) ==');
  const G = spellDuel({ hz: 4, god: false });
  const { game } = G;
  const d = game.dragon, p = game.player, S = sp(G);
  const hp0 = p.hp, x0 = p.position.x, z0 = p.position.z;
  d.brain.forcePhase(2);
  run(G, 5, null, () => d.phase === 2 && d.mode !== 'act');
  const pushed = Math.hypot(p.position.x - x0, p.position.z - z0);
  out(`     unveils ${S.stats.unveils}, pieces flattened ${S.stats.flattened}; the hero pushed ${pushed.toFixed(2)} m, ${hp0} -> ${p.hp} HP`);
  assert(S.stats.unveils === 1 && d.dressPhase === 2, 'the unveiling burst goes off once, at the transition impact');
  assert(p.hp === hp0 && pushed >= 3, `it pushes the hero (${pushed.toFixed(2)} m) and costs no health`);
}

// ================================================================== motion: the motion agent's scenarios (round 3)
// (`?wjMotion=0|a|b|c`: his melee's motion takes; moves/melee.js, untouched/motion.js)
/** One melee move measured on the real rig, the hero standing still and blocking (god): per beat its tell,
 *  windup, the snap (s from the release out of the held / cocked pose to the impact), the held stretch,
 *  the striking end's speed at the impact, the kicking knee / striking elbow at the impact, his travel; per
 *  move the hands' furthest from the pockets (phase 1) and the recovery. */
function wjMeasure(G, name, { dist = 2.2, how = 'block' } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  d.debug.tidy();
  d.brain.act = null;
  d.mode = 'foot';
  d.position.set(0, 0, -2);
  d.yaw = 0;
  run(G, 0.3);
  run(G, 3, null, () => ['idle', 'run'].includes(p.state));
  place(G, dist, 0);
  p.debug.god = true;
  p.guard = 100;
  input.axis = { x: 0, y: 0 };
  run(G, 0.25, () => place(G, dist, 0));
  const R = d.rig, inv = new THREE.Matrix4(), pinv = new THREE.Matrix4(), V = () => new THREE.Vector3();
  const L = (o, x = 0, y = 0, z = 0) => V().set(x, y, z).applyMatrix4(o.matrixWorld);
  const samp = () => {
    R.root.updateWorldMatrix(true, true); // (from the scene down: the parent's own matrix may be a frame old)
    inv.copy(R.root.matrixWorld).invert();
    const W = {
      wrR: L(R.arms.R.fore, 0, -0.26, 0), wrL: L(R.arms.L.wrist), shR: L(R.arms.R.upper), shL: L(R.arms.L.upper), elR: L(R.arms.R.fore), elL: L(R.arms.L.fore),
      thR: L(R.legs.R.thigh), shnR: L(R.legs.R.shin), anR: L(R.legs.R.foot), thL: L(R.legs.L.thigh), shnL: L(R.legs.L.shin), anL: L(R.legs.L.foot), head: L(R.head, 0, 0.1, 0), pelvis: L(R.pelvis),
    };
    const B = {};
    for (const k in W) B[k] = W[k].clone().applyMatrix4(inv);
    const hB = V().set(p.position.x, 1.15, p.position.z).applyMatrix4(inv); // (the hero's chest in his frame)
    // (the wrists in the pelvis's frame: in his pockets they go where his hips go)
    pinv.copy(R.pelvis.matrixWorld).invert();
    const Pv = { wrR: W.wrR.clone().applyMatrix4(pinv), wrL: W.wrL.clone().applyMatrix4(pinv) };
    return { W, B, hB, scl: R.root.getWorldScale(V()).x || 1, Pv, x: d.position.x, z: d.position.z, t: d.brain.act?.t ?? 0, hx: p.position.x, hz: p.position.z, yaw: d.yaw, ryaw: (() => { const e = R.root.matrixWorld.elements; return Math.atan2(e[8], e[10]); })(), cyaw: (() => { const e = R.chest?.matrixWorld?.elements ?? R.root.matrixWorld.elements; return Math.atan2(e[8], e[10]); })() };
  };
  const ang = (a, b, c) => { const u = V().subVectors(a, b).normalize(), w = V().subVectors(c, b).normalize(); return (Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 180) / Math.PI; };
  const rest = samp();
  if (!d.brain.trigger(name)) return { name, fail: 'trigger' };
  const A = d.brain.act;
  const F = [];
  let nan = false;
  for (let i = 0; i < 900; i++) {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (how === 'block') { input.press(1); p.guard = 100; }
    G.tick(DT);
    p.debug.heal();
    if (d.brain.act !== A) break;
    const s = samp();
    for (const k in s.W) if (!Number.isFinite(s.W[k].x + s.W[k].y + s.W[k].z)) nan = true;
    F.push(s);
    if (process.env.GCD_ANAT_TRACE) {
      const bi = A.beats.findIndex((b) => s.t < b.end + 1e-6), b = A.beats[bi], u = null;
      const q = (k) => s.B[k].toArray().map((x) => x.toFixed(2)).join(',');
      out(`    t ${s.t.toFixed(3)} beat ${bi} ${b ? (s.t < b.impact ? 'wind' : s.t < b.impact + (b.def.active ?? 0.1) ? 'live' : 'rec') : '-'}${u != null ? ' u ' + u.toFixed(2) : ''}  anR ${q('anR')}  anL ${q('anL')}  wrR ${q('wrR')}  root ${s.x.toFixed(2)},${s.z.toFixed(2)} pelvisW ${s.W.pelvis.x.toFixed(2)},${s.W.pelvis.z.toFixed(2)} rigRoot ${R.root.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(",")} mw ${[12,13,14,0,5,10].map((i) => inv.clone().invert().elements[i].toFixed(2)).join(",")} pW ${s.W.pelvis.toArray().map((v) => v.toFixed(2)).join(",")} again ${s.W.pelvis.clone().applyMatrix4(inv).toArray().map((v) => v.toFixed(2)).join(",")} pelvisNow ${R.pelvis.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(",")} par ${R.pelvis.parent?.name ?? "?"}/${R.pelvis.parent === R.root} rootEuler ${new THREE.Euler().setFromQuaternion(R.root.getWorldQuaternion(new THREE.Quaternion()), "YXZ").toArray().slice(0, 3).map((v) => (+v).toFixed(2)).join(",")} scl ${R.root.getWorldScale(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(",")} pq ${new THREE.Euler().setFromQuaternion(R.pelvis.getWorldQuaternion(new THREE.Quaternion()), "YXZ").toArray().slice(0, 3).map((v) => (+v).toFixed(2)).join(",")} pelvisB ${s.B.pelvis.toArray().map((v) => v.toFixed(2)).join(",")} hero ${s.hx.toFixed(2)},${s.hz.toFixed(2)}`);
    }
  }
  input.up(1);
  const near = (t) => F.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), F[0]);
  const spd = (k, t) => { const i = F.indexOf(near(t)); if (i < 1) return 0; return F[i].W[k].distanceTo(F[i - 1].W[k]) / DT; };
  // the hands from the pockets (his frame; m), over the whole move
  let handOut = 0, outR = 0, outL = 0;
  for (const s of F) {
    outR = Math.max(outR, s.Pv.wrR.distanceTo(rest.Pv.wrR));
    outL = Math.max(outL, s.Pv.wrL.distanceTo(rest.Pv.wrL));
  }
  handOut = Math.max(outR, outL);
  // the largest pop: a joint that changes its speed in one frame (his frame; m; frames round a blink left out)
  let pop = 0, popK = '', popT = 0;
  for (let i = 2; i < F.length; i++) {
    if (Math.hypot(F[i].x - F[i - 1].x, F[i].z - F[i - 1].z) > 0.4 || Math.hypot(F[i - 1].x - F[i - 2].x, F[i - 1].z - F[i - 2].z) > 0.4) continue;
    for (const k of ['wrR', 'wrL', 'anR', 'anL', 'head', 'pelvis']) {
      const a2 = V().copy(F[i].B[k]).addScaledVector(F[i - 1].B[k], -2).add(F[i - 2].B[k]).length();
      if (a2 > pop) { pop = a2; popK = k; popT = F[i].t; }
    }
  }
  const beats = [];
  for (const b of A.beats) {
    if (b.feint) continue;
    const D = b.def, cock = D.cock ?? 0.8, part = b.def.part ?? '';
    const rel = b.at(cock) + b.H; // the release out of the cock
    const imp = near(b.impact), st = near(b.start);
    const side = /L$/.test(part) ? 'L' : 'R';
    const foot = /^foot|^knee/.test(part), palms = part === 'palms';
    const endK = foot ? `an${side}` : palms ? 'wrR' : `wr${side}`;
    // the held stretch of the windup (nothing tracked faster than 0.9 m/s in his frame)
    let run0 = 0, best = 0;
    for (let i = 1; i < F.length; i++) {
      if (F[i].t < b.start || F[i].t > b.impact) continue;
      let mv = 0;
      for (const k of ['wrR', 'wrL', 'head', 'pelvis', 'elR', 'elL', ...(foot ? [`an${side}`] : [])]) mv = Math.max(mv, F[i].B[k].distanceTo(F[i - 1].B[k]) / DT);
      run0 = mv < 0.9 ? run0 + 1 : 0;
      best = Math.max(best, run0);
    }
    beats.push({
      tell: D.tell, part, W: b.W, H: b.H, snap: b.impact - rel, held: best * DT,
      speed: spd(endK, b.impact),
      knee: foot ? ang(imp.W[`th${side}`], imp.W[`shn${side}`], imp.W[`an${side}`]) : null,
      elbow: !foot ? ang(imp.W[`sh${side}`], imp.W[`el${side}`], imp.W[`wr${side}`]) : null,
      travel: Math.hypot(imp.x - st.x, imp.z - st.z),
      footY: foot ? imp.W[`an${side}`].y : null,
      // (ADR-255) the striking arm's line: degrees off the line from his shoulder to the hero, flat on the
      // ground (aim) and up / down (elev, + up), at the contact and at the release out of the cock; the
      // elbow at the release
      ...(!foot ? (() => {
        // (in his own frame, the root's: the root carries a world tilt toward the camera, so world lines skew)
        // (the hero where he stood the frame before the contact: the blow's own throw moves him in its frame)
        const i0 = F.findIndex((f) => f.t >= b.impact - 1e-6), hRef = F[Math.max(0, i0 - 1)] ?? imp;
        const rl = near(rel), line = (s) => {
          // (the hero in his frame WITHOUT the root's world tilt: his place, his yaw, his scale only)
          const dx = hRef.hx - s.x, dz = hRef.hz - s.z, cy = Math.cos(s.ryaw), sy = Math.sin(s.ryaw), k = s.scl;
          const hc = { x: (dx * cy - dz * sy) / k, z: (dx * sy + dz * cy) / k };
          const sh = s.B[`sh${side}`], wr = s.B[`wr${side}`], ax = wr.x - sh.x, az = wr.z - sh.z, tx = hc.x - sh.x, tz = hc.z - sh.z;
          const a = Math.abs(((Math.atan2(ax, az) - Math.atan2(tx, tz) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          return { aim: (a * 180) / Math.PI, elev: (Math.atan2(wr.y - sh.y, Math.hypot(ax, az)) * 180) / Math.PI };
        };
        const c = line(imp), r0 = line(rl);
        if (process.env.GCD_ANAT_LINE) out(`      [line] t ${imp.t.toFixed(3)} sh ${imp.B[`sh${side}`].toArray().map((v) => v.toFixed(2))} wr ${imp.B[`wr${side}`].toArray().map((v) => v.toFixed(2))} hero ${imp.hB.toArray().map((v) => v.toFixed(2))} heroAt ${hRef.hx.toFixed(2)},${hRef.hz.toFixed(2)} from ${imp.x.toFixed(2)},${imp.z.toFixed(2)}`);
        const fo = Math.abs(((imp.yaw - Math.atan2(imp.hx - imp.x, imp.hz - imp.z) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        const brg = Math.atan2(imp.hx - imp.x, imp.hz - imp.z), off = (y) => Math.round((Math.abs(((y - brg + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180) / Math.PI);
        return { rig: off(imp.ryaw), chest: off(imp.cyaw), gap: Math.hypot(imp.hx - imp.x, imp.hz - imp.z), face: (fo * 180) / Math.PI, aim: c.aim, elev: c.elev, aimRel: r0.aim, elevRel: r0.elev, elRel: ang(rl.W[`sh${side}`], rl.W[`el${side}`], rl.W[`wr${side}`]) };
      })() : {}),
    });
  }
  return { name, phase: d.phase, frames: F.length, nan, handOut, outR, outL, pop, popK, popT, recovery: A.end - A.recoveryStart, dur: A.end, beats, impacts: A.beats.filter((b) => !b.feint).map((b) => b.impact) };
}

/** MOTIONAUDIT (opt-in): every melee move in every phase it is used in, measured (wjMeasure), printed per take. */
async function scenarioMotionAudit() {
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { MOVE_OWNERS } = await imp('src/entities/enemies/untouched/moves.js');
  const takes = (process.env.WJ_TAKES ?? '0').split(',');
  const names = MOVE_NAMES.filter((n) => MOVE_OWNERS[n] === 'melee');
  for (const tk of takes) {
    setLook('wjMotion', tk);
    out(`\n== scenario MOTIONAUDIT (take ${tk}) ==`);
    for (const ph of [1, 2, 3]) {
      const G = build();
      duel(G, { dist: 2.2, form: ph });
      for (const name of names) {
        if (!phasesOf(name).includes(ph)) continue;
        const r = wjMeasure(G, name);
        if (r.fail) { out(`  P${ph} ${name} FAIL ${r.fail}`); continue; }
        out(`  P${ph} ${name.padEnd(13)} ${r.frames}f  dur ${r.dur.toFixed(2)}  rec ${r.recovery.toFixed(2)}  hands out R ${r.outR.toFixed(2)} L ${r.outL.toFixed(2)} m  pop ${r.pop.toFixed(2)} ${r.popK}${r.nan ? '  NaN' : ''}`);
        for (const b of r.beats) out(`       ${String(b.tell).padEnd(6)} ${b.part.padEnd(6)} W ${b.W.toFixed(2)}${b.H ? '+' + b.H.toFixed(2) : '     '}  snap ${b.snap.toFixed(2)}  held ${b.held.toFixed(2)}  v@imp ${b.speed.toFixed(1)} m/s  ${b.knee != null ? 'knee ' + Math.round(b.knee) + '° footY ' + b.footY.toFixed(2) : 'elbow ' + Math.round(b.elbow) + '°'}  travel ${b.travel.toFixed(2)} m`);
      }
    }
  }
  setLook('wjMotion', null);
}

/** ANATOMY (opt-in; ADR-255, the boss motion audit): EVERY move of his (melee, spells, terrain, the
 *  transitions) in every phase it is used in, on the rig with the hero standing (god mode, no guard): each
 *  blow's striking limb at its contact (a kick's knee, an arm's elbow: 180 = straight), and for an arm its
 *  LINE: how many degrees it points off the line from his shoulder to the hero, flat (aim) and up / down
 *  (elev), at the contact and at the release out of the cock (a spell's cast pose); the largest pop and
 *  when (t in the move; the beats' impacts after it). `GCD_MOVES` a comma list, `WJ_TAKES` the takes,
 *  `GCD_ANAT_OUT` the rows as JSON. */
async function scenarioAnatomy() {
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const kv of (process.env.GCD_LOOKS || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); setLook(k, v); }
  const names = process.env.GCD_MOVES ? process.env.GCD_MOVES.split(',') : MOVE_NAMES;
  const rows = [];
  for (const tk of (process.env.WJ_TAKES ?? 'b').split(',')) {
    setLook('wjMotion', tk);
    out(`
== scenario ANATOMY (take ${tk}: every blow's limb at its contact, an arm's line to the hero, pops) ==`);
    for (const ph of [1, 2, 3]) {
      for (const name of names) {
        const def = MOVES[name];
        if (!def || !phasesOf(name).includes(ph) || def.transition) continue;
        const G = build();
        duel(G, { dist: 2.2, form: ph });
        const band = def.band ?? [0, 4];
        const dist = process.env.GCD_ANAT_DIST ? +process.env.GCD_ANAT_DIST : Math.max(1.8, Math.min(7, band[0] + 0.6 > 2.2 ? band[0] + 0.6 : 2.2));
        const r = wjMeasure(G, name, { dist, how: 'none' });
        rows.push({ take: tk, ph, ...r });
        if (r.fail) { out(`  P${ph} ${name} FAIL ${r.fail}`); continue; }
        out(`  P${ph} ${name.padEnd(13)} d ${dist.toFixed(1)}  pop ${r.pop.toFixed(2)} ${r.popK} @${r.popT.toFixed(2)}  impacts ${r.impacts.map((t) => t.toFixed(2)).join(' ')}${r.nan ? '  NaN' : ''}`);
        for (const b of r.beats) {
          const limb = b.knee != null ? `knee ${Math.round(b.knee)}° footY ${b.footY.toFixed(2)}` : `elbow ${Math.round(b.elbow)}° (cock ${Math.round(b.elRel)}°)  line off ${Math.round(b.aim)}° / ${Math.round(b.elev)}° facing off ${Math.round(b.face)}° hero at ${b.gap.toFixed(2)} m rig ${b.rig}° chest ${b.chest}° (cock ${Math.round(b.aimRel)}° / ${Math.round(b.elevRel)}°)`;
          out(`       ${String(b.tell).padEnd(6)} ${b.part.padEnd(6)} W ${b.W.toFixed(2)}  held ${b.held.toFixed(2)}  ${limb}`);
        }
      }
    }
  }
  setLook('wjMotion', null);
  if (process.env.GCD_ANAT_OUT) fs.writeFileSync(process.env.GCD_ANAT_OUT, JSON.stringify(rows, null, 1));
}

/** POLISH (ADR-255, the boss motion audit; `?wjPolish=0|a`, `?wjCastHand=0|a|b`): measured on the rig with
 *  wjMeasure, take b. With the polish: every straight hand blow (the palm, the poke, Dark Spark, the Yank's
 *  fist) lands with the arm on the line from his shoulder to the hero's chest (within 12 deg; round 3 had
 *  12 - 31), and a kicking string's worst one-frame jump drops (Three Count: the foot no longer snaps back off
 *  a dead stop). The casting hand: phase 1's Azure Draw and Yank cast with the right arm out (elbow open,
 *  pointing at the hero at the contact) under 'a' and 'b', kept in the pocket under '0'. */
async function scenarioPolish() {
  out('\n== scenario POLISH (ADR-255: straight blows on the line, kick returns, the phase-1 casting hand) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  setLook('wjMotion', 'b');
  const run1 = (name, ph, looks, dist = 2.2) => {
    for (const [k, v] of Object.entries(looks)) setLook(k, v);
    const G = build();
    duel(G, { dist: 2.2, form: ph });
    return wjMeasure(G, name, { dist, how: 'none' });
  };
  const lines = { 0: [], a: [] }, pops = {};
  for (const pol of ['0', 'a']) {
    for (const [name, ph] of [['palm', 2], ['notEvenClose', 1], ['darkSpark', 2], ['fiveSides', 3], ['azureYank', 2]]) {
      const r = run1(name, ph, { wjPolish: pol, wjCastHand: 'a' }, name === 'azureYank' ? 3.4 : 2.2);
      if (r.fail) { assert(false, `polish ${pol}: ${name} ran (${r.fail})`); continue; }
      const b = r.beats.find((x) => x.aim != null && /^fist/.test(x.part));
      if (b) lines[pol].push([`${name}`, Math.round(b.aim), Math.round(b.elbow)]);
    }
    const t = run1('threeCount', 2, { wjPolish: pol });
    pops[pol] = t.pop;
  }
  const fmt = (L) => L.map(([n, a, e]) => `${n} ${a}°/${e}°`).join(', ');
  assert(lines.a.length === 5 && lines.a.every(([, a, e]) => a <= 12 && e >= 150), `?wjPolish=a: every straight hand blow on the line to the hero, off <= 12 deg, elbow >= 150 (${fmt(lines.a)})`);
  assert(lines['0'].some(([, a]) => a >= 20), `?wjPolish=0: round 3's lines as built (Dark Spark / the Yank 20+ deg off: ${fmt(lines['0'])})`);
  assert(pops.a < pops['0'] - 0.08 && pops.a <= 0.4, `?wjPolish=a: Three Count's worst one-frame jump ${pops['0'].toFixed(2)} -> ${pops.a.toFixed(2)} m (<= 0.4)`);
  // the casting hand (phase 1)
  const cast = {};
  for (const ch of ['0', 'a', 'b']) {
    for (const name of ['azureDraw', 'azureYank']) {
      const r = run1(name, 1, { wjPolish: 'a', wjCastHand: ch }, name === 'azureYank' ? 3.4 : 2.2);
      const b = r.beats?.[0];
      cast[ch + name] = b ? { el: Math.round(b.elbow), aim: Math.round(b.aim), elev: Math.round(b.elev) } : null;
    }
  }
  const out3 = (ch) => ['azureDraw', 'azureYank'].map((n) => `${n} ${cast[ch + n]?.el}° off ${cast[ch + n]?.aim}° / ${cast[ch + n]?.elev}°`).join(', ');
  for (const ch of ['a', 'b']) assert(['azureDraw', 'azureYank'].every((n) => cast[ch + n] && cast[ch + n].elev > -30 && cast[ch + n].aim <= 15), `?wjCastHand=${ch}: the arm out at the cast's contact, pointing at the hero (${out3(ch)})`);
  assert(['azureDraw', 'azureYank'].every((n) => cast['0' + n] && cast['0' + n].elev < -60), `?wjCastHand=0: the hand kept in its pocket (${out3('0')})`);
  for (const k of ['wjMotion', 'wjPolish', 'wjCastHand']) setLook(k, null);
}

/** MOTION: every take of his melee motion (?wjMotion=a|b|c): it loads, every melee move runs in every phase it
 *  is used in (no NaN, no failure), every blow lands within a few frames of its release out of the cock, a
 *  blue / red blow holds its pose, a kick lands with the leg straight, the hands stay in his pockets in
 *  phase 1 (the left in phase 2) unless the blow uses them; '0' plays the shipped beats themselves. */
async function scenarioMotion() {
  out('\n== scenario MOTION (?wjMotion takes: every melee move in every phase; snaps, holds, straight kicks, the hands) ==');
  const { setLook, lookOf } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { MOVE_OWNERS } = await imp('src/entities/enemies/untouched/moves.js');
  const { TAKES, MOTION_OPTS } = await imp('src/entities/enemies/untouched/motion.js');
  const names = MOVE_NAMES.filter((n) => MOVE_OWNERS[n] === 'melee');
  const was = lookOf('wjMotion', '0');
  // '0': the shipped beats (no take field on any of them)
  setLook('wjMotion', '0');
  assert(names.every((n) => MOVES[n].beats.every((b) => (b.pick ?? [b]).every((x) => x.wjHands === undefined))), "take '0': every melee move plays its shipped beats");
  assert(MOTION_OPTS.join() === '0,a,b,c' && ['a', 'b', 'c'].every((t) => TAKES[t]), 'the takes: 0, a, b, c');
  const takes = (process.env.WJ_TAKES ?? 'a,b,c').split(',');
  for (const tk of takes) {
    setLook('wjMotion', tk);
    let n = 0;
    const bad = { fail: [], nan: [], snap: [], held: [], knee: [], hands: [] };
    for (const ph of [1, 2, 3]) {
      const G = build();
      duel(G, { dist: 2.2, form: ph });
      for (const name of names) {
        if (!phasesOf(name).includes(ph)) continue;
        const r = wjMeasure(G, name);
        const tag = `P${ph} ${name}`;
        if (r.fail) { bad.fail.push(`${tag} ${r.fail}`); continue; }
        n++;
        if (r.nan) bad.nan.push(tag);
        const defs = MOVES[name].beats.flatMap((b) => b.pick ?? [b]).filter((b) => !b.feint);
        const uses = defs.map((b) => b.wjHands ?? '').join('');
        const dash = defs.some((b) => b.dash);
        for (const b of r.beats) {
          if (!(b.snap <= 0.16 + 1e-6)) bad.snap.push(`${tag} ${b.part} ${b.snap.toFixed(2)}`);
          if ((b.tell === 'blue' || b.tell === 'red') && !dash && !(b.held >= 0.1)) bad.held.push(`${tag} ${b.tell} ${b.held.toFixed(2)}`);
          if (b.knee != null && /^foot/.test(b.part) && b.footY > 0.5 && !(b.knee >= 158)) bad.knee.push(`${tag} ${Math.round(b.knee)}`);
        }
        // (in the pelvis's frame: a coil that twists the chest off the hips, Dark Spark's, the stomp's, carries
        // the pocketed hand up to ~0.25 m off where it rests)
        const tol = 0.26;
        if (ph === 1 && !uses.includes('R') && r.outR > tol) bad.hands.push(`${tag} R ${r.outR.toFixed(2)}`);
        if (ph <= 2 && !uses.includes('L') && r.outL > tol) bad.hands.push(`${tag} L ${r.outL.toFixed(2)}`);
      }
    }
    const say = (k) => bad[k].slice(0, 6).join('; ');
    assert(n >= 40 && !bad.fail.length, `take ${tk}: ${n} melee moves ran in their phases (${say('fail')})`);
    assert(!bad.nan.length, `take ${tk}: no NaN on his joints (${say('nan')})`);
    assert(!bad.snap.length, `take ${tk}: every blow lands within 0.16 s of its release (${say('snap')})`);
    assert(!bad.held.length, `take ${tk}: every blue / red blow holds its pose >= 0.1 s (${say('held')})`);
    assert(!bad.knee.length, `take ${tk}: every kick at the body lands with the leg straight, knee >= 158° (${say('knee')})`);
    assert(!bad.hands.length, `take ${tk}: the hands in his pockets: phase 1 both, phase 2 the left, unless the blow uses them (${say('hands')})`);
  }
  setLook('wjMotion', was === '0' ? null : was);
}
